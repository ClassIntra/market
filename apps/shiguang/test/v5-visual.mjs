// 拾光群岛 v5 —— 真浏览器验收（CDP）
//
// 为什么不用「读 DOM / 读 state」验收：那只能证明代码跑过了，不能证明「看得见」。
// 这个脚本在真 Chrome 里把游戏跑起来，沿真实链路截图，并把 console 的报错抓回来。
//
// 前置：无（自己起隔离服务器 + 自签登录态，不碰 9001 / 生产库）
// 用法：NODE_PATH=<...> "C:/Program Files/nodejs/node.exe" test/v5-visual.mjs
import { spawn, execSync } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { createRequire } from 'node:module';
import { setTimeout as sleep } from 'node:timers/promises';

const require = createRequire(import.meta.url);
const NM = 'D:/NetWork/Integration/ClassIntra/server/node_modules/';
const APP = process.env.SG5_APP || 'D:/NetWork/Integration/market/apps/shiguang';   // 可指向已安装目录做验收
const SRC = APP + '/backend/v5/';
const OUT = process.env.SG5_OUT || 'D:/tmp/sg5-shots';
const HTTP_PORT = 8190 + Math.floor(Math.random() * 300);   // 每轮独立端口：上一轮残留的 Chrome 连不上，也干扰不到
const CDP_PORT = 9400 + Math.floor(Math.random() * 300);   // 防止连到上一轮遗留的 Chrome
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const RUN_TOKEN = 'run' + Date.now();

// 上一轮如果崩了，Chrome 会留在后台继续轮询一个已经不存在的服务器 ——
// 于是新一轮抓到的 console 里全是别人的 ERR_CONNECTION_REFUSED。
// 只杀「命令行里带本套件 profile 路径」的 chrome，不碰用户自己开的浏览器。
// 不主动杀进程：每轮用随机 CDP 端口 + 随机活动令牌，天然隔离上一轮残留。
const VW = Number(process.env.SG5_VW) || 1180, VH = Number(process.env.SG5_VH) || 760;

const express = require(NM + 'express');
const routes = require(SRC + 'routes.js');
const store = require(SRC + 'store.js');
const SIM = require(SRC + 'sim.js');
const W = require(SRC + 'worldgen.js');
const world = W.get();

if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

const MIME = {
  '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.json': 'application/json; charset=utf-8',
  '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.woff2': 'font/woff2', '.svg': 'image/svg+xml'
};

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use('/api/shiguang', routes);

// 测试专用：把服务端玩家挪到指定坐标（客户端下一次 sync 会被纠正过去）
app.post('/test/teleport', async (req, res) => {
  const body = req.body || {};
  const uid = body.uid || '1001';
  const x = Number(body.x), y = Number(body.y);
  const rec = store.load(uid, { x, y });
  rec.x = x; rec.y = y;
  store.flush(uid);
  store.evict(uid);
  if (SIM.players[uid]) { SIM.players[uid].x = x; SIM.players[uid].y = y; }
  res.json({ ok: 1, x, y });
});
// 测试专用：无敌（免得截图时被打死）
app.post('/test/god', (req, res) => {
  const uid = (req.body || {}).uid || '1001';
  if (SIM.players[uid]) SIM.players[uid].hp = SIM.players[uid].maxHp;
  res.json({ ok: 1 });
});
// 测试专用：给星屑，方便看面板
app.post('/test/rich', (req, res) => {
  const rec = store.load('1001', { x: world.town.cx, y: world.town.cy });
  rec.shards = 999;
  store.markDirty('1001');
  res.json({ ok: 1, shards: rec.shards });
});

// 静态：/app/* → 应用目录
app.use('/app', express.static(APP, { etag: false, maxAge: 0 }));

app.get('/favicon.ico', (req, res) => {
  res.writeHead(302, { Location: '/app/icon.svg' });
  res.end();
});

app.get('/', (req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(`<!doctype html><html><head><meta charset="utf-8">
<title>拾光群岛 v5 验收台</title>
<link rel="stylesheet" href="/app/frontend/style.css">
<style>html,body{margin:0;height:100%;background:#070a14;overflow:hidden}
#stage{position:absolute;left:0;top:0;width:100%;height:100%}</style>
</head><body><div id="stage"></div>
<script>
window.__pageToken = new URLSearchParams(location.search).get('t') || '';
window.ClassIntraMarket = { define: function (d) { window.__def = d; } };
// 最小宿主替身：只实现 entry.js 真正用到的那几个面
window.__ctx = {
  data: {
    api: {
      get: function (p) { return fetch('/api' + p).then(function (r) { return r.json(); }).then(function (j) { return { data: j }; }); },
      post: function (p, b) { return fetch('/api' + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b || {}) }).then(function (r) { return r.json(); }).then(function (j) { return { data: j }; }); }
    },
    storage: (function () {
      var mem = {};
      return { get: function (k, d) { return mem[k] === undefined ? d : mem[k]; }, set: function (k, v) { mem[k] = v; } };
    })(),
    realtime: { subscribe: function () { return function () {}; } }
  },
  system: { role: 'student', can: function () { return true; } },
  app: {
    assetUrl: function (p) { return '/app/' + p; },
    onDestroy: function (fn) { (window.__cleanup = window.__cleanup || []).push(fn); }
  }
};
</script>
<script src="/app/frontend/entry.js"></script>
<script>
window.__bootErr = '';
try {
  window.__def.mount(document.getElementById('stage'), window.__ctx);
} catch (e) { window.__bootErr = String(e && e.stack || e); }
</script>
</body></html>`);
});

