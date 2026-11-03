// 炒股应用的数据表（应用自管 schema）
// ============================================================
// 第三方应用不能改宿主迁移，表由应用自己建、自己管（IF NOT EXISTS）。
// 表名统一 stock_ 前缀，避免与宿主/其他应用撞名。
//
// ---- 持仓的两个数量字段（2026-11-03 起 T+0）----
//   qty           总持仓
//   available_qty 可卖数量（现在买入即 +，与 qty 同步；真实 A 股是 T+1）
// 历史上 T+1 靠「每个交易日首次访问账户时把 available_qty 补齐到 qty」解禁
// （幂等，靠 stock_account.last_settle_date 记日）。改用 T+0 后买入直接加
// available_qty，settleT1 仍保留 —— 它会把老库里被锁住的持仓一次性补齐，
// 也会在每个交易日首次请求时兜底，别删。
//
// ---- 成本口径 ----
// cost_cent 是「剩余持仓的总成本」（含买入费用），不是每股成本。
// 卖出时按比例冲减：cost -= cost * 卖出数量 / 持仓数量。
// 这样加仓/减仓后均价始终合理，也不会因为四舍五入累积误差。

var path = require('path');

var _db = null;
function db() {
  if (!_db) {
    // 市场应用的后端由 server 进程加载，cwd 就是 server/
    _db = require(path.resolve(process.cwd(), 'src/utils/db'));
  }
  return _db;
}

