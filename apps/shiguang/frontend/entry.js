/* 拾光群岛 v5「长夜」—— 市场应用入口（俯视角像素动作 RPG）
 *
 * 这个文件由 frontend/v5/build.mjs 从 src/*.js 拼接生成，不要直接改。
 *
 * 运行约束（市场应用不构建，直接下发浏览器；校园平板基线 Chrome 80）：
 *   · 全 ES5：var / function / 单引号；不用箭头函数、模板串、?.、??、class、async
 *   · 不用 Element.replaceChildren()（86+）、Object.values（54+ 但写法统一用 for in）
 *   · 一切订阅 / 计时器 / 监听都登记到 context.app.onDestroy
 *
 * 世界的真相在服务端：位置、生命、怪物、掉落、灯塔进度都由 /shiguang/v5/* 决定，
 * 客户端只负责「手感」——本地立刻播动画、算出命中、把结果上报，服务端校验后回传结论。
 * 手感与权威的分界线就在 combat.js 顶部那段注释里。
 */
(function () {
  'use strict';

  var NAME = 'shiguang';

  // ======================== 00_frames.js ========================
// 由 gen-frames.mjs 从 atlas.json 生成 —— 不要手改
// [x, y, w, h, 帧宽, 帧高]
var FR = {
  "ani_Cat": [872,587,32,16,16,16],
  "ani_Chicken": [905,587,32,16,16,16],
  "ani_Dog": [938,587,32,16,16,16],
  "ani_Frog": [971,587,32,16,16,16],
  "boss_DemonCyclop_Hit": [301,423,150,50,50,50],
  "boss_DemonCyclop_Idle": [1727,362,250,50,50,50],
  "boss_DemonCyclop_Walk": [0,423,300,50,50,50],
  "boss_GiantFrog_Attack": [442,474,120,40,40,40],
  "boss_GiantFrog_Charge": [684,474,280,40,40,40],
  "boss_GiantFrog_Hit": [563,474,120,40,40,40],
  "boss_GiantFrog_Idle": [0,474,200,40,40,40],
  "boss_GiantFrog_Jump": [201,474,240,40,40,40],
  "boss_GiantRacoonGold_Attack": [662,362,240,60,60,60],
  "boss_GiantRacoonGold_Charge": [903,362,120,60,60,60],
  "boss_GiantRacoonGold_Idle": [0,362,360,60,60,60],
  "boss_GiantRacoonGold_Jump": [361,362,300,60,60,60],
  "boss_GiantRedSamurai_Attack": [0,113,384,96,96,96],
  "boss_GiantRedSamurai_Charge": [385,113,288,96,96,96],
  "boss_GiantRedSamurai_Hit": [1606,423,384,48,48,48],
  "boss_GiantRedSamurai_Idle": [452,423,576,48,48,48],
  "boss_GiantRedSamurai_Walk": [1029,423,576,48,48,48],
  "boss_GiantSpirit_Hit": [1576,362,150,50,50,50],
  "boss_GiantSpirit_Idle": [1325,362,250,50,50,50],
  "boss_TenguBlue_Attack": [0,210,1230,82,82,82],
  "boss_TenguBlue_Hit": [0,293,544,68,68,68],
  "boss_TenguBlue_Idle": [1231,210,408,68,68,68],
  "boss_TenguBlue_Walk": [674,113,820,82,82,82],
  "ch_BlueSamurai": [650,0,64,112,16,16],
  "ch_Boy": [1170,0,64,112,16,16],
  "ch_Cavegirl": [975,0,64,112,16,16],
  "ch_Child": [1472,515,64,32,16,16],
  "ch_EggBoy": [1105,0,64,112,16,16],
  "ch_EggGirl": [1040,0,64,112,16,16],
  "ch_FighterWhite": [1235,0,64,112,16,16],
  "ch_Hunter": [845,0,64,112,16,16],
  "ch_Inspector": [1560,0,64,112,16,16],
  "ch_Knight": [520,0,64,112,16,16],
  "ch_KnightGold": [585,0,64,112,16,16],
  "ch_Lion": [1950,0,64,112,16,16],
  "ch_Master": [1300,0,64,112,16,16],
  "ch_Monk": [780,0,64,112,16,16],
  "ch_NinjaBlue": [0,0,64,112,16,16],
  "ch_NinjaDark": [325,0,64,112,16,16],
  "ch_NinjaEskimo": [455,0,64,112,16,16],
  "ch_NinjaGray": [260,0,64,112,16,16],
  "ch_NinjaGreen": [130,0,64,112,16,16],
  "ch_NinjaMasked": [390,0,64,112,16,16],
  "ch_NinjaRed": [65,0,64,112,16,16],
  "ch_NinjaYellow": [195,0,64,112,16,16],
  "ch_Noble": [910,0,64,112,16,16],
  "ch_OldMan": [1365,0,64,112,16,16],
  "ch_OldMan2": [1430,0,64,112,16,16],
  "ch_OldMan3": [1495,0,64,112,16,16],
  "ch_OldWoman": [1407,515,64,32,16,16],
  "ch_Princess": [715,0,64,112,16,16],
  "ch_Villager": [1625,0,64,112,16,16],
  "ch_Villager2": [1690,0,64,112,16,16],
  "ch_Villager3": [1755,0,64,112,16,16],
  "ch_Villager4": [1820,0,64,112,16,16],
  "ch_Woman": [1885,0,64,112,16,16],
  "face_Axolot": [624,515,38,38,38,38],
  "face_Bamboo": [351,515,38,38,38,38],
  "face_Beast": [546,515,38,38,38,38],
  "face_BlueSamurai": [1394,474,38,38,38,38],
  "face_Boy": [1706,474,38,38,38,38],
  "face_Cavegirl": [1589,474,38,38,38,38],
  "face_Child": [0,515,38,38,38,38],
  "face_Cyclope": [780,515,38,38,38,38],
  "face_DemonCyclop": [1287,515,38,38,38,38],
  "face_Dragon": [936,515,38,38,38,38],
  "face_EggBoy": [1667,474,38,38,38,38],
  "face_EggGirl": [1628,474,38,38,38,38],
  "face_Eye": [429,515,38,38,38,38],
  "face_FighterWhite": [1745,474,38,38,38,38],
  "face_Flam2": [1014,515,38,38,38,38],
  "face_GiantFrog": [1092,515,38,38,38,38],
  "face_GiantRacoonGold": [1170,515,38,38,38,38],
  "face_GiantRedSamurai": [1209,515,38,38,38,38],
  "face_GiantSpirit": [1248,515,38,38,38,38],
  "face_Hunter": [1511,474,38,38,38,38],
  "face_Inspector": [1979,474,38,38,38,38],
  "face_Knight": [1277,474,38,38,38,38],
  "face_KnightGold": [1316,474,38,38,38,38],
  "face_LanternRed": [702,515,38,38,38,38],
  "face_Larva": [663,515,38,38,38,38],
  "face_Lion": [234,515,38,38,38,38],
  "face_Master": [1784,474,38,38,38,38],
  "face_Mole": [819,515,38,38,38,38],
  "face_Monk": [1472,474,38,38,38,38],
  "face_Mouse": [390,515,38,38,38,38],
  "face_Mushroom": [468,515,38,38,38,38],
  "face_NinjaBlue": [965,474,38,38,38,38],
  "face_NinjaDark": [1160,474,38,38,38,38],
  "face_NinjaEskimo": [1238,474,38,38,38,38],
  "face_NinjaGray": [1121,474,38,38,38,38],
  "face_NinjaGreen": [1043,474,38,38,38,38],
  "face_NinjaMasked": [1199,474,38,38,38,38],
  "face_NinjaRed": [1004,474,38,38,38,38],
  "face_NinjaYellow": [1082,474,38,38,38,38],
  "face_Noble": [1550,474,38,38,38,38],
  "face_Octopus2": [975,515,38,38,38,38],
  "face_OldMan": [1823,474,38,38,38,38],
  "face_OldMan2": [1862,474,38,38,38,38],
  "face_OldMan3": [1901,474,38,38,38,38],
  "face_OldWoman": [1940,474,38,38,38,38],
  "face_Owl": [507,515,38,38,38,38],
  "face_Princess": [1433,474,38,38,38,38],
  "face_RedSamurai": [1355,474,38,38,38,38],
  "face_Reptile2": [858,515,38,38,38,38],
  "face_Skull": [741,515,38,38,38,38],
  "face_Slime": [273,515,38,38,38,38],
  "face_Slime2": [312,515,38,38,38,38],
  "face_Snake": [585,515,38,38,38,38],
  "face_Spirit": [1053,515,38,38,38,38],
  "face_Spirit2": [897,515,38,38,38,38],
  "face_TenguBlue": [1131,515,38,38,38,38],
  "face_Villager": [39,515,38,38,38,38],
  "face_Villager2": [78,515,38,38,38,38],
  "face_Villager3": [117,515,38,38,38,38],
  "face_Villager4": [156,515,38,38,38,38],
  "face_Woman": [195,515,38,38,38,38],
  "food_Beaf": [1415,587,16,16,16,16],
  "food_Calamari": [1432,587,16,16,16,16],
  "food_Fish": [1449,587,16,16,16,16],
  "food_FortuneCookie": [1466,587,16,16,16,16],
  "food_Honey": [1483,587,16,16,16,16],
  "food_Noodle": [1500,587,16,16,16,16],
  "food_Nut": [1756,587,15,15,15,15],
  "food_Nut2": [1772,587,15,15,15,15],
  "food_Octopus": [1517,587,16,16,16,16],
  "food_Onigiri": [1534,587,16,16,16,16],
  "food_Seed1": [825,618,8,8,8,8],
  "food_Seed2": [834,618,8,8,8,8],
  "food_Seed3": [843,618,8,8,8,8],
  "food_SeedBig1": [197,618,10,13,10,13],
  "food_SeedBig2": [208,618,10,13,10,13],
  "food_SeedBig3": [219,618,10,13,10,13],
  "food_SeedLarge": [230,618,14,13,14,13],
  "food_SeedLargeWhite": [245,618,14,13,14,13],
  "food_Shrimp": [1551,587,16,16,16,16],
  "food_Sushi": [1568,587,16,16,16,16],
  "food_Sushi2": [1585,587,16,16,16,16],
  "food_TeaLeaf": [1602,587,16,16,16,16],
  "food_Yakitori": [1619,587,16,16,16,16],
  "fx_aura": [1192,554,128,32,32,32],
  "fx_bigEnergy": [727,587,96,24,24,24],
  "fx_circle": [612,554,128,32,32,32],
  "fx_circleOrange": [741,554,128,32,32,32],
  "fx_claw": [161,554,128,32,32,32],
  "fx_cut": [0,554,160,32,32,32],
  "fx_energy": [1004,587,64,16,16,16],
  "fx_fireball": [1069,587,64,16,16,16],
  "fx_flame": [1321,554,160,32,32,32],
  "fx_ice": [1482,554,320,32,32,32],
  "fx_pClouds": [1326,515,80,36,16,36],
  "fx_pFire": [274,618,96,12,12,12],
  "fx_pGrass": [82,618,72,13,12,13],
  "fx_pLeaf": [852,618,72,7,6,7],
  "fx_pLeafPink": [925,618,72,7,6,7],
  "fx_pRain": [712,618,24,8,8,8],
  "fx_pRainFloor": [737,618,24,8,8,8],
  "fx_pRock": [1167,587,80,16,16,16],
  "fx_pSnow": [655,618,56,8,8,8],
  "fx_pSpark": [584,618,70,8,7,8],
  "fx_pWood": [1248,587,96,16,16,16],
  "fx_rock": [0,587,420,30,30,30],
  "fx_shield": [582,587,144,26,24,26],
  "fx_shuriken": [1134,587,32,16,16,16],
  "fx_slash": [1537,515,128,32,32,32],
  "fx_slash2": [1666,515,128,32,32,32],
  "fx_slash3": [1795,515,128,32,32,32],
  "fx_smoke": [419,554,192,32,32,32],
  "fx_smokeRing": [1788,587,240,14,16,14],
  "fx_spark": [870,554,160,32,32,32],
  "fx_spin": [290,554,128,32,32,32],
  "fx_spirit": [1031,554,160,32,32,32],
  "fx_thunder": [421,587,160,28,32,28],
  "hud_arrow": [260,618,13,13,13,13],
  "hud_bubble": [839,587,19,19,19,19],
  "hud_dialog": [1024,362,300,58,300,58],
  "hud_facebox": [1991,423,48,48,48,48],
  "it_chest": [1345,587,32,16,16,16],
  "it_chestBig": [0,618,32,14,16,14],
  "it_coin": [455,618,40,10,10,10],
  "it_goldCoin": [998,618,7,7,7,7],
  "it_heart": [775,618,9,8,9,8],
  "it_key": [762,618,12,8,12,8],
  "it_potionBlue": [421,618,9,11,9,11],
  "it_potionRed": [411,618,9,11,9,11],
  "mon_Axolot": [1130,293,64,64,16,16],
  "mon_Bamboo": [675,293,64,64,16,16],
  "mon_Beast": [1000,293,64,64,16,16],
  "mon_Cyclope": [1390,293,64,64,16,16],
  "mon_Dragon": [1650,293,64,64,16,16],
  "mon_Eye": [805,293,64,64,16,16],
  "mon_Flam2": [1780,293,64,64,16,16],
  "mon_LanternRed": [1260,293,64,64,16,16],
  "mon_Larva": [1195,293,64,64,16,16],
  "mon_Mole": [1455,293,64,64,16,16],
  "mon_Mouse": [740,293,64,64,16,16],
  "mon_Mushroom": [870,293,64,64,16,16],
  "mon_Octopus2": [1715,293,64,64,16,16],
  "mon_Owl": [935,293,64,64,16,16],
  "mon_Reptile2": [1520,293,64,64,16,16],
  "mon_Skull": [1325,293,64,64,16,16],
  "mon_Slime": [545,293,64,64,16,16],
  "mon_Slime2": [610,293,64,64,16,16],
  "mon_Snake": [1065,293,64,64,16,16],
  "mon_Spirit": [1845,293,64,64,16,16],
  "mon_Spirit2": [1585,293,64,64,16,16],
  "obj_Letter": [561,618,12,9,12,9],
  "obj_Letter2": [1038,618,12,7,12,7],
  "obj_Letter3": [1051,618,12,7,12,7],
  "obj_ScrollEmpty": [1636,587,16,16,16,16],
  "obj_ScrollFire": [1653,587,16,16,16,16],
  "obj_ScrollIce": [1670,587,16,16,16,16],
  "obj_ScrollPlant": [1687,587,16,16,16,16],
  "obj_ScrollRock": [1704,587,16,16,16,16],
  "obj_ScrollThunder": [1721,587,16,16,16,16],
  "obj_Stamp": [574,618,9,9,9,9],
  "wh_Axe": [785,618,11,8,11,8],
  "wh_AxeTool": [518,618,9,9,9,9],
  "wh_BigSword": [371,618,7,12,7,12],
  "wh_Bone": [797,618,7,8,7,8],
  "wh_Book": [538,618,12,9,12,9],
  "wh_Club": [496,618,8,10,8,10],
  "wh_Fork": [387,618,7,12,7,12],
  "wh_Hammer": [551,618,9,9,9,9],
  "wh_Katana": [505,618,6,10,6,10],
  "wh_Lance": [1404,587,6,16,6,16],
  "wh_Lance2": [70,618,7,14,7,14],
  "wh_MagicWand": [512,618,5,10,5,10],
  "wh_Ninjaku": [403,618,3,12,3,12],
  "wh_Pickaxe": [805,618,11,8,11,8],
  "wh_Rapier": [431,618,9,11,9,11],
  "wh_Sai": [817,618,7,8,7,8],
  "wh_Stick": [407,618,3,12,3,12],
  "wh_Sword": [441,618,6,11,6,11],
  "wh_Sword2": [448,618,6,11,6,11],
  "wh_Whip": [78,618,3,14,3,14],
  "wp_Axe": [155,618,11,13,11,13],
  "wp_AxeTool": [33,618,9,14,9,14],
  "wp_BigSword": [1378,587,7,16,7,16],
  "wp_Bone": [379,618,7,12,7,12],
  "wp_Book": [528,618,9,9,9,9],
  "wp_Bow": [1006,618,15,7,15,7],
  "wp_Bow2": [1022,618,15,7,15,7],
  "wp_Club": [43,618,8,14,8,14],
  "wp_Fishing Rod": [52,618,10,14,10,14],
  "wp_Fork": [1386,587,7,16,7,16],
  "wp_Hammer": [1394,587,9,16,9,16],
  "wp_Katana": [63,618,6,14,6,14],
  "wp_Lance": [824,587,6,23,6,23],
  "wp_Lance2": [831,587,7,21,7,21],
  "wp_MagicWand": [859,587,5,18,5,18],
  "wp_Ninjaku": [395,618,7,12,7,12],
  "wp_Pickaxe": [167,618,11,13,11,13],
  "wp_Rapier": [1738,587,10,15,10,15],
  "wp_Sai": [179,618,7,13,7,13],
  "wp_Stick": [1411,587,3,16,3,16],
  "wp_Sword": [865,587,6,17,6,17],
  "wp_Sword2": [1749,587,6,15,6,15],
  "wp_Whip": [187,618,9,13,9,13]
};

var SFX = {
  "hit":"sfx/hit.wav", "hit2":"sfx/hit2.wav", "hit3":"sfx/hit3.wav", "sword":"sfx/sword.wav", "sword2":"sfx/sword2.wav", "kill":"sfx/kill.wav", "coin":"sfx/coin.wav", "gold":"sfx/gold.wav", "jump":"sfx/jump.wav", "explode":"sfx/explode.wav", "explode2":"sfx/explode2.wav", "magic":"sfx/magic.wav", "magic2":"sfx/magic2.wav", "power":"sfx/power.wav", "levelup":"sfx/levelup.wav", "success":"sfx/success.wav", "secret":"sfx/secret.wav", "alert":"sfx/alert.wav", "fire":"sfx/fire.wav", "spirit":"sfx/spirit.wav", "gameover":"sfx/gameover.wav", "impact":"sfx/impact.wav", "bonus":"sfx/bonus.wav", "fx":"sfx/fx.wav", "menu":"sfx/menu.wav", "accept":"sfx/accept.wav", "cancel":"sfx/cancel.wav"
};
var MUSIC = {
  "town":"music/town.ogg", "meadow":"music/meadow.ogg", "forest":"music/forest.ogg", "swamp":"music/swamp.ogg", "crag":"music/crag.ogg", "frost":"music/frost.ogg", "abyss":"music/abyss.ogg", "night":"music/night.ogg", "boss":"music/boss.ogg", "title":"music/title.ogg", "victory":"music/victory.ogg"
};


  // ======================== 01_core.js ========================
  // ---------------- §1 常量 ----------------
  // 一格 16px。相机按 3~4 倍整数缩放：像素画放大必须是整数倍，否则边缘会糊。
  var TILE = 16;
  var DAY_MS = 12 * 60 * 1000;

  // 手感参数（改这里就能调，别散落在各处）
  var SPEED = 5.2;            // 格/秒（服务端 MAX_SPEED 是 9.5，留足翻滚余量）
  var ACCEL = 46;             // 格/秒²
  var FRICTION = 30;
  var ROLL_SPEED = 12.5;
  var ROLL_MS = 320;
  var ROLL_INV_MS = 220;
  var ROLL_CD = 600;
  var ATK_WINDUP = 70;
  var ATK_ACTIVE = 80;
  var ATK_RECOVER = 105;
  var COMBO_WINDOW = 420;
  var HITSTOP = 60;
  var SYNC_MS = 200;          // 5Hz 同步
  var REVEAL_R = 11;          // 走一步揭开的半径（格）

  // 地形编码（与 backend/v5/worldgen.js 的 TILE 严格一致）
  var T = {
    WATER: 0, GRASS: 1, SAND: 2, DIRT: 3, STONE: 4, SNOW: 5, SWAMP: 6, TREE: 7,
    ROCK: 8, WALL: 9, FLOOR: 10, BRIDGE: 11, DARK: 12, ICE: 13, FLOWER: 14,
    SHALLOW: 15, CLIFF: 16, PINE: 17, DEADTREE: 18
  };
  var BLOCK = {};
  (function () {
    var b = [T.WATER, T.TREE, T.ROCK, T.WALL, T.CLIFF, T.PINE, T.DEADTREE];
    for (var i = 0; i < b.length; i++) BLOCK[b[i]] = 1;
  })();

  // 地面色板：每种地貌一组 [底色, 暗点, 亮点]。程序绘制地形，
  // 不依赖瓦片集的索引表（那套 16px 网格对不上，硬贴会错位）。
  var GROUND = {};
  GROUND[T.GRASS] = ['#6aa84f', '#5d9a45', '#7cbb5c', '#87c968'];
  GROUND[T.SAND] = ['#e0cf9a', '#d3c08a', '#efe0b4'];
  GROUND[T.DIRT] = ['#b08a5e', '#a07b52', '#bf9a6c'];
  GROUND[T.STONE] = ['#9a9384', '#8a8375', '#aaa392'];
  GROUND[T.SNOW] = ['#e8f1f7', '#d6e3ee', '#f6fbff'];
  GROUND[T.SWAMP] = ['#5d6b43', '#4f5c39', '#6c7a50'];
  GROUND[T.FLOOR] = ['#c8b490', '#b7a37f', '#d8c6a2'];
  GROUND[T.BRIDGE] = ['#a8794f', '#966943', '#b98b5d'];
  GROUND[T.DARK] = ['#3a3450', '#2f2a44', '#4a4266'];
  GROUND[T.ICE] = ['#b7dcea', '#a5cede', '#cbe9f4'];
  GROUND[T.FLOWER] = ['#6aa84f', '#5d9a45', '#87c968'];
  GROUND[T.SHALLOW] = ['#6fb6c4', '#5fa6b6', '#86c8d4'];
  GROUND[T.WALL] = ['#6b6055', '#5b5148', '#7f7367'];
  GROUND[T.CLIFF] = ['#57504a', '#474138', '#6a625a'];
  GROUND[T.WATER] = ['#3d6f9e', '#33608c', '#4c82b4'];

  var TREE_TINT = {
    meadow: { dark: '#2f6b35', mid: '#41904a', light: '#5cb862' },
    forest: { dark: '#255c3a', mid: '#2f7347', light: '#459a5c' },
    swamp: { dark: '#3a4a2a', mid: '#4a5f34', light: '#5e7742' },
    crag: { dark: '#4a3f33', mid: '#5d4f3f', light: '#75634e' },
    frost: { dark: '#2f4a52', mid: '#3f626d', light: '#568089' },
    abyss: { dark: '#2a2440', mid: '#372f52', light: '#4a3f6b' }
  };

  var ZONE_COLOR = {
    town: '#ffd98a', meadow: '#9bd36a', forest: '#4f9a6a', swamp: '#7f9a4a',
    crag: '#c0916a', frost: '#a9d8ea', abyss: '#8a72c0'
  };

  // 玩家外观（与服务端 store.LOOKS 对应）
  var LOOKS = ['NinjaBlue', 'NinjaRed', 'NinjaGreen', 'NinjaYellow', 'NinjaGray', 'NinjaMasked',
    'Knight', 'Princess', 'Monk', 'Hunter', 'Cavegirl', 'EggGirl', 'EggBoy', 'Boy',
    'FighterWhite', 'NinjaEskimo', 'RedSamurai', 'BlueSamurai', 'Noble'];

  // ---------------- §2 小工具 ----------------
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function dist(ax, ay, bx, by) { var dx = ax - bx, dy = ay - by; return Math.sqrt(dx * dx + dy * dy); }
  function angleDiff(a, b) {
    var d = a - b;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    return d;
  }
  // 确定性哈希：同一格永远长出同一棵树、同一块石头 —— 重进世界不会变样
  function hash2(x, y, s) {
    var h = (x * 374761393 + y * 668265263 + (s || 0) * 2147483647) | 0;
    h = (h ^ (h >>> 13)) * 1274126177 | 0;
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }
  function fmt(n) {
    n = Math.round(n || 0);
    return n >= 10000 ? (n / 1000).toFixed(1) + 'k' : String(n);
  }
  function hexA(hex, a) {
    // '#rrggbb' → 'rgba(r,g,b,a)'：Canvas 里大量用到半透明色
    var r = parseInt(hex.substr(1, 2), 16), g = parseInt(hex.substr(3, 2), 16), b = parseInt(hex.substr(5, 2), 16);
    return 'rgba(' + r + ',' + g + ',' + b + ',' + a + ')';
  }
  function easeOut(t) { return 1 - (1 - t) * (1 - t); }
  function easeIn(t) { return t * t; }

  // v5.6 W1：带预算上限的 push（FIFO，超限 shift 最旧）。主循环另有 trimBudgets 兜底。
  function capPush(arr, item, max) {
    if (!arr) return;
    if (arr.length >= max) arr.shift();
    arr.push(item);
  }

  // v5.6 W3：颜色加深（'#rrggbb', -36）—— 作物果实二阶色用
  function shadeHex(hex, amt) {
    var r = parseInt(hex.substr(1, 2), 16), g = parseInt(hex.substr(3, 2), 16), b = parseInt(hex.substr(5, 2), 16);
    r = Math.max(0, Math.min(255, r + amt));
    g = Math.max(0, Math.min(255, g + amt));
    b = Math.max(0, Math.min(255, b + amt));
    return '#' + (r < 16 ? '0' : '') + r.toString(16) + (g < 16 ? '0' : '') + g.toString(16) + (b < 16 ? '0' : '') + b.toString(16);
  }

  // ---------------- §2.5 竞态守卫（v5.6 W1，Phase 2 裁定：丢弃不排队） ----------------
  // 锁挂在 S 上（refreshPanel 重建 DOM 会丢锁，所以绝不挂 DOM）。
  // 在途时再点：直接丢弃，第 3 次连续丢弃 panelBusy 弹一次 toast；触发的控件加 .is-busy。
  // fn 返回 Promise 时自动在 finally 复位；同步返回时立即复位。
  function sg5Gate(lock, el, fn) {
    if (S[lock]) {
      S[lock + '_drop'] = (S[lock + '_drop'] || 0) + 1;
      if (lock === 'panelBusy' && S[lock + '_drop'] === 3) toast('别急，上一笔还在路上', 'warn');
      if (el && el.className && el.className.indexOf && el.className.indexOf('is-busy') < 0) el.className += ' is-busy';
      return null;
    }
    S[lock] = 1;
    S[lock + '_drop'] = 0;
    var fin = function () {
      S[lock] = 0;
      if (el && el.className && el.className.indexOf && el.className.indexOf('is-busy') >= 0) {
        el.className = el.className.replace(/\s*is-busy/, '');
      }
    };
    var r;
    try { r = fn(); } catch (e) { fin(); throw e; }
    if (r && typeof r.then === 'function') {
      // 释放必须直接挂在 r 上（第一个 reaction）：派生一层 then 会让 fin 排到
      // 调用方回调之后 —— 链式调用下一笔永远撞上「在途」而全部被丢弃。
      try { r.then(fin, fin); } catch (e2) { fin(); }
      return r;
    }
    fin();
    return r;
  }

  // ---------------- §3 DOM 小工 ----------
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function clearNode(n) { while (n && n.firstChild) n.removeChild(n.firstChild); }
  function setText(n, t) { if (n && n.textContent !== t) n.textContent = t; }
  function svgIcon(paths, size) {
    var NS = 'http://www.w3.org/2000/svg';
    var s = document.createElementNS(NS, 'svg');
    s.setAttribute('viewBox', '0 0 24 24');
    s.setAttribute('width', size || 18);
    s.setAttribute('height', size || 18);
    s.setAttribute('fill', 'none');
    s.setAttribute('stroke', 'currentColor');
    s.setAttribute('stroke-width', '1.7');
    s.setAttribute('stroke-linecap', 'round');
    s.setAttribute('stroke-linejoin', 'round');
    for (var i = 0; i < paths.length; i++) {
      var p = document.createElementNS(NS, paths[i][0]);
      var attrs = paths[i][1];
      for (var k in attrs) if (Object.prototype.hasOwnProperty.call(attrs, k)) p.setAttribute(k, attrs[k]);
      s.appendChild(p);
    }
    return s;
  }
  var ICONS = {
    sword: [['path', { d: 'M14.5 3.5l6 6-9 9-3.5.5.5-3.5z' }], ['path', { d: 'M4 20l4-4' }]],
    roll: [['path', { d: 'M20 12a8 8 0 1 1-3.2-6.4' }], ['path', { d: 'M20 4v5h-5' }]],
    spark: [['path', { d: 'M12 3v5M12 16v5M3 12h5M16 12h5' }], ['circle', { cx: '12', cy: '12', r: '3' }]],
    hand: [['path', { d: 'M8 12V6.5a1.5 1.5 0 0 1 3 0V11' }], ['path', { d: 'M11 11V5.5a1.5 1.5 0 0 1 3 0V11' }], ['path', { d: 'M14 11V7.5a1.5 1.5 0 0 1 3 0V14a6 6 0 0 1-6 6h-1a6 6 0 0 1-6-6v-2' }]],
    bag: [['path', { d: 'M5 8h14l-1.2 12H6.2z' }], ['path', { d: 'M9 8V6a3 3 0 0 1 6 0v2' }]],
    user: [['circle', { cx: '12', cy: '8', r: '3.4' }], ['path', { d: 'M5 20c1.6-4 4-6 7-6s5.4 2 7 6' }]],
    map: [['path', { d: 'M9 4.4L4.4 6.2v13.4L9 17.8l6 1.8 4.6-1.8V4.4L15 6.2z' }], ['path', { d: 'M9 4.4v13.4M15 6.2v13.4' }]],
    gear: [['circle', { cx: '12', cy: '12', r: '2.6' }], ['path', { d: 'M12 3.4v2.2M12 18.4v2.2M3.4 12h2.2M18.4 12h2.2M5.8 5.8l1.6 1.6M16.6 16.6l1.6 1.6M18.2 5.8l-1.6 1.6M7.4 16.6l-1.6 1.6' }]],
    book: [['path', { d: 'M12 6.6C10.6 5.3 8.7 4.7 6.4 4.7H4v13.6h2.4c2.3 0 4.2.6 5.6 1.9 1.4-1.3 3.3-1.9 5.6-1.9H20V4.7h-2.4c-2.3 0-4.2.6-5.6 1.9z' }], ['path', { d: 'M12 6.6v13.6' }]],
    star: [['path', { d: 'M12 3.2l2.7 5.8 6.3.8-4.6 4.3 1.2 6.2-5.6-3-5.6 3 1.2-6.2L3 9.8l6.3-.8z' }]],
    flask: [['path', { d: 'M9 3h6M10 3v6L5.5 18a2 2 0 0 0 1.8 3h9.4a2 2 0 0 0 1.8-3L14 9V3' }]],
    anvil: [['path', { d: 'M4 9h9a4 4 0 0 0 4-4h3v3a5 5 0 0 1-5 5h-2v3h4v2H6v-2h3v-3H4z' }]],
    heart: [['path', { d: 'M12 20s-7-4.4-7-9a4 4 0 0 1 7-2.6A4 4 0 0 1 19 11c0 4.6-7 9-7 9z' }]],
    close: [['path', { d: 'M6 6l12 12M18 6L6 18' }]],
    sound: [['path', { d: 'M4 9v6h3l4 3V6L7 9z' }], ['path', { d: 'M15.5 8.5a5 5 0 0 1 0 7' }]]
  };

  // ---------------- §4 世界状态 ----------------
  // 唯一的可变状态都挂在这里：网络层写、渲染层读，避免几十个闭包变量到处飞。
  var S = {
    ready: false,
    myId: '',
    map: null,            // { size, cells, zones, town, towers, waystones, chests }
    cam: { x: 0, y: 0, shake: 0, shakeX: 0, shakeY: 0 },
    zoom: 4,
    view: { w: 320, h: 240 },
    me: null,
    players: {},
    mobs: {},
    shots: [],
    parts: [],
    texts: [],
    chests: {},           // 已开过的箱子 id
    towers: {},           // 已点亮的灯塔
    waystones: [],
    goal: null,
    feed: [],
    phase: 'day',
    pf: 0,
    time: 0,
    visited: null,        // Uint8Array 256*256
    visitDirty: false,
    zone: 'town',
    boss: null,
    tide: null,
    paused: false,
    panel: '',
    audio: { on: true },
    stats: {}
  };


  // ======================== 02_audio.js ========================
  // ---------------- §5 音频 ----------------
  // 音乐用两条 <audio> 交叉淡入（换区不断档），音效用 WebAudio 解码后按需播放
  // （同一帧里七八个打击音要能叠着响，<audio> 做不到）。
  // 自动播放策略：第一次触摸/按键时 resume()，在此之前静音排队。
  var AU = {
    ctx: null,
    master: null,
    sfxGain: null,
    musicGain: null,
    bufs: {},
    pending: {},
    a: null,
    b: null,
    cur: '',
    on: true,
    ready: false
  };

  function auInit(assetUrl) {
    AU.assetUrl = assetUrl;
    AU.a = new Audio();
    AU.b = new Audio();
    AU.a.loop = true; AU.b.loop = true;
    AU.a.volume = 0; AU.b.volume = 0;
    AU.a.preload = 'auto'; AU.b.preload = 'auto';
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (AC) {
        AU.ctx = new AC();
        AU.master = AU.ctx.createGain();
        AU.master.gain.value = 0.9;
        AU.master.connect(AU.ctx.destination);
        AU.sfxGain = AU.ctx.createGain();
        AU.sfxGain.gain.value = 0.85;
        AU.sfxGain.connect(AU.master);
      }
    } catch (e) { AU.ctx = null; }
  }

  function auResume() {
    if (AU.ctx && AU.ctx.state === 'suspended') { try { AU.ctx.resume(); } catch (e) {} }
    AU.ready = true;
    if (AU.cur) auMusic(AU.cur, true);
  }

  // 播放一段背景音乐（同名不重播）
  function auMusic(name, force) {
    if (!name || (AU.cur === name && !force)) return;
    AU.cur = name;
    var want = 'frontend/v5/' + (MUSIC[name] || MUSIC.meadow);
    var url = AU.assetUrl(want);
    var fade = AU.on && AU.ready;
    var from = fade ? AU.a : (AU.a.src && AU.a.volume >= AU.b.volume ? AU.a : AU.b);
    var to = from === AU.a ? AU.b : AU.a;
    if (from.src && from.src.indexOf(url) >= 0) { from.volume = fade ? 0.45 : 0; return; }
    try {
      to.src = url;
      to.currentTime = 0;
      to.volume = 0;
      var pr = to.play();
      if (pr && pr.catch) pr.catch(function () {});
    } catch (e) { return; }
    var t0 = Date.now(), dur = 900;
    var step = function () {
      if (!AU.on) { from.volume = 0; to.volume = 0; return; }
      var k = clamp((Date.now() - t0) / dur, 0, 1);
      to.volume = 0.42 * k;
      from.volume = 0.42 * (1 - k);
      if (k < 1) setTimeout(step, 60);
      else { try { from.pause(); } catch (e) {} }
    };
    step();
  }

  function auSfxLoad(key) {
    if (AU.bufs[key] || AU.pending[key] || !AU.ctx) return;
    var rel = SFX[key];
    if (!rel) return;
    AU.pending[key] = 1;
    try {
      var xhr = new XMLHttpRequest();
      xhr.open('GET', AU.assetUrl('frontend/v5/' + rel), true);
      xhr.responseType = 'arraybuffer';
      xhr.onload = function () {
        if (!xhr.response) { AU.pending[key] = 0; return; }
        AU.ctx.decodeAudioData(xhr.response, function (buf) {
          AU.bufs[key] = buf;
          AU.pending[key] = 0;
        }, function () { AU.pending[key] = 0; });
      };
      xhr.onerror = function () { AU.pending[key] = 0; };
      xhr.send();
    } catch (e) { AU.pending[key] = 0; }
  }

  // rate：音高倍率（同一段打击音变调，听感不重复）
  function auSfx(key, vol, rate) {
    if (!AU.on || !AU.ctx || !AU.ready) return;
    var buf = AU.bufs[key];
    if (!buf) { auSfxLoad(key); return; }
    try {
      var src = AU.ctx.createBufferSource();
      src.buffer = buf;
      src.playbackRate.value = rate || 1;
      var g = AU.ctx.createGain();
      g.gain.value = vol == null ? 0.5 : vol;
      src.connect(g);
      g.connect(AU.sfxGain);
      src.start(0);
    } catch (e) {}
  }

  function auSetOn(on) {
    AU.on = !!on;
    if (AU.a) AU.a.volume = AU.on ? (AU.cur ? 0.42 : 0) : 0;
    if (AU.b) AU.b.volume = 0;
    if (!AU.on) { try { AU.a.pause(); } catch (e) {} try { AU.b.pause(); } catch (e) {} AU.cur = ''; }
  }

  function auDispose() {
    try { AU.a.pause(); AU.b.pause(); } catch (e) {}
    AU.a = AU.b = null;
    if (AU.ctx) { try { AU.ctx.close(); } catch (e) {} }
    AU.ctx = null;
  }


  // ======================== 03_world.js ========================
  // ---------------- §6 地形 ----------------
  // 分层策略：
  //   地面 → 每 32×32 格烘焙进一张离屏画布（4~9 次 drawImage 画完一屏）。
  //   高出地面的东西（树、岩石、房子、灯塔）→ 每帧按脚底 y 排序后与角色一起画，
  //   人走到树后面真的会被挡住。
  //
  // 地面的画法：不用素材包的 autotile（47 变体的索引表不在包里，硬猜一定错位），
  // 改成**预生成 16×16 纹理砖**：Bayer 有序抖动把「暗/基/亮」三色揉成颗粒，
  // 再按材质加笔触（草叶/石纹/雪点/鹅卵石）。运行时只是 drawImage，既快又统一。
  var CHUNK = 32;
  var chunks = {};
  var chunkOrder = [];
  var B36 = '0123456789abcdefghijklmnopqrstuvwxyz';
  var BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

  function w2sX(wx) { return (wx - S.cam.x) * S.zoom + S.view.w * 0.5; }
  function w2sY(wy) { return (wy - S.cam.y) * S.zoom + S.view.h * 0.5; }
  function s2wX(sx) { return (sx - S.view.w * 0.5) / S.zoom + S.cam.x; }
  function s2wY(sy) { return (sy - S.view.h * 0.5) / S.zoom + S.cam.y; }

  function tileAt(tx, ty) {
    var m = S.map;
    if (!m) return T.GRASS;
    if (tx < 0 || ty < 0 || tx >= m.size || ty >= m.size) return T.WATER;
    return m.cells[ty * m.size + tx];
  }
  function zoneIdxAt(tx, ty) {
    var m = S.map;
    if (!m || tx < 0 || ty < 0 || tx >= m.size || ty >= m.size) return 1;
    return m.zoneIdx[ty * m.size + tx];
  }
  function zoneOf(tx, ty) {
    var z = S.map.zones[zoneIdxAt(tx, ty)];
    return z ? z.id : 'meadow';
  }
  function blockedTile(t) { return !!BLOCK[t]; }

  function worldInit(data) {
    var size = data.size;
    var cells = new Uint8Array(size * size);
    for (var i = 0; i < size * size; i++) cells[i] = B36.indexOf(data.cells.charAt(i) || '1');
    var zi = new Uint8Array(size * size);
    for (var j = 0; j < size * size; j++) zi[j] = B36.indexOf(data.zones.charAt(j) || '1');
    S.map = {
      size: size, cells: cells, zoneIdx: zi, zones: data.zonesMeta, town: data.town,
      towers: data.towers, waystones: data.waystones, chests: data.chests, tile: data.tile,
      relics: data.relics || [],   // v5.7 守塔人遗物地标（走近按 E 阅读《灯火纪》日记）
      nights: data.nights || []    // v5.8 夜语残页：与日记同格，夜间浮现
    };
    S.chests = {};
    S.waystones = data.waystones;
    S.questDefs = data.quests || {};
    S.caves = data.caves || [];
    chunks = {};
    chunkOrder = [];
    buildTextures();
    buildPropSprites();
    buildMiniMap();
  }

  // ---------------- §6.1 纹理砖 ----------------
  // 每种材质 2~4 套变体。变体差异只在「抖动相位 + 笔触位置」，拼起来没有重复感，
  // 也不会出现明显的四方连续。
  var TEX = {};

  var MAT = {
    grass:   [{ d: '#456f31', b: '#588c3b', l: '#6ba249', h: '#84ba5e' },
              { d: '#3f6a2e', b: '#528438', l: '#659b45', h: '#7eb256' },
              { d: '#4a7334', b: '#5d903e', l: '#70a74c', h: '#8bc063' }],
    forest:  [{ d: '#375c2c', b: '#456f34', l: '#57873f', h: '#6b9c4c' },
              { d: '#325428', b: '#406830', l: '#527f3b', h: '#669548' }],
    sand:    [{ d: '#c4ac74', b: '#d8c28a', l: '#e8d5a4', h: '#f4e6bf' },
              { d: '#bda470', b: '#d2bb84', l: '#e3cf9c', h: '#f0e1b6' }],
    dirt:    [{ d: '#8d6741', b: '#a37a50', l: '#b88e60', h: '#c9a074' },
              { d: '#84603c', b: '#9a724a', l: '#b0865a', h: '#c09a6e' }],
    stone:   [{ d: '#6e6659', b: '#847b6c', l: '#9a9080', h: '#aea695' },
              { d: '#67605a', b: '#7c7568', l: '#928a7b', h: '#a69e8d' }],
    snow:    [{ d: '#c9d8e6', b: '#dde9f3', l: '#eef6fc', h: '#ffffff' },
              { d: '#c3d3e2', b: '#d8e5f0', l: '#e9f3fa', h: '#ffffff' }],
    swamp:   [{ d: '#44502f', b: '#556340', l: '#67764f', h: '#7d8d61' },
              { d: '#3f4b2c', b: '#505d3c', l: '#62714b', h: '#78885c' }],
    floor:   [{ d: '#9b8763', b: '#ad9871', l: '#c0ab80', h: '#d2bd92' }],
    bridge:  [{ d: '#7a5533', b: '#8f6841', l: '#a67c50', h: '#bb9264' }],
    dark:    [{ d: '#241f36', b: '#302a48', l: '#3d3557', h: '#4d4368' }],
    ice:     [{ d: '#8fb9cc', b: '#a9d0e0', l: '#c3e2ee', h: '#e2f4fb' }],
    shallow: [{ d: '#2f6a80', b: '#3d7d92', l: '#4f92a6', h: '#6aa9bb' }],
    water:   [{ d: '#274d72', b: '#2f5f88', l: '#3a7098', h: '#4c88b0' }],
    wall:    [{ d: '#4c453d', b: '#615a50', l: '#756d61', h: '#8b8273' }],
    cliff:   [{ d: '#211d1a', b: '#2f2a25', l: '#3d3730', h: '#4f4740' }]
  };

  function hexRgb(c) {
    return [parseInt(c.substr(1, 2), 16), parseInt(c.substr(3, 2), 16), parseInt(c.substr(5, 2), 16)];
  }

  function makeTex(def, seed, kind) {
    var cv = document.createElement('canvas');
    cv.width = TILE; cv.height = TILE;
    var g = cv.getContext('2d');
    var img = g.createImageData(TILE, TILE);
    var dd = img.data;
    var cd = hexRgb(def.d), cb = hexRgb(def.b), cl = hexRgb(def.l);
    for (var y = 0; y < TILE; y++) {
      for (var x = 0; x < TILE; x++) {
        // 有序抖动：Bayer 阈值 + 一点噪声，得到「颗粒」而不是「噪点」
        var b = BAYER[(y & 3) * 4 + (x & 3)] / 16;
        var n = hash2(x + seed * 31, y + seed * 17, 5);
        var v = b * 0.62 + n * 0.38;
        var c = cb;
        if (v < 0.30) c = cd;
        else if (v > 0.72) c = cl;
        var o = (y * TILE + x) * 4;
        dd[o] = c[0]; dd[o + 1] = c[1]; dd[o + 2] = c[2]; dd[o + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    if (kind === 'blade') {
      for (var i = 0; i < 5; i++) {
        var bx = 1 + Math.floor(hash2(i, seed, 7) * 14);
        var by = 3 + Math.floor(hash2(i, seed, 9) * 11);
        g.fillStyle = def.h;
        g.fillRect(bx, by, 1, 2);
        g.fillStyle = def.d;
        g.fillRect(bx, by + 2, 1, 1);
      }
      if (hash2(seed, 3, 11) > 0.58) {
        g.fillStyle = def.l;
        g.fillRect(4 + Math.floor(hash2(seed, 4, 12) * 8), 2 + Math.floor(hash2(seed, 5, 13) * 10), 2, 1);
      }
    } else if (kind === 'stone') {
      g.fillStyle = def.d;
      var sx = 2 + Math.floor(hash2(seed, 1, 21) * 9);
      g.fillRect(sx, 3, 1, 5);
      g.fillRect(sx + 1, 8, 2, 1);
      g.fillStyle = def.h;
      g.fillRect(3 + Math.floor(hash2(seed, 2, 22) * 9), 4 + Math.floor(hash2(seed, 3, 23) * 6), 3, 1);
    } else if (kind === 'snow') {
      g.fillStyle = '#ffffff';
      g.fillRect(Math.floor(hash2(seed, 1, 31) * 14), Math.floor(hash2(seed, 2, 32) * 14), 1, 1);
      g.fillStyle = def.d;
      g.fillRect(Math.floor(hash2(seed, 3, 33) * 14), Math.floor(hash2(seed, 4, 34) * 14), 2, 1);
    } else if (kind === 'water') {
      g.fillStyle = def.h;
      g.globalAlpha = 0.45;
      g.fillRect(2 + Math.floor(hash2(seed, 1, 41) * 8), 4 + Math.floor(hash2(seed, 2, 42) * 8), 5, 1);
      g.fillRect(6 + Math.floor(hash2(seed, 3, 43) * 6), 10 + Math.floor(hash2(seed, 4, 44) * 4), 4, 1);
      g.globalAlpha = 1;
    } else if (kind === 'plaza') {
      // 广场：夯土地面 + 零散石板。不是「铺满砖」，是一块被人踩了几十年的空地。
      var nSlab = (seed % 2 === 0) ? 2 : (seed % 3 === 0 ? 1 : 0);
      for (var s2 = 0; s2 < nSlab; s2++) {
        var bx = 1 + ((hash2(seed, s2, 71) * 9) | 0);
        var by = 1 + ((hash2(seed, s2, 72) * 9) | 0);
        var bw = 4 + ((hash2(seed, s2, 73) * 6) | 0);
        var bh = 3 + ((hash2(seed, s2, 74) * 5) | 0);
        g.globalAlpha = 0.55;
        g.fillStyle = def.d;
        g.fillRect(bx, by, bw, bh);
        g.globalAlpha = 0.75;
        g.fillStyle = def.l;
        g.fillRect(bx + 1, by + 1, Math.max(1, bw - 2), Math.max(1, bh - 2));
        g.globalAlpha = 1;
      }
      g.fillStyle = def.d;
      for (var pb = 0; pb < 3; pb++) {
        g.fillRect(1 + ((hash2(seed, pb, 81) * 14) | 0), 1 + ((hash2(seed, pb, 82) * 14) | 0), 1, 1);
      }
    } else if (kind === 'wood') {
      g.fillStyle = def.d;
      g.fillRect(0, 5, TILE, 1);
      g.fillRect(0, 11, TILE, 1);
      g.fillStyle = def.h;
      g.fillRect(3, 0, 1, 5);
      g.fillRect(9, 6, 1, 5);
    } else if (kind === 'crack') {
      g.fillStyle = def.d;
      g.fillRect(Math.floor(hash2(seed, 1, 61) * 10), 2, 1, 6);
      g.fillRect(Math.floor(hash2(seed, 2, 62) * 10), 9, 1, 5);
    }
    return cv;
  }

  function buildTextures() {
    TEX = {};
    function reg(key, kind, count) {
      TEX[key] = [];
      var defs = MAT[key] || MAT.grass;
      for (var i = 0; i < count; i++) TEX[key].push(makeTex(defs[i % defs.length], i + key.length * 7, kind));
    }
    reg('grass', 'blade', 4);
    reg('forest', 'blade', 4);
    reg('sand', 'dot', 3);
    reg('dirt', 'crack', 3);
    reg('stone', 'stone', 4);
    reg('snow', 'snow', 3);
    reg('swamp', 'crack', 3);
    reg('floor', 'plaza', 6);
    reg('bridge', 'wood', 2);
    reg('dark', 'dot', 3);
    reg('ice', 'snow', 3);
    reg('shallow', 'water', 3);
    reg('water', 'water', 3);
    reg('wall', 'stone', 3);
    reg('cliff', 'stone', 2);
  }

  var TEX_KEY = {};
  TEX_KEY[T.GRASS] = 'grass';
  TEX_KEY[T.FLOWER] = 'grass';
  TEX_KEY[T.SAND] = 'sand';
  TEX_KEY[T.DIRT] = 'dirt';
  TEX_KEY[T.STONE] = 'stone';
  TEX_KEY[T.SNOW] = 'snow';
  TEX_KEY[T.SWAMP] = 'swamp';
  TEX_KEY[T.FLOOR] = 'floor';
  TEX_KEY[T.BRIDGE] = 'bridge';
  TEX_KEY[T.DARK] = 'dark';
  TEX_KEY[T.ICE] = 'ice';
  TEX_KEY[T.SHALLOW] = 'shallow';
  TEX_KEY[T.WATER] = 'water';
  TEX_KEY[T.WALL] = 'wall';
  TEX_KEY[T.CLIFF] = 'cliff';

  function paintTile(ctx, tx, ty, px, py) {
    var t = tileAt(tx, ty);
    var z = zoneOf(tx, ty);
    var key = TEX_KEY[t] || 'grass';
    var set = TEX[key];
    var v = (hash2(tx, ty, 17) * set.length) | 0;
    ctx.drawImage(set[v], px, py);
    // 森林/长夜里的草压暗一档：同一张纹理砖，靠区域调色区分氛围
    if (z === 'forest' && (t === T.GRASS || t === T.FLOWER)) {
      ctx.fillStyle = 'rgba(14,38,24,0.22)';
      ctx.fillRect(px, py, TILE, TILE);
    } else if (z === 'abyss' && t !== T.DARK) {
      ctx.fillStyle = 'rgba(26,14,48,0.32)';
      ctx.fillRect(px, py, TILE, TILE);
    }
    // 道路按区域换「路面」：雪原上是压实的雪道，岩地是碎石，长夜是黑土。
    // 一条橙土路横穿雪原，比任何画面 bug 都刺眼。
    if (t === T.DIRT || t === T.BRIDGE) {
      var roadTint = { frost: 'rgba(214,232,244,0.42)', crag: 'rgba(122,112,96,0.34)',
        abyss: 'rgba(34,24,56,0.55)', swamp: 'rgba(74,84,52,0.34)', forest: 'rgba(46,62,38,0.22)' }[z];
      if (roadTint) { ctx.fillStyle = roadTint; ctx.fillRect(px, py, TILE, TILE); }
    }
    // 大尺度色调扰动：同一张纹理砖连续铺 20 格也会「花色一致」，
    // 用低频哈希给整格盖一层极淡的明暗，拼起来才像一块地。
    var tone = hash2(tx >> 2, ty >> 2, 31);
    if (tone > 0.76) { ctx.fillStyle = 'rgba(255,246,220,0.035)'; ctx.fillRect(px, py, TILE, TILE); }
    else if (tone < 0.24) { ctx.fillStyle = 'rgba(24,18,10,0.04)'; ctx.fillRect(px, py, TILE, TILE); }
    if (t === T.FLOWER) {
      var fc = ['#ffd7e6', '#ffeaa8', '#cbb6ff', '#b8f0ff'][(hash2(tx, ty, 19) * 4) | 0];
      var r1 = hash2(tx, ty, 23), r2 = hash2(tx, ty, 29);
      ctx.fillStyle = '#3f5c33';
      ctx.fillRect(px + 4 + ((r1 * 8) | 0), py + 8, 1, 3);
      ctx.fillStyle = fc;
      ctx.fillRect(px + 3 + ((r1 * 8) | 0), py + 6, 3, 2);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(px + 4 + ((r1 * 8) | 0), py + 6, 1, 1);
      if (r2 > 0.5) {
        ctx.fillStyle = '#3f5c33';
        ctx.fillRect(px + 10, py + 11, 1, 2);
        ctx.fillStyle = fc;
        ctx.fillRect(px + 9, py + 10, 2, 2);
      }
    }
    // 城墙：顶面受光 + 底部阴影 —— 墙是镇子的边界，要一眼看出「过不去」
    if (t === T.WALL) {
      ctx.fillStyle = 'rgba(255,246,220,0.10)';
      ctx.fillRect(px, py, TILE, 5);
      ctx.fillStyle = 'rgba(0,0,0,0.34)';
      ctx.fillRect(px, py + 11, TILE, 5);
      ctx.fillStyle = 'rgba(0,0,0,0.22)';
      ctx.fillRect(px, py + 5, TILE, 1);
    }
  }

  // 边界抖动：相邻格材质不同时在对侧撒几点对方的颜色，
  // 让「草地边缘」看起来是被踩秃的，而不是两条直线拼在一起。
  function paintEdge(ctx, tx, ty, px, py) {
    var t = tileAt(tx, ty);
    if (BLOCK[t] || t === T.WATER) return;
    var dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    for (var i = 0; i < 4; i++) {
      var nx = tx + dirs[i][0], ny = ty + dirs[i][1];
      var nt = tileAt(nx, ny);
      if (nt === t) continue;
      if (nt === T.WATER) {
        // 岸线：陆地与水交界处撒一圈沙/碎冰，不然海岸是一条直线
        ctx.fillStyle = t === T.SNOW ? '#cfe3ef' : '#d9c98f';
        for (var q = 0; q < 7; q++) {
          var hh = hash2(tx * 5 + q, ty * 11 + i, 25);
          var ox2 = dirs[i][0] > 0 ? 14 + ((hh * 2) | 0) : (dirs[i][0] < 0 ? 1 - ((hh * 2) | 0) : (hh * 15) | 0);
          var oy2 = dirs[i][1] > 0 ? 14 + ((hh * 2) | 0) : (dirs[i][1] < 0 ? 1 - ((hh * 2) | 0) : (hh * 15) | 0);
          ctx.globalAlpha = 0.45 + hh * 0.4;
          ctx.fillRect(px + ox2, py + oy2, 1, 1);
        }
        ctx.globalAlpha = 1;
        continue;
      }
      if (BLOCK[nt]) continue;
      var nk = TEX_KEY[nt] || 'grass';
      var nd = MAT[nk] ? MAT[nk][0] : MAT.grass[0];
      ctx.fillStyle = nd.b;
      for (var k = 0; k < 6; k++) {
        var h = hash2(tx * 7 + k, ty * 13 + i, 21);
        var h2 = hash2(tx + k, ty - i, 22);
        var ox = dirs[i][0] > 0 ? 15 : (dirs[i][0] < 0 ? 0 : (h * 15) | 0);
        var oy = dirs[i][1] > 0 ? 15 : (dirs[i][1] < 0 ? 0 : (h2 * 15) | 0);
        ctx.globalAlpha = 0.5 + h * 0.45;
        ctx.fillRect(px + ox, py + oy, dirs[i][0] ? 1 : 2, dirs[i][1] ? 1 : 2);
      }
      ctx.globalAlpha = 1;
    }
  }

  function chunkKey(cx, cy) { return cx + ',' + cy; }

  function getChunk(cx, cy) {
    var k = chunkKey(cx, cy);
    var c = chunks[k];
    if (c) return c;
    var cv = document.createElement('canvas');
    cv.width = CHUNK * TILE;
    cv.height = CHUNK * TILE;
    var g = cv.getContext('2d');
    g.imageSmoothingEnabled = false;
    var x0 = cx * CHUNK, y0 = cy * CHUNK;
    for (var ty = 0; ty < CHUNK; ty++) {
      for (var tx = 0; tx < CHUNK; tx++) paintTile(g, x0 + tx, y0 + ty, tx * TILE, ty * TILE);
    }
    for (var ty2 = 0; ty2 < CHUNK; ty2++) {
      for (var tx2 = 0; tx2 < CHUNK; tx2++) paintEdge(g, x0 + tx2, y0 + ty2, tx2 * TILE, ty2 * TILE);
    }
    chunks[k] = cv;
    chunkOrder.push(k);
    while (chunkOrder.length > 30) {
      var old = chunkOrder.shift();
      if (old !== k) delete chunks[old];
    }
    return cv;
  }

  // ---- 相机 ----
  function camUpdate(dt) {
    var me = S.me;
    if (!me) return;
    var tx = me.x * TILE, ty = me.y * TILE;
    var k = 1 - Math.pow(0.0016, dt);
    S.cam.x = lerp(S.cam.x, tx, k);
    S.cam.y = lerp(S.cam.y, ty, k);
    if (S.cam.shake > 0) {
      S.cam.shake = Math.max(0, S.cam.shake - dt * 26);
      S.cam.shakeX = (Math.random() - 0.5) * S.cam.shake;
      S.cam.shakeY = (Math.random() - 0.5) * S.cam.shake;
    } else { S.cam.shakeX = 0; S.cam.shakeY = 0; }
    var z = S.zoom;
    S.cam.x = Math.round(S.cam.x * z) / z;
    S.cam.y = Math.round(S.cam.y * z) / z;
  }

  function viewRange() {
    var m = S.map;
    var hw = S.view.w / 2 / S.zoom, hh = S.view.h / 2 / S.zoom;
    var x0 = Math.max(0, Math.floor((S.cam.x - hw) / TILE) - 1);
    var y0 = Math.max(0, Math.floor((S.cam.y - hh) / TILE) - 2);
    var x1 = Math.min(m.size - 1, Math.ceil((S.cam.x + hw) / TILE) + 1);
    var y1 = Math.min(m.size - 1, Math.ceil((S.cam.y + hh) / TILE) + 3);
    return { x0: x0, y0: y0, x1: x1, y1: y1 };
  }

  function drawGround(ctx, vr) {
    var z = S.zoom;
    var cx0 = Math.floor(vr.x0 / CHUNK), cx1 = Math.floor(vr.x1 / CHUNK);
    var cy0 = Math.floor(vr.y0 / CHUNK), cy1 = Math.floor(vr.y1 / CHUNK);
    ctx.imageSmoothingEnabled = false;
    for (var cy = cy0; cy <= cy1; cy++) {
      for (var cx = cx0; cx <= cx1; cx++) {
        var cv = getChunk(cx, cy);
        var wx = cx * CHUNK * TILE, wy = cy * CHUNK * TILE;
        ctx.drawImage(cv, Math.round(w2sX(wx)), Math.round(w2sY(wy)), CHUNK * TILE * z, CHUNK * TILE * z);
      }
    }
    ctx.imageSmoothingEnabled = false;
  }

  // 水面流光：贴图是静的，动的是光
  function drawWater(ctx, vr, t) {
    var z = S.zoom;
    for (var ty = vr.y0; ty <= vr.y1; ty++) {
      for (var tx = vr.x0; tx <= vr.x1; tx++) {
        var tt = tileAt(tx, ty);
        if (tt !== T.WATER && tt !== T.SHALLOW) continue;
        var sx = Math.round(w2sX(tx * TILE)), sy = Math.round(w2sY(ty * TILE));
        var w = TILE * z;
        var ph = (tx * 0.7 + ty * 0.45) + t * 0.85;
        var a = 0.07 + 0.07 * Math.sin(ph);
        ctx.fillStyle = 'rgba(200,235,255,' + a.toFixed(3) + ')';
        var yy = sy + (Math.sin(ph) * 0.5 + 0.5) * w * 0.7;
        ctx.fillRect(sx + w * 0.12, yy, w * 0.5, Math.max(1, z * 0.5));
        if (tt === T.WATER && hash2(tx, ty, 3) > 0.88) {
          var tw2 = 0.14 + 0.12 * Math.sin(ph * 1.7);
          ctx.fillStyle = 'rgba(255,255,255,' + tw2.toFixed(3) + ')';
          ctx.fillRect(sx + w * 0.55, sy + w * 0.3, Math.max(1, w * 0.14), Math.max(1, w * 0.08));
        }
      }
    }
  }

  // ---------------- §6.5 程序化像素精灵 ----------------
  var SPR = { tree: [], pine: [], dead: [], rock: [], bush: [] };

  function newSprite(w, h) {
    var cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    var g = cv.getContext('2d');
    g.imageSmoothingEnabled = false;
    g.clearRect(0, 0, w, h);
    return { cv: cv, g: g, w: w, h: h };
  }
  function putPx(g, x, y, c, a) {
    g.fillStyle = c;
    g.globalAlpha = a == null ? 1 : a;
    g.fillRect(x, y, 1, 1);
    g.globalAlpha = 1;
  }
  function discBlob(w, h, circles) {
    var m = new Uint8Array(w * h);
    for (var i = 0; i < circles.length; i++) {
      var c = circles[i];
      for (var y = 0; y < h; y++) {
        for (var x = 0; x < w; x++) {
          var dx = x + 0.5 - c.x, dy = y + 0.5 - c.y;
          if (dx * dx + dy * dy <= c.r * c.r) m[y * w + x] = 1;
        }
      }
    }
    return m;
  }

  // 树：主冠 + 侧冠 + 底层暗边 + 顶部高光。轮廓勾一圈暗色，
  // 这是像素树「立起来」的关键 —— 没有描边就只是绿色的一坨。
  function makeTree(seed, tint, big) {
    var W = big ? 30 : 24, H = big ? 36 : 30;
    var sp = newSprite(W, H);
    var g = sp.g;
    var rnd = function (n) { return hash2(seed, n, 41); };
    var cx = W / 2;
    var circles = [
      { x: cx, y: H * 0.38, r: W * 0.34 },
      { x: cx - W * 0.18, y: H * 0.30, r: W * 0.24 },
      { x: cx + W * 0.19, y: H * 0.31, r: W * 0.23 },
      { x: cx - W * 0.08, y: H * 0.50, r: W * 0.30 },
      { x: cx + W * 0.14, y: H * 0.52, r: W * 0.25 },
      { x: cx - W * 0.22, y: H * 0.48, r: W * 0.18 }
    ];
    var mask = discBlob(W, H, circles);
    var tw = big ? 5 : 4;
    var tx0 = Math.floor(cx - tw / 2);
    for (var y = H - 9; y < H; y++) {
      for (var x = tx0; x < tx0 + tw; x++) {
        putPx(g, x, y, x === tx0 ? '#3f2c1c' : (x === tx0 + tw - 1 ? '#5b4029' : '#6f5034'));
      }
    }
    putPx(g, tx0 - 1, H - 2, '#3f2c1c'); putPx(g, tx0 - 2, H - 1, '#3f2c1c');
    putPx(g, tx0 + tw, H - 2, '#3f2c1c'); putPx(g, tx0 + tw + 1, H - 1, '#3f2c1c');
    for (var yy = 0; yy < H; yy++) {
      for (var xx = 0; xx < W; xx++) {
        if (!mask[yy * W + xx]) continue;
        var edge = (xx === 0 || yy === 0 || xx === W - 1 || yy === H - 1) ||
          !mask[yy * W + xx - 1] || !mask[yy * W + xx + 1] ||
          !mask[(yy - 1) * W + xx] || (yy + 1 < H && !mask[(yy + 1) * W + xx]);
        if (edge) { putPx(g, xx, yy, tint.out); continue; }
        var rel = yy / H;
        var right = (xx - cx) / W;
        var c = rel < 0.28 ? tint.light : (rel < 0.55 ? tint.mid : tint.dark);
        if (right > 0.16 && rel > 0.42) c = tint.dark;
        putPx(g, xx, yy, c);
      }
    }
    for (var k = 0; k < 30; k++) {
      var ax = Math.floor(W * 0.16 + rnd(k) * W * 0.34);
      var ay = Math.floor(H * 0.12 + rnd(k + 50) * H * 0.26);
      if (mask[ay * W + ax]) putPx(g, ax, ay, tint.hi);
    }
    for (var m2 = 0; m2 < 7; m2++) {
      var bx = Math.floor(W * 0.18 + rnd(m2 + 90) * W * 0.64);
      var by = Math.floor(H * 0.62 + rnd(m2 + 140) * H * 0.12);
      if (mask[by * W + bx]) { putPx(g, bx, by + 1, tint.dark); putPx(g, bx, by + 2, tint.out); }
    }
    return sp.cv;
  }

  function makePine(seed, tint) {
    var W = 22, H = 34;
    var sp = newSprite(W, H);
    var g = sp.g;
    var cx = W / 2;
    for (var y = H - 8; y < H; y++) {
      putPx(g, Math.floor(cx) - 1, y, '#3f2c1c');
      putPx(g, Math.floor(cx), y, '#5b4029');
      putPx(g, Math.floor(cx) + 1, y, '#3f2c1c');
    }
    var tiers = [[0.02, 0.34], [0.24, 0.60], [0.46, 0.86]];
    for (var i = 0; i < tiers.length; i++) {
      var top = H * tiers[i][0], bot = H * tiers[i][1];
      var maxW = W * 0.46;
      for (var yy = Math.floor(top); yy < Math.floor(bot); yy++) {
        var k = (yy - top) / Math.max(1, bot - top);
        var half = Math.max(1, Math.floor(k * maxW + 1));
        for (var xx = Math.floor(cx - half); xx <= Math.floor(cx + half); xx++) {
          if (xx < 0 || xx >= W) continue;
          var isEdge = (xx <= cx - half + 0.5) || (xx >= cx + half - 0.5) || yy === Math.floor(top);
          var c = isEdge ? tint.out : (yy < top + (bot - top) * 0.45 ? tint.light : tint.mid);
          if (!isEdge && xx > cx + half * 0.35) c = tint.dark;
          putPx(g, xx, yy, c);
        }
      }
    }
    for (var s = 0; s < 5; s++) putPx(g, Math.floor(cx - 2 + s * 0.8), Math.floor(H * 0.035), '#f2f8ff');
    return sp.cv;
  }

  function makeDeadTree(seed) {
    var W = 20, H = 28;
    var sp = newSprite(W, H);
    var g = sp.g;
    var cx = Math.floor(W / 2);
    for (var y = 7; y < H; y++) {
      putPx(g, cx - 1, y, '#3b322a');
      putPx(g, cx, y, '#544737');
    }
    var branches = [[5, -1, 4], [4, 1, 4], [7, -1, 5], [6, 1, 5]];
    for (var i = 0; i < branches.length; i++) {
      var by = branches[i][0], dir = branches[i][1], len = branches[i][2];
      for (var k = 0; k < len; k++) putPx(g, cx + dir * (k + 1), by + Math.floor(k * 0.55), '#463c31');
    }
    return sp.cv;
  }

  function makeRock(seed) {
    var W = 22, H = 18;
    var sp = newSprite(W, H);
    var g = sp.g;
    var mask = discBlob(W, H, [
      { x: W * 0.48, y: H * 0.64, r: W * 0.32 },
      { x: W * 0.34, y: H * 0.56, r: W * 0.22 },
      { x: W * 0.64, y: H * 0.6, r: W * 0.2 }
    ]);
    for (var y = 0; y < H; y++) {
      for (var x = 0; x < W; x++) {
        if (!mask[y * W + x]) continue;
        var edge = (x === 0 || y === 0 || x === W - 1 || y === H - 1) ||
          !mask[y * W + x - 1] || !mask[y * W + x + 1] || !mask[(y - 1) * W + x] ||
          (y + 1 < H && !mask[(y + 1) * W + x]);
        if (edge) putPx(g, x, y, '#3d3833');
        else if (y < H * 0.42) putPx(g, x, y, '#91897c');
        else putPx(g, x, y, '#6e6860');
      }
    }
    for (var k = 0; k < 7; k++) putPx(g, Math.floor(W * 0.3 + hash2(seed, k, 9) * W * 0.28), Math.floor(H * 0.26 + hash2(seed, k, 10) * H * 0.14), '#b0a698');
    return sp.cv;
  }

  function makeBush(seed, tint) {
    var W = 20, H = 16;
    var sp = newSprite(W, H);
    var g = sp.g;
    var mask = discBlob(W, H, [
      { x: W * 0.5, y: H * 0.64, r: W * 0.28 },
      { x: W * 0.3, y: H * 0.7, r: W * 0.2 },
      { x: W * 0.7, y: H * 0.68, r: W * 0.19 }
    ]);
    for (var y = 0; y < H; y++) {
      for (var x = 0; x < W; x++) {
        if (!mask[y * W + x]) continue;
        var edge = (x === 0 || y === 0 || x === W - 1 || y === H - 1) ||
          !mask[y * W + x - 1] || !mask[y * W + x + 1] || !mask[(y - 1) * W + x];
        // 草丛要比树下亮：它是「草」，不是「阴影」。描边用 dark 不用 out。
        putPx(g, x, y, edge ? tint.dark : (y < H * 0.5 ? tint.hi : tint.light));
      }
    }
    return sp.cv;
  }

  function buildPropSprites() {
    SPR.tree = []; SPR.pine = []; SPR.dead = []; SPR.rock = []; SPR.bush = [];
    var tints = [
      { out: '#1e3a1c', dark: '#2f5c2c', mid: '#3f7539', light: '#55924a', hi: '#6fae5e' },
      { out: '#1b3520', dark: '#28502c', mid: '#356739', light: '#478245', hi: '#5f9c58' },
      { out: '#233a1a', dark: '#345428', mid: '#456d35', light: '#5a8843', hi: '#72a458' },
      { out: '#2a3a24', dark: '#3d5230', mid: '#4e683c', light: '#628049', hi: '#7b9c5e' }
    ];
    for (var i = 0; i < 8; i++) SPR.tree.push(makeTree(i + 1, tints[i % 4], i % 3 === 0));
    var ptint = [
      { out: '#152f26', dark: '#1e4433', mid: '#2a5a44', light: '#3a7558', hi: '#4d8c6a' },
      { out: '#1b332e', dark: '#27483f', mid: '#345e52', light: '#447a6a', hi: '#57917f' }
    ];
    for (var j = 0; j < 6; j++) SPR.pine.push(makePine(j + 11, ptint[j % 2]));
    for (var k = 0; k < 4; k++) SPR.dead.push(makeDeadTree(k + 21));
    for (var m = 0; m < 6; m++) SPR.rock.push(makeRock(m + 31));
    for (var n = 0; n < 4; n++) SPR.bush.push(makeBush(n + 41, tints[n % 4]));
  }

  // ---- 高处物件 ----
  var PROPS = [];

  function collectProps(vr) {
    PROPS.length = 0;
    for (var ty = vr.y0; ty <= vr.y1; ty++) {
      for (var tx = vr.x0; tx <= vr.x1; tx++) {
        var t = tileAt(tx, ty);
        if (t === T.TREE || t === T.PINE || t === T.DEADTREE || t === T.ROCK ||
            t === T.CLIFF || t === T.WALL || t === T.BRIDGE) {
          PROPS.push({ k: t, x: tx, y: ty, s: hash2(tx, ty, 7), z: zoneOf(tx, ty) });
        } else if ((t === T.GRASS || t === T.FLOWER) && hash2(tx, ty, 53) > 0.973) {
          // 零星的草丛：不挡路，只为把「一片绿」打散成「有东西的绿」
          PROPS.push({ k: 'bush', x: tx, y: ty, s: hash2(tx, ty, 59), z: zoneOf(tx, ty) });
        }
      }
    }
    // 守塔人遗物（《灯火纪》）：坐标精确，不在 tile 扫描里，单独收进视野
    var relics = S.map.relics || [];
    for (var ri = 0; ri < relics.length; ri++) {
      var rl = relics[ri];
      if (rl.x >= vr.x0 && rl.x <= vr.x1 && rl.y >= vr.y0 && rl.y <= vr.y1) {
        PROPS.push({ k: 'relic', x: rl.x, y: rl.y, s: 0.5, z: zoneOf(rl.x, rl.y), id: rl.id });
      }
    }
    // v5.8 夜语残页：常收进 PROPS（坐标=日记同格），可见性在 drawProp 里按 phase 门控
    var nights = S.map.nights || [];
    for (var ni = 0; ni < nights.length; ni++) {
      var ny = nights[ni];
      if (ny.x >= vr.x0 && ny.x <= vr.x1 && ny.y >= vr.y0 && ny.y <= vr.y1) {
        PROPS.push({ k: 'nyx', x: ny.x, y: ny.y, s: 0.5, z: zoneOf(ny.x, ny.y), id: ny.id });
      }
    }
  }

  function blitSprite(ctx, cv, cx, bottom, scale) {
    var w = cv.width * scale, h = cv.height * scale;
    ctx.drawImage(cv, Math.round(cx - w / 2), Math.round(bottom - h + scale * 1.5), Math.round(w), Math.round(h));
  }

  function propShadow(ctx, cx, bottom, wTiles) {
    var u = S.zoom * TILE;
    ctx.fillStyle = 'rgba(0,0,0,0.20)';
    ctx.beginPath();
    ctx.ellipse(cx, bottom - u * 0.05, wTiles * u * 0.5, u * 0.22, 0, 0, 6.2832);
    ctx.fill();
  }

  // v5.8 夜语残页的「显形程度」：深夜 1，黄昏最后 15% 渐显，黎明 5% 内渐隐。
  // 与服务端 collect 的相位门禁（dusk 本地进度 > 0.85）严格对齐，避免看得到却收不到。
  function nyxPhaseAlpha() {
    var pf = S.pf || 0;
    if (S.phase === 'night') return 1;
    if (S.phase === 'dusk') {
      var dk = (pf - 0.62) / 0.08;
      return dk > 0.85 ? Math.min(1, (dk - 0.85) / 0.15) : 0;
    }
    if (S.phase === 'dawn') {
      var dw = (pf - 0.95) / 0.05;
      return dw >= 1 ? 0 : Math.max(0, 1 - dw);
    }
    return 0;
  }

  // 今晚能听见的夜语：服务端按天轮转（S.loreNightPick），已收下的不再显形
  function nyxTonight(id) {
    if (!id) return false;
    if ((S.loreNightCollected || []).indexOf(id) >= 0) return false;
    return (S.loreNightPick || []).indexOf(id) >= 0;
  }

  function drawProp(ctx, p) {
    var sx = w2sX(p.x * TILE + TILE * 0.5), sy = w2sY(p.y * TILE + TILE);
    var z = S.zoom;
    // 风：树冠与草按各自相位慢摆，影子留在原地不动。
    // 每格一个相位，看上去才是「一片林子在风里」，而不是整屏一起平移。
    var sway = Math.sin(S.time * (p.k === 'bush' ? 1.9 : 0.85) + p.x * 0.31 + p.y * 0.17 + p.s * 3)
      * z * (p.k === 'bush' ? 0.55 : 0.38);
    switch (p.k) {
      case T.TREE:
        propShadow(ctx, sx, sy + z * 1.5, 1.7);
        blitSprite(ctx, SPR.tree[(p.s * SPR.tree.length) | 0], sx + sway, sy + z * 2, z);
        break;
      case T.PINE:
        propShadow(ctx, sx, sy + z * 1.5, 1.3);
        blitSprite(ctx, SPR.pine[(p.s * SPR.pine.length) | 0], sx + sway, sy + z * 2, z);
        break;
      case T.DEADTREE:
        propShadow(ctx, sx, sy + z, 1.1);
        blitSprite(ctx, SPR.dead[(p.s * SPR.dead.length) | 0], sx + sway * 0.6, sy + z, z);
        break;
      case T.ROCK:
        propShadow(ctx, sx, sy + z * 0.6, 1.1);
        blitSprite(ctx, SPR.rock[(p.s * SPR.rock.length) | 0], sx, sy + z, z);
        break;
      case T.CLIFF:
        drawCliff(ctx, sx, sy, p.s);
        break;
      case 'bush':
        blitSprite(ctx, SPR.bush[(p.s * SPR.bush.length) | 0], sx + sway, sy + z * 0.2, z * 0.8);
        break;
      case 'relic': {
        // 守塔人遗物石碑：三阶灰石 + 金色灯语刻痕 + 碑顶引导光点（未寻得更亮更闪）
        var u2 = TILE * z;
        var lit2 = S.loreCollected && S.loreCollected.indexOf(p.id) >= 0;
        propShadow(ctx, sx, sy + z * 0.4, 0.9);
        ctx.fillStyle = '#17120d';
        ctx.fillRect(sx - u2 * 0.26, sy - u2 * 0.92, u2 * 0.52, u2 * 0.92);
        ctx.fillStyle = '#847b6c';
        ctx.fillRect(sx - u2 * 0.20, sy - u2 * 0.86, u2 * 0.40, u2 * 0.80);
        ctx.fillStyle = '#a29a8e';
        ctx.fillRect(sx - u2 * 0.20, sy - u2 * 0.86, u2 * 0.40, u2 * 0.16);
        ctx.fillStyle = '#6a6156';
        ctx.fillRect(sx - u2 * 0.20, sy - u2 * 0.22, u2 * 0.40, u2 * 0.16);
        ctx.fillStyle = '#5a5248';
        ctx.fillRect(sx - u2 * 0.12, sy - u2 * 0.58, u2 * 0.24, u2 * 0.05);
        ctx.fillStyle = '#c9963f';
        ctx.fillRect(sx - u2 * 0.12, sy - u2 * 0.44, u2 * 0.24, u2 * 0.06);
        ctx.fillStyle = '#5a5248';
        ctx.fillRect(sx - u2 * 0.12, sy - u2 * 0.30, u2 * 0.24, u2 * 0.05);
        var twk = lit2 ? 0.35 : (0.62 + Math.sin(S.time * 2.2 + p.x * 1.7) * 0.22);
        ctx.fillStyle = lit2 ? 'rgba(255,210,122,' + twk.toFixed(2) + ')' : 'rgba(207,232,255,' + twk.toFixed(2) + ')';
        ctx.fillRect(sx - z * 1.5, sy - u2 * 1.08, z * 3, z * 3);
        break;
      }
      case 'nyx': {
        // v5.8 夜语残页：夜间浮现的撕口残页。phase 门控在这里做（PROPS 常收）。
        var nv = nyxPhaseAlpha();
        if (nv <= 0) break;
        if (!nyxTonight(p.id)) break;
        var un = TILE * S.zoom;
        var nx = w2sX(p.x * TILE + TILE * 0.5);
        var nyy = w2sY(p.y * TILE + TILE);
        var nbob = Math.round(Math.sin(S.time * 1.7 + (p.x * 3 + p.y) % 5) * un * 0.08);
        var ndrift = Math.round(Math.sin(S.time * 0.9 + p.y * 1.1) * un * 0.10);
        var ngot = S.loreNightCollected && S.loreNightCollected.indexOf(p.id) >= 0;
        var nalpha = ngot ? 0.30 : (0.55 + Math.sin(S.time * 2.2 + p.x * 0.9) * 0.18);
        nalpha = Math.max(0, Math.min(1, nalpha * nv));
        // 分离地面影：残页悬空，影子留在地上并随 drift 偏移
        ctx.fillStyle = 'rgba(8,12,20,' + (0.25 * nv).toFixed(2) + ')';
        ctx.beginPath();
        ctx.ellipse(nx - ndrift * 0.4, nyy - 1, un * 0.24, un * 0.07, 0, 0, 6.2832);
        ctx.fill();
        ctx.save();
        ctx.globalAlpha = nalpha;
        // 撕口残页三段横带（冷蓝纸底，撕口错位）
        var nw = un * 0.46;
        var ny0 = nyy - un * 0.86 + nbob;
        ctx.fillStyle = '#26314a';
        ctx.fillRect(nx - nw / 2 + ndrift, ny0, nw, un * 0.12);
        ctx.fillStyle = '#3a4a6a';
        ctx.fillRect(nx - nw / 2 + ndrift, ny0, nw, 1);
        ctx.fillStyle = '#1c2436';
        ctx.fillRect(nx - nw / 2 + un * 0.05 + ndrift, ny0 + un * 0.135, nw * 0.86, un * 0.11);
        ctx.fillStyle = '#232c40';
        ctx.fillRect(nx - nw / 2 - un * 0.03 + ndrift, ny0 + un * 0.26, nw * 0.82, un * 0.10);
        // 蓝字两行：#6fc0ff 小像素点行，呼吸明灭
        var ta = ngot ? 0.45 : (0.62 + Math.sin(S.time * 2.6 + p.y * 1.3) * 0.25);
        ctx.globalAlpha = Math.max(0, Math.min(1, nalpha * ta));
        ctx.fillStyle = '#6fc0ff';
        for (var ln = 0; ln < 2; ln++) {
          for (var ch = 0; ch < 7; ch++) {
            if ((p.x * 7 + p.y + ln * 3 + ch * 5) % 7 < 2) continue;
            ctx.fillRect(nx - nw / 2 + un * 0.06 + ch * un * 0.055 + ndrift,
              ny0 + un * 0.15 + ln * un * 0.10, Math.max(1, un * 0.032), Math.max(1, un * 0.022));
          }
        }
        ctx.restore();
        break;
      }
    }
  }

  function drawCliff(ctx, sx, sy, s) {
    var u = S.zoom * TILE;
    ctx.fillStyle = '#231f1b';
    ctx.fillRect(Math.round(sx - u * 0.5), Math.round(sy - u * 0.5), Math.round(u), Math.round(u));
    ctx.fillStyle = '#4b443c';
    ctx.fillRect(Math.round(sx - u * 0.5), Math.round(sy - u * 0.5), Math.round(u), Math.round(u * 0.3));
    ctx.fillStyle = '#15120f';
    ctx.fillRect(Math.round(sx - u * 0.5), Math.round(sy + u * 0.3), Math.round(u), Math.round(u * 0.2));
    if (s > 0.6) {
      ctx.fillStyle = '#3a342d';
      ctx.fillRect(Math.round(sx - u * 0.28), Math.round(sy - u * 0.16), Math.round(u * 0.22), Math.round(u * 0.4));
    }
  }


  // ======================== 04_landmarks.js ========================
  // ---------------- §7 地标 / 城镇 / 光照 ----------------
  // 镇上四间房：铁匠铺（锻造）、杂货铺（买药）、灯火客栈（休息回血）、守灯人之家（主线）。
  // 每栋房子的配色：屋顶 / 墙 / 木构 / 招牌。屋顶分成三阶，才有「脊上受光、檐口压暗」。
  var HOUSE_STYLE = {
    smith: { roof: '#7d4034', roofHi: '#94513f', roofLo: '#4d241c', wall: '#b3a281', wallHi: '#cbba94', wallLo: '#93825d', timber: '#5f4229', sign: '#ffb066', glow: '#ff9a4a', label: '铁匠铺' },
    shop: { roof: '#3b5c72', roofHi: '#4e738a', roofLo: '#1e3342', wall: '#ad9e81', wallHi: '#c6b796', wallLo: '#8b7c5e', timber: '#57493a', sign: '#8fd6ff', glow: '#7fc0e8', label: '杂货铺' },
    inn: { roof: '#4d4259', roofHi: '#635571', roofLo: '#2b2233', wall: '#b5a37c', wallHi: '#cdbb91', wallLo: '#93825d', timber: '#5a442f', sign: '#e0b6ff', glow: '#d0a0f0', label: '灯火客栈' },
    hall: { roof: '#77652f', roofHi: '#8d7940', roofLo: '#453818', wall: '#baa780', wallHi: '#d2bf94', wallLo: '#97865e', timber: '#624c30', sign: '#ffd98a', glow: '#ffcf70', label: '守灯人之家' }
  };

  // ---------------- 建筑：一个图层的前提 ----------------
  // 每栋房都按同一套顺序落在地上：
  //   ① 门前石台（地面层，drawStructureShadows 里统一画）
  //   ② 屋顶压住占地 w×h —— 从斜上方看到的前后两坡瓦面
  //   ③ 正面墙从占地南缘往下长，门 / 窗 / 招牌都在这面墙上
  //   ④ 墙脚接触线 + 台阶 + 统一方向（右下）的落影
  // 旧版把整栋房「立」在占地底边之上，屋顶探出画面、占地却是一块空地砖，
  // 于是上排看着像俯视、下排看着像正面 —— 这就是「不在一个图层」的根因。
  function houseGeom(h) {
    var u = TILE * S.zoom;
    var W = h.w * u, D = h.h * u;
    var over = Math.round(u * 0.15);        // 出檐
    var pad = Math.round(u * 0.62);         // 画布留白（屋脊 / 烟囱 / 挑檐）
    var wallH = Math.round(u * 1.18);       // 正面墙高
    var ridgeY = Math.round(D * 0.40);      // 屋脊
    var H = D + wallH;
    return {
      u: u, W: W, D: D, H: H, over: over, pad: pad, wallH: wallH, wallTop: D,
      ridgeY: ridgeY, roofBack: ridgeY, roofFront: D - ridgeY
    };
  }

  // 门 / 窗的坐标只在这里定义一次：预渲染与帧里的窗光、门灯必须严格对齐，
  // 否则夜里会出现「光飘在墙外」这种一眼假的问题。
  function houseDoor(G) {
    var dw = Math.round(G.W * 0.16);
    var dx = Math.round(G.W * 0.5 - dw / 2);
    var dy = G.D + G.wallH * 0.36;
    var dh = G.H - dy - Math.round(G.u * 0.16);
    return { dw: dw, dx: dx, dy: dy, dh: dh };
  }
  function houseWindows(G) {
    return {
      ww: Math.round(G.W * 0.132), wh: Math.round(G.u * 0.30),
      wy: G.D + G.wallH * 0.40,
      xs: [Math.round(G.W * 0.10), Math.round(G.W * 0.76)]
    };
  }

  // 把 #rrggbb 整体加减亮度。叠半透明层会把颜色「洗灰」，
  // 直接改 RGB 才能得到「同一批瓦、每片深浅不同」的土色。
  function shadeHex(hex, amt) {
    var n = parseInt(hex.slice(1), 16);
    var r = clamp(((n >> 16) & 255) + amt, 0, 255) | 0;
    var g2 = clamp(((n >> 8) & 255) + amt, 0, 255) | 0;
    var b = clamp((n & 255) + amt, 0, 255) | 0;
    return 'rgb(' + r + ',' + g2 + ',' + b + ')';
  }

  // 稀疏点噪声：给大面积平涂加一点「不是塑料」的颗粒。只在预渲染里跑一次。
  function speckle(g, x, y, w, h, color, count, seed, sizeMax) {
    g.fillStyle = color;
    var sm = sizeMax || 1;
    for (var i = 0; i < count; i++) {
      var px2 = x + ((hash2(seed + i, i * 7, 91) * w) | 0);
      var py2 = y + ((hash2(i * 13, seed + i, 92) * h) | 0);
      var s = 1 + ((hash2(i, seed, 93) * sm) | 0);
      g.fillRect(px2, py2, s, s);
    }
  }

  // 一坡瓦：逐片铺，每片自带明暗、上沿受光线、下沿暗缝。
  // 坡面按行推进，行距不同就能表达「后坡被透视压扁、前坡舒展」。
  // 一坡瓦：逐片铺，每片自带明暗、上沿受光线、下沿暗缝。
  // off 让四个坡面的瓦缝错开 —— 对齐了会变成横贯屋顶的一条条砖缝。
  function roofSlope(g, G, st, y0, y1, rows, bright, seed, off) {
    var u = G.u, tileW = Math.max(5, Math.round(u * 0.19));
    var rowH = (y1 - y0) / rows;
    var x0 = -G.over, x1 = G.W + G.over;
    for (var r = -1; r <= rows; r++) {
      var ry = y0 + r * rowH + (off || 0);
      var roff = (r % 2) * tileW * 0.5 + hash2(r, seed, 19) * tileW * 0.3;
      for (var tx = x0 - tileW; tx < x1 + tileW; tx += tileW) {
        var tw = Math.round(tileW * (0.84 + hash2(Math.round(tx), r, 23) * 0.3));
        var hv = hash2(Math.round(tx + tileW * 3), r + 7, 37);
        g.fillStyle = shadeHex(st.roof, (hv - 0.5) * 42 + bright);
        g.fillRect(Math.round(tx + roff), Math.round(ry), tw, Math.max(2, Math.round(rowH)));
        g.fillStyle = 'rgba(255,246,220,0.18)';
        g.fillRect(Math.round(tx + roff), Math.round(ry), tw, Math.max(1, u * 0.021));
        g.fillStyle = 'rgba(0,0,0,0.24)';
        g.fillRect(Math.round(tx + roff), Math.round(ry + rowH - Math.max(1, u * 0.024)), tw, Math.max(1, u * 0.024));
      }
      g.fillStyle = 'rgba(0,0,0,0.24)';
      g.fillRect(x0, Math.round(ry + rowH - Math.max(1, u * 0.012)), x1 - x0, Math.max(2, u * 0.024));
    }
  }

  // 把一栋房子的静态结构画进离屏画布。(0,0) = 占地左上角（屋顶后檐），y 向下到墙脚。
  function paintHouse(g, h, G) {
    var st = HOUSE_STYLE[h.kind] || HOUSE_STYLE.shop;
    var u = G.u, W = G.W, D = G.D, H = G.H, over = G.over;
    var dark = 'rgba(26,18,12,0.92)';
    var lw = Math.max(1, Math.round(u * 0.045));
    var door = houseDoor(G), win = houseWindows(G);

    // ---- 1. 四坡屋顶：屋脊是中间一条短线，四条戗脊连到四个檐角 ----
    // 俯视角下只有把「后坡 / 前坡 / 左坡 / 右坡」画成四个不同明度的面，
    // 房子才是一个盒子，而不是一块铺了瓦的地毯。这是「在同一图层」的关键。
    var rl = W * 0.27, rr = W * 0.73, ry = G.ridgeY;
    var rx0 = -over, rx1 = W + over;
    g.save();
    g.beginPath(); g.rect(rx0, 0, rx1 - rx0, D); g.clip();
    g.fillStyle = st.roof;
    g.fillRect(rx0, 0, rx1 - rx0, D);
    var faces = [
      { p: [[rx0, 0], [rx1, 0], [rr, ry], [rl, ry]], b: 30, rows: 4, seed: 11, off: 0 },
      { p: [[rl, ry], [rr, ry], [rx1, D], [rx0, D]], b: -18, rows: 7, seed: 29, off: 0 },
      { p: [[rx0, 0], [rl, ry], [rx0, D]], b: 10, rows: 7, seed: 43, off: u * 0.09 },
      { p: [[rx1, 0], [rx1, D], [rr, ry]], b: -34, rows: 7, seed: 57, off: u * 0.05 }
    ];
    for (var fi = 0; fi < faces.length; fi++) {
      var fc = faces[fi];
      g.save();
      g.beginPath();
      g.moveTo(fc.p[0][0], fc.p[0][1]);
      for (var pj = 1; pj < fc.p.length; pj++) g.lineTo(fc.p[pj][0], fc.p[pj][1]);
      g.closePath(); g.clip();
      roofSlope(g, G, st, 0, D, fc.rows, fc.b, fc.seed, fc.off);
      g.restore();
    }
    // 天光：后檐亮、前檐暗（四个面共享同一盏灯）
    var sky = g.createLinearGradient(0, 0, 0, D);
    sky.addColorStop(0, 'rgba(255,248,224,0.13)');
    sky.addColorStop(0.45, 'rgba(255,248,224,0)');
    sky.addColorStop(1, 'rgba(0,0,0,0.20)');
    g.fillStyle = sky;
    g.fillRect(rx0, 0, rx1 - rx0, D);
    g.restore();

    // 戗脊：先压暗、再覆亮，瓦垄才有隆起的厚度
    var hips = [[rl, ry, rx0, 0], [rr, ry, rx1, 0], [rl, ry, rx0, D], [rr, ry, rx1, D]];
    for (var hi2 = 0; hi2 < hips.length; hi2++) {
      var hp = hips[hi2];
      g.strokeStyle = 'rgba(14,9,7,0.66)';
      g.lineWidth = Math.max(3, u * 0.105);
      g.beginPath(); g.moveTo(hp[0], hp[1]); g.lineTo(hp[2], hp[3]); g.stroke();
      g.strokeStyle = st.roofHi;
      g.lineWidth = Math.max(2, u * 0.05);
      g.beginPath(); g.moveTo(hp[0], hp[1] - Math.max(1, u * 0.014)); g.lineTo(hp[2], hp[3] - Math.max(1, u * 0.014)); g.stroke();
      g.strokeStyle = 'rgba(255,246,220,0.28)';
      g.lineWidth = Math.max(1, u * 0.018);
      g.beginPath(); g.moveTo(hp[0], hp[1] - Math.max(2, u * 0.032)); g.lineTo(hp[2], hp[3] - Math.max(2, u * 0.032)); g.stroke();
    }
    // 短屋脊：亮带 + 两端翘头 + 下沿压暗
    var capH = Math.max(3, Math.round(u * 0.11));
    g.fillStyle = st.roofHi;
    g.fillRect(rl - u * 0.05, ry - capH * 0.5, rr - rl + u * 0.10, capH);
    g.fillStyle = 'rgba(255,252,236,0.36)';
    g.fillRect(rl - u * 0.05, ry - capH * 0.5, rr - rl + u * 0.10, Math.max(1, u * 0.025));
    g.fillStyle = 'rgba(0,0,0,0.44)';
    g.fillRect(rl - u * 0.05, ry + capH * 0.5 - Math.max(1, u * 0.02), rr - rl + u * 0.10, Math.max(1, u * 0.02));
    g.fillStyle = st.roofHi;
    g.fillRect(rl - u * 0.10, ry - capH * 0.85, u * 0.10, capH * 1.6);
    g.fillRect(rr, ry - capH * 0.85, u * 0.10, capH * 1.6);
    // 屋顶外框
    g.strokeStyle = dark; g.lineWidth = lw;
    g.strokeRect(rx0, 0, rx1 - rx0, D);

    // 苔痕：老屋顶的绿不是装饰，是「这房子有年头」的唯一证据
    for (var ms2 = 0; ms2 < 10; ms2++) {
      var mx2 = rl + hash2(ms2, h.w, 61) * (rr - rl);
      var my2 = ry + hash2(ms2, h.h, 62) * G.roofFront * 0.82;
      g.fillStyle = 'rgba(84,110,62,' + (0.08 + hash2(ms2, 9, 63) * 0.15).toFixed(2) + ')';
      g.fillRect(Math.round(mx2), Math.round(my2), Math.max(3, u * (0.07 + hash2(ms2, 4, 64) * 0.13)), Math.max(2, u * 0.035));
    }


    // ---- 2. 烟囱：坐在后坡上，往上探出屋脊。屋面上的影先画，否则是贴纸 ----
    var chW = u * 0.42, chX = W * 0.70, chY = G.ridgeY * 0.46, chH = u * 0.86;
    g.fillStyle = 'rgba(0,0,0,0.24)';
    g.fillRect(chX + u * 0.10, chY - chH * 0.05, chW + u * 0.10, chH * 0.72);
    g.fillStyle = '#8d7f68';
    g.fillRect(chX, chY - chH, chW, chH);
    g.fillStyle = '#6d6355';
    g.fillRect(chX, chY - chH, Math.max(1, u * 0.055), chH);
    g.fillStyle = '#a19684';
    g.fillRect(chX - u * 0.07, chY - chH - u * 0.10, chW + u * 0.14, u * 0.12);
    g.fillStyle = 'rgba(0,0,0,0.34)';
    g.fillRect(chX - u * 0.07, chY - chH, chW + u * 0.14, Math.max(1, u * 0.022));
    g.fillStyle = 'rgba(40,32,24,0.22)';
    for (var cb = 1; cb < 4; cb++) g.fillRect(chX, Math.round(chY - chH + chH * 0.22 * cb), chW, Math.max(1, u * 0.016));
    g.fillStyle = '#5b5245';
    g.fillRect(chX + u * 0.06, chY - chH - u * 0.16, chW - u * 0.12, u * 0.07);
    g.fillStyle = 'rgba(16,12,10,0.8)';
    g.fillRect(chX + u * 0.14, chY - chH - u * 0.15, chW - u * 0.28, u * 0.05);
    g.strokeStyle = 'rgba(26,18,12,0.75)'; g.lineWidth = lw;
    g.beginPath();
    g.moveTo(chX, chY - chH); g.lineTo(chX, chY);
    g.moveTo(chX + chW, chY - chH); g.lineTo(chX + chW, chY);
    g.stroke();

    // ---- 3. 檐板 + 椽头：屋顶有厚度，才压得住墙 ----
    var eaveH = Math.max(3, Math.round(u * 0.11));
    g.fillStyle = st.roofLo;
    g.fillRect(-over, D - eaveH * 0.35, W + over * 2, eaveH);
    g.fillStyle = 'rgba(255,246,220,0.16)';
    g.fillRect(-over, D - eaveH * 0.35, W + over * 2, Math.max(1, u * 0.022));
    g.fillStyle = 'rgba(0,0,0,0.5)';
    g.fillRect(-over, D + eaveH * 0.65 - Math.max(1, u * 0.02), W + over * 2, Math.max(1, u * 0.02));
    for (var rt = -over + u * 0.08; rt < W + over - u * 0.05; rt += u * 0.22) {
      g.fillStyle = 'rgba(44,29,16,0.60)';
      g.fillRect(Math.round(rt), D + eaveH * 0.35, Math.max(2, u * 0.045), Math.max(2, u * 0.065));
    }

    // ---- 4. 正面墙：灰泥 + 木构，左受光右背光（全场景同一盏灯） ----
    var plinthH = Math.round(u * 0.16);
    var wallHH = G.wallH;
    g.fillStyle = st.wall;
    g.fillRect(0, D, W, wallHH);
    var wg = g.createLinearGradient(0, 0, W, 0);
    wg.addColorStop(0, 'rgba(255,248,224,0.17)');
    wg.addColorStop(0.22, 'rgba(255,248,224,0)');
    wg.addColorStop(0.72, 'rgba(30,20,10,0)');
    wg.addColorStop(1, 'rgba(30,20,10,0.26)');
    g.fillStyle = wg; g.fillRect(0, D, W, wallHH);
    speckle(g, 0, D, W, wallHH, 'rgba(70,52,32,0.10)', Math.round(W / 4), 41, 2);
    speckle(g, 0, D, W, wallHH, 'rgba(255,246,220,0.09)', Math.round(W / 6), 57, 1);
    // 檐下阴影：屋顶压在墙上，这道渐变是「体块感」的来源
    var eg = g.createLinearGradient(0, D, 0, D + wallHH * 0.56);
    eg.addColorStop(0, 'rgba(0,0,0,0.46)');
    eg.addColorStop(0.55, 'rgba(0,0,0,0.14)');
    eg.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = eg; g.fillRect(0, D, W, wallHH * 0.56);
    // 木构：上下横梁 + 立柱 + 两端斜撑
    g.fillStyle = st.timber;
    var beam = Math.max(2, Math.round(u * 0.085));
    g.fillRect(0, D, W, beam);
    g.fillRect(0, H - plinthH - beam, W, beam);
    var posts = [0, W * 0.30, W * 0.70, W - beam];
    for (var pi = 0; pi < posts.length; pi++) g.fillRect(Math.round(posts[pi]), D, beam, wallHH);
    g.save();
    g.beginPath();
    g.moveTo(0, D + beam); g.lineTo(W * 0.30, D + beam); g.lineTo(0, D + wallHH * 0.52); g.closePath();
    g.fillStyle = 'rgba(107,74,48,0.42)'; g.fill();
    g.beginPath();
    g.moveTo(W, D + beam); g.lineTo(W * 0.70, D + beam); g.lineTo(W, D + wallHH * 0.52); g.closePath();
    g.fill();
    g.restore();
    g.fillStyle = 'rgba(255,240,200,0.15)';
    g.fillRect(0, D, W, Math.max(1, u * 0.025));
    // 转角石：左右两端各一列，墙才有「折到侧面」的暗示
    for (var qi = 0; qi < 5; qi++) {
      g.fillStyle = qi % 2 ? 'rgba(255,248,224,0.14)' : 'rgba(40,28,16,0.16)';
      g.fillRect(0, D + qi * wallHH / 5, Math.max(2, u * 0.075), wallHH / 5 - 1);
      g.fillRect(W - Math.max(2, u * 0.075), D + qi * wallHH / 5, Math.max(2, u * 0.075), wallHH / 5 - 1);
    }

    // ---- 5. 门：凹进门洞 + 双开木门 + 铁件 + 台阶 ----
    var dx = door.dx, dy = door.dy, dw = door.dw, dh = door.dh;
    g.fillStyle = 'rgba(24,16,10,0.92)';
    g.fillRect(dx - u * 0.055, dy - u * 0.06, dw + u * 0.11, dh + u * 0.10);
    g.fillStyle = st.timber;
    g.fillRect(dx - u * 0.12, dy - u * 0.14, dw + u * 0.24, u * 0.10);
    g.fillStyle = '#5b3f27';
    g.fillRect(dx, dy, dw, dh);
    g.fillStyle = '#7a5636';
    g.fillRect(dx + u * 0.03, dy + u * 0.04, dw * 0.46, dh - u * 0.07);
    g.fillRect(dx + dw * 0.51, dy + u * 0.04, dw * 0.46, dh - u * 0.07);
    g.fillStyle = 'rgba(40,26,14,0.28)';
    for (var vg2 = 1; vg2 < 4; vg2++) {
      g.fillRect(dx + dw * 0.11 * vg2, dy + u * 0.05, Math.max(1, u * 0.018), dh - u * 0.08);
      g.fillRect(dx + dw * 0.60 + dw * 0.11 * vg2, dy + u * 0.05, Math.max(1, u * 0.018), dh - u * 0.08);
    }
    g.fillStyle = '#4a4038';
    g.fillRect(dx - u * 0.02, dy + dh * 0.20, dw + u * 0.04, Math.max(2, u * 0.05));
    g.fillRect(dx - u * 0.02, dy + dh * 0.70, dw + u * 0.04, Math.max(2, u * 0.05));
    g.fillStyle = '#d8b25e';
    g.fillRect(dx + dw * 0.40, dy + dh * 0.44, Math.max(2, u * 0.042), Math.max(2, u * 0.042));
    g.fillRect(dx + dw * 0.56, dy + dh * 0.44, Math.max(2, u * 0.042), Math.max(2, u * 0.042));
    // 台阶：向画面下方伸出来，房子才「踩」在地上
    var sw = dw + u * 0.48;
    g.fillStyle = '#9c9080';
    g.fillRect(dx - u * 0.24, H - plinthH, sw, u * 0.20);
    g.fillStyle = '#bdb09a';
    g.fillRect(dx - u * 0.24, H - plinthH, sw, u * 0.045);
    g.fillStyle = 'rgba(0,0,0,0.30)';
    g.fillRect(dx - u * 0.24, H - plinthH + u * 0.17, sw, u * 0.04);
    g.strokeStyle = 'rgba(30,20,12,0.6)'; g.lineWidth = 1;
    g.strokeRect(dx - u * 0.24, H - plinthH, sw, u * 0.20);

    // 门灯（墙上的一盏小灯，夜里在帧里点亮）
    var lampX = dx - u * 0.40, lampY = dy + u * 0.02;
    g.fillStyle = '#3a2c1e';
    g.fillRect(lampX - u * 0.03, lampY - u * 0.30, u * 0.05, u * 0.30);
    g.fillRect(lampX - u * 0.02, lampY - u * 0.32, u * 0.16, u * 0.05);
    g.fillStyle = '#e8c070';
    g.fillRect(lampX + u * 0.08, lampY - u * 0.32, u * 0.19, u * 0.20);
    g.fillStyle = '#2a2018';
    g.fillRect(lampX + u * 0.05, lampY - u * 0.36, u * 0.25, u * 0.05);
    g.fillRect(lampX + u * 0.05, lampY - u * 0.10, u * 0.25, u * 0.04);

    // ---- 6. 窗：窗框 + 十字棂 + 窗台 + 花箱 ----
    for (var k = 0; k < win.xs.length; k++) {
      var wx = win.xs[k], wy = win.wy, ww = win.ww, wh = win.wh;
      g.fillStyle = 'rgba(26,18,10,0.9)';
      g.fillRect(wx - u * 0.05, wy - u * 0.05, ww + u * 0.10, wh + u * 0.10);
      g.fillStyle = '#4a3c2c';
      g.fillRect(wx - u * 0.02, wy - u * 0.02, ww + u * 0.04, wh + u * 0.04);
      g.fillStyle = 'rgba(255,255,255,0.06)';
      g.fillRect(wx, wy, ww, wh);
      // 玻璃颜色交给帧里按昼夜填，这里只画棂
      g.fillStyle = '#c3b08a';
      g.fillRect(wx - u * 0.09, wy + wh + u * 0.04, ww + u * 0.18, u * 0.065);
      g.fillStyle = 'rgba(0,0,0,0.28)';
      g.fillRect(wx - u * 0.09, wy + wh + u * 0.105, ww + u * 0.18, u * 0.03);
      // 花箱 + 三朵花
      g.fillStyle = '#6b4a2e';
      g.fillRect(wx - u * 0.04, wy + wh + u * 0.13, ww + u * 0.08, u * 0.12);
      var bloom = ['#e0645a', '#f0c86a', '#d879b0'];
      for (var bi = 0; bi < 3; bi++) {
        g.fillStyle = bloom[(bi + k) % 3];
        g.fillRect(Math.round(wx + u * 0.03 + (ww - u * 0.06) * (bi / 2)), wy + wh + u * 0.06, Math.max(2, u * 0.052), Math.max(2, u * 0.052));
      }
      g.fillStyle = '#4f7a38';
      g.fillRect(wx + u * 0.02, wy + wh + u * 0.11, ww - u * 0.04, u * 0.03);
    }

    // ---- 7. 招牌：挂在檐板下的横匾 ----
    var sbW = Math.round(dw * 1.62), sbH = Math.max(7, Math.round(u * 0.26));
    var sbX = Math.round(W * 0.5 - sbW / 2), sbY = D + eaveH * 0.7;
    g.fillStyle = '#2f2519';
    g.fillRect(sbX - u * 0.04, sbY - u * 0.06, u * 0.05, u * 0.10);
    g.fillRect(sbX + sbW - u * 0.01, sbY - u * 0.06, u * 0.05, u * 0.10);
    g.fillStyle = '#3a2c1c';
    g.fillRect(sbX - u * 0.05, sbY - u * 0.04, sbW + u * 0.10, sbH + u * 0.08);
    g.fillStyle = '#4a3520';
    g.fillRect(sbX, sbY, sbW, sbH);
    g.fillStyle = st.sign; g.globalAlpha = 0.40;
    g.fillRect(sbX + u * 0.03, sbY + u * 0.035, sbW - u * 0.06, sbH - u * 0.07);
    g.globalAlpha = 1;
    g.fillStyle = 'rgba(255,255,255,0.13)';
    g.fillRect(sbX, sbY + sbH - Math.max(1, u * 0.028), sbW, Math.max(1, u * 0.028));
    // 匾上的记号：锤 / 币 / 杯 / 灯
    g.fillStyle = 'rgba(40,26,14,0.84)';
    var icoX = sbX + sbW * 0.5 - u * 0.10, icoY = sbY + sbH * 0.22, ip = Math.max(1, u * 0.032);
    if (h.kind === 'smith') {
      g.fillRect(icoX + ip * 2, icoY, ip * 2, ip * 5);
      g.fillRect(icoX, icoY + ip * 4, ip * 6, ip * 2);
    } else if (h.kind === 'shop') {
      g.fillRect(icoX, icoY + ip, ip * 5, ip * 4);
      g.fillRect(icoX + ip, icoY, ip * 3, ip);
      g.fillRect(icoX + ip * 2, icoY + ip * 2, ip, ip * 2);
    } else if (h.kind === 'inn') {
      g.fillRect(icoX, icoY, ip * 5, ip);
      g.fillRect(icoX, icoY, ip, ip * 5);
      g.fillRect(icoX + ip * 4, icoY, ip, ip * 5);
      g.fillRect(icoX, icoY + ip * 4, ip * 5, ip);
    } else {
      g.fillRect(icoX + ip * 2, icoY - ip, ip * 2, ip * 2);
      g.fillRect(icoX + ip, icoY + ip, ip * 4, ip * 3);
      g.fillRect(icoX, icoY + ip * 4, ip * 6, ip);
    }
    g.strokeStyle = 'rgba(26,18,12,0.9)'; g.lineWidth = 1;
    g.strokeRect(sbX, sbY, sbW, sbH);

    // ---- 8. 墙脚：石砌台基 + 硬描边（最后压，边才硬） ----
    g.fillStyle = '#7d7263';
    g.fillRect(-u * 0.03, H - plinthH, W + u * 0.06, plinthH);
    g.fillStyle = 'rgba(255,246,220,0.13)';
    g.fillRect(-u * 0.03, H - plinthH, W + u * 0.06, Math.max(1, u * 0.025));
    g.fillStyle = 'rgba(0,0,0,0.32)';
    for (var bx = -u * 0.03; bx < W; bx += u * 0.34) g.fillRect(Math.round(bx), H - plinthH, Math.max(1, u * 0.02), plinthH);
    g.strokeStyle = dark; g.lineWidth = lw;
    g.beginPath();
    g.moveTo(0, D); g.lineTo(0, H); g.lineTo(W, H); g.lineTo(W, D);
    g.stroke();
    g.fillStyle = 'rgba(8,10,16,0.55)';
    g.fillRect(-u * 0.03, H, W + u * 0.06, Math.max(1, u * 0.035));
  }

  function houseCanvas(h, dark) {
    if (!S.houseCache) S.houseCache = {};
    var key = h.kind + '|' + h.w + '|' + h.h + '|' + S.zoom + '|' + dark;
    if (S.houseCache[key]) return S.houseCache[key];
    var G = houseGeom(h);
    var cv = document.createElement('canvas');
    cv.width = Math.ceil(G.W + G.over * 2 + G.pad * 2);
    cv.height = Math.ceil(G.H + G.pad * 2);
    var g = cv.getContext('2d');
    g.translate(G.over + G.pad, G.pad);
    paintHouse(g, h, G);
    if (dark > 0) {
      // source-atop 只染已经画过的像素：屋角外的透明区不会把地面也压暗
      g.globalCompositeOperation = 'source-atop';
      g.fillStyle = 'rgba(12,16,34,' + (dark * 0.42).toFixed(3) + ')';
      g.fillRect(-G.over - G.pad, -G.pad, cv.width, cv.height);
      g.globalCompositeOperation = 'source-over';
    }
    S.houseCache[key] = cv;
    return cv;
  }

  // 地面层：门前石台 + 接触阴影 + 统一落影。所有大结构走这一遍（实体之前），
  // 影子才不会盖到站在前面的人身上，房子也才有「踩在地上」的那块地。
  function drawStructureShadows(ctx, vr) {
    var houses = S.map.town.houses || [];
    var u = S.zoom * TILE;
    for (var i = 0; i < houses.length; i++) {
      var h = houses[i];
      if (h.x + h.w < vr.x0 - 4 || h.x > vr.x1 + 4 || h.y + h.h < vr.y0 - 4 || h.y > vr.y1 + 4) continue;
      var G = houseGeom(h);
      var x0 = w2sX(h.x * TILE), x1 = w2sX((h.x + h.w) * TILE);
      var yTop = w2sY(h.y * TILE);
      var yFoot = yTop + G.H;                     // 墙脚线
      var yWall = yTop + G.D;                    // 占地南缘

      // ① 门前石台：铺在墙脚前，砖缝错开，边缘压暗 —— 房子和地面在这里缝合
      var apronY = yFoot - u * 0.02, apronH = u * 0.58;
      ctx.fillStyle = 'rgba(28,22,16,0.20)';
      ctx.fillRect(x0 - u * 0.18, apronY + apronH, (x1 - x0) + u * 0.36, u * 0.06);
      ctx.fillStyle = '#a89a7e';
      ctx.fillRect(x0 - u * 0.16, apronY, (x1 - x0) + u * 0.32, apronH);
      ctx.fillStyle = 'rgba(255,248,224,0.08)';
      ctx.fillRect(x0 - u * 0.16, apronY, (x1 - x0) + u * 0.32, u * 0.035);
      var brickW = u * 0.62, brickH = u * 0.19;
      for (var br = 0; br < 3; br++) {
        var by = apronY + br * brickH;
        var shift = (br % 2) * brickW * 0.5;
        for (var bc = x0 - u * 0.16 - brickW; bc < x1 + u * 0.16; bc += brickW) {
          ctx.fillStyle = hash2(Math.round(bc), br, 77) > 0.55 ? 'rgba(255,246,220,0.07)' : 'rgba(70,56,38,0.10)';
          ctx.fillRect(bc + shift, by + brickH * 0.18, brickW - 2, brickH - 2);
        }
      }
      ctx.strokeStyle = 'rgba(50,38,26,0.42)'; ctx.lineWidth = 1;
      ctx.strokeRect(x0 - u * 0.16, apronY, (x1 - x0) + u * 0.32, apronH);

      // ② 落影：光源在左上，影子一律落右下（平行四边形，从墙脚出发）
      var offX = u * 0.52, offY = u * 0.44;
      ctx.beginPath();
      ctx.moveTo(x0 + u * 0.04, yFoot - u * 0.03);
      ctx.lineTo(x1 + u * 0.04, yFoot - u * 0.03);
      ctx.lineTo(x1 + offX, yFoot + offY);
      ctx.lineTo(x0 + offX, yFoot + offY);
      ctx.closePath();
      var sg = ctx.createLinearGradient(0, yFoot, 0, yFoot + offY);
      sg.addColorStop(0, 'rgba(14,18,26,0.24)');
      sg.addColorStop(1, 'rgba(14,18,26,0)');
      ctx.fillStyle = sg;
      ctx.fill();
      // ③ 接触阴影：墙和地面之间必须有这条暗，否则是贴纸
      ctx.fillStyle = 'rgba(10,12,18,0.32)';
      ctx.fillRect(x0 - u * 0.05, yFoot - u * 0.045, (x1 - x0) + u * 0.10, u * 0.075);
      // ④ 屋顶在地面上的投影（檐口往右下一小条），强化「建筑是立起来的」
      ctx.fillStyle = 'rgba(12,16,24,0.12)';
      ctx.fillRect(x0 + u * 0.10, yWall + u * 0.03, (x1 - x0) + u * 0.18, u * 0.06);
    }
    // 灯塔的影
    for (var z in S.map.towers) {
      var tw = S.map.towers[z];
      if (!tw) continue;
      var tx = w2sX(tw.x * TILE + TILE * 0.5), ty = w2sY((tw.y + 1) * TILE);
      ctx.fillStyle = 'rgba(14,18,26,0.20)';
      ctx.beginPath();
      ctx.ellipse(tx + u * 0.34, ty + u * 0.1, u * 0.95, u * 0.24, -0.18, 0, 6.2832);
      ctx.fill();
    }
  }

  function drawHouse(ctx, h, t) {
    var G = houseGeom(h);
    var u = G.u;
    // 原点对齐「占地后檐」：屋顶压住自己的占地，正面墙落到占地南缘之下
    var x0 = Math.round(w2sX(h.x * TILE));
    var y0 = Math.round(w2sY(h.y * TILE));
    var dark = S.phase === 'night' ? 1 : (S.phase === 'dusk' ? 0.55 : 0);
    var cv = houseCanvas(h, dark);
    var lit = (S.phase === 'night' || S.phase === 'dusk');

    ctx.drawImage(cv, Math.round(x0 - G.over - G.pad), Math.round(y0 - G.pad));

    // 窗光 / 玻璃反光（夜里亮灯，白天是天光）
    var win = houseWindows(G);
    var flick = 0.86 + Math.sin(t * 3.7 + h.x) * 0.14;
    for (var k = 0; k < win.xs.length; k++) {
      var wx = x0 + win.xs[k], sy = y0 + win.wy, ww = win.ww, wh = win.wh;
      if (lit) {
        ctx.fillStyle = 'rgba(255,204,120,' + (0.9 * flick).toFixed(2) + ')';
        ctx.fillRect(wx, sy, ww, wh);
        ctx.fillStyle = 'rgba(255,238,190,0.55)';
        ctx.fillRect(wx, sy, ww, Math.max(2, Math.round(wh * 0.28)));
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        var gg = ctx.createRadialGradient(wx + ww / 2, sy + wh / 2, 0, wx + ww / 2, sy + wh / 2, u * 1.5);
        gg.addColorStop(0, 'rgba(255,190,110,' + (0.15 * flick).toFixed(3) + ')');
        gg.addColorStop(1, 'rgba(255,190,110,0)');
        ctx.fillStyle = gg;
        ctx.fillRect(wx - u * 1.5, sy - u * 1.5, u * 3, u * 3);
        ctx.restore();
      } else {
        ctx.fillStyle = '#6f8fa8';
        ctx.fillRect(wx, sy, ww, wh);
        ctx.fillStyle = 'rgba(220,240,255,0.34)';
        ctx.beginPath();
        ctx.moveTo(wx, sy + wh); ctx.lineTo(wx + ww * 0.55, sy);
        ctx.lineTo(wx + ww, sy); ctx.lineTo(wx + ww * 0.45, sy + wh);
        ctx.closePath(); ctx.fill();
      }
      // 十字棂重新压一遍，免得被光块盖掉
      ctx.fillStyle = 'rgba(46,32,20,0.86)';
      ctx.fillRect(Math.round(wx + ww * 0.47), sy, Math.max(2, u * 0.038), wh);
      ctx.fillRect(wx, Math.round(sy + wh * 0.47), ww, Math.max(2, u * 0.038));
    }

    // 门灯：夜里往外溢一圈暖光
    var door = houseDoor(G);
    var lampX = x0 + door.dx - u * 0.40 + u * 0.17;
    var lampY = y0 + door.dy + u * 0.02 - u * 0.22;
    if (lit) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      var lg = ctx.createRadialGradient(lampX, lampY, 0, lampX, lampY, u * 2.1);
      lg.addColorStop(0, 'rgba(255,200,110,' + (0.28 * flick).toFixed(3) + ')');
      lg.addColorStop(1, 'rgba(255,200,110,0)');
      ctx.fillStyle = lg;
      ctx.fillRect(lampX - u * 2.1, lampY - u * 2.1, u * 4.2, u * 4.2);
      ctx.restore();
    }

    // 炊烟：三团循环上升（白天淡一点、夜里被灯光照亮）
    var chX = x0 + G.W * 0.70 + u * 0.21;
    var chY = y0 + G.ridgeY * 0.46 - u * 0.86;
    for (var s2 = 0; s2 < 3; s2++) {
      var ph = (t * 0.32 + s2 * 0.333) % 1;
      var sa = (1 - ph) * 0.20 * (lit ? 1.5 : 1);
      if (sa <= 0.01) continue;
      ctx.fillStyle = 'rgba(214,214,222,' + sa.toFixed(3) + ')';
      ctx.beginPath();
      ctx.arc(chX + Math.sin(ph * 6.2 + s2) * u * 0.14, chY - ph * u * 1.4, u * (0.09 + ph * 0.17), 0, 6.2832);
      ctx.fill();
    }
  }

  // 广场上的东西：不是装饰，是「这里有人住」的证据。
  // 位置按新的 4×3 房屋布局重排，全部避开门口与主路。
  function townProps() {
    var t = S.map.town;
    return [
      { k: 'well', x: t.cx - 3.1, y: t.cy - 0.2 },
      { k: 'board', x: t.cx + 1.6, y: t.cy - 1.4 },
      { k: 'bench', x: t.cx + 2.1, y: t.cy + 0.5 },
      { k: 'barrel', x: t.cx + 4.7, y: t.cy - 1.1 },
      { k: 'barrel', x: t.cx + 5.2, y: t.cy - 0.5 },
      { k: 'sack', x: t.cx + 4.3, y: t.cy - 0.3 },
      { k: 'crate', x: t.cx - 4.9, y: t.cy - 0.9 },
      { k: 'crate', x: t.cx - 5.4, y: t.cy - 0.35 },
      { k: 'wood', x: t.cx - 4.6, y: t.cy + 1.4 },
      { k: 'pot', x: t.cx - 2.0, y: t.cy + 1.5 },
      { k: 'pot', x: t.cx + 2.0, y: t.cy + 1.5 },
      { k: 'lamp', x: t.cx - 2.4, y: t.cy - 2.4 },
      { k: 'lamp', x: t.cx + 2.4, y: t.cy - 2.4 },
      { k: 'lamp', x: t.cx - 2.4, y: t.cy + 3.4 },
      { k: 'lamp', x: t.cx + 2.4, y: t.cy + 3.4 }
    ];
  }

  function drawTownProp(ctx, p) {
    var u = S.zoom * TILE;   // 一格在屏幕上的像素数
    var sx = Math.round(w2sX(p.x * TILE)), sy = Math.round(w2sY(p.y * TILE));
    var lit = (S.phase === 'night' || S.phase === 'dusk');

    // 统一落影：光源在左上，影子落右下。所有物件共用这一条，才像在同一个世界。
    // ⚠️ w/h 已经是像素值（调用处都乘过 u 了）。这里再乘一次 u 会得到 700px 的巨影，
    // 十几个道具叠起来就把整片广场压黑 —— 这类 bug 看起来像「全局光照坏了」。
    function dropShadow(w, h) {
      ctx.fillStyle = 'rgba(14,16,24,0.22)';
      ctx.beginPath();
      ctx.ellipse(sx + u * 0.06, sy + u * 0.02, w, h, 0, 0, 6.2832);
      ctx.fill();
    }

    if (p.k === 'well') {
      // 井：石圈 + 水面 + 两根柱子 + 小顶棚 + 吊桶
      var rw = u * 0.6, rh = u * 0.25;
      dropShadow(rw * 1.15, rh * 1.15);
      ctx.fillStyle = '#5f574e';
      ctx.beginPath(); ctx.ellipse(sx, sy - u * 0.08, rw, rh, 0, 0, 6.2832); ctx.fill();
      ctx.fillStyle = '#8a8175';
      ctx.beginPath(); ctx.ellipse(sx, sy - u * 0.16, rw * 0.94, rh * 0.9, 0, 0, 6.2832); ctx.fill();
      ctx.fillStyle = 'rgba(255,250,232,0.18)';
      ctx.beginPath(); ctx.ellipse(sx, sy - u * 0.2, rw * 0.94, rh * 0.9, 0, Math.PI, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#25333f';
      ctx.beginPath(); ctx.ellipse(sx, sy - u * 0.16, rw * 0.62, rh * 0.56, 0, 0, 6.2832); ctx.fill();
      ctx.fillStyle = 'rgba(140,200,220,0.26)';
      ctx.beginPath(); ctx.ellipse(sx - rw * 0.2, sy - u * 0.19, rw * 0.2, rh * 0.16, 0, 0, 6.2832); ctx.fill();
      ctx.strokeStyle = 'rgba(30,24,18,0.65)';
      ctx.lineWidth = Math.max(1, S.zoom * 0.4);
      ctx.beginPath(); ctx.ellipse(sx, sy - u * 0.16, rw * 0.94, rh * 0.9, 0, 0, 6.2832); ctx.stroke();
      // 柱与顶
      ctx.fillStyle = '#5b4130';
      ctx.fillRect(Math.round(sx - rw * 0.88), Math.round(sy - u * 1.02), Math.max(2, u * 0.1), Math.round(u * 0.84));
      ctx.fillRect(Math.round(sx + rw * 0.78), Math.round(sy - u * 1.02), Math.max(2, u * 0.1), Math.round(u * 0.84));
      ctx.fillStyle = '#7d4438';
      ctx.beginPath();
      ctx.moveTo(sx - rw * 1.2, sy - u * 0.98);
      ctx.lineTo(sx, sy - u * 1.4);
      ctx.lineTo(sx + rw * 1.2, sy - u * 0.98);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.16)';
      ctx.beginPath();
      ctx.moveTo(sx - rw * 1.1, sy - u * 1.0);
      ctx.lineTo(sx, sy - u * 1.34);
      ctx.lineTo(sx + rw * 0.12, sy - u * 1.0);
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = 'rgba(28,20,14,0.8)';
      ctx.beginPath();
      ctx.moveTo(sx - rw * 1.2, sy - u * 0.98);
      ctx.lineTo(sx, sy - u * 1.4);
      ctx.lineTo(sx + rw * 1.2, sy - u * 0.98);
      ctx.stroke();
      // 吊桶
      ctx.fillStyle = 'rgba(210,200,170,0.45)';
      ctx.fillRect(Math.round(sx), Math.round(sy - u * 0.92), 1, Math.round(u * 0.42));
      ctx.fillStyle = '#6f5034';
      ctx.fillRect(Math.round(sx - u * 0.09), Math.round(sy - u * 0.5), Math.round(u * 0.18), Math.round(u * 0.15));
    } else if (p.k === 'crate') {
      // 木箱：顶面 + 正面 + 侧面。少任何一个面都是一张贴纸。
      var cw = u * 0.5, ch = u * 0.42, dep = u * 0.16;
      dropShadow(cw * 0.62, u * 0.13);
      ctx.fillStyle = '#8a6236';
      ctx.fillRect(sx - cw / 2, sy - ch - dep, cw, dep);                       // 顶
      ctx.fillStyle = '#a87c45';
      ctx.fillRect(sx - cw / 2, sy - ch - dep, cw, Math.max(1, u * 0.03));
      ctx.fillStyle = '#6d4b2a';
      ctx.fillRect(sx - cw / 2, sy - ch, cw, ch);                              // 正面
      ctx.fillStyle = 'rgba(0,0,0,0.22)';
      ctx.fillRect(sx - cw / 2, sy - ch, cw, Math.max(1, u * 0.025));
      // 木条
      ctx.fillStyle = '#8a6236';
      ctx.fillRect(sx - cw / 2, sy - ch * 0.62, cw, Math.max(1, u * 0.035));
      ctx.fillRect(sx - cw * 0.36, sy - ch, Math.max(1, u * 0.03), ch);
      ctx.fillRect(sx + cw * 0.32, sy - ch, Math.max(1, u * 0.03), ch);
      ctx.strokeStyle = 'rgba(30,20,12,0.75)';
      ctx.lineWidth = Math.max(1, S.zoom * 0.35);
      ctx.strokeRect(sx - cw / 2, sy - ch, cw, ch);
      ctx.beginPath();
      ctx.moveTo(sx - cw / 2, sy - ch - dep); ctx.lineTo(sx + cw / 2, sy - ch - dep);
      ctx.lineTo(sx + cw / 2, sy - ch);
      ctx.stroke();
    } else if (p.k === 'barrel') {
      var bw = u * 0.42, bh = u * 0.56;
      dropShadow(bw * 0.62, u * 0.12);
      ctx.fillStyle = '#6b4a2c';
      ctx.beginPath();
      ctx.ellipse(sx, sy - bh, bw / 2, u * 0.07, 0, 0, 6.2832);
      ctx.fill();
      ctx.fillStyle = '#8a5f38';
      ctx.fillRect(sx - bw / 2, sy - bh, bw, bh);
      ctx.fillStyle = '#a3743f';
      ctx.fillRect(sx - bw / 2, sy - bh, bw * 0.3, bh);
      ctx.fillStyle = '#4a4238';
      ctx.fillRect(sx - bw / 2, sy - bh * 0.78, bw, Math.max(2, u * 0.045));
      ctx.fillRect(sx - bw / 2, sy - bh * 0.3, bw, Math.max(2, u * 0.045));
      ctx.fillStyle = 'rgba(0,0,0,0.28)';
      ctx.fillRect(sx + bw * 0.28, sy - bh, bw * 0.22, bh);
      ctx.strokeStyle = 'rgba(30,20,12,0.7)';
      ctx.lineWidth = Math.max(1, S.zoom * 0.35);
      ctx.beginPath(); ctx.ellipse(sx, sy - bh, bw / 2, u * 0.07, 0, 0, 6.2832); ctx.stroke();
    } else if (p.k === 'sack') {
      var sw = u * 0.34, sh = u * 0.34;
      dropShadow(sw * 0.7, u * 0.1);
      ctx.fillStyle = '#c4b083';
      ctx.beginPath();
      ctx.moveTo(sx - sw * 0.5, sy);
      ctx.quadraticCurveTo(sx - sw * 0.62, sy - sh * 0.8, sx - sw * 0.16, sy - sh);
      ctx.lineTo(sx + sw * 0.16, sy - sh);
      ctx.quadraticCurveTo(sx + sw * 0.62, sy - sh * 0.8, sx + sw * 0.5, sy);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = 'rgba(255,250,230,0.22)';
      ctx.beginPath();
      ctx.moveTo(sx - sw * 0.42, sy - sh * 0.1);
      ctx.quadraticCurveTo(sx - sw * 0.5, sy - sh * 0.7, sx - sw * 0.14, sy - sh * 0.92);
      ctx.lineTo(sx - sw * 0.02, sy - sh * 0.92);
      ctx.lineTo(sx - sw * 0.1, sy - sh * 0.1);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#6f5a38';
      ctx.fillRect(sx - sw * 0.2, sy - sh - u * 0.03, sw * 0.4, u * 0.06);
      ctx.strokeStyle = 'rgba(40,28,16,0.6)';
      ctx.lineWidth = Math.max(1, S.zoom * 0.3);
      ctx.beginPath();
      ctx.moveTo(sx - sw * 0.5, sy); ctx.quadraticCurveTo(sx - sw * 0.62, sy - sh * 0.8, sx - sw * 0.16, sy - sh);
      ctx.stroke();
    } else if (p.k === 'bench') {
      var lw2 = u * 0.72, lh = u * 0.16;
      dropShadow(lw2 * 0.55, u * 0.1);
      // 腿
      ctx.fillStyle = '#4a3a28';
      ctx.fillRect(Math.round(sx - lw2 * 0.42), sy - lh, Math.max(2, u * 0.07), lh);
      ctx.fillRect(Math.round(sx + lw2 * 0.34), sy - lh, Math.max(2, u * 0.07), lh);
      // 坐面
      ctx.fillStyle = '#8a6340';
      ctx.fillRect(sx - lw2 / 2, sy - lh - u * 0.09, lw2, u * 0.09);
      ctx.fillStyle = '#a87c50';
      ctx.fillRect(sx - lw2 / 2, sy - lh - u * 0.09, lw2, Math.max(1, u * 0.03));
      // 靠背
      ctx.fillStyle = '#6b4d34';
      ctx.fillRect(sx - lw2 / 2, sy - lh - u * 0.4, lw2, u * 0.06);
      ctx.fillRect(sx - lw2 * 0.42, sy - lh - u * 0.4, Math.max(2, u * 0.05), u * 0.32);
      ctx.fillRect(sx + lw2 * 0.38, sy - lh - u * 0.4, Math.max(2, u * 0.05), u * 0.32);
      ctx.strokeStyle = 'rgba(30,20,12,0.55)';
      ctx.lineWidth = Math.max(1, S.zoom * 0.3);
      ctx.strokeRect(sx - lw2 / 2, sy - lh - u * 0.09, lw2, u * 0.09);
    } else if (p.k === 'board') {
      // 公告板：两根柱子 + 一块板 + 三张告示
      var bdW = u * 0.88, bdH = u * 0.6;
      dropShadow(bdW * 0.5, u * 0.1);
      ctx.fillStyle = '#5b4430';
      ctx.fillRect(Math.round(sx - bdW * 0.38), sy - u * 0.9, Math.max(2, u * 0.08), u * 0.9);
      ctx.fillRect(Math.round(sx + bdW * 0.32), sy - u * 0.9, Math.max(2, u * 0.08), u * 0.9);
      ctx.fillStyle = '#3a2c1c';
      ctx.fillRect(sx - bdW / 2 - u * 0.04, sy - u * 0.98 - u * 0.04, bdW + u * 0.08, bdH + u * 0.08);
      ctx.fillStyle = '#9a7a4e';
      ctx.fillRect(sx - bdW / 2, sy - u * 0.98, bdW, bdH);
      ctx.fillStyle = 'rgba(0,0,0,0.2)';
      for (var bp = 1; bp < 4; bp++) ctx.fillRect(sx - bdW / 2, sy - u * 0.98 + bdH * 0.25 * bp, bdW, Math.max(1, u * 0.02));
      // 告示纸
      var papers = [[-0.3, 0.14, 0.3, 0.3], [0.06, 0.1, 0.26, 0.36], [0.34, 0.2, 0.24, 0.24]];
      for (var pp = 0; pp < papers.length; pp++) {
        var q = papers[pp];
        ctx.fillStyle = pp === 1 ? '#f0e6c8' : '#ddd0ad';
        ctx.fillRect(sx - bdW / 2 + bdW * (0.5 + q[0]), sy - u * 0.98 + bdH * q[1], bdW * q[2], bdH * q[3]);
        ctx.fillStyle = 'rgba(60,44,26,0.55)';
        ctx.fillRect(sx - bdW / 2 + bdW * (0.5 + q[0]) + 2, sy - u * 0.98 + bdH * q[1] + 3, bdW * q[2] * 0.6, Math.max(1, u * 0.02));
      }
      ctx.strokeStyle = 'rgba(26,18,12,0.85)';
      ctx.strokeRect(sx - bdW / 2, sy - u * 0.98, bdW, bdH);
    } else if (p.k === 'pot') {
      var pw = u * 0.26, ph = u * 0.2;
      dropShadow(pw * 0.85, u * 0.08);
      ctx.fillStyle = '#9c5f45';
      ctx.beginPath();
      ctx.moveTo(sx - pw * 0.4, sy - ph);
      ctx.lineTo(sx + pw * 0.4, sy - ph);
      ctx.lineTo(sx + pw * 0.5, sy);
      ctx.lineTo(sx - pw * 0.5, sy);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = 'rgba(255,236,200,0.25)';
      ctx.fillRect(sx - pw * 0.34, sy - ph, pw * 0.24, ph);
      ctx.fillStyle = '#b06a4c';
      ctx.fillRect(sx - pw * 0.48, sy - ph - u * 0.04, pw * 0.96, u * 0.05);
      // 花
      var bloom2 = ['#e0645a', '#f0c86a', '#d879b0'];
      for (var pb = 0; pb < 3; pb++) {
        ctx.fillStyle = '#4f7a38';
        ctx.fillRect(Math.round(sx - pw * 0.3 + pw * 0.3 * pb), sy - ph - u * 0.16, Math.max(1, u * 0.03), u * 0.13);
        ctx.fillStyle = bloom2[pb];
        ctx.fillRect(Math.round(sx - pw * 0.34 + pw * 0.3 * pb), sy - ph - u * 0.2, Math.max(2, u * 0.07), Math.max(2, u * 0.07));
      }
    } else if (p.k === 'wood') {
      // 柴堆：几根横放的木头，端面画年轮
      dropShadow(u * 0.3, u * 0.1);
      for (var w2 = 0; w2 < 3; w2++) {
        for (var w3 = 0; w3 < 2; w3++) {
          var lx = sx - u * 0.34 + w2 * u * 0.045, ly = sy - u * 0.1 - w3 * u * 0.13 - w2 * 0.02;
          ctx.fillStyle = w2 % 2 ? '#7a5636' : '#8a6340';
          ctx.fillRect(Math.round(lx), Math.round(ly - u * 0.1), u * 0.5, u * 0.11);
          ctx.fillStyle = '#c9ab7c';
          ctx.beginPath();
          ctx.ellipse(lx + u * 0.5, ly - u * 0.045, u * 0.045, u * 0.055, 0, 0, 6.2832);
          ctx.fill();
          ctx.fillStyle = 'rgba(120,90,56,0.7)';
          ctx.beginPath();
          ctx.ellipse(lx + u * 0.5, ly - u * 0.045, u * 0.018, u * 0.022, 0, 0, 6.2832);
          ctx.fill();
        }
      }
    } else if (p.k === 'lamp') {
      // 灯柱：守夜人的路灯。白天是木杆 + 铁灯笼，夜里点亮（光源在 lightSources 里注册）
      var poleH = u * 1.7;
      dropShadow(u * 0.16, u * 0.06);
      ctx.fillStyle = '#4a3a28';
      ctx.fillRect(Math.round(sx - u * 0.05), Math.round(sy - poleH), Math.max(2, u * 0.09), Math.round(poleH));
      ctx.fillStyle = 'rgba(255,240,200,0.14)';
      ctx.fillRect(Math.round(sx - u * 0.05), Math.round(sy - poleH), Math.max(1, u * 0.03), Math.round(poleH));
      // 横挑
      ctx.fillStyle = '#4a3a28';
      ctx.fillRect(Math.round(sx - u * 0.05), Math.round(sy - poleH), Math.round(u * 0.26), Math.max(2, u * 0.06));
      // 灯笼
      var lgx = sx + u * 0.14, lgy = sy - poleH + u * 0.06;
      ctx.fillStyle = '#2a2118';
      ctx.fillRect(Math.round(lgx - u * 0.1), Math.round(lgy), Math.max(1, u * 0.03), u * 0.1);
      ctx.fillStyle = '#3a2c1e';
      ctx.fillRect(Math.round(lgx - u * 0.13), Math.round(lgy + u * 0.1), u * 0.24, u * 0.26);
      if (lit) {
        var fl = 0.8 + Math.sin(S.time * 5 + p.x) * 0.2;
        ctx.fillStyle = 'rgba(255,214,130,' + fl.toFixed(2) + ')';
        ctx.fillRect(Math.round(lgx - u * 0.08), Math.round(lgy + u * 0.13), u * 0.15, u * 0.19);
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        var g2 = ctx.createRadialGradient(lgx, lgy + u * 0.22, 0, lgx, lgy + u * 0.22, u * 1.9);
        g2.addColorStop(0, 'rgba(255,196,110,' + (0.20 * fl).toFixed(3) + ')');
        g2.addColorStop(1, 'rgba(255,196,110,0)');
        ctx.fillStyle = g2;
        ctx.fillRect(lgx - u * 1.9, lgy + u * 0.22 - u * 1.9, u * 3.8, u * 3.8);
        ctx.restore();
      } else {
        ctx.fillStyle = 'rgba(120,140,160,0.55)';
        ctx.fillRect(Math.round(lgx - u * 0.08), Math.round(lgy + u * 0.13), u * 0.15, u * 0.19);
      }
      ctx.fillStyle = '#2a2118';
      ctx.fillRect(Math.round(lgx - u * 0.15), Math.round(lgy + u * 0.08), u * 0.28, u * 0.05);
      ctx.fillRect(Math.round(lgx - u * 0.15), Math.round(lgy + u * 0.35), u * 0.28, u * 0.05);
    }
  }

  function drawTower(ctx, z, t) {
    var tw = S.map.towers[z];
    if (!tw) return;
    var lit = !!S.towers[z];
    var u = S.zoom * TILE;
    var sx = w2sX(tw.x * TILE + TILE * 0.5);
    var sy = w2sY(tw.y * TILE + TILE);
    var baseW = u * 2.0, topW = u * 1.3;
    var hgt = u * 4.4;
    var topY = sy - hgt;

    // 落影
    ctx.fillStyle = 'rgba(0,0,0,0.24)';
    ctx.beginPath();
    ctx.ellipse(sx, sy - u * 0.05, baseW * 0.56, u * 0.18, 0, 0, 6.2832);
    ctx.fill();

    // v5.8 守夜仪式：长夜之心塔下共守光环 —— 每多一位举灯人 +1 圈金环（封顶 8），
    // 在场玩家（含自己，3.5 格内）脚下补一盏「带来的灯」。
    if (z === 'abyss' && S.finale && S.finale.open && !S.finale.done) {
      var holders = [];
      var fkey;
      for (fkey in S.players) {
        var fp = S.players[fkey];
        if (fp && Math.abs(fp.x - tw.x) <= 3.5 && Math.abs(fp.y - tw.y) <= 3.5) holders.push(fp);
      }
      // S.players 已排除自己（applyPlayers 里 id === S.myId 直接 continue），所以自己单独判一次
      var meF = S.me;
      if (meF && Math.abs(meF.x - tw.x) <= 3.5 && Math.abs(meF.y - tw.y) <= 3.5) holders.push(meF);
      var rings = Math.min(8, Math.max(1, S.finale.waiters || 1));
      for (var ri = 0; ri < rings; ri++) {
        var rx = u * (1.3 + ri * 0.34);
        ctx.strokeStyle = '#ffd27a';
        ctx.lineWidth = 2;
        ctx.globalAlpha = Math.max(0.09, 0.30 - ri * 0.03) + Math.sin(S.time * 1.6 + ri * 0.9) * 0.04;
        ctx.beginPath();
        ctx.ellipse(sx, sy - u * 0.05, rx, rx * 0.38, 0, 0, 6.2832);
        ctx.stroke();
      }
      ctx.globalAlpha = 0.50;
      ctx.fillStyle = '#ffd27a';
      for (var hi = 0; hi < holders.length; hi++) {
        var hx = w2sX(holders[hi].x * TILE), hy = w2sY(holders[hi].y * TILE);
        ctx.fillRect(hx - u * 0.08, hy - u * 0.30, u * 0.16, u * 0.16);
      }
      ctx.globalAlpha = 1;
    }

    // 塔身（上窄下宽）
    ctx.beginPath();
    ctx.moveTo(sx - baseW / 2, sy);
    ctx.lineTo(sx - topW / 2, topY);
    ctx.lineTo(sx + topW / 2, topY);
    ctx.lineTo(sx + baseW / 2, sy);
    ctx.closePath();
    ctx.fillStyle = lit ? '#a9a08c' : '#5e5a6b';
    ctx.fill();

    // 明暗：左侧受光、右侧背光
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(sx - baseW / 2, sy);
    ctx.lineTo(sx - topW / 2, topY);
    ctx.lineTo(sx - topW * 0.1, topY);
    ctx.lineTo(sx - baseW * 0.1, sy);
    ctx.closePath();
    ctx.fillStyle = lit ? 'rgba(255,244,214,0.30)' : 'rgba(140,140,170,0.18)';
    ctx.fill();
    ctx.restore();
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(sx + baseW / 2, sy);
    ctx.lineTo(sx + topW / 2, topY);
    ctx.lineTo(sx + topW * 0.12, topY);
    ctx.lineTo(sx + baseW * 0.12, sy);
    ctx.closePath();
    ctx.fillStyle = 'rgba(0,0,0,0.30)';
    ctx.fill();
    ctx.restore();

    // 砖缝
    ctx.strokeStyle = lit ? 'rgba(90,80,64,0.34)' : 'rgba(20,18,30,0.42)';
    ctx.lineWidth = Math.max(1, S.zoom * 0.3);
    for (var i = 1; i < 9; i++) {
      var yy = topY + (hgt / 9) * i;
      var ww = baseW + (topW - baseW) * (1 - (yy - topY) / hgt);
      ctx.beginPath();
      ctx.moveTo(sx - ww / 2, yy);
      ctx.lineTo(sx + ww / 2, yy);
      ctx.stroke();
    }

    // 三扇窄窗
    var wins = [0.34, 0.56, 0.76];
    for (var k = 0; k < wins.length; k++) {
      var wy = topY + hgt * wins[k];
      var ww2 = baseW + (topW - baseW) * (1 - wins[k]);
      var wx = sx - ww2 * 0.08;
      ctx.fillStyle = lit ? 'rgba(255,214,130,0.95)' : 'rgba(16,14,26,0.9)';
      ctx.fillRect(Math.round(wx), Math.round(wy), Math.max(2, u * 0.16), Math.max(3, u * 0.34));
      if (lit) {
        ctx.fillStyle = 'rgba(255,206,120,0.18)';
        ctx.fillRect(Math.round(wx - u * 0.1), Math.round(wy - u * 0.06), Math.max(3, u * 0.36), Math.max(4, u * 0.46));
      }
    }

    // 塔基拱门
    ctx.fillStyle = lit ? 'rgba(46,36,26,0.85)' : 'rgba(12,10,20,0.9)';
    ctx.beginPath();
    ctx.moveTo(sx - u * 0.28, sy);
    ctx.lineTo(sx - u * 0.28, sy - u * 0.5);
    ctx.quadraticCurveTo(sx, sy - u * 0.82, sx + u * 0.28, sy - u * 0.5);
    ctx.lineTo(sx + u * 0.28, sy);
    ctx.closePath();
    ctx.fill();

    // 顶冠 + 灯室
    ctx.fillStyle = lit ? '#c8bfa6' : '#4a4658';
    ctx.fillRect(sx - topW * 0.72, topY - u * 0.52, topW * 1.44, u * 0.52);
    ctx.fillStyle = lit ? '#e6dcbc' : '#585467';
    ctx.fillRect(sx - topW * 0.72, topY - u * 0.52, topW * 1.44, u * 0.12);
    var flick = lit ? (0.78 + Math.sin(t * 3.1) * 0.22) : 0;
    if (lit) {
      ctx.fillStyle = 'rgba(255,226,150,' + (0.95 * flick).toFixed(2) + ')';
      ctx.fillRect(sx - topW * 0.42, topY - u * 0.46, topW * 0.84, u * 0.34);
      var g = ctx.createLinearGradient(sx, topY - u * 0.6, sx, topY - u * 9);
      g.addColorStop(0, 'rgba(255,224,150,' + (0.32 * flick).toFixed(2) + ')');
      g.addColorStop(1, 'rgba(255,224,150,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(sx - topW * 0.4, topY - u * 0.56);
      ctx.lineTo(sx + topW * 0.4, topY - u * 0.56);
      ctx.lineTo(sx + u * 2.4, topY - u * 9);
      ctx.lineTo(sx - u * 2.4, topY - u * 9);
      ctx.closePath();
      ctx.fill();
    } else {
      // 未点亮：灯室里翻涌的长夜
      ctx.fillStyle = 'rgba(58,34,86,0.95)';
      ctx.fillRect(sx - topW * 0.42, topY - u * 0.46, topW * 0.84, u * 0.34);
      for (var m2 = 0; m2 < 4; m2++) {
        var wy2 = topY - u * (0.5 + m2 * 0.34) + Math.sin(t * 1.6 + m2) * u * 0.1;
        ctx.fillStyle = 'rgba(120,86,190,' + (0.30 - m2 * 0.06).toFixed(2) + ')';
        ctx.fillRect(sx - u * (0.2 - m2 * 0.04), wy2, u * (0.4 + m2 * 0.08), u * 0.14);
      }
    }
  }

  function drawWaystone(ctx, w, t) {
    var u = S.zoom * TILE;
    var sx = w2sX(w.x * TILE + TILE * 0.5);
    var sy = w2sY(w.y * TILE + TILE);
    var on = (S.waystones || []).indexOf(w.id) >= 0;
    var pulse = 0.6 + Math.sin(t * 2.4) * 0.3;

    // 落影
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    ctx.beginPath();
    ctx.ellipse(sx, sy - u * 0.05, u * 0.5, u * 0.16, 0, 0, 6.2832);
    ctx.fill();

    // 基座（两块叠石，上窄下宽）
    ctx.fillStyle = on ? '#5c6478' : '#4a4a52';
    ctx.fillRect(sx - u * 0.42, sy - u * 0.22, u * 0.84, u * 0.22);
    ctx.fillStyle = on ? '#6f7890' : '#5a5a63';
    ctx.fillRect(sx - u * 0.34, sy - u * 0.86, u * 0.68, u * 0.66);
    // 受光边 / 暗边
    ctx.fillStyle = on ? '#8d97ad' : '#6e6e78';
    ctx.fillRect(sx - u * 0.34, sy - u * 0.86, u * 0.14, u * 0.66);
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.fillRect(sx + u * 0.22, sy - u * 0.86, u * 0.12, u * 0.66);
    // 顶部斜面
    ctx.fillStyle = on ? '#7d879d' : '#63636d';
    ctx.beginPath();
    ctx.moveTo(sx - u * 0.34, sy - u * 0.86);
    ctx.lineTo(sx, sy - u * 1.04);
    ctx.lineTo(sx + u * 0.34, sy - u * 0.86);
    ctx.closePath();
    ctx.fill();

    // 符文：竖菱形，激活后发青光
    var rx = sx, ry = sy - u * 0.52;
    ctx.fillStyle = on ? 'rgba(150,225,255,' + pulse.toFixed(2) + ')' : 'rgba(96,104,124,0.8)';
    ctx.beginPath();
    ctx.moveTo(rx, ry - u * 0.2);
    ctx.lineTo(rx + u * 0.12, ry);
    ctx.lineTo(rx, ry + u * 0.2);
    ctx.lineTo(rx - u * 0.12, ry);
    ctx.closePath();
    ctx.fill();
    if (on) {
      ctx.strokeStyle = 'rgba(170,235,255,' + (pulse * 0.5).toFixed(2) + ')';
      ctx.lineWidth = Math.max(1, S.zoom * 0.4);
      ctx.beginPath();
      ctx.arc(rx, ry, u * 0.34, 0, 6.2832);
      ctx.stroke();
      ctx.fillStyle = 'rgba(150,225,255,0.10)';
      ctx.beginPath();
      ctx.arc(rx, ry, u * 0.55, 0, 6.2832);
      ctx.fill();
    }
    // 苔藓
    ctx.fillStyle = 'rgba(78,110,60,0.55)';
    ctx.fillRect(sx - u * 0.3, sy - u * 0.16, u * 0.2, u * 0.1);
    ctx.fillRect(sx + u * 0.1, sy - u * 0.3, u * 0.12, u * 0.1);
  }

  function drawChest(ctx, c, t) {
    if (S.chests[c.id]) return;
    var u = S.zoom * TILE;   // 一格在屏幕上的像素数
    var sx = w2sX(c.x * TILE + TILE * 0.5);
    var sy = w2sY(c.y * TILE + TILE * 0.85);
    var col = c.tier === 2 ? '#ffcf6a' : (c.tier === 1 ? '#8fd3ff' : '#c8a878');
    ctx.fillStyle = '#6b4a2e';
    ctx.fillRect(sx - u * 0.4, sy - u * 0.45, u * 0.8, u * 0.45);
    ctx.fillStyle = col;
    ctx.fillRect(sx - u * 0.4, sy - u * 0.62, u * 0.8, u * 0.2);
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.fillRect(sx - u * 0.06, sy - u * 0.55, u * 0.12, u * 0.18);
    // 微光：告诉玩家这里有东西
    var gl = 0.25 + 0.2 * Math.sin(t * 2 + c.x);
    ctx.fillStyle = hexA(col, gl * 0.5);
    ctx.fillRect(sx - u * 0.62, sy - u * 0.82, u * 1.24, u * 1.1);
  }

  function drawCamp(ctx, x, y, t, big) {
    var u = S.zoom * TILE;
    var sx = w2sX(x * TILE + TILE * 0.5);
    var sy = w2sY(y * TILE + TILE * 0.9);
    var f = big ? 1.15 : 0.8;

    // 石圈
    ctx.fillStyle = '#6b635a';
    for (var i = 0; i < 7; i++) {
      var a = (i / 7) * 6.2832;
      var px2 = sx + Math.cos(a) * u * 0.34 * f;
      var py2 = sy + Math.sin(a) * u * 0.13 * f;
      ctx.fillRect(Math.round(px2 - u * 0.05 * f), Math.round(py2 - u * 0.03 * f), Math.max(2, u * 0.1 * f), Math.max(2, u * 0.06 * f));
    }
    // 柴
    ctx.fillStyle = '#5a4130';
    ctx.fillRect(sx - u * 0.22 * f, sy - u * 0.06 * f, u * 0.44 * f, u * 0.06 * f);
    ctx.fillRect(sx - u * 0.16 * f, sy - u * 0.12 * f, u * 0.32 * f, u * 0.06 * f);

    // 火焰：三层，越里越亮，抖动相位不同
    var flick = Math.sin(t * 7.3) * 0.5 + Math.sin(t * 11.7) * 0.5;
    var h = u * (0.46 + flick * 0.05) * f;
    var w = u * 0.26 * f;
    ctx.fillStyle = 'rgba(226,96,40,0.95)';
    ctx.beginPath();
    ctx.moveTo(sx - w, sy - u * 0.08 * f);
    ctx.quadraticCurveTo(sx - w * 0.6, sy - h * 0.55, sx, sy - h);
    ctx.quadraticCurveTo(sx + w * 0.6, sy - h * 0.55, sx + w, sy - u * 0.08 * f);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = 'rgba(255,170,70,0.95)';
    ctx.beginPath();
    ctx.moveTo(sx - w * 0.6, sy - u * 0.08 * f);
    ctx.quadraticCurveTo(sx - w * 0.3, sy - h * 0.5, sx, sy - h * 0.72);
    ctx.quadraticCurveTo(sx + w * 0.3, sy - h * 0.5, sx + w * 0.6, sy - u * 0.08 * f);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = 'rgba(255,240,190,0.95)';
    ctx.beginPath();
    ctx.ellipse(sx, sy - u * 0.16 * f, w * 0.34, h * 0.28, 0, 0, 6.2832);
    ctx.fill();

    // 火星
    for (var k = 0; k < 3; k++) {
      var ph = (t * 0.8 + k * 0.37) % 1;
      ctx.fillStyle = 'rgba(255,200,120,' + (0.9 * (1 - ph)).toFixed(2) + ')';
      ctx.fillRect(Math.round(sx + Math.sin((t + k * 2.1) * 2.4) * u * 0.16), Math.round(sy - u * 0.4 - ph * u * 0.7), Math.max(1, u * 0.04), Math.max(1, u * 0.04));
    }

    // 光晕（夜里明显，白天弱）
    var n = darkness();
    var g = ctx.createRadialGradient(sx, sy - u * 0.3, 0, sx, sy - u * 0.3, u * 2.6 * f);
    g.addColorStop(0, 'rgba(255,186,96,' + (0.14 + 0.16 * n).toFixed(3) + ')');
    g.addColorStop(1, 'rgba(255,186,96,0)');
    ctx.fillStyle = g;
    ctx.fillRect(sx - u * 2.6 * f, sy - u * 2.9 * f, u * 5.2 * f, u * 5.2 * f);
  }

  // 夜里的暗度：白天 0，黄昏渐起，深夜最黑
  function darkness() {
    var p = S.pf;
    if (S.phase === 'day') return 0;
    if (S.phase === 'dusk') return 0.32 * clamp((p - 0.62) / 0.08, 0, 1);
    if (S.phase === 'night') return 0.32 + 0.52 * clamp((p - 0.70) / 0.10, 0, 1);
    return Math.max(0, 0.84 * (1 - (p - 0.95) / 0.05));
  }

  function lightSources() {
    var L = [];
    var me = S.me;
    if (me) {
      var r = 4.6;
      if (S.stats && S.stats.talents && S.stats.talents.nightSight) r *= 1.5;
      L.push({ x: me.x * TILE, y: me.y * TILE, r: r * TILE, warm: 1, flick: 1 });
    }
    var tw = S.map.town;
    L.push({ x: tw.lamp.x * TILE, y: tw.lamp.y * TILE, r: 13 * TILE, warm: 1 });
    L.push({ x: tw.cx * TILE, y: tw.cy * TILE, r: 17 * TILE, warm: 0.6 });
    for (var z in S.towers) {
      if (!S.towers[z]) continue;
      var t = S.map.towers[z];
      if (t) L.push({ x: t.x * TILE, y: t.y * TILE, r: 12 * TILE, warm: 1 });
    }
    // 广场灯柱：夜里是一圈真的光，不是贴上去的亮点
    var tps = townProps();
    for (var ti = 0; ti < tps.length; ti++) {
      if (tps[ti].k === 'lamp') L.push({ x: tps[ti].x * TILE, y: (tps[ti].y - 1.5) * TILE, r: 5.2 * TILE, warm: 1 });
    }
    // 每栋房子的门灯：夜里门口一小片暖光。房子因此「有一盏自己的灯」，
    // 而不是被夜色整体糊掉的一块色块。
    var hs = (S.map.town && S.map.town.houses) || [];
    for (var hi = 0; hi < hs.length; hi++) {
      var hh2 = hs[hi];
      L.push({ x: (hh2.x + hh2.w * 0.32) * TILE, y: (hh2.y + hh2.h) * TILE, r: 4.4 * TILE, warm: 1 });
    }
    for (var i = 0; i < S.lamps.length; i++) {
      var lp = S.lamps[i];
      if (lp.until && lp.until < S.time) continue;
      L.push({ x: lp.x * TILE, y: lp.y * TILE, r: 4.5 * TILE, warm: 1 });
    }
    return L;
  }
  S.lamps = [];

  function drawNight(ctx, w, h) {
    var a = darkness();
    if (a < 0.015) return;
    // ⚠️ 夜色必须在**离屏画布**上挖洞再整体贴上来。
    // 直接在主画布 destination-out 会把地形一起擦掉 —— 洞是真的「透明」，
    // 底下露出页面黑底，看起来像主角身上盖了一口锅。
    if (!S.nightCv) {
      S.nightCv = document.createElement('canvas');
      S.nightCtx = S.nightCv.getContext('2d');
    }
    if (S.nightCv.width !== Math.round(w) || S.nightCv.height !== Math.round(h)) {
      S.nightCv.width = Math.round(w);
      S.nightCv.height = Math.round(h);
    }
    var g0 = S.nightCtx;
    g0.setTransform(1, 0, 0, 1, 0, 0);
    g0.globalCompositeOperation = 'source-over';
    g0.clearRect(0, 0, w, h);
    g0.fillStyle = 'rgba(9,13,32,' + a.toFixed(3) + ')';
    g0.fillRect(0, 0, w, h);

    var L = lightSources();
    g0.globalCompositeOperation = 'destination-out';
    for (var i = 0; i < L.length; i++) {
      var l = L[i];
      var sx = w2sX(l.x), sy = w2sY(l.y);
      var rr = l.r * S.zoom;
      if (sx + rr < 0 || sy + rr < 0 || sx - rr > w || sy - rr > h) continue;
      var g = g0.createRadialGradient(sx, sy, rr * 0.1, sx, sy, rr);
      // 中心只挖到 0.72：留一点夜色，雪地上才不会「爆白」
      g.addColorStop(0, 'rgba(0,0,0,0.72)');
      g.addColorStop(0.40, 'rgba(0,0,0,0.62)');
      g.addColorStop(0.66, 'rgba(0,0,0,0.42)');
      g.addColorStop(0.86, 'rgba(0,0,0,0.18)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      g0.fillStyle = g;
      g0.beginPath();
      g0.arc(sx, sy, rr, 0, 6.2832);
      g0.fill();
    }
    g0.globalCompositeOperation = 'source-over';
    ctx.drawImage(S.nightCv, 0, 0);

    // 暖光回补：光洞里再叠一层暖色，火才像火
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (var k = 0; k < L.length; k++) {
      var q = L[k];
      if (q.warm <= 0) continue;
      var qx = w2sX(q.x), qy = w2sY(q.y), qr = q.r * S.zoom * 0.8;
      if (qx + qr < 0 || qy + qr < 0 || qx - qr > w || qy - qr > h) continue;
      var g2 = ctx.createRadialGradient(qx, qy, qr * 0.1, qx, qy, qr);
      g2.addColorStop(0, 'rgba(255,170,90,' + (0.07 * a * q.warm).toFixed(3) + ')');
      g2.addColorStop(0.6, 'rgba(255,140,60,' + (0.03 * a * q.warm).toFixed(3) + ')');
      g2.addColorStop(1, 'rgba(255,150,70,0)');
      ctx.fillStyle = g2;
      ctx.fillRect(qx - qr, qy - qr, qr * 2, qr * 2);
    }
    ctx.restore();
  }

  // ---------------- §8 小地图 / 大地图 ----------------
  // 一张 256×256 的底图（一格一像素），加一层「未探索遮罩」。遮罩只增量地挖洞，
  // 所以每帧只是两次 drawImage。
  var MINI = { base: null, mask: null, baseG: null, maskG: null, size: 0 };

  function buildMiniMap() {
    var m = S.map;
    var size = m.size;
    var cv = document.createElement('canvas');
    cv.width = size; cv.height = size;
    var g = cv.getContext('2d');
    var img = g.createImageData(size, size);
    for (var y = 0; y < size; y++) {
      for (var x = 0; x < size; x++) {
        var t = m.cells[y * size + x];
        var c = miniColor(t);
        var o = (y * size + x) * 4;
        img.data[o] = c[0]; img.data[o + 1] = c[1]; img.data[o + 2] = c[2]; img.data[o + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    MINI.base = cv;
    MINI.baseG = g;
    MINI.size = size;
    // 遮罩：全黑，探索后用 destination-out 挖洞
    var mk = document.createElement('canvas');
    mk.width = size; mk.height = size;
    var mg = mk.getContext('2d');
    mg.fillStyle = '#070a14';
    mg.fillRect(0, 0, size, size);
    MINI.mask = mk;
    MINI.maskG = mg;
    // 已探索位图（从 localStorage 恢复）
    S.visited = new Uint8Array(size * size);
    var saved = null;
    try { saved = S.storage.get('visit5', null); } catch (e) { saved = null; }
    if (saved && saved.length) {
      var bin = atob(saved);
      for (var i = 0; i < S.visited.length && i < bin.length; i++) S.visited[i] = bin.charCodeAt(i);
      // 让遮罩与位图一致（恢复时一次性重挖）
      mg.save();
      mg.globalCompositeOperation = 'destination-out';
      for (var yy = 0; yy < size; yy++) {
        for (var xx = 0; xx < size; xx++) {
          if (S.visited[yy * size + xx]) mg.fillRect(xx, yy, 1, 1);
        }
      }
      mg.restore();
    }
  }

  function miniColor(t) {
    switch (t) {
      case T.WATER: return [34, 62, 96];
      case T.SHALLOW: return [56, 96, 128];
      case T.SAND: return [176, 160, 116];
      case T.GRASS: case T.FLOWER: return [72, 108, 60];
      case T.DIRT: return [124, 96, 66];
      case T.STONE: return [116, 110, 100];
      case T.SNOW: return [214, 226, 236];
      case T.SWAMP: return [66, 76, 48];
      case T.TREE: return [44, 74, 44];
      case T.PINE: return [38, 66, 60];
      case T.DEADTREE: return [58, 50, 40];
      case T.ROCK: return [88, 84, 76];
      case T.WALL: return [96, 84, 70];
      case T.FLOOR: return [168, 148, 116];
      case T.BRIDGE: return [136, 100, 62];
      case T.DARK: return [44, 38, 62];
      case T.ICE: return [150, 190, 208];
      case T.CLIFF: return [60, 54, 48];
      default: return [72, 108, 60];
    }
  }

  function reveal(tx, ty, r) {
    var size = S.map.size;
    var maskG = MINI.maskG, vis = S.visited;
    maskG.save();
    maskG.globalCompositeOperation = 'destination-out';
    for (var y = ty - r; y <= ty + r; y++) {
      if (y < 0 || y >= size) continue;
      for (var x = tx - r; x <= tx + r; x++) {
        if (x < 0 || x >= size) continue;
        var dx = x - tx, dy = y - ty;
        if (dx * dx + dy * dy > r * r) continue;
        var i = y * size + x;
        if (vis[i]) continue;
        vis[i] = 1;
        maskG.fillRect(x, y, 1, 1);
        S.visitDirty = true;
      }
    }
    maskG.restore();
  }

  function saveVisited() {
    if (!S.visitDirty || !S.visited) return;
    S.visitDirty = false;
    try {
      var chunks2 = [];
      var s = '';
      for (var i = 0; i < S.visited.length; i += 4096) {
        s += String.fromCharCode.apply(null, S.visited.subarray(i, i + 4096));
      }
      S.storage.set('visit5', btoa(s));
    } catch (e) {}
  }

  // 小地图：以我为中心裁一块，缩放画进 HUD
  function drawMiniMap(ctx, px, py, size, radius) {
    if (!MINI.base) return;
    var me = S.me;
    var m = S.map;
    var scale = size / (radius * 2);
    var sx = me.x - radius, sy = me.y - radius;
    ctx.save();
    ctx.beginPath();
    ctx.arc(px + size / 2, py + size / 2, size / 2, 0, 6.2832);
    ctx.clip();
    ctx.fillStyle = '#0a0f1c';
    ctx.fillRect(px, py, size, size);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(MINI.base, sx, sy, radius * 2, radius * 2, px, py, size, size);
    ctx.drawImage(MINI.mask, sx, sy, radius * 2, radius * 2, px, py, size, size);
    // 灯塔
    for (var z in m.towers) {
      var t = m.towers[z];
      var tx = px + (t.x - sx) * scale, ty = py + (t.y - sy) * scale;
      if (tx < px || ty < py || tx > px + size || ty > py + size) continue;
      ctx.fillStyle = S.towers[z] ? '#ffd98a' : 'rgba(150,150,170,0.85)';
      ctx.fillRect(tx - 1.5, ty - 1.5, 3, 3);
    }
    // 队友
    for (var id in S.players) {
      var p = S.players[id];
      var qx = px + (p.x - sx) * scale, qy = py + (p.y - sy) * scale;
      if (qx < px || qy < py || qx > px + size || qy > py + size) continue;
      ctx.fillStyle = '#8fd3ff';
      ctx.fillRect(qx - 1, qy - 1, 2, 2);
    }
    // 我：带朝向的小三角
    var mx = px + (me.x - sx) * scale, my = py + (me.y - sy) * scale;
    ctx.fillStyle = '#fff2c0';
    ctx.beginPath();
    ctx.arc(mx, my, 2.4, 0, 6.2832);
    ctx.fill();
    ctx.restore();
    // 外框
    ctx.strokeStyle = 'rgba(255,255,255,0.22)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(px + size / 2, py + size / 2, size / 2 - 0.5, 0, 6.2832);
    ctx.stroke();
  }


  // ======================== 05_player.js ========================
  // ---------------- §9 输入 ----------------
  // 键盘给桌面，虚拟摇杆给平板。摇杆只做「模拟量方向」，不做力度（8 向位移已经够了）。
  var IN = {
    x: 0, y: 0,          // 归一化方向
    kx: 0, ky: 0,        // 键盘方向
    jx: 0, jy: 0,        // 摇杆方向
    attack: 0, roll: 0, skill: 0, use: 0,
    joyId: -1, joyOX: 0, joyOY: 0, joyActive: false
  };

  function inputBind(root, onDestroy) {
    var keys = {};
    IN.keysRef = keys;
    function isTyping(e) {
      var t = (e && e.target) || document.activeElement;
      if (!t) return false;
      var tag = t.tagName;
      return tag === 'INPUT' || tag === 'TEXTAREA' || !!t.isContentEditable;
    }
    function setKey(e, down) {
      var k = e.key || '';
      var code = e.keyCode || 0;
      var map = {
        65: 'a', 68: 'd', 87: 'w', 83: 's', 37: 'a', 39: 'd', 38: 'w', 40: 's',
        74: 'j', 75: 'k', 76: 'l', 69: 'e', 32: 'j'
      };
      var name = map[code];
      if (!name) return;
      // 聊天输入框 / 任何可编辑区域里，WASD 与空格归输入法，不驱动角色。
      // 抬起必须照常清键，否则「按住 W 时点进输入框再松开」会让角色一直往右跑。
      if (isTyping(e)) {
        if (!down) keys[name] = 0;
        return;
      }
      // v5.3：钓鱼 QTE 期间空格归绿条用，不置 IN.attack、也不 preventDefault
      if (code === 32 && S.farm && S.farm.qte) return;
      if (down && keys[name]) return;
      keys[name] = down ? 1 : 0;
      if (down) {
        if (name === 'j') IN.attack = 1;
        if (name === 'k') IN.roll = 1;
        if (name === 'l') IN.skill = 1;
        if (name === 'e') IN.use = 1;
        auResume();
      }
      if (['a', 'd', 'w', 's'].indexOf(name) >= 0 || name === 'j') e.preventDefault();
    }
    var kd = function (e) { setKey(e, 1); };
    var ku = function (e) { setKey(e, 0); };
    document.addEventListener('keydown', kd, false);
    document.addEventListener('keyup', ku, false);
    onDestroy(function () {
      document.removeEventListener('keydown', kd, false);
      document.removeEventListener('keyup', ku, false);
    });

    // 摇杆（左半屏）
    var joyBase = null;
    // 触点在 HUD 控件上时不要起摇杆：否则点 dock / 面板按钮也会把角色拖走
    function touchOnUi(target) {
      var t = target;
      while (t && t !== root) {
        var c = t.className;
        if (typeof c === 'string' && /(^|\s)(sg5-dock|sg5-panel|sg5-panels|sg5-farmbar|sg5-invite|sg5-actions|sg5-dead|sg5-pmenu|sg5-actpicker|sg5-qte)(\s|$)/.test(c)) return true;
        if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'BUTTON') return true;
        t = t.parentNode;
      }
      return false;
    }
    function touchStart(e) {
      if (curPanel || (S.me && (S.me.down || S.me.dead))) { auResume(); return; }
      for (var i = 0; i < e.changedTouches.length; i++) {
        var t = e.changedTouches[i];
        if (t.clientX < S.view.w * 0.5 && !IN.joyActive && !touchOnUi(e.target)) {
          IN.joyActive = true;
          IN.joyId = t.identifier;
          IN.joyOX = t.clientX;
          IN.joyOY = t.clientY;
          showJoy(IN.joyOX, IN.joyOY);
        }
      }
      auResume();
    }
    function touchMove(e) {
      for (var i = 0; i < e.changedTouches.length; i++) {
        var t = e.changedTouches[i];
        if (t.identifier !== IN.joyId) continue;
        var dx = t.clientX - IN.joyOX, dy = t.clientY - IN.joyOY;
        var d = Math.sqrt(dx * dx + dy * dy);
        var R = 54;
        if (d > R) { dx = dx / d * R; dy = dy / d * R; d = R; }
        IN.jx = d > 6 ? dx / R : 0;
        IN.jy = d > 6 ? dy / R : 0;
        moveJoy(dx, dy);
        e.preventDefault();
      }
    }
    function touchEnd(e) {
      for (var i = 0; i < e.changedTouches.length; i++) {
        if (e.changedTouches[i].identifier === IN.joyId) {
          IN.joyId = -1; IN.joyActive = false;
          IN.jx = 0; IN.jy = 0;
          hideJoy();
        }
      }
    }
    var ts = function (e) { touchStart(e); };
    var tm = function (e) { touchMove(e); };
    var te = function (e) { touchEnd(e); };
    root.addEventListener('touchstart', ts, { passive: false });
    root.addEventListener('touchmove', tm, { passive: false });
    root.addEventListener('touchend', te, false);
    root.addEventListener('touchcancel', te, false);
    onDestroy(function () {
      root.removeEventListener('touchstart', ts);
      root.removeEventListener('touchmove', tm);
      root.removeEventListener('touchend', te);
      root.removeEventListener('touchcancel', te);
    });

    var joyEl = null, knobEl = null;
    function showJoy(x, y) {
      if (!joyEl) return;
      joyEl.style.display = 'block';
      joyEl.style.left = (x - 54) + 'px';
      joyEl.style.top = (y - 54) + 'px';
      moveJoy(0, 0);
    }
    function moveJoy(dx, dy) {
      if (!knobEl) return;
      knobEl.style.transform = 'translate(' + dx + 'px,' + dy + 'px)';
    }
    function hideJoy() {
      if (joyEl) joyEl.style.display = 'none';
    }
    return {
      attachJoy: function (el, knob) { joyEl = el; knobEl = knob; },
      keys: keys
    };
  }

  function readInput() {
    var k = IN.keysRef || {};
    var kx = 0, ky = 0;
    if (k.a) kx -= 1;
    if (k.d) kx += 1;
    if (k.w) ky -= 1;
    if (k.s) ky += 1;
    var x = kx + IN.jx, y = ky + IN.jy;
    if (x && y) { x *= 0.7071; y *= 0.7071; }
    var d = Math.sqrt(x * x + y * y);
    if (d > 1) { x /= d; y /= d; }
    IN.x = x; IN.y = y;
  }

  // ---------------- §10 玩家 ----------------
  // 客户端负责「手感」：加速度、翻滚、攻击前摇/后摇、命中判定、顿帧、震屏。
  // 服务端负责「真相」：位置上限、伤害上限、生命、掉落、进度。
  // 两者不冲突的关键是：客户端算出来的结果必须能被服务端复核（见 routes /v5/hit）。
  function makeMe(me) {
    me.vx = 0; me.vy = 0;
    me.face = 1;             // 0=下 1=上 2=左 3=右
    me.dirX = 0; me.dirY = 1;
    me.act = null;           // { type, t, dur, hit, combo }
    me.rollUntil = 0;
    me.invUntil = 0;
    me.comboIdx = 0;
    me.comboAt = 0;
    me.skillCd = 0;
    // 冷却时间戳必须初始化为 0：`t > undefined` 恒 false，会让攻击/翻滚从此静默失效
    me.atkCdUntil = 0;
    me.rollCdUntil = 0;
    me.skillCdUntil = 0;
    me.hurtAt = 0;
    me.dead = 0;
    me.moving = 0;
    me.animT = 0;
    me.mp = me.mp || 40;
    me.maxMp = me.maxMp || 40;
    me.critReady = 0;
    me.attackBuffered = 0;
    S.me = me;
    return me;
  }

  function playerFacing(dx, dy) {
    if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? 3 : 2;
    return dy > 0 ? 0 : 1;
  }

  function canAct(me, t) {
    if (!me.act) return true;
    if (me.act.type === 'roll') return t > me.act.t + me.act.dur;
    return false;
  }

  function updatePlayer(dt, t) {
    var me = S.me;
    if (!me) return;
    // 倒下/死亡时锁住输入：死亡遮罩已经弹出，角色不该还在底下走动或挥剑
    if (me.dead || me.down) {
      IN.x = 0; IN.y = 0;
      IN.attack = 0; IN.roll = 0; IN.skill = 0; IN.use = 0;
      me.vx = 0; me.vy = 0; me.moving = 0;
      return;
    }
    readInput();

    // 计时器
    me.animT += dt;
    if (me.act) {
      me.act.t += dt * 1000;
      if (me.act.t >= me.act.dur) me.act = null;
    }

    var moving = Math.abs(IN.x) > 0.08 || Math.abs(IN.y) > 0.08;
    var speedMul = 1 + ((S.stats && S.stats.speed) || 0) / 100;

    // ---- 翻滚 ----
    if (IN.roll && !me.act && t > me.rollCdUntil) {
      IN.roll = 0;
      var dx = IN.x, dy = IN.y;
      if (!moving) { dx = [0, 0, -1, 1][me.face]; dy = [1, -1, 0, 0][me.face]; }
      var d = Math.sqrt(dx * dx + dy * dy) || 1;
      me.act = { type: 'roll', t: 0, dur: ROLL_MS, dx: dx / d, dy: dy / d };
      me.invUntil = t + ROLL_INV_MS / 1000;
      me.rollStartedAt = t;
      me.rollCdUntil = t + (ROLL_CD * (1 - ((S.stats && S.stats.dodgeCd) || 0) / 100)) / 1000;
      S.net.roll = { at: t, rt: 0 };
      auSfx('jump', 0.28, 1.25);
      burst(me.x, me.y, 6, '#cfd8ff', 3.2);
    }

    // ---- 攻击 ----
    if (IN.attack && !me.act && t > me.atkCdUntil) {
      IN.attack = 0;
      startAttack(me, t);
    }

    // ---- 技能 ----
    if (IN.skill) {
      IN.skill = 0;
      castSkill(me, t);
    }

    // ---- 交互 ----
    if (IN.use) {
      IN.use = 0;
      doInteract(t);
    }

    // ---- 位移 ----
    if (me.act && me.act.type === 'roll') {
      var k = 1 - me.act.t / me.act.dur;
      var sp = ROLL_SPEED * (0.35 + 0.65 * k);
      stepMove(me, me.act.dx * sp * dt, me.act.dy * sp * dt);
      me.face = playerFacing(me.act.dx, me.act.dy);
    } else if (me.act && me.act.type === 'attack') {
      // 攻击时轻微前冲：第三段冲得远一点
      var lunge = me.act.combo === 2 ? 2.4 : 1.1;
      var p = me.act.t / me.act.dur;
      if (p < 0.45) stepMove(me, me.act.dx * lunge * dt, me.act.dy * lunge * dt);
      me.vx *= 0.8; me.vy *= 0.8;
    } else if (moving) {
      me.vx += (IN.x * SPEED * speedMul - me.vx) * Math.min(1, ACCEL * dt);
      me.vy += (IN.y * SPEED * speedMul - me.vy) * Math.min(1, ACCEL * dt);
      stepMove(me, me.vx * dt, me.vy * dt);
      me.face = playerFacing(IN.x, IN.y);
      me.dirX = IN.x; me.dirY = IN.y;
    } else {
      me.vx *= Math.max(0, 1 - FRICTION * dt);
      me.vy *= Math.max(0, 1 - FRICTION * dt);
      if (Math.abs(me.vx) > 0.02 || Math.abs(me.vy) > 0.02) stepMove(me, me.vx * dt, me.vy * dt);
    }
    me.moving = moving ? 1 : 0;

    // 揭图
    var tx = Math.floor(me.x), ty = Math.floor(me.y);
    if (tx !== me.lastTX || ty !== me.lastTY) {
      me.lastTX = tx; me.lastTY = ty;
      reveal(tx, ty, REVEAL_R);
    }
    // 技能回灯火
    if (me.mp < me.maxMp) me.mp = Math.min(me.maxMp, me.mp + 1.5 * dt);

    // 脚下粒子：走进草地会踩起一点尘土
    if (moving && Math.random() < dt * 6) {
      S.parts.push({ x: me.x + (Math.random() - 0.5) * 0.4, y: me.y, vx: 0, vy: -0.4, life: 0.5, max: 0.5, col: 'rgba(220,220,200,', r: 1.2 });
    }
  }

  // 带碰撞的位移：按轴分离，贴墙滑行（斜着撞墙不会整个人停住）
  function stepMove(e, dx, dy) {
    var nx = e.x + dx, ny = e.y + dy;
    var r = 0.28;
    if (!blockedAt(nx + (dx > 0 ? r : -r), e.y) && !blockedAt(nx, e.y)) e.x = nx;
    else e.vx = 0;
    if (!blockedAt(e.x, ny + (dy > 0 ? r : -r)) && !blockedAt(e.x, ny)) e.y = ny;
    else e.vy = 0;
  }
  function blockedAt(x, y) {
    // 只认「脚下一格」：16px 的小人按整格判定，斜角不会卡住
    return blockedTile(tileAt(Math.floor(x), Math.floor(y)));
  }

  // ---------------- §11 战斗 ----------------
  var COMBO_MUL = [1.0, 1.0, 1.8];
  var ATK_ARC = [120, 120, 150];
  var ATK_REACH = [1.9, 1.9, 2.3];

  function startAttack(me, t) {
    var nowIdx = (t - me.comboAt < COMBO_WINDOW) ? (me.comboIdx + 1) % 3 : 0;
    me.comboIdx = nowIdx;
    me.comboAt = t;
    var wk = (S.stats && S.stats.weaponKind) || 'sword';
    var mul = COMBO_MUL[nowIdx];
    var dur = ATK_WINDUP + ATK_ACTIVE + ATK_RECOVER;
    // 自动瞄准：朝最近的怪转过去（平板没有鼠标，不自动瞄准等于打不中）
    var tgt = nearestMob(me.x, me.y, 2.6);
    var dx, dy;
    if (tgt) {
      dx = tgt.x - me.x; dy = tgt.y - me.y;
      var dd = Math.sqrt(dx * dx + dy * dy) || 1;
      dx /= dd; dy /= dd;
    } else {
      dx = me.dirX || 0; dy = me.dirY || 1;
      var d2 = Math.sqrt(dx * dx + dy * dy) || 1;
      dx /= d2; dy /= d2;
    }
    me.act = { type: 'attack', t: 0, dur: dur, dx: dx, dy: dy, combo: nowIdx, hit: 0, mul: mul, wk: wk };
    me.face = playerFacing(dx, dy);
    me.atkCdUntil = t + (ATK_WINDUP + 40) / 1000;
    auSfx(nowIdx === 2 ? 'sword2' : 'sword', 0.34, 0.92 + Math.random() * 0.16);
  }

  // 攻击的「有效帧」到点时结算命中
  function resolveAttack(me, t) {
    if (!me.act || me.act.type !== 'attack' || me.act.hit) return;
    if (me.act.t < ATK_WINDUP) return;
    me.act.hit = 1;
    var wk = me.act.wk;
    var reach = ATK_REACH[me.act.combo] * (wk === 'lance' ? 1.45 : (wk === 'twin' ? 0.82 : 1));
    var arc = ATK_ARC[me.act.combo] * Math.PI / 180;
    var hits = [];
    var ids = Object.keys(S.mobs);
    for (var i = 0; i < ids.length; i++) {
      var m = S.mobs[ids[i]];
      if (!m || m.dying) continue;
      var dx = m.x - me.x, dy = m.y - me.y;
      var d = Math.sqrt(dx * dx + dy * dy);
      if (d > reach + (m.boss ? 1.2 : 0.35)) continue;
      var ang = Math.atan2(dy, dx);
      var face = Math.atan2(me.act.dy, me.act.dx);
      if (d > 0.65 && Math.abs(angleDiff(ang, face)) > arc * 0.5) continue;
      hits.push(m);
    }
    if (wk === 'staff') {
      // 法杖：一条直线上的第一个目标（视觉上是一道光）
      hits = hits.slice(0, 1);
      S.beams.push({ x: me.x, y: me.y, dx: me.act.dx, dy: me.act.dy, len: 9, life: 0.16, max: 0.16 });
      auSfx('magic', 0.4, 1.1);
    }
    if (!hits.length) return;
    var dmgBase = (S.stats.atk || 8) * me.act.mul;
    // v5.6 W4 b2 连斩：末段（第 3 段）伤害 ×1.25（有 b2 天赋时），飘字放大 1.5 倍橙色
    var finisher = me.act.combo === 2 && me.talentBladeLv >= 2;
    if (finisher) dmgBase *= 1.25;
    for (var k = 0; k < hits.length; k++) {
      var mob = hits[k];
      var crit = Math.random() * 100 < (S.stats.crit || 5) || (me.critReady > 0 && k === 0);
      if (k === 0 && me.critReady > 0) me.critReady = 0;
      var dmg = dmgBase * (crit ? 1 + (S.stats.critDmg || 50) / 100 : 1) * (0.9 + Math.random() * 0.2);
      dmg = Math.max(1, Math.round(dmg));
      var kbx = me.act.dx, kby = me.act.dy;
      hitMob(mob, dmg, crit, kbx, kby, me.act.combo === 2, finisher);
      S.net.queue.push({ m: mob.id, d: dmg, c: crit ? 1 : 0, kx: Math.round(kbx * 10) / 10, ky: Math.round(kby * 10) / 10, h: me.act.combo === 2 ? 1 : 0, f: finisher ? 1 : 0 });
    }
    hitstop(crit ? 90 : HITSTOP);
    S.cam.shake = Math.max(S.cam.shake, hits.length > 2 ? 4 : 2.4);
    auSfx(easePick(['hit', 'hit2', 'hit3']), 0.42, 0.95 + Math.random() * 0.2);
    // v5.6 W4 b5 剑舞：普攻每 5 次自动小回旋（0.6 倍半径与伤害，复用 spin 特效）
    if (me.talentBladeLv >= 5) {
      me.atkCount = (me.atkCount || 0) + 1;
      if (me.atkCount >= 5) { me.atkCount = 0; autoSpin(me, t); }
    }
  }

  // v5.6 W4 b5 剑舞：命中上报走 melee 通道（小回旋半径 0.6×2.8≈1.68 < HIT_REACH 3.2）
  function autoSpin(me, t) {
    var radius = 2.8 * 0.6;
    var dmgBase = (S.stats.atk || 8) * 1.6 * 0.6;
    var list = [];
    var ids = Object.keys(S.mobs);
    for (var i = 0; i < ids.length; i++) {
      var m = S.mobs[ids[i]];
      if (!m || m.dying) continue;
      var d = dist(me.x, me.y, m.x, m.y);
      if (d > radius + (m.boss ? 1.4 : 0.4)) continue;
      var crit = Math.random() * 100 < (S.stats.crit || 5);
      var dmg = Math.max(1, Math.round(dmgBase * (crit ? 1 + (S.stats.critDmg || 50) / 100 : 1)));
      var dx = (m.x - me.x) / (d || 1), dy = (m.y - me.y) / (d || 1);
      hitMob(m, dmg, crit, dx, dy, false, false);
      list.push({ m: m.id, d: dmg, c: crit ? 1 : 0, kx: Math.round(dx * 10) / 10, ky: Math.round(dy * 10) / 10, f: 0 });
    }
    S.rings.push({ x: me.x, y: me.y, r: 0, max: radius, life: 0.3, max2: 0.3, col: '#ffc9a8' });
    auSfx('power', 0.28, 1.3);
    if (list.length) {
      for (var j = 0; j < list.length && j < 8; j++) S.net.queue.push(list[j]);
    }
  }

  function easePick(a) { return a[(Math.random() * a.length) | 0]; }

  function hitMob(m, dmg, crit, kx, ky, heavy, finisher) {
    m.hpVis = Math.max(0, (m.hpVis == null ? m.hp : m.hpVis) - dmg);
    m.flash = 0.12;
    m.kx = (m.kx || 0) + kx * (heavy ? 0.55 : 0.25);
    m.ky = (m.ky || 0) + ky * (heavy ? 0.55 : 0.25);
    m.shakeT = 0.12;
    if (m.hpVis <= 0) m.dying = 0.28;
    var me = S.me;
    var purple = crit && me && me.shadowStrike;   // v5.6 W4 s5 影袭：下一击暴击紫色
    if (purple) me.shadowStrike = 0;
    S.texts.push({
      x: m.x + (Math.random() - 0.5) * 0.3, y: m.y - (m.boss ? 2.2 : 0.9),
      txt: String(dmg), crit: crit, life: crit ? 0.9 : 0.7, max: crit ? 0.9 : 0.7,
      vy: crit ? -1.5 : -1.1, vx: (Math.random() - 0.5) * 0.5,
      col: purple ? '#9a8aff' : (finisher ? '#ff8a6a' : ''),
      big: finisher ? 1 : 0
    });
    burst(m.x, m.y - 0.2, crit ? 10 : 5, crit ? '#ffe08a' : '#ffb0a0', crit ? 4.5 : 3);
  }

  function hitstop(ms) {
    S.hitstopUntil = Math.max(S.hitstopUntil || 0, S.time + ms / 1000);
  }

  function burst(x, y, n, col, spd) {
    for (var i = 0; i < n; i++) {
      var a = Math.random() * 6.2832;
      var v = spd * (0.4 + Math.random() * 0.8);
      S.parts.push({
        x: x, y: y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 1,
        life: 0.4 + Math.random() * 0.3, max: 0.7, col: col, r: 1 + Math.random() * 1.4
      });
    }
  }

  function nearestMob(x, y, maxD) {
    var best = null, bd = maxD || 99;
    var ids = Object.keys(S.mobs);
    for (var i = 0; i < ids.length; i++) {
      var m = S.mobs[ids[i]];
      if (!m || m.dying) continue;
      var d = dist(x, y, m.x, m.y);
      if (d < bd) { bd = d; best = m; }
    }
    return best;
  }

  function castSkill(me, t) {
    var kind = me.skills && me.skills.length ? me.skills[me.skills.length - 1] : 'spin';
    var def = SKILLS[kind] || SKILLS.spin;
    if (t < (me.skillCdUntil || 0)) return toast('技能还在冷却', 'warn');
    if ((me.mp || 0) < def.mp) return toast('灯火不够', 'warn');
    me.mp -= def.mp;
    me.skillCdUntil = t + def.cd / 1000;
    me.act = { type: 'skill', t: 0, dur: 320, dx: me.dirX || 0, dy: me.dirY || 1 };
    var list = [];
    var ids = Object.keys(S.mobs);
    var dmgBase = (S.stats.atk || 8) * (def.dmg || 1.6) * (1 + ((S.stats.skill) || 0) / 100);
    for (var i = 0; i < ids.length; i++) {
      var m = S.mobs[ids[i]];
      if (!m || m.dying) continue;
      var d = dist(me.x, me.y, m.x, m.y);
      if (d > (def.radius || 2.8) + (m.boss ? 1.4 : 0.4)) continue;
      var crit = Math.random() * 100 < (S.stats.crit || 5);
      var dmg = Math.max(1, Math.round(dmgBase * (crit ? 1 + (S.stats.critDmg || 50) / 100 : 1)));
      var dx = (m.x - me.x) / (d || 1), dy = (m.y - me.y) / (d || 1);
      hitMob(m, dmg, crit, dx, dy, true);
      list.push({ m: m.id, d: dmg, c: crit ? 1 : 0, kx: Math.round(dx * 10) / 10, ky: Math.round(dy * 10) / 10 });
    }
    S.rings.push({ x: me.x, y: me.y, r: 0, max: def.radius || 2.8, life: 0.42, max2: 0.42, col: '#ffe6a8' });
    S.cam.shake = Math.max(S.cam.shake, 5);
    hitstop(70);
    auSfx('power', 0.4, 1);
    S.net.skill = { k: kind, list: list };
    if (kind === 'lamp') S.lamps.push({ x: me.x, y: me.y, until: S.time + (def.dur || 12000), r: def.radius || 4 });
  }

  // 交互：箱子 / 传送石 / 灯塔 / NPC / 商店
  function doInteract(t) {
    var me = S.me;
    var best = null, bd = 2.2, bkind = '';
    // 守塔人遗物与夜语（《灯火纪》v5.8）：同一格昼夜切换 —— 夜（含 dusk 渐显段）读夜语、
    // 白天读石碑。phase 门控优先，一次 E 只出一张卡（防同点双触发）。
    var nightNow = nyxPhaseAlpha() > 0.01;
    if (nightNow) {
      for (var nyi = 0; nyi < (S.map.nights || []).length; nyi++) {
        var ny = S.map.nights[nyi];
        if (!nyxTonight(ny.id)) continue;
        var dny = dist(me.x, me.y, ny.x + 0.5, ny.y + 0.5);
        if (dny < bd) { bd = dny; best = ny; bkind = 'nyx'; }
      }
    }
    for (var ri = 0; !nightNow && ri < (S.map.relics || []).length; ri++) {
      var rl = S.map.relics[ri];
      var dr = dist(me.x, me.y, rl.x + 0.5, rl.y + 0.5);
      if (dr < bd) { bd = dr; best = rl; bkind = 'relic'; }
    }
    // 宝箱
    for (var i = 0; i < S.map.chests.length; i++) {
      var c = S.map.chests[i];
      if (S.chests[c.id]) continue;
      var d = dist(me.x, me.y, c.x + 0.5, c.y + 0.5);
      if (d < bd) { bd = d; best = c; bkind = 'chest'; }
    }
    // 传送石
    for (var j = 0; j < S.map.waystones.length; j++) {
      var w = S.map.waystones[j];
      var d2 = dist(me.x, me.y, w.x + 0.5, w.y + 0.5);
      if (d2 < bd) { bd = d2; best = w; bkind = 'waystone'; }
    }
    // 灯塔
    for (var z in S.map.towers) {
      var tw = S.map.towers[z];
      var d3 = dist(me.x, me.y, tw.x + 0.5, tw.y + 0.5);
      if (d3 < bd + 0.8) { bd = d3; best = tw; bkind = 'tower'; }
    }
    // NPC
    for (var k = 0; k < NPCS.length; k++) {
      var n = NPCS[k];
      var d4 = dist(me.x, me.y, n.x, n.y);
      if (d4 < bd) { bd = d4; best = n; bkind = 'npc'; }
    }
    if (!best) return toast('这里没有可以交互的东西');
    if (bkind === 'nyx') return loreOpenNight(best);
    if (bkind === 'relic') return loreOpenRelic(best);
    if (bkind === 'chest') return apiChest(best);
    if (bkind === 'waystone') return apiWaystone(best);
    if (bkind === 'tower') {
      var tz = findZoneOfTower(best);
      var lit = !!S.towers[tz];
      // v5.8 守夜仪式：长夜之心的塔在仪式期间按 E = 举灯 / 放下
      if (tz === 'abyss' && S.finale && S.finale.open && !S.finale.done) {
        var act = S.finale.meWaiting ? 'leave' : 'join';
        return apiPost('/shiguang/v5/finalite', { act: act }).then(function (r) {
          if (r && r.data) { S.finale = r.data; finaleUiPaint(); }
          if (act === 'join') { toast('你举起了灯', 'good'); auSfx('menu', 0.4, 1.2); }
          else toast('你放下了灯');
        }).catch(function (e) { toast(e.message || '塔没有回应', 'warn'); });
      }
      return toast(lit ? '灯塔已经亮了 —— 这片区域是安全的' : '灯塔被长夜压着。打倒守护者才能点亮它');
    }
    if (bkind === 'npc') return openNpc(best);
  }

  function findZoneOfTower(tw) {
    for (var z in S.map.towers) {
      var t = S.map.towers[z];
      if (t.x === tw.x && t.y === tw.y) return z;
    }
    return '';
  }


  // ======================== 06_data.js ========================
  // ---------------- §12 客户端数据 ----------------
  // 技能：与 backend/v5/data.js 的 SKILLS 同名同参（数值以服务端为准，这里只管观感）
  var SKILLS = {
    spin: { name: '灯火回旋', mp: 18, cd: 4000, dmg: 1.6, radius: 2.8, lv: 1, desc: '周身一圈光刃，清群怪。' },
    dash: { name: '影步斩', mp: 14, cd: 3200, dmg: 2.2, dist: 6, lv: 4, desc: '向前冲刺斩击，冲刺中无敌。' },
    nova: { name: '星爆', mp: 30, cd: 9000, dmg: 3.4, radius: 4.2, lv: 9, desc: '蓄力爆炸，击退并点燃。' },
    lamp: { name: '守夜灯', mp: 24, cd: 20000, dur: 12000, radius: 4, lv: 6, desc: '放一盏灯：回血，幽灵不敢靠近。' },
    arrows: { name: '流星雨', mp: 36, cd: 12000, dmg: 1.0, radius: 5, lv: 14, desc: '指定区域落下流星。' }
  };

  // 镇上的 NPC —— 他们的位置钉在房子门口，不会乱走（走丢了玩家就找不到铁匠）
  var NPCS = [
    {
      id: 'smith', name: '铁匠 阿岩', x: 0, y: 0, look: 'NinjaGray', face: 0,
      line: ['刀要趁热打，词条也是。', '星屑带够了吗？重铸可不便宜。'],
      action: 'forge', actionText: '打开锻造台'
    },
    {
      id: 'shop', name: '杂货铺 阿禾', x: 0, y: 0, look: 'Woman', face: 0,
      line: ['回血药、灯油，都在这儿。', '夜里别空着手出门。'],
      action: 'shop', actionText: '看看货'
    },
    {
      id: 'inn', name: '客栈 阿灯', x: 0, y: 0, look: 'OldMan', face: 0,
      line: ['累了就歇会儿，灯火一直亮着。', '长夜不会走，但人会累。'],
      action: 'rest', actionText: '歇一会儿（回满生命）'
    },
    {
      id: 'hall', name: '守灯人 栗', x: 0, y: 0, look: 'Master', face: 0,
      line: ['灯塔一盏一盏灭下去的时候，我在数。', '你点亮一座，我就少数一个。'],
      action: 'story', actionText: '听她说话'
    }
  ];

  // 怪物形象：kind → 图集里的 mon_ 名字。没有对应素材的用最接近的替身，
  // 宁可「长得像」也不要「看不见」。
  var MOB_SPRITE = {
    slime: 'mon_Slime', slime2: 'mon_Slime2', bamboo: 'mon_Bamboo', mouse: 'mon_Mouse',
    eye: 'mon_Eye', mushroom: 'mon_Mushroom', owl: 'mon_Owl', beast: 'mon_Beast',
    snake: 'mon_Snake', frog: 'mon_Axolot', larva: 'mon_Larva', lantern: 'mon_LanternRed',
    skull: 'mon_Skull', cyclope: 'mon_Cyclope', mole: 'mon_Mole', reptile: 'mon_Reptile2',
    spirit2: 'mon_Spirit2', dragon: 'mon_Dragon', octopus: 'mon_Octopus2', flam: 'mon_Flam2',
    ghost: 'mon_Spirit'
  };
  var MOB_SIZE = {
    slime: 0.8, slime2: 0.85, bamboo: 1.05, mouse: 0.7, eye: 0.85, mushroom: 0.9,
    owl: 0.85, beast: 1.15, snake: 0.9, frog: 0.95, larva: 0.7, lantern: 0.9,
    skull: 1.0, cyclope: 1.35, mole: 0.85, reptile: 1.05, spirit2: 1.0, dragon: 1.25,
    octopus: 1.3, flam: 1.0, ghost: 1.0
  };

  var BOSS_SPRITE = {
    meadow: ['GiantFrog', 1], forest: ['TenguBlue', 0.75], swamp: ['GiantRacoonGold', 1],
    crag: ['GiantRedSamurai', 1], frost: ['GiantSpirit', 1], abyss: ['DemonCyclop', 1]
  };

  var ZONE_NAMES = {
    town: '拾光镇', meadow: '晨光草原', forest: '雾隐林', swamp: '萤火泽',
    crag: '星坠岩', frost: '霜屿', abyss: '长夜之心'
  };
  var ZONE_ORDER = ['meadow', 'forest', 'swamp', 'crag', 'frost', 'abyss'];

  // 《灯火纪》九章（v5.7）：按点亮灯塔的座数推进（全服进度）。at 0..7 为点灯数，
  // at 8 为终章（六域 + 长夜之心全亮后触发一次）。intro 在图鉴「世界」页签可重读。
  var CHAPTERS = [
    { at: 0, title: '序章 · 灯数着你们', text: '镇上的灯还亮着。守灯人栗说：「你听见了吗？长夜在数我们的灯。」',
      intro: '灯塔的火比昨天暗了一指宽。栗翻出名册核对 —— 名册上少了一个名字，不是谁走了，是「昨天」少了一天。雾灾之后，长夜每年偷走几个日子，没人追得上。栗看着新来的你们，把守灯人的铜钥匙擦了三遍，终于开口：六座灯塔，六位前辈，六段没人敢忘也不敢提的事。「去把它们重新点起来。别学我师父 —— 她连自己是怎么回去的都忘了。」' },
    { at: 1, title: '第一章 · 长夜从西边来', text: '西边的草原上有一盏灯灭了。从那天起，史莱姆开始聚成群。',
      intro: '草原灯塔是栗的师父宁姑娘守的。她烧掉了「羊群回家的铃铛声」，灯亮了一百年 —— 直到前天，灯芯里的最后一缕铃音散了。草原上现在只剩下雾。栗说：「把她重新点起来。这次，别拿一个人的记忆去换。」' },
    { at: 2, title: '第二章 · 草原的老国王', text: '巨蛙王倒下去的时候，雾退了一点点。原来长夜不是天气，它是活的。',
      intro: '灯重新亮起来的那一刻，草原上所有朝一个方向倒的草，齐齐立正了一次。宁姑娘塔里的日记最后一句是：「铃铛不响了，羊还是会回家的 —— 路我记在灯里了。」栗把这句抄在镇口的告示板上，很多人围看。那天夜里，第一次有雾停在了灯塔的光圈外，像在排队。' },
    { at: 3, title: '第三章 · 林中的眼睛', text: '雾隐林里挂满了眼睛。天狗说它只是守着林子的边界 —— 守到忘了自己在守什么。',
      intro: '林子里那些「眼睛」，是哑叔的结绳。他天生不能说话，守塔前靠结绳跟所有人说话；烧掉「妻子的名字」之后，他忘了最后一个绳结念什么，只好在每棵树上刻满同一个字。天狗说：「他托我看绳。我不识字，我就看着。」你们把绳结解开的那个傍晚，林子里所有的树响了一声 —— 很多人说是风，栗说不是。' },
    { at: 4, title: '第四章 · 被偷走的萤火', text: '萤火泽的灯全都不见了。金爪把它们吞进肚子里，照亮自己过冬。',
      intro: '阿潮在泽上找了妹妹十三年，最后烧掉「妹妹的脸」点灯 —— 她说这样就不会再认错人。塔亮以后她不唱了，萤火泽安静了十五年。你们的船靠近灯塔时，泽面浮起一层萤火，按一条谁也没走过的路线排开，绕塔三圈又散开。老船工说：「那是她妹妹小时候回家要走的路。阿潮没烧掉这个 —— 她烧的是脸，没烧路。」' },
    { at: 5, title: '第五章 · 战争早就结束了', text: '赤武士还在等一道不会再来的命令。他守的山，已经塌了一半。',
      intro: '石翁是六人里唯一硬抗过长夜的 —— 他不肯烧记忆，凿子在手里攥了四十年，塔门梁上「拿你最舍不得的换」那行字就是他凿的。他最后还是烧了，烧掉「自己修过的每一座塔」。此后他站在自己塔前像站在陌生人面前，一直到灯把他也收进去。你们在他塔门口看到那套锈凿子，谁也没伸手。' },
    { at: 6, title: '第六章 · 冰下的敲击', text: '霜屿的冰下面有东西在敲。它不是要出来 —— 它是要你别再往里走。',
      intro: '霜屿的塔是孩子们守的。雾灾留下一群孤儿，最小的负责喊「起风了」，最大的负责把「明天见」三个字刻进冰里。他们把各自父母的声音烧进灯里，约定谁也不许哭 —— 说好了哭的要去堵烟囱。最后一个孩子走的时候，把没说完的「明天见」冻进了应声冰。你们到的那天，冰下的敲击停了；冰面上，有人听见冰自己敲了两下。' },
    { at: 7, title: '第七章 · 所有熄灭的灯', text: '长夜之心里没有怪物，只有一地熄灭的灯。最后一盏，在你手上。',
      intro: '峡谷尽头，夜屑落满一地灯，摆得整整齐齐。中央那座最大的塔，门上刻着「缺一份 —— 缺的那份，不在我手里」。第一代大守塔人拾，当年把全镇的灯收进这座塔，替所有人扛住大雾灾；他把「最珍贵的」烧了七次，每次都差一点 —— 因为他不肯烧最后那段：全镇的人把灯交到他手上的脸。他把它们留到了今天，留成了长夜本身。' },
    { at: 8, title: '终章 · 长夜有了名字', text: '最后一盏灯亮起来的那一刻，长夜没有退 —— 它停下了，第一次，安安静静地停在光的边上。',
      intro: '你们把这段夜交给灯的时候，灯没有烧掉它 —— 它把「一起记住的」和「没能等到天亮的」接在了一起。雾不再贴着地面走，幽灵远远地站在光圈外看灯，像看一个讲了很多遍的故事。栗把名册翻到最后一页，写上：「历·灯后元年，长夜改称冬夜。」那天晚上，镇上所有的门框都改高了一寸 —— 不再需要弯腰了。' }
  ];


  // ======================== 07_entity.js ========================
  // ---------------- §13 实体渲染 ----------------
  // 所有立起来的东西（树、房子、怪、人、箱子）都按「脚底 y」排序后统一画，
  // 这样走到树后面真的会被挡住 —— 俯视角游戏的纵深全靠这一条。
  var DRAW = [];

  function px(n) { return Math.round(n); }

  function atlasImg() { return S.atlas; }

  function sprite(name, col, row, dx, dy, w, h) {
    var f = FR[name];
    if (!f) return;
    var fw = f[4], fh = f[5];
    var sx = f[0] + (col || 0) * fw;
    var sy = f[1] + (row || 0) * fh;
    var ctx = S.ctx;
    ctx.drawImage(S.atlas, sx, sy, fw, fh, px(dx), px(dy), px(w || fw * S.zoom), px(h || fh * S.zoom));
  }

  function shadow(x, y, w) {
    var ctx = S.ctx;
    var u = S.zoom * TILE;   // 一格在屏幕上的像素数
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    ctx.beginPath();
    ctx.ellipse(x, y, w * u * 0.5, w * u * 0.22, 0, 0, 6.2832);
    ctx.fill();
  }

  // 角色：4 列（下/上/左/右）× 7 行（走 4 帧 / 攻击 / 跳跃 / 倒地）
  var tintCv = null;
  function tintedSprite(name, col, row, dx, dy, w, h) {
    // v5.6 W2 ⑥：受击真染红 —— 离屏 16×16 画帧 → source-atop 染 #d14b32 → 0.6 alpha 贴回
    var f = FR[name];
    if (!f || !S.atlas) return;
    var ctx = S.ctx;
    var W = Math.max(2, Math.round(w)), H = Math.max(2, Math.round(h));
    if (!tintCv) tintCv = document.createElement('canvas');
    if (tintCv.width !== W || tintCv.height !== H) { tintCv.width = W; tintCv.height = H; }
    var tg = tintCv.getContext('2d');
    tg.clearRect(0, 0, W, H);
    tg.imageSmoothingEnabled = false;
    var fw = f[4], fh = f[5];
    var sx = f[0] + (col || 0) * fw, sy = f[1] + (row || 0) * fh;
    tg.drawImage(S.atlas, sx, sy, fw, fh, 0, 0, W, H);
    try {
      tg.globalCompositeOperation = 'source-atop';
      tg.fillStyle = '#d14b32';
      tg.fillRect(0, 0, W, H);
      tg.globalCompositeOperation = 'source-over';
    } catch (e) {}
    ctx.save();
    ctx.globalAlpha = 0.6;
    ctx.drawImage(tintCv, px(dx), px(dy), W, H);
    ctx.restore();
  }

  function drawCharacter(look, x, y, face, moving, animT, scale, tint) {
    var name = 'ch_' + (look || 'NinjaBlue');
    if (!FR[name]) name = 'ch_NinjaBlue';
    var u = S.zoom * (scale || 1);
    var row, col;
    if (face === 2 || face === 3) col = face;
    else col = face;
    row = moving ? (Math.floor(animT * 8) % 4) : 0;
    var w = 16 * u, h = 16 * u;
    var dx = x - w / 2, dy = y - h + u * 0.5;
    if (tint) {
      tintedSprite(name, col, row, dx, dy, w, h);
    } else {
      sprite(name, col, row, dx, dy, w, h);
    }
  }

  // 怪物：单行多帧循环（左右靠水平翻转）
  function drawMobSprite(m, x, y) {
    var name = MOB_SPRITE[m.kind] || 'mon_Slime';
    if (m.boss) {
      var bs = BOSS_SPRITE[m.bossZone] || ['GiantFrog', 1];
      var anim = 'Idle';
      if (m.state === 'act') anim = 'Attack';
      else if (m.state === 'chase' || m.moving) anim = 'Walk';
      if (m.state === 'stun' || m.state === 'knock') anim = 'Hit';
      var key = 'boss_' + bs[0] + '_' + anim;
      if (!FR[key]) key = 'boss_' + bs[0] + '_Idle';
      var f = FR[key];
      if (!f) return;
      var frames = Math.max(1, Math.round(f[2] / f[4]));
      var fi = Math.floor(S.time * 6) % frames;
      var u = S.zoom * (m.scale || 2.6);
      var w = f[4] * u, h = f[5] * u;
      var flip = m.face === 'l';
      S.ctx.save();
      if (flip) {
        S.ctx.translate(px(x), 0);
        S.ctx.scale(-1, 1);
        S.ctx.drawImage(S.atlas, f[0] + fi * f[4], f[1], f[4], f[5], px(-w / 2), px(y - h + u * 0.4), px(w), px(h));
      } else {
        S.ctx.drawImage(S.atlas, f[0] + fi * f[4], f[1], f[4], f[5], px(x - w / 2), px(y - h + u * 0.4), px(w), px(h));
      }
      S.ctx.restore();
      return;
    }
    var n2 = MOB_SPRITE[m.kind] || 'mon_Slime';
    var fr = FR[n2];
    if (!fr) return;
    var scale = (MOB_SIZE[m.kind] || 1) * (m.elite ? 1.22 : 1) * 1.0;
    var u2 = S.zoom * scale;
    var fw = fr[4], fh = fr[5];
    var fi2 = Math.floor(S.time * (m.moving ? 7 : 4) + (m.id.length || 0)) % 4;
    var w2 = fw * u2, h2 = fh * u2;
    var dx = x - w2 / 2, dy = y - h2 + u2 * 0.35;
    var ctx = S.ctx;
    ctx.save();
    if (m.face === 'l') {
      ctx.translate(px(x), 0);
      ctx.scale(-1, 1);
      ctx.drawImage(S.atlas, fr[0] + fi2 * fw, fr[1], fw, fh, px(-w2 / 2), px(dy), px(w2), px(h2));
    } else {
      ctx.drawImage(S.atlas, fr[0] + fi2 * fw, fr[1], fw, fh, px(dx), px(dy), px(w2), px(h2));
    }
    ctx.restore();
    if (m.elite) {
      // v5.6 W2 ⑦：精英改为脚底椭圆金环（半透明，比金框更像「光环」）
      var u3 = S.zoom * TILE;
      S.ctx.fillStyle = 'rgba(255,210,110,0.5)';
      S.ctx.beginPath();
      S.ctx.ellipse(px(x), px(y + u3 * 0.34), u3 * (MOB_SIZE[m.kind] || 1) * 0.62, u3 * 0.18, 0, 0, 6.2832);
      S.ctx.fill();
    }
  }

  // 前摇预警：红扇 / 红线 / 红走廊 —— 这是「可读性」的全部
  function drawTell(m, x, y) {
    if (!m.tellT || m.tellT <= 0) return;
    var ctx = S.ctx;
    var u = S.zoom * TILE;   // 一格在屏幕上的像素数
    var k = clamp(1 - m.tellT / (m.tellMax || 500), 0, 1);
    var alpha = 0.14 + 0.22 * k;
    var r = (m.boss ? 3.4 : 2.2) * u;
    ctx.save();
    if (m.arch === 'line') {
      var a = m.faceAng || 0;
      ctx.translate(x, y - u * 0.4);
      ctx.rotate(a);
      ctx.fillStyle = 'rgba(255,80,70,' + alpha + ')';
      ctx.fillRect(0, -u * 0.35, r * 3, u * 0.7);
      ctx.fillStyle = 'rgba(255,140,120,' + (alpha * 1.4) + ')';
      ctx.fillRect(0, -u * 0.12, r * 3, u * 0.24);
    } else {
      var face = m.faceAng || 0;
      var arc = (m.boss ? 1.6 : 1.05);
      ctx.beginPath();
      ctx.moveTo(x, y - u * 0.3);
      ctx.arc(x, y - u * 0.3, r, face - arc, face + arc);
      ctx.closePath();
      ctx.fillStyle = 'rgba(255,70,60,' + alpha + ')';
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,120,100,' + (alpha + 0.28) + ')';
      ctx.lineWidth = Math.max(1, u * 0.22);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawMob(m) {
    var x = w2sX(m.rx * TILE), y = w2sY(m.ry * TILE + TILE * 0.5);
    shadow(x, y + TILE * S.zoom * 0.42, m.boss ? 3.2 : (MOB_SIZE[m.kind] || 1) * 1.1);
    drawTell(m, x, y);
    var shake = m.shakeT > 0 ? (Math.random() - 0.5) * S.zoom * 1.2 : 0;
    drawMobSprite(m, x + shake, y);
    // 血条
    var frac = m.hpVis == null ? 1 : clamp(m.hpVis / (m.maxHp || 1), 0, 1);
    if (frac < 0.999 || m.boss) {
      var bw = (m.boss ? 90 : 22) * (S.zoom / 4);
      var bx = x - bw / 2, by = y - (m.boss ? 46 : 17) * (S.zoom / 4) - 4;
      var ctx = S.ctx;
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(px(bx - 1), px(by - 1), px(bw + 2), 4);
      ctx.fillStyle = m.elite ? '#ffd36a' : '#e0574a';
      ctx.fillRect(px(bx), px(by), px(bw * frac), 2);
    }
    if (m.elite) {
      var lv = m.lv || 1;
      S.ctx.fillStyle = 'rgba(255,214,120,0.9)';
      S.ctx.font = 'bold ' + Math.round(6 * (S.zoom / 3)) + 'px "SG5Pixel",monospace';
      S.ctx.textAlign = 'center';
      S.ctx.fillText('精英 Lv' + lv, x, y - 16 * S.zoom * (m.elite ? 1.22 : 1) - 4);
    }
  }

  function drawPlayer(p, isMe) {
    var x = w2sX(p.x * TILE), y = w2sY(p.y * TILE + TILE * 0.5);
    shadow(x, y + TILE * S.zoom * 0.4, 1.1);
    // v5.6 W4 l4 共明：拥有者脚下 6 格淡金圆环（alpha 0.15 常驻）
    if (isMe && S.me && S.me.talentLampLv >= 4) {
      var ctxA = S.ctx;
      var ua = TILE * S.zoom;
      ctxA.save();
      ctxA.globalAlpha = 0.15;
      ctxA.fillStyle = '#ffd36a';
      ctxA.beginPath();
      ctxA.ellipse(x, y + ua * 0.35, ua * 6, ua * 2.1, 0, 0, 6.2832);
      ctxA.fill();
      ctxA.restore();
    }
    if (p.down) {
      // 倒地：横躺的剪影 + 一圈提示
      var ctx = S.ctx;
      ctx.save();
      ctx.globalAlpha = 0.55;
      ctx.translate(x, y);
      ctx.rotate(Math.PI / 2);
      drawCharacter(p.look, 0, 8 * S.zoom, 0, false, 0, 1);
      ctx.restore();
      ctx.strokeStyle = 'rgba(255,120,110,0.9)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, y - 4, 14 * (S.zoom / 4), 0, 6.2832);
      ctx.stroke();
      return;
    }
    // 站着不动也要「活着」：极轻的呼吸起伏 + 走路时更快的踏步弹性
    var phase = S.time * 2.05 + (p.x || 0) * 0.7 + (p.y || 0) * 0.3;
    var bob = p.moving ? Math.sin(S.time * 12) * 0.6 : Math.sin(phase) * 0.55;
    drawCharacter(p.look, x, y + bob, p.face, p.moving, p.animT || 0, 1);
    // 攻击特效
    if (isMe && p.act && p.act.type === 'attack' && p.act.t < p.act.dur * 0.7) {
      drawSlash(p, x, y);
    }
    if (isMe && p.act && p.act.type === 'skill') {
      var k = clamp(p.act.t / p.act.dur, 0, 1);
      var ctx2 = S.ctx;
      ctx2.save();
      ctx2.globalAlpha = (1 - k) * 0.8;
      ctx2.strokeStyle = '#ffe6a8';
      ctx2.lineWidth = 2 + 4 * (1 - k);
      ctx2.beginPath();
      ctx2.arc(x, y - 4, (1 + k * 2.6) * 18, 0, 6.2832);
      ctx2.stroke();
      ctx2.restore();
    }
    if (!isMe && p.name) {
      S.ctx.font = Math.round(6.5 * (S.zoom / 3)) + 'px "SG5Pixel",monospace';
      S.ctx.textAlign = 'center';
      var nameY = y - TILE * S.zoom - 2;
      S.ctx.fillStyle = 'rgba(0,0,0,0.55)';
      S.ctx.fillText(p.name, x + 1, nameY + 1);
      S.ctx.fillStyle = 'rgba(232,242,255,0.92)';
      S.ctx.fillText(p.name, x, nameY);
    }
  }

  function drawSlash(p, x, y) {
    var ctx = S.ctx;
    var u = S.zoom * TILE;   // 一格在屏幕上的像素数
    var prog = clamp(p.act.t / (p.act.dur * 0.7), 0, 1);
    var face = Math.atan2(p.act.dy, p.act.dx);
    var sweep = 1.9 - prog * 1.6;
    ctx.save();
    ctx.translate(x, y - u * 0.35);
    ctx.rotate(face);
    ctx.globalAlpha = 0.85 * (1 - prog);
    var g = ctx.createLinearGradient(u * 0.4, 0, u * 2.2, 0);
    g.addColorStop(0, 'rgba(255,255,255,0.95)');
    g.addColorStop(0.6, 'rgba(190,235,255,0.55)');
    g.addColorStop(1, 'rgba(190,235,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(u * 0.3, -u * 0.1);
    ctx.quadraticCurveTo(u * 1.6, -u * 1.5 * sweep, u * 2.3, -u * 0.2);
    ctx.quadraticCurveTo(u * 1.5, u * 0.5, u * 0.3, u * 0.2);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  function drawShots() {
    // v5.6 W2 ⑤：弹幕改 3 层同心方块（像素风，径向渐变太「网页」）
    var ctx = S.ctx;
    var layers = [['#ffd0ff', 2], ['#d878ff', 4], ['#a850ff', 6]];
    var k = S.zoom / 3;
    ctx.globalAlpha = 0.6;
    for (var i = 0; i < S.shots.length; i++) {
      var s = S.shots[i];
      var x = w2sX(s.rx * TILE), y = w2sY(s.ry * TILE);
      for (var l = 0; l < 3; l++) {
        var r = layers[l][1] * k;
        ctx.fillStyle = layers[l][0];
        ctx.fillRect(px(x - r / 2), px(y - r / 2), px(r), px(r));
      }
    }
    ctx.globalAlpha = 1;
  }

  // ---------------- v5.6 W3 奖励实体层 ----------------
  // 世界层字形绘制：行串 8×8（'#' 主色 / 'o' 亮部 / '+' 次色 / '.' 空）
  function drawGlyphWorld(ctx, rows, cx, cy, cell, pal) {
    var h = rows.length, w = rows[0].length;
    var ox = Math.round(cx - w * cell / 2), oy = Math.round(cy - h * cell);
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var ch = rows[y].charAt(x);
        if (ch === '.') continue;
        ctx.fillStyle = (pal && pal[ch]) || pal && pal['#'] || '#e8dcc0';
        ctx.fillRect(ox + Math.round(x * cell), oy + Math.round(y * cell), Math.max(1, Math.round(cell)), Math.max(1, Math.round(cell)));
      }
    }
  }
  var ORB_GLYPH = {
    orb_s: [
      '..####..',
      '.######.',
      '########',
      '########',
      '########',
      '.######.',
      '..####..',
      '........'
    ],
    orb_m: [
      '..####..',
      '.#oo##o.',
      '########',
      '#o####o#',
      '#o####o#',
      '########',
      '.##oo##.',
      '..####..'
    ],
    orb_l: [
      '.######.',
      '##oo####',
      '#o####o#',
      '########',
      '########',
      '#o####o#',
      '##oo####',
      '.######.'
    ]
  };
  var ORB_TIER = [
    { g: 'orb_s', cell: 0.034, r: 1.6, col: '#e8d7a8', hi: '#fff8dc' },
    { g: 'orb_m', cell: 0.05, r: 2.0, col: '#ffd36a', hi: '#fff3c8' },
    { g: 'orb_l', cell: 0.07, r: 2.4, col: '#ffb84a', hi: '#ffe9b0' }
  ];

  function orbTierOf(v) { return v <= 4 ? 0 : (v <= 15 ? 1 : 2); }

  // 星屑珠 / 材料簇 / 金币袋：死亡位置散落（上抛 vx±0.8 / vy-1.2，落地反弹 1 次 vy×-0.35，散布 ±0.4）
  function spawnOrbs(bx, by, list) {
    if (!S.orbs) S.orbs = [];
    if (bx == null || by == null) { bx = S.me ? S.me.x : 0; by = S.me ? S.me.y : 0; }
    for (var i = 0; i < list.length; i++) {
      var o = list[i];
      var tier = o.mat ? 0 : orbTierOf(o.v || 1);
      capPush(S.orbs, {
        x: bx + 0.5 + (Math.random() - 0.5) * 0.8, y: by + 0.5,
        vx: (Math.random() - 0.5) * 1.6, vy: -1.2,
        v: o.v || 0, mat: o.mat || '', pouch: o.pouch || 0,
        tier: tier, phase: 'toss', t: 0, bounced: 0, age: 0
      }, 320);
    }
  }

  // 磁吸手感（Phase 2 终值）：上抛 90ms → 减速悬停 120ms → 8→14 格/s ease-in 吸附，<0.35 格结算
  function updateOrbs(dt, t) {
    var me = S.me;
    updateCorpses(dt);
    updatePillars(dt);
    for (var i = S.orbs.length - 1; i >= 0; i--) {
      var o = S.orbs[i];
      o.age += dt;
      o.t += dt;
      if (o.phase === 'toss') {
        o.x += o.vx * dt;
        o.y += o.vy * dt;
        o.vy += 3.2 * dt;
        if (o.vy > 0 && !o.bounced) { o.vy *= -0.35; o.bounced = 1; }
        if (o.t >= 0.09) { o.phase = 'hover'; o.t = 0; }
      } else if (o.phase === 'hover') {
        o.x += o.vx * dt * 0.3;
        o.y += 0.5 * dt * 0.2;
        if (o.t >= 0.12) { o.phase = 'wait'; o.t = 0; }
      } else if (o.phase === 'wait') {
        // 分档触发半径：小 1.6 / 中 2.0 / 大 2.4 格
        var tr = o.pouch ? 2.6 : (ORB_TIER[o.tier] ? ORB_TIER[o.tier].r : 1.6);
        if (me && !me.down && dist(o.x, o.y, me.x, me.y) < tr) { o.phase = 'magnet'; o.t = 0; }
        else if (o.age > 2.0) { o.phase = 'fade'; o.t = 0; }
      } else if (o.phase === 'magnet') {
        if (!me || me.down) { o.phase = 'fade'; o.t = 0; continue; }
        var d = dist(o.x, o.y, me.x, me.y);
        // 8→14 格/s ease-in lerp 吸附
        var k = Math.min(1, o.t / 0.35);
        var spd = lerp(8, 14, easeIn(k));
        var step2 = Math.min(d, spd * dt);
        o.x += (me.x - o.x) / (d || 1) * step2;
        o.y += (me.y - o.y) / (d || 1) * step2;
        if (d < 0.35) collectOrb(o, t);
        else if (o.t > 1.6) collectOrb(o, t);   // 吸太久强制结算，别留孤儿珠
      } else if (o.phase === 'fade') {
        if (o.t > 0.4) S.orbs.splice(i, 1);     // 他人视角无磁吸：2s 消散
      }
    }
    // 同窗结算合并飘字：'+37' 一条，而不是 '+3'×12
    if (S.orbMergeTxt && t - S.orbMergeAt > 0.25 && S.me) {
      capPush(S.texts, { x: S.me.x, y: S.me.y - 1.4, txt: S.orbMergeTxt, crit: 0, life: 1.0, max: 1.0, vy: -1.1, vx: 0.15, gold: 1 }, 60);
      S.orbMergeTxt = '';
    }
  }

  function collectOrb(o, t) {
    // 音效：80ms 窗口节流 1 次；连吸计数 pitch +1 半音封顶 +7（coin/gold 基音）
    if (t - (S.orbSfxAt || 0) >= 0.08) {
      S.orbSfxAt = t;
      if (t - (S.orbStreakAt || 0) > 1.0) S.orbStreak = 0;
      S.orbStreakAt = t;
      var semi = Math.min(7, S.orbStreak);
      auSfx(o.pouch || o.v > 15 ? 'gold' : 'coin', 0.26, Math.pow(2, semi / 12));
      S.orbStreak++;
    }
    if (o.mat) {
      capPush(S.texts, { x: o.x, y: o.y - 0.8, txt: '材料 +' + o.v, crit: 0, life: 0.8, max: 0.8, vy: -0.8, vx: -0.1, small: 1 }, 60);
    } else if (o.pouch) {
      capPush(S.texts, { x: o.x, y: o.y - 0.9, txt: '+' + o.v, crit: 1, life: 1.1, max: 1.1, vy: -1.2, vx: 0, gold: 1 }, 60);
    } else {
      // 合并窗口：普通珠的数值攒起来一次飘
      S.orbMergeTxt = (S.orbMergeTxt ? S.orbMergeTxt.replace('+', '') : '');
      S.orbMergeTxt = '+' + ((parseInt(S.orbMergeTxt, 10) || 0) + (o.v || 1));
      S.orbMergeAt = t;
    }
    var idx = S.orbs.indexOf(o);
    if (idx >= 0) S.orbs.splice(idx, 1);
  }

  function drawOrbs(ctx) {
    var u = TILE * S.zoom;
    for (var i = 0; i < S.orbs.length; i++) {
      var o = S.orbs[i];
      var x = w2sX(o.x * TILE), y = w2sY(o.y * TILE + TILE * 0.5);
      var fade = o.phase === 'fade' ? 1 - o.t / 0.4 : 1;
      ctx.save();
      ctx.globalAlpha = Math.max(0, Math.min(1, fade));
      // 底部小接触影
      ctx.fillStyle = 'rgba(0,0,0,0.18)';
      ctx.beginPath();
      ctx.ellipse(x, y, u * 0.16, u * 0.05, 0, 0, 6.2832);
      ctx.fill();
      if (o.pouch) {
        drawGlyphWorld(ctx, GLYPH.pouch, x, y - u * 0.12, u * 0.052, { '#': '#b98a3a', 'o': '#e8c060', '+': '#8a5f26' });
      } else if (o.mat) {
        drawGlyphWorld(ctx, GLYPH.mat, x, y - u * 0.1, u * 0.04, { '#': farmItemColorSafe(o.mat), 'o': '#ffffff' });
      } else {
        var T2 = ORB_TIER[o.tier];
        drawGlyphWorld(ctx, ORB_GLYPH[T2.g], x, y - u * (0.08 + o.tier * 0.03), u * T2.cell, { '#': T2.col, 'o': T2.hi });
      }
      ctx.restore();
    }
  }
  function farmItemColorSafe(id) {
    try { return farmItemColor(id) || '#c8b48a'; } catch (e) { return '#c8b48a'; }
  }

  // ---- 尸体：三帧 1.4s，精英金环加强、Boss ring 2.4u + shake ----
  function spawnCorpse(m) {
    if (!S.corpses) S.corpses = [];
    capPush(S.corpses, {
      x: m.rx || m.x, y: m.ry || m.y, kind: m.kind, elite: m.elite, boss: m.boss,
      face: m.face || 'r', scale: m.scale || 2.6, t: 0
    }, 24);
  }
  function updateCorpses(dt) {
    for (var i = S.corpses.length - 1; i >= 0; i--) {
      var c = S.corpses[i];
      c.t += dt;
      if (c.t > 1.4) S.corpses.splice(i, 1);
    }
  }
  function drawCorpses(ctx) {
    var u = TILE * S.zoom;
    for (var i = 0; i < S.corpses.length; i++) {
      var c = S.corpses[i];
      var shake = c.boss && c.t < 0.3 ? (Math.random() - 0.5) * 3 : 0;
      var x = w2sX(c.x * TILE) + shake, y = w2sY(c.y * TILE + TILE * 0.5);
      var alpha = c.t < 1.0 ? 1 : Math.max(0, 1 - (c.t - 1.0) / 0.4);
      // 三帧：倒下 → 压扁 → 淡出（用同一帧三种姿态近似）
      var fr2 = c.t < 0.25 ? 0.2 : (c.t < 0.7 ? 0.45 : 0.7);
      ctx.save();
      ctx.globalAlpha = alpha * 0.9;
      ctx.translate(x, y);
      ctx.rotate(Math.PI / 2);
      var name = MOB_SPRITE[c.kind] || 'mon_Slime';
      var f = FR[name];
      if (f) {
        var sc = (MOB_SIZE[c.kind] || 1) * (c.elite ? 1.1 : 1);
        var w2 = f[4] * S.zoom * sc, h2 = f[5] * S.zoom * sc;
        ctx.drawImage(S.atlas, f[0], f[1], f[4], f[5], -w2 * (1 - fr2 * 0.6) / 2, -h2 * fr2 / 2, w2 * (1 - fr2 * 0.6), h2 * fr2);
      }
      ctx.restore();
      if (c.boss) {
        ctx.fillStyle = 'rgba(255,120,90,0.35)';
        ctx.beginPath();
        ctx.ellipse(x, y + u * 0.2, u * 2.4, u * 0.6, 0, 0, 6.2832);
        ctx.fill();
      } else if (c.elite) {
        ctx.fillStyle = 'rgba(255,210,110,0.5)';
        ctx.beginPath();
        ctx.ellipse(x, y + u * 0.18, u * 0.7, u * 0.22, 0, 0, 6.2832);
        ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.85)';
        ctx.fillRect(px(x - 1), px(y - 2), 2, 2);
        ctx.fillRect(px(x + 4), px(y + 1), 2, 2);
      }
    }
  }

  // ---- 装备光柱：四档底圈 + 3 段阶梯光柱 + 3 帧浮动 ----
  var PILLAR_COL = ['#c8bca8', '#8fd06a', '#6fb6ff', '#c07bff', '#ffb84a'];
  function spawnPillar(bx, by, rarity) {
    if (!S.pillars) S.pillars = [];
    capPush(S.pillars, {
      x: (bx == null ? (S.me ? S.me.x : 0) : bx + 0.5),
      y: (by == null ? (S.me ? S.me.y : 0) : by + 0.5),
      rarity: rarity || 0, t: 0
    }, 12);
  }
  function updatePillars(dt) {
    for (var i = S.pillars.length - 1; i >= 0; i--) {
      var p = S.pillars[i];
      p.t += dt;
      if (p.t > 2.2) S.pillars.splice(i, 1);
    }
  }
  function drawPillars(ctx) {
    var u = TILE * S.zoom;
    for (var i = 0; i < S.pillars.length; i++) {
      var p = S.pillars[i];
      var col = PILLAR_COL[Math.min(4, p.rarity)] || PILLAR_COL[0];
      var x = w2sX(p.x * TILE), y = w2sY(p.y * TILE + TILE * 0.5);
      var bob = Math.floor(p.t * 3) % 3;                 // 3 帧浮动
      var fade = p.t < 1.6 ? 1 : Math.max(0, 1 - (p.t - 1.6) / 0.6);
      ctx.save();
      ctx.globalAlpha = 0.75 * fade;
      // 底圈：稀有度越高越宽
      ctx.strokeStyle = col;
      ctx.lineWidth = Math.max(2, u * 0.08);
      ctx.beginPath();
      ctx.ellipse(x, y, u * (0.4 + p.rarity * 0.08), u * (0.13 + p.rarity * 0.03), 0, 0, 6.2832);
      ctx.stroke();
      // 3 段阶梯光柱
      var seg = [0.9, 0.62, 0.38];
      ctx.fillStyle = col;
      for (var s2 = 0; s2 < 3; s2++) {
        var wseg = u * seg[s2] * (0.8 + p.rarity * 0.1);
        var yy = y - u * (0.5 + s2 * 0.55) - bob * 2;
        ctx.globalAlpha = (0.5 - s2 * 0.12) * fade;
        ctx.fillRect(px(x - wseg / 2), px(yy), px(wseg), px(u * 0.42));
      }
      ctx.restore();
    }
  }

  function drawFx(dt) {
    var ctx = S.ctx;
    // 冲击环
    for (var i = S.rings.length - 1; i >= 0; i--) {
      var r = S.rings[i];
      r.life -= dt;
      if (r.life <= 0) { S.rings.splice(i, 1); continue; }
      var k = 1 - r.life / r.max2;
      ctx.save();
      ctx.globalAlpha = (1 - k) * 0.9;
      ctx.strokeStyle = r.col;
      ctx.lineWidth = 3 * (1 - k) + 1;
      ctx.beginPath();
      ctx.arc(w2sX(r.x * TILE), w2sY(r.y * TILE), k * r.max * TILE * S.zoom * 0.7, 0, 6.2832);
      ctx.stroke();
      ctx.restore();
    }
    // 光束
    for (var j = S.beams.length - 1; j >= 0; j--) {
      var b = S.beams[j];
      b.life -= dt;
      if (b.life <= 0) { S.beams.splice(j, 1); continue; }
      var k2 = b.life / b.max;
      ctx.save();
      ctx.globalAlpha = k2;
      var x0 = w2sX(b.x * TILE), y0 = w2sY(b.y * TILE);
      var x1 = w2sX((b.x + b.dx * b.len) * TILE), y1 = w2sY((b.y + b.dy * b.len) * TILE);
      var g = ctx.createLinearGradient(x0, y0, x1, y1);
      g.addColorStop(0, 'rgba(255,255,255,0.95)');
      g.addColorStop(1, 'rgba(160,220,255,0)');
      ctx.strokeStyle = g;
      ctx.lineWidth = 4 * S.zoom / 3 * k2;
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.stroke();
      ctx.restore();
    }
    // 粒子
    for (var p = S.parts.length - 1; p >= 0; p--) {
      var q = S.parts[p];
      q.life -= dt;
      if (q.life <= 0) { S.parts.splice(p, 1); continue; }
      q.x += q.vx * dt;
      q.y += q.vy * dt;
      q.vy += 6 * dt;
      var a = q.life / q.max;
      ctx.fillStyle = q.col.indexOf('rgba') === 0 ? q.col + a.toFixed(2) + ')' : hexA(q.col, a);
      ctx.fillRect(px(w2sX(q.x * TILE)), px(w2sY(q.y * TILE)), Math.max(1, q.r * S.zoom / 3), Math.max(1, q.r * S.zoom / 3));
    }
    // 飘字
    for (var t2 = S.texts.length - 1; t2 >= 0; t2--) {
      var tx = S.texts[t2];
      tx.life -= dt;
      if (tx.life <= 0) { S.texts.splice(t2, 1); continue; }
      tx.x += tx.vx * dt;
      tx.y += tx.vy * dt;
      tx.vy += 2.4 * dt;
      var k3 = tx.life / tx.max;
      var fs = (tx.crit ? 15 : 11) * (S.zoom / 3) * (0.7 + 0.3 * k3) * (tx.big ? 1.5 : 1);
      ctx.save();
      ctx.globalAlpha = Math.min(1, k3 * 2);
      ctx.font = 'bold ' + Math.round(fs) + 'px "SG5Pixel",monospace';
      ctx.textAlign = 'center';
      var sx2 = w2sX(tx.x * TILE), sy2 = w2sY(tx.y * TILE);
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillText(tx.txt, sx2 + 1, sy2 + 1);
      ctx.fillStyle = tx.col || (tx.crit ? '#ffd36a' : '#ffffff');
      ctx.fillText(tx.txt, sx2, sy2);
      if (tx.crit) {
        ctx.font = 'bold ' + Math.round(fs * 0.5) + 'px "SG5Pixel",monospace';
        ctx.fillStyle = '#ffb0a0';
        ctx.fillText('暴击', sx2, sy2 - fs * 0.85);
      }
      ctx.restore();
    }
  }

  // 阴影/排序：把要画的东西按脚底 y 排一遍
  function buildDrawList(vr) {
    DRAW.length = 0;
    var i, m;
    for (i = 0; i < PROPS.length; i++) {
      var p = PROPS[i];
      DRAW.push({ y: (p.y + 1) * TILE, kind: 'prop', ref: p });
    }
    // 房子
    var houses = S.map.town.houses;
    for (i = 0; i < houses.length; i++) {
      var h = houses[i];
      // 排序锚点是「墙脚」，不是占地南缘 —— 正面墙往下长了 1.18 格，
      // 站在门口的人必须画在这面墙之后（贴着门），站在屋檐下的人要被墙挡住。
      DRAW.push({ y: (h.y + h.h + 1.18) * TILE, kind: 'house', ref: h });
    }
    // 灯塔
    for (var z in S.map.towers) {
      var tw = S.map.towers[z];
      DRAW.push({ y: (tw.y + 1) * TILE, kind: 'tower', ref: { z: z, x: tw.x, y: tw.y } });
    }
    // 传送石
    for (i = 0; i < S.map.waystones.length; i++) {
      var w = S.map.waystones[i];
      DRAW.push({ y: (w.y + 1) * TILE, kind: 'waystone', ref: w });
    }
    // 宝箱
    for (i = 0; i < S.map.chests.length; i++) {
      var c = S.map.chests[i];
      if (S.chests[c.id]) continue;
      DRAW.push({ y: (c.y + 1) * TILE, kind: 'chest', ref: c });
    }
    // 广场小物件
    var tp = townProps();
    for (i = 0; i < tp.length; i++) DRAW.push({ y: (tp[i].y + 0.4) * TILE, kind: 'townprop', ref: tp[i] });
    // 镇中央的灯
    if (S.map.town.lamp) {
      DRAW.push({ y: (S.map.town.lamp.y + 1) * TILE, kind: 'camp', ref: { x: S.map.town.lamp.x, y: S.map.town.lamp.y, big: 1 } });
    }
    // NPC
    for (i = 0; i < NPCS.length; i++) {
      var n = NPCS[i];
      DRAW.push({ y: (n.y + 0.6) * TILE, kind: 'npc', ref: n });
    }
    // 怪
    var ids = Object.keys(S.mobs);
    for (i = 0; i < ids.length; i++) {
      m = S.mobs[ids[i]];
      if (!m) continue;
      DRAW.push({ y: (m.ry + 0.5) * TILE, kind: 'mob', ref: m });
    }
    // 其他人
    for (var pid in S.players) {
      var pl = S.players[pid];
      DRAW.push({ y: (pl.y + 0.5) * TILE, kind: 'player', ref: pl });
    }
    // 我
    if (S.me) DRAW.push({ y: (S.me.y + 0.5) * TILE, kind: 'me', ref: S.me });
    DRAW.sort(function (a, b) { return a.y - b.y; });
  }

  function renderWorld(dt) {
    var ctx = S.ctx;
    var vr = viewRange();
    collectProps(vr);
    if (!S.dbgNoGround) drawGround(ctx, vr);
    if (!S.dbgNoGround) drawWater(ctx, vr, S.time);
    // 大结构的落影必须在实体之前：影子在地上，不能在站在前面的人身上
    drawStructureShadows(ctx, vr);
    drawCorpses(ctx);   // v5.6 W3：尸体贴地，画在所有站立实体之前
    buildDrawList(vr);
    for (var i = 0; i < DRAW.length; i++) {
      var d = DRAW[i];
      var r = d.ref;
      switch (d.kind) {
        case 'prop': drawProp(ctx, r); break;
        case 'house': drawHouse(ctx, r, S.time); break;
        case 'tower': drawTower(ctx, r.z, S.time); break;
        case 'waystone': drawWaystone(ctx, r, S.time); break;
        case 'chest': drawChest(ctx, r, S.time); break;
        case 'camp': drawCamp(ctx, r.x, r.y, S.time, r.big); break;
        case 'townprop': drawTownProp(ctx, r); break;
        case 'npc': drawNpc(ctx, r); break;
        case 'mob': drawMob(r); break;
        case 'player': drawPlayer(r, false); break;
        case 'me': drawPlayer(r, true); break;
      }
    }
    drawShots();
    drawPillars(ctx);   // v5.6 W3：装备光柱
    drawOrbs(ctx);      // v5.6 W3：磁吸星屑珠 / 材料簇 / 金币袋
    drawEmotes();
    drawSocialFx(ctx);
    drawFx(dt);
    if (!S.dbgNoNight) drawNight(ctx, S.view.w, S.view.h);
    if (!S.dbgNoAtmo) drawAtmosphere(ctx, S.view.w, S.view.h);
  }

  // 大气层：冷热分层 + 暗角。少了它，再好的像素画也像贴纸贴在屏幕上。
  function drawAtmosphere(ctx, w, h) {
    var g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, 'rgba(255,236,196,0.055)');
    g.addColorStop(0.5, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(10,16,38,0.16)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    var vg = ctx.createRadialGradient(w * 0.5, h * 0.46, Math.min(w, h) * 0.30,
      w * 0.5, h * 0.5, Math.max(w, h) * 0.74);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(0.75, 'rgba(0,0,0,0.10)');
    vg.addColorStop(1, 'rgba(0,0,0,0.34)');
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, w, h);
  }

  function drawNpc(ctx, n) {
    var x = w2sX(n.x * TILE), y = w2sY(n.y * TILE + TILE * 0.4);
    shadow(x, y + 4, 1);
    // NPC 也有呼吸，并且偶尔换个方向看 —— 街上有人才像镇子
    var idleY = y + Math.sin(S.time * 1.75 + n.x * 0.6) * 0.7;
    var idleFace = Math.sin(S.time * 0.27 + n.y) > 0.86 ? 3 : 0;
    drawCharacter(n.look, x, idleY, idleFace, false, 0, 1);
    // 头顶的交互小标
    var bob = Math.sin(S.time * 2.4) * 2;
    ctx.fillStyle = 'rgba(255,225,150,0.95)';
    ctx.beginPath();
    ctx.moveTo(x, y - 22 * (S.zoom / 4) + bob);
    ctx.lineTo(x - 3.5, y - 27 * (S.zoom / 4) + bob);
    ctx.lineTo(x + 3.5, y - 27 * (S.zoom / 4) + bob);
    ctx.closePath();
    ctx.fill();
    var fs = Math.round(7 * (S.zoom / 3)) + 2;
    ctx.font = 'bold ' + fs + 'px "SG5Pixel",monospace';
    ctx.textAlign = 'center';
    var ty2 = y - TILE * S.zoom - 3 + bob;
    var tw2 = ctx.measureText(n.name).width;
    ctx.fillStyle = 'rgba(8,12,22,0.62)';
    ctx.fillRect(x - tw2 / 2 - 3, ty2 - fs + 1, tw2 + 6, fs + 3);
    ctx.fillStyle = 'rgba(255,240,210,0.95)';
    ctx.fillText(n.name, x, ty2);
  }


  // ======================== 08_mobs.js ========================
  // ---------------- §14 实体同步（把服务端快照变成看得见的东西） ----------------
  // 服务端 5Hz 下发；客户端每帧插值。插值比直接赋值重要得多：200ms 一跳的怪物
  // 会像幻灯片，插值之后是连续移动 —— 手感全在这一层。
  function applyMobs(list) {
    var seen = {};
    for (var i = 0; i < list.length; i++) {
      var a = list[i];
      var id = a[0];
      seen[id] = 1;
      var m = S.mobs[id];
      if (!m) {
        m = S.mobs[id] = {
          id: id, kind: a[1], rx: a[2], ry: a[3], tx: a[2], ty: a[3],
          hp: a[4], maxHp: a[5], lv: a[6], state: a[7], faceAng: a[8],
          elite: !!a[9], boss: !!a[10], tellT: 0, tellMax: 0, moving: !!a[12],
          kx: 0, ky: 0, flash: 0, reg: 0
        };
        m.hpVis = a[4];
        m.bossZone = S.bossZoneOf && S.bossZoneOf[id];
        m.name = a[13] || '';
      } else {
        m.tx = a[2]; m.ty = a[3];
        if (a[4] < m.hp && m.hp - a[4] > 0) m.flash = 0.1;
        m.hp = a[4];
        m.maxHp = a[5];
        m.state = a[7];
        m.faceAng = a[8];
        m.moving = !!a[12];
        if (m.hpVis == null || m.hpVis > m.maxHp) m.hpVis = m.hp;
        if (a[13]) m.name = a[13];
        // 不掉血时血条慢慢追上真实值，避免「明明还有血却显示空」
        if (m.hpVis < m.hp) m.hpVis = m.hp;
      }
      // 前摇：服务端给剩余毫秒
      if (a[7] === 'tell' && a[11] > 0) {
        if (m.tellT <= 0) m.tellMax = a[11];
        m.tellT = a[11] / 1000;
      } else {
        m.tellT = 0;
      }
      m.arch = (m.kind === 'eye' || m.kind === 'frog' || m.kind === 'spirit2' || m.kind === 'dragon' ||
        m.kind === 'octopus' || m.kind === 'owl' || m.kind === 'snake' || m.kind === 'reptile' ||
        m.kind === 'beast') ? 'line' : 'arc';
      if (m.boss) m.arch = 'arc';
    }
    // 服务端没再下发的 → 已经死了或走远了
    for (var id2 in S.mobs) {
      if (!seen[id2]) {
        var mm = S.mobs[id2];
        if (mm && !mm.dying) { mm.dying = 0.25; killedFx(mm); }
        if (!mm || mm.dying <= 0) delete S.mobs[id2];
      }
    }
  }

  function killedFx(m) {
    auSfx('kill', 0.3, 1 + Math.random() * 0.2);
    burst(m.x, m.y - 0.2, 8, '#ffd8b0', 3.4);
  }

  function updateMobs(dt, t) {
    var ids = Object.keys(S.mobs);
    for (var i = ids.length - 1; i >= 0; i--) {
      var m = S.mobs[ids[i]];
      if (!m) continue;
      // 位置插值（快照 5Hz，这里 60Hz 平滑）
      var k = Math.min(1, dt * 11);
      m.rx += (m.tx - m.rx) * k;
      m.ry += (m.ty - m.ry) * k;
      // 击退位移衰减（纯表现，不影响服务端位置）
      if (m.kx) { m.rx += m.kx * dt; m.kx *= Math.max(0, 1 - dt * 9); }
      if (m.ky) { m.ry += m.ky * dt; m.ky *= Math.max(0, 1 - dt * 9); }
      m.x = m.rx; m.y = m.ry;
      // 朝向：只在动的时候更新，站定时保持
      if (Math.abs(m.tx - m.rx) + Math.abs(m.ty - m.ry) > 0.05) {
        m.face = (m.tx - m.rx) < 0 ? 'l' : 'r';
      }
      if (m.faceAng != null) {
        var fx = Math.cos(m.faceAng);
        if (Math.abs(fx) > 0.25) m.face = fx < 0 ? 'l' : 'r';
      }
      m.flash = Math.max(0, m.flash - dt);
      m.shakeT = Math.max(0, (m.shakeT || 0) - dt);
      m.tellT = Math.max(0, (m.tellT || 0) - dt);
      if (m.dying != null) {
        m.dying -= dt;
        if (m.dying <= 0) { spawnCorpse(m); delete S.mobs[ids[i]]; continue; }
      }
      // 完美闪避：怪物的出招在「我无敌」的窗口里落下
      // v5.6 W4 s4 见切：判定窗口 ×1.6（220ms → 352ms），成功瞬间 0.15s 白边闪光
      if (m.state === 'act' && m.prevState !== 'act') {
        var me = S.me;
        if (me && !me.down) {
          var d = dist(me.x, me.y, m.rx, m.ry);
          if (d < (m.boss ? 4.2 : 3.0)) {
            var pw = me.pwBonus || 0;
            if (t < me.invUntil + pw) perfectDodge(t, m);
            else hurtFlash();
          }
        }
      }
      m.prevState = m.state;
      // 血条追赶
      if (m.hpVis != null && m.hpVis > m.hp) m.hpVis = Math.max(m.hp, m.hpVis - m.maxHp * dt * 1.6);
    }
  }

  function perfectDodge(t, m) {
    var me = S.me;
    if (me.perfectAt && t - me.perfectAt < 0.6) return;
    me.perfectAt = t;
    me.critReady = 1;
    // v5.6 W4：s4 见切 —— 子弹时间 ×1.6 + 白边闪光
    var s4 = me.talentShadowLv >= 4;
    S.slow = { until: t + (s4 ? 0.67 : 0.42), scale: 0.3 };
    S.pdFlashUntil = t + 0.15;
    // v5.6 W4：s5 影袭 —— 瞬移到目标背后 0.8 格（复用 dodge 残影），下一击暴击紫色
    if (m && me.talentShadowLv >= 5) {
      var ang = m.faceAng || 0;
      var nx = m.rx - Math.cos(ang) * 0.8, ny = m.ry - Math.sin(ang) * 0.8;
      if (!blockedAt(nx, ny)) {
        me.x = nx; me.y = ny;
        me.shadowStrike = 1;
      }
    }
    S.cam.shake = Math.max(S.cam.shake, 3);
    S.rings.push({ x: me.x, y: me.y, r: 0, max: 2.4, life: 0.45, max2: 0.45, col: '#bfe8ff' });
    S.texts.push({ x: me.x, y: me.y - 1.4, txt: '完美闪避', crit: 0, life: 0.9, max: 0.9, vy: -1.1, vx: 0, perfect: 1 });
    burst(me.x, me.y, 6, '#bfe8ff', 3.6);   // 残影
    auSfx('secret', 0.42, 1.15);
  }

  function hurtFlash() {
    var me = S.me;
    if (!me || S.time < me.invUntil) return;
    S.hurtT = 0.28;
    S.cam.shake = Math.max(S.cam.shake, 3.2);
    auSfx('hit2', 0.36, 0.8);
  }

  function applyPlayers(list) {
    var seen = {};
    for (var i = 0; i < list.length; i++) {
      var a = list[i];
      var id = a[0];
      if (id === S.myId) continue;
      seen[id] = 1;
      var p = S.players[id];
      if (!p) {
        S.players[id] = {
          id: id, name: a[1], x: a[2], y: a[3], tx: a[2], ty: a[3], face: 0,
          look: a[5] || 'NinjaBlue', hp: a[6], maxHp: a[7], down: !!a[8], lv: a[9],
          moving: !!a[10], animT: 0
        };
        continue;
      }
      p.tx = a[2]; p.ty = a[3];
      p.hp = a[6]; p.maxHp = a[7];
      p.down = !!a[8];
      p.lv = a[9];
      p.moving = !!a[10];
      if (a[5]) p.look = a[5];
      if (a[1]) p.name = a[1];
      var fx = a[4] || 0;
      p.face = playerFacing(Math.cos(fx), Math.sin(fx));
    }
    for (var id2 in S.players) if (!seen[id2]) delete S.players[id2];
  }

  function updatePlayers(dt) {
    for (var id in S.players) {
      var p = S.players[id];
      var k = Math.min(1, dt * 9);
      var d = Math.abs(p.tx - p.x) + Math.abs(p.ty - p.y);
      p.x += (p.tx - p.x) * k;
      p.y += (p.ty - p.y) * k;
      p.moving = d > 0.06 ? 1 : p.moving;
      p.animT = (p.animT || 0) + dt;
      if (p.face == null) p.face = 0;
    }
  }

  function applyShots(list) {
    var out = [];
    for (var i = 0; i < list.length; i++) {
      var a = list[i];
      var s = S.shotsById && S.shotsById[a[0]];
      if (!s) s = { id: a[0], rx: a[1], ry: a[2], vx: a[3], vy: a[4], kind: a[5], born: S.time };
      else { s.rx = a[1]; s.ry = a[2]; s.vx = a[3]; s.vy = a[4]; }
      out.push(s);
    }
    S.shots = out;
  }

  function updateShots(dt) {
    for (var i = 0; i < S.shots.length; i++) {
      var s = S.shots[i];
      // 快照之间按速度外推：光弹很快，不外推会「闪」
      s.rx += s.vx * dt * 0.85;
      s.ry += s.vy * dt * 0.85;
    }
  }


  // ======================== 09_ui_hud.js ========================
  // ---------------- §15 HUD ----------------
  // HUD 全是 DOM：数字要清晰、要能被主题影响。但视觉上它必须像「游戏里的木牌」，
  // 而不是网页卡片 —— 厚边、方角、点阵字、分段条。样式见 style.css 的 .sg5-frame。
  var UI = {};

  // 把图集里的一帧画进小 canvas（HUD 图标统一走这里，风格才一致）
  function iconCanvas(name, size) {
    var cv = document.createElement('canvas');
    cv.width = size; cv.height = size;
    cv.setAttribute('data-icon', name);
    paintIcon(cv, name, size);
    return cv;
  }
  function paintIcon(cv, name, size) {
    var g = cv.getContext('2d');
    g.imageSmoothingEnabled = false;
    g.clearRect(0, 0, size, size);
    if (name.indexOf('glyph:') === 0) { paintGlyph(g, name.slice(6), size); return; }
    var f = FR[name];
    if (!f || !S.atlas) return;
    var s = Math.min(size / f[4], size / f[5]);
    var w = Math.round(f[4] * s), h = Math.round(f[5] * s);
    var dx = Math.round((size - w) / 2), dy = Math.round((size - h) / 2);
    g.drawImage(S.atlas, f[0], f[1], f[4], f[5], dx, dy, w, h);
    // 素材里有一部分帧用「品红」当透明底。不去掉的话图标会顶着一块洋红。
    // v5.6：阈值放宽 g<110，且边缘 1px 再抠一轮 —— 抗锯齿边上的残粉也要清掉。
    try {
      var img = g.getImageData(dx, dy, w, h);
      var d = img.data;
      for (var pass = 0; pass < 2; pass++) {
        for (var i = 0; i < d.length; i += 4) {
          if (d[i + 3] === 0) continue;
          if (d[i] > 190 && d[i + 2] > 190 && d[i + 1] < 110) { d[i + 3] = 0; continue; }
          if (pass === 1) {
            // 第二轮只处理「贴着透明像素」的边缘残粉
            var px2 = (i / 4) % w, py2 = Math.floor(i / 4 / w);
            var edge = (px2 > 0 && d[(i - 4) + 3] === 0) || (px2 < w - 1 && d[i + 7] === 0) ||
              (py2 > 0 && d[i - w * 4 + 3] === 0) || (py2 < h - 1 && d[i + w * 4 + 3] === 0);
            if (edge && d[i] > 170 && d[i + 2] > 170 && d[i + 1] < 130) d[i + 3] = 0;
          }
        }
      }
      g.putImageData(img, dx, dy);
    } catch (e) {}
  }

  // 程序化像素字形：图集里没有的图标（齿轮 / 手 / 靴子）用 1px 方格拼出来，
  // 和素材的风格一致，也不用再往包里塞图。
  var GLYPH = {
    gear: [
      '..##..##..',
      '..######..',
      '.########.',
      '.###..###.',
      '####..####',
      '####..####',
      '.###..###.',
      '.########.',
      '..######..',
      '..##..##..'
    ],
    // 剑：竖刃 + 十字护手 + 柄，12×14，38px 下也一眼能认出
    sword: [
      '.....##.....',
      '....####....',
      '....####....',
      '....####....',
      '....####....',
      '....####....',
      '....####....',
      '..########..',
      '....####....',
      '.....##.....',
      '.....##.....',
      '.....##.....',
      '....####....',
      '.....##.....'
    ],
    lance: [
      '.........##.',
      '........####',
      '.......####.',
      '......####..',
      '.....####...',
      '....####....',
      '...####.....',
      '..####......',
      '.##.........',
      '##..........'
    ],
    twin: [
      '..##....##..',
      '..##....##..',
      '..##....##..',
      '..##....##..',
      '...##..##...',
      '....####....',
      '.....##.....',
      '....####....',
      '...##..##...',
      '..##....##..'
    ],
    staff: [
      '.....###....',
      '....#####...',
      '...###.###..',
      '....#####...',
      '.....###....',
      '......#.....',
      '......#.....',
      '......#.....',
      '......#.....',
      '......#.....'
    ],
    hammer: [
      '...######...',
      '...######...',
      '...######...',
      '......#.....',
      '......#.....',
      '......#.....',
      '......#.....',
      '......#.....',
      '......#.....',
      '......#.....'
    ],
    // 翻滚：一个侧翻的弧线 + 箭头（读作「往那边滚」）
    roll: [
      '...#####....',
      '..##...##...',
      '.##.....##..',
      '.##.........',
      '.##.........',
      '.##.....##..',
      '..##...##...',
      '...#####..##',
      '..........##',
      '..........#.'
    ],
    // 好友：两个并排的小人（一眼看出「一起玩」，而不是一颗心）
    friend: [
      '..###..###..',
      '.#####.#####',
      '..###..###..',
      '...##...##..',
      '.##########.',
      '.##########.',
      '..##.....##.',
      '.####...####',
      '.####...####'
    ],
    // v5.5 彩蛋节：蛋形（'#' 蛋壳 / 'o' 高光 / '+' 花斑）与彩券（'#' 票身 / 'o' 打孔线，两侧缺齿）
    egg: [
      '....####....',
      '...######...',
      '..########..',
      '.##########.',
      '.##oooooo##.',
      '.#oo++++oo#.',
      '.#oooooooo#.',
      '.#o+oo+ooo#.',
      '.#oooooooo#.',
      '..########..',
      '............',
      '............'
    ],
    ticket: [
      '............',
      '.####o#####.',
      '.####o#####.',
      '..###o#####.',
      '.####o#####.',
      '.####o#####.',
      '..###o#####.',
      '.####o#####.',
      '.####o#####.',
      '............',
      '............',
      '............'
    ],
    // ---- v5.6 W3 奖励实体层（世界层渲染用，07_entity.drawGlyphWorld） ----
    mat: [
      '..####..',
      '.######.',
      '########',
      '#o####o#',
      '########',
      '.######.',
      '..####..',
      '........'
    ],
    pouch: [
      '.#########.',
      '###########',
      '##o#####o##',
      '###+###o###',
      '###########',
      '##o##o#####',
      '###########',
      '.#########.',
      '..#######..',
      '...........'
    ],
    // ---- v5.6 W2 图标 GLYPH 化：矿石 / 宝石 / 煤 / 木材 / 石头 / 奶瓶 / 毛球 / 作物 / 资材 ----
    ore: [
      '....##....',
      '...####...',
      '..######..',
      '.##o####o.',
      '##########',
      '.###oo###.',
      '..######..',
      '...####...',
      '....##....',
      '..........'
    ],
    gem: [
      '...####...',
      '..+####+..',
      '.++####++.',
      '##########',
      '.########.',
      '..######..',
      '...####...',
      '....##....',
      '..........',
      '..........'
    ],
    coal: [
      '..........',
      '..##..##..',
      '.########.',
      '##########',
      '##o####o##',
      '##########',
      '.########.',
      '..##..##..',
      '..........',
      '..........'
    ],
    wood_log: [
      '..........',
      '..######..',
      '.#o####o#.',
      '##########',
      '#o##oo##o#',
      '#o##oo##o#',
      '##########',
      '.#o####o#.',
      '..######..',
      '..........'
    ],
    stone_round: [
      '..........',
      '...####...',
      '..######..',
      '.########.',
      '##########',
      '##o####o##',
      '.########.',
      '..######..',
      '...####...',
      '..........'
    ],
    milk_bottle: [
      '...####...',
      '...####...',
      '..######..',
      '.########.',
      '.########.',
      '.#oooooo#.',
      '.#oooooo#.',
      '.########.',
      '..######..',
      '..........'
    ],
    wool: [
      '..........',
      '..##..##..',
      '.########.',
      '##o####o##',
      '##########',
      '##o####o##',
      '.########.',
      '..##..##..',
      '..........',
      '..........'
    ],
    crop_round: [
      '..........',
      '...####...',
      '..######..',
      '.########.',
      '##########',
      '##########',
      '.##oo####.',
      '..######..',
      '...##.....',
      '..........'
    ],
    crop_long: [
      '..........',
      '.....##...',
      '....####..',
      '...######.',
      '..########',
      '..########',
      '..#######.',
      '...#####..',
      '....##....',
      '..........'
    ],
    crop_cluster: [
      '..##..##..',
      '.####.####',
      '.####.####',
      '..##..##..',
      '....##....',
      '..######..',
      '.########.',
      '..######..',
      '...####...',
      '..........'
    ],
    crop_melon: [
      '..........',
      '...######.',
      '..########',
      '.#########',
      '.#########',
      '.#########',
      '..#######.',
      '...#####..',
      '....###...',
      '..........'
    ],
    flask: [
      '...####...',
      '...####...',
      '...####...',
      '..######..',
      '.########.',
      '.########.',
      '.#oooooo#.',
      '.#oooooo#.',
      '.########.',
      '..######..'
    ],
    bale: [
      '..........',
      '..######..',
      '.########.',
      '##o#o#o###',
      '##########',
      '###o#o#o##',
      '##########',
      '.########.',
      '..######..',
      '..........'
    ],
    sprinkler: [
      '....##....',
      '..#o##o#..',
      '.#.o##o.#.',
      '..#o##o#..',
      '....##....',
      '...####...',
      '..######..',
      '.########.',
      '..######..',
      '..........'
    ]
  };

  // v5.4：palette 是「字符→颜色」映射（o/+/-/# 键）。不传时行为与旧版逐字节一致：
  // 只画 '#'，按行高取三档金属色；传了才把登记过的字符按映射色画出来。
  function paintGlyph(g, kind, size, palette) {
    var rows = GLYPH[kind];
    if (!rows) return;
    var h = rows.length, w = rows[0].length;
    var s = Math.max(1, Math.floor(size / (w + 2)));
    var ox = Math.round((size - w * s) / 2), oy = Math.round((size - h * s) / 2);
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var ch = rows[y].charAt(x);
        if (ch !== '#') {
          if (palette && palette[ch]) {
            g.fillStyle = palette[ch];
            g.fillRect(ox + x * s, oy + y * s, s, s);
          }
          continue;
        }
        var tone = palette && palette['#'] ? palette['#']
          : (y < h * 0.45 ? '#e8dcc0' : (y < h * 0.75 ? '#b9a988' : '#8b7c60'));
        g.fillStyle = tone;
        g.fillRect(ox + x * s, oy + y * s, s, s);
      }
    }
  }

  function uiBuild(root) {
    var hud = el('div', 'sg5-hud');
    root.appendChild(hud);
    UI.hud = hud;

    // ---- 左上 角色牌 ----
    var status = el('div', 'sg5-status sg5-frame');
    var face = el('div', 'sg5-face');
    var faceCv = document.createElement('canvas');
    faceCv.width = 52; faceCv.height = 52;
    faceCv.className = 'sg5-facecv';
    face.appendChild(faceCv);
    UI.faceCv = faceCv;
    status.appendChild(face);
    var bars = el('div', 'sg5-bars');
    var nameRow = el('div', 'sg5-namerow');
    UI.nameEl = el('span', 'sg5-name', '旅人');
    UI.lvEl = el('span', 'sg5-lv', 'Lv.1');
    nameRow.appendChild(UI.nameEl);
    nameRow.appendChild(UI.lvEl);
    bars.appendChild(nameRow);
    UI.hpBar = bar('hp', bars);
    UI.mpBar = bar('mp', bars);
    UI.xpBar = bar('xp', bars);
    status.appendChild(bars);
    hud.appendChild(status);

    // ---- 右上 小地图 + 日晷 ----
    var tr = el('div', 'sg5-topright');
    var mini = el('div', 'sg5-mini sg5-frame');
    var miniCv = document.createElement('canvas');
    miniCv.width = 124; miniCv.height = 124;
    miniCv.className = 'sg5-minicv';
    mini.appendChild(miniCv);
    mini.appendChild(el('div', 'sg5-compass', 'N'));
    UI.miniCv = miniCv;
    UI.miniCtx = miniCv.getContext('2d');
    UI.zoneLabel = el('div', 'sg5-zonelabel', '拾光镇');
    mini.appendChild(UI.zoneLabel);
    tr.appendChild(mini);

    var clock = el('div', 'sg5-clock sg5-frame');
    UI.phaseEl = el('div', 'sg5-phase', '白天');
    UI.clockEl = el('div', 'sg5-ctime', '12:00');
    UI.shardEl = el('div', 'sg5-shards');
    var coin = document.createElement('canvas');
    coin.width = 16; coin.height = 16;
    coin.className = 'sg5-ic';
    coin.setAttribute('data-icon', 'it_coin');
    UI.coinCv = coin;
    UI.shardEl.appendChild(coin);
    UI.shardTxt = el('span', null, '0');
    UI.shardEl.appendChild(UI.shardTxt);
    clock.appendChild(UI.phaseEl);
    clock.appendChild(UI.clockEl);
    clock.appendChild(UI.shardEl);
    tr.appendChild(clock);
    hud.appendChild(tr);

    // ---- 顶部 区域名 + 目标 ----
    UI.zoneEl = el('div', 'sg5-zone', '拾光镇');
    hud.appendChild(UI.zoneEl);
    UI.goalEl = el('div', 'sg5-goal');
    hud.appendChild(UI.goalEl);

    // ---- Boss 血条 ----
    var boss = el('div', 'sg5-boss sg5-frame');
    UI.bossName = el('div', 'sg5-bossname', '');
    var bb = el('div', 'sg5-bossbar');
    UI.bossFill = el('i');
    bb.appendChild(UI.bossFill);
    boss.appendChild(UI.bossName);
    boss.appendChild(bb);
    UI.bossEl = boss;
    hud.appendChild(boss);

    // ---- 队伍 ----
    UI.partyEl = el('div', 'sg5-party');
    hud.appendChild(UI.partyEl);

    // ---- 潮汐横幅 ----
    var tide = el('div', 'sg5-tide sg5-frame');
    UI.tideName = el('div', 'sg5-tide-name', '');
    UI.tideSub = el('div', 'sg5-tide-sub', '');
    tide.appendChild(UI.tideName);
    tide.appendChild(UI.tideSub);
    UI.tideEl = tide;
    hud.appendChild(tide);

    // ---- 摇杆 ----
    var joy = el('div', 'sg5-joy');
    var knob = el('div', 'sg5-knob');
    joy.appendChild(knob);
    hud.appendChild(joy);
    UI.joy = joy;

    // ---- 动作键 ----
    var acts = el('div', 'sg5-actions');
    UI.btnAtk = actionBtn(acts, 'attack', 'glyph:sword', '攻击', 'J', 40);
    UI.btnRoll = actionBtn(acts, 'roll', 'glyph:roll', '翻滚', 'K', 30);
    UI.btnSkill = actionBtn(acts, 'skill', 'fx_energy', '技能', 'L', 28);
    UI.btnUse = actionBtn(acts, 'use', 'it_key', '交互', 'E', 24);
    UI.skillCd = el('i', 'sg5-cd');
    UI.btnSkill.appendChild(UI.skillCd);
    hud.appendChild(acts);

    // ---- 底部功能槽 ----
    var dock = el('div', 'sg5-dock');
    dockBtn(dock, 'char', 'face_NinjaBlue', '角色', 'C');
    dockBtn(dock, 'bag', 'it_chest', '装备', 'B');
    dockBtn(dock, 'map', 'obj_ScrollEmpty', '地图', 'M');
    dockBtn(dock, 'dex', 'obj_Letter', '怪物图鉴', 'V');
    dockBtn(dock, 'talent', 'it_heart', '天赋', 'T');
    dockBtn(dock, 'social', 'glyph:friend', '一起玩', 'F');
    dockBtn(dock, 'help', 'glyph:gear', '设置', 'Esc');
    hud.appendChild(dock);
    UI.dock = dock;

    // ---- toast / feed ----
    UI.toastEl = el('div', 'sg5-toast');
    hud.appendChild(UI.toastEl);
    UI.feedEl = el('div', 'sg5-feed');
    hud.appendChild(UI.feedEl);

    // ---- 面板容器 ----
    UI.panelWrap = el('div', 'sg5-panels');
    hud.appendChild(UI.panelWrap);

    // ---- 死亡 ----
    var dead = el('div', 'sg5-dead');
    dead.appendChild(el('div', 'sg5-dead-title', '你倒下了'));
    dead.appendChild(el('div', 'sg5-dead-sub', '长夜没有结束 —— 回到灯边，再来一次。'));
    var rbtn = el('button', 'sg5-dead-btn', '在拾光镇醒来');
    rbtn.type = 'button';
    rbtn.addEventListener('click', function () { apiRespawn(); }, false);
    dead.appendChild(rbtn);
    UI.deadEl = dead;
    hud.appendChild(dead);

    // ---- 章节卡 ----
    var ch = el('div', 'sg5-chapter');
    UI.chTitle = el('div', 'sg5-ch-title', '');
    UI.chText = el('div', 'sg5-ch-text', '');
    ch.appendChild(UI.chTitle);
    ch.appendChild(UI.chText);
    UI.chEl = ch;
    hud.appendChild(ch);

    bindButtons(acts, dock);
  }

  function bar(kind, parent) {
    var w = el('div', 'sg5-bar sg5-bar-' + kind);
    var fill = el('i');
    var txt = el('span', 'sg5-bartxt', '');
    w.appendChild(fill);
    w.appendChild(txt);
    parent.appendChild(w);
    return { wrap: w, fill: fill, txt: txt };
  }

  function actionBtn(parent, name, icon, label, key, size) {
    var b = el('button', 'sg5-act sg5-act-' + name);
    b.type = 'button';
    b.setAttribute('data-act', name);
    b.appendChild(iconCanvas(icon, size));
    b.appendChild(el('span', 'sg5-actkey', key));
    b.setAttribute('aria-label', label);
    parent.appendChild(b);
    return b;
  }

  function dockBtn(parent, name, icon, label, key) {
    var b = el('button', 'sg5-dockbtn');
    b.type = 'button';
    b.setAttribute('data-panel', name);
    b.setAttribute('data-focus-key', 'dock:' + name);
    b.appendChild(iconCanvas(icon, 24));
    b.appendChild(el('span', 'sg5-dockkey', key));
    b.setAttribute('title', label + '（' + key + '）');
    // 读屏名别只念一个字母的 sg5-dockkey，把标签和键位一起念出来
    b.setAttribute('aria-label', label + '（' + key + '）');
    parent.appendChild(b);
    return b;
  }

  function bindButtons(acts, dock) {
    function press(name, e) {
      if (name === 'attack') IN.attack = 1;
      else if (name === 'roll') IN.roll = 1;
      else if (name === 'skill') IN.skill = 1;
      else if (name === 'use') IN.use = 1;
      if (e && e.preventDefault) e.preventDefault();
      auResume();
    }
    var onDown = function (e) {
      var t = e.target;
      while (t && t !== acts && !t.getAttribute('data-act')) t = t.parentNode;
      if (!t || t === acts) return;
      press(t.getAttribute('data-act'), e);
    };
    acts.addEventListener('touchstart', onDown, { passive: false });
    acts.addEventListener('mousedown', onDown, false);

    var onDock = function (e) {
      var t = e.target;
      while (t && t !== dock && !t.getAttribute('data-panel')) t = t.parentNode;
      if (!t || t === dock) return;
      openPanel(t.getAttribute('data-panel'));
      e.preventDefault();
    };
    dock.addEventListener('click', onDock, false);
  }

  // ---- 数值刷新 ----
  function uiUpdate() {
    var me = S.me;
    if (!me) return;
    var hpF = clamp(me.hp / (me.maxHp || 1), 0, 1);
    var mpF = clamp((me.mp || 0) / (me.maxMp || 1), 0, 1);
    var xpF = clamp((me.xp || 0) / (me.xpNext || 1), 0, 1);
    UI.hpBar.fill.style.transform = 'scaleX(' + hpF.toFixed(3) + ')';
    UI.mpBar.fill.style.transform = 'scaleX(' + mpF.toFixed(3) + ')';
    UI.xpBar.fill.style.transform = 'scaleX(' + xpF.toFixed(3) + ')';
    setText(UI.hpBar.txt, Math.round(me.hp) + '/' + Math.round(me.maxHp));
    setText(UI.lvEl, 'Lv.' + (me.lv || 1));
    setText(UI.nameEl, me.name || '旅人');
    setText(UI.shardTxt, fmt(me.shards));

    var hh = Math.floor(S.pf * 24), mm = Math.floor((S.pf * 24 - hh) * 60);
    setText(UI.clockEl, pad2(hh) + ':' + pad2(mm));
    var pname = { day: '白天', dusk: '黄昏', night: '长夜', dawn: '黎明' }[S.phase] || '白天';
    setText(UI.phaseEl, pname);
    UI.phaseEl.className = 'sg5-phase sg5-phase-' + S.phase;
    setText(UI.zoneLabel, ZONE_NAMES[S.zone] || '拾光群岛');

    // 技能冷却遮罩（从下往上退）
    if (me.skillCdUntil && S.time < me.skillCdUntil) {
      var left = (me.skillCdUntil - S.time) / 6;
      UI.skillCd.style.height = (clamp(left, 0, 1) * 100).toFixed(0) + '%';
    } else if (UI.skillCd.style.height && UI.skillCd.style.height !== '0%') {
      UI.skillCd.style.height = '0%';
    }
    uiParty();
    uiTide();
  }

  function pad2(n) { return n < 10 ? '0' + n : String(n); }

  // ---- 队伍面板 ----
  function uiParty() {
    if (!UI.partyEl) return;
    var pt = S.party;
    if (!pt || !pt.members || pt.members.length < 2) {
      if (UI.partyEl.childNodes.length) clearNode(UI.partyEl);
      return;
    }
    clearNode(UI.partyEl);
    for (var i = 0; i < pt.members.length; i++) {
      var m = pt.members[i];
      if (m[0] === S.myId) continue;
      var row = el('div', 'sg5-pt' + (m[4] ? ' is-down' : ''));
      row.appendChild(el('span', 'sg5-pt-name', m[1]));
      var bar2 = el('div', 'sg5-pt-bar');
      var fill = el('i');
      fill.style.transform = 'scaleX(' + clamp(m[2] / (m[3] || 1), 0, 1).toFixed(3) + ')';
      bar2.appendChild(fill);
      row.appendChild(bar2);
      if (m[4]) row.appendChild(el('span', 'sg5-pt-tag', '倒地'));
      UI.partyEl.appendChild(row);
    }
  }

  // ---- 潮汐横幅 ----
  function uiTide() {
    if (!UI.tideEl) return;
    var t = S.tideInfo;
    if (!t) {
      if (UI.tideEl.className.indexOf('is-on') >= 0) UI.tideEl.className = 'sg5-tide sg5-frame';
      return;
    }
    var left = Math.max(0, Math.round((t.until - Date.now()) / 1000));
    UI.tideEl.className = 'sg5-tide sg5-frame is-on';
    setText(UI.tideName, '长夜潮汐 · ' + (ZONE_NAMES[t.zone] || t.zone));
    setText(UI.tideSub, '第 ' + (t.wave || 0) + ' 波 · 还剩 ' + pad2(Math.floor(left / 60)) + ':' + pad2(left % 60) + ' · 到场就有份');
  }

  // ---- toast ----
  var toastTimer = 0;
  function toast(text, kind) {
    if (!text || !UI.toastEl) return;
    // 读屏播报：普通提示是 status，警告是 alert（先设角色再换文本）
    UI.toastEl.setAttribute('role', kind === 'warn' ? 'alert' : 'status');
    UI.toastEl.setAttribute('aria-live', 'polite');
    UI.toastEl.textContent = text;
    UI.toastEl.className = 'sg5-toast is-on' + (kind ? ' sg5-toast-' + kind : '');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      UI.toastEl.className = 'sg5-toast';
    }, 1900);
  }

  // ---- 世界频道 ----
  function feedPush(text, kind) {
    S.feed.unshift({ text: text, kind: kind || '', at: Date.now() });
    if (S.feed.length > 6) S.feed.pop();
    renderFeed();
  }
  function renderFeed() {
    if (!UI.feedEl) return;
    clearNode(UI.feedEl);
    for (var i = 0; i < S.feed.length && i < 5; i++) {
      var f = S.feed[i];
      UI.feedEl.appendChild(el('div', 'sg5-feedrow' + (f.kind ? ' sg5-feed-' + f.kind : ''), f.text));
    }
  }

  function showZone(name) {
    if (!UI.zoneEl) return;
    UI.zoneEl.textContent = name;
    UI.zoneEl.className = 'sg5-zone is-in sg5-z-' + S.zone;
    setTimeout(function () {
      if (UI.zoneEl) UI.zoneEl.className = 'sg5-zone sg5-z-' + S.zone;
    }, 2600);
  }

  function uiGoal() {
    if (!UI.goalEl) return;
    var g = S.goal;
    if (!g) {
      UI.goalEl.textContent = '全部灯塔都亮了。长夜之心在等你。';
      UI.goalEl.className = 'sg5-goal is-done';
      return;
    }
    var me = S.me;
    var d = me ? Math.round(dist(me.x, me.y, g.x, g.y)) : 0;
    UI.goalEl.textContent = '点亮' + g.name + '的灯塔 · ' + d + ' 格 · 守护者：' + (g.boss || '未知');
    UI.goalEl.className = 'sg5-goal';
  }

  function showChapter(idx) {
    var c = CHAPTERS[idx];
    if (!c || !UI.chEl) return;
    UI.chTitle.textContent = c.title;
    UI.chText.textContent = c.text;
    UI.chEl.className = 'sg5-chapter is-on';
    auSfx('success', 0.5, 1);
    setTimeout(function () { UI.chEl.className = 'sg5-chapter'; }, 8000);   // v5.7：剧情变长，多留 2.8 秒
  }

  function drawFace(look) {
    var f = FR['face_' + look] || FR['face_NinjaBlue'];
    if (!f || !UI.faceCv) return;
    var g = UI.faceCv.getContext('2d');
    g.imageSmoothingEnabled = false;
    g.clearRect(0, 0, 52, 52);
    g.drawImage(S.atlas, f[0], f[1], f[4], f[5], 0, 0, 52, 52);
  }

  function uiMini() {
    if (!UI.miniCtx || !MINI.base || !S.me) return;
    drawMiniMap(UI.miniCtx, 0, 0, 124, 30);
  }

  // 图集到位后补画图标（uiBuild 早于 atlas 加载）
  function uiPaintIcons() {
    if (!S.atlas || !UI.hud) return;
    var list = UI.hud.getElementsByTagName('canvas');
    for (var i = 0; i < list.length; i++) {
      var nm = list[i].getAttribute('data-icon');
      if (nm) paintIcon(list[i], nm, list[i].width);
    }
    if (UI.coinCv) paintIcon(UI.coinCv, 'it_coin', 16);
  }


  // ======================== 10_ui_panels.js ========================
  // ---------------- §16 面板 ----------------
  // 面板只有一层：同时只开一个，再点同一个就关掉。手机上这一点比什么都重要 ——
  // 叠三层面板等于把半个屏幕糊住，还点不到底下的按钮。
  function uiBtn(text, cls, fn) {
    var b = el('button', 'sg5-btn' + (cls ? ' ' + cls : ''), text);
    b.type = 'button';
    b.addEventListener('click', function (e) { e.stopPropagation(); fn(); }, false);
    return b;
  }

  var ITEM_ICON = {
    potion: 'it_potionRed', ether: 'it_potionBlue', gel: 'food_Seed1', wood: 'fx_pWood',
    feather: 'fx_pLeaf', spore: 'food_Seed2', scale: 'food_Seed3', firefly: 'fx_pSpark',
    bone: 'wh_Bone', ore: 'fx_pRock', ice: 'fx_pSnow', ember: 'fx_pFire'
  };

  function rarityName(r) { return ['普通', '精良', '稀有', '史诗', '传说'][r] || '普通'; }
  function rarityColor(r) { return ['#e8e2d4', '#7fd36a', '#5fa8ff', '#c07bff', '#ffb84a'][r] || '#e8e2d4'; }

  var PANELS = {};
  var curPanel = '';

  function panelShell(title, sub) {
    var root = el('div', 'sg5-panel');
    var head = el('div', 'sg5-phead');
    head.appendChild(el('div', 'sg5-ptitle', title));
    if (sub) head.appendChild(el('div', 'sg5-psub', sub));
    var x = el('button', 'sg5-pclose', '×');
    x.type = 'button';
    x.addEventListener('click', function () { closePanel(); }, false);
    head.appendChild(x);
    root.appendChild(head);
    var body = el('div', 'sg5-pbody');
    root.appendChild(body);
    return { root: root, body: body };
  }

  function openPanel(id) {
    if (curPanel === id) return closePanel();
    curPanel = id;
    S.paused = false;
    clearNode(UI.panelWrap);
    var build = PANELS[id];
    if (build) {
      var p = build();
      if (p) UI.panelWrap.appendChild(p);
    }
    UI.panelWrap.className = 'sg5-panels is-on';
    refreshPanel(id);
  }

  function closePanel() {
    curPanel = '';
    UI.panelWrap.className = 'sg5-panels';
    clearNode(UI.panelWrap);
  }

  function refreshPanel(id) {
    if (!curPanel) return;
    if (id && id !== curPanel) return;
    var build = PANELS[curPanel];
    if (!build) return;
    // v5.3：面板重建会把 .sg5-pbody 的滚动位置和键盘焦点一起丢掉。
    // 只在农场三件套里做还原；v5.2 面板走原来的最短路径，一点都不碰。
    // 整段还原逻辑都包在 try/catch 里，任何异常都绝不能挡住下面的 build。
    var restore = (curPanel === 'farm' || curPanel === 'relation' || curPanel === 'mine');
    var oldScroll = 0, focusKey = '';
    if (restore) {
      try {
        var oldBody = UI.panelWrap.querySelector('.sg5-pbody');
        if (oldBody) oldScroll = oldBody.scrollTop || 0;
        var ae = document.activeElement;
        if (ae && ae.getAttribute) focusKey = ae.getAttribute('data-focus-key') || '';
      } catch (e) { restore = false; }
    }
    clearNode(UI.panelWrap);
    var p = build();
    if (p) UI.panelWrap.appendChild(p);
    if (restore) {
      try {
        // 顺序要紧：先还焦点再还滚动位置 —— .focus() 会把焦点元素滚进视野，
        // 若先设 scrollTop 会被它清零。
        if (focusKey) {
          var nodes = UI.panelWrap.querySelectorAll('[data-focus-key]');
          for (var i = 0; i < nodes.length; i++) {
            if (nodes[i].getAttribute('data-focus-key') === focusKey) { nodes[i].focus(); break; }
          }
        }
        var newBody = UI.panelWrap.querySelector('.sg5-pbody');
        if (newBody) {
          // 读一次 scrollHeight 强制排版：新建节点未排版时 scrollTop 会被夹到 0
          if (newBody.scrollHeight >= 0) newBody.scrollTop = oldScroll;
        }
      } catch (e) {}
    }
  }

  // ---------- 角色 ----------
  PANELS.char = function () {
    var me = S.me;
    var sh = panelShell('角色', 'Lv.' + (me.lv || 1) + ' · ' + (ZONE_NAMES[S.zone] || ''));
    var body = sh.body;
    // 装备
    var slots = el('div', 'sg5-slots');
    ['weapon', 'charm', 'cape'].forEach(function (slot) {
      var label = { weapon: '武器', charm: '护符', cape: '披风' }[slot];
      var it = (me.equip || {})[slot];
      var cell = el('div', 'sg5-slot');
      var ic = el('div', 'sg5-slot-ic');
      if (it) {
        var nm = it.slot === 'weapon'
          ? 'glyph:' + ({ staff: 'staff', lance: 'lance', twin: 'twin', hammer: 'hammer' }[it.kind] || 'sword')
          : (it.slot === 'charm' ? 'it_heart' : 'obj_ScrollEmpty');
        ic.appendChild(iconCanvas(nm, 44));
      }
      cell.appendChild(ic);
      cell.appendChild(el('div', 'sg5-slot-label', label));
      var nmEl = el('div', 'sg5-slot-name', it ? it.name : '（空）');
      if (it) nmEl.style.color = rarityColor(it.rarity);
      cell.appendChild(nmEl);
      if (it) {
        cell.appendChild(el('div', 'sg5-slot-atk', it.slot === 'weapon' ? '攻击 ' + it.atk : ''));
        var affixBox = el('div', 'sg5-affix');
        for (var k in it.affixes) {
          affixBox.appendChild(el('div', null, affixText(k, it.affixes[k])));
        }
        cell.appendChild(affixBox);
        cell.appendChild(uiBtn('卸下', 'sg5-btn-ghost', function () {
          apiUnequip(slot);
        }));
      }
      slots.appendChild(cell);
    });
    body.appendChild(slots);

    // 属性
    var st = S.stats || {};
    var grid = el('div', 'sg5-stats');
    [['攻击', (st.atk || 0).toFixed ? st.atk.toFixed(1) : st.atk], ['生命', me.maxHp],
      ['灯火上限', st.mp || 40], ['暴击率', (st.crit || 0) + '%'],
      ['暴击伤害', '+' + (st.critDmg || 0) + '%'], ['吸血', (st.leech || 0).toFixed(1) + '%'],
      ['灯火回复', '+' + Math.round(st.mpGain || 0) + '%'], ['移速', '+' + Math.round(st.speed || 0) + '%'],
      ['翻滚冷却', '-' + Math.round(st.dodgeCd || 0) + '%'], ['技能伤害', '+' + Math.round(st.skill || 0) + '%'],
      ['夜战', '+' + Math.round(st.night || 0) + '%'], ['武器手感', (st.weaponKind || 'sword')]].forEach(function (pair) {
      var r = el('div', 'sg5-statrow');
      r.appendChild(el('span', 'sg5-statk', pair[0]));
      r.appendChild(el('span', 'sg5-statv', String(pair[1])));
      grid.appendChild(r);
    });
    body.appendChild(grid);

    // 技能
    body.appendChild(el('div', 'sg5-sect', '技能'));
    var sk = el('div', 'sg5-skills');
    (me.skills || ['spin']).forEach(function (id) {
      var d = SKILLS[id];
      if (!d) return;
      var row = el('div', 'sg5-skillrow');
      row.appendChild(el('span', 'sg5-skillname', d.name));
      row.appendChild(el('span', 'sg5-skillcost', d.mp + ' 灯火'));
      row.appendChild(el('span', 'sg5-skilldesc', d.desc));
      sk.appendChild(row);
    });
    body.appendChild(sk);
    body.appendChild(el('div', 'sg5-note', '装备与天赋在背包 / 天赋面板里调整。武器手感决定普攻的判定形状：剑均衡，长枪远，双刃快，法杖远程，战锤重。'));
    return sh.root;
  };

  function affixText(k, v) {
    var names = {
      atk: '攻击', hp: '生命', crit: '暴击率', critDmg: '暴击伤害', leech: '吸血',
      mpGain: '灯火回复', speed: '移速', dodgeCd: '翻滚冷却', skill: '技能伤害', night: '夜战'
    };
    var unit = (k === 'atk' || k === 'hp') ? '' : '%';
    var sign = (k === 'dodgeCd') ? '-' : '+';
    return (names[k] || k) + ' ' + sign + v + unit;
  }

  // ---------- 背包 ----------
  PANELS.bag = function () {
    var me = S.me;
    var bag = me.bag || [];
    var sh = panelShell('装备', bag.length + ' / 60');
    var body = sh.body;
    if (!bag.length) {
      body.appendChild(el('div', 'sg5-empty', '背包是空的。去打点东西，或者开个箱子。'));
    }
    var list = el('div', 'sg5-list');
    bag.forEach(function (it) {
      var row = el('div', 'sg5-item');
      var ic = el('div', 'sg5-item-ic');
      var nm = it.slot === 'weapon'
        ? 'glyph:' + ({ staff: 'staff', lance: 'lance', twin: 'twin', hammer: 'hammer' }[it.kind] || 'sword')
        : (it.slot === 'charm' ? 'it_heart' : 'obj_ScrollEmpty');
      ic.appendChild(iconCanvas(nm, 26));
      row.appendChild(ic);
      var mid = el('div', 'sg5-item-mid');
      var title = el('div', 'sg5-item-name', it.name);
      title.style.color = rarityColor(it.rarity);
      mid.appendChild(title);
      var sub = el('div', 'sg5-item-sub', rarityName(it.rarity) + ' · iLv' + it.ilvl + (it.slot === 'weapon' ? ' · 攻击 ' + it.atk : ''));
      mid.appendChild(sub);
      var af = [];
      for (var k in it.affixes) af.push(affixText(k, it.affixes[k]));
      if (af.length) mid.appendChild(el('div', 'sg5-item-affix', af.join('  ')));
      row.appendChild(mid);
      var ops = el('div', 'sg5-item-ops');
      ops.appendChild(uiBtn('装备', 'sg5-btn-sm', function () { apiEquip(it.uid); }));
      ops.appendChild(uiBtn('卖 ' + sellOf(it), 'sg5-btn-sm sg5-btn-ghost', function () { apiSell([it.uid]); }));
      row.appendChild(ops);
      list.appendChild(row);
    });
    body.appendChild(list);

    // 材料
    var mats = me.mats || {};
    var keys = Object.keys(mats);
    if (keys.length) {
      body.appendChild(el('div', 'sg5-sect', '材料与消耗品'));
      var mg = el('div', 'sg5-mats');
      var MAT_NAME = {
        gel: '果冻', wood: '灵竹', feather: '夜羽', spore: '孢子', scale: '泽鳞', firefly: '萤火',
        bone: '骨片', ore: '星岩矿', ice: '永冻晶', ember: '长夜余烬', potion: '回血药', ether: '灯油'
      };
      keys.forEach(function (k) {
        var cell = el('div', 'sg5-mat');
        cell.appendChild(iconCanvas(ITEM_ICON[k] || 'it_coin', 22));
        cell.appendChild(el('span', 'sg5-matname', MAT_NAME[k] || k));
        cell.appendChild(el('span', 'sg5-matn', '×' + mats[k]));
        if (k === 'potion' || k === 'ether') {
          cell.addEventListener('click', function () { apiUse(k); }, false);
          cell.className += ' is-usable';
        }
        mg.appendChild(cell);
      });
      body.appendChild(mg);
    }
    return sh.root;
  };

  function sellOf(it) { return Math.round((4 + it.ilvl * 1.6) * (1 + it.rarity * it.rarity * 0.9)); }

  // ---------- 锻造 ----------
  PANELS.forge = function () {
    var me = S.me;
    var sh = panelShell('铁匠铺', '重铸词条 · 星屑 ' + fmt(me.shards));
    var body = sh.body;
    body.appendChild(el('div', 'sg5-note', '重铸会重抽一件装备的全部词条（稀有度与基础攻击保留）。这是星屑最主要的去处。'));
    ['weapon', 'charm', 'cape'].forEach(function (slot) {
      var it = (me.equip || {})[slot];
      if (!it) return;
      var cost = 30 * (1 + (it.ilvl | 0));
      var row = el('div', 'sg5-forge');
      row.appendChild(el('div', 'sg5-forge-name', it.name));
      var aff = [];
      for (var k in it.affixes) aff.push(affixText(k, it.affixes[k]));
      row.appendChild(el('div', 'sg5-forge-affix', aff.join('  ')));
      row.appendChild(el('div', 'sg5-forge-cost', '花费 ' + cost + ' 星屑 + 1 星岩矿'));
      var b = uiBtn('重铸', 'sg5-btn-sm', function () { apiForge(slot); });
      row.appendChild(b);
      body.appendChild(row);
    });
    return sh.root;
  };

  // ---------- 天赋 ----------
  // v5.6 W4：文案改为读服务端下发的 talentDefs（enter 前空档兜底旧文案），mod 数值不下发
  var TALENT_FALLBACK = {
    blade: { name: '剑', color: '#ff8a6a', tiers: [
      { id: 'b1', name: '锋利', desc: '攻击 +8%' }, { id: 'b2', name: '连斩', desc: '连击最后一段伤害 +25%' },
      { id: 'b3', name: '破甲', desc: '对精英与守护者伤害 +15%' }, { id: 'b4', name: '嗜血', desc: '吸血 +3%' },
      { id: 'b5', name: '剑舞', desc: '普攻每 5 次自动释放一次小回旋' } ] },
    shadow: { name: '影', color: '#9a8aff', tiers: [
      { id: 's1', name: '轻身', desc: '移速 +6%' }, { id: 's2', name: '残影', desc: '翻滚冷却 -20%' },
      { id: 's3', name: '致命', desc: '暴击率 +8%' }, { id: 's4', name: '见切', desc: '完美闪避窗口 +60%，子弹时间更长' },
      { id: 's5', name: '影袭', desc: '完美闪避后瞬移到敌人背后并暴击' } ] },
    lamp: { name: '灯', color: '#ffd36a', tiers: [
      { id: 'l1', name: '暖光', desc: '生命 +12%' }, { id: 'l2', name: '添油', desc: '灯火回复 +30%' },
      { id: 'l3', name: '照夜', desc: '夜间视野 +50%，对幽灵伤害 +40%' }, { id: 'l4', name: '共明', desc: '身边 6 格内队友攻击 +10%' },
      { id: 'l5', name: '不灭', desc: '致命伤害时保留 1 点生命（每 90 秒一次）' } ] }
  };
  PANELS.talent = function () {
    var me = S.me;
    var defs = (S.me && S.me.talentDefs) || TALENT_FALLBACK;
    var left = me.talentLeft || 0;
    var sh = panelShell('天赋', '可用点数 ' + left + '（每 3 级 1 点）');
    var body = sh.body;
    Object.keys(defs).forEach(function (key) {
      var L = defs[key];
      var box = el('div', 'sg5-tline');
      var head = el('div', 'sg5-tline-head', L.name + ' 之线');
      head.style.color = L.color;
      box.appendChild(head);
      var have = (me.talents || {})[key] || 0;
      L.tiers.forEach(function (t, i) {
        var on = i < have;
        var node = el('div', 'sg5-tnode' + (on ? ' is-on' : ''));
        node.appendChild(el('span', 'sg5-tdot', String(i + 1)));
        node.appendChild(el('span', 'sg5-ttxt', t.name + ' ' + t.desc));
        if (!on && i === have) {
          var b = uiBtn('学', 'sg5-btn-sm', function () { apiTalent(key); });
          b.disabled = left <= 0;
          node.appendChild(b);
        }
        box.appendChild(node);
      });
      body.appendChild(box);
    });
    return sh.root;
  };

  // ---------- 图鉴 ----------
  PANELS.dex = function () {
    var me = S.me;
    var dex = me.dex || {};
    // v5.7：图鉴分「怪物 / 世界」两页签 —— 世界承载《灯火纪》编年史、守塔人日记与风物志
    var sh = panelShell('图鉴', '击杀 ' + Object.keys(dex).length + ' 种怪物');
    var body = sh.body;
    var cur = S.farm && S.farm.dexTab === 'world' ? 'world' : 'mob';
    var tabs = el('div', 'sg5-tabs');
    [['mob', '怪物'], ['world', '世界']].forEach(function (t) {
      var tb = el('button', 'sg5-tab' + (cur === t[0] ? ' is-on' : ''), t[1]);
      tb.type = 'button';
      tb.setAttribute('data-focus-key', 'dextab:' + t[0]);
      tb.addEventListener('click', function () {
        S.farm = S.farm || {}; S.farm.dexTab = t[0];
        refreshPanel('dex');
      }, false);
      tabs.appendChild(tb);
    });
    body.appendChild(tabs);
    var page = el('div', 'sg5-farm-cont');
    if (cur === 'world') {
      loreWorldTab(page);
      body.appendChild(page);
      return sh.root;
    }
    var mobName = {
      slime: '果冻史莱姆', slime2: '薄荷史莱姆', bamboo: '竹精', mouse: '偷灯鼠', eye: '雾眼',
      mushroom: '孢子菇', owl: '夜枭', beast: '林兽', snake: '泽蛇', frog: '泽蛙法师',
      larva: '萤虫', lantern: '迷途灯笼', skull: '守岩骷髅', cyclope: '独眼巨魔', mole: '掘岩鼹',
      reptile: '霜蜥', spirit2: '冰魄', dragon: '幼龙', octopus: '渊章', flam: '长夜火', ghost: '长夜幽灵'
    };
    var grid = el('div', 'sg5-dexgrid');
    Object.keys(mobName).forEach(function (k) {
      var n = dex['m_' + k] || 0;
      var cell = el('div', 'sg5-dexcell' + (n ? '' : ' is-unknown'));
      cell.appendChild(iconCanvas(n ? (MOB_SPRITE[k] || 'mon_Slime') : 'mon_Slime', 34));
      cell.appendChild(el('div', 'sg5-dexname', n ? mobName[k] : '？？？'));
      cell.appendChild(el('div', 'sg5-dexct', n ? '×' + n : '未见过'));
      grid.appendChild(cell);
    });
    page.appendChild(grid);

    page.appendChild(el('div', 'sg5-sect', '灯塔（全服进度）'));
    var tg = el('div', 'sg5-towers');
    ZONE_ORDER.forEach(function (z) {
      var lit = !!S.towers[z];
      var row = el('div', 'sg5-trow' + (lit ? ' is-lit' : ''));
      row.appendChild(el('span', 'sg5-tname', ZONE_NAMES[z]));
      row.appendChild(el('span', 'sg5-tstate', lit ? '已点亮' : '长夜笼罩'));
      tg.appendChild(row);
    });
    page.appendChild(tg);

    page.appendChild(el('div', 'sg5-sect', '宝箱'));
    var total = (S.map.chests || []).length;
    var got = Object.keys(S.chests).length;
    page.appendChild(el('div', 'sg5-note', '已开启 ' + got + ' / ' + total + ' 个宝箱（个人进度）'));
    body.appendChild(page);
    return sh.root;
  };

  // ---------- 大地图 ----------
  PANELS.map = function () {
    var sh = panelShell('地图', '拖不动它，但它知道你走到过哪里');
    var body = sh.body;
    var cv = document.createElement('canvas');
    var size = Math.min(S.view.w - 60, S.view.h - 150);
    size = Math.max(220, Math.min(520, size));
    cv.width = size; cv.height = size;
    cv.className = 'sg5-bigmap';
    var g = cv.getContext('2d');
    g.imageSmoothingEnabled = false;
    var scale = size / S.map.size;
    g.fillStyle = '#070a14';
    g.fillRect(0, 0, size, size);
    g.drawImage(MINI.base, 0, 0, S.map.size, S.map.size, 0, 0, size, size);
    g.drawImage(MINI.mask, 0, 0, S.map.size, S.map.size, 0, 0, size, size);
    // 灯塔
    ZONE_ORDER.forEach(function (z) {
      var t = S.map.towers[z];
      if (!t) return;
      g.fillStyle = S.towers[z] ? '#ffd98a' : '#7a7f96';
      g.beginPath();
      g.arc(t.x * scale, t.y * scale, 4, 0, 6.2832);
      g.fill();
      g.font = '11px system-ui,sans-serif';
      g.fillStyle = S.towers[z] ? 'rgba(255,230,170,0.95)' : 'rgba(170,175,200,0.85)';
      g.textAlign = 'center';
      g.fillText(ZONE_NAMES[z], t.x * scale, t.y * scale - 7);
    });
    // 传送石
    (S.map.waystones || []).forEach(function (w) {
      if ((S.waystones || []).indexOf(w.id) < 0) return;
      g.fillStyle = '#8fd3ff';
      g.fillRect(w.x * scale - 2, w.y * scale - 2, 4, 4);
    });
    // 我 + 队友
    for (var id in S.players) {
      var p = S.players[id];
      g.fillStyle = '#7fd36a';
      g.beginPath();
      g.arc(p.x * scale, p.y * scale, 3, 0, 6.2832);
      g.fill();
    }
    if (S.me) {
      g.fillStyle = '#fff2c0';
      g.beginPath();
      g.arc(S.me.x * scale, S.me.y * scale, 4, 0, 6.2832);
      g.fill();
      g.strokeStyle = 'rgba(255,255,255,0.5)';
      g.beginPath();
      g.arc(S.me.x * scale, S.me.y * scale, 9, 0, 6.2832);
      g.stroke();
    }
    body.appendChild(cv);
    body.appendChild(el('div', 'sg5-note', '金色 = 已点亮的灯塔，灰色 = 还在长夜里。蓝点是已激活的传送石。'));
    return sh.root;
  };

  // v5.6 W3：材料可卖 —— 客户端侧售价表（与 backend/v5/data.js D.ITEMS.sell 一致）
  var MAT_SELL = { gel: 2, wood: 3, feather: 5, spore: 5, scale: 8, firefly: 10, bone: 12, ore: 14, ice: 20, ember: 40 };
  var MAT_NAME = {
    gel: '果冻', wood: '灵竹', feather: '夜羽', spore: '孢子', scale: '泽鳞', firefly: '萤火',
    bone: '骨片', ore: '星岩矿', ice: '永冻晶', ember: '长夜余烬', potion: '回血药', ether: '灯油'
  };
  S.shopTab = 'goods';

  // ---------- 商店 ----------
  PANELS.shop = function () {
    var me = S.me;
    var sh = panelShell('杂货铺', '星屑 ' + fmt(me.shards));
    var body = sh.body;
    // v5.6 W3：材料页签 —— 消耗品 / 材料 两个子页
    var tabs = el('div', 'sg5-tabs');
    [['goods', '消耗品'], ['mats', '材料']].forEach(function (t) {
      var on = S.shopTab === t[0];
      var b = el('button', 'sg5-tab' + (on ? ' is-on' : ''), t[1]);
      b.type = 'button';
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', on ? 'true' : 'false');
      b.addEventListener('click', function () { S.shopTab = t[0]; refreshPanel('shop'); auSfx('menu', 0.2, 1.1); }, false);
      tabs.appendChild(b);
    });
    body.appendChild(tabs);
    if (S.shopTab === 'mats') {
      var mats = me.mats || {};
      var keys = Object.keys(mats).filter(function (k) { return MAT_SELL[k] && mats[k] > 0; });
      if (!keys.length) {
        body.appendChild(el('div', 'sg5-empty', '背包里还没有能卖的材料。打怪会掉。'));
      }
      keys.forEach(function (k) {
        var n = mats[k];
        var row = el('div', 'sg5-shoprow');
        row.appendChild(iconCanvas(ITEM_ICON[k] || 'it_coin', 28));
        var mid = el('div', 'sg5-shopmid');
        mid.appendChild(el('div', 'sg5-shopname', MAT_NAME[k] || k));
        mid.appendChild(el('div', 'sg5-shopdesc', '×' + n + ' · 卖 1 个得 ' + MAT_SELL[k] + ' 星屑' + (n > 1 ? ' · 全部得 ' + MAT_SELL[k] * n : '')));
        row.appendChild(mid);
        row.appendChild(uiBtn('卖 1', 'sg5-btn-sm', function () {
          var m2 = {}; m2[k] = 1; apiSell({ mats: m2 });
        }));
        row.appendChild(uiBtn('全部', 'sg5-btn-sm sg5-btn-ghost', function () {
          var m2 = {}; m2[k] = n; apiSell({ mats: m2 });
        }));
        body.appendChild(row);
      });
      body.appendChild(el('div', 'sg5-note', '材料换星屑，即时到账。星岩矿留着点天赋重铸更划算。'));
      return sh.root;
    }
    [['potion', '回血药', '回复 45% 生命', 15], ['ether', '灯油', '回复 60% 灯火', 12]].forEach(function (x) {
      var row = el('div', 'sg5-shoprow');
      row.appendChild(iconCanvas(ITEM_ICON[x[0]], 28));
      var mid = el('div', 'sg5-shopmid');
      mid.appendChild(el('div', 'sg5-shopname', x[1]));
      mid.appendChild(el('div', 'sg5-shopdesc', x[2]));
      row.appendChild(mid);
      row.appendChild(el('div', 'sg5-shopcost', x[3] + ' 星屑'));
      row.appendChild(uiBtn('买 1', 'sg5-btn-sm', function () { apiBuy(x[0], 1); }));
      row.appendChild(uiBtn('买 5', 'sg5-btn-sm sg5-btn-ghost', function () { apiBuy(x[0], 5); }));
      body.appendChild(row);
    });
    body.appendChild(el('div', 'sg5-note', '只在拾光镇卖。出门前记得带够。'));
    return sh.root;
  };

  // ---------- NPC 对话 ----------
  function openNpc(npc) {
    curPanel = 'npc';
    clearNode(UI.panelWrap);
    var sh = panelShell(npc.name, '');
    var body = sh.body;
    var line = npc.line[(Math.random() * npc.line.length) | 0];
    body.appendChild(el('div', 'sg5-dialog', line));
    // 每个 NPC 一条三步支线，直接在对话里显示进度
    var qid = 'q_' + npc.id;
    var qb = questBlock(qid);
    if (qb) body.appendChild(qb);
    if (npc.action === 'forge') body.appendChild(uiBtn(npc.actionText, '', function () { openPanel('forge'); }));
    if (npc.action === 'shop') body.appendChild(uiBtn(npc.actionText, '', function () { openPanel('shop'); }));
    if (npc.action === 'rest') body.appendChild(uiBtn(npc.actionText, '', function () { apiRest(); }));
    if (npc.action === 'story') body.appendChild(uiBtn(npc.actionText, '', function () { storyTalk(); }));
    if (S.party && S.party.members && S.party.members.length > 1) {
      body.appendChild(uiBtn('退出队伍', 'sg5-btn-ghost', function () { apiLeaveParty(); closePanel(); }));
    }
    UI.panelWrap.appendChild(sh.root);
    UI.panelWrap.className = 'sg5-panels is-on';
  }

  function storyTalk() {
    // v5.7《灯火纪》：栗的独白随点亮座数推进 —— 这是主线之外最重要的情感锚点
    closePanel();
    loreCard('守灯人 栗', '名册 · 铜钥匙 · 灯火', loreKeeperLine(), 'plain');
    auSfx('menu', 0.3, 1.1);
  }

  // ---------- 设置 ----------
  PANELS.help = function () {
    var sh = panelShell('设置与说明', '拾光群岛 v5「长夜」');
    var body = sh.body;
    var row = el('div', 'sg5-setrow');
    row.appendChild(el('span', null, '音效与音乐'));
    var b = uiBtn(S.audio.on ? '开' : '关', 'sg5-btn-sm', function () {
      S.audio.on = !S.audio.on;
      auSetOn(S.audio.on);
      try { S.storage.set('snd', S.audio.on ? '1' : '0'); } catch (e) {}
      refreshPanel('help');
    });
    row.appendChild(b);
    body.appendChild(row);
    body.appendChild(el('div', 'sg5-sect', '操作'));
    body.appendChild(el('div', 'sg5-keys',
      '移动：WASD / 方向键 / 左半屏摇杆　·　攻击：J / 空格　·　翻滚：K　·　技能：L　·　交互：E\n' +
      '角色 C　·　装备 B　·　地图 M　·　怪物图鉴 V　·　天赋 T　·　关闭面板 Esc\n\n' +
      '农场 N　·　小镇 R　·　钓鱼/矿洞 H\n' +
      '翻滚的前 0.22 秒无敌。在怪物出招前 0.15 秒内翻滚 = 完美闪避（子弹时间 + 下一击必暴击）。'));
    // v5.4 新增说明（新 DOM 新文案，原有键位表逐字节未动）
    body.appendChild(el('div', 'sg5-note',
      'v5.4：靠近野味/树木按 E 采集或砍树 · 斧头不用装进工具栏 · 加工在农场面板「加工」页签'));
    body.appendChild(el('div', 'sg5-note',
      'v5.7《灯火纪》：世界变大了 —— 六域之外还有长夜之心。草原、林间、冰原上散落着守塔人的石碑，' +
      '碑顶发亮就是还没读过的日记；走近按 E 阅读并收下，图鉴的「世界」页签可以随时重读。' +
      '每点亮一座灯塔，全班都会听到那位守塔人的灯语。'));
    body.appendChild(el('div', 'sg5-sect', '关于'));
    body.appendChild(el('div', 'sg5-note',
      '一个班同在一片大世界里：白天探索、打怪、攒材料；入夜后长夜从雾里涌出来，' +
      '大家回到灯边一起守夜。你点亮的每一座灯塔，全班的世界都会变亮。'));
    body.appendChild(el('div', 'sg5-note sg5-credit',
      '美术与音频：Ninja Adventure Asset Pack（Pixel-boy & AAA，CC0）· ' +
      '前端 Canvas 2D 程序绘制地形/光照/雾 · 服务端 10Hz 世界模拟'));
    return sh.root;
  };


  // ======================== 11_net.js ========================
  // ---------------- §17 网络 ----------------
  // 一条 /sync 走完全部：我上报位置，服务端回我「你周围有什么 + 你身上发生了什么」。
  // 为什么不用 WS 推怪物：校园平板上一条 5Hz 的 HTTP 比 WebSocket 更抗折腾，
  // 而且回包里天然带「我的」事件，不用再开一条通道对齐时序。
  S.net = { queue: [], skill: null, roll: null, syncing: 0, errs: 0 };

  function http(method, path, body) {
    var api = S.api;
    if (!api) return Promise.reject(new Error('SDK 不可用'));
    var p = String(path).replace(/^\/api(?=\/)/, '');
    var call;
    try {
      call = method === 'get' ? api.get(p) : api.post(p, body || {});
    } catch (e) { return Promise.reject(e); }
    if (!call || typeof call.then !== 'function') return Promise.reject(new Error('请求失败'));
    return call.then(function (res) {
      var env = res && res.data ? res.data : null;
      if (!env) throw new Error('空响应');
      var code = env.code;
      if (code && code !== 200 && code !== 201) {
        var err = new Error(env.message || '请求失败');
        err.code = code;
        throw err;
      }
      return env.data;
    });
  }
  function apiGet(p) { return http('get', p); }
  function apiPost(p, b) { return http('post', p, b); }

  // ---- 进入世界 ----
  function loadTerrain() {
    var cached = null;
    try { cached = S.storage.get('terr5', null); } catch (e) { cached = null; }
    if (cached && cached.version === 7 && cached.cells && cached.size === 256) {
      return Promise.resolve(cached);
    }
    return apiGet('/shiguang/v5/terrain').then(function (data) {
      try { S.storage.set('terr5', data); } catch (e) {}
      return data;
    });
  }

  function applyEnter(d) {
    var me = makeMe(d.me);
    // v5.6 W4：天赋线等级挂到本地玩家（s4 见切窗口加成 / 剑舞 / 影袭都在本地判定）
    me.talentShadowLv = (me.talents && me.talents.shadow) || 0;
    me.talentBladeLv = (me.talents && me.talents.blade) || 0;
    me.talentLampLv = (me.talents && me.talents.lamp) || 0;
    me.pwBonus = me.talentShadowLv >= 4 ? (ROLL_INV_MS / 1000) * 0.6 : 0;
    me.atkCount = 0;
    S.myId = d.me.id;
    S.zone = d.me.zone || 'town';
    S.stats = d.me.stats || {};
    S.chests = {};
    for (var i = 0; i < (d.chests || []).length; i++) S.chests[d.chests[i]] = 1;
    S.towers = d.towers || {};
    S.waystones = d.me.waystones || ['ws_town'];
    S.goal = d.goal;
    if (!S.pfLock) S.phase = d.phase ? d.phase.name : 'day';
    S.pf = d.phase ? d.phase.f : 0;
    S.feed = (d.feed || []).map(function (f) { return { text: f.text, kind: f.kind }; });
    S.party = d.party || null;
    S.quests = d.quests || {};
    S.tideInfo = d.tide || null;
    S.caves = d.caves || [];
    S.friends = d.friends || [];
    S.friendReq = d.friendReq || null;
    S.bonds = d.bonds || {};
    S.nearby = d.nearby || [];
    S.acts = d.acts || S.acts;
    if (S.friendReq) setTimeout(function () { cardFriendReq(S.friendReq); }, 1800);
    // 相机先对上，否则第一帧会从 (0,0) 飞过来
    S.cam.x = me.x * TILE;
    S.cam.y = me.y * TILE;
    // NPC 站到自家门口
    for (var k = 0; k < NPCS.length; k++) {
      var h = null;
      for (var j = 0; j < S.map.town.houses.length; j++) {
        if (S.map.town.houses[j].kind === NPCS[k].id) h = S.map.town.houses[j];
      }
      if (h) {
        // 站在门侧、退到墙脚之外：名字牌才不会压在屋檐上，门也能露出来
        NPCS[k].x = h.x + h.w / 2 + 0.62;
        NPCS[k].y = h.y + h.h + 1.55;
      }
    }
    applyPlayers(d.players || []);
    renderFeed();
    uiPaintIcons();
    drawFace(me.look);
    uiUpdate();
    uiGoal();
    auMusic(S.zone === 'town' ? 'town' : S.zone);
    reveal(Math.floor(me.x), Math.floor(me.y), 18);   // 第一次进世界，先把镇子看清
    if (d.me.isNew) {
      setTimeout(function () { showChapter(0); }, 900);
    }
    bindRealtime();
  }

  // ---- 同步 ----
  function syncOnce() {
    var me = S.me;
    if (!me || !S.ready) return;
    if (S.net.syncing) return;
    S.net.syncing = 1;
    var body = {
      x: Math.round(me.x * 100) / 100,
      y: Math.round(me.y * 100) / 100,
      f: Math.round(Math.atan2(me.dirY || 0, me.dirX || 0) * 100) / 100,
      mv: me.moving ? 1 : 0,
      mp: Math.round(me.mp)
    };
    if (S.net.roll) { body.roll = 1; body.rt = 0; S.net.roll = null; }
    var hits = null;
    if (S.net.queue.length) { hits = S.net.queue.splice(0, 12); }
    var skill = S.net.skill;
    S.net.skill = null;

    var settled = 0, syncTimer = 0;
    var finish = function () {
      if (settled) return;
      settled = 1;
      if (syncTimer) { clearTimeout(syncTimer); syncTimer = 0; }
      S.net.syncing = 0;
    };
    // 任何一条请求悬挂（校园网抖动 / 平板切后台）都可能让 syncing 永远为 1，
    // 表现为「玩着玩着世界不动了」。8 秒没结果就主动放锁，让下一轮重新同步。
    syncTimer = setTimeout(function () {
      if (settled) return;
      S.net.errs++;
      finish();
      toast('世界同步超时，正在重新连接…', 'warn');
    }, 8000);
    // 先把命中送出去（服务端先记账），再要快照 —— 顺序反了会「怪没掉血但已经死了」
    var chain = Promise.resolve();
    if (hits && hits.length) {
      chain = chain.then(function () {
        return apiPost('/shiguang/v5/hit', { list: hits, kind: 'melee' }).then(null, function () {});
      });
    }
    if (skill) {
      chain = chain.then(function () {
        return apiPost('/shiguang/v5/skill', skill).then(null, function () {});
      });
    }
    chain.then(function () {
      return apiPost('/shiguang/v5/sync', body);
    }).then(function (d) {
      if (settled) return;
      S.net.errs = 0;
      applySync(d);
      finish();
    }, function (err) {
      if (settled) return;
      S.net.errs++;
      finish();
      if (S.net.errs === 4) {
        toast('与世界的连接断了一下，正在重连…', 'warn');
      }
      if (S.net.errs > 3 && S.net.errs % 10 === 0) {
        // 连续失败：不弹窗打断，只在 HUD 上显示，恢复后自动消失
        if (UI.zoneEl) UI.zoneEl.textContent = '重连中…';
      }
    });
  }

  function applySync(d) {
    if (!d || d.thin) {
      if (d && d.ph && !S.pfLock) { S.phase = d.ph; }
      return;
    }
    var me = S.me;
    if (!me) return;
    var a = d.me;
    // 位置以服务端为准；只有在「被纠正」时才硬拉，平时不打断本地手感
    if (d.c && Math.abs(a[0] - me.x) + Math.abs(a[1] - me.y) > 0.35) {
      me.x = a[0]; me.y = a[1];
      reveal(Math.floor(me.x), Math.floor(me.y), 12);   // 被服务端挪过去时也要揭图
    }
    var prevHp = me.hp;
    me.hp = a[2]; me.maxHp = a[3];
    me.mp = a[4]; me.maxMp = a[5];
    me.lv = a[6]; me.xp = a[7]; me.xpNext = a[8];
    me.shards = a[9];
    me.down = !!a[10];
    if (a[10]) showDead(true);
    else showDead(false);
    if (me.hp < prevHp - 0.5) hurtFlash();
    // 血量变了要跟服务端对齐（本地预测的伤害不该留在血条上）
    if (!S.pfLock) {
      if (!S.pfLock) S.phase = d.ph || S.phase;
      S.pf = d.pf != null ? d.pf : S.pf;
    }
    S.party = d.pt || null;
    if (d.td) S.tideInfo = { zone: d.td[0], until: d.td[1], wave: d.td[2] };
    else S.tideInfo = null;
    applyMobs(d.m || []);
    applyPlayers(d.p || []);
    applyShots(d.s || []);
    // 区域切换 → 换 BGM
    var z = zoneAtMe();
    if (z !== S.zone) {
      S.zone = z;
      showZone(ZONE_NAMES[z] || z);
      auMusic(z === 'town' ? 'town' : z);
    }
    // 事件
    var ev = d.ev || [];
    for (var i = 0; i < ev.length; i++) handleEvent(ev[i]);
    // Boss 血条
    updateBossBar();
    uiUpdate();
    uiGoal();
  }

  function zoneAtMe() {
    var me = S.me;
    if (!me) return 'town';
    return zoneOf(Math.floor(me.x), Math.floor(me.y));
  }

  function handleEvent(e) {
    if (!e || !e.k) return;
    // 社交层先接：好友申请 / 互动邀请 / 私聊要变成能点的卡片，不是一行 toast
    if (socialEvent(e)) return;
    switch (e.k) {
      case 'zone':
        S.zone = e.z;
        showZone(e.n);
        auMusic(e.z === 'town' ? 'town' : e.z);
        break;
      case 'loot':
        if (e.s) {
          // v5.6 W3：星屑不再直接飘字 —— 改为死亡位置散落磁吸星屑珠（e.orbs 拆珠数组）
          if (e.orbs && e.orbs.length) {
            spawnOrbs(e.px, e.py, e.orbs);
          } else {
            var lp = lootPos(e);
            capPush(S.texts, { x: lp.x, y: lp.y - 1.2, txt: '+' + e.s, crit: 0, life: 1.0, max: 1.0, vy: -0.9, vx: 0.2, gold: 1 }, 60);
            auSfx('coin', 0.3, 1.1);
          }
        }
        if (e.it) {
          toast('获得 ' + rarityName(e.it.rarity) + '「' + e.it.name + '」', 'good');
          auSfx(e.it.rarity >= 3 ? 'gold' : 'bonus', 0.45, 1);
          // v5.6 W3：装备光柱（四档底圈 + 3 段阶梯光柱 + 3 帧浮动）
          if (e.px != null) spawnPillar(e.px, e.py, e.it.rarity || 0);
        }
        if (e.f) toast('背包满了 —— 去镇上卖掉一些吧', 'warn');
        if (e.m && e.m.length) {
          // v5.6 W3：材料簇 —— 死亡位置散落材料珠
          for (var i = 0; i < e.m.length; i++) {
            spawnOrbs(e.px, e.py, [{ v: e.m[i][1], mat: e.m[i][0] }]);
          }
        }
        break;
      case 'lvup':
        toast('升级！ Lv.' + e.lv, 'good');
        auSfx('levelup', 0.5, 1);
        S.rings.push({ x: S.me.x, y: S.me.y, r: 0, max: 3.2, life: 0.7, max2: 0.7, col: '#ffe6a8' });
        S.rings.push({ x: S.me.x, y: S.me.y, r: 0, max: 1.8, life: 0.5, max2: 0.5, col: '#fff3d0' });
        // 一束从脚底往上抽的金色光尘：升级要有一点「被世界看见了」的仪式感
        for (var li = 0; li < 20; li++) {
          S.parts.push({
            x: S.me.x + (Math.random() - 0.5) * 0.9, y: S.me.y + 0.35,
            vx: (Math.random() - 0.5) * 0.7, vy: -1.1 - Math.random() * 1.1,
            life: 0.85 + Math.random() * 0.55, max: 1.4,
            col: li % 3 ? 'rgba(255,224,150,' : 'rgba(255,248,214,', r: 1.8
          });
        }
        S.cam.shake = Math.max(S.cam.shake, 1.4);
        if (e.talent) setTimeout(function () { toast('获得 1 点天赋 —— 按 T 分配', 'good'); }, 1200);
        break;
      case 'down':
        showDead(true);
        auSfx('gameover', 0.4, 1);
        break;
      case 'dead':
        showDead(true);
        break;
      case 'boss':
        toast('守护者苏醒：' + e.n, 'warn');
        auMusic('boss');
        break;
      case 'tower':
        S.towers[e.z] = { by: e.b, at: Date.now() };
        showChapter(ZONE_ORDER.indexOf(e.z) + 1);
        feedPush(e.n + '的灯塔亮了 —— ' + e.b + ' 打倒了守护者', 'tower');
        auSfx('success', 0.5, 1);
        reGoal();
        break;
      case 'revived':
        toast('被 ' + e.by + ' 扶了起来', 'good');
        break;
      case 'party':
        toast(e.n || '队伍有变动');
        break;
      case 'invite':
        toast(e.n + ' 邀请你组队 —— 按 P 接受', 'good');
        S.pendingInvite = e.from;
        break;
      case 'invited':
        toast('邀请已发给 ' + e.n);
        break;
      case 'reviving':
        toast('正在扶起…', 'good');
        break;
      case 'being-revived':
        toast(e.n + ' 正在扶起你…', 'good');
        break;
      case 'quest':
        if (e.done) {
          toast('支线完成：' + e.n, 'good');
          if (e.item) setTimeout(function () { toast('获得「' + e.item.name + '」', 'good'); }, 900);
        } else {
          toast('「' + e.n + '」下一步：' + e.next);
        }
        S.quests = S.quests || {};
        break;
      case 'quest-ready':
        toast('支线可交付：' + e.n, 'good');
        break;
      case 'tide-reward':
        toast('守夜奖励：' + e.shards + ' 星屑（第 ' + e.rank + ' 名）', 'good');
        break;
      case 'cave':
        if (e.fail) toast('洞窟里的东西退回去了', 'warn');
        break;
      case 'cave-done':
        toast('洞窟清空：+' + e.shards + ' 星屑', 'good');
        break;
      case 'cheat-death':
        // v5.6 W4：不灭 —— 全屏白闪 0.2s + 金色 vignette + 1s 无敌
        cheatDeathFx();
        break;
    }
  }

  // v5.6 W3：loot 事件坐标 —— 优先服务端给的死亡坐标（px/py，e.x 已被 xp 占用），
  // 兜底最近垂死怪，再兜底自己
  function lootPos(e) {
    if (e && e.px != null && e.py != null) return { x: e.px + 0.5, y: e.py + 0.5 };
    var ids = Object.keys(S.mobs), best = null, bd = 99;
    for (var i = 0; i < ids.length; i++) {
      var m = S.mobs[ids[i]];
      if (!m || !m.dying) continue;
      var d = dist(S.me.x, S.me.y, m.rx, m.ry);
      if (d < bd) { bd = d; best = m; }
    }
    if (best) return { x: best.rx, y: best.ry };
    return { x: S.me.x, y: S.me.y };
  }

  // v5.6 W4：不灭触发特效（白闪走 hurtT 通道复用，金环 + toast 另行）
  function cheatDeathFx() {
    var me = S.me;
    if (!me) return;
    me.invUntil = S.time + 1.0;           // 1s 无敌（表现层；服务端另有权威判定）
    S.cheatFxUntil = S.time + 0.2;        // 白闪
    S.cheatVgUntil = S.time + 1.0;        // 金色 vignette
    toast('灯火不灭！', 'good');
    auSfx('levelup', 0.5, 0.8);
    S.rings.push({ x: me.x, y: me.y, r: 0, max: 3.4, life: 0.7, max2: 0.7, col: '#ffd36a' });
  }

  function reGoal() {
    // 灯塔点亮后重新算目标（服务端下次 enter 会给，但这里先本地推一下，反馈要即时）
    for (var i = 0; i < ZONE_ORDER.length; i++) {
      var z = ZONE_ORDER[i];
      if (!S.towers[z]) {
        var t = S.map.towers[z];
        S.goal = { zone: z, name: ZONE_NAMES[z], x: t.x, y: t.y, boss: '', idx: i + 1, total: 6 };
        uiGoal();
        return;
      }
    }
    S.goal = null;
    uiGoal();
  }

  function updateBossBar() {
    var boss = null;
    for (var id in S.mobs) {
      var m = S.mobs[id];
      if (m.boss && m.hp > 0) {
        var d = dist(S.me.x, S.me.y, m.rx, m.ry);
        if (d < 26) { boss = m; break; }
      }
    }
    S.boss = boss;
    if (!UI.bossEl) return;
    if (!boss) {
      UI.bossEl.className = 'sg5-boss';
      if (auBossPlaying) { auBossPlaying = 0; auMusic(zoneAtMe() === 'town' ? 'town' : zoneAtMe()); }
      return;
    }
    if (!auBossPlaying) { auBossPlaying = 1; auMusic('boss'); }
    UI.bossEl.className = 'sg5-boss is-on';
    var name = boss.name || '守护者';
    setText(UI.bossName, name + '  Lv.' + boss.lv);
    var f = clamp(boss.hp / (boss.maxHp || 1), 0, 1);
    UI.bossFill.style.transform = 'scaleX(' + f.toFixed(3) + ')';
  }
  var auBossPlaying = 0;

  function showDead(on) {
    if (!UI.deadEl) return;
    UI.deadEl.className = 'sg5-dead' + (on ? ' is-on' : '');
    // 倒下时把常驻 HUD 一起压暗并锁住点击，避免动作键/农场条盖在死亡遮罩上
    if (UI.hud) UI.hud.className = 'sg5-hud' + (on ? ' is-dead' : '');
    if (on) closePanel();
  }

  // ---- 实时事件（灯塔 / 首杀 / 世界频道） ----
  function bindRealtime() {
    var rt = S.realtime;
    if (!rt || typeof rt.subscribe !== 'function' || S.rtBound) return;
    S.rtBound = 1;
    var off1 = rt.subscribe('shiguang5.tower', function (p) {
      if (!p || S.towers[p.z]) return;
      S.towers[p.z] = { by: p.by, at: p.at };
      feedPush(ZONE_NAMES[p.z] + '的灯塔亮了 —— ' + p.by, 'tower');
      if (curPanel === 'dex') refreshPanel('dex');
      reGoal();
    });
    var off2 = rt.subscribe('shiguang5.boss', function (p) {
      if (p && p.by) toast(p.by + ' 惊醒了' + ZONE_NAMES[p.z] + '的守护者', 'warn');
    });
    var off3 = rt.subscribe('shiguang5.tide', function (p) {
      if (!p) return;
      if (p.phase === 'start') {
        showChapterTide(p.n, p.boss);
        toast('长夜潮汐：' + p.n + ' —— 去守灯！', 'warn');
      } else if (p.phase === 'end') {
        toast(p.n + '的潮汐退了');
      }
    });
    var off4 = rt.subscribe('shiguang5.emote', function (p) {
      if (p && p.e) showEmote(p);
    });
    // 双人互动是「附近所有人都看得见」的事，走广播而不是个人事件
    var off5 = rt.subscribe('shiguang5.act', function (p) {
      if (p && p.a) spawnActFx(p);
    });
    var off6 = rt.subscribe('shiguang5.friend', function (p) {
      if (p && p.an) feedPush(p.an + ' 和 ' + p.bn + ' 成了朋友', 'story');
    });
    S.onDestroyAll.push(off1, off2, off3, off4, off5, off6);
  }

  // ---------------- §18 动作接口 ----------------
  function apiRespawn() {
    apiPost('/shiguang/v5/respawn').then(function (d) {
      var me = S.me;
      me.x = d.x; me.y = d.y; me.hp = d.hp; me.mp = d.mp || me.mp;
      me.down = 0;
      S.cam.x = me.x * TILE; S.cam.y = me.y * TILE;
      showDead(false);
      toast('你在拾光镇醒了过来');
    }, function () { toast('复活失败，再试一次', 'warn'); });
  }

  function apiChest(c) {
    apiPost('/shiguang/v5/chest', { id: c.id }).then(function (d) {
      S.chests[c.id] = 1;
      auSfx('secret', 0.42, 1);
      S.texts.push({ x: c.x + 0.5, y: c.y, txt: '+' + d.shards, crit: 0, life: 1.1, max: 1.1, vy: -1, vx: 0, gold: 1 });
      if (d.item) toast('宝箱：' + rarityName(d.item.rarity) + '「' + d.item.name + '」', 'good');
      else if (d.full) toast('背包满了，装备没能带走', 'warn');
      if (d.mat) toast('材料 +' + d.mat[1], 'good');
      auSfx('bonus', 0.4, 1);
    }, function (err) { toast(err.message || '打不开', 'warn'); });
  }

  function apiWaystone(w) {
    apiPost('/shiguang/v5/waystone', { id: w.id }).then(function (d) {
      if ((S.waystones || []).indexOf(w.id) < 0) S.waystones.push(w.id);
      toast(d.fresh ? '传送石亮起来了 · 已记录' : '传送石已激活');
      auSfx('secret', 0.4, 1.1);
      S.rings.push({ x: w.x + 0.5, y: w.y + 0.5, r: 0, max: 2.4, life: 0.5, max2: 0.5, col: '#9fe0ff' });
    }, function (err) { toast(err.message || '没有反应', 'warn'); });
  }

  // v5.6 W1：panelBusy 单飞锁（buy/sell/forge/talent）—— 在途时点击丢弃，第 3 次连续丢弃弹 toast
  function apiBuy(id, n) {
    var r = sg5Gate('panelBusy', document.activeElement, function () {
      return apiPost('/shiguang/v5/shop', { id: id, n: n }).then(function (d) {
        S.me.shards = d.shards;
        S.me.mats = d.mats;
        toast('买好了');
        auSfx('coin', 0.35, 1.15);
        refreshPanel('shop');
      }, function (err) { toast(err.message || '买不了', 'warn'); });
    });
    if (!r) return;
    r.then(function () {}, function () {});
  }

  function apiUse(id) {
    apiPost('/shiguang/v5/use', { id: id }).then(function (d) {
      S.me.hp = d.hp; S.me.mp = d.mp; S.me.mats = d.mats;
      auSfx('power', 0.3, 1.2);
      refreshPanel('bag');
    }, function (err) { toast(err.message || '用不了', 'warn'); });
  }

  function apiEquip(uid) {
    apiPost('/shiguang/v5/equip', { uid: uid }).then(function (d) {
      S.me.equip = d.equip;
      S.me.bag = d.bag;
      S.stats = d.stats || S.stats;
      S.me.maxHp = d.maxHp;
      S.me.hp = d.hp || S.me.hp;
      toast('换上了');
      auSfx('menu', 0.3, 1.1);
      refreshPanel('bag');
    }, function (err) { toast(err.message || '换不了', 'warn'); });
  }

  function apiUnequip(slot) {
    apiPost('/shiguang/v5/unequip', { slot: slot }).then(function (d) {
      S.me.equip = d.equip;
      S.me.bag = d.bag;
      S.stats = d.stats || S.stats;
      S.me.maxHp = d.maxHp;
      refreshPanel('char');
    }, function (err) { toast(err.message || '卸不下来', 'warn'); });
  }

  // v5.6 W3：sell 扩参 —— uids（装备）或 mats（材料 {gel:5,...}）都走这一条
  function apiSell(payload) {
    var body = payload && payload.uids ? { uids: payload.uids } : (payload && payload.mats ? { mats: payload.mats } : { uids: payload });
    var r = sg5Gate('panelBusy', document.activeElement, function () {
      return apiPost('/shiguang/v5/sell', body).then(function (d) {
        S.me.bag = d.bag != null ? d.bag : S.me.bag;
        S.me.mats = d.mats != null ? d.mats : S.me.mats;
        S.me.shards = d.shards;
        toast('卖了 ' + d.gain + ' 星屑');
        auSfx('coin', 0.3, 1);
        refreshPanel('bag');
        if (curPanel === 'shop') refreshPanel('shop');
      }, function (err) { toast(err.message || '卖不了', 'warn'); });
    });
    if (!r) return;
    r.then(function () {}, function () {});
  }

  function apiForge(slot) {
    var r = sg5Gate('panelBusy', document.activeElement, function () {
      return apiPost('/shiguang/v5/forge', { slot: slot, mat: 'ore' }).then(function (d) {
        S.me.equip = d.equip;
        S.me.shards = d.shards;
        S.me.mats = d.mats;
        toast('重铸完成：' + d.item.name);
        auSfx('magic', 0.5, 0.9);
        refreshPanel('forge');
      }, function (err) { toast(err.message || '打不了', 'warn'); });
    });
    if (!r) return;
    r.then(function () {}, function () {});
  }

  function apiTalent(line) {
    var r = sg5Gate('panelBusy', document.activeElement, function () {
      return apiPost('/shiguang/v5/talent', { line: line }).then(function (d) {
        S.me.talents = d.talents;
        S.me.talentLeft = d.left;
        S.stats = d.stats || S.stats;
        S.me.maxHp = d.maxHp;
        toast('点亮：' + d.tier.name);
        auSfx('levelup', 0.4, 1.2);
        refreshPanel('talent');
      }, function (err) { toast(err.message || '点不了', 'warn'); });
    });
    if (!r) return;
    r.then(function () {}, function () {});
  }

  function apiRest() {
    toast('歇了一会儿 —— 生命回满了');
    apiPost('/shiguang/v5/use', { id: 'potion' }).then(function (d) {
      S.me.hp = d.hp;
    }, function () {
      // 没有药也要能休息：交给服务端下一个 tick 的自然回复（脱战回血）
      S.me.hp = S.me.maxHp;
    });
    closePanel();
  }

  function apiLook(look) {
    apiPost('/shiguang/v5/look', { look: look }).then(function () {
      S.me.look = look;
      drawFace(look);
    }, function () {});
  }

  function apiInvite(to) {
    apiPost('/shiguang/v5/party/invite', { to: to }).then(function () {
      toast('邀请已发出');
    }, function (err) { toast(err.message || '邀请失败', 'warn'); });
  }
  function apiAcceptInvite() {
    apiPost('/shiguang/v5/party/accept').then(function (d) {
      S.party = d.party;
      toast('加入队伍', 'good');
      uiParty();
    }, function (err) { toast(err.message || '没有邀请', 'warn'); });
  }
  function apiLeaveParty() {
    apiPost('/shiguang/v5/party/leave', {}).then(function () {
      S.party = null;
      toast('已离队');
      uiParty();
    }, function () {});
  }
  function apiRevive(to) {
    apiPost('/shiguang/v5/revive', { to: to }).then(function () {
      toast('正在扶起…', 'good');
    }, function (err) { toast(err.message || '扶不起来', 'warn'); });
  }
  function apiQuest(q) {
    apiPost('/shiguang/v5/quest/claim', { q: q }).then(function (d) {
      S.quests = d.quests;
      if (d.reward) {
        toast('支线完成：+' + d.reward.shards + ' 星屑', 'good');
        if (d.reward.item) setTimeout(function () { toast('获得「' + d.reward.item.name + '」', 'good'); }, 800);
      } else {
        toast('交好了，他还有下文');
      }
      refreshPanel(curPanel);
    }, function (err) { toast(err.message || '交不了', 'warn'); });
  }
  function apiCave(id) {
    apiPost('/shiguang/v5/cave', { id: id }).then(function (d) {
      toast('洞窟试炼开始 —— 打倒守心的精英', 'warn');
      auSfx('alert', 0.5, 1);
    }, function (err) { toast(err.message || '进不去', 'warn'); });
  }
  function apiEmote(e) {
    apiPost('/shiguang/v5/emote', { e: e }).then(null, function () {});
  }

  function apiLeave() {
    try { apiPost('/shiguang/v5/leave').then(null, function () {}); } catch (e) {}
  }


  // ======================== 12_boot.js ========================
  // ---------------- §19 启动与主循环 ----------------
  var raf = 0, lastT = 0, syncTimer = 0, miniAt = 0, hudAt = 0, ambientAt = 0;
  var root = null, ctx = null, canvas = null;

  function resize() {
    if (!root || !canvas) return;
    var w = root.clientWidth || 320;
    var h = root.clientHeight || 240;
    var dpr = Math.min(2, window.devicePixelRatio || 1);
    S.view.w = w;
    S.view.h = h;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.width = w + 'px';
      canvas.style.height = h + 'px';
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = false;
    // 整数缩放：视口越大，看得越远；平板与桌面都能落到 3 或 4 倍
    var z = Math.round(Math.min(w / 380, h / 270));
    S.zoom = clamp(z, 3, 4);
  }

  // v5.6：实体预算。任何一层漏了 capPush 也不至于撑爆内存 —— 主循环每帧兜一次底。
  function trimBudgets() {
    if (S.parts.length > 400) S.parts.splice(0, S.parts.length - 400);
    if (S.texts.length > 60) S.texts.splice(0, S.texts.length - 60);
    if (S.orbs.length > 320) S.orbs.splice(0, S.orbs.length - 320);
    if (S.corpses.length > 24) S.corpses.splice(0, S.corpses.length - 24);
    if (S.pillars.length > 12) S.pillars.splice(0, S.pillars.length - 12);
  }

  // v5.6：帧步进拆出来 —— __sg5.tick(ms) 手动驱动时绝不重复排 rAF（否则回调指数增殖）。
  function step(ts) {
    var t = ts / 1000;
    if (!lastT) lastT = t;
    var dt = Math.min(0.05, t - lastT);
    lastT = t;
    if (dt <= 0) return;
    S.time += dt;

    if (!document.hidden && S.ready && !S.paused) {
      // v5.6 W1：逐帧段整段包 try/catch —— 一行异常绝不能打断 rAF 链（用户「玩一半卡死」的根因）。
      // catch 只记日志并继续下一帧；socialTick 内部的农场判定另有自己的双保险（15_farm）。
      try {
        var freeze = S.hitstopUntil && S.time < S.hitstopUntil;
        var scale = 1;
        if (S.slow && S.time < S.slow.until) scale = S.slow.scale;
        else if (S.slow) S.slow = null;
        var ds = freeze ? 0 : dt * scale;
        if (ds > 0) {
          updatePlayer(ds, S.time);
          resolveAttack(S.me, S.time);
          updateMobs(ds, S.time);
          updatePlayers(ds);
          updateShots(ds);
          updateOrbs(ds, S.time);
          ambient(ds);
        }
        camUpdate(dt);
        trimBudgets();
        renderWorld(freeze ? 0 : dt);
        socialTick(S.time);
      } catch (e) {
        if (!loop.errAt || S.time - loop.errAt > 1) {
          loop.errAt = S.time;
          console.error('[sg5-loop]', e);
        }
      }
      try {
      // HUD 不需要 60Hz
      if (S.time - hudAt > 0.2) { hudAt = S.time; uiUpdate(); }
      if (S.time - miniAt > 0.12) { miniAt = S.time; uiMini(); }
      if (S.time - ambientAt > 12) { ambientAt = S.time; saveVisited(); }
      if (S.hurtT > 0) {
        S.hurtT -= dt;
        var a = clamp(S.hurtT / 0.28, 0, 1) * 0.5;
        if (a > 0.01) {
          var g = ctx.createRadialGradient(S.view.w / 2, S.view.h / 2, Math.min(S.view.w, S.view.h) * 0.25,
            S.view.w / 2, S.view.h / 2, Math.max(S.view.w, S.view.h) * 0.62);
          g.addColorStop(0, 'rgba(180,30,30,0)');
          g.addColorStop(1, 'rgba(180,30,30,' + a.toFixed(3) + ')');
          ctx.fillStyle = g;
          ctx.fillRect(0, 0, S.view.w, S.view.h);
        }
      }
      // v5.6 W4 不灭：0.2s 白闪 + 1s 金色 vignette
      if (S.cheatVgUntil && S.time < S.cheatVgUntil) {
        var vg = ctx.createRadialGradient(S.view.w / 2, S.view.h / 2, Math.min(S.view.w, S.view.h) * 0.2,
          S.view.w / 2, S.view.h / 2, Math.max(S.view.w, S.view.h) * 0.66);
        vg.addColorStop(0, 'rgba(255,214,120,0)');
        vg.addColorStop(1, 'rgba(255,196,90,' + (0.34 * clamp((S.cheatVgUntil - S.time) / 1.0, 0, 1)).toFixed(3) + ')');
        ctx.fillStyle = vg;
        ctx.fillRect(0, 0, S.view.w, S.view.h);
        if (S.time < (S.cheatVgUntil - 0.8)) {
          ctx.fillStyle = 'rgba(255,248,230,' + (0.5 * (1 - (S.cheatVgUntil - 0.8 - S.time) / 0.2 > 0 ? (S.cheatVgUntil - 0.8 - S.time) / 0.2 : 0)).toFixed(3) + ')';
          ctx.fillRect(0, 0, S.view.w, S.view.h);
        }
      } else if (S.cheatVgUntil && S.time >= S.cheatVgUntil) {
        S.cheatVgUntil = 0;
      }
      // v5.6 W4 s4 见切：完美闪避成功瞬间的 0.15s 白边闪光
      if (S.pdFlashUntil && S.time < S.pdFlashUntil) {
        ctx.strokeStyle = 'rgba(255,255,255,0.85)';
        ctx.lineWidth = Math.max(3, S.zoom * 1.5);
        ctx.strokeRect(1, 1, S.view.w - 2, S.view.h - 2);
      }
      } catch (e2) {
        console.error('[sg5-loop-hud]', e2);
      }
    }
  }

  function loop(ts) {
    raf = window.requestAnimationFrame(loop);
    step(ts);
  }

  // 环境粒子：每个区域有自己的「空气」
  function ambient(dt) {
    var z = S.zone;
    var me = S.me;
    // 夜里的萤火虫：镇上、草原、森林才有。慢、亮、少 —— 多了就成了噪点。
    if ((S.phase === 'night' || S.phase === 'dusk') &&
        (z === 'town' || z === 'meadow' || z === 'forest') && me && Math.random() < dt * 3.2) {
      S.parts.push({
        x: me.x + (Math.random() - 0.5) * 22, y: me.y + (Math.random() - 0.5) * 14,
        vx: (Math.random() - 0.5) * 0.35, vy: (Math.random() - 0.5) * 0.25,
        life: 2.6 + Math.random() * 2.2, max: 4.8,
        col: 'rgba(226,255,160,', r: 1.5
      });
    }
    if (Math.random() > dt * 8) return;
    var ox = (Math.random() - 0.5) * 26, oy = (Math.random() - 0.5) * 18;
    if (z === 'swamp') {
      S.parts.push({ x: me.x + ox, y: me.y + oy, vx: 0.2, vy: -0.25, life: 2.4, max: 2.4, col: '#d8ff9a', r: 1.1 });
    } else if (z === 'frost') {
      S.parts.push({ x: me.x + ox, y: me.y - 6 + Math.random() * 4, vx: 0.35, vy: 0.9, life: 4, max: 4, col: '#ffffff', r: 1.2 });
    } else if (z === 'crag') {
      S.parts.push({ x: me.x + ox, y: me.y + oy, vx: -0.4, vy: -0.1, life: 1.6, max: 1.6, col: '#c9bda8', r: 1 });
    } else if (z === 'abyss') {
      S.parts.push({ x: me.x + ox, y: me.y + oy, vx: 0, vy: -0.5, life: 2.2, max: 2.2, col: '#b48cff', r: 1.2 });
    } else if (z === 'forest') {
      S.parts.push({ x: me.x + ox, y: me.y + oy, vx: 0.6, vy: 0.15, life: 2.6, max: 2.6, col: 'rgba(160,220,150,', r: 1 });
    }
  }

  // ---------------- §20 挂载 ----------------
  function mount(container, context) {
    S.api = context.data.api;
    S.storage = context.data.storage;
    S.realtime = context.data.realtime;
    S.context = context;
    S.onDestroyAll = [];
    S.parts = [];
    S.texts = [];
    S.beams = [];
    S.rings = [];
    // v5.6 W3：奖励实体层（磁吸星屑珠 / 尸体 / 装备光柱）
    S.orbs = [];
    S.corpses = [];
    S.pillars = [];
    S.orbSfxAt = 0;
    S.orbStreak = 0;
    S.orbMergeTxt = '';
    S.orbMergeAt = 0;
    S.mobs = {};
    S.players = {};
    S.mobs = {};
    S.ready = false;
    S.paused = false;
    S.hitstopUntil = 0;
    S.slow = null;
    S.hurtT = 0;

    var cleanups = [];
    function onDestroy(fn) {
      if (typeof fn === 'function') {
        cleanups.push(fn);
        try { context.app.onDestroy(fn); } catch (e) {}
      }
    }

    root = el('div', 'sg5-root');
    canvas = document.createElement('canvas');
    canvas.className = 'sg5-cv';
    root.appendChild(canvas);
    container.appendChild(root);
    ctx = canvas.getContext('2d', { alpha: false });
    S.ctx = ctx;

    uiBuild(root);
    var input = inputBind(root, onDestroy);
    input.attachJoy(UI.joy, UI.joy.firstChild);

    // 音效偏好
    try {
      var snd = S.storage.get('snd', '1');
      S.audio.on = snd !== '0';
    } catch (e) {}
    auInit(function (p) { return context.app.assetUrl(p); });
    auSetOn(S.audio.on);

    // 尺寸
    resize();
    if (typeof window.ResizeObserver === 'function') {
      var ro = new window.ResizeObserver(function () { resize(); });
      ro.observe(root);
      onDestroy(function () { ro.disconnect(); });
    }
    var rsTimer = setInterval(resize, 900);
    onDestroy(function () { clearInterval(rsTimer); });
    var onWinResize = function () { resize(); };
    window.addEventListener('resize', onWinResize, false);
    onDestroy(function () { window.removeEventListener('resize', onWinResize); });

    // 第一次交互解锁音频（自动播放策略）
    var unlock = function () { auResume(); };
    root.addEventListener('mousedown', unlock, false);
    root.addEventListener('touchstart', unlock, false);
    onDestroy(function () {
      root.removeEventListener('mousedown', unlock);
      root.removeEventListener('touchstart', unlock);
    });

    // 面板快捷键
    var kp = function (e) {
      var k = (e.key || '').toLowerCase();
      if (k === 'escape') { closePanel(); return; }
      if (e.target && e.target.tagName === 'INPUT') return;
      if (k === 'p') {
        // 有邀请卡就当成「接受」，没有才走旧的按 P 入队
        if (S.inviteCard && S.inviteCard.node) {
          var pb = S.inviteCard.node.querySelector('.sg5-btn-primary');
          if (pb) pb.click();
        } else if (S.pendingInvite) { apiAcceptInvite(); S.pendingInvite = ''; }
        return;
      }
      if (k === 'g') { apiEmote(EMOTE_SET[Math.floor(Math.random() * EMOTE_SET.length)].id); return; }
      if (k === 'f') { openPanel('social'); return; }
      if (k === 'c') openPanel('char');
      else if (k === 'b' || k === 'i') openPanel('bag');
      else if (k === 'm') openPanel('map');
      else if (k === 't') openPanel('talent');
      else if (k === 'v' || k === 'j' && e.shiftKey) openPanel('dex');
    };
    document.addEventListener('keydown', kp, false);
    onDestroy(function () { document.removeEventListener('keydown', kp, false); });

    // 后台省电
    var onVis = function () {
      if (document.hidden) {
        try { if (AU.a) AU.a.pause(); if (AU.b) AU.b.pause(); } catch (e) {}
      } else if (AU.on && AU.cur) {
        auMusic(AU.cur, true);
      }
    };
    document.addEventListener('visibilitychange', onVis, false);
    onDestroy(function () { document.removeEventListener('visibilitychange', onVis); });

    // ---- 载入 ----
    var loading = el('div', 'sg5-loading');
    var ring = el('div', 'sg5-loadring');
    loading.appendChild(ring);
    var lt = el('div', 'sg5-loadtext', '正在渡海…');
    loading.appendChild(lt);
    root.appendChild(loading);
    UI.loading = loading;
    UI.loadText = lt;

    function fail(msg) {
      loading.className = 'sg5-loading is-error';
      setText(lt, msg || '海面起了雾，没能靠岸');
      var retry = el('button', 'sg5-btn', '再试一次');
      retry.type = 'button';
      retry.addEventListener('click', function () {
        loading.className = 'sg5-loading';
        setText(lt, '正在渡海…');
        if (retry.parentNode) loading.removeChild(retry);
        boot();
      }, false);
      loading.appendChild(retry);
    }

    function boot() {
      setText(lt, '正在展开群岛…');
      loadTerrain().then(function (data) {
        setText(lt, '正在点亮灯…');
        worldInit(data);
        S.towers = data.lights || {};
        return apiPost('/shiguang/v5/enter');
      }).then(function (d) {
        setText(lt, '正在醒来…');
        // 精灵图必须先解码完，否则第一帧会全是空白
        return loadAtlas().then(function () { return d; });
      }).then(function (d) {
        applyEnter(d);
        bindPlayerClick(canvas, root, onDestroy);
        S.ready = true;
        showIntro();
        loading.className = 'sg5-loading is-done';
        setTimeout(function () { if (loading.parentNode) loading.parentNode.removeChild(loading); }, 420);
        if (syncTimer) clearInterval(syncTimer);
        syncTimer = setInterval(syncOnce, SYNC_MS);
        onDestroy(function () { clearInterval(syncTimer); });
        syncOnce();
        auMusic('town');
        setTimeout(function () {
          toast('J 攻击 · K 翻滚 · L 技能 · E 交互 · M 地图', 'tip');
        }, 1400);
      }, function (err) {
        fail(err && err.message ? err.message : '');
      });
    }

    function loadAtlas() {
      return new Promise(function (resolve) {
        var img = new Image();
        img.onload = function () { S.atlas = img; resolve(); };
        img.onerror = function () { fail('素材加载失败'); resolve(); };
        img.src = context.app.assetUrl('frontend/v5/atlas.png');
      });
    }

    if (!raf) raf = window.requestAnimationFrame(loop);
    onDestroy(function () {
      if (raf) window.cancelAnimationFrame(raf);
      raf = 0;
      if (syncTimer) clearInterval(syncTimer);
      syncTimer = 0;
      saveVisited();
      apiLeave();
      auDispose();
      for (var i = 0; i < S.onDestroyAll.length; i++) {
        try { if (typeof S.onDestroyAll[i] === 'function') S.onDestroyAll[i](); } catch (e) {}
      }
    });

    boot();

    // 对外暴露一点调试接口（线上排查用，不影响玩家）
    // v5.8 守夜仪式状态卡：S.finale.open 期间常驻右下，1.2s 轮询服务端权威进度
    function finaleUiPaint() {
      var F = S.finale;
      if (!F || (!F.open && !F.meWaiting) || F.done) {
        if (UI.finaliteEl && UI.finaliteEl.parentNode) UI.finaliteEl.parentNode.removeChild(UI.finaliteEl);
        UI.finaliteEl = null;
        return;
      }
      if (!UI.finaliteEl) {
        UI.finaliteEl = el('div', 'sg5-finalite sg5-frame');
        UI.hud.appendChild(UI.finaliteEl);
      }
      var need = F.threshold || Math.min(3, Math.max(1, F.waiters || 1));
      var secs = F.startedAt ? Math.min(60, Math.max(0, Math.round(((F.now || Date.now()) - F.startedAt) / 1000))) : 0;
      var line = F.meWaiting ? '守夜中 · ' + (F.waiters || 1) + ' 人 · 第 ' + secs + ' / 60 秒' : '举灯同守 · 现在 ' + (F.waiters || 0) + ' / ' + need + ' 人（塔下按 E）';
      var el2 = UI.finaliteEl;
      el2.innerHTML = '';
      el2.appendChild(el('div', 'sg5-finalite-title', '最后的守夜'));
      el2.appendChild(el('div', 'sg5-finalite-line', line));
      var bar = el('div', 'sg5-finalite-bar');
      var fill = el('div', 'sg5-finalite-fill');
      fill.style.width = Math.round((F.startedAt ? secs / 60 : (F.waiters || 0) / need) * 100) + '%';
      bar.appendChild(fill);
      el2.appendChild(bar);
    }
    // 守夜轮询：finale open 时每 1.2s 拉一次权威状态（句柄挂 S，重连自动恢复）
    S.finalePollAt = 0;
    var _socialTickFinale = socialTick;
    socialTick = function (tt) {
      _socialTickFinale(tt);
      try {
        if (S.finale && (S.finale.open || S.finale.meWaiting) && !S.finale.done) {
          if (tt - S.finalePollAt > 1.2) {
            S.finalePollAt = tt;
            apiPost('/shiguang/v5/finalite', { act: 'status' }).then(function (r) {
              if (r && r.data) { S.finale = r.data; finaleUiPaint(); }
            }).catch(function () {});
          }
        }
      } catch (e) {}
    };

    try {
      // v5.6 W1：手动驱动主循环（headless rAF 节流 / 截图机用）。advance 一次 ≈ 16ms。
      window.__sg5 = {
        state: S,
        tick: function (ms) {
          var n = Math.max(1, Math.min(600, Math.round((ms || 16) / 16)));
          for (var i = 0; i < n; i++) {
            try { step(performance.now()); } catch (e) {}
          }
          return S.time;
        },
        mobs: function () { return S.mobs; },
        teleport: function (x, y) {
          if (S.me) { S.me.x = x; S.me.y = y; S.cam.x = x * TILE; S.cam.y = y * TILE; }
        },
        panel: function (id) { if (id) openPanel(id); else closePanel(); },
        diag: function () {
          var vr = viewRange();
          var n = { tree: 0, rock: 0, props: PROPS.length, draw: DRAW.length, zoom: S.zoom, mobs: Object.keys(S.mobs).length, atlas: !!S.atlas };
          for (var ty = vr.y0; ty <= vr.y1; ty++) {
            for (var tx = vr.x0; tx <= vr.x1; tx++) {
              var t = tileAt(tx, ty);
              if (t === T.TREE || t === T.PINE) n.tree++;
              else if (t === T.ROCK) n.rock++;
            }
          }
          return n;
        },
        attack: function () { IN.attack = 1; },
        roll: function () { IN.roll = 1; },
        skill: function () { IN.skill = 1; },
        use: function () { IN.use = 1; },
        interact: function () { IN.use = 1; },   // v5.7：语义别名（visual 探针用 interact 触发 E）
        testFinale: function (ev) { handleEvent(ev); },   // v5.8：注入守夜/终章事件（回归用）
        finalite: function (act) {
          return apiPost('/shiguang/v5/finalite', { act: act || 'status' }).then(function (r) {
            if (r && r.data) { S.finale = r.data; finaleUiPaint(); }
            return r && r.data;
          });
        },
        testEvent: function (e) { handleEvent(e); },   // v5.7：注入事件（灯语仪式卡等）回归用
        toast: toast,
        social: function () {
          return { friends: S.friends.length, nearby: S.nearby.length, acts: Object.keys(S.acts || {}).length,
            party: !!(S.party && S.party.members && S.party.members.length), bubbles: S.bubbles.length };
        },
        card: function () { cardFriendReq({ from: '1002', n: '小明' }); },
        actfx: function () {
          spawnActFx({ x: S.me.x, y: S.me.y, a: 'dance', ch: '♪', fn: '我', tn: '小明' });
          pushBubble(S.myId, '一起跳舞吧！', '#ffe1a6');
        },
        // 调试用：锁住昼夜（截图/回归时不想等到夜里）
        lockPhase: function (phase, pf) {
          S.pfLock = !!phase;
          if (phase) {
            S.phase = phase;
            // 每个时段的默认进度要合理：night + pf=0.3 算出来的暗度只有 0.32，看起来像白天
            S.pf = pf == null ? (phase === 'night' ? 0.94 : phase === 'dusk' ? 0.68 : 0.3) : pf;
          }
        }
      };
    } catch (e) {}
  }

  // 开场：2 秒的标题，然后交给世界
  function showIntro() {
    var iv = el('div', 'sg5-intro');
    iv.appendChild(el('div', 'sg5-intro-title', '拾光群岛'));
    iv.appendChild(el('div', 'sg5-intro-sub', '长 夜'));
    iv.appendChild(el('div', 'sg5-intro-line'));
    iv.appendChild(el('div', 'sg5-intro-hint', S.me && S.me.isNew ? '第 一 夜 · 灯 还 亮 着' : '回 到 灯 边'));
    root.appendChild(iv);
    setTimeout(function () { iv.className = 'sg5-intro is-out'; }, 1500);
    setTimeout(function () { if (iv.parentNode) iv.parentNode.removeChild(iv); }, 2600);
  }

  function unmount(container) {
    if (!container) return;
    while (container.firstChild) container.removeChild(container.firstChild);
    try { if (window.__sg5) delete window.__sg5; } catch (e) {}
  }


  // ======================== 13_social.js ========================
  // ---------------- §15.5 社交层（点人 / 表情 / 潮汐卡） ----------------
  // 校园里最重要的一步是「看见同班同学」。所以：点一下同学就能邀请组队、扶起、发表情。

  S.emotes = [];
  S.party = null;
  S.quests = {};
  S.tideInfo = null;
  S.pendingInvite = '';

  var EMOTE_SET = [
    { id: 'wave', ch: '👋', name: '打招呼' },
    { id: 'heart', ch: '❤', name: '比心' },
    { id: 'note', ch: '♪', name: '来首歌' },
    { id: 'zzz', ch: 'Zz', name: '困了' },
    { id: 'spark', ch: '✦', name: '好耶' },
    { id: 'ask', ch: '?', name: '救命' }
  ];

  function showEmote(p) {
    var found = null;
    for (var i = 0; i < EMOTE_SET.length; i++) if (EMOTE_SET[i].id === p.e) found = EMOTE_SET[i];
    if (!found) return;
    S.emotes.push({ x: p.x, y: p.y, ch: found.ch, id: p.e, until: S.time + 2.4 });
    if (S.emotes.length > 12) S.emotes.shift();
  }

  function drawEmotes() {
    if (!S.emotes.length) return;
    var ctx = S.ctx;
    for (var i = S.emotes.length - 1; i >= 0; i--) {
      var e = S.emotes[i];
      if (S.time > e.until) { S.emotes.splice(i, 1); continue; }
      var left = (e.until - S.time) / 2.4;          // 剩余比例
      var age = 2.4 - (e.until - S.time);
      var pop = clamp(age / 0.28, 0, 1);
      // 弹出时轻微过冲（像弹簧），随后稳住；再慢慢上飘、淡出
      var sc = (0.55 + 0.45 * easeOut(pop)) * (1 + 0.18 * Math.sin(pop * Math.PI));
      var x = w2sX(e.x * TILE);
      var y = w2sY(e.y * TILE) - 34 - (1 - left) * 16 + Math.sin(S.time * 4.2 + e.x) * 1.1;
      var bw = Math.round(30 * (S.zoom / 3)), bh = Math.round(26 * (S.zoom / 3));
      ctx.save();
      ctx.globalAlpha = Math.min(1, left * 2.6);
      ctx.translate(x, y - bh * 0.34);
      ctx.scale(sc, sc);
      // 硬边像素气泡：深底 + 暖色上下边 + 一个朝下的小尖
      ctx.fillStyle = 'rgba(14,11,20,0.90)';
      ctx.fillRect(-bw / 2, -bh / 2, bw, bh);
      ctx.fillStyle = 'rgba(255,214,140,0.85)';
      ctx.fillRect(-bw / 2, -bh / 2, bw, 2);
      ctx.fillRect(-bw / 2, bh / 2 - 2, bw, 2);
      ctx.fillRect(-3, bh / 2, 6, 2);
      ctx.fillRect(-1, bh / 2 + 2, 2, 2);
      ctx.font = Math.round(16 * (S.zoom / 3)) + 'px system-ui,sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillText(e.ch, 1, 6 * (S.zoom / 3) + 1);
      ctx.fillStyle = '#fff2c8';
      ctx.fillText(e.ch, 0, 6 * (S.zoom / 3));
      ctx.restore();
    }
  }

  // ---- 点同学：一个小的上下文菜单（DOM，跟着屏幕坐标走） ----
  var pmenuEl = null;
  function closePlayerMenu() {
    if (pmenuEl && pmenuEl.parentNode) pmenuEl.parentNode.removeChild(pmenuEl);
    pmenuEl = null;
  }

  function openPlayerMenu(p, sx, sy) {
    closePlayerMenu();
    var box = el('div', 'sg5-pmenu sg5-frame');
    box.appendChild(el('div', 'sg5-pmenu-name', p.name || '旅人'));
    var inParty = S.party && S.party.members && S.party.members.some(function (m) { return m[0] === p.id; });
    var isFriend = false;
    for (var fi = 0; fi < (S.friends || []).length; fi++) if (S.friends[fi].u === p.id) isFriend = true;
    if (isFriend) {
      var bd = (S.bonds || {})[p.id] || 0;
      box.appendChild(el('div', 'sg5-pmenu-bond', '✦ 羁绊 ' + bd + ' · ' + bondTierLabel(bd)));
    }

    var ops = el('div', 'sg5-pmenu-ops');
    if (!isFriend) {
      ops.appendChild(uiBtn('加好友', 'sg5-btn-sm sg5-btn-ghost', function () {
        apiFriend(p.id, 'request'); closePlayerMenu();
      }));
    } else {
      ops.appendChild(uiBtn('悄悄话', 'sg5-btn-sm sg5-btn-ghost', function () {
        S.chatWith = p.id; S.socialTab = 'chat'; openPanel('social'); closePlayerMenu();
      }));
    }
    ops.appendChild(uiBtn('一起互动', 'sg5-btn-sm', function () {
      openActPicker(p.id); closePlayerMenu();
    }));
    box.appendChild(ops);

    if (!inParty) {
      box.appendChild(uiBtn('邀请组队', 'sg5-btn-sm sg5-btn-ghost', function () {
        apiInvite(p.id); closePlayerMenu();
      }));
    }
    if (p.down && inParty) {
      box.appendChild(uiBtn('扶起他', 'sg5-btn-sm', function () {
        apiRevive(p.id); closePlayerMenu();
      }));
    }
    var row = el('div', 'sg5-pmenu-emotes');
    EMOTE_SET.forEach(function (e) {
      var b = el('button', 'sg5-emote-btn', e.ch);
      b.type = 'button';
      b.setAttribute('title', e.name);
      b.addEventListener('click', function () { apiEmote(e.id); closePlayerMenu(); }, false);
      row.appendChild(b);
    });
    box.appendChild(row);
    if (S.party && inParty) {
      box.appendChild(uiBtn('退出队伍', 'sg5-btn-sm sg5-btn-ghost', function () {
        apiLeaveParty(); closePlayerMenu();
      }));
    }
    UI.hud.appendChild(box);
    var w = 190;
    var left = clamp(sx - w / 2, 8, S.view.w - w - 8);
    var top = clamp(sy - 10, 8, S.view.h - 260);
    box.style.left = left + 'px';
    box.style.top = top + 'px';
    pmenuEl = box;
  }

  function hitPlayer(sx, sy) {
    var wx = s2wX(sx) / TILE, wy = s2wY(sy) / TILE;
    var best = null, bd = 1.2;
    for (var id in S.players) {
      var p = S.players[id];
      var d = dist(wx, wy, p.x, p.y + 0.4);
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  }

  function bindPlayerClick(canvas, root, onDestroy) {
    var onTap = function (e) {
      var rect = canvas.getBoundingClientRect();
      var sx, sy;
      if (e.changedTouches && e.changedTouches.length) {
        sx = e.changedTouches[0].clientX - rect.left;
        sy = e.changedTouches[0].clientY - rect.top;
      } else {
        sx = e.clientX - rect.left;
        sy = e.clientY - rect.top;
      }
      var p = hitPlayer(sx, sy);
      if (p) openPlayerMenu(p, sx, sy);
      else closePlayerMenu();
    };
    canvas.addEventListener('click', onTap, false);
    onDestroy(function () { canvas.removeEventListener('click', onTap); });
  }

  // ---- 潮汐开场卡 ----
  function showChapterTide(zoneName, boss) {
    if (!UI.chEl) return;
    UI.chTitle.textContent = '长夜潮汐 · ' + zoneName;
    UI.chText.textContent = '雾从地面翻上来，比夜更黑。' +
      (boss ? '「' + boss + '」走在最前面 —— 它身后是整片长夜。' : '') +
      '到场的人一起守灯，撑到最后的人按贡献分星屑。灯灭之前，别退。';
    UI.chEl.className = 'sg5-chapter is-on';
    auSfx('alert', 0.55, 0.9);
    setTimeout(function () { UI.chEl.className = 'sg5-chapter'; }, 5200);
  }

  // ---- 支线面板（NPC 对话里展开） ----
  function questBlock(qid) {
    var q = (S.questDefs || {})[qid];
    var st = (S.quests || {})[qid];
    if (!q || !st) return null;
    var box = el('div', 'sg5-quest');
    var head = el('div', 'sg5-quest-head');
    head.appendChild(el('span', 'sg5-quest-name', q.name));
    head.appendChild(el('span', 'sg5-quest-step', '第 ' + Math.min(st.step + 1, q.steps.length) + ' / ' + q.steps.length + ' 步'));
    box.appendChild(head);
    if (st.done) {
      box.appendChild(el('div', 'sg5-quest-say', '「这条线走完了。你比我想的能扛。」'));
    } else {
      var step = q.steps[st.step];
      box.appendChild(el('div', 'sg5-quest-say', '「' + step.say + '」'));
      var prog = el('div', 'sg5-quest-prog');
      var fill = el('i');
      var f = clamp(st.prog / (st.need || 1), 0, 1);
      fill.style.transform = 'scaleX(' + f.toFixed(3) + ')';
      prog.appendChild(fill);
      box.appendChild(prog);
      box.appendChild(el('div', 'sg5-quest-num', st.prog + ' / ' + st.need + (step.type === 'mats' ? '（材料）' : (step.type === 'kill' ? '（击杀）' : '（灯塔）'))));
      var b = uiBtn(st.ready ? '交付' : '还差一点', 'sg5-btn-sm', function () { apiQuest(qid); });
      b.disabled = !st.ready;
      box.appendChild(b);
    }
    return box;
  }


  // ======================== 14_social_ui.js ========================
  // ---------------- §21 一起玩：好友 / 附近 / 悄悄话 / 双人互动 ----------------
  // 一个班在同一张地图上，最难的不是打怪，是「找到那个人、说上话、留下点什么」。
  // 这一层只做三件事：把关系显示出来、把邀请做成能点的卡片、把互动画成看得见的动画。
  // 服务端才是关系与羁绊的真相，这里所有列表都来自 /v5/social/state。
  S.friends = [];
  S.friendReq = null;
  S.bonds = {};
  S.nearby = [];
  S.whispers = [];
  S.partyChat = [];
  S.acts = {};
  S.chatWith = '';
  S.socialTab = 'friends';
  S.bubbles = [];
  S.actFx = [];
  S.rallyMark = null;
  S.inviteCard = null;
  var socialAt = 0;

  var ACT_FALLBACK = {
    highfive: { name: '击掌', ch: '✋' }, hug: { name: '抱一下', ch: '♥' },
    dance: { name: '一起跳舞', ch: '♪' }, cheer: { name: '加油', ch: '✦' },
    bow: { name: '行个礼', ch: '☺' }, star: { name: '一起看星星', ch: '★' }
  };
  var BOND_COLORS = ['#8e8069', '#8ee8b8', '#6fc0ff', '#d9b8ff', '#ffd27a'];

  function actDef(a) { return S.acts[a] || ACT_FALLBACK[a] || { name: '互动', ch: '✦' }; }
  function bondColor(tier) {
    var names = ['初识', '同行', '挚友', '知己', '莫逆'];
    var i = names.indexOf(tier);
    return BOND_COLORS[i < 0 ? 0 : i];
  }
  function bondTierLabel(v) {
    return v >= 240 ? '莫逆' : v >= 100 ? '知己' : v >= 40 ? '挚友' : v >= 10 ? '同行' : '初识';
  }

  // ---- 数据 ----
  function applySocial(d) {
    if (!d) return;
    S.friends = d.friends || S.friends;
    S.nearby = d.nearby || S.nearby;
    S.whispers = d.whispers || S.whispers;
    S.friendReq = d.req || null;
    if (curPanel === 'social') refreshPanel('social');
    if (S.friendReq && !S.inviteCard) cardFriendReq(S.friendReq);
  }
  function apiSocialState(cb) {
    apiGet('/shiguang/v5/social/state').then(function (d) {
      applySocial(d);
      if (cb) cb(d);
    }, function () {});
  }
  function socialTick(t) {
    if (t - socialAt < 9) return;
    socialAt = t;
    // 面板开着或有待处理邀请时才轮询；世界里每秒 5 次的 sync 不背这个包袱
    if (curPanel === 'social' || S.friendReq || S.inviteCard) apiSocialState();
  }

  function apiFriend(to, mode) {
    apiPost('/shiguang/v5/friend/' + mode, { to: to }).then(function (d) {
      if (d && d.friends) S.friends = d.friends;
      if (mode === 'remove') toast('已从好友名单里移除', 'tip');
      apiSocialState();
    }, function (err) { toast(err.message || '没发出去', 'warn'); });
  }
  function apiWhisper(to, text) {
    apiPost('/shiguang/v5/whisper', { to: to, text: text }).then(function (d) {
      S.whispers.push({ from: S.myId, to: to, n: nameOf(to), text: d.text, at: Date.now(), self: 1 });
      if (S.whispers.length > 40) S.whispers.shift();
      pushBubble(to, d.text, '#ffe1a6');
      if (curPanel === 'social' && S.socialTab === 'chat') refreshPanel('social');
    }, function (err) { toast(err.message || '没送出去', 'warn'); });
  }
  function apiAct(to, a, mode) {
    var body = { to: to, a: a };
    if (mode) body[mode] = 1;
    apiPost('/shiguang/v5/social/act', body).then(function (d) {
      if (mode === 'accept') {
        closeInviteCard();
        toast('羁绊 +' + (d.bond || 0) + ' · ' + actDef(a).name, 'good');
      } else if (mode === 'decline') {
        closeInviteCard();
        toast('这次先算了', 'tip');
      } else {
        toast('邀请「' + actDef(a).name + '」已发出，等他回应', 'good');
      }
    }, function (err) { toast(err.message || '邀请没发出去', 'warn'); });
  }
  function apiPartySay(text) {
    apiPost('/shiguang/v5/party/say', { text: text }).then(function (d) {
      S.partyChat.push({ from: S.myId, n: S.me.name || '我', text: d.text, at: Date.now(), self: 1 });
      if (S.partyChat.length > 30) S.partyChat.shift();
      pushBubble(S.myId, d.text, '#a8d8ff');
      if (curPanel === 'social' && S.socialTab === 'party') refreshPanel('social');
    }, function (err) { toast(err.message || '没发出去', 'warn'); });
  }
  function apiRally() {
    apiPost('/shiguang/v5/party/rally', {}).then(function () {
      toast('集合令已发给队友', 'good');
    }, function (err) { toast(err.message || '发不出去', 'warn'); });
  }

  function nameOf(uid) {
    if (uid === S.myId) return (S.me && S.me.name) || '我';
    var p = S.players[uid];
    if (p && p.name) return p.name;
    for (var i = 0; i < S.friends.length; i++) if (S.friends[i].u === uid) return S.friends[i].n;
    for (var j = 0; j < S.nearby.length; j++) if (S.nearby[j].u === uid) return S.nearby[j].n;
    return '旅人';
  }

  // ---- 邀请卡：把「按 P 接受」换成能点的东西 ----
  function closeInviteCard() {
    if (S.inviteCard && S.inviteCard.node && S.inviteCard.node.parentNode) {
      S.inviteCard.node.className = 'sg5-invite is-out';
      var n = S.inviteCard.node;
      setTimeout(function () { if (n.parentNode) n.parentNode.removeChild(n); }, 320);
    }
    S.inviteCard = null;
  }
  function showInviteCard(cfg) {
    closeInviteCard();
    if (!UI.hud) return;
    var box = el('div', 'sg5-invite');
    var top = el('div', 'sg5-invite-top');
    top.appendChild(el('span', 'sg5-invite-ch', cfg.ch || '✦'));
    top.appendChild(el('span', 'sg5-invite-title', cfg.title || '有人找你'));
    box.appendChild(top);
    box.appendChild(el('div', 'sg5-invite-text', cfg.text || ''));
    var row = el('div', 'sg5-invite-ops');
    (cfg.ops || []).forEach(function (op) {
      var b = uiBtn(op.label, op.cls || '', function () {
        closeInviteCard();
        op.fn();
      });
      row.appendChild(b);
    });
    box.appendChild(row);
    UI.hud.appendChild(box);
    S.inviteCard = { node: box, until: S.time + (cfg.ttl || 24) };
    auSfx('menu', 0.28, 1.35);
    // 显式 setTimeout 也要跟着卸载走，避免应用关掉后还弹一张卡
    var tm = setTimeout(function () {
      if (S.inviteCard && S.inviteCard.node === box) closeInviteCard();
    }, (cfg.ttl || 24) * 1000);
    if (S.onDestroyAll) S.onDestroyAll.push(function () { clearTimeout(tm); });
  }
  function cardFriendReq(req) {
    showInviteCard({
      ch: '✦', title: '好友申请', text: req.n + ' 想和你成为朋友 —— 一起打怪会攒下羁绊。', ttl: 60,
      ops: [
        { label: '成为朋友', cls: 'sg5-btn-primary', fn: function () { apiPost('/shiguang/v5/friend/accept', {}).then(function (d) { if (d.friends) S.friends = d.friends; toast('你们成了朋友', 'good'); apiSocialState(); }, function (err) { toast(err.message, 'warn'); }); } },
        { label: '待会儿', cls: 'sg5-btn-ghost', fn: function () { S.friendReq = null; } }
      ]
    });
  }
  function cardActInvite(e) {
    var d = actDef(e.a);
    showInviteCard({
      ch: d.ch, title: e.n + ' 想和你' + d.name, text: '走到他身边，点一下「回应」就一起做。回应之后两个人的羁绊会涨一点。', ttl: 30,
      ops: [
        { label: '回应 · ' + d.name, cls: 'sg5-btn-primary', fn: function () { apiAct(e.from, e.a, 'accept'); } },
        { label: '婉拒', cls: 'sg5-btn-ghost', fn: function () { apiAct(e.from, e.a, 'decline'); } }
      ]
    });
  }
  function cardPartyInvite(e) {
    showInviteCard({
      ch: '⚑', title: '组队邀请', text: e.n + ' 邀你一起走 —— 同队打怪有经验加成，倒下了还能被扶起来。', ttl: 60,
      ops: [
        { label: '加入队伍', cls: 'sg5-btn-primary', fn: function () { apiAcceptInvite(); } },
        { label: '待会儿', cls: 'sg5-btn-ghost', fn: function () { S.pendingInvite = ''; } }
      ]
    });
  }

  // ---- 互动动作选择 ----
  function openActPicker(to) {
    var old = UI.hud.querySelector('.sg5-actpicker');
    if (old && old.parentNode) old.parentNode.removeChild(old);
    var box = el('div', 'sg5-actpicker sg5-frame');
    box.appendChild(el('div', 'sg5-pmenu-name', '和 ' + nameOf(to) + ' 一起…'));
    var grid = el('div', 'sg5-actgrid');
    Object.keys(ACT_FALLBACK).forEach(function (a) {
      var d = actDef(a);
      var b = el('button', 'sg5-actpick', d.ch + ' ' + d.name);
      b.type = 'button';
      b.addEventListener('click', function () {
        if (box.parentNode) box.parentNode.removeChild(box);
        apiAct(to, a);
      }, false);
      grid.appendChild(b);
    });
    box.appendChild(grid);
    box.appendChild(uiBtn('关闭', 'sg5-btn-sm sg5-btn-ghost', function () {
      if (box.parentNode) box.parentNode.removeChild(box);
    }));
    UI.hud.appendChild(box);
    setTimeout(function () { if (box.parentNode) box.parentNode.removeChild(box); }, 12000);
  }

  // ---- 事件（由 11_net.js 的 handleEvent 转过来；返回 1 表示已处理） ----
  function socialEvent(e) {
    if (!e || !e.k) return 0;
    switch (e.k) {
      case 'friend-req':
        S.friendReq = { from: e.from, n: e.n };
        cardFriendReq(S.friendReq);
        return 1;
      case 'friend-sent': toast('好友申请已发给 ' + e.n, 'good'); return 1;
      case 'friend-add':
        toast('和 ' + e.n + ' 成了朋友', 'good');
        auSfx('bonus', 0.35, 1.2);
        apiSocialState();
        return 1;
      case 'friend-remove': toast(e.n + ' 把你从好友名单里移除了', 'tip'); apiSocialState(); return 1;
      case 'act-invite': cardActInvite(e); return 1;
      case 'act-wait': toast('等 ' + e.n + ' 回应「' + e.an + '」…', 'tip'); return 1;
      case 'act-done': toast('和 ' + e.n + ' ' + actDef(e.a).name + ' ✦', 'good'); apiSocialState(); return 1;
      case 'act-decline': toast(e.n + ' 这会儿不方便', 'tip'); return 1;
      case 'whisper':
        S.whispers.push({ from: e.from, to: S.myId, n: e.n, text: e.text, at: e.at || Date.now(), self: 0 });
        if (S.whispers.length > 40) S.whispers.shift();
        pushBubble(e.from, e.text, '#ffe1a6');
        toast('✉ ' + e.n + '：' + e.text, 'good');
        auSfx('menu', 0.22, 1.5);
        if (curPanel === 'social' && S.socialTab === 'chat') refreshPanel('social');
        return 1;
      case 'whisper-echo': return 1;   // 发送方已本地入列
      case 'party-chat':
        S.partyChat.push({ from: e.from, n: e.n, text: e.text, at: e.at || Date.now(), self: 0 });
        if (S.partyChat.length > 30) S.partyChat.shift();
        pushBubble(e.from, e.text, '#a8d8ff');
        toast('队伍 · ' + e.n + '：' + e.text);
        if (curPanel === 'social' && S.socialTab === 'party') refreshPanel('social');
        return 1;
      case 'rally':
        S.rallyMark = { x: e.x, y: e.y, until: S.time + 90, n: e.n, z: e.z };
        toast('⚑ ' + e.n + ' 在' + (e.z || '附近') + '召集集合', 'good');
        auSfx('alert', 0.3, 1.4);
        return 1;
      case 'rally-sent': return 1;
      case 'bond':
        S.bonds[e.u] = e.v;
        if (e.crossed) {
          toast('和 ' + e.n + ' 的羁绊成了「' + e.tier + '」', 'good');
          auSfx('levelup', 0.35, 1.25);
        }
        apiSocialState();
        return 1;
      case 'invite':
        S.pendingInvite = e.from;
        cardPartyInvite({ from: e.from, n: e.n });
        return 1;
      case 'invited': toast('组队邀请已发给 ' + e.n, 'good'); return 1;
    }
    return 0;
  }

  // ---- 头顶气泡 ----
  function pushBubble(uid, text, col) {
    var p = (uid === S.myId) ? S.me : S.players[uid];
    if (!p) return;
    S.bubbles.push({ x: p.x, y: p.y, text: String(text).slice(0, 26), col: col || '#ffe1a6', until: S.time + 4.2, born: S.time });
    if (S.bubbles.length > 10) S.bubbles.shift();
  }
  function spawnActFx(p) {
    if (!p) return;
    var d = actDef(p.a);
    S.actFx.push({ x: p.x, y: p.y, ch: d.ch, a: p.a, name: d.name, fn: p.fn, tn: p.tn, born: S.time, until: S.time + 2.6 });
    if (S.actFx.length > 6) S.actFx.shift();
    // 一圈星屑 + 两个人的头顶符号
    for (var i = 0; i < 14; i++) {
      var a = (i / 14) * 6.2832 + hash2(i, 3, 71);
      S.parts.push({
        x: p.x + Math.cos(a) * 0.35, y: p.y + Math.sin(a) * 0.25,
        vx: Math.cos(a) * 1.5, vy: Math.sin(a) * 1.2 - 0.6,
        life: 0.9 + hash2(i, 7, 72) * 0.6, max: 1.5,
        col: p.a === 'hug' || p.a === 'star' ? 'rgba(255,170,200,' : 'rgba(255,226,150,', r: 1.6
      });
    }
    S.rings.push({ x: p.x, y: p.y, r: 0, max: 2.4, life: 0.7, max2: 0.7, col: '#ffe6a8' });
    auSfx('bonus', 0.32, 1.3);
  }

  // ---- 世界层：气泡 / 互动 / 集合光标 ----
  function drawSocialFx(ctx) {
    var u = S.zoom * TILE;
    var i, k;
    // 互动：两人中间浮起一串符号 + 一圈柔光
    for (i = S.actFx.length - 1; i >= 0; i--) {
      var f = S.actFx[i];
      if (S.time > f.until) { S.actFx.splice(i, 1); continue; }
      var age = S.time - f.born, k2 = clamp(age / 2.6, 0, 1);
      var cx = w2sX(f.x * TILE), cy = w2sY(f.y * TILE) - u * 0.5;
      ctx.save();
      ctx.globalAlpha = (1 - k2) * 0.9;
      var gg = ctx.createRadialGradient(cx, cy, 0, cx, cy, u * 1.8);
      gg.addColorStop(0, 'rgba(255,224,160,0.26)');
      gg.addColorStop(1, 'rgba(255,224,160,0)');
      ctx.fillStyle = gg;
      ctx.fillRect(cx - u * 1.8, cy - u * 1.8, u * 3.6, u * 3.6);
      for (k = 0; k < 5; k++) {
        var ph = (age * 0.55 + k * 0.2) % 1;
        var ox = Math.sin(k * 2.1 + age * 2) * u * (0.4 + ph);
        var oy = -ph * u * 1.9;
        ctx.globalAlpha = (1 - ph) * (1 - k2) * 0.95;
        ctx.font = 'bold ' + Math.round(u * (0.30 + (1 - ph) * 0.12)) + 'px system-ui,sans-serif';
        ctx.textAlign = 'center';
        ctx.fillStyle = 'rgba(20,14,10,0.55)';
        ctx.fillText(f.ch, cx + ox + 1, cy + oy + 1);
        ctx.fillStyle = k % 2 ? '#ffd78a' : '#fff3d0';
        ctx.fillText(f.ch, cx + ox, cy + oy);
      }
      ctx.globalAlpha = 1;
      ctx.restore();
    }
    // 气泡：硬边像素框 + 小尖角，文字压一行阴影
    for (i = S.bubbles.length - 1; i >= 0; i--) {
      var b = S.bubbles[i];
      if (S.time > b.until) { S.bubbles.splice(i, 1); continue; }
      var pop = clamp((S.time - b.born) / 0.22, 0, 1);
      var fade = clamp((b.until - S.time) / 0.5, 0, 1);
      var bx = w2sX(b.x * TILE), by = w2sY(b.y * TILE) - u * 1.05 - Math.sin(S.time * 2.2 + i) * 2;
      ctx.save();
      ctx.globalAlpha = fade;
      ctx.font = Math.round(12 * (S.zoom / 3)) + 'px "SG5Pixel", monospace';
      var tw = ctx.measureText(b.text).width;
      var bw = Math.min(S.view.w * 0.42, tw + 20), bh = 26;
      var x0 = Math.round(bx - bw / 2), y0 = Math.round(by - bh);
      ctx.translate(bx, by);
      ctx.scale(0.7 + 0.3 * easeOut(pop), 0.7 + 0.3 * easeOut(pop));
      ctx.translate(-bx, -by);
      ctx.fillStyle = 'rgba(12,10,18,0.88)';
      ctx.fillRect(x0, y0, bw, bh);
      ctx.fillStyle = b.col;
      ctx.fillRect(x0, y0, bw, 2);
      ctx.fillRect(x0, y0 + bh - 2, bw, 2);
      ctx.fillRect(x0, y0, 2, bh);
      ctx.fillRect(x0 + bw - 2, y0, 2, bh);
      ctx.fillRect(bx - 4, y0 + bh, 8, 2);
      ctx.fillRect(bx - 2, y0 + bh + 2, 4, 2);
      ctx.fillStyle = '#f8efdd';
      ctx.textAlign = 'center';
      ctx.fillText(b.text, bx, y0 + 18);
      ctx.restore();
    }
    // 集合光标：队长发起后 90 秒内在地面闪一个圈与旗
    if (S.rallyMark) {
      if (S.time > S.rallyMark.until) S.rallyMark = null;
      else {
        var rx = w2sX(S.rallyMark.x * TILE), ry = w2sY(S.rallyMark.y * TILE);
        var pulse = 0.5 + 0.5 * Math.sin(S.time * 3.2);
        ctx.save();
        ctx.strokeStyle = 'rgba(255,214,120,' + (0.35 + pulse * 0.4).toFixed(2) + ')';
        ctx.lineWidth = Math.max(2, u * 0.06);
        ctx.beginPath();
        ctx.ellipse(rx, ry, u * (0.55 + pulse * 0.25), u * (0.24 + pulse * 0.1), 0, 0, 6.2832);
        ctx.stroke();
        ctx.fillStyle = '#ffd27a';
        ctx.fillRect(rx - 1, ry - u * 1.5, 2, u * 1.1);
        ctx.fillRect(rx + 1, ry - u * 1.5, u * 0.45, u * 0.30);
        ctx.restore();
      }
    }
  }

  // ---- 面板：好友 / 附近 / 悄悄话 / 队伍 ----
  function socialTabs(body) {
    var tabs = el('div', 'sg5-tabs');
    [['friends', '好友'], ['nearby', '附近的人'], ['chat', '悄悄话'], ['party', '队伍']].forEach(function (t) {
      var b = el('button', 'sg5-tab' + (S.socialTab === t[0] ? ' is-on' : ''), t[1]);
      b.type = 'button';
      b.addEventListener('click', function () {
        S.socialTab = t[0];
        refreshPanel('social');
        auSfx('menu', 0.2, 1.2);
      }, false);
      tabs.appendChild(b);
    });
    body.appendChild(tabs);
  }

  function personRow(p, isFriend) {
    var row = el('div', 'sg5-person' + (p.on === 0 || p.down ? ' is-off' : ''));
    var av = el('div', 'sg5-person-av');
    var faceKey = 'face_' + (p.look || 'NinjaBlue');
    if (!FR[faceKey]) faceKey = 'face_NinjaBlue';
    av.appendChild(iconCanvas(faceKey, 30));
    row.appendChild(av);
    var mid = el('div', 'sg5-person-mid');
    var head = el('div', 'sg5-person-head');
    head.appendChild(el('span', 'sg5-person-name', p.n));
    head.appendChild(el('span', 'sg5-person-lv', 'Lv.' + (p.lv || 1)));
    head.appendChild(el('span', 'sg5-person-state' + (p.on ? ' is-on' : ''), p.on ? (p.zone || '在线') : '离线'));
    mid.appendChild(head);
    if (isFriend) {
      var b = p.bond || 0;
      var bondRow = el('div', 'sg5-bondrow');
      bondRow.appendChild(el('span', 'sg5-bond-tier', '✦ ' + (p.tier || '初识')));
      var bar = el('div', 'sg5-bondbar');
      var fill = el('i');
      var from = p.bond == null ? 0 : 0, to = p.next || 100;
      var prev = 0;
      ['初识', '同行', '挚友', '知己', '莫逆'].forEach(function (nm, idx) {
        var th = [0, 10, 40, 100, 240][idx];
        if (b >= th) prev = th;
      });
      fill.style.transform = 'scaleX(' + clamp((b - prev) / Math.max(1, to - prev), 0, 1).toFixed(3) + ')';
      fill.style.background = bondColor(p.tier);
      bar.appendChild(fill);
      bondRow.appendChild(bar);
      bondRow.appendChild(el('span', 'sg5-bond-num', b + (p.next ? ' / ' + p.next : '')));
      mid.appendChild(bondRow);
    } else {
      mid.appendChild(el('div', 'sg5-person-sub', (p.zone || '某处') + ' · ' + (p.d != null ? p.d : '?') + ' 格外' + (p.pt ? ' · 同队' : '') + (p.fr ? ' · 已是好友' : '')));
    }
    row.appendChild(mid);
    var ops = el('div', 'sg5-person-ops');
    if (isFriend || p.fr) {
      ops.appendChild(uiBtn('私聊', 'sg5-btn-sm sg5-btn-ghost', function () {
        S.chatWith = p.u; S.socialTab = 'chat'; refreshPanel('social');
      }));
      ops.appendChild(uiBtn('互动', 'sg5-btn-sm', function () { openActPicker(p.u); }));
    } else {
      ops.appendChild(uiBtn('加好友', 'sg5-btn-sm', function () { apiFriend(p.u, 'request'); }));
      ops.appendChild(uiBtn('招呼', 'sg5-btn-sm sg5-btn-ghost', function () { apiEmote('wave'); toast('朝 ' + p.n + ' 挥了挥手'); }));
    }
    if (!p.pt) ops.appendChild(uiBtn('组队', 'sg5-btn-sm sg5-btn-ghost', function () { apiInvite(p.u); }));
    if (isFriend) {
      ops.appendChild(uiBtn('移除', 'sg5-btn-sm sg5-btn-ghost', function () { apiFriend(p.u, 'remove'); }));
    }
    row.appendChild(ops);
    return row;
  }

  function chatBody(body, list, toUid, onSend, placeholder) {
    var log = el('div', 'sg5-chatlog');
    if (!list.length) log.appendChild(el('div', 'sg5-empty', '还没有人说话 —— 先打个招呼吧'));
    list.slice(-24).forEach(function (m) {
      var line = el('div', 'sg5-chatline' + (m.self ? ' is-self' : ''));
      line.appendChild(el('span', 'sg5-chatwho', m.n || nameOf(m.from)));
      line.appendChild(el('span', 'sg5-chattxt', m.text));
      log.appendChild(line);
    });
    body.appendChild(log);
    var form = el('div', 'sg5-chatform');
    var input = el('input', 'sg5-input');
    input.type = 'text';
    input.maxLength = 60;
    input.setAttribute('placeholder', placeholder || '说点什么…');
    var send = uiBtn('发送', 'sg5-btn-sm', function () {
      var v = input.value.replace(/^\s+|\s+$/g, '');
      if (!v) return;
      input.value = '';
      onSend(v);
    });
    input.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter') { ev.preventDefault(); send.click(); }
      ev.stopPropagation();
    }, false);
    form.appendChild(input);
    form.appendChild(send);
    body.appendChild(form);
    setTimeout(function () { try { log.scrollTop = log.scrollHeight; } catch (e) {} }, 0);
  }

  PANELS.social = function () {
    var online = 0;
    for (var i = 0; i < S.friends.length; i++) if (S.friends[i].on) online++;
    var sh = panelShell('一起玩', '好友 ' + online + '/' + S.friends.length + ' 在线 · 附近 ' + S.nearby.length + ' 人');
    sh.root.className = 'sg5-panel sg5-panel-wide';
    var body = sh.body;
    socialTabs(body);

    if (S.socialTab === 'friends') {
      body.appendChild(el('div', 'sg5-note', '一起打怪、扶起、回应互动都会攒下羁绊。称号从「初识」一路到「莫逆」—— 别只和同一个人打怪。'));
      if (!S.friends.length) {
        body.appendChild(el('div', 'sg5-empty', '好友名单还是空的 · 去「附近的人」里找个同学打个招呼'));
      } else {
        var list = el('div', 'sg5-personlist');
        S.friends.forEach(function (p) { list.appendChild(personRow(p, true)); });
        body.appendChild(list);
      }
      if (S.friendReq) {
        body.appendChild(uiBtn('✦ 处理 ' + S.friendReq.n + ' 的好友申请', 'sg5-btn', function () { cardFriendReq(S.friendReq); }));
      }
      body.appendChild(uiBtn('刷新名单', 'sg5-btn-sm sg5-btn-ghost', function () { apiSocialState(); }));
    } else if (S.socialTab === 'nearby') {
      body.appendChild(el('div', 'sg5-note', '同一片视野里的同学。走近 3 格才能邀请互动 —— 隔着半张地图点人是没用的。'));
      if (!S.nearby.length) {
        body.appendChild(el('div', 'sg5-empty', '附近没有别人 · 去广场或灯塔那边看看'));
      } else {
        var nl = el('div', 'sg5-personlist');
        S.nearby.forEach(function (p) { nl.appendChild(personRow(p, false)); });
        body.appendChild(nl);
      }
      body.appendChild(uiBtn('重新看看', 'sg5-btn-sm sg5-btn-ghost', function () { apiSocialState(); }));
    } else if (S.socialTab === 'chat') {
      if (!S.friends.length) {
        body.appendChild(el('div', 'sg5-empty', '先加个好友，才能说悄悄话'));
      } else {
        var pick = el('div', 'sg5-chatpick');
        S.friends.forEach(function (p) {
          var b = el('button', 'sg5-chatwho-btn' + (S.chatWith === p.u ? ' is-on' : ''), p.n);
          b.type = 'button';
          b.addEventListener('click', function () { S.chatWith = p.u; refreshPanel('social'); }, false);
          pick.appendChild(b);
        });
        body.appendChild(pick);
        var to = S.chatWith;
        var talk = [];
        for (var j = 0; j < S.whispers.length; j++) {
          var w = S.whispers[j];
          if (w.from === to || w.to === to) talk.push(w);
        }
        if (!to) body.appendChild(el('div', 'sg5-empty', '选一个好友开始说话'));
        else chatBody(body, talk, to, function (v) { apiWhisper(to, v); }, '给 ' + nameOf(to) + ' 说一句…');
      }
    } else {
      var pt = S.party;
      if (!pt || !pt.members || !pt.members.length) {
        body.appendChild(el('div', 'sg5-empty', '还没有队伍 · 点别人头上的名字就能邀请'));
      } else {
        var pl = el('div', 'sg5-personlist');
        pt.members.forEach(function (m) {
          pl.appendChild(personRow({ u: m[0], n: m[1], lv: m[5], on: m[6] ? 1 : 0, look: 'NinjaBlue', pt: 1, down: m[4], zone: '' }, false));
        });
        body.appendChild(pl);
        var prow = el('div', 'sg5-partyops');
        if (pt.leader === S.myId) prow.appendChild(uiBtn('⚑ 召集队友', 'sg5-btn-sm', function () { apiRally(); }));
        prow.appendChild(uiBtn('退出队伍', 'sg5-btn-sm sg5-btn-ghost', function () { apiLeaveParty(); }));
        body.appendChild(prow);
      }
      body.appendChild(el('div', 'sg5-sect', '队伍频道'));
      chatBody(body, S.partyChat, '', function (v) { apiPartySay(v); }, '对队友说…');
    }
    return sh.root;
  };


  // ======================== 15_farm.js ========================
  // ---------------- §16 农场经营：状态 / 网络 / 世界层 ----------------
  // 扩展方式：只追加文件、不改旧文件。所有既有函数都用「保存原引用 → 重新赋值」包装，
  // 多次包装自动成链，一定先调 _orig 再干自己的事，避免吞掉 13/14 号文件的逻辑。

  S.farm = {
    p: null, data: null, tool: 'hoe', seed: '', tab: 'field',
    lastPoll: 0, epoch: 0, dirty: 0, rtBound: 0, qte: null,
    relationTab: 'villagers', mineTab: 'fish', sel: null, bagSel: null,
    loadState: 'loading', lastError: '', relGiftTo: '',
    // v5.5：新手引导去重（localStorage sg5hint 持久化）+ 丰收展展台态
    hintSeen: {}, exhibitMode: false, exhibitSel: []
  };

  function farmClock(progress) {
    var mins = 6 * 60 + Math.floor(Math.max(0, Math.min(1, progress)) * 20 * 60);
    var h24 = Math.floor(mins / 60) % 24, m = mins % 60;
    return (h24 < 10 ? '0' : '') + h24 + ':' + (m < 10 ? '0' : '') + m;
  }
  function farmP() { return S.farm.p; }
  function farmD() { return S.farm.data || {}; }
  function farmCal() { return (S.farm.p && S.farm.p.cal) || {}; }
  function farmItemName(id) {
    var P = farmP();
    if (P && P.prices && typeof P.prices[id] !== 'undefined') { /* 名称本地算，价格用服务端 */ }
    var parts = String(id || '').split('_q'), base = parts[0], q = parts[1] ? Number(parts[1]) : 0;
    var D = farmD(), n = '';
    if (base.indexOf('seed_') === 0) n = (D.CROPS[base.slice(5)] ? D.CROPS[base.slice(5)].name : base.slice(5)) + '种子';
    else if (D.CROPS && D.CROPS[base]) n = D.CROPS[base].name;
    else if (D.ANIMALS && D.ANIMALS[base]) n = D.ANIMALS[base].name;
    else {
      var FIX = { egg: '鸡蛋', big_egg: '大鸡蛋', duck_egg: '鸭蛋', duck_feather: '鸭毛',
        milk: '牛奶', big_milk: '大牛奶', goat_milk: '羊奶', big_goat_milk: '大瓶羊奶',
        wool: '羊毛', big_wool: '优质羊毛', truffle: '松露', hay: '干草', wood: '木材',
        stone: '石头', coal: '煤', copper: '铜矿石', iron: '铁矿石', gold: '金矿石',
        iridium: '铱矿石', gem: '宝石', speedgro: '生长激素', quality_fert: '高级肥料',
        sprinkler: '洒水器', bait: '鱼饵', rod: '鱼竿', furnace: '熔炉', seeds: '混合种子',
        skull_key: '头骨钥匙' };
      var F = D.FISH || [], O = D.ORES || [];
      for (var i = 0; i < F.length; i++) if (F[i].id === base) n = F[i].name;
      if (!n) for (var j = 0; j < O.length; j++) if (O[j].id === base) n = O[j].name;
      if (!n) n = FIX[base] || (D.ITEM_NAMES && D.ITEM_NAMES[base]) || base;
    }
    return n + (q ? ' ' + (D.QUALITY && D.QUALITY[q] ? D.QUALITY[q].name : '★' + q) : '');
  }
  function farmItemColor(id) {
    var base = String(id || '').split('_q')[0], D = farmD();
    if (base.indexOf('seed_') === 0) base = base.slice(5);
    if (D.CROPS && D.CROPS[base]) return D.CROPS[base].col;
    var F = D.FISH || [];
    for (var i = 0; i < F.length; i++) if (F[i].id === base) return '#8fc4d8';
    var O = D.ORES || [];
    for (var j = 0; j < O.length; j++) if (O[j].id === base) return '#a9a29a';
    var M = { hay: '#d8c27a', wood: '#a9814f', hardwood: '#8a6a48', coal: '#4a4a52', copper: '#c98452',
      iron: '#c8cdd4', gold: '#e5c45c', iridium: '#b9e6e2', gem: '#b58ad8',
      egg: '#f2e7c8', milk: '#eef1f4', wool: '#f0eade', truffle: '#8b6b52',
      crab: '#e87858',
      copper_bar: '#c98452', iron_bar: '#c8cdd4', gold_bar: '#e5c45c', iridium_bar: '#b9e6e2',
      mayonnaise: '#f6efc0', cheese: '#e8c060', pale_ale: '#e8b84a', beer: '#d89830',
      food_soup: '#e8d8a0', food_stirfry: '#a8c860', food_grilled: '#d8a06a', food_sushi: '#e8e0c8',
      food_bento: '#c8a878', food_cookie: '#d8b070', food_tea: '#88b080', food_honey: '#e0a840',
      ticket: '#c9963f',
      horseradish: '#e8e2d0', daffodil: '#f0d858', leek: '#b8cc88', dandelion: '#f0c840',
      spice_berry: '#d86a4a', sweet_pea: '#c878d8', summer_grape: '#8868b8',
      hazelnut: '#a87848', wild_plum: '#8858a8', blackberry: '#585878',
      crystal_fruit: '#a8e0e8', snow_yam: '#e8d0b0', winter_root: '#c8a878' };
    return M[base] || '#c8b48a';
  }
  function farmQualityColor(id) {
    var q = Number(String(id || '').split('_q')[1] || 0), D = farmD();
    return (D.QUALITY && D.QUALITY[q] && D.QUALITY[q].col) || '#e8d7a8';
  }

  // ---------- 后端字段 → 客户端状态 ----------
  function farmApply(p) {
    if (!p) return;
    S.farm.p = p;
    S.farm.data = p.data || S.farm.data;
    S.farm.epoch = Date.now() - (p.cal.progress || 0) * (p.cal.dayMs || 90000);
    if (!S.farm.seed) {
      var seeds = farmSeedList();
      S.farm.seed = seeds.length ? seeds[0] : '';
    }
    S.farm.dirty = 0;
    S.farm.loadState = 'ok';
    S.farm.lastError = '';
    if (UI.farmClock) farmHudPaint();
  }
  function farmSeedList() {
    var D = farmD(), P = farmP(), out = [], inv = (P && P.inv) || {};
    for (var k in inv) {
      if (!Object.prototype.hasOwnProperty.call(inv, k)) continue;
      if (k.indexOf('seed_') === 0 && inv[k] > 0) out.push(k);
    }
    out.sort();
    return out;
  }
  function farmState() {
    S.farm.loadState = 'loading';
    return apiGet('/shiguang/v5/farm/state').then(function (d) {
      if (d && d.farm) farmApply(d.farm);
      else S.farm.loadState = 'ok';
      return d;
    }, function (e) {
      // v5.3：失败也绝不把 S.farm.p 清成 null —— 面板继续显示上一次的旧数据，
      // 不渲染「正在载入…」空态。错误条由 farmErrBlock 负责，还能点「重新载入」。
      S.farm.loadState = 'error';
      S.farm.lastError = (e && e.message) || '农场数据没能载入';
      if (curPanel === 'farm' || curPanel === 'relation' || curPanel === 'mine') refreshPanel(curPanel);
      return null;
    });
  }
  // v5.6 W1：farmBusy 全局单飞锁（farmAct/lifeAct 全部动作，含 mine）—— 在途时新请求直接丢弃。
  function farmAct(path, body) {
    return sg5Gate('farmBusy', document.activeElement, function () {
      return apiPost('/shiguang/v5/farm/' + path, body || {}).then(function (d) {
        if (d && d.farm) farmApply(d.farm);
        actSfx('farm', path, d);
        S.farm.lastError = '';
        if (curPanel === 'farm' || curPanel === 'relation' || curPanel === 'mine') refreshPanel(curPanel);
        return d;
      }, function (e) {
        S.farm.lastError = (e && e.message) || '操作没能完成';
        if (curPanel === 'farm' || curPanel === 'relation' || curPanel === 'mine') refreshPanel(curPanel);
        throw e;   // 保留调用方原有的 toast(err.message,'warn') 失败分支
      });
    }) || Promise.resolve(null);
  }
  function lifeAct(path, body) {
    return sg5Gate('farmBusy', document.activeElement, function () {
      return apiPost('/shiguang/v5/life/' + path, body || {}).then(function (d) {
        if (d && d.farm) farmApply(d.farm);
        actSfx('life', path, d);
        S.farm.lastError = '';
        if (curPanel === 'farm' || curPanel === 'relation' || curPanel === 'mine') refreshPanel(curPanel);
        return d;
      }, function (e) {
        S.farm.lastError = (e && e.message) || '操作没能完成';
        if (curPanel === 'farm' || curPanel === 'relation' || curPanel === 'mine') refreshPanel(curPanel);
        throw e;
      });
    }) || Promise.resolve(null);
  }
  function farmToast(text, kind) { toast(text, kind || ''); auSfx('menu', 0.2, 1.1); }

  // ---------- v5.4 音效：夜里（18:00–06:00）自动把音量压到 6 折 ----------
  function farmSfx(name, vol, rate) {
    var v = vol == null ? 0.3 : vol;
    try {
      var clock = farmCal().clock || '';
      var h = Number(String(clock).split(':')[0]) || 0;
      if (h >= 18 || h < 6) v = v * 0.6;
    } catch (e) {}
    auSfx(name, v, rate || 1);
  }
  // 各动作的音效映射表（主理人定死）：[键, 音量, 音高]
  var ACT_SFX = {
    'farm/till': ['hit', 0.3, 0.7],
    'farm/water': ['fx', 0.22, 1.3],
    'farm/plant': ['fx', 0.2, 0.8],
    'farm/fertilize': ['fx', 0.2, 1.0],
    'farm/harvest': ['accept', 0.35, 1.1],
    'farm/sell': ['coin', 0.45, 1.0],
    'farm/ship': ['impact', 0.22, 1.3],
    'farm/buy': ['coin', 0.4, 1.1],
    'farm/tool': ['bonus', 0.45, 1.0],
    'farm/profession': ['secret', 0.45, 1.2],
    'life/craft': ['success', 0.4, 1.15],
    'life/eat': ['accept', 0.3, 0.75],
    'life/forage/pick': ['accept', 0.3, 1.3],
    'life/chop': ['sword2', 0.4, 0.75],
    'life/mine/dig': ['hit3', 0.35, 0.9],
    'life/bundle': ['spirit', 0.45, 1.0],
    'life/festival': ['bonus', 0.4, 1.25],
    'life/marry': ['magic', 0.45, 1.15],
    'life/bouquet': ['magic', 0.4, 1.1],
    'life/egg/pick': ['coin', 0.45, 1.2],
    'life/egg/redeem': ['bonus', 0.4, 1.15],
    'life/fish/contest/claim': ['bonus', 0.45, 1.2],
    'life/exhibit/submit': ['success', 0.45, 1.1]
  };
  function actSfx(kind, path, d) {
    var key = kind + '/' + path, s = ACT_SFX[key];
    if (!s) return;
    if (key === 'life/chop') {           // 砍树：斧声 + 一拍之后的闷响
      farmSfx(s[0], s[1], s[2]);
      setTimeout(function () { farmSfx('impact', 0.5, 0.8); }, 130);
      return;
    }
    if (key === 'life/mine/dig') {       // 挖矿：正常是敲石声，被打晕是警报
      farmSfx(d && d.down ? 'alert' : 'hit3', d && d.down ? 0.4 : 0.35, d && d.down ? 0.85 : 0.9);
      return;
    }
    if (key === 'life/craft') {          // 熔炼低沉一些，其它加工亮一些
      farmSfx('success', 0.4, d && d.skill === 'mining' ? 0.9 : 1.15);
      return;
    }
    farmSfx(s[0], s[1], s[2]);
  }

  // ---------- HUD：星露谷同款的时钟 / 季节 / 金币 / 体力 / 工具栏 ----------
  // v5.4：设备在世界层的摆放顺序（与商店列表一致）
  var MACHINE_ORDER = ['furnace', 'mayo_machine', 'cheese_press', 'keg', 'stove'];
  var FARM_TOOLS = [
    { id: 'hoe', name: '锄头', ch: '⊐', key: '1' },
    { id: 'watercan', name: '水壶', ch: '◔', key: '2' },
    { id: 'seed', name: '种子', ch: '✿', key: '3' },
    { id: 'sickle', name: '镰刀', ch: '⌁', key: '4' },
    { id: 'rod', name: '鱼竿', ch: '⌇', key: '5' },
    { id: 'pickaxe', name: '矿镐', ch: '⛏', key: '6' }
  ];
  function farmHudPaint() {
    var P = farmP(); if (!P) return;
    var c = farmCal();
    if (UI.farmClock) setText(UI.farmClock, farmClock((Date.now() - S.farm.epoch) / (c.dayMs || 90000)));
    if (UI.farmDate) setText(UI.farmDate, c.seasonName + ' ' + c.dayInSeason + '日 · ' + (c.year || 1) + '年');
    if (UI.farmWeather) setText(UI.farmWeather, c.weather === 'rain' ? '☂ 雨' : c.weather === 'snow' ? '❄ 雪' : '☀ 晴');
    if (UI.farmGold) setText(UI.farmGold, String(P.gold) + 'g');
    if (UI.farmEnergy) {
      var pct = Math.max(0, Math.min(1, P.energy / (P.maxEnergy || 100)));
      // v5.3：血条只动 transform，不碰 width（和 09_ui_hud 的 scaleX 一个口径）
      UI.farmEnergy.style.transform = 'scaleX(' + pct.toFixed(3) + ')';
      UI.farmEnergy.className = 'sg5-farm-energy-fill' + (pct < 0.3 ? ' is-low' : '');
      var enWrap = UI.farmEnergy.parentNode;
      if (enWrap && enWrap.setAttribute) {
        enWrap.setAttribute('aria-valuenow', String(Math.round(pct * 100)));
        enWrap.setAttribute('aria-label', pct < 0.3 ? '体力偏低' : '体力');
      }
    }
    if (UI.farmToolBtns) {
      for (var i = 0; i < UI.farmToolBtns.length; i++) {
        var b = UI.farmToolBtns[i], on = b.getAttribute('data-tool') === S.farm.tool;
        b.className = 'sg5-farm-tool' + (on ? ' is-on' : '');
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
      }
    }
    if (UI.farmSeedLabel) {
      setText(UI.farmSeedLabel, S.farm.seed ? farmItemName(S.farm.seed) : '没种子了');
    }
    if (UI.farmFestival) {
      var fes = c.festival;
      UI.farmFestival.style.display = fes ? '' : 'none';
      if (fes) setText(UI.farmFestival, '✦ ' + fes.name);
    }
    if (UI.farmToolNext || UI.farmNear) farmHintPaint();
  }
  // v5.4：两条只读提示统一在这里刷（farmHudPaint 与每帧 socialTick 都调它；
  // 走动 / 传送都要跟着变，setText 自带相等判断，不变就零开销）
  // v5.5：彩蛋优先级最高，同帧撞上采集物也让位（并联动把 forage 引导标记为已看）
  function farmHintPaint() {
    // v5.5：彩蛋节 chip 只在「彩蛋节 + 草原」出现；满 12 变绿（每帧刷，传送换区也即时）
    if (UI.farmEggChip) {
      var ep = farmP();
      var show = isEggDay() && S.zone === 'meadow' && ep && ep.eggHunt;
      UI.farmEggChip.style.display = show ? '' : 'none';
      if (show) {
        var full = ep.eggHunt.found >= ep.eggHunt.total;
        setText(UI.farmEggChip, '彩蛋节 · ' + ep.eggHunt.found + '/' + ep.eggHunt.total);
        UI.farmEggChip.className = 'sg5-farm-chip sg5-farm-eggchip' + (full ? ' is-full' : '');
      }
    }
    if (UI.farmToolNext) {
      var nx = farmNextAction();
      setText(UI.farmToolNext, nx ? 'E：' + nx : '');
    }
    if (UI.farmNear) {
      var ne = farmNearEgg(), nf = ne ? null : farmNearForage(), txt = '';
      if (ne) txt = 'E：捡彩蛋';
      else if (nf) txt = 'E：采集 ' + farmItemName(nf.item);
      else {
        var nt = farmNearTree();
        if (nt) txt = nt.ready ? 'E：砍树' : '这棵树刚砍过，过几天再来';
      }
      setText(UI.farmNear, txt);
    }
    farmHintTick();
  }

  // ---------- v5.5 新手引导：单例提示条（五键矩阵 till/forage/egg/fish/panel） ----------
  // 每帧在 farmHintPaint 里查一次，命中即显示 8 秒后淡出；看过一次就永久去重，
  // 记录存 localStorage 'sg5hint'，跨日不重置。触屏不区分文案。
  var HINT_TEXT = {
    till: '走进自家田里了：按 E 翻土，手上拿着的工具就是干活的工具',
    forage: '身边有野味：按 E 采集，背包里多一份收成',
    egg: '彩蛋节：草原上藏着 12 颗彩蛋，走近按 E 捡，彩券去农场面板「商店」换奖励',
    fish: '到水边了：按 H 打开钓鱼，甩竿把绿条对准鱼',
    panel: '第一次收成了：按 N 打开农场面板，商店 / 背包 / 出货都在里面'
  };
  var hintEl = null, hintKey = '', hintUntil = 0;
  function farmHintLoad() {
    try {
      var raw = window.localStorage ? window.localStorage.getItem('sg5hint') : '';
      var o = raw ? JSON.parse(raw) : null;
      if (o && typeof o === 'object') S.farm.hintSeen = o;
    } catch (e) {}
  }
  function farmHintSave() {
    try { if (window.localStorage) window.localStorage.setItem('sg5hint', JSON.stringify(S.farm.hintSeen)); } catch (e) {}
  }
  // v5.5：dock 入口角标 seen 记录（S.storage 'sg5new'），首次打开 farm/relation/mine 后摘标
  function sg5NewLoad() {
    try { return JSON.parse(S.storage.get('sg5new', '{}') || '{}') || {}; } catch (e) { return {}; }
  }
  function sg5NewMark(id) {
    try {
      var news = sg5NewLoad();
      if (news[id] === 1) return;
      news[id] = 1;
      S.storage.set('sg5new', JSON.stringify(news));
    } catch (e) {}
  }
  function farmHintShow(key) {
    if (!UI.hud) return;
    if (!hintEl) {
      hintEl = el('div', 'sg5-hint', '');
      hintEl.setAttribute('role', 'status');
      UI.hud.appendChild(hintEl);
    }
    hintKey = key; hintUntil = Date.now() + 8000;
    if (!S.farm.hintSeen[key]) { S.farm.hintSeen[key] = 1; farmHintSave(); }
    setText(hintEl, HINT_TEXT[key] || '');
    hintEl.className = 'sg5-hint is-on';
  }
  function farmHintHide() {
    if (hintEl && hintKey) { hintEl.className = 'sg5-hint'; hintKey = ''; }
  }
  function farmHintTick() {
    if (!UI.hud) return;
    var hs = S.farm.hintSeen, P = farmP(), key = '';
    if (!hs.till && farmNear()) key = 'till';
    else if (!hs.forage && farmNearForage()) key = 'forage';
    else if (!hs.egg && isEggDay() && S.zone === 'meadow' && P && P.eggsLeft && P.eggsLeft.length) {
      key = 'egg';
      if (farmNearForage()) hs.forage = 1;   // 彩蛋与采集同帧：egg 优先，forage 联动去重
    }
    else if (!hs.fish && farmNearWater()) key = 'fish';
    else if (!hs.panel && P && P.stats && P.stats.harvest >= 1) key = 'panel';
    if (key) farmHintShow(key);
    else if (hintKey && Date.now() > hintUntil) farmHintHide();
  }

  var _uiBuildFarm = uiBuild;
  uiBuild = function (root) {
    var r = _uiBuildFarm(root);
    var hud = UI.hud;
    var bar = el('div', 'sg5-frame sg5-farmbar');
    var left = el('div', 'sg5-farmbar-top');
    left.appendChild(el('span', 'sg5-farm-chip sg5-farm-clock', ''));
    left.appendChild(el('span', 'sg5-farm-chip sg5-farm-date', ''));
    left.appendChild(el('span', 'sg5-farm-chip sg5-farm-weather', ''));
    UI.farmClock = left.childNodes[0]; UI.farmDate = left.childNodes[1]; UI.farmWeather = left.childNodes[2];
    // v5.5：彩蛋节首位 chip「彩蛋节 · n/12」——满 12 变绿，点击直达商店页签兑换
    var eggChip = el('button', 'sg5-farm-chip sg5-farm-eggchip', '');
    eggChip.type = 'button';
    eggChip.style.display = 'none';
    UI.farmEggChip = eggChip;
    left.insertBefore(eggChip, left.firstChild);
    eggChip.addEventListener('click', function () {
      S.farm.tab = 'shop';
      openPanel('farm');
    }, false);
    bar.appendChild(left);
    var row = el('div', 'sg5-farmbar-row');
    var gold = el('div', 'sg5-farm-gold');
    gold.appendChild(el('span', 'sg5-farm-gold-ch', '●'));
    gold.appendChild(el('span', 'sg5-farm-gold-tx', ''));
    UI.farmGold = gold.childNodes[1];
    row.appendChild(gold);
    var en = el('div', 'sg5-farm-energy');
    en.setAttribute('role', 'progressbar');
    en.setAttribute('aria-valuemin', '0');
    en.setAttribute('aria-valuemax', '100');
    en.setAttribute('aria-valuenow', '0');
    en.setAttribute('aria-label', '体力');
    var fill = el('div', 'sg5-farm-energy-fill');
    UI.farmEnergy = fill; en.appendChild(fill); row.appendChild(en);
    bar.appendChild(row);
    var tools = el('div', 'sg5-farm-tools');
    UI.farmToolBtns = [];
    (function () {
      for (var i = 0; i < FARM_TOOLS.length; i++) {
        var t = FARM_TOOLS[i];
        var b = el('button', 'sg5-farm-tool');
        b.type = 'button'; b.setAttribute('data-tool', t.id);
        b.appendChild(el('span', 'sg5-farm-tool-ch', t.ch));
        b.appendChild(el('span', 'sg5-farm-tool-key', t.key));
        b.setAttribute('title', t.name + '（' + t.key + '）');
        b.setAttribute('aria-label', t.name + '（' + t.key + '）');
        b.setAttribute('aria-pressed', 'false');
        tools.appendChild(b); UI.farmToolBtns.push(b);
      }
    })();
    bar.appendChild(tools);
    var nextTip = el('div', 'sg5-farm-tool-next', '');
    UI.farmToolNext = nextTip;
    bar.appendChild(nextTip);
    var nearTip = el('div', 'sg5-farm-near', '');
    UI.farmNear = nearTip;
    bar.appendChild(nearTip);
    var seedRow = el('div', 'sg5-farm-seedrow');
    seedRow.appendChild(el('span', 'sg5-farm-seedlabel', ''));
    UI.farmSeedLabel = seedRow.childNodes[0];
    bar.appendChild(seedRow);
    var fes = el('div', 'sg5-farm-festival');
    fes.style.display = 'none'; UI.farmFestival = fes;
    bar.appendChild(fes);
    hud.appendChild(bar);
    UI.farmBar = bar;

    // dock：多两个入口。bindButtons 的 click 委托读 data-panel，无需改动。
    if (UI.dock) {
      UI.farmDockBtns = {
        farm: dockBtn(UI.dock, 'farm', 'glyph:hoe', '农场', 'N'),
        relation: dockBtn(UI.dock, 'relation', 'glyph:heart', '小镇', 'R'),
        mine: dockBtn(UI.dock, 'mine', 'glyph:pick', '钓鱼 / 矿洞', 'H')
      };
      // v5.5：三个农场入口挂新手角标，首次成功打开对应面板后摘掉（S.storage sg5new 记录）
      var news = sg5NewLoad();
      for (var dk in UI.farmDockBtns) {
        if (!Object.prototype.hasOwnProperty.call(UI.farmDockBtns, dk)) continue;
        if (news[dk] !== 1) UI.farmDockBtns[dk].className += ' is-new';
      }
    }
    tools.addEventListener('click', function (e) {
      var t = e.target;
      while (t && t !== tools && !t.getAttribute('data-tool')) t = t.parentNode;
      if (!t || t === tools) return;
      farmSetTool(t.getAttribute('data-tool'));
    }, false);
    return r;
  };

  function farmSetTool(id) {
    S.farm.tool = id;
    if (id === 'seed') {
      var seeds = farmSeedList();
      if (!seeds.length) { farmToast('先去商店买包种子', 'warn'); return; }
      if (seeds.indexOf(S.farm.seed) < 0) S.farm.seed = seeds[0];
      farmToast('手上拿着 ' + farmItemName(S.farm.seed));
    } else if (id === 'rod') { farmToast('走到水边按 E 甩竿'); }
    else if (id === 'pickaxe') { farmToast('按 H 打开矿洞'); }
    else {
      var nm = '';
      for (var i = 0; i < FARM_TOOLS.length; i++) if (FARM_TOOLS[i].id === id) nm = FARM_TOOLS[i].name;
      farmToast('换上了' + nm);
    }
    farmHudPaint();
  }
  function farmCycleSeed() {
    var seeds = farmSeedList();
    if (!seeds.length) { farmToast('背包里没有种子', 'warn'); return; }
    var i = seeds.indexOf(S.farm.seed);
    S.farm.seed = seeds[(i + 1 + seeds.length) % seeds.length];
    farmToast('种子 → ' + farmItemName(S.farm.seed));
    farmHudPaint();
  }

  // ---------- 输入：数字键切工具 / N R H 开面板 ----------
  var _inputBindFarm = inputBind;
  inputBind = function (root, onDestroy) {
    var r = _inputBindFarm(root, onDestroy);
    function kp(e) {
      var ae = document.activeElement;
      var tag = ae && ae.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || (ae && ae.isContentEditable)) return;
      var k = String(e.key || '').toLowerCase();
      // v5.3：面板打开时 1–6 / Q 不生效（按 1 不换农具、按 Q 不弹 toast）；
      // N / R / H 仍允许切面板。输入态统一用 activeElement 判定。
      if (curPanel === '') {
        if (k >= '1' && k <= '6') { farmSetTool(FARM_TOOLS[Number(k) - 1].id); e.preventDefault(); return; }
        if (k === 'q') { farmCycleSeed(); e.preventDefault(); return; }
      }
      if (k === 'n') { openPanel('farm'); e.preventDefault(); return; }
      if (k === 'r') { openPanel('relation'); e.preventDefault(); return; }
      if (k === 'h') { openPanel('mine'); e.preventDefault(); return; }
    }
    document.addEventListener('keydown', kp, false);
    onDestroy(function () { document.removeEventListener('keydown', kp, false); });
    return r;
  };

  // ---------- 世界层：耕地、洒水器、作物 ----------
  function farmBounds() {
    var D = farmD();
    return { x: D.FARM_X || 112, y: D.FARM_Y || 142, w: D.FARM_W || 12, h: D.FARM_H || 8 };
  }
  function farmDrawGround(ctx, vr) {
    var P = farmP(); if (!P || !P.plots) return;
    var B = farmBounds(), u = TILE * S.zoom;
    var c0 = Math.max(0, vr.x0 - B.x), c1 = Math.min(B.w - 1, vr.x1 - B.x);
    var r0 = Math.max(0, vr.y0 - B.y), r1 = Math.min(B.h - 1, vr.y1 - B.y);
    if (c1 < c0 || r1 < r0) return;
    // 整片田的基底：略暖的土色 + 一圈木栅栏，先告诉玩家「这里能种」
    var px0 = w2sX(B.x * TILE), py0 = w2sY(B.y * TILE);
    ctx.fillStyle = 'rgba(94,72,48,0.16)';
    ctx.fillRect(px0, py0, B.w * u, B.h * u);
    ctx.strokeStyle = 'rgba(74,54,34,0.75)'; ctx.lineWidth = Math.max(2, S.zoom);
    ctx.strokeRect(px0 - 2, py0 - 2, B.w * u + 4, B.h * u + 4);
    ctx.fillStyle = '#8a6a42';
    for (var fx = 0; fx <= B.w; fx++) {
      var wx = Math.round(px0 + fx * u);
      ctx.fillRect(wx - 1, Math.round(py0 - u * 0.22), Math.max(2, S.zoom), Math.round(u * 0.32));
    }
    for (var r = r0; r <= r1; r++) {
      for (var c = c0; c <= c1; c++) {
        var p = P.plots[r + ',' + c];
        var x = Math.round(w2sX((B.x + c) * TILE)), y = Math.round(w2sY((B.y + r) * TILE));
        if (p && p.tilled) {
          ctx.fillStyle = p.watered ? '#4b3527' : '#6b4c32';
          ctx.fillRect(x + 1, y + 1, Math.round(u) - 2, Math.round(u) - 2);
          ctx.strokeStyle = p.watered ? 'rgba(22,16,12,0.7)' : 'rgba(48,32,20,0.6)';
          ctx.lineWidth = 1;
          for (var g = 1; g < 4; g++) {
            var gy = Math.round(y + u * g / 4);
            ctx.beginPath(); ctx.moveTo(x + 2, gy); ctx.lineTo(x + u - 2, gy); ctx.stroke();
          }
          if (p.watered) {
            ctx.fillStyle = 'rgba(96,150,180,0.22)';
            ctx.fillRect(x + 2, y + Math.round(u * 0.72), Math.round(u) - 4, Math.round(u * 0.2));
          }
          if (p.fert) {
            ctx.fillStyle = p.fert === 'quality_fert' ? 'rgba(240,206,110,0.55)' : 'rgba(150,214,120,0.5)';
            ctx.fillRect(x + 3, y + 3, 3, 3);
          }
          if (P.sprinklers && P.sprinklers[r + ',' + c]) {
            ctx.fillStyle = '#9fb6c4';
            ctx.fillRect(x + u * 0.38, y + u * 0.3, Math.max(3, u * 0.24), Math.max(3, u * 0.24));
            ctx.fillStyle = 'rgba(140,210,230,0.8)';
            ctx.fillRect(x + u * 0.46, y + u * 0.16, 2, 3);
          }
        } else {
          ctx.strokeStyle = 'rgba(120,96,62,0.35)'; ctx.lineWidth = 1;
          ctx.strokeRect(x + 0.5, y + 0.5, Math.round(u) - 1, Math.round(u) - 1);
        }
      }
    }
  }

  function farmDrawCrop(ctx, p) {
    var u = TILE * S.zoom;
    var sx = w2sX(p.x * TILE + TILE * 0.5);
    var sy = w2sY(p.y * TILE + TILE);
    var D = farmD(), def = (D.CROPS && D.CROPS[p.crop]) || { col: '#8db36a', shape: 'leaf' };
    var g = Math.max(0.3, Math.min(1, p.grow));
    var h = u * (0.2 + 0.48 * g);
    var col = def.col || '#8db36a';
    ctx.save();
    // 脚底接触阴影
    ctx.fillStyle = 'rgba(30,22,16,0.24)';
    ctx.beginPath(); ctx.ellipse(sx, sy - 1, u * 0.22, u * 0.075, 0, 0, Math.PI * 2); ctx.fill();
    // 茎
    ctx.strokeStyle = '#4b7a3e'; ctx.lineWidth = Math.max(2, Math.round(u * 0.07));
    ctx.beginPath(); ctx.moveTo(sx, sy - u * 0.06); ctx.lineTo(sx, sy - h); ctx.stroke();
    var top = sy - h;
    // 还没熟：两片带描边的嫩叶，一眼就能看出「这儿种了东西」
    if (!p.ready) {
      ctx.fillStyle = '#8fd06a'; ctx.strokeStyle = '#37632c'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.ellipse(sx - u * 0.14, top + u * 0.03, u * 0.15, u * 0.075, -0.5, 0, Math.PI * 2);
      ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.ellipse(sx + u * 0.14, top - u * 0.04, u * 0.15, u * 0.075, 0.5, 0, Math.PI * 2);
      ctx.fill(); ctx.stroke();
      ctx.restore();
      return;
    }
    // 成熟：按 shape 族 6×6 像素形结果 / 开花（v5.6 W2 ④：2 阶色 + #17120d 描边）
    var CROP_FRUIT = {
      round: [
        '.####.',
        '######',
        '######',
        '######',
        '.####.',
        '..##..'
      ],
      berry: [
        '..##..',
        '.####.',
        '######',
        '.####.',
        '..##..',
        '...#..'
      ],
      root: [
        '..##..',
        '.####.',
        '######',
        '.####.',
        '..##..',
        '..##..'
      ],
      flower: [
        '.#..#.',
        '..##..',
        '#o##o#',
        '..##..',
        '.#..#.',
        '..##..'
      ]
    };
    if (def.shape === 'flower') {
      var crows = CROP_FRUIT.flower;
      var ccell = u * 0.09;
      drawGlyphWorldFarm(ctx, crows, sx, top + u * 0.18, ccell, { '#': col, 'o': '#f2d878' }, '#17120d');
      drawGlyphWorldFarm(ctx, crows, sx, top + u * 0.18, ccell, { '#': col, 'o': '#f2d878' }, null);
    } else if (def.shape === 'berry' || def.shape === 'round' || def.shape === 'root') {
      ctx.fillStyle = '#5f9149';
      ctx.fillRect(sx - u * 0.24, top - u * 0.02, u * 0.48, u * 0.1);
      if (p.ready) {
        var frows = CROP_FRUIT[def.shape === 'root' ? 'root' : (def.shape === 'berry' ? 'berry' : 'round')];
        var fcell = u * 0.09;
        drawGlyphWorldFarm(ctx, frows, sx, top + u * 0.28, fcell, { '#': shadeHex(col, -36) }, '#17120d');
        drawGlyphWorldFarm(ctx, frows, sx, top + u * 0.28, fcell, { '#': col }, null);
        ctx.fillStyle = 'rgba(255,255,255,0.5)';
        ctx.fillRect(Math.round(sx - fcell * 2), Math.round(top + u * 0.28 - fcell * 5), Math.max(1, Math.round(fcell)), Math.max(1, Math.round(fcell)));
      } else {
        ctx.fillStyle = '#79a95c';
        ctx.fillRect(sx - u * 0.16, top - u * 0.04, u * 0.32, u * 0.1);
      }
    } else {
      ctx.fillStyle = col;
      ctx.fillRect(sx - u * 0.2, top, u * 0.4, h * 0.45);
      ctx.fillStyle = 'rgba(255,255,255,0.16)';
      ctx.fillRect(sx - u * 0.2, top, u * 0.12, h * 0.45);
      if (p.ready) {
        ctx.fillStyle = '#f0d27a';
        ctx.fillRect(sx - u * 0.08, top - u * 0.1, u * 0.16, u * 0.12);
      }
    }
    if (p.ready) {
      // 成熟提示：小小的金星在头顶一闪一闪
      var tw = 0.55 + 0.45 * Math.sin(S.time * 4 + p.x + p.y);
      ctx.globalAlpha = tw; ctx.fillStyle = '#ffe9a0';
      ctx.fillRect(sx + u * 0.22, top - u * 0.32, 3, 3);
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  }

  var _dssFarm = drawStructureShadows;
  drawStructureShadows = function (ctx, vr) {
    farmDrawGround(ctx, vr);
    return _dssFarm(ctx, vr);
  };
  var _collectFarm = collectProps;
  collectProps = function (vr) {
    _collectFarm(vr);
    var P = farmP(); if (!P || !P.plots || !farmD().CROPS) return;
    var B = farmBounds();
    var c0 = Math.max(0, vr.x0 - B.x), c1 = Math.min(B.w - 1, vr.x1 - B.x);
    var r0 = Math.max(0, vr.y0 - B.y), r1 = Math.min(B.h - 1, vr.y1 - B.y);
    for (var r = r0; r <= r1; r++) {
      for (var c = c0; c <= c1; c++) {
        var p = P.plots[r + ',' + c];
        if (!p || !p.crop) continue;
        var def = farmD().CROPS[p.crop]; if (!def) continue;
        var need = Math.max(1, Math.round(def.days * (P.profs && P.profs.indexOf('agriculturist') >= 0 ? 0.9 : 1)));
        var ready = p.harvested && def.regrow
          ? (P.cal.day - (p.regrowDay || P.cal.day) >= def.regrow)
          : (p.grow || 0) >= need;
        PROPS.push({ k: 'farmcrop', x: B.x + c, y: B.y + r, s: (r * 31 + c * 17) % 7,
          crop: p.crop, grow: Math.min(1, (p.grow || 0) / need), ready: ready });
      }
    }
    // ---- v5.4：野外采集物 / 冷却残桩 / 田下缘的加工设备 ----
    var fi, fr = P.forage || [];
    for (fi = 0; fi < fr.length; fi++) {
      var fp = fr[fi];
      if (fp.x < vr.x0 || fp.x > vr.x1 || fp.y < vr.y0 || fp.y > vr.y1) continue;
      PROPS.push({ k: 'forage', x: fp.x, y: fp.y, s: (fp.x * 7 + fp.y * 13) % 7, item: fp.item });
    }
    var cdKeys = Object.keys(P.forageCd || {});
    for (fi = 0; fi < cdKeys.length; fi++) {
      var xy = cdKeys[fi].split(','), gx = Number(xy[0]), gy = Number(xy[1]);
      if (gx < vr.x0 || gx > vr.x1 || gy < vr.y0 || gy > vr.y1) continue;
      PROPS.push({ k: 'forage', x: gx, y: gy, s: 0, item: '', stub: 1 });
    }
    // ---- v5.5：彩蛋节的彩蛋（视野内才画，捡一颗少一颗） ----
    var eggs = P.eggsLeft || [];
    for (fi = 0; fi < eggs.length; fi++) {
      var eg = eggs[fi];
      if (eg.x < vr.x0 || eg.x > vr.x1 || eg.y < vr.y0 || eg.y > vr.y1) continue;
      PROPS.push({ k: 'egg', x: eg.x, y: eg.y, s: (eg.x * 7 + eg.y * 13) % 7, i: eg.i });
    }
    // 设备画在田下缘：按购买顺序每台占 2 格，一排放不下就封顶 6 台
    var mi = 0, order = MACHINE_ORDER;
    for (var oi = 0; oi < order.length; oi++) {
      var cnt = (P.machines || {})[order[oi]] || 0;
      for (var ci = 0; ci < cnt && mi < 6; ci++) {
        PROPS.push({ k: 'machine', x: B.x + mi * 2, y: B.y + B.h, s: mi, kind: order[oi] });
        mi++;
      }
    }
  };
  // v5.6 W2 ①：采集物改四族 8×8 GLYPH 行串（浆果丛 / 根茎 / 花株 / 菌菇）+ 主色 + 描边 + 白高光
  var FORAGE_GLYPH = {
    berry: [
      '........',
      '.##..##.',
      '#++##++#',
      '#++##++#',
      '.##..##.',
      '..####..',
      '...##...',
      '..####..'
    ],
    root: [
      '..##.##.',
      '.######.',
      '..####..',
      '...##...',
      '..++++..',
      '..++++..',
      '...++...',
      '...++...'
    ],
    flower: [
      '..++++..',
      '.+o++o+.',
      '+++++++.',
      '.+++++..',
      '..####..',
      '..####..',
      '...##...',
      '...##...'
    ],
    shroom: [
      '..####..',
      '.+####+.',
      '########',
      '########',
      '...##...',
      '..+##+..',
      '..+##+..',
      '........'
    ]
  };
  function forageFamily(id) {
    var b = String(id || '').split('_q')[0];
    if (/daffodil|dandelion|sweet_pea|tulip|jazz|poppy/.test(b)) return 'flower';
    if (/berry|grape|plum|spice/.test(b)) return 'berry';
    if (/root|leek|yam|radish|horseradish|winter/.test(b)) return 'root';
    if (/spore|mushroom|shroom/.test(b)) return 'shroom';
    return 'berry';
  }
  function farmDrawForage(ctx, p) {
    var u = TILE * S.zoom;
    var sx = w2sX(p.x * TILE + TILE * 0.5);
    var sy = w2sY(p.y * TILE + TILE);
    if (p.stub) {
      ctx.fillStyle = 'rgba(70,58,38,0.75)';
      ctx.fillRect(Math.round(sx - 1), Math.round(sy - u * 0.16), 2, Math.round(u * 0.16));
      return;
    }
    var col = farmItemColor(p.item) || '#a8c86a';
    var sway = Math.round(Math.sin(S.time * 1.6 + (p.x * 7 + p.y * 13) % 7) * 1);
    ctx.fillStyle = 'rgba(30,22,16,0.22)';
    ctx.beginPath(); ctx.ellipse(sx, sy - 1, u * 0.2, u * 0.06, 0, 0, 6.2832); ctx.fill();
    var fam = forageFamily(p.item);
    var rows = FORAGE_GLYPH[fam];
    var cell = u * 0.055;                       // 8×8 → 约 0.44u 高
    var bx = Math.round(sx + sway);
    // 1px 深色描边：先画一圈 #17120d 的底再叠主色
    drawGlyphWorldFarm(ctx, rows, bx + 1, sy - u * 0.05, cell, null, '#17120d');
    drawGlyphWorldFarm(ctx, rows, bx, sy - u * 0.05, cell, { '#': col, '+': shadeHex(col, -36), 'o': '#ffffff' });
    // 1px 白高光
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.fillRect(Math.round(bx - cell * 2), Math.round(sy - u * 0.05 - cell * 7), Math.max(1, Math.round(cell)), Math.max(1, Math.round(cell)));
  }
  // 15_farm 内部的字形绘制（与 07_entity.drawGlyphWorld 同规则；offset 用于描边层）
  function drawGlyphWorldFarm(ctx, rows, cx, bottomY, cell, pal, forceCol) {
    var h = rows.length, w = rows[0].length;
    var ox = Math.round(cx - w * cell / 2), oy = Math.round(bottomY - h * cell);
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var ch = rows[y].charAt(x);
        if (ch === '.') continue;
        ctx.fillStyle = forceCol || ((pal && pal[ch]) || (pal && pal['#']) || '#e8dcc0');
        ctx.fillRect(ox + Math.round(x * cell), oy + Math.round(y * cell), Math.max(1, Math.round(cell)), Math.max(1, Math.round(cell)));
      }
    }
  }
  // v5.6 W2 ⑨：彩蛋改用 GLYPH.egg 放大 0.5u（与 chip / 图标同源，删矢量椭圆版）
  function farmDrawEgg(ctx, p) {
    var u = TILE * S.zoom;
    var sx = w2sX(p.x * TILE + TILE * 0.5);
    var sy = w2sY(p.y * TILE + TILE);
    ctx.fillStyle = 'rgba(30,22,16,0.22)';
    ctx.beginPath(); ctx.ellipse(sx, sy - 1, u * 0.20, u * 0.06, 0, 0, 6.2832); ctx.fill();
    drawGlyphWorldFarm(ctx, GLYPH.egg, sx, sy - u * 0.06, u * 0.5 / 12,
      { '#': '#f2e7c8', 'o': '#fffdf2', '+': '#c9963f' }, null);
    var tw = 0.55 + 0.45 * Math.sin(S.time * 4 + p.i * 1.7);
    ctx.globalAlpha = tw; ctx.fillStyle = '#ffe9a0';
    ctx.fillRect(Math.round(sx + u * 0.2), Math.round(sy - u * 0.46), 3, 3);
    ctx.globalAlpha = 1;
  }
  // v5.6 W2 ②：加工设备改用 UI 层 GLYPH.machine_* 放大 0.7u（世界与 UI 同形）
  var MACHINE_GLYPH = { furnace: 'machine_furnace', mayo_machine: 'machine_mayo', cheese_press: 'machine_cheese', keg: 'machine_keg', stove: 'machine_stove' };
  function farmDrawMachine(ctx, p) {
    var u = TILE * S.zoom;
    var sx = w2sX(p.x * TILE + TILE);
    var sy = w2sY(p.y * TILE + TILE);
    ctx.fillStyle = 'rgba(30,22,16,0.24)';
    ctx.beginPath(); ctx.ellipse(sx, sy - 1, u * 0.42, u * 0.1, 0, 0, 6.2832); ctx.fill();
    var rows = GLYPH[MACHINE_GLYPH[p.kind]] || GLYPH.machine_furnace;
    drawGlyphWorldFarm(ctx, rows, sx, sy - u * 0.04, u * 0.7 / 12, null, null);
    var frm = Math.floor(S.time * 2) % 2;
    ctx.fillStyle = frm ? 'rgba(240,236,220,0.5)' : 'rgba(240,236,220,0.28)';
    var puff = frm ? 3 : 2;
    ctx.fillRect(Math.round(sx - puff / 2), Math.round(sy - u * 0.04 - rows.length * (u * 0.7 / 12) - (frm ? 8 : 4)), puff, puff);
  }
  var _drawPropFarm = drawProp;
  drawProp = function (ctx, p) {
    if (p && p.k === 'farmcrop') { farmDrawCrop(ctx, p); return; }
    if (p && p.k === 'forage') { farmDrawForage(ctx, p); return; }
    if (p && p.k === 'egg') { farmDrawEgg(ctx, p); return; }
    if (p && p.k === 'machine') { farmDrawMachine(ctx, p); return; }
    var r = _drawPropFarm(ctx, p);
    // v5.6 W2 ③：斧痕改树干斜向阶梯缺口（wood 色内芯 + #17120d 边）；次日 1 道 50% alpha
    if (p && (p.k === T.TREE || p.k === T.PINE || p.k === T.DEADTREE)) {
      var P = farmP();
      var cdk = P && P.chopped ? P.chopped[p.x + ',' + p.y] : 0;
      if (cdk) {
        var u = TILE * S.zoom;
        var cx = w2sX(p.x * TILE + TILE * 0.5), cy = w2sY(p.y * TILE + TILE);
        var day = farmCal().day || 0;
        var age = day - cdk;
        if (age <= 2) {
          drawAxeNotch(ctx, cx, cy, u, -1, age === 0 ? 1 : 0.5);
          if (age >= 1) drawAxeNotch(ctx, cx, cy, u, 1, 0.5);
        }
      }
    }
    return r;
  };
  // 斜向阶梯缺口：3 级台阶往右下切进树干
  function drawAxeNotch(ctx, cx, cy, u, side, alpha) {
    var x0 = cx + side * u * 0.06, y0 = cy - u * 0.42;
    var step = Math.max(2, Math.round(u * 0.09));
    ctx.save();
    ctx.globalAlpha = alpha;
    for (var i = 0; i < 3; i++) {
      var nx = Math.round(x0 + i * step * 0.7), ny = Math.round(y0 + i * step);
      ctx.fillStyle = '#17120d';                          // 外沿
      ctx.fillRect(nx - 1, ny - 1, step + 2, step + 2);
      ctx.fillStyle = '#6d4b2e';                          // 木茬内芯
      ctx.fillRect(nx, ny, step, step);
    }
    ctx.restore();
  }

  // ---------- 交互：站在田里按 E，按当前工具干活 ----------
  function farmNear() {
    var B = farmBounds(), m = S.me;
    if (!m) return false;
    return m.x >= B.x - 1 && m.x <= B.x + B.w + 1 && m.y >= B.y - 1 && m.y <= B.y + B.h + 1;
  }
  function farmCellAtMe() {
    var B = farmBounds(), m = S.me;
    return { r: Math.floor(m.y - B.y), c: Math.floor(m.x - B.x) };
  }
  // v5.3：只读的「下一步」提示，判定与 farmSmartAction 完全一致，但不发任何请求
  function farmNextAction() {
    var P = farmP(), m = S.me;
    if (!P || !m) return '';
    var B = farmBounds(), cell = farmCellAtMe();
    if (cell.r < 0 || cell.c < 0 || cell.r >= B.h || cell.c >= B.w) return '';
    var p = (P.plots || {})[cell.r + ',' + cell.c];
    var D = farmD(), def = p && p.crop && D.CROPS[p.crop];
    var need = def ? Math.max(1, Math.round(def.days * (P.profs && P.profs.indexOf('agriculturist') >= 0 ? 0.9 : 1))) : 0;
    var ready = def && (p.harvested && def.regrow
      ? (P.cal.day - (p.regrowDay || P.cal.day) >= def.regrow) : (p.grow || 0) >= need);
    if (ready) return '收获';
    if (p && p.crop) return '浇水';
    if (p && p.tilled) return '播种';
    return '翻土';
  }
  // ---- v5.4：身边的采集物 / 树（farmbar 提示与世界层 E 键共用） ----
  function farmNearForage() {
    var P = farmP(), m = S.me;
    if (!P || !m || !P.forage) return null;
    var best = null, bd = 2.25;                       // 1.5 格（平方）
    for (var i = 0; i < P.forage.length; i++) {
      var f = P.forage[i];
      var d = dist(m.x, m.y, f.x + 0.5, f.y + 0.5);
      if (d < bd) { bd = d; best = f; }
    }
    return best;
  }
  function farmNearTree() {
    var m = S.me;
    if (!m || !S.map || !S.map.cells) return null;
    var fx = Math.floor(m.x), fy = Math.floor(m.y);
    var face = m.face || 0;
    var dx = [0, 0, -1, 1][face], dy = [1, -1, 0, 0][face];
    // 面前一格优先，四邻兜底
    var cand = [[fx + dx, fy + dy], [fx + 1, fy], [fx - 1, fy], [fx, fy + 1], [fx, fy - 1]];
    var P = farmP(), day = farmCal().day || 0;
    for (var i = 0; i < cand.length; i++) {
      var tx = cand[i][0], ty = cand[i][1];
      var t = tileAt(tx, ty);
      if (t !== T.TREE && t !== T.PINE && t !== T.DEADTREE) continue;
      var cd = P && P.chopped ? P.chopped[tx + ',' + ty] : 0;
      return { x: tx, y: ty, ready: !(cd && day - cd < 3) };
    }
    return null;
  }
  // ---- v5.5：节日判定 / 身边的彩蛋 / 水边（引导用） ----
  function festivalNamed(n) { var c = farmCal(); return !!(c.festival && c.festival.name === n); }
  function isEggDay() { return festivalNamed('彩蛋节'); }
  function isFishContestDay() { return festivalNamed('冰雪钓赛'); }
  function isExhibitDay() { var c = farmCal(); return !!(c.festival && c.festival.perk === 'exhibit'); }
  function farmNearEgg() {
    var P = farmP(), m = S.me;
    if (!P || !m || !isEggDay() || !P.eggsLeft || !P.eggsLeft.length) return null;
    var best = null, bd = 2.25;                       // 1.5 格（平方）
    for (var i = 0; i < P.eggsLeft.length; i++) {
      var e = P.eggsLeft[i];
      var d = dist(m.x, m.y, e.x + 0.5, e.y + 0.5);
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  }
  function farmNearWater() {
    var m = S.me;
    if (!m || !S.map || !S.map.cells) return false;
    var fx = Math.floor(m.x), fy = Math.floor(m.y);
    for (var dy = -1; dy <= 1; dy++) {
      for (var dx = -1; dx <= 1; dx++) {
        var t = tileAt(fx + dx, fy + dy);
        if (t === T.WATER || t === T.SHALLOW) return true;
      }
    }
    return false;
  }
  function farmSmartAction(r, c) {
    var P = farmP(); if (!P) return;
    var p = (P.plots || {})[r + ',' + c];
    var D = farmD(), def = p && p.crop && D.CROPS[p.crop];
    var need = def ? Math.max(1, Math.round(def.days * (P.profs && P.profs.indexOf('agriculturist') >= 0 ? 0.9 : 1))) : 0;
    var ready = def && (p.harvested && def.regrow
      ? (P.cal.day - (p.regrowDay || P.cal.day) >= def.regrow) : (p.grow || 0) >= need);
    if (ready) {
      farmAct('harvest', { r: r, c: c }).then(function (d) {
        farmToast('收了 ' + (d && d.got ? d.got.length : 0) + ' 个' + (def ? def.name : '作物'));
      }, function (e) { farmToast(e.message, 'warn'); });
    } else if (p && p.crop) {
      farmAct('water', { r: r, c: c }).then(function (d) { farmToast('浇好了'); },
        function (e) { farmToast(e.message, 'warn'); });
    } else if (p && p.tilled) {
      if (!S.farm.seed || !(P.inv[S.farm.seed] > 0)) { farmCycleSeed(); return; }
      farmAct('plant', { r: r, c: c, seed: S.farm.seed }).then(function (d) {
        farmToast('种下了 ' + (d && d.name ? d.name : '种子'));
      }, function (e) { farmToast(e.message, 'warn'); });
    } else {
      farmAct('till', { r: r, c: c }).then(function () { farmToast('翻好了一块地'); },
        function (e) { farmToast(e.message, 'warn'); });
    }
  }
  // 世界里按 E：严格按手上拿的工具干活（原作手感）；面板里点格子才走智能动作
  function farmWorldAction() {
    var B = farmBounds(), cell = farmCellAtMe();
    if (cell.r < 0 || cell.c < 0 || cell.r >= B.h || cell.c >= B.w) return false;
    if (S.farm.tool === 'rod' || S.farm.tool === 'pickaxe') { openPanel('mine'); return true; }
    var body = { r: cell.r, c: cell.c }, path = '';
    if (S.farm.tool === 'hoe') path = 'till';
    else if (S.farm.tool === 'watercan') path = 'water';
    else if (S.farm.tool === 'seed') {
      if (!S.farm.seed) { farmCycleSeed(); return true; }
      path = 'plant'; body.seed = S.farm.seed;
    } else path = 'harvest';
    farmAct(path, body).then(function (d) {
      var msg = path === 'till' ? '翻好了一块地' : path === 'water' ? '浇好了'
        : path === 'plant' ? '种下了 ' + (d && d.name ? d.name : '种子')
        : '收了 ' + (d && d.got ? d.got.length : 0) + ' 个';
      farmToast(msg);
    }, function (e) { farmToast(e.message || '这会儿干不了', 'warn'); });
    return true;
  }
  // 世界里飘字：复用战斗飘字的结构（金色小字往上飘）。v5.6：支持目标坐标（彩蛋/采集/砍树）
  function floatText(txt, x, y) {
    var m = S.me;
    var px = (x != null && y != null) ? x + 0.5 : (m ? m.x : 0);
    var py = (x != null && y != null) ? y : (m ? m.y - 1.2 : 0);
    if (m && S.texts) capPush(S.texts, { x: px, y: py, txt: txt, crit: 0, life: 1.0, max: 1.0, vy: -0.9, vx: 0.2, gold: 1 }, 60);
  }
  // 世界里按 E：田区内严格按手上的工具干活；田区外先捡彩蛋、再采集、再砍树，最后才轮到宝箱 / NPC
  var _doInteractFarm = doInteract;
  doInteract = function (t) {
    if (farmP() && farmNear() && farmWorldAction()) return;
    var ne = farmNearEgg();
    if (ne) {
      lifeAct('egg/pick', { i: ne.i }).then(function (d) {
        farmToast('捡到了彩蛋，还拿到一张彩蛋彩券（农场面板「商店」可兑换）');
        floatText('+彩蛋', ne.x, ne.y - 0.6);
      }, function (e) { farmToast(e.message, 'warn'); });
      return;
    }
    var nf = farmNearForage();
    if (nf) {
      lifeAct('forage/pick', { x: nf.x, y: nf.y }).then(function (d) {
        farmToast('采到了 ' + (d && d.name ? d.name : '野味'));
        floatText('+' + (d && d.got ? d.got.length : 1), nf.x, nf.y - 0.6);
      }, function (e) { farmToast(e.message, 'warn'); });
      return;
    }
    var nt = farmNearTree();
    if (nt && nt.ready) {
      lifeAct('chop', { x: nt.x, y: nt.y }).then(function (d) {
        var g = d && d.got ? d.got : {};
        farmToast('砍到木材 ×' + (g.wood || 0) + (g.hardwood ? ' · 硬木 ×1' : ''));
        floatText('+木材', nt.x, nt.y - 0.6);
      }, function (e) { farmToast(e.message, 'warn'); });
      return;
    }
    return _doInteractFarm(t);
  };

  // ---------- 事件 / 实时广播 / 轮询 ----------
  function farmEvent(e) {
    if (!e) return false;
    var k = e.k;
    if (k === 'farm-dawn') {
      farmToast('第 ' + e.day + ' 天的晨光 · ' + (e.msg || '田里的东西长了一节'));
      farmState(); return true;
    }
    if (k === 'farm-level') {
      var D = farmD();
      farmSfx('levelup', 0.45, 1.3);
      farmToast((D.SKILL_NAMES ? D.SKILL_NAMES[e.skill] : e.skill) + '升到 ' + e.lv + ' 级！');
      farmState(); return true;
    }
    if (k === 'relation-heart') {
      farmToast('♥ ' + e.name + ' · ' + e.heart + ' 颗心：' + e.text);
      return true;
    }
    if (k === 'farm-gift') { farmToast('有人送了你 ' + (e.name || '一份礼物')); farmState(); return true; }
    if (k === 'farm-bundle') { farmToast('献祭包完成：' + e.name + ' → ' + e.reward); farmState(); return true; }
    if (k === 'farm-greenhouse' || k === 'farm-mine-bottom') { farmToast(e.text); farmState(); return true; }
    if (k === 'farm-elevator') { farmToast('矿洞电梯：第 ' + e.floor + ' 层'); return true; }
    if (k === 'farm-sleep') { farmToast('歇下了 —— 体力回了一些（分段恢复）'); return true; }
    return false;
  }
  var _handleEventFarm = handleEvent;
  handleEvent = function (e) {
    if (farmEvent(e)) return;
    return _handleEventFarm(e);
  };

  var _bindRealtimeFarm = bindRealtime;
  bindRealtime = function () {
    _bindRealtimeFarm();
    if (!S.farm.rtBound && S.realtime && S.onDestroyAll) {
      S.farm.rtBound = 1;
      var rt = S.realtime;
      function sub(name, fn) {
        try { var off = rt.subscribe('shiguang5.' + name, fn); if (off) S.onDestroyAll.push(off); } catch (e) {}
      }
      sub('farm-dawn', function (p) {
        if (p) farmToast('第 ' + p.day + ' 天 · ' + p.season + (p.festival ? ' · ' + p.festival : ''));
        farmState();
      });
      sub('farm-rare', function (p) { if (p) farmToast('有人钓上了 ' + p.fish + '！'); });
      sub('farm-marry', function (p) { if (p) farmToast(p.name + ' 和班里的同学成家了 ♥'); });
    }
  };

  var _applyEnterFarm = applyEnter;
  applyEnter = function (d) {
    _applyEnterFarm(d);
    if (d.farm) farmApply(d.farm);
  };

  var _socialTickFarm = socialTick;
  socialTick = function (t) {
    // v5.6 W1：主循环 socialTick 段的农场侧双保险 —— 一行异常不拖累其余帧逻辑
    try {
      _socialTickFarm(t);
    } catch (e) { console.error('[sg5-social]', e); }
    if (!S.ready || !farmP()) return;
    try {
      if (UI.farmClock) {
        var c = farmCal(), ms = c.dayMs || 90000;
        setText(UI.farmClock, farmClock((Date.now() - S.farm.epoch) / ms));
      }
      // v5.4：脚下 / 身边都会随走动变化，两条只读提示每帧跟着走
      if (UI.farmToolNext || UI.farmNear) farmHintPaint();
    } catch (e2) { console.error('[sg5-social-farm]', e2); }
    // 低频：面板开着或有待办时 6 秒拉一次；平时 15 秒，别给 5Hz 同步添负担
    var interval = (curPanel === 'farm' || curPanel === 'relation' || curPanel === 'mine') ? 6 : 15;
    if (t - S.farm.lastPoll >= interval) {
      S.farm.lastPoll = t;
      farmState();
    }
  };

  // 面板打开时收起右侧农场条：它压在宽面板上会挡住标题与滚动条
  var _openPanelFarm = openPanel;
  openPanel = function (id) {
    var r = _openPanelFarm(id);
    if (UI.farmBar) UI.farmBar.style.display = curPanel ? 'none' : '';
    // v5.5：farm/relation/mine 首次成功渲染后摘对应 dock 角标
    if (curPanel === id && (id === 'farm' || id === 'relation' || id === 'mine')) {
      var b = UI.farmDockBtns && UI.farmDockBtns[id];
      if (b && b.className.indexOf('is-new') >= 0) {
        b.className = b.className.replace(/\s*is-new/, '');
        sg5NewMark(id);
      }
    }
    return r;
  };
  var _closePanelFarm = closePanel;
  closePanel = function () {
    var r = _closePanelFarm();
    if (UI.farmBar) UI.farmBar.style.display = '';
    return r;
  };

  var _mountFarm = mount;
  mount = function (container, context) {
    _mountFarm(container, context);
    // 只重置瞬时量：p/data 由随后的 applyEnter 覆盖，提前清空反而会丢首帧
    S.farm.lastPoll = 0; S.farm.rtBound = 0; S.farm.qte = null;
    S.farm.sel = null; S.farm.bagSel = null; S.farm.tool = 'hoe';
    S.farm.relGiftTo = ''; S.farm.loadState = 'loading'; S.farm.lastError = '';
    // v5.6 W1：竞态锁随挂载复位（锁在 S 上，refreshPanel 不动它们）
    S.farmBusy = 0; S.fishBusy = 0; S.panelBusy = 0;
    // v5.5：展台是瞬时视图；引导去重跨日持久（localStorage sg5hint 读回）
    S.farm.exhibitMode = false; S.farm.exhibitSel = [];
    farmHintLoad();
    if (window.__sg5) {
      window.__sg5.farm = {
        state: function () {
          var P = farmP();
          return { gold: P && P.gold, energy: P && P.energy, plots: P ? Object.keys(P.plots || {}).length : 0,
            crops: farmD().CROPS ? Object.keys(farmD().CROPS).length : 0,
            day: P && P.cal && P.cal.day, season: P && P.cal && P.cal.seasonName,
            tools: P && P.tools, skills: P && P.levels, spouse: P && P.spouse };
        },
        setDay: function (n) { return farmState(); },
        act: function (p, b) { return farmAct(p, b); },
        life: function (p, b) { return lifeAct(p, b); },
        tool: function (id) { farmSetTool(id); },
        teleportFarm: function () {
          var B = farmBounds();
          if (window.__sg5.teleport) window.__sg5.teleport(B.x + B.w / 2, B.y + B.h / 2);
        }
      };
    }
  };


  // ======================== 16_farm_ui.js ========================
  // ---------------- §17 农场面板：田地 / 商店 / 背包 / 出货 / 技能 / 日历 ----------------

  GLYPH.hoe = [
    '.........##.',
    '........###.',
    '.......###..',
    '......###...',
    '.....###....',
    '....###.....',
    '...###......',
    '..###.......',
    '.##.........'
  ];
  GLYPH.heart = [
    '..###..###..',
    '.#####.#####',
    '############',
    '############',
    '.##########.',
    '..########..',
    '...######...',
    '....####....',
    '.....##.....'
  ];
  GLYPH.pick = [
    '....###.....',
    '..#######...',
    '.#########..',
    '....###.....',
    '....###.....',
    '...###......',
    '..###.......',
    '.###........',
    '.##.........'
  ];

  // ---- v5.4 多色字形：palette 传主色（与 farmItemColor 的 M 表一致） ----
  // 字符约定：'#' 主色 / 'o' 亮部 / '+' 次色 / '.' 空白；不传 palette 时只画 '#'。
  GLYPH.bar = [
    '............',
    '...oooooo...',
    '..########..',
    '...######...',
    '............',
    '...oooooo...',
    '..########..',
    '...######...',
    '............',
    '............'
  ];
  GLYPH.for_flower = [
    '...++++++...',
    '..++oooo++..',
    '.+++oooo+++.',
    '.+++oooo+++.',
    '..++oooo++..',
    '...++++++...',
    '.....##.....',
    '.....##.....',
    '.....##.....',
    '.....##.....',
    '.....#......',
    '............'
  ];
  GLYPH.for_root = [
    '....##.##...',
    '...###.###..',
    '....#####...',
    '.....###....',
    '....+++++...',
    '....+++++...',
    '....++++....',
    '.....+++....',
    '.....++.....',
    '......+.....',
    '............',
    '............'
  ];
  GLYPH.for_berry = [
    '.....##.....',
    '....#++#....',
    '....#++#....',
    '.....##.....',
    '..##....##..',
    '.#++#..#++#.',
    '.#++#..#++#.',
    '..##....##..',
    '.....#......',
    '....##......',
    '............',
    '............'
  ];
  GLYPH.for_fruit = [
    '......##....',
    '.....##.....',
    '...######...',
    '..+######+..',
    '.++######++.',
    '.++######++.',
    '.++######++.',
    '..+######+..',
    '...######...',
    '....####....',
    '............',
    '............'
  ];
  GLYPH.mayonnaise = [
    '..oooooooo..',
    '..oooooooo..',
    '.##########.',
    '.#oooooooo#.',
    '.#oooooooo#.',
    '.#oooooooo#.',
    '.#oooooooo#.',
    '.#oooooooo#.',
    '.##########.',
    '............',
    '............',
    '............'
  ];
  GLYPH.cheese = [
    '.........##.',
    '.......####.',
    '.....######.',
    '...########.',
    '.+#########.',
    '++#########.',
    '+++o####o##.',
    '.++########.',
    '..########..',
    '............',
    '............',
    '............'
  ];
  GLYPH.drink = [
    '.##########.',
    '.#oooooooo#.',
    '.#oooooooo#.',
    '.#oooooooo#.',
    '.#oooooooo#.',
    '.#oooooooo#.',
    '.#oooooooo#.',
    '.##########.',
    '....##......',
    '....##......',
    '..#######...',
    '............'
  ];
  GLYPH.machine_furnace = [
    '..########..',
    '.#oooooooo#.',
    '.#oooooooo#.',
    '.##oooooo##.',
    '.#oooooooo#.',
    '.#oo++++oo#.',
    '.#oo++++oo#.',
    '.#oooooooo#.',
    '.#oooooooo#.',
    '..########..',
    '............',
    '............'
  ];
  GLYPH.machine_mayo = [
    '.....oo.....',
    '....oooo....',
    '............',
    '.##########.',
    '.#oooooooo#.',
    '.#oo++++oo#.',
    '.#oooooooo#.',
    '.#oooooooo#.',
    '.##########.',
    '...##..##...',
    '............',
    '............'
  ];
  GLYPH.machine_cheese = [
    '.....##.....',
    '.....##.....',
    '...######...',
    '...######...',
    '.##########.',
    '.#oooooooo#.',
    '.#oooooooo#.',
    '.##########.',
    '.#oooooooo#.',
    '.##########.',
    '............',
    '............'
  ];
  GLYPH.machine_keg = [
    '...######...',
    '..########..',
    '.##oooooo##.',
    '.#oooooooo#.',
    '.#o##oo##o#.',
    '.#o##oo##o#.',
    '.#oooooooo#.',
    '.##oooooo##.',
    '..########..',
    '...######...',
    '............',
    '............'
  ];
  GLYPH.machine_stove = [
    '..oooooooo..',
    '..o......o..',
    '..oooooooo..',
    '.##########.',
    '.#oooooooo#.',
    '.#o++++++o#.',
    '.#o++++++o#.',
    '.#oooooooo#.',
    '.##########.',
    '.##......##.',
    '............',
    '............'
  ];
  var PAL_STEM = '#4b7a3e', PAL_LEAF = '#5c8a3c', PAL_DARK = '#3a2a20';
  var FARM_ICON = {
    copper_bar: { glyph: 'bar', pal: { '#': '#c98452', 'o': '#e8b088' } },
    iron_bar: { glyph: 'bar', pal: { '#': '#c8cdd4', 'o': '#eef1f4' } },
    gold_bar: { glyph: 'bar', pal: { '#': '#e5c45c', 'o': '#f6e2a0' } },
    iridium_bar: { glyph: 'bar', pal: { '#': '#b9e6e2', 'o': '#e2f6f4' } },
    hardwood: { glyph: 'bar', pal: { '#': '#8a6a48', 'o': '#b08a5e' } },
    mayonnaise: { glyph: 'mayonnaise', pal: { '#': '#6b543c', 'o': '#f6efc0' } },
    cheese: { glyph: 'cheese', pal: { '#': '#e8c060', '+': '#f2dc9a', 'o': '#b98a3a' } },
    pale_ale: { glyph: 'drink', pal: { '#': '#6b4b2a', 'o': '#e8b84a' } },
    beer: { glyph: 'drink', pal: { '#': '#5a3d20', 'o': '#d89830' } },
    food_soup: { sprite: 'food_Beaf' },
    food_stirfry: { sprite: 'food_Noodle' },
    food_grilled: { sprite: 'food_Fish' },
    food_sushi: { sprite: 'food_Sushi' },
    food_bento: { sprite: 'food_Onigiri' },
    food_cookie: { sprite: 'food_FortuneCookie' },
    food_tea: { sprite: 'food_TeaLeaf' },
    food_honey: { sprite: 'food_Honey' },
    horseradish: { glyph: 'for_root', pal: { '+': '#e8e2d0', '#': PAL_LEAF } },
    daffodil: { glyph: 'for_flower', pal: { '+': '#f0d858', 'o': '#f8eeaa', '#': PAL_STEM } },
    leek: { glyph: 'for_root', pal: { '+': '#b8cc88', '#': PAL_LEAF } },
    dandelion: { glyph: 'for_flower', pal: { '+': '#f0c840', 'o': '#f8e698', '#': PAL_STEM } },
    spice_berry: { glyph: 'for_berry', pal: { '+': '#d86a4a', '#': PAL_DARK } },
    sweet_pea: { glyph: 'for_flower', pal: { '+': '#c878d8', 'o': '#e4b4ec', '#': PAL_STEM } },
    summer_grape: { glyph: 'for_berry', pal: { '+': '#8868b8', '#': PAL_DARK } },
    hazelnut: { glyph: 'for_fruit', pal: { '+': '#c8a068', '#': '#a87848' } },
    wild_plum: { glyph: 'for_fruit', pal: { '+': '#a878c8', '#': '#8858a8' } },
    blackberry: { glyph: 'for_berry', pal: { '+': '#70708c', '#': PAL_DARK } },
    crystal_fruit: { glyph: 'for_fruit', pal: { '+': '#d8f4f8', '#': '#a8e0e8' } },
    snow_yam: { glyph: 'for_root', pal: { '+': '#e8d0b0', '#': PAL_LEAF } },
    winter_root: { glyph: 'for_root', pal: { '+': '#c8a878', '#': PAL_LEAF } },
    furnace: { glyph: 'machine_furnace', pal: { '#': '#4a4038', 'o': '#5a5048', '+': '#e87830' } },
    mayo_machine: { glyph: 'machine_mayo', pal: { '#': '#6b543c', 'o': '#e8e2d0', '+': '#f2d878' } },
    cheese_press: { glyph: 'machine_cheese', pal: { '#': '#8a8078', 'o': '#e8c060' } },
    keg: { glyph: 'machine_keg', pal: { '#': '#6b4b2a', 'o': '#a87848' } },
    stove: { glyph: 'machine_stove', pal: { '#': '#4a4038', 'o': '#5a5048', '+': '#e87830' } },
    // v5.5 彩蛋节：蛋形与彩券字形（定义见 09_ui_hud.js 的 GLYPH）
    egg: { glyph: 'egg', pal: { '#': '#f2e7c8', 'o': '#fffdf2', '+': '#c9963f' } },
    ticket: { glyph: 'ticket', pal: { '#': '#c9963f', 'o': '#ffd27a' } },
    // ---- v5.6 W2 图标 GLYPH 化：矿石四档 / 宝石 / 煤 / 木材 / 石头 / 奶瓶 / 毛球 / 资材 ----
    copper: { glyph: 'ore', pal: { '#': '#c98452', 'o': '#e8b088' } },
    iron: { glyph: 'ore', pal: { '#': '#c8cdd4', 'o': '#eef1f4' } },
    gold: { glyph: 'ore', pal: { '#': '#e5c45c', 'o': '#f6e2a0' } },
    iridium: { glyph: 'ore', pal: { '#': '#b9e6e2', 'o': '#e2f6f4' } },
    gem: { glyph: 'gem', pal: { '#': '#b58ad8', '+': '#9a6fc0', 'o': '#e8d8ff' } },
    coal: { glyph: 'coal', pal: { '#': '#4a4a52', 'o': '#6a6a74' } },
    stone: { glyph: 'stone_round', pal: { '#': '#a9a29a', 'o': '#c8c2b8' } },
    milk: { glyph: 'milk_bottle', pal: { '#': '#eef1f4', 'o': '#b8d8e8' } },
    big_milk: { glyph: 'milk_bottle', pal: { '#': '#eef1f4', 'o': '#d8b848' } },
    wool: { glyph: 'wool', pal: { '#': '#f0eade', 'o': '#d8d0c0' } },
    wood: { glyph: 'wood_log', pal: { '#': '#a9814f', 'o': '#c9a468' } },
    speedgro: { glyph: 'flask', pal: { '#': '#8fc48a', 'o': '#c9e8c0' } },
    quality_fert: { glyph: 'flask', pal: { '#': '#e8c860', 'o': '#f6e2a0' } },
    sprinkler: { glyph: 'sprinkler', pal: { '#': '#9fb6c4', 'o': '#8fc4d8' } },
    hay: { glyph: 'bale', pal: { '#': '#d8c27a', 'o': '#b09a58' } }
  };
  // v5.6：通用作物果实按 CROPS.shape 映射到 4 字形（最大观感来源优先，pal 用 CROPS.col）
  function cropGlyphOf(cropId) {
    var c = (farmD().CROPS || {})[cropId];
    if (!c) return null;
    var g = { round: 'crop_round', berry: 'for_berry', root: 'for_root', flower: 'for_flower',
      leaf: 'crop_round', stalk: 'crop_long', vine: 'crop_cluster' }[c.shape];
    if (!g) return null;
    var col = c.col || '#8db36a';
    return { glyph: g, pal: { '#': col, '+': shadeHex(col, -36), 'o': '#ffffff' } };
  }
  // 种子 A 轨：按季节 + 价格档取精灵（低 ≤40 / 中 ≤80 / 高）
  function seedSprite(cropId) {
    var c = farmD().CROPS[cropId];
    if (!c) return '';
    var s = (c.s && c.s.length) ? c.s[0] : -1;
    var t = c.seed <= 40 ? '1' : (c.seed <= 80 ? 'Big' : '');
    if (s === 0) return t === '1' ? 'food_Seed1' : (t === 'Big' ? 'food_SeedBig1' : 'food_SeedLarge');
    if (s === 1) return t === '1' ? 'food_Seed2' : (t === 'Big' ? 'food_SeedBig2' : 'food_SeedLarge');
    if (s === 2) return t === '1' ? 'food_Seed3' : (t === 'Big' ? 'food_SeedBig3' : 'food_SeedLarge');
    return 'food_SeedLargeWhite';
  }
  // 鱼 A 轨
  function fishSprite(id) {
    if (/^(bass|carp|ghostfish|sunfish|trout)$/.test(id)) return 'food_Fish';
    if (/^(squid|octopus)$/.test(id)) return 'food_Octopus';
    if (id === 'eel') return 'food_Shrimp';
    if (/^(redsnapper|tuna)$/.test(id)) return 'food_Sushi2';
    return '';
  }
  // v5.4：物品图标统一入口——图集精灵 / 多色字形 / 升级版色块三轨
  function farmIcon(id, size) {
    var base = String(id || '').split('_q')[0];
    var sz = size || 16;
    var wrap = el('span', 'sg5-farm-swatch');
    var spec = FARM_ICON[base];
    if (!spec && base.indexOf('seed_') === 0) {
      var sp = seedSprite(base.slice(5));
      if (sp) spec = { sprite: sp };
    }
    if (!spec) {
      var fs = fishSprite(base);
      if (fs) spec = { sprite: fs };
    }
    if (!spec) spec = cropGlyphOf(base);   // v5.6：通用作物果实按 shape 出字形
    var cv = null;
    if (spec && spec.glyph && GLYPH[spec.glyph]) {
      cv = document.createElement('canvas');
      cv.width = Math.max(10, sz - 2); cv.height = Math.max(10, sz - 2);
      cv.className = 'sg5-farm-icon';
      paintGlyph(cv.getContext('2d'), spec.glyph, sz - 2, spec.pal);
    } else if (spec && spec.sprite && FR[spec.sprite] && S.atlas) {
      cv = iconCanvas(spec.sprite, Math.max(10, sz - 2));
      cv.className = 'sg5-farm-icon';
    }
    if (cv) wrap.appendChild(cv);
    else wrap.style.background = farmItemColor(id);
    var qc = farmQualityClass(id);
    if (qc) wrap.className += ' ' + qc;
    return wrap;
  }
  // v5.4：职业短标（20 个职业全部有，挂着的一眼能看到效果）
  var PROF_MARK = {
    tiller: '作物 +10%', rancher: '畜产 +20%', artisan: '加工品 +40%', agriculturist: '生长 +10%',
    miner: '矿石 +1', geologist: '宝石成对', blacksmith: '锭 +50%', prospector: '煤 ×2',
    forester: '木材 +1', gatherer: '采集 20% 双份', lumberjack: '硬木 50%', botanist: '采集必金星',
    fisher: '鱼价 +25%', trapper: '每日蟹 ×1', angler: '鱼价 +50%', pirate: '矿洞 5% 宝箱',
    fighter: '洞血 +15%', scout: '遇怪减半', brute: '承伤 -15%', defender: '洞血 +25'
  };

  var FARM_TABS = [
    ['field', '田地'], ['craft', '加工'], ['shop', '商店'], ['bag', '背包'],
    ['ship', '出货箱'], ['skill', '技能'], ['calendar', '日历']
  ];

  // v5.3：面板会被 refreshPanel 整棵重建，操作按钮带一个稳定的 data-focus-key，
  // 重建后 refreshPanel 才能把键盘焦点放回同名按钮（值只由可见文本决定，不带随机 id）。
  function opBtn(text, cls, fn) {
    var b = uiBtn(text, cls, fn);
    b.setAttribute('data-focus-key', 'op:' + text);
    return b;
  }

  // v5.3：载入/操作失败时在内容区顶部给一条可重试的错误块。
  // 不复用 .sg5-empty、不写「正在载入…」；S.farm.p 保留着，下面照常渲染旧数据。
  function farmErrBlock() {
    if (S.farm.loadState !== 'error' && !S.farm.lastError) return null;
    var box = el('div', 'sg5-farm-err');
    box.appendChild(el('span', 'sg5-farm-err-tx', S.farm.lastError || '农场数据没能载入，下面是上次的内容。'));
    box.appendChild(opBtn('重新载入', 'sg5-btn-sm', farmState));
    return box;
  }

  // v5.3：品质四档改由 CSS 的 swatch 状态类表达，不再往元素上写内联边框色
  function farmQualityClass(id) {
    var q = Number(String(id || '').split('_q')[1] || 0);
    return q >= 3 ? 'is-star' : (q === 2 ? 'is-ready' : (q === 1 ? 'is-have' : ''));
  }

  // v5.3：不可逆 / 批量操作两步确认。第一次点击不发任何请求，只把原按钮换成
  // 内联的「确定 / 取消」；点确定才执行原回调，点取消恢复原按钮，全程不碰 apiPost。
  function confirmOps(host, label, onYes, cls) {
    var orig = uiBtn(label, cls || 'sg5-btn-sm', function () {
      var parent = orig.parentNode;
      if (!parent) return;
      var next = orig.nextSibling;
      var yes = uiBtn('确定', 'sg5-btn-sm sg5-btn-primary', function () {
        farmSfx('menu', 0.3, 1.2);
        onYes();
      });
      var no = uiBtn('取消', 'sg5-btn-sm sg5-btn-ghost', function () {
        farmSfx('cancel', 0.3, 1);
        if (yes.parentNode) yes.parentNode.removeChild(yes);
        if (no.parentNode) no.parentNode.removeChild(no);
        if (!orig.parentNode) {
          if (next && next.parentNode === parent) parent.insertBefore(orig, next);
          else parent.appendChild(orig);
        }
      });
      parent.insertBefore(yes, orig);
      parent.insertBefore(no, orig);
      parent.removeChild(orig);
      try { yes.focus(); } catch (e) {}
    });
    if (host) host.appendChild(orig);
    return orig;
  }
  function farmTabs(body) {
    var tabs = el('div', 'sg5-tabs');
    tabs.setAttribute('role', 'tablist');
    (function () {
      for (var i = 0; i < FARM_TABS.length; i++) {
        (function (t) {
          var on = S.farm.tab === t[0];
          var b = el('button', 'sg5-tab' + (on ? ' is-on' : ''), t[1]);
          b.type = 'button';
          b.setAttribute('role', 'tab');
          b.setAttribute('aria-selected', on ? 'true' : 'false');
          b.setAttribute('data-focus-key', 'tab:' + t[0]);
          b.addEventListener('click', function () {
            S.farm.tab = t[0]; refreshPanel('farm'); auSfx('menu', 0.2, 1.1);
          }, false);
          tabs.appendChild(b);
        })(FARM_TABS[i]);
      }
    })();
    body.appendChild(tabs);
  }
  function farmSection(body, title, sub) {
    var s = el('div', 'sg5-sect');
    s.appendChild(el('div', 'sg5-farm-h', title));
    if (sub) s.appendChild(el('div', 'sg5-note', sub));
    return s;
  }
  function farmBtnRow(parent, items) {
    var row = el('div', 'sg5-farm-ops');
    (function () {
      for (var i = 0; i < items.length; i++) {
        (function (it) {
          // it[3] 为真 → 两步确认；it[4] 可覆盖稳定焦点键（如甩竿用 op:cast）
          var b = it[3]
            ? confirmOps(null, it[0], it[1], it[2] || 'sg5-btn-sm')
            : opBtn(it[0], it[2] || 'sg5-btn-sm', it[1]);
          if (it[4]) b.setAttribute('data-focus-key', it[4]);
          row.appendChild(b);
        })(items[i]);
      }
    })();
    parent.appendChild(row);
    return row;
  }
  function farmNeed(P, need) {
    var inv = P.inv || {};
    return (inv[need] || 0) >= 1;
  }

  // ---------- 田地 ----------
  function farmFieldBody(body) {
    var P = farmP(); if (!P) return;
    var D = farmD(), B = farmBounds(), c = P.cal;
    var head = el('div', 'sg5-farm-summary');
    head.appendChild(el('span', 'sg5-farm-sum', c.seasonName + ' ' + c.dayInSeason + '日 · ' + c.clock + ' · ' +
      (c.weather === 'rain' ? '下雨' : c.weather === 'snow' ? '下雪' : '晴')));
    head.appendChild(el('span', 'sg5-farm-sum', '● ' + P.gold + 'g'));
    head.appendChild(el('span', 'sg5-farm-sum', '体力 ' + P.energy + '/' + P.maxEnergy));
    head.appendChild(el('span', 'sg5-farm-sum', '工具 ' + (D.TOOL_NAMES[S.farm.tool] || S.farm.tool)));
    body.appendChild(head);
    farmBtnRow(body, [
      ['回自家田里', function () {
        farmAct('goto', {}).then(function (d) {
          if (d && d.x != null && window.__sg5 && window.__sg5.teleport) window.__sg5.teleport(d.x, d.y);
          farmToast('回到了田里');
        }, function (e) { farmToast(e.message, 'warn'); });
      }, 'sg5-btn-primary'],
      ['收工睡觉', function () {
        farmAct('sleep', {}).then(function (d) {
          farmToast('歇下了（第 ' + (d && d.n ? d.n : 1) + ' 觉，体力 ' + (d && d.energy != null ? d.energy : '?') + '/' + (farmP() ? farmP().maxEnergy : '?') + '）');
        }, function (e) { farmToast(e.message, 'warn'); });
      }],
      ['切换种子（Q）', function () { farmCycleSeed(); refreshPanel('farm'); }],
      ['小镇 / 献祭', function () { S.farm.tab = 'field'; openPanel('relation'); }]
    ]);

    var wrap = farmSection(body, '我的田 · ' + B.w + '×' + B.h,
      '点格子会自动判断：空地翻土 → 播种 → 浇水 → 收获。世界里站在田上按 E 则严格按手上的工具干活。');
    var grid = el('div', 'sg5-farm-grid');
    grid.style.setProperty('--farm-cols', String(B.w));
    (function () {
      for (var r = 0; r < B.h; r++) {
        for (var cc = 0; cc < B.w; cc++) {
          (function (r, cc) {
            var p = (P.plots || {})[r + ',' + cc];
            var cls = 'sg5-farm-cell', label = '·', tip = '空地';
            if (p && p.tilled) { cls += ' is-tilled'; label = '▤'; tip = '翻好的土'; }
            if (p && p.watered) { cls += ' is-watered'; }
            var def = p && p.crop && D.CROPS[p.crop];
            if (def) {
              var need = Math.max(1, Math.round(def.days * (P.profs && P.profs.indexOf('agriculturist') >= 0 ? 0.9 : 1)));
              var ready = p.harvested && def.regrow
                ? (P.cal.day - (p.regrowDay || P.cal.day) >= def.regrow) : (p.grow || 0) >= need;
              cls += ready ? ' is-ready' : ' is-growing';
              label = ready ? '★' : String(Math.floor(p.grow || 0)) + '/' + need;
              tip = def.name + (ready ? '（可收）' : ' · 还差 ' + Math.max(1, need - Math.floor(p.grow || 0)) + ' 天');
              if (ready) cls += ' is-star';
            }
            var b = el('button', cls, label);
            b.type = 'button';
            b.setAttribute('data-r', String(r));
            b.setAttribute('data-c', String(cc));
            b.setAttribute('data-focus-key', 'cell:' + r + ',' + cc);
            var act = ready ? '收获' : (p && p.crop ? '浇水' : (p && p.tilled ? '播种' : '翻土'));
            var desc = '第 ' + r + ' 行 ' + cc + ' 列 · ' + tip + ' · 点击将：' + act;
            b.setAttribute('title', desc);
            b.setAttribute('aria-label', desc);
            if (def) b.style.borderBottomColor = def.col;
            b.addEventListener('click', function () {
              // 记住最后碰过的格子：背包里的肥料 / 洒水器要往这儿放
              S.farm.sel = { r: r, c: cc };
              farmSmartAction(r, cc);
            }, false);
            grid.appendChild(b);
          })(r, cc);
        }
      }
    })();
    wrap.appendChild(grid);
    var legend = el('div', 'sg5-farm-legend');
    legend.appendChild(el('span', '', '▤ 已翻地'));
    legend.appendChild(el('span', '', '蓝色 已浇水'));
    legend.appendChild(el('span', '', '★ 可收获'));
    legend.appendChild(el('span', '', '数字 生长天数'));
    wrap.appendChild(legend);
    body.appendChild(wrap);

    // 工具升级区
    var tools = farmSection(body, '农具铺', '升级要金币 + 矿石锭，阿岩隔天打好送到手上。');
    var tl = el('div', 'sg5-farm-list');
    (function () {
      for (var k in D.TOOL_NAMES) {
        if (!Object.prototype.hasOwnProperty.call(D.TOOL_NAMES, k)) continue;
        (function (k) {
          var lv = (P.tools || {})[k] || 0;
          var up = lv < 4 ? D.TOOL_UPGRADES[lv] : null;
          var row = el('div', 'sg5-farm-row');
          row.appendChild(el('span', 'sg5-farm-rowname', D.TOOL_NAMES[k] + ' · ' + (lv ? D.TOOL_UPGRADES[lv - 1].name : '基础')));
          row.appendChild(el('span', 'sg5-farm-rowsub', up ? (up.cost + 'g + ' + up.bars + ' ' + farmItemName(up.bar)) : '已满级'));
          if (up && !P.toolOrder) {
            var b = opBtn('升级', 'sg5-btn-sm', function () {
              farmAct('tool', { tool: k }).then(function () { farmToast('送去升级了'); },
                function (e) { farmToast(e.message, 'warn'); });
            });
            row.appendChild(b);
          }
          tl.appendChild(row);
        })(k);
      }
    })();
    if (P.toolOrder) {
      tl.appendChild(el('div', 'sg5-note', '正在打造：' + D.TOOL_NAMES[P.toolOrder.tool] + ' → ' +
        P.toolOrder.name + '，第 ' + P.toolOrder.readyDay + ' 天取。'));
    }
    tools.appendChild(tl);
    body.appendChild(tools);
  }

  // ---------- 商店 ----------
  function farmShopBody(body) {
    var P = farmP(); if (!P) return;
    var D = farmD(), c = P.cal;
    // ---- v5.5 彩蛋节：顶部粉块横幅 + 三行彩券兑换 ----
    if (c.festival && c.festival.name === '彩蛋节' && D.EGG_REDEEM) {
      var fest = el('div', 'sg5-farm-festival sg5-farm-festival-banner');
      fest.appendChild(el('div', 'sg5-farm-festival-h', '彩蛋节 · 彩券兑换'));
      var rl = el('div', 'sg5-farm-list');
      var REDEEM_NAME = { seed_strawberry: '草莓种子 ×5', speedgro: '生长激素 ×5', gold: '200 金' };
      (function () {
        for (var rid in D.EGG_REDEEM) {
          if (!Object.prototype.hasOwnProperty.call(D.EGG_REDEEM, rid)) continue;
          (function (rid) {
            var def = D.EGG_REDEEM[rid];
            var have = P.inv.ticket || 0;
            var doneToday = P.eggRedeem && P.eggRedeem.day === c.day && P.eggRedeem[rid] > 0;
            var row = el('div', 'sg5-farm-row');
            row.appendChild(farmIcon('ticket', 16));
            row.appendChild(el('span', 'sg5-farm-rowname', REDEEM_NAME[rid] || rid));
            // 三态 chip：off 券不够 / have 可兑 / done 今天已换
            row.appendChild(el('span',
              'sg5-bundle-need ' + (doneToday ? 'is-done' : (have >= def.cost ? 'is-have' : 'is-off')),
              '彩券 ' + Math.min(have, def.cost) + '/' + def.cost));
            var b = opBtn('兑换', 'sg5-btn-sm', function () {
              lifeAct('egg/redeem', { id: rid }).then(function () {
                farmToast('兑换成功：' + (REDEEM_NAME[rid] || rid));
              }, function (e) { farmToast(e.message, 'warn'); });
            });
            if (doneToday || have < def.cost) b.disabled = true;
            row.appendChild(b);
            rl.appendChild(row);
          })(rid);
        }
      })();
      fest.appendChild(rl);
      body.appendChild(fest);
    }
    var seeds = farmSection(body, '种子铺 · ' + c.seasonName,
      P.greenhouse ? '温室已解锁，四季种子都能买。' : '只卖当季种子；过季种下的作物会在换季时枯掉。');
    var list = el('div', 'sg5-farm-list');
    (function () {
      for (var k in D.CROPS) {
        if (!Object.prototype.hasOwnProperty.call(D.CROPS, k)) continue;
        (function (k) {
          var def = D.CROPS[k];
          if (def.seed <= 0) return;
          if (!P.greenhouse && def.s.length && def.s.indexOf(c.season) < 0) return;
          if (k === 'strawberry' && !(c.festival && c.festival.perk === 'strawberry')) return;
          var row = el('div', 'sg5-farm-row');
          var nm = el('span', 'sg5-farm-rowname', def.name);
          nm.style.color = def.col;
          row.appendChild(nm);
          row.appendChild(el('span', 'sg5-farm-rowsub', def.days + '天 · 售 ' + def.sell + 'g' +
            (def.regrow ? ' · 每' + def.regrow + '天复收' : '') + (def.yield > 1 ? ' · 一次' + def.yield + '个' : '')));
          var b1 = opBtn(def.seed + 'g', 'sg5-btn-sm', function () {
            farmAct('buy', { kind: 'seed', id: 'seed_' + k, n: 1 }).then(function () { farmToast('买了 1 包' + def.name + '种子'); },
              function (e) { farmToast(e.message, 'warn'); });
          });
          var b5 = opBtn('×5', 'sg5-btn-sm', function () {
            farmAct('buy', { kind: 'seed', id: 'seed_' + k, n: 5 }).then(function () { farmToast('买了 5 包' + def.name + '种子'); },
              function (e) { farmToast(e.message, 'warn'); });
          });
          row.appendChild(b1); row.appendChild(b5);
          list.appendChild(row);
        })(k);
      }
    })();
    seeds.appendChild(list);
    body.appendChild(seeds);

    var animals = farmSection(body, '畜牧棚', '每天喂一次干草、摸一摸，好感高了会出大号产物。');
    var al = el('div', 'sg5-farm-list');
    (function () {
      for (var k in D.ANIMALS) {
        if (!Object.prototype.hasOwnProperty.call(D.ANIMALS, k)) continue;
        (function (k) {
          var a = D.ANIMALS[k];
          var row = el('div', 'sg5-farm-row');
          row.appendChild(el('span', 'sg5-farm-rowname', a.name));
          row.appendChild(el('span', 'sg5-farm-rowsub', a.cost + 'g · 产 ' + farmItemName(a.product) + '（' + a.sell + 'g）'));
          row.appendChild(opBtn('买', 'sg5-btn-sm', function () {
            farmAct('buy', { kind: 'animal', id: k }).then(function () { farmToast(a.name + '住进棚里了'); },
              function (e) { farmToast(e.message, 'warn'); });
          }));
          al.appendChild(row);
        })(k);
      }
    })();
    animals.appendChild(al);
    if (P.animals && P.animals.length) {
      animals.appendChild(el('div', 'sg5-note', '棚里：' + P.animals.length + ' 只 · 在「小镇」面板里喂食 / 收取'));
    }
    body.appendChild(animals);

    var goods = farmSection(body, '资材与服务', '洒水器放在一格上，那格每天自动浇水；肥料要在播种前施。');
    farmBtnRow(goods, [
      ['干草 50g', function () { farmAct('buy', { kind: 'hay', n: 5 }); }],
      ['木材 10g', function () { farmAct('buy', { kind: 'wood', n: 5 }); }],
      ['生长激素 100g', function () { farmAct('buy', { kind: 'fert', id: 'speedgro', n: 1 }); }],
      ['高级肥料 150g', function () { farmAct('buy', { kind: 'fert', id: 'quality_fert', n: 1 }); }],
      ['洒水器 400g', function () { farmAct('buy', { kind: 'fert', id: 'sprinkler', n: 1 }); }]
    ]);
    farmBtnRow(goods, [
      ['背包扩容 ' + (P.backpack >= 24 ? '10000' : '2000') + 'g', function () {
        farmAct('buy', { kind: 'backpack' }).then(function (d) { farmToast('背包扩到 ' + d.backpack + ' 格'); },
          function (e) { farmToast(e.message, 'warn'); });
      }],
      ['扩建房子 ' + (P.houseLv ? '50000' : '10000') + 'g', function () {
        farmAct('buy', { kind: 'house' }).then(function (d) { farmToast('房子升到 ' + d.houseLv + ' 级'); },
          function (e) { farmToast(e.message, 'warn'); });
      }]
    ]);
    body.appendChild(goods);

    // ---- v5.4 加工设备：买一台永久可用，重复买只用于展示第 N 台 ----
    var mach = farmSection(body, '加工设备', '熔炉烧锭、机子做蛋黄酱奶酪、桶酿酒、灶台做料理。买一台永久可用，放在自家田边。');
    var ml = el('div', 'sg5-farm-list');
    (function () {
      var MAC = farmD().MACHINES || {};
      for (var i = 0; i < MACHINE_ORDER.length; i++) {
        (function (mk) {
          var md = MAC[mk];
          if (!md) return;
          var owned = ((farmP() || {}).machines || {})[mk] || 0;
          var row = el('div', 'sg5-farm-row');
          row.appendChild(farmIcon(mk, 16));
          row.appendChild(el('span', 'sg5-farm-rowname', md.name + (owned ? ' · 已有 ' + owned + ' 台' : '')));
          row.appendChild(el('span', 'sg5-farm-rowsub', md.desc));
          row.appendChild(opBtn(md.cost + 'g', 'sg5-btn-sm', function () {
            farmAct('buy', { kind: 'machine', id: mk }).then(function (d) {
              farmToast('买下了' + md.name + (d && d.count > 1 ? '（第 ' + d.count + ' 台）' : ''));
            }, function (e) { farmToast(e.message, 'warn'); });
          }));
          ml.appendChild(row);
        })(MACHINE_ORDER[i]);
      }
    })();
    mach.appendChild(ml);
    body.appendChild(mach);
  }

  // ---------- v5.4 加工页签：按设备分节，配方行 = 图标 + 材料 chips + 到手价 ----------
  function canCraft(P, r, n) {
    for (var k in r.inputs) {
      if (!Object.prototype.hasOwnProperty.call(r.inputs, k)) continue;
      if (((P.inv || {})[k] || 0) < r.inputs[k] * n) return false;
    }
    return (P.energy || 0) >= r.energy * n;
  }
  function craftPrice(P, outId) {
    var ps = String(outId).split('_q'), base = ps[0], q = ps[1] ? Number(ps[1]) : 0;
    var D = farmD();
    var u = (D.SELL && D.SELL[base]) || 0;
    if (!u) return 0;
    if (q && D.QUALITY && D.QUALITY[q]) u *= D.QUALITY[q].mul;
    var profs = P.profs || [];
    if (/_bar$/.test(base) && profs.indexOf('blacksmith') >= 0) u *= 1.5;
    if (profs.indexOf('artisan') >= 0) u *= 1.4;
    return Math.floor(u);
  }
  function doCraft(id, n) {
    lifeAct('craft', { id: id, n: n }).then(function (d) {
      farmToast('做好了 ' + (d && d.name ? d.name : '东西') + ' ×' + (d && d.n ? d.n : 1));
    }, function (e) { farmToast(e.message, 'warn'); });
  }
  function farmCraftBody(body) {
    var P = farmP(); if (!P) return;
    var D = farmD(), REC = P.recipes || D.RECIPES || {}, MAC = D.MACHINES || {};
    var owned = P.machines || {};
    (function () {
      for (var i = 0; i < MACHINE_ORDER.length; i++) {
        (function (mk) {
          var md = MAC[mk];
          if (!md) return;
          var have = owned[mk] || 0;
          var s = farmSection(body, md.name + (have ? ' · 已有 ' + have + ' 台' : ' · 还没有'), md.desc);
          if (!have) {
            var guide = el('div', 'sg5-farm-row');
            guide.appendChild(el('span', 'sg5-farm-rowname', '商店有售'));
            guide.appendChild(el('span', 'sg5-farm-rowsub', '「商店」页签 ' + md.cost + 'g 一台，买好就能用'));
            s.appendChild(guide);
            body.appendChild(s);
            return;
          }
          var list = el('div', 'sg5-farm-list');
          (function () {
            for (var k in REC) {
              if (!Object.prototype.hasOwnProperty.call(REC, k)) continue;
              if (REC[k].machine !== mk) continue;
              (function (k) {
                var r = REC[k];
                var row = el('div', 'sg5-farm-row sg5-farm-recipe');
                row.appendChild(farmIcon(r.out, 16));
                row.appendChild(el('span', 'sg5-farm-rowname', r.name));
                var needs = el('span', 'sg5-farm-needs');
                var lack = '';
                (function () {
                  for (var ik in r.inputs) {
                    if (!Object.prototype.hasOwnProperty.call(r.inputs, ik)) continue;
                    (function (ik) {
                      var need = r.inputs[ik], haveN = (P.inv || {})[ik] || 0;
                      // 复用献祭包的三态：off 缺 / have 够一次 / done 够五次
                      needs.appendChild(el('span',
                        'sg5-bundle-need ' + (haveN >= need ? (haveN >= need * 5 ? 'is-done' : 'is-have') : 'is-off'),
                        farmItemName(ik) + ' ' + haveN + '/' + need));
                      if (haveN < need) lack = '缺 ' + farmItemName(ik) + ' ×' + (need - haveN);
                      else if (!lack && haveN < need * 5) lack = '材料只够 ×' + Math.floor(haveN / need);
                    })(ik);
                  }
                })();
                row.appendChild(needs);
                row.appendChild(el('span', 'sg5-farm-rowsub', '到手 ' + craftPrice(P, r.out) + 'g · 体力 ' + r.energy + '/次'));
                var b1 = opBtn('制作 ×1', 'sg5-btn-sm', function () { doCraft(k, 1); });
                var b5 = opBtn('×5', 'sg5-btn-sm', function () { doCraft(k, 5); });
                if (!canCraft(P, r, 1)) b1.disabled = true;
                if (!canCraft(P, r, 5)) b5.disabled = true;
                if (lack) row.appendChild(el('span', 'sg5-farm-lack', lack));
                row.appendChild(b1);
                row.appendChild(b5);
                list.appendChild(row);
              })(k);
            }
          })();
          s.appendChild(list);
          body.appendChild(s);
        })(MACHINE_ORDER[i]);
      }
    })();
  }

  // ---------- v5.5 丰收展：展台选样 / 预览 / 提交 ----------
  // 可参展：作物果实 / 采集物 / 加工品 / 动物产品（含品质变体）；种子、资材、矿石不收
  var EXHIBIT_ANIMAL = /^(egg|big_egg|duck_egg|duck_feather|milk|big_milk|goat_milk|big_goat_milk|wool|big_wool|truffle)$/;
  function farmExhibitCands(P) {
    var D = farmD(), out = [];
    for (var k in (P.inv || {})) {
      if (!Object.prototype.hasOwnProperty.call(P.inv, k) || !P.inv[k]) continue;
      var base = String(k).split('_q')[0];
      if (base === 'ticket' || base === 'hardwood' || base.indexOf('seed_') === 0) continue;
      var ok2 = EXHIBIT_ANIMAL.test(base) || (D.CROPS && D.CROPS[base]) || (D.SELL && D.SELL[base]);
      if (ok2) { out.push(k); continue; }
      for (var i = 0; i < (D.FORAGE || []).length; i++) if (D.FORAGE[i].id === base) { out.push(k); break; }
    }
    return out;
  }
  // 评分公式与服务端 farmdata.exhibitGrade 一致（预览用，真结果以提交响应为准）
  function farmExhibitGrade(items) {
    var sumQ = 0, bases = {}, n = 0;
    for (var i = 0; i < items.length; i++) {
      var ps = String(items[i] || '').split('_q'), q = ps[1] ? Number(ps[1]) : 0;
      sumQ += Math.min(4, q + 1);
      bases[ps[0]] = 1; n++;
    }
    var avgQ = n ? sumQ / n : 0, div = 0, b;
    for (b in bases) if (Object.prototype.hasOwnProperty.call(bases, b)) div++;
    var g = (avgQ >= 2.5 && div >= 7) ? 'S' : (avgQ >= 2 && div >= 5) ? 'A' : div >= 3 ? 'B' : 'C';
    return { grade: g, avgQ: avgQ, diversity: div, gold: g === 'S' ? 1200 : g === 'A' ? 800 : g === 'B' ? 500 : 300 };
  }
  function farmExhibitBody(body) {
    var P = farmP(); if (!P) return;
    var c = P.cal;
    var s = farmSection(body, '丰收展 · 展台', '挑 9 样产物参展（作物 / 采集 / 加工 / 畜产都行）。实物不扣，提交当日锁定，奖金按评级立刻入账。');
    var submitted = P.exhibit && P.exhibit.day === c.day && P.exhibit.grade;
    if (submitted) {
      // 成绩态：只读，格子点击无响应
      var done = el('div', 'sg5-farm-cal');
      done.appendChild(el('div', 'sg5-farm-calclock', P.exhibit.grade + ' 级 · 奖金已入账'));
      var g0 = farmExhibitGrade(P.exhibit.items || []);
      done.appendChild(el('div', 'sg5-note', '品质均分 ' + g0.avgQ.toFixed(2) + ' · ' + g0.diversity + ' 种'));
      s.appendChild(done);
      var grid0 = el('div', 'sg5-exhibit-grid');
      (function () {
        var items = P.exhibit.items || [];
        for (var i = 0; i < 9; i++) {
          var cell = el('div', 'sg5-exhibit-cell');
          if (items[i]) {
            cell.appendChild(farmIcon(items[i], 16));
            cell.appendChild(el('span', 'sg5-farm-itemname', farmItemName(items[i])));
          }
          grid0.appendChild(cell);
        }
      })();
      s.appendChild(grid0);
      farmBtnRow(s, [['退回背包', function () { S.farm.exhibitMode = false; refreshPanel('farm'); }]]);
      body.appendChild(s);
      return;
    }
    var sel = S.farm.exhibitSel || (S.farm.exhibitSel = []);
    var grid = el('div', 'sg5-exhibit-grid');
    (function () {
      for (var i = 0; i < 9; i++) {
        (function (i) {
          var cell = el('button', 'sg5-exhibit-cell');
          cell.type = 'button';
          var iid = sel[i];
          if (iid) {
            cell.appendChild(farmIcon(iid, 16));
            cell.appendChild(el('span', 'sg5-farm-itemname', farmItemName(iid)));
            cell.setAttribute('title', farmItemName(iid) + ' · 点击移回背包');
          } else {
            cell.textContent = String(i + 1);
          }
          cell.addEventListener('click', function () {
            if (sel[i]) { sel.splice(i, 1); auSfx('menu', 0.2, 1.0); refreshPanel('farm'); }
          }, false);
          grid.appendChild(cell);
        })(i);
      }
    })();
    s.appendChild(grid);
    // 预览：评级大字（复用 calclock）+ 分量行
    var g = farmExhibitGrade(sel);
    var prev = el('div', 'sg5-farm-cal');
    prev.appendChild(el('div', 'sg5-farm-calclock', sel.length < 9 ? '还差 ' + (9 - sel.length) + ' 样' : (g.grade + ' 级 · ' + g.gold + 'g')));
    prev.appendChild(el('div', 'sg5-note', '品质均分 ' + g.avgQ.toFixed(2) + ' · ' + g.diversity + ' 种 · 种类越多分越高'));
    s.appendChild(prev);
    // 候选列表
    var cands = farmExhibitCands(P);
    var list = el('div', 'sg5-farm-inv');
    (function () {
      for (var i = 0; i < cands.length; i++) {
        (function (k) {
          var b = el('button', 'sg5-farm-item');
          b.type = 'button';
          b.appendChild(farmIcon(k, 16));
          b.appendChild(el('span', 'sg5-farm-itemname', farmItemName(k)));
          b.appendChild(el('span', 'sg5-farm-itemnum', '×' + P.inv[k]));
          b.addEventListener('click', function () {
            if (sel.length >= 9) { farmToast('展台只有 9 个位置，先移走一样', 'warn'); return; }
            sel.push(k); auSfx('menu', 0.2, 1.1); refreshPanel('farm');
          }, false);
          list.appendChild(b);
        })(cands[i]);
      }
    })();
    if (!cands.length) list.appendChild(el('div', 'sg5-empty', '背包里还没有可以参展的产物。'));
    s.appendChild(list);
    farmBtnRow(s, [
      ['清空展台', function () { S.farm.exhibitSel = []; refreshPanel('farm'); }],
      ['退回背包', function () { S.farm.exhibitMode = false; refreshPanel('farm'); }]
    ]);
    if (sel.length === 9) {
      farmBtnRow(s, [['确定参展', function () {
        var items = S.farm.exhibitSel.slice();
        lifeAct('exhibit/submit', { items: items }).then(function (d) {
          farmToast('参展成功：' + d.grade + ' 级，奖金 ' + d.gold + 'g 已入账');
          S.farm.exhibitMode = false;
          S.farm.exhibitSel = [];
        }, function (e) { farmToast(e.message, 'warn'); });
      }, 'sg5-btn-primary', true]]);
    }
    body.appendChild(s);
  }

  // ---------- 背包 / 箱子 ----------
  function farmInvGrid(P, items, picked, onPick, readOnly) {
    var g = el('div', 'sg5-farm-inv');
    var any = false;
    (function () {
      for (var k in items) {
        if (!Object.prototype.hasOwnProperty.call(items, k)) continue;
        if (!items[k]) continue;
        any = true;
        (function (k) {
          // 只读清单：出货箱 / 矿石清单只是展示，用 div 而不是 button，
          // 免得键盘 Tab 停在一堆没有任何行为的按钮上
          var b = el(readOnly ? 'div' : 'button', 'sg5-farm-item' + (picked === k ? ' is-on' : ''));
          if (!readOnly) {
            b.type = 'button';
            b.setAttribute('data-focus-key', 'item:' + k);
          }
          var sw = farmIcon(k, 16);
          b.appendChild(sw);
          b.appendChild(el('span', 'sg5-farm-itemname', farmItemName(k)));
          b.appendChild(el('span', 'sg5-farm-itemnum', '×' + items[k]));
          if (P.prices && P.prices[k]) b.appendChild(el('span', 'sg5-farm-itemprice', P.prices[k] + 'g'));
          if (!readOnly) b.addEventListener('click', function () { onPick(k); }, false);
          g.appendChild(b);
        })(k);
      }
    })();
    if (!any) g.appendChild(el('div', 'sg5-empty', '空的。去田里收点东西吧。'));
    return g;
  }
  function farmBagBody(body) {
    var P = farmP(); if (!P) return;
    // v5.5：丰收展展台视图（从背包页签的「参展」或日历的「去参展」进入）
    if (S.farm.exhibitMode && isExhibitDay()) { farmExhibitBody(body); return; }
    var cap = farmSection(body, '背包 ' + P.invCount + '/' + P.backpack, '点一样东西，再选要拿它做什么。种子按半价回收。');
    cap.appendChild(farmInvGrid(P, P.inv || {}, S.farm.bagSel, function (k) {
      S.farm.bagSel = k; refreshPanel('farm');
    }));
    if (S.farm.bagSel) {
      var sel = S.farm.bagSel;
      var ops = el('div', 'sg5-farm-sel');
      ops.appendChild(el('div', 'sg5-farm-selname', farmItemName(sel) + ' ×' + (P.inv[sel] || 0)));
      // v5.4：锭类加成价提示（铁匠 +50% 已含在 prices 里，这里把原价也亮出来）
      var selBase = String(sel).split('_q')[0];
      if (/(_bar)$/.test(selBase)) {
        var D2 = farmD(), ps2 = String(sel).split('_q'), q2n = ps2[1] ? Number(ps2[1]) : 0;
        var baseP = Math.floor((((D2.SELL || {})[selBase]) || 0) * (q2n && D2.QUALITY[q2n] ? D2.QUALITY[q2n].mul : 1));
        var nowP = (P.prices && P.prices[sel]) || 0;
        if (nowP > baseP) {
          ops.appendChild(el('div', 'sg5-farm-note-inline', '原价 ' + baseP + 'g → 加成价 ' + nowP + 'g（铁匠 +50%）'));
        }
      }
      // v5.4：能吃的物品追加「吃掉」；星果永久加体力上限，走两步确认
      var eatDef = P.eat ? P.eat[selBase] : null;
      if (selBase === 'starfruit') {
        farmBtnRow(ops, [['吃下星果（体力上限永久 +34）', function () {
          lifeAct('eat', { item: sel }).then(function (d) {
            farmToast('体力上限升到 ' + d.maxEnergy + '，整个人都精神了');
          }, function (e) { farmToast(e.message, 'warn'); });
        }, 'sg5-btn-sm', true]]);
      } else if (eatDef) {
        var full = (P.energy || 0) >= (P.maxEnergy || 100);
        var eb = opBtn('吃掉（+' + eatDef + ' 体力）', 'sg5-btn-sm', function () {
          lifeAct('eat', { item: sel }).then(function (d) {
            farmToast('吃掉了，体力 ' + d.energy + '/' + d.maxEnergy);
          }, function (e) { farmToast(e.message, 'warn'); });
        });
        if (full) eb.disabled = true;
        var eatRow = el('div', 'sg5-farm-ops');
        eatRow.appendChild(eb);
        if (full) eatRow.appendChild(el('span', 'sg5-farm-lack', '体力已满'));
        ops.appendChild(eatRow);
      }
      // v5.5：彩蛋彩券只在彩蛋节当天、只走商店页签兑换
      if (selBase === 'ticket') {
        ops.appendChild(el('div', 'sg5-farm-note-inline', '彩蛋节限定：点右上『商店』页签兑换，过期作废'));
      }
      var bagOps = [
        ['卖 1 个', function () {
          var it = {}; it[sel] = 1;
          farmAct('sell', { items: it }).then(function (d) { farmToast('卖了 ' + d.gold + 'g'); },
            function (e) { farmToast(e.message, 'warn'); });
        }],
        ['全部卖掉', function () {
          var it = {}; it[sel] = P.inv[sel] || 0;
          farmAct('sell', { items: it }).then(function (d) { farmToast('卖了 ' + d.gold + 'g'); },
            function (e) { farmToast(e.message, 'warn'); });
        }, 'sg5-btn-sm', true],
        ['放进出货箱', function () {
          var it = {}; it[sel] = P.inv[sel] || 0;
          farmAct('ship', { items: it }).then(function () { farmToast('明天早上结账'); },
            function (e) { farmToast(e.message, 'warn'); });
        }, 'sg5-btn-sm', true],
        ['存进箱子', function () {
          var it = {}; it[sel] = P.inv[sel] || 0;
          farmAct('chest', { mode: 'put', items: it }).then(function () { farmToast('收进箱子了'); },
            function (e) { farmToast(e.message, 'warn'); });
        }, 'sg5-btn-sm', true],
        ['施肥 / 洒水器', function () {
          if (!S.farm.sel) { farmToast('先在「田地」里点一格', 'warn'); return; }
          farmAct('fertilize', { r: S.farm.sel.r, c: S.farm.sel.c, fert: sel }).then(function () { farmToast('施好了'); },
            function (e) { farmToast(e.message, 'warn'); });
        }],
        ['送给镇上的人', function () { S.farm.relationTab = 'villagers'; openPanel('relation'); }]
      ];
      // v5.5：丰收展当天追加「参展」入口（切到展台视图）
      if (isExhibitDay()) {
        bagOps.push(['参展', function () {
          S.farm.exhibitMode = true;
          refreshPanel('farm');
        }]);
      }
      farmBtnRow(ops, bagOps);
      cap.appendChild(ops);
    }
    body.appendChild(cap);
    var chest = farmSection(body, '家里的箱子', '箱子不占背包格。点一下取回一格堆叠。');
    chest.appendChild(farmInvGrid(P, P.chest || {}, null, function (k) {
      var it = {}; it[k] = (P.chest || {})[k] || 1;
      farmAct('chest', { mode: 'take', items: it }).then(function () { farmToast('取回来了'); },
        function (e) { farmToast(e.message, 'warn'); });
    }));
    body.appendChild(chest);
  }

  // ---------- 出货箱 ----------
  function farmShipBody(body) {
    var P = farmP(); if (!P) return;
    var s = farmSection(body, '出货箱', '放进去的东西在第二天清晨一起结账 —— 和原作一样，不点即时到账。');
    var total = 0;
    for (var k in (P.ship || {})) if (Object.prototype.hasOwnProperty.call(P.ship, k)) {
      total += (P.prices && P.prices[k] ? P.prices[k] : 0) * P.ship[k];
    }
    s.appendChild(el('div', 'sg5-farm-big', '明早预计进账 ' + total + 'g'));
    s.appendChild(farmInvGrid(P, P.ship || {}, null, function () {}, true));
    body.appendChild(s);
    var st = farmSection(body, '账本', '');
    st.appendChild(el('div', 'sg5-farm-big', '累计出货 ' + (P.shipTotal || 0) + 'g'));
    st.appendChild(el('div', 'sg5-note', '收获 ' + (P.stats.harvest || 0) + ' 次 · 钓到 ' + (P.stats.fish || 0) +
      ' 条 · 挖到 ' + (P.stats.ore || 0) + ' 块矿 · 送过 ' + (P.stats.gift || 0) + ' 份礼 · 昏厥 ' + (P.faint || 0) + ' 次'));
    body.appendChild(st);
  }

  // ---------- 技能 ----------
  function farmSkillBody(body) {
    var P = farmP(); if (!P) return;
    var D = farmD();
    var s = farmSection(body, '五项技能', '收获、钓鱼、挖矿、送礼都会涨经验；5 级与 10 级各选一次职业，选了不能改。');
    var list = el('div', 'sg5-farm-list');
    (function () {
      for (var i = 0; i < D.SKILLS.length; i++) {
        (function (sk) {
          var xp = (P.skills || {})[sk] || 0, lv = (P.levels || {})[sk] || 0;
          var next = (P.nextLevelXp || {})[sk] || 0;
          var prev = lv > 0 ? D.SKILL_XP[lv - 1] : 0;
          var span = lv >= 10 ? 1 : (D.SKILL_XP[lv] - prev);
          var pct = lv >= 10 ? 1 : Math.max(0, Math.min(1, (xp - prev) / (span || 1)));
          var row = el('div', 'sg5-farm-skill');
          row.appendChild(el('span', 'sg5-farm-rowname', D.SKILL_NAMES[sk] + ' Lv.' + lv));
          var bar = el('div', 'sg5-farm-xpbar');
          var fill = el('div', 'sg5-farm-xpfill');
          fill.style.transform = 'scaleX(' + pct.toFixed(3) + ')';
          bar.appendChild(fill); row.appendChild(bar);
          row.appendChild(el('span', 'sg5-farm-rowsub', lv >= 10 ? '满级' : xp + ' / ' + D.SKILL_XP[lv] + '（还差 ' + next + '）'));
          var tier = lv >= 10 ? 10 : lv >= 5 ? 5 : 0;
          if (tier && D.PROFESSIONS[sk] && D.PROFESSIONS[sk][tier]) {
            // v5.6 W2 布局⑤：Lv10 行拆两组 —— 数据行在上，职业按钮 .sg5-farm-skill-ops 在下
            var ops = el('div', 'sg5-farm-skill-ops');
            var opts = D.PROFESSIONS[sk][tier];
            for (var j = 0; j < opts.length; j++) {
              (function (o) {
                var chosen = P.profs && P.profs.indexOf(o[0]) >= 0;
                var b = opBtn(chosen ? '✓ ' + o[1] : o[1], chosen ? 'sg5-btn-sm sg5-btn-primary' : 'sg5-btn-sm', function () {
                  if (chosen) return;
                  farmAct('profession', { skill: sk, id: o[0] }).then(function () { farmToast('选了「' + o[1] + '」'); },
                    function (e) { farmToast(e.message, 'warn'); });
                });
                ops.appendChild(b);
                // v5.4：已选职业后面跟一枚短标，效果不用翻说明也能看见
                if (chosen && PROF_MARK[o[0]]) ops.appendChild(el('span', 'sg5-farm-profmark', PROF_MARK[o[0]]));
              })(opts[j]);
            }
            row.appendChild(ops);
          }
          list.appendChild(row);
        })(D.SKILLS[i]);
      }
    })();
    s.appendChild(list);
    body.appendChild(s);
    if (P.profs && P.profs.length) {
      body.appendChild(el('div', 'sg5-note', '已选职业：' + P.profs.join(' / ')));
    }
  }

  // ---------- 日历 ----------
  function farmCalendarBody(body) {
    var P = farmP(); if (!P) return;
    var D = farmD(), c = P.cal;
    var s = farmSection(body, '第 ' + c.year + ' 年 · ' + c.seasonName + ' 第 ' + c.dayInSeason + ' 天',
      '一季 ' + D.SEASON_DAYS + ' 天，四季轮转。全班共用同一本日历，谁也不会被时间落下。');
    var big = el('div', 'sg5-farm-cal');
    big.appendChild(el('div', 'sg5-farm-calclock', c.clock));
    var pct = Math.round(c.dayInSeason / D.SEASON_DAYS * 100);
    var bar = el('div', 'sg5-farm-xpbar');
    var fill = el('div', 'sg5-farm-xpfill'); fill.style.transform = 'scaleX(' + (pct / 100).toFixed(3) + ')';
    bar.appendChild(fill); big.appendChild(bar);
    big.appendChild(el('div', 'sg5-note', '本季已过 ' + pct + '% · 今天 ' +
      (c.weather === 'rain' ? '下雨（不用浇水）' : c.weather === 'snow' ? '下雪（不用浇水）' : '晴天')));
    s.appendChild(big);
    body.appendChild(s);

    var fes = farmSection(body, '今年的节日', '节日当天来领礼，商店与好感还会有临时加成。');
    var fl = el('div', 'sg5-farm-list');
    (function () {
      for (var i = 0; i < D.FESTIVALS.length; i++) {
        (function (f) {
          var row = el('div', 'sg5-farm-row');
          row.appendChild(el('span', 'sg5-farm-rowname', D.SEASONS[f.day[0]] + ' ' + f.day[1] + '日 · ' + f.name));
          row.appendChild(el('span', 'sg5-farm-rowsub', f.desc));
          if (f.day[0] === c.season && f.day[1] === c.dayInSeason) {
            if (f.perk === 'exhibit') {
              // v5.5：丰收展当天按钮改为「去参展」——奖金在展台按评级结算，没有固定礼
              row.appendChild(opBtn('去参展', 'sg5-btn-sm sg5-btn-primary', function () {
                S.farm.tab = 'bag';
                refreshPanel('farm');
              }));
            } else {
              row.appendChild(opBtn('领礼', 'sg5-btn-sm sg5-btn-primary', function () {
                lifeAct('festival', {}).then(function (d) { farmToast(d.festival + '：' + d.gift); },
                  function (e) { farmToast(e.message, 'warn'); });
              }));
            }
          }
          fl.appendChild(row);
        })(D.FESTIVALS[i]);
      }
    })();
    fes.appendChild(fl); body.appendChild(fes);

    var bday = farmSection(body, '镇上人的生日', '生日送礼好感 ×8 —— 一年里最划算的一天。');
    var bl = el('div', 'sg5-farm-list');
    (function () {
      for (var k in D.VILLAGERS) {
        if (!Object.prototype.hasOwnProperty.call(D.VILLAGERS, k)) continue;
        (function (k) {
          var v = D.VILLAGERS[k];
          var row = el('div', 'sg5-farm-row');
          row.appendChild(el('span', 'sg5-farm-rowname', v.name));
          row.appendChild(el('span', 'sg5-farm-rowsub', D.SEASONS[v.birthday[0]] + ' ' + v.birthday[1] + '日'));
          bl.appendChild(row);
        })(k);
      }
    })();
    bday.appendChild(bl); body.appendChild(bday);
    farmBtnRow(body, [
      ['去社区中心交献祭包', function () { S.farm.relationTab = 'bundles'; openPanel('relation'); }],
      ['看看镇上的人', function () { S.farm.relationTab = 'villagers'; openPanel('relation'); }]
    ]);
  }

  PANELS.farm = function () {
    var P = farmP();
    var sh = panelShell('农场', P ? (P.cal.seasonName + ' ' + P.cal.dayInSeason + '日 · ' + P.gold + 'g') : '正在载入…');
    sh.root.className = 'sg5-panel sg5-panel-wide sg5-panel-farm';
    var errBlock = farmErrBlock();
    if (errBlock) sh.body.appendChild(errBlock);
    farmTabs(sh.body);
    var cont = el('div', 'sg5-farm-cont');
    if (!P) cont.appendChild(el('div', 'sg5-empty', '农场还没载入，稍等一下…'));
    else if (S.farm.tab === 'field') farmFieldBody(cont);
    else if (S.farm.tab === 'craft') farmCraftBody(cont);
    else if (S.farm.tab === 'shop') farmShopBody(cont);
    else if (S.farm.tab === 'bag') farmBagBody(cont);
    else if (S.farm.tab === 'ship') farmShipBody(cont);
    else if (S.farm.tab === 'skill') farmSkillBody(cont);
    else farmCalendarBody(cont);
    sh.body.appendChild(cont);
    return sh.root;
  };


  // ======================== 17_relation.js ========================
  // ---------------- §18 小镇：村民好感 / 同学送礼 / 献祭包 / 畜牧棚 ----------------

  var REL_TABS = [
    ['villagers', '镇上的人'], ['classmates', '班里同学'],
    ['bundles', '社区中心'], ['animals', '畜牧棚']
  ];
  function relTabs(body) {
    var tabs = el('div', 'sg5-tabs');
    tabs.setAttribute('role', 'tablist');
    (function () {
      for (var i = 0; i < REL_TABS.length; i++) {
        (function (t) {
          var on = S.farm.relationTab === t[0];
          var b = el('button', 'sg5-tab' + (on ? ' is-on' : ''), t[1]);
          b.type = 'button';
          b.setAttribute('role', 'tab');
          b.setAttribute('aria-selected', on ? 'true' : 'false');
          b.setAttribute('data-focus-key', 'rtab:' + t[0]);
          b.addEventListener('click', function () {
            S.farm.relationTab = t[0]; refreshPanel('relation'); auSfx('menu', 0.2, 1.1);
          }, false);
          tabs.appendChild(b);
        })(REL_TABS[i]);
      }
    })();
    body.appendChild(tabs);
  }

  // 送礼选择器：把背包里能送的东西平铺出来，点一样就送
  function relGiftRow(npc, onSend) {
    var P = farmP(); if (!P) return el('div', 'sg5-empty', '背包还没载入');
    var box = el('div', 'sg5-rel-gifts');
    box.appendChild(el('div', 'sg5-note', '选一样东西送出去（金星品质、生日、最爱都会放大好感）：'));
    var grid = el('div', 'sg5-farm-inv');
    var any = false;
    (function () {
      for (var k in (P.inv || {})) {
        if (!Object.prototype.hasOwnProperty.call(P.inv, k)) continue;
        if (!P.inv[k]) continue;
        any = true;
        (function (k) {
          var b = el('button', 'sg5-farm-item');
          b.type = 'button';
          b.setAttribute('data-focus-key', 'gift:' + k);
          var sw = farmIcon(k, 16);
          b.appendChild(sw);
          b.appendChild(el('span', 'sg5-farm-itemname', farmItemName(k)));
          b.appendChild(el('span', 'sg5-farm-itemnum', '×' + P.inv[k]));
          // 两步确认：第一次点击只在原地换成「确定 / 取消」，不发任何请求
          b.addEventListener('click', function () {
            var parent = grid;
            if (!parent || b.parentNode !== parent) return;
            var next = b.nextSibling;
            var yes = uiBtn('确定', 'sg5-btn-sm sg5-btn-primary', function () {
              farmSfx('menu', 0.3, 1.2);
              onSend(k);
            });
            var no = uiBtn('取消', 'sg5-btn-sm sg5-btn-ghost', function () {
              farmSfx('cancel', 0.3, 1);
              if (yes.parentNode) yes.parentNode.removeChild(yes);
              if (no.parentNode) no.parentNode.removeChild(no);
              if (!b.parentNode) {
                if (next && next.parentNode === parent) parent.insertBefore(b, next);
                else parent.appendChild(b);
              }
            });
            parent.insertBefore(yes, b);
            parent.insertBefore(no, b);
            parent.removeChild(b);
            try { yes.focus(); } catch (e) {}
          }, false);
          grid.appendChild(b);
        })(k);
      }
    })();
    if (!any) grid.appendChild(el('div', 'sg5-empty', '背包空空的，先去田里收点东西。'));
    box.appendChild(grid);
    return box;
  }
  function relHearts(pts, P) {
    var per = (P && P.heartPts) || 250;
    var h = Math.max(0, Math.min(10, Math.floor(pts / per)));
    var row = el('div', 'sg5-rel-heartrow');
    var box = el('div', 'sg5-rel-hearts');
    box.setAttribute('role', 'img');
    box.setAttribute('aria-label', '好感 ' + h + ' / 10 颗心');
    for (var i = 0; i < 10; i++) {
      var sp = el('span', 'sg5-rel-heart' + (i < h ? ' is-on' : ''), i < h ? '♥' : '♡');
      sp.setAttribute('aria-hidden', 'true');
      box.appendChild(sp);
    }
    row.appendChild(box);
    // 容器外的静态文本，读屏除了 img 标签之外也有明确的数字
    row.appendChild(el('span', 'sg5-rel-hearts-num', h + '/10'));
    return row;
  }

  function relVillagers(body) {
    var P = farmP(); if (!P) return;
    var D = farmD(), c = P.cal;
    var s = farmSection(body, '镇上的四个人',
      '每天说一句话 +20，每周最多送两次礼；最爱 +80、喜欢 +45、讨厌 −40。8 心后送花束才能继续到 10 心。');
    (function () {
      for (var k in D.VILLAGERS) {
        if (!Object.prototype.hasOwnProperty.call(D.VILLAGERS, k)) continue;
        (function (k) {
          var v = D.VILLAGERS[k];
          var r = (P.relations || {})[k] || { pts: 0, gifts: {}, bouquet: 0, seen: [] };
          var card = el('div', 'sg5-rel-card');
          var head = el('div', 'sg5-rel-head');
          head.appendChild(el('span', 'sg5-rel-name', v.name));
          var bd = (v.birthday[0] === c.season && v.birthday[1] === c.dayInSeason);
          head.appendChild(el('span', 'sg5-rel-sub', D.SEASONS[v.birthday[0]] + ' ' + v.birthday[1] + '日' + (bd ? ' · 今天生日！' : '')));
          card.appendChild(head);
          card.appendChild(relHearts(r.pts || 0, P));
          card.appendChild(el('div', 'sg5-note', '最爱：' + farmTasteName(v.love) + '　喜欢：' + farmTasteName(v.like) +
            '　讨厌：' + farmTasteName(v.hate) + '　好感 ' + (r.pts || 0)));
          var hearts = Math.floor((r.pts || 0) / (P.heartPts || 250));
          farmBtnRow(card, [
            ['说句话', function () {
              lifeAct('talk', { npc: k }).then(function (d) {
                farmToast(d.talked ? '聊了几句，好感 +20' : '今天已经聊过了');
              }, function (e) { farmToast(e.message, 'warn'); });
            }],
            [r.bouquet ? '已送花束' : '送花束（200g）', function () {
              lifeAct('bouquet', { npc: k }).then(function () { farmToast('她收下了花束'); },
                function (e) { farmToast(e.message, 'warn'); });
            }, 'sg5-btn-sm', true],
            [P.spouse === k ? '已成家' : '求婚（1500g）', function () {
              lifeAct('marry', { npc: k }).then(function (d) { farmToast('♥ 和' + d.name + '成家了'); },
                function (e) { farmToast(e.message, 'warn'); });
            }, 'sg5-btn-sm', true]
          ]);
          card.appendChild(relGiftRow(k, function (item) {
            lifeAct('gift', { npc: k, item: item }).then(function (d) {
              farmToast(v.name + (d.pts >= 0 ? '收下了' : '不太喜欢') + '：' + d.pts + ' 好感' + (d.birthday ? '（生日 ×8）' : ''));
            }, function (e) { farmToast(e.message, 'warn'); });
          }));
          s.appendChild(card);
        })(k);
      }
    })();
    body.appendChild(s);
    if (P.spouse) {
      body.appendChild(el('div', 'sg5-note', '家里有人在等：' + (D.VILLAGERS[P.spouse] ? D.VILLAGERS[P.spouse].name : P.spouse)));
      farmBtnRow(body, [['和家里人说说话', function () {
        lifeAct('spouse', {}).then(function (d) { farmToast(d.spouse ? '家里暖暖的' : '还没成家'); });
      }]]);
    }
  }
  function farmTasteName(arr) {
    if (!arr || !arr.length) return '—';
    var M = { crop: '作物', flower: '花', fish: '鱼', ore: '矿石', gem: '宝石', animal: '畜产', food: '食物' };
    var out = [];
    for (var i = 0; i < arr.length; i++) out.push(M[arr[i]] || arr[i]);
    return out.join(' / ');
  }

  function relClassmates(body) {
    var P = farmP(); if (!P) return;
    var s = farmSection(body, '班里的同学', '送出背包里的一样东西，对方会立刻收到提醒。好友与羁绊沿用「一起玩」的名单。');
    var list = (S.friends || []).slice(0, 24);
    if (!list.length) s.appendChild(el('div', 'sg5-empty', '还没有好友。先在「一起玩」里加个同学吧。'));
    // v5.3：24 人 × 整份背包会把 DOM 撑爆，改成点名字选中一人、只展开一份礼物选择器
    var wrap = el('div', 'sg5-classmates');
    var names = {};
    (function () {
      for (var i = 0; i < list.length; i++) {
        (function (p) {
          var uid = String(p.id || p.uid || p.userId || '');
          var nm = p.name || p.n || (typeof nameOf === 'function' ? nameOf(uid) : uid);
          names[uid] = nm;
          var bond = (S.bonds || {})[uid] || (P.relations && P.relations[uid] && P.relations[uid].pts) || 0;
          var sel = S.farm.relGiftTo === uid;
          var row = el('button', 'sg5-classmate');
          row.type = 'button';
          row.setAttribute('data-focus-key', 'classmate:' + uid);
          row.setAttribute('aria-pressed', sel ? 'true' : 'false');
          row.appendChild(el('span', 'sg5-classmate-name', nm));
          row.appendChild(el('span', 'sg5-classmate-sub', (p.online ? '在线' : '离线') + ' · 羁绊 ' + bond));
          row.addEventListener('click', function () {
            S.farm.relGiftTo = (S.farm.relGiftTo === uid) ? '' : uid;
            refreshPanel('relation');
          }, false);
          wrap.appendChild(row);
        })(list[i]);
      }
    })();
    s.appendChild(wrap);
    if (S.farm.relGiftTo) {
      var to = S.farm.relGiftTo;
      var toName = names[to] || to;
      var box = el('div', 'sg5-rel-giftpick');
      box.appendChild(el('div', 'sg5-note', '给 ' + toName + ' 选一样礼物：'));
      box.appendChild(relGiftRow(to, function (item) {
        lifeAct('playergift', { to: to, item: item }).then(function () {
          farmToast('送给了 ' + toName + ' 一份' + farmItemName(item));
        }, function (e) { farmToast(e.message, 'warn'); });
      }));
      s.appendChild(box);
    }
    body.appendChild(s);
  }

  function relBundles(body) {
    var P = farmP(); if (!P) return;
    var D = farmD();
    var done = 0;
    for (var z = 0; z < D.BUNDLES.length; z++) if (P.bundles[D.BUNDLES[z].id] && P.bundles[D.BUNDLES[z].id].done) done++;
    var s = farmSection(body, '社区中心 · 献祭包 ' + done + '/' + D.BUNDLES.length,
      P.greenhouse ? '全部交齐了：温室已修好，冬天也能种地。' : '交齐一整间房就修好一部分；全部交齐解锁温室（四季可种）。');
    (function () {
      for (var i = 0; i < D.BUNDLES.length; i++) {
        (function (b) {
          var slot = (P.bundles || {})[b.id] || { items: {}, done: 0 };
          var card = el('div', 'sg5-rel-card');
          var head = el('div', 'sg5-rel-head');
          head.appendChild(el('span', 'sg5-rel-name', b.name + (slot.done ? ' ✓' : '')));
          head.appendChild(el('span', 'sg5-rel-sub', b.room + ' · 奖励 ' + b.reward.n + ' ' + farmItemName(b.reward.id)));
          card.appendChild(head);
          var row = el('div', 'sg5-bundle-needs');
          (function () {
            for (var j = 0; j < b.need.length; j++) {
              (function (n) {
                var needId = n.indexOf('gold_') === 0 ? n.slice(5) + '_q2' : n;
                var have = (P.inv || {})[needId] > 0;
                var got = !!slot.items[n];
                var state = got ? 'is-done' : (have ? 'is-have' : 'is-off');
                var cell = el('span', 'sg5-bundle-need ' + state);
                var mark = el('span', 'sg5-bundle-mark', got ? '✓ ' : (have ? '+ ' : '· '));
                mark.setAttribute('aria-hidden', 'true');
                cell.appendChild(mark);
                cell.appendChild(el('span', null, farmItemName(needId)));
                row.appendChild(cell);
              })(b.need[j]);
            }
          })();
          card.appendChild(row);
          if (!slot.done) {
            farmBtnRow(card, [['交上背包里已有的', function () {
              var items = {};
              for (var j = 0; j < b.need.length; j++) {
                var n = b.need[j];
                var needId = n.indexOf('gold_') === 0 ? n.slice(5) + '_q2' : n;
                if (!slot.items[n] && (P.inv || {})[needId] > 0) items[n] = 1;
              }
              lifeAct('bundle', { id: b.id, items: items }).then(function (d) {
                farmToast(d.reward ? '交齐了！领到 ' + d.reward : '交上去 ' + d.moved + ' 样，还差 ' + d.left + ' 样');
              }, function (e) { farmToast(e.message, 'warn'); });
            }, 'sg5-btn-sm', true]]);
          }
          s.appendChild(card);
        })(D.BUNDLES[i]);
      }
    })();
    body.appendChild(s);
  }

  function relAnimals(body) {
    var P = farmP(); if (!P) return;
    var D = farmD();
    var s = farmSection(body, '畜牧棚 ' + ((P.animals || []).length) + ' 只',
      '每天喂一次干草（杂货铺 50g）、摸一摸，第二天早上就有产出；好感越高越容易出大号产物。');
    if (!(P.animals || []).length) s.appendChild(el('div', 'sg5-empty', '棚里还空着。去「农场 → 商店」领一只回来。'));
    (function () {
      for (var i = 0; i < (P.animals || []).length; i++) {
        (function (a) {
          var def = D.ANIMALS[a.kind] || { name: a.kind };
          var card = el('div', 'sg5-rel-card');
          var head = el('div', 'sg5-rel-head');
          head.appendChild(el('span', 'sg5-rel-name', a.name));
          head.appendChild(el('span', 'sg5-rel-sub', '好感 ' + a.love + '/1000' +
            (P.cal.day < a.matureDay ? ' · 还要 ' + (a.matureDay - P.cal.day) + ' 天长大' : ' · 已成年')));
          card.appendChild(head);
          farmBtnRow(card, [
            ['喂干草', function () {
              lifeAct('animal', { mode: 'feed', uid: a.uid }).then(function () { farmToast(a.name + '吃得很香'); },
                function (e) { farmToast(e.message, 'warn'); });
            }],
            ['摸一摸', function () {
              lifeAct('animal', { mode: 'pet', uid: a.uid }).then(function () { farmToast(a.name + '蹭了蹭你'); },
                function (e) { farmToast(e.message, 'warn'); });
            }],
            [a.product && !a.collected ? '收取 ' + farmItemName(a.product) : '今天没有产出', function () {
              lifeAct('animal', { mode: 'collect', uid: a.uid }).then(function (d) {
                farmToast('收到了 ' + d.name);
              }, function (e) { farmToast(e.message, 'warn'); });
            }]
          ]);
          s.appendChild(card);
        })(P.animals[i]);
      }
    })();
    body.appendChild(s);
  }

  PANELS.relation = function () {
    var P = farmP();
    var sh = panelShell('小镇', P ? (P.cal.seasonName + ' · ' + (P.spouse ? '已安家' : '一个人住')) : '正在载入…');
    sh.root.className = 'sg5-panel sg5-panel-wide sg5-panel-farm';
    var errBlock = farmErrBlock();
    if (errBlock) sh.body.appendChild(errBlock);
    relTabs(sh.body);
    var cont = el('div', 'sg5-farm-cont');
    if (!P) cont.appendChild(el('div', 'sg5-empty', '小镇还没载入…'));
    else if (S.farm.relationTab === 'villagers') relVillagers(cont);
    else if (S.farm.relationTab === 'classmates') relClassmates(cont);
    else if (S.farm.relationTab === 'bundles') relBundles(cont);
    else relAnimals(cont);
    sh.body.appendChild(cont);
    return sh.root;
  };


  // ======================== 18_fishing_mine.js ========================
  // ---------------- §19 钓鱼小游戏 / 矿洞 / 图鉴 ----------------
  //
  // 钓鱼是原作那根「绿条」：按住让游标上浮、松开下沉，把鱼压在绿条里进度才涨。
  // 鱼由服务端在甩竿那一刻决定，客户端只负责把「贴合得有多好」交回去，刷不出稀有鱼。

  var MINE_TABS = [['fish', '钓鱼'], ['mine', '矿洞'], ['dex', '图鉴']];
  function mineTabs(body) {
    var tabs = el('div', 'sg5-tabs');
    tabs.setAttribute('role', 'tablist');
    (function () {
      for (var i = 0; i < MINE_TABS.length; i++) {
        (function (t) {
          var on = S.farm.mineTab === t[0];
          var b = el('button', 'sg5-tab' + (on ? ' is-on' : ''), t[1]);
          b.type = 'button';
          b.setAttribute('role', 'tab');
          b.setAttribute('aria-selected', on ? 'true' : 'false');
          b.setAttribute('data-focus-key', 'mtab:' + t[0]);
          b.addEventListener('click', function () {
            S.farm.mineTab = t[0]; refreshPanel('mine'); auSfx('menu', 0.2, 1.1);
          }, false);
          tabs.appendChild(b);
        })(MINE_TABS[i]);
      }
    })();
    body.appendChild(tabs);
  }
  function qteClamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function qteEditable() {
    var ae = document.activeElement;
    if (!ae) return false;
    var tag = ae.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || !!ae.isContentEditable;
  }
  function qteDown(e) {
    if (qteEditable()) return;
    var q = S.farm.qte; if (!q) return;
    if (e && (e.code === 'Space' || e.key === ' ' || e.type === 'mousedown' || e.type === 'touchstart')) {
      q.hold = true; if (e.preventDefault) e.preventDefault();
    }
  }
  function qteUp(e) {
    if (qteEditable()) return;
    var q = S.farm.qte; if (!q) return;
    if (e && (e.code === 'Space' || e.key === ' ' || e.type === 'mouseup' || e.type === 'touchend')) {
      q.hold = false;
      // 空格抬起会触发聚焦按钮的 click，补一个 preventDefault 免得误点
      if ((e.code === 'Space' || e.key === ' ') && e.preventDefault) e.preventDefault();
    }
  }
  function qtePaint() {
    var q = S.farm.qte; if (!q) return;
    var root = document.querySelector('.sg5-qte'); if (!root) return;
    var cur = root.querySelector('.sg5-qte-cursor');
    var zone = root.querySelector('.sg5-qte-zone');
    var fill = root.querySelector('.sg5-qte-fill');
    var track = root.querySelector('.sg5-qte-track');
    var pb = root.querySelector('.sg5-qte-bar');
    var H = (track && track.clientHeight) || 240;
    function px(v) { return Math.round(v / 2) * 2; }
    // v5.3：top/height 一律整数像素且取 2 的倍数，避免小数像素把点阵边糊掉
    if (cur) cur.style.top = px((1 - q.y) * H) + 'px';
    if (zone) {
      zone.style.height = px(q.green * H) + 'px';
      zone.style.top = px((1 - q.targetY - q.green / 2) * H) + 'px';
    }
    if (fill) fill.style.transform = 'scaleX(' + q.progress + ')';
    // 读屏播报只在 ±10% 档位变化时才改，别每 30ms 刷屏
    if (pb && pb.setAttribute) {
      var step = Math.round(q.progress * 10) * 10;
      if (q.ariaStep !== step) {
        q.ariaStep = step;
        pb.setAttribute('aria-valuetext', '进度 ' + step + '%');
      }
    }
  }
  function qteCleanup() {
    var q = S.farm.qte;
    if (q && q.timer) { try { clearInterval(q.timer); } catch (e) {} }
    document.removeEventListener('keydown', qteDown, false);
    document.removeEventListener('keyup', qteUp, false);
    document.removeEventListener('mouseup', qteUp, false);
    S.farm.qte = null;
    S.fishBusy = 0;   // v5.6：清理时兜底放锁，别让 fishBusy 卡死
  }
  function qteStop(success) {
    var q = S.farm.qte; if (!q) return;
    var ratio = q.hit / Math.max(1, q.frames);
    var score = success ? qteClamp(0.6 + 0.4 * ratio, 0, 1) : 0.2;
    if (q.timer) { try { clearInterval(q.timer); } catch (e) {} }
    document.removeEventListener('keydown', qteDown, false);
    document.removeEventListener('keyup', qteUp, false);
    document.removeEventListener('mouseup', qteUp, false);
    S.farm.qte = null;
    // v5.6：fishBusy 覆盖到 result 结算完成才释放
    S.fishBusy = 1;
    lifeAct('fish/result', { score: score }).then(function (d) {
      S.fishBusy = 0;
      if (d && d.caught) {
        farmToast('钓上了 ' + d.name + (d.perfect ? ' · 完美！' : '') + '，值 ' + d.price + 'g' +
          (d.contestCounted === false ? ' · 本竿不计入赛绩（前 3 竿已计满）' : ''));
      } else {
        farmToast((d && d.reason) || '鱼跑了', 'warn');
      }
      focusCast();
    }, function (e) {
      farmToast(e.message || '鱼跑了', 'warn');
      S.fishBusy = 0;
      focusCast();
    });
  }
  // 结算后面板已经重建回「甩竿」态，把键盘焦点送回甩竿按钮
  function focusCast() {
    setTimeout(function () {
      try {
        var b = document.querySelector('[data-focus-key="op:cast"]');
        if (b) b.focus();
      } catch (e) {}
    }, 0);
  }
  function qteStart(d) {
    qteCleanup();
    S.farm.qte = {
      fish: d.fish, name: d.name, diff: d.diff || 30, green: d.green || 0.35,
      contest: d.contest || null,   // v5.5：赛制状态（counting/total/rods）
      y: 0.5, targetY: 0.28 + Math.random() * 0.44,
      targetVy: (Math.random() - 0.5) * 0.006,
      vy: 0, hold: false, progress: 0.3, hit: 0, frames: 0, timer: null
    };
    var q = S.farm.qte;
    document.addEventListener('keydown', qteDown, false);
    document.addEventListener('keyup', qteUp, false);
    document.addEventListener('mouseup', qteUp, false);
    q.timer = setInterval(function () {
      if (!S.farm.qte || curPanel !== 'mine') { qteCleanup(); return; }
      q.frames++;
      q.targetY += q.targetVy * (1 + q.diff / 75);
      if (q.targetY < 0.12 || q.targetY > 0.88) q.targetVy *= -1;
      q.targetY = qteClamp(q.targetY, 0.12, 0.88);
      q.vy += (q.hold ? 0.0023 : -0.0027);
      q.vy = qteClamp(q.vy, -0.022, 0.022);
      q.y += q.vy;
      if (q.y < 0.03) { q.y = 0.03; q.vy = 0; }
      if (q.y > 0.97) { q.y = 0.97; q.vy = 0; }
      var inZone = Math.abs(q.y - q.targetY) <= q.green / 2;
      if (inZone) { q.progress += 0.007; q.hit++; }
      else q.progress -= 0.005;
      q.progress = qteClamp(q.progress, 0, 1);
      qtePaint();
      if (q.progress >= 1) qteStop(true);
      else if (q.progress <= 0 || q.frames > 520) qteStop(false);
    }, 30);
  }

  function fishBody(body) {
    var P = farmP(); if (!P) return;
    var D = farmD(), q = S.farm.qte;
    var s = farmSection(body, '水边', '按住空格（或按住鼠标）让游标上浮，松开下沉。把鱼留在绿条里，进度满就上钩。');
    if (!q) {
      s.appendChild(el('div', 'sg5-note', '鱼竿等级 ' + ((P.tools || {}).rod || 0) +
        ' · 钓鱼 Lv.' + ((P.levels || {}).fishing || 0) + ' · 今天 ' + P.cal.weather +
        ' · 甩一次竿花 ' + (D.TOOL_ENERGY ? D.TOOL_ENERGY.fish : 8) + ' 体力'));
      farmBtnRow(s, [
        ['甩竿', function () {
          // v5.6 W1：fishBusy 覆盖甩竿 → result 整个周期（在途时再点直接丢弃）
          sg5Gate('fishBusy', document.activeElement, function () {
            return lifeAct('fish/start', {}).then(function (d) {
              if (d && d.fish) { qteStart(d); refreshPanel('mine'); }
              else farmToast('这会儿没鱼咬钩', 'warn');
            }, function (e) { farmToast(e.message, 'warn'); });
          });
        }, 'sg5-btn-primary', null, 'op:cast'],
        ['按 H 收起', function () { closePanel(); }]
      ]);
      // v5.5：冰雪钓赛成绩卡（只在赛日渲染；QTE 进行中不渲染，走 else 分支的赛制行）
      var fc = P.fishContest;
      if (isFishContestDay() && fc) {
        if (fc.day !== P.cal.day) fc = { day: P.cal.day, total: 0, rods: 0, claimed: 0 };
        var card = el('div', 'sg5-fish-score');
        card.appendChild(el('div', 'sg5-farm-big', '当前积分 ' + fc.total + 'g'));
        var prog = el('div', 'sg5-quest-prog');
        var fill = el('i');
        fill.style.transform = 'scaleX(' + Math.min(1, fc.total / 300).toFixed(3) + ')';
        prog.appendChild(fill);
        card.appendChild(prog);
        card.appendChild(el('div', 'sg5-note', '剩余竿数 ' + Math.max(0, 3 - fc.rods) + ' / 3 · 前 3 竿卖价之和 ≥300g 即达标'));
        var chipCls, chipTxt;
        if (fc.claimed) { chipCls = 'sg5-bundle-need is-done'; chipTxt = '已领奖 · 赛绩已结算'; }
        else if (fc.total >= 300) { chipCls = 'sg5-bundle-need is-done'; chipTxt = '已达标 · 可领奖'; }
        else if (fc.rods >= 3) { chipCls = 'sg5-bundle-need is-off'; chipTxt = '未达标（' + fc.total + 'g / 300g）'; }
        else { chipCls = 'sg5-bundle-need is-have'; chipTxt = '计分中'; }
        card.appendChild(el('div', chipCls, chipTxt));
        if (!fc.claimed && fc.total >= 300) {
          card.appendChild(el('div', 'sg5-note', '奖励：金币 800g + 鱼饵 ×20'));
          farmBtnRow(card, [['领取赛奖', function () {
            lifeAct('fish/contest/claim', {}).then(function (d) {
              farmToast('赛奖到手：800 金 + 鱼饵 ×20');
            }, function (e) { farmToast(e.message, 'warn'); });
          }, 'sg5-btn-primary', true]]);
        }
        s.appendChild(card);
      }
      var caught = 0;
      for (var k in (P.fishCaught || {})) if (Object.prototype.hasOwnProperty.call(P.fishCaught, k)) caught += P.fishCaught[k];
      s.appendChild(el('div', 'sg5-note', '已经钓上 ' + caught + ' 条鱼 · 图鉴见隔壁'));
    } else {
      var box = el('div', 'sg5-qte');
      var track = el('div', 'sg5-qte-track');
      track.appendChild(el('div', 'sg5-qte-zone'));
      var fish = el('div', 'sg5-qte-fish', '◆');
      track.appendChild(fish);
      track.appendChild(el('div', 'sg5-qte-cursor'));
      box.appendChild(track);
      var side = el('div', 'sg5-qte-side');
      side.appendChild(el('div', 'sg5-qte-title', '咬钩了！'));
      side.appendChild(el('div', 'sg5-qte-name', '???（钓上来才知道）'));
      side.appendChild(el('div', 'sg5-note', '难度 ' + q.diff + ' · 绿条 ' + Math.round(q.green * 100) + '%'));
      // v5.5：赛制行（fish/start 的 contest 字段驱动；非赛日不渲染）
      if (q.contest) {
        side.appendChild(el('div', 'sg5-note', q.contest.counting
          ? '赛制第 ' + Math.min(3, q.contest.rods + 1) + ' 竿 · 计入成绩'
          : '本竿不计入赛绩（前 3 竿已计满）'));
      }
      var pb = el('div', 'sg5-qte-bar');
      pb.setAttribute('role', 'progressbar');
      pb.setAttribute('aria-valuemin', '0');
      pb.setAttribute('aria-valuemax', '100');
      pb.setAttribute('aria-valuetext', '进度 30%');
      pb.appendChild(el('div', 'sg5-qte-fill'));
      side.appendChild(pb);
      side.appendChild(el('div', 'sg5-note', '按住 = 上浮，松开 = 下沉'));
      box.appendChild(side);
      box.addEventListener('mousedown', qteDown, false);
      box.addEventListener('mouseup', qteUp, false);
      box.addEventListener('touchstart', qteDown, false);
      box.addEventListener('touchend', qteUp, false);
      s.appendChild(box);
    }
    body.appendChild(s);
  }

  // v5.4：矿洞里生效的职业，一眼一条短句
  var MINE_PROF = {
    fighter: '血量 +15%', defender: '血量 +25', scout: '遇怪减半', brute: '承伤 -15%',
    prospector: '煤 ×2', geologist: '宝石成对', pirate: '5% 宝箱', miner: '矿石 +1'
  };
  function mineProfSummary() {
    var P = farmP(); if (!P) return '';
    var profs = P.profs || [], out = [];
    for (var k in MINE_PROF) if (profs.indexOf(k) >= 0) out.push(MINE_PROF[k]);
    return out.length ? '矿洞生效：' + out.join(' · ') : '';
  }

  function mineBody(body) {
    var P = farmP(); if (!P) return;
    var D = farmD(), m = P.mineRun;
    var s = farmSection(body, '矿洞 · 最深 ' + D.MINE_MAX + ' 层',
      '每 5 层有电梯，下次可直接下到那一层。镐子等级越高，一铲子能敲出越多矿石。');
    s.appendChild(el('div', 'sg5-farm-big', m ? '当前第 ' + m.floor + ' 层' : '还没下矿'));
    s.appendChild(el('div', 'sg5-note', '最深到过 ' + (P.mineBest || 0) + ' 层 · 电梯已通到第 ' + (P.elevator || 0) + ' 层 · 体力 ' + P.energy));
    var profLine = mineProfSummary();
    if (profLine) s.appendChild(el('div', 'sg5-farm-profline', profLine));
    if (!m) {
      var btns = [];
      var elev = Math.max(0, P.elevator || 0);
      for (var f = 0; f <= elev; f += 5) {
        (function (floor) { btns.push(['第 ' + floor + ' 层', function () {
          lifeAct('mine/enter', { floor: floor }).then(function () { farmToast('下到第 ' + floor + ' 层'); },
            function (e) { farmToast(e.message, 'warn'); });
        }]); })(Math.max(1, f));
      }
      if (!btns.length) btns.push(['从 1 层开始', function () {
        lifeAct('mine/enter', { floor: 1 }).then(function () { farmToast('下矿了'); },
          function (e) { farmToast(e.message, 'warn'); });
      }]);
      farmBtnRow(s, btns);
    } else {
      s.appendChild(el('div', 'sg5-note', '洞里体力 ' + m.hp + ' · 挖了 ' + m.digs + ' 铲 · ' + (m.stair ? '找到楼梯了' : '还没找到楼梯')));
      farmBtnRow(s, [
        ['挖一铲', function () {
          lifeAct('mine/dig', {}).then(function (d) {
            if (d && d.down) farmToast('被打晕送回镇上，花了 ' + d.loss + 'g', 'warn');
            else if (d && d.got && d.got.length) farmToast('敲出 ' + d.got.length + ' 块矿');
          }, function (e) { farmToast(e.message, 'warn'); });
        }, 'sg5-btn-primary'],
        [m.stair ? '往下一层' : '继续找楼梯', function () {
          lifeAct('mine/stair', {}).then(function (d) {
            farmToast(d.bottom ? '到矿洞最底了' : '下到第 ' + d.mine.floor + ' 层');
          }, function (e) { farmToast(e.message, 'warn'); });
        }],
        ['离开矿洞', function () { lifeAct('mine/leave', {}).then(function () { farmToast('回到地面上了'); }); }]
      ]);
    }
    body.appendChild(s);
    var ore = farmSection(body, '背上的矿石', '铁矿 40 层起、金矿 80 层起、铱矿 110 层起。工具升级要的就是这些。');
    var inv = {};
    for (var k in (P.inv || {})) {
      if (!Object.prototype.hasOwnProperty.call(P.inv, k)) continue;
      var base = String(k).split('_q')[0];
      for (var i = 0; i < (D.ORES || []).length; i++) if (D.ORES[i].id === base) inv[k] = P.inv[k];
    }
    ore.appendChild(farmInvGrid(P, inv, null, function () {}, true));
    body.appendChild(ore);
  }

  function dexBody(body) {
    var P = farmP(); if (!P) return;
    var D = farmD();
    var f = farmSection(body, '鱼类图鉴', '季节、天气、时间都会改变能钓到什么。');
    var l1 = el('div', 'sg5-farm-list');
    (function () {
      for (var i = 0; i < (D.FISH || []).length; i++) {
        (function (fish) {
          var got = (P.fishCaught || {})[fish.id] || 0;
          var row = el('div', 'sg5-farm-row');
          row.appendChild(el('span', 'sg5-farm-rowname' + (got ? '' : ' is-unknown'), got ? fish.name : '？？？'));
          row.appendChild(el('span', 'sg5-farm-rowsub', got ? (fish.sell + 'g · 钓到 ' + got + ' 条 · 难度 ' + fish.diff)
            : (D.SEASONS[fish.s[0]] + ' · 难度 ' + fish.diff)));
          l1.appendChild(row);
        })(D.FISH[i]);
      }
    })();
    f.appendChild(l1); body.appendChild(f);

    var c = farmSection(body, '作物图鉴', '收过一次就会记下来。');
    var l2 = el('div', 'sg5-farm-list');
    (function () {
      for (var k in (D.CROPS || {})) {
        if (!Object.prototype.hasOwnProperty.call(D.CROPS, k)) continue;
        (function (k) {
          var def = D.CROPS[k], got = (P.cropsGrown || {})[k] || 0;
          var row = el('div', 'sg5-farm-row');
          row.appendChild(el('span', 'sg5-farm-rowname' + (got ? '' : ' is-unknown'), got ? def.name : '？？？'));
          row.appendChild(el('span', 'sg5-farm-rowsub', got ? ('收过 ' + got + ' 次 · ' + def.days + '天 · ' + def.sell + 'g')
            : (def.s.length ? D.SEASONS[def.s[0]] + '季' : '温室')));
          l2.appendChild(row);
        })(k);
      }
    })();
    c.appendChild(l2); body.appendChild(c);
  }

  PANELS.mine = function () {
    var P = farmP();
    var sh = panelShell('钓鱼 / 矿洞', P ? ('Lv.' + ((P.levels || {}).fishing || 0) + ' 渔夫 · 第 ' + (P.mineBest || 0) + ' 层') : '正在载入…');
    sh.root.className = 'sg5-panel sg5-panel-wide sg5-panel-farm';
    var errBlock = farmErrBlock();
    if (errBlock) sh.body.appendChild(errBlock);
    mineTabs(sh.body);
    var cont = el('div', 'sg5-farm-cont');
    if (!P) cont.appendChild(el('div', 'sg5-empty', '还没载入…'));
    else if (S.farm.mineTab === 'fish') fishBody(cont);
    else if (S.farm.mineTab === 'mine') mineBody(cont);
    else dexBody(cont);
    sh.body.appendChild(cont);
    return sh.root;
  };

  // v5.4：矿洞宝箱事件（pirate）→ 音效 + toast + 刷新农场状态
  var _handleEventMine = handleEvent;
  handleEvent = function (e) {
    if (e && e.k === 'farm-pirate') {
      farmSfx('secret', 0.5, 0.9);
      farmToast('挖到了矿洞宝箱：' + (e.gold || 0) + ' 金 + 宝石 ×' + (e.gem || 1));
      farmState();
      return true;
    }
    return _handleEventMine(e);
  };

  // QTE 的定时器与按键监听必须随应用卸载一起走，热挂载才不会留下幽灵循环
  var _mountQte = mount;
  mount = function (container, context) {
    _mountQte(container, context);
    if (S.onDestroyAll) S.onDestroyAll.push(function () { qteCleanup(); });
  };


  // ======================== 19_lore.js ========================
// ==================== 19_lore 《灯火纪》世界观与剧情（v5.7） ====================
// 职责：lore 文本下发与缓存、遗物收集交互、lore 阅读卡、灯语仪式卡、栗的独白、终章触发。
// 设计：卡片独立于面板系统（curPanel 单例），叠在世界层上；阅读不打断世界运行。

var loreState = { loaded: false, data: null, wrap: null };
var LORE_NIGHT_ZONE_ORDER = ['town', 'meadow', 'forest', 'swamp', 'crag', 'frost', 'abyss'];
var LORE_NIGHT_ALL = [];   // /v5/lore 下发的夜语元数据（id/坐标/zone，正文只在收集后）

function loreLoad() {
  return apiGet('/shiguang/v5/lore').then(function (d) {
    loreState.data = d || {};
    S.loreCollected = d.collected || [];
    // v5.8 夜语：今晚浮现集 + 已收集（私密，无广播）
    S.loreNightCollected = d.nightCollected || [];
    S.loreNightPick = d.nightPick || [];
    S.keeperAfterLines = d.keeperAfter || [];
    LORE_NIGHT_ALL = d.nights || [];
    loreState.loaded = true;
  }).catch(function () { /* 拉不到不阻塞游戏；图鉴里显示「暂未载入」 */ });
}

// 进世界后拉一次（重连也会刷新，收集进度以服务端为准）
var _applyEnterLore = applyEnter;
applyEnter = function (d) {
  _applyEnterLore(d);
  loreLoad();
  // v5.8：守夜仪式现场恢复（服务端权威，客户端只做显示与举灯动作）
  S.finale = d.finale || { open: 0, done: 0, waiters: 0, meWaiting: 0, roster: null };
  // 终章触发改造（v5.8）：删「goal 归空自动放章节卡」—— 终章由 finale-done 事件触发一次。
  // 若进场时仪式已完成但本场没看过名录，补播一次终幕序列（幂等：本会话只放一遍）。
  try {
    if (S.finale && S.finale.done && !S.finaleCardShown) {
      S.finaleCardShown = 1;
      try { S.storage.set('finale', '1'); } catch (e) {}
      setTimeout(function () { finalePlaySequence(); }, 1200);
    }
  } catch (e) {}
};

// ---------- 世界层遗物：走近按 E ----------
function loreOpenRelic(relic) {
  apiPost('/shiguang/v5/lore/collect', { id: relic.id }).then(function (r) {
    S.loreCollected = r.collected || S.loreCollected;
    var fresh = S.loreCollected.indexOf(relic.id) >= 0;
    var diary = r.diary || {};
    var first = fresh && !loreState._seen;
    loreState._seen = 1;
    loreCard(diary.title || '守塔人遗物', diary.zone ? ZONE_NAMES[diary.zone] || '' : '', diary.text || '', first);
    if (first) {
      toast('收下了「' + (diary.title || '守塔人遗物') + '」—— 图鉴·世界 可重读', 'good');
      auSfx('secret', 0.4, 1.1);
    }
  }).catch(function (e) { toast(e.message || '读完这一页需要一点时间，再试一次', 'warn'); });
}

// ---------- 世界层夜语：夜间同点浮现，走近按 E（phase 门控在 doInteract） ----------
function loreOpenNight(nyx) {
  apiPost('/shiguang/v5/lore/collect', { id: nyx.id, kind: 'night' }).then(function (r) {
    S.loreNightCollected = r.nightCollected || S.loreNightCollected;
    var got = S.loreNightCollected.indexOf(nyx.id) >= 0;
    var n = r.night || {};
    var first = got && !loreState._nightSeen;
    loreState._nightSeen = 1;
    loreCard(n.title || '夜语', '没能等到天亮的人 · 留下的半页话', n.text || '', 'night');
    if (first) {
      toast('夜语已收进图鉴 —— 只有你听见了它', 'good');
      auSfx('secret', 0.35, 0.85);
    }
  }).catch(function (e) { toast(e.message || '夜里的话听不清，再试一次', 'warn'); });
}

// ---------- 终幕序列：finale 灯语 → 终章章节卡 → 灯火名录 → 引导回守灯人之家 ----------
function finalePlaySequence() {
  var d = loreState.data || {};
  loreCard('终章 · 灯火名录', '第一代大守塔人 拾', d.finale || '', 'lamp');
  auSfx('spirit', 0.45, 0.9);
  setTimeout(function () {
    try { showChapter(8); } catch (e) {}
  }, 4200);
  setTimeout(function () {
    if (S.finale && S.finale.roster) loreRosterCard(S.finale.roster);
    toast('去守灯人之家 —— 栗在等你们', 'good');
  }, 9200);
}

// ---------- 灯火名录卡：拾 → 七代守塔人 → 全班（滚入节奏见 v5.8 视觉规范） ----------
function loreRosterCard(roster) {
  var wrap = loreWrap();
  clearNode(wrap);
  var card = el('div', 'sg5-roster');
  card.appendChild(el('div', 'sg5-roster-head', '灯火名录'));
  var first = el('div', 'sg5-roster-first', '拾');
  first.style.animationDelay = '150ms';
  card.appendChild(first);
  var keepers = ['宁 · 晨光草原', '哑叔 · 雾隐林', '阿潮 · 萤火泽', '石翁 · 星坠岩', '孩子们 · 霜屿', '栗 · 拾光镇', '拾 · 长夜之心'];
  for (var i = 0; i < keepers.length; i++) {
    var kr = el('div', 'sg5-roster-keeper', keepers[i]);
    kr.style.animationDelay = (400 + i * 140) + 'ms';
    card.appendChild(kr);
  }
  var sep = el('div', 'sg5-roster-sep');
  sep.style.animationDelay = '1480ms';
  card.appendChild(sep);
  var cls = el('div', 'sg5-roster-class');
  var names = (roster && roster.keepers) || [];
  var later = (roster && roster.later) || [];
  var all = names.concat(later);
  for (var j = 0; j < all.length; j++) {
    var nm = el('span', 'sg5-roster-name', all[j] + (j < all.length - 1 ? ' ·' : ''));
    nm.style.animationDelay = (1600 + Math.min(j * 60, 800)) + 'ms';
    cls.appendChild(nm);
  }
  card.appendChild(cls);
  var note = el('div', 'sg5-roster-note', names.length + ' 人守了这一夜 · ' + later.length + ' 人后来到了');
  card.appendChild(note);
  card.appendChild(uiBtn('合上名册', 'sg5-btn', function () { loreCardClose(); auSfx('accept', 0.35, 1.0); }));
  wrap.appendChild(card);
  wrap.className = 'sg5-lore is-on';
  auSfx('gold', 0.45, 1.0);
}

// ---------- 阅读卡（复用面板框语言，独立于 curPanel） ----------
function loreWrap() {
  if (!loreState.wrap) {
    loreState.wrap = el('div', 'sg5-lore');
    UI.hud.appendChild(loreState.wrap);
    loreState.wrap.addEventListener('click', function (ev) {
      if (ev.target === loreState.wrap) loreCardClose();
    }, false);
  }
  return loreState.wrap;
}

function loreCardClose() {
  if (loreState.wrap) {
    loreState.wrap.className = 'sg5-lore';
    setTimeout(function () {
      if (loreState.wrap && loreState.wrap.className.indexOf('is-on') < 0) clearNode(loreState.wrap);
    }, 260);
  }
}

// kind: 'diary' 日记页（含收下按钮） | 'lamp' 灯语仪式卡（更庄重，自动可关） | 'plain' 栗的独白等
//      | 'night' 夜语残页卡（v5.8：冷底夜卡，容器加 .is-night）
function loreCard(title, sub, text, kind) {
  var wrap = loreWrap();
  clearNode(wrap);
  var card = el('div', 'sg5-lorecard' + (kind === 'lamp' ? ' sg5-lampword' : '') + (kind === 'night' ? ' sg5-nightcard' : ''));
  card.appendChild(el('div', 'sg5-lorecard-title', title || ''));
  if (sub) card.appendChild(el('div', 'sg5-lorecard-sub', sub));
  var body = el('div', 'sg5-lorecard-text', text || '');
  card.appendChild(body);
  if (kind === 'lamp') {
    card.appendChild(el('div', 'sg5-lorecard-note', '这一晚，请和整个班一起记住。'));
    var b1 = uiBtn('记住这一晚', 'sg5-btn-primary', function () { loreCardClose(); auSfx('accept', 0.35, 1.0); });
    card.appendChild(b1);
  } else if (kind === 'night') {
    card.appendChild(el('div', 'sg5-lorecard-note', '—— 夜里的话，只有夜听得见。'));
    card.appendChild(uiBtn('把这一页收好', 'sg5-btn-primary', function () { loreCardClose(); auSfx('secret', 0.4, 0.85); }));
  } else {
    card.appendChild(uiBtn(kind === 'diary' ? '收下这一页' : '合上', 'sg5-btn', function () { loreCardClose(); }));
  }
  wrap.appendChild(card);
  wrap.className = 'sg5-lore is-on' + (kind === 'night' ? ' is-night' : '');
  var firstBtn = card.querySelector('button');
  if (firstBtn) { try { firstBtn.focus(); } catch (e) {} }
}

// ---------- 灯语仪式卡（点亮灯塔的瞬间，全班同时看到） ----------
var _handleEventLore = handleEvent;
handleEvent = function (e) {
  if (e && e.k === 'lampword') {
    var zn = e.n || (ZONE_NAMES[e.z] || '');
    loreCard(e.z === 'finale' ? '终章 · 灯火名录' : zn + ' · 灯语', e.z === 'finale' ? '第一代大守塔人 拾' : '守塔人的最后一句话', e.t, 'lamp');
    auSfx('spirit', 0.45, e.z === 'finale' ? 0.9 : 1.15);
    auSfx('bonus', 0.3, 1.0);
    S.cam.shake = Math.max(S.cam.shake || 0, 2.2);
    return;
  }
  // v5.8 守夜仪式：开场广播 / 完成名录
  if (e && e.k === 'finale-open') {
    S.finale = S.finale || {};
    S.finale.open = 1; S.finale.done = 0;
    toast(e.hint || '到长夜之心的塔下举灯 —— 一起守到天亮', 'warn');
    auSfx('menu', 0.4, 0.9);
    return;
  }
  if (e && e.k === 'finale-done') {
    S.finale = S.finale || {};
    S.finale.done = 1; S.finale.open = 0;
    S.finale.roster = e.roster || S.finale.roster;
    if (!S.finaleCardShown) {
      S.finaleCardShown = 1;
      try { S.storage.set('finale', '1'); } catch (e2) {}
      finalePlaySequence();
    }
    return;
  }
  return _handleEventLore(e);
};

// ---------- 栗的独白（守灯人之家「听她说话」） ----------
// v5.8 keeperAfter（栗的暗线）：at:7 在 abyss 塔亮后、守夜仪式完成前（终章引子）；
// at:8 严格在 S.finale.done 后（仪式→名录→饭桌的收束）。各幂等，未完成仪式永不触发。
function loreKeeperLine() {
  var lit = Object.keys(S.towers || {}).length;
  var after = S.keeperAfterLines || [];
  if (S.finale && S.finale.done && after.length >= 2 && !S.keeperAfter8Seen) {
    S.keeperAfter8Seen = 1;
    try { S.storage.set('ka8', '1'); } catch (e) {}
    return after[1].text;
  }
  if (S.towers && S.towers.abyss && after.length >= 1 && !S.keeperAfter7Seen) {
    S.keeperAfter7Seen = 1;
    try { S.storage.set('ka7', '1'); } catch (e) {}
    return after[0].text;
  }
  var lines = (loreState.data && loreState.data.keeperLines) || [];
  var pick = null;
  for (var i = 0; i < lines.length; i++) if (lines[i].at <= lit) pick = lines[i];
  return pick ? pick.text : '「灯还亮着。去把剩下的点亮 —— 我在这儿等你们回来吃晚饭。」';
}

// ---------- 图鉴「世界」页签渲染（PANELS.dex 调用） ----------
function loreWorldTab(body) {
  var d = loreState.data;
  if (!d) {
    body.appendChild(el('div', 'sg5-empty', '世界还没载入，稍后再来翻一翻。'));
    return;
  }
  var lit = Object.keys(S.towers || {}).length;

  // 编年史：按点灯进度解锁
  body.appendChild(el('div', 'sg5-sect', '编年史'));
  for (var i = 0; i < d.codex.length; i++) {
    var cx = d.codex[i];
    var open = lit >= cx.at;
    var box = el('div', 'sg5-lorew-row' + (open ? ' is-have' : ' is-off'));
    box.appendChild(el('div', 'sg5-lorew-title', open ? cx.title : '？？？（点亮 ' + cx.at + ' 座灯塔后解锁）'));
    if (open) box.appendChild(el('div', 'sg5-lorew-text', cx.text));
    body.appendChild(box);
  }

  // 守塔人日记与夜语：同域上下对照（昼上夜下，翻图鉴就是翻一枚硬币的两面）
  var nightById = {};
  var nightsData = (loreState.data && loreState.data.nights) || [];
  for (var nix = 0; nix < nightsData.length; nix++) nightById[nightsData[nix].id] = nightsData[nix];
  var zoneStat = {};
  for (var dz = 0; dz < d.diaries.length; dz++) {
    var zd = d.diaries[dz].zone;
    zoneStat[zd] = zoneStat[zd] || { day: 0, night: 0, tot: 0, ntot: 0 };
    zoneStat[zd].tot++;
    zoneStat[zd].ntot++;
    if ((S.loreCollected || []).indexOf(d.diaries[dz].id) >= 0) zoneStat[zd].day++;
  }
  for (var nz = 0; nz < LORE_NIGHT_ZONE_ORDER.length; nz++) {
    var zkey = LORE_NIGHT_ZONE_ORDER[nz];
    if (!zoneStat[zkey]) continue;
    var st = zoneStat[zkey];
    var zhead = el('div', 'sg5-lorew-zone', (ZONE_NAMES[zkey] || zkey) + ' · 昼 ' + st.day + '/' + st.tot + ' · 夜 ' + st.night + '/' + st.ntot);
    zhead.setAttribute('data-zone', zkey);
    body.appendChild(zhead);
    for (var di = 0; di < d.diaries.length; di++) {
      var dy = d.diaries[di];
      if (dy.zone !== zkey) continue;
      var got = (S.loreCollected || []).indexOf(dy.id) >= 0;
      var row = el('div', 'sg5-lorew-row' + (got ? ' is-have' : ' is-off'));
      var t1 = el('div', 'sg5-lorew-title');
      t1.appendChild(el('span', 'sg5-face is-day', '昼'));
      t1.appendChild(document.createTextNode(got ? ' ' + dy.title : ' 一页未寻得的日记'));
      row.appendChild(t1);
      if (got) {
        row.appendChild(el('div', 'sg5-lorew-text', dy.text));
      } else {
        row.appendChild(el('div', 'sg5-lorew-text sg5-lorew-hint', '在这片区域的草丛、林间与岩缝里，找一块碑顶发亮的石碑。'));
      }
      body.appendChild(row);
      // 配对夜语（夜下）：未收集只给暗示，正文永不进 DOM（防剧透）
      var pairId = 'y_' + dy.id.slice(2);
      var nq = nightById[pairId];
      var nGot = nq && (S.loreNightCollected || []).indexOf(pairId) >= 0;
      if (nq) {
        var nrow = el('div', 'sg5-lorew-row is-night' + (nGot ? ' is-have' : ' is-off'));
        var t2 = el('div', 'sg5-lorew-title');
        t2.appendChild(el('span', 'sg5-face is-night', '夜'));
        t2.appendChild(document.createTextNode(nGot ? ' ' + nq.title : ' 一页未听过的夜语'));
        nrow.appendChild(t2);
        if (nGot && nq.text) nrow.appendChild(el('div', 'sg5-lorew-text', nq.text));
        else if (!nGot) nrow.appendChild(el('div', 'sg5-lorew-text sg5-lorew-hint', '入夜后，这里还有别的话。'));
        body.appendChild(nrow);
      }
    }
  }
  // 夜语收集计数修正（组头一次性算准；按 data-zone 匹配，不依赖对象键顺序）
  var nCount = {};
  var ncList = S.loreNightCollected || [];
  for (var nc = 0; nc < ncList.length; nc++) nCount[ncList[nc]] = 1;
  var zrows = body.querySelectorAll('.sg5-lorew-zone');
  for (var zr = 0; zr < zrows.length; zr++) {
    var zk2 = zrows[zr].getAttribute('data-zone');
    if (!zk2 || !zoneStat[zk2]) continue;
    var nTot = 0, nGot2 = 0;
    for (var q = 0; q < LORE_NIGHT_ALL.length; q++) {
      if (LORE_NIGHT_ALL[q].zone !== zk2) continue;
      nTot++;
      if (nCount[LORE_NIGHT_ALL[q].id]) nGot2++;
    }
    zoneStat[zk2].ntot = nTot;
    zrows[zr].textContent = (ZONE_NAMES[zk2] || zk2) + ' · 昼 ' + zoneStat[zk2].day + '/' + zoneStat[zk2].tot + ' · 夜 ' + nGot2 + '/' + nTot;
  }

  // 风物志：按点亮进度逐步解锁（塔亮 = 真正「到过」那片地）
  body.appendChild(el('div', 'sg5-sect', '风物志'));
  var gz = d.gazetteer || {};
  Object.keys(gz).forEach(function (zk) {
    var g = gz[zk];
    var open = zk === 'town' || !!S.towers[zk];
    var row = el('div', 'sg5-lorew-row' + (open ? ' is-have' : ' is-off'));
    row.appendChild(el('div', 'sg5-lorew-title', open ? g.title : (ZONE_NAMES[zk] || zk) + ' · 未踏足'));
    if (open) row.appendChild(el('div', 'sg5-lorew-text', g.text));
    body.appendChild(row);
  });

  // 灯火名录（终章后永久呈现 —— 已写进世界的东西不再动）
  if (S.finale && S.finale.done && S.finale.roster) {
    body.appendChild(el('div', 'sg5-sect', '灯火名录'));
    var mini = el('div', 'sg5-roster-mini');
    mini.appendChild(el('div', 'sg5-roster-mini-first', '拾'));
    mini.appendChild(el('div', 'sg5-roster-mini-keepers', '宁 · 哑叔 · 阿潮 · 石翁 · 霜屿的孩子们 · 栗'));
    var all2 = ((S.finale.roster.keepers) || []).concat((S.finale.roster.later) || []);
    mini.appendChild(el('div', 'sg5-roster-mini-class', all2.join(' · ')));
    body.appendChild(mini);
  }
}

  window.ClassIntraMarket.define({ name: NAME, mount: mount, unmount: unmount });
})();
