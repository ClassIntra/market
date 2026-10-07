// 中国象棋 —— Pikafish UCI 引擎桥
//
// 背景：人机练习原先是前端闭包里的极大极小搜索（entry.js 的 aiSearch 段），
// 平板算力 + 主线程预算把棋力上限锁死在「能赢新手、赢不了学过棋的同学」。
// 本模块把引擎换成真正的 UCI 象棋引擎 Pikafish（Stockfish 的象棋分支），
// 由服务端常驻进程承载：算力在服务器、不占平板主线程、棋力可调。
//
// 设计要点（都是踩过才会想到的约束）：
// 1) **常驻单实例 + 串行队列**。UCI 是有状态行协议，一个进程同时只服务一个搜索；
//    每步新建进程要重新加载 50MB 权重（冷盘约 1s 起），不可接受。故保活一个进程，
//    请求排队串行执行；空闲 10 分钟回收（进程 + 权重 + Hash 常驻约 90MB 内存）。
// 2) **优雅降级**。引擎缺失/启动失败/排队溢出一律 reject（带 code），
//    由前端回落内置 AI——市场应用不能因为一个可选二进制缺失就整个坏掉。
// 3) **棋力档位只调「搜索预算」**。Pikafish 2026-09 版已移除 Skill Level /
//    UCI_LimitStrength（见 src/engine.cpp 的选项注册表，只有 Threads/Hash/MultiPV/
//    Move Overhead/nodestime/UCI_ShowWDL/EvalFile），可调的只有 movetime/depth/nodes
//    与 MultiPV。故本模块只用 movetime；难度梯度的另一半由前端「让子」预设承担
//    （见 frontend/entry.js 的 AI_HANDICAP），这比伪造弱着更符合象棋让子棋的传统观感。
// 4) **坐标约定**：本应用 board[row][col]，row0 = 黑方底线、row9 = 红方底线；
//    UCI 用 file 'a'-'i' + rank '0'-'9'，rank0 = 红方底线（与象棋 FEN 首段 =
//    黑方底线一致）。故 uciRank = 9 - row、uciFile = 'abcdefghi'[col]。
//    起始 FEN 与 Pikafish 的 StartFEN 逐字符一致（src/uci.h）。
var path = require('path');
var fs = require('fs');
var childProcess = require('child_process');

// ===== 路径与开关 =====
var ENGINE_DIR = process.env.CHESS_ENGINE_DIR || path.join(__dirname, 'engine');
var ENGINE_EXE = process.env.CHESS_ENGINE_EXE || path.join(ENGINE_DIR, process.env.CHESS_ENGINE_FILE || 'pikafish.exe');
var ENGINE_NNUE = process.env.CHESS_ENGINE_NNUE || path.join(ENGINE_DIR, 'pikafish.nnue');

var DISABLED = String(process.env.CHESS_ENGINE_DISABLE || '') === '1';
var THREADS = clampInt(process.env.CHESS_ENGINE_THREADS, 1, 1, 8);
// 换位表大小。32MB 对单线程短时搜索够用，但「分析」这条路会连续搜同一族局面
// （走一步换个近亲局面），加大换位表能明显减少重复子树 → 同样 movetime 下深度更高。
// 64MB 对一台校园服务器是可忽略的开销（引擎进程常驻），故默认提到 64。
var HASH_MB = clampInt(process.env.CHESS_ENGINE_HASH, 64, 1, 1024);

var IDLE_SHUTDOWN_MS = 10 * 60 * 1000;  // 空闲回收
var FAIL_COOLDOWN_MS = 30 * 1000;       // 启动/运行失败后的冷却期，期间直接降级
var BOOT_TIMEOUT_MS = 30 * 1000;        // 冷盘加载 50MB 权重留足余量
var SEARCH_SLACK_MS = 6000;             // movetime 之外容许的协议/收尾开销
var MAX_QUEUE = 8;                      // 排队上限：超出即降级（比让全班转圈好）
var MIN_MOVETIME = 50;
var MAX_MOVETIME = 3000;

