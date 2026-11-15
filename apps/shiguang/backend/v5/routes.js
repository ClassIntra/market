// 拾光群岛 v5「长夜」—— HTTP 世界服务（服务端权威）
//
// 契约（与 v4 一致，别踩坑）：
//   · 客户端经宿主 axios 调用，baseURL 已是 /api —— 路径里**不要**再写 /api，
//     多写一层不会抛异常，只会表现为「世界里一个人都没有」。服务端 mountPath 是
//     /api/shiguang，所以本文件里的路由就是 /v5/xxx，客户端写 '/shiguang/v5/xxx'。
//   · 高频接口不配 backend.rateLimit（全校同一个 NAT 出口，一锁锁一个班）。
//     节流在应用内按 user_id 做。
//   · 一次 /sync 就是一次「我在这、给我附近的一切」：位置上报 + 视野快照 + 我的事件。
//     5Hz 轮询，全部走内存（存档每 5 秒批量落库），不打数据库热路径。
//
// 分工：
//   sim.js   怪物 AI / 投射物 / 命中校验 / 昼夜（纯内存，10Hz）
//   routes.js 玩家、成长、掉落、宝箱、灯塔、商店（本文件）
//   store.js 存档（SQLite，shiguang5_* 表）
'use strict';

var express = require('express');
var router = express.Router();
var host = require('_sdk/backend/host');
var db = host.db;
var auth = host.auth;
var realtimeBus = host.realtimeBus;

var C = require('./config');
var D = require('./data');
var W = require('./worldgen');
var L = require('./loot');
var S = require('./store');
var SIM = require('./sim');

var requireAuth = auth.requireAuth;
var world = SIM.world;
var SIZE = world.size;
// 广场正中（不是门口）：出生就站在空地上，四间房在视野里各占一角
var TOWN_SPAWN = { x: world.town.cx + 0.5, y: world.town.cy + 0.2 };

var APP = 'shiguang';
var EV = 'shiguang5.';

// 每个在线玩家的「待推送事件」与节流时间戳（不进存档，进程内即真相）
var pending = {};
var meta = {};       // uid -> { syncAt, lastHit, lastSkill, lastEmote, chatAt }

function nowMs() { return Date.now(); }
function num(v, d) { var n = Number(v); return isFinite(n) ? n : d; }
function round1(v) { return Math.round(v * 10) / 10; }
function dist(ax, ay, bx, by) { var dx = ax - bx, dy = ay - by; return Math.sqrt(dx * dx + dy * dy); }
function uid(req) { return String(req.user.user_id); }
function ok(res, data) { return res.json({ code: 200, data: data || {} }); }
function fail(res, msg, code) { return res.json({ code: code || 400, message: msg }); }

function zoneAt(x, y) {
  var xi = Math.floor(x), yi = Math.floor(y);
  if (xi < 0 || yi < 0 || xi >= SIZE || yi >= SIZE) return 'meadow';
  return W.ZONE_NAMES[world.zones[yi * SIZE + xi]] || 'meadow';
}
function zoneName(id) {
  for (var i = 0; i < D.ZONES.length; i++) if (D.ZONES[i].id === id) return D.ZONES[i].name;
  return id;
}
function walkable(x, y) { return !W.isBlocked(world, x, y); }

// NPC 站在自家门口（与客户端同一套算法，服务端用来校验交互距离）
function npcPos(kind) {
  var hs = world.town.houses;
  for (var i = 0; i < hs.length; i++) {
    if (hs[i].kind === kind) return { x: hs[i].x + hs[i].w / 2 + 0.62, y: hs[i].y + hs[i].h + 1.55 };
  }
  return null;
}

// 找最近的可走格：站在墙里时（地图改版、异常写入）先把人救出来，
// 否则客户端每一步都被拒绝，摇杆拖到底也一动不动。
function nearestWalkable(x, y) {
  var cx = Math.floor(x), cy = Math.floor(y);
  for (var r = 1; r <= 24; r++) {
    for (var dy = -r; dy <= r; dy++) {
      for (var dx = -r; dx <= r; dx++) {
        if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
        var nx = cx + dx, ny = cy + dy;
        if (nx < 1 || ny < 1 || nx >= SIZE - 1 || ny >= SIZE - 1) continue;
        if (!W.isBlocked(world, nx + 0.5, ny + 0.5)) return { x: nx + 0.5, y: ny + 0.5 };
      }
    }
  }
  return { x: TOWN_SPAWN.x, y: TOWN_SPAWN.y };
}

// ---------------- 存活状态 ----------------
// SIM.players 是「在线」，store.cache 是「存档」。两者由 ensureLive 缝合：
// 存档里的等级 / 装备 / 天赋算成一份 stats 挂在运行时玩家身上，
// 战斗、伤害上限、吸血都读它。
function ensureLive(id, rec) {
  var p = SIM.players[id];
  if (p) return p;
  var st = L.computeStats(rec);
  p = SIM.upsertPlayer(id, {
    x: rec.x, y: rec.y, hp: Math.min(rec.hp || st.hp, st.hp), maxHp: st.hp,
    mp: st.mp, maxMp: st.mp, stats: st, down: 0, dead: 0,
    name: S.userName(id), look: rec.look, level: rec.level || 1
  });
  return p;
}

function statsOf(id) {
  var rec = S.load(id, TOWN_SPAWN);
  var p = SIM.players[id];
  if (p && p.stats) return p.stats;
  return L.computeStats(rec);
}

