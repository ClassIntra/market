// 拾光群岛 v5 —— 世界模拟（10Hz，服务端权威）
//
// 职责：怪物刷新与 AI、投射物、玩家命中校验、伤害结算、掉落、经验、昼夜。
// 不碰数据库 —— 持久化由 routes 通过 hooks 完成（onKill / onLoot / onPlayerHurt）。
//
// 时间轴约定：怪物的「前摇」tell 是服务端时间，客户端拿到 state='tell' + tellEnd 自己画预警。
// 前摇结束那一刻服务端判定命中（对着玩家最新上报的位置），所以翻滚的无敌帧要客户端
// 上报 inv=1 —— 服务端只信「无敌状态在冷却规则内」（每 0.6 秒最多一次、持续 ≤ 0.25 秒）。
'use strict';

var C = require('./config');
var D = require('./data');
var W = require('./worldgen');

var world = W.get();
var SIZE = world.size;

var mobs = {};          // id -> mob
var mobSeq = 1;
var shots = [];         // 投射物
var players = {};       // userId -> 在线状态（位置、生命、无敌窗）
var events = [];        // 本 tick 产生的事件（命中、死亡、掉落），广播后清空
var spawnState = {};    // spawnId -> { alive: [mobId], deadAt }
var hooks = {};

function now() { return Date.now(); }
function dist(ax, ay, bx, by) { var dx = ax - bx, dy = ay - by; return Math.sqrt(dx * dx + dy * dy); }

// ---------------- 昼夜 ----------------
function dayPhase(t) {
  var f = ((t || now()) % C.DAY_MS) / C.DAY_MS;
  var name = f < C.DUSK_AT ? 'day' : (f < C.NIGHT_AT ? 'dusk' : (f < C.DAWN_AT ? 'night' : 'dawn'));
  return { f: f, name: name, night: name === 'night' };
}

// ---------------- 怪物 ----------------
function scaleMonster(def, lv, elite) {
  var g = 1 + (lv - 1) * 0.22;
  var hp = Math.round(def.hp * g * (elite ? 3.2 : 1));
  return {
    hp: hp, maxHp: hp,
    atk: Math.round(def.atk * (1 + (lv - 1) * 0.16) * (elite ? 1.5 : 1)),
    xp: Math.round(def.xp * (1 + (lv - 1) * 0.3) * (elite ? 4 : 1))
  };
}

function spawnMob(kind, x, y, lv, opts) {
  opts = opts || {};
  var def = D.MONSTERS[kind];
  if (!def) return null;
  var elite = !!opts.elite;
  var st = scaleMonster(def, lv, elite);
  var id = 'm' + (mobSeq++);
  var m = {
    id: id, kind: kind, x: x, y: y, hx: x, hy: y, lv: lv, elite: elite,
    hp: st.hp, maxHp: st.maxHp, atk: st.atk, xp: st.xp,
    spd: def.spd * (elite ? 1.1 : 1),
    state: 'idle', stateEnd: 0, target: null, face: 0,
    nextAtk: now() + 800 + Math.random() * 1200,
    vx: 0, vy: 0, dmgBy: {}, spawn: opts.spawn || null, zone: opts.zone || '',
    wander: { x: x, y: y, until: 0 }, boss: !!opts.boss, phase: 0, hitAt: 0,
    night: !!opts.night
  };
  if (opts.boss) {
    var B = opts.boss;
    m.hp = m.maxHp = B.hp; m.atk = B.atk; m.xp = B.xp; m.lv = B.lv; m.name = B.name;
    m.sprite = B.sprite; m.bossZone = opts.zone; m.spd = 2.2;
  }
  mobs[id] = m;
  return m;
}

// 位移（带碰撞，按轴分离，贴墙滑行）
function moveEntity(e, dx, dy, ghost) {
  var nx = e.x + dx, ny = e.y + dy;
  var r = 0.3;
  if (ghost || (!W.isBlocked(world, nx + (dx > 0 ? r : -r), e.y) && !W.isBlocked(world, nx, e.y))) e.x = nx;
  else e.blockedX = true;
  if (ghost || (!W.isBlocked(world, e.x, ny + (dy > 0 ? r : -r)) && !W.isBlocked(world, e.x, ny))) e.y = ny;
  else e.blockedY = true;
}

function nearestPlayer(m, maxD) {
  var best = null, bd = maxD;
  Object.keys(players).forEach(function (uid) {
    var p = players[uid];
    if (p.dead || p.down || now() - p.seen > C.ONLINE_TTL_MS) return;
    if (p.safe) return; // 镇内不被攻击
    var d = dist(m.x, m.y, p.x, p.y);
    if (d < bd) { bd = d; best = p; }
  });
  return best;
}

