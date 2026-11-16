// 拾光群岛 v5「长夜」—— 游戏数据：区域、怪物、武器、词条、物品
//
// 怪物的 sprite 字段对应 frontend/img/v5/mon/<sprite>.png（Ninja Adventure，CC0）。
// 每种怪物都有「一个逼你改打法的特点」—— 见 DESIGN-v5.md §3。
'use strict';

// ---------------- 区域 ----------------
// ring：离世界中心的环序（0 = 拾光镇安全区）。lv：该区怪物等级区间。
var ZONES = [
  { id: 'town',   name: '拾光镇',   ring: 0, lv: [1, 1],   safe: true,  music: 'town',    color: '#f3d9a4',
    desc: '长夜之后最后一盏还亮着的灯。所有人从这里出发。' },
  { id: 'meadow', name: '晨光草原', ring: 1, lv: [1, 6],   music: 'meadow',  color: '#9bd36a',
    desc: '风吹过的地方，草会发光。史莱姆在这里晒太阳。' },
  { id: 'forest', name: '雾隐林',   ring: 2, lv: [6, 12],  music: 'forest',  color: '#4f9a6a',
    desc: '雾是长夜的呼吸。林子里的眼睛，比树还多。' },
  { id: 'swamp',  name: '萤火泽',   ring: 3, lv: [11, 17], music: 'swamp',   color: '#6a8a4a',
    desc: '萤火虫是迷路的灯。别跟着它们走太远。' },
  { id: 'crag',   name: '星坠岩',   ring: 4, lv: [16, 22], music: 'crag',    color: '#b08a6a',
    desc: '一颗星星掉在这里，砸出了一座山。山里住着不肯走的骑士。' },
  { id: 'frost',  name: '霜屿',     ring: 5, lv: [21, 27], music: 'frost',   color: '#cfe6f2',
    desc: '长夜在这里结了冰。冰下面，有东西在敲。' },
  { id: 'abyss',  name: '长夜之心', ring: 6, lv: [27, 30], music: 'abyss',   color: '#4a3a6a',
    desc: '所有黑暗流出来的地方。' }
];

