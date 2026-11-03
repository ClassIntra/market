// 站内通知：持仓波动 / 成交 / 委托失效
// 设计要点：
//  · 表由应用自管（stock_notify），不依赖宿主（宿主没有通知中心）
//  · ref 唯一 = 幂等：同一天同一只股票的「涨 5%」只提醒一次，重启/多端都不会重复
//  · 波动扫描按用户节流（60s），挂在 overview 上，学生打开应用就能收到
var path = require('path');
var db = require(path.resolve(process.cwd(), 'src/utils/db'));
var market = require('./market');

var SCAN_GAP = parseInt(process.env.STOCK_NOTIFY_SCAN_GAP, 10);
if (!isFinite(SCAN_GAP) || SCAN_GAP < 0) SCAN_GAP = 60 * 1000;   // 测试可传 0 关掉节流
var lastScan = {};   // user_id -> ts
var ready = false;

function ensure() {
  if (ready) return;
  db.exec([
    'CREATE TABLE IF NOT EXISTS stock_notify (',
    '  id INTEGER PRIMARY KEY AUTOINCREMENT,',
    '  user_id TEXT NOT NULL,',
    '  kind TEXT NOT NULL,',
    '  code TEXT,',
    '  name TEXT,',
    '  title TEXT NOT NULL,',
    '  body TEXT,',
    '  ref TEXT,',
    '  created_at INTEGER NOT NULL,',
    '  read_at INTEGER',
    ');',
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_stock_notify_ref ON stock_notify(user_id, ref);',
    'CREATE INDEX IF NOT EXISTS idx_stock_notify_user ON stock_notify(user_id, id DESC);'
  ].join('\n'));
  ready = true;
}

// 写一条通知（ref 重复则忽略），返回是否新写入
function push(userId, item) {
  ensure();
  var info = db.prepare([
    'INSERT OR IGNORE INTO stock_notify (user_id, kind, code, name, title, body, ref, created_at, read_at)',
    'VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)'
  ].join('\n')).run(
    String(userId),
    item.kind,
    item.code || null,
    item.name || null,
    item.title,
    item.body || '',
    item.ref || null,
    Date.now()
  );
  return info.changes > 0;
}

function list(userId, opts) {
  ensure();
  var o = opts || {};
  var limit = Math.min(Math.max(parseInt(o.limit, 10) || 20, 1), 50);
  var rows = db.prepare([
    'SELECT id, kind, code, name, title, body, created_at, read_at',
    'FROM stock_notify WHERE user_id = ? ORDER BY id DESC LIMIT ?'
  ].join('\n')).all(String(userId), limit);
  var unread = db.prepare('SELECT COUNT(*) c FROM stock_notify WHERE user_id = ? AND read_at IS NULL')
    .get(String(userId)).c;
  return { list: rows, unread: unread };
}

function readAll(userId) {
  ensure();
  var info = db.prepare('UPDATE stock_notify SET read_at = ? WHERE user_id = ? AND read_at IS NULL')
    .run(Date.now(), String(userId));
  return info.changes;
}

function yi(cent) {
  return (Math.round(Number(cent) || 0) / 100).toFixed(2);
}

// 波动扫描：持仓的涨跌幅 / 涨跌停 / 对成本的浮亏
// positions: store.listPositions(userId) 的结果；byCode: 行情快照
function scanPositions(userId, positions, byCode) {
  ensure();
  var now = Date.now();
  if (lastScan[userId] && now - lastScan[userId] < SCAN_GAP) return 0;
  lastScan[userId] = now;

  var day = market.dateKey(now);
  var made = 0;
  var list_ = positions || [];
  for (var i = 0; i < list_.length; i++) {
    var p = list_[i];
    var q = byCode && byCode[p.code];
    if (!q || !q.price) continue;
    var pct = Number(q.change_pct) || 0;
    var avg = p.qty > 0 ? p.cost_cent / p.qty / 100 : 0;
    var refBase = day + ':' + p.code;

    if (q.price >= q.limit_up) {
      if (push(userId, {
        kind: 'limit_up', code: p.code, name: p.name, ref: 'limit_up:' + refBase,
        title: p.name + ' 涨停 ' + q.price.toFixed(2),
        body: '涨停价买不到、也卖得掉 —— 想卖可以挂单排队。'
      })) made++;
    } else if (q.price <= q.limit_down) {
      if (push(userId, {
        kind: 'limit_down', code: p.code, name: p.name, ref: 'limit_down:' + refBase,
        title: p.name + ' 跌停 ' + q.price.toFixed(2),
        body: '跌停时卖不出去是正常现象，别慌，等打开跌停再说。'
      })) made++;
    } else if (pct >= 5) {
      if (push(userId, {
        kind: 'up', code: p.code, name: p.name, ref: 'up:' + refBase,
        title: p.name + ' 上涨 ' + pct.toFixed(2) + '%',
        body: '现价 ' + q.price.toFixed(2) + '，你的持仓成本 ' + avg.toFixed(2) + '。'
      })) made++;
    } else if (pct <= -5) {
      if (push(userId, {
        kind: 'down', code: p.code, name: p.name, ref: 'down:' + refBase,
        title: p.name + ' 下跌 ' + pct.toFixed(2) + '%',
        body: '现价 ' + q.price.toFixed(2) + '，别急着补仓，先想清楚为什么跌。'
      })) made++;
    }

    if (avg > 0) {
      var pnlPct = (q.price - avg) / avg * 100;
      if (pnlPct <= -8) {
        if (push(userId, {
          kind: 'loss', code: p.code, name: p.name, ref: 'loss:' + refBase,
          title: p.name + ' 浮亏 ' + Math.abs(pnlPct).toFixed(1) + '%',
          body: '成本 ' + avg.toFixed(2) + '，现价 ' + q.price.toFixed(2) + '，浮亏 ' + yi((q.price - avg) * p.qty) + ' 学元。'
        })) made++;
      } else if (pnlPct >= 10) {
        if (push(userId, {
          kind: 'gain', code: p.code, name: p.name, ref: 'gain:' + refBase,
          title: p.name + ' 浮盈 ' + pnlPct.toFixed(1) + '%',
          body: '成本 ' + avg.toFixed(2) + '，现价 ' + q.price.toFixed(2) + '，浮盈 ' + yi((q.price - avg) * p.qty) + ' 学元。'
        })) made++;
      }
    }
  }
  return made;
}

// 成交 / 委托失效：交易链路直接调用
function notifyFill(order, fillCent, qty, realizedCent, feeCent) {
  var sideLabel = order.side === 'buy' ? '买入' : '卖出';
  var body = '成交价 ' + (fillCent / 100).toFixed(2) + ' · ' + qty + ' 股 · 费用 ' + yi(feeCent) + ' 学元';
  if (order.side === 'sell') body += ' · 已实现 ' + ((realizedCent || 0) >= 0 ? '+' : '') + yi(realizedCent);
  return push(order.user_id, {
    kind: 'fill', code: order.code, name: order.name, ref: 'fill:' + order.id,
    title: sideLabel + ' ' + order.name + ' ' + qty + ' 股已成交',
    body: body
  });
}

function notifyExpired(order, reason) {
  return push(order.user_id, {
    kind: 'expired', code: order.code, name: order.name, ref: 'expired:' + order.id,
    title: order.name + ' 委托已失效',
    body: (reason || '委托价已超出当日涨跌停范围') + '，冻结已退回。'
  });
}

module.exports = {
  ensure: ensure,
  push: push,
  list: list,
  readAll: readAll,
  scanPositions: scanPositions,
  notifyFill: notifyFill,
  notifyExpired: notifyExpired
};
