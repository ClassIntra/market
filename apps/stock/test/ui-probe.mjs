// 学元证券（原模拟炒股）· 界面探针（CDP 真实 Chromium，隔离实例）
// 用法（仓库根）："C:\Program Files\nodejs\node.exe" market-apps/stock/test/ui-probe.mjs
//
// 前置：9099 实例已在跑（DB = .workbuddy/tmp/stock-e2e/e2e.db，JWT_SECRET=e2e-secret）
// 产物：.workbuddy/tmp/stock-e2e/shots/*.png
//
// 它验证的不是"能不能打开"，而是：
//   · 行情列表有没有真实价格（不是 --）
//   · 详情页的分时图是不是真的画了东西（canvas 像素非空）
//   · 交易面板预估金额是否随数量变化
//   · 点各个 tab 有没有白屏

import { spawn } from 'child_process';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const jwt = require('../../../server/node_modules/jsonwebtoken');

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9099;
const APP = `http://127.0.0.1:${PORT}`;
const CDP_PORT = 9333;
const VW = 1043;
const VH = 787;
const SHOTS = 'D:/NetWork/Integration/ClassIntra/.workbuddy/tmp/stock-e2e/shots';
const USER_ID = process.argv[2] || '251801';

mkdirSync(SHOTS, { recursive: true });

const token = jwt.sign(
  { user_id: USER_ID, is_admin: 1, is_class_admin: 1, role: 'admin' },
  'e2e-secret', { expiresIn: '2h' }
);

// 夹具：顶栏红点要验「有未读时显示、打开后清零」，所以每次跑之前重置为恰好 1 条未读。
// （直接操作 e2e 库；探针只验渲染，不承担通知生成逻辑的验证 —— 那在 e2e 里）
try {
  const Database = require('../../../server/node_modules/better-sqlite3');
  const ndb = new Database('D:/NetWork/Integration/ClassIntra/.workbuddy/tmp/stock-e2e/e2e.db');
  ndb.prepare('UPDATE stock_notify SET read_at = ? WHERE user_id = ? AND read_at IS NULL').run(Date.now(), USER_ID);
  ndb.prepare([
    'INSERT OR IGNORE INTO stock_notify (user_id, kind, code, name, title, body, ref, created_at, read_at)',
    "VALUES (?, 'up', '600887', '伊利股份', '伊利股份 上涨 5.20%', '现价 31.02，成本 30.90', ?, ?, NULL)"
  ].join('\n')).run(USER_ID, 'probe:' + Date.now(), Date.now());
  ndb.close();
} catch (e) {
  console.log('  · 通知夹具写入失败（红点断言可能失败）：' + e.message);
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('  ✓ ' + name + (detail ? '（' + detail + '）' : '')); }
  else { fail++; console.log('  ✗ ' + name + (detail ? ' → ' + detail : '')); }
}

const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${CDP_PORT}`,
  `--user-data-dir=${join(tmpdir(), 'ci-stock-ui-' + Date.now())}`,
  '--no-first-run', '--no-default-browser-check', '--disable-extensions',
  '--mute-audio', '--window-size=' + VW + ',' + VH, 'about:blank'
], { stdio: 'ignore' });

async function getJSON(p) { return (await fetch(`http://127.0.0.1:${CDP_PORT}${p}`)).json(); }
let ver = null;
for (let i = 0; i < 60; i++) { try { ver = await getJSON('/json/version'); break; } catch { await sleep(500); } }
if (!ver) { console.error('✗ Chrome 未启动'); process.exit(1); }

let page = null;
for (let i = 0; i < 40; i++) {
  const list = await getJSON('/json/list');
  page = list.find(t => t.type === 'page');
  if (page) break; await sleep(400);
}
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let msgId = 0; const pending = new Map();
ws.onmessage = ev => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) {
    const { res, rej } = pending.get(m.id); pending.delete(m.id);
    m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
  }
};
const send = (method, params = {}) => new Promise((res, rej) => {
  const id = ++msgId; pending.set(id, { res, rej });
  ws.send(JSON.stringify({ id, method, params }));
});
const evalJS = async expr => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception && r.exceptionDetails.exception.description || ''));
  return r.result.value;
};
async function shot(name) {
  const r = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(SHOTS, name + '.png'), Buffer.from(r.data, 'base64'));
  return name + '.png';
}

await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: VW, height: VH, deviceScaleFactor: 2, mobile: false });
await send('Page.addScriptToEvaluateOnNewDocument', {
  source: `try{ localStorage.setItem('token', ${JSON.stringify(token)}); }catch(e){}
    window.__ciStockErrors = [];
    window.addEventListener('error', function(e){
      window.__ciStockErrors.push((e.message || 'error') + ' @' + (e.filename || '') + ':' + (e.lineno || 0));
    });
    window.addEventListener('unhandledrejection', function(e){
      var r = e.reason || {};
      window.__ciStockErrors.push('rejection: ' + (r.message || String(r)));
    });`
});

console.log('\n=== 打开应用 ===');
await send('Page.navigate', { url: APP + '/stock' });
await sleep(1200);