// ---------------- 怪物 ----------------
// ai：行为模板（服务端 sim.js 实现）
//   hopper   蓄力跳扑          brute    慢、范围挥击
//   shooter  保持距离发射光弹    bomber   死后/近身爆炸
//   dasher   快速直线突进       shield   正面减伤，背后弱
//   ghost    穿墙、怕光、夜间出现  charger  冲撞后眩晕自己
//   caster   召唤/环形弹幕       swarm    成群、低血、快
// 数值是 1 级基准，按等级成长（sim.js scaleMonster）。
var MONSTERS = {
  slime:     { name: '果冻史莱姆', sprite: 'Slime',      ai: 'hopper',  hp: 22,  atk: 6,  spd: 2.2, xp: 6,   zone: 'meadow',
               tell: 520, range: 2.6, cd: 1800, tip: '蓄力会鼓起来，看准了翻滚。' },
  slime2:    { name: '薄荷史莱姆', sprite: 'Slime2',     ai: 'hopper',  hp: 30,  atk: 8,  spd: 2.6, xp: 8,   zone: 'meadow',
               tell: 460, range: 3.2, cd: 1600, split: 'slime', tip: '打碎会分裂成两只小的。' },
  bamboo:    { name: '竹精',       sprite: 'Bamboo',     ai: 'brute',   hp: 55,  atk: 11, spd: 1.5, xp: 12,  zone: 'meadow',
               tell: 700, range: 2.2, cd: 2200, arc: 140, tip: '挥击范围大，打完就退。' },
  mouse:     { name: '偷灯鼠',     sprite: 'Mouse',      ai: 'swarm',   hp: 12,  atk: 4,  spd: 4.2, xp: 4,   zone: 'meadow',
               tell: 260, range: 1.2, cd: 900, pack: 3, tip: '成群出现，回旋斩一次清一片。' },
  eye:       { name: '雾眼',       sprite: 'Eye',        ai: 'shooter', hp: 34,  atk: 9,  spd: 1.8, xp: 14,  zone: 'forest',
               tell: 600, range: 8, cd: 2000, shot: { spd: 7, n: 1 }, tip: '远程。走 Z 字逼近。' },
  mushroom:  { name: '孢子菇',     sprite: 'Mushroom',   ai: 'bomber',  hp: 40,  atk: 14, spd: 2.0, xp: 15,  zone: 'forest',
               tell: 900, range: 1.6, cd: 2600, boom: 2.4, tip: '死后会炸，打完别贴脸。' },
  owl:       { name: '夜枭',       sprite: 'Owl',        ai: 'dasher',  hp: 38,  atk: 12, spd: 3.0, xp: 16,  zone: 'forest',
               tell: 480, range: 6, cd: 2400, dash: 13, tip: '俯冲前会停一下。' },
  beast:     { name: '林兽',       sprite: 'Beast',      ai: 'charger', hp: 80,  atk: 16, spd: 2.2, xp: 22,  zone: 'forest',
               tell: 800, range: 7, cd: 3200, dash: 14, tip: '冲撞撞墙会晕，晕的时候打它。' },
  snake:     { name: '泽蛇',       sprite: 'Snake',      ai: 'dasher',  hp: 46,  atk: 15, spd: 3.4, xp: 20,  zone: 'swamp',
               tell: 360, range: 5, cd: 1700, dash: 16, tip: '突进极快，练完美闪避的好老师。' },
  frog:      { name: '泽蛙法师',   sprite: 'Axolot',     ai: 'caster',  hp: 50,  atk: 13, spd: 1.6, xp: 24,  zone: 'swamp',
               tell: 800, range: 7, cd: 2800, shot: { spd: 5, n: 8 }, tip: '环形弹幕，找缝隙。' },
  larva:     { name: '萤虫',       sprite: 'Larva',      ai: 'swarm',   hp: 20,  atk: 8,  spd: 3.8, xp: 8,   zone: 'swamp',
               tell: 300, range: 1.2, cd: 1000, pack: 4, tip: '一群一群的。' },
  lantern:   { name: '迷途灯笼',   sprite: 'LanternRed', ai: 'bomber',  hp: 36,  atk: 18, spd: 2.8, xp: 20,  zone: 'swamp',
               tell: 700, range: 1.4, cd: 2000, boom: 2.8, tip: '贴上来自爆。拉开距离再打。' },
  skull:     { name: '守岩骷髅',   sprite: 'Skull',      ai: 'shield',  hp: 90,  atk: 18, spd: 2.0, xp: 30,  zone: 'crag',
               tell: 620, range: 2.0, cd: 1900, tip: '正面有盾，翻滚到它背后。' },
  cyclope:   { name: '独眼巨魔',   sprite: 'Cyclope',    ai: 'brute',   hp: 140, atk: 24, spd: 1.6, xp: 40,  zone: 'crag',
               tell: 900, range: 2.8, cd: 2600, arc: 180, tip: '慢，但一下很疼。' },
  mole:      { name: '掘岩鼹',     sprite: 'Mole',       ai: 'hopper',  hp: 60,  atk: 17, spd: 2.6, xp: 26,  zone: 'crag',
               tell: 560, range: 4.0, cd: 2100, tip: '钻地后从脚下冒出。' },
  reptile:   { name: '霜蜥',       sprite: 'Reptile2',   ai: 'dasher',  hp: 80,  atk: 22, spd: 3.6, xp: 34,  zone: 'frost',
               tell: 400, range: 6, cd: 1800, dash: 16, tip: '冰面上冲得更远。' },
  spirit2:   { name: '冰魄',       sprite: 'Spirit2',    ai: 'shooter', hp: 70,  atk: 20, spd: 2.0, xp: 34,  zone: 'frost',
               tell: 520, range: 9, cd: 1700, shot: { spd: 8, n: 3 }, tip: '三连发扇形。' },
  dragon:    { name: '幼龙',       sprite: 'Dragon',     ai: 'caster',  hp: 110, atk: 24, spd: 2.2, xp: 44,  zone: 'frost',
               tell: 800, range: 8, cd: 2600, shot: { spd: 6, n: 12 }, tip: '弹幕很密，贴身打。' },
  octopus:   { name: '渊章',       sprite: 'Octopus2',   ai: 'caster',  hp: 140, atk: 28, spd: 2.0, xp: 56,  zone: 'abyss',
               tell: 700, range: 8, cd: 2200, shot: { spd: 6, n: 10 }, tip: '' },
  flam:      { name: '长夜火',     sprite: 'Flam2',      ai: 'bomber',  hp: 90,  atk: 34, spd: 3.2, xp: 50,  zone: 'abyss',
               tell: 600, range: 1.6, cd: 1800, boom: 3.0, tip: '' },
  // 夜间全图出没
  ghost:     { name: '长夜幽灵',   sprite: 'Spirit',     ai: 'ghost',   hp: 30,  atk: 10, spd: 2.4, xp: 14,  zone: '*night',
               tell: 500, range: 1.4, cd: 1400, tip: '夜里才出现，怕光。往灯边打。' }
};

