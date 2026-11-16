  // ---------------- §17 农场面板：田地 / 商店 / 背包 / 出货 / 技能 / 日历 ----------------

  GLYPH.hoe = [
    '.........##.',
    '........###.',
    '.......###..',
    '......###...',
    '.....###....',
    '....###.....',
    '...###......',
    '..###.......',
    '.##.........'
  ];
  GLYPH.heart = [
    '..###..###..',
    '.#####.#####',
    '############',
    '############',
    '.##########.',
    '..########..',
    '...######...',
    '....####....',
    '.....##.....'
  ];
  GLYPH.pick = [
    '....###.....',
    '..#######...',
    '.#########..',
    '....###.....',
    '....###.....',
    '...###......',
    '..###.......',
    '.###........',
    '.##.........'
  ];

  // ---- v5.4 多色字形：palette 传主色（与 farmItemColor 的 M 表一致） ----
  // 字符约定：'#' 主色 / 'o' 亮部 / '+' 次色 / '.' 空白；不传 palette 时只画 '#'。
  GLYPH.bar = [
    '............',
    '...oooooo...',
    '..########..',
    '...######...',
    '............',
    '...oooooo...',
    '..########..',
    '...######...',
    '............',
    '............'
  ];
  GLYPH.for_flower = [
    '...++++++...',
    '..++oooo++..',
    '.+++oooo+++.',
    '.+++oooo+++.',
    '..++oooo++..',
    '...++++++...',
    '.....##.....',
    '.....##.....',
    '.....##.....',
    '.....##.....',
    '.....#......',
    '............'
  ];
  GLYPH.for_root = [
    '....##.##...',
    '...###.###..',
    '....#####...',
    '.....###....',
    '....+++++...',
    '....+++++...',
    '....++++....',
    '.....+++....',
    '.....++.....',
    '......+.....',
    '............',
    '............'
  ];
  GLYPH.for_berry = [
    '.....##.....',
    '....#++#....',
    '....#++#....',
    '.....##.....',
    '..##....##..',
    '.#++#..#++#.',
    '.#++#..#++#.',
    '..##....##..',
    '.....#......',
    '....##......',
    '............',
    '............'
  ];
  GLYPH.for_fruit = [
    '......##....',
    '.....##.....',
    '...######...',
    '..+######+..',
    '.++######++.',
    '.++######++.',
    '.++######++.',
    '..+######+..',
    '...######...',
    '....####....',
    '............',
    '............'
  ];
  GLYPH.mayonnaise = [
    '..oooooooo..',
    '..oooooooo..',
    '.##########.',
    '.#oooooooo#.',
    '.#oooooooo#.',
    '.#oooooooo#.',
    '.#oooooooo#.',
    '.#oooooooo#.',
    '.##########.',
    '............',
    '............',
    '............'
  ];
  GLYPH.cheese = [
    '.........##.',
    '.......####.',
    '.....######.',
    '...########.',
    '.+#########.',
    '++#########.',
    '+++o####o##.',
    '.++########.',
    '..########..',
    '............',
    '............',
    '............'
  ];
  GLYPH.drink = [
    '.##########.',
    '.#oooooooo#.',
    '.#oooooooo#.',
    '.#oooooooo#.',
    '.#oooooooo#.',
    '.#oooooooo#.',
    '.#oooooooo#.',
    '.##########.',
    '....##......',
    '....##......',
    '..#######...',
    '............'
  ];
  GLYPH.machine_furnace = [
    '..########..',
    '.#oooooooo#.',
    '.#oooooooo#.',
    '.##oooooo##.',
    '.#oooooooo#.',
    '.#oo++++oo#.',
    '.#oo++++oo#.',
    '.#oooooooo#.',
    '.#oooooooo#.',
    '..########..',
    '............',
    '............'
  ];
  GLYPH.machine_mayo = [
    '.....oo.....',
    '....oooo....',
    '............',
    '.##########.',
    '.#oooooooo#.',
    '.#oo++++oo#.',
    '.#oooooooo#.',
    '.#oooooooo#.',
    '.##########.',
    '...##..##...',
    '............',
    '............'
  ];
  GLYPH.machine_cheese = [
    '.....##.....',
    '.....##.....',
    '...######...',
    '...######...',
    '.##########.',
    '.#oooooooo#.',
    '.#oooooooo#.',
    '.##########.',
    '.#oooooooo#.',
    '.##########.',
    '............',
    '............'
  ];
  GLYPH.machine_keg = [
    '...######...',
    '..########..',
    '.##oooooo##.',
    '.#oooooooo#.',
    '.#o##oo##o#.',
    '.#o##oo##o#.',
    '.#oooooooo#.',
    '.##oooooo##.',
    '..########..',
    '...######...',
    '............',
    '............'
  ];
  GLYPH.machine_stove = [
    '..oooooooo..',
    '..o......o..',
    '..oooooooo..',
    '.##########.',
    '.#oooooooo#.',
    '.#o++++++o#.',
    '.#o++++++o#.',
    '.#oooooooo#.',
    '.##########.',
    '.##......##.',
    '............',
    '............'
  ];
  var PAL_STEM = '#4b7a3e', PAL_LEAF = '#5c8a3c', PAL_DARK = '#3a2a20';
  var FARM_ICON = {
    copper_bar: { glyph: 'bar', pal: { '#': '#c98452', 'o': '#e8b088' } },
    iron_bar: { glyph: 'bar', pal: { '#': '#c8cdd4', 'o': '#eef1f4' } },
    gold_bar: { glyph: 'bar', pal: { '#': '#e5c45c', 'o': '#f6e2a0' } },
    iridium_bar: { glyph: 'bar', pal: { '#': '#b9e6e2', 'o': '#e2f6f4' } },
    hardwood: { glyph: 'bar', pal: { '#': '#8a6a48', 'o': '#b08a5e' } },
    mayonnaise: { glyph: 'mayonnaise', pal: { '#': '#6b543c', 'o': '#f6efc0' } },
    cheese: { glyph: 'cheese', pal: { '#': '#e8c060', '+': '#f2dc9a', 'o': '#b98a3a' } },
    pale_ale: { glyph: 'drink', pal: { '#': '#6b4b2a', 'o': '#e8b84a' } },
    beer: { glyph: 'drink', pal: { '#': '#5a3d20', 'o': '#d89830' } },
    food_soup: { sprite: 'food_Beaf' },
    food_stirfry: { sprite: 'food_Noodle' },
    food_grilled: { sprite: 'food_Fish' },
    food_sushi: { sprite: 'food_Sushi' },
    food_bento: { sprite: 'food_Onigiri' },
    food_cookie: { sprite: 'food_FortuneCookie' },
    food_tea: { sprite: 'food_TeaLeaf' },
    food_honey: { sprite: 'food_Honey' },
    horseradish: { glyph: 'for_root', pal: { '+': '#e8e2d0', '#': PAL_LEAF } },
    daffodil: { glyph: 'for_flower', pal: { '+': '#f0d858', 'o': '#f8eeaa', '#': PAL_STEM } },
    leek: { glyph: 'for_root', pal: { '+': '#b8cc88', '#': PAL_LEAF } },
    dandelion: { glyph: 'for_flower', pal: { '+': '#f0c840', 'o': '#f8e698', '#': PAL_STEM } },
    spice_berry: { glyph: 'for_berry', pal: { '+': '#d86a4a', '#': PAL_DARK } },
    sweet_pea: { glyph: 'for_flower', pal: { '+': '#c878d8', 'o': '#e4b4ec', '#': PAL_STEM } },
    summer_grape: { glyph: 'for_berry', pal: { '+': '#8868b8', '#': PAL_DARK } },
    hazelnut: { glyph: 'for_fruit', pal: { '+': '#c8a068', '#': '#a87848' } },
    wild_plum: { glyph: 'for_fruit', pal: { '+': '#a878c8', '#': '#8858a8' } },
    blackberry: { glyph: 'for_berry', pal: { '+': '#70708c', '#': PAL_DARK } },
    crystal_fruit: { glyph: 'for_fruit', pal: { '+': '#d8f4f8', '#': '#a8e0e8' } },
    snow_yam: { glyph: 'for_root', pal: { '+': '#e8d0b0', '#': PAL_LEAF } },
    winter_root: { glyph: 'for_root', pal: { '+': '#c8a878', '#': PAL_LEAF } },
    furnace: { glyph: 'machine_furnace', pal: { '#': '#4a4038', 'o': '#5a5048', '+': '#e87830' } },
    mayo_machine: { glyph: 'machine_mayo', pal: { '#': '#6b543c', 'o': '#e8e2d0', '+': '#f2d878' } },
    cheese_press: { glyph: 'machine_cheese', pal: { '#': '#8a8078', 'o': '#e8c060' } },
    keg: { glyph: 'machine_keg', pal: { '#': '#6b4b2a', 'o': '#a87848' } },
    stove: { glyph: 'machine_stove', pal: { '#': '#4a4038', 'o': '#5a5048', '+': '#e87830' } },
    // v5.5 彩蛋节：蛋形与彩券字形（定义见 09_ui_hud.js 的 GLYPH）
    egg: { glyph: 'egg', pal: { '#': '#f2e7c8', 'o': '#fffdf2', '+': '#c9963f' } },
    ticket: { glyph: 'ticket', pal: { '#': '#c9963f', 'o': '#ffd27a' } }
  };
  // 种子 A 轨：按季节 + 价格档取精灵（低 ≤40 / 中 ≤80 / 高）
  function seedSprite(cropId) {
    var c = farmD().CROPS[cropId];
    if (!c) return '';
    var s = (c.s && c.s.length) ? c.s[0] : -1;
    var t = c.seed <= 40 ? '1' : (c.seed <= 80 ? 'Big' : '');
    if (s === 0) return t === '1' ? 'food_Seed1' : (t === 'Big' ? 'food_SeedBig1' : 'food_SeedLarge');
    if (s === 1) return t === '1' ? 'food_Seed2' : (t === 'Big' ? 'food_SeedBig2' : 'food_SeedLarge');
    if (s === 2) return t === '1' ? 'food_Seed3' : (t === 'Big' ? 'food_SeedBig3' : 'food_SeedLarge');
    return 'food_SeedLargeWhite';
  }
  // 鱼 A 轨
  function fishSprite(id) {
    if (/^(bass|carp|ghostfish|sunfish|trout)$/.test(id)) return 'food_Fish';
    if (/^(squid|octopus)$/.test(id)) return 'food_Octopus';
    if (id === 'eel') return 'food_Shrimp';
    if (/^(redsnapper|tuna)$/.test(id)) return 'food_Sushi2';
    return '';
  }
  // v5.4：物品图标统一入口——图集精灵 / 多色字形 / 升级版色块三轨
  function farmIcon(id, size) {
    var base = String(id || '').split('_q')[0];
    var sz = size || 16;
    var wrap = el('span', 'sg5-farm-swatch');
    var spec = FARM_ICON[base];
    if (!spec && base.indexOf('seed_') === 0) {
      var sp = seedSprite(base.slice(5));
      if (sp) spec = { sprite: sp };
    }
    if (!spec) {
      var fs = fishSprite(base);
      if (fs) spec = { sprite: fs };
    }
    var cv = null;
    if (spec && spec.glyph && GLYPH[spec.glyph]) {
      cv = document.createElement('canvas');
      cv.width = Math.max(10, sz - 2); cv.height = Math.max(10, sz - 2);
      cv.className = 'sg5-farm-icon';
      paintGlyph(cv.getContext('2d'), spec.glyph, sz - 2, spec.pal);
    } else if (spec && spec.sprite && FR[spec.sprite] && S.atlas) {
      cv = iconCanvas(spec.sprite, Math.max(10, sz - 2));
      cv.className = 'sg5-farm-icon';
    }
    if (cv) wrap.appendChild(cv);
    else wrap.style.background = farmItemColor(id);
    var qc = farmQualityClass(id);
    if (qc) wrap.className += ' ' + qc;
    return wrap;
  }
  // v5.4：职业短标（20 个职业全部有，挂着的一眼能看到效果）
  var PROF_MARK = {
    tiller: '作物 +10%', rancher: '畜产 +20%', artisan: '加工品 +40%', agriculturist: '生长 +10%',
    miner: '矿石 +1', geologist: '宝石成对', blacksmith: '锭 +50%', prospector: '煤 ×2',
    forester: '木材 +1', gatherer: '采集 20% 双份', lumberjack: '硬木 50%', botanist: '采集必金星',
    fisher: '鱼价 +25%', trapper: '每日蟹 ×1', angler: '鱼价 +50%', pirate: '矿洞 5% 宝箱',
    fighter: '洞血 +15%', scout: '遇怪减半', brute: '承伤 -15%', defender: '洞血 +25'
  };

  var FARM_TABS = [
    ['field', '田地'], ['craft', '加工'], ['shop', '商店'], ['bag', '背包'],
    ['ship', '出货箱'], ['skill', '技能'], ['calendar', '日历']
  ];

  // v5.3：面板会被 refreshPanel 整棵重建，操作按钮带一个稳定的 data-focus-key，
  // 重建后 refreshPanel 才能把键盘焦点放回同名按钮（值只由可见文本决定，不带随机 id）。
  function opBtn(text, cls, fn) {
    var b = uiBtn(text, cls, fn);
    b.setAttribute('data-focus-key', 'op:' + text);
    return b;
  }

  // v5.3：载入/操作失败时在内容区顶部给一条可重试的错误块。
  // 不复用 .sg5-empty、不写「正在载入…」；S.farm.p 保留着，下面照常渲染旧数据。
  function farmErrBlock() {
    if (S.farm.loadState !== 'error' && !S.farm.lastError) return null;
    var box = el('div', 'sg5-farm-err');
    box.appendChild(el('span', 'sg5-farm-err-tx', S.farm.lastError || '农场数据没能载入，下面是上次的内容。'));
    box.appendChild(opBtn('重新载入', 'sg5-btn-sm', farmState));
    return box;
  }

  // v5.3：品质四档改由 CSS 的 swatch 状态类表达，不再往元素上写内联边框色
  function farmQualityClass(id) {
    var q = Number(String(id || '').split('_q')[1] || 0);
    return q >= 3 ? 'is-star' : (q === 2 ? 'is-ready' : (q === 1 ? 'is-have' : ''));
  }

  // v5.3：不可逆 / 批量操作两步确认。第一次点击不发任何请求，只把原按钮换成
  // 内联的「确定 / 取消」；点确定才执行原回调，点取消恢复原按钮，全程不碰 apiPost。
  function confirmOps(host, label, onYes, cls) {
    var orig = uiBtn(label, cls || 'sg5-btn-sm', function () {
      var parent = orig.parentNode;
      if (!parent) return;
      var next = orig.nextSibling;
      var yes = uiBtn('确定', 'sg5-btn-sm sg5-btn-primary', function () {
        farmSfx('menu', 0.3, 1.2);
        onYes();
      });
      var no = uiBtn('取消', 'sg5-btn-sm sg5-btn-ghost', function () {
        farmSfx('cancel', 0.3, 1);
        if (yes.parentNode) yes.parentNode.removeChild(yes);
        if (no.parentNode) no.parentNode.removeChild(no);
        if (!orig.parentNode) {
          if (next && next.parentNode === parent) parent.insertBefore(orig, next);
          else parent.appendChild(orig);
        }
      });
      parent.insertBefore(yes, orig);
      parent.insertBefore(no, orig);
      parent.removeChild(orig);
      try { yes.focus(); } catch (e) {}
    });
    if (host) host.appendChild(orig);
    return orig;
  }
  function farmTabs(body) {
    var tabs = el('div', 'sg5-tabs');
    tabs.setAttribute('role', 'tablist');
    (function () {
      for (var i = 0; i < FARM_TABS.length; i++) {
        (function (t) {
          var on = S.farm.tab === t[0];
          var b = el('button', 'sg5-tab' + (on ? ' is-on' : ''), t[1]);
          b.type = 'button';
          b.setAttribute('role', 'tab');
          b.setAttribute('aria-selected', on ? 'true' : 'false');
          b.setAttribute('data-focus-key', 'tab:' + t[0]);
          b.addEventListener('click', function () {
            S.farm.tab = t[0]; refreshPanel('farm'); auSfx('menu', 0.2, 1.1);
          }, false);
          tabs.appendChild(b);
        })(FARM_TABS[i]);
      }
    })();
    body.appendChild(tabs);
  }
  function farmSection(body, title, sub) {
    var s = el('div', 'sg5-sect');
    s.appendChild(el('div', 'sg5-farm-h', title));
    if (sub) s.appendChild(el('div', 'sg5-note', sub));
    return s;
  }
  function farmBtnRow(parent, items) {
    var row = el('div', 'sg5-farm-ops');
    (function () {
      for (var i = 0; i < items.length; i++) {
        (function (it) {
          // it[3] 为真 → 两步确认；it[4] 可覆盖稳定焦点键（如甩竿用 op:cast）
          var b = it[3]
            ? confirmOps(null, it[0], it[1], it[2] || 'sg5-btn-sm')
            : opBtn(it[0], it[2] || 'sg5-btn-sm', it[1]);
          if (it[4]) b.setAttribute('data-focus-key', it[4]);
          row.appendChild(b);
        })(items[i]);
      }
    })();
    parent.appendChild(row);
    return row;
  }
  function farmNeed(P, need) {
    var inv = P.inv || {};
    return (inv[need] || 0) >= 1;
  }

  // ---------- 田地 ----------
  function farmFieldBody(body) {
    var P = farmP(); if (!P) return;
    var D = farmD(), B = farmBounds(), c = P.cal;
    var head = el('div', 'sg5-farm-summary');
    head.appendChild(el('span', 'sg5-farm-sum', c.seasonName + ' ' + c.dayInSeason + '日 · ' + c.clock + ' · ' +
      (c.weather === 'rain' ? '下雨' : c.weather === 'snow' ? '下雪' : '晴')));
    head.appendChild(el('span', 'sg5-farm-sum', '● ' + P.gold + 'g'));
    head.appendChild(el('span', 'sg5-farm-sum', '体力 ' + P.energy + '/' + P.maxEnergy));
    head.appendChild(el('span', 'sg5-farm-sum', '工具 ' + (D.TOOL_NAMES[S.farm.tool] || S.farm.tool)));
    body.appendChild(head);
    farmBtnRow(body, [
      ['回自家田里', function () {
        farmAct('goto', {}).then(function (d) {
          if (d && d.x != null && window.__sg5 && window.__sg5.teleport) window.__sg5.teleport(d.x, d.y);
          farmToast('回到了田里');
        }, function (e) { farmToast(e.message, 'warn'); });
      }, 'sg5-btn-primary'],
      ['收工睡觉', function () {
        farmAct('sleep', {}).then(function () { farmToast('睡到天亮，体力回满'); }, function (e) { farmToast(e.message, 'warn'); });
      }],
      ['切换种子（Q）', function () { farmCycleSeed(); refreshPanel('farm'); }],
      ['小镇 / 献祭', function () { S.farm.tab = 'field'; openPanel('relation'); }]
    ]);

    var wrap = farmSection(body, '我的田 · ' + B.w + '×' + B.h,
      '点格子会自动判断：空地翻土 → 播种 → 浇水 → 收获。世界里站在田上按 E 则严格按手上的工具干活。');
    var grid = el('div', 'sg5-farm-grid');
    grid.style.setProperty('--farm-cols', String(B.w));
    (function () {
      for (var r = 0; r < B.h; r++) {
        for (var cc = 0; cc < B.w; cc++) {
          (function (r, cc) {
            var p = (P.plots || {})[r + ',' + cc];
            var cls = 'sg5-farm-cell', label = '·', tip = '空地';
            if (p && p.tilled) { cls += ' is-tilled'; label = '▤'; tip = '翻好的土'; }
            if (p && p.watered) { cls += ' is-watered'; }
            var def = p && p.crop && D.CROPS[p.crop];
            if (def) {
              var need = Math.max(1, Math.round(def.days * (P.profs && P.profs.indexOf('agriculturist') >= 0 ? 0.9 : 1)));
              var ready = p.harvested && def.regrow
                ? (P.cal.day - (p.regrowDay || P.cal.day) >= def.regrow) : (p.grow || 0) >= need;
              cls += ready ? ' is-ready' : ' is-growing';
              label = ready ? '★' : String(Math.floor(p.grow || 0)) + '/' + need;
              tip = def.name + (ready ? '（可收）' : ' · 还差 ' + Math.max(1, need - Math.floor(p.grow || 0)) + ' 天');
              if (ready) cls += ' is-star';
            }
            var b = el('button', cls, label);
            b.type = 'button';
            b.setAttribute('data-r', String(r));
            b.setAttribute('data-c', String(cc));
            b.setAttribute('data-focus-key', 'cell:' + r + ',' + cc);
            var act = ready ? '收获' : (p && p.crop ? '浇水' : (p && p.tilled ? '播种' : '翻土'));
            var desc = '第 ' + r + ' 行 ' + cc + ' 列 · ' + tip + ' · 点击将：' + act;
            b.setAttribute('title', desc);
            b.setAttribute('aria-label', desc);
            if (def) b.style.borderBottomColor = def.col;
            b.addEventListener('click', function () {
              // 记住最后碰过的格子：背包里的肥料 / 洒水器要往这儿放
              S.farm.sel = { r: r, c: cc };
              farmSmartAction(r, cc);
            }, false);
            grid.appendChild(b);
          })(r, cc);
        }
      }
    })();
    wrap.appendChild(grid);
    var legend = el('div', 'sg5-farm-legend');
    legend.appendChild(el('span', '', '▤ 已翻地'));
    legend.appendChild(el('span', '', '蓝色 已浇水'));
    legend.appendChild(el('span', '', '★ 可收获'));
    legend.appendChild(el('span', '', '数字 生长天数'));
    wrap.appendChild(legend);
    body.appendChild(wrap);

    // 工具升级区
    var tools = farmSection(body, '农具铺', '升级要金币 + 矿石锭，阿岩隔天打好送到手上。');
    var tl = el('div', 'sg5-farm-list');
    (function () {
      for (var k in D.TOOL_NAMES) {
        if (!Object.prototype.hasOwnProperty.call(D.TOOL_NAMES, k)) continue;
        (function (k) {
          var lv = (P.tools || {})[k] || 0;
          var up = lv < 4 ? D.TOOL_UPGRADES[lv] : null;
          var row = el('div', 'sg5-farm-row');
          row.appendChild(el('span', 'sg5-farm-rowname', D.TOOL_NAMES[k] + ' · ' + (lv ? D.TOOL_UPGRADES[lv - 1].name : '基础')));
          row.appendChild(el('span', 'sg5-farm-rowsub', up ? (up.cost + 'g + ' + up.bars + ' ' + farmItemName(up.bar)) : '已满级'));
          if (up && !P.toolOrder) {
            var b = opBtn('升级', 'sg5-btn-sm', function () {
              farmAct('tool', { tool: k }).then(function () { farmToast('送去升级了'); },
                function (e) { farmToast(e.message, 'warn'); });
            });
            row.appendChild(b);
          }
          tl.appendChild(row);
        })(k);
      }
    })();
    if (P.toolOrder) {
      tl.appendChild(el('div', 'sg5-note', '正在打造：' + D.TOOL_NAMES[P.toolOrder.tool] + ' → ' +
        P.toolOrder.name + '，第 ' + P.toolOrder.readyDay + ' 天取。'));
    }
    tools.appendChild(tl);
    body.appendChild(tools);
  }

  // ---------- 商店 ----------
  function farmShopBody(body) {
    var P = farmP(); if (!P) return;
    var D = farmD(), c = P.cal;
    // ---- v5.5 彩蛋节：顶部粉块横幅 + 三行彩券兑换 ----
    if (c.festival && c.festival.name === '彩蛋节' && D.EGG_REDEEM) {
      var fest = el('div', 'sg5-farm-festival sg5-farm-festival-banner');
      fest.appendChild(el('div', 'sg5-farm-festival-h', '彩蛋节 · 彩券兑换'));
      var rl = el('div', 'sg5-farm-list');
      var REDEEM_NAME = { seed_strawberry: '草莓种子 ×5', speedgro: '生长激素 ×5', gold: '200 金' };
      (function () {
        for (var rid in D.EGG_REDEEM) {
          if (!Object.prototype.hasOwnProperty.call(D.EGG_REDEEM, rid)) continue;
          (function (rid) {
            var def = D.EGG_REDEEM[rid];
            var have = P.inv.ticket || 0;
            var doneToday = P.eggRedeem && P.eggRedeem.day === c.day && P.eggRedeem[rid] > 0;
            var row = el('div', 'sg5-farm-row');
            row.appendChild(farmIcon('ticket', 16));
            row.appendChild(el('span', 'sg5-farm-rowname', REDEEM_NAME[rid] || rid));
            // 三态 chip：off 券不够 / have 可兑 / done 今天已换
            row.appendChild(el('span',
              'sg5-bundle-need ' + (doneToday ? 'is-done' : (have >= def.cost ? 'is-have' : 'is-off')),
              '彩券 ' + Math.min(have, def.cost) + '/' + def.cost));
            var b = opBtn('兑换', 'sg5-btn-sm', function () {
              lifeAct('egg/redeem', { id: rid }).then(function () {
                farmToast('兑换成功：' + (REDEEM_NAME[rid] || rid));
              }, function (e) { farmToast(e.message, 'warn'); });
            });
            if (doneToday || have < def.cost) b.disabled = true;
            row.appendChild(b);
            rl.appendChild(row);
          })(rid);
        }
      })();
      fest.appendChild(rl);
      body.appendChild(fest);
    }
    var seeds = farmSection(body, '种子铺 · ' + c.seasonName,
      P.greenhouse ? '温室已解锁，四季种子都能买。' : '只卖当季种子；过季种下的作物会在换季时枯掉。');
    var list = el('div', 'sg5-farm-list');
    (function () {
      for (var k in D.CROPS) {
        if (!Object.prototype.hasOwnProperty.call(D.CROPS, k)) continue;
        (function (k) {
          var def = D.CROPS[k];
          if (def.seed <= 0) return;
          if (!P.greenhouse && def.s.length && def.s.indexOf(c.season) < 0) return;
          if (k === 'strawberry' && !(c.festival && c.festival.perk === 'strawberry')) return;
          var row = el('div', 'sg5-farm-row');
          var nm = el('span', 'sg5-farm-rowname', def.name);
          nm.style.color = def.col;
          row.appendChild(nm);
          row.appendChild(el('span', 'sg5-farm-rowsub', def.days + '天 · 售 ' + def.sell + 'g' +
            (def.regrow ? ' · 每' + def.regrow + '天复收' : '') + (def.yield > 1 ? ' · 一次' + def.yield + '个' : '')));
          var b1 = opBtn(def.seed + 'g', 'sg5-btn-sm', function () {
            farmAct('buy', { kind: 'seed', id: 'seed_' + k, n: 1 }).then(function () { farmToast('买了 1 包' + def.name + '种子'); },
              function (e) { farmToast(e.message, 'warn'); });
          });
          var b5 = opBtn('×5', 'sg5-btn-sm', function () {
            farmAct('buy', { kind: 'seed', id: 'seed_' + k, n: 5 }).then(function () { farmToast('买了 5 包' + def.name + '种子'); },
              function (e) { farmToast(e.message, 'warn'); });
          });
          row.appendChild(b1); row.appendChild(b5);
          list.appendChild(row);
        })(k);
      }
    })();
    seeds.appendChild(list);
    body.appendChild(seeds);

    var animals = farmSection(body, '畜牧棚', '每天喂一次干草、摸一摸，好感高了会出大号产物。');
    var al = el('div', 'sg5-farm-list');
    (function () {
      for (var k in D.ANIMALS) {
        if (!Object.prototype.hasOwnProperty.call(D.ANIMALS, k)) continue;
        (function (k) {
          var a = D.ANIMALS[k];
          var row = el('div', 'sg5-farm-row');
          row.appendChild(el('span', 'sg5-farm-rowname', a.name));
          row.appendChild(el('span', 'sg5-farm-rowsub', a.cost + 'g · 产 ' + farmItemName(a.product) + '（' + a.sell + 'g）'));
          row.appendChild(opBtn('买', 'sg5-btn-sm', function () {
            farmAct('buy', { kind: 'animal', id: k }).then(function () { farmToast(a.name + '住进棚里了'); },
              function (e) { farmToast(e.message, 'warn'); });
          }));
          al.appendChild(row);
        })(k);
      }
    })();
    animals.appendChild(al);
    if (P.animals && P.animals.length) {
      animals.appendChild(el('div', 'sg5-note', '棚里：' + P.animals.length + ' 只 · 在「小镇」面板里喂食 / 收取'));
    }
    body.appendChild(animals);

    var goods = farmSection(body, '资材与服务', '洒水器放在一格上，那格每天自动浇水；肥料要在播种前施。');
    farmBtnRow(goods, [
      ['干草 50g', function () { farmAct('buy', { kind: 'hay', n: 5 }); }],
      ['木材 10g', function () { farmAct('buy', { kind: 'wood', n: 5 }); }],
      ['生长激素 100g', function () { farmAct('buy', { kind: 'fert', id: 'speedgro', n: 1 }); }],
      ['高级肥料 150g', function () { farmAct('buy', { kind: 'fert', id: 'quality_fert', n: 1 }); }],
      ['洒水器 400g', function () { farmAct('buy', { kind: 'fert', id: 'sprinkler', n: 1 }); }]
    ]);
    farmBtnRow(goods, [
      ['背包扩容 ' + (P.backpack >= 24 ? '10000' : '2000') + 'g', function () {
        farmAct('buy', { kind: 'backpack' }).then(function (d) { farmToast('背包扩到 ' + d.backpack + ' 格'); },
          function (e) { farmToast(e.message, 'warn'); });
      }],
      ['扩建房子 ' + (P.houseLv ? '50000' : '10000') + 'g', function () {
        farmAct('buy', { kind: 'house' }).then(function (d) { farmToast('房子升到 ' + d.houseLv + ' 级'); },
          function (e) { farmToast(e.message, 'warn'); });
      }]
    ]);
    body.appendChild(goods);

    // ---- v5.4 加工设备：买一台永久可用，重复买只用于展示第 N 台 ----
    var mach = farmSection(body, '加工设备', '熔炉烧锭、机子做蛋黄酱奶酪、桶酿酒、灶台做料理。买一台永久可用，放在自家田边。');
    var ml = el('div', 'sg5-farm-list');
    (function () {
      var MAC = farmD().MACHINES || {};
      for (var i = 0; i < MACHINE_ORDER.length; i++) {
        (function (mk) {
          var md = MAC[mk];
          if (!md) return;
          var owned = ((farmP() || {}).machines || {})[mk] || 0;
          var row = el('div', 'sg5-farm-row');
          row.appendChild(farmIcon(mk, 16));
          row.appendChild(el('span', 'sg5-farm-rowname', md.name + (owned ? ' · 已有 ' + owned + ' 台' : '')));
          row.appendChild(el('span', 'sg5-farm-rowsub', md.desc));
          row.appendChild(opBtn(md.cost + 'g', 'sg5-btn-sm', function () {
            farmAct('buy', { kind: 'machine', id: mk }).then(function (d) {
              farmToast('买下了' + md.name + (d && d.count > 1 ? '（第 ' + d.count + ' 台）' : ''));
            }, function (e) { farmToast(e.message, 'warn'); });
          }));
          ml.appendChild(row);
        })(MACHINE_ORDER[i]);
      }
    })();
    mach.appendChild(ml);
    body.appendChild(mach);
  }

  // ---------- v5.4 加工页签：按设备分节，配方行 = 图标 + 材料 chips + 到手价 ----------
  function canCraft(P, r, n) {
    for (var k in r.inputs) {
      if (!Object.prototype.hasOwnProperty.call(r.inputs, k)) continue;
      if (((P.inv || {})[k] || 0) < r.inputs[k] * n) return false;
    }
    return (P.energy || 0) >= r.energy * n;
  }
  function craftPrice(P, outId) {
    var ps = String(outId).split('_q'), base = ps[0], q = ps[1] ? Number(ps[1]) : 0;
    var D = farmD();
    var u = (D.SELL && D.SELL[base]) || 0;
    if (!u) return 0;
    if (q && D.QUALITY && D.QUALITY[q]) u *= D.QUALITY[q].mul;
    var profs = P.profs || [];
    if (/_bar$/.test(base) && profs.indexOf('blacksmith') >= 0) u *= 1.5;
    if (profs.indexOf('artisan') >= 0) u *= 1.4;
    return Math.floor(u);
  }
  function doCraft(id, n) {
    lifeAct('craft', { id: id, n: n }).then(function (d) {
      farmToast('做好了 ' + (d && d.name ? d.name : '东西') + ' ×' + (d && d.n ? d.n : 1));
    }, function (e) { farmToast(e.message, 'warn'); });
  }
  function farmCraftBody(body) {
    var P = farmP(); if (!P) return;
    var D = farmD(), REC = P.recipes || D.RECIPES || {}, MAC = D.MACHINES || {};
    var owned = P.machines || {};
    (function () {
      for (var i = 0; i < MACHINE_ORDER.length; i++) {
        (function (mk) {
          var md = MAC[mk];
          if (!md) return;
          var have = owned[mk] || 0;
          var s = farmSection(body, md.name + (have ? ' · 已有 ' + have + ' 台' : ' · 还没有'), md.desc);
          if (!have) {
            var guide = el('div', 'sg5-farm-row');
            guide.appendChild(el('span', 'sg5-farm-rowname', '商店有售'));
            guide.appendChild(el('span', 'sg5-farm-rowsub', '「商店」页签 ' + md.cost + 'g 一台，买好就能用'));
            s.appendChild(guide);
            body.appendChild(s);
            return;
          }
          var list = el('div', 'sg5-farm-list');
          (function () {
            for (var k in REC) {
              if (!Object.prototype.hasOwnProperty.call(REC, k)) continue;
              if (REC[k].machine !== mk) continue;
              (function (k) {
                var r = REC[k];
                var row = el('div', 'sg5-farm-row sg5-farm-recipe');
                row.appendChild(farmIcon(r.out, 16));
                row.appendChild(el('span', 'sg5-farm-rowname', r.name));
                var needs = el('span', 'sg5-farm-needs');
                var lack = '';
                (function () {
                  for (var ik in r.inputs) {
                    if (!Object.prototype.hasOwnProperty.call(r.inputs, ik)) continue;
                    (function (ik) {
                      var need = r.inputs[ik], haveN = (P.inv || {})[ik] || 0;
                      // 复用献祭包的三态：off 缺 / have 够一次 / done 够五次
                      needs.appendChild(el('span',
                        'sg5-bundle-need ' + (haveN >= need ? (haveN >= need * 5 ? 'is-done' : 'is-have') : 'is-off'),
                        farmItemName(ik) + ' ' + haveN + '/' + need));
                      if (haveN < need) lack = '缺 ' + farmItemName(ik) + ' ×' + (need - haveN);
                      else if (!lack && haveN < need * 5) lack = '材料只够 ×' + Math.floor(haveN / need);
                    })(ik);
                  }
                })();
                row.appendChild(needs);
                row.appendChild(el('span', 'sg5-farm-rowsub', '到手 ' + craftPrice(P, r.out) + 'g · 体力 ' + r.energy + '/次'));
                var b1 = opBtn('制作 ×1', 'sg5-btn-sm', function () { doCraft(k, 1); });
                var b5 = opBtn('×5', 'sg5-btn-sm', function () { doCraft(k, 5); });
                if (!canCraft(P, r, 1)) b1.disabled = true;
                if (!canCraft(P, r, 5)) b5.disabled = true;
                if (lack) row.appendChild(el('span', 'sg5-farm-lack', lack));
                row.appendChild(b1);
                row.appendChild(b5);
                list.appendChild(row);
              })(k);
            }
          })();
          s.appendChild(list);
          body.appendChild(s);
        })(MACHINE_ORDER[i]);
      }
    })();
  }

  // ---------- v5.5 丰收展：展台选样 / 预览 / 提交 ----------
  // 可参展：作物果实 / 采集物 / 加工品 / 动物产品（含品质变体）；种子、资材、矿石不收
  var EXHIBIT_ANIMAL = /^(egg|big_egg|duck_egg|duck_feather|milk|big_milk|goat_milk|big_goat_milk|wool|big_wool|truffle)$/;
  function farmExhibitCands(P) {
    var D = farmD(), out = [];
    for (var k in (P.inv || {})) {
      if (!Object.prototype.hasOwnProperty.call(P.inv, k) || !P.inv[k]) continue;
      var base = String(k).split('_q')[0];
      if (base === 'ticket' || base === 'hardwood' || base.indexOf('seed_') === 0) continue;
      var ok2 = EXHIBIT_ANIMAL.test(base) || (D.CROPS && D.CROPS[base]) || (D.SELL && D.SELL[base]);
      if (ok2) { out.push(k); continue; }
      for (var i = 0; i < (D.FORAGE || []).length; i++) if (D.FORAGE[i].id === base) { out.push(k); break; }
    }
    return out;
  }
  // 评分公式与服务端 farmdata.exhibitGrade 一致（预览用，真结果以提交响应为准）
  function farmExhibitGrade(items) {
    var sumQ = 0, bases = {}, n = 0;
    for (var i = 0; i < items.length; i++) {
      var ps = String(items[i] || '').split('_q'), q = ps[1] ? Number(ps[1]) : 0;
      sumQ += Math.min(4, q + 1);
      bases[ps[0]] = 1; n++;
    }
    var avgQ = n ? sumQ / n : 0, div = 0, b;
    for (b in bases) if (Object.prototype.hasOwnProperty.call(bases, b)) div++;
    var g = (avgQ >= 2.5 && div >= 7) ? 'S' : (avgQ >= 2 && div >= 5) ? 'A' : div >= 3 ? 'B' : 'C';
    return { grade: g, avgQ: avgQ, diversity: div, gold: g === 'S' ? 1200 : g === 'A' ? 800 : g === 'B' ? 500 : 300 };
  }
  function farmExhibitBody(body) {
    var P = farmP(); if (!P) return;
    var c = P.cal;
    var s = farmSection(body, '丰收展 · 展台', '挑 9 样产物参展（作物 / 采集 / 加工 / 畜产都行）。实物不扣，提交当日锁定，奖金按评级立刻入账。');
    var submitted = P.exhibit && P.exhibit.day === c.day && P.exhibit.grade;
    if (submitted) {
      // 成绩态：只读，格子点击无响应
      var done = el('div', 'sg5-farm-cal');
      done.appendChild(el('div', 'sg5-farm-calclock', P.exhibit.grade + ' 级 · 奖金已入账'));
      var g0 = farmExhibitGrade(P.exhibit.items || []);
      done.appendChild(el('div', 'sg5-note', '品质均分 ' + g0.avgQ.toFixed(2) + ' · ' + g0.diversity + ' 种'));
      s.appendChild(done);
      var grid0 = el('div', 'sg5-exhibit-grid');
      (function () {
        var items = P.exhibit.items || [];
        for (var i = 0; i < 9; i++) {
          var cell = el('div', 'sg5-exhibit-cell');
          if (items[i]) {
            cell.appendChild(farmIcon(items[i], 16));
            cell.appendChild(el('span', 'sg5-farm-itemname', farmItemName(items[i])));
          }
          grid0.appendChild(cell);
        }
      })();
      s.appendChild(grid0);
      farmBtnRow(s, [['退回背包', function () { S.farm.exhibitMode = false; refreshPanel('farm'); }]]);
      body.appendChild(s);
      return;
    }
    var sel = S.farm.exhibitSel || (S.farm.exhibitSel = []);
    var grid = el('div', 'sg5-exhibit-grid');
    (function () {
      for (var i = 0; i < 9; i++) {
        (function (i) {
          var cell = el('button', 'sg5-exhibit-cell');
          cell.type = 'button';
          var iid = sel[i];
          if (iid) {
            cell.appendChild(farmIcon(iid, 16));
            cell.appendChild(el('span', 'sg5-farm-itemname', farmItemName(iid)));
            cell.setAttribute('title', farmItemName(iid) + ' · 点击移回背包');
          } else {
            cell.textContent = String(i + 1);
          }
          cell.addEventListener('click', function () {
            if (sel[i]) { sel.splice(i, 1); auSfx('menu', 0.2, 1.0); refreshPanel('farm'); }
          }, false);
          grid.appendChild(cell);
        })(i);
      }
    })();
    s.appendChild(grid);
    // 预览：评级大字（复用 calclock）+ 分量行
    var g = farmExhibitGrade(sel);
    var prev = el('div', 'sg5-farm-cal');
    prev.appendChild(el('div', 'sg5-farm-calclock', sel.length < 9 ? '还差 ' + (9 - sel.length) + ' 样' : (g.grade + ' 级 · ' + g.gold + 'g')));
    prev.appendChild(el('div', 'sg5-note', '品质均分 ' + g.avgQ.toFixed(2) + ' · ' + g.diversity + ' 种 · 种类越多分越高'));
    s.appendChild(prev);
    // 候选列表
    var cands = farmExhibitCands(P);
    var list = el('div', 'sg5-farm-inv');
    (function () {
      for (var i = 0; i < cands.length; i++) {
        (function (k) {
          var b = el('button', 'sg5-farm-item');
          b.type = 'button';
          b.appendChild(farmIcon(k, 16));
          b.appendChild(el('span', 'sg5-farm-itemname', farmItemName(k)));
          b.appendChild(el('span', 'sg5-farm-itemnum', '×' + P.inv[k]));
          b.addEventListener('click', function () {
            if (sel.length >= 9) { farmToast('展台只有 9 个位置，先移走一样', 'warn'); return; }
            sel.push(k); auSfx('menu', 0.2, 1.1); refreshPanel('farm');
          }, false);
          list.appendChild(b);
        })(cands[i]);
      }
    })();
    if (!cands.length) list.appendChild(el('div', 'sg5-empty', '背包里还没有可以参展的产物。'));
    s.appendChild(list);
    farmBtnRow(s, [
      ['清空展台', function () { S.farm.exhibitSel = []; refreshPanel('farm'); }],
      ['退回背包', function () { S.farm.exhibitMode = false; refreshPanel('farm'); }]
    ]);
    if (sel.length === 9) {
      farmBtnRow(s, [['确定参展', function () {
        var items = S.farm.exhibitSel.slice();
        lifeAct('exhibit/submit', { items: items }).then(function (d) {
          farmToast('参展成功：' + d.grade + ' 级，奖金 ' + d.gold + 'g 已入账');
          S.farm.exhibitMode = false;
          S.farm.exhibitSel = [];
        }, function (e) { farmToast(e.message, 'warn'); });
      }, 'sg5-btn-primary', true]]);
    }
    body.appendChild(s);
  }

  // ---------- 背包 / 箱子 ----------
  function farmInvGrid(P, items, picked, onPick, readOnly) {
    var g = el('div', 'sg5-farm-inv');
    var any = false;
    (function () {
      for (var k in items) {
        if (!Object.prototype.hasOwnProperty.call(items, k)) continue;
        if (!items[k]) continue;
        any = true;
        (function (k) {
          // 只读清单：出货箱 / 矿石清单只是展示，用 div 而不是 button，
          // 免得键盘 Tab 停在一堆没有任何行为的按钮上
          var b = el(readOnly ? 'div' : 'button', 'sg5-farm-item' + (picked === k ? ' is-on' : ''));
          if (!readOnly) {
            b.type = 'button';
            b.setAttribute('data-focus-key', 'item:' + k);
          }
          var sw = farmIcon(k, 16);
          b.appendChild(sw);
          b.appendChild(el('span', 'sg5-farm-itemname', farmItemName(k)));
          b.appendChild(el('span', 'sg5-farm-itemnum', '×' + items[k]));
          if (P.prices && P.prices[k]) b.appendChild(el('span', 'sg5-farm-itemprice', P.prices[k] + 'g'));
          if (!readOnly) b.addEventListener('click', function () { onPick(k); }, false);
          g.appendChild(b);
        })(k);
      }
    })();
    if (!any) g.appendChild(el('div', 'sg5-empty', '空的。去田里收点东西吧。'));
    return g;
  }
  function farmBagBody(body) {
    var P = farmP(); if (!P) return;
    // v5.5：丰收展展台视图（从背包页签的「参展」或日历的「去参展」进入）
    if (S.farm.exhibitMode && isExhibitDay()) { farmExhibitBody(body); return; }
    var cap = farmSection(body, '背包 ' + P.invCount + '/' + P.backpack, '点一样东西，再选要拿它做什么。种子按半价回收。');
    cap.appendChild(farmInvGrid(P, P.inv || {}, S.farm.bagSel, function (k) {
      S.farm.bagSel = k; refreshPanel('farm');
    }));
    if (S.farm.bagSel) {
      var sel = S.farm.bagSel;
      var ops = el('div', 'sg5-farm-sel');
      ops.appendChild(el('div', 'sg5-farm-selname', farmItemName(sel) + ' ×' + (P.inv[sel] || 0)));
      // v5.4：锭类加成价提示（铁匠 +50% 已含在 prices 里，这里把原价也亮出来）
      var selBase = String(sel).split('_q')[0];
      if (/(_bar)$/.test(selBase)) {
        var D2 = farmD(), ps2 = String(sel).split('_q'), q2n = ps2[1] ? Number(ps2[1]) : 0;
        var baseP = Math.floor((((D2.SELL || {})[selBase]) || 0) * (q2n && D2.QUALITY[q2n] ? D2.QUALITY[q2n].mul : 1));
        var nowP = (P.prices && P.prices[sel]) || 0;
        if (nowP > baseP) {
          ops.appendChild(el('div', 'sg5-farm-note-inline', '原价 ' + baseP + 'g → 加成价 ' + nowP + 'g（铁匠 +50%）'));
        }
      }
      // v5.4：能吃的物品追加「吃掉」；星果永久加体力上限，走两步确认
      var eatDef = P.eat ? P.eat[selBase] : null;
      if (selBase === 'starfruit') {
        farmBtnRow(ops, [['吃下星果（体力上限永久 +34）', function () {
          lifeAct('eat', { item: sel }).then(function (d) {
            farmToast('体力上限升到 ' + d.maxEnergy + '，整个人都精神了');
          }, function (e) { farmToast(e.message, 'warn'); });
        }, 'sg5-btn-sm', true]]);
      } else if (eatDef) {
        var full = (P.energy || 0) >= (P.maxEnergy || 100);
        var eb = opBtn('吃掉（+' + eatDef + ' 体力）', 'sg5-btn-sm', function () {
          lifeAct('eat', { item: sel }).then(function (d) {
            farmToast('吃掉了，体力 ' + d.energy + '/' + d.maxEnergy);
          }, function (e) { farmToast(e.message, 'warn'); });
        });
        if (full) eb.disabled = true;
        var eatRow = el('div', 'sg5-farm-ops');
        eatRow.appendChild(eb);
        if (full) eatRow.appendChild(el('span', 'sg5-farm-lack', '体力已满'));
        ops.appendChild(eatRow);
      }
      // v5.5：彩蛋彩券只在彩蛋节当天、只走商店页签兑换
      if (selBase === 'ticket') {
        ops.appendChild(el('div', 'sg5-farm-note-inline', '彩蛋节限定：点右上『商店』页签兑换，过期作废'));
      }
      var bagOps = [
        ['卖 1 个', function () {
          var it = {}; it[sel] = 1;
          farmAct('sell', { items: it }).then(function (d) { farmToast('卖了 ' + d.gold + 'g'); },
            function (e) { farmToast(e.message, 'warn'); });
        }],
        ['全部卖掉', function () {
          var it = {}; it[sel] = P.inv[sel] || 0;
          farmAct('sell', { items: it }).then(function (d) { farmToast('卖了 ' + d.gold + 'g'); },
            function (e) { farmToast(e.message, 'warn'); });
        }, 'sg5-btn-sm', true],
        ['放进出货箱', function () {
          var it = {}; it[sel] = P.inv[sel] || 0;
          farmAct('ship', { items: it }).then(function () { farmToast('明天早上结账'); },
            function (e) { farmToast(e.message, 'warn'); });
        }, 'sg5-btn-sm', true],
        ['存进箱子', function () {
          var it = {}; it[sel] = P.inv[sel] || 0;
          farmAct('chest', { mode: 'put', items: it }).then(function () { farmToast('收进箱子了'); },
            function (e) { farmToast(e.message, 'warn'); });
        }, 'sg5-btn-sm', true],
        ['施肥 / 洒水器', function () {
          if (!S.farm.sel) { farmToast('先在「田地」里点一格', 'warn'); return; }
          farmAct('fertilize', { r: S.farm.sel.r, c: S.farm.sel.c, fert: sel }).then(function () { farmToast('施好了'); },
            function (e) { farmToast(e.message, 'warn'); });
        }],
        ['送给镇上的人', function () { S.farm.relationTab = 'villagers'; openPanel('relation'); }]
      ];
      // v5.5：丰收展当天追加「参展」入口（切到展台视图）
      if (isExhibitDay()) {
        bagOps.push(['参展', function () {
          S.farm.exhibitMode = true;
          refreshPanel('farm');
        }]);
      }
      farmBtnRow(ops, bagOps);
      cap.appendChild(ops);
    }
    body.appendChild(cap);
    var chest = farmSection(body, '家里的箱子', '箱子不占背包格。点一下取回一格堆叠。');
    chest.appendChild(farmInvGrid(P, P.chest || {}, null, function (k) {
      var it = {}; it[k] = (P.chest || {})[k] || 1;
      farmAct('chest', { mode: 'take', items: it }).then(function () { farmToast('取回来了'); },
        function (e) { farmToast(e.message, 'warn'); });
    }));
    body.appendChild(chest);
  }

  // ---------- 出货箱 ----------
  function farmShipBody(body) {
    var P = farmP(); if (!P) return;
    var s = farmSection(body, '出货箱', '放进去的东西在第二天清晨一起结账 —— 和原作一样，不点即时到账。');
    var total = 0;
    for (var k in (P.ship || {})) if (Object.prototype.hasOwnProperty.call(P.ship, k)) {
      total += (P.prices && P.prices[k] ? P.prices[k] : 0) * P.ship[k];
    }
    s.appendChild(el('div', 'sg5-farm-big', '明早预计进账 ' + total + 'g'));
    s.appendChild(farmInvGrid(P, P.ship || {}, null, function () {}, true));
    body.appendChild(s);
    var st = farmSection(body, '账本', '');
    st.appendChild(el('div', 'sg5-farm-big', '累计出货 ' + (P.shipTotal || 0) + 'g'));
    st.appendChild(el('div', 'sg5-note', '收获 ' + (P.stats.harvest || 0) + ' 次 · 钓到 ' + (P.stats.fish || 0) +
      ' 条 · 挖到 ' + (P.stats.ore || 0) + ' 块矿 · 送过 ' + (P.stats.gift || 0) + ' 份礼 · 昏厥 ' + (P.faint || 0) + ' 次'));
    body.appendChild(st);
  }

  // ---------- 技能 ----------
  function farmSkillBody(body) {
    var P = farmP(); if (!P) return;
    var D = farmD();
    var s = farmSection(body, '五项技能', '收获、钓鱼、挖矿、送礼都会涨经验；5 级与 10 级各选一次职业，选了不能改。');
    var list = el('div', 'sg5-farm-list');
    (function () {
      for (var i = 0; i < D.SKILLS.length; i++) {
        (function (sk) {
          var xp = (P.skills || {})[sk] || 0, lv = (P.levels || {})[sk] || 0;
          var next = (P.nextLevelXp || {})[sk] || 0;
          var prev = lv > 0 ? D.SKILL_XP[lv - 1] : 0;
          var span = lv >= 10 ? 1 : (D.SKILL_XP[lv] - prev);
          var pct = lv >= 10 ? 1 : Math.max(0, Math.min(1, (xp - prev) / (span || 1)));
          var row = el('div', 'sg5-farm-skill');
          row.appendChild(el('span', 'sg5-farm-rowname', D.SKILL_NAMES[sk] + ' Lv.' + lv));
          var bar = el('div', 'sg5-farm-xpbar');
          var fill = el('div', 'sg5-farm-xpfill');
          fill.style.transform = 'scaleX(' + pct.toFixed(3) + ')';
          bar.appendChild(fill); row.appendChild(bar);
          row.appendChild(el('span', 'sg5-farm-rowsub', lv >= 10 ? '满级' : xp + ' / ' + D.SKILL_XP[lv] + '（还差 ' + next + '）'));
          var tier = lv >= 10 ? 10 : lv >= 5 ? 5 : 0;
          if (tier && D.PROFESSIONS[sk] && D.PROFESSIONS[sk][tier]) {
            var opts = D.PROFESSIONS[sk][tier];
            for (var j = 0; j < opts.length; j++) {
              (function (o) {
                var chosen = P.profs && P.profs.indexOf(o[0]) >= 0;
                var b = opBtn(chosen ? '✓ ' + o[1] : o[1], chosen ? 'sg5-btn-sm sg5-btn-primary' : 'sg5-btn-sm', function () {
                  if (chosen) return;
                  farmAct('profession', { skill: sk, id: o[0] }).then(function () { farmToast('选了「' + o[1] + '」'); },
                    function (e) { farmToast(e.message, 'warn'); });
                });
                row.appendChild(b);
                // v5.4：已选职业后面跟一枚短标，效果不用翻说明也能看见
                if (chosen && PROF_MARK[o[0]]) row.appendChild(el('span', 'sg5-farm-profmark', PROF_MARK[o[0]]));
              })(opts[j]);
            }
          }
          list.appendChild(row);
        })(D.SKILLS[i]);
      }
    })();
    s.appendChild(list);
    body.appendChild(s);
    if (P.profs && P.profs.length) {
      body.appendChild(el('div', 'sg5-note', '已选职业：' + P.profs.join(' / ')));
    }
  }

  // ---------- 日历 ----------
  function farmCalendarBody(body) {
    var P = farmP(); if (!P) return;
    var D = farmD(), c = P.cal;
    var s = farmSection(body, '第 ' + c.year + ' 年 · ' + c.seasonName + ' 第 ' + c.dayInSeason + ' 天',
      '一季 ' + D.SEASON_DAYS + ' 天，四季轮转。全班共用同一本日历，谁也不会被时间落下。');
    var big = el('div', 'sg5-farm-cal');
    big.appendChild(el('div', 'sg5-farm-calclock', c.clock));
    var pct = Math.round(c.dayInSeason / D.SEASON_DAYS * 100);
    var bar = el('div', 'sg5-farm-xpbar');
    var fill = el('div', 'sg5-farm-xpfill'); fill.style.transform = 'scaleX(' + (pct / 100).toFixed(3) + ')';
    bar.appendChild(fill); big.appendChild(bar);
    big.appendChild(el('div', 'sg5-note', '本季已过 ' + pct + '% · 今天 ' +
      (c.weather === 'rain' ? '下雨（不用浇水）' : c.weather === 'snow' ? '下雪（不用浇水）' : '晴天')));
    s.appendChild(big);
    body.appendChild(s);

    var fes = farmSection(body, '今年的节日', '节日当天来领礼，商店与好感还会有临时加成。');
    var fl = el('div', 'sg5-farm-list');
    (function () {
      for (var i = 0; i < D.FESTIVALS.length; i++) {
        (function (f) {
          var row = el('div', 'sg5-farm-row');
          row.appendChild(el('span', 'sg5-farm-rowname', D.SEASONS[f.day[0]] + ' ' + f.day[1] + '日 · ' + f.name));
          row.appendChild(el('span', 'sg5-farm-rowsub', f.desc));
          if (f.day[0] === c.season && f.day[1] === c.dayInSeason) {
            if (f.perk === 'exhibit') {
              // v5.5：丰收展当天按钮改为「去参展」——奖金在展台按评级结算，没有固定礼
              row.appendChild(opBtn('去参展', 'sg5-btn-sm sg5-btn-primary', function () {
                S.farm.tab = 'bag';
                refreshPanel('farm');
              }));
            } else {
              row.appendChild(opBtn('领礼', 'sg5-btn-sm sg5-btn-primary', function () {
                lifeAct('festival', {}).then(function (d) { farmToast(d.festival + '：' + d.gift); },
                  function (e) { farmToast(e.message, 'warn'); });
              }));
            }
          }
          fl.appendChild(row);
        })(D.FESTIVALS[i]);
      }
    })();
    fes.appendChild(fl); body.appendChild(fes);

    var bday = farmSection(body, '镇上人的生日', '生日送礼好感 ×8 —— 一年里最划算的一天。');
    var bl = el('div', 'sg5-farm-list');
    (function () {
      for (var k in D.VILLAGERS) {
        if (!Object.prototype.hasOwnProperty.call(D.VILLAGERS, k)) continue;
        (function (k) {
          var v = D.VILLAGERS[k];
          var row = el('div', 'sg5-farm-row');
          row.appendChild(el('span', 'sg5-farm-rowname', v.name));
          row.appendChild(el('span', 'sg5-farm-rowsub', D.SEASONS[v.birthday[0]] + ' ' + v.birthday[1] + '日'));
          bl.appendChild(row);
        })(k);
      }
    })();
    bday.appendChild(bl); body.appendChild(bday);
    farmBtnRow(body, [
      ['去社区中心交献祭包', function () { S.farm.relationTab = 'bundles'; openPanel('relation'); }],
      ['看看镇上的人', function () { S.farm.relationTab = 'villagers'; openPanel('relation'); }]
    ]);
  }

  PANELS.farm = function () {
    var P = farmP();
    var sh = panelShell('农场', P ? (P.cal.seasonName + ' ' + P.cal.dayInSeason + '日 · ' + P.gold + 'g') : '正在载入…');
    sh.root.className = 'sg5-panel sg5-panel-wide sg5-panel-farm';
    var errBlock = farmErrBlock();
    if (errBlock) sh.body.appendChild(errBlock);
    farmTabs(sh.body);
    var cont = el('div', 'sg5-farm-cont');
    if (!P) cont.appendChild(el('div', 'sg5-empty', '农场还没载入，稍等一下…'));
    else if (S.farm.tab === 'field') farmFieldBody(cont);
    else if (S.farm.tab === 'craft') farmCraftBody(cont);
    else if (S.farm.tab === 'shop') farmShopBody(cont);
    else if (S.farm.tab === 'bag') farmBagBody(cont);
    else if (S.farm.tab === 'ship') farmShipBody(cont);
    else if (S.farm.tab === 'skill') farmSkillBody(cont);
    else farmCalendarBody(cont);
    sh.body.appendChild(cont);
    return sh.root;
  };
