// 拾光群岛 —— 世界地形（服务端权威）v3 · 大世界
//
// 设计要点：
//   1. 地形是纯函数：同样的输入永远得到同样的群岛。前端不重算，只在首次进入时
//      从 /api/shiguang/terrain 取一次并缓存在 localStorage —— 两端只有一份实现，
//      不会出现「客户端以为能走、服务端判定云海」的错位。
//   2. 传输格式是每格一个字符的字符串（'0'~'5'），160×160 共 25600 字符。
//      直接 JSON 约 26KB，gzip 后约 2KB（大片重复字符），比逐格对象小两个数量级。
//   3. 八座岛 + 一张云桥网：中央岛（启明）向外辐射六条桥，外岛之间再补两条环线，
//      保证任何陆地格都在同一个连通分量里 —— 不会有人被生成在孤岛上。
//   4. 码头（T_DOCK）：每岛一条朝外延伸进云海的木栈道，钓星玩法唯一的立足点。
//      码头不是手摆坐标，而是从岛心沿固定方向扫描到的：先找到云海开始的那一格，
//      再把紧随其后的 3~4 格铺成栈道。岛缘受正弦扰动会漂 ±10%，手摆坐标迟早对不上。
//   5. 石板路（T_PATH）：每岛的「码头 → 岛心」一条主路 + 启明岛十字大道。
//      路不是玩法判定，是世界的骨架 —— 玩家顺着路走就不会迷路，画面也不再是空草地。
//   6. 地标与石碑：灯塔 / 陨星坑 / 巨树 / 蘑菇环 / 贝壳拱门 / 潮池 / 花田之心 / 霜岩
//      全部是确定性坐标（客户端绘制），石碑另有服务端激活状态。
'use strict';

var SIZE = 160;

// 地形编码：与前端渲染一一对应，改这里必须同步改 frontend/entry.js 的 TILE 常量
var CLOUD = 0;   // 云海，不可通行
var MEADOW = 1;  // 岛内草地（唯一可以种光花的地面）
var SAND = 2;    // 岸边沙地 / 云桥
var STONE = 3;   // 高地岩层
var DOCK = 4;    // 云海码头木栈道（可走，可钓星，不可种花/点灯）
var PATH = 5;    // 石板路（可走，可种花 —— 路边开一排花很好看）
var LAKE = 6;    // 岛内静水（不可走、不可点灯；视觉上是深色水面）

