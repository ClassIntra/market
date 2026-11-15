// 拾光群岛 v5 —— 纯逻辑自测（不需要数据库，不碰宿主）
// 覆盖：地形生成合理性 / 连通性 / 刷怪点 / 装备词条 / 伤害上限 / 怪物 AI 状态机
// 用法：node market/apps/shiguang/test/v5-unit.mjs
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const B = 'D:/NetWork/Integration/market/apps/shiguang/backend/v5/';

let pass = 0, fail = 0;
const bad = [];
function ok(cond, name, extra) {
  if (cond) pass++;
  else { fail++; bad.push(name + (extra ? ' → ' + extra : '')); }
}

const C = require(B + 'config.js');
const D = require(B + 'data.js');
const W = require(B + 'worldgen.js');
const L = require(B + 'loot.js');
const SIM = require(B + 'sim.js');

// ---- 地形 ----
const t0 = Date.now();
const world = W.get();
const genMs = Date.now() - t0;
ok(world.size === 256, '世界 256×256', world.size);
ok(world.grid.length === 256 * 256, '网格长度', world.grid.length);
ok(genMs < 4000, '生成耗时可接受', genMs + 'ms');

const counts = {};
for (let i = 0; i < world.grid.length; i++) counts[world.grid[i]] = (counts[world.grid[i]] || 0) + 1;
const water = (counts[W.TILE.WATER] || 0) / world.grid.length;
ok(water > 0.05 && water < 0.35, '海洋占比合理', (water * 100).toFixed(1) + '%');
// 5.2 把镇子从 26×26 收到 17×17：铺地总格数降到 150 左右，
// 断言改成「够铺出一个广场」+「中心确实是铺地」，比盯一个随布局漂移的总数稳。
ok((counts[W.TILE.FLOOR] || 0) >= 120, '镇内铺地存在', counts[W.TILE.FLOOR]);
ok(world.grid[Math.floor(world.town.cy) * world.size + Math.floor(world.town.cx)] === W.TILE.FLOOR,
  '广场中心是铺地', world.grid[Math.floor(world.town.cy) * world.size + Math.floor(world.town.cx)]);
ok((counts[W.TILE.TREE] || 0) > 2000, '有森林', counts[W.TILE.TREE]);

// ---- 城镇与地标 ----
const town = world.town;
ok(!!town && town.houses.length === 4, '镇上 4 间房', town && town.houses.length);
const cx = Math.floor(town.cx), cy = Math.floor(town.cy);
ok(!W.isBlocked(world, cx + 0.5, cy + 5.5), '出生点可站');
for (const k of Object.keys(world.landmarks.towers)) {
  const t = world.landmarks.towers[k];
  ok(!W.isBlocked(world, t.x + 0.5, t.y + 0.5), '灯塔 ' + k + ' 可站', t.x + ',' + t.y);
}
ok(Object.keys(world.landmarks.towers).length === 6, '6 座区域灯塔');
ok(world.landmarks.chests.length >= 40, '宝箱数量', world.landmarks.chests.length);
ok(world.landmarks.waystones.length === 7, '传送石 7 块', world.landmarks.waystones.length);
ok(world.landmarks.caves.length === 6, '洞窟 6 处', world.landmarks.caves.length);
world.landmarks.caves.forEach(function (cv) {
  ok(!W.isBlocked(world, cv.x + 0.5, cv.y + 0.5), '洞窟口可站 ' + cv.id);
});

// ---- 连通性：从镇门能走到的可走格比例 ----
function flood(sx, sy) {
  const WID = 256;
  const seen = new Uint8Array(WID * WID);
  const q = [sy * WID + sx];
  seen[q[0]] = 1;
  let n = 0;
  while (q.length) {
    const i = q.pop(); n++;
    const x = i % WID, y = (i / WID) | 0;
    const nb = [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]];
    for (const [nx, ny] of nb) {
      if (nx < 0 || ny < 0 || nx >= WID || ny >= WID) continue;
      const j = ny * WID + nx;
      if (seen[j] || W.BLOCK[world.grid[j]]) continue;
      seen[j] = 1; q.push(j);
    }
  }
  return { n, seen };
}
const fl = flood(cx, cy);
let walkable = 0;
for (let i = 0; i < world.grid.length; i++) if (!W.BLOCK[world.grid[i]]) walkable++;
ok(fl.n / walkable > 0.55, '主大陆连通（可达/可走）', (fl.n / walkable * 100).toFixed(0) + '%');

