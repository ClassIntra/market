// 拾光群岛 v5.3 —— 农场经营「静态数据层」
//
// 这一层是纯数据 + 纯函数：不 require SDK、不碰 db、不碰 express，
// 所以 v5-unit.mjs 可以直接 require 跑断言，客户端也能整份 JSON 下发。
// 数值与系统结构对齐《星露谷物语》1.6 的成熟设计（机制/数值借鉴），
// 名称、文案、美术、代码全部自研，不使用原作素材。

var SEASONS = ['春', '夏', '秋', '冬'];
var SEASON_DAYS = 28;
var DAY_MS = 90000;          // 一个游戏日的真实时长：班级一节课能走过好几季
var START_GOLD = 500;
var START_ENERGY = 100;
var FARM_X = 112;            // 镇子正南的草甸，不与房屋 / 地标冲突
var FARM_Y = 142;
var FARM_W = 12;
var FARM_H = 8;

// 品质：普通 / 银 / 金 / 铱（售价倍率与经验倍率）
var QUALITY = [
  { id: 0, name: '普通', mul: 1, xp: 1, col: '#e8d7a8' },
  { id: 1, name: '银星', mul: 1.25, xp: 1.2, col: '#d8dee6' },
  { id: 2, name: '金星', mul: 1.5, xp: 1.5, col: '#f2c65a' },
  { id: 3, name: '铱星', mul: 2, xp: 2, col: '#b9e6e2' }
];

