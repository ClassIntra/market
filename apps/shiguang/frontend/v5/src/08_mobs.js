  // ---------------- §14 实体同步（把服务端快照变成看得见的东西） ----------------
  // 服务端 10Hz 下发；客户端每帧插值。插值比直接赋值重要得多：200ms 一跳的怪物
  // 会像幻灯片，插值之后是连续移动 —— 手感全在这一层。
  // v5.8：改成「分段线性 + 段尾短外推」—— 起点取当前看到的位置、终点取新快照，
  // 用实测快照间隔推进；晚到的包不会再让实体先停住、然后瞬移一下（那就是「一卡一卡」）。
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
          sx: a[2], sy: a[3], segT: S.net.clock, segDur: 0.1, snapAt: S.net.clock, vx: 0, vy: 0,
          hp: a[4], maxHp: a[5], lv: a[6], state: a[7], faceAng: a[8],
          elite: !!a[9], boss: !!a[10], tellT: 0, tellMax: 0, moving: !!a[12],
          kx: 0, ky: 0, flash: 0, reg: 0
        };
        m.hpVis = a[4];
        m.bossZone = S.bossZoneOf && S.bossZoneOf[id];
        m.name = a[13] || '';
      } else {
        var gap = m.snapAt ? S.net.clock - m.snapAt : 0.1;
        var jump = Math.abs(a[2] - m.rx) + Math.abs(a[3] - m.ry);
        m.sx = m.rx; m.sy = m.ry;
        m.tx = a[2]; m.ty = a[3];
        m.snapAt = S.net.clock;
        if (jump > 6) {                      // 传送 / 重生：直接对齐，别在画面上滑过去
          m.sx = m.tx; m.sy = m.ty; m.rx = m.tx; m.ry = m.ty; gap = 0.1;
        }
        m.segDur = clamp(gap, 0.05, 0.45);
        m.segT = S.net.clock;
        m.vx = (m.tx - m.sx) / m.segDur;
        m.vy = (m.ty - m.sy) / m.segDur;
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
      // 位置推进：段内线性走到新快照；走完仍标记 moving 时按段速度短外推（最多 220ms）
      // 用 S.net.clock（跟随顿帧/慢动作）而不是 S.time，慢镜头里实体才是慢的
      var u = m.segDur > 0 ? (S.net.clock - m.segT) / m.segDur : 1;
      if (u < 1) {
        var f = u < 0 ? 0 : u;
        m.rx = m.sx + (m.tx - m.sx) * f;
        m.ry = m.sy + (m.ty - m.sy) * f;
      } else if (m.moving && (Math.abs(m.vx) + Math.abs(m.vy)) > 0.3) {
        var extra = Math.min(S.net.clock - (m.segT + m.segDur), 0.22);
        m.rx = m.tx + clamp(m.vx, -12, 12) * extra;
        m.ry = m.ty + clamp(m.vy, -12, 12) * extra;
      } else {
        m.rx = m.tx; m.ry = m.ty;
      }
      // 击退位移衰减（纯表现，不影响服务端位置）
      if (m.kx) { m.rx += m.kx * dt; m.kx *= Math.max(0, 1 - dt * 9); }
      if (m.ky) { m.ry += m.ky * dt; m.ky *= Math.max(0, 1 - dt * 9); }
      m.x = m.rx; m.y = m.ry;
      // 朝向：只在动的时候更新，站定时保持
      if (Math.abs(m.vx) > 0.15 && u < 1.05) {
        m.face = m.vx < 0 ? 'l' : 'r';
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
        if (m.dying <= 0) { spawnCorpse(m); delete S.mobs[ids[i]]; continue; }
      }
      // 完美闪避：怪物的出招在「我无敌」的窗口里落下
      // v5.6 W4 s4 见切：判定窗口 ×1.6（220ms → 352ms），成功瞬间 0.15s 白边闪光
      if (m.state === 'act' && m.prevState !== 'act') {
        var me = S.me;
        if (me && !me.down) {
          var d = dist(me.x, me.y, m.rx, m.ry);
          if (d < (m.boss ? 4.2 : 3.0)) {
            var pw = me.pwBonus || 0;
            if (t < me.invUntil + pw) perfectDodge(t, m);
            else hurtFlash();
          }
        }
      }
      m.prevState = m.state;
      // 血条追赶
      if (m.hpVis != null && m.hpVis > m.hp) m.hpVis = Math.max(m.hp, m.hpVis - m.maxHp * dt * 1.6);
    }
  }

  function perfectDodge(t, m) {
    var me = S.me;
    if (me.perfectAt && t - me.perfectAt < 0.6) return;
    me.perfectAt = t;
    me.critReady = 1;
    // v5.6 W4：s4 见切 —— 子弹时间 ×1.6 + 白边闪光
    var s4 = me.talentShadowLv >= 4;
    S.slow = { until: t + (s4 ? 0.67 : 0.42), scale: 0.3 };
    S.pdFlashUntil = t + 0.15;
    // v5.6 W4：s5 影袭 —— 瞬移到目标背后 0.8 格（复用 dodge 残影），下一击暴击紫色
    if (m && me.talentShadowLv >= 5) {
      var ang = m.faceAng || 0;
      var nx = m.rx - Math.cos(ang) * 0.8, ny = m.ry - Math.sin(ang) * 0.8;
      if (!blockedAt(nx, ny)) {
        me.x = nx; me.y = ny;
        me.shadowStrike = 1;
      }
    }
    S.cam.shake = Math.max(S.cam.shake, 3);
    S.rings.push({ x: me.x, y: me.y, r: 0, max: 2.4, life: 0.45, max2: 0.45, col: '#bfe8ff' });
    S.texts.push({ x: me.x, y: me.y - 1.4, txt: '完美闪避', crit: 0, life: 0.9, max: 0.9, vy: -1.1, vx: 0, perfect: 1 });
    burst(me.x, me.y, 6, '#bfe8ff', 3.6);   // 残影
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
          sx: a[2], sy: a[3], segT: S.net.clock, segDur: 0.1, snapAt: S.net.clock, vx: 0, vy: 0,
          look: a[5] || 'NinjaBlue', hp: a[6], maxHp: a[7], down: !!a[8], lv: a[9],
          moving: !!a[10], animT: 0
        };
        continue;
      }
      var gap = p.snapAt ? S.net.clock - p.snapAt : 0.1;
      var jump = Math.abs(a[2] - p.x) + Math.abs(a[3] - p.y);
      p.sx = p.x; p.sy = p.y;
      p.tx = a[2]; p.ty = a[3];
      p.snapAt = S.net.clock;
      if (jump > 8) { p.sx = p.tx; p.sy = p.ty; p.x = p.tx; p.y = p.ty; gap = 0.1; }
      p.segDur = clamp(gap, 0.05, 0.45);
      p.segT = S.net.clock;
      p.vx = (p.tx - p.sx) / p.segDur;
      p.vy = (p.ty - p.sy) / p.segDur;
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
      var u = p.segDur > 0 ? (S.net.clock - p.segT) / p.segDur : 1;
      if (u < 1) {
        var f = u < 0 ? 0 : u;
        p.x = p.sx + (p.tx - p.sx) * f;
        p.y = p.sy + (p.ty - p.sy) * f;
      } else if (p.moving && (Math.abs(p.vx) + Math.abs(p.vy)) > 0.3) {
        var extra = Math.min(S.net.clock - (p.segT + p.segDur), 0.22);
        p.x = p.tx + clamp(p.vx, -12, 12) * extra;
        p.y = p.ty + clamp(p.vy, -12, 12) * extra;
      } else {
        p.x = p.tx; p.y = p.ty;
      }
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
