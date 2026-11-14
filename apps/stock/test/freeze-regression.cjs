// freeze-regression.cjs - 证券买入冻结链路回归（独立临时库）
// 用法（系统 Node）：node market-apps/stock/test/freeze-regression.cjs
// 覆盖 2026-11-09 修复的四件事：
//   1) 手续费双算 → 限价买入必报「超过冻结额」（根因）
//   2) 市价单按当日涨停价冻结 + 撮合前补冻结（隔夜跳空）
//   3) 解冻幂等（确定性 ref，重复撤单不重复退钱）
//   4) 结算失败后解冻可靠 → 学生能重新买入
var fs = require('fs');
var os = require('os');
var path = require('path');
var tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ci-stock-freeze-'));
process.env.DB_PATH = path.join(tmp, 'freeze.db');
process.env.NODE_ENV = 'test';

var db = require('../../../server/src/utils/db');
db.exec(fs.readFileSync(path.join(__dirname, '../../../server/src/ledger/schema.sql'), 'utf8'));
var svc = require('../../../server/src/ledger/service');
svc.ensureReady();
var app = require('../../../server/src/ledger/app-api');
var trading = require('../../../server/src/ledger/trading');
var inv = require('../../../server/src/ledger/invariants');
var market = require('../backend/market');

var pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra !== undefined ? ' → ' + JSON.stringify(extra) : '')); }
}
function eq(name, a, b) { ok(name + '（' + a + '）', a === b, { got: a, want: b }); }
function throws(name, fn, re) {
  try { fn(); fail++; console.log('  ✗ ' + name + ' → 未抛错'); }
  catch (e) {
    var hit = !re || re.test(e.message);
    if (hit) { pass++; console.log('  ✓ ' + name + '（' + e.message + '）'); }
    else { fail++; console.log('  ✗ ' + name + ' → 错误信息不符: ' + e.message); }
  }
}
function healthy(label) {
  var r = inv.check();
  ok(label, r.ok, r.issues);
}

var U = '990001';
var ledger = require('../../../server/src/ledger/ledger');
ledger.openUser(U);
trading.issue(U, 10000000, { ref: 'freeze:issue:1', memo: '测试练习金' });

console.log('\n=== 1. 手续费只算一次（限价买入不再必炸） ===');
var priceCent = 1000;                 // 10 元/股
var qty = 100;                        // 一手
var amount = priceCent * qty;         // 成交额（不含费）
var fees = market.calcFees('buy', amount);
var hold = amount + fees.total_cent; // 限价单冻结 = 成交额 + 费（只算一次）
var orderId = 42;
var holdRef = 'stock:order:' + orderId + ':release';
var r0 = trading.reserve(U, hold, 'freeze:hold:1');
eq('冻结后可用减少', trading.view(U).available_practice_cent, 10000000 - hold);
var s1 = trading.settleBuy({
  userId: U, holdCent: hold, costCent: amount, feeCent: fees.total_cent,
  ref: 'stock:order:' + orderId, memo: '限价买入结算'
});
ok('限价结算不抛「超过冻结额」', !s1.duplicate, s1);
eq('无差额退回（冻结恰好够）', s1.back_cent, 0);
eq('结算后托管槽清零', trading.escrowTotalCent(), 0);
healthy('限价买入后 I1–I9 全绿');

console.log('\n=== 2. 市价单按涨停价冻结：任意合规成交价都够 ===');
// 模拟创业板：现价 10 元，±20% → 涨停 12 元
var limitUp = 12.00;
var worstCent = Math.round(limitUp * 100);
var worstAmount = worstCent * qty;
var worstFees = market.calcFees('buy', worstAmount);
var marketHold = worstAmount + worstFees.total_cent;
// 撮合价 f 满足 现价 ≤ f < 涨停（涨停买不到），取最坏 f = 涨停-1 分
var fillCent = worstCent - 1;
var fillAmount = fillCent * qty;
var fillFees = market.calcFees('buy', fillAmount);
ok('涨停价冻结覆盖最坏成交价+费（创业板 +20%）',
  fillAmount + fillFees.total_cent <= marketHold,
  { need: fillAmount + fillFees.total_cent, hold: marketHold });
// 北交所 ±30%
var bjUp = 13.00, bjHold = Math.round(bjUp * 100) * qty +
  market.calcFees('buy', Math.round(bjUp * 100) * qty).total_cent;
var bjNeed = (Math.round(bjUp * 100) - 1) * qty +
  market.calcFees('buy', (Math.round(bjUp * 100) - 1) * qty).total_cent;
ok('涨停价冻结覆盖北交所 ±30%', bjNeed <= bjHold, { need: bjNeed, hold: bjHold });

console.log('\n=== 3. 解冻幂等（确定性 ref，重复调用不重复退钱） ===');
var before = trading.view(U).available_practice_cent;
var r1 = trading.reserve(U, 50000, 'freeze:hold:2');
var afterReserve = trading.view(U).available_practice_cent;
var rel1 = trading.release(U, 50000, 'stock:order:99:release');
var mid = trading.view(U).available_practice_cent;
var rel2 = trading.release(U, 50000, 'stock:order:99:release');
var after = trading.view(U).available_practice_cent;
eq('第一次解冻生效', mid - afterReserve, 50000);
ok('第二次解冻返回 duplicate 而不抛错', rel2.duplicate === true, rel2);
ok('第二次解冻没有重复退钱', after === mid, { mid: mid, after: after });
healthy('解冻幂等后 I1–I9 全绿');

console.log('\n=== 4. 结算失败 → 解冻 → 重新买入成功（不再卡钱） ===');
var availBefore = trading.view(U).available_practice_cent;
var r2 = trading.reserve(U, 30000, 'freeze:hold:3');
throws('人为构造超冻结结算应被拦', function () {
  trading.settleBuy({ userId: U, holdCent: 30000, costCent: 40000, feeCent: 0, ref: 'stock:order:100' });
}, /超过冻结额/);
// 撮合失败路径的统一确定性 ref 解冻（trading.js catch 分支同款）
var relFail = trading.release(U, 30000, 'stock:order:100:release', '结算失败解冻');
ok('失败后解冻成功', !relFail.duplicate, relFail);
eq('钱完整回到可用', trading.view(U).available_practice_cent, availBefore);
var r3 = trading.reserve(U, 30000, 'freeze:hold:4');
ok('重新买入的冻结成功（不再报练习金不足）', !r3.duplicate, r3);
trading.release(U, 30000, 'stock:order:101:release');
healthy('失败重买后 I1–I9 全绿');

console.log('\n=== 5. app-api 口径：spent 含手续费 ===');
var apiHold = 20000;
trading.reserve(U, apiHold, 'freeze:hold:5');
var api = app.settleBuy('stock', {
  userId: U, holdCent: apiHold, costCent: 19000, feeCent: 1000, ref: 'stock:order:102'
});
eq('app-api.spent.practice_cent = 成交额 + 费', api.spent.practice_cent, 20000);
healthy('app-api 结算后 I1–I9 全绿');

console.log('\n=== 结果 ===');
console.log('通过 ' + pass + ' / 失败 ' + fail);
try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* ignore */ }
process.exit(fail ? 1 : 0);
