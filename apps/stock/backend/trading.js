// 交易核心：下单 / 撮合 / 撤单 / 清算
// ============================================================
// 这里实现的是**真实 A 股规则**的模拟盘，钱是学元。
// 与真实券商一致的部分（不要为了省事改掉，否则就成游戏了）：
//   · 涨跌停：主板 ±10%、创业板/科创板 ±20%，超价直接废单
//   · 涨停买不到、跌停卖不掉（挂单排队，不强行成交）
//   · 100 股一手；零股只能一次性卖出
//   · 佣金万 2.5 最低 5 元、印花税卖出 0.05%、过户费 0.001%
//   · 9:25 集合竞价按开盘价撮合
//
// 与真实券商不同的部分（都是有意的）：
//   · **T+0：当天买的当天就能卖**（2026-11-03）。校园平板不是天天开，
//     T+1 会让「今天买的明天才能卖」直接卡死学生。真实 A 股仍是 T+1，
//     规则页与指南都写明了这一点 —— 放宽体验，但不能记错规则。
//   · **委托长期有效**：晚上/周末挂单不失效，开盘自动撮合；只有「委托价
//     已出当日涨跌停范围」的死单会在撮合时作废并解冻。
//   · 不撮合部分成交（学生资金量小，一次成交即可，也避免碎股）

//
// 编码约定：var / function

var nodePath = require('path');
var market = require('./market');
var quotes = require('./quotes');
var store = require('./store');
var notify = require('./notify');
// 第三方应用：只能通过平台能力面访问练习金，不能碰真钱与赠金。
var app = require('_sdk/backend/host').ledger;

// ---- 统一错误 ----
function TradeError(msg) {
  var e = new Error(msg);
  e.isTradeError = true;
  return e;
}

// ---- 账户视图 ----
// 把「学元账户 + 持仓 + 行情」合成一份对学生有意义的资产视图。
// 口径：
//   total_asset = 可用学元 + 冻结学元 + 持仓市值
//   today_pnl   = Σ 持仓数量 × (现价 - 昨收) + 今日已实现盈亏
//   total_pnl   = Σ (持仓市值 - 持仓成本) + 累计已实现盈亏
function accountSummary(userId, snapshot) {
  var today = market.dateKey();
  store.settleT1(userId, today);

  var acc = app.practiceAccount('stock', userId);
  var positions = store.listPositions(userId);
  var byCode = (snapshot && snapshot.byCode) || {};

  var items = [];
  var marketValue = 0;
  var costTotal = 0;
  var todayPnl = 0;

  for (var i = 0; i < positions.length; i++) {
    var p = positions[i];
    var q = byCode[p.code] || null;
    var last = q ? q.price_cent : 0;
    var prevClose = q ? q.prev_close_cent : last;
    var mv = last * p.qty;
    var pnl = mv - p.cost_cent;
    var dayPnl = (last - prevClose) * p.qty;
    var pendingSell = frozenSellQty(userId, p.code);

    marketValue += mv;
    costTotal += p.cost_cent;
    todayPnl += dayPnl;

    items.push({
      code: p.code,
      name: p.name || (q && q.name) || p.code,
      qty: p.qty,
      available_qty: Math.max(0, p.available_qty - pendingSell),
      t1_locked_qty: p.qty - p.available_qty,
      pending_sell_qty: pendingSell,
      cost_cent: p.cost_cent,
      avg_cost: p.qty > 0 ? Math.round(p.cost_cent / p.qty) / 100 : 0,
      price: last / 100,
      price_cent: last,
      change_pct: q ? q.change_pct : 0,
      market_value: mv / 100,
      market_value_cent: mv,
      pnl: pnl / 100,
      pnl_cent: pnl,
      pnl_pct: p.cost_cent > 0 ? Math.round(pnl / p.cost_cent * 10000) / 100 : 0,
      day_pnl: dayPnl / 100,
      day_pnl_cent: dayPnl,
      opened_at: p.opened_at || 0,
      hold_days: p.opened_at ? Math.floor((Date.now() - p.opened_at) / 86400000) : 0,
      stale: q ? !!q.stale : true
    });
  }

  var row = store.ensureAccount(userId);
  var realized = row.realized_cent || 0;
  var todayRealized = store.db().prepare(
    'SELECT COALESCE(SUM(realized_cent), 0) AS s FROM stock_trades WHERE user_id = ? AND trade_date = ?'
  ).get(userId, today).s;

  // ---- 今日复盘：教「交易频率 × 费用」这件事 ----
  // 学生每天最多看几笔，这里只在打开应用时算一次聚合（都走索引，几十行）
  var dayAgg = store.db().prepare([
    'SELECT COUNT(*) AS n,',
    '  COALESCE(SUM(CASE WHEN side = ? THEN amount_cent ELSE 0 END), 0) AS buy_amt,',
    '  COALESCE(SUM(CASE WHEN side = ? THEN amount_cent ELSE 0 END), 0) AS sell_amt,',
    '  COALESCE(SUM(fee_cent), 0) AS fee',
    'FROM stock_trades WHERE user_id = ? AND trade_date = ?'
  ].join('\n')).get('buy', 'sell', userId, today);

  var best = null;
  var worst = null;
  for (var bi = 0; bi < items.length; bi++) {
    var pi = items[bi];
    if (!best || pi.pnl_cent > best.pnl_cent) best = pi;
    if (!worst || pi.pnl_cent < worst.pnl_cent) worst = pi;
  }

  var review = {
    trades: dayAgg.n || 0,
    buy_amount: (dayAgg.buy_amt || 0) / 100,
    sell_amount: (dayAgg.sell_amt || 0) / 100,
    fee: (dayAgg.fee || 0) / 100,
    realized: todayRealized / 100,
    today_pnl: (todayPnl + todayRealized) / 100,
    // 费用占「今日成交额」的比例 —— 比占本金更能说明「交易有多贵」
    fee_rate: (dayAgg.buy_amt + dayAgg.sell_amt) > 0
      ? Math.round((dayAgg.fee || 0) / (dayAgg.buy_amt + dayAgg.sell_amt) * 10000) / 100
      : 0,
    best: best ? { code: best.code, name: best.name, pnl: best.pnl, pnl_pct: best.pnl_pct } : null,
    worst: worst ? { code: worst.code, name: worst.name, pnl: worst.pnl, pnl_pct: worst.pnl_pct } : null,
    tip: ''
  };
  if (review.trades >= 6) {
    review.tip = '今天成交 ' + review.trades + ' 笔、费用 ' + review.fee.toFixed(2) +
      ' 学元 —— 手续费已经吃掉成交额的 ' + review.fee_rate.toFixed(2) + '%。频繁交易是新手亏损的头号原因。';
  } else if (review.trades === 0 && items.length > 0) {
    review.tip = '今天没有交易。拿住不动也是一种策略 —— 但要清楚自己为什么持有它。';
  } else if (review.trades > 0) {
    review.tip = '今天成交 ' + review.trades + ' 笔，费用 ' + review.fee.toFixed(2) + ' 学元。收盘前花两分钟复盘：每一笔都有理由吗？';
  } else {
    review.tip = '还没有交易记录。先去「行情」挑一只看得懂的公司。';
  }

  return {
    // 证券账户口径 = 练习金（practice 池）。真钱在 wallet 里，只展示、不可交易。
    // 练习金是独立资金池：印多少都只在证券里循环，不会稀释消费市场的购买力。
    cash: {
      // 能力面只下发「分」，学元单位在这里换算 —— 应用侧不要自己再乘除。
      balance: acc.practice_cent / 100,
      frozen: acc.frozen_practice_cent / 100,
      available: acc.available_practice_cent / 100,
      balance_cent: acc.practice_cent,
      frozen_cent: acc.frozen_practice_cent,
      available_cent: acc.available_practice_cent
    },
    // 真钱余额：让页面上能解释「为什么我充的钱不能买股票」
    wallet: {
      // 第三方应用拿不到真钱口径（app-api 恒返回 0），这两个字段只为兼容旧前端
      balance: (acc.cash_cent || 0) / 100,
      available: (acc.cash_cent || 0) / 100,
      balance_cent: acc.cash_cent || 0,
      available_cent: acc.cash_cent || 0
    },
    positions: items,
    totals: {
      market_value: marketValue / 100,
      market_value_cent: marketValue,
      cost: costTotal / 100,
      cost_cent: costTotal,
      total_asset: (acc.practice_cent + marketValue) / 100,
      total_asset_cent: acc.practice_cent + marketValue,
      today_pnl: (todayPnl + todayRealized) / 100,
      today_pnl_cent: todayPnl + todayRealized,
      total_pnl: (marketValue - costTotal + realized) / 100,
      total_pnl_cent: marketValue - costTotal + realized,
      realized: realized / 100,
      position_pnl: (marketValue - costTotal) / 100
    },
    stats: {
      trade_count: row.trade_count || 0,
      fee_total: (row.fee_total_cent || 0) / 100,
      position_count: items.length
    },
    review: review,
    session: market.sessionForSnapshot(market.currentSession(), snapshot),
    stale: !!(snapshot && snapshot.stale)
  };
}

