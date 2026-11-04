// 学元红包
// ============================================================
// 设计：**不引入资金池**。
//   发红包 → 冻结发送者 total_cent（xueyuan.hold）
//   领取   → 解冻该笔金额（release）+ 直接从发送者转账给领取者（transfer）
//   过期   → 解冻剩余（release）
// 这样账本始终是「发送者 → 领取者」，不需要系统托管账户，也不会出现池子对不上账。
//
// 金额分配用「二倍均值法」：每次随机 [1, 剩余/剩余个数×2]，最后一人拿走全部剩余。
var nodePath = require('path');
var db = require(nodePath.resolve(process.cwd(), 'src/utils/db'));
var xueyuan = require(nodePath.resolve(process.cwd(), 'src/services/xueyuan'));
var notify = require('./notify');

var MAX_TOTAL_CENT = 50000;      // 500 学元，与单笔转账上限一致
var MAX_COUNT = 20;
var TTL = 24 * 3600 * 1000;
var ready = false;

function ensure() {
  if (ready) return;
  db.exec([
    'CREATE TABLE IF NOT EXISTS xy_packet (',
    '  id INTEGER PRIMARY KEY AUTOINCREMENT,',
    '  sender TEXT NOT NULL,',
    '  total_cent INTEGER NOT NULL,',
    '  count INTEGER NOT NULL,',
    '  note TEXT,',
    '  remaining_cent INTEGER NOT NULL,',
    '  remaining_count INTEGER NOT NULL,',
    '  status TEXT NOT NULL DEFAULT \'open\',',
    '  created_at INTEGER NOT NULL,',
    '  expire_at INTEGER NOT NULL',
    ');',
    'CREATE TABLE IF NOT EXISTS xy_packet_claim (',
    '  packet_id INTEGER NOT NULL,',
    '  user_id TEXT NOT NULL,',
    '  amount_cent INTEGER NOT NULL,',
    '  created_at INTEGER NOT NULL,',
    '  PRIMARY KEY (packet_id, user_id)',
    ');',
    'CREATE INDEX IF NOT EXISTS idx_xy_packet_status ON xy_packet(status, expire_at);'
  ].join('\n'));
  ready = true;
}

function userName(uid) {
  try {
    var r = db.prepare('SELECT net_name, real_name FROM users WHERE user_id = ?').get(String(uid));
    return (r && (r.net_name || r.real_name)) || String(uid).slice(-4);
  } catch (e) { return String(uid).slice(-4); }
}

function toCent(v) {
  var n = Number(v);
  if (!isFinite(n)) return 0;
  return Math.round(n * 100);
}

// 发红包
function create(sender, totalCent, count, note) {
  ensure();
  var total = Math.round(Number(totalCent) || 0);
  var n = Math.round(Number(count) || 0);
  if (total < 1) throw new Error('红包金额至少 0.01 学元');
  if (total > MAX_TOTAL_CENT) throw new Error('单个红包不能超过 ' + (MAX_TOTAL_CENT / 100) + ' 学元');
  if (n < 1 || n > MAX_COUNT) throw new Error('红包个数需在 1–' + MAX_COUNT + ' 之间');
  if (total < n) throw new Error('每个红包至少 0.01 学元，总金额不够分');

  var now = Date.now();
  var id = 0;
  var tx = db.transaction(function () {
    xueyuan.hold(sender, total);   // 冻结；失败会抛「可用学元不足」
    var info = db.prepare([
      'INSERT INTO xy_packet (sender, total_cent, count, note, remaining_cent, remaining_count, status, created_at, expire_at)',
      "VALUES (?, ?, ?, ?, ?, ?, 'open', ?, ?)"
    ].join('\n')).run(sender, total, n, String(note || '').slice(0, 40), total, n, now, now + TTL);
    id = info.lastInsertRowid;
  });
  tx();

  return {
    id: id,
    total: total / 100,
    count: n,
    remaining_cent: total,
    remaining_count: n,
    expire_at: now + TTL,
    note: note || ''
  };
}

