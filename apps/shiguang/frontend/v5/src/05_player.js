  // ---------------- §9 输入 ----------------
  // 键盘给桌面，虚拟摇杆给平板。摇杆只做「模拟量方向」，不做力度（8 向位移已经够了）。
  var IN = {
    x: 0, y: 0,          // 归一化方向
    kx: 0, ky: 0,        // 键盘方向
    jx: 0, jy: 0,        // 摇杆方向
    attack: 0, roll: 0, skill: 0, use: 0,
    joyId: -1, joyOX: 0, joyOY: 0, joyActive: false
  };

  function inputBind(root, onDestroy) {
    var keys = {};
    IN.keysRef = keys;
    function setKey(e, down) {
      var k = e.key || '';
      var code = e.keyCode || 0;
      var map = {
        65: 'a', 68: 'd', 87: 'w', 83: 's', 37: 'a', 39: 'd', 38: 'w', 40: 's',
        74: 'j', 75: 'k', 76: 'l', 69: 'e', 32: 'j'
      };
      var name = map[code];
      if (!name) return;
      // v5.3：钓鱼 QTE 期间空格归绿条用，不置 IN.attack、也不 preventDefault
      if (code === 32 && S.farm && S.farm.qte) return;
      if (down && keys[name]) return;
      keys[name] = down ? 1 : 0;
      if (down) {
        if (name === 'j') IN.attack = 1;
        if (name === 'k') IN.roll = 1;
        if (name === 'l') IN.skill = 1;
        if (name === 'e') IN.use = 1;
        if (document.activeElement && document.activeElement.tagName === 'INPUT') return;
        auResume();
      }
      if (['a', 'd', 'w', 's'].indexOf(name) >= 0 || name === 'j') e.preventDefault();
    }
    var kd = function (e) { setKey(e, 1); };
    var ku = function (e) { setKey(e, 0); };
    document.addEventListener('keydown', kd, false);
    document.addEventListener('keyup', ku, false);
    onDestroy(function () {
      document.removeEventListener('keydown', kd, false);
      document.removeEventListener('keyup', ku, false);
    });

    // 摇杆（左半屏）
    var joyBase = null;
    function touchStart(e) {
      for (var i = 0; i < e.changedTouches.length; i++) {
        var t = e.changedTouches[i];
        if (t.clientX < S.view.w * 0.5 && !IN.joyActive) {
          IN.joyActive = true;
          IN.joyId = t.identifier;
          IN.joyOX = t.clientX;
          IN.joyOY = t.clientY;
          showJoy(IN.joyOX, IN.joyOY);
        }
      }
      auResume();
    }
    function touchMove(e) {
      for (var i = 0; i < e.changedTouches.length; i++) {
        var t = e.changedTouches[i];
        if (t.identifier !== IN.joyId) continue;
        var dx = t.clientX - IN.joyOX, dy = t.clientY - IN.joyOY;
        var d = Math.sqrt(dx * dx + dy * dy);
        var R = 54;
        if (d > R) { dx = dx / d * R; dy = dy / d * R; d = R; }
        IN.jx = d > 6 ? dx / R : 0;
        IN.jy = d > 6 ? dy / R : 0;
        moveJoy(dx, dy);
        e.preventDefault();
      }
    }
    function touchEnd(e) {
      for (var i = 0; i < e.changedTouches.length; i++) {
        if (e.changedTouches[i].identifier === IN.joyId) {
          IN.joyId = -1; IN.joyActive = false;
          IN.jx = 0; IN.jy = 0;
          hideJoy();
        }
      }
    }
    var ts = function (e) { touchStart(e); };
    var tm = function (e) { touchMove(e); };
    var te = function (e) { touchEnd(e); };
    root.addEventListener('touchstart', ts, { passive: false });
    root.addEventListener('touchmove', tm, { passive: false });
    root.addEventListener('touchend', te, false);
    root.addEventListener('touchcancel', te, false);
    onDestroy(function () {
      root.removeEventListener('touchstart', ts);
      root.removeEventListener('touchmove', tm);
      root.removeEventListener('touchend', te);
      root.removeEventListener('touchcancel', te);
    });

    var joyEl = null, knobEl = null;
    function showJoy(x, y) {
      if (!joyEl) return;
      joyEl.style.display = 'block';
      joyEl.style.left = (x - 54) + 'px';
      joyEl.style.top = (y - 54) + 'px';
      moveJoy(0, 0);
    }
    function moveJoy(dx, dy) {
      if (!knobEl) return;
      knobEl.style.transform = 'translate(' + dx + 'px,' + dy + 'px)';
    }
    function hideJoy() {
      if (joyEl) joyEl.style.display = 'none';
    }
    return {
      attachJoy: function (el, knob) { joyEl = el; knobEl = knob; },
      keys: keys
    };
  }

  function readInput() {
    var k = IN.keysRef || {};
    var kx = 0, ky = 0;
    if (k.a) kx -= 1;
    if (k.d) kx += 1;
    if (k.w) ky -= 1;
    if (k.s) ky += 1;
    var x = kx + IN.jx, y = ky + IN.jy;
    if (x && y) { x *= 0.7071; y *= 0.7071; }
    var d = Math.sqrt(x * x + y * y);
    if (d > 1) { x /= d; y /= d; }
    IN.x = x; IN.y = y;
  }

  // ---------------- §10 玩家 ----------------
  // 客户端负责「手感」：加速度、翻滚、攻击前摇/后摇、命中判定、顿帧、震屏。
  // 服务端负责「真相」：位置上限、伤害上限、生命、掉落、进度。
  // 两者不冲突的关键是：客户端算出来的结果必须能被服务端复核（见 routes /v5/hit）。
  function makeMe(me) {
    me.vx = 0; me.vy = 0;
    me.face = 1;             // 0=下 1=上 2=左 3=右
    me.dirX = 0; me.dirY = 1;
    me.act = null;           // { type, t, dur, hit, combo }
    me.rollUntil = 0;
    me.invUntil = 0;
    me.comboIdx = 0;
    me.comboAt = 0;
    me.skillCd = 0;
    me.hurtAt = 0;
    me.dead = 0;
    me.moving = 0;
    me.animT = 0;
    me.mp = me.mp || 40;
    me.maxMp = me.maxMp || 40;
    me.critReady = 0;
    me.attackBuffered = 0;
    S.me = me;
    return me;
  }

  function playerFacing(dx, dy) {
    if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? 3 : 2;
    return dy > 0 ? 0 : 1;
  }

  function canAct(me, t) {
    if (!me.act) return true;
    if (me.act.type === 'roll') return t > me.act.t + me.act.dur;
    return false;
  }

  function updatePlayer(dt, t) {
    var me = S.me;
    if (!me) return;
    if (me.dead) return;
    readInput();

    // 计时器
    me.animT += dt;
    if (me.act) {
      me.act.t += dt * 1000;
      if (me.act.t >= me.act.dur) me.act = null;
    }

    var moving = Math.abs(IN.x) > 0.08 || Math.abs(IN.y) > 0.08;
    var speedMul = 1 + ((S.stats && S.stats.speed) || 0) / 100;

    // ---- 翻滚 ----
    if (IN.roll && !me.act && t > me.rollCdUntil) {
      IN.roll = 0;
      var dx = IN.x, dy = IN.y;
      if (!moving) { dx = [0, 0, -1, 1][me.face]; dy = [1, -1, 0, 0][me.face]; }
      var d = Math.sqrt(dx * dx + dy * dy) || 1;
      me.act = { type: 'roll', t: 0, dur: ROLL_MS, dx: dx / d, dy: dy / d };
      me.invUntil = t + ROLL_INV_MS;
      me.rollStartedAt = t;
      me.rollCdUntil = t + ROLL_CD * (1 - ((S.stats && S.stats.dodgeCd) || 0) / 100);
      S.net.roll = { at: t, rt: 0 };
      auSfx('jump', 0.28, 1.25);
      burst(me.x, me.y, 6, '#cfd8ff', 3.2);
    }

    // ---- 攻击 ----
    if (IN.attack && !me.act && t > me.atkCdUntil) {
      IN.attack = 0;
      startAttack(me, t);
    }

    // ---- 技能 ----
    if (IN.skill) {
      IN.skill = 0;
      castSkill(me, t);
    }

    // ---- 交互 ----
    if (IN.use) {
      IN.use = 0;
      doInteract(t);
    }

    // ---- 位移 ----
    if (me.act && me.act.type === 'roll') {
      var k = 1 - me.act.t / me.act.dur;
      var sp = ROLL_SPEED * (0.35 + 0.65 * k);
      stepMove(me, me.act.dx * sp * dt, me.act.dy * sp * dt);
      me.face = playerFacing(me.act.dx, me.act.dy);
    } else if (me.act && me.act.type === 'attack') {
      // 攻击时轻微前冲：第三段冲得远一点
      var lunge = me.act.combo === 2 ? 2.4 : 1.1;
      var p = me.act.t / me.act.dur;
      if (p < 0.45) stepMove(me, me.act.dx * lunge * dt, me.act.dy * lunge * dt);
      me.vx *= 0.8; me.vy *= 0.8;
    } else if (moving) {
      me.vx += (IN.x * SPEED * speedMul - me.vx) * Math.min(1, ACCEL * dt);
      me.vy += (IN.y * SPEED * speedMul - me.vy) * Math.min(1, ACCEL * dt);
      stepMove(me, me.vx * dt, me.vy * dt);
      me.face = playerFacing(IN.x, IN.y);
      me.dirX = IN.x; me.dirY = IN.y;
    } else {
      me.vx *= Math.max(0, 1 - FRICTION * dt);
      me.vy *= Math.max(0, 1 - FRICTION * dt);
      if (Math.abs(me.vx) > 0.02 || Math.abs(me.vy) > 0.02) stepMove(me, me.vx * dt, me.vy * dt);
    }
    me.moving = moving ? 1 : 0;

    // 揭图
    var tx = Math.floor(me.x), ty = Math.floor(me.y);
    if (tx !== me.lastTX || ty !== me.lastTY) {
      me.lastTX = tx; me.lastTY = ty;
      reveal(tx, ty, REVEAL_R);
    }
    // 技能回灯火
    if (me.mp < me.maxMp) me.mp = Math.min(me.maxMp, me.mp + 1.5 * dt);

    // 脚下粒子：走进草地会踩起一点尘土
    if (moving && Math.random() < dt * 6) {
      S.parts.push({ x: me.x + (Math.random() - 0.5) * 0.4, y: me.y, vx: 0, vy: -0.4, life: 0.5, max: 0.5, col: 'rgba(220,220,200,', r: 1.2 });
    }
  }

  // 带碰撞的位移：按轴分离，贴墙滑行（斜着撞墙不会整个人停住）
  function stepMove(e, dx, dy) {
    var nx = e.x + dx, ny = e.y + dy;
    var r = 0.28;
    if (!blockedAt(nx + (dx > 0 ? r : -r), e.y) && !blockedAt(nx, e.y)) e.x = nx;
    else e.vx = 0;
    if (!blockedAt(e.x, ny + (dy > 0 ? r : -r)) && !blockedAt(e.x, ny)) e.y = ny;
    else e.vy = 0;
  }
  function blockedAt(x, y) {
    // 只认「脚下一格」：16px 的小人按整格判定，斜角不会卡住
    return blockedTile(tileAt(Math.floor(x), Math.floor(y)));
  }

  // ---------------- §11 战斗 ----------------
  var COMBO_MUL = [1.0, 1.0, 1.8];
  var ATK_ARC = [120, 120, 150];
  var ATK_REACH = [1.9, 1.9, 2.3];

  function startAttack(me, t) {
    var nowIdx = (t - me.comboAt < COMBO_WINDOW) ? (me.comboIdx + 1) % 3 : 0;
    me.comboIdx = nowIdx;
    me.comboAt = t;
    var wk = (S.stats && S.stats.weaponKind) || 'sword';
    var mul = COMBO_MUL[nowIdx];
    var dur = ATK_WINDUP + ATK_ACTIVE + ATK_RECOVER;
    // 自动瞄准：朝最近的怪转过去（平板没有鼠标，不自动瞄准等于打不中）
    var tgt = nearestMob(me.x, me.y, 2.6);
    var dx, dy;
    if (tgt) {
      dx = tgt.x - me.x; dy = tgt.y - me.y;
      var dd = Math.sqrt(dx * dx + dy * dy) || 1;
      dx /= dd; dy /= dd;
    } else {
      dx = me.dirX || 0; dy = me.dirY || 1;
      var d2 = Math.sqrt(dx * dx + dy * dy) || 1;
      dx /= d2; dy /= d2;
    }
    me.act = { type: 'attack', t: 0, dur: dur, dx: dx, dy: dy, combo: nowIdx, hit: 0, mul: mul, wk: wk };
    me.face = playerFacing(dx, dy);
    me.atkCdUntil = t + ATK_WINDUP + 40;
    auSfx(nowIdx === 2 ? 'sword2' : 'sword', 0.34, 0.92 + Math.random() * 0.16);
  }

  // 攻击的「有效帧」到点时结算命中
  function resolveAttack(me, t) {
    if (!me.act || me.act.type !== 'attack' || me.act.hit) return;
    if (me.act.t < ATK_WINDUP) return;
    me.act.hit = 1;
    var wk = me.act.wk;
    var reach = ATK_REACH[me.act.combo] * (wk === 'lance' ? 1.45 : (wk === 'twin' ? 0.82 : 1));
    var arc = ATK_ARC[me.act.combo] * Math.PI / 180;
    var hits = [];
    var ids = Object.keys(S.mobs);
    for (var i = 0; i < ids.length; i++) {
      var m = S.mobs[ids[i]];
      if (!m || m.dying) continue;
      var dx = m.x - me.x, dy = m.y - me.y;
      var d = Math.sqrt(dx * dx + dy * dy);
      if (d > reach + (m.boss ? 1.2 : 0.35)) continue;
      var ang = Math.atan2(dy, dx);
      var face = Math.atan2(me.act.dy, me.act.dx);
      if (d > 0.65 && Math.abs(angleDiff(ang, face)) > arc * 0.5) continue;
      hits.push(m);
    }
    if (wk === 'staff') {
      // 法杖：一条直线上的第一个目标（视觉上是一道光）
      hits = hits.slice(0, 1);
      S.beams.push({ x: me.x, y: me.y, dx: me.act.dx, dy: me.act.dy, len: 9, life: 0.16, max: 0.16 });
      auSfx('magic', 0.4, 1.1);
    }
    if (!hits.length) return;
    var dmgBase = (S.stats.atk || 8) * me.act.mul;
    for (var k = 0; k < hits.length; k++) {
      var mob = hits[k];
      var crit = Math.random() * 100 < (S.stats.crit || 5) || (me.critReady > 0 && k === 0);
      if (k === 0 && me.critReady > 0) me.critReady = 0;
      var dmg = dmgBase * (crit ? 1 + (S.stats.critDmg || 50) / 100 : 1) * (0.9 + Math.random() * 0.2);
      dmg = Math.max(1, Math.round(dmg));
      var kbx = me.act.dx, kby = me.act.dy;
      hitMob(mob, dmg, crit, kbx, kby, me.act.combo === 2);
      S.net.queue.push({ m: mob.id, d: dmg, c: crit ? 1 : 0, kx: Math.round(kbx * 10) / 10, ky: Math.round(kby * 10) / 10, h: me.act.combo === 2 ? 1 : 0 });
    }
    hitstop(crit ? 90 : HITSTOP);
    S.cam.shake = Math.max(S.cam.shake, hits.length > 2 ? 4 : 2.4);
    auSfx(easePick(['hit', 'hit2', 'hit3']), 0.42, 0.95 + Math.random() * 0.2);
  }

  function easePick(a) { return a[(Math.random() * a.length) | 0]; }

  function hitMob(m, dmg, crit, kx, ky, heavy) {
    m.hpVis = Math.max(0, (m.hpVis == null ? m.hp : m.hpVis) - dmg);
    m.flash = 0.12;
    m.kx = (m.kx || 0) + kx * (heavy ? 0.55 : 0.25);
    m.ky = (m.ky || 0) + ky * (heavy ? 0.55 : 0.25);
    m.shakeT = 0.12;
    if (m.hpVis <= 0) m.dying = 0.28;
    S.texts.push({
      x: m.x + (Math.random() - 0.5) * 0.3, y: m.y - (m.boss ? 2.2 : 0.9),
      txt: String(dmg), crit: crit, life: crit ? 0.9 : 0.7, max: crit ? 0.9 : 0.7,
      vy: crit ? -1.5 : -1.1, vx: (Math.random() - 0.5) * 0.5
    });
    burst(m.x, m.y - 0.2, crit ? 10 : 5, crit ? '#ffe08a' : '#ffb0a0', crit ? 4.5 : 3);
  }

  function hitstop(ms) {
    S.hitstopUntil = Math.max(S.hitstopUntil || 0, S.time + ms / 1000);
  }

  function burst(x, y, n, col, spd) {
    for (var i = 0; i < n; i++) {
      var a = Math.random() * 6.2832;
      var v = spd * (0.4 + Math.random() * 0.8);
      S.parts.push({
        x: x, y: y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 1,
        life: 0.4 + Math.random() * 0.3, max: 0.7, col: col, r: 1 + Math.random() * 1.4
      });
    }
  }

  function nearestMob(x, y, maxD) {
    var best = null, bd = maxD || 99;
    var ids = Object.keys(S.mobs);
    for (var i = 0; i < ids.length; i++) {
      var m = S.mobs[ids[i]];
      if (!m || m.dying) continue;
      var d = dist(x, y, m.x, m.y);
      if (d < bd) { bd = d; best = m; }
    }
    return best;
  }

  function castSkill(me, t) {
    var kind = me.skills && me.skills.length ? me.skills[me.skills.length - 1] : 'spin';
    var def = SKILLS[kind] || SKILLS.spin;
    if (t < (me.skillCdUntil || 0)) return toast('技能还在冷却', 'warn');
    if ((me.mp || 0) < def.mp) return toast('灯火不够', 'warn');
    me.mp -= def.mp;
    me.skillCdUntil = t + def.cd;
    me.act = { type: 'skill', t: 0, dur: 320, dx: me.dirX || 0, dy: me.dirY || 1 };
    var list = [];
    var ids = Object.keys(S.mobs);
    var dmgBase = (S.stats.atk || 8) * (def.dmg || 1.6) * (1 + ((S.stats.skill) || 0) / 100);
    for (var i = 0; i < ids.length; i++) {
      var m = S.mobs[ids[i]];
      if (!m || m.dying) continue;
      var d = dist(me.x, me.y, m.x, m.y);
      if (d > (def.radius || 2.8) + (m.boss ? 1.4 : 0.4)) continue;
      var crit = Math.random() * 100 < (S.stats.crit || 5);
      var dmg = Math.max(1, Math.round(dmgBase * (crit ? 1 + (S.stats.critDmg || 50) / 100 : 1)));
      var dx = (m.x - me.x) / (d || 1), dy = (m.y - me.y) / (d || 1);
      hitMob(m, dmg, crit, dx, dy, true);
      list.push({ m: m.id, d: dmg, c: crit ? 1 : 0, kx: Math.round(dx * 10) / 10, ky: Math.round(dy * 10) / 10 });
    }
    S.rings.push({ x: me.x, y: me.y, r: 0, max: def.radius || 2.8, life: 0.42, max2: 0.42, col: '#ffe6a8' });
    S.cam.shake = Math.max(S.cam.shake, 5);
    hitstop(70);
    auSfx('power', 0.4, 1);
    S.net.skill = { k: kind, list: list };
    if (kind === 'lamp') S.lamps.push({ x: me.x, y: me.y, until: S.time + (def.dur || 12000), r: def.radius || 4 });
  }

  // 交互：箱子 / 传送石 / 灯塔 / NPC / 商店
  function doInteract(t) {
    var me = S.me;
    var best = null, bd = 2.2, bkind = '';
    // 宝箱
    for (var i = 0; i < S.map.chests.length; i++) {
      var c = S.map.chests[i];
      if (S.chests[c.id]) continue;
      var d = dist(me.x, me.y, c.x + 0.5, c.y + 0.5);
      if (d < bd) { bd = d; best = c; bkind = 'chest'; }
    }
    // 传送石
    for (var j = 0; j < S.map.waystones.length; j++) {
      var w = S.map.waystones[j];
      var d2 = dist(me.x, me.y, w.x + 0.5, w.y + 0.5);
      if (d2 < bd) { bd = d2; best = w; bkind = 'waystone'; }
    }
    // 灯塔
    for (var z in S.map.towers) {
      var tw = S.map.towers[z];
      var d3 = dist(me.x, me.y, tw.x + 0.5, tw.y + 0.5);
      if (d3 < bd + 0.8) { bd = d3; best = tw; bkind = 'tower'; }
    }
    // NPC
    for (var k = 0; k < NPCS.length; k++) {
      var n = NPCS[k];
      var d4 = dist(me.x, me.y, n.x, n.y);
      if (d4 < bd) { bd = d4; best = n; bkind = 'npc'; }
    }
    if (!best) return toast('这里没有可以交互的东西');
    if (bkind === 'chest') return apiChest(best);
    if (bkind === 'waystone') return apiWaystone(best);
    if (bkind === 'tower') {
      var lit = !!S.towers[findZoneOfTower(best)];
      return toast(lit ? '灯塔已经亮了 —— 这片区域是安全的' : '灯塔被长夜压着。打倒守护者才能点亮它');
    }
    if (bkind === 'npc') return openNpc(best);
  }

  function findZoneOfTower(tw) {
    for (var z in S.map.towers) {
      var t = S.map.towers[z];
      if (t.x === tw.x && t.y === tw.y) return z;
    }
    return '';
  }