// 刷新运行时属性（升级、换装、点天赋后调用）—— 保留当前血量比例
function refreshStats(id) {
  var rec = S.load(id, TOWN_SPAWN);
  var st = L.computeStats(rec);
  var p = SIM.players[id];
  if (!p) return st;
  var ratio = p.maxHp ? Math.max(0, p.hp) / p.maxHp : 1;
  p.stats = st;
  p.maxHp = st.hp;
  p.maxMp = st.mp;
  p.hp = Math.max(1, Math.min(st.hp, Math.round(st.hp * ratio)));
  return st;
}

function push(id, ev) {
  if (!pending[id]) pending[id] = [];
  if (pending[id].length > 80) return;
  pending[id].push(ev);
}
function drain(id) { var e = pending[id] || []; pending[id] = []; return e; }

function onlineIds() {
  var out = [];
  Object.keys(SIM.players).forEach(function (id) {
    var p = SIM.players[id];
    if (p && nowMs() - p.seen < C.ONLINE_TTL_MS) out.push(id);
  });
  return out;
}

function broadcast(event, payload, targetIds) {
  var ids = targetIds || onlineIds();
  if (!ids.length) return;
  try {
    realtimeBus.publishToUsers(ids, {
      type: 'extension_event',
      app_name: APP,
      event: EV + event,
      payload: payload,
      created_at: new Date().toISOString()
    });
  } catch (e) {}
}

// ---------------- 成长与奖励 ----------------
function xpAdd(rec, id, amount) {
  if (!amount) return 0;
  rec.xp = (rec.xp || 0) + amount;
  var ups = 0;
  while (rec.level < C.MAX_LEVEL && rec.xp >= L.xpToNext(rec.level)) {
    rec.xp -= L.xpToNext(rec.level);
    rec.level += 1;
    ups += 1;
  }
  if (rec.level >= C.MAX_LEVEL) rec.xp = Math.min(rec.xp, L.xpToNext(C.MAX_LEVEL) - 1);
  if (ups) {
    var st = refreshStats(id);
    var p = SIM.players[id];
    if (p) { p.hp = st.hp; p.mp = st.mp; }
    push(id, { k: 'lvup', lv: rec.level, hp: st.hp, mp: st.mp, talent: rec.level % C.TALENT_EVERY === 0 ? 1 : 0 });
    S.markDirty(id);
  }
  return ups;
}

function bagCap() { return 60; }
function bagAdd(rec, item) {
  if (!rec.bag) rec.bag = [];
  if (rec.bag.length >= bagCap()) return false;
  rec.bag.push(item);
  return true;
}

// 掉落：谁参与过伤害（且没跑太远）谁有份 —— 一起打不抢怪。
function grantKill(m, shares, killer, night) {
  var def = D.MONSTERS[m.kind] || {};
  var zone = m.zone || 'meadow';
  var mul = night ? C.NIGHT_LOOT_MUL : 1;
  var list = shares.slice();
  if (killer && list.indexOf(killer) < 0) list.push(killer);
  list.forEach(function (id) {
    var rec = S.load(id, TOWN_SPAWN);
    var p = SIM.players[id];
    if (!p) return;
    if (dist(p.x, p.y, m.x, m.y) > C.LOOT_SHARE_RADIUS) return;

    var xp = Math.round(m.xp * mul);
    var shards = Math.round((2 + m.lv * 1.6 + (m.elite ? 8 : 0) + (m.boss ? 260 : 0)) * mul * (0.75 + Math.random() * 0.5));
    rec.shards = (rec.shards || 0) + shards;
    xpAdd(rec, id, xp);

    // 材料
    var mats = D.ZONE_MATS[zone] || D.ZONE_MATS.meadow;
    var dropped = { shards: shards, xp: xp, mats: [], item: null };
    if (Math.random() < 0.55) {
      var mid = mats[Math.floor(Math.random() * mats.length)];
      rec.mats = rec.mats || {};
      rec.mats[mid] = (rec.mats[mid] || 0) + 1;
      dropped.mats.push([mid, 1]);
    }
    // 装备
    var chance = C.EQUIP_DROP_BASE + (m.elite ? 0.18 : 0) + (m.boss ? 1 : 0);
    if (Math.random() < chance) {
      var it = L.rollItem(Math.max(1, m.lv), {
        bonus: (m.elite ? 0.5 : 0) + (night ? 0.2 : 0) + (m.boss ? 1.4 : 0),
        minRarity: m.boss ? 2 : 0
      });
      if (bagAdd(rec, it)) {
        dropped.item = { name: it.name, rarity: it.rarity, slot: it.slot, kind: it.kind || '', atk: it.atk || 0, ilvl: it.ilvl, affixes: it.affixes };
        if (it.rarity >= 3) {
          S.feed('legend', id, S.userName(id) + ' 从' + zoneName(zone) + '带回了' + D.RARITY[it.rarity].name + '「' + it.name + '」');
        }
      } else {
        dropped.full = 1;
      }
      if (m.boss) {
        var it2 = L.rollItem(Math.max(1, m.lv), { bonus: 1, minRarity: 1, slot: 'charm' });
        bagAdd(rec, it2);
      }
    }
    // 图鉴：见过的怪
    rec.dex = rec.dex || {};
    var key = 'm_' + m.kind;
    rec.dex[key] = (rec.dex[key] || 0) + 1;
    rec.stats = rec.stats || {};
    rec.stats.kills = (rec.stats.kills || 0) + 1;

    push(id, { k: 'loot', s: dropped.shards, x: dropped.xp, m: dropped.mats, it: dropped.item, f: dropped.full || 0 });
    S.markDirty(id);
  });

  // 潮汐里击杀记个人贡献（世界 Boss 也一样，按贡献分奖励）
  if (m.tide) { list.forEach(function (id) { SOC.tideScore(id, m.boss ? 40 : 1); }); }
  // 洞窟试炼：打死守心的精英才算通关
  if (m.caveBoss && m.caveOwner) {
    var owner = m.caveOwner;
    var cv = caveTrials[owner];
    stopCave(owner);
    var crec = S.load(owner, TOWN_SPAWN);
    crec.flags = crec.flags || {};
    var d2 = new Date();
    crec.flags['cave_' + (cv ? cv.zone : m.zone)] = d2.getFullYear() + '-' + (d2.getMonth() + 1) + '-' + d2.getDate();
    var gift = 80 + Math.round(m.lv * 8);
    crec.shards = (crec.shards || 0) + gift;
    var cit = L.rollItem(Math.max(3, m.lv), { minRarity: 2 });
    bagAdd(crec, cit);
    S.markDirty(owner);
    push(owner, { k: 'cave-done', shards: gift, item: cit, n: zoneName(cv ? cv.zone : m.zone) });
    S.feed('cave', owner, S.userName(owner) + ' 清空了' + zoneName(cv ? cv.zone : m.zone) + '的洞窟');
  }
  // 支线进度（在某区打 N 只）
  if (SOC) SOC.onKill(m, list, killer, night);

  // 守护者：点亮灯塔（全服进度）。世界 Boss（潮汐首领）不点灯 —— 那是反扑，不是守护者。
  if (m.boss && m.bossZone && !m.world) {
    var first = S.lightTower(m.bossZone, killer || list[0] || '');
    var nm = S.userName(killer || list[0] || '');
    var zn = zoneName(m.bossZone);
    if (first) {
      // 全场广播：这不是一个人的进度
      broadcast('tower', { z: m.bossZone, by: nm, at: nowMs() });
      S.feed('tower', killer || '', zn + '的灯塔亮了 —— ' + nm + ' 打倒了' + (D.BOSSES[m.bossZone] ? D.BOSSES[m.bossZone].name : '守护者'));
      // 点亮的一刻，全班都拿到一小份「守夜补给」
      var ids = onlineIds();
      ids.forEach(function (id) {
        var rec = S.load(id, TOWN_SPAWN);
        rec.shards = (rec.shards || 0) + 40;
        S.markDirty(id);
        push(id, { k: 'tower', z: m.bossZone, n: zn, b: nm });
      });
    } else {
      S.feed('tower', killer || '', nm + ' 又一次守住了' + zn + '的灯塔');
    }
    refreshLights();
  }
}

