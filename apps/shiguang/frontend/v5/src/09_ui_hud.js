  // ---------------- §15 HUD ----------------
  // HUD 全部是 DOM：数字要清晰、要能被 CSS 主题影响，画在 canvas 上就糊了。
  var UI = {};

  function uiBuild(root) {
    var hud = el('div', 'sg5-hud');
    root.appendChild(hud);
    UI.hud = hud;

    // ---- 左上 生命 / 灯火 / 经验 ----
    var status = el('div', 'sg5-status');
    var face = el('div', 'sg5-face');
    var faceCv = document.createElement('canvas');
    faceCv.width = 48; faceCv.height = 48;
    faceCv.className = 'sg5-facecv';
    face.appendChild(faceCv);
    UI.faceCv = faceCv;
    status.appendChild(face);
    var bars = el('div', 'sg5-bars');
    var nameRow = el('div', 'sg5-namerow');
    UI.nameEl = el('span', 'sg5-name', '旅人');
    UI.lvEl = el('span', 'sg5-lv', 'Lv.1');
    nameRow.appendChild(UI.nameEl);
    nameRow.appendChild(UI.lvEl);
    bars.appendChild(nameRow);
    UI.hpBar = bar('hp', bars);
    UI.mpBar = bar('mp', bars);
    UI.xpBar = bar('xp', bars);
    status.appendChild(bars);
    hud.appendChild(status);

    // ---- 右上 小地图 + 时钟 ----
    var tr = el('div', 'sg5-topright');
    var mini = document.createElement('div');
    mini.className = 'sg5-mini';
    var miniCv = document.createElement('canvas');
    miniCv.width = 108; miniCv.height = 108;
    miniCv.className = 'sg5-minicv';
    mini.appendChild(miniCv);
    UI.miniCv = miniCv;
    UI.miniCtx = miniCv.getContext('2d');
    tr.appendChild(mini);
    var clock = el('div', 'sg5-clock');
    UI.phaseEl = el('div', 'sg5-phase', '白天');
    UI.clockEl = el('div', 'sg5-ctime', '12:00');
    UI.shardEl = el('div', 'sg5-shards');   // 注意：不要在这里塞初始文字，下面还会 append span
    var shardIcon = svgIcon(ICONS.star, 12);
    shardIcon.setAttribute('class', 'sg5-ic');
    UI.shardEl.insertBefore(shardIcon, UI.shardEl.firstChild);
    var shardTxt = el('span', null, '0');
    UI.shardEl.appendChild(shardTxt);
    UI.shardTxt = shardTxt;
    clock.appendChild(UI.phaseEl);
    clock.appendChild(UI.clockEl);
    clock.appendChild(UI.shardEl);
    tr.appendChild(clock);
    hud.appendChild(tr);

    // ---- 顶部 区域名 + 目标 ----
    UI.zoneEl = el('div', 'sg5-zone', '拾光镇');
    hud.appendChild(UI.zoneEl);
    UI.goalEl = el('div', 'sg5-goal');
    hud.appendChild(UI.goalEl);

    // ---- Boss 血条 ----
    var boss = el('div', 'sg5-boss');
    UI.bossName = el('div', 'sg5-bossname', '');
    var bb = el('div', 'sg5-bossbar');
    UI.bossFill = el('i');
    bb.appendChild(UI.bossFill);
    boss.appendChild(UI.bossName);
    boss.appendChild(bb);
    UI.bossEl = boss;
    hud.appendChild(boss);

    // ---- 摇杆 ----
    var joy = el('div', 'sg5-joy');
    var knob = el('div', 'sg5-knob');
    joy.appendChild(knob);
    hud.appendChild(joy);
    UI.joy = joy;

    // ---- 动作按钮 ----
    var acts = el('div', 'sg5-actions');
    UI.btnAtk = actionBtn(acts, 'attack', ICONS.sword, '攻击', 'J');
    UI.btnRoll = actionBtn(acts, 'roll', ICONS.roll, '翻滚', 'K');
    UI.btnSkill = actionBtn(acts, 'skill', ICONS.spark, '技能', 'L');
    UI.btnUse = actionBtn(acts, 'use', ICONS.hand, '交互', 'E');
    hud.appendChild(acts);

    // ---- 侧边功能 ----
    var dock = el('div', 'sg5-dock');
    dockBtn(dock, 'char', ICONS.user, '角色', 'C');
    dockBtn(dock, 'bag', ICONS.bag, '背包', 'B');
    dockBtn(dock, 'map', ICONS.map, '地图', 'M');
    dockBtn(dock, 'dex', ICONS.book, '图鉴', 'V');
    dockBtn(dock, 'talent', ICONS.star, '天赋', 'T');
    dockBtn(dock, 'help', ICONS.gear, '设置', 'Esc');
    hud.appendChild(dock);
    UI.dock = dock;

    // ---- toast / feed ----
    UI.toastEl = el('div', 'sg5-toast');
    hud.appendChild(UI.toastEl);
    UI.feedEl = el('div', 'sg5-feed');
    hud.appendChild(UI.feedEl);

    // ---- 面板容器 ----
    UI.panelWrap = el('div', 'sg5-panels');
    hud.appendChild(UI.panelWrap);

    // ---- 死亡遮罩 ----
    var dead = el('div', 'sg5-dead');
    dead.appendChild(el('div', 'sg5-dead-title', '你倒下了'));
    dead.appendChild(el('div', 'sg5-dead-sub', '长夜没有结束 —— 回到灯边，再来一次。'));
    var rbtn = el('button', 'sg5-dead-btn', '在拾光镇醒来');
    rbtn.type = 'button';
    rbtn.addEventListener('click', function () { apiRespawn(); }, false);
    dead.appendChild(rbtn);
    UI.deadEl = dead;
    hud.appendChild(dead);

    // ---- 章节卡 ----
    var ch = el('div', 'sg5-chapter');
    UI.chTitle = el('div', 'sg5-ch-title', '');
    UI.chText = el('div', 'sg5-ch-text', '');
    ch.appendChild(UI.chTitle);
    ch.appendChild(UI.chText);
    UI.chEl = ch;
    hud.appendChild(ch);

    bindButtons(acts, dock);
  }

  function bar(kind, parent) {
    var w = el('div', 'sg5-bar sg5-bar-' + kind);
    var fill = el('i');
    var txt = el('span', 'sg5-bartxt', '');
    w.appendChild(fill);
    w.appendChild(txt);
    parent.appendChild(w);
    return { wrap: w, fill: fill, txt: txt };
  }

  function actionBtn(parent, name, icon, label, key) {
    var b = el('button', 'sg5-act sg5-act-' + name);
    b.type = 'button';
    b.setAttribute('data-act', name);
    var svg = svgIcon(icon, 24);
    svg.setAttribute('class', 'sg5-actic');
    b.appendChild(svg);
    b.appendChild(el('span', 'sg5-actkey', key));
    b.setAttribute('aria-label', label);
    parent.appendChild(b);
    return b;
  }

  function dockBtn(parent, name, icon, label, key) {
    var b = el('button', 'sg5-dockbtn');
    b.type = 'button';
    b.setAttribute('data-panel', name);
    var svg = svgIcon(icon, 17);
    svg.setAttribute('class', 'sg5-dockic');
    b.appendChild(svg);
    b.appendChild(el('span', 'sg5-docklabel', label));
    b.setAttribute('title', label + '（' + key + '）');
    parent.appendChild(b);
    return b;
  }

  // 按钮按住就连续触发（普攻连段靠这个）
  function bindButtons(acts, dock) {
    var downAt = {};
    function press(name, e) {
      if (name === 'attack') { IN.attack = 1; }
      else if (name === 'roll') { IN.roll = 1; }
      else if (name === 'skill') { IN.skill = 1; }
      else if (name === 'use') { IN.use = 1; }
      if (e && e.preventDefault) e.preventDefault();
      auResume();
    }
    var onDown = function (e) {
      var t = e.target;
      while (t && t !== acts && !t.getAttribute('data-act')) t = t.parentNode;
      if (!t || t === acts) return;
      press(t.getAttribute('data-act'), e);
    };
    acts.addEventListener('touchstart', onDown, { passive: false });
    acts.addEventListener('mousedown', onDown, false);

    var onDock = function (e) {
      var t = e.target;
      while (t && t !== dock && !t.getAttribute('data-panel')) t = t.parentNode;
      if (!t || t === dock) return;
      openPanel(t.getAttribute('data-panel'));
      e.preventDefault();
    };
    dock.addEventListener('click', onDock, false);
  }

  // ---- 数值刷新 ----
  function uiUpdate() {
    var me = S.me;
    if (!me) return;
    var hpF = clamp(me.hp / (me.maxHp || 1), 0, 1);
    var mpF = clamp((me.mp || 0) / (me.maxMp || 1), 0, 1);
    var xpF = clamp((me.xp || 0) / (me.xpNext || 1), 0, 1);
    UI.hpBar.fill.style.width = (hpF * 100).toFixed(1) + '%';
    UI.mpBar.fill.style.width = (mpF * 100).toFixed(1) + '%';
    UI.xpBar.fill.style.width = (xpF * 100).toFixed(1) + '%';
    setText(UI.hpBar.txt, Math.round(me.hp) + ' / ' + Math.round(me.maxHp));
    setText(UI.lvEl, 'Lv.' + (me.lv || 1));
    setText(UI.nameEl, me.name || '旅人');
    setText(UI.shardTxt, fmt(me.shards));

    // 时钟：游戏内一天 12 分钟，映射到 24 小时
    var hh = Math.floor(S.pf * 24), mm = Math.floor((S.pf * 24 - hh) * 60);
    setText(UI.clockEl, pad2(hh) + ':' + pad2(mm));
    var pname = { day: '白天', dusk: '黄昏', night: '长夜', dawn: '黎明' }[S.phase] || '白天';
    setText(UI.phaseEl, pname);
    UI.phaseEl.className = 'sg5-phase sg5-phase-' + S.phase;
    UI.zoneEl.className = 'sg5-zone sg5-z-' + S.zone;
  }

  function pad2(n) { return n < 10 ? '0' + n : String(n); }

  // ---- toast ----
  var toastTimer = 0;
  function toast(text, kind) {
    if (!text || !UI.toastEl) return;
    UI.toastEl.textContent = text;
    UI.toastEl.className = 'sg5-toast is-on' + (kind ? ' sg5-toast-' + kind : '');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      UI.toastEl.className = 'sg5-toast';
    }, 1900);
  }

  // ---- 世界频道（点灯 / 首杀 / 传说） ----
  function feedPush(text, kind) {
    S.feed.unshift({ text: text, kind: kind || '', at: Date.now() });
    if (S.feed.length > 6) S.feed.pop();
    renderFeed();
  }
  function renderFeed() {
    if (!UI.feedEl) return;
    clearNode(UI.feedEl);
    for (var i = 0; i < S.feed.length && i < 5; i++) {
      var f = S.feed[i];
      var row = el('div', 'sg5-feedrow' + (f.kind ? ' sg5-feed-' + f.kind : ''), f.text);
      UI.feedEl.appendChild(row);
    }
  }

  // ---- 区域名横幅 ----
  function showZone(name) {
    if (!UI.zoneEl) return;
    UI.zoneEl.textContent = name;
    UI.zoneEl.className = 'sg5-zone is-in sg5-z-' + S.zone;
    setTimeout(function () {
      if (UI.zoneEl) UI.zoneEl.className = 'sg5-zone sg5-z-' + S.zone;
    }, 2600);
  }

  // ---- 目标指引 ----
  function uiGoal() {
    if (!UI.goalEl) return;
    var g = S.goal;
    if (!g) {
      UI.goalEl.textContent = '全部灯塔都亮了。长夜之心在等你。';
      UI.goalEl.className = 'sg5-goal is-done';
      return;
    }
    var me = S.me;
    var d = me ? Math.round(dist(me.x, me.y, g.x, g.y)) : 0;
    UI.goalEl.textContent = '点亮' + g.name + '的灯塔 · ' + d + ' 格 · 守护者：' + (g.boss || '未知');
    UI.goalEl.className = 'sg5-goal';
  }

  // ---- 章节卡 ----
  function showChapter(idx) {
    var c = CHAPTERS[idx];
    if (!c || !UI.chEl) return;
    UI.chTitle.textContent = c.title;
    UI.chText.textContent = c.text;
    UI.chEl.className = 'sg5-chapter is-on';
    auSfx('success', 0.5, 1);
    setTimeout(function () {
      UI.chEl.className = 'sg5-chapter';
    }, 5200);
  }

  // ---- 头像（从图集里裁一张脸） ----
  function drawFace(look) {
    var f = FR['face_' + look] || FR['face_NinjaBlue'];
    if (!f || !UI.faceCv) return;
    var g = UI.faceCv.getContext('2d');
    g.imageSmoothingEnabled = false;
    g.clearRect(0, 0, 48, 48);
    g.drawImage(S.atlas, f[0], f[1], f[4], f[5], 0, 0, 48, 48);
  }

  // ---- 小地图每帧 ----
  function uiMini() {
    if (!UI.miniCtx || !MINI.base || !S.me) return;
    drawMiniMap(UI.miniCtx, 0, 0, 108, 26);
  }
