  // ---------------- §15 HUD ----------------
  // HUD 全是 DOM：数字要清晰、要能被主题影响。但视觉上它必须像「游戏里的木牌」，
  // 而不是网页卡片 —— 厚边、方角、点阵字、分段条。样式见 style.css 的 .sg5-frame。
  var UI = {};

  // 把图集里的一帧画进小 canvas（HUD 图标统一走这里，风格才一致）
  function iconCanvas(name, size) {
    var cv = document.createElement('canvas');
    cv.width = size; cv.height = size;
    cv.setAttribute('data-icon', name);
    paintIcon(cv, name, size);
    return cv;
  }
  function paintIcon(cv, name, size) {
    var g = cv.getContext('2d');
    g.imageSmoothingEnabled = false;
    g.clearRect(0, 0, size, size);
    if (name.indexOf('glyph:') === 0) { paintGlyph(g, name.slice(6), size); return; }
    var f = FR[name];
    if (!f || !S.atlas) return;
    var s = Math.min(size / f[4], size / f[5]);
    var w = Math.round(f[4] * s), h = Math.round(f[5] * s);
    var dx = Math.round((size - w) / 2), dy = Math.round((size - h) / 2);
    g.drawImage(S.atlas, f[0], f[1], f[4], f[5], dx, dy, w, h);
    // 素材里有一部分帧用「品红」当透明底。不去掉的话图标会顶着一块洋红。
    try {
      var img = g.getImageData(dx, dy, w, h);
      var d = img.data;
      for (var i = 0; i < d.length; i += 4) {
        if (d[i] > 190 && d[i + 2] > 190 && d[i + 1] < 90) d[i + 3] = 0;
      }
      g.putImageData(img, dx, dy);
    } catch (e) {}
  }

  // 程序化像素字形：图集里没有的图标（齿轮 / 手 / 靴子）用 1px 方格拼出来，
  // 和素材的风格一致，也不用再往包里塞图。
  var GLYPH = {
    gear: [
      '..##..##..',
      '..######..',
      '.########.',
      '.###..###.',
      '####..####',
      '####..####',
      '.###..###.',
      '.########.',
      '..######..',
      '..##..##..'
    ],
    // 剑：竖刃 + 十字护手 + 柄，12×14，38px 下也一眼能认出
    sword: [
      '.....##.....',
      '....####....',
      '....####....',
      '....####....',
      '....####....',
      '....####....',
      '....####....',
      '..########..',
      '....####....',
      '.....##.....',
      '.....##.....',
      '.....##.....',
      '....####....',
      '.....##.....'
    ],
    lance: [
      '.........##.',
      '........####',
      '.......####.',
      '......####..',
      '.....####...',
      '....####....',
      '...####.....',
      '..####......',
      '.##.........',
      '##..........'
    ],
    twin: [
      '..##....##..',
      '..##....##..',
      '..##....##..',
      '..##....##..',
      '...##..##...',
      '....####....',
      '.....##.....',
      '....####....',
      '...##..##...',
      '..##....##..'
    ],
    staff: [
      '.....###....',
      '....#####...',
      '...###.###..',
      '....#####...',
      '.....###....',
      '......#.....',
      '......#.....',
      '......#.....',
      '......#.....',
      '......#.....'
    ],
    hammer: [
      '...######...',
      '...######...',
      '...######...',
      '......#.....',
      '......#.....',
      '......#.....',
      '......#.....',
      '......#.....',
      '......#.....',
      '......#.....'
    ],
    // 翻滚：一个侧翻的弧线 + 箭头（读作「往那边滚」）
    roll: [
      '...#####....',
      '..##...##...',
      '.##.....##..',
      '.##.........',
      '.##.........',
      '.##.....##..',
      '..##...##...',
      '...#####..##',
      '..........##',
      '..........#.'
    ]
  };

  function paintGlyph(g, kind, size) {
    var rows = GLYPH[kind];
    if (!rows) return;
    var h = rows.length, w = rows[0].length;
    var s = Math.max(1, Math.floor(size / (w + 2)));
    var ox = Math.round((size - w * s) / 2), oy = Math.round((size - h * s) / 2);
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        if (rows[y].charAt(x) !== '#') continue;
        // 上亮下暗，做出金属感
        var tone = y < h * 0.45 ? '#e8dcc0' : (y < h * 0.75 ? '#b9a988' : '#8b7c60');
        g.fillStyle = tone;
        g.fillRect(ox + x * s, oy + y * s, s, s);
      }
    }
  }

  function uiBuild(root) {
    var hud = el('div', 'sg5-hud');
    root.appendChild(hud);
    UI.hud = hud;

    // ---- 左上 角色牌 ----
    var status = el('div', 'sg5-status sg5-frame');
    var face = el('div', 'sg5-face');
    var faceCv = document.createElement('canvas');
    faceCv.width = 52; faceCv.height = 52;
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

    // ---- 右上 小地图 + 日晷 ----
    var tr = el('div', 'sg5-topright');
    var mini = el('div', 'sg5-mini sg5-frame');
    var miniCv = document.createElement('canvas');
    miniCv.width = 124; miniCv.height = 124;
    miniCv.className = 'sg5-minicv';
    mini.appendChild(miniCv);
    mini.appendChild(el('div', 'sg5-compass', 'N'));
    UI.miniCv = miniCv;
    UI.miniCtx = miniCv.getContext('2d');
    UI.zoneLabel = el('div', 'sg5-zonelabel', '拾光镇');
    mini.appendChild(UI.zoneLabel);
    tr.appendChild(mini);

    var clock = el('div', 'sg5-clock sg5-frame');
    UI.phaseEl = el('div', 'sg5-phase', '白天');
    UI.clockEl = el('div', 'sg5-ctime', '12:00');
    UI.shardEl = el('div', 'sg5-shards');
    var coin = document.createElement('canvas');
    coin.width = 16; coin.height = 16;
    coin.className = 'sg5-ic';
    coin.setAttribute('data-icon', 'it_coin');
    UI.coinCv = coin;
    UI.shardEl.appendChild(coin);
    UI.shardTxt = el('span', null, '0');
    UI.shardEl.appendChild(UI.shardTxt);
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
    var boss = el('div', 'sg5-boss sg5-frame');
    UI.bossName = el('div', 'sg5-bossname', '');
    var bb = el('div', 'sg5-bossbar');
    UI.bossFill = el('i');
    bb.appendChild(UI.bossFill);
    boss.appendChild(UI.bossName);
    boss.appendChild(bb);
    UI.bossEl = boss;
    hud.appendChild(boss);

    // ---- 队伍 ----
    UI.partyEl = el('div', 'sg5-party');
    hud.appendChild(UI.partyEl);

    // ---- 潮汐横幅 ----
    var tide = el('div', 'sg5-tide sg5-frame');
    UI.tideName = el('div', 'sg5-tide-name', '');
    UI.tideSub = el('div', 'sg5-tide-sub', '');
    tide.appendChild(UI.tideName);
    tide.appendChild(UI.tideSub);
    UI.tideEl = tide;
    hud.appendChild(tide);

    // ---- 摇杆 ----
    var joy = el('div', 'sg5-joy');
    var knob = el('div', 'sg5-knob');
    joy.appendChild(knob);
    hud.appendChild(joy);
    UI.joy = joy;

    // ---- 动作键 ----
    var acts = el('div', 'sg5-actions');
    UI.btnAtk = actionBtn(acts, 'attack', 'glyph:sword', '攻击', 'J', 40);
    UI.btnRoll = actionBtn(acts, 'roll', 'glyph:roll', '翻滚', 'K', 30);
    UI.btnSkill = actionBtn(acts, 'skill', 'fx_energy', '技能', 'L', 28);
    UI.btnUse = actionBtn(acts, 'use', 'it_key', '交互', 'E', 24);
    UI.skillCd = el('i', 'sg5-cd');
    UI.btnSkill.appendChild(UI.skillCd);
    hud.appendChild(acts);

    // ---- 底部功能槽 ----
    var dock = el('div', 'sg5-dock');
    dockBtn(dock, 'char', 'face_NinjaBlue', '角色', 'C');
    dockBtn(dock, 'bag', 'it_chest', '背包', 'B');
    dockBtn(dock, 'map', 'obj_ScrollEmpty', '地图', 'M');
    dockBtn(dock, 'dex', 'obj_Letter', '图鉴', 'V');
    dockBtn(dock, 'talent', 'it_heart', '天赋', 'T');
    dockBtn(dock, 'help', 'glyph:gear', '设置', 'Esc');
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

    // ---- 死亡 ----
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

  function actionBtn(parent, name, icon, label, key, size) {
    var b = el('button', 'sg5-act sg5-act-' + name);
    b.type = 'button';
    b.setAttribute('data-act', name);
    b.appendChild(iconCanvas(icon, size));
    b.appendChild(el('span', 'sg5-actkey', key));
    b.setAttribute('aria-label', label);
    parent.appendChild(b);
    return b;
  }

  function dockBtn(parent, name, icon, label, key) {
    var b = el('button', 'sg5-dockbtn');
    b.type = 'button';
    b.setAttribute('data-panel', name);
    b.appendChild(iconCanvas(icon, 24));
    b.appendChild(el('span', 'sg5-dockkey', key));
    b.setAttribute('title', label + '（' + key + '）');
    parent.appendChild(b);
    return b;
  }

  function bindButtons(acts, dock) {
    function press(name, e) {
      if (name === 'attack') IN.attack = 1;
      else if (name === 'roll') IN.roll = 1;
      else if (name === 'skill') IN.skill = 1;
      else if (name === 'use') IN.use = 1;
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
    UI.hpBar.fill.style.transform = 'scaleX(' + hpF.toFixed(3) + ')';
    UI.mpBar.fill.style.transform = 'scaleX(' + mpF.toFixed(3) + ')';
    UI.xpBar.fill.style.transform = 'scaleX(' + xpF.toFixed(3) + ')';
    setText(UI.hpBar.txt, Math.round(me.hp) + '/' + Math.round(me.maxHp));
    setText(UI.lvEl, 'Lv.' + (me.lv || 1));
    setText(UI.nameEl, me.name || '旅人');
    setText(UI.shardTxt, fmt(me.shards));

    var hh = Math.floor(S.pf * 24), mm = Math.floor((S.pf * 24 - hh) * 60);
    setText(UI.clockEl, pad2(hh) + ':' + pad2(mm));
    var pname = { day: '白天', dusk: '黄昏', night: '长夜', dawn: '黎明' }[S.phase] || '白天';
    setText(UI.phaseEl, pname);
    UI.phaseEl.className = 'sg5-phase sg5-phase-' + S.phase;
    setText(UI.zoneLabel, ZONE_NAMES[S.zone] || '拾光群岛');

    // 技能冷却遮罩（从下往上退）
    if (me.skillCdUntil && S.time < me.skillCdUntil) {
      var left = (me.skillCdUntil - S.time) / 6;
      UI.skillCd.style.height = (clamp(left, 0, 1) * 100).toFixed(0) + '%';
    } else if (UI.skillCd.style.height && UI.skillCd.style.height !== '0%') {
      UI.skillCd.style.height = '0%';
    }
    uiParty();
    uiTide();
  }

  function pad2(n) { return n < 10 ? '0' + n : String(n); }

  // ---- 队伍面板 ----
  function uiParty() {
    if (!UI.partyEl) return;
    var pt = S.party;
    if (!pt || !pt.members || pt.members.length < 2) {
      if (UI.partyEl.childNodes.length) clearNode(UI.partyEl);
      return;
    }
    clearNode(UI.partyEl);
    for (var i = 0; i < pt.members.length; i++) {
      var m = pt.members[i];
      if (m[0] === S.myId) continue;
      var row = el('div', 'sg5-pt' + (m[4] ? ' is-down' : ''));
      row.appendChild(el('span', 'sg5-pt-name', m[1]));
      var bar2 = el('div', 'sg5-pt-bar');
      var fill = el('i');
      fill.style.transform = 'scaleX(' + clamp(m[2] / (m[3] || 1), 0, 1).toFixed(3) + ')';
      bar2.appendChild(fill);
      row.appendChild(bar2);
      if (m[4]) row.appendChild(el('span', 'sg5-pt-tag', '倒地'));
      UI.partyEl.appendChild(row);
    }
  }

  // ---- 潮汐横幅 ----
  function uiTide() {
    if (!UI.tideEl) return;
    var t = S.tideInfo;
    if (!t) {
      if (UI.tideEl.className.indexOf('is-on') >= 0) UI.tideEl.className = 'sg5-tide sg5-frame';
      return;
    }
    var left = Math.max(0, Math.round((t.until - Date.now()) / 1000));
    UI.tideEl.className = 'sg5-tide sg5-frame is-on';
    setText(UI.tideName, '长夜潮汐 · ' + (ZONE_NAMES[t.zone] || t.zone));
    setText(UI.tideSub, '第 ' + (t.wave || 0) + ' 波 · 还剩 ' + pad2(Math.floor(left / 60)) + ':' + pad2(left % 60) + ' · 到场就有份');
  }

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

  // ---- 世界频道 ----
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
      UI.feedEl.appendChild(el('div', 'sg5-feedrow' + (f.kind ? ' sg5-feed-' + f.kind : ''), f.text));
    }
  }

  function showZone(name) {
    if (!UI.zoneEl) return;
    UI.zoneEl.textContent = name;
    UI.zoneEl.className = 'sg5-zone is-in sg5-z-' + S.zone;
    setTimeout(function () {
      if (UI.zoneEl) UI.zoneEl.className = 'sg5-zone sg5-z-' + S.zone;
    }, 2600);
  }

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

  function showChapter(idx) {
    var c = CHAPTERS[idx];
    if (!c || !UI.chEl) return;
    UI.chTitle.textContent = c.title;
    UI.chText.textContent = c.text;
    UI.chEl.className = 'sg5-chapter is-on';
    auSfx('success', 0.5, 1);
    setTimeout(function () { UI.chEl.className = 'sg5-chapter'; }, 5200);
  }

  function drawFace(look) {
    var f = FR['face_' + look] || FR['face_NinjaBlue'];
    if (!f || !UI.faceCv) return;
    var g = UI.faceCv.getContext('2d');
    g.imageSmoothingEnabled = false;
    g.clearRect(0, 0, 52, 52);
    g.drawImage(S.atlas, f[0], f[1], f[4], f[5], 0, 0, 52, 52);
  }

  function uiMini() {
    if (!UI.miniCtx || !MINI.base || !S.me) return;
    drawMiniMap(UI.miniCtx, 0, 0, 124, 30);
  }

  // 图集到位后补画图标（uiBuild 早于 atlas 加载）
  function uiPaintIcons() {
    if (!S.atlas || !UI.hud) return;
    var list = UI.hud.getElementsByTagName('canvas');
    for (var i = 0; i < list.length; i++) {
      var nm = list[i].getAttribute('data-icon');
      if (nm) paintIcon(list[i], nm, list[i].width);
    }
    if (UI.coinCv) paintIcon(UI.coinCv, 'it_coin', 16);
  }
