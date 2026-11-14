// 学元证券 · 交易基座规则验收（不联网、不起服务）
// 用法（仓库根）：node market-apps/stock/test/engine.cjs
//
// 这里锁的是「一改就会把模拟盘变成游戏」的规则：
//   · 集合竞价只收单不成交；9:25 按开盘价；15:00 后收盘结算
//   · 断网兜底价 / 节假日的昨收价绝不允许成交
//   · 涨跌停比例、手数、佣金/印花税/过户费
// 行情与撮合的联调仍由 e2e.cjs / ui-probe.mjs 覆盖。

var fs = require('fs');
var os = require('os');
var path = require('path');

var REPO = path.resolve(__dirname, '../../..');
var SERVER = path.join(REPO, 'server');
var TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'ci-stock-engine-'));
process.env.DB_PATH = path.join(TMP, 'engine.db');
process.env.NODE_ENV = 'test';
// trading.js 用 cwd 解析宿主的 app-api
process.chdir(SERVER);

var market = require(path.join(REPO, 'market-apps/stock/backend/market'));
var trading = require(path.join(REPO, 'market-apps/stock/backend/trading'));

var pass = 0;
var fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra !== undefined ? ' → ' + JSON.stringify(extra) : '')); }
}
function eq(name, a, b) { ok(name + '（' + JSON.stringify(a) + '）', a === b, { got: a, want: b }); }

// 北京时间 → UTC 毫秒
function bj(y, m, d, hh, mm) {
  return Date.UTC(y, m - 1, d, hh - 8, mm, 0);
}

console.log('\n=== 1. 交易时段与可撮合性 ===');
var day = [2026, 11, 11];   // 周三
function sess(hh, mm) { return market.currentSession(bj(day[0], day[1], day[2], hh, mm)); }
var s1 = sess(9, 20);
eq('9:20 开盘集合竞价', s1.key, 'auction_open');
eq('集合竞价可下单', s1.tradable, true);
eq('集合竞价不可撮合', s1.matchable, false);
var s2 = sess(9, 26);
eq('9:26 开盘前', s2.key, 'pre_open');
eq('9:26 可按开盘价撮合', s2.matchable, true);
eq('9:26 不立即成交', s2.settles, false);
var s3 = sess(10, 0);
eq('10:00 上午连续竞价', s3.key, 'morning');
eq('连续竞价可撮合', s3.matchable, true);
eq('连续竞价立即成交', s3.settles, true);
eq('午休不可撮合', sess(12, 0).matchable, false);
var s4 = sess(14, 58);
eq('14:58 收盘集合竞价', s4.key, 'auction_close');
eq('收盘集合竞价不可撮合', s4.matchable, false);
var s5 = sess(15, 1);
eq('15:01 收盘结算', s5.key, 'close_settle');
eq('收盘结算可撮合', s5.matchable, true);
eq('收盘结算不当作盘中交易', s5.tradable, false);
eq('收盘结算强制刷新行情', s5.force_quote, true);
eq('15:03 已收盘', sess(15, 3).key, 'closed');
eq('周末休市', market.currentSession(bj(2026, 11, 14, 10, 0)).key, 'closed');
eq('15:00 结算截止时间', market.closeCutoffMs(bj(2026, 11, 11, 15, 1)),
  Date.UTC(2026, 10, 11, 7, 0, 0));

console.log('\n=== 2. 行情时间守卫 ===');
var now = bj(2026, 11, 11, 10, 0);
var today = market.dateKey(now);
function q(over) {
  return Object.assign({ price_cent: 1000, quote_date: today }, over || {});
}
eq('今天的行情可成交', trading.quoteAllowsFill(q(), now), true);
eq('断网兜底价不可成交', trading.quoteAllowsFill(q({ stale: true }), now), false);
eq('昨天的行情不可成交', trading.quoteAllowsFill(q({ quote_date: market.dateKey(now - 86400000) }), now), false);
eq('没有时间戳不可成交', trading.quoteAllowsFill(q({ quote_date: '' }), now), false);
eq('价格为 0 不可成交', trading.quoteAllowsFill(q({ price_cent: 0 }), now), false);
process.env.STOCK_FORCE_TRADABLE = '1';
eq('测试通道允许用最近收盘价', trading.quoteAllowsFill(q({ quote_date: '2020-01-01' }), now), true);
delete process.env.STOCK_FORCE_TRADABLE;