// 灯光：镇子 + 已点亮灯塔 + 玩家放的守夜灯
function refreshLights() {
  var lights = [{ x: world.town.cx, y: world.town.cy, r: 15 }];
  var tw = S.towers();
  Object.keys(tw).forEach(function (z) {
    var t = world.landmarks.towers[z];
    if (t) lights.push({ x: t.x, y: t.y, r: 11 });
  });
  SIM.setLights(lights);
}

SIM.start({
  onKill: grantKill,
  onDown: function (id) {
    push(id, { k: 'down' });
  },
  onDead: function (id) {
    push(id, { k: 'dead' });
  },
  onRevive: function (id, by) {
    push(id, { k: 'revived', by: S.userName(by) });
    push(by, { k: 'revived-other', n: S.userName(id) });
    // 被人从地上拉起来，比一起打十只怪更值得记住
    try { if (SOC) SOC.bondAdd(id, by, 8); } catch (e) {}
  }
});
try { refreshLights(); } catch (e) {}

// sim 内部的事件数组只用于「当场广播」，没有人消费时必须倒掉，
// 否则 10Hz × 每 tick 若干条会一直涨到进程 OOM。
(function () {
  var G = global.__shiguang5drain || (global.__shiguang5drain = {});
  if (G.timer) { try { clearInterval(G.timer); } catch (e) {} }
  G.timer = setInterval(function () {
    try { SIM.drainEvents(); } catch (e) {}
    try { SOC.tick(); } catch (e) { console.error('[shiguang5] social tick', e.message); }
  }, 2000);
  if (G.timer.unref) G.timer.unref();
})();

// ---------------- 一起玩：组队 / 支线 / 潮汐 / 洞窟 ----------------
var caveTrials = {};        // uid -> { zone, at, mobs: [], bossId, timer }
var caveDoneToday = {};     // uid -> { zone: day }

function caveBusy(id) { return !!caveTrials[id]; }
function startCave(id, zone, mobs, bossId) {
  if (caveTrials[id]) stopCave(id);
  caveTrials[id] = { zone: zone, at: nowMs(), mobs: mobs, bossId: bossId };
  // 3 分钟没人打完就撤（否则洞里会堆一地没人管的怪）
  caveTrials[id].timer = setTimeout(function () {
    if (caveTrials[id]) { stopCave(id); push(id, { k: 'cave', n: zoneName(zone), left: 0, fail: 1 }); }
  }, 180000);
  if (caveTrials[id].timer.unref) caveTrials[id].timer.unref();
}
function stopCave(id) {
  var t = caveTrials[id];
  if (!t) return;
  if (t.timer) clearTimeout(t.timer);
  (t.mobs || []).forEach(function (mid) { var m = SIM.mobs[mid]; if (m) SIM.killMob(m, null, true); });
  delete caveTrials[id];
}