const server = createServer(app);
await new Promise((r) => server.listen(HTTP_PORT, '127.0.0.1', r));

// ---------- Chrome ----------
const chrome = spawn(CHROME, [
  '--headless=new',
  `--remote-debugging-port=${CDP_PORT}`,
  `--user-data-dir=${OUT}/profile-${Date.now()}`,
  '--no-first-run', '--no-default-browser-check', '--disable-extensions',
  '--disable-gpu', '--mute-audio', '--autoplay-policy=no-user-gesture-required',
  `--window-size=${VW},${VH}`,
  `http://127.0.0.1:${HTTP_PORT}/?t=${RUN_TOKEN}`
], { stdio: 'ignore' });

const getJSON = async (p) => (await fetch(`http://127.0.0.1:${CDP_PORT}${p}`)).json();
let page = null;
for (let i = 0; i < 80; i++) {
  try {
    const list = await getJSON('/json/list');
    page = list.find((t) => t.type === 'page' && t.url.indexOf('127.0.0.1:' + HTTP_PORT) >= 0);
    if (page) break;
  } catch (e) {}
  await sleep(400);
}
if (!page) { console.error('Chrome 未起来'); process.exit(1); }

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let msgId = 0;
const pending = new Map();
const logs = [];
const reqUrl = {};
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) {
    const { res, rej } = pending.get(m.id);
    pending.delete(m.id);
    m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
  } else if (m.method === 'Runtime.consoleAPICalled') {
    const args = (m.params.args || []).map((a) => a.value !== undefined ? a.value : (a.description || a.type)).join(' ');
    logs.push('[' + m.params.type + '] ' + args);
  } else if (m.method === 'Runtime.exceptionThrown') {
    logs.push('[exception] ' + (m.params.exceptionDetails.exception ? m.params.exceptionDetails.exception.description : m.params.exceptionDetails.text));
  } else if (m.method === 'Log.entryAdded') {
    logs.push('[' + m.params.entry.level + '] ' + m.params.entry.text);
  } else if (m.method === 'Network.responseReceived') {
    var r = m.params.response;
    if (r.status >= 400) logs.push('[http' + r.status + '] ' + r.url);
  }
};
function send(method, params) {
  const id = ++msgId;
  return new Promise((res, rej) => {
    pending.set(id, { res, rej });
    ws.send(JSON.stringify({ id, method, params: params || {} }));
  });
}

await send('Runtime.enable');
await send('Network.enable');
await send('Log.enable');
await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: VW, height: VH, deviceScaleFactor: 1, mobile: false });

async function evalJs(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) return { err: r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception && r.exceptionDetails.exception.description || '') };
  return { v: r.result && r.result.value };
}
async function shot(name) {
  const r = await send('Page.captureScreenshot', { format: 'png' });
  const fs = await import('node:fs');
  fs.writeFileSync(join(OUT, name + '.png'), Buffer.from(r.data, 'base64'));
  console.log('  shot →', name + '.png');
}
async function key(code, keyName, down) {
  await send('Input.dispatchKeyEvent', {
    type: down ? 'rawKeyDown' : 'keyUp', windowsVirtualKeyCode: code, nativeVirtualKeyCode: code,
    key: keyName, code: keyName.length === 1 ? 'Key' + keyName.toUpperCase() : keyName
  });
}