// 区域守护者（点亮区域灯塔前必须击败）
var BOSSES = {
  meadow: { name: '巨蛙王·呱呱', sprite: 'GiantFrog',        hp: 900,   atk: 16, lv: 6,  xp: 300,
            phases: ['leap', 'tongue', 'summon:slime'], title: '草原的老国王，长夜让它忘了自己是谁。' },
  forest: { name: '天狗·苍',     sprite: 'TenguBlue',        hp: 2400,  atk: 26, lv: 12, xp: 900,
            phases: ['dash', 'feathers', 'teleport'],    title: '雾隐林的守林人，现在只守着雾。' },
  swamp:  { name: '巨浣熊·金爪', sprite: 'GiantRacoonGold',  hp: 4200,  atk: 34, lv: 17, xp: 1800,
            phases: ['swipe', 'roll', 'steal'],           title: '偷光了萤火泽所有的灯，藏在自己肚子里。' },
  crag:   { name: '赤武士·焰',   sprite: 'GiantRedSamurai',  hp: 7000,  atk: 44, lv: 22, xp: 3200,
            phases: ['combo', 'dash', 'quake'],           title: '守山的骑士。没人告诉他，战争早就结束了。' },
  frost:  { name: '冰魂·霜',     sprite: 'GiantSpirit',      hp: 10000, atk: 52, lv: 27, xp: 5200,
            phases: ['nova', 'shards', 'freeze'],         title: '' },
  abyss:  { name: '长夜之主',     sprite: 'DemonCyclop',      hp: 30000, atk: 64, lv: 30, xp: 20000,
            phases: ['nova', 'summon:ghost', 'dash', 'beam'], title: '它不是怪物。它是所有熄灭的灯。', world: true, lights: true }
};

// ---------------- 武器 ----------------
// kind 决定普攻手感（前端 combat 模块按 kind 选动画与判定形状）
var WEAPON_KINDS = {
  sword: { name: '剑',   reach: 1.9, arc: 120, speed: 1.0,  combo: [1.0, 1.0, 1.8], icon: 'Sword' },
  lance: { name: '长枪', reach: 2.8, arc: 40,  speed: 0.8,  combo: [1.2, 1.2, 2.0], icon: 'Lance' },
  twin:  { name: '双刃', reach: 1.5, arc: 150, speed: 1.55, combo: [0.6, 0.6, 0.6, 0.6, 1.4], icon: 'Sai' },
  staff: { name: '法杖', reach: 9,   arc: 0,   speed: 0.9,  combo: [1.0, 1.0, 1.6], icon: 'MagicWand', ranged: true, mpCost: 2 },
  hammer:{ name: '战锤', reach: 2.1, arc: 160, speed: 0.65, combo: [1.6, 2.6], icon: 'Hammer', stagger: true }
};

var WEAPONS = [
  { id: 'w_stick',   kind: 'sword', name: '木棍',       atk: 4,  lv: 1,  sprite: 'Stick' },
  { id: 'w_katana',  kind: 'sword', name: '拾光太刀',   atk: 8,  lv: 3,  sprite: 'Katana' },
  { id: 'w_sword2',  kind: 'sword', name: '守灯人之剑', atk: 18, lv: 12, sprite: 'Sword2' },
  { id: 'w_bigsw',   kind: 'sword', name: '星陨大剑',   atk: 32, lv: 22, sprite: 'BigSword' },
  { id: 'w_lance',   kind: 'lance', name: '竹枪',       atk: 7,  lv: 2,  sprite: 'Lance' },
  { id: 'w_lance2',  kind: 'lance', name: '霜枪',       atk: 26, lv: 20, sprite: 'Lance2' },
  { id: 'w_sai',     kind: 'twin',  name: '萤刃',       atk: 6,  lv: 4,  sprite: 'Sai' },
  { id: 'w_ninjaku', kind: 'twin',  name: '影刃',       atk: 20, lv: 16, sprite: 'Ninjaku' },
  { id: 'w_wand',    kind: 'staff', name: '灯芯杖',     atk: 7,  lv: 3,  sprite: 'MagicWand' },
  { id: 'w_rod',     kind: 'staff', name: '星辉法杖',   atk: 24, lv: 18, sprite: 'Rod' },
  { id: 'w_hammer',  kind: 'hammer',name: '岩锤',       atk: 14, lv: 8,  sprite: 'Hammer' },
  { id: 'w_axe',     kind: 'hammer',name: '巨魔斧',     atk: 30, lv: 21, sprite: 'Axe' }
];