// 群岛：cx/cy 是岛心，r 是基准半径，biome 决定客户端调色，dock 是码头延伸方向。
// 半径与间距都留足了呼吸感：最近的两个岛心距也要 > r1 + r2 + 6，
// 否则两岛的沙环会在云桥之外又黏在一起。
// 每座岛都是 lobes（多个偏移圆的并集），不是一个正圆。
//
// ⚠️ 上一版全部走 `dist <= r * (0.90 + 0.07sin + 0.05cos)` —— 半径只差 ±12%，
// 从高空看是「八个圆」。玩家在岛上走一圈感受不到任何地形变化，
// 这就是「地图无聊」的几何原因：不是素材不够，是**形状没有信息量**。
//
// lobes 里 dx/dy 是相对岛心的偏移（单位 = r 的倍数），r 是该瓣的半径倍数。
// 主瓣在 (0,0)，其余瓣负责长出半岛、地峡、内湾 —— 每座岛的轮廓必须能一眼认出：
//   启明 = 星形（西北+东南两条长臂）    雾隐 = 月牙（西侧长臂环抱内湾）
//   星坠 = 葫芦（南侧一个圆瘤）          拾贝 = 钩子（东臂上扬、南侧尖角）
//   萤火泽 = 三叶                        织花谷 = 水滴（东北长尾）
//   望潮 = 哑铃（南北两个圆瘤）          霜屿 = 小卵石（东侧微凸）
// lakes 是岛内静水，只在岛的核心区（depth > 0.34）生效，保证不会把岛切断。
var ISLANDS = [
  { cx: 80, cy: 88, r: 24, biome: 'meadow',  name: '启明岛', dock: 'S',   // 中央枢纽
    lobes: [
      { dx: 0.00, dy: 0.00, r: 0.94 },
      { dx: -0.66, dy: -0.30, r: 0.56 },
      { dx: 0.58, dy: 0.42, r: 0.52 },
      { dx: 0.22, dy: -0.66, r: 0.40 }
    ],
    lakes: [ { dx: -0.26, dy: 0.46, r: 0.20 } ] },

  { cx: 34, cy: 34, r: 18, biome: 'mist',    name: '雾隐岛', dock: 'N',
    lobes: [
      { dx: 0.08, dy: 0.06, r: 0.72 },
      { dx: -0.64, dy: -0.06, r: 0.50 },
      { dx: -0.34, dy: 0.52, r: 0.40 },
      { dx: 0.30, dy: -0.48, r: 0.38 }
    ] },

  { cx: 124, cy: 30, r: 16, biome: 'stone',  name: '星坠岛', dock: 'E',
    lobes: [
      { dx: -0.06, dy: -0.10, r: 0.82 },
      { dx: 0.10, dy: 0.62, r: 0.48 },
      { dx: -0.44, dy: 0.18, r: 0.34 }
    ] },

  { cx: 30, cy: 116, r: 16, biome: 'beach',  name: '拾贝岛', dock: 'W',
    lobes: [
      { dx: -0.10, dy: 0.00, r: 0.74 },
      { dx: 0.62, dy: -0.30, r: 0.42 },
      { dx: 0.10, dy: 0.58, r: 0.34 }
    ] },

  { cx: 58, cy: 132, r: 15, biome: 'marsh',  name: '萤火泽', dock: 'S',
    lobes: [
      { dx: 0.00, dy: -0.10, r: 0.66 },
      { dx: -0.48, dy: 0.40, r: 0.42 },
      { dx: 0.46, dy: 0.34, r: 0.40 }
    ],
    lakes: [ { dx: 0.00, dy: 0.06, r: 0.20 } ] },

  { cx: 112, cy: 70, r: 15, biome: 'flower', name: '织花谷', dock: 'E',
    lobes: [
      { dx: -0.08, dy: 0.06, r: 0.76 },
      { dx: 0.50, dy: -0.50, r: 0.46 },
      { dx: -0.44, dy: -0.22, r: 0.34 }
    ] },

  { cx: 130, cy: 124, r: 16, biome: 'coral', name: '望潮岛', dock: 'S',
    lobes: [
      { dx: -0.04, dy: 0.02, r: 0.62 },
      { dx: -0.12, dy: -0.64, r: 0.40 },
      { dx: 0.46, dy: 0.50, r: 0.42 }
    ] },

  { cx: 78, cy: 14, r: 12, biome: 'frost',   name: '霜屿',   dock: 'E',
    lobes: [
      { dx: -0.10, dy: 0.00, r: 0.82 },
      { dx: 0.54, dy: 0.18, r: 0.38 }
    ] }
];

// 云桥网：中央岛向外辐射 + 两条外岛环线。全部落在开阔云海上，不穿过岛体。
var BRIDGES = [
  [[80, 88], [34, 34]],      // 启明 → 雾隐
  [[80, 88], [124, 30]],     // 启明 → 星坠
  [[80, 88], [30, 116]],     // 启明 → 拾贝
  [[80, 88], [58, 132]],     // 启明 → 萤火泽
  [[80, 88], [112, 70]],     // 启明 → 织花谷
  [[80, 88], [130, 124]],    // 启明 → 望潮
  [[34, 34], [78, 14]],      // 雾隐 → 霜屿（外环）
  [[30, 116], [58, 132]]     // 拾贝 → 萤火泽（外环）
];

var TERRAIN_VERSION = 'v4';
// 出生点在主岛南侧大道路口：站定后北望是灯火与大道，南望两三格就是海岸线。
// 出生点放在主路与横路的十字路口上，正北 8 格就是拾光灯塔。
//
// 原来是 y=98 —— 站在一条没有尽头的路中段，北边 18 格外的灯塔
// 永远在视野外。玩家睁开眼看到的是一片草地，不是「我要去那儿」。
// 8 格是刻意的：22 格高的视野能同时装下人和灯塔，
// 而路本身又把两者连起来，第一眼就有方向。
var SPAWN = { x: 80, y: 88 };

// 32 位整数哈希 → [0,1)。用于海岸线扰动、星屑分布、装饰点缀。
// 必须走 Math.imul：JS 的普通乘法在超过 2^53 后会丢低位，
// 导致「同一行的哈希值几乎相同」—— 视觉上就是整片地形织出横向条纹。
function hash2(x, y, seed) {
  var h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(seed | 0, 362437)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h = h ^ (h >>> 16);
  return (h >>> 0) / 4294967296;
}