function ensureSchema() {
  var d = db();
  d.exec([
    'CREATE TABLE IF NOT EXISTS stock_account (',
    '  user_id TEXT PRIMARY KEY,',
    '  created_at INTEGER NOT NULL DEFAULT 0,',
    // 最近一次执行 T+1 解禁的交易日
    '  last_settle_date TEXT,',
    // 累计已实现盈亏（分）
    '  realized_cent INTEGER NOT NULL DEFAULT 0,',
    // 累计交易费用（分）
    '  fee_total_cent INTEGER NOT NULL DEFAULT 0,',
    '  trade_count INTEGER NOT NULL DEFAULT 0',
    ')'
  ].join('\n'));

  d.exec([
    'CREATE TABLE IF NOT EXISTS stock_orders (',
    '  id INTEGER PRIMARY KEY AUTOINCREMENT,',
    '  user_id TEXT NOT NULL,',
    '  code TEXT NOT NULL,',
    '  name TEXT,',
    "  side TEXT NOT NULL,",              // buy / sell
    "  order_type TEXT NOT NULL DEFAULT 'limit',", // limit / market
    '  price_cent INTEGER NOT NULL DEFAULT 0,',    // 委托价（市价单为 0）
    '  qty INTEGER NOT NULL,',
    '  filled_qty INTEGER NOT NULL DEFAULT 0,',
    '  avg_fill_cent INTEGER NOT NULL DEFAULT 0,',
    '  status TEXT NOT NULL DEFAULT \'pending\',', // pending/filled/cancelled/expired/rejected
    '  hold_cent INTEGER NOT NULL DEFAULT 0,',     // 买单冻结资金
    '  frozen_qty INTEGER NOT NULL DEFAULT 0,',    // 卖单冻结股数
    '  fee_cent INTEGER NOT NULL DEFAULT 0,',
    '  trade_date TEXT,',
    '  reason TEXT,',
    '  created_at INTEGER NOT NULL DEFAULT 0,',
    '  updated_at INTEGER NOT NULL DEFAULT 0,',
    '  filled_at INTEGER',
    ')'
  ].join('\n'));

  d.exec('CREATE INDEX IF NOT EXISTS idx_stock_orders_user ON stock_orders(user_id, id DESC)');
  d.exec("CREATE INDEX IF NOT EXISTS idx_stock_orders_pending ON stock_orders(status, trade_date) WHERE status = 'pending'");

  d.exec([
    'CREATE TABLE IF NOT EXISTS stock_trades (',
    '  id INTEGER PRIMARY KEY AUTOINCREMENT,',
    '  order_id INTEGER NOT NULL,',
    '  user_id TEXT NOT NULL,',
    '  code TEXT NOT NULL,',
    '  name TEXT,',
    '  side TEXT NOT NULL,',
    '  price_cent INTEGER NOT NULL,',
    '  qty INTEGER NOT NULL,',
    '  amount_cent INTEGER NOT NULL,',
    '  commission_cent INTEGER NOT NULL DEFAULT 0,',
    '  stamp_cent INTEGER NOT NULL DEFAULT 0,',
    '  transfer_cent INTEGER NOT NULL DEFAULT 0,',
    '  fee_cent INTEGER NOT NULL DEFAULT 0,',
    '  realized_cent INTEGER NOT NULL DEFAULT 0,',
    '  trade_date TEXT,',
    '  created_at INTEGER NOT NULL DEFAULT 0',
    ')'
  ].join('\n'));

  d.exec('CREATE INDEX IF NOT EXISTS idx_stock_trades_user ON stock_trades(user_id, id DESC)');
  d.exec('CREATE INDEX IF NOT EXISTS idx_stock_trades_code ON stock_trades(code, id DESC)');

  d.exec([
    'CREATE TABLE IF NOT EXISTS stock_positions (',
    '  user_id TEXT NOT NULL,',
    '  code TEXT NOT NULL,',
    '  name TEXT,',
    '  qty INTEGER NOT NULL DEFAULT 0,',
    '  available_qty INTEGER NOT NULL DEFAULT 0,',
    '  cost_cent INTEGER NOT NULL DEFAULT 0,',
    '  updated_at INTEGER NOT NULL DEFAULT 0,',
    '  PRIMARY KEY (user_id, code)',
    ')'
  ].join('\n'));

  d.exec([
    'CREATE TABLE IF NOT EXISTS stock_watchlist (',
    '  user_id TEXT NOT NULL,',
    '  code TEXT NOT NULL,',
    '  name TEXT,',
    '  sort INTEGER NOT NULL DEFAULT 0,',
    '  created_at INTEGER NOT NULL DEFAULT 0,',
    '  PRIMARY KEY (user_id, code)',
    ')'
  ].join('\n'));

  d.exec([
    'CREATE TABLE IF NOT EXISTS stock_quotes (',
    '  code TEXT PRIMARY KEY,',
    '  name TEXT,',
    '  price_cent INTEGER NOT NULL DEFAULT 0,',
    '  prev_close_cent INTEGER NOT NULL DEFAULT 0,',
    '  open_cent INTEGER NOT NULL DEFAULT 0,',
    '  high_cent INTEGER NOT NULL DEFAULT 0,',
    '  low_cent INTEGER NOT NULL DEFAULT 0,',
    '  volume INTEGER NOT NULL DEFAULT 0,',
    '  amount INTEGER NOT NULL DEFAULT 0,',
    '  quoted_at INTEGER NOT NULL DEFAULT 0',
    ')'
  ].join('\n'));

  // ---- 成就 ----
  // ⚠️ 2026-11-03 补：achievements.js 一直在这里查这张表，但建表语句漏了 ——
  // 导致 /achievements 必 500、成就永远无法解锁（前端把错误吞了，表面看是
  // 「成就格子全是灰的」）。建表必须与查询字段一致：user_id+code 主键。
  d.exec([
    'CREATE TABLE IF NOT EXISTS stock_achievements (',
    '  user_id TEXT NOT NULL,',
    '  code TEXT NOT NULL,',
    '  unlocked_at INTEGER NOT NULL DEFAULT 0,',
    '  reward_cent INTEGER NOT NULL DEFAULT 0,',
    '  PRIMARY KEY (user_id, code)',
    ')'
  ].join('\n'));

  // ---- 跨班对决 ----
  // 对端广播过来的榜单摘要（relay 事件 stock_rank_share），按班级 upsert。
  // 只存网名与数字，不存学号/真名 —— 对决是公开的，身份是最小的。
  d.exec([
    'CREATE TABLE IF NOT EXISTS stock_peer_rank (',
    '  class_no TEXT PRIMARY KEY,',
    '  payload_json TEXT NOT NULL,',
    '  generated_at INTEGER NOT NULL DEFAULT 0,',
    '  received_at INTEGER NOT NULL DEFAULT 0',
    ')'
  ].join('\n'));

  // 每周班级对决的结算记录（week_key 如 2026-W45）。各班只结算自己班的奖励，
  // 双方用同一规则各自执行 —— 不需要跨班写对方的数据。
  d.exec([
    'CREATE TABLE IF NOT EXISTS stock_weekly_settle (',
    '  week_key TEXT PRIMARY KEY,',
    '  winner_class TEXT NOT NULL DEFAULT "",',
    '  my_avg_return REAL NOT NULL DEFAULT 0,',
    '  peer_avg_return REAL NOT NULL DEFAULT 0,',
    '  rewarded_count INTEGER NOT NULL DEFAULT 0,',
    '  detail_json TEXT,',
    '  settled_at INTEGER NOT NULL DEFAULT 0',
    ')'
  ].join('\n'));

  // 每日收盘报告（基于真实行情生成，全班共享一份）
  d.exec([
    'CREATE TABLE IF NOT EXISTS stock_daily_report (',
    '  date_key TEXT PRIMARY KEY,',
    '  payload_json TEXT NOT NULL,',
    '  created_at INTEGER NOT NULL DEFAULT 0',
    ')'
  ].join('\n'));
}

