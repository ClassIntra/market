// 拾光群岛 v5.2 —— 「一起玩」接口联调（隔离内存库，不碰生产）
// 覆盖：好友申请/同意/移除 · 悄悄话与节流 · 双人互动邀请/回应 · 羁绊累加
//        · 队伍聊天与集结 · 距离与离线校验 · social/state 结构
//
// 用法（必须系统 Node：better-sqlite3 是 ABI 137）：
//   NODE_PATH=D:/tmp/sg5node;<server/node_modules> \
//     "C:/Program Files/nodejs/node.exe" test/v5-social.mjs
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const NM = 'D:/NetWork/Integration/ClassIntra/server/node_modules/';
const SRC = 'D:/NetWork/Integration/market/apps/shiguang/backend/v5/';
const express = require(NM + 'express');
const app = express();
app.use(express.json({ limit: '1mb' }));
const routes = require(SRC + 'routes.js');
const store = require(SRC + 'store.js');
const SIM = require(SRC + 'sim.js');
const W = require(SRC + 'worldgen.js');
const world = W.get();
app.use('/api/shiguang', routes);
const server = app.listen(0);
const BASE = 'http://127.0.0.1:' + server.address().port + '/api/shiguang';

let pass = 0, fail = 0;
const bad = [];
function ok(cond, name, extra) {
  if (cond) pass++;
  else { fail++; bad.push(name + (extra === undefined ? '' : ' → ' + JSON.stringify(extra))); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function call(p, body, uid) {
  if (p.indexOf('/v5/sync') >= 0) await sleep(90);   // 服务端 60ms 节流
  const res = await fetch(BASE + p, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', 'x-uid': uid || '1001' },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  return res.json();
}

// 把玩家挪到指定坐标：改存档再重建在线态，不绕过任何游戏内距离校验
async function goTo(uid, x, y) {
  const rec = store.load(uid, { x, y });
  rec.x = x; rec.y = y;
  store.flush(uid);
  store.evict(uid);
  SIM.removePlayer(uid);
  return (await call('/v5/enter', {}, uid)).data;
}
const POS = { '1001': { x: world.town.cx + 0.5, y: world.town.cy + 0.2 }, '1002': { x: world.town.cx + 1.6, y: world.town.cy + 0.9 } };
async function sync(uid) {
  const p = POS[uid];
  return (await call('/v5/sync', { x: p.x, y: p.y, f: 0, mv: 0, mp: 40 }, uid)).data;
}
function hasEv(ev, k) { return (ev || []).some((e) => e.k === k); }

// ---------------- 进入 ----------------
await goTo('1001', POS['1001'].x, POS['1001'].y);
const e2 = await goTo('1002', POS['1002'].x, POS['1002'].y);
ok(e2.me.id === '1002', '第二个玩家进入世界', e2.me && e2.me.id);
ok(Array.isArray(e2.friends) && e2.friends.length === 0, '初始好友为空');
ok(Object.keys(e2.acts || {}).length === 6, '互动动作表 6 项', Object.keys(e2.acts || {}));
ok(e2.nearby.some((p) => p.u === '1001'), '附近的人能看到 1001', e2.nearby);
await sleep(120);

// ---------------- 好友 ----------------
const st1 = await call('/v5/social/state', undefined, '1002');
ok(st1.code === 200, 'social/state 返回 200');
ok(Array.isArray(st1.data.friends) && Array.isArray(st1.data.nearby), 'state 结构含好友/附近');
ok(['friends', 'req', 'nearby', 'whispers', 'act', 'invites'].every((k) => k in st1.data), 'state 字段齐全', Object.keys(st1.data));

let r = await call('/v5/friend/request', { to: '1002' }, '1001');
ok(r.code === 200, '发起好友申请', r.message);
ok(hasEv((await sync('1002')).ev, 'friend-req'), '对方收到好友申请事件');
ok(hasEv((await sync('1001')).ev, 'friend-sent'), '发起人收到回执');

r = await call('/v5/friend/accept', {}, '1002');
ok(r.code === 200, '接受好友申请', r.message);
ok(r.data.friends.length === 1 && r.data.friends[0].u === '1001', '好友名单写入', r.data.friends);
const f1 = (await call('/v5/social/state', undefined, '1001')).data;
ok(f1.friends.length === 1 && f1.friends[0].u === '1002', '双向好友（1001 侧）', f1.friends);
ok(f1.friends[0].bond >= 2, '成为朋友即建立初始羁绊', f1.friends[0] && f1.friends[0].bond);
ok(f1.friends[0].tier === '初识', '羁绊称号初始为初识', f1.friends[0] && f1.friends[0].tier);

r = await call('/v5/friend/request', { to: '1002' }, '1001');
ok(r.code === 400, '重复申请被拒绝', r.message);
r = await call('/v5/friend/request', { to: '1001' }, '1001');
ok(r.code === 400, '不能加自己', r.message);
r = await call('/v5/friend/request', { to: '999999' }, '1001');
ok(r.code === 400, '离线用户不能加', r.message);

// ---------------- 悄悄话 ----------------
r = await call('/v5/whisper', { to: '1002', text: '一起去草原吗' }, '1001');
ok(r.code === 200 && r.data.text === '一起去草原吗', '悄悄话送达', r.data);
const w2 = await sync('1002');
ok(hasEv(w2.ev, 'whisper'), '对方收到 whisper 事件');
const wev = (w2.ev || []).filter((e) => e.k === 'whisper')[0];
ok(wev && wev.text === '一起去草原吗' && wev.from === '1001', 'whisper 内容/发件人正确', wev);
const log1 = (await call('/v5/whisper/log', undefined, '1001')).data;
const log2 = (await call('/v5/whisper/log', undefined, '1002')).data;
ok(log1.list.length >= 1 && log2.list.length >= 1, '双方都有聊天记录', [log1.list.length, log2.list.length]);
ok(log2.list[log2.list.length - 1].self === 0, '接收方记录标为未自发', log2.list);
r = await call('/v5/whisper', { to: '1002', text: '   ' }, '1001');
ok(r.code === 400, '空白悄悄话被拒绝', r.message);
await sleep(950);   // 悄悄话 900ms 节流，别把限流误判成截断失败
const longText = 'a'.repeat(200);
r = await call('/v5/whisper', { to: '1002', text: longText }, '1001');
ok(r.code === 200 && r.data && r.data.text.length === 60, '超长文本截断到 60 字', r.data && r.data.text && r.data.text.length);
await sleep(950);
r = await call('/v5/whisper', { to: '1002', text: '带\n换\t行 和  多空格' }, '1001');
ok(r.code === 200 && r.data.text === '带 换 行 和 多空格', '控制字符被清洗', r.data.text);

// ---------------- 双人互动 ----------------
r = await call('/v5/social/act', { to: '1002', a: 'dance' }, '1001');
ok(r.code === 200, '发起互动邀请', r.message);
const a2 = await sync('1002');
ok(hasEv(a2.ev, 'act-invite'), '对方收到互动邀请');
const aev = (a2.ev || []).filter((e) => e.k === 'act-invite')[0];
ok(aev && aev.a === 'dance' && aev.an === '一起跳舞', '互动邀请带动作名', aev);
ok((await call('/v5/social/state', undefined, '1002')).data.act !== null, 'state 里能看到待回应邀请');

const beforeBond = (await call('/v5/social/state', undefined, '1001')).data.friends[0].bond;
r = await call('/v5/social/act', { to: '1001', a: 'dance', accept: 1 }, '1002');
ok(r.code === 200 && r.data.bond === 4, '回应互动成功并给出羁绊增量', r.data);
const after1 = await sync('1001');
const after2 = await sync('1002');
ok(hasEv(after1.ev, 'act-done') && hasEv(after2.ev, 'act-done'), '双方都收到成立回执');
const bond2 = (await call('/v5/social/state', undefined, '1002')).data.friends[0].bond;
ok(bond2 === beforeBond + 4, '羁绊按动作增加', { beforeBond, bond2 });
r = await call('/v5/social/act', { to: '1002', a: 'nope' }, '1001');
ok(r.code === 400, '不存在的动作被拒绝', r.message);
await sleep(2600);
r = await call('/v5/social/act', { to: '1002', a: 'dance', accept: 1 }, '1001');
ok(r.code === 400, '没有邀请时不能凭空回应', r.message);

// 距离校验：把 1002 挪到 12 格外
POS['1002'] = { x: world.town.cx + 12.5, y: world.town.cy + 0.5 };
await goTo('1002', POS['1002'].x, POS['1002'].y);
r = await call('/v5/social/act', { to: '1002', a: 'highfive' }, '1001');
ok(r.code === 400, '距离过远不能互动', r.message);
r = await call('/v5/friend/request', { to: '1002' }, '1001');
ok(r.code === 400, '已是好友不会重复申请', r.message);
POS['1002'] = { x: world.town.cx + 1.6, y: world.town.cy + 0.9 };
await goTo('1002', POS['1002'].x, POS['1002'].y);

// ---------------- 队伍 ----------------
r = await call('/v5/party/invite', { to: '1002' }, '1001');
ok(r.code === 200, '发起组队邀请', r.message);
await sync('1002');
r = await call('/v5/party/accept', {}, '1002');
ok(r.code === 200 && r.data.party.members.length === 2, '加入队伍成功', r.data.party && r.data.party.members);
r = await call('/v5/party/say', { text: '灯塔集合' }, '1001');
ok(r.code === 200, '队伍发言', r.message);
const pc2 = await sync('1002');
ok(hasEv(pc2.ev, 'party-chat'), '队友收到队伍聊天');
r = await call('/v5/party/rally', {}, '1002');
ok(r.code === 400, '非队长不能发起集结', r.message);
r = await call('/v5/party/rally', {}, '1001');
ok(r.code === 200 && r.data.count === 1, '队长发起集结', r.data);
ok(hasEv((await sync('1002')).ev, 'rally'), '队友收到集合点');

// ---------------- 移除 ----------------
r = await call('/v5/friend/remove', { to: '1002' }, '1001');
ok(r.code === 200 && r.data.friends.length === 0, '移除好友', r.data.friends);
const f2 = (await call('/v5/social/state', undefined, '1002')).data;
ok(f2.friends.length === 0, '双向移除生效', f2.friends);

// ---------------- 收尾 ----------------
await call('/v5/leave', {}, '1001');
await call('/v5/leave', {}, '1002');
console.log('\n拾光群岛 v5.2 社交联调：' + pass + ' 通过 / ' + fail + ' 失败');
if (bad.length) { console.log('失败项：'); bad.forEach((b) => console.log(' - ' + b)); }
server.close();
process.exit(fail ? 1 : 0);
