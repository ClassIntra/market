// ==================== 19_lore 《灯火纪》世界观与剧情（v5.7） ====================
// 职责：lore 文本下发与缓存、遗物收集交互、lore 阅读卡、灯语仪式卡、栗的独白、终章触发。
// 设计：卡片独立于面板系统（curPanel 单例），叠在世界层上；阅读不打断世界运行。

var loreState = { loaded: false, data: null, wrap: null };
var LORE_NIGHT_ZONE_ORDER = ['town', 'meadow', 'forest', 'swamp', 'crag', 'frost', 'abyss'];
var LORE_NIGHT_ALL = [];   // /v5/lore 下发的夜语元数据（id/坐标/zone，正文只在收集后）

function loreLoad() {
  return apiGet('/shiguang/v5/lore').then(function (d) {
    loreState.data = d || {};
    S.loreCollected = d.collected || [];
    // v5.8 夜语：今晚浮现集 + 已收集（私密，无广播）
    S.loreNightCollected = d.nightCollected || [];
    S.loreNightPick = d.nightPick || [];
    S.keeperAfterLines = d.keeperAfter || [];
    LORE_NIGHT_ALL = d.nights || [];
    loreState.loaded = true;
  }).catch(function () { /* 拉不到不阻塞游戏；图鉴里显示「暂未载入」 */ });
}

// 进世界后拉一次（重连也会刷新，收集进度以服务端为准）
var _applyEnterLore = applyEnter;
applyEnter = function (d) {
  _applyEnterLore(d);
  loreLoad();
  // v5.8：守夜仪式现场恢复（服务端权威，客户端只做显示与举灯动作）
  S.finale = d.finale || { open: 0, done: 0, waiters: 0, meWaiting: 0, roster: null };
  // 终章触发改造（v5.8）：删「goal 归空自动放章节卡」—— 终章由 finale-done 事件触发一次。
  // 若进场时仪式已完成但本场没看过名录，补播一次终幕序列（幂等：本会话只放一遍）。
  try {
    if (S.finale && S.finale.done && !S.finaleCardShown) {
      S.finaleCardShown = 1;
      try { S.storage.set('finale', '1'); } catch (e) {}
      setTimeout(function () { finalePlaySequence(); }, 1200);
    }
  } catch (e) {}
};

// ---------- 世界层遗物：走近按 E ----------
function loreOpenRelic(relic) {
  apiPost('/shiguang/v5/lore/collect', { id: relic.id }).then(function (r) {
    S.loreCollected = r.collected || S.loreCollected;
    var fresh = S.loreCollected.indexOf(relic.id) >= 0;
    var diary = r.diary || {};
    var first = fresh && !loreState._seen;
    loreState._seen = 1;
    loreCard(diary.title || '守塔人遗物', diary.zone ? ZONE_NAMES[diary.zone] || '' : '', diary.text || '', first);
    if (first) {
      toast('收下了「' + (diary.title || '守塔人遗物') + '」—— 图鉴·世界 可重读', 'good');
      auSfx('secret', 0.4, 1.1);
    }
  }).catch(function (e) { toast(e.message || '读完这一页需要一点时间，再试一次', 'warn'); });
}

// ---------- 世界层夜语：夜间同点浮现，走近按 E（phase 门控在 doInteract） ----------
function loreOpenNight(nyx) {
  apiPost('/shiguang/v5/lore/collect', { id: nyx.id, kind: 'night' }).then(function (r) {
    S.loreNightCollected = r.nightCollected || S.loreNightCollected;
    var got = S.loreNightCollected.indexOf(nyx.id) >= 0;
    var n = r.night || {};
    var first = got && !loreState._nightSeen;
    loreState._nightSeen = 1;
    loreCard(n.title || '夜语', '没能等到天亮的人 · 留下的半页话', n.text || '', 'night');
    if (first) {
      toast('夜语已收进图鉴 —— 只有你听见了它', 'good');
      auSfx('secret', 0.35, 0.85);
    }
  }).catch(function (e) { toast(e.message || '夜里的话听不清，再试一次', 'warn'); });
}

// ---------- 终幕序列：finale 灯语 → 终章章节卡 → 灯火名录 → 引导回守灯人之家 ----------
function finalePlaySequence() {
  var d = loreState.data || {};
  loreCard('终章 · 灯火名录', '第一代大守塔人 拾', d.finale || '', 'lamp');
  auSfx('spirit', 0.45, 0.9);
  setTimeout(function () {
    try { showChapter(8); } catch (e) {}
  }, 4200);
  setTimeout(function () {
    if (S.finale && S.finale.roster) loreRosterCard(S.finale.roster);
    toast('去守灯人之家 —— 栗在等你们', 'good');
  }, 9200);
}

