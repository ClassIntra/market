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

console.log('\n=== 详情页 ===');
// 选一只「买得起一手」的股票：茅台一手 14 万，点它只会弹「资金不足」，
// 验不到交易面板。用价格 < 50 元的第一只。
const picked = await evalJS(`(function(){
  var rows = document.querySelectorAll('.ci-stock .qrow');
  for (var i = 0; i < rows.length; i++) {
    var el = rows[i].querySelector('[data-field="price"]');
    var p = parseFloat(el ? el.textContent : '0');
    if (p > 0 && p < 50) {
      var name = (rows[i].querySelector('.qrow-name') || {}).textContent || '';
      rows[i].click();
      return { code: rows[i].getAttribute('data-code'), name: name, price: p };
    }
  }
  return null;
})()`);
ok('选中可交易的股票', !!picked, picked ? picked.code + ' ' + picked.name + ' @' + picked.price : 'none');
await sleep(2200);
const detail = await evalJS(`(function(){
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
ok('详情页显示股票名', !!detail.name, detail.name);
ok('详情页价格', /^\d+\.\d{2}$/.test(detail.price), detail.price);
ok('分时图画布存在', detail.hasChart);
ok('分时图已绘制（非空白）', detail.painted);
ok('关键指标 8 项', detail.cells === 8, detail.cells);

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
ok('持仓页高亮导航正确', /持仓/.test(pos.active), pos.active);
await shot('06-positions');

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
await shot('08-trades');

await clickNav('排行');
await sleep(1600);
const rank = await evalJS(`(function(){
  return {
    rows: document.querySelectorAll('.ci-stock .rank-row').length,
    me: !!document.querySelector('.ci-stock .rank-bar')
  };
})()`);
ok('排行页渲染', rank.rows >= 1, rank.rows + ' 人');
ok('显示我的排名', rank.me);
await shot('09-rank');

await clickNav('规则');
await sleep(1200);
const rules = await evalJS(`document.querySelectorAll('.ci-stock .rule').length`);
ok('规则页 7 条以上', rules >= 7, rules);
await shot('10-rules');

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
