// 学元证券（原模拟炒股）端到端验证（隔离实例，绝不碰生产库）
// 用法（在仓库根）："C:\Program Files\nodejs\node.exe" market-apps/stock/test/e2e.cjs
//
// 它会：重建临时库 → 起 9099 实例 → 造 3 个学生 → 用真实行情跑完
// 「开户赠金 → 市价买入 → T+1 拦截 → 挂单冻结 → 撤单解冻 → 管理端发放 → 账本对账」。
//
// 为什么不用现成的数据库：这条链路会真的发钱、真的扣钱，
// 只能在一个从零开始的库上验证，否则「初始 1000 学元」这类断言全是脏的。

var fs = require('fs');
var path = require('path');
var { spawn } = require('child_process');

var REPO = path.resolve(__dirname, '../../..');
var SERVER = path.join(REPO, 'server');
var TMP = path.join(REPO, '.workbuddy/tmp/stock-e2e');
var DB = path.join(TMP, 'e2e.db');
var PORT = 9099;
var BASE = 'http://127.0.0.1:' + PORT;
var SECRET = 'e2e-secret';

var NODE = process.execPath;
var pass = 0;
var fail = 0;
var failures = [];

function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; failures.push(name); console.log('  ✗ ' + name + (extra !== undefined ? ' → ' + JSON.stringify(extra) : '')); }
}
function eq(name, a, b) { ok(name + '（' + JSON.stringify(a) + '）', a === b, { got: a, want: b }); }
function near(name, a, b, tol) {
  var d = Math.abs(Number(a) - Number(b));
  ok(name + '（' + a + ' ≈ ' + b + '）', d <= (tol === undefined ? 0.02 : tol), { got: a, want: b });
}

function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

// ---------- HTTP ----------
function token(userId, isAdmin) {
  var jwt = require(path.join(SERVER, 'node_modules/jsonwebtoken'));
  return jwt.sign(
    { user_id: userId, is_admin: isAdmin ? 1 : 0, is_class_admin: isAdmin ? 1 : 0, role: isAdmin ? 'admin' : 'user' },
    SECRET, { expiresIn: '2h' }
  );
}

async function api(method, p, opts) {
  var o = opts || {};
  var headers = { 'Content-Type': 'application/json' };
  if (o.token) headers.Authorization = 'Bearer ' + o.token;
  var res = await fetch(BASE + p, {
    method: method,
    headers: headers,
    body: o.body ? JSON.stringify(o.body) : undefined
  });
  var text = await res.text();
  var json = null;
  try { json = JSON.parse(text); } catch (e) { json = { raw: text.slice(0, 300) }; }
  return { status: res.status, body: json };
}

// ---------- 进程 ----------
async function waitReady() {
  for (var i = 0; i < 60; i++) {
    try {
      var r = await fetch(BASE + '/api/xueyuan/config');
      if (r.status === 200 || r.status === 401) return true;
    } catch (e) { /* 还没起来 */ }
    await sleep(500);
  }
  return false;
}