let pass = 0, fail = 0;
// v5.6 W1：条件轮询替代固定 sleep —— 3/22 的随机挂全来自「盲等 N ms 后断言」
async function waitFor(expr, timeout, label) {
  const t0 = Date.now();
  for (;;) {
    const r = await evalJs(expr);
    if (!r.err && r.v) return true;
    if (Date.now() - t0 > (timeout || 6000)) {
      console.log('  waitFor 超时:', label || expr);
      return false;
    }
    await sleep(200);
  }
}
function ok(c, n, extra) { if (c) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗', n, extra === undefined ? '' : JSON.stringify(extra)); } }

// ---------- 载入 ----------
await sleep(1200);
const tok = await evalJs('window.__pageToken || ""');
ok(tok.v === RUN_TOKEN, '连到的是本轮页面（不是上一轮残留）', tok.v);
let ready = false;
for (let i = 0; i < 50; i++) {
  const r = await evalJs('!!(window.__sg5 && window.__sg5.state.ready)');
  if (r.v) { ready = true; break; }
  await sleep(400);
}
if (!ready) {
  console.log('  console:', logs.slice(0, 10));
  console.log('  bootErr:', await evalJs('window.__bootErr || ""'));
}
const bootErr = await evalJs('window.__bootErr || ""');
ok(!bootErr.v, '入口无异常', bootErr.v);
ok(ready, '世界载入完成（ready）');
await evalJs('__sg5.lockPhase("day", 0.32)');
await sleep(900);
await shot('01-town');
await evalJs('(function(){var c=document.querySelector(".sg5-chapter"); if(c) c.className="sg5-chapter"; return 1})()');
await sleep(1000);
await shot('01b-town');

// ---------- 面板 ----------
// 前面打怪/夜景会把角色打倒、把天锁成夜：面板验收必须在「白天 + 站着」下看，
// 否则死亡遮罩盖住整个面板，截图什么都证明不了。
await fetch(`http://127.0.0.1:${HTTP_PORT}/api/shiguang/v5/respawn`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-uid': '1001' }, body: '{}' });
await fetch(`http://127.0.0.1:${HTTP_PORT}/test/god`, { method: 'POST' });
await evalJs('__sg5.lockPhase("day", 0.32)');
await sleep(320);
await fetch(`http://127.0.0.1:${HTTP_PORT}/test/rich`, { method: 'POST' });
for (const p of ['char', 'bag', 'map', 'dex', 'talent', 'help', 'social']) {
  await evalJs('__sg5.panel("' + p + '")');
  await waitFor('!!document.querySelector(".sg5-panel .sg5-phead")', 5000, 'panel ' + p);
  await sleep(260);
  await shot('07-panel-' + p);
}
await evalJs('__sg5.panel("")');

// ---------- v5.3 农场经营 / 小镇 / 钓鱼绿条 ----------
const fstate = await evalJs('JSON.stringify(window.__sg5 && window.__sg5.farm ? window.__sg5.farm.state() : null)');
console.log('  farm:', fstate.v);
ok(fstate.v && JSON.parse(fstate.v).crops >= 30, '作物数据表已下发到浏览器', fstate.v);

// 先造一块有苗的田，面板和世界层截图才不是空的
await evalJs('__sg5.farm.act("buy",{kind:"seed",id:"seed_parsnip",n:5})'
  + '.then(function(){return __sg5.farm.act("till",{r:1,c:1})})'
  + '.then(function(){return __sg5.farm.act("plant",{r:1,c:1,seed:"seed_parsnip"})})'
  + '.then(function(){return __sg5.farm.act("water",{r:1,c:1})}).then(function(){return 1})');
await waitFor('(window.__sg5.state.farm.p.plots||{})["1,1"] && (window.__sg5.state.farm.p.plots["1,1"].crop||"")==="parsnip" && window.__sg5.state.farm.p.plots["1,1"].watered===1', 6000, '田 1,1 种下并浇了水');
for (const p of ['farm', 'relation', 'mine']) {
  await evalJs('__sg5.panel("' + p + '")');
  await waitFor('!!document.querySelector(".sg5-panel .sg5-phead")', 5000, 'panel ' + p);
  await sleep(300);
  await shot('13-panel-' + p);
}
await evalJs('__sg5.panel("")');
const farmHud = await evalJs('JSON.stringify({tools:document.querySelectorAll(".sg5-farm-tool").length,bar:!!document.querySelector(".sg5-farmbar")})');
ok(farmHud.v && JSON.parse(farmHud.v).tools === 6, '农场 HUD 六件工具齐全', farmHud.v);

// 世界层农田：走服务端权威 goto，不能只靠前端 teleport（会被 sync 拉回）
await evalJs('__sg5.farm.act("goto",{}).then(function(d){if(d&&d.x!=null)__sg5.teleport(d.x,d.y);return d&&d.x})');
await sleep(820);
await shot('14-farm-world');

// ---------- v5.4 加工页签 + 世界层采集物 ----------
await evalJs('__sg5.farm.act("buy",{kind:"machine",id:"furnace"}).then(function(){return 1})');
await sleep(420);
await evalJs('__sg5.panel("farm")');
await sleep(240);
await evalJs('(function(){var t=document.querySelectorAll(".sg5-tab");for(var i=0;i<t.length;i++){if(t[i].textContent.indexOf("加工")>=0){t[i].click();return 1}}return 0})()');
await waitFor('document.querySelectorAll(".sg5-farm-recipe").length >= 4', 6000, '加工配方渲染');
await shot('16-panel-craft');
const craft = await evalJs('JSON.stringify({rows:document.querySelectorAll(".sg5-farm-recipe").length,sects:document.querySelectorAll(".sg5-farm-cont .sg5-sect").length,near:!!document.querySelector(".sg5-farm-near")})');
ok(craft.v && JSON.parse(craft.v).rows >= 4 && JSON.parse(craft.v).sects >= 5 && JSON.parse(craft.v).near, '加工页签：4 条熔炉配方 + 5 个设备分节 + 农场条提示位', craft.v);
await evalJs('__sg5.panel("")');
await sleep(200);
const forageN = await evalJs('JSON.stringify((window.__sg5 && __sg5.state.farm && __sg5.state.farm.p && __sg5.state.farm.p.forage || []).length)');
ok(forageN.v && JSON.parse(forageN.v) >= 14, '当日采集点已下发到浏览器（世界层渲染用）', forageN.v);
// 传到最近一个采集点旁边：确认世界层画得出采集物、农场条会提示「E：采集」
const fpRaw = await evalJs('JSON.stringify((window.__sg5.state.farm.p.forage || [])[0] || null)');
const fp = fpRaw.v && fpRaw.v !== 'null' ? JSON.parse(fpRaw.v) : null;
if (fp) {
  await fetch(`http://127.0.0.1:${HTTP_PORT}/test/teleport`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ x: fp.x + 0.5, y: fp.y + 1.5 })
  });
  await evalJs('__sg5.teleport(' + (fp.x + 0.5) + ',' + (fp.y + 1.5) + ')');
  await sleep(700);
  // 采集提示由农场条在下一帧刷新，别盲等固定时长（v5.6 教训：固定 sleep 会抖）
  const nearOk = await waitFor('(((document.querySelector(".sg5-farm-near")||{}).textContent)||"").indexOf("采集")>=0', 5000, '农场条提示出现');
  await shot('17-forage-world');
  const nearTx = await evalJs('JSON.stringify((document.querySelector(".sg5-farm-near")||{}).textContent||"")');
  ok(nearOk === true, '农场条提示「E：采集」', nearTx.v);
} else {
  await shot('17-forage-world');
}

