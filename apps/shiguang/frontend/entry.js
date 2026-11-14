/* 拾光群岛 —— 市场应用入口（v3 · 云海拾光 · 大世界）
 *
 * 运行约束（市场应用不走 Vite 构建，直接下发浏览器执行）：
 *   - 全 ES5：var / function / 单引号；不用箭头函数、模板串、?.、??、class、async
 *   - 不用 Element.replaceChildren()（Chrome 86+），校园平板基线是 Chrome 80
 *   - 不用 CSS gap / backdrop-filter 作为布局前提（84+），降级要能看
 *   - 一切订阅 / 计时器 / 监听都登记到 context.app.onDestroy
 *
 * v4.6 = 240×240 开放大世界（八岛 ×1.5）+ Kenney 像素素材层（CC0）+ Unifont EX 画布像素字：
 *   八座生态岛屿（草地/雾林/星岩/沙滩/沼泽/花谷/珊瑚/霜屿）、石板路网、
 *   地标（灯塔旋转光束/星陨坑/巨树/萤光环/贝壳拱门/望潮池/风车/霜岩）、
 *   NPC 行者（游荡 + 台词）、五座石碑（全班唤醒 → 秘境）、纸鸢快线跨岛飞行、
 *   逐岛钓星特产、灯柱带建造者灯色（星座化）、海面动画/鲸影/飞鸟、世界地图。
 * 渲染仍是单张 Canvas 2D：底图（一次 drawImage）→ 海面动画 → 道具与地标
 * （Kenney 瓦片 + 矢量）→ 雾（一次 drawImage）→ 实体与光效。
 *
 * 目录（按出现顺序）：
 *   §1  工具与常量          §2  状态与素材         §3  图标库（内联 SVG）
 *   §4  音频引擎（程序合成）  §5  DOM 构建           §6  底图 / 雾 / 道具与地标
 *   §7  渲染主循环与氛围      §8  小地图与世界地图    §9  输入与玩法动作
 *   §10 面板                §11 同步与生命周期
 */
(function() {
  var NAME = 'shiguang';

  // 地形编码：必须与 backend/world.js 的 TILE 常量一致
  var T_CLOUD = 0;
  var T_MEADOW = 1;
  var T_SAND = 2;
  var T_STONE = 3;
  var T_DOCK = 4;   // 码头木栈道（可走、可钓星）
  var T_PATH = 5;   // 石板路（可走、可种花）
  var T_LAKE = 6;   // 岛内静水（不可走、不可点灯）

  var MOVE_INTERVAL = 170;   // 本地连走的节奏（服务端下限 80ms，留足网络抖动余量）
  var MOVE_GAP = 126;
  var LERP_MS = 140;         // 其他玩家的位移补间时长

  // 提灯配色（与 backend SHOP.lantern 的 id 对应）：受光色 / 光晕色
  var LANTERN_COLORS = {
    '0': { core: '255, 244, 212', glow: '255, 218, 152' },
    '1': { core: '240, 248, 255', glow: '206, 228, 255' },
    '2': { core: '232, 255, 244', glow: '152, 240, 206' },
    '3': { core: '255, 238, 242', glow: '255, 176, 196' },
    '4': { core: '244, 238, 255', glow: '202, 176, 255' }
  };

  // 角色外观：肤色 / 发色 / 发型按玩家 id 确定性生成 —— 每人一套，换设备不变。
  var SKIN_TONES = [
    { base: '#ffd9b8', shade: '#eebd97' },
    { base: '#f5c8a0', shade: '#e0ac7f' },
    { base: '#e2ac78', shade: '#cb9260' },
    { base: '#c68d5c', shade: '#ad7446' }
  ];
  var SEASONS = ['春', '夏', '秋', '冬'];

  var HAIR_COLORS = [
    { base: '#463529', shade: '#2e2118' },
    { base: '#7a5230', shade: '#5c3a1e' },
    { base: '#c99a4a', shade: '#a67c32' },
    { base: '#96453a', shade: '#75312a' },
    { base: '#555a70', shade: '#3d4152' }
  ];

  // 光花品种（species 索引对应 backend FLOWER_SPECIES）
  // 12 种作物 → 12 套配色。一档青蓝、二档暖橙、三档紫金，
  // 这样远远看一眼田里花的颜色，就知道那人种的是快钱还是长线。
  var FLOWER_COLORS = [
    // 一档：青蓝系（快）
    { petal: 'rgba(120, 196, 255, 0.95)', deep: 'rgba(48, 108, 190, 0.9)', core: 'rgba(214, 240, 255, 1)', glow: '110, 190, 255' },
    { petal: 'rgba(146, 226, 214, 0.95)', deep: 'rgba(40, 140, 130, 0.9)', core: 'rgba(226, 255, 250, 1)', glow: '120, 224, 208' },
    { petal: 'rgba(178, 214, 246, 0.95)', deep: 'rgba(70, 118, 176, 0.9)', core: 'rgba(238, 248, 255, 1)', glow: '150, 200, 246' },
    { petal: 'rgba(206, 236, 226, 0.95)', deep: 'rgba(84, 150, 132, 0.9)', core: 'rgba(246, 255, 250, 1)', glow: '176, 232, 214' },
    // 二档：暖橙粉系（中）
    { petal: 'rgba(255, 178, 102, 0.95)', deep: 'rgba(190, 96, 40, 0.9)', core: 'rgba(255, 236, 190, 1)', glow: '255, 176, 92' },
    { petal: 'rgba(255, 204, 140, 0.95)', deep: 'rgba(202, 126, 48, 0.9)', core: 'rgba(255, 244, 214, 1)', glow: '255, 202, 132' },
    { petal: 'rgba(255, 160, 158, 0.95)', deep: 'rgba(190, 70, 78, 0.9)', core: 'rgba(255, 226, 222, 1)', glow: '255, 150, 150' },
    { petal: 'rgba(246, 190, 216, 0.95)', deep: 'rgba(178, 92, 140, 0.9)', core: 'rgba(255, 234, 246, 1)', glow: '240, 176, 210' },
    // 三档：紫金系（慢）
    { petal: 'rgba(190, 150, 255, 0.95)', deep: 'rgba(104, 62, 190, 0.9)', core: 'rgba(240, 224, 255, 1)', glow: '178, 136, 255' },
    { petal: 'rgba(232, 212, 138, 0.95)', deep: 'rgba(166, 132, 44, 0.9)', core: 'rgba(255, 250, 224, 1)', glow: '238, 216, 140' },
    { petal: 'rgba(255, 236, 176, 0.95)', deep: 'rgba(186, 146, 52, 0.9)', core: 'rgba(255, 253, 236, 1)', glow: '255, 236, 170' },
    { petal: 'rgba(240, 246, 252, 0.96)', deep: 'rgba(148, 160, 184, 0.92)', core: 'rgba(255, 255, 255, 1)', glow: '214, 230, 255' }
  ];

  // 天光阶段的全屏染色：夜 → 晨 → 月 → 星 → 海
  var STAGE_TINTS = [
    { top: 'rgba(10, 16, 32, 0.10)', bot: 'rgba(4, 8, 18, 0.16)' },
    { top: 'rgba(70, 90, 150, 0.07)', bot: 'rgba(24, 40, 72, 0.13)' },
    { top: 'rgba(110, 150, 210, 0.08)', bot: 'rgba(30, 56, 96, 0.12)' },
    { top: 'rgba(150, 140, 220, 0.09)', bot: 'rgba(40, 48, 110, 0.12)' },
    { top: 'rgba(255, 190, 130, 0.10)', bot: 'rgba(90, 120, 190, 0.12)' }
  ];

  // ---------------- §1 工具 ----------------

  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  function clearNode(node) {
    if (!node) return;
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  function hash2(x, y, seed) {
    var h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(seed | 0, 362437)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h = h ^ (h >>> 16);
    return (h >>> 0) / 4294967296;
  }

  function hashText(s) {
    var h = 2166136261;
    var str = String(s);
    for (var i = 0; i < str.length; i++) {
      h = h ^ str.charCodeAt(i);
      h = (h * 16777619) >>> 0;
    }
    return h >>> 0;
  }

  // 居民的色谱：旧铜 / 夜蓝 / 水青 / 苔绿 —— 一律比同学低饱和一档。
  // 这样一眼能分出「岛上的居民」和「同班的同学」，又不用换画风。
  var NPC_TONE = {
    npc_li: 'hsl(28, 26%, 56%)',
    npc_yao: 'hsl(258, 24%, 60%)',
    npc_lu: 'hsl(190, 22%, 52%)',
    npc_lang: 'hsl(96, 20%, 52%)'
  };

  function playerColor(id) {
    if (NPC_TONE[id]) return NPC_TONE[id];
    var hue = hashText(id) % 360;
    return 'hsl(' + hue + ', 44%, 56%)';
  }

  function dirFrom(dx, dy) {
    if (dy > 0) return 0;
    if (dx < 0) return 1;
    if (dx > 0) return 2;
    return 3;
  }

  function roundRectPath(c, x, y, w, h, r) {
    var rr = Math.min(r, w / 2, h / 2);
    c.beginPath();
    c.moveTo(x + rr, y);
    c.lineTo(x + w - rr, y);
    c.quadraticCurveTo(x + w, y, x + w, y + rr);
    c.lineTo(x + w, y + h - rr);
    c.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
    c.lineTo(x + rr, y + h);
    c.quadraticCurveTo(x, y + h, x, y + h - rr);
    c.lineTo(x, y + rr);
    c.quadraticCurveTo(x, y, x + rr, y);
    c.closePath();
  }

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function sstep(e0, e1, x) {
    var t = (x - e0) / (e1 - e0);
    if (t < 0) t = 0; else if (t > 1) t = 1;
    return t * t * (3 - 2 * t);
  }

  function vnoise(wx, wy, scale, seed) {
    var ix = Math.floor(wx / scale);
    var iy = Math.floor(wy / scale);
    var fx = wx / scale - ix;
    var fy = wy / scale - iy;
    fx = fx * fx * (3 - 2 * fx);
    fy = fy * fy * (3 - 2 * fy);
    var a = hash2(ix, iy, seed);
    var b = hash2(ix + 1, iy, seed);
    var c = hash2(ix, iy + 1, seed);
    var d = hash2(ix + 1, iy + 1, seed);
    var top = a + (b - a) * fx;
    var bot = c + (d - c) * fx;
    return top + (bot - top) * fy;
  }

  function rgbStr(c) {
    return 'rgb(' + (c[0] | 0) + ',' + (c[1] | 0) + ',' + (c[2] | 0) + ')';
  }

  // ---------------- §2 状态与素材 ----------------

  // 生态调色：每种 biome 一套「草地/岩地/路」的受光/阴影双色。
  // 岛屿性格靠这个拉开 —— 雾隐偏青、星坠偏蓝、萤火泽墨绿、织花谷暖绿、霜屿泛白。
  // 生态调色板。
  //
  // ⚠️ 配色只有一条铁律：**全画面只允许暖色属于光**。
  //
  // 上一版 sand 通道借用 pathLit [148,134,116]（暖米色），而沙环占陆地 27%
  // —— 于是画面上面积最大的暖色是「没人点亮的沙子」，灯反而比不过它，
  // 整屏读起来是「发灰发白的沙滩地图」。现在沙滩压成冷褐，
  // 暖色只准出现在三个地方：灯火、窗口、星屑。
  //
  // lit = 受光面，shd = 背光面，light 在两者之间插值。
  // 四组通道各管一件事：lit/shd 草地，stLit/stShd 岩层，
  // sandLit/sandShd 沙地，pathLit/pathShd 土径。
  var BIOME_PALETTES = {
    meadow: { lit: [40, 66, 60],   shd: [10, 23, 26],    stLit: [80, 90, 106],   stShd: [26, 30, 40],
              sandLit: [74, 68, 56],   sandShd: [34, 31, 27],   pathLit: [106, 90, 70], pathShd: [42, 34, 26] },
    mist:   { lit: [42, 68, 72],   shd: [11, 25, 30],    stLit: [78, 92, 108],   stShd: [24, 30, 42],
              sandLit: [70, 70, 66],   sandShd: [32, 33, 31],   pathLit: [100, 92, 80], pathShd: [40, 35, 30] },
    stone:  { lit: [82, 88, 102],  shd: [26, 30, 40],    stLit: [104, 112, 130], stShd: [36, 40, 54],
              sandLit: [84, 80, 72],   sandShd: [38, 36, 33],   pathLit: [114, 98, 80], pathShd: [46, 39, 31] },
    beach:  { lit: [96, 88, 70],   shd: [34, 32, 28],    stLit: [90, 96, 110],   stShd: [32, 36, 46],
              sandLit: [104, 94, 74],  sandShd: [44, 40, 32],   pathLit: [120, 102, 78], pathShd: [49, 41, 31] },
    marsh:  { lit: [32, 54, 48],   shd: [8, 19, 21],     stLit: [70, 80, 92],    stShd: [24, 28, 36],
              sandLit: [62, 60, 50],   sandShd: [28, 28, 24],   pathLit: [50, 42, 33],  pathShd: [20, 17, 14] },
    flower: { lit: [50, 70, 48],   shd: [13, 25, 23],    stLit: [88, 94, 108],   stShd: [30, 34, 44],
              sandLit: [82, 74, 58],   sandShd: [36, 32, 26],   pathLit: [62, 50, 38],  pathShd: [26, 21, 16] },
    coral:  { lit: [76, 74, 88],   shd: [24, 26, 34],    stLit: [100, 100, 120], stShd: [36, 38, 48],
              sandLit: [88, 80, 76],   sandShd: [38, 35, 33],   pathLit: [66, 54, 46],  pathShd: [28, 24, 20] },
    frost:  { lit: [106, 120, 132], shd: [44, 54, 66],   stLit: [126, 138, 152], stShd: [54, 62, 76],
              sandLit: [112, 116, 118], sandShd: [50, 54, 58],  pathLit: [76, 68, 62],  pathShd: [34, 31, 28] }
  };
  var BIOME_FALLBACK = BIOME_PALETTES.meadow;

  // Kenney 瓦片表：文件名 → { img, cols, tile }。index = row*cols+col。
  // 素材 CC0（Kenney.nl），随包分发；加载失败时道具层自动退化为纯矢量绘制。
  var SHEETS = {
    town:    { img: null, cols: 12, tile: 16, url: null },
    dungeon: { img: null, cols: 12, tile: 16, url: null },
    farm:    { img: null, cols: 12, tile: 16, url: null },
    battle:  { img: null, cols: 18, tile: 16, url: null },
    city:    { img: null, cols: 12, tile: 16, url: null }
  };

  // 常用瓦片索引（依据 _labeled 标号表人工核定，出处见 img/LICENSE-kenney.txt）
  var K = {
    grassFlower: ['town', 2],     // 草地 + 黄花
    whiteFlower: ['town', 43],    // 白花簇（透明底，可叠在草地上）
    treeBigA: ['town', 3], treeBigB: ['town', 4], treeRound: ['town', 6],
    treeS1: ['town', 7], treeS2: ['town', 8], treeS3: ['town', 9], treeS4: ['town', 10],
    treeM1: ['town', 18], treeM2: ['town', 19], treeM3: ['town', 20],
    treeTall: ['town', 32], treeTall2: ['town', 33],
    mushroom: ['town', 17], mushroom2: ['town', 29],
    fenceC: ['town', 44], fenceV: ['town', 45], fenceTL: ['town', 46], fencePost: ['town', 47],
    fenceH1: ['town', 68], fenceH2: ['town', 69], fenceH3: ['town', 70],
    barrel: ['town', 92], crate: ['town', 108], chest: ['town', 110], coin: ['town', 105],
    sign: ['town', 71], target: ['town', 107],
    roofG1: ['town', 48], roofG2: ['town', 49], roofG3: ['town', 50],
    wallG1: ['town', 51], wallG2: ['town', 52], wallG3: ['town', 53],
    roofR1: ['town', 54], roofR2: ['town', 55], roofR3: ['town', 56],
    wallR1: ['town', 57], wallR2: ['town', 58], wallR3: ['town', 59],
    door: ['town', 84], door2: ['town', 88],
    stele: ['dungeon', 25],        // 石碑（独立石板）
    pillar: ['dungeon', 13],       // 石柱块
    torch: ['dungeon', 29],        // 火焰（透明底可贴）
    brazier: ['dungeon', 41],      // 火盆
    npcMage: ['dungeon', 85], npcWarrior: ['dungeon', 87], npcPriest: ['dungeon', 88],
    npcHood: ['dungeon', 100],
    chestRune: ['dungeon', 90],
    skull: ['dungeon', 122], potG: ['dungeon', 113], potR: ['dungeon', 114],
    signW: ['dungeon', 100],
    pine: ['farm', 15], treeBare: ['farm', 14], treeBare2: ['farm', 26],
    rockA: ['farm', 89], rockB: ['farm', 89], rockPile: ['farm', 89],
    sunflower: ['farm', 83], tomato: ['farm', 43], corn: ['farm', 30], wheat: ['farm', 69],
    carrot: ['farm', 65], pumpkin2: ['farm', 44],
    bucket: ['farm', 74], barrelF: ['farm', 85],
    sheep: ['farm', 120], cow: ['farm', 121], chicken: ['farm', 122],
    farmer: ['farm', 108], farmer2: ['farm', 109],
    windmill: ['battle', 23], tower: ['battle', 84],
    flagR: ['battle', 78], flagB: ['battle', 90], bush: ['battle', 5],
    lamp: ['city', 86], signCity: ['city', 87],
    planterA: ['city', 68], planterB: ['city', 69], planterC: ['city', 70], planterD: ['city', 71]
  };

  // 岛屿宣传语（岛名横幅第二行）：与 server 岛名对应
  var ISLE_SUB = {
    '启明岛': '灯塔之城 · 大道与灯',
    '雾隐岛': '雾中森林 · 巨树低语',
    '星坠岛': '星岩高地 · 陨坑之眼',
    '拾贝岛': '浅滩贝语 · 风与字条',
    '萤火泽': '泽畔萤光 · 芦苇深处',
    '织花谷': '花田织锦 · 风车慢转',
    '望潮岛': '珊瑚潮池 · 鲸过无痕',
    '霜屿': '结霜之屿 · 星星落雪'
  };

  function mount(container, context) {
    var api = context.data.api;
    var storage = context.data.storage;
    var realtime = context.data.realtime;
    var myId = '';
    var cleanups = [];

    function onDestroy(fn) {
      if (typeof fn === 'function') {
        cleanups.push(fn);
        context.app.onDestroy(fn);
      }
    }

    // ---------- 世界状态 ----------
    var state = {
      size: 240,
      cells: '',
      nodes: '',
      explored: null,
      exploreVer: 0,
      me: { x: 0, y: 0, dir: 0, shards: 0, name: '', built: 0, hat: '0', lantern: '0', title: '', tutorial: 0, light: 100 },
      players: {},            // 含 NPC（id 前缀 npc_，渲染走精灵图）
      lamps: {},              // 'x,y' -> { x, y, c }
      gathered: {},
      flowers: {},
      meteorNodes: {},
      meteor: null,
      emoteFx: [],
      followTarget: null,     // 跟随的同学 id
      surge: null,            // 暗涌事件 { active, until }
      calendar: { day: 1, endsAt: 0 },   // 全班的游戏日历（星露谷的一天）
      weather: 'sun',           // 今天的天气（sun / rain）
      xyGrant: 0,               // 我的赠送学元余额（平台学元体系）
      bag: {},                  // 我的背包 { cropId|wood|ore: count }
      tools: {},                // 工具等级 { till|water|chop|mine: 1|2 }
      meets: [],                // 相遇簿 [{ user_id, name, count, last_at }]
      goal: null,               // v4.10 当前目标 { id, title, at }（开场后的「下一步」）
      season: '春',             // 今天的季节
      storyChapters: [],        // 《灯火纪》章节缓存
      letters: [],              // 《先行者的信》收集状态
      letterNear: null,         // 脚边可拾的信 { id, title }
      house: null,              // 我的宅基地 { x, y, gate }
      houses: [],               // 全班已认领的宅基地 [{ user_id, name, x, y }]
      speechFx: [],           // NPC 台词气泡 { uid, idx, at }
      steles: {},             // 'x,y' -> { name, rune, by, at }
      stage: 0,
      stageInfo: { name: '长夜', desc: '' },
      lampCount: 0,
      onlineCount: 1,
      lampCost: 3,
      lampRadius: 4,
      flowerCost: 2,
      flowerCap: 40,
      flowerGrowMs: 90000,
      fishCooldownMs: 25000,
      catalog: { shop: null, fishTable: [], emotes: [], flowerSpecies: [], islands: [], landmarks: [], steles: [], speechLines: [], stages: [], crops: [] },
      quests: { intro: [], daily: [] },
      wardrobe: { owned: { hat: [], lantern: [], title: [] }, equipped: { hat: '0', lantern: '0', title: '' } },
      achCount: 0,
      claimable: 0,
      lastIsle: '',           // 岛名横幅去重
      ready: false
    };

    // 本地冷却时间戳
    var cooldowns = { fish: 0, plant: 0, bottle: 0, emote: 0, fly: 0 };
    var fishing = null;
    var flying = false;      // 纸鸢飞行演出中
    var prefs = { sound: false, hq: true };

    // 视口与相机
    var view = {
      w: 320, h: 240, tile: 40, dpr: 1,
      camX: 0, camY: 0,
      ox: 0, oy: 0,
      running: false,
      raf: 0
    };

    // ---------- §3 图标 ----------
    var SVG_NS = 'http://www.w3.org/2000/svg';
    var ICON_SPEC = {
      brand: [
        ['path', { d: 'M12 3.1c.62 4.25 1.55 5.7 5.8 6.32-4.25.62-5.18 2.07-5.8 6.32-.62-4.25-1.55-5.7-5.8-6.32C10.45 8.8 11.38 7.35 12 3.1z' }],
        ['path', { d: 'M4.8 19.6c2.3-1.25 4.7-1.88 7.2-1.88s4.9.63 7.2 1.88' }]
      ],
      shard: [
        ['path', { d: 'M12 3.4c.62 4.3 1.55 5.75 5.85 6.35-4.3.6-5.23 2.05-5.85 6.35-.62-4.3-1.55-5.75-5.85-6.35C10.45 9.15 11.38 7.7 12 3.4z' }]
      ],
      lamp: [
        ['circle', { cx: '12', cy: '7', r: '3.05' }],
        ['path', { d: 'M9.4 7h5.2' }],
        ['path', { d: 'M12 10.05v9.4' }],
        ['path', { d: 'M9.2 20.9h5.6' }]
      ],
      book: [
        ['path', { d: 'M12 6.6C10.6 5.3 8.7 4.7 6.4 4.7H4v13.6h2.4c2.3 0 4.2.6 5.6 1.9 1.4-1.3 3.3-1.9 5.6-1.9H20V4.7h-2.4c-2.3 0-4.2.6-5.6 1.9z' }],
        ['path', { d: 'M12 6.6v13.6' }]
      ],
      map: [
        ['path', { d: 'M9 4.4L4.4 6.2v13.4L9 17.8l6 1.8 4.6-1.8V4.4L15 6.2z' }],
        ['path', { d: 'M9 4.4v13.4M15 6.2v13.4' }]
      ],
      kite: [
        ['path', { d: 'M12 3.2l6.4 6.2L12 15.8 5.6 9.4z' }],
        ['path', { d: 'M12 3.2v12.6M5.6 9.4h12.8' }],
        ['path', { d: 'M12 15.8v2.6c0 1.6-1.4 2.6-3 2.4' }]
      ],
      rune: [
        ['path', { d: 'M12 3.6c2.8 1.9 4.2 4.3 4.2 7.2 0 2.9-1.4 5.6-4.2 7.6-2.8-2-4.2-4.7-4.2-7.6 0-2.9 1.4-5.3 4.2-7.2z' }],
        ['path', { d: 'M12 7.4v9M9.6 10.6h4.8' }]
      ],
      flag: [
        ['path', { d: 'M6 21V4.6' }],
        ['path', { d: 'M6 5.2c1.6-1.1 3.2-1.6 4.8-1.1 1.7.5 3.3 1.7 5 .6 1-.6 1.9-1 2.2-1.2v8.2c-1.7 1.1-3.3 1.6-5 .6-1.6-.5-3.2-.5-4.8.4' }]
      ],
      camera: [
        ['path', { d: 'M4.5 8.2h3l1.6-2.4h5.8l1.6 2.4h3a1.5 1.5 0 0 1 1.5 1.5v9a1.5 1.5 0 0 1-1.5 1.5h-15a1.5 1.5 0 0 1-1.5-1.5v-9a1.5 1.5 0 0 1 1.5-1.5z' }],
        ['circle', { cx: '12', cy: '13.6', r: '3.4' }]
      ],
      hat: [
        ['path', { d: 'M4 15.6c2.4-1.9 5-2.9 8-2.9s5.6 1 8 2.9' }],
        ['path', { d: 'M8.6 13.4c.4-3.4 1.5-5.6 3.4-7.4 1.9 1.8 3 4 3.4 7.4' }],
        ['path', { d: 'M12 6v-.9' }]
      ],
      gear: [
        ['circle', { cx: '12', cy: '12', r: '2.6' }],
        ['path', { d: 'M12 3.4v2.2M12 18.4v2.2M3.4 12h2.2M18.4 12h2.2M5.8 5.8l1.6 1.6M16.6 16.6l1.6 1.6M18.2 5.8l-1.6 1.6M7.4 16.6l-1.6 1.6' }]
      ],
      help: [
        ['circle', { cx: '12', cy: '12', r: '8.6' }],
        ['path', { d: 'M9.5 9.3a2.6 2.6 0 1 1 3.5 2.45c-.66.24-1 .82-1 1.52v.36' }],
        ['circle', { cx: '12', cy: '16.9', r: '.85', fill: 'currentColor', stroke: 'none' }]
      ],
      gather: [
        ['path', { d: 'M12 5.4c.58 3.4 1.42 4.45 4.85 5.02-3.43.57-4.27 1.62-4.85 5.02-.58-3.4-1.42-4.45-4.85-5.02C10.58 9.85 11.42 8.8 12 5.4z' }],
        ['circle', { cx: '12', cy: '11.4', r: '8.2', 'stroke-dasharray': '1.9 3.2', opacity: '.75' }]
      ],
      bottle: [
        ['path', { d: 'M10.2 2.9h3.6' }],
        ['path', { d: 'M11 2.9v3l-2.2 3.05a3.2 3.2 0 0 0-.55 1.8v9.35a1.9 1.9 0 0 0 1.9 1.9h3.7a1.9 1.9 0 0 0 1.9-1.9v-9.35a3.2 3.2 0 0 0-.55-1.8L13 5.9v-3' }],
        ['path', { d: 'M8.25 13.6h7.5' }]
      ],
      flower: [
        ['circle', { cx: '12', cy: '12', r: '1.9' }],
        ['path', { d: 'M12 10.1c0-2.2-.9-3.6-2.4-4.2M12 10.1c0-2.2.9-3.6 2.4-4.2' }],
        ['path', { d: 'M13.5 13c1.9 1.1 2.9 2.6 3 4.6M10.5 13c-1.9 1.1-2.9 2.6-3 4.6' }],
        ['path', { d: 'M13.6 10.7c1.9-1 3.7-1 5.4.1M10.4 10.7c-1.9-1-3.7-1-5.4.1' }]
      ],
      fish: [
        ['path', { d: 'M12 3.4v6.2' }],
        ['path', { d: 'M12 9.6a4.4 4.4 0 0 1 4.4 4.4c0 2.9-2 6.6-4.4 6.6s-4.4-3.7-4.4-6.6A4.4 4.4 0 0 1 12 9.6z' }],
        ['path', { d: 'M10.4 12.4c.5.5 1.1.8 1.6.8s1.1-.3 1.6-.8' }]
      ],
      smile: [
        ['circle', { cx: '12', cy: '12', r: '8.4' }],
        ['path', { d: 'M8.6 13.6c.9 1.5 2 2.3 3.4 2.3s2.5-.8 3.4-2.3' }],
        ['path', { d: 'M9.2 9.4v.9M14.8 9.4v.9' }]
      ],
      star: [
        ['path', { d: 'M12 3.6l2.2 4.9 5.3.6-3.9 3.6 1 5.3L12 15.2l-4.6 2.8 1-5.3-3.9-3.6 5.3-.6z' }]
      ],
      heart: [
        ['path', { d: 'M12 20.2S4.2 15.4 4.2 9.9c0-2.5 1.9-4.4 4.3-4.4 1.5 0 2.8.8 3.5 2 .7-1.2 2-2 3.5-2 2.4 0 4.3 1.9 4.3 4.4 0 5.5-7.8 10.3-7.8 10.3z' }]
      ],
      note: [
        ['circle', { cx: '8.6', cy: '16.6', r: '2.7' }],
        ['path', { d: 'M11.3 16.6V5.4l7-1.6v9' }],
        ['circle', { cx: '15.6', cy: '14.4', r: '2.7' }]
      ],
      zzz: [
        ['path', { d: 'M4 8.6h4.6L4 13.4h4.6' }],
        ['path', { d: 'M11.5 12.4h3.6L11.5 16h3.6' }],
        ['path', { d: 'M18 15.8h2.8L18 18.6h2.8' }]
      ],
      ask: [
        ['path', { d: 'M9.4 9a2.8 2.8 0 1 1 3.8 2.6c-.7.3-1.1.9-1.1 1.6v.5' }],
        ['circle', { cx: '12', cy: '17.2', r: '.95', fill: 'currentColor', stroke: 'none' }]
      ],
      wave: [
        ['path', { d: 'M7.6 12.2V6.4a1.3 1.3 0 0 1 2.6 0v4.2' }],
        ['path', { d: 'M10.2 10.2V5.1a1.3 1.3 0 0 1 2.6 0v5.1' }],
        ['path', { d: 'M12.8 10.6V6.3a1.3 1.3 0 0 1 2.6 0v6.3' }],
        ['path', { d: 'M15.4 12.6c.9-.9 1.8-1.1 2.6-.7.9.5 1 1.5.2 2.9-.7 1.3-1.6 2.6-2.7 3.6-1.6 1.4-3.5 1.6-5.3.4-1.2-.8-2-1.9-2.6-3.4l-1.2-3a1.25 1.25 0 0 1 2.3-.9l.9 2' }]
      ],
      spark: [
        ['path', { d: 'M12 4.6c.5 3.2 1.2 4.2 3.9 4.7-2.7.5-3.4 1.5-3.9 4.7-.5-3.2-1.2-4.2-3.9-4.7 2.7-.5 3.4-1.5 3.9-4.7z' }],
        ['path', { d: 'M17.8 14.2c.3 1.7.7 2.2 2.2 2.5-1.5.3-1.9.8-2.2 2.5-.3-1.7-.7-2.2-2.2-2.5 1.5-.3 1.9-.8 2.2-2.5z' }],
        ['path', { d: 'M6 15.4c.25 1.4.6 1.85 1.9 2.1-1.3.25-1.65.7-1.9 2.1-.25-1.4-.6-1.85-1.9-2.1 1.3-.25 1.65-.7 1.9-2.1z' }]
      ],
      postcard: [
        ['rect', { x: '3.4', y: '5.6', width: '17.2', height: '12.8', rx: '1.8' }],
        ['path', { d: 'M3.4 9.6l7.1 5.2c.9.65 2.1.65 3 0l7.1-5.2' }],
        ['path', { d: 'M15.4 9h2.8' }]
      ],
      sound: [
        ['path', { d: 'M4.4 9.6h3l4.2-3.4v11.6L7.4 14.4h-3z' }],
        ['path', { d: 'M15 9.2a4.2 4.2 0 0 1 0 5.6M17.6 7a7.4 7.4 0 0 1 0 10' }]
      ],
      mute: [
        ['path', { d: 'M4.4 9.6h3l4.2-3.4v11.6L7.4 14.4h-3z' }],
        ['path', { d: 'M15.4 9.8l4.4 4.4M19.8 9.8l-4.4 4.4' }]
      ],
      refresh: [
        ['path', { d: 'M19 12a7 7 0 1 1-2.1-5' }],
        ['path', { d: 'M17.4 3.6l-.5 3.6-3.5-.7' }]
      ],
      close: [
        ['path', { d: 'M6.5 6.5l11 11M17.5 6.5l-11 11' }]
      ],
      pin: [
        ['path', { d: 'M12 21c-3.6-3.9-5.8-7.2-5.8-10a5.8 5.8 0 1 1 11.6 0c0 2.8-2.2 6.1-5.8 10z' }],
        ['circle', { cx: '12', cy: '10.6', r: '2' }]
      ],
      trophy: [
        ['path', { d: 'M7.6 4.6h8.8v4.6a4.4 4.4 0 0 1-8.8 0z' }],
        ['path', { d: 'M7.6 6H4.9a3 3 0 0 0 3 3M16.4 6h2.7a3 3 0 0 1-3 3' }],
        ['path', { d: 'M12 13.6v3.2M8.6 19.8h6.8M9.8 16.8h4.4l.8 3H9z' }]
      ]
    };

    function svgIcon(name) {
      var svg = document.createElementNS(SVG_NS, 'svg');
      svg.setAttribute('viewBox', '0 0 24 24');
      svg.setAttribute('fill', 'none');
      svg.setAttribute('stroke', 'currentColor');
      svg.setAttribute('stroke-width', '1.55');
      svg.setAttribute('stroke-linecap', 'round');
      svg.setAttribute('stroke-linejoin', 'round');
      var spec = ICON_SPEC[name] || [];
      for (var i = 0; i < spec.length; i++) {
        var node = document.createElementNS(SVG_NS, spec[i][0]);
        var at = spec[i][1];
        for (var k in at) {
          if (Object.prototype.hasOwnProperty.call(at, k)) node.setAttribute(k, at[k]);
        }
        svg.appendChild(node);
      }
      return svg;
    }

    // ---------- 素材装载（Kenney 瓦片 + Unifont 像素字） ----------
    // 瓦片图 / 字体都是增强项：加载失败（离线、老内核）时道具层退化为矢量绘制、
    // 画布文字退回系统字体 —— 世界照常能玩，只是少一层像素味。
    var pixelFontReady = false;
    var pixelFontName = 'SGPixel';

    function loadAssets() {
      var jobs = [];
      var names = Object.keys(SHEETS);
      for (var i = 0; i < names.length; i++) {
        (function(nm) {
          jobs.push(new Promise(function(resolve) {
            var im = new Image();
            im.onload = function() { SHEETS[nm].img = im; resolve(true); };
            im.onerror = function() { resolve(false); };
            im.src = context.app.assetUrl('frontend/img/' + nm + '.png');
          }));
        })(names[i]);
      }
      // 画布像素字：FontFace 是 Chrome 60+ 的能力，基线 80 支持。
      jobs.push(new Promise(function(resolve) {
        try {
          if (typeof window.FontFace !== 'function') { resolve(false); return; }
          var face = new window.FontFace(pixelFontName, 'url(' + context.app.assetUrl('frontend/fonts/unifont-ex.woff2') + ')');
          face.load().then(function() {
            try { document.fonts.add(face); pixelFontReady = true; } catch (e2) {}
            resolve(pixelFontReady);
          }).catch(function() { resolve(false); });
        } catch (e) { resolve(false); }
      }));
      return Promise.all(jobs);
    }

    function drawTile(spec, dx, dy, scale) {
      var sheet = SHEETS[spec[0]];
      if (!sheet || !sheet.img) return false;
      var idx = spec[1];
      var sx = (idx % sheet.cols) * sheet.tile;
      var sy = Math.floor(idx / sheet.cols) * sheet.tile;
      var d = sheet.tile * (scale || 1);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(sheet.img, sx, sy, sheet.tile, sheet.tile, dx, dy, d, d);
      ctx.imageSmoothingEnabled = true;
      return true;
    }

    function drawTileAt(spec, dx, dy, w, h) {
      var sheet = SHEETS[spec[0]];
      if (!sheet || !sheet.img) return false;
      var idx = spec[1];
      var sx = (idx % sheet.cols) * sheet.tile;
      var sy = Math.floor(idx / sheet.cols) * sheet.tile;
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(sheet.img, sx, sy, sheet.tile, sheet.tile, dx, dy, w, h);
      ctx.imageSmoothingEnabled = true;
      return true;
    }

    // 画布文字统一走这里：像素字就绪后用它（中文 16px 位图字在小字号下比
    // 系统字体的抗锯齿灰字清晰得多），没就绪退回系统字体。
    function canvasFont(px, bold) {
      if (pixelFontReady) return (bold ? '700 ' : '') + px + 'px ' + pixelFontName;
      return (bold ? '600 ' : '') + px + 'px system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif';
    }

    // ---------- §4 音频引擎 ----------
    // 全部程序合成（振荡器 + 包络），不引入任何音频文件 —— 既没有素材版权，
    // 也不会多一次网络请求。默认关闭（课堂纪律 + 浏览器自动播放策略），
    // 首次开启发生在用户点击开关的那一次手势里，AudioContext 可以合法启动。
    var audio = {
      ctx: null, master: null, ambient: null, ambientTimer: 0
    };

    function audioInit() {
      if (audio.ctx) return;
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      try {
        audio.ctx = new AC();
        audio.master = audio.ctx.createGain();
        audio.master.gain.value = 0.16;
        audio.master.connect(audio.ctx.destination);
      } catch (e) {
        audio.ctx = null;
      }
    }

    // 环境垫音：两只轻微失谐的正弦（A2 / E3），经低通与极慢的呼吸起伏。
    function ambientStart() {
      if (!audio.ctx || audio.ambient) return;
      var c = audio.ctx;
      var g = c.createGain();
      g.gain.value = 0.0;
      var lp = c.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 760;
      var o1 = c.createOscillator();
      o1.type = 'sine';
      o1.frequency.value = 110;
      var o2 = c.createOscillator();
      o2.type = 'sine';
      o2.frequency.value = 164.81;
      o2.detune.value = 6;
      var o1g = c.createGain(); o1g.gain.value = 0.55;
      var o2g = c.createGain(); o2g.gain.value = 0.34;
      o1.connect(o1g); o2.connect(o2g);
      o1g.connect(lp); o2g.connect(lp);
      lp.connect(g); g.connect(audio.master);
      var lfo = c.createOscillator();
      lfo.type = 'sine';
      lfo.frequency.value = 0.05;
      var lfoG = c.createGain();
      lfoG.gain.value = 0.35;
      lfo.connect(lfoG);
      lfoG.connect(g.gain);
      o1.start(); o2.start(); lfo.start();
      g.gain.linearRampToValueAtTime(0.85, c.currentTime + 3.2);
      audio.ambient = { g: g, nodes: [o1, o2, lfo] };
      var scale = [659.26, 783.99, 987.77, 1174.66, 1318.51];
      function twinkle() {
        if (!audio.ambient) return;
        var f = scale[Math.floor(Math.random() * scale.length)];
        audio.blip(f, 1.6, 'sine', 0.10, 0);
        audio.ambientTimer = setTimeout(twinkle, 9000 + Math.random() * 8000);
      }
      audio.ambientTimer = setTimeout(twinkle, 5200);
    }

    function ambientStop() {
      if (!audio.ambient) return;
      try {
        if (audio.ambientTimer) clearTimeout(audio.ambientTimer);
        var c = audio.ctx;
        audio.ambient.g.gain.cancelScheduledValues(c.currentTime);
        audio.ambient.g.gain.setValueAtTime(audio.ambient.g.gain.value, c.currentTime);
        audio.ambient.g.gain.linearRampToValueAtTime(0, c.currentTime + 0.8);
        var nodes = audio.ambient.nodes;
        setTimeout(function() {
          for (var i = 0; i < nodes.length; i++) {
            try { nodes[i].stop(); } catch (e) {}
          }
        }, 900);
      } catch (e) {}
      audio.ambient = null;
    }

    audio.blip = function(freq, dur, type, vol, delaySec) {
      if (!prefs.sound || !audio.ctx || !audio.master) return;
      try {
        var c = audio.ctx;
        var t0 = c.currentTime + (delaySec || 0);
        var o = c.createOscillator();
        o.type = type || 'sine';
        o.frequency.value = freq;
        var g = c.createGain();
        g.gain.setValueAtTime(0, t0);
        g.gain.linearRampToValueAtTime(vol, t0 + 0.012);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
        o.connect(g); g.connect(audio.master);
        o.start(t0);
        o.stop(t0 + dur + 0.05);
      } catch (e) {}
    };

    audio.sweep = function(f0, f1, dur, vol) {
      if (!prefs.sound || !audio.ctx || !audio.master) return;
      try {
        var c = audio.ctx;
        var t0 = c.currentTime;
        var o = c.createOscillator();
        o.type = 'triangle';
        o.frequency.setValueAtTime(f0, t0);
        o.frequency.exponentialRampToValueAtTime(f1, t0 + dur);
        var g = c.createGain();
        g.gain.setValueAtTime(0, t0);
        g.gain.linearRampToValueAtTime(vol, t0 + 0.05);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
        o.connect(g); g.connect(audio.master);
        o.start(t0); o.stop(t0 + dur + 0.05);
      } catch (e) {}
    };

    // 低音「哞」—— 鲸影划过云海时的远程问候
    audio.whale = function() {
      if (!prefs.sound || !audio.ctx || !audio.master) return;
      try {
        var c = audio.ctx;
        var t0 = c.currentTime;
        var o = c.createOscillator();
        o.type = 'sine';
        o.frequency.setValueAtTime(160, t0);
        o.frequency.linearRampToValueAtTime(110, t0 + 1.6);
        var g = c.createGain();
        g.gain.setValueAtTime(0, t0);
        g.gain.linearRampToValueAtTime(0.12, t0 + 0.4);
        g.gain.linearRampToValueAtTime(0, t0 + 1.8);
        o.connect(g); g.connect(audio.master);
        o.start(t0); o.stop(t0 + 2);
      } catch (e) {}
    };

    var sfx = {
      gather: function() {
        audio.blip(659.26, 0.28, 'sine', 0.20, 0);
        audio.blip(987.77, 0.34, 'sine', 0.14, 0.07);
        audio.blip(1318.51, 0.5, 'sine', 0.10, 0.14);
      },
      build: function() {
        audio.blip(261.63, 1.1, 'triangle', 0.16, 0);
        audio.blip(329.63, 1.1, 'triangle', 0.13, 0.02);
        audio.blip(392, 1.3, 'triangle', 0.12, 0.04);
        audio.blip(523.25, 1.4, 'sine', 0.10, 0.08);
      },
      plant: function() {
        audio.blip(520, 0.16, 'sine', 0.16, 0);
        audio.sweep(260, 660, 0.35, 0.08);
      },
      fishCast: function() { audio.sweep(360, 900, 0.5, 0.07); },
      fishCatch: function(rarity) {
        audio.blip(523.25, 0.3, 'sine', 0.14, 0);
        audio.blip(659.26, 0.4, 'sine', 0.13, 0.1);
        if (rarity >= 2) audio.blip(987.77, 0.8, 'sine', 0.12, 0.2);
        if (rarity >= 3) {
          audio.blip(1318.51, 1.2, 'sine', 0.12, 0.32);
          audio.blip(1567.98, 1.4, 'sine', 0.09, 0.44);
        }
      },
      meteor: function() {
        for (var i = 0; i < 5; i++) {
          audio.blip(1046 + Math.random() * 700, 0.9, 'sine', 0.05, i * 0.16);
        }
      },
      dawn: function() {
        audio.blip(329.63, 1.6, 'sine', 0.10, 0);
        audio.blip(493.88, 1.6, 'sine', 0.10, 0.18);
        audio.blip(659.26, 1.8, 'sine', 0.12, 0.36);
        audio.blip(987.77, 2.2, 'sine', 0.08, 0.6);
      },
      award: function() {
        audio.blip(880, 0.7, 'sine', 0.12, 0);
        audio.blip(1318.51, 1.0, 'sine', 0.09, 0.1);
      },
      rune: function() {
        // 石碑苏醒：一声石磬 + 上行五度
        audio.blip(220, 1.6, 'triangle', 0.14, 0);
        audio.blip(440, 1.8, 'sine', 0.10, 0.2);
        audio.blip(660, 2.2, 'sine', 0.08, 0.45);
      },
      fly: function() { audio.sweep(300, 1200, 1.4, 0.09); },
      tap: function() { audio.blip(760, 0.09, 'sine', 0.07, 0); }
    };

    function setSound(on) {
      prefs.sound = !!on;
      try { storage.set('sound', prefs.sound ? '1' : '0'); } catch (e) {}
      if (prefs.sound) {
        audioInit();
        if (audio.ctx && audio.ctx.state === 'suspended') {
          try { audio.ctx.resume(); } catch (e) {}
        }
        ambientStart();
      } else {
        ambientStop();
      }
      updateSettingsUi();
    }

    onDestroy(function() {
      ambientStop();
      if (audio.ctx) {
        try { audio.ctx.close(); } catch (e) {}
        audio.ctx = null;
      }
    });

    try {
      var s1 = storage.get('sound', '0');
      prefs.sound = s1 === '1' || s1 === true;
      var s2 = storage.get('hq', '1');
      prefs.hq = s2 !== '0';
    } catch (e) {}

    // ---------- §5 DOM ----------
    var root = el('div', 'sg-root');

    // HUD：从顶端淡出的一层渐变，世界从它底下透出来。
    var hud = el('div', 'sg-hud');

    var brand = el('div', 'sg-hud-brand');
    var brandMark = el('span', 'sg-brand-mark');
    brandMark.appendChild(svgIcon('brand'));
    var brandText = el('div', 'sg-brand-text');
    brandText.appendChild(el('div', 'sg-brand-title', '拾光群岛'));
    var statStage = el('div', 'sg-brand-sub', '长夜');
    brandText.appendChild(statStage);
    var stageBarWrap = el('div', 'sg-stagebar');
    var stageBarFill = el('i', 'sg-stagebar-fill');
    stageBarWrap.appendChild(stageBarFill);
    brandText.appendChild(stageBarWrap);
    brand.appendChild(brandMark);
    brand.appendChild(brandText);

    var hudRight = el('div', 'sg-hud-right');
    var online = el('div', 'sg-online');
    online.appendChild(el('i', 'sg-online-dot'));
    var statOnline = el('span', null, '1 人在岛');
    online.appendChild(statOnline);
    hudRight.appendChild(online);

    // v4.7 背包与拾光志入口按钮
    var bagBtn = iconBtn('bottle', '背包');
    bagBtn.addEventListener('click', function() { openBag(); });
    var storyBtn = iconBtn('book', '拾光志');
    storyBtn.addEventListener('click', function() {
      refreshStory();
      openSheet('story', '拾光志 · 灯火纪');
      renderStory(sheetBody);
    });
    hudRight.appendChild(bagBtn);
    hudRight.appendChild(storyBtn);
    onDestroy(function() {
      bagBtn.removeEventListener('click', openBag);
      storyBtn.removeEventListener('click', storyBtn._h || function() {});
    });

    function iconBtn(name, label) {
      var b = el('button', 'sg-icon-btn');
      b.type = 'button';
      b.setAttribute('aria-label', label);
      b.appendChild(svgIcon(name));
      return b;
    }
    var btnMap = iconBtn('map', '世界地图');
    var btnQuest = iconBtn('flag', '任务');
    var btnBook = iconBtn('book', '群岛志');
    var btnWardrobe = iconBtn('hat', '拾光衣柜');
    var btnSettings = iconBtn('gear', '设置');
    var btnHelp = iconBtn('help', '怎么玩');
    var questDot = el('i', 'sg-btn-dot');
    btnQuest.appendChild(questDot);
    hudRight.appendChild(btnMap);
    hudRight.appendChild(btnQuest);
    hudRight.appendChild(btnBook);
    hudRight.appendChild(btnWardrobe);
    hudRight.appendChild(btnSettings);
    hudRight.appendChild(btnHelp);

    hud.appendChild(brand);
    hud.appendChild(hudRight);

    // 资源胶囊：星屑与灯柱
    var pills = el('div', 'sg-hud-pills');
    var pillShard = el('div', 'sg-pill sg-pill-shard');
    var icoShard = el('span', 'sg-pill-ico');
    icoShard.appendChild(svgIcon('shard'));
    var shardsVal = el('b', 'sg-pill-val', '0');
    pillShard.appendChild(icoShard);
    pillShard.appendChild(shardsVal);
    pillShard.appendChild(el('span', 'sg-pill-unit', '星屑'));

    var pillLamp = el('div', 'sg-pill sg-pill-lamp');
    var icoLamp = el('span', 'sg-pill-ico');
    icoLamp.appendChild(svgIcon('lamp'));
    var lampsVal = el('b', 'sg-pill-val', '0');
    pillLamp.appendChild(icoLamp);
    pillLamp.appendChild(lampsVal);
    pillLamp.appendChild(el('span', 'sg-pill-unit', '灯柱'));

    // v4.2 游戏日历：全班同一天。一天 6 分钟，作物隔夜抽高。
    var pillDay = el('div', 'sg-pill sg-pill-day');
    var icoDay = el('span', 'sg-pill-ico');
    icoDay.appendChild(svgIcon('flag'));
    var dayVal = el('b', 'sg-pill-val', '第 1 天');
    pillDay.appendChild(icoDay);
    pillDay.appendChild(dayVal);

    // 灯油弧表：核心生存资源的「可读化」。黑暗层会告诉你要不要慌，
    // 但「还剩多少」必须有个能瞄一眼的地方 —— 否则恐惧没有刻度。
    var oilGauge = el('div', 'sg-oil');
    var oilSvg = document.createElementNS(SVG_NS, 'svg');
    oilSvg.setAttribute('viewBox', '0 0 30 30');
    oilSvg.setAttribute('class', 'sg-oil-arc');
    var oilBg = document.createElementNS(SVG_NS, 'circle');
    oilBg.setAttribute('cx', '15'); oilBg.setAttribute('cy', '15'); oilBg.setAttribute('r', '12');
    oilBg.setAttribute('fill', 'none');
    oilBg.setAttribute('stroke', 'rgba(255, 255, 255, 0.14)');
    oilBg.setAttribute('stroke-width', '3');
    var oilFg = document.createElementNS(SVG_NS, 'circle');
    oilFg.setAttribute('cx', '15'); oilFg.setAttribute('cy', '15'); oilFg.setAttribute('r', '12');
    oilFg.setAttribute('fill', 'none');
    oilFg.setAttribute('stroke', '#ffd98a');
    oilFg.setAttribute('stroke-width', '3');
    oilFg.setAttribute('stroke-linecap', 'round');
    oilFg.setAttribute('stroke-dasharray', '75.4');
    oilFg.setAttribute('stroke-dashoffset', '0');
    oilSvg.appendChild(oilBg);
    oilSvg.appendChild(oilFg);
    var oilIco = el('span', 'sg-oil-ico');
    oilIco.appendChild(svgIcon('lamp'));
    oilGauge.appendChild(oilSvg);
    oilGauge.appendChild(oilIco);
    pills.appendChild(oilGauge);

    pills.appendChild(pillShard);
    pills.appendChild(pillLamp);
    pills.appendChild(pillDay);
    hud.appendChild(pills);

    var stage = el('div', 'sg-stage');
    var canvas = document.createElement('canvas');
    canvas.className = 'sg-canvas';
    var ctx = canvas.getContext('2d');

    var hint = el('div', 'sg-hint', '拖动左下摇杆漫步　·　站到星屑上采集');
    var toastBox = el('div', 'sg-toast');

    // 全服横幅
    var banner = el('div', 'sg-banner');
    var bannerIco = el('span', 'sg-banner-ico');
    var bannerText = el('div', 'sg-banner-text');
    var bannerMain = el('div', 'sg-banner-main', '');
    var bannerSub = el('div', 'sg-banner-sub');
    bannerText.appendChild(bannerMain);
    bannerText.appendChild(bannerSub);
    banner.appendChild(bannerIco);
    banner.appendChild(bannerText);
    var bannerTimer = 0;

    // 天光播报
    var dawnFx = el('div', 'sg-dawn-fx');
    var dawnCard = el('div', 'sg-dawn-card');
    var dawnTitle = el('div', 'sg-dawn-title');
    var dawnDesc = el('div', 'sg-dawn-desc');
    dawnCard.appendChild(dawnTitle);
    dawnCard.appendChild(dawnDesc);
    dawnFx.appendChild(dawnCard);
    // 天光扫光：一条暖色光带从顶掠到底 —— 「整个世界被照亮了一遍」
    var dawnSweep = el('div', 'sg-dawn-sweep');
    dawnFx.appendChild(dawnSweep);

    // ---------- 小地图 ----------
    var minimap = el('div', 'sg-minimap');
    minimap.setAttribute('role', 'button');
    minimap.setAttribute('aria-label', '小地图，点按放大');
    var mmBase = document.createElement('canvas');
    mmBase.className = 'sg-mm-canvas sg-mm-base';
    mmBase.width = 240; mmBase.height = 240;
    var mmDots = document.createElement('canvas');
    mmDots.className = 'sg-mm-canvas sg-mm-dots';
    mmDots.width = 240; mmDots.height = 240;
    var mmLabel = el('div', 'sg-mm-label', '');
    minimap.appendChild(mmBase);
    minimap.appendChild(mmDots);
    minimap.appendChild(mmLabel);
    var mmBig = false;

    // ---------- 摇杆 ----------
    var stick = el('div', 'sg-stick is-hint');
    stick.appendChild(el('div', 'sg-stick-core'));
    var tickD = el('i', 'sg-stick-tick sg-tick-d');
    var tickL = el('i', 'sg-stick-tick sg-tick-l');
    var tickR = el('i', 'sg-stick-tick sg-tick-r');
    var tickU = el('i', 'sg-stick-tick sg-tick-u');
    stick.appendChild(tickD);
    stick.appendChild(tickL);
    stick.appendChild(tickR);
    stick.appendChild(tickU);
    var stickRay = el('div', 'sg-stick-ray');
    stick.appendChild(stickRay);
    var stickKnob = el('div', 'sg-stick-knob');
    stick.appendChild(stickKnob);

    // ---------- 表情盘 ----------
    var tray = el('div', 'sg-tray');
    var EMOTE_META = [
      { id: 'wave', icon: 'wave', label: '挥手' },
      { id: 'heart', icon: 'heart', label: '比心' },
      { id: 'note', icon: 'note', label: '哼歌' },
      { id: 'zzz', icon: 'zzz', label: '打盹' },
      { id: 'spark', icon: 'spark', label: '欢呼' },
      { id: 'ask', icon: 'ask', label: '疑问' }
    ];
    var trayBtns = {};
    for (var ti = 0; ti < EMOTE_META.length; ti++) {
      var tb = el('button', 'sg-tray-btn');
      tb.type = 'button';
      tb.setAttribute('aria-label', EMOTE_META[ti].label);
      var tico = el('span', 'sg-tray-ico');
      tico.appendChild(svgIcon(EMOTE_META[ti].icon));
      tb.appendChild(tico);
      tb.appendChild(el('span', 'sg-tray-label', EMOTE_META[ti].label));
      tray.appendChild(tb);
      trayBtns[EMOTE_META[ti].id] = tb;
    }

    // ---------- 动作簇 ----------
    var RING_C = 2 * Math.PI * 29;

    function ringSvg() {
      var svg = document.createElementNS(SVG_NS, 'svg');
      svg.setAttribute('class', 'sg-ring');
      svg.setAttribute('viewBox', '0 0 64 64');
      var bg = document.createElementNS(SVG_NS, 'circle');
      bg.setAttribute('class', 'sg-ring-bg');
      bg.setAttribute('cx', '32'); bg.setAttribute('cy', '32'); bg.setAttribute('r', '29');
      var fg = document.createElementNS(SVG_NS, 'circle');
      fg.setAttribute('class', 'sg-ring-fg');
      fg.setAttribute('cx', '32'); fg.setAttribute('cy', '32'); fg.setAttribute('r', '29');
      fg.setAttribute('stroke-dasharray', String(RING_C));
      fg.setAttribute('stroke-dashoffset', '0');
      svg.appendChild(bg);
      svg.appendChild(fg);
      return { svg: svg, fg: fg };
    }

    function actBtn(cls, icon, label, withRing) {
      var b = el('button', 'sg-act ' + cls);
      b.type = 'button';
      b.setAttribute('aria-label', label);
      if (withRing) {
        var ring = ringSvg();
        b.appendChild(ring.svg);
        b._ringFg = ring.fg;
      }
      var ico = el('span', 'sg-act-ico');
      ico.appendChild(svgIcon(icon));
      b.appendChild(ico);
      b.appendChild(el('span', 'sg-act-label', label));
      return b;
    }

    var acts = el('div', 'sg-acts');
    var btnGather = actBtn('sg-act-gather', 'gather', '采集', false);
    var btnBuild = actBtn('sg-act-build', 'lamp', '点灯', false);
    var badgeBuild = el('span', 'sg-badge', '3');
    btnBuild.appendChild(badgeBuild);
    var btnPlant = actBtn('sg-act-plant', 'flower', '种花', false);
    var badgePlant = el('span', 'sg-badge', '2');
    btnPlant.appendChild(badgePlant);
    var btnFish = actBtn('sg-act-fish', 'fish', '钓星', true);
    var btnBottle = actBtn('sg-act-bottle', 'bottle', '漂流', true);
    var btnEmote = actBtn('sg-act-emote', 'smile', '表情', false);
    // 情境动作：只在特定地点出现（码头 → 纸鸢快线；石碑旁 → 触碑）
    var btnFly = actBtn('sg-act-fly', 'kite', '快线', false);
    var btnStele = actBtn('sg-act-stele', 'rune', '触碑', false);
    var btnUpgrade = actBtn('sg-act-upgrade', 'lamp', '升级', false);
    // v4.5 星露谷：夜里（时钟 22:00 后）出现「睡觉」—— 一天的句号
    // 星露谷的夜里：22:00 后催你睡觉
    var btnSleep = actBtn('sg-act-sleep', 'zzz', '睡觉', false);
    btnSleep.style.display = 'none';
    // v4.14 拾信按钮：脚边有信时出现
    var btnPickLetter = actBtn('sg-act-pick', 'book', '拾信', false);
    btnPickLetter.style.display = 'none';
    acts.appendChild(btnEmote);
    acts.appendChild(btnBottle);
    acts.appendChild(btnUpgrade);
    acts.appendChild(btnSleep);
    acts.appendChild(btnPickLetter);
    acts.appendChild(btnFly);
    acts.appendChild(btnPlant);
    acts.appendChild(btnBuild);
    acts.appendChild(btnFish);
    acts.appendChild(btnStele);
    acts.appendChild(btnGather);

    // ---------- 纸鸢飞行遮罩 ----------
    var flight = el('div', 'sg-flight');
    var flightKite = el('div', 'sg-flight-kite');
    flightKite.appendChild(svgIcon('kite'));
    flight.appendChild(el('div', 'sg-flight-cloud sg-flight-c1'));
    flight.appendChild(el('div', 'sg-flight-cloud sg-flight-c2'));
    flight.appendChild(el('div', 'sg-flight-cloud sg-flight-c3'));
    flight.appendChild(flightKite);
    flight.appendChild(el('div', 'sg-flight-text', '纸鸢起航……'));
    flight.hidden = true;

    // ---------- 载入 ----------
    function buildOrb() {
      var o = el('div', 'sg-orb');
      o.appendChild(el('i'));
      o.appendChild(el('i'));
      o.appendChild(el('b'));
      return o;
    }

    var loading = el('div', 'sg-loading');
    loading.appendChild(buildOrb());
    loading.appendChild(el('div', 'sg-loading-text', '正在渡海…'));

    stage.appendChild(canvas);
    stage.appendChild(hint);
    stage.appendChild(minimap);
    stage.appendChild(banner);
    stage.appendChild(dawnFx);
    stage.appendChild(toastBox);
    stage.appendChild(tray);
    stage.appendChild(stick);
    stage.appendChild(acts);
    stage.appendChild(flight);
    stage.appendChild(loading);
    // ---------- v4.5 星露谷骨架 UI ----------
    // 右上：时钟面板（表盘 + 时间 + 日期 + 天气 + 金钱）
    // 右下：体力条（火 = 体力的可读化，星露谷同款竖条）
    // 底部：工具栏（锄头 / 水壶 / 种子袋 / 镰刀 —— 语境高亮，点击即动作）
    // ---------- v4.13 怀表卡片（星露谷式时钟） ----------
    // SVG 弧形时间进度（一天 20 小时走满 270° 扇区）+ 大字时间 + 季节/日期/天气 + 星屑 + 学元。
    var clockPanel = el('div', 'sg-clock');
    var clockTop = el('div', 'sg-clock-top');
    var NSX = 'http://www.w3.org/2000/svg';
    var dialSvg = document.createElementNS(NSX, 'svg');
    dialSvg.setAttribute('viewBox', '0 0 44 44');
    dialSvg.setAttribute('class', 'sg-clock-arc');
    var dialBg = document.createElementNS(NSX, 'circle');
    dialBg.setAttribute('cx', '22'); dialBg.setAttribute('cy', '22'); dialBg.setAttribute('r', '18');
    dialBg.setAttribute('fill', 'none');
    dialBg.setAttribute('stroke', 'rgba(255,255,255,0.12)');
    dialBg.setAttribute('stroke-width', '5');
    var dialFg = document.createElementNS(NSX, 'circle');
    dialFg.setAttribute('cx', '22'); dialFg.setAttribute('cy', '22'); dialFg.setAttribute('r', '18');
    dialFg.setAttribute('fill', 'none');
    dialFg.setAttribute('stroke', '#ffd98a');
    dialFg.setAttribute('stroke-width', '5');
    dialFg.setAttribute('stroke-linecap', 'round');
    dialFg.setAttribute('stroke-dasharray', '113.1');
    dialFg.setAttribute('stroke-dashoffset', '113.1');
    dialFg.setAttribute('transform', 'rotate(135 22 22)');
    dialSvg.appendChild(dialBg);
    dialSvg.appendChild(dialFg);
    var dialCore = el('div', 'sg-clock-dial-core');
    var seasonEl = el('div', 'sg-clock-season', '春');
    var clockDay = el('div', 'sg-clock-daynum', '1');
    dialCore.appendChild(seasonEl);
    dialCore.appendChild(clockDay);
    var dialWrap = el('div', 'sg-clock-dialwrap');
    dialWrap.appendChild(dialSvg);
    dialWrap.appendChild(dialCore);
    var clockTimeCol = el('div', 'sg-clock-timecol');
    var clockTime = el('div', 'sg-clock-time', '上午 6:00');
    var clockWeather = el('div', 'sg-clock-weather', '☀ 晴');
    clockTimeCol.appendChild(clockTime);
    clockTimeCol.appendChild(clockWeather);
    clockTop.appendChild(dialWrap);
    clockTop.appendChild(clockTimeCol);
    var clockMoney = el('div', 'sg-clock-money');
    clockMoney.appendChild(svgIcon('shard'));
    var clockMoneyVal = el('b', null, '0');
    clockMoney.appendChild(clockMoneyVal);
    clockMoney.appendChild(el('span', 'sg-clock-g', 'g'));
    var clockXy = el('div', 'sg-clock-xy-row');
    clockXy.appendChild(el('span', 'sg-clock-xy-label', '学元'));
    clockXy.appendChild(el('span', 'sg-clock-xy', '0.00'));
    clockPanel.appendChild(clockTop);
    clockPanel.appendChild(clockMoney);
    clockPanel.appendChild(clockXy);
    root.appendChild(clockPanel);

    // v4.13 体力环：SVG 圆环包住体力图标（星露谷能量环同形态）
    var staminaBox = el('div', 'sg-stamina');
    var NSY = 'http://www.w3.org/2000/svg';
    var stamSvg = document.createElementNS(NSY, 'svg');
    stamSvg.setAttribute('viewBox', '0 0 40 40');
    stamSvg.setAttribute('class', 'sg-stamina-arc');
    var stamBg = document.createElementNS(NSY, 'circle');
    stamBg.setAttribute('cx', '20'); stamBg.setAttribute('cy', '20'); stamBg.setAttribute('r', '16');
    stamBg.setAttribute('fill', 'rgba(8, 14, 28, 0.82)');
    stamBg.setAttribute('stroke', 'rgba(255,255,255,0.14)');
    stamBg.setAttribute('stroke-width', '4');
    var stamFg = document.createElementNS(NSY, 'circle');
    stamFg.setAttribute('cx', '20'); stamFg.setAttribute('cy', '20'); stamFg.setAttribute('r', '16');
    stamFg.setAttribute('fill', 'none');
    stamFg.setAttribute('stroke', '#ffcf7a');
    stamFg.setAttribute('stroke-width', '4');
    stamFg.setAttribute('stroke-linecap', 'round');
    stamFg.setAttribute('stroke-dasharray', '100.5');
    stamFg.setAttribute('stroke-dashoffset', '0');
    stamFg.setAttribute('transform', 'rotate(-90 20 20)');
    stamSvg.appendChild(stamBg);
    stamSvg.appendChild(stamFg);
    staminaBox.appendChild(stamSvg);
    var staminaIco = el('div', 'sg-stamina-ico');
    staminaIco.appendChild(svgIcon('spark'));
    staminaBox.appendChild(staminaIco);
    root.appendChild(staminaBox);

    var toolbar = el('div', 'sg-toolbar');
    var toolDefs = [
      { key: 'till',   icon: 'gather', label: '锄头' },
      { key: 'water',  icon: 'bottle', label: '水壶' },
      { key: 'sow',    icon: 'flower', label: '种子' },
      { key: 'cut',    icon: 'flag',   label: '镰刀' },
      { key: 'chop',   icon: 'tree',   label: '斧头' },
      { key: 'mine',   icon: 'spark',  label: '矿镐' }
    ];
    var toolBtns = {};
    for (var ti = 0; ti < toolDefs.length; ti++) {
      (function(def) {
        var b = el('button', 'sg-tool');
        b.type = 'button';
        b.setAttribute('aria-label', def.label);
        b.appendChild(svgIcon(def.icon));
        var nm = el('span', 'sg-tool-name', def.label);
        b.appendChild(nm);
        b.addEventListener('click', function() { useTool(def.key); });
        toolbar.appendChild(b);
        toolBtns[def.key] = b;
      })(toolDefs[ti]);
    }
    root.appendChild(toolbar);

    root.appendChild(hud);
    root.appendChild(stage);

    // ---------- 底部面板 ----------
    var sheet = el('div', 'sg-sheet');
    var sheetDim = el('div', 'sg-sheet-dim');
    var sheetPanel = el('div', 'sg-sheet-panel');
    var sheetGrab = el('div', 'sg-sheet-grab');
    var sheetHead = el('div', 'sg-sheet-head');
    var sheetTitle = el('div', 'sg-sheet-title');
    var sheetClose = el('button', 'sg-sheet-close');
    sheetClose.type = 'button';
    sheetClose.setAttribute('aria-label', '关闭');
    sheetClose.appendChild(svgIcon('close'));
    sheetHead.appendChild(sheetTitle);
    sheetHead.appendChild(sheetClose);
    var sheetBody = el('div', 'sg-sheet-body');
    sheetPanel.appendChild(sheetGrab);
    sheetPanel.appendChild(sheetHead);
    sheetPanel.appendChild(sheetBody);
    sheet.appendChild(sheetDim);
    sheet.appendChild(sheetPanel);
    sheet.hidden = true;

    // ---------- 居中弹窗（世界地图 / 明信片） ----------
    var modal = el('div', 'sg-modal');
    var modalCard = el('div', 'sg-modal-card');
    modal.appendChild(modalCard);
    modal.hidden = true;

    // ---------- 新手引导 ----------
    var tutorial = el('div', 'sg-tutorial');
    var tSlides = [];
    var TUTORIAL_STEPS = [
      {
        icon: 'brand',
        title: '欢迎来到拾光群岛',
        text: '云海上漂着八座岛。天光被长夜收走了，全班要一起把它一点一点捡回来 —— 你点亮的每一寸，所有人都能看见。'
      },
      {
        icon: 'gather',
        title: '走 · 捡 · 点灯',
        text: '左下摇杆漫步（键盘 WASD 也行）。闪烁的菱形是星屑，站上去按「采集」。攒够 3 枚就能原地「点灯」，照亮一大圈迷雾。'
      },
      {
        icon: 'kite',
        title: '八座岛，慢慢逛',
        text: '码头上可以钓星、搭「纸鸢快线」跨岛；草地上能种花；石碑旁停下脚步读一读碑文。右上角打开「世界地图」，看看还有多少地方没有亮起来。'
      }
    ];
    for (var si = 0; si < TUTORIAL_STEPS.length; si++) {
      var slide = el('div', 'sg-t-slide' + (si === 0 ? ' is-on' : ''));
      var art = el('div', 'sg-t-art');
      art.appendChild(svgIcon(TUTORIAL_STEPS[si].icon));
      slide.appendChild(art);
      slide.appendChild(el('div', 'sg-t-title', TUTORIAL_STEPS[si].title));
      slide.appendChild(el('div', 'sg-t-text', TUTORIAL_STEPS[si].text));
      tutorial.appendChild(slide);
      tSlides.push(slide);
    }
    var tFoot = el('div', 'sg-t-foot');
    var tDots = el('div', 'sg-t-dots');
    var tDotEls = [];
    for (var di = 0; di < TUTORIAL_STEPS.length; di++) {
      var dot = el('i', 'sg-t-dot' + (di === 0 ? ' is-on' : ''));
      tDots.appendChild(dot);
      tDotEls.push(dot);
    }
    tFoot.appendChild(tDots);
    var tSkip = el('button', 'sg-t-skip', '跳过');
    tSkip.type = 'button';
    var tNext = el('button', 'sg-t-next', '下一步');
    tNext.type = 'button';
    var tBtnRow = el('div', 'sg-t-btns');
    tBtnRow.appendChild(tSkip);
    tBtnRow.appendChild(tNext);
    tFoot.appendChild(tBtnRow);
    tutorial.appendChild(tFoot);
    tutorial.hidden = true;

    // ---------- NPC 对话 ----------
    // 底部居中的对话卡：左边一个字牌，右边名字/身份/台词。
    // 位置刻意避开左下摇杆和右下动作键，1200 宽以上时正好落在两者之间的空档。
    var talkBox = el('div', 'sg-talk');
    talkBox.hidden = true;
    var talkFace = el('div', 'sg-talk-face', '');
    var talkCol = el('div', 'sg-talk-col');
    var talkName = el('div', 'sg-talk-name', '');
    var talkRole = el('div', 'sg-talk-role', '');
    var talkText = el('div', 'sg-talk-text', '');
    talkCol.appendChild(talkName);
    talkCol.appendChild(talkRole);
    talkCol.appendChild(talkText);
    var talkMore = el('div', 'sg-talk-more', '继续');
    talkBox.appendChild(talkFace);
    talkBox.appendChild(talkCol);
    talkBox.appendChild(talkMore);

    root.appendChild(sheet);
    root.appendChild(modal);
    root.appendChild(tutorial);
    root.appendChild(talkBox);
    container.appendChild(root);

    // ---------- HTTP ----------
    function http(method, path, body) {
      if (!api) return Promise.reject(new Error('SDK 不可用'));
      path = String(path).replace(/^\/api(?=\/)/, '');
      var call;
      try {
        call = method === 'get' ? api.get(path) : api.post(path, body);
      } catch (e) {
        return Promise.reject(e);
      }
      if (!call || typeof call.then !== 'function') return Promise.reject(new Error('请求失败'));
      return call.then(function(res) {
        var envelope = res && res.data ? res.data : null;
        if (!envelope) return null;
        var code = envelope.code;
        if (code && code !== 200 && code !== 201) {
          var err = new Error(envelope.message || '请求失败');
          err.code = code;
          throw err;
        }
        return envelope.data;
      }, function(err) {
        if (err && err.business && err.business.message) {
          var e2 = new Error(err.business.message);
          e2.code = err.business.code;
          throw e2;
        }
        throw err;
      });
    }

    // ---------- 提示 ----------
    var toastTimer = 0;
    function toast(text, kind) {
      if (!text) return;
      toastBox.textContent = text;
      toastBox.className = 'sg-toast is-show' + (kind ? ' sg-toast-' + kind : '');
      if (toastTimer) clearTimeout(toastTimer);
      toastTimer = setTimeout(function() {
        toastBox.className = 'sg-toast';
      }, 2600);
    }
    onDestroy(function() { if (toastTimer) clearTimeout(toastTimer); });

    function showBanner(iconName, main, sub, tone, ms) {
      clearNode(bannerIco);
      bannerIco.appendChild(svgIcon(iconName));
      bannerMain.textContent = main;
      bannerSub.textContent = sub || '';
      banner.className = 'sg-banner is-show' + (tone ? ' sg-banner-' + tone : '');
      if (bannerTimer) clearTimeout(bannerTimer);
      bannerTimer = setTimeout(function() { banner.className = 'sg-banner'; }, ms || 5200);
    }
    onDestroy(function() { if (bannerTimer) clearTimeout(bannerTimer); });

    function announce(title, desc) {
      dawnTitle.textContent = title;
      dawnDesc.textContent = desc || '';
      dawnFx.className = 'sg-dawn-fx is-show';
      // 天象推进是全服级别的大事，必须「撞」一次：
      // 镜头拉远（让人看到更大的天）+ 强震动（重量）+ 满屏上升光粒（规模）。
      // 只弹一张卡片，读起来是系统通知；加了这三层，才像世界变了。
      camPunch(0.955, 1500);
      camShake(9.0);
      var gx = (meFx > 0 ? meFx : state.me.x + 0.5);
      var gy = (meFy > 0 ? meFy : state.me.y + 0.5);
      for (var i = 0; i < 40; i++) {
        var a = Math.random() * 6.2832;
        var d = 1.4 + Math.random() * 3.6;
        parts.push({
          x: gx + Math.cos(a) * d,
          y: gy + Math.sin(a) * d * 0.62,
          vx: Math.cos(a) * 0.10,
          vy: -0.9 - Math.random() * 1.8,
          g: -0.5,
          life: 0,
          max: 1.6 + Math.random() * 1.6,
          r: 0.030 + Math.random() * 0.040,
          cr: 255, cg: 226, cb: 178
        });
      }
      if (parts.length > 460) parts.splice(0, parts.length - 460);
      setTimeout(function() { dawnFx.className = 'sg-dawn-fx'; }, 4200);
    }
    onDestroy(function() { dawnFx.className = 'sg-dawn-fx'; });

    // ---------- 视口 ----------
    // 市场应用是被宿主异步挂载的，mount 当下容器可能是 0×0 —— 必须
    // ResizeObserver 跟随 + 低频兜底轮询。
    function resize() {
      var w = stage.clientWidth;
      var h = stage.clientHeight;
      if (!w || !h) return;
      var dpr = Math.min(2, window.devicePixelRatio || 1);
      var px = Math.round(w * dpr);
      var py = Math.round(h * dpr);
      if (px === canvas.width && py === canvas.height && view.w === w) return;
      canvas.width = px;
      canvas.height = py;
      canvas.style.width = w + 'px';
      canvas.style.height = h + 'px';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      view.w = w;
      view.h = h;
      view.dpr = dpr;
      // 可见 27 格宽 × 17 格高：大世界下这个视野既有纵深又不至于太小
      // 可见 27 格宽 × 22 格高。
      // 17 格高的时候，站在出生点 (80,98) 看不见北边 18 格外的灯塔 ——
      // 画面里没有任何「该看的地方」，只有一片草。
      // 22 格高之后灯塔进画面，旋转光束成了天然的视觉锚点。
      var t = Math.min(w / 27, h / 22);
      view.tile = Math.max(24, Math.min(48, t));
      if (stickBox) stickBox.r = 0;
    }

    // ---------- §6 渲染 ----------
    //
    // 画法总述（v1/v2 已验证的管线，v3 扩展而不替换）：
    //   1. 子像素世界底图：地形掩膜 → 盒式模糊 → 连续场取色，海岸线脱离格子网格；
    //      v3 新增：逐格岛号 → 生态调色板，八座岛各有各的底色性格；
    //   2. 高频细节（草叶、砂点、石板路）由 1:1 矢量笔画负责；
    //      Kenney 瓦片道具（树 / 建筑 / 火盆 / 围栏）走 drawImage 精灵层；
    //   3. 雾：子像素 alpha 图 + 3×3 均值模糊。
    var FIELD_SUB_HQ = 12;
    var FIELD_SUB_STD = 8;
    var fieldCanvas = null;
    var fieldReady = false;
    var AVATAR_SCALE = 1.42;
    var WARP_AMP = 0.9;

    // 逐格岛号：底图烘焙前按地形推一次，比逐像素找岛便宜两个数量级。
    // 桥/码头/云海记 255（无岛），生态调色板用回退值。
    var tileIsle = null;

    function buildTileIsle() {
      var size = state.size;
      tileIsle = new Uint8Array(size * size);
      var isles = state.catalog.islands || [];
      for (var y = 0; y < size; y++) {
        for (var x = 0; x < size; x++) {
          var code = state.cells.charCodeAt(y * size + x) - 48;
          if (code === T_CLOUD || code === T_DOCK) { tileIsle[y * size + x] = 255; continue; }
          var best = 255;
          var bestD = 1e9;
          for (var i = 0; i < isles.length; i++) {
            var dx = x - isles[i].cx;
            var dy = y - isles[i].cy;
            var d = dx * dx + dy * dy;
            if (d < bestD) { bestD = d; best = i; }
          }
          tileIsle[y * size + x] = best;
        }
      }
    }

    function biomeOf(isleIdx) {
      var isles = state.catalog.islands || [];
      var isle = isles[isleIdx];
      if (!isle || !BIOME_PALETTES[isle.biome]) return BIOME_FALLBACK;
      return BIOME_PALETTES[isle.biome];
    }

    function boxBlur(src, W, r) {
      var tmp = new Float32Array(W * W);
      var out = new Float32Array(W * W);
      var inv = 1 / (r * 2 + 1);
      var x, y, i, sum;
      for (y = 0; y < W; y++) {
        var row = y * W;
        for (x = 0; x < W; x++) {
          sum = 0;
          for (i = -r; i <= r; i++) {
            var xx = x + i;
            if (xx < 0) xx = 0; else if (xx >= W) xx = W - 1;
            sum += src[row + xx];
          }
          tmp[row + x] = sum * inv;
        }
      }
      for (x = 0; x < W; x++) {
        for (y = 0; y < W; y++) {
          sum = 0;
          for (i = -r; i <= r; i++) {
            var yy = y + i;
            if (yy < 0) yy = 0; else if (yy >= W) yy = W - 1;
            sum += tmp[yy * W + x];
          }
          out[y * W + x] = sum * inv;
        }
      }
      return out;
    }

    // 码头不算陆地（栈道架在云海上，水从板缝里透出来）；石板路算陆地、
    // 材质记到 sand 通道里 —— 底图给它一个偏暖的浅色，矢量层再铺砖缝。
    var MASK_SUB = 4;
    var maskW = 0;
    var maskLand = null;
    var maskMeadow = null;
    var maskSand = null;
    var maskStone = null;
    var maskPath = null;
    var maskLake = null;

    function buildMasks() {
      var size = state.size;
      var M = size * MASK_SUB;
      maskW = M;
      var land = new Float32Array(M * M);
      var mead = new Float32Array(M * M);
      var sand = new Float32Array(M * M);
      var stone = new Float32Array(M * M);
      var path = new Float32Array(M * M);
      var lake = new Float32Array(M * M);
      var x, y, sx, sy, code, rowOff, idx;
      for (y = 0; y < size; y++) {
        for (x = 0; x < size; x++) {
          code = state.cells.charCodeAt(y * size + x) - 48;
          if (code === T_DOCK) code = T_CLOUD;
          if (!(code >= 1 && code <= 6)) code = T_CLOUD;
          for (sy = 0; sy < MASK_SUB; sy++) {
            rowOff = (y * MASK_SUB + sy) * M + x * MASK_SUB;
            for (sx = 0; sx < MASK_SUB; sx++) {
              idx = rowOff + sx;
              land[idx] = 1;
              // 石板路必须单独一路：和沙地共用通道时，底图给它的是暖米色，
              // 在夜色里就铺出一条全屏最亮的水泥公路 —— 那是画面里最刺眼的东西。
              if (code === T_PATH) path[idx] = 1;
              else if (code === T_SAND) sand[idx] = 1;
              else if (code === T_STONE) stone[idx] = 1;
              else if (code === T_LAKE) lake[idx] = 1;
              else mead[idx] = 1;
            }
          }
        }
      }
      maskLand = boxBlur(boxBlur(land, M, 4), M, 4);
      maskMeadow = boxBlur(mead, M, 1);
      maskSand = boxBlur(sand, M, 1);
      maskStone = boxBlur(stone, M, 1);
      // 路不糊：石板是硬边，糊了就成一条软渐变带（就是「褐色带」那个坑）
      // 路要「一点点」软边。
      // 硬 0/1 的边界是逐格直角台阶 —— 一条「锯齿公路」，比直边更假。
      // 半径 3（sub=4 时约 0.75 格）只影响交界带，真正做出毛边的是取色阶段的噪声侵蚀。
      maskPath = boxBlur(path, M, 2);
      maskLake = boxBlur(lake, M, 1);
    }

    function sampleMask(arr, wx, wy) {
      var gx = wx * MASK_SUB - 0.5;
      var gy = wy * MASK_SUB - 0.5;
      var x0 = Math.floor(gx);
      var y0 = Math.floor(gy);
      if (x0 < 0) x0 = 0; else if (x0 > maskW - 2) x0 = maskW - 2;
      if (y0 < 0) y0 = 0; else if (y0 > maskW - 2) y0 = maskW - 2;
      var fx = gx - x0;
      var fy = gy - y0;
      if (fx < 0) fx = 0; else if (fx > 1) fx = 1;
      if (fy < 0) fy = 0; else if (fy > 1) fy = 1;
      var i = y0 * maskW + x0;
      var a = arr[i], b = arr[i + 1], c = arr[i + maskW], d = arr[i + maskW + 1];
      var top = a + (b - a) * fx;
      var bot = c + (d - c) * fx;
      return top + (bot - top) * fy;
    }

    var fieldJob = null;
    var fieldRaf = 0;

    function makeFieldJob(sub) {
      var W = state.size * sub;
      var cv = document.createElement('canvas');
      cv.width = W;
      cv.height = W;
      var fc = cv.getContext('2d');
      var img = fc.createImageData(W, W);
      return { cv: cv, fc: fc, img: img, data: img.data, W: W, sub: sub, py: 0 };
    }

    function finishFieldJob(job) {
      job.fc.putImageData(job.img, 0, 0);
      return job.cv;
    }

    // 云海三段色（无岛区域的深海）
    var SEA_DEEP = [14, 24, 46];
    var SEA_TOP = [76, 100, 138];
    var SEA_CREST = [132, 162, 202];

    function renderFieldRows(job, budgetMs) {
      var sub = job.sub;
      var W = job.W;
      var data = job.data;
      var deadline = budgetMs > 0 ? Date.now() + budgetMs : 0;
      var size = state.size;

      while (job.py < W) {
        var py = job.py;
        var wy0 = (py + 0.5) / sub;
        for (var px = 0; px < W; px++) {
          var wx0 = (px + 0.5) / sub;
          var wwx = wx0 + (vnoise(wx0, wy0, 3.2, 61) - 0.5) * WARP_AMP;
          var wwy = wy0 + (vnoise(wx0, wy0, 3.2, 67) - 0.5) * WARP_AMP;

          var landF = sampleMask(maskLand, wwx, wwy);
          var r = 0, g = 0, b = 0;

          if (landF > 0.36) {
            // 生态调色：子像素落在哪一格，就用那一格的岛号取调色板
            var tx = clamp(Math.floor(wwx), 0, size - 1);
            var ty = clamp(Math.floor(wwy), 0, size - 1);
            var pal = biomeOf(tileIsle ? tileIsle[ty * size + tx] : 255);

            var mw = sampleMask(maskMeadow, wwx, wwy);
            var sw = sampleMask(maskSand, wwx, wwy);
            var kw = sampleMask(maskStone, wwx, wwy);
            if (kw < 0.02 && sw > 0.015 && sw < 0.985) {
              var nth = vnoise(wx0, wy0, 0.34, 401) * 0.68
                      + vnoise(wx0, wy0, 0.14, 403) * 0.32;
              sw = (sw - nth) * 7 + 0.5;
              if (sw < 0) sw = 0; else if (sw > 1) sw = 1;
              mw = 1 - sw;
            }
            var tot = mw + sw + kw;
            if (tot < 0.0001) { mw = 1; sw = 0; kw = 0; tot = 1; }
            mw /= tot; sw /= tot; kw /= tot;

            var light = 0.50
                      + (vnoise(wx0, wy0, 10.5, 205) - 0.5) * 0.92
                      + (vnoise(wx0, wy0, 3.6, 21) - 0.5) * 0.50
                      + (vnoise(wx0, wy0, 1.1, 29) - 0.5) * 0.26;
            light *= 0.76 + landF * 0.24;
            if (light < 0) light = 0; else if (light > 1) light = 1;

            var MD_R = pal.shd[0], MD_G = pal.shd[1], MD_B = pal.shd[2];
            var ML_R = pal.lit[0], ML_G = pal.lit[1], ML_B = pal.lit[2];
            // ⚠️ 沙地必须有自己的通道。上一版借的是 pathLit（暖米色），
            // 结果 27% 的陆地变成全屏最亮的暖块，把灯全压下去了。
            var SD_R = pal.sandShd[0], SD_G = pal.sandShd[1], SD_B = pal.sandShd[2];
            var SL_R = pal.sandLit[0], SL_G = pal.sandLit[1], SL_B = pal.sandLit[2];
            var KD_R = pal.stShd[0], KD_G = pal.stShd[1], KD_B = pal.stShd[2];
            var KL_R = pal.stLit[0], KL_G = pal.stLit[1], KL_B = pal.stLit[2];

            r = (MD_R * mw + SD_R * sw + KD_R * kw)
              + ((ML_R * mw + SL_R * sw + KL_R * kw) - (MD_R * mw + SD_R * sw + KD_R * kw)) * light;
            g = (MD_G * mw + SD_G * sw + KD_G * kw)
              + ((ML_G * mw + SL_G * sw + KL_G * kw) - (MD_G * mw + SD_G * sw + KD_G * kw)) * light;
            b = (MD_B * mw + SD_B * sw + KD_B * kw)
              + ((ML_B * mw + SL_B * sw + KL_B * kw) - (MD_B * mw + SD_B * sw + KD_B * kw)) * light;

            // 石板路：冷青灰，比草地略亮一点点、偏蓝。
            // 它必须「可读」但不许抢戏 —— 路是引导线，不是主角。
            var pw = sampleMask(maskPath, wwx, wwy);
            if (pw > 0.01) {
              // 边缘侵蚀：土路是被脚踩出来的，边缘永远毛糙。
              // 只在过渡带上做，内部保持实心，不然路会碎成沙。
              var pk = pw;
              if (pk < 0.85) {
                var pn = vnoise(wx0 * 0.9, wy0 * 0.9, 1.4, 437);
                pk = sstep(0.10, 0.88, pk + (pn - 0.5) * 0.62);
              }
              if (pk > 1) pk = 1;
              // 土径：暖褐，明度与草地接近，靠**色相**区分而不是靠亮度。
              // 上一版是冷青灰且比草地亮 —— 夜里读起来是一条水泥公路。
              var pv = 0.50 + (vnoise(wx0, wy0, 1.6, 431) - 0.5) * 0.60;
              var pr2 = pal.pathShd[0] + (pal.pathLit[0] - pal.pathShd[0]) * pv;
              var pg2 = pal.pathShd[1] + (pal.pathLit[1] - pal.pathShd[1]) * pv;
              var pb2 = pal.pathShd[2] + (pal.pathLit[2] - pal.pathShd[2]) * pv;
              // 横缝：每 0.9 格一道暗线，石板才有「铺」的感觉
              if (((wy0 * 1.1) % 1) > 0.94) { pr2 *= 0.72; pg2 *= 0.72; pb2 *= 0.72; }
              r = r * (1 - pk) + pr2 * pk;
              g = g * (1 - pk) + pg2 * pk;
              b = b * (1 - pk) + pb2 * pk;
            }

            // 岛内静水。必须比草地暗一档、几乎不反光 ——
            // 一亮就变成贴在地上的一块玻璃。
            var lw = sampleMask(maskLake, wwx, wwy);
            if (lw > 0.01) {
              var lk = lw > 1 ? 1 : lw;
              var lv = vnoise(wx0, wy0, 2.4, 457);
              var lr = 12 + lv * 10;
              var lg = 26 + lv * 12;
              var lb = 40 + lv * 16;
              // 镜面反射：频率很低、幅度很小的一条横向亮纹（天光倒影）
              var spec = vnoise(wx0 * 0.6, wy0 * 3.4, 1.1, 461);
              if (spec > 0.74) {
                var sp2 = (spec - 0.74) * 2.6;
                lr += sp2 * 26; lg += sp2 * 34; lb += sp2 * 42;
              }
              r = r * (1 - lk) + lr * lk;
              g = g * (1 - lk) + lg * lk;
              b = b * (1 - lk) + lb * lk;
            }

            var wet = (1 - sstep(0.36, 0.52, landF)) * sw;
            if (wet > 0.002) {
              var wk = 1 - wet * 0.36;
              r = r * wk;
              g = g * wk;
              b = b * wk + wet * 12;
            }
          }

          var water = 1 - sstep(0.40, 0.62, landF);
          if (water > 0.001) {
            var band = vnoise(wx0 * 0.42, wy0 * 1.50, 3.4, 311);
            var band2 = vnoise((wx0 - 0.85) * 0.42, (wy0 - 0.60) * 1.50, 3.4, 311);
            var puff = vnoise(wx0 * 0.92, wy0 * 1.20, 1.5, 313);
            var wisp = vnoise(wx0 * 1.4, wy0 * 2.1, 0.55, 317);
            var wisp2 = vnoise(wx0 * 2.2, wy0 * 3.0, 0.28, 319);
            var cl = band * 0.62 + puff * 0.24 + wisp * 0.10 + wisp2 * 0.04;
            var m = cl * cl * cl + (band - band2) * 1.55;
            if (m < 0) m = 0; else if (m > 1) m = 1;
            var crest = m > 0.48 ? (m - 0.48) * 2.4 : 0;
            crest = crest * crest;
            var sr = SEA_DEEP[0] + (SEA_TOP[0] - SEA_DEEP[0]) * m;
            var sg = SEA_DEEP[1] + (SEA_TOP[1] - SEA_DEEP[1]) * m;
            var sb = SEA_DEEP[2] + (SEA_TOP[2] - SEA_DEEP[2]) * m;
            sr += (SEA_CREST[0] - sr) * crest * 0.42;
            sg += (SEA_CREST[1] - sg) * crest * 0.42;
            sb += (SEA_CREST[2] - sb) * crest * 0.42;

            var shade = sstep(0.20, 0.34, landF) * (1 - sstep(0.40, 0.50, landF));
            shade *= 0.55 + vnoise(wx0, wy0, 2.4, 331) * 0.9;
            var dim = 1 - shade * 0.55;
            sr *= dim; sg *= dim; sb *= dim;

            r += (sr - r) * water;
            g += (sg - g) * water;
            b += (sb - b) * water;
          }

          if (water > 0.03 && water < 0.97) {
            var foam = water * (1 - water) * 4;
            foam = foam * foam * (0.30 + vnoise(wwx, wwy, 1.35, 271) * 0.90);
            r += foam * 56; g += foam * 68; b += foam * 78;
          }

          var o = (py * W + px) * 4;
          data[o] = r > 255 ? 255 : (r < 0 ? 0 : r) | 0;
          data[o + 1] = g > 255 ? 255 : (g < 0 ? 0 : g) | 0;
          data[o + 2] = b > 255 ? 255 : (b < 0 ? 0 : b) | 0;
          data[o + 3] = 255;
        }
        job.py++;
        if (deadline && Date.now() > deadline) break;
      }
      return job.py < W;
    }

    function stepFieldJob() {
      fieldRaf = 0;
      if (!fieldJob) return;
      if (renderFieldRows(fieldJob, 8)) {
        fieldRaf = window.requestAnimationFrame(stepFieldJob);
      } else {
        fieldCanvas = finishFieldJob(fieldJob);
        fieldJob = null;
        fieldReady = true;
      }
    }

    function buildField() {
      if (!state.cells || state.cells.length < state.size * state.size) return;
      if (fieldRaf) { window.cancelAnimationFrame(fieldRaf); fieldRaf = 0; }
      fieldJob = null;
      buildTileIsle();
      buildMasks();
      var low = makeFieldJob(4);
      renderFieldRows(low, 0);
      fieldCanvas = finishFieldJob(low);
      fieldReady = true;
      fieldJob = makeFieldJob(prefs.hq ? FIELD_SUB_HQ : FIELD_SUB_STD);
      stepFieldJob();
    }

    function viewRect(ox, oy, t) {
      var span = state.size * t;
      var vx0 = Math.max(0, -ox);
      var vy0 = Math.max(0, -oy);
      var vx1 = Math.min(span, view.w - ox);
      var vy1 = Math.min(span, view.h - oy);
      if (vx1 <= vx0 || vy1 <= vy0) return null;
      return { x: vx0, y: vy0, w: vx1 - vx0, h: vy1 - vy0, span: span };
    }

    function drawTerrainLayer(ox, oy, t) {
      if (!fieldReady) return;
      var v = viewRect(ox, oy, t);
      if (!v) return;
      var fw = fieldCanvas.width;
      var k = fw / v.span;
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(
        fieldCanvas,
        v.x * k, v.y * k, v.w * k, v.h * k,
        ox + v.x, oy + v.y, v.w, v.h
      );
    }

    // 海面动画：贴着水面的碎光 + 缓慢漂移的云影。只画水格。
    function drawSeaFx(ox, oy, t, now, x0, x1, y0, y1, size) {
      var n = 0;
      for (var y = y0; y <= y1 && n < 26; y++) {
        for (var x = x0; x <= x1 && n < 26; x++) {
          if (x < 0 || y < 0 || x >= size || y >= size) continue;
          if (state.cells.charCodeAt(y * size + x) !== 48) continue;
          if (hash2(x, y, 811) > 0.22) continue;
          var ph = hash2(x, y, 813) * 6.283;
          var tw = 0.5 + 0.5 * Math.sin(now * 0.0016 + ph);
          if (tw < 0.35) continue;
          var sx = ox + (x + hash2(x, y, 817)) * t;
          var sy = oy + (y + hash2(x, y, 819)) * t;
          ctx.fillStyle = 'rgba(190, 220, 255, ' + (0.22 * tw).toFixed(3) + ')';
          ctx.fillRect(sx, sy + t * 0.4, Math.max(1.5, t * 0.10), Math.max(1, t * 0.03));
          n++;
        }
      }
      // 两道缓慢漂移的云影
      for (var b = 0; b < 2; b++) {
        var span = state.size * t;
        var bx = ((now * (0.006 + b * 0.004)) % (span + 400)) - 200;
        var by = span * (0.25 + b * 0.4) + Math.sin(now * 0.0001 + b) * 60;
        var sx2 = ox + bx;
        var sy2 = oy + by;
        if (sx2 > view.w + 300 || sy2 > view.h + 300) continue;
        var rad = 180 + b * 120;
        var gr = ctx.createRadialGradient(sx2, sy2, 0, sx2, sy2, rad);
        gr.addColorStop(0, 'rgba(6, 10, 22, 0.12)');
        gr.addColorStop(1, 'rgba(6, 10, 22, 0)');
        ctx.fillStyle = gr;
        ctx.fillRect(sx2 - rad, sy2 - rad, rad * 2, rad * 2);
      }
    }

    // 雾层：子像素 alpha 图 + 3×3 均值模糊（v1/v2 已验证管线）
    var FOG_SUB = 4;
    var fogCanvas = null;
    var fogCtx = null;
    var fogStamp = -1;
    var fogNoiseTab = null;

    function buildFogNoise(W) {
      var tab = new Uint8Array(W * W);
      for (var py = 0; py < W; py++) {
        var wy0 = (py + 0.5) / FOG_SUB;
        for (var px = 0; px < W; px++) {
          var wx0 = (px + 0.5) / FOG_SUB;
          var a = vnoise(wx0, wy0, 2.6, 53) * 0.58 + vnoise(wx0, wy0, 0.9, 57) * 0.42;
          tab[py * W + px] = (a * 255) | 0;
        }
      }
      return tab;
    }

    function ensureFogLayer() {
      var size = state.size;
      var W = size * FOG_SUB;
      if (!fogCanvas || fogCanvas.width !== W) {
        fogCanvas = document.createElement('canvas');
        fogCanvas.width = W;
        fogCanvas.height = W;
        fogCtx = fogCanvas.getContext('2d');
        fogNoiseTab = buildFogNoise(W);
        fogStamp = -1;
      }
      if (fogStamp === state.exploreVer) return;
      fogStamp = state.exploreVer;

      var explored = state.explored;
      function seenAt(wx, wy) {
        var cx = Math.floor(wx);
        var cy = Math.floor(wy);
        if (cx < 0 || cy < 0 || cx >= size || cy >= size) return 0;
        return explored && explored[cy * size + cx] ? 1 : 0;
      }

      var img = fogCtx.createImageData(W, W);
      var d = img.data;
      var raw = new Uint8Array(W * W);
      var cr = new Uint8Array(W * W);
      var cg = new Uint8Array(W * W);
      var cb = new Uint8Array(W * W);
      var R = 1.25;
      for (var py = 0; py < W; py++) {
        var wy0 = (py + 0.5) / FOG_SUB;
        for (var px = 0; px < W; px++) {
          var wx0 = (px + 0.5) / FOG_SUB;
          var wwx = wx0 + (vnoise(wx0, wy0, 3.2, 61) - 0.5) * WARP_AMP;
          var wwy = wy0 + (vnoise(wx0, wy0, 3.2, 67) - 0.5) * WARP_AMP;

          var score = (seenAt(wwx, wwy)
                     + seenAt(wwx + R, wwy) + seenAt(wwx - R, wwy)
                     + seenAt(wwx, wwy + R) + seenAt(wwx, wwy - R)) * 0.2;

          var alpha, rr = 16, gg = 20, bb = 40;
          if (score >= 0.999) {
            alpha = 0;
          } else {
            var dn = fogNoiseTab[py * W + px] / 255;
            var edge = 1 - score + (dn - 0.5) * 0.50;
            if (edge < 0) edge = 0;
            alpha = (96 + edge * 460) | 0;
            if (alpha > 248) alpha = 248;

            var cl = dn * dn;
            rr = 15 + cl * 44;
            gg = 19 + cl * 50;
            bb = 38 + cl * 72;
            var rim = 1 - Math.min(1, Math.abs(score - 0.58) / 0.34);
            if (rim > 0) {
              rr += rim * 52;
              gg += rim * 60;
              bb += rim * 70;
            }
          }
          raw[py * W + px] = alpha;
          cr[py * W + px] = rr > 255 ? 255 : rr;
          cg[py * W + px] = gg > 255 ? 255 : gg;
          cb[py * W + px] = bb > 255 ? 255 : bb;
        }
      }

      for (var by = 0; by < W; by++) {
        var y0 = by > 0 ? by - 1 : 0;
        var y2 = by + 1 < W ? by + 1 : W - 1;
        for (var bx = 0; bx < W; bx++) {
          var x0 = bx > 0 ? bx - 1 : 0;
          var x2 = bx + 1 < W ? bx + 1 : W - 1;
          var sum = raw[y0 * W + x0] + raw[y0 * W + bx] + raw[y0 * W + x2]
                  + raw[by * W + x0] + raw[by * W + bx] + raw[by * W + x2]
                  + raw[y2 * W + x0] + raw[y2 * W + bx] + raw[y2 * W + x2];
          var o2 = (by * W + bx) * 4;
          var o1 = by * W + bx;
          d[o2] = cr[o1];
          d[o2 + 1] = cg[o1];
          d[o2 + 2] = cb[o1];
          d[o2 + 3] = (sum / 9) | 0;
        }
      }
      fogCtx.putImageData(img, 0, 0);
    }

    function drawFogLayer(ox, oy, t) {
      if (!state.explored) {
        ctx.fillStyle = '#0a1122';
        ctx.fillRect(0, 0, view.w, view.h);
        return;
      }
      ensureFogLayer();
      var v = viewRect(ox, oy, t);
      if (!v) return;
      var fw = fogCanvas.width;
      var k = fw / v.span;
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(
        fogCanvas,
        v.x * k, v.y * k, v.w * k, v.h * k,
        ox + v.x, oy + v.y, v.w, v.h
      );
    }

    // ---------- 地面碎笔（草叶 / 砂点） ----------
    // 风。草簇每帧重画，所以只要把「尖端」按时间偏移一点，
    // 整片草地就会慢慢起伏 —— 这是让静态地图「活起来」最便宜的一招：
    // 不加任何物件，只让已有的线动起来。
    var groundNow = 0;

    function collectGround(x, y, sx, sy, t, pGrassA, pGrassB, pSandA, pSandB, pRipple) {
      if (!state.explored || !state.explored[y * state.size + x]) return;
      var code = state.cells.charCodeAt(y * state.size + x) - 48;
      var n = hash2(x, y, 89);

      if (code === T_MEADOW) {
        if (n < 0.62) {
          var cxp = sx + t * (0.10 + hash2(x, y, 17) * 0.62);
          var cyp = sy + t * (0.38 + hash2(x, y, 19) * 0.40);
          var hgt = t * (0.065 + hash2(x, y, 23) * 0.125);
          var sp1 = t * (0.020 + hash2(x, y, 43) * 0.030);
          var sp2 = t * (0.040 + hash2(x, y, 47) * 0.032);
          // 每格一个相位：风不是整片一起摆，而是像麦浪一样从一边推过去。
          // 相位系数取 0.55 / 0.33（互质感），避免出现规整的斜条纹。
          var sway = Math.sin(groundNow * 0.0013 + x * 0.55 + y * 0.33) * t * 0.020;
          var lean = t * (hash2(x, y, 53) - 0.5) * 0.05 + sway;
          pGrassA.moveTo(cxp, cyp); pGrassA.lineTo(cxp - sp1 + lean, cyp - hgt);
          pGrassA.moveTo(cxp + sp2, cyp + t * 0.02); pGrassA.lineTo(cxp + sp2 + lean, cyp - hgt * 0.74);
          pGrassA.moveTo(cxp - sp2, cyp + t * 0.03); pGrassA.lineTo(cxp - sp2 - sp1 + lean, cyp - hgt * 0.56);
        }
        if (n < 0.34) {
          var cxp2 = sx + t * (0.18 + hash2(x, y, 31) * 0.64);
          var cyp2 = sy + t * (0.30 + hash2(x, y, 37) * 0.46);
          var hgt2 = t * (0.06 + hash2(x, y, 41) * 0.09);
          var sway2 = Math.sin(groundNow * 0.0011 + x * 0.61 + y * 0.29) * t * 0.024;
          pGrassB.moveTo(cxp2, cyp2); pGrassB.lineTo(cxp2 + t * 0.026 + sway2, cyp2 - hgt2);
          pGrassB.moveTo(cxp2 + t * 0.048, cyp2 + t * 0.02); pGrassB.lineTo(cxp2 + t * 0.070 + sway2, cyp2 - hgt2 * 0.62);
        }
      } else if (code === T_SAND) {
        var s1 = hash2(x, y, 161);
        var s2 = hash2(x, y, 163);
        var s3 = hash2(x, y, 167);
        var s4 = hash2(x, y, 169);
        pSandA.rect(sx + t * (0.06 + s1 * 0.86), sy + t * (0.06 + s2 * 0.86),
                    Math.max(1, t * 0.052), Math.max(1, t * 0.044));
        pSandA.rect(sx + t * (0.06 + s3 * 0.86), sy + t * (0.06 + s4 * 0.86),
                    Math.max(1, t * 0.038), Math.max(1, t * 0.034));
        pSandB.rect(sx + t * (0.06 + s4 * 0.86), sy + t * (0.06 + s1 * 0.86),
                    Math.max(1, t * 0.048), Math.max(1, t * 0.040));
        pSandB.rect(sx + t * (0.06 + s1 * 0.86), sy + t * (0.06 + s3 * 0.86),
                    Math.max(1, t * 0.034), Math.max(1, t * 0.030));
        if (n < 0.42) {
          var wx2 = sx + t * (0.10 + hash2(x, y, 103) * 0.34);
          var wy2 = sy + t * (0.40 + hash2(x, y, 105) * 0.32);
          pRipple.moveTo(wx2, wy2);
          pRipple.quadraticCurveTo(wx2 + t * 0.16, wy2 - t * 0.055, wx2 + t * 0.32, wy2 + t * 0.012);
        }
      }
    }

    // ---------- Kenney 道具层 ----------
    // 逐格确定性摆放：树成林、石成坡、路灯沿大道、作物成行。
    // 全部走 drawImage 瓦片精灵（关闭平滑，保持像素锐度）；
    // 瓦片没加载成功时自动跳过 —— 世界仍是完整的，只是少了像素摆件。

    // v4.5 星露谷：你的农舍就在出生点旁 —— 星露谷的「家」是循环的锚点
    var HOME_SIGN = { x: 81, y: 87 };
    // 启明岛的住宅：大道两侧四个院落（坐标与大道/广场错开）
    var HUB_HOUSES = [
      { x: 74, y: 82, style: 'red' },
      { x: 86, y: 82, style: 'gray' },
      { x: 74, y: 94, style: 'gray' },
      { x: 86, y: 94, style: 'red' }
    ];

    function isPathCell(x, y) {
      if (x < 0 || y < 0 || x >= state.size || y >= state.size) return false;
      return state.cells.charCodeAt(y * state.size + x) - 48 === T_PATH;
    }

    // 俯视双坡屋顶。
    //
    // 原来用 Kenney 的屋顶/墙瓦片拼 3×2 —— 那是「正面平视」的建筑瓦片，
    // 拼到俯视地图上就是两块贴着脸的方砖，在夜景里还是一块亮橙色的斑。
    // 俯视看到的房子只有三样东西：屋顶、屋脊、和一条很窄的南立面。
    // 颜色也必须压下来：月光下的红瓦是暗赭，不是朱红。
    function drawHouse(h, ox, oy, t) {
      var sx = ox + h.x * t;
      var sy = oy + h.y * t;
      var W = t * 2.55;
      var cx = sx + t * 1.25;
      var by = sy + t * 1.86;          // 房基
      var wallTop = by - t * 0.46;     // 檐口
      var ridge = sy + t * 0.34;       // 屋脊

      // 落影：整体往右下甩，和月光方向一致
      ctx.save();
      ctx.translate(cx + t * 0.30, by + t * 0.06);
      ctx.scale(1, 0.34);
      var sg = ctx.createRadialGradient(0, 0, 0, 0, 0, W * 0.66);
      sg.addColorStop(0, 'rgba(3, 9, 13, 0.54)');
      sg.addColorStop(0.62, 'rgba(3, 9, 13, 0.22)');
      sg.addColorStop(1, 'rgba(3, 9, 13, 0)');
      ctx.fillStyle = sg;
      ctx.beginPath();
      ctx.arc(0, 0, W * 0.66, 0, 6.2832);
      ctx.fill();
      ctx.restore();

      var red = h.style === 'red';

      // ---- 南立面：俯视下只能看到一条窄墙，它决定房子的「厚度」 ----
      ctx.fillStyle = red ? '#3e2822' : '#2b313a';
      ctx.beginPath();
      ctx.moveTo(cx - W * 0.5, wallTop);
      ctx.lineTo(cx + W * 0.5, wallTop);
      ctx.lineTo(cx + W * 0.5, by);
      ctx.lineTo(cx - W * 0.5, by);
      ctx.closePath();
      ctx.fill();
      // 墙脚压暗，房子才「坐在」地上而不是浮着
      ctx.fillStyle = 'rgba(4, 8, 14, 0.46)';
      ctx.fillRect(cx - W * 0.5, by - t * 0.15, W, t * 0.15);

      // ---- 门窗：夜里唯一该亮的东西 ----
      var dw = W * 0.13;
      var dg = ctx.createRadialGradient(cx, wallTop + t * 0.20, 0, cx, wallTop + t * 0.20, t * 0.55);
      dg.addColorStop(0, 'rgba(255, 202, 132, 0.34)');
      dg.addColorStop(1, 'rgba(255, 202, 132, 0)');
      ctx.fillStyle = dg;
      ctx.beginPath();
      ctx.arc(cx, wallTop + t * 0.20, t * 0.55, 0, 6.2832);
      ctx.fill();
      ctx.fillStyle = 'rgba(255, 210, 146, 0.90)';
      ctx.fillRect(cx - dw * 0.5, wallTop + t * 0.07, dw, t * 0.30);

      // 侧窗两扇，更小更暗：窗光要有主次，全一样亮就成了一条灯带
      ctx.fillStyle = 'rgba(232, 178, 112, 0.52)';
      ctx.fillRect(cx - W * 0.38, wallTop + t * 0.10, dw * 0.8, t * 0.20);
      ctx.fillRect(cx + W * 0.30, wallTop + t * 0.10, dw * 0.8, t * 0.20);

      // ---- 屋顶：俯视看到的是一块从屋脊向两侧斜下的面 ----
      var rW = W * 0.40;               // 屋脊半长
      var litR = red ? [122, 62, 50] : [66, 76, 90];
      var shdR = red ? [70, 34, 30] : [36, 42, 52];
      var rg = ctx.createLinearGradient(0, ridge, 0, wallTop);
      rg.addColorStop(0, 'rgb(' + litR[0] + ',' + litR[1] + ',' + litR[2] + ')');
      rg.addColorStop(1, 'rgb(' + shdR[0] + ',' + shdR[1] + ',' + shdR[2] + ')');
      ctx.fillStyle = rg;
      ctx.beginPath();
      ctx.moveTo(cx - rW, ridge);
      ctx.lineTo(cx + rW, ridge);
      ctx.lineTo(cx + W * 0.5, wallTop);
      ctx.lineTo(cx - W * 0.5, wallTop);
      ctx.closePath();
      ctx.fill();

      // 瓦垄：竖向细线，间距随格子缩放。没有它，屋顶是一块纯色梯形，
      // 眼睛读到的是「一张纸片」，不是「一片盖着瓦的坡」。
      ctx.strokeStyle = 'rgba(10, 14, 20, 0.26)';
      ctx.lineWidth = Math.max(1, t * 0.014);
      var cols = 7;
      for (var c = 1; c < cols; c++) {
        var k = c / cols;
        var xT = cx - rW + rW * 2 * k;
        var xB = cx - W * 0.5 + W * k;
        ctx.beginPath();
        ctx.moveTo(xT, ridge);
        ctx.lineTo(xB, wallTop);
        ctx.stroke();
      }

      // 屋脊：一道窄亮边 + 一道窄暗边。它让屋顶「折」起来，是立体感的全部来源
      ctx.fillStyle = 'rgba(255, 238, 210, 0.16)';
      ctx.fillRect(cx - rW, ridge - t * 0.015, rW * 2, Math.max(1, t * 0.035));
      ctx.fillStyle = 'rgba(6, 10, 16, 0.34)';
      ctx.fillRect(cx - rW, ridge + t * 0.020, rW * 2, Math.max(1, t * 0.028));

      // 檐口：屋顶外沿一圈投影，房子才从草地上「立」起来
      ctx.fillStyle = 'rgba(5, 9, 15, 0.40)';
      ctx.fillRect(cx - W * 0.5, wallTop, W, Math.max(1, t * 0.045));

      // 烟囱：只有红顶的房子有，位置带个体差异，免得四栋长得一模一样
      if (red) {
        var chx = cx + W * 0.26;
        var chy = ridge + t * 0.10;
        ctx.fillStyle = '#3a2b26';
        ctx.fillRect(chx, chy, t * 0.16, t * 0.24);
        ctx.fillStyle = 'rgba(255, 236, 206, 0.14)';
        ctx.fillRect(chx, chy, t * 0.16, Math.max(1, t * 0.035));
      }
    }

    function drawPathTile(x, y, sx, sy, t) {
      // 土径。
      //
      // ⚠️ 这一层**不铺底色**。底色归底图渲染（暖褐 + 噪声 + 毛边侵蚀）。
      // 矢量层再盖一层满格方砖，等于把底图的毛边全部抹平 ——
      // 上一版就是这么变成「2.3 格宽的水泥广场」的：路加宽 35% 之后，
      // 几十块冷青灰方块拼成一整片，比草地还亮，成了画面的主角。
      //
      // 这里只加两样东西：散落的碎石，和每几格一盏路灯。

      // 碎石：一半的格子上放 2~3 颗，大小/位置/明度全带哈希。
      // ⚠️ 不是每格都画。594 格视野里路面约 80 格，每格 4 颗就是 320 个
      // ellipse + 320 个高光 —— 实测帧时从 25ms 涨到 37ms（软渲染）。
      // 只用暖色 —— 冷色石头会让一条土路在夜色里读起来是「湿的」。
      var nStone = (hash2(x, y, 969) < 0.52) ? 2 + ((hash2(x, y, 971) * 2) | 0) : 0;
      for (var st = 0; st < nStone; st++) {
        var hx = hash2(x + st * 3, y, 973);
        var hy = hash2(x, y + st * 5, 977);
        var hr = hash2(x + st, y + st, 979);
        var rad = t * (0.028 + hr * 0.040);
        var px2 = sx + t * (0.12 + hx * 0.76);
        var py2 = sy + t * (0.12 + hy * 0.76);
        var lv = 0.46 + hash2(x - st, y + st, 983) * 0.50;
        ctx.fillStyle = 'rgba(' + Math.round(104 * lv) + ',' + Math.round(88 * lv) + ',' + Math.round(68 * lv) + ',0.78)';
        ctx.beginPath();
        ctx.ellipse(px2, py2, rad, rad * 0.74, hr * 3.14, 0, 6.2832);
        ctx.fill();
        // 左上一点高光：石子有厚度才不是地上的污点
        ctx.fillStyle = 'rgba(214, 190, 152, 0.11)';
        ctx.beginPath();
        ctx.ellipse(px2 - rad * 0.24, py2 - rad * 0.24, rad * 0.40, rad * 0.26, hr * 3.14, 0, 6.2832);
        ctx.fill();
      }

      // 主街的路灯：每 4 格一盏，立在路右肩（右邻不是路才立，否则会立在路中间）。
      // 这是画面里仅有的几个暖色光源之一 —— 所以宁可少、不可弱。
      var isAvenue = Math.abs(x - 80) <= 1;
      if (isAvenue && y % 4 === 1 && !isPathCell(x + 1, y)) {
        var lx2 = sx + t * 0.78;
        var ly2 = sy + t * 0.14;
        var lg2 = ctx.createRadialGradient(lx2, ly2, 0, lx2, ly2, t * 1.30);
        lg2.addColorStop(0, 'rgba(255, 214, 148, 0.46)');
        lg2.addColorStop(0.34, 'rgba(255, 198, 126, 0.15)');
        lg2.addColorStop(1, 'rgba(255, 198, 126, 0)');
        ctx.fillStyle = lg2;
        ctx.beginPath();
        ctx.arc(lx2, ly2, t * 1.30, 0, 6.2832);
        ctx.fill();

        ctx.strokeStyle = 'rgba(26, 30, 38, 0.94)';
        ctx.lineWidth = Math.max(1, t * 0.038);
        ctx.beginPath();
        ctx.moveTo(lx2, ly2 + t * 0.08);
        ctx.lineTo(lx2, ly2 + t * 0.50);
        ctx.stroke();

        ctx.fillStyle = 'rgba(255, 232, 176, 0.98)';
        ctx.beginPath();
        ctx.arc(lx2, ly2, Math.max(1.3, t * 0.060), 0, 6.2832);
        ctx.fill();
      }
    }

    // ---------- 矢量树（预烘精灵） ----------
    //
    // 为什么不用 Kenney 的 16px 树：
    //   那是一套「格子对齐的硬像素卡通瓦片」，而底图是连续场 + 柔和渐变。
    //   两者叠在一起，观感就是「两张不同游戏的地图压在一处」——
    //   硬像素块漂在柔光上，还有瓦片自带的方底。这不是调色能救的，
    //   是两种美术语言。一个画面里只能有一种。
    //
    // 树选矢量，因为地标（灯塔/巨树/风车）本来就是矢量画出来的，
    // 底图也是程序化的 —— 保留矢量才是顺势，换像素才是重做。
    //
    // 一棵树要五步：叶簇并集轮廓 → 逆光边 → 叶团受光 → 叶隙 → 受光短弧。
    // 逐帧画七八十棵会吃光预算，所以按 dpr 预烘成 12 个变体，每棵一次 drawImage。

    var treeSpr = null;
    var TREE_VB = 96;                 // 精灵画布边长（CSS px）
    var TREE_CX = 48, TREE_CY = 50;   // 树冠中心
    var TREE_R = 29;                  // 树冠半径

    // 六组夜色（deep 暗部 / mid 主体 / lit 受光 / rim 逆光边）。
    // 用「两色插值」而不是「一色乘亮度」——
    // 乘法只能改明度、改不了色相，一片林子会永远是同一种绿。
    // ⚠️ 数值是按「实显 28~52px」定的，不是按 96px 的精灵定的。
    // 第一版 mid 只有 (20,44,35)，比草地（约 45,62,55）还暗 ——
    // 缩到 30px 之后整片林子就是一团暗绿霉斑，这是「不好看」的第一因。
    // 现在 mid 提到草地同档，lit / rim 拉高一档半，树才立得出来。
    // 树色。
    //
    // ⚠️ rim（逆光边）上一版是 [102,150,116] —— 亮度接近草地高光的 4 倍。
    // 结果每棵树轮廓上都挂着一圈荧光绿描边，整片林子读起来像「发光的花椰菜」。
    // 夜里月光照在树上，最亮的部分也**不该亮过天空**：rim 现在只比 lit 亮一档，
    // 体积靠斜坡渐变，不靠描边。
    //
    // deep 也压到接近黑 —— 树在夜里首先是「一团比草地更暗的体积」，
    // 只在左上被月光擦到一条边。这是夜晚树林的真实读法。
    // ⚠️ 树的中调色必须和草地的中调色「色相不同」，不能只是更暗。
    // 草地 meadow lit 是 (44, 84, 62) —— 青绿。上一版树 mid 是 (22, 42, 34)，
    // 正好是草地的一半：同色相、只差明度。于是树和草的区别只剩「谁更黑」，
    // 而「更黑的草地」在眼睛里的第一读法是石头/苔块，不是树。
    //
    // 改法：树的蓝通道全部压低、红通道抬高 —— 叶绿偏橄榄（黄绿），
    // 草地偏青。同一个亮度下色相就分开了，树不再需要靠「压黑」来区分。
    var TREE_TONES = [
      { deep: [10, 18, 10], mid: [28, 46, 24], lit: [50, 76, 38], rim: [64, 94, 46] },
      { deep: [8, 18, 22],  mid: [22, 44, 50], lit: [40, 68, 74], rim: [52, 86, 92] },
      { deep: [14, 20, 8],  mid: [34, 50, 20], lit: [58, 82, 30], rim: [74, 102, 38] },
      { deep: [11, 16, 16], mid: [30, 42, 40], lit: [52, 66, 60], rim: [66, 84, 76] },
      { deep: [8, 14, 24],  mid: [24, 40, 54], lit: [44, 64, 82], rim: [58, 82, 104] },
      { deep: [9, 17, 12],  mid: [26, 44, 28], lit: [46, 72, 40], rim: [58, 90, 50] }
    ];

    // 每色调的形状变体数。树变大之后图章会更容易被看出来，从 2 提到 3。
    var TREE_VAR = 3;

    function rgbStr(a) {
      return 'rgb(' + a[0] + ',' + a[1] + ',' + a[2] + ')';
    }

    // 一圈叶瓣的并集。关键是「瓣心落在外圈上」——
    // 外沿半径 = 瓣心距 + 瓣半径，所以每瓣的最外点都落在同一个圆上，
    // 瓣与瓣之间必然凹下去一块。这才是叶缘；
    // 若只是把几个圆随手摊在中心附近，并集就是一个近似的圆，画出来是鹅卵石。
    // 树冠轮廓 = 3 个不对称的叶扇 + 中心盘。
    //
    // 五次试错的完整结论（每一次都是截图验证过的）：
    //   6 个圆瓣   → 花椰菜
    //   11 个小瓣  → 葡萄串
    //   5 个等分瓣 → 梅花
    //   1 个椭圆   → 鹅卵石
    //   正弦叠加   → 海星（振幅一大）/ 圆盘（振幅一小）
    //
    // 为什么都不行：前四种败在「交角只有固定几档」，眼睛三秒读出是拼的；
    // 正弦叠加败在「凸起个数恒定」—— 一棵树是某形状，整片林子就全是那个形状。
    //
    // 现在这条路要同时满足两件事：
    //   ① 轮廓必须有**深凹口** —— 这是树冠和石头的唯一分界。
    //      圆盘再怎么做质感，只要边缘是连续的凸形，就一定读成石头/苔块。
    //   ② 凹口的位置、深浅、宽度必须每棵树都不同。
    //
    // 做法：3 个叶扇（不等分角度），每个扇 = 3 个**椭圆**的并集。
    // 椭圆而不是圆：椭圆与椭圆的交角随两边离心率和旋转角变化，
    // 不会像圆弧相交那样恒定；再给每个椭圆一个随机旋转，
    // 「同一个印章」的破绽就被抹掉了。扇与扇之间的缝自然成为一个深凹口。
    function leafCluster(c, cx, cy, R, seed, squash) {
      c.beginPath();
      var dirs = [0, 2.15, 4.05];        // 不等分：123° / 109° / 128°
      for (var fnd = 0; fnd < 3; fnd++) {
        var a0 = dirs[fnd] + (hash2(seed, fnd, 701) - 0.5) * 0.58;
        var lobeR = R * (0.34 + hash2(seed, fnd, 703) * 0.10);
        var dist = R * (0.48 + hash2(seed, fnd, 705) * 0.10);
        for (var k = 0; k < 3; k++) {
          var aa = a0 + (k - 1) * 0.60 + (hash2(seed, fnd * 5 + k, 707) - 0.5) * 0.30;
          var dd = dist * (k === 1 ? 1.00 : 0.82);
          var ex = cx + Math.cos(aa) * dd;
          var ey = cy + Math.sin(aa) * dd * squash;
          var rr = lobeR * (0.78 + hash2(seed, fnd * 7 + k, 709) * 0.42);
          var rot = hash2(seed, fnd * 11 + k, 711) * 3.1416;
          c.moveTo(ex + rr, ey);
          c.ellipse(ex, ey, rr, rr * (0.66 + hash2(seed, fnd * 13 + k, 713) * 0.26),
                    rot, 0, 6.2832);
        }
      }
      // 中心盘：把三个扇焊在一起。没有它，三个扇只在外沿相接，
      // 正中会露一个三角形的洞 —— 缩小后是冠面上一个亮点，像被虫蛀了。
      c.moveTo(cx + R * 0.54, cy);
      c.ellipse(cx, cy, R * 0.54, R * 0.54 * squash, 0, 0, 6.2832);
    }

    function bakeTree(seed, tone, dpr) {
      var S = TREE_VB;
      var cv = document.createElement('canvas');
      cv.width = Math.round(S * dpr);
      cv.height = Math.round(S * dpr);
      var c = cv.getContext('2d');
      c.setTransform(dpr, 0, 0, dpr, 0, 0);
      // 0.70 ~ 1.04：有的树矮胖、有的高瘦。
      // 只改大小不改比例时，整片林子是「一堆大小不同的球」；
      // 改了比例，才读得出「这是不同的树」。
      var squash = 0.70 + hash2(seed, 3, 641) * 0.34;

      // 落影：软边椭圆往右下甩，和全场月光方向（左上）一致。
      // 硬边椭圆会被读成「地上还压着一块石头」—— 影子不能有边界。
      var sx0 = TREE_CX + TREE_R * 0.44;
      var sy0 = TREE_CY + TREE_R * 0.56;
      var srad = TREE_R * 1.26;
      var sg = c.createRadialGradient(sx0, sy0, TREE_R * 0.08, sx0, sy0, srad);
      sg.addColorStop(0, 'rgba(3, 9, 13, 0.50)');
      sg.addColorStop(0.58, 'rgba(3, 9, 13, 0.26)');
      sg.addColorStop(1, 'rgba(3, 9, 13, 0)');
      c.save();
      c.translate(sx0, sy0);
      c.scale(1, 0.56);
      c.translate(-sx0, -sy0);
      c.fillStyle = sg;
      c.beginPath();
      c.arc(sx0, sy0, srad, 0, 6.2832);
      c.fill();
      c.restore();

      // 树冠：4~6 团叶簇互相压叠，每团自己受光。
      //
      // 这是整棵树能不能读成「叶子」的关键 —— 不是轮廓。
      // 早先的做法是「一层覆盖全冠的径向斜坡 + 上面叠几团 lit」，
      // 斜坡已经先把左上整块提亮，叶团再画 lit 上去等于没画，
      // 结果是一颗光滑的球，缩到 28px 什么细节都不剩。
      //
      // 现在反过来：底铺主体色，叶团用 rim→lit→mid→deep 各自成球。
      // 球与球相交处会落下 deep 的暗缝 —— 那道缝就是叶与叶的分界，
      // 比任何噪声轮廓都更像叶子。
      c.save();
      leafCluster(c, TREE_CX, TREE_CY, TREE_R, seed, squash);
      c.clip();

      c.fillStyle = rgbStr(tone.mid);
      c.fillRect(0, 0, S, S);

      // ⚠️ 团数少了、半径小了，就会露出「一颗一颗」的本来面目：
      // 4 团小半径 + 每团中心一点 rim，读出来是一串黑葡萄。
      // 现在 6~8 团、半径 0.40~0.56R、环距收到 0.30R —— 团与团大面积重叠，
      // 交界只剩几段短弧，才读成「一冠叶子」而不是「一捧果子」。
      var clumps = 6 + ((hash2(seed, 7, 671) * 3) | 0);
      for (var b = 0; b < clumps; b++) {
        // 第 0 团压在正中、个头最大，其余绕它一圈。
        // 纯极坐标均分会在正中留一个洞，缩到 28px 就是个甜甜圈的冠。
        var isCore = (b === 0);
        var ba = isCore ? 0
          : (b - 1) * (6.2832 / (clumps - 1)) + hash2(seed, b, 661) * 0.90;
        var bd = isCore ? 0 : TREE_R * (0.26 + hash2(seed, b, 663) * 0.16);
        var bx2 = TREE_CX + Math.cos(ba) * bd;
        var by2 = TREE_CY + Math.sin(ba) * bd * squash;
        var br = TREE_R * (isCore ? 0.60 : 0.40 + hash2(seed, b, 667) * 0.16);
        var gg = c.createRadialGradient(
          bx2 - br * 0.30, by2 - br * 0.34, br * 0.10,
          bx2, by2, br * 1.02);
        // ⚠️ 起色点绝不能是 rim。rim 比 lit 只亮一档，但放在半径 br*0.05 的
        // 一个小圈上，就是一颗标准的高光点 —— 每团一颗，整树立刻变黑莓。
        // 起点直接给 lit、并且一直铺到 0.40，团内是一片平的亮面，
        // 体积交给下面那层覆盖全冠的方向渐变。
        // 团内只给「中调 → 暗边」的柔和过渡，不再自带亮面。
        // 亮面交给下面那层散点 —— 亮面一旦贴在团心上，就是一颗光亮的果子。
        gg.addColorStop(0, rgbStr(tone.mid));
        gg.addColorStop(0.62, rgbStr(tone.mid));
        gg.addColorStop(1, rgbStr(tone.deep));
        c.fillStyle = gg;
        c.beginPath();
        c.arc(bx2, by2, br, 0, 6.2832);
        c.fill();

        // 这一团自己的亮面：落在团心偏左上，比团小得多。
        //
        // ⚠️ 亮面绝不能按「整冠左上角」撒。我上一版就是这么写的 ——
        // 6~10 块亮斑全挤在左上 100° 的一段弧上，互相一叠，
        // 又变回一条贴着轮廓的连续亮边，也就是湿石头。
        // 挂在每一团自己身上，亮斑就自然散满整个冠面：
        // 有的团亮、有的团暗，正是林子里月光穿叶的效果。
        var hw = 0.72 + hash2(seed, b, 719) * 0.42;
        var hx2 = bx2 - br * 0.30;
        var hy2 = by2 - br * 0.34;
        var hg = c.createRadialGradient(hx2, hy2, br * 0.04, hx2, hy2, br * 0.52 * hw);
        hg.addColorStop(0, 'rgba(' + tone.lit[0] + ',' + tone.lit[1] + ',' +
                            tone.lit[2] + ',' + (0.34 + hash2(seed, b, 723) * 0.22).toFixed(2) + ')');
        hg.addColorStop(0.50, 'rgba(' + tone.lit[0] + ',' + tone.lit[1] + ',' +
                               tone.lit[2] + ',0.12)');
        hg.addColorStop(1, 'rgba(' + tone.lit[0] + ',' + tone.lit[1] + ',' +
                             tone.lit[2] + ',0)');
        c.fillStyle = hg;
        c.beginPath();
        c.arc(hx2, hy2, br * 0.52 * hw, 0, 6.2832);
        c.fill();
      }

      // 统一方向：整冠左上提一点、右下压一大截。
      // 叶团各自受光会让整棵树「散」成几块，必须有覆盖全冠的一层方向
      // 把它们重新捆在一起 —— 这是「一冠叶子」和「几片叶子」的区别。
      var dg = c.createLinearGradient(
        TREE_CX - TREE_R * 0.80, TREE_CY - TREE_R * 0.86,
        TREE_CX + TREE_R * 0.72, TREE_CY + TREE_R * 0.78);
      dg.addColorStop(0, 'rgba(255, 238, 200, 0.09)');
      dg.addColorStop(0.40, 'rgba(0, 0, 0, 0)');
      dg.addColorStop(0.72, 'rgba(0, 0, 0, 0.24)');
      dg.addColorStop(1, 'rgba(0, 0, 0, 0.44)');
      c.fillStyle = dg;
      c.fillRect(0, 0, S, S);

      // 叶面颗粒：一堆一寸大小的亮点和暗点。
      //
      // 缩到 30px 之后，单个点只有 0.3~0.5px —— 它不再是「点」，
      // 而是让整个冠面产生细密噪点。没有这一层，无论叶团怎么叠，
      // 冠面在缩小后都是一片光滑的塑料。
      // 代价为零：这是烘焙期一次性画的，运行时只是一张图。
      var dots = 34 + ((hash2(seed, 41, 673) * 16) | 0);
      for (var d = 0; d < dots; d++) {
        var da = hash2(seed, d, 677) * 6.2832;
        var dd = TREE_R * Math.sqrt(hash2(seed, d, 679)) * 0.86;
        var dx2 = TREE_CX + Math.cos(da) * dd;
        var dy2 = TREE_CY + Math.sin(da) * dd * squash;
        var dr = TREE_R * (0.020 + hash2(seed, d, 683) * 0.038);
        var up = hash2(seed, d, 687) < 0.52;
        c.fillStyle = up ? 'rgba(150, 196, 158, 0.16)'
                         : 'rgba(3, 11, 9, 0.30)';
        c.beginPath();
        c.ellipse(dx2, dy2, dr, dr * 0.80, da, 0, 6.2832);
        c.fill();
      }

      // ⚠️ 这里曾经有一圈「左上亮 → 右下透明」的轮廓光。
      // 它是我这轮改树最大的弯路：连续、且严格贴着轮廓的亮边，
      // 在眼睛里的固定读法是「一个光滑球体被一束光擦到边缘」——
      // 也就是**湿石头/抛光鹅卵石**。叶子不会给出连续的边缘光，
      // 它给的是一块一块、断开的亮斑。所以整段删掉，改写散点受光。

      // 叶隙：三四道细长的暗缝，顺着冠的走势摆。
      // 圆点会被读成「洞」，细缝才是叶子之间的间隙。
      // 同样是「实显尺寸」问题：0.075R ≈ 2px 的缝，缩到 0.4 倍就没了。
      // 加粗到 0.13R，实显 1.5px，才够当结构线。
      c.strokeStyle = 'rgba(4, 14, 12, 0.30)';
      c.lineWidth = TREE_R * 0.13;
      c.lineCap = 'round';
      for (var i = 0; i < 4; i++) {
        var a2 = 0.55 + i * 0.62 + hash2(seed, i, 647) * 0.34;
        var d2 = TREE_R * (0.24 + hash2(seed, i, 653) * 0.42);
        var len = TREE_R * (0.16 + hash2(seed, i, 659) * 0.16);
        var bx = TREE_CX + Math.cos(a2) * d2;
        var by = TREE_CY + Math.sin(a2) * d2 * squash;
        c.beginPath();
        c.moveTo(bx, by);
        c.lineTo(bx + Math.cos(a2 + 1.35) * len, by + Math.sin(a2 + 1.35) * len * squash);
        c.stroke();
      }

      // ⚠️ 这里曾经有两笔 0.12R 宽的亮弧（alpha 0.22），落在 191° 和 221°。
      // 它们是「湿石头」的真正元凶：两条弧在左侧一叠，就是一道贴着轮廓的
      // 连续月牙高光 —— 和上一版被删掉的轮廓光完全同一个效果。
      // 亮面现在由每个叶团自己承担（见上面的 hg），冠面上已经有明暗分布，
      // 这里只留一笔很淡的、且角度提到左上（不是正左）补一点方向感。
      c.strokeStyle = 'rgba(196, 238, 208, 0.10)';
      c.lineWidth = TREE_R * 0.09;
      c.lineCap = 'round';
      var la = 3.62 + hash2(seed, 0, 223) * 0.22;
      var ld = TREE_R * (0.40 + hash2(seed, 0, 227) * 0.14);
      c.beginPath();
      c.arc(TREE_CX + Math.cos(la) * ld * 0.30, TREE_CY + Math.sin(la) * ld * 0.30 * squash,
            ld * 0.70, la - 0.50, la + 0.50);
      c.stroke();
      c.restore();
      return cv;
    }

    function ensureTreeSprites() {
      var dpr = view.dpr || 1;
      if (treeSpr && treeSpr.dpr === dpr) return;
      var list = [];
      // 每个色调烘两个形状变体：同一个色调如果只有一种轮廓，
      // 整座岛就会长满同一棵树 —— 玩家两秒内就能看出那是图章。
      for (var i = 0; i < TREE_TONES.length; i++) {
        for (var v = 0; v < TREE_VAR; v++) {
          list.push(bakeTree(1700 + i * 137 + v * 911, TREE_TONES[i], dpr));
        }
      }
      treeSpr = { list: list, dpr: dpr };
    }

    // ---------- 大气：流动的雾 ----------
    // 夜岛上的雾是唯一能「加纵深、加气氛、不加多边形」的东西。
    // 做法：预烘一张 256² 的软斑贴图，每帧只做几次 drawImage ——
    // 若改成每帧现算十几个大径向渐变，校园平板上直接掉 20 帧。
    // 实测代价：整场约 0.2ms（与不加雾的 23.5ms 对 23.7ms 之差同量级）。
    var mistSpr = null;

    function ensureMist() {
      if (mistSpr) return mistSpr;
      var S = 256;
      var cv = document.createElement('canvas');
      cv.width = S;
      cv.height = S;
      var c = cv.getContext('2d');
      // ⚠️ 每一块都要在 3×3 的九个位置各画一遍，否则贴图不能首尾相接 ——
      // 平铺之后就是一块块亮度突变的亮矩形，比不加雾更难看。
      // 越界的那几遍由画布自己裁掉，成本只在预烘时付一次。
      for (var i = 0; i < 9; i++) {
        var mx = hash2(i, 3, 811) * S;
        var my = hash2(i, 5, 813) * S;
        var mr = S * (0.17 + hash2(i, 7, 817) * 0.22);
        for (var wy = -1; wy <= 1; wy++) {
          for (var wx2 = -1; wx2 <= 1; wx2++) {
            var gx = mx + wx2 * S;
            var gy = my + wy * S;
            if (gx + mr < 0 || gx - mr > S || gy + mr < 0 || gy - mr > S) continue;
            var mg = c.createRadialGradient(gx, gy, 0, gx, gy, mr);
            mg.addColorStop(0, 'rgba(198, 216, 234, 0.26)');
            mg.addColorStop(0.52, 'rgba(182, 202, 224, 0.09)');
            mg.addColorStop(1, 'rgba(172, 194, 218, 0)');
            c.fillStyle = mg;
            c.beginPath();
            c.arc(gx, gy, mr, 0, 6.2832);
            c.fill();
          }
        }
      }
      mistSpr = cv;
      return cv;
    }

    // 雾随镜头走 0.55 的视差：跟满会变成「贴在屏幕上的一层膜」，
    // 完全不跟又像「地上的贴纸」。0.55 读起来才是「浮在半空的空气」。
    function drawMist(ox, oy, t, now, w, h) {
      var spr = ensureMist();
      var sc = t * 17;
      var px = (ox * 0.55 + now * 0.0042) % sc;
      var py = (oy * 0.55 + now * 0.0015) % sc;
      if (px > 0) px -= sc;
      if (py > 0) py -= sc;
      // 0.62 在夜色底图上会把整屏洗灰，右下那块「雾斑」就是它。
      ctx.globalAlpha = 0.36;
      for (var y = py; y < h; y += sc) {
        for (var x = px; x < w; x += sc) {
          ctx.drawImage(spr, x, y, sc, sc);
        }
      }
      ctx.globalAlpha = 1;
    }

    // 石头：6 个带哈希顶点 + 二次曲线收口。
    // 用正圆或正方当石头，一眼就是「图标」；石头靠的是「没有两条边平行」。
    function drawStoneV(cx, cy, r, seed, base, lit) {
      ctx.save();
      ctx.translate(cx + r * 0.28, cy + r * 0.54);
      ctx.scale(1, 0.40);
      var sg = ctx.createRadialGradient(0, 0, 0, 0, 0, r * 1.45);
      sg.addColorStop(0, 'rgba(3, 9, 13, 0.44)');
      sg.addColorStop(1, 'rgba(3, 9, 13, 0)');
      ctx.fillStyle = sg;
      ctx.beginPath();
      ctx.arc(0, 0, r * 1.45, 0, 6.2832);
      ctx.fill();
      ctx.restore();

      var N = 6;
      var pts = [];
      for (var i = 0; i < N; i++) {
        var a = i * 6.2832 / N + hash2(seed, i, 811) * 0.42;
        var rr = r * (0.72 + hash2(seed, i, 813) * 0.34);
        pts.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr * 0.78]);
      }
      ctx.beginPath();
      ctx.moveTo((pts[N - 1][0] + pts[0][0]) / 2, (pts[N - 1][1] + pts[0][1]) / 2);
      for (var j = 0; j < N; j++) {
        var k = j + 1 === N ? 0 : j + 1;
        ctx.quadraticCurveTo(pts[j][0], pts[j][1],
          (pts[j][0] + pts[k][0]) / 2, (pts[j][1] + pts[k][1]) / 2);
      }
      ctx.closePath();
      var lg = ctx.createRadialGradient(cx - r * 0.38, cy - r * 0.44, r * 0.04,
                                        cx - r * 0.38, cy - r * 0.44, r * 1.40);
      lg.addColorStop(0, lit);
      lg.addColorStop(0.52, base);
      lg.addColorStop(1, 'rgb(16,20,27)');
      ctx.fillStyle = lg;
      ctx.fill();
    }

    // 蘑菇：柄 + 半圆伞 + 一点裙边。伞沿要压暗 —— 少了这一圈，
    // 蘑菇就是「一根棍顶个球」。
    function drawMushroomV(cx, cy, r, seed, big) {
      var hh = r * (big ? 1.5 : 1.1);
      ctx.save();
      ctx.translate(cx + r * 0.24, cy + hh * 0.62);
      ctx.scale(1, 0.34);
      var sg = ctx.createRadialGradient(0, 0, 0, 0, 0, r * 1.5);
      sg.addColorStop(0, 'rgba(3, 9, 13, 0.40)');
      sg.addColorStop(1, 'rgba(3, 9, 13, 0)');
      ctx.fillStyle = sg;
      ctx.beginPath();
      ctx.arc(0, 0, r * 1.5, 0, 6.2832);
      ctx.fill();
      ctx.restore();

      ctx.fillStyle = 'rgb(74, 66, 58)';
      ctx.beginPath();
      ctx.ellipse(cx, cy + hh * 0.30, r * 0.28, hh * 0.42, 0, 0, 6.2832);
      ctx.fill();

      var capG = ctx.createRadialGradient(cx - r * 0.30, cy - hh * 0.28, r * 0.05,
                                          cx - r * 0.30, cy - hh * 0.28, r * 1.25);
      capG.addColorStop(0, 'rgb(150, 108, 96)');
      capG.addColorStop(0.60, 'rgb(110, 72, 68)');
      capG.addColorStop(1, 'rgb(52, 32, 34)');
      ctx.fillStyle = capG;
      ctx.beginPath();
      ctx.ellipse(cx, cy - hh * 0.04, r * 1.02, r * 0.72, 0, Math.PI, 0);
      ctx.quadraticCurveTo(cx + r * 0.5, cy + hh * 0.16, cx, cy + hh * 0.12);
      ctx.quadraticCurveTo(cx - r * 0.5, cy + hh * 0.16, cx - r * 1.02, cy - hh * 0.04);
      ctx.closePath();
      ctx.fill();
      // 伞裙：一道压暗的弧，蘑菇才有厚度
      ctx.strokeStyle = 'rgba(30, 16, 18, 0.42)';
      ctx.lineWidth = Math.max(1, r * 0.16);
      ctx.beginPath();
      ctx.ellipse(cx, cy - hh * 0.02, r * 0.82, r * 0.24, 0, 0, Math.PI);
      ctx.stroke();
    }

    // 花：五瓣 + 芯。花瓣用椭圆而不是圆点 —— 圆点读作「撒了糖霜」。
    function drawFlowerV(cx, cy, r, seed, rgb) {
      ctx.strokeStyle = 'rgba(96, 140, 104, 0.55)';
      ctx.lineWidth = Math.max(1, r * 0.16);
      ctx.beginPath();
      ctx.moveTo(cx, cy + r * 2.1);
      ctx.quadraticCurveTo(cx + r * 0.20, cy + r * 0.9, cx, cy + r * 0.1);
      ctx.stroke();

      var lit = 'rgb(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ')';
      var shd = 'rgb(' + Math.round(rgb[0] * 0.42) + ',' + Math.round(rgb[1] * 0.42) + ',' + Math.round(rgb[2] * 0.46) + ')';
      for (var i = 0; i < 5; i++) {
        var a = i * 6.2832 / 5 + hash2(seed, i, 907) * 0.22;
        var d = r * 0.62;
        ctx.fillStyle = i === 2 ? lit : shd;
        ctx.beginPath();
        ctx.ellipse(cx + Math.cos(a) * d, cy + Math.sin(a) * d * 0.82,
                    r * 0.52, r * 0.36, a, 0, 6.2832);
        ctx.fill();
      }
    }

    // 灌木：就是一棵没有主干的树。复用 leafCluster，保证和树同一套语言。
    function drawBushV(cx, cy, r, seed) {
      var tone = { deep: [9, 22, 18], mid: [22, 48, 38], lit: [42, 80, 62], rim: [80, 132, 100] };
      ctx.save();
      ctx.translate(cx + r * 0.26, cy + r * 0.62);
      ctx.scale(1, 0.38);
      var sg = ctx.createRadialGradient(0, 0, 0, 0, 0, r * 1.5);
      sg.addColorStop(0, 'rgba(3, 9, 13, 0.42)');
      sg.addColorStop(1, 'rgba(3, 9, 13, 0)');
      ctx.fillStyle = sg;
      ctx.beginPath();
      ctx.arc(0, 0, r * 1.5, 0, 6.2832);
      ctx.fill();
      ctx.restore();

      ctx.fillStyle = rgbStr(tone.rim);
      leafCluster(ctx, cx, cy, r, seed, 0.82);
      ctx.fill();
      ctx.save();
      ctx.translate(r * 0.07, r * 0.07);
      leafCluster(ctx, cx, cy, r, seed, 0.82);
      ctx.clip();
      var g = ctx.createRadialGradient(cx - r * 0.34, cy - r * 0.40, r * 0.04,
                                       cx - r * 0.34, cy - r * 0.40, r * 1.5);
      g.addColorStop(0, rgbStr(tone.lit));
      g.addColorStop(0.36, rgbStr(tone.mid));
      g.addColorStop(1, rgbStr(tone.deep));
      ctx.fillStyle = g;
      ctx.fillRect(cx - r * 1.4, cy - r * 1.4, r * 2.8, r * 2.8);
      ctx.restore();
    }

    function drawPropsTile(x, y, sx, sy, t) {
      if (!state.explored || !state.explored[y * state.size + x]) return;
      var code = state.cells.charCodeAt(y * state.size + x) - 48;
      if (code === T_PATH) { drawPathTile(x, y, sx, sy, t); return; }
      if (code !== T_MEADOW && code !== T_STONE && code !== T_SAND) return;

      var isle = tileIsle ? tileIsle[y * state.size + x] : 255;
      var biome = isle < 8 && (state.catalog.islands[isle] || {}).biome;
      var n = hash2(x, y, 89);
      var s = t / 16;   // 瓦片缩放（16px 素材 → 格宽）

      // 森林带：低频噪声决定「这一带是不是林子」；树走矢量预烘精灵。
      //
      // ⚠️ vnoise 的第三参数是「格子边长（世界格）」，不是频率 —— 它会把坐标除以它。
      // 之前写 5.2，等于森林斑块半径 2.6 格：噪声还没来得及形成一片林子就换了值，
      // 于是整座岛读起来是「草坪上撒了一把灌木」，而不是「有林子和空地的岛」。
      // 这是「画面没有纵深」的第二因，比任何单棵树画得好不好都更致命。
      // 现在两层：17 格出林地轮廓，6.5 格出林内疏密。
      var fmask = vnoise(x, y, 17, 111) * 0.68 + vnoise(x, y, 6.5, 112) * 0.32;
      // 林心密、林缘疏：把 0.47~0.63 这一段线性映射成 0~1 的密度，
      // 林缘自然过渡成三五棵一丛，不会出现一条硬边把草地和森林劈开。
      var dens = (fmask - 0.47) / 0.16;
      if (dens < 0) dens = 0; else if (dens > 1) dens = 1;

      if (code === T_MEADOW && dens > 0.02 && n > 1 - dens * 0.56) {
        ensureTreeSprites();
        var px = sx + t * (hash2(x, y, 91) - 0.5) * 0.70;
        var py = sy + t * (hash2(x, y, 93) - 0.5) * 0.70;
        // 林缘的树小、林心的树大。一片林子里每棵一样大，
        // 读起来就是「撒了一把相同的图章」，纵深立刻消失。
        // 下限抬到 0.95（实显约 28px）：再小，烘焙的受光面就掉到 1px 以下了。
        var box = t * (0.95 + dens * 0.38 + hash2(x, y, 109) * 0.34);
        // 岛的生态决定色调：雾林偏青、霜屿偏蓝、花谷偏黄绿、岩岛偏灰
        var tone;
        if (biome === 'mist') tone = 1;
        else if (biome === 'frost') tone = 4;
        else if (biome === 'flower') tone = 2;
        else if (biome === 'stone' || biome === 'coral') tone = 3;
        else tone = (hash2(x, y, 113) < 0.30) ? 5 : 0;
        var vi = (hash2(x, y, 107) * TREE_VAR) | 0;
        var spr = treeSpr.list[tone * TREE_VAR + vi] || treeSpr.list[0];
        // 锚点：精灵里树冠中心在 (TREE_CX, TREE_CY)，所以 X 居中、Y 上提
        ctx.drawImage(
          spr,
          px - box * 0.5,
          py - box * (TREE_CY / TREE_VB),
          box, box
        );
        return;
      }

      // 零散小物（各岛性格不同）。同样是矢量 —— 见 drawStoneV 的注释。
      // 3.8% 的时候，平均 26 格才有一簇草/一块石子 —— 走在草地上什么都没有。
      // 提到 8% 之后同样的视野里多了一倍细节，成本是每格多一次 hash 判断。
      if (n > 0.920) {
        var ux = sx + t * (0.30 + hash2(x, y, 151) * 0.40);
        var uy = sy + t * (0.30 + hash2(x, y, 153) * 0.36);
        var ur = t * (0.070 + hash2(x, y, 157) * 0.055);
        if (biome === 'marsh') {
          drawMushroomV(ux, uy, ur * 1.15, x * 31 + y, (n > 0.985));
        } else if (biome === 'flower') {
          drawFlowerV(ux, uy, ur * 0.95, x * 17 + y * 3,
                      n > 0.985 ? [232, 200, 120] : [214, 224, 236]);
        } else if (biome === 'stone' || biome === 'coral') {
          drawStoneV(ux, uy, ur * (n > 0.988 ? 1.8 : 1.15), x * 7 + y * 13,
                     n > 0.988 ? 'rgb(74,80,92)' : 'rgb(56,62,74)', 'rgb(126,134,146)');
        } else if (biome === 'beach' || biome === 'frost') {
          drawStoneV(ux, uy, ur * 1.05, x * 5 + y * 11, 'rgb(66,70,78)', 'rgb(134,140,150)');
        } else if (n > 0.978) {
          drawBushV(ux, uy, ur * 1.5, x * 3 + y * 29);
        } else {
          drawFlowerV(ux, uy, ur * 0.8, x * 13 + y * 23,
                      n > 0.985 ? [226, 232, 240] : [232, 210, 128]);
        }
      }
    }

    // ---------- 地标 ----------
    // 大件建筑走「矢量底座 + Kenney 点缀」：保证在任何瓦片加载状态下都有形体。
    function s_of(t) { return t / 16; }

    // 矢量火焰： replaces Kenney torch（该瓦片带暗底，作Overlay会一块黑）
    function drawFlame(x, y, s, now, seed) {
      var flick = 0.8 + 0.2 * Math.sin(now * 0.02 + (seed || 0) * 6.283);
      var g = ctx.createRadialGradient(x, y, 0, x, y, s * 1.6);
      g.addColorStop(0, 'rgba(255, 190, 110, ' + (0.30 * flick).toFixed(3) + ')');
      g.addColorStop(1, 'rgba(255, 190, 110, 0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, s * 1.6, 0, 6.2832);
      ctx.fill();
      ctx.fillStyle = '#ff9a3e';
      ctx.beginPath();
      ctx.moveTo(x, y - s * 0.9 * flick);
      ctx.quadraticCurveTo(x + s * 0.42, y - s * 0.1, x, y + s * 0.45);
      ctx.quadraticCurveTo(x - s * 0.42, y - s * 0.1, x, y - s * 0.9 * flick);
      ctx.fill();
      ctx.fillStyle = '#ffe9b0';
      ctx.beginPath();
      ctx.moveTo(x, y - s * 0.4 * flick);
      ctx.quadraticCurveTo(x + s * 0.2, y, x, y + s * 0.32);
      ctx.quadraticCurveTo(x - s * 0.2, y, x, y - s * 0.4 * flick);
      ctx.fill();
    }

    function drawLighthouse(sx, sy, t, now) {
      // 灯塔的第一视觉特征是「细长」，不是「有红白条纹」。
      //
      // 上一版：塔身 2.13 格高、底宽 1.29 格 —— 宽高比 1 : 1.65。
      // 现实里的灯塔高度是直径的 5~8 倍。1:1.65 画出来是水塔，
      // 而「水塔」和「灯塔」在剪影上根本区分不出来。
      // 现在：3.0 格高、底宽 0.76 格 —— 1 : 3.9，剪影一眼就是灯塔。
      var bx = sx + t;
      var baseY = sy + t * 1.75;
      var towerH = t * 3.0;
      var SEGS = 8;
      var segH = towerH / SEGS;
      var wBot = t * 0.76, wTop = t * 0.42;

      // 地面光池：先铺一块「被塔照亮」的草地。
      // 少了这块，塔就是一张贴在地上的剪贴画 ——
      // 光源必须落在它照到的东西上，画面上才有因果关系。
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      var pool = ctx.createRadialGradient(bx, baseY, 0, bx, baseY, t * 3.1);
      pool.addColorStop(0, 'rgba(116, 94, 56, 0.46)');
      pool.addColorStop(0.50, 'rgba(84, 70, 44, 0.17)');
      pool.addColorStop(1, 'rgba(54, 48, 32, 0)');
      ctx.fillStyle = pool;
      ctx.beginPath();
      ctx.ellipse(bx, baseY, t * 3.1, t * 1.55, 0, 0, 6.2832);
      ctx.fill();
      ctx.restore();

      // 落影压在塔基，塔才「站在地上」。
      // ⚠️ 必须是软边渐变：实心椭圆在夜里读起来不是影子，是地上一个洞。
      ctx.save();
      ctx.translate(bx + t * 0.12, baseY + t * 0.06);
      ctx.scale(1, 0.30);
      var shG = ctx.createRadialGradient(0, 0, t * 0.10, 0, 0, t * 1.05);
      shG.addColorStop(0, 'rgba(3, 9, 13, 0.46)');
      shG.addColorStop(0.62, 'rgba(3, 9, 13, 0.24)');
      shG.addColorStop(1, 'rgba(3, 9, 13, 0)');
      ctx.fillStyle = shG;
      ctx.beginPath();
      ctx.arc(0, 0, t * 1.05, 0, 6.2832);
      ctx.fill();
      ctx.restore();

      // 塔身：八段，自下而上白红相间，越往上越细。
      // 每段走横向渐变（左侧受光、右侧背光）—— 纯色矩形叠起来
      // 会读成「一摞刷了漆的纸箱」，横向渐变才让它成为一根圆柱。
      for (var i = 0; i < SEGS; i++) {
        var yTop = baseY - segH * (i + 1);
        var wt = wTop + (wBot - wTop) * (i / SEGS);
        var wb = wTop + (wBot - wTop) * ((i + 1) / SEGS);
        var red = (i % 2) === 1;
        var cLit = red ? '#c8604c' : '#e8e2d4';
        var cMid = red ? '#9c3c2c' : '#bfb8a9';
        var cShd = red ? '#5e2018' : '#6f6960';
        var tg = ctx.createLinearGradient(bx - wb * 0.5, 0, bx + wb * 0.5, 0);
        tg.addColorStop(0, cMid);
        tg.addColorStop(0.20, cLit);
        tg.addColorStop(0.56, cMid);
        tg.addColorStop(1, cShd);
        ctx.fillStyle = tg;
        ctx.beginPath();
        ctx.moveTo(bx - wt * 0.5, yTop);
        ctx.lineTo(bx + wt * 0.5, yTop);
        ctx.lineTo(bx + wb * 0.5, yTop + segH + 0.6);
        ctx.lineTo(bx - wb * 0.5, yTop + segH + 0.6);
        ctx.closePath();
        ctx.fill();
        // 段与段之间一道极细的压暗：没有它，八段会连成一整根柱子，
        // 条纹只剩下「色块交界」，少了「砌上去」的层次。
        ctx.fillStyle = 'rgba(20, 16, 12, 0.22)';
        ctx.fillRect(bx - wb * 0.5, yTop + segH - Math.max(0.5, t * 0.012), wb, Math.max(0.5, t * 0.02));
      }

      // 左缘一道暖白亮边：圆柱要有轮廓，否则在夜色里会融进背景
      var edgeX = bx - wBot * 0.5 + t * 0.04;
      var edgeG = ctx.createLinearGradient(0, baseY - towerH, 0, baseY);
      edgeG.addColorStop(0, 'rgba(255, 240, 214, 0.30)');
      edgeG.addColorStop(1, 'rgba(255, 236, 206, 0.12)');
      ctx.strokeStyle = edgeG;
      ctx.lineWidth = Math.max(1, t * 0.035);
      ctx.beginPath();
      ctx.moveTo(edgeX + t * 0.18, baseY - towerH);
      ctx.lineTo(edgeX, baseY - t * 0.02);
      ctx.stroke();

      // 塔基的门：一个拱形暗口 + 里面漏出的暖光。
      // 灯塔得有人住，门就是「有人住」的唯一证据。
      var doorW = t * 0.20, doorH = t * 0.34;
      ctx.fillStyle = 'rgba(26, 20, 14, 0.92)';
      ctx.beginPath();
      ctx.moveTo(bx - doorW * 0.5, baseY);
      ctx.lineTo(bx - doorW * 0.5, baseY - doorH * 0.62);
      ctx.quadraticCurveTo(bx, baseY - doorH * 1.16, bx + doorW * 0.5, baseY - doorH * 0.62);
      ctx.lineTo(bx + doorW * 0.5, baseY);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = 'rgba(255, 196, 118, 0.30)';
      ctx.fillRect(bx - doorW * 0.34, baseY - doorH * 0.40, doorW * 0.68, doorH * 0.40);

      // 灯室 + 护栏平台 + 锥顶。
      var lampY = baseY - towerH;
      var lw = t * 0.58;

      // 护栏平台：比塔顶宽一圈，是灯室的立足处
      ctx.fillStyle = '#2b2620';
      ctx.fillRect(bx - lw * 0.82, lampY + t * 0.06, lw * 1.64, t * 0.12);
      ctx.fillStyle = 'rgba(255, 226, 176, 0.16)';
      ctx.fillRect(bx - lw * 0.82, lampY + t * 0.06, lw * 1.64, Math.max(0.5, t * 0.018));

      // 灯室框
      ctx.fillStyle = '#453a2e';
      ctx.fillRect(bx - lw * 0.5, lampY - t * 0.50, lw, t * 0.62);
      // 玻璃
      ctx.fillStyle = 'rgba(255, 238, 186, 0.98)';
      ctx.fillRect(bx - lw * 0.38, lampY - t * 0.42, lw * 0.76, t * 0.48);
      // 竖向窗框：两根细柱，玻璃才不会是一块白板
      ctx.fillStyle = '#3c3228';
      ctx.fillRect(bx - t * 0.026, lampY - t * 0.42, Math.max(1, t * 0.052), t * 0.48);
      ctx.fillRect(bx - lw * 0.38, lampY - t * 0.20, lw * 0.76, Math.max(0.5, t * 0.022));

      // 锥顶
      ctx.fillStyle = '#6b563f';
      ctx.beginPath();
      ctx.moveTo(bx - lw * 0.68, lampY - t * 0.50);
      ctx.lineTo(bx + lw * 0.68, lampY - t * 0.50);
      ctx.lineTo(bx, lampY - t * 1.02);
      ctx.closePath();
      ctx.fill();
      // 锥顶左侧受光
      ctx.strokeStyle = 'rgba(255, 232, 190, 0.42)';
      ctx.lineWidth = Math.max(1, t * 0.030);
      ctx.beginPath();
      ctx.moveTo(bx - lw * 0.66, lampY - t * 0.52);
      ctx.lineTo(bx, lampY - t * 1.00);
      ctx.stroke();
      // 顶针
      ctx.fillStyle = '#4a3d2e';
      ctx.fillRect(bx - Math.max(1, t * 0.018), lampY - t * 1.22, Math.max(2, t * 0.036), t * 0.22);

      // 光晕 + 旋转光束，一起走 lighter ——
      // 光束要是用 source-over 画，扫过草地就是两块灰三角形。
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      // ⚠️ 色相必须留在橙黄区。
      // 上一版是 rgba(255,228,160) —— 接近白色。lighter 合成是「通道相加」，
      // 加进去的白光只会提高亮度、不增加饱和，结果就是一束灰白的扇形。
      var halo = ctx.createRadialGradient(bx, lampY - t * 0.22, 0, bx, lampY - t * 0.22, t * 2.1);
      halo.addColorStop(0, 'rgba(255, 196, 108, 0.42)');
      halo.addColorStop(0.34, 'rgba(255, 176, 88, 0.16)');
      halo.addColorStop(1, 'rgba(255, 160, 70, 0)');
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.arc(bx, lampY - t * 0.22, t * 2.1, 0, 6.2832);
      ctx.fill();

      // 两片对置扇形慢速扫过云海 —— 夜里唯一会动的东西，全靠它当锚点。
      //
      // 画三层而不是一层：一层三角形无论怎么调 alpha 都是「一块均匀的雾」，
      // 真实的光束一定是中心亮、边缘散。
      var flick = 0.88 + Math.sin(now * 0.0017) * 0.06 + Math.sin(now * 0.0043) * 0.03;
      var BEAM_LAYERS = [
        { w: 1.05, a: 0.055, len: 1.00 },
        { w: 0.58, a: 0.075, len: 0.98 },
        { w: 0.22, a: 0.105, len: 0.94 }
      ];
      ctx.translate(bx, lampY - t * 0.22);
      ctx.rotate(now * 0.00045);
      for (var b2 = 0; b2 < 2; b2++) {
        for (var L3 = 0; L3 < BEAM_LAYERS.length; L3++) {
          var BL = BEAM_LAYERS[L3];
          var beam = ctx.createLinearGradient(0, 0, t * 9 * BL.len, 0);
          beam.addColorStop(0, 'rgba(255, 186, 92, ' + (BL.a * flick).toFixed(4) + ')');
          beam.addColorStop(0.30, 'rgba(255, 176, 82, ' + (BL.a * 0.62).toFixed(4) + ')');
          beam.addColorStop(0.70, 'rgba(255, 166, 74, ' + (BL.a * 0.20).toFixed(4) + ')');
          beam.addColorStop(1, 'rgba(255, 158, 66, 0)');
          ctx.fillStyle = beam;
          ctx.beginPath();
          ctx.moveTo(0, 0);
          ctx.lineTo(t * 9 * BL.len, -t * BL.w);
          ctx.lineTo(t * 9 * BL.len, t * BL.w);
          ctx.closePath();
          ctx.fill();
        }
        ctx.rotate(3.1416);
      }
      ctx.restore();
    }

    function drawCrater(sx, sy, t, now) {
      var cx = sx + t;
      var cy = sy + t;
      ctx.fillStyle = 'rgba(3, 9, 13, 0.42)';
      ctx.beginPath();
      ctx.ellipse(cx, cy + t * 0.2, t * 1.15, t * 0.5, 0, 0, 6.2832);
      ctx.fill();
      ctx.fillStyle = '#1a1420';
      ctx.beginPath();
      ctx.ellipse(cx, cy, t * 0.95, t * 0.42, 0, 0, 6.2832);
      ctx.fill();
      var pulse = 0.5 + 0.5 * Math.sin(now * 0.002);
      var g = ctx.createRadialGradient(cx, cy, 0, cx, cy, t * 0.8);
      g.addColorStop(0, 'rgba(186, 150, 255, ' + (0.5 + 0.2 * pulse).toFixed(3) + ')');
      g.addColorStop(0.4, 'rgba(140, 110, 230, 0.18)');
      g.addColorStop(1, 'rgba(140, 110, 230, 0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(cx, cy, t * 0.9, t * 0.4, 0, 0, 6.2832);
      ctx.fill();
      ctx.fillStyle = 'rgba(240, 230, 255, 0.9)';
      ctx.beginPath();
      ctx.arc(cx, cy, t * 0.10 + t * 0.02 * pulse, 0, 6.2832);
      ctx.fill();
      drawFlame(sx + t * 0.4, sy - t * 0.28, s_of(t) * 1.1, now, 3);
      drawFlame(sx + t * 1.7, sy - t * 0.28, s_of(t) * 1.1, now, 7);
      drawTile(K.chestRune, sx + t * 0.62, sy + t * 1.05, s_of(t) * 1.2);
    }

    function drawGreatTree(sx, sy, t, now) {
      var cx = sx + t * 0.5;
      var cy = sy + t * 0.5;
      ctx.fillStyle = 'rgba(3, 9, 13, 0.36)';
      ctx.beginPath();
      ctx.ellipse(cx + t * 0.9, cy + t * 1.1, t * 1.5, t * 0.5, 0, 0, 6.2832);
      ctx.fill();
      drawTile(K.treeBigA, sx - t * 1.6, sy - t * 2.2, t * 6 / 16);
      var g = ctx.createRadialGradient(cx, cy - t * 0.8, 0, cx, cy - t * 0.8, t * 2.2);
      g.addColorStop(0, 'rgba(140, 240, 190, 0.14)');
      g.addColorStop(1, 'rgba(140, 240, 190, 0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(cx, cy - t * 0.8, t * 2.2, 0, 6.2832);
      ctx.fill();
      for (var i = 0; i < 7; i++) {
        var a = now * 0.0004 + i * 0.9;
        var fx = cx + Math.cos(a) * t * 1.5;
        var fy = cy - t * 0.8 + Math.sin(a * 1.3) * t * 0.9;
        ctx.fillStyle = 'rgba(170, 255, 214, ' + (0.3 + 0.3 * Math.sin(now * 0.002 + i)).toFixed(2) + ')';
        ctx.fillRect(fx, fy, 2, 2);
      }
    }

    function drawShrooms(sx, sy, t, now) {
      var cx = sx + t * 0.5;
      var cy = sy + t * 0.5;
      var g = ctx.createRadialGradient(cx, cy, 0, cx, cy, t * 1.7);
      g.addColorStop(0, 'rgba(120, 230, 190, 0.16)');
      g.addColorStop(1, 'rgba(120, 230, 190, 0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(cx, cy, t * 1.7, 0, 6.2832);
      ctx.fill();
      for (var i = 0; i < 7; i++) {
        var a = i * 6.2832 / 7 + 0.4;
        drawTile(K.mushroom, cx + Math.cos(a) * t * 1.25 - t * 0.5, cy + Math.sin(a) * t * 1.05 - t * 0.5, s_of(t) * 1.15);
      }
    }

    function drawShellArch(sx, sy, t, now) {
      var cx = sx + t * 0.5;
      var base = sy + t * 1.1;
      ctx.strokeStyle = '#d8cdb4';
      ctx.lineWidth = Math.max(2, t * 0.10);
      ctx.beginPath();
      ctx.arc(cx, base, t * 0.95, Math.PI, 0);
      ctx.stroke();
      ctx.fillStyle = '#c85a4e';
      ctx.beginPath();
      ctx.arc(cx, base, t * 0.10, 0, 6.2832);
      ctx.fill();
      for (var i = 0; i < 3; i++) {
        var a = Math.PI + (0.4 + i * 0.4);
        var px = cx + Math.cos(a) * t * 0.95;
        var py = base + Math.sin(a) * t * 0.95;
        var sway = Math.sin(now * 0.0012 + i) * t * 0.03;
        ctx.fillStyle = 'rgba(232, 226, 212, 0.9)';
        ctx.beginPath();
        ctx.ellipse(px + sway, py + t * 0.16, t * 0.07, t * 0.10, 0.3, 0, 6.2832);
        ctx.fill();
      }
    }

    function drawTidePool(sx, sy, t, now) {
      var cx = sx + t * 0.5;
      var cy = sy + t * 0.5;
      ctx.fillStyle = 'rgba(10, 18, 34, 0.5)';
      ctx.beginPath();
      ctx.ellipse(cx, cy, t * 1.1, t * 0.5, 0, 0, 6.2832);
      ctx.fill();
      var g = ctx.createRadialGradient(cx, cy, 0, cx, cy, t * 1.0);
      g.addColorStop(0, 'rgba(120, 190, 255, 0.45)');
      g.addColorStop(0.7, 'rgba(90, 160, 230, 0.16)');
      g.addColorStop(1, 'rgba(90, 160, 230, 0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(cx, cy, t * 1.0, t * 0.44, 0, 0, 6.2832);
      ctx.fill();
      var p = 0.5 + 0.5 * Math.sin(now * 0.0018);
      ctx.strokeStyle = 'rgba(190, 230, 255, ' + (0.2 + 0.2 * p).toFixed(2) + ')';
      ctx.lineWidth = Math.max(1, t * 0.03);
      ctx.beginPath();
      ctx.ellipse(cx, cy, t * (0.4 + 0.3 * p), t * (0.18 + 0.14 * p), 0, 0, 6.2832);
      ctx.stroke();
      drawTile(K.rockA, sx - t * 0.7, sy - t * 0.2, s_of(t));
      drawTile(K.skull, sx + t * 1.0, sy - t * 0.3, s_of(t));
    }

    function drawWindmill(sx, sy, t, now) {
      var cx = sx + t * 0.5;
      var cy = sy + t * 0.2;
      // 矢量塔身（battle 23 只是叶片，没有建筑）
      ctx.fillStyle = 'rgba(3, 9, 13, 0.32)';
      ctx.beginPath();
      ctx.ellipse(cx + t * 0.5, sy + t * 1.3, t * 1.0, t * 0.36, 0, 0, 6.2832);
      ctx.fill();
      ctx.fillStyle = '#d8cdb4';
      ctx.beginPath();
      ctx.moveTo(cx - t * 0.42, sy + t * 1.3);
      ctx.lineTo(cx - t * 0.30, sy - t * 0.2);
      ctx.lineTo(cx + t * 0.30, sy - t * 0.2);
      ctx.lineTo(cx + t * 0.42, sy + t * 1.3);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = 'rgba(24, 20, 14, 0.25)';
      ctx.fillRect(cx + t * 0.06, sy - t * 0.2, t * 0.12, t * 1.5);
      ctx.fillStyle = '#8a4a3e';
      ctx.beginPath();
      ctx.moveTo(cx - t * 0.34, sy - t * 0.2);
      ctx.lineTo(cx, sy - t * 0.62);
      ctx.lineTo(cx + t * 0.34, sy - t * 0.2);
      ctx.closePath();
      ctx.fill();
      ctx.save();
      ctx.translate(cx, cy - t * 0.4);
      ctx.rotate(now * 0.0009);
      ctx.strokeStyle = 'rgba(240, 234, 218, 0.85)';
      ctx.lineWidth = Math.max(2, t * 0.09);
      for (var i = 0; i < 4; i++) {
        var a = i * 6.2832 / 4;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(Math.cos(a) * t * 1.05, Math.sin(a) * t * 1.05);
        ctx.stroke();
      }
      ctx.restore();
    }

    function drawFrost(sx, sy, t, now) {
      var cx = sx + t * 0.5;
      drawTile(K.rockPile, sx - t * 0.9, sy - t * 0.9, t * 3 / 16);
      var g = ctx.createRadialGradient(cx, sy, 0, cx, sy, t * 1.4);
      g.addColorStop(0, 'rgba(220, 238, 255, 0.18)');
      g.addColorStop(1, 'rgba(220, 238, 255, 0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(cx, sy, t * 1.4, 0, 6.2832);
      ctx.fill();
      for (var i = 0; i < 5; i++) {
        var fx = cx + Math.sin(now * 0.0006 + i * 2.2) * t * 1.1;
        var fy = sy - t * (0.4 + 0.3 * Math.abs(Math.sin(now * 0.0004 + i)));
        ctx.fillStyle = 'rgba(240, 248, 255, 0.5)';
        ctx.fillRect(fx, fy, 2, 2);
      }
    }

    var LANDMARK_DRAW = {
      lighthouse: drawLighthouse,
      crater: drawCrater,
      greattree: drawGreatTree,
      shrooms: drawShrooms,
      shellarch: drawShellArch,
      tidepool: drawTidePool,
      windmill: drawWindmill,
      frostone: drawFrost
    };

    // 石碑：Kenney 石板 + 苏醒后的符文光。
    function drawStele(sx, sy, t, now, rec) {
      var cx = sx + t * 0.5;
      var active = !!(rec && rec.by);
      if (!active) {
        ctx.fillStyle = 'rgba(3, 9, 13, 0.3)';
        ctx.beginPath();
        ctx.ellipse(cx, sy + t * 0.78, t * 0.4, t * 0.14, 0, 0, 6.2832);
        ctx.fill();
      }
      // 矢量立石（dungeon 25 是地板瓦片，不是独立石碑）
      var stw = t * 0.5;
      ctx.fillStyle = active ? '#8a84a8' : '#6e6e80';
      ctx.beginPath();
      ctx.moveTo(cx - stw / 2, sy + t * 0.62);
      ctx.lineTo(cx - stw * 0.36, sy - t * 0.30);
      ctx.quadraticCurveTo(cx, sy - t * 0.52, cx + stw * 0.36, sy - t * 0.30);
      ctx.lineTo(cx + stw / 2, sy + t * 0.62);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = 'rgba(255, 255, 255, 0.14)';
      ctx.beginPath();
      ctx.moveTo(cx - stw * 0.36, sy - t * 0.30);
      ctx.quadraticCurveTo(cx, sy - t * 0.52, cx, sy - t * 0.10);
      ctx.lineTo(cx - stw * 0.18, sy + t * 0.62);
      ctx.lineTo(cx - stw / 2, sy + t * 0.62);
      ctx.closePath();
      ctx.fill();
      if (active) {
        var pulse = 0.5 + 0.5 * Math.sin(now * 0.002 + (rec.x || 0));
        var g = ctx.createRadialGradient(cx, sy - t * 0.1, 0, cx, sy - t * 0.1, t * 1.1);
        g.addColorStop(0, 'rgba(202, 176, 255, ' + (0.30 + 0.16 * pulse).toFixed(3) + ')');
        g.addColorStop(1, 'rgba(202, 176, 255, 0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(cx, sy - t * 0.1, t * 1.1, 0, 6.2832);
        ctx.fill();
        ctx.strokeStyle = 'rgba(238, 226, 255, ' + (0.7 + 0.3 * pulse).toFixed(2) + ')';
        ctx.lineWidth = Math.max(1, t * 0.045);
        ctx.beginPath();
        ctx.moveTo(cx, sy - t * 0.28);
        ctx.lineTo(cx, sy + t * 0.02);
        ctx.moveTo(cx - t * 0.10, sy - t * 0.16);
        ctx.lineTo(cx + t * 0.10, sy - t * 0.16);
        ctx.moveTo(cx - t * 0.08, sy - t * 0.02);
        ctx.lineTo(cx + t * 0.08, sy - t * 0.02);
        ctx.stroke();
        drawFlame(sx + t * 0.55, sy - t * 0.42, s_of(t), now, 1);
      }
    }

    // ---------- 实体：星屑 / 光花 / 灯柱 ----------

    function drawNode(x, y, sx, sy, t, now) {
      var isMeteor = !!state.meteorNodes[x + ',' + y];
      if (!isMeteor) {
        if (!state.nodes || state.nodes.charCodeAt(y * state.size + x) !== 49) return;
      }
      if (state.gathered[x + ',' + y]) return;
      var n = hash2(x, y, 23);
      var pulse = 0.45 + 0.55 * Math.sin(now * 0.0032 + n * 6.283);
      var cx = sx + t * (0.35 + n * 0.3);
      var cy = sy + t * (0.35 + hash2(x, y, 29) * 0.3);
      var r = t * (0.07 + 0.03 * pulse);
      var glow = isMeteor ? '255, 190, 210' : '150, 232, 255';
      var core = isMeteor ? '255, 214, 228' : '206, 246, 255';

      var g = ctx.createRadialGradient(cx, cy, 0, cx, cy, t * 0.34);
      g.addColorStop(0, 'rgba(' + glow + ', ' + (0.34 * pulse).toFixed(3) + ')');
      g.addColorStop(1, 'rgba(' + glow + ', 0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(cx, cy, t * 0.34, 0, 6.2832);
      ctx.fill();

      ctx.fillStyle = 'rgba(' + core + ', ' + (0.55 + 0.45 * pulse).toFixed(3) + ')';
      ctx.beginPath();
      ctx.moveTo(cx, cy - r);
      ctx.lineTo(cx + r * 0.7, cy);
      ctx.lineTo(cx, cy + r);
      ctx.lineTo(cx - r * 0.7, cy);
      ctx.closePath();
      ctx.fill();
      if (isMeteor) {
        ctx.strokeStyle = 'rgba(255, 190, 210, ' + (0.30 + 0.30 * pulse).toFixed(3) + ')';
        ctx.lineWidth = Math.max(1, t * 0.022);
        ctx.beginPath();
        ctx.arc(cx, cy, t * (0.16 + 0.03 * pulse), 0, 6.2832);
        ctx.stroke();
      }
    }

    function drawFlower(fx, fy, sx, sy, t, now) {
      var key = fx + ',' + fy;
      var f = state.flowers[key];
      if (!f) return;
      // 星露谷的翻好土：深棕圆角块 + 三道沟纹。它不是花，是「明天」。
      if (f.species === -1) {
        var pad = t * 0.07;
        var wx = sx + pad;
        var wy = sy + pad;
        var ww = t - pad * 2;
        ctx.fillStyle = 'rgba(96, 70, 44, 0.82)';
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(wx, wy, ww, ww, t * 0.10);
        else ctx.rect(wx, wy, ww, ww);
        ctx.fill();
        ctx.strokeStyle = 'rgba(76, 55, 34, 0.9)';
        ctx.lineWidth = Math.max(1, t * 0.035);
        for (var g3 = 0; g3 < 3; g3++) {
          var gy3 = wy + ww * (0.28 + g3 * 0.22);
          ctx.beginPath();
          ctx.moveTo(wx + ww * 0.12, gy3);
          ctx.lineTo(wx + ww * 0.88, gy3);
          ctx.stroke();
        }
        return;
      }
      // v4.2 星露谷节拍：生长进度 = 已长节数 / 成熟天数（隔夜长一节）
      var cfA = (state.catalog.crops || [])[f.species] || { days: 1 };
      var age = clamp((f.growth || 0) / Math.max(1, cfA.days), 0, 1);
      var col = FLOWER_COLORS[f.species % FLOWER_COLORS.length];
      var seed = hash2(fx, fy, 733);
      var sway = Math.sin(now * 0.0011 + seed * 6.283) * 0.045;
      var cx = sx + t * (0.30 + seed * 0.40) + sway * t * 0.3;
      var baseY = sy + t * 0.78;
      var headY = baseY - t * (0.10 + age * 0.26);
      var budR = t * (0.055 + age * 0.085);

      if (age > 0.55) {
        var glowK = (age - 0.55) / 0.45;
        var g = ctx.createRadialGradient(cx, headY, 0, cx, headY, t * 0.78);
        g.addColorStop(0, 'rgba(' + col.glow + ', ' + (0.30 * glowK).toFixed(3) + ')');
        g.addColorStop(0.5, 'rgba(' + col.glow + ', ' + (0.10 * glowK).toFixed(3) + ')');
        g.addColorStop(1, 'rgba(' + col.glow + ', 0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(cx, headY, t * 0.78, 0, 6.2832);
        ctx.fill();
      }

      ctx.strokeStyle = 'rgba(52, 92, 66, 0.9)';
      ctx.lineWidth = Math.max(1, t * 0.030);
      ctx.beginPath();
      ctx.moveTo(sx + t * (0.30 + seed * 0.40), baseY);
      ctx.quadraticCurveTo(sx + t * (0.30 + seed * 0.40) - sway * t * 0.5, (baseY + headY) / 2, cx, headY + budR * 0.4);
      ctx.stroke();

      if (age < 0.34) {
        ctx.fillStyle = 'rgba(66, 118, 82, 0.9)';
        ctx.beginPath();
        ctx.ellipse(cx - budR, headY + budR * 1.4, budR * 1.1, budR * 0.5, -0.6, 0, 6.2832);
        ctx.fill();
        ctx.beginPath();
        ctx.ellipse(cx + budR, headY + budR * 1.6, budR * 1.1, budR * 0.5, 0.6, 0, 6.2832);
        ctx.fill();
        return;
      }

      var bloom = age < 0.62 ? (age - 0.34) / 0.28 : 1;
      var petalLen = budR * (0.8 + 1.7 * bloom);
      ctx.save();
      ctx.translate(cx, headY);
      for (var i = 0; i < 5; i++) {
        var a = i * 6.2832 / 5 + seed * 2.2;
        ctx.save();
        ctx.rotate(a);
        var grd = ctx.createLinearGradient(0, 0, petalLen, 0);
        grd.addColorStop(0, col.deep);
        grd.addColorStop(1, col.petal);
        ctx.fillStyle = grd;
        ctx.beginPath();
        ctx.ellipse(petalLen * 0.62, 0, petalLen * 0.62, petalLen * 0.34, 0, 0, 6.2832);
        ctx.fill();
        ctx.restore();
      }
      ctx.fillStyle = col.core;
      ctx.beginPath();
      ctx.arc(0, 0, budR * 0.62, 0, 6.2832);
      ctx.fill();
      ctx.restore();
    }

    function drawLamp(lamp, ox, oy, t, now) {
      var cx = ox + (lamp.x + 0.5) * t;
      var cy = oy + (lamp.y + 0.5) * t;
      var lc = LANTERN_COLORS[lamp.c] || LANTERN_COLORS['0'];
      var flicker = 0.92 + 0.08 * Math.sin(now * 0.004 + hash2(lamp.x, lamp.y, 31) * 6.283);
      var lx = cx;
      var ly = cy - t * 0.18;

      // 等级与暗涌：二级灯柱更亮更高，暗涌期全部缩到 55%
      var lvl = lamp.level >= 2 ? 1.45 : 1;
      var surgeK = state.surge && state.surge.active ? 0.55 : 1;

      // ---------- 光柱 ----------
      // 这是整个应用里最便宜的一次「多人感」升级：
      // 别人点的灯原来只有脚下一团光，你走到三格外才知道那儿有灯。
      // 加一道竖直光柱之后，隔着半张地图、隔着雾，你都能看见
      // 「那边有人来过」—— 而且能据此决定往哪走。
      // 严格说俯视视角没有「竖直」，但夜里读得懂的东西比物理正确重要。
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      var beamH = t * 4.2;
      var bw = t * 0.17;
      var bg = ctx.createLinearGradient(0, ly - t * 0.06, 0, ly - beamH);
      bg.addColorStop(0, 'rgba(' + lc.glow + ', ' + (0.26 * flicker).toFixed(3) + ')');
      bg.addColorStop(0.26, 'rgba(' + lc.glow + ', 0.10)');
      bg.addColorStop(0.60, 'rgba(' + lc.glow + ', 0.035)');
      bg.addColorStop(1, 'rgba(' + lc.glow + ', 0)');
      ctx.fillStyle = bg;
      ctx.beginPath();
      ctx.moveTo(lx - bw, ly - t * 0.06);
      ctx.lineTo(lx + bw, ly - t * 0.06);
      ctx.lineTo(lx + bw * 1.55, ly - beamH);
      ctx.lineTo(lx - bw * 1.55, ly - beamH);
      ctx.closePath();
      ctx.fill();
      // 柱心的亮芯：原来是第二个渐变，等于每盏灯两次全屏渐变合成。
      // 改成一次纯色填充 —— 视觉上几乎看不出差别，但省掉一半的填充开销。
      ctx.fillStyle = 'rgba(' + lc.core + ', 0.09)';
      ctx.fillRect(lx - bw * 0.32, ly - beamH * 0.52, bw * 0.64, beamH * 0.52 - t * 0.06);
      ctx.restore();

      var radius = t * (3.4 + 0.24 * flicker) * lvl * surgeK;
      var g = ctx.createRadialGradient(lx, ly, 0, lx, ly, radius);
      g.addColorStop(0, 'rgba(' + lc.glow + ', ' + (0.26 * flicker).toFixed(3) + ')');
      g.addColorStop(0.34, 'rgba(' + lc.glow + ', 0.12)');
      g.addColorStop(0.72, 'rgba(' + lc.glow + ', 0.035)');
      g.addColorStop(1, 'rgba(' + lc.glow + ', 0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(lx, ly, radius, 0, 6.2832);
      ctx.fill();

      ctx.save();
      ctx.translate(cx, cy + t * 0.30);
      ctx.scale(1, 0.42);
      var gr = ctx.createRadialGradient(0, 0, 0, 0, 0, t * 1.35);
      gr.addColorStop(0, 'rgba(' + lc.glow + ', ' + (0.22 * flicker).toFixed(3) + ')');
      gr.addColorStop(0.55, 'rgba(' + lc.glow + ', 0.07)');
      gr.addColorStop(1, 'rgba(' + lc.glow + ', 0)');
      ctx.fillStyle = gr;
      ctx.beginPath();
      ctx.arc(0, 0, t * 1.35, 0, 6.2832);
      ctx.fill();
      ctx.restore();

      ctx.fillStyle = '#3f3527';
      ctx.fillRect(cx - t * 0.030, cy - t * (0.14 + (lvl - 1) * 0.16), t * 0.060, t * (0.46 + (lvl - 1) * 0.30));

      ctx.fillStyle = '#4c3f2d';
      ctx.beginPath();
      ctx.moveTo(lx - t * 0.115, ly - t * 0.020);
      ctx.lineTo(lx + t * 0.115, ly - t * 0.020);
      ctx.lineTo(lx + t * 0.082, ly - t * 0.150);
      ctx.lineTo(lx - t * 0.082, ly - t * 0.150);
      ctx.closePath();
      ctx.fill();

      ctx.fillStyle = 'rgba(' + lc.core + ', ' + (0.86 + 0.14 * flicker).toFixed(3) + ')';
      ctx.beginPath();
      ctx.moveTo(lx - t * 0.085, ly - t * 0.036);
      ctx.lineTo(lx + t * 0.085, ly - t * 0.036);
      ctx.lineTo(lx + t * 0.058, ly - t * 0.128);
      ctx.lineTo(lx - t * 0.058, ly - t * 0.128);
      ctx.closePath();
      ctx.fill();

      ctx.fillStyle = 'rgba(255, 252, 238, 0.95)';
      ctx.beginPath();
      ctx.arc(lx, ly - t * 0.082, t * 0.032, 0, 6.2832);
      ctx.fill();
    }

    // ---------- 角色 ----------
    // 玩家仍是俯视斗篷棋子（帽子/提灯配色来自衣柜）；
    // NPC（id 前缀 npc_）用 Kenney 精灵 —— 一眼分辨「居民」和「同学」。

    var NPC_SPRITES = {
      npc_li: function() { return K.npcWarrior; },
      npc_yao: function() { return K.npcMage; },
      npc_lu: function() { return K.npcHood; },
      npc_lang: function() { return K.npcPriest; }
    };

    function isNpcId(id) {
      return String(id).indexOf('npc_') === 0;
    }

    // 正面 chibi 角色：大头小身、四肢、行走摆动、发型肤色按 id 确定性生成。
    // 朝向：0 下（露脸）/ 1 左 / 2 右（侧脸）/ 3 上（满头发的后脑勺）。
    // walkK ∈ [0,1]：行走强度（刚移动过为 1，静止为 0），驱动抬脚 / 摆臂 / 提灯摆动。
    function drawAvatar(cx, cy, t, color, dir, isSelf, name, now, hat, lanternId, npcSprite, walkK, sitK, pTitle) {
      var lc = LANTERN_COLORS[lanternId] || LANTERN_COLORS['0'];
      var walk = clamp(walkK || 0, 0, 1);
      var sit = clamp(sitK || 0, 0, 1);

      // ---- NPC：Kenney 精灵（专业像素画，和 chibi 玩家同一比例语言） ----
      if (npcSprite) {
        var g2 = ctx.createRadialGradient(cx, cy + t * 0.2, 0, cx, cy + t * 0.2, t * 0.6);
        g2.addColorStop(0, 'rgba(255, 232, 170, 0.16)');
        g2.addColorStop(1, 'rgba(255, 232, 170, 0)');
        ctx.fillStyle = g2;
        ctx.beginPath();
        ctx.arc(cx, cy + t * 0.2, t * 0.6, 0, 6.2832);
        ctx.fill();
        var bobN = Math.sin(now * 0.0032) * t * 0.012;
        var s16 = t / 16 * 1.5;
        drawTile(npcSprite, cx - s16 / 2, cy - s16 * 0.62 + bobN, s16);
        if (name) {
          var fs2 = Math.max(10, Math.round(t * 0.27));
          ctx.font = canvasFont(fs2, false);
          ctx.textAlign = 'center';
          ctx.textBaseline = 'alphabetic';
          ctx.lineWidth = Math.max(2, fs2 * 0.26);
          ctx.strokeStyle = 'rgba(4, 9, 18, 0.85)';
          ctx.strokeText(name, cx, cy - t * 0.44);
          ctx.fillStyle = '#ffe9b8';
          ctx.fillText(name, cx, cy - t * 0.44);
        }
        return;
      }

      // ---- 外观种子：color 由 id 哈希而来，等价于「每人一套」 ----
      var seedB = hashText(color);
      var skin = SKIN_TONES[(hash2(seedB, 1, 9001) * SKIN_TONES.length) | 0];
      var hair = HAIR_COLORS[(hash2(seedB, 2, 9002) * HAIR_COLORS.length) | 0];
      var style = (hash2(seedB, 3, 9003) * 4) | 0;

      // ---- 行走相位 ----
      var ph = now * 0.026;
      var bob = Math.abs(Math.sin(ph)) * 0.022 * t * walk
              + Math.sin(now * 0.0026 + seedB % 6.283) * 0.008 * t * (1 - walk)
              + sit * t * 0.055;
      var liftA = Math.max(0, Math.sin(ph)) * 0.035 * t * walk * (1 - sit);
      var liftB = Math.max(0, -Math.sin(ph)) * 0.035 * t * walk * (1 - sit);
      var armSwing = Math.sin(ph) * 0.018 * t * walk * (1 - sit);

      // ---- 影子 ----
      ctx.fillStyle = 'rgba(0, 0, 0, 0.30)';
      ctx.beginPath();
      ctx.ellipse(cx, cy + t * 0.30, t * 0.23, t * 0.075, 0, 0, 6.2832);
      ctx.fill();

      // ---- 自己：脚下脉冲环 ----
      if (isSelf) {
        var pr = 0.5 + 0.5 * Math.sin(now * 0.0035);
        ctx.strokeStyle = 'rgba(255, 226, 150, ' + (0.28 + 0.34 * pr).toFixed(3) + ')';
        ctx.lineWidth = Math.max(1, t * 0.035);
        ctx.beginPath();
        ctx.ellipse(cx, cy + t * 0.29, t * (0.27 + 0.06 * pr), t * (0.10 + 0.025 * pr), 0, 0, 6.2832);
        ctx.stroke();
      }

      var outline = 'rgba(26, 20, 30, 0.55)';
      var olW = Math.max(1, t * 0.018);

      // ---- 腿与靴 ----
      var legY0 = cy + t * 0.13;
      var legY1 = cy + t * 0.295;
      var legW = t * 0.062;
      if (sit > 0.5) {
        // 盘坐：一条宽暗影代替两条腿
        ctx.fillStyle = 'rgba(24, 18, 28, 0.55)';
        ctx.beginPath();
        ctx.ellipse(cx, cy + t * 0.235, t * 0.19, t * 0.075, 0, 0, 6.2832);
        ctx.fill();
      } else {
        ctx.fillStyle = '#2e2630';
        ctx.fillRect(cx - t * 0.105, legY0 - liftA, legW, legY1 - legY0 + liftA * 0.4);
        ctx.fillRect(cx + t * 0.105 - legW, legY0 - liftB, legW, legY1 - legY0 + liftB * 0.4);
        ctx.fillStyle = 'rgba(255, 255, 255, 0.10)';
        ctx.fillRect(cx - t * 0.105, legY0 - liftA, legW, Math.max(1, t * 0.014));
        ctx.fillRect(cx + t * 0.105 - legW, legY0 - liftB, legW, Math.max(1, t * 0.014));
      }

      // ---- 身体（罩袍）：上窄下宽的圆角梯形，左上受光 ----
      var bodyTop = cy - t * 0.05 + bob;
      var bodyBot = cy + t * 0.16 + bob * 0.5;
      var wTop = t * 0.150;
      var wBot = t * 0.195;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(cx - wTop, bodyTop);
      ctx.quadraticCurveTo(cx - wBot, bodyTop + (bodyBot - bodyTop) * 0.5, cx - wBot, bodyBot - t * 0.03);
      ctx.quadraticCurveTo(cx - wBot, bodyBot, cx - wBot + t * 0.03, bodyBot);
      ctx.lineTo(cx + wBot - t * 0.03, bodyBot);
      ctx.quadraticCurveTo(cx + wBot, bodyBot, cx + wBot, bodyBot - t * 0.03);
      ctx.quadraticCurveTo(cx + wBot, bodyTop + (bodyBot - bodyTop) * 0.5, cx + wTop, bodyTop);
      ctx.quadraticCurveTo(cx, bodyTop - t * 0.02, cx - wTop, bodyTop);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = outline;
      ctx.lineWidth = olW;
      ctx.stroke();
      // 右侧暗部
      ctx.fillStyle = 'rgba(10, 8, 18, 0.22)';
      ctx.beginPath();
      ctx.moveTo(cx + t * 0.02, bodyTop);
      ctx.quadraticCurveTo(cx + wBot, bodyTop + (bodyBot - bodyTop) * 0.5, cx + wBot, bodyBot - t * 0.03);
      ctx.quadraticCurveTo(cx + wBot, bodyBot, cx + wBot - t * 0.03, bodyBot);
      ctx.lineTo(cx + t * 0.02, bodyBot);
      ctx.closePath();
      ctx.fill();
      // 腰带 + 挂扣
      ctx.fillStyle = 'rgba(24, 18, 28, 0.55)';
      ctx.fillRect(cx - wBot, bodyBot - t * 0.055, wBot * 2, t * 0.028);
      ctx.fillStyle = 'rgba(255, 226, 160, 0.75)';
      ctx.fillRect(cx - t * 0.020, bodyBot - t * 0.058, t * 0.040, t * 0.034);

      // ---- 手臂：两条圆头短臂，行走时前后摆 ----
      ctx.strokeStyle = color;
      ctx.lineCap = 'round';
      ctx.lineWidth = t * 0.055;
      ctx.beginPath();
      ctx.moveTo(cx - t * 0.135, bodyTop + t * 0.015);
      ctx.lineTo(cx - t * 0.165 - armSwing, bodyTop + t * 0.115);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(cx + t * 0.135, bodyTop + t * 0.015);
      ctx.lineTo(cx + t * 0.165 + armSwing, bodyTop + t * 0.115);
      ctx.stroke();
      ctx.lineCap = 'butt';
      // 手（肤色圆头）
      ctx.fillStyle = skin.base;
      ctx.beginPath();
      ctx.arc(cx - t * 0.165 - armSwing, bodyTop + t * 0.125, t * 0.030, 0, 6.2832);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(cx + t * 0.165 + armSwing, bodyTop + t * 0.125, t * 0.030, 0, 6.2832);
      ctx.fill();

      // ---- 头（后发 → 脸 → 前发） ----
      var headR = t * 0.185;
      var headY = cy - t * 0.225 + bob;
      var faceX = dir === 1 ? -1 : (dir === 2 ? 1 : 0);
      var faceY = dir === 0 ? 1 : (dir === 3 ? -1 : 0);

      // 后发：比头大一圈的发团（上朝向时它就是全部）
      ctx.fillStyle = hair.shade;
      ctx.beginPath();
      ctx.ellipse(cx, headY + (faceY > 0 ? t * 0.008 : t * 0.014), headR * 1.10, headR * 1.08, 0, 0, 6.2832);
      ctx.fill();
      if (style === 3) {
        // 长发：两侧发束垂到肩
        ctx.beginPath();
        ctx.ellipse(cx - headR * 0.95, headY + t * 0.10, headR * 0.28, headR * 0.75, 0.12, 0, 6.2832);
        ctx.ellipse(cx + headR * 0.95, headY + t * 0.10, headR * 0.28, headR * 0.75, -0.12, 0, 6.2832);
        ctx.fill();
      }

      // 脸（上朝向不画脸，整头是后脑勺）
      if (dir !== 3) {
        ctx.fillStyle = skin.base;
        ctx.beginPath();
        ctx.arc(cx, headY, headR, 0, 6.2832);
        ctx.fill();
        // 脸颊受光
        var fg2 = ctx.createRadialGradient(cx - headR * 0.35, headY - headR * 0.35, 0, cx - headR * 0.35, headY - headR * 0.35, headR * 1.4);
        fg2.addColorStop(0, 'rgba(255, 255, 255, 0.18)');
        fg2.addColorStop(1, 'rgba(255, 255, 255, 0)');
        ctx.fillStyle = fg2;
        ctx.beginPath();
        ctx.arc(cx, headY, headR, 0, 6.2832);
        ctx.fill();
        ctx.strokeStyle = outline;
        ctx.lineWidth = olW;
        ctx.beginPath();
        ctx.arc(cx, headY, headR, 0, 6.2832);
        ctx.stroke();

        // 眼睛：下=双眼居中；左右=双眼朝向侧偏移
        var ex = cx + faceX * t * 0.055;
        var ey = headY + t * 0.012;
        var eyeGap = t * 0.066;
        // 眨眼：sin 的峰尖非常窄 —— 过阈值的窗口只有约 150ms，
        // 每次相位循环（约 5.7 秒）眨一次。角色立刻「活」了。
        var blink = Math.sin(now * 0.0011 + seedB * 2.7) > 0.985;
        ctx.fillStyle = '#2a2230';
        if (blink) {
          ctx.fillRect(ex - eyeGap - t * 0.024, ey - t * 0.006, t * 0.048, Math.max(1, t * 0.012));
          ctx.fillRect(ex + eyeGap - t * 0.024, ey - t * 0.006, t * 0.048, Math.max(1, t * 0.012));
        } else {
          ctx.beginPath();
          ctx.arc(ex - eyeGap, ey, t * 0.024, 0, 6.2832);
          ctx.arc(ex + eyeGap, ey, t * 0.024, 0, 6.2832);
          ctx.fill();
          // 眼里高光
          ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
          ctx.beginPath();
          ctx.arc(ex - eyeGap + t * 0.008, ey - t * 0.008, t * 0.008, 0, 6.2832);
          ctx.arc(ex + eyeGap + t * 0.008, ey - t * 0.008, t * 0.008, 0, 6.2832);
          ctx.fill();
        }
        // 腮红 + 小嘴
        ctx.fillStyle = 'rgba(240, 130, 120, 0.35)';
        ctx.beginPath();
        ctx.ellipse(ex - eyeGap - t * 0.028, ey + t * 0.030, t * 0.022, t * 0.013, 0, 0, 6.2832);
        ctx.ellipse(ex + eyeGap + t * 0.028, ey + t * 0.030, t * 0.022, t * 0.013, 0, 0, 6.2832);
        ctx.fill();
        ctx.strokeStyle = 'rgba(90, 60, 55, 0.7)';
        ctx.lineWidth = Math.max(1, t * 0.012);
        ctx.beginPath();
        ctx.arc(ex, ey + t * 0.038, t * 0.020, 0.35, 2.79);
        ctx.stroke();
      }

      // 前发：按朝向与发型盖在脸上沿
      ctx.fillStyle = hair.base;
      if (dir === 3) {
        // 后脑勺：满头发 + 中缝
        ctx.beginPath();
        ctx.arc(cx, headY, headR * 1.02, 0, 6.2832);
        ctx.fill();
        ctx.strokeStyle = hair.shade;
        ctx.lineWidth = Math.max(1, t * 0.014);
        ctx.beginPath();
        ctx.moveTo(cx, headY - headR * 0.9);
        ctx.lineTo(cx, headY + headR * 0.2);
        ctx.stroke();
      } else {
        // 发帽：盖住头顶 60%
        ctx.beginPath();
        ctx.ellipse(cx, headY - headR * 0.28, headR * 1.04, headR * 0.78, 0, Math.PI, 0);
        ctx.fill();
        // 刘海下沿（三段锯齿）
        var frY = headY - headR * 0.10;
        ctx.beginPath();
        ctx.moveTo(cx - headR * 1.02, frY);
        ctx.lineTo(cx - headR * 0.5, frY + headR * 0.28);
        ctx.lineTo(cx - headR * 0.05, frY + headR * 0.10);
        ctx.lineTo(cx + headR * 0.45, frY + headR * 0.30);
        ctx.lineTo(cx + headR * 1.02, frY);
        ctx.closePath();
        ctx.fill();
        // 侧发垂到脸颊
        ctx.beginPath();
        ctx.ellipse(cx - headR * 0.98, headY + headR * 0.18, headR * 0.22, headR * 0.48, 0.1, 0, 6.2832);
        ctx.ellipse(cx + headR * 0.98, headY + headR * 0.18, headR * 0.22, headR * 0.48, -0.1, 0, 6.2832);
        ctx.fill();
        // 发型细节
        if (style === 2) {
          ctx.beginPath();
          ctx.moveTo(cx - headR * 0.55, headY - headR * 0.75);
          ctx.lineTo(cx - headR * 0.35, headY - headR * 1.28);
          ctx.lineTo(cx - headR * 0.10, headY - headR * 0.82);
          ctx.lineTo(cx + headR * 0.15, headY - headR * 1.34);
          ctx.lineTo(cx + headR * 0.40, headY - headR * 0.80);
          ctx.closePath();
          ctx.fill();
        } else if (style === 1) {
          ctx.strokeStyle = hair.shade;
          ctx.lineWidth = Math.max(1, t * 0.014);
          ctx.beginPath();
          ctx.moveTo(cx, headY - headR * 1.0);
          ctx.lineTo(cx, headY - headR * 0.42);
          ctx.stroke();
        }
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.22)';
        ctx.lineWidth = Math.max(1, t * 0.016);
        ctx.beginPath();
        ctx.arc(cx, headY - headR * 0.10, headR * 0.72, Math.PI * 1.15, Math.PI * 1.7);
        ctx.stroke();
      }

      // ---- 帽子（正面视图重画） ----
      var hatId = String(hat || '0');
      if (hatId === '1') {
        ctx.fillStyle = 'rgba(216, 180, 106, 0.98)';
        ctx.beginPath();
        ctx.ellipse(cx, headY - headR * 0.42, headR * 1.55, headR * 0.42, 0, 0, 6.2832);
        ctx.fill();
        ctx.fillStyle = '#e8c67e';
        ctx.beginPath();
        ctx.ellipse(cx, headY - headR * 0.62, headR * 0.82, headR * 0.44, 0, Math.PI, 0);
        ctx.fill();
        ctx.fillStyle = '#8a4a3e';
        ctx.fillRect(cx - headR * 0.82, headY - headR * 0.56, headR * 1.64, headR * 0.20);
        ctx.strokeStyle = 'rgba(120, 90, 40, 0.5)';
        ctx.lineWidth = Math.max(1, t * 0.012);
        ctx.beginPath();
        ctx.ellipse(cx, headY - headR * 0.42, headR * 1.55, headR * 0.42, 0, 0, 6.2832);
        ctx.stroke();
      } else if (hatId === '2') {
        ctx.fillStyle = 'rgba(158, 74, 92, 0.98)';
        ctx.beginPath();
        ctx.ellipse(cx - headR * 0.16, headY - headR * 0.66, headR * 1.02, headR * 0.52, -0.16, 0, 6.2832);
        ctx.fill();
        ctx.fillStyle = 'rgba(206, 108, 126, 0.9)';
        ctx.beginPath();
        ctx.ellipse(cx - headR * 0.28, headY - headR * 0.80, headR * 0.52, headR * 0.26, -0.16, 0, 6.2832);
        ctx.fill();
        ctx.fillStyle = 'rgba(94, 40, 54, 0.95)';
        ctx.beginPath();
        ctx.arc(cx + headR * 0.10, headY - headR * 0.95, t * 0.020, 0, 6.2832);
        ctx.fill();
      } else if (hatId === '3') {
        ctx.fillStyle = 'rgba(96, 78, 168, 0.98)';
        ctx.beginPath();
        ctx.moveTo(cx - headR * 0.95, headY - headR * 0.40);
        ctx.quadraticCurveTo(cx, headY - headR * 1.15, cx + headR * 0.72, headY - headR * 1.62);
        ctx.quadraticCurveTo(cx + headR * 0.40, headY - headR * 0.85, cx + headR * 0.95, headY - headR * 0.40);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = 'rgba(255, 236, 170, 0.95)';
        ctx.beginPath();
        ctx.moveTo(cx + headR * 0.72, headY - headR * 1.62);
        ctx.lineTo(cx + headR * 0.80, headY - headR * 1.42);
        ctx.lineTo(cx + headR * 0.96, headY - headR * 1.36);
        ctx.lineTo(cx + headR * 0.80, headY - headR * 1.30);
        ctx.lineTo(cx + headR * 0.72, headY - headR * 1.12);
        ctx.lineTo(cx + headR * 0.64, headY - headR * 1.30);
        ctx.lineTo(cx + headR * 0.48, headY - headR * 1.36);
        ctx.lineTo(cx + headR * 0.64, headY - headR * 1.42);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = 'rgba(226, 214, 255, 0.7)';
        ctx.fillRect(cx - headR * 0.95, headY - headR * 0.46, headR * 1.90, headR * 0.16);
      } else if (hatId === '4') {
        for (var wi = 0; wi < 5; wi++) {
          var wa = Math.PI + (0.35 + wi * 0.575);
          var wx = cx + Math.cos(wa) * headR * 1.02;
          var wy = headY - headR * 0.30 + Math.sin(wa) * headR * 0.55;
          var wc = FLOWER_COLORS[wi % FLOWER_COLORS.length];
          ctx.fillStyle = wc.petal;
          ctx.beginPath();
          ctx.arc(wx, wy, t * 0.034, 0, 6.2832);
          ctx.fill();
          ctx.fillStyle = wc.core;
          ctx.beginPath();
          ctx.arc(wx, wy, t * 0.014, 0, 6.2832);
          ctx.fill();
        }
      } else if (hatId === '5') {
        var sxp = cx + headR * 0.88;
        var syp = headY - headR * 0.42;
        ctx.fillStyle = 'rgba(255, 240, 196, 0.98)';
        ctx.beginPath();
        ctx.moveTo(sxp, syp - t * 0.055);
        ctx.lineTo(sxp + t * 0.016, syp - t * 0.016);
        ctx.lineTo(sxp + t * 0.05, syp);
        ctx.lineTo(sxp + t * 0.016, syp + t * 0.016);
        ctx.lineTo(sxp, syp + t * 0.05);
        ctx.lineTo(sxp - t * 0.016, syp + t * 0.016);
        ctx.lineTo(sxp - t * 0.05, syp);
        ctx.lineTo(sxp - t * 0.016, syp - t * 0.016);
        ctx.closePath();
        ctx.fill();
      }

      // ---- 提灯：垂在手下的摆动灯 ----
      var side = dir === 1 ? -1 : 1;
      var handX = cx + side * t * 0.195 + (dir === 1 ? -armSwing : armSwing);
      var handY = bodyTop + t * 0.125;
      var swing = Math.sin(ph + 1.1) * 0.26 * walk + Math.sin(now * 0.0012 + seedB % 6.283) * 0.07;
      ctx.save();
      ctx.translate(handX, handY);
      ctx.rotate(swing * side);
      var lg = ctx.createRadialGradient(0, t * 0.13, 0, 0, t * 0.13, t * 0.44);
      lg.addColorStop(0, 'rgba(' + lc.glow + ', 0.50)');
      lg.addColorStop(0.4, 'rgba(' + lc.glow + ', 0.18)');
      lg.addColorStop(1, 'rgba(' + lc.glow + ', 0)');
      ctx.fillStyle = lg;
      ctx.beginPath();
      ctx.arc(0, t * 0.13, t * 0.44, 0, 6.2832);
      ctx.fill();
      ctx.strokeStyle = '#4a4038';
      ctx.lineWidth = Math.max(1, t * 0.016);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(0, t * 0.055);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0, t * 0.065, t * 0.022, Math.PI, 0);
      ctx.stroke();
      ctx.fillStyle = '#3a322a';
      roundRectPath(ctx, -t * 0.058, t * 0.075, t * 0.116, t * 0.135, t * 0.02);
      ctx.fill();
      ctx.fillStyle = 'rgba(' + lc.core + ', 0.96)';
      roundRectPath(ctx, -t * 0.040, t * 0.095, t * 0.080, t * 0.095, t * 0.012);
      ctx.fill();
      ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
      ctx.fillRect(-t * 0.030, t * 0.102, t * 0.020, t * 0.020);
      ctx.restore();

      // ---- 名字 + 称号 ----
      if (name) {
        var fs = Math.max(10, Math.round(t * 0.27));
        ctx.font = canvasFont(fs, false);
        ctx.textAlign = 'center';
        ctx.textBaseline = 'alphabetic';
        ctx.lineWidth = Math.max(2, fs * 0.24);
        ctx.strokeStyle = 'rgba(4, 9, 18, 0.85)';
        ctx.strokeText(name, cx, cy - t * 0.62);
        ctx.fillStyle = isSelf ? '#ffe9b8' : 'rgba(232, 240, 255, 0.92)';
        ctx.fillText(name, cx, cy - t * 0.62);
        // 称号小注：衣柜里的称号终于穿在身上 —— 金字小注悬在名字下方
        if (pTitle && pTitle !== 't_pick') {
          var tName = '';
          var tShop = (state.catalog.shop && state.catalog.shop.title) || [];
          for (var tsi = 0; tsi < tShop.length; tsi++) {
            if (tShop[tsi].id === pTitle) tName = tShop[tsi].name;
          }
          if (tName) {
            var tfs = Math.max(8, Math.round(t * 0.185));
            ctx.font = canvasFont(tfs, false);
            ctx.lineWidth = Math.max(1.5, tfs * 0.26);
            ctx.strokeStyle = 'rgba(4, 9, 18, 0.8)';
            ctx.strokeText('「' + tName + '」', cx, cy - t * 0.47);
            ctx.fillStyle = 'rgba(255, 217, 138, 0.88)';
            ctx.fillText('「' + tName + '」', cx, cy - t * 0.47);
          }
        }
      }
    }


    // ---------- 气泡（表情图形 / NPC 台词文字） ----------

    function drawGlyph(c, id, x, y, s) {
      c.save();
      c.translate(x, y);
      c.strokeStyle = 'rgba(48, 40, 34, 0.95)';
      c.fillStyle = 'rgba(48, 40, 34, 0.95)';
      c.lineWidth = Math.max(1, s * 0.13);
      c.lineCap = 'round';
      if (id === 'heart') {
        c.beginPath();
        c.moveTo(0, s * 0.55);
        c.bezierCurveTo(-s * 0.9, -s * 0.1, -s * 0.5, -s * 0.75, 0, -s * 0.25);
        c.bezierCurveTo(s * 0.5, -s * 0.75, s * 0.9, -s * 0.1, 0, s * 0.55);
        c.fill();
      } else if (id === 'note') {
        c.beginPath();
        c.ellipse(-s * 0.22, s * 0.35, s * 0.24, s * 0.18, -0.3, 0, 6.2832);
        c.fill();
        c.beginPath();
        c.moveTo(0, s * 0.3);
        c.lineTo(0, -s * 0.5);
        c.quadraticCurveTo(s * 0.5, -s * 0.45, s * 0.55, -s * 0.1);
        c.stroke();
      } else if (id === 'zzz') {
        c.font = '700 ' + Math.round(s * 1.15) + 'px system-ui, sans-serif';
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        c.fillText('Z', 0, 0);
      } else if (id === 'spark') {
        c.beginPath();
        c.moveTo(0, -s * 0.7);
        c.lineTo(s * 0.2, -s * 0.18);
        c.lineTo(s * 0.7, 0);
        c.lineTo(s * 0.2, s * 0.18);
        c.lineTo(0, s * 0.7);
        c.lineTo(-s * 0.2, s * 0.18);
        c.lineTo(-s * 0.7, 0);
        c.lineTo(-s * 0.2, -s * 0.18);
        c.closePath();
        c.fill();
      } else if (id === 'ask') {
        c.font = '700 ' + Math.round(s * 1.2) + 'px system-ui, sans-serif';
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        c.fillText('?', 0, 0);
      } else {
        c.beginPath();
        c.ellipse(0, s * 0.3, s * 0.34, s * 0.30, 0, 0, 6.2832);
        c.fill();
        for (var i = 0; i < 3; i++) {
          c.beginPath();
          c.arc(0, s * 0.05, s * (0.5 + i * 0.18), -2.3, -1.5);
          c.stroke();
        }
      }
      c.restore();
    }

    function drawEmoteBubble(sx, sy, t, rec, now) {
      var age = now - rec.at;
      if (age < 0 || age > 4200) return;
      var appear = sstep(0, 220, age);
      var fade = age > 3400 ? 1 - (age - 3400) / 800 : 1;
      var rise = Math.min(1, age / 4200) * t * 0.12;
      var bx = sx;
      var by = sy - t * 0.74 - rise;
      var bw = t * 0.72;
      var bh = t * 0.56;
      ctx.save();
      ctx.globalAlpha = clamp(appear * fade, 0, 1);
      ctx.fillStyle = 'rgba(252, 250, 244, 0.94)';
      roundRectPath(ctx, bx - bw / 2, by - bh / 2, bw, bh, bh * 0.42);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(bx - t * 0.06, by + bh / 2 - 1);
      ctx.lineTo(bx + t * 0.06, by + bh / 2 - 1);
      ctx.lineTo(bx, by + bh / 2 + t * 0.12);
      ctx.closePath();
      ctx.fill();
      drawGlyph(ctx, rec.id, bx, by, t * 0.19);
      ctx.restore();
    }

    // NPC 台词：白瓷气泡 + 像素字。宽度按文本实测，超宽折成两行。
    function drawSpeechBubble(sx, sy, t, rec, now) {
      var age = now - rec.at;
      if (age < 0 || age > 5200) return;
      var lines = state.catalog.speechLines;
      var text = lines && lines[rec.idx] ? String(lines[rec.idx]) : '';
      if (!text) return;
      var appear = sstep(0, 220, age);
      var fade = age > 4300 ? 1 - (age - 4300) / 900 : 1;
      var rise = Math.min(1, age / 5200) * t * 0.10;
      var fs = Math.max(10, Math.round(t * 0.24));
      ctx.font = canvasFont(fs, false);
      var maxChars = 10;
      var row1 = text;
      var row2 = '';
      if (text.length > maxChars) {
        row1 = text.slice(0, maxChars);
        row2 = text.slice(maxChars);
      }
      var w1 = ctx.measureText(row1).width;
      var w2 = row2 ? ctx.measureText(row2).width : 0;
      var bw = Math.max(w1, w2) + fs * 1.2;
      var bh = fs * (row2 ? 2.5 : 1.7);
      var bx = clamp(sx, bw / 2 + 6, view.w - bw / 2 - 6);
      var by = sy - t * 0.92 - rise;
      ctx.save();
      ctx.globalAlpha = clamp(appear * fade, 0, 1);
      ctx.fillStyle = 'rgba(252, 250, 244, 0.95)';
      roundRectPath(ctx, bx - bw / 2, by - bh / 2, bw, bh, bh * 0.4);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(sx - t * 0.06, by + bh / 2 - 1);
      ctx.lineTo(sx + t * 0.06, by + bh / 2 - 1);
      ctx.lineTo(sx, by + bh / 2 + t * 0.12);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = 'rgba(52, 42, 34, 0.96)';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(row1, bx, by - (row2 ? bh * 0.22 : 0));
      if (row2) ctx.fillText(row2, bx, by + bh * 0.22);
      ctx.restore();
    }

    // ---------- 流星雨与天空 ----------

    function drawMeteorBeacon(cx, cy, t, now) {
      var pulse = 0.5 + 0.5 * Math.sin(now * 0.0026);
      var g = ctx.createRadialGradient(cx, cy, 0, cx, cy, t * 2.6);
      g.addColorStop(0, 'rgba(255, 196, 214, ' + (0.10 + 0.08 * pulse).toFixed(3) + ')');
      g.addColorStop(0.5, 'rgba(255, 176, 200, 0.04)');
      g.addColorStop(1, 'rgba(255, 176, 200, 0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(cx, cy, t * 2.6, 0, 6.2832);
      ctx.fill();

      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(now * 0.0006);
      ctx.strokeStyle = 'rgba(255, 204, 220, ' + (0.34 + 0.22 * pulse).toFixed(3) + ')';
      ctx.lineWidth = Math.max(1.2, t * 0.05);
      ctx.setLineDash([t * 0.42, t * 0.34]);
      ctx.beginPath();
      ctx.arc(0, 0, t * 1.7, 0, 6.2832);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();

      var beam = ctx.createLinearGradient(cx, 0, cx, cy);
      beam.addColorStop(0, 'rgba(255, 210, 226, 0)');
      beam.addColorStop(0.65, 'rgba(255, 210, 226, ' + (0.05 + 0.04 * pulse).toFixed(3) + ')');
      beam.addColorStop(1, 'rgba(255, 224, 236, ' + (0.13 + 0.08 * pulse).toFixed(3) + ')');
      ctx.fillStyle = beam;
      ctx.fillRect(cx - t * 0.5, 0, t, cy);
    }

    function drawMeteorSky(now, w, h) {
      for (var i = 0; i < 8; i++) {
        var cycle = (now * 0.001 + i * 1.9 + hash2(i, 7, 511) * 2.4) % 5;
        if (cycle > 1.2) continue;
        var k = cycle / 1.2;
        var x0 = w * (0.05 + hash2(i, 1, 513) * 0.85) - k * w * 0.34;
        var y0 = -40 + k * h * (0.30 + hash2(i, 2, 517) * 0.5);
        var len = h * 0.16;
        var a = Math.sin(k * Math.PI) * 0.85;
        var grad = ctx.createLinearGradient(x0, y0, x0 + len * 0.42, y0 + len);
        grad.addColorStop(0, 'rgba(255, 232, 240, ' + a.toFixed(3) + ')');
        grad.addColorStop(0.25, 'rgba(255, 196, 216, ' + (a * 0.5).toFixed(3) + ')');
        grad.addColorStop(1, 'rgba(255, 180, 210, 0)');
        ctx.strokeStyle = grad;
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(x0 + len * 0.42, y0 + len);
        ctx.stroke();
        ctx.fillStyle = 'rgba(255, 246, 250, ' + a.toFixed(3) + ')';
        ctx.beginPath();
        ctx.arc(x0, y0, 1.6, 0, 6.2832);
        ctx.fill();
      }
    }

    // ---------- 鲸影与飞鸟 ----------
    // 鲸：云海深处的常驻居民。每 4~9 分钟从某座岛附近缓缓游过（约 40s）。
    var whale = { active: false, x: 0, y: 0, vx: 0, vy: 0, until: 0, nextAt: 0, spoke: false };
    var birds = [];
    var birdsNextAt = 0;

    function tickWhale(now) {
      if (!whale.active) {
        if (!whale.nextAt) whale.nextAt = now + 30000 + Math.random() * 60000;
        if (now >= whale.nextAt) {
          var isles = state.catalog.islands;
          var isle = isles && isles.length ? isles[Math.floor(Math.random() * isles.length)] : null;
          var cx = isle ? isle.cx : state.size / 2;
          var cy = isle ? isle.cy : state.size / 2;
          var ang = Math.random() * 6.283;
          var dist = 14 + Math.random() * 8;
          whale.x = cx + Math.cos(ang) * dist;
          whale.y = cy + Math.sin(ang) * dist;
          whale.vx = -Math.cos(ang) * 0.22 + (Math.random() - 0.5) * 0.06;
          whale.vy = -Math.sin(ang) * 0.22 + (Math.random() - 0.5) * 0.06;
          whale.until = now + 40000;
          whale.active = true;
          whale.spoke = false;
        }
        return;
      }
      whale.x += whale.vx * 0.032;
      whale.y += whale.vy * 0.032;
      if (now > whale.until) {
        whale.active = false;
        whale.nextAt = now + 240000 + Math.random() * 360000;
      }
    }

    function drawWhale(ox, oy, t, now) {
      if (!whale.active) return;
      var cx = ox + whale.x * t;
      var cy = oy + whale.y * t;
      if (cx < -t * 6 || cx > view.w + t * 6 || cy < -t * 6 || cy > view.h + t * 6) return;
      var ang = Math.atan2(whale.vy, whale.vx);
      var bob = Math.sin(now * 0.001) * t * 0.06;
      ctx.save();
      ctx.translate(cx, cy + bob);
      ctx.rotate(ang);
      var g = ctx.createRadialGradient(0, 0, 0, 0, 0, t * 3.2);
      g.addColorStop(0, 'rgba(8, 14, 28, 0.35)');
      g.addColorStop(0.5, 'rgba(8, 14, 28, 0.18)');
      g.addColorStop(1, 'rgba(8, 14, 28, 0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(0, 0, t * 3.2, 0, 6.2832);
      ctx.fill();
      ctx.fillStyle = 'rgba(10, 16, 30, 0.45)';
      ctx.beginPath();
      ctx.ellipse(0, 0, t * 2.3, t * 0.85, 0, 0, 6.2832);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(-t * 2.0, 0);
      ctx.lineTo(-t * 3.1, -t * 0.55);
      ctx.lineTo(-t * 2.7, 0);
      ctx.lineTo(-t * 3.1, t * 0.55);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(t * 0.2, -t * 0.7);
      ctx.lineTo(t * 0.7, -t * 1.25);
      ctx.lineTo(t * 1.0, -t * 0.62);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = 'rgba(190, 220, 255, 0.12)';
      ctx.lineWidth = Math.max(1, t * 0.05);
      ctx.beginPath();
      ctx.ellipse(-t * 1.4, t * 0.9, t * 1.8, t * 0.3, 0, 0, 6.2832);
      ctx.stroke();
      ctx.restore();
      if (!whale.spoke) {
        whale.spoke = true;
        audio.whale();
      }
    }

    function tickBirds(now) {
      if (!birdsNextAt) birdsNextAt = now + 15000 + Math.random() * 20000;
      if (now >= birdsNextAt && birds.length < 6) {
        var dirv = Math.random() > 0.5 ? 1 : -1;
        var baseY = 40 + Math.random() * (view.h * 0.3);
        for (var i = 0; i < 3; i++) {
          birds.push({
            x: dirv > 0 ? -30 - i * 22 : view.w + 30 + i * 22,
            y: baseY + Math.sin(i * 1.1) * 18,
            vx: dirv * (26 + Math.random() * 14),
            ph: Math.random() * 6.283
          });
        }
        birdsNextAt = now + 45000 + Math.random() * 60000;
      }
      for (var b = birds.length - 1; b >= 0; b--) {
        birds[b].x += birds[b].vx * 0.032;
        if (birds[b].x < -60 || birds[b].x > view.w + 60) birds.splice(b, 1);
      }
    }

    function drawBirds(now) {
      for (var i = 0; i < birds.length; i++) {
        var bd = birds[i];
        var flap = Math.sin(now * 0.012 + bd.ph);
        var w = 5 + flap * 2.4;
        ctx.strokeStyle = 'rgba(16, 22, 34, 0.66)';
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.moveTo(bd.x - w, bd.y - flap * 2);
        ctx.quadraticCurveTo(bd.x, bd.y + 2, bd.x + w, bd.y - flap * 2);
        ctx.stroke();
      }
    }

    // ---------- §7 渲染主循环 ----------

    // ---------- 镜头 ----------
    // 「贵」不在多边形，在每一秒都有人在替你安排视线。
    // 上一版镜头是死的：tile 只在 resize 时算一次，之后就是匀速跟随，
    // 全片没有一次震动、没有一次推拉。画面再细，读起来也是「一张会动的地图」。
    var cam = { shake: 0, zoom: 1, zoomTo: 1, hold: 0 };

    // 叠加而不是覆盖：采集中途撞上流星雨，震动应该更大而不是被抹平。
    function camShake(amount) {
      cam.shake = cam.shake + amount;
      if (cam.shake > 16) cam.shake = 16;
    }

    // 冲击式推拉：瞬间推到 zoomTo，hold 到期后自己退回 1。
    // 不做「一直缩着」是因为镜头必须回到正常，长缩会让玩家晕。
    function camPunch(z, ms) {
      cam.zoomTo = z;
      cam.hold = Date.now() + (ms || 200);
    }

    // ---------- 湖的映画与荷灯 ----------
    // 湖不该是一块深色贴图。荷灯是「夜里的湖」的灵魂：
    // 它们同时也是灯油的安全点 —— 站在湖边，灯火会慢慢回来。
    var lotusList = [];

    function buildLotusList() {
      lotusList = [];
      var size = state.size;
      var cells = state.cells;
      if (!cells || cells.length < size * size) return;
      for (var y = 4; y < size - 4; y++) {
        for (var x = 4; x < size - 4; x++) {
          if (cells.charCodeAt(y * size + x) - 48 !== 6) continue;
          if (hash2(x, y, 931) < 0.055 && lotusList.length < 26) {
            lotusList.push({ x: x + 0.30 + hash2(x, y, 933) * 0.4, y: y + 0.30 + hash2(x, y, 937) * 0.4, ph: hash2(x, y, 939) * 6.283 });
          }
        }
      }
    }

    function lightNearLotus(x, y) {
      var best = 1e9;
      for (var i = 0; i < lotusList.length; i++) {
        var lo = lotusList[i];
        var dx = lo.x - x;
        var dy = lo.y - y;
        var d = Math.sqrt(dx * dx + dy * dy);
        if (d < best) best = d;
      }
      return best;
    }

    // 湖面动画：星子的碎光 + 缓慢扩散的涟漪。只处理视野内的湖格。
    function drawLakeFx(ox, oy, t, now, x0, x1, y0, y1, size) {
      var cells = state.cells;
      for (var y = y0; y <= y1; y++) {
        for (var x = x0; x <= x1; x++) {
          if (x < 0 || y < 0 || x >= size || y >= size) continue;
          if (cells.charCodeAt(y * size + x) - 48 !== 6) continue;
          if (hash2(x, y, 941) > 0.16) continue;
          var tw = 0.5 + 0.5 * Math.sin(now * 0.0013 + hash2(x, y, 943) * 6.283);
          if (tw < 0.4) continue;
          var sx = ox + (x + hash2(x, y, 947)) * t;
          var sy = oy + (y + hash2(x, y, 949)) * t;
          ctx.fillStyle = 'rgba(170, 214, 255, ' + (0.20 * tw).toFixed(3) + ')';
          ctx.fillRect(sx, sy, Math.max(1.5, t * 0.09), Math.max(1, t * 0.028));
        }
      }
      // 荷灯
      for (var i = 0; i < lotusList.length; i++) {
        var lo = lotusList[i];
        var lx = ox + lo.x * t;
        var ly = oy + lo.y * t;
        if (lx < -t * 2 || lx > ox + view.w + t * 2 || ly < -t * 2 || ly > oy + view.h + t * 2) continue;
        var bob = Math.sin(now * 0.0016 + lo.ph) * t * 0.018;
        var pulse = 0.5 + 0.5 * Math.sin(now * 0.0021 + lo.ph * 2.0);
        var g = ctx.createRadialGradient(lx, ly + bob, 0, lx, ly + bob, t * 0.62);
        g.addColorStop(0, 'rgba(255, 214, 158, ' + (0.26 + 0.10 * pulse).toFixed(3) + ')');
        g.addColorStop(1, 'rgba(255, 214, 158, 0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(lx, ly + bob, t * 0.62, 0, 6.2832);
        ctx.fill();
        // 莲座：五瓣 + 暖芯
        for (var pi2 = 0; pi2 < 5; pi2++) {
          var pa = pi2 * 6.2832 / 5 + lo.ph;
          ctx.fillStyle = 'rgba(255, 196, 150, 0.85)';
          ctx.beginPath();
          ctx.ellipse(lx + Math.cos(pa) * t * 0.075, ly + bob + Math.sin(pa) * t * 0.055, t * 0.048, t * 0.030, pa, 0, 6.2832);
          ctx.fill();
        }
        ctx.fillStyle = 'rgba(255, 244, 214, 0.95)';
        ctx.beginPath();
        ctx.arc(lx, ly + bob, t * 0.038, 0, 6.2832);
        ctx.fill();
        // 偶发涟漪
        var rk = ((now * 0.001 + lo.ph * 3) % 4) / 4;
        if (rk < 0.45) {
          ctx.strokeStyle = 'rgba(170, 214, 255, ' + (0.22 * (1 - rk / 0.45)).toFixed(3) + ')';
          ctx.lineWidth = Math.max(1, t * 0.016);
          ctx.beginPath();
          ctx.ellipse(lx, ly + bob, t * (0.18 + rk * 1.5), t * (0.09 + rk * 0.7), 0, 0, 6.2832);
          ctx.stroke();
        }
      }
    }

    // ---------- 粒子与浮字 ----------
    // 一次采集要给出六层反馈：粒子、屏震、推拉、浮字、光环、音阶。
    // 缺任何一层，手感都会掉一档 —— 这就是「数字 +1」和「捡到东西」的差别。
    //
    // 坐标一律存世界格坐标（x+0.5），不存屏幕像素：
    // 镜头会震会缩放，存像素的粒子会跟着漂，一炸就散。
    var parts = [];
    var floats = [];

    function spawnParts(gx, gy, n, speed, lift, rgb, big) {
      for (var i = 0; i < n; i++) {
        var a = Math.random() * 6.2832;
        var sp = speed * (0.35 + Math.random() * 0.95);
        parts.push({
          x: gx + (Math.random() - 0.5) * 0.14,
          y: gy + (Math.random() - 0.5) * 0.14,
          vx: Math.cos(a) * sp,
          vy: Math.sin(a) * sp * 0.72 - lift,
          g: 3.4,
          life: 0,
          max: 0.42 + Math.random() * 0.40,
          r: (big ? 0.042 : 0.030) + Math.random() * 0.026,
          cr: rgb[0], cg: rgb[1], cb: rgb[2]
        });
      }
      // 硬上限：全班同时采集 + 一场流星雨也不该让数组无限长
      if (parts.length > 460) parts.splice(0, parts.length - 460);
    }

    // 光环：一圈从原点炸开的细环。它比粒子便宜得多，
    // 却是「撞击感」的主要来源 —— 粒子给碎屑，环给冲击波。
    function spawnRing(gx, gy, rgb) {
      parts.push({
        ring: 1, x: gx, y: gy, vx: 0, vy: 0, g: 0,
        life: 0, max: 0.42, r: 0.10, cr: rgb[0], cg: rgb[1], cb: rgb[2]
      });
    }

    function spawnFloat(gx, gy, text, rgb, size) {
      floats.push({
        x: gx, y: gy, life: 0, max: 1.10, text: text,
        cr: rgb[0], cg: rgb[1], cb: rgb[2], size: size || 0.30
      });
      if (floats.length > 24) floats.shift();
    }

    function tickParts(dt) {
      for (var i = parts.length - 1; i >= 0; i--) {
        var p = parts[i];
        p.life += dt;
        if (p.life >= p.max) { parts.splice(i, 1); continue; }
        if (p.ring) continue;
        p.vy += p.g * dt;
        // 空气阻力：不加的话碎屑会一路飞出屏幕，读起来像烟花不像光粉
        p.vx *= (1 - 2.2 * dt);
        p.x += p.vx * dt;
        p.y += p.vy * dt;
      }
      for (var j = floats.length - 1; j >= 0; j--) {
        var f = floats[j];
        f.life += dt;
        if (f.life >= f.max) { floats.splice(j, 1); continue; }
        f.y -= 0.85 * dt;
      }
    }

    function drawParts(ox, oy, t) {
      if (!parts.length) return;
      // 加法混合：光点叠在一起会变亮，这才是光的物理。
      // 用 source-over 叠三个粒子就是三个灰点，一眼廉价。
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (var i = 0; i < parts.length; i++) {
        var p = parts[i];
        var k = 1 - p.life / p.max;
        if (p.ring) {
          var rr = (0.10 + (1 - k) * 1.30) * t;
          ctx.strokeStyle = 'rgba(' + p.cr + ',' + p.cg + ',' + p.cb + ',' + (k * k * 0.55).toFixed(3) + ')';
          ctx.lineWidth = Math.max(1, t * 0.030 * k);
          ctx.beginPath();
          ctx.arc(ox + p.x * t, oy + p.y * t, rr, 0, 6.2832);
          ctx.stroke();
          continue;
        }
        // 平方淡出：尾巴比线性干净，线性到 0 之前会拖一条灰雾
        var a = k * k;
        ctx.fillStyle = 'rgba(' + p.cr + ',' + p.cg + ',' + p.cb + ',' + a.toFixed(3) + ')';
        ctx.beginPath();
        ctx.arc(ox + p.x * t, oy + p.y * t, p.r * t * (0.55 + k * 0.75), 0, 6.2832);
        ctx.fill();
      }
      ctx.restore();
    }

    function drawFloats(ox, oy, t) {
      if (!floats.length) return;
      ctx.save();
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (var i = 0; i < floats.length; i++) {
        var f = floats[i];
        var k = f.life / f.max;
        var a = k < 0.16 ? k / 0.16 : (1 - (k - 0.16) / 0.84);
        if (a < 0) a = 0;
        // 先涨一下再收：纯线性缩放读起来是机械的，人眼认「弹」
        var pop = 1 + Math.sin(Math.min(1, k * 2.4) * 3.1416) * 0.24;
        var fs = Math.round(f.size * t * pop);
        if (fs < 9) fs = 9;
        ctx.font = '600 ' + fs + 'px "PingFang SC", "Microsoft YaHei", system-ui, sans-serif';
        var tx = ox + f.x * t;
        var ty = oy + f.y * t;
        ctx.lineWidth = Math.max(2, fs * 0.22);
        ctx.strokeStyle = 'rgba(6, 10, 18, ' + (a * 0.75).toFixed(2) + ')';
        ctx.strokeText(f.text, tx, ty);
        ctx.fillStyle = 'rgba(' + f.cr + ',' + f.cg + ',' + f.cb + ',' + a.toFixed(2) + ')';
        ctx.fillText(f.text, tx, ty);
      }
      ctx.restore();
    }

    // 采集：普通星屑与星陨必须差一个量级，否则「稀有」只是提示语里的两个字
    function bombGather(gx, gy, isMeteor, gain) {
      spawnParts(gx, gy, isMeteor ? 34 : 20, isMeteor ? 2.1 : 1.35, 1.55,
                 isMeteor ? [255, 206, 132] : [255, 240, 202], isMeteor);
      spawnRing(gx, gy, isMeteor ? [255, 196, 120] : [214, 236, 255]);
      spawnFloat(gx, gy - 0.38, '+' + gain,
                 isMeteor ? [255, 214, 150] : [255, 244, 214],
                 isMeteor ? 0.42 : 0.30);
      camShake(isMeteor ? 6.0 : 3.4);
      camPunch(isMeteor ? 1.048 : 1.030, isMeteor ? 250 : 170);
    }

    // 点灯：光不是从地上长出来的，是从灯里炸开然后往上升。
    // 负重力 —— 火是往上走的，这一条比任何粒子形状都重要。
    function bombBuild(gx, gy) {
      for (var i = 0; i < 18; i++) {
        var a = Math.random() * 6.2832;
        var d = Math.random() * 0.42;
        parts.push({
          x: gx + Math.cos(a) * d,
          y: gy + Math.sin(a) * d * 0.7,
          vx: Math.cos(a) * 0.22,
          vy: -0.55 - Math.random() * 1.5,
          g: -0.9,
          life: 0,
          max: 0.90 + Math.random() * 0.90,
          r: 0.026 + Math.random() * 0.032,
          cr: 255, cg: 214, cb: 150
        });
      }
      if (parts.length > 460) parts.splice(0, parts.length - 460);
      spawnRing(gx, gy, [255, 208, 140]);
      camShake(4.2);
      camPunch(1.038, 260);
    }

    // ================= 灯火：血量 / 视野 / 唯一持续流失的资源 =================
    //
    // 为什么是「灯火」而不是一个血条：
    // 这个世界的情感全部长在灯上 —— 你点的灯柱、别人留下的灯柱、灯塔的光。
    // 把「还能撑多久」直接绑到灯上，玩法就不需要一句解释：
    // 火光弱了，世界就暗下去；火灭了，你被雾吞掉，醒来只剩一盏余烬。
    //
    // 三条规则撑起全部张力：
    //   ① 亮着就要烧：走路 1.15/秒，站着 0.55/秒 —— 站着也在熄，不能挂机
    //   ② 灯柱是补给点：站在点亮的灯 6 格内回火 4.2/秒，别人的灯一样管用
    //   ③ 火灭了就被吞：原地昏迷两秒半，醒来只剩 45 点火
    //
    // ⚠️ 数值链只在前端，服务端不参与。不是偷懒：
    // 这个值每秒钟都在变，上服务端就要处理断线、重放、补偿，
    // 而它没有任何经济后果 —— 典型的「客户端权威」状态。
    // 真正有后果的（星屑增减、灯柱持久化）全部已经走服务端接口。
    var LIGHT_MAX = 100;
    var lightState = {
      v: 100,
      veilAt: 0,          // 昏迷起始时间戳；非 0 时冻结一切并压黑屏
      hitAt: 0,           // 上次被雾灵偷火的时刻（冷却，防一帧连扣）
      safeR: 6.0,         // 灯柱安全半径（格）
      // ⚠️ 这两个数决定「这个应用欢不欢迎你发呆」。
      // 0.55/秒 我试过：站着不动三分钟就灭 —— 对一个课间打开、
      // 边聊边看的小应用来说太凶了，人会觉得自己被催。
      // 0.30 = 五分半钟，足够发呆；0.95 让「跑图」这件事有代价。
      drainIdle: 0.30,
      drainMove: 0.95,
      refill: 4.2
    };
    // 探针/自查用：把整个状态对象挂出去，方便直接设成低火看画面。
    window.__sgLightState = lightState;

    var wraiths = [];     // 雾灵：火弱时出现，朝玩家漂，碰到就偷火

    function lightNearLamp(x, y) {
      var keys = Object.keys(state.lamps);
      var best = 1e9;
      var bestLamp = null;
      for (var i = 0; i < keys.length; i++) {
        var lp = state.lamps[keys[i]];
        if (!lp) continue;
        var dx = lp.x - x;
        var dy = lp.y - y;
        var d = Math.sqrt(dx * dx + dy * dy);
        if (d < best) { best = d; bestLamp = lp; }
      }
      return { dist: best, lamp: bestLamp };
    }

    function spawnWraith() {
      var a = Math.random() * 6.2832;
      var r = 5.5 + Math.random() * 3.0;
      wraiths.push({
        x: (meFx > 0 ? meFx : state.me.x + 0.5) + Math.cos(a) * r,
        y: (meFy > 0 ? meFy : state.me.y + 0.5) + Math.sin(a) * r,
        ph: Math.random() * 6.2832,
        jit: Math.random()
      });
    }

    function updateLight(dt, now) {
      // 昏迷期间一切冻结：黑屏里掉火没有意义，还会让人以为卡住了
      if (lightState.veilAt) {
        if (now - lightState.veilAt > 3000) {
          lightState.veilAt = 0;
          root.className = root.className.replace(' is-faint', '');
        }
        return;
      }
      if (!state.ready) return;

      var moving = (Date.now() - lastMoveAt) < 300;
      var drain = (moving ? lightState.drainMove : lightState.drainIdle) * (state.surge && state.surge.active ? 1.35 : 1);

      var near = lightNearLamp((meFx > 0 ? meFx : state.me.x + 0.5), (meFy > 0 ? meFy : state.me.y + 0.5));
      var refill = 0;
      if (near.lamp && near.dist < lightState.safeR) {
        var k = 1 - near.dist / lightState.safeR;
        // 越靠近灯心回得越快，但外圈也有一点 ——
        // 否则「安全区」会变成一个必须精确踩中的点，走位变成找格子。
        refill = lightState.refill * (0.30 + k * 0.70);
      }
      // 荷灯：湖边的第二个安全区。它比灯柱弱一档 —— 湖是浪漫，灯塔是命。
      if (refill < lightState.refill * 0.8 && lotusList.length) {
        var ld = lightNearLotus((meFx > 0 ? meFx : state.me.x + 0.5), (meFy > 0 ? meFy : state.me.y + 0.5));
        if (ld < lightState.safeR) {
          var lk2 = 1 - ld / lightState.safeR;
          refill = Math.max(refill, lightState.refill * 0.62 * (0.30 + lk2 * 0.70));
        }
      }
      // 灯塔回火：旋转的光束扫过你的时候，灯火会亮一下 ——
      // 灯塔从「背景板」变成全图的太平洋灯塔：看到光束压过来，往那走就对了。
      var lhKey = null;
      var landmarksL = state.catalog.landmarks || [];
      for (var lbi = 0; lbi < landmarksL.length; lbi++) {
        if (landmarksL[lbi].key === 'lighthouse') { lhKey = landmarksL[lbi]; break; }
      }
      if (lhKey) {
        var lhx = lhKey.x + 0.5;
        var lhy = lhKey.y + 0.5;
        var pdx = (meFx > 0 ? meFx : state.me.x + 0.5) - lhx;
        var pdy = (meFy > 0 ? meFy : state.me.y + 0.5) - lhy;
        var pdist = Math.sqrt(pdx * pdx + pdy * pdy);
        if (pdist < 22) {
          var pAng = Math.atan2(pdy, pdx);
          var beamAng = (now * 0.00045) % Math.PI;
          var diff = Math.abs(pAng - beamAng) % Math.PI;
          if (diff > Math.PI / 2) diff = Math.PI - diff;
          if (diff < 0.11) {
            refill += 2.2;
            if (!lightState.beamHit || now - lightState.beamHit > 3000) {
              lightState.beamHit = now;
              spawnParts((meFx > 0 ? meFx : state.me.x + 0.5), state.me.y + 0.35, 8, 0.9, 1.3, [255, 226, 158], false);
            }
          }
        }
      }

      lightState.v += (refill - drain) * dt;
      if (lightState.v > LIGHT_MAX) lightState.v = LIGHT_MAX;
      if (lightState.v < 0) lightState.v = 0;

      // 雾灵：火低于 34% 才开始出现，越低越多，最多 4 只。
      // 这个阈值是「刚好在视野开始收窄之后」——威胁永远比惩罚早一步到。
      var lv = lightState.v / LIGHT_MAX;
      var want = 0;
      if (lv < 0.34) want = Math.min(4, 1 + Math.floor((0.34 - lv) / 0.09));
      var hadW = wraiths.length;
      while (wraiths.length < want) spawnWraith();
      while (wraiths.length > want) wraiths.pop();
      // 雾灵现身的一瞬要有声音：一支从高处滑下来的冷音。
      // 威胁先被耳朵听见，再被眼睛看见 —— 这是恐怖片的基本法。
      if (wraiths.length > hadW && prefs.sound) {
        try {
          var c3 = audio.ctx;
          var t3 = c3.currentTime;
          var o3 = c3.createOscillator();
          o3.type = 'sine';
          o3.frequency.setValueAtTime(660, t3);
          o3.frequency.exponentialRampToValueAtTime(196, t3 + 1.1);
          var g3 = c3.createGain();
          g3.gain.setValueAtTime(0, t3);
          g3.gain.linearRampToValueAtTime(0.07, t3 + 0.20);
          g3.gain.exponentialRampToValueAtTime(0.0001, t3 + 1.4);
          o3.connect(g3); g3.connect(audio.master);
          o3.start(t3); o3.stop(t3 + 1.5);
        } catch (e3) {}
      }

      for (var wi = 0; wi < wraiths.length; wi++) {
        var wr = wraiths[wi];
        var tx = ((meFx > 0 ? meFx : state.me.x + 0.5)) - wr.x;
        var ty = ((meFy > 0 ? meFy : state.me.y + 0.5)) - wr.y;
        var dd = Math.sqrt(tx * tx + ty * ty) || 1;
        // 1.15~1.5 格/秒：玩家一步 0.26 秒走 1 格（约 3.8 格/秒），
        // 所以永远跑得掉。它逼你走，不该逼死你。
        var spd = 1.15 + wr.jit * 0.35;
        wr.x += tx / dd * spd * dt;
        wr.y += ty / dd * spd * dt;
        wr.ph += dt * (1.7 + wr.jit);

        if (dd < 0.85 && now - lightState.hitAt > 900) {
          lightState.hitAt = now;
          lightState.v = Math.max(0, lightState.v - 9);
          wr.x -= tx / dd * 2.6;
          wr.y -= ty / dd * 2.6;
          cam.shake = Math.max(cam.shake, 5);
        }
      }

      if (lightState.v <= 0.01) {
        lightState.veilAt = now;
        lightState.v = 45;
        wraiths.length = 0;
        cam.shake = 14;
        // 屏幕压黑的同时把 DOM 层也沉下去：
        // 黑屏上还浮着摇杆、动作键和「顺着石板路走」的提示，读起来像卡死。
        root.className = root.className.replace(' is-faint', '') + ' is-faint';
        if (typeof toast === 'function') toast('灯火灭了　雾把你吞了下去', 'warm');
      }
    }

    function drawWraiths(ox, oy, t, now) {
      if (!wraiths.length) return;
      for (var i = 0; i < wraiths.length; i++) {
        var wr = wraiths[i];
        var sx = ox + wr.x * t;
        var sy = oy + wr.y * t;
        var bob = Math.sin(wr.ph * 1.7) * t * 0.09;
        var cy2 = sy + bob;
        var R = t * 1.00;

        // ⚠️ 这一层不能用 lighter。
        // 我第一版用 lighter 画小软团，结果三只雾灵是「三颗发光的珠子」——
        // lighter 在小半径高 alpha 下只会得到一个亮核，而幽灵要的是
        // 「一层浅色的雾形」：有面积、有轮廓、亮度不高。
        // 所以改回 source-over 半透明，并且整体放大到约一格高。
        var g = ctx.createRadialGradient(
          sx - R * 0.16, cy2 - R * 0.24, R * 0.05,
          sx, cy2 + R * 0.10, R * 0.78);
        g.addColorStop(0, 'rgba(216, 240, 250, 0.34)');
        g.addColorStop(0.36, 'rgba(160, 202, 226, 0.24)');
        g.addColorStop(0.72, 'rgba(98, 146, 182, 0.10)');
        g.addColorStop(1, 'rgba(72, 112, 152, 0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.ellipse(sx, cy2, R * 0.52, R * 0.80, 0, 0, 6.2832);
        ctx.fill();

        // 裙摆：两片更淡的下垂雾。有它才像「飘着的」，没有就是一个椭圆。
        ctx.fillStyle = 'rgba(124, 170, 200, 0.13)';
        ctx.beginPath();
        ctx.ellipse(sx - R * 0.22, cy2 + R * 0.54, R * 0.26, R * 0.42, -0.22, 0, 6.2832);
        ctx.ellipse(sx + R * 0.20, cy2 + R * 0.60, R * 0.23, R * 0.36, 0.18, 0, 6.2832);
        ctx.fill();

        // 两点冷光当眼睛：没有它，雾灵只是一团发亮的雾，没有「在看你了」。
        var ey = cy2 - R * 0.14;
        ctx.fillStyle = 'rgba(240, 252, 255, 0.80)';
        ctx.beginPath();
        ctx.ellipse(sx - R * 0.17, ey, R * 0.055, R * 0.042, 0, 0, 6.2832);
        ctx.ellipse(sx + R * 0.17, ey, R * 0.055, R * 0.042, 0, 0, 6.2832);
        ctx.fill();
      }
    }

    // ---------- 萤火虫 ----------
    // 「世界太空」不是靠加地标解决的：地标是「值得去一次」的点，
    // 空是「走在路上什么都没有」。所以补的是**路上的东西** ——
    // 二十几只贴着草面飘的光点，跟着玩家走，走到哪儿哪儿是活的。
    // 纯客户端、零同步、几乎零成本（每只一个 arc）。
    var motes = [];
    function ensureMotes() {
      if (motes.length) return;
      for (var i = 0; i < 26; i++) {
        motes.push({
          ox: (Math.random() - 0.5) * 22,
          oy: (Math.random() - 0.5) * 16,
          ph: Math.random() * 6.2832,
          sp: 0.10 + Math.random() * 0.16,
          rr: 0.55 + Math.random() * 0.75
        });
      }
    }

    function drawMotes(ox, oy, t, now) {
      ensureMotes();
      var cxp = (meFx > 0 ? meFx : state.me.x + 0.5);
      var cyp = (meFy > 0 ? meFy : state.me.y + 0.5);
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (var i = 0; i < motes.length; i++) {
        var m = motes[i];
        // 在玩家周围缓慢绕圈；超出 20 格就绕回来（永不消失，也不会扎堆在一处）
        var a = m.ph + now * 0.00013 * m.sp * 60;
        var mx = cxp + m.ox + Math.cos(a) * 2.2;
        var my = cyp + m.oy + Math.sin(a * 0.8) * 1.6;
        // 只在灯火能照到的范围里飘：飘到纯黑处会变成「黑暗里不该有光点」
        if (Math.abs(mx - cxp) > 11 || Math.abs(my - cyp) > 8) {
          m.ox = (Math.random() - 0.5) * 20;
          m.oy = (Math.random() - 0.5) * 14;
        }
        var sx = ox + mx * t;
        var sy = oy + my * t;
        if (sx < -t || sx > view.w + t || sy < -t || sy > view.h + t) continue;
        var blink = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(now * 0.0011 * m.rr + m.ph));
        // 偏暖、比星点大一点：要读成「虫子」，不是「星星」
        ctx.fillStyle = 'rgba(255, 208, 116, ' + (0.40 * blink).toFixed(3) + ')';
        ctx.beginPath();
        ctx.arc(sx, sy, t * 0.048 * m.rr, 0, 6.2832);
        ctx.fill();
      }
      ctx.restore();
    }

    // ---------- 黑暗层：把「剩下多少火」直接画成「还能看多远」 ----------
    //
    // 半分辨率离屏 + destination-out 挖洞。
    // 为什么不在主画布直接叠渐变：那样灯柱没法在黑暗里挖出光斑 ——
    // 而「走到别人点亮的灯旁边就安全」这条规则，必须靠光斑才看得见。
    // 半分辨率是因为这一层本来就是软边，缩一半看不出差别，代价直接降四倍。
    var darkCv = null;
    var darkCtx = null;

    function drawDarkness(ox, oy, t) {
      // 满火时整层跳过：此时边缘暗度只有 0.28，肉眼几乎看不出，
      // 但它是每帧一次全屏离屏合成 + 一次 drawImage —— 这是最贵的一层。
      // 让它只在「火开始弱」时出现，等于把代价挪到真正需要氛围的时刻。
      if (lightState.v > 92 && !wraiths.length) return;
      // 1/3 分辨率：这一层本来就是软边，缩到 1/3 与 1/2 看不出差别，
      // 像素量再少 55%。校园平板每帧预算只有 16ms，这 2~3ms 很关键。
      var dw = Math.ceil(view.w / 3);
      var dh = Math.ceil(view.h / 3);
      if (!darkCv) {
        darkCv = document.createElement('canvas');
        darkCtx = darkCv.getContext('2d');
      }
      if (darkCv.width !== dw || darkCv.height !== dh) {
        darkCv.width = dw;
        darkCv.height = dh;
      }
      var c = darkCtx;
      c.setTransform(1, 0, 0, 1, 0, 0);
      c.clearRect(0, 0, dw, dh);

      var lv = lightState.v / LIGHT_MAX;
      if (lv < 0) lv = 0;
      if (lv > 1) lv = 1;
      // 满火也留一点边缘暗角（0.30），火焰将尽时压到 0.88 ——
      // 「一直有一点点暗」比「忽然全黑」更像夜，也保住了画面本身的层次。
      // ⚠️ 暗到什么程度是这一层最关键的一次取舍。
      // 0.88 的顶格暗度我试过：画面确实「有危险感」，但同时整张地图读不出来，
      // 玩家只会觉得「卡了/糊了」。现在 0.78，并且把「全亮的中心区」从
      // 0.34R 抬到 0.58R —— 要让中心一片真的干净，人才有「站在光里」的感觉。
      var edge = 0.78 - lv * 0.50;
      var px = (ox + ((meFx > 0 ? meFx : state.me.x + 0.5)) * t) / 3;
      var py = (oy + ((meFy > 0 ? meFy : state.me.y + 0.5)) * t) / 3;
      // 视野：满火 10.2 格，半火 7.4，将尽 4.2
      var R = (4.2 + lv * 6.0) * t / 3;

      var g = c.createRadialGradient(px, py, R * 0.58, px, py, R * 1.75);
      g.addColorStop(0, 'rgba(5, 9, 18, 0)');
      g.addColorStop(0.42, 'rgba(5, 9, 18, ' + (edge * 0.40).toFixed(3) + ')');
      g.addColorStop(1, 'rgba(4, 7, 15, ' + edge.toFixed(3) + ')');
      c.fillStyle = g;
      c.fillRect(0, 0, dw, dh);

      var vis = [];
      var keys = Object.keys(state.lamps);
      for (var i = 0; i < keys.length; i++) {
        var lp = state.lamps[keys[i]];
        if (!lp) continue;
        var lx = (ox + (lp.x + 0.5) * t) / 3;
        var ly = (oy + (lp.y + 0.5) * t) / 3;
        var lr = t * (lp.level >= 2 ? 6.0 : 4.2) * (state.surge && state.surge.active ? 0.55 : 1) / 3;
        if (lx < -lr || lx > dw + lr || ly < -lr || ly > dh + lr) continue;
        vis.push([lx, ly, lr]);
      }

      // 灯柱挖洞
      c.globalCompositeOperation = 'destination-out';
      for (var a1 = 0; a1 < vis.length; a1++) {
        var vx = vis[a1][0], vy = vis[a1][1], vr = vis[a1][2];
        var lg = c.createRadialGradient(vx, vy, vr * 0.10, vx, vy, vr);
        lg.addColorStop(0, 'rgba(0, 0, 0, 0.88)');
        lg.addColorStop(0.52, 'rgba(0, 0, 0, 0.46)');
        lg.addColorStop(1, 'rgba(0, 0, 0, 0)');
        c.fillStyle = lg;
        c.beginPath();
        c.arc(vx, vy, vr, 0, 6.2832);
        c.fill();
      }

      // 挖完洞还要补暖光。
      // 只挖洞的话，灯下是一片「没那么黑的冷灰」—— 眼睛读到的是
      // 「这儿的雾薄一点」，不是「这儿有一盏灯」。必须往上加暖色，
      // 这一层用的是 lighter：加进黑暗层里的暖色，合成到场景上就是加光。
      c.globalCompositeOperation = 'lighter';
      for (var a2 = 0; a2 < vis.length; a2++) {
        var wx = vis[a2][0], wy = vis[a2][1], wr2 = vis[a2][2] * 0.92;
        var wg = c.createRadialGradient(wx, wy, wr2 * 0.06, wx, wy, wr2);
        wg.addColorStop(0, 'rgba(255, 196, 118, 0.26)');
        wg.addColorStop(0.38, 'rgba(248, 168, 92, 0.13)');
        wg.addColorStop(1, 'rgba(210, 132, 64, 0)');
        c.fillStyle = wg;
        c.beginPath();
        c.arc(wx, wy, wr2, 0, 6.2832);
        c.fill();
      }
      c.globalCompositeOperation = 'source-over';

      ctx.drawImage(darkCv, 0, 0, view.w, view.h);
    }

    // ---------- 脚下的火量环 ----------
    // 只在不满的时候出现。满火时它消失 —— 画面干净比「始终有个 UI」重要。
    function drawLightRing(cx, cy, t, now) {
      var lv = clamp(lightState.v / LIGHT_MAX, 0, 1);
      if (lv > 0.985) return;
      var R = t * 0.60;
      var px = cx;
      var py = cy + t * 0.30;
      ctx.save();
      ctx.lineWidth = Math.max(1.2, t * 0.034);
      ctx.strokeStyle = 'rgba(255, 214, 158, 0.16)';
      ctx.beginPath();
      ctx.arc(px, py, R, 0, 6.2832);
      ctx.stroke();

      ctx.strokeStyle = (lv > 0.28 ? 'rgba(255, 198, 122, ' : 'rgba(255, 128, 92, ') +
        (0.44 + (1 - lv) * 0.42).toFixed(3) + ')';
      ctx.lineWidth = Math.max(1.8, t * 0.050);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.arc(px, py, R, -1.5708, -1.5708 + 6.2832 * lv);
      ctx.stroke();

      // 低于 28% 开始呼吸 —— 用光的呼吸代替看不见的心跳音
      if (lv < 0.28) {
        var pulse = 0.5 + 0.5 * Math.sin(now * 0.006);
        ctx.strokeStyle = 'rgba(255, 118, 84, ' + (0.10 + pulse * 0.22).toFixed(3) + ')';
        ctx.lineWidth = Math.max(2, t * 0.085);
        ctx.beginPath();
        ctx.arc(px, py, R, -1.5708, -1.5708 + 6.2832 * lv);
        ctx.stroke();
      }
      ctx.restore();
    }

    function drawVeil(now) {
      if (!lightState.veilAt) return;
      var k = (now - lightState.veilAt) / 3000;
      if (k < 0) k = 0;
      if (k > 1) return;
      // 前一半全黑，之后退开 —— 先「什么都没有」，再「你还在原地」。
      // 全黑必须真的全黑（alpha 1.0）：留一层半透明的黑，玩家只会以为画面暗了。
      var a = k < 0.5 ? 1 : (1 - (k - 0.5) / 0.5);
      ctx.save();
      ctx.fillStyle = 'rgba(2, 4, 9, ' + a.toFixed(3) + ')';
      ctx.fillRect(0, 0, view.w, view.h);
      if (a > 0.22) {
        ctx.globalAlpha = a;
        ctx.textAlign = 'center';
        ctx.fillStyle = 'rgba(255, 226, 186, 0.74)';
        ctx.font = '500 17px system-ui, -apple-system, "PingFang SC", sans-serif';
        ctx.fillText('灯火灭了', view.w / 2, view.h / 2 - 4);
        ctx.fillStyle = 'rgba(198, 178, 152, 0.50)';
        ctx.font = '12px system-ui, -apple-system, "PingFang SC", sans-serif';
        ctx.fillText('雾散开的时候，你还站在原地', view.w / 2, view.h / 2 + 18);
      }
      ctx.restore();
    }

    function draw(now, dt) {
      var w = view.w;
      var h = view.h;
      // 兜底：任何直接调用方忘了传 dt 也不该让粒子算出 NaN 集体消失
      if (!(dt > 0)) dt = 0.016;

      // 对话时镜头取「玩家与说话人」的中点，并整体往上抬 1.3 格。
      // 不这么做的话，站在你南边的 NPC 一定被底部对话框压住 ——
      // 台词在屏幕上、人在框后面，这是最廉价的一种「不专业」。
      // 抬的是 camY（相机往南看），世界整体上移，人就从框里露出来了。
      // v4.9 丝滑移动：相机直接跟随浮点位置（每帧连续，不再跳格）
      // v4.10 开场演出期间：镜头交给叙事（飞向灯塔、摇回出生点）
      var focusX = (meFx > 0 ? meFx : state.me.x + 0.5);
      var focusY = (meFy > 0 ? meFy : state.me.y + 0.5);
      if (cinemaPlaying && cinemaCam) {
        focusX = cinemaCam.x;
        focusY = cinemaCam.y;
      }
      var talking = talkBox.hidden === false && talk.npc && state.players[talk.npc];
      if (talking) {
        var tp = state.players[talk.npc];
        focusX = (state.me.x + tp.x) * 0.5 + 0.5;
        focusY = (state.me.y + tp.y) * 0.5 + 0.5 + 1.3;
      }
      var camK = talking ? 0.11 : 0.25;
      view.camX += (focusX - view.camX) * camK;
      view.camY += (focusY - view.camY) * camK;
      if (Math.abs(focusX - view.camX) < 0.002) view.camX = focusX;
      if (Math.abs(focusY - view.camY) < 0.002) view.camY = focusY;

      // 震动衰减：每帧乘 0.86，一秒后只剩约 1%。
      // 用两个不同频率的正弦叠加，而不是 Math.random()：
      // 随机数每帧跳变，眼睛读到的是「画面在发霉」，不是「撞了一下」。
      if (cam.shake > 0.06) {
        cam.shake *= 0.86;
        if (cam.shake < 0.06) cam.shake = 0;
      } else {
        cam.shake = 0;
      }
      var shx = Math.sin(now * 0.093) * cam.shake + Math.sin(now * 0.213) * cam.shake * 0.45;
      var shy = Math.cos(now * 0.081) * cam.shake + Math.sin(now * 0.191) * cam.shake * 0.45;

      if (!cam.hold || Date.now() > cam.hold) cam.zoomTo = 1;
      cam.zoom += (cam.zoomTo - cam.zoom) * 0.14;
      if (Math.abs(cam.zoom - 1) < 0.0005) cam.zoom = 1;

      // 缩放乘在「格子尺寸」上，而不是 ctx.scale：
      // 底图、雾、实体、粒子全部走同一个 t，一旦用画布缩放，
      // 雾和地形各自的取样坐标会错开，接缝立刻裂开。
      var t = view.tile * cam.zoom;
      // 镜头下沉 10.5%：顶栏占了 96px（660 高的 14.5%），
      // 画布中心其实是「被顶栏切掉一截的可视区中心」。
      // 玩家压在画布正中时，上半屏有一整条被顶栏吃掉 ——
      // 高个子地标（灯塔、巨树）就永远只露出下半截。
      // 下沉之后玩家坐在真正可视区的中心，同时露出更多「前方」。
      var oyBias = Math.round(h * 0.105);
      var ox = Math.round(w / 2 - view.camX * t + shx);
      var oy = Math.round(h / 2 + oyBias - view.camY * t + shy);
      view.ox = ox;
      view.oy = oy;

      ctx.fillStyle = '#080d18';
      ctx.fillRect(0, 0, w, h);

      var x0 = Math.floor(-ox / t) - 1;
      var x1 = Math.ceil((w - ox) / t) + 1;
      var y0 = Math.floor(-oy / t) - 1;
      var y1 = Math.ceil((h - oy) / t) + 1;
      var size = state.size;

      drawTerrainLayer(ox, oy, t);
      if (fieldReady) drawSeaFx(ox, oy, t, now, x0, x1, y0, y1, size);
      if (fieldReady) drawLakeFx(ox, oy, t, now, x0, x1, y0, y1, size);
      // 鲸影贴着云海游（陆地之下、雾之上）
      drawWhale(ox, oy, t, now);

      groundNow = now;
      var pGrassA = new Path2D();
      var pGrassB = new Path2D();
      var pSandA = new Path2D();
      var pSandB = new Path2D();
      var pRipple = new Path2D();
      for (var dy = y0; dy <= y1; dy++) {
        for (var dx = x0; dx <= x1; dx++) {
          if (dx < 0 || dy < 0 || dx >= size || dy >= size) continue;
          collectGround(dx, dy, ox + dx * t, oy + dy * t, t, pGrassA, pGrassB, pSandA, pSandB, pRipple);
        }
      }
      ctx.strokeStyle = 'rgba(150, 212, 178, 0.30)';
      ctx.lineWidth = Math.max(1, t * 0.019);
      ctx.stroke(pGrassA);
      ctx.strokeStyle = 'rgba(120, 176, 150, 0.22)';
      ctx.lineWidth = Math.max(1, t * 0.017);
      ctx.stroke(pGrassB);
      ctx.fillStyle = 'rgba(255, 246, 216, 0.17)';
      ctx.fill(pSandA);
      ctx.fillStyle = 'rgba(64, 52, 36, 0.20)';
      ctx.fill(pSandB);
      ctx.strokeStyle = 'rgba(255, 247, 222, 0.17)';
      ctx.lineWidth = Math.max(1, t * 0.030);
      ctx.stroke(pRipple);

      // 启明岛住宅（在雾之下）
      for (var hi = 0; hi < HUB_HOUSES.length; hi++) {
        var hs = HUB_HOUSES[hi];
        var hsx = ox + hs.x * t;
        var hsy = oy + hs.y * t;
        if (hsx < -t * 5 || hsx > w + t * 5 || hsy < -t * 5 || hsy > h + t * 5) continue;
        if (state.explored && !state.explored[hs.y * size + hs.x]) continue;
        drawHouse(hs, ox, oy, t);
      }

      // 地标（Kenney 瓦片层，在雾之下，未探索区域自动被盖住）
      var landmarks = state.catalog.landmarks || [];
      for (var li = 0; li < landmarks.length; li++) {
        var lm = landmarks[li];
        var lx = ox + lm.x * t;
        var ly = oy + lm.y * t;
        if (lx < -t * 8 || lx > w + t * 8 || ly < -t * 8 || ly > h + t * 8) continue;
        if (!state.explored || !state.explored[lm.y * size + lm.x]) continue;
        var fn = LANDMARK_DRAW[lm.key];
        if (fn) fn(lx, ly, t, now);
      }
      // 石碑（世界数据来自 enter，苏醒状态由服务端记录）
      var steles = state.catalog.steles || [];
      for (var sd = 0; sd < steles.length; sd++) {
        var sdef = steles[sd];
        var ssx = ox + sdef.x * t;
        var ssy = oy + sdef.y * t;
        if (ssx < -t * 3 || ssx > w + t * 3 || ssy < -t * 3 || ssy > h + t * 3) continue;
        if (!state.explored || !state.explored[sdef.y * size + sdef.x]) continue;
        drawStele(ssx, ssy, t, now, state.steles[sdef.x + ',' + sdef.y] || sdef);
      }

      for (var fy = y0; fy <= y1; fy++) {
        for (var fx = x0; fx <= x1; fx++) {
          if (fx < 0 || fy < 0 || fx >= size || fy >= size) continue;
          drawPropsTile(fx, fy, ox + fx * t, oy + fy * t, t);
        }
      }

      // 光花画在雾之下
      for (var gy = y0; gy <= y1; gy++) {
        for (var gx = x0; gx <= x1; gx++) {
          if (gx < 0 || gy < 0 || gx >= size || gy >= size) continue;
          if (state.flowers[gx + ',' + gy]) drawFlower(gx, gy, ox + gx * t, oy + gy * t, t, now);
        }
      }

      // v4.7 采集节点呼吸标记（树 / 矿）
      drawGatherNodes(ox, oy, t, now, x0, x1, y0, y1, size);
      // v4.14 《先行者的信》信点
      drawLetters(ox, oy, t, now);

      drawFogLayer(ox, oy, t);

      for (var ny = y0; ny <= y1; ny++) {
        for (var nx = x0; nx <= x1; nx++) {
          if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
          if (!state.explored || !state.explored[ny * size + nx]) continue;
          if ((state.nodes && state.nodes.charCodeAt(ny * size + nx) === 49) || state.meteorNodes[nx + ',' + ny]) {
            drawNode(nx, ny, ox + nx * t, oy + ny * t, t, now);
          }
        }
      }

      var lampKeys = Object.keys(state.lamps);
      for (var lk = 0; lk < lampKeys.length; lk++) {
        var lamp = state.lamps[lampKeys[lk]];
        if (!lamp) continue;
        if (lamp.x < x0 - 3 || lamp.x > x1 + 3 || lamp.y < y0 - 3 || lamp.y > y1 + 3) continue;
        drawLamp(lamp, ox, oy, t, now);
      }

      if (state.meteor && state.meteor.active) {
        var mx = ox + (state.meteor.x + 0.5) * t;
        var my = oy + (state.meteor.y + 0.5) * t;
        if (mx > -t * 4 && mx < w + t * 4 && my > -t * 4 && my < h + t * 4) {
          drawMeteorBeacon(mx, my, t, now);
        }
      }

      if (fishing) {
        var fk = clamp((now - fishing.at) / 2200, 0, 1);
        var sxx = ox + ((meFx > 0 ? meFx : state.me.x + 0.5)) * t;
        var syy = oy + ((meFy > 0 ? meFy : state.me.y + 0.5)) * t;
        var fxv = state.me.dir === 1 ? -1 : (state.me.dir === 2 ? 1 : 0);
        var fyv = state.me.dir === 0 ? 1 : (state.me.dir === 3 ? -1 : 0);
        if (!fxv && !fyv) fyv = 1;
        var bobx = sxx + fxv * t * 0.95;
        var boby = syy + fyv * t * 1.05 + Math.sin(now * 0.006) * t * 0.02;
        ctx.strokeStyle = 'rgba(230, 238, 250, 0.55)';
        ctx.lineWidth = Math.max(1, t * 0.018);
        ctx.beginPath();
        ctx.moveTo(sxx + fxv * t * 0.15, syy + fyv * t * 0.15 - t * 0.18);
        ctx.quadraticCurveTo((sxx + bobx) / 2 + fxv * t * 0.2, (syy + boby) / 2 - t * 0.22, bobx, boby);
        ctx.stroke();
        ctx.fillStyle = 'rgba(255, 216, 150, 0.95)';
        ctx.beginPath();
        ctx.arc(bobx, boby, t * 0.05, 0, 6.2832);
        ctx.fill();
        var rip = 0.2 + fk * 0.5;
        ctx.strokeStyle = 'rgba(214, 232, 255, ' + (0.30 * (1 - fk) + 0.10).toFixed(3) + ')';
        ctx.lineWidth = Math.max(1, t * 0.02);
        ctx.beginPath();
        ctx.ellipse(bobx, boby + t * 0.04, t * rip, t * rip * 0.45, 0, 0, 6.2832);
        ctx.stroke();
      }

      // 自动行走：目的地脉冲环 + 前 8 格虚线路径
      if (walkDest && walkPath.length) {
        var mwx = ox + (walkDest.x + 0.5) * t;
        var mwy = oy + (walkDest.y + 0.5) * t;
        var wpulse = 0.5 + 0.5 * Math.sin(now * 0.006);
        ctx.strokeStyle = 'rgba(255, 226, 150, ' + (0.55 + 0.30 * wpulse).toFixed(3) + ')';
        ctx.lineWidth = Math.max(1.5, t * 0.045);
        ctx.beginPath();
        ctx.ellipse(mwx, mwy, t * (0.26 + 0.08 * wpulse), t * (0.15 + 0.05 * wpulse), 0, 0, 6.2832);
        ctx.stroke();
        ctx.setLineDash([t * 0.10, t * 0.15]);
        ctx.strokeStyle = 'rgba(255, 226, 150, 0.38)';
        ctx.lineWidth = Math.max(1, t * 0.028);
        ctx.beginPath();
        ctx.moveTo(ox + ((meFx > 0 ? meFx : state.me.x + 0.5)) * t, oy + ((meFy > 0 ? meFy : state.me.y + 0.5)) * t);
        var trailN = Math.min(walkPath.length, 8);
        for (var wi3 = 0; wi3 < trailN; wi3++) {
          ctx.lineTo(ox + (walkPath[wi3].x + 0.5) * t, oy + (walkPath[wi3].y + 0.5) * t);
        }
        ctx.stroke();
        ctx.setLineDash([]);
      }

      var ids = Object.keys(state.players);
      for (var pi = 0; pi < ids.length; pi++) {
        var p = state.players[ids[pi]];
        if (!p) continue;
        var k = clamp((now - p.t) / LERP_MS, 0, 1);
        var px = p.px + (p.x - p.px) * k;
        var py = p.py + (p.y - p.py) * k;
        if (px < x0 - 2 || px > x1 + 2 || py < y0 - 2 || py > y1 + 2) continue;
        // ⚠️ 这里原来给 NPC 传 Kenney 精灵（npcSpr）。16px 硬像素放大到这个尺寸之后，
        // 居民变成了画面上唯一一块「马赛克」，和程序化底图、矢量小物、矢量小人全冲突。
        // 现在统一走矢量：靠低饱和的 NPC_TONE 和头顶标记区分居民，不靠画风。
        var isNpc = isNpcId(p.id);
        var walkK = clamp(1 - (now - p.t) / 450, 0, 1);
        // 走路扬尘：迈步时脚下撒起两粒浮尘 —— 「重量感」的最低成本方案
        if (walkK > 0.5 && !isNpc && now - (p.lastPuff || 0) > 340) {
          p.lastPuff = now;
          spawnParts(px + 0.5, py + 0.62, 2, 0.16, 0.06, [142, 130, 110], false);
        }
        var sitK = isNpc ? 0 : clamp(1 - (now - p.t) / 12000, 0, 1) * 0 + ((now - p.t) > 12000 ? 1 : 0);
        drawAvatar(ox + (px + 0.5) * t, oy + (py + 0.5) * t, t * AVATAR_SCALE, playerColor(p.id), p.dir, false, p.name, now, p.hat, p.lantern, null, walkK, sitK, p.title);
        // 头顶「…」：不用玩家自己去点 NPC，远远看见就知道这个人有话要说。
        if (isNpc && !talkMarkHidden(p.id)) {
          var mkX = ox + (px + 0.5) * t;
          var mkY = oy + (py + 0.5) * t - t * 0.82 + Math.sin(now * 0.0038 + (p.x + p.y) * 0.7) * t * 0.045;
          ctx.save();
          ctx.fillStyle = 'rgba(255, 226, 178, 0.92)';
          ctx.beginPath();
          ctx.arc(mkX - t * 0.072, mkY, t * 0.027, 0, 6.2832);
          ctx.arc(mkX, mkY, t * 0.027, 0, 6.2832);
          ctx.arc(mkX + t * 0.072, mkY, t * 0.027, 0, 6.2832);
          ctx.fill();
          ctx.restore();
        }
      }

      var selfWalk = clamp(1 - (Date.now() - lastMoveAt) / 450, 0, 1);
      if (selfWalk > 0.5 && Date.now() - (state.me.lastPuff || 0) > 340) {
        state.me.lastPuff = Date.now();
        spawnParts((meFx > 0 ? meFx : state.me.x + 0.5), state.me.y + 0.62, 2, 0.16, 0.06, [142, 130, 110], false);
      }
      var selfSit = clamp((Date.now() - lastMoveAt - 12000) / 2000, 0, 1);
      drawAvatar(ox + (meFx > 0 ? meFx : state.me.x + 0.5) * t,
                 oy + (meFy > 0 ? meFy : state.me.y + 0.5) * t, t * AVATAR_SCALE,
        playerColor(myId || 'me'), state.me.dir, true, state.me.name, now, state.me.hat, state.me.lantern, null, selfWalk, selfSit, state.me.title);

      // 气泡（表情图形 + NPC 台词）
      for (var ei = 0; ei < state.emoteFx.length; ei++) {
        var rec = state.emoteFx[ei];
        if (now - rec.at > 4200) continue;
        // 表情的「动作层」：刚发出的 300ms 内给一次粒子/环爆，
        // 颜色跟表情走 —— 比心飘粉、欢呼炸金、疑问冒蓝。
        if (!rec.burst && now - rec.at < 400) {
          rec.burst = 1;
          var bc = rec.id === 'heart' ? [255, 150, 170] : (rec.id === 'spark' ? [255, 214, 130] : (rec.id === 'note' ? [150, 200, 255] : [200, 190, 255]));
          spawnParts(rec.x + 0.5, rec.y + 0.3, rec.id === 'spark' ? 14 : 8, 0.7, 1.1, bc, false);
          if (rec.id === 'spark') spawnRing(rec.x + 0.5, rec.y + 0.3, bc);
        }
        var target = rec.uid === myId ? null : state.players[rec.uid];
        var ex = rec.uid === myId ? state.me.x : (target ? target.x : rec.x);
        var ey = rec.uid === myId ? state.me.y : (target ? target.y : rec.y);
        var esx = ox + (ex + 0.5) * t;
        var esy = oy + (ey + 0.5) * t;
        if (esx < -t || esx > w + t || esy < -t || esy > h + t) continue;
        drawEmoteBubble(esx, esy, t, rec, now);
      }
      for (var si2 = 0; si2 < state.speechFx.length; si2++) {
        var sp = state.speechFx[si2];
        if (now - sp.at > 5200) continue;
        var st2 = state.players[sp.uid];
        if (!st2) continue;
        var spx = ox + (st2.x + 0.5) * t;
        var spy = oy + (st2.y + 0.5) * t;
        if (spx < -t * 2 || spx > w + t * 2 || spy < -t * 2 || spy > h + t * 2) continue;
        drawSpeechBubble(spx, spy, t, sp, now);
      }

      if (state.meteor && state.meteor.active) drawMeteorSky(now, w, h);

      for (var mi = 0; mi < 22; mi++) {
        var sx0 = hash2(mi, 0, 71);
        var sy0 = hash2(mi, 0, 73);
        var driftX = (sx0 * w + Math.sin(now * 0.00013 + mi * 1.3) * 26 + now * 0.0045 * (0.4 + sy0)) % (w + 40);
        var driftY = (sy0 * h + Math.cos(now * 0.00017 + mi * 1.7) * 20) % h;
        if (driftX < 0) driftX += w + 40;
        if (driftY < 0) driftY += h;
        var ma = 0.10 + 0.20 * Math.abs(Math.sin(now * 0.0009 + mi * 0.9));
        ctx.fillStyle = 'rgba(202, 236, 255, ' + ma.toFixed(2) + ')';
        ctx.fillRect(driftX - 20, driftY, 1.7, 1.7);
      }

      tickWhale(now);
      tickBirds(now);
      drawBirds(now);

      // 粒子和浮字插在暗角之前：天象色要能染到粒子上，整幅画面才是一个整体；
      // 暗角若压在粒子上，光点会被压成灰点，白炸一场。
      tickParts(dt);
      drawParts(ox, oy, t);

      // 雾压在色调层之下：天象变色时必须连雾一起染，
      // 否则雾永远是一层灰白，画面像「贴了张雾的 PNG」。
      drawMist(ox, oy, t, now, w, h);

      var tint = STAGE_TINTS[clamp(state.stage, 0, STAGE_TINTS.length - 1)];
      var tintG = ctx.createLinearGradient(0, 0, 0, h);
      tintG.addColorStop(0, tint.top);
      tintG.addColorStop(1, tint.bot);
      ctx.fillStyle = tintG;
      ctx.fillRect(0, 0, w, h);

      var moon = ctx.createLinearGradient(0, 0, w * 1.05, h * 1.12);
      moon.addColorStop(0, 'rgba(122, 168, 230, 0.075)');
      moon.addColorStop(0.44, 'rgba(122, 168, 230, 0)');
      moon.addColorStop(0.72, 'rgba(6, 12, 24, 0.10)');
      moon.addColorStop(1, 'rgba(3, 7, 16, 0.26)');
      ctx.fillStyle = moon;
      ctx.fillRect(0, 0, w, h);

      var vignette = ctx.createRadialGradient(w * 0.5, h * 0.46, 0, w * 0.5, h * 0.46, Math.max(w, h) * 0.9);
      vignette.addColorStop(0, 'rgba(255, 226, 174, 0.05)');
      vignette.addColorStop(0.62, 'rgba(10, 18, 32, 0.03)');
      vignette.addColorStop(1, 'rgba(4, 8, 16, 0.38)');
      ctx.fillStyle = vignette;
      ctx.fillRect(0, 0, w, h);

      // 黑暗层压在暗角之后、浮字之前：
      // 它必须盖住世界（那是「你看不见」），又必须让「+1」透出来。
      drawDarkness(ox, oy, t);

      // ⚠️ 雾灵和火量环必须画在黑暗层**之后**。
      // 这两个东西都是「发光的信使」，压在黑暗底下等于自己把自己关掉 ——
      // 我第一次就是这么写的，低火截图里雾灵只剩两团看不清的蓝灰斑。
      drawMotes(ox, oy, t, now);
      drawWraiths(ox, oy, t, now);
      drawLightRing(ox + (meFx > 0 ? meFx : state.me.x + 0.5) * t,
                    oy + (meFy > 0 ? meFy : state.me.y + 0.5) * t, t, now);
      drawVeil(now);

      // v4.6 宅基地牌子：每个走进群岛的人都有自己的农舍
      drawHouseSigns(ox, oy, t, now);
      // v4.10 目标箭头（屏幕边缘）
      drawGoalArrow(ox, oy, t, now);

      // 界标与罗盘画在浮字之前：两者都是「发光的信使」，
      // 必须盖过黑暗层才成立（和雾灵同理）。
      drawWorldEdge(ox, oy, t, now);
      // v4.5 星露谷的雨天：斜落的雨丝 + 地面涟漪感。雨是休息日。
      if (state.weather === 'rain') {
        ctx.strokeStyle = 'rgba(190, 214, 244, 0.42)';
        ctx.lineWidth = 1.2;
        for (var ri = 0; ri < 46; ri++) {
          var rx = ((ri * 197 + now * 0.42) % (w + 120)) - 60;
          var ry = ((ri * 131 + now * 0.9) % (h + 80)) - 40;
          ctx.beginPath();
          ctx.moveTo(rx, ry);
          ctx.lineTo(rx - 4, ry + 13);
          ctx.stroke();
        }
      }
      drawCompass(ox, oy, t, now);

      // 浮字放在最后：它必须比暗角更亮，否则「+1」会被压成一块灰
      drawFloats(ox, oy, t);
    }

    // ---------- v4.6 宅基地牌子 ----------
    // 木牌 + 名字 + 暖光。它是「这个世界记得你」的实体化：
    // 走过任何一块牌子，都知道这里住着一位同学。
    function drawHouseSigns(ox, oy, t, now) {
      var hs = state.houses || [];
      var mine = state.house;
      ctx.textAlign = 'center';
      for (var i = 0; i < hs.length; i++) {
        var h = hs[i];
        var hx = ox + (h.x + 0.5) * t;
        var hy = oy + (h.y + 0.5) * t;
        if (hx < -t || hx > view.w + t || hy < -t || hy > view.h + t) continue;
        var isMine = mine && h.user_id === myId;
        // 牌柱
        ctx.strokeStyle = 'rgba(120, 92, 60, 0.95)';
        ctx.lineWidth = Math.max(1.5, t * 0.05);
        ctx.beginPath();
        ctx.moveTo(hx, hy);
        ctx.lineTo(hx, hy - t * 0.42);
        ctx.stroke();
        // 牌面
        ctx.fillStyle = isMine ? 'rgba(255, 214, 130, 0.95)' : 'rgba(196, 162, 110, 0.92)';
        ctx.fillRect(hx - t * 0.36, hy - t * 0.62, t * 0.72, t * 0.24);
        ctx.strokeStyle = 'rgba(90, 66, 40, 0.9)';
        ctx.lineWidth = Math.max(1, t * 0.025);
        ctx.strokeRect(hx - t * 0.36, hy - t * 0.62, t * 0.72, t * 0.24);
        // 名字
        if (t >= 26) {
          ctx.fillStyle = 'rgba(50, 34, 16, 0.95)';
          ctx.font = Math.max(9, Math.round(t * 0.20)) + 'px sans-serif';
          ctx.fillText(isMine ? '你的农舍' : (h.name || '同学') + ' 的农舍', hx, hy - t * 0.45);
        }
      }
      ctx.textAlign = 'left';
    }

    // ---------- 世界的边缘 ----------
    // 开放世界要有「尽头」：贴近边界时，画一圈微光描边 + 四座界标灯桩。
    // 玩家需要「世界到此为止」的确定感；四座界标在远处就是北极星。
    function nearWorldEdge() {
      var d = Math.min(state.me.x, state.me.y, state.size - 1 - state.me.x, state.size - 1 - state.me.y);
      return d < 12;
    }

    var WORLD_BEACONS = [[3, 3], [156, 3], [3, 156], [156, 156]];

    function drawWorldEdge(ox, oy, t, now) {
      var size = state.size;
      var span = size * t;
      var d = Math.min(state.me.x, state.me.y, size - 1 - state.me.x, size - 1 - state.me.y);
      if (d < 16) {
        var a = (16 - d) / 16;
        ctx.strokeStyle = 'rgba(255, 226, 158, ' + (0.30 * a).toFixed(3) + ')';
        ctx.lineWidth = Math.max(1.5, t * 0.06);
        ctx.setLineDash([t * 0.5, t * 0.42]);
        ctx.lineDashOffset = -(now * 0.012) % (t * 0.92);
        ctx.strokeRect(ox, oy, span, span);
        ctx.setLineDash([]);
      }
      // 四角界标：一根静立的灯桩，光束缓缓呼吸 —— 画在黑暗层之后，
      // 所以隔着整片夜海也看得见它（「尽头有灯」是开放世界的安全感）。
      for (var i = 0; i < WORLD_BEACONS.length; i++) {
        var bx = ox + (WORLD_BEACONS[i][0] + 0.5) * t;
        var by = oy + (WORLD_BEACONS[i][1] + 0.5) * t;
        if (bx < -t * 3 || bx > view.w + t * 3 || by < -t * 6 || by > view.h + t * 2) continue;
        var breathe = 0.72 + 0.28 * Math.sin(now * 0.0012 + i * 1.7);
        var bh = t * 5.2;
        var bw = t * 0.14;
        var bg2 = ctx.createLinearGradient(0, by, 0, by - bh);
        bg2.addColorStop(0, 'rgba(255, 232, 180, ' + (0.34 * breathe).toFixed(3) + ')');
        bg2.addColorStop(0.5, 'rgba(255, 232, 180, 0.10)');
        bg2.addColorStop(1, 'rgba(255, 232, 180, 0)');
        ctx.fillStyle = bg2;
        ctx.beginPath();
        ctx.moveTo(bx - bw, by);
        ctx.lineTo(bx + bw, by);
        ctx.lineTo(bx + bw * 1.8, by - bh);
        ctx.lineTo(bx - bw * 1.8, by - bh);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = 'rgba(255, 244, 214, ' + (0.85 * breathe).toFixed(3) + ')';
        ctx.beginPath();
        ctx.arc(bx, by - t * 0.16, t * 0.11, 0, 6.2832);
        ctx.fill();
      }
    }

    // ---------- 同学罗盘 ----------
    // 开放大世界的多人感核心：看不见的同学不等于不存在。
    // 屏幕边缘一枚枚灯色光点指向 TA 的方位 —— Journey 的伙伴指针，
    // 换成「提灯」的语义：光点的颜色就是 TA 的灯色。
    function drawCompass(ox, oy, t, now) {
      var w = view.w;
      var h = view.h;
      var cx = w / 2;
      var cy = h / 2;
      var R = Math.min(w, h) * 0.40;
      var list = [];
      for (var k in state.players) {
        if (!Object.prototype.hasOwnProperty.call(state.players, k)) continue;
        var p = state.players[k];
        if (!p || p.id === myId) continue;
        var sx = ox + (p.x + 0.5) * t;
        var sy = oy + (p.y + 0.5) * t;
        // 屏内看得见的同学不需要罗盘，别把画面点缀成圣诞树
        if (sx > -t && sx < w + t && sy > -t && sy < h + t) continue;
        var dx = p.x - state.me.x;
        var dy = p.y - state.me.y;
        var dist = Math.sqrt(dx * dx + dy * dy);
        list.push({ p: p, ang: Math.atan2(sy - cy, sx - cx), dist: dist });
      }
      if (!list.length) return;
      list.sort(function (a, b) { return a.dist - b.dist; });
      var cnt = Math.min(list.length, 6);
      for (var i = 0; i < cnt; i++) {
        var it = list[i];
        var col = LANTERN_COLORS[it.p.lantern] || LANTERN_COLORS['0'];
        var near = clamp(1 - it.dist / 120, 0.25, 1);
        var px = cx + Math.cos(it.ang) * R;
        var py = cy + Math.sin(it.ang) * R;
        var isFollow = followTarget === it.p.id;
        var r = isFollow ? 5.5 : 3.6;
        // 尾迹：从边缘点往屏幕中心缩回的一段渐隐线，指向感靠它
        var tail = 26 + 10 * near;
        var tg = ctx.createLinearGradient(px, py, px - Math.cos(it.ang) * tail, py - Math.sin(it.ang) * tail);
        tg.addColorStop(0, 'rgba(' + col.glow + ', ' + (0.55 * near).toFixed(3) + ')');
        tg.addColorStop(1, 'rgba(' + col.glow + ', 0)');
        ctx.strokeStyle = tg;
        ctx.lineWidth = isFollow ? 2.4 : 1.6;
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(px - Math.cos(it.ang) * tail, py - Math.sin(it.ang) * tail);
        ctx.stroke();
        var pulse = 0.8 + 0.2 * Math.sin(now * 0.003 + i * 2.1);
        ctx.fillStyle = 'rgba(' + col.core + ', ' + (0.9 * pulse).toFixed(3) + ')';
        ctx.beginPath();
        ctx.arc(px, py, r * pulse, 0, 6.2832);
        ctx.fill();
        if (isFollow) {
          // 正在跟随的同学：金色圈锁定，一眼认出「我在跟谁」
          ctx.strokeStyle = 'rgba(255, 226, 150, 0.8)';
          ctx.lineWidth = 1.4;
          ctx.beginPath();
          ctx.arc(px, py, r + 3.5, 0, 6.2832);
          ctx.stroke();
        }
      }
    }

    var lastFrame = 0;
    function loop(now) {
      if (!view.running) return;
      // dt 钳到 50ms：切到后台再回来，浏览器会把几十秒攒成一帧。
      // 不钳制的话粒子一帧飞出屏幕、震动一帧衰减到零，回来像画面崩了。
      var dt = lastFrame ? (now - lastFrame) / 1000 : 0.016;
      if (!(dt > 0)) dt = 0.016;
      if (dt > 0.05) dt = 0.05;
      lastFrame = now;
      tickMove(dt);
      updateLight(dt, now);
      draw(now, dt);
      view.raf = window.requestAnimationFrame(loop);
    }

    function startLoop() {
      if (view.running) return;
      view.running = true;
      view.raf = window.requestAnimationFrame(loop);
    }

    function stopLoop() {
      view.running = false;
      if (view.raf) {
        window.cancelAnimationFrame(view.raf);
        view.raf = 0;
      }
    }

    // ---------- 小地图（160×160 世界，1 格 1 像素） ----------
    var mmStamp = -1;
    var MM_COLORS = {};
    MM_COLORS[T_CLOUD] = [26, 40, 70];
    MM_COLORS[T_MEADOW] = [64, 118, 88];
    MM_COLORS[T_SAND] = [92, 84, 68];
    MM_COLORS[T_LAKE] = [18, 32, 48];
    MM_COLORS[T_STONE] = [104, 116, 138];
    MM_COLORS[T_DOCK] = [128, 100, 68];
    MM_COLORS[T_PATH] = [96, 78, 60];

    function paintMinimapBase() {
      var mbc = mmBase.getContext('2d');
      var img = mbc.createImageData(state.size, state.size);
      var d = img.data;
      var size = state.size;
      for (var y = 0; y < size; y++) {
        for (var x = 0; x < size; x++) {
          var idx = y * size + x;
          var o = idx * 4;
          var code = state.cells.charCodeAt(idx) - 48;
          var seen = state.explored && state.explored[idx];
          if (!seen) {
            d[o] = 8; d[o + 1] = 12; d[o + 2] = 24; d[o + 3] = 255;
            continue;
          }
          var c = MM_COLORS[code] || MM_COLORS[T_CLOUD];
          d[o] = c[0]; d[o + 1] = c[1]; d[o + 2] = c[2]; d[o + 3] = 255;
        }
      }
      mbc.putImageData(img, 0, 0);
      mmStamp = state.exploreVer;
    }

    function paintMinimapDots() {
      var mc = mmDots.getContext('2d');
      var size = state.size;
      mc.clearRect(0, 0, size, size);
      var lampKeys = Object.keys(state.lamps);
      mc.fillStyle = 'rgba(255, 208, 128, 0.9)';
      for (var i = 0; i < lampKeys.length; i++) {
        var lamp = state.lamps[lampKeys[i]];
        mc.fillRect(lamp.x, lamp.y, 1, 1);
      }
      var ids = Object.keys(state.players);
      mc.fillStyle = 'rgba(238, 244, 255, 0.9)';
      for (var p = 0; p < ids.length; p++) {
        var pl = state.players[ids[p]];
        mc.fillRect(pl.x, pl.y, 1, 1);
      }
      if (state.meteor && state.meteor.active) {
        var pulse = 0.5 + 0.5 * Math.sin(Date.now() * 0.006);
        mc.strokeStyle = 'rgba(255, 170, 200, ' + (0.5 + 0.4 * pulse).toFixed(2) + ')';
        mc.lineWidth = 1;
        mc.beginPath();
        mc.arc(state.meteor.x, state.meteor.y, 3.2 + pulse * 1.6, 0, 6.2832);
        mc.stroke();
        mc.fillStyle = 'rgba(255, 200, 220, 0.95)';
        mc.fillRect(state.meteor.x - 1, state.meteor.y - 1, 2, 2);
      }
      mc.fillStyle = 'rgba(255, 226, 150, 1)';
      mc.fillRect(state.me.x - 1, state.me.y - 1, 3, 3);
      mc.fillStyle = 'rgba(255, 255, 255, 1)';
      mc.fillRect(state.me.x, state.me.y, 1, 1);
    }

    var mmTimer = 0;
    function startMinimap() {
      if (mmTimer) return;
      mmTimer = setInterval(function() {
        if (mmStamp !== state.exploreVer) paintMinimapBase();
        paintMinimapDots();
        drawGoalMinimap();
        // 流星雨到点兜底收场
        if (state.meteor && Date.now() > state.meteor.endsAt) {
          state.meteor = null;
          state.meteorNodes = {};
        }
        // 岛名横幅：跨过岛界时轻声报一次
        var here = islandNameHere();
        if (here && here !== state.lastIsle) {
          state.lastIsle = here;
          showBanner('pin', here, ISLE_SUB[here] || '', '', 3600);
        } else if (!here) {
          state.lastIsle = '';
        }
      }, 700);
      onDestroy(function() { if (mmTimer) { clearInterval(mmTimer); mmTimer = 0; } });
    }

    function islandNameHere() {
      var isles = state.catalog.islands || [];
      for (var i = 0; i < isles.length; i++) {
        var is = isles[i];
        var dx = state.me.x - is.cx;
        var dy = state.me.y - is.cy;
        if (dx * dx + dy * dy <= is.r * is.r) return is.name;
      }
      return '';
    }

    function onMinimapClick() {
      mmBig = !mmBig;
      minimap.className = 'sg-minimap' + (mmBig ? ' is-big' : '');
      sfx.tap();
    }
    minimap.addEventListener('click', onMinimapClick);
    onDestroy(function() {
      minimap.removeEventListener('click', onMinimapClick);
    });

    // ---------- 状态更新 ----------
    function revealCells(cells) {
      if (!cells || !state.explored) return;
      if (!Array.isArray(cells)) return;
      for (var i = 0; i < cells.length; i++) {
        var x = cells[i][0];
        var y = cells[i][1];
        if (x < 0 || y < 0 || x >= state.size || y >= state.size) continue;
        state.explored[y * state.size + x] = 1;
      }
      state.exploreVer++;
    }

    function applyExplored(bits) {
      var total = state.size * state.size;
      var arr = new Uint8Array(total);
      if (bits && bits.length === total) {
        for (var i = 0; i < total; i++) {
          if (bits.charCodeAt(i) === 49) arr[i] = 1;
        }
      }
      state.explored = arr;
      state.exploreVer++;
    }

    function addLamp(x, y, c, level) {
      state.lamps[x + ',' + y] = { x: x, y: y, c: c || '0', level: level || 1 };
    }

    // 光花现在是作物：除了「种下时间」，还要知道「何时能收」和「浇过几次」。
    // readyAt 缺省按 3 分钟推算 —— 老数据（没有这一列）也能正常显示成熟度。
    function addFlower(x, y, species, at, uid) {
      state.flowers[x + ',' + y] = { x: x, y: y, species: species, at: at, uid: uid || '' };
    }

    function addFlower(x, y, species, at, uid, readyAt, water) {
      state.flowers[x + ',' + y] = {
        x: x, y: y, species: species, at: at, uid: uid || '',
        readyAt: readyAt || (at + 180 * 1000),
        water: water | 0
      };
    }

    // 脚下这株作物（没有则 null）。收成和浇水都以它为判定。
    function flowerUnderMe() {
      return state.flowers[state.me.x + ',' + state.me.y] || null;
    }

    function cropRipe(f, now) {
      if (!f) return false;
      var cfR = (state.catalog.crops || [])[f.species];
      if (!cfR) return false;
      return (f.growth || 0) >= cfR.days;
    }

    function upsertPlayer(id, name, x, y, dir, now, hat, lantern, title) {
      // t 必须是 performance.now()：draw(now) 的时基是 rAF（performance 纪元），
      // 混用 Date.now() 会让位移补间算出巨负数 —— 别人一动就瞬移出视野。
      var perf = performance.now();
      var p = state.players[id];
      if (!p) {
        state.players[id] = { id: id, name: name || '旅人', x: x, y: y, px: x, py: y, dir: dir, t: perf, hat: hat || '0', lantern: lantern || '0', title: title || '' };
        return;
      }
      if (name) p.name = name;
      if (hat) p.hat = hat;
      if (lantern) p.lantern = lantern;
      if (title) p.title = title;
      if (p.x !== x || p.y !== y) {
        p.px = p.x;
        p.py = p.y;
        p.x = x;
        p.y = y;
        p.t = perf;
      }
      if (typeof dir === 'number') p.dir = dir;
    }

    function removePlayer(id) {
      if (state.players[id]) delete state.players[id];
    }

    function bumpPill(elm) {
      elm.classList.remove('is-bump');
      elm.offsetWidth;
      elm.classList.add('is-bump');
    }

    var lastShards = -1;

    function nodeUnderMe() {
      if (!state.nodes) return false;
      var idx = state.me.y * state.size + state.me.x;
      if (state.nodes.charCodeAt(idx) !== 49) return false;
      var at = state.gathered[state.me.x + ',' + state.me.y];
      return !at || (Date.now() - at > 95000);
    }

    function meteorNodeUnderMe() {
      return !!(state.meteor && state.meteor.active && state.meteorNodes[state.me.x + ',' + state.me.y]);
    }

    function tileUnderMe() {
      var idx = state.me.y * state.size + state.me.x;
      if (!state.cells) return -1;
      return state.cells.charCodeAt(idx) - 48;
    }

    // 脚边有没有可升级的一级灯柱（相邻即算）
    function upgradableLampNearMe() {
      var keys = Object.keys(state.lamps);
      for (var i = 0; i < keys.length; i++) {
        var lp = state.lamps[keys[i]];
        if (!lp || lp.level >= 2) continue;
        if (Math.abs(lp.x - state.me.x) <= 1 && Math.abs(lp.y - state.me.y) <= 1) return lp;
      }
      return null;
    }

    // 脚边有没有未唤醒的石碑（切比雪夫 ≤2 就能触）
    function steleNearMe() {
      var steles = state.catalog.steles || [];
      for (var i = 0; i < steles.length; i++) {
        var s = steles[i];
        if (Math.abs(s.x - state.me.x) <= 2 && Math.abs(s.y - state.me.y) <= 2) {
          var rec = state.steles[s.x + ',' + s.y];
          if (!rec || !rec.by) return s;
        }
      }
      return null;
    }

    var lastHintKey = '';
    function updateHint() {
      var key = '';
      if (flying) key = 'flying';
      else if (fishing) key = 'fishing';
      else if (walkPath.length) key = 'walking';
      else if (meteorNodeUnderMe()) key = 'meteor';
      else if (nodeUnderMe()) key = 'node';
      else if (steleNearMe()) key = 'stele';
      else if (letterNearMe()) key = 'letter';
      else if (nearWorldEdge()) key = 'edge';
      else if (tileUnderMe() === T_DOCK) key = 'dock';
      else if (tileUnderMe() === T_PATH) key = 'path';
      else if (tileUnderMe() === T_MEADOW) key = 'meadow';
      else if (state.meteor && state.meteor.active) key = 'meteorFar';
      var text = '';
      if (key === 'flying') text = '纸鸢掠过云海……';
      else if (key === 'walking') text = '正在走过去……（摇杆 / 键盘随时打断）';
      else if (key === 'fishing') text = '收线中……';
      else if (key === 'meteor') text = '脚下有一颗星陨，快按采集';
      else if (key === 'node') text = '脚下有星屑，按「采集」';
      else if (key === 'stele') text = '石碑就在脚边，按「触碑」唤醒它';
      else if (key === 'dock') text = '码头边可以「钓星」，也能搭纸鸢「快线」去别的岛';
      else if (key === 'path') text = '顺着石板路走，就不会迷路';
      else if (key === 'meadow') text = '草地上可以「种花」，它会一直开在这里';
      else if (key === 'meteorFar') text = '流星雨正落在' + (state.meteor.island || '远处') + '……';
      else if (key === 'letter') text = '脚下有一封信 —— 按「拾信」收进拾光志';
      else if (key === 'edge') text = '这里是世界的边缘 —— 云海之外，什么都没有';
      if (key !== lastHintKey) {
        lastHintKey = key;
        hint.textContent = text || '拖动左下摇杆漫步';
        if (key) hint.className = 'sg-hint is-on';
        else hint.className = 'sg-hint';
      }
    }

    // 下一档天象。整个游戏的主线就藏在这一个函数里：
    // 灯柱数跨过阈值 → 天光推进 → 全岛的配色、雾、视野一起变。
    // 之前这段信息只表现为顶栏一根 44px 的细线，没人看得懂那是什么；
    // 现在直接写成「长夜 · 3/10」—— 目标必须能被读成一句话。
    function stageNext() {
      var list = (state.catalog && state.catalog.stages) || [];
      var i = clamp(state.stage, 0, Math.max(0, list.length - 1));
      return list[i + 1] || null;
    }

    // ---------- v4.5 星露谷：时钟映射 ----------
    // 一天 6 分钟 = 游戏 20 小时（6:00 → 凌晨 2:00）。
    // day 进度 0 → 1 映射到表盘；进度 > 0.92 即深夜，开始催你睡觉。
    function clockProgress() {
      var span = (state.calendar.endsAt || 0) - Date.now();
      var full = 6 * 60 * 1000;
      var left = clamp(span / full, 0, 1);
      return 1 - left;
    }

    function clockText(prog) {
      // 6:00 起床 → 24:00 → 凌晨 2:00（= 26 点，进度 1）
      var hours = 6 + prog * 20;
      var hh = Math.floor(hours) % 24;
      var mm = Math.floor((hours - Math.floor(hours)) * 60);
      mm = Math.floor(mm / 10) * 10;
      var tag = hh < 6 ? '凌晨' : (hh < 12 ? '上午' : (hh < 18 ? '下午' : '晚上'));
      var disp = hh % 12 === 0 ? 12 : hh % 12;
      return tag + ' ' + disp + ':' + (mm < 10 ? '0' + mm : mm);
    }

    function updateClockPanel() {
      var prog = clockProgress();
      clockTime.textContent = clockText(prog);
      // 弧形进度：270° 扇区，dashoffset 113.1 → 28.3
      dialFg.setAttribute('stroke-dashoffset', (113.1 - 84.8 * clamp(prog, 0, 1)).toFixed(1));
      clockDay.textContent = String(state.calendar.day || 1);
      clockWeather.textContent = state.weather === 'rain' ? '☂ 雨' : '☀ 晴';
      clockMoneyVal.textContent = String(state.me.shards || 0);
      var xyEl = document.querySelector('.sg-clock-xy');
      if (xyEl) xyEl.textContent = (state.xyGrant || 0).toFixed(2);
      clockPanel.className = 'sg-clock' + (prog > 0.86 ? ' is-night' : '');
    }

    function updateStaminaBar() {
      var v = lightState ? clamp(lightState.v, 0, LIGHT_MAX) : 100;
      var frac = v / LIGHT_MAX;
      stamFg.setAttribute('stroke-dashoffset', (100.5 * (1 - frac)).toFixed(1));
      stamFg.setAttribute('stroke', frac < 0.3 ? '#ff8f6b' : '#ffcf7a');
      staminaBox.className = 'sg-stamina' + (frac < 0.3 ? ' is-low' : '');
    }

    // ---------- v4.6 学元余额 ----------
    function refreshWallet() {
      http('get', '/shiguang/wallet').then(function(d) {
        if (d && !d.rejected) {
          state.xyGrant = d.grant || 0;
          var elx = document.querySelector('.sg-clock-xy');
          if (elx) elx.textContent = (state.xyGrant).toFixed(2) + ' 学元';
        }
      }).catch(function() {});
    }

    // ---------- v4.5 锄地：星露谷的第一件农活 ----------
    // 草地/路边、无花无灯 → 翻成土（flowers species=-1）。
    // 火就是体力：锄地 4 点。
    function doTill() {
      if (!state.ready || flying) return false;
      if (walkPath.length) stopWalk();
      var tl = tileUnderMe();
      if (tl !== T_MEADOW && tl !== T_PATH) { toast('锄头只肯碰草地和路边'); return false; }
      if (flowerUnderMe()) { toast('这块地已经有主了'); return false; }
      if (!lightState || lightState.v < 4) {
        toast('体力不够了　锄地要 4 点　先回灯边歇歇');
        return false;
      }
      http('post', '/shiguang/farm/till', { x: state.me.x, y: state.me.y }).then(function(d) {
        if (!d) return;
        if (d.rejected) {
          if (d.rejected === 'ground') toast('锄头只肯碰草地和路边');
          else if (d.rejected === 'tilled') toast('这块土已经翻好了　按种子袋播种');
          else if (d.rejected === 'flower') toast('这块地已经有作物了');
          else if (d.rejected === 'lamp') toast('灯柱脚下不种田');
          else toast('翻不动');
          return;
        }
        lightState.v = Math.max(1, lightState.v - 4);
        addFlower(state.me.x, state.me.y, -1, Date.now(), myId, 0, 0);
        spawnParts((meFx > 0 ? meFx : state.me.x + 0.5), (meFy > 0 ? meFy : state.me.y + 0.5), 4, 8, 0.5, [142, 116, 84]);
        audio.blip(180, 0.14, 'triangle', 0.10, 0);
        toast('翻好了　按种子袋播种', 'warm');
        updateHud();
      }).catch(function() { toast('翻地失败，稍后再试'); });
      return true;
    }

    // ---------- v4.5 睡觉：一天的句号 ----------
    // 夜里（22:00 后）出现「睡觉」按钮：过场 → 等全班的日历翻页（dawn）→ 结算。
    // 睡了 rested=true 次日体力满血；熬通宵体力只剩六成 —— 星露谷的惩罚温柔但存在。
    var rested = false;
    var sleepPending = false;

    function doSleep() {
      if (!state.ready || sleepPending) return;
      sleepPending = true;
      var night = el('div', 'sg-night');
      night.appendChild(el('div', 'sg-night-zzz', 'Z z z …'));
      night.appendChild(el('div', 'sg-night-tip', '天亮之前，是全班的夜'));
      root.appendChild(night);
      requestAnimationFrame(function() { night.className = 'sg-night is-show'; });
      sfx.dawn();
      // dawn 广播到达时 finishSleep() 会关掉这一层并弹结算
    }

    function finishSleep(weather) {
      sleepPending = false;
      rested = true;
      if (lightState) lightState.v = LIGHT_MAX;
      var night = root.querySelector('.sg-night');
      if (night && night.parentNode) night.parentNode.removeChild(night);
      // 结算面板（星露谷同款：新的一天 + 天气 + 昨夜的收成叙事）
      openSheet('summary', '新的一天！');
      clearNode(sheetBody);
      var rain = weather === 'rain';
      var lines = [
        ['第 ' + state.calendar.day + ' 天', rain ? '今天下雨 —— 云替你把水浇了，别去田里了' : '今天是个大晴天，适合下地'],
        ['体力', '满血复活（' + LIGHT_MAX + ' 点）'],
        ['作物', rain ? '雨已经把今天的水浇好了' : '记得去田里浇水 —— 浇了才长']
      ];
      for (var li = 0; li < lines.length; li++) {
        var row = el('div', 'sg-sum-row');
        row.appendChild(el('b', 'sg-sum-key', lines[li][0]));
        row.appendChild(el('span', 'sg-sum-val', lines[li][1]));
        sheetBody.appendChild(row);
      }
      sheetBody.appendChild(el('div', 'sg-tip', '睡得早体力足 —— 熬通宵的第二天只有六成力气。'));
      showBanner('flag', '第 ' + state.calendar.day + ' 天', rain ? '今天下雨' : '今天晴', '', 3800);
      updateHud();
    }

    // ---------- v4.10 目标指引 ----------
    // 开场后永远知道下一步：小地图金圈 + 屏幕边缘箭头 + 拾光志目标行。
    // 目标由服务端按个人真实数据实时判定（走→采→灯→种→进镇）。
    function refreshGoal() {
      http('get', '/shiguang/story').then(function(d) {
        if (d && !d.rejected) {
          var changed = (!state.goal && d.goal) || (state.goal && d.goal && state.goal.id !== d.goal.id);
          state.goal = d.goal || null;
          state.storyChapters = d.chapters || [];
          if (d.season) state.season = d.season;
          if (changed && d.goal) {
            toast('目标：' + d.goal.title, 'warm');
            sfx.tap();
          }
          // 拾光志面板开着时目标到了要补渲染（异步回填）
          if (sheetKind === 'story' && sheetBody) renderStory(sheetBody);
        }
      }).catch(function() {});
    }

    // 小地图金圈：目标位置闪烁
    function drawGoalMinimap() {
      if (!state.goal || !state.goal.at) return;
      var mc = mmDots.getContext('2d');
      var pk = 0.5 + 0.5 * Math.sin(performance.now() * 0.004);
      mc.strokeStyle = 'rgba(255, 224, 140, ' + (0.5 + 0.45 * pk).toFixed(3) + ')';
      mc.lineWidth = 1.5;
      mc.beginPath();
      mc.arc(state.goal.at.x + 0.5, state.goal.at.y + 0.5, 3.2 + pk * 1.6, 0, 6.2832);
      mc.stroke();
    }

    // 屏幕边缘箭头：目标不在屏内时指向它（用罗盘同款几何）
    function drawGoalArrow(ox, oy, t, now) {
      if (!state.goal || !state.goal.at) return;
      var tx = ox + (state.goal.at.x + 0.5) * t;
      var ty = oy + (state.goal.at.y + 0.5) * t;
      var w = view.w;
      var h = view.h;
      if (tx > -t && tx < w + t && ty > -t && ty < h + t) return;   // 屏内可见，不画箭头
      var cx = w / 2;
      var cy = h / 2;
      var ang = Math.atan2(ty - cy, tx - cx);
      var R = Math.min(w, h) * 0.40;
      var px = cx + Math.cos(ang) * R;
      var py = cy + Math.sin(ang) * R;
      var pk = 0.5 + 0.5 * Math.sin(now * 0.005);
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(ang);
      ctx.fillStyle = 'rgba(255, 224, 140, ' + (0.55 + 0.35 * pk).toFixed(3) + ')';
      ctx.beginPath();
      ctx.moveTo(9, 0);
      ctx.lineTo(-5, 5);
      ctx.lineTo(-5, -5);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }

    // 目标轮询：完成一步自动切下一步（12 秒一次，轻请求）
    var goalTimer = setInterval(refreshGoal, 12000);
    onDestroy(function() { clearInterval(goalTimer); });

    // ---------- v4.7 采集：斧头砍树 / 矿镐挖矿 ----------
    // 树长在草地（避开星屑），矿藏在星坠/望潮/霜屿的石地上。
    // 材料进背包，卖给钱庄 —— 经济链从「种田」延伸到「采集」。
    function doGatherNode(kind) {
      if (!state.ready || flying) return;
      if (walkPath.length) stopWalk();
      var verb = kind === 'tree' ? '砍树' : '挖矿';
      if (!lightState || lightState.v < 5) {
        toast('体力不够了　' + verb + '要 5 点，先回灯边歇歇');
        return;
      }
      http('post', kind === 'tree' ? '/shiguang/world/chop' : '/shiguang/world/mine', {}).then(function(d) {
        if (!d) return;
        if (d.rejected) {
          if (d.rejected === 'cooldown') toast('这里刚被采过　歇 ' + d.wait + ' 秒');
          else if (d.rejected === 'nothing') toast(d.hint || '脚下没有可以采集的');
          else toast('采不了');
          return;
        }
        lightState.v = Math.max(1, lightState.v - 5);
        state.bag = d.bag || state.bag;
        spawnParts((meFx > 0 ? meFx : state.me.x + 0.5), (meFy > 0 ? meFy : state.me.y + 0.5), 5, 9, 0.6, kind === 'tree' ? [110, 160, 96] : [150, 160, 180]);
        audio.blip(kind === 'tree' ? 220 : 320, 0.14, 'square', 0.08, 0);
        toast((kind === 'tree' ? '砍到云杉木' : '挖到星岩矿') + ' ×' + d.got + '　放进背包了' +
          ((state.tools || {})[kind === 'tree' ? 'chop' : 'mine'] >= 2 ? '（星辉加成）' : ''), 'warm');
        updateHud();
      }).catch(function() { toast('采集失败，稍后再试'); });
    }

    // 树/矿节点渲染：在 Kenney 摆件层之上加「可采集」的呼吸标记
    function drawGatherNodes(ox, oy, t, now, x0, x1, y0, y1, size) {
      for (var gy = y0; gy <= y1; gy++) {
        for (var gx = x0; gx <= x1; gx++) {
          if (gx < 0 || gy < 0 || gx >= size || gy >= size) continue;
          var kind = null;
          if (worldHasTree(gx, gy)) kind = 'tree';
          else if (worldHasOre(gx, gy)) kind = 'ore';
          if (!kind) continue;
          var sx2 = ox + (gx + 0.5) * t;
          var sy2 = oy + (gy + 0.62) * t;
          var pk = 0.5 + 0.5 * Math.sin(now * 0.0026 + gx * 3 + gy * 7);
          ctx.strokeStyle = kind === 'tree' ? 'rgba(140, 220, 150, ' + (0.35 + 0.3 * pk).toFixed(3) + ')'
                                            : 'rgba(200, 214, 244, ' + (0.35 + 0.3 * pk).toFixed(3) + ')';
          ctx.lineWidth = Math.max(1.2, t * 0.04);
          ctx.beginPath();
          ctx.arc(sx2, sy2, t * (0.26 + 0.05 * pk), 0, 6.2832);
          ctx.stroke();
        }
      }
    }

    // 前端侧的节点判定（与服务端 world.hasTree/hasOre 同参同源）
    function worldHasTree(x, y) {
      if (!state.cells || !state.nodes) return false;
      var idx = y * state.size + x;
      var tl = state.cells.charCodeAt(idx) - 48;
      if (tl !== T_MEADOW && tl !== T_PATH) return false;
      if (state.nodes.charCodeAt(idx) === 49) return false;
      return hash2(x, y, 19) < 0.02;
    }
    function worldHasOre(x, y) {
      if (!state.cells) return false;
      var idx = y * state.size + x;
      if (state.cells.charCodeAt(idx) - 48 !== T_STONE) return false;
      return hash2(x, y, 23) < 0.035;
    }

    // 工具栏语境：脚下格的状态决定哪个工具在「手」里。
    // 点工具 = 干这件事（等价于语境按钮，但它是星露谷的手感）。
    function useTool(key) {
      if (key === 'till') {
        if (!doTill()) return;
        return;
      }
      if (key === 'water') {
        http('post', '/shiguang/flower/water', {}).then(function(d) {
          if (!d) return;
          if (d.rejected) {
            if (d.rejected === 'wet') toast('今天已经浇过了　明天再来');
            else if (d.rejected === 'ripe') toast('已经熟了　按镰刀收下来');
            else if (d.rejected === 'none') toast('脚下没有要浇的作物');
            else toast('浇不了');
            return;
          }
          if (!lightState || lightState.v < 2) {
            toast('体力不够了　浇水要 2 点　先睡一觉');
            return;
          }
          lightState.v = Math.max(1, lightState.v - 2);
          var fc = flowerUnderMe();
          if (fc) fc.wateredDay = d.day;
          spawnRing((meFx > 0 ? meFx : state.me.x + 0.5), (meFy > 0 ? meFy : state.me.y + 0.5), [150, 200, 255]);
          sfx.gather();
          toast('浇过了　明天它会长高一节', 'warm');
          updateHud();
        }).catch(function() { toast('浇水失败'); });
        return;
      }
      if (key === 'sow') {
        if (btnPlant && btnPlant.style.display !== 'none' && !flowerUnderMe()) {
          btnPlant.click();
          return;
        }
        if (flowerUnderMe()) { toast('脚下已经有作物了'); return; }
        toast('先用锄头把脚下的草地翻成土');
        return;
      }
      if (key === 'cut') {
        if (flowerUnderMe() && cropRipe(flowerUnderMe())) {
          btnGather.click();
          return;
        }
        toast('脚下没有成熟的作物');
        return;
      }
      if (key === 'chop') { doGatherNode('tree'); return; }
      if (key === 'mine') { doGatherNode('ore'); return; }
    }

    function updateToolbar() {
      var fc = flowerUnderMe();
      var ripe = fc && cropRipe(fc);
      var groundOk = tileUnderMe() === T_MEADOW || tileUnderMe() === T_PATH;
      var canTill = !fc && groundOk;
      var canWater = fc && !ripe && (fc.wateredDay | 0) < (state.calendar.day || 1);
      var canSow = fc && fc.species === -1;
      var canCut = !!ripe;
      toolBtns.till.className = 'sg-tool' + (canTill ? ' is-active' : '');
      toolBtns.water.className = 'sg-tool' + (canWater ? ' is-active' : '');
      toolBtns.sow.className = 'sg-tool' + (canSow ? ' is-active' : '');
      toolBtns.cut.className = 'sg-tool' + (canCut ? ' is-active' : '');
      var farmFire2 = lightState ? lightState.v : 100;
      toolBtns.chop.className = 'sg-tool' + (worldHasTree(state.me.x, state.me.y) && farmFire2 >= 5 ? ' is-active' : '');
      toolBtns.mine.className = 'sg-tool' + (worldHasOre(state.me.x, state.me.y) && farmFire2 >= 5 ? ' is-active' : '');
    }

    function updateHud() {
      var shards = state.me.shards || 0;
      statOnline.textContent = state.onlineCount + ' 人在岛';
      var nm = (state.stageInfo && state.stageInfo.name) || '长夜';
      var nx = stageNext();
      statStage.textContent = nx ? (nm + ' · ' + (state.lampCount || 0) + '/' + nx.at)
                                 : (nm + ' · ' + (state.lampCount || 0));

      var stages = [
        [0, 10], [10, 30], [30, 60], [60, 100], [100, 100]
      ];
      var pair = stages[clamp(state.stage, 0, stages.length - 1)];
      var prog = pair[1] > pair[0] ? clamp((state.lampCount - pair[0]) / (pair[1] - pair[0]), 0, 1) : 1;
      stageBarFill.style.transform = 'scaleX(' + prog.toFixed(3) + ')';

      shardsVal.textContent = String(shards);
      lampsVal.textContent = String(state.lampCount || 0);
      if (lastShards >= 0 && lastShards !== shards) bumpPill(pillShard);
      lastShards = shards;

      // 脚下有没有作物，三个按钮的语义都依赖它 —— 必须在最前面算出来
      var fl = flowerUnderMe();
      var canBuild = shards >= (state.lampCost || 3) && tileUnderMe() !== T_DOCK;
      // 站在作物上时，「种花」键的实际语义是浇水/收成提示，与星屑够不够无关
      var canPlant = fl
        ? !cropRipe(fl)
        : (shards >= (state.flowerCost || 2) && (tileUnderMe() === T_MEADOW || tileUnderMe() === T_PATH));
      var canFish = tileUnderMe() === T_DOCK;
      var canGather = nodeUnderMe() || meteorNodeUnderMe() || (fl && cropRipe(fl));

      badgeBuild.textContent = String(state.lampCost || 3);
      badgePlant.textContent = String(state.flowerCost || 2);
      btnBuild.className = 'sg-act sg-act-build' + (canBuild ? ' is-ready' : '');
      btnPlant.className = 'sg-act sg-act-plant' + (canPlant ? ' is-ready' : '');
      btnFish.className = 'sg-act sg-act-fish' + (canFish ? ' is-ready' : '');
      btnGather.className = 'sg-act sg-act-gather' + (canGather ? ' is-ready' : '');

      // 情境动作：码头 → 快线；石碑旁 → 触碑
      btnFly.style.display = canFish && !flying ? '' : 'none';
      var stele = steleNearMe();
      btnStele.style.display = stele ? '' : 'none';
      var upLamp = upgradableLampNearMe();
      btnUpgrade.style.display = upLamp && !flying ? '' : 'none';
      // 星露谷的夜里：22:00 后催你睡觉
    // 星露谷的夜里：22:00 后催你睡觉；脚边有信时优先拾信
      var hasLetter = letterNearMe();
      btnSleep.style.display = clockProgress() > 0.80 && !sleepPending && !hasLetter ? '' : 'none';
      btnPickLetter.style.display = hasLetter ? '' : 'none';

      // v4.2 星露谷的一天：顶栏常驻日历
      if (dayVal) dayVal.textContent = '第 ' + (state.calendar.day || 1) + ' 天';
      if (seasonEl) seasonEl.textContent = state.season || '春';

      // v4.5 星露谷骨架：时钟 / 体力 / 工具高亮
      updateClockPanel();
      updateStaminaBar();
      updateToolbar();

      if (state.claimable > 0) questDot.className = 'sg-btn-dot is-on';
      else questDot.className = 'sg-btn-dot';

      updateHint();
    }

    var ringTimer = 0;
    function startRings() {
      if (ringTimer) return;
      ringTimer = setInterval(function() {
        var now = Date.now();
        setRing(btnFish, state.fishCooldownMs ? (now - cooldowns.fish) / state.fishCooldownMs : 1);
        setRing(btnBottle, (now - cooldowns.bottle) / (4 * 60 * 1000));
        // 灯油弧：颜色随余量从金 → 橙 → 红，低于 28% 整表开始搏动
        var lv = clamp(lightState.v / LIGHT_MAX, 0, 1);
        oilFg.style.strokeDashoffset = String(75.4 * (1 - lv));
        oilFg.style.stroke = lv > 0.5 ? '#ffd98a' : (lv > 0.28 ? '#ffab6e' : '#ff7a5e');
        oilGauge.className = 'sg-oil' + (lv < 0.28 ? ' is-low' : '');
      }, 250);
      onDestroy(function() { if (ringTimer) { clearInterval(ringTimer); ringTimer = 0; } });
    }

    function setRing(btn, frac) {
      var fg = btn._ringFg;
      if (!fg) return;
      var f = clamp(frac, 0, 1);
      if (f >= 1) {
        fg.style.strokeDashoffset = '0';
        fg.style.opacity = '0';
      } else {
        fg.style.strokeDashoffset = String(RING_C * (1 - f));
        fg.style.opacity = '0.9';
      }
    }

    // ---------- §9 输入与玩法动作 ----------

    var lastMoveAt = 0;
    // 8 连击后的短暂提速窗口（毫秒时间戳）。只影响本地节奏，
    // 服务端 MOVE_MIN_GAP_MS=80 仍然兜底，不会被当成加速外挂。
    var comboRushUntil = 0;

    function moveGapNow() {
      return Date.now() < comboRushUntil ? Math.max(MOVE_GAP * 0.62, 82) : MOVE_GAP;
    }

    // ---------- 点击移动（BFS 寻路 + 沿路自动行走） ----------
    // 点地面任意可走格 → 客户端 BFS（CLOUD 与 LAKE 都是墙）→ ticker 每 180ms
    // 走一步。摇杆 / 键盘 / 动作按钮打断；服务端拒绝时 attemptMove 会把
    // state.me 校正回真实位置，walkTick 发现「下一格不挨着」就整条重算。
    var walkPath = [];
    var walkDest = null;
    var walkTimer = 0;

    function cellBlocked(x, y) {
      if (x < 0 || y < 0 || x >= state.size || y >= state.size) return true;
      var cc = state.cells.charCodeAt(y * state.size + x) - 48;
      return cc === 0 || cc === 6;   // CLOUD 与 LAKE 都不可走（与 world.walkable 一致）
    }

    function findPath(sx, sy, tx, ty, maxSteps) {
      var size = state.size;
      var total = size * size;
      if (sx === tx && sy === ty) return [];
      if (cellBlocked(tx, ty)) return null;
      var visited = new Uint8Array(total);
      var prev = new Int32Array(total);
      var start = sy * size + sx;
      var target = ty * size + tx;
      var queue = [start];
      visited[start] = 1;
      prev[start] = -1;
      var head = 0;
      var found = false;
      var dxs = [1, -1, 0, 0];
      var dys = [0, 0, 1, -1];
      while (head < queue.length) {
        var cur = queue[head++];
        if (cur === target) { found = true; break; }
        var ccx = cur % size;
        var ccy = (cur / size) | 0;
        for (var d = 0; d < 4; d++) {
          var nx = ccx + dxs[d];
          var ny = ccy + dys[d];
          if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
          var ni = ny * size + nx;
          if (visited[ni]) continue;
          if (cellBlocked(nx, ny)) continue;
          visited[ni] = 1;
          prev[ni] = cur;
          queue.push(ni);
        }
      }
      if (!found) return null;
      var path = [];
      var node = target;
      while (node !== start) {
        path.push({ x: node % size, y: (node / size) | 0 });
        node = prev[node];
      }
      path.reverse();
      if (maxSteps && path.length > maxSteps) path = path.slice(0, maxSteps);
      return path;
    }

    function startWalk(tx, ty) {
      if (!state.ready || flying) return;
      var path = findPath(state.me.x, state.me.y, tx, ty, 100);
      if (!path) { toast('那边过不去'); return; }
      if (!path.length) return;
      if (path.length > 90) { toast('太远了，先走近一点再点'); return; }
      walkPath = path;
      walkDest = { x: walkPath[walkPath.length - 1].x, y: walkPath[walkPath.length - 1].y };
      updateHint();
    }

    function stopWalk() {
      if (walkTimer) { clearInterval(walkTimer); walkTimer = 0; }
      walkPath = [];
      walkDest = null;
    }

    // v4.9 walkTick 退役：路径由 tickMove 每帧驱动（连续走向下一格心）。
    // 位置被服务端校正时 reportMove 的校正逻辑已覆盖。
    function walkTick() { if (walkTimer) { clearInterval(walkTimer); walkTimer = 0; } }

    // ---------- v4.9 丝滑移动引擎 ----------
    // 走格子退役。现在：摇杆/键盘给「模拟量向量」，rAF 每帧连续位移，
    // 分轴滑墙（撞墙时另一轴照走，手感是贴着墙滑过去而不是卡死），
    // 每 240ms 把浮点位置上报给服务端（服务端只做钳速校验与广播）。
    // me.x/y 每帧同步为脚下格（floor），种田/采集/点灯的格子语义不变。
    var MOVE_SPEED = 4.6;          // 格 / 秒（原格子制约 5.5，连续移动略慢更稳）
    var REPORT_MS = 240;           // 位置上报周期
    var BODY_RADIUS = 0.30;        // 身体碰撞半径（格）

    var meFx = 0;
    var meFy = 0;
    var moveVec = { x: 0, y: 0 };  // 本帧输入向量（摇杆优先，键盘次之）
    var keyHeld = {};              // 键盘按住集合
    var lastReportAt = 0;
    var walkCross = 0;             // 上次上报以来跨过的格数（quest walk 计数）
    var walkAccum = 0;             // 步声/扬尘的距离累计

    function walkableAt(x, y) {
      var gx = Math.floor(x);
      var gy = Math.floor(y);
      if (gx < 0 || gy < 0 || gx >= state.size || gy >= state.size) return false;
      var cc = state.cells.charCodeAt(gy * state.size + gx) - 48;
      return cc !== 0 && cc !== 6;
    }

    // 圆形身体四角采样：任何一角踩进不可走格都算撞
    function canStand(x, y) {
      var r = BODY_RADIUS;
      return walkableAt(x - r, y - r) && walkableAt(x + r, y - r) &&
             walkableAt(x - r, y + r) && walkableAt(x + r, y + r);
    }

    function speedNow() {
      var base = MOVE_SPEED;
      // 连击提速（4.3 手感层）：最近 4 秒内连击 ≥8 → +60%
      var since = Date.now() - (comboBuffAt || 0);
      if (since < 4000 && comboLevel >= 8) base *= 1.6;
      return base;
    }

    // 输入向量合成：摇杆（模拟量）优先，键盘（单位量）次之
    function inputVector() {
      if (stickVecActive) return { x: stickVec.x, y: stickVec.y };
      var kx = 0;
      var ky = 0;
      if (keyHeld[87] || keyHeld[38]) ky -= 1;   // W / ↑
      if (keyHeld[83] || keyHeld[40]) ky += 1;   // S / ↓
      if (keyHeld[65] || keyHeld[37]) kx -= 1;   // A / ←
      if (keyHeld[68] || keyHeld[39]) kx += 1;   // D / →
      var len = Math.sqrt(kx * kx + ky * ky);
      if (len > 0) return { x: kx / len, y: ky / len };
      return null;
    }

    // waypoint（点击移动 / 跟随共用的「走向一个点」）
    var autoPoint = null;          // { x, y } 浮点目标；到达即清
    function stepToward(pt, sp, dt) {
      var dx = pt.x - meFx;
      var dy = pt.y - meFy;
      var len = Math.sqrt(dx * dx + dy * dy);
      if (len < 0.12) return true;
      var vx = dx / len * sp * dt;
      var vy = dy / len * sp * dt;
      moveBody(vx, vy);
      return false;
    }

    function moveBody(vx, vy) {
      var ox = meFx;
      var oy = meFy;
      // 分轴滑墙
      var nx = meFx + vx;
      if (canStand(nx, meFy)) meFx = nx;
      var ny = meFy + vy;
      if (canStand(meFx, ny)) meFy = ny;
      var moved = Math.sqrt((meFx - ox) * (meFx - ox) + (meFy - oy) * (meFy - oy));
      walkAccum += moved;
      // 跨格计数（quest walk）——按格心穿越
      var cellNow = Math.floor(meFx) + ',' + Math.floor(meFy);
      if (cellNow !== lastCellKey) {
        lastCellKey = cellNow;
        walkCross += 1;
        // 路过采集：走到光点上顺手捡（点击移动路径上也生效）
        if (nodeUnderMe() || meteorNodeUnderMe()) doGather(true);
      }
      // 走路扬尘：每 0.8 格一步
      if (walkAccum > 0.8) {
        walkAccum = 0;
        spawnParts(meFx, meFy + 0.32, 1, 5, 0.4, [142, 130, 110]);
      }
      // 朝向：主轴
      if (Math.abs(vx) > Math.abs(vy) * 1.05) state.me.dir = vx > 0 ? 2 : 1;
      else if (Math.abs(vy) > 0.0001) state.me.dir = vy > 0 ? 0 : 3;
    }

    function tickMove(dt) {
      if (!state.ready || flying) return;
      if (talkBox.hidden === false) talkClose();
      if (fishing) {
        fishing = null;
        updateHint();
      }
      var sp = speedNow();
      var used = false;
      // 手动输入优先
      var iv = inputVector();
      if (iv && (Math.abs(iv.x) > 0.01 || Math.abs(iv.y) > 0.01)) {
        used = true;
        if (walkPath.length) stopWalk();
        if (followTarget) stopFollow();
        moveBody(iv.x * sp * dt, iv.y * sp * dt);
      } else if (walkPath.length) {
        // 点击移动：沿 BFS 路径的格心连续走
        var wp = walkPath[0];
        var target = { x: wp.x + 0.5, y: wp.y + 0.5 };
        var arrived = stepToward(target, sp, dt);
        if (arrived) {
          walkPath.shift();
          if (!walkPath.length) stopWalk();
        }
        used = true;
      } else if (followTarget) {
        var fp = state.players[followTarget];
        if (fp) {
          var d2 = (fp.x - meFx) * (fp.x - meFx) + (fp.y - meFy) * (fp.y - meFy);
          if (d2 > 1.1 * 1.1) {
            stepToward({ x: fp.x, y: fp.y }, sp, dt);
            used = true;
          } else {
            stopFollow();
            toast('跟上了');
          }
        } else {
          stopFollow();
        }
      }

      // 同步脚下格（全部格子语义的单一真相来源）
      var ncx = Math.floor(meFx);
      var ncy = Math.floor(meFy);
      if (ncx !== state.me.x || ncy !== state.me.y) {
        state.me.x = ncx;
        state.me.y = ncy;
      }

      // 位置上报（节流）
      var nowT = Date.now();
      if (used && nowT - lastReportAt > REPORT_MS) {
        lastReportAt = nowT;
        reportMove();
      }
    }

    function reportMove() {
      var steps = walkCross;
      walkCross = 0;
      http('post', '/shiguang/move', { x: meFx, y: meFy, dir: state.me.dir, steps: steps }).then(function(data) {
        if (!data) return;
        if (data.rejected) {
          if (data.me && typeof data.me.x === 'number') {
            meFx = Number(data.me.x) + 0.5;
            meFy = Number(data.me.y) + 0.5;
            state.me.x = Number(data.me.x);
            state.me.y = Number(data.me.y);
          }
          if (data.rejected !== 'fast') {
            if (walkPath.length) stopWalk();
            if (followTarget) stopFollow();
          }
          return;
        }
        if (data.me && typeof data.me.x === 'number') {
          // 服务端权威微校正：直接信任（服务端是钳速过的）
          meFx = Number(data.me.x);
          meFy = Number(data.me.y);
          state.me.x = Math.floor(meFx);
          state.me.y = Math.floor(meFy);
        }
        if (data.reveal) revealCells(data.reveal);
        updateHud();
      }).catch(function() {
        if (walkPath.length) stopWalk();
      });
    }

    var lastCellKey = '';
    var comboLevel = 0;
    var comboBuffAt = 0;

    function attemptMove(dx, dy) {
      if (!state.ready || flying) return;
      // ⚠️ 这里原来是 `if (talkBox.hidden === false) return;` —— 对话中不许走。
      // 后果是致命的：NPC 在 4 格内**自动**开口，而村口出生点离守灯人正好 4 格，
      // 于是玩家一进世界就被对话框顶住，摇杆连一个 /move 都不发出去，
      // 看起来就是「摇杆坏了」。唯一的解法是点对话框把 5 句台词看完 ——
      // 没人会想到「想走路得先跟人聊完天」。
      //
      // 任何游戏里推摇杆都该打断对话。台词跟人漂走是次要问题：
      // 人走了就把对话框收掉，比把人锁在原地好一万倍。
      if (talkBox.hidden === false) talkClose();
      if (fishing) {
        fishing = null;
        toast('走动收回了鱼线');
        updateHint();
      }
      var nx = state.me.x + dx;
      var ny = state.me.y + dy;
      if (nx < 0 || ny < 0 || nx >= state.size || ny >= state.size) return;
      var idx = ny * state.size + nx;
      // ⚠️ 这里原来只拦 CLOUD（'0'）。v4 加了岛内静水 LAKE（'6'），
      // 湖面同样不可走 —— 客户端放行的话，每一步都会被服务端拒绝并把人拽回来，
      // 手感上就是「按了没反应」，比直接撞墙更让人以为摇杆坏了。
      // 判定必须和服务端 world.walkable 一致：CLOUD 与 LAKE 都不可走。
      var cc = state.cells.charCodeAt(idx) - 48;
      if (cc === 0 || cc === 6) {
        bump(dx, dy);
        return;
      }
      var now = Date.now();
      if (now - lastMoveAt < moveGapNow()) return;
      lastMoveAt = now;

      state.me.x = nx;
      state.me.y = ny;
      state.me.dir = dirFrom(dx, dy);

      http('post', '/shiguang/move', { x: nx, y: ny, dir: state.me.dir }).then(function(data) {
        if (!data) return;
        if (data.rejected) {
          if (data.me) {
            state.me.x = data.me.x;
            state.me.y = data.me.y;
          }
          if (data.rejected === 'cloud' || data.rejected === 'bounds') bump(dx, dy);
          // 位置被校正：自动行走的旧路径已失效（'fast' 只是节流，下个 tick 重试）
          if (walkPath.length && data.rejected !== 'fast') stopWalk();
          return;
        }
        if (data.me) {
          state.me.x = data.me.x;
          state.me.y = data.me.y;
          state.me.dir = data.me.dir;
        }
        if (data.reveal) revealCells(data.reveal);
        updateHud();
        // 走到光点上就顺手捡走。手动「采集」按钮仍然保留（站着不动时用），
        // 但走路本身就是产出 —— 探索不再需要停下来按十次按钮。
        if (!walkPath.length && (nodeUnderMe() || meteorNodeUnderMe())) doGather(true);
      }).catch(function() {
        state.me.x = nx - dx;
        state.me.y = ny - dy;
        if (walkPath.length) stopWalk();
        toast('网络有点慢，走不动了');
      });
    }

    // ---------- 跟随同学：Journey 式的牵手 ----------
    // 贪心寻步：主轴优先，被挡就滑副轴；卡住 5 拍或 30 秒自动停。
    var followTarget = null;
    var followTimer = 0;
    var followStartedAt = 0;
    var followStuck = 0;
    var followLast = { x: 0, y: 0 };

    function startFollow(pid) {
      if (!state.ready) return;
      var p = state.players[pid];
      if (!p) return;
      followTarget = pid;
      followStartedAt = Date.now();
      followStuck = 0;
      followLast = { x: state.me.x, y: state.me.y };
      if (!followTimer) followTimer = setInterval(followTick, 180);
      toast('跟着 ' + p.name + ' 走　·　随便动一下就停下', 'warm');
    }

    function stopFollow() {
      if (followTimer) { clearInterval(followTimer); followTimer = 0; }
      followTarget = null;
    }

    // v4.9 跟随退役：tickMove 每帧朝目标连续走（>1.1 格追，≤1.1 格到站）。
    function followTick() { if (followTimer) { clearInterval(followTimer); followTimer = 0; } }
    var bumpTimer = 0;
    function bump(dx, dy) {
      if (bumpTimer) return;
      bumpTimer = setTimeout(function() { bumpTimer = 0; }, 220);
      if (dx) view.camX += dx * 0.12;
      if (dy) view.camY += dy * 0.12;
    }

    // ---------- 输入：键盘 ----------
    var KEY_DIR = {
      37: [-1, 0], 38: [0, -1], 39: [1, 0], 40: [0, 1],
      65: [-1, 0], 87: [0, -1], 68: [1, 0], 83: [0, 1]
    };
    var heldKey = 0;
    var holdTimer = 0;

    function onKeyDown(e) {
      if (e.keyCode === 27) {
        if (tutorial.hidden === false) { tutorialFinish(true); return; }
        if (modal.hidden === false) { closeModal(); return; }
        if (sheet.hidden === false) { closeSheet(); return; }
        if (talkBox.hidden === false) { talkClose(); return; }
        if (tray.className.indexOf('is-open') !== -1) { tray.className = 'sg-tray'; return; }
        return;
      }
      // 对话里的空格 / 回车 = 「继续」。不拦的话会被当成页面滚动
      if (talkBox.hidden === false) {
        if (e.keyCode === 32 || e.keyCode === 13) { e.preventDefault(); talkNext(); }
        return;
      }
      if (sheet.hidden === false || modal.hidden === false || tutorial.hidden === false) return;
      var tag = e.target && e.target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      var dir = KEY_DIR[e.keyCode];
      if (!dir) return;
      e.preventDefault();
      keyHeld[e.keyCode] = true;
      if (walkPath.length) stopWalk();
      if (followTarget) stopFollow();
      if (heldKey === e.keyCode) return;
      heldKey = e.keyCode;
      attemptMove(dir[0], dir[1]);
      if (holdTimer) clearInterval(holdTimer);
      holdTimer = setInterval(function() {
        if (heldKey !== e.keyCode) return;
        attemptMove(dir[0], dir[1]);
      }, MOVE_INTERVAL);
    }

    function onKeyUp(e) {
      delete keyHeld[e.keyCode];
      if (heldKey !== e.keyCode) return;
      heldKey = 0;
      if (holdTimer) {
        clearInterval(holdTimer);
        holdTimer = 0;
      }
    }

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    onDestroy(function() {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      if (holdTimer) clearInterval(holdTimer);
    });

    // ---------- 输入：摇杆 ----------
    var STICK_DEAD = 0.30;
    var STICK_TRAVEL = 0.56;

    var DIR_VEC = { '0': [0, 1], '1': [-1, 0], '2': [1, 0], '3': [0, -1] };
    var TICK_EL = [tickD, tickL, tickR, tickU];
    var TICK_CLS = ['sg-stick-tick sg-tick-d', 'sg-stick-tick sg-tick-l',
                    'sg-stick-tick sg-tick-r', 'sg-stick-tick sg-tick-u'];

    var stickPointer = null;
    var stickDir = -1;
    var lastStickDir = -1;
    var stickTimer = 0;
    var stickBox = { x: 0, y: 0, r: 0 };

    function measureStick() {
      var rect = stick.getBoundingClientRect();
      stickBox.x = rect.left + rect.width / 2;
      stickBox.y = rect.top + rect.height / 2;
      stickBox.r = rect.width / 2;
    }

    var stickVec = { x: 0, y: 0 };
    var stickVecActive = false;

    function stickTickStop() {
      if (stickTimer) {
        clearInterval(stickTimer);
        stickTimer = 0;
      }
    }

    function stickTickStart() {
      stickTickStop();
      stickTimer = setInterval(function() {
        if (stickDir < 0) return;
        var v = DIR_VEC[String(stickDir)];
        if (v) attemptMove(v[0], v[1]);
      }, MOVE_INTERVAL);
    }

    function pickDir(dx, dy) {
      var ax = Math.abs(dx);
      var ay = Math.abs(dy);
      if (ax < 0.0001 && ay < 0.0001) return -1;
      if (ax > ay * 1.15) return dx > 0 ? 2 : 1;
      if (ay > ax * 1.15) return dy > 0 ? 0 : 3;
      if (lastStickDir >= 0) return lastStickDir;
      return ax >= ay ? (dx > 0 ? 2 : 1) : (dy > 0 ? 0 : 3);
    }

    function setStickDir(dir) {
      if (dir === stickDir) return;
      stickDir = dir;
      if (dir >= 0) lastStickDir = dir;
      for (var i = 0; i < 4; i++) {
        TICK_EL[i].className = TICK_CLS[i] + (i === dir ? ' is-on' : '');
      }
      if (dir < 0) {
        stickTickStop();
        return;
      }
      // v4.9 摇杆改走模拟量向量（tickMove 驱动），不再按格步进
    }

    function stickDrag(clientX, clientY) {
      if (!stickBox.r) measureStick();
      var dx = clientX - stickBox.x;
      var dy = clientY - stickBox.y;
      var len = Math.sqrt(dx * dx + dy * dy);
      var maxR = stickBox.r * STICK_TRAVEL;
      var k = (len > maxR && len > 0) ? maxR / len : 1;
      var ox = dx * k;
      var oy = dy * k;
      var mag = maxR > 0 ? Math.min(1, len / maxR) : 0;

      stickKnob.style.transform = 'translate3d(' + ox.toFixed(1) + 'px,' + oy.toFixed(1) + 'px,0)';

      if (mag > 0.08) {
        var ang = Math.atan2(oy, ox) * 180 / Math.PI;
        stickRay.style.transform = 'rotate(' + ang.toFixed(1) + 'deg) scaleX(' + mag.toFixed(2) + ')';
        stickRay.style.opacity = (0.28 + mag * 0.58).toFixed(2);
      } else {
        stickRay.style.opacity = '0';
      }

      var deadPx = Math.max(11, maxR * STICK_DEAD);
      if (deadPx > maxR * 0.72) deadPx = maxR * 0.72;
      // v4.9 模拟量向量：摇杆的实时方向与力度直接喂给移动引擎
      if (len >= deadPx) {
        stickVecActive = true;
        stickVec.x = ox / (maxR || 1);
        stickVec.y = oy / (maxR || 1);
      } else {
        stickVecActive = false;
        stickVec.x = 0;
        stickVec.y = 0;
      }
      setStickDir(len >= deadPx ? pickDir(ox, oy) : -1);
    }

    function stickDown(e) {
      if (!state.ready || flying) return;
      if (walkPath.length) stopWalk();
      if (followTarget) stopFollow();
      if (stickPointer !== null) return;
      e.preventDefault();
      stickPointer = e.pointerId;
      try { stick.setPointerCapture(e.pointerId); } catch (err) {}
      measureStick();
      stick.classList.remove('is-hint');
      stick.classList.add('is-active');
      stickDrag(e.clientX, e.clientY);
    }

    function stickMove(e) {
      if (stickPointer !== e.pointerId) return;
      e.preventDefault();
      stickDrag(e.clientX, e.clientY);
    }

    function stickRelease(e) {
      if (stickPointer !== e.pointerId) return;
      stickPointer = null;
      try { stick.releasePointerCapture(e.pointerId); } catch (err) {}
      stick.classList.remove('is-active');
      stickKnob.style.transform = 'translate3d(0,0,0)';
      stickRay.style.opacity = '0';
      stickVecActive = false;
      stickVec.x = 0;
      stickVec.y = 0;
      setStickDir(-1);
      lastStickDir = -1;
    }

    stick.addEventListener('pointerdown', stickDown);
    stick.addEventListener('pointermove', stickMove);
    stick.addEventListener('pointerup', stickRelease);
    stick.addEventListener('pointercancel', stickRelease);
    onDestroy(function() {
      stickTickStop();
      stick.removeEventListener('pointerdown', stickDown);
      stick.removeEventListener('pointermove', stickMove);
      stick.removeEventListener('pointerup', stickRelease);
      stick.removeEventListener('pointercancel', stickRelease);
    });

    // 自查钩子：摇杆不动时先看这四个闸门哪个是关的。
    // （生产上排查过一次「进了世界就走不动」，所以留一个只读的观测点。）
    window.__sgDiag = function () {
      return {
        ready: state.ready,
        flying: flying,
        talk: talkBox.hidden === false,
        me: [state.me.x, state.me.y],
        stickDir: stickDir,
        stickPtr: stickPointer,
        sinceLastMove: Date.now() - lastMoveAt,
        moveGap: MOVE_GAP,
        moveInterval: MOVE_INTERVAL
      };
    };

    function playerAt(wx, wy) {
      var ids = Object.keys(state.players);
      for (var i = 0; i < ids.length; i++) {
        var p = state.players[ids[i]];
        if (!p) continue;
        if (Math.abs(p.x - wx) <= 0.6 && Math.abs(p.y - wy) <= 0.6) return p;
      }
      return null;
    }

    function onCanvasClick(e) {
      if (!state.ready || flying) return;
      if (sheet.hidden === false || modal.hidden === false || tutorial.hidden === false) return;
      var rect = canvas.getBoundingClientRect();
      var wx = Math.floor((e.clientX - rect.left - view.ox) / view.tile);
      var wy = Math.floor((e.clientY - rect.top - view.oy) / view.tile);
      if (wx < 0 || wy < 0 || wx >= state.size || wy >= state.size) return;
      // 点到同学：打开同学菜单（跟随 / 送火）—— 社交是点出来的
      var hitP = playerAt(wx, wy);
      if (hitP && hitP.id !== myId) {
        stopWalk();
        openSheet('player', hitP.name);
        renderPlayerMenu(sheetBody, hitP);
        return;
      }
      // 云海与湖水都不可点（那是墙，不是路）
      var cc = state.cells.charCodeAt(wy * state.size + wx) - 48;
      if (cc === 0 || cc === 6) return;
      var dx = wx - state.me.x;
      var dy = wy - state.me.y;
      if (Math.abs(dx) + Math.abs(dy) === 1) {
        stopWalk();
        attemptMove(dx, dy);
        return;
      }
      startWalk(wx, wy);
    }
    canvas.addEventListener('click', onCanvasClick);
    onDestroy(function() { canvas.removeEventListener('click', onCanvasClick); });
    onDestroy(function() {
      if (walkTimer) { clearInterval(walkTimer); walkTimer = 0; }
      if (followTimer) { clearInterval(followTimer); followTimer = 0; }
    });

    // ---------- 动作 ----------

    // quiet = true 时不弹 toast、不打断自动寻路 —— 供「走过去自动捡」调用。
    // 一个走路游戏里，让玩家为每一颗星屑按一次按钮，是把探索变成行政工作。
    function doGather(quiet) {
      if (!state.ready) return;
      if (!quiet && walkPath.length) stopWalk();
      var x = state.me.x;
      var y = state.me.y;

      // 脚下是自己种成熟的作物 → 收成。这是「种田」这条线的出口，
      // 也是星屑的第一个「生产过程」：2 星屑种下，收回 8。
      var fc = flowerUnderMe();
      if (fc && cropRipe(fc)) {
        http('post', '/shiguang/flower/harvest', {}).then(function(d) {
          if (!d) return;
          if (d.rejected) {
            if (d.rejected === 'growing') toast('还要长 ' + d.left + ' 天　记得每天浇水');
            else if (d.rejected === 'notMine') toast('这是别人种的，只能帮他浇水');
            else toast('这里没有可收的作物');
            return;
          }
          delete state.flowers[x + ',' + y];
          state.me.shards = d.shards;
          bombGather(x + 0.5, y + 0.5, false, d.got || 1);
          toast('收了 ' + (d.cropName || '作物') + '　+' + (d.got || 0) + ' 星屑' +
            (d.helped ? '　帮你浇水的人也分到了一点' : ''), 'warm');
          sfx.gather();
          updateHud();
        }).catch(function() { toast('收成失败，稍后再试'); });
        return;
      }
      if (fc) {
        toast('还没熟，先给它浇点水（按「种花」）');
        return;
      }

      if (!nodeUnderMe() && !meteorNodeUnderMe()) {
        toast('这里没有星屑，沿着光点再找找');
        return;
      }
      http('post', '/shiguang/gather', { x: x, y: y }).then(function(data) {
        if (!data) return;
        if (data.rejected) {
          // 自动捡的时候不要说这些：走过一片采空的区域会连弹十条提示
          if (!quiet) {
            if (data.rejected === 'cooldown') toast('这颗刚刚被采走了');
            else toast('脚下没有可采的星屑');
          }
          return;
        }
        // 增量要在覆盖 state.me.shards 之前算出来，浮字上写的必须是这一次真的捡到几枚
        var gain = Math.max(1, (data.shards | 0) - (state.me.shards | 0));
        if (typeof data.shards === 'number') state.me.shards = data.shards;
        // 采集是唯一的「主动补火」：连击加成也回一点火 —— 快节奏本身就有奖励
        lightState.v = Math.min(LIGHT_MAX, lightState.v + (data.meteor ? 22 : 14) + (data.comboBonus ? data.comboBonus * 3 : 0));
        if (data.meteor) {
          delete state.meteorNodes[x + ',' + y];
          if (!quiet) toast('拾到一颗星陨　共 ' + data.shards + ' 枚星屑', 'warm');
        } else {
          state.gathered[x + ',' + y] = Date.now();
          // 连击反馈：×2 起浮字，×4 起变调，×8 起金字加码 —— 节奏感全靠递进
          if (data.combo >= 2) {
            spawnFloat(x + 0.5, y + 0.1, '连击 ×' + data.combo + (data.comboBonus ? ' +' + data.comboBonus : ''), data.combo >= 8 ? [255, 214, 130] : [170, 220, 255], data.combo >= 8 ? 0.34 : 0.28);
            audio.blip(520 + Math.min(10, data.combo) * 55, 0.18, 'sine', 0.12, 0);
          }
          spawnFloat(x + 0.5, y - 0.05, '+' + (data.gain || 1), [255, 236, 170], 0.26);
          if (!quiet) {
            toast('+' + (data.gain || 1) + ' 星屑　共 ' + data.shards + ' 枚' + (data.combo >= 4 ? '　连击 ×' + data.combo : ''));
          }
          // 8 连击：短暂提速。手感上「越捡越快」比任何数字都更能让人停不下来。
          if (data.combo >= 8) comboRushUntil = Date.now() + 4000;
        }
        if (data.reveal) revealCells(data.reveal);
        bombGather(x + 0.5, y + 0.5, !!data.meteor, gain);
        sfx.gather();
        updateHud();
      }).catch(function() { toast('采集失败，稍后再试'); });
    }

    function doBuild() {
      if (!state.ready) return;
      if (walkPath.length) stopWalk();
      if ((state.me.shards || 0) < state.lampCost) {
        toast('还差 ' + (state.lampCost - state.me.shards) + ' 枚星屑');
        return;
      }
      // 点灯同时烧掉自己 22 点火。
      // 这是整个玩法里最重要的一次取舍：你把自己的命换成一块永久的安全区，
      // 而这块安全区对**别人**一样有效 —— 多人关系不是靠聊天建立的，
      // 是靠「谁在这里点过灯」建立的。
      if (lightState.v < 22) {
        toast('火不够了　点灯会烧掉 22 点，先去找星屑');
        return;
      }
      var x = state.me.x;
      var y = state.me.y;
      http('post', '/shiguang/build', { x: x, y: y }).then(function(data) {
        if (!data) return;
        if (data.rejected) {
          if (data.rejected === 'occupied') toast('这里已经有一座灯柱了');
          else if (data.rejected === 'flower') toast('这里有光花，换一处吧');
          else if (data.rejected === 'shards') toast('星屑不够，去捡几枚吧');
          else if (data.rejected === 'dock') toast('码头上立不了灯柱');
          else toast('这里立不起灯柱');
          return;
        }
        state.me.shards = data.shards;
        lightState.v = Math.max(1, lightState.v - 22);
        state.lampCount = data.lampCount;
        state.stage = data.stage;
        state.stageInfo = data.stageInfo;
        addLamp(x, y, state.me.lantern);
        if (data.reveal) revealCells(data.reveal);
        bombBuild(x + 0.5, y + 0.5);
        if (!data.dawn) {
          var nx2 = stageNext();
          var left = nx2 ? nx2.at - data.lampCount : 0;
          if (nx2 && left <= 0) toast('灯柱亮起　天光动了一下', 'warm');
          else if (nx2 && left <= 3) toast('灯柱亮起　离「' + nx2.name + '」只差 ' + left + ' 根', 'warm');
          else if (nx2) toast('灯柱亮起　离「' + nx2.name + '」还差 ' + left + ' 根', 'warm');
          else toast('灯柱亮起，周围亮了一些', 'warm');
        }
        sfx.build();
        updateHud();
      }).catch(function(err) {
        toast((err && err.message) || '点灯失败');
      });
    }

    function doPlant() {
      if (!state.ready) return;
      if (walkPath.length) stopWalk();

      // 站在一株还没熟的作物上 → 这个按钮就是「浇水」。
      // 不新开按钮：动作簇只有 6 格，加一个就得挤掉别的；
      // 而「站空地上是种、站苗上是浇」本身就是星露谷的手感。
      var fc = flowerUnderMe();
      if (fc && !cropRipe(fc)) {
        // 火就是体力：浇水 2 点 —— 田里最日常的一件事也要花力气
        if (!lightState || lightState.v < 2) {
          toast('火不够了　浇水要 2 点火，先回灯边歇歇');
          return;
        }
        http('post', '/shiguang/flower/water', {}).then(function(d) {
          if (!d) return;
          if (d.rejected) {
            if (d.rejected === 'wet') toast('今天已经浇过了　明天再来');
            else if (d.rejected === 'ripe') toast('已经熟了，直接收吧');
            else toast('这里没有要浇的作物');
            return;
          }
          lightState.v = Math.max(1, lightState.v - 2);
          fc.wateredDay = d.day;
          toast('浇过了　明天它会长高一节', 'warm');
          sfx.gather();
          updateHud();
        }).catch(function() { toast('浇水失败，稍后再试'); });
        return;
      }
      if (fc) { toast('已经熟了，按「采集」收下来'); return; }

      var tl0 = tileUnderMe();
      if (tl0 !== T_MEADOW && tl0 !== T_PATH) {
        toast('作物只肯在草地和路边扎根');
        return;
      }
      // 种什么由玩家选：打开种子面板（12 种、三档，价格差 100 倍）
      openSeedSheet();
      return;

      var tl = tileUnderMe();
      if (tl !== T_MEADOW && tl !== T_PATH) {
        toast('光花只肯在草地和路边扎根');
        return;
      }
      if ((state.me.shards || 0) < state.flowerCost) {
        toast('还差 ' + (state.flowerCost - state.me.shards) + ' 枚星屑');
        return;
      }
      var x = state.me.x;
      var y = state.me.y;
      http('post', '/shiguang/plant', { x: x, y: y }).then(function(data) {
        if (!data) return;
        if (data.rejected) {
          if (data.rejected === 'occupied') toast('这里已经开了一朵花');
          else if (data.rejected === 'lamp') toast('灯柱底下种不下花');
          else if (data.rejected === 'ground') toast('这里不是草地');
          else if (data.rejected === 'shards') toast('星屑不够');
          else if (data.rejected === 'my_cap') toast('你的花圃满了（' + data.cap + ' 株）');
          else if (data.rejected === 'world_cap') toast('岛上的花已经够多了，让别人也种种');
          else if (data.rejected === 'cooldown') toast('歇 ' + data.wait + ' 秒再种');
          else toast('没能种下');
          return;
        }
        state.me.shards = data.shards;
        addFlower(x, y, data.species, Date.now(), myId);
        cooldowns.plant = Date.now();
        sfx.plant();
        toast('种下了一株「' + data.speciesName + '」', 'warm');
        updateHud();
      }).catch(function(err) {
        toast((err && err.message) || '没能种下');
      });
    }

    function doFish() {
      if (!state.ready) return;
      if (walkPath.length) stopWalk();
      if (fishing) return;
      if (tileUnderMe() !== T_DOCK) {
        toast('走上码头才能抛竿');
        return;
      }
      http('post', '/shiguang/fish', {}).then(function(data) {
        if (!data) return;
        if (data.rejected) {
          if (data.rejected === 'ground') toast('走上码头才能抛竿');
          else if (data.rejected === 'cooldown') toast('鱼还没回来（还需 ' + data.wait + ' 秒）');
          return;
        }
        state.me.shards = data.shards;
        cooldowns.fish = Date.now();
        fishing = { at: Date.now(), result: data.fish };
        sfx.fishCast();
        updateHint();
        updateHud();
        setTimeout(function() {
          if (!fishing) return;
          var f = fishing.result;
          toast(f.name + '（' + RARITY_NAMES[f.rarity] + '）　+' + f.shards + ' 星屑', f.rarity >= 2 ? 'warm' : '');
          sfx.fishCatch(f.rarity);
          setTimeout(function() { fishing = null; updateHint(); }, 700);
        }, 2200);
      }).catch(function(err) {
        toast((err && err.message) || '线断了');
      });
    }

    var RARITY_NAMES = ['常见', '稀有', '史诗', '传说'];

    function doEmote(id) {
      if (!state.ready) return;
      if (walkPath.length) stopWalk();
      var now = Date.now();
      if (now - cooldowns.emote < 1800) return;
      cooldowns.emote = now;
      http('post', '/shiguang/emote', { id: id }).then(function(data) {
        if (!data || data.rejected) return;
        state.emoteFx.push({ uid: myId, id: id, x: state.me.x, y: state.me.y, at: Date.now() });
        if (state.emoteFx.length > 16) state.emoteFx.splice(0, state.emoteFx.length - 16);
        sfx.tap();
      }).catch(function() {
        cooldowns.emote = 0;
      });
    }

    // 石碑：唤醒（首建者拿星屑，全班看碑文，集齐五座触发秘境）
    function doStele() {
      if (!state.ready || flying) return;
      if (walkPath.length) stopWalk();
      var s = steleNearMe();
      if (!s) return;
      http('post', '/shiguang/stele', { x: s.x, y: s.y }).then(function(data) {
        if (!data) return;
        if (data.rejected) {
          if (data.rejected === 'done') toast('这座石碑已经苏醒了');
          else toast('走近一点再触碰它');
          return;
        }
        state.me.shards = data.shards;
        state.steles[s.x + ',' + s.y] = { name: s.name, rune: s.rune, by: myId, at: Date.now() };
        sfx.rune();
        toast('「' + s.name + '」苏醒　+' + data.reward + ' 星屑', 'award');
        if (data.count >= data.total) {
          showBanner('rune', '五碑之谜 · 秘境之门开启', '全班唤醒了所有石碑 —— 云海深处传来了回响', 'legend', 6500);
        }
        updateHud();
      }).catch(function(err) {
        toast((err && err.message) || '石碑没有回应');
      });
    }

    // 灯柱升级：5 星屑，半径 4→6，全班受益
    function doUpgrade() {
      if (!state.ready || flying) return;
      var lp = upgradableLampNearMe();
      if (!lp) return;
      http('post', '/shiguang/upgrade', { x: lp.x, y: lp.y }).then(function(data) {
        if (!data) return;
        if (data.rejected) {
          if (data.rejected === 'shards') toast('还差 ' + (data.need - state.me.shards) + ' 枚星屑');
          else if (data.rejected === 'max') toast('这根灯柱已经是二级了');
          else if (data.rejected === 'far') toast('走近一点再升级');
          else toast('升不了');
          return;
        }
        state.me.shards = data.shards;
        addLamp(lp.x, lp.y, state.lamps[lp.x + ',' + lp.y].c, 2);
        sfx.build();
        camPunch(0.972, 600);
        toast('灯柱升级了　光照更远', 'warm');
        updateHud();
      }).catch(function(err) {
        toast((err && err.message) || '升级失败');
      });
    }

    // ---------- v4.2 农事：锄 / 种 / 浇 / 收 ----------
    // 火就是体力：锄 4、浇 2、播 1。收获不扣 —— 成就感的瞬间不该收费。
    function farmSpendFire(cost, label) {
      if (!lightState || lightState.v < cost) {
        toast('火不够了　' + label + '要烧 ' + cost + ' 点火，先回灯边歇歇');
        return false;
      }
      lightState.v = Math.max(1, lightState.v - cost);
      updateHud();
      return true;
    }

    // 纸鸢快线：打开选岛面板
    function doFly() {
      if (!state.ready || flying) return;
      if (walkPath.length) stopWalk();
      if (tileUnderMe() !== T_DOCK) return;
      openSheet('fly', '纸鸢快线');
    }

    function flyTo(isle) {
      if (flying) return;
      http('post', '/shiguang/fly', { isle: isle }).then(function(data) {
        if (!data) return;
        if (data.rejected) {
          if (data.rejected === 'ground') toast('要站在码头上才能搭纸鸢');
          else if (data.rejected === 'shards') toast('还差 ' + (data.need - state.me.shards) + ' 枚星屑');
          else if (data.rejected === 'same') toast('你已经在这座岛上了');
          else toast('纸鸢没有来');
          closeSheet();
          return;
        }
        closeSheet();
        flying = true;
        cooldowns.fly = Date.now();
        sfx.fly();
        flight.hidden = false;
        flight.className = 'sg-flight is-open';
        var flightText = flight.lastChild;
        flightText.textContent = '纸鸢掠过云海 → ' + data.isleName;
        state.ready = false;   // 飞行途中锁操作
        setTimeout(function() {
          state.me.x = data.x;
          state.me.y = data.y;
          view.camX = data.x + 0.5;
          view.camY = data.y + 0.5;
          if (data.reveal) revealCells(data.reveal);
          state.ready = true;
          state.lastIsle = data.isleName;   // 落地不重复报「抵达」横幅
        }, 1000);
        setTimeout(function() {
          flight.className = 'sg-flight';
          setTimeout(function() { flight.hidden = true; flying = false; }, 400);
          showBanner('pin', '抵达 · ' + data.isleName, ISLE_SUB[data.isleName] || '', '', 3800);
          updateHud();
        }, 1700);
      }).catch(function(err) {
        toast((err && err.message) || '纸鸢没有来');
      });
    }

    btnGather.addEventListener('click', doGather);
    btnBuild.addEventListener('click', doBuild);
    btnPlant.addEventListener('click', doPlant);
    btnFish.addEventListener('click', doFish);
    btnFly.addEventListener('click', doFly);
    btnStele.addEventListener('click', doStele);
    btnUpgrade.addEventListener('click', doUpgrade);
    btnSleep.addEventListener('click', doSleep);
    btnPickLetter.addEventListener('click', function() {
      var lt = letterNearMe();
      if (lt) pickLetter(lt.id);
    });
    onDestroy(function() {
      btnGather.removeEventListener('click', doGather);
      btnBuild.removeEventListener('click', doBuild);
      btnPlant.removeEventListener('click', doPlant);
      btnFish.removeEventListener('click', doFish);
      btnFly.removeEventListener('click', doFly);
      btnUpgrade.removeEventListener('click', doUpgrade);
      btnSleep.removeEventListener('click', doSleep);
      btnPickLetter.removeEventListener('click', function() {});
      btnStele.removeEventListener('click', doStele);
    });

    function toggleTray() {
      var isOpen = tray.className.indexOf('is-open') !== -1;
      tray.className = isOpen ? 'sg-tray' : 'sg-tray is-open';
      if (!isOpen) sfx.tap();
    }
    btnEmote.addEventListener('click', toggleTray);
    onDestroy(function() { btnEmote.removeEventListener('click', toggleTray); });

    var emoteBindCleanup = [];
    var emoteIds = Object.keys(trayBtns);
    for (var eb2 = 0; eb2 < emoteIds.length; eb2++) {
      (function(eid) {
        var fn = function() {
          tray.className = 'sg-tray';
          doEmote(eid);
        };
        trayBtns[eid].addEventListener('click', fn);
        emoteBindCleanup.push([trayBtns[eid], fn]);
      })(emoteIds[eb2]);
    }
    onDestroy(function() {
      for (var i = 0; i < emoteBindCleanup.length; i++) {
        emoteBindCleanup[i][0].removeEventListener('click', emoteBindCleanup[i][1]);
      }
    });

    // ---------- §10 面板 ----------

    var sheetKind = '';
    var sheetHideTimer = 0;

    function openSheet(kind, title) {
      if (sheetHideTimer) { clearTimeout(sheetHideTimer); sheetHideTimer = 0; }
      sheetKind = kind;
      sheetTitle.textContent = title;
      sheet.hidden = false;
      sheet.offsetWidth;
      sheet.className = 'sg-sheet is-open';
      clearNode(sheetBody);
      sfx.tap();
    }

    function closeSheet() {
      if (sheet.hidden) return;
      sheetKind = '';
      sheet.className = 'sg-sheet';
      sheetHideTimer = setTimeout(function() {
        sheet.hidden = true;
        clearNode(sheetBody);
        sheetHideTimer = 0;
      }, 240);
    }
    onDestroy(function() { if (sheetHideTimer) clearTimeout(sheetHideTimer); });

    sheetClose.addEventListener('click', closeSheet);
    sheetDim.addEventListener('click', closeSheet);
    onDestroy(function() {
      sheetClose.removeEventListener('click', closeSheet);
      sheetDim.removeEventListener('click', closeSheet);
    });

    function sectionTitle(text) {
      return el('div', 'sg-sec-title', text);
    }

    // ---------- 种子面板 ----------
    // 12 种作物按三档列出：成本 / 时间 / 收成 / 净赚。
    // 「净赚」必须直接写出来 —— 让玩家自己算 38−12 是在浪费他的注意力。
    function fmtDur(sec) {
      if (sec < 60) return sec + ' 秒';
      if (sec < 3600) return Math.round(sec / 60) + ' 分';
      return (Math.round(sec / 360) / 10) + ' 小时';
    }

    function openSeedSheet() {
      openSheet('seed', '选一包种子');
      var list = (state.catalog && state.catalog.crops) || [];
      if (!list.length) {
        sheetBody.appendChild(emptyBox('种子还没送到，等一会儿再试'));
        return;
      }
      var shards = state.me.shards || 0;
      var tierName = { 1: '一阶 · 快（今天种，明后天就收）', 2: '二阶 · 中（三到五天）', 3: '三阶 · 慢（一周以上的牵挂）' };
      var tierNow = 0;
      for (var i = 0; i < list.length; i++) {
        var c = list[i];
        if (c.tier !== tierNow) {
          tierNow = c.tier;
          sheetBody.appendChild(sectionTitle(tierName[c.tier] || '作物'));
        }
        var row = el('button', 'sg-seed' + (shards < c.cost ? ' is-poor' : ''));
        row.type = 'button';
        var dot = el('i', 'sg-seed-dot');
        var col = FLOWER_COLORS[c.id % FLOWER_COLORS.length];
        dot.style.background = col.petal;
        dot.style.boxShadow = '0 0 8px rgba(' + col.glow + ',0.75)';
        row.appendChild(dot);
        // 价格不再单独占一列：列宽固定 + 中文数字宽度不定，在 1024 上会被右边缘裁掉。
        // 改成「名字 ←→ 价格」同一行，第二行放时间/收成/净赚 —— 怎么缩都不会溢出。
        var body = el('div', 'sg-seed-body');
        var topRow = el('div', 'sg-seed-top');
        topRow.appendChild(el('b', null, c.name));
        // v4.7 季节标记：当季生长，过季不能种
        var inSeason = c.season === SEASONS.indexOf(state.season || '春');
        // v4.8 节日半价：每季第一天
        var isFestivalDay = ((state.calendar.day || 1) - 1) % 28 % 7 === 0;
        var showCost = isFestivalDay ? Math.max(1, Math.ceil(c.cost / 2)) : c.cost;
        topRow.appendChild(el('i', null, showCost + ' ★' + (isFestivalDay && c.cost > 1 ? '（节日半价）' : '')));
        body.appendChild(topRow);
        var seasonTag = el('span', 'sg-seed-season ' + (inSeason ? 'is-in' : 'is-out'),
          SEASONS[c.season] + '作物' + (inSeason ? ' · 当季' : ' · 要等' + SEASONS[c.season]));
        body.appendChild(seasonTag);
        body.appendChild(el('span', null,
          c.days + ' 天成熟　收 ' + c.yield + '　净赚 ' + (c.yield - showCost)));
        row.appendChild(body);
        (function(crop) {
          row.addEventListener('click', function() {
            if (crop.season !== SEASONS.indexOf(state.season || '春')) {
              toast(SEASONS[crop.season] + '的种子要等' + SEASONS[crop.season] + '天 —— 现在是' + (state.season || '春'));
              return;
            }
            if ((state.me.shards || 0) < crop.cost) {
              toast('还差 ' + (crop.cost - state.me.shards) + ' 枚星屑');
              return;
            }
            closeSheet();
            plantCrop(crop.id);
          });
        })(c);
        sheetBody.appendChild(row);
      }
      sheetBody.appendChild(el('div', 'sg-seed-tip', '一天浇一瓢水，隔夜长一节；不浇不长。别人也能帮你浇。'));
    }

    function plantCrop(species) {
      if (!state.ready) return;
      var x = state.me.x;
      var y = state.me.y;
      http('post', '/shiguang/plant', { x: x, y: y, species: species }).then(function(data) {
        if (!data) return;
        if (data.rejected) {
          if (data.rejected === 'occupied') toast('这里已经有一株了');
          else if (data.rejected === 'lamp') toast('灯柱底下种不下');
          else if (data.rejected === 'ground') toast('这里不是草地');
          else if (data.rejected === 'shards') toast('还差 ' + (data.need - data.have) + ' 枚星屑');
          else if (data.rejected === 'my_cap') toast('你的田满了（' + data.cap + ' 株）');
          else if (data.rejected === 'world_cap') toast('岛上的田已经够多了');
          else if (data.rejected === 'cooldown') toast('歇 ' + data.wait + ' 秒再种');
          else toast('没能种下');
          return;
        }
        state.me.shards = data.shards;
        addFlower(x, y, data.species, Date.now(), myId, 0, 0);
        var planted = state.flowers[x + ',' + y];
        if (planted) planted.growth = 0;
        bombBuild(x + 0.5, y + 0.5);
        toast(data.speciesName + '　种下了　' + data.days + ' 天后收　每天记得浇水', 'warm');
        sfx.build();
        updateHud();
      }).catch(function() { toast('种植失败，稍后再试'); });
    }

    function emptyBox(text) {
      return el('div', 'sg-empty', text);
    }

    function loadingInline(text) {
      return el('div', 'sg-loading-inline', text || '正在翻页…');
    }

    function progressBar(frac, tone) {
      var box = el('div', 'sg-prog' + (tone ? ' sg-prog-' + tone : ''));
      var fill = el('i', 'sg-prog-fill');
      fill.style.transform = 'scaleX(' + clamp(frac, 0, 1).toFixed(3) + ')';
      box.appendChild(fill);
      return box;
    }

    function segmented(items, activeIdx, onChange) {
      var box = el('div', 'sg-seg');
      var btns = [];
      function sync() {
        for (var i = 0; i < btns.length; i++) {
          btns[i].className = 'sg-seg-item' + (i === activeIdx ? ' is-on' : '');
        }
      }
      for (var i = 0; i < items.length; i++) {
        (function(idx) {
          var b = el('button', 'sg-seg-item', items[idx]);
          b.type = 'button';
          b.addEventListener('click', function() {
            if (idx === activeIdx) return;
            activeIdx = idx;
            sync();
            onChange(idx);
          });
          box.appendChild(b);
          btns.push(b);
        })(i);
      }
      sync();
      return box;
    }

    function toggleSwitch(labelText, isOn, onChange) {
      var row = el('div', 'sg-set-row');
      row.appendChild(el('div', 'sg-set-label', labelText));
      var sw = el('button', 'sg-switch' + (isOn ? ' is-on' : ''));
      sw.type = 'button';
      sw.setAttribute('aria-label', labelText);
      sw.appendChild(el('i', 'sg-switch-knob'));
      sw.addEventListener('click', function() {
        onChange();
      });
      row.appendChild(sw);
      return { row: row, sw: sw };
    }

    // ---------- 任务面板 ----------
    var RARITY_TONES = ['', 'sg-chip-rare', 'sg-chip-epic', 'sg-chip-legend'];

    function questCard(q, locked) {
      var card = el('div', 'sg-qcard' + (locked ? ' is-locked' : '') + (q.done && !q.claimed ? ' is-done' : '') + (q.claimed ? ' is-claimed' : ''));
      var top = el('div', 'sg-q-top');
      top.appendChild(el('span', 'sg-q-title', q.def ? q.def.title : q.key));
      var reward = el('span', 'sg-chip sg-chip-reward', '+' + (q.def ? q.def.reward : 0));
      top.appendChild(reward);
      card.appendChild(top);
      if (q.def) card.appendChild(el('div', 'sg-q-desc', q.def.desc));
      if (!locked) {
        card.appendChild(progressBar(q.def ? q.progress / q.def.goal : 0, q.done ? 'done' : ''));
        var foot = el('div', 'sg-q-foot');
        foot.appendChild(el('span', 'sg-q-progress', (q.def ? q.progress : 0) + ' / ' + (q.def ? q.def.goal : 0)));
        if (q.claimed) {
          foot.appendChild(el('span', 'sg-q-state is-ok', '已领取'));
        } else if (q.done) {
          var claim = el('button', 'sg-q-claim', '领取奖励');
          claim.type = 'button';
          claim.addEventListener('click', function() {
            claim.disabled = true;
            http('post', '/shiguang/quests/claim', { key: q.key }).then(function(data) {
              if (data && data.rejected) {
                claim.disabled = false;
                toast(data.rejected === 'not_done' ? '还没完成' : '已经领过了');
                return;
              }
              if (data) state.me.shards = data.shards;
              sfx.award();
              toast('+' + (data ? data.reward : 0) + ' 星屑　任务奖励已入账', 'warm');
              refreshQuestsPanel();
              updateHud();
            }).catch(function(err) {
              claim.disabled = false;
              toast((err && err.message) || '领奖失败');
            });
          });
          foot.appendChild(claim);
        } else {
          foot.appendChild(el('span', 'sg-q-state', '进行中'));
        }
        card.appendChild(foot);
      } else {
        card.appendChild(el('div', 'sg-q-locked', '完成上一条后自动开始'));
      }
      return card;
    }

    var questsBodyRef = null;
    function refreshQuestsPanel() {
      if (sheetKind !== 'quests' || !questsBodyRef) return;
      renderQuests(questsBodyRef);
    }

    function renderQuests(body) {
      clearNode(body);
      body.appendChild(loadingInline());
      questsBodyRef = body;
      http('get', '/shiguang/quests').then(function(data) {
        if (sheetKind !== 'quests') return;
        clearNode(body);
        state.claimable = 0;
        var intro = (data && data.intro) || [];
        var daily = (data && data.daily) || [];
        for (var i = 0; i < intro.length; i++) {
          if (intro[i].done && !intro[i].claimed) state.claimable++;
        }
        for (var d = 0; d < daily.length; d++) {
          if (daily[d].done && !daily[d].claimed) state.claimable++;
        }

        body.appendChild(sectionTitle('拾光引路 · 一步步点亮群岛'));
        var activeFound = false;
        for (var a = 0; a < intro.length; a++) {
          var q = intro[a];
          var isLocked = !q.claimed && activeFound;
          if (!q.claimed && !activeFound) activeFound = true;
          body.appendChild(questCard(q, isLocked));
        }

        body.appendChild(sectionTitle('今日拾光 · 换日刷新'));
        if (!daily.length) body.appendChild(emptyBox('今天的任务还在海上漂着，稍后再看。'));
        for (var b = 0; b < daily.length; b++) body.appendChild(questCard(daily[b], false));
        updateHud();
      }).catch(function() {
        clearNode(body);
        body.appendChild(emptyBox('任务卷轴被海风吹走了，稍后再试。'));
      });
    }

    function openQuests() {
      openSheet('quests', '拾光任务');
      renderQuests(sheetBody);
    }

    // ---------- 纸鸢快线选岛 ----------
    function renderFly(body) {
      clearNode(body);
      body.appendChild(el('div', 'sg-cf-head', '站在码头上才能登鸢 · 每程 2 星屑 · 落地会点亮周围一圈'));
      var isles = state.catalog.islands || [];
      var list = el('div', 'sg-fly-list');
      for (var i = 0; i < isles.length; i++) {
        (function(isle, idx) {
          var here = islandNameHere();
          var row = el('div', 'sg-fly-row' + (here === isle.name ? ' is-here' : ''));
          var mid = el('div', 'sg-cf-mid');
          mid.appendChild(el('div', 'sg-cf-name', isle.name));
          mid.appendChild(el('div', 'sg-cf-note', ISLE_SUB[isle.name] || ''));
          row.appendChild(mid);
          var right = el('div', 'sg-cf-right');
          if (here === isle.name) {
            right.appendChild(el('div', 'sg-wstate is-on', '此岛'));
          } else {
            var btn = el('button', 'sg-wbtn sg-wbtn-buy', '起飞');
            btn.type = 'button';
            btn.addEventListener('click', function() { flyTo(idx); });
            right.appendChild(btn);
          }
          row.appendChild(right);
          list.appendChild(row);
        })(isles[i], i);
      }
      body.appendChild(list);
    }

    // ---------- 衣柜 ----------
    var WARDROBE_KINDS = [
      { key: 'hat', label: '帽子' },
      { key: 'lantern', label: '提灯' },
      { key: 'title', label: '称号' }
    ];

    function shopNameOf(kind, id) {
      var shop = (state.catalog.shop && state.catalog.shop[kind]) || [];
      for (var i = 0; i < shop.length; i++) if (shop[i].id === id) return shop[i].name;
      return id;
    }

    function renderWardrobe(body, activeKind) {
      clearNode(body);
      body.appendChild(loadingInline());
      http('get', '/shiguang/wardrobe').then(function(data) {
        if (sheetKind !== 'wardrobe') return;
        clearNode(body);
        if (data) {
          state.wardrobe.owned = data.owned || state.wardrobe.owned;
          state.wardrobe.equipped = data.equipped || state.wardrobe.equipped;
        }
        var owned = state.wardrobe.owned || {};
        var equipped = state.wardrobe.equipped || {};

        var initialIdx = 0;
        for (var tk = 0; tk < WARDROBE_KINDS.length; tk++) {
          if (WARDROBE_KINDS[tk].key === activeKind) initialIdx = tk;
        }
        var tabs = segmented(WARDROBE_KINDS.map(function(k) { return k.label; }),
          initialIdx,
          function(idx) { renderWardrobe(body, WARDROBE_KINDS[idx].key); });
        body.appendChild(tabs);

        var kind = activeKind || 'hat';
        var defs = (data && data.shop && data.shop[kind]) || [];
        var grid = el('div', 'sg-wgrid');
        for (var i = 0; i < defs.length; i++) {
          var item = defs[i];
          var isOwned = owned[kind] && owned[kind].indexOf(item.id) !== -1;
          var isEquipped = equipped[kind] === item.id;
          var cell = el('div', 'sg-wcell' + (isEquipped ? ' is-equipped' : '') + (isOwned ? ' is-owned' : ''));
          var prev = el('div', 'sg-wprev');
          var icoWrap = el('span', 'sg-wprev-ico');
          var icoName = kind === 'hat' ? 'hat' : (kind === 'lantern' ? 'lamp' : 'spark');
          icoWrap.appendChild(svgIcon(icoName));
          if (kind === 'lantern') {
            var lc = LANTERN_COLORS[item.id];
            if (lc) icoWrap.style.color = 'rgb(' + lc.glow + ')';
          }
          prev.appendChild(icoWrap);
          cell.appendChild(prev);
          cell.appendChild(el('div', 'sg-wname', item.name));
          var foot = el('div', 'sg-wfoot');
          if (isEquipped) {
            foot.appendChild(el('span', 'sg-wstate is-on', '装备中'));
          } else if (isOwned) {
            var btnEq = el('button', 'sg-wbtn', '装备');
            btnEq.type = 'button';
            btnEq.addEventListener('click', function(k2, id2) {
              return function() {
                http('post', '/shiguang/wardrobe/equip', { kind: k2, item: id2 }).then(function(res) {
                  if (res && res.rejected) { toast('还不能装备它'); return; }
                  state.wardrobe.equipped[k2] = id2;
                  if (k2 === 'hat') state.me.hat = id2;
                  else if (k2 === 'lantern') state.me.lantern = id2;
                  else state.me.title = id2;
                  sfx.tap();
                  toast('换上了「' + shopNameOf(k2, id2) + '」', 'warm');
                  renderWardrobe(body, k2);
                }).catch(function() { toast('没能换上'); });
              };
            }(kind, item.id));
            foot.appendChild(btnEq);
          } else {
            var btnBuy = el('button', 'sg-wbtn sg-wbtn-buy', item.price + ' 星屑');
            btnBuy.type = 'button';
            btnBuy.addEventListener('click', function(k2, id2, price2) {
              return function() {
                if ((state.me.shards || 0) < price2) {
                  toast('还差 ' + (price2 - state.me.shards) + ' 枚星屑');
                  return;
                }
                btnBuy.disabled = true;
                http('post', '/shiguang/wardrobe/buy', { kind: k2, item: id2 }).then(function(res) {
                  btnBuy.disabled = false;
                  if (res && res.rejected) {
                    if (res.rejected === 'shards') toast('星屑不够');
                    else if (res.rejected === 'owned') toast('已经拥有');
                    else toast('买不了它');
                    return;
                  }
                  if (res) state.me.shards = res.shards;
                  sfx.award();
                  toast('「' + shopNameOf(k2, id2) + '」已入手，去装备它', 'warm');
                  renderWardrobe(body, k2);
                  updateHud();
                }).catch(function() {
                  btnBuy.disabled = false;
                  toast('购买失败');
                });
              };
            }(kind, item.id, item.price));
            foot.appendChild(btnBuy);
          }
          cell.appendChild(foot);
          grid.appendChild(cell);
        }
        body.appendChild(grid);
        body.appendChild(el('div', 'sg-tip', '帽子与提灯的颜色，全班都看得见 —— 你点亮的每一根灯柱，也是你的颜色。'));
      }).catch(function() {
        clearNode(body);
        body.appendChild(emptyBox('衣柜的门卡住了，稍后再试。'));
      });
    }

    function openWardrobe() {
      openSheet('wardrobe', '拾光衣柜');
      renderWardrobe(sheetBody, 'hat');
    }

    // ---------- 世界地图 ----------
    // 一张 2px/格的完整世界图：已探索是亮色，未探索只留岛影；
    // 地标 / 石碑 / 流星雨 / 同学 / 自己 全部标上去。
    var wmapTimer = 0;
    function openWorldMap() {
      openModal();
      clearNode(modalCard);
      var head = el('div', 'sg-modal-head');
      head.appendChild(el('div', 'sg-modal-title', '世界地图'));
      var closeBtn = el('button', 'sg-sheet-close');
      closeBtn.type = 'button';
      closeBtn.setAttribute('aria-label', '关闭');
      closeBtn.appendChild(svgIcon('close'));
      closeBtn.addEventListener('click', closeModal);
      head.appendChild(closeBtn);
      modalCard.appendChild(head);

      var body = el('div', 'sg-modal-body');
      var wrap = el('div', 'sg-wmap-wrap');
      var wcv = document.createElement('canvas');
      wcv.className = 'sg-wmap-canvas';
      var size = state.size;
      var k = 2;
      wcv.width = size * k;
      wcv.height = size * k;
      wrap.appendChild(wcv);
      body.appendChild(wrap);
      var caption = el('div', 'sg-wmap-cap', '');
      body.appendChild(caption);
      modalCard.appendChild(body);

      function renderWorldMap() {
        try {
        var c = wcv.getContext('2d');
        c.fillStyle = '#0a0f1e';
        c.fillRect(0, 0, wcv.width, wcv.height);
        var MM = MM_COLORS;
        for (var y = 0; y < size; y++) {
          for (var x = 0; x < size; x++) {
            var idx = y * size + x;
            var code = state.cells.charCodeAt(idx) - 48;
            var seen = state.explored && state.explored[idx];
            if (!seen) {
              // 未探索：陆地只留一点轮廓，让人知道「还有多少没点亮」
              if (code !== T_CLOUD) {
                c.fillStyle = 'rgba(90, 110, 150, 0.14)';
                c.fillRect(x * k, y * k, k, k);
              }
              continue;
            }
            var col = MM[code] || MM[T_CLOUD];
            c.fillStyle = 'rgb(' + col[0] + ',' + col[1] + ',' + col[2] + ')';
            c.fillRect(x * k, y * k, k, k);
          }
        }
        // 光花（翻好的土 species=-1 不算花，跳过）
        for (var fk in state.flowers) {
          if (!Object.prototype.hasOwnProperty.call(state.flowers, fk)) continue;
          var f = state.flowers[fk];
          if (!f || f.species < 0) continue;
          var fc = FLOWER_COLORS[f.species % FLOWER_COLORS.length];
          if (!fc) continue;
          c.fillStyle = fc.petal;
          c.fillRect(f.x * k - 1, f.y * k - 1, k + 2, k + 2);
        }
        // 灯柱（金点）
        c.fillStyle = 'rgba(255, 208, 128, 0.95)';
        var lampKeys = Object.keys(state.lamps);
        for (var lk = 0; lk < lampKeys.length; lk++) {
          var lamp = state.lamps[lampKeys[lk]];
          c.fillRect(lamp.x * k - 1, lamp.y * k - 1, k + 2, k + 2);
        }
        // 地标小标
        var landmarks = state.catalog.landmarks || [];
        c.fillStyle = 'rgba(206, 224, 255, 0.9)';
        for (var lm = 0; lm < landmarks.length; lm++) {
          c.fillRect(landmarks[lm].x * k - 2, landmarks[lm].y * k - 2, k + 4, k + 4);
        }
        // 石碑（紫标；未唤醒的是空圈）
        var steles = state.catalog.steles || [];
        for (var sd = 0; sd < steles.length; sd++) {
          var st = steles[sd];
          var rec = state.steles[st.x + ',' + st.y];
          if (rec && rec.by) {
            c.fillStyle = 'rgba(202, 176, 255, 0.95)';
            c.fillRect(st.x * k - 2, st.y * k - 2, k + 4, k + 4);
          } else {
            c.strokeStyle = 'rgba(202, 176, 255, 0.6)';
            c.lineWidth = 1;
            c.strokeRect(st.x * k - 2.5, st.y * k - 2.5, k + 5, k + 5);
          }
        }
        // 流星雨
        if (state.meteor && state.meteor.active) {
          var pulse = 0.5 + 0.5 * Math.sin(Date.now() * 0.006);
          c.strokeStyle = 'rgba(255, 170, 200, ' + (0.6 + 0.3 * pulse).toFixed(2) + ')';
          c.lineWidth = 2;
          c.beginPath();
          c.arc(state.meteor.x * k, state.meteor.y * k, 6 + pulse * 3, 0, 6.2832);
          c.stroke();
        }
        // 同学 + NPC
        var ids = Object.keys(state.players);
        c.fillStyle = 'rgba(238, 244, 255, 0.95)';
        for (var pi = 0; pi < ids.length; pi++) {
          var pl = state.players[ids[pi]];
          c.fillRect(pl.x * k - 1, pl.y * k - 1, k + 2, k + 2);
        }
        // 自己：金点 + 双圈光晕（大地图上第一时间找到自己）
        var myX = (typeof meFx === 'number' && meFx > 0) ? meFx : state.me.x;
        var myY = (typeof meFy === 'number' && meFy > 0) ? meFy : state.me.y;
        c.strokeStyle = 'rgba(255, 226, 150, 0.5)';
        c.lineWidth = 2;
        c.beginPath();
        c.arc(myX * k, myY * k, 9, 0, 6.2832);
        c.stroke();
        c.strokeStyle = 'rgba(255, 226, 150, 0.25)';
        c.beginPath();
        c.arc(myX * k, myY * k, 14, 0, 6.2832);
        c.stroke();
        c.fillStyle = 'rgba(255, 226, 150, 1)';
        c.fillRect(myX * k - 2, myY * k - 2, k + 4, k + 4);
        c.fillStyle = '#ffffff';
        c.fillRect(myX * k, myY * k, k, k);
        // 岛名：跨岛导航的坐标系，必须一眼可读
        var isles = state.catalog.islands || [];
        c.font = canvasFont(12, true);
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        for (var ii = 0; ii < isles.length; ii++) {
          var is = isles[ii];
          var nm = is.name;
          var tw = c.measureText(nm).width;
          c.fillStyle = 'rgba(4, 8, 18, 0.74)';
          c.fillRect(is.cx * k - tw / 2 - 5, is.cy * k - 10, tw + 10, 17);
          c.fillStyle = 'rgba(244, 248, 255, 0.97)';
          c.fillText(nm, is.cx * k, is.cy * k - 1);
        }
        // 探索率
        var total = size * size;
        var landN = 0;
        var seenN = 0;
        for (var ci = 0; ci < total; ci++) {
          var code2 = state.cells.charCodeAt(ci) - 48;
          if (code2 === T_CLOUD) continue;
          landN++;
          if (state.explored && state.explored[ci]) seenN++;
        }
        caption.textContent = '已照亮 ' + seenN + ' / ' + landN + ' 格陆地（' + Math.round(seenN * 100 / Math.max(1, landN)) + '%）· 金点=灯柱 · 白点=同学 · 紫标=石碑';
        } catch (eWmap) { window.__wmapErr = String((eWmap && (eWmap.stack || eWmap.message)) || eWmap); }
      }
      renderWorldMap();
      clearInterval(wmapTimer);
      wmapTimer = setInterval(renderWorldMap, 1000);
      onDestroy(function() { clearInterval(wmapTimer); });
    }

    // ---------- 群岛志（排行 / 拾光录 / 成就） ----------
    var BOOK_TABS = ['排行', '拾光录', '成就'];

    function rankList(rows, unit) {
      if (!rows || !rows.length) return emptyBox('还没有人留下痕迹');
      var list = el('div', 'sg-rank-list');
      for (var i = 0; i < rows.length; i++) {
        var row = el('div', 'sg-rank-row' + (i < 3 ? ' is-top' : ''));
        row.appendChild(el('span', 'sg-rank-no', String(i + 1)));
        row.appendChild(el('span', 'sg-rank-name', rows[i].name));
        var v = el('span', 'sg-rank-val', String(rows[i].value));
        v.appendChild(el('i', 'sg-ov-unit', unit));
        row.appendChild(v);
        list.appendChild(row);
      }
      return list;
    }

    function renderBookRank(body) {
      clearNode(body);
      body.appendChild(loadingInline());
      http('get', '/shiguang/rank').then(function(data) {
        if (sheetKind !== 'book') return;
        clearNode(body);
        if (!data) { body.appendChild(emptyBox('风太大，榜单没翻到。')); return; }

        var overview = el('div', 'sg-overview');
        function ov(label, value, unit) {
          var box = el('div', 'sg-ov');
          var val = el('div', 'sg-ov-val', String(value));
          if (unit) val.appendChild(el('i', 'sg-ov-unit', unit));
          box.appendChild(val);
          box.appendChild(el('div', 'sg-ov-label', label));
          return box;
        }
        overview.appendChild(ov('灯柱', data.lampCount, '座'));
        overview.appendChild(ov('已照亮', data.exploredCount, '格'));
        overview.appendChild(ov('光花', data.flowerCount, '株'));
        overview.appendChild(ov('在线', data.onlineCount, '人'));
        overview.appendChild(ov('漂流瓶', data.bottleCount, '只'));
        body.appendChild(overview);

        var stageBox = el('div', 'sg-stage-note');
        stageBox.appendChild(el('b', null, (data.stageInfo && data.stageInfo.name) || '长夜'));
        stageBox.appendChild(el('span', null, '　' + ((data.stageInfo && data.stageInfo.desc) || '')));
        body.appendChild(stageBox);

        body.appendChild(sectionTitle('拾光榜 · 累计采集'));
        body.appendChild(rankList(data.gathered, '枚'));
        body.appendChild(sectionTitle('点灯榜 · 亲手点亮'));
        body.appendChild(rankList(data.builders, '座'));
        body.appendChild(sectionTitle('探路榜 · 揭开迷雾'));
        body.appendChild(rankList(data.explorers, '格'));
        body.appendChild(sectionTitle('钓星榜 · 云海渔获'));
        body.appendChild(rankList(data.fishers, '条'));
      }).catch(function() {
        clearNode(body);
        body.appendChild(emptyBox('风太大，榜单没翻到。稍后再试。'));
      });
    }

    function fishGlyph(rarity, caught) {
      var wrap = el('span', 'sg-cf-ico' + (caught ? '' : ' is-unknown'));
      wrap.appendChild(svgIcon('fish'));
      if (caught) {
        var tones = ['rgb(150, 226, 255)', 'rgb(126, 190, 255)', 'rgb(186, 150, 255)', 'rgb(255, 198, 120)'];
        wrap.style.color = tones[clamp(rarity, 0, 3)];
      }
      return wrap;
    }

    function renderBookCollection(body) {
      clearNode(body);
      body.appendChild(loadingInline());
      http('get', '/shiguang/collection').then(function(data) {
        if (sheetKind !== 'book') return;
        clearNode(body);
        if (!data) { body.appendChild(emptyBox('海面起了雾。')); return; }
        body.appendChild(el('div', 'sg-cf-head', '收录 ' + data.kinds + ' / ' + data.total + ' 种星鱼 —— 每座岛的码头都有自己的特产'));
        var list = el('div', 'sg-cf-list');
        var rows = data.list || [];
        for (var i = 0; i < rows.length; i++) {
          var f = rows[i];
          var row = el('div', 'sg-cf-row' + (f.count ? ' is-caught' : '') + (f.rarity === 3 ? ' is-legend' : ''));
          row.appendChild(fishGlyph(f.rarity, !!f.count));
          var mid = el('div', 'sg-cf-mid');
          mid.appendChild(el('div', 'sg-cf-name', f.count ? f.name : '？？？'));
          var chip = el('span', 'sg-chip ' + RARITY_TONES[f.rarity], RARITY_NAMES[f.rarity]);
          mid.appendChild(chip);
          if (f.count) mid.appendChild(el('div', 'sg-cf-note', f.note || ''));
          row.appendChild(mid);
          var right = el('div', 'sg-cf-right');
          if (f.count) {
            right.appendChild(el('div', 'sg-cf-count', '×' + f.count));
            right.appendChild(el('div', 'sg-cf-shards', '+' + f.shards + ' 星屑/条'));
          }
          row.appendChild(right);
          list.appendChild(row);
        }
        body.appendChild(list);
      }).catch(function() {
        clearNode(body);
        body.appendChild(emptyBox('海面起了雾，读不到图鉴。'));
      });
    }

    function renderBookAchv(body) {
      clearNode(body);
      body.appendChild(loadingInline());
      http('get', '/shiguang/achievements').then(function(data) {
        if (sheetKind !== 'book') return;
        clearNode(body);
        if (!data) { body.appendChild(emptyBox('徽章匣打不开。')); return; }
        state.achCount = data.count || 0;
        body.appendChild(el('div', 'sg-cf-head', '已解锁 ' + data.count + ' / ' + data.total + ' 枚徽章'));
        var list = el('div', 'sg-cf-list');
        var rows = data.list || [];
        for (var i = 0; i < rows.length; i++) {
          var a = rows[i];
          var row = el('div', 'sg-cf-row sg-ach-row' + (a.at ? ' is-caught' : ''));
          var ico = el('span', 'sg-cf-ico' + (a.at ? '' : ' is-unknown'));
          ico.appendChild(svgIcon('trophy'));
          row.appendChild(ico);
          var mid = el('div', 'sg-cf-mid');
          mid.appendChild(el('div', 'sg-cf-name', a.title));
          mid.appendChild(el('div', 'sg-cf-note', a.desc));
          row.appendChild(mid);
          var right = el('div', 'sg-cf-right');
          if (a.at) right.appendChild(el('div', 'sg-cf-count', formatDate(a.at)));
          row.appendChild(right);
          list.appendChild(row);
        }
        body.appendChild(list);
      }).catch(function() {
        clearNode(body);
        body.appendChild(emptyBox('徽章匣打不开，稍后再试。'));
      });
    }

    function formatDate(ts) {
      var d = new Date(ts);
      return (d.getMonth() + 1) + '月' + d.getDate() + '日';
    }

    function renderBook(body, tabIdx) {
      clearNode(body);
      body.appendChild(segmented(BOOK_TABS, tabIdx || 0, function(idx) {
        renderBook(body, idx);
      }));
      if (tabIdx === 1) renderBookCollection(body);
      else if (tabIdx === 2) renderBookAchv(body);
      else renderBookRank(body);
    }

    function openBook() {
      openSheet('book', '群岛志');
      renderBook(sheetBody, 0);
    }

    // ---------- v4.7 背包面板：果实 / 材料，可卖出可送人 ----------
    function bagNameOf(key) {
      if (key === 'wood') return '云杉木';
      if (key === 'ore') return '星岩矿';
      var idx = /^c(\d+)$/.exec(key);
      if (idx && CROPS[Number(idx[1])]) return CROPS[Number(idx[1])].name;
      return key;
    }
    function bagPriceOf(key) {
      if (key === 'wood') return 6;
      if (key === 'ore') return 9;
      var idx = /^c(\d+)$/.exec(key);
      if (idx && CROPS[Number(idx[1])]) return CROPS[Number(idx[1])].yield;
      return 0;
    }

    function openBag() {
      openSheet('bag', '背包');
      renderBag(sheetBody);
    }

    function renderBag(body) {
      clearNode(body);
      var keys = Object.keys(state.bag || {});
      if (!keys.length) {
        body.appendChild(emptyBox('背包空空的。收成、砍树、挖矿的东西都会放在这里。'));
        return;
      }
      body.appendChild(el('div', 'sg-tip', '果实和材料可以卖给钱庄换成星屑，也可以走到同学身边送出去。'));
      for (var i = 0; i < keys.length; i++) {
        (function(key) {
          var cnt = state.bag[key] || 0;
          if (cnt <= 0) return;
          var row = el('div', 'sg-qcard');
          row.style.marginBottom = '10px';
          var head = el('div', 'sg-bottle-head');
          head.appendChild(el('span', 'sg-bottle-name', bagNameOf(key) + ' × ' + cnt));
          head.appendChild(el('span', 'sg-bottle-pos', '每个卖 ' + bagPriceOf(key) + ' 星屑'));
          row.appendChild(head);
          var sell = el('button', 'sg-set-action');
          sell.type = 'button';
          sell.appendChild(svgIcon('shard'));
          sell.appendChild(el('span', null, '全部卖给钱庄（+' + (bagPriceOf(key) * cnt) + ' 星屑）'));
          sell.addEventListener('click', function() {
            http('post', '/shiguang/market/sell', { crop: key, count: cnt }).then(function(d) {
              if (d && d.rejected) { toast('卖不掉'); return; }
              state.me.shards = d.shards;
              state.bag = d.bag || state.bag;
              sfx.award();
              toast('卖掉了　+' + d.gain + ' 星屑', 'warm');
              updateHud();
              renderBag(body);
            }).catch(function() { toast('卖出失败'); });
          });
          row.appendChild(sell);
          body.appendChild(row);
        })(keys[i]);
      }
    }

    // 同学菜单里选果实送人（key + 数量）
    function renderBagGift(body, toId, toName) {
      var keys = [];
      for (var k in (state.bag || {})) {
        if (Object.prototype.hasOwnProperty.call(state.bag, k) && state.bag[k] > 0) keys.push(k);
      }
      if (!keys.length) {
        body.appendChild(el('div', 'sg-tip', '你的背包是空的 —— 收成或采集之后就能送 TA 东西。'));
        return;
      }
      for (var i = 0; i < keys.length; i++) {
        (function(key) {
          var cnt = state.bag[key];
          var b = el('button', 'sg-set-action');
          b.type = 'button';
          b.appendChild(svgIcon('flower'));
          b.appendChild(el('span', null, '送 ' + bagNameOf(key) + ' × ' + cnt + ' 给 ' + toName));
          b.addEventListener('click', function() {
            http('post', '/shiguang/bag/gift', { to: toId, crop: key, count: cnt }).then(function(d) {
              if (d && d.rejected) {
                if (d.rejected === 'far') toast('走近一点再送（6 格内）');
                else if (d.rejected === 'not_enough') toast('背包里不够了');
                else toast('没送出去');
                return;
              }
              state.bag = d.bag || state.bag;
              sfx.award();
              toast('把 ' + bagNameOf(key) + ' × ' + cnt + ' 送给了 ' + toName, 'warm');
              closeSheet();
            }).catch(function() { toast('赠送失败'); });
          });
          body.appendChild(b);
        })(keys[i]);
      }
    }

    // ---------- v4.8 相遇簿数据 ----------
    function refreshMeets() {
      http('get', '/shiguang/meets').then(function(d) {
        if (d && !d.rejected) state.meets = d.meets || [];
      }).catch(function() {});
    }

    // ---------- v4.14 《先行者的信》 ----------
    // 十封信散落八岛。走近信点（2 格内）出现「拾起」提示，按 F 或点击拾起；
    // 演出是一封信在屏幕上展开。收集齐十封，长夜之前的故事就拼完了。
    var LETTER_IDS = ['L1', 'L2', 'L3', 'L4', 'L5', 'L6', 'L7', 'L8', 'L9', 'L10'];
    var LETTER_POS = { L1: [121, 121], L2: [117, 135], L3: [51, 48], L4: [195, 183], L5: [186, 45],
                       L6: [75, 60], L7: [117, 21], L8: [168, 102], L9: [87, 198], L10: [120, 136] };
    var LETTER_ISLES = { L1: '启明岛', L2: '启明岛', L3: '雾隐岛', L4: '望潮岛', L5: '星坠岛',
                         L6: '云桥·西北', L7: '霜屿', L8: '织花谷', L9: '萤火泽', L10: '启明岛·南岸' };

    function letterById(lid) {
      for (var i = 0; i < state.letters.length; i++) {
        if (state.letters[i].id === lid) return state.letters[i];
      }
      return null;
    }

    function letterNearMe() {
      // 脚边有没有未拾的信（世界数据在客户端按 LETTER_POS 本地判定）
      for (var i = 0; i < LETTER_IDS.length; i++) {
        var lid = LETTER_IDS[i];
        var rec = letterById(lid);
        if (rec && rec.found) continue;
        var pos = LETTER_POS[lid];
        if (!pos) continue;
        if (Math.abs(state.me.x - pos[0]) <= 1 && Math.abs(state.me.y - pos[1]) <= 1) {
          return { id: lid, title: '一封信（' + (LETTER_ISLES[lid] || '') + '）' };
        }
      }
      return null;
    }

    function refreshLetters() {
      http('get', '/shiguang/letters').then(function(d) {
        if (d && !d.rejected) state.letters = d.letters || [];
      }).catch(function() {});
    }

    function pickLetter(lid) {
      http('post', '/shiguang/letters/find', { id: lid }).then(function(d) {
        if (!d) return;
        if (d.rejected) {
          if (d.rejected === 'far') toast('再走近一点才能拾起来');
          else if (d.rejected === 'already') toast('这封信你已经收好了');
          else toast('这里没有信');
          return;
        }
        refreshLetters();
        // 拾信演出：信纸展开（复用章节卡骨架，加信纸底色）
        var card = el('div', 'sg-chapter sg-letter');
        card.appendChild(el('div', 'sg-chapter-eyebrow', '拾到一封信 · ' + (d.title || '')));
        var paras = d.paras || [];
        for (var pi = 0; pi < paras.length; pi++) {
          card.appendChild(el('div', 'sg-story-para', paras[pi]));
        }
        card.appendChild(el('div', 'sg-cf-note', '收录进度：' + (d.foundCount || 1) + ' / ' + (d.total || 10) + ' 封 —— 拾光志可随时重读'));
        root.appendChild(card);
        requestAnimationFrame(function() { card.className = 'sg-chapter sg-letter is-show'; });
        sfx.dawn();
        setTimeout(function() {
          card.className = 'sg-chapter sg-letter';
          setTimeout(function() {
            if (card.parentNode) card.parentNode.removeChild(card);
          }, 900);
        }, 5200);
        updateHud();
      }).catch(function() { toast('拾信失败'); });
    }

    // 信点渲染：未拾的信画「发光信封」，已拾的画淡痕
    function drawLetters(ox, oy, t, now) {
      for (var i = 0; i < LETTER_IDS.length; i++) {
        var lid = LETTER_IDS[i];
        var pos = LETTER_POS[lid];
        if (!pos) continue;
        var rec = letterById(lid);
        var sx = ox + (pos[0] + 0.5) * t;
        var sy = oy + (pos[1] + 0.5) * t;
        if (sx < -t || sx > view.w + t || sy < -t || sy > view.h + t) continue;
        if (rec && rec.found) {
          // 已拾：淡淡的书页痕
          ctx.strokeStyle = 'rgba(214, 228, 255, 0.16)';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.arc(sx, sy, t * 0.14, 0, 6.2832);
          ctx.stroke();
          continue;
        }
        // 未拾：信封呼吸光 + 轻微上下浮动
        var pk = 0.5 + 0.5 * Math.sin(now * 0.003 + i * 1.9);
        var bob = Math.sin(now * 0.0016 + i) * t * 0.05;
        var cx2 = sx;
        var cy2 = sy - t * 0.12 + bob;
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        var lg = ctx.createRadialGradient(cx2, cy2, 0, cx2, cy2, t * 0.8);
        lg.addColorStop(0, 'rgba(255, 236, 190, ' + (0.22 + 0.16 * pk).toFixed(3) + ')');
        lg.addColorStop(1, 'rgba(255, 236, 190, 0)');
        ctx.fillStyle = lg;
        ctx.beginPath();
        ctx.arc(cx2, cy2, t * 0.8, 0, 6.2832);
        ctx.fill();
        ctx.restore();
        // 信封形
        var ew = t * 0.34;
        var eh = t * 0.22;
        ctx.fillStyle = 'rgba(244, 234, 208, 0.94)';
        ctx.strokeStyle = 'rgba(120, 90, 50, 0.9)';
        ctx.lineWidth = Math.max(1, t * 0.025);
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(cx2 - ew / 2, cy2 - eh / 2, ew, eh, t * 0.03);
        else ctx.rect(cx2 - ew / 2, cy2 - eh / 2, ew, eh);
        ctx.fill();
        ctx.stroke();
        // 封口折线
        ctx.beginPath();
        ctx.moveTo(cx2 - ew / 2, cy2 - eh / 2);
        ctx.lineTo(cx2, cy2 + eh * 0.12);
        ctx.lineTo(cx2 + ew / 2, cy2 - eh / 2);
        ctx.stroke();
      }
    }

    // ---------- v4.7 剧情《灯火纪》 ----------
    function refreshStory() {
      http('get', '/shiguang/story').then(function(d) {
        if (d && !d.rejected) {
          state.storyChapters = (d.chapters || []);
          if (d.season) state.season = d.season;
          var se = document.querySelector('.sg-clock-season');
          if (se) se.textContent = state.season || '春';
          // 拾光志面板开着时，章节到了要补渲染（异步回填）
          if (sheetKind === 'story' && sheetBody) renderStory(sheetBody);
        }
      }).catch(function() {});
    }

    function renderStory(body) {
      clearNode(body);
      // v4.10 当前目标：这本志也告诉你下一步
      if (state.goal) {
        var goalCard = el('div', 'sg-qcard');
        goalCard.style.marginBottom = '12px';
        goalCard.appendChild(el('div', 'sg-bottle-head',
          [el('span', 'sg-bottle-name', '当前目标'),
           el('span', 'sg-bottle-pos', '跟着小地图的金圈走')]));
        goalCard.appendChild(el('div', 'sg-story-para', state.goal.title));
        body.appendChild(goalCard);
      }
      // v4.8 相遇簿：这本志的第一页，永远写给「你遇见过的人」
      var meets = state.meets || [];
      var meetCard = el('div', 'sg-qcard');
      meetCard.style.marginBottom = '12px';
      var meetHead = el('div', 'sg-bottle-head');
      meetHead.appendChild(el('span', 'sg-bottle-name', '相遇簿'));
      meetHead.appendChild(el('span', 'sg-bottle-pos', meets.length ? '遇见过 ' + meets.length + ' 位同学' : '还没有遇见谁'));
      meetCard.appendChild(meetHead);
      for (var mi = 0; mi < meets.length; mi++) {
        var mrow = el('div', 'sg-sum-row');
        mrow.appendChild(el('b', 'sg-sum-key', (meets[mi].name || '同学')));
        mrow.appendChild(el('span', 'sg-sum-val',
          '相遇 ' + meets[mi].count + ' 次　最近 ' + new Date(meets[mi].last_at).getMonth() + 1 + '/' + new Date(meets[mi].last_at).getDate()));
        meetCard.appendChild(mrow);
      }
      if (!meets.length) meetCard.appendChild(el('div', 'sg-cf-note', '在岛上遇见一位同学，这本簿子就会多一行字。'));
      body.appendChild(meetCard);

      // v4.14 《先行者的信》收录
      var letters = state.letters || [];
      var foundCount = 0;
      for (var li2 = 0; li2 < letters.length; li2++) if (letters[li2].found) foundCount++;
      var letCard = el('div', 'sg-qcard');
      letCard.style.marginBottom = '12px';
      var letHead = el('div', 'sg-bottle-head');
      letHead.appendChild(el('span', 'sg-bottle-name', '《先行者的信》'));
      letHead.appendChild(el('span', 'sg-bottle-pos', '收集 ' + foundCount + ' / ' + letters.length + ' 封'));
      letCard.appendChild(letHead);
      for (var li3 = 0; li3 < letters.length; li3++) {
        var L3r = letters[li3];
        var L3row = el('div', 'sg-sum-row');
        L3row.appendChild(el('b', 'sg-sum-key', L3r.found ? L3r.title : '？？？'));
        L3row.appendChild(el('span', 'sg-sum-val', L3r.found ? (L3r.isle || '') : '藏于' + (L3r.isle || '某座岛')));
        letCard.appendChild(L3row);
        if (L3r.found && L3r.paras) {
          for (var lp = 0; lp < L3r.paras.length; lp++) {
            letCard.appendChild(el('div', 'sg-story-para', L3r.paras[lp]));
          }
        }
      }
      if (letters.length && foundCount < letters.length) {
        letCard.appendChild(el('div', 'sg-tip', '信散落在八岛的角落 —— 走到信封的位置就能拾起。'));
      }
      body.appendChild(letCard);

      var chs = state.storyChapters || [];
      if (!chs.length) {
        body.appendChild(emptyBox('故事还在加载……'));
        return;
      }
      body.appendChild(el('div', 'sg-tip', '《灯火纪》—— 这本志跟着全班一起写。章节由世界自己翻开：灯、田、碑、鱼、暗涌、天光。'));
      for (var i = 0; i < chs.length; i++) {
        (function(ch) {
          var card = el('div', 'sg-qcard');
          card.style.marginBottom = '10px';
          var head = el('div', 'sg-bottle-head');
          head.appendChild(el('span', 'sg-bottle-name', ch.unlocked ? ch.title : '？？？'));
          head.appendChild(el('span', 'sg-bottle-pos', ch.read ? '已读' : (ch.unlocked ? '新章' : '未解锁')));
          card.appendChild(head);
          if (!ch.unlocked) {
            card.appendChild(el('div', 'sg-cf-note', '解锁条件：' + ch.hint));
          } else {
            var paras = ch.paras || [];
            for (var pi = 0; pi < paras.length; pi++) {
              card.appendChild(el('div', 'sg-story-para', paras[pi]));
            }
            if (!ch.read) {
              var markBtn = el('button', 'sg-set-action');
              markBtn.type = 'button';
              markBtn.appendChild(svgIcon('book'));
              markBtn.appendChild(el('span', null, '记下这一章'));
              markBtn.addEventListener('click', function() {
                http('post', '/shiguang/story/read', { chapter: ch.id }).then(function() {
                  toast('记下了　「' + ch.title + '」', 'warm');
                  refreshStory();
                }).catch(function() {});
              });
              card.appendChild(markBtn);
            }
          }
          body.appendChild(card);
        })(chs[i]);
      }
    }

    // ---------- 同学菜单（跟随 / 送火） ----------
    function renderPlayerMenu(body, p) {
      clearNode(body);
      var head = el('div', 'sg-pm-head');
      // v4.10 名字已在抽屉标题里 —— 这里只放称号与位置，不再重复名字
      var hasTitle = p.title && p.title !== 't_pick';
      var tn = hasTitle ? shopNameOf('title', p.title) : '';
      if (tn) head.appendChild(el('div', 'sg-pm-role', '「' + tn + '」'));
      var man = Math.abs(p.x - state.me.x) + Math.abs(p.y - state.me.y);
      head.appendChild(el('div', 'sg-cf-note', man + ' 格之外 · (' + p.x + ', ' + p.y + ')'));
      body.appendChild(head);

      var followBtn = el('button', 'sg-set-action');
      followBtn.type = 'button';
      followBtn.appendChild(svgIcon('pin'));
      followBtn.appendChild(el('span', null, '跟随 TA —— 自动沿路跟在身边'));
      followBtn.addEventListener('click', function() {
        closeSheet();
        startFollow(p.id);
      });
      body.appendChild(followBtn);

      var giveBtn = el('button', 'sg-set-action');
      giveBtn.type = 'button';
      giveBtn.appendChild(svgIcon('shard'));
      giveBtn.appendChild(el('span', null, '送一枚星屑（1 星屑，6 格内）'));
      giveBtn.addEventListener('click', function() {
        http('post', '/shiguang/give', { to: p.id }).then(function(data) {
          if (data && data.rejected) {
            if (data.rejected === 'shards') toast('星屑不够');
            else if (data.rejected === 'far') toast('走近一点再送');
            else if (data.rejected === 'offline') toast('TA 已经不在岛上了');
            else toast('送不出去');
            return;
          }
          state.me.shards = data.shards;
          sfx.award();
          toast('送了一枚星屑给 ' + p.name, 'warm');
          closeSheet();
          updateHud();
        }).catch(function(err) {
          toast((err && err.message) || '没能送出去');
        });
      });
      body.appendChild(giveBtn);

      // v4.7 以物易物：把背包里的果实/材料直接送给 TA
      var bagBtn = el('button', 'sg-set-action');
      bagBtn.type = 'button';
      bagBtn.appendChild(svgIcon('bottle'));
      bagBtn.appendChild(el('span', null, '送 TA 一样背包里的东西'));
      bagBtn.addEventListener('click', function() {
        clearNode(body);
        var back = el('button', 'sg-set-action');
        back.type = 'button';
        back.appendChild(svgIcon('close'));
        back.appendChild(el('span', null, '← 返回'));
        back.addEventListener('click', function() { renderPlayerMenu(body, p); });
        body.appendChild(back);
        renderBagGift(body, p.id, p.name);
      });
      body.appendChild(bagBtn);

      // v4.6 与别人交易：赠送学元（平台学元体系，GRANT 通道免密、单次 ≤2、每日 ≤10）
      var xyRow = el('div', 'sg-pm-xy');
      xyRow.appendChild(el('div', 'sg-cf-note', '赠学元（面对面 · 每日限 10 学元）：'));
      [1, 2].forEach(function(amt) {
        var b = el('button', 'sg-set-action');
        b.type = 'button';
        b.appendChild(svgIcon('star'));
        b.appendChild(el('span', null, '赠 ' + amt + ' 学元（面对面 · 今日限 10）'));
        b.addEventListener('click', function() {
          http('post', '/shiguang/gift_xy', { to: p.id, amount: amt }).then(function(d) {
            if (d && d.rejected) {
              if (d.rejected === 'far') toast('走近一点再送（6 格内）');
              else if (d.rejected === 'offline') toast('TA 已经不在岛上了');
              else if (d.rejected === 'daily') toast('今天的赠礼额度用完了　明天再来');
              else if (d.rejected === 'ledger') toast((d.message || '赠送失败'));
              else toast('送不出去');
              return;
            }
            state.xyGrant = d.grant;
            sfx.award();
            toast('送出 ' + amt + ' 学元给 ' + p.name, 'warm');
            var elx = document.querySelector('.sg-clock-xy');
            if (elx) elx.textContent = (state.xyGrant).toFixed(2) + ' 学元';
            closeSheet();
          }).catch(function(err) {
            toast((err && err.message) || '赠送失败');
          });
        });
        xyRow.appendChild(b);
      });
      body.appendChild(xyRow);

      body.appendChild(el('div', 'sg-tip', '跟随会被任何移动打断；送出的星屑会化作 TA 身边的一圈金光；学元直接落进 TA 的学元钱包。'));
    }

    // ---------- 漂流瓶 ----------
    function openBottles() {
      openSheet('bottles', '漂流瓶');
      clearNode(sheetBody);
      var listBox = el('div', 'sg-bottle-list');
      listBox.appendChild(loadingInline('正在听海…'));
      sheetBody.appendChild(listBox);

      var form = el('div', 'sg-bottle-form');
      var input = el('input', 'sg-bottle-input');
      input.type = 'text';
      input.maxLength = 80;
      input.placeholder = '给后来经过这里的人留句话…';
      var send = el('button', 'sg-bottle-send', '放下');
      send.type = 'button';
      form.appendChild(input);
      form.appendChild(send);
      sheetBody.appendChild(form);
      sheetBody.appendChild(el('div', 'sg-tip', '瓶子会留在此处，任何走到附近的人都能读到。每人 4 分钟可放一只。'));

      function load() {
        http('get', '/shiguang/bottles?x=' + state.me.x + '&y=' + state.me.y + '&r=5').then(function(data) {
          clearNode(listBox);
          var bottles = (data && data.bottles) || [];
          if (!bottles.length) {
            listBox.appendChild(emptyBox('附近还没有瓶子。你可以放第一只。'));
            return;
          }
          for (var i = 0; i < bottles.length; i++) {
            var b = bottles[i];
            var item = el('div', 'sg-bottle');
            var head = el('div', 'sg-bottle-head');
            head.appendChild(el('span', 'sg-bottle-name', b.name));
            head.appendChild(el('span', 'sg-bottle-pos', '(' + b.x + ', ' + b.y + ')'));
            item.appendChild(head);
            item.appendChild(el('div', 'sg-bottle-text', b.content));
            listBox.appendChild(item);
          }
        }).catch(function() {
          clearNode(listBox);
          listBox.appendChild(emptyBox('海面起了雾，读不到瓶子。'));
        });
      }
      load();

      function put() {
        var text = String(input.value || '').trim();
        if (!text) return;
        send.disabled = true;
        cooldowns.bottle = Date.now();
        http('post', '/shiguang/bottles', { content: text }).then(function() {
          input.value = '';
          send.disabled = false;
          toast('瓶子已经放进海里', 'warm');
          sfx.plant();
          load();
        }).catch(function(err) {
          send.disabled = false;
          toast((err && err.message) || '没能放下瓶子');
        });
      }

      send.addEventListener('click', put);
      input.addEventListener('keydown', function(e) {
        if (e.keyCode === 13) put();
      });
    }

    // ---------- 帮助 ----------
    function openHelp() {
      openSheet('help', '怎么玩');
      clearNode(sheetBody);
      var steps = [
        ['走', '左下摇杆漫步（键盘 WASD 也行）；点地面任意一格，小人会自动沿路走过去。'],
        ['捡', '闪烁的菱形是星屑。站上去按「采集」，90 秒后原地重生。'],
        ['点', '攒够 3 枚星屑原地「点灯」。灯柱是「你的颜色」，全班永久可见。'],
        ['花', '草地和路边可「种花」（2 星屑）。花会破土、含苞、盛开，永远开在那里。'],
        ['钓', '码头上「钓星」。每座岛的码头有自己的特产鱼，传说级全岛播报。'],
        ['飞', '码头边按「快线」搭纸鸢跨岛（2 星屑），落地自动点亮周围。'],
        ['碑', '八岛间藏着五座石碑。走近按「触碑」唤醒（+5 星屑），集齐五座全班解锁秘境。'],
        ['雨', '流星雨不定时落在某座岛上，星陨比星屑更值得抢。'],
        ['伴', '岛上有居民（提灯守夜的人）。走近他们会跟你搭话。'],
        ['同', '点同学打开菜单：可以跟随 TA，或送一枚星屑。屏幕边缘的光点指向看不见的同学。'],
        ['界', '云海有尽头：走到世界边缘能看到四座界标灯桩 —— 那是群岛的边界。'],
        ['田', '草地按「种花」选种下地（12 种，越慢熟的越值钱）；站在苗上同一个键就是浇水。'],
        ['农', '一天 6 分钟，一天浇一瓢水，隔夜长一节，浇了才长；熟了按「采集」收星屑。浇水要 2 点火。']
      ];
      for (var i = 0; i < steps.length; i++) {
        var row = el('div', 'sg-help-row');
        row.appendChild(el('span', 'sg-help-key', steps[i][0]));
        row.appendChild(el('span', 'sg-help-text', steps[i][1]));
        sheetBody.appendChild(row);
      }
      sheetBody.appendChild(el('div', 'sg-tip', '迷雾是全班共享的：别人走过、点亮的地方，你进入时就是亮的。'));
    }

    // ---------- 设置 ----------
    var settingsSoundSw = null;
    function updateSettingsUi() {
      if (settingsSoundSw) settingsSoundSw.className = 'sg-switch' + (prefs.sound ? ' is-on' : '');
    }

    function openSettings() {
      openSheet('settings', '设置');
      clearNode(sheetBody);

      var soundToggle = toggleSwitch('环境音与音效', prefs.sound, function() {
        setSound(!prefs.sound);
        if (prefs.sound) toast('声音开了', 'warm');
      });
      settingsSoundSw = soundToggle.sw;
      sheetBody.appendChild(soundToggle.row);

      sheetBody.appendChild(sectionTitle('画质'));
      sheetBody.appendChild(segmented(['标准', '高清（重建底图）'], prefs.hq ? 1 : 0, function(idx) {
        prefs.hq = idx === 1;
        try { storage.set('hq', prefs.hq ? '1' : '0'); } catch (e) {}
        buildField();
        toast(prefs.hq ? '底图高清已开启' : '底图标准已开启');
      }));

      sheetBody.appendChild(sectionTitle('更多'));
      var pcRow = el('button', 'sg-set-action');
      pcRow.type = 'button';
      pcRow.appendChild(svgIcon('postcard'));
      pcRow.appendChild(el('span', null, '拾光明信片 —— 把眼前这一幕做成一张卡'));
      pcRow.addEventListener('click', function() {
        closeSheet();
        setTimeout(openPostcard, 260);
      });
      sheetBody.appendChild(pcRow);

      var tRow = el('button', 'sg-set-action');
      tRow.type = 'button';
      tRow.appendChild(svgIcon('refresh'));
      tRow.appendChild(el('span', null, '重看开场剧情「长夜之始」'));
      tRow.addEventListener('click', function() {
        closeSheet();
        setTimeout(tutorialStart, 260);
      });
      sheetBody.appendChild(tRow);

      sheetBody.appendChild(el('div', 'sg-tip', '拾光群岛 · 240×240 开放大世界（跨班同服） · 素材致谢 Kenney（CC0）· 世界状态由服务端权威保存'));
    }

    btnMap.addEventListener('click', openWorldMap);
    btnQuest.addEventListener('click', openQuests);
    btnBook.addEventListener('click', openBook);
    btnWardrobe.addEventListener('click', openWardrobe);
    btnSettings.addEventListener('click', openSettings);
    btnHelp.addEventListener('click', openHelp);
    btnBottle.addEventListener('click', openBottles);
    onDestroy(function() {
      btnMap.removeEventListener('click', openWorldMap);
      btnQuest.removeEventListener('click', openQuests);
      btnBook.removeEventListener('click', openBook);
      btnWardrobe.removeEventListener('click', openWardrobe);
      btnSettings.removeEventListener('click', openSettings);
      btnHelp.removeEventListener('click', openHelp);
      btnBottle.removeEventListener('click', openBottles);
    });

    // ---------- 拾光明信片 ----------

    var modalVisible = false;

    function closeModal() {
      modalVisible = false;
      clearInterval(wmapTimer);
      modal.className = 'sg-modal';
      setTimeout(function() {
        if (!modalVisible) modal.hidden = true;
        clearNode(modalCard);
      }, 220);
    }

    function openModal() {
      modalVisible = true;
      modal.hidden = false;
      modal.offsetWidth;
      modal.className = 'sg-modal is-open';
    }

    function onModalDimClick(e) {
      if (e.target === modal) closeModal();
    }
    modal.addEventListener('click', onModalDimClick);
    onDestroy(function() { modal.removeEventListener('click', onModalDimClick); });

    function composePostcard(caption) {
      var W = 960, H = 640;
      var cv = document.createElement('canvas');
      cv.width = W; cv.height = H;
      var c = cv.getContext('2d');
      c.fillStyle = '#f6f1e6';
      c.fillRect(0, 0, W, H);
      var pad = 26;
      var pw = W - pad * 2;
      var ph = H - pad * 2 - 88;
      var sw = canvas.width, sh = canvas.height;
      var scale = Math.max(pw / sw, ph / sh);
      var cw = pw / scale, ch = ph / scale;
      var sx = (sw - cw) / 2, sy = (sh - ch) / 2;
      c.save();
      c.beginPath();
      c.rect(pad, pad, pw, ph);
      c.clip();
      c.imageSmoothingEnabled = true;
      try { c.drawImage(canvas, sx, sy, cw, ch, pad, pad, pw, ph); } catch (e) {}
      c.restore();
      c.strokeStyle = 'rgba(60, 48, 34, 0.18)';
      c.lineWidth = 2;
      c.strokeRect(pad + 1, pad + 1, pw - 2, ph - 2);

      var by = H - 88 + 22;
      c.fillStyle = '#3a2f22';
      c.font = '700 26px system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif';
      c.textAlign = 'left';
      c.textBaseline = 'alphabetic';
      c.fillText('拾光群岛', pad + 4, by + 26);
      c.font = '400 15px system-ui, -apple-system, "PingFang SC", sans-serif';
      c.fillStyle = 'rgba(58, 47, 34, 0.62)';
      var d = new Date();
      c.fillText(d.getFullYear() + ' / ' + (d.getMonth() + 1) + ' / ' + d.getDate() + ' · ' + (islandNameHere() || '云桥之上'), pad + 4, by + 52);

      var stamp = islandStamp();
      c.save();
      c.translate(W - 132, by + 30);
      c.strokeStyle = 'rgba(150, 96, 66, 0.72)';
      c.lineWidth = 2.5;
      c.setLineDash([7, 5]);
      c.beginPath();
      c.arc(0, 0, 46, 0, 6.2832);
      c.stroke();
      c.setLineDash([]);
      c.fillStyle = 'rgba(150, 96, 66, 0.86)';
      c.font = '700 17px system-ui, -apple-system, "PingFang SC", sans-serif';
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillText(stamp, 0, 0);
      c.restore();

      var cap = String(caption || '').trim();
      if (cap) {
        c.fillStyle = 'rgba(58, 47, 34, 0.85)';
        c.font = 'italic 500 17px system-ui, -apple-system, "PingFang SC", sans-serif';
        c.textAlign = 'right';
        var show = cap.length > 22 ? cap.slice(0, 22) + '…' : cap;
        c.fillText('「' + show + '」', W - pad - 12, by + 52);
      }
      return cv.toDataURL('image/jpeg', 0.88);
    }

    function islandStamp() {
      return islandNameHere() || '云桥';
    }

    function openPostcard() {
      openModal();
      clearNode(modalCard);
      var head = el('div', 'sg-modal-head');
      head.appendChild(el('div', 'sg-modal-title', '拾光明信片'));
      var closeBtn = el('button', 'sg-sheet-close');
      closeBtn.type = 'button';
      closeBtn.setAttribute('aria-label', '关闭');
      closeBtn.appendChild(svgIcon('close'));
      closeBtn.addEventListener('click', closeModal);
      head.appendChild(closeBtn);
      modalCard.appendChild(head);

      var body = el('div', 'sg-modal-body');
      var imgWrap = el('div', 'sg-pc-preview');
      var img = el('img', 'sg-pc-img');
      imgWrap.appendChild(img);
      body.appendChild(imgWrap);
      var input = el('input', 'sg-pc-input');
      input.type = 'text';
      input.maxLength = 40;
      input.placeholder = '写一句话，印在明信片上…';
      body.appendChild(input);
      var actions = el('div', 'sg-modal-actions');
      var again = el('button', 'sg-pc-btn', '重新取景');
      again.type = 'button';
      var share = el('button', 'sg-pc-btn sg-pc-btn-primary', '分享给同学');
      share.type = 'button';
      actions.appendChild(again);
      actions.appendChild(share);
      body.appendChild(actions);
      body.appendChild(el('div', 'sg-tip', '长按图片可以保存到相册。'));
      modalCard.appendChild(body);

      var caption = '';
      function redraw() {
        try { img.src = composePostcard(caption); } catch (e) {}
      }
      redraw();
      var inputTimer = 0;
      input.addEventListener('input', function() {
        if (inputTimer) clearTimeout(inputTimer);
        inputTimer = setTimeout(function() {
          caption = String(input.value || '');
          redraw();
        }, 300);
      });
      again.addEventListener('click', redraw);
      share.addEventListener('click', function() {
        var text = (caption ? '「' + caption + '」—— ' : '') + '来自拾光群岛 · ' + islandStamp();
        var sys = context.system;
        if (sys && typeof sys.share === 'function') {
          try {
            sys.share({ title: '拾光群岛 · 明信片', text: text, url: location.href }).then(function(res) {
              if (res && res.channel && res.channel !== 'cancelled') toast('已分享', 'warm');
            }).catch(function() {});
          } catch (e) {}
        } else {
          if (sys && sys.clipboard && typeof sys.clipboard.write === 'function') {
            try { sys.clipboard.write(text); } catch (e) {}
          }
          toast('文案已复制，长按图片可保存');
        }
      });
      onDestroy(function() {
        closeBtn.removeEventListener('click', closeModal);
        again.removeEventListener('click', redraw);
      });
    }

    // ---------- 新手引导 ----------
    var tIdx = 0;
    var tutorialSent = false;

    function syncTutorial() {
      for (var i = 0; i < tSlides.length; i++) {
        tSlides[i].className = 'sg-t-slide' + (i === tIdx ? ' is-on' : '');
      }
      for (var d = 0; d < tDotEls.length; d++) {
        tDotEls[d].className = 'sg-t-dot' + (d === tIdx ? ' is-on' : '');
      }
      tNext.textContent = tIdx >= tSlides.length - 1 ? '开始拾光' : '下一步';
    }

    // ---------- v4.8 开场剧情演出：长夜之始 ----------
    // 取代分步引导。演出是一段沉进黑幕里的独白：世界为什么是长夜、
    // 你为什么在这里、以及「灯不是灯」—— 看完的人才算真的踏进群岛。
    // 每段 = { t: 独白, dim: 黑幕透明度, cam: [x, y] 镜头摇向 }。
    // 演出时黑幕会「打开」让世界显现，镜头飞到灯塔再摇回出生点 ——
    // 剧情不是贴在画面上的字，它发生在世界里。
    var INTRO_PARAS = [
      { t: '很多年前，群岛的夜不是这样的。', dim: 0.985, cam: [120, 120] },
      { t: '那时灯塔自己会亮，鲸群每夜绕岛一圈，石碑上的名字在夜里发着微光。', dim: 0.62, cam: [120, 120] },
      { t: '后来灯塔的光一年比一年弱。不是灯芯坏了——', dim: 0.82, cam: [120, 120] },
      { t: '是点亮它的人，走散了。', dim: 0.985, cam: [120, 120] },
      { t: '现在，云海吞掉了最后一点天光。', dim: 0.90, cam: [120, 132] },
      { t: '而你们，在这个清晨登上了群岛。', dim: 0.55, cam: [120, 133] },
      { t: '灯不是灯。是「有人在」的证据。', dim: 0.88, cam: [120, 133] }
    ];

    function introCinema(skippable) {
      if (cinemaPlaying) return;
      cinemaPlaying = true;
      var cinema = el('div', 'sg-cinema');
      var stars = el('div', 'sg-cinema-stars');
      for (var si = 0; si < 42; si++) {
        var st = el('i', 'sg-cinema-star');
        st.style.left = Math.round((si * 23.7) % 100) + '%';
        st.style.top = Math.round((si * 41.3) % 100) + '%';
        st.style.animationDelay = (si % 9) * 0.4 + 's';
        stars.appendChild(st);
      }
      cinema.appendChild(stars);
      var txt = el('div', 'sg-cinema-text');
      cinema.appendChild(txt);
      var skip = el('button', 'sg-cinema-skip', '跳过 ›');
      skip.type = 'button';
      cinema.appendChild(skip);
      root.appendChild(cinema);
      // 演出结束顺手播「第一章 · 第一盏灯」卡（如果它刚好解锁）
      setTimeout(function() { refreshStory(); }, 300);
      requestAnimationFrame(function() { cinema.className = 'sg-cinema is-show'; });

      var idx = 0;
      var timer = 0;
      function showNext() {
        if (idx >= INTRO_PARAS.length) { endCinema(); return; }
        var seg = INTRO_PARAS[idx];
        var line = el('p', 'sg-cinema-line', seg.t);
        txt.appendChild(line);
        requestAnimationFrame(function() { line.className = 'sg-cinema-line is-in'; });
        // v4.10 画面指令：黑幕透明度呼吸 + 镜头摇向叙事点
        cinemaDim = seg.dim;
        cinema.style.background = 'rgba(3, 6, 14, ' + seg.dim + ')';
        if (seg.cam) { cinemaCam.x = seg.cam[0]; cinemaCam.y = seg.cam[1]; }
        idx += 1;
        timer = setTimeout(showNext, idx === INTRO_PARAS.length ? 1600 : 2300);
      }
      function endCinema() {
        if (timer) clearTimeout(timer);
        cinema.className = 'sg-cinema';
        setTimeout(function() {
          if (cinema.parentNode) cinema.parentNode.removeChild(cinema);
          cinemaPlaying = false;
        }, 1200);
        if (!tutorialSent) {
          tutorialSent = true;
          http('post', '/shiguang/tutorial', {}).then(function() {
            state.me.tutorial = 1;
          }).catch(function() {});
        }
        setTimeout(function() {
          toast('你在南岸醒来。走到光点前，按「采集」—— 群岛的故事从一捧星屑开始', 'warm');
        }, 400);
      }
      skip.addEventListener('click', function() { endCinema(); });
      setTimeout(showNext, 900);
    }

    // ---------- v4.10 章节卡：解锁一章时全屏立起它的名字 ----------
    // 星露谷的章节卡是「你走进了一个新故事」的仪式感 —— 我们同款。
    function playChapterCard(title, subtitle) {
      var card = el('div', 'sg-chapter');
      card.appendChild(el('div', 'sg-chapter-eyebrow', subtitle || '拾光志 · 新章'));
      card.appendChild(el('div', 'sg-chapter-title', title));
      root.appendChild(card);
      requestAnimationFrame(function() { card.className = 'sg-chapter is-show'; });
      sfx.rune();
      setTimeout(function() {
        card.className = 'sg-chapter';
        setTimeout(function() {
          if (card.parentNode) card.parentNode.removeChild(card);
        }, 900);
      }, 3200);
    }

    var cinemaPlaying = false;
    var cinemaCam = null;      // 演出期间的镜头目标 { x, y }
    var cinemaDim = 0.985;

    function tutorialStart() {
      introCinema();
    }

    function tutorialFinish(skipped) {
      tutorial.className = 'sg-tutorial';
      setTimeout(function() { tutorial.hidden = true; }, 260);
      if (!tutorialSent) {
        tutorialSent = true;
        http('post', '/shiguang/tutorial', {}).then(function() {
          state.me.tutorial = 1;
        }).catch(function() {});
      }
      if (!skipped) {
        sfx.build();
        toast('天黑着，但灯会一盏一盏亮起来', 'warm');
      }
    }

    function onNextClick() {
      if (tIdx < tSlides.length - 1) {
        tIdx++;
        syncTutorial();
        sfx.tap();
      } else {
        tutorialFinish(false);
      }
    }
    function onSkipClick() { tutorialFinish(true); }
    tNext.addEventListener('click', onNextClick);
    tSkip.addEventListener('click', onSkipClick);
    onDestroy(function() {
      tNext.removeEventListener('click', onNextClick);
      tSkip.removeEventListener('click', onSkipClick);
    });

    // ---------- §11 同步 ----------

    function applyMeteor(payload) {
      if (payload && payload.active) {
        var isNew = !state.meteor || !state.meteor.active || state.meteor.startedAt !== payload.startedAt;
        state.meteor = {
          active: true,
          x: payload.x, y: payload.y,
          island: payload.island || '',
          endsAt: payload.endsAt || (Date.now() + 100000),
          startedAt: payload.startedAt || Date.now()
        };
        state.meteorNodes = {};
        var nodes = payload.nodes || [];
        for (var i = 0; i < nodes.length; i++) {
          state.meteorNodes[nodes[i][0] + ',' + nodes[i][1]] = true;
        }
        if (isNew) {
          showBanner('star', '流星雨 · ' + (payload.island || '群岛'), '星陨散落在岛上，比普通星屑更亮，快去捡', 'meteor', 6500);
          sfx.meteor();
          // 流星雨是「天降」：玩家第一时间不是读提示，是感觉到脚下一沉。
          // 震动按距离衰减 —— 远处的流星是闷响，只有近处才是砸下来。
          var md = Math.abs(payload.x - state.me.x) + Math.abs(payload.y - state.me.y);
          var near = Math.max(0, 1 - md / 26);
          camShake(2.2 + near * 7.5);
          camPunch(1.0 + near * 0.032, 460);
          updateHud();
        }
      } else if (state.meteor && state.meteor.active) {
        state.meteor = null;
        state.meteorNodes = {};
        toast('流星雨停了，岛又静了下来');
        updateHud();
      }
    }

    function bindRealtime() {
      if (!realtime || typeof realtime.subscribe !== 'function') return;

      var offDelta = realtime.subscribe('shiguang.world.delta', function(payload) {
        if (!payload) return;
        var now = Date.now();
        if (payload.joins) {
          for (var i = 0; i < payload.joins.length; i++) {
            var j = payload.joins[i];
            if (j.id === myId) continue;
            upsertPlayer(j.id, j.name, j.x, j.y, j.dir, now, j.hat, j.lantern, j.title);
          }
        }
        if (payload.leaves) {
          for (var k = 0; k < payload.leaves.length; k++) removePlayer(payload.leaves[k]);
        }
        if (payload.moves) {
          for (var m = 0; m < payload.moves.length; m++) {
            var rec = payload.moves[m];
            if (rec[0] === myId) continue;
            upsertPlayer(rec[0], null, rec[1], rec[2], rec[3], now, rec[4], rec[5], null);
          }
        }
        if (payload.speech) {
          for (var sp = 0; sp < payload.speech.length; sp++) {
            state.speechFx.push({ uid: payload.speech[sp][0], idx: payload.speech[sp][1], at: now });
          }
          if (state.speechFx.length > 12) state.speechFx.splice(0, state.speechFx.length - 12);
        }
        if (payload.lamps) {
          for (var l = 0; l < payload.lamps.length; l++) {
            var lampRec = payload.lamps[l];
            addLamp(lampRec[0], lampRec[1], lampRec[2], lampRec[3]);
          }
          state.lampCount = Object.keys(state.lamps).length;
        }
        if (payload.gathers) {
          for (var g = 0; g < payload.gathers.length; g++) {
            var gk = payload.gathers[g][0] + ',' + payload.gathers[g][1];
            state.gathered[gk] = now;
            if (state.meteorNodes[gk]) delete state.meteorNodes[gk];
          }
        }
        if (payload.plants) {
          for (var pl = 0; pl < payload.plants.length; pl++) {
            var pr = payload.plants[pl];
            // species < 0 是「这一株被收走了」——服务端删了行，客户端也得摘掉，
            // 否则收完还留在画面上，玩家会以为没收到。
            if (pr[2] < 0) { delete state.flowers[pr[0] + ',' + pr[1]]; continue; }
            addFlower(pr[0], pr[1], pr[2], now, pr[3]);
          }
        }
        if (payload.emotes) {
          for (var em = 0; em < payload.emotes.length; em++) {
            var er = payload.emotes[em];
            if (er[0] === myId) continue;
            state.emoteFx.push({ uid: er[0], id: er[1], x: er[2], y: er[3], at: now });
          }
          if (state.emoteFx.length > 16) state.emoteFx.splice(0, state.emoteFx.length - 16);
        }
        if (payload.reveals) revealCells(payload.reveals);
        updateHud();
      });

      var offReveal = realtime.subscribe('shiguang.world.reveal', function(payload) {
        if (payload && payload.cells) revealCells(payload.cells);
      });

      var offDawn = realtime.subscribe('shiguang.world.dawn', function(payload) {
        if (!payload) return;
        state.stage = payload.stage;
        state.stageInfo = payload.info;
        state.lampCount = payload.lampCount;
        announce('天光 · ' + ((payload.info && payload.info.name) || ''), (payload.info && payload.info.desc) || '');
        sfx.dawn();
        updateHud();
      });

      var offBottle = realtime.subscribe('shiguang.bottle.new', function(payload) {
        if (!payload) return;
        var d = Math.abs(payload.x - state.me.x) + Math.abs(payload.y - state.me.y);
        if (d <= 6) toast(payload.name + ' 在不远处放下了一只漂流瓶');
      });

      var offMeteor = realtime.subscribe('shiguang.world.meteor', function(payload) {
        applyMeteor(payload);
      });

      var offLegend = realtime.subscribe('shiguang.world.legend', function(payload) {
        if (!payload) return;
        showBanner('fish', payload.name + ' 钓起了传说 · ' + (payload.speciesName || '星光'),
          '云海里游着 10 种星鱼，最稀有的两种只在故事里出现过', 'legend', 5600);
        sfx.fishCatch(3);
      });

      var offStele = realtime.subscribe('shiguang.world.stele', function(payload) {
        if (!payload) return;
        state.steles[payload.x + ',' + payload.y] = { name: payload.name, rune: payload.rune, by: payload.by, at: Date.now() };
        var d = Math.abs(payload.x - state.me.x) + Math.abs(payload.y - state.me.y);
        if (d <= 12) showBanner('rune', payload.by + ' 唤醒了「' + payload.name + '」', payload.rune, '', 4600);
      });

      var offEnter = realtime.subscribe('shiguang.world.enter', function(payload) {
        if (!payload || payload.id === myId) return;
        showBanner('kite', payload.name + ' 来到了群岛', '灯柱的光会为 TA 引路 —— 点 TA 可以跟随或送火', '', 4600);
        sfx.tap();
      });
      var offLeave = realtime.subscribe('shiguang.world.leave', function(payload) {
        if (!payload || payload.id === myId) return;
        // 从本地名单里摘掉，罗盘与人数立刻归真
        if (state.players[payload.id]) delete state.players[payload.id];
        toast((payload.name || '有同学') + ' 回舱休息了');
      });
      var offDawn = realtime.subscribe('shiguang.world.dawn', function(payload) {
        if (!payload) return;
        state.calendar.day = payload.day || (state.calendar.day + 1);
        // 全班的田长高的那一截，跟着晨光一起到
        var grown = payload.grown || [];
        state.weather = payload.weather || 'sun';
        if (payload.season) state.season = payload.season;
        for (var gi = 0; gi < grown.length; gi++) {
          var g = grown[gi];
          var gc = state.flowers[g.x + ',' + g.y];
          if (gc) { gc.growth = g.growth; gc.wateredDay = g.watered_day; }
        }
        // 雨天自动浇透：今天所有苗都算浇过了
        if (state.weather === 'rain') {
          for (var fk in state.flowers) {
            if (!Object.prototype.hasOwnProperty.call(state.flowers, fk)) continue;
            var fkin = state.flowers[fk];
            if (fkin.species >= 0) fkin.wateredDay = state.calendar.day;
          }
        }
        if (state.ready) {
          // 通宵惩罚：没睡觉熬过跨日 → 体力只剩六成
          if (!rested && !sleepPending && lightState) {
            lightState.v = Math.max(1, lightState.v * 0.6);
            toast('你熬了个通宵　浑身只剩六成力气', 'warn');
          }
          rested = false;
          if (sleepPending) { finishSleep(state.weather); }
          else {
            if (payload.newChapter) {
              // 章节卡优先于横幅：走进新故事的仪式感大于一切
              var chTitle = '';
              for (var sci2 = 0; sci2 < state.storyChapters.length; sci2++) {
                if (state.storyChapters[sci2].id === payload.newChapter) chTitle = state.storyChapters[sci2].title;
              }
              playChapterCard(chTitle || payload.newChapter, '拾光志 · 新章解锁');
            } else if (payload.festival) {
              showBanner('flag', payload.festival + '灯节开始了！', '今天的种子半价 —— 新一季，从一块新田开始', '', 5200);
            } else {
              showBanner('flag', '第 ' + state.calendar.day + ' 天的晨光',
                state.weather === 'rain' ? '今天下雨 —— 云替你把水浇了' :
                grown.length ? '昨晚浇过水的作物长高了一节' : '别忘了给作物浇水', '', 4200);
            }
            sfx.dawn();
          }
          updateHud();
        }
      });
      var offSurge = realtime.subscribe('shiguang.world.surge', function(payload) {
        if (!payload) return;
        if (payload.active) {
          state.surge = { active: true, until: payload.until || (Date.now() + 45000) };
          showBanner('rune', '暗涌来了', '全图灯柱变暗 45 秒 —— 回到灯边，守住你的火', 'meteor', 6000);
          sfx.meteor();
        } else {
          state.surge = null;
          toast('暗涌退了，灯柱重新亮起来');
        }
        updateHud();
      });

      var offSecret = realtime.subscribe('shiguang.world.secret', function(payload) {
        if (!payload) return;
        showBanner('rune', '秘境之门开启', '五座石碑全部苏醒 —— 云海深处传来了回响', 'legend', 6500);
        sfx.rune();
      });

      var offAward = realtime.subscribe('shiguang.you.award', function(payload) {
        if (!payload) return;
        toast(payload.title + (payload.desc ? '　' + payload.desc : ''), 'award');
        sfx.award();
        if (payload.kind === 'quest') {
          if (sheetKind === 'quests') refreshQuestsPanel();
          else {
            http('get', '/shiguang/quests').then(function(data) {
              var intro = (data && data.intro) || [];
              var daily = (data && data.daily) || [];
              var n = 0;
              for (var i = 0; i < intro.length; i++) if (intro[i].done && !intro[i].claimed) n++;
              for (var d2 = 0; d2 < daily.length; d2++) if (daily[d2].done && !daily[d2].claimed) n++;
              state.claimable = n;
              updateHud();
            }).catch(function() {});
          }
        } else if (payload.kind === 'achv') {
          state.achCount++;
        }
      });

      onDestroy(function() {
        if (offDelta) offDelta();
        if (offDawn) offDawn();
        if (offReveal) offReveal();
        if (offBottle) offBottle();
        if (offMeteor) offMeteor();
        if (offLegend) offLegend();
        if (offStele) offStele();
        if (offEnter) offEnter();
        if (offLeave) offLeave();
        if (offDawn) offDawn();
        if (offSurge) offSurge();
        if (offSecret) offSecret();
        if (offAward) offAward();
      });
    }

    // ---------- 心跳与对齐 ----------
    var hbTimer = 0;
    var syncTimer = 0;

    function heartbeat() {
      http('post', '/shiguang/heartbeat').then(function(data) {
        if (!data) return;
        if (typeof data.onlineCount === 'number') state.onlineCount = data.onlineCount;
        if (typeof data.lampCount === 'number') state.lampCount = data.lampCount;
        if (typeof data.claimable === 'number') state.claimable = data.claimable;
        applyMeteor(data.meteor);
        if (data.surge && data.surge.active) {
          if (!state.surge || !state.surge.active) {
            state.surge = { active: true, until: data.surge.until || (Date.now() + 45000) };
            showBanner('rune', '暗涌来了', '全图灯柱变暗 45 秒 —— 回到灯边，守住你的火', 'meteor', 6000);
          }
        } else if (state.surge && state.surge.active) {
          state.surge = null;
        }
        if (state.meteor && Date.now() > state.meteor.endsAt) {
          state.meteor = null;
          state.meteorNodes = {};
        }
        updateHud();
      }).catch(function() {});
    }

    function resync() {
      http('get', '/shiguang/nearby?r=14').then(function(data) {
        if (!data || !data.me) return;
        state.me.shards = data.me.shards;
        // 只清理远处的真实玩家，NPC（npc_ 前缀）常驻不删
        var ids = Object.keys(state.players);
        for (var i = 0; i < ids.length; i++) {
          if (isNpcId(ids[i])) continue;
          var p = state.players[ids[i]];
          if (Math.abs(p.x - state.me.x) > 16 || Math.abs(p.y - state.me.y) > 16) delete state.players[ids[i]];
        }
        var now = Date.now();
        for (var pi = 0; pi < data.players.length; pi++) {
          var pr = data.players[pi];
          if (pr.id === myId) continue;
          upsertPlayer(pr.id, pr.name, pr.x, pr.y, pr.dir, now, pr.hat, pr.lantern, pr.title);
        }
        state.lamps = {};
        for (var l = 0; l < data.lamps.length; l++) addLamp(data.lamps[l].x, data.lamps[l].y, data.lamps[l].c, data.lamps[l].level);
        for (var fk in state.flowers) {
          if (Object.prototype.hasOwnProperty.call(state.flowers, fk)) {
            var parts = fk.split(',');
            var fx = parseInt(parts[0], 10);
            var fy = parseInt(parts[1], 10);
            if (Math.abs(fx - state.me.x) > 16 || Math.abs(fy - state.me.y) > 16) delete state.flowers[fk];
          }
        }
        if (data.flowers) {
          for (var fl = 0; fl < data.flowers.length; fl++) {
            var f = data.flowers[fl];
            addFlower(f.x, f.y, f.species, f.created_at, f.user_id, f.ready_at, f.water);
            var ff2 = state.flowers[f.x + ',' + f.y];
            if (ff2) { ff2.growth = f.growth || 0; ff2.wateredDay = f.watered_day || -1; }
          }
        }
        updateHud();
      }).catch(function() {});
    }

    function startTimers() {
      if (!hbTimer) hbTimer = setInterval(heartbeat, 15000);
      if (!syncTimer) syncTimer = setInterval(resync, 26000);
    }

    function stopTimers() {
      if (hbTimer) { clearInterval(hbTimer); hbTimer = 0; }
      if (syncTimer) { clearInterval(syncTimer); syncTimer = 0; }
    }
    onDestroy(stopTimers);

    function onVisibility() {
      if (document.hidden) {
        stopLoop();
        stopTimers();
      } else {
        startLoop();
        startTimers();
        heartbeat();
        resync();
      }
    }
    document.addEventListener('visibilitychange', onVisibility);
    onDestroy(function() { document.removeEventListener('visibilitychange', onVisibility); });

    // ---------- 尺寸 ----------
    var resizeTimer = 0;
    function onResize() {
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(function() { resize(); }, 120);
    }
    window.addEventListener('resize', onResize);
    onDestroy(function() {
      window.removeEventListener('resize', onResize);
      if (resizeTimer) clearTimeout(resizeTimer);
      if (fieldRaf) { window.cancelAnimationFrame(fieldRaf); fieldRaf = 0; }
      fieldJob = null;
    });

    var ro = null;
    if (typeof ResizeObserver === 'function') {
      ro = new ResizeObserver(function() { resize(); });
      try { ro.observe(stage); } catch (e) { ro = null; }
    }
    onDestroy(function() { if (ro) { try { ro.disconnect(); } catch (e) {} } });

    // ---------- NPC 对话：靠近即触发 ----------
    // 设计意图：玩家不需要「想起来去点 NPC」。走到 4 格内，对方自己开口。
    // 这一下同时补掉了三个窟窿：有人在、有事做、世界记得你。
    // ⚠️ 4 格是「一进世界就被人搭话」的距离：出生点 (80,88) 与守灯人 (76,92)
    // 的切比雪夫距离正好 4，于是每次进入都先弹一个对话框。
    // 收到 2 格：必须真的走到人家跟前才会开口，同时保留「走近就有人说话」的设计。
    var TALK_RADIUS = 2;
    var TALK_TYPE_MS = 34;
    var talk = { npc: null, lines: [], idx: 0, full: '', shown: 0, tick: 0, seen: {}, shop: '' };

    function talkIsOpen() { return talkBox.hidden === false; }

    // 对话开着，或者这个人这次靠近已经聊过 → 不画头顶的「…」
    function talkMarkHidden(npcId) {
      if (talkBox.hidden === false) return true;
      return !!(talk && talk.seen && talk.seen[npcId]);
    }

    function talkShowLine(i) {
      talk.idx = i;
      talk.full = String(talk.lines[i] || '');
      talk.shown = 0;
      talkText.textContent = '';
      talkMore.className = 'sg-talk-more';
      if (talk.tick) { clearInterval(talk.tick); talk.tick = 0; }
      talk.tick = setInterval(function() {
        if (talk.shown >= talk.full.length) {
          clearInterval(talk.tick);
          talk.tick = 0;
          talkMore.className = 'sg-talk-more is-show';
          return;
        }
        talk.shown++;
        talkText.textContent = talk.full.slice(0, talk.shown);
      }, TALK_TYPE_MS);
    }

    function talkNext() {
      if (talk.npc === null) return;
      // 正在打字 → 一次放完（这是对话系统唯一必须有的手感：不让玩家等）
      if (talk.shown < talk.full.length) {
        if (talk.tick) { clearInterval(talk.tick); talk.tick = 0; }
        talk.shown = talk.full.length;
        talkText.textContent = talk.full;
        talkMore.className = 'sg-talk-more is-show';
        return;
      }
      if (talk.idx + 1 < talk.lines.length) { talkShowLine(talk.idx + 1); return; }
      talkClose();
    }

    function talkClose() {
      if (talk.tick) { clearInterval(talk.tick); talk.tick = 0; }
      talkBox.hidden = true;
      talkBox.className = 'sg-talk';
      talk.npc = null;
      talk.lines = [];
      talk.full = '';
      talk.shown = 0;
      // 关掉对话时把长按方向键的状态也清掉，否则松手前人会一直走
      heldKey = 0;
      if (holdTimer) { clearInterval(holdTimer); holdTimer = 0; }
    }

    function talkOpenWith(npcId) {
      if (talk.npc !== null) return;
      http('post', '/shiguang/npc/talk', { npc: npcId }).then(function(data) {
        if (!data || data.rejected || !data.lines || !data.lines.length) return;
        if (talk.npc !== null) return;   // 期间已经开了别的对话
        talk.npc = npcId;
        talk.lines = data.lines;
        talk.shop = data.shop || '';
        var nm = String(data.name || '岛民');
        talkFace.textContent = nm.charAt(nm.length - 1) || '?';
        talkName.textContent = nm;
        talkFavor.hidden = false;
        talkGiftBtn.hidden = false;
        talkRole.textContent = (data.role || '岛民') + (data.fixed ? '' : ' · 他还有话说');
        // v4.6 拾光镇店主：对话里直接给一扇「看看商品」的门
        talkShopBtn.hidden = !talk.shop;
        if (talk.shop) {
          talkShopBtn.textContent = talk.shop === 'seed' ? '看看种子'
            : talk.shop === 'wardrobe' ? '看看衣帽'
            : '查查学元';
        }
        // v4.7 好感度：条 + 送礼按钮（岛民都吃这一套）
        talkFavor.hidden = false;
        talkFavorFill.style.width = Math.min(100, Math.round(((data.favor || 0) / 15) * 100)) + '%';
        talkFavorLabel.textContent = '好感 · ' + (data.favorLevel || '陌生');
        talkGiftBtn.hidden = false;
        talkBox.hidden = false;
        talkBox.className = 'sg-talk is-on';
        talkShowLine(0);
      }).catch(function() {});
    }

    talkBox.addEventListener('click', function(e) {
      e.preventDefault();
      talkNext();
    });

    // v4.7 好感度条 + 送礼按钮
    var talkFavor = el('div', 'sg-talk-favor');
    var talkFavorBar = el('div', 'sg-talk-favor-bar');
    var talkFavorFill = el('div', 'sg-talk-favor-fill');
    talkFavorFill.style.width = '0%';
    talkFavorBar.appendChild(talkFavorFill);
    var talkFavorLabel = el('span', 'sg-talk-favor-label', '好感 · 陌生');
    talkFavor.appendChild(talkFavorBar);
    talkFavor.appendChild(talkFavorLabel);
    talkFavor.hidden = true;
    var talkGiftBtn = el('button', 'sg-talk-shop');
    talkGiftBtn.type = 'button';
    talkGiftBtn.hidden = true;
    talkGiftBtn.textContent = '送 TA 一点星屑（1~5）';
    talkGiftBtn.addEventListener('click', function(ev) {
      ev.preventDefault();
      ev.stopPropagation();
      var nid = talk.npc;
      if (!nid) return;
      http('post', '/shiguang/npc/gift', { npc: nid, shards: 2 }).then(function(d) {
        if (d && d.rejected) {
          if (d.rejected === 'cooldown') toast('歇 ' + d.wait + ' 秒再送');
          else if (d.rejected === 'shards') toast('星屑不够了');
          else toast('送不了');
          return;
        }
        state.me.shards = d.shards;
        talkFavorFill.style.width = Math.min(100, Math.round(((d.favor || 0) / 15) * 100)) + '%';
        talkFavorLabel.textContent = '好感 · ' + (d.level || '陌生');
        sfx.award();
        if (d.rewarded) {
          toast('「知己」达成　TA 送了你 5 学元（已入学元钱包）', 'award');
          refreshWallet();
        } else {
          toast('TA 收下了　好感 +2', 'warm');
        }
        updateHud();
      }).catch(function() { toast('送礼失败'); });
    });

    // v4.6 店主的「看看商品」按钮：种子铺 / 衣帽店 / 钱庄
    var talkShopBtn = el('button', 'sg-talk-shop');
    talkShopBtn.type = 'button';
    talkShopBtn.hidden = true;
    talkShopBtn.addEventListener('click', function(ev) {
      ev.preventDefault();
      ev.stopPropagation();
      var shop = talk.shop;
      talkShopBtn.hidden = true;
      talk.npc = null;
      talkBox.hidden = true;
      talkBox.className = 'sg-talk';
      if (shop === 'seed') { openSeedSheet(); }
      else if (shop === 'wardrobe') { openWardrobe(); }
      else if (shop === 'bank') {
        refreshWallet();
        openSheet('bank', '拾光钱庄');
        clearNode(sheetBody);
        var row = el('div', 'sg-sum-row');
        row.appendChild(el('b', 'sg-sum-key', '学元'));
        row.appendChild(el('span', 'sg-sum-val',
          (state.xyGrant || 0).toFixed(2) + ' 学元（赠送学元 · 同学间互赠、不能购买商品）'));
        sheetBody.appendChild(row);
        sheetBody.appendChild(el('div', 'sg-tip',
          '想给同学送学元：走近 TA 点 TA，选「赠学元」。'));
        // v4.7 钱庄收货：背包里的果实/材料在这里变现
        sheetBody.appendChild(sectionTitle('收购行市'));
        renderBag(sheetBody);
        // v4.11 工具升级：星屑的大额出口 —— 成长曲线的核心
        sheetBody.appendChild(sectionTitle('工具升级'));
        var toolNames = { till: '星辉锄头（翻地体力 4→2）', water: '星辉水壶（浇水更省）', chop: '星辉斧头（砍树必得 2 木）', mine: '星辉矿镐（挖矿必得 2 矿）' };
        var toolCosts = { till: 60, water: 80, chop: 70, mine: 70 };
        var tIds = Object.keys(toolNames);
        for (var tix = 0; tix < tIds.length; tix++) {
          (function(tid) {
            var lvl = (state.tools || {})[tid] || 1;
            var cost = toolCosts[tid];
            var trow = el('div', 'sg-qcard');
            trow.style.marginBottom = '8px';
            var thead = el('div', 'sg-bottle-head');
            thead.appendChild(el('span', 'sg-bottle-name', toolNames[tid]));
            thead.appendChild(el('span', 'sg-bottle-pos', lvl >= 2 ? '星辉级' : '初始级'));
            trow.appendChild(thead);
            if (lvl >= 2) {
              trow.appendChild(el('div', 'sg-cf-note', '已升至星辉级 —— 谢谢惠顾'));
            } else {
              var up = el('button', 'sg-set-action');
              up.type = 'button';
              up.appendChild(svgIcon('spark'));
              up.appendChild(el('span', null, '升到星辉级（' + cost + ' 星屑）'));
              up.addEventListener('click', function() {
                http('post', '/shiguang/shop/tools', { tool: tid }).then(function(d) {
                  if (d && d.rejected) {
                    if (d.rejected === 'shards') toast('还差 ' + (d.need - (d.have || 0)) + ' 枚星屑');
                    else if (d.rejected === 'max') toast('已经是星辉级了');
                    else toast('升不了');
                    return;
                  }
                  state.me.shards = d.shards;
                  state.tools = d.tools || state.tools;
                  sfx.award();
                  toast('「' + d.name + '」升级完成！', 'award');
                  updateHud();
                  renderBag(sheetBody);
                }).catch(function() { toast('升级失败'); });
              });
              trow.appendChild(up);
            }
            sheetBody.appendChild(trow);
          })(tIds[tix]);
        }
      }
    });
    talkBox.appendChild(talkFavor);
    talkBox.appendChild(talkGiftBtn);
    talkBox.appendChild(talkShopBtn);

    var talkTimer = setInterval(function() {
      if (!state.ready || talk.npc !== null) return;
      if (sheet.hidden === false || modal.hidden === false || tutorial.hidden === false) return;
      if (flying) return;

      var best = null;
      var bestD = 99;
      var anyNear = false;
      for (var tid in state.players) {
        if (!Object.prototype.hasOwnProperty.call(state.players, tid)) continue;
        if (!isNpcId(tid)) continue;
        var tp = state.players[tid];
        var d = Math.max(Math.abs(tp.x - state.me.x), Math.abs(tp.y - state.me.y));
        // 退到 7 格外才允许「重新搭话」—— 否则玩家站在 NPC 面前会被反复拉住
        if (d <= TALK_RADIUS + 3) anyNear = true;
        if (d > TALK_RADIUS || talk.seen[tid]) continue;
        if (d < bestD) { bestD = d; best = tid; }
      }
      if (!anyNear) talk.seen = {};
      if (best) {
        talk.seen[best] = 1;
        talkOpenWith(best);
      }
    }, 450);
    onDestroy(function() { if (talkTimer) clearInterval(talkTimer); });

    var sizeGuard = setInterval(resize, 900);
    onDestroy(function() { clearInterval(sizeGuard); });

    // ---------- 启动 ----------
    resize();

    function loadTerrain() {
      var cached = null;
      try { cached = storage.get('terrain', null); } catch (e) { cached = null; }
      var fresh = cached && cached.cells && cached.nodes && cached.version ? cached : null;
      // 尺寸自检：v1/v2 时代的旧缓存只有 80×80=6400 格，与 160×160 世界不匹配，
      // 不校验的话会把旧地图当新世界渲染（生产「老样子」的直接元凶）。
      var need = state.size * state.size;
      if (fresh && (fresh.cells.length !== need || fresh.nodes.length !== need)) fresh = null;
      // 缓存只兜底 5 分钟：地形 26KB（gzip ~3KB），世界每次进都是新的才稳。
      if (fresh && fresh.at && Date.now() - fresh.at < 300000) {
        return Promise.resolve(fresh);
      }
      return http('get', '/shiguang/terrain').then(function(data) {
        if (!data) throw new Error('地形为空');
        data.at = Date.now();
        try { storage.set('terrain', data); } catch (e) {}
        return data;
      }).catch(function(err) {
        if (fresh) return fresh;
        throw err;
      });
    }

    function applyEnter(data) {
      if (!data) return;
      myId = (data.me && data.me.id) || '';
      state.me.x = data.me.x;
      state.me.y = data.me.y;
      state.me.dir = data.me.dir || 0;
      meFx = data.me.x + 0.5;      // 出生在格心
      meFy = data.me.y + 0.5;
      lastCellKey = data.me.x + ',' + data.me.y;
      state.me.shards = data.me.shards || 0;
      state.me.built = data.me.built || 0;
      state.me.name = data.me.name || '';
      state.me.hat = (data.me && data.me.hat) || '0';
      state.me.lantern = (data.me && data.me.lantern) || '0';
      state.me.title = (data.me && data.me.title) || '';
      state.me.tutorial = (data.me && data.me.tutorial) || 0;
      state.lampCount = data.lampCount || 0;
      state.stage = data.stage || 0;
      state.stageInfo = data.stageInfo || state.stageInfo;
      state.onlineCount = data.onlineCount || 1;
      state.achCount = data.achCount || 0;
      view.camX = (meFx > 0 ? meFx : state.me.x + 0.5);
      view.camY = (meFy > 0 ? meFy : state.me.y + 0.5);

      applyExplored(data.explored);

      state.lamps = {};
      if (data.lamps) {
        for (var i = 0; i < data.lamps.length; i++) addLamp(data.lamps[i].x, data.lamps[i].y, data.lamps[i].c, data.lamps[i].level);
      }
      state.flowers = {};
      if (data.flowers) {
        for (var fl = 0; fl < data.flowers.length; fl++) {
          var f = data.flowers[fl];
          addFlower(f.x, f.y, f.species, f.created_at, f.user_id, f.ready_at, f.water);
          var ff = state.flowers[f.x + ',' + f.y];
          if (ff) { ff.growth = f.growth || 0; ff.wateredDay = f.watered_day || -1; }
        }
      }
      state.players = {};
      var now = Date.now();
      if (data.players) {
        for (var j = 0; j < data.players.length; j++) {
          var p = data.players[j];
          upsertPlayer(p.id, p.name, p.x, p.y, p.dir, now, p.hat, p.lantern, p.title);
        }
      }
      // NPC 行者
      if (data.npcs) {
        for (var n = 0; n < data.npcs.length; n++) {
          var npc = data.npcs[n];
          upsertPlayer(npc.id, npc.name, npc.x, npc.y, npc.dir, now, npc.hat, npc.lantern, null);
        }
      }
      // 石碑
      state.steles = {};
      if (data.steles) {
        for (var sd = 0; sd < data.steles.length; sd++) {
          var s = data.steles[sd];
          state.steles[s.x + ',' + s.y] = s;
        }
      }
      if (data.reveal) revealCells(data.reveal);

      var introQ = [];
      var dailyQ = [];
      var claimable = 0;
      if (data.quests) {
        for (var q = 0; q < data.quests.length; q++) {
          var qrow = data.quests[q];
          if (qrow.kind === 'daily') dailyQ.push(qrow);
          else introQ.push(qrow);
          if (qrow.done && !qrow.claimed) claimable++;
        }
      }
      state.quests = { intro: introQ, daily: dailyQ };
      state.claimable = claimable;
      if (data.wardrobe) {
        state.wardrobe.owned = data.wardrobe.owned || state.wardrobe.owned;
        state.wardrobe.equipped = data.wardrobe.equipped || state.wardrobe.equipped;
        if (data.wardrobe.equipped) {
          state.me.hat = data.wardrobe.equipped.hat || state.me.hat;
          state.me.lantern = data.wardrobe.equipped.lantern || state.me.lantern;
          state.me.title = data.wardrobe.equipped.title || state.me.title;
        }
      }

      // v4.2 星露谷的一天：进世界先对齐日历与天气
      state.calendar = { day: (data.calendar && data.calendar.day) || 1,
                         endsAt: Date.now() + ((data.calendar && data.calendar.msLeft) || 0) };
      state.weather = (data.calendar && data.calendar.weather) || 'sun';
      // v4.6 宅基地与学元
      state.house = data.house || null;
      state.houses = data.houses || [];
      state.bag = data.bag || {};
      state.tools = data.tools || {};
      state.season = (data.calendar && data.calendar.season) || '春';
      refreshWallet();
      refreshStory();
      refreshMeets();
      refreshGoal();
      refreshLetters();
      applyMeteor(data.meteor);

      state.ready = true;
      loading.className = 'sg-loading is-hidden';
      setTimeout(function() {
        if (loading.parentNode) loading.style.display = 'none';
      }, 480);
      updateHud();
      startMinimap();
    }

    function boot() {
      loadAssets().then(function() {
        return loadTerrain();
      }).then(function(terrain) {
        state.size = terrain.size || 240;
        state.cells = terrain.cells || '';
        state.nodes = terrain.nodes || '';
        buildLotusList();   // 湖上的荷灯：地形一到位就定位（确定性哈希）
        state.lampCost = terrain.lampCost || 3;
        state.lampRadius = terrain.lampRadius || 4;
        state.flowerCost = terrain.flowerCost || 2;
        state.flowerCap = terrain.flowerCap || 40;
        state.flowerGrowMs = terrain.flowerGrowMs || 90000;
        state.fishCooldownMs = terrain.fishCooldownMs || 25000;
        state.catalog.shop = terrain.shop || null;
        state.catalog.fishTable = terrain.fishTable || [];
        state.catalog.emotes = terrain.emotes || [];
        state.catalog.flowerSpecies = terrain.flowerSpecies || [];
        state.catalog.islands = terrain.islands || [];
        state.catalog.landmarks = terrain.landmarks || [];
        state.catalog.steles = terrain.steles || [];
        state.catalog.speechLines = terrain.speechLines || [];
        // 阶段表原本只存在于服务端。/terrain 一直在返回它，前端却从来没接住 ——
        // 于是顶栏只能显示当前档名，显示不出「还差几根」。
        state.catalog.stages = terrain.stages || [];
        state.catalog.crops = terrain.crops || [];
        buildField();
        applyExplored('');
        return http('post', '/shiguang/enter', {});
      }).then(function(data) {
        applyEnter(data);
        bindRealtime();
        startLoop();
        startTimers();
        startRings();
        if (prefs.sound) {
          var kick = function() {
            audioInit();
            if (audio.ctx && audio.ctx.state === 'suspended') {
              try { audio.ctx.resume(); } catch (e2) {}
            }
            ambientStart();
            window.removeEventListener('pointerdown', kick);
          };
          window.addEventListener('pointerdown', kick);
          onDestroy(function() { window.removeEventListener('pointerdown', kick); });
        }
        if (!state.me.tutorial) {
          setTimeout(introCinema, 800);
        } else {
          setTimeout(function() {
            toast('欢迎回到拾光群岛', 'warm');
          }, 600);
        }
        setTimeout(function() {
          if (root.className.indexOf('is-settled') === -1) root.className += ' is-settled';
        }, 5200);
      }).catch(function(err) {
        loading.className = 'sg-loading is-error';
        clearNode(loading);
        loading.appendChild(el('div', 'sg-loading-text', (err && err.message) || '渡海失败'));
        var retry = el('button', 'sg-loading-retry', '再试一次');
        retry.type = 'button';
        retry.addEventListener('click', function() {
          loading.className = 'sg-loading';
          loading.style.display = '';
          clearNode(loading);
          loading.appendChild(buildOrb());
          loading.appendChild(el('div', 'sg-loading-text', '正在渡海…'));
          boot();
        });
        loading.appendChild(retry);
      });
    }

    boot();

    // ---------- 卸载 ----------
    onDestroy(function() {
      stopLoop();
      try {
        if (api && typeof api.post === 'function') api.post('/shiguang/leave', {});
      } catch (e) {}
    });
    onDestroy(function() {
      if (root.parentNode) root.parentNode.removeChild(root);
    });
  }

  function unmount(container) {
    if (!container) return;
    while (container.firstChild) container.removeChild(container.firstChild);
  }

  window.ClassIntraMarket.define({ name: NAME, mount: mount, unmount: unmount });
})();
