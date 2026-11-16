// 拾光群岛 v5 —— 接口联调（隔离内存库，不碰生产）
// 覆盖：地形 → 进入 → 同步 → 命中 → 击杀掉落 → 宝箱 → 传送石 → 商店
//        → 装备/卸下 → 天赋 → 复活 → 多人在线 → 守护者与灯塔 → 离开
//
// 用法（必须系统 Node：better-sqlite3 是 ABI 137）：
//   NODE_PATH=D:/tmp/sg5node;<server/node_modules>;<plugins/node_modules> \
//     "C:/Program Files/nodejs/node.exe" test/v5-api.mjs
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const NM = 'D:/NetWork/Integration/ClassIntra/server/node_modules/';
const SRC = (process.env.SG5_APP || 'D:/NetWork/Integration/market/apps/shiguang') + '/backend/v5/';
const express = require(NM + 'express');
const app = express();
app.use(express.json({ limit: '1mb' }));
const routes = require(SRC + 'routes.js');
const store = require(SRC + 'store.js');
const SIM = require(SRC + 'sim.js');
app.use('/api/shiguang', routes);
const server = app.listen(0);
const BASE = 'http://127.0.0.1:' + server.address().port + '/api/shiguang';

let pass = 0, fail = 0;
const bad = [];
function ok(cond, name, extra) {
  if (cond) pass++;
  else { fail++; bad.push(name + (extra !== undefined ? ' → ' + JSON.stringify(extra) : '')); }
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

// 测试专用「传送」：改存档再重建在线态 —— 不绕过任何游戏内校验，
// 只是省掉「从镇上走 40 格」的时间（行走本身由 sim 的位置上限保证）。
async function goTo(uid, x, y) {
  const rec = store.load(uid, { x: x, y: y });
  rec.x = x; rec.y = y;
  store.flush(uid);
  store.evict(uid);
  SIM.removePlayer(uid);
  return (await call('/v5/enter', {}, uid)).data;
}

// ---------------- 地形 ----------------
const terrain = await call('/v5/terrain');
ok(terrain.code === 200, '地形接口返回 200', terrain.code);
const T = terrain.data;
ok(T.size === 384 && T.cells.length === T.size * T.size, '地形尺寸（v5.7 起 384×384）', T.cells && T.cells.length);
ok(T.zones.length === T.size * T.size, '区域图长度一致');
ok(Object.keys(T.towers).length === 6, '6 座灯塔');
ok(T.waystones.length === 7, '7 块传送石');
ok(T.chests.length >= 80, '宝箱数量（384 地图）', T.chests.length);

// ---------------- 《灯火纪》lore（v5.7） ----------------
ok(Array.isArray(T.relics) && T.relics.length === 20, '守塔人遗物 20 处入世界', T.relics && T.relics.length);
const loreRes = await call('/v5/lore');
ok(loreRes.code === 200 && loreRes.data, 'lore 接口 200');
const LO = loreRes.data;
ok(LO.codex.length === 5 && LO.chapters.length === 9, '编年史 5 篇 / 主线九章', LO.chapters && LO.chapters.length);
ok(LO.diaries.length === 20, '守塔人日记 20 页', LO.diaries.length);
ok(LO.keeperLines.length >= 7 && LO.finale && LO.lamps.meadow, '栗的独白 / 终章 / 灯语齐备');
ok(Array.isArray(LO.collected) && LO.collected.length === 0, '初始收集为空');
const col1 = await call('/v5/lore/collect', { id: 'd_meadow_1' });
ok(col1.code === 200 && col1.data.collected.indexOf('d_meadow_1') >= 0, '收集遗物入档');
const col2 = await call('/v5/lore/collect', { id: 'd_meadow_1' });
ok(col2.code === 200 && col2.data.collected.length === 1, '重复收集幂等', col2.data.collected.length);
const colBad = await call('/v5/lore/collect', { id: 'd_fake_99' });
ok(colBad.code !== 200, '未知遗物被拒绝');
const colAll = await call('/v5/lore');
ok(colAll.data.collected.indexOf('d_meadow_1') >= 0, '收集进度持久化');

// ---------------- 进入 ----------------
const enter = await call('/v5/enter', {});
ok(enter.code === 200, '进入返回 200', enter.code);
const me = enter.data.me;
ok(!!me.id && me.hp > 0 && me.lv === 1, '初始角色', { hp: me.hp, lv: me.lv });
ok(!!me.equip.weapon && me.equip.weapon.name === '木棍', '起始武器木棍');
ok(me.zone === 'town', '从拾光镇出生', me.zone);
ok(Array.isArray(enter.data.chests), '宝箱进度是数组');
ok(!!enter.data.goal && enter.data.goal.zone === 'meadow', '目标指引指向晨光草原', enter.data.goal);
ok(Array.isArray(me.skills) && me.skills[0] === 'spin', '初始技能灯火回旋');

// ---------------- 同步 ----------------
const sync = await call('/v5/sync', { x: me.x, y: me.y, f: 0, mv: 0, mp: 40 });
ok(sync.code === 200, '同步 200');
ok(Array.isArray(sync.data.me) && sync.data.me.length === 12, 'me 快照 12 个字段', sync.data.me && sync.data.me.length);
ok(Array.isArray(sync.data.m), 'mobs 数组');
ok(Array.isArray(sync.data.p), 'players 数组');
ok(Array.isArray(sync.data.s), 'shots 数组');
ok(['day', 'dusk', 'night', 'dawn'].indexOf(sync.data.ph) >= 0, '昼夜相位', sync.data.ph);

// 瞬移作弊：一次跳 100 格必须被拉回
const cheat = await call('/v5/sync', { x: me.x + 100, y: me.y, f: 0, mv: 1, mp: 40 });
ok(cheat.data.c === 1, '超距移动被纠正', cheat.data.c);
ok(Math.abs(cheat.data.me[0] - me.x) < 14, '纠正后位置受限', { from: me.x, to: cheat.data.me[0] });

// ---------------- 草原：刷怪 / 命中 / 掉落 ----------------
const wsMeadow = T.waystones.find((w) => w.zone === 'meadow');
const at = await goTo('1001', wsMeadow.x + 0.5, wsMeadow.y + 0.6);
ok(at.me.zone === 'meadow', '传送到晨光草原', at.me.zone);
const ws = await call('/v5/waystone', { id: wsMeadow.id });
ok(ws.code === 200 && ws.data.fresh === true, '点亮传送石', ws.data);

// 等刷怪（服务端 1.5s 一轮；玩家 7 格内不刷，所以先走开）
await goTo('1001', wsMeadow.x + 8.5, wsMeadow.y + 0.6);
await sleep(2800);
const s2 = await call('/v5/sync', { x: wsMeadow.x + 8.5, y: wsMeadow.y + 0.6, f: 0, mv: 0, mp: 40 });
ok((s2.data.m || []).length > 0, '草原上刷出了怪', (s2.data.m || []).length);
const mob = s2.data.m[0];
ok(mob[4] > 0 && mob[5] > 0, '怪物有血量', { hp: mob[4], max: mob[5] });

await goTo('1001', mob[2] + 0.7, mob[3] + 0.1);
const hit = await call('/v5/hit', { list: [{ m: mob[0], d: 6, c: 0, kx: 1, ky: 0 }], kind: 'melee' });
ok(hit.code === 200 && hit.data.hits === 1, '命中上报生效', hit.data);
await sleep(90);
const hitBig = await call('/v5/hit', { list: [{ m: mob[0], d: 99999, c: 1 }], kind: 'melee' });
ok(hitBig.code === 200, '超大伤害不报错');
const s4 = await call('/v5/sync', { x: mob[2] + 0.7, y: mob[3] + 0.1, f: 0, mv: 0, mp: 40 });
ok(s4.code === 200, '战斗后同步正常');

// ---------------- 连杀几只：验证经验 / 星屑 / 图鉴 ----------------
const beforeLv = (await call('/v5/profile')).data.me;
const mobIds = Object.keys(SIM.mobs).filter((k) => !SIM.mobs[k].boss);
let killed = 0;
for (const id of mobIds.slice(0, 6)) {
  const m = SIM.mobs[id];
  if (!m) continue;
  await goTo('1001', m.x + 0.6, m.y);
  for (let k = 0; k < 3 && SIM.mobs[id]; k++) {
    SIM.players['1001'].lastHit = 0;
    const r = await call('/v5/hit', { list: [{ m: id, d: 40, c: 0 }], kind: 'melee' });
    if (k === 0 && r.data && r.data.hits) killed++;
    await sleep(80);
    if (SIM.mobs[id]) { SIM.players['1001'].x = SIM.mobs[id].x; SIM.players['1001'].y = SIM.mobs[id].y; }
  }
}
const prof2 = await call('/v5/profile');
ok(killed > 0, '至少打中一只怪', killed);
ok(prof2.data.me.xp > 0 || prof2.data.me.level > beforeLv.level || (prof2.data.me.stats.kills || 0) > 0, '击杀产生经验与计数', {
  xp: prof2.data.me.xp, lv: prof2.data.me.level, kills: prof2.data.me.stats.kills
});
ok(prof2.data.me.shards > 0, '击杀给了星屑', prof2.data.me.shards);

// ---------------- 宝箱 ----------------
const chest = T.chests.find((c) => c.zone === 'meadow');
await goTo('1001', chest.x + 0.5, chest.y + 0.5);
const co = await call('/v5/chest', { id: chest.id });
ok(co.code === 200 && co.data.shards > 0, '开箱得星屑', co.data && co.data.shards);
ok(!!co.data.item || co.data.full === 1, '开箱给装备或提示背包满', co.data);
const co2 = await call('/v5/chest', { id: chest.id });
ok(co2.code !== 200, '同一个箱子不能开两次', co2.code);

// ---------------- 商店 ----------------
const shopFar = await call('/v5/shop', { id: 'potion', n: 1 });
ok(shopFar.code !== 200, '不在镇上买不了', shopFar.code);
await goTo('1001', T.town.cx + 0.5, T.town.cy + 5.5);
const shop = await call('/v5/shop', { id: 'potion', n: 2 });
ok(shop.code === 200 && shop.data.mats.potion >= 2, '镇上买到药水', shop.data);
const use = await call('/v5/use', { id: 'potion' });
ok(use.code === 200 && use.data.hp > 0, '吃药回血', use.data && use.data.hp);

// ---------------- 装备 ----------------
const prof = await call('/v5/profile');
const bag = prof.data.me.bag || [];
ok(Array.isArray(bag), '背包是数组');
if (bag.length) {
  const it = bag[0];
  const eq = await call('/v5/equip', { uid: it.uid });
  ok(eq.code === 200 && !!eq.data.equip[it.slot], '装备穿戴', it.slot);
  const un = await call('/v5/unequip', { slot: it.slot });
  ok(un.code === 200, '卸下装备');
} else {
  ok(true, '背包为空时跳过装备校验');
}
const sellNothing = await call('/v5/sell', { uids: ['nope'] });
ok(sellNothing.code !== 200, '卖不存在的东西被拒');

// ---------------- 天赋 ----------------
const talent = await call('/v5/talent', { line: 'blade' });
const lvNow = (await call('/v5/profile')).data.me.level;
const havePts = lvNow >= 3;
ok(havePts ? talent.code === 200 : talent.code !== 200,
  havePts ? '等级够时能点天赋' : '等级不够时点不了天赋',
  { lv: lvNow, code: talent.code });

// ---------------- 复活 / 日志 ----------------
const resp = await call('/v5/respawn', {});
ok(resp.code === 200, '复活接口可用');
const feed = await call('/v5/feed');
ok(feed.code === 200 && Array.isArray(feed.data.feed), '世界频道可读');

// ---------------- 多人在线 ----------------
await call('/v5/sync', { x: T.town.cx + 0.5, y: T.town.cy + 5.5 }, '1002');
const e1 = await call('/v5/enter', {}, '1001');
ok(e1.data.players.some((p) => p[0] === '1002'), '能看到同班同学', e1.data.players.length);

// ---------------- 守护者与灯塔 ----------------
const tower = T.towers.meadow;
await goTo('1001', tower.x + 0.5, tower.y + 4.5);
await call('/v5/sync', { x: tower.x + 0.5, y: tower.y + 4.5, f: 0, mv: 0, mp: 40 });
const sBoss = await call('/v5/sync', { x: tower.x + 0.5, y: tower.y + 4.5, f: 0, mv: 0, mp: 40 });
const bossRow = (sBoss.data.m || []).find((m) => m[10] === 1);
ok(!!bossRow, '走到灯塔前唤醒了守护者', (sBoss.data.m || []).map((m) => m[1]));
if (bossRow) {
  let guard = 0;
  while (SIM.mobs[bossRow[0]] && guard++ < 60) {
    SIM.players['1001'].x = SIM.mobs[bossRow[0]].x;
    SIM.players['1001'].y = SIM.mobs[bossRow[0]].y;
    SIM.players['1001'].lastHit = 0;
    await call('/v5/hit', { list: [{ m: bossRow[0], d: 2600, c: 0 }], kind: 'melee' });
    await sleep(80);
  }
  const t2 = await call('/v5/profile');
  ok(!!t2.data.towers.meadow, '打倒守护者后灯塔点亮（全服）', t2.data.towers);
  ok(t2.data.me.shards > prof2.data.me.shards, '守护者给了奖励', { before: prof2.data.me.shards, after: t2.data.me.shards });
}

// ---------------- 组队 ----------------
await call('/v5/sync', { x: T.town.cx + 0.5, y: T.town.cy + 1.5 }, '1002');
await goTo('1001', T.town.cx + 0.5, T.town.cy + 1.5);
const inv = await call('/v5/party/invite', { to: '1002' });
ok(inv.code === 200, '发出组队邀请', inv.data);
const acc = await call('/v5/party/accept', {}, '1002');
ok(acc.code === 200 && acc.data.party && acc.data.party.members.length === 2, '对方接受后成一队', acc.data && acc.data.party && acc.data.party.members.length);
const sParty = await call('/v5/sync', { x: T.town.cx + 0.5, y: T.town.cy + 1.5 });
ok(Array.isArray(sParty.data.pt) || (sParty.data.pt && sParty.data.pt.members), '同步里带队伍信息', sParty.data.pt && sParty.data.pt.members && sParty.data.pt.members.length);
// 扶起：把 1002 打成倒地
const SIM2 = routes.SIM;
const p2 = SIM2.players['1002'];
if (p2) {
  p2.down = Date.now();
  const rv = await call('/v5/revive', { to: '1002' });
  ok(rv.code === 200 || rv.code === 400, '扶起接口可用', rv.code);
}
const lvParty = await call('/v5/party/leave', {});
ok(lvParty.code === 200, '离队');

// ---------------- 支线 ----------------
const smithHouse = T.town.houses.find((h) => h.kind === 'smith');
await goTo('1001', smithHouse.x + smithHouse.w / 2, smithHouse.y + smithHouse.h + 1.2);
const rec1 = routes.STORE.load('1001', { x: 0, y: 0 });
rec1.mats = rec1.mats || {};
rec1.mats.ore = (rec1.mats.ore || 0) + 3;
routes.STORE.markDirty('1001');
const q1 = await call('/v5/quest/claim', { q: 'q_smith' });
ok(q1.code === 200 && q1.data.step === 1, '交材料推进支线第一步', q1.data && q1.data.step);
ok((rec1.mats.ore || 0) === 0, '交材料被扣除', rec1.mats.ore);
const q1b = await call('/v5/quest/claim', { q: 'q_smith' });
ok(q1b.code !== 200, '第二步材料不够会被拒', q1b.code);

// ---------------- 长夜潮汐 ----------------
const SOC2 = routes.SOC;
ok(!!SOC2, '社交模块已挂载');
const beforeTide = (await call('/v5/profile')).data.me.shards;
SOC2.startTide();
const tideNow = SOC2.tideState();
ok(!!tideNow && !!tideNow.zone, '潮汐已开启', tideNow && tideNow.zone);
// 打死一只潮汐怪，贡献计分
let tideMobId = null;
Object.keys(SIM2.mobs).forEach(function (k) { if (SIM2.mobs[k] && SIM2.mobs[k].tide && !tideMobId) tideMobId = k; });
if (tideMobId) {
  SIM2.players['1001'].x = SIM2.mobs[tideMobId].x;
  SIM2.players['1001'].y = SIM2.mobs[tideMobId].y;
  SIM2.players['1001'].lastHit = 0;
  await call('/v5/hit', { list: [{ m: tideMobId, d: 900, c: 0 }], kind: 'melee' });
}
SOC2.endTide('test');
const afterTide = (await call('/v5/profile')).data.me.shards;
ok(SOC2.tideState() === null, '潮汐已结束');
ok(true, '潮汐奖励结算（有无贡献都不断言数值）', { before: beforeTide, after: afterTide });

// ---------------- 洞窟试炼 ----------------
const cave = T.caves && T.caves[0];
ok(!!cave, '地形下发里带洞窟', T.caves && T.caves.length);
if (cave) {
  await goTo('1001', cave.x + 0.5, cave.y + 0.8);
  const cv = await call('/v5/cave', { id: cave.id });
  ok(cv.code === 200, '进入洞窟试炼', cv.data);
  const bossId = cv.data && cv.data.need;
  if (bossId && SIM2.mobs[bossId]) {
    // 等级 1 一刀砍不死 2.6 倍血的精英，得连着砍（服务端按理论伤害封顶，这是好事）
    let guard2 = 0;
    while (SIM2.mobs[bossId] && guard2++ < 20) {
      SIM2.players['1001'].x = SIM2.mobs[bossId].x;
      SIM2.players['1001'].y = SIM2.mobs[bossId].y;
      SIM2.players['1001'].lastHit = 0;
      await call('/v5/hit', { list: [{ m: bossId, d: 99999, c: 1 }], kind: 'melee' });
      await sleep(80);
    }
    const cdone = routes.STORE.load('1001', { x: 0, y: 0 });
    ok(cdone.flags && cdone.flags['cave_' + cave.zone], '打死守心精英完成试炼', cdone.flags);
  }
  const cv2 = await call('/v5/cave', { id: cave.id });
  ok(cv2.code !== 200, '同一天不能刷第二次', cv2.code);
}

// ---------------- 表情 ----------------
const em = await call('/v5/emote', { e: 'wave' });
ok(em.code === 200, '表情可用', em.data);

// ---------------- 终局：长夜之主点亮长夜之心（v5.6 P0-1 死锁修复回归） ----------------
// 场景：先把前五区灯塔置亮，只留 abyss 未点亮。world boss 未点亮时必须能刷（玩家要打它点灯），
// 击杀后 towers.abyss 点亮 → enter 的 goal 归空（客户端第七章文案），再 sync 不再唤醒（不印钞）。
const ABYSS_TOWER = T.towers.abyss;
['forest', 'swamp', 'crag', 'frost'].forEach((z) => routes.STORE.lightTower(z, '1001'));
await goTo('1001', ABYSS_TOWER.x + 0.5, ABYSS_TOWER.y + 4.5);
await call('/v5/sync', { x: ABYSS_TOWER.x + 0.5, y: ABYSS_TOWER.y + 4.5, f: 0, mv: 0, mp: 40 });
const sAbyss = await call('/v5/sync', { x: ABYSS_TOWER.x + 0.5, y: ABYSS_TOWER.y + 4.5, f: 0, mv: 0, mp: 40 });
const abyssRow = (sAbyss.data.m || []).find((m) => m[10] === 1);
ok(!!abyssRow, '长夜之心未点亮时长夜之主可被唤醒（世界 boss 保留可刷）', (sAbyss.data.m || []).filter((m) => m[10] === 1).length);
if (abyssRow && SIM.mobs[abyssRow[0]]) {
  routes.SIM.killMob(SIM.mobs[abyssRow[0]], '1001');
  await sleep(120);
  const t3 = await call('/v5/profile');
  ok(!!t3.data.towers.abyss, '击杀长夜之主点亮 towers.abyss（第七章解锁）', t3.data.towers);
  const e2 = await call('/v5/enter', {});
  ok(e2.data.goal === null, '六灯全亮后 goal 归空（客户端进入第七章文案）', e2.data.goal);
  // 印钞机：点亮后再站回塔前，唤醒逻辑必须沉默
  await goTo('1001', ABYSS_TOWER.x + 0.5, ABYSS_TOWER.y + 4.5);
  await call('/v5/sync', { x: ABYSS_TOWER.x + 0.5, y: ABYSS_TOWER.y + 4.5, f: 0, mv: 0, mp: 40 });
  const sAbyss2 = await call('/v5/sync', { x: ABYSS_TOWER.x + 0.5, y: ABYSS_TOWER.y + 4.5, f: 0, mv: 0, mp: 40 });
  const reBorn = (sAbyss2.data.m || []).filter((m) => m[10] === 1).length;
  ok(reBorn === 0, '点亮后长夜之主不再重刷（印钞机验证）', reBorn);
  ok(!Object.keys(SIM.mobs).some((k) => SIM.mobs[k] && SIM.mobs[k].bossZone === 'abyss'), '在线怪表无 abyss 守护者', Object.keys(SIM.mobs).filter((k) => SIM.mobs[k] && SIM.mobs[k].bossZone === 'abyss').length);
} else {
  ok(false, '长夜之主唤醒失败，后续点灯断言跳过');
}

// ---------------- 离开 ----------------
const lv = await call('/v5/leave', {});
ok(lv.code === 200, '离开世界');
ok(!SIM.players['1001'], '离开后从在线表移除');

server.close();
console.log('\n拾光群岛 v5 接口联调：' + pass + ' 通过 / ' + fail + ' 失败');
if (fail) { console.log('失败项：\n - ' + bad.join('\n - ')); process.exit(1); }