console.log('\n=== 3. 休市状态展示 ===');
var staleSess = market.sessionForSnapshot(s3, { stale: true, quote_date: today });
ok('断网时显示行情延迟', /行情延迟/.test(staleSess.label), staleSess.label);
eq('断网时不可交易', staleSess.tradable, false);
var holiday = market.sessionForSnapshot(s3, { stale: false, quote_date: '2026-10-01' });
eq('节假日记为休市', holiday.label, '休市（行情未更新）');
eq('节假日不显示交易中', holiday.tradable, false);
eq('正常行情保留原时段', market.sessionForSnapshot(s3, { stale: false, quote_date: today }).key, 'morning');

console.log('\n=== 4. 费用 ===');
var f1 = market.calcFees('buy', 10000);
eq('100 学元买入佣金触发最低 5 学元', f1.commission_cent, 500);
eq('买入无印花税', f1.stamp_cent, 0);
eq('100 学元买入总费用 5 学元', f1.total_cent, 500);
var f2 = market.calcFees('sell', 1000000);
eq('1 万学元卖出仍触发最低佣金 500', f2.commission_cent, 500);
eq('卖出过户费 10', f2.transfer_cent, 10);
eq('卖出印花税 500', f2.stamp_cent, 500);
eq('卖出总费用 1010', f2.total_cent, 1010);

console.log('\n=== 5. 涨跌停与手数 ===');
eq('主板 ±10%', market.limitPrices('600519', 100).up, 110);
eq('主板跌停', market.limitPrices('600519', 100).down, 90);
eq('创业板 ±20%', market.limitPrices('300750', 100).up, 120);
eq('科创板 ±20%', market.limitPrices('688981', 100).down, 80);
eq('北交所 ±30%', market.limitPrices('830799', 100).up, 130);
eq('ST ±5%', market.limitPrices('600519', 100, true).up, 105);
eq('一手 100 股', market.LOT_SIZE, 100);
eq('10 元股票 1000 学元买不起一手（含 5 元佣金）', market.maxBuyQty(100000, 10), 0);
eq('1005.01 学元刚好买一手（含过户费 1）', market.maxBuyQty(100501, 10), 100);

console.log('\n=== 6. 代码与价格规范化 ===');
eq('sh600519 → 600519', market.normalizeCode('sh600519'), '600519');
eq('1.600519 → 600519', market.normalizeCode('1.600519'), '600519');
eq('非法代码', market.normalizeCode('abc'), null);
eq('价格四舍五入到分', market.roundPrice(12.345), 12.35);

console.log('\n=== 7. 撮合时段闸门 ===');
var store = require(path.join(REPO, 'market-apps/stock/backend/store'));
store.ensureSchema();
var sdb = store.db();
var created = bj(2026, 11, 11, 14, 50);
var info = sdb.prepare([
  'INSERT INTO stock_orders (user_id, code, name, side, order_type, price_cent, qty,',
  '  status, hold_cent, trade_date, created_at, updated_at)',
  "VALUES ('probe', '600519', '贵州茅台', 'buy', 'limit', 1000, 100,",
  "  'pending', 0, '2026-11-11', ?, ?)"
].join('\n')).run(created, created);
var orderId = Number(info.lastInsertRowid);
var quote = {
  code: '600519', name: '贵州茅台', price: 10, price_cent: 1000,
  prev_close: 10, prev_close_cent: 1000, limit_up: 11, limit_down: 9,
  quote_date: today, stale: false
};
var snap = { byCode: { '600519': quote } };
eq('开盘集合竞价不成交', trading.matchOnce(snap, bj(2026, 11, 11, 9, 20)).filled, 0);
eq('订单仍待成交', sdb.prepare('SELECT status FROM stock_orders WHERE id = ?').get(orderId).status, 'pending');
eq('收盘集合竞价不成交', trading.matchOnce(snap, bj(2026, 11, 11, 14, 58)).filled, 0);
sdb.prepare('UPDATE stock_orders SET created_at = ? WHERE id = ?')
  .run(bj(2026, 11, 11, 15, 1), orderId);
