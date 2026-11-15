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
