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
  var uiTab = 'home';    // 当前页：home / battle / dex / rank（v0.8.0 分区）
  var elements = [];     // 属性表（服务端 /pet/state 下发，失败时用兜底）
  var wildCatalog = [];  // 野生精灵图鉴（服务端下发）
  var buddyInfo = null;  // 当前随行伙伴
  var evolutionInfo = null; // 当前进化阶段

  // /pet/state 没返回属性表时的兜底：只保证页面能画出来，数值以服务端为准。
  var ELEMENT_FALLBACK = {
    fire:     { id: 'fire',     name: '火', icon: '🔥', color: '#FF6B4A', beats: 'grass',    beatsName: '草', weakTo: 'water',    weakToName: '水' },
    grass:    { id: 'grass',    name: '草', icon: '🌿', color: '#34C759', beats: 'earth',    beatsName: '土', weakTo: 'fire',     weakToName: '火' },
    earth:    { id: 'earth',    name: '土', icon: '⛰️', color: '#B07A4A', beats: 'electric', beatsName: '电', weakTo: 'grass',    weakToName: '草' },
    electric: { id: 'electric', name: '电', icon: '⚡', color: '#E6A700', beats: 'water',    beatsName: '水', weakTo: 'earth',    weakToName: '土' },
    water:    { id: 'water',    name: '水', icon: '💧', color: '#0A84FF', beats: 'fire',     beatsName: '火', weakTo: 'electric', weakToName: '电' }
  };
  var ELEMENT_ORDER = ['fire', 'grass', 'earth', 'electric', 'water'];
  function elementOf(id) {
    for (var i = 0; i < elements.length; i++) if (elements[i].id === id) return elements[i];
    return ELEMENT_FALLBACK[id] || ELEMENT_FALLBACK.grass;
  }
  function elementChip(id, text) {
    var e = elementOf(id);
    return h('span', 'ci-pet-el ci-pet-el--' + e.id, e.icon + ' ' + (text || e.name));
  }
  // 本地算属性倍率（不依赖服务端返回，勋章/难度标签都能立刻跟着换）
  function localTypeMul(a, b) {
    var ea = elementOf(a), eb = elementOf(b);
    if (ea.beats === eb.id) return 1.18;
    if (eb.beats === ea.id) return 0.86;
    return 1;
  }
  // /pet/state 下发的附属数据统一收口：属性表、图鉴总量、随行、进化。
  // 写成一个函数是因为以后加字段只改这里，不用在 mount 里一行行补。
  function applyStateMeta(d) {
    if (!d) return;
    if (d.elements && d.elements.length) elements = d.elements;
    if (d.wild && d.wild.length) wildCatalog = d.wild;
    buddyInfo = d.buddy || null;
    evolutionInfo = d.evolution || null;
  }

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

  // 统一 toast 出口：宿主没给 system.toast 时静默降级，不抛异常
  function sysToast(message, type) {
    try {
      if (context && context.system && context.system.toast) {
        context.system.toast({ message: message, type: type || 'info' });
      }
    } catch (e) {}
  }

  // 交互结果回报：悬浮层发完请求后派发 'ci-pet-fed'（带 type/gained/capped/tierUp/state）。
  // 收到就置位，避免本页的「无回报兜底」重复发第二次请求。
  // ⚠️ 2026-10-27 修：原来不分 type，摸摸撞到每日上限时也弹「今天已经吃饱啦」——
  //    用户摸一下看到的却是喂饭的话术，直接懵。现在按 type 说各自的话。
  var pendingReply = { feed: false, poke: false };
  var POKE_DAILY_CAP = 10;   // 与 backend/routes.js INTERACT_RULES.poke.dailyCap 对齐
  var FEED_GAIN = 4;         // 与 INTERACT_RULES.feed.gain 对齐
  var BOND_DAILY_MAX = 25;   // poke10 + feed3×4 + visit3 = +25/天

  function pokedCount() { return (state && state.poked_today) || 0; }
  function canPoke() { return pokedCount() < POKE_DAILY_CAP; }

  function interactVerb(type) {
    if (type === 'feed') return '喂食';
    if (type === 'poke') return '摸摸';
    if (type === 'visit') return '回到桌上';
    if (type === 'gift') return '送礼物';
    return '互动';
  }
  function capMessage(type) {
    if (type === 'feed') return '今天已经吃饱啦，明天再来～';
    if (type === 'poke') return '今天摸够 ' + POKE_DAILY_CAP + ' 次啦，明天再来～';
    if (type === 'visit') return '今天已经回来过啦～';
    return '今天的互动次数用完啦，明天再来～';
  }

  try {
    window.addEventListener('ci-pet-fed', function(e) {
      var d = (e && e.detail) || {};
      if (d.type) pendingReply[d.type] = true;
      else { pendingReply.feed = true; pendingReply.poke = true; }
      if (d.state) state = d.state;
      if (d.gained > 0) {
        var bondNow = (state && state.bond) || 0;
        sysToast(interactVerb(d.type) + '成功，羁绊 +' + d.gained + '（现在 ' + bondNow + '）', 'success');
      } else if (d.capped) {
        sysToast(capMessage(d.type), 'info');
      } else if (d.message) {
        sysToast(d.message, 'info');
      }
      renderHome();
    });
  } catch (e) {}

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

  // ⚠️ 2026-10-26 重写：旧版是「距上次喂食 4 小时线性衰减」，而后端判定是
  //    「每日 3 次上限 + 20 分钟冷却」（backend/routes.js INTERACT_RULES）。
  //    两套模型必然脱节 —— 早上喂满 3 次后，UI 到下午显示"有点饿"，
  //    但后端按次数拒绝，数值纹丝不动（实测连喂 4 次全部 gained=0）。
  //    现在以「今日已喂次数」为准画条，UI 说饿 = 真的还能喂。
  var FEED_DAILY_CAP = 3;

  function fedCount() { return (state && state.fed_today) || 0; }
  function canFeed() { return fedCount() < FEED_DAILY_CAP; }

  // 饱食度条：今日已吃份数占比（0/3 = 空着肚子 → 喂满 3/3 = 100% 吃饱）。
  // ⚠️ 2026-10-27 修：原实现算的是「剩余可喂份数」，于是喂一次 100%→67%、喂满 0%，
  //    越吃越"饿"，与用户直觉完全相反（用户实报"饱食度越喂越少"）。
  //    饱食度必须随进食单调递增；"还能吃几顿"是另一件事，放在脚注里说（见 fedNote）。
  function fedPct() {
    return Math.round(Math.min(fedCount(), FEED_DAILY_CAP) / FEED_DAILY_CAP * 100);
  }

  // 冷却剩余分钟数（用于按钮副标题的真实原因提示）
  function feedCooldownMin() {
    var t = state && state.last_fed_at ? new Date(state.last_fed_at).getTime() : 0;
    if (!t) return 0;
    var left = 20 * 60 * 1000 - (Date.now() - t);
    return left > 0 ? Math.ceil(left / 60000) : 0;
  }
  function todayInteracts() {
    return state ? (state.poked_today || 0) + (state.fed_today || 0) : 0;
  }
  function daysTogether() {
    if (!state || !state.adopted_at) return 1;
    var n = Math.floor((Date.now() - new Date(state.adopted_at).getTime()) / 86400000) + 1;
    return Math.max(1, n);
  }
  // 喂食按钮副标题：把「为什么点不动」写在按钮上，而不是等用户点了才发现
  function feedBtnSub() {
    if (canFeed()) {
      var cd = feedCooldownMin();
      return cd > 0 ? ('歇 ' + cd + ' 分钟') : '+4 羁绊';
    }
    return '今天吃饱啦';
  }
  // 摸摸按钮副标题：把「今日已摸 n/10」写在按钮上，撞上限之前就看得到
  function pokeBtnSub() {
    if (!canPoke()) return '今天摸够啦';
    return '+1 羁绊 · 今日 ' + pokedCount() + '/' + POKE_DAILY_CAP;
  }

  function petMood() {
    if (!state) return { emoji: '🐚', text: '…' };
    if (state.enabled === false) return { emoji: '💤', text: '正在桌面上休息' };
    var n = todayInteracts();
    if (n === 0) return { emoji: '😢', text: '今天还没被摸过，有点想你' };
    if (fedCount() === 0) return { emoji: '🍚', text: '今天还没吃饭呢…' };
    if (!canFeed()) return { emoji: '😋', text: '今天吃饱啦，明天再来' };
    if (feedCooldownMin() > 0) return { emoji: '😌', text: '刚吃过，' + feedCooldownMin() + ' 分钟后还能再喂' };
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
  // 状态条：label 居左 / 数值居右，脚注单独一行（旧版把三样挤在一行，信息糊成一团）
  // valueText：右侧显示的文本。不传才落到「档位百分比」。
  // ⚠️ 2026-10-27 修：羁绊条原来右侧固定显示 "37%"（档位进度），而脚注写「还差 38」。
  //    用户把「还差 38」当成了羁绊值，摸一次（羁绊 +1）脚注 38 → 37，观感就是
  //    「摸一下羁绊掉了 1」（实报 38 摸到 37）。现在羁绊条右侧直接显示绝对值，
  //    进度百分比只负责条的宽度，脚注改成 "82 / 120" 这种只增不减的写法。
  function statRow(label, pct, color, note, valueText) {
    var row = h('div', 'ci-pet-statrow');
    var head = h('div', 'ci-pet-stathead');
    head.appendChild(h('span', 'ci-pet-statlabel', label));
    // 文本用真实值；只有条的宽度给 4% 下限，避免 0% 时整条消失看不出形状
    var real = Math.min(100, Math.round(pct));
    var shown = (valueText === undefined || valueText === null) ? (real + '%') : String(valueText);
    head.appendChild(h('span', 'ci-pet-statvalue', shown));
    row.appendChild(head);
    var bar = h('div', 'ci-pet-statbar');
    var fill = document.createElement('span');
    fill.style.setProperty('--ci-pet-fill', color);
    // 延迟一帧再设宽度：从 0 长出来，进去第一眼就能看出"它在涨"
    fill.style.width = '0%';
    setTimeout(function() { fill.style.width = Math.max(4, real) + '%'; }, 60);
    bar.appendChild(fill);
    row.appendChild(bar);
    if (note) row.appendChild(h('div', 'ci-pet-statfoot', note));
    return row;
  }
  // variant: 'primary' = 当日主行动（喂食），视觉上给出明确的主次差异
  function bigBtn(emoji, label, sub, fn, variant) {
    var b = h('button', 'ci-pet-bigbtn' + (variant ? ' ci-pet-bigbtn--' + variant : ''));
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

  // ---- 等级：HUD 与 hero 都要显示，合并成一次请求 ----
  // 之前只有 hero 里那块 Lv 徽章会去拉 /level/info。加了顶部 HUD 之后如果各自拉一次，
  // 每进一次页面就是两个请求；这里做一次广播，谁先挂上谁登记，值回填给所有人。
  var levelValue = null;
  var levelQueue = [];
  function bindLevel(el) {
    if (!el) return;
    if (levelValue !== null) { el.textContent = levelValue; return; }
    levelQueue.push(el);
    if (levelQueue.length > 1 || !api) return;
    api.get('/level/info').then(function(res) {
      var d = (res.data && res.data.data) || {};
      levelValue = 'Lv ' + (d.level || 0);
      flushLevel();
    }, function() { levelValue = 'Lv ?'; flushLevel(); });
  }
  function flushLevel() {
    for (var i = 0; i < levelQueue.length; i++) levelQueue[i].textContent = levelValue;
    levelQueue = [];
  }

  // ---- 顶部 HUD（v0.9.0 游戏化）----
  // 像游戏状态栏一样常驻：头像（进化形态）+ 名字 + 等级 / 羁绊，右侧战力与属性。
  // 每一页都画，因为「我现在多强、什么属性」是对战/图鉴/排行都要看的前提。
  function gameHud() {
    var tier = tierOf((state && state.bond) || 0);
    var evo = (battle && battle.evolution) || evolutionInfo;
    var hud = h('div', 'ci-pet-hud');

    var avatar = h('div', 'ci-pet-hud-avatar');
    avatar.appendChild(h('span', 'ci-pet-hud-evo', (evo && evo.icon) || '🌱'));
    hud.appendChild(avatar);

    var who = h('div', 'ci-pet-hud-who');
    var nameRow = h('div', 'ci-pet-hud-name-row');
    nameRow.appendChild(h('span', 'ci-pet-hud-name', (state && state.name) || '小家伙'));
    var lv = h('span', 'ci-pet-hud-lv', 'Lv ·');
    nameRow.appendChild(lv);
    bindLevel(lv);
    who.appendChild(nameRow);
    who.appendChild(h('div', 'ci-pet-hud-sub', TIER_NAMES[tier] + ' · 羁绊 ' + ((state && state.bond) || 0)));
    hud.appendChild(who);

    var chips = h('div', 'ci-pet-hud-chips');
    var pow = h('span', 'ci-pet-hud-power', '⚔ —');
    pow.setAttribute('data-hud', 'power');
    chips.appendChild(pow);
    var ty = h('span', 'ci-pet-hud-type', '🌿 草');
    ty.setAttribute('data-hud', 'type');
    chips.appendChild(ty);
    hud.appendChild(chips);

    fillHud();
    return hud;
  }

  // 档案是异步来的：HUD 上的战力 / 属性 / 进化图标到手后原地补，
  // 不整页重绘（重绘会把正在播的宠物视频重新起一遍）。
  function fillHud() {
    if (!root) return;
    var pow = root.querySelector('.ci-pet-hud [data-hud="power"]');
    if (pow) {
      var c = battle && battle.combat;
      pow.textContent = c ? ('⚔ ' + (c.power || 0)) : '⚔ —';
    }
    var ty = root.querySelector('.ci-pet-hud [data-hud="type"]');
    if (ty) {
      var info = (battle && battle.typeInfo) || elementOf((battle && battle.battleType) || 'grass');
      ty.className = 'ci-pet-hud-type ci-pet-el--' + info.id;
      ty.textContent = (info.icon || '') + ' ' + info.name;
    }
    var sub = root.querySelector('.ci-pet-hud-sub');
    if (sub) {
      var b = (state && state.bond) || 0;
      sub.textContent = TIER_NAMES[tierOf(b)] + ' · 羁绊 ' + b;
    }
    var evoEl = root.querySelector('.ci-pet-hud-evo');
    var e = (battle && battle.evolution) || evolutionInfo;
    if (evoEl && e) evoEl.textContent = e.icon || '🌱';
  }

  // ================= 页面分区（v0.8.0）====================
  // 之前「对战」被埋在宠物屋最底部：想打一场要先滚过形象、设置，
  // 而「图鉴/排行」根本没有位置。分区之后每个页只回答一个问题：
  //   小家 = 它今天怎么样；对战 = 今天打谁；图鉴 = 我收集了什么；排行 = 我在班里第几。
  function tabBar() {
    var tabs = [
      { id: 'home',   icon: '🏠', name: '小家' },
      { id: 'battle', icon: '⚔️', name: '对战' },
      { id: 'dex',    icon: '📖', name: '图鉴' },
      { id: 'rank',   icon: '🏆', name: '排行' }
    ];
    var bar = h('div', 'ci-pet-tabs');
    for (var i = 0; i < tabs.length; i++) {
      (function(t) {
        var on = uiTab === t.id;
        var b = h('button', 'ci-pet-tab' + (on ? ' is-on' : ''));
        b.setAttribute('data-tab', t.id);
        b.appendChild(h('span', 'ci-pet-tab-icon', t.icon));
        b.appendChild(h('span', 'ci-pet-tab-name', t.name));
        var badge = tabBadgeCount(t.id);
        if (badge > 0) b.appendChild(h('span', 'ci-pet-tab-badge', badge > 9 ? '9+' : String(badge)));
        b.addEventListener('click', function() { switchTab(t.id); });
        bar.appendChild(b);
      })(tabs[i]);
    }
    return bar;
  }
  function tabBadgeCount(id) {
    if (!battle) return 0;
    if (id === 'battle') return (battle.inbox || []).length;
    if (id === 'dex') {
      var d = battle.dex || {};
      return Math.max(0, (d.total || 0) - (d.ownedCount || 0));
    }
    return 0;
  }
  function refreshTabBadges() {
    var tabs = root ? root.querySelectorAll('.ci-pet-tab') : [];
    for (var i = 0; i < tabs.length; i++) {
      var id = tabs[i].getAttribute('data-tab');
      var old = tabs[i].querySelector('.ci-pet-tab-badge');
      if (old) tabs[i].removeChild(old);
      var n = tabBadgeCount(id);
      if (n > 0) tabs[i].appendChild(h('span', 'ci-pet-tab-badge', n > 9 ? '9+' : String(n)));
    }
  }
  function switchTab(id) {
    if (uiTab === id) return;
    // 离开对战页时把回放定时器停掉：否则动画会在看不见的 DOM 上继续跑
    if (uiTab === 'battle') stopFight();
    uiTab = id;
    renderHome();
    if (id !== 'home' && !battle) {
      loadBattle(function() { if (uiTab === id) renderHome(); });
    }
  }
  function pageHead(title, sub) {
    var box = h('div', 'ci-pet-pagehead');
    box.appendChild(h('div', 'ci-pet-pagehead-title', title));
    if (sub) box.appendChild(h('div', 'ci-pet-pagehead-sub', sub));
    return box;
  }
  function renderBattleTab() {
    root.appendChild(pageHead('对战', '配好战术与技能，再去挑对手。练习赛、影子、试炼塔都不碰羁绊。'));
    root.appendChild(battleSection());
  }
  function renderDexTab() {
    if (!battle) {
      var box = h('div', 'ci-pet-battle ci-pet-battle-loading', '图鉴读取中…');
      root.appendChild(box);
      loadBattle(function() { if (uiTab === 'dex') renderHome(); });
      return;
    }
    root.appendChild(pageHead('图鉴', '收服野生精灵、选一只随行、看着自己的小家伙进化。'));
    root.appendChild(dexSection());
  }
  function renderRankTab() {
    if (!battle) {
      var box = h('div', 'ci-pet-battle ci-pet-battle-loading', '排行榜读取中…');
      root.appendChild(box);
      loadBattle(function() { if (uiTab === 'rank') renderHome(); });
      return;
    }
    root.appendChild(pageHead('排行', '只比战力积分。羁绊是你们俩的私事，不上榜。'));
    root.appendChild(rankSection());
  }
  function renderHome() {
    clearRoot();
    if (!state || !state.adopted) { renderAdopt(); return; }
    // v0.9.0：HUD 常驻顶部，导航沉到底部（像手游的 dock），中间才是页面内容。
    root.appendChild(gameHud());
    if (uiTab === 'battle') renderBattleTab();
    else if (uiTab === 'dex') renderDexTab();
    else if (uiTab === 'rank') renderRankTab();
    else renderHomeBody();
    // 导航必须最后挂：它用 position: sticky; bottom: 0 贴底，
    // 放在内容前面的话 sticky 会在滚到顶部时被「顶」回文档流里。
    root.appendChild(tabBar());
  }

  // 首页的「冒险入口」：把对战/图鉴/排行从长页面里提出来，各给一张可点的卡。
  // 用户原话是「把对战和其他页面区分开」，所以首页只留入口，不再塞完整对战。
  function adventureLinks() {
    var row = h('div', 'ci-pet-advlinks');
    var items = [
      { id: 'battle', icon: '⚔️', name: '对战', sub: battle ? ('今日 ' + (battle.today || 0) + ' 场 · 全班第 ' + (battle.myRank || '-') + ' 名') : '练习赛 / 同学 / 试炼塔' },
      { id: 'dex', icon: '📖', name: '图鉴', sub: battle && battle.dex ? ('已收服 ' + battle.dex.ownedCount + ' / ' + battle.dex.total + ' 只') : '收服野生精灵' },
      { id: 'rank', icon: '🏆', name: '排行', sub: '积分榜与成就' }
    ];
    for (var i = 0; i < items.length; i++) {
      (function(it) {
        var card = h('button', 'ci-pet-advlink');
        card.setAttribute('data-link', it.id);
        card.appendChild(h('span', 'ci-pet-advlink-icon', it.icon));
        var txt = h('span', 'ci-pet-advlink-text');
        txt.appendChild(h('span', 'ci-pet-advlink-name', it.name));
        txt.appendChild(h('span', 'ci-pet-advlink-sub', it.sub));
        card.appendChild(txt);
        card.appendChild(h('span', 'ci-pet-advlink-arrow', '›'));
        card.addEventListener('click', function() { switchTab(it.id); });
        row.appendChild(card);
      })(items[i]);
    }
    return row;
  }

  // 档案是异步来的：首页入口的副标题要在数据回来后原地补一次，
  // 不能整页重渲染（会把正在播的宠物视频重新起一遍）。
  function refreshHomeLinks() {
    if (!root || !battle) return;
    var links = root.querySelectorAll('.ci-pet-advlink');
    for (var i = 0; i < links.length; i++) {
      var id = links[i].getAttribute('data-link');
      var sub = links[i].querySelector('.ci-pet-advlink-sub');
      if (!sub) continue;
      if (id === 'battle') {
        sub.textContent = '今日 ' + (battle.today || 0) + ' 场 · 全班第 ' + (battle.myRank || '-') + ' 名';
      } else if (id === 'dex' && battle.dex) {
        sub.textContent = '已收服 ' + battle.dex.ownedCount + ' / ' + battle.dex.total + ' 只';
      }
    }
  }

  function renderHomeBody() {
    var isVideoPet = state.design && state.design.type === 'video';
    var bond = state.bond || 0;
    var tier = tierOf(bond);
    var next = tier + 1 < TIER.length ? TIER[tier + 1] : null;
    var mood = petMood();

    // ---- hero：活的预览（视频形态播真待机动画）+ 名字 + 徽章 ----
    // v0.9.0 起 hero 是一个「小场景」：天空 / 远山 / 地面 / 脚下投影，
    // 宠物站在地上而不是浮在白卡片里。场景层全是装饰节点，不接事件。
    var hero = h('div', 'ci-pet-hero');
    var stage = h('div', 'ci-pet-hero-stage');
    stage.appendChild(h('div', 'ci-pet-scene-sky'));
    stage.appendChild(h('div', 'ci-pet-scene-hills'));
    stage.appendChild(h('div', 'ci-pet-scene-ground'));
    stage.appendChild(h('span', 'ci-pet-scene-shadow'));
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
    hero.appendChild(stage);

    var heroInfo = h('div', 'ci-pet-hero-info');
    // 心情语从 stage 里挪出来：它原来绝对定位贴底，正好压在宠物下半身上。
    // 现在作为信息区第一行，宠物完整露出，长文案也有横向空间（stage 只有 132px）。
    heroInfo.appendChild(h('div', 'ci-pet-hero-mood', mood.emoji + ' ' + mood.text));
    heroInfo.appendChild(h('div', 'ci-pet-name', state.name || '小家伙'));
    var badges = h('div', 'ci-pet-badges');
    badges.appendChild(h('span', 'ci-pet-badge', TIER_NAMES[tier]));
    if (evolutionInfo) {
      badges.appendChild(h('span', 'ci-pet-badge ci-pet-badge--evo',
        (evolutionInfo.icon || '') + ' ' + evolutionInfo.name));
    }
    var lvBadge = h('span', 'ci-pet-badge ci-pet-badge--lv', 'Lv ·');
    badges.appendChild(lvBadge);
    heroInfo.appendChild(badges);
    heroInfo.appendChild(h('div', 'ci-pet-hint',
      '相伴 ' + daysTogether() + ' 天 · 今日互动 ' + todayInteracts() + ' 次 · 今日羁绊 +' +
      (state.bond_today || 0) + '/' + BOND_DAILY_MAX));
    hero.appendChild(heroInfo);
    root.appendChild(hero);

    // 等级由 bindLevel 统一取一次（HUD 上还有一块，共用同一个值）
    bindLevel(lvBadge);

    // ---- 状态条 ----
    var stats = h('div', 'ci-pet-stats');
    // 饱食条文案与后端判定对齐：说"还能喂"时就真的能喂（旧版时间衰减与次数上限脱节）
    var left = Math.max(0, FEED_DAILY_CAP - fedCount());
    // 这里内联算冷却，不再调用 feedCooldownMin()：饱食条是全页唯一必过路径，
    // 一旦它抛异常整个 home 就渲染不出来（曾因此把整个页面搞空白）。
    var _cd = 0;
    if (state && state.last_fed_at) {
      var _cdLeft = 20 * 60 * 1000 - (Date.now() - new Date(state.last_fed_at).getTime());
      _cd = _cdLeft > 0 ? Math.ceil(_cdLeft / 60000) : 0;
    }
    var fedNote = left > 0 ? ('还能吃 ' + left + ' 顿') : (_cd > 0 ? '刚吃过，等一会儿' : '今天吃饱啦');
    stats.appendChild(statRow('饱食', fedPct(), '#FF9500', fedNote));
    var tierPct = next ? Math.round((bond - TIER[tier]) / (next - TIER[tier]) * 100) : 100;
    // 脚注只写「单调递增」的量：当前值 / 下一档阈值，再点明每档还差多少。
    // 别再只写「还差 N」—— 那个数字会随羁绊上升而变小，最容易被读成掉分。
    var bondNote = next
      ? (TIER_NAMES[tier] + ' · ' + bond + ' / ' + next + '，再 +' + (next - bond) + ' 升「' + TIER_NAMES[tier + 1] + '」')
      : ('灵魂伙伴 · ' + bond + '（已满级）');
    stats.appendChild(statRow('羁绊', tierPct, '#FF6482', bondNote, bond));
    root.appendChild(stats);

    // ---- 互动（摸摸/呼唤直接驱动桌面上的那只）----
    root.appendChild(sectionTitle('互动'));
    var acts = h('div', 'ci-pet-actions');
    // ⚠️ 喂食只派发事件，不在这里自己 post —— 由悬浮层的 feed() 统一发请求，
    //    并派发 'ci-pet-fed' 回报结果，本页收到后刷新 UI。
    //    2026-10-26 实测：这里 post 一次 + overlay 收到事件再 post 一次 = 一次点击两请求，
    //    第二发必然撞 20 分钟冷却返回 429 被静默吞掉，表现为"点了但数值不涨"。
    var feedBtn = bigBtn('🍎', '喂食', feedBtnSub(), function() {
      if (!canFeed()) {                       // UI 显式拒绝，并说明原因，别静默无反应
        sysToast(feedBtnSub(), 'info');
        return;
      }
      feedBtn.disabled = true;
      pendingReply.feed = false;
      try { window.dispatchEvent(new CustomEvent('ci-pet-feed')); } catch (e) {}
      // 桌宠未挂载（比如被关掉）时不会有回报 → 兜底自己请求一次，保证反馈不丢
      // ⚠️ 2026-10-27 实测：这里原写 later()（那是 overlay.js 的 helper，本文件没有），
      //    ReferenceError 会让整个 handler 在 disabled=true 之后中断 —— 请求永远发不出去、
      //    按钮永久禁用，正是用户报的「明明是饿的，喂饭数值却不涨」。本文件统一用 setTimeout。
      setTimeout(function() {
        if (pendingReply.feed) return;
        api.post('/pet/interact', { type: 'feed' }).then(function(res) {
          var d = (res.data && res.data.data) || {};
          state = d.state || state;
          if (d.tierUp) sysToast('羁绊升级了！', 'success');
          else if (d.capped) sysToast(capMessage('feed'), 'info');
          renderHome();
        }, function(err) {
          var msg = (err && err.response && err.response.data && err.response.data.message) || '投喂失败';
          sysToast(msg, 'error');
        }).then(function() { feedBtn.disabled = false; });
      }, 500);
    }, 'primary');
    acts.appendChild(feedBtn);
    // 摸摸：同样可能「桌宠没挂载」，所以和喂食一样带 500ms 无回报兜底。
    // 副标题直接把「今日还能摸几次」写在按钮上，撞上限前就能看出来。
    var pokeBtn = bigBtn('👋', '摸摸', pokeBtnSub(), function() {
      if (!canPoke()) {
        sysToast(capMessage('poke'), 'info');
        return;
      }
      pokeBtn.disabled = true;
      pendingReply.poke = false;
      try { window.dispatchEvent(new CustomEvent('ci-pet-poke')); } catch (e) {}
      setTimeout(function() {
        if (pendingReply.poke) return;
        api.post('/pet/interact', { type: 'poke' }).then(function(res) {
          var d = (res.data && res.data.data) || {};
          state = d.state || state;
          if (d.gained > 0) sysToast('摸摸成功，羁绊 +' + d.gained + '（现在 ' + (state.bond || 0) + '）', 'success');
          else if (d.capped) sysToast(capMessage('poke'), 'info');
          renderHome();
        }, function(err) {
          var msg = (err && err.response && err.response.data && err.response.data.message) || '摸摸失败';
          sysToast(msg, 'error');
        }).then(function() { pokeBtn.disabled = false; });
      }, 500);
    });
    acts.appendChild(pokeBtn);
    acts.appendChild(bigBtn('📣', '呼唤', '让它应你一声', function() {
      try { window.dispatchEvent(new CustomEvent('ci-pet-call')); } catch (e) {}
    }));
    root.appendChild(acts);

    // ---- 冒险入口（对战 / 图鉴 / 排行 各自独立成页）----
    // 之前完整对战塞在这里，首页要滚三屏才能看到设置；
    // 现在首页只回答「它在干什么」，想打就点进去。
    root.appendChild(sectionTitle('冒险'));
    root.appendChild(adventureLinks());
    root.appendChild(buddyHomeCard());

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

  // ================= 图鉴 / 进化 / 随行（v0.8.0）====================
  // 图鉴页把「养」和「收集」放在一起：进化决定能装几个技能，
  // 随行决定常驻多一条小加成，收服决定你有哪些可以选。
  function dexSection() {
    var dex = battle.dex || { total: 0, ownedCount: 0, list: [], byType: {}, buddy: null };
    var box = h('div', 'ci-pet-dex');
    box.appendChild(evoCard());
    box.appendChild(typePicker(null));
    box.appendChild(buddyCard());
    if (dex.spotlight) box.appendChild(spotlightCard(dex));
    box.appendChild(dexProgress(dex));
    box.appendChild(wildGroups(dex, box));
    return box;
  }

  // 进化：不改形象，改能装几个技能。所以卡片直接把「槽位」写成大字。
  function evoCard() {
    var e = battle.evolution || evolutionInfo;
    if (!e) return h('div', '');
    var box = h('div', 'ci-pet-evo');
    var head = h('div', 'ci-pet-evo-head');
    head.appendChild(h('span', 'ci-pet-evo-icon', e.icon || ''));
    var txt = h('div', 'ci-pet-evo-text');
    txt.appendChild(h('div', 'ci-pet-evo-name', e.name + ' · 技能槽 ' + e.slots));
    txt.appendChild(h('div', 'ci-pet-evo-sub',
      e.nextAt
        ? ('羁绊 ' + e.bond + ' / ' + e.nextAt + '，再 +' + (e.nextAt - e.bond) + ' 进化成「' + e.nextName + '」')
        : ('羁绊 ' + e.bond + '，已经是最终形态')));
    head.appendChild(txt);
    box.appendChild(head);
    var bar = h('div', 'ci-pet-evo-bar');
    var fill = h('span', 'ci-pet-evo-fill');
    fill.style.width = Math.max(0, Math.min(100, e.pct || 0)) + '%';
    bar.appendChild(fill);
    box.appendChild(bar);
    if (e.desc) box.appendChild(h('div', 'ci-pet-evo-desc', e.desc));
    return box;
  }

  // 本命属性：免费随时改。它是「读对手后的选择」，收费就会变成一次性的错误。
  function typePicker(after) {
    var list = (battle.elements && battle.elements.length) ? battle.elements : elements;
    if (!list.length) {
      // 老服务端 / 桩环境没下发属性表：用本地兜底，页面照样能画、能点
      list = [];
      for (var f = 0; f < ELEMENT_ORDER.length; f++) list.push(ELEMENT_FALLBACK[ELEMENT_ORDER[f]]);
    }
    var cur = battle.battleType || 'grass';
    var curInfo = battle.typeInfo || elementOf(cur);
    var box = h('div', 'ci-pet-types');

    var headRow = h('div', 'ci-pet-types-head');
    headRow.appendChild(h('span', 'ci-pet-types-title', '本命属性'));
    headRow.appendChild(h('span', 'ci-pet-types-hint', '克制 +18% · 被克 -14% · 随时可改'));
    box.appendChild(headRow);

    var row = h('div', 'ci-pet-types-row');
    for (var i = 0; i < list.length; i++) {
      (function(t) {
        var on = t.id === cur;
        var chip = h('button', 'ci-pet-type ci-pet-el--' + t.id + (on ? ' is-on' : ''));
        chip.setAttribute('data-type', t.id);
        chip.appendChild(h('span', 'ci-pet-type-icon', t.icon || ''));
        chip.appendChild(h('span', 'ci-pet-type-name', t.name));
        chip.addEventListener('click', function() {
          if (battle.battleType === t.id) return;
          doBattleType(t.id, after);
        });
        row.appendChild(chip);
      })(list[i]);
    }
    box.appendChild(row);

    var beatsEl = elementOf(curInfo.beats);
    var weakEl = elementOf(curInfo.weakTo);
    var note = h('div', 'ci-pet-types-note');
    note.appendChild(elementChip(cur));
    note.appendChild(h('span', null,
      ' 克制 ' + beatsEl.icon + beatsEl.name + '，被 ' + weakEl.icon + weakEl.name + ' 克制'));
    box.appendChild(note);
    return box;
  }

  function currentBuddy() {
    if (battle && battle.dex && battle.dex.buddy) return battle.dex.buddy;
    return buddyInfo;
  }

  function buddyBonusText(b) {
    if (!b) return '无加成';
    var keys = [['hp', '血'], ['atk', '攻'], ['def', '防'], ['spd', '速'], ['crit', '暴击']];
    var out = [];
    for (var i = 0; i < keys.length; i++) {
      if (b[keys[i][0]]) out.push('+' + b[keys[i][0]] + ' ' + keys[i][1]);
    }
    return out.length ? out.join(' · ') : '无加成';
  }

  function buddyLine(b, withOff) {
    var line = h('div', 'ci-pet-buddy-line');
    line.appendChild(h('span', 'ci-pet-buddy-icon', b.icon || ''));
    var txt = h('div', 'ci-pet-buddy-text');
    var nameRow = h('div', 'ci-pet-buddy-name');
    nameRow.appendChild(h('span', null, b.name));
    nameRow.appendChild(elementChip(b.type));
    txt.appendChild(nameRow);
    txt.appendChild(h('div', 'ci-pet-buddy-sub',
      b.rarityIcon + ' ' + b.rarityName + ' · ' + buddyBonusText(b.bonus)));
    line.appendChild(txt);
    if (withOff) {
      var off = h('button', 'ci-pet-btn ci-pet-btn--ghost', '取消随行');
      off.addEventListener('click', function() { doBuddy(''); });
      line.appendChild(off);
    }
    return line;
  }

  function buddyCard() {
    var b = currentBuddy();
    var box = h('div', 'ci-pet-buddy');
    var headRow = h('div', 'ci-pet-buddy-head');
    headRow.appendChild(h('span', 'ci-pet-buddy-title', '随行伙伴'));
    headRow.appendChild(h('span', 'ci-pet-buddy-hint', '加成永久生效，已收服的都能选'));
    box.appendChild(headRow);
    if (!b) {
      box.appendChild(h('div', 'ci-pet-buddy-empty',
        '还没有随行伙伴。先去收服一只——第一只会自动跟着你。'));
      return box;
    }
    box.appendChild(buddyLine(b, true));
    return box;
  }

  // 首页的随行卡：只报「谁在跟着你、加了什么」，切换入口在图鉴页。
  function buddyHomeCard() {
    var b = currentBuddy();
    var box = h('div', 'ci-pet-buddy ci-pet-buddy--home');
    var headRow = h('div', 'ci-pet-buddy-head');
    headRow.appendChild(h('span', 'ci-pet-buddy-title', '随行伙伴'));
    box.appendChild(headRow);
    if (!b) {
      var empty = h('button', 'ci-pet-buddy-empty', '还没有随行伙伴 · 去图鉴收服第一只');
      empty.addEventListener('click', function() { switchTab('dex'); });
      box.appendChild(empty);
      return box;
    }
    box.appendChild(buddyLine(b, false));
    return box;
  }

  function spotlightCard(dex) {
    var s = dex.spotlight;
    var box = h('div', 'ci-pet-wild-spot');
    box.appendChild(h('span', 'ci-pet-wild-spot-tag', '今日焦点'));
    box.appendChild(h('span', 'ci-pet-wild-spot-icon', s.icon || ''));
    box.appendChild(h('span', 'ci-pet-wild-spot-name', s.name));
    box.appendChild(elementChip(s.type));
    box.appendChild(h('span', 'ci-pet-wild-spot-bonus',
      '收服率 +' + Math.round((dex.spotlightBonus || 0.1) * 100) + '%'));
    return box;
  }

  function dexProgress(dex) {
    var box = h('div', 'ci-pet-dex-progress');
    var headRow = h('div', 'ci-pet-dex-head');
    headRow.appendChild(h('span', 'ci-pet-dex-title', '图鉴 ' + dex.ownedCount + ' / ' + dex.total));
    headRow.appendChild(h('span', 'ci-pet-dex-hint', '打赢才有机会收服，失败一次下次 +12%'));
    box.appendChild(headRow);

    var row = h('div', 'ci-pet-dex-types');
    for (var i = 0; i < ELEMENT_ORDER.length; i++) {
      var id = ELEMENT_ORDER[i];
      var s = (dex.byType && dex.byType[id]) || { owned: 0, total: 0 };
      var e = elementOf(id);
      var chip = h('span', 'ci-pet-dex-type' + (s.total && s.owned >= s.total ? ' is-full' : ''));
      chip.appendChild(h('span', 'ci-pet-dex-type-icon', e.icon));
      chip.appendChild(h('span', null, e.name + ' ' + s.owned + '/' + s.total));
      row.appendChild(chip);
    }
    box.appendChild(row);
    return box;
  }

  function wildGroups(dex, dexBox) {
    var box = h('div', 'ci-pet-wilds');
    var rarities = [['common', '常见'], ['rare', '稀有'], ['legend', '传说']];
    for (var r = 0; r < rarities.length; r++) {
      var key = rarities[r][0];
      var list = [];
      for (var i = 0; i < dex.list.length; i++) if (dex.list[i].rarity === key) list.push(dex.list[i]);
      if (!list.length) continue;

      var head = h('div', 'ci-pet-wild-head');
      head.appendChild(h('span', 'ci-pet-wild-head-name', list[0].rarityIcon + ' ' + list[0].rarityName));
      var ownedN = 0;
      for (var j = 0; j < list.length; j++) if (list[j].owned) ownedN++;
      head.appendChild(h('span', 'ci-pet-wild-head-count', ownedN + ' / ' + list.length));
      box.appendChild(head);

      var grid = h('div', 'ci-pet-wild-grid');
      for (var k = 0; k < list.length; k++) grid.appendChild(wildCard(list[k], dexBox));
      box.appendChild(grid);
    }
    return box;
  }

  function wildCard(w, dexBox) {
    // 稀有度也做成一个类（v0.9.0）：图鉴卡按常见/稀有/传说上不同颜色的描边与角标，
    // 一眼能看出这张卡值不值得蹲。
    var card = h('div', 'ci-pet-wild ci-pet-rar--' + (w.rarity || 'common') +
      (w.owned ? ' is-owned' : '') + (w.spotlight ? ' is-spot' : ''));

    var top = h('div', 'ci-pet-wild-top');
    top.appendChild(h('span', 'ci-pet-wild-icon', w.icon || ''));
    var who = h('div', 'ci-pet-wild-who');
    who.appendChild(h('span', 'ci-pet-wild-name', w.name));
    var meta = h('div', 'ci-pet-wild-meta');
    meta.appendChild(elementChip(w.type));
    meta.appendChild(h('span', 'ci-pet-wild-bond', '羁绊 ' + w.bond));
    who.appendChild(meta);
    top.appendChild(who);
    if (w.owned) top.appendChild(h('span', 'ci-pet-wild-owned', '✓ 已收服'));
    card.appendChild(top);

    if (w.desc) card.appendChild(h('div', 'ci-pet-wild-desc', w.desc));

    var foot = h('div', 'ci-pet-wild-foot');
    if (w.owned) {
      var cur = currentBuddy();
      var on = !!(cur && cur.id === w.id);
      var b = h('button', 'ci-pet-foe-btn', on ? '随行中' : '设为随行');
      if (on) b.disabled = true;
      b.addEventListener('click', function() { doBuddy(w.id); });
      foot.appendChild(b);
    } else {
      foot.appendChild(h('span', 'ci-pet-wild-chance',
        '收服率 ' + Math.round((w.capture || 0) * 100) + '%' +
        (w.fails ? '（已失败 ' + w.fails + ' 次）' : '')));
      var btn = h('button', 'ci-pet-foe-btn', '挑战');
      btn.addEventListener('click', function() { doWildFight(w.id, btn, dexBox); });
      foot.appendChild(btn);
    }
    card.appendChild(foot);
    return card;
  }

  function doBuddy(id) {
    if (!api) return;
    api.post('/pet/buddy', { id: id || '' }).then(function(res) {
      var d = (res.data && res.data.data) || {};
      buddyInfo = d.buddy || null;
      if (battle) {
        if (battle.dex) {
          battle.dex.buddy = d.buddy || null;
          battle.dex.buddyBonus = d.buddyBonus || null;
        }
        if (d.combat) battle.combat = d.combat;
        if (d.evolution) battle.evolution = d.evolution;
      }
      if (d.evolution) evolutionInfo = d.evolution;
      sysToast(id ? '随行伙伴已更换' : '已取消随行', 'success');
      renderHome();
    }, function(err) {
      var msg = (err && err.response && err.response.data && err.response.data.message) || '切换失败';
      sysToast(msg, 'error');
    });
  }

  function doBattleType(type, after) {
    if (!api) return;
    api.post('/pet/battle/type', { type: type }).then(function(res) {
      var d = (res.data && res.data.data) || {};
      if (battle) {
        battle.battleType = d.battleType || type;
        battle.typeInfo = d.typeInfo || battle.typeInfo;
        if (d.opponents) battle.opponents = d.opponents;
        if (d.shadows) battle.shadows = d.shadows;
      }
      var e = elementOf(type);
      sysToast('本命改成 ' + e.icon + e.name + '，对局里的克制关系已经变了', 'success');
      if (after) after(); else renderHome();
    }, function(err) {
      var msg = (err && err.response && err.response.data && err.response.data.message) || '切换属性失败';
      sysToast(msg, 'error');
    });
  }

  function doWildFight(id, btn, dexBox) {
    if (!api) return;
    btn.disabled = true;
    var txt = btn.textContent;
    btn.textContent = '靠近中…';
    var body = { id: id };
    if (battle && battle.tactic) body.tactic = battle.tactic;
    api.post('/pet/wild/fight', body).then(function(res) {
      var d = (res.data && res.data.data) || {};
      if (!d.steps || !dexBox) { btn.disabled = false; btn.textContent = txt; return; }
      battle = null;    // 图鉴 / 战力都可能变了，回来重新取
      clearEl(dexBox);
      playFight(dexBox, d, { wild: true, creature: d.creature });
      try { dexBox.scrollIntoView({ block: 'start' }); } catch (e) {}
    }, function(err) {
      var msg = (err && err.response && err.response.data && err.response.data.message) || '挑战失败';
      sysToast(msg, 'error');
      btn.disabled = false;
      btn.textContent = txt;
    });
  }

  // 排行页：我的位置 + 积分榜 + 成就 + 称号。只比积分，羁绊不上榜。
  function rankSection() {
    var box = h('div', 'ci-pet-rankpage');
    var c = battle.combat || {};
    var rec = battle.record || {};

    var me = h('div', 'ci-pet-rankme');
    me.appendChild(h('div', 'ci-pet-rankme-num',
      battle.myRank ? ('全班第 ' + battle.myRank + ' 名') : '还没上榜'));
    me.appendChild(h('div', 'ci-pet-rankme-sub',
      '积分 ' + (rec.points || 0) + ' · 战力 ' + (c.power || 0) + ' · 羁绊 ' + (c.bond || 0)));
    if (battle.typeInfo) {
      var trow = h('div', 'ci-pet-rankme-type');
      trow.appendChild(h('span', null, '本命'));
      trow.appendChild(elementChip(battle.typeInfo.id));
      me.appendChild(trow);
    }
    box.appendChild(me);

    var hasRank = (battle.rank || []).length > 0;
    box.appendChild(rankBox());
    if (!hasRank) {
      box.appendChild(h('div', 'ci-pet-battle-none',
        '还没有人上榜。去打几场，第一个名字就会是你。'));
    }
    box.appendChild(achBox());
    box.appendChild(titleBox());
    return box;
  }

  // ================= 对战（v0.4.0：练习赛）=================
  // 结算全在服务端（backend/routes.js 的 /pet/battle/fight），这里只做两件事：
  //   1) 展示战力 / 战绩 / 今日场次；2) 把返回的逐回合战报按节奏播出来。
  // 战报格式是通用契约 —— 以后换成真人对手（异步影子 / 实时房间），这一段一行都不用改。
  var battle = null;        // 服务端 profile 缓存
  var battleLoading = false;
  var battleFailed = false;
  var battleWaiters = [];
  var fightTimer = null;
  var fightToken = 0;
  // 服务端没返回 cap 时的兜底值。后端 BATTLE_DAILY_CAP 改这里要跟着改——
  // 之前两处兜底一个写 5 一个写 10，页面上就出现了「今日 3/10」和「每天共 5 场」并存。
  // 次数上限。0 = 不限（后端 BATTLE_DAILY_CAP 同步改成 0）。
  // 保留这个常量是因为所有「还剩几场」的判断都读它，将来要限就改一处。
  var CAP_FALLBACK = 0;

  function loadBattle(cb) {
    if (!api) { if (cb) cb(); return; }
    if (cb) battleWaiters.push(cb);
    if (battleLoading) return;      // 已有请求在飞：挂到等待队列，避免回调丢失导致一直「战力计算中…」
    battleLoading = true;
    api.get('/pet/battle/profile').then(function(res) {
      var d = res && res.data && res.data.data;
      // 宿主桩/降级环境下可能返回别的形状：只认带 combat 的才算拿到档案，
      // 否则当成失败，避免把 {state:...} 当成战斗档案渲染出一片 0。
      battle = (d && d.combat) ? d : null;
      battleFailed = !battle;
    }, function() {
      battle = null;
      battleFailed = true;
    }).then(function() {
      battleLoading = false;
      var list = battleWaiters;
      battleWaiters = [];
      for (var i = 0; i < list.length; i++) { try { list[i](); } catch (e) {} }
      // 档案到手后把 tab 角标和首页入口文案补上，避免「首页写着 0 只，图鉴里其实有 3 只」
      if (root) { refreshTabBadges(); refreshHomeLinks(); fillHud(); }
    });
  }

  // 收服 / 换随行之后要重读一次 /pet/state：buddy、进化阶段、属性表都在那里。
  function reloadState(cb) {
    if (!api) { if (cb) cb(); return; }
    api.get('/pet/state').then(function(res) {
      var d = (res.data && res.data.data) || {};
      state = d.state || state;
      applyStateMeta(d);
      if (cb) cb();
    }, function() { if (cb) cb(); });
  }

  function clearEl(el) { while (el && el.firstChild) el.removeChild(el.firstChild); }

  function stopFight() {
    fightToken++;
    if (fightTimer) { clearTimeout(fightTimer); fightTimer = null; }
  }

  function battleSection() {
    var sec = h('div', 'ci-pet-battle');
    fillBattle(sec);
    return sec;
  }

  // 对战页的属性条复用图鉴页那一套组件，只是改完要就地重画对手卡。
  function typeBar(sec) {
    return typePicker(function() { fillBattle(sec); });
  }

  function fillBattle(sec) {
    if (!sec) return;
    stopFight();
    clearEl(sec);
    if (!battle) {
      // ⚠️ 失败必须停下来：之前「拿不到就再请求」会变成死循环——网断了就一直在刷接口。
      if (battleFailed) {
        var err = h('div', 'ci-pet-battle-loading', '战力档案没加载出来');
        var retry = h('button', 'ci-pet-foe-btn', '重试');
        retry.addEventListener('click', function() {
          battleFailed = false;
          fillBattle(sec);
        });
        err.appendChild(retry);
        sec.appendChild(err);
        return;
      }
      sec.appendChild(h('div', 'ci-pet-battle-loading', '战力计算中…'));
      loadBattle(function() { if (sec.parentNode) fillBattle(sec); });
      return;
    }
    var c = battle.combat || {};
    var rec = battle.record || {};

    var head = h('div', 'ci-pet-battle-head');
    var powerBox = h('div', 'ci-pet-power');
    powerBox.appendChild(h('span', 'ci-pet-power-num', String(c.power || 0)));
    powerBox.appendChild(h('span', 'ci-pet-power-label', '战力'));
    head.appendChild(powerBox);

    var meta = h('div', 'ci-pet-battle-meta');
    meta.appendChild(h('div', 'ci-pet-battle-tier', (c.tierName || '初识') + ' · 羁绊 ' + (c.bond || 0)));
    meta.appendChild(h('div', 'ci-pet-battle-record',
      (rec.win || 0) + ' 胜 ' + (rec.lose || 0) + ' 负 · ' + (rec.points || 0) + ' 分'));
    // 连胜是唯一会「断」的东西，所以放在战绩下面单独一行，赢了才值得看
    if (rec.streak > 0) {
      meta.appendChild(h('div', 'ci-pet-battle-streak',
        '🔥 ' + rec.streak + ' 连胜' + (rec.best > rec.streak ? '（最好 ' + rec.best + '）' : '')));
    } else if (rec.best > 0) {
      meta.appendChild(h('div', 'ci-pet-battle-streak ci-pet-battle-streak--idle',
        '最好连胜 ' + rec.best));
    }
    // 次数不限，所以这里改成报「今天打了几场」而不是「还剩几场」。
    // 上限如果将来恢复（cap > 0），会自动变成 x / N 的写法。
    var capVal = (battle.cap === undefined ? CAP_FALLBACK : battle.cap);
    meta.appendChild(h('div', 'ci-pet-battle-quota',
      capVal > 0
        ? ('今日 ' + (battle.today || 0) + ' / ' + capVal + ' 场')
        : ('今日 ' + (battle.today || 0) + ' 场，想打就打')));

    var def = battle.defend || {};
    if (def.total) {
      meta.appendChild(h('div', 'ci-pet-battle-quota',
        '守擂 ' + (def.held || 0) + ' 胜 ' + (def.broken || 0) + ' 负 · ' + (def.points || 0) + ' 分'));
    }
    if (battle.myRank) {
      meta.appendChild(h('div', 'ci-pet-battle-rank',
        '全班第 ' + battle.myRank + ' 名' +
        (battle.myRank <= 3 ? ' 🏅' : '')));
    }
    head.appendChild(meta);
    sec.appendChild(head);

    sec.appendChild(typeBar(sec));
    sec.appendChild(inboxBox(sec));
    sec.appendChild(tacticBar(sec));
    sec.appendChild(skillBar(sec));

    // left = -1 表示不限次数（后端约定），只有 cap > 0 时才可能是 0
    var out = !battle || (typeof battle.left === 'number' && battle.left === 0 && battle.cap > 0);
    sec.appendChild(subTitle('真人影子'));
    var shadows = battle.shadows || [];
    if (!shadows.length) {
      sec.appendChild(h('div', 'ci-pet-battle-none',
        '暂时没有和你羁绊相近的同学，先打练习赛，过几天再来看看。'));
    } else {
      var slist = h('div', 'ci-pet-foes');
      for (var k = 0; k < shadows.length; k++) slist.appendChild(foeCard(sec, shadows[k], out));
      sec.appendChild(slist);
    }

    sec.appendChild(subTitle('练习赛'));
    var foes = battle.opponents || [];
    var list = h('div', 'ci-pet-foes');
    for (var i = 0; i < foes.length; i++) list.appendChild(foeCard(sec, foes[i], out));
    sec.appendChild(list);

    sec.appendChild(h('div', 'ci-pet-battle-tip',
      '影子是同学家那只宠物的快照：他不用在线，打完会收到你的挑战留言。' +
      '练习赛和影子只涨战力积分，都不碰羁绊。' +
      '不限次数随时能打；当天打得越多，每场积分越少（前 5 场全额）。'));

    sec.appendChild(towerSection(sec));
    sec.appendChild(achBox());
    sec.appendChild(titleBox());
    sec.appendChild(rankBox());
  }

  // 技能：战斗内发生什么。战术决定属性分配，技能决定战斗过程，两者叠加才是 build。
  function skillBar(sec) {
    var list = battle.skills || [];
    if (!list.length) return h('div', '');
    var equipped = battle.equipped || [];
    var slots = battle.skillSlots || 2;
    var box = h('div', 'ci-pet-skills');

    var headRow = h('div', 'ci-pet-skills-head');
    headRow.appendChild(h('span', 'ci-pet-skills-title', '技能 ' + equipped.length + ' / ' + slots));
    headRow.appendChild(h('span', 'ci-pet-skills-hint', '点一下装备 / 卸下'));
    box.appendChild(headRow);

    var row = h('div', 'ci-pet-skills-row');
    for (var i = 0; i < list.length; i++) {
      (function(s) {
        var on = equipped.indexOf(s.id) >= 0;
        var chip = h('button', 'ci-pet-skill' + (on ? ' is-on' : ''));
        chip.setAttribute('data-skill', s.id);
        chip.appendChild(h('span', 'ci-pet-skill-icon', s.icon || ''));
        chip.appendChild(h('span', 'ci-pet-skill-name', s.name));
        chip.setAttribute('title', s.desc || '');
        chip.addEventListener('click', function() {
          var next = (battle.equipped || []).slice();
          var idx = next.indexOf(s.id);
          if (idx >= 0) {
            next.splice(idx, 1);
          } else {
            if (next.length >= slots) next.shift();   // 满了就顶掉最早那个
            next.push(s.id);
          }
          // 先本地生效再发请求：点一下就要有反馈，等网络回来才变色会显得卡
          battle.equipped = next;
          if (api) {
            api.post('/pet/battle/skills', { skills: next }).then(function(res) {
              var d = (res.data && res.data.data) || {};
              if (d.equipped) battle.equipped = d.equipped;
              if (d.skills) battle.skills = d.skills;
              redrawSkills();
            }, function() {
              redrawSkills();   // 失败就按原来的重画（服务端没改）
            });
          } else {
            redrawSkills();
          }
        });
        row.appendChild(chip);
      })(list[i]);
    }
    box.appendChild(row);

    function redrawSkills() {
      var chips = row.childNodes;
      for (var m = 0; m < chips.length; m++) {
        var c = chips[m];
        if (!c.className || c.className.indexOf('ci-pet-skill') !== 0) continue;
        var id = c.getAttribute('data-skill');
        if (!id) continue;
        var isOn = (battle.equipped || []).indexOf(id) >= 0;
        c.className = 'ci-pet-skill' + (isOn ? ' is-on' : '');
      }
      var t = box.querySelector('.ci-pet-skills-title');
      if (t) t.textContent = '技能 ' + (battle.equipped || []).length + ' / ' + slots;
    }
    // 记录 id，供重绘时判断
    return box;
  }

  // 试炼塔：线性进度。有终点、有台阶、有过不去的那一层。
  function towerSection(sec) {
    var t = battle.tower;
    if (!t) return h('div', '');
    var box = h('div', 'ci-pet-tower');

    var headRow = h('div', 'ci-pet-tower-head');
    headRow.appendChild(h('span', 'ci-pet-tower-title', '试炼塔 ' + (t.cleared || 0) + ' / ' + t.total));
    headRow.appendChild(h('span', 'ci-pet-tower-quota',
      t.cap > 0
        ? ('今日 ' + (t.today || 0) + ' / ' + t.cap + ' 次')
        : ('今日挑战 ' + (t.today || 0) + ' 次')));
    box.appendChild(headRow);

    // 进度格：10 个小方块，通关的填色
    var pips = h('div', 'ci-pet-tower-pips');
    for (var i = 0; i < t.floors.length; i++) {
      var f = t.floors[i];
      pips.appendChild(h('span',
        'ci-pet-tower-pip' + (f.cleared ? ' is-done' : '') + (f.f === (t.cleared || 0) + 1 ? ' is-next' : ''),
        String(f.f)));
    }
    box.appendChild(pips);

    if (!t.next) {
      box.appendChild(h('div', 'ci-pet-tower-done',
        '👑 十层全通，你是这一届的塔顶传说。'));
      return box;
    }

    var n = t.next;
    var card = h('div', 'ci-pet-tower-card');
    var top = h('div', 'ci-pet-foe-top');
    var who = h('div', 'ci-pet-foe-who');
    who.appendChild(h('span', 'ci-pet-foe-name', '第 ' + n.f + ' 层 · ' + n.name));
    if (n.type) who.appendChild(elementChip(n.type));
    var odds = oddsLabel(n.power);
    who.appendChild(h('span', 'ci-pet-odds ci-pet-odds--' + odds.key, odds.text));
    top.appendChild(who);

    // 塔也不限次数（left = -1），按钮永远可点
    var out = typeof t.left === 'number' && t.left === 0 && t.cap > 0;
    var btn = h('button', 'ci-pet-foe-btn', out ? '今日次数用完' : '挑战');
    if (out) btn.disabled = true;
    btn.addEventListener('click', function() { doTowerFight(sec, btn); });
    top.appendChild(btn);
    card.appendChild(top);
    card.appendChild(h('div', 'ci-pet-foe-meta',
      '羁绊 ' + n.bond + ' · 战力 ' + n.power + (n.skills && n.skills.length ? ' · 会 ' + n.skills.length + ' 个技能' : '')));
    if (n.desc) card.appendChild(h('div', 'ci-pet-foe-desc', n.desc));
    box.appendChild(card);

    box.appendChild(h('div', 'ci-pet-tower-tip',
      '整座塔都是土属性：草本命打起来最轻松，电本命会被全程克制。' +
      '塔层不会跟着你变强，卡在哪层就是卡在哪层——喂饱宠物、涨了羁绊就能过去。' +
      '不限次数随时来打，和练习赛的积分分开算。'));
    return box;
  }

  // 按战力比给难度标签（与服务端同一套阈值）
  function oddsLabel(foePower) {
    var mine = (battle && battle.combat && battle.combat.power) || 0;
    if (!foePower || !mine) return { key: 'even', text: '势均' };
    var r = mine / foePower;
    if (r >= 1.12) return { key: 'easy', text: '好打' };
    if (r <= 0.90) return { key: 'hard', text: '吃力' };
    return { key: 'even', text: '势均' };
  }

  function doTowerFight(sec, btn) {
    if (!api) return;
    btn.disabled = true;
    var btnText = btn.textContent;
    btn.textContent = '爬塔中…';
    var body = {};
    if (battle && battle.tactic) body.tactic = battle.tactic;
    api.post('/pet/tower/fight', body).then(function(res) {
      var d = (res.data && res.data.data) || {};
      if (!d.steps) { btn.disabled = false; btn.textContent = btnText; return; }
      battle = null;    // 层数/次数都变了，回来时重新取
      playTowerFight(sec, d);
    }, function(err) {
      var msg = (err && err.response && err.response.data && err.response.data.message) || '爬塔失败';
      sysToast(msg, 'error');
      btn.disabled = false;
      btn.textContent = btnText;
      loadBattle(function() { fillBattle(sec); });
    });
  }

  // 塔的战斗回放：复用同一个播放器，只是结尾多一句「通关第 N 层」
  function playTowerFight(sec, d) {
    playFight(sec, d, {
      tower: true,
      floor: d.floor,
      total: d.towerTotal,
      cleared: d.cleared
    });
  }

  // 称号：全部由存档推导，只显示已获得的
  function titleBox() {
    var list = battle.titles || [];
    if (!list.length) return h('div', '');
    var box = h('div', 'ci-pet-titles');
    var headRow = h('div', 'ci-pet-titles-head');
    headRow.appendChild(h('span', 'ci-pet-titles-title', '称号'));
    box.appendChild(headRow);
    var row = h('div', 'ci-pet-titles-row');
    for (var i = 0; i < list.length; i++) {
      row.appendChild(h('span', 'ci-pet-title-chip',
        (list[i].icon || '') + ' ' + list[i].name));
    }
    box.appendChild(row);
    return box;
  }

  function subTitle(t) { return h('div', 'ci-pet-battle-sub', t); }

  // 战术：赛前选一个，它会真的改写属性（服务端 applyTactic），再进结算。
  // 这是整个对战里唯一的决策点——没有它，玩家只是点「挑战」再看一段动画。
  function tacticBar(sec) {
    var list = battle.tactics || [];
    if (!list.length) return h('div', '');
    var cur = battle.tactic || 'guard';
    var box = h('div', 'ci-pet-tactics');

    var headRow = h('div', 'ci-pet-tactics-head');
    headRow.appendChild(h('span', 'ci-pet-tactics-title', '出战风格'));
    var curObj = null;
    for (var i = 0; i < list.length; i++) if (list[i].id === cur) curObj = list[i];
    headRow.appendChild(h('span', 'ci-pet-tactics-hint', curObj ? curObj.desc : ''));
    box.appendChild(headRow);

    var row = h('div', 'ci-pet-tactics-row');
    for (var k = 0; k < list.length; k++) {
      (function(t) {
        var on = t.id === cur;
        var chip = h('button', 'ci-pet-tactic' + (on ? ' is-on' : ''));
        chip.appendChild(h('span', 'ci-pet-tactic-icon', t.icon || ''));
        chip.appendChild(h('span', 'ci-pet-tactic-name', t.name));
        chip.addEventListener('click', function() {
          if (battle.tactic === t.id) return;
          battle.tactic = t.id;
          // 只改本地记忆并重渲染战术条：发一次 PUT 太浪费，真正落库在下一次开打时带过去
          var wrap = chip.parentNode;
          var kids = wrap.childNodes;
          for (var m = 0; m < kids.length; m++) {
            if (kids[m].className && kids[m].className.indexOf('ci-pet-tactic') === 0) {
              kids[m].className = 'ci-pet-tactic';
            }
          }
          chip.className = 'ci-pet-tactic is-on';
          var hint = sec.querySelector('.ci-pet-tactics-hint');
          if (hint) hint.textContent = t.desc;
        });
        row.appendChild(chip);
      })(list[k]);
    }
    box.appendChild(row);
    return box;
  }

  // 成就：只显示已解锁的（空格子是压力，不是目标）
  function achBox() {
    var got = battle.achievements || [];
    var all = battle.achievementList || [];
    if (!all.length) return h('div', '');
    var box = h('div', 'ci-pet-ach');

    var headRow = h('div', 'ci-pet-ach-head');
    headRow.appendChild(h('span', 'ci-pet-ach-title', '成就 ' + got.length + ' / ' + all.length));
    box.appendChild(headRow);

    var row = h('div', 'ci-pet-ach-row');
    for (var i = 0; i < all.length; i++) {
      var a = all[i];
      var owned = got.indexOf(a.id) >= 0;
      var chip = h('span', 'ci-pet-ach-chip' + (owned ? ' is-on' : ''), (a.icon || '') + ' ' + a.name);
      chip.title = a.desc || '';
      row.appendChild(chip);
    }
    box.appendChild(row);
    return box;
  }

  // 排行榜：只排战力积分。羁绊不排——那是私事。
  function rankBox() {
    var rows = battle.rank || [];
    if (!rows.length) return h('div', '');
    var box = h('div', 'ci-pet-rank');
    var headRow = h('div', 'ci-pet-rank-head');
    headRow.appendChild(h('span', 'ci-pet-rank-title', '积分榜'));
    if (battle.myRank) headRow.appendChild(h('span', 'ci-pet-rank-mine', '我第 ' + battle.myRank + ' 名'));
    box.appendChild(headRow);

    var list = h('div', 'ci-pet-rank-list');
    for (var i = 0; i < rows.length && i < 5; i++) {
      var r = rows[i];
      var line = h('div', 'ci-pet-rank-item' + (battle.myRank === r.rank ? ' is-me' : ''));
      line.appendChild(h('span', 'ci-pet-rank-no', String(r.rank)));
      line.appendChild(h('span', 'ci-pet-rank-name', r.name));
      if (r.owner) line.appendChild(h('span', 'ci-pet-rank-owner', r.owner));
      line.appendChild(h('span', 'ci-pet-rank-pts', r.points + ' 分'));
      list.appendChild(line);
    }
    box.appendChild(list);
    return box;
  }

  // 挑战留言：被打之后这里会亮。看完即焚（调 inbox/read 清掉），不占长期版面。
  function inboxBox(sec) {
    var msgs = battle.inbox || [];
    if (!msgs.length) return h('div', '');
    var box = h('div', 'ci-pet-inbox');
    var headRow = h('div', 'ci-pet-inbox-head');
    headRow.appendChild(h('span', 'ci-pet-inbox-title', '⚔️ ' + msgs.length + ' 条挑战留言'));
    headRow.appendChild(h('span', 'ci-pet-inbox-hint', '看过了就不再提示'));
    box.appendChild(headRow);
    for (var i = 0; i < msgs.length && i < 3; i++) {
      var m = msgs[i];
      var who = m.whoOwner ? (m.whoOwner + ' 的 ' + m.who) : (m.who || '有人');
      var line = h('div', 'ci-pet-inbox-item');
      line.appendChild(h('span', 'ci-pet-inbox-who', who));
      line.appendChild(h('span', 'ci-pet-inbox-what', m.held ? '没打过你，你守住了' : '把你打败了'));
      line.appendChild(h('span', 'ci-pet-inbox-rounds', m.rounds + ' 回合'));
      // 被打了总想还手，所以留言直接给一个入口——但要占当天场次，
      // 因此打满时按钮是灰的，不给「点了没反应」的错觉。
      if (m.uid) {
        var hit = h('button', 'ci-pet-inbox-hit', '找他算账');
        hit.addEventListener('click', function(uid) {
          return function() { doFight(sec, 'p:' + uid, this); };
        }(m.uid));
        line.appendChild(hit);
      }
      box.appendChild(line);
    }
    var clear = h('button', 'ci-pet-inbox-clear', '知道了');
    clear.addEventListener('click', function() {
      battle.inbox = [];
      if (api) api.post('/pet/battle/inbox/read', {}).then(function() {}, function() {});
      fillBattle(sec);
    });
    box.appendChild(clear);
    return box;
  }

  // kind='shadow' 时 foe.owner 是对方同学的昵称，要显示出来——
  // 「打同学」的乐趣一半来自知道那是谁，匿名列表就只剩数值了。
  function foeCard(sec, foe, out) {
    var card = h('div', 'ci-pet-foe' + (foe.kind === 'shadow' ? ' ci-pet-foe--shadow' : ''));

    // 首行：名字 + 归属/难度 + 按钮（靠右）。按钮必须和名字同一行——
    // 之前把所有元素平铺进 flex-wrap，按钮会被战力文字挤到第二行，右边留一大块空白。
    var top = h('div', 'ci-pet-foe-top');
    var who = h('div', 'ci-pet-foe-who');
    who.appendChild(h('span', 'ci-pet-foe-name', foe.name || '?'));
    if (foe.owner) who.appendChild(h('span', 'ci-pet-foe-owner', foe.owner));
    if (foe.type) who.appendChild(elementChip(foe.type));
    if (foe.typeMul && foe.typeMul !== 1) {
      who.appendChild(h('span', 'ci-pet-typetag ' + (foe.typeMul > 1 ? 'is-adv' : 'is-dis'),
        foe.typeMul > 1 ? '克制它' : '被它克'));
    }
    if (foe.oddsText) {
      who.appendChild(h('span', 'ci-pet-odds ci-pet-odds--' + (foe.odds || 'even'), foe.oddsText));
    }
    top.appendChild(who);

    var btn = h('button', 'ci-pet-foe-btn', out ? '今日已打满' : '挑战');
    if (out) btn.disabled = true;
    btn.addEventListener('click', function() { doFight(sec, foe.id, btn); });
    top.appendChild(btn);
    card.appendChild(top);

    card.appendChild(h('div', 'ci-pet-foe-meta', '羁绊 ' + foe.bond + ' · 战力 ' + foe.power));
    if (foe.desc) card.appendChild(h('div', 'ci-pet-foe-desc', foe.desc));
    return card;
  }

  function doFight(sec, oppId, btn) {
    if (!api) return;
    btn.disabled = true;
    var btnText = btn.textContent;
    btn.textContent = '出战中…';
    // 带上当前选的战术：服务端会用它改写属性，并记住作为下次的默认
    var body = { oppId: oppId };
    if (battle && battle.tactic) body.tactic = battle.tactic;
    api.post('/pet/battle/fight', body).then(function(res) {
      var d = (res.data && res.data.data) || {};
      if (!d.steps) { btn.disabled = false; btn.textContent = btnText; return; }
      battle = null;                      // 战绩与今日次数都变了，回列表时重新取
      playFight(sec, d);
    }, function(err) {
      var msg = (err && err.response && err.response.data && err.response.data.message) || '挑战失败';
      sysToast(msg, 'error');
      btn.disabled = false;
      btn.textContent = btnText;
      // 429 = 今天打满 / 被拒：重新拉一次档案，让所有按钮一起变成「今日已打满」
      loadBattle(function() { fillBattle(sec); });
    });
  }

  // 血条：显示剩余 / 上限，宽度按比例
  function arenaSide(c, kind) {
    var el = h('div', 'ci-pet-arena-side ci-pet-arena-side--' + kind);
    el.appendChild(h('div', 'ci-pet-arena-name', c.name || '?'));
    var badgeRow = h('div', 'ci-pet-arena-badges');
    if (c.type) badgeRow.appendChild(elementChip(c.type));
    badgeRow.appendChild(h('div', 'ci-pet-arena-power', '战力 ' + (c.power || 0)));
    el.appendChild(badgeRow);
    var bar = h('div', 'ci-pet-hpbar');
    var fill = h('span', 'ci-pet-hpfill');
    bar.appendChild(fill);
    el.appendChild(bar);
    var txt = h('div', 'ci-pet-hptext', '');
    el.appendChild(txt);
    var max = Math.max(1, c.hp || 1);
    return {
      el: el,
      set: function(hp) {
        var v = Math.max(0, hp || 0);
        fill.style.width = Math.round(v / max * 100) + '%';
        txt.textContent = v + ' / ' + max;
      }
    };
  }

  function playFight(sec, d, opts) {
    opts = opts || {};
    stopFight();
    clearEl(sec);
    var token = ++fightToken;
    var arena = h('div', 'ci-pet-arena');

    var meSide = arenaSide(d.me || {}, 'me');
    var foeSide = arenaSide(d.foe || {}, 'foe');
    meSide.set((d.me || {}).hp);
    foeSide.set((d.foe || {}).hp);

    var sides = h('div', 'ci-pet-arena-sides');
    sides.appendChild(meSide.el);
    sides.appendChild(h('div', 'ci-pet-arena-vs', 'VS'));
    sides.appendChild(foeSide.el);
    arena.appendChild(sides);

    var logEl = h('div', 'ci-pet-arena-log', '第 1 回合即将开始…');
    arena.appendChild(logEl);

    var skip = h('button', 'ci-pet-arena-skip', '跳过动画');
    arena.appendChild(skip);
    sec.appendChild(arena);

    var steps = d.steps || [];
    var idx = 0;
    var lines = [];
    var myName = (d.me && d.me.name) || '你';

    function applyStep(s) {
      meSide.set(s.hpMe);
      foeSide.set(s.hpFoe);
      var who = s.by === 0 ? myName : ((d.foe && d.foe.name) || '对手');
      var tags = s.tags || [];
      if (s.heal) {
        // 吸血是「回血」不是「伤害」，必须单独成句，否则战报里会出现「打出 0 点」
        lines.push('第 ' + s.r + ' 回合 · ' + who + ' 吸回 ' + s.heal + ' 点');
      } else {
        var mark = '';
        if (tags.indexOf('heavy') >= 0) mark = ' 千钧一击 ';
        else if (tags.indexOf('combo') >= 0) mark = ' 追击 ';
        else if (tags.indexOf('shield') >= 0) mark = '（护盾挡下）';
        else if (s.crit) mark = ' 暴击 ';
        else mark = ' 打出 ';
        // 属性相克单独缀在句尾：它解释的是「为什么这一下特别疼 / 特别软」，
        // 不该顶掉暴击、千钧这些动作词。
        var eff = '';
        if (tags.indexOf('weak') >= 0) eff = '（效果拔群）';
        else if (tags.indexOf('resist') >= 0) eff = '（效果一般）';
        lines.push('第 ' + s.r + ' 回合 · ' + who + mark + (s.dmg || 0) + ' 点' + eff);
      }
      if (lines.length > 4) lines.shift();
      logEl.textContent = lines.join('\n');
    }

    function finish() {
      skip.style.display = 'none';
      var banner = h('div', 'ci-pet-arena-result' + (d.win ? ' is-win' : ' is-lose'));

      if (opts.tower) {
        // 塔的结算完全不用「积分」这套说法：它讲的是层数，不是分数
        var fNo = opts.floor;
        banner.appendChild(h('div', 'ci-pet-result-title',
          d.win ? ('🎉 第 ' + fNo + ' 层通过！') : ('💧 第 ' + fNo + ' 层没过')));
        banner.appendChild(h('div', 'ci-pet-result-sub',
          d.win
            ? ('+ ' + (d.gain || 0) + ' 塔积分 · 现在 ' + (d.towerPoints || 0) + ' 分')
            : '差一点。喂饱它、涨了羁绊再来，或者换套技能试试'));
        banner.appendChild(h('div', 'ci-pet-result-quota',
          '今日爬塔 ' + d.today + ' 次 · 已通 ' + (d.towerFloor || 0) + ' / ' + (d.towerTotal || 10) + ' 层'));
      } else if (opts.wild) {
        // 收服结算：三段只在三种结果里各出现一段，别把「没抓到」写成失败
        var cr = opts.creature || d.creature || {};
        if (d.captured) {
          banner.appendChild(h('div', 'ci-pet-result-title', '🎉 收服成功！'));
          banner.appendChild(h('div', 'ci-pet-result-sub',
            (cr.icon || '') + ' ' + (cr.name || '它') + ' 加入了图鉴 · 图鉴 ' + d.dexCount + ' / ' + d.dexTotal));
          if (d.buddySet) {
            banner.appendChild(h('div', 'ci-pet-result-share',
              '它是你的第一只，已经自动成为随行伙伴。'));
          }
        } else if (d.win) {
          banner.appendChild(h('div', 'ci-pet-result-title', '⚡ 打赢了，但它溜走了'));
          banner.appendChild(h('div', 'ci-pet-result-sub',
            '这次收服率 ' + Math.round((d.chance || 0) * 100) + '% · 下次 ' +
            Math.round((d.nextChance || 0) * 100) + '%（每失败一次 +12%）'));
        } else {
          banner.appendChild(h('div', 'ci-pet-result-title', '💧 没打过'));
          banner.appendChild(h('div', 'ci-pet-result-sub',
            '它跑了。喂饱宠物、涨了羁绊再来，或者换成本命克制它的属性。'));
        }
        banner.appendChild(h('div', 'ci-pet-result-quota',
          '收服不消耗练习赛次数，也不涨积分'));
      } else {
        banner.appendChild(h('div', 'ci-pet-result-title', d.win ? '🏆 赢了！' : '💧 惜败'));
        banner.appendChild(h('div', 'ci-pet-result-sub',
          (d.win ? '积分 +' : '保底积分 +') + d.gain + ' · 现在 ' + ((d.record && d.record.points) || 0) + ' 分'));
        // 连胜只在赢了的时候报；断了就别在失败横幅上再补一句「连胜断了」——落井下石。
        if (d.win && d.record && d.record.streak > 1) {
          banner.appendChild(h('div', 'ci-pet-result-streak', '🔥 ' + d.record.streak + ' 连胜'));
        }
        // 次数不限之后，这里报的是「今天第几场」+ 积分衰减提示
        banner.appendChild(h('div', 'ci-pet-result-quota',
          '今日第 ' + d.today + ' 场' + (d.decayed ? '（今天打得多，收益已在递减）' : '')));
      }
      // 打真人时才有的那一行：让「对面是活人」这件事在结算的一瞬间被看见
      if (d.defended && d.opp && d.opp.kind === 'shadow') {
        var nick = d.opp.owner ? (d.opp.owner + ' 的 ') : '';
        banner.appendChild(h('div', 'ci-pet-result-share',
          '已留言给 ' + nick + (d.opp.name || '对方') +
          '：他这场' + (d.defended.held ? '守住了（+' + d.defended.gain + ' 分）' : '没守住')));
      }
      // 新解锁的成就：这是打完之后最该被看到的一行
      if (d.unlocked && d.unlocked.length) {
        var got = [];
        for (var u = 0; u < d.unlocked.length; u++) {
          got.push((d.unlocked[u].icon || '') + ' ' + d.unlocked[u].name);
        }
        banner.appendChild(h('div', 'ci-pet-result-ach', '🎖 解锁成就：' + got.join('、')));
      }
      var back = h('button', 'ci-pet-foe-btn',
        opts.wild ? '回到图鉴' : (opts.tower ? '回到塔' : '回到对手列表'));
      back.addEventListener('click', function() {
        // battle 在开打时已置 null（战绩/次数都变了），这里只负责重新取一次再渲染
        if (opts.wild) {
          reloadState(function() {
            loadBattle(function() { renderHome(); });
          });
        } else {
          loadBattle(function() { fillBattle(sec); });
        }
      });
      banner.appendChild(back);
      arena.appendChild(banner);
      if (d.win) { try { window.dispatchEvent(new CustomEvent('ci-pet-win')); } catch (e) {} }
    }

    function tick() {
      if (token !== fightToken) return;
      if (idx >= steps.length) { finish(); return; }
      applyStep(steps[idx]);
      idx++;
      fightTimer = setTimeout(tick, 340);
    }

    skip.addEventListener('click', function() {
      if (token !== fightToken) return;
      stopFight();
      while (idx < steps.length) { applyStep(steps[idx]); idx++; }
      finish();
    });

    fightTimer = setTimeout(tick, 320);
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
      applyStateMeta(d);
      renderHome();
      if (state && state.adopted) {
        notifyChanged();
        // 首页的入口卡要显示今日场次 / 图鉴进度，所以挂载后就顺手取一次档案。
        // loadBattle 成功后只原地补角标和副标题，不整页重绘。
        loadBattle(function() {});
      }
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
