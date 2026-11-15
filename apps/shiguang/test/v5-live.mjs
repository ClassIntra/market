// 拾光群岛 v5 —— 生产实例真浏览器验收（9001）
//
// 与 v5-visual.mjs 的区别：那个跑在自制宿主替身里，证明「代码本身能跑」；
// 这个直接进真实 ClassIntra：真 cookie、真 SDK、真路由、真 static。
//
// 用法：node test/v5-live.mjs [--shot 名字]
//   前置：9001 在跑，应用已安装且启用；server/.env 有 JWT_SECRET。
import { spawn } from 'node:child_process';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { setTimeout as sleep } from 'node:timers/promises';

const REPO = 'D:/NetWork/Integration/ClassIntra';
const BASE = 'http://127.0.0.1:9001';
const OUT = 'D:/tmp/sg5-live';
const CDP_PORT = 9600 + Math.floor(Math.random() * 200);
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const UID = process.env.SG5_UID || '251800';
const TOKEN_TAG = 'live' + Date.now();

mkdirSync(OUT, { recursive: true });

const require = createRequire(REPO + '/server/node_modules/');
const jwt = require('jsonwebtoken');
let SECRET = '';
for (const line of readFileSync(REPO + '/server/.env', 'utf8').split(/\r?\n/)) {
  const m = /^\s*JWT_SECRET\s*=\s*(.*)$/.exec(line);
  if (m) { SECRET = m[1].trim().replace(/^["']|["']$/g, ''); break; }
}
if (!SECRET) { console.error('server/.env 里没有 JWT_SECRET'); process.exit(1); }
const token = jwt.sign({ user_id: UID }, SECRET, { expiresIn: '2h' });

const chrome = spawn(CHROME, [
  '--headless=new',
  `--remote-debugging-port=${CDP_PORT}`,
  `--user-data-dir=${OUT}/profile-${Date.now()}`,
  '--no-first-run', '--no-default-browser-check', '--disable-extensions',
  '--disable-gpu', '--mute-audio', '--autoplay-policy=no-user-gesture-required',
  '--window-size=1180,780', 'about:blank'
], { stdio: 'ignore' });

const getJSON = async (p) => (await fetch(`http://127.0.0.1:${CDP_PORT}${p}`)).json();
let page = null;
for (let i = 0; i < 80; i++) {
  try {
    const list = await getJSON('/json/list');
    page = list.find((t) => t.type === 'page');
    if (page) break;
  } catch (e) {}
  await sleep(400);
}
if (!page) { console.error('Chrome 未启动'); process.exit(1); }

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
    const args = (m.params.args || []).map((a) => (a.value !== undefined ? a.value : a.description || a.type)).join(' ');
    logs.push('[' + m.params.type + '] ' + args);
  } else if (m.method === 'Runtime.exceptionThrown') {
    const d = m.params.exceptionDetails;
    logs.push('[exception] ' + (d.exception ? d.exception.description : d.text));
  } else if (m.method === 'Log.entryAdded') {
    const e = m.params.entry;
    if (e.level === 'error' && e.url && e.url.indexOf('favicon') >= 0) return;
    logs.push('[' + e.level + '] ' + e.text + (e.url ? ' @' + e.url : ''));
  }
};
function send(method, params) {
  const id = ++msgId;
  return new Promise((res, rej) => { pending.set(id, { res, rej }); ws.send(JSON.stringify({ id, method, params: params || {} })); });
}
async function evalJs(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) return { err: (r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text };
  return { v: r.result && r.result.value };
}
async function shot(name) {
  const r = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(OUT + '/' + name + '.png', Buffer.from(r.data, 'base64'));
  console.log('  shot →', name + '.png');
}

let pass = 0, fail = 0;
function ok(c, n, extra) { if (c) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗', n, extra === undefined ? '' : JSON.stringify(extra).slice(0, 300)); } }

await send('Runtime.enable');
await send('Log.enable');
await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1180, height: 780, deviceScaleFactor: 1, mobile: false });
await send('Network.enable');
await send('Network.setCookie', { name: 'token', value: token, url: BASE, path: '/' });

// 真实前端的登录态是「cookie + localStorage 双份」：路由守卫只看 localStorage.token。
// 少了这一份，页面会安静地跳到 /login —— 看起来像「应用没装」。
const meRes = await fetch(BASE + '/api/auth/check-status', { headers: { Authorization: 'Bearer ' + token } });
const meJson = await meRes.json();
const userInfo = meJson && meJson.data && meJson.data.user_info;
if (!userInfo) { console.error('check-status 失败：', JSON.stringify(meJson).slice(0, 200)); process.exit(1); }

await send('Page.navigate', { url: BASE + '/login' });
await sleep(900);
await evalJs('localStorage.setItem("token", ' + JSON.stringify(token) + ');'
  + 'localStorage.setItem("user", ' + JSON.stringify(JSON.stringify(userInfo)) + '); 1');
await send('Page.navigate', { url: BASE + '/shiguang?probe=' + TOKEN_TAG });
await sleep(1800);

let ready = false;
for (let i = 0; i < 60; i++) {
  const r = await evalJs('!!(window.__sg5 && window.__sg5.state && window.__sg5.state.ready)');
  if (r.v) { ready = true; break; }
  await sleep(400);
}
ok(ready, '真实宿主里世界载入完成（__sg5.state.ready）');
await sleep(1200);
await shot('live-01');

const st = await evalJs('JSON.stringify({zone:__sg5.state.zone, x:Math.round(__sg5.state.me.x), y:Math.round(__sg5.state.me.y), lv:__sg5.state.me.lv, hp:__sg5.state.me.hp, mobs:Object.keys(__sg5.state.mobs).length, towers:Object.keys(__sg5.state.towers).length})');
console.log('  state:', st.v);
let parsed = null;
try { parsed = JSON.parse(st.v); } catch (e) {}
ok(parsed && parsed.lv >= 1 && parsed.hp > 0, '角色数据来自真实后端', parsed);

// 走两步 + 打一下，验证真实 API 链路
await evalJs('__sg5.attack()');
await sleep(220);
await evalJs('__sg5.roll()');
await sleep(300);
await shot('live-02');
const after = await evalJs('JSON.stringify({x:Math.round(__sg5.state.me.x), hp:__sg5.state.me.hp, parts:__sg5.state.parts.length})');
console.log('  after input:', after.v);

// 面板
await evalJs('__sg5.panel("char")');
await sleep(500);
await shot('live-03-char');
await evalJs('__sg5.panel("")');

// /api/market/dev-preview 的 403 是宿主自己的「开发预览未开启」探测，与本应用无关
const errs = logs.filter((l) => (l.indexOf('[error]') === 0 || l.indexOf('[exception]') === 0)
  && l.indexOf('dev-preview') < 0);
ok(errs.length === 0, '真实宿主控制台无报错', errs.slice(0, 4));
if (logs.length) {
  console.log('  console:');
  logs.slice(0, 10).forEach((l) => console.log('   ', l.slice(0, 200)));
}

console.log('\n生产实例验收：' + pass + ' 通过 / ' + fail + ' 失败，截图 → ' + OUT);
try { await send('Browser.close'); } catch (e) {}
chrome.kill();
process.exit(fail ? 1 : 0);