// 点到线段的距离平方 —— 云桥与石板路都用「线段距离场」铺出来
function distToSegmentSq(px, py, ax, ay, bx, by) {
  var dx = bx - ax;
  var dy = by - ay;
  var lenSq = dx * dx + dy * dy;
  var t = 0;
  if (lenSq > 0) {
    t = ((px - ax) * (dx) + (py - ay) * (dy)) / lenSq;
    if (t < 0) t = 0;
    else if (t > 1) t = 1;
  }
  var qx = ax + t * dx;
  var qy = ay + t * dy;
  return (px - qx) * (px - qx) + (py - qy) * (py - qy);
}

function inBounds(x, y) {
  return x >= 0 && y >= 0 && x < SIZE && y < SIZE;
}

// 码头：模块加载时扫描一次，得到每座岛的栈道格。
var DOCK_LEN = 4;
var DOCK_MIN = 3;
var DOCK_DIRS = { N: [0, -1], S: [0, 1], E: [1, 0], W: [-1, 0] };
var dockTiles = [];        // [{x, y, island}] 按岛排列
var dockMap = {};          // 'x,y' -> island index

// 石板路：码头根部 → 岛心的一条主路 + 启明岛十字大道。
// 路宽：半径 1.15 格 ⇒ 直径 2.3 格。
// 上一版 0.85（1.7 格宽）在 27 格视野里只有 62px，走上去像一条裂缝，
// 玩家根本认不出「这是一条路」。2.3 格刚好容一个角色居中、两侧还有余量。
// 半宽 0.92 → 路面 1.84 格。
// 2.3 格我试过：加上 0.75 格的模糊，实际铺开接近 3.8 格，
// 在 30px/格的缩放下是一条 110px 宽的褐色宽带，读起来是泥浆不是路。
var PATH_HALF_WIDTH_SQ = 0.92 * 0.92;
var PATHS = [];   // [{ax,ay,bx,by,isle}]

// 地标（客户端绘制，服务端只关心石碑）：
var LANDMARKS = [
  { key: 'lighthouse', name: '拾光灯塔', x: 80, y: 80, isle: 0 },
  { key: 'crater',     name: '星陨坑',   x: 124, y: 30, isle: 2 },
  { key: 'greattree',  name: '雾隐巨树', x: 34, y: 32, isle: 1 },
  { key: 'shrooms',    name: '萤光环',   x: 58, y: 130, isle: 4 },
  { key: 'shellarch',  name: '贝壳拱门', x: 30, y: 114, isle: 3 },
  { key: 'tidepool',   name: '望潮池',   x: 130, y: 122, isle: 6 },
  { key: 'windmill',   name: '织花风车', x: 112, y: 68, isle: 5 },
  { key: 'frostone',   name: '霜岩',     x: 78, y: 13, isle: 7 }
];

// 石碑：五座，散在五座主要岛上。全部激活触发「秘境之门」全服事件。
var STELES = [
  { x: 86, y: 96, name: '启明之碑', isle: 0, rune: '初火不灭，灯塔自明。' },
  { x: 30, y: 30, name: '雾隐之碑', isle: 1, rune: '雾散之处，巨树记得每一个名字。' },
  { x: 128, y: 34, name: '星坠之碑', isle: 2, rune: '那颗星落下来的时候，海是甜的。' },
  { x: 34, y: 112, name: '拾贝之碑', isle: 3, rune: '潮水带走字条，带走不了惦记。' },
  { x: 134, y: 128, name: '望潮之碑', isle: 6, rune: '灯塔亮到第七夜，鲸群会来看你们。' }
];

