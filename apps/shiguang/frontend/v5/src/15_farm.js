  // ---------------- §16 农场经营：状态 / 网络 / 世界层 ----------------
  // 扩展方式：只追加文件、不改旧文件。所有既有函数都用「保存原引用 → 重新赋值」包装，
  // 多次包装自动成链，一定先调 _orig 再干自己的事，避免吞掉 13/14 号文件的逻辑。

  S.farm = {
    p: null, data: null, tool: 'hoe', seed: '', tab: 'field',
    lastPoll: 0, epoch: 0, dirty: 0, rtBound: 0, qte: null,
    relationTab: 'villagers', mineTab: 'fish', sel: null, bagSel: null,
    loadState: 'loading', lastError: '', relGiftTo: '',
    // v5.5：新手引导去重（localStorage sg5hint 持久化）+ 丰收展展台态
    hintSeen: {}, exhibitMode: false, exhibitSel: []
  };

  function farmClock(progress) {
    var mins = 6 * 60 + Math.floor(Math.max(0, Math.min(1, progress)) * 20 * 60);
    var h24 = Math.floor(mins / 60) % 24, m = mins % 60;
    return (h24 < 10 ? '0' : '') + h24 + ':' + (m < 10 ? '0' : '') + m;
  }
  function farmP() { return S.farm.p; }
  function farmD() { return S.farm.data || {}; }
  function farmCal() { return (S.farm.p && S.farm.p.cal) || {}; }
  function farmItemName(id) {
    var P = farmP();
    if (P && P.prices && typeof P.prices[id] !== 'undefined') { /* 名称本地算，价格用服务端 */ }
    var parts = String(id || '').split('_q'), base = parts[0], q = parts[1] ? Number(parts[1]) : 0;
    var D = farmD(), n = '';
    if (base.indexOf('seed_') === 0) n = (D.CROPS[base.slice(5)] ? D.CROPS[base.slice(5)].name : base.slice(5)) + '种子';
    else if (D.CROPS && D.CROPS[base]) n = D.CROPS[base].name;
    else if (D.ANIMALS && D.ANIMALS[base]) n = D.ANIMALS[base].name;
    else {
      var FIX = { egg: '鸡蛋', big_egg: '大鸡蛋', duck_egg: '鸭蛋', duck_feather: '鸭毛',
        milk: '牛奶', big_milk: '大牛奶', goat_milk: '羊奶', big_goat_milk: '大瓶羊奶',
        wool: '羊毛', big_wool: '优质羊毛', truffle: '松露', hay: '干草', wood: '木材',
        stone: '石头', coal: '煤', copper: '铜矿石', iron: '铁矿石', gold: '金矿石',
        iridium: '铱矿石', gem: '宝石', speedgro: '生长激素', quality_fert: '高级肥料',
        sprinkler: '洒水器', bait: '鱼饵', rod: '鱼竿', furnace: '熔炉', seeds: '混合种子',
        skull_key: '头骨钥匙' };
      var F = D.FISH || [], O = D.ORES || [];
      for (var i = 0; i < F.length; i++) if (F[i].id === base) n = F[i].name;
      if (!n) for (var j = 0; j < O.length; j++) if (O[j].id === base) n = O[j].name;
      if (!n) n = FIX[base] || (D.ITEM_NAMES && D.ITEM_NAMES[base]) || base;
    }
    return n + (q ? ' ' + (D.QUALITY && D.QUALITY[q] ? D.QUALITY[q].name : '★' + q) : '');
  }
  function farmItemColor(id) {
    var base = String(id || '').split('_q')[0], D = farmD();
    if (base.indexOf('seed_') === 0) base = base.slice(5);
    if (D.CROPS && D.CROPS[base]) return D.CROPS[base].col;
    var F = D.FISH || [];
    for (var i = 0; i < F.length; i++) if (F[i].id === base) return '#8fc4d8';
    var O = D.ORES || [];
    for (var j = 0; j < O.length; j++) if (O[j].id === base) return '#a9a29a';
    var M = { hay: '#d8c27a', wood: '#a9814f', hardwood: '#8a6a48', coal: '#4a4a52', copper: '#c98452',
      iron: '#c8cdd4', gold: '#e5c45c', iridium: '#b9e6e2', gem: '#b58ad8',
      egg: '#f2e7c8', milk: '#eef1f4', wool: '#f0eade', truffle: '#8b6b52',
      crab: '#e87858',
      copper_bar: '#c98452', iron_bar: '#c8cdd4', gold_bar: '#e5c45c', iridium_bar: '#b9e6e2',
      mayonnaise: '#f6efc0', cheese: '#e8c060', pale_ale: '#e8b84a', beer: '#d89830',
      food_soup: '#e8d8a0', food_stirfry: '#a8c860', food_grilled: '#d8a06a', food_sushi: '#e8e0c8',
      food_bento: '#c8a878', food_cookie: '#d8b070', food_tea: '#88b080', food_honey: '#e0a840',
      ticket: '#c9963f',
      horseradish: '#e8e2d0', daffodil: '#f0d858', leek: '#b8cc88', dandelion: '#f0c840',
      spice_berry: '#d86a4a', sweet_pea: '#c878d8', summer_grape: '#8868b8',
      hazelnut: '#a87848', wild_plum: '#8858a8', blackberry: '#585878',
      crystal_fruit: '#a8e0e8', snow_yam: '#e8d0b0', winter_root: '#c8a878' };
    return M[base] || '#c8b48a';
  }
  function farmQualityColor(id) {
    var q = Number(String(id || '').split('_q')[1] || 0), D = farmD();
    return (D.QUALITY && D.QUALITY[q] && D.QUALITY[q].col) || '#e8d7a8';
  }

  // ---------- 后端字段 → 客户端状态 ----------
  function farmApply(p) {
    if (!p) return;
    S.farm.p = p;
    S.farm.data = p.data || S.farm.data;
    S.farm.epoch = Date.now() - (p.cal.progress || 0) * (p.cal.dayMs || 90000);
    if (!S.farm.seed) {
      var seeds = farmSeedList();
      S.farm.seed = seeds.length ? seeds[0] : '';
    }
    S.farm.dirty = 0;
    S.farm.loadState = 'ok';
    S.farm.lastError = '';
    if (UI.farmClock) farmHudPaint();
  }
  function farmSeedList() {
    var D = farmD(), P = farmP(), out = [], inv = (P && P.inv) || {};
    for (var k in inv) {
      if (!Object.prototype.hasOwnProperty.call(inv, k)) continue;
      if (k.indexOf('seed_') === 0 && inv[k] > 0) out.push(k);
    }
    out.sort();
    return out;
  }
  function farmState() {
    S.farm.loadState = 'loading';
    return apiGet('/shiguang/v5/farm/state').then(function (d) {
      if (d && d.farm) farmApply(d.farm);
      else S.farm.loadState = 'ok';
      return d;
    }, function (e) {
      // v5.3：失败也绝不把 S.farm.p 清成 null —— 面板继续显示上一次的旧数据，
      // 不渲染「正在载入…」空态。错误条由 farmErrBlock 负责，还能点「重新载入」。
      S.farm.loadState = 'error';
      S.farm.lastError = (e && e.message) || '农场数据没能载入';
      if (curPanel === 'farm' || curPanel === 'relation' || curPanel === 'mine') refreshPanel(curPanel);
      return null;
    });
  }
  // v5.6 W1：farmBusy 全局单飞锁（farmAct/lifeAct 全部动作，含 mine）—— 在途时新请求直接丢弃。
  function farmAct(path, body) {
    return sg5Gate('farmBusy', document.activeElement, function () {
      return apiPost('/shiguang/v5/farm/' + path, body || {}).then(function (d) {
        if (d && d.farm) farmApply(d.farm);
        actSfx('farm', path, d);
        S.farm.lastError = '';
        if (curPanel === 'farm' || curPanel === 'relation' || curPanel === 'mine') refreshPanel(curPanel);
        return d;
      }, function (e) {
        S.farm.lastError = (e && e.message) || '操作没能完成';
        if (curPanel === 'farm' || curPanel === 'relation' || curPanel === 'mine') refreshPanel(curPanel);
        throw e;   // 保留调用方原有的 toast(err.message,'warn') 失败分支
      });
    }) || Promise.resolve(null);
  }
  function lifeAct(path, body) {
    return sg5Gate('farmBusy', document.activeElement, function () {
      return apiPost('/shiguang/v5/life/' + path, body || {}).then(function (d) {
        if (d && d.farm) farmApply(d.farm);
        actSfx('life', path, d);
        S.farm.lastError = '';
        if (curPanel === 'farm' || curPanel === 'relation' || curPanel === 'mine') refreshPanel(curPanel);
        return d;
      }, function (e) {
        S.farm.lastError = (e && e.message) || '操作没能完成';
        if (curPanel === 'farm' || curPanel === 'relation' || curPanel === 'mine') refreshPanel(curPanel);
        throw e;
      });
    }) || Promise.resolve(null);
  }
  function farmToast(text, kind) { toast(text, kind || ''); auSfx('menu', 0.2, 1.1); }

  // ---------- v5.4 音效：夜里（18:00–06:00）自动把音量压到 6 折 ----------
  function farmSfx(name, vol, rate) {
    var v = vol == null ? 0.3 : vol;
    try {
      var clock = farmCal().clock || '';
      var h = Number(String(clock).split(':')[0]) || 0;
      if (h >= 18 || h < 6) v = v * 0.6;
    } catch (e) {}
    auSfx(name, v, rate || 1);
  }
  // 各动作的音效映射表（主理人定死）：[键, 音量, 音高]
  var ACT_SFX = {
    'farm/till': ['hit', 0.3, 0.7],
    'farm/water': ['fx', 0.22, 1.3],
    'farm/plant': ['fx', 0.2, 0.8],
    'farm/fertilize': ['fx', 0.2, 1.0],
    'farm/harvest': ['accept', 0.35, 1.1],
    'farm/sell': ['coin', 0.45, 1.0],
    'farm/ship': ['impact', 0.22, 1.3],
    'farm/buy': ['coin', 0.4, 1.1],
    'farm/tool': ['bonus', 0.45, 1.0],
    'farm/profession': ['secret', 0.45, 1.2],
    'life/craft': ['success', 0.4, 1.15],
    'life/eat': ['accept', 0.3, 0.75],
    'life/forage/pick': ['accept', 0.3, 1.3],
    'life/chop': ['sword2', 0.4, 0.75],
    'life/mine/dig': ['hit3', 0.35, 0.9],
    'life/bundle': ['spirit', 0.45, 1.0],
    'life/festival': ['bonus', 0.4, 1.25],
    'life/marry': ['magic', 0.45, 1.15],
    'life/bouquet': ['magic', 0.4, 1.1],
    'life/egg/pick': ['coin', 0.45, 1.2],
    'life/egg/redeem': ['bonus', 0.4, 1.15],
    'life/fish/contest/claim': ['bonus', 0.45, 1.2],
    'life/exhibit/submit': ['success', 0.45, 1.1]
  };
  function actSfx(kind, path, d) {
    var key = kind + '/' + path, s = ACT_SFX[key];
    if (!s) return;
    if (key === 'life/chop') {           // 砍树：斧声 + 一拍之后的闷响
      farmSfx(s[0], s[1], s[2]);
      setTimeout(function () { farmSfx('impact', 0.5, 0.8); }, 130);
      return;
    }
    if (key === 'life/mine/dig') {       // 挖矿：正常是敲石声，被打晕是警报
      farmSfx(d && d.down ? 'alert' : 'hit3', d && d.down ? 0.4 : 0.35, d && d.down ? 0.85 : 0.9);
      return;
    }
    if (key === 'life/craft') {          // 熔炼低沉一些，其它加工亮一些
      farmSfx('success', 0.4, d && d.skill === 'mining' ? 0.9 : 1.15);
      return;
    }
    farmSfx(s[0], s[1], s[2]);
  }

  // ---------- HUD：星露谷同款的时钟 / 季节 / 金币 / 体力 / 工具栏 ----------
  // v5.4：设备在世界层的摆放顺序（与商店列表一致）
  var MACHINE_ORDER = ['furnace', 'mayo_machine', 'cheese_press', 'keg', 'stove'];
  var FARM_TOOLS = [
    { id: 'hoe', name: '锄头', ch: '⊐', key: '1' },
    { id: 'watercan', name: '水壶', ch: '◔', key: '2' },
    { id: 'seed', name: '种子', ch: '✿', key: '3' },
    { id: 'sickle', name: '镰刀', ch: '⌁', key: '4' },
    { id: 'rod', name: '鱼竿', ch: '⌇', key: '5' },
    { id: 'pickaxe', name: '矿镐', ch: '⛏', key: '6' }
  ];
  function farmHudPaint() {
    var P = farmP(); if (!P) return;
    var c = farmCal();
    if (UI.farmClock) setText(UI.farmClock, farmClock((Date.now() - S.farm.epoch) / (c.dayMs || 90000)));
    if (UI.farmDate) setText(UI.farmDate, c.seasonName + ' ' + c.dayInSeason + '日 · ' + (c.year || 1) + '年');
    if (UI.farmWeather) setText(UI.farmWeather, c.weather === 'rain' ? '☂ 雨' : c.weather === 'snow' ? '❄ 雪' : '☀ 晴');
    if (UI.farmGold) setText(UI.farmGold, String(P.gold) + 'g');
    if (UI.farmEnergy) {
      var pct = Math.max(0, Math.min(1, P.energy / (P.maxEnergy || 100)));
      // v5.3：血条只动 transform，不碰 width（和 09_ui_hud 的 scaleX 一个口径）
      UI.farmEnergy.style.transform = 'scaleX(' + pct.toFixed(3) + ')';
      UI.farmEnergy.className = 'sg5-farm-energy-fill' + (pct < 0.3 ? ' is-low' : '');
      var enWrap = UI.farmEnergy.parentNode;
      if (enWrap && enWrap.setAttribute) {
        enWrap.setAttribute('aria-valuenow', String(Math.round(pct * 100)));
        enWrap.setAttribute('aria-label', pct < 0.3 ? '体力偏低' : '体力');
      }
    }
    if (UI.farmToolBtns) {
      for (var i = 0; i < UI.farmToolBtns.length; i++) {
        var b = UI.farmToolBtns[i], on = b.getAttribute('data-tool') === S.farm.tool;
        b.className = 'sg5-farm-tool' + (on ? ' is-on' : '');
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
      }
    }
    if (UI.farmSeedLabel) {
      setText(UI.farmSeedLabel, S.farm.seed ? farmItemName(S.farm.seed) : '没种子了');
    }
    if (UI.farmFestival) {
      var fes = c.festival;
      UI.farmFestival.style.display = fes ? '' : 'none';
      if (fes) setText(UI.farmFestival, '✦ ' + fes.name);
    }
    if (UI.farmToolNext || UI.farmNear) farmHintPaint();
  }
  // v5.4：两条只读提示统一在这里刷（farmHudPaint 与每帧 socialTick 都调它；
  // 走动 / 传送都要跟着变，setText 自带相等判断，不变就零开销）
  // v5.5：彩蛋优先级最高，同帧撞上采集物也让位（并联动把 forage 引导标记为已看）
  function farmHintPaint() {
    // v5.5：彩蛋节 chip 只在「彩蛋节 + 草原」出现；满 12 变绿（每帧刷，传送换区也即时）
    if (UI.farmEggChip) {
      var ep = farmP();
      var show = isEggDay() && S.zone === 'meadow' && ep && ep.eggHunt;
      UI.farmEggChip.style.display = show ? '' : 'none';
      if (show) {
        var full = ep.eggHunt.found >= ep.eggHunt.total;
        setText(UI.farmEggChip, '彩蛋节 · ' + ep.eggHunt.found + '/' + ep.eggHunt.total);
        UI.farmEggChip.className = 'sg5-farm-chip sg5-farm-eggchip' + (full ? ' is-full' : '');
      }
    }
    if (UI.farmToolNext) {
      var nx = farmNextAction();
      setText(UI.farmToolNext, nx ? 'E：' + nx : '');
    }
    if (UI.farmNear) {
      var ne = farmNearEgg(), nf = ne ? null : farmNearForage(), txt = '';
      if (ne) txt = 'E：捡彩蛋';
      else if (nf) txt = 'E：采集 ' + farmItemName(nf.item);
      else {
        var nt = farmNearTree();
        if (nt) txt = nt.ready ? 'E：砍树' : '这棵树刚砍过，过几天再来';
      }
      setText(UI.farmNear, txt);
    }
    farmHintTick();
  }

  // ---------- v5.5 新手引导：单例提示条（五键矩阵 till/forage/egg/fish/panel） ----------
  // 每帧在 farmHintPaint 里查一次，命中即显示 8 秒后淡出；看过一次就永久去重，
  // 记录存 localStorage 'sg5hint'，跨日不重置。触屏不区分文案。
  var HINT_TEXT = {
    till: '走进自家田里了：按 E 翻土，手上拿着的工具就是干活的工具',
    forage: '身边有野味：按 E 采集，背包里多一份收成',
    egg: '彩蛋节：草原上藏着 12 颗彩蛋，走近按 E 捡，彩券去农场面板「商店」换奖励',
    fish: '到水边了：按 H 打开钓鱼，甩竿把绿条对准鱼',
    panel: '第一次收成了：按 N 打开农场面板，商店 / 背包 / 出货都在里面'
  };
  var hintEl = null, hintKey = '', hintUntil = 0;
  function farmHintLoad() {
    try {
      var raw = window.localStorage ? window.localStorage.getItem('sg5hint') : '';
      var o = raw ? JSON.parse(raw) : null;
      if (o && typeof o === 'object') S.farm.hintSeen = o;
    } catch (e) {}
  }
  function farmHintSave() {
    try { if (window.localStorage) window.localStorage.setItem('sg5hint', JSON.stringify(S.farm.hintSeen)); } catch (e) {}
  }
  // v5.5：dock 入口角标 seen 记录（S.storage 'sg5new'），首次打开 farm/relation/mine 后摘标
  function sg5NewLoad() {
    try { return JSON.parse(S.storage.get('sg5new', '{}') || '{}') || {}; } catch (e) { return {}; }
  }
  function sg5NewMark(id) {
    try {
      var news = sg5NewLoad();
      if (news[id] === 1) return;
      news[id] = 1;
      S.storage.set('sg5new', JSON.stringify(news));
    } catch (e) {}
  }
  function farmHintShow(key) {
    if (!UI.hud) return;
    if (!hintEl) {
      hintEl = el('div', 'sg5-hint', '');
      hintEl.setAttribute('role', 'status');
      UI.hud.appendChild(hintEl);
    }
    hintKey = key; hintUntil = Date.now() + 8000;
    if (!S.farm.hintSeen[key]) { S.farm.hintSeen[key] = 1; farmHintSave(); }
    setText(hintEl, HINT_TEXT[key] || '');
    hintEl.className = 'sg5-hint is-on';
  }
  function farmHintHide() {
    if (hintEl && hintKey) { hintEl.className = 'sg5-hint'; hintKey = ''; }
  }
  function farmHintTick() {
    if (!UI.hud) return;
    var hs = S.farm.hintSeen, P = farmP(), key = '';
    if (!hs.till && farmNear()) key = 'till';
    else if (!hs.forage && farmNearForage()) key = 'forage';
    else if (!hs.egg && isEggDay() && S.zone === 'meadow' && P && P.eggsLeft && P.eggsLeft.length) {
      key = 'egg';
      if (farmNearForage()) hs.forage = 1;   // 彩蛋与采集同帧：egg 优先，forage 联动去重
    }
    else if (!hs.fish && farmNearWater()) key = 'fish';
    else if (!hs.panel && P && P.stats && P.stats.harvest >= 1) key = 'panel';
    if (key) farmHintShow(key);
    else if (hintKey && Date.now() > hintUntil) farmHintHide();
  }

  var _uiBuildFarm = uiBuild;
  uiBuild = function (root) {
    var r = _uiBuildFarm(root);
    var hud = UI.hud;
    var bar = el('div', 'sg5-frame sg5-farmbar');
    var left = el('div', 'sg5-farmbar-top');
    left.appendChild(el('span', 'sg5-farm-chip sg5-farm-clock', ''));
    left.appendChild(el('span', 'sg5-farm-chip sg5-farm-date', ''));
    left.appendChild(el('span', 'sg5-farm-chip sg5-farm-weather', ''));
    UI.farmClock = left.childNodes[0]; UI.farmDate = left.childNodes[1]; UI.farmWeather = left.childNodes[2];
    // v5.5：彩蛋节首位 chip「彩蛋节 · n/12」——满 12 变绿，点击直达商店页签兑换
    var eggChip = el('button', 'sg5-farm-chip sg5-farm-eggchip', '');
    eggChip.type = 'button';
    eggChip.style.display = 'none';
    UI.farmEggChip = eggChip;
    left.insertBefore(eggChip, left.firstChild);
    eggChip.addEventListener('click', function () {
      S.farm.tab = 'shop';
      openPanel('farm');
    }, false);
    bar.appendChild(left);
    var row = el('div', 'sg5-farmbar-row');
    var gold = el('div', 'sg5-farm-gold');
    gold.appendChild(el('span', 'sg5-farm-gold-ch', '●'));
    gold.appendChild(el('span', 'sg5-farm-gold-tx', ''));
    UI.farmGold = gold.childNodes[1];
    row.appendChild(gold);
    var en = el('div', 'sg5-farm-energy');
    en.setAttribute('role', 'progressbar');
    en.setAttribute('aria-valuemin', '0');
    en.setAttribute('aria-valuemax', '100');
    en.setAttribute('aria-valuenow', '0');
    en.setAttribute('aria-label', '体力');
    var fill = el('div', 'sg5-farm-energy-fill');
    UI.farmEnergy = fill; en.appendChild(fill); row.appendChild(en);
    bar.appendChild(row);
    var tools = el('div', 'sg5-farm-tools');
    UI.farmToolBtns = [];
    (function () {
      for (var i = 0; i < FARM_TOOLS.length; i++) {
        var t = FARM_TOOLS[i];
        var b = el('button', 'sg5-farm-tool');
        b.type = 'button'; b.setAttribute('data-tool', t.id);
        b.appendChild(el('span', 'sg5-farm-tool-ch', t.ch));
        b.appendChild(el('span', 'sg5-farm-tool-key', t.key));
        b.setAttribute('title', t.name + '（' + t.key + '）');
        b.setAttribute('aria-label', t.name + '（' + t.key + '）');
        b.setAttribute('aria-pressed', 'false');
        tools.appendChild(b); UI.farmToolBtns.push(b);
      }
    })();
    bar.appendChild(tools);
    var nextTip = el('div', 'sg5-farm-tool-next', '');
    UI.farmToolNext = nextTip;
    bar.appendChild(nextTip);
    var nearTip = el('div', 'sg5-farm-near', '');
    UI.farmNear = nearTip;
    bar.appendChild(nearTip);
    var seedRow = el('div', 'sg5-farm-seedrow');
    seedRow.appendChild(el('span', 'sg5-farm-seedlabel', ''));
    UI.farmSeedLabel = seedRow.childNodes[0];
    bar.appendChild(seedRow);
    var fes = el('div', 'sg5-farm-festival');
    fes.style.display = 'none'; UI.farmFestival = fes;
    bar.appendChild(fes);
    hud.appendChild(bar);
    UI.farmBar = bar;

    // dock：多两个入口。bindButtons 的 click 委托读 data-panel，无需改动。
    if (UI.dock) {
      UI.farmDockBtns = {
        farm: dockBtn(UI.dock, 'farm', 'glyph:hoe', '农场', 'N'),
        relation: dockBtn(UI.dock, 'relation', 'glyph:heart', '小镇', 'R'),
        mine: dockBtn(UI.dock, 'mine', 'glyph:pick', '钓鱼 / 矿洞', 'H')
      };
      // v5.5：三个农场入口挂新手角标，首次成功打开对应面板后摘掉（S.storage sg5new 记录）
      var news = sg5NewLoad();
      for (var dk in UI.farmDockBtns) {
        if (!Object.prototype.hasOwnProperty.call(UI.farmDockBtns, dk)) continue;
        if (news[dk] !== 1) UI.farmDockBtns[dk].className += ' is-new';
      }
    }
    tools.addEventListener('click', function (e) {
      var t = e.target;
      while (t && t !== tools && !t.getAttribute('data-tool')) t = t.parentNode;
      if (!t || t === tools) return;
      farmSetTool(t.getAttribute('data-tool'));
    }, false);
    return r;
  };

  function farmSetTool(id) {
    S.farm.tool = id;
    if (id === 'seed') {
      var seeds = farmSeedList();
      if (!seeds.length) { farmToast('先去商店买包种子', 'warn'); return; }
      if (seeds.indexOf(S.farm.seed) < 0) S.farm.seed = seeds[0];
      farmToast('手上拿着 ' + farmItemName(S.farm.seed));
    } else if (id === 'rod') { farmToast('走到水边按 E 甩竿'); }
    else if (id === 'pickaxe') { farmToast('按 H 打开矿洞'); }
    else {
      var nm = '';
      for (var i = 0; i < FARM_TOOLS.length; i++) if (FARM_TOOLS[i].id === id) nm = FARM_TOOLS[i].name;
      farmToast('换上了' + nm);
    }
    farmHudPaint();
  }
  function farmCycleSeed() {
    var seeds = farmSeedList();
    if (!seeds.length) { farmToast('背包里没有种子', 'warn'); return; }
    var i = seeds.indexOf(S.farm.seed);
    S.farm.seed = seeds[(i + 1 + seeds.length) % seeds.length];
    farmToast('种子 → ' + farmItemName(S.farm.seed));
    farmHudPaint();
  }

  // ---------- 输入：数字键切工具 / N R H 开面板 ----------
  var _inputBindFarm = inputBind;
  inputBind = function (root, onDestroy) {
    var r = _inputBindFarm(root, onDestroy);
    function kp(e) {
      var ae = document.activeElement;
      var tag = ae && ae.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || (ae && ae.isContentEditable)) return;
      var k = String(e.key || '').toLowerCase();
      // v5.3：面板打开时 1–6 / Q 不生效（按 1 不换农具、按 Q 不弹 toast）；
      // N / R / H 仍允许切面板。输入态统一用 activeElement 判定。
      if (curPanel === '') {
        if (k >= '1' && k <= '6') { farmSetTool(FARM_TOOLS[Number(k) - 1].id); e.preventDefault(); return; }
        if (k === 'q') { farmCycleSeed(); e.preventDefault(); return; }
      }
      if (k === 'n') { openPanel('farm'); e.preventDefault(); return; }
      if (k === 'r') { openPanel('relation'); e.preventDefault(); return; }
      if (k === 'h') { openPanel('mine'); e.preventDefault(); return; }
    }
    document.addEventListener('keydown', kp, false);
    onDestroy(function () { document.removeEventListener('keydown', kp, false); });
    return r;
  };

  // ---------- 世界层：耕地、洒水器、作物 ----------
  function farmBounds() {
    var D = farmD();
    return { x: D.FARM_X || 112, y: D.FARM_Y || 142, w: D.FARM_W || 12, h: D.FARM_H || 8 };
  }
  function farmDrawGround(ctx, vr) {
    var P = farmP(); if (!P || !P.plots) return;
    var B = farmBounds(), u = TILE * S.zoom;
    var c0 = Math.max(0, vr.x0 - B.x), c1 = Math.min(B.w - 1, vr.x1 - B.x);
    var r0 = Math.max(0, vr.y0 - B.y), r1 = Math.min(B.h - 1, vr.y1 - B.y);
    if (c1 < c0 || r1 < r0) return;
    // 整片田的基底：略暖的土色 + 一圈木栅栏，先告诉玩家「这里能种」
    var px0 = w2sX(B.x * TILE), py0 = w2sY(B.y * TILE);
    ctx.fillStyle = 'rgba(94,72,48,0.16)';
    ctx.fillRect(px0, py0, B.w * u, B.h * u);
    ctx.strokeStyle = 'rgba(74,54,34,0.75)'; ctx.lineWidth = Math.max(2, S.zoom);
    ctx.strokeRect(px0 - 2, py0 - 2, B.w * u + 4, B.h * u + 4);
    ctx.fillStyle = '#8a6a42';
    for (var fx = 0; fx <= B.w; fx++) {
      var wx = Math.round(px0 + fx * u);
      ctx.fillRect(wx - 1, Math.round(py0 - u * 0.22), Math.max(2, S.zoom), Math.round(u * 0.32));
    }
    for (var r = r0; r <= r1; r++) {
      for (var c = c0; c <= c1; c++) {
        var p = P.plots[r + ',' + c];
        var x = Math.round(w2sX((B.x + c) * TILE)), y = Math.round(w2sY((B.y + r) * TILE));
        if (p && p.tilled) {
          ctx.fillStyle = p.watered ? '#4b3527' : '#6b4c32';
          ctx.fillRect(x + 1, y + 1, Math.round(u) - 2, Math.round(u) - 2);
          ctx.strokeStyle = p.watered ? 'rgba(22,16,12,0.7)' : 'rgba(48,32,20,0.6)';
          ctx.lineWidth = 1;
          for (var g = 1; g < 4; g++) {
            var gy = Math.round(y + u * g / 4);
            ctx.beginPath(); ctx.moveTo(x + 2, gy); ctx.lineTo(x + u - 2, gy); ctx.stroke();
          }
          if (p.watered) {
            ctx.fillStyle = 'rgba(96,150,180,0.22)';
            ctx.fillRect(x + 2, y + Math.round(u * 0.72), Math.round(u) - 4, Math.round(u * 0.2));
          }
          if (p.fert) {
            ctx.fillStyle = p.fert === 'quality_fert' ? 'rgba(240,206,110,0.55)' : 'rgba(150,214,120,0.5)';
            ctx.fillRect(x + 3, y + 3, 3, 3);
          }
          if (P.sprinklers && P.sprinklers[r + ',' + c]) {
            ctx.fillStyle = '#9fb6c4';
            ctx.fillRect(x + u * 0.38, y + u * 0.3, Math.max(3, u * 0.24), Math.max(3, u * 0.24));
            ctx.fillStyle = 'rgba(140,210,230,0.8)';
            ctx.fillRect(x + u * 0.46, y + u * 0.16, 2, 3);
          }
        } else {
          ctx.strokeStyle = 'rgba(120,96,62,0.35)'; ctx.lineWidth = 1;
          ctx.strokeRect(x + 0.5, y + 0.5, Math.round(u) - 1, Math.round(u) - 1);
        }
      }
    }
  }

  function farmDrawCrop(ctx, p) {
    var u = TILE * S.zoom;
    var sx = w2sX(p.x * TILE + TILE * 0.5);
    var sy = w2sY(p.y * TILE + TILE);
    var D = farmD(), def = (D.CROPS && D.CROPS[p.crop]) || { col: '#8db36a', shape: 'leaf' };
    var g = Math.max(0.3, Math.min(1, p.grow));
    var h = u * (0.2 + 0.48 * g);
    var col = def.col || '#8db36a';
    ctx.save();
    // 脚底接触阴影
    ctx.fillStyle = 'rgba(30,22,16,0.24)';
    ctx.beginPath(); ctx.ellipse(sx, sy - 1, u * 0.22, u * 0.075, 0, 0, Math.PI * 2); ctx.fill();
    // 茎
    ctx.strokeStyle = '#4b7a3e'; ctx.lineWidth = Math.max(2, Math.round(u * 0.07));
    ctx.beginPath(); ctx.moveTo(sx, sy - u * 0.06); ctx.lineTo(sx, sy - h); ctx.stroke();
    var top = sy - h;
    // 还没熟：两片带描边的嫩叶，一眼就能看出「这儿种了东西」
    if (!p.ready) {
      ctx.fillStyle = '#8fd06a'; ctx.strokeStyle = '#37632c'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.ellipse(sx - u * 0.14, top + u * 0.03, u * 0.15, u * 0.075, -0.5, 0, Math.PI * 2);
      ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.ellipse(sx + u * 0.14, top - u * 0.04, u * 0.15, u * 0.075, 0.5, 0, Math.PI * 2);
      ctx.fill(); ctx.stroke();
      ctx.restore();
      return;
    }
    // 成熟：按 shape 族 6×6 像素形结果 / 开花（v5.6 W2 ④：2 阶色 + #17120d 描边）
    var CROP_FRUIT = {
      round: [
        '.####.',
        '######',
        '######',
        '######',
        '.####.',
        '..##..'
      ],
      berry: [
        '..##..',
        '.####.',
        '######',
        '.####.',
        '..##..',
        '...#..'
      ],
      root: [
        '..##..',
        '.####.',
        '######',
        '.####.',
        '..##..',
        '..##..'
      ],
      flower: [
        '.#..#.',
        '..##..',
        '#o##o#',
        '..##..',
        '.#..#.',
        '..##..'
      ]
    };
    if (def.shape === 'flower') {
      var crows = CROP_FRUIT.flower;
      var ccell = u * 0.09;
      drawGlyphWorldFarm(ctx, crows, sx, top + u * 0.18, ccell, { '#': col, 'o': '#f2d878' }, '#17120d');
      drawGlyphWorldFarm(ctx, crows, sx, top + u * 0.18, ccell, { '#': col, 'o': '#f2d878' }, null);
    } else if (def.shape === 'berry' || def.shape === 'round' || def.shape === 'root') {
      ctx.fillStyle = '#5f9149';
      ctx.fillRect(sx - u * 0.24, top - u * 0.02, u * 0.48, u * 0.1);
      if (p.ready) {
        var frows = CROP_FRUIT[def.shape === 'root' ? 'root' : (def.shape === 'berry' ? 'berry' : 'round')];
        var fcell = u * 0.09;
        drawGlyphWorldFarm(ctx, frows, sx, top + u * 0.28, fcell, { '#': shadeHex(col, -36) }, '#17120d');
        drawGlyphWorldFarm(ctx, frows, sx, top + u * 0.28, fcell, { '#': col }, null);
        ctx.fillStyle = 'rgba(255,255,255,0.5)';
        ctx.fillRect(Math.round(sx - fcell * 2), Math.round(top + u * 0.28 - fcell * 5), Math.max(1, Math.round(fcell)), Math.max(1, Math.round(fcell)));
      } else {
        ctx.fillStyle = '#79a95c';
        ctx.fillRect(sx - u * 0.16, top - u * 0.04, u * 0.32, u * 0.1);
      }
    } else {
      ctx.fillStyle = col;
      ctx.fillRect(sx - u * 0.2, top, u * 0.4, h * 0.45);
      ctx.fillStyle = 'rgba(255,255,255,0.16)';
      ctx.fillRect(sx - u * 0.2, top, u * 0.12, h * 0.45);
      if (p.ready) {
        ctx.fillStyle = '#f0d27a';
        ctx.fillRect(sx - u * 0.08, top - u * 0.1, u * 0.16, u * 0.12);
      }
    }
    if (p.ready) {
      // 成熟提示：小小的金星在头顶一闪一闪
      var tw = 0.55 + 0.45 * Math.sin(S.time * 4 + p.x + p.y);
      ctx.globalAlpha = tw; ctx.fillStyle = '#ffe9a0';
      ctx.fillRect(sx + u * 0.22, top - u * 0.32, 3, 3);
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  }

  var _dssFarm = drawStructureShadows;
  drawStructureShadows = function (ctx, vr) {
    farmDrawGround(ctx, vr);
    return _dssFarm(ctx, vr);
  };
  var _collectFarm = collectProps;
  collectProps = function (vr) {
    _collectFarm(vr);
    var P = farmP(); if (!P || !P.plots || !farmD().CROPS) return;
    var B = farmBounds();
    var c0 = Math.max(0, vr.x0 - B.x), c1 = Math.min(B.w - 1, vr.x1 - B.x);
    var r0 = Math.max(0, vr.y0 - B.y), r1 = Math.min(B.h - 1, vr.y1 - B.y);
    for (var r = r0; r <= r1; r++) {
      for (var c = c0; c <= c1; c++) {
        var p = P.plots[r + ',' + c];
        if (!p || !p.crop) continue;
        var def = farmD().CROPS[p.crop]; if (!def) continue;
        var need = Math.max(1, Math.round(def.days * (P.profs && P.profs.indexOf('agriculturist') >= 0 ? 0.9 : 1)));
        var ready = p.harvested && def.regrow
          ? (P.cal.day - (p.regrowDay || P.cal.day) >= def.regrow)
          : (p.grow || 0) >= need;
        PROPS.push({ k: 'farmcrop', x: B.x + c, y: B.y + r, s: (r * 31 + c * 17) % 7,
          crop: p.crop, grow: Math.min(1, (p.grow || 0) / need), ready: ready });
      }
    }
    // ---- v5.4：野外采集物 / 冷却残桩 / 田下缘的加工设备 ----
    var fi, fr = P.forage || [];
    for (fi = 0; fi < fr.length; fi++) {
      var fp = fr[fi];
      if (fp.x < vr.x0 || fp.x > vr.x1 || fp.y < vr.y0 || fp.y > vr.y1) continue;
      PROPS.push({ k: 'forage', x: fp.x, y: fp.y, s: (fp.x * 7 + fp.y * 13) % 7, item: fp.item });
    }
    var cdKeys = Object.keys(P.forageCd || {});
    for (fi = 0; fi < cdKeys.length; fi++) {
      var xy = cdKeys[fi].split(','), gx = Number(xy[0]), gy = Number(xy[1]);
      if (gx < vr.x0 || gx > vr.x1 || gy < vr.y0 || gy > vr.y1) continue;
      PROPS.push({ k: 'forage', x: gx, y: gy, s: 0, item: '', stub: 1 });
    }
    // ---- v5.5：彩蛋节的彩蛋（视野内才画，捡一颗少一颗） ----
    var eggs = P.eggsLeft || [];
    for (fi = 0; fi < eggs.length; fi++) {
      var eg = eggs[fi];
      if (eg.x < vr.x0 || eg.x > vr.x1 || eg.y < vr.y0 || eg.y > vr.y1) continue;
      PROPS.push({ k: 'egg', x: eg.x, y: eg.y, s: (eg.x * 7 + eg.y * 13) % 7, i: eg.i });
    }
    // 设备画在田下缘：按购买顺序每台占 2 格，一排放不下就封顶 6 台
    var mi = 0, order = MACHINE_ORDER;
    for (var oi = 0; oi < order.length; oi++) {
      var cnt = (P.machines || {})[order[oi]] || 0;
      for (var ci = 0; ci < cnt && mi < 6; ci++) {
        PROPS.push({ k: 'machine', x: B.x + mi * 2, y: B.y + B.h, s: mi, kind: order[oi] });
        mi++;
      }
    }
  };
  // v5.6 W2 ①：采集物改四族 8×8 GLYPH 行串（浆果丛 / 根茎 / 花株 / 菌菇）+ 主色 + 描边 + 白高光
  var FORAGE_GLYPH = {
    berry: [
      '........',
      '.##..##.',
      '#++##++#',
      '#++##++#',
      '.##..##.',
      '..####..',
      '...##...',
      '..####..'
    ],
    root: [
      '..##.##.',
      '.######.',
      '..####..',
      '...##...',
      '..++++..',
      '..++++..',
      '...++...',
      '...++...'
    ],
    flower: [
      '..++++..',
      '.+o++o+.',
      '+++++++.',
      '.+++++..',
      '..####..',
      '..####..',
      '...##...',
      '...##...'
    ],
    shroom: [
      '..####..',
      '.+####+.',
      '########',
      '########',
      '...##...',
      '..+##+..',
      '..+##+..',
      '........'
    ]
  };
  function forageFamily(id) {
    var b = String(id || '').split('_q')[0];
    if (/daffodil|dandelion|sweet_pea|tulip|jazz|poppy/.test(b)) return 'flower';
    if (/berry|grape|plum|spice/.test(b)) return 'berry';
    if (/root|leek|yam|radish|horseradish|winter/.test(b)) return 'root';
    if (/spore|mushroom|shroom/.test(b)) return 'shroom';
    return 'berry';
  }
  function farmDrawForage(ctx, p) {
    var u = TILE * S.zoom;
    var sx = w2sX(p.x * TILE + TILE * 0.5);
    var sy = w2sY(p.y * TILE + TILE);
    if (p.stub) {
      ctx.fillStyle = 'rgba(70,58,38,0.75)';
      ctx.fillRect(Math.round(sx - 1), Math.round(sy - u * 0.16), 2, Math.round(u * 0.16));
      return;
    }
    var col = farmItemColor(p.item) || '#a8c86a';
    var sway = Math.round(Math.sin(S.time * 1.6 + (p.x * 7 + p.y * 13) % 7) * 1);
    ctx.fillStyle = 'rgba(30,22,16,0.22)';
    ctx.beginPath(); ctx.ellipse(sx, sy - 1, u * 0.2, u * 0.06, 0, 0, 6.2832); ctx.fill();
    var fam = forageFamily(p.item);
    var rows = FORAGE_GLYPH[fam];
    var cell = u * 0.055;                       // 8×8 → 约 0.44u 高
    var bx = Math.round(sx + sway);
    // 1px 深色描边：先画一圈 #17120d 的底再叠主色
    drawGlyphWorldFarm(ctx, rows, bx + 1, sy - u * 0.05, cell, null, '#17120d');
    drawGlyphWorldFarm(ctx, rows, bx, sy - u * 0.05, cell, { '#': col, '+': shadeHex(col, -36), 'o': '#ffffff' });
    // 1px 白高光
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.fillRect(Math.round(bx - cell * 2), Math.round(sy - u * 0.05 - cell * 7), Math.max(1, Math.round(cell)), Math.max(1, Math.round(cell)));
  }
  // 15_farm 内部的字形绘制（与 07_entity.drawGlyphWorld 同规则；offset 用于描边层）
  function drawGlyphWorldFarm(ctx, rows, cx, bottomY, cell, pal, forceCol) {
    var h = rows.length, w = rows[0].length;
    var ox = Math.round(cx - w * cell / 2), oy = Math.round(bottomY - h * cell);
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var ch = rows[y].charAt(x);
        if (ch === '.') continue;
        ctx.fillStyle = forceCol || ((pal && pal[ch]) || (pal && pal['#']) || '#e8dcc0');
        ctx.fillRect(ox + Math.round(x * cell), oy + Math.round(y * cell), Math.max(1, Math.round(cell)), Math.max(1, Math.round(cell)));
      }
    }
  }
  // v5.6 W2 ⑨：彩蛋改用 GLYPH.egg 放大 0.5u（与 chip / 图标同源，删矢量椭圆版）
  function farmDrawEgg(ctx, p) {
    var u = TILE * S.zoom;
    var sx = w2sX(p.x * TILE + TILE * 0.5);
    var sy = w2sY(p.y * TILE + TILE);
    ctx.fillStyle = 'rgba(30,22,16,0.22)';
    ctx.beginPath(); ctx.ellipse(sx, sy - 1, u * 0.20, u * 0.06, 0, 0, 6.2832); ctx.fill();
    drawGlyphWorldFarm(ctx, GLYPH.egg, sx, sy - u * 0.06, u * 0.5 / 12,
      { '#': '#f2e7c8', 'o': '#fffdf2', '+': '#c9963f' }, null);
    var tw = 0.55 + 0.45 * Math.sin(S.time * 4 + p.i * 1.7);
    ctx.globalAlpha = tw; ctx.fillStyle = '#ffe9a0';
    ctx.fillRect(Math.round(sx + u * 0.2), Math.round(sy - u * 0.46), 3, 3);
    ctx.globalAlpha = 1;
  }
  // v5.6 W2 ②：加工设备改用 UI 层 GLYPH.machine_* 放大 0.7u（世界与 UI 同形）
  var MACHINE_GLYPH = { furnace: 'machine_furnace', mayo_machine: 'machine_mayo', cheese_press: 'machine_cheese', keg: 'machine_keg', stove: 'machine_stove' };
  function farmDrawMachine(ctx, p) {
    var u = TILE * S.zoom;
    var sx = w2sX(p.x * TILE + TILE);
    var sy = w2sY(p.y * TILE + TILE);
    ctx.fillStyle = 'rgba(30,22,16,0.24)';
    ctx.beginPath(); ctx.ellipse(sx, sy - 1, u * 0.42, u * 0.1, 0, 0, 6.2832); ctx.fill();
    var rows = GLYPH[MACHINE_GLYPH[p.kind]] || GLYPH.machine_furnace;
    drawGlyphWorldFarm(ctx, rows, sx, sy - u * 0.04, u * 0.7 / 12, null, null);
    var frm = Math.floor(S.time * 2) % 2;
    ctx.fillStyle = frm ? 'rgba(240,236,220,0.5)' : 'rgba(240,236,220,0.28)';
    var puff = frm ? 3 : 2;
    ctx.fillRect(Math.round(sx - puff / 2), Math.round(sy - u * 0.04 - rows.length * (u * 0.7 / 12) - (frm ? 8 : 4)), puff, puff);
  }
  var _drawPropFarm = drawProp;
  drawProp = function (ctx, p) {
    if (p && p.k === 'farmcrop') { farmDrawCrop(ctx, p); return; }
    if (p && p.k === 'forage') { farmDrawForage(ctx, p); return; }
    if (p && p.k === 'egg') { farmDrawEgg(ctx, p); return; }
    if (p && p.k === 'machine') { farmDrawMachine(ctx, p); return; }
    var r = _drawPropFarm(ctx, p);
    // v5.6 W2 ③：斧痕改树干斜向阶梯缺口（wood 色内芯 + #17120d 边）；次日 1 道 50% alpha
    if (p && (p.k === T.TREE || p.k === T.PINE || p.k === T.DEADTREE)) {
      var P = farmP();
      var cdk = P && P.chopped ? P.chopped[p.x + ',' + p.y] : 0;
      if (cdk) {
        var u = TILE * S.zoom;
        var cx = w2sX(p.x * TILE + TILE * 0.5), cy = w2sY(p.y * TILE + TILE);
        var day = farmCal().day || 0;
        var age = day - cdk;
        if (age <= 2) {
          drawAxeNotch(ctx, cx, cy, u, -1, age === 0 ? 1 : 0.5);
          if (age >= 1) drawAxeNotch(ctx, cx, cy, u, 1, 0.5);
        }
      }
    }
    return r;
  };
  // 斜向阶梯缺口：3 级台阶往右下切进树干
  function drawAxeNotch(ctx, cx, cy, u, side, alpha) {
    var x0 = cx + side * u * 0.06, y0 = cy - u * 0.42;
    var step = Math.max(2, Math.round(u * 0.09));
    ctx.save();
    ctx.globalAlpha = alpha;
    for (var i = 0; i < 3; i++) {
      var nx = Math.round(x0 + i * step * 0.7), ny = Math.round(y0 + i * step);
      ctx.fillStyle = '#17120d';                          // 外沿
      ctx.fillRect(nx - 1, ny - 1, step + 2, step + 2);
      ctx.fillStyle = '#6d4b2e';                          // 木茬内芯
      ctx.fillRect(nx, ny, step, step);
    }
    ctx.restore();
  }

  // ---------- 交互：站在田里按 E，按当前工具干活 ----------
  function farmNear() {
    var B = farmBounds(), m = S.me;
    if (!m) return false;
    return m.x >= B.x - 1 && m.x <= B.x + B.w + 1 && m.y >= B.y - 1 && m.y <= B.y + B.h + 1;
  }
  function farmCellAtMe() {
    var B = farmBounds(), m = S.me;
    return { r: Math.floor(m.y - B.y), c: Math.floor(m.x - B.x) };
  }
  // v5.3：只读的「下一步」提示，判定与 farmSmartAction 完全一致，但不发任何请求
  function farmNextAction() {
    var P = farmP(), m = S.me;
    if (!P || !m) return '';
    var B = farmBounds(), cell = farmCellAtMe();
    if (cell.r < 0 || cell.c < 0 || cell.r >= B.h || cell.c >= B.w) return '';
    var p = (P.plots || {})[cell.r + ',' + cell.c];
    var D = farmD(), def = p && p.crop && D.CROPS[p.crop];
    var need = def ? Math.max(1, Math.round(def.days * (P.profs && P.profs.indexOf('agriculturist') >= 0 ? 0.9 : 1))) : 0;
    var ready = def && (p.harvested && def.regrow
      ? (P.cal.day - (p.regrowDay || P.cal.day) >= def.regrow) : (p.grow || 0) >= need);
    if (ready) return '收获';
    if (p && p.crop) return '浇水';
    if (p && p.tilled) return '播种';
    return '翻土';
  }
  // ---- v5.4：身边的采集物 / 树（farmbar 提示与世界层 E 键共用） ----
  function farmNearForage() {
    var P = farmP(), m = S.me;
    if (!P || !m || !P.forage) return null;
    var best = null, bd = 2.25;                       // 1.5 格（平方）
    for (var i = 0; i < P.forage.length; i++) {
      var f = P.forage[i];
      var d = dist(m.x, m.y, f.x + 0.5, f.y + 0.5);
      if (d < bd) { bd = d; best = f; }
    }
    return best;
  }
  function farmNearTree() {
    var m = S.me;
    if (!m || !S.map || !S.map.cells) return null;
    var fx = Math.floor(m.x), fy = Math.floor(m.y);
    var face = m.face || 0;
    var dx = [0, 0, -1, 1][face], dy = [1, -1, 0, 0][face];
    // 面前一格优先，四邻兜底
    var cand = [[fx + dx, fy + dy], [fx + 1, fy], [fx - 1, fy], [fx, fy + 1], [fx, fy - 1]];
    var P = farmP(), day = farmCal().day || 0;
    for (var i = 0; i < cand.length; i++) {
      var tx = cand[i][0], ty = cand[i][1];
      var t = tileAt(tx, ty);
      if (t !== T.TREE && t !== T.PINE && t !== T.DEADTREE) continue;
      var cd = P && P.chopped ? P.chopped[tx + ',' + ty] : 0;
      return { x: tx, y: ty, ready: !(cd && day - cd < 3) };
    }
    return null;
  }
  // ---- v5.5：节日判定 / 身边的彩蛋 / 水边（引导用） ----
  function festivalNamed(n) { var c = farmCal(); return !!(c.festival && c.festival.name === n); }
  function isEggDay() { return festivalNamed('彩蛋节'); }
  function isFishContestDay() { return festivalNamed('冰雪钓赛'); }
  function isExhibitDay() { var c = farmCal(); return !!(c.festival && c.festival.perk === 'exhibit'); }
  function farmNearEgg() {
    var P = farmP(), m = S.me;
    if (!P || !m || !isEggDay() || !P.eggsLeft || !P.eggsLeft.length) return null;
    var best = null, bd = 2.25;                       // 1.5 格（平方）
    for (var i = 0; i < P.eggsLeft.length; i++) {
      var e = P.eggsLeft[i];
      var d = dist(m.x, m.y, e.x + 0.5, e.y + 0.5);
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  }
  function farmNearWater() {
    var m = S.me;
    if (!m || !S.map || !S.map.cells) return false;
    var fx = Math.floor(m.x), fy = Math.floor(m.y);
    for (var dy = -1; dy <= 1; dy++) {
      for (var dx = -1; dx <= 1; dx++) {
        var t = tileAt(fx + dx, fy + dy);
        if (t === T.WATER || t === T.SHALLOW) return true;
      }
    }
    return false;
  }
  function farmSmartAction(r, c) {
    var P = farmP(); if (!P) return;
    var p = (P.plots || {})[r + ',' + c];
    var D = farmD(), def = p && p.crop && D.CROPS[p.crop];
    var need = def ? Math.max(1, Math.round(def.days * (P.profs && P.profs.indexOf('agriculturist') >= 0 ? 0.9 : 1))) : 0;
    var ready = def && (p.harvested && def.regrow
      ? (P.cal.day - (p.regrowDay || P.cal.day) >= def.regrow) : (p.grow || 0) >= need);
    if (ready) {
      farmAct('harvest', { r: r, c: c }).then(function (d) {
        farmToast('收了 ' + (d && d.got ? d.got.length : 0) + ' 个' + (def ? def.name : '作物'));
      }, function (e) { farmToast(e.message, 'warn'); });
    } else if (p && p.crop) {
      farmAct('water', { r: r, c: c }).then(function (d) { farmToast('浇好了'); },
        function (e) { farmToast(e.message, 'warn'); });
    } else if (p && p.tilled) {
      if (!S.farm.seed || !(P.inv[S.farm.seed] > 0)) { farmCycleSeed(); return; }
      farmAct('plant', { r: r, c: c, seed: S.farm.seed }).then(function (d) {
        farmToast('种下了 ' + (d && d.name ? d.name : '种子'));
      }, function (e) { farmToast(e.message, 'warn'); });
    } else {
      farmAct('till', { r: r, c: c }).then(function () { farmToast('翻好了一块地'); },
        function (e) { farmToast(e.message, 'warn'); });
    }
  }
  // 世界里按 E：严格按手上拿的工具干活（原作手感）；面板里点格子才走智能动作
  function farmWorldAction() {
    var B = farmBounds(), cell = farmCellAtMe();
    if (cell.r < 0 || cell.c < 0 || cell.r >= B.h || cell.c >= B.w) return false;
    if (S.farm.tool === 'rod' || S.farm.tool === 'pickaxe') { openPanel('mine'); return true; }
    var body = { r: cell.r, c: cell.c }, path = '';
    if (S.farm.tool === 'hoe') path = 'till';
    else if (S.farm.tool === 'watercan') path = 'water';
    else if (S.farm.tool === 'seed') {
      if (!S.farm.seed) { farmCycleSeed(); return true; }
      path = 'plant'; body.seed = S.farm.seed;
    } else path = 'harvest';
    farmAct(path, body).then(function (d) {
      var msg = path === 'till' ? '翻好了一块地' : path === 'water' ? '浇好了'
        : path === 'plant' ? '种下了 ' + (d && d.name ? d.name : '种子')
        : '收了 ' + (d && d.got ? d.got.length : 0) + ' 个';
      farmToast(msg);
    }, function (e) { farmToast(e.message || '这会儿干不了', 'warn'); });
    return true;
  }
  // 世界里飘字：复用战斗飘字的结构（金色小字往上飘）。v5.6：支持目标坐标（彩蛋/采集/砍树）
  function floatText(txt, x, y) {
    var m = S.me;
    var px = (x != null && y != null) ? x + 0.5 : (m ? m.x : 0);
    var py = (x != null && y != null) ? y : (m ? m.y - 1.2 : 0);
    if (m && S.texts) capPush(S.texts, { x: px, y: py, txt: txt, crit: 0, life: 1.0, max: 1.0, vy: -0.9, vx: 0.2, gold: 1 }, 60);
  }
  // 世界里按 E：田区内严格按手上的工具干活；田区外先捡彩蛋、再采集、再砍树，最后才轮到宝箱 / NPC
  var _doInteractFarm = doInteract;
  doInteract = function (t) {
    if (farmP() && farmNear() && farmWorldAction()) return;
    var ne = farmNearEgg();
    if (ne) {
      lifeAct('egg/pick', { i: ne.i }).then(function (d) {
        farmToast('捡到了彩蛋，还拿到一张彩蛋彩券（农场面板「商店」可兑换）');
        floatText('+彩蛋', ne.x, ne.y - 0.6);
      }, function (e) { farmToast(e.message, 'warn'); });
      return;
    }
    var nf = farmNearForage();
    if (nf) {
      lifeAct('forage/pick', { x: nf.x, y: nf.y }).then(function (d) {
        farmToast('采到了 ' + (d && d.name ? d.name : '野味'));
        floatText('+' + (d && d.got ? d.got.length : 1), nf.x, nf.y - 0.6);
      }, function (e) { farmToast(e.message, 'warn'); });
      return;
    }
    var nt = farmNearTree();
    if (nt && nt.ready) {
      lifeAct('chop', { x: nt.x, y: nt.y }).then(function (d) {
        var g = d && d.got ? d.got : {};
        farmToast('砍到木材 ×' + (g.wood || 0) + (g.hardwood ? ' · 硬木 ×1' : ''));
        floatText('+木材', nt.x, nt.y - 0.6);
      }, function (e) { farmToast(e.message, 'warn'); });
      return;
    }
    return _doInteractFarm(t);
  };

  // ---------- 事件 / 实时广播 / 轮询 ----------
  function farmEvent(e) {
    if (!e) return false;
    var k = e.k;
    if (k === 'farm-dawn') {
      farmToast('第 ' + e.day + ' 天的晨光 · ' + (e.msg || '田里的东西长了一节'));
      farmState(); return true;
    }
    if (k === 'farm-level') {
      var D = farmD();
      farmSfx('levelup', 0.45, 1.3);
      farmToast((D.SKILL_NAMES ? D.SKILL_NAMES[e.skill] : e.skill) + '升到 ' + e.lv + ' 级！');
      farmState(); return true;
    }
    if (k === 'relation-heart') {
      farmToast('♥ ' + e.name + ' · ' + e.heart + ' 颗心：' + e.text);
      return true;
    }
    if (k === 'farm-gift') { farmToast('有人送了你 ' + (e.name || '一份礼物')); farmState(); return true; }
    if (k === 'farm-bundle') { farmToast('献祭包完成：' + e.name + ' → ' + e.reward); farmState(); return true; }
    if (k === 'farm-greenhouse' || k === 'farm-mine-bottom') { farmToast(e.text); farmState(); return true; }
    if (k === 'farm-elevator') { farmToast('矿洞电梯：第 ' + e.floor + ' 层'); return true; }
    if (k === 'farm-sleep') { farmToast('歇下了 —— 体力回了一些（分段恢复）'); return true; }
    return false;
  }
  var _handleEventFarm = handleEvent;
  handleEvent = function (e) {
    if (farmEvent(e)) return;
    return _handleEventFarm(e);
  };

  var _bindRealtimeFarm = bindRealtime;
  bindRealtime = function () {
    _bindRealtimeFarm();
    if (!S.farm.rtBound && S.realtime && S.onDestroyAll) {
      S.farm.rtBound = 1;
      var rt = S.realtime;
      function sub(name, fn) {
        try { var off = rt.subscribe('shiguang5.' + name, fn); if (off) S.onDestroyAll.push(off); } catch (e) {}
      }
      sub('farm-dawn', function (p) {
        if (p) farmToast('第 ' + p.day + ' 天 · ' + p.season + (p.festival ? ' · ' + p.festival : ''));
        farmState();
      });
      sub('farm-rare', function (p) { if (p) farmToast('有人钓上了 ' + p.fish + '！'); });
      sub('farm-marry', function (p) { if (p) farmToast(p.name + ' 和班里的同学成家了 ♥'); });
    }
  };

  var _applyEnterFarm = applyEnter;
  applyEnter = function (d) {
    _applyEnterFarm(d);
    if (d.farm) farmApply(d.farm);
  };

  var _socialTickFarm = socialTick;
  socialTick = function (t) {
    // v5.6 W1：主循环 socialTick 段的农场侧双保险 —— 一行异常不拖累其余帧逻辑
    try {
      _socialTickFarm(t);
    } catch (e) { console.error('[sg5-social]', e); }
    if (!S.ready || !farmP()) return;
    try {
      if (UI.farmClock) {
        var c = farmCal(), ms = c.dayMs || 90000;
        setText(UI.farmClock, farmClock((Date.now() - S.farm.epoch) / ms));
      }
      // v5.4：脚下 / 身边都会随走动变化，两条只读提示每帧跟着走
      if (UI.farmToolNext || UI.farmNear) farmHintPaint();
    } catch (e2) { console.error('[sg5-social-farm]', e2); }
    // 低频：面板开着或有待办时 6 秒拉一次；平时 15 秒，别给 5Hz 同步添负担
    var interval = (curPanel === 'farm' || curPanel === 'relation' || curPanel === 'mine') ? 6 : 15;
    if (t - S.farm.lastPoll >= interval) {
      S.farm.lastPoll = t;
      farmState();
    }
  };

  // 面板打开时收起右侧农场条：它压在宽面板上会挡住标题与滚动条
  var _openPanelFarm = openPanel;
  openPanel = function (id) {
    var r = _openPanelFarm(id);
    if (UI.farmBar) UI.farmBar.style.display = curPanel ? 'none' : '';
    // v5.5：farm/relation/mine 首次成功渲染后摘对应 dock 角标
    if (curPanel === id && (id === 'farm' || id === 'relation' || id === 'mine')) {
      var b = UI.farmDockBtns && UI.farmDockBtns[id];
      if (b && b.className.indexOf('is-new') >= 0) {
        b.className = b.className.replace(/\s*is-new/, '');
        sg5NewMark(id);
      }
    }
    return r;
  };
  var _closePanelFarm = closePanel;
  closePanel = function () {
    var r = _closePanelFarm();
    if (UI.farmBar) UI.farmBar.style.display = '';
    return r;
  };

  var _mountFarm = mount;
  mount = function (container, context) {
    _mountFarm(container, context);
    // 只重置瞬时量：p/data 由随后的 applyEnter 覆盖，提前清空反而会丢首帧
    S.farm.lastPoll = 0; S.farm.rtBound = 0; S.farm.qte = null;
    S.farm.sel = null; S.farm.bagSel = null; S.farm.tool = 'hoe';
    S.farm.relGiftTo = ''; S.farm.loadState = 'loading'; S.farm.lastError = '';
    // v5.6 W1：竞态锁随挂载复位（锁在 S 上，refreshPanel 不动它们）
    S.farmBusy = 0; S.fishBusy = 0; S.panelBusy = 0;
    // v5.5：展台是瞬时视图；引导去重跨日持久（localStorage sg5hint 读回）
    S.farm.exhibitMode = false; S.farm.exhibitSel = [];
    farmHintLoad();
    if (window.__sg5) {
      window.__sg5.farm = {
        state: function () {
          var P = farmP();
          return { gold: P && P.gold, energy: P && P.energy, plots: P ? Object.keys(P.plots || {}).length : 0,
            crops: farmD().CROPS ? Object.keys(farmD().CROPS).length : 0,
            day: P && P.cal && P.cal.day, season: P && P.cal && P.cal.seasonName,
            tools: P && P.tools, skills: P && P.levels, spouse: P && P.spouse };
        },
        setDay: function (n) { return farmState(); },
        act: function (p, b) { return farmAct(p, b); },
        life: function (p, b) { return lifeAct(p, b); },
        tool: function (id) { farmSetTool(id); },
        teleportFarm: function () {
          var B = farmBounds();
          if (window.__sg5.teleport) window.__sg5.teleport(B.x + B.w / 2, B.y + B.h / 2);
        }
      };
    }
  };