// 护符与披风（只给词条，不改手感）
var TRINKETS = [
  { id: 't_shell',  slot: 'charm', name: '贝壳护符', lv: 1,  sprite: 'Shell' },
  { id: 't_heart',  slot: 'charm', name: '心形坠子', lv: 6,  sprite: 'Heart' },
  { id: 't_gem',    slot: 'charm', name: '星核',     lv: 14, sprite: 'GemRed' },
  { id: 'c_cloth',  slot: 'cape',  name: '旅人斗篷', lv: 1,  sprite: 'Cape' },
  { id: 'c_night',  slot: 'cape',  name: '夜行斗篷', lv: 10, sprite: 'Cape2' },
  { id: 'c_dawn',   slot: 'cape',  name: '晨曦披风', lv: 20, sprite: 'Cape3' }
];

// ---------------- 稀有度与词条 ----------------
var RARITY = [
  { id: 0, name: '普通', color: '#e8e2d4', affixes: 0, mul: 1.0,  w: 60 },
  { id: 1, name: '精良', color: '#7fd36a', affixes: 1, mul: 1.15, w: 26 },
  { id: 2, name: '稀有', color: '#5fa8ff', affixes: 2, mul: 1.3,  w: 10 },
  { id: 3, name: '史诗', color: '#c07bff', affixes: 3, mul: 1.5,  w: 3.4 },
  { id: 4, name: '传说', color: '#ffb84a', affixes: 4, mul: 1.8,  w: 0.6 }
];

// v：每级成长后的基准值（实际 = v × (0.6~1.0 随机) × 物品等级系数）
var AFFIXES = {
  atk:     { name: '攻击',     v: 1.2,  fmt: '+{v}' },
  hp:      { name: '生命',     v: 6,    fmt: '+{v}' },
  crit:    { name: '暴击率',   v: 0.4,  fmt: '+{v}%', cap: 35 },
  critDmg: { name: '暴击伤害', v: 2.0,  fmt: '+{v}%', cap: 150 },
  leech:   { name: '吸血',     v: 0.15, fmt: '+{v}%', cap: 8 },
  mpGain:  { name: '灯火回复', v: 1.5,  fmt: '+{v}%', cap: 60 },
  speed:   { name: '移速',     v: 0.3,  fmt: '+{v}%', cap: 18 },
  dodgeCd: { name: '翻滚冷却', v: 0.5,  fmt: '-{v}%', cap: 30 },
  skill:   { name: '技能伤害', v: 1.5,  fmt: '+{v}%', cap: 80 },
  night:   { name: '夜战',     v: 1.2,  fmt: '夜间伤害 +{v}%', cap: 50 }
};

// ---------------- 技能 ----------------
var SKILLS = {
  spin:   { name: '灯火回旋', mp: 18, cd: 4000,  dmg: 1.6, radius: 2.8, lv: 1,  desc: '周身一圈光刃，清群怪。' },
  dash:   { name: '影步斩',   mp: 14, cd: 3200,  dmg: 2.2, dist: 6,     lv: 4,  desc: '向前冲刺并斩击路径上所有敌人，冲刺中无敌。' },
  nova:   { name: '星爆',     mp: 30, cd: 9000,  dmg: 3.4, radius: 4.2, lv: 9,  desc: '蓄力后爆炸，击退并点燃。' },
  lamp:   { name: '守夜灯',   mp: 24, cd: 20000, dur: 12000, radius: 4, lv: 6,  desc: '放下一盏灯：范围内队友回血，幽灵不敢靠近。' },
  arrows: { name: '流星雨',   mp: 36, cd: 12000, dmg: 1.0, n: 12, radius: 5, lv: 14, desc: '指定区域落下 12 颗流星。' }
};