// 钓鱼 QTE：点「甩竿」后应出现绿条轨道
await evalJs('__sg5.panel("mine")');
await sleep(240);
await evalJs('(function(){var t=document.querySelectorAll(".sg5-tab");for(var i=0;i<t.length;i++){if(t[i].textContent==="钓鱼"){t[i].click();return 1}}return 0})()');
await sleep(320);
await evalJs('(function(){var b=document.querySelectorAll(".sg5-btn-primary");for(var i=0;i<b.length;i++){if(b[i].textContent==="甩竿"){b[i].click();return 1}}return 0})()');
const qteReady = await waitFor('!!document.querySelector(".sg5-qte")', 6000, '钓鱼绿条出现');
const qte = { v: qteReady };
ok(qte.v === true, '钓鱼绿条小游戏已启动', qte.v);
await shot('15-fishing-qte');
await evalJs('__sg5.panel("")');
// 农场 goto 改的是真实存档，后面的「出生在拾光镇」断言要先把人送回来
await fetch(`http://127.0.0.1:${HTTP_PORT}/test/teleport`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ x: world.town.cx + 0.5, y: world.town.cy + 0.2 })
});
await evalJs('__sg5.teleport(' + (world.town.cx + 0.5) + ',' + (world.town.cy + 0.2) + ')');
await sleep(320);

// ---------- v5.5 节日小游戏：彩蛋世界层 / 新手引导条 / 丰收展展台 ----------
// 面板流程长且草原有怪：先复活 + 无敌，免得死亡遮罩盖住截图
await fetch(`http://127.0.0.1:${HTTP_PORT}/api/shiguang/v5/respawn`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-uid': '1001' }, body: '{}' });
await fetch(`http://127.0.0.1:${HTTP_PORT}/test/god`, { method: 'POST' });
routes.FARM.setEpochForDay(13);   // 春 13 彩蛋节
await evalJs('__sg5.farm && __sg5.farm.setDay ? __sg5.farm.setDay(13) : 1');
await sleep(800);
const eggRaw = await evalJs('JSON.stringify((window.__sg5.state.farm.p && window.__sg5.state.farm.p.eggsLeft || [])[0] || null)');
const egg0 = eggRaw.v && eggRaw.v !== 'null' ? JSON.parse(eggRaw.v) : null;
ok(!!egg0, '彩蛋节当日下发彩蛋坐标', eggRaw.v);
if (egg0) {
  await fetch(`http://127.0.0.1:${HTTP_PORT}/test/teleport`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ x: egg0.x + 0.5, y: egg0.y + 1.3 })
  });
  await evalJs('__sg5.teleport(' + (egg0.x + 0.5) + ',' + (egg0.y + 1.3) + ')');
  await waitFor('(document.querySelector(".sg5-farm-eggchip")||{textContent:""}).textContent.indexOf("彩蛋节 · 0/12")>=0', 6000, '彩蛋 chip 0/12');
  const chipTx = await evalJs('JSON.stringify((document.querySelector(".sg5-farm-eggchip")||{}).textContent||"")');
  ok(String(chipTx.v).indexOf('彩蛋节 · 0/12') >= 0, 'farmbar 彩蛋 chip 显示 0/12', chipTx.v);
  await shot('18-egg-world');
  await evalJs('__sg5.farm.life("egg/pick",{i:' + egg0.i + '}).then(function(){return 1})');
  await waitFor('(document.querySelector(".sg5-farm-eggchip")||{textContent:""}).textContent.indexOf("彩蛋节 · 1/12")>=0', 6000, '彩蛋 chip 1/12');
  const chipTx2 = await evalJs('JSON.stringify((document.querySelector(".sg5-farm-eggchip")||{}).textContent||"")');
  ok(String(chipTx2.v).indexOf('彩蛋节 · 1/12') >= 0, '捡蛋后 chip 变 1/12', chipTx2.v);
  // 走到下一颗蛋旁：农场条应提示「E：捡彩蛋」
  const eggRaw2 = await evalJs('JSON.stringify((window.__sg5.state.farm.p && window.__sg5.state.farm.p.eggsLeft || [])[0] || null)');
  const egg1 = eggRaw2.v && eggRaw2.v !== 'null' ? JSON.parse(eggRaw2.v) : null;
  if (egg1) {
    await fetch(`http://127.0.0.1:${HTTP_PORT}/test/teleport`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ x: egg1.x + 0.5, y: egg1.y + 1.3 })
    });
    await evalJs('__sg5.teleport(' + (egg1.x + 0.5) + ',' + (egg1.y + 1.3) + ')');
    await waitFor('(document.querySelector(".sg5-farm-near")||{textContent:""}).textContent.indexOf("捡彩蛋")>=0', 6000, '农场条提示捡彩蛋');
    const nearTx2 = await evalJs('JSON.stringify((document.querySelector(".sg5-farm-near")||{}).textContent||"")');
    ok(String(nearTx2.v).indexOf('捡彩蛋') >= 0, '农场条提示「E：捡彩蛋」', nearTx2.v);
  }
}
// 新手引导条：清掉 sg5hint 去重记录（localStorage + 内存态），回田里应弹出 till 引导
await fetch(`http://127.0.0.1:${HTTP_PORT}/test/god`, { method: 'POST' });
await evalJs('(function(){try{localStorage.removeItem("sg5hint")}catch(e){} window.__sg5.state.farm.hintSeen={}; var h=document.querySelector(".sg5-hint"); if(h) h.className="sg5-hint"; return 1})()');
await evalJs('__sg5.farm.act("goto",{}).then(function(d){if(d&&d.x!=null)__sg5.teleport(d.x,d.y);return d&&d.x})');
await waitFor('!!document.querySelector(".sg5-hint.is-on")', 7000, '新手引导条弹出');
const hintTx = await evalJs('JSON.stringify((document.querySelector(".sg5-hint.is-on")||{}).textContent||"")');
ok(String(hintTx.v).indexOf('翻土') >= 0 || String(hintTx.v).indexOf('采集') >= 0 || String(hintTx.v).indexOf('彩蛋') >= 0,
  '新手引导条已弹出（till/forage/egg 任一）', hintTx.v);