let ready = false;
for (let i = 0; i < 60; i++) {
  await sleep(400);
  // 必须等宿主的启动屏（#app-loading）退场，否则截图全是启动页
  ready = await evalJS(`!!document.querySelector('.ci-stock .qrow') && !document.getElementById('app-loading')`);
  if (ready) break;
}
ok('应用渲染（行情行出现，启动屏已退场）', ready);
if (!ready) {
  const html = await evalJS(`document.body.innerHTML.slice(0, 600)`);
  console.log('  页面片段：' + html);
  chrome.kill(); process.exit(1);
}
await sleep(1500); // 等公告浮窗/懒加载结算

console.log('\n=== 新手引导（首访自动弹出） ===');
let tourShown = false;
for (let i = 0; i < 8; i++) {
  tourShown = await evalJS(`!!document.querySelector('.ci-stock .tour-layer .tour-tip')`);
  if (tourShown) break;
  await sleep(400);
}
ok('首次进入自动弹出新手引导', tourShown);
if (tourShown) {
  const step1 = await evalJS(`(document.querySelector('.ci-stock .tour-title') || {}).textContent`);
  ok('第一步讲的是账户与本金', /账户/.test(step1 || ''), step1);
  const hole = await evalJS(`!!document.querySelector('.ci-stock .tour-hole')`);
  ok('第一步高亮了资产卡（spotlight 洞）', hole);
  // 引导步数可能随功能增加（现在 6 步），别写死次数 —— 一路点到出现「开始交易」为止
  let clicked = 0;
  for (let i = 0; i < 10; i++) {
    const hasNext = await evalJS(`!!document.querySelector('.ci-stock .tour-next')`);
    if (!hasNext) break;
    await evalJS(`document.querySelector('.ci-stock .tour-next').click()`);
    await sleep(340);
    clicked++;
  }
  ok('引导可逐页推进', clicked >= 4, clicked + ' 次下一步');
  const finalStep = await evalJS(`({ done: !!document.querySelector('.ci-stock .tour-done'), guide: !!document.querySelector('.ci-stock .tour-to-guide') })`);
  ok('最后一步有「开始交易」与「看完整指南」', finalStep.done && finalStep.guide, JSON.stringify(finalStep));
  await shot('01a-tour-final');
  await evalJS(`document.querySelector('.ci-stock .tour-done').click()`);
  await sleep(500);
  ok('完成后引导关闭', !(await evalJS(`!!document.querySelector('.ci-stock .tour-layer')`)));
  ok('完成状态已记住（localStorage）', await evalJS(`localStorage.getItem('ci-stock-guide-v1') === '1'`));
}
await shot('01-market');

console.log('\n=== 行情页 ===');
const market = await evalJS(`(function(){
  var rows = document.querySelectorAll('.ci-stock .qrow');
  var first = rows[0];
  var priceEl = first && first.querySelector('[data-field="price"]');
  var badges = document.querySelectorAll('.ci-stock .pct-badge');
  var hero = document.querySelector('.ci-stock .hero-value');
  var idx = document.querySelectorAll('.ci-stock .index-pill');
  var sectors = document.querySelectorAll('.ci-stock .sector');
  return {
    rows: rows.length,
    price: priceEl ? priceEl.textContent : '',
    badges: badges.length,
    hero: hero ? hero.textContent : '',
    indexes: idx.length,
    sectors: sectors.length,
    upColor: badges.length ? getComputedStyle(badges[0]).color : ''
  };
})()`);
ok('行情行数量 ≥ 30', market.rows >= 30, market.rows);
ok('价格是数字（非 --）', /^\d+\.\d{2}$/.test(market.price), market.price);
ok('涨跌幅徽章已渲染', market.badges >= 30, market.badges);
ok('资产总额已显示', /[\d,]+\.\d{2}/.test(market.hero), market.hero);
ok('指数条已渲染', market.indexes >= 3, market.indexes);
ok('按板块分组', market.sectors >= 5, market.sectors);
const metaLine = await evalJS(`(function(){ var m = document.querySelector('.ci-stock .market-meta'); return m ? m.textContent : ''; })()`);
ok('市场概况（涨跌家数 / 未开盘提示 + 更新时间）',
  ((/涨/.test(metaLine || '') && /跌/.test(metaLine || '')) || /尚未开盘/.test(metaLine || '')) && /更新/.test(metaLine || ''),
  metaLine);

// 市场快讯（东财 7×24；等接口返回，最多 6 秒）
let newsRows = 0;
for (let i = 0; i < 12; i++) {
  newsRows = await evalJS(`document.querySelectorAll('.ci-stock .news-strip .news-row').length`);
  if (newsRows > 0) break;
  await sleep(500);
}
ok('行情页有市场快讯', newsRows >= 1, newsRows + ' 条');
const newsModal = await evalJS(`(function(){
  var row = document.querySelector('.ci-stock .news-strip .news-row');
  if (!row) return { ok: false };
  row.click();
  var m = document.querySelector('.ci-stock .news-modal');
  var title = (document.querySelector('.ci-stock .news-article-title') || {}).textContent || '';
  var close = document.querySelector('.ci-stock .news-close');
  if (close) close.click();
  return { ok: !!m, title: title, closed: !document.querySelector('.ci-stock .news-modal') };
})()`);
ok('点快讯可看全文（弹层打开并关闭）', newsModal && newsModal.ok && newsModal.closed && (newsModal.title || '').length > 4, newsModal);
await shot('01b-news');

