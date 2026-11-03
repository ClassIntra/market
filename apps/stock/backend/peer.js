// 跨班对决（peer）
// ============================================================
// 8i 与 18i 各跑一份本应用，中间靠 ClassIntra 既有的 relay 总线互通：
//   · 每半小时把自己的榜单摘要广播给对端（net_name + 数字，不带学号/真名）
//   · 收到对端的摘要存 stock_peer_rank（按班级 upsert）
//   · 每周五收盘后结算「本周班级对决」：人均收益率高者胜，
//     胜方班在自己班内给「本周活跃」的学生每人发学元奖励
//
// 为什么各班只发自己班的奖励：
//   跨班写对方的数据库是不可能的（也不应该）。双方用同一规则、同一份
//   对端收盘数据各自判定，胜方给自己班发钱 —— 结果天然一致，最多因为
//   数据时差有极小概率两边同时判胜，代价只是多发一份 100 学元，可接受。
//
// 隐私边界：payload 里只有 net_name（网名）、总资产、收益率、参与人数。
//   学号、真名、单笔交易一律不出村。对决是公开的，身份是最小的。
//
// 编码约定：var / function

var nodePath = require('path');
var market = require('./market');
var store = require('./store');
var quotes = require('./quotes');
var xueyuan = require(nodePath.resolve(process.cwd(), 'src/services/xueyuan'));
var db = require(nodePath.resolve(process.cwd(), 'src/utils/db'));

var WEEKLY_WIN_REWARD_CENT = 10000;   // 周冠军奖励：100 学元/人
var PEER_FRESH_MS = 48 * 3600 * 1000; // 对端数据有效期（平板不天天用，放宽到 48h）
var BROADCAST_INTERVAL = 30 * 60 * 1000;

// ---- 班级标识 ----
// user_id 编码 YYCCNN，CC 段就是班级。取本班「有学元账户」用户的多数派，
// 机器人账号（非 6 位学号）天然被排除。
function localClassNo() {
  var rows = db.prepare([
    "SELECT substr(a.user_id, 3, 2) AS cc, COUNT(*) AS n",
    "FROM xy_account a",
    "WHERE length(a.user_id) = 6 AND a.user_id NOT LIKE '@%'",
    'GROUP BY cc ORDER BY n DESC LIMIT 1'
  ].join('\n')).get();
  return rows && rows.cc ? rows.cc : '';
}

function className(cc) {
  if (!cc) return '本班';
  var n = parseInt(cc, 10);
  return (isFinite(n) ? n : cc) + ' 班';
}

// ---- 本班榜单（对决口径） ----
// 同步版本：由调用方把 snapshot 传进来（quotes.getSnapshot() 的结果）
function buildLocalPayload(snapshot) {
  var byCode = (snapshot && snapshot.byCode) || {};
  // 只统计进过本应用的人（stock_account 首开 overview 时创建），并带上
  // 「有没有真的在玩」的标记：对决的人均收益率只算有持仓或有过成交的活跃者，
  // 否则一屋子刚开户还没动手的账号会把均值稀释成 0（2026-11-03 修）。
  var accounts = db.prepare([
    'SELECT a.user_id, a.balance, u.net_name,',
    '  COALESCE(s.trade_count, 0) AS trade_count,',
    '  (SELECT COUNT(*) FROM stock_positions p WHERE p.user_id = a.user_id AND p.qty > 0) AS pos_count',
    'FROM xy_account a',
    'JOIN stock_account s ON s.user_id = a.user_id',
    'LEFT JOIN users u ON u.user_id = a.user_id',
    "WHERE a.user_id NOT LIKE '@%' AND length(a.user_id) = 6"
  ].join('\n')).all();

  var posRows = db.prepare('SELECT user_id, code, qty, cost_cent FROM stock_positions WHERE qty > 0').all();
  var posMap = {};
  for (var i = 0; i < posRows.length; i++) {
    var p = posRows[i];
    if (!posMap[p.user_id]) posMap[p.user_id] = [];
    posMap[p.user_id].push(p);
  }
  // 净投入按成交流水反推（与 /rank 同口径，2026-11-03 修复）：
  // 净投入 = 余额 + 买入总流出(含费) − 卖出净回流；盈亏 = 总资产 − 净投入。
  // 旧算法把现金余额算进了「盈亏」，人均收益率全是虚数，周五对决会拿它分胜负。
  var flowRows = db.prepare([
    "SELECT user_id,",
    "  COALESCE(SUM(CASE WHEN side = 'buy' THEN amount_cent + fee_cent ELSE 0 END), 0) AS buy_out_cent,",
    "  COALESCE(SUM(CASE WHEN side = 'sell' THEN amount_cent - fee_cent ELSE 0 END), 0) AS sell_in_cent",
    'FROM stock_trades GROUP BY user_id'
  ].join('\n')).all();
  var flowMap = {};
  for (var fr = 0; fr < flowRows.length; fr++) flowMap[flowRows[fr].user_id] = flowRows[fr];

  var list = [];
  for (var j = 0; j < accounts.length; j++) {
    var a = accounts[j];
    var pos = posMap[a.user_id] || [];
    var mv = 0;
    for (var k = 0; k < pos.length; k++) {
      var q = byCode[pos[k].code];
      mv += (q ? q.price_cent : 0) * pos[k].qty;
    }
    var flow = flowMap[a.user_id] || { buy_out_cent: 0, sell_in_cent: 0 };
    var total = a.balance + mv;
    var invested = a.balance + flow.buy_out_cent - flow.sell_in_cent;
    var pnl = total - invested;
    list.push({
      net_name: a.net_name || '同学',
      total_asset: Math.round(total) / 100,
      pnl: Math.round(pnl) / 100,
      return_pct: invested > 0 ? Math.round(pnl / invested * 10000) / 100 : 0,
      active: (a.trade_count > 0) || (a.pos_count > 0)
    });
  }

  // 活跃 = 有过成交或当前有持仓；人均与 top 榜都只算这批人
  var active = list.filter(function (x) { return x.active; });
  active.sort(function (x, y) { return y.total_asset - x.total_asset; });
  var avg = 0;
  if (active.length) {
    var sum = 0;
    for (var m = 0; m < active.length; m++) sum += active[m].return_pct;
    avg = Math.round(sum / active.length * 100) / 100;
  }
  var top = [];
  for (var t = 0; t < active.length && top.length < 10; t++) {
    top.push({
      net_name: active[t].net_name,
      total_asset: active[t].total_asset,
      pnl: active[t].pnl,
      return_pct: active[t].return_pct
    });
  }

  return {
    class_no: localClassNo(),
    generated_at: Date.now(),
    participants: active.length,
    avg_return: avg,
    top: top
  };
}

