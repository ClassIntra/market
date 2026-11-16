// ==================== 19_lore 《灯火纪》世界观与剧情（v5.7） ====================
// 职责：lore 文本下发与缓存、遗物收集交互、lore 阅读卡、灯语仪式卡、栗的独白、终章触发。
// 设计：卡片独立于面板系统（curPanel 单例），叠在世界层上；阅读不打断世界运行。

var loreState = { loaded: false, data: null, wrap: null };

function loreLoad() {
  return apiGet('/shiguang/v5/lore').then(function (d) {
    loreState.data = d || {};
    S.loreCollected = d.collected || [];
    loreState.loaded = true;
  }).catch(function () { /* 拉不到不阻塞游戏；图鉴里显示「暂未载入」 */ });
}

// 进世界后拉一次（重连也会刷新，收集进度以服务端为准）
var _applyEnterLore = applyEnter;
applyEnter = function (d) {
  _applyEnterLore(d);
  loreLoad();
  // 终章：六域 + 长夜之心全亮（goal 归空）且没看过终章 → 触发一次
  try {
    if (!d.goal && Object.keys(S.towers || {}).length >= 7 && !S.seenFinale) {
      S.seenFinale = 1;
      try { S.storage.set('finale', '1'); } catch (e) {}
      setTimeout(function () { showChapter(8); auSfx('spirit', 0.4, 0.9); }, 1200);
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
function loreCard(title, sub, text, kind) {
  var wrap = loreWrap();
  clearNode(wrap);
  var card = el('div', 'sg5-lorecard' + (kind === 'lamp' ? ' sg5-lampword' : ''));
  card.appendChild(el('div', 'sg5-lorecard-title', title || ''));
  if (sub) card.appendChild(el('div', 'sg5-lorecard-sub', sub));
  var body = el('div', 'sg5-lorecard-text', text || '');
  card.appendChild(body);
  if (kind === 'lamp') {
    card.appendChild(el('div', 'sg5-lorecard-note', '这一晚，请和整个班一起记住。'));
    var b1 = uiBtn('记住这一晚', 'sg5-btn-primary', function () { loreCardClose(); auSfx('accept', 0.35, 1.0); });
    card.appendChild(b1);
  } else {
    card.appendChild(uiBtn(kind === 'diary' ? '收下这一页' : '合上', 'sg5-btn', function () { loreCardClose(); }));
  }
  wrap.appendChild(card);
  wrap.className = 'sg5-lore is-on';
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
  return _handleEventLore(e);
};

// ---------- 栗的独白（守灯人之家「听她说话」） ----------
function loreKeeperLine() {
  var lit = Object.keys(S.towers || {}).length;
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

  // 守塔人日记：20 页收集
  body.appendChild(el('div', 'sg5-sect', '守塔人日记 · ' + (S.loreCollected || []).length + ' / ' + d.diaries.length));
  var zoneSeen = {};
  for (var di = 0; di < d.diaries.length; di++) {
    var dy = d.diaries[di];
    if (!zoneSeen[dy.zone]) {
      zoneSeen[dy.zone] = 1;
      body.appendChild(el('div', 'sg5-lorew-zone', ZONE_NAMES[dy.zone] || dy.zone));
    }
    var got = (S.loreCollected || []).indexOf(dy.id) >= 0;
    var row = el('div', 'sg5-lorew-row' + (got ? ' is-have' : ' is-off'));
    row.appendChild(el('div', 'sg5-lorew-title', got ? dy.title : '一页未寻得的日记'));
    if (got) {
      row.appendChild(el('div', 'sg5-lorew-text', dy.text));
    } else {
      row.appendChild(el('div', 'sg5-lorew-text sg5-lorew-hint', '在这片区域的草丛、林间与岩缝里，找一块碑顶发亮的石碑。'));
    }
    body.appendChild(row);
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
}
