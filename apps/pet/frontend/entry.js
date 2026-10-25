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
  // 编辑画布每格 px：按视口自适应（平板 ~34px 大格，窄屏不低于 22px）
  var CELL = Math.max(22, Math.min(34, Math.floor((Math.min(window.innerWidth || 360, 760) - 56) / DIM / 2) * 2));
  var palette = [];
  var templates = [];
  var state = null;      // 服务端状态
  var root = null;
  var api = null;

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
    whale.addEventListener('click', function() { renderNaming(null); });
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
    var doneBtn = btn('就它了 →', false, function() { renderNaming(); });
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

  // ================= 起名 =================
  function renderNaming() {
    clearRoot();
    root.appendChild(h('h2', null, '给它起个名字'));
    var isPixelNaming = !!(edit && edit.data);
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
    info.appendChild(input);
    var row = h('div', 'ci-pet-btnrow');
    var save = h('button', 'ci-pet-btn', isPixelNaming ? '领养它！' : '领养大肥鱼！');
    row.appendChild(save);
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
      api.put('/pet/state', payload).then(function(res) {
        state = (res.data && res.data.data && res.data.data.state) || state;
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

  // ================= 我的宠物 =================
  function renderHome() {
    clearRoot();
    if (!state || !state.adopted) { renderAdopt(); return; }
    root.appendChild(h('h2', null, '我的宠物'));
    var isVideoPet = state.design && state.design.type === 'video';
    var card = h('div', 'ci-pet-card');
    if (isVideoPet) {
      card.appendChild(h('div', 'ci-pet-tpl-emoji', '🐳'));
    } else {
      var preview = document.createElement('canvas');
      paint(preview, state.design, 6);
      card.appendChild(preview);
    }
    var info = h('div', 'ci-pet-card-info');
    info.appendChild(h('div', 'ci-pet-name', state.name || '小家伙'));

    // 羁绊：称号 + 进度到下一档
    var TIER = [0, 20, 60, 120, 200];
    var TIER_NAMES = ['初识', '熟悉', '亲密', '形影不离', '灵魂伙伴'];
    var bond = state.bond || 0;
    var tier = 0;
    for (var ti = 0; ti < TIER.length; ti++) { if (bond >= TIER[ti]) tier = ti; }
    var next = tier + 1 < TIER.length ? TIER[tier + 1] : null;
    var tierText = TIER_NAMES[tier] + (next ? '（距离「' + TIER_NAMES[tier + 1] + '」还差 ' + (next - bond) + '）' : '（满级羁绊！）');
    info.appendChild(h('div', 'ci-pet-hint', '羁绊 · ' + tierText));
    var bar = h('div', 'ci-pet-bondbar');
    var fill = document.createElement('span');
    var pct = next ? Math.round((bond - TIER[tier]) / (next - TIER[tier]) * 100) : 100;
    fill.style.width = Math.max(6, Math.min(100, pct)) + '%';
    bar.appendChild(fill);
    info.appendChild(bar);

    // 等级联动阶段（读 /api/level/info，随 exp_updated 刷新）
    var stageEl = h('div', 'ci-pet-hint', '成长阶段：读取中…');
    info.appendChild(stageEl);
    if (api) {
      api.get('/level/info').then(function(res) {
        var d = (res.data && res.data.data) || {};
        var lv = d.level || 0;
        var stage = lv >= 4 ? '成年' : lv >= 2 ? '成长期' : '幼年期';
        stageEl.textContent = 'Lv' + lv + ' · ' + stage + ' —— 你升级，它也会长大。';
      }).catch(function() { stageEl.textContent = ''; });
    }

    info.appendChild(h('div', 'ci-pet-hint',
      '它现在就住在你的桌面上。戳它会开心，可以拖到任何角落。'));
    // 桌面开关
    var toggleRow = h('div', 'ci-pet-toggle-row');
    toggleRow.appendChild(h('span', null, '在桌面显示'));
    var sw = h('button', 'ci-pet-switch' + (state.enabled !== false ? ' ci-pet-switch--on' : ''));
    sw.addEventListener('click', function() {
      var next = state.enabled === false;
      sw.classList.toggle('ci-pet-switch--on', next);
      api.put('/pet/state', { enabled: next }).then(function(res) {
        state = (res.data && res.data.data && res.data.data.state) || state;
        notifyChanged();
      });
    });
    toggleRow.appendChild(sw);
    info.appendChild(toggleRow);
    // 重新打扮
    var row = h('div', 'ci-pet-btnrow');
    var feedBtn = h('button', 'ci-pet-btn', '喂食（+4 羁绊）');
    feedBtn.addEventListener('click', function() {
      feedBtn.disabled = true;
      feedBtn.textContent = '投喂中…';
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
        feedBtn.textContent = '喂食（+4 羁绊）';
        var msg = (err && err.response && err.response.data && err.response.data.message) || '投喂失败';
        if (context && context.system && context.system.toast) {
          context.system.toast({ message: msg, type: 'error' });
        }
      });
    });
    row.appendChild(feedBtn);
    var reBtn = h('button', 'ci-pet-btn ci-pet-btn--ghost', state.design.type === 'video' ? '换成手作拼豆' : '重新打扮');
    reBtn.addEventListener('click', function() { startEditor(state.design.data); });
    row.appendChild(reBtn);
    var rename = h('button', 'ci-pet-btn ci-pet-btn--ghost', '改名字');
    rename.addEventListener('click', function() { renderNaming(); });
    row.appendChild(rename);
    info.appendChild(row);
    card.appendChild(info);
    root.appendChild(card);

    // 桌宠没出现？一键诊断：五环链路逐环显示（服务端状态/悬浮脚本注册/宿主挂载/DOM/位置）
    var diagRow = h('div', 'ci-pet-btnrow');
    var diagBtn = h('button', 'ci-pet-btn ci-pet-btn--ghost', '桌宠没出现？诊断一下');
    diagRow.appendChild(diagBtn);
    root.appendChild(diagRow);
    var diagOut = h('pre', 'ci-pet-hint');
    diagOut.style.cssText = 'white-space:pre-wrap;background:rgba(128,128,128,0.12);border-radius:12px;padding:12px;margin-top:10px;display:none;';
    root.appendChild(diagOut);
    diagBtn.addEventListener('click', function() {
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
      diagOut.style.display = 'block';
      diagOut.textContent = lines.join('\n');
    });
  }

  function notifyChanged() {
    try { window.dispatchEvent(new CustomEvent('ci-pet-state-changed')); } catch (e) {}
  }

  // ================= 挂载契约 =================
  var context = null;
  function mount(container, ctx) {
    context = ctx;
    api = ctx && ctx.data && ctx.data.api;
    root = h('div', 'ci-pethome');
    container.appendChild(root);
    if (ctx && ctx.app && typeof ctx.app.onDestroy === 'function') {
      ctx.app.onDestroy(function() { root = null; });
    }
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
    if (root && root.parentNode) root.parentNode.removeChild(root);
    root = null;
  }

  var definition = { name: NAME, mount: mount, unmount: unmount };
  if (window.ClassIntraMarket && typeof window.ClassIntraMarket.define === 'function') {
    window.ClassIntraMarket.define(definition);
  }
})();