// ---- 账户与 T+1 ----
function ensureAccount(userId) {
  var d = db();
  d.prepare('INSERT OR IGNORE INTO stock_account (user_id, created_at) VALUES (?, ?)')
    .run(userId, Date.now());
  return d.prepare('SELECT * FROM stock_account WHERE user_id = ?').get(userId);
}

// 每个交易日第一次访问时，把昨日持仓解禁为可卖
function settleT1(userId, todayKey) {
  var d = db();
  var acc = ensureAccount(userId);
  if (acc.last_settle_date === todayKey) return acc;

  var tx = d.transaction(function () {
    d.prepare('UPDATE stock_positions SET available_qty = qty, updated_at = ? WHERE user_id = ?')
      .run(Date.now(), userId);
    d.prepare('UPDATE stock_account SET last_settle_date = ? WHERE user_id = ?')
      .run(todayKey, userId);
  });
  tx();
  return d.prepare('SELECT * FROM stock_account WHERE user_id = ?').get(userId);
}

// ---- 持仓 ----
function getPosition(userId, code) {
  return db().prepare('SELECT * FROM stock_positions WHERE user_id = ? AND code = ?').get(userId, code) || null;
}

function listPositions(userId) {
  return db().prepare('SELECT * FROM stock_positions WHERE user_id = ? AND qty > 0 ORDER BY updated_at DESC')
    .all(userId);
}

// ---- 委托 ----
function getOrder(userId, id) {
  return db().prepare('SELECT * FROM stock_orders WHERE id = ? AND user_id = ?').get(id, userId) || null;
}

function listOrders(userId, status, limit) {
  var d = db();
  var n = Math.min(Math.max(parseInt(limit, 10) || 30, 1), 100);
  if (status && status !== 'all') {
    if (status === 'pending') {
      return d.prepare("SELECT * FROM stock_orders WHERE user_id = ? AND status IN ('pending') ORDER BY id DESC LIMIT ?")
        .all(userId, n);
    }
    return d.prepare('SELECT * FROM stock_orders WHERE user_id = ? AND status = ? ORDER BY id DESC LIMIT ?')
      .all(userId, status, n);
  }
  return d.prepare('SELECT * FROM stock_orders WHERE user_id = ? ORDER BY id DESC LIMIT ?').all(userId, n);
}

function listTrades(userId, limit) {
  var n = Math.min(Math.max(parseInt(limit, 10) || 30, 1), 100);
  return db().prepare('SELECT * FROM stock_trades WHERE user_id = ? ORDER BY id DESC LIMIT ?').all(userId, n);
}

// ---- 自选 ----
function listWatch(userId) {
  return db().prepare('SELECT * FROM stock_watchlist WHERE user_id = ? ORDER BY sort ASC, created_at ASC')
    .all(userId);
}

