// 成就系统（achievements）
// ============================================================
// 目的：给「真实但枯燥」的交易加上一层游戏化激励 —— 每个成就都是一次
// 真实的投资行为里程碑，奖励用学元（走 mint，ref 幂等，绝不重复发）。
//
// 检查时机：
//   · 每次成交结算后（trading.fillBuy/fillSell → checkAfterTrade）
//   · overview 加载时（checkUser，带 10 分钟节流，避免每次打开都全表扫）
//
// 解锁奖励：mint ref = stock:ach:<uid>:<code> —— 成就不可重复解锁，
//   即使表被清空，ref 幂等也兜住不会二次发钱。
//
// 编码约定：var / function

var nodePath = require('path');
var store = require('./store');
var quotes = require('./quotes');
var xueyuan = require(nodePath.resolve(process.cwd(), 'src/services/xueyuan'));
var db = require(nodePath.resolve(process.cwd(), 'src/utils/db'));

// ---- 成就定义 ----
// check(ctx) 返回 true 即解锁；ctx: { userId, positions, totals, realized, snapshot }
var DEFS = [
  {
    code: 'first_deal', label: '第一单', icon: '🎯', reward_cent: 2000,
    desc: '完成第一笔交易。万事开头难，开完这单后面就是数字游戏了。'
  },
  {
    code: 'first_gain', label: '落袋为安', icon: '💰', reward_cent: 3000,
    desc: '第一次卖出盈利的股票。浮盈不算赚，卖掉才算。'
  },
  {
    code: 'gain_10', label: '神之一手', icon: '⚡', reward_cent: 10000,
    desc: '单笔卖出收益率 ≥ 10%。'
  },
  {
    code: 'gain_500', label: '职业选手', icon: '🏆', reward_cent: 20000,
    desc: '累计已实现盈亏 ≥ +500 学元。'
  },
  {
    code: 'hold_3', label: '分散投资', icon: '🧺', reward_cent: 5000,
    desc: '同时持有 3 只股票。不把鸡蛋放在一个篮子里。'
  },
  {
    code: 'sector_3', label: '全行业配置', icon: '🗺️', reward_cent: 10000,
    desc: '同时持有 3 个不同板块的股票。'
  },
  {
    code: 'big_order', label: '重仓出击', icon: '🛒', reward_cent: 5000,
    desc: '单笔买入金额 ≥ 5000 学元。'
  },
  {
    code: 'days_3', label: '常客', icon: '📅', reward_cent: 8000,
    desc: '在 3 个不同的交易日有过成交。'
  },
  {
    code: 'fee_100', label: '交易所VIP', icon: '🎫', reward_cent: 5000,
    desc: '累计交易费用 ≥ 100 学元（亏是亏在手续费上的活证据）。'
  },
  {
    code: 'daily_7', label: '勤工俭学', icon: '🌅', reward_cent: 10000,
    desc: '在学元账户累计领取 7 天助学津贴。'
  }
];

var DEFS_MAP = {};
for (var i = 0; i < DEFS.length; i++) DEFS_MAP[DEFS[i].code] = DEFS[i];

// ---- 已解锁 ----
// 兜底：表理论上由 store.ensureSchema 创建，但历史库里可能缺失 ——
// 查询失败时按「全没解锁」处理，绝不能让 /achievements 整个 500。
function listUnlocked(userId) {
  var rows;
  try {
    rows = db.prepare('SELECT code, unlocked_at, reward_cent FROM stock_achievements WHERE user_id = ? ORDER BY unlocked_at ASC')
      .all(String(userId));
  } catch (e) {
    console.error('[stock-ach] stock_achievements 表不可读（%s），按未解锁处理', e.message);
    return {};
  }
  var out = {};
  for (var i = 0; i < rows.length; i++) {
    out[rows[i].code] = { unlocked_at: rows[i].unlocked_at, reward_cent: rows[i].reward_cent };
  }
  return out;
}

function unlock(userId, def, now) {
  // ⚠️ src/utils/db 导出的就是 Database 实例，不是工厂函数 ——
  // 这里曾写成 db()，TypeError 被上层 try/catch 吞掉，
  // 表现为「成就永远不解锁且毫无声息」（2026-11-03 e2e 捕获）。
  var d = db;
  var info = d.prepare('INSERT OR IGNORE INTO stock_achievements (user_id, code, unlocked_at, reward_cent) VALUES (?, ?, ?, ?)')
    .run(String(userId), def.code, now, def.reward_cent);
  if (!info.changes) return null; // 已解锁过
  // 奖励（ref 幂等：即使解锁记录被清也不会重复发钱）
  var granted = 0;
  try {
    var r = xueyuan.mint({
      to: userId,
      amountCent: def.reward_cent,
      kind: 'reward',
      ref: 'stock:ach:' + userId + ':' + def.code,
      app: 'stock',
      memo: '成就解锁：' + def.label
    });
    if (!r.duplicate) granted = def.reward_cent;
  } catch (e) {
    console.error('[stock-ach] 奖励发放失败 %s %s: %s', userId, def.code, e.message);
  }
  return { code: def.code, label: def.label, icon: def.icon, reward: def.reward_cent / 100, granted_cent: granted };
}

// ---- 检查 ----
var _lastCheck = {};
var CHECK_THROTTLE = 10 * 60 * 1000;