// 光照：幽灵不能进入灯光范围（镇子、已点亮灯塔、玩家放的守夜灯）
var lights = []; // { x, y, r, until }
function inLight(x, y) {
  var t = now();
  for (var i = 0; i < lights.length; i++) {
    var L = lights[i];
    if (L.until && L.until < t) continue;
    if (dist(x, y, L.x, L.y) < L.r) return true;
  }
  return false;
}

function damagePlayer(p, amount, src) {
  var t = now();
  if (p.dead || p.down) return;
  if (p.invUntil && p.invUntil > t) {
    // 完美闪避：在命中前 0.15 秒内开始的翻滚
    if (p.rollAt && t - p.rollAt < 150 + (p.perfectBonus || 0)) {
      events.push({ t: 'perfect', u: p.uid, x: p.x, y: p.y });
    }
    return;
  }
  amount = Math.max(1, Math.round(amount * (0.9 + Math.random() * 0.2)));
  p.hp -= amount;
  p.hurtAt = t;          // 脱战计时：5 秒不回血
  events.push({ t: 'phit', u: p.uid, d: amount, x: p.x, y: p.y, src: src });
  if (p.hp <= 0) {
    if (p.cheatDeath && (!p.cheatAt || t - p.cheatAt > 90000)) {
      p.hp = 1; p.cheatAt = t;
      events.push({ t: 'cheat', u: p.uid });
      return;
    }
    p.hp = 0; p.down = t;
    events.push({ t: 'down', u: p.uid, x: p.x, y: p.y });
    if (hooks.onDown) hooks.onDown(p.uid);
  }
}

// AI：每种模板一个函数，返回 void；状态机：idle → chase → tell → act → recover
function aiTick(m, dt, t) {
  var def = D.MONSTERS[m.kind];
  if (m.boss) return bossTick(m, dt, t);
  var ph = dayPhase(t);
  // 幽灵在白天消散
  if (def.ai === 'ghost' && !ph.night && ph.name !== 'dusk') { killMob(m, null, true); return; }

  if (m.state === 'stun') { if (t > m.stateEnd) m.state = 'idle'; return; }
  if (m.state === 'knock') {
    moveEntity(m, m.vx * dt, m.vy * dt, def.ai === 'ghost');
    m.vx *= 0.82; m.vy *= 0.82;
    if (t > m.stateEnd) m.state = 'chase';
    return;
  }

  var aggro = (def.ai === 'shooter' || def.ai === 'caster') ? 9 : 7;
  if (m.elite) aggro += 2;
  var tgt = m.target && players[m.target] && !players[m.target].down && !players[m.target].safe ? players[m.target] : nearestPlayer(m, aggro);
  // 被打了一定会追（仇恨），追出牵引半径会回家
  if (tgt) m.target = tgt.uid;
  var home = dist(m.x, m.y, m.hx, m.hy);
  if (home > C.LEASH_RADIUS && m.state !== 'act') { m.target = null; tgt = null; m.state = 'home'; }

  if (m.state === 'home') {
    var hdx = m.hx - m.x, hdy = m.hy - m.y, hd = Math.sqrt(hdx * hdx + hdy * hdy);
    if (hd < 0.5) { m.state = 'idle'; m.hp = m.maxHp; return; }
    moveEntity(m, hdx / hd * m.spd * 1.4 * dt, hdy / hd * m.spd * 1.4 * dt, def.ai === 'ghost');
    m.face = Math.atan2(hdy, hdx);
    return;
  }

  if (!tgt) {
    // 闲逛
    if (t > m.wander.until) {
      var a = Math.random() * Math.PI * 2, r = Math.random() * 3;
      m.wander = { x: m.hx + Math.cos(a) * r, y: m.hy + Math.sin(a) * r, until: t + 2000 + Math.random() * 3000 };
    }
    var wdx = m.wander.x - m.x, wdy = m.wander.y - m.y, wd = Math.sqrt(wdx * wdx + wdy * wdy);
    if (wd > 0.3) { moveEntity(m, wdx / wd * m.spd * 0.35 * dt, wdy / wd * m.spd * 0.35 * dt, def.ai === 'ghost'); m.face = Math.atan2(wdy, wdx); m.moving = true; }
    else m.moving = false;
    m.state = 'idle';
    return;
  }

  var dx = tgt.x - m.x, dy = tgt.y - m.y, d = Math.sqrt(dx * dx + dy * dy) || 0.001;

  if (m.state === 'tell') {
    // 前摇中：多数怪站定、锁定方向（给玩家读招的机会）
    if (t >= m.stateEnd) actStart(m, def, tgt, t);
    return;
  }
  if (m.state === 'act') { actTick(m, def, dt, t); return; }
  if (m.state === 'recover') { if (t > m.stateEnd) m.state = 'chase'; return; }

  // 追击 / 走位
  m.state = 'chase';
  m.face = Math.atan2(dy, dx);
  var want = def.range * 0.85;
  var spd = m.spd;
  if (def.ai === 'ghost' && inLight(m.x + dx / d * 0.6, m.y + dy / d * 0.6)) {
    // 怕光：在光圈外绕
    moveEntity(m, -dy / d * spd * dt, dx / d * spd * dt, true);
    return;
  }
  if (def.ai === 'shooter' || def.ai === 'caster') {
    // 保持距离：太近后退，太远前进，中间横移
    if (d < want * 0.55) moveEntity(m, -dx / d * spd * dt, -dy / d * spd * dt);
    else if (d > want) moveEntity(m, dx / d * spd * dt, dy / d * spd * dt);
    else moveEntity(m, -dy / d * spd * 0.5 * dt * (m.id.length % 2 ? 1 : -1), dx / d * spd * 0.5 * dt * (m.id.length % 2 ? 1 : -1));
  } else if (d > want) {
    moveEntity(m, dx / d * spd * dt, dy / d * spd * dt, def.ai === 'ghost');
  }
  m.moving = true;
  if (d <= def.range && t >= m.nextAtk) {
    m.state = 'tell';
    m.stateEnd = t + def.tell * (m.elite ? 0.85 : 1);
    m.aimX = tgt.x; m.aimY = tgt.y;
    m.face = Math.atan2(dy, dx);
    events.push({ t: 'tell', m: m.id, ms: Math.round(def.tell * (m.elite ? 0.85 : 1)), ax: round1(m.aimX), ay: round1(m.aimY) });
  }
}