// ---------------------------------------------------------------------------
// 岛的形状（多圆并集）
//
// 返回归一化深度：> 0 在陆地上（数值越大越靠内陆），<= 0 是海。
// 用「归一化深度」而不是「到岛心的距离 / 半径」有两个好处：
//   1. 多瓣形状自动成立 —— 取所有瓣里最深的那个，地峡与内湾自然长出来；
//   2. 沙环宽度可以按 depth 切，于是半岛尖端沙地窄、宽阔处沙地宽，
//      这是真实海岸的规律，也是「看起来像岛」和「看起来像圆」的分水岭。
// ---------------------------------------------------------------------------
function islandDepth(x, y, island) {
  var best = -9;
  var lobes = island.lobes;
  for (var i = 0; i < lobes.length; i++) {
    var L = lobes[i];
    var lx = island.cx + L.dx * island.r;
    var ly = island.cy + L.dy * island.r;
    var rr = L.r * island.r;
    var dx = x - lx;
    var dy = y - ly;
    var d2 = dx * dx + dy * dy;
    // 距离超过 1.3r 的瓣不可能成为最深瓣，跳过开方（25600 格 × 8 岛 × 4 瓣）
    if (d2 > rr * rr * 1.69) continue;
    // 海岸扰动：三个不同波长叠加 —— 湾角（~23 格）/ 岬角（~26 格）/ 细碎岸线（~10 格）
    var wob = 0.94
      + 0.075 * Math.sin(x * 0.27 + y * 0.12 + island.cx * 0.09)
      + 0.055 * Math.cos(y * 0.24 - x * 0.14 + island.cy * 0.06)
      + 0.032 * Math.sin(x * 0.62 + y * 0.55 + island.cx * 0.31);
    var depth = 1 - Math.sqrt(d2) / (rr * wob);
    if (depth > best) best = depth;
  }
  return best;
}

function inLake(x, y, island) {
  if (!island.lakes) return false;
  for (var i = 0; i < island.lakes.length; i++) {
    var L = island.lakes[i];
    var lx = island.cx + L.dx * island.r;
    var ly = island.cy + L.dy * island.r;
    var rr = L.r * island.r;
    var dx = x - lx;
    var dy = y - ly;
    if (dx * dx + dy * dy <= rr * rr) return true;
  }
  return false;
}

// 沙环厚度：depth 从 0 到 SAND_DEPTH 是沙滩，以内是内陆。
// 0.13 ≈ 半径的 13%（主岛约 3 格，小岛约 1.6 格），比原来窄了一档 ——
// 上一版 10% 的沙环在 24 格半径上是 2.4 格宽，走起来像「一圈白色跑道」。
var SAND_DEPTH = 0.13;

(function buildDocksAndPaths() {
  function key2(x, y) { return x + ',' + y; }

  // 与 tileAt 相同的「未铺码头时」的地形判定：只在扫描期使用。
  // 单独存在是为了避免递归 —— tileAt 要查 dockMap，而 dockMap 还没建完。
  function baseLandAt(x, y) {
    if (!inBounds(x, y)) return CLOUD;
    if (x < 3 || y < 3 || x >= SIZE - 3 || y >= SIZE - 3) return CLOUD;
    for (var n = 0; n < ISLANDS.length; n++) {
      var island2 = ISLANDS[n];
      if (islandDepth(x, y, island2) <= 0) continue;
      return island2.biome === 'stone' || island2.biome === 'coral' || island2.biome === 'frost' ? STONE : MEADOW;
    }
    for (var m = 0; m < BRIDGES.length; m++) {
      var seg = BRIDGES[m];
      if (distToSegmentSq(x, y, seg[0][0], seg[0][1], seg[1][0], seg[1][1]) <= 1.75 * 1.75) return SAND;
    }
    return CLOUD;
  }

  for (var i = 0; i < ISLANDS.length; i++) {
    var island = ISLANDS[i];
    var d = DOCK_DIRS[island.dock] || DOCK_DIRS.S;
    // 从岛心出发沿 dock 方向走，找到第一个云海格（即海岸线外沿）
    var x = island.cx;
    var y = island.cy;
    var steps = 0;
    var limit = island.r * 2 + 6;
    while (steps < limit) {
      var nx = x + d[0];
      var ny = y + d[1];
      if (!inBounds(nx, ny) || baseLandAt(nx, ny) === CLOUD) break;
      x = nx;
      y = ny;
      steps++;
    }
    // 从云海的第一格起铺栈道，最多 4 格；海岸扰动会吃掉一两格，
    // 收 3 格也建（>= DOCK_MIN），凑不满 3 格的整条放弃。
    var placed = [];
    for (var k = 1; k <= DOCK_LEN; k++) {
      var tx = x + d[0] * k;
      var ty = y + d[1] * k;
      if (!inBounds(tx, ty) || tx < 3 || ty < 3 || tx >= SIZE - 3 || ty >= SIZE - 3) break;
      placed.push({ x: tx, y: ty, island: i });
    }
    if (placed.length >= DOCK_MIN) {
      for (var j = 0; j < placed.length; j++) {
        dockTiles.push(placed[j]);
        dockMap[key2(placed[j].x, placed[j].y)] = i;
      }
      island._dockHead = { x: x, y: y };   // 栈道根部（最后一格陆地）
      // 主路：码头根部 → 岛心。中途插一个哈希偏移的拐点 ——
      // 两点之间直铺一段的路，在俯视图里就是一条用尺子画的线，八座岛一模一样。
      // 拐点让每座岛的路各有走向，也让「路」读起来像人走出来的。
      var midX = (x + island.cx) * 0.5 + (hash2(i, 3, 91) - 0.5) * island.r * 0.62;
      var midY = (y + island.cy) * 0.5 + (hash2(i, 7, 93) - 0.5) * island.r * 0.62;
      PATHS.push({ ax: x, ay: y, bx: midX, by: midY, isle: i });
      PATHS.push({ ax: midX, ay: midY, bx: island.cx, by: island.cy, isle: i });
    }
  }

  // 启明岛村道：一条主街 + 四条斜支路，不是十字大道。
  //
  // ⚠️ 上一版是 44 格长的正交十字（80,66→80,110 / 58,88→102,88）。
  // 俯视看是两条一直通到画外的宽带，配上 2.3 格路面，就是一架飞机跑道 ——
  // 「城镇骨架」没做出来，先做出来一条高速公路。
  //
  // 现在南北主街只从灯塔脚下通到村口、再通到南岸；
  // 东西方向拆成两条斜向支路，各自再拐一次弯，分别接西北民居和东南小店。
  PATHS.push({ ax: 80, ay: 81, bx: 80, by: 88, isle: 0 });   // 灯塔脚下 → 村口
  PATHS.push({ ax: 80, ay: 88, bx: 80, by: 110, isle: 0 });  // 村口 → 南岸
  PATHS.push({ ax: 80, ay: 88, bx: 73, by: 84, isle: 0 });   // 西北支路
  PATHS.push({ ax: 73, ay: 84, bx: 64, by: 80, isle: 0 });
  PATHS.push({ ax: 80, ay: 88, bx: 89, by: 92, isle: 0 });   // 东南支路
  PATHS.push({ ax: 89, ay: 92, bx: 99, by: 95, isle: 0 });
})();