// ---------- 灯火名录卡：拾 → 七代守塔人 → 全班（滚入节奏见 v5.8 视觉规范） ----------
function loreRosterCard(roster) {
  var wrap = loreWrap();
  clearNode(wrap);
  var card = el('div', 'sg5-roster');
  card.appendChild(el('div', 'sg5-roster-head', '灯火名录'));
  var first = el('div', 'sg5-roster-first', '拾');
  first.style.animationDelay = '150ms';
  card.appendChild(first);
  var keepers = ['宁 · 晨光草原', '哑叔 · 雾隐林', '阿潮 · 萤火泽', '石翁 · 星坠岩', '孩子们 · 霜屿', '栗 · 拾光镇', '拾 · 长夜之心'];
  for (var i = 0; i < keepers.length; i++) {
    var kr = el('div', 'sg5-roster-keeper', keepers[i]);
    kr.style.animationDelay = (400 + i * 140) + 'ms';
    card.appendChild(kr);
  }
  var sep = el('div', 'sg5-roster-sep');
  sep.style.animationDelay = '1480ms';
  card.appendChild(sep);
  var cls = el('div', 'sg5-roster-class');
  var names = (roster && roster.keepers) || [];
  var later = (roster && roster.later) || [];
  var all = names.concat(later);
  for (var j = 0; j < all.length; j++) {
    var nm = el('span', 'sg5-roster-name', all[j] + (j < all.length - 1 ? ' ·' : ''));
    nm.style.animationDelay = (1600 + Math.min(j * 60, 800)) + 'ms';
    cls.appendChild(nm);
  }
  card.appendChild(cls);
  var note = el('div', 'sg5-roster-note', names.length + ' 人守了这一夜 · ' + later.length + ' 人后来到了');
  card.appendChild(note);
  card.appendChild(uiBtn('合上名册', 'sg5-btn', function () { loreCardClose(); auSfx('accept', 0.35, 1.0); }));
  wrap.appendChild(card);
  wrap.className = 'sg5-lore is-on';
  auSfx('gold', 0.45, 1.0);
}

// ---------- 阅读卡（复用面板框语言，独立于 curPanel） ----------
function loreWrap() {
  if (!loreState.wrap) {
    loreState.wrap = el('div', 'sg5-lore');
    UI.hud.appendChild(loreState.wrap);
    loreState.wrap.addEventListener('click', function (ev) {
      if (ev.target === loreState.wrap) loreCardClose();
    }, false);
  }
  return loreState.wrap;
}

function loreCardClose() {
  if (loreState.wrap) {
    loreState.wrap.className = 'sg5-lore';
    setTimeout(function () {
      if (loreState.wrap && loreState.wrap.className.indexOf('is-on') < 0) clearNode(loreState.wrap);
    }, 260);
  }
}

// kind: 'diary' 日记页（含收下按钮） | 'lamp' 灯语仪式卡（更庄重，自动可关） | 'plain' 栗的独白等
//      | 'night' 夜语残页卡（v5.8：冷底夜卡，容器加 .is-night）
function loreCard(title, sub, text, kind) {
  var wrap = loreWrap();
  clearNode(wrap);
  var card = el('div', 'sg5-lorecard' + (kind === 'lamp' ? ' sg5-lampword' : '') + (kind === 'night' ? ' sg5-nightcard' : ''));
  card.appendChild(el('div', 'sg5-lorecard-title', title || ''));
  if (sub) card.appendChild(el('div', 'sg5-lorecard-sub', sub));
  var body = el('div', 'sg5-lorecard-text', text || '');
  card.appendChild(body);
  if (kind === 'lamp') {
    card.appendChild(el('div', 'sg5-lorecard-note', '这一晚，请和整个班一起记住。'));
    var b1 = uiBtn('记住这一晚', 'sg5-btn-primary', function () { loreCardClose(); auSfx('accept', 0.35, 1.0); });
    card.appendChild(b1);
  } else if (kind === 'night') {
    card.appendChild(el('div', 'sg5-lorecard-note', '—— 夜里的话，只有夜听得见。'));
    card.appendChild(uiBtn('把这一页收好', 'sg5-btn-primary', function () { loreCardClose(); auSfx('secret', 0.4, 0.85); }));
  } else {
    card.appendChild(uiBtn(kind === 'diary' ? '收下这一页' : '合上', 'sg5-btn', function () { loreCardClose(); }));
  }
  wrap.appendChild(card);
  wrap.className = 'sg5-lore is-on' + (kind === 'night' ? ' is-night' : '');
  var firstBtn = card.querySelector('button');
  if (firstBtn) { try { firstBtn.focus(); } catch (e) {} }
}