function round1(v) { return Math.round(v * 10) / 10; }

function actStart(m, def, tgt, t) {
  m.state = 'act';
  var ax = m.aimX, ay = m.aimY;
  var dx = ax - m.x, dy = ay - m.y, d = Math.sqrt(dx * dx + dy * dy) || 0.001;
  m.face = Math.atan2(dy, dx);
  switch (def.ai) {
    case 'hopper':
      // 跳扑：0.35 秒飞到瞄准点，落地时范围伤害
      m.actFrom = { x: m.x, y: m.y }; m.actTo = { x: m.x + dx / d * Math.min(d, def.range), y: m.y + dy / d * Math.min(d, def.range) };
      m.stateEnd = t + 350; m.actKind = 'leap';
      break;
    case 'dasher': case 'charger':
      m.vx = dx / d * (def.dash || 12); m.vy = dy / d * (def.dash || 12);
      m.stateEnd = t + (def.ai === 'charger' ? 700 : 420); m.actKind = 'dash'; m.hitSet = {};
      break;
    case 'shooter': case 'caster':
      fireShots(m, def, ax, ay);
      m.stateEnd = t + 250; m.actKind = 'shoot';
      break;
    case 'bomber':
      explode(m, def.boom || 2.4, m.atk * 1.4);
      m.stateEnd = t + 200; m.actKind = 'boom';
      break;
    default: // brute / shield / swarm / ghost：扇形近战
      meleeArc(m, def.range + 0.4, def.arc || 90, m.atk);
      m.stateEnd = t + 260; m.actKind = 'swing';
  }
  events.push({ t: 'act', m: m.id, k: m.actKind });
}

function actTick(m, def, dt, t) {
  if (m.actKind === 'leap') {
    var k = 1 - Math.max(0, (m.stateEnd - t) / 350);
    m.x = m.actFrom.x + (m.actTo.x - m.actFrom.x) * k;
    m.y = m.actFrom.y + (m.actTo.y - m.actFrom.y) * k;
    if (W.isBlocked(world, m.x, m.y)) { m.x = m.actFrom.x; m.y = m.actFrom.y; }
    if (t >= m.stateEnd) {
      areaHit(m.x, m.y, 1.4, m.atk, m.id);
      endAct(m, def, t);
    }
    return;
  }
  if (m.actKind === 'dash') {
    m.blockedX = m.blockedY = false;
    moveEntity(m, m.vx * dt, m.vy * dt);
    Object.keys(players).forEach(function (uid) {
      var p = players[uid];
      if (m.hitSet[uid] || p.safe) return;
      if (dist(m.x, m.y, p.x, p.y) < 0.9) { m.hitSet[uid] = 1; damagePlayer(p, m.atk, m.id); }
    });
    if (def.ai === 'charger' && (m.blockedX || m.blockedY)) {
      // 撞墙：自己晕 2 秒 —— 这就是破绽
      m.state = 'stun'; m.stateEnd = t + 2000; m.nextAtk = t + 3200;
      events.push({ t: 'stun', m: m.id, ms: 2000 });
      return;
    }
    if (t >= m.stateEnd) endAct(m, def, t);
    return;
  }
  if (t >= m.stateEnd) endAct(m, def, t);
}