eq('15:01 不结算 15:00 后新挂的单', trading.matchOnce(snap, bj(2026, 11, 11, 15, 1)).filled, 0);
sdb.prepare('UPDATE stock_orders SET created_at = ? WHERE id = ?').run(created, orderId);
eq('断网兜底价不参与收盘结算',
  trading.matchOnce({ byCode: { '600519': Object.assign({}, quote, { stale: true }) } },
    bj(2026, 11, 11, 15, 1)).filled, 0);
eq('15:03 已结束撮合', trading.matchOnce(snap, bj(2026, 11, 11, 15, 3)).filled, 0);
eq('测试订单始终未被错误成交',
  sdb.prepare('SELECT status FROM stock_orders WHERE id = ?').get(orderId).status, 'pending');
// 收尾：清掉这个用于验闸门的单，避免后面撮合到它时去碰账本（本单没有冻结）
sdb.prepare("UPDATE stock_orders SET status = 'cancelled' WHERE id = ?").run(orderId);

console.log('\n=== 8. 当日有效委托的到期时间 ===');
eq('周三盘中 → 周三 15:02',
  market.nextCloseMs(bj(2026, 11, 11, 10, 0)), bj(2026, 11, 11, 15, 2));
eq('周三 15:01 → 周四 15:02',
  market.nextCloseMs(bj(2026, 11, 11, 15, 1)), bj(2026, 11, 12, 15, 2));
eq('周五收盘后 → 下周一 15:02',
  market.nextCloseMs(bj(2026, 11, 13, 15, 1)), bj(2026, 11, 16, 15, 2));
eq('周六 → 下周一 15:02',
  market.nextCloseMs(bj(2026, 11, 14, 10, 0)), bj(2026, 11, 16, 15, 2));

console.log('\n=== 9. 当日单到期自动撤销 ===');
var expiredAt = bj(2026, 11, 11, 9, 0);
var dayInfo = sdb.prepare([
  'INSERT INTO stock_orders (user_id, code, name, side, order_type, price_cent, qty,',
  '  status, hold_cent, trade_date, validity, expires_at, created_at, updated_at)',
  "VALUES ('probe', '600519', '贵州茅台', 'sell', 'limit', 1000, 100,",
  "  'pending', 0, '2026-11-11', 'day', ?, ?, ?)"
].join('\n')).run(expiredAt, created, created);
var dayId = Number(dayInfo.lastInsertRowid);
var expiryRun = trading.matchOnce(snap, bj(2026, 11, 11, 10, 0));
eq('到期单被清算', expiryRun.expired, 1);
eq('到期单状态 expired', sdb.prepare('SELECT status FROM stock_orders WHERE id = ?').get(dayId).status, 'expired');

console.log('\n=== 10. 条件单触发与撤单 ===');
var condAt = bj(2026, 11, 11, 9, 0);
var condInfo = sdb.prepare([
  'INSERT INTO stock_orders (user_id, code, name, side, order_type, price_cent, qty,',
  '  status, frozen_qty, trade_date, trigger_type, trigger_cent, created_at, updated_at)',
  "VALUES ('probe', '600519', '贵州茅台', 'sell', 'condition', 1000, 100,",
  "  'armed', 100, '2026-11-11', 'stop_loss', 1000, ?, ?)"
].join('\n')).run(condAt, condAt);
var condId = Number(condInfo.lastInsertRowid);
eq('条件单占用可卖股数', trading.frozenSellQty('probe', '600519'), 100);
var downQuote = Object.assign({}, quote, { price: 9, price_cent: 900, limit_down: 9 });
var condRun = trading.matchOnce({ byCode: { '600519': downQuote } }, bj(2026, 11, 11, 10, 0));
eq('止损触发后转成卖单', sdb.prepare('SELECT status FROM stock_orders WHERE id = ?').get(condId).status, 'pending');
eq('条件单记录触发时间', !!sdb.prepare('SELECT triggered_at FROM stock_orders WHERE id = ?').get(condId).triggered_at, true);
eq('跌停卖不出，订单继续排队', condRun.filled, 0);
var cancelRun = trading.cancelAll('probe');
ok('一键撤单能撤掉剩余委托', cancelRun.cancelled >= 1, cancelRun.cancelled);
eq('撤单后不再占用可卖股数', trading.frozenSellQty('probe', '600519'), 0);

