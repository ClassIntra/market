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
      towers: data.towers, waystones: data.waystones, chests: data.chests, tile: data.tile
    };
    S.chests = {};
    S.waystones = data.waystones;
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

  function drawProp(ctx, p) {
    var sx = w2sX(p.x * TILE + TILE * 0.5), sy = w2sY(p.y * TILE + TILE);
    var z = S.zoom;
    switch (p.k) {
      case T.TREE:
        propShadow(ctx, sx, sy + z * 1.5, 1.7);
        blitSprite(ctx, SPR.tree[(p.s * SPR.tree.length) | 0], sx, sy + z * 2, z);
        break;
      case T.PINE:
        propShadow(ctx, sx, sy + z * 1.5, 1.3);
        blitSprite(ctx, SPR.pine[(p.s * SPR.pine.length) | 0], sx, sy + z * 2, z);
        break;
      case T.DEADTREE:
        propShadow(ctx, sx, sy + z, 1.1);
        blitSprite(ctx, SPR.dead[(p.s * SPR.dead.length) | 0], sx, sy + z, z);
        break;
      case T.ROCK:
        propShadow(ctx, sx, sy + z * 0.6, 1.1);
        blitSprite(ctx, SPR.rock[(p.s * SPR.rock.length) | 0], sx, sy + z, z);
        break;
      case T.CLIFF:
        drawCliff(ctx, sx, sy, p.s);
        break;
      case 'bush':
        blitSprite(ctx, SPR.bush[(p.s * SPR.bush.length) | 0], sx, sy + z * 0.2, z * 0.8);
        break;
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
  // 房子的格子由服务端占位（WALL），外观在这里画 —— 数据是权威，长相是客户端的自由。
  var HOUSE_STYLE = {
    smith: { roof: '#8d4a3a', wall: '#a58a63', sign: '#ffb066', label: '铁匠铺' },
    shop: { roof: '#3f6d8e', wall: '#9c8a68', sign: '#8fd6ff', label: '杂货铺' },
    inn: { roof: '#7a5a8e', wall: '#a8916c', sign: '#e0b6ff', label: '灯火客栈' },
    hall: { roof: '#8e7a3a', wall: '#ad9670', sign: '#ffd98a', label: '守灯人之家' }
  };

  function drawHouse(ctx, h, t) {
    var st = HOUSE_STYLE[h.kind] || HOUSE_STYLE.shop;
    var z = S.zoom;
    var x0 = Math.round(w2sX(h.x * TILE));
    var y0 = Math.round(w2sY(h.y * TILE));
    var w = Math.round(h.w * TILE * z);
    var hh = Math.round(h.h * TILE * z);
    var lit = (S.phase === 'night' || S.phase === 'dusk');

    // 落影
    ctx.fillStyle = 'rgba(0,0,0,0.20)';
    ctx.fillRect(x0 - w * 0.04, y0 + hh * 0.93, w * 1.08, hh * 0.10);

    var rH = hh * 0.46;                       // 屋顶占近一半：这一条决定「像不像房子」
    var wallTop = y0 + rH;
    var wallH = hh - rH;

    // ---- 墙 ----
    ctx.fillStyle = st.wall;
    ctx.fillRect(x0, wallTop, w, wallH);
    // 木板横纹
    ctx.fillStyle = 'rgba(60,44,28,0.10)';
    for (var py2 = 1; py2 < 5; py2++) ctx.fillRect(x0, wallTop + wallH * 0.18 * py2, w, Math.max(1, z * 0.18));
    // 石基（比墙暗）
    ctx.fillStyle = 'rgba(40,32,22,0.30)';
    ctx.fillRect(x0, y0 + hh - wallH * 0.16, w, wallH * 0.16);
    ctx.fillStyle = '#8b7a5f';
    for (var b2 = 0; b2 < w; b2 += z * 4) {
      ctx.fillRect(x0 + b2, y0 + hh - wallH * 0.16, Math.max(1, z * 0.4), wallH * 0.16);
    }
    // 两侧与底部描边
    ctx.fillStyle = 'rgba(30,22,14,0.55)';
    ctx.fillRect(x0, wallTop, Math.max(1, z * 0.5), wallH);
    ctx.fillRect(x0 + w - Math.max(1, z * 0.5), wallTop, Math.max(1, z * 0.5), wallH);
    // 檐下阴影
    var eg = ctx.createLinearGradient(0, wallTop, 0, wallTop + wallH * 0.3);
    eg.addColorStop(0, 'rgba(0,0,0,0.34)');
    eg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = eg;
    ctx.fillRect(x0, wallTop, w, wallH * 0.3);

    // ---- 屋顶 ----
    var rX = x0 - w * 0.07, rW = w * 1.14;
    ctx.fillStyle = st.roof;
    ctx.fillRect(rX, y0, rW, rH);
    // 瓦垄（竖纹）
    ctx.fillStyle = 'rgba(0,0,0,0.13)';
    for (var rx = rX + z * 2; rx < rX + rW; rx += z * 3.2) ctx.fillRect(Math.round(rx), y0 + rH * 0.12, Math.max(1, z * 0.3), rH * 0.78);
    // 脊上受光 / 檐口压暗
    ctx.fillStyle = 'rgba(255,255,255,0.16)';
    ctx.fillRect(rX, y0, rW, Math.max(1, rH * 0.10));
    ctx.fillStyle = 'rgba(0,0,0,0.30)';
    ctx.fillRect(rX, y0 + rH * 0.84, rW, rH * 0.16);
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(rX, y0, rW, Math.max(1, z * 0.4));
    // 屋脊小装饰
    ctx.fillStyle = 'rgba(255,255,255,0.22)';
    ctx.fillRect(x0 - w * 0.03, y0 - z * 0.5, w * 0.06, z * 0.5);

    // ---- 门（凹进去的） ----
    var dw = w * 0.16, dh = wallH * 0.56;
    var dx = x0 + w * 0.42, dy = y0 + hh - dh;
    ctx.fillStyle = 'rgba(20,14,8,0.55)';
    ctx.fillRect(dx - z * 0.5, dy - z * 0.5, dw + z, dh + z * 0.5);
    ctx.fillStyle = '#4e3721';
    ctx.fillRect(dx, dy, dw, dh);
    ctx.fillStyle = '#6f5033';
    ctx.fillRect(dx + dw * 0.08, dy + dh * 0.06, dw * 0.84, dh * 0.88);
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(dx + dw * 0.44, dy + dh * 0.06, Math.max(1, z * 0.2), dh * 0.88);
    ctx.fillStyle = '#e8c87a';
    ctx.fillRect(dx + dw * 0.7, dy + dh * 0.5, Math.max(1, z * 0.3), Math.max(1, z * 0.3));

    // ---- 窗 ----
    var ww = w * 0.12, wh = wallH * 0.26;
    var wins = [[x0 + w * 0.14, y0 + rH + wallH * 0.22], [x0 + w * 0.74, y0 + rH + wallH * 0.22]];
    for (var k = 0; k < wins.length; k++) {
      var wx = wins[k][0], wy = wins[k][1];
      ctx.fillStyle = 'rgba(20,14,8,0.5)';
      ctx.fillRect(wx - z * 0.4, wy - z * 0.4, ww + z * 0.8, wh + z * 0.8);
      ctx.fillStyle = lit ? '#ffd98a' : '#6f97ad';
      ctx.fillRect(wx, wy, ww, wh);
      ctx.fillStyle = 'rgba(255,255,255,0.28)';
      ctx.fillRect(wx, wy, ww, Math.max(1, wh * 0.26));
      ctx.fillStyle = 'rgba(20,14,8,0.65)';
      ctx.fillRect(wx + ww * 0.46, wy, Math.max(1, z * 0.22), wh);
      ctx.fillRect(wx, wy + wh * 0.46, ww, Math.max(1, z * 0.22));
      if (lit) {
        ctx.fillStyle = 'rgba(255,206,120,0.16)';
        ctx.fillRect(wx - ww * 0.5, wy - wh * 0.4, ww * 2, wh * 1.8);
      }
    }

    // ---- 招牌 ----
    ctx.fillStyle = 'rgba(20,14,8,0.45)';
    ctx.fillRect(x0 + w * 0.05 - z * 0.2, y0 + rH + wallH * 0.06 - z * 0.2, w * 0.16 + z * 0.4, Math.max(2, z * 0.8) + z * 0.4);
    ctx.fillStyle = st.sign;
    ctx.fillRect(x0 + w * 0.05, y0 + rH + wallH * 0.06, w * 0.16, Math.max(2, z * 0.8));
  }

  // 广场上的几件小东西：一眼看去「有人住」，而不是一块空地。
  function townProps() {
    var t = S.map.town;
    return [
      { k: 'well', x: t.cx + 3.5, y: t.cy - 1.5 },
      { k: 'crate', x: t.cx - 4.5, y: t.cy + 2.2 },
      { k: 'crate', x: t.cx - 3.6, y: t.cy + 2.6 },
      { k: 'bench', x: t.cx + 1.5, y: t.cy + 4.2 },
      { k: 'banner', x: t.cx - 3.2, y: t.cy + 8.5 },
      { k: 'banner', x: t.cx + 3.2, y: t.cy + 8.5 }
    ];
  }

  function drawTownProp(ctx, p) {
    var u = S.zoom * TILE;   // 一格在屏幕上的像素数
    var sx = w2sX(p.x * TILE), sy = w2sY(p.y * TILE);
    if (p.k === 'well') {
      // 井：石圈 + 水面 + 两根柱子 + 小顶棚 + 吊桶
      var rw = u * 0.62, rh = u * 0.26;
      ctx.fillStyle = 'rgba(0,0,0,0.20)';
      ctx.beginPath();
      ctx.ellipse(sx, sy + u * 0.06, rw * 1.05, rh * 1.0, 0, 0, 6.2832);
      ctx.fill();
      ctx.fillStyle = '#5f574e';
      ctx.beginPath();
      ctx.ellipse(sx, sy - u * 0.10, rw, rh, 0, 0, 6.2832);
      ctx.fill();
      ctx.fillStyle = '#8a8175';
      ctx.beginPath();
      ctx.ellipse(sx, sy - u * 0.18, rw * 0.94, rh * 0.9, 0, 0, 6.2832);
      ctx.fill();
      ctx.fillStyle = '#25333f';
      ctx.beginPath();
      ctx.ellipse(sx, sy - u * 0.18, rw * 0.6, rh * 0.55, 0, 0, 6.2832);
      ctx.fill();
      ctx.fillStyle = 'rgba(140,200,220,0.28)';
      ctx.beginPath();
      ctx.ellipse(sx - rw * 0.18, sy - u * 0.2, rw * 0.2, rh * 0.18, 0, 0, 6.2832);
      ctx.fill();
      // 柱与顶
      ctx.fillStyle = '#5b4130';
      ctx.fillRect(Math.round(sx - rw * 0.92), Math.round(sy - u * 1.05), Math.max(2, u * 0.1), Math.round(u * 0.86));
      ctx.fillRect(Math.round(sx + rw * 0.82), Math.round(sy - u * 1.05), Math.max(2, u * 0.1), Math.round(u * 0.86));
      ctx.fillStyle = '#8d4a3a';
      ctx.beginPath();
      ctx.moveTo(sx - rw * 1.15, sy - u * 1.02);
      ctx.lineTo(sx, sy - u * 1.42);
      ctx.lineTo(sx + rw * 1.15, sy - u * 1.02);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.16)';
      ctx.beginPath();
      ctx.moveTo(sx - rw * 1.05, sy - u * 1.05);
      ctx.lineTo(sx, sy - u * 1.36);
      ctx.lineTo(sx + rw * 0.1, sy - u * 1.05);
      ctx.closePath();
      ctx.fill();
      // 吊桶
      ctx.fillStyle = 'rgba(210,200,170,0.5)';
      ctx.fillRect(Math.round(sx - u * 0.02), Math.round(sy - u * 0.95), 1, Math.round(u * 0.5));
      ctx.fillStyle = '#6f5034';
      ctx.fillRect(Math.round(sx - u * 0.1), Math.round(sy - u * 0.5), Math.round(u * 0.2), Math.round(u * 0.16));
    } else if (p.k === 'crate') {
      ctx.fillStyle = '#7d5c38';
      ctx.fillRect(sx - u * 0.32, sy - u * 0.55, u * 0.64, u * 0.55);
      ctx.fillStyle = '#96703f';
      ctx.fillRect(sx - u * 0.32, sy - u * 0.55, u * 0.64, u * 0.12);
      ctx.fillStyle = 'rgba(60,40,22,0.5)';
      ctx.fillRect(sx - u * 0.32, sy - u * 0.3, u * 0.64, Math.max(1, u * 0.06));
    } else if (p.k === 'bench') {
      ctx.fillStyle = '#6b4d34';
      ctx.fillRect(sx - u * 0.7, sy - u * 0.3, u * 1.4, u * 0.14);
      ctx.fillStyle = '#8a6340';
      ctx.fillRect(sx - u * 0.7, sy - u * 0.42, u * 1.4, u * 0.12);
      ctx.fillStyle = '#5a4130';
      ctx.fillRect(sx - u * 0.6, sy - u * 0.28, u * 0.1, u * 0.28);
      ctx.fillRect(sx + u * 0.5, sy - u * 0.28, u * 0.1, u * 0.28);
    } else if (p.k === 'banner') {
      ctx.fillStyle = '#5a4130';
      ctx.fillRect(sx - u * 0.06, sy - u * 2.2, Math.max(2, u * 0.12), u * 2.2);
      var flap = Math.sin(S.time * 2.2 + p.x) * u * 0.08;
      ctx.fillStyle = '#c9694f';
      ctx.beginPath();
      ctx.moveTo(sx + u * 0.06, sy - u * 2.1);
      ctx.lineTo(sx + u * 0.9 + flap, sy - u * 1.95);
      ctx.lineTo(sx + u * 0.06, sy - u * 1.5);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = 'rgba(255,225,150,0.9)';
      ctx.fillRect(sx + u * 0.2, sy - u * 1.86, u * 0.16, u * 0.16);
    }
  }

  // 区域灯塔：一根真的塔 —— 石基、塔身、三扇窄窗、顶部灯室。
  // 没点亮时是冷灰石 + 紫黑灯室；点亮后整根发亮，光柱冲天。
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
      var r = 5.8;
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
      g.addColorStop(0, 'rgba(0,0,0,1)');
      g.addColorStop(0.42, 'rgba(0,0,0,0.9)');
      g.addColorStop(0.68, 'rgba(0,0,0,0.62)');
      g.addColorStop(0.86, 'rgba(0,0,0,0.26)');
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
      g2.addColorStop(0, 'rgba(255,176,96,' + (0.11 * a * q.warm).toFixed(3) + ')');
      g2.addColorStop(0.6, 'rgba(255,150,70,' + (0.05 * a * q.warm).toFixed(3) + ')');
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
    function setKey(e, down) {
      var k = e.key || '';
      var code = e.keyCode || 0;
      var map = {
        65: 'a', 68: 'd', 87: 'w', 83: 's', 37: 'a', 39: 'd', 38: 'w', 40: 's',
        74: 'j', 75: 'k', 76: 'l', 69: 'e', 32: 'j'
      };
      var name = map[code];
      if (!name) return;
      if (down && keys[name]) return;
      keys[name] = down ? 1 : 0;
      if (down) {
        if (name === 'j') IN.attack = 1;
        if (name === 'k') IN.roll = 1;
        if (name === 'l') IN.skill = 1;
        if (name === 'e') IN.use = 1;
        if (document.activeElement && document.activeElement.tagName === 'INPUT') return;
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
    function touchStart(e) {
      for (var i = 0; i < e.changedTouches.length; i++) {
        var t = e.changedTouches[i];
        if (t.clientX < S.view.w * 0.5 && !IN.joyActive) {
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
    if (me.dead) return;
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
      me.invUntil = t + ROLL_INV_MS;
      me.rollStartedAt = t;
      me.rollCdUntil = t + ROLL_CD * (1 - ((S.stats && S.stats.dodgeCd) || 0) / 100);
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
    me.atkCdUntil = t + ATK_WINDUP + 40;
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
    for (var k = 0; k < hits.length; k++) {
      var mob = hits[k];
      var crit = Math.random() * 100 < (S.stats.crit || 5) || (me.critReady > 0 && k === 0);
      if (k === 0 && me.critReady > 0) me.critReady = 0;
      var dmg = dmgBase * (crit ? 1 + (S.stats.critDmg || 50) / 100 : 1) * (0.9 + Math.random() * 0.2);
      dmg = Math.max(1, Math.round(dmg));
      var kbx = me.act.dx, kby = me.act.dy;
      hitMob(mob, dmg, crit, kbx, kby, me.act.combo === 2);
      S.net.queue.push({ m: mob.id, d: dmg, c: crit ? 1 : 0, kx: Math.round(kbx * 10) / 10, ky: Math.round(kby * 10) / 10, h: me.act.combo === 2 ? 1 : 0 });
    }
    hitstop(crit ? 90 : HITSTOP);
    S.cam.shake = Math.max(S.cam.shake, hits.length > 2 ? 4 : 2.4);
    auSfx(easePick(['hit', 'hit2', 'hit3']), 0.42, 0.95 + Math.random() * 0.2);
  }

  function easePick(a) { return a[(Math.random() * a.length) | 0]; }

  function hitMob(m, dmg, crit, kx, ky, heavy) {
    m.hpVis = Math.max(0, (m.hpVis == null ? m.hp : m.hpVis) - dmg);
    m.flash = 0.12;
    m.kx = (m.kx || 0) + kx * (heavy ? 0.55 : 0.25);
    m.ky = (m.ky || 0) + ky * (heavy ? 0.55 : 0.25);
    m.shakeT = 0.12;
    if (m.hpVis <= 0) m.dying = 0.28;
    S.texts.push({
      x: m.x + (Math.random() - 0.5) * 0.3, y: m.y - (m.boss ? 2.2 : 0.9),
      txt: String(dmg), crit: crit, life: crit ? 0.9 : 0.7, max: crit ? 0.9 : 0.7,
      vy: crit ? -1.5 : -1.1, vx: (Math.random() - 0.5) * 0.5
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
    me.skillCdUntil = t + def.cd;
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
    if (bkind === 'chest') return apiChest(best);
    if (bkind === 'waystone') return apiWaystone(best);
    if (bkind === 'tower') {
      var lit = !!S.towers[findZoneOfTower(best)];
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

  // 七章《灯火纪》：按点亮灯塔的座数推进（全服进度，不是个人）
  var CHAPTERS = [
    { at: 0, title: '第一章 · 长夜从西边来', text: '镇上的灯还亮着。守灯人栗说，西边的草原上有一盏灯灭了 —— 从那天起，史莱姆开始聚成群。' },
    { at: 1, title: '第二章 · 草原的老国王', text: '巨蛙王倒下去的时候，雾退了一点点。原来长夜不是天气，它是活的。' },
    { at: 2, title: '第三章 · 林中的眼睛', text: '雾隐林里挂满了眼睛。天狗说它只是守着林子的边界 —— 守到忘了自己在守什么。' },
    { at: 3, title: '第四章 · 被偷走的萤火', text: '萤火泽的灯全都不见了。金爪把它们吞进肚子里，照亮自己过冬。' },
    { at: 4, title: '第五章 · 战争早就结束了', text: '赤武士还在等一道不会再来的命令。他守的山，已经塌了一半。' },
    { at: 5, title: '第六章 · 冰下的敲击', text: '霜屿的冰下面有东西在敲。它不是要出来，它是要你别再往里走。' },
    { at: 6, title: '第七章 · 所有熄灭的灯', text: '长夜之心里没有怪物，只有一地熄灭的灯。最后一盏，在你手上。' }
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
      // 受击闪红：先画一份红色剪影，再叠正常——比 filter 便宜且兼容
      var ctx = S.ctx;
      ctx.save();
      ctx.globalAlpha = 0.55;
      sprite(name, col, row, dx, dy, w, h);
      ctx.restore();
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
      // 精英：金色描边（用半透明金框代替滤镜）
      ctx.strokeStyle = 'rgba(255,210,110,0.75)';
      ctx.lineWidth = Math.max(1, S.zoom * 0.5);
      ctx.strokeRect(px(dx), px(dy), px(w2), px(h2));
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
      S.ctx.font = 'bold ' + Math.round(6 * (S.zoom / 3)) + 'px system-ui,sans-serif';
      S.ctx.textAlign = 'center';
      S.ctx.fillText('精英 Lv' + lv, x, y - 16 * S.zoom * (m.elite ? 1.22 : 1) - 4);
    }
  }

  function drawPlayer(p, isMe) {
    var x = w2sX(p.x * TILE), y = w2sY(p.y * TILE + TILE * 0.5);
    shadow(x, y + TILE * S.zoom * 0.4, 1.1);
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
    var bob = p.moving ? Math.sin(S.time * 12) * 0.6 : 0;
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
      S.ctx.font = Math.round(6.5 * (S.zoom / 3)) + 'px system-ui,sans-serif';
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
    var ctx = S.ctx;
    for (var i = 0; i < S.shots.length; i++) {
      var s = S.shots[i];
      var x = w2sX(s.rx * TILE), y = w2sY(s.ry * TILE);
      var rr = 3.4 * (S.zoom / 3);
      var g = ctx.createRadialGradient(x, y, 0, x, y, rr * 2.4);
      g.addColorStop(0, 'rgba(255,220,255,0.95)');
      g.addColorStop(0.45, 'rgba(220,120,255,0.55)');
      g.addColorStop(1, 'rgba(180,80,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(x - rr * 2.4, y - rr * 2.4, rr * 4.8, rr * 4.8);
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
      var fs = (tx.crit ? 15 : 11) * (S.zoom / 3) * (0.7 + 0.3 * k3);
      ctx.save();
      ctx.globalAlpha = Math.min(1, k3 * 2);
      ctx.font = 'bold ' + Math.round(fs) + 'px system-ui,-apple-system,sans-serif';
      ctx.textAlign = 'center';
      var sx2 = w2sX(tx.x * TILE), sy2 = w2sY(tx.y * TILE);
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillText(tx.txt, sx2 + 1, sy2 + 1);
      ctx.fillStyle = tx.crit ? '#ffd36a' : '#ffffff';
      ctx.fillText(tx.txt, sx2, sy2);
      if (tx.crit) {
        ctx.font = 'bold ' + Math.round(fs * 0.5) + 'px system-ui,sans-serif';
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
      DRAW.push({ y: (h.y + h.h) * TILE, kind: 'house', ref: h });
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
    drawGround(ctx, vr);
    drawWater(ctx, vr, S.time);
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
    drawFx(dt);
    drawNight(ctx, S.view.w, S.view.h);
    drawAtmosphere(ctx, S.view.w, S.view.h);
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
    drawCharacter(n.look, x, y, 0, false, 0, 1);
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
    ctx.font = 'bold ' + fs + 'px system-ui,sans-serif';
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
        if (m.dying <= 0) { delete S.mobs[ids[i]]; continue; }
      }
      // 完美闪避：怪物的出招在「我无敌」的窗口里落下
      if (m.state === 'act' && m.prevState !== 'act') {
        var me = S.me;
        if (me && !me.down) {
          var d = dist(me.x, me.y, m.rx, m.ry);
          if (d < (m.boss ? 4.2 : 3.0)) {
            if (t < me.invUntil) perfectDodge(t);
            else hurtFlash();
          }
        }
      }
      m.prevState = m.state;
      // 血条追赶
      if (m.hpVis != null && m.hpVis > m.hp) m.hpVis = Math.max(m.hp, m.hpVis - m.maxHp * dt * 1.6);
    }
  }

  function perfectDodge(t) {
    var me = S.me;
    if (me.perfectAt && t - me.perfectAt < 0.6) return;
    me.perfectAt = t;
    me.critReady = 1;
    S.slow = { until: t + 0.42, scale: 0.3 };
    S.cam.shake = Math.max(S.cam.shake, 3);
    S.rings.push({ x: me.x, y: me.y, r: 0, max: 2.4, life: 0.45, max2: 0.45, col: '#bfe8ff' });
    S.texts.push({ x: me.x, y: me.y - 1.4, txt: '完美闪避', crit: 0, life: 0.9, max: 0.9, vy: -1.1, vx: 0, perfect: 1 });
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
  // HUD 全部是 DOM：数字要清晰、要能被 CSS 主题影响，画在 canvas 上就糊了。
  var UI = {};

  function uiBuild(root) {
    var hud = el('div', 'sg5-hud');
    root.appendChild(hud);
    UI.hud = hud;

    // ---- 左上 生命 / 灯火 / 经验 ----
    var status = el('div', 'sg5-status');
    var face = el('div', 'sg5-face');
    var faceCv = document.createElement('canvas');
    faceCv.width = 48; faceCv.height = 48;
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

    // ---- 右上 小地图 + 时钟 ----
    var tr = el('div', 'sg5-topright');
    var mini = document.createElement('div');
    mini.className = 'sg5-mini';
    var miniCv = document.createElement('canvas');
    miniCv.width = 108; miniCv.height = 108;
    miniCv.className = 'sg5-minicv';
    mini.appendChild(miniCv);
    UI.miniCv = miniCv;
    UI.miniCtx = miniCv.getContext('2d');
    tr.appendChild(mini);
    var clock = el('div', 'sg5-clock');
    UI.phaseEl = el('div', 'sg5-phase', '白天');
    UI.clockEl = el('div', 'sg5-ctime', '12:00');
    UI.shardEl = el('div', 'sg5-shards');   // 注意：不要在这里塞初始文字，下面还会 append span
    var shardIcon = svgIcon(ICONS.star, 12);
    shardIcon.setAttribute('class', 'sg5-ic');
    UI.shardEl.insertBefore(shardIcon, UI.shardEl.firstChild);
    var shardTxt = el('span', null, '0');
    UI.shardEl.appendChild(shardTxt);
    UI.shardTxt = shardTxt;
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
    var boss = el('div', 'sg5-boss');
    UI.bossName = el('div', 'sg5-bossname', '');
    var bb = el('div', 'sg5-bossbar');
    UI.bossFill = el('i');
    bb.appendChild(UI.bossFill);
    boss.appendChild(UI.bossName);
    boss.appendChild(bb);
    UI.bossEl = boss;
    hud.appendChild(boss);

    // ---- 摇杆 ----
    var joy = el('div', 'sg5-joy');
    var knob = el('div', 'sg5-knob');
    joy.appendChild(knob);
    hud.appendChild(joy);
    UI.joy = joy;

    // ---- 动作按钮 ----
    var acts = el('div', 'sg5-actions');
    UI.btnAtk = actionBtn(acts, 'attack', ICONS.sword, '攻击', 'J');
    UI.btnRoll = actionBtn(acts, 'roll', ICONS.roll, '翻滚', 'K');
    UI.btnSkill = actionBtn(acts, 'skill', ICONS.spark, '技能', 'L');
    UI.btnUse = actionBtn(acts, 'use', ICONS.hand, '交互', 'E');
    hud.appendChild(acts);

    // ---- 侧边功能 ----
    var dock = el('div', 'sg5-dock');
    dockBtn(dock, 'char', ICONS.user, '角色', 'C');
    dockBtn(dock, 'bag', ICONS.bag, '背包', 'B');
    dockBtn(dock, 'map', ICONS.map, '地图', 'M');
    dockBtn(dock, 'dex', ICONS.book, '图鉴', 'V');
    dockBtn(dock, 'talent', ICONS.star, '天赋', 'T');
    dockBtn(dock, 'help', ICONS.gear, '设置', 'Esc');
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

    // ---- 死亡遮罩 ----
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

  function actionBtn(parent, name, icon, label, key) {
    var b = el('button', 'sg5-act sg5-act-' + name);
    b.type = 'button';
    b.setAttribute('data-act', name);
    var svg = svgIcon(icon, 24);
    svg.setAttribute('class', 'sg5-actic');
    b.appendChild(svg);
    b.appendChild(el('span', 'sg5-actkey', key));
    b.setAttribute('aria-label', label);
    parent.appendChild(b);
    return b;
  }

  function dockBtn(parent, name, icon, label, key) {
    var b = el('button', 'sg5-dockbtn');
    b.type = 'button';
    b.setAttribute('data-panel', name);
    var svg = svgIcon(icon, 17);
    svg.setAttribute('class', 'sg5-dockic');
    b.appendChild(svg);
    b.appendChild(el('span', 'sg5-docklabel', label));
    b.setAttribute('title', label + '（' + key + '）');
    parent.appendChild(b);
    return b;
  }

  // 按钮按住就连续触发（普攻连段靠这个）
  function bindButtons(acts, dock) {
    var downAt = {};
    function press(name, e) {
      if (name === 'attack') { IN.attack = 1; }
      else if (name === 'roll') { IN.roll = 1; }
      else if (name === 'skill') { IN.skill = 1; }
      else if (name === 'use') { IN.use = 1; }
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
    UI.hpBar.fill.style.width = (hpF * 100).toFixed(1) + '%';
    UI.mpBar.fill.style.width = (mpF * 100).toFixed(1) + '%';
    UI.xpBar.fill.style.width = (xpF * 100).toFixed(1) + '%';
    setText(UI.hpBar.txt, Math.round(me.hp) + ' / ' + Math.round(me.maxHp));
    setText(UI.lvEl, 'Lv.' + (me.lv || 1));
    setText(UI.nameEl, me.name || '旅人');
    setText(UI.shardTxt, fmt(me.shards));

    // 时钟：游戏内一天 12 分钟，映射到 24 小时
    var hh = Math.floor(S.pf * 24), mm = Math.floor((S.pf * 24 - hh) * 60);
    setText(UI.clockEl, pad2(hh) + ':' + pad2(mm));
    var pname = { day: '白天', dusk: '黄昏', night: '长夜', dawn: '黎明' }[S.phase] || '白天';
    setText(UI.phaseEl, pname);
    UI.phaseEl.className = 'sg5-phase sg5-phase-' + S.phase;
    UI.zoneEl.className = 'sg5-zone sg5-z-' + S.zone;
  }

  function pad2(n) { return n < 10 ? '0' + n : String(n); }

  // ---- toast ----
  var toastTimer = 0;
  function toast(text, kind) {
    if (!text || !UI.toastEl) return;
    UI.toastEl.textContent = text;
    UI.toastEl.className = 'sg5-toast is-on' + (kind ? ' sg5-toast-' + kind : '');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      UI.toastEl.className = 'sg5-toast';
    }, 1900);
  }

  // ---- 世界频道（点灯 / 首杀 / 传说） ----
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
      var row = el('div', 'sg5-feedrow' + (f.kind ? ' sg5-feed-' + f.kind : ''), f.text);
      UI.feedEl.appendChild(row);
    }
  }

  // ---- 区域名横幅 ----
  function showZone(name) {
    if (!UI.zoneEl) return;
    UI.zoneEl.textContent = name;
    UI.zoneEl.className = 'sg5-zone is-in sg5-z-' + S.zone;
    setTimeout(function () {
      if (UI.zoneEl) UI.zoneEl.className = 'sg5-zone sg5-z-' + S.zone;
    }, 2600);
  }

  // ---- 目标指引 ----
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

  // ---- 章节卡 ----
  function showChapter(idx) {
    var c = CHAPTERS[idx];
    if (!c || !UI.chEl) return;
    UI.chTitle.textContent = c.title;
    UI.chText.textContent = c.text;
    UI.chEl.className = 'sg5-chapter is-on';
    auSfx('success', 0.5, 1);
    setTimeout(function () {
      UI.chEl.className = 'sg5-chapter';
    }, 5200);
  }

  // ---- 头像（从图集里裁一张脸） ----
  function drawFace(look) {
    var f = FR['face_' + look] || FR['face_NinjaBlue'];
    if (!f || !UI.faceCv) return;
    var g = UI.faceCv.getContext('2d');
    g.imageSmoothingEnabled = false;
    g.clearRect(0, 0, 48, 48);
    g.drawImage(S.atlas, f[0], f[1], f[4], f[5], 0, 0, 48, 48);
  }

  // ---- 小地图每帧 ----
  function uiMini() {
    if (!UI.miniCtx || !MINI.base || !S.me) return;
    drawMiniMap(UI.miniCtx, 0, 0, 108, 26);
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

  function iconCanvas(name, size) {
    var cv = document.createElement('canvas');
    cv.width = size; cv.height = size;
    var g = cv.getContext('2d');
    var f = FR[name];
    g.imageSmoothingEnabled = false;
    if (f) {
      var s = Math.min(size / f[4], size / f[5]);
      var w = f[4] * s, h = f[5] * s;
      g.drawImage(S.atlas, f[0], f[1], f[4], f[5], (size - w) / 2, (size - h) / 2, w, h);
    }
    return cv;
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
    clearNode(UI.panelWrap);
    var p = build();
    if (p) UI.panelWrap.appendChild(p);
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
        var nm = it.slot === 'weapon' ? (it.kind === 'staff' ? 'wp_MagicWand' : (it.kind === 'lance' ? 'wp_Lance' : 'wp_Sword')) : 'obj_ScrollEmpty';
        ic.appendChild(iconCanvas(nm, 30));
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
    [['攻击', (st.atk || 0).toFixed ? st.atk.toFixed(1) : st.atk], ['生命', me.maxHp], ['暴击率', (st.crit || 0) + '%'],
      ['暴击伤害', '+' + (st.critDmg || 0) + '%'], ['吸血', (st.leech || 0).toFixed(1) + '%'],
      ['灯火回复', '+' + Math.round(st.mpGain || 0) + '%'], ['移速', '+' + Math.round(st.speed || 0) + '%'],
      ['技能伤害', '+' + Math.round(st.skill || 0) + '%']].forEach(function (pair) {
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
    body.appendChild(el('div', 'sg5-note', '装备与天赋在背包 / 天赋面板里调整。'));
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
    var sh = panelShell('背包', bag.length + ' / 60');
    var body = sh.body;
    if (!bag.length) {
      body.appendChild(el('div', 'sg5-empty', '背包是空的。去打点东西，或者开个箱子。'));
    }
    var list = el('div', 'sg5-list');
    bag.forEach(function (it) {
      var row = el('div', 'sg5-item');
      var ic = el('div', 'sg5-item-ic');
      var nm = it.slot === 'weapon' ? (it.kind === 'staff' ? 'wp_MagicWand' : (it.kind === 'lance' ? 'wp_Lance' : 'wp_Sword')) : 'obj_ScrollEmpty';
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
  PANELS.talent = function () {
    var me = S.me;
    var lines = {
      blade: { name: '剑', color: '#ff8a6a', tiers: ['锋利 +8% 攻击', '连斩 收招 +25%', '破甲 对精英 +15%', '嗜血 吸血 +3%', '剑舞 每 5 次普攻自动回旋'] },
      shadow: { name: '影', color: '#9a8aff', tiers: ['轻身 移速 +6%', '残影 翻滚冷却 -20%', '致命 暴击 +8%', '见切 完美闪避窗口 +60%', '影袭 完美闪避后瞬移背刺'] },
      lamp: { name: '灯', color: '#ffd36a', tiers: ['暖光 生命 +12%', '添油 灯火回复 +30%', '照夜 夜视 +50%', '共明 队友攻击 +10%', '不灭 致命伤保留 1 点生命'] }
    };
    var left = me.talentLeft || 0;
    var sh = panelShell('天赋', '可用点数 ' + left + '（每 3 级 1 点）');
    var body = sh.body;
    Object.keys(lines).forEach(function (key) {
      var L = lines[key];
      var box = el('div', 'sg5-tline');
      var head = el('div', 'sg5-tline-head', L.name + ' 之线');
      head.style.color = L.color;
      box.appendChild(head);
      var have = (me.talents || {})[key] || 0;
      L.tiers.forEach(function (txt, i) {
        var on = i < have;
        var node = el('div', 'sg5-tnode' + (on ? ' is-on' : ''));
        node.appendChild(el('span', 'sg5-tdot', String(i + 1)));
        node.appendChild(el('span', 'sg5-ttxt', txt));
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
    var sh = panelShell('图鉴', '击杀 ' + Object.keys(dex).length + ' 种怪物');
    var body = sh.body;
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
    body.appendChild(grid);

    body.appendChild(el('div', 'sg5-sect', '灯塔（全服进度）'));
    var tg = el('div', 'sg5-towers');
    ZONE_ORDER.forEach(function (z) {
      var lit = !!S.towers[z];
      var row = el('div', 'sg5-trow' + (lit ? ' is-lit' : ''));
      row.appendChild(el('span', 'sg5-tname', ZONE_NAMES[z]));
      row.appendChild(el('span', 'sg5-tstate', lit ? '已点亮' : '长夜笼罩'));
      tg.appendChild(row);
    });
    body.appendChild(tg);

    body.appendChild(el('div', 'sg5-sect', '宝箱'));
    var total = (S.map.chests || []).length;
    var got = Object.keys(S.chests).length;
    body.appendChild(el('div', 'sg5-note', '已开启 ' + got + ' / ' + total + ' 个宝箱（个人进度）'));
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

  // ---------- 商店 ----------
  PANELS.shop = function () {
    var me = S.me;
    var sh = panelShell('杂货铺', '星屑 ' + fmt(me.shards));
    var body = sh.body;
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
    if (npc.action === 'forge') body.appendChild(uiBtn(npc.actionText, '', function () { openPanel('forge'); }));
    if (npc.action === 'shop') body.appendChild(uiBtn(npc.actionText, '', function () { openPanel('shop'); }));
    if (npc.action === 'rest') body.appendChild(uiBtn(npc.actionText, '', function () { apiRest(); }));
    if (npc.action === 'story') body.appendChild(uiBtn(npc.actionText, '', function () { storyTalk(); }));
    UI.panelWrap.appendChild(sh.root);
    UI.panelWrap.className = 'sg5-panels is-on';
  }

  function storyTalk() {
    var lit = Object.keys(S.towers).length;
    var idx = Math.min(CHAPTERS.length - 1, lit);
    showChapter(idx);
    closePanel();
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
      '角色 C　·　背包 B　·　地图 M　·　图鉴 V　·　天赋 T　·　关闭面板 Esc\n' +
      '翻滚的前 0.22 秒无敌。在怪物出招前 0.15 秒内翻滚 = 完美闪避（子弹时间 + 下一击必暴击）。'));
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
    if (cached && cached.version === 5 && cached.cells && cached.size === 256) {
      return Promise.resolve(cached);
    }
    return apiGet('/shiguang/v5/terrain').then(function (data) {
      try { S.storage.set('terr5', data); } catch (e) {}
      return data;
    });
  }

  function applyEnter(d) {
    var me = makeMe(d.me);
    S.myId = d.me.id;
    S.zone = d.me.zone || 'town';
    S.stats = d.me.stats || {};
    S.chests = {};
    for (var i = 0; i < (d.chests || []).length; i++) S.chests[d.chests[i]] = 1;
    S.towers = d.towers || {};
    S.waystones = d.me.waystones || ['ws_town'];
    S.goal = d.goal;
    S.phase = d.phase ? d.phase.name : 'day';
    S.pf = d.phase ? d.phase.f : 0;
    S.feed = (d.feed || []).map(function (f) { return { text: f.text, kind: f.kind }; });
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
        NPCS[k].x = h.x + h.w / 2;
        NPCS[k].y = h.y + h.h + 0.7;
      }
    }
    applyPlayers(d.players || []);
    renderFeed();
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

    var done = function () { S.net.syncing = 0; };
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
      S.net.errs = 0;
      applySync(d);
      done();
    }, function (err) {
      S.net.errs++;
      done();
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
      S.phase = d.ph || S.phase;
      S.pf = d.pf != null ? d.pf : S.pf;
    }
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
    switch (e.k) {
      case 'zone':
        S.zone = e.z;
        showZone(e.n);
        auMusic(e.z === 'town' ? 'town' : e.z);
        break;
      case 'loot':
        if (e.s) {
          S.texts.push({ x: S.me.x, y: S.me.y - 1.2, txt: '+' + e.s, crit: 0, life: 1.0, max: 1.0, vy: -0.9, vx: 0.2, gold: 1 });
          auSfx('coin', 0.3, 1.1);
        }
        if (e.it) {
          toast('获得 ' + rarityName(e.it.rarity) + '「' + e.it.name + '」', 'good');
          auSfx(e.it.rarity >= 3 ? 'gold' : 'bonus', 0.45, 1);
        }
        if (e.f) toast('背包满了 —— 去镇上卖掉一些吧', 'warn');
        if (e.m && e.m.length) {
          for (var i = 0; i < e.m.length; i++) {
            S.texts.push({ x: S.me.x, y: S.me.y - 1.6, txt: '材料 +' + e.m[i][1], crit: 0, life: 0.9, max: 0.9, vy: -0.8, vx: -0.2, small: 1 });
          }
        }
        break;
      case 'lvup':
        toast('升级！ Lv.' + e.lv, 'good');
        auSfx('levelup', 0.5, 1);
        S.rings.push({ x: S.me.x, y: S.me.y, r: 0, max: 3.2, life: 0.7, max2: 0.7, col: '#ffe6a8' });
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
    }
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
    UI.bossFill.style.width = (f * 100).toFixed(1) + '%';
  }
  var auBossPlaying = 0;

  function showDead(on) {
    if (!UI.deadEl) return;
    UI.deadEl.className = 'sg5-dead' + (on ? ' is-on' : '');
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
    S.onDestroyAll.push(off1, off2);
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

  function apiBuy(id, n) {
    apiPost('/shiguang/v5/shop', { id: id, n: n }).then(function (d) {
      S.me.shards = d.shards;
      S.me.mats = d.mats;
      toast('买好了');
      auSfx('coin', 0.35, 1.15);
      refreshPanel('shop');
    }, function (err) { toast(err.message || '买不了', 'warn'); });
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

  function apiSell(uids) {
    apiPost('/shiguang/v5/sell', { uids: uids }).then(function (d) {
      S.me.bag = d.bag;
      S.me.shards = d.shards;
      toast('卖了 ' + d.gain + ' 星屑');
      auSfx('coin', 0.3, 1);
      refreshPanel('bag');
    }, function (err) { toast(err.message || '卖不了', 'warn'); });
  }

  function apiForge(slot) {
    apiPost('/shiguang/v5/forge', { slot: slot, mat: 'ore' }).then(function (d) {
      S.me.equip = d.equip;
      S.me.shards = d.shards;
      S.me.mats = d.mats;
      S.stats = (function () { return S.stats; })();
      toast('重铸完成：' + d.item.name);
      auSfx('magic', 0.5, 0.9);
      refreshPanel('forge');
    }, function (err) { toast(err.message || '打不了', 'warn'); });
  }

  function apiTalent(line) {
    apiPost('/shiguang/v5/talent', { line: line }).then(function (d) {
      S.me.talents = d.talents;
      S.me.talentLeft = d.left;
      S.stats = d.stats || S.stats;
      S.me.maxHp = d.maxHp;
      toast('点亮：' + d.tier.name);
      auSfx('levelup', 0.4, 1.2);
      refreshPanel('talent');
    }, function (err) { toast(err.message || '点不了', 'warn'); });
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

  function loop(ts) {
    raf = window.requestAnimationFrame(loop);
    var t = ts / 1000;
    if (!lastT) lastT = t;
    var dt = Math.min(0.05, t - lastT);
    lastT = t;
    if (dt <= 0) return;
    S.time += dt;

    if (!document.hidden && S.ready && !S.paused) {
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
        ambient(ds);
      }
      camUpdate(dt);
      renderWorld(freeze ? 0 : dt);
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
    }
  }

  // 环境粒子：每个区域有自己的「空气」
  function ambient(dt) {
    var z = S.zone;
    if (Math.random() > dt * 8) return;
    var me = S.me;
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
        S.ready = true;
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
    try {
      window.__sg5 = {
        state: S,
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
        toast: toast,
        // 调试用：锁住昼夜（截图/回归时不想等到夜里）
        lockPhase: function (phase, pf) { S.pfLock = !!phase; if (phase) { S.phase = phase; S.pf = pf == null ? 0.3 : pf; } }
      };
    } catch (e) {}
  }

  function unmount(container) {
    if (!container) return;
    while (container.firstChild) container.removeChild(container.firstChild);
    try { if (window.__sg5) delete window.__sg5; } catch (e) {}
  }

  window.ClassIntraMarket.define({ name: NAME, mount: mount, unmount: unmount });
})();