function endAct(m, def, t) {
  m.state = 'recover';
  m.stateEnd = t + (def.ai === 'charger' ? 900 : 450);
  m.nextAtk = t + def.cd * (0.85 + Math.random() * 0.3) * (m.elite ? 0.8 : 1);
}

function meleeArc(m, reach, arcDeg, dmg) {
  var half = arcDeg * Math.PI / 360;
  Object.keys(players).forEach(function (uid) {
    var p = players[uid];
    if (p.safe) return;
    var dx = p.x - m.x, dy = p.y - m.y, d = Math.sqrt(dx * dx + dy * dy);
    if (d > reach) return;
    var a = Math.atan2(dy, dx) - m.face;
    while (a > Math.PI) a -= Math.PI * 2;
    while (a < -Math.PI) a += Math.PI * 2;
    if (Math.abs(a) <= half || d < 0.6) damagePlayer(p, dmg, m.id);
  });
}

function areaHit(x, y, r, dmg, src) {
  Object.keys(players).forEach(function (uid) {
    var p = players[uid];
    if (p.safe) return;
    if (dist(x, y, p.x, p.y) <= r) damagePlayer(p, dmg, src);
  });
}

function explode(m, r, dmg) {
  events.push({ t: 'boom', x: round1(m.x), y: round1(m.y), r: r });
  areaHit(m.x, m.y, r, dmg, m.id);
}

function fireShots(m, def, ax, ay) {
  var sh = def.shot || { spd: 6, n: 1 };
  var base = Math.atan2(ay - m.y, ax - m.x);
  var n = sh.n;
  for (var i = 0; i < n; i++) {
    var a;
    if (def.ai === 'caster') a = base + (Math.PI * 2 / n) * i;         // 环形
    else a = base + (n > 1 ? (i - (n - 1) / 2) * 0.28 : 0);            // 扇形
    shots.push({ id: 'p' + (mobSeq++), x: m.x, y: m.y, vx: Math.cos(a) * sh.spd, vy: Math.sin(a) * sh.spd,
      dmg: m.atk, until: now() + 2400, src: m.id, kind: m.kind });
  }
  events.push({ t: 'shots', m: m.id, s: shots.slice(-n).map(function (s) { return [s.id, round1(s.x), round1(s.y), round1(s.vx), round1(s.vy)]; }) });
}

function shotsTick(dt, t) {
  for (var i = shots.length - 1; i >= 0; i--) {
    var s = shots[i];
    s.x += s.vx * dt; s.y += s.vy * dt;
    var dead = t > s.until || W.isBlocked(world, s.x, s.y) && world.grid[Math.floor(s.y) * SIZE + Math.floor(s.x)] !== W.TILE.WATER;
    if (!dead) {
      var uids = Object.keys(players);
      for (var k = 0; k < uids.length; k++) {
        var p = players[uids[k]];
        if (p.safe || p.down) continue;
        if (dist(s.x, s.y, p.x, p.y) < 0.55) { damagePlayer(p, s.dmg, s.src); dead = true; break; }
      }
    }
    if (dead) shots.splice(i, 1);
  }
}

