  // ---------------- §16 农场经营：状态 / 网络 / 世界层 ----------------
  // 扩展方式：只追加文件、不改旧文件。所有既有函数都用「保存原引用 → 重新赋值」包装，
  // 多次包装自动成链，一定先调 _orig 再干自己的事，避免吞掉 13/14 号文件的逻辑。

  S.farm = {
    p: null, data: null, tool: 'hoe', seed: '', tab: 'field',
    lastPoll: 0, epoch: 0, dirty: 0, rtBound: 0, qte: null,
    relationTab: 'villagers', mineTab: 'mine', sel: null, bagSel: null
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
      if (!n) n = FIX[base] || base;
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
    var M = { hay: '#d8c27a', wood: '#a9814f', coal: '#4a4a52', copper: '#c98452',
      iron: '#c8cdd4', gold: '#e5c45c', iridium: '#b9e6e2', gem: '#b58ad8',
      egg: '#f2e7c8', milk: '#eef1f4', wool: '#f0eade', truffle: '#8b6b52' };
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
    return apiGet('/shiguang/v5/farm/state').then(function (d) {
      if (d && d.farm) farmApply(d.farm);
      return d;
    }, function () { return null; });
  }
  function farmAct(path, body) {
    return apiPost('/shiguang/v5/farm/' + path, body || {}).then(function (d) {
      if (d && d.farm) farmApply(d.farm);
      if (curPanel === 'farm' || curPanel === 'relation' || curPanel === 'mine') refreshPanel(curPanel);
      return d;
    });
  }
  function lifeAct(path, body) {
    return apiPost('/shiguang/v5/life/' + path, body || {}).then(function (d) {
      if (d && d.farm) farmApply(d.farm);
      if (curPanel === 'farm' || curPanel === 'relation' || curPanel === 'mine') refreshPanel(curPanel);
      return d;
    });
  }
  function farmToast(text, kind) { toast(text, kind || ''); auSfx('menu', 0.2, 1.1); }

  // ---------- HUD：星露谷同款的时钟 / 季节 / 金币 / 体力 / 工具栏 ----------
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
      UI.farmEnergy.style.width = Math.round(pct * 100) + '%';
      UI.farmEnergy.className = 'sg5-farm-energy-fill' + (pct < 0.3 ? ' is-low' : '');
    }
    if (UI.farmToolBtns) {
      for (var i = 0; i < UI.farmToolBtns.length; i++) {
        var b = UI.farmToolBtns[i], on = b.getAttribute('data-tool') === S.farm.tool;
        b.className = 'sg5-farm-tool' + (on ? ' is-on' : '');
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
  }

  var _uiBuildFarm = uiBuild;
  uiBuild = function (root) {
    var r = _uiBuildFarm(root);
    var hud = UI.hud;
    var bar = el('div', 'sg5-farmbar');
    var left = el('div', 'sg5-farmbar-top');
    left.appendChild(el('span', 'sg5-farm-chip sg5-farm-clock', ''));
    left.appendChild(el('span', 'sg5-farm-chip sg5-farm-date', ''));
    left.appendChild(el('span', 'sg5-farm-chip sg5-farm-weather', ''));
    UI.farmClock = left.childNodes[0]; UI.farmDate = left.childNodes[1]; UI.farmWeather = left.childNodes[2];
    bar.appendChild(left);
    var row = el('div', 'sg5-farmbar-row');
    var gold = el('div', 'sg5-farm-gold');
    gold.appendChild(el('span', 'sg5-farm-gold-ch', '●'));
    gold.appendChild(el('span', 'sg5-farm-gold-tx', ''));
    UI.farmGold = gold.childNodes[1];
    row.appendChild(gold);
    var en = el('div', 'sg5-farm-energy');
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
        tools.appendChild(b); UI.farmToolBtns.push(b);
      }
    })();
    bar.appendChild(tools);
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
      dockBtn(UI.dock, 'farm', 'glyph:hoe', '农场', 'N');
      dockBtn(UI.dock, 'relation', 'glyph:heart', '小镇', 'R');
      dockBtn(UI.dock, 'mine', 'glyph:pick', '钓鱼 / 矿洞', 'H');
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
      var tag = document.activeElement && document.activeElement.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      var k = String(e.key || '').toLowerCase();
      if (k >= '1' && k <= '6') { farmSetTool(FARM_TOOLS[Number(k) - 1].id); e.preventDefault(); return; }
      if (k === 'q') { farmCycleSeed(); e.preventDefault(); return; }
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
    // 成熟：按形状结果 / 开花
    if (def.shape === 'flower') {
      ctx.fillStyle = col;
      for (var a = 0; a < 5; a++) {
        var ang = a * Math.PI * 2 / 5;
        ctx.beginPath();
        ctx.arc(sx + Math.cos(ang) * u * 0.11, top + Math.sin(ang) * u * 0.11, u * 0.085, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = '#f2d878'; ctx.beginPath(); ctx.arc(sx, top, u * 0.07, 0, Math.PI * 2); ctx.fill();
    } else if (def.shape === 'berry' || def.shape === 'round' || def.shape === 'root') {
      ctx.fillStyle = '#5f9149';
      ctx.fillRect(sx - u * 0.24, top - u * 0.02, u * 0.48, u * 0.1);
      if (p.ready) {
        ctx.fillStyle = col; ctx.strokeStyle = 'rgba(38,28,20,0.75)'; ctx.lineWidth = 1;
        var rr = def.shape === 'root' ? u * 0.14 : u * 0.17;
        ctx.beginPath(); ctx.arc(sx, top + u * 0.1, rr, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        ctx.fillStyle = 'rgba(255,255,255,0.35)';
        ctx.fillRect(sx - rr * 0.45, top + u * 0.02, Math.max(2, rr * 0.4), Math.max(2, rr * 0.35));
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
  };
  var _drawPropFarm = drawProp;
  drawProp = function (ctx, p) {
    if (p && p.k === 'farmcrop') { farmDrawCrop(ctx, p); return; }
    return _drawPropFarm(ctx, p);
  };

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
  var _doInteractFarm = doInteract;
  doInteract = function (t) {
    if (farmP() && farmNear() && farmWorldAction()) return;
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
    if (k === 'farm-sleep') { farmToast('一觉睡到天亮，体力回满了'); return true; }
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
    _socialTickFarm(t);
    if (!S.ready || !farmP()) return;
    if (UI.farmClock) {
      var c = farmCal(), ms = c.dayMs || 90000;
      setText(UI.farmClock, farmClock((Date.now() - S.farm.epoch) / ms));
    }
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
