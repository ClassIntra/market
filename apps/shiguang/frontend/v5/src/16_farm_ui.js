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

  var FARM_TABS = [
    ['field', '田地'], ['shop', '商店'], ['bag', '背包'],
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
      var yes = uiBtn('确定', 'sg5-btn-sm sg5-btn-primary', function () { onYes(); });
      var no = uiBtn('取消', 'sg5-btn-sm sg5-btn-ghost', function () {
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
          var qc = farmQualityClass(k);
          var sw = el('span', 'sg5-farm-swatch' + (qc ? ' ' + qc : ''));
          sw.style.background = farmItemColor(k);
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
    var cap = farmSection(body, '背包 ' + P.invCount + '/' + P.backpack, '点一样东西，再选要拿它做什么。种子按半价回收。');
    cap.appendChild(farmInvGrid(P, P.inv || {}, S.farm.bagSel, function (k) {
      S.farm.bagSel = k; refreshPanel('farm');
    }));
    if (S.farm.bagSel) {
      var sel = S.farm.bagSel;
      var ops = el('div', 'sg5-farm-sel');
      ops.appendChild(el('div', 'sg5-farm-selname', farmItemName(sel) + ' ×' + (P.inv[sel] || 0)));
      farmBtnRow(ops, [
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
      ]);
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
            row.appendChild(opBtn('领礼', 'sg5-btn-sm sg5-btn-primary', function () {
              lifeAct('festival', {}).then(function (d) { farmToast(d.festival + '：' + d.gift); },
                function (e) { farmToast(e.message, 'warn'); });
            }));
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
    else if (S.farm.tab === 'shop') farmShopBody(cont);
    else if (S.farm.tab === 'bag') farmBagBody(cont);
    else if (S.farm.tab === 'ship') farmShipBody(cont);
    else if (S.farm.tab === 'skill') farmSkillBody(cont);
    else farmCalendarBody(cont);
    sh.body.appendChild(cont);
    return sh.root;
  };