// ---------------- Boss ----------------
function bossTick(m, dt, t) {
  var B = D.BOSSES[m.bossZone];
  var tgt = m.target && players[m.target] && !players[m.target].down ? players[m.target] : nearestPlayer(m, 16);
  if (!tgt) {
    if (dist(m.x, m.y, m.hx, m.hy) > 1) {
      var hx = m.hx - m.x, hy = m.hy - m.y, h = Math.sqrt(hx * hx + hy * hy);
      moveEntity(m, hx / h * 3 * dt, hy / h * 3 * dt);
    } else if (m.hp < m.maxHp) m.hp = Math.min(m.maxHp, m.hp + m.maxHp * 0.02 * dt); // 脱战回血
    m.state = 'idle';
    return;
  }
  m.target = tgt.uid;
  // 阶段：血量 66% / 33% 进入下一阶段，招式更多更快
  var phase = m.hp < m.maxHp * 0.33 ? 2 : (m.hp < m.maxHp * 0.66 ? 1 : 0);
  if (phase !== m.phase) {
    m.phase = phase;
    events.push({ t: 'bphase', m: m.id, p: phase });
    m.state = 'stun'; m.stateEnd = t + 1200; // 转阶段时有一个破绽
  }
  if (m.state === 'stun') { if (t > m.stateEnd) m.state = 'chase'; return; }
  var dx = tgt.x - m.x, dy = tgt.y - m.y, d = Math.sqrt(dx * dx + dy * dy) || 0.001;
  if (m.state === 'tell') { if (t >= m.stateEnd) bossAct(m, B, tgt, t); return; }
  if (m.state === 'act') {
    if (m.actKind === 'dash' || m.actKind === 'roll') {
      moveEntity(m, m.vx * dt, m.vy * dt);
      Object.keys(players).forEach(function (uid) {
        var p = players[uid];
        if (m.hitSet[uid]) return;
        if (dist(m.x, m.y, p.x, p.y) < 1.4) { m.hitSet[uid] = 1; damagePlayer(p, m.atk * 1.2, m.id); }
      });
    }
    if (m.actKind === 'leap') {
      var k = 1 - Math.max(0, (m.stateEnd - t) / 600);
      m.x = m.actFrom.x + (m.actTo.x - m.actFrom.x) * k; m.y = m.actFrom.y + (m.actTo.y - m.actFrom.y) * k;
      if (t >= m.stateEnd) { areaHit(m.x, m.y, 2.6, m.atk * 1.4, m.id); events.push({ t: 'quake', x: round1(m.x), y: round1(m.y), r: 2.6 }); }
    }
    if (t >= m.stateEnd) { m.state = 'recover'; m.stateEnd = t + (700 - phase * 180); }
    return;
  }
  if (m.state === 'recover') { if (t > m.stateEnd) m.state = 'chase'; return; }
  m.state = 'chase';
  m.face = Math.atan2(dy, dx);
  if (d > 1.8) moveEntity(m, dx / d * m.spd * (1 + phase * 0.2) * dt, dy / d * m.spd * (1 + phase * 0.2) * dt);
  if (t >= m.nextAtk) {
    // 按阶段解锁招式池
    var pool = B.phases.slice(0, Math.min(B.phases.length, phase + 2));
    var mv = pool[Math.floor(Math.random() * pool.length)];
    m.move = mv;
    m.state = 'tell';
    var tell = Math.max(450, 900 - phase * 150);
    m.stateEnd = t + tell;
    m.aimX = tgt.x; m.aimY = tgt.y;
    events.push({ t: 'tell', m: m.id, ms: tell, mv: mv, ax: round1(tgt.x), ay: round1(tgt.y) });
  }
}

function bossAct(m, B, tgt, t) {
  m.state = 'act';
  var mv = m.move || 'swipe';
  var dx = m.aimX - m.x, dy = m.aimY - m.y, d = Math.sqrt(dx * dx + dy * dy) || 0.001;
  m.face = Math.atan2(dy, dx);
  m.hitSet = {};
  var phase = m.phase;
  if (mv === 'leap' || mv === 'quake') {
    m.actKind = 'leap'; m.actFrom = { x: m.x, y: m.y }; m.actTo = { x: m.aimX, y: m.aimY };
    if (W.isBlocked(world, m.aimX, m.aimY)) m.actTo = { x: m.x, y: m.y };
    m.stateEnd = t + 600;
  } else if (mv === 'dash' || mv === 'roll' || mv === 'combo') {
    m.actKind = mv === 'roll' ? 'roll' : 'dash';
    var sp = mv === 'roll' ? 10 : 14;
    m.vx = dx / d * sp; m.vy = dy / d * sp; m.stateEnd = t + 650;
  } else if (mv === 'feathers' || mv === 'shards' || mv === 'tongue') {
    m.actKind = 'shoot';
    fireShots(m, { ai: mv === 'tongue' ? 'shooter' : 'caster', shot: { spd: 6 + phase, n: mv === 'tongue' ? 3 : 10 + phase * 4 } }, m.aimX, m.aimY);
    m.stateEnd = t + 300;
  } else if (mv === 'nova' || mv === 'freeze' || mv === 'beam') {
    m.actKind = 'nova';
    events.push({ t: 'boom', x: round1(m.x), y: round1(m.y), r: 3.6 });
    areaHit(m.x, m.y, 3.6, m.atk * 1.3, m.id);
    m.stateEnd = t + 400;
  } else if (mv.indexOf('summon:') === 0) {
    m.actKind = 'summon';
    var kind = mv.split(':')[1];
    for (var i = 0; i < 2 + phase; i++) {
      var a = Math.random() * Math.PI * 2;
      var s = spawnMob(kind, m.x + Math.cos(a) * 2, m.y + Math.sin(a) * 2, Math.max(1, m.lv - 2), { zone: m.bossZone });
      if (s) { s.minion = true; s.target = tgt.uid; }
    }
    m.stateEnd = t + 500;
  } else if (mv === 'teleport') {
    m.actKind = 'teleport';
    var ang = Math.random() * Math.PI * 2;
    var nx = tgt.x + Math.cos(ang) * 2.5, ny = tgt.y + Math.sin(ang) * 2.5;
    if (!W.isBlocked(world, nx, ny)) { m.x = nx; m.y = ny; }
    meleeArc(m, 2.4, 360, m.atk);
    m.stateEnd = t + 400;
  } else if (mv === 'steal') {
    m.actKind = 'nova';
    areaHit(m.x, m.y, 2.4, m.atk, m.id);
    m.stateEnd = t + 300;
  } else {
    m.actKind = 'swing';
    meleeArc(m, 2.6, 150, m.atk * 1.2);
    m.stateEnd = t + 320;
  }
  m.nextAtk = t + Math.max(900, 2000 - phase * 400);
  events.push({ t: 'act', m: m.id, k: m.actKind, mv: mv });
}