console.log('\n=== 11. 移动止损跟踪峰值 ===');
var trailAt = bj(2026, 11, 11, 9, 0);
var trailInfo = sdb.prepare([
  'INSERT INTO stock_orders (user_id, code, name, side, order_type, price_cent, qty,',
  '  status, frozen_qty, trade_date, trigger_type, trigger_cent, trail_percent, peak_cent,',
  '  created_at, updated_at)',
  "VALUES ('probe', '600519', '贵州茅台', 'sell', 'condition', 950, 100,",
  "  'armed', 100, '2026-11-11', 'trailing_stop', 950, 5, 1000, ?, ?)"
].join('\n')).run(trailAt, trailAt);
var trailId = Number(trailInfo.lastInsertRowid);
var upQuote = Object.assign({}, quote, { price: 10.4, price_cent: 1040, limit_up: 11, limit_down: 9 });
var noHit = trading.matchOnce({ byCode: { '600519': upQuote } }, bj(2026, 11, 11, 10, 0));
eq('创新高但不回撤不触发', noHit.filled, 0);
var trailRow = sdb.prepare('SELECT * FROM stock_orders WHERE id = ?').get(trailId);
eq('峰值更新到 1040', trailRow.peak_cent, 1040);
eq('触发线抬到 988', trailRow.trigger_cent, 988);
eq('仍在等待触发', trailRow.status, 'armed');
var downQuote2 = Object.assign({}, quote, { price: 9.8, price_cent: 980, limit_up: 11, limit_down: 9.8 });
trading.matchOnce({ byCode: { '600519': downQuote2 } }, bj(2026, 11, 11, 10, 3));
trailRow = sdb.prepare('SELECT * FROM stock_orders WHERE id = ?').get(trailId);
eq('回撤到位转成卖单', trailRow.status, 'pending');
eq('触发时间已记录', !!trailRow.triggered_at, true);
trading.cancelAll('probe');

console.log('\n=== 12. 到价提醒 ===');
var alerts = require(path.join(REPO, 'market-apps/stock/backend/alerts'));
var notify = require(path.join(REPO, 'market-apps/stock/backend/notify'));
var alertUser = 'probe-alert';
var upAlert = alerts.create(alertUser, { code: '600519', direction: 'above', target_price: 10 });
eq('涨到提醒已创建', upAlert.status, 'active');
var staleSnap = { byCode: { '600519': Object.assign({}, quote, { price_cent: 1200, price: 12 }) }, stale: true, quote_date: today };
eq('断网行情不触发提醒', alerts.check(staleSnap, bj(2026, 11, 11, 10, 0)), 0);
var liveSnap = { byCode: { '600519': Object.assign({}, quote, { price_cent: 1050, price: 10.5 }) }, stale: false, quote_date: today };
eq('涨到目标价触发 1 条', alerts.check(liveSnap, bj(2026, 11, 11, 10, 0)), 1);
eq('提醒状态 triggered', alerts.list(alertUser)[0].status, 'triggered');
ok('站内铃铛收到提醒', notify.list(alertUser, 10).list.some(function (n) { return n.kind === 'alert'; }), notify.list(alertUser, 10).list.length);
var downAlert = alerts.create(alertUser, { code: '600519', direction: 'below', target_price: 9 });
var downSnap = { byCode: { '600519': Object.assign({}, quote, { price_cent: 880, price: 8.8 }) }, stale: false, quote_date: today };
eq('跌到目标价触发', alerts.check(downSnap, bj(2026, 11, 11, 10, 5)), 1);
var toCancel = alerts.create(alertUser, { code: '600519', direction: 'above', target_price: 20 });
eq('提醒可取消', alerts.cancel(alertUser, toCancel.id).status, 'cancelled');

console.log('\n=== 结果 ===');
console.log('通过 ' + pass + ' / 失败 ' + fail);
try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* 忽略 */ }
process.exit(fail ? 1 : 0);