// 棋力档位 = 思考预算（**不是**让子）。2026-09 版 Pikafish 已移除 Skill Level /
// UCI_LimitStrength，可调的只有搜索预算，所以「强弱」只能由 movetime 表达。
// 基准：本机单线程约 50 万 nps，300ms 约 14 层、900ms 约 17 层。
// ⚠️ 三个 key 必须与前端 AI_LEVELS 逐一对应（前端存 localStorage 并原样回传 level）；
// 改了这里记得同步 frontend/entry.js 的 AI_LEVELS。
var LEVELS = {
  quick: { movetime: 300 },
  normal: { movetime: 900 },
  master: { movetime: 2200 }
};
var DEFAULT_LEVEL = 'normal';

// 局面分析（MultiPV）专用预算：比走子略长，换取更稳的评分与更长的主变例。
// clamp 上限放到 5000ms —— 分析是低频动作（切到引擎页/手动点一次），
// 走子则仍受 MAX_MOVETIME 约束，避免把服务器引擎占死。
var ANALYSE_MOVETIME = 700;
var ANALYSE_MAX_MOVETIME = 5000;
var ANALYSE_MULTIPV = 3;
var ANALYSE_MAX_MULTIPV = 5;

// ===== 棋子与坐标 =====
var FEN_LETTERS = { king: 'k', guard: 'a', elephant: 'b', knight: 'n', rook: 'r', cannon: 'c', pawn: 'p' };
var FILES = 'abcdefghi';
var COLS = 9;
var ROWS = 10;

