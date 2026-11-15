// 拾光群岛 v5.3 —— 农场经营全系统联调（内存库，不碰生产）
//
// 用法：
//   NODE_PATH=D:/tmp/sg5node;D:/NetWork/Integration/ClassIntra/server/node_modules \
//     "C:/Program Files/nodejs/node.exe" test/v5-farm.mjs
import { createRequire } from 'node:module';
import { setTimeout as sleep } from 'node:timers/promises';

const require = createRequire(import.meta.url);
const NM = 'D:/NetWork/Integration/ClassIntra/server/node_modules/';
const SRC = 'D:/NetWork/Integration/market/apps/shiguang/backend/v5/';
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
function flags(uid) { const f = routes.FARM.of(uid || '1001'); routes.FARM.save(uid || '1001'); return f; }
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
ok(d.slept > 0 && d.farm.energy === 100, '睡觉回满体力');
f = flags();
f.gold = 99999; f.inv.copper = 20; f.inv.iron = 20; f.inv.gold = 20; f.inv.iridium = 20;
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

console.log('\n农场系统联调：' + pass + ' 通过 / ' + fail + ' 失败');
server.close();
process.exit(fail ? 1 : 0);
