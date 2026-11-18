/*
 * 围棋本地 AI —— 轻量 MCTS（蒙特卡洛树搜索）
 *
 * 目标：在校园平板（Chrome 80 / X5）上不卡界面、不依赖任何外部模型或 WASM。
 *   - 浏览器：由 entry.js 以 Web Worker 加载，搜索在后台线程；Worker 不可用时
 *     同一文件可在主线程按时间片运行（window.WeiqiAI）。
 *   - Node：module.exports 暴露 Session / searchSync，供自动化测试。
 *
 * 算法要点：
 *   - 快速棋盘（Int8Array + 预计算四邻接 + 增量提子），拒绝自杀与单劫。
 *   - PUCT 选择 + 先验（提子/逃子/打吃/连接/近手/三四线/中腹），先验由局部棋形计算。
 *   - 轻量随机模拟：优先提子/逃子，其次近手落子，最后全局随机；禁止填自己的眼。
 *   - 终局按中国数子法快速计分（不做死活判断，AI 只用于对弈）。
 *   - 三档棋力通过访问数/时间上限/探索系数/根候选数控制。AI 内部统一按中国规则评估。
 *
 * 本文件为自研实现；MCTS + PUCT 属公开算法（AlphaGo/AlphaZero 论文与 KataGo 文档中的通用做法），
 * 未复制任何第三方代码。界面与交互参考见应用 README「出处与致谢」。
 */
