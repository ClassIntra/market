// 拾光群岛 v5.6 W1 —— 稳定性验收（真浏览器 CDP）
//
// 三组断言（主理人定死）：
//   A. 异常注入存活：mock 一个每帧函数（canvas 2d fillRect）抛错，断言主循环继续走
//      （[sg5-loop] 进 console.error，S.time 照常推进，rAF 链不断）
//   B. 实体预算：parts≤400 / texts≤60 / orbs≤320 / corpses≤24，超限 shift 最旧
//   C. 竞态守卫：farmAct 在途时狂点 —— 服务端扣减次数 = 有效操作数（丢弃不排队）
//
// 用法：SG5_APP=<应用目录> NODE_PATH=<server/node_modules> node test/v5-stability.mjs
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, extname } from 'node:path';
import { createRequire } from 'node:module';
import { setTimeout as sleep } from 'node:timers/promises';

const require = createRequire(import.meta.url);
const NM = 'D:/NetWork/Integration/ClassIntra/server/node_modules/';
const APP = process.env.SG5_APP || 'D:/NetWork/Integration/market/apps/shiguang';
const SRC = APP + '/backend/v5/';
const HTTP_PORT = 8700 + Math.floor(Math.random() * 200);
const CDP_PORT = 9600 + Math.floor(Math.random() * 200);
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const VW = 1100, VH = 700;

const express = require(NM + 'express');
const routes = require(SRC + 'routes.js');
const store = require(SRC + 'store.js');
const SIM = require(SRC + 'sim.js');
const W = require(SRC + 'worldgen.js');
const world = W.get();

const MIME = {
  '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.json': 'application/json; charset=utf-8',
  '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.woff2': 'font/woff2', '.svg': 'image/svg+xml'
};
const app = express();
app.use(express.json({ limit: '2mb' }));
app.use('/api/shiguang', routes);
app.use('/app', express.static(APP, { etag: false, maxAge: 0 }));

app.get('/', (req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(`<!doctype html><html><head><meta charset="utf-8">
<title>sg5 稳定性验收</title><link rel="stylesheet" href="/app/frontend/style.css">
<style>html,body{margin:0;height:100%;background:#070a14;overflow:hidden}
#stage{position:absolute;left:0;top:0;width:100%;height:100%}</style></head>
<body><div id="stage"></div><script>
window.ClassIntraMarket = { define: function (d) { window.__def = d; } };
window.__ctx = {
  data: {
    api: {
      get: function (p) { return fetch('/api' + p).then(function (r) { return r.json(); }).then(function (j) { return { data: j }; }); },
      post: function (p, b) { return fetch('/api' + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b || {}) }).then(function (r) { return r.json(); }).then(function (j) { return { data: j }; }); }
    },
    storage: (function () { var mem = {}; return { get: function (k, d) { return mem[k] === undefined ? d : mem[k]; }, set: function (k, v) { mem[k] = v; } }; })(),
    realtime: { subscribe: function () { return function () {}; } }
  },
  system: { role: 'student', can: function () { return true; } },
  app: { assetUrl: function (p) { return '/app/' + p; }, onDestroy: function (fn) { (window.__cleanup = window.__cleanup || []).push(fn); } }
};
</script><script src="/app/frontend/entry.js"></script>
<script>window.__bootErr='';try{window.__def.mount(document.getElementById('stage'),window.__ctx)}catch(e){window.__bootErr=String(e&&e.stack||e)}</script>
</body></html>`);
});

const server = createServer(app);
await new Promise((r) => server.listen(HTTP_PORT, '127.0.0.1', r));

const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${CDP_PORT}`,
  `--user-data-dir=D:/tmp/sg5-stab-profile-${Date.now()}`,
  '--no-first-run', '--no-default-browser-check', '--disable-extensions',
  '--disable-gpu', '--mute-audio', '--autoplay-policy=no-user-gesture-required',
  `--window-size=${VW},${VH}`, `http://127.0.0.1:${HTTP_PORT}/`
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
await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: VW, height: VH, deviceScaleFactor: 1, mobile: false });

async function evalJs(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) return { err: r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception && r.exceptionDetails.exception.description || '') };
  return { v: r.result && r.result.value };
}
async function waitFor(expr, timeout, label) {
  const t0 = Date.now();
  for (;;) {
    const r = await evalJs(expr);
    if (!r.err && r.v) return true;
    if (Date.now() - t0 > (timeout || 8000)) { console.log('  waitFor 超时:', label || expr); return false; }
    await sleep(200);
  }
}

