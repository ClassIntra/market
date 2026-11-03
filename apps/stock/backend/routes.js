// 学元证券 · 后端接口
// ============================================================
// 挂载点：/api/stock（由 manifest.backend.mountPath 声明）
//
// 设计原则：
// 1. **钱只走学元服务**。本应用不自己维护余额，所有资金变动都是
//    xueyuan.settleHold / credit / hold / release，账本守恒由平台保证。
// 2. **行情来自真实市场**，本应用不做「假装上涨」的动画数据。
//    行情拉不到时返回 stale=true，前端必须显示「行情延迟」。
// 3. 委托、成交、持仓全部落库（stock_* 表），刷新/换设备不丢。
//
// 编码约定：var / function

var nodePath = require('path');
var express = require('express');
var router = express.Router();

var requireAuth = require(nodePath.resolve(process.cwd(), 'src/middleware/auth')).requireAuth;
var db = require(nodePath.resolve(process.cwd(), 'src/utils/db'));
var xueyuan = require(nodePath.resolve(process.cwd(), 'src/services/xueyuan'));

var market = require('./market');
var quotes = require('./quotes');
var store = require('./store');
var news = require('./news');
var notify = require('./notify');
var trading = require('./trading');
var matcher = require('./matcher');
var peer = require('./peer');
var achievements = require('./achievements');
var report = require('./report');

router.use(requireAuth);

// 投资练习金：9000 学元（与学元开户赠金合计约 1 万，够买池内绝大多数股票 1 手）
var PRACTICE_GRANT_CENT = 900000;

// 启动撮合器与跨班协同（模块只加载一次；重复 require 由 global 定时器兜底）
try { matcher.start(); } catch (e) { console.error('[stock] 撮合器启动失败:', e.message); }
try { peer.start(); } catch (e) { console.error('[stock] 跨班协同启动失败:', e.message); }

function ok(res, data, message) {
  res.json({ code: 200, message: message || 'ok', data: data });
}

function fail(res, err) {
  if (err && err.isTradeError) {
    return res.status(400).json({ code: 400, message: err.message });
  }
  console.error('[stock] 接口错误:', err && err.stack ? err.stack : err);
  res.status(500).json({ code: 500, message: (err && err.message) || '服务器内部错误' });
}

function wrap(fn) {
  return function (req, res) {
    try {
      var r = fn(req, res);
      if (r && typeof r.catch === 'function') r.catch(function (e) { fail(res, e); });
    } catch (e) {
      fail(res, e);
    }
  };
}

function uid(req) { return String(req.user.user_id); }

// 班管 / 系统管理员（班级对决结算是发钱行为，只给班管）
function requireTreasury(req, res, next) {
  if (!req.user) return res.status(401).json({ code: 401, message: '未登录' });
  if (req.user.is_class_admin || req.user.is_admin === 1) return next();
  return res.status(403).json({ code: 403, message: '只有班管可以结算班级对决' });
}

// ---- 视图转换 ----
function viewOrder(o) {
  return {
    id: o.id,
    code: o.code,
    name: o.name,
    side: o.side,
    side_label: o.side === 'buy' ? '买入' : '卖出',
    type: o.order_type,
    type_label: o.order_type === 'market' ? '市价' : '限价',
    price: o.price_cent / 100,
    price_cent: o.price_cent,
    qty: o.qty,
    filled_qty: o.filled_qty,
    avg_fill: o.avg_fill_cent / 100,
    status: o.status,
    status_label: trading.statusText(o.status),
    hold: o.hold_cent / 100,
    fee: o.fee_cent / 100,
    reason: o.reason || '',
    trade_date: o.trade_date,
    created_at: o.created_at,
    filled_at: o.filled_at,
    // 未成交的买单显示「预估冻结」，方便学生对账
    can_cancel: o.status === 'pending'
  };
}

function viewTrade(t) {
  return {
    id: t.id,
    order_id: t.order_id,
    code: t.code,
    name: t.name,
    side: t.side,
    side_label: t.side === 'buy' ? '买入' : '卖出',
    price: t.price_cent / 100,
    qty: t.qty,
    amount: t.amount_cent / 100,
    fee: t.fee_cent / 100,
    fee_detail: {
      commission: t.commission_cent / 100,
      stamp: t.stamp_cent / 100,
      transfer: t.transfer_cent / 100
    },
    realized: t.realized_cent / 100,
    trade_date: t.trade_date,
    created_at: t.created_at
  };
}