// 丰收展：塞 9 样产物 → 展台视图 → 提交 → 成绩态
routes.FARM.setEpochForDay(72);   // 秋 16 丰收展
(function () {
  const f = routes.FARM.of('1001');
  f.inv = { parsnip_q3: 1, melon_q3: 1, pumpkin_q3: 1, kale_q3: 1, potato_q3: 1, garlic_q3: 1, tulip_q3: 1, jazz_q3: 1, cauliflower_q3: 1 };
  f.exhibit = { day: 0, items: null, grade: null };
  f.backpack = 36;
  routes.FARM.save('1001');
})();
await evalJs('__sg5.farm.setDay(72)');
await sleep(800);
await evalJs('(function(){var F=window.__sg5.state.farm; F.tab="bag"; F.exhibitMode=true; F.exhibitSel=["parsnip_q3","melon_q3","pumpkin_q3","kale_q3","potato_q3","garlic_q3","tulip_q3","jazz_q3","cauliflower_q3"]; return 1})()');
await evalJs('__sg5.panel("farm")');
await waitFor('document.querySelectorAll(".sg5-exhibit-cell").length === 9', 6000, '展台九格渲染');
await sleep(260);
await fetch(`http://127.0.0.1:${HTTP_PORT}/test/god`, { method: 'POST' });
const booth = await evalJs('JSON.stringify({cells:document.querySelectorAll(".sg5-exhibit-cell").length,prev:(document.querySelector(".sg5-farm-cal .sg5-farm-calclock")||{}).textContent||""})');
ok(booth.v && JSON.parse(booth.v).cells === 9, '展台 3×3 九格渲染', booth.v);
ok(booth.v && String(JSON.parse(booth.v).prev).indexOf('S') >= 0, '展台预览评到 S 级', booth.v);
await shot('20-exhibit-booth');
await evalJs('__sg5.farm.life("exhibit/submit",{items:window.__sg5.state.farm.exhibitSel.slice()}).then(function(){return 1})');
await sleep(800);
// 提交成功回调会把 exhibitMode 收回背包视图：先关面板再切回展台看成绩态
await evalJs('__sg5.panel("")');
await evalJs('(function(){var F=window.__sg5.state.farm; F.exhibitMode=true; F.tab="bag"; return 1})()');
await evalJs('__sg5.panel("farm")');
await waitFor('(document.querySelector(".sg5-farm-calclock")||{textContent:""}).textContent.indexOf("S 级 · 奖金已入账")>=0', 6000, '展台成绩态');
const grade = await evalJs('JSON.stringify((document.querySelector(".sg5-farm-calclock")||{}).textContent||"")');
ok(String(grade.v).indexOf('S 级 · 奖金已入账') >= 0, '提交后展台进入成绩态', grade.v);
// 收尾：回背包视图、把人送回镇上（后面的「出生在拾光镇」断言依赖出生点位）
await evalJs('(function(){var F=window.__sg5.state.farm; F.exhibitMode=false; F.tab="field"; return 1})()');
await evalJs('__sg5.panel("")');
await fetch(`http://127.0.0.1:${HTTP_PORT}/test/teleport`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ x: world.town.cx + 0.5, y: world.town.cy + 0.2 })
});
await evalJs('__sg5.teleport(' + (world.town.cx + 0.5) + ',' + (world.town.cy + 0.2) + ')');
await sleep(400);

