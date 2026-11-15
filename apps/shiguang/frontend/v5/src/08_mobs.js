  // ---------------- §14 实体同步（把服务端快照变成看得见的东西） ----------------
  // 服务端 5Hz 下发；客户端每帧插值。插值比直接赋值重要得多：200ms 一跳的怪物
  // 会像幻灯片，插值之后是连续移动 —— 手感全在这一层。
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
          hp: a[4], maxHp: a[5], lv: a[6], state: a[7], faceAng: a[8],
          elite: !!a[9], boss: !!a[10], tellT: 0, tellMax: 0, moving: !!a[12],
          kx: 0, ky: 0, flash: 0, reg: 0
        };
        m.hpVis = a[4];
        m.bossZone = S.bossZoneOf && S.bossZoneOf[id];
        m.name = a[13] || '';
      } else {
        m.tx = a[2]; m.ty = a[3];
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
      // 位置插值（快照 5Hz，这里 60Hz 平滑）
      var k = Math.min(1, dt * 11);
      m.rx += (m.tx - m.rx) * k;
      m.ry += (m.ty - m.ry) * k;
      // 击退位移衰减（纯表现，不影响服务端位置）
      if (m.kx) { m.rx += m.kx * dt; m.kx *= Math.max(0, 1 - dt * 9); }
      if (m.ky) { m.ry += m.ky * dt; m.ky *= Math.max(0, 1 - dt * 9); }
      m.x = m.rx; m.y = m.ry;
      // 朝向：只在动的时候更新，站定时保持
      if (Math.abs(m.tx - m.rx) + Math.abs(m.ty - m.ry) > 0.05) {
        m.face = (m.tx - m.rx) < 0 ? 'l' : 'r';
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
        if (m.dying <= 0) { delete S.mobs[ids[i]]; continue; }
      }
      // 完美闪避：怪物的出招在「我无敌」的窗口里落下
      if (m.state === 'act' && m.prevState !== 'act') {
        var me = S.me;
        if (me && !me.down) {
          var d = dist(me.x, me.y, m.rx, m.ry);
          if (d < (m.boss ? 4.2 : 3.0)) {
            if (t < me.invUntil) perfectDodge(t);
            else hurtFlash();
          }
        }
      }
      m.prevState = m.state;
      // 血条追赶
      if (m.hpVis != null && m.hpVis > m.hp) m.hpVis = Math.max(m.hp, m.hpVis - m.maxHp * dt * 1.6);
    }
  }

  function perfectDodge(t) {
    var me = S.me;
    if (me.perfectAt && t - me.perfectAt < 0.6) return;
    me.perfectAt = t;
    me.critReady = 1;
    S.slow = { until: t + 0.42, scale: 0.3 };
    S.cam.shake = Math.max(S.cam.shake, 3);
    S.rings.push({ x: me.x, y: me.y, r: 0, max: 2.4, life: 0.45, max2: 0.45, col: '#bfe8ff' });
    S.texts.push({ x: me.x, y: me.y - 1.4, txt: '完美闪避', crit: 0, life: 0.9, max: 0.9, vy: -1.1, vx: 0, perfect: 1 });
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
          look: a[5] || 'NinjaBlue', hp: a[6], maxHp: a[7], down: !!a[8], lv: a[9],
          moving: !!a[10], animT: 0
        };
        continue;
      }
      p.tx = a[2]; p.ty = a[3];
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
      var k = Math.min(1, dt * 9);
      var d = Math.abs(p.tx - p.x) + Math.abs(p.ty - p.y);
      p.x += (p.tx - p.x) * k;
      p.y += (p.ty - p.y) * k;
      p.moving = d > 0.06 ? 1 : p.moving;
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