// ---------------- 玩家攻击 ----------------
// hit = { mobId, dmg, crit, kind: 'melee'|'skill'|'ranged', kx, ky（击退方向）}
// 服务端只做合理性校验：距离、频率、伤害上限。命中判定交给客户端（零延迟手感）。
function playerHit(uid, hit, stats) {
  var p = players[uid];
  var m = mobs[hit.mobId];
  if (!p || !m || m.hp <= 0) return null;
  var t = now();
  if (p.down || p.safe) return null;
  if (p.lastHit && t - p.lastHit < C.HIT_MIN_GAP_MS && hit.kind === 'melee') return null;
  var reach = hit.kind === 'ranged' ? C.RANGED_REACH : (hit.kind === 'skill' ? 7 : C.HIT_REACH);
  if (m.boss) reach += 1.5;
  if (dist(p.x, p.y, m.x, m.y) > reach) return null;
  p.lastHit = t;
  // 伤害上限：攻击力 × 招式倍率上限 × 暴击上限 × 容差
  var maxMul = hit.kind === 'skill' ? 3.6 * (1 + (stats.skill || 0) / 100) : 2.6;
  var critMax = 1 + (stats.critDmg || 50) / 100;
  var nightMul = dayPhase(t).night ? 1 + (stats.night || 0) / 100 : 1;
  var eliteMul = (m.elite || m.boss) ? 1 + ((stats.talents && stats.talents.eliteDmg) || 0) / 100 : 1;
  var cap = stats.atk * maxMul * critMax * nightMul * eliteMul * 1.5 * C.DMG_TOLERANCE; // ×1.5：天赋/光环/完美闪避等
  var dmg = Math.max(1, Math.min(Math.round(hit.dmg || 0), Math.round(cap)));
  // 骷髅：正面减伤 70%
  var def = D.MONSTERS[m.kind];
  if (def && def.ai === 'shield' && m.state !== 'stun') {
    var ang = Math.atan2(p.y - m.y, p.x - m.x) - m.face;
    while (ang > Math.PI) ang -= Math.PI * 2;
    while (ang < -Math.PI) ang += Math.PI * 2;
    if (Math.abs(ang) < Math.PI / 2.5) { dmg = Math.max(1, Math.round(dmg * 0.3)); hit.blocked = true; }
  }
  m.hp -= dmg;
  m.dmgBy[uid] = (m.dmgBy[uid] || 0) + dmg;
  m.target = uid;
  m.hitAt = t;
  // 击退（Boss 与前摇中的怪不吃击退 —— 你打断不了它，只能躲）
  if (!m.boss && m.state !== 'act' && hit.kx != null) {
    var kb = hit.kind === 'skill' ? 9 : (hit.heavy ? 8 : 4.5);
    if (m.elite) kb *= 0.4;
    m.vx = hit.kx * kb; m.vy = hit.ky * kb;
    if (m.state !== 'tell') { m.state = 'knock'; m.stateEnd = t + 140; }
  }
  // 吸血
  if (stats.leech) p.hp = Math.min(p.maxHp, p.hp + dmg * stats.leech / 100);
  events.push({ t: 'mhit', m: m.id, d: dmg, c: hit.crit ? 1 : 0, u: uid, b: hit.blocked ? 1 : 0, hp: Math.max(0, m.hp) });
  if (m.hp <= 0) killMob(m, uid);
  return { dmg: dmg, hp: Math.max(0, m.hp), dead: m.hp <= 0 };
}