let pass = 0, fail = 0;
function ok(c, n, extra) { if (c) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗', n, extra === undefined ? '' : JSON.stringify(extra).slice(0, 300)); } }

// ---------- 载入 ----------
let ready = false;
for (let i = 0; i < 50; i++) {
  const r = await evalJs('!!(window.__sg5 && window.__sg5.state.ready)');
  if (r.v) { ready = true; break; }
  await sleep(400);
}
const bootErr = await evalJs('window.__bootErr || ""');
ok(!bootErr.v, '入口无异常', bootErr.v);
ok(ready, '世界载入完成（ready）');
await evalJs('__sg5.lockPhase("day", 0.32)');

// ---------------- A. 异常注入存活 ----------------
console.log('\n== A. 主循环异常保护 ==');
const t0 = await evalJs('__sg5.state.time');
// mock 每帧函数抛错：renderWorld 大量调用 ctx.fillRect，逐帧必中
await evalJs('(function(){var c=document.querySelector(".sg5-cv");var g=c.getContext("2d");window.__origFill=g.fillRect.bind(g);g.fillRect=function(){throw new Error("sg5-inject-boom")};return 1})()');
await sleep(700);
await evalJs('(function(){var c=document.querySelector(".sg5-cv");c.getContext("2d").fillRect=window.__origFill;return 1})()');
await sleep(500);
const t1 = await evalJs('__sg5.state.time');
const loopErrs = logs.filter((l) => l.indexOf('[error]') === 0 && l.indexOf('[sg5-loop]') >= 0);
ok(loopErrs.length >= 1, '异常被主循环捕获并记录 [sg5-loop]', loopErrs.slice(0, 2));
ok(Number(t1.v) > Number(t0.v) + 0.5, '注入期间与恢复后主循环仍在推进（rAF 链未断）', { t0: t0.v, t1: t1.v });
ok(ready && !evalJs('window.__bootErr').err, '页面没有崩');

// ---------------- B. 实体预算 ----------------
console.log('\n== B. 实体预算 ==');
await evalJs('(function(){var S=window.__sg5.state;for(var i=0;i<460;i++)S.parts.push({x:0,y:0,vx:0,vy:0,life:9,max:9,col:"#fff",r:1});for(var j=0;j<100;j++)S.texts.push({x:0,y:0,txt:"x",life:9,max:9});for(var k=0;k<360;k++)S.orbs.push({x:0,y:0,phase:"fade",t:9,v:1,tier:0});for(var m=0;m<30;m++)S.corpses.push({x:0,y:0,t:0});return 1})()');
// 手动驱动若干帧（__sg5.tick），预算兜底立刻生效
await evalJs('__sg5.tick(200)');
const cap = await evalJs('JSON.stringify({parts:window.__sg5.state.parts.length,texts:window.__sg5.state.texts.length,orbs:window.__sg5.state.orbs.length,corpses:window.__sg5.state.corpses.length})');
const C2 = JSON.parse(cap.v);
ok(C2.parts <= 400, 'parts ≤ 400', C2.parts);
ok(C2.texts <= 60, 'texts ≤ 60', C2.texts);
ok(C2.orbs <= 320, 'orbs ≤ 320', C2.orbs);
ok(C2.corpses <= 24, 'corpses ≤ 24', C2.corpses);

// ---------------- C. 竞态守卫 ----------------
console.log('\n== C. farmAct 竞态（丢弃不排队） ==');
// 打开农场面板（面板开着才会 refreshPanel，farmAct 不依赖面板，直接调即可）
const st0 = await fetch(`http://127.0.0.1:${HTTP_PORT}/api/shiguang/v5/farm/state`, { headers: { 'x-uid': '1001' } }).then((r) => r.json());
const energy0 = st0.data.farm.energy;
// 把 api.post 包一层 250ms 延迟：制造「在途」窗口
await evalJs(`(function(){
  var S = window.__sg5.state;
  var orig = S.api.post.bind(S.api);
  window.__postLog = [];
  S.api.post = function (p, b) {
    if (p.indexOf('/v5/farm/till') >= 0) {
      window.__postLog.push(p);
      return new Promise(function (res) {
        setTimeout(function () { orig(p, b).then(res, res); }, 250);
      });
    }
    return orig(p, b);
  };
  return 1;
})()`);
// 在途狂点 8 次：只有第 1 次真正发出
await evalJs(`(function(){
  var F = window.__sg5.farm;
  for (var i = 0; i < 8; i++) { F.act('till', { r: 7, c: 7 }); }
  return 1;
})()`);
await sleep(600);
const postLog = await evalJs('JSON.stringify(window.__postLog)');
const nPosted = JSON.parse(postLog.v).length;
ok(nPosted === 1, '在途期间 8 次点击只有 1 次真正发出', postLog.v);
const st1 = await fetch(`http://127.0.0.1:${HTTP_PORT}/api/shiguang/v5/farm/state`, { headers: { 'x-uid': '1001' } }).then((r) => r.json());
const energy1 = st1.data.farm.energy;
ok(energy0 - energy1 === 2, '服务端体力扣减 = 有效操作数（1 次 ×2 体力）', { energy0: energy0, energy1: energy1 });
// 锁释放后再点：能正常发出
await evalJs(`(function(){window.__sg5.farm.act('till',{r:7,c:8});return 1})()`);
await sleep(600);
const postLog2 = await evalJs('JSON.stringify(window.__postLog)');
ok(JSON.parse(postLog2.v).length === 2, '锁释放后新操作正常放行', postLog2.v);
const st2 = await fetch(`http://127.0.0.1:${HTTP_PORT}/api/shiguang/v5/farm/state`, { headers: { 'x-uid': '1001' } }).then((r) => r.json());
ok(st2.data.farm.energy === energy1 - 2, '第二笔正常扣减', { energy: st2.data.farm.energy });
// 清理：撤掉 api 包装
await evalJs('(function(){delete window.__sg5.state.api.post;return 1})()');

// ---------------- 控制台 ----------
const errs = logs.filter((l) => (l.indexOf('[error]') === 0 || l.indexOf('[exception]') === 0) && l.indexOf('[sg5-loop]') < 0 && l.indexOf('favicon') < 0);
ok(errs.length === 0, '除注入项外控制台无报错', errs.slice(0, 5));

console.log('\n稳定性验收：' + pass + ' 通过 / ' + fail + ' 失败');
try { await send('Browser.close'); } catch (e) {}
try { ws.close(); } catch (e) {}
chrome.kill();
await sleep(300);
server.close();
process.exit(fail ? 1 : 0);