// ---------- 灯语仪式卡（点亮灯塔的瞬间，全班同时看到） ----------
var _handleEventLore = handleEvent;
handleEvent = function (e) {
  if (e && e.k === 'lampword') {
    var zn = e.n || (ZONE_NAMES[e.z] || '');
    loreCard(e.z === 'finale' ? '终章 · 灯火名录' : zn + ' · 灯语', e.z === 'finale' ? '第一代大守塔人 拾' : '守塔人的最后一句话', e.t, 'lamp');
    auSfx('spirit', 0.45, e.z === 'finale' ? 0.9 : 1.15);
    auSfx('bonus', 0.3, 1.0);
    S.cam.shake = Math.max(S.cam.shake || 0, 2.2);
    return;
  }
  // v5.8 守夜仪式：开场广播 / 完成名录
  if (e && e.k === 'finale-open') {
    S.finale = S.finale || {};
    S.finale.open = 1; S.finale.done = 0;
    toast(e.hint || '到长夜之心的塔下举灯 —— 一起守到天亮', 'warn');
    auSfx('menu', 0.4, 0.9);
    return;
  }
  if (e && e.k === 'finale-done') {
    S.finale = S.finale || {};
    S.finale.done = 1; S.finale.open = 0;
    S.finale.roster = e.roster || S.finale.roster;
    if (!S.finaleCardShown) {
      S.finaleCardShown = 1;
      try { S.storage.set('finale', '1'); } catch (e2) {}
      finalePlaySequence();
    }
    return;
  }
  return _handleEventLore(e);
};

// ---------- 栗的独白（守灯人之家「听她说话」） ----------
// v5.8 keeperAfter（栗的暗线）：at:7 在 abyss 塔亮后、守夜仪式完成前（终章引子）；
// at:8 严格在 S.finale.done 后（仪式→名录→饭桌的收束）。各幂等，未完成仪式永不触发。
function loreKeeperLine() {
  var lit = Object.keys(S.towers || {}).length;
  var after = S.keeperAfterLines || [];
  if (S.finale && S.finale.done && after.length >= 2 && !S.keeperAfter8Seen) {
    S.keeperAfter8Seen = 1;
    try { S.storage.set('ka8', '1'); } catch (e) {}
    return after[1].text;
  }
  if (S.towers && S.towers.abyss && after.length >= 1 && !S.keeperAfter7Seen) {
    S.keeperAfter7Seen = 1;
    try { S.storage.set('ka7', '1'); } catch (e) {}
    return after[0].text;
  }
  var lines = (loreState.data && loreState.data.keeperLines) || [];
  var pick = null;
  for (var i = 0; i < lines.length; i++) if (lines[i].at <= lit) pick = lines[i];
  return pick ? pick.text : '「灯还亮着。去把剩下的点亮 —— 我在这儿等你们回来吃晚饭。」';
}