// 作物：days=初次成熟天数，regrow=复收周期(0=单收)，yield=每次收获个数，
// extra=额外收获概率，seed/sell 单位为金币，xp=基础耕种经验。
// 季节数组里的 0/1/2/3 = 春/夏/秋/冬；空数组 = 只能温室。
var CROPS = {
  parsnip:      { name: '防风草', s: [0], days: 4, regrow: 0, yield: 1, extra: 0,   seed: 20,  sell: 35,  xp: 8,  col: '#d9c98a', shape: 'root' },
  potato:       { name: '土豆',   s: [0], days: 6, regrow: 0, yield: 1, extra: 0.25,seed: 50,  sell: 80,  xp: 14, col: '#c8a56a', shape: 'root' },
  kale:         { name: '甘蓝',   s: [0], days: 6, regrow: 0, yield: 1, extra: 0,   seed: 70,  sell: 110, xp: 17, col: '#6fa268', shape: 'leaf' },
  garlic:       { name: '大蒜',   s: [0], days: 4, regrow: 0, yield: 1, extra: 0,   seed: 40,  sell: 60,  xp: 12, col: '#e2dec0', shape: 'root' },
  tulip:        { name: '郁金香', s: [0], days: 6, regrow: 0, yield: 1, extra: 0,   seed: 20,  sell: 30,  xp: 10, col: '#e06b82', shape: 'flower' },
  jazz:         { name: '蓝爵',   s: [0], days: 7, regrow: 0, yield: 1, extra: 0,   seed: 30,  sell: 50,  xp: 12, col: '#7f8fd8', shape: 'flower' },
  greenbean:    { name: '青豆',   s: [0], days: 10, regrow: 3, yield: 1, extra: 0,  seed: 60,  sell: 40,  xp: 18, col: '#79b95e', shape: 'vine' },
  cauliflower:  { name: '花椰菜', s: [0], days: 12, regrow: 0, yield: 1, extra: 0,  seed: 80,  sell: 175, xp: 28, col: '#e8e2c4', shape: 'leaf' },
  rhubarb:      { name: '大黄',   s: [0], days: 13, regrow: 0, yield: 1, extra: 0,  seed: 100, sell: 220, xp: 30, col: '#d2646c', shape: 'root' },
  strawberry:   { name: '草莓',   s: [0], days: 8, regrow: 4, yield: 1, extra: 0.2, seed: 100, sell: 120, xp: 22, col: '#e05562', shape: 'berry' },

  blueberry:    { name: '蓝莓',   s: [1], days: 13, regrow: 4, yield: 3, extra: 0,  seed: 80,  sell: 50,  xp: 24, col: '#5872bc', shape: 'berry' },
  melon:        { name: '甜瓜',   s: [1], days: 12, regrow: 0, yield: 1, extra: 0,  seed: 80,  sell: 250, xp: 32, col: '#89c46e', shape: 'round' },
  tomato:       { name: '番茄',   s: [1], days: 11, regrow: 4, yield: 1, extra: 0,  seed: 50,  sell: 60,  xp: 18, col: '#dd5b4e', shape: 'round' },
  hotpepper:    { name: '辣椒',   s: [1], days: 5, regrow: 3, yield: 1, extra: 0,   seed: 40,  sell: 40,  xp: 14, col: '#d9483d', shape: 'vine' },
  hops:         { name: '啤酒花', s: [1], days: 11, regrow: 1, yield: 1, extra: 0,  seed: 60,  sell: 25,  xp: 16, col: '#a9c46c', shape: 'vine' },
  corn:         { name: '玉米',   s: [1, 2], days: 14, regrow: 4, yield: 1, extra: 0, seed: 150, sell: 50, xp: 22, col: '#e9c65b', shape: 'vine' },
  wheat:        { name: '小麦',   s: [1, 2], days: 4, regrow: 0, yield: 1, extra: 0, seed: 10, sell: 25, xp: 8, col: '#e3c77c', shape: 'stalk' },
  starfruit:    { name: '杨桃',   s: [1], days: 13, regrow: 0, yield: 1, extra: 0,  seed: 400, sell: 750, xp: 48, col: '#e8dc7a', shape: 'round' },
  poppy:        { name: '罂粟花', s: [1], days: 7, regrow: 0, yield: 1, extra: 0,   seed: 100, sell: 140, xp: 16, col: '#e26a63', shape: 'flower' },
  radish:       { name: '萝卜',   s: [1], days: 6, regrow: 0, yield: 1, extra: 0,   seed: 40,  sell: 90,  xp: 14, col: '#d76a8a', shape: 'root' },
  redcabbage:   { name: '红甘蓝', s: [1], days: 9, regrow: 0, yield: 1, extra: 0,   seed: 100, sell: 260, xp: 26, col: '#a05a86', shape: 'leaf' },
  spangle:      { name: '夏微光', s: [1], days: 8, regrow: 0, yield: 1, extra: 0,   seed: 50,  sell: 90,  xp: 16, col: '#b7a3dd', shape: 'flower' },

  cranberry:    { name: '蔓越莓', s: [2], days: 7, regrow: 5, yield: 2, extra: 0.1, seed: 240, sell: 75, xp: 26, col: '#c8485c', shape: 'berry' },
  pumpkin:      { name: '南瓜',   s: [2], days: 13, regrow: 0, yield: 1, extra: 0,  seed: 100, sell: 320, xp: 38, col: '#e08a3c', shape: 'round' },
  eggplant:     { name: '茄子',   s: [2], days: 5, regrow: 5, yield: 1, extra: 0,   seed: 20,  sell: 60,  xp: 14, col: '#82579a', shape: 'round' },
  grape:        { name: '葡萄',   s: [2], days: 10, regrow: 3, yield: 1, extra: 0,  seed: 60,  sell: 80,  xp: 18, col: '#8e6aa8', shape: 'vine' },
  artichoke:    { name: '洋蓟',   s: [2], days: 8, regrow: 0, yield: 1, extra: 0,   seed: 30,  sell: 160, xp: 22, col: '#7f9a6c', shape: 'leaf' },
  beet:         { name: '甜菜',   s: [2], days: 6, regrow: 0, yield: 1, extra: 0,   seed: 20,  sell: 100, xp: 16, col: '#b74a6c', shape: 'root' },
  yam:          { name: '山药',   s: [2], days: 10, regrow: 0, yield: 1, extra: 0,  seed: 60,  sell: 160, xp: 22, col: '#c39a64', shape: 'root' },
  bokchoy:      { name: '白菜',   s: [2], days: 4, regrow: 0, yield: 1, extra: 0,   seed: 50,  sell: 80,  xp: 12, col: '#9ecb78', shape: 'leaf' },
  amaranth:     { name: '苋菜',   s: [2], days: 7, regrow: 0, yield: 1, extra: 0,   seed: 70,  sell: 150, xp: 18, col: '#b85f7c', shape: 'stalk' },
  fairrose:     { name: '仙女玫瑰', s: [2], days: 12, regrow: 0, yield: 1, extra: 0, seed: 200, sell: 290, xp: 30, col: '#e08a9e', shape: 'flower' },
  ancientfruit: { name: '上古果实', s: [], days: 28, regrow: 7, yield: 1, extra: 0, seed: 0,   sell: 550, xp: 50, col: '#7f6ab0', shape: 'berry' }
};