function checkUser(userId, opts) {
  var o = opts || {};
  var now = Date.now();
  if (!o.force && _lastCheck[userId] && now - _lastCheck[userId] < CHECK_THROTTLE) {
    return { checked: false, unlocked: [] };
  }
  _lastCheck[userId] = now;

  var unlocked = [];
  var have = listUnlocked(userId);

  function tryUnlock(def) {
    if (have[def.code]) return;
    var r = unlock(userId, def, now);
    if (r) unlocked.push(r);
  }

  try {
    var stats = collectStats(userId);
    for (var i = 0; i < DEFS.length; i++) {
      var def = DEFS[i];
      if (have[def.code]) continue;
      if (def.check(stats)) tryUnlock(def);
    }
  } catch (e) {
    console.error('[stock-ach] 检查失败 %s: %s', userId, e.message);
  }

  return { checked: true, unlocked: unlocked };
}

// 把十种成就需要的数据一次查齐（比每个成就各查一遍便宜）
function collectStats(userId) {
  var d = db;
  var uid = String(userId);

  var tradeAgg = d.prepare([
    'SELECT COUNT(*) AS trades,',
    '       COUNT(DISTINCT trade_date) AS days,',
    "       COALESCE(SUM(CASE WHEN side = 'buy' THEN amount_cent ELSE 0 END), 0) AS buy_amount,",
    "       MAX(CASE WHEN side = 'buy' THEN amount_cent ELSE 0 END) AS max_buy,",
    "       COALESCE(SUM(CASE WHEN side = 'sell' THEN realized_cent ELSE 0 END), 0) AS realized",
    'FROM stock_trades WHERE user_id = ?'
  ].join('\n')).get(uid);

  // 单笔卖出收益率 ≥10%：realized ≥ 10% × 成本（成本 = 成交额 − 费用）
  var hasGain10 = !!d.prepare([
    "SELECT 1 FROM stock_trades",
    "WHERE user_id = ? AND side = 'sell' AND realized_cent > 0",
    '  AND realized_cent * 10 >= amount_cent - fee_cent - realized_cent',
    'LIMIT 1'
  ].join('\n')).get(uid);

  // 首次盈利卖出
  var hasGain = !!d.prepare("SELECT 1 FROM stock_trades WHERE user_id = ? AND side = 'sell' AND realized_cent > 0 LIMIT 1").get(uid);

  var acc = store.ensureAccount(uid);
  var positions = store.listPositions(uid);

  // 持仓板块数
  var sectors = {};
  for (var i = 0; i < positions.length; i++) {
    var meta = quotes.UNIVERSE_MAP[positions[i].code];
    if (meta && meta.sector) sectors[meta.sector] = true;
  }

  // 津贴天数（跨应用查学元账本）
  var dailyDays = d.prepare("SELECT COUNT(DISTINCT ref) AS n FROM xy_tx WHERE ref LIKE ?").get('daily:' + uid + ':%').n;

  return {
    userId: uid,
    trades: tradeAgg.trades || 0,
    days: tradeAgg.days || 0,
    maxBuy: tradeAgg.max_buy || 0,
    realized: (tradeAgg.realized || 0),
    hasGain: hasGain,
    hasGain10: hasGain10,
    feeTotal: acc.fee_total_cent || 0,
    positionCount: positions.length,
    sectorCount: Object.keys(sectors).length,
    dailyDays: dailyDays || 0
  };
}

// 各成就的判定条件（collectStats 的消费方）
DEFS[0].check = function (s) { return s.trades >= 1; };
DEFS[1].check = function (s) { return s.hasGain; };
DEFS[2].check = function (s) { return s.hasGain10; };
DEFS[3].check = function (s) { return s.realized >= 50000; };
DEFS[4].check = function (s) { return s.positionCount >= 3; };
DEFS[5].check = function (s) { return s.sectorCount >= 3; };
DEFS[6].check = function (s) { return s.maxBuy >= 500000; };
DEFS[7].check = function (s) { return s.days >= 3; };
DEFS[8].check = function (s) { return s.feeTotal >= 10000; };
DEFS[9].check = function (s) { return s.dailyDays >= 7; };

// 成交后立即检查（不带节流）
function checkAfterTrade(userId) {
  return checkUser(userId, { force: true });
}

// ---- 视图 ----
function viewAll(userId) {
  var have = listUnlocked(userId);
  var out = [];
  for (var i = 0; i < DEFS.length; i++) {
    var def = DEFS[i];
    var got = have[def.code];
    out.push({
      code: def.code,
      label: def.label,
      icon: def.icon,
      desc: def.desc,
      reward: def.reward_cent / 100,
      unlocked: !!got,
      unlocked_at: got ? got.unlocked_at : 0
    });
  }
  var count = 0;
  for (var j = 0; j < out.length; j++) if (out[j].unlocked) count++;
  return { list: out, unlocked_count: count, total: out.length };
}

function tableExists() {
  try {
    return !!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='stock_achievements'").get();
  } catch (e) { return false; }
}

module.exports = {
  DEFS: DEFS,
  listUnlocked: listUnlocked,
  checkUser: checkUser,
  checkAfterTrade: checkAfterTrade,
  viewAll: viewAll
};