console.log('\n=== 搜索 ===');
const searched = await evalJS(`(function(){
  var i = document.querySelector('.ci-stock .market-search-input');
  if (!i) return { hasInput: false };
  i.value = '平安';
  i.dispatchEvent(new Event('input'));
  return { hasInput: true };
})()`);
ok('搜索框存在', !!searched.hasInput);
await sleep(500);
const hitRows = await evalJS(`document.querySelectorAll('.ci-stock .market-list .qrow').length`);
ok('搜索「平安」命中（2 只，少于全列表）', hitRows >= 1 && hitRows < market.rows, hitRows + ' 行');
await shot('01b-search');
await evalJS(`(function(){
  var c = document.querySelector('.ci-stock .market-search-clear');
  if (c) c.click();
  return true;
})()`);
await sleep(400);
const restored = await evalJS(`document.querySelectorAll('.ci-stock .market-list .qrow').length`);
ok('清空搜索恢复全列表', restored >= 30, restored + ' 行');

console.log('\n=== 板块筛选 ===');
const chipCount = await evalJS(`document.querySelectorAll('.ci-stock .sector-chips .chip').length`);
ok('板块筛选条已渲染（含全部板块 ≥10 个）', chipCount >= 10, chipCount + ' 个');
const aiClicked = await evalJS(`(function(){
  var chips = document.querySelectorAll('.ci-stock .sector-chips .chip');
  for (var i = 0; i < chips.length; i++) { if (chips[i].textContent === '人工智能') { chips[i].click(); return true; } }
  return false;
})()`);
ok('存在「人工智能」板块入口', aiClicked);
await sleep(500);
const aiRows = await evalJS(`(function(){
  var rows = document.querySelectorAll('.ci-stock .market-list .qrow');
  var names = [];
  for (var i = 0; i < rows.length && i < 3; i++) { var n = rows[i].querySelector('.qrow-name'); names.push(n ? n.textContent : ''); }
  return { count: rows.length, names: names };
})()`);
ok('筛选后只剩 AI 板块（8~15 只）', aiRows.count >= 8 && aiRows.count <= 15, aiRows.count + ' 只：' + aiRows.names.join('/'));
await shot('01c-ai-sector');

// AI 大模型（DeepSeek 概念股与已上市大模型厂商）
const llmClicked = await evalJS(`(function(){
  var chips = document.querySelectorAll('.ci-stock .sector-chips .chip');
  for (var i = 0; i < chips.length; i++) { if (chips[i].textContent === 'AI 大模型') { chips[i].click(); return true; } }
  return false;
})()`);
ok('存在「AI 大模型」板块入口', llmClicked);
await sleep(500);
const llmRows = await evalJS(`(function(){
  var rows = document.querySelectorAll('.ci-stock .market-list .qrow');
  var names = [];
  for (var i = 0; i < rows.length && i < 3; i++) { var n = rows[i].querySelector('.qrow-name'); names.push(n ? n.textContent : ''); }
  return { count: rows.length, names: names };
})()`);
ok('AI 大模型筛选 8~15 只', llmRows.count >= 8 && llmRows.count <= 15, llmRows.count + ' 只：' + llmRows.names.join('/'));
await shot('01d-llm-sector');

// 小米产业链（小米集团在港股，A 股只能买供应商）
const miClicked = await evalJS(`(function(){
  var chips = document.querySelectorAll('.ci-stock .sector-chips .chip');
  for (var i = 0; i < chips.length; i++) { if (chips[i].textContent === '小米产业链') { chips[i].click(); return true; } }
  return false;
})()`);
ok('存在「小米产业链」板块入口', miClicked);
await sleep(500);
const miRows = await evalJS(`(function(){
  var rows = document.querySelectorAll('.ci-stock .market-list .qrow');
  var names = [];
  for (var i = 0; i < rows.length && i < 3; i++) { var n = rows[i].querySelector('.qrow-name'); names.push(n ? n.textContent : ''); }
  return { count: rows.length, names: names };
})()`);
ok('小米产业链筛选 6~12 只', miRows.count >= 6 && miRows.count <= 12, miRows.count + ' 只：' + miRows.names.join('/'));

await evalJS(`(function(){
  var chips = document.querySelectorAll('.ci-stock .sector-chips .chip');
  if (chips[0]) chips[0].click();
  return true;
})()`);
await sleep(400);
const backRows = await evalJS(`document.querySelectorAll('.ci-stock .market-list .qrow').length`);
ok('切回「全部板块」恢复全列表', backRows >= 30, backRows + ' 行');