// 农具：等级 0=基础，1=铜，2=铁，3=金，4=铱。升级要钱 + 锭，且隔天取。
var TOOL_NAMES = { hoe: '锄头', watercan: '浇水壶', axe: '斧头', pickaxe: '镐子', sickle: '镰刀' };
var TOOL_UPGRADES = [
  { lv: 1, name: '铜', cost: 2000, bars: 5, bar: 'copper', days: 1 },
  { lv: 2, name: '铁', cost: 5000, bars: 5, bar: 'iron', days: 1 },
  { lv: 3, name: '金', cost: 10000, bars: 5, bar: 'gold', days: 1 },
  { lv: 4, name: '铱', cost: 25000, bars: 5, bar: 'iridium', days: 1 }
];
// 基础体力消耗（固定，和原作一样：升级的价值在「一次能处理几格」，不在省力气）
var TOOL_ENERGY = { hoe: 2, watercan: 2, axe: 4, pickaxe: 2, sickle: 2, fish: 8, mine: 3 };
var TOOL_RANGE = [1, 3, 5, 9, 18];   // 铜/铁/金/铱逐级解锁的蓄力格数（水壶/锄头）

// 五级技能与职业（5 级选一次、10 级选一次）
var SKILLS = ['farming', 'mining', 'foraging', 'fishing', 'combat'];
var SKILL_NAMES = { farming: '耕种', mining: '采矿', foraging: '采集', fishing: '钓鱼', combat: '战斗' };
var SKILL_XP = [100, 380, 770, 1300, 2150, 3300, 4800, 6900, 10000, 15000];
var PROFESSIONS = {
  farming: { 5: [['tiller', '农夫 · 作物售价 +10%'], ['rancher', '牧场主 · 畜产售价 +20%']],
             10: [['artisan', '工匠 · 加工品 +40%'], ['agriculturist', '农艺师 · 生长 +10%']] },
  mining:  { 5: [['miner', '矿工 · 矿石 +1'], ['geologist', '地质学家 · 宝石成对']],
             10: [['blacksmith', '铁匠 · 锭售价 +50%'], ['prospector', '勘探者 · 煤更多']] },
  foraging:{ 5: [['forester', '护林人 · 木材更多'], ['gatherer', '采集者 · 20% 双份']],
             10: [['lumberjack', '伐木工 · 硬木'], ['botanist', '植物学家 · 采集物必金星']] },
  fishing: { 5: [['fisher', '渔夫 · 鱼价 +25%'], ['trapper', '捕蟹者 · 蟹笼']],
             10: [['angler', '垂钓者 · 鱼价 +50%'], ['pirate', '海盗 · 宝箱翻倍']] },
  combat:  { 5: [['fighter', '战士 · 攻击 +10%'], ['scout', '斥候 · 暴击 +50%']],
             10: [['brute', '蛮人 · 伤害 +15%'], ['defender', '守卫 · 生命 +25']] }
};

// 动物：买价 / 每日产出 / 好感满时的大产出 / 产出基础售价
var ANIMALS = {
  chicken: { name: '小鸡', cost: 800,  days: 3, product: 'egg',      big: 'big_egg',      sell: 50,  bigSell: 95,  feed: 'hay', matures: 3 },
  duck:    { name: '鸭子', cost: 1200, days: 4, product: 'duck_egg', big: 'duck_feather', sell: 95,  bigSell: 125, feed: 'hay', matures: 4 },
  cow:     { name: '奶牛', cost: 1500, days: 5, product: 'milk',     big: 'big_milk',     sell: 125, bigSell: 190, feed: 'hay', matures: 5 },
  goat:    { name: '山羊', cost: 2000, days: 5, product: 'goat_milk',big: 'big_goat_milk',sell: 225, bigSell: 345, feed: 'hay', matures: 5 },
  sheep:   { name: '绵羊', cost: 2000, days: 6, product: 'wool',     big: 'big_wool',     sell: 340, bigSell: 480, feed: 'hay', matures: 6 },
  pig:     { name: '小猪', cost: 3000, days: 10,product: 'truffle',  big: 'truffle',      sell: 625, bigSell: 625, feed: 'hay', matures: 10 }
};