function killMob(m, killer, silent) {
  if (!mobs[m.id]) return;
  delete mobs[m.id];
  if (m.spawn && spawnState[m.spawn]) {
    var ss = spawnState[m.spawn];
    ss.alive = ss.alive.filter(function (id) { return id !== m.id; });
    if (!ss.alive.length) ss.deadAt = now();
  }
  if (silent) { events.push({ t: 'vanish', m: m.id }); return; }
  var def = D.MONSTERS[m.kind] || {};
  events.push({ t: 'mdie', m: m.id, x: round1(m.x), y: round1(m.y), k: m.kind, e: m.elite ? 1 : 0, b: m.boss ? 1 : 0 });
  // 孢子菇 / 灯笼：死后爆炸
  if (def.ai === 'bomber' && !m.boss) setTimeout(function () { explode(m, (def.boom || 2.4) * 0.8, m.atk); }, 450);
  // 分裂
  if (def.split) {
    for (var i = 0; i < 2; i++) {
      var s = spawnMob(def.split, m.x + (i ? 0.6 : -0.6), m.y, Math.max(1, m.lv - 1), { zone: m.zone });
      if (s) { s.minion = true; s.target = killer; }
    }
  }
  // 奖励：参与过伤害（且在附近）的玩家都有份 —— 一起打不会互相抢怪
  var shares = Object.keys(m.dmgBy);
  if (hooks.onKill) hooks.onKill(m, shares, killer, dayPhase().night);
}

// ---------------- 刷怪 ----------------
var lastSpawnCheck = 0;
function spawnTick(t) {
  if (t - lastSpawnCheck < C.SPAWN_CHECK_MS) return;
  lastSpawnCheck = t;
  var online = Object.keys(players).map(function (k) { return players[k]; }).filter(function (p) { return t - p.seen < C.ONLINE_TTL_MS; });
  if (!online.length) {
    // 没人在线：清空怪物，省 CPU
    Object.keys(mobs).forEach(function (id) { if (!mobs[id].boss) delete mobs[id]; });
    spawnState = {};
    return;
  }
  var ph = dayPhase(t);
  // 只在玩家附近激活刷怪点
  world.spawns.forEach(function (sp) {
    var near = false;
    for (var i = 0; i < online.length; i++) {
      if (Math.abs(online[i].x - sp.x) < C.ACTIVE_RADIUS && Math.abs(online[i].y - sp.y) < C.ACTIVE_RADIUS) { near = true; break; }
    }
    var ss = spawnState[sp.id];
    if (!near) {
      // 远离所有玩家：回收（下次靠近再生成）
      if (ss && ss.alive.length) { ss.alive.forEach(function (id) { delete mobs[id]; }); ss.alive = []; ss.deadAt = 0; }
      return;
    }
    if (!ss) ss = spawnState[sp.id] = { alive: [], deadAt: 0 };
    if (ss.alive.length) return;
    if (ss.deadAt && t - ss.deadAt < C.RESPAWN_MS) return;
    // 玩家站在刷怪点上时不刷（不会凭空出现在脸上）
    for (var j = 0; j < online.length; j++) if (dist(online[j].x, online[j].y, sp.x, sp.y) < 7) return;
    var elite = Math.random() < C.ELITE_CHANCE * (ph.night ? 1.6 : 1);
    var n = elite ? 1 : sp.n;
    for (var k = 0; k < n; k++) {
      var ox = n > 1 ? (Math.random() - 0.5) * 2.4 : 0, oy = n > 1 ? (Math.random() - 0.5) * 2.4 : 0;
      var lv = sp.lv + (ph.night ? 1 : 0);
      var m = spawnMob(sp.kind, sp.x + ox, sp.y + oy, lv, { elite: elite, spawn: sp.id, zone: sp.zone });
      if (m) ss.alive.push(m.id);
    }
  });
  // 夜晚：在玩家周围的暗处刷幽灵（不在灯光里）
  if (ph.night) {
    var ghostCount = 0;
    Object.keys(mobs).forEach(function (id) { if (mobs[id].kind === 'ghost') ghostCount++; });
    if (ghostCount < online.length * 3) {
      online.forEach(function (p) {
        if (p.safe || Math.random() > 0.35) return;
        var a = Math.random() * Math.PI * 2, r = 9 + Math.random() * 5;
        var gx = p.x + Math.cos(a) * r, gy = p.y + Math.sin(a) * r;
        if (inLight(gx, gy) || W.isBlocked(world, gx, gy)) return;
        var zi = world.zones[Math.floor(gy) * SIZE + Math.floor(gx)];
        var zid = W.ZONE_NAMES[zi];
        if (zid === 'town') return;
        var lvr = (D.ZONES.filter(function (z) { return z.id === zid; })[0] || { lv: [1, 3] }).lv;
        spawnMob('ghost', gx, gy, lvr[0] + 1, { zone: zid, night: true });
      });
    }
  }
}

