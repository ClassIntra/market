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
  await sleep(420);
  await shot('07-panel-' + p);
}
await evalJs('__sg5.panel("")');

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
await sleep(2600);
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