var SOC = require('./social')({
  router: router, S: S, SIM: SIM, world: world, requireAuth: requireAuth,
  uidOf: uid, ok: ok, fail: fail, nowMs: nowMs, broadcast: broadcast, onlineIds: onlineIds,
  push: push, bagAdd: bagAdd, xpAdd: xpAdd, zoneAt: zoneAt, zoneName: zoneName,
  TOWN_SPAWN: TOWN_SPAWN, meta: meta,
  npcPos: npcPos, caveBusy: caveBusy, startCave: startCave,
  isBlockedWorld: function (x, y) { return W.isBlocked(world, x, y); }
});

// ---------------- 地形（一次，客户端缓存） ----------------
var TERRAIN_VERSION = 6;   // 5.1：地形包里加了洞窟与支线定义，旧缓存必须失效
router.get('/v5/terrain', function (req, res) {
  ok(res, {
    version: TERRAIN_VERSION,
    size: SIZE,
    cells: world.encoded,
    zones: world.zonesEncoded,
    town: world.town,
    towers: world.landmarks.towers,
    waystones: world.landmarks.waystones,
    chests: world.landmarks.chests,
    caves: world.landmarks.caves,
    zonesMeta: D.ZONES,
    quests: D.QUESTS,
    tile: W.TILE,
    dayMs: C.DAY_MS,
    lights: S.towers()
  });
});

// ---------------- 进入世界 ----------------
router.post('/v5/enter', requireAuth, function (req, res) {
  var id = uid(req);
  var rec;
  try { rec = S.load(id, TOWN_SPAWN); } catch (e) { return fail(res, '世界暂时进不去，再试一次', 500); }

  // 自愈：坐标不可走 / 越界 → 挪到最近的可走格并落库
  if (!walkable(rec.x, rec.y)) {
    var safe = nearestWalkable(rec.x, rec.y);
    console.log('[shiguang5] 自愈：%s 卡在 %s,%s → %s,%s', id, rec.x, rec.y, safe.x, safe.y);
    rec.x = safe.x; rec.y = safe.y;
    S.markDirty(id);
  }

  var p = ensureLive(id, rec);
  p.hp = Math.max(1, Math.min(p.maxHp, rec.hp || p.maxHp));
  p.down = 0; p.dead = 0;
  p.seen = nowMs();

  var st = p.stats;
  var towers = S.towers();
  var online = [];
  Object.keys(SIM.players).forEach(function (oid) {
    var o = SIM.players[oid];
    if (oid === id || !o || nowMs() - o.seen > C.ONLINE_TTL_MS) return;
    online.push([oid, o.name || S.userName(oid), round1(o.x), round1(o.y), Math.round((o.face || 0) * 100) / 100,
      o.look || 'NinjaBlue', Math.max(0, Math.round(o.hp)), Math.round(o.maxHp), o.down ? 1 : 0, o.level || 1]);
  });

  // 下一个该点亮的灯塔 —— 目标指引（客户端显示在 HUD 上）
  var goal = null;
  var order = ['meadow', 'forest', 'swamp', 'crag', 'frost', 'abyss'];
  for (var i = 0; i < order.length; i++) {
    if (!towers[order[i]]) {
      var z = order[i];
      var tw = world.landmarks.towers[z];
      goal = { zone: z, name: zoneName(z), x: tw.x, y: tw.y, boss: D.BOSSES[z] ? D.BOSSES[z].name : '', idx: i + 1, total: order.length };
      break;
    }
  }

  ok(res, {
    me: {
      id: id, x: round1(p.x), y: round1(p.y), hp: Math.round(p.hp), maxHp: st.hp, mp: st.mp, maxMp: st.mp,
      lv: rec.level, xp: rec.xp, xpNext: L.xpToNext(rec.level), shards: rec.shards || 0,
      look: rec.look, name: S.userName(id), zone: zoneAt(p.x, p.y),
      stats: { atk: st.atk, crit: st.crit, critDmg: st.critDmg, leech: st.leech, mpGain: st.mpGain, speed: st.speed, dodgeCd: st.dodgeCd, skill: st.skill, night: st.night, weaponKind: st.weaponKind },
      equip: rec.equip, bag: rec.bag, mats: rec.mats, talents: rec.talents, skills: rec.skills,
      waystones: rec.waystones || ['ws_town'], dex: rec.dex || {}, isNew: !!rec.isNew
    },
    players: online,
    towers: towers,
    chests: S.openedChests(id),
    feed: S.recentFeed(20),
    party: SOC.partyPayload(id),
    quests: SOC.questState(id),
    tide: SOC.tideState(),
    caves: world.landmarks.caves,
    friends: SOC.friendList(id),
    friendReq: SOC.pendingFriendReqs(id),
    bonds: SOC.bondsOf(id),
    nearby: SOC.nearbyList(id, 20),
    acts: SOC.ACTS,
    goal: goal,
    phase: SIM.dayPhase(),
    serverNow: nowMs()
  });
});