// ---- 广播 ----
var bus = null;
function getBus() {
  if (bus) return bus;
  try { bus = require(nodePath.resolve(process.cwd(), 'src/utils/relay-bus')); } catch (e) { bus = null; }
  return bus;
}

function broadcastNow() {
  return quotes.getSnapshot().then(function (snap) {
    var payload = buildLocalPayload(snap);
    var b = getBus();
    if (b && typeof b.emit === 'function') {
      try {
        b.emit('stock_rank_share', payload);
        return true;
      } catch (e) {
        console.warn('[stock-peer] 广播失败:', e.message);
        return false;
      }
    }
    return false;
  }).catch(function () { return false; });
}

// ---- 接收 ----
function registerRelay() {
  var b = getBus();
  if (!b || typeof b.register !== 'function') return false;
  if (b.registry && b.registry['stock_rank_share']) return true; // 已注册（热重载防重）
  b.register('stock_rank_share', function (payload) {
    try {
      if (!payload || !payload.class_no || !Array.isArray(payload.top)) return;
      store.upsertPeerRank(payload.class_no, payload, payload.generated_at || Date.now());
      console.log('[stock-peer] 收到 %s 班战报（%d 人参与）', payload.class_no, payload.participants || 0);
    } catch (e) {
      console.error('[stock-peer] 保存对端战报失败:', e.message);
    }
  });
  return true;
}

// ---- 周结算 ----
function pad2(n) { return n < 10 ? '0' + n : String(n); }

// ISO 周键：2026-W45。以周一为一周开始（北京时间）。
function weekKeyOf(ts) {
  var d = new Date((ts || Date.now()) + 8 * 3600 * 1000);
  var dow = (d.getUTCDay() + 6) % 7; // 周一=0
  var thursday = new Date(d.getTime() + (3 - dow) * 86400000);
  var jan1 = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 1));
  var week = Math.ceil((((thursday - jan1) / 86400000) + jan1.getUTCDay() + 1) / 7);
  return thursday.getUTCFullYear() + '-W' + pad2(week);
}

function weekStartOf(ts) {
  var d = new Date((ts || Date.now()) + 8 * 3600 * 1000);
  var dow = (d.getUTCDay() + 6) % 7;
  var mondayUtc = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - dow * 86400000;
  return mondayUtc - 8 * 3600 * 1000;
}

// 本周活跃学生：本周有过成交，或当前有持仓
function weekActiveUsers(weekStart, todayKey) {
  var rows = db.prepare([
    'SELECT DISTINCT user_id FROM stock_trades WHERE trade_date >= ?',
    'UNION',
    'SELECT user_id FROM stock_positions WHERE qty > 0'
  ].join('\n')).all(market.dateKey(weekStart));
  var out = [];
  for (var i = 0; i < rows.length; i++) out.push(rows[i].user_id);
  return out;
}

