/* 拾光群岛 —— 市场应用入口（v3 · 云海拾光 · 大世界）
 *
 * 运行约束（市场应用不走 Vite 构建，直接下发浏览器执行）：
 *   - 全 ES5：var / function / 单引号；不用箭头函数、模板串、?.、??、class、async
 *   - 不用 Element.replaceChildren()（Chrome 86+），校园平板基线是 Chrome 80
 *   - 不用 CSS gap / backdrop-filter 作为布局前提（84+），降级要能看
 *   - 一切订阅 / 计时器 / 监听都登记到 context.app.onDestroy
 *
 * v3 = 160×160 八岛大世界 + Kenney 像素素材层（CC0）+ Unifont EX 画布像素字：
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
  var HAIR_COLORS = [
    { base: '#463529', shade: '#2e2118' },
    { base: '#7a5230', shade: '#5c3a1e' },
    { base: '#c99a4a', shade: '#a67c32' },
    { base: '#96453a', shade: '#75312a' },
    { base: '#555a70', shade: '#3d4152' }
  ];

  // 光花品种（species 索引对应 backend FLOWER_SPECIES）
  var FLOWER_COLORS = [
    { petal: 'rgba(120, 196, 255, 0.95)', deep: 'rgba(48, 108, 190, 0.9)', core: 'rgba(214, 240, 255, 1)', glow: '110, 190, 255' },
    { petal: 'rgba(255, 178, 102, 0.95)', deep: 'rgba(190, 96, 40, 0.9)', core: 'rgba(255, 236, 190, 1)', glow: '255, 176, 92' },
    { petal: 'rgba(240, 246, 252, 0.96)', deep: 'rgba(148, 160, 184, 0.92)', core: 'rgba(255, 255, 255, 1)', glow: '214, 230, 255' },
    { petal: 'rgba(190, 150, 255, 0.95)', deep: 'rgba(104, 62, 190, 0.9)', core: 'rgba(240, 224, 255, 1)', glow: '178, 136, 255' }
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

  function playerColor(id) {
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
  var BIOME_PALETTES = {
    meadow: { lit: [44, 84, 62], shd: [11, 30, 32], stLit: [92, 104, 124], stShd: [30, 36, 50], pathLit: [148, 134, 116], pathShd: [70, 62, 56] },
    mist:   { lit: [46, 88, 88], shd: [12, 32, 40], stLit: [88, 104, 128], stShd: [28, 36, 52], pathLit: [140, 134, 124], pathShd: [64, 62, 60] },
    stone:  { lit: [96, 106, 126], shd: [30, 36, 50], stLit: [116, 128, 150], stShd: [40, 46, 62], pathLit: [152, 144, 130], pathShd: [72, 66, 58] },
    beach:  { lit: [140, 138, 106], shd: [46, 46, 40], stLit: [104, 112, 128], stShd: [36, 42, 56], pathLit: [168, 150, 122], pathShd: [84, 72, 58] },
    marsh:  { lit: [36, 66, 56], shd: [8, 24, 26], stLit: [78, 90, 104], stShd: [26, 32, 44], pathLit: [126, 122, 106], pathShd: [58, 56, 50] },
    flower: { lit: [56, 92, 58], shd: [14, 34, 28], stLit: [98, 106, 122], stShd: [32, 38, 50], pathLit: [156, 132, 112], pathShd: [74, 62, 54] },
    coral:  { lit: [88, 92, 112], shd: [28, 32, 46], stLit: [112, 112, 136], stShd: [38, 40, 56], pathLit: [150, 134, 122], pathShd: [70, 62, 56] },
    frost:  { lit: [138, 156, 168], shd: [56, 70, 86], stLit: [150, 164, 180], stShd: [60, 72, 88], pathLit: [170, 172, 178], pathShd: [88, 92, 100] }
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
      size: 160,
      cells: '',
      nodes: '',
      explored: null,
      exploreVer: 0,
      me: { x: 0, y: 0, dir: 0, shards: 0, name: '', built: 0, hat: '0', lantern: '0', title: '', tutorial: 0 },
      players: {},            // 含 NPC（id 前缀 npc_，渲染走精灵图）
      lamps: {},              // 'x,y' -> { x, y, c }
      gathered: {},
      flowers: {},
      meteorNodes: {},
      meteor: null,
      emoteFx: [],
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
      catalog: { shop: null, fishTable: [], emotes: [], flowerSpecies: [], islands: [], landmarks: [], steles: [], speechLines: [] },
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
            im.src = context.app.assetUrl('img/' + nm + '.png');
          }));
        })(names[i]);
      }
      // 画布像素字：FontFace 是 Chrome 60+ 的能力，基线 80 支持。
      jobs.push(new Promise(function(resolve) {
        try {
          if (typeof window.FontFace !== 'function') { resolve(false); return; }
          var face = new window.FontFace(pixelFontName, 'url(' + context.app.assetUrl('fonts/unifont-ex.woff2') + ')');
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

    pills.appendChild(pillShard);
    pills.appendChild(pillLamp);
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

    // ---------- 小地图 ----------
    var minimap = el('div', 'sg-minimap');
    minimap.setAttribute('role', 'button');
    minimap.setAttribute('aria-label', '小地图，点按放大');
    var mmBase = document.createElement('canvas');
    mmBase.className = 'sg-mm-canvas sg-mm-base';
    mmBase.width = 160; mmBase.height = 160;
    var mmDots = document.createElement('canvas');
    mmDots.className = 'sg-mm-canvas sg-mm-dots';
    mmDots.width = 160; mmDots.height = 160;
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
    btnFly.style.display = 'none';
    btnStele.style.display = 'none';
    acts.appendChild(btnEmote);
    acts.appendChild(btnBottle);
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

    root.appendChild(sheet);
    root.appendChild(modal);
    root.appendChild(tutorial);
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
      var t = Math.min(w / 27, h / 17);
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

    function buildMasks() {
      var size = state.size;
      var M = size * MASK_SUB;
      maskW = M;
      var land = new Float32Array(M * M);
      var mead = new Float32Array(M * M);
      var sand = new Float32Array(M * M);
      var stone = new Float32Array(M * M);
      var x, y, sx, sy, code, rowOff, idx;
      for (y = 0; y < size; y++) {
        for (x = 0; x < size; x++) {
          code = state.cells.charCodeAt(y * size + x) - 48;
          if (code === T_DOCK) code = T_CLOUD;
          if (!(code >= 1 && code <= 5)) code = T_CLOUD;
          for (sy = 0; sy < MASK_SUB; sy++) {
            rowOff = (y * MASK_SUB + sy) * M + x * MASK_SUB;
            for (sx = 0; sx < MASK_SUB; sx++) {
              idx = rowOff + sx;
              land[idx] = 1;
              if (code === T_SAND || code === T_PATH) sand[idx] = 1;
              else if (code === T_STONE) stone[idx] = 1;
              else mead[idx] = 1;
            }
          }
        }
      }
      maskLand = boxBlur(boxBlur(land, M, 4), M, 4);
      maskMeadow = boxBlur(mead, M, 1);
      maskSand = boxBlur(sand, M, 1);
      maskStone = boxBlur(stone, M, 1);
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
            var SD_R = pal.shd[0], SD_G = pal.shd[1], SD_B = pal.shd[2];
            var SL_R = pal.pathLit[0], SL_G = pal.pathLit[1], SL_B = pal.pathLit[2];
            var KD_R = pal.stShd[0], KD_G = pal.stShd[1], KD_B = pal.stShd[2];
            var KL_R = pal.stLit[0], KL_G = pal.stLit[1], KL_B = pal.stLit[2];

            r = (MD_R * mw + SD_R * sw + KD_R * kw)
              + ((ML_R * mw + SL_R * sw + KL_R * kw) - (MD_R * mw + SD_R * sw + KD_R * kw)) * light;
            g = (MD_G * mw + SD_G * sw + KD_G * kw)
              + ((ML_G * mw + SL_G * sw + KL_G * kw) - (MD_G * mw + SD_G * sw + KD_G * kw)) * light;
            b = (MD_B * mw + SD_B * sw + KD_B * kw)
              + ((ML_B * mw + SL_B * sw + KL_B * kw) - (MD_B * mw + SD_B * sw + KD_B * kw)) * light;

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
          var lean = t * (hash2(x, y, 53) - 0.5) * 0.05;
          pGrassA.moveTo(cxp, cyp); pGrassA.lineTo(cxp - sp1 + lean, cyp - hgt);
          pGrassA.moveTo(cxp + sp2, cyp + t * 0.02); pGrassA.lineTo(cxp + sp2 + lean, cyp - hgt * 0.74);
          pGrassA.moveTo(cxp - sp2, cyp + t * 0.03); pGrassA.lineTo(cxp - sp2 - sp1 + lean, cyp - hgt * 0.56);
        }
        if (n < 0.34) {
          var cxp2 = sx + t * (0.18 + hash2(x, y, 31) * 0.64);
          var cyp2 = sy + t * (0.30 + hash2(x, y, 37) * 0.46);
          var hgt2 = t * (0.06 + hash2(x, y, 41) * 0.09);
          pGrassB.moveTo(cxp2, cyp2); pGrassB.lineTo(cxp2 + t * 0.026, cyp2 - hgt2);
          pGrassB.moveTo(cxp2 + t * 0.048, cyp2 + t * 0.02); pGrassB.lineTo(cxp2 + t * 0.070, cyp2 - hgt2 * 0.62);
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

    function drawHouse(h, ox, oy, t) {
      var sx = ox + h.x * t;
      var sy = oy + h.y * t;
      // 落影
      ctx.fillStyle = 'rgba(3, 9, 13, 0.32)';
      ctx.beginPath();
      ctx.ellipse(sx + t * 1.6, sy + t * 1.75, t * 1.7, t * 0.5, 0, 0, 6.2832);
      ctx.fill();
      var roof = h.style === 'red' ? [K.roofR1, K.roofR2, K.roofR3] : [K.roofG1, K.roofG2, K.roofG3];
      var wall = h.style === 'red' ? [K.wallR1, K.wallR2, K.wallR3] : [K.wallG1, K.wallG2, K.wallG3];
      var s = t / 16;
      // 屋顶一排
      drawTile(roof[0], sx, sy, s);
      drawTile(roof[1], sx + t, sy, s);
      drawTile(roof[2], sx + t * 2, sy, s);
      // 墙一排（中格是门）
      drawTile(wall[0], sx, sy + t, s);
      drawTile(K.door, sx + t, sy + t, s);
      drawTile(wall[2], sx + t * 2, sy + t, s);
      // 门前一盏小径灯
      if (h.style === 'red') drawTile(K.lamp, sx + t * 2.2, sy + t * 0.9, s);
    }

    function drawPathTile(x, y, sx, sy, t) {
      // 石板：一块带缝的暖灰面板，明暗随哈希抖动
      var shade = 0.86 + hash2(x, y, 951) * 0.24;
      var r = Math.round(148 * shade), g = Math.round(136 * shade), b = Math.round(122 * shade);
      ctx.fillStyle = 'rgb(' + r + ',' + g + ',' + b + ')';
      ctx.fillRect(sx + t * 0.06, sy + t * 0.06, t * 0.88, t * 0.88);
      ctx.fillStyle = 'rgba(24, 20, 16, 0.30)';
      ctx.fillRect(sx + t * 0.06, sy + t * 0.88, t * 0.88, Math.max(1, t * 0.06));
      ctx.fillRect(sx + t * 0.88, sy + t * 0.06, Math.max(1, t * 0.06), t * 0.88);
      ctx.fillStyle = 'rgba(255, 244, 220, 0.10)';
      ctx.fillRect(sx + t * 0.06, sy + t * 0.06, t * 0.88, Math.max(1, t * 0.04));
      // 大道上的路灯：石板路每隔几格、且右邻不是路时立一盏（city 86 精灵）
      var isAvenue = Math.abs(x - 80) <= 2 || Math.abs(y - 88) <= 2;
      if (isAvenue && (x + y) % 3 === 0 && !isPathCell(x + 1, y)) {
        drawTile(K.lamp, sx + t * 0.52, sy - t * 0.52, t / 16);
      }
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

      // 森林带：低频噪声决定「这一带是不是林子」；树用 Kenney 精灵。
      var forest = vnoise(x, y, 5.2, 111);
      if (code === T_MEADOW && forest > 0.46 && n > 0.55) {
        var px = sx + t * (hash2(x, y, 91) - 0.5) * 0.5;
        var py = sy + t * (hash2(x, y, 93) - 0.5) * 0.5;
        // 树的落影
        ctx.fillStyle = 'rgba(3, 9, 13, 0.30)';
        ctx.beginPath();
        ctx.ellipse(px + t * 0.62, py + t * 0.80, t * 0.42, t * 0.16, 0, 0, 6.2832);
        ctx.fill();
        var spec;
        if (biome === 'mist') spec = (n > 0.85 ? K.treeM1 : (n > 0.7 ? K.treeS2 : K.pine));
        else if (biome === 'frost') spec = (n > 0.82 ? K.pine : K.treeBare);
        else if (biome === 'beach') spec = (n > 0.86 ? K.treeRound : K.treeS3);
        else spec = (n > 0.93 ? K.treeBigB : (n > 0.86 ? K.treeTall : (n > 0.76 ? K.treeS1 : K.treeM2)));
        drawTile(spec, px + t * 0.14, py - t * 0.14, s);
        return;
      }

      // 零散小物（各岛性格不同）
      if (n > 0.962) {
        if (biome === 'marsh') {
          drawTile(K.mushroom, sx + t * 0.3, sy + t * 0.28, s);
        } else if (biome === 'flower') {
          drawTile(n > 0.985 ? K.sunflower : K.whiteFlower, sx + t * 0.28, sy + t * 0.26, s);
        } else if (biome === 'stone' || biome === 'coral') {
          drawTile(n > 0.988 ? K.rockPile : (n > 0.975 ? K.rockA : K.rockB), sx + t * 0.22, sy + t * 0.24, s);
        } else if (biome === 'beach') {
          drawTile(K.rockB, sx + t * 0.3, sy + t * 0.3, s);
        } else if (biome === 'frost') {
          drawTile(K.rockB, sx + t * 0.3, sy + t * 0.3, s);
        } else if (n > 0.978) {
          drawTile(K.bush, sx + t * 0.24, sy + t * 0.24, s);
        } else {
          drawTile(n > 0.985 ? K.whiteFlower : K.grassFlower, sx + t * 0.26, sy + t * 0.26, s);
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
      ctx.fillStyle = 'rgba(3, 9, 13, 0.38)';
      ctx.beginPath();
      ctx.ellipse(sx + t * 1.0, sy + t * 1.8, t * 1.15, t * 0.4, 0, 0, 6.2832);
      ctx.fill();
      var bx = sx + t;
      var w0 = t * 0.92;
      for (var i = 0; i < 5; i++) {
        var y = sy + t * (1.75 - i * 0.36);
        var w = w0 * (1 - i * 0.11);
        ctx.fillStyle = i % 2 === 0 ? '#e8e2d4' : '#c85a4e';
        ctx.fillRect(bx - w / 2, y - t * 0.36, w, t * 0.36);
        ctx.fillStyle = 'rgba(10, 14, 24, 0.22)';
        ctx.fillRect(bx + w / 2 - t * 0.08, y - t * 0.36, t * 0.08, t * 0.36);
      }
      var lampY = sy + t * 0.16;
      ctx.fillStyle = '#2c2620';
      ctx.fillRect(bx - t * 0.30, lampY - t * 0.30, t * 0.60, t * 0.34);
      ctx.fillStyle = 'rgba(255, 226, 158, 0.95)';
      ctx.fillRect(bx - t * 0.22, lampY - t * 0.24, t * 0.44, t * 0.24);
      ctx.fillStyle = '#3a322a';
      ctx.beginPath();
      ctx.moveTo(bx - t * 0.34, lampY - t * 0.30);
      ctx.lineTo(bx + t * 0.34, lampY - t * 0.30);
      ctx.lineTo(bx, lampY - t * 0.58);
      ctx.closePath();
      ctx.fill();
      var g = ctx.createRadialGradient(bx, lampY - t * 0.1, 0, bx, lampY - t * 0.1, t * 1.6);
      g.addColorStop(0, 'rgba(255, 224, 160, 0.30)');
      g.addColorStop(1, 'rgba(255, 224, 160, 0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(bx, lampY - t * 0.1, t * 1.6, 0, 6.2832);
      ctx.fill();
      // 旋转光束：两片对置的扇形，慢速扫过云海 —— 夜里的锚点
      var ang = now * 0.00045;
      ctx.save();
      ctx.translate(bx, lampY - t * 0.12);
      ctx.rotate(ang);
      var beam = ctx.createLinearGradient(0, 0, t * 7, 0);
      beam.addColorStop(0, 'rgba(255, 232, 178, 0.20)');
      beam.addColorStop(0.6, 'rgba(255, 232, 178, 0.05)');
      beam.addColorStop(1, 'rgba(255, 232, 178, 0)');
      ctx.fillStyle = beam;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(t * 7, -t * 0.85);
      ctx.lineTo(t * 7, t * 0.85);
      ctx.closePath();
      ctx.fill();
      ctx.rotate(3.1416);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(t * 7, -t * 0.85);
      ctx.lineTo(t * 7, t * 0.85);
      ctx.closePath();
      ctx.fill();
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
      var age = clamp((now - f.at) / Math.max(1, state.flowerGrowMs), 0, 1);
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

      var radius = t * (3.4 + 0.24 * flicker);
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
      ctx.fillRect(cx - t * 0.030, cy - t * 0.14, t * 0.060, t * 0.46);

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
    function drawAvatar(cx, cy, t, color, dir, isSelf, name, now, hat, lanternId, npcSprite, walkK) {
      var lc = LANTERN_COLORS[lanternId] || LANTERN_COLORS['0'];
      var walk = clamp(walkK || 0, 0, 1);

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
              + Math.sin(now * 0.0026 + seedB % 6.283) * 0.008 * t * (1 - walk);
      var liftA = Math.max(0, Math.sin(ph)) * 0.035 * t * walk;
      var liftB = Math.max(0, -Math.sin(ph)) * 0.035 * t * walk;
      var armSwing = Math.sin(ph) * 0.018 * t * walk;

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
      ctx.fillStyle = '#2e2630';
      ctx.fillRect(cx - t * 0.105, legY0 - liftA, legW, legY1 - legY0 + liftA * 0.4);
      ctx.fillRect(cx + t * 0.105 - legW, legY0 - liftB, legW, legY1 - legY0 + liftB * 0.4);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.10)';
      ctx.fillRect(cx - t * 0.105, legY0 - liftA, legW, Math.max(1, t * 0.014));
      ctx.fillRect(cx + t * 0.105 - legW, legY0 - liftB, legW, Math.max(1, t * 0.014));

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
        ctx.fillStyle = '#2a2230';
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

      // ---- 名字 ----
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

    function draw(now) {
      var t = view.tile;
      var w = view.w;
      var h = view.h;

      view.camX += (state.me.x + 0.5 - view.camX) * 0.25;
      view.camY += (state.me.y + 0.5 - view.camY) * 0.25;
      if (Math.abs(state.me.x + 0.5 - view.camX) < 0.002) view.camX = state.me.x + 0.5;
      if (Math.abs(state.me.y + 0.5 - view.camY) < 0.002) view.camY = state.me.y + 0.5;

      var ox = Math.round(w / 2 - view.camX * t);
      var oy = Math.round(h / 2 - view.camY * t);
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
      // 鲸影贴着云海游（陆地之下、雾之上）
      drawWhale(ox, oy, t, now);

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
        var sxx = ox + (state.me.x + 0.5) * t;
        var syy = oy + (state.me.y + 0.5) * t;
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

      var ids = Object.keys(state.players);
      for (var pi = 0; pi < ids.length; pi++) {
        var p = state.players[ids[pi]];
        if (!p) continue;
        var k = clamp((now - p.t) / LERP_MS, 0, 1);
        var px = p.px + (p.x - p.px) * k;
        var py = p.py + (p.y - p.py) * k;
        if (px < x0 - 2 || px > x1 + 2 || py < y0 - 2 || py > y1 + 2) continue;
        var npcSpr = isNpcId(p.id) ? (NPC_SPRITES[p.id] ? NPC_SPRITES[p.id]() : null) : null;
        var walkK = isNpcId(p.id) ? 0 : clamp(1 - (now - p.t) / 450, 0, 1);
        drawAvatar(ox + (px + 0.5) * t, oy + (py + 0.5) * t, t * AVATAR_SCALE, playerColor(p.id), p.dir, false, p.name, now, p.hat, p.lantern, npcSpr, walkK);
      }

      var selfWalk = clamp(1 - (Date.now() - lastMoveAt) / 450, 0, 1);
      drawAvatar(ox + (state.me.x + 0.5) * t, oy + (state.me.y + 0.5) * t, t * AVATAR_SCALE,
        playerColor(myId || 'me'), state.me.dir, true, state.me.name, now, state.me.hat, state.me.lantern, null, selfWalk);

      // 气泡（表情图形 + NPC 台词）
      for (var ei = 0; ei < state.emoteFx.length; ei++) {
        var rec = state.emoteFx[ei];
        if (now - rec.at > 4200) continue;
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
    }

    function loop(now) {
      if (!view.running) return;
      draw(now);
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
    MM_COLORS[T_SAND] = [148, 136, 108];
    MM_COLORS[T_STONE] = [104, 116, 138];
    MM_COLORS[T_DOCK] = [128, 100, 68];
    MM_COLORS[T_PATH] = [150, 138, 122];

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

    function addLamp(x, y, c) {
      state.lamps[x + ',' + y] = { x: x, y: y, c: c || '0' };
    }

    function addFlower(x, y, species, at, uid) {
      state.flowers[x + ',' + y] = { x: x, y: y, species: species, at: at, uid: uid || '' };
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
      else if (meteorNodeUnderMe()) key = 'meteor';
      else if (nodeUnderMe()) key = 'node';
      else if (steleNearMe()) key = 'stele';
      else if (tileUnderMe() === T_DOCK) key = 'dock';
      else if (tileUnderMe() === T_PATH) key = 'path';
      else if (tileUnderMe() === T_MEADOW) key = 'meadow';
      else if (state.meteor && state.meteor.active) key = 'meteorFar';
      var text = '';
      if (key === 'flying') text = '纸鸢掠过云海……';
      else if (key === 'fishing') text = '收线中……';
      else if (key === 'meteor') text = '脚下有一颗星陨，快按采集';
      else if (key === 'node') text = '脚下有星屑，按「采集」';
      else if (key === 'stele') text = '石碑就在脚边，按「触碑」唤醒它';
      else if (key === 'dock') text = '码头边可以「钓星」，也能搭纸鸢「快线」去别的岛';
      else if (key === 'path') text = '顺着石板路走，就不会迷路';
      else if (key === 'meadow') text = '草地上可以「种花」，它会一直开在这里';
      else if (key === 'meteorFar') text = '流星雨正落在' + (state.meteor.island || '远处') + '……';
      if (key !== lastHintKey) {
        lastHintKey = key;
        hint.textContent = text || '拖动左下摇杆漫步';
        if (key) hint.className = 'sg-hint is-on';
        else hint.className = 'sg-hint';
      }
    }

    function updateHud() {
      var shards = state.me.shards || 0;
      statOnline.textContent = state.onlineCount + ' 人在岛';
      statStage.textContent = (state.stageInfo && state.stageInfo.name) || '长夜';

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

      var canBuild = shards >= (state.lampCost || 3) && tileUnderMe() !== T_DOCK;
      var canPlant = shards >= (state.flowerCost || 2) && (tileUnderMe() === T_MEADOW || tileUnderMe() === T_PATH);
      var canFish = tileUnderMe() === T_DOCK;
      var canGather = nodeUnderMe() || meteorNodeUnderMe();

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

    function attemptMove(dx, dy) {
      if (!state.ready || flying) return;
      if (fishing) {
        fishing = null;
        toast('走动收回了鱼线');
        updateHint();
      }
      var nx = state.me.x + dx;
      var ny = state.me.y + dy;
      if (nx < 0 || ny < 0 || nx >= state.size || ny >= state.size) return;
      var idx = ny * state.size + nx;
      if (state.cells.charCodeAt(idx) === 48) {
        bump(dx, dy);
        return;
      }
      var now = Date.now();
      if (now - lastMoveAt < MOVE_GAP) return;
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
          return;
        }
        if (data.me) {
          state.me.x = data.me.x;
          state.me.y = data.me.y;
          state.me.dir = data.me.dir;
        }
        if (data.reveal) revealCells(data.reveal);
        updateHud();
      }).catch(function() {
        state.me.x = nx - dx;
        state.me.y = ny - dy;
        toast('网络有点慢，走不动了');
      });
    }

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
        if (tray.className.indexOf('is-open') !== -1) { tray.className = 'sg-tray'; return; }
        return;
      }
      if (sheet.hidden === false || modal.hidden === false || tutorial.hidden === false) return;
      var tag = e.target && e.target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      var dir = KEY_DIR[e.keyCode];
      if (!dir) return;
      e.preventDefault();
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
      var v = DIR_VEC[String(dir)];
      attemptMove(v[0], v[1]);
      stickTickStart();
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
      setStickDir(len >= deadPx ? pickDir(ox, oy) : -1);
    }

    function stickDown(e) {
      if (!state.ready || flying) return;
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

    function onCanvasClick(e) {
      if (!state.ready) return;
      if (sheet.hidden === false || modal.hidden === false) return;
      var rect = canvas.getBoundingClientRect();
      var wx = Math.floor((e.clientX - rect.left - view.ox) / view.tile);
      var wy = Math.floor((e.clientY - rect.top - view.oy) / view.tile);
      var dx = wx - state.me.x;
      var dy = wy - state.me.y;
      if (Math.abs(dx) + Math.abs(dy) === 1) attemptMove(dx, dy);
    }
    canvas.addEventListener('click', onCanvasClick);
    onDestroy(function() { canvas.removeEventListener('click', onCanvasClick); });

    // ---------- 动作 ----------

    function doGather() {
      if (!state.ready) return;
      var x = state.me.x;
      var y = state.me.y;
      if (!nodeUnderMe() && !meteorNodeUnderMe()) {
        toast('这里没有星屑，沿着光点再找找');
        return;
      }
      http('post', '/shiguang/gather', { x: x, y: y }).then(function(data) {
        if (!data) return;
        if (data.rejected) {
          if (data.rejected === 'cooldown') toast('这颗刚刚被采走了');
          else toast('脚下没有可采的星屑');
          return;
        }
        state.me.shards = data.shards;
        if (data.meteor) {
          delete state.meteorNodes[x + ',' + y];
          toast('拾到一颗星陨　共 ' + data.shards + ' 枚星屑', 'warm');
        } else {
          state.gathered[x + ',' + y] = Date.now();
          toast('+1 星屑　共 ' + data.shards + ' 枚');
        }
        if (data.reveal) revealCells(data.reveal);
        sfx.gather();
        updateHud();
      }).catch(function() { toast('采集失败，稍后再试'); });
    }

    function doBuild() {
      if (!state.ready) return;
      if ((state.me.shards || 0) < state.lampCost) {
        toast('还差 ' + (state.lampCost - state.me.shards) + ' 枚星屑');
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
        state.lampCount = data.lampCount;
        state.stage = data.stage;
        state.stageInfo = data.stageInfo;
        addLamp(x, y, state.me.lantern);
        if (data.reveal) revealCells(data.reveal);
        if (!data.dawn) toast('灯柱亮起，周围亮了一些', 'warm');
        sfx.build();
        updateHud();
      }).catch(function(err) {
        toast((err && err.message) || '点灯失败');
      });
    }

    function doPlant() {
      if (!state.ready) return;
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

    // 纸鸢快线：打开选岛面板
    function doFly() {
      if (!state.ready || flying) return;
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
    onDestroy(function() {
      btnGather.removeEventListener('click', doGather);
      btnBuild.removeEventListener('click', doBuild);
      btnPlant.removeEventListener('click', doPlant);
      btnFish.removeEventListener('click', doFish);
      btnFly.removeEventListener('click', doFly);
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
        // 光花
        for (var fk in state.flowers) {
          if (!Object.prototype.hasOwnProperty.call(state.flowers, fk)) continue;
          var f = state.flowers[fk];
          var fc = FLOWER_COLORS[f.species % FLOWER_COLORS.length];
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
        // 自己（最亮的金点）
        c.fillStyle = 'rgba(255, 226, 150, 1)';
        c.fillRect(state.me.x * k - 2, state.me.y * k - 2, k + 4, k + 4);
        c.fillStyle = '#ffffff';
        c.fillRect(state.me.x * k, state.me.y * k, k, k);
        // 岛名
        var isles = state.catalog.islands || [];
        c.font = canvasFont(9, false);
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        for (var ii = 0; ii < isles.length; ii++) {
          var is = isles[ii];
          var nm = is.name;
          var tw = c.measureText(nm).width;
          c.fillStyle = 'rgba(6, 10, 20, 0.55)';
          c.fillRect(is.cx * k - tw / 2 - 3, is.cy * k - 8, tw + 6, 13);
          c.fillStyle = 'rgba(240, 246, 255, 0.92)';
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
        ['走', '左下摇杆漫步（键盘 WASD 也行），石板路会带你逛遍八座岛。'],
        ['捡', '闪烁的菱形是星屑。站上去按「采集」，90 秒后原地重生。'],
        ['点', '攒够 3 枚星屑原地「点灯」。灯柱是「你的颜色」，全班永久可见。'],
        ['花', '草地和路边可「种花」（2 星屑）。花会破土、含苞、盛开，永远开在那里。'],
        ['钓', '码头上「钓星」。每座岛的码头有自己的特产鱼，传说级全岛播报。'],
        ['飞', '码头边按「快线」搭纸鸢跨岛（2 星屑），落地自动点亮周围。'],
        ['碑', '八岛间藏着五座石碑。走近按「触碑」唤醒（+5 星屑），集齐五座全班解锁秘境。'],
        ['雨', '流星雨不定时落在某座岛上，星陨比星屑更值得抢。'],
        ['伴', '岛上有居民（提灯守夜的人）。走近他们会跟你搭话。']
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
      tRow.appendChild(el('span', null, '重看新手引导'));
      tRow.addEventListener('click', function() {
        closeSheet();
        setTimeout(tutorialStart, 260);
      });
      sheetBody.appendChild(tRow);

      sheetBody.appendChild(el('div', 'sg-tip', '拾光群岛 v3.0 · 160×160 八岛大世界 · 素材致谢 Kenney（CC0）· 世界状态由服务端权威保存'));
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

    function tutorialStart() {
      tIdx = 0;
      syncTutorial();
      tutorial.hidden = false;
      tutorial.className = 'sg-tutorial is-open';
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
            addLamp(lampRec[0], lampRec[1], lampRec[2]);
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
        for (var l = 0; l < data.lamps.length; l++) addLamp(data.lamps[l].x, data.lamps[l].y, data.lamps[l].c);
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
            addFlower(f.x, f.y, f.species, f.created_at, f.user_id);
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

    var sizeGuard = setInterval(resize, 900);
    onDestroy(function() { clearInterval(sizeGuard); });

    // ---------- 启动 ----------
    resize();

    function loadTerrain() {
      var cached = null;
      try { cached = storage.get('terrain', null); } catch (e) { cached = null; }
      var fresh = cached && cached.cells && cached.nodes && cached.version ? cached : null;
      // 1 小时内的缓存直接用（v2 的 24h 曾让旧地形在版本升级后多活一天）；
      // 拉取失败时退回缓存兜底 —— 26KB gzip 后不到 3KB，不值得为此省流量。
      if (fresh && fresh.at && Date.now() - fresh.at < 3600000) {
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
      view.camX = state.me.x + 0.5;
      view.camY = state.me.y + 0.5;

      applyExplored(data.explored);

      state.lamps = {};
      if (data.lamps) {
        for (var i = 0; i < data.lamps.length; i++) addLamp(data.lamps[i].x, data.lamps[i].y, data.lamps[i].c);
      }
      state.flowers = {};
      if (data.flowers) {
        for (var fl = 0; fl < data.flowers.length; fl++) {
          var f = data.flowers[fl];
          addFlower(f.x, f.y, f.species, f.created_at, f.user_id);
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
        state.size = terrain.size || 160;
        state.cells = terrain.cells || '';
        state.nodes = terrain.nodes || '';
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
          setTimeout(tutorialStart, 700);
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
