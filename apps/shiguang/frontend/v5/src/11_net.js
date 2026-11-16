  // ---------------- §17 网络 ----------------
  // 一条 /sync 走完全部：我上报位置，服务端回我「你周围有什么 + 你身上发生了什么」。
  // 为什么不用 WS 推怪物：校园平板上一条 5Hz 的 HTTP 比 WebSocket 更抗折腾，
  // 而且回包里天然带「我的」事件，不用再开一条通道对齐时序。
  S.net = { queue: [], skill: null, roll: null, syncing: 0, errs: 0 };

  function http(method, path, body) {
    var api = S.api;
    if (!api) return Promise.reject(new Error('SDK 不可用'));
    var p = String(path).replace(/^\/api(?=\/)/, '');
    var call;
    try {
      call = method === 'get' ? api.get(p) : api.post(p, body || {});
    } catch (e) { return Promise.reject(e); }
    if (!call || typeof call.then !== 'function') return Promise.reject(new Error('请求失败'));
    return call.then(function (res) {
      var env = res && res.data ? res.data : null;
      if (!env) throw new Error('空响应');
      var code = env.code;
      if (code && code !== 200 && code !== 201) {
        var err = new Error(env.message || '请求失败');
        err.code = code;
        throw err;
      }
      return env.data;
    });
  }
  function apiGet(p) { return http('get', p); }
  function apiPost(p, b) { return http('post', p, b); }

  // ---- 进入世界 ----
  function loadTerrain() {
    var cached = null;
    try { cached = S.storage.get('terr5', null); } catch (e) { cached = null; }
    if (cached && cached.version === 7 && cached.cells && cached.size === 256) {
      return Promise.resolve(cached);
    }
    return apiGet('/shiguang/v5/terrain').then(function (data) {
      try { S.storage.set('terr5', data); } catch (e) {}
      return data;
    });
  }

  function applyEnter(d) {
    var me = makeMe(d.me);
    // v5.6 W4：天赋线等级挂到本地玩家（s4 见切窗口加成 / 剑舞 / 影袭都在本地判定）
    me.talentShadowLv = (me.talents && me.talents.shadow) || 0;
    me.talentBladeLv = (me.talents && me.talents.blade) || 0;
    me.talentLampLv = (me.talents && me.talents.lamp) || 0;
    me.pwBonus = me.talentShadowLv >= 4 ? (ROLL_INV_MS / 1000) * 0.6 : 0;
    me.atkCount = 0;
    S.myId = d.me.id;
    S.zone = d.me.zone || 'town';
    S.stats = d.me.stats || {};
    S.chests = {};
    for (var i = 0; i < (d.chests || []).length; i++) S.chests[d.chests[i]] = 1;
    S.towers = d.towers || {};
    S.waystones = d.me.waystones || ['ws_town'];
    S.goal = d.goal;
    if (!S.pfLock) S.phase = d.phase ? d.phase.name : 'day';
    S.pf = d.phase ? d.phase.f : 0;
    S.feed = (d.feed || []).map(function (f) { return { text: f.text, kind: f.kind }; });
    S.party = d.party || null;
    S.quests = d.quests || {};
    S.tideInfo = d.tide || null;
    S.caves = d.caves || [];
    S.friends = d.friends || [];
    S.friendReq = d.friendReq || null;
    S.bonds = d.bonds || {};
    S.nearby = d.nearby || [];
    S.acts = d.acts || S.acts;
    if (S.friendReq) setTimeout(function () { cardFriendReq(S.friendReq); }, 1800);
    // 相机先对上，否则第一帧会从 (0,0) 飞过来
    S.cam.x = me.x * TILE;
    S.cam.y = me.y * TILE;
    // NPC 站到自家门口
    for (var k = 0; k < NPCS.length; k++) {
      var h = null;
      for (var j = 0; j < S.map.town.houses.length; j++) {
        if (S.map.town.houses[j].kind === NPCS[k].id) h = S.map.town.houses[j];
      }
      if (h) {
        // 站在门侧、退到墙脚之外：名字牌才不会压在屋檐上，门也能露出来
        NPCS[k].x = h.x + h.w / 2 + 0.62;
        NPCS[k].y = h.y + h.h + 1.55;
      }
    }
    applyPlayers(d.players || []);
    renderFeed();
    uiPaintIcons();
    drawFace(me.look);
    uiUpdate();
    uiGoal();
    auMusic(S.zone === 'town' ? 'town' : S.zone);
    reveal(Math.floor(me.x), Math.floor(me.y), 18);   // 第一次进世界，先把镇子看清
    if (d.me.isNew) {
      setTimeout(function () { showChapter(0); }, 900);
    }
    bindRealtime();
  }

  // ---- 同步 ----
  function syncOnce() {
    var me = S.me;
    if (!me || !S.ready) return;
    if (S.net.syncing) return;
    S.net.syncing = 1;
    var body = {
      x: Math.round(me.x * 100) / 100,
      y: Math.round(me.y * 100) / 100,
      f: Math.round(Math.atan2(me.dirY || 0, me.dirX || 0) * 100) / 100,
      mv: me.moving ? 1 : 0,
      mp: Math.round(me.mp)
    };
    if (S.net.roll) { body.roll = 1; body.rt = 0; S.net.roll = null; }
    var hits = null;
    if (S.net.queue.length) { hits = S.net.queue.splice(0, 12); }
    var skill = S.net.skill;
    S.net.skill = null;

    var settled = 0, syncTimer = 0;
    var finish = function () {
      if (settled) return;
      settled = 1;
      if (syncTimer) { clearTimeout(syncTimer); syncTimer = 0; }
      S.net.syncing = 0;
    };
    // 任何一条请求悬挂（校园网抖动 / 平板切后台）都可能让 syncing 永远为 1，
    // 表现为「玩着玩着世界不动了」。8 秒没结果就主动放锁，让下一轮重新同步。
    syncTimer = setTimeout(function () {
      if (settled) return;
      S.net.errs++;
      finish();
      toast('世界同步超时，正在重新连接…', 'warn');
    }, 8000);
    // 先把命中送出去（服务端先记账），再要快照 —— 顺序反了会「怪没掉血但已经死了」
    var chain = Promise.resolve();
    if (hits && hits.length) {
      chain = chain.then(function () {
        return apiPost('/shiguang/v5/hit', { list: hits, kind: 'melee' }).then(null, function () {});
      });
    }
    if (skill) {
      chain = chain.then(function () {
        return apiPost('/shiguang/v5/skill', skill).then(null, function () {});
      });
    }
    chain.then(function () {
      return apiPost('/shiguang/v5/sync', body);
    }).then(function (d) {
      if (settled) return;
      S.net.errs = 0;
      applySync(d);
      finish();
    }, function (err) {
      if (settled) return;
      S.net.errs++;
      finish();
      if (S.net.errs === 4) {
        toast('与世界的连接断了一下，正在重连…', 'warn');
      }
      if (S.net.errs > 3 && S.net.errs % 10 === 0) {
        // 连续失败：不弹窗打断，只在 HUD 上显示，恢复后自动消失
        if (UI.zoneEl) UI.zoneEl.textContent = '重连中…';
      }
    });
  }

  function applySync(d) {
    if (!d || d.thin) {
      if (d && d.ph && !S.pfLock) { S.phase = d.ph; }
      return;
    }
    var me = S.me;
    if (!me) return;
    var a = d.me;
    // 位置以服务端为准；只有在「被纠正」时才硬拉，平时不打断本地手感
    if (d.c && Math.abs(a[0] - me.x) + Math.abs(a[1] - me.y) > 0.35) {
      me.x = a[0]; me.y = a[1];
      reveal(Math.floor(me.x), Math.floor(me.y), 12);   // 被服务端挪过去时也要揭图
    }
    var prevHp = me.hp;
    me.hp = a[2]; me.maxHp = a[3];
    me.mp = a[4]; me.maxMp = a[5];
    me.lv = a[6]; me.xp = a[7]; me.xpNext = a[8];
    me.shards = a[9];
    me.down = !!a[10];
    if (a[10]) showDead(true);
    else showDead(false);
    if (me.hp < prevHp - 0.5) hurtFlash();
    // 血量变了要跟服务端对齐（本地预测的伤害不该留在血条上）
    if (!S.pfLock) {
      if (!S.pfLock) S.phase = d.ph || S.phase;
      S.pf = d.pf != null ? d.pf : S.pf;
    }
    S.party = d.pt || null;
    if (d.td) S.tideInfo = { zone: d.td[0], until: d.td[1], wave: d.td[2] };
    else S.tideInfo = null;
    applyMobs(d.m || []);
    applyPlayers(d.p || []);
    applyShots(d.s || []);
    // 区域切换 → 换 BGM
    var z = zoneAtMe();
    if (z !== S.zone) {
      S.zone = z;
      showZone(ZONE_NAMES[z] || z);
      auMusic(z === 'town' ? 'town' : z);
    }
    // 事件
    var ev = d.ev || [];
    for (var i = 0; i < ev.length; i++) handleEvent(ev[i]);
    // Boss 血条
    updateBossBar();
    uiUpdate();
    uiGoal();
  }

  function zoneAtMe() {
    var me = S.me;
    if (!me) return 'town';
    return zoneOf(Math.floor(me.x), Math.floor(me.y));
  }

  function handleEvent(e) {
    if (!e || !e.k) return;
    // 社交层先接：好友申请 / 互动邀请 / 私聊要变成能点的卡片，不是一行 toast
    if (socialEvent(e)) return;
    switch (e.k) {
      case 'zone':
        S.zone = e.z;
        showZone(e.n);
        auMusic(e.z === 'town' ? 'town' : e.z);
        break;
      case 'loot':
        if (e.s) {
          // v5.6 W3：星屑不再直接飘字 —— 改为死亡位置散落磁吸星屑珠（e.orbs 拆珠数组）
          if (e.orbs && e.orbs.length) {
            spawnOrbs(e.px, e.py, e.orbs);
          } else {
            var lp = lootPos(e);
            capPush(S.texts, { x: lp.x, y: lp.y - 1.2, txt: '+' + e.s, crit: 0, life: 1.0, max: 1.0, vy: -0.9, vx: 0.2, gold: 1 }, 60);
            auSfx('coin', 0.3, 1.1);
          }
        }
        if (e.it) {
          toast('获得 ' + rarityName(e.it.rarity) + '「' + e.it.name + '」', 'good');
          auSfx(e.it.rarity >= 3 ? 'gold' : 'bonus', 0.45, 1);
          // v5.6 W3：装备光柱（四档底圈 + 3 段阶梯光柱 + 3 帧浮动）
          if (e.px != null) spawnPillar(e.px, e.py, e.it.rarity || 0);
        }
        if (e.f) toast('背包满了 —— 去镇上卖掉一些吧', 'warn');
        if (e.m && e.m.length) {
          // v5.6 W3：材料簇 —— 死亡位置散落材料珠
          for (var i = 0; i < e.m.length; i++) {
            spawnOrbs(e.px, e.py, [{ v: e.m[i][1], mat: e.m[i][0] }]);
          }
        }
        break;
      case 'lvup':
        toast('升级！ Lv.' + e.lv, 'good');
        auSfx('levelup', 0.5, 1);
        S.rings.push({ x: S.me.x, y: S.me.y, r: 0, max: 3.2, life: 0.7, max2: 0.7, col: '#ffe6a8' });
        S.rings.push({ x: S.me.x, y: S.me.y, r: 0, max: 1.8, life: 0.5, max2: 0.5, col: '#fff3d0' });
        // 一束从脚底往上抽的金色光尘：升级要有一点「被世界看见了」的仪式感
        for (var li = 0; li < 20; li++) {
          S.parts.push({
            x: S.me.x + (Math.random() - 0.5) * 0.9, y: S.me.y + 0.35,
            vx: (Math.random() - 0.5) * 0.7, vy: -1.1 - Math.random() * 1.1,
            life: 0.85 + Math.random() * 0.55, max: 1.4,
            col: li % 3 ? 'rgba(255,224,150,' : 'rgba(255,248,214,', r: 1.8
          });
        }
        S.cam.shake = Math.max(S.cam.shake, 1.4);
        if (e.talent) setTimeout(function () { toast('获得 1 点天赋 —— 按 T 分配', 'good'); }, 1200);
        break;
      case 'down':
        showDead(true);
        auSfx('gameover', 0.4, 1);
        break;
      case 'dead':
        showDead(true);
        break;
      case 'boss':
        toast('守护者苏醒：' + e.n, 'warn');
        auMusic('boss');
        break;
      case 'tower':
        S.towers[e.z] = { by: e.b, at: Date.now() };
        showChapter(ZONE_ORDER.indexOf(e.z) + 1);
        feedPush(e.n + '的灯塔亮了 —— ' + e.b + ' 打倒了守护者', 'tower');
        auSfx('success', 0.5, 1);
        reGoal();
        break;
      case 'revived':
        toast('被 ' + e.by + ' 扶了起来', 'good');
        break;
      case 'party':
        toast(e.n || '队伍有变动');
        break;
      case 'invite':
        toast(e.n + ' 邀请你组队 —— 按 P 接受', 'good');
        S.pendingInvite = e.from;
        break;
      case 'invited':
        toast('邀请已发给 ' + e.n);
        break;
      case 'reviving':
        toast('正在扶起…', 'good');
        break;
      case 'being-revived':
        toast(e.n + ' 正在扶起你…', 'good');
        break;
      case 'quest':
        if (e.done) {
          toast('支线完成：' + e.n, 'good');
          if (e.item) setTimeout(function () { toast('获得「' + e.item.name + '」', 'good'); }, 900);
        } else {
          toast('「' + e.n + '」下一步：' + e.next);
        }
        S.quests = S.quests || {};
        break;
      case 'quest-ready':
        toast('支线可交付：' + e.n, 'good');
        break;
      case 'tide-reward':
        toast('守夜奖励：' + e.shards + ' 星屑（第 ' + e.rank + ' 名）', 'good');
        break;
      case 'cave':
        if (e.fail) toast('洞窟里的东西退回去了', 'warn');
        break;
      case 'cave-done':
        toast('洞窟清空：+' + e.shards + ' 星屑', 'good');
        break;
      case 'cheat-death':
        // v5.6 W4：不灭 —— 全屏白闪 0.2s + 金色 vignette + 1s 无敌
        cheatDeathFx();
        break;
    }
  }

  // v5.6 W3：loot 事件坐标 —— 优先服务端给的死亡坐标（px/py，e.x 已被 xp 占用），
  // 兜底最近垂死怪，再兜底自己
  function lootPos(e) {
    if (e && e.px != null && e.py != null) return { x: e.px + 0.5, y: e.py + 0.5 };
    var ids = Object.keys(S.mobs), best = null, bd = 99;
    for (var i = 0; i < ids.length; i++) {
      var m = S.mobs[ids[i]];
      if (!m || !m.dying) continue;
      var d = dist(S.me.x, S.me.y, m.rx, m.ry);
      if (d < bd) { bd = d; best = m; }
    }
    if (best) return { x: best.rx, y: best.ry };
    return { x: S.me.x, y: S.me.y };
  }

  // v5.6 W4：不灭触发特效（白闪走 hurtT 通道复用，金环 + toast 另行）
  function cheatDeathFx() {
    var me = S.me;
    if (!me) return;
    me.invUntil = S.time + 1.0;           // 1s 无敌（表现层；服务端另有权威判定）
    S.cheatFxUntil = S.time + 0.2;        // 白闪
    S.cheatVgUntil = S.time + 1.0;        // 金色 vignette
    toast('灯火不灭！', 'good');
    auSfx('levelup', 0.5, 0.8);
    S.rings.push({ x: me.x, y: me.y, r: 0, max: 3.4, life: 0.7, max2: 0.7, col: '#ffd36a' });
  }

  function reGoal() {
    // 灯塔点亮后重新算目标（服务端下次 enter 会给，但这里先本地推一下，反馈要即时）
    for (var i = 0; i < ZONE_ORDER.length; i++) {
      var z = ZONE_ORDER[i];
      if (!S.towers[z]) {
        var t = S.map.towers[z];
        S.goal = { zone: z, name: ZONE_NAMES[z], x: t.x, y: t.y, boss: '', idx: i + 1, total: 6 };
        uiGoal();
        return;
      }
    }
    S.goal = null;
    uiGoal();
  }

  function updateBossBar() {
    var boss = null;
    for (var id in S.mobs) {
      var m = S.mobs[id];
      if (m.boss && m.hp > 0) {
        var d = dist(S.me.x, S.me.y, m.rx, m.ry);
        if (d < 26) { boss = m; break; }
      }
    }
    S.boss = boss;
    if (!UI.bossEl) return;
    if (!boss) {
      UI.bossEl.className = 'sg5-boss';
      if (auBossPlaying) { auBossPlaying = 0; auMusic(zoneAtMe() === 'town' ? 'town' : zoneAtMe()); }
      return;
    }
    if (!auBossPlaying) { auBossPlaying = 1; auMusic('boss'); }
    UI.bossEl.className = 'sg5-boss is-on';
    var name = boss.name || '守护者';
    setText(UI.bossName, name + '  Lv.' + boss.lv);
    var f = clamp(boss.hp / (boss.maxHp || 1), 0, 1);
    UI.bossFill.style.transform = 'scaleX(' + f.toFixed(3) + ')';
  }
  var auBossPlaying = 0;

  function showDead(on) {
    if (!UI.deadEl) return;
    UI.deadEl.className = 'sg5-dead' + (on ? ' is-on' : '');
    // 倒下时把常驻 HUD 一起压暗并锁住点击，避免动作键/农场条盖在死亡遮罩上
    if (UI.hud) UI.hud.className = 'sg5-hud' + (on ? ' is-dead' : '');
    if (on) closePanel();
  }

  // ---- 实时事件（灯塔 / 首杀 / 世界频道） ----
  function bindRealtime() {
    var rt = S.realtime;
    if (!rt || typeof rt.subscribe !== 'function' || S.rtBound) return;
    S.rtBound = 1;
    var off1 = rt.subscribe('shiguang5.tower', function (p) {
      if (!p || S.towers[p.z]) return;
      S.towers[p.z] = { by: p.by, at: p.at };
      feedPush(ZONE_NAMES[p.z] + '的灯塔亮了 —— ' + p.by, 'tower');
      if (curPanel === 'dex') refreshPanel('dex');
      reGoal();
    });
    var off2 = rt.subscribe('shiguang5.boss', function (p) {
      if (p && p.by) toast(p.by + ' 惊醒了' + ZONE_NAMES[p.z] + '的守护者', 'warn');
    });
    var off3 = rt.subscribe('shiguang5.tide', function (p) {
      if (!p) return;
      if (p.phase === 'start') {
        showChapterTide(p.n, p.boss);
        toast('长夜潮汐：' + p.n + ' —— 去守灯！', 'warn');
      } else if (p.phase === 'end') {
        toast(p.n + '的潮汐退了');
      }
    });
    var off4 = rt.subscribe('shiguang5.emote', function (p) {
      if (p && p.e) showEmote(p);
    });
    // 双人互动是「附近所有人都看得见」的事，走广播而不是个人事件
    var off5 = rt.subscribe('shiguang5.act', function (p) {
      if (p && p.a) spawnActFx(p);
    });
    var off6 = rt.subscribe('shiguang5.friend', function (p) {
      if (p && p.an) feedPush(p.an + ' 和 ' + p.bn + ' 成了朋友', 'story');
    });
    S.onDestroyAll.push(off1, off2, off3, off4, off5, off6);
  }

  // ---------------- §18 动作接口 ----------------
  function apiRespawn() {
    apiPost('/shiguang/v5/respawn').then(function (d) {
      var me = S.me;
      me.x = d.x; me.y = d.y; me.hp = d.hp; me.mp = d.mp || me.mp;
      me.down = 0;
      S.cam.x = me.x * TILE; S.cam.y = me.y * TILE;
      showDead(false);
      toast('你在拾光镇醒了过来');
    }, function () { toast('复活失败，再试一次', 'warn'); });
  }

  function apiChest(c) {
    apiPost('/shiguang/v5/chest', { id: c.id }).then(function (d) {
      S.chests[c.id] = 1;
      auSfx('secret', 0.42, 1);
      S.texts.push({ x: c.x + 0.5, y: c.y, txt: '+' + d.shards, crit: 0, life: 1.1, max: 1.1, vy: -1, vx: 0, gold: 1 });
      if (d.item) toast('宝箱：' + rarityName(d.item.rarity) + '「' + d.item.name + '」', 'good');
      else if (d.full) toast('背包满了，装备没能带走', 'warn');
      if (d.mat) toast('材料 +' + d.mat[1], 'good');
      auSfx('bonus', 0.4, 1);
    }, function (err) { toast(err.message || '打不开', 'warn'); });
  }

  function apiWaystone(w) {
    apiPost('/shiguang/v5/waystone', { id: w.id }).then(function (d) {
      if ((S.waystones || []).indexOf(w.id) < 0) S.waystones.push(w.id);
      toast(d.fresh ? '传送石亮起来了 · 已记录' : '传送石已激活');
      auSfx('secret', 0.4, 1.1);
      S.rings.push({ x: w.x + 0.5, y: w.y + 0.5, r: 0, max: 2.4, life: 0.5, max2: 0.5, col: '#9fe0ff' });
    }, function (err) { toast(err.message || '没有反应', 'warn'); });
  }

  // v5.6 W1：panelBusy 单飞锁（buy/sell/forge/talent）—— 在途时点击丢弃，第 3 次连续丢弃弹 toast
  function apiBuy(id, n) {
    var r = sg5Gate('panelBusy', document.activeElement, function () {
      return apiPost('/shiguang/v5/shop', { id: id, n: n }).then(function (d) {
        S.me.shards = d.shards;
        S.me.mats = d.mats;
        toast('买好了');
        auSfx('coin', 0.35, 1.15);
        refreshPanel('shop');
      }, function (err) { toast(err.message || '买不了', 'warn'); });
    });
    if (!r) return;
    r.then(function () {}, function () {});
  }

  function apiUse(id) {
    apiPost('/shiguang/v5/use', { id: id }).then(function (d) {
      S.me.hp = d.hp; S.me.mp = d.mp; S.me.mats = d.mats;
      auSfx('power', 0.3, 1.2);
      refreshPanel('bag');
    }, function (err) { toast(err.message || '用不了', 'warn'); });
  }

  function apiEquip(uid) {
    apiPost('/shiguang/v5/equip', { uid: uid }).then(function (d) {
      S.me.equip = d.equip;
      S.me.bag = d.bag;
      S.stats = d.stats || S.stats;
      S.me.maxHp = d.maxHp;
      S.me.hp = d.hp || S.me.hp;
      toast('换上了');
      auSfx('menu', 0.3, 1.1);
      refreshPanel('bag');
    }, function (err) { toast(err.message || '换不了', 'warn'); });
  }

  function apiUnequip(slot) {
    apiPost('/shiguang/v5/unequip', { slot: slot }).then(function (d) {
      S.me.equip = d.equip;
      S.me.bag = d.bag;
      S.stats = d.stats || S.stats;
      S.me.maxHp = d.maxHp;
      refreshPanel('char');
    }, function (err) { toast(err.message || '卸不下来', 'warn'); });
  }

  // v5.6 W3：sell 扩参 —— uids（装备）或 mats（材料 {gel:5,...}）都走这一条
  function apiSell(payload) {
    var body = payload && payload.uids ? { uids: payload.uids } : (payload && payload.mats ? { mats: payload.mats } : { uids: payload });
    var r = sg5Gate('panelBusy', document.activeElement, function () {
      return apiPost('/shiguang/v5/sell', body).then(function (d) {
        S.me.bag = d.bag != null ? d.bag : S.me.bag;
        S.me.mats = d.mats != null ? d.mats : S.me.mats;
        S.me.shards = d.shards;
        toast('卖了 ' + d.gain + ' 星屑');
        auSfx('coin', 0.3, 1);
        refreshPanel('bag');
        if (curPanel === 'shop') refreshPanel('shop');
      }, function (err) { toast(err.message || '卖不了', 'warn'); });
    });
    if (!r) return;
    r.then(function () {}, function () {});
  }

  function apiForge(slot) {
    var r = sg5Gate('panelBusy', document.activeElement, function () {
      return apiPost('/shiguang/v5/forge', { slot: slot, mat: 'ore' }).then(function (d) {
        S.me.equip = d.equip;
        S.me.shards = d.shards;
        S.me.mats = d.mats;
        toast('重铸完成：' + d.item.name);
        auSfx('magic', 0.5, 0.9);
        refreshPanel('forge');
      }, function (err) { toast(err.message || '打不了', 'warn'); });
    });
    if (!r) return;
    r.then(function () {}, function () {});
  }

  function apiTalent(line) {
    var r = sg5Gate('panelBusy', document.activeElement, function () {
      return apiPost('/shiguang/v5/talent', { line: line }).then(function (d) {
        S.me.talents = d.talents;
        S.me.talentLeft = d.left;
        S.stats = d.stats || S.stats;
        S.me.maxHp = d.maxHp;
        toast('点亮：' + d.tier.name);
        auSfx('levelup', 0.4, 1.2);
        refreshPanel('talent');
      }, function (err) { toast(err.message || '点不了', 'warn'); });
    });
    if (!r) return;
    r.then(function () {}, function () {});
  }

  function apiRest() {
    toast('歇了一会儿 —— 生命回满了');
    apiPost('/shiguang/v5/use', { id: 'potion' }).then(function (d) {
      S.me.hp = d.hp;
    }, function () {
      // 没有药也要能休息：交给服务端下一个 tick 的自然回复（脱战回血）
      S.me.hp = S.me.maxHp;
    });
    closePanel();
  }

  function apiLook(look) {
    apiPost('/shiguang/v5/look', { look: look }).then(function () {
      S.me.look = look;
      drawFace(look);
    }, function () {});
  }

  function apiInvite(to) {
    apiPost('/shiguang/v5/party/invite', { to: to }).then(function () {
      toast('邀请已发出');
    }, function (err) { toast(err.message || '邀请失败', 'warn'); });
  }
  function apiAcceptInvite() {
    apiPost('/shiguang/v5/party/accept').then(function (d) {
      S.party = d.party;
      toast('加入队伍', 'good');
      uiParty();
    }, function (err) { toast(err.message || '没有邀请', 'warn'); });
  }
  function apiLeaveParty() {
    apiPost('/shiguang/v5/party/leave', {}).then(function () {
      S.party = null;
      toast('已离队');
      uiParty();
    }, function () {});
  }
  function apiRevive(to) {
    apiPost('/shiguang/v5/revive', { to: to }).then(function () {
      toast('正在扶起…', 'good');
    }, function (err) { toast(err.message || '扶不起来', 'warn'); });
  }
  function apiQuest(q) {
    apiPost('/shiguang/v5/quest/claim', { q: q }).then(function (d) {
      S.quests = d.quests;
      if (d.reward) {
        toast('支线完成：+' + d.reward.shards + ' 星屑', 'good');
        if (d.reward.item) setTimeout(function () { toast('获得「' + d.reward.item.name + '」', 'good'); }, 800);
      } else {
        toast('交好了，他还有下文');
      }
      refreshPanel(curPanel);
    }, function (err) { toast(err.message || '交不了', 'warn'); });
  }
  function apiCave(id) {
    apiPost('/shiguang/v5/cave', { id: id }).then(function (d) {
      toast('洞窟试炼开始 —— 打倒守心的精英', 'warn');
      auSfx('alert', 0.5, 1);
    }, function (err) { toast(err.message || '进不去', 'warn'); });
  }
  function apiEmote(e) {
    apiPost('/shiguang/v5/emote', { e: e }).then(null, function () {});
  }

  function apiLeave() {
    try { apiPost('/shiguang/v5/leave').then(null, function () {}); } catch (e) {}
  }