// ---- 风控护栏 ----
// 校园盘不需要高频交易：单日 100 笔、单笔 10 万股、同时 20 条条件单，
// 足以覆盖正常使用，同时拦住脚本刷单/异常大单。
var MAX_DAILY_ORDERS = 100;
var MAX_ORDER_QTY = 100000;
var MAX_ACTIVE_CONDITIONS = 20;

function assertOrderBudget(userId, now) {
  var today = market.dateKey(now);
  var n = Number(store.db().prepare('SELECT COUNT(*) AS n FROM stock_orders WHERE user_id = ? AND trade_date = ?')
    .get(String(userId), today).n) || 0;
  if (n >= MAX_DAILY_ORDERS) {
    throw TradeError('今天委托已满 ' + MAX_DAILY_ORDERS + ' 笔，明天再来或先撤掉未成交的委托');
  }
}

// 已挂卖单/条件单冻结的股数（持仓表不动，靠订单汇总算「真正可卖」）
function frozenSellQty(userId, code) {
  var row = store.db().prepare([
    "SELECT COALESCE(SUM(frozen_qty), 0) AS s FROM stock_orders",
    "WHERE user_id = ? AND code = ? AND side = 'sell' AND status IN ('pending', 'armed')"
  ].join('\n')).get(userId, code);
  return row ? row.s : 0;
}

// ---- 下单 ----
// params: { code, side: 'buy'|'sell', type: 'limit'|'market', price: 元, qty: 股 }
function placeOrder(userId, params) {
  var p = params || {};
  var now = Date.now();
  var session = market.currentSession(now);

  // 2026-11-03 起两类委托全时段可下（见 market.canPlaceOrder 的注释）：
  // 休市时市价单入队，下一次撮合按当时价格成交（集合竞价按开盘价）。
  var code = market.normalizeCode(p.code);
  if (!code) throw TradeError('股票代码不合法');
  if (!quotes.isTradable(code)) throw TradeError('该股票不在本模拟盘的可交易范围内');

  var side = p.side === 'sell' ? 'sell' : (p.side === 'buy' ? 'buy' : null);
  if (!side) throw TradeError('买卖方向不合法');

  var orderType = p.type === 'market' ? 'market' : 'limit';
  var qty = parseInt(p.qty, 10);
  if (!isFinite(qty) || qty <= 0) throw TradeError('委托数量不合法');
  if (qty > MAX_ORDER_QTY) throw TradeError('单笔最多 ' + MAX_ORDER_QTY + ' 股');
  assertOrderBudget(userId, now);
  var validity = p.validity === 'day' ? 'day' : 'long';
  var expiresAt = validity === 'day' ? market.nextCloseMs(now) : 0;

  var today = market.dateKey(now);
  store.settleT1(userId, today);

  return quotes.getQuote(code).then(function (q) {
    if (!q.price || q.price <= 0) throw TradeError('该股票当前无法交易（可能停牌）');

    // 市价单必须基于今天的真实行情。断网兜底价/节假日昨收价只能用于展示，
    // 拿来下市价单会让学生以为成交在假价格上；限价单仍可排队，等开盘再撮合。
    var quoteIsToday = q.quote_date === market.dateKey(now) ||
      process.env.STOCK_FORCE_TRADABLE === '1';
    if (orderType === 'market' && (q.stale || !quoteIsToday)) {
      throw TradeError('当前行情不是今天的，暂不能下市价单；可改限价委托，等开盘后自动撮合');
    }

    var lastCent = q.price_cent;
    var priceCent;
    var priceYuan;

    if (orderType === 'market') {
      priceCent = lastCent;
      priceYuan = q.price;
    } else {
      var priceInput = Number(p.price);
      if (!isFinite(priceInput) || priceInput <= 0) throw TradeError('请输入委托价格');
      priceYuan = market.roundPrice(priceInput);
      priceCent = Math.round(priceYuan * 100);
      if (priceCent > Math.round(q.limit_up * 100)) throw TradeError('委托价高于涨停价 ' + q.limit_up.toFixed(2) + ' 元');
      if (priceCent < Math.round(q.limit_down * 100)) throw TradeError('委托价低于跌停价 ' + q.limit_down.toFixed(2) + ' 元');
    }

    if (side === 'buy') {
      if (qty < market.MIN_BUY_QTY) throw TradeError('买入最少 ' + market.MIN_BUY_QTY + ' 股（1 手）');
      if (qty % market.LOT_SIZE !== 0) throw TradeError('买入数量必须是 100 股的整数倍');

      var amount = priceCent * qty;
      var fees = market.calcFees('buy', amount);
      // 市价单成交价在撮合那一刻才确定。冻结额按「当日涨停价×数量 + 对应费用」留足：
      // 主板±10% / 创业科创±20% / 北交所±30% 全覆盖，撮合价永远 ≤ 当日涨停价。
      // 旧版固定 10% 缓冲盖不住创业板的隔夜跳空 → 「成本与手续费超过冻结额」。
      // 隔夜单次日涨停价抬高的部分由 tryFill 前的 ensureHoldCovers 按当日行情补冻结。
      var worstCent = orderType === 'market'
        ? Math.round(q.limit_up * 100)
        : priceCent;
      var worstAmount = worstCent * qty;
      var worstFees = market.calcFees('buy', worstAmount);
      var holdCent = worstAmount + worstFees.total_cent;

      // 资金校验只看练习金：它是证券唯一的资金来源，
      // 真钱与赠送学元在账本上根本不参与这条链路。
      var accAvail = app.practiceAccount('stock', userId);
      var availCent = accAvail.available_practice_cent;
      if (availCent < holdCent) {
        var maxQty = market.maxBuyQty(availCent, worstCent / 100);
        if (!maxQty) {
          throw TradeError('练习金不足：一手（100 股）需要约 ' +
            ((priceCent * 100 + fees.total_cent) / 100).toFixed(2) + ' 学元，当前可用 ' +
            (availCent / 100).toFixed(2) + ' 学元');
        }
        throw TradeError('练习金不足（按 ' + priceYuan.toFixed(2) + ' 元最多可买 ' + maxQty + ' 股）');
      }

      return doBuy(userId, q, qty, priceCent, orderType, holdCent, session, today, now, validity, expiresAt);
    }

    // ---- 卖出 ----
    var pos = store.getPosition(userId, code);
    var frozen = frozenSellQty(userId, code);
    var sellable = pos ? pos.available_qty - frozen : 0;
    if (!pos || pos.qty <= 0) throw TradeError('没有可卖持仓');
    if (sellable <= 0) {
      // 分开说清楚：全被挂单占用 vs 数据未解锁 —— 学生看到的提示要能自己解决
      if (frozen > 0) throw TradeError('可卖 0 股：持仓 ' + pos.qty + ' 股里有 ' + frozen + ' 股已被卖单占用，先撤单再卖');
      throw TradeError('可卖 0 股：持仓 ' + pos.qty + ' 股尚未解锁，下拉刷新一下持仓页即可');
    }
    if (qty > sellable) throw TradeError('可卖数量不足（当前可卖 ' + sellable + ' 股）');
    if (qty < market.LOT_SIZE && qty !== sellable) {
      throw TradeError('零股（不足 100 股）必须一次性全部卖出');
    }
    if (qty >= market.LOT_SIZE && qty % market.LOT_SIZE !== 0 && qty !== sellable) {
      throw TradeError('卖出数量必须是 100 股的整数倍（或一次性卖完全部持仓）');
    }

    return doSell(userId, q, qty, priceCent, orderType, session, today, now, validity, expiresAt);
  });
}