// 每座灯塔、每块传送石都必须在可达集合里，否则玩家永远到不了
for (const k of Object.keys(world.landmarks.towers)) {
  const t = world.landmarks.towers[k];
  ok(fl.seen[Math.floor(t.y) * 256 + Math.floor(t.x)] === 1, '灯塔 ' + k + ' 可从镇子走到');
}
for (const w of world.landmarks.waystones) {
  ok(fl.seen[Math.floor(w.y) * 256 + Math.floor(w.x)] === 1, '传送石 ' + w.id + ' 可达');
}
for (const cv of world.landmarks.caves) {
  ok(fl.seen[Math.floor(cv.y) * 256 + Math.floor(cv.x)] === 1, '洞窟 ' + cv.id + ' 可达');
}
let chestReach = 0;
for (const c of world.landmarks.chests) if (fl.seen[c.y * 256 + c.x] === 1) chestReach++;
ok(chestReach / world.landmarks.chests.length > 0.8, '宝箱可达率', (chestReach / world.landmarks.chests.length * 100).toFixed(0) + '%');

// ---- 刷怪点 ----
ok(world.spawns.length > 100, '刷怪点数量', world.spawns.length);
ok(world.spawns.every(s => !W.isBlocked(world, s.x, s.y)), '刷怪点都在可走格');
const zoneSpread = {};
world.spawns.forEach(s => { zoneSpread[s.zone] = (zoneSpread[s.zone] || 0) + 1; });
ok(Object.keys(zoneSpread).length >= 5, '刷怪点覆盖 5 个以上区域', JSON.stringify(zoneSpread));

// ---- v5.3 农场空地：树石清空、可走、不刷怪 ----
const FD = require(B + 'farmdata.js');
const FA = FD.DATA;
let farmBlocked = 0, farmSpawns = 0;
for (let y = FA.FARM_Y; y < FA.FARM_Y + FA.FARM_H; y++) {
  for (let x = FA.FARM_X; x < FA.FARM_X + FA.FARM_W; x++) {
    if (W.isBlocked(world, x + 0.5, y + 0.5)) farmBlocked++;
  }
}
world.spawns.forEach(s => {
  if (s.x >= FA.FARM_X - 1 && s.x <= FA.FARM_X + FA.FARM_W + 1 &&
      s.y >= FA.FARM_Y - 1 && s.y <= FA.FARM_Y + FA.FARM_H + 1) farmSpawns++;
});
ok(farmBlocked === 0, '农场 ' + FA.FARM_W + '×' + FA.FARM_H + ' 格全部可走', farmBlocked);
ok(farmSpawns === 0, '自家田里不刷怪', farmSpawns);

// ---- 数据完整性 ----
for (const k of Object.keys(D.MONSTERS)) {
  const m = D.MONSTERS[k];
  ok(!!m.ai && !!m.sprite && m.hp > 0, '怪物数据 ' + k);
  ok(!!D.ZONE_MATS[m.zone] || m.zone === '*night', '怪物区域有掉落表 ' + k + ' ' + m.zone);
}
for (const z of Object.keys(D.BOSSES)) ok(!!world.landmarks.towers[z], 'Boss 有场地 ' + z);
ok(Object.keys(D.BOSSES).length === 6, '6 个守护者');

// ---- 装备生成 ----
let legend = 0, totalAtk = 0, n = 400;
for (let i = 0; i < n; i++) {
  const it = L.rollItem(10, {});
  ok(!!it.slot && !!it.name && !!it.uid, '装备结构完整');
  if (it.slot === 'weapon') { ok(it.atk > 0, '武器有攻击'); totalAtk += it.atk; }
  const capAffix = Math.max(1, D.RARITY[it.rarity].affixes);   // 饰品保底一条
  ok(Object.keys(it.affixes).length <= capAffix, '词条数不超上限');
  if (it.rarity === 4) legend++;
}
ok(totalAtk > 0, '武器攻击有值');
const rareRate = legend / n;
ok(rareRate < 0.02, '传说掉率不失控', (rareRate * 100).toFixed(1) + '%');

