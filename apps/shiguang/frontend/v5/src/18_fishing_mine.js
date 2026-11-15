  // ---------------- §19 钓鱼小游戏 / 矿洞 / 图鉴 ----------------
  //
  // 钓鱼是原作那根「绿条」：按住让游标上浮、松开下沉，把鱼压在绿条里进度才涨。
  // 鱼由服务端在甩竿那一刻决定，客户端只负责把「贴合得有多好」交回去，刷不出稀有鱼。

  var MINE_TABS = [['fish', '钓鱼'], ['mine', '矿洞'], ['dex', '图鉴']];
  function mineTabs(body) {
    var tabs = el('div', 'sg5-tabs');
    (function () {
      for (var i = 0; i < MINE_TABS.length; i++) {
        (function (t) {
          var b = el('button', 'sg5-tab' + (S.farm.mineTab === t[0] ? ' is-on' : ''), t[1]);
          b.type = 'button';
          b.addEventListener('click', function () {
            S.farm.mineTab = t[0]; refreshPanel('mine'); auSfx('menu', 0.2, 1.1);
          }, false);
          tabs.appendChild(b);
        })(MINE_TABS[i]);
      }
    })();
    body.appendChild(tabs);
  }
  function qteClamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

  function qteDown(e) {
    var q = S.farm.qte; if (!q) return;
    if (e && (e.code === 'Space' || e.key === ' ' || e.type === 'mousedown' || e.type === 'touchstart')) {
      q.hold = true; if (e.preventDefault) e.preventDefault();
    }
  }
  function qteUp(e) {
    var q = S.farm.qte; if (!q) return;
    if (e && (e.code === 'Space' || e.key === ' ' || e.type === 'mouseup' || e.type === 'touchend')) q.hold = false;
  }
  function qtePaint() {
    var q = S.farm.qte; if (!q) return;
    var root = document.querySelector('.sg5-qte'); if (!root) return;
    var cur = root.querySelector('.sg5-qte-cursor');
    var zone = root.querySelector('.sg5-qte-zone');
    var fill = root.querySelector('.sg5-qte-fill');
    if (cur) cur.style.top = Math.round((1 - q.y) * 100) + '%';
    if (zone) {
      zone.style.height = Math.round(q.green * 100) + '%';
      zone.style.top = Math.round((1 - q.targetY - q.green / 2) * 100) + '%';
    }
    if (fill) fill.style.width = Math.round(q.progress * 100) + '%';
  }
  function qteCleanup() {
    var q = S.farm.qte;
    if (q && q.timer) { try { clearInterval(q.timer); } catch (e) {} }
    document.removeEventListener('keydown', qteDown, false);
    document.removeEventListener('keyup', qteUp, false);
    document.removeEventListener('mouseup', qteUp, false);
    S.farm.qte = null;
  }
  function qteStop(success) {
    var q = S.farm.qte; if (!q) return;
    var ratio = q.hit / Math.max(1, q.frames);
    var score = success ? qteClamp(0.6 + 0.4 * ratio, 0, 1) : 0.2;
    if (q.timer) { try { clearInterval(q.timer); } catch (e) {} }
    document.removeEventListener('keydown', qteDown, false);
    document.removeEventListener('keyup', qteUp, false);
    document.removeEventListener('mouseup', qteUp, false);
    S.farm.qte = null;
    lifeAct('fish/result', { score: score }).then(function (d) {
      if (d && d.caught) {
        farmToast('钓上了 ' + d.name + (d.perfect ? ' · 完美！' : '') + '，值 ' + d.price + 'g');
      } else {
        farmToast((d && d.reason) || '鱼跑了', 'warn');
      }
    }, function (e) { farmToast(e.message || '鱼跑了', 'warn'); });
  }
  function qteStart(d) {
    qteCleanup();
    S.farm.qte = {
      fish: d.fish, name: d.name, diff: d.diff || 30, green: d.green || 0.35,
      y: 0.5, targetY: 0.28 + Math.random() * 0.44,
      targetVy: (Math.random() - 0.5) * 0.006,
      vy: 0, hold: false, progress: 0.3, hit: 0, frames: 0, timer: null
    };
    var q = S.farm.qte;
    document.addEventListener('keydown', qteDown, false);
    document.addEventListener('keyup', qteUp, false);
    document.addEventListener('mouseup', qteUp, false);
    q.timer = setInterval(function () {
      if (!S.farm.qte || curPanel !== 'mine') { qteCleanup(); return; }
      q.frames++;
      q.targetY += q.targetVy * (1 + q.diff / 75);
      if (q.targetY < 0.12 || q.targetY > 0.88) q.targetVy *= -1;
      q.targetY = qteClamp(q.targetY, 0.12, 0.88);
      q.vy += (q.hold ? 0.0023 : -0.0027);
      q.vy = qteClamp(q.vy, -0.022, 0.022);
      q.y += q.vy;
      if (q.y < 0.03) { q.y = 0.03; q.vy = 0; }
      if (q.y > 0.97) { q.y = 0.97; q.vy = 0; }
      var inZone = Math.abs(q.y - q.targetY) <= q.green / 2;
      if (inZone) { q.progress += 0.007; q.hit++; }
      else q.progress -= 0.005;
      q.progress = qteClamp(q.progress, 0, 1);
      qtePaint();
      if (q.progress >= 1) qteStop(true);
      else if (q.progress <= 0 || q.frames > 520) qteStop(false);
    }, 30);
  }

  function fishBody(body) {
    var P = farmP(); if (!P) return;
    var D = farmD(), q = S.farm.qte;
    var s = farmSection(body, '水边', '按住空格（或按住鼠标）让游标上浮，松开下沉。把鱼留在绿条里，进度满就上钩。');
    if (!q) {
      s.appendChild(el('div', 'sg5-note', '鱼竿等级 ' + ((P.tools || {}).rod || 0) +
        ' · 钓鱼 Lv.' + ((P.levels || {}).fishing || 0) + ' · 今天 ' + P.cal.weather +
        ' · 甩一次竿花 ' + (D.TOOL_ENERGY ? D.TOOL_ENERGY.fish : 8) + ' 体力'));
      farmBtnRow(s, [
        ['甩竿', function () {
          lifeAct('fish/start', {}).then(function (d) {
            if (d && d.fish) { qteStart(d); refreshPanel('mine'); }
            else farmToast('这会儿没鱼咬钩', 'warn');
          }, function (e) { farmToast(e.message, 'warn'); });
        }, 'sg5-btn-primary'],
        ['按 H 收起', function () { closePanel(); }]
      ]);
      var caught = 0;
      for (var k in (P.fishCaught || {})) if (Object.prototype.hasOwnProperty.call(P.fishCaught, k)) caught += P.fishCaught[k];
      s.appendChild(el('div', 'sg5-note', '已经钓上 ' + caught + ' 条鱼 · 图鉴见隔壁'));
    } else {
      var box = el('div', 'sg5-qte');
      var track = el('div', 'sg5-qte-track');
      track.appendChild(el('div', 'sg5-qte-zone'));
      var fish = el('div', 'sg5-qte-fish', '◆');
      track.appendChild(fish);
      track.appendChild(el('div', 'sg5-qte-cursor'));
      box.appendChild(track);
      var side = el('div', 'sg5-qte-side');
      side.appendChild(el('div', 'sg5-qte-title', '咬钩了！'));
      side.appendChild(el('div', 'sg5-qte-name', '???（钓上来才知道）'));
      side.appendChild(el('div', 'sg5-note', '难度 ' + q.diff + ' · 绿条 ' + Math.round(q.green * 100) + '%'));
      var pb = el('div', 'sg5-qte-bar');
      pb.appendChild(el('div', 'sg5-qte-fill'));
      side.appendChild(pb);
      side.appendChild(el('div', 'sg5-note', '按住 = 上浮，松开 = 下沉'));
      box.appendChild(side);
      box.addEventListener('mousedown', qteDown, false);
      box.addEventListener('mouseup', qteUp, false);
      box.addEventListener('touchstart', qteDown, false);
      box.addEventListener('touchend', qteUp, false);
      s.appendChild(box);
    }
    body.appendChild(s);
  }

  function mineBody(body) {
    var P = farmP(); if (!P) return;
    var D = farmD(), m = P.mineRun;
    var s = farmSection(body, '矿洞 · 最深 ' + D.MINE_MAX + ' 层',
      '每 5 层有电梯，下次可直接下到那一层。镐子等级越高，一铲子能敲出越多矿石。');
    s.appendChild(el('div', 'sg5-farm-big', m ? '当前第 ' + m.floor + ' 层' : '还没下矿'));
    s.appendChild(el('div', 'sg5-note', '最深到过 ' + (P.mineBest || 0) + ' 层 · 电梯已通到第 ' + (P.elevator || 0) + ' 层 · 体力 ' + P.energy));
    if (!m) {
      var btns = [];
      var elev = Math.max(0, P.elevator || 0);
      for (var f = 0; f <= elev; f += 5) {
        (function (floor) { btns.push(['第 ' + floor + ' 层', function () {
          lifeAct('mine/enter', { floor: floor }).then(function () { farmToast('下到第 ' + floor + ' 层'); },
            function (e) { farmToast(e.message, 'warn'); });
        }]); })(Math.max(1, f));
      }
      if (!btns.length) btns.push(['从 1 层开始', function () {
        lifeAct('mine/enter', { floor: 1 }).then(function () { farmToast('下矿了'); },
          function (e) { farmToast(e.message, 'warn'); });
      }]);
      farmBtnRow(s, btns);
    } else {
      s.appendChild(el('div', 'sg5-note', '洞里体力 ' + m.hp + ' · 挖了 ' + m.digs + ' 铲 · ' + (m.stair ? '找到楼梯了' : '还没找到楼梯')));
      farmBtnRow(s, [
        ['挖一铲', function () {
          lifeAct('mine/dig', {}).then(function (d) {
            if (d && d.down) farmToast('被打晕送回镇上，花了 ' + d.loss + 'g', 'warn');
            else if (d && d.got && d.got.length) farmToast('敲出 ' + d.got.length + ' 块矿');
          }, function (e) { farmToast(e.message, 'warn'); });
        }, 'sg5-btn-primary'],
        [m.stair ? '往下一层' : '继续找楼梯', function () {
          lifeAct('mine/stair', {}).then(function (d) {
            farmToast(d.bottom ? '到矿洞最底了' : '下到第 ' + d.mine.floor + ' 层');
          }, function (e) { farmToast(e.message, 'warn'); });
        }],
        ['离开矿洞', function () { lifeAct('mine/leave', {}).then(function () { farmToast('回到地面上了'); }); }]
      ]);
    }
    body.appendChild(s);
    var ore = farmSection(body, '背上的矿石', '铁矿 40 层起、金矿 80 层起、铱矿 110 层起。工具升级要的就是这些。');
    var inv = {};
    for (var k in (P.inv || {})) {
      if (!Object.prototype.hasOwnProperty.call(P.inv, k)) continue;
      var base = String(k).split('_q')[0];
      for (var i = 0; i < (D.ORES || []).length; i++) if (D.ORES[i].id === base) inv[k] = P.inv[k];
    }
    ore.appendChild(farmInvGrid(P, inv, null, function () {}));
    body.appendChild(ore);
  }

  function dexBody(body) {
    var P = farmP(); if (!P) return;
    var D = farmD();
    var f = farmSection(body, '鱼类图鉴', '季节、天气、时间都会改变能钓到什么。');
    var l1 = el('div', 'sg5-farm-list');
    (function () {
      for (var i = 0; i < (D.FISH || []).length; i++) {
        (function (fish) {
          var got = (P.fishCaught || {})[fish.id] || 0;
          var row = el('div', 'sg5-farm-row');
          row.appendChild(el('span', 'sg5-farm-rowname' + (got ? '' : ' is-unknown'), got ? fish.name : '？？？'));
          row.appendChild(el('span', 'sg5-farm-rowsub', got ? (fish.sell + 'g · 钓到 ' + got + ' 条 · 难度 ' + fish.diff)
            : (D.SEASONS[fish.s[0]] + ' · 难度 ' + fish.diff)));
          l1.appendChild(row);
        })(D.FISH[i]);
      }
    })();
    f.appendChild(l1); body.appendChild(f);

    var c = farmSection(body, '作物图鉴', '收过一次就会记下来。');
    var l2 = el('div', 'sg5-farm-list');
    (function () {
      for (var k in (D.CROPS || {})) {
        if (!Object.prototype.hasOwnProperty.call(D.CROPS, k)) continue;
        (function (k) {
          var def = D.CROPS[k], got = (P.cropsGrown || {})[k] || 0;
          var row = el('div', 'sg5-farm-row');
          row.appendChild(el('span', 'sg5-farm-rowname' + (got ? '' : ' is-unknown'), got ? def.name : '？？？'));
          row.appendChild(el('span', 'sg5-farm-rowsub', got ? ('收过 ' + got + ' 次 · ' + def.days + '天 · ' + def.sell + 'g')
            : (def.s.length ? D.SEASONS[def.s[0]] + '季' : '温室')));
          l2.appendChild(row);
        })(k);
      }
    })();
    c.appendChild(l2); body.appendChild(c);
  }

  PANELS.mine = function () {
    var P = farmP();
    var sh = panelShell('钓鱼 / 矿洞', P ? ('Lv.' + ((P.levels || {}).fishing || 0) + ' 渔夫 · 第 ' + (P.mineBest || 0) + ' 层') : '正在载入…');
    sh.root.className = 'sg5-panel sg5-panel-wide sg5-panel-farm';
    mineTabs(sh.body);
    var cont = el('div', 'sg5-farm-cont');
    if (!P) cont.appendChild(el('div', 'sg5-empty', '还没载入…'));
    else if (S.farm.mineTab === 'fish') fishBody(cont);
    else if (S.farm.mineTab === 'mine') mineBody(cont);
    else dexBody(cont);
    sh.body.appendChild(cont);
    return sh.root;
  };

  // QTE 的定时器与按键监听必须随应用卸载一起走，热挂载才不会留下幽灵循环
  var _mountQte = mount;
  mount = function (container, context) {
    _mountQte(container, context);
    if (S.onDestroyAll) S.onDestroyAll.push(function () { qteCleanup(); });
  };
