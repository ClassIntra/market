  // ---------------- §18 小镇：村民好感 / 同学送礼 / 献祭包 / 畜牧棚 ----------------

  var REL_TABS = [
    ['villagers', '镇上的人'], ['classmates', '班里同学'],
    ['bundles', '社区中心'], ['animals', '畜牧棚']
  ];
  function relTabs(body) {
    var tabs = el('div', 'sg5-tabs');
    (function () {
      for (var i = 0; i < REL_TABS.length; i++) {
        (function (t) {
          var b = el('button', 'sg5-tab' + (S.farm.relationTab === t[0] ? ' is-on' : ''), t[1]);
          b.type = 'button';
          b.addEventListener('click', function () {
            S.farm.relationTab = t[0]; refreshPanel('relation'); auSfx('menu', 0.2, 1.1);
          }, false);
          tabs.appendChild(b);
        })(REL_TABS[i]);
      }
    })();
    body.appendChild(tabs);
  }

  // 送礼选择器：把背包里能送的东西平铺出来，点一样就送
  function relGiftRow(npc, onSend) {
    var P = farmP(); if (!P) return el('div', 'sg5-empty', '背包还没载入');
    var box = el('div', 'sg5-rel-gifts');
    box.appendChild(el('div', 'sg5-note', '选一样东西送出去（金星品质、生日、最爱都会放大好感）：'));
    var grid = el('div', 'sg5-farm-inv');
    var any = false;
    (function () {
      for (var k in (P.inv || {})) {
        if (!Object.prototype.hasOwnProperty.call(P.inv, k)) continue;
        if (!P.inv[k]) continue;
        any = true;
        (function (k) {
          var b = el('button', 'sg5-farm-item');
          b.type = 'button';
          var sw = el('span', 'sg5-farm-swatch');
          sw.style.background = farmItemColor(k); sw.style.borderColor = farmQualityColor(k);
          b.appendChild(sw);
          b.appendChild(el('span', 'sg5-farm-itemname', farmItemName(k)));
          b.appendChild(el('span', 'sg5-farm-itemnum', '×' + P.inv[k]));
          b.addEventListener('click', function () { onSend(k); }, false);
          grid.appendChild(b);
        })(k);
      }
    })();
    if (!any) grid.appendChild(el('div', 'sg5-empty', '背包空空的，先去田里收点东西。'));
    box.appendChild(grid);
    return box;
  }
  function relHearts(pts, P) {
    var per = (P && P.heartPts) || 250;
    var h = Math.max(0, Math.min(10, Math.floor(pts / per)));
    var box = el('div', 'sg5-rel-hearts');
    for (var i = 0; i < 10; i++) {
      box.appendChild(el('span', 'sg5-rel-heart' + (i < h ? ' is-on' : ''), i < h ? '♥' : '♡'));
    }
    return box;
  }

  function relVillagers(body) {
    var P = farmP(); if (!P) return;
    var D = farmD(), c = P.cal;
    var s = farmSection(body, '镇上的四个人',
      '每天说一句话 +20，每周最多送两次礼；最爱 +80、喜欢 +45、讨厌 −40。8 心后送花束才能继续到 10 心。');
    (function () {
      for (var k in D.VILLAGERS) {
        if (!Object.prototype.hasOwnProperty.call(D.VILLAGERS, k)) continue;
        (function (k) {
          var v = D.VILLAGERS[k];
          var r = (P.relations || {})[k] || { pts: 0, gifts: {}, bouquet: 0, seen: [] };
          var card = el('div', 'sg5-rel-card');
          var head = el('div', 'sg5-rel-head');
          head.appendChild(el('span', 'sg5-rel-name', v.name));
          var bd = (v.birthday[0] === c.season && v.birthday[1] === c.dayInSeason);
          head.appendChild(el('span', 'sg5-rel-sub', D.SEASONS[v.birthday[0]] + ' ' + v.birthday[1] + '日' + (bd ? ' · 今天生日！' : '')));
          card.appendChild(head);
          card.appendChild(relHearts(r.pts || 0, P));
          card.appendChild(el('div', 'sg5-note', '最爱：' + farmTasteName(v.love) + '　喜欢：' + farmTasteName(v.like) +
            '　讨厌：' + farmTasteName(v.hate) + '　好感 ' + (r.pts || 0)));
          var hearts = Math.floor((r.pts || 0) / (P.heartPts || 250));
          farmBtnRow(card, [
            ['说句话', function () {
              lifeAct('talk', { npc: k }).then(function (d) {
                farmToast(d.talked ? '聊了几句，好感 +20' : '今天已经聊过了');
              }, function (e) { farmToast(e.message, 'warn'); });
            }],
            [r.bouquet ? '已送花束' : '送花束（200g）', function () {
              lifeAct('bouquet', { npc: k }).then(function () { farmToast('她收下了花束'); },
                function (e) { farmToast(e.message, 'warn'); });
            }],
            [P.spouse === k ? '已成家' : '求婚（1500g）', function () {
              lifeAct('marry', { npc: k }).then(function (d) { farmToast('♥ 和' + d.name + '成家了'); },
                function (e) { farmToast(e.message, 'warn'); });
            }]
          ]);
          card.appendChild(relGiftRow(k, function (item) {
            lifeAct('gift', { npc: k, item: item }).then(function (d) {
              farmToast(v.name + (d.pts >= 0 ? '收下了' : '不太喜欢') + '：' + d.pts + ' 好感' + (d.birthday ? '（生日 ×8）' : ''));
            }, function (e) { farmToast(e.message, 'warn'); });
          }));
          s.appendChild(card);
        })(k);
      }
    })();
    body.appendChild(s);
    if (P.spouse) {
      body.appendChild(el('div', 'sg5-note', '家里有人在等：' + (D.VILLAGERS[P.spouse] ? D.VILLAGERS[P.spouse].name : P.spouse)));
      farmBtnRow(body, [['和家里人说说话', function () {
        lifeAct('spouse', {}).then(function (d) { farmToast(d.spouse ? '家里暖暖的' : '还没成家'); });
      }]]);
    }
  }
  function farmTasteName(arr) {
    if (!arr || !arr.length) return '—';
    var M = { crop: '作物', flower: '花', fish: '鱼', ore: '矿石', gem: '宝石', animal: '畜产', food: '食物' };
    var out = [];
    for (var i = 0; i < arr.length; i++) out.push(M[arr[i]] || arr[i]);
    return out.join(' / ');
  }

  function relClassmates(body) {
    var P = farmP(); if (!P) return;
    var s = farmSection(body, '班里的同学', '送出背包里的一样东西，对方会立刻收到提醒。好友与羁绊沿用「一起玩」的名单。');
    var list = (S.friends || []).slice(0, 24);
    if (!list.length) s.appendChild(el('div', 'sg5-empty', '还没有好友。先在「一起玩」里加个同学吧。'));
    (function () {
      for (var i = 0; i < list.length; i++) {
        (function (p) {
          var uid = String(p.id || p.uid || p.userId || '');
          var nm = p.name || p.n || (typeof nameOf === 'function' ? nameOf(uid) : uid);
          var bond = (S.bonds || {})[uid] || (P.relations && P.relations[uid] && P.relations[uid].pts) || 0;
          var card = el('div', 'sg5-rel-card');
          var head = el('div', 'sg5-rel-head');
          head.appendChild(el('span', 'sg5-rel-name', nm));
          head.appendChild(el('span', 'sg5-rel-sub', (p.online ? '在线' : '离线') + ' · 羁绊 ' + bond));
          card.appendChild(head);
          card.appendChild(relGiftRow(uid, function (item) {
            lifeAct('playergift', { to: uid, item: item }).then(function () {
              farmToast('送给了 ' + nm + ' 一份' + farmItemName(item));
            }, function (e) { farmToast(e.message, 'warn'); });
          }));
          s.appendChild(card);
        })(list[i]);
      }
    })();
    body.appendChild(s);
  }

  function relBundles(body) {
    var P = farmP(); if (!P) return;
    var D = farmD();
    var done = 0;
    for (var z = 0; z < D.BUNDLES.length; z++) if (P.bundles[D.BUNDLES[z].id] && P.bundles[D.BUNDLES[z].id].done) done++;
    var s = farmSection(body, '社区中心 · 献祭包 ' + done + '/' + D.BUNDLES.length,
      P.greenhouse ? '全部交齐了：温室已修好，冬天也能种地。' : '交齐一整间房就修好一部分；全部交齐解锁温室（四季可种）。');
    (function () {
      for (var i = 0; i < D.BUNDLES.length; i++) {
        (function (b) {
          var slot = (P.bundles || {})[b.id] || { items: {}, done: 0 };
          var card = el('div', 'sg5-rel-card');
          var head = el('div', 'sg5-rel-head');
          head.appendChild(el('span', 'sg5-rel-name', b.name + (slot.done ? ' ✓' : '')));
          head.appendChild(el('span', 'sg5-rel-sub', b.room + ' · 奖励 ' + b.reward.n + ' ' + farmItemName(b.reward.id)));
          card.appendChild(head);
          var row = el('div', 'sg5-bundle-needs');
          (function () {
            for (var j = 0; j < b.need.length; j++) {
              (function (n) {
                var needId = n.indexOf('gold_') === 0 ? n.slice(5) + '_q2' : n;
                var have = (P.inv || {})[needId] > 0;
                var got = !!slot.items[n];
                row.appendChild(el('span', 'sg5-bundle-need' + (got ? ' is-done' : have ? ' is-have' : ''),
                  (got ? '✓ ' : have ? '+ ' : '· ') + farmItemName(needId)));
              })(b.need[j]);
            }
          })();
          card.appendChild(row);
          if (!slot.done) {
            farmBtnRow(card, [['交上背包里已有的', function () {
              var items = {};
              for (var j = 0; j < b.need.length; j++) {
                var n = b.need[j];
                var needId = n.indexOf('gold_') === 0 ? n.slice(5) + '_q2' : n;
                if (!slot.items[n] && (P.inv || {})[needId] > 0) items[n] = 1;
              }
              lifeAct('bundle', { id: b.id, items: items }).then(function (d) {
                farmToast(d.reward ? '交齐了！领到 ' + d.reward : '交上去 ' + d.moved + ' 样，还差 ' + d.left + ' 样');
              }, function (e) { farmToast(e.message, 'warn'); });
            }]]);
          }
          s.appendChild(card);
        })(D.BUNDLES[i]);
      }
    })();
    body.appendChild(s);
  }

  function relAnimals(body) {
    var P = farmP(); if (!P) return;
    var D = farmD();
    var s = farmSection(body, '畜牧棚 ' + ((P.animals || []).length) + ' 只',
      '每天喂一次干草（杂货铺 50g）、摸一摸，第二天早上就有产出；好感越高越容易出大号产物。');
    if (!(P.animals || []).length) s.appendChild(el('div', 'sg5-empty', '棚里还空着。去「农场 → 商店」领一只回来。'));
    (function () {
      for (var i = 0; i < (P.animals || []).length; i++) {
        (function (a) {
          var def = D.ANIMALS[a.kind] || { name: a.kind };
          var card = el('div', 'sg5-rel-card');
          var head = el('div', 'sg5-rel-head');
          head.appendChild(el('span', 'sg5-rel-name', a.name));
          head.appendChild(el('span', 'sg5-rel-sub', '好感 ' + a.love + '/1000' +
            (P.cal.day < a.matureDay ? ' · 还要 ' + (a.matureDay - P.cal.day) + ' 天长大' : ' · 已成年')));
          card.appendChild(head);
          farmBtnRow(card, [
            ['喂干草', function () {
              lifeAct('animal', { mode: 'feed', uid: a.uid }).then(function () { farmToast(a.name + '吃得很香'); },
                function (e) { farmToast(e.message, 'warn'); });
            }],
            ['摸一摸', function () {
              lifeAct('animal', { mode: 'pet', uid: a.uid }).then(function () { farmToast(a.name + '蹭了蹭你'); },
                function (e) { farmToast(e.message, 'warn'); });
            }],
            [a.product && !a.collected ? '收取 ' + farmItemName(a.product) : '今天没有产出', function () {
              lifeAct('animal', { mode: 'collect', uid: a.uid }).then(function (d) {
                farmToast('收到了 ' + d.name);
              }, function (e) { farmToast(e.message, 'warn'); });
            }]
          ]);
          s.appendChild(card);
        })(P.animals[i]);
      }
    })();
    body.appendChild(s);
  }

  PANELS.relation = function () {
    var P = farmP();
    var sh = panelShell('小镇', P ? (P.cal.seasonName + ' · ' + (P.spouse ? '已安家' : '一个人住')) : '正在载入…');
    sh.root.className = 'sg5-panel sg5-panel-wide sg5-panel-farm';
    relTabs(sh.body);
    var cont = el('div', 'sg5-farm-cont');
    if (!P) cont.appendChild(el('div', 'sg5-empty', '小镇还没载入…'));
    else if (S.farm.relationTab === 'villagers') relVillagers(cont);
    else if (S.farm.relationTab === 'classmates') relClassmates(cont);
    else if (S.farm.relationTab === 'bundles') relBundles(cont);
    else relAnimals(cont);
    sh.body.appendChild(cont);
    return sh.root;
  };
