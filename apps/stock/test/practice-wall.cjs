// 证券「练习金出不了证券」边界测试（独立临时库）
// 用法：node market-apps/stock/test/practice-wall.cjs
//
// 为什么单独一条：
//   完整的 e2e 依赖真实行情、支付密码、撮合器，跑一轮要几十秒；
//   而这条边界只关心两件事：
//     1) 无论学生账上有多少真钱，证券都只能动练习金；
//     2) 练习金一分都流不出证券 —— 不能转账、不能发红包、不能买东西。
//   第二件事是「印多少钱都不会让钱变毛」的全部依据，值得用又短又硬的断言守着。
//
// 同时做源码守卫：trading.js 必须显式传 { pool: 'practice' } / POOL.PRACTICE，
// 否则有人重构时删掉这个参数，测试会当场报警。

var fs = require('fs');
var os = require('os');
var path = require('path');

var REPO = path.resolve(__dirname, '../../..');
var SERVER = path.join(REPO, 'server');

var tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ci-practice-wall-'));
process.env.DB_PATH = path.join(tmpDir, 'test.db');
process.env.NODE_ENV = 'test';

var pass = 0;
var fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra !== undefined ? ' → ' + JSON.stringify(extra) : '')); }
}
function eq(name, a, b) { ok(name + '（' + JSON.stringify(a) + '）', a === b, { got: a, want: b }); }
function throws(name, fn, re) {
  try { fn(); fail++; console.log('  ✗ ' + name + ' → 未抛错'); }
  catch (e) {
    if (!re || re.test(e.message)) { pass++; console.log('  ✓ ' + name + '（' + e.message + '）'); }
    else { fail++; console.log('  ✗ ' + name + ' → 错误信息不符: ' + e.message); }
  }
}

console.log('\n=== 建库 ===');
var runner = require(path.join(SERVER, 'src/utils/migration-runner'));
var r = runner.runAll();
console.log('迁移到 v' + r.currentVersion + '，执行 ' + r.applied + ' 个');

var db = require(path.join(SERVER, 'src/utils/db'));
var xy = require(path.join(SERVER, 'src/services/xueyuan'));

var U = '263801';
var V = '263802';
db.prepare("INSERT INTO users (net_name, real_name, user_id, password_hash, status) VALUES (?, ?, ?, 'x', 'active')")
  .run('测试同学', '测试同学', U);
db.prepare("INSERT INTO users (net_name, real_name, user_id, password_hash, status) VALUES (?, ?, ?, 'x', 'active')")
  .run('同桌', '同桌', V);
xy.ensureAccount(V);

console.log('\n=== 1. 三种钱分开入账 ===');
xy.ensureAccount(U);
eq('开户赠金进赠送池', xy.viewAccount(U).grant, 10000);
eq('开户时没有充值学元', xy.viewAccount(U).cash, 0);
eq('开户时没有练习金', xy.viewAccount(U).practice, 0);

// 真钱：班管录入 50 元充值
xy.recharge({ user: U, yuan: 50, operator: '263800', requestId: 'wall-rc-1' });
var acc0 = xy.viewAccount(U);
eq('充值 50 元 = 50000 学元', acc0.cash, 50000);
eq('充值不影响赠送池', acc0.grant, 10000);
eq('可花余额 = 充值 + 赠送', acc0.balance, 60000);
eq('练习金仍未发放', acc0.practice, 0);

// 练习金：模拟证券发放 30000 学元（3,000,000 分）
xy.mint({ to: U, amountCent: 3000000, kind: 'reward', pool: xy.POOL.PRACTICE, ref: 'wall:practice:1', app: 'stock', memo: '投资练习金' });
var acc1 = xy.viewAccount(U);
eq('练习金到账 30000', acc1.practice, 30000);
eq('练习金不进可花余额', acc1.balance, 60000);
eq('练习金不改变充值池', acc1.cash, 50000);
eq('练习金不改变赠送池', acc1.grant, 10000);
eq('账面总额 = 三种钱之和', acc1.balance + acc1.practice, 90000);

console.log('\n=== 2. 买入只冻练习金 ===');
// 注意单位：*Cent 参数都是「学元分」，账户余额读出来是「学元」。
var holdCent = 8000;   // 80 学元
xy.hold(U, holdCent, { pool: 'practice' });
var acc2 = xy.viewAccount(U);
eq('冻结全在练习金', acc2.frozen_practice, 80);
eq('赠送池冻结为 0', acc2.frozen_grant, 0);
eq('充值池冻结为 0', acc2.frozen_cash, 0);
eq('可花余额的冻结额不受影响', acc2.frozen, 0);
eq('可花余额仍为 60000', acc2.available, 60000);

console.log('\n=== 3. 结算只扣练习金 ===');
var settled = xy.settleHold({
  user_id: U,
  holdCent: holdCent,
  costCent: 7800,        // 成交 78 学元（含 2 学元手续费）
  feeCent: 200,
  pool: xy.POOL.PRACTICE,
  ref: 'wall:order:1',
  app: 'stock',
  memo: '买入测试股'
});
var afterBuy = xy.viewAccount(U);
eq('练习金少 78 学元', 30000 - afterBuy.practice, 78);
eq('充值池一分未动', afterBuy.cash, 50000);
eq('赠送池一分未动', afterBuy.grant, 10000);
eq('练习金冻结清空', afterBuy.frozen_practice, 0);
eq('成本未动充值来源', settled.spent.cash_cent, 0);
eq('成本未动赠送来源', settled.spent.grant_cent, 0);
eq('成本全记在练习金来源（7800 分）', settled.spent.practice_cent, 7800);