async function main() {
  console.log('\n=== 准备隔离环境 ===');
  // 清场：库 + 资源目录
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) {}
  fs.mkdirSync(TMP, { recursive: true });
  console.log('临时目录 ' + TMP);

  var logPath = path.join(TMP, 'server.log');
  var out = fs.openSync(logPath, 'w');
  var child = spawn(NODE, ['src/app.js'], {
    cwd: SERVER,
    stdio: ['ignore', out, out],
    env: Object.assign({}, process.env, {
      PORT: String(PORT),
      WS_PORT: '19001',
      RELAY_PORT: '19011',
      DB_PATH: DB,
      RESOURCES_DIR: path.join(TMP, 'res'),
      JWT_SECRET: SECRET,
      NODE_ENV: 'test',
      RELAY_SERVERS: '',
      TAILSCALE_ENABLED: 'false',
      // 测试通道：周末/夜间跑 e2e 时把撮合时钟强制成交易时段，
      // 保证「即时成交→T+1→成就」这条链路在任何时间都可验证。
      // 价格仍是真实行情（休市时为最近收盘价），只是时段被拨正。
      STOCK_FORCE_TRADABLE: '1'
    })
  });

  var exited = false;
  child.on('exit', function () { exited = true; });

  function cleanup() {
    if (!exited) { try { child.kill(); } catch (e) {} }
  }
  process.on('exit', cleanup);

  console.log('等待服务就绪...');
  var ready = await waitReady();
  if (!ready) {
    console.error('✗ 服务未就绪，日志：' + logPath);
    console.error(fs.readFileSync(logPath, 'utf8').split('\n').slice(-30).join('\n'));
    cleanup();
    process.exit(1);
  }
  console.log('服务已就绪');

  // ---------- 造学生 ----------
  var Database = require(path.join(SERVER, 'node_modules/better-sqlite3'));
  var db = new Database(DB);
  var ins = db.prepare("INSERT OR IGNORE INTO users (net_name, real_name, user_id, password_hash, status, is_admin) VALUES (?, ?, ?, 'x', 'active', ?)");
  ins.run('李雷', '李雷', '251801', 1);   // 班管
  ins.run('韩梅梅', '韩梅梅', '251802', 0);
  ins.run('王小明', '王小明', '251803', 0);
  db.close();

  var T1 = token('251801', true);
  var T2 = token('251802', false);

  console.log('\n=== 学元账户 ===');
  var me = await api('GET', '/api/xueyuan/me', { token: T1 });
  eq('首次访问响应 200', me.status, 200);
  eq('自动开户赠金 1000 学元', me.body.data.account.balance, 1000);
  eq('标记为新账户', me.body.data.is_new, true);
  eq('今日津贴可领', me.body.data.daily.can_claim, true);

  var me2 = await api('GET', '/api/xueyuan/me', { token: T1 });
  eq('再次访问余额不变', me2.body.data.account.balance, 1000);
  eq('不再重复赠金', me2.body.data.welcome_granted, false);

  var daily = await api('POST', '/api/xueyuan/daily', { token: T1, body: {} });
  eq('领取津贴成功', daily.body.data.amount, 10);
  var daily2 = await api('POST', '/api/xueyuan/daily', { token: T1, body: {} });
  eq('重复领取被幂等拦截', daily2.body.data.duplicate, true);
  eq('津贴只加一次', (await api('GET', '/api/xueyuan/me', { token: T1 })).body.data.account.balance, 1010);

  // T2 也开户（转账/排行要用）
  await api('GET', '/api/xueyuan/me', { token: T2 });

  console.log('\n=== 转账 ===');
  var tr = await api('POST', '/api/xueyuan/transfer', { token: T1, body: { to: '251802', amount: 60, memo: '午饭' } });
  eq('转账成功', tr.status, 200);
  eq('转出方余额 950', tr.body.data.account.balance, 950);
  var badTr = await api('POST', '/api/xueyuan/transfer', { token: T2, body: { to: '251802', amount: 5 } });
  eq('给自己转账被拒', badTr.status, 400);

  console.log('\n=== 炒股本金（投资练习金） ===');
  var ov0 = await api('GET', '/api/stock/overview', { token: T1 });
  eq('概览 200', ov0.status, 200);
  eq('首次进入发放投资练习金 9000', ov0.body.data.practice_granted, 9000);
  var ov0b = await api('GET', '/api/stock/overview', { token: T1 });
  eq('再次进入不重复发放', ov0b.body.data.practice_granted, 0);
  ok('可用本金充足（> 9000）', ov0b.body.data.summary.cash.available > 9000, ov0b.body.data.summary.cash.available);

  console.log('\n=== 行情（真实数据） ===');
  var mkt = await api('GET', '/api/stock/market', { token: T1 });
  eq('行情接口 200', mkt.status, 200);
  var list = (mkt.body.data && mkt.body.data.list) || [];
  ok('返回股票池（' + list.length + ' 只）', list.length >= 30, list.length);
  var stale = mkt.body.data.stale;
  console.log('    行情状态：' + (stale ? '离线兜底（' + mkt.body.data.stale_reason + '）' : '实时'));
  var sample = list[0];
  ok('行情含价格与昨收', sample && sample.price > 0 && sample.prev_close > 0, sample && { code: sample.code, price: sample.price });
  ok('行情含涨跌停', sample && sample.limit_up > sample.price * 0.9 && sample.limit_down < sample.price, sample && { up: sample.limit_up, down: sample.limit_down });

  var idx = mkt.body.data.session;
  console.log('    交易时段：' + idx.label + '（可撮合=' + idx.settles + '）');

  var cheap = null;
  for (var i = 0; i < list.length; i++) {
    // 一手 = 100 股；留出一半资金做后续冻结/撤单测试
    if (list[i].price > 3 && list[i].price * 100 < 4000) { cheap = list[i]; break; }
  }
  ok('找到一只适合测试的低价股', !!cheap, cheap && cheap.code + ' ' + cheap.name + ' ' + cheap.price);

  var quote = await api('GET', '/api/stock/quote/' + cheap.code, { token: T1 });
  eq('个股详情 200', quote.status, 200);
  ok('返回最大可买手数', quote.body.data.max_buy >= 100, quote.body.data.max_buy);

  console.log('\n=== 买入 ===');
  var cashBeforeBuy = (await api('GET', '/api/xueyuan/me', { token: T1 })).body.data.account.balance;
  var buy = await api('POST', '/api/stock/order', {
    token: T1,
    body: { code: cheap.code, side: 'buy', type: 'market', qty: 100 }
  });
  eq('下单接口 200', buy.status, 200);
  if (buy.status !== 200) {
    console.log('    下单失败：' + buy.body.message);
    ok('下单失败原因应可读', !!buy.body.message, buy.body);
  }
  var buyData = buy.body.data || {};
  var filledNow = !!(buyData.filled);
  console.log('    委托状态：' + (buyData.order && buyData.order.status_label) + '，' + buy.body.message);
  ok('委托已创建', !!(buyData.order && buyData.order.id > 0), buyData.order);

  if (filledNow) {
    eq('市价单已成交', buyData.order.status, 'filled');
    var tr0 = buyData.filled.trade;
    ok('成交价合理', tr0.price > 0, tr0.price);
    ok('成交数量 100', tr0.qty === 100, tr0.qty);
    ok('买入免印花税', tr0.fee_detail.stamp === 0, tr0.fee_detail);
    ok('佣金不低于 5 元', tr0.fee_detail.commission >= 5, tr0.fee_detail.commission);
    near('成交额 = 价 × 100', tr0.amount, tr0.price * 100, 0.01);

    var posRes = await api('GET', '/api/stock/positions', { token: T1 });
    var pos = (posRes.body.data.positions || []).filter(function (p) { return p.code === cheap.code; })[0];
    ok('持仓已建立', !!pos && pos.qty === 100, pos);
    eq('T+1：当日买入不可卖', pos.available_qty, 0);
    ok('持仓成本 = 成交额 + 费用', Math.abs(pos.cost_cent / 100 - (tr0.amount + tr0.fee)) < 0.02, { cost: pos.cost_cent / 100, expect: tr0.amount + tr0.fee });

    var cashAfter = buyData.summary.cash;
    ok('学元余额已扣减', cashAfter.balance < cashBeforeBuy, cashAfter.balance);
    // 扣减 = 成交额 + 费用 − 成就奖励：市价成交瞬间触发成就检查，
    // 「第一单」(+20 学元) 首笔交易必得、立即入账。
    // （成就系统坏掉时这条等式才恰好成立 —— 2026-11-03 修复成就后暴露）
    var drop = cashBeforeBuy - cashAfter.balance;
    var expectDrop = tr0.amount + tr0.fee;
    ok('扣减额 = 成交额 + 费用 − 首单成就奖励',
      Math.abs(drop - (expectDrop - 20)) < 0.02, { drop: drop, expect: expectDrop });

    console.log('\n=== T+1 拦截 ===');
    var sellNow = await api('POST', '/api/stock/order', {
      token: T1, body: { code: cheap.code, side: 'sell', type: 'market', qty: 100 }
    });
    eq('当日卖出被拒', sellNow.status, 400);
    ok('提示 T+1', /次日|可卖/.test(sellNow.body.message || ''), sellNow.body.message);
  } else {
    ok('非交易时段下单进入排队（不报错）', buyData.order.status === 'pending', buyData.order.status);
  }

  console.log('\n=== 挂单与撤单（冻结 → 解冻） ===');
  var before = (await api('GET', '/api/xueyuan/me', { token: T1 })).body.data.account.available;
  // 挂在跌停价：一定不会成交，用来验证冻结
  var limitPrice = cheap.limit_down;
  var pend = await api('POST', '/api/stock/order', {
    token: T1,
    body: { code: cheap.code, side: 'buy', type: 'limit', price: limitPrice, qty: 100 }
  });
  eq('跌停价挂单成功', pend.status, 200);
  var pOrder = pend.body.data && pend.body.data.order;
  ok('挂单处于待成交', pOrder && pOrder.status === 'pending', pOrder && pOrder.status);

  var afterHold = (await api('GET', '/api/xueyuan/me', { token: T1 })).body.data.account;
  ok('可用学元被冻结', afterHold.available < before, { before: before, after: afterHold.available });
  near('冻结额 = 委托额 + 预估费用', afterHold.frozen, pOrder.hold, 0.02);
  eq('挂单不动总余额', Math.round(afterHold.balance * 100), Math.round(before * 100));

  var cancel = await api('POST', '/api/stock/order/' + pOrder.id + '/cancel', { token: T1, body: {} });
  eq('撤单成功', cancel.status, 200);
  eq('委托状态变为已撤', cancel.body.data.order.status, 'cancelled');
  var afterCancel = (await api('GET', '/api/xueyuan/me', { token: T1 })).body.data.account;
  eq('撤单后冻结归零', afterCancel.frozen, 0);
  near('可用学元恢复', afterCancel.available, before, 0.02);

  console.log('\n=== 挂单越界校验 ===');
  var overLimit = await api('POST', '/api/stock/order', {
    token: T1, body: { code: cheap.code, side: 'buy', type: 'limit', price: cheap.limit_up * 1.2, qty: 100 }
  });
  eq('超涨停价被拒', overLimit.status, 400);
  ok('提示涨停价', /涨停/.test(overLimit.body.message || ''), overLimit.body.message);

  var badLot = await api('POST', '/api/stock/order', {
    token: T1, body: { code: cheap.code, side: 'buy', type: 'limit', price: cheap.price, qty: 150 }
  });
  eq('非整手被拒', badLot.status, 400);

  var outOfPool = await api('POST', '/api/stock/order', {
    token: T1, body: { code: '000000', side: 'buy', type: 'market', qty: 100 }
  });
  eq('池外代码被拒', outOfPool.status, 400);

  console.log('\n=== 时段规则（时间门槛已全部放开）===');
  // 2026-11-03 产品决策：校园平板不常开机，委托不再受时段限制。
  // market.js 是纯函数模块，可直接 require 做时钟无关的断言。
  var mktRules = require(path.join(REPO, 'market-apps/stock/backend/market'));
  var satEarly = Date.UTC(2026, 10, 7, 18, 30);   // 周日凌晨 02:30（北京）
  var weekdayEarly = Date.UTC(2026, 10, 3, 21, 0); // 周二凌晨 05:00（北京）
  ok('周末凌晨允许市价委托', mktRules.canPlaceOrder(satEarly, 'market') === true);
  ok('周末凌晨允许限价委托', mktRules.canPlaceOrder(satEarly, 'limit') === true);
  ok('工作日凌晨允许市价委托', mktRules.canPlaceOrder(weekdayEarly, 'market') === true);
  ok('交易时段允许市价委托', mktRules.canPlaceOrder(Date.UTC(2026, 10, 3, 2, 0), 'market') === true);

  console.log('\n=== 自选 ===');
  var addW = await api('POST', '/api/stock/watch', { token: T1, body: { code: cheap.code } });
  eq('加入自选', addW.status, 200);
  var watch = await api('GET', '/api/stock/watch', { token: T1 });
  ok('自选列表包含该股', watch.body.data.list.some(function (x) { return x.code === cheap.code; }), watch.body.data.list.length);
  var delW = await api('DELETE', '/api/stock/watch/' + cheap.code, { token: T1 });
  eq('移出自选', delW.body.data.removed, true);

  console.log('\n=== 检索 ===');
  var srch = await api('GET', '/api/stock/search?q=' + encodeURIComponent('平安'), { token: T1 });
  eq('搜索接口 200', srch.status, 200);
  ok('按名称命中（平安）', (srch.body.data.list || []).length >= 1,
    srch.body.data && srch.body.data.list ? srch.body.data.list.length : srch.body);
  var srch2 = await api('GET', '/api/stock/search?q=' + cheap.code, { token: T1 });
  ok('按代码命中测试股', (srch2.body.data.list || []).some(function (x) { return x.code === cheap.code; }));

  console.log('\n=== 管理端发放 ===');
  var grant = await api('POST', '/api/xueyuan/admin/grant', {
    token: T1, body: { userIds: ['251803'], amount: 200, memo: '期中奖励', requestId: 'e2e-grant-1' }
  });
  eq('批量发放成功', grant.status, 200);
  eq('发放 1 人', grant.body.data.done.length, 1);
  var again = await api('POST', '/api/xueyuan/admin/grant', {
    token: T1, body: { userIds: ['251803'], amount: 200, memo: '期中奖励', requestId: 'e2e-grant-1' }
  });
  eq('同 requestId 重复发放被幂等', again.body.data.done[0].duplicate, true);
  var t3 = (await api('GET', '/api/xueyuan/me', { token: token('251803', false) })).body.data.account.balance;
  eq('只发了一次（1000+200）', t3, 1200);

  var forbidden = await api('POST', '/api/xueyuan/admin/grant', {
    token: T2, body: { userIds: ['251803'], amount: 1 }
  });
  eq('普通学生不能发放', forbidden.status, 403);

  console.log('\n=== 委托长期有效 + 死单清理 ===');
  // 1) 休市时段限价单也应可下（这里交易时段只能验证「不拒绝」；休市路径由
  //    canPlaceOrder 的单测口径保证：limit 恒真）。直接挂一笔死单，
  //    把它的委托价改成超涨停 —— 模拟「隔夜跳空后价格出了涨跌停」的场景，
  //    撮合器下一轮应该把它作废并解冻，而不是让它永远占着冻结资金。
  var dead = await api('POST', '/api/stock/order', {
    token: T1, body: { code: cheap.code, side: 'buy', type: 'limit', price: cheap.limit_down, qty: 100 }
  });
  eq('挂死单成功', dead.status, 200);
  var deadId = dead.body.data.order.id;
  var frozenDead = (await api('GET', '/api/xueyuan/me', { token: T1 })).body.data.account.frozen;
  ok('死单占用了冻结', frozenDead > 0, frozenDead);

  var dbw = new Database(DB);
  dbw.prepare('UPDATE stock_orders SET price_cent = ? WHERE id = ?')
    .run(Math.round(cheap.limit_up * 100) + 500, deadId);
  dbw.close();
  console.log('    等待撮合器下一轮（3s 周期）...');
  await sleep(6000);
  var dbr = new Database(DB, { readonly: true });
  var deadRow = dbr.prepare('SELECT status, reason FROM stock_orders WHERE id = ?').get(deadId);
  dbr.close();
  eq('死单被自动作废', deadRow.status, 'cancelled');
  ok('作废原因可读', /涨跌停/.test(deadRow.reason || ''), deadRow.reason);
  var frozenAfterDead = (await api('GET', '/api/xueyuan/me', { token: T1 })).body.data.account.frozen;
  eq('死单解冻后冻结归零', frozenAfterDead, 0);

  console.log('\n=== 成就系统 ===');
  // ⚠️ 2026-11-03 前 stock_achievements 表从未被创建，这里必 500 且
  // 后面的 data.list 直接抛 TypeError 中断整个脚本 —— 现在 assert 加固，
  // 表缺失时给出明确失败而不是崩掉。
  var ach = await api('GET', '/api/stock/achievements', { token: T1 });
  eq('成就接口 200', ach.status, 200);
  if (ach.status === 200 && ach.body.data && Array.isArray(ach.body.data.list)) {
    var achList = ach.body.data.list;
    eq('成就共 10 项', achList.length, 10);
    var firstDeal = achList.filter(function (x) { return x.code === 'first_deal'; })[0];
    ok('「第一单」已解锁（前面买过股票）', firstDeal && firstDeal.unlocked, firstDeal);
    var ach2 = await api('GET', '/api/stock/achievements', { token: T2 });
    var t2First = ach2.body.data.list.filter(function (x) { return x.code === 'first_deal'; })[0];
    eq('没交易过的学生未解锁', t2First.unlocked, false);
  } else {
    ok('成就数据结构完整', false, ach.body);
  }
  // 奖励必须真的入账：xy_tx 里应有 stock:ach:<uid>:first_deal 的幂等流水
  var dbAch = new Database(DB, { readonly: true });
  var achRef = dbAch.prepare('SELECT COUNT(*) c FROM xy_tx WHERE ref = ?').get('stock:ach:251801:first_deal').c;
  dbAch.close();
  eq('成就奖励已入账（xy_tx 有幂等流水）', achRef, 1);

  console.log('\n=== 跨班对决 ===');
  var peer0 = await api('GET', '/api/stock/peer', { token: T1 });
  eq('对决接口 200', peer0.status, 200);
  var mySide = peer0.body.data.my;
  ok('本班标识已推导', /^\d{2}$/.test(mySide.class_no || ''), mySide.class_no);
  ok('本班榜单有参与者', mySide.participants >= 1, mySide.participants);
  ok('本班 top 榜结构', Array.isArray(mySide.top) && mySide.top.length >= 1, mySide.top.length);
  eq('尚无对端战报', peer0.body.data.peer, null);

  var noPerm = await api('POST', '/api/stock/peer/settle', { token: T2, body: {} });
  eq('普通学生不能结算', noPerm.status, 403);

  // force=true 跳过「周五 15:05」日期检查（否则周二跑会得到 not-friday），
  // 此时尚无任何对端战报，预期被 no-fresh-peer 拦住 —— 任何一天跑都成立。
  var settle0 = await api('POST', '/api/stock/peer/settle', { token: T1, body: { force: true } });
  ok('无对端数据时结算被拦', settle0.body.data && settle0.body.data.skipped === 'no-fresh-peer', settle0.body.data);

  // 伪造对端战报（模拟 18 班/8 班 relay 推送过来的一份）
  var myClassNo = mySide.class_no === '08' ? '18' : '08';
  var dbw2 = new Database(DB);
  var peerPayload = {
    class_no: myClassNo, generated_at: Date.now(), participants: 2, avg_return: -9,
    top: [
      { net_name: '隔壁班股神', total_asset: 12000, pnl: 2000, return_pct: 20 },
      { net_name: '隔壁班韭菜', total_asset: 8000, pnl: -2000, return_pct: -20 }
    ]
  };
  dbw2.prepare('INSERT OR REPLACE INTO stock_peer_rank (class_no, payload_json, generated_at, received_at) VALUES (?, ?, ?, ?)')
    .run(myClassNo, JSON.stringify(peerPayload), Date.now(), Date.now());
  dbw2.close();

  var peer1 = await api('GET', '/api/stock/peer', { token: T1 });
  ok('对端战报已可见', !!peer1.body.data.peer, peer1.body.data.peer && peer1.body.data.peer.class_no);
  eq('对端数据标记为新鲜', peer1.body.data.peer.fresh, true);

  // 强制结算（跳过周五检查）：本班人均收益率（刚买完股票，约 -0.1%~-9%）vs 对端 -9
  var settle1 = await api('POST', '/api/stock/peer/settle', { token: T1, body: { force: true } });
  eq('强制结算 200', settle1.status, 200);
  var settleData = settle1.body.data;
  ok('结算有明确结果', settleData && (settleData.skipped || settleData.result), settleData);
  ok('对端 payload 被正确解析（不允许再出现 peer-empty）',
    !(settleData && settleData.skipped === 'peer-empty'), settleData);
  if (settleData.result === 'win') {
    ok('获胜后发奖', settleData.rewarded >= 1, settleData.rewarded);
  } else if (settleData.result === 'lose') {
    ok('落败不发奖', settleData.rewarded === 0, settleData.rewarded);
  }
  // 周幂等：再结算一次应 skipped
  var settle2 = await api('POST', '/api/stock/peer/settle', { token: T1, body: { force: true } });
  eq('本周重复结算被幂等', settle2.body.data.skipped, 'already-settled');

  console.log('\n=== 收盘报告 ===');
  var rep = await api('GET', '/api/stock/report', { token: T1 });
  eq('报告接口 200', rep.status, 200);
  // 报告生成看的是真实日历（周一~周五 15:00 后才有当日报告），与测试通道无关
  var now2 = new Date(Date.now() + 8 * 3600 * 1000);
  var wd = now2.getUTCDay();
  var afterCloseNow = wd >= 1 && wd <= 5 && (now2.getUTCHours() > 15 || (now2.getUTCHours() === 15 && now2.getUTCMinutes() >= 0));
  if (afterCloseNow) {
    ok('收盘后有报告数据', !!(rep.body.data.report && rep.body.data.report.payload), rep.body.data.report && rep.body.data.report.date_key);
    if (rep.body.data.report) {
      var rp = rep.body.data.report.payload;
      ok('报告含指数', rp.indexes.length >= 3, rp.indexes.length);
      ok('报告含领涨领跌', rp.gainers.length === 3 && rp.losers.length === 3);
      ok('报告含本班热度', rp.class_activity.trades >= 0);
      ok('报告有主编点评', rp.comment.length >= 10, rp.comment.slice(0, 30));
    }
  } else {
    ok('非收盘时段无当日报告（等收盘生成）', rep.body.data.report === null || rep.body.data.report === undefined,
      'report=' + JSON.stringify(rep.body.data.report).slice(0, 60));
  }

  console.log('\n=== 学元榜 / 排行 ===');
  var lb = await api('GET', '/api/xueyuan/leaderboard', { token: T1 });
  ok('学元榜有数据', lb.body.data.list.length >= 3, lb.body.data.list.length);
  ok('系统账户不在榜上', lb.body.data.list.every(function (x) { return x.user_id.charAt(0) !== '@'; }));
  var rank = await api('GET', '/api/stock/rank', { token: T1 });
  eq('炒股排行 200', rank.status, 200);
  ok('排行含自己', !!rank.body.data.me, rank.body.data.me);
  // 口径守卫：pnl = 总资产 − 净投入，与资产页 total_pnl 严格相等。
  // 旧算法把现金余额整个算进盈亏（≈ +6800），这两条守卫就是它的回归探针。
  var posRes2 = await api('GET', '/api/stock/positions', { token: T1 });
  var totalPnl = posRes2.body.data.totals.total_pnl;
  ok('排行盈亏未被现金余额污染（|pnl| < 2000）', Math.abs(rank.body.data.me.pnl) < 2000, rank.body.data.me);
  ok('排行收益率合理（|ret| < 50%）', Math.abs(rank.body.data.me.return_pct) < 50, rank.body.data.me.return_pct);
  near('排行盈亏与资产页口径一致', rank.body.data.me.pnl, totalPnl, 0.05);

  console.log('\n=== 账本对账 ===');
  var ov = await api('GET', '/api/xueyuan/admin/overview', { token: T1 });
  eq('管理概览 200', ov.status, 200);
  var audit = ov.body.data.audit;
  ok('对账通过（借贷平衡）', audit.ok, audit.issues);
  var sum = ov.body.data.summary;
  ok('流通量 > 0', sum.circulation > 0, sum.circulation);
  ok('账户数 3', sum.accounts === 3, sum.accounts);
  console.log('    流通 ' + sum.circulation + ' 学元，冻结 ' + sum.frozen + '，今日发放 ' + sum.minted_today);

  // 直接查库再确认一次（不信任接口自述）
  var db2 = new Database(DB, { readonly: true });
  var globalSum = db2.prepare('SELECT COALESCE(SUM(balance),0) s FROM xy_account').get().s;
  eq('库内全局余额守恒', globalSum, 0);
  var unbalanced = db2.prepare('SELECT COUNT(*) c FROM (SELECT tx_id FROM xy_entry GROUP BY tx_id HAVING SUM(delta) <> 0)').get().c;
  eq('不存在不平的交易', unbalanced, 0);
  var drift = db2.prepare('SELECT COUNT(*) c FROM (SELECT a.user_id FROM xy_account a LEFT JOIN xy_entry e ON e.user_id=a.user_id GROUP BY a.user_id HAVING a.balance <> COALESCE(SUM(e.delta),0))').get().c;
  eq('账户余额与流水一致', drift, 0);
  var orders = db2.prepare('SELECT COUNT(*) c FROM stock_orders').get().c;
  ok('委托已落库（' + orders + ' 笔）', orders >= 2, orders);
  db2.close();

  console.log('\n=== 结果 ===');
  console.log('通过 ' + pass + ' / 失败 ' + fail);
  if (fail) console.log('失败项：' + failures.join('、'));

  cleanup();
  await sleep(500);
  process.exit(fail ? 1 : 0);
}

main().catch(function (e) {
  console.error('✗ 脚本异常:', e);
  process.exit(1);
});