// 单格地形。纯函数，无副作用，可被反复调用。
function tileAt(x, y) {
  if (!inBounds(x, y)) return CLOUD;
  // 码头架在云海之上，优先于一切判定（岛缘扫描保证它不会压到陆地格）
  if (dockMap.hasOwnProperty(x + ',' + y)) return DOCK;

  // 世界边缘三格强制云海：视觉上「世界在此断掉」，也避免玩家走到数组边界
  if (x < 3 || y < 3 || x >= SIZE - 3 || y >= SIZE - 3) return CLOUD;

  var i;
  var landIsle = -1;
  var landDepth = -9;
  var landKind = CLOUD;
  for (i = 0; i < ISLANDS.length; i++) {
    var island = ISLANDS[i];
    var depth = islandDepth(x, y, island);
    if (depth <= 0) continue;
    landIsle = i;
    landDepth = depth;
    landKind = depth <= SAND_DEPTH ? SAND
      : ((island.biome === 'stone' || island.biome === 'coral' || island.biome === 'frost') ? STONE : MEADOW);
    break;   // 岛间距足够远，第一个命中即唯一命中
  }

  if (landIsle < 0) {
    // 云桥：线段距离 ≤ 1.75 格
    for (i = 0; i < BRIDGES.length; i++) {
      var seg = BRIDGES[i];
      if (distToSegmentSq(x, y, seg[0][0], seg[0][1], seg[1][0], seg[1][1]) <= 1.75 * 1.75) return SAND;
    }
    return CLOUD;
  }

  // 岛内静水：depth > 0.34 才允许成湖 —— 湖心必须深在内陆，
  // 否则一个偏心的湖可能正好压在细地峡上，把岛切成两半、把玩家关在里面。
  if (landDepth > 0.34 && inLake(x, y, ISLANDS[landIsle])) return LAKE;

  // 石板路：只铺在岛内内陆上（沙环以内），压过草地与岩层。
  if (landKind !== SAND) {
    for (i = 0; i < PATHS.length; i++) {
      var p = PATHS[i];
      if (p.isle !== landIsle) continue;
      if (distToSegmentSq(x, y, p.ax, p.ay, p.bx, p.by) <= PATH_HALF_WIDTH_SQ) return PATH;
    }
  }

  return landKind;
}

