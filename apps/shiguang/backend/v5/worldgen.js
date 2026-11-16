// 拾光群岛 v5「长夜」—— 世界生成（纯函数，服务端权威，前端拿同一份结果渲染）
//
// 布局：世界中心是拾光镇，六个区按「环」向外铺开，但不是同心圆 —— 每个区占一个扇区
// 的一段环带，用域扭曲噪声打乱边界，看起来像自然地貌而不是靶子。
//   ring 1 晨光草原：全方向围着镇子（新手区，出门就是）
//   ring 2+ 雾隐林 / 萤火泽 / 星坠岩 / 霜屿：各占一个扇区，越往外越难
//   长夜之心：世界东北角的终局区
// 地形编码见 TILE。传输：每格一个字符（base36），256×256 = 65536 字符，gzip 后 ~6KB。
'use strict';

var C = require('./config');
var SIZE = C.WORLD_SIZE;

var TILE = {
  WATER: 0,     // 深水（不可走）
  GRASS: 1,     // 草地
  SAND: 2,      // 沙地 / 岸
  DIRT: 3,      // 泥土路
  STONE: 4,     // 岩地
  SNOW: 5,      // 雪地
  SWAMP: 6,     // 沼泽地（可走，减速）
  TREE: 7,      // 树（不可走，可遮挡）
  ROCK: 8,      // 岩石（不可走）
  WALL: 9,      // 建筑墙（不可走）
  FLOOR: 10,    // 镇内铺地
  BRIDGE: 11,   // 木桥
  DARK: 12,     // 长夜之地
  ICE: 13,      // 冰面（可走，滑）
  FLOWER: 14,   // 花丛（可走，装饰）
  SHALLOW: 15,  // 浅水（可走，减速）
  CLIFF: 16,    // 崖壁（不可走）
  PINE: 17,     // 雪松（不可走）
  DEADTREE: 18  // 枯树（不可走）
};

var BLOCK = {};
[TILE.WATER, TILE.TREE, TILE.ROCK, TILE.WALL, TILE.CLIFF, TILE.PINE, TILE.DEADTREE].forEach(function (t) { BLOCK[t] = 1; });