console.log('\n=== 4. 练习金花光后，其他钱再多也买不了 ===');
throws('练习金不足时冻结被拒', function () {
  // 4,000,000 分 = 40000 学元，超过剩余练习金（29922）
  xy.hold(U, 4000000, { pool: 'practice' });
}, /练习金不足/);
var afterFail = xy.viewAccount(U);
eq('失败后练习金不变', afterFail.practice, 29922);
eq('失败后充值池不变', afterFail.cash, 50000);
ok('此时账上还有 5 万真钱 + 1 万赠送', afterFail.cash >= 50000 && afterFail.grant >= 10000,
  { cash: afterFail.cash, grant: afterFail.grant });

console.log('\n=== 5. 卖出回款全部留在练习金 ===');
var beforeSell = xy.viewAccount(U);
// 卖出得 92 学元，其中本金 78、收益 14
xy.creditTrade(U, 9200, {
  principalCent: 7800,
  principalCashCent: 0,
  principalPracticeCent: 7800,
  ref: 'wall:order:1:sell',
  app: 'stock',
  memo: '卖出测试股'
});
var afterSell = xy.viewAccount(U);
eq('本金 + 收益共 92 全部回练习金', afterSell.practice - beforeSell.practice, 92);
eq('练习金回到 30014', afterSell.practice, 30014);
eq('充值池自始至终没变', afterSell.cash, 50000);
eq('赠送池自始至终没变', afterSell.grant, 10000);

console.log('\n=== 6. 练习金流不出证券（这一节是核心）===');
// 关键设计：可花余额 = 充值 + 赠送 = 60000，练习金 30014 单独一列。
// 所以转 60001 学元必须失败 —— 差的正是练习金那一截。
var cashBefore = xy.viewAccount(U).cash;
throws('转账金额超过「充值+赠送」时被拒（练习金凑不上）', function () {
  xy.transfer({ from: U, to: V, amountCent: 6000100, memo: '想把练习金一起转走', ref: 'wall:transfer:1' });
}, /可用学元不足|余额不足/);
var afterBlocked = xy.viewAccount(U);
eq('被拒后练习金一分没少', afterBlocked.practice, 30014);
eq('被拒后充值池一分没少', afterBlocked.cash, cashBefore);
eq('被拒后同桌没收到钱', xy.viewAccount(V).balance, 10000);

// 反向确认：可花余额之内的转账正常，且扣的只会是充值/赠送，练习金不动
xy.transfer({ from: U, to: V, amountCent: 100000, memo: '正常转账 1000 学元', ref: 'wall:transfer:2' });
var afterOk = xy.viewAccount(U);
eq('正常转账后练习金仍不动', afterOk.practice, 30014);
eq('正常转账扣的是充值池', cashBefore - afterOk.cash, 1000);

// 只有练习金、没有充值/赠送的账户，转 1 分钱都转不出去
var W = '263803';
db.prepare("INSERT INTO users (net_name, real_name, user_id, password_hash, status) VALUES (?, ?, ?, 'x', 'active')")
  .run('只有练习金', '只有练习金', W);
xy.ensureAccount(W);
// 把开户赠金花光（转入 U），只留练习金
xy.transfer({ from: W, to: V, amountCent: 1000000, memo: '清空赠送学元', ref: 'wall:clear:w' });
xy.mint({ to: W, amountCent: 2000000, kind: 'reward', pool: xy.POOL.PRACTICE, ref: 'wall:practice:w', app: 'stock', memo: '练习金' });
var wAcc = xy.viewAccount(W);
eq('W 可花余额为 0', wAcc.balance, 0);
eq('W 有 20000 学元练习金', wAcc.practice, 20000);
throws('只有练习金的账户转 1 元也失败', function () {
  xy.transfer({ from: W, to: V, amountCent: 100000, memo: '试试能不能转', ref: 'wall:transfer:3' });
}, /余额不足|可用学元不足/);
eq('失败后练习金仍在', xy.viewAccount(W).practice, 20000);

console.log('\n=== 7. 源码守卫：交易入口必须显式指定练习金池 ===');
var tradingSrc = fs.readFileSync(path.join(REPO, 'market-apps/stock/backend/trading.js'), 'utf8');
ok("买入调用 hold 时带 pool: 'practice'", /xueyuan\.hold\([^)]*\{[^}]*pool:\s*'practice'/.test(tradingSrc));
ok('结算调用 settleHold 时带 POOL.PRACTICE', /xueyuan\.settleHold\(\{[\s\S]{0,400}?pool:\s*xueyuan\.POOL\.PRACTICE/.test(tradingSrc));
ok('卖出传 principalPracticeCent', /principalPracticeCent:/.test(tradingSrc));
ok('不再有 pool: \'grant\' 的交易入口', !/xueyuan\.hold\([^)]*\{[^}]*pool:\s*'grant'/.test(tradingSrc));

console.log('\n=== 8. 账本不变量 ===');
var au = xy.audit();
ok('audit 通过', au.ok === true, { issues: au.issues });
eq('全体账户余额（含练习金）之和为 0',
  db.prepare('SELECT COALESCE(SUM(balance + practice_balance), 0) AS s FROM xy_account').get().s, 0);
ok('练习金全部记在学生侧（系统账户用 balance 记对手方）',
  db.prepare('SELECT COALESCE(SUM(practice_balance), 0) AS s FROM xy_account').get().s > 0);

console.log('\n=== 结果 ===');
console.log('通过 ' + pass + ' / 失败 ' + fail);
try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) {}
process.exit(fail ? 1 : 0);
