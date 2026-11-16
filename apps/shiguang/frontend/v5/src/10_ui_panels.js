  // ---------------- §16 面板 ----------------
  // 面板只有一层：同时只开一个，再点同一个就关掉。手机上这一点比什么都重要 ——
  // 叠三层面板等于把半个屏幕糊住，还点不到底下的按钮。
  function uiBtn(text, cls, fn) {
    var b = el('button', 'sg5-btn' + (cls ? ' ' + cls : ''), text);
    b.type = 'button';
    b.addEventListener('click', function (e) { e.stopPropagation(); fn(); }, false);
    return b;
  }

  var ITEM_ICON = {
    potion: 'it_potionRed', ether: 'it_potionBlue', gel: 'food_Seed1', wood: 'fx_pWood',
    feather: 'fx_pLeaf', spore: 'food_Seed2', scale: 'food_Seed3', firefly: 'fx_pSpark',
    bone: 'wh_Bone', ore: 'fx_pRock', ice: 'fx_pSnow', ember: 'fx_pFire'
  };

  function rarityName(r) { return ['普通', '精良', '稀有', '史诗', '传说'][r] || '普通'; }
  function rarityColor(r) { return ['#e8e2d4', '#7fd36a', '#5fa8ff', '#c07bff', '#ffb84a'][r] || '#e8e2d4'; }

  var PANELS = {};
  var curPanel = '';

  function panelShell(title, sub) {
    var root = el('div', 'sg5-panel');
    var head = el('div', 'sg5-phead');
    head.appendChild(el('div', 'sg5-ptitle', title));
    if (sub) head.appendChild(el('div', 'sg5-psub', sub));
    var x = el('button', 'sg5-pclose', '×');
    x.type = 'button';
    x.addEventListener('click', function () { closePanel(); }, false);
    head.appendChild(x);
    root.appendChild(head);
    var body = el('div', 'sg5-pbody');
    root.appendChild(body);
    return { root: root, body: body };
  }

  function openPanel(id) {
    if (curPanel === id) return closePanel();
    curPanel = id;
    S.paused = false;
    clearNode(UI.panelWrap);
    var build = PANELS[id];
    if (build) {
      var p = build();
      if (p) UI.panelWrap.appendChild(p);
    }
    UI.panelWrap.className = 'sg5-panels is-on';
    refreshPanel(id);
  }

  function closePanel() {
    curPanel = '';
    UI.panelWrap.className = 'sg5-panels';
    clearNode(UI.panelWrap);
  }

  function refreshPanel(id) {
    if (!curPanel) return;
    if (id && id !== curPanel) return;
    var build = PANELS[curPanel];
    if (!build) return;
    // v5.3：面板重建会把 .sg5-pbody 的滚动位置和键盘焦点一起丢掉。
    // 只在农场三件套里做还原；v5.2 面板走原来的最短路径，一点都不碰。
    // 整段还原逻辑都包在 try/catch 里，任何异常都绝不能挡住下面的 build。
    var restore = (curPanel === 'farm' || curPanel === 'relation' || curPanel === 'mine');
    var oldScroll = 0, focusKey = '';
    if (restore) {
      try {
        var oldBody = UI.panelWrap.querySelector('.sg5-pbody');
        if (oldBody) oldScroll = oldBody.scrollTop || 0;
        var ae = document.activeElement;
        if (ae && ae.getAttribute) focusKey = ae.getAttribute('data-focus-key') || '';
      } catch (e) { restore = false; }
    }
    clearNode(UI.panelWrap);
    var p = build();
    if (p) UI.panelWrap.appendChild(p);
    if (restore) {
      try {
        // 顺序要紧：先还焦点再还滚动位置 —— .focus() 会把焦点元素滚进视野，
        // 若先设 scrollTop 会被它清零。
        if (focusKey) {
          var nodes = UI.panelWrap.querySelectorAll('[data-focus-key]');
          for (var i = 0; i < nodes.length; i++) {
            if (nodes[i].getAttribute('data-focus-key') === focusKey) { nodes[i].focus(); break; }
          }
        }
        var newBody = UI.panelWrap.querySelector('.sg5-pbody');
        if (newBody) {
          // 读一次 scrollHeight 强制排版：新建节点未排版时 scrollTop 会被夹到 0
          if (newBody.scrollHeight >= 0) newBody.scrollTop = oldScroll;
        }
      } catch (e) {}
    }
  }

  // ---------- 角色 ----------
  PANELS.char = function () {
    var me = S.me;
    var sh = panelShell('角色', 'Lv.' + (me.lv || 1) + ' · ' + (ZONE_NAMES[S.zone] || ''));
    var body = sh.body;
    // 装备
    var slots = el('div', 'sg5-slots');
    ['weapon', 'charm', 'cape'].forEach(function (slot) {
      var label = { weapon: '武器', charm: '护符', cape: '披风' }[slot];
      var it = (me.equip || {})[slot];
      var cell = el('div', 'sg5-slot');
      var ic = el('div', 'sg5-slot-ic');
      if (it) {
        var nm = it.slot === 'weapon'
          ? 'glyph:' + ({ staff: 'staff', lance: 'lance', twin: 'twin', hammer: 'hammer' }[it.kind] || 'sword')
          : (it.slot === 'charm' ? 'it_heart' : 'obj_ScrollEmpty');
        ic.appendChild(iconCanvas(nm, 44));
      }
      cell.appendChild(ic);
      cell.appendChild(el('div', 'sg5-slot-label', label));
      var nmEl = el('div', 'sg5-slot-name', it ? it.name : '（空）');
      if (it) nmEl.style.color = rarityColor(it.rarity);
      cell.appendChild(nmEl);
      if (it) {
        cell.appendChild(el('div', 'sg5-slot-atk', it.slot === 'weapon' ? '攻击 ' + it.atk : ''));
        var affixBox = el('div', 'sg5-affix');
        for (var k in it.affixes) {
          affixBox.appendChild(el('div', null, affixText(k, it.affixes[k])));
        }
        cell.appendChild(affixBox);
        cell.appendChild(uiBtn('卸下', 'sg5-btn-ghost', function () {
          apiUnequip(slot);
        }));
      }
      slots.appendChild(cell);
    });
    body.appendChild(slots);

    // 属性
    var st = S.stats || {};
    var grid = el('div', 'sg5-stats');
    [['攻击', (st.atk || 0).toFixed ? st.atk.toFixed(1) : st.atk], ['生命', me.maxHp],
      ['灯火上限', st.mp || 40], ['暴击率', (st.crit || 0) + '%'],
      ['暴击伤害', '+' + (st.critDmg || 0) + '%'], ['吸血', (st.leech || 0).toFixed(1) + '%'],
      ['灯火回复', '+' + Math.round(st.mpGain || 0) + '%'], ['移速', '+' + Math.round(st.speed || 0) + '%'],
      ['翻滚冷却', '-' + Math.round(st.dodgeCd || 0) + '%'], ['技能伤害', '+' + Math.round(st.skill || 0) + '%'],
      ['夜战', '+' + Math.round(st.night || 0) + '%'], ['武器手感', (st.weaponKind || 'sword')]].forEach(function (pair) {
      var r = el('div', 'sg5-statrow');
      r.appendChild(el('span', 'sg5-statk', pair[0]));
      r.appendChild(el('span', 'sg5-statv', String(pair[1])));
      grid.appendChild(r);
    });
    body.appendChild(grid);

    // 技能
    body.appendChild(el('div', 'sg5-sect', '技能'));
    var sk = el('div', 'sg5-skills');
    (me.skills || ['spin']).forEach(function (id) {
      var d = SKILLS[id];
      if (!d) return;
      var row = el('div', 'sg5-skillrow');
      row.appendChild(el('span', 'sg5-skillname', d.name));
      row.appendChild(el('span', 'sg5-skillcost', d.mp + ' 灯火'));
      row.appendChild(el('span', 'sg5-skilldesc', d.desc));
      sk.appendChild(row);
    });
    body.appendChild(sk);
    body.appendChild(el('div', 'sg5-note', '装备与天赋在背包 / 天赋面板里调整。武器手感决定普攻的判定形状：剑均衡，长枪远，双刃快，法杖远程，战锤重。'));
    return sh.root;
  };

  function affixText(k, v) {
    var names = {
      atk: '攻击', hp: '生命', crit: '暴击率', critDmg: '暴击伤害', leech: '吸血',
      mpGain: '灯火回复', speed: '移速', dodgeCd: '翻滚冷却', skill: '技能伤害', night: '夜战'
    };
    var unit = (k === 'atk' || k === 'hp') ? '' : '%';
    var sign = (k === 'dodgeCd') ? '-' : '+';
    return (names[k] || k) + ' ' + sign + v + unit;
  }

  // ---------- 背包 ----------
  PANELS.bag = function () {
    var me = S.me;
    var bag = me.bag || [];
    var sh = panelShell('装备', bag.length + ' / 60');
    var body = sh.body;
    if (!bag.length) {
      body.appendChild(el('div', 'sg5-empty', '背包是空的。去打点东西，或者开个箱子。'));
    }
    var list = el('div', 'sg5-list');
    bag.forEach(function (it) {
      var row = el('div', 'sg5-item');
      var ic = el('div', 'sg5-item-ic');
      var nm = it.slot === 'weapon'
        ? 'glyph:' + ({ staff: 'staff', lance: 'lance', twin: 'twin', hammer: 'hammer' }[it.kind] || 'sword')
        : (it.slot === 'charm' ? 'it_heart' : 'obj_ScrollEmpty');
      ic.appendChild(iconCanvas(nm, 26));
      row.appendChild(ic);
      var mid = el('div', 'sg5-item-mid');
      var title = el('div', 'sg5-item-name', it.name);
      title.style.color = rarityColor(it.rarity);
      mid.appendChild(title);
      var sub = el('div', 'sg5-item-sub', rarityName(it.rarity) + ' · iLv' + it.ilvl + (it.slot === 'weapon' ? ' · 攻击 ' + it.atk : ''));
      mid.appendChild(sub);
      var af = [];
      for (var k in it.affixes) af.push(affixText(k, it.affixes[k]));
      if (af.length) mid.appendChild(el('div', 'sg5-item-affix', af.join('  ')));
      row.appendChild(mid);
      var ops = el('div', 'sg5-item-ops');
      ops.appendChild(uiBtn('装备', 'sg5-btn-sm', function () { apiEquip(it.uid); }));
      ops.appendChild(uiBtn('卖 ' + sellOf(it), 'sg5-btn-sm sg5-btn-ghost', function () { apiSell([it.uid]); }));
      row.appendChild(ops);
      list.appendChild(row);
    });
    body.appendChild(list);

    // 材料
    var mats = me.mats || {};
    var keys = Object.keys(mats);
    if (keys.length) {
      body.appendChild(el('div', 'sg5-sect', '材料与消耗品'));
      var mg = el('div', 'sg5-mats');
      var MAT_NAME = {
        gel: '果冻', wood: '灵竹', feather: '夜羽', spore: '孢子', scale: '泽鳞', firefly: '萤火',
        bone: '骨片', ore: '星岩矿', ice: '永冻晶', ember: '长夜余烬', potion: '回血药', ether: '灯油'
      };
      keys.forEach(function (k) {
        var cell = el('div', 'sg5-mat');
        cell.appendChild(iconCanvas(ITEM_ICON[k] || 'it_coin', 22));
        cell.appendChild(el('span', 'sg5-matname', MAT_NAME[k] || k));
        cell.appendChild(el('span', 'sg5-matn', '×' + mats[k]));
        if (k === 'potion' || k === 'ether') {
          cell.addEventListener('click', function () { apiUse(k); }, false);
          cell.className += ' is-usable';
        }
        mg.appendChild(cell);
      });
      body.appendChild(mg);
    }
    return sh.root;
  };

  function sellOf(it) { return Math.round((4 + it.ilvl * 1.6) * (1 + it.rarity * it.rarity * 0.9)); }

  // ---------- 锻造 ----------
  PANELS.forge = function () {
    var me = S.me;
    var sh = panelShell('铁匠铺', '重铸词条 · 星屑 ' + fmt(me.shards));
    var body = sh.body;
    body.appendChild(el('div', 'sg5-note', '重铸会重抽一件装备的全部词条（稀有度与基础攻击保留）。这是星屑最主要的去处。'));
    ['weapon', 'charm', 'cape'].forEach(function (slot) {
      var it = (me.equip || {})[slot];
      if (!it) return;
      var cost = 30 * (1 + (it.ilvl | 0));
      var row = el('div', 'sg5-forge');
      row.appendChild(el('div', 'sg5-forge-name', it.name));
      var aff = [];
      for (var k in it.affixes) aff.push(affixText(k, it.affixes[k]));
      row.appendChild(el('div', 'sg5-forge-affix', aff.join('  ')));
      row.appendChild(el('div', 'sg5-forge-cost', '花费 ' + cost + ' 星屑 + 1 星岩矿'));
      var b = uiBtn('重铸', 'sg5-btn-sm', function () { apiForge(slot); });
      row.appendChild(b);
      body.appendChild(row);
    });
    return sh.root;
  };

  // ---------- 天赋 ----------
  // v5.6 W4：文案改为读服务端下发的 talentDefs（enter 前空档兜底旧文案），mod 数值不下发
  var TALENT_FALLBACK = {
    blade: { name: '剑', color: '#ff8a6a', tiers: [
      { id: 'b1', name: '锋利', desc: '攻击 +8%' }, { id: 'b2', name: '连斩', desc: '连击最后一段伤害 +25%' },
      { id: 'b3', name: '破甲', desc: '对精英与守护者伤害 +15%' }, { id: 'b4', name: '嗜血', desc: '吸血 +3%' },
      { id: 'b5', name: '剑舞', desc: '普攻每 5 次自动释放一次小回旋' } ] },
    shadow: { name: '影', color: '#9a8aff', tiers: [
      { id: 's1', name: '轻身', desc: '移速 +6%' }, { id: 's2', name: '残影', desc: '翻滚冷却 -20%' },
      { id: 's3', name: '致命', desc: '暴击率 +8%' }, { id: 's4', name: '见切', desc: '完美闪避窗口 +60%，子弹时间更长' },
      { id: 's5', name: '影袭', desc: '完美闪避后瞬移到敌人背后并暴击' } ] },
    lamp: { name: '灯', color: '#ffd36a', tiers: [
      { id: 'l1', name: '暖光', desc: '生命 +12%' }, { id: 'l2', name: '添油', desc: '灯火回复 +30%' },
      { id: 'l3', name: '照夜', desc: '夜间视野 +50%，对幽灵伤害 +40%' }, { id: 'l4', name: '共明', desc: '身边 6 格内队友攻击 +10%' },
      { id: 'l5', name: '不灭', desc: '致命伤害时保留 1 点生命（每 90 秒一次）' } ] }
  };
  PANELS.talent = function () {
    var me = S.me;
    var defs = (S.me && S.me.talentDefs) || TALENT_FALLBACK;
    var left = me.talentLeft || 0;
    var sh = panelShell('天赋', '可用点数 ' + left + '（每 3 级 1 点）');
    var body = sh.body;
    Object.keys(defs).forEach(function (key) {
      var L = defs[key];
      var box = el('div', 'sg5-tline');
      var head = el('div', 'sg5-tline-head', L.name + ' 之线');
      head.style.color = L.color;
      box.appendChild(head);
      var have = (me.talents || {})[key] || 0;
      L.tiers.forEach(function (t, i) {
        var on = i < have;
        var node = el('div', 'sg5-tnode' + (on ? ' is-on' : ''));
        node.appendChild(el('span', 'sg5-tdot', String(i + 1)));
        node.appendChild(el('span', 'sg5-ttxt', t.name + ' ' + t.desc));
        if (!on && i === have) {
          var b = uiBtn('学', 'sg5-btn-sm', function () { apiTalent(key); });
          b.disabled = left <= 0;
          node.appendChild(b);
        }
        box.appendChild(node);
      });
      body.appendChild(box);
    });
    return sh.root;
  };

  // ---------- 图鉴 ----------
  PANELS.dex = function () {
    var me = S.me;
    var dex = me.dex || {};
    // v5.7：图鉴分「怪物 / 世界」两页签 —— 世界承载《灯火纪》编年史、守塔人日记与风物志
    var sh = panelShell('图鉴', '击杀 ' + Object.keys(dex).length + ' 种怪物');
    var body = sh.body;
    var cur = S.farm && S.farm.dexTab === 'world' ? 'world' : 'mob';
    var tabs = el('div', 'sg5-tabs');
    [['mob', '怪物'], ['world', '世界']].forEach(function (t) {
      var tb = el('button', 'sg5-tab' + (cur === t[0] ? ' is-on' : ''), t[1]);
      tb.type = 'button';
      tb.setAttribute('data-focus-key', 'dextab:' + t[0]);
      tb.addEventListener('click', function () {
        S.farm = S.farm || {}; S.farm.dexTab = t[0];
        refreshPanel('dex');
      }, false);
      tabs.appendChild(tb);
    });
    body.appendChild(tabs);
    var page = el('div', 'sg5-farm-cont');
    if (cur === 'world') {
      loreWorldTab(page);
      body.appendChild(page);
      return sh.root;
    }
    var mobName = {
      slime: '果冻史莱姆', slime2: '薄荷史莱姆', bamboo: '竹精', mouse: '偷灯鼠', eye: '雾眼',
      mushroom: '孢子菇', owl: '夜枭', beast: '林兽', snake: '泽蛇', frog: '泽蛙法师',
      larva: '萤虫', lantern: '迷途灯笼', skull: '守岩骷髅', cyclope: '独眼巨魔', mole: '掘岩鼹',
      reptile: '霜蜥', spirit2: '冰魄', dragon: '幼龙', octopus: '渊章', flam: '长夜火', ghost: '长夜幽灵'
    };
    var grid = el('div', 'sg5-dexgrid');
    Object.keys(mobName).forEach(function (k) {
      var n = dex['m_' + k] || 0;
      var cell = el('div', 'sg5-dexcell' + (n ? '' : ' is-unknown'));
      cell.appendChild(iconCanvas(n ? (MOB_SPRITE[k] || 'mon_Slime') : 'mon_Slime', 34));
      cell.appendChild(el('div', 'sg5-dexname', n ? mobName[k] : '？？？'));
      cell.appendChild(el('div', 'sg5-dexct', n ? '×' + n : '未见过'));
      grid.appendChild(cell);
    });
    page.appendChild(grid);

    page.appendChild(el('div', 'sg5-sect', '灯塔（全服进度）'));
    var tg = el('div', 'sg5-towers');
    ZONE_ORDER.forEach(function (z) {
      var lit = !!S.towers[z];
      var row = el('div', 'sg5-trow' + (lit ? ' is-lit' : ''));
      row.appendChild(el('span', 'sg5-tname', ZONE_NAMES[z]));
      row.appendChild(el('span', 'sg5-tstate', lit ? '已点亮' : '长夜笼罩'));
      tg.appendChild(row);
    });
    page.appendChild(tg);

    page.appendChild(el('div', 'sg5-sect', '宝箱'));
    var total = (S.map.chests || []).length;
    var got = Object.keys(S.chests).length;
    page.appendChild(el('div', 'sg5-note', '已开启 ' + got + ' / ' + total + ' 个宝箱（个人进度）'));
    body.appendChild(page);
    return sh.root;
  };

  // ---------- 大地图 ----------
  PANELS.map = function () {
    var sh = panelShell('地图', '拖不动它，但它知道你走到过哪里');
    var body = sh.body;
    var cv = document.createElement('canvas');
    var size = Math.min(S.view.w - 60, S.view.h - 150);
    size = Math.max(220, Math.min(520, size));
    cv.width = size; cv.height = size;
    cv.className = 'sg5-bigmap';
    var g = cv.getContext('2d');
    g.imageSmoothingEnabled = false;
    var scale = size / S.map.size;
    g.fillStyle = '#070a14';
    g.fillRect(0, 0, size, size);
    g.drawImage(MINI.base, 0, 0, S.map.size, S.map.size, 0, 0, size, size);
    g.drawImage(MINI.mask, 0, 0, S.map.size, S.map.size, 0, 0, size, size);
    // 灯塔
    ZONE_ORDER.forEach(function (z) {
      var t = S.map.towers[z];
      if (!t) return;
      g.fillStyle = S.towers[z] ? '#ffd98a' : '#7a7f96';
      g.beginPath();
      g.arc(t.x * scale, t.y * scale, 4, 0, 6.2832);
      g.fill();
      g.font = '11px system-ui,sans-serif';
      g.fillStyle = S.towers[z] ? 'rgba(255,230,170,0.95)' : 'rgba(170,175,200,0.85)';
      g.textAlign = 'center';
      g.fillText(ZONE_NAMES[z], t.x * scale, t.y * scale - 7);
    });
    // 传送石
    (S.map.waystones || []).forEach(function (w) {
      if ((S.waystones || []).indexOf(w.id) < 0) return;
      g.fillStyle = '#8fd3ff';
      g.fillRect(w.x * scale - 2, w.y * scale - 2, 4, 4);
    });
    // 我 + 队友
    for (var id in S.players) {
      var p = S.players[id];
      g.fillStyle = '#7fd36a';
      g.beginPath();
      g.arc(p.x * scale, p.y * scale, 3, 0, 6.2832);
      g.fill();
    }
    if (S.me) {
      g.fillStyle = '#fff2c0';
      g.beginPath();
      g.arc(S.me.x * scale, S.me.y * scale, 4, 0, 6.2832);
      g.fill();
      g.strokeStyle = 'rgba(255,255,255,0.5)';
      g.beginPath();
      g.arc(S.me.x * scale, S.me.y * scale, 9, 0, 6.2832);
      g.stroke();
    }
    body.appendChild(cv);
    body.appendChild(el('div', 'sg5-note', '金色 = 已点亮的灯塔，灰色 = 还在长夜里。蓝点是已激活的传送石。'));
    return sh.root;
  };

  // v5.6 W3：材料可卖 —— 客户端侧售价表（与 backend/v5/data.js D.ITEMS.sell 一致）
  var MAT_SELL = { gel: 2, wood: 3, feather: 5, spore: 5, scale: 8, firefly: 10, bone: 12, ore: 14, ice: 20, ember: 40 };
  var MAT_NAME = {
    gel: '果冻', wood: '灵竹', feather: '夜羽', spore: '孢子', scale: '泽鳞', firefly: '萤火',
    bone: '骨片', ore: '星岩矿', ice: '永冻晶', ember: '长夜余烬', potion: '回血药', ether: '灯油'
  };
  S.shopTab = 'goods';

  // ---------- 商店 ----------
  PANELS.shop = function () {
    var me = S.me;
    var sh = panelShell('杂货铺', '星屑 ' + fmt(me.shards));
    var body = sh.body;
    // v5.6 W3：材料页签 —— 消耗品 / 材料 两个子页
    var tabs = el('div', 'sg5-tabs');
    [['goods', '消耗品'], ['mats', '材料']].forEach(function (t) {
      var on = S.shopTab === t[0];
      var b = el('button', 'sg5-tab' + (on ? ' is-on' : ''), t[1]);
      b.type = 'button';
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', on ? 'true' : 'false');
      b.addEventListener('click', function () { S.shopTab = t[0]; refreshPanel('shop'); auSfx('menu', 0.2, 1.1); }, false);
      tabs.appendChild(b);
    });
    body.appendChild(tabs);
    if (S.shopTab === 'mats') {
      var mats = me.mats || {};
      var keys = Object.keys(mats).filter(function (k) { return MAT_SELL[k] && mats[k] > 0; });
      if (!keys.length) {
        body.appendChild(el('div', 'sg5-empty', '背包里还没有能卖的材料。打怪会掉。'));
      }
      keys.forEach(function (k) {
        var n = mats[k];
        var row = el('div', 'sg5-shoprow');
        row.appendChild(iconCanvas(ITEM_ICON[k] || 'it_coin', 28));
        var mid = el('div', 'sg5-shopmid');
        mid.appendChild(el('div', 'sg5-shopname', MAT_NAME[k] || k));
        mid.appendChild(el('div', 'sg5-shopdesc', '×' + n + ' · 卖 1 个得 ' + MAT_SELL[k] + ' 星屑' + (n > 1 ? ' · 全部得 ' + MAT_SELL[k] * n : '')));
        row.appendChild(mid);
        row.appendChild(uiBtn('卖 1', 'sg5-btn-sm', function () {
          var m2 = {}; m2[k] = 1; apiSell({ mats: m2 });
        }));
        row.appendChild(uiBtn('全部', 'sg5-btn-sm sg5-btn-ghost', function () {
          var m2 = {}; m2[k] = n; apiSell({ mats: m2 });
        }));
        body.appendChild(row);
      });
      body.appendChild(el('div', 'sg5-note', '材料换星屑，即时到账。星岩矿留着点天赋重铸更划算。'));
      return sh.root;
    }
    [['potion', '回血药', '回复 45% 生命', 15], ['ether', '灯油', '回复 60% 灯火', 12]].forEach(function (x) {
      var row = el('div', 'sg5-shoprow');
      row.appendChild(iconCanvas(ITEM_ICON[x[0]], 28));
      var mid = el('div', 'sg5-shopmid');
      mid.appendChild(el('div', 'sg5-shopname', x[1]));
      mid.appendChild(el('div', 'sg5-shopdesc', x[2]));
      row.appendChild(mid);
      row.appendChild(el('div', 'sg5-shopcost', x[3] + ' 星屑'));
      row.appendChild(uiBtn('买 1', 'sg5-btn-sm', function () { apiBuy(x[0], 1); }));
      row.appendChild(uiBtn('买 5', 'sg5-btn-sm sg5-btn-ghost', function () { apiBuy(x[0], 5); }));
      body.appendChild(row);
    });
    body.appendChild(el('div', 'sg5-note', '只在拾光镇卖。出门前记得带够。'));
    return sh.root;
  };

  // ---------- NPC 对话 ----------
  function openNpc(npc) {
    curPanel = 'npc';
    clearNode(UI.panelWrap);
    var sh = panelShell(npc.name, '');
    var body = sh.body;
    var line = npc.line[(Math.random() * npc.line.length) | 0];
    body.appendChild(el('div', 'sg5-dialog', line));
    // 每个 NPC 一条三步支线，直接在对话里显示进度
    var qid = 'q_' + npc.id;
    var qb = questBlock(qid);
    if (qb) body.appendChild(qb);
    if (npc.action === 'forge') body.appendChild(uiBtn(npc.actionText, '', function () { openPanel('forge'); }));
    if (npc.action === 'shop') body.appendChild(uiBtn(npc.actionText, '', function () { openPanel('shop'); }));
    if (npc.action === 'rest') body.appendChild(uiBtn(npc.actionText, '', function () { apiRest(); }));
    if (npc.action === 'story') body.appendChild(uiBtn(npc.actionText, '', function () { storyTalk(); }));
    if (S.party && S.party.members && S.party.members.length > 1) {
      body.appendChild(uiBtn('退出队伍', 'sg5-btn-ghost', function () { apiLeaveParty(); closePanel(); }));
    }
    UI.panelWrap.appendChild(sh.root);
    UI.panelWrap.className = 'sg5-panels is-on';
  }

  function storyTalk() {
    // v5.7《灯火纪》：栗的独白随点亮座数推进 —— 这是主线之外最重要的情感锚点
    closePanel();
    loreCard('守灯人 栗', '名册 · 铜钥匙 · 灯火', loreKeeperLine(), 'plain');
    auSfx('menu', 0.3, 1.1);
  }

  // ---------- 设置 ----------
  PANELS.help = function () {
    var sh = panelShell('设置与说明', '拾光群岛 v5「长夜」');
    var body = sh.body;
    var row = el('div', 'sg5-setrow');
    row.appendChild(el('span', null, '音效与音乐'));
    var b = uiBtn(S.audio.on ? '开' : '关', 'sg5-btn-sm', function () {
      S.audio.on = !S.audio.on;
      auSetOn(S.audio.on);
      try { S.storage.set('snd', S.audio.on ? '1' : '0'); } catch (e) {}
      refreshPanel('help');
    });
    row.appendChild(b);
    body.appendChild(row);
    body.appendChild(el('div', 'sg5-sect', '操作'));
    body.appendChild(el('div', 'sg5-keys',
      '移动：WASD / 方向键 / 左半屏摇杆　·　攻击：J / 空格　·　翻滚：K　·　技能：L　·　交互：E\n' +
      '角色 C　·　装备 B　·　地图 M　·　怪物图鉴 V　·　天赋 T　·　关闭面板 Esc\n\n' +
      '农场 N　·　小镇 R　·　钓鱼/矿洞 H\n' +
      '翻滚的前 0.22 秒无敌。在怪物出招前 0.15 秒内翻滚 = 完美闪避（子弹时间 + 下一击必暴击）。'));
    // v5.4 新增说明（新 DOM 新文案，原有键位表逐字节未动）
    body.appendChild(el('div', 'sg5-note',
      'v5.4：靠近野味/树木按 E 采集或砍树 · 斧头不用装进工具栏 · 加工在农场面板「加工」页签'));
    body.appendChild(el('div', 'sg5-note',
      'v5.7《灯火纪》：世界变大了 —— 六域之外还有长夜之心。草原、林间、冰原上散落着守塔人的石碑，' +
      '碑顶发亮就是还没读过的日记；走近按 E 阅读并收下，图鉴的「世界」页签可以随时重读。' +
      '每点亮一座灯塔，全班都会听到那位守塔人的灯语。'));
    body.appendChild(el('div', 'sg5-sect', '关于'));
    body.appendChild(el('div', 'sg5-note',
      '一个班同在一片大世界里：白天探索、打怪、攒材料；入夜后长夜从雾里涌出来，' +
      '大家回到灯边一起守夜。你点亮的每一座灯塔，全班的世界都会变亮。'));
    body.appendChild(el('div', 'sg5-note sg5-credit',
      '美术与音频：Ninja Adventure Asset Pack（Pixel-boy & AAA，CC0）· ' +
      '前端 Canvas 2D 程序绘制地形/光照/雾 · 服务端 10Hz 世界模拟'));
    return sh.root;
  };
