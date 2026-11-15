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

  function loop(ts) {
    raf = window.requestAnimationFrame(loop);
    var t = ts / 1000;
    if (!lastT) lastT = t;
    var dt = Math.min(0.05, t - lastT);
    lastT = t;
    if (dt <= 0) return;
    S.time += dt;

    if (!document.hidden && S.ready && !S.paused) {
      var freeze = S.hitstopUntil && S.time < S.hitstopUntil;
      var scale = 1;
      if (S.slow && S.time < S.slow.until) scale = S.slow.scale;
      else if (S.slow) S.slow = null;
      var ds = freeze ? 0 : dt * scale;
      if (ds > 0) {
        updatePlayer(ds, S.time);
        resolveAttack(S.me, S.time);
        updateMobs(ds, S.time);
        updatePlayers(ds);
        updateShots(ds);
        ambient(ds);
      }
      camUpdate(dt);
      renderWorld(freeze ? 0 : dt);
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
    }
  }

  // 环境粒子：每个区域有自己的「空气」
  function ambient(dt) {
    var z = S.zone;
    if (Math.random() > dt * 8) return;
    var me = S.me;
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
        S.ready = true;
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
    try {
      window.__sg5 = {
        state: S,
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
        toast: toast,
        // 调试用：锁住昼夜（截图/回归时不想等到夜里）
        lockPhase: function (phase, pf) { S.pfLock = !!phase; if (phase) { S.phase = phase; S.pf = pf == null ? 0.3 : pf; } }
      };
    } catch (e) {}
  }

  function unmount(container) {
    if (!container) return;
    while (container.firstChild) container.removeChild(container.firstChild);
    try { if (window.__sg5) delete window.__sg5; } catch (e) {}
  }
