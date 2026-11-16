// 拾光群岛 v5.3 —— 农场经营全系统联调（内存库，不碰生产）
//
// 用法：
//   NODE_PATH=D:/tmp/sg5node;D:/NetWork/Integration/ClassIntra/server/node_modules \
//     "C:/Program Files/nodejs/node.exe" test/v5-farm.mjs
import { createRequire } from 'node:module';
import { setTimeout as sleep } from 'node:timers/promises';

const require = createRequire(import.meta.url);
const NM = 'D:/NetWork/Integration/ClassIntra/server/node_modules/';
const SRC = (process.env.SG5_APP || 'D:/NetWork/Integration/market/apps/shiguang') + '/backend/v5/';
const express = require(NM + 'express');
const FD = require(SRC + 'farmdata.js');
const app = express();
app.use(express.json({ limit: '1mb' }));
const routes = require(SRC + 'routes.js');
const store = require(SRC + 'store.js');
app.use('/api/shiguang', routes);
const server = app.listen(0);
const BASE = 'http://127.0.0.1:' + server.address().port + '/api/shiguang';

let pass = 0, fail = 0;
function ok(c, n, extra) {
  if (c) { pass++; console.log('  ✓', n); }
  else { fail++; console.log('  ✗', n, extra === undefined ? '' : JSON.stringify(extra).slice(0, 260)); }
}
async function call(p, body, uid) {
  const res = await fetch(BASE + p, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', 'x-uid': uid || '1001' },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  return res.json();
}
function st(uid) { return call('/v5/farm/state', undefined, uid); }
function setDay(n) { routes.FARM.setEpochForDay(n); }
function flags(uid) { const f = routes.FARM.of(uid || '1001'); f.mineDay = null; routes.FARM.save(uid || '1001'); return f; }
async function okCall(p, b, uid) {
  const r = await call(p, b, uid);
  ok(r && r.code === 200, p + ' 成功', r);
  return r && r.data;
}
async function badCall(p, b, uid, why) {
  const r = await call(p, b, uid);
  ok(r && r.code !== 200, why || (p + ' 被正确拒绝'), r && r.message);
  return r;
}

console.log('\n== 1. 静态数据层（原作 1.6 数值） ==');
ok(FD.DATA.SEASON_DAYS === 28, '一季 28 天');
ok(FD.DATA.START_GOLD === 500, '开局 500 金');
ok(Object.keys(FD.DATA.CROPS).length >= 30, '作物表 ≥30 种', Object.keys(FD.DATA.CROPS).length);
ok(FD.DATA.CROPS.parsnip.days === 4 && FD.DATA.CROPS.parsnip.seed === 20 && FD.DATA.CROPS.parsnip.sell === 35,
  '防风草 4 天 / 20g 种 / 35g 售');
ok(FD.DATA.CROPS.blueberry.regrow === 4 && FD.DATA.CROPS.blueberry.yield === 3, '蓝莓 13 天 / 4 天复收 / 一次 3 个');
ok(FD.DATA.CROPS.pumpkin.days === 13 && FD.DATA.CROPS.pumpkin.sell === 320, '南瓜 13 天 / 320g');
ok(FD.seasonOf(1) === 0 && FD.seasonOf(29) === 1 && FD.seasonOf(85) === 3, '季节按 28 天轮换');
ok(FD.dayInSeason(29) === 1 && FD.yearOf(113) === 2, '季内日 / 年');
ok(FD.weatherFor(1) === 'sun', '开局第一天必定放晴');
ok(FD.festivalOn(13) && FD.festivalOn(13).name === '彩蛋节', '春 13 彩蛋节');
ok(FD.clockOf(0) === '06:00' && FD.clockOf(0.5) === '16:00', '游戏时钟 6:00 → 16:00');
ok(FD.levelOf(0) === 0 && FD.levelOf(100) === 1 && FD.levelOf(15000) === 10, '技能经验阈值');
ok(FD.cropPrice('parsnip', 2, [], '') === 52, '金星防风草 52g', FD.cropPrice('parsnip', 2, [], ''));
ok(FD.cropPrice('parsnip', 0, ['tiller'], '') === 38, '农夫职业 +10%');
ok(FD.giftPoints('love', 0, true, '') === 640, '生日送最爱 ×8');
ok(FD.heartsOf(2499) === 9 && FD.heartsOf(2500) === 10, '每心 250 点');
ok(FD.growthOf({ crop: 'parsnip', grow: 4 }, 9, false).ready === true, '长满即可收');
ok(FD.seedList(1, false).indexOf('melon') < 0 && FD.seedList(30, false).indexOf('melon') >= 0,
  '种子按季节过滤');

console.log('\n== 2. 进世界：农场存档初始化 ==');
const enter = await call('/v5/enter', {});
ok(enter.code === 200 && enter.data.farm, 'enter 带农场快照');
let P = enter.data.farm;
ok(P.gold === 500 && P.energy === 100 && P.maxEnergy === 100, '开局 500 金 / 100 体力');
ok(P.cal.season === 0 && P.cal.dayInSeason === 1 && P.cal.weather === 'sun', '春 1 日 · 晴');
ok(P.backpack === 12 && P.invCount === 0, '背包 12 格 · 空');
ok(P.tools.hoe === 0 && P.skills.farming === 0, '基础农具 / 零经验');
ok(Object.keys(P.data.CROPS).length >= 30 && P.data.VILLAGERS.smith, '数据表与村民下发了');
ok(routes.FARM && routes.LIFE, '测试钩子 FARM / LIFE 已导出');

console.log('\n== 3. 核心循环：买种 → 翻地 → 播种 → 浇水 → 跨日 → 收获 → 卖钱 ==');
let d = await okCall('/v5/farm/buy', { kind: 'seed', id: 'seed_parsnip', n: 3 });
ok(d.farm.gold === 440 && d.farm.inv.seed_parsnip === 3, '买 3 包防风草种子花 60 金');
await badCall('/v5/farm/buy', { kind: 'seed', id: 'seed_melon', n: 1 }, '1001', '过季种子不卖');
d = await okCall('/v5/farm/till', { r: 0, c: 0 });
ok(d.farm.plots['0,0'].tilled === 1 && d.farm.energy === 98, '翻地扣 2 体力');
d = await okCall('/v5/farm/plant', { r: 0, c: 0, seed: 'seed_parsnip' });
ok(d.farm.plots['0,0'].crop === 'parsnip' && d.farm.inv.seed_parsnip === 2, '播种消耗一包种子');
await badCall('/v5/farm/plant', { r: 0, c: 0, seed: 'seed_parsnip' }, '1001', '同一格不能重复播种');
d = await okCall('/v5/farm/water', { r: 0, c: 0 });
ok(d.farm.plots['0,0'].watered === 1 && d.farm.energy === 96, '浇水扣 2 体力');
await badCall('/v5/farm/harvest', { r: 0, c: 0 }, '1001', '没熟不能收');
let day = routes.FARM.dayNow();
for (let i = 0; i < 4; i++) {
  const w = await call('/v5/farm/water', { r: 0, c: 0 });   // 雨天服务端会拒，忽略
  setDay(day + i + 1);
  await st();                                                // 触发 lazy 跨日结算
}
P = (await st()).data.farm;
ok(P.plots['0,0'].grow >= 4, '逐日浇水 4 天后成熟', P.plots['0,0']);
d = await okCall('/v5/farm/harvest', { r: 0, c: 0 });
ok(d.got && d.got.length >= 1 && /^parsnip/.test(d.got[0]), '收获拿到防风草', d.got);
ok(d.farm.skills.farming >= 8, '收获涨耕种经验', d.farm.skills.farming);
const gotId = d.got[0];
d = await okCall('/v5/farm/sell', { items: { [gotId]: 1 } });
ok(d.gold >= 35 && d.farm.gold > 440, '出售即时到账', d.gold);
await badCall('/v5/farm/sell', { items: { skull_key: 1 } }, '1001', '不收的东西不能卖');

console.log('\n== 4. 出货箱次日结算 / 雨天 / 昏厥 ==');
d = await okCall('/v5/farm/buy', { kind: 'seed', id: 'seed_parsnip', n: 1 });
await okCall('/v5/farm/till', { r: 1, c: 1 });
await okCall('/v5/farm/plant', { r: 1, c: 1, seed: 'seed_parsnip' });
day = routes.FARM.dayNow();
for (let i = 0; i < 5; i++) { await call('/v5/farm/water', { r: 1, c: 1 }); setDay(day + i + 1); await st(); }
const hv = await call('/v5/farm/harvest', { r: 1, c: 1 });
ok(hv.code === 200, '第二茬收成');
const cropId = hv.data.got[0];
const before = (await st()).data.farm.gold;
d = await okCall('/v5/farm/ship', { items: { [cropId]: 1 } });
ok(d.shipped === 1 && d.farm.ship[cropId] === 1, '放进出货箱');
ok((await st()).data.farm.gold === before, '当天不到账');
setDay(routes.FARM.dayNow() + 1);
P = (await st()).data.farm;
ok(P.gold > before && P.shipTotal > 0, '次日清晨结账', { before: before, after: P.gold });
await badCall('/v5/farm/ship', { items: { skull_key: 1 } }, '1001', '不收的东西进不了箱子');

console.log('\n== 5. 体力 / 睡觉 / 工具升级 / 技能职业 ==');
let f = flags();
f.energy = 1; routes.FARM.save('1001');
await badCall('/v5/farm/till', { r: 2, c: 2 }, '1001', '体力不足时拒绝动作');
d = await okCall('/v5/farm/sleep', {});
// v5.6：睡觉分段恢复 —— 当日第 1 次 +60% max（100→61），第 2 次起 +30%，封顶 max
ok(d.slept > 0 && d.n === 1 && d.farm.energy === 61, '睡觉分段恢复：第 1 觉 +60%（61/100）', d.farm && d.farm.energy);
d = await okCall('/v5/farm/sleep', {});
ok(d.n === 2 && d.farm.energy === 91, '第 2 觉 +30%（91/100）', d.farm && d.farm.energy);
d = await okCall('/v5/farm/sleep', {});
ok(d.n === 3 && d.farm.energy === 100, '封顶 maxEnergy（100/100）', d.farm && d.farm.energy);
f = flags();
f.gold = 99999; f.inv.copper_bar = 20; f.inv.iron_bar = 20; f.inv.gold_bar = 20; f.inv.iridium_bar = 20;
routes.FARM.save('1001');
d = await okCall('/v5/farm/tool', { tool: 'hoe' });
ok(d.farm.toolOrder && d.farm.toolOrder.lv === 1 && d.farm.gold < 99999, '工具升级下单（扣 2000g + 5 铜锭）');
await badCall('/v5/farm/tool', { tool: 'watercan' }, '1001', '同一时间只能打一件');
setDay(routes.FARM.dayNow() + 1);
P = (await st()).data.farm;
ok(P.tools.hoe === 1 && !P.toolOrder, '隔天取到铜锄头');
d = await okCall('/v5/farm/till', { cells: [[3, 3], [3, 4], [3, 5]] });
ok(d.tilled === 3, '铜锄头一次能翻 3 格', d.tilled);
f = flags();
f.skills.farming = 15000; routes.FARM.save('1001');
d = await okCall('/v5/farm/profession', { skill: 'farming', id: 'tiller' });
ok(d.chosen === 'tiller' && d.farm.profs.indexOf('tiller') >= 0, '满级也能补选 5 级「农夫」职业');
await badCall('/v5/farm/profession', { skill: 'farming', id: 'rancher' }, '1001', '同一层不能选两次');
d = await okCall('/v5/farm/profession', { skill: 'farming', id: 'artisan' });
ok(d.chosen === 'artisan' && d.farm.profs.length === 2, '再选 10 级「工匠」职业');
await badCall('/v5/farm/profession', { skill: 'farming', id: 'agriculturist' }, '1001', '10 级层也不能选两次');

console.log('\n== 6. 背包 / 箱子 / 季节枯萎 ==');
f = flags();
f.gold = 99999; routes.FARM.save('1001');
d = await okCall('/v5/farm/buy', { kind: 'hay', n: 3 });
ok(d.farm.inv.hay === 3, '买干草');
d = await okCall('/v5/farm/chest', { mode: 'put', items: { hay: 2 } });
ok(d.moved === 2 && d.farm.chest.hay === 2 && d.farm.inv.hay === 1, '存进箱子');
d = await okCall('/v5/farm/chest', { mode: 'take', items: { hay: 1 } });
ok(d.moved === 1 && d.farm.inv.hay === 2, '从箱子取回');
d = await okCall('/v5/farm/buy', { kind: 'backpack' });
ok(d.farm.backpack === 24, '背包扩到 24 格');
// 换季：春种作物在夏天枯萎
f = flags();
f.plots['5,5'] = { tilled: 1, watered: 1, crop: 'parsnip', grow: 1, fert: '' };
routes.FARM.save('1001');
setDay(29);
P = (await st()).data.farm;
ok(!P.plots['5,5'], '换季后过季作物枯萎');
ok(P.cal.season === 1 && P.cal.dayInSeason === 1, '进入夏 1 日');

console.log('\n== 7. 动物：买 → 喂 → 跨日产出 → 收取 ==');
d = await okCall('/v5/farm/buy', { kind: 'animal', id: 'chicken' });
ok(d.animal && d.animal.kind === 'chicken', '买回一只小鸡');
const auid = d.animal.uid;
d = await okCall('/v5/life/animal', { mode: 'feed', uid: auid });
ok(d.fed === auid && d.farm.inv.hay >= 0, '喂食成功');
await badCall('/v5/life/animal', { mode: 'feed', uid: auid }, '1001', '一天只能喂一次');
d = await okCall('/v5/life/animal', { mode: 'pet', uid: auid });
ok(d.petted === auid, '摸一摸涨好感');
f = flags();
f.animals[0].matureDay = routes.FARM.dayNow();   // 跳过成长等待
routes.FARM.save('1001');
setDay(routes.FARM.dayNow() + 1);
P = (await st()).data.farm;
ok(P.animals[0].product === 'egg', '次日产鸡蛋', P.animals[0]);
d = await okCall('/v5/life/animal', { mode: 'collect', uid: auid });
ok(d.collected === 'egg' || d.collected === 'big_egg', '收取鸡蛋', d.collected);

console.log('\n== 8. 钓鱼：服务端定鱼 / 绿条分数 / 图鉴 ==');
d = await okCall('/v5/life/fish/start', {});
ok(d.fish && d.green > 0 && d.diff > 0, '甩竿拿到鱼与绿条宽度', d.fish);
ok((await st()).data.farm.energy < 100, '甩竿扣体力');
d = await okCall('/v5/life/fish/result', { score: 0.95 });
ok(d.caught && d.farm.fishCaught[d.caught.split('_q')[0]] >= 1, '高分钓上并记入图鉴', d.caught);
await badCall('/v5/life/fish/result', { score: 0.9 }, '1001', '一条鱼只能结算一次');
d = await okCall('/v5/life/fish/start', {});
await okCall('/v5/life/fish/result', { score: 0.1 });
ok(true, '低分脱钩不崩溃');
d = await okCall('/v5/life/fish/start', {});
ok(!d.caught, '下一竿已重置');

console.log('\n== 9. 矿洞：层数 / 电梯 / 矿石 ==');
await badCall('/v5/life/mine/enter', { floor: 40 }, '1001', '没到过的电梯层不能直达');
d = await okCall('/v5/life/mine/enter', { floor: 1 });
ok(d.mine.floor === 1, '从 1 层下矿');
let gotOre = null;
for (let i = 0; i < 8 && !gotOre; i++) {
  const dig = await call('/v5/life/mine/dig', {});
  if (dig.code === 200 && dig.data.got && dig.data.got.length) gotOre = dig.data.got[0];
}
ok(!!gotOre, '挖到矿石', gotOre);
d = await call('/v5/life/mine/dig', {});
ok(d.code === 200, '连续挖掘稳定');
for (let i = 0; i < 8; i++) {
  const s = await call('/v5/life/mine/stair', {});
  if (s.code !== 200) break;
  if (s.data.mine && s.data.mine.floor >= 5) break;
  await call('/v5/life/mine/dig', {});
  await call('/v5/life/mine/dig', {});
}
P = (await st()).data.farm;
ok(P.mineBest >= 1 && P.elevator >= 0, '矿洞进度已落库', { best: P.mineBest, elevator: P.elevator });
d = await okCall('/v5/life/mine/leave', {});
ok(d.mine === null, '离开矿洞');
// v5.6：矿洞当日限 3 次（本节已进过 1 次，再进 2 次后第 4 次拒绝；跨日由 settle 清零）
d = await okCall('/v5/life/mine/enter', { floor: 1 });
d = await okCall('/v5/life/mine/enter', { floor: 1 });
await badCall('/v5/life/mine/enter', { floor: 1 }, '1001', '矿洞当日限 3 次，第 4 次拒绝');

console.log('\n== 10. 村民好感 / 礼物 / 花束 / 结婚 ==');
d = await okCall('/v5/life/talk', { npc: 'shop' });
ok(d.talked === 1 && d.pts >= 20, '每天对话 +20');
await okCall('/v5/life/talk', { npc: 'shop' });
d = await okCall('/v5/life/talk', { npc: 'shop' });
ok(d.talked === 0, '同一天不能重复刷对话');
d = await okCall('/v5/farm/buy', { kind: 'wood', n: 1 });
d = await okCall('/v5/life/gift', { npc: 'smith', item: 'wood' });
ok(d.taste === 'neutral' && d.pts === 20, '一般礼物 +20', d);
f = flags();
f.inv.iron = 3; f.gold = 99999; routes.FARM.save('1001');
d = await okCall('/v5/life/gift', { npc: 'smith', item: 'iron' });
ok(d.taste === 'love' && d.pts >= 80, '阿岩最爱矿石 +80', d);
// 前面「一般礼物」已经算这周第一次，这是第二次，第三次应当被挡
await badCall('/v5/life/gift', { npc: 'smith', item: 'iron' }, '1001', '每周最多送两次礼');
await badCall('/v5/life/bouquet', { npc: 'shop' }, '1001', '好感不够不能送花束');
f = flags();
f.relations.smith = { pts: 2500, talkedDay: 0, gifts: {}, bouquet: 0, seen: [], spouse: 0 };
f.houseLv = 1; f.gold = 99999; routes.FARM.save('1001');
d = await okCall('/v5/life/bouquet', { npc: 'smith' });
ok(d.bouquet === 1, '10 心送花束');
d = await okCall('/v5/life/marry', { npc: 'smith' });
ok(d.spouse === 'smith' && d.farm.spouse === 'smith', '求婚成功，家里有人了');
await badCall('/v5/life/marry', { npc: 'shop' }, '1001', '不能重婚');

console.log('\n== 11. 献祭包 / 温室 / 节日 / 同学送礼 ==');
f = flags();
f.inv.parsnip = 1; f.inv.greenbean = 1; f.inv.cauliflower = 1; f.inv.potato = 1;
routes.FARM.save('1001');
d = await okCall('/v5/life/bundle', { id: 'spring', items: { parsnip: 1, greenbean: 1, cauliflower: 1, potato: 1 } });
ok(d.moved === 4 && d.left === 0 && d.reward, '春日作物包交齐并领奖', d.reward);
await badCall('/v5/life/bundle', { id: 'spring', items: {} }, '1001', '同一包不能重复交');
// 只留最后一包没交，凑齐物品交上去，验证「全部完成 → 温室解锁」
f = flags();
for (const b of FD.DATA.BUNDLES) {
  if (b.id === 'mine') continue;
  f.bundles[b.id] = { items: {}, done: 1 };
  f.rooms[b.room] = (f.rooms[b.room] || 0) + 1;
}
f.inv.copper = 2; f.inv.iron = 2; f.inv.gold = 2; f.inv.coal = 2;
routes.FARM.save('1001');
d = await okCall('/v5/life/bundle', { id: 'mine', items: { copper: 1, iron: 1, gold: 1, coal: 1 } });
ok(d.greenhouse === true, '交齐全部献祭包后温室解锁', d.greenhouse);
setDay(13);   // 春 13 彩蛋节
P = (await st()).data.farm;
ok(P.cal.festival && P.cal.festival.name === '彩蛋节', '春 13 是彩蛋节');
d = await okCall('/v5/life/festival', {});
ok(d.gift && d.farm.inv.seed_strawberry >= 5, '节日领到草莓种子', d.gift);
await badCall('/v5/life/festival', {}, '1001', '一天只能领一次');
setDay(14);
await badCall('/v5/life/festival', {}, '1001', '非节日不能领');
f = flags(); f.inv.egg = 1; routes.FARM.save('1001');
d = await okCall('/v5/life/playergift', { to: '1002', item: 'egg' });
ok(d.sent === 'egg', '给同学送礼物');
const other = (await st('1002')).data.farm;
ok(other.inv.egg === 1, '对方背包里收到了');
await badCall('/v5/life/playergift', { to: '1001', item: 'egg' }, '1001', '不能送给自己');

console.log('\n== 12. 农场入口 / 存档持久化 ==');
d = await okCall('/v5/farm/goto', {});
ok(d.x === FD.DATA.FARM_X + FD.DATA.FARM_W / 2, '服务端把人送到自家田里', d);
store.flush('1001');
P = (await st()).data.farm;
ok(P.gold >= 0 && P.cal.day >= 1 && P.spouse === 'smith', '落库后关键数据仍在');

// ==================== v5.4 ====================
console.log('\n== 13. v5.4 加工：设备 / 配方 / 锭 / 职业价格 ==');
// 没有设备不能加工
await badCall('/v5/life/craft', { id: 'make_mayo', n: 1 }, '1001', '没有蛋黄酱机不能做蛋黄酱');
d = await okCall('/v5/farm/buy', { kind: 'machine', id: 'furnace' });
ok(d.machine === 'furnace' && d.count === 1 && d.farm.machines.furnace === 1, '300g 买下熔炉', d.count);
// 材料不足
f = flags(); f.inv.copper = 2; f.inv.coal = 1; f.energy = 100; routes.FARM.save('1001');
await badCall('/v5/life/craft', { id: 'smelt_copper', n: 1 }, '1001', '铜矿石不够 5 个不能熔');
// 正常熔炼：copper×5 + coal×1 → copper_bar，体力 -3，mining 经验
f = flags(); f.inv.copper = 12; f.inv.coal = 3; f.energy = 100; routes.FARM.save('1001');
const barBefore = f.inv.copper_bar || 0;
d = await okCall('/v5/life/craft', { id: 'smelt_copper', n: 1 });
ok(d.crafted === 'copper_bar' && d.n === 1, '熔出铜锭', d && d.crafted);
ok(d.farm.inv.copper_bar === barBefore + 1 && d.farm.inv.copper === 7 && d.farm.inv.coal === 2, '扣 5 铜 1 煤', { bar: d.farm.inv.copper_bar, cu: d.farm.inv.copper, coal: d.farm.inv.coal });
ok(d.farm.energy === 97, '熔炼扣 3 体力', d.farm.energy);
ok(d.farm.skills.mining >= 9, '熔炼记采矿经验（energy×3）', d.farm.skills.mining);
// ×5
f = flags(); f.inv.copper = 25; f.inv.coal = 6; f.energy = 100; routes.FARM.save('1001');
const barBefore5 = f.inv.copper_bar || 0;
d = await okCall('/v5/life/craft', { id: 'smelt_copper', n: 5 });
ok(d.n === 5 && d.farm.inv.copper_bar === barBefore5 + 5 && d.farm.energy === 85, '×5 一次熔 5 锭扣 15 体力', { bar: d.farm.inv.copper_bar, e: d.farm.energy });
// 体力不够
f = flags(); f.inv.copper = 5; f.inv.coal = 1; f.energy = 2; routes.FARM.save('1001');
await badCall('/v5/life/craft', { id: 'smelt_copper', n: 1 }, '1001', '体力不够时拒绝制作');
// 其余四台设备 + 重复购买计数
d = await okCall('/v5/farm/buy', { kind: 'machine', id: 'mayo_machine' });
d = await okCall('/v5/farm/buy', { kind: 'machine', id: 'cheese_press' });
d = await okCall('/v5/farm/buy', { kind: 'machine', id: 'keg' });
d = await okCall('/v5/farm/buy', { kind: 'machine', id: 'stove' });
ok(d.farm.machines.stove === 1, '五台设备买齐', JSON.stringify(d.farm.machines));
d = await okCall('/v5/farm/buy', { kind: 'machine', id: 'furnace' });
ok(d.count === 2, '设备可重复购买、计数 +1（第 N 台）', d.count);
// 蛋黄酱 / 奶酪 / 淡啤 / 料理
f = flags(); f.inv.egg = 3; f.inv.milk = 2; f.inv.hops = 2; f.inv.parsnip = 4; f.energy = 100; routes.FARM.save('1001');
d = await okCall('/v5/life/craft', { id: 'make_mayo', n: 1 });
ok(d.crafted === 'mayonnaise' && d.farm.inv.mayonnaise === 1, '蛋黄酱机出蛋黄酱');
d = await okCall('/v5/life/craft', { id: 'make_pale_ale', n: 1 });
ok(d.crafted === 'pale_ale' && d.farm.inv.pale_ale === 1, '酿造桶出淡啤');
d = await okCall('/v5/life/craft', { id: 'cook_soup', n: 1 });
ok(d.crafted === 'food_soup' && d.farm.inv.food_soup === 1, '灶台出防风草汤');
f = flags(); f.inv.big_egg = 1; routes.FARM.save('1001');
d = await okCall('/v5/life/craft', { id: 'make_mayo_gold', n: 1 });
ok(d.crafted === 'mayonnaise_q2', '大鸡蛋出金星蛋黄酱', d.crafted);
// artisan：加工品 +40%（第 5 节已选），蛋黄酱 190 → 266
f = flags(); f.inv.mayonnaise = 1; routes.FARM.save('1001');
d = await okCall('/v5/farm/sell', { items: { mayonnaise: 1 } });
ok(d.gold === 266, 'artisan 蛋黄酱 190 → 266', d.gold);
// blacksmith：锭 +50%，铜锭 60 → 90
f = flags(); f.skills.mining = 15000; f.inv.copper_bar = 1; routes.FARM.save('1001');
d = await okCall('/v5/farm/profession', { skill: 'mining', id: 'blacksmith' });
d = await okCall('/v5/farm/sell', { items: { copper_bar: 1 } });
// 主理人裁决：锭归铁匠专属（blacksmith ×1.5），不吃 artisan 加成 —— 60×1.5 = 90ok(d.gold === Math.floor(60 * 1.5), '铁匠锭价 ×1.5（artisan 不叠加金属）', d.gold);
// payload 下发 recipes / machines / eat / forage
P = (await st()).data.farm;
ok(P.recipes && P.recipes.smelt_copper, 'payload 下发配方表');
ok(P.machines && P.machines.furnace === 2, 'payload 下发设备计数');
ok(P.eat && P.eat.food_soup === 40, 'payload 下发可吃表');
ok(Array.isArray(P.forage) && P.forage.length >= 12 && P.forage.length <= 44, 'payload 下发当日采集点（已滤阻挡格，384 地图上限 44）', P.forage.length);

console.log('\n== 14. v5.4 野外采集 / 砍树 / 吃 ==');
let cell = P.forage[0];
d = await okCall('/v5/life/forage/pick', { x: cell.x, y: cell.y });
ok(d.picked === cell.item && d.got.length === 1, '采到野味', d && d.got);
ok(d.farm.forageCd[cell.x + ',' + cell.y] === routes.FARM.dayNow(), '采集格进入冷却登记');
P = (await st()).data.farm;
ok(!P.forage.some(function (p2) { return p2.x === cell.x && p2.y === cell.y; }), '冷却格从当日清单消失');
await badCall('/v5/life/forage/pick', { x: cell.x, y: cell.y }, '1001', '同一格不能重复采');
// botanist：采集必金星
f = flags(); f.skills.foraging = 15000; f.energy = 100; routes.FARM.save('1001');
d = await okCall('/v5/farm/profession', { skill: 'foraging', id: 'botanist' });
cell = P.forage[1];
d = await okCall('/v5/life/forage/pick', { x: cell.x, y: cell.y });
ok(d.got[0] === cell.item + '_q2', 'botanist 采集必金星', d.got);
// gatherer：20% 双份（patch 随机数确定化）
f = flags(); f.skills.foraging = 2150; f.energy = 100; routes.FARM.save('1001');
d = await okCall('/v5/farm/profession', { skill: 'foraging', id: 'gatherer' });
cell = P.forage[2];
const realRandom = Math.random;
Math.random = () => 0.05;
d = await okCall('/v5/life/forage/pick', { x: cell.x, y: cell.y });
Math.random = realRandom;
ok(d.got.length === 2, 'gatherer 20% 双份', d.got);
// 砍树：世界里找真树
const WG = require(SRC + 'worldgen.js');
const world = WG.get();
let tree1 = null, tree2 = null;
for (let y = 2; y < 254 && !tree2; y++) {
  for (let x = 2; x < 254; x++) {
    if (world.grid[y * world.size + x] === WG.TILE.TREE) {
      if (!tree1) tree1 = { x, y };
      else { tree2 = { x, y }; break; }
    }
  }
}
ok(!!tree1 && !!tree2, '世界里找得到两棵树', JSON.stringify([tree1, tree2]));
f = flags(); f.profs = []; f.energy = 100; f.backpack = 36; routes.FARM.save('1001');
d = await okCall('/v5/life/chop', { x: tree1.x, y: tree1.y });
ok(d.got.wood >= 3 && d.got.wood <= 5, '砍树得木材 3~5', d.got);
await badCall('/v5/life/chop', { x: tree1.x, y: tree1.y }, '1001', '同一棵树 3 天内不能重复砍');
await badCall('/v5/life/chop', { x: 0, y: 0 }, '1001', '非树格不能砍');
// 护林人 +1、伐木工硬木 50%（10 级层先让出来再换选）
f = flags(); f.profs = ['gatherer', 'forester']; f.skills.foraging = 15000; f.energy = 100; f.backpack = 36; routes.FARM.save('1001');
d = await okCall('/v5/farm/profession', { skill: 'foraging', id: 'lumberjack' });
ok(d.chosen === 'lumberjack', '换选伐木工', d && d.chosen);
Math.random = () => 0.1;
d = await okCall('/v5/life/chop', { x: tree2.x, y: tree2.y });
Math.random = realRandom;
ok(d.got.wood === 4 && d.got.hardwood === 1, '护林人木材 +1 · 伐木工出硬木', d.got);
// 吃：料理回体力 / 满体力拒吃 / 不可吃
f = flags(); f.inv.food_soup = 2; f.energy = 40; routes.FARM.save('1001');
d = await okCall('/v5/life/eat', { item: 'food_soup' });
ok(d.gain === 40 && d.farm.energy === 80, '吃防风草汤回 40 体力', { gain: d.gain, e: d.farm.energy });
f = flags(); f.energy = f.maxEnergy; routes.FARM.save('1001');
await badCall('/v5/life/eat', { item: 'food_soup' }, '1001', '体力已满时不能吃');
f = flags(); f.inv.wood = 1; routes.FARM.save('1001');
await badCall('/v5/life/eat', { item: 'wood' }, '1001', '木头不能吃');
// 星果：+34 永久，上限 200，落库持久化
f = flags(); f.inv.starfruit = 4; f.maxEnergy = 100; routes.FARM.save('1001');
d = await okCall('/v5/life/eat', { item: 'starfruit' });
ok(d.farm.maxEnergy === 134, '星果 maxEnergy +34', d.farm.maxEnergy);
d = await okCall('/v5/life/eat', { item: 'starfruit' });
d = await okCall('/v5/life/eat', { item: 'starfruit' });
ok(d.farm.maxEnergy === 200, '星果上限 200', d.farm.maxEnergy);
await badCall('/v5/life/eat', { item: 'starfruit' }, '1001', '到 200 后不能再吃');
store.flush('1001');
P = (await st()).data.farm;
ok(P.maxEnergy === 200 && P.inv.starfruit === 1, 'maxEnergy 与剩余星果落库持久化', { cap: P.maxEnergy, left: P.inv.starfruit });

console.log('\n== 15. v5.4 矿洞职业 / 工具升级只认锭 ==');
// 工具升级：铜矿石不再是合格材料
f = flags(); f.gold = 99999; f.toolOrder = null; f.inv.copper = 20; delete f.inv.copper_bar; routes.FARM.save('1001');
await badCall('/v5/farm/tool', { tool: 'watercan' }, '1001', '升级只认铜锭，铜矿石不合格');
f = flags(); f.inv.copper_bar = 5; routes.FARM.save('1001');
d = await okCall('/v5/farm/tool', { tool: 'watercan' });
ok(d.farm.toolOrder && d.farm.toolOrder.lv === 1, '5 个铜锭完成水壶升级下单', d.farm.toolOrder);
// fighter / defender：洞血加成
f = flags(); f.skills.combat = 2150; f.profs = ['fighter', 'defender']; f.energy = 100; f.mineRun = null; f.backpack = 36; routes.FARM.save('1001');
d = await okCall('/v5/life/mine/enter', { floor: 1 });
ok(d.mine.maxHp === Math.round(90 * 1.15) + 25, 'fighter ×1.15 + defender +25', d.mine);
// geologist：宝石成对（floor 20 矿池里 r=0.95 恰好命中宝石位）
f = flags(); f.skills.mining = 2150; f.elevator = Math.max(f.elevator || 0, 20); f.energy = 100; f.mineRun = null; f.backpack = 36; routes.FARM.save('1001');
d = await okCall('/v5/farm/profession', { skill: 'mining', id: 'geologist' });
d = await okCall('/v5/life/mine/enter', { floor: 20 });
Math.random = () => 0.95;
d = await okCall('/v5/life/mine/dig', {});
Math.random = realRandom;
ok(d.got.filter(function (g2) { return g2.indexOf('gem') === 0; }).length === 2, 'geologist 宝石成对', d.got);
// prospector：煤权重 ×2（同 r 命中从铜变煤，确定性对照）
await okCall('/v5/life/mine/leave', {});
f = flags(); f.profs = []; f.energy = 100; f.backpack = 36; routes.FARM.save('1001');
d = await okCall('/v5/life/mine/enter', { floor: 1 });
Math.random = () => 0.65;
const gotNoProf = (await okCall('/v5/life/mine/dig', {})).got[0];
Math.random = realRandom;
await okCall('/v5/life/mine/leave', {});
f = flags(); f.skills.mining = 15000; f.profs = ['geologist']; f.energy = 100; f.backpack = 36; routes.FARM.save('1001');
d = await okCall('/v5/farm/profession', { skill: 'mining', id: 'prospector' });
d = await okCall('/v5/life/mine/enter', { floor: 1 });
Math.random = () => 0.65;
d = await okCall('/v5/life/mine/dig', {});
Math.random = realRandom;
ok(gotNoProf.indexOf('copper') === 0 && d.got[0].indexOf('coal') === 0, 'prospector 煤权重 ×2（同 r 从铜变煤）', { no: gotNoProf, yes: d.got[0] });
// pirate：5% 矿洞宝箱（金币 100~300 + 宝石 ×1）
await okCall('/v5/life/mine/leave', {});
f = flags(); f.profs = ['pirate']; f.gold = 5000; f.energy = 100; f.mineRun = null; f.backpack = 36; routes.FARM.save('1001');
d = await okCall('/v5/life/mine/enter', { floor: 1 });
Math.random = () => 0.01;
d = await okCall('/v5/life/mine/dig', {});
Math.random = realRandom;
ok(d.chest && d.chest.gold >= 100 && d.chest.gold <= 300 && d.chest.gem === 1, 'pirate 5% 宝箱（金币 + 宝石）', d.chest);
ok(d.farm.gold > 5000, '宝箱金币入账', d.farm.gold);

// ==================== v5.5 节日小游戏 ====================
console.log('\n== 16. v5.5 彩蛋节：生成 → 捡蛋 → 兑换 → 跨日拒绝 ==');
setDay(13);   // 春 13 彩蛋节（festivalSeen[13] 已领过礼，不影响彩蛋）
f = flags(); f.inv = {}; f.energy = 100; f.eggTaken = {}; f.eggHunt = { day: 0, found: 0 };
f.eggRedeem = { day: 0, seed_strawberry: 0, speedgro: 0, gold: 0 };
routes.FARM.save('1001');
P = (await st()).data.farm;
ok(Array.isArray(P.eggsLeft) && P.eggsLeft.length === 12, '彩蛋节当日下发 12 颗彩蛋', P.eggsLeft && P.eggsLeft.length);
ok(P.eggHunt && P.eggHunt.total === 12 && P.eggHunt.found === 0, 'eggHunt 进度 0/12', JSON.stringify(P.eggHunt));
ok(P.eggsLeft.every(function (e2) { return typeof e2.i === 'number' && e2.i >= 0 && e2.i < 12; }), '彩蛋带全天稳定索引');
// 捡一颗：egg + ticket 入包、found 同步、剩余 11 颗
const eggIdx = P.eggsLeft[0].i;
d = await okCall('/v5/life/egg/pick', { i: eggIdx });
ok(d.found === 1 && d.egg === 1 && d.ticket === 1, '捡蛋返回 found/egg/ticket', d);
ok(d.farm.inv.egg >= 1 && d.farm.inv.ticket >= 1, '彩蛋与彩券入包', { egg: d.farm.inv.egg, t: d.farm.inv.ticket });
ok(d.farm.eggHunt.found === 1, 'chip 数据 eggHunt.found 同步为 1', d.farm.eggHunt);
P = (await st()).data.farm;
ok(P.eggsLeft.length === 11, '已捡的蛋从剩余列表消失', P.eggsLeft.length);
await badCall('/v5/life/egg/pick', { i: eggIdx }, '1001', '同一颗蛋不能重复捡');
await badCall('/v5/life/egg/pick', { i: 99 }, '1001', '越界索引被拒绝');
// 兑换：券不足拒绝 → 给券 → 换 200 金（1 张）→ 换种子（2 张）→ 当日重复拒绝
f = flags(); f.inv.ticket = 1; routes.FARM.save('1001');
await badCall('/v5/life/egg/redeem', { id: 'seed_strawberry' }, '1001', '彩券不够（要 2 张）不能兑种子');
f = flags(); f.inv.ticket = 5; const goldBefore = f.gold; routes.FARM.save('1001');
d = await okCall('/v5/life/egg/redeem', { id: 'gold' });
ok(d.gold === 200 && d.farm.gold === goldBefore + 200, '彩券 1 张兑 200 金', d.gold);
d = await okCall('/v5/life/egg/redeem', { id: 'seed_strawberry' });
ok(d.n === 5 && d.farm.inv.seed_strawberry >= 5, '彩券 2 张兑草莓种子 ×5', d.n);
ok(d.farm.inv.ticket === 2, '扣掉 2+1 张彩券', d.farm.inv.ticket);
await badCall('/v5/life/egg/redeem', { id: 'gold' }, '1001', '同一奖励当日只能兑一次');
await badCall('/v5/life/egg/redeem', { id: 'nothing' }, '1001', '未知兑换被拒绝');
// 跨日：彩蛋消失、彩券失效
setDay(14);
await badCall('/v5/life/egg/pick', { i: 1 }, '1001', '非彩蛋节不能捡蛋');
await badCall('/v5/life/egg/redeem', { id: 'gold' }, '1001', '彩券只能彩蛋节当天用');
P = (await st()).data.farm;
ok(Array.isArray(P.eggsLeft) && P.eggsLeft.length === 0, '非节日不下发彩蛋', P.eggsLeft && P.eggsLeft.length);

console.log('\n== 17. v5.5 冰雪钓赛：三竿计分 → 第四竿不计 → 达标领奖 → 领后不计 ==');
setDay(92);   // 冬 8 冰雪钓赛（FESTIVALS day [3,8]）
f = flags(); f.fishContest = { day: 0, total: 0, rods: 0, claimed: 0 }; f.energy = 100; f.pendingFish = null;
routes.FARM.save('1001');
let contestSum = 0;
for (let rod = 0; rod < 3; rod++) {
  d = await okCall('/v5/life/fish/start', {});
  ok(d.contest && d.contest.counting === true && d.contest.rods === rod, '第 ' + (rod + 1) + ' 竿计入赛制', d.contest);
  d = await okCall('/v5/life/fish/result', { score: 0.95 });
  if (!d.caught) {   // 极小概率脱钩（0.95 分远高于阈值），重试一次
    d = await okCall('/v5/life/fish/start', {});
    d = await okCall('/v5/life/fish/result', { score: 0.95 });
  }
  ok(d.caught && d.contestCounted === true, '第 ' + (rod + 1) + ' 竿 contestCounted=true', d.contestCounted);
  contestSum = d.contest ? d.contest.total : contestSum;
}
ok(contestSum > 0, '三竿卖价累计 > 0', contestSum);
P = (await st()).data.farm;
ok(P.fishContest.rods === 3, 'fishContest.rods = 3', JSON.stringify(P.fishContest));
d = await okCall('/v5/life/fish/start', {});
ok(d.contest && d.contest.counting === false, '第 4 竿起不再计入', d.contest);
d = await okCall('/v5/life/fish/result', { score: 0.95 });
if (d && !d.caught) {
  d = await okCall('/v5/life/fish/start', {});
  d = await okCall('/v5/life/fish/result', { score: 0.95 });
}
ok(d.caught && d.contestCounted === false, '第 4 竿 contestCounted=false', d.contestCounted);
// 未达标不可领（若三竿恰好 ≥300g 则先验证达标领奖）
if (contestSum < 300) {
  await badCall('/v5/life/fish/contest/claim', {}, '1001', '未达标不能领赛奖');
  f = flags(); f.fishContest.total = 320; routes.FARM.save('1001');
}
const g0 = f.gold, bait0 = f.inv.bait || 0;
d = await okCall('/v5/life/fish/contest/claim', {});
ok(d.claimed === 1 && d.farm.gold === g0 + 800, '领奖 gold+800', d.farm.gold - g0);
ok(d.farm.inv.bait === bait0 + 20, '领奖 bait+20', d.farm.inv.bait - bait0);
await badCall('/v5/life/fish/contest/claim', {}, '1001', '赛奖只能领一次');
// 已领奖继续钓不计分
d = await okCall('/v5/life/fish/start', {});
ok(d.contest && d.contest.counting === false, '领奖后甩竿不计分', d.contest);
d = await okCall('/v5/life/fish/result', { score: 0.95 });
ok(d.caught && d.contestCounted === false, '领奖后渔获照常、赛绩不动', d.contestCounted);
// 非赛日不能领
setDay(93);
await badCall('/v5/life/fish/contest/claim', {}, '1001', '非冰雪钓赛日不能领奖');

console.log('\n== 18. v5.5 丰收展：选 9 样 → 提交锁定 → 奖金入账 → 实物仍在 → 跨年重置 ==');
setDay(72);   // 秋 16 丰收展（FESTIVALS day [2,16]）
f = flags();
const nine9 = ['parsnip_q3', 'melon_q3', 'pumpkin_q3', 'kale_q3', 'potato_q3', 'garlic_q3', 'tulip_q3', 'jazz_q3', 'cauliflower_q3'];
f.inv = {};
for (const it of nine9) f.inv[it] = 1;
f.exhibit = { day: 0, items: null, grade: null };
f.gold = 5000; routes.FARM.save('1001');
await badCall('/v5/life/exhibit/submit', { items: nine9.slice(0, 8) }, '1001', '不足 9 样不能参展');
await badCall('/v5/life/exhibit/submit', { items: nine9.slice(0, 8).concat(['nothing_here']) }, '1001', '不在背包的东西不能参展');
const goldBeforeEx = f.gold;
d = await okCall('/v5/life/exhibit/submit', { items: nine9 });
ok(d.grade === 'S' && d.gold === 1200, '9 种全铱评 S 档 1200g', JSON.stringify({ grade: d.grade, gold: d.gold }));
ok(d.farm.gold === goldBeforeEx + 1200, '奖金入账', d.farm.gold - goldBeforeEx);
ok(d.farm.inv.parsnip_q3 === 1 && d.farm.inv.cauliflower_q3 === 1, '实物不扣', JSON.stringify({ p: d.farm.inv.parsnip_q3, c: d.farm.inv.cauliflower_q3 }));
ok(d.farm.exhibit.grade === 'S' && d.farm.exhibit.day === 72, 'exhibit 状态锁定当日', JSON.stringify(d.farm.exhibit));
await badCall('/v5/life/exhibit/submit', { items: nine9 }, '1001', '同一展台当日不能重复提交');
// 旧 500g 固定档已删除：丰收展领礼不再发钱
const g1 = (await st()).data.farm.gold;
d = await okCall('/v5/life/festival', {});
ok(d.gift && d.gift.indexOf('参展') >= 0, '丰收展领礼只给参展指引', d.gift);
P = (await st()).data.farm;
ok(P.gold === g1, '丰收展领礼不再固定发 500g', P.gold - g1);
// 跨日不能参展；下一年的丰收展重置可再交
setDay(73);
await badCall('/v5/life/exhibit/submit', { items: nine9 }, '1001', '非丰收展日不能提交');
setDay(184);   // 次年秋 16（丰收展 day [2,16]，一季 28 天 × 4 季 = 112 天/年）
f = flags();
f.inv = {};
for (const it of nine9) f.inv[it] = 1;
routes.FARM.save('1001');
d = await okCall('/v5/life/exhibit/submit', { items: nine9 });
ok(d.grade === 'S', '跨年丰收展重置，可再次参展', d.grade);

console.log('\n农场系统联调：' + pass + ' 通过 / ' + fail + ' 失败');
server.close();
process.exit(fail ? 1 : 0);
