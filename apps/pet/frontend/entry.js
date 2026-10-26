// 桌宠屋（页面）：领养 → 拼豆编辑器 → 我的宠物
// ============================================================
// 拼豆编辑器（对平板手感优化）：
//   - 16×16 网格，画笔/橡皮/油漆桶，16 色拼豆盘
//   - 左右对称模式（新手神器，实体拼豆也是这么玩的）
//   - 撤销（30 步快照）；官方模板可直接改
// 保存后 dispatch 'ci-pet-state-changed'，悬浮桌宠即时刷新。
// 编码约定：全 ES5（Chrome 80 基线）
(function() {
  'use strict';
  var NAME = 'pet';
  var DIM = 16;          // 网格
  // 编辑画布每格 px：按「宠物屋容器实际宽度」自适应，而不是 window.innerWidth ——
  // 宿主（AppShell → MarketRuntime）给应用的是 height:100% 的受限盒子，视口再宽也照
  // 容器算，否则 16 格 × 大格宽会把画布顶出可视区且又没有横向滚动。
  // 预算 = 容器宽 − root 左右 padding(32) − 画布容器 padding(16) − 安全余量(8)
  function availWidth() {
    var w = (root && root.clientWidth) ? root.clientWidth : Math.min(window.innerWidth || 360, 720);
    return w - 56;
  }
  function computeCell() {
    var raw = Math.floor(availWidth() / DIM / 2) * 2; // 取偶数，避免半像素发丝缝
    return Math.max(16, Math.min(30, raw));
  }
  var CELL = computeCell();
  var palette = [];
  var templates = [];
  var state = null;      // 服务端状态
  var root = null;
  var api = null;
  var storage = null;    // SDK 本地存档（手作稿，供「换回拼豆」时复原）

  // ---- 编辑器状态 ----
  var edit = null;       // { data: '256字符', color: idx, tool: 'pen|eraser|fill', mirror: bool }
  var undoStack = [];
  var editCanvas = null;
  var eg = null;

  // ---- 像素渲染（dpr 真实像素绘制：任何屏幕都锐利，不依赖 image-rendering）----
  // cellPx：每个豆子的 CSS 尺寸；canvas 物理分辨率 = cellPx × dpr
  function paint(canvasEl, design, cellPx) {
    if (!canvasEl || !design || !cellPx) return;
    var dpr = window.devicePixelRatio || 1;
    var cssW = design.w * cellPx;
    var cssH = design.h * cellPx;
    canvasEl.width = Math.round(cssW * dpr);
    canvasEl.height = Math.round(cssH * dpr);
    canvasEl.style.width = cssW + 'px';
    canvasEl.style.height = cssH + 'px';
    var g = canvasEl.getContext('2d');
    g.clearRect(0, 0, canvasEl.width, canvasEl.height);
    var cell = cellPx * dpr;
    for (var y = 0; y < design.h; y++) {
      for (var x = 0; x < design.w; x++) {
        var ch = design.data.charAt(y * design.w + x);
        if (ch === '.') continue;
        var c = palette[parseInt(ch, 16)];
        if (!c) continue;
        g.fillStyle = c;
        // +0.5 防相邻格间发丝缝
        g.fillRect(x * cell, y * cell, cell + 0.5, cell + 0.5);
      }
    }
  }

  // ---- 基础 DOM ----
  function h(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  function clearRoot() {
    while (root && root.firstChild) root.removeChild(root.firstChild);
  }

  // ================= 首屏：未领养 =================
  function renderAdopt() {
    clearRoot();
    root.appendChild(h('h2', null, '领养一只小家伙'));
    root.appendChild(h('p', 'ci-pethome-sub',
      '推荐直接领养大肥鱼（会跳舞、吃火锅、玩魔方的像素鲸鱼）；手作党可以从模板或空白画布开始拼。'));
    var grid = h('div', 'ci-pet-templates');
    // 默认形象：大肥鱼（dsh-pet，CC BY-NC-SA，视频形态）
    var whale = h('div', 'ci-pet-tpl ci-pet-tpl--whale');
    whale.appendChild(h('div', 'ci-pet-tpl-emoji', '🐳'));
    whale.appendChild(h('div', 'ci-pet-tpl-name', '大肥鱼'));
    whale.appendChild(h('div', 'ci-pet-tpl-desc', '100 多种动作：吃火锅、玩魔方、拆礼物…推荐！'));
    whale.addEventListener('click', function() { renderNaming('video'); });
    grid.appendChild(whale);
    templates.forEach(function(t) {
      var card = h('div', 'ci-pet-tpl');
      var cv = document.createElement('canvas');
      paint(cv, { w: DIM, h: DIM, data: t.art.join('') }, 4.5);
      card.appendChild(cv);
      card.appendChild(h('div', 'ci-pet-tpl-name', t.name));
      card.appendChild(h('div', 'ci-pet-tpl-desc', t.desc));
      card.addEventListener('click', function() {
        startEditor(t.art.join(''));
      });
      grid.appendChild(card);
    });
    // 空白开始
    var blank = h('div', 'ci-pet-tpl');
    var cvb = document.createElement('canvas');
    paint(cvb, { w: DIM, h: DIM, data: new Array(DIM * DIM + 1).join('.') }, 4.5);
    blank.appendChild(cvb);
    blank.appendChild(h('div', 'ci-pet-tpl-name', '从空白开始'));
    blank.appendChild(h('div', 'ci-pet-tpl-desc', '一块干净的拼豆板'));
    blank.addEventListener('click', function() { startEditor(''); });
    grid.appendChild(blank);
    root.appendChild(grid);
  }

  // ================= 编辑器 =================
  function setCell(idx, ch) {
    edit.data = edit.data.substring(0, idx) + ch + edit.data.substring(idx + 1);
  }

  function applyAt(col, row, ch) {
    setCell(row * DIM + col, ch);
    if (edit.mirror) setCell(row * DIM + (DIM - 1 - col), ch);
  }

  function redrawEditor() {
    paint(editCanvas, { w: DIM, h: DIM, data: edit.data }, CELL);
    // 网格线：dpr 物理像素画，1px 锐利；中线（第 8 列/行）加深辅助对称
    var dpr = window.devicePixelRatio || 1;
    var g = editCanvas.getContext('2d');
    var cell = CELL * dpr;
    for (var i = 1; i < DIM; i++) {
      g.strokeStyle = (i === DIM / 2) ? 'rgba(10,132,255,0.45)' : 'rgba(128,128,128,0.35)';
      g.lineWidth = 1 * dpr;
      g.beginPath(); g.moveTo(i * cell, 0); g.lineTo(i * cell, editCanvas.height); g.stroke();
      g.beginPath(); g.moveTo(0, i * cell); g.lineTo(editCanvas.width, i * cell); g.stroke();
    }
  }

  function snapshot() {
    undoStack.push(edit.data);
    if (undoStack.length > 30) undoStack.shift();
  }

  function floodFill(col, row, ch) {
    var target = edit.data.charAt(row * DIM + col);
    if (target === ch) return;
    var stack = [[col, row]];
    var seen = {};
    while (stack.length) {
      var p = stack.pop();
      var x = p[0], y = p[1];
      if (x < 0 || y < 0 || x >= DIM || y >= DIM) continue;
      var k = x + ',' + y;
      if (seen[k]) continue;
      seen[k] = 1;
      if (edit.data.charAt(y * DIM + x) !== target) continue;
      setCell(y * DIM + x, ch);
      stack.push([x + 1, y]); stack.push([x - 1, y]);
      stack.push([x, y + 1]); stack.push([x, y - 1]);
    }
  }

  function cellFromEvent(e) {
    var r = editCanvas.getBoundingClientRect();
    var col = Math.floor((e.clientX - r.left) / (r.width / DIM));
    var row = Math.floor((e.clientY - r.top) / (r.height / DIM));
    if (col < 0 || row < 0 || col >= DIM || row >= DIM) return null;
    return { col: col, row: row };
  }

  function startEditor(initialData) {
    edit = {
      data: initialData && initialData.length === DIM * DIM ? initialData : new Array(DIM * DIM + 1).join('.'),
      color: 2,
      tool: 'pen',
      mirror: false
    };
    undoStack = [];
    renderEditor();
  }

  function renderEditor() {
    clearRoot();
    CELL = computeCell();   // 每次进编辑器按当期容器宽度重算（旋转/分屏后也准）
    root.appendChild(h('h2', null, '拼豆工作台'));
    root.appendChild(h('p', 'ci-pethome-sub', '一格一格拼出它。对称模式适合画脸，画完点「就它了」。'));

    var wrap = h('div', 'ci-pet-editor');
    var canvasWrap = h('div', 'ci-pet-canvaswrap');
    editCanvas = document.createElement('canvas');
    editCanvas.className = 'ci-pet-editcanvas';
    canvasWrap.appendChild(editCanvas);
    wrap.appendChild(canvasWrap);

    var tools = h('div', 'ci-pet-tools');
    // 调色板
    var palBox = h('div', 'ci-pet-palette');
    palette.forEach(function(color, idx) {
      var sw = h('div', 'ci-pet-swatch' + (idx === edit.color ? ' ci-pet-swatch--active' : ''));
      sw.style.background = color;
      sw.addEventListener('click', function() {
        edit.color = idx;
        edit.tool = 'pen';
        renderEditor();
      });
      palBox.appendChild(sw);
    });
    tools.appendChild(palBox);

    // 工具行
    var row = h('div', 'ci-pet-btnrow');
    function btn(text, ghost, fn) {
      var b = h('button', 'ci-pet-btn' + (ghost ? ' ci-pet-btn--ghost' : ''), text);
      b.addEventListener('click', fn);
      row.appendChild(b);
      return b;
    }
    btn('画笔', edit.tool !== 'pen', function() { edit.tool = 'pen'; renderEditor(); });
    btn('橡皮', edit.tool !== 'eraser', function() { edit.tool = 'eraser'; renderEditor(); });
    btn('油漆桶', edit.tool !== 'fill', function() { edit.tool = 'fill'; renderEditor(); });
    btn(edit.mirror ? '对称：开' : '对称：关', true, function() { edit.mirror = !edit.mirror; renderEditor(); });
    btn('撤销', true, function() {
      if (undoStack.length) { edit.data = undoStack.pop(); redrawEditor(); }
    });
    btn('清空', true, function() { snapshot(); edit.data = new Array(DIM * DIM + 1).join('.'); redrawEditor(); });
    tools.appendChild(row);

    // 完成行
    var row2 = h('div', 'ci-pet-btnrow');
    var doneBtn = btn('就它了 →', false, function() { renderNaming('pixel'); });
    row2.appendChild(doneBtn);
    if (state && state.adopted) {
      var backBtn = btn('先不换了', true, function() { renderHome(); });
      row2.appendChild(backBtn);
    }
    tools.appendChild(row2);
    wrap.appendChild(tools);
    root.appendChild(wrap);

    // 交互
    var painting = false;
    function applyEvent(e) {
      var c = cellFromEvent(e);
      if (!c) return;
      snapshot();
      if (edit.tool === 'fill') floodFill(c.col, c.row, edit.color.toString(16));
      else applyAt(c.col, c.row, edit.tool === 'eraser' ? '.' : edit.color.toString(16));
      redrawEditor();
    }
    editCanvas.addEventListener('pointerdown', function(e) {
      painting = true;
      try { editCanvas.setPointerCapture(e.pointerId); } catch (err) {}
      applyEvent(e);
      e.preventDefault();
    });
    editCanvas.addEventListener('pointermove', function(e) {
      if (!painting || edit.tool === 'fill') return;
      applyEvent(e);
    });
    function stop() { painting = false; }
    editCanvas.addEventListener('pointerup', stop);
    editCanvas.addEventListener('pointercancel', stop);

    redrawEditor();
  }

  // ================= 起名 / 定形象 =================
  // kind: 'video' 大肥鱼 | 'pixel' 手作拼豆 | 缺省按是否有草稿判定（向后兼容）
  // ⚠️ 必须显式传：模块级 edit 是跨页面常驻的，靠它"猜"会让「改名字」把上次
  //    编辑器里的草稿当成 design 提交（真实现象：改个名字，宠物形象被换掉）。
  function renderNaming(kind) {
    clearRoot();
    var isPixelNaming = kind === 'pixel' ? true : (kind === 'video' ? false : !!(edit && edit.data));
    var existingName = (state && state.name) || '';
    root.appendChild(h('h2', null, existingName ? '改个名字' : '给它起个名字'));
    var preview = document.createElement('canvas');
    if (isPixelNaming) {
      paint(preview, { w: DIM, h: DIM, data: edit.data }, 6);
      preview.style.width = '96px';
      preview.style.height = '96px';
    } else {
      var whaleCard = h('div', 'ci-pet-tpl-emoji', '🐳');
      whaleCard.style.cssText = 'font-size:64px;width:96px;height:96px;display:flex;align-items:center;justify-content:center;';
      preview = whaleCard;
    }
    var card = h('div', 'ci-pet-card');
    card.appendChild(preview);
    var info = h('div', 'ci-pet-card-info');
    var input = h('input', 'ci-pet-input');
    input.type = 'text';
    input.maxLength = 12;
    input.placeholder = '最多 12 个字';
    if (existingName) input.value = existingName;
    info.appendChild(input);
    var row = h('div', 'ci-pet-btnrow');
    var save = h('button', 'ci-pet-btn', isPixelNaming ? (existingName ? '保存造型与名字' : '领养它！') : (existingName ? '换成大肥鱼' : '领养大肥鱼！'));
    row.appendChild(save);
    if (existingName) {
      var cancel = h('button', 'ci-pet-btn ci-pet-btn--ghost', '取消');
      cancel.addEventListener('click', function() { renderHome(); });
      row.appendChild(cancel);
    }
    info.appendChild(row);
    card.appendChild(info);
    root.appendChild(card);

    save.addEventListener('click', function() {
      var name = input.value.trim();
      if (!name) { input.focus(); return; }
      save.disabled = true;
      save.textContent = '保存中…';
      var payload = { adopt: true, name: name };
      if (isPixelNaming) payload.design = { v: 1, w: DIM, h: DIM, pal: 'p16', data: edit.data };
      else payload.design = { type: 'video', character: 'dsh-whale' }; // 显式覆盖：从手作切回大肥鱼
      api.put('/pet/state', payload).then(function(res) {
        state = (res.data && res.data.data && res.data.data.state) || state;
        edit = null;  // 草稿用完即弃，别让它在后续「改名字」里复活
        notifyChanged();
        renderHome();
      }).catch(function(err) {
        save.disabled = false;
        save.textContent = isPixelNaming ? '领养它！' : '领养大肥鱼！';
        if (context && context.system && context.system.toast) {
          context.system.toast({ message: '保存失败：' + ((err && err.response && err.response.data && err.response.data.message) || '请重试'), type: 'error' });
        }
      });
    });
    setTimeout(function() { input.focus(); }, 60);
  }

  // ================= 状态推导（纯前端，不加后端字段）=================
  var TIER = [0, 20, 60, 120, 200];
  var TIER_NAMES = ['初识', '熟悉', '亲密', '形影不离', '灵魂伙伴'];
  function tierOf(b) { var t = 0; for (var i = 0; i < TIER.length; i++) { if (b >= TIER[i]) t = i; } return t; }

  // 饱食度：一次喂食顶 4 小时，线性衰减（与后端 20 分钟冷却、每日 3 次上限不冲突，只是观感）
  function fedPct() {
    var t = state && state.last_fed_at ? new Date(state.last_fed_at).getTime() : 0;
    if (!t) return 0;
    return Math.round(Math.max(0, Math.min(1, 1 - (Date.now() - t) / (4 * 3600 * 1000))) * 100);
  }
  function todayInteracts() {
    return state ? (state.poked_today || 0) + (state.fed_today || 0) : 0;
  }
  function daysTogether() {
    if (!state || !state.adopted_at) return 1;
    var n = Math.floor((Date.now() - new Date(state.adopted_at).getTime()) / 86400000) + 1;
    return Math.max(1, n);
  }
  function petMood() {
    if (!state) return { emoji: '🐚', text: '…' };
    if (state.enabled === false) return { emoji: '💤', text: '正在桌面上休息' };
    var n = todayInteracts();
    if (n === 0) return { emoji: '😢', text: '今天还没被摸过，有点想你' };
    if (fedPct() >= 80 && n >= 4) return { emoji: '😍', text: '今天被宠坏啦！' };
    if (fedPct() <= 10) return { emoji: '🍚', text: '肚子有点空空的…' };
    return { emoji: '😊', text: '乖乖待在桌面上等你' };
  }

  // hero 区的活预览：从动画池挑一个待机动作循环播（池拉不到就用固定名）
  var heroPool = null;
  function heroIdleName() {
    return (heroPool && heroPool.idle && heroPool.idle.length) ? heroPool.idle[0] : '待机呼吸休闲';
  }
  function loadHeroPool() {
    if (heroPool) return;
    try {
      fetch('/market-static/pet/assets/anim-pools.json').then(function(r) { return r.json(); }).then(function(j) {
        heroPool = j;
        var v = root && root.querySelector('.ci-pet-hero-video');
        if (v && !v.getAttribute('src')) v.src = poolUrl(heroIdleName());
      }).catch(function() {});
    } catch (e) {}
  }
  function poolUrl(name) {
    return '/market-static/pet/assets/webm/' + encodeURIComponent(name) + '.webm';
  }

  // 小构件：状态条 / 大按钮 / 分区标题
  function statRow(label, pct, color, note) {
    var row = h('div', 'ci-pet-statrow');
    var head = h('div', 'ci-pet-stathead');
    head.appendChild(h('span', null, label));
    if (note) head.appendChild(h('span', 'ci-pet-statnote', note));
    row.appendChild(head);
    var bar = h('div', 'ci-pet-statbar');
    var fill = document.createElement('span');
    fill.style.width = Math.max(4, Math.min(100, pct)) + '%';
    fill.style.background = color;
    bar.appendChild(fill);
    row.appendChild(bar);
    return row;
  }
  function bigBtn(emoji, label, sub, fn) {
    var b = h('button', 'ci-pet-bigbtn');
    b.appendChild(h('span', 'ci-pet-bigbtn-emoji', emoji));
    b.appendChild(h('span', 'ci-pet-bigbtn-label', label));
    b.appendChild(h('span', 'ci-pet-bigbtn-sub', sub));
    b.addEventListener('click', fn);
    return b;
  }
  function sectionTitle(text) {
    return h('div', 'ci-pet-section', text);
  }

  // ================= 换形象（共用）=================
  // 手作稿存档：从"拼豆 → 大肥鱼"时留一份，之后「换成手作拼豆」能原样换回去
  function savePixelDraft() {
    try {
      if (storage && state && state.design && state.design.type !== 'video') {
        storage.set('lastPixel', state.design);
      }
    } catch (e) {}
  }

  // 只换 design，名字/羁绊/开关全部保留（切换前后都通知悬浮层按新形态重建）
  function switchDesign(design, btn, label) {
    if (!api || !design) return;
    if (btn) { btn.disabled = true; btn.textContent = '切换中…'; }
    api.put('/pet/state', { design: design }).then(function(res) {
      state = (res.data && res.data.data && res.data.data.state) || state;
      notifyChanged();
      renderHome();
    }).catch(function(err) {
      if (btn) { btn.disabled = false; btn.textContent = label || '换形象'; }
      if (context && context.system && context.system.toast) {
        context.system.toast({
          message: '切换失败：' + ((err && err.response && err.response.data && err.response.data.message) || '请重试'),
          type: 'error'
        });
      }
    });
  }

  // ================= 我的宠物 =================
  function buildDiag() {
    var lines = [];
    lines.push('1 服务端状态: ' + (state && state.adopted ? '已领养（' + (state.name || '') + '，显示开关=' + (state.enabled !== false ? '开' : '关') + '）' : '未领养'));
    var host = window.ClassIntraMarket;
    lines.push('2 宿主SDK: ' + (host ? '在' : '缺失'));
    lines.push('3 悬浮脚本已注册: ' + (typeof window.__ciPetDebug === 'function' ? '是' : '否（悬浮脚本未加载/未执行）'));
    if (typeof window.__ciPetDebug === 'function') {
      try {
        var d = window.__ciPetDebug();
        lines.push('4 桌宠DOM: ' + (d.domMounted ? '在桌面上（位置 ' + d.pos.x + ',' + d.pos.y + '）' : '未创建（状态 adopted=' + d.adopted + ' enabled=' + d.enabled + '）'));
        lines.push('5 画布: ' + (d.hasCanvas ? '正常' : '缺失'));
        lines.push('6 行为模式: ' + (d.mode || '?') + ' · 羁绊档: ' + (d.bondTier === undefined ? '?' : d.bondTier) + ' · 被销毁次数: ' + (d.kills === undefined ? '?' : d.kills));
        if (d.lastError) lines.push('!! 最近异常: ' + d.lastError);
      } catch (e) {
        lines.push('4 诊断异常: ' + e.message);
      }
    }
    return lines.join('\n');
  }

  function renderHome() {
    clearRoot();
    if (!state || !state.adopted) { renderAdopt(); return; }
    var isVideoPet = state.design && state.design.type === 'video';
    var bond = state.bond || 0;
    var tier = tierOf(bond);
    var next = tier + 1 < TIER.length ? TIER[tier + 1] : null;
    var mood = petMood();

    // ---- hero：活的预览（视频形态播真待机动画）+ 名字 + 徽章 ----
    var hero = h('div', 'ci-pet-hero');
    var stage = h('div', 'ci-pet-hero-stage');
    if (isVideoPet) {
      var v = document.createElement('video');
      v.className = 'ci-pet-hero-video';
      v.muted = true;
      v.loop = true;
      v.autoplay = true;
      v.setAttribute('playsinline', 'playsinline');
      v.setAttribute('webkit-playsinline', 'webkit-playsinline');
      v.src = poolUrl(heroIdleName());
      loadHeroPool();
      stage.appendChild(v);
    } else {
      var pv = document.createElement('canvas');
      paint(pv, state.design, 7);
      stage.appendChild(pv);
    }
    stage.appendChild(h('div', 'ci-pet-hero-mood', mood.emoji + ' ' + mood.text));
    hero.appendChild(stage);

    var heroInfo = h('div', 'ci-pet-hero-info');
    heroInfo.appendChild(h('div', 'ci-pet-name', state.name || '小家伙'));
    var badges = h('div', 'ci-pet-badges');
    badges.appendChild(h('span', 'ci-pet-badge', TIER_NAMES[tier]));
    var lvBadge = h('span', 'ci-pet-badge ci-pet-badge--lv', 'Lv ·');
    badges.appendChild(lvBadge);
    heroInfo.appendChild(badges);
    heroInfo.appendChild(h('div', 'ci-pet-hint',
      '相伴 ' + daysTogether() + ' 天 · 今日互动 ' + todayInteracts() + ' 次'));
    hero.appendChild(heroInfo);
    root.appendChild(hero);

    if (api) {
      api.get('/level/info').then(function(res) {
        var d = (res.data && res.data.data) || {};
        lvBadge.textContent = 'Lv ' + (d.level || 0);
      }).catch(function() { lvBadge.textContent = 'Lv ?'; });
    }

    // ---- 状态条 ----
    var stats = h('div', 'ci-pet-stats');
    var fedNote = fedPct() >= 80 ? '吃得很饱' : fedPct() >= 30 ? '还不错' : '有点饿';
    stats.appendChild(statRow('饱食', fedPct(), '#FF9500', fedNote));
    var tierPct = next ? Math.round((bond - TIER[tier]) / (next - TIER[tier]) * 100) : 100;
    stats.appendChild(statRow('羁绊', tierPct, '#FF6482',
      next ? (TIER_NAMES[tier] + ' → ' + TIER_NAMES[tier + 1] + ' 还差 ' + (next - bond)) : '满级羁绊！'));
    root.appendChild(stats);

    // ---- 互动（摸摸/呼唤直接驱动桌面上的那只）----
    root.appendChild(sectionTitle('互动'));
    var acts = h('div', 'ci-pet-actions');
    var feedBtn = bigBtn('🍎', '喂食', '+4 羁绊', function() {
      feedBtn.disabled = true;
      api.post('/pet/interact', { type: 'feed' }).then(function(res) {
        var d = (res.data && res.data.data) || {};
        state = d.state || state;
        try { window.dispatchEvent(new CustomEvent('ci-pet-feed')); } catch (e) {}
        if (d.tierUp && context && context.system && context.system.toast) {
          context.system.toast({ message: '羁绊升级了！', type: 'success' });
        }
        if (d.capped && context && context.system && context.system.toast) {
          context.system.toast({ message: '今天喂饱啦，明天再来', type: 'info' });
        }
        renderHome();
      }).catch(function(err) {
        feedBtn.disabled = false;
        var msg = (err && err.response && err.response.data && err.response.data.message) || '投喂失败';
        if (context && context.system && context.system.toast) {
          context.system.toast({ message: msg, type: 'error' });
        }
      });
    });
    acts.appendChild(feedBtn);
    acts.appendChild(bigBtn('👋', '摸摸', '它会当场撒娇', function() {
      try { window.dispatchEvent(new CustomEvent('ci-pet-poke')); } catch (e) {}
    }));
    acts.appendChild(bigBtn('📣', '呼唤', '让它应你一声', function() {
      try { window.dispatchEvent(new CustomEvent('ci-pet-call')); } catch (e) {}
    }));
    root.appendChild(acts);

    // ---- 形象（双向卡片式切换）----
    root.appendChild(sectionTitle('形象'));
    var styles = h('div', 'ci-pet-styles');
    var cWhale = h('div', 'ci-pet-stylecard' + (isVideoPet ? ' is-active' : ''));
    cWhale.appendChild(h('div', 'ci-pet-stylecard-art ci-pet-tpl-emoji', '🐳'));
    cWhale.appendChild(h('div', 'ci-pet-stylecard-name', '大肥鱼'));
    cWhale.appendChild(h('div', 'ci-pet-stylecard-desc', '100+ 个动作，会跳舞'));
    if (isVideoPet) {
      cWhale.appendChild(h('span', 'ci-pet-stylecard-tag', '使用中'));
    } else {
      var useWhale = h('button', 'ci-pet-stylecard-btn', '使用');
      useWhale.addEventListener('click', function() {
        savePixelDraft();
        switchDesign({ type: 'video', character: 'dsh-whale' }, useWhale, '使用');
      });
      cWhale.appendChild(useWhale);
    }
    styles.appendChild(cWhale);

    var cPixel = h('div', 'ci-pet-stylecard' + (!isVideoPet ? ' is-active' : ''));
    var pixelShown = !isVideoPet && state.design ? state.design : null;
    if (!pixelShown) {
      var savedDraft = null;
      try { savedDraft = storage && storage.get('lastPixel', null); } catch (e) {}
      if (savedDraft && savedDraft.data) pixelShown = savedDraft;
    }
    if (pixelShown && pixelShown.data) {
      var pv2 = document.createElement('canvas');
      paint(pv2, pixelShown, 5);
      cPixel.appendChild(pv2);
    } else {
      cPixel.appendChild(h('div', 'ci-pet-stylecard-art ci-pet-tpl-emoji', '🎨'));
    }
    cPixel.appendChild(h('div', 'ci-pet-stylecard-name', '手作拼豆'));
    cPixel.appendChild(h('div', 'ci-pet-stylecard-desc', '自己画的小家伙'));
    if (!isVideoPet) {
      cPixel.appendChild(h('span', 'ci-pet-stylecard-tag', '使用中'));
      var reBtn = h('button', 'ci-pet-stylecard-btn', '再改改');
      reBtn.addEventListener('click', function() { startEditor(state.design && state.design.data); });
      cPixel.appendChild(reBtn);
    } else {
      var usePixel = h('button', 'ci-pet-stylecard-btn', pixelShown && pixelShown.data ? '换回来' : '去画一只');
      usePixel.addEventListener('click', function() {
        var sv = null;
        try { sv = storage && storage.get('lastPixel', null); } catch (e) {}
        startEditor(sv && sv.data ? sv.data : '');
      });
      cPixel.appendChild(usePixel);
    }
    styles.appendChild(cPixel);
    root.appendChild(styles);

    // ---- 设置：显示开关 + 改名字 ----
    root.appendChild(sectionTitle('设置'));
    var misc = h('div', 'ci-pet-misc');
    var toggleRow = h('div', 'ci-pet-toggle-row');
    toggleRow.appendChild(h('span', null, '在桌面显示'));
    var sw = h('button', 'ci-pet-switch' + (state.enabled !== false ? ' ci-pet-switch--on' : ''));
    sw.addEventListener('click', function() {
      var nx = state.enabled === false;
      sw.classList.toggle('ci-pet-switch--on', nx);
      api.put('/pet/state', { enabled: nx }).then(function(res) {
        state = (res.data && res.data.data && res.data.data.state) || state;
        notifyChanged();
        renderHome();
      });
    });
    toggleRow.appendChild(sw);
    misc.appendChild(toggleRow);
    var renameRow = h('div', 'ci-pet-btnrow');
    var rename = h('button', 'ci-pet-btn ci-pet-btn--ghost', '✏️ 改名字');
    rename.addEventListener('click', function() {
      // 保留当前形态（pixel 时把现稿塞进 edit，避免 preview 空白/串稿）
      if (!isVideoPet && state.design) {
        edit = { data: state.design.data, color: 2, tool: 'pen', mirror: false };
      }
      renderNaming(isVideoPet ? 'video' : 'pixel');
    });
    renameRow.appendChild(rename);
    misc.appendChild(renameRow);
    root.appendChild(misc);

    // ---- 诊断折叠到底部（平时不占版面）----
    var adv = h('details', 'ci-pet-adv');
    adv.appendChild(h('summary', null, '桌宠没出现？点开诊断'));
    var diagOut = h('pre', 'ci-pet-adv-out');
    adv.appendChild(diagOut);
    adv.addEventListener('toggle', function() {
      if (adv.open) diagOut.textContent = buildDiag();
    });
    root.appendChild(adv);
  }

  function notifyChanged() {
    try { window.dispatchEvent(new CustomEvent('ci-pet-state-changed')); } catch (e) {}
  }

  // 容器宽度变了（平板旋转 / 窗口缩放）→ 重算格子并重绘画布，保证画布永远在可视区内
  var resizeTimer = null;
  function onResize() {
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function() {
      resizeTimer = null;
      if (!root || !editCanvas) return;      // 只有编辑器在台上才需要重绘
      var next = computeCell();
      if (next !== CELL) { CELL = next; redrawEditor(); }
    }, 150);
  }

  // ================= 挂载契约 =================
  var context = null;
  function mount(container, ctx) {
    context = ctx;
    api = ctx && ctx.data && ctx.data.api;
    storage = ctx && ctx.data && ctx.data.storage;
    root = h('div', 'ci-pethome');
    container.appendChild(root);
    if (ctx && ctx.app && typeof ctx.app.onDestroy === 'function') {
      ctx.app.onDestroy(function() {
        window.removeEventListener('resize', onResize);
        root = null;
      });
    }
    window.addEventListener('resize', onResize);
    root.appendChild(h('p', 'ci-pethome-sub', '加载中…'));
    api.get('/pet/state').then(function(res) {
      var d = (res.data && res.data.data) || {};
      palette = d.palette || [];
      templates = d.templates || [];
      state = d.state;
      renderHome();
      if (state && state.adopted) notifyChanged();
    }).catch(function() {
      clearRoot();
      root.appendChild(h('h2', null, '桌宠'));
      root.appendChild(h('p', 'ci-pethome-sub', '加载失败，请下拉重试。'));
    });
  }
  function unmount(container) {
    window.removeEventListener('resize', onResize);
    if (resizeTimer) { clearTimeout(resizeTimer); resizeTimer = null; }
    if (root && root.parentNode) root.parentNode.removeChild(root);
    editCanvas = null;
    root = null;
  }

  var definition = { name: NAME, mount: mount, unmount: unmount };
  if (window.ClassIntraMarket && typeof window.ClassIntraMarket.define === 'function') {
    window.ClassIntraMarket.define(definition);
  }
})();