// ---------------- 同步（5Hz 心跳 + 视野快照） ----------------
router.post('/v5/sync', requireAuth, function (req, res) {
  var id = uid(req);
  var rec = S.load(id, TOWN_SPAWN);
  var p = ensureLive(id, rec);
  var t = nowMs();
  var b = req.body || {};
  var m = meta[id] || (meta[id] = {});
  if (m.syncAt && t - m.syncAt < C.SYNC_MIN_GAP_MS) {
    // 太密了：不推开销，直接回一份「什么都没变」
    return ok(res, { thin: 1, t: t, ph: SIM.dayPhase().name });
  }
  m.syncAt = t;

  // ---- 位置校验：客户端算手感，服务端算合法性 ----
  var nx = num(b.x, p.x), ny = num(b.y, p.y);
  var dt = Math.max(0.08, Math.min(1.5, (t - (p.syncAt || t - 200)) / 1000));
  p.syncAt = t;
  var maxD = C.MAX_SPEED * dt + 1.6;
  var d = dist(nx, ny, p.x, p.y);
  var corrected = 0;
  if (!isFinite(nx) || !isFinite(ny)) { nx = p.x; ny = p.y; corrected = 1; }
  if (d > maxD) {
    nx = p.x + (nx - p.x) / (d || 1) * maxD;
    ny = p.y + (ny - p.y) / (d || 1) * maxD;
    corrected = 1;
  }
  if (walkable(nx, p.y)) p.x = nx; else corrected = 1;
  if (walkable(p.x, ny)) p.y = ny; else corrected = 1;

  p.seen = t;
  p.face = num(b.f, p.face || 0);
  p.moving = b.mv ? 1 : 0;
  if (b.mp != null) p.mp = Math.max(0, Math.min(p.maxMp, num(b.mp, p.mp)));
  if (b.roll != null) {
    // 翻滚的无敌窗：服务端只信「冷却规则内」的声明
    var rt = num(b.roll, 0);
    if (rt && (!p.rollAt || t - p.rollAt > 420)) p.rollAt = t - Math.min(120, num(b.rt, 0));
    p.invUntil = t + 220;
  }
  var zone = zoneAt(p.x, p.y);
  if (zone !== p.zone) {
    p.zone = zone;
    push(id, { k: 'zone', z: zone, n: zoneName(zone) });
  }
  p.safe = zone === 'town';
  p.level = rec.level;

  // ---- 守护者：走到未点亮灯塔前，把它叫醒 ----
  var towers = S.towers();
  Object.keys(world.landmarks.towers).forEach(function (z) {
    if (towers[z]) return;
    var tw = world.landmarks.towers[z];
    if (dist(p.x, p.y, tw.x, tw.y) > 13) return;
    var bossAlive = false;
    Object.keys(SIM.mobs).forEach(function (k) {
      var mm = SIM.mobs[k];
      if (mm && mm.boss && mm.bossZone === z) bossAlive = true;
    });
    if (bossAlive) return;
    var B = D.BOSSES[z];
    if (!B) return;
    var bm = SIM.spawnMob('cyclope', tw.x + 0.5, tw.y - 3.5, B.lv, { boss: B, zone: z });
    if (bm) {
      push(id, { k: 'boss', n: B.name, z: z, title: B.title || '' });
      broadcast('boss', { z: z, n: B.name, by: S.userName(id) }, onlineIds().filter(function (o) { return o !== id; }));
    }
  });

  // ---- 快照 ----
  var snap = SIM.snapshotFor(id);
  var players = [];
  Object.keys(SIM.players).forEach(function (oid) {
    if (oid === id) return;
    var o = SIM.players[oid];
    if (!o || t - o.seen > C.ONLINE_TTL_MS) return;
    if (Math.abs(o.x - p.x) > C.VIEW_RADIUS || Math.abs(o.y - p.y) > C.VIEW_RADIUS) return;
    players.push([oid, o.name || S.userName(oid), round1(o.x), round1(o.y),
      Math.round((o.face || 0) * 100) / 100, o.look || 'NinjaBlue',
      Math.max(0, Math.round(o.hp)), Math.round(o.maxHp), o.down ? 1 : 0, o.level || 1, o.moving ? 1 : 0]);
  });

  var ph = SIM.dayPhase();
  var tideNow = SOC.tideState();
  var out = {
    t: t,
    ph: ph.name,
    pf: Math.round(ph.f * 1000) / 1000,
    me: [round1(p.x), round1(p.y), Math.max(0, Math.round(p.hp)), Math.round(p.maxHp),
      Math.round(p.mp || 0), Math.round(p.maxMp || 0), rec.level, rec.xp, L.xpToNext(rec.level),
      rec.shards || 0, p.down ? 1 : 0, p.dead ? 1 : 0],
    m: snap.mobs,
    s: snap.shots,
    p: players,
    pt: SOC.partyPayload(id),
    td: tideNow ? [tideNow.zone, tideNow.until, tideNow.wave] : null,
    ev: drain(id),
    c: corrected
  };
  ok(res, out);
});

// ---------------- 命中上报 ----------------
// 客户端判定命中（零延迟手感），服务端校验距离 / 频率 / 伤害上限。
function applyHits(id, list, kind) {
  var p = SIM.players[id];
  if (!p) return { hits: 0 };
  var st = p.stats || statsOf(id);
  var n = 0;
  for (var i = 0; i < list.length && i < 24; i++) {
    var h = list[i];
    if (!h || !h.m) continue;
    var r = SIM.playerHit(id, {
      mobId: String(h.m), dmg: num(h.d, 0), crit: !!h.c, kind: kind,
      kx: num(h.kx, 0), ky: num(h.ky, 0), heavy: !!h.h
    }, st);
    if (r) n++;
  }
  // 命中回灯火
  if (n) {
    var gain = 2.2 * n * (1 + (st.mpGain || 0) / 100);
    p.mp = Math.min(p.maxMp || st.mp, (p.mp || 0) + gain);
  }
  return { hits: n };
}

router.post('/v5/hit', requireAuth, function (req, res) {
  var id = uid(req);
  var m = meta[id] || (meta[id] = {});
  var t = nowMs();
  if (m.lastHit && t - m.lastHit < C.HIT_MIN_GAP_MS) return ok(res, { thin: 1 });
  m.lastHit = t;
  var b = req.body || {};
  // 一次三连可能同时扫到 2~3 只怪：允许 list，一次报完省往返
  var list = Array.isArray(b.list) ? b.list : [b];
  var r = applyHits(id, list, String(b.kind || 'melee'));
  ok(res, r);
});