// ---- 条件单（止损 / 止盈）----
// 只做卖出：挂单时冻结对应股数，行情触发后转成市价卖单，由撮合器按当时价格成交。
// 这样学生的「跌破 9 元就跑」不需要一直盯盘，也不会因为条件单没冻结而被别的卖单抢走。
function placeConditional(userId, params) {
  var p = params || {};
  var now = Date.now();
  var code = market.normalizeCode(p.code);
  if (!code) throw TradeError('股票代码不合法');
  if (!quotes.isTradable(code)) throw TradeError('该股票不在本模拟盘的可交易范围内');

  var triggerType = ['take_profit', 'stop_loss', 'trailing_stop'].indexOf(p.trigger_type) >= 0
    ? p.trigger_type : null;
  if (!triggerType) throw TradeError('条件类型只能是止损、止盈或移动止损');

  var qty = parseInt(p.qty, 10);
  if (!isFinite(qty) || qty <= 0) throw TradeError('委托数量不合法');
  if (qty > MAX_ORDER_QTY) throw TradeError('单笔最多 ' + MAX_ORDER_QTY + ' 股');
  assertOrderBudget(userId, now);
  var activeCond = Number(store.db().prepare(
    "SELECT COUNT(*) AS n FROM stock_orders WHERE user_id = ? AND status = 'armed'"
  ).get(String(userId)).n) || 0;
  if (activeCond >= MAX_ACTIVE_CONDITIONS) {
    throw TradeError('同时最多挂 ' + MAX_ACTIVE_CONDITIONS + ' 条条件单，先撤掉一些');
  }

  var trailPercent = 0;
  var triggerInput = 0;
  if (triggerType === 'trailing_stop') {
    trailPercent = Number(p.trail_percent);
    if (!isFinite(trailPercent) || trailPercent < 0.5 || trailPercent > 20) {
      throw TradeError('移动止损回撤比例需在 0.5%–20% 之间');
    }
  } else {
    triggerInput = Number(p.trigger_price);
    if (!isFinite(triggerInput) || triggerInput <= 0) throw TradeError('请输入触发价');
  }
  var triggerCent = triggerInput > 0 ? Math.round(market.roundPrice(triggerInput) * 100) : 0;

  var validity = p.validity === 'day' ? 'day' : 'long';
  var expiresAt = validity === 'day' ? market.nextCloseMs(now) : 0;
  var today = market.dateKey(now);
  store.settleT1(userId, today);

  return quotes.getQuote(code).then(function (q) {
    if (!q.price || q.price <= 0) throw TradeError('该股票当前无法交易（可能停牌）');
    var lastCent = q.price_cent;
    var peakCent = 0;
    if (triggerType === 'trailing_stop') {
      // 初始触发价按「当前价回撤 N%」；之后峰值上移，触发线跟着上移，只上不下。
      peakCent = lastCent;
      triggerCent = Math.max(1, Math.round(lastCent * (100 - trailPercent) / 100));
      if (triggerCent < Math.round(q.limit_down * 100)) {
        throw TradeError('回撤太深：初始触发价低于跌停价 ' + q.limit_down.toFixed(2) +
          ' 元，请减小回撤比例');
      }
    } else {
      if (triggerCent > Math.round(q.limit_up * 100)) {
        throw TradeError('触发价高于涨停价 ' + q.limit_up.toFixed(2) + ' 元');
      }
      if (triggerCent < Math.round(q.limit_down * 100)) {
        throw TradeError('触发价低于跌停价 ' + q.limit_down.toFixed(2) + ' 元');
      }
      if (triggerType === 'stop_loss' && triggerCent >= lastCent) {
        throw TradeError('止损触发价要低于现价 ' + q.price.toFixed(2) + ' 元');
      }
      if (triggerType === 'take_profit' && triggerCent <= lastCent) {
        throw TradeError('止盈触发价要高于现价 ' + q.price.toFixed(2) + ' 元');
      }
    }

    var orderId = 0;
    store.db().transaction(function () {
      var pos = store.getPosition(userId, code);
      var frozen = frozenSellQty(userId, code);
      var sellable = pos ? pos.available_qty - frozen : 0;
      if (!pos || pos.qty <= 0) throw TradeError('没有可卖持仓');
      if (sellable <= 0) {
        throw TradeError(frozen > 0
          ? '可卖 0 股：持仓里有 ' + frozen + ' 股已被卖单/条件单占用，先撤单再挂'
          : '可卖 0 股：持仓尚未解锁，下拉刷新一下持仓页即可');
      }
      if (qty > sellable) throw TradeError('可卖数量不足（当前可卖 ' + sellable + ' 股）');
      if (qty < market.LOT_SIZE && qty !== sellable) {
        throw TradeError('零股（不足 100 股）必须一次性全部卖出');
      }
      if (qty >= market.LOT_SIZE && qty % market.LOT_SIZE !== 0 && qty !== sellable) {
        throw TradeError('卖出数量必须是 100 股的整数倍（或一次性卖完全部持仓）');
      }

      var info = store.db().prepare([
        'INSERT INTO stock_orders (user_id, code, name, side, order_type, price_cent, qty,',
        '  status, frozen_qty, trade_date, validity, expires_at, trigger_type, trigger_cent,',
        '  trail_percent, peak_cent, created_at, updated_at)',
        "VALUES (?, ?, ?, 'sell', 'condition', ?, ?, 'armed', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
      ].join('\n')).run(userId, code, q.name, triggerCent, qty, qty, today,
        validity, expiresAt, triggerType, triggerCent, trailPercent, peakCent, now, now);
      orderId = Number(info.lastInsertRowid);
    })();

    var order = store.getOrder(userId, orderId);
    return {
      order: order,
      session: market.currentSession(now),
      message: triggerType === 'stop_loss'
        ? ('止损条件单已挂出：跌到 ' + (triggerCent / 100).toFixed(2) + ' 元自动卖出')
        : (triggerType === 'take_profit'
          ? ('止盈条件单已挂出：涨到 ' + (triggerCent / 100).toFixed(2) + ' 元自动卖出')
          : ('移动止损已挂出：从最高价回撤 ' + trailPercent + '% 自动卖出'))
    };
  });
}