// ---------------- 天赋（三条线，每条 5 层）----------------
var TALENTS = {
  blade: { name: '剑', color: '#ff8a6a', tiers: [
    { id: 'b1', name: '锋利',     desc: '攻击 +8%',            mod: { atkPct: 8 } },
    { id: 'b2', name: '连斩',     desc: '连击最后一段伤害 +25%', mod: { finisher: 25 } },
    { id: 'b3', name: '破甲',     desc: '对精英与守护者伤害 +15%', mod: { eliteDmg: 15 } },
    { id: 'b4', name: '嗜血',     desc: '吸血 +3%',            mod: { leech: 3 } },
    { id: 'b5', name: '剑舞',     desc: '普攻每 5 次自动释放一次小回旋', mod: { autoSpin: 1 } }
  ] },
  shadow: { name: '影', color: '#9a8aff', tiers: [
    { id: 's1', name: '轻身',     desc: '移速 +6%',            mod: { speed: 6 } },
    { id: 's2', name: '残影',     desc: '翻滚冷却 -20%',       mod: { dodgeCd: 20 } },
    { id: 's3', name: '致命',     desc: '暴击率 +8%',          mod: { crit: 8 } },
    { id: 's4', name: '见切',     desc: '完美闪避窗口 +60%，子弹时间更长', mod: { perfect: 60 } },
    { id: 's5', name: '影袭',     desc: '完美闪避后瞬移到敌人背后并暴击', mod: { shadowStrike: 1 } }
  ] },
  lamp: { name: '灯', color: '#ffd36a', tiers: [
    { id: 'l1', name: '暖光',     desc: '生命 +12%',           mod: { hpPct: 12 } },
    { id: 'l2', name: '添油',     desc: '灯火回复 +30%',       mod: { mpGain: 30 } },
    { id: 'l3', name: '照夜',     desc: '夜间视野 +50%，对幽灵伤害 +40%', mod: { nightSight: 50 } },
    { id: 'l4', name: '共明',     desc: '身边 6 格内队友攻击 +10%', mod: { aura: 10 } },
    { id: 'l5', name: '不灭',     desc: '致命伤害时保留 1 点生命（每 90 秒一次）', mod: { cheatDeath: 1 } }
  ] }
};


// ---------------- 支线（每个 NPC 一条三步小故事）----------------
// 不做「接任务 / 交任务」两段式：走到人面前，条件满足就能交 —— 校园里没人记得住任务日志。
// need.type：mats（交材料，交付时扣除） / kill（在某区击杀数，累计） / tower（点亮灯塔座数）
var QUESTS = {
  q_smith: {
    npc: 'smith', name: '炉火不熄', color: '#ffb066',
    intro: '阿岩把一块烧红的铁按进水里，白雾腾起来：「想让我打点真东西？先证明你搬得动料。」',
    steps: [
      { type: 'mats', id: 'ore', n: 3, say: '三块星岩矿。别问我为什么不用便宜的 —— 便宜的会断。' },
      { type: 'mats', id: 'ice', n: 2, say: '永冻晶，两块。霜屿的冰，敲下来还会自己长回去。' },
      { type: 'kill', zone: 'crag', n: 12, say: '去星坠岩，把那群守岩的骷髅揍服帖。十二个，我数着。' }
    ],
    reward: { shards: 260, item: { minRarity: 2, slot: 'weapon' }, text: '阿岩给你打了一把刀' }
  },
  q_shop: {
    npc: 'shop', name: '夜里的货单', color: '#8fd6ff',
    intro: '阿禾正在关窗：「天快黑了。你要是顺路，帮我个忙？」',
    steps: [
      { type: 'kill', zone: 'meadow', n: 6, say: '草原上那几只史莱姆，把我要的灯芯吃了。六只。' },
      { type: 'mats', id: 'firefly', n: 3, say: '萤火虫，三只。装在瓶子里就行，别捏死它们。' },
      { type: 'mats', id: 'feather', n: 4, say: '夜枭的羽毛，四根。有人订了一把扇子。' }
    ],
    reward: { shards: 200, item: { minRarity: 1, slot: 'charm' }, text: '阿禾塞给你一件压箱底的护符' }
  },
  q_inn: {
    npc: 'inn', name: '客栈的灯', color: '#e0b6ff',
    intro: '阿灯把最后一盏灯芯拨亮：「这店开了很久了，灯从没同时灭过。」',
    steps: [
      { type: 'mats', id: 'wood', n: 6, say: '灵竹六根。灯架该修了，晃得慌。' },
      { type: 'kill', zone: 'forest', n: 10, say: '雾隐林那边最近不干净。你去清一清，十只。' },
      { type: 'tower', n: 1, say: '点亮一座灯塔吧。灯这东西，多一盏，夜里就长一寸。' }
    ],
    reward: { shards: 240, item: { minRarity: 2, slot: 'cape' }, text: '阿灯把一条旧披风叠好递给你' }
  },
  q_hall: {
    npc: 'hall', name: '她在数灯', color: '#ffd98a',
    intro: '栗站在门口，望着镇外：「你听见了吗？长夜在数我们的灯。」',
    steps: [
      { type: 'kill', zone: 'swamp', n: 14, say: '萤火泽的蛇最近爬得太近了。十四只，让它们退回去。' },
      { type: 'mats', id: 'ember', n: 2, say: '长夜余烬，两块。黑色的火，还热着的那种。' },
      { type: 'tower', n: 3, say: '点亮三座灯塔。点亮第三座的时候，你会明白我在说什么。' }
    ],
    reward: { shards: 520, item: { minRarity: 3, slot: 'weapon' }, text: '栗把一柄旧剑交给你：「先行者的。」' }
  }
};

