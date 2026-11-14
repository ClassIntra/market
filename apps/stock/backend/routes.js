// 学元证券 · 后端接口
// ============================================================
// 挂载点：/api/stock（由 manifest.backend.mountPath 声明）
//
// 设计原则：
// 1. **钱只走学元服务**。本应用不自己维护余额，所有资金变动都是
//    app-api 的 reserve / settleBuy / settleSell，账本守恒由平台保证。
// 2. **行情来自真实市场**，本应用不做「假装上涨」的动画数据。
//    行情拉不到时返回 stale=true，前端必须显示「行情延迟」。
// 3. 委托、成交、持仓全部落库（stock_* 表），刷新/换设备不丢。
//
// 编码约定：var / function

var nodePath = require('path');
var express = require('express');
var router = express.Router();

var requireAuth = require('_sdk/backend/host').auth.requireAuth;
var db = require('_sdk/backend/host').db;
// 第三方应用：只能通过平台能力面访问练习金。余额、津贴、转账、红包
// 属于「学元钱包」系统应用，本应用不再代理。
var app = require('_sdk/backend/host').ledger;

var market = require('./market');
var quotes = require('./quotes');
var store = require('./store');
var news = require('./news');
var notify = require('./notify');
var alerts = require('./alerts');
var profile = require('./profile');
var packet = require('./packet');
var trading = require('./trading');
var matcher = require('./matcher');
var peer = require('./peer');
var achievements = require('./achievements');
var report = require('./report');

router.use(requireAuth);

// 投资练习金：每月可补足到 3 万学元（=30 元等值）。
// 只发练习金池（practice）—— 它不能在钱包里转账、发红包、买货、提现，
// 所以印多少都不会稀释消费市场的购买力。这是「钱不值钱」的根治办法。
//
// 为什么是「补足到」而不是「固定发」：
//   学生买满仓后可用归零是正常的，不该因此发钱；
//   但亏了就该补 —— 沙盘的意义是让人敢下手，不是让人一次亏光就退场。
//   所以按「可用练习金 + 持仓市值」算总资产，低于目标才补差额。
var PRACTICE_TARGET_CENT = 3000000;

function monthKey() {
  var d = new Date(Date.now() + 8 * 3600 * 1000);
  return d.getUTCFullYear() + '-' + ('0' + (d.getUTCMonth() + 1)).slice(-2);
}

// 练习金总资产（分）= 可用练习金 + 持仓市值 + 累计撤出到钱包的金额。
// 只算练习金池：真钱和赠送学元都不参与证券，不能用来"凑"练习资产。
//
// ⚠️ 加回「累计撤出」是防刷：学生把练习金撤到钱包后可花，如果这里只按
//    当前余额算，撤资会被当成亏损，下个月又被补到 3 万 → 凭空发行赠金。
//    主动拿走的钱不是亏的，平台不补。见 server/src/ledger/invest.js。
function practiceAssetCent(userId) {
  var mv = store.db().prepare([
    'SELECT COALESCE(SUM(p.qty * COALESCE(q.price_cent, 0)), 0) AS s',
    'FROM stock_positions p LEFT JOIN stock_quotes q ON q.code = p.code',
    'WHERE p.user_id = ?'
  ].join(' ')).get(userId).s;
  // 基数由平台能力面定义（含累计撤出），第三方只提供持仓市值。
  return app.topUpBase('stock', userId, mv);
}

// 启动撮合器与跨班协同（模块只加载一次；重复 require 由 global 定时器兜底）
try { matcher.start(); } catch (e) { console.error('[stock] 撮合器启动失败:', e.message); }
try { peer.start(); } catch (e) { console.error('[stock] 跨班协同启动失败:', e.message); }

function ok(res, data, message) {
  res.json({ code: 200, message: message || 'ok', data: data });
}