// 范围技（灯火回旋 / 星爆）：一次上报多个目标，服务端逐个校验
router.post('/v5/skill', requireAuth, function (req, res) {
  var id = uid(req);
  var b = req.body || {};
  var rec = S.load(id, TOWN_SPAWN);
  var p = SIM.players[id];
  if (!p) return fail(res, '还没进入世界', 409);
  var kind = String(b.k || 'spin');
  var def = D.SKILLS[kind];
  if (!def) return fail(res, '没有这个技能');
  var m = meta[id] || (meta[id] = {});
  var t = nowMs();
  if (m.lastSkill && t - m.lastSkill < def.cd * 0.8) return fail(res, '技能还在冷却', 429);
  if ((rec.skills || []).indexOf(kind) < 0) return fail(res, '还没学会这个技能');
  if ((p.mp || 0) < def.mp) return fail(res, '灯火不够', 428);
  m.lastSkill = t;
  p.mp -= def.mp;

  var list = Array.isArray(b.list) ? b.list : [];
  var r = applyHits(id, list, 'skill');
  // 守夜灯：真的放一盏灯
  if (kind === 'lamp') {
    SIM.addLight({ x: p.x, y: p.y, r: def.radius || 4, until: t + (def.dur || 12000) });
  }
  ok(res, { hits: r.hits, mp: Math.round(p.mp) });
});

// ---------------- 宝箱 ----------------
router.post('/v5/chest', requireAuth, function (req, res) {
  var id = uid(req);
  var b = req.body || {};
  var chestId = String(b.id || '');
  var chest = null;
  for (var i = 0; i < world.landmarks.chests.length; i++) {
    if (world.landmarks.chests[i].id === chestId) { chest = world.landmarks.chests[i]; break; }
  }
  if (!chest) return fail(res, '这里没有箱子');
  var p = SIM.players[id];
  if (!p || dist(p.x, p.y, chest.x + 0.5, chest.y + 0.5) > 2.6) return fail(res, '离得太远了');
  if (S.chestOpened(id, chestId)) return fail(res, '这个箱子你已经开过了');

  var rec = S.load(id, TOWN_SPAWN);
  S.openChest(id, chestId);
  var tier = chest.tier | 0;
  var lv = 1;
  var zd = D.ZONES.filter(function (z) { return z.id === chest.zone; })[0];
  if (zd) lv = zd.lv[1];
  var shards = Math.round((18 + tier * 26) * (0.8 + Math.random() * 0.6));
  rec.shards = (rec.shards || 0) + shards;
  var item = L.rollItem(Math.max(1, lv - 1), { minRarity: tier, bonus: tier * 0.8 });
  var got = bagAdd(rec, item);
  // 材料包
  var mats = D.ZONE_MATS[chest.zone] || D.ZONE_MATS.meadow;
  var mid = mats[Math.floor(Math.random() * mats.length)];
  rec.mats = rec.mats || {};
  rec.mats[mid] = (rec.mats[mid] || 0) + (2 + tier);
  S.markDirty(id);
  ok(res, {
    shards: shards,
    item: got ? { name: item.name, rarity: item.rarity, slot: item.slot, kind: item.kind || '', atk: item.atk || 0, ilvl: item.ilvl, affixes: item.affixes } : null,
    full: got ? 0 : 1,
    mat: [mid, 2 + tier]
  });
});

// ---------------- 传送石 ----------------
router.post('/v5/waystone', requireAuth, function (req, res) {
  var id = uid(req);
  var b = req.body || {};
  var wp = null;
  for (var i = 0; i < world.landmarks.waystones.length; i++) {
    if (world.landmarks.waystones[i].id === b.id) { wp = world.landmarks.waystones[i]; break; }
  }
  if (!wp) return fail(res, '没有这块传送石');
  var p = SIM.players[id];
  if (!p || dist(p.x, p.y, wp.x + 0.5, wp.y + 0.5) > 3.2) return fail(res, '离得太远了');
  var rec = S.load(id, TOWN_SPAWN);
  rec.waystones = rec.waystones || ['ws_town'];
  var fresh = rec.waystones.indexOf(wp.id) < 0;
  if (fresh) rec.waystones.push(wp.id);
  rec.x = wp.x + 0.5; rec.y = wp.y + 1.5;
  if (!walkable(rec.x, rec.y)) { var s2 = nearestWalkable(rec.x, rec.y); rec.x = s2.x; rec.y = s2.y; }
  p.x = rec.x; p.y = rec.y;
  S.markDirty(id);
  ok(res, { fresh: fresh, id: wp.id, x: round1(rec.x), y: round1(rec.y), stones: rec.waystones });
});

router.post('/v5/travel', requireAuth, function (req, res) {
  var id = uid(req);
  var b = req.body || {};
  var rec = S.load(id, TOWN_SPAWN);
  var p = SIM.players[id];
  if (!p) return fail(res, '还没进入世界', 409);
  if ((rec.waystones || []).indexOf(b.id) < 0) return fail(res, '这块传送石还没点亮');
  var wp = null;
  for (var i = 0; i < world.landmarks.waystones.length; i++) {
    if (world.landmarks.waystones[i].id === b.id) { wp = world.landmarks.waystones[i]; break; }
  }
  if (!wp) return fail(res, '没有这块传送石');
  if (p.down) return fail(res, '倒地时不能传送');
  rec.x = wp.x + 0.5; rec.y = wp.y + 1.5;
  if (!walkable(rec.x, rec.y)) { var s2 = nearestWalkable(rec.x, rec.y); rec.x = s2.x; rec.y = s2.y; }
  p.x = rec.x; p.y = rec.y;
  S.markDirty(id);
  ok(res, { x: round1(rec.x), y: round1(rec.y), zone: wp.zone });
});

