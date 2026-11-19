/*
 * 围棋 —— 整盘复盘后台任务
 *
 * 需求：对局结束后复盘自动在服务器后台跑，用户可以退出应用去下别的棋，
 * 回来时结果已经算好。所以复盘不能挂在前端逐手循环上（页面一关就断），
 * 必须由服务端持有任务、逐手推进、进度落库。
 *
 * 设计：
 *   - 任务以「着法序列的哈希」为幂等键存 weiqi_reviews 表：
 *     同一局重复触发不会重算，服务器重启后已完成的结果仍在。
 *   - 内存队列串行执行，同一时刻只跑一个任务，避免把引擎打满。
 *   - 每手分析前先等引擎完全空闲（engine.idle()）：学生正在对局时
 *     AI 应手永远优先，复盘只在引擎没人用的时候推进。
 *   - 进度每手落库一次，前端轮询即可看到 done/total。
 */
'use strict';

var crypto = require('crypto');
var path = require('path');

var host = require('_sdk/backend/host');
var db = host.db;

var Shared = require('./ai-shared');
var aiEngine = require('./engine');

var MAX_PENDING = 20;          // 排队上限，防止被灌爆
var MAX_MOVES = 400;           // 单局手数上限（19 路 2×361+10 已含在内）

db.exec("CREATE TABLE IF NOT EXISTS weiqi_reviews (" +
  " key TEXT PRIMARY KEY," +
  " status TEXT NOT NULL DEFAULT 'queued'," +   // queued / running / done / error
  " progress INTEGER NOT NULL DEFAULT 0," +
  " total INTEGER NOT NULL DEFAULT 0," +
  " data TEXT," +                               // done 时：{ positions, results, summary }
  " error TEXT," +
  " created_at TEXT DEFAULT (datetime('now'))," +
  " updated_at TEXT DEFAULT (datetime('now'))" +
  ")");

// 服务器重启会把内存队列清空，表里残留的 running 任务永远不会再推进。
// ⚠️ 但 classintra-server 与 classintra-https 是两个独立进程、共用这张表：
// 任何一个进程启动时都不能把「另一个进程正在跑的任务」误杀，
// 所以只清理超过 10 分钟没有更新的陈旧任务（活跃任务每手都会 touch）。
try {
  db.prepare(
    "UPDATE weiqi_reviews SET status = 'error', error = '服务器重启，请重新开始复盘', updated_at = datetime('now') " +
    "WHERE status IN ('queued','running') AND updated_at < datetime('now', '-10 minutes')"
  ).run();
} catch (e) {}

var queue = [];
var running = false;

function reviewKey(input) {
  var norm = {
    size: Number(input.size),
    komi: Number(input.komi),
    handicap: Number(input.handicap),
    turn: Number(input.turn) || 0,
    setup: (input.setup || []).map(function (s) { return [Number(s.color), Number(s.row), Number(s.col)]; }),
    moves: (input.moves || []).map(function (m) { return [Number(m.color), m.pass ? -1 : Number(m.row), m.pass ? -1 : Number(m.col)]; })
  };
  return crypto.createHash('sha1').update(JSON.stringify(norm)).digest('hex').slice(0, 24);
}

function rowOf(key) {
  return db.prepare('SELECT * FROM weiqi_reviews WHERE key = ?').get(key);
}

function touch(key, fields) {
  var sets = ['updated_at = datetime(\'now\')'];
  var args = [];
  for (var k in fields) {
    if (!Object.prototype.hasOwnProperty.call(fields, k)) continue;
    sets.push(k + ' = ?');
    args.push(fields[k]);
  }
  args.push(key);
  // ⚠️ better-sqlite3 的 run 是原生绑定方法，this 必须是语句对象本身：
  // apply(null, ...) 会抛 "Illegal invocation"，直接带崩整个服务器进程。
  var stmt = db.prepare('UPDATE weiqi_reviews SET ' + sets.join(', ') + ' WHERE key = ?');
  stmt.run.apply(stmt, args);
}