function fail(res, err) {
  if (err && (err.isTradeError || err.isLoanError || err.isAlertError)) {
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

// 判重：只认学元账本。旧表已停止写入，切账当月可能残留的旧 ref 用一次性脚本处理，
// 不再让运行时同时读两套表 —— 那种「两个真源」迟早会给出两个答案。
function refExistsAnywhere(ref) {
  var r = String(ref);
  try {
    return !!db.prepare('SELECT 1 FROM xy_ledger_transactions WHERE ref = ?').get(r);
  } catch (e) {
    return false;
  }
}

// 班管 / 系统管理员（班级对决结算是发钱行为，只给班管）
function requireTreasury(req, res, next) {
  if (!req.user) return res.status(401).json({ code: 401, message: '未登录' });
  if (req.user.is_class_admin || req.user.is_admin === 1) return next();
  return res.status(403).json({ code: 403, message: '只有班管可以结算班级对决' });
}

// ---- 视图转换 ----
function viewOrder(o) {
  var typeLabel = o.order_type === 'market' ? '市价'
    : (o.order_type === 'condition'
      ? (o.trigger_type === 'stop_loss' ? '止损'
        : (o.trigger_type === 'take_profit' ? '止盈'
          : (o.trigger_type === 'trailing_stop' ? '移动止损' : '条件')))
      : '限价');
  return {
    id: o.id,
    code: o.code,
    name: o.name,
    side: o.side,
    side_label: o.side === 'buy' ? '买入' : '卖出',
    type: o.order_type,
    type_label: typeLabel,
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
    validity: o.validity || 'long',
    validity_label: o.validity === 'day' ? '当日有效' : '长期有效',
    expires_at: Number(o.expires_at) || 0,
    trigger_type: o.trigger_type || '',
    trigger_price: (Number(o.trigger_cent) || 0) / 100,
    trail_percent: Number(o.trail_percent) || 0,
    peak_price: (Number(o.peak_cent) || 0) / 100,
    triggered_at: o.triggered_at || 0,
    // 未成交的买单显示「预估冻结」，方便学生对账
    can_cancel: o.status === 'pending' || o.status === 'armed'
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
router.get('/health', wrap(function (req, res) {
  var pending = store.db().prepare([
    "SELECT COUNT(*) AS n, MIN(created_at) AS oldest FROM stock_orders WHERE status IN ('pending','armed')"
  ].join(' ')).get();
  var armed = store.db().prepare("SELECT COUNT(*) AS n FROM stock_orders WHERE status = 'armed'").get();
  var last = quotes.lastSnapshot();
  ok(res, {
    matcher: matcher.stats(),
    pending_orders: Number(pending.n) || 0,
    armed_orders: Number(armed.n) || 0,
    oldest_pending_at: Number(pending.oldest) || 0,
    session: market.currentSession(),
    quote: last,
    quote_session: market.sessionForSnapshot(market.currentSession(), last)
  });
}));

router.get('/overview', wrap(function (req, res) {
  var userId = uid(req);
  // 首次进入即开户（学元账户由平台懒开户，这里只建本应用的账户行）
  store.ensureAccount(userId);

  // 投资练习金：每月可补足到 3 万学元。
  //   · 买满仓导致可用归零 → 不补（总资产没变，卖一股就有钱）
  //   · 亏钱导致总资产缩水 → 补差额（沙盘要让人敢继续练）
  // 幂等靠「每人每月一个 ref」，同一个月点一百次也只补一次。
  var practiceGranted = 0;
  var monthRef = 'stock:practice:v2:' + userId + ':' + monthKey();
  // 跨账本判重：旧账本已发过就不再发（切账当月最容易踩到）
  if (!refExistsAnywhere(monthRef)) {
    var practiceAsset = practiceAssetCent(userId);
    var needCent = Math.max(0, PRACTICE_TARGET_CENT - practiceAsset);
    if (needCent > 0) {
      try {
        var r = app.issue('stock', userId, needCent, monthRef,
          practiceAsset > 0 ? '学元证券 · 练习金补足' : '学元证券 · 投资练习金');
        if (!r.duplicate) practiceGranted = needCent / 100;
      } catch (e) {
        console.error('[stock] 投资练习金发放失败:', e.message);
      }
    }
  }

  return quotes.getSnapshot().then(function (snap) {
    var summary = trading.accountSummary(userId, snap);
    // 波动提醒：打开应用时扫一遍持仓（内部 60s 节流 + 事件幂等，不会刷屏）。
    // 断网兜底价/节假日昨收价不能拿来做提醒，否则会推「假的涨停/浮亏」。
    var quoteUsable = !snap.stale &&
      (!snap.quote_date || snap.quote_date === market.dateKey());
    if (quoteUsable) {
      try { notify.scanPositions(userId, store.listPositions(userId), snap.byCode); } catch (e) {
        console.error('[stock] 波动扫描失败:', e.message);
      }
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
        session: market.sessionForSnapshot(market.currentSession(), snap),
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
      quote_date: snap.quote_date || '',
      session: market.sessionForSnapshot(market.currentSession(), snap)
    });
  });
}));

// ---- 单只详情 ----
router.get('/quote/:code', wrap(function (req, res) {
  return quotes.getQuote(req.params.code).then(function (q) {
    var cash = app.practiceAccount('stock', uid(req));
    ok(res, {
      quote: q,
      session: market.sessionForSnapshot(market.currentSession(), { stale: q.stale, quote_date: q.quote_date }),
      fee_preview: market.calcFees('buy', q.price_cent * market.LOT_SIZE),
      max_buy: market.maxBuyQty(cash.available_practice_cent, q.price)
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
    qty: body.qty,
    validity: body.validity
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

// ---- 条件单：止损 / 止盈（只支持卖出）----
router.post('/order/condition', wrap(function (req, res) {
  var userId = uid(req);
  var body = req.body || {};
  return trading.placeConditional(userId, {
    code: body.code,
    trigger_type: body.trigger_type,
    trigger_price: body.trigger_price,
    trail_percent: body.trail_percent,
    qty: body.qty,
    validity: body.validity
  }).then(function (r) {
    return quotes.getSnapshot().then(function (snap) {
      ok(res, {
        order: viewOrder(r.order),
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

router.post('/orders/cancel-all', wrap(function (req, res) {
  var userId = uid(req);
  var r = trading.cancelAll(userId);
  return quotes.getSnapshot().then(function (snap) {
    ok(res, {
      cancelled: r.cancelled,
      released: r.released_cent / 100,
      summary: trading.accountSummary(userId, snap)
    }, r.cancelled ? ('已撤销 ' + r.cancelled + ' 笔委托') : '没有可撤的委托');
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

// ---- 资金功能已迁出本应用 ----
// 证券是第三方应用，只能操作练习金；余额、津贴、转账、红包属于「学元钱包」系统应用。
// 保留一个只读的练习金视图供顶部余额条使用，其余入口一律 410。
router.get('/wallet', wrap(function (req, res) {
  var acc = app.practiceAccount('stock', uid(req));
  // 前端展示口径是「学元」（1 学元 = 100 单位），与 xy.fromCent 一致。
  // 能力面返回的是账本单位，必须在这里换算，否则弹层余额会大 100 倍。
  ok(res, {
    account: {
      practice: acc.practice_cent / 100,
      available_practice: acc.available_practice_cent / 100,
      frozen_practice: acc.frozen_practice_cent / 100
    },
    // 能力面只给「可投入的赠金额度」这一个数，不给完整钱包视图。
    grant_available: app.grantAvailable('stock', uid(req)) / 100,
    moved: true,
    moved_to: '/wallet'
  });
}));

// ---- 投资进出（赠金 ⇄ 练习金）----
// 第三方应用不直连 /api/xueyuan/*：统一走平台能力面，平台可审计、可限流、可收回。
// 方向写死在能力面里，本路由连 asset / to 参数都不接受。
router.post('/invest', wrap(function (req, res) {
  var b = req.body || {};
  var amount = Number(b.amount);
  var cent = Math.round(amount * 100);   // 学元 → 账本单位（与 xy.toCent 同口径）
  if (!isFinite(cent) || cent <= 0) throw new Error('金额不合法');
  var u = uid(req);
  var r = app.invest('stock', u, String(b.direction || 'in'), cent,
    'stock:invest:' + u + ':' + Date.now() + ':' + Math.random().toString(36).slice(2, 8));
  ok(res, {
    direction: r.direction,
    amount: r.amount_cent / 100,
    account: {
      practice: r.account.practice_cent / 100,
      available_practice: r.account.available_practice_cent / 100,
      frozen_practice: r.account.frozen_practice_cent / 100
    }
  }, r.direction === 'in' ? '已转入投资' : '已撤出到钱包');
}));

// ---- 信用 / 贷款（学元证券专用能力面） ----
// 只开放学生本人的看/借/还/明细；核销、限额、调分、拉黑属于班管后台。
// 金额入参是学元；能力面收账本单位，与 /invest 的换算口径一致。
router.get('/loan', wrap(function (req, res) {
  ok(res, app.loanSummary('stock', uid(req)));
}));

router.get('/loan/alert', wrap(function (req, res) {
  ok(res, { alert: app.loanAlert('stock', uid(req)) });
}));

router.get('/loan/:id', wrap(function (req, res) {
  ok(res, app.loanDetail('stock', uid(req), req.params.id));
}));

router.post('/loan/apply', wrap(function (req, res) {
  var b = req.body || {};
  var amount = Number(b.amount);
  var cent = Math.round(amount * 100);
  if (!isFinite(cent) || cent <= 0) throw new Error('金额不合法');
  var u = uid(req);
  var ref = b.ref ? String(b.ref) : ('u:' + u + ':' + Date.now().toString(36) + ':' + Math.random().toString(36).slice(2, 8));
  var r = app.loanApply('stock', u, cent, {
    ref: ref,
    product: b.product,
    installments: b.installments,
    auto_repay: !!b.auto_repay
  });
  ok(res, {
    duplicate: !!r.duplicate,
    loan: r.loan,
    summary: app.loanSummary('stock', u)
  }, r.duplicate ? '这笔借款已处理' : '借款已到账');
}));

router.post('/loan/repay', wrap(function (req, res) {
  var b = req.body || {};
  var u = uid(req);
  var cent = b.full ? null : Math.round(Number(b.amount) * 100);
  if (!b.full && (!isFinite(cent) || cent <= 0)) throw new Error('金额不合法');
  var ref = b.ref ? String(b.ref) : ('r:' + u + ':' + Date.now().toString(36) + ':' + Math.random().toString(36).slice(2, 8));
  var r = app.loanRepay('stock', u, cent, { ref: ref, full: !!b.full });
  ok(res, {
    duplicate: !!r.duplicate,
    loan: r.loan,
    allocation: r.allocation,
    summary: app.loanSummary('stock', u)
  }, r.duplicate ? '这笔还款已处理' : '还款成功');
}));

// 投资贷专用：练习金 → 赠金 → 还款，一个事务内完成。
// 不让学生先「撤出到钱包」再找还款入口 —— 钱包已经没有贷款页了。
router.post('/loan/repay-from-practice', wrap(function (req, res) {
  var b = req.body || {};
  var u = uid(req);
  var cent = b.full ? null : Math.round(Number(b.amount) * 100);
  if (!b.full && (!isFinite(cent) || cent <= 0)) throw new Error('金额不合法');
  var ref = b.ref ? String(b.ref) : ('rp:' + u + ':' + Date.now().toString(36) + ':' + Math.random().toString(36).slice(2, 8));
  var r = app.loanRepayFromPractice('stock', u, { amountCent: cent, full: !!b.full, ref: ref });
  ok(res, r, r.duplicate ? '这笔还款已处理' : (r.loan && r.loan.status === 'repaid' ? '贷款已还清' : '还款成功'));
}));

// 学生开关「每日津贴自动还款」。津贴预支强制开启，能力面会拒绝关闭。
router.post('/loan/:id/auto', wrap(function (req, res) {
  var b = req.body || {};
  var r = app.loanSetAutoRepay('stock', uid(req), req.params.id, !!b.on);
  ok(res, r, b.on ? '已开启津贴自动还款' : '已关闭津贴自动还款');
}));

var MOVED_MSG = '资金功能已迁移到「学元钱包」应用';['/wallet/daily', '/wallet/transfer', '/wallet/packets', '/wallet/packet', '/wallet/packet/:id/claim']
  .forEach(function (p) {
    router.all(p, function (req, res) {
      res.status(410).json({ code: 410, message: MOVED_MSG, data: { moved_to: '/wallet' } });
    });
  });

// ---- 站内通知（持仓波动 / 成交 / 委托失效）----
// ---- 到价提醒 ----
router.get('/alerts', wrap(function (req, res) {
  ok(res, { list: alerts.list(uid(req)) });
}));

router.post('/alerts', wrap(function (req, res) {
  var b = req.body || {};
  var a = alerts.create(uid(req), {
    code: b.code,
    direction: b.direction,
    target_price: b.target_price
  });
  ok(res, { alert: a }, '到价提醒已设置');
}));

router.post('/alerts/:id/cancel', wrap(function (req, res) {
  ok(res, { alert: alerts.cancel(uid(req), req.params.id) }, '已取消提醒');
}));

router.get('/notify', wrap(function (req, res) {
  ok(res, notify.list(uid(req), { limit: req.query.limit }));
}));

router.post('/notify/read', wrap(function (req, res) {
  var n = notify.readAll(uid(req));
  ok(res, { marked: n, unread: 0 });
}));

router.get('/notify/pref', wrap(function (req, res) {
  ok(res, notify.getPref(uid(req)));
}));

router.post('/notify/pref', wrap(function (req, res) {
  ok(res, notify.setPref(uid(req), req.body || {}));
}));

// ---- 公司概况（F10 摘要：行业/上市日/市值/PE/PB，缓存 10 分钟）----
router.get('/profile/:code', wrap(function (req, res) {
  return profile.getProfile(req.params.code).then(function (data) {
    ok(res, data);
  }).catch(function () {
    ok(res, null);   // 概况是增强信息：拉不到就返回 null，前端显示「暂无」
  });
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
  ok(res, app.history('stock', uid(req), req.query.limit, req.query.beforeId));
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
  // ?force=1 跳过节流：给测试/排障用（正常调用不会带）
  achievements.checkUser(userId, { force: req.query.force === '1' });
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
    // ⚠️ 现金余额取 PRACTICE：证券的钱是练习金，取 CASH+GRANT 会让
    // 「买入花掉的钱」既不在余额里、又要在 net_invest 里，pnl 直接算错。
    var accounts = db.prepare([
      'SELECT a.owner_id AS user_id,',
      "  COALESCE((SELECT b.balance FROM xy_ledger_balances b",
      "            WHERE b.account_id = a.id AND b.asset = 'PRACTICE'), 0) AS balance,",
      '  u.net_name, u.real_name',
      'FROM xy_ledger_accounts a',
      'JOIN stock_account s ON s.user_id = a.owner_id',
      'LEFT JOIN users u ON u.user_id = a.owner_id',
      "WHERE a.kind = 'user'"
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
    matching: '成交价以真实市场价为准：连续竞价按最新价；9:25 后按开盘价；15:00 后按收盘价。限价买单不高于委托价成交，限价卖单不低于委托价成交。',
    expiry: '长期有效委托会一直有效，直到成交或你主动撤单；当日有效委托在当天收盘结算后（15:02）自动撤销并解冻。若委托价超出了当天的涨跌停范围，会在下一次撮合时自动作废并解冻资金。',
    condition: '条件单只支持卖出：止损（跌破触发价）、止盈（涨到触发价）、移动止损（从最高点回撤指定比例）。挂单冻结对应股数，触发后按市价卖出；没触发可随时撤单，当日有效单到期自动撤销。',
    alert: '到价提醒只发站内消息：个股详情页点铃铛，设置「涨到 / 跌到」某个价格，行情满足时顶栏铃铛提示，触发一次后自动结束，不会自动下单。',
    risk: '单日最多 100 笔委托、单笔最多 10 万股、同时最多 20 条条件单；单笔数量与价格还会受涨跌停和可用资金/持仓约束。',
    orderWindow: '限价委托任何时间都能下 —— 晚上、周末、节假日都可以，休市时挂单不收费、也不会消失；市价委托需要今天的真实行情，休市或行情延迟时会提示改限价。',
    session_note: '集合竞价（9:15–9:25、14:57–15:00）只收单不成交：9:25 后按开盘价撮合，15:00 后按收盘价结算；连续竞价（9:30–11:30、13:00–14:57）按最新价成交。休市期间委托排队等待。',
    market_order: '市价单必须基于今天的真实行情：行情延迟、节假日或停牌时会拒绝，请改限价委托排队；开市时按最新价立即成交，休市时排队等下一次撮合。'
  });
}));

module.exports = router;
