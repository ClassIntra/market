// 拾光群岛 v5 —— 纯逻辑自测（不需要数据库，不碰宿主）
// 覆盖：地形生成合理性 / 连通性 / 刷怪点 / 装备词条 / 伤害上限 / 怪物 AI 状态机
// 用法：node market/apps/shiguang/test/v5-unit.mjs
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const B = (process.env.SG5_APP || 'D:/NetWork/Integration/market/apps/shiguang') + '/backend/v5/';

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

// ---- v5.4 加工 / 采集 / 吃：farmdata 数据层 ----
ok(Object.keys(FA.RECIPES || {}).length >= 17, 'v5.4 配方表齐全（数值表 18 条）', Object.keys(FA.RECIPES || {}).length);
ok(Object.keys(FA.MACHINES || {}).length === 5, '5 台加工设备', Object.keys(FA.MACHINES || {}).length);
ok(FA.MACHINES.furnace.cost === 300 && FA.MACHINES.keg.cost === 2500, '设备定价按 spec', FA.MACHINES.furnace.cost + '/' + FA.MACHINES.keg.cost);
ok(FA.TOOL_UPGRADES.every(function (u) { return /_bar$/.test(u.bar); }), '工具升级改用锭', FA.TOOL_UPGRADES.map(function (u) { return u.bar; }).join(','));
ok(Object.keys(FA.SELL || {}).length >= 16 && FA.SELL.copper_bar === 60 && FA.SELL.iridium_bar === 1000, '锭与加工品基价表', FA.SELL.copper_bar + '/' + FA.SELL.iridium_bar);
ok(Object.keys(FA.EAT || {}).length >= 16, '可吃表覆盖料理与采集物', Object.keys(FA.EAT || {}).length);
ok(FA.EAT.food_soup === 40 && typeof FA.EAT.starfruit === 'object' && FA.EAT.starfruit.maxEnergy === 34, '料理回体力 / 星果 +34 特殊', JSON.stringify(FA.EAT.food_soup) + '/' + JSON.stringify(FA.EAT.starfruit));
ok(FA.ENERGY_CAP === 200, '体力上限 200 硬约束', FA.ENERGY_CAP);
// 职业效果表：13 个 v5.4 兑现的职业 id 必须都能在 PROFESSIONS 里选到
(function () {
  const have = {};
  for (const sk of Object.keys(FA.PROFESSIONS)) {
    for (const tier of Object.keys(FA.PROFESSIONS[sk])) {
      for (const p of FA.PROFESSIONS[sk][tier]) have[p[0]] = 1;
    }
  }
  const need = ['blacksmith', 'prospector', 'geologist', 'pirate', 'forester', 'gatherer',
    'lumberjack', 'botanist', 'trapper', 'fighter', 'scout', 'brute', 'defender'];
  const missing = need.filter(function (id) { return !have[id]; });
  ok(missing.length === 0, '13 个职业效果 id 都存在', missing.join(','));
})();
// 季节齐：四季都有采集物
(function () {
  const bySeason = {};
  for (const f of FA.FORAGE) bySeason[f.s] = (bySeason[f.s] || 0) + 1;
  ok(FA.FORAGE.length >= 12, 'v5.4 采集物 ≥12 种', FA.FORAGE.length);
  ok([0, 1, 2, 3].every(function (s) { return (bySeason[s] || 0) >= 3; }), '四季采集物齐全', JSON.stringify(bySeason));
})();
// forageList：14~18 个、确定性、冷却格被排除、不落在自家田里
(function () {
  for (const day of [1, 13, 29, 57, 85, 113]) {
    const l = FD.forageList(day, {});
    ok(l.length >= 12, 'forageList(' + day + ') 数量 12~26', l.length);
    const inFarm = l.filter(function (p) {
      return p.x >= FA.FARM_X - 1 && p.x <= FA.FARM_X + FA.FARM_W && p.y >= FA.FARM_Y - 1 && p.y <= FA.FARM_Y + FA.FARM_H;
    });
    ok(inFarm.length === 0, 'forageList(' + day + ') 不长在自家田里', inFarm.length);
  }
  const l0 = FD.forageList(9, {});
  ok(JSON.stringify(l0) === JSON.stringify(FD.forageList(9, {})), 'forageList 确定性（同参数同结果）');
  const cd = {};
  l0.forEach(function (p) { cd[p.x + ',' + p.y] = 9; });
  const l1 = FD.forageList(9, cd);
  ok(l1.length >= 12, '冷却后仍有新点（12~26）', l1.length);
  ok(l1.every(function (p) { return !cd[p.x + ',' + p.y]; }), '冷却格（day 差 <3）被排除');
})();

// ---- v5.5 彩蛋节 / 丰收展：farmdata 数据层 ----
ok(FA.EGG_REDEEM && FA.EGG_REDEEM.seed_strawberry && FA.EGG_REDEEM.seed_strawberry.n === 5 && FA.EGG_REDEEM.seed_strawberry.cost === 2,
  'EGG_REDEEM 草莓种子 ×5 / 彩券 2 张', JSON.stringify(FA.EGG_REDEEM));
