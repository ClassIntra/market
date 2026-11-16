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