// ---------------- 商店（拾光镇杂货铺） ----------------
var SHOP = [
  { id: 'potion', price: 15 },
  { id: 'ether', price: 12 }
];

router.post('/v5/shop', requireAuth, function (req, res) {
  var id = uid(req);
  var b = req.body || {};
  var row = null;
  for (var i = 0; i < SHOP.length; i++) if (SHOP[i].id === b.id) row = SHOP[i];
  if (!row) return fail(res, '没有这件货');
  var p = SIM.players[id];
  if (!p || zoneAt(p.x, p.y) !== 'town') return fail(res, '回拾光镇再买');
  var rec = S.load(id, TOWN_SPAWN);
  var n = Math.max(1, Math.min(99, num(b.n, 1)));
  var cost = row.price * n;
  if ((rec.shards || 0) < cost) return fail(res, '星屑不够');
  rec.shards -= cost;
  rec.mats = rec.mats || {};
  rec.mats[row.id] = (rec.mats[row.id] || 0) + n;
  S.markDirty(id);
  ok(res, { shards: rec.shards, mats: rec.mats });
});

router.post('/v5/use', requireAuth, function (req, res) {
  var id = uid(req);
  var b = req.body || {};
  var rec = S.load(id, TOWN_SPAWN);
  var p = SIM.players[id];
  if (!p) return fail(res, '还没进入世界', 409);
  var item = D.ITEMS[b.id];
  if (!item || !item.use) return fail(res, '这个不能用');
  if (!rec.mats || !rec.mats[b.id]) return fail(res, '没有了');
  if (p.down) return fail(res, '倒地时不能吃药');
  rec.mats[b.id] -= 1;
  if (rec.mats[b.id] <= 0) delete rec.mats[b.id];
  if (item.use.heal) p.hp = Math.min(p.maxHp, p.hp + p.maxHp * item.use.heal);
  if (item.use.mp) p.mp = Math.min(p.maxMp, (p.mp || 0) + p.maxMp * item.use.mp);
  rec.hp = Math.round(p.hp);
  S.markDirty(id);
  ok(res, { hp: Math.round(p.hp), mp: Math.round(p.mp), mats: rec.mats });
});

// ---------------- 装备 / 背包 ----------------
router.post('/v5/equip', requireAuth, function (req, res) {
  var id = uid(req);
  var b = req.body || {};
  var rec = S.load(id, TOWN_SPAWN);
  var idx = -1;
  for (var i = 0; i < (rec.bag || []).length; i++) if (rec.bag[i].uid === b.uid) { idx = i; break; }
  if (idx < 0) return fail(res, '背包里没有它');
  var it = rec.bag[idx];
  var slot = it.slot;
  if (!slot) return fail(res, '这件装备不能穿');
  rec.equip = rec.equip || {};
  var old = rec.equip[slot];
  rec.equip[slot] = it;
  rec.bag.splice(idx, 1);
  if (old) rec.bag.push(old);
  var st = refreshStats(id);
  S.markDirty(id);
  ok(res, { equip: rec.equip, bag: rec.bag, stats: st, hp: Math.round((SIM.players[id] || {}).hp || 0), maxHp: st.hp });
});

router.post('/v5/unequip', requireAuth, function (req, res) {
  var id = uid(req);
  var b = req.body || {};
  var rec = S.load(id, TOWN_SPAWN);
  var slot = String(b.slot || '');
  rec.equip = rec.equip || {};
  if (!rec.equip[slot]) return fail(res, '这个位置没有东西');
  if ((rec.bag || []).length >= bagCap()) return fail(res, '背包满了');
  rec.bag = rec.bag || [];
  rec.bag.push(rec.equip[slot]);
  delete rec.equip[slot];
  var st = refreshStats(id);
  S.markDirty(id);
  ok(res, { equip: rec.equip, bag: rec.bag, stats: st, maxHp: st.hp });
});

router.post('/v5/sell', requireAuth, function (req, res) {
  var id = uid(req);
  var b = req.body || {};
  var rec = S.load(id, TOWN_SPAWN);
  var list = Array.isArray(b.uids) ? b.uids : (b.uid ? [b.uid] : []);
  var gain = 0, sold = 0;
  for (var i = 0; i < list.length; i++) {
    for (var j = 0; j < (rec.bag || []).length; j++) {
      if (rec.bag[j].uid !== list[i]) continue;
      gain += L.sellPrice(rec.bag[j]);
      rec.bag.splice(j, 1);
      sold++;
      break;
    }
  }
  if (!sold) return fail(res, '没有可卖的东西');
  rec.shards = (rec.shards || 0) + gain;
  S.markDirty(id);
  ok(res, { sold: sold, gain: gain, shards: rec.shards, bag: rec.bag });
});