// 鱼：season / weather / 难度(绿条) / 售价 / 经验；按权重抽取
var FISH = [
  { id: 'carp',      name: '鲤鱼',   s: [0,1,2,3], w: 'any',  diff: 15, sell: 30,  xp: 8 },
  { id: 'sunfish',   name: '太阳鱼', s: [0,1],     w: 'sun', diff: 20, sell: 30,  xp: 8 },
  { id: 'catfish',   name: '鲶鱼',   s: [0,2],     w: 'rain',diff: 55, sell: 200, xp: 24 },
  { id: 'bass',      name: '鲈鱼',   s: [0,1,2,3], w: 'any',  diff: 30, sell: 45,  xp: 12 },
  { id: 'trout',     name: '鳟鱼',   s: [0,1],     w: 'sun', diff: 35, sell: 65,  xp: 14 },
  { id: 'sturgeon',  name: '鲟鱼',   s: [1,2],     w: 'any',  diff: 78, sell: 200, xp: 30 },
  { id: 'tuna',      name: '金枪鱼', s: [1,2],     w: 'any',  diff: 55, sell: 100, xp: 20 },
  { id: 'redsnapper',name: '红鲷鱼', s: [1,2,3],   w: 'rain',diff: 40, sell: 160, xp: 20 },
  { id: 'pufferfish',name: '河豚',   s: [1],       w: 'sun', diff: 80, sell: 200, xp: 30 },
  { id: 'halibut',   name: '大比目鱼', s: [1,2,3], w: 'any',  diff: 50, sell: 80,  xp: 18 },
  { id: 'octopus',   name: '章鱼',   s: [1],       w: 'any',  diff: 95, sell: 150, xp: 28 },
  { id: 'eel',       name: '鳗鱼',   s: [0,2],     w: 'rain',diff: 70, sell: 85,  xp: 20 },
  { id: 'squid',     name: '鱿鱼',   s: [3],       w: 'any',  diff: 75, sell: 80,  xp: 20 },
  { id: 'ghostfish', name: '幽灵鱼', s: [0,1,2,3], w: 'any',  diff: 25, sell: 45,  xp: 10 },
  { id: 'legend',    name: '传说之鱼', s: [0],     w: 'rain',diff: 110,sell: 5000,xp: 100 }
];

// 矿洞：120 层，每 5 层电梯；矿石按层段解锁
var MINE_MAX = 120;
var ORES = [
  { id: 'stone',    name: '石头',   from: 1,   sell: 2,   xp: 1 },
  { id: 'copper',   name: '铜矿石', from: 1,   sell: 5,   xp: 2 },
  { id: 'coal',     name: '煤',     from: 1,   sell: 15,  xp: 2 },
  { id: 'iron',     name: '铁矿石', from: 40,  sell: 10,  xp: 3 },
  { id: 'gold',     name: '金矿石', from: 80,  sell: 25,  xp: 5 },
  { id: 'iridium',  name: '铱矿石', from: 110, sell: 100, xp: 10 },
  { id: 'gem',      name: '宝石',   from: 20,  sell: 120, xp: 8 }
];

