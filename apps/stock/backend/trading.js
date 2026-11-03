// 交易核心：下单 / 撮合 / 撤单 / 清算
// ============================================================
// 这里实现的是**真实 A 股规则**的模拟盘，钱是学元。
// 与真实券商一致的部分（不要为了省事改掉，否则就成游戏了）：
//   · T+1：当日买入次日才能卖
//   · 涨跌停：主板 ±10%、创业板/科创板 ±20%，超价直接废单
//   · 涨停买不到、跌停卖不掉（挂单排队，不强行成交）
//   · 100 股一手；零股只能一次性卖出
//   · 佣金万 2.5 最低 5 元、印花税卖出 0.05%、过户费 0.001%
//   · 15:00 收盘，当日未成交委托自动失效并解冻
//
// 与真实券商不同的部分（都是有意的）：
//   · 不撮合部分成交（学生资金量小，一次成交即可，也避免碎股）
//   · 收盘后不接受隔夜委托（隔夜单会让学生忘记这单，反而更不真实）
//
// 编码约定：var / function

var nodePath = require('path');
var market = require('./market');
var quotes = require('./quotes');
var store = require('./store');
var xueyuan = require(nodePath.resolve(process.cwd(), 'src/services/xueyuan'));

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

  var acc = xueyuan.viewAccount(userId);
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
      stale: q ? !!q.stale : true
    });
  }

  var row = store.ensureAccount(userId);
  var realized = row.realized_cent || 0;
  var todayRealized = store.db().prepare(
    'SELECT COALESCE(SUM(realized_cent), 0) AS s FROM stock_trades WHERE user_id = ? AND trade_date = ?'
  ).get(userId, today).s;

  return {
    cash: {
      balance: acc.balance,
      frozen: acc.frozen,
      available: acc.available,
      balance_cent: acc.balance_cent,
      frozen_cent: acc.frozen_cent,
      available_cent: acc.available_cent
    },
    positions: items,
    totals: {
      market_value: marketValue / 100,
      market_value_cent: marketValue,
      cost: costTotal / 100,
      cost_cent: costTotal,
      total_asset: (acc.balance_cent + marketValue) / 100,
      total_asset_cent: acc.balance_cent + marketValue,
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
    session: market.currentSession(),
    stale: !!(snapshot && snapshot.stale)
  };
}

