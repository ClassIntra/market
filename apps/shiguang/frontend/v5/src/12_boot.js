  // ---------------- §19 启动与主循环 ----------------
  var raf = 0, lastT = 0, syncTimer = 0, miniAt = 0, hudAt = 0, ambientAt = 0;
  var root = null, ctx = null, canvas = null;

  function resize() {
    if (!root || !canvas) return;
    var w = root.clientWidth || 320;
    var h = root.clientHeight || 240;
    var dpr = Math.min(2, window.devicePixelRatio || 1);
    S.view.w = w;
    S.view.h = h;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.width = w + 'px';
      canvas.style.height = h + 'px';
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = false;
    // 整数缩放：视口越大，看得越远；平板与桌面都能落到 3 或 4 倍
    var z = Math.round(Math.min(w / 380, h / 270));
    S.zoom = clamp(z, 3, 4);
  }

  // v5.6：实体预算。任何一层漏了 capPush 也不至于撑爆内存 —— 主循环每帧兜一次底。
  function trimBudgets() {
    if (S.parts.length > 400) S.parts.splice(0, S.parts.length - 400);
    if (S.texts.length > 60) S.texts.splice(0, S.texts.length - 60);
    if (S.orbs.length > 320) S.orbs.splice(0, S.orbs.length - 320);
    if (S.corpses.length > 24) S.corpses.splice(0, S.corpses.length - 24);
    if (S.pillars.length > 12) S.pillars.splice(0, S.pillars.length - 12);
  }

  // v5.6：帧步进拆出来 —— __sg5.tick(ms) 手动驱动时绝不重复排 rAF（否则回调指数增殖）。
  function step(ts) {
    var t = ts / 1000;
    if (!lastT) lastT = t;
    var dt = Math.min(0.05, t - lastT);
    lastT = t;
    if (dt <= 0) return;
    S.time += dt;

    if (!document.hidden && S.ready && !S.paused) {
      // v5.6 W1：逐帧段整段包 try/catch —— 一行异常绝不能打断 rAF 链（用户「玩一半卡死」的根因）。
      // catch 只记日志并继续下一帧；socialTick 内部的农场判定另有自己的双保险（15_farm）。
      try {
        var freeze = S.hitstopUntil && S.time < S.hitstopUntil;
        var scale = 1;
        if (S.slow && S.time < S.slow.until) scale = S.slow.scale;
        else if (S.slow) S.slow = null;
        var ds = freeze ? 0 : dt * scale;
        if (ds > 0) {
          // 网络插值时钟：跟着顿帧/子弹时间走 —— 慢动作里远方实体也得慢下来
          S.net.clock += ds;
          updatePlayer(ds, S.time);
          resolveAttack(S.me, S.time);
          updateMobs(ds, S.time);
          updatePlayers(ds);
          updateShots(ds);
          updateOrbs(ds, S.time);
          ambient(ds);
        }
        camUpdate(dt);
        trimBudgets();
        renderWorld(freeze ? 0 : dt);
        socialTick(S.time);
      } catch (e) {
        if (!loop.errAt || S.time - loop.errAt > 1) {
          loop.errAt = S.time;
          console.error('[sg5-loop]', e);
        }
      }
      try {
      // HUD 不需要 60Hz
      if (S.time - hudAt > 0.2) { hudAt = S.time; uiUpdate(); }
      if (S.time - miniAt > 0.12) { miniAt = S.time; uiMini(); }
      if (S.time - ambientAt > 12) { ambientAt = S.time; saveVisited(); }
      if (S.hurtT > 0) {
        S.hurtT -= dt;
        var a = clamp(S.hurtT / 0.28, 0, 1) * 0.5;
        if (a > 0.01) {
          var g = ctx.createRadialGradient(S.view.w / 2, S.view.h / 2, Math.min(S.view.w, S.view.h) * 0.25,
            S.view.w / 2, S.view.h / 2, Math.max(S.view.w, S.view.h) * 0.62);
          g.addColorStop(0, 'rgba(180,30,30,0)');
          g.addColorStop(1, 'rgba(180,30,30,' + a.toFixed(3) + ')');
          ctx.fillStyle = g;
          ctx.fillRect(0, 0, S.view.w, S.view.h);
        }
      }
      // v5.6 W4 不灭：0.2s 白闪 + 1s 金色 vignette
      if (S.cheatVgUntil && S.time < S.cheatVgUntil) {
        var vg = ctx.createRadialGradient(S.view.w / 2, S.view.h / 2, Math.min(S.view.w, S.view.h) * 0.2,
          S.view.w / 2, S.view.h / 2, Math.max(S.view.w, S.view.h) * 0.66);
        vg.addColorStop(0, 'rgba(255,214,120,0)');
        vg.addColorStop(1, 'rgba(255,196,90,' + (0.34 * clamp((S.cheatVgUntil - S.time) / 1.0, 0, 1)).toFixed(3) + ')');
        ctx.fillStyle = vg;
        ctx.fillRect(0, 0, S.view.w, S.view.h);
        if (S.time < (S.cheatVgUntil - 0.8)) {
          ctx.fillStyle = 'rgba(255,248,230,' + (0.5 * (1 - (S.cheatVgUntil - 0.8 - S.time) / 0.2 > 0 ? (S.cheatVgUntil - 0.8 - S.time) / 0.2 : 0)).toFixed(3) + ')';
          ctx.fillRect(0, 0, S.view.w, S.view.h);
        }
      } else if (S.cheatVgUntil && S.time >= S.cheatVgUntil) {
        S.cheatVgUntil = 0;
      }
      // v5.6 W4 s4 见切：完美闪避成功瞬间的 0.15s 白边闪光
      if (S.pdFlashUntil && S.time < S.pdFlashUntil) {
        ctx.strokeStyle = 'rgba(255,255,255,0.85)';
        ctx.lineWidth = Math.max(3, S.zoom * 1.5);
        ctx.strokeRect(1, 1, S.view.w - 2, S.view.h - 2);
      }
      } catch (e2) {
        console.error('[sg5-loop-hud]', e2);
      }
    }
  }

  function loop(ts) {
    raf = window.requestAnimationFrame(loop);
    step(ts);
  }

  // 环境粒子：每个区域有自己的「空气」
  function ambient(dt) {
    var z = S.zone;
    var me = S.me;
    // 夜里的萤火虫：镇上、草原、森林才有。慢、亮、少 —— 多了就成了噪点。
    if ((S.phase === 'night' || S.phase === 'dusk') &&
        (z === 'town' || z === 'meadow' || z === 'forest') && me && Math.random() < dt * 3.2) {
      S.parts.push({
        x: me.x + (Math.random() - 0.5) * 22, y: me.y + (Math.random() - 0.5) * 14,
        vx: (Math.random() - 0.5) * 0.35, vy: (Math.random() - 0.5) * 0.25,
        life: 2.6 + Math.random() * 2.2, max: 4.8,
        col: 'rgba(226,255,160,', r: 1.5
      });
    }
    if (Math.random() > dt * 8) return;
    var ox = (Math.random() - 0.5) * 26, oy = (Math.random() - 0.5) * 18;
    if (z === 'swamp') {
      S.parts.push({ x: me.x + ox, y: me.y + oy, vx: 0.2, vy: -0.25, life: 2.4, max: 2.4, col: '#d8ff9a', r: 1.1 });
    } else if (z === 'frost') {
      S.parts.push({ x: me.x + ox, y: me.y - 6 + Math.random() * 4, vx: 0.35, vy: 0.9, life: 4, max: 4, col: '#ffffff', r: 1.2 });
    } else if (z === 'crag') {
      S.parts.push({ x: me.x + ox, y: me.y + oy, vx: -0.4, vy: -0.1, life: 1.6, max: 1.6, col: '#c9bda8', r: 1 });
    } else if (z === 'abyss') {
      S.parts.push({ x: me.x + ox, y: me.y + oy, vx: 0, vy: -0.5, life: 2.2, max: 2.2, col: '#b48cff', r: 1.2 });
    } else if (z === 'forest') {
      S.parts.push({ x: me.x + ox, y: me.y + oy, vx: 0.6, vy: 0.15, life: 2.6, max: 2.6, col: 'rgba(160,220,150,', r: 1 });
    }
  }

  // ---------------- §20 挂载 ----------------
  function mount(container, context) {
    S.api = context.data.api;
    S.storage = context.data.storage;
    S.realtime = context.data.realtime;
    S.context = context;
    S.onDestroyAll = [];
    S.parts = [];
    S.texts = [];
    S.beams = [];
    S.rings = [];
    // v5.6 W3：奖励实体层（磁吸星屑珠 / 尸体 / 装备光柱）
    S.orbs = [];
    S.corpses = [];
    S.pillars = [];
    S.orbSfxAt = 0;
    S.orbStreak = 0;
    S.orbMergeTxt = '';
    S.orbMergeAt = 0;
    S.mobs = {};
    S.players = {};
    S.mobs = {};
    S.ready = false;
    S.paused = false;
    S.hitstopUntil = 0;
    S.slow = null;
    S.hurtT = 0;

    var cleanups = [];
    function onDestroy(fn) {
      if (typeof fn === 'function') {
        cleanups.push(fn);
        try { context.app.onDestroy(fn); } catch (e) {}
      }
    }

    root = el('div', 'sg5-root');
    canvas = document.createElement('canvas');
    canvas.className = 'sg5-cv';
    root.appendChild(canvas);
    container.appendChild(root);
    ctx = canvas.getContext('2d', { alpha: false });
    S.ctx = ctx;

    uiBuild(root);
    var input = inputBind(root, onDestroy);
    input.attachJoy(UI.joy, UI.joy.firstChild);

    // 音效偏好
    try {
      var snd = S.storage.get('snd', '1');
      S.audio.on = snd !== '0';
    } catch (e) {}
    auInit(function (p) { return context.app.assetUrl(p); });
    auSetOn(S.audio.on);

    // 尺寸
    resize();
    if (typeof window.ResizeObserver === 'function') {
      var ro = new window.ResizeObserver(function () { resize(); });
      ro.observe(root);
      onDestroy(function () { ro.disconnect(); });
    }
    var rsTimer = setInterval(resize, 900);
    onDestroy(function () { clearInterval(rsTimer); });
    var onWinResize = function () { resize(); };
    window.addEventListener('resize', onWinResize, false);
    onDestroy(function () { window.removeEventListener('resize', onWinResize); });

    // 第一次交互解锁音频（自动播放策略）
    var unlock = function () { auResume(); };
    root.addEventListener('mousedown', unlock, false);
    root.addEventListener('touchstart', unlock, false);
    onDestroy(function () {
      root.removeEventListener('mousedown', unlock);
      root.removeEventListener('touchstart', unlock);
    });

    // 面板快捷键
    var kp = function (e) {
      var k = (e.key || '').toLowerCase();
      if (k === 'escape') { closePanel(); return; }
      if (e.target && e.target.tagName === 'INPUT') return;
      if (k === 'p') {
        // 有邀请卡就当成「接受」，没有才走旧的按 P 入队
        if (S.inviteCard && S.inviteCard.node) {
          var pb = S.inviteCard.node.querySelector('.sg5-btn-primary');
          if (pb) pb.click();
        } else if (S.pendingInvite) { apiAcceptInvite(); S.pendingInvite = ''; }
        return;
      }
      if (k === 'g') { apiEmote(EMOTE_SET[Math.floor(Math.random() * EMOTE_SET.length)].id); return; }
      if (k === 'f') { openPanel('social'); return; }
      if (k === 'c') openPanel('char');
      else if (k === 'b' || k === 'i') openPanel('bag');
      else if (k === 'm') openPanel('map');
      else if (k === 't') openPanel('talent');
      else if (k === 'v' || k === 'j' && e.shiftKey) openPanel('dex');
    };
    document.addEventListener('keydown', kp, false);
    onDestroy(function () { document.removeEventListener('keydown', kp, false); });

    // 后台省电
    var onVis = function () {
      if (document.hidden) {
        try { if (AU.a) AU.a.pause(); if (AU.b) AU.b.pause(); } catch (e) {}
      } else if (AU.on && AU.cur) {
        auMusic(AU.cur, true);
      }
    };
    document.addEventListener('visibilitychange', onVis, false);
    onDestroy(function () { document.removeEventListener('visibilitychange', onVis); });

    // ---- 载入 ----
    var loading = el('div', 'sg5-loading');
    var ring = el('div', 'sg5-loadring');
    loading.appendChild(ring);
    var lt = el('div', 'sg5-loadtext', '正在渡海…');
    loading.appendChild(lt);
    root.appendChild(loading);
    UI.loading = loading;
    UI.loadText = lt;

    function fail(msg) {
      loading.className = 'sg5-loading is-error';
      setText(lt, msg || '海面起了雾，没能靠岸');
      var retry = el('button', 'sg5-btn', '再试一次');
      retry.type = 'button';
      retry.addEventListener('click', function () {
        loading.className = 'sg5-loading';
        setText(lt, '正在渡海…');
        if (retry.parentNode) loading.removeChild(retry);
        boot();
      }, false);
      loading.appendChild(retry);
    }

    function boot() {
      setText(lt, '正在展开群岛…');
      loadTerrain().then(function (data) {
        setText(lt, '正在点亮灯…');
        worldInit(data);
        S.towers = data.lights || {};
        return apiPost('/shiguang/v5/enter');
      }).then(function (d) {
        setText(lt, '正在醒来…');
        // 精灵图必须先解码完，否则第一帧会全是空白
        return loadAtlas().then(function () { return d; });
      }).then(function (d) {
        applyEnter(d);
        bindPlayerClick(canvas, root, onDestroy);
        S.ready = true;
        showIntro();
        loading.className = 'sg5-loading is-done';
        setTimeout(function () { if (loading.parentNode) loading.parentNode.removeChild(loading); }, 420);
        if (syncTimer) clearInterval(syncTimer);
        syncTimer = setInterval(syncOnce, SYNC_MS);
        onDestroy(function () { clearInterval(syncTimer); });
        syncOnce();
        auMusic('town');
        setTimeout(function () {
          toast('J 攻击 · K 翻滚 · L 技能 · E 交互 · M 地图', 'tip');
        }, 1400);
      }, function (err) {
        fail(err && err.message ? err.message : '');
      });
    }

    function loadAtlas() {
      return new Promise(function (resolve) {
        var img = new Image();
        img.onload = function () { S.atlas = img; resolve(); };
        img.onerror = function () { fail('素材加载失败'); resolve(); };
        img.src = context.app.assetUrl('frontend/v5/atlas.png');
      });
    }

    if (!raf) raf = window.requestAnimationFrame(loop);
    onDestroy(function () {
      if (raf) window.cancelAnimationFrame(raf);
      raf = 0;
      if (syncTimer) clearInterval(syncTimer);
      syncTimer = 0;
      saveVisited();
      apiLeave();
      auDispose();
      for (var i = 0; i < S.onDestroyAll.length; i++) {
        try { if (typeof S.onDestroyAll[i] === 'function') S.onDestroyAll[i](); } catch (e) {}
      }
    });

    boot();

    // 对外暴露一点调试接口（线上排查用，不影响玩家）
    // v5.8 守夜仪式状态卡：S.finale.open 期间常驻右下，1.2s 轮询服务端权威进度
    function finaleUiPaint() {
      var F = S.finale;
      if (!F || (!F.open && !F.meWaiting) || F.done) {
        if (UI.finaliteEl && UI.finaliteEl.parentNode) UI.finaliteEl.parentNode.removeChild(UI.finaliteEl);
        UI.finaliteEl = null;
        return;
      }
      if (!UI.finaliteEl) {
        UI.finaliteEl = el('div', 'sg5-finalite sg5-frame');
        UI.hud.appendChild(UI.finaliteEl);
      }
      var need = F.threshold || Math.min(3, Math.max(1, F.waiters || 1));
      var secs = F.startedAt ? Math.min(60, Math.max(0, Math.round(((F.now || Date.now()) - F.startedAt) / 1000))) : 0;
      var line = F.meWaiting ? '守夜中 · ' + (F.waiters || 1) + ' 人 · 第 ' + secs + ' / 60 秒' : '举灯同守 · 现在 ' + (F.waiters || 0) + ' / ' + need + ' 人（塔下按 E）';
      var el2 = UI.finaliteEl;
      clearNode(el2);
      el2.appendChild(el('div', 'sg5-finalite-title', '最后的守夜'));
      el2.appendChild(el('div', 'sg5-finalite-line', line));
      var bar = el('div', 'sg5-finalite-bar');
      var fill = el('div', 'sg5-finalite-fill');
      fill.style.width = Math.round((F.startedAt ? secs / 60 : (F.waiters || 0) / need) * 100) + '%';
      bar.appendChild(fill);
      el2.appendChild(bar);
    }
    // 守夜轮询：finale open 时每 1.2s 拉一次权威状态（句柄挂 S，重连自动恢复）
    S.finalePollAt = 0;
    var _socialTickFinale = socialTick;
    socialTick = function (tt) {
      _socialTickFinale(tt);
      try {
        if (S.finale && (S.finale.open || S.finale.meWaiting) && !S.finale.done) {
          if (tt - S.finalePollAt > 1.2) {
            S.finalePollAt = tt;
            apiPost('/shiguang/v5/finalite', { act: 'status' }).then(function (r) {
              if (r && r.data) { S.finale = r.data; finaleUiPaint(); }
            }).catch(function () {});
          }
        }
      } catch (e) {}
    };

    try {
      // v5.6 W1：手动驱动主循环（headless rAF 节流 / 截图机用）。advance 一次 ≈ 16ms。
      window.__sg5 = {
        state: S,
        tick: function (ms) {
          var n = Math.max(1, Math.min(600, Math.round((ms || 16) / 16)));
          for (var i = 0; i < n; i++) {
            try { step(performance.now()); } catch (e) {}
          }
          return S.time;
        },
        mobs: function () { return S.mobs; },
        teleport: function (x, y) {
          if (S.me) { S.me.x = x; S.me.y = y; S.cam.x = x * TILE; S.cam.y = y * TILE; }
        },
        panel: function (id) { if (id) openPanel(id); else closePanel(); },
        diag: function () {
          var vr = viewRange();
          var n = { tree: 0, rock: 0, props: PROPS.length, draw: DRAW.length, zoom: S.zoom, mobs: Object.keys(S.mobs).length, atlas: !!S.atlas };
          for (var ty = vr.y0; ty <= vr.y1; ty++) {
            for (var tx = vr.x0; tx <= vr.x1; tx++) {
              var t = tileAt(tx, ty);
              if (t === T.TREE || t === T.PINE) n.tree++;
              else if (t === T.ROCK) n.rock++;
            }
          }
          return n;
        },
        attack: function () { IN.attack = 1; },
        roll: function () { IN.roll = 1; },
        skill: function () { IN.skill = 1; },
        use: function () { IN.use = 1; },
        interact: function () { IN.use = 1; },   // v5.7：语义别名（visual 探针用 interact 触发 E）
        testFinale: function (ev) { handleEvent(ev); },   // v5.8：注入守夜/终章事件（回归用）
        finalite: function (act) {
          return apiPost('/shiguang/v5/finalite', { act: act || 'status' }).then(function (r) {
            if (r && r.data) { S.finale = r.data; finaleUiPaint(); }
            return r && r.data;
          });
        },
        testEvent: function (e) { handleEvent(e); },   // v5.7：注入事件（灯语仪式卡等）回归用
        toast: toast,
        social: function () {
          return { friends: S.friends.length, nearby: S.nearby.length, acts: Object.keys(S.acts || {}).length,
            party: !!(S.party && S.party.members && S.party.members.length), bubbles: S.bubbles.length };
        },
        card: function () { cardFriendReq({ from: '1002', n: '小明' }); },
        actfx: function () {
          spawnActFx({ x: S.me.x, y: S.me.y, a: 'dance', ch: '♪', fn: '我', tn: '小明' });
          pushBubble(S.myId, '一起跳舞吧！', '#ffe1a6');
        },
        // 调试用：锁住昼夜（截图/回归时不想等到夜里）
        lockPhase: function (phase, pf) {
          S.pfLock = !!phase;
          if (phase) {
            S.phase = phase;
            // 每个时段的默认进度要合理：night + pf=0.3 算出来的暗度只有 0.32，看起来像白天
            S.pf = pf == null ? (phase === 'night' ? 0.94 : phase === 'dusk' ? 0.68 : 0.3) : pf;
          }
        }
      };
    } catch (e) {}
  }

  // 开场：2 秒的标题，然后交给世界
  function showIntro() {
    var iv = el('div', 'sg5-intro');
    iv.appendChild(el('div', 'sg5-intro-title', '拾光群岛'));
    iv.appendChild(el('div', 'sg5-intro-sub', '长 夜'));
    iv.appendChild(el('div', 'sg5-intro-line'));
    iv.appendChild(el('div', 'sg5-intro-hint', S.me && S.me.isNew ? '第 一 夜 · 灯 还 亮 着' : '回 到 灯 边'));
    root.appendChild(iv);
    setTimeout(function () { iv.className = 'sg5-intro is-out'; }, 1500);
    setTimeout(function () { if (iv.parentNode) iv.parentNode.removeChild(iv); }, 2600);
  }

  function unmount(container) {
    if (!container) return;
    while (container.firstChild) container.removeChild(container.firstChild);
    try { if (window.__sg5) delete window.__sg5; } catch (e) {}
  }