function addWatch(userId, code, name) {
  var d = db();
  var max = d.prepare('SELECT COALESCE(MAX(sort), 0) AS m FROM stock_watchlist WHERE user_id = ?').get(userId).m;
  d.prepare('INSERT OR IGNORE INTO stock_watchlist (user_id, code, name, sort, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(userId, code, name || '', max + 1, Date.now());
  return true;
}

function removeWatch(userId, code) {
  return db().prepare('DELETE FROM stock_watchlist WHERE user_id = ? AND code = ?').run(userId, code).changes > 0;
}

// ---- 跨班对决 ----
function upsertPeerRank(classNo, payload, generatedAt) {
  var d = db();
  d.prepare([
    'INSERT INTO stock_peer_rank (class_no, payload_json, generated_at, received_at) VALUES (?, ?, ?, ?)',
    'ON CONFLICT(class_no) DO UPDATE SET payload_json = excluded.payload_json,',
    '  generated_at = excluded.generated_at, received_at = excluded.received_at'
  ].join('\n')).run(String(classNo), JSON.stringify(payload), generatedAt, Date.now());
}

function getPeerRank(classNo) {
  var row = db().prepare('SELECT * FROM stock_peer_rank WHERE class_no = ?').get(String(classNo));
  if (!row) return null;
  var payload = null;
  try { payload = JSON.parse(row.payload_json); } catch (e) { payload = null; }
  return payload ? {
    class_no: row.class_no,
    payload: payload,
    generated_at: row.generated_at,
    received_at: row.received_at
  } : null;
}

function listPeerRanks() {
  return db().prepare('SELECT * FROM stock_peer_rank ORDER BY received_at DESC').all();
}

function saveWeeklySettle(weekKey, winnerClass, myAvg, peerAvg, rewardedCount, detail) {
  db().prepare([
    'INSERT OR IGNORE INTO stock_weekly_settle (week_key, winner_class, my_avg_return, peer_avg_return, rewarded_count, detail_json, settled_at)',
    'VALUES (?, ?, ?, ?, ?, ?, ?)'
  ].join('\n')).run(weekKey, winnerClass, myAvg, peerAvg, rewardedCount, JSON.stringify(detail || {}), Date.now());
}

function getWeeklySettle(weekKey) {
  var row = db().prepare('SELECT * FROM stock_weekly_settle WHERE week_key = ?').get(weekKey);
  if (!row) return null;
  var detail = {};
  try { detail = JSON.parse(row.detail_json || '{}'); } catch (e) {}
  return {
    week_key: row.week_key,
    winner_class: row.winner_class,
    my_avg_return: row.my_avg_return,
    peer_avg_return: row.peer_avg_return,
    rewarded_count: row.rewarded_count,
    detail: detail,
    settled_at: row.settled_at
  };
}

function latestWeeklySettle() {
  var row = db().prepare('SELECT * FROM stock_weekly_settle ORDER BY settled_at DESC LIMIT 1').get();
  return row || null;
}

function saveDailyReport(dateKey, payload) {
  db().prepare([
    'INSERT INTO stock_daily_report (date_key, payload_json, created_at) VALUES (?, ?, ?)',
    'ON CONFLICT(date_key) DO UPDATE SET payload_json = excluded.payload_json, created_at = excluded.created_at'
  ].join('\n')).run(dateKey, JSON.stringify(payload), Date.now());
}

function getDailyReport(dateKey) {
  var row = dateKey
    ? db().prepare('SELECT * FROM stock_daily_report WHERE date_key = ?').get(dateKey)
    : db().prepare('SELECT * FROM stock_daily_report ORDER BY date_key DESC LIMIT 1').get();
  if (!row) return null;
  try {
    return { date_key: row.date_key, payload: JSON.parse(row.payload_json), created_at: row.created_at };
  } catch (e) { return null; }
}

module.exports = {
  db: db,
  ensureSchema: ensureSchema,
  ensureAccount: ensureAccount,
  settleT1: settleT1,
  getPosition: getPosition,
  listPositions: listPositions,
  getOrder: getOrder,
  listOrders: listOrders,
  listTrades: listTrades,
  listWatch: listWatch,
  addWatch: addWatch,
  removeWatch: removeWatch,
  upsertPeerRank: upsertPeerRank,
  getPeerRank: getPeerRank,
  listPeerRanks: listPeerRanks,
  saveWeeklySettle: saveWeeklySettle,
  getWeeklySettle: getWeeklySettle,
  latestWeeklySettle: latestWeeklySettle,
  saveDailyReport: saveDailyReport,
  getDailyReport: getDailyReport
};

// 模块加载即建表：应用被热挂载后第一条请求就有表可用
ensureSchema();