// 属性合成：等级 + 装备 + 天赋
const p = { level: 10, equip: { weapon: { kind: 'sword', atk: 30, affixes: { crit: 5, leech: 2 } } }, talents: { blade: 2 } };
const st = L.computeStats(p);
ok(st.atk > C.BASE_ATK, '装备加成生效', st.atk);
ok(st.crit >= 10, '暴击叠加', st.crit);
ok(st.talents.finisher === 25, '天赋写入 talents', JSON.stringify(st.talents));
ok(L.xpToNext(1) < L.xpToNext(10) && L.xpToNext(10) < L.xpToNext(29), '经验曲线单调');

// ---- 模拟：怪物 AI 会打人，也会被杀死 ----
const sim = SIM;
const town2 = { x: world.town.cx + 0.5, y: world.town.cy + 5.5 };
sim.upsertPlayer('u_test', { x: town2.x, y: town2.y, hp: 100, maxHp: 100, stats: L.computeStats({ level: 5 }) });
ok(sim.players['u_test'].safe === true, '镇内安全区生效');

// 把玩家挪到草原
const meadow = world.spawns.find(s => s.zone === 'meadow' && s.lv <= 3);
sim.upsertPlayer('u_test', { x: meadow.x, y: meadow.y, hp: 100, maxHp: 100 });
const mob = sim.spawnMob('slime', meadow.x + 1, meadow.y, 3, { zone: 'meadow' });
ok(!!mob && mob.hp > 0, '生成史莱姆', mob && mob.hp);
const r1 = sim.playerHit('u_test', { mobId: mob.id, dmg: 12, crit: false, kind: 'melee', kx: 1, ky: 0 }, L.computeStats({ level: 5 }));
ok(r1 && r1.dmg === 12 && r1.hp === mob.maxHp - 12, '近战命中扣血', JSON.stringify(r1));

// 距离外不认
const far = sim.spawnMob('slime', meadow.x + 20, meadow.y + 20, 3, { zone: 'meadow' });
sim.players['u_test'].lastHit = 0;
const r2 = sim.playerHit('u_test', { mobId: far.id, dmg: 30, crit: false, kind: 'melee' }, L.computeStats({ level: 5 }));
ok(r2 === null, '超距命中被拒');

// 伤害上限
const before = mob.hp;
sim.players['u_test'].lastHit = 0;
const r3 = sim.playerHit('u_test', { mobId: mob.id, dmg: 99999, crit: true, kind: 'melee' }, L.computeStats({ level: 5 }));
ok(r3 && r3.dmg < 200, '伤害上限拦截作弊', r3 && r3.dmg);

// 打死：清怪 + 触发 onKill
let killed = null;
sim.stop();
sim.start({ onKill: (m, shares) => { killed = { kind: m.kind, shares }; } });
sim.upsertPlayer('u_test', { x: meadow.x, y: meadow.y, hp: 100, maxHp: 100 });
const mob2 = sim.spawnMob('slime', meadow.x + 0.8, meadow.y, 3, { zone: 'meadow' });
sim.players['u_test'].lastHit = 0;
sim.players['u_test'].hp = 100;
sim.playerHit('u_test', { mobId: mob2.id, dmg: 999, crit: false, kind: 'melee' }, L.computeStats({ level: 30 }));
ok(killed && killed.kind === 'slime', '击杀触发 onKill 钩子', JSON.stringify(killed));
ok(sim.players['u_test'].hp <= 100, '玩家血量有界');

// 白天幽灵会消散
const ph = sim.dayPhase();
ok(['day', 'dusk', 'night', 'dawn'].indexOf(ph.name) >= 0, '昼夜相位有效', ph.name);
ok(ph.f >= 0 && ph.f < 1, '相位比例 0~1', ph.f);

// 快照结构
const snap = sim.snapshotFor('u_test');
ok(Array.isArray(snap.mobs) && Array.isArray(snap.shots), '快照含怪物与弹幕');

sim.stop();
console.log('\n拾光群岛 v5 逻辑自测：' + pass + ' 通过 / ' + fail + ' 失败');
if (fail) { console.log('失败项：\n - ' + bad.join('\n - ')); process.exit(1); }