// 结算入口：条件满足才真正结算，否则返回 { skipped: reason }。
// opts.skipDayCheck：班管手动补结算用（跳过「周五 15:05」检查，
//   但对端数据有效期、周幂等、活跃判定照常）。
function maybeWeeklySettle(now, opts) {
  var ts = now || Date.now();
  var o = opts || {};
  if (!o.skipDayCheck) {
    var p = market.bjParts(ts);
    if (p.weekday !== 5) return Promise.resolve({ skipped: 'not-friday' });
    if (p.hour * 60 + p.minute < 15 * 60 + 5) return Promise.resolve({ skipped: 'too-early' });
  }

  var weekKey = weekKeyOf(ts);
  if (store.getWeeklySettle(weekKey)) return Promise.resolve({ skipped: 'already-settled' });

  var myClass = localClassNo();
  var peers = store.listPeerRanks();
  var peerRow = null;
  for (var i = 0; i < peers.length; i++) {
    var pr = peers[i];
    if (pr.class_no === myClass) continue;                 // 自己的广播不认（单机自环保护）
    if (ts - pr.received_at > PEER_FRESH_MS) continue;      // 太旧
    // ⚠️ listPeerRanks 返回的是原始行（payload_json 是字符串）——
    // 这里曾直接读 pr.payload（undefined）→ participants 判 0 →
    // 永远 skipped:'peer-empty'，周五对决从未真正结算过（2026-11-03 e2e 捕获）。
    var parsed = null;
    try { parsed = JSON.parse(pr.payload_json); } catch (e) { parsed = null; }
    if (!parsed) continue;
    peerRow = { class_no: pr.class_no, payload: parsed, received_at: pr.received_at };
    break;
  }
  if (!peerRow) return Promise.resolve({ skipped: 'no-fresh-peer' });

  var peerPayload = peerRow.payload || {};
  if (!(peerPayload.participants > 0)) return Promise.resolve({ skipped: 'peer-empty' });

  return quotes.getSnapshot().then(function (snap) {
    var myPayload = buildLocalPayload(snap);
    if (!(myPayload.participants > 0)) return { skipped: 'self-empty' };

    var myAvg = myPayload.avg_return;
    var peerAvg = Number(peerPayload.avg_return) || 0;
    // 并列不开奖（差距 < 0.05 个百分点视为平局）
    if (Math.abs(myAvg - peerAvg) < 0.05) {
      store.saveWeeklySettle(weekKey, '', myAvg, peerAvg, 0, { result: 'tie' });
      return { settled: true, result: 'tie' };
    }
    var iWin = myAvg > peerAvg;
    var winnerClass = iWin ? myClass : String(peerPayload.class_no);

    var rewarded = 0;
    if (iWin) {
      var weekStart = weekStartOf(ts);
      var actives = weekActiveUsers(weekStart);
      for (var j = 0; j < actives.length; j++) {
        try {
          var r = xueyuan.mint({
            to: actives[j],
            amountCent: WEEKLY_WIN_REWARD_CENT,
            kind: 'reward',
            ref: 'stock:weekly:' + weekKey + ':' + actives[j],
            app: 'stock',
            memo: '班级对决周冠军奖励（' + className(myClass) + '）',
            meta: { week_key: weekKey, my_avg: myAvg, peer_avg: peerAvg }
          });
          if (!r.duplicate) rewarded++;
        } catch (e) {
          console.error('[stock-peer] 周奖励发放失败 %s: %s', actives[j], e.message);
        }
      }
    }

    store.saveWeeklySettle(weekKey, winnerClass, myAvg, peerAvg, rewarded, {
      result: iWin ? 'win' : 'lose',
      my_class: myClass,
      peer_class: String(peerPayload.class_no),
      participants: myPayload.participants,
      peer_participants: peerPayload.participants,
      reward_cent: WEEKLY_WIN_REWARD_CENT
    });
    console.log('[stock-peer] 周对决结算 %s：%s 胜（%.2f%% vs %.2f%%），奖励 %d 人',
      weekKey, iWin ? '本班' : '对端', myAvg, peerAvg, rewarded);
    return { settled: true, result: iWin ? 'win' : 'lose', rewarded: rewarded };
  });
}

// ---- 定时器 ----
var _timer = null;
function start() {
  if (_timer) return;
  registerRelay();
  // 启动 5 秒后先广播一次（对端尽快有数据），之后每 30 分钟
  setTimeout(broadcastNow, 5000);
  _timer = setInterval(function () {
    broadcastNow();
    maybeWeeklySettle().catch(function () {});
  }, BROADCAST_INTERVAL);
  if (_timer.unref) _timer.unref();
}

function stop() {
  if (_timer) { clearInterval(_timer); _timer = null; }
}

module.exports = {
  localClassNo: localClassNo,
  className: className,
  buildLocalPayload: buildLocalPayload,
  broadcastNow: broadcastNow,
  registerRelay: registerRelay,
  maybeWeeklySettle: maybeWeeklySettle,
  weekKeyOf: weekKeyOf,
  weekStartOf: weekStartOf,
  weekActiveUsers: weekActiveUsers,
  start: start,
  stop: stop,
  WEEKLY_WIN_REWARD_CENT: WEEKLY_WIN_REWARD_CENT,
  PEER_FRESH_MS: PEER_FRESH_MS
};