// 村民：沿用岛上已有的 4 位 NPC，补上生日、礼物偏好与心事件文案。
// 礼物分类：crop / flower / fish / ore / animal / food / gem
var VILLAGERS = {
  smith: { name: '铁匠 阿岩', birthday: [0, 7],  love: ['ore', 'gem'], like: ['food'], hate: ['flower'],
           hearts: [ '你替他把炉子边的矿石码齐了。他没道谢，只是把一把新镐子放在你手边。',
                     '「打铁和守夜是一回事，」阿岩说，「都得有人一直站在火边上。」' ] },
  shop:  { name: '杂货铺 阿禾', birthday: [1, 14], love: ['flower', 'crop'], like: ['food'], hate: ['ore'],
           hearts: [ '阿禾把一包种子塞给你：「这个不要钱，长出来了记得给我看一眼。」',
                     '她说镇上最贵的货其实是「有人回来」，所以她一直守着这间小店。' ] },
  inn:   { name: '客栈 阿灯', birthday: [2, 3],  love: ['food', 'animal'], like: ['flower'], hate: ['fish'],
           hearts: [ '阿灯给你留了一盏灯：「夜里回来，别摸黑走。」',
                     '「我这辈子收过很多房钱，」他说，「最想收的是有人平安进门的声音。」' ] },
  hall:  { name: '守灯人 栗', birthday: [3, 20], love: ['fish', 'gem'], like: ['crop'], hate: ['ore'],
           hearts: [ '栗带你上灯塔，把长夜里第一盏亮起来的灯指给你看。',
                     '「灯不是灯，」她又说了一遍，「是『有人在』的证据。现在这句话里有你。」' ] }
};
var GIFT_TASTE = [
  { id: 'love',    name: '最爱', pts: 80,  mul: 1 },
  { id: 'like',    name: '喜欢', pts: 45,  mul: 1 },
  { id: 'neutral', name: '一般', pts: 20,  mul: 1 },
  { id: 'dislike', name: '不太喜欢', pts: -20, mul: 1 },
  { id: 'hate',    name: '讨厌', pts: -40, mul: 1 }
];

// 季节节日：每季固定日，当天有特殊商店 / 比赛 / 全村送礼加成
var FESTIVALS = [
  { day: [0, 13], name: '彩蛋节', desc: '找彩蛋换彩券，草莓种子今天开卖。', perk: 'strawberry' },
  { day: [0, 24], name: '花舞节', desc: '和同学跳一支舞，好感涨得比平时快。', perk: 'dance' },
  { day: [1, 11], name: '水母之夜', desc: '海边全是发光的水母，钓鱼稀有度提升。', perk: 'fish' },
  { day: [1, 28], name: '夏末烟火', desc: '出货价上浮，今天卖东西最划算。', perk: 'sell' },
  { day: [2, 16], name: '丰收展', desc: '拿九样产物参展，评星换星币。', perk: 'exhibit' },
  { day: [2, 27], name: '万灵夜', desc: '夜里能钓到别处没有的鱼。', perk: 'fish' },
  { day: [3, 8],  name: '冰雪钓赛', desc: '钓上三条就赢，鱼竿绿条更宽。', perk: 'fish' },
  { day: [3, 25], name: '冬星盛宴', desc: '全班互赠礼物，好感翻倍。', perk: 'gift' }
];

// 社区中心献祭包：交齐一组 → 领奖并累计房间进度；全部完成解锁温室（冬季也能种）
var BUNDLES = [
  { id: 'spring',  name: '春日作物包', room: '储藏室', need: ['parsnip','greenbean','cauliflower','potato'], reward: { id: 'speedgro', n: 20 } },
  { id: 'summer',  name: '夏日作物包', room: '储藏室', need: ['tomato','hotpepper','blueberry','melon'],   reward: { id: 'quality_fert', n: 20 } },
  { id: 'fall',    name: '秋日作物包', room: '储藏室', need: ['corn','eggplant','pumpkin','beet'],         reward: { id: 'hay', n: 30 } },
  { id: 'quality', name: '品质作物包', room: '储藏室', need: ['gold_parsnip','gold_melon','gold_pumpkin'],  reward: { id: 'sprinkler', n: 4 } },
  { id: 'river',   name: '河鱼包',     room: '鱼缸',   need: ['sunfish','catfish','trout'],                 reward: { id: 'bait', n: 30 } },
  { id: 'lake',    name: '湖鱼包',     room: '鱼缸',   need: ['bass','carp','sturgeon'],                    reward: { id: 'rod', n: 1 } },
  { id: 'ocean',   name: '海鱼包',     room: '鱼缸',   need: ['tuna','redsnapper','halibut'],               reward: { id: 'rod', n: 1 } },
  { id: 'mine',    name: '矿工包',     room: '锅炉房', need: ['copper','iron','gold','coal'],                reward: { id: 'furnace', n: 1 } },
  { id: 'animal',  name: '牧场包',     room: '畜棚',   need: ['egg','milk','wool','truffle'],               reward: { id: 'hay', n: 30 } },
  { id: 'forage',  name: '野外采集包', room: '工艺室', need: ['wood','stone','gem'],                         reward: { id: 'seeds', n: 30 } }
];