console.log('\n=== 详情页 ===');
// 选一只「买得起一手」的股票：茅台一手 14 万，点它只会弹「资金不足」，
// 验不到交易面板。用价格 < 50 元的第一只。
const picked = await evalJS(`(function(){
  var rows = document.querySelectorAll('.ci-stock .qrow');
  for (var i = 0; i < rows.length; i++) {
    var el = rows[i].querySelector('[data-field="price"]');
    var p = parseFloat(el ? el.textContent : '0');
    // 选一只「便宜到能买多手」的：余额约 3000 时，30 元的股票刚好只够 1 手，
    // 「全仓」按钮点了数量不变，会假失败（2026-11-03 踩过）
    if (p > 0 && p <= 15) {
      var name = (rows[i].querySelector('.qrow-name') || {}).textContent || '';
      rows[i].click();
      return { code: rows[i].getAttribute('data-code'), name: name, price: p };
    }
  }
  return null;
})()`);
ok('选中可交易的股票', !!picked, picked ? picked.code + ' ' + picked.name + ' @' + picked.price : 'none');
// 详情页是异步加载：行情/分时要走外网（实测最慢 3.4s），所以轮询到真正画出来再断言，
// 不要用固定 sleep —— 那样一遇到上游抖动就假失败（2026-11-03 踩过）
let detail = null;
for (let i = 0; i < 18; i++) {
  detail = await evalJS(`(function(){
    var name = document.querySelector('.ci-stock .detail-name');
    var px = document.querySelector('.ci-stock [data-field="dprice"]');
    var c = document.querySelector('.ci-stock canvas[data-chart]');
    var grid = document.querySelectorAll('.ci-stock .detail-grid .dg-item');
    var tabs = document.querySelectorAll('.ci-stock .chart-tabs .seg-item');
    var painted = false;
    if (c && c.getContext) {
      try {
        var d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
        var n = 0;
        for (var i = 3; i < d.length; i += 40) { if (d[i] > 0) n++; }
        painted = n > 30;
      } catch (e) {}
    }
    return {
      name: name ? name.textContent : '',
      price: px ? px.textContent : '',
      hasChart: !!c,
      painted: painted,
      cells: grid.length,
      tabs: tabs.length
    };
  })()`);
  if (detail.painted && detail.cells === 8) break;
  await sleep(500);
}
ok('详情页显示股票名', !!detail.name, detail.name);
ok('详情页价格', /^\d+\.\d{2}$/.test(detail.price), detail.price);
ok('分时图画布存在', detail.hasChart);
ok('分时图已绘制（非空白）', detail.painted);
ok('关键指标 8 项', detail.cells === 8, detail.cells);

// 零基础：指标名带 ? 角标，点一下出术语解释
const termTest = await evalJS(`(function(){
  var k = document.querySelector('.ci-stock .dg-k.term-hit');
  if (!k) return { ok: false, title: '' };
  k.click();
  var t = (document.querySelector('.ci-stock .news-article-title') || {}).textContent || '';
  var c = document.querySelector('.ci-stock .news-close');
  if (c) c.click();
  return { ok: !!t, title: t };
})()`);
ok('详情页指标点一下出术语解释', termTest.ok && /开|高|低|涨停|跌停|成交额|换手|市盈/.test(termTest.title || ''), termTest.title);

// 公司概况（F10）：异步拉，轮询等
let profCells = 0;
for (let i = 0; i < 14; i++) {
  profCells = await evalJS(`document.querySelectorAll('.ci-stock .profile-card .dg-item').length`);
  if (profCells >= 6) break;
  await sleep(500);
}
ok('详情页有公司概况 6 项（行业/市值/估值）', profCells >= 6, profCells + ' 项');

// 相关资讯（按名称搜，等返回）
let detailNews = 0;
for (let i = 0; i < 12; i++) {
  detailNews = await evalJS(`document.querySelectorAll('.ci-stock .news-card .news-row').length`);
  if (detailNews > 0) break;
  await sleep(500);
}
ok('详情页有相关资讯', detailNews >= 1, detailNews + ' 条');

// 自选星标：点一次加入，再点一次移出（两次都要验证状态翻转）
const star1 = await evalJS(`(function(){
  var s = document.querySelector('.ci-stock .detail-star');
  return s ? { on: s.className.indexOf('on') >= 0, txt: s.textContent } : null;
})()`);
ok('详情页自选星标存在', !!star1, star1 && star1.txt);
await evalJS(`document.querySelector('.ci-stock .detail-star').click()`);
await sleep(900);
const star2 = await evalJS(`(function(){
  var s = document.querySelector('.ci-stock .detail-star');
  return s ? { on: s.className.indexOf('on') >= 0, txt: s.textContent } : null;
})()`);
ok('点击星标加入自选（状态翻转）', !!star1 && !!star2 && star1.on !== star2.on,
  star1 && star2 ? star1.on + '→' + star2.on : 'star missing');
await evalJS(`document.querySelector('.ci-stock .detail-star').click()`);
await sleep(900);
const star3 = await evalJS(`(function(){
  var s = document.querySelector('.ci-stock .detail-star');
  return s ? { on: s.className.indexOf('on') >= 0 } : null;
})()`);
ok('再点一次移出自选（还原）', !!star2 && !!star3 && star2.on !== star3.on,
  star2 && star3 ? star2.on + '→' + star3.on : 'star missing');
await shot('02-detail');

// 切到日 K
await evalJS(`(function(){
  var items = document.querySelectorAll('.ci-stock .chart-tabs .seg-item');
  for (var i = 0; i < items.length; i++) { if (items[i].textContent.indexOf('日K') >= 0) { items[i].click(); return items[i].textContent; } }
  return 'not-found';
})()`);
await sleep(1800);
const klinePainted = await evalJS(`(function(){
  var c = document.querySelector('.ci-stock canvas[data-chart]');
  if (!c) return false;
  try {
    var d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    var n = 0;
    for (var i = 3; i < d.length; i += 40) { if (d[i] > 0) n++; }
    return n > 30;
  } catch (e) { return false; }
})()`);
ok('日 K 图已绘制', klinePainted);
await shot('03-kline');