function clampInt(raw, fallback, min, max) {
  var value = parseInt(raw, 10);
  if (!isFinite(value)) return fallback;
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

function engineError(code, message) {
  var error = new Error(message);
  error.code = code;
  return error;
}

function pieceLetter(piece) {
  var text = String(piece);
  var letter = FEN_LETTERS[text.slice(2)];
  if (!letter) return null;
  return text.indexOf('r_') === 0 ? letter.toUpperCase() : letter;
}

// 棋盘 → 象棋 FEN。首段是黑方底线（row 0），与 Pikafish StartFEN 的朝向一致。
// 非法棋子/维度直接抛错：宁可不走棋，也不要把垃圾局面喂给引擎后拿到
// 「看着正常、实则整体上下错位」的着法。
function boardToFen(board, turn) {
  if (!board || board.length !== ROWS) throw engineError('BAD_POSITION', '棋盘行数不正确');
  var ranks = [];
  for (var r = 0; r < ROWS; r++) {
    var row = board[r];
    if (!row || row.length !== COLS) throw engineError('BAD_POSITION', '棋盘列数不正确');
    var rank = '';
    var empty = 0;
    for (var c = 0; c < COLS; c++) {
      var piece = row[c];
      if (!piece) { empty++; continue; }
      var letter = pieceLetter(piece);
      if (!letter) throw engineError('BAD_POSITION', '未知棋子：' + piece);
      if (empty) { rank += String(empty); empty = 0; }
      rank += letter;
    }
    if (empty) rank += String(empty);
    ranks.push(rank);
  }
  return ranks.join('/') + ' ' + (turn === 'black' ? 'b' : 'w') + ' - - 0 1';
}

// 内部坐标 → UCI 方格（'a0'-'i9'）
function squareToUci(row, col) {
  if (!(row >= 0 && row < ROWS && col >= 0 && col < COLS)) return null;
  return FILES.charAt(col) + String(ROWS - 1 - row);
}
function uciSquare(square) {
  var col = FILES.indexOf(square.charAt(0));
  var rank = parseInt(square.charAt(1), 10);
  if (col < 0 || !isFinite(rank)) return null;
  return { row: ROWS - 1 - rank, col: col };
}
// 'h2e2' → { fr, fc, tr, tc, uci }
function uciToMove(text) {
  var raw = String(text || '').trim();
  if (!/^[a-i][0-9][a-i][0-9]$/.test(raw)) return null;
  var from = uciSquare(raw.slice(0, 2));
  var to = uciSquare(raw.slice(2, 4));
  if (!from || !to) return null;
  return { fr: from.row, fc: from.col, tr: to.row, tc: to.col, uci: raw };
}

// ===== 引擎进程（单实例 + 串行队列） =====
function EngineProcess() {
  this.proc = null;
  this.alive = false;
  this.booting = null;       // 握手 Promise（并发调用复用）
  this.pumping = false;      // 启动流程中，避免多个请求同时拉进程
  this.queue = [];           // [{ opts, resolve, reject }]
  this.current = null;       // 进行中的条目（含 timer / info）
  this.buffer = '';
  this.stderrTail = '';
  this.waiter = null;        // 握手期的一次性等待器
  this.lastGameKey = '';
  this.lastMultiPv = 0;      // 0 = 尚未下发过（握手时写 1，之后只在变化时重写）
  this.idleTimer = null;
  this.failedUntil = 0;
  this.engineName = '';
  this.stats = { served: 0, failed: 0, rejected: 0, starts: 0, lastError: '' };
}

EngineProcess.prototype.available = function() {
  if (DISABLED) return false;
  try { return fs.existsSync(ENGINE_EXE); } catch (e) { return false; }
};

EngineProcess.prototype.describe = function() {
  var netFile = null;
  try { if (fs.existsSync(ENGINE_NNUE)) netFile = ENGINE_NNUE; } catch (e) { netFile = null; }
  return {
    available: this.available(),
    disabled: DISABLED,
    exe: ENGINE_EXE,
    netFile: netFile,
    engineName: this.engineName || (this.available() ? 'Pikafish' : ''),
    running: this.alive,
    pending: this.queue.length + (this.current ? 1 : 0),
    cooldownMs: Math.max(0, this.failedUntil - Date.now()),
    stats: this.stats
  };
};

EngineProcess.prototype.status = function() {
  var info = this.describe();
  info.levels = {};
  for (var key in LEVELS) { if (Object.prototype.hasOwnProperty.call(LEVELS, key)) info.levels[key] = LEVELS[key].movetime; }
  info.defaultLevel = DEFAULT_LEVEL;
  return info;
};

// 启动 + 握手：uci → uciok → setoption → isready → readyok
EngineProcess.prototype.ensureStarted = function() {
  var self = this;
  if (this.alive && this.proc) return Promise.resolve();
  if (this.booting) return this.booting;
  if (!this.available()) return Promise.reject(engineError('ENGINE_UNAVAILABLE', '引擎文件不存在'));
  if (Date.now() < this.failedUntil) return Promise.reject(engineError('ENGINE_UNAVAILABLE', '引擎冷却中'));

  var boot = new Promise(function(resolve, reject) {
    var proc;
    try {
      proc = childProcess.spawn(ENGINE_EXE, [], {
        cwd: ENGINE_DIR,
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe']
      });
    } catch (e) {
      reject(engineError('ENGINE_UNAVAILABLE', '启动引擎失败：' + e.message));
      return;
    }
    self.proc = proc;
    self.stats.starts++;
    var settled = false;
    var bootTimer = setTimeout(function() { fail(engineError('ENGINE_UNAVAILABLE', '引擎握手超时')); }, BOOT_TIMEOUT_MS);
    if (bootTimer.unref) bootTimer.unref();

    function fail(error) {
      if (settled) return;
      settled = true;
      clearTimeout(bootTimer);
      // 启动失败还有一条路（握手超时 / spawn error）不经过 exit 事件，这里补上日志
      try { console.warn('[chess] 引擎启动失败: ' + error.message); } catch (e) {}
      self._fail(error);
      reject(error);
    }

    proc.stdout.setEncoding('utf8');
    proc.stdout.on('data', function(chunk) { self._onStdout(chunk); });
    proc.stderr.setEncoding('utf8');
    proc.stderr.on('data', function(chunk) { self.stderrTail = (self.stderrTail + chunk).slice(-2000); });
    proc.on('error', function(error) {
      fail(engineError('ENGINE_UNAVAILABLE', '引擎进程错误：' + error.message));
    });
    proc.on('exit', function(code, signal) {
      var entry = self.current;
      var wasAlive = self.alive;
      self.alive = false;
      self.proc = null;
      self.lastGameKey = '';
      self.lastMultiPv = 0;   // 进程没了，setoption 一并失效
      self.stats.lastError = '引擎退出 code=' + code + ' signal=' + signal;
      // 搜索中进程没了：必须留日志，否则线上只剩一个 503 ENGINE_ERROR，无法定位
      // （退出码 / stderr 全都拿不到）。code=1 + 空 stderr 通常是引擎自己 abort。
      try { console.warn('[chess] 引擎进程退出 code=' + code + ' signal=' + signal + ' 搜索中=' + !!entry + ' stderrTail=' + JSON.stringify(self.stderrTail.slice(-300))); } catch (e) {}
      if (entry) {
        clearTimeout(entry.timer);
        self.current = null;
        self.stats.failed++;
        entry.reject(engineError('ENGINE_ERROR', '引擎异常退出'));
      }
      if (wasAlive) self.failedUntil = Date.now() + FAIL_COOLDOWN_MS;
      if (!settled) {
        // 启动失败必须留日志：Pikafish 启动即退是**静默**的（stderr 都不一定有），
        // 没有这行的话线上只能看到 503，查不到原因（EvalFile 引号那次就是这么踩的）。
        try { console.warn('[chess] 引擎启动失败 code=' + code + ' signal=' + signal + ' stderrTail=' + JSON.stringify(self.stderrTail.slice(-300))); } catch (e) {}
        fail(engineError('ENGINE_UNAVAILABLE', '引擎启动即退出：' + self.stderrTail.slice(-200)));
      }
      self._pump();
    });

    // 先注册等待器再发命令：stdout 数据虽在下一 tick 才到，但顺序上更稳
    self._await(function(line) { return line === 'uciok'; }, BOOT_TIMEOUT_MS).then(function() {
      self._write('setoption name Threads value ' + THREADS);
      self._write('setoption name Hash value ' + HASH_MB);
      self._write('setoption name MultiPV value 1');
      self.lastMultiPv = 1;
      // 权重文件在就用绝对路径显式指定：Pikafish 找不到评估文件会直接退出，
      // 而默认值 "pikafish.nnue" 只按工作目录解析，显式化后 cwd 变化也不会瞎。
      // ⚠️ **绝不能给路径加双引号**：Pikafish 的 OptionsMap::setoption 是按空格
      // 切 token 后原样拼接（没有 std::quoted 去引号），带引号的路径会被当成
      // 文件名的一部分 → load_network 抛异常 → 进程静默 exit=1（实测）。
      try { if (fs.existsSync(ENGINE_NNUE)) self._write('setoption name EvalFile value ' + ENGINE_NNUE); } catch (e) { /* 读不到交给引擎默认 */ }
      var ready = self._await(function(line) { return line === 'readyok'; }, BOOT_TIMEOUT_MS);
      self._write('isready');
      return ready;
    }).then(function() {
      if (settled) return;
      settled = true;
      clearTimeout(bootTimer);
      self.alive = true;
      self.stats.lastError = '';
      self._touchIdleTimer();
      resolve();
    }).catch(function(error) { fail(error); });

    self._write('uci');
  });

  this.booting = boot;
  var clear = function() { if (self.booting === boot) self.booting = null; };
  boot.then(clear, clear);
  return boot;
};

EngineProcess.prototype._write = function(line) {
  if (!this.proc || !this.proc.stdin || !this.proc.stdin.writable) return false;
  try { this.proc.stdin.write(line + '\n'); return true; } catch (e) { return false; }
};

EngineProcess.prototype._await = function(match, timeoutMs) {
  var self = this;
  return new Promise(function(resolve, reject) {
    var timer = setTimeout(function() {
      if (self.waiter && self.waiter.timer === timer) self.waiter = null;
      reject(engineError('ENGINE_ERROR', '引擎协议超时'));
    }, timeoutMs);
    self.waiter = { match: match, resolve: resolve, timer: timer };
  });
};

EngineProcess.prototype._onStdout = function(chunk) {
  this.buffer += chunk;
  var index;
  while ((index = this.buffer.indexOf('\n')) >= 0) {
    var line = this.buffer.slice(0, index).replace(/\r$/, '');
    this.buffer = this.buffer.slice(index + 1);
    this._onLine(line);
  }
  if (this.buffer.length > 65536) this.buffer = this.buffer.slice(-4096);
};

EngineProcess.prototype._onLine = function(line) {
  if (line.indexOf('id name ') === 0) {
    this.engineName = line.slice(8).trim();
    return;
  }
  if (this.waiter && this.waiter.match(line)) {
    var waiter = this.waiter;
    this.waiter = null;
    clearTimeout(waiter.timer);
    waiter.resolve(line);
    return;
  }
  var entry = this.current;
  if (!entry) return;
  if (line.indexOf('info ') === 0) {
    // 只记带 pv 的 info：分数/深度/节点数取最终值即可。
    if (line.indexOf(' pv ') < 0) return;
    // 边界行（aspiration window 未收敛时引擎会发 lowerbound/upperbound）的 pv 是
    // 「尚未验证的半截线路」，拿它当结论会显示成只有一两步的主变例。
    if (line.indexOf(' lowerbound') >= 0 || line.indexOf(' upperbound') >= 0) return;
    var slotMatch = /\bmultipv (\d+)\b/.exec(line);
    var slot = slotMatch ? parseInt(slotMatch[1], 10) : 1;
    var depthMatch = /\bdepth (\d+)\b/.exec(line);
    var depth = depthMatch ? parseInt(depthMatch[1], 10) : 0;
    // ⚠️ 必须**按批**收，不能按槽覆盖（第一版就是这么写错的）：
    // 一次迭代 = 同一 depth 下 1..MultiPV 各一条连发；思考时间用尽时引擎会发出
    // **半批**的最后一次迭代——那一批里只有 1 号被刷新。按槽覆盖就会留下
    // 「1 号=新结论、2 号=上一批的同一着法」→ 候选列表出现重复着法（实测 uniq=2/3）。
    // 改为：攒批，取「条数最多（并列取更深）」的那一批整批落定。
    if (!entry.batch || depth !== entry.batchDepth) {
      this._settleBatch(entry);
      entry.batch = {};
      entry.batchDepth = depth;
    }
    entry.batch[slot] = line;
    return;
  }
  if (line.indexOf('bestmove ') === 0) {
    clearTimeout(entry.timer);
    this.current = null;
    this.stats.served++;
    this._settleBatch(entry);
    var bestMap = entry.best ? entry.best.map : null;
    var result = this._parseResult(line, bestMap ? bestMap['1'] : null, entry.opts);
    result.lines = this._parseLines(bestMap);
    entry.resolve(result);
    this._touchIdleTimer();
    this._pump();
  }
};

// 落定一批（同一次迭代）候选：取「条数最多，并列取更深」的那批。
// 条数优先是为了挡掉「时间用尽时的半批」——半批只有 1 号，条数垫底，不会被选中；
// 而「合法根着法少于 MultiPV」时各批条数一致，自然取到最深的完整批。
EngineProcess.prototype._settleBatch = function(entry) {
  var batch = entry.batch;
  if (!batch) return;
  var size = Object.keys(batch).length;
  if (!size) return;
  if (!entry.best || size > entry.best.size || (size === entry.best.size && entry.batchDepth >= entry.best.depth)) {
    entry.best = { size: size, depth: entry.batchDepth, map: batch };
  }
};

// 解析单条 info 行的公共字段。score 是 UCI 约定：**站在当前行棋方视角**
// （红走则红为正），调用方要按自己的执色再翻一次，别在这里翻。
function parseInfoFields(line) {
  var out = { score: null, depth: null, nodes: null, nps: null, time: null, pv: [] };
  if (!line) return out;
  var scoreMatch = line.match(/\bscore (cp|mate) (-?\d+)/);
  if (scoreMatch) out.score = { type: scoreMatch[1], value: parseInt(scoreMatch[2], 10) };
  var depthMatch = line.match(/\bdepth (\d+)/);
  if (depthMatch) out.depth = parseInt(depthMatch[1], 10);
  var nodesMatch = line.match(/\bnodes (\d+)/);
  if (nodesMatch) out.nodes = parseInt(nodesMatch[1], 10);
  var npsMatch = line.match(/\bnps (\d+)/);
  if (npsMatch) out.nps = parseInt(npsMatch[1], 10);
  var timeMatch = line.match(/\btime (\d+)/);
  if (timeMatch) out.time = parseInt(timeMatch[1], 10);
  var pvMatch = line.match(/\bpv (.*)$/);
  if (pvMatch) {
    out.pv = pvMatch[1].trim().split(/\s+/).filter(function(token) { return /^[a-i][0-9][a-i][0-9]$/.test(token); });
  }
  return out;
}

EngineProcess.prototype._parseResult = function(bestmoveLine, infoLine, opts) {
  var parts = bestmoveLine.split(/\s+/);
  var raw = parts[1] || '';
  var fields = parseInfoFields(infoLine);
  var result = {
    uci: (raw === '(none)' || raw === '0000' || !raw) ? null : raw,
    ponder: null,
    score: fields.score,
    depth: fields.depth,
    nodes: fields.nodes,
    nps: fields.nps,
    time: fields.time,
    pv: fields.pv,
    engineName: this.engineName,
    movetime: opts.movetime
  };
  if (parts[2] === 'ponder' && parts[3]) result.ponder = parts[3];
  return result;
};

// 把 entry.lines（multipv 分桶的 info 行）整理成候选着法数组。
// 排序按 multipv 编号（引擎已按优劣给出，1 号最佳），非法 uci 直接丢弃。
EngineProcess.prototype._parseLines = function(linesMap) {
  if (!linesMap) return [];
  var slots = Object.keys(linesMap).map(function(key) { return parseInt(key, 10); })
    .filter(function(n) { return isFinite(n); })
    .sort(function(a, b) { return a - b; });
  var out = [];
  for (var i = 0; i < slots.length; i++) {
    var fields = parseInfoFields(linesMap[String(slots[i])]);
    var head = fields.pv.length ? fields.pv[0] : '';
    var move = head ? uciToMove(head) : null;
    if (!move) continue;
    out.push({
      rank: out.length + 1,
      uci: head,
      move: { fr: move.fr, fc: move.fc, tr: move.tr, tc: move.tc },
      score: fields.score,
      depth: fields.depth,
      // MultiPV 的每条 info 行**各自携带** depth/nodes/time（不是全局值）：
      // 首选着法通常比后面的候选搜得深。带上它们，前端才能像皮卡鱼网页版那样
      // 在每张候选卡上标「深度 D · N 节点」。
      nodes: fields.nodes,
      time: fields.time,
      pv: fields.pv
    });
  }
  return out;
};

EngineProcess.prototype._touchIdleTimer = function() {
  var self = this;
  if (this.idleTimer) { clearTimeout(this.idleTimer); this.idleTimer = null; }
  if (!this.alive) return;
  this.idleTimer = setTimeout(function() { self._idleShutdown(); }, IDLE_SHUTDOWN_MS);
  if (this.idleTimer.unref) this.idleTimer.unref();
};

EngineProcess.prototype._idleShutdown = function() {
  if (this.current || this.queue.length) return;   // 有活在身就不收
  this._kill();
};

EngineProcess.prototype._kill = function() {
  var proc = this.proc;
  this.proc = null;
  this.alive = false;
  this.lastGameKey = '';
  this.lastMultiPv = 0;
  if (this.idleTimer) { clearTimeout(this.idleTimer); this.idleTimer = null; }
  if (!proc) return;
  try { proc.stdin.write('quit\n'); } catch (e) { /* 已断开 */ }
  var timer = setTimeout(function() { try { proc.kill(); } catch (e) { /* 已退出 */ } }, 1500);
  if (timer.unref) timer.unref();
  proc.once('exit', function() { clearTimeout(timer); });
};

// 失败处置：清干净 + 进冷却期，保证后续请求要么重启、要么快速降级
EngineProcess.prototype._fail = function(error) {
  this.stats.lastError = error && error.message ? error.message : String(error);
  this.failedUntil = Date.now() + FAIL_COOLDOWN_MS;
  this.alive = false;
  this.waiter = null;
  var proc = this.proc;
  this.proc = null;
  this.lastGameKey = '';
  this.lastMultiPv = 0;
  if (proc) { try { proc.kill(); } catch (e) { /* 已退出 */ } }
};

EngineProcess.prototype._rejectAll = function(error) {
  while (this.queue.length) {
    var entry = this.queue.shift();
    this.stats.rejected++;
    entry.reject(error);
  }
};

EngineProcess.prototype.submit = function(opts) {
  var self = this;
  return new Promise(function(resolve, reject) {
    if (self.current && self.queue.length >= MAX_QUEUE) {
      self.stats.rejected++;
      reject(engineError('ENGINE_BUSY', '引擎排队已满'));
      return;
    }
    self.queue.push({ opts: opts, resolve: resolve, reject: reject, info: '' });
    self._pump();
  });
};

EngineProcess.prototype._pump = function() {
  if (this.pumping || this.current || !this.queue.length) return;
  if (!this.alive) {
    if (!this.available() || Date.now() < this.failedUntil) {
      this._rejectAll(engineError('ENGINE_UNAVAILABLE', '引擎不可用'));
      return;
    }
    var self = this;
    this.pumping = true;
    this.ensureStarted().then(function() {
      self.pumping = false;
      self._pump();
    }, function(error) {
      self.pumping = false;
      self._rejectAll(error);
    });
    return;
  }
  this._run(this.queue.shift());
};

EngineProcess.prototype._run = function(entry) {
  var self = this;
  var opts = entry.opts;
  // 换局才清哈希：同一局内保留 TT 让下一步明显更快
  var gameKey = String(opts.gameKey || '');
  if (gameKey !== this.lastGameKey) {
    this._write('ucinewgame');
    this._write('isready');
    this.lastGameKey = gameKey;
  }
  // MultiPV：只在值变化时下发。setoption 会触发引擎内部重配，
  // 每次搜索都写一遍是白白的内耗；走子恒用 1，分析按需放大。
  var multiPv = clampInt(opts.multiPv, 1, 1, ANALYSE_MAX_MULTIPV);
  if (multiPv !== this.lastMultiPv) {
    this._write('setoption name MultiPV value ' + multiPv);
    this.lastMultiPv = multiPv;
  }
  this.buffer = '';
  this.current = entry;
  entry.batch = null;       // 当前攒的这批（同一 depth 下 1..MultiPV）
  entry.batchDepth = -1;
  entry.best = null;        // 已落定的最好一批 { size, depth, map }
  entry.timer = setTimeout(function() {
    if (self.current !== entry) return;
    self.current = null;
    self.stats.failed++;
    // 超时说明引擎状态可疑：换进程比复用更省心
    self._fail(engineError('ENGINE_ERROR', '搜索超时'));
    entry.reject(engineError('ENGINE_ERROR', '搜索超时'));
  }, opts.movetime + SEARCH_SLACK_MS);
  this._write('position fen ' + opts.fen);
  this._write('go movetime ' + opts.movetime);
  this._touchIdleTimer();
};

var engine = new EngineProcess();

// 加载标记：确认线上跑的是哪份引擎代码（改完没生效这类问题，一眼可辨），
// 并顺带报一次文件是否到位。exe/权重是 .stignore 排除项（57MB 走 Syncthing 不现实），
// 换机器后不会自动出现——只听「模块已加载」会误判成可用（8i 上真踩过一次：
// 前端静默回落内置 AI，只能从平板上「没引擎」的观感反推，运维侧毫无线索）。
try {
  var exeExists = fs.existsSync(ENGINE_EXE);
  var nnueExists = fs.existsSync(ENGINE_NNUE);
  console.warn('[chess] 引擎模块已加载 exe=' + ENGINE_EXE + ' 存在=' + exeExists + ' 权重=' + nnueExists + ' hash=' + HASH_MB + 'MB threads=' + THREADS);
  if (!DISABLED && !exeExists) {
    console.warn('[chess] 引擎可执行文件缺失，人机练习将回落内置 AI。修复：在服务器上执行 node scripts/chess-engine-setup.mjs（约 51MB，装完无需重启服务）');
  } else if (!DISABLED && !nnueExists) {
    console.warn('[chess] 引擎权重 pikafish.nnue 缺失（exe 在但无 NNUE），搜索会失败并回落内置 AI。修复：node scripts/chess-engine-setup.mjs');
  }
} catch (e) {}

// 兜底：进程退出时收掉引擎（正常路径由空闲回收负责）
if (!global.__chessEngineExitHooked) {
  global.__chessEngineExitHooked = true;
  process.once('exit', function() { try { engine._kill(); } catch (e) { /* noop */ } });
}

function normalizeLevel(level) {
  return Object.prototype.hasOwnProperty.call(LEVELS, level) ? level : DEFAULT_LEVEL;
}
function levelMovetime(level, override) {
  var key = normalizeLevel(level);
  return clampInt(override, LEVELS[key].movetime, MIN_MOVETIME, MAX_MOVETIME);
}

// 对外唯一入口：给一个局面要一步棋。
// opts: { board, turn, level, movetime?, gameKey? }
// resolve: { move: {fr,fc,tr,tc}|null, uci, score, depth, nodes, engineName, movetime }
// reject : Error{ code: ENGINE_UNAVAILABLE | ENGINE_BUSY | ENGINE_ERROR | BAD_POSITION }
function bestMove(opts) {
  var options = opts || {};
  var fen;
  try {
    fen = boardToFen(options.board, options.turn);
  } catch (error) {
    return Promise.reject(error);
  }
  var movetime = levelMovetime(options.level, options.movetime);
  return engine.submit({
    fen: fen,
    movetime: movetime,
    gameKey: options.gameKey || ''
  }).then(function(result) {
    var move = result.uci ? uciToMove(result.uci) : null;
    // ⚠️ 逐字段显式搬运：这里漏掉哪个字段，路由那层就会静默返回 undefined
    // （曾漏 pv/nps/time，表现为「提示按钮拿不到主变例」且类型检查不报错）。
    return {
      move: move ? { fr: move.fr, fc: move.fc, tr: move.tr, tc: move.tc } : null,
      uci: move ? move.uci : null,
      score: result.score,
      depth: result.depth,
      nodes: result.nodes,
      nps: result.nps,
      time: result.time,
      pv: result.pv,
      engineName: result.engineName,
      movetime: result.movetime
    };
  });
}

// 分析参数归一化。抽成导出的独立函数是为了让**路由层拿它算缓存键**——
// 缓存键必须在「真实下发到引擎的参数」上取值，否则 {movetime: 0} 与 {movetime: 999}
// 会算出两个不同的键、却跑到同一个 movetime，缓存形同虚设。
function normalizeAnalyseOpts(opts) {
  var options = opts || {};
  return {
    movetime: clampInt(options.movetime, ANALYSE_MOVETIME, MIN_MOVETIME, ANALYSE_MAX_MOVETIME),
    multiPv: clampInt(options.multiPv, ANALYSE_MULTIPV, 1, ANALYSE_MAX_MULTIPV)
  };
}

// 局面分析：给一个局面要「Top-N 候选着法 + 各自评分与主变例」。
// 与 bestMove 走同一条串行队列（引擎单实例），只是把 MultiPV 放大、预算放宽。
// opts: { board, turn, movetime?, multiPv?, gameKey? }
// resolve: { side, engineName, depth, nodes, nps, time, movetime, lines: [{ rank, uci, move, score, deepth, pv }] }
function analyse(opts) {
  var options = opts || {};
  var fen;
  try {
    fen = boardToFen(options.board, options.turn);
  } catch (error) {
    return Promise.reject(error);
  }
  var budget = normalizeAnalyseOpts(options);
  var movetime = budget.movetime;
  var multiPv = budget.multiPv;
  return engine.submit({
    fen: fen,
    movetime: movetime,
    multiPv: multiPv,
    gameKey: options.gameKey || ''
  }).then(function(result) {
    var lines = [];
    for (var i = 0; i < result.lines.length; i++) {
      var line = result.lines[i];
      lines.push({
        rank: line.rank,
        uci: line.uci,
        move: { fr: line.move.fr, fc: line.move.fc, tr: line.move.tr, tc: line.move.tc },
        score: line.score,
        depth: line.depth,
        // ⚠️ 逐字段搬运（与 bestMove 同一课）：这里漏掉的字段，路由层就拿到 undefined。
        // nodes/time 是每条候选自己的搜索量（MultiPV 各行独立），面板候选卡要显示。
        nodes: line.nodes,
        time: line.time,
        pv: line.pv
      });
    }
    return {
      side: options.turn === 'black' ? 'black' : 'red',
      engineName: result.engineName,
      depth: result.depth,
      nodes: result.nodes,
      nps: result.nps,
      time: result.time,
      movetime: result.movetime,
      multiPv: multiPv,
      lines: lines
    };
  });
}

function status() { return engine.status(); }
function shutdown() { engine._kill(); }

module.exports = {
  LEVELS: LEVELS,
  DEFAULT_LEVEL: DEFAULT_LEVEL,
  MIN_MOVETIME: MIN_MOVETIME,
  MAX_MOVETIME: MAX_MOVETIME,
  ANALYSE_MOVETIME: ANALYSE_MOVETIME,
  ANALYSE_MAX_MOVETIME: ANALYSE_MAX_MOVETIME,
  ANALYSE_MULTIPV: ANALYSE_MULTIPV,
  ANALYSE_MAX_MULTIPV: ANALYSE_MAX_MULTIPV,
  boardToFen: boardToFen,
  squareToUci: squareToUci,
  uciToMove: uciToMove,
  normalizeLevel: normalizeLevel,
  normalizeAnalyseOpts: normalizeAnalyseOpts,
  levelMovetime: levelMovetime,
  bestMove: bestMove,
  analyse: analyse,
  status: status,
  shutdown: shutdown
};