// 潮汐：全班共享的世界事件（每 30~45 分钟一次，持续 3 分钟）
var TIDE = {
  waves: 5,
  perWave: 4,
  bossMul: 1.8,
  reward: [260, 180, 120, 80, 60]
};

// ---------------- 材料与消耗品 ----------------
var ITEMS = {
  shard:   { name: '星屑',     icon: 'Coin',       desc: '通用货币。' },
  gel:     { name: '果冻',     icon: 'Gel',        sell: 2,  desc: '史莱姆身上掉下来的。' },
  wood:    { name: '灵竹',     icon: 'Branch',     sell: 3,  desc: '竹精的骨头，很轻很韧。' },
  feather: { name: '夜羽',     icon: 'Feather',    sell: 5,  desc: '从夜枭身上落下来，摸起来是凉的。' },
  spore:   { name: '孢子',     icon: 'Mushroom',   sell: 5,  desc: '' },
  scale:   { name: '泽鳞',     icon: 'Scale',      sell: 8,  desc: '' },
  firefly: { name: '萤火',     icon: 'Light',      sell: 10, desc: '一只装在瓶子里的萤火虫，它不想走。' },
  bone:    { name: '骨片',     icon: 'Bone',       sell: 12, desc: '' },
  ore:     { name: '星岩矿',   icon: 'Ore',        sell: 14, desc: '' },
  ice:     { name: '永冻晶',   icon: 'Crystal',    sell: 20, desc: '' },
  ember:   { name: '长夜余烬', icon: 'Ember',      sell: 40, desc: '黑色的火。还是热的。' },
  potion:  { name: '回血药',   icon: 'PotionRed',  use: { heal: 0.45 }, price: 15, desc: '回复 45% 生命。' },
  ether:   { name: '灯油',     icon: 'PotionBlue', use: { mp: 0.6 },    price: 12, desc: '回复 60% 灯火。' }
};

// 各区掉落的材料（怪物击杀时按区域抽）
var ZONE_MATS = {
  meadow: ['gel', 'wood'],
  forest: ['feather', 'spore', 'wood'],
  swamp:  ['scale', 'firefly', 'spore'],
  crag:   ['bone', 'ore'],
  frost:  ['ice', 'ore'],
  abyss:  ['ember', 'ice'],
  '*night': ['firefly', 'ember']
};

module.exports = {
  QUESTS: QUESTS,
  TIDE: TIDE,
  ZONES: ZONES,
  MONSTERS: MONSTERS,
  BOSSES: BOSSES,
  WEAPON_KINDS: WEAPON_KINDS,
  WEAPONS: WEAPONS,
  TRINKETS: TRINKETS,
  RARITY: RARITY,
  AFFIXES: AFFIXES,
  SKILLS: SKILLS,
  TALENTS: TALENTS,
  ITEMS: ITEMS,
  ZONE_MATS: ZONE_MATS
};