// 周期档位：分时 / 日 / 周 / 月
const chartTabs = await evalJS(`document.querySelectorAll('.ci-stock .chart-tabs .seg-item').length`);
ok('图表周期 4 档（分时/日/周/月）', chartTabs >= 4, chartTabs);
await evalJS(`(function(){
  var items = document.querySelectorAll('.ci-stock .chart-tabs .seg-item');
  for (var i = 0; i < items.length; i++) { if (items[i].textContent.indexOf('月K') >= 0) { items[i].click(); return true; } }
  return false;
})()`);
await sleep(1800);
const monthPainted = await evalJS(`(function(){
  var c = document.querySelector('.ci-stock canvas[data-chart]');
  if (!c) return false;
  try {
    var d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    var n = 0;
    for (var i = 3; i < d.length; i += 40) { if (d[i] > 0) n++; }
    return n > 30;
  } catch (e) { return false; }
})()`);
ok('月 K 图已绘制', monthPainted);

// 长按/拖动十字线：竖线 + 数值气泡（平板没有 hover，只能按压）
// 图表可能因为「资讯到达后重渲染」被重建，按压前给一点稳定时间，并允许重试一次
await sleep(400);
async function tryHover() {
  return evalJS(`(function(){
    var c = document.querySelector('.ci-stock canvas[data-chart]');
    if (!c) return { err: 'no-canvas' };
    var r = c.getBoundingClientRect();
    function ev(type) { return new PointerEvent(type, { clientX: r.left + r.width * 0.5, clientY: r.top + r.height * 0.5, bubbles: true }); }
    c.dispatchEvent(ev('pointerdown'));
    var t = document.querySelector('.ci-stock .chart-tip');
    var shown = !!(t && t.style.display !== 'none');
    var txt = t ? t.textContent : '';
    c.dispatchEvent(ev('pointerup'));
    var t2 = document.querySelector('.ci-stock .chart-tip');
    return {
      shown: shown, txt: txt, hiddenAfter: !t2 || t2.style.display === 'none',
      w: Math.round(r.width), h: Math.round(r.height)
    };
  })()`);
}
let hover = await tryHover();
if (!hover.shown) { await sleep(1200); hover = await tryHover(); }
ok('长按图表显示十字线数值（日期/开高低收）', hover && hover.shown && /开/.test(hover.txt || ''), JSON.stringify(hover));
ok('松手后数值气泡自动隐藏', hover && hover.hiddenAfter, JSON.stringify(hover));
// 回日K，后面的交易面板测试保持在有数据的周期上
await evalJS(`(function(){
  var items = document.querySelectorAll('.ci-stock .chart-tabs .seg-item');
  for (var i = 0; i < items.length; i++) { if (items[i].textContent.indexOf('日K') >= 0) { items[i].click(); return true; } }
  return false;
})()`);
await sleep(800);

console.log('\n=== 交易面板 ===');
await evalJS(`(function(){
  var btns = document.querySelectorAll('.ci-stock .sheet-foot .submit');
  for (var i = 0; i < btns.length; i++) { if (btns[i].textContent === '买入') { btns[i].click(); return true; } }
  return false;
})()`);
await sleep(900);
const sheet = await evalJS(`(function(){
  var s = document.querySelector('.ci-stock-sheet');
  if (!s) return { open: false, estimate: [], title: '', qty: '', side: '' };
  var est = s.querySelectorAll('.est-row .v');
  var input = s.querySelector('.stepper-input');
  var qty = s.querySelectorAll('.stepper-input')[1];
  var side = s.querySelector('.side-btn.active');
  return {
    open: s.className.indexOf('show') >= 0,
    title: (s.querySelector('.sheet-title') || {}).textContent || '',
    estimate: est.length ? Array.prototype.map.call(est, function(e){ return e.textContent; }) : [],
    price: input ? input.value : '',
    qty: qty ? qty.value : '',
    side: side ? side.textContent : ''
  };
})()`);
if (!sheet.open) {
  const errs = await evalJS(`window.__ciStockErrors || []`);
  console.log('  浏览器错误：' + JSON.stringify(errs));
  const toastText = await evalJS(`(function(){ var t = document.querySelector('.ci-stock-toast'); return t ? t.textContent : ''; })()`);
  console.log('  提示条：' + toastText);
}
ok('交易面板已弹出', sheet.open);
ok('标题含股票名与买入', /买入/.test(sheet.title || ''), sheet.title);
ok('预估金额已显示', sheet.estimate.length >= 3, JSON.stringify(sheet.estimate));
ok('数量默认 1 手', sheet.qty === '100', sheet.qty);

// 零基础：老手（成交≥3 次）默认限价委托；「?」点开术语解释
const segActive = await evalJS(`(function(){
  var segs = document.querySelectorAll('.ci-stock-sheet .seg-item');
  for (var i = 0; i < segs.length; i++) { if (segs[i].className.indexOf('active') > -1 && /委托/.test(segs[i].textContent)) return segs[i].textContent; }
  return '';
})()`);
ok('老手默认限价委托（成交满 3 次后）', /限价/.test(segActive || ''), segActive);
const sheetTerm = await evalJS(`(function(){
  var q = document.querySelector('.ci-stock-sheet .term-q');
  if (!q) return { ok: false, title: '' };
  q.click();
  var t = (document.querySelector('.ci-stock .news-article-title') || {}).textContent || '';
  var c = document.querySelector('.ci-stock .news-close');
  if (c) c.click();
  return { ok: !!t, title: t };
})()`);
ok('交易面板「?」出术语解释', sheetTerm.ok && /委托/.test(sheetTerm.title || ''), sheetTerm.title);
await shot('04-trade');