// ---------- 《灯火纪》lore（v5.7）：石碑世界层 / 遗物阅读卡 / 图鉴世界页签 / 灯语仪式卡 ----------
await waitFor('!!(window.__sg5&&__sg5.state&&__sg5.state.map&&__sg5.state.map.relics&&__sg5.state.map.relics.length===20)', 8000, '20 处遗物入世界');
const relic0 = await evalJs('JSON.stringify(__sg5.state.map.relics[0])');
const rel = relic0.v ? JSON.parse(relic0.v) : {};
await fetch(`http://127.0.0.1:${HTTP_PORT}/test/teleport`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ x: rel.x + 0.5, y: rel.y + 1.5 })
});
await evalJs('__sg5.teleport(' + (rel.x + 0.5) + ',' + (rel.y + 1.5) + ')');
await sleep(600);
await waitFor('!!document.querySelector(".sg5-actions")', 4000, '世界层就绪');
await evalJs('__sg5.interact()');
await waitFor('!!document.querySelector(".sg5-lorecard")', 6000, '遗物阅读卡弹出');
await shot('21-lore-card');
const loreTxt = await evalJs('JSON.stringify((document.querySelector(".sg5-lorecard-text")||{}).textContent||"")');
ok(String(loreTxt.v).length > 60, '日记正文已渲染（守塔人故事）', String(loreTxt.v).slice(0, 30));
await evalJs('(function(){var b=document.querySelector(".sg5-lorecard button");if(b)b.click();return 1})()');
await sleep(400);
await waitFor('!document.querySelector(".sg5-lore.is-on")', 4000, 'lore 卡可关闭');
// 图鉴世界页签
await evalJs('__sg5.panel("dex")');
await evalJs('(function(){var t=[].slice.call(document.querySelectorAll(".sg5-tab")).filter(function(x){return x.textContent==="世界"})[0];if(t)t.click();return 1})()');
await waitFor('(document.querySelectorAll(".sg5-lorew-row").length>=5)', 6000, '图鉴世界页签渲染');
// v5.8 起日记不再是「守塔人日记」一整个分区，而是按区域分成「昼 n/n · 夜 n/n」组头
await waitFor('(document.body.textContent.indexOf("昼 ")>=0 && document.body.textContent.indexOf("夜 ")>=0)', 4000, '昼夜收集进度可见');
await shot('22-dex-world');
// v5.8：同一处地点的「昼/夜」两面必须成对呈现
const dyad = await evalJs('JSON.stringify({rows:document.querySelectorAll(".sg5-lorew-row.is-night").length,day:document.querySelectorAll(".sg5-face.is-day").length,night:document.querySelectorAll(".sg5-face.is-night").length})');
const dv = JSON.parse(dyad.v);
ok(dv.rows >= 5 && dv.day >= 5 && dv.night >= 5, '图鉴昼夜对照行与昼/夜牌齐全', dyad.v);
const leak = await evalJs('JSON.stringify([].slice.call(document.querySelectorAll(".sg5-lorew-row.is-night.is-off .sg5-lorew-text")).filter(function(e){return e.textContent.indexOf("入夜后")<0}).length)');
ok(Number(leak.v) === 0, '未获得的夜语正文不进 DOM（防剧透）', leak.v);
// 灯语仪式卡（模拟点亮广播）
await evalJs('__sg5.testEvent&&__sg5.testEvent({k:"lampword",z:"meadow",n:"晨光草原",t:"铃铛不响了，羊还是会回家的 —— 路我记在灯里了。替我喂猫。"})');
await sleep(500);
await waitFor('!!document.querySelector(".sg5-lampword")', 5000, '灯语仪式卡弹出');
await shot('23-lampword');
await evalJs('(function(){var b=document.querySelector(".sg5-lampword button");if(b)b.click();return 1})()');
await evalJs('__sg5.panel("")');
// ---------- 《夜语》v5.8：夜里才浮出来的残页 + 冷底夜卡 ----------
// 服务端相位也要置夜（collect 有相位门禁），本进程直接替换 dayPhase 引用
const realDayPhase = SIM.dayPhase;
SIM.dayPhase = () => ({ f: 0.8, name: 'night', night: true });
await evalJs('__sg5.lockPhase("night", 0.94)');
await sleep(300);
const nyxPick = await evalJs('(function(){var s=__sg5.state;var pick=s.loreNightPick||[];var got=s.loreNightCollected||[];var arr=(s.map.nights||[]).filter(function(n){return pick.indexOf(n.id)>=0&&got.indexOf(n.id)<0});return JSON.stringify(arr[0]||null)})()');
const nyx = nyxPick.v ? JSON.parse(nyxPick.v) : null;
ok(!!nyx, '今晚有可听见的夜语（按天轮转）', nyxPick.v);
if (nyx) {
  await fetch(`http://127.0.0.1:${HTTP_PORT}/test/teleport`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ x: nyx.x + 0.5, y: nyx.y + 1.5 })
  });
  await evalJs('__sg5.teleport(' + (nyx.x + 0.5) + ',' + (nyx.y + 1.5) + ')');
  await sleep(700);
  await shot('24-night-nyx');
  await evalJs('__sg5.interact()');
  await sleep(700);
  const ndbg = await evalJs('JSON.stringify({me:{x:__sg5.state.me.x,y:__sg5.state.me.y,down:__sg5.state.me.down,dead:__sg5.state.me.dead,hp:Math.round(__sg5.state.me.hp)},phase:__sg5.state.phase,pf:__sg5.state.pf,pick:(__sg5.state.loreNightPick||[]).length,nights:(__sg5.state.map.nights||[]).length,toasts:[].slice.call(document.querySelectorAll(".sg5-toast")).map(function(e){return e.textContent}).slice(-4)})');
  console.log('  night debug:', ndbg.v);
  await waitFor('!!document.querySelector(".sg5-nightcard")', 6000, '夜语卡弹出');
  const ncard = await evalJs('JSON.stringify({cold:!!document.querySelector(".sg5-lore.is-night"),text:((document.querySelector(".sg5-nightcard .sg5-lorecard-text")||{}).textContent||"").length})');
  const nv2 = ncard.v ? JSON.parse(ncard.v) : {};
  ok(nv2.cold === true, '夜卡用冷底 is-night 版式', ncard.v);
  ok(nv2.text > 20, '夜语正文已渲染', nv2.text);
  const nfit = await evalJs('(function(){var c=document.querySelector(".sg5-nightcard");if(!c)return JSON.stringify({missing:1});var r=c.getBoundingClientRect();return JSON.stringify({inside:(r.left>=0&&r.top>=0&&r.right<=innerWidth+1&&r.bottom<=innerHeight+1),h:Math.round(r.height),vh:innerHeight})})()');
  const nfv = nfit.v ? JSON.parse(nfit.v) : {};
  ok(nfv.inside === true, '夜卡完整落在视口内', nfit.v);
  await shot('25-night-card');
  await evalJs('(function(){var b=document.querySelector(".sg5-nightcard button");if(b)b.click();return 1})()');
  await sleep(300);
  await waitFor('!document.querySelector(".sg5-lore.is-on")', 4000, '夜卡可关闭');
}
SIM.dayPhase = realDayPhase;
await evalJs('__sg5.lockPhase("", 0)');
await fetch(`http://127.0.0.1:${HTTP_PORT}/test/teleport`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ x: world.town.cx + 0.5, y: world.town.cy + 0.2 })
});
await evalJs('__sg5.teleport(' + (world.town.cx + 0.5) + ',' + (world.town.cy + 0.2) + ')');
await sleep(400);

