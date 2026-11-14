// 学元证券 · 到价提醒
// ============================================================
// 学生可以给任意股票设「涨到 X 元 / 跌到 X 元」的提醒。行情满足时写入
// 站内提醒（顶栏铃铛），只触发一次；不涉及任何资金/持仓，纯通知能力。
//
// 防刷：每人最多 20 条有效提醒；只在「今天的真实行情」上触发，
// 断网兜底价、节假日昨收价不会把提醒误触发。

var market = require('./market');
var quotes = require('./quotes');
var store = require('./store');
var notify = require('./notify');

function q(sql) { return store.db().prepare(sql); }

function AlertError(msg) {
  var e = new Error(msg);
  e.isAlertError = true;
  return e;
}

function create(userId, params) {
  var p = params || {};
  var uid = String(userId == null ? '' : userId);
  var code = market.normalizeCode(p.code);
  if (!code || !quotes.isTradable(code)) throw AlertError('股票代码不合法');
  var direction = p.direction === 'below' ? 'below' : (p.direction === 'above' ? 'above' : null);
  if (!direction) throw AlertError('提醒方向只能是涨到或跌到');
  var price = Number(p.target_price);
  if (!isFinite(price) || price <= 0) throw AlertError('请输入提醒价格');
  var targetCent = Math.round(market.roundPrice(price) * 100);

  var active = q("SELECT COUNT(*) AS n FROM stock_price_alerts WHERE user_id = ? AND status = 'active'").get(uid).n;
  if (Number(active) >= 20) throw AlertError('最多同时设置 20 条到价提醒');

  var name = '';
  try {
    var cached = quotes.getCached && quotes.getCached();
    var qq = cached && cached.byCode && cached.byCode[code];
    name = (qq && qq.name) || '';
  } catch (e) { name = ''; }

  var now = Date.now();
  var ref = 'price-alert:' + uid + ':' + now + ':' + Math.random().toString(36).slice(2, 8);
  var info = q([
    'INSERT INTO stock_price_alerts (user_id, code, name, direction, target_cent, status, ref, created_at)',
    "VALUES (?, ?, ?, ?, ?, 'active', ?, ?)"
  ].join(' ')).run(uid, code, name, direction, targetCent, ref, now);
  return q('SELECT * FROM stock_price_alerts WHERE id = ?').get(Number(info.lastInsertRowid));
}

function list(userId) {
  return q([
    'SELECT * FROM stock_price_alerts WHERE user_id = ?',
    "ORDER BY CASE status WHEN 'active' THEN 0 ELSE 1 END, id DESC LIMIT 50"
  ].join(' ')).all(String(userId));
}

function cancel(userId, id) {
  var alertId = Number(id);
  if (!(alertId > 0)) throw AlertError('提醒不存在');
  var info = q([
    "UPDATE stock_price_alerts SET status = 'cancelled'",
    "WHERE id = ? AND user_id = ? AND status = 'active'"
  ].join(' ')).run(alertId, String(userId));
  if (!info.changes) throw AlertError('提醒不存在或已结束');
  return q('SELECT * FROM stock_price_alerts WHERE id = ?').get(alertId);
}

// 撮合器每轮行情后调用。返回本轮触发条数。
function check(snapshot, nowMs) {
  var now = Number(nowMs) || Date.now();
  if (!snapshot || snapshot.stale) return 0;
  var today = market.dateKey(now);
  if (snapshot.quote_date && snapshot.quote_date !== today) return 0;
  var byCode = snapshot.byCode || {};
  var rows = q("SELECT * FROM stock_price_alerts WHERE status = 'active' ORDER BY id ASC LIMIT 500").all();
  var fired = 0;
  var d = store.db();
  for (var i = 0; i < rows.length; i++) {
    var a = rows[i];
    var quote = byCode[a.code];
    if (!quote || quote.stale) continue;
    if (quote.quote_date && quote.quote_date !== today) continue;
    var price = Number(quote.price_cent) || 0;
    if (!(price > 0)) continue;
    var hit = a.direction === 'above' ? price >= a.target_cent : price <= a.target_cent;
    if (!hit) continue;

    try {
      d.transaction(function () {
        var claim = d.prepare([
          "UPDATE stock_price_alerts SET status = 'triggered', triggered_at = ?",
          "WHERE id = ? AND status = 'active'"
        ].join(' ')).run(now, a.id);
        if (!claim.changes) return;
        notify.push(a.user_id, {
          kind: 'alert',
          code: a.code,
          name: a.name || quote.name || a.code,
          ref: 'price-alert:' + a.id,
          title: (a.name || quote.name || a.code) + ' 到价提醒',
          body: '现价 ' + (price / 100).toFixed(2) + '，已' +
            (a.direction === 'above' ? '涨到' : '跌到') +
            ' ' + (a.target_cent / 100).toFixed(2) + ' 学元。'
        });
        fired++;
      })();
    } catch (e) {
      console.error('[stock] 到价提醒写入失败 #' + a.id + ':', e.message);
    }
  }
  return fired;
}

module.exports = {
  create: create,
  list: list,
  cancel: cancel,
  check: check
};