// 商店：种子（按季节过滤）、动物、工具材料、背包扩容
var SHOP_SEED_MARKUP = 1;     // 原作皮埃尔店按种子表原价
var BACKPACK_COSTS = [2000, 10000];   // 12 → 24 → 36 格
var CHEST_COST = 50;          // 木箱：50 木材（这里用金币折算，简化）

// ---------- 纯函数 ----------

function seasonOf(day) { return Math.floor(((Math.max(1, day) - 1) % (SEASON_DAYS * 4)) / SEASON_DAYS); }
function dayInSeason(day) { return ((Math.max(1, day) - 1) % SEASON_DAYS) + 1; }
function yearOf(day) { return Math.floor((Math.max(1, day) - 1) / (SEASON_DAYS * 4)) + 1; }

// 天气按「天数」确定性生成：服务器重启不会把今天的雨变成晴
function weatherFor(day) {
  var h = (day * 2654435761) % 2147483647;
  var r = (h % 1000) / 1000;
  // 开局第一天必定放晴：先让玩家亲手浇一次水，才知道这条循环怎么转
  if (day === 1) return 'sun';
  if (seasonOf(day) === 3) return r < 0.35 ? 'snow' : 'sun';
  return r < 0.25 ? 'rain' : 'sun';
}
function isWet(w) { return w === 'rain' || w === 'snow'; }
function festivalOn(day) {
  var s = seasonOf(day), d = dayInSeason(day);
  for (var i = 0; i < FESTIVALS.length; i++) {
    if (FESTIVALS[i].day[0] === s && FESTIVALS[i].day[1] === d) return FESTIVALS[i];
  }
  return null;
}

// 游戏内时钟：6:00 开始，2:00 收工（20 小时），进度 0~1
function clockOf(progress) {
  var mins = 6 * 60 + Math.floor(Math.max(0, Math.min(1, progress)) * 20 * 60);
  var h24 = Math.floor(mins / 60) % 24, m = mins % 60;
  return (h24 < 10 ? '0' : '') + h24 + ':' + (m < 10 ? '0' : '') + m;
}

// 品质概率：耕种等级 + 肥料抬升，铱星需要铱肥
function qualityRoll(farmingLv, fert, rand) {
  var r = typeof rand === 'number' ? rand : Math.random();
  var base = 0.02 * farmingLv + (fert === 'quality' ? 0.28 : fert === 'deluxe' ? 0.55 : 0);
  var goldChance = Math.min(0.85, base * 0.5);
  var iridiumChance = fert === 'deluxe' ? Math.min(0.5, base * 0.28) : 0;
  if (r < iridiumChance) return 3;
  if (r < iridiumChance + goldChance) return 2;
  if (r < iridiumChance + goldChance + base) return 1;
  return 0;
}
function qualityMul(q) { return QUALITY[q] ? QUALITY[q].mul : 1; }

// 售价：作物基础价 × 品质倍率 × 职业加成
function cropPrice(cropId, q, professions, festivalPerk) {
  var c = CROPS[cropId];
  if (!c) return 0;
  var p = c.sell * qualityMul(q);
  if (professions && professions.indexOf('tiller') >= 0) p *= 1.1;
  if (festivalPerk === 'sell') p *= 1.15;
  return Math.floor(p);
}
function fishPrice(fishId, q, professions, perfect) {
  var f = null;
  for (var i = 0; i < FISH.length; i++) if (FISH[i].id === fishId) { f = FISH[i]; break; }
  if (!f) return 0;
  var p = f.sell * qualityMul(q) * (perfect ? 1.4 : 1);
  if (professions && professions.indexOf('fisher') >= 0) p *= 1.25;
  if (professions && professions.indexOf('angler') >= 0) p *= 1.5;
  return Math.floor(p);
}
function animalPrice(kind, big, professions) {
  var a = ANIMALS[kind]; if (!a) return 0;
  var p = (big ? a.bigSell : a.sell);
  if (professions && professions.indexOf('rancher') >= 0) p *= 1.2;
  return Math.floor(p);
}

// 经验 → 等级（1~10）
function levelOf(xp) {
  var lv = 0;
  for (var i = 0; i < SKILL_XP.length; i++) if (xp >= SKILL_XP[i]) lv = i + 1;
  return lv;
}
function xpToNext(xp) {
  for (var i = 0; i < SKILL_XP.length; i++) if (xp < SKILL_XP[i]) return SKILL_XP[i] - xp;
  return 0;
}