// 领红包
function claim(packetId, userId) {
  ensure();
  var out = null;
  var tx = db.transaction(function () {
    var p = db.prepare('SELECT * FROM xy_packet WHERE id = ?').get(packetId);
    if (!p) throw new Error('红包不存在');
    var prev = db.prepare('SELECT * FROM xy_packet_claim WHERE packet_id = ? AND user_id = ?')
      .get(packetId, userId);
    if (prev) {
      out = { claimed: true, duplicate: true, amount: prev.amount_cent / 100 };
      return;
    }
    if (p.sender === userId) throw new Error('不能领自己发的红包');
    if (p.status !== 'open' || p.remaining_count <= 0) throw new Error('红包已被领完');
    if (Date.now() > p.expire_at) throw new Error('红包已过期');

    // 二倍均值：最后一个拿剩余全部
    var amount;
    if (p.remaining_count === 1) {
      amount = p.remaining_cent;
    } else {
      var max = Math.floor(p.remaining_cent / p.remaining_count * 2) - 1;
      var min = 1;
      var cap = p.remaining_cent - (p.remaining_count - 1);
      amount = Math.min(cap, min + Math.floor(Math.random() * Math.max(1, Math.min(max, cap) - min + 1)));
      if (amount < 1) amount = 1;
    }

    xueyuan.release(p.sender, amount);   // 先解冻，再转出（转账失败会抛，事务回滚解冻）
    xueyuan.transfer({
      from: p.sender,
      to: userId,
      amountCent: amount,
      ref: 'packet:' + p.id + ':' + userId,
      app: 'stock',
      memo: '红包 · ' + (p.note || '恭喜发财')
    });
    db.prepare([
      'UPDATE xy_packet SET remaining_cent = remaining_cent - ?, remaining_count = remaining_count - 1,',
      "  status = CASE WHEN remaining_count - 1 <= 0 THEN 'done' ELSE status END",
      'WHERE id = ?'
    ].join('\n')).run(amount, p.id);
    db.prepare('INSERT INTO xy_packet_claim (packet_id, user_id, amount_cent, created_at) VALUES (?, ?, ?, ?)')
      .run(p.id, userId, amount, Date.now());

    out = {
      claimed: true,
      duplicate: false,
      amount: amount / 100,
      remaining_count: p.remaining_count - 1
    };
  });
  tx();

  // 通知发送者（事务外，通知失败不影响资金）
  if (out && !out.duplicate && out.amount > 0) {
    try {
      var p2 = db.prepare('SELECT sender, note FROM xy_packet WHERE id = ?').get(packetId);
      notify.push(p2.sender, {
        kind: 'packet',
        title: userName(userId) + ' 领了你的红包 ' + out.amount.toFixed(2) + ' 学元',
        body: p2.note ? '备注：' + p2.note : '',
        ref: 'packet-claim:' + packetId + ':' + userId
      });
    } catch (e) { /* ignore */ }
  }
  return out;
}

// 列表：可领的（别人的、还开着、我没领过）+ 我发出的
function list(userId) {
  ensure();
  var now = Date.now();
  var available = db.prepare([
    'SELECT p.*, (SELECT COUNT(*) FROM xy_packet_claim c WHERE c.packet_id = p.id) AS claimed_count',
    'FROM xy_packet p',
    "WHERE p.status = 'open' AND p.remaining_count > 0 AND p.expire_at > ? AND p.sender <> ?",
    '  AND NOT EXISTS (SELECT 1 FROM xy_packet_claim c2 WHERE c2.packet_id = p.id AND c2.user_id = ?)',
    'ORDER BY p.id DESC LIMIT 20'
  ].join('\n')).all(now, String(userId), String(userId));

  var mine = db.prepare([
    'SELECT p.*,',
    '  (SELECT COUNT(*) FROM xy_packet_claim c WHERE c.packet_id = p.id) AS claimed_count,',
    '  (SELECT COALESCE(SUM(amount_cent), 0) FROM xy_packet_claim c WHERE c.packet_id = p.id) AS claimed_cent',
    'FROM xy_packet p WHERE p.sender = ? ORDER BY p.id DESC LIMIT 10'
  ].join('\n')).all(String(userId));

  var claimedByMe = db.prepare([
    'SELECT c.*, p.note, p.sender FROM xy_packet_claim c JOIN xy_packet p ON p.id = c.packet_id',
    'WHERE c.user_id = ? ORDER BY c.created_at DESC LIMIT 10'
  ].join('\n')).all(String(userId));

  function view(p) {
    return {
      id: p.id,
      sender: p.sender,
      sender_name: userName(p.sender),
      total: p.total_cent / 100,
      count: p.count,
      note: p.note || '',
      remaining: p.remaining_cent / 100,
      remaining_count: p.remaining_count,
      claimed_count: p.claimed_count || 0,
      status: p.status,
      expire_at: p.expire_at,
      mine: p.sender === String(userId)
    };
  }

  return {
    available: available.map(view),
    mine: mine.map(view),
    claimed: claimedByMe.map(function (c) {
      return {
        id: c.packet_id,
        amount: c.amount_cent / 100,
        note: c.note || '',
        sender_name: userName(c.sender),
        created_at: c.created_at
      };
    })
  };
}

// 过期退款：把还没领完的冻结点解冻（无定时任务，懒清理）
function sweepExpired() {
  ensure();
  var now = Date.now();
  var rows = db.prepare("SELECT * FROM xy_packet WHERE status = 'open' AND expire_at <= ? AND remaining_cent > 0")
    .all(now);
  var n = 0;
  for (var i = 0; i < rows.length; i++) {
    var p = rows[i];
    try {
      xueyuan.release(p.sender, p.remaining_cent);
      db.prepare("UPDATE xy_packet SET status = 'expired', remaining_count = 0 WHERE id = ?").run(p.id);
      n++;
    } catch (e) { /* 下一轮再试 */ }
  }
  return n;
}

module.exports = {
  ensure: ensure,
  toCent: toCent,
  create: create,
  claim: claim,
  list: list,
  sweepExpired: sweepExpired,
  userName: userName,
  MAX_TOTAL_CENT: MAX_TOTAL_CENT,
  MAX_COUNT: MAX_COUNT
};