(function (global) {
  'use strict';

  var EMPTY = 0;
  var BLACK = 1;
  var WHITE = 2;

  var LEVELS = {
    1: { visits: 360, timeMs: 400, c: 1.7, rootK: 14, nodeK: 9, temp: 0.22, random: 14 },
    2: { visits: 1600, timeMs: 1200, c: 1.4, rootK: 26, nodeK: 12, temp: 0, random: 6 },
    3: { visits: 7000, timeMs: 3400, c: 1.2, rootK: 42, nodeK: 14, temp: 0, random: 3 }
  };

  function now() {
    if (typeof performance !== 'undefined' && performance.now) return performance.now();
    return Date.now();
  }

  function makeNeighbors(size) {
    var flat = new Int32Array(size * size * 4);
    var i;
    for (i = 0; i < flat.length; i++) flat[i] = -1;
    for (var row = 0; row < size; row++) {
      for (var col = 0; col < size; col++) {
        var idx = row * size + col;
        var base = idx * 4;
        if (row > 0) flat[base] = idx - size;
        if (row < size - 1) flat[base + 1] = idx + size;
        if (col > 0) flat[base + 2] = idx - 1;
        if (col < size - 1) flat[base + 3] = idx + 1;
      }
    }
    return flat;
  }

  // ============ 快速棋盘 ============
  function FastBoard(size) {
    this.size = size;
    this.n = size * size;
    this.board = new Int8Array(this.n);
    this.ko = -1;
    this.empty = this.n;
    this.nb = makeNeighbors(size);
    this.mark = new Int32Array(this.n);
    this.libMark = new Int32Array(this.n);
    this.stack = new Int32Array(this.n);
    this.groupStones = new Int32Array(this.n);
    this.stamp = 0;
    this.gColor = 0;
    this.gStones = 0;
    this.gLibs = 0;
    this.gFirst = -1;
  }

  FastBoard.prototype.reset = function (source, ko, empty) {
    var i;
    if (source) {
      for (i = 0; i < this.n; i++) this.board[i] = source[i] || 0;
      if (empty === undefined) {
        var count = 0;
        for (i = 0; i < this.n; i++) if (this.board[i] === EMPTY) count++;
        this.empty = count;
      } else {
        this.empty = empty;
      }
    } else {
      for (i = 0; i < this.n; i++) this.board[i] = EMPTY;
      this.empty = this.n;
    }
    this.ko = ko === undefined ? -1 : ko;
  };

  FastBoard.prototype.clear = function () {
    for (var i = 0; i < this.n; i++) this.board[i] = EMPTY;
    this.empty = this.n;
    this.ko = -1;
  };

  FastBoard.prototype.analyze = function (start) {
    var board = this.board;
    var nb = this.nb;
    var mark = this.mark;
    var libMark = this.libMark;
    var stack = this.stack;
    var stones = this.groupStones;
    var color = board[start];
    var stamp = ++this.stamp;
    var top = 0;
    var count = 0;
    var libs = 0;
    var first = -1;
    stack[0] = start;
    mark[start] = stamp;
    while (top >= 0) {
      var point = stack[top--];
      stones[count++] = point;
      var base = point * 4;
      for (var k = 0; k < 4; k++) {
        var q = nb[base + k];
        if (q < 0) continue;
        var v = board[q];
        if (v === EMPTY) {
          if (libMark[q] !== stamp) {
            libMark[q] = stamp;
            libs += 1;
            if (first < 0) first = q;
          }
        } else if (v === color && mark[q] !== stamp) {
          mark[q] = stamp;
          stack[++top] = q;
        }
      }
    }
    this.gColor = color;
    this.gStones = count;
    this.gLibs = libs;
    this.gFirst = first;
  };

  // 不修改棋盘的合法性判断（自杀 / 单劫 / 占用）。
  FastBoard.prototype.isLegal = function (color, idx) {
    if (idx < 0 || idx >= this.n) return false;
    var board = this.board;
    if (board[idx] !== EMPTY) return false;
    if (idx === this.ko) return false;
    var nb = this.nb;
    var base = idx * 4;
    for (var k = 0; k < 4; k++) {
      var q = nb[base + k];
      if (q < 0) continue;
      var v = board[q];
      if (v === EMPTY) return true;
      if (v === color) {
        this.analyze(q);
        // 邻接己方棋块：还有别的气，或唯一气不是本点 → 落子后仍有气
        if (this.gLibs > 1 || (this.gLibs === 1 && this.gFirst !== idx)) return true;
      } else {
        this.analyze(q);
        if (this.gLibs === 1) return true; // 提子
      }
    }
    return false;
  };

  FastBoard.prototype.play = function (color, idx) {
    var board = this.board;
    var nb = this.nb;
    var opp = color === BLACK ? WHITE : BLACK;
    board[idx] = color;
    this.empty -= 1;
    var captured = 0;
    var capturedPoint = -1;
    var base = idx * 4;
    for (var k = 0; k < 4; k++) {
      var q = nb[base + k];
      if (q < 0) continue;
      if (board[q] !== opp) continue;
      this.analyze(q);
      if (this.gLibs === 0) {
        var count = this.gStones;
        var i;
        for (i = 0; i < count; i++) board[this.groupStones[i]] = EMPTY;
        this.empty += count;
        captured += count;
        if (count === 1) capturedPoint = this.groupStones[0];
      }
    }
    this.analyze(idx);
    var newKo = -1;
    if (captured === 1 && this.gStones === 1 && this.gLibs === 1) newKo = capturedPoint;
    this.ko = newKo;
    return captured;
  };

  FastBoard.prototype.playPass = function () {
    this.ko = -1;
  };

  // 眼形：四邻（含边界）全为己方。假眼也按眼处理（只用于模拟与先验，不参与正式判定）。
  FastBoard.prototype.isEyeLike = function (color, idx) {
    var nb = this.nb;
    var board = this.board;
    var base = idx * 4;
    for (var k = 0; k < 4; k++) {
      var q = nb[base + k];
      if (q < 0) continue;
      if (board[q] !== color) return false;
    }
    return true;
  };

  // 自打吃检测：落子后己方棋块只剩 1 口气、且没有提子。用于过滤明显的废棋。
  FastBoard.prototype.isSelfAtari = function (color, idx) {
    var nb = this.nb;
    var board = this.board;
    var base = idx * 4;
    var hasOwn = false;
    for (var k = 0; k < 4; k++) {
      var q = nb[base + k];
      if (q < 0) continue;
      var v = board[q];
      if (v === EMPTY) return false;
      if (v === color) {
        hasOwn = true;
        this.analyze(q);
        if (this.gLibs > 1 || (this.gLibs === 1 && this.gFirst !== idx)) return false;
      } else {
        this.analyze(q);
        if (this.gLibs === 1) return false; // 能提子
      }
    }
    return hasOwn;
  };

  FastBoard.prototype.countStones = function () {
    return this.n - this.empty;
  };

  // ============ 快速数子（中国规则，静态） ============
  function Scorer(size) {
    this.size = size;
    this.n = size * size;
    this.nb = makeNeighbors(size);
    this.visited = new Int32Array(this.n);
    this.stamp = 0;
    this.stack = new Int32Array(this.n);
  }

  Scorer.prototype.diff = function (board, komi) {
    var n = this.n;
    var nb = this.nb;
    var visited = this.visited;
    var stack = this.stack;
    var stamp = ++this.stamp;
    var blackStones = 0;
    var whiteStones = 0;
    var blackTerritory = 0;
    var whiteTerritory = 0;
    var i;
    for (i = 0; i < n; i++) {
      if (board[i] === BLACK) blackStones += 1;
      else if (board[i] === WHITE) whiteStones += 1;
    }
    for (i = 0; i < n; i++) {
      if (board[i] !== EMPTY || visited[i] === stamp) continue;
      var top = 0;
      stack[0] = i;
      visited[i] = stamp;
      var region = 0;
      var hasBlack = false;
      var hasWhite = false;
      while (top >= 0) {
        var point = stack[top--];
        region += 1;
        var base = point * 4;
        for (var k = 0; k < 4; k++) {
          var q = nb[base + k];
          if (q < 0) continue;
          var v = board[q];
          if (v === EMPTY) {
            if (visited[q] !== stamp) {
              visited[q] = stamp;
              stack[++top] = q;
            }
          } else if (v === BLACK) hasBlack = true;
          else if (v === WHITE) hasWhite = true;
        }
      }
      if (hasBlack && !hasWhite) blackTerritory += region;
      else if (hasWhite && !hasBlack) whiteTerritory += region;
    }
    return blackStones + blackTerritory - (whiteStones + whiteTerritory + komi);
  };

  // ============ 先验与候选生成 ============
  function isStarPoint(size, row, col) {
    var line = size >= 13 ? 3 : 2;
    var mid = (size - 1) / 2;
    if (mid % 1 !== 0) return false;
    var lines = [line, size - 1 - line, mid];
    return lines.indexOf(row) !== -1 && lines.indexOf(col) !== -1;
  }

  function computePrior(fb, color, idx, lastMove, moveCount, randomness) {
    var board = fb.board;
    var nb = fb.nb;
    var opp = color === BLACK ? WHITE : BLACK;
    var prior = 10;
    var connect = false;
    var save = false;
    var atari = false;
    var capture = 0;
    var base = idx * 4;
    for (var k = 0; k < 4; k++) {
      var q = nb[base + k];
      if (q < 0) continue;
      var v = board[q];
      if (v === EMPTY) continue;
      if (v === color) {
        connect = true;
        fb.analyze(q);
        if (fb.gLibs === 1) save = true;
      } else {
        fb.analyze(q);
        if (fb.gLibs === 1) capture += fb.gStones;
        else if (fb.gLibs === 2) atari = true;
      }
    }
    if (capture > 0) prior += 760 + capture * 80;
    if (save) prior += 470;
    if (atari) prior += 150;
    if (connect) prior += 60;

    var size = fb.size;
    var row = (idx / size) | 0;
    var col = idx % size;
    var edge = row < col ? row : col;
    var d2 = size - 1 - row;
    if (d2 < edge) edge = d2;
    d2 = size - 1 - col;
    if (d2 < edge) edge = d2;
    var early = (moveCount || 0) < 20;
    if (early) {
      // 开盘先占星位/三四线，避免一上来就下在一路、二路。
      if (edge === 0) prior -= 55;
      else if (edge === 1) prior -= 10;
      else if (edge === 2 || edge === 3) prior += 34;
      if (isStarPoint(size, row, col)) prior += 65;
    } else {
      if (edge === 0) prior -= 18;
      else if (edge === 2 || edge === 3) prior += 20;
      else if (edge === 1) prior += 4;
    }

    if (lastMove >= 0) {
      var lr = (lastMove / size) | 0;
      var lc = lastMove % size;
      var ldr = row - lr;
      var ldc = col - lc;
      if (ldr < 0) ldr = -ldr;
      if (ldc < 0) ldc = -ldc;
      var ldist = ldr > ldc ? ldr : ldc;
      if (ldist === 1) prior += 58;
      else if (ldist === 2) prior += 30;
      else if (ldist === 3) prior += 10;
    }

    prior += Math.random() * (randomness === undefined ? 8 : randomness);
    return prior;
  }

  function createNearMask(fb, lastMove) {
    var mask = new Uint8Array(fb.n);
    var i;
    for (i = 0; i < fb.n; i++) {
      if (fb.board[i] === EMPTY) continue;
      mask[i] = 1;
      var row = (i / fb.size) | 0;
      var col = i % fb.size;
      for (var dr = -2; dr <= 2; dr++) {
        for (var dc = -2; dc <= 2; dc++) {
          var r = row + dr;
          var c = col + dc;
          if (r < 0 || c < 0 || r >= fb.size || c >= fb.size) continue;
          mask[r * fb.size + c] = 1;
        }
      }
    }
    if (lastMove >= 0) {
      var lr = (lastMove / fb.size) | 0;
      var lc = lastMove % fb.size;
      for (var ar = -4; ar <= 4; ar++) {
        for (var ac = -4; ac <= 4; ac++) {
          var rr = lr + ar;
          var cc = lc + ac;
          if (rr < 0 || cc < 0 || rr >= fb.size || cc >= fb.size) continue;
          mask[rr * fb.size + cc] = 1;
        }
      }
    }
    return mask;
  }

  function generateCandidates(fb, color, options) {
    var size = fb.size;
    var n = fb.n;
    var board = fb.board;
    var recency = options.recency || 0;
    var lastMove = options.lastMove === undefined ? -1 : options.lastMove;
    var avoid = options.avoid;
    var near = null;
    if (options.filter !== false && recency > 14 && fb.empty > 70) near = createNearMask(fb, lastMove);

    var candidates = [];
    var idx;
    for (idx = 0; idx < n; idx++) {
      if (board[idx] !== EMPTY) continue;
      if (idx === fb.ko) continue;
      if (avoid && avoid[idx]) continue;
      if (near && !near[idx]) continue;
      if (!fb.isLegal(color, idx)) continue;
      if (fb.isEyeLike(color, idx)) continue;
      if (fb.isSelfAtari(color, idx)) continue;
      candidates.push({ idx: idx, prior: computePrior(fb, color, idx, lastMove, recency, options.random) });
    }

    candidates.sort(function (a, b) { return b.prior - a.prior; });
    var cap = options.cap || 20;
    if (candidates.length > cap) candidates.length = cap;
    var total = 0;
    for (var i = 0; i < candidates.length; i++) total += candidates[i].prior;
    for (var j = 0; j < candidates.length; j++) {
      candidates[j].prior = total > 0 ? candidates[j].prior / total : 1 / candidates.length;
    }
    return candidates;
  }

  // ============ MCTS ============
  function Node(move, color, board, ko, passes, toMove, lastMove, empty, moveCount, prior) {
    this.move = move;
    this.color = color;
    this.board = board;
    this.ko = ko;
    this.passes = passes;
    this.toMove = toMove;
    this.lastMove = lastMove;
    this.empty = empty;
    this.moveCount = moveCount;
    this.prior = prior || 0;
    this.visits = 0;
    this.wins = 0;
    this.children = [];
    this.untried = null;
    this.next = 0;
  }

  function selectChild(node, c) {
    var children = node.children;
    var best = children[0];
    var bestValue = -1e9;
    var sqrtVisits = Math.sqrt(node.visits + 1);
    for (var i = 0; i < children.length; i++) {
      var child = children[i];
      var q = child.visits > 0 ? child.wins / child.visits : -0.35;
      var u = c * child.prior * sqrtVisits / (1 + child.visits);
      var value = q + u;
      if (value > bestValue) {
        bestValue = value;
        best = child;
      }
    }
    return best;
  }

  // 开局手册：第一手占天元/星位，第二手占离对手最远的星位，避免开局下在一路或乱飞。
  function findOpeningMove(board, size, moveCount) {
    if (moveCount > 1) return null;
    var line = size >= 13 ? 3 : 2;
    var mid = (size - 1) / 2;
    if (mid % 1 !== 0) return null;
    mid = mid | 0;
    var points;
    if (size <= 9) {
      points = [
        [mid, mid],
        [line, line], [line, size - 1 - line],
        [size - 1 - line, line], [size - 1 - line, size - 1 - line]
      ];
    } else {
      points = [
        [line, line], [line, size - 1 - line],
        [size - 1 - line, line], [size - 1 - line, size - 1 - line],
        [line, mid], [mid, line], [size - 1 - line, mid], [mid, size - 1 - line],
        [mid, mid]
      ];
    }
    var stones = [];
    var i;
    for (i = 0; i < board.length; i++) if (board[i] !== EMPTY) stones.push(i);
    if (moveCount === 0) {
      for (i = 0; i < points.length; i++) {
        var idx0 = points[i][0] * size + points[i][1];
        if (board[idx0] === EMPTY) {
          return { row: points[i][0], col: points[i][1], reason: 'opening' };
        }
      }
      return null;
    }
    if (stones.length !== 1) return null;
    var oppRow = (stones[0] / size) | 0;
    var oppCol = stones[0] % size;
    var best = null;
    var bestDist = -1;
    for (i = 0; i < points.length; i++) {
      var r = points[i][0];
      var c = points[i][1];
      if (board[r * size + c] !== EMPTY) continue;
      var dr = r - oppRow;
      var dc = c - oppCol;
      if (dr < 0) dr = -dr;
      if (dc < 0) dc = -dc;
      var dist = dr + dc;
      if (dist > bestDist) {
        bestDist = dist;
        best = { row: r, col: c, reason: 'opening' };
      }
    }
    return best;
  }

  // 根节点战术：大提子 / 救回被打吃的大块。明显的棋直接下，不再花时间搜索。
  function findTacticalMove(board, size, color, ko, empty) {
    var fb = new FastBoard(size);
    fb.reset(board, ko, empty);
    var opp = color === BLACK ? WHITE : BLACK;
    var n = fb.n;
    var seen = new Uint8Array(n);
    var i;
    var j;
    var bestCapture = -1;
    var bestCaptureSize = 0;
    for (i = 0; i < n; i++) {
      if (seen[i] || fb.board[i] !== opp) continue;
      fb.analyze(i);
      var libs = fb.gLibs;
      var first = fb.gFirst;
      var stones = fb.gStones;
      for (j = 0; j < stones; j++) seen[fb.groupStones[j]] = 1;
      if (libs === 1 && first >= 0 && first !== ko && fb.isLegal(color, first)) {
        if (stones > bestCaptureSize) {
          bestCaptureSize = stones;
          bestCapture = first;
        }
      }
    }
    if (bestCapture >= 0 && bestCaptureSize >= 2) {
      var test = new FastBoard(size);
      test.reset(board, ko, empty);
      test.play(color, bestCapture);
      test.analyze(bestCapture);
      if (test.gLibs >= 2) {
        return { row: (bestCapture / size) | 0, col: bestCapture % size, reason: 'capture' };
      }
    }

    seen = new Uint8Array(n);
    var bestSave = -1;
    var bestSaveSize = 0;
    for (i = 0; i < n; i++) {
      if (seen[i] || fb.board[i] !== color) continue;
      fb.analyze(i);
      var libs2 = fb.gLibs;
      var first2 = fb.gFirst;
      var stones2 = fb.gStones;
      for (j = 0; j < stones2; j++) seen[fb.groupStones[j]] = 1;
      if (libs2 === 1 && first2 >= 0 && first2 !== ko && stones2 >= 3 &&
          fb.isLegal(color, first2) && !fb.isSelfAtari(color, first2) &&
          stones2 > bestSaveSize) {
        var test2 = new FastBoard(size);
        test2.reset(board, ko, empty);
        test2.play(color, first2);
        test2.analyze(first2);
        if (test2.gLibs >= 2) {
          bestSaveSize = stones2;
          bestSave = first2;
        }
      }
    }
    if (bestSave >= 0) {
      return { row: (bestSave / size) | 0, col: bestSave % size, reason: 'save' };
    }
    return null;
  }

  function Session(request) {
    request = request || {};
    var size = Number(request.size) || 9;
    if (size < 2) size = 2;
    if (size > 25) size = 25;
    var level = Number(request.level) || 2;
    var cfg = LEVELS[level] || LEVELS[2];
    var areaScale = Math.pow((9 * 9) / (size * size), 0.45);
    if (areaScale > 1) areaScale = 1;
    this.id = request.id;
    this.size = size;
    this.n = size * size;
    this.komi = request.komi === undefined ? 7.5 : Number(request.komi);
    this.color = request.turn === WHITE || request.turn === 'white' ? WHITE : BLACK;
    this.level = level;
    this.cfg = {
      visits: Math.max(40, Math.round(cfg.visits * areaScale)),
      // 大棋盘单次搜索更慢，压低时间上限，避免「电脑思考」体感过久。
      timeMs: Math.min(size >= 19 ? 1800 : size >= 13 ? 2200 : 2400, cfg.timeMs * (areaScale < 0.65 ? 1.25 : 1)),
      c: cfg.c,
      rootK: cfg.rootK,
      nodeK: cfg.nodeK,
      temp: cfg.temp,
      random: cfg.random === undefined ? 8 : cfg.random
    };
    this.start = now();
    this.visits = 0;
    this.done = false;
    this.scratch = new FastBoard(size);
    this.scorer = new Scorer(size);
    this.avoid = {};
    if (request.avoid && request.avoid.length) {
      for (var a = 0; a < request.avoid.length; a++) this.avoid[request.avoid[a]] = true;
    }

    var board = new Int8Array(this.n);
    var provided = request.board;
    var i;
    for (i = 0; i < this.n; i++) {
      var v = provided && provided[i] !== undefined ? Number(provided[i]) : 0;
      board[i] = v === BLACK || v === WHITE ? v : EMPTY;
    }
    var empty = 0;
    for (i = 0; i < this.n; i++) if (board[i] === EMPTY) empty += 1;
    this.root = new Node(
      -1,
      0,
      board,
      request.koPoint === undefined ? -1 : Number(request.koPoint),
      Number(request.passes) || 0,
      this.color,
      request.lastMove === undefined ? -1 : Number(request.lastMove),
      empty,
      Number(request.moveCount) || 0,
      1
    );
    // 明显的战术棋（大提子 / 救回大块）直接定手，不再花时间搜索。
    var opening = findOpeningMove(this.root.board, size, this.root.moveCount);
    this.forced = opening || findTacticalMove(this.root.board, this.size, this.color, this.root.ko, this.root.empty);
    if (this.forced) this.done = true;
  }

  Session.prototype.staticLead = function (board) {
    return this.scorer.diff(board, this.komi);
  };

  Session.prototype.bestWinrate = function () {
    var children = this.root.children;
    var best = null;
    var bestVisits = -1;
    for (var i = 0; i < children.length; i++) {
      if (children[i].visits > bestVisits) {
        bestVisits = children[i].visits;
        best = children[i];
      }
    }
    if (!best || !best.visits) return 0.5;
    return best.wins / best.visits;
  };

  Session.prototype.rootPassCandidate = function () {
    var late = this.root.empty < this.n * 0.25;
    return { idx: -1, prior: this.root.passes >= 1 ? (late ? 0.55 : 0.02) : this.root.empty < 40 ? 0.06 : 0.005 };
  };

  Session.prototype.expandNode = function (node, isRoot) {
    var color = node.toMove;
    var fb = this.scratch;
    fb.reset(node.board, node.ko, node.empty);
    var list = generateCandidates(fb, color, {
      lastMove: node.lastMove,
      recency: node.moveCount,
      avoid: this.avoid,
      cap: isRoot ? this.cfg.rootK : this.cfg.nodeK,
      filter: true,
      random: this.cfg.random
    });
    if (isRoot || node.passes >= 1 || node.empty < 60) {
      var pass = this.rootPassCandidate();
      if (!isRoot) pass.prior = node.passes >= 1 ? (node.empty < this.n * 0.25 ? 0.5 : 0.02) : 0.04;
      list.push(pass);
      var total = 0;
      var i;
      for (i = 0; i < list.length; i++) total += list[i].prior;
      for (i = 0; i < list.length; i++) list[i].prior = total > 0 ? list[i].prior / total : 1 / list.length;
    }
    node.untried = list;
    node.next = 0;
  };

  Session.prototype.makeChild = function (node, candidate) {
    var fb = this.scratch;
    fb.reset(node.board, node.ko, node.empty);
    var board;
    var ko = -1;
    var empty = node.empty;
    var passes = 0;
    var lastMove = -1;
    var moveCount = node.moveCount + 1;
    if (candidate.idx < 0) {
      board = node.board;
      ko = -1;
      passes = node.passes + 1;
      lastMove = -1;
    } else {
      var captured = fb.play(node.toMove, candidate.idx);
      board = new Int8Array(fb.board);
      ko = fb.ko;
      empty = fb.empty;
      passes = 0;
      lastMove = candidate.idx;
      if (captured < 0) captured = 0;
    }
    var child = new Node(
      candidate.idx,
      node.toMove,
      board,
      ko,
      passes,
      node.toMove === BLACK ? WHITE : BLACK,
      lastMove,
      empty,
      moveCount,
      candidate.prior
    );
    return child;
  };

  Session.prototype.choosePlayoutMove = function (fb, color, lastMove, passes) {
    var size = fb.size;
    var n = fb.n;
    var board = fb.board;
    var nb = fb.nb;
    var i;
    var k;
    var q;

    // 对手刚停一手：只有进入后盘（空点少于 25%）才用静态面积判断是否跟停。
    // 开局/中盘空区很大，静态面积会把「一块空地」误算成巨大领先，不能据此停手。
    if (passes >= 1 && fb.empty < this.n * 0.25) {
      var diff = this.scorer.diff(board, this.komi);
      var lead = color === BLACK ? diff : -diff;
      if (lead > 0 && Math.random() < 0.88) return -1;
    }

    // 提子 / 逃子：围绕最后一手局部处理
    if (lastMove >= 0) {
      var base = lastMove * 4;
      for (k = 0; k < 4; k++) {
        q = nb[base + k];
        if (q < 0) continue;
        var v = board[q];
        if (v === EMPTY || v === color) continue;
        fb.analyze(q);
        if (fb.gLibs === 1) {
          var capturePoint = fb.gFirst;
          if (capturePoint >= 0 && fb.isLegal(color, capturePoint) && Math.random() < 0.78) return capturePoint;
        }
      }
      for (k = 0; k < 4; k++) {
        q = nb[base + k];
        if (q < 0) continue;
        if (board[q] !== color) continue;
        fb.analyze(q);
        if (fb.gLibs === 1) {
          var savePoint = fb.gFirst;
          if (savePoint >= 0 && fb.isLegal(color, savePoint) && !fb.isSelfAtari(color, savePoint) && Math.random() < 0.55) return savePoint;
        }
      }
    }

    // 近手随机
    if (lastMove >= 0) {
      var lr = (lastMove / size) | 0;
      var lc = lastMove % size;
      for (i = 0; i < 10; i++) {
        var rr = lr + ((Math.random() * 7) | 0) - 3;
        var cc = lc + ((Math.random() * 7) | 0) - 3;
        if (rr < 0 || cc < 0 || rr >= size || cc >= size) continue;
        var point = rr * size + cc;
        if (board[point] !== EMPTY) continue;
        if (point === fb.ko) continue;
        if (fb.isEyeLike(color, point)) continue;
        if (fb.isSelfAtari(color, point)) continue;
        if (fb.isLegal(color, point)) return point;
      }
    }

    // 全局随机（避开自己的眼）
    for (i = 0; i < 42; i++) {
      var p = (Math.random() * n) | 0;
      if (board[p] !== EMPTY) continue;
      if (p === fb.ko) continue;
      if (fb.isEyeLike(color, p)) continue;
      if (fb.isSelfAtari(color, p)) continue;
      if (fb.isLegal(color, p)) return p;
    }

    // 兜底：允许填眼（必须应一手时）
    for (i = 0; i < 60; i++) {
      var p2 = (Math.random() * n) | 0;
      if (board[p2] !== EMPTY) continue;
      if (p2 === fb.ko) continue;
      if (fb.isLegal(color, p2)) return p2;
    }
    for (i = 0; i < n; i++) {
      if (board[i] !== EMPTY) continue;
      if (i === fb.ko) continue;
      if (fb.isLegal(color, i)) return i;
    }
    return -1;
  };

  Session.prototype.playout = function (node) {
    var fb = this.scratch;
    fb.reset(node.board, node.ko, node.empty);
    var color = node.toMove;
    var passes = node.passes;
    var lastMove = node.lastMove;
    // 大棋盘随机模拟过长会拖慢搜索；截断到 240 手，把预算换成更多次模拟。
    var limit = this.size >= 19 ? 240 : this.size >= 13 ? 360 : this.n * 2;
    var step;
    for (step = 0; step < limit; step++) {
      var move = this.choosePlayoutMove(fb, color, lastMove, passes);
      if (move < 0) {
        fb.playPass();
        passes += 1;
        color = color === BLACK ? WHITE : BLACK;
        lastMove = -1;
        if (passes >= 2) break;
      } else {
        fb.play(color, move);
        passes = 0;
        lastMove = move;
        color = color === BLACK ? WHITE : BLACK;
      }
    }
    return this.scorer.diff(fb.board, this.komi);
  };

  Session.prototype.backprop = function (node, diff) {
    var winner = diff > 0 ? BLACK : diff < 0 ? WHITE : 0;
    while (node) {
      node.visits += 1;
      if (node.color === winner) node.wins += 1;
      else if (node.color !== 0 && winner === 0) node.wins += 0.5;
      node = node.parent;
    }
  };

  Session.prototype.simulate = function () {
    var node = this.root;
    // 选择
    while (node.untried !== null && node.next >= node.untried.length && node.children.length) {
      node = selectChild(node, this.cfg.c);
    }
    // 终局
    if (node.passes >= 2) {
      var terminalDiff = this.scorer.diff(node.board, this.komi);
      this.backprop(node, terminalDiff);
      return;
    }
    if (!node.untried) this.expandNode(node, node === this.root);
    if (node.next < node.untried.length) {
      var candidate = node.untried[node.next++];
      var child = this.makeChild(node, candidate);
      child.parent = node;
      node.children.push(child);
      node = child;
    }
    var diff = this.playout(node);
    this.backprop(node, diff);
  };

  Session.prototype.run = function (maxVisits) {
    var target = this.visits + (maxVisits || 64);
    if (target > this.cfg.visits) target = this.cfg.visits;
    var checkEvery = 8;
    while (this.visits < target && !this.done) {
      if ((this.visits & (checkEvery - 1)) === 0 && now() - this.start >= this.cfg.timeMs) {
        this.done = true;
        break;
      }
      this.simulate();
      this.visits += 1;
    }
    if (this.visits >= this.cfg.visits) this.done = true;
    if (now() - this.start >= this.cfg.timeMs) this.done = true;
    return this.done;
  };

  // 主线程兼容模式专用：按时间片推进，每片控制在 budgetMs 内，避免长任务冻结触屏界面。
  Session.prototype.runSlice = function (budgetMs) {
    var sliceStart = now();
    var guard = 0;
    while (!this.done && guard < 100000) {
      this.simulate();
      this.visits += 1;
      guard += 1;
      if (this.visits >= this.cfg.visits) {
        this.done = true;
        break;
      }
      if (now() - this.start >= this.cfg.timeMs) {
        this.done = true;
        break;
      }
      if (now() - sliceStart >= budgetMs) break;
    }
    if (this.visits >= this.cfg.visits) this.done = true;
    if (now() - this.start >= this.cfg.timeMs) this.done = true;
    return this.done;
  };

  Session.prototype.result = function () {
    var root = this.root;
    if (this.forced) {
      var forcedLead = this.staticLead(root.board);
      return {
        move: { row: this.forced.row, col: this.forced.col },
        pass: false,
        visits: Math.max(1, this.visits),
        winrate: 0.62,
        scoreLead: this.color === BLACK ? forcedLead : -forcedLead,
        elapsed: now() - this.start,
        candidates: [{
          row: this.forced.row,
          col: this.forced.col,
          visits: Math.max(1, this.visits),
          winrate: 0.62
        }],
        tactical: this.forced.reason
      };
    }
    if (!root.untried) this.expandNode(root, true);
    var children = root.children;
    var best = null;
    var bestVisits = -1;
    var i;
    for (i = 0; i < children.length; i++) {
      if (children[i].visits > bestVisits) {
        bestVisits = children[i].visits;
        best = children[i];
      }
    }
    if (!best) {
      // 没有任何候选（棋盘已满）：停一手
      var lead0 = this.staticLead(root.board);
      return {
        move: null,
        pass: true,
        visits: this.visits,
        winrate: 0.5,
        scoreLead: this.color === BLACK ? lead0 : -lead0,
        elapsed: now() - this.start,
        candidates: []
      };
    }

    // 低难度：以一定概率选择次优着法，避免每局完全一致。
    if (this.cfg.temp > 0 && children.length > 1 && Math.random() < this.cfg.temp) {
      var sorted = children.slice().sort(function (a, b) { return b.visits - a.visits; });
      var second = null;
      for (i = 1; i < sorted.length; i++) {
        if (sorted[i].move >= 0 && sorted[i].visits >= sorted[0].visits * 0.3) {
          second = sorted[i];
          break;
        }
      }
      if (second && Math.random() < 0.5) best = second;
    }

    // 开局/中盘不因静态面积误判而停一手：改选访问数最高的非停一手候选。
    if (best && best.move < 0 && this.root.empty > this.n * 0.25) {
      var alt = null;
      var altVisits = -1;
      for (i = 0; i < children.length; i++) {
        if (children[i].move >= 0 && children[i].visits > altVisits) {
          altVisits = children[i].visits;
          alt = children[i];
        }
      }
      if (alt) best = alt;
    }

    var move = null;
    var pass = false;
    if (best.move < 0) {
      pass = true;
    } else {
      var row = (best.move / this.size) | 0;
      var col = best.move % this.size;
      // 最后再用快速棋盘验证一次，避免搜索过程中任何偏差产生非法着法。
      var verify = new FastBoard(this.size);
      verify.reset(root.board, root.ko, root.empty);
      if (verify.isLegal(this.color, best.move)) {
        move = { row: row, col: col };
      } else {
        for (i = 0; i < children.length; i++) {
          if (children[i].move >= 0 && verify.isLegal(this.color, children[i].move)) {
            move = { row: (children[i].move / this.size) | 0, col: children[i].move % this.size };
            break;
          }
        }
        if (!move) pass = true;
      }
    }

    var winrate = best.visits > 0 ? best.wins / best.visits : 0.5;
    var candidates = [];
    for (i = 0; i < children.length; i++) {
      if (children[i].move < 0) continue;
      candidates.push({
        row: (children[i].move / this.size) | 0,
        col: children[i].move % this.size,
        visits: children[i].visits,
        winrate: children[i].visits ? children[i].wins / children[i].visits : 0
      });
    }
    candidates.sort(function (a, b) { return b.visits - a.visits; });
    if (candidates.length > 5) candidates.length = 5;
    var lead = this.staticLead(this.root.board);
    return {
      move: move,
      pass: pass,
      visits: this.visits,
      winrate: winrate,
      scoreLead: this.color === BLACK ? lead : -lead,
      elapsed: now() - this.start,
      candidates: candidates
    };
  };

  // 对方刚停一手且自己形势领先：直接停一手结束，避免无谓续弈。
  // 只在后盘生效，避免开局对手误停时 AI 也跟着停、把棋局草草结束。
  Session.prototype.shouldPassImmediately = function () {
    if (this.root.passes < 1) return false;
    if (this.root.empty <= 0) return true;
    if (this.root.empty > this.n * 0.25) return false;
    var diff = this.staticLead(this.root.board);
    var lead = this.color === BLACK ? diff : -diff;
    return lead > 0.5;
  };

  function searchSync(request) {
    var session = new Session(request);
    if (session.shouldPassImmediately()) {
      var lead = session.staticLead(session.root.board);
      return {
        move: null,
        pass: true,
        visits: 0,
        winrate: 0.9,
        scoreLead: session.color === BLACK ? lead : -lead,
        elapsed: 0,
        candidates: []
      };
    }
    while (!session.done) session.run(256);
    return session.result();
  }

  // ============ 浏览器 / Worker 适配 ============
  // 本文件在 Worker 与主线程都可能被加载，但**不自己使用定时器**：
  //   - Worker 侧同步跑完一次搜索（取消由主线程 terminate），过程性 postMessage 仍能让主线程收到进度；
  //   - 主线程降级由 entry.js 用 Session 分片调度，计时器的回收登记在宿主 onDestroy 上。
  var IS_WORKER = typeof importScripts === 'function';

  function immediatePassResult(session) {
    var lead = session.staticLead(session.root.board);
    return {
      move: null,
      pass: true,
      visits: 0,
      winrate: 0.9,
      scoreLead: session.color === BLACK ? lead : -lead,
      elapsed: 0,
      candidates: []
    };
  }

  if (IS_WORKER) {
    global.onmessage = function (event) {
      var message = event.data || {};
      if (message.type !== 'genmove') return;
      var id = message.id;
      try {
        var session = new Session(message);
        if (session.shouldPassImmediately()) {
          global.postMessage({ type: 'result', id: id, result: immediatePassResult(session) });
          return;
        }
        var lastReport = 0;
        // 硬截止时间：即使内部出现异常慢的局面，也必须把当前最优着法回传，
        // 不能把主线程永远留在「AI 思考中」。
        var deadline = now() + session.cfg.timeMs + 2000;
        while (!session.done && now() < deadline) {
          session.run(192);
          if (session.visits - lastReport >= 192) {
            lastReport = session.visits;
            global.postMessage({
              type: 'progress',
              id: id,
              visits: session.visits,
              total: session.cfg.visits,
              elapsed: now() - session.start,
              winrate: session.bestWinrate()
            });
          }
        }
        global.postMessage({ type: 'result', id: id, result: session.result() });
      } catch (e) {
        global.postMessage({ type: 'error', id: id, message: (e && e.message) || 'engine error' });
      }
    };
  }

  var exported = {
    LEVELS: LEVELS,
    FastBoard: FastBoard,
    Scorer: Scorer,
    Session: Session,
    searchSync: searchSync
  };
  if (typeof module === 'object' && module.exports) module.exports = exported;
  if (global) global.WeiqiAICore = exported;
})(typeof self !== 'undefined' ? self : typeof window !== 'undefined' ? window : typeof global !== 'undefined' ? global : null);