// ---------- 图鉴「世界」页签渲染（PANELS.dex 调用） ----------
function loreWorldTab(body) {
  var d = loreState.data;
  if (!d) {
    body.appendChild(el('div', 'sg5-empty', '世界还没载入，稍后再来翻一翻。'));
    return;
  }
  var lit = Object.keys(S.towers || {}).length;

  // 编年史：按点灯进度解锁
  body.appendChild(el('div', 'sg5-sect', '编年史'));
  for (var i = 0; i < d.codex.length; i++) {
    var cx = d.codex[i];
    var open = lit >= cx.at;
    var box = el('div', 'sg5-lorew-row' + (open ? ' is-have' : ' is-off'));
    box.appendChild(el('div', 'sg5-lorew-title', open ? cx.title : '？？？（点亮 ' + cx.at + ' 座灯塔后解锁）'));
    if (open) box.appendChild(el('div', 'sg5-lorew-text', cx.text));
    body.appendChild(box);
  }

  // 守塔人日记与夜语：同域上下对照（昼上夜下，翻图鉴就是翻一枚硬币的两面）
  var nightById = {};
  var nightsData = (loreState.data && loreState.data.nights) || [];
  for (var nix = 0; nix < nightsData.length; nix++) nightById[nightsData[nix].id] = nightsData[nix];
  var zoneStat = {};
  for (var dz = 0; dz < d.diaries.length; dz++) {
    var zd = d.diaries[dz].zone;
    zoneStat[zd] = zoneStat[zd] || { day: 0, night: 0, tot: 0, ntot: 0 };
    zoneStat[zd].tot++;
    zoneStat[zd].ntot++;
    if ((S.loreCollected || []).indexOf(d.diaries[dz].id) >= 0) zoneStat[zd].day++;
  }
  for (var nz = 0; nz < LORE_NIGHT_ZONE_ORDER.length; nz++) {
    var zkey = LORE_NIGHT_ZONE_ORDER[nz];
    if (!zoneStat[zkey]) continue;
    var st = zoneStat[zkey];
    var zhead = el('div', 'sg5-lorew-zone', (ZONE_NAMES[zkey] || zkey) + ' · 昼 ' + st.day + '/' + st.tot + ' · 夜 ' + st.night + '/' + st.ntot);
    zhead.setAttribute('data-zone', zkey);
    body.appendChild(zhead);
    for (var di = 0; di < d.diaries.length; di++) {
      var dy = d.diaries[di];
      if (dy.zone !== zkey) continue;
      var got = (S.loreCollected || []).indexOf(dy.id) >= 0;
      var row = el('div', 'sg5-lorew-row' + (got ? ' is-have' : ' is-off'));
      var t1 = el('div', 'sg5-lorew-title');
      t1.appendChild(el('span', 'sg5-face is-day', '昼'));
      t1.appendChild(document.createTextNode(got ? ' ' + dy.title : ' 一页未寻得的日记'));
      row.appendChild(t1);
      if (got) {
        row.appendChild(el('div', 'sg5-lorew-text', dy.text));
      } else {
        row.appendChild(el('div', 'sg5-lorew-text sg5-lorew-hint', '在这片区域的草丛、林间与岩缝里，找一块碑顶发亮的石碑。'));
      }
      body.appendChild(row);
      // 配对夜语（夜下）：未收集只给暗示，正文永不进 DOM（防剧透）
      var pairId = 'y_' + dy.id.slice(2);
      var nq = nightById[pairId];
      var nGot = nq && (S.loreNightCollected || []).indexOf(pairId) >= 0;
      if (nq) {
        var nrow = el('div', 'sg5-lorew-row is-night' + (nGot ? ' is-have' : ' is-off'));
        var t2 = el('div', 'sg5-lorew-title');
        t2.appendChild(el('span', 'sg5-face is-night', '夜'));
        t2.appendChild(document.createTextNode(nGot ? ' ' + nq.title : ' 一页未听过的夜语'));
        nrow.appendChild(t2);
        if (nGot && nq.text) nrow.appendChild(el('div', 'sg5-lorew-text', nq.text));
        else if (!nGot) nrow.appendChild(el('div', 'sg5-lorew-text sg5-lorew-hint', '入夜后，这里还有别的话。'));
        body.appendChild(nrow);
      }
    }
  }
  // 夜语收集计数修正（组头一次性算准；按 data-zone 匹配，不依赖对象键顺序）
  var nCount = {};
  var ncList = S.loreNightCollected || [];
  for (var nc = 0; nc < ncList.length; nc++) nCount[ncList[nc]] = 1;
  var zrows = body.querySelectorAll('.sg5-lorew-zone');
  for (var zr = 0; zr < zrows.length; zr++) {
    var zk2 = zrows[zr].getAttribute('data-zone');
    if (!zk2 || !zoneStat[zk2]) continue;
    var nTot = 0, nGot2 = 0;
    for (var q = 0; q < LORE_NIGHT_ALL.length; q++) {
      if (LORE_NIGHT_ALL[q].zone !== zk2) continue;
      nTot++;
      if (nCount[LORE_NIGHT_ALL[q].id]) nGot2++;
    }
    zoneStat[zk2].ntot = nTot;
    zrows[zr].textContent = (ZONE_NAMES[zk2] || zk2) + ' · 昼 ' + zoneStat[zk2].day + '/' + zoneStat[zk2].tot + ' · 夜 ' + nGot2 + '/' + nTot;
  }

  // 风物志：按点亮进度逐步解锁（塔亮 = 真正「到过」那片地）
  body.appendChild(el('div', 'sg5-sect', '风物志'));
  var gz = d.gazetteer || {};
  Object.keys(gz).forEach(function (zk) {
    var g = gz[zk];
    var open = zk === 'town' || !!S.towers[zk];
    var row = el('div', 'sg5-lorew-row' + (open ? ' is-have' : ' is-off'));
    row.appendChild(el('div', 'sg5-lorew-title', open ? g.title : (ZONE_NAMES[zk] || zk) + ' · 未踏足'));
    if (open) row.appendChild(el('div', 'sg5-lorew-text', g.text));
    body.appendChild(row);
  });

  // 灯火名录（终章后永久呈现 —— 已写进世界的东西不再动）
  if (S.finale && S.finale.done && S.finale.roster) {
    body.appendChild(el('div', 'sg5-sect', '灯火名录'));
    var mini = el('div', 'sg5-roster-mini');
    mini.appendChild(el('div', 'sg5-roster-mini-first', '拾'));
    mini.appendChild(el('div', 'sg5-roster-mini-keepers', '宁 · 哑叔 · 阿潮 · 石翁 · 霜屿的孩子们 · 栗'));
    var all2 = ((S.finale.roster.keepers) || []).concat((S.finale.roster.later) || []);
    mini.appendChild(el('div', 'sg5-roster-mini-class', all2.join(' · ')));
    body.appendChild(mini);
  }
}
