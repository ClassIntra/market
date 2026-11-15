// 拾光群岛 v5 —— 一起玩：组队 / 扶起 / 表情 / 支线 / 长夜潮汐 / 洞窟试炼
//
// 为什么单独一个文件：routes.js 已经负责「一个人怎么活」（位置、战斗、成长），
// 这里负责「一群人怎么一起活」。两件事的失败模式完全不同 —— 前者是数值与校验，
// 后者是广播、超时和「他掉线了怎么办」。混在一起会互相牵连。
//
// 约定：本模块不直接建表，全部复用 shiguang5_players 里的 JSON 列（talents/quests/flags）。
'use strict';

var C = require('./config');
var D = require('./data');
var L = require('./loot');

module.exports = function createSocial(ctx) {
  var router = ctx.router;
  var S = ctx.S;
  var SIM = ctx.SIM;
  var world = ctx.world;
  var requireAuth = ctx.requireAuth;
  var uidOf = ctx.uidOf;
  var ok = ctx.ok;
  var fail = ctx.fail;
  var nowMs = ctx.nowMs;
  var broadcast = ctx.broadcast;
  var onlineIds = ctx.onlineIds;
  var push = ctx.push;
  var bagAdd = ctx.bagAdd;
  var xpAdd = ctx.xpAdd;
  var zoneAt = ctx.zoneAt;
  var zoneName = ctx.zoneName;
  var TOWN_SPAWN = ctx.TOWN_SPAWN;

  // social.js 不依赖 routes.js 的工具函数：距离自己算，免得跨文件隐式耦合
  function dist(ax, ay, bx, by) { var dx = ax - bx, dy = ay - by; return Math.sqrt(dx * dx + dy * dy); }

  // ---------------- 组队 ----------------
  var parties = {};      // pid -> { id, leader, members: [uid], at }
  var partyOf = {};      // uid -> pid
  var invites = {};      // uid -> { from, at, pid }
  var partySeq = 1;

  function newParty(leader) {
    var pid = 'p' + (partySeq++);
    parties[pid] = { id: pid, leader: leader, members: [leader], at: nowMs() };
    partyOf[leader] = pid;
    return parties[pid];
  }
  function partyMembers(uid) {
    var pid = partyOf[uid];
    if (!pid || !parties[pid]) return [];
    return parties[pid].members.slice();
  }
  function leaveParty(uid) {
    var pid = partyOf[uid];
    if (!pid || !parties[pid]) return;
    var p = parties[pid];
    p.members = p.members.filter(function (m) { return m !== uid; });
    delete partyOf[uid];
    if (!p.members.length) { delete parties[pid]; return; }
    if (p.leader === uid) p.leader = p.members[0];
    // 队长换了要通知剩下的人
    p.members.forEach(function (m) { push(m, { k: 'party', n: '队长换成了 ' + S.userName(p.leader) }); });
  }
  function partyPayload(uid) {
    var pid = partyOf[uid];
    if (!pid || !parties[pid]) return null;
    var p = parties[pid];
    return {
      id: pid,
      leader: p.leader,
      members: p.members.map(function (m) {
        var rec = S.load(m, TOWN_SPAWN);
        var live = SIM.players[m];
        return [m, S.userName(m), live ? Math.round(live.hp) : (rec.hp | 0),
          live ? Math.round(live.maxHp) : (rec.level ? 60 + 12 * (rec.level - 1) : 60),
          live && live.down ? 1 : 0, rec.level, !!live];
      })
    };
  }

  router.post('/v5/party/invite', requireAuth, function (req, res) {
    var id = uidOf(req);
    var to = String((req.body && req.body.to) || '');
    if (!to || to === id) return fail(res, '不能邀请自己');
    if (partyMembers(id).length >= C.PARTY_MAX) return fail(res, '队伍满了（最多 ' + C.PARTY_MAX + ' 人）');
    if (partyMembers(to).length >= C.PARTY_MAX) return fail(res, '对方队伍满了');
    var live = SIM.players[to];
    if (!live || nowMs() - live.seen > C.ONLINE_TTL_MS) return fail(res, '他不在线');
    var me = SIM.players[id];
    if (partyOf[to] && partyOf[to] === partyOf[id]) return fail(res, '已经在同一队里');
    invites[to] = { from: id, at: nowMs(), pid: partyOf[id] || '' };
    push(to, { k: 'invite', from: id, n: S.userName(id) });
    // 邀请人也给个回执，避免「点了没反应」
    push(id, { k: 'invited', n: S.userName(to) });
    ok(res, { to: to });
  });

  router.post('/v5/party/accept', requireAuth, function (req, res) {
    var id = uidOf(req);
    var inv = invites[id];
    if (!inv) return fail(res, '没有待接受的邀请');
    if (nowMs() - inv.at > 60000) { delete invites[id]; return fail(res, '邀请过期了'); }
    var from = inv.from;
    delete invites[id];
    if (!SIM.players[from]) return fail(res, '对方已离线');
    if (partyOf[id] === partyOf[from] && partyOf[id]) return fail(res, '已经在队里');
    if (partyMembers(id).length) leaveParty(id);
    var p = partyOf[from] ? parties[partyOf[from]] : newParty(from);
    if (p.members.length >= C.PARTY_MAX) return fail(res, '队伍满了');
    p.members.push(id);
    partyOf[id] = p.id;
    p.members.forEach(function (m) {
      push(m, { k: 'party', n: S.userName(id) + ' 加入了队伍' });
    });
    ok(res, { party: partyPayload(id) });
  });

  router.post('/v5/party/leave', requireAuth, function (req, res) {
    var id = uidOf(req);
    var mates = partyMembers(id).filter(function (m) { return m !== id; });
    leaveParty(id);
    mates.forEach(function (m) { push(m, { k: 'party', n: S.userName(id) + ' 离开了队伍' }); });
    if (req.body && req.body.kick) {
      var target = String(req.body.kick);
      // 只有队长能踢
      var pid = partyOf[id];
      if (pid && parties[pid] && parties[pid].leader === id && partyOf[target] === pid) {
        leaveParty(target);
        push(target, { k: 'party', n: '你被移出了队伍' });
      }
    }
    ok(res, {});
  });

  // 扶起：倒地的人 8 秒内可以被队友拉起来（设计 §8）
  router.post('/v5/revive', requireAuth, function (req, res) {
    var id = uidOf(req);
    var to = String((req.body && req.body.to) || '');
    var me = SIM.players[id], tgt = SIM.players[to];
    if (!me || !tgt) return fail(res, '他不在附近');
    if (!tgt.down) return fail(res, '他还没倒下');
    if (partyOf[id] !== partyOf[to] || !partyOf[id]) return fail(res, '只能扶起同队的人');
    var d = Math.hypot(me.x - tgt.x, me.y - tgt.y);
    if (d > 2.8) return fail(res, '走近一点');
    tgt.reviving = { by: id, at: nowMs() };
    push(id, { k: 'reviving', to: to, ms: C.REVIVE_MS });
    push(to, { k: 'being-revived', by: id, n: S.userName(id), ms: C.REVIVE_MS });
    ok(res, { ms: C.REVIVE_MS });
  });

  // 表情：只发给视野内的人，不做全校广播
  var EMOTES = ['wave', 'heart', 'note', 'zzz', 'spark', 'ask'];
  var EMOJI = { wave: '👋', heart: '❤️', note: '🎵', zzz: '💤', spark: '✨', ask: '❓' };
  router.post('/v5/emote', requireAuth, function (req, res) {
    var id = uidOf(req);
    var e = String((req.body && req.body.e) || '');
    if (EMOTES.indexOf(e) < 0) return fail(res, '没有这个表情');
    var p = SIM.players[id];
    if (!p) return fail(res, '还没进入世界', 409);
    var m = ctx.meta[id] || (ctx.meta[id] = {});
    if (m.lastEmote && nowMs() - m.lastEmote < 1200) return fail(res, '别刷屏', 429);
    m.lastEmote = nowMs();
    var near = [];
    Object.keys(SIM.players).forEach(function (o) {
      if (o === id) return;
      var q = SIM.players[o];
      if (q && Math.abs(q.x - p.x) < 18 && Math.abs(q.y - p.y) < 18) near.push(o);
    });
    broadcast('emote', { u: id, n: S.userName(id), e: e, x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10 }, near);
    ok(res, { e: e, near: near.length });
  });

  // ---------------- 好友 / 羁绊 / 悄悄话 / 双人互动 ----------------
  // 为什么羁绊是数值：班里「认识」和「一起打过」是两回事。把一起扶起、
  // 一起打怪、一起击掌攒成一条可见的刻度，同学才有理由第二次找同一个人玩。
  // 存档复用 flags（不新建表）：friends 是 uid 数组，bond 是 { uid: 点数 }。
  var FRIEND_MAX = 24;
  var BOND_TIERS = [[0, '初识'], [10, '同行'], [40, '挚友'], [100, '知己'], [240, '莫逆']];
  var ACTS = {
    highfive: { name: '击掌', ch: '✋', bond: 3 },
    hug: { name: '抱一下', ch: '♥', bond: 3 },
    dance: { name: '一起跳舞', ch: '♪', bond: 4 },
    cheer: { name: '加油', ch: '✦', bond: 2 },
    bow: { name: '行个礼', ch: '☺', bond: 2 },
    star: { name: '一起看星星', ch: '★', bond: 5 }
  };
  var friendReqs = {};    // uid -> { from, at }
  var actInvites = {};    // uid -> { from, a, at }
  var whisperLog = {};    // uid -> [{ from, to, n, text, at, self }]

  function flagsOf(id) {
    var rec = S.load(id, TOWN_SPAWN);
    rec.flags = rec.flags || {};
    if (!rec.flags.friends) rec.flags.friends = [];
    if (!rec.flags.bond) rec.flags.bond = {};
    return rec.flags;
  }
  function isFriend(a, b) { return flagsOf(a).friends.indexOf(b) >= 0; }
  function bondTierName(v) {
    var name = BOND_TIERS[0][1];
    for (var i = 0; i < BOND_TIERS.length; i++) if (v >= BOND_TIERS[i][0]) name = BOND_TIERS[i][1];
    return name;
  }
  function bondNext(v) {
    for (var i = 0; i < BOND_TIERS.length; i++) if (v < BOND_TIERS[i][0]) return BOND_TIERS[i][0];
    return null;
  }
  function bondOf(a, b) { return flagsOf(a).bond[b] || 0; }
  function bondsOf(id) { return flagsOf(id).bond; }

  // quiet=1 用于「一起打怪」这类高频事件：只在跨过称号时推送，不刷屏。
  function bondAdd(a, b, n, quiet) {
    if (!a || !b || a === b || !n) return 0;
    var fa = flagsOf(a), fb = flagsOf(b);
    var before = fa.bond[b] || 0;
    fa.bond[b] = before + n;
    fb.bond[a] = (fb.bond[a] || 0) + n;
    S.markDirty(a); S.markDirty(b);
    var after = fa.bond[b];
    var crossed = bondTierName(before) !== bondTierName(after);
    if (!quiet || crossed) {
      push(a, { k: 'bond', u: b, n: S.userName(b), v: after, tier: bondTierName(after), crossed: crossed ? 1 : 0 });
      push(b, { k: 'bond', u: a, n: S.userName(a), v: fb.bond[a], tier: bondTierName(fb.bond[a]), crossed: crossed ? 1 : 0 });
      if (crossed) {
        S.feed('story', a, S.userName(a) + ' 和 ' + S.userName(b) + ' 成了' + bondTierName(after));
      }
    }
    return after;
  }

  function pendingFriendReqs(id) {
    var r = friendReqs[id];
    if (!r || nowMs() - r.at > 120000) { delete friendReqs[id]; return null; }
    return { from: r.from, n: S.userName(r.from), left: Math.max(0, Math.round((120000 - (nowMs() - r.at)) / 1000)) };
  }

  function friendList(id) {
    var f = flagsOf(id), me = SIM.players[id];
    var out = [];
    f.friends.forEach(function (u) {
      var p = SIM.players[u];
      var live = !!p && nowMs() - p.seen < C.ONLINE_TTL_MS;
      var rec = S.load(u, TOWN_SPAWN);
      var b = f.bond[u] || 0;
      out.push({
        u: u, n: S.userName(u), on: live ? 1 : 0, lv: rec.level || 1, look: rec.look || 'NinjaBlue',
        zone: live ? zoneName(zoneAt(p.x, p.y)) : '', down: live && p.down ? 1 : 0,
        bond: b, tier: bondTierName(b), next: bondNext(b),
        d: live && me ? Math.round(dist(me.x, me.y, p.x, p.y) * 10) / 10 : -1
      });
    });
    out.sort(function (a, b) { return (b.on - a.on) || (b.bond - a.bond); });
    return out;
  }

  function nearbyList(id, radius) {
    var me = SIM.players[id];
    if (!me) return [];
    var f = flagsOf(id), mates = partyMembers(id), out = [];
    onlineIds().forEach(function (u) {
      if (u === id) return;
      var p = SIM.players[u];
      if (!p) return;
      var d = dist(me.x, me.y, p.x, p.y);
      if (d > radius) return;
      out.push({
        u: u, n: p.name || S.userName(u), lv: p.level || 1, look: p.look || 'NinjaBlue',
        down: p.down ? 1 : 0, fr: f.friends.indexOf(u) >= 0 ? 1 : 0,
        pt: mates.indexOf(u) >= 0 ? 1 : 0, d: Math.round(d * 10) / 10,
        zone: zoneName(zoneAt(p.x, p.y))
      });
    });
    out.sort(function (a, b) { return a.d - b.d; });
    return out;
  }

  function socialState(id) {
    return {
      friends: friendList(id),
      req: pendingFriendReqs(id),
      nearby: nearbyList(id, 20),
      whispers: (whisperLog[id] || []).slice(-30),
      act: actInvites[id] && nowMs() - actInvites[id].at < 30000
        ? { from: actInvites[id].from, a: actInvites[id].a, n: S.userName(actInvites[id].from) } : null,
      invites: Object.keys(actInvites).filter(function (u) { return actInvites[u].from === id; }).length
    };
  }

  function whisperPush(id, row) {
    if (!whisperLog[id]) whisperLog[id] = [];
    whisperLog[id].push(row);
    if (whisperLog[id].length > 40) whisperLog[id].shift();
  }
  function cleanText(v, max) {
    var s = String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
    return s.slice(0, max || 60);
  }
  function nearIds(x, y, r) {
    var out = [];
    Object.keys(SIM.players).forEach(function (u) {
      var p = SIM.players[u];
      if (p && Math.abs(p.x - x) < r && Math.abs(p.y - y) < r) out.push(u);
    });
    return out;
  }

  // ---- 好友：申请 → 同意 → 双向写入。不搞「单向关注」，关系必须对等 ----
  router.post('/v5/friend/request', requireAuth, function (req, res) {
    var id = uidOf(req), to = String((req.body && req.body.to) || '');
    if (!to || to === id) return fail(res, '不能加自己');
    if (!SIM.players[to] || nowMs() - SIM.players[to].seen > C.ONLINE_TTL_MS) return fail(res, '他不在线，等他回到岛上吧');
    var f = flagsOf(id), g = flagsOf(to);
    if (f.friends.indexOf(to) >= 0) return fail(res, '已经是好友了');
    if (f.friends.length >= FRIEND_MAX || g.friends.length >= FRIEND_MAX) return fail(res, '好友名单满了');
    var me = SIM.players[id], other = SIM.players[to];
    if (!me || dist(me.x, me.y, other.x, other.y) > 22) return fail(res, '走近些再打招呼');
    friendReqs[to] = { from: id, at: nowMs() };
    push(to, { k: 'friend-req', from: id, n: S.userName(id) });
    push(id, { k: 'friend-sent', n: S.userName(to) });
    ok(res, { to: to });
  });

  router.post('/v5/friend/accept', requireAuth, function (req, res) {
    var id = uidOf(req), r = friendReqs[id];
    if (!r) return fail(res, '没有待处理的好友申请');
    if (nowMs() - r.at > 120000) { delete friendReqs[id]; return fail(res, '申请过期了'); }
    var from = r.from;
    delete friendReqs[id];
    if (!SIM.players[from]) return fail(res, '对方已离线');
    var f = flagsOf(id), g = flagsOf(from);
    if (f.friends.length >= FRIEND_MAX || g.friends.length >= FRIEND_MAX) return fail(res, '好友名单满了');
    if (f.friends.indexOf(from) < 0) f.friends.push(from);
    if (g.friends.indexOf(id) < 0) g.friends.push(id);
    S.markDirty(id); S.markDirty(from);
    push(id, { k: 'friend-add', u: from, n: S.userName(from) });
    push(from, { k: 'friend-add', u: id, n: S.userName(id) });
    broadcast('friend', { a: id, b: from, an: S.userName(id), bn: S.userName(from) });
    S.feed('story', id, S.userName(id) + ' 和 ' + S.userName(from) + ' 成了朋友');
    bondAdd(id, from, 2);
    ok(res, { friends: friendList(id) });
  });

  router.post('/v5/friend/remove', requireAuth, function (req, res) {
    var id = uidOf(req), to = String((req.body && req.body.to) || '');
    var f = flagsOf(id), g = flagsOf(to);
    f.friends = f.friends.filter(function (u) { return u !== to; });
    g.friends = g.friends.filter(function (u) { return u !== id; });
    S.markDirty(id); S.markDirty(to);
    push(to, { k: 'friend-remove', n: S.userName(id) });
    ok(res, { friends: friendList(id) });
  });

  // ---- 悄悄话：只送到对方，不进世界频道 ----
  router.post('/v5/whisper', requireAuth, function (req, res) {
    var id = uidOf(req), to = String((req.body && req.body.to) || '');
    var text = cleanText(req.body && req.body.text, 60);
    if (!to || to === id) return fail(res, '没有收件人');
    if (!text) return fail(res, '说点什么吧');
    if (!SIM.players[to] || nowMs() - SIM.players[to].seen > C.ONLINE_TTL_MS) return fail(res, '他不在线');
    var m = ctx.meta[id] || (ctx.meta[id] = {});
    if (m.lastWhisper && nowMs() - m.lastWhisper < 900) return fail(res, '慢一点说', 429);
    m.lastWhisper = nowMs();
    var at = nowMs(), myName = S.userName(id), toName = S.userName(to);
    whisperPush(id, { from: id, to: to, n: toName, text: text, at: at, self: 1 });
    whisperPush(to, { from: id, to: to, n: myName, text: text, at: at, self: 0 });
    push(to, { k: 'whisper', from: id, n: myName, text: text, at: at });
    push(id, { k: 'whisper-echo', to: to, n: toName, text: text, at: at });
    ok(res, { text: text });
  });

  router.get('/v5/whisper/log', requireAuth, function (req, res) {
    ok(res, { list: (whisperLog[uidOf(req)] || []).slice(-30) });
  });

  // ---- 双人互动：先邀请，对方「回应」才成立。一个人单方面击掌不算互动 ----
  router.post('/v5/social/act', requireAuth, function (req, res) {
    var id = uidOf(req), b = req.body || {};
    var to = String(b.to || ''), a = String(b.a || '');
    if (!ACTS[a]) return fail(res, '没有这个动作');

    // 回应邀请
    if (b.accept) {
      var inv = actInvites[id];
      if (!inv) return fail(res, '邀请已经过去了');
      if (nowMs() - inv.at > 30000) { delete actInvites[id]; return fail(res, '邀请过期了'); }
      var from = inv.from, act = inv.a;
      delete actInvites[id];
      var me = SIM.players[id], other = SIM.players[from];
      if (!me || !other) return fail(res, '有人离开了');
      if (me.down || other.down) return fail(res, '倒着的时候先歇会儿');
      if (dist(me.x, me.y, other.x, other.y) > 3.2) return fail(res, '走近些再回应');
      var def = ACTS[act];
      var mx = (me.x + other.x) / 2, my = (me.y + other.y) / 2;
      var fn = S.userName(from), tn = S.userName(id);
      broadcast('act', { a: act, from: from, to: id, fn: fn, tn: tn, ch: def.ch, x: mx, y: my }, nearIds(mx, my, 18));
      push(from, { k: 'act-done', a: act, n: tn, ch: def.ch });
      push(id, { k: 'act-done', a: act, n: fn, ch: def.ch });
      bondAdd(from, id, def.bond);
      ok(res, { a: act, bond: def.bond });
      return;
    }
    if (b.decline) {
      var old = actInvites[id];
      if (old) {
        delete actInvites[id];
        push(old.from, { k: 'act-decline', n: S.userName(id) });
      }
      ok(res, {});
      return;
    }

    // 发起邀请
    if (!to || to === id) return fail(res, '没有对象');
    var p = SIM.players[id], q = SIM.players[to];
    if (!p || !q || nowMs() - q.seen > C.ONLINE_TTL_MS) return fail(res, '他不在线');
    if (p.down || q.down) return fail(res, '先站起来吧');
    if (dist(p.x, p.y, q.x, q.y) > 3.2) return fail(res, '走近些再打招呼（3 格内）');
    var mm = ctx.meta[id] || (ctx.meta[id] = {});
    if (mm.lastAct && nowMs() - mm.lastAct < 2500) return fail(res, '等一下再邀请', 429);
    mm.lastAct = nowMs();
    actInvites[to] = { from: id, a: a, at: nowMs() };
    push(to, { k: 'act-invite', from: id, n: S.userName(id), a: a, an: ACTS[a].name, ch: ACTS[a].ch });
    push(id, { k: 'act-wait', to: to, n: S.userName(to), a: a, an: ACTS[a].name });
    ok(res, { to: to, a: a });
  });

  // ---- 队伍：说话 + 队长集结 ----
  router.post('/v5/party/say', requireAuth, function (req, res) {
    var id = uidOf(req);
    var mates = partyMembers(id);
    if (mates.length < 2) return fail(res, '还没有队友');
    var text = cleanText(req.body && req.body.text, 60);
    if (!text) return fail(res, '说点什么吧');
    var m = ctx.meta[id] || (ctx.meta[id] = {});
    if (m.lastPartySay && nowMs() - m.lastPartySay < 1000) return fail(res, '慢一点说', 429);
    m.lastPartySay = nowMs();
    mates.forEach(function (u) { push(u, { k: 'party-chat', from: id, n: S.userName(id), text: text, at: nowMs() }); });
    ok(res, { text: text });
  });

  router.post('/v5/party/rally', requireAuth, function (req, res) {
    var id = uidOf(req);
    var pid = partyOf[id];
    if (!pid || !parties[pid] || parties[pid].leader !== id) return fail(res, '只有队长能召集');
    var p = SIM.players[id];
    if (!p) return fail(res, '还没进入世界', 409);
    var mates = partyMembers(id).filter(function (u) { return u !== id; });
    if (!mates.length) return fail(res, '还没有队友');
    mates.forEach(function (u) {
      push(u, { k: 'rally', from: id, n: S.userName(id), x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10, z: zoneName(zoneAt(p.x, p.y)) });
    });
    push(id, { k: 'rally-sent', n: mates.length });
    ok(res, { count: mates.length });
  });

  router.get('/v5/social/state', requireAuth, function (req, res) {
    ok(res, socialState(uidOf(req)));
  });


  // ---------------- 支线 ----------------
  function questState(id) {
    var rec = S.load(id, TOWN_SPAWN);
    rec.quests = rec.quests || {};
    var out = {};
    var towersLit = Object.keys(S.towers()).length;
    Object.keys(D.QUESTS).forEach(function (qid) {
      var q = D.QUESTS[qid];
      var st = rec.quests[qid] || { step: 0, kill: 0, done: false };
      var step = q.steps[st.step] || null;
      var prog = 0, need = 0, ready = false;
      if (step) {
        if (step.type === 'mats') { need = step.n; prog = (rec.mats && rec.mats[step.id]) || 0; }
        else if (step.type === 'kill') { need = step.n; prog = st.kill || 0; }
        else if (step.type === 'tower') { need = step.n; prog = towersLit; }
        ready = !st.done && prog >= need;
      }
      out[qid] = { step: st.step, prog: prog, need: need, ready: ready, done: !!st.done, total: q.steps.length };
    });
    return out;
  }

  router.post('/v5/quest/claim', requireAuth, function (req, res) {
    var id = uidOf(req);
    var qid = String((req.body && req.body.q) || '');
    var q = D.QUESTS[qid];
    if (!q) return fail(res, '没有这条支线');
    var rec = S.load(id, TOWN_SPAWN);
    rec.quests = rec.quests || {};
    var st = rec.quests[qid] || (rec.quests[qid] = { step: 0, kill: 0, done: false });
    if (st.done) return fail(res, '这条线已经走完了');
    var step = q.steps[st.step];
    if (!step) return fail(res, '没有下一步了');
    // 必须站在 NPC 面前交
    var p = SIM.players[id];
    var npcPos = ctx.npcPos(q.npc);
    if (!p || !npcPos) return fail(res, '再到镇上找他', 409);
    if (Math.hypot(p.x - npcPos.x, p.y - npcPos.y) > 3.5) return fail(res, '走近一点再说话');

    var towersLit = Object.keys(S.towers()).length;
    if (step.type === 'mats') {
      if (!rec.mats || (rec.mats[step.id] || 0) < step.n) return fail(res, '材料还不够');
      rec.mats[step.id] -= step.n;
      if (rec.mats[step.id] <= 0) delete rec.mats[step.id];
    } else if (step.type === 'kill') {
      if ((st.kill || 0) < step.n) return fail(res, '还没打够');
      st.kill = 0;
    } else if (step.type === 'tower') {
      if (towersLit < step.n) return fail(res, '灯塔还差 ' + (step.n - towersLit) + ' 座');
    }
    st.step += 1;
    var finished = st.step >= q.steps.length;
    var reward = null;
    if (finished) {
      st.done = true;
      var rw = q.reward;
      rec.shards = (rec.shards || 0) + (rw.shards || 0);
      var item = null;
      if (rw.item) {
        item = L.rollItem(Math.max(3, (SIM.players[id] && SIM.players[id].level) || 3), { slot: rw.item.slot, minRarity: rw.item.minRarity });
        bagAdd(rec, item);
      }
      reward = { shards: rw.shards || 0, item: item, text: rw.text };
      push(id, { k: 'quest', n: q.name, done: 1, shards: rw.shards || 0, item: item, text: rw.text });
      S.feed('story', id, S.userName(id) + ' 走完了「' + q.name + '」');
    } else {
      push(id, { k: 'quest', n: q.name, done: 0, next: q.steps[st.step].say });
    }
    S.markDirty(id);
    ok(res, { step: st.step, done: finished, reward: reward, quests: questState(id) });
  });

  // 击杀时推进「在某区打 N 只」的进度
  function onKill(m, shares, killer, night) {
    if (!m || m.tide) return;
    var zone = m.zone || '';
    shares.forEach(function (id) {
    // 一起打过就算一起经历过：好友 / 同队两两攒一点羁绊，安静累加、跨称号才提示
    var team = shares.slice();
    if (killer && team.indexOf(killer) < 0) team.push(killer);
    for (var ba = 0; ba < team.length; ba++) {
      for (var bb = ba + 1; bb < team.length; bb++) {
        var u1 = team[ba], u2 = team[bb];
        if (!u1 || !u2 || u1 === u2) continue;
        if (isFriend(u1, u2) || (partyOf[u1] && partyOf[u1] === partyOf[u2])) bondAdd(u1, u2, 1, true);
      }
    }
      var rec = S.load(id, TOWN_SPAWN);
      rec.quests = rec.quests || {};
      Object.keys(D.QUESTS).forEach(function (qid) {
        var st = rec.quests[qid];
        if (!st || st.done) return;
        var step = D.QUESTS[qid].steps[st.step];
        if (step && step.type === 'kill' && step.zone === zone) {
          st.kill = (st.kill || 0) + 1;
          if (st.kill === step.n) push(id, { k: 'quest-ready', n: D.QUESTS[qid].name });
          S.markDirty(id);
        }
      });
    });
  }

  // ---------------- 洞窟试炼 ----------------
  // 不做「另一张地图」：一张地图上的洞窟，玩家走进去就是「一层更黑的竞技场」。
  // 试炼只属于发起者（怪物标记 caveOwner），别人路过能帮忙但结算只给发起者。
  function dayStr() {
    var d = new Date();
    return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
  }

  router.post('/v5/cave', requireAuth, function (req, res) {
    var id = uidOf(req);
    var caveId = String((req.body && req.body.id) || '');
    var cave = null;
    (world.landmarks.caves || []).forEach(function (c) { if (c.id === caveId) cave = c; });
    if (!cave) return fail(res, '这里没有洞口');
    var p = SIM.players[id];
    if (!p) return fail(res, '还没进入世界', 409);
    if (p.down) return fail(res, '倒地时进不去');
    if (Math.hypot(p.x - (cave.x + 0.5), p.y - (cave.y + 0.5)) > 3.2) return fail(res, '离洞口太远了');
    var rec = S.load(id, TOWN_SPAWN);
    rec.flags = rec.flags || {};
    var key = 'cave_' + cave.zone;
    if (rec.flags[key] === dayStr()) return fail(res, '今天这口洞已经被你清过了，明天再来');
    if (ctx.caveBusy(id)) return fail(res, '试炼还在进行');

    var zd = D.ZONES.filter(function (z) { return z.id === cave.zone; })[0] || { lv: [1, 3] };
    var lv = Math.max(2, zd.lv[1] - 1);
    var spawned = [];
    // 6 只杂兵围一圈 + 1 只精英守心
    var kinds = Object.keys(D.MONSTERS).filter(function (k) {
      return D.MONSTERS[k].zone === cave.zone && D.MONSTERS[k].ai !== 'bomber';
    });
    if (!kinds.length) kinds = ['slime'];
    for (var i = 0; i < 6; i++) {
      var a = (i / 6) * 6.2832;
      var mm = SIM.spawnMob(kinds[i % kinds.length], cave.x + 0.5 + Math.cos(a) * 3.2, cave.y + 0.5 + Math.sin(a) * 3.2, lv, { zone: cave.zone });
      if (mm) { mm.caveOwner = id; mm.caveTrial = 1; spawned.push(mm.id); }
    }
    var eliteKind = kinds[(kinds.length - 1)];
    var boss = SIM.spawnMob(eliteKind, cave.x + 0.5, cave.y + 1.5, lv + 1, { zone: cave.zone });
    if (boss) {
      boss.elite = true;
      boss.hp = boss.maxHp = Math.round(boss.maxHp * 2.6);
      boss.atk = Math.round(boss.atk * 1.25);
      boss.xp = Math.round(boss.xp * 3);
      boss.caveOwner = id;
      boss.caveTrial = 1;
      boss.caveBoss = 1;
      spawned.push(boss.id);
    }
    ctx.startCave(id, cave.zone, spawned, boss ? boss.id : '');
    push(id, { k: 'cave', n: zoneName(cave.zone), left: 1 });
    ok(res, { zone: cave.zone, mobs: spawned.length, need: boss ? boss.id : '' });
  });

  // ---------------- 长夜潮汐 ----------------
  var tide = null;                 // { zone, startAt, until, bossId, score:{}, wave }
  var nextTideAt = nowMs() + 12 * 60 * 1000;

  function pickTideZone() {
    var lit = Object.keys(S.towers());
    var pool = ['meadow', 'forest', 'swamp', 'crag', 'frost'].filter(function (z) {
      var t = world.landmarks.towers[z];
      return !!t;
    });
    // 优先反扑已经点亮的区（守住才有意义），没点亮的也会被盯上
    var weighted = pool.concat(lit.filter(function (z) { return pool.indexOf(z) >= 0; }));
    return weighted[Math.floor(Math.random() * weighted.length)] || 'meadow';
  }

  function startTide() {
    if (tide) return;
    var zone = pickTideZone();
    var tw = world.landmarks.towers[zone] || world.town;
    var B = D.BOSSES[zone];
    var until = nowMs() + C.TIDE_DURATION_MS;
    tide = { zone: zone, startAt: nowMs(), until: until, score: {}, bossId: '', wave: 0 };
    // 潮汐首领：区域守护者的强化版，但不点灯（这是「反扑」，不是「守护者」）
    var boss = SIM.spawnMob('cyclope', tw.x + 0.5, tw.y - 4.5, (B ? B.lv : 8) + 1, { boss: B, zone: zone });
    if (boss) {
      boss.world = true;                 // 世界 Boss：不点亮灯塔
      boss.tide = 1;
      boss.hp = boss.maxHp = Math.round((B ? B.hp : 900) * D.TIDE.bossMul);
      boss.atk = Math.round((B ? B.atk : 16) * 1.2);
      boss.name = '潮汐·' + (B ? B.name : '长夜之影');
      tide.bossId = boss.id;
    }
    broadcast('tide', {
      phase: 'start', z: zone, n: zoneName(zone), until: until,
      boss: boss ? boss.name : '', x: tw.x, y: tw.y
    });
    S.feed('tide', '', '长夜潮汐涌向' + zoneName(zone) + ' —— 到场的人一起守夜');
    console.log('[shiguang5] 潮汐开始：%s（至 %s）', zone, new Date(until).toLocaleTimeString());
  }

  function endTide(reason) {
    if (!tide) return;
    var t = tide;
    tide = null;
    nextTideAt = nowMs() + C.TIDE_GAP_MIN_MS + Math.random() * (C.TIDE_GAP_MAX_MS - C.TIDE_GAP_MIN_MS);
    // 清场：没打死的潮汐怪跟着退潮
    Object.keys(SIM.mobs).forEach(function (k) {
      var m = SIM.mobs[k];
      if (m && (m.tide || m.id === t.bossId)) SIM.killMob(m, null, true);
    });
    var rank = Object.keys(t.score).map(function (uid) { return [uid, t.score[uid]]; })
      .sort(function (a, b) { return b[1] - a[1]; }).slice(0, 5);
    rank.forEach(function (row, i) {
      var gift = D.TIDE.reward[i] || 40;
      var rec = S.load(row[0], TOWN_SPAWN);
      rec.shards = (rec.shards || 0) + gift;
      S.markDirty(row[0]);
      push(row[0], { k: 'tide-reward', shards: gift, rank: i + 1, n: zoneName(t.zone) });
    });
    broadcast('tide', {
      phase: 'end', z: t.zone, n: zoneName(t.zone), reason: reason || 'timeout',
      top: rank.map(function (r) { return [S.userName(r[0]), r[1]]; })
    });
    S.feed('tide', '', zoneName(t.zone) + '的潮汐退了' + (rank.length ? ' —— 守夜最久的是 ' + S.userName(rank[0][0]) : ''));
  }

  // 潮汐里每 30 秒补一波幽灵，压力靠「持续」而不是「一次堆满」
  var lastWave = 0;
  function tideTick() {
    if (!tide) return;
    var t = nowMs();
    if (t > tide.until) { endTide('timeout'); return; }
    if (t - lastWave < 30000) return;
    lastWave = t;
    tide.wave += 1;
    if (tide.wave > D.TIDE.waves) return;
    var tw = world.landmarks.towers[tide.zone];
    if (!tw) return;
    var online = onlineIds();
    var anchors = [];
    online.forEach(function (id) {
      var p = SIM.players[id];
      if (p && !p.down && zoneAt(p.x, p.y) === tide.zone) anchors.push(p);
    });
    if (!anchors.length) return;
    for (var i = 0; i < D.TIDE.perWave; i++) {
      var a = anchors[i % anchors.length];
      var ang = Math.random() * 6.2832;
      var gx = a.x + Math.cos(ang) * (8 + Math.random() * 3);
      var gy = a.y + Math.sin(ang) * (8 + Math.random() * 3);
      if (ctx.isBlockedWorld(gx, gy)) continue;
      var g = SIM.spawnMob('ghost', gx, gy, Math.max(4, (a.level || 5) + 1), { zone: tide.zone, night: true });
      if (g) { g.tide = 1; g.night = true; }
    }
    broadcast('tide', { phase: 'wave', z: tide.zone, wave: tide.wave, until: tide.until });
  }

  // 潮汐期间击杀计入个人贡献
  function tideScore(uid, amount) {
    if (!tide) return;
    tide.score[uid] = (tide.score[uid] || 0) + amount;
  }

  function tideState() {
    if (!tide) return null;
    return { zone: tide.zone, name: zoneName(tide.zone), until: tide.until, bossId: tide.bossId, wave: tide.wave };
  }

  function tick() {
    tideTick();
    if (!tide && nowMs() >= nextTideAt) startTide();
    // 邀请 1 分钟过期
    Object.keys(invites).forEach(function (k) { if (nowMs() - invites[k].at > 60000) delete invites[k]; });
    // 好友申请 2 分钟、互动邀请 30 秒自动过期
    Object.keys(friendReqs).forEach(function (k) { if (nowMs() - friendReqs[k].at > 120000) delete friendReqs[k]; });
    Object.keys(actInvites).forEach(function (k) { if (nowMs() - actInvites[k].at > 30000) delete actInvites[k]; });
  }

  return {
    partyPayload: partyPayload,
    partyMembers: partyMembers,
    questState: questState,
    onKill: onKill,
    friendList: friendList,
    socialState: socialState,
    nearbyList: nearbyList,
    bondsOf: bondsOf,
    bondAdd: bondAdd,
    pendingFriendReqs: pendingFriendReqs,
    ACTS: ACTS,
    tideState: tideState,
    tideScore: tideScore,
    startTide: startTide,
    endTide: endTide,
    tick: tick,
    EMOTES: EMOTES,
    EMOJI: EMOJI,
    _parties: parties,
    _partyOf: partyOf,
    _tide: function () { return tide; }
  };
};