// ---- 概览：资产 + 指数 + 自选 ----
router.get('/overview', wrap(function (req, res) {
  var userId = uid(req);
  // 首次进入即开户（学元账户由平台懒开户，这里只建本应用的账户行）
  store.ensureAccount(userId);

  // 投资练习金：学元的开户赠金是「零花钱」定位（1000），
  // 拿来买股票一手都不够。这里由应用发起一笔一次性助学金，
  // 让模拟盘有真实可操作的本金。幂等靠 ref，重复进入不会重复发。
  var practiceRef = 'stock:practice:' + userId;
  var granted = db.prepare('SELECT 1 FROM xy_tx WHERE ref = ?').get(practiceRef);
  var practiceGranted = 0;
  if (!granted) {
    try {
      var r = xueyuan.mint({
        to: userId,
        amountCent: PRACTICE_GRANT_CENT,
        kind: 'reward',
        ref: practiceRef,
        app: 'stock',
        memo: '学元证券 · 投资练习金'
      });
      if (!r.duplicate) practiceGranted = PRACTICE_GRANT_CENT / 100;
    } catch (e) {
      console.error('[stock] 投资练习金发放失败:', e.message);
    }
  }

  return quotes.getSnapshot().then(function (snap) {
    var summary = trading.accountSummary(userId, snap);
    // 波动提醒：打开应用时扫一遍持仓（内部 60s 节流 + 事件幂等，不会刷屏）
    try { notify.scanPositions(userId, store.listPositions(userId), snap.byCode); } catch (e) {
      console.error('[stock] 波动扫描失败:', e.message);
    }
    var watch = store.listWatch(userId);
    var watchList = [];
    for (var i = 0; i < watch.length; i++) {
      var q = snap.byCode[watch[i].code];
      if (q) watchList.push(q);
    }
    return quotes.getIndexes().then(function (indexes) {
      ok(res, {
        summary: summary,
        indexes: indexes,
        watchlist: watchList,
        session: market.currentSession(),
        stale: snap.stale,
        stale_reason: snap.error || '',
        matcher: matcher.stats().stats,
        practice_granted: practiceGranted
      });
    });
  });
}));

// ---- 行情列表（按板块分组）----
router.get('/market', wrap(function (req, res) {
  return quotes.getSnapshot({ force: req.query.force === '1' }).then(function (snap) {
    var groups = {};
    for (var i = 0; i < snap.list.length; i++) {
      var q = snap.list[i];
      var key = q.sector || '其他';
      if (!groups[key]) groups[key] = [];
      groups[key].push(q);
    }
    var sectors = Object.keys(groups).map(function (k) {
      return { name: k, list: groups[k] };
    });
    ok(res, {
      sectors: sectors,
      list: snap.list,
      stale: snap.stale,
      stale_reason: snap.error || '',
      quoted_at: snap.at,
      session: market.currentSession()
    });
  });
}));

// ---- 单只详情 ----
router.get('/quote/:code', wrap(function (req, res) {
  return quotes.getQuote(req.params.code).then(function (q) {
    var cash = xueyuan.viewAccount(uid(req));
    ok(res, {
      quote: q,
      session: market.currentSession(),
      fee_preview: market.calcFees('buy', q.price_cent * market.LOT_SIZE),
      max_buy: market.maxBuyQty(cash.available_cent, q.price)
    });
  }).catch(function (err) {
    // 停牌 / 池外 / 暂时无行情：404 比 500 更准确，前端也能直接提示
    res.status(404).json({ code: 404, message: err.message || '暂无该股票的行情' });
  });
}));

// ---- K 线 / 分时 ----
router.get('/kline/:code', wrap(function (req, res) {
  return quotes.getKline(req.params.code, req.query.klt, req.query.limit).then(function (d) { ok(res, d); });
}));

router.get('/trends/:code', wrap(function (req, res) {
  return quotes.getTrends(req.params.code).then(function (d) { ok(res, d); });
}));

// ---- 检索 ----
router.get('/search', wrap(function (req, res) {
  return quotes.search(req.query.q).then(function (list) { ok(res, { list: list }); });
}));

// ---- 下单 ----
router.post('/order', wrap(function (req, res) {
  var userId = uid(req);
  var body = req.body || {};
  return trading.placeOrder(userId, {
    code: body.code,
    side: body.side,
    type: body.type,
    price: body.price,
    qty: body.qty
  }).then(function (r) {
    return quotes.getSnapshot().then(function (snap) {
    ok(res, {
      order: viewOrder(r.order),
      filled: r.filled ? { order: viewOrder(r.filled.order), trade: viewTrade(r.filled.trade) } : null,
      achievements: (r.filled && r.filled.achievements) || [],
      summary: trading.accountSummary(userId, snap),
      message: r.message,
      session: r.session
    }, r.message);
    });
  });
}));