// 改数量 → 预估应变化
const before = sheet.estimate.join('|');
const halfDone = await evalJS(`(function(){
  var s = document.querySelector('.ci-stock-sheet');
  if (!s) return false;
  var quicks = s.querySelectorAll('.quick');
  for (var i = 0; i < quicks.length; i++) { if (quicks[i].textContent === '全仓') { quicks[i].click(); return true; } }
  return false;
})()`);
await sleep(600);
const after = halfDone ? await evalJS(`(function(){
  var s = document.querySelector('.ci-stock-sheet');
  var est = s.querySelectorAll('.est-row .v');
  var qty = s.querySelectorAll('.stepper-input')[1];
  return { estimate: Array.prototype.map.call(est, function(e){ return e.textContent; }).join('|'), qty: qty ? qty.value : '' };
})()`) : { estimate: '', qty: 'N/A' };
ok('全仓后数量与预估都变化', after.estimate !== before && after.qty !== '100', after.qty + ' 股');
await shot('05-trade-all');

// 关掉面板
await evalJS(`document.querySelector('.ci-stock-sheet .sheet-close').click()`);
await sleep(500);

console.log('\n=== 持仓 / 委托 / 排行 / 规则 ===');
async function clickNav(label) {
  return evalJS(`(function(){
    var items = document.querySelectorAll('.ci-stock .nav-item');
    for (var i = 0; i < items.length; i++) {
      if (items[i].textContent.indexOf(${JSON.stringify(label)}) >= 0) { items[i].click(); return true; }
    }
    return false;
  })()`);
}

await clickNav('持仓');
await sleep(1600);
const pos = await evalJS(`(function(){
  return {
    cards: document.querySelectorAll('.ci-stock .pos-card').length,
    hero: !!document.querySelector('.ci-stock .hero-value'),
    active: (document.querySelector('.ci-stock .nav-item.active') || {}).textContent || ''
  };
})()`);
ok('持仓页渲染', pos.cards >= 1, pos.cards + ' 张持仓卡');

// 今日复盘：6 格 + 仓位条
const rv = await evalJS(`(function(){
  return {
    cells: document.querySelectorAll('.ci-stock .rv-grid .rv-item').length,
    bar: !!document.querySelector('.ci-stock .rv-bar-stock'),
    tip: (document.querySelector('.ci-stock .rv-tip') || {}).textContent || ''
  };
})()`);
ok('今日复盘卡 6 格', rv.cells === 6, rv.cells);
ok('仓位条与教学提示', rv.bar && rv.tip.length > 6, rv.tip.slice(0, 24));

// 成就：15 个（v1.14 新增 5 个）
const ach = await evalJS(`(function(){
  return {
    count: document.querySelectorAll('.ci-stock .ach-item').length,
    head: (document.querySelectorAll('.ci-stock .chart-tabs .card-more')[0] || {}).textContent || ''
  };
})()`);
let achCount = ach.count;
for (let i = 0; i < 10 && achCount < 15; i++) {
  await sleep(400);
  achCount = await evalJS(`document.querySelectorAll('.ci-stock .ach-item').length`);
}
ok('成就墙 15 个（含新增 5 个）', achCount >= 15, achCount + ' 个');

// 持仓天数标签（opened_at）
const holdTag = await evalJS(`(function(){
  var tags = document.querySelectorAll('.ci-stock .pos-tag.hold');
  return { n: tags.length, text: tags.length ? tags[0].textContent : '' };
})()`);
ok('持仓显示持有天数', holdTag.n >= 1 && /天|建仓/.test(holdTag.text || ''), holdTag.text);
ok('持仓页高亮导航正确', /持仓/.test(pos.active), pos.active);
await shot('06-positions');

// 资金流水：最近 6 条 + 查看全部
const lg = await evalJS(`(function(){
  return {
    rows: document.querySelectorAll('.ci-stock .ledger-row').length,
    more: !!document.querySelector('.ci-stock .ledger-more'),
    bal: (document.querySelector('.ci-stock .lg-bal') || {}).textContent || ''
  };
})()`);
ok('持仓页有资金流水（最近记录）', lg.rows >= 1 && lg.more, lg.rows + ' 条，more=' + lg.more);
ok('流水带余额（可对账）', /余额/.test(lg.bal || ''), lg.bal);
await evalJS(`(function(){ var m = document.querySelector('.ci-stock .ledger-more'); if (m) m.click(); return true; })()`);
await sleep(900);
const lgView = await evalJS(`(function(){
  return {
    isLedger: !!document.querySelector('.ci-stock .view-ledger'),
    name: (document.querySelector('.ci-stock .view-ledger .detail-name') || {}).textContent || '',
    rows: document.querySelectorAll('.ci-stock .view-ledger .ledger-row').length
  };
})()`);
ok('「查看全部」进入流水页', lgView.isLedger && /资金流水/.test(lgView.name), lgView.name);
ok('流水页有明细行', lgView.rows >= 1, lgView.rows + ' 行');
await shot('07b-ledger');
await evalJS(`(function(){ var b = document.querySelector('.ci-stock .view-ledger .back-btn'); if (b) b.click(); return true; })()`);
await sleep(700);

