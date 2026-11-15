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