// 幂等触发：done 直接复用，running/queued 返回当前进度，error/无记录则重建。
function startReview(input) {
  if (!aiEngine.available()) {
    var err = new Error('服务器未安装 KataGo 引擎或模型');
    err.code = 'UNAVAILABLE';
    throw err;
  }
  var moves = Array.isArray(input.moves) ? input.moves : [];
  if (moves.length < 10) {
    var tooShort = new Error('对局太短，不足 10 手，无需复盘');
    tooShort.code = 'TOO_SHORT';
    throw tooShort;
  }
  if (moves.length > MAX_MOVES) {
    var tooLong = new Error('着法数量异常');
    tooLong.code = 'TOO_LONG';
    throw tooLong;
  }
  // 先用完整序列做一次校验（buildAiQuery 会逐手重放，不合法直接抛错），
  // 避免任务排到一半才发现第 37 手非法、白烧前面的分析。
  Shared.buildAiQuery(input, 'review');

  var key = reviewKey(input);
  var row = rowOf(key);
  // ⚠️ server / https 是两个进程：DB 里的 running 可能是另一个进程正在推进
  // （正常），也可能是崩溃残留（永远没人推进）。用 updated_at 判定新鲜度：
  // 每手都会 touch，45 秒没更新就认为任务已死，重建重跑。
  if (row && (row.status === 'running' || row.status === 'queued')) {
    var fresh = false;
    try {
      fresh = !!db.prepare(
        "SELECT 1 AS f FROM weiqi_reviews WHERE key = ? AND updated_at >= datetime('now', '-45 seconds')"
      ).get(key);
    } catch (e) {}
    var inQueue = queue.some(function (t) { return t.key === key; });
    if (fresh || inQueue) {
      return {
        reviewId: key,
        status: row.status,
        progress: Number(row.progress) || 0,
        total: Number(row.total) || moves.length + 1
      };
    }
  }
  if (row && row.status === 'done') {
    return { reviewId: key, status: 'done', progress: Number(row.total) || moves.length + 1, total: Number(row.total) || moves.length + 1 };
  }
  if (queue.length >= MAX_PENDING) {
    var busy = new Error('复盘任务排队已满，请稍后再试');
    busy.code = 'BUSY';
    throw busy;
  }
  db.prepare(
    "INSERT OR REPLACE INTO weiqi_reviews (key, status, progress, total, data, error) VALUES (?, 'queued', 0, ?, NULL, NULL)"
  ).run(key, moves.length + 1);
  queue.push({ key: key, input: input });
  kick();
  return { reviewId: key, status: 'queued', progress: 0, total: moves.length + 1 };
}

function statusOf(reviewId) {
  var row = rowOf(String(reviewId || ''));
  if (!row) return null;
  var out = {
    reviewId: row.key,
    status: row.status,
    progress: Number(row.progress) || 0,
    total: Number(row.total) || 0
  };
  if (row.status === 'done' && row.data) {
    try { out.data = JSON.parse(row.data); } catch (e) { out.data = null; }
  }
  if (row.status === 'error') out.error = row.error || '复盘失败';
  return out;
}

function kick() {
  if (running) return;
  running = true;
  setTimeout(runNext, 0);
}

function runNext() {
  var task = queue.shift();
  if (!task) {
    running = false;
    return;
  }
  runTask(task).then(function () {
    runNext();
  }, function (e) {
    var message = e && e.message ? e.message : '复盘失败';
    console.error('[weiqi-review] task failed:', message);
    try {
      touch(task.key, { status: 'error', error: message });
    } catch (e2) {}
    runNext();
  });
}

function runTask(task) {
  var input = task.input;
  var moves = input.moves;
  var total = moves.length + 1;
  touch(task.key, { status: 'running', progress: 0, total: total, error: null });

  var positions = [];
  var chain = Promise.resolve();
  for (var i = 0; i < total; i++) {
    (function (idx) {
      chain = chain.then(function () {
        // 引擎让路：等它完全空闲再提交，学生正在对局时 AI 应手优先。
        return aiEngine.idle();
      }).then(function () {
        var prefix = [];
        for (var k = 0; k < idx; k++) {
          var m = moves[k];
          prefix.push({ color: m.color, row: m.row, col: m.col, pass: !!m.pass });
        }
        var built = Shared.buildAiQuery({
          size: input.size,
          komi: input.komi,
          handicap: input.handicap,
          turn: input.turn,
          setup: input.setup,
          moves: prefix,
          level: input.level
        }, 'review');
        return aiEngine.analyze(built.payload).then(function (raw) {
          var conv = Shared.convertAiResult(raw, built.size, {});
          positions[idx] = { blackWin: conv.blackWinrate, candidates: conv.candidates };
          touch(task.key, { progress: idx + 1 });
        });
      });
    })(i);
  }
  return chain.then(function () {
    var results = [];
    var summary = Shared.emptySummary();
    for (var m = 0; m < moves.length; m++) {
      var item = Shared.classifyReviewMove(m, positions[m], positions[m + 1], moves[m]);
      results[m] = item;
      if (summary[item.grade] !== undefined) summary[item.grade] += 1;
      else summary[item.grade] = 1;
    }
    touch(task.key, {
      status: 'done',
      progress: total,
      data: JSON.stringify({ positions: positions, results: results, summary: summary })
    });
  });
}

// 保留最近 KEEP 条已完成/失败的记录，防止表无限膨胀。
var KEEP = 200;
function prune() {
  try {
    db.prepare(
      "DELETE FROM weiqi_reviews WHERE key NOT IN (" +
      " SELECT key FROM weiqi_reviews ORDER BY updated_at DESC LIMIT ?)"
    ).run(KEEP);
  } catch (e) {}
}

module.exports = {
  startReview: startReview,
  statusOf: statusOf,
  prune: prune
};