// ---- 撤单 ----
router.post('/order/:id/cancel', wrap(function (req, res) {
  var userId = uid(req);
  var o = trading.cancelOrder(userId, parseInt(req.params.id, 10));
  return quotes.getSnapshot().then(function (snap) {
    ok(res, {
      order: viewOrder(o),
      summary: trading.accountSummary(userId, snap)
    }, '已撤单');
  });
}));

// ---- 委托 / 成交 / 持仓 ----
router.get('/orders', wrap(function (req, res) {
  var rows = store.listOrders(uid(req), req.query.status, req.query.limit);
  ok(res, { list: rows.map(viewOrder) });
}));

router.get('/trades', wrap(function (req, res) {
  var rows = store.listTrades(uid(req), req.query.limit);
  ok(res, { list: rows.map(viewTrade) });
}));

router.get('/positions', wrap(function (req, res) {
  return quotes.getSnapshot().then(function (snap) {
    var s = trading.accountSummary(uid(req), snap);
    ok(res, { positions: s.positions, totals: s.totals, cash: s.cash, stale: s.stale });
  });
}));

// ---- 站内通知（持仓波动 / 成交 / 委托失效）----
router.get('/notify', wrap(function (req, res) {
  ok(res, notify.list(uid(req), { limit: req.query.limit }));
}));

router.post('/notify/read', wrap(function (req, res) {
  var n = notify.readAll(uid(req));
  ok(res, { marked: n, unread: 0 });
}));

// ---- 资讯（增强功能：上游失败返回空列表，绝不把主流程带崩）----
router.get('/news', wrap(function (req, res) {
  return news.fastNews(req.query.limit).then(function (list) {
    ok(res, { list: list, source: '东方财富' });
  }).catch(function () {
    ok(res, { list: [], source: '东方财富' });
  });
}));

router.get('/news/:code', wrap(function (req, res) {
  var code = String(req.params.code || '').replace(/\D/g, '');
  if (code.length !== 6) return ok(res, { list: [] });
  return news.stockNews(code, req.query.name, req.query.limit).then(function (list) {
    ok(res, { list: list, code: code });
  }).catch(function () {
    ok(res, { list: [], code: code });
  });
}));

// ---- 资金流水（学元账本：买卖、费用、奖励、班管发放，逐笔可追溯）----
// 直接复用宿主的 xy_entry 视图，避免应用自己再记一套流水导致对不上账。
router.get('/ledger', wrap(function (req, res) {
  ok(res, xueyuan.history(uid(req), {
    limit: req.query.limit,
    beforeId: req.query.beforeId
  }));
}));

// ---- 自选 ----
router.get('/watch', wrap(function (req, res) {
  return quotes.getSnapshot().then(function (snap) {
    var rows = store.listWatch(uid(req));
    var list = [];
    for (var i = 0; i < rows.length; i++) {
      var q = snap.byCode[rows[i].code];
      if (q) list.push(q);
    }
    ok(res, { list: list });
  });
}));

router.post('/watch', wrap(function (req, res) {
  var code = market.normalizeCode((req.body || {}).code);
  if (!code || !quotes.isTradable(code)) throw trading.TradeError('该股票不在可交易范围内');
  return quotes.getQuote(code).then(function (q) {
    store.addWatch(uid(req), code, q.name);
    ok(res, { code: code, name: q.name }, '已加入自选');
  });
}));

router.delete('/watch/:code', wrap(function (req, res) {
  var code = market.normalizeCode(req.params.code);
  if (!code) throw trading.TradeError('股票代码不合法');
  var removed = store.removeWatch(uid(req), code);
  ok(res, { removed: removed }, removed ? '已移出自选' : '不在自选中');
}));

// ---- 跨班对决 ----
// 本班实时数据 + 对端缓存战报 + 周结算状态，一次给齐。
router.get('/peer', wrap(function (req, res) {
  return quotes.getSnapshot().then(function (snap) {
    var myClass = peer.localClassNo();
    var my = peer.buildLocalPayload(snap);
    my.class_name = peer.className(myClass);

    var peerRow = store.getPeerRank(myClass === '08' ? '18' : (myClass === '18' ? '08' : ''));
    // 找不到固定对端时退而求其次：取任意一条别人的战报（多班部署友好）
    if (!peerRow) {
      var all = store.listPeerRanks();
      for (var i = 0; i < all.length; i++) {
        if (all[i].class_no !== myClass) { peerRow = all[i]; break; }
      }
    }
    var peerData = null;
    if (peerRow) {
      var fresh = (Date.now() - peerRow.received_at) <= peer.PEER_FRESH_MS;
      peerData = {
        class_no: peerRow.class_no,
        class_name: peer.className(peerRow.class_no),
        payload: peerRow.payload,
        received_at: peerRow.received_at,
        fresh: fresh
      };
    }

    var weekKey = peer.weekKeyOf(Date.now());
    var thisWeek = store.getWeeklySettle(weekKey);
    var last = store.latestWeeklySettle();

    ok(res, {
      my: my,
      peer: peerData,
      weekly: {
        week_key: weekKey,
        reward: peer.WEEKLY_WIN_REWARD_CENT / 100,
        settled: !!thisWeek,
        this_week: thisWeek,
        last: last
      }
    });
  });
}));