function doBuy(userId, q, qty, priceCent, orderType, holdCent, session, today, now, validity, expiresAt) {
  var orderId = 0;
  // 「冻结资金 + 建委托」必须原子：否则冻结成功而建单失败，钱就卡在 frozen 里
  store.db().transaction(function () {
    // 证券只允许用「练习金」（赠送池）交易。
    // 这是整个体系的安全边界：真钱（充值学元）永远不进股市，
    // 所以学生亏的不是家长交的现金，平台也不会被「收益提现」套利。
    try {
      app.reserve('stock', userId, holdCent);
    } catch (e) {
      if (/练习金不足|练习金可用不足/.test(e.message)) {
        throw new Error('练习金不足：本单需要 ' + (holdCent / 100) +
          ' 学元，卖出持仓或等下月补发后再买');
      }
      throw e;
    }
    var info = store.db().prepare([
      'INSERT INTO stock_orders (user_id, code, name, side, order_type, price_cent, qty,',
      '  status, hold_cent, trade_date, validity, expires_at, created_at, updated_at)',
      "VALUES (?, ?, ?, 'buy', ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?)"
    ].join('\n')).run(userId, q.code, q.name, orderType, priceCent, qty, holdCent, today,
      validity || 'long', expiresAt || 0, now, now);
    orderId = Number(info.lastInsertRowid);
  })();

  var filled = null;
  if (session.settles) {
    filled = tryFill(store.getOrder(userId, orderId), q, now);
  }

  return {
    order: store.getOrder(userId, orderId),
    filled: filled,
    message: filled ? '已成交'
      : (session.settles ? '委托已提交，等待成交' : '委托已排队，将在下一交易时段按市场价撮合'),
    session: session
  };
}

function doSell(userId, q, qty, priceCent, orderType, session, today, now, validity, expiresAt) {
  var orderId = 0;
  // 可卖校验与建单放在同一事务里：并发两笔卖单不会都通过检查
  store.db().transaction(function () {
    var pos = store.getPosition(userId, q.code);
    var sellable = pos ? pos.available_qty - frozenSellQty(userId, q.code) : 0;
    if (qty > sellable) throw TradeError('可卖数量不足（当前可卖 ' + sellable + ' 股）');

    var info = store.db().prepare([
      'INSERT INTO stock_orders (user_id, code, name, side, order_type, price_cent, qty,',
      '  status, frozen_qty, trade_date, validity, expires_at, created_at, updated_at)',
      "VALUES (?, ?, ?, 'sell', ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?)"
    ].join('\n')).run(userId, q.code, q.name, orderType, priceCent, qty, qty, today,
      validity || 'long', expiresAt || 0, now, now);
    orderId = Number(info.lastInsertRowid);
  })();

  var filled = null;
  if (session.settles) {
    filled = tryFill(store.getOrder(userId, orderId), q, now);
  }

  return {
    order: store.getOrder(userId, orderId),
    filled: filled,
    message: filled ? '已成交'
      : (session.settles ? '委托已提交，等待成交' : '委托已排队，将在下一交易时段按市场价撮合'),
    session: session
  };
}

// 撮合前的冻结额校正（隔夜 / 涨停价抬高的市价买单）：
// 成交价永远 ≤ 当日涨停价，只要冻结额覆盖「当日涨停价×数量 + 费」就绝不会超冻结。
// 差额从可用练习金补冻结（幂等 ref），补不了就保持 pending 等回落/撤单——
// 不炸单、不吞钱、不制造「重新买入失败」。补冻结与改 hold_cent 必须同一事务。
function ensureHoldCovers(order, quote, now) {
  if (order.side !== 'buy' || !(order.hold_cent > 0)) return true;
  var upCent = Math.round(quote.limit_up * 100);
  if (!(upCent > 0)) return true;
  var need = upCent * order.qty + market.calcFees('buy', upCent * order.qty).total_cent;
  if (need <= order.hold_cent) return true;

  var gap = need - order.hold_cent;
  var d = store.db();
  try {
    d.transaction(function () {
      app.reserve('stock', order.user_id, gap, 'stock:order:' + order.id + ':topup', '市价单按当日涨停价补冻结');
      var upd = d.prepare(
        "UPDATE stock_orders SET hold_cent = ?, updated_at = ? WHERE id = ? AND status = 'pending'"
      ).run(need, now, order.id);
      if (!upd.changes) throw new Error('委托状态已变化，补冻结回滚');
    })();
    order.hold_cent = need;
    return true;
  } catch (e) {
    // 补不了（可用练习金不够 / 并发）：留单等价格回落，写清原因，绝不标 rejected 吞冻结
    try {
      d.prepare("UPDATE stock_orders SET reason = ?, updated_at = ? WHERE id = ? AND status = 'pending'")
        .run('冻结额待补足，等价格回落或撤单', now, order.id);
    } catch (e2) { /* 状态已变，无妨 */ }
    return false;
  }
}

// ---- 撮合 ----
// 行情能不能拿来成交：断网兜底的模拟价、节假日仍在返回的昨收价，都不许成交。
// 测试通道（STOCK_FORCE_TRADABLE=1）允许用最近收盘价跑通链路，生产不会带这个变量。
function quoteAllowsFill(quote, now) {
  if (!quote || quote.stale) return false;
  if (!(Number(quote.price_cent) > 0)) return false;
  if (process.env.STOCK_FORCE_TRADABLE === '1') return true;
  var qd = String(quote.quote_date || '');
  if (!qd) return false;
  return qd === market.dateKey(now || Date.now());
}