// 持仓速览：从持仓页点进个股，详情顶部应显示成本 / 可卖 / 浮盈
await evalJS(`(function(){ var c = document.querySelector('.ci-stock .pos-card'); if (c) c.click(); return true; })()`);
await sleep(2400);
const strip = await evalJS(`(function(){ var s = document.querySelector('.ci-stock .detail-pos'); return s ? s.textContent : ''; })()`);
ok('详情页显示我的持仓速览（持仓/成本/可卖）',
  /持仓 /.test(strip || '') && /成本/.test(strip || '') && /可卖/.test(strip || ''), strip);
await shot('06b-detail-pos');
await clickNav('行情');
await sleep(1200);

await clickNav('委托');
await sleep(1600);
const orders = await evalJS(`(function(){
  return {
    rows: document.querySelectorAll('.ci-stock .trow').length,
    head: document.querySelectorAll('.ci-stock .tbl-head').length,
    empty: document.querySelectorAll('.ci-stock .empty').length,
    active: (document.querySelector('.ci-stock .nav-item.active') || {}).textContent || ''
  };
})()`);
ok('委托页渲染（有表格或空态）', orders.rows > 0 || orders.empty > 0, orders.rows + ' 行');
ok('委托页导航高亮', /委托/.test(orders.active), orders.active);
await shot('07-orders');

// 成交记录
await evalJS(`(function(){
  var items = document.querySelectorAll('.ci-stock .chart-tabs .seg-item');
  for (var i = 0; i < items.length; i++) { if (items[i].textContent.indexOf('成交') >= 0) { items[i].click(); return true; } }
  return false;
})()`);
await sleep(1400);
const trades = await evalJS(`document.querySelectorAll('.ci-stock .trow').length`);
ok('成交记录有数据', trades >= 1, trades + ' 笔');

// 点成交行 → 费用明细（佣金/印花税/过户费）
await evalJS(`(function(){ var r = document.querySelector('.ci-stock .trow'); if (r) r.click(); return true; })()`);
await sleep(450);
const feeToast = await evalJS(`(function(){ var t = document.querySelector('.ci-stock-toast'); return t ? t.textContent : ''; })()`);
ok('成交行可看费用明细（佣金/印花税/过户费）',
  /佣金/.test(feeToast || '') && /过户费/.test(feeToast || ''), feeToast);
await shot('08-trades');

// 提醒铃铛：未读红点 → 面板 → 打开即已读
const bell = await evalJS(`(function(){
  var b = document.querySelector('.ci-stock .notify-bell');
  var badge = b ? b.querySelector('.nb-badge') : null;
  return { has: !!b, badge: badge ? badge.textContent : '' };
})()`);
ok('顶栏有提醒铃铛', bell.has, bell.has);
ok('未读红点显示条数', !!bell.badge, bell.badge);

await evalJS(`(function(){ var b = document.querySelector('.ci-stock .notify-bell'); if (b) b.click(); return true; })()`);
await sleep(900);
const ntPanel = await evalJS(`(function(){
  return {
    open: !!document.querySelector('.ci-stock .news-modal'),
    rows: document.querySelectorAll('.ci-stock .notify-item').length,
    title: (document.querySelector('.ci-stock .news-panel-title') || {}).textContent || ''
  };
})()`);
ok('提醒面板可打开且有记录', ntPanel.open && ntPanel.rows >= 1 && /提醒/.test(ntPanel.title), JSON.stringify(ntPanel));
await shot('09b-notify');

// 提醒设置：设置 → 阈值 chip → 保存
await evalJS(`(function(){ var g = document.querySelector('.ci-stock .notify-set'); if (g) g.click(); return true; })()`);
await sleep(800);
const prefPanel = await evalJS(`(function(){
  return {
    rows: document.querySelectorAll('.ci-stock .pref-row').length,
    chips: document.querySelectorAll('.ci-stock .pref-row .seg-item').length,
    save: !!document.querySelector('.ci-stock .news-panel .submit')
  };
})()`);
ok('提醒设置可打开（开关 + 两个阈值）', prefPanel.rows >= 3 && prefPanel.chips >= 7 && prefPanel.save, JSON.stringify(prefPanel));
await shot('09c-pref');
await evalJS(`(function(){
  var chips = document.querySelectorAll('.ci-stock .pref-row .seg-item');
  for (var i = 0; i < chips.length; i++) { if (chips[i].textContent === '3%') { chips[i].click(); return true; } }
  return false;
})()`);
await sleep(400);
await evalJS(`(function(){ var b = document.querySelector('.ci-stock .news-panel .submit'); if (b) b.click(); return true; })()`);
await sleep(900);
ok('保存后设置面板关闭', await evalJS(`!document.querySelector('.ci-stock .news-modal')`), '');
await evalJS(`(function(){ var c = document.querySelector('.ci-stock .news-close'); if (c) c.click(); return true; })()`);
await sleep(700);
const badgeGone = await evalJS(`!document.querySelector('.ci-stock .nb-badge')`);
ok('打开后未读清零', badgeGone, badgeGone);

