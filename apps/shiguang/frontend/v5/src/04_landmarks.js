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
