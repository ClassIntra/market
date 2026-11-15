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
    ctx.font = 'bold ' + fs + 'px system-ui,sans-serif';
    ctx.textAlign = 'center';
    var ty2 = y - TILE * S.zoom - 3 + bob;
    var tw2 = ctx.measureText(n.name).width;
    ctx.fillStyle = 'rgba(8,12,22,0.62)';
    ctx.fillRect(x - tw2 / 2 - 3, ty2 - fs + 1, tw2 + 6, fs + 3);
    ctx.fillStyle = 'rgba(255,240,210,0.95)';
    ctx.fillText(n.name, x, ty2);
  }