// ---------- 邀请卡 / 双人互动特效 ----------
await evalJs('__sg5.card()');
await sleep(520);
await shot('11-invite-card');
await evalJs('(function(){var c=document.querySelector(".sg5-invite");if(c&&c.parentNode)c.parentNode.removeChild(c);return 1})()');
await evalJs('__sg5.actfx()');
await sleep(300);
await shot('12-act-fx');
const social = await evalJs('JSON.stringify(__sg5.social())');
console.log('  social:', social.v);
ok(social.v && JSON.parse(social.v).acts === 6, '互动动作表已下发', social.v);

console.log('  center:', await evalJs('JSON.stringify({x:Math.round(__sg5.state.me.x*16*3-0)})'));
console.log('  diag:', await evalJs('JSON.stringify(__sg5.diag())'));

const st = await evalJs('JSON.stringify({zone:__sg5.state.zone, x:Math.round(__sg5.state.me.x), y:Math.round(__sg5.state.me.y), lv:__sg5.state.me.lv, hp:__sg5.state.me.hp, zoom:__sg5.state.zoom, mobs:Object.keys(__sg5.state.mobs).length})');
console.log('  state:', st.v);
ok(st.v && JSON.parse(st.v).zone === 'town', '出生在拾光镇', st.v);

// ---------- 草原 + 怪 ----------
const meadow = world.spawns.find((s) => s.zone === 'meadow' && s.lv <= 3);
await fetch(`http://127.0.0.1:${HTTP_PORT}/test/teleport`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ x: meadow.x + 6, y: meadow.y + 6 }) });
await sleep(1600);
await evalJs('__sg5.lockPhase("day", 0.30)');
await evalJs('(function(){var c=document.querySelector(".sg5-chapter"); if(c) c.className="sg5-chapter"; return 1})()');
await evalJs('__sg5.teleport(' + (meadow.x + 6) + ',' + (meadow.y + 6) + ')');
await sleep(500);
await shot('02-meadow');
console.log('  diag:', await evalJs('JSON.stringify(__sg5.diag())'));

// 走到怪身边，打一套
for (let i = 0; i < 4; i++) await sleep(60);
await evalJs('__sg5.attack()');
await sleep(170);
await evalJs('__sg5.attack()');
await sleep(170);
await evalJs('__sg5.attack()');
await sleep(200);
await shot('03-combat');
const combat = await evalJs('JSON.stringify({mobs:Object.keys(__sg5.state.mobs).length, texts:__sg5.state.texts.length, parts:__sg5.state.parts.length, hp:__sg5.state.me.hp})');
console.log('  combat:', combat.v);
ok(combat.v && JSON.parse(combat.v).mobs >= 0, '战斗帧渲染正常');

// 技能
await evalJs('__sg5.skill()');
await sleep(260);
await shot('04-skill');

// 翻滚
await evalJs('__sg5.roll()');
await sleep(160);
await shot('05-roll');

// ---------- 各生态区 ----------
const biomes = ['forest', 'swamp', 'crag', 'frost'];
for (const b of biomes) {
  const ws = world.landmarks.waystones.find((w) => w.zone === b);
  if (!ws) continue;
  await fetch(`http://127.0.0.1:${HTTP_PORT}/test/teleport`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ x: ws.x + 0.5, y: ws.y + 2 }) });
  await evalJs('__sg5.teleport(' + (ws.x + 0.5) + ',' + (ws.y + 2) + ')');
  await sleep(1200);
  await shot('10-biome-' + b);
}