// ---------------- 锻造（重铸词条 / 打造） ----------------
// 铁匠：给一件已有装备「重铸词条」，消耗星屑 + 材料。
// 这是星屑最主要的出口，也是中后期的乐趣：为了一条好词条反复重铸。
var FORGE_COST = 30;
router.post('/v5/forge', requireAuth, function (req, res) {
  var id = uid(req);
  var b = req.body || {};
  var p = SIM.players[id];
  if (!p || zoneAt(p.x, p.y) !== 'town') return fail(res, '回拾光镇的铁匠铺再打');
  var rec = S.load(id, TOWN_SPAWN);
  var slot = String(b.slot || '');
  var it = (rec.equip || {})[slot];
  if (!it) return fail(res, '这个位置没有装备');
  var cost = FORGE_COST * (1 + (it.ilvl | 0));
  if ((rec.shards || 0) < cost) return fail(res, '星屑不够（要 ' + cost + '）');
  var mat = b.mat ? String(b.mat) : 'ore';
  if (!rec.mats || !rec.mats[mat]) return fail(res, '缺材料：' + ((D.ITEMS[mat] || {}).name || mat));
  rec.shards -= cost;
  rec.mats[mat] -= 1;
  if (rec.mats[mat] <= 0) delete rec.mats[mat];

  // 重铸 = 保留底子与稀有度，重抽词条（数值可能更好也可能更差）
  var fresh = L.rollItem(it.ilvl, { slot: slot, minRarity: it.rarity });
  fresh.uid = it.uid;
  fresh.base = it.base;
  fresh.name = it.name;
  fresh.rarity = it.rarity;
  fresh.atk = it.atk;
  if (it.lore) fresh.lore = it.lore;
  rec.equip[slot] = fresh;
  refreshStats(id);
  S.markDirty(id);
  ok(res, { item: fresh, equip: rec.equip, shards: rec.shards, mats: rec.mats, cost: cost });
});

// ---------------- 天赋 ----------------
router.post('/v5/talent', requireAuth, function (req, res) {
  var id = uid(req);
  var b = req.body || {};
  var line = String(b.line || '');
  var tiers = D.TALENTS[line];
  if (!tiers) return fail(res, '没有这条天赋线');
  var rec = S.load(id, TOWN_SPAWN);
  rec.talents = rec.talents || {};
  var cur = rec.talents[line] || 0;
  if (cur >= tiers.tiers.length) return fail(res, '这条线已经点满');
  // 可用点数 = 总点数（每 3 级 1 点） - 已用
  var total = Math.floor((rec.level || 1) / C.TALENT_EVERY);
  var used = 0;
  Object.keys(rec.talents).forEach(function (k) { used += rec.talents[k] || 0; });
  if (used >= total) return fail(res, '没有天赋点了（每 ' + C.TALENT_EVERY + ' 级 1 点）');
  rec.talents[line] = cur + 1;
  var st = refreshStats(id);
  S.markDirty(id);
  ok(res, { talents: rec.talents, tier: D.TALENTS[line].tiers[cur], stats: st, left: total - used - 1, maxHp: st.hp });
});

// ---------------- 外观（镇上换装） ----------------
router.post('/v5/look', requireAuth, function (req, res) {
  var id = uid(req);
  var b = req.body || {};
  var p = SIM.players[id];
  if (!p || zoneAt(p.x, p.y) !== 'town') return fail(res, '回拾光镇再换');
  var look = String(b.look || '');
  if (S.LOOKS.indexOf(look) < 0) return fail(res, '没有这个外观');
  var rec = S.load(id, TOWN_SPAWN);
  rec.look = look;
  p.look = look;
  S.markDirty(id);
  ok(res, { look: look });
});

// ---------------- 复活 ----------------
router.post('/v5/respawn', requireAuth, function (req, res) {
  var id = uid(req);
  var rec = S.load(id, TOWN_SPAWN);
  var p = SIM.players[id];
  if (!p) return fail(res, '还没进入世界', 409);
  if (!p.down && !p.dead) return ok(res, { x: rec.x, y: rec.y, hp: Math.round(p.hp) });
  p.down = 0; p.dead = 0;
  p.x = TOWN_SPAWN.x; p.y = TOWN_SPAWN.y;
  p.hp = Math.max(1, Math.round(p.maxHp * C.RESPAWN_HP_RATIO));
  p.mp = p.maxMp;
  rec.x = p.x; rec.y = p.y; rec.hp = Math.round(p.hp);
  S.markDirty(id);
  ok(res, { x: p.x, y: p.y, hp: Math.round(p.hp), mp: Math.round(p.mp) });
});

// ---------------- 详情 / 日志 / 离开 ----------------
router.get('/v5/profile', requireAuth, function (req, res) {
  var id = uid(req);
  var rec = S.load(id, TOWN_SPAWN);
  var st = L.computeStats(rec);
  var total = Math.floor((rec.level || 1) / C.TALENT_EVERY);
  var used = 0;
  (function () { Object.keys(rec.talents || {}).forEach(function (k) { used += rec.talents[k] || 0; }); })();
  ok(res, {
    me: rec, stats: st, xpNext: L.xpToNext(rec.level), quests: SOC.questState(id),
    party: SOC.partyPayload(id), tide: SOC.tideState(),
    friends: SOC.friendList(id), bonds: SOC.bondsOf(id), social: SOC.socialState(id),
    talentLeft: Math.max(0, total - used),
    towers: S.towers(),
    chestTotal: world.landmarks.chests.length,
    chestDone: S.openedChests(id).length
  });
});

router.get('/v5/feed', function (req, res) {
  ok(res, { feed: S.recentFeed(30) });
});

router.post('/v5/leave', requireAuth, function (req, res) {
  var id = uid(req);
  try { SOC.partyMembers(id); } catch (e) {}
  S.flush(id);
  SIM.removePlayer(id);
  delete pending[id];
  delete meta[id];
  ok(res, {});
});

module.exports = router;
module.exports.APP = APP;
// 测试钩子：潮汐/洞窟是「定时器 + 世界事件」，验收时需要能手动触发一次
module.exports.SOC = SOC;
module.exports.SIM = SIM;
module.exports.STORE = S;
