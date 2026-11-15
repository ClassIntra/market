  // ---------------- §21 一起玩：好友 / 附近 / 悄悄话 / 双人互动 ----------------
  // 一个班在同一张地图上，最难的不是打怪，是「找到那个人、说上话、留下点什么」。
  // 这一层只做三件事：把关系显示出来、把邀请做成能点的卡片、把互动画成看得见的动画。
  // 服务端才是关系与羁绊的真相，这里所有列表都来自 /v5/social/state。
  S.friends = [];
  S.friendReq = null;
  S.bonds = {};
  S.nearby = [];
  S.whispers = [];
  S.partyChat = [];
  S.acts = {};
  S.chatWith = '';
  S.socialTab = 'friends';
  S.bubbles = [];
  S.actFx = [];
  S.rallyMark = null;
  S.inviteCard = null;
  var socialAt = 0;

  var ACT_FALLBACK = {
    highfive: { name: '击掌', ch: '✋' }, hug: { name: '抱一下', ch: '♥' },
    dance: { name: '一起跳舞', ch: '♪' }, cheer: { name: '加油', ch: '✦' },
    bow: { name: '行个礼', ch: '☺' }, star: { name: '一起看星星', ch: '★' }
  };
  var BOND_COLORS = ['#8e8069', '#8ee8b8', '#6fc0ff', '#d9b8ff', '#ffd27a'];

  function actDef(a) { return S.acts[a] || ACT_FALLBACK[a] || { name: '互动', ch: '✦' }; }
  function bondColor(tier) {
    var names = ['初识', '同行', '挚友', '知己', '莫逆'];
    var i = names.indexOf(tier);
    return BOND_COLORS[i < 0 ? 0 : i];
  }
  function bondTierLabel(v) {
    return v >= 240 ? '莫逆' : v >= 100 ? '知己' : v >= 40 ? '挚友' : v >= 10 ? '同行' : '初识';
  }

  // ---- 数据 ----
  function applySocial(d) {
    if (!d) return;
    S.friends = d.friends || S.friends;
    S.nearby = d.nearby || S.nearby;
    S.whispers = d.whispers || S.whispers;
    S.friendReq = d.req || null;
    if (curPanel === 'social') refreshPanel('social');
    if (S.friendReq && !S.inviteCard) cardFriendReq(S.friendReq);
  }
  function apiSocialState(cb) {
    apiGet('/shiguang/v5/social/state').then(function (d) {
      applySocial(d);
      if (cb) cb(d);
    }, function () {});
  }
  function socialTick(t) {
    if (t - socialAt < 9) return;
    socialAt = t;
    // 面板开着或有待处理邀请时才轮询；世界里每秒 5 次的 sync 不背这个包袱
    if (curPanel === 'social' || S.friendReq || S.inviteCard) apiSocialState();
  }

  function apiFriend(to, mode) {
    apiPost('/shiguang/v5/friend/' + mode, { to: to }).then(function (d) {
      if (d && d.friends) S.friends = d.friends;
      if (mode === 'remove') toast('已从好友名单里移除', 'tip');
      apiSocialState();
    }, function (err) { toast(err.message || '没发出去', 'warn'); });
  }
  function apiWhisper(to, text) {
    apiPost('/shiguang/v5/whisper', { to: to, text: text }).then(function (d) {
      S.whispers.push({ from: S.myId, to: to, n: nameOf(to), text: d.text, at: Date.now(), self: 1 });
      if (S.whispers.length > 40) S.whispers.shift();
      pushBubble(to, d.text, '#ffe1a6');
      if (curPanel === 'social' && S.socialTab === 'chat') refreshPanel('social');
    }, function (err) { toast(err.message || '没送出去', 'warn'); });
  }
  function apiAct(to, a, mode) {
    var body = { to: to, a: a };
    if (mode) body[mode] = 1;
    apiPost('/shiguang/v5/social/act', body).then(function (d) {
      if (mode === 'accept') {
        closeInviteCard();
        toast('羁绊 +' + (d.bond || 0) + ' · ' + actDef(a).name, 'good');
      } else if (mode === 'decline') {
        closeInviteCard();
        toast('这次先算了', 'tip');
      } else {
        toast('邀请「' + actDef(a).name + '」已发出，等他回应', 'good');
      }
    }, function (err) { toast(err.message || '邀请没发出去', 'warn'); });
  }
  function apiPartySay(text) {
    apiPost('/shiguang/v5/party/say', { text: text }).then(function (d) {
      S.partyChat.push({ from: S.myId, n: S.me.name || '我', text: d.text, at: Date.now(), self: 1 });
      if (S.partyChat.length > 30) S.partyChat.shift();
      pushBubble(S.myId, d.text, '#a8d8ff');
      if (curPanel === 'social' && S.socialTab === 'party') refreshPanel('social');
    }, function (err) { toast(err.message || '没发出去', 'warn'); });
  }
  function apiRally() {
    apiPost('/shiguang/v5/party/rally', {}).then(function () {
      toast('集合令已发给队友', 'good');
    }, function (err) { toast(err.message || '发不出去', 'warn'); });
  }

  function nameOf(uid) {
    if (uid === S.myId) return (S.me && S.me.name) || '我';
    var p = S.players[uid];
    if (p && p.name) return p.name;
    for (var i = 0; i < S.friends.length; i++) if (S.friends[i].u === uid) return S.friends[i].n;
    for (var j = 0; j < S.nearby.length; j++) if (S.nearby[j].u === uid) return S.nearby[j].n;
    return '旅人';
  }

  // ---- 邀请卡：把「按 P 接受」换成能点的东西 ----
  function closeInviteCard() {
    if (S.inviteCard && S.inviteCard.node && S.inviteCard.node.parentNode) {
      S.inviteCard.node.className = 'sg5-invite is-out';
      var n = S.inviteCard.node;
      setTimeout(function () { if (n.parentNode) n.parentNode.removeChild(n); }, 320);
    }
    S.inviteCard = null;
  }
  function showInviteCard(cfg) {
    closeInviteCard();
    if (!UI.hud) return;
    var box = el('div', 'sg5-invite');
    var top = el('div', 'sg5-invite-top');
    top.appendChild(el('span', 'sg5-invite-ch', cfg.ch || '✦'));
    top.appendChild(el('span', 'sg5-invite-title', cfg.title || '有人找你'));
    box.appendChild(top);
    box.appendChild(el('div', 'sg5-invite-text', cfg.text || ''));
    var row = el('div', 'sg5-invite-ops');
    (cfg.ops || []).forEach(function (op) {
      var b = uiBtn(op.label, op.cls || '', function () {
        closeInviteCard();
        op.fn();
      });
      row.appendChild(b);
    });
    box.appendChild(row);
    UI.hud.appendChild(box);
    S.inviteCard = { node: box, until: S.time + (cfg.ttl || 24) };
    auSfx('menu', 0.28, 1.35);
    // 显式 setTimeout 也要跟着卸载走，避免应用关掉后还弹一张卡
    var tm = setTimeout(function () {
      if (S.inviteCard && S.inviteCard.node === box) closeInviteCard();
    }, (cfg.ttl || 24) * 1000);
    if (S.onDestroyAll) S.onDestroyAll.push(function () { clearTimeout(tm); });
  }
  function cardFriendReq(req) {
    showInviteCard({
      ch: '✦', title: '好友申请', text: req.n + ' 想和你成为朋友 —— 一起打怪会攒下羁绊。', ttl: 60,
      ops: [
        { label: '成为朋友', cls: 'sg5-btn-primary', fn: function () { apiPost('/shiguang/v5/friend/accept', {}).then(function (d) { if (d.friends) S.friends = d.friends; toast('你们成了朋友', 'good'); apiSocialState(); }, function (err) { toast(err.message, 'warn'); }); } },
        { label: '待会儿', cls: 'sg5-btn-ghost', fn: function () { S.friendReq = null; } }
      ]
    });
  }
  function cardActInvite(e) {
    var d = actDef(e.a);
    showInviteCard({
      ch: d.ch, title: e.n + ' 想和你' + d.name, text: '走到他身边，点一下「回应」就一起做。回应之后两个人的羁绊会涨一点。', ttl: 30,
      ops: [
        { label: '回应 · ' + d.name, cls: 'sg5-btn-primary', fn: function () { apiAct(e.from, e.a, 'accept'); } },
        { label: '婉拒', cls: 'sg5-btn-ghost', fn: function () { apiAct(e.from, e.a, 'decline'); } }
      ]
    });
  }
  function cardPartyInvite(e) {
    showInviteCard({
      ch: '⚑', title: '组队邀请', text: e.n + ' 邀你一起走 —— 同队打怪有经验加成，倒下了还能被扶起来。', ttl: 60,
      ops: [
        { label: '加入队伍', cls: 'sg5-btn-primary', fn: function () { apiAcceptInvite(); } },
        { label: '待会儿', cls: 'sg5-btn-ghost', fn: function () { S.pendingInvite = ''; } }
      ]
    });
  }

  // ---- 互动动作选择 ----
  function openActPicker(to) {
    var old = UI.hud.querySelector('.sg5-actpicker');
    if (old && old.parentNode) old.parentNode.removeChild(old);
    var box = el('div', 'sg5-actpicker sg5-frame');
    box.appendChild(el('div', 'sg5-pmenu-name', '和 ' + nameOf(to) + ' 一起…'));
    var grid = el('div', 'sg5-actgrid');
    Object.keys(ACT_FALLBACK).forEach(function (a) {
      var d = actDef(a);
      var b = el('button', 'sg5-actpick', d.ch + ' ' + d.name);
      b.type = 'button';
      b.addEventListener('click', function () {
        if (box.parentNode) box.parentNode.removeChild(box);
        apiAct(to, a);
      }, false);
      grid.appendChild(b);
    });
    box.appendChild(grid);
    box.appendChild(uiBtn('关闭', 'sg5-btn-sm sg5-btn-ghost', function () {
      if (box.parentNode) box.parentNode.removeChild(box);
    }));
    UI.hud.appendChild(box);
    setTimeout(function () { if (box.parentNode) box.parentNode.removeChild(box); }, 12000);
  }

  // ---- 事件（由 11_net.js 的 handleEvent 转过来；返回 1 表示已处理） ----
  function socialEvent(e) {
    if (!e || !e.k) return 0;
    switch (e.k) {
      case 'friend-req':
        S.friendReq = { from: e.from, n: e.n };
        cardFriendReq(S.friendReq);
        return 1;
      case 'friend-sent': toast('好友申请已发给 ' + e.n, 'good'); return 1;
      case 'friend-add':
        toast('和 ' + e.n + ' 成了朋友', 'good');
        auSfx('bonus', 0.35, 1.2);
        apiSocialState();
        return 1;
      case 'friend-remove': toast(e.n + ' 把你从好友名单里移除了', 'tip'); apiSocialState(); return 1;
      case 'act-invite': cardActInvite(e); return 1;
      case 'act-wait': toast('等 ' + e.n + ' 回应「' + e.an + '」…', 'tip'); return 1;
      case 'act-done': toast('和 ' + e.n + ' ' + actDef(e.a).name + ' ✦', 'good'); apiSocialState(); return 1;
      case 'act-decline': toast(e.n + ' 这会儿不方便', 'tip'); return 1;
      case 'whisper':
        S.whispers.push({ from: e.from, to: S.myId, n: e.n, text: e.text, at: e.at || Date.now(), self: 0 });
        if (S.whispers.length > 40) S.whispers.shift();
        pushBubble(e.from, e.text, '#ffe1a6');
        toast('✉ ' + e.n + '：' + e.text, 'good');
        auSfx('menu', 0.22, 1.5);
        if (curPanel === 'social' && S.socialTab === 'chat') refreshPanel('social');
        return 1;
      case 'whisper-echo': return 1;   // 发送方已本地入列
      case 'party-chat':
        S.partyChat.push({ from: e.from, n: e.n, text: e.text, at: e.at || Date.now(), self: 0 });
        if (S.partyChat.length > 30) S.partyChat.shift();
        pushBubble(e.from, e.text, '#a8d8ff');
        toast('队伍 · ' + e.n + '：' + e.text);
        if (curPanel === 'social' && S.socialTab === 'party') refreshPanel('social');
        return 1;
      case 'rally':
        S.rallyMark = { x: e.x, y: e.y, until: S.time + 90, n: e.n, z: e.z };
        toast('⚑ ' + e.n + ' 在' + (e.z || '附近') + '召集集合', 'good');
        auSfx('alert', 0.3, 1.4);
        return 1;
      case 'rally-sent': return 1;
      case 'bond':
        S.bonds[e.u] = e.v;
        if (e.crossed) {
          toast('和 ' + e.n + ' 的羁绊成了「' + e.tier + '」', 'good');
          auSfx('levelup', 0.35, 1.25);
        }
        apiSocialState();
        return 1;
      case 'invite':
        S.pendingInvite = e.from;
        cardPartyInvite({ from: e.from, n: e.n });
        return 1;
      case 'invited': toast('组队邀请已发给 ' + e.n, 'good'); return 1;
    }
    return 0;
  }

  // ---- 头顶气泡 ----
  function pushBubble(uid, text, col) {
    var p = (uid === S.myId) ? S.me : S.players[uid];
    if (!p) return;
    S.bubbles.push({ x: p.x, y: p.y, text: String(text).slice(0, 26), col: col || '#ffe1a6', until: S.time + 4.2, born: S.time });
    if (S.bubbles.length > 10) S.bubbles.shift();
  }
  function spawnActFx(p) {
    if (!p) return;
    var d = actDef(p.a);
    S.actFx.push({ x: p.x, y: p.y, ch: d.ch, a: p.a, name: d.name, fn: p.fn, tn: p.tn, born: S.time, until: S.time + 2.6 });
    if (S.actFx.length > 6) S.actFx.shift();
    // 一圈星屑 + 两个人的头顶符号
    for (var i = 0; i < 14; i++) {
      var a = (i / 14) * 6.2832 + hash2(i, 3, 71);
      S.parts.push({
        x: p.x + Math.cos(a) * 0.35, y: p.y + Math.sin(a) * 0.25,
        vx: Math.cos(a) * 1.5, vy: Math.sin(a) * 1.2 - 0.6,
        life: 0.9 + hash2(i, 7, 72) * 0.6, max: 1.5,
        col: p.a === 'hug' || p.a === 'star' ? 'rgba(255,170,200,' : 'rgba(255,226,150,', r: 1.6
      });
    }
    S.rings.push({ x: p.x, y: p.y, r: 0, max: 2.4, life: 0.7, max2: 0.7, col: '#ffe6a8' });
    auSfx('bonus', 0.32, 1.3);
  }

  // ---- 世界层：气泡 / 互动 / 集合光标 ----
  function drawSocialFx(ctx) {
    var u = S.zoom * TILE;
    var i, k;
    // 互动：两人中间浮起一串符号 + 一圈柔光
    for (i = S.actFx.length - 1; i >= 0; i--) {
      var f = S.actFx[i];
      if (S.time > f.until) { S.actFx.splice(i, 1); continue; }
      var age = S.time - f.born, k2 = clamp(age / 2.6, 0, 1);
      var cx = w2sX(f.x * TILE), cy = w2sY(f.y * TILE) - u * 0.5;
      ctx.save();
      ctx.globalAlpha = (1 - k2) * 0.9;
      var gg = ctx.createRadialGradient(cx, cy, 0, cx, cy, u * 1.8);
      gg.addColorStop(0, 'rgba(255,224,160,0.26)');
      gg.addColorStop(1, 'rgba(255,224,160,0)');
      ctx.fillStyle = gg;
      ctx.fillRect(cx - u * 1.8, cy - u * 1.8, u * 3.6, u * 3.6);
      for (k = 0; k < 5; k++) {
        var ph = (age * 0.55 + k * 0.2) % 1;
        var ox = Math.sin(k * 2.1 + age * 2) * u * (0.4 + ph);
        var oy = -ph * u * 1.9;
        ctx.globalAlpha = (1 - ph) * (1 - k2) * 0.95;
        ctx.font = 'bold ' + Math.round(u * (0.30 + (1 - ph) * 0.12)) + 'px system-ui,sans-serif';
        ctx.textAlign = 'center';
        ctx.fillStyle = 'rgba(20,14,10,0.55)';
        ctx.fillText(f.ch, cx + ox + 1, cy + oy + 1);
        ctx.fillStyle = k % 2 ? '#ffd78a' : '#fff3d0';
        ctx.fillText(f.ch, cx + ox, cy + oy);
      }
      ctx.globalAlpha = 1;
      ctx.restore();
    }
    // 气泡：硬边像素框 + 小尖角，文字压一行阴影
    for (i = S.bubbles.length - 1; i >= 0; i--) {
      var b = S.bubbles[i];
      if (S.time > b.until) { S.bubbles.splice(i, 1); continue; }
      var pop = clamp((S.time - b.born) / 0.22, 0, 1);
      var fade = clamp((b.until - S.time) / 0.5, 0, 1);
      var bx = w2sX(b.x * TILE), by = w2sY(b.y * TILE) - u * 1.05 - Math.sin(S.time * 2.2 + i) * 2;
      ctx.save();
      ctx.globalAlpha = fade;
      ctx.font = Math.round(12 * (S.zoom / 3)) + 'px "SG5Pixel", monospace';
      var tw = ctx.measureText(b.text).width;
      var bw = Math.min(S.view.w * 0.42, tw + 20), bh = 26;
      var x0 = Math.round(bx - bw / 2), y0 = Math.round(by - bh);
      ctx.translate(bx, by);
      ctx.scale(0.7 + 0.3 * easeOut(pop), 0.7 + 0.3 * easeOut(pop));
      ctx.translate(-bx, -by);
      ctx.fillStyle = 'rgba(12,10,18,0.88)';
      ctx.fillRect(x0, y0, bw, bh);
      ctx.fillStyle = b.col;
      ctx.fillRect(x0, y0, bw, 2);
      ctx.fillRect(x0, y0 + bh - 2, bw, 2);
      ctx.fillRect(x0, y0, 2, bh);
      ctx.fillRect(x0 + bw - 2, y0, 2, bh);
      ctx.fillRect(bx - 4, y0 + bh, 8, 2);
      ctx.fillRect(bx - 2, y0 + bh + 2, 4, 2);
      ctx.fillStyle = '#f8efdd';
      ctx.textAlign = 'center';
      ctx.fillText(b.text, bx, y0 + 18);
      ctx.restore();
    }
    // 集合光标：队长发起后 90 秒内在地面闪一个圈与旗
    if (S.rallyMark) {
      if (S.time > S.rallyMark.until) S.rallyMark = null;
      else {
        var rx = w2sX(S.rallyMark.x * TILE), ry = w2sY(S.rallyMark.y * TILE);
        var pulse = 0.5 + 0.5 * Math.sin(S.time * 3.2);
        ctx.save();
        ctx.strokeStyle = 'rgba(255,214,120,' + (0.35 + pulse * 0.4).toFixed(2) + ')';
        ctx.lineWidth = Math.max(2, u * 0.06);
        ctx.beginPath();
        ctx.ellipse(rx, ry, u * (0.55 + pulse * 0.25), u * (0.24 + pulse * 0.1), 0, 0, 6.2832);
        ctx.stroke();
        ctx.fillStyle = '#ffd27a';
        ctx.fillRect(rx - 1, ry - u * 1.5, 2, u * 1.1);
        ctx.fillRect(rx + 1, ry - u * 1.5, u * 0.45, u * 0.30);
        ctx.restore();
      }
    }
  }

  // ---- 面板：好友 / 附近 / 悄悄话 / 队伍 ----
  function socialTabs(body) {
    var tabs = el('div', 'sg5-tabs');
    [['friends', '好友'], ['nearby', '附近的人'], ['chat', '悄悄话'], ['party', '队伍']].forEach(function (t) {
      var b = el('button', 'sg5-tab' + (S.socialTab === t[0] ? ' is-on' : ''), t[1]);
      b.type = 'button';
      b.addEventListener('click', function () {
        S.socialTab = t[0];
        refreshPanel('social');
        auSfx('menu', 0.2, 1.2);
      }, false);
      tabs.appendChild(b);
    });
    body.appendChild(tabs);
  }

  function personRow(p, isFriend) {
    var row = el('div', 'sg5-person' + (p.on === 0 || p.down ? ' is-off' : ''));
    var av = el('div', 'sg5-person-av');
    var faceKey = 'face_' + (p.look || 'NinjaBlue');
    if (!FR[faceKey]) faceKey = 'face_NinjaBlue';
    av.appendChild(iconCanvas(faceKey, 30));
    row.appendChild(av);
    var mid = el('div', 'sg5-person-mid');
    var head = el('div', 'sg5-person-head');
    head.appendChild(el('span', 'sg5-person-name', p.n));
    head.appendChild(el('span', 'sg5-person-lv', 'Lv.' + (p.lv || 1)));
    head.appendChild(el('span', 'sg5-person-state' + (p.on ? ' is-on' : ''), p.on ? (p.zone || '在线') : '离线'));
    mid.appendChild(head);
    if (isFriend) {
      var b = p.bond || 0;
      var bondRow = el('div', 'sg5-bondrow');
      bondRow.appendChild(el('span', 'sg5-bond-tier', '✦ ' + (p.tier || '初识')));
      var bar = el('div', 'sg5-bondbar');
      var fill = el('i');
      var from = p.bond == null ? 0 : 0, to = p.next || 100;
      var prev = 0;
      ['初识', '同行', '挚友', '知己', '莫逆'].forEach(function (nm, idx) {
        var th = [0, 10, 40, 100, 240][idx];
        if (b >= th) prev = th;
      });
      fill.style.transform = 'scaleX(' + clamp((b - prev) / Math.max(1, to - prev), 0, 1).toFixed(3) + ')';
      fill.style.background = bondColor(p.tier);
      bar.appendChild(fill);
      bondRow.appendChild(bar);
      bondRow.appendChild(el('span', 'sg5-bond-num', b + (p.next ? ' / ' + p.next : '')));
      mid.appendChild(bondRow);
    } else {
      mid.appendChild(el('div', 'sg5-person-sub', (p.zone || '某处') + ' · ' + (p.d != null ? p.d : '?') + ' 格外' + (p.pt ? ' · 同队' : '') + (p.fr ? ' · 已是好友' : '')));
    }
    row.appendChild(mid);
    var ops = el('div', 'sg5-person-ops');
    if (isFriend || p.fr) {
      ops.appendChild(uiBtn('私聊', 'sg5-btn-sm sg5-btn-ghost', function () {
        S.chatWith = p.u; S.socialTab = 'chat'; refreshPanel('social');
      }));
      ops.appendChild(uiBtn('互动', 'sg5-btn-sm', function () { openActPicker(p.u); }));
    } else {
      ops.appendChild(uiBtn('加好友', 'sg5-btn-sm', function () { apiFriend(p.u, 'request'); }));
      ops.appendChild(uiBtn('招呼', 'sg5-btn-sm sg5-btn-ghost', function () { apiEmote('wave'); toast('朝 ' + p.n + ' 挥了挥手'); }));
    }
    if (!p.pt) ops.appendChild(uiBtn('组队', 'sg5-btn-sm sg5-btn-ghost', function () { apiInvite(p.u); }));
    if (isFriend) {
      ops.appendChild(uiBtn('移除', 'sg5-btn-sm sg5-btn-ghost', function () { apiFriend(p.u, 'remove'); }));
    }
    row.appendChild(ops);
    return row;
  }

  function chatBody(body, list, toUid, onSend, placeholder) {
    var log = el('div', 'sg5-chatlog');
    if (!list.length) log.appendChild(el('div', 'sg5-empty', '还没有人说话 —— 先打个招呼吧'));
    list.slice(-24).forEach(function (m) {
      var line = el('div', 'sg5-chatline' + (m.self ? ' is-self' : ''));
      line.appendChild(el('span', 'sg5-chatwho', m.n || nameOf(m.from)));
      line.appendChild(el('span', 'sg5-chattxt', m.text));
      log.appendChild(line);
    });
    body.appendChild(log);
    var form = el('div', 'sg5-chatform');
    var input = el('input', 'sg5-input');
    input.type = 'text';
    input.maxLength = 60;
    input.setAttribute('placeholder', placeholder || '说点什么…');
    var send = uiBtn('发送', 'sg5-btn-sm', function () {
      var v = input.value.replace(/^\s+|\s+$/g, '');
      if (!v) return;
      input.value = '';
      onSend(v);
    });
    input.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter') { ev.preventDefault(); send.click(); }
      ev.stopPropagation();
    }, false);
    form.appendChild(input);
    form.appendChild(send);
    body.appendChild(form);
    setTimeout(function () { try { log.scrollTop = log.scrollHeight; } catch (e) {} }, 0);
  }

  PANELS.social = function () {
    var online = 0;
    for (var i = 0; i < S.friends.length; i++) if (S.friends[i].on) online++;
    var sh = panelShell('一起玩', '好友 ' + online + '/' + S.friends.length + ' 在线 · 附近 ' + S.nearby.length + ' 人');
    sh.root.className = 'sg5-panel sg5-panel-wide';
    var body = sh.body;
    socialTabs(body);

    if (S.socialTab === 'friends') {
      body.appendChild(el('div', 'sg5-note', '一起打怪、扶起、回应互动都会攒下羁绊。称号从「初识」一路到「莫逆」—— 别只和同一个人打怪。'));
      if (!S.friends.length) {
        body.appendChild(el('div', 'sg5-empty', '好友名单还是空的 · 去「附近的人」里找个同学打个招呼'));
      } else {
        var list = el('div', 'sg5-personlist');
        S.friends.forEach(function (p) { list.appendChild(personRow(p, true)); });
        body.appendChild(list);
      }
      if (S.friendReq) {
        body.appendChild(uiBtn('✦ 处理 ' + S.friendReq.n + ' 的好友申请', 'sg5-btn', function () { cardFriendReq(S.friendReq); }));
      }
      body.appendChild(uiBtn('刷新名单', 'sg5-btn-sm sg5-btn-ghost', function () { apiSocialState(); }));
    } else if (S.socialTab === 'nearby') {
      body.appendChild(el('div', 'sg5-note', '同一片视野里的同学。走近 3 格才能邀请互动 —— 隔着半张地图点人是没用的。'));
      if (!S.nearby.length) {
        body.appendChild(el('div', 'sg5-empty', '附近没有别人 · 去广场或灯塔那边看看'));
      } else {
        var nl = el('div', 'sg5-personlist');
        S.nearby.forEach(function (p) { nl.appendChild(personRow(p, false)); });
        body.appendChild(nl);
      }
      body.appendChild(uiBtn('重新看看', 'sg5-btn-sm sg5-btn-ghost', function () { apiSocialState(); }));
    } else if (S.socialTab === 'chat') {
      if (!S.friends.length) {
        body.appendChild(el('div', 'sg5-empty', '先加个好友，才能说悄悄话'));
      } else {
        var pick = el('div', 'sg5-chatpick');
        S.friends.forEach(function (p) {
          var b = el('button', 'sg5-chatwho-btn' + (S.chatWith === p.u ? ' is-on' : ''), p.n);
          b.type = 'button';
          b.addEventListener('click', function () { S.chatWith = p.u; refreshPanel('social'); }, false);
          pick.appendChild(b);
        });
        body.appendChild(pick);
        var to = S.chatWith;
        var talk = [];
        for (var j = 0; j < S.whispers.length; j++) {
          var w = S.whispers[j];
          if (w.from === to || w.to === to) talk.push(w);
        }
        if (!to) body.appendChild(el('div', 'sg5-empty', '选一个好友开始说话'));
        else chatBody(body, talk, to, function (v) { apiWhisper(to, v); }, '给 ' + nameOf(to) + ' 说一句…');
      }
    } else {
      var pt = S.party;
      if (!pt || !pt.members || !pt.members.length) {
        body.appendChild(el('div', 'sg5-empty', '还没有队伍 · 点别人头上的名字就能邀请'));
      } else {
        var pl = el('div', 'sg5-personlist');
        pt.members.forEach(function (m) {
          pl.appendChild(personRow({ u: m[0], n: m[1], lv: m[5], on: m[6] ? 1 : 0, look: 'NinjaBlue', pt: 1, down: m[4], zone: '' }, false));
        });
        body.appendChild(pl);
        var prow = el('div', 'sg5-partyops');
        if (pt.leader === S.myId) prow.appendChild(uiBtn('⚑ 召集队友', 'sg5-btn-sm', function () { apiRally(); }));
        prow.appendChild(uiBtn('退出队伍', 'sg5-btn-sm sg5-btn-ghost', function () { apiLeaveParty(); }));
        body.appendChild(prow);
      }
      body.appendChild(el('div', 'sg5-sect', '队伍频道'));
      chatBody(body, S.partyChat, '', function (v) { apiPartySay(v); }, '对队友说…');
    }
    return sh.root;
  };