// 已挂卖单冻结的股数（持仓表不动，靠订单汇总算「真正可卖」）
function frozenSellQty(userId, code) {
  var row = store.db().prepare([
    "SELECT COALESCE(SUM(frozen_qty), 0) AS s FROM stock_orders",
    "WHERE user_id = ? AND code = ? AND side = 'sell' AND status = 'pending'"
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

  var today = market.dateKey(now);
  store.settleT1(userId, today);

  return quotes.getQuote(code).then(function (q) {
    if (!q.price || q.price <= 0) throw TradeError('该股票当前无法交易（可能停牌）');

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
      // 市价单的成交价在撮合那一刻才确定（隔夜单尤其如此），冻结额留 10% 缓冲
      // 覆盖主板涨停幅度；创业板极端一字板仍可能超缓冲 —— 超了会被明确拒绝而不是透支。
      var holdCent = orderType === 'market'
        ? Math.round((amount + fees.total_cent) * 1.1)
        : amount + fees.total_cent;

      var cash = xueyuan.getAccount(userId);
      if (cash.balance - cash.frozen < holdCent) {
        var maxQty = market.maxBuyQty(cash.balance - cash.frozen, priceYuan);
        if (!maxQty) {
          throw TradeError('可用学元不足：一手（100 股）需要约 ' +
            ((priceCent * 100 + fees.total_cent) / 100).toFixed(2) + ' 学元，当前可用 ' +
            ((cash.balance - cash.frozen) / 100).toFixed(2) + ' 学元');
        }
        throw TradeError('可用学元不足（按 ' + priceYuan.toFixed(2) + ' 元最多可买 ' + maxQty + ' 股）');
      }

      return doBuy(userId, q, qty, priceCent, orderType, holdCent, session, today, now);
    }

    // ---- 卖出 ----
    var pos = store.getPosition(userId, code);
    var sellable = pos ? pos.available_qty - frozenSellQty(userId, code) : 0;
    if (!pos || sellable <= 0) throw TradeError('没有可卖持仓（当日买入需次日才能卖出）');
    if (qty > sellable) throw TradeError('可卖数量不足（当前可卖 ' + sellable + ' 股）');
    if (qty < market.LOT_SIZE && qty !== sellable) {
      throw TradeError('零股（不足 100 股）必须一次性全部卖出');
    }
    if (qty >= market.LOT_SIZE && qty % market.LOT_SIZE !== 0 && qty !== sellable) {
      throw TradeError('卖出数量必须是 100 股的整数倍（或一次性卖完全部持仓）');
    }

    return doSell(userId, q, qty, priceCent, orderType, session, today, now);
  });
}

function doBuy(userId, q, qty, priceCent, orderType, holdCent, session, today, now) {
  var orderId = 0;
  // 「冻结资金 + 建委托」必须原子：否则冻结成功而建单失败，钱就卡在 frozen 里
  store.db().transaction(function () {
    xueyuan.hold(userId, holdCent);
    var info = store.db().prepare([
      'INSERT INTO stock_orders (user_id, code, name, side, order_type, price_cent, qty,',
      '  status, hold_cent, trade_date, created_at, updated_at)',
      "VALUES (?, ?, ?, 'buy', ?, ?, ?, 'pending', ?, ?, ?, ?)"
    ].join('\n')).run(userId, q.code, q.name, orderType, priceCent, qty, holdCent, today, now, now);
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

function doSell(userId, q, qty, priceCent, orderType, session, today, now) {
  var orderId = 0;
  // 可卖校验与建单放在同一事务里：并发两笔卖单不会都通过检查
  store.db().transaction(function () {
    var pos = store.getPosition(userId, q.code);
    var sellable = pos ? pos.available_qty - frozenSellQty(userId, q.code) : 0;
    if (qty > sellable) throw TradeError('可卖数量不足（当前可卖 ' + sellable + ' 股）');

    var info = store.db().prepare([
      'INSERT INTO stock_orders (user_id, code, name, side, order_type, price_cent, qty,',
      '  status, frozen_qty, trade_date, created_at, updated_at)',
      "VALUES (?, ?, ?, 'sell', ?, ?, ?, 'pending', ?, ?, ?, ?)"
    ].join('\n')).run(userId, q.code, q.name, orderType, priceCent, qty, qty, today, now, now);
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

// ---- 撮合 ----
// 返回成交结果或 null（未成交）
function tryFill(order, quote, now) {
  if (!order || order.status !== 'pending') return null;

  var lastCent = quote.price_cent;
  if (!(lastCent > 0)) return null;

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
      try { xueyuan.release(order.user_id, order.hold_cent); } catch (e2) {}
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
    xueyuan.settleHold({
      user_id: order.user_id,
      holdCent: order.hold_cent,
      costCent: cost,
      feeCent: fees.total_cent,
      ref: 'stock:order:' + order.id,
      app: 'stock',
      memo: '买入 ' + order.name + '(' + order.code + ') ' + order.qty + ' 股',
      meta: { order_id: order.id, code: order.code, side: 'buy', price_cent: fillCent, qty: order.qty },
      at: now
    });

    // 2) 持仓：数量增加，可卖数量不变（T+1）
    var pos = store.getPosition(order.user_id, order.code);
    if (pos) {
      d.prepare('UPDATE stock_positions SET qty = qty + ?, cost_cent = cost_cent + ?, name = ?, updated_at = ? WHERE user_id = ? AND code = ?')
        .run(order.qty, cost, order.name, now, order.user_id, order.code);
    } else {
      d.prepare('INSERT INTO stock_positions (user_id, code, name, qty, available_qty, cost_cent, updated_at) VALUES (?, ?, ?, ?, 0, ?, ?)')
        .run(order.user_id, order.code, order.name, order.qty, cost, now);
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
  })();
}

function fillSell(order, fillCent, amount, fees, now, today) {
  var d = store.db();
  var pos = store.getPosition(order.user_id, order.code);
  if (!pos || pos.qty < order.qty) throw new Error('持仓不足');

  // 成本按比例冲减：卖出 30% 就带走 30% 的成本
  var costOut = Math.round(pos.cost_cent * (order.qty / pos.qty));
  var realized = amount - fees.total_cent - costOut;
  var net = amount - fees.total_cent;

  d.transaction(function () {
    // 1) 资金入账（卖出不进冻结，直接进余额）
    xueyuan.credit(order.user_id, net, {
      ref: 'stock:order:' + order.id,
      app: 'stock',
      memo: '卖出 ' + order.name + '(' + order.code + ') ' + order.qty + ' 股',
      meta: { order_id: order.id, code: order.code, side: 'sell', price_cent: fillCent, qty: order.qty },
      at: now
    });

    // 2) 持仓减少；可卖数量同步减少（这批本来就是可卖的）
    d.prepare([
      'UPDATE stock_positions SET qty = qty - ?, available_qty = MAX(0, available_qty - ?),',
      '  cost_cent = MAX(0, cost_cent - ?), updated_at = ? WHERE user_id = ? AND code = ?'
    ].join('\n')).run(order.qty, order.qty, costOut, now, order.user_id, order.code);
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
  })();
}

// ---- 撤单 ----
function cancelOrder(userId, orderId) {
  var order = store.getOrder(userId, orderId);
  if (!order) throw TradeError('委托不存在');
  if (order.status !== 'pending') throw TradeError('该委托已' + statusText(order.status) + '，无法撤单');

  var now = Date.now();
  var claim = store.db().prepare(
    "UPDATE stock_orders SET status = 'cancelled', updated_at = ? WHERE id = ? AND status = 'pending'"
  ).run(now, orderId);
  if (!claim.changes) throw TradeError('委托状态已变化，请刷新');

  if (order.side === 'buy' && order.hold_cent > 0) {
    xueyuan.release(userId, order.hold_cent);
  }
  // 卖单不必动持仓：可卖数量是用「持仓可卖 − pending 冻结」算出来的

  return store.getOrder(userId, orderId);
}

function statusText(s) {
  var map = {
    // pending 对学生的语义是「已挂单等成交」，不是「提交中」—— 文案直接影响对状态的理解
    pending: '待成交', filled: '成交', cancelled: '撤销', expired: '过期', rejected: '拒绝'
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
function matchOnce(snapshot) {
  var now = Date.now();
  var session = market.currentSession(now);
  var byCode = (snapshot && snapshot.byCode) || {};

  if (!session.tradable) {
    var dead = invalidateOutOfRange(byCode, now);
    return { scanned: 0, filled: 0, invalidated: dead, expired: 0, session: session };
  }

  var useOpen = session.key === 'pre_open';
  var rows = store.db().prepare("SELECT * FROM stock_orders WHERE status = 'pending' ORDER BY id ASC LIMIT 200").all();
  var filled = 0;
  var invalidated = 0;

  for (var i = 0; i < rows.length; i++) {
    var order = rows[i];
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

  return { scanned: rows.length, filled: filled, invalidated: invalidated, expired: 0, session: session };
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
    try { xueyuan.release(order.user_id, order.hold_cent); } catch (e) {
      console.error('[stock] 死单解冻失败 order=' + order.id + ':', e.message);
    }
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
  cancelOrder: cancelOrder,
  matchOnce: matchOnce,
  tryFill: tryFill,
  frozenSellQty: frozenSellQty,
  statusText: statusText,
  TradeError: TradeError
};