ok(FA.EGG_REDEEM.speedgro && FA.EGG_REDEEM.speedgro.n === 5 && FA.EGG_REDEEM.speedgro.cost === 2,
  'EGG_REDEEM 生长激素 ×5 / 彩券 2 张');
ok(FA.EGG_REDEEM.gold && FA.EGG_REDEEM.gold.amount === 200 && FA.EGG_REDEEM.gold.cost === 1,
  'EGG_REDEEM 200 金 / 彩券 1 张');
(function () {
  for (const day of [13, 41, 97, 367]) {
    const uid = 'u1001';
    const a = FD.eggList(day, uid), b = FD.eggList(day, uid);
    ok(JSON.stringify(a) === JSON.stringify(b), 'eggList(' + day + ') 确定性（同 uid+day 同结果）');
    // 取「过滤阻挡格后的前 12 颗」——与 farm.js eggsOf 同一逻辑
    const picked = [];
    for (const c of a) {
      if (picked.length >= 12) break;
      if (W.isBlocked(world, c.x + 0.5, c.y + 0.5)) continue;
      picked.push(c);
    }
    ok(picked.length === 12, 'eggList(' + day + ') 过滤阻挡后仍有 12 颗', picked.length);
    const keys = picked.map(function (p) { return p.x + ',' + p.y; });
    ok(new Set(keys).size === 12, 'eggList(' + day + ') 12 颗不重复', keys.length);
    ok(picked.every(function (p) { return !W.isBlocked(world, p.x + 0.5, p.y + 0.5); }),
      'eggList(' + day + ') 全部落在无阻挡格');
    const inFarm = picked.filter(function (p) {
      return p.x >= FA.FARM_X - 1 && p.x <= FA.FARM_X + FA.FARM_W && p.y >= FA.FARM_Y - 1 && p.y <= FA.FARM_Y + FA.FARM_H;
    });
    ok(inFarm.length === 0, 'eggList(' + day + ') 不长在自家田里', inFarm.length);
  }
  ok(JSON.stringify(FD.eggList(13, 'u1001')) !== JSON.stringify(FD.eggList(13, 'u1002')),
    'eggList per-player（不同 uid 不同分布）');
  ok(JSON.stringify(FD.eggList(13, 'u1001')) !== JSON.stringify(FD.eggList(14, 'u1001')),
    'eggList 按天变化（跨日刷新）');
})();
// exhibitGrade 四档边界（主理人公式：普通1/银2/金3/铱4；S:均分≥2.5且≥7种 / A:均分≥2且≥5种 / B:≥3种 / C）
(function () {
  // 9 样全铱 9 种 → S
  const nine = ['parsnip', 'melon', 'pumpkin', 'kale', 'potato', 'garlic', 'tulip', 'jazz', 'cauliflower'];
  const s9 = FD.exhibitGrade(nine.map(function (b) { return b + '_q3'; }));
  ok(s9.grade === 'S' && s9.gold === 1200, 'exhibitGrade S：9 种全铱 1200g', JSON.stringify(s9));
  // 均分 3（金星）7 种 → S 边界（2.5 边界之上）
  const s7 = FD.exhibitGrade(nine.slice(0, 7).map(function (b) { return b + '_q2'; })
    .concat(nine.slice(7).map(function (b) { return b + '_q2'; })));
  ok(s7.grade === 'S', 'exhibitGrade S：7 种金星也到 S', JSON.stringify(s7));
  // A：5 种金星（均分 3 ≥2、5 种 ≥5），6/7 种不够 S 的 diversity≤6 → A
  const a5 = FD.exhibitGrade(['parsnip_q2', 'melon_q2', 'pumpkin_q2', 'kale_q2', 'potato_q2', 'parsnip_q2', 'melon_q2', 'pumpkin_q2', 'kale_q2']);
  ok(a5.grade === 'A' && a5.gold === 800, 'exhibitGrade A：5 种金星 800g', JSON.stringify(a5));
  // B：3 种普通（diversity 3 ≥3，均分不足 A 档）
  const b3 = FD.exhibitGrade(['parsnip', 'parsnip_q1', 'parsnip_q2', 'melon', 'melon_q1', 'melon_q2', 'kale', 'kale_q1', 'kale_q2']);
  ok(b3.grade === 'B' && b3.gold === 500, 'exhibitGrade B：3 种普通 500g', JSON.stringify(b3));
  // C：2 种
  const c2 = FD.exhibitGrade(['parsnip', 'parsnip', 'parsnip', 'parsnip', 'parsnip', 'parsnip', 'parsnip', 'parsnip', 'melon']);
  ok(c2.grade === 'C' && c2.gold === 300, 'exhibitGrade C：2 种 300g', JSON.stringify(c2));
  // 同 base 不同品质算同一种（9 样 1 种 → C，均分不影响 B/C 档）
  const one = FD.exhibitGrade(['parsnip_q1', 'parsnip_q2', 'parsnip_q3', 'parsnip_q2', 'parsnip_q1', 'parsnip_q2', 'parsnip_q3', 'parsnip_q1', 'parsnip_q2']);
  ok(one.diversity === 1 && one.grade === 'C', 'exhibitGrade：同 base 不同品质算同种', JSON.stringify(one));
})();

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