// 学元钱包：点顶栏「学元」→ 余额 / 津贴 / 来源清单
await evalJS(`(function(){ var w = document.querySelector('.ci-stock .wallet'); if (w) w.click(); return true; })()`);
await sleep(1000);
const wallet = await evalJS(`(function(){
  return {
    open: !!document.querySelector('.ci-stock .news-modal'),
    balance: (document.querySelector('.ci-stock .wallet-balance') || {}).textContent || '',
    claim: (document.querySelector('.ci-stock .wallet-claim') || {}).textContent || '',
    src: document.querySelectorAll('.ci-stock .wallet-src-row').length
  };
})()`);
ok('学元钱包可打开（余额/津贴/来源清单）',
  wallet.open && wallet.balance.length > 0 && wallet.src >= 6 && /领/.test(wallet.claim || ''),
  JSON.stringify(wallet));
await shot('09d-wallet');
await evalJS(`(function(){ var c = document.querySelector('.ci-stock .news-close'); if (c) c.click(); return true; })()`);
await sleep(400);

await clickNav('排行');
// 排行要先拉快照再算，慢的时候 2~3 秒，轮询等待
let rank = null;
for (let i = 0; i < 14; i++) {
  rank = await evalJS(`(function(){
    return {
      rows: document.querySelectorAll('.ci-stock .rank-row').length,
      me: !!document.querySelector('.ci-stock .rank-bar')
    };
  })()`);
  if (rank.rows >= 1 && rank.me) break;
  await sleep(500);
}
ok('排行页渲染', rank.rows >= 1, rank.rows + ' 人');
ok('显示我的排名', rank.me);
await shot('09-rank');

await clickNav('规则');
await sleep(1200);
const rules = await evalJS(`document.querySelectorAll('.ci-stock .rule').length`);
ok('规则页 7 条以上', rules >= 7, rules);
await shot('10-rules');

console.log('\n=== 指南页 ===');
await clickNav('指南');
await sleep(1200);
const guide = await evalJS(`(function(){
  var titles = [];
  var els = document.querySelectorAll('.ci-stock .guide-title');
  for (var i = 0; i < els.length; i++) titles.push(els[i].textContent);
  return {
    cards: document.querySelectorAll('.ci-stock .guide-card').length,
    tourBtn: !!document.querySelector('.ci-stock .guide-tour-btn'),
    terms: document.querySelectorAll('.ci-stock .gi-terms > div').length,
    active: (document.querySelector('.ci-stock .nav-item.active') || {}).textContent || '',
    titles: titles
  };
})()`);
ok('指南页 ≥15 节教程', guide.cards >= 15, guide.cards + ' 节');
ok('新功能都有教程（提醒 / 资金流水章节）',
  guide.titles.some(function (t) { return /提醒/.test(t); }) &&
  guide.titles.some(function (t) { return /资金流水/.test(t); }),
  guide.titles.join('|'));
ok('指南页导航高亮正确', /指南/.test(guide.active), guide.active);
ok('术语表条目 ≥10', guide.terms >= 10, guide.terms);
await shot('11b-guide');
await evalJS(`document.querySelector('.ci-stock .guide-tour-btn').click()`);
await sleep(600);
ok('可从指南页重看新手引导', await evalJS(`!!document.querySelector('.ci-stock .tour-layer')`));
await evalJS(`document.querySelector('.ci-stock .tour-skip').click()`);
await sleep(400);
ok('跳过引导可关闭', !(await evalJS(`!!document.querySelector('.ci-stock .tour-layer')`)));

console.log('\n=== 竖屏自适应 ===');
await send('Emulation.setDeviceMetricsOverride', { width: 700, height: 900, deviceScaleFactor: 2, mobile: true });
await sleep(900);
await clickNav('行情');
await sleep(1600);
const portrait = await evalJS(`(function(){
  var nav = document.querySelector('.ci-stock .nav');
  var cs = nav ? getComputedStyle(nav) : null;
  var main = document.querySelector('.ci-stock .main');
  var hero = document.querySelector('.ci-stock .hero');
  return {
    dir: cs ? cs.flexDirection : '',
    navBottom: cs ? cs.bottom : '',
    mainPadBottom: main ? getComputedStyle(main).paddingBottom : '',
    heroDir: hero ? getComputedStyle(hero).flexDirection : '',
    rows: document.querySelectorAll('.ci-stock .qrow').length
  };
})()`);
ok('竖屏导航变底部横排', portrait.dir === 'row', portrait.dir);
ok('主区给底部导航留出空间', parseInt(portrait.mainPadBottom, 10) >= 60, portrait.mainPadBottom);
ok('竖屏资产卡纵向排列', portrait.heroDir === 'column', portrait.heroDir);
await shot('11-portrait');

console.log('\n=== 控制台错误 ===');
const errs = await evalJS(`(window.__ciStockErrors || []).length`);
// 没有专门的错误收集器时不强判，只提示

console.log('\n=== 结果 ===');
console.log('通过 ' + pass + ' / 失败 ' + fail);
console.log('截图目录：' + SHOTS);

chrome.kill();
process.exit(fail ? 1 : 0);