// 手动结算（班管）：正常流程由撮合器在周五收盘后自动触发。
// body.force=true 可跳过「周五 15:05」的日期检查提前结算（补结算/演示用），
// 但对端数据有效期、周幂等、活跃判定照常 —— 不会多发钱。
router.post('/peer/settle', requireTreasury, wrap(function (req, res) {
  var body = req.body || {};
  return peer.maybeWeeklySettle(Date.now(), { skipDayCheck: body.force === true }).then(function (r) {
    if (r && r.skipped) {
      return ok(res, { skipped: r.skipped, weekly: store.latestWeeklySettle() },
        '暂不结算：' + settleReason(r.skipped));
    }
    return ok(res, {
      result: r.result,
      rewarded: r.rewarded || 0,
      weekly: store.latestWeeklySettle()
    }, r.result === 'win' ? '本班获胜！奖励已发放' : (r.result === 'lose' ? '本班惜败' : '平局，不开奖'));
  });
}));

function settleReason(code) {
  var map = {
    'not-friday': '结算只在每周五收盘后进行',
    'too-early': '还没到周五收盘时间（15:05）',
    'already-settled': '本周已经结算过了',
    'no-fresh-peer': '还没有收到隔壁班的战报（对端需安装本应用且 48 小时内在线过）',
    'self-empty': '本班还没有人参与，先有交易再对决'
  };
  return map[code] || code;
}

// ---- 成就 ----
router.get('/achievements', wrap(function (req, res) {
  var userId = uid(req);
  // 节流检查（10 分钟内不重复全表扫）；成交后的即时检查在交易接口里已做
  achievements.checkUser(userId);
  ok(res, achievements.viewAll(userId));
}));

// ---- 收盘报告 ----
router.get('/report', wrap(function (req, res) {
  // Promise.resolve 兜底：即便 latest() 未来有人改回同步返回也不 500
  return Promise.resolve(report.latest()).then(function (r) {
    ok(res, { report: r && r.report ? r.report : null, generated: !!(r && r.generated) });
  });
}));