// ---------------- 确定性噪声 ----------------
var SEED = 20261115;
function hash2(x, y, s) {
  var h = (x * 374761393 + y * 668265263 + (s || SEED) * 2147483647) | 0;
  h = (h ^ (h >>> 13)) * 1274126177 | 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function smooth(t) { return t * t * (3 - 2 * t); }
function vnoise(x, y, s) {
  var xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  var a = hash2(xi, yi, s), b = hash2(xi + 1, yi, s), c = hash2(xi, yi + 1, s), d = hash2(xi + 1, yi + 1, s);
  var u = smooth(xf), v = smooth(yf);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm(x, y, s, oct) {
  var t = 0, amp = 0.5, f = 1, n = 0;
  for (var i = 0; i < (oct || 4); i++) { t += vnoise(x * f, y * f, s + i * 17) * amp; n += amp; amp *= 0.5; f *= 2; }
  return t / n;
}

// ---------------- 区域布局 ----------------
var CX = SIZE / 2, CY = SIZE / 2;
var TOWN_R = 14;        // 镇子半径（17 格见方：一屏能看全，这是「家」的最低要求）
var MEADOW_R = 74;      // 草原外沿
// 外环四个扇区（角度：0 = 东，逆时针为正 —— 屏幕坐标 y 向下，所以 atan2(-dy, dx)）
// 长夜之心不在扇区里，是东北角的一块飞地，从霜屿与星坠岩之间的峡谷进入。
var SECTORS = [
  { zone: 'forest', a0: 100, a1: 200 },  // 西北 → 西
  { zone: 'swamp',  a0: 200, a1: 290 },  // 西南 → 南
  { zone: 'crag',   a0: 290, a1: 360 },  // 东南
  { zone: 'frost',  a0: 0,   a1: 100 }   // 东 → 北
];
var ABYSS = { x: 321, y: 63, r: 45 };

function angleDeg(dx, dy) {
  var a = Math.atan2(-dy, dx) * 180 / Math.PI;
  return a < 0 ? a + 360 : a;
}

// 返回某格属于哪个区（字符串 id）。边界用噪声扭曲。
function zoneAt(x, y) {
  var dx = x - CX, dy = y - CY;
  var warp = (fbm(x * 0.045, y * 0.045, 91, 3) - 0.5) * 18;
  var d = Math.sqrt(dx * dx + dy * dy) + warp;
  var ax = x - ABYSS.x, ay = y - ABYSS.y;
  if (Math.sqrt(ax * ax + ay * ay) + warp * 0.6 < ABYSS.r) return 'abyss';
  if (d < TOWN_R) return 'town';
  if (d < MEADOW_R) return 'meadow';
  var a = angleDeg(dx, dy) + (fbm(x * 0.03, y * 0.03, 37, 3) - 0.5) * 30;
  a = (a + 360) % 360;
  for (var i = 0; i < SECTORS.length; i++) {
    var s = SECTORS[i];
    if (a >= s.a0 && a < s.a1) return s.zone;
  }
  return 'frost';
}

// ---------------- 地标（确定性坐标）----------------
// 每个区：灯塔（守护者在这里）、传送石、宝箱、洞窟、NPC。
// 坐标是「区中心 + 偏移」算出来的，保证落在区内。
function polar(deg, r) {
  var a = deg * Math.PI / 180;
  return { x: Math.round(CX + Math.cos(a) * r), y: Math.round(CY - Math.sin(a) * r) };
}
var ZONE_CENTER = {
  town: { x: CX, y: CY },
  meadow: polar(250, 51),
  forest: polar(150, 132),
  swamp: polar(245, 135),
  crag: polar(325, 132),
  frost: polar(45, 129),
  abyss: { x: ABYSS.x, y: ABYSS.y }
};

function buildLandmarks() {
  var L = { towers: {}, waystones: [], chests: [], caves: [], npcs: [], camps: [], shrines: [], relics: [], nights: [] };
  // 区域灯塔（守护者 Boss 的场地）
  L.towers.meadow = polar(300, 57);
  L.towers.forest = polar(150, 156);
  L.towers.swamp = polar(240, 159);
  L.towers.crag = polar(322, 156);
  L.towers.frost = polar(50, 156);
  L.towers.abyss = { x: ABYSS.x + 4, y: ABYSS.y - 4 };
  // 传送石：每区一块，靠近从镇子过来的入口
  L.waystones.push({ id: 'ws_town', x: CX + 3, y: CY + 6, zone: 'town' });
  L.waystones.push({ id: 'ws_meadow', x: polar(120, 54).x, y: polar(120, 54).y, zone: 'meadow' });
  L.waystones.push({ id: 'ws_forest', x: polar(150, 96).x, y: polar(150, 96).y, zone: 'forest' });
  L.waystones.push({ id: 'ws_swamp', x: polar(245, 96).x, y: polar(245, 96).y, zone: 'swamp' });
  L.waystones.push({ id: 'ws_crag', x: polar(325, 96).x, y: polar(325, 96).y, zone: 'crag' });
  L.waystones.push({ id: 'ws_frost', x: polar(45, 96).x, y: polar(45, 96).y, zone: 'frost' });
  L.waystones.push({ id: 'ws_abyss', x: ABYSS.x - 18, y: ABYSS.y + 16, zone: 'abyss' });
  // 洞窟：每区一处，位置贴着灯塔外侧（玩家打到灯塔时顺路就能看见洞口）
  var caveAt = {
    meadow: polar(288, 69), forest: polar(168, 144), swamp: polar(258, 147),
    crag: polar(338, 144), frost: polar(32, 144), abyss: { x: ABYSS.x + 18, y: ABYSS.y + 15 }
  };
  Object.keys(caveAt).forEach(function (z) {
    L.caves.push({ id: 'cave_' + z, zone: z, x: caveAt[z].x, y: caveAt[z].y });
  });
  return L;
}

// ---------------- 生成 ----------------
function generate() {
  var grid = new Uint8Array(SIZE * SIZE);
  var zones = new Uint8Array(SIZE * SIZE);
  var ZONE_IDX = { town: 0, meadow: 1, forest: 2, swamp: 3, crag: 4, frost: 5, abyss: 6 };
  var landmarks = buildLandmarks();

  for (var y = 0; y < SIZE; y++) {
    for (var x = 0; x < SIZE; x++) {
      var i = y * SIZE + x;
      var z = zoneAt(x, y);
      zones[i] = ZONE_IDX[z];
      // 世界边缘是海
      var edge = Math.min(x, y, SIZE - 1 - x, SIZE - 1 - y);
      var coast = edge + (fbm(x * 0.08, y * 0.08, 5, 3) - 0.5) * 10;
      if (coast < 5) { grid[i] = TILE.WATER; continue; }
      if (coast < 8) { grid[i] = TILE.SAND; continue; }

      var n = fbm(x * 0.09, y * 0.09, 11, 4);     // 植被密度
      var m = fbm(x * 0.05, y * 0.05, 23, 4);     // 湿度 / 湖泊
      var r = hash2(x, y, 77);                    // 散布
      var t;
      switch (z) {
        case 'town':
          t = TILE.FLOOR;
          break;
        case 'meadow':
          t = TILE.GRASS;
          if (m > 0.70) t = TILE.WATER; else if (m > 0.665) t = TILE.SAND;
          else if (n > 0.66) t = TILE.TREE;
          else if (n > 0.62 && r < 0.4) t = TILE.TREE;
          else if (r < 0.035) t = TILE.FLOWER;
          else if (r < 0.042) t = TILE.ROCK;
          break;
        case 'forest':
          t = TILE.GRASS;
          // 密林：大片树墙中间留出蜿蜒的林间空地（第二层噪声做「林道」）
          var lane = Math.abs(fbm(x * 0.06, y * 0.06, 131, 3) - 0.5);
          if (m > 0.72) t = TILE.WATER;
          else if (lane < 0.035) t = TILE.GRASS;
          else if (n > 0.44) t = TILE.TREE;
          else if (n > 0.4 && r < 0.55) t = TILE.TREE;
          else if (r < 0.025) t = TILE.FLOWER;
          else if (r < 0.04) t = TILE.ROCK;
          break;
        case 'swamp':
          t = TILE.SWAMP;
          if (m > 0.62) t = TILE.WATER; else if (m > 0.55) t = TILE.SHALLOW;
          else if (n > 0.64) t = TILE.DEADTREE;
          else if (r < 0.03) t = TILE.FLOWER;
          else if (n < 0.38) t = TILE.GRASS;
          break;
        case 'crag':
          t = TILE.STONE;
          if (n > 0.64) t = TILE.CLIFF;
          else if (n > 0.6 && r < 0.5) t = TILE.ROCK;
          else if (r < 0.03) t = TILE.ROCK;
          else if (m < 0.36) t = TILE.DIRT;
          break;
        case 'frost':
          t = TILE.SNOW;
          if (m > 0.68) t = TILE.ICE;
          else if (n > 0.6) t = TILE.PINE;
          else if (n > 0.56 && r < 0.4) t = TILE.PINE;
          else if (r < 0.025) t = TILE.ROCK;
          break;
        case 'abyss':
          t = TILE.DARK;
          if (n > 0.64) t = TILE.CLIFF;
          else if (r < 0.04) t = TILE.DEADTREE;
          break;
      }
      grid[i] = t;
    }
  }

  // 拾光镇：围墙 + 四个门 + 中央广场 + 房屋地块（房屋本身由前端按地标画，这里只占格）
  stampTown(grid);

  // 道路：从镇子四门出发，只连到各区的传送石。
  // 早期版本连灯塔也铺了路，结果 13 条两格宽的路把草原犁成了斑马线 ——
  // 世界要先像野地，才谈得上探索。灯塔靠小地图和光柱找，不靠路。
  var roadTargets = [];
  landmarks.waystones.forEach(function (w) { if (w.zone !== 'town') roadTargets.push(w); });
  roadTargets.forEach(function (tg) { carveRoad(grid, CX, CY, tg.x, tg.y); });

  // 地标周围清出空地
  Object.keys(landmarks.towers).forEach(function (k) { clearArea(grid, landmarks.towers[k].x, landmarks.towers[k].y, 7, zoneFloor(k)); });
  landmarks.caves.forEach(function (cv) { clearArea(grid, cv.x, cv.y, 4, zoneFloor(cv.zone)); });
  landmarks.waystones.forEach(function (w) { clearArea(grid, w.x, w.y, 2, null); });

  // v5.3 农场：每人一块 12×8 的地，必须先清成「能走、没有树石」的空地。
  // meadow 的树墙会把整片田盖得只剩树林，玩家从世界层根本看不见自己种的东西。
  // 放在道路与地标清场之后，保证田里不会再横穿一条土路。
  var FD = require('./farmdata');
  var FA = FD.DATA;
  for (var fy = FA.FARM_Y - 1; fy <= FA.FARM_Y + FA.FARM_H; fy++) {
    for (var fx = FA.FARM_X - 1; fx <= FA.FARM_X + FA.FARM_W; fx++) {
      if (fx < 0 || fy < 0 || fx >= SIZE || fy >= SIZE) continue;
      grid[fy * SIZE + fx] = TILE.GRASS;
    }
  }

  // 宝箱、营地：在可走格上按区散布（确定性）
  // v5.7.1 先封掉「空气墙」口袋：≤8 格的可走孤岛（视觉上是草地，走进去出不来）
  sealPockets(grid, zones, landmarks);
  scatterChests(grid, zones, landmarks);

  // 守塔人遗物（《灯火纪》v5.7）：每页日记一个地标，走近按 E 阅读
  buildRelics(grid, zones, landmarks);

  // 刷怪点：自家田里不该刷怪，种地不是打怪；遗物格同样不刷
  var spawns = buildSpawns(grid, zones, landmarks).filter(function (s) {
    return !(s.x >= FA.FARM_X - 1 && s.x <= FA.FARM_X + FA.FARM_W + 1 &&
      s.y >= FA.FARM_Y - 1 && s.y <= FA.FARM_Y + FA.FARM_H + 1);
  });
  spawns = spawns.filter(function (s) {
    for (var ri = 0; ri < landmarks.relics.length; ri++) {
      var rl = landmarks.relics[ri];
      if (Math.abs(rl.x - s.x) + Math.abs(rl.y - s.y) < 4) return false;
    }
    return true;
  });

  return { size: SIZE, grid: grid, zones: zones, landmarks: landmarks, spawns: spawns };
}

function zoneFloor(z) {
  return { meadow: TILE.GRASS, forest: TILE.GRASS, swamp: TILE.SWAMP, crag: TILE.STONE, frost: TILE.SNOW, abyss: TILE.DARK }[z] || TILE.GRASS;
}

function stampTown(grid) {
  var r = TOWN_R - 2;
  // 镇内不是「一整块铺地」：中央广场（石板）+ 十字路 + 房屋之间的草地。
  // 全是铺地的话，26×26 一屏铺满，看起来像停车场而不是村子。
  for (var y = CY - r; y <= CY + r; y++) {
    for (var x = CX - r; x <= CX + r; x++) {
      var i = y * SIZE + x;
      var edge = (x === CX - r || x === CX + r || y === CY - r || y === CY + r);
      if (edge) { grid[i] = TILE.WALL; continue; }
      var dx = x - CX, dy = y - CY;
      var dd = Math.sqrt(dx * dx + dy * dy);
      var onRoad = Math.abs(dx) <= 1 || Math.abs(dy) <= 1;
      if (dd < 6.6) grid[i] = TILE.FLOOR;
      else if (onRoad && dd < r) grid[i] = TILE.DIRT;
      else if (hash2(x, y, 77) < 0.035) grid[i] = TILE.FLOWER;
      else grid[i] = TILE.GRASS;
    }
  }
  // 四门（各 3 格宽）
  for (var k = -1; k <= 1; k++) {
    grid[(CY - r) * SIZE + CX + k] = TILE.FLOOR;
    grid[(CY + r) * SIZE + CX + k] = TILE.FLOOR;
    grid[(CY + k) * SIZE + CX - r] = TILE.FLOOR;
    grid[(CY + k) * SIZE + CX + r] = TILE.FLOOR;
  }
  // 房屋（WALL 占格）+ 门前一小块石板
  TOWN_HOUSES.forEach(function (h) {
    for (var yy = h.y; yy < h.y + h.h; yy++) for (var xx = h.x; xx < h.x + h.w; xx++) grid[yy * SIZE + xx] = TILE.WALL;
    var dx0 = h.x + Math.floor(h.w / 2), dy0 = h.y + h.h;
    for (var a = -1; a <= 1; a++) {
      var i2 = dy0 * SIZE + dx0 + a;
      if (grid[i2] !== TILE.WALL) grid[i2] = TILE.FLOOR;
      var i3 = (dy0 + 1) * SIZE + dx0 + a;
      if (grid[i3] !== TILE.WALL) grid[i3] = TILE.FLOOR;
    }
  });
  // 花坛（广场四角）
  [[-5, -5], [5, -5], [-5, 5], [5, 5]].forEach(function (p) { grid[(CY + p[1]) * SIZE + CX + p[0]] = TILE.FLOWER; });
}

// 镇上的房子（左上角坐标、宽高、用途）。前端按 kind 画外观。
// 房子离广场近一点：26×26 的镇子如果房子贴着墙，玩家出生时四栋楼全在屏幕外，
// 「镇子」就变成了「一片空地」。±8 的方阵在 3 倍缩放下刚好一屏能看全。
var TOWN_HOUSES = [
  { id: 'smith',  kind: 'smith',  x: CX - 7, y: CY - 5, w: 4, h: 3, name: '铁匠铺' },
  { id: 'shop',   kind: 'shop',   x: CX + 3, y: CY - 5, w: 4, h: 3, name: '杂货铺' },
  { id: 'inn',    kind: 'inn',    x: CX - 7, y: CY + 2, w: 4, h: 3, name: '灯火客栈' },
  { id: 'hall',   kind: 'hall',   x: CX + 3, y: CY + 2, w: 4, h: 3, name: '守灯人之家' }
];

// 镇中央的大灯（永远亮着，是安全区的象征）
var TOWN_LAMP = { x: CX, y: CY - 2 };

function carveRoad(grid, x0, y0, x1, y1) {
  // 带抖动的折线：先走主轴再走副轴，中途按噪声偏移，路有弯。
  // 宽度 1 格 —— 两格宽在 16px 美术里看起来像高速公路。
  var x = x0, y = y0, steps = 0;
  while ((x !== x1 || y !== y1) && steps++ < 2000) {
    var dx = x1 - x, dy = y1 - y;
    var wob = fbm(x * 0.15, y * 0.15, 303, 2);
    if (Math.abs(dx) > Math.abs(dy) ? wob > 0.32 : wob > 0.68) x += dx > 0 ? 1 : -1;
    else if (dy !== 0) y += dy > 0 ? 1 : -1;
    else x += dx > 0 ? 1 : -1;
    if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) continue;
    var i = y * SIZE + x, t = grid[i];
    if (t === TILE.WALL || t === TILE.FLOOR) continue;
    if (t === TILE.WATER || t === TILE.SHALLOW) grid[i] = TILE.BRIDGE;
    else if (t !== TILE.BRIDGE) grid[i] = TILE.DIRT;
    // 路面时宽时窄：1 格宽的路笔直下去像用尺子画的，随机在侧面啃掉一格，
    // 看起来才是「被人踩出来的」而不是「规划出来的」。
    if (hash2(x, y, 707) > 0.62) {
      var ox = (hash2(x, y, 708) > 0.5) ? 1 : 0;
      var oy = (hash2(x, y, 709) > 0.5) ? 1 : 0;
      var j = (y + oy) * SIZE + (x + ox);
      if (x + ox < SIZE && y + oy < SIZE) {
        var tj = grid[j];
        if (tj === TILE.GRASS || tj === TILE.FLOWER || tj === TILE.SWAMP || tj === TILE.SNOW || tj === TILE.STONE) grid[j] = TILE.DIRT;
      }
    }
  }
}

function clearArea(grid, cx, cy, r, floor) {
  for (var y = cy - r; y <= cy + r; y++) for (var x = cx - r; x <= cx + r; x++) {
    if (x < 1 || y < 1 || x >= SIZE - 1 || y >= SIZE - 1) continue;
    if ((x - cx) * (x - cx) + (y - cy) * (y - cy) > r * r) continue;
    var i = y * SIZE + x;
    if (BLOCK[grid[i]] || grid[i] === TILE.SHALLOW) grid[i] = floor != null ? floor : TILE.DIRT;
  }
}

var ZONE_NAMES = ['town', 'meadow', 'forest', 'swamp', 'crag', 'frost', 'abyss'];

// 守塔人遗物（《灯火纪》）：把 lore.diaries 的 20 页按域散进世界。
// 第 i 页放在离域中心 (10 + i*14) 格的环带上（镇域特判用小半径），
// 确定性 hash 选格，必须与日记同域、可走、不在农场；失败兜底到传送石旁。
function buildRelics(grid, zones, L) {
  var lore = require('./lore');
  var FD = require('./farmdata');
  var byZone = {};
  lore.diaries.forEach(function (d) { (byZone[d.zone] = byZone[d.zone] || []).push(d); });
  var centers = { town: { x: CX, y: CY }, abyss: { x: ABYSS.x, y: ABYSS.y } };
  Object.keys(ZONE_CENTER).forEach(function (z) { if (!centers[z]) centers[z] = ZONE_CENTER[z]; });
  Object.keys(byZone).forEach(function (z) {
    var c = centers[z];
    var list = byZone[z];
    for (var i = 0; i < list.length; i++) {
      var want = z === 'town' ? (6 + i * 3) : (16 + i * 22);
      var ok = false;
      for (var t = 0; t < 500 && !ok; t++) {
        var ang = hash2(t + i * 173, 91, 1301) * 6.2832;
        var r = want + (hash2(t, 92, 1302) - 0.5) * (z === 'town' ? 5 : 14);
        var x = Math.round(c.x + Math.cos(ang) * r);
        var y = Math.round(c.y + Math.sin(ang) * r);
        if (x < 4 || y < 4 || x > SIZE - 5 || y > SIZE - 5) continue;
        var ii = y * SIZE + x;
        if (BLOCK[grid[ii]] || grid[ii] === TILE.WATER || grid[ii] === TILE.BRIDGE) continue;
        if (zoneAt(x, y) !== z) continue;   // zones[] 存的是 ZONE_IDX 数字，必须用 zoneAt() 的字符串口径比较
        if (x >= FD.DATA.FARM_X - 2 && x <= FD.DATA.FARM_X + FD.DATA.FARM_W + 1 &&
            y >= FD.DATA.FARM_Y - 2 && y <= FD.DATA.FARM_Y + FD.DATA.FARM_H + 1) continue;
        L.relics.push({ id: list[i].id, x: x, y: y });
        ok = true;
      }
      if (!ok) {
        var ws = null;
        for (var wi = 0; wi < L.waystones.length; wi++) if (L.waystones[wi].zone === z) ws = L.waystones[wi];
        if (ws) L.relics.push({ id: list[i].id, x: ws.x + 3 + i * 2, y: ws.y + 2 });
      }
    }
  });
  // v5.8 夜语：与日记同格放置（pair 对位）—— 夜里读守塔人，也读没等到天亮的人
  var relicAt = {};
  L.relics.forEach(function (r) { relicAt[r.id] = r; });
  lore.nights.forEach(function (n) {
    var r = relicAt[n.pair];
    L.nights.push({ id: n.id, x: r ? r.x : 0, y: r ? r.y : 0, pair: n.pair });
  });
}

// v5.7.1：把 ≤8 格的可走孤岛封成地形。384 地图上水域/崖壁把草地切成大量小口袋，
// 玩家「看着能走、走进去出不来」，体感就是空气墙。含道路/广场/任何地标的块不封。
function sealPockets(grid, zones, L) {
  var seen = new Uint8Array(SIZE * SIZE);
  var passThrough = {};
  passThrough[TILE.DIRT] = 1; passThrough[TILE.BRIDGE] = 1; passThrough[TILE.FLOOR] = 1;
  var markSet = {};
  function mark(list) { (list || []).forEach(function (p) { markSet[((p.y | 0) * SIZE + (p.x | 0))] = 1; }); }
  mark(L.waystones);
  Object.keys(L.towers).forEach(function (k) { mark([L.towers[k]]); });
  mark(L.caves); mark(L.chests); mark(L.relics); mark(L.npcs); mark(L.camps); mark(L.shrines);
  for (var i0 = 0; i0 < SIZE * SIZE; i0++) {
    if (seen[i0] || BLOCK[grid[i0]]) continue;
    var q = [i0], comp = [i0];
    seen[i0] = 1;
    while (q.length) {
      var cur = q.pop();
      var cx = cur % SIZE, cy = (cur / SIZE) | 0;
      for (var di = 0; di < 4; di++) {
        var nx = cx + (di === 0 ? 1 : di === 1 ? -1 : 0);
        var ny = cy + (di === 2 ? 1 : di === 3 ? -1 : 0);
        if (nx < 0 || ny < 0 || nx >= SIZE || ny >= SIZE) continue;
        var ni = ny * SIZE + nx;
        if (!seen[ni] && !BLOCK[grid[ni]]) { seen[ni] = 1; q.push(ni); comp.push(ni); }
      }
    }
    if (comp.length > 8) continue;
    var keep = false;
    for (var ci = 0; ci < comp.length; ci++) {
      if (passThrough[grid[comp[ci]]] || markSet[comp[ci]]) { keep = true; break; }
    }
    if (keep) continue;
    var z = ZONE_NAMES[zones[comp[0]]];
    if (z === 'town') continue;   // 镇内广场本就是 FLOOR，不存在封镇
    var fill = (z === 'crag' || z === 'frost') ? TILE.ROCK : (z === 'abyss' ? TILE.CLIFF : TILE.TREE);
    for (var fi = 0; fi < comp.length; fi++) grid[comp[fi]] = fill;
  }
}

function scatterChests(grid, zones, L) {
  // 每区 6~10 个宝箱，优先放在「死胡同」和树林深处 —— 让探索有回报
  var per = { meadow: 18, forest: 22, swamp: 22, crag: 22, frost: 22, abyss: 13 };
  var count = {};
  var id = 0;
  for (var tries = 0; tries < 90000; tries++) {
    var x = 8 + Math.floor(hash2(tries, 1, 401) * (SIZE - 16));
    var y = 8 + Math.floor(hash2(tries, 2, 401) * (SIZE - 16));
    var i = y * SIZE + x;
    var z = ZONE_NAMES[zones[i]];
    if (z === 'town' || BLOCK[grid[i]] || grid[i] === TILE.DIRT || grid[i] === TILE.BRIDGE) continue;
    if ((count[z] || 0) >= per[z]) continue;
    // 周围至少 3 面是阻挡（藏得深）或者靠近水
    var walls = 0;
    for (var k = 0; k < 8; k++) {
      var nx = x + [1, -1, 0, 0, 1, 1, -1, -1][k], ny = y + [0, 0, 1, -1, 1, -1, 1, -1][k];
      if (BLOCK[grid[ny * SIZE + nx]]) walls++;
    }
    if (walls < 3 && hash2(x, y, 9) > 0.08) continue;
    if (walls > 6) continue;
    // 与其他宝箱保持距离
    var ok = true;
    for (var c = 0; c < L.chests.length; c++) {
      var o = L.chests[c];
      if (Math.abs(o.x - x) + Math.abs(o.y - y) < 14) { ok = false; break; }
    }
    if (!ok) continue;
    // 品级：区越远越好，少量「金箱」
    var tier = hash2(x, y, 55) < 0.18 ? 2 : (hash2(x, y, 56) < 0.45 ? 1 : 0);
    L.chests.push({ id: 'c' + (id++), x: x, y: y, zone: z, tier: tier });
    count[z] = (count[z] || 0) + 1;
  }
}

function buildSpawns(grid, zones, L) {
  // 刷怪点：每 ~9 格一个候选，避开镇子、道路附近 3 格、传送石附近 6 格
  var D = require('./data');
  var byZone = {};
  Object.keys(D.MONSTERS).forEach(function (k) {
    var m = D.MONSTERS[k];
    if (m.zone.charAt(0) === '*') return;
    (byZone[m.zone] = byZone[m.zone] || []).push(k);
  });
  var spawns = [];
  var sid = 0;
  for (var gy = 6; gy < SIZE - 6; gy += 9) {
    for (var gx = 6; gx < SIZE - 6; gx += 9) {
      var x = gx + Math.floor(hash2(gx, gy, 601) * 7) - 3;
      var y = gy + Math.floor(hash2(gx, gy, 602) * 7) - 3;
      var i = y * SIZE + x;
      if (BLOCK[grid[i]] || grid[i] === TILE.WATER) continue;
      var z = ZONE_NAMES[zones[i]];
      if (z === 'town') continue;
      var near = false;
      for (var w = 0; w < L.waystones.length; w++) {
        if (Math.abs(L.waystones[w].x - x) + Math.abs(L.waystones[w].y - y) < 8) { near = true; break; }
      }
      if (near) continue;
      // 离镇子很近的草原只刷最弱的
      var dc = Math.sqrt((x - CX) * (x - CX) + (y - CY) * (y - CY));
      var pool = byZone[z] || [];
      if (!pool.length) continue;
      var kind;
      if (z === 'meadow' && dc < 28) kind = hash2(x, y, 3) < 0.7 ? 'slime' : 'mouse';
      else kind = pool[Math.floor(hash2(x, y, 4) * pool.length)];
      // 等级按区间 + 离镇子的距离插值
      var zr = null;
      for (var zi = 0; zi < D.ZONES.length; zi++) if (D.ZONES[zi].id === z) zr = D.ZONES[zi].lv;
      var t = z === 'meadow' ? Math.min(1, Math.max(0, (dc - 18) / 32)) : hash2(x, y, 5);
      var lv = Math.round(zr[0] + (zr[1] - zr[0]) * t);
      var m = D.MONSTERS[kind];
      spawns.push({ id: 's' + (sid++), x: x + 0.5, y: y + 0.5, zone: z, kind: kind, lv: lv, n: m.pack || 1 });
    }
  }
  return spawns;
}

function isBlocked(world, x, y) {
  var xi = Math.floor(x), yi = Math.floor(y);
  if (xi < 0 || yi < 0 || xi >= SIZE || yi >= SIZE) return true;
  return !!BLOCK[world.grid[yi * SIZE + xi]];
}

function encodeGrid(grid) {
  var s = '';
  var chars = '0123456789abcdefghijklmnopqrstuvwxyz';
  for (var i = 0; i < grid.length; i++) s += chars.charAt(grid[i]);
  return s;
}

var cached = null;
function get() {
  if (!cached) {
    cached = generate();
    cached.encoded = encodeGrid(cached.grid);
    cached.zonesEncoded = encodeGrid(cached.zones);
    cached.town = { houses: TOWN_HOUSES, lamp: TOWN_LAMP, cx: CX, cy: CY, r: TOWN_R - 2 };
  }
  return cached;
}

module.exports = {
  TILE: TILE,
  BLOCK: BLOCK,
  ZONE_NAMES: ZONE_NAMES,
  ZONE_CENTER: ZONE_CENTER,
  get: get,
  isBlocked: isBlocked,
  zoneAt: zoneAt,
  hash2: hash2
};