// ---------------- 主循环 ----------------
var lastTick = now();
function tick() {
  var t = now();
  var dt = Math.min(0.25, (t - lastTick) / 1000);
  lastTick = t;
  spawnTick(t);
  // 只模拟被激活的怪（附近有人）
  Object.keys(mobs).forEach(function (id) {
    var m = mobs[id];
    if (!m) return;
    try { aiTick(m, dt, t); } catch (e) { delete mobs[id]; }
  });
  shotsTick(dt, t);
  // 倒地超时 → 死亡（回镇）
  Object.keys(players).forEach(function (uid) {
    var p = players[uid];
    if (p.down && !p.dead && t - p.down > C.DOWN_MS) {
      p.dead = t;
      events.push({ t: 'dead', u: uid });
      if (hooks.onDead) hooks.onDead(uid);
    }
    if (p.reviving && p.down) {
      var r = players[p.reviving.by];
      if (!r || dist(r.x, r.y, p.x, p.y) > 2.2) p.reviving = null;
      else if (t - p.reviving.at > C.REVIVE_MS) {
        p.down = 0; p.hp = Math.round(p.maxHp * 0.4); p.reviving = null;
        events.push({ t: 'revived', u: uid, by: r.uid });
        if (hooks.onRevive) hooks.onRevive(uid, r.uid);
      }
    }
    // 生命自然回复：脱战 5 秒后每秒 2%
    if (!p.down && p.hp < p.maxHp && (!p.hurtAt || t - p.hurtAt > 5000)) p.hp = Math.min(p.maxHp, p.hp + p.maxHp * 0.02 * dt * (p.safe ? 5 : 1));
  });
  if (hooks.onTick) hooks.onTick(t);
}

var timer = null;
function start(h) {
  hooks = h || {};
  // 热挂载会重新 require 本模块：旧实例的 setInterval 不会自己消失，
  // 两个 tick 同时跑 = 怪物双倍速 + CPU 翻倍。句柄挂到 global，start 先回收。
  var G = global.__shiguang5timer || (global.__shiguang5timer = {});
  if (timer || G.timer) { if (timer) clearInterval(timer); if (G.timer) clearInterval(G.timer); timer = null; G.timer = null; }
  timer = setInterval(tick, C.TICK_MS);
  G.timer = timer;
  if (timer.unref) timer.unref();
}
function stop() {
  var G = global.__shiguang5timer;
  if (timer) clearInterval(timer);
  if (G && G.timer) clearInterval(G.timer);
  timer = null;
  if (G) G.timer = null;
}

// 取出并清空事件
function drainEvents() { var e = events; events = []; return e; }

// 玩家视野内的实体快照（用于下发）
function snapshotFor(uid) {
  var p = players[uid];
  if (!p) return { mobs: [], shots: [] };
  var R = C.VIEW_RADIUS;
  var ms = [];
  Object.keys(mobs).forEach(function (id) {
    var m = mobs[id];
    if (Math.abs(m.x - p.x) > R || Math.abs(m.y - p.y) > R) return;
    ms.push([m.id, m.kind, round1(m.x), round1(m.y), m.hp, m.maxHp, m.lv, m.state, Math.round(m.face * 100) / 100,
      m.elite ? 1 : 0, m.boss ? 1 : 0, m.state === 'tell' ? Math.max(0, m.stateEnd - now()) : 0, m.moving ? 1 : 0,
      m.name || '']);
  });
  // 弹幕也要看得见，否则远程怪的光弹是「凭空掉血」
  var ss = [];
  for (var i = 0; i < shots.length; i++) {
    var s = shots[i];
    if (Math.abs(s.x - p.x) > R || Math.abs(s.y - p.y) > R) continue;
    ss.push([s.id, round1(s.x), round1(s.y), round1(s.vx), round1(s.vy), s.kind || '']);
  }
  return { mobs: ms, shots: ss };
}

// 玩家状态管理（routes 调用）
function upsertPlayer(uid, info) {
  var p = players[uid];
  if (!p) p = players[uid] = { uid: uid, x: info.x, y: info.y, hp: info.hp, maxHp: info.maxHp, seen: now() };
  for (var k in info) if (Object.prototype.hasOwnProperty.call(info, k)) p[k] = info[k];
  p.seen = now();
  var zi = world.zones[Math.floor(p.y) * SIZE + Math.floor(p.x)];
  p.zone = W.ZONE_NAMES[zi] || 'meadow';
  p.safe = p.zone === 'town';
  return p;
}
function removePlayer(uid) { delete players[uid]; }

// 灯光管理
function setLights(arr) { lights = arr.slice(); }
function addLight(L) { lights.push(L); }

module.exports = {
  world: world,
  mobs: mobs,
  players: players,
  start: start,
  stop: stop,
  dayPhase: dayPhase,
  drainEvents: drainEvents,
  snapshotFor: snapshotFor,
  upsertPlayer: upsertPlayer,
  removePlayer: removePlayer,
  playerHit: playerHit,
  spawnMob: spawnMob,
  killMob: killMob,
  setLights: setLights,
  addLight: addLight,
  inLight: inLight,
  damagePlayer: damagePlayer,
  _events: function () { return events; }
};