// ---- 班级排行 ----
router.get('/rank', wrap(function (req, res) {
  return quotes.getSnapshot().then(function (snap) {
    // 只统计「进过本应用」的人：stock_account 在首次打开 overview 时创建。
    // 只开了学元账户、从没进过炒股的同学不该占着排行榜名额（口径 2026-11-03 修）。
    var accounts = db.prepare([
      'SELECT a.user_id, a.balance, u.net_name, u.real_name',
      'FROM xy_account a',
      'JOIN stock_account s ON s.user_id = a.user_id',
      'LEFT JOIN users u ON u.user_id = a.user_id',
      "WHERE a.user_id NOT LIKE '@%'"
    ].join('\n')).all();

    var posRows = db.prepare('SELECT user_id, code, qty, cost_cent FROM stock_positions WHERE qty > 0').all();
    var posMap = {};
    for (var i = 0; i < posRows.length; i++) {
      var p = posRows[i];
      if (!posMap[p.user_id]) posMap[p.user_id] = [];
      posMap[p.user_id].push(p);
    }

    // 一次取回每位学生的成交流水，反推「净投入」：
    //   净投入 = 学元余额 + 买入总流出(含费) − 卖出净回流
    // 这样 累计盈亏 = 总资产 − 净投入 = 持仓浮盈亏 + 已实现盈亏，
    // 与资产页 accountSummary.total_pnl 严格同口径。
    // ⚠️ 旧算法 pnl = 总资产 − 持仓成本 + 已实现 把现金余额整个算进了
    // 「盈亏」（8990 现金 + 1000 市值 − 1010 成本 = +8980，实际是 −10 手续费），
    // 排行榜和对决结算全被污染 —— 2026-11-03 修复。
    var flowRows = db.prepare([
      "SELECT user_id,",
      "  COALESCE(SUM(CASE WHEN side = 'buy' THEN amount_cent + fee_cent ELSE 0 END), 0) AS buy_out_cent,",
      "  COALESCE(SUM(CASE WHEN side = 'sell' THEN amount_cent - fee_cent ELSE 0 END), 0) AS sell_in_cent",
      'FROM stock_trades GROUP BY user_id'
    ].join('\n')).all();
    var flowMap = {};
    for (var fi = 0; fi < flowRows.length; fi++) flowMap[flowRows[fi].user_id] = flowRows[fi];

    var list = [];
    for (var j = 0; j < accounts.length; j++) {
      var a = accounts[j];
      var pos = posMap[a.user_id] || [];
      var mv = 0;
      for (var k = 0; k < pos.length; k++) {
        var q = snap.byCode[pos[k].code];
        mv += (q ? q.price_cent : 0) * pos[k].qty;
      }
      var flow = flowMap[a.user_id] || { buy_out_cent: 0, sell_in_cent: 0 };
      var total = a.balance + mv;
      var invested = a.balance + flow.buy_out_cent - flow.sell_in_cent;
      var pnl = total - invested;
      list.push({
        user_id: a.user_id,
        net_name: a.net_name || '',
        total_asset: total / 100,
        total_asset_cent: total,
        market_value: mv / 100,
        pnl: pnl / 100,
        return_pct: invested > 0 ? Math.round(pnl / invested * 10000) / 100 : 0,
        position_count: pos.length
      });
    }

    list.sort(function (x, y) { return y.total_asset_cent - x.total_asset_cent; });
    var top = list.slice(0, 30).map(function (x, idx) {
      x.rank = idx + 1;
      delete x.total_asset_cent;
      return x;
    });

    var me = null;
    for (var m = 0; m < list.length; m++) {
      if (list[m].user_id === uid(req)) {
        me = {
          // user_id 必须下发：前端排名行靠 it.user_id === me.user_id 打「我」标签，
          // 缺了它这个标签永远不会出现（2026-11-03 修）
          user_id: list[m].user_id,
          rank: m + 1, total_asset: list[m].total_asset, pnl: list[m].pnl,
          return_pct: list[m].return_pct, total: list.length
        };
        break;
      }
    }

    ok(res, { list: top, me: me, total: list.length, stale: snap.stale });
  });
}));

// ---- 交易规则（前端「规则」页直接渲染，避免文案两处维护）----
router.get('/rules', wrap(function (req, res) {
  ok(res, {
    currency: {
      name: '学元',
      note: '本应用只使用学元结算，与人民币无关，不能充值也不能提现。'
    },
    session: market.currentSession(),
    sessions: market.SESSIONS,
    fees: {
      commission_rate: market.COMMISSION_RATE,
      commission_min: market.COMMISSION_MIN_CENT / 100,
      stamp_rate: market.STAMP_RATE,
      transfer_rate: market.TRANSFER_RATE,
      note: '佣金买卖双向收取（万 2.5，最低 5 元）；印花税仅卖出收取 0.05%；过户费双向 0.001%。'
    },
    lot: {
      size: market.LOT_SIZE,
      min_buy: market.MIN_BUY_QTY,
      note: '买入必须是 100 股的整数倍；零股只能一次性卖出。'
    },
    t1: '本盘当天买入当天就能卖（教学盘放宽了 T+0，因为平板不是天天开机）。但请记住：<b>真实 A 股是 T+1</b> —— 今天买入的股票，下一个交易日才能卖出，考试和真实交易都按 T+1 记。',
    limits: '主板涨跌停 ±10%，创业板/科创板 ±20%；涨停买不到、跌停卖不掉，委托会排队等开板。',
    matching: '成交价以最新市场价为准：限价买单不高于委托价成交，限价卖单不低于委托价成交。',
    expiry: '委托会一直有效，直到成交或你主动撤单。若委托价超出了当天的涨跌停范围（比如隔夜大跌后），会在下一次撮合时自动作废并解冻资金。',
    orderWindow: '限价与市价委托任何时间都能下 —— 晚上、周末、节假日都可以，休市时挂单不收费、也不会消失。',
    session_note: '撮合只在开市时段发生：9:25 集合竞价按开盘价成交，9:30–11:30 / 13:00–15:00 连续竞价按最新价成交；休市期间委托排队等待，开盘后自动继续。',
    market_order: '市价单：开市时按最新价立即成交；休市时按最新价预扣（多留 10% 缓冲）后排队，开盘按开盘价成交，跳空过大导致资金不足会被拒绝并全额解冻。'
  });
}));

module.exports = router;