// ---------- 夜（回镇上再拍，才是「拾光镇的夜」而不是随便一片雪地） ----------
await fetch(`http://127.0.0.1:${HTTP_PORT}/test/teleport`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ x: world.town.cx + 0.5, y: world.town.cy + 0.2 }) });
await evalJs('__sg5.teleport(' + (world.town.cx + 0.5) + ',' + (world.town.cy + 0.2) + ')');
await sleep(700);
await evalJs('__sg5.lockPhase("night", 0.94)');
await sleep(700);
await shot('06-night');

// ---------- 灯塔前 ----------
const tower = world.landmarks.towers.meadow;
await fetch(`http://127.0.0.1:${HTTP_PORT}/api/shiguang/v5/respawn`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-uid': '1001' }, body: '{}' });
await fetch(`http://127.0.0.1:${HTTP_PORT}/test/teleport`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ x: tower.x + 0.5, y: tower.y + 2.6 }) });
await evalJs('__sg5.teleport(' + (tower.x + 0.5) + ',' + (tower.y + 2.6) + ')');
await fetch(`http://127.0.0.1:${HTTP_PORT}/test/god`, { method: 'POST' });
await evalJs('__sg5.lockPhase("day", 0.32)');
await waitFor('Object.keys(__sg5.state.mobs).filter(function(k){return __sg5.state.mobs[k].boss}).length >= 1', 9000, '守护者出现');
await sleep(600);
await shot('08-tower');
const boss = await evalJs('JSON.stringify({boss: Object.keys(__sg5.state.mobs).filter(function(k){return __sg5.state.mobs[k].boss}).length, goal: !!__sg5.state.goal})');
console.log('  tower:', boss.v);
ok(boss.v && JSON.parse(boss.v).boss >= 1, '守护者出现在灯塔前', boss.v);

// ---------- 移动（键盘） ----------
await key(68, 'd', true);
await sleep(500);
await key(68, 'd', false);
await sleep(300);
const moved = await evalJs('JSON.stringify({x:Math.round(__sg5.state.me.x*10)/10})');
console.log('  move:', moved.v);
await shot('09-move');

// ---------- 终章：灯语 → 终章卡 → 灯火名录（v5.8） ----------
await evalJs('__sg5.lockPhase("night", 0.94)');
await evalJs('__sg5.testFinale({k:"finale-done",roster:{keepers:["张三","李四","王五"],later:["赵六","钱七"]}})');
await waitFor('!!document.querySelector(".sg5-lampword")', 5000, '终章灯语卡弹出');
await shot('26-finale-lamp');
await sleep(4600);   // 4200ms 时 showChapter(8) 会盖上来看一眼世界
await evalJs('(function(){var c=document.querySelector(".sg5-chapter");if(c&&c.parentNode)c.parentNode.removeChild(c);return 1})()');
await waitFor('!!document.querySelector(".sg5-roster")', 9000, '灯火名录卡弹出');
await sleep(500);
const roster = await evalJs('JSON.stringify({head:(document.querySelector(".sg5-roster-head")||{}).textContent||"",keepers:document.querySelectorAll(".sg5-roster-keeper").length,names:document.querySelectorAll(".sg5-roster-name").length,note:(document.querySelector(".sg5-roster-note")||{}).textContent||""})');
const rv = JSON.parse(roster.v);
ok(rv.head === '灯火名录', '灯火名录标题', rv.head);
ok(rv.keepers === 7 && rv.names === 5, '七代守塔人 + 全班名字齐全', roster.v);
ok(rv.note.indexOf('守了这一夜') >= 0, '名录附注统计正确', rv.note);
const rfit = await evalJs('(function(){var c=document.querySelector(".sg5-roster");var r=c.getBoundingClientRect();var btn=c.querySelector(".sg5-btn");var br=btn?btn.getBoundingClientRect():null;return JSON.stringify({inside:(r.left>=0&&r.top>=0&&r.right<=innerWidth+1&&r.bottom<=innerHeight+1),btnVisible:!!br&&br.bottom<=innerHeight+1,btnText:btn?btn.textContent:""})})()');
const rfv = JSON.parse(rfit.v);
ok(rfv.inside === true && rfv.btnVisible === true, '名录卡与「合上名册」按钮都在视口内', rfit.v);
await shot('27-roster');
await evalJs('(function(){var b=document.querySelector(".sg5-roster .sg5-btn");if(b)b.click();return 1})()');
await sleep(300);

// ---------- 控制台 ----------
const errs = logs.filter((l) => (l.indexOf('[error]') === 0 || l.indexOf('[exception]') === 0) && l.indexOf('favicon') < 0);
ok(errs.length === 0, '控制台无报错', errs.slice(0, 5));
if (logs.length) {
  console.log('  console 前 12 条：');
  logs.slice(0, 12).forEach((l) => console.log('   ', l.slice(0, 220)));
}

console.log('\n视觉验收：' + pass + ' 通过 / ' + fail + ' 失败，截图 → ' + OUT);
try { await send('Browser.close'); } catch (e) {}
try { ws.close(); } catch (e) {}
chrome.kill();
await sleep(300);
server.close();
process.exit(fail ? 1 : 0);