// 返回成交结果或 null（未成交）
function tryFill(order, quote, now) {
  if (!order || order.status !== 'pending') return null;
  if (!quoteAllowsFill(quote, now)) return null;

  var lastCent = quote.price_cent;
  if (!(lastCent > 0)) return null;

  // 冻结额必须先覆盖当日最坏成交价，否则宁可等一轮也不做「注定超冻结」的撮合
  if (!ensureHoldCovers(order, quote, now)) return null;

  // 涨停买不到 / 跌停卖不掉：这是真实市场的常态，不做「强行成交」
  var atLimitUp = lastCent >= Math.round(quote.limit_up * 100);
  var atLimitDown = lastCent <= Math.round(quote.limit_down * 100);

  var fillCent;
  if (order.order_type === 'market') {
    if (order.side === 'buy' && atLimitUp) return null;
    if (order.side === 'sell' && atLimitDown) return null;
    fillCent = lastCent;
  } else if (order.side === 'buy') {
    // 限价买：现价 ≤ 委托价才能成交；涨停时排队买不到
    if (atLimitUp) return null;
    if (lastCent > order.price_cent) return null;
    fillCent = Math.min(lastCent, order.price_cent);
  } else {
    if (atLimitDown) return null;
    if (lastCent < order.price_cent) return null;
    fillCent = Math.max(lastCent, order.price_cent);
  }

  // 乐观锁：只有成功把 pending → filled 的那一方才执行资金/持仓变更
  var claim = store.db().prepare(
    "UPDATE stock_orders SET status = 'filled', updated_at = ? WHERE id = ? AND status = 'pending'"
  ).run(now, order.id);
  if (!claim.changes) return null;

  var amount = fillCent * order.qty;
  var fees = market.calcFees(order.side, amount);
  var today = market.dateKey(now);

  try {
    if (order.side === 'buy') {
      fillBuy(order, fillCent, amount, fees, now, today);
    } else {
      fillSell(order, fillCent, amount, fees, now, today);
    }
  } catch (e) {
    // 资金/持仓异常：把订单标成 rejected 并解冻，绝不留下「已成交但没扣钱」
    store.db().prepare("UPDATE stock_orders SET status = 'rejected', reason = ?, updated_at = ? WHERE id = ?")
      .run(String(e.message || e).slice(0, 200), now, order.id);
    if (order.side === 'buy' && order.hold_cent) {
      // 失败路径必须把钱退干净；确定性 ref 让「已退过」幂等，绝不静默吞错——
      // 以前 catch(e2){} 一吞，钱就卡在 frozen_practice 里，学生重买必报练习金不足。
      try {
        app.release('stock', order.user_id, order.hold_cent, 'stock:order:' + order.id + ':release', '结算失败解冻');
      } catch (e2) {
        console.error('[stock] 结算失败后解冻也失败 order=' + order.id + ':', e2.message);
        store.db().prepare("UPDATE stock_orders SET reason = ? WHERE id = ?")
          .run('结算失败且解冻异常：' + String(e2.message || e2).slice(0, 100), order.id);
      }
    }
    console.error('[stock] 成交结算失败 order=' + order.id + ':', e.message);
    return null;
  }

  var trade = store.db().prepare('SELECT * FROM stock_trades WHERE order_id = ? ORDER BY id DESC LIMIT 1')
    .get(order.id);

  // 成就检查（成交是多数成就的触发点；失败不影响成交本身）
  var achievements = [];
  try {
    achievements = require('./achievements').checkAfterTrade(order.user_id).unlocked;
  } catch (e) {
    console.error('[stock] 成就检查失败:', e.message);
  }

  return { order: store.getOrder(order.user_id, order.id), trade: trade, achievements: achievements };
}

function fillBuy(order, fillCent, amount, fees, now, today) {
  var d = store.db();
  var cost = amount + fees.total_cent;

  d.transaction(function () {
    // 1) 资金：解冻整笔委托额，按实际成交额+费用扣款，差额自动回可用
    var settled = app.settleBuy('stock', {
      userId: order.user_id,
      holdCent: order.hold_cent,
      // ⚠️ costCent 只传「成交额」，手续费单独传 feeCent。
      // 结算层内部按 cost + fee 校验冻结额；以前这里把已含费的 cost 当 costCent 传，
      // 手续费被算了两遍 → 限价单只要有佣金就必报「成本与手续费超过冻结额」，
      // 市价单靠 10% 缓冲时好时坏，失败后钱还卡在冻结里导致重买失败（2026-11-09 修）。
      costCent: amount,
      feeCent: fees.total_cent,
      ref: 'stock:order:' + order.id,
      memo: '买入 ' + order.name + '(' + order.code + ') ' + order.qty + ' 股',
      meta: { order_id: order.id, code: order.code, side: 'buy', price_cent: fillCent, qty: order.qty }
    });

    // 成本来源：settleHold 会告知这次实际从充值/赠送/练习金各扣了多少（含费用）。
    // 持仓必须记住这个拆分，卖出时本金才能原路退回，而不是一律变充值学元。
    var spent = (settled && settled.spent) ? settled.spent : null;
    var costCash = spent ? Math.max(0, Math.round(spent.cash_cent || 0)) : 0;
    var costGrant = spent ? Math.max(0, Math.round(spent.grant_cent || 0)) : 0;
    var costPractice = spent ? Math.max(0, Math.round(spent.practice_cent || 0)) : 0;
    if (costCash + costGrant + costPractice !== cost) {
      // 兜底：不足部分按练习金计（证券唯一合法的资金来源），
      // 保证三支之和等于总成本，且不会把差额算进可花余额。
      costPractice = Math.max(0, cost - costCash - costGrant);
    }

    // 2) 持仓：数量与可卖数量一起增加（T+0）
    // 2026-11-03 产品决策：校园平板不是天天开，T+1 会让「今天买的明天才能卖」
    // 直接卡死学生 —— 教学盘改为当天可卖。真实 A 股仍是 T+1，规则页与指南都写明了。
    var pos = store.getPosition(order.user_id, order.code);
    if (pos) {
      d.prepare([
        'UPDATE stock_positions SET qty = qty + ?, available_qty = available_qty + ?,',
        '  cost_cent = cost_cent + ?, cost_cash_cent = cost_cash_cent + ?,',
        '  cost_grant_cent = cost_grant_cent + ?, cost_practice_cent = cost_practice_cent + ?,',
        '  name = ?, updated_at = ?',
        'WHERE user_id = ? AND code = ?'
      ].join('\n')).run(order.qty, order.qty, cost, costCash, costGrant, costPractice,
        order.name, now, order.user_id, order.code);
    } else {
      d.prepare([
        'INSERT INTO stock_positions',
        '  (user_id, code, name, qty, available_qty, cost_cent, cost_cash_cent, cost_grant_cent,',
        '   cost_practice_cent, opened_at, updated_at)',
        'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
      ].join('\n')).run(order.user_id, order.code, order.name, order.qty, order.qty,
        cost, costCash, costGrant, costPractice, now, now);
    }

    // 3) 订单与成交明细
    d.prepare('UPDATE stock_orders SET filled_qty = qty, avg_fill_cent = ?, fee_cent = ?, filled_at = ? WHERE id = ?')
      .run(fillCent, fees.total_cent, now, order.id);
    d.prepare([
      'INSERT INTO stock_trades (order_id, user_id, code, name, side, price_cent, qty, amount_cent,',
      '  commission_cent, stamp_cent, transfer_cent, fee_cent, realized_cent, trade_date, created_at)',
      "VALUES (?, ?, ?, ?, 'buy', ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)"
    ].join('\n')).run(order.id, order.user_id, order.code, order.name, fillCent, order.qty, amount,
      fees.commission_cent, fees.stamp_cent, fees.transfer_cent, fees.total_cent, today, now);

    d.prepare([
      'UPDATE stock_account SET trade_count = trade_count + 1,',
      '  fee_total_cent = fee_total_cent + ? WHERE user_id = ?'
    ].join('\n')).run(fees.total_cent, order.user_id);

    // 4) 站内通知（失败不影响成交）
    try { notify.notifyFill(order, fillCent, order.qty, 0, fees.total_cent); } catch (e) {
      console.error('[stock] 成交通知写入失败 order=' + order.id + ':', e.message);
    }
  })();
}