// 整张地形压成字符串，索引 = y * SIZE + x
var cachedCells = null;
function terrainCells() {
  if (cachedCells) return cachedCells;
  var out = [];
  for (var y = 0; y < SIZE; y++) {
    for (var x = 0; x < SIZE; x++) {
      out.push(String(tileAt(x, y)));
    }
  }
  cachedCells = out.join('');
  return cachedCells;
}

function walkable(x, y) {
  var t = tileAt(x, y);
  return t !== CLOUD && t !== LAKE;
}

// 星屑节点：确定性分布。码头与广场不生成（栈道上挂光点像灯串，广场上像碎玻璃）。
// 阈值 0.05 → 全图约 300 个，四倍大的世界仍保有「走几步遇到一颗」的密度。
function hasNode(x, y) {
  if (!walkable(x, y)) return false;
  var t = tileAt(x, y);
  if (t === DOCK || t === PATH || t === LAKE) return false;
  return hash2(x, y, 7) < 0.05;
}

// 节点分布位图：与地形一起下发给前端。
var cachedNodeBits = null;
function nodeBits() {
  if (cachedNodeBits) return cachedNodeBits;
  var out = [];
  for (var y = 0; y < SIZE; y++) {
    for (var x = 0; x < SIZE; x++) {
      out.push(hasNode(x, y) ? '1' : '0');
    }
  }
  cachedNodeBits = out.join('');
  return cachedNodeBits;
}

// 岛名判定：落在岛半径内。云桥与码头返回空 —— 站在桥上不属于任何岛。
function islandNameAt(x, y) {
  for (var i = 0; i < ISLANDS.length; i++) {
    if (islandDepth(x, y, ISLANDS[i]) > 0) return ISLANDS[i].name;
  }
  return '';
}

// 石碑判定：最近的石碑与距离（供 /stele 的「走近才能触碰」校验）
function nearestStele(x, y) {
  var best = null;
  var bestD = 1e9;
  for (var i = 0; i < STELES.length; i++) {
    var s = STELES[i];
    var dx = x - s.x;
    var dy = y - s.y;
    var d = dx * dx + dy * dy;
    if (d < bestD) { bestD = d; best = s; }
  }
  return { stele: best, distSq: bestD };
}

// 找离 (x,y) 最近的可行走格：出生点被占或落在云海时的兜底。
function nearestWalkable(x, y) {
  if (walkable(x, y)) return { x: x, y: y };
  for (var r = 1; r <= 14; r++) {
    for (var dy = -r; dy <= r; dy++) {
      for (var dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        if (walkable(x + dx, y + dy)) return { x: x + dx, y: y + dy };
      }
    }
  }
  return { x: SPAWN.x, y: SPAWN.y };
}

// 曼哈顿距离 —— 四向移动的合法半径是 1
function stepDistance(ax, ay, bx, by) {
  return Math.abs(ax - bx) + Math.abs(ay - by);
}

// 以 (cx,cy) 为心、半径 r 内随机挑可走格（供流星雨撒临时星陨）
function walkableInRadius(cx, cy, r) {
  var out = [];
  for (var y = Math.max(3, cy - r); y <= Math.min(SIZE - 4, cy + r); y++) {
    for (var x = Math.max(3, cx - r); x <= Math.min(SIZE - 4, cx + r); x++) {
      var ddx = x - cx, ddy = y - cy;
      if (ddx * ddx + ddy * ddy > r * r) continue;
      if (walkable(x, y) && tileAt(x, y) !== DOCK) out.push({ x: x, y: y });
    }
  }
  return out;
}

module.exports = {
  SIZE: SIZE,
  SPAWN: SPAWN,
  TERRAIN_VERSION: TERRAIN_VERSION,
  TILE: { CLOUD: CLOUD, MEADOW: MEADOW, SAND: SAND, STONE: STONE, DOCK: DOCK, PATH: PATH, LAKE: LAKE },
  hash2: hash2,
  islandDepth: islandDepth,
  tileAt: tileAt,
  terrainCells: terrainCells,
  nodeBits: nodeBits,
  walkable: walkable,
  hasNode: hasNode,
  nearestWalkable: nearestWalkable,
  stepDistance: stepDistance,
  islandNameAt: islandNameAt,
  nearestStele: nearestStele,
  walkableInRadius: walkableInRadius,
  dockTiles: dockTiles,
  dockMap: dockMap,
  PATHS: PATHS,
  LANDMARKS: LANDMARKS,
  STELES: STELES,
  ISLANDS: ISLANDS
};