// 好感：每心 250 点，10 心封顶；送过花束才能超过 8 心
var HEART_PTS = 250;
function heartsOf(pts) { return Math.min(10, Math.floor(Math.max(0, pts) / HEART_PTS)); }
function tasteOf(villager, category) {
  if (!villager) return 'neutral';
  if (villager.love && villager.love.indexOf(category) >= 0) return 'love';
  if (villager.hate && villager.hate.indexOf(category) >= 0) return 'hate';
  if (villager.like && villager.like.indexOf(category) >= 0) return 'like';
  return 'neutral';
}
function giftPoints(taste, quality, birthday, festivalPerk) {
  var pts = 20;
  for (var i = 0; i < GIFT_TASTE.length; i++) if (GIFT_TASTE[i].id === taste) pts = GIFT_TASTE[i].pts;
  if (pts > 0) pts = Math.round(pts * (1 + quality * 0.125));
  if (birthday) pts *= 8;
  if (festivalPerk === 'gift') pts *= 2;
  return Math.round(pts);
}

// 作物阶段：0 空地 / 1~n 生长中 / -1 可收。只看「浇过水的天数」
function growthOf(plot, day, speedBonus) {
  if (!plot || !plot.crop) return { stage: 0, ready: false, progress: 0 };
  var c = CROPS[plot.crop]; if (!c) return { stage: 0, ready: false, progress: 0 };
  var grow = plot.grow || 0;
  var need = Math.max(1, Math.round(c.days * (speedBonus ? 0.9 : 1)));
  if (plot.harvested && c.regrow) {
    var since = day - (plot.regrowDay || day);
    return { stage: c.days, ready: since >= c.regrow, progress: Math.min(1, since / c.regrow) };
  }
  return { stage: grow, ready: grow >= need, progress: Math.min(1, grow / need), need: need };
}

function seedList(day, greenhouse) {
  var s = seasonOf(day), out = [];
  for (var k in CROPS) {
    if (!Object.prototype.hasOwnProperty.call(CROPS, k)) continue;
    var c = CROPS[k];
    if (c.seed <= 0) continue;                       // 上古种子不走商店
    if (greenhouse || c.s.indexOf(s) >= 0) out.push(k);
  }
  return out;
}

var DATA = {
  SEASONS: SEASONS, SEASON_DAYS: SEASON_DAYS, DAY_MS: DAY_MS,
  START_GOLD: START_GOLD, START_ENERGY: START_ENERGY,
  FARM_X: FARM_X, FARM_Y: FARM_Y, FARM_W: FARM_W, FARM_H: FARM_H,
  QUALITY: QUALITY, CROPS: CROPS, TOOL_NAMES: TOOL_NAMES,
  TOOL_UPGRADES: TOOL_UPGRADES, TOOL_ENERGY: TOOL_ENERGY, TOOL_RANGE: TOOL_RANGE,
  SKILLS: SKILLS, SKILL_NAMES: SKILL_NAMES, SKILL_XP: SKILL_XP, PROFESSIONS: PROFESSIONS,
  ANIMALS: ANIMALS, FISH: FISH, MINE_MAX: MINE_MAX, ORES: ORES,
  VILLAGERS: VILLAGERS, GIFT_TASTE: GIFT_TASTE, FESTIVALS: FESTIVALS, BUNDLES: BUNDLES,
  BACKPACK_COSTS: BACKPACK_COSTS, HEART_PTS: HEART_PTS,
  SHOP_SEED_MARKUP: SHOP_SEED_MARKUP, CHEST_COST: CHEST_COST
};

module.exports = {
  DATA: DATA,
  seasonOf: seasonOf, dayInSeason: dayInSeason, yearOf: yearOf,
  weatherFor: weatherFor, isWet: isWet, festivalOn: festivalOn, clockOf: clockOf,
  qualityRoll: qualityRoll, qualityMul: qualityMul,
  cropPrice: cropPrice, fishPrice: fishPrice, animalPrice: animalPrice,
  levelOf: levelOf, xpToNext: xpToNext,
  heartsOf: heartsOf, tasteOf: tasteOf, giftPoints: giftPoints,
  growthOf: growthOf, seedList: seedList
};