function fillSell(order, fillCent, amount, fees, now, today) {
  var d = store.db();
  var pos = store.getPosition(order.user_id, order.code);
  if (!pos || pos.qty < order.qty) throw new Error('持仓不足');

  // 成本按比例冲减：卖出 30% 就带走 30% 的成本。
  // 成本要按「充值 / 赠送 / 练习金」三个来源分别带走 —— 练习金买来的股票，
  // 卖出后本金必须回练习金池，一分钱都不许流进可消费、可提现的池子。
  var ratio = order.qty / pos.qty;
  var baseCash = Math.max(0, pos.cost_cash_cent || 0);
  var baseGrant = Math.max(0, pos.cost_grant_cent || 0);
  var basePractice = Math.max(0, pos.cost_practice_cent || 0);
  if (baseCash === 0 && baseGrant === 0 && basePractice === 0 && pos.cost_cent > 0) {
    // 老数据没有来源记录：按赠送处理（安全侧）
    baseGrant = pos.cost_cent;
  }
  var costOut = Math.round(pos.cost_cent * ratio);
  var baseSum = baseCash + baseGrant + basePractice;
  var costOutCash = 0;
  var costOutGrant = 0;
  var costOutPractice = 0;
  if (costOut > 0 && baseSum > 0) {
    costOutCash = Math.min(costOut, Math.round(costOut * (baseCash / baseSum)));
    costOutPractice = Math.min(costOut - costOutCash, Math.round(costOut * (basePractice / baseSum)));
    costOutGrant = costOut - costOutCash - costOutPractice;
  }
  var realized = amount - fees.total_cent - costOut;
  var net = amount - fees.total_cent;

  // 本金按成本来源占比拆分回流：充值回充值池、赠送回赠送池、练习金回练习金池
  var principal = Math.min(costOut, net);
  var principalCash = costOut > 0 ? Math.min(principal, Math.round(principal * (costOutCash / costOut))) : 0;
  var principalPractice = costOut > 0
    ? Math.min(principal - principalCash, Math.round(principal * (costOutPractice / costOut)))
    : 0;

  d.transaction(function () {
    // 1) 资金入账（卖出不进冻结，直接进余额）
    // 本金按买入资金来源原路退回、收益进练习金池 —— 收益在记账层就出不了证券
    app.settleSell('stock', order.user_id, net, {
      ref: 'stock:order:' + order.id,
      memo: '卖出 ' + order.name + '(' + order.code + ') ' + order.qty + ' 股',
      meta: { order_id: order.id, code: order.code, side: 'sell', price_cent: fillCent, qty: order.qty }
    });

    // 2) 持仓减少；可卖数量同步减少（这批本来就是可卖的）
    // ⚠️ 口径守卫：新 cost_cent 必须严格 = 旧 cost_cent − costOut（realized 用的就是
    // costOut）。旧写法把三池剩余之和当新成本，一旦三池拆分与 cost_cent 有零散差异，
    // 每次卖出都会漂一点，资产页 total_pnl 与 /rank 的 flow 口径就越差越远
    // （2026-11-09 e2e 实测差 1 学元）。这里按新成本重新归一三池，恒等式闭合。
    var newCostCent = Math.max(0, Math.round(pos.cost_cent - costOut));
    var leftBase = baseCash + baseGrant + basePractice;
    var cashLeft = 0, grantLeft = 0, practiceLeft = 0;
    if (leftBase > 0 && newCostCent > 0) {
      cashLeft = Math.min(newCostCent, Math.round(newCostCent * (baseCash / leftBase)));
      practiceLeft = Math.min(newCostCent - cashLeft, Math.round(newCostCent * (basePractice / leftBase)));
      grantLeft = Math.max(0, newCostCent - cashLeft - practiceLeft);
    } else {
      practiceLeft = newCostCent;   // 证券唯一合法的资金来源
    }
    d.prepare([
      'UPDATE stock_positions SET qty = qty - ?, available_qty = MAX(0, available_qty - ?),',
      '  cost_cent = ?, cost_cash_cent = ?, cost_grant_cent = ?, cost_practice_cent = ?,',
      '  updated_at = ?',
      'WHERE user_id = ? AND code = ?'
    ].join('\n')).run(order.qty, order.qty, newCostCent,
      cashLeft, grantLeft, practiceLeft, now, order.user_id, order.code);
    d.prepare('DELETE FROM stock_positions WHERE user_id = ? AND code = ? AND qty <= 0')
      .run(order.user_id, order.code);

    // 3) 订单与明细
    d.prepare('UPDATE stock_orders SET filled_qty = qty, avg_fill_cent = ?, fee_cent = ?, filled_at = ? WHERE id = ?')
      .run(fillCent, fees.total_cent, now, order.id);
    d.prepare([
      'INSERT INTO stock_trades (order_id, user_id, code, name, side, price_cent, qty, amount_cent,',
      '  commission_cent, stamp_cent, transfer_cent, fee_cent, realized_cent, trade_date, created_at)',
      "VALUES (?, ?, ?, ?, 'sell', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ].join('\n')).run(order.id, order.user_id, order.code, order.name, fillCent, order.qty, amount,
      fees.commission_cent, fees.stamp_cent, fees.transfer_cent, fees.total_cent, realized, today, now);

    d.prepare([
      'UPDATE stock_account SET trade_count = trade_count + 1,',
      '  fee_total_cent = fee_total_cent + ?, realized_cent = realized_cent + ?',
      'WHERE user_id = ?'
    ].join('\n')).run(fees.total_cent, realized, order.user_id);

    // 4) 站内通知（失败不影响成交：钱已经动了，通知只是提醒）
    try { notify.notifyFill(order, fillCent, order.qty, realized, fees.total_cent); } catch (e) {
      console.error('[stock] 成交通知写入失败 order=' + order.id + ':', e.message);
    }
  })();
}

// ---- 撤单 ----
function cancelOrder(userId, orderId) {
  var order = store.getOrder(userId, orderId);
  if (!order) throw TradeError('委托不存在');
  if (order.status !== 'pending' && order.status !== 'armed') {
    throw TradeError('该委托已' + statusText(order.status) + '，无法撤单');
  }

  var now = Date.now();
  var claim = store.db().prepare(
    "UPDATE stock_orders SET status = 'cancelled', updated_at = ? WHERE id = ? AND status IN ('pending','armed')"
  ).run(now, orderId);
  if (!claim.changes) throw TradeError('委托状态已变化，请刷新');

  if (order.side === 'buy' && order.hold_cent > 0) {
    app.release('stock', userId, order.hold_cent, 'stock:order:' + order.id + ':release', '撤单解冻');
  }
  // 卖单/条件单不必动持仓：可卖数量是用「持仓可卖 − pending/armed 冻结」算出来的

  return store.getOrder(userId, orderId);
}

// 一键撤销全部未完成委托（含条件单）。单个失败不影响其它单。
function cancelAll(userId) {
  var now = Date.now();
  var rows = store.db().prepare([
    "SELECT * FROM stock_orders WHERE user_id = ? AND status IN ('pending', 'armed') ORDER BY id ASC"
  ].join(' ')).all(userId);
  var cancelled = 0;
  var released = 0;
  for (var i = 0; i < rows.length; i++) {
    var o = rows[i];
    var claim = store.db().prepare([
      "UPDATE stock_orders SET status = 'cancelled', reason = ?, updated_at = ?",
      "WHERE id = ? AND status IN ('pending', 'armed')"
    ].join(' ')).run('一键撤单', now, o.id);
    if (!claim.changes) continue;
    cancelled++;
    if (o.side === 'buy' && o.hold_cent > 0) {
      try {
        app.release('stock', userId, o.hold_cent,
          'stock:order:' + o.id + ':release', '一键撤单解冻');
        released += Number(o.hold_cent) || 0;
      } catch (e) {
        console.error('[stock] 一键撤单解冻失败 order=' + o.id + ':', e.message);
      }
    }
  }
  return { cancelled: cancelled, released_cent: released };
}

// 托管槽自动对账（2026-11-09）：把「pending 买单应冻结额」与「账本托管槽实际余额」对齐。
// 修两类历史包袱：账本切换期遗留的幽灵挂单（记了 hold_cent 但没冻结，一成交必炸），
// 以及失败单解冻被吞/重复解冻造成的漂移。幂等 ref 按差额数值生成，对齐后不再触发。
// 由 matcher 每 60s 低频巡检调用，任何口径漂移都会自愈，学生无需重买。
function reconcileHolds(now) {
  var d = store.db();
  var rows = d.prepare([
    "SELECT user_id, COALESCE(SUM(hold_cent), 0) AS expected",
    "FROM stock_orders WHERE status = 'pending' AND side = 'buy' AND hold_cent > 0",
    'GROUP BY user_id'
  ].join('\n')).all();
  var pendingUsers = {};
  var fixed = 0;

  // 崩溃窗口自愈：先改 filled 再写成交/资金，进程若在这两步之间退出，
  // 会留下「已成交但没有成交明细」的单。钱和持仓都没动过，撤单退款即可。
  var broken = d.prepare([
    'SELECT o.* FROM stock_orders o',
    'LEFT JOIN stock_trades t ON t.order_id = o.id',
    "WHERE o.status = 'filled' AND t.id IS NULL"
  ].join('\n')).all();
  broken.forEach(function (o) {
    var claim = d.prepare([
      "UPDATE stock_orders SET status = 'rejected', reason = ?, updated_at = ?",
      "WHERE id = ? AND status = 'filled'"
    ].join(' ')).run('成交结算中断，系统已自动撤销', now, o.id);
    if (!claim.changes) return;
    if (o.side === 'buy' && o.hold_cent > 0) {
      try {
        app.release('stock', o.user_id, o.hold_cent,
          'stock:order:' + o.id + ':release', '成交中断解冻');
      } catch (e) {
        console.error('[stock] 成交中断解冻失败 order=' + o.id + ':', e.message);
      }
    }
    fixed++;
  });
  rows.forEach(function (r) {
    pendingUsers[String(r.user_id)] = true;
    var acc = app.practiceAccount('stock', r.user_id);
    var actual = Number(acc.frozen_practice_cent) || 0;
    var gap = Number(r.expected) - actual;
    if (gap > 0) {
      if ((Number(acc.available_practice_cent) || 0) >= gap) {
        // 少冻结：补上（尊重学生挂单意图，成交不再超托管）
        try {
          app.reserve('stock', r.user_id, gap,
            'stock:reconcile:' + r.user_id + ':' + r.expected, '托管槽对账补冻结');
          fixed++;
        } catch (e) { console.error('[stock] 补冻结失败 ' + r.user_id + ':', e.message); }
      } else {
        // 余额不够：从最老的幽灵单撤起（那些单本来就没钱可退），直到对齐
        var olds = d.prepare([
          "SELECT id, hold_cent FROM stock_orders WHERE user_id = ? AND status = 'pending'",
          "AND side = 'buy' AND hold_cent > 0 ORDER BY id ASC"
        ].join('\n')).all(r.user_id);
        for (var oi = 0; oi < olds.length && gap > 0; oi++) {
          var claim = d.prepare([
            "UPDATE stock_orders SET status = 'cancelled', reason = ?, updated_at = ?",
            "WHERE id = ? AND status = 'pending'"
          ].join('\n')).run('冻结缺失且余额不足，系统已自动撤单', now, olds[oi].id);
          if (claim.changes) { gap -= Number(olds[oi].hold_cent) || 0; fixed++; }
        }
      }
    } else if (gap < 0) {
      // 多冻结（历史失败单的钱卡在托管里）：退回用户
      try {
        app.release('stock', r.user_id, -gap,
          'stock:reconcile:' + r.user_id + ':refund:' + actual, '托管槽多余冻结退回');
        fixed++;
      } catch (e) { console.error('[stock] 多余冻结退回失败 ' + r.user_id + ':', e.message); }
    }
  });

  // 完全没有 pending 买单、托管槽却还有钱的用户（历史卡单）→ 全额退回
  var orphan = d.prepare([
    'SELECT a.owner_id, b.balance',
    'FROM xy_ledger_balances b JOIN xy_ledger_accounts a ON a.id = b.account_id',
    "WHERE a.kind = 'escrow' AND a.owner_id LIKE 'trading:%' AND b.asset = 'PRACTICE' AND b.balance > 0"
  ].join('\n')).all();
  orphan.forEach(function (o) {
    var uid = String(o.owner_id).replace(/^trading:/, '');
    if (pendingUsers[uid]) return;
    try {
      app.release('stock', uid, o.balance,
        'stock:reconcile:' + uid + ':orphan:' + o.balance, '无挂单的托管余额退回');
      fixed++;
    } catch (e) { console.error('[stock] 孤儿托管退回失败 ' + uid + ':', e.message); }
  });
  return fixed;
}

// 当日有效委托到期：撤单、解冻、通知。条件单也按同一到期规则释放冻结股数。
function expireDueOrders(now) {
  var d = store.db();
  var rows = d.prepare([
    "SELECT * FROM stock_orders",
    "WHERE status IN ('pending', 'armed') AND expires_at > 0 AND expires_at <= ?",
    'ORDER BY id ASC LIMIT 500'
  ].join('\n')).all(now);
  var n = 0;
  rows.forEach(function (o) {
    var claim = d.prepare([
      "UPDATE stock_orders SET status = 'expired', reason = ?, updated_at = ?",
      "WHERE id = ? AND status IN ('pending', 'armed')"
    ].join(' ')).run('当日委托已到期，自动撤单', now, o.id);
    if (!claim.changes) return;
    if (o.side === 'buy' && o.hold_cent > 0) {
      try {
        app.release('stock', o.user_id, o.hold_cent,
          'stock:order:' + o.id + ':release', '当日委托到期解冻');
      } catch (e) {
        console.error('[stock] 到期解冻失败 order=' + o.id + ':', e.message);
      }
    }
    try { notify.notifyExpired(o, '当日委托已到期'); } catch (e) {
      console.error('[stock] 到期通知写入失败 order=' + o.id + ':', e.message);
    }
    n++;
  });
  return n;
}

function statusText(s) {
  var map = {
    // pending 对学生的语义是「已挂单等成交」，不是「提交中」—— 文案直接影响对状态的理解
    pending: '待成交', armed: '条件单待触发', filled: '成交', cancelled: '撤销',
    expired: '过期', rejected: '拒绝'
  };
  return map[s] || s;
}

// ---- 撮合一轮（matcher 调用）----
// 返回 { scanned, filled, invalidated, session }
//
// 委托**长期有效**（产品决策 2026-11-02：平板不是天天用，收盘作废会让
// 周末挂的单周一蒸发）。撮合只发生在有新行情的时段：
//   · pre_open（9:25–9:30）用当日开盘价撮合 —— 模拟集合竞价结果
//   · morning / afternoon / auction_close 用最新价撮合
//   · 休市不撮合，只清「死单」（委托价已超出当日涨跌停、永远不可能成交的单）
function matchOnce(snapshot, nowMs) {
  var now = Number(nowMs) || Date.now();
  var session = market.currentSession(now);
  var byCode = (snapshot && snapshot.byCode) || {};
  var expired = expireDueOrders(now);

  // 集合竞价期间只收单不成交；15:00 后才有收盘结算窗口
  if (!session.matchable) {
    var dead = invalidateOutOfRange(byCode, now);
    return { scanned: 0, filled: 0, invalidated: dead, expired: expired, session: session };
  }

  var useOpen = session.key === 'pre_open';
  var cutoff = session.key === 'close_settle' ? market.closeCutoffMs(now) : 0;
  var rows = store.db().prepare("SELECT * FROM stock_orders WHERE status = 'pending' ORDER BY id ASC LIMIT 500").all();
  var filled = 0;
  var invalidated = 0;

  for (var i = 0; i < rows.length; i++) {
    var order = rows[i];
    // 收盘结算只处理 15:00 前已经挂出的单；15:00 后新下的单等下一个交易日
    if (cutoff && Number(order.created_at) >= cutoff) continue;
    var q = byCode[order.code];
    if (!q) continue;

    // 跨日保护：昨天挂的价格今天可能已经出了涨跌停范围（比如隔夜利空跌停开盘），
    // 这种单永远不会成交，却一直占着冻结资金 —— 在撮合时顺手作废。
    if (order.order_type === 'limit' && isOutOfRange(order, q)) {
      if (invalidate(order, '委托价已超出当日涨跌停范围', now)) invalidated++;
      continue;
    }

    // 盘前数据还没有真实开盘价（f2/open 均为 "-"）时不要撮合：
    // 拿昨收价成交等于凭空造了一个开盘价（quotes.buildQuote 会标 pre_open）。
    if (useOpen && q.pre_open) continue;

    var quote = useOpen
      ? Object.assign({}, q, { price_cent: Math.round((q.open || q.price) * 100) })
      : q;
    var r = tryFill(order, quote, now);
    if (r) filled++;
  }

  // 条件单触发：满足条件后转成市价卖单，再走同一套撮合/结算。
  var armedRows = store.db().prepare(
    "SELECT * FROM stock_orders WHERE status = 'armed' ORDER BY id ASC LIMIT 200"
  ).all();
  for (var ai = 0; ai < armedRows.length; ai++) {
    var ao = armedRows[ai];
    if (cutoff && Number(ao.created_at) >= cutoff) continue;
    var aq = byCode[ao.code];
    if (!aq || !quoteAllowsFill(aq, now)) continue;
    var triggerQuote = useOpen
      ? Object.assign({}, aq, { price_cent: Math.round((aq.open || aq.price) * 100) })
      : aq;
    var last = triggerQuote.price_cent;
    if (!(last > 0)) continue;
    var hit;
    if (ao.trigger_type === 'trailing_stop') {
      var pct = Number(ao.trail_percent) || 0;
      if (!(pct > 0)) continue;
      var peak = Math.max(Number(ao.peak_cent) || 0, last);
      var trailTrigger = Math.max(1, Math.round(peak * (100 - pct) / 100));
      if (peak !== Number(ao.peak_cent) || trailTrigger !== Number(ao.trigger_cent)) {
        store.db().prepare([
          'UPDATE stock_orders SET peak_cent = ?, trigger_cent = ?, price_cent = ?, updated_at = ?',
          "WHERE id = ? AND status = 'armed'"
        ].join(' ')).run(peak, trailTrigger, trailTrigger, now, ao.id);
        ao.peak_cent = peak;
        ao.trigger_cent = trailTrigger;
      }
      hit = last <= trailTrigger;
    } else {
      hit = ao.trigger_type === 'stop_loss' ? last <= ao.trigger_cent
        : (ao.trigger_type === 'take_profit' ? last >= ao.trigger_cent : false);
    }
    if (!hit) continue;

    var armedClaim = store.db().prepare([
      "UPDATE stock_orders SET status = 'pending', order_type = 'market',",
      '  price_cent = ?, triggered_at = ?, updated_at = ?',
      "WHERE id = ? AND status = 'armed'"
    ].join(' ')).run(last, now, now, ao.id);
    if (!armedClaim.changes) continue;
    var triggered = store.getOrder(ao.user_id, ao.id);
    var tr = tryFill(triggered, triggerQuote, now);
    if (tr) filled++;
  }

  return { scanned: rows.length + armedRows.length, filled: filled, invalidated: invalidated, expired: expired, session: session };
}

// 委托价是否已不可能成交（超出当日涨跌停）
function isOutOfRange(order, quote) {
  var upCent = Math.round(quote.limit_up * 100);
  var downCent = Math.round(quote.limit_down * 100);
  return order.price_cent > upCent || order.price_cent < downCent;
}

// 作废死单并解冻（买单）。返回是否真的作废了。
function invalidate(order, reason, now) {
  var d = store.db();
  var claim = d.prepare(
    "UPDATE stock_orders SET status = 'cancelled', reason = ?, updated_at = ? WHERE id = ? AND status = 'pending'"
  ).run(String(reason || '委托已失效').slice(0, 120), now, order.id);
  if (!claim.changes) return false;
  if (order.side === 'buy' && order.hold_cent > 0) {
    try {
      app.release('stock', order.user_id, order.hold_cent, 'stock:order:' + order.id + ':release', '死单解冻');
    } catch (e) {
      console.error('[stock] 死单解冻失败 order=' + order.id + ':', e.message);
    }
  }
  try { notify.notifyExpired(order, reason); } catch (e) {
    console.error('[stock] 失效通知写入失败 order=' + order.id + ':', e.message);
  }
  return true;
}

function invalidateOutOfRange(byCode, now) {
  var rows = store.db().prepare("SELECT * FROM stock_orders WHERE status = 'pending' AND order_type = 'limit' ORDER BY id ASC LIMIT 200").all();
  var n = 0;
  for (var i = 0; i < rows.length; i++) {
    var o = rows[i];
    var q = byCode[o.code];
    if (!q) continue;
    if (isOutOfRange(o, q) && invalidate(o, '委托价已超出当日涨跌停范围', now)) n++;
  }
  return n;
}

module.exports = {
  accountSummary: accountSummary,
  placeOrder: placeOrder,
  placeConditional: placeConditional,
  cancelOrder: cancelOrder,
  cancelAll: cancelAll,
  matchOnce: matchOnce,
  tryFill: tryFill,
  quoteAllowsFill: quoteAllowsFill,
  reconcileHolds: reconcileHolds,
  frozenSellQty: frozenSellQty,
  statusText: statusText,
  TradeError: TradeError
};
