// 每日收盘报告（report）
// ============================================================
// 用真实行情生成一份「收盘报告」：三大指数、领涨领跌、成交额榜、
// 一句主编点评 + 一条轮换的投教提醒。
//
// 为什么不是 AI 生成：两班看到的内容必须一致且可复现（它记录的是
// 「这一天市场真实发生了什么」），模板生成足够，也不引入外部依赖。
//
// 生成时机：15:00 收盘后第一次被请求（或 matcher tick 探测到收盘）时
// 生成当日一份；开盘前显示最近一份（昨天 / 上周五）。
//
// 编码约定：var / function

var market = require('./market');
var quotes = require('./quotes');
var store = require('./store');

// 投教提醒池（按日期轮换，全班同一天看到同一条）
var TIPS = [
  '手续费是真实的：一买一卖至少 10 学元起步，频繁交易的隐性成本比看起来高。',
  'T+1 意味着今天买入的股票明天才能卖 —— 下单之前先想清楚这个价明天还认不认。',
  '涨跌停买不到也卖不掉：涨停排队的不止你一个人，别把「挂上了」当成「会成交」。',
  '分散持仓不是平均买十只，而是让不同板块的涨跌互相缓冲。',
  '浮盈不是盈利：没卖掉之前，账户里那串绿色数字随时会变成绿色以外的另一种绿。',
  '看换手率比看涨幅更有信息量：放量上涨和缩量上涨是两回事。',
  '市盈率（PE）高不一定是贵，可能是市场预期它长得快 —— 但也可能只是贵。',
  '记录你每笔买卖的理由，一周后回看 —— 大部分理由会羞于见人。'
];

function pickTip(dateKey) {
  var seed = 0;
  for (var i = 0; i < dateKey.length; i++) seed = (seed * 31 + dateKey.charCodeAt(i)) % 100000;
  return TIPS[seed % TIPS.length];
}

function topBy(list, key, n, desc) {
  var copy = list.slice();
  copy.sort(function (a, b) { return desc ? b[key] - a[key] : a[key] - b[key]; });
  var out = [];
  for (var i = 0; i < copy.length && out.length < n; i++) {
    var q = copy[i];
    out.push({ code: q.code, name: q.name, price: q.price, change_pct: q.change_pct });
  }
  return out;
}

function makeComment(indexes, gainers, losers) {
  var sh = null;
  for (var i = 0; i < indexes.length; i++) {
    if (indexes[i].code === '000001') { sh = indexes[i]; break; }
  }
  var pct = sh ? sh.change_pct : 0;
  var lead = gainers.length ? gainers[0].name : '';
  var lag = losers.length ? losers[0].name : '';

  if (pct >= 1.5) return '大盘放量上攻，' + lead + ' 打头阵。普涨的日子里更要记得：涨得急的回调也急，别把今天的行情当成明天的确定性。';
  if (pct >= 0.4) return '红盘报收，' + lead + ' 领涨。市场情绪偏暖，但手别痒 —— 你的每笔委托都要付佣金。';
  if (pct > -0.4) return '窄幅震荡，' + lead + ' 与 ' + lag + ' 各占一头。这种日子最适合做的事是看盘不动手。';
  if (pct > -1.5) return '大盘走弱，' + lag + ' 领跌。下跌的日子里少动多看，现金也是仓位。';
  return '大跌。' + lag + ' 跌在最前面 —— 记住这种感觉：它就是为什么要留现金、为什么要分散。';
}

// 本班今日交易热度（各班不同，不参与跨班共享）
function classActivity(dateKey) {
  var dbx = require('./store').db();
  var trades = dbx.prepare('SELECT COUNT(*) AS n, COUNT(DISTINCT user_id) AS u FROM stock_trades WHERE trade_date = ?').get(dateKey);
  var hot = dbx.prepare([
    'SELECT code, name, COUNT(*) AS n FROM stock_trades',
    'WHERE trade_date = ? GROUP BY code, name ORDER BY n DESC LIMIT 3'
  ].join('\n')).all(dateKey);
  return { trades: trades.n || 0, participants: trades.u || 0, hot: hot };
}

function buildPayload(dateKey, snapshot, indexes) {
  var list = (snapshot && snapshot.list) || [];
  var gainers = topBy(list, 'change_pct', 3, true);
  var losers = topBy(list, 'change_pct', 3, false);
  var actives = topBy(list, 'amount', 3, true);

  return {
    date_key: dateKey,
    generated_at: Date.now(),
    indexes: indexes,
    gainers: gainers,
    losers: losers,
    actives: actives,
    comment: makeComment(indexes, gainers, losers),
    tip: pickTip(dateKey),
    up_count: list.filter(function (q) { return q.change_pct > 0; }).length,
    down_count: list.filter(function (q) { return q.change_pct < 0; }).length,
    class_activity: classActivity(dateKey)
  };
}

// 生成今日报告（幂等：date_key 唯一）。返回生成结果或已存在的。
// ⚠️ 恒返 Promise：同步早退路径曾直接 return 普通对象，而路由和
// matcher 都按 promise 消费（.then/.catch）→ 工作日 15:00 前
// 「report.latest(...).then is not a function」，/report 必 500 ——
// 恰好是学生用平板的时段（2026-11-03 e2e 捕获）。
function ensureToday() {
  var now = Date.now();
  var session = market.currentSession(now);
  var dateKey = market.dateKey(now);

  var existing = store.getDailyReport(dateKey);
  if (existing) return Promise.resolve({ generated: false, report: existing });

  // 盘中生成的数据不完整，等收盘（15:00 之后 session.key 变为 closed）
  var p = market.bjParts(now);
  var afterClose = p.weekday >= 1 && p.weekday <= 5 && (p.hour * 60 + p.minute >= 15 * 60);
  if (!afterClose) return Promise.resolve({ generated: false, report: store.getDailyReport(null) });

  return quotes.getSnapshot({ force: true }).then(function (snap) {
    if (snap.stale) return { generated: false, report: store.getDailyReport(null) };
    return quotes.getIndexes().then(function (indexes) {
      if (!indexes.length) return { generated: false, report: store.getDailyReport(null) };
      var payload = buildPayload(dateKey, snap, indexes);
      store.saveDailyReport(dateKey, payload);
      console.log('[stock-report] 已生成 %s 收盘报告', dateKey);
      return { generated: true, report: { date_key: dateKey, payload: payload, created_at: Date.now() } };
    });
  });
}

// 对外：返回「最新可用」的报告（今日有今日，没有则最近一份）
function latest() {
  return ensureToday();
}

module.exports = {
  latest: latest,
  ensureToday: ensureToday,
  buildPayload: buildPayload,
  makeComment: makeComment
};
