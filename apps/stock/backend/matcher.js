// 撮合器：定时驱动
// ============================================================
// 为什么要「轮询」而不是「事件驱动」：
// 买卖双方都是学生挂的单，没有真正的对手盘，成交依据是**市场最新价**。
// 所以撮合器要做的就是「拿最新价去比一遍所有挂单」——轮询是最直接的做法。
//
// 频率 3 秒，与行情缓存对齐；非交易时段降到 60 秒（只做清算）。
// 定时器挂在 global 上：市场应用支持热重载，模块被重新 require 时
// 不能留下第二个定时器（否则同一单会被并发撮合，虽然乐观锁能挡住，
// 但会白烧 CPU）。

var market = require('./market');
var quotes = require('./quotes');
var trading = require('./trading');
var report = require('./report');
var peer = require('./peer');

var TICK_MS = 3000;
var IDLE_TICK_MS = 60000;
var SIDE_TASK_MS = 60000;   // 报告生成 / 周结算这类低频杂务的检查间隔

var _timer = null;
var _busy = false;
var _lastIdle = 0;
var _lastSideTask = 0;
var _stats = { ticks: 0, filled: 0, expired: 0, lastTickAt: 0, lastError: null };

function tick() {
  if (_busy) return;
  var now = Date.now();
  var session = market.currentSession(now);

  // 低频杂务：收盘报告生成（内部判断收盘条件，幂等）+ 周五班级对决结算
  if (now - _lastSideTask > SIDE_TASK_MS) {
    _lastSideTask = now;
    try { report.ensureToday().catch(function () {}); } catch (e) {}
    try { peer.maybeWeeklySettle().catch(function () {}); } catch (e) {}
  }

  if (!session.tradable) {
    // 休市：低频跑一轮 —— 不撮合（没有新价格），只清「委托价已出涨跌停」的死单
    if (now - _lastIdle < IDLE_TICK_MS) return;
    _lastIdle = now;
    _busy = true;
    quotes.getSnapshot().then(function (snap) {
      var r = trading.matchOnce(snap);
      if (r.invalidated) _stats.expired += r.invalidated;
      _stats.lastTickAt = Date.now();
      _stats.lastError = null;
      if (r.invalidated) console.log('[stock] 休市清理死单 %d 笔', r.invalidated);
    }).catch(function (e) {
      _stats.lastError = e.message;
    }).then(function () {
      _busy = false;
    });
    return;
  }

  _busy = true;
  _stats.ticks++;
  quotes.getSnapshot().then(function (snap) {
    var r = trading.matchOnce(snap);
    if (r.filled) _stats.filled += r.filled;
    if (r.invalidated) _stats.expired += r.invalidated;
    _stats.lastTickAt = Date.now();
    _stats.lastError = null;
    if (r.filled) {
      console.log('[stock] 撮合成交 %d 笔（%s）', r.filled, r.session.label);
    }
  }).catch(function (e) {
    _stats.lastError = e.message;
  }).then(function () {
    _busy = false;
  });
}

function start() {
  if (_timer) return { started: false, reason: 'already-running' };
  _timer = setInterval(tick, TICK_MS);
  if (_timer.unref) _timer.unref();
  console.log('[stock] 撮合器已启动（%dms）', TICK_MS);
  // 启动即跑一次：进程刚起来时可能有昨日残留的委托要清算
  setTimeout(tick, 1500);
  return { started: true };
}

function stop() {
  if (_timer) { clearInterval(_timer); _timer = null; }
}

function stats() {
  return {
    running: !!_timer,
    tick_ms: TICK_MS,
    stats: _stats
  };
}

module.exports = { start: start, stop: stop, tick: tick, stats: stats };
