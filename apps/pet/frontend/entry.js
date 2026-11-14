// 桌宠屋（页面）：领养 → 拼豆编辑器 → 我的宠物
// ============================================================
// 拼豆编辑器（对平板手感优化）：
//   - 16×16 网格，画笔/橡皮/油漆桶，16 色拼豆盘
//   - 左右对称模式（新手神器，实体拼豆也是这么玩的）
//   - 撤销（30 步快照）；官方模板可直接改
// 保存后 dispatch 'ci-pet-state-changed'，悬浮桌宠即时刷新。
// 编码约定：全 ES5（Chrome 80 基线）
(function() {
  'use strict';
  var NAME = 'pet';
  var DIM = 16;          // 网格
  // 编辑画布每格 px：按「宠物屋容器实际宽度」自适应，而不是 window.innerWidth ——
  // 宿主（AppShell → MarketRuntime）给应用的是 height:100% 的受限盒子，视口再宽也照
  // 容器算，否则 16 格 × 大格宽会把画布顶出可视区且又没有横向滚动。
  // 预算 = 容器宽 − root 左右 padding(32) − 画布容器 padding(16) − 安全余量(8)
  function availWidth() {
    var w = (root && root.clientWidth) ? root.clientWidth : Math.min(window.innerWidth || 360, 720);
    return w - 40;
  }
  // 画板尺寸（v0.38.0）：按**画板卡自己的真实宽高**算，不再猜窗口宽度。
  //   旧版封顶 30px/格 + 固定留 250px 给页头，平板横屏 16×16 只有 480px，
  //   右边一半屏幕空着 —— 用户原话「可拼的地方太小了」。
  //   现在：宽度取画板卡内容宽（宽屏时工具列已占走一列），高度取画板卡顶到视口底，
  //   上限放到 56；平板 1024×768 下 16×16 ≈ 576px，32×32 ≈ 576px。
  var CELL_MAX = 56;
  function computeCell() {
    var n = (edit && edit.w) || DIM;
    var avail = availWidth();
    if (canvasWrapEl && canvasWrapEl.clientWidth > 60) avail = canvasWrapEl.clientWidth - 20;
    var byW = Math.floor(avail / n);
    var byH = Math.floor(((window.innerHeight || 768) - 250) / n);
    // 横屏（编辑区已定高）：直接用画板卡的可用高度，比猜视口稳。
    // 扣掉卡片内边距 16 + 坐标行 24，剩下全是画板。
    if (canvasWrapEl && canvasWrapEl.style.height && canvasWrapEl.clientHeight > 160) {
      byH = Math.floor((canvasWrapEl.clientHeight - 44) / n);
    } else if (canvasWrapEl && canvasWrapEl.getBoundingClientRect) {
      var top = canvasWrapEl.getBoundingClientRect().top;
      if (top > 0 && top < window.innerHeight - 120) {
        byH = Math.floor((window.innerHeight - top - 44) / n);
      }
    }
    var cell = Math.min(CELL_MAX, byW, byH);
    // 不强制偶数：64 格时 9.75 → 9 能多出 64px；发丝缝由 drawImage 的 +0.5 兜住
    return Math.max(6, Math.floor(cell));
  }
  var CELL = computeCell();
  // 拼豆画板档位（后端单边上限同步为 64）。
  // 48/64 在平板上单格只有 9~12px，靠「缩放 + 抓手」才能真正点得准。
  var SIZES = [16, 24, 32, 48, 64];
  var ZOOMS = [1, 1.5, 2, 3];
  // 色号与中文名：和「实体拼豆备料」对齐，A1–A16 按后端 PALETTE.p16 顺序
  var BEAD_NAMES = ['墨黑', '石灰', '瓷白', '云灰', '朱红', '樱花粉', '蜜橙', '阳光黄', '焦糖棕', '青草绿', '森林绿', '冰蓝', '晴空蓝', '葡萄紫', '奶油杏', '玫瑰红'];
  var palette = [];
  var templates = [];
  var state = null;      // 服务端状态
  var root = null;
  var api = null;
  var storage = null;    // SDK 本地存档（手作稿，供「换回拼豆」时复原）
  var uiTab = 'home';    // 当前页：home / battle / dex / rank（v0.8.0 分区）
  // 编辑器是否开着。开着的时候，任何「后台自动重绘首页」都必须作废：
  //   许愿气泡每 15s 检查一次、剧情/战斗数据回包、昼夜换景……都会调 renderHome()，
  //   而编辑器挂在 home 这个 tab 上 —— 一重建就把正在拼豆的人弹回宠物屋（实测「拼一半跳出去」）。
  var editorOpen = false;
  var tabAnim = true;    // 首次进入也播一次入场；之后只认「切页」那一次（普通刷新零动画）
  var elements = [];     // 属性表（服务端 /pet/state 下发，失败时用兜底）
  var wildCatalog = [];  // 野生精灵图鉴（服务端下发）
  var buddyInfo = null;  // 当前随行伙伴
  var evolutionInfo = null; // 当前进化阶段
  var weatherInfo = null;   // 今日天气（v0.10.0，按日期哈希，全班一致）
  var shopInfo = null;      // 小卖部货架（v0.25.0，随 /state 下发）
  var heartInfo = null;     // 情感陪伴摘要（v0.37.0，随 /state 与 /pet/heart 下发）
  var petWish = null;
  var storyInfo = null;
  var petWishTimer = null;

  function rollWish() {
    if (!state || !state.adopted) { petWish = null; return; }
    var now = new Date();
    var h = now.getHours();
    var wishes = [];
    if (h >= 6 && h < 23) {
      wishes.push({ id: 'poke', icon: '🤗', title: '它想被摸摸', desc: '蹭蹭你，想要你揉揉脑袋', action: 'poke', rewardBond: 2, rewardCoin: 1, sfx: 'poke' });
    }
    if ((state.fed_today || 0) < 2) {
      wishes.push({ id: 'feed', icon: '🍚', title: '它想吃点好吃的', desc: '肚子咕咕叫，馋得不行', action: 'feed', rewardBond: 3, rewardCoin: 2, sfx: 'feed' });
    }
    if (focusTodayMin() < 30) {
      wishes.push({ id: 'focus', icon: '📚', title: '想你陪它专注', desc: '一起坐会儿，谁也别刷手机', action: 'focus', rewardBond: 2, rewardCoin: 1, sfx: 'focus-start' });
    }
    if ((battle && battle.today === 0) || !battle) {
      wishes.push({ id: 'battle', icon: '⚔️', title: '想去活动筋骨', desc: '来场热血练习赛，好久没动了', action: 'battle', rewardBond: 2, rewardCoin: 2, sfx: 'click' });
    }
    if (personalityInfo && personalityInfo.id === 'curious') {
      wishes.push({ id: 'call', icon: '👀', title: '好奇心上来了', desc: '呼唤它一下，它特别想跟你玩', action: 'call', rewardBond: 2, rewardCoin: 1, sfx: 'click' });
    }
    if (!wishes.length) wishes.push({ id: 'poke', icon: '💚', title: '想和你待在一起', desc: '就想靠近你，啥也不用干', action: 'poke', rewardBond: 2, rewardCoin: 1, sfx: 'poke' });
    petWish = wishes[Math.floor(Math.random() * wishes.length)];
    petWish.expiresAt = Date.now() + 90000;
  }

  function startWishLoop() {
    if (petWishTimer) { clearInterval(petWishTimer); petWishTimer = null; }
    rollWish();
    renderHome();
    petWishTimer = setInterval(function() {
      if (!petWish) { rollWish(); renderHome(); return; }
      if (Date.now() > petWish.expiresAt) { rollWish(); renderHome(); }
    }, 15000);
  }


  // 条件行：把「还差什么」摆到明面上。
  // 条件全部来自后端 /pet/story 的 reqs（与解锁判定同源），前端不再手写进度文案 ——
  // 手写那版第三章漏了图鉴条件，线上有人羁绊 330、胜场 185 却卡在第三章。
  function storyReqRow(r) {
    var row = h('div', 'ci-pet-story-req' + (r.ok ? ' is-ok' : ' is-todo'));
    row.appendChild(h('span', 'ci-pet-story-reqmark', r.ok ? '✓' : '·'));
    row.appendChild(h('span', 'ci-pet-story-reqlabel', r.label));
    row.appendChild(h('span', 'ci-pet-story-reqval',
      r.have + ' / ' + r.need + (r.unit || '')));
    if (!r.ok) {
      row.appendChild(h('span', 'ci-pet-story-reqgo', '去补 →'));
      // 点整行就跳去补：让「图鉴 0/5」不只是一句判词。
      row.addEventListener('click', function() {
        worldSheetClose(true);
        switchTab(r.target || 'home');
      });
    }
    return row;
  }

  // 章节回顾：已解锁的章节能翻回去读，未解锁的显示还差什么。
  // 之前 6 章只渲染「当前这一章」，读过的话再想看就没入口了 ——
  // 这也是「剧情像标签而不像故事」的直接原因。
  function storyArchive(s) {
    var chapters = s.chapters || [];
    if (!chapters.length) return null;
    var box = h('div', 'ci-pet-story-archive');
    var open = false;
    var list = h('div', 'ci-pet-story-arclist');
    list.style.display = 'none';
    var unlockedN = 0;
    for (var i = 0; i < chapters.length; i++) if (chapters[i].unlocked) unlockedN++;
    var btn = h('button', 'ci-pet-story-arcbtn',
      '章节目录 · 已解锁 ' + unlockedN + ' / ' + chapters.length);
    btn.addEventListener('click', function() {
      open = !open;
      list.style.display = open ? '' : 'none';
      btn.textContent = (open ? '收起目录' : '章节目录') + ' · 已解锁 ' + unlockedN + ' / ' + chapters.length;
    });
    box.appendChild(btn);

    for (var j = 0; j < chapters.length; j++) {
      (function(c) {
        var row = h('div', 'ci-pet-story-arcrow' +
          (c.unlocked ? '' : ' is-lock') + (c.isCurrent ? ' is-current' : ''));
        var line = h('div', 'ci-pet-story-arcline');
        line.appendChild(h('span', 'ci-pet-story-arctitle', (c.icon || '📖') + ' ' + c.title));
        if (c.unlocked) {
          line.appendChild(h('span', 'ci-pet-story-arctag',
            c.claimed ? '已领奖' : (c.isCurrent ? '当前' : '已读')));
        } else {
          // 未解锁不给叙述，只给「差多少」——既保悬念，也不让人干瞪眼
          var lack = [];
          for (var k = 0; k < (c.reqs || []).length; k++) {
            var r = c.reqs[k];
            if (!r.ok) lack.push(r.label + ' ' + r.short + (r.unit || ''));
          }
          line.appendChild(h('span', 'ci-pet-story-arctag is-need',
            lack.length ? '还差 ' + lack.join(' · ') : '待解锁'));
        }
        row.appendChild(line);

        if (c.unlocked && c.narrative) {
          var narr = h('div', 'ci-pet-story-arcnarr', c.narrative);
          narr.style.display = 'none';
          row.appendChild(narr);
          row.addEventListener('click', function() {
            narr.style.display = (narr.style.display === 'none') ? '' : 'none';
          });
        }
        list.appendChild(row);
      })(chapters[j]);
    }
    box.appendChild(list);
    return box;
  }

  function storyCard() {
    // 数据从 /pet/story 拉取，这里用 storyInfo 缓存
    var s = storyInfo;
    if (!s) return null;
    var box = h('div', 'ci-pet-story');
    var head = h('div', 'ci-pet-story-head');
    head.appendChild(h('span', 'ci-pet-story-icon', (s.current && s.current.icon) || '📖'));
    var txt = h('div', 'ci-pet-story-text');
    txt.appendChild(h('div', 'ci-pet-story-title', (s.current && s.current.title) || '故事'));
    var subText = '第 ' + (s.currentIdx + 1) + ' / ' + s.totalCount + ' 章';
    if (s.canClaim) {
      subText += ' · 新章节可领取';
    } else if (s.next) {
      var lackN = 0;
      for (var q = 0; q < (s.next.reqs || []).length; q++) if (!s.next.reqs[q].ok) lackN++;
      subText += lackN ? (' · 下一章还差 ' + lackN + ' 项') : ' · 下一章可解锁';
    } else {
      subText += ' · 故事已到终点';
    }
    txt.appendChild(h('div', 'ci-pet-story-sub', subText));
    head.appendChild(txt);
    box.appendChild(head);
    if (s.current && s.current.narrative) {
      box.appendChild(h('div', 'ci-pet-story-narr', s.current.narrative));
    }
    if (s.canClaim) {
      var btn = h('button', 'ci-pet-story-btn', '领取奖励');
      btn.addEventListener('click', function() {
        btn.disabled = true; btn.textContent = '领取中…';
        api.post('/pet/story/claim', {}).then(function(res) {
          var d = (res.data && res.data.data) || {};
          if (d.state) state = d.state;
          if (d.mood) moodInfo = d.mood;
          if (d.personality) personalityInfo = d.personality;
          absorbProgress(d);
          sysToast('章节奖励：+' + (d.addedCoins || 0) + ' 小鱼干 +' + (d.addedBond || 0) + ' 羁绊', 'success');
          loadStory(function() { renderHome(); });
        }, function(err) {
          var m = (err && err.response && err.response.data && err.response.data.message) || '领取失败';
          sysToast(m, 'error');
          btn.disabled = false; btn.textContent = '领取奖励';
        });
      });
      box.appendChild(btn);
    }
    // 下一章的门槛：这是玩家最需要的信息，比任何一句氛围文案都重要
    if (s.next && s.next.reqs && s.next.reqs.length) {
      var rq = h('div', 'ci-pet-story-reqs');
      rq.appendChild(h('div', 'ci-pet-story-reqtitle',
        (s.next.icon || '') + ' 通往「' + s.next.title + '」'));
      for (var i = 0; i < s.next.reqs.length; i++) rq.appendChild(storyReqRow(s.next.reqs[i]));
      box.appendChild(rq);
    }
    // 进度条
    var prog = h('div', 'ci-pet-story-prog');
    var fill = h('span', 'ci-pet-story-progfill');
    var pct = s.totalCount > 0 ? Math.round((s.currentIdx + 1) / s.totalCount * 100) : 0;
    fill.style.width = pct + '%';
    prog.appendChild(fill);
    box.appendChild(prog);
    var arc = storyArchive(s);
    if (arc) box.appendChild(arc);
    return box;
  }

  function loadStory(cb) {
    if (!api) { if (cb) cb(); return; }
    api.get('/pet/story').then(function(res) {
      var d = (res.data && res.data.data) || {};
      storyInfo = d;
      if (cb) cb();
    }, function() { if (cb) cb(); });
  }

  var personalityInfo = null; // 性格（v0.15.0，领养时定下，恒久影响收益与台词）
  var moodInfo = null;        // 心情（v0.15.0，按时段/饱食/互动现算）

  // /pet/state 没返回属性表时的兜底：只保证页面能画出来，数值以服务端为准。
  var ELEMENT_FALLBACK = {
    fire:     { id: 'fire',     name: '火', icon: '🔥', color: '#FF6B4A', beats: 'grass',    beatsName: '草', weakTo: 'water',    weakToName: '水' },
    grass:    { id: 'grass',    name: '草', icon: '🌿', color: '#34C759', beats: 'earth',    beatsName: '土', weakTo: 'fire',     weakToName: '火' },
    earth:    { id: 'earth',    name: '土', icon: '⛰️', color: '#B07A4A', beats: 'electric', beatsName: '电', weakTo: 'grass',    weakToName: '草' },
    electric: { id: 'electric', name: '电', icon: '⚡', color: '#E6A700', beats: 'water',    beatsName: '水', weakTo: 'earth',    weakToName: '土' },
    water:    { id: 'water',    name: '水', icon: '💧', color: '#0A84FF', beats: 'fire',     beatsName: '火', weakTo: 'electric', weakToName: '电' }
  };
  var ELEMENT_ORDER = ['fire', 'grass', 'earth', 'electric', 'water'];

  // ================= 像素小图标（v0.25.0）====================
  // 内页原来满屏 emoji（⚔️🗺️🎒🏆🔥🌿⛰️⚡💧🏠）：每个 emoji 都是一张系统彩色贴图，
  // 大小、配色、描边全不受控。它和 5px 像素家具同屏时，一眼就能看出「两个世界」——
  // 这正是「内页不像小家」的第一来源。
  // 做法：和家具同一套流水线 —— 12×12 字符画 → pxArt() → 内联 SVG（自带 1px 内描边）。
  // 12px 画布按 24px 显示 = 每格 2px，整数缩放，永远清晰。
  // ⚠️ 每行必须正好 12 个字符（探针里有长度断言），少于 12 会自动补透明格，
  //    美术贴边就丢描边。palette 只用单个 ASCII 小写键，别用两位键。
  var PIX_ICONS = {
    // 塔（v0.28.0 · 试炼塔一级入口）：对称五段收分的塔身 + 金窗 + 塔尖亮顶。
    // 之前埋在「对战 → 抽屉 → 第三个标签」三层深，实测用户找不到深渊在哪。
    tower: { pal: { a: '#5e5484', b: '#cabfff', c: '#ffd76e' }, rows: [
      '.....bb.....',
      '....abba....',
      '....abba....',
      '....acba....',
      '...aabbaa...',
      '...aacbaa...',
      '..aaabbaaa..',
      '..aaacbaaa..',
      '.aaaabbaaaa.',
      '.aaaacbaaaa.',
      'aaaabccbaaaa',
      'aaabccccbaaa'
    ] },
    // 太阳（昼夜切换钮 · 白天态）：8 向硬边光线 + 暖核
    sun: { pal: { r: '#ffc95e', y: '#ffd76e', w: '#fff6d0' }, rows: [
      '.....rr.....',
      '.r...yy...r.',
      '..r.yyyy.r..',
      '...yywwyy...',
      '..yywwwwyy..',
      'rryywwwwyyrr',
      '..yywwwwyy..',
      '...yywwyy...',
      '..r.yyyy.r..',
      '.r...yy...r.',
      '.....rr.....',
      '............'
    ] },
    // 月亮（昼夜切换钮 · 夜晚态）：朝左的月牙，奶油色
    moon: { pal: { m: '#f6ead6' }, rows: [
      '....mmmm....',
      '..mmmmmmm...',
      '.mmmmmmmmm..',
      '.mmmmmm.....',
      'mmmmmm......',
      'mmmmm.......',
      'mmmmm.......',
      'mmmmm.......',
      'mmmmmm......',
      '.mmmmmm.....',
      '.mmmmmmmm...',
      '....mmmm....'
    ] },
    // 火：焰心高光在下方，焰尖偏左（和房间壁炉同向的动势）
    fire: { pal: { a: '#b8331f', b: '#e8562f', c: '#ffb05c' }, rows: [
      '............',
      '.....a......',
      '....aba.....',
      '....aba.....',
      '...abbba....',
      '..abbbbba...',
      '..abbcbba...',
      '.abbcccbba..',
      '.abbbccbba..',
      '..abbbbba...',
      '....aba.....',
      '.....a......'
    ] },
    // 草：一片斜出的叶子，主脉用高光
    grass: { pal: { a: '#245c33', b: '#3f9a53', c: '#7fd07a' }, rows: [
      '............',
      '........aaa.',
      '......aabbba',
      '.....abcbbba',
      '....abcbbbba',
      '...abcbbbbba',
      '...abcbbbbba',
      '..abbbbbbbba',
      '..abbbbbbba.',
      '...aabbbba..',
      '......aaa...',
      '............'
    ] },
    // 土：山体双峰，左侧受光
    earth: { pal: { a: '#5a3d23', b: '#96693c', c: '#c9a06a' }, rows: [
      '............',
      '............',
      '.....aa.....',
      '....abba....',
      '....abba....',
      '...abccba...',
      '...abccba...',
      '..abcbbbba..',
      '..abbbbbba..',
      '.abbcbbbbba.',
      '.aaaaaaaaaa.',
      '............'
    ] },
    // 电：折角闪电，右侧留充能空隙
    electric: { pal: { a: '#8a5a00', b: '#e6b02a', c: '#ffe27a' }, rows: [
      '............',
      '......aaaa..',
      '.....abbba..',
      '....abba....',
      '...abba.....',
      '..abbbbbba..',
      '..abbbbba...',
      '.....abba...',
      '....abba....',
      '...abba.....',
      '...aaa......',
      '............'
    ] },
    // 水：水滴，左上一点高光
    water: { pal: { a: '#1c4f8a', b: '#3a86c9', c: '#9fd2f0' }, rows: [
      '............',
      '.....aa.....',
      '....abba....',
      '....abba....',
      '...abbbba...',
      '..abbbbbba..',
      '..acbbbbba..',
      '..abbbbbba..',
      '..abbbbbba..',
      '...abbbba...',
      '....aaaa....',
      '............'
    ] },
    // 剑：战力。竖刃 + 护手 + 柄头，四点都压在格子中心，24px 下不糊
    sword: { pal: { a: '#6b6b78', b: '#c9ccd6', c: '#ffd76e' }, rows: [
      '.....aa.....',
      '....abba....',
      '....abba....',
      '....abba....',
      '..aaacaaa...',
      '....abba....',
      '....abba....',
      '....abba....',
      '....abba....',
      '.....aa.....',
      '............',
      '............'
    ] },
    // 交叉双剑：对战
    fight: { pal: { a: '#6b6b78', b: '#c9ccd6', c: '#ffd76e' }, rows: [
      'aa........aa',
      'aba......aba',
      '.aba....aba.',
      '..aba..aba..',
      '...abaaba...',
      '....abba....',
      '...abaaba...',
      '..aba..aba..',
      '.aba....aba.',
      'aa........aa',
      '............',
      '............'
    ] },
    // 藏宝图：副本入口。折缝 + 红叉，比「卷轴」更像「去哪儿」
    env: { pal: { a: '#8a5a2a', b: '#e8d3a8', c: '#c0392b' }, rows: [
      '............',
      '..aaaaaaaa..',
      '..abbbbbba..',
      '..abbcbcba..',
      '..abbcbcba..',
      '..abbbbbba..',
      '..abcaacba..',
      '..abbbbbba..',
      '..abbbbbba..',
      '..aaaaaaaa..',
      '............',
      '............'
    ] },
    // 背包：备战
    build: { pal: { a: '#5a3d23', b: '#a8703c', c: '#ffd76e' }, rows: [
      '............',
      '.....aa.....',
      '....a..a....',
      '..aaaaaaaa..',
      '..abbbbbba..',
      '..abbbbbba..',
      '..abbccbba..',
      '..abbbbbba..',
      '..abbbbbba..',
      '..aaaaaaaa..',
      '............',
      '............'
    ] },
    // 奖杯：荣誉
    honor: { pal: { a: '#8a5a00', b: '#e6b02a', c: '#fff0b8' }, rows: [
      '............',
      '..aaaaaaaa..',
      '..abbbbbba..',
      '.aabbbcbbaa.',
      '.aabbbbbbaa.',
      '..abbbbbba..',
      '...abbbba...',
      '....abba....',
      '.....aa.....',
      '...abbbba...',
      '..aaaaaaaa..',
      '............'
    ] },
    // 小屋：回家
    home: { pal: { a: '#3a2619', b: '#a8703c', c: '#ffd76e' }, rows: [
      '............',
      '.....aa.....',
      '....abba....',
      '...abbbba...',
      '..abbbbbba..',
      '.abbbbbbbba.',
      '.abbbbbbbba.',
      '.abbbbbbbba.',
      '.abbaaabbba.',
      '.abba.abbba.',
      '.aaaaaaaaaa.',
      '............'
    ] },
    // 小鱼干：货币（和小家 HUD 的 🐟 是同一件东西）
    fish: { pal: { a: '#2a4a63', b: '#7fb2cf', c: '#e8f6ff' }, rows: [
      '............',
      '............',
      '...aaaa.....',
      '..abbbbaa...',
      '.abbbcbbba..',
      '.abbbbbbbba.',
      '..abbbbbba..',
      '...aaaaaa...',
      '............',
      '............',
      '............',
      '............'
    ] },
    // 关闭：抽屉右上角的 X（原来是一个 ✕ 字形，粗细随字体变）
    close: { pal: { a: '#3a2619', b: '#e8d3a8' }, rows: [
      '............',
      '..aa....aa..',
      '..aba..aba..',
      '...abaaba...',
      '....abba....',
      '.....aa.....',
      '....abba....',
      '...abaaba...',
      '..aba..aba..',
      '..aa....aa..',
      '............',
      '............'
    ] },
    // ---- v0.37.1 心意面板：情感相关图标（12×12，显示 24px = 每格 2px 整数缩放）----
    // 抱一抱：一颗带高光的心
    hug: { pal: { a: '#8a2436', b: '#e8566f', c: '#ffc2cc' }, rows: [
      '............',
      '...aa..aa...',
      '..abbaabba..',
      '.abbccbbbba.',
      '.abbcbbbbba.',
      '..abbbbbba..',
      '...abbbba...',
      '....abba....',
      '.....aa.....',
      '............',
      '............',
      '............'
    ] },
    // 顺顺毛：一把木梳（梳背 + 两排梳齿）
    groom: { pal: { a: '#5a3c1c', b: '#c9a06a', c: '#f2e3c8' }, rows: [
      '............',
      '..aaaaaaaa..',
      '..abbbbbba..',
      '..abbbbbba..',
      '..aaaaaaaa..',
      '..acacacac..',
      '..acacacac..',
      '..aaaaaaaa..',
      '..abbbbbba..',
      '..aaaaaaaa..',
      '............',
      '............'
    ] },
    // 一起发呆：一朵软云
    cloud: { pal: { a: '#6b7a8f', b: '#dfe8f5', c: '#ffffff' }, rows: [
      '............',
      '............',
      '....aaaa....',
      '..aabbbbaa..',
      '.abbbbbbbba.',
      '.abbcbbbbba.',
      '.abbbbbbbba.',
      '.abbbbbbbba.',
      '..abbbbbba..',
      '...aaaaaa...',
      '............',
      '............'
    ] },
    // 累：下着小雨的云
    rain: { pal: { a: '#5a6a80', b: '#a8b6c8', c: '#64d2ff' }, rows: [
      '............',
      '....aaaa....',
      '..aabbbbaa..',
      '.abbbbbbbba.',
      '.abbbbbbbba.',
      '.abbbbbbbba.',
      '..aaaaaaaa..',
      '...c..c..c..',
      '..c..c..c...',
      '............',
      '............',
      '............'
    ] },
    // 难过：一滴蓝眼泪
    drop: { pal: { a: '#1c4f8a', b: '#4aa3e0', c: '#cfeaff' }, rows: [
      '............',
      '.....aa.....',
      '.....aa.....',
      '....abba....',
      '....abba....',
      '...abbbba...',
      '..abbbbbba..',
      '..abbcbbba..',
      '..abbbbbba..',
      '...abbbba...',
      '....aaaa....',
      '............'
    ] },
    // 期待：四角闪光
    sparkle: { pal: { a: '#8a5a00', b: '#e6b02a', c: '#fff0b8' }, rows: [
      '............',
      '.....aa.....',
      '....abba....',
      '...abccba...',
      '..abccccba..',
      '.abccccccba.',
      '..abccccba..',
      '...abccba...',
      '....abba....',
      '.....aa.....',
      '............',
      '............'
    ] },
    // 回忆未解锁：一把灰锁
    lock: { pal: { a: '#3a3a44', b: '#7a7a88', c: '#a8a8b8' }, rows: [
      '............',
      '....aaaa....',
      '...a....a...',
      '...a....a...',
      '..aaaaaaaa..',
      '..abbbbbba..',
      '..abbccbba..',
      '..abbbbbba..',
      '..abbbbbba..',
      '..aaaaaaaa..',
      '............',
      '............'
    ] }
  };

  // ==================== v0.30.0 舞台装修：小道具像素画 ====================
  // 毛坯场景（天/星/山/地四层渐变）读起来像「没布置的剧场」——用户吐槽
  // 「舞台有点太简陋了」。这一版往场景里铺道具：天上的太阳/月亮复用
  // PIX_ICONS，草地的草丛/小花/石子、两侧的旗杆/彩旗/火盆/火苗在这画。
  // 全部走 pxArt 内描边，与房间像素语言同一套（.workbuddy/tmp/pet-art/_art8.py 生成）。
  var STAGE_ART = {
    cloud: { w: 26, h: 10, pal: {'n': '#ffffff', 'm': '#d6e6f2'}, rows: [
      '..........................',
      '..........nnnnnnn.........',
      '.......nnnnnnnnnnnnn......',
      '.......nnnnnnnnnnnnn......',
      '.....nnnnnnnnnnnnnnnnn....',
      '.....nnnnnnnnnnnnnnnnn....',
      '...nnnnnnnnnnnnnnnnnnnnn..',
      '...nnnnnnnnnnnnnnnnnnnnn..',
      '....mmmmmmmmmmmmmmmmmmm...',
      '.....mmmmmmmmmmmmmmmmm....',
    ] },
    cloud2: { w: 16, h: 8, pal: {'n': '#ffffff', 'm': '#d6e6f2'}, rows: [
      '................',
      '.....nnnnnnn....',
      '....nnnnnnnnn...',
      '....nnnnnnnnn...',
      '...nnnnnnnnnnn..',
      '...nnnnnnnnnnn..',
      '....mmmmmmmmm...',
      '................',
    ] },
    grassA: { w: 10, h: 8, pal: {'g': '#5f9a4c', 'h': '#8cc46a', 'd': '#3f7038'}, rows: [
      '....h.....',
      '....g.h...',
      '....dg....',
      '.g..dd..g.',
      'hd..dd..dh',
      '.d..dd..d.',
      '.d..dd..d.',
      'dddddddddd',
    ] },
    grassB: { w: 12, h: 9, pal: {'g': '#5f9a4c', 'h': '#8cc46a', 'd': '#3f7038'}, rows: [
      '.....h......',
      '.....gh.....',
      '.g...d......',
      'h.g..d..g...',
      '..d..d..dg..',
      '..dd.d..d.h.',
      '..dd.d..dd..',
      '..dd.d..dd..',
      '.dddddddddd.',
    ] },
    flower: { w: 8, h: 10, pal: {'p': '#e895a8', 'q': '#f9cdd8', 'y': '#f2c94c', 's': '#4e7c46', 'l': '#6f9e4a'}, rows: [
      '........',
      '..qppq..',
      '.q.pp.q.',
      '.ppyypp.',
      '.pqyyqp.',
      '..pppp..',
      '...s....',
      '...sll..',
      '..ls.s..',
      '...s....',
    ] },
    pebble: { w: 11, h: 6, pal: {'a': '#9a917f', 'b': '#b8ae9a', 'c': '#7a7264'}, rows: [
      '...........',
      '...........',
      '...ab......',
      '..abaaa.c..',
      '..aaaaaccac',
      '..aaaaacccc',
    ] },
    pole: { w: 6, h: 48, pal: {'k': '#5c3d22', 'w': '#7a5230', 'l': '#96683c', 'i': '#4a3018'}, rows: [
      'kwlwkk', 'kwlwkk', 'kwlwkk', 'kwlwkk', 'kwlwkk', 'kwlwkk', 'kwlwkk', 'kwlwkk',
      'iiiiii', 'iiiiii',
      'kwlwkk', 'kwlwkk', 'kwlwkk', 'kwlwkk', 'kwlwkk', 'kwlwkk', 'kwlwkk', 'kwlwkk',
      'kwlwkk', 'kwlwkk', 'kwlwkk', 'kwlwkk', 'kwlwkk', 'kwlwkk', 'kwlwkk', 'kwlwkk',
      'kwlwkk', 'kwlwkk', 'kwlwkk', 'kwlwkk', 'kwlwkk', 'kwlwkk', 'kwlwkk', 'kwlwkk',
      'kwlwkk', 'kwlwkk', 'kwlwkk', 'kwlwkk',
      'iiiiii', 'iiiiii',
      'kwlwkk', 'kwlwkk', 'kwlwkk', 'kwlwkk', 'kwlwkk', 'kwlwkk',
      'iiiiii', 'iiiiii',
    ] },
    flag: { w: 15, h: 11, pal: {'r': '#cf5b47', 'd': '#a03e33', 'l': '#ea8068', 'k': '#5c3d22'}, rows: [
      'k..............',
      'klrllrllrllrl..',
      'krllrllrllrldr.',
      '.llrllrllrllrd.',
      '.rrrrrrrrrrrr..',
      '.rrrrrrrrrrr...',
      '.ddddrrrrr.....',
      '.ddddrrr.......',
      '.ddddr.........',
      '.ddk...........',
      '...k...........',
    ] },
    bowl: { w: 12, h: 7, pal: {'m': '#3f3a4a', 'R': '#5a5468', 'i': '#2a2634', 's': '#6e687e'}, rows: [
      '............',
      '.RRRRRRRRRR.',
      '..mssmmmmm..',
      '..smmmmmmm..',
      '..mmmmmmmm..',
      '...mmmmmm...',
      '....iiii....',
    ] },
    flame: { w: 10, h: 13, pal: {'o': '#f2903c', 'y': '#ffd76e', 'w': '#fff3c0', 'r': '#e06a2e'}, rows: [
      '.....oo...',
      '.....oo...',
      '...oooo...',
      '...oooo...',
      '..oyyyyo..',
      '..oyyyyo..',
      '..oyyyyo..',
      '.ooywwyoo.',
      '.roywwyor.',
      '.roywwyor.',
      '.royywyor.',
      '..oyyyyo..',
      '..roooor..',
    ] }
  };
  // 道具通用拼装：pxArt 画进固定尺寸的绝对定位 span（位置由调用方 inline 给）
  function stageProp(name, cls, w, hpx, palOverride) {
    var a = STAGE_ART[name];
    if (!a) return null;
    var el = h('span', 'ci-pet-bstage-prop' + (cls ? ' ' + cls : ''));
    el.style.width = w + 'px';
    el.style.height = hpx + 'px';
    el.innerHTML = pxArt(a.w, a.h, a.rows, palOverride || a.pal);
    return el;
  }

  // ==================== 舞台道具编排（v0.30.0） ====================
  // 三排纵深：远排贴山脚（最小）、中排草坡、近排放大——越近越大才有「场地」感。
  // 避让表：我方立绘在左 22%（近排让开左下），我方血牌在右下角（近排不让 x>70%），
  // 对手盘浮在右上（只避天体/云的位置）。昼夜显隐不在这里判断——白天/夜晚两套
  // 都画上，交给 CSS 的 .is-day 门（切换昼夜时舞台即时换装，不用重打一场）。
  function decorateStage(scene) {
    if (!scene) return;
    // ---- 天体：太阳（白天）/ 月亮（夜），挂在各自光晕的中心 ----
    var sun = pixIcon('sun', 'ci-pet-bstage-sun-pix');
    if (sun) {
      var sunBox = h('span', 'ci-pet-bstage-sun');
      sunBox.appendChild(sun);
      scene.appendChild(sunBox);
    }
    var moon = pixIcon('moon', 'ci-pet-bstage-moon-pix');
    if (moon) {
      var moonBox = h('span', 'ci-pet-bstage-moon');
      moonBox.appendChild(moon);
      scene.appendChild(moonBox);
    }
    // ---- 流云（白天专属）：三朵不同高度/速度横飘，animation-delay 负值让开场就在半路 ----
    var clouds = [
      ['cloud', 100, 39, 'is-d1'],
      ['cloud2', 58, 29, 'is-d2'],
      ['cloud2', 74, 37, 'is-d3']
    ];
    for (var i = 0; i < clouds.length; i++) {
      var cl = stageProp(clouds[i][0], 'ci-pet-bstage-cloud ' + clouds[i][3], clouds[i][1], clouds[i][2]);
      if (cl) scene.appendChild(cl);
    }
    // ---- 萤火虫（夜）：7 只，各自的漂移节奏由 inline delay/duration 错开 ----
    var flies = [
      ['8%', '44%', 0, 4.2], ['22%', '56%', 1.3, 3.6], ['40%', '38%', 2.1, 4.8],
      ['55%', '58%', 0.6, 3.9], ['70%', '42%', 1.8, 4.4], ['84%', '54%', 2.7, 3.4],
      ['93%', '36%', 0.9, 4.6]
    ];
    for (var f = 0; f < flies.length; f++) {
      var fly = h('span', 'ci-pet-bstage-fly');
      fly.style.left = flies[f][0];
      fly.style.bottom = flies[f][1];
      fly.style.animationDelay = flies[f][2] + 's';
      fly.style.animationDuration = flies[f][3] + 's';
      scene.appendChild(fly);
    }
    // ---- 旗杆 ×2：白天挂彩旗，夜里换火盆 + 抖动的火苗（CSS 门） ----
    var poleX = ['4.5%', '92.5%'];
    for (var p = 0; p < 2; p++) {
      var poleBox = h('span', 'ci-pet-bstage-pole' + (p ? ' is-r' : ''));
      poleBox.style.left = poleX[p];
      var pole = stageProp('pole', 'ci-pet-bstage-polepix', 22, 150);
      if (pole) poleBox.appendChild(pole);
      var flag = stageProp('flag', 'ci-pet-bstage-flag', 46, 34);
      if (flag) poleBox.appendChild(flag);
      var bowl = stageProp('bowl', 'ci-pet-bstage-bowl', 32, 19);
      if (bowl) poleBox.appendChild(bowl);
      var flame = stageProp('flame', 'ci-pet-bstage-flame', 26, 34);
      if (flame) poleBox.appendChild(flame);
      poleBox.appendChild(h('span', 'ci-pet-bstage-flameglow'));
      scene.appendChild(poleBox);
    }
    // ---- 草地道具：[美术名, left%, bottom%, 宽px, 高px, 配色覆盖?] ----
    // 远排（贴山脚，最小）
    var farRow = [
      ['grassA', 6, 47, 18, 14], ['grassB', 30, 48, 20, 15],
      ['flower', 46, 47, 14, 18, 'white'], ['grassA', 60, 48, 18, 14],
      ['pebble', 74, 47, 16, 9], ['grassB', 88, 47, 20, 15]
    ];
    // 中排（草坡中部，避开我方立绘 x 12-32%）
    var midRow = [
      ['grassA', 40, 29, 26, 21], ['flower', 54, 26, 18, 22],
      ['grassB', 72, 29, 26, 20], ['pebble', 88, 27, 20, 11],
      ['flower', 6, 27, 16, 20, 'pink']
    ];
    // 近排（最大、最抢眼；避开我方血牌 x>70%）
    var nearRow = [
      ['grassB', 8, 5, 32, 24], ['flower', 19, 9, 22, 28, 'pink'],
      ['grassB', 41, 4, 34, 26], ['pebble', 50, 3, 22, 12],
      ['flower', 57, 8, 22, 28, 'white'], ['grassA', 65, 5, 30, 24]
    ];
    function layRow(row, zcls) {
      for (var r = 0; r < row.length; r++) {
        var it = row[r];
        var pal = null;
        if (it[5] === 'white') pal = { 'p': '#f7f0dc', 'q': '#ffffff', 'y': '#e8a83c', 's': '#4e7c46', 'l': '#6f9e4a' };
        var el2 = stageProp(it[0], zcls, it[3], it[4], pal);
        if (!el2) continue;
        el2.style.left = it[1] + '%';
        el2.style.bottom = it[2] + '%';
        scene.appendChild(el2);
      }
    }
    layRow(farRow, 'is-far');
    layRow(midRow, 'is-mid');
    layRow(nearRow, 'is-near');
  }

  // ==================== 舞台粒子发生器（v0.30.0） ====================
  // kind: dust（土黄尘土向两侧溅）/ heal（绿色疗愈粒子上升）/ burst（金色爆星）。
  // 挂在承受方的站位盒里（box 内 absolute，left 50%），播放完整体移除。
  var FX_N = 5;
  function spawnStageFx(box, kind) {
    if (!box) return;
    var fx = h('span', 'ci-pet-bstage-fx is-' + kind);
    for (var i = 0; i < FX_N; i++) {
      fx.appendChild(h('span', 'p p' + (i + 1)));
    }
    if (kind === 'burst') fx.appendChild(h('span', 'ring'));
    box.appendChild(fx);
    setTimeout(function() {
      if (fx.parentNode) fx.parentNode.removeChild(fx);
    }, kind === 'burst' ? 560 : 760);
  }

  // 取图标：拿不到就返回 null，调用方自行回退（绝不抛错，图标缺一个不该白屏）
  function pixIcon(name, cls) {
    var ic = PIX_ICONS[name];
    if (!ic) return null;
    var box = h('span', 'ci-pixico' + (cls ? ' ' + cls : ''));
    box.innerHTML = pxArt(12, 12, ic.rows, ic.pal);
    return box;
  }
  // 图标 + 文本的通用拼装：先清空再挂，供 fillHud 反复刷新时复用
  function setIconText(el, iconName, text) {
    if (!el) return;
    while (el.firstChild) el.removeChild(el.firstChild);
    var ic = pixIcon(iconName);
    if (ic) el.appendChild(ic);
    el.appendChild(document.createTextNode(text == null ? '' : String(text)));
  }

  // 互动图标：一套 24px 线性图标，统一 1.7 描边、圆角端点。
  // 换成 SVG 的理由见 bigBtn 上面的注释 —— emoji 的配色不受控，四个按钮四种色。
  var ICONS = {
    // 碗 + 热气：喂食。碗沿一条直线就能读出来，比画一条鱼稳。
    feed:
      '<path d="M3.5 12.5h17a8.5 8.5 0 0 1-17 0z"/>' +
      '<path d="M8 9.2c0-1 .9-1.4.9-2.4"/>' +
      '<path d="M12 9.2c0-1 .9-1.4.9-2.4"/>' +
      '<path d="M16 9.2c0-1 .9-1.4.9-2.4"/>',
    // 手：摸摸
    poke:
      '<path d="M18 11V6a2 2 0 0 0-4 0"/>' +
      '<path d="M14 10V4a2 2 0 0 0-4 0v2"/>' +
      '<path d="M10 10.5V6a2 2 0 0 0-4 0v8"/>' +
      '<path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.9-6-2.3l-3.6-3.6a2 2 0 0 1 2.8-2.8L7 15"/>',
    // 喇叭 + 两道声波：呼唤
    call:
      '<path d="M3 10v4a1 1 0 0 0 1 1h2.5L11 19V5L6.5 9H4a1 1 0 0 0-1 1z"/>' +
      '<path d="M15.5 8.5a4.5 4.5 0 0 1 0 7"/>' +
      '<path d="M18.5 6a8.5 8.5 0 0 1 0 12"/>',
    // 沙漏：专注
    focus:
      '<path d="M7 3.5h10"/>' +
      '<path d="M7 20.5h10"/>' +
      '<path d="M7.5 3.5c0 4 4.5 5.6 4.5 8.5s-4.5 4.5-4.5 8.5"/>' +
      '<path d="M16.5 3.5c0 4-4.5 5.6-4.5 8.5s4.5 4.5 4.5 8.5"/>',
    // 底部 dock：四个页面图标。⚠️ 它们原来是 emoji（🏠⚔️📖🏆），
    // 那等于「四台设备的四套配色」——emoji 在深色 dock 上永远是杂色的。
    home:
      '<path d="M4 10.6 12 4l8 6.6V20a1 1 0 0 1-1 1h-4.5v-5.5h-5V21H5a1 1 0 0 1-1-1z"/>',
    battle:
      '<path d="M5 4.5h3l9.5 12.5"/>' +
      '<path d="M16 4.5h3v3"/>' +
      '<path d="M19 4.5 6.5 17"/>' +
      '<path d="M4 19.5l2.5-2.5"/>',
    dex:
      '<path d="M5 4.5A1.5 1.5 0 0 1 6.5 3H19v15H6.5A1.5 1.5 0 0 0 5 19.5z"/>' +
      '<path d="M5 19.5V4.5"/>' +
      '<path d="M9 7.5h6"/>',
    rank:
      '<path d="M8 3.5h8v4.5a4 4 0 0 1-8 0z"/>' +
      '<path d="M8 4.5H5v2a3 3 0 0 0 3 3"/>' +
      '<path d="M16 4.5h3v2a3 3 0 0 1-3 3"/>' +
      '<path d="M12 12v5"/>' +
      '<path d="M8.5 20.5h7"/>' +
      '<path d="M10 20.5v-3h4v3"/>'
  };
  function elementOf(id) {
    for (var i = 0; i < elements.length; i++) if (elements[i].id === id) return elements[i];
    return ELEMENT_FALLBACK[id] || ELEMENT_FALLBACK.grass;
  }
  function elementChip(id, text) {
    var e = elementOf(id);
    // v0.25.0：图标改成像素图（原来是服务端下发的 emoji，配色不受控）
    var el = h('span', 'ci-pet-el ci-pet-el--' + e.id);
    var ic = pixIcon(e.id, 'ci-pet-el-ico');
    if (ic) el.appendChild(ic);
    el.appendChild(document.createTextNode(text || e.name));
    return el;
  }
  // 本地算属性倍率（不依赖服务端返回，勋章/难度标签都能立刻跟着换）
  // /pet/state 下发的附属数据统一收口：属性表、图鉴总量、随行、进化。
  // 写成一个函数是因为以后加字段只改这里，不用在 mount 里一行行补。
  function applyStateMeta(d) {
    if (!d) return;
    if (d.elements && d.elements.length) elements = d.elements;
    if (d.wild && d.wild.length) wildCatalog = d.wild;
    buddyInfo = d.buddy || null;
    evolutionInfo = d.evolution || null;
    // 天气 / 任务和存档一起下发：首页不用等战斗档案就能画出天气条与任务卡。
    if (d.weather) weatherInfo = d.weather;
    if (d.quests) questInfo = d.quests;
    // v0.15.0：每日登录奖励。它不属于「存档字段」，是按 last_login_date 现算的，
    // 所以随 /state 下发，前端只读。
    if (d.dailyBonus !== undefined) dailyBonusInfo = d.dailyBonus;
    // v0.16.0：离线时光 recap。每次 /state 下发，前端只读。
    if (d.offlineRecap !== undefined) offlineRecapInfo = d.offlineRecap;
    // v0.16.0：每日奇遇。按日期 + uid 定种子，同一天永远是同一件事。
    if (d.wonder !== undefined) wonderInfo = d.wonder;
    // v0.17.0：自主行为。宠物在你不在的时候也在动。
    if (d.autonomy !== undefined) autonomyInfo = d.autonomy;
    // v0.11.0：日记与专注额度同批下发（服务端生成，前端只读）
    if (d.diary !== undefined) diaryInfo = d.diary;
    if (d.focus) focusInfo = d.focus;
    // v0.15.0：性格与心情。两者都由服务端算 —— 心情依赖时段与今日次数，
    // 前端各算一份迟早会对不上（平板时间被改过时尤其明显）。
    if (d.personality !== undefined) personalityInfo = d.personality;
    if (d.mood !== undefined) moodInfo = d.mood;
    // v0.25.0：小卖部货架与助战位，都是服务端算好下发的只读视图。
    if (d.shop !== undefined) shopInfo = d.shop;
    if (d.assistant !== undefined && battle) battle.assistant = d.assistant;
    // v0.37.0：情感陪伴摘要。首页气泡与心意面板都读它；完整数据由 /pet/heart 补。
    if (d.heart !== undefined) heartInfo = d.heart;
    if (d.memoriesNew && d.memoriesNew.length) heartMemoryToast(d.memoriesNew);
  }

  // 对战 / 爬塔 / 野怪三种响应都带 weather + quests：打完一场顺手更新，
  // 回到首页时任务进度与天气就已经是新的，不用再等一次 /battle/profile。
  function absorbProgress(d) {
    if (!d) return;
    if (d.weather) weatherInfo = d.weather;
    if (d.quests) questInfo = d.quests;
  }

  // ---- 编辑器状态 ----
  // edit 里带 w/h：16/24/32 三档画板共用同一套绘制逻辑，data 长度恒为 w*h。
  var edit = null;       // { w, h, data, color, tool, mirrorX, mirrorY, bead, painting, ... }
  var undoStack = [];
  var redoStack = [];
  var editCanvas = null;
  var editPreviewEl = null;      // 右侧实时预览
  var editStatsLineEl = null;    // 「总计 N 颗 · M 色」
  var editStatsWrapEl = null;    // 色号 chips
  var editColorLabelEl = null;   // 「当前 A5 · 樱花粉」
  var editGalleryEl = null;      // 作品库列表
  var editGalleryHeadEl = null;  // 「作品库 · n / 24」
  var editNameInput = null;
  var editPosEl = null;          // 画板下方的光标坐标「列 x · 行 y」
  var editDesigns = [];          // 服务端作品库
  var editDesignsLoaded = false;
  var editDesignsError = false;
  var draftTimer = null;
  var DRAFT_KEY = 'pixelDraft';
  // 「上次是在编辑器里被中断的」标记：只在进入编辑器时写、在明确离开时清。
  // 用途：宿主重挂 / 刷新 / 切后台被回收后，回来直接续上那张草稿，
  //       而不是把用户丢回宠物屋（用户反馈「拼一半自动跳出去」的另一半保险）。
  var EDIT_SESSION_KEY = 'editSession';
  var MAX_DESIGNS = 24;          // 与后端 routes.js 的 MAX_DESIGNS 保持一致

  // ---- 像素渲染（dpr 真实像素绘制：任何屏幕都锐利，不依赖 image-rendering）----
  // cellPx：每个豆子的 CSS 尺寸；canvas 物理分辨率 = cellPx × dpr
  function paint(canvasEl, design, cellPx) {
    if (!canvasEl || !design || !cellPx) return;
    var dpr = window.devicePixelRatio || 1;
    var cssW = design.w * cellPx;
    var cssH = design.h * cellPx;
    canvasEl.width = Math.round(cssW * dpr);
    canvasEl.height = Math.round(cssH * dpr);
    canvasEl.style.width = cssW + 'px';
    canvasEl.style.height = cssH + 'px';
    var g = canvasEl.getContext('2d');
    g.clearRect(0, 0, canvasEl.width, canvasEl.height);
    var cell = cellPx * dpr;
    // 像素边界取整：非整数缩放下（比如 64 格画到 176px = 2.75px/格）
    // 直接用 fillRect(x*cell, cell+0.5) 会出现「有的格 2px、有的格 3px，还叠边」；
    // 先取整边界再填充，每格宽度最多差 1px，但没有缝隙也不会互相压边。
    var xs = [], ys = [];
    for (var xi = 0; xi <= design.w; xi++) xs.push(Math.round(xi * cell));
    for (var yi = 0; yi <= design.h; yi++) ys.push(Math.round(yi * cell));
    for (var y = 0; y < design.h; y++) {
      for (var x = 0; x < design.w; x++) {
        var ch = design.data.charAt(y * design.w + x);
        if (ch === '.') continue;
        var c = palette[parseInt(ch, 16)];
        if (!c) continue;
        g.fillStyle = c;
        var w = xs[x + 1] - xs[x], hh = ys[y + 1] - ys[y];
        if (w <= 0 || hh <= 0) continue;
        g.fillRect(xs[x], ys[y], w, hh);
      }
    }
  }

  // ---- 拼豆质感渲染（v0.35.0）----
  // 实体拼豆是「带中心孔的圆柱」，一颗颗排进底板后会有空隙和高低光。
  // 这里做两件事：
  //   1. 每颗豆子按「颜色 + 格宽」只光栅化一次成小精灵图，之后每格 drawImage ——
  //      32×32 画板拖拽时每帧最多 1024 次 drawImage，不会像纯矢量那样卡手；
  //   2. 底板（米色板 + 插钉 + 网格线）也缓存成一张底图，避免每帧重画上千个钉点。
  // 缓存都是按 key 懒生成的，尺寸切换时旧图自然不再命中，不会无限增长。
  var beadSpriteCache = {};
  var beadSpriteKeys = [];   // 只保留最近 10 组（格宽/dpr/质感组合），防止切尺寸时缓存无限长
  var boardLayerCache = {};
  var boardLayerKeys = [];

  function beadCode(idx) { return 'A' + (idx + 1); }
  function beadName(idx) { return BEAD_NAMES[idx] || ('色' + (idx + 1)); }

  function beadSprite(idx, cellPx, dpr, bg, texture) {
    var key = cellPx + '|' + dpr + '|' + bg + '|' + (texture ? 1 : 0);
    var set = beadSpriteCache[key];
    if (!set) {
      set = beadSpriteCache[key] = {};
      beadSpriteKeys.push(key);
      if (beadSpriteKeys.length > 10) delete beadSpriteCache[beadSpriteKeys.shift()];
    }
    if (set[idx]) return set[idx];
    var size = Math.max(4, Math.round(cellPx * dpr));
    var c = document.createElement('canvas');
    c.width = size; c.height = size;
    var g = c.getContext('2d');
    var color = palette[idx] || '#888888';
    if (!texture) {
      g.fillStyle = color;
      g.fillRect(0, 0, size, size);
      set[idx] = c;
      return c;
    }
    var cx = size / 2;
    var cy = size / 2;
    var r = size * 0.47;
    // 小格宽（48/64 档，或缩放 100%）时实体豆的「中心孔 + 底部压暗」只有 1~2px，
    // 放大后就是一片脏点。这里换扁平豆：纯色圆 + 一道高光，远看更干净。
    var simple = size < 16;
    // 豆身
    g.fillStyle = color;
    g.beginPath();
    g.arc(cx, cy, r, 0, Math.PI * 2);
    g.fill();
    if (simple) {
      g.strokeStyle = 'rgba(255,255,255,0.30)';
      g.lineWidth = Math.max(1, size * 0.10);
      g.beginPath();
      g.arc(cx, cy, r * 0.72, Math.PI * 1.10, Math.PI * 1.55);
      g.stroke();
      set[idx] = c;
      return c;
    }
    // 顶部高光（左上斜向的一道弧）
    g.strokeStyle = 'rgba(255,255,255,0.34)';
    g.lineWidth = Math.max(1, size * 0.13);
    g.beginPath();
    g.arc(cx, cy, r * 0.76, Math.PI * 1.08, Math.PI * 1.62);
    g.stroke();
    // 底部压暗
    g.strokeStyle = 'rgba(0,0,0,0.18)';
    g.lineWidth = Math.max(1, size * 0.1);
    g.beginPath();
    g.arc(cx, cy, r * 0.88, Math.PI * 0.16, Math.PI * 0.72);
    g.stroke();
    // 中心豆孔（露出底板色，才是拼豆的样子）
    var hole = Math.max(1.5, size * 0.17);
    g.fillStyle = bg;
    g.beginPath();
    g.arc(cx, cy, hole, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = 'rgba(0,0,0,0.2)';
    g.lineWidth = Math.max(1, size * 0.06);
    g.beginPath();
    g.arc(cx, cy, hole, 0, Math.PI * 2);
    g.stroke();
    set[idx] = c;
    return c;
  }

  function boardLayer(w, h, cell, dpr, bg, opts) {
    var key = w + '|' + h + '|' + Math.round(cell) + '|' + dpr + '|' + bg + '|' + (opts.pegs ? 1 : 0) + '|' + (opts.grid ? 1 : 0);
    if (boardLayerCache[key]) return boardLayerCache[key];
    var c = document.createElement('canvas');
    c.width = Math.round(w * cell);
    c.height = Math.round(h * cell);
    var g = c.getContext('2d');
    g.fillStyle = bg;
    g.fillRect(0, 0, c.width, c.height);
    // 小格宽时（64 档 ≈9px/格）插钉与网格会挤成一片灰噪点：
    // 按格宽分三档收敛 —— 大格保留实体底板质感，小格退成一张淡网格纸。
    var dense = cell < 12 * dpr;
    var mid = cell < 22 * dpr;
    // 空豆位的小插钉，让底板看起来是真实拼豆板
    if (opts.pegs && !dense) {
      var pr = Math.max(1, cell * (mid ? 0.075 : 0.1));
      g.fillStyle = mid ? 'rgba(150,120,64,0.13)' : 'rgba(150,120,64,0.22)';
      for (var py = 0; py < h; py++) {
        for (var px = 0; px < w; px++) {
          g.beginPath();
          g.arc(px * cell + cell / 2, py * cell + cell / 2, pr, 0, Math.PI * 2);
          g.fill();
        }
      }
    }
    // 网格线画在豆子下层：豆子会把线盖住，空位则能看清格子
    if (opts.grid) {
      g.strokeStyle = dense ? 'rgba(120,96,52,0.10)' : (mid ? 'rgba(120,96,52,0.16)' : 'rgba(120,96,52,0.22)');
      g.lineWidth = Math.max(1, dpr * 0.6);
      for (var i = 1; i < w; i++) {
        g.beginPath();
        g.moveTo(i * cell, 0);
        g.lineTo(i * cell, c.height);
        g.stroke();
      }
      for (var j = 1; j < h; j++) {
        g.beginPath();
        g.moveTo(0, j * cell);
        g.lineTo(c.width, j * cell);
        g.stroke();
      }
      // 中线加重点，方便数格子；太密就不画了（64 格时它是噪音）
      if (!dense) {
        g.strokeStyle = mid ? 'rgba(10,132,255,0.20)' : 'rgba(10,132,255,0.28)';
        g.lineWidth = Math.max(1, dpr);
        g.beginPath(); g.moveTo(w * cell / 2, 0); g.lineTo(w * cell / 2, c.height); g.stroke();
        g.beginPath(); g.moveTo(0, h * cell / 2); g.lineTo(c.width, h * cell / 2); g.stroke();
      }
    }
    boardLayerCache[key] = c;
    boardLayerKeys.push(key);
    // v0.38.0：画板放大后单张底板最坏 2048²（16MB），缓存只留 3 张。
    // 低端平板（Android 9 / Chrome 80）内存一紧就是整页白屏，宁可多画一次底板。
    if (boardLayerKeys.length > 3) {
      var old = boardLayerKeys.shift();
      delete boardLayerCache[old];
    }
    return c;
  }

  // 统一画板：清空 → 底板 → 逐颗豆子。cellPx 是 CSS 像素格宽。
  // opts: { bg, pegs, grid, bead }
  function drawBoard(canvasEl, design, cellPx, opts) {
    if (!canvasEl || !design || !design.data || !cellPx) return;
    opts = opts || {};
    var bg = opts.bg || '#FBF6E8';
    var w = design.w || DIM;
    var h = design.h || DIM;
    var dpr = window.devicePixelRatio || 1;
    var cell = cellPx * dpr;
    canvasEl.width = Math.round(w * cell);
    canvasEl.height = Math.round(h * cell);
    canvasEl.style.width = (w * cellPx) + 'px';
    canvasEl.style.height = (h * cellPx) + 'px';
    var g = canvasEl.getContext('2d');
    g.clearRect(0, 0, canvasEl.width, canvasEl.height);
    g.drawImage(boardLayer(w, h, cell, dpr, bg, opts), 0, 0);
    var texture = opts.bead !== false && cellPx >= 7;
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var ch = design.data.charAt(y * w + x);
        if (ch === '.') continue;
        var idx = parseInt(ch, 16);
        if (!(idx >= 0 && idx < 16)) continue;
        // 多画 0.5px 让相邻豆子接边，避免缩放时出现发丝缝
        g.drawImage(beadSprite(idx, cellPx, dpr, bg, texture), x * cell, y * cell, cell + 0.5, cell + 0.5);
      }
    }
  }

  // 统计每个色号用了多少颗（做实体拼豆时要照着这个数字备料）
  function beadStats(data) {
    var counts = [];
    var i;
    for (i = 0; i < 16; i++) counts.push(0);
    var total = 0;
    for (i = 0; i < data.length; i++) {
      var ch = data.charAt(i);
      if (ch === '.') continue;
      var idx = parseInt(ch, 16);
      if (idx >= 0 && idx < 16) { counts[idx]++; total++; }
    }
    var used = [];
    for (i = 0; i < 16; i++) {
      if (counts[i]) used.push({ idx: i, count: counts[i] });
    }
    used.sort(function(a, b) { return b.count - a.count; });
    return { total: total, used: used, counts: counts };
  }

  function blankGrid(w, h) {
    var s = '';
    for (var i = 0; i < w * h; i++) s += '.';
    return s;
  }

  // 换画板尺寸时用最近邻重采样：16→32 会放大成 2×2 豆块，32→16 会按比例抽点，
  // 图案轮廓不会像「清空重来」那样丢。
  function resampleGrid(oldW, oldH, data, w, h) {
    var out = [];
    for (var y = 0; y < h; y++) {
      var sy = Math.min(oldH - 1, Math.floor(y * oldH / h));
      for (var x = 0; x < w; x++) {
        var sx = Math.min(oldW - 1, Math.floor(x * oldW / w));
        out.push(data.charAt(sy * oldW + sx));
      }
    }
    return out.join('');
  }

  // ---- 基础 DOM ----
  function h(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  function clearRoot() {
    editorOpen = false;   // 任何页面重建都会清掉「编辑器打开」状态
    // 气泡轮播的定时器必须在清空 DOM 之前停掉：
    // 它每 9 秒去 root 里找 .ci-pet-hero-mood，节点没了会自己退出，
    // 但那要等 9 秒 —— 期间切页的话，定时器还活着，而且它的闭包里握着旧节点。
    stopBubble();
    while (root && root.firstChild) root.removeChild(root.firstChild);
  }

  // ================= 卡片文字色自适应（v0.11.0）=================
  // 背景：主题变量不一定"成对"。当前这套主题就是
  //   --ci-color-bg-card     = #F8F2E4（米白）
  //   --ci-color-text-primary = rgba(235,235,245,.95)（纯白，深色档的值）
  // 于是卡片里所有 title/正文都变成白字压米白 —— 截图看着像"文字重影"，
  // 实际是对比度接近 0（放大 3 倍才能看出只有一行字，只不过快看不见了）。
  //
  // 修法：不在 95 处 color 上逐个改，而是给卡片容器重绑那三个文字变量；
  // 再按卡片底色的亮度切深/亮两套值，这样纯深色主题下也不会反过来瞎掉。
  function parseLum(str) {
    var s = String(str || '').trim();
    var r, g, b;
    var m6 = /^#([0-9a-f]{6})$/i.exec(s);
    var m3 = /^#([0-9a-f]{3})$/i.exec(s);
    var mr = /rgba?\(([^)]+)\)/i.exec(s);
    if (m6) {
      r = parseInt(m6[1].slice(0, 2), 16); g = parseInt(m6[1].slice(2, 4), 16); b = parseInt(m6[1].slice(4, 6), 16);
    } else if (m3) {
      r = parseInt(m3[1][0] + m3[1][0], 16); g = parseInt(m3[1][1] + m3[1][1], 16); b = parseInt(m3[1][2] + m3[1][2], 16);
    } else if (mr) {
      var p = mr[1].split(',');
      r = parseFloat(p[0]); g = parseFloat(p[1]); b = parseFloat(p[2]);
    }
    if (r === undefined || isNaN(r) || isNaN(g) || isNaN(b)) return null;
    return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  }
  // ---------- 昼夜模式（v0.27.0）----------
  // 小屋有白天和黑夜：auto 跟随真实时间（6:30–18:30 白天），也可手动切。
  // 状态走 localStorage（偏光是设备级的视觉偏好，不用进服务器档案）。
  // 三处消费：① root.is-day class（CSS 全量换装，token 自动联动 markCardTone）
  //           ② 窗户取图（windowDay / window，见 sceneHomeBody）
  //           ③ stageHud 的切换钮图标（sun / moon）。
  var DAY_KEY = 'ci-pet-daynight';
  var dayNight = { mode: 'auto', last: null, timer: null };
  function dayNightLoad() {
    try {
      var m = localStorage.getItem(DAY_KEY);
      if (m === 'day' || m === 'night' || m === 'auto') dayNight.mode = m;
    } catch (e) {}
  }
  function isDayNow() {
    if (dayNight.mode === 'day') return true;
    if (dayNight.mode === 'night') return false;
    var now = new Date();
    var hh = now.getHours() + now.getMinutes() / 60;
    return hh >= 6.5 && hh < 18.5;
  }
  function applyDayNight(redraw) {
    var day = isDayNow();
    if (root && root.classList) root.classList.toggle('is-day', day);
    var key = dayNight.mode + ':' + (day ? 'day' : 'night');
    if (key === dayNight.last) return;
    dayNight.last = key;
    fillDayToggle();
    // 窗户是 JS 决定的美术，换景要重绘；auto 跨界时别打断正在进行的散步。
    // ⚠️ 编辑器里绝不能重绘：它挂在 home 这个 tab 上，18:30/6:30 自动换景会把
    //    正在拼豆的人直接弹回宠物屋（实测）。主题 class 已经换了，编辑器自己会跟着换色。
    var inEditor = !!(root && root.classList && root.classList.contains('is-editor'));
    if (redraw && uiTab === 'home' && !inEditor) renderHomeWhenIdle();
  }
  function fillDayToggle() {
    if (!root) return;
    var btn = root.querySelector('[data-hud="daynight"]');
    if (!btn) return;
    var day = isDayNow();
    setIconText(btn, day ? 'sun' : 'moon', dayNight.mode === 'auto' ? '自动' : (day ? '白天' : '夜晚'));
    btn.setAttribute('data-mode', dayNight.mode);
  }
  function cycleDayNight() {
    dayNight.mode = dayNight.mode === 'auto' ? 'day' : (dayNight.mode === 'day' ? 'night' : 'auto');
    try { localStorage.setItem(DAY_KEY, dayNight.mode); } catch (e) {}
    dayNight.last = null;
    applyDayNight(true);
    sysToast(dayNight.mode === 'auto'
      ? '自动模式：6:30–18:30 是白天，其余是夜晚'
      : (isDayNow() ? '白天模式：阳光洒进小屋' : '夜晚模式：点亮台灯'), 'info');
  }

  function markCardTone() {
    if (!root) return;
    var raw = '';
    try { raw = getComputedStyle(root).getPropertyValue('--ci-color-bg-card'); } catch (e) {}
    var lum = parseLum(raw);
    // 解析不出来就按浅底处理：桌宠的卡片默认是浅色的，这是安全的默认
    root.classList.toggle('ci-pet-darkcard', lum !== null && lum < 0.45);
  }

  // 骨架屏：第一帧数据还没回来时，先用灰条撑出 HUD 和卡片的形状。
  // 比一行「加载中…」稳当 —— 数据到位时是「形状不变、内容填入」，
  // 而不是一条细字突然换成一整页卡片，闪一下再跳版。
  function skeletonCard(lines, tall) {
    var box = h('div', 'ci-pet-skel-card' + (tall ? ' is-tall' : ''));
    for (var i = 0; i < lines; i++) {
      box.appendChild(h('span', 'ci-pet-skel-line' + (i === 0 ? ' is-title' : '')));
    }
    return box;
  }
  function renderSkeleton() {
    root.appendChild(h('div', 'ci-pet-skel-hud'));
    root.appendChild(skeletonCard(2, true));
    root.appendChild(skeletonCard(3));
    root.appendChild(skeletonCard(2));
  }

  // 统一 toast 出口：宿主没给 system.toast 时静默降级，不抛异常
  function sysToast(message, type) {
    try {
      if (context && context.system && context.system.toast) {
        context.system.toast({ message: message, type: type || 'info' });
      }
    } catch (e) {}
  }

  // 交互结果回报：悬浮层发完请求后派发 'ci-pet-fed'（带 type/gained/capped/tierUp/state）。
  // 收到就置位，避免本页的「无回报兜底」重复发第二次请求。
  // ⚠️ 2026-10-27 修：原来不分 type，摸摸撞到每日上限时也弹「今天已经吃饱啦」——
  //    用户摸一下看到的却是喂饭的话术，直接懵。现在按 type 说各自的话。
  var pendingReply = { feed: false, poke: false };
  var POKE_DAILY_CAP = 10;   // 与 backend/routes.js INTERACT_RULES.poke.dailyCap 对齐
  var FEED_GAIN = 4;         // 与 INTERACT_RULES.feed.gain 对齐
  var BOND_DAILY_MAX = 25;   // poke10 + feed3×4 + visit3 = +25/天

  function pokedCount() { return (state && state.poked_today) || 0; }
  function canPoke() { return pokedCount() < POKE_DAILY_CAP; }

  function interactVerb(type) {
    if (type === 'feed') return '喂食';
    if (type === 'poke') return '摸摸';
    if (type === 'visit') return '回到桌上';
    if (type === 'gift') return '送礼物';
    return '互动';
  }
  function capMessage(type) {
    if (type === 'feed') return '今天已经吃饱啦，明天再来～';
    if (type === 'poke') return '今天摸够 ' + POKE_DAILY_CAP + ' 次啦，明天再来～';
    if (type === 'visit') return '今天已经回来过啦～';
    return '今天的互动次数用完啦，明天再来～';
  }

  try {
    window.addEventListener('ci-pet-fed', function(e) {
      var d = (e && e.detail) || {};
      if (d.type) pendingReply[d.type] = true;
      else { pendingReply.feed = true; pendingReply.poke = true; }
      if (d.state) state = d.state;
      if (d.quests) questInfo = d.quests;
      // v0.15.0：性格与心情在每次互动后都可能变（心情尤其），
      // 不在这里接住的话，气泡会一整天停在进页面时那一句。
      if (d.mood) moodInfo = d.mood;
      if (d.personality) personalityInfo = d.personality;
      if (d.gained > 0) {
        var bondNow = (state && state.bond) || 0;
        sysToast(interactVerb(d.type) + '成功，羁绊 +' + d.gained + '（现在 ' + bondNow + '）', 'success');
        if (window.__ciPetSfx) window.__ciPetSfx.play(d.crit ? 'crit' : (d.type === 'feed' ? 'feed' : 'poke'));
      } else if (d.capped) {
        sysToast(capMessage(d.type), 'info');
      } else if (d.message) {
        sysToast(d.message, 'info');
      }
      renderHome();
      // 飘字必须在 renderHome 之后 —— 它会挂在重建后的 .ci-pet-hero 上，
      // 先加再渲染等于刚加上就被 clearRoot 清掉。
      if (d.gained > 0) flashGain(d.gained, d.crit);
    });
  } catch (e) {}

  // 领养/编辑器/起名都不是首页，进去先摘掉横屏双栏用的 is-hometab。
  // 否则首页那套 flex 行会把编辑器撑成 max-content 宽度，工具列被顶出视口。
  function leaveHomeLayout() {
    if (root && root.classList) root.classList.remove('is-hometab');
  }

  // ================= 首屏：未领养 =================
  function renderAdopt() {
    clearRoot();
    leaveHomeLayout();
    root.appendChild(h('h2', null, '领养一只小家伙'));
    root.appendChild(h('p', 'ci-pethome-sub',
      '推荐直接领养大肥鱼（会跳舞、吃火锅、玩魔方的像素鲸鱼）；手作党可以从模板或空白画布开始拼。'));
    var grid = h('div', 'ci-pet-templates');
    // 默认形象：大肥鱼（dsh-pet，CC BY-NC-SA，视频形态）
    var whale = h('div', 'ci-pet-tpl ci-pet-tpl--whale');
    whale.appendChild(h('div', 'ci-pet-tpl-emoji', '🐳'));
    whale.appendChild(h('div', 'ci-pet-tpl-name', '大肥鱼'));
    whale.appendChild(h('div', 'ci-pet-tpl-desc', '100 多种动作：吃火锅、玩魔方、拆礼物…推荐！'));
    whale.addEventListener('click', function() { renderNaming('video'); });
    grid.appendChild(whale);
    // 续作卡：上次没拼完的草稿还在本地，一键接上（放在模板前面，别让人从头再拼）
    var draft = readDraft();
    if (draft) {
      var dc = h('div', 'ci-pet-tpl ci-pet-tpl--draft');
      var dv = document.createElement('canvas');
      paint(dv, { w: draft.w, h: draft.h, data: draft.data }, 72 / draft.w);
      dc.appendChild(dv);
      dc.appendChild(h('div', 'ci-pet-tpl-name', '继续上次'));
      dc.appendChild(h('div', 'ci-pet-tpl-desc', draft.w + '×' + draft.h + ' · 上次没拼完的稿子'));
      // 把草稿里记着的 workId 一起接上：续作后再保存仍然覆盖原来那件
      dc.addEventListener('click', function() {
        startEditor(draft.data, draft.w, draft.h, {
          workId: draft.workId, workName: draft.workName
        });
      });
      grid.appendChild(dc);
    }
    templates.forEach(function(t) {
      var card = h('div', 'ci-pet-tpl');
      var tw = t.w || DIM;
      var th = t.h || DIM;
      var cv = document.createElement('canvas');
      paint(cv, { w: tw, h: th, data: t.art.join('') }, 72 / tw);
      card.appendChild(cv);
      card.appendChild(h('div', 'ci-pet-tpl-name', t.name));
      card.appendChild(h('div', 'ci-pet-tpl-desc', t.desc));
      card.addEventListener('click', function() {
        startEditor(t.art.join(''), tw, th);
      });
      grid.appendChild(card);
    });
    // 空白开始
    var blank = h('div', 'ci-pet-tpl');
    var cvb = document.createElement('canvas');
    paint(cvb, { w: DIM, h: DIM, data: new Array(DIM * DIM + 1).join('.') }, 72 / DIM);
    blank.appendChild(cvb);
    blank.appendChild(h('div', 'ci-pet-tpl-name', '从空白开始'));
    blank.appendChild(h('div', 'ci-pet-tpl-desc', '一块干净的拼豆板'));
    blank.addEventListener('click', function() { startEditor('', 16, 16); });
    grid.appendChild(blank);
    root.appendChild(grid);
  }

  // ================= 编辑器 =================
  function setCell(idx, ch) {
    if (idx < 0 || idx >= edit.data.length) return;
    edit.data = edit.data.substring(0, idx) + ch + edit.data.substring(idx + 1);
  }

  // 落一格 + 镜像落点（左右 / 上下 / 双向四个点都算）
  // 单格写入 + 镜像。笔尖粗细在 applyAt 里按块铺开（每个格子各走一遍这里）。
  // ⚠️ 每个落点都必须标脏。v0.38.0 重写增量渲染时漏了标脏，
  //    结果数据变了、备料统计也变了，画布却一格都不重画 ——「点了画不显示」。
  function stampCell(col, row, ch) {
    var w = edit.w;
    var h = edit.h;
    if (col < 0 || row < 0 || col >= w || row >= h) return;
    setCell(row * w + col, ch);
    markCell(col, row);
    if (edit.mirrorX && (w - 1 - col) !== col) {
      setCell(row * w + (w - 1 - col), ch);
      markCell(w - 1 - col, row);
    }
    if (edit.mirrorY && (h - 1 - row) !== row) {
      setCell((h - 1 - row) * w + col, ch);
      markCell(col, h - 1 - row);
    }
    if (edit.mirrorX && edit.mirrorY) {
      var mcx = w - 1 - col, mcy = h - 1 - row;
      setCell(mcy * w + mcx, ch);
      markCell(mcx, mcy);
    }
  }

  // 笔尖：1×1 / 2×2 / 3×3（64 格单格只有 9px，粗笔尖是刚需）
  function applyAt(col, row, ch) {
    var bs = Math.max(1, Math.min(3, edit.brush || 1));
    if (bs === 1) { stampCell(col, row, ch); return; }
    var off = Math.floor((bs - 1) / 2);
    for (var dy = 0; dy < bs; dy++) {
      for (var dx = 0; dx < bs; dx++) {
        stampCell(col + dx - off, row + dy - off, ch);
      }
    }
  }

  // 指针快速划过时两次采样之间会跳格，用 Bresenham 补线，笔迹不断
  function strokeLine(x0, y0, x1, y1, ch) {
    var dx = Math.abs(x1 - x0);
    var dy = Math.abs(y1 - y0);
    var sx = x0 < x1 ? 1 : -1;
    var sy = y0 < y1 ? 1 : -1;
    var err = dx - dy;
    var e2;
    while (true) {
      applyAt(x0, y0, ch);
      if (x0 === x1 && y0 === y1) break;
      e2 = 2 * err;
      if (e2 > -dy) { err -= dy; x0 += sx; }
      if (e2 < dx) { err += dx; y0 += sy; }
    }
  }

  // 直线 / 矩形边框的点集（拖拽时先预览，抬手才真正落豆）
  function geomPoints(tool, x0, y0, x1, y1) {
    var pts = [];
    var x, y;
    if (tool === 'line') {
      var dx = Math.abs(x1 - x0);
      var dy = Math.abs(y1 - y0);
      var sx = x0 < x1 ? 1 : -1;
      var sy = y0 < y1 ? 1 : -1;
      var err = dx - dy;
      var e2;
      x = x0;
      y = y0;
      while (true) {
        pts.push([x, y]);
        if (x === x1 && y === y1) break;
        e2 = 2 * err;
        if (e2 > -dy) { err -= dy; x += sx; }
        if (e2 < dx) { err += dx; y += sy; }
      }
      return pts;
    }
    // 矩形只画边框；要填满用油漆桶更快
    for (x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) {
      pts.push([x, y0]);
      pts.push([x, y1]);
    }
    for (y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) {
      pts.push([x0, y]);
      pts.push([x1, y]);
    }
    return pts;
  }

  // 直线/矩形预览：只算点集，画在**预览层**上（不动数据、不重画底板）
  function previewGeom(tool, x0, y0, x1, y1, colorIdx) {
    var pts = geomPoints(tool, x0, y0, x1, y1);
    var bs = Math.max(1, Math.min(3, edit.brush || 1));
    var off = Math.floor((bs - 1) / 2);
    var out = [];
    var seen = {};
    for (var i = 0; i < pts.length; i++) {
      for (var by = 0; by < bs; by++) {
        for (var bx = 0; bx < bs; bx++) {
          var x = pts[i][0] + bx - off, y = pts[i][1] + by - off;
          var key = x + ',' + y;
          if (seen[key]) continue;
          seen[key] = 1;
          out.push([x, y]);
          if (edit.mirrorX) out.push([edit.w - 1 - x, y]);
          if (edit.mirrorY) out.push([x, edit.h - 1 - y]);
          if (edit.mirrorX && edit.mirrorY) out.push([edit.w - 1 - x, edit.h - 1 - y]);
        }
      }
    }
    edit.drag = {
      tool: tool, x: x0, y: y0, x2: x1, y2: y1, ch: colorIdx >= 0 ? colorIdx.toString(16) : '.',
      colorIdx: colorIdx >= 0 ? colorIdx : 0
    };
    edit.previewPts = out;
    if (!fxRAF) paintFx();
  }

  // 抬手时把预览点集真正写进数据，并只重画这些格子
  function commitGeom() {
    if (!edit || !edit.drag) return;
    var pts = edit.previewPts || [];
    var ch = edit.drag.ch;
    for (var i = 0; i < pts.length; i++) {
      var x = pts[i][0], y = pts[i][1];
      if (x < 0 || y < 0 || x >= edit.w || y >= edit.h) continue;
      setCell(y * edit.w + x, ch);
      markCell(x, y);
    }
    edit.previewPts = null;
    edit.drag = null;
    paintFx();
  }

  // ---- 渲染层（v0.38.0）----
  // 两层画布：
  //   底层 .ci-pet-editcanvas —— 底板 + 已落定的豆子，只重画变化的那几格；
  //   上层 .ci-pet-editfx     —— 直线/矩形预览、落点提示、落豆涟漪，每帧整层清空。
  // 旧版每来一个 pointermove 就把 32×32 整块重画（最坏 1024 次 drawImage + 整张底板），
  // 大画板在平板上每划一下都掉帧 —— 这是「手感差」的根因，不是工具不够多。
  var editFx = null;
  var editStage = null;
  var canvasWrapEl = null;   // computeCell 要量它
  var editView = null;       // { cell, cellCss, dpr, w, h, board, ctx, fxCtx }
  var ED_BG = '#FBF6E8';
  var dirtyCells = [];
  var dirtyFull = false;
  var paintRAF = 0;
  var rippleList = [];
  var fxRAF = 0;
  var hoverCell = null;
  var lastPointerType = 'mouse';   // paintFx（模块级）要读，不能只声明在 renderEditor 里
  var statsTimer = 0;
  var undoBtnEl = null;
  var redoBtnEl = null;
  var editorGestureCleanup = null;   // 全局 pointerup 清理函数（重建编辑器前要解绑）
  // 性能埋点（v0.40）：绘制耗时 / 输入到可见的延迟。探针读 __ciBeadState().perf。
  var perf = { paintMs: 0, paintMax: 0, paintN: 0, inputAt: 0, latencyMax: 0 };
  var fxBounds = null;   // 上一帧 fx 层画过的区域（只清这一块，别整面清）

  function editDpr(cellCss, n) {
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    // 背板总量上限 2048²：32×32 在 56px 格 + dpr2 下原始像素 3584²（48MB），
    // 低端平板（Android 9 / Chrome 80）再叠一块预览层会直接 OOM 白屏。
    var maxSide = 2048;
    if (n * cellCss * dpr > maxSide) dpr = Math.max(1, maxSide / (n * cellCss));
    return dpr;
  }

  function viewCellCss() {
    return Math.max(4, Math.round(CELL * (edit && edit.zoom ? edit.zoom : 1)));
  }

  function mountEditView() {
    if (!edit || !editCanvas || !edit.w) return;
    var n = edit.w, m = edit.h;
    var cellCss = viewCellCss();
    var dpr = editDpr(cellCss, Math.max(n, m));
    var cell = cellCss * dpr;
    var cw = Math.round(n * cell), ch = Math.round(m * cell);
    editCanvas.width = cw;
    editCanvas.height = ch;
    editCanvas.style.width = (n * cellCss) + 'px';
    editCanvas.style.height = (m * cellCss) + 'px';
    if (editFx) {
      editFx.width = cw;
      editFx.height = ch;
      editFx.style.width = (n * cellCss) + 'px';
      editFx.style.height = (m * cellCss) + 'px';
    }
    if (editStage) {
      editStage.style.width = (n * cellCss) + 'px';
      editStage.style.height = (m * cellCss) + 'px';
    }
    editView = {
      w: n, h: m, cell: cell, cellCss: cellCss, dpr: dpr,
      texture: edit.bead !== false,
      board: boardLayer(n, m, cell, dpr, ED_BG, { pegs: true, grid: edit.grid !== false }),
      ctx: editCanvas.getContext('2d'),
      fxCtx: editFx ? editFx.getContext('2d') : null
    };
    dirtyFull = true;
    flushPaint();
    paintFx();
  }

  // 只重画一个矩形格子区（含端点）
  function paintRect(x0, y0, x1, y1) {
    if (!editView || !edit) return;
    var v = editView;
    x0 = Math.max(0, x0); y0 = Math.max(0, y0);
    x1 = Math.min(v.w - 1, x1); y1 = Math.min(v.h - 1, y1);
    if (x1 < x0 || y1 < y0) return;
    var c = v.cell;
    var px = Math.floor(x0 * c), py = Math.floor(y0 * c);
    var pw = Math.ceil((x1 + 1) * c) - px, ph = Math.ceil((y1 + 1) * c) - py;
    var g = v.ctx;
    g.clearRect(px, py, pw, ph);
    g.drawImage(v.board, px, py, pw, ph, px, py, pw, ph);
    for (var y = y0; y <= y1; y++) {
      for (var x = x0; x <= x1; x++) {
        var ch = edit.data.charAt(y * v.w + x);
        if (ch === '.' || !ch) continue;
        var idx = parseInt(ch, 16);
        if (!(idx >= 0 && idx < 16)) continue;
        g.drawImage(beadSprite(idx, v.cellCss, v.dpr, ED_BG, v.texture), x * c, y * c, c + 0.5, c + 0.5);
      }
    }
  }

  function markCell(x, y) {
    if (!perf.inputAt) perf.inputAt = (window.performance || Date).now();
    dirtyCells.push([x, y, x, y]);
    schedulePaint();
  }

  function markAll() {
    dirtyFull = true;
    schedulePaint();
  }

  function flushPaint() {
    paintRAF = 0;
    if (!editView) return;
    var t0 = (window.performance || Date).now();
    var isFullRepaint = dirtyFull;
    if (dirtyFull) {
      dirtyFull = false;
      dirtyCells = [];
      paintRect(0, 0, editView.w - 1, editView.h - 1);
    } else {
      var list = dirtyCells;
      dirtyCells = [];
      for (var i = 0; i < list.length; i++) paintRect(list[i][0], list[i][1], list[i][2], list[i][3]);
    }
    var dt = (window.performance || Date).now() - t0;
    // 只统计「落豆级」的增量重绘：整板重绘（首绘/撤销/切尺寸）是结构性成本，
    // 混进平均会把交互手感的数据完全带偏。
    if (!isFullRepaint) {
      perf.paintMs += dt;
      perf.paintN++;
      if (dt > perf.paintMax) perf.paintMax = dt;
      if (perf.inputAt) {
        var lat = t0 - perf.inputAt;
        if (lat > perf.latencyMax) perf.latencyMax = lat;
        perf.inputAt = 0;
      }
    }
    if (dt > perf.paintMax) perf.paintMax = dt;
    if (perf.inputAt) {
      var lat = t0 - perf.inputAt;
      if (lat > perf.latencyMax) perf.latencyMax = lat;
      perf.inputAt = 0;
    }
  }

  function schedulePaint() {
    if (paintRAF) return;
    paintRAF = requestAnimationFrame(flushPaint);
  }

  // 预览层：拖动中的直线/矩形、指针所在格、刚落下的豆子涟漪
  function paintFx() {
    if (!editView || !editView.fxCtx || !edit) return;
    var v = editView, g = v.fxCtx, c = v.cell;
    // ⚠️ 只清上一帧画过的那块：整面 1216² clearRect 在 Android WebView 上
    //    会触发整张纹理重传，涟漪动画 12 帧连清 → 手指一慢就掉帧。
    if (fxBounds) g.clearRect(fxBounds[0], fxBounds[1], fxBounds[2], fxBounds[3]);
    fxBounds = null;
    var bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
    function grow(x, y, w, h) {
      if (x < bx0) bx0 = x;
      if (y < by0) by0 = y;
      if (x + w > bx1) bx1 = x + w;
      if (y + h > by1) by1 = y + h;
    }
    if (edit.drag && edit.previewPts && edit.previewPts.length) {
      g.globalAlpha = 0.58;
      var pts = edit.previewPts;
      for (var i = 0; i < pts.length; i++) {
        var px = pts[i][0], py = pts[i][1];
        if (px < 0 || py < 0 || px >= v.w || py >= v.h) continue;
        if (edit.drag.colorIdx < 0) {
          // 橡皮预览：挖空处压一块半透明暗格，比画一颗灰豆子更像「要擦掉」
          g.fillStyle = 'rgba(58,42,28,0.28)';
          g.fillRect(px * c + 1, py * c + 1, c - 2, c - 2);
        } else {
          g.drawImage(beadSprite(edit.drag.colorIdx, v.cellCss, v.dpr, ED_BG, v.texture),
            px * c, py * c, c + 0.5, c + 0.5);
        }
        grow(px * c, py * c, c + 1, c + 1);
      }
      g.globalAlpha = 1;
    }
    if (hoverCell && !edit.painting && lastPointerType === 'mouse') {
      var hx = hoverCell.col, hy = hoverCell.row;
      g.strokeStyle = 'rgba(58,42,28,0.55)';
      g.lineWidth = Math.max(2, c * 0.09);
      g.strokeRect(hx * c + 1, hy * c + 1, c - 2, c - 2);
      grow(hx * c, hy * c, c, c);
    }
    if (rippleList.length) {
      var now = Date.now();
      for (var r = 0; r < rippleList.length; r++) {
        var rp = rippleList[r];
        var age = now - rp.t;
        if (age > 200) continue;
        var k = age / 200;
        g.strokeStyle = 'rgba(255,255,255,' + (0.75 * (1 - k)).toFixed(3) + ')';
        g.lineWidth = Math.max(1.5, c * 0.1 * (1 - k * 0.5));
        g.beginPath();
        g.arc(rp.x * c + c / 2, rp.y * c + c / 2, c * (0.28 + 0.35 * k), 0, Math.PI * 2);
        g.stroke();
        g.strokeStyle = 'rgba(255,214,110,' + (0.5 * (1 - k)).toFixed(3) + ')';
        g.beginPath();
        g.arc(rp.x * c + c / 2, rp.y * c + c / 2, c * (0.18 + 0.22 * k), 0, Math.PI * 2);
        g.stroke();
        grow(rp.x * c, rp.y * c, c, c);
      }
    }
    if (bx1 > bx0) fxBounds = [bx0, by0, bx1 - bx0, by1 - by0];
  }

  function fxLoop() {
    fxRAF = 0;
    var now = Date.now();
    rippleList = rippleList.filter(function(r) { return now - r.t < 200; });
    paintFx();
    if (rippleList.length) fxRAF = requestAnimationFrame(fxLoop);
  }

  function addRipple(x, y) {
    rippleList.push({ x: x, y: y, t: Date.now() });
    if (rippleList.length > 16) rippleList.shift();
    if (!fxRAF) fxRAF = requestAnimationFrame(fxLoop);
  }

  function redrawEditor() {
    if (!edit || !editCanvas) return;
    if (!editView || editView.w !== edit.w || editView.h !== edit.h ||
        Math.abs(editView.cellCss - viewCellCss()) > 0.5 ||
        editView.texture !== (edit.bead !== false)) {
      mountEditView();
      return;
    }
    markAll();
    paintFx();
  }

  // 统计/预览面板节流：拖拽时每 120ms 至多刷一次，抬手再强制刷一次。
  // 旧版每个 pointermove 都重建备料 chip DOM + 重画预览画布（1024 颗豆），
  // 真正拖起来时一卡一卡的就是它。
  function scheduleStats(force) {
    if (force) {
      if (statsTimer) { clearTimeout(statsTimer); statsTimer = 0; }
      updateEditorStats();
      return;
    }
    if (statsTimer) return;
    statsTimer = setTimeout(function() {
      statsTimer = 0;
      updateEditorStats();
    }, 120);
  }

  // 撤销栈存 {w,h,data}：换尺寸也能整个回退，不会出现「尺寸回退了、图案没回」
  function snapshot() {
    undoStack.push({ w: edit.w, h: edit.h, data: edit.data });
    if (undoStack.length > 40) undoStack.shift();
    redoStack = [];
    syncUndoBtns();
  }

  // 撤销/重做按钮的可用态：按钮是渲染时建的，状态必须跟着栈实时变，
  // 否则「拼了一笔后撤销仍是灰的」—— 用户会以为撤销坏了。
  // 空板提示：只在「一粒豆都没有」时出现（第一次落豆即消失）
  function syncEmptyHint() {
    var el = root && root.querySelector('.ci-pet-emptyhint');
    if (!el || !edit) return;
    var empty = beadStats(edit.data).total === 0;
    if (empty) el.classList.add('is-on');
    else el.classList.remove('is-on');
  }

  function syncUndoBtns() {
    if (undoBtnEl) undoBtnEl.disabled = !undoStack.length;
    if (redoBtnEl) redoBtnEl.disabled = !redoStack.length;
  }

  function applySnapshot(s) {
    var sameSize = edit.w === s.w && edit.h === s.h;
    edit.w = s.w;
    edit.h = s.h;
    edit.data = s.data;
    edit.drag = null;
    edit.previewPts = null;
    edit.painting = false;
    // 同尺寸的撤销/重做只重画画板：旧版一律 renderEditor()，整棵 DOM 重建，
    // 连按两下 Ctrl+Z 页面就闪两下，滚动位置还会跳回顶部。
    if (sameSize && editCanvas && editView) {
      markAll();
      paintFx();
      scheduleStats(true);
    } else {
      CELL = computeCell();
      renderEditor();
    }
    scheduleDraftSave();
  }

  function undoEdit() {
    if (!edit || !undoStack.length) return;
    redoStack.push({ w: edit.w, h: edit.h, data: edit.data });
    applySnapshot(undoStack.pop());
    syncUndoBtns();
  }

  function redoEdit() {
    if (!edit || !redoStack.length) return;
    undoStack.push({ w: edit.w, h: edit.h, data: edit.data });
    applySnapshot(redoStack.pop());
    syncUndoBtns();
  }

  function floodFill(col, row, ch) {
    var w = edit.w;
    var h = edit.h;
    var target = edit.data.charAt(row * w + col);
    if (target === ch) return;
    var stack = [[col, row]];
    var seen = {};
    while (stack.length) {
      var p = stack.pop();
      var x = p[0];
      var y = p[1];
      if (x < 0 || y < 0 || x >= w || y >= h) continue;
      var k = x + ',' + y;
      if (seen[k]) continue;
      seen[k] = 1;
      if (edit.data.charAt(y * w + x) !== target) continue;
      setCell(y * w + x, ch);
      stack.push([x + 1, y]); stack.push([x - 1, y]);
      stack.push([x, y + 1]); stack.push([x, y - 1]);
    }
  }

  // 拼豆作品的统一数据形态（和后端 validDesign / 悬浮桌宠共用）
  function editDesign() {
    return { v: 1, w: edit.w, h: edit.h, pal: 'p16', data: edit.data };
  }

  // 豆子质感偏好：默认开，关掉后回到纯像素块
  function readBeadPref() {
    try {
      if (storage && storage.get('beadStyle', null) === false) return false;
    } catch (e) {}
    return true;
  }

  // meta：{ workId, workName } —— 从作品库 / 草稿接上时带上，
  // 这样保存时会原地覆盖那件作品，而不是每改一次就往库里灌一件新的。
  function makeEditState(data, w, h, meta) {
    var dw = (w >= 16 && w <= 64 && w % 8 === 0) ? w : 16;
    var d = (data && data.length === dw * dw) ? data : blankGrid(dw, dw);
    return {
      w: dw,
      h: dw,
      data: d,
      color: 2,
      tool: 'pen',
      mirrorX: false,
      mirrorY: false,
      bead: readBeadPref(),
      painting: false,
      last: null,
      drag: null,
      workId: (meta && meta.workId) || null,
      workName: (meta && meta.workName) || null,
      // 输入框里正在打的名字：切工具/镜像会重建整页，靠它把「小鲸鱼」接住
      draftName: (meta && meta.workName) || null,
      // 最近用过的颜色（最多 6 个，跟着设备走）：换色时不用满盘找
      recent: readRecentColors(),
      zoom: 1,
      brush: readBrushSize(),
      grid: readGridPref()
    };
  }

  function readBrushSize() {
    try {
      var v = storage && storage.get('brushSize', 1);
      v = parseInt(v, 10);
      return (v >= 1 && v <= 3) ? v : 1;
    } catch (e) { return 1; }
  }
  function readGridPref() {
    try {
      if (storage && storage.get('gridOn', null) === false) return false;
    } catch (e) {}
    return true;
  }

  var RECENT_KEY = 'recentColors';
  function readRecentColors() {
    var list = [];
    try { list = (storage && storage.get(RECENT_KEY, [])) || []; } catch (e) { list = []; }
    if (Object.prototype.toString.call(list) !== '[object Array]') return [];
    return list.filter(function(i) {
      return typeof i === 'number' && i >= 0 && i < 16;
    }).slice(0, 6);
  }
  function pushRecentColor(idx) {
    if (!edit || typeof idx !== 'number') return;
    var list = (edit.recent || []).filter(function(i) { return i !== idx; });
    list.unshift(idx);
    edit.recent = list.slice(0, 6);
    try { if (storage) storage.set(RECENT_KEY, edit.recent); } catch (e) {}
  }

  function readDraft() {
    try {
      var d = storage && storage.get(DRAFT_KEY, null);
      if (!d || typeof d.data !== 'string' || !d.data) return null;
      var w = (d.w >= 16 && d.w <= 64 && d.w % 8 === 0) ? d.w : 16;
      if (d.data.length !== w * w) return null;
      return {
        w: w, h: w, data: d.data,
        workId: typeof d.workId === 'string' ? d.workId : null,
        workName: typeof d.workName === 'string' ? d.workName : null
      };
    } catch (e) {}
    return null;
  }

  // 草稿自动存（900ms 防抖）：误触返回 / 切页后还能从「继续上次」接上
  // 连 workId / workName 一起落盘：接上草稿再保存，仍然覆盖原来那件作品。
  function scheduleDraftSave() {
    if (!edit) return;
    if (draftTimer) { clearTimeout(draftTimer); draftTimer = null; }
    draftTimer = setTimeout(function() {
      draftTimer = null;
      try {
        if (storage) storage.set(DRAFT_KEY, {
          w: edit.w, h: edit.h, data: edit.data, ts: Date.now(),
          workId: edit.workId || null, workName: edit.workName || null
        });
      } catch (e) {}
    }, 900);
  }

  function startEditor(initialData, w, h, meta) {
    edit = makeEditState(initialData, w, h, meta);
    undoStack = [];
    redoStack = [];
    editDesigns = [];
    editDesignsLoaded = false;
    editDesignsError = false;
    renderEditor();
    loadDesigns();
  }

  // ---- 作品库（服务端 state.designs，最多 24 件）----
  function loadDesigns() {
    if (!api) return;
    api.get('/pet/designs').then(function(res) {
      var d = (res && res.data && res.data.data) || {};
      editDesigns = d.designs || [];
      editDesignsLoaded = true;
      editDesignsError = false;
      renderGallery();
    }).catch(function() {
      editDesignsLoaded = true;
      editDesignsError = true;
      renderGallery();
    });
  }

  function shortDate(s) {
    if (!s) return '';
    var d = new Date(s);
    if (isNaN(d.getTime())) return '';
    var mm = d.getMonth() + 1;
    var dd = d.getDate();
    return (mm < 10 ? '0' + mm : mm) + '-' + (dd < 10 ? '0' + dd : dd);
  }

  function renderGallery() {
    if (!editGalleryEl) return;
    if (editGalleryHeadEl) {
      // 把「还剩几格」摆到标题上：库里满了以后新作品会挤掉最旧的一件，
      // 不写出来，用户是不知道的。
      editGalleryHeadEl.textContent = '作品库 · ' + editDesigns.length + ' / ' + MAX_DESIGNS;
    }
    while (editGalleryEl.firstChild) editGalleryEl.removeChild(editGalleryEl.firstChild);
    if (!editDesignsLoaded && !editDesignsError) {
      editGalleryEl.appendChild(h('div', 'ci-pet-work-empty', '正在翻作品库…'));
      return;
    }
    if (editDesignsError) {
      var retry = h('div', 'ci-pet-work-empty', '作品库没翻开，点这里重试');
      retry.style.cursor = 'pointer';
      retry.addEventListener('click', function() {
        editDesignsLoaded = false;
        editDesignsError = false;
        renderGallery();
        loadDesigns();
      });
      editGalleryEl.appendChild(retry);
      return;
    }
    if (!editDesigns.length) {
      editGalleryEl.appendChild(h('div', 'ci-pet-work-empty', '还没有作品。点「保存当前」，把这一幅收进作品库。'));
      return;
    }
    editDesigns.forEach(function(item) {
      if (!item || !item.design || !item.design.data) return;
      var editing = !!(edit && edit.workId === item.id);
      var card = h('div', 'ci-pet-work' + (editing ? ' is-editing' : ''));
      var cv = document.createElement('canvas');
      var d = item.design;
      var dw = d.w || DIM;
      var dh = d.h || DIM;
      var cell = Math.max(2, Math.floor(56 / Math.max(dw, dh)));
      paint(cv, { w: dw, h: dh, data: d.data }, cell);
      cv.className = 'ci-pet-work-cv';
      card.appendChild(cv);

      var info = h('div', 'ci-pet-work-info');
      info.appendChild(h('div', 'ci-pet-work-name', item.name || '未命名作品'));
      info.appendChild(h('div', 'ci-pet-work-time',
        dw + '×' + dh + ' · ' + shortDate(item.saved_at) + (editing ? ' · 编辑中' : '')));
      card.appendChild(info);

      var del = h('button', 'ci-pet-work-del', '×');
      del.title = '删除这件作品';
      var armed = false;
      var timer = null;
      del.addEventListener('click', function(ev) {
        ev.stopPropagation();
        if (!armed) {
          armed = true;
          del.textContent = '确认删';
          timer = setTimeout(function() {
            armed = false;
            del.textContent = '×';
          }, 2200);
          return;
        }
        if (timer) { clearTimeout(timer); timer = null; }
        api.delete('/pet/designs/' + encodeURIComponent(item.id)).then(function(res) {
          var dd = (res && res.data && res.data.data) || {};
          editDesigns = dd.designs || [];
          // 删掉的正是手上这件：断开 id，否则再点保存会带着一个不存在的 id 去覆盖
          if (edit && edit.workId === item.id) {
            edit.workId = null;
            edit.workName = null;
          }
          renderGallery();
          sysToast('已删除作品', 'success');
        }).catch(function() {
          sysToast('删除失败，稍后再试', 'info');
        });
      });
      card.appendChild(del);

      card.addEventListener('click', function() { loadWork(item); });
      editGalleryEl.appendChild(card);
    });
  }

  function loadWork(item) {
    if (!edit || !item || !item.design) return;
    var d = item.design;
    snapshot();
    edit.w = (d.w === 24 || d.w === 32) ? d.w : 16;
    edit.h = edit.w;
    edit.data = (d.data && d.data.length === edit.w * edit.h) ? d.data : blankGrid(edit.w, edit.h);
    edit.drag = null;
    edit.painting = false;
    // 记住「手上是哪一件」：名字回填输入框，再保存时原地覆盖而不是新建一份
    edit.workId = item.id || null;
    edit.workName = item.name || null;
    edit.draftName = item.name || null;
    CELL = computeCell();
    renderEditor();
    scheduleDraftSave();
    sysToast('已载入「' + (item.name || '未命名') + '」', 'success');
  }

  // opts.then(ok)：保存完成后的回调（「就它了」要先落库再进起名页）
  function saveCurrentWork(opts) {
    if (!edit || !api) { if (opts && opts.then) opts.then(false); return; }
    opts = opts || {};
    var st = beadStats(edit.data);
    if (!st.total) {
      sysToast('画板还是空的，先拼几颗豆子再存吧', 'info');
      if (opts.then) opts.then(false);
      return;
    }
    var name = (editNameInput && editNameInput.value || '').trim().slice(0, 16) || '未命名作品';
    var btn = root && root.querySelector('.ci-pet-savebtn');
    // 保存前先看清两件事：库里是不是已经满了、这次是覆盖还是新建
    var wasFull = editDesigns.length >= MAX_DESIGNS;
    var hadThis = false;
    if (edit.workId) {
      for (var i = 0; i < editDesigns.length; i++) {
        if (editDesigns[i] && editDesigns[i].id === edit.workId) { hadThis = true; break; }
      }
    }
    var label = edit.workId ? '保存修改' : '保存当前';
    if (btn) { btn.disabled = true; btn.textContent = '保存中…'; }
    var payload = { name: name, design: editDesign() };
    if (edit.workId) payload.id = edit.workId; // 带 id = 覆盖，不灌重复件
    api.post('/pet/designs', payload).then(function(res) {
      var d = (res && res.data && res.data.data) || {};
      editDesigns = d.designs || editDesigns;
      editDesignsLoaded = true;
      editDesignsError = false;
      if (d.id) { edit.workId = d.id; edit.workName = name; edit.draftName = name; }
      label = edit.workId ? '保存修改' : '保存当前';
      // 按钮文案和 title 一起换：存完这一件就已经「有主」了，再点就是覆盖
      if (btn) {
        btn.disabled = false;
        btn.textContent = label;
        btn.title = edit.workId ? '覆盖作品库里的这一件' : '存成作品库里新的一件';
      }
      renderGallery();
      if (wasFull && !hadThis) {
        // 后端满 24 件时会丢掉最旧的一件，这件事必须说出来
        sysToast('作品库已满 24 件，「' + name + '」已存入，最早的一件被替换', 'info');
      } else {
        sysToast(hadThis ? '「' + name + '」已更新' : '「' + name + '」已收进作品库', 'success');
      }
      scheduleDraftSave();
      if (opts.then) opts.then(true);
    }).catch(function(err) {
      if (btn) { btn.disabled = false; btn.textContent = label; }
      var msg = (err && err.response && err.response.data && err.response.data.message) || '保存失败，稍后再试';
      sysToast(msg, 'info');
      if (opts.then) opts.then(false);
    });
  }

  // 备料清单纯文本：色号 + 中文名 + 颗数，直接粘给店家按号配豆
  function beadClipText(design, st) {
    var lines = ['拼豆备料清单 · ' + design.w + '×' + design.h + ' · 共 ' + st.total + ' 颗'];
    for (var i = 0; i < st.used.length; i++) {
      var u = st.used[i];
      lines.push(beadCode(u.idx) + ' ' + beadName(u.idx) + ' × ' + u.count);
    }
    return lines.join('\n');
  }

  function copyBeadList() {
    if (!edit) return;
    var design = editDesign();
    var st = beadStats(design.data);
    if (!st.total) { sysToast('画板还是空的，没有备料可复制', 'info'); return; }
    var text = beadClipText(design, st);
    // 老内核 / 非安全上下文没有 clipboard API，退回 execCommand
    function fallback() {
      try {
        var ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.select();
        var ok = document.execCommand && document.execCommand('copy');
        document.body.removeChild(ta);
        sysToast(ok ? '备料清单已复制' : '复制失败，请手动抄一下', ok ? 'success' : 'info');
      } catch (e) {
        sysToast('复制失败，请手动抄一下', 'info');
      }
    }
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(function() {
          sysToast('备料清单已复制', 'success');
        }, fallback);
        return;
      }
    } catch (e) {}
    fallback();
  }

  // 导出 PNG 图纸：24px 一格 + 网格线，下面接一整条备料清单。
  // 只导图不导清单，打印出来还得回头数色号 —— 手作党真正要的是「这张纸能照着摆」。
  // 导出到云盘（v0.38.0 用户要求：图纸不再只落在本机 Downloads，要进云盘）
  // 走 /api/cloud/upload（资源应用的云盘后端）。文件名带作品名 + 尺寸。
  // 失败不留死胡同：自动回退到本机下载，并说明原因。
  function exportDesignCloud() {
    if (!edit) return;
    var design = editDesign();
    if (!beadStats(design.data).total) {
      sysToast('画板还是空的，先拼几颗豆子再导出', 'info');
      return;
    }
    var fname = designFileName(design);
    sysToast('正在把图纸送进云盘…', 'info');
    buildDesignBlob(design, function(blob) {
      if (!blob) { sysToast('导出失败：这个环境生成不了图片', 'error'); return; }
      if (!api || typeof FormData === 'undefined') {
        sysToast('云盘不可用，已改为下载到本机', 'info');
        downloadBlob(blob, fname);
        return;
      }
      var fd = new FormData();
      fd.append('file', blob, fname);
      api.post('/cloud/upload', fd).then(function(res) {
        var d = (res && res.data && res.data.data) || {};
        sysToast('已存入云盘：' + (d.name || fname), 'success');
        showCloudToastAction();
      }).catch(function(err) {
        var msg = (err && err.response && err.response.data && err.response.data.message) || '云盘没连上';
        sysToast(msg + '，已改为下载到本机', 'info');
        downloadBlob(blob, fname);
      });
    });
  }

  // 成功后给一条「去云盘看看」的快捷入口（不打断编辑，点不点随你）
  function showCloudToastAction() {
    var el = h('button', 'ci-pet-cloudjump', '去云盘看看');
    el.addEventListener('click', function() {
      try {
        var sys = context && context.system;
        if (sys && sys.router && typeof sys.router.push === 'function') {
          sys.router.push('/resource/cloud');
          return;
        }
        if (sys && typeof sys.openApp === 'function') { sys.openApp('resource'); return; }
      } catch (e) {}
      sysToast('云盘入口在「资源」应用里', 'info');
    });
    if (root) root.appendChild(el);
    setTimeout(function() { if (el.parentNode) el.parentNode.removeChild(el); }, 6000);
  }

  function designFileName(design) {
    var base = (edit.workName || (editNameInput && editNameInput.value) || '').trim();
    base = base.replace(/[\\/:*?"<>|\s]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24);
    return (base || '拼豆') + '-' + design.w + 'x' + design.h + '.png';
  }

  // 图纸合成：画板 + 备料清单。导出（云盘/下载）与预览共用同一份。
  function buildDesignBlob(design, cb) {
    var cellPx = 24;
    var board = document.createElement('canvas');
    drawBoard(board, design, cellPx, { bg: '#FFFDF8', pegs: false, grid: true, bead: edit.bead });

    var logicalW = design.w * cellPx;
    var logicalH = design.h * cellPx;
    var k = board.width / logicalW;
    var pad = 16;
    var st = beadStats(design.data);
    var cols = Math.max(2, Math.min(6, Math.floor(logicalW / 120)));
    var rows = Math.ceil(st.used.length / cols);
    var legendH = pad + 22 + rows * 22 + pad;
    var out = document.createElement('canvas');
    out.width = board.width;
    out.height = board.height + Math.round(legendH * k);
    var g = out.getContext('2d');
    g.fillStyle = '#FFFDF8';
    g.fillRect(0, 0, out.width, out.height);
    g.drawImage(board, 0, 0);
    g.save();
    g.scale(k, k);
    var top = logicalH;
    g.fillStyle = '#2C3E50';
    g.font = '600 13px "PingFang SC", "Microsoft YaHei", Arial, sans-serif';
    g.fillText('备料清单 · 共 ' + st.total + ' 颗 · ' + st.used.length + ' 个色号', pad, top + pad + 10);
    var colW = (logicalW - pad * 2) / cols;
    for (var i = 0; i < st.used.length; i++) {
      var u = st.used[i];
      var cx = pad + (i % cols) * colW;
      var cy = top + pad + 24 + Math.floor(i / cols) * 22;
      g.fillStyle = palette[u.idx] || '#8E8E93';
      g.beginPath();
      g.arc(cx + 6, cy + 4, 5, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#2C3E50';
      g.font = '500 12px "PingFang SC", "Microsoft YaHei", Arial, sans-serif';
      g.fillText(beadCode(u.idx) + ' ' + beadName(u.idx) + ' × ' + u.count, cx + 18, cy + 9);
    }
    g.restore();
    try {
      if (out.toBlob) out.toBlob(function(blob) { cb(blob || null); }, 'image/png');
      else cb(dataUrlToBlob(out.toDataURL('image/png')));
    } catch (e) {
      cb(null);
    }
  }

  function dataUrlToBlob(url) {
    try {
      var parts = String(url).split(',');
      var mime = /data:([^;]+)/.exec(parts[0]);
      var bin = atob(parts[1]);
      var arr = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      return new Blob([arr], { type: (mime && mime[1]) || 'image/png' });
    } catch (e) { return null; }
  }

  function downloadBlob(blob, fname) {
    try {
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = fname;
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      setTimeout(function() {
        if (a.parentNode) a.parentNode.removeChild(a);
        URL.revokeObjectURL(url);
      }, 1200);
      sysToast('图纸已下载（含备料清单）', 'success');
    } catch (e) {
      sysToast('当前环境不支持下载，可长按画板截图保存', 'info');
    }
  }

  function exportDesignPng() {
    if (!edit) return;
    var design = editDesign();
    var st = beadStats(design.data);
    if (!st.total) { sysToast('画板还是空的，先拼几颗豆子再导出', 'info'); return; }
    var fname = designFileName(design);
    buildDesignBlob(design, function(blob) {
      if (!blob) { sysToast('导出失败：这个环境生成不了图片', 'error'); return; }
      downloadBlob(blob, fname);
    });
  }


  function resizeEditor(n) {
    if (!edit || edit.w === n) return;
    snapshot();
    edit.zoom = 1;   // 换档位一律回到适配大小（旧行为会保留放大倍数 → 大画板巨大到要滚）
    edit.data = resampleGrid(edit.w, edit.h, edit.data, n, n);
    edit.w = n;
    edit.h = n;
    edit.drag = null;
    edit.painting = false;
    CELL = computeCell();
    renderEditor();
    if (zoomSyncFn) zoomSyncFn();
    scheduleDraftSave();
  }

  // 键盘快捷键：只在编辑器页面生效；输入框里让浏览器自己处理
  // 单键直选工具：平板外接键盘 / 台式机比来回点按钮快得多
  var TOOL_KEYS = { b: 'pen', e: 'eraser', g: 'fill', i: 'eyedropper', l: 'line', r: 'rect' };

  function onEditorKey(e) {
    if (!edit || !root) return;
    if (!root.querySelector('.ci-pet-editcanvas')) return;
    var t = e.target;
    if (t && t.tagName && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
    var k = String(e.key || '').toLowerCase();
    if (e.ctrlKey || e.metaKey) {
      if (k === 'z') {
        e.preventDefault();
        if (e.shiftKey) redoEdit();
        else undoEdit();
      } else if (k === 'y') {
        e.preventDefault();
        redoEdit();
      } else if (k === 's') {
        // Ctrl+S 在这里是「存进作品库」，不是浏览器保存网页
        e.preventDefault();
        saveCurrentWork();
      }
      return;
    }
    if (e.altKey) return;
    if (TOOL_KEYS[k]) {
      e.preventDefault();
      if (edit.tool !== TOOL_KEYS[k]) {
        edit.tool = TOOL_KEYS[k];
        renderEditor();
      }
      return;
    }
    if (k === 'm') {
      // M 左右镜像、Shift+M 上下镜像：两轴各自开关，不用点两次按钮
      e.preventDefault();
      if (e.shiftKey) edit.mirrorY = !edit.mirrorY;
      else edit.mirrorX = !edit.mirrorX;
      renderEditor();
      sysToast((e.shiftKey ? '上下镜像' : '左右镜像') +
        (e.shiftKey ? (edit.mirrorY ? ' 已开' : ' 已关') : (edit.mirrorX ? ' 已开' : ' 已关')), 'info');
    }
  }

  function updateEditorStats() {
    if (!edit) return;
    var data = edit.data;
    var st = beadStats(data);
    if (editColorLabelEl) {
      // ⚠️ 不能整块 textContent 覆盖：v0.44 起这个标签里还有一个「当前色块」节点，
      //    覆盖会把方块连带删掉（实测方块消失）。只改文字节点。
      var curTxtEl = editColorLabelEl.querySelector('.ci-pet-curtxt');
      if (curTxtEl) curTxtEl.textContent = '当前色 ' + beadCode(edit.color) + ' · ' + beadName(edit.color);
      else editColorLabelEl.textContent = '当前色 ' + beadCode(edit.color) + ' · ' + beadName(edit.color);
    }
    if (editStatsLineEl) {
      editStatsLineEl.textContent = st.total
        ? ('共 ' + st.total + ' 颗豆 · ' + st.used.length + ' 个色号')
        : '还没有落豆';
    }
    if (editStatsWrapEl) {
      while (editStatsWrapEl.firstChild) editStatsWrapEl.removeChild(editStatsWrapEl.firstChild);
      if (!st.used.length) {
        editStatsWrapEl.appendChild(h('span', 'ci-pet-stat-empty', '点一下画板开始拼'));
      } else {
        st.used.forEach(function(u) {
          var chip = h('span', 'ci-pet-stat');
          chip.title = beadCode(u.idx) + ' · ' + beadName(u.idx) + '：' + u.count + ' 颗';
          var dot = h('i', 'ci-pet-stat-dot');
          dot.style.background = palette[u.idx] || '#888888';
          chip.appendChild(dot);
          chip.appendChild(h('b', 'ci-pet-stat-code', beadCode(u.idx)));
          chip.appendChild(h('span', 'ci-pet-stat-num', '×' + u.count));
          editStatsWrapEl.appendChild(chip);
        });
      }
    }
    syncEmptyHint();
    if (editPreviewEl) {
      // 拖拽中不重画预览：它要逐颗画满 16×16~32×32，比主画板还贵，
      // 而人正盯着手指落点，根本不会看右下角这一小块。
      if (!edit.painting) {
        var cell = Math.max(3, Math.floor(144 / edit.w));
        drawBoard(editPreviewEl, { w: edit.w, h: edit.h, data: data }, cell, {
          bg: '#FBF6E8',
          pegs: false,
          grid: false,
          bead: edit.bead
        });
      }
    }
  }

  // 画板下方的光标坐标：32×32 数格子时不用再眯着眼数
  function showEditPos(c) {
    if (!editPosEl) return;
    var txt = c ? ('列 ' + (c.col + 1) + ' · 行 ' + (c.row + 1)) : '';
    if (editPosEl.textContent !== txt) editPosEl.textContent = txt;
  }

  // 编辑器的整图操作（都走 snapshot，可 Ctrl+Z 回退）
  function editorFillAll() {
    if (!edit) return;
    snapshot();
    var ch = edit.color.toString(16);
    var n = edit.w * edit.h;
    var arr = new Array(n);
    for (var i = 0; i < n; i++) arr[i] = ch;
    edit.data = arr.join('');
    markAll();
    scheduleStats(true);
    scheduleDraftSave();
    addRipple(Math.floor(edit.w / 2), Math.floor(edit.h / 2));
  }

  function editorFlip(axis) {
    if (!edit) return;
    snapshot();
    var w = edit.w, h = edit.h;
    var out = new Array(w * h);
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var sx = axis === 'h' ? w - 1 - x : x;
        var sy = axis === 'v' ? h - 1 - y : y;
        out[y * w + x] = edit.data.charAt(sy * w + sx);
      }
    }
    edit.data = out.join('');
    markAll();
    scheduleStats(true);
    scheduleDraftSave();
  }

  // 整图平移一格（越界部分从另一边绕回来：拼豆摆到板边时最常用的挪法）
  function editorShift(dx, dy) {
    if (!edit) return;
    snapshot();
    var w = edit.w, h = edit.h;
    var out = new Array(w * h);
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var sx = ((x - dx) % w + w) % w;
        var sy = ((y - dy) % h + h) % h;
        out[y * w + x] = edit.data.charAt(sy * w + sx);
      }
    }
    edit.data = out.join('');
    markAll();
    scheduleStats(true);
    scheduleDraftSave();
  }

  // ==================== 导入图片 → 拼豆（v0.41）====================
  // 手作党真正的用法：从云盘里挑一张图，转成 N×N 草稿再手改。
  //
  // 转换质量四件事（旧版只做了第 3 条）：
  //   1. 多步降采样：一次 drawImage 大幅缩小会走最近邻，细节全糊成噪点；
  //      逐次减半再取目标尺寸，边缘才干净。
  //   2. Lab 空间配色：RGB 欧氏距离会把深蓝配成黑、肤色配成灰；
  //      转 CIELAB 后按人眼感知距离选色，肤色/绿色/蓝色明显更准。
  //   3. 纯色背景自动留空：边框取中位色，够一致就整片判为背景，
  //      否则照片的白底会变成一整板白豆（备料直接翻倍）。
  //   4. 色号上限：实体拼豆买不到 16 色时，把用得最少的色并入最接近的保留色。
  // 抖动默认关：拼豆是「一颗颗摆」的，误差扩散会把天空打成噪点，反而更不像原图；
  // 想要渐变可手动开「轻/强」。
  var importOpts = { dropBg: true, maxColors: 16, enhance: true, dither: 'off' };
  var zoomSyncFn = null;   // renderEditor 里注册，导入/切尺寸后同步「100%」标签

  // ---- sRGB → CIELAB（D65）----
  var SRGB_LUT = null;
  function srgbToLinear(v) {
    if (!SRGB_LUT) {
      SRGB_LUT = new Float32Array(256);
      for (var i = 0; i < 256; i++) {
        var c = i / 255;
        SRGB_LUT[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
      }
    }
    return SRGB_LUT[v & 255];
  }
  function rgb2lab(r, g, b) {
    var R = srgbToLinear(r), G = srgbToLinear(g), B = srgbToLinear(b);
    // sRGB → XYZ（D65）
    var x = (R * 0.4124564 + G * 0.3575761 + B * 0.1804375) / 0.95047;
    var y = (R * 0.2126729 + G * 0.7151522 + B * 0.0721750);
    var z = (R * 0.0193339 + G * 0.1191920 + B * 0.9503041) / 1.08883;
    function f(t) { return t > 0.008856 ? Math.pow(t, 1 / 3) : (7.787 * t + 16 / 116); }
    var fx = f(x), fy = f(y), fz = f(z);
    return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
  }
  function hex2rgb(hex) {
    return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
  }
  function labDist(a, b) {
    var dl = a[0] - b[0], da = a[1] - b[1], db = a[2] - b[2];
    return Math.sqrt(dl * dl + da * da + db * db);
  }
  var paletteLabCache = null;
  function paletteLabList() {
    if (!paletteLabCache || paletteLabCache.length !== palette.length) {
      paletteLabCache = palette.map(function(h) {
        var c = hex2rgb(h);
        return rgb2lab(c[0], c[1], c[2]);
      });
    }
    return paletteLabCache;
  }

  // ---- 采样：线性光盒式平均 ----
  // drawImage 的缩放是在 sRGB 空间做平均的（伽马不对），高饱和细节会偏暗、偏灰；
  // 这里缩到中间尺寸后再按格做**线性光**盒式平均，颜色更准。
  function lin2srgb(v) {
    if (v <= 0.0031308) return v * 12.92;
    return 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
  }
  function sampleSquare(img, sx, sy, side, n) {
    var t = Math.min(768, Math.max(n * 2, Math.round(side || n)));
    var cv = document.createElement('canvas');
    cv.width = cv.height = t;
    var g = cv.getContext('2d');
    g.imageSmoothingEnabled = true;
    if ('imageSmoothingQuality' in g) g.imageSmoothingQuality = 'high';
    g.drawImage(img, sx, sy, side, side, 0, 0, t, t);
    var src = g.getImageData(0, 0, t, t).data;
    var out = new Uint8ClampedArray(n * n * 4);
    var scale = t / n;
    for (var cy = 0; cy < n; cy++) {
      var y0 = Math.floor(cy * scale);
      var y1 = Math.max(y0 + 1, Math.floor((cy + 1) * scale));
      for (var cx = 0; cx < n; cx++) {
        var x0 = Math.floor(cx * scale);
        var x1 = Math.max(x0 + 1, Math.floor((cx + 1) * scale));
        var rs = 0, gs = 0, bs = 0, as = 0, cnt = 0;
        for (var yy = y0; yy < y1 && yy < t; yy++) {
          var rowOff = yy * t * 4;
          for (var xx = x0; xx < x1 && xx < t; xx++) {
            var o = rowOff + xx * 4;
            var a = src[o + 3];
            rs += srgbToLinear(src[o]) * a;
            gs += srgbToLinear(src[o + 1]) * a;
            bs += srgbToLinear(src[o + 2]) * a;
            as += a;
            cnt++;
          }
        }
        var oo = (cy * n + cx) * 4;
        if (!cnt || !as) { out[oo + 3] = 0; continue; }
        // 用 alpha 加权（抠图/半透明边缘不会被黑边污染）
        out[oo] = Math.round(lin2srgb(rs / as) * 255);
        out[oo + 1] = Math.round(lin2srgb(gs / as) * 255);
        out[oo + 2] = Math.round(lin2srgb(bs / as) * 255);
        out[oo + 3] = Math.round(as / cnt);
      }
    }
    return out;
  }

  function labsFromPixels(px, n) {
    var total = n * n;
    var pl = new Array(total);
    var alpha = new Uint8Array(total);
    for (var i = 0; i < total; i++) {
      pl[i] = rgb2lab(px[i * 4], px[i * 4 + 1], px[i * 4 + 2]);
      alpha[i] = px[i * 4 + 3];
    }
    return { pl: pl, alpha: alpha };
  }

  // 纯色背景：边框 2 圈取中位色，≥55% 相符才算
  function detectBgLab(pl, n) {
    var x, y, samples = [];
    for (var ring = 0; ring < 2; ring++) {
      for (x = ring; x < n - ring; x++) {
        samples.push(pl[ring * n + x], pl[(n - 1 - ring) * n + x]);
      }
      for (y = ring; y < n - ring; y++) {
        samples.push(pl[y * n + ring], pl[y * n + (n - 1 - ring)]);
      }
    }
    if (!samples.length) return null;
    var ls = samples.map(function(c) { return c[0]; }).sort(function(a, b) { return a - b; });
    var as = samples.map(function(c) { return c[1]; }).sort(function(a, b) { return a - b; });
    var bs = samples.map(function(c) { return c[2]; }).sort(function(a, b) { return a - b; });
    var mid = Math.floor(samples.length / 2);
    var cand = [ls[mid], as[mid], bs[mid]];
    var near = 0;
    for (var i = 0; i < samples.length; i++) if (labDist(samples[i], cand) < 12) near++;
    return (near / samples.length >= 0.55) ? cand : null;
  }

  // 主体包围盒（格坐标）——用来把照片里的主体放大到整块板
  function contentBox(pl, n, bgLab) {
    var x0 = n, y0 = n, x1 = -1, y1 = -1;
    for (var y = 0; y < n; y++) {
      for (var x = 0; x < n; x++) {
        if (labDist(pl[y * n + x], bgLab) < 16) continue;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
    if (x1 < 0) return null;
    return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
  }

  // ---- CIEDE2000：比 CIE76 更贴合人眼（深蓝/肤色差别明显）----
  function de2000(a, b) {
    var L1 = a[0], a1 = a[1], b1 = a[2];
    var L2 = b[0], a2 = b[1], b2 = b[2];
    var C1 = Math.sqrt(a1 * a1 + b1 * b1);
    var C2 = Math.sqrt(a2 * a2 + b2 * b2);
    var Cb = (C1 + C2) / 2;
    var Cb7 = Math.pow(Cb, 7);
    var G = 0.5 * (1 - Math.sqrt(Cb7 / (Cb7 + 6103515625)));   // 25^7
    var a1p = (1 + G) * a1, a2p = (1 + G) * a2;
    var C1p = Math.sqrt(a1p * a1p + b1 * b1);
    var C2p = Math.sqrt(a2p * a2p + b2 * b2);
    var h1p = (C1p === 0) ? 0 : Math.atan2(b1, a1p) * 180 / Math.PI;
    if (h1p < 0) h1p += 360;
    var h2p = (C2p === 0) ? 0 : Math.atan2(b2, a2p) * 180 / Math.PI;
    if (h2p < 0) h2p += 360;
    var dLp = L2 - L1;
    var dCp = C2p - C1p;
    var dhp;
    if (C1p * C2p === 0) dhp = 0;
    else {
      dhp = h2p - h1p;
      if (dhp > 180) dhp -= 360;
      else if (dhp < -180) dhp += 360;
    }
    var dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin(dhp * Math.PI / 360);
    var Lb = (L1 + L2) / 2;
    var Cbp = (C1p + C2p) / 2;
    var hbp;
    if (C1p * C2p === 0) hbp = h1p + h2p;
    else if (Math.abs(h1p - h2p) <= 180) hbp = (h1p + h2p) / 2;
    else if (h1p + h2p < 360) hbp = (h1p + h2p + 360) / 2;
    else hbp = (h1p + h2p - 360) / 2;
    var T = 1 - 0.17 * Math.cos((hbp - 30) * Math.PI / 180)
              + 0.24 * Math.cos(2 * hbp * Math.PI / 180)
              + 0.32 * Math.cos((3 * hbp + 6) * Math.PI / 180)
              - 0.20 * Math.cos((4 * hbp - 63) * Math.PI / 180);
    var dTheta = 30 * Math.exp(-Math.pow((hbp - 275) / 25, 2));
    var Cbp7 = Math.pow(Cbp, 7);
    var Rc = 2 * Math.sqrt(Cbp7 / (Cbp7 + 6103515625));
    var Sl = 1 + (0.015 * Math.pow(Lb - 50, 2)) / Math.sqrt(20 + Math.pow(Lb - 50, 2));
    var Sc = 1 + 0.045 * Cbp;
    var Sh = 1 + 0.015 * Cbp * T;
    var Rt = -Math.sin(2 * dTheta * Math.PI / 180) * Rc;
    var dl = dLp / Sl, dc = dCp / Sc, dh = dHp / Sh;
    return Math.sqrt(dl * dl + dc * dc + dh * dh + Rt * dc * dh);
  }

  // 抖动强度：关 / 轻 / 强（误差扩散）
  var DITHER_LEVEL = { off: 0, light: 0.55, strong: 0.85 };
  function ditherStrength(v) {
    if (v === true) return 0.55;
    if (typeof v === 'number') return Math.max(0, Math.min(1, v));
    return DITHER_LEVEL[v] || 0;
  }

  // 把像素转成 16 色拼豆：返回 { data, colors, beads, dropped, bg, reframed }
  function pixelsToBeads(px, n, opts) {
    opts = opts || {};
    var labs = paletteLabList();
    var total = n * n;
    var got = labsFromPixels(px, n);
    var pl = got.pl, alpha = got.alpha;
    var i, x, y, k, idx;

    var bgLab = (opts.dropBg !== false) ? detectBgLab(pl, n) : null;

    // 护栏：覆盖 85% 以上的「背景色」其实是主色（纯色贴纸不该被清空）
    if (bgLab) {
      var opaque = 0, match = 0;
      for (i = 0; i < total; i++) {
        if (alpha[i] < 40) continue;
        opaque++;
        if (labDist(pl[i], bgLab) < 14) match++;
      }
      if (!opaque || match / opaque > 0.85) bgLab = null;
    }

    // 自动对比 + 轻微饱和 + 轻微锐化：照片直转 16 色容易发灰、边缘糊。
    // ⚠️ 对比不能用「2% 分位裁剪」：图里暗部只占 2% 时（头发、深色衣服），
    //    分位点会落在中亮区，深色直接被压成纯黑（实测蓝衣服变黑）。
    //    改成以均值为中心、增益有上限的对比拉伸 —— 再暗的细节也不会被裁掉。
    if (opts.enhance !== false) {
      var sum = 0, sum2 = 0, cnt = 0;
      for (i = 0; i < total; i++) {
        if (alpha[i] < 40) continue;
        if (bgLab && labDist(pl[i], bgLab) < 14) continue;
        var Lv = pl[i][0];
        sum += Lv;
        sum2 += Lv * Lv;
        cnt++;
      }
      if (cnt > 8) {
        var mean = sum / cnt;
        var sd = Math.sqrt(Math.max(0, sum2 / cnt - mean * mean));
        var gain = Math.min(1.22, Math.max(0.95, 30 / Math.max(8, sd)));
        for (i = 0; i < total; i++) {
          pl[i][0] = Math.max(0, Math.min(100, mean + (pl[i][0] - mean) * gain));
          pl[i][1] = Math.max(-80, Math.min(80, pl[i][1] * 1.10));
          pl[i][2] = Math.max(-80, Math.min(80, pl[i][2] * 1.10));
        }
      }
      // USM：3×3 盒式模糊后的高频回加 35%。48~64 格下这一段决定「还认不认得出是谁」。
      var blur = new Float32Array(total);
      for (y = 0; y < n; y++) {
        for (x = 0; x < n; x++) {
          var s3 = 0, c3 = 0;
          for (var dy = -1; dy <= 1; dy++) {
            for (var dx = -1; dx <= 1; dx++) {
              var xx = x + dx, yy = y + dy;
              if (xx < 0 || yy < 0 || xx >= n || yy >= n) continue;
              s3 += pl[yy * n + xx][0];
              c3++;
            }
          }
          blur[y * n + x] = s3 / c3;
        }
      }
      for (i = 0; i < total; i++) {
        pl[i][0] = Math.max(0, Math.min(100, pl[i][0] + (pl[i][0] - blur[i]) * 0.35));
      }
    }

    // 配色：先 CIE76 取前 4 个候选，再用 CIEDE2000 定夺（全量 CIEDE2000 太慢）。
    // 抖动用 Floyd–Steinberg 误差扩散：把这一格的取色误差按 7/3/5/1 分给邻居，
    // 渐变色带被打散成细微颗粒 —— 比 4×4 有序抖动的「十字纹」自然得多。
    var strength = opts.dither === true ? 0.55 : (opts.ditherStrength !== undefined
      ? Math.max(0, Math.min(1, opts.ditherStrength)) : ditherStrength(opts.dither));
    var cells = new Int8Array(total);
    var counts = new Array(16).fill(0);
    var colors = 0;
    var cand = [0, 0, 0, 0];
    var err = (strength > 0) ? new Float32Array(total * 3) : null;

    function pickFor(L, A, B) {
      var bestD = [Infinity, Infinity, Infinity, Infinity];
      for (var kk = 0; kk < 16; kk++) {
        var dl = labs[kk][0] - L, da = labs[kk][1] - A, db = labs[kk][2] - B;
        var d2 = dl * dl + da * da + db * db;
        if (d2 < bestD[3]) {
          bestD[3] = d2; cand[3] = kk;
          for (var j = 3; j > 0 && bestD[j] < bestD[j - 1]; j--) {
            var tb = bestD[j]; bestD[j] = bestD[j - 1]; bestD[j - 1] = tb;
            var tc = cand[j]; cand[j] = cand[j - 1]; cand[j - 1] = tc;
          }
        }
      }
      var tgt = [L, A, B];
      var pick = cand[0], pd = de2000(tgt, labs[pick]);
      for (var c2 = 1; c2 < 4; c2++) {
        var dd = de2000(tgt, labs[cand[c2]]);
        if (dd < pd) { pd = dd; pick = cand[c2]; }
      }
      return pick;
    }

    for (y = 0; y < n; y++) {
      var rev = (y & 1) === 1;
      for (var xi = 0; xi < n; xi++) {
        x = rev ? (n - 1 - xi) : xi;
        i = y * n + x;
        if (alpha[i] < 40) { cells[i] = -1; continue; }
        var L0 = pl[i][0], A0 = pl[i][1], B0 = pl[i][2];
        if (bgLab && labDist([L0, A0, B0], bgLab) < 14) { cells[i] = -1; continue; }
        if (err) {
          L0 += err[i * 3];
          A0 += err[i * 3 + 1];
          B0 += err[i * 3 + 2];
        }
        var pickIdx = pickFor(L0, A0, B0);
        cells[i] = pickIdx;
        if (counts[pickIdx] === 0) colors++;
        counts[pickIdx]++;
        if (err) {
          var pl2 = labs[pickIdx];
          var eL = (L0 - pl2[0]) * strength;
          var eA = (A0 - pl2[1]) * strength;
          var eB = (B0 - pl2[2]) * strength;
          var nx = x + (rev ? -1 : 1);
          var ox = x - (rev ? -1 : 1);
          // 不用内层函数：热点循环里每次建闭包既慢又容易在旧引擎上踩块级函数声明的坑
          if (nx >= 0 && nx < n) {
            var q1 = (y * n + nx) * 3;
            err[q1] += eL * 0.4375; err[q1 + 1] += eA * 0.4375; err[q1 + 2] += eB * 0.4375;
          }
          if (y + 1 < n) {
            if (ox >= 0 && ox < n) {
              var q2 = ((y + 1) * n + ox) * 3;
              err[q2] += eL * 0.1875; err[q2 + 1] += eA * 0.1875; err[q2 + 2] += eB * 0.1875;
            }
            var q3 = ((y + 1) * n + x) * 3;
            err[q3] += eL * 0.3125; err[q3 + 1] += eA * 0.3125; err[q3 + 2] += eB * 0.3125;
            if (nx >= 0 && nx < n) {
              var q4 = ((y + 1) * n + nx) * 3;
              err[q4] += eL * 0.0625; err[q4 + 1] += eA * 0.0625; err[q4 + 2] += eB * 0.0625;
            }
          }
        }
      }
    }

    // 色号上限：最少的色并入 Lab 最近的保留色
    var cap = Math.max(2, Math.min(16, opts.maxColors || 16));
    var remap = {};
    while (colors > cap) {
      var victim = -1, vc = Infinity;
      for (k = 0; k < 16; k++) {
        if (counts[k] > 0 && counts[k] < vc) { vc = counts[k]; victim = k; }
      }
      if (victim < 0) break;
      var target = -1, td = Infinity;
      for (k = 0; k < 16; k++) {
        if (k === victim || counts[k] === 0) continue;
        var dd2 = de2000(labs[victim], labs[k]);
        if (dd2 < td) { td = dd2; target = k; }
      }
      if (target < 0) break;
      counts[target] += counts[victim];
      counts[victim] = 0;
      colors--;
      remap[victim] = target;
    }

    var arr = new Array(total);
    var beads = 0;
    for (i = 0; i < total; i++) {
      idx = cells[i];
      if (idx < 0) { arr[i] = '.'; continue; }
      while (remap[idx] !== undefined) idx = remap[idx];
      arr[i] = idx.toString(16);
      beads++;
    }
    return { data: arr.join(''), colors: colors, beads: beads, bg: !!bgLab };
  }

  // 导入前处理：先在粗网格上探背景与主体，主体太小就重新取景，再做正式采样
  function prepareAndConvert(img, n, opts) {
    var side = Math.min(img.width || n, img.height || n);
    var sx = ((img.width || side) - side) / 2;
    var sy = ((img.height || side) - side) / 2;
    var reframed = false;
    if (opts.dropBg !== false && side > 64) {
      try {
        var coarseN = 40;
        var cpx = sampleSquare(img, sx, sy, side, coarseN);
        var cg = labsFromPixels(cpx, coarseN);
        var cbg = detectBgLab(cg.pl, coarseN);
        if (cbg) {
          var box = contentBox(cg.pl, coarseN, cbg);
          if (box && (box.w * box.h) / (coarseN * coarseN) < 0.55 && box.w >= 3 && box.h >= 3) {
            // 主体扩裁：以包围盒中心取一个正方形，四周留 6% 呼吸位
            var bw = box.w / coarseN, bh = box.h / coarseN;
            var need = Math.min(1, Math.max(bw, bh) * 1.12);
            if (need < 0.95) {
              var cx = sx + side * ((box.x + box.w / 2) / coarseN);
              var cy = sy + side * ((box.y + box.h / 2) / coarseN);
              var ns = side * need;
              var nsx = Math.max(0, Math.min((img.width || side) - ns, cx - ns / 2));
              var nsy = Math.max(0, Math.min((img.height || side) - ns, cy - ns / 2));
              sx = nsx; sy = nsy; side = ns;
              reframed = true;
            }
          }
        }
      } catch (e) { /* 扩裁失败就按原图取景 */ }
    }
    var res = pixelsToBeads(sampleSquare(img, sx, sy, side, n), n, opts);
    res.reframed = reframed;
    return res;
  }

  // 应用一次导入：整步可撤销
  function applyImportedBeads(res, sourceName) {
    if (!edit || !res) return;
    snapshot();
    edit.data = res.data;
    edit.drag = null;
    edit.previewPts = null;
    edit.tool = 'pen';
    edit.zoom = 1;
    CELL = computeCell();
    mountEditView();
    if (zoomSyncFn) zoomSyncFn();
    scheduleStats(true);
    scheduleDraftSave();
    sysToast(
      '已转成 ' + edit.w + '×' + edit.h + '：' + res.beads + ' 颗 · ' + res.colors + ' 个色号' +
      (res.dropped ? ' · 去掉 ' + res.dropped + ' 格背景' : ''),
      'success'
    );
  }

  function importImageDataUrl(url, opts, done) {
    if (typeof opts === 'function') { done = opts; opts = null; }
    var o = opts || importOpts;
    if (!edit || !url) { if (done) done(false); return; }
    var img = new Image();
    img.onload = function() {
      try {
        var res = prepareAndConvert(img, edit.w, o);
        if (!res.beads) { sysToast('这张图几乎是纯色/透明的，先换一张试试', 'info'); if (done) done(false); return; }
        applyImportedBeads(res);
        if (done) done(true);
      } catch (e) {
        try { window.__ciBeadImportErr = String((e && e.stack) || e); } catch (e2) {}
        sysToast('这张图读不出来，换一张试试', 'error');
        if (done) done(false);
      }
    };
    img.onerror = function() {
      sysToast('图片解码失败，换一张试试', 'error');
      if (done) done(false);
    };
    img.src = url;
  }

  // ---- 云盘选择器（v0.43：全量列表 + 选中预览调参）----
  // 列表不再截断 30 张（用户云盘里 400+ 张，只看到几张以为丢了）；
  // 缩略图用 IntersectionObserver 懒加载 + 并发 4，滚到哪拉到哪。
  function openCloudImport() {
    if (!api) { sysToast('云盘不可用', 'error'); return; }

    var overlay = h('div', 'ci-pet-cloudpick');
    var panel = h('div', 'ci-pet-cloudpick-panel');
    var head = h('div', 'ci-pet-cloudpick-head');
    head.appendChild(h('span', 'ci-pet-cloudpick-title', '从云盘导入'));
    var close = h('button', 'ci-pet-cloudpick-x', '✕');
    head.appendChild(close);
    panel.appendChild(head);

    var listView = h('div', 'ci-pet-pickview is-list');
    var previewView = h('div', 'ci-pet-pickview');
    previewView.style.display = 'none';
    panel.appendChild(listView);
    panel.appendChild(previewView);
    overlay.appendChild(panel);
    if (root) root.appendChild(overlay);

    var urls = [];
    var pick = { img: null, name: '', size: edit.w, res: null, busy: false };

    function revokeAll() {
      urls.forEach(function(u) { try { URL.revokeObjectURL(u); } catch (e) {} });
      urls = [];
    }
    function closeAll() {
      revokeAll();
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
    }
    close.addEventListener('click', closeAll);
    overlay.addEventListener('click', function(e) { if (e.target === overlay) closeAll(); });

    // ---------- 列表 ----------
    var listHint = h('div', 'ci-pet-cloudpick-sub', '点一张图 → 预览转换效果 → 满意再用。');
    listView.appendChild(listHint);
    var grid = h('div', 'ci-pet-cloudpick-grid');
    grid.appendChild(h('div', 'ci-pet-cloudpick-hint', '正在翻云盘…'));
    listView.appendChild(grid);
    var foot = h('div', 'ci-pet-cloudpick-foot');
    var local = h('button', 'ci-pet-minibtn', '从本机选择图片');
    foot.appendChild(local);
    listView.appendChild(foot);

    local.addEventListener('click', function() {
      closeAll();
      pickLocalImage();
    });

    // 缩略图并发队列：一次最多 4 个请求
    var queue = [], inflight = 0;
    function pump() {
      while (inflight < 4 && queue.length) {
        var job = queue.shift();
        inflight++;
        job().then(function() { inflight--; pump(); }, function() { inflight--; pump(); });
      }
    }
    function enqueue(fn) { queue.push(fn); pump(); }

    var io = null;
    if (window.IntersectionObserver) {
      io = new IntersectionObserver(function(entries) {
        entries.forEach(function(en) {
          if (!en.isIntersecting) return;
          var tile = en.target;
          io.unobserve(tile);
          if (tile.__load) { var f = tile.__load; tile.__load = null; enqueue(f); }
        });
      }, { root: grid, rootMargin: '240px' });
    }

    api.get('/cloud/files').then(function(res) {
      var files = ((res && res.data && res.data.data && res.data.data.files) || []).filter(function(f) {
        return f && /^image\//i.test(String(f.mime_type || ''));
      });
      grid.innerHTML = '';
      if (!files.length) {
        grid.appendChild(h('div', 'ci-pet-cloudpick-hint',
          '云盘里还没有图片。先到「资源 → 云盘」上传一张，再回来导入。'));
        return;
      }
      listHint.textContent = '共 ' + files.length + ' 张图片 · 点一张预览转换效果';

      files.forEach(function(f, idx) {
        var tile = h('button', 'ci-pet-cloudtile');
        var img = document.createElement('img');
        img.alt = f.name || '';
        tile.appendChild(img);
        tile.appendChild(h('span', 'ci-pet-cloudtile-name', f.name || '图片'));
        tile.title = f.name || '';
        tile.addEventListener('click', function() { openPreview(f, tile); });
        grid.appendChild(tile);

        function loadThumb() {
          return api.get('/cloud/files/' + encodeURIComponent(f.hash) + '?w=160', { responseType: 'blob' })
            .then(function(r2) {
              var b = r2 && r2.data;
              if (!b) return;
              var u = URL.createObjectURL(b);
              urls.push(u);
              img.src = u;
            }).catch(function() { tile.classList.add('is-broken'); });
        }
        if (io && idx > 11) {
          tile.__load = loadThumb;   // 首屏之后一律懒加载
          io.observe(tile);
        } else {
          enqueue(loadThumb);
        }
      });
    }).catch(function() {
      grid.innerHTML = '';
      grid.appendChild(h('div', 'ci-pet-cloudpick-hint', '云盘没连上，稍后再试。'));
    });

    // ---------- 预览 / 调参 ----------
    var pairWrap = h('div', 'ci-pet-pickpair');
    var cellA = h('div', 'ci-pet-pickcell');
    var originImg = document.createElement('img');
    originImg.className = 'ci-pet-pickimg';
    cellA.appendChild(originImg);
    cellA.appendChild(h('span', 'ci-pet-pickcap', '原图'));
    var cellB = h('div', 'ci-pet-pickcell');
    var previewCv = document.createElement('canvas');
    previewCv.className = 'ci-pet-pickcv';
    previewCv.title = '点一下放大看';
    cellB.appendChild(previewCv);
    cellB.appendChild(h('span', 'ci-pet-pickcap', '拼豆预览'));
    pairWrap.appendChild(cellA);
    pairWrap.appendChild(cellB);
    previewView.appendChild(pairWrap);

    // 点预览放大：小图看不清豆子排布，放大到 360px 覆盖层（不打断参数调整）
    previewCv.addEventListener('click', function() {
      if (!pick.res) return;
      var big = h('div', 'ci-pet-cloudpick');
      var box = h('div', 'ci-pet-pickzoom');
      var cv = document.createElement('canvas');
      drawBoard(cv, { w: pick.size, h: pick.size, data: pick.res.data }, Math.max(3, Math.floor(360 / pick.size)), {
        bg: '#FBF6E8', pegs: true, grid: true, bead: true
      });
      box.appendChild(cv);
      box.appendChild(h('div', 'ci-pet-pickcap',
        pick.size + '×' + pick.size + ' · ' + pick.res.beads + ' 颗 · ' + pick.res.colors + ' 色'));
      big.appendChild(box);
      big.addEventListener('click', function() { if (big.parentNode) big.parentNode.removeChild(big); });
      if (root) root.appendChild(big);
    });

    var optRow = h('div', 'ci-pet-cloudpick-opts');
    previewView.appendChild(optRow);
    var previewFoot = h('div', 'ci-pet-cloudpick-foot');
    var backBtn = h('button', 'ci-pet-minibtn', '← 换一张');
    var applyBtn = h('button', 'ci-pet-btn ci-pet-pinsmall', '用它');
    applyBtn.disabled = true;   // 首次预览出来之前不能点（否则点到空的 res）
    previewFoot.appendChild(backBtn);
    previewFoot.appendChild(applyBtn);
    previewView.appendChild(previewFoot);

    function chipGroup(label, values, get, set) {
      var g = h('div', 'ci-pet-opts');
      g.appendChild(h('span', 'ci-pet-opts-label', label));
      var btns = [];
      values.forEach(function(v) {
        var b = h('button', 'ci-pet-chip' + (get() === v.value ? ' is-on' : ''), v.label);
        b.addEventListener('click', function() {
          set(v.value);
          btns.forEach(function(x) { x.classList.remove('is-on'); });
          b.classList.add('is-on');
          schedulePreview();
        });
        btns.push(b);
        g.appendChild(b);
      });
      return g;
    }
    optRow.appendChild(chipGroup('尺寸', [
      { label: '16', value: 16 }, { label: '24', value: 24 }, { label: '32', value: 32 },
      { label: '48', value: 48 }, { label: '64', value: 64 }
    ], function() { return pick.size; }, function(v) { pick.size = v; }));
    optRow.appendChild(chipGroup('色号', [
      { label: '6', value: 6 }, { label: '10', value: 10 }, { label: '16', value: 16 }
    ], function() { return importOpts.maxColors; }, function(v) { importOpts.maxColors = v; }));
    optRow.appendChild(chipGroup('增强', [
      { label: '开', value: true }, { label: '关', value: false }
    ], function() { return importOpts.enhance; }, function(v) { importOpts.enhance = v; }));
    optRow.appendChild(chipGroup('抖动', [
      { label: '关', value: 'off' }, { label: '轻', value: 'light' }, { label: '强', value: 'strong' }
    ], function() { return importOpts.dither; }, function(v) { importOpts.dither = v; }));
    optRow.appendChild(chipGroup('背景', [
      { label: '留空', value: true }, { label: '保留', value: false }
    ], function() { return importOpts.dropBg; }, function(v) { importOpts.dropBg = v; }));

    var previewTimer = 0;
    function schedulePreview() {
      if (previewTimer) clearTimeout(previewTimer);
      previewTimer = setTimeout(runPreview, 120);
    }

    function runPreview() {
      previewTimer = 0;
      if (!pick.img) return;
      pick.busy = true;
      // 转换没完成前不许点「用它」：否则点到的是上一张/空的 res
      applyBtn.disabled = true;
      cellB.classList.add('is-busy');
      // 让出一帧再算，避免连点选项时把主线程堵住
      setTimeout(function() {
        try {
          var res = prepareAndConvert(pick.img, pick.size, importOpts);
          pick.res = res;
          var cv = previewCv;
          var cell = Math.max(2, Math.ceil(190 / pick.size));
          drawBoard(cv, { w: pick.size, h: pick.size, data: res.data }, cell, {
            bg: '#FBF6E8', pegs: false, grid: false, bead: true
          });
          var capB = cellB.querySelector('.ci-pet-pickcap');
          if (capB) capB.textContent = pick.size + '×' + pick.size + ' · ' + res.beads + ' 颗 · ' + res.colors + ' 色';
          applyBtn.textContent = '用它（' + pick.size + '×' + pick.size + '）';
          applyBtn.disabled = false;
        } catch (e) {
          try { window.__ciPickErr = String((e && e.stack) || e); } catch (e2) {}
          sysToast('这张图转不出来，换一张试试', 'error');
        }
        pick.busy = false;
        cellB.classList.remove('is-busy');
      }, 16);
    }

    function openPreview(f, tile) {
      if (tile) tile.classList.add('is-busy');
      api.get('/cloud/files/' + encodeURIComponent(f.hash), { responseType: 'blob' }).then(function(res) {
        var blob = res && res.data;
        if (!blob) { sysToast('这张图读不出来', 'error'); return; }
        var url = URL.createObjectURL(blob);
        urls.push(url);
        var img = new Image();
        img.onload = function() {
          pick.img = img;
          pick.name = f.name || '';
          originImg.src = url;
          listView.style.display = 'none';
          previewView.style.display = '';
          schedulePreview();
        };
        img.onerror = function() { sysToast('图片解码失败', 'error'); };
        img.src = url;
      }).catch(function() {
        if (tile) tile.classList.remove('is-busy');
        sysToast('云盘图片读取失败', 'error');
      });
    }

    backBtn.addEventListener('click', function() {
      pick.img = null;
      pick.res = null;
      previewView.style.display = 'none';
      listView.style.display = '';
    });

    applyBtn.addEventListener('click', function() {
      if (!pick.res) { sysToast('还在转换，稍等一下', 'info'); return; }
      var n = pick.size;
      // 尺寸可能和当前画板不同：先整页重建到目标尺寸（这样头部档位高亮也跟着变），
      // 再落图。手动 mountEditView 只换画布、不换页头，会出现「板是 64、高亮还是 16」。
      if (n !== edit.w) {
        edit.w = n;
        edit.h = n;
        edit.zoom = 1;
        CELL = computeCell();
        renderEditor();
      }
      applyImportedBeads(pick.res);
      closeAll();
    });
  }

  function pickLocalImage() {
    var input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.style.display = 'none';
    input.addEventListener('change', function() {
      var f = input.files && input.files[0];
      if (!f) return;
      var reader = new FileReader();
      reader.onload = function() { importImageDataUrl(String(reader.result || ''), importOpts); };
      reader.onerror = function() { sysToast('这张图读不出来，换一张试试', 'error'); };
      reader.readAsDataURL(f);
      setTimeout(function() { if (input.parentNode) input.parentNode.removeChild(input); }, 0);
    });
    document.body.appendChild(input);
    input.click();
  }

  function clearEditSession() {
    try { if (storage) storage.set(EDIT_SESSION_KEY, null); } catch (e) {}
  }

  function exitEditorToHome() {
    clearEditSession();
    editorOpen = false;
    renderHome();
  }

  function renderEditor() {
    clearRoot();
    editorOpen = true;
    try { if (storage) storage.set(EDIT_SESSION_KEY, { at: Date.now() }); } catch (e) {}
    leaveHomeLayout();
    if (root && root.classList) root.classList.add('is-editor');

    // 页头收紧（v0.38.0）：旧的「大标题 + 说明 + 快捷键」整整吃掉 217px，
    // 画板是正方形，被这 217px 直接压掉一大截。现在并成一行，快捷键行在触屏隐藏。
    var head = h('div', 'ci-pet-edhead');
    head.appendChild(h('h2', 'ci-pet-edtitle', '拼豆工作台'));
    head.appendChild(h('span', 'ci-pet-edhint', '拖拽连续落豆 · 拼完点「就它了」就是宠物形象'));

    // 画板工具条（尺寸档位 + 豆子质感）并进页头：它原来独自占 50px 高，
    // 而画板是正方形 —— 这 50px 直接等于画板少一格。
    var bar = h('div', 'ci-pet-boardbar ci-pet-edbar');
    var seg = h('div', 'ci-pet-seg');
    SIZES.forEach(function(n) {
      var sb = h('button', 'ci-pet-seg-btn' + (edit.w === n ? ' is-on' : ''), n + '×' + n);
      sb.title = n === 16 ? '小作品，几分钟就能拼完' : (n === 24 ? '中等画板，适合画小动物' : '大画板，适合画完整场景');
      sb.addEventListener('click', function() { resizeEditor(n); });
      seg.appendChild(sb);
    });
    bar.appendChild(seg);
    var zoomBox = h('div', 'ci-pet-zoombox');
    var zoomOut = h('button', 'ci-pet-zoombtn', '−');
    var zoomLabel = h('button', 'ci-pet-zoomlabel', '100%');
    var zoomIn = h('button', 'ci-pet-zoombtn', '+');
    zoomOut.title = '缩小画板';
    zoomIn.title = '放大画板（放大后用「抓手」拖动）';
    zoomLabel.title = '点一下回到适配大小';
    zoomBox.appendChild(zoomOut);
    zoomBox.appendChild(zoomLabel);
    zoomBox.appendChild(zoomIn);
    bar.appendChild(zoomBox);

    function syncZoomUI() {
      var z = (edit && edit.zoom) || 1;
      zoomLabel.textContent = Math.round(z * 100) + '%';
      zoomOut.disabled = z <= ZOOMS[0];
      zoomIn.disabled = z >= ZOOMS[ZOOMS.length - 1];
    }
    function setZoom(z) {
      if (!edit) return;
      var v = editCanvas && editCanvas.parentNode && editCanvas.parentNode.parentNode;
      var cellOld = viewCellCss();
      var cx = 0, cy = 0;
      if (v) {
        cx = (v.scrollLeft + v.clientWidth / 2) / cellOld;
        cy = (v.scrollTop + v.clientHeight / 2) / cellOld;
      }
      edit.zoom = z;
      CELL = computeCell();
      mountEditView();
      syncZoomUI();
      // 缩放后把视口中心留在原来那一格上，不至于跳到角落
      if (v) {
        var cellNew = viewCellCss();
        v.scrollLeft = Math.max(0, cx * cellNew - v.clientWidth / 2);
        v.scrollTop = Math.max(0, cy * cellNew - v.clientHeight / 2);
      }
    }
    zoomOut.addEventListener('click', function() {
      var i = ZOOMS.indexOf(edit.zoom || 1);
      if (i > 0) setZoom(ZOOMS[i - 1]);
    });
    zoomIn.addEventListener('click', function() {
      var i = ZOOMS.indexOf(edit.zoom || 1);
      if (i < ZOOMS.length - 1) setZoom(ZOOMS[i + 1]);
    });
    zoomLabel.addEventListener('click', function() { setZoom(1); });
    zoomSyncFn = syncZoomUI;
    head.appendChild(bar);

    if (state && state.adopted) {
      var backTop = h('button', 'ci-pet-edback', '先不换了');
      backTop.addEventListener('click', function() { exitEditorToHome(); });
      head.appendChild(backTop);
    }
    root.appendChild(head);
    root.appendChild(h('p', 'ci-pet-kbdhint',
      '快捷键：B 画笔 · E 橡皮 · G 油漆桶 · I 吸管 · L 直线 · R 矩形 · M 左右镜像 · Shift+M 上下镜像 · Ctrl+Z 撤销 / Ctrl+S 存作品'));

    var wrap = h('div', 'ci-pet-editor');
    canvasWrapEl = h('div', 'ci-pet-canvaswrap');

    var texBtn = h('button', 'ci-pet-chip' + (edit.bead ? ' is-on' : ''), edit.bead ? '质感' : '像素');
    texBtn.title = '豆子质感：开着像实体拼豆；关掉是纯像素块（导出图纸也会跟着变）';
    texBtn.addEventListener('click', function() {
      edit.bead = !edit.bead;
      try { if (storage) storage.set('beadStyle', edit.bead); } catch (e) {}
      // 质感变了要重建底板与精灵；结构性变化，重挂一次视图即可
      mountEditView();
      scheduleStats(true);
      texBtn.textContent = edit.bead ? '质感' : '像素';
      if (edit.bead) texBtn.classList.add('is-on');
      else texBtn.classList.remove('is-on');
    });
    bar.appendChild(texBtn);

    var gridBtn = h('button', 'ci-pet-chip' + (edit.grid !== false ? ' is-on' : ''), '网格');
    gridBtn.title = '显示 / 隐藏底板网格（导出图纸不受影响）';
    gridBtn.addEventListener('click', function() {
      edit.grid = edit.grid === false;
      try { if (storage) storage.set('gridOn', edit.grid); } catch (e) {}
      mountEditView();
      paintFx();
      if (edit.grid) gridBtn.classList.add('is-on');
      else gridBtn.classList.remove('is-on');
    });
    bar.appendChild(gridBtn);

    // 两层画布：底层豆子（增量重画），上层预览/落点/涟漪
    editStage = h('div', 'ci-pet-boardstage');
    editCanvas = document.createElement('canvas');
    editCanvas.className = 'ci-pet-editcanvas';
    editFx = document.createElement('canvas');
    editFx.className = 'ci-pet-editfx';
    editStage.appendChild(editCanvas);
    editStage.appendChild(editFx);
    var emptyHint = h('div', 'ci-pet-emptyhint');
    emptyHint.appendChild(h('span', 'ci-pet-emptyhint-icon', '✏️'));
    emptyHint.appendChild(h('span', null, '点一下开始拼 · 也可以从云盘导入图片'));
    editStage.appendChild(emptyHint);
    // 视口：放大后画板超出卡片时，靠原生滚动平移（比自绘平移稳，也不和落豆抢手势）
    var boardView = h('div', 'ci-pet-boardview');
    boardView.appendChild(editStage);
    canvasWrapEl.appendChild(boardView);

    var cap = h('div', 'ci-pet-boardcap');
    cap.appendChild(h('span', 'ci-pet-boardcap-tip', '米色小点 = 空豆位 · 拖拽连续落豆'));
    editPosEl = h('span', 'ci-pet-boardpos', '');
    cap.appendChild(editPosEl);
    canvasWrapEl.appendChild(cap);
    wrap.appendChild(canvasWrapEl);

    var tools = h('div', 'ci-pet-tools');
    var toolScroll = h('div', 'ci-pet-toolscroll');

    // 调色盘（整块面板）：宽屏挂在右侧工具列顶部；窄屏（竖屏平板 / 手机）
    // 工具列会落到画板下面，调色盘就跑到首屏之外了 —— 而调色是最高频操作。
    // 这块面板会按断点整体搬一次（见 placePalettePanel），DOM 与监听器都保留。
    var palPanel = h('div', 'ci-pet-palpanel');
    palPanel.appendChild(h('div', 'ci-pet-subhead', '调色盘'));
    editColorLabelEl = h('div', 'ci-pet-curcolor');
    var curDot = h('i', 'ci-pet-curdot');
    editColorLabelEl.appendChild(curDot);
    var curTxt = h('span', 'ci-pet-curtxt', '当前色 ' + beadCode(edit.color) + ' · ' + beadName(edit.color));
    editColorLabelEl.appendChild(curTxt);
    palPanel.appendChild(editColorLabelEl);

    // 最近用过的颜色（换色时不用满盘找）
    var recentRow = h('div', 'ci-pet-recent');
    palPanel.appendChild(recentRow);

    var palBox = h('div', 'ci-pet-palette');
    var swatchEls = [];
    palette.forEach(function(color, idx) {
      var box = h('button', 'ci-pet-swatchbox');
      box.title = beadCode(idx) + ' · ' + beadName(idx);
      var sw = h('span', 'ci-pet-swatch');
      sw.style.background = color;
      box.appendChild(sw);
      box.appendChild(h('span', 'ci-pet-swatch-code', beadCode(idx)));
      box.style.background = 'none';
      box.style.border = 'none';
      box.style.padding = '0';
      box.addEventListener('click', function() { pickColor(idx); });
      box.__idx = idx;
      swatchEls.push(box);
      palBox.appendChild(box);
    });
    palPanel.appendChild(palBox);
    toolScroll.appendChild(palPanel);

    // 横屏平板：编辑区高度钉成「视口高 - 编辑区顶部」，页面不再整页滚；
    // 工具列自己滚（palbar 吸底所以「就它了」永远在手边）。
    function fitEditorHeight() {
      var wide = (window.innerWidth || 1024) >= 900;
      if (!wide) {
        wrap.style.height = '';
        wrap.style.overflow = '';
        tools.style.height = '';
        tools.style.overflow = '';
        return;
      }
      var top = wrap.getBoundingClientRect().top;
      var h = Math.max(320, Math.floor((window.innerHeight || 768) - top - 22));
      wrap.style.height = h + 'px';
      wrap.style.overflow = 'hidden';
      tools.style.height = h + 'px';
      // 滚动只发生在内容区；操作条是兄弟节点，永远不被遮住
      tools.style.overflow = 'hidden';
    }
    window.__ciFitEditor = fitEditorHeight;

    function placePalettePanel() {
      if (!palPanel) return;
      var wide = (window.innerWidth || 1024) >= 900;
      var target = wide ? toolScroll : canvasWrapEl;
      if (palPanel.parentNode !== target) {
        if (wide) target.insertBefore(palPanel, target.firstChild);
        else target.appendChild(palPanel);
      }
      if (wide) palPanel.classList.remove('is-inline');
      else palPanel.classList.add('is-inline');
    }
    window.__ciPlacePalette = placePalettePanel;   // onResize 用
    placePalettePanel();

    // 工具行
    var toolBtnEls = {};
    function toolBtn(parent, text, active, fn, key) {
      var b = h('button', 'ci-pet-btn' + (active ? '' : ' ci-pet-btn--ghost'), text);
      b.addEventListener('click', fn);
      if (key) { b.setAttribute('data-tool', key); toolBtnEls[key] = b; }
      parent.appendChild(b);
      return b;
    }

    function pickColor(idx) {
      if (!edit) return;
      if (edit.tool === 'recolor') {
        // 换色模式第二下：调色盘选的是「目标色」→ 全局替换
        var from = edit.recolorFrom;
        edit.recolorFrom = null;
        edit.tool = 'pen';
        if (from != null && from !== idx) {
          var src = from.toString(16), dst = idx.toString(16);
          snapshot();
          var n = 0, arr = edit.data.split('');
          for (var i = 0; i < arr.length; i++) {
            if (arr[i] === src) { arr[i] = dst; n++; }
          }
          edit.data = arr.join('');
          markAll();
          scheduleStats(true);
          scheduleDraftSave();
          sysToast('已把 ' + beadCode(from) + ' 全换成 ' + beadCode(idx) + '（' + n + ' 颗）', 'success');
        }
        edit.color = idx;
        pushRecentColor(idx);
        syncEditorUI();
        return;
      }
      edit.color = idx;
      pushRecentColor(idx);
      if (edit.tool === 'eraser' || edit.tool === 'eyedropper') edit.tool = 'pen';
      syncEditorUI();
      paintFx();
    }

    function setTool(tool) {
      if (!edit) return;
      edit.tool = tool;
      edit.recolorFrom = null;
      syncEditorUI();
      paintFx();
    }

    // 笔尖粗细：64 格时单格 9px，3×3 才点得动。
    // 和「画笔工具」标题放同一行 —— 单独占一行会把撤销挤到折叠线以下。
    var brushRow = h('div', 'ci-pet-opts ci-pet-brushrow');
    brushRow.appendChild(h('span', 'ci-pet-opts-label', '笔尖'));
    [1, 2, 3].forEach(function(n) {
      var b = h('button', 'ci-pet-chip' + ((edit.brush || 1) === n ? ' is-on' : ''), n + '×' + n);
      b.title = n === 1 ? '单格（画细节）' : (n === 2 ? '2×2' : '3×3（大面积上色）');
      b.addEventListener('click', function() {
        edit.brush = n;
        try { if (storage) storage.set('brushSize', n); } catch (e) {}
        Array.prototype.forEach.call(brushRow.querySelectorAll('.ci-pet-chip'), function(x) {
          x.classList.remove('is-on');
        });
        b.classList.add('is-on');
      });
      brushRow.appendChild(b);
    });
    var toolHead = h('div', 'ci-pet-toolhead');
    toolHead.appendChild(h('div', 'ci-pet-sechead', '画笔工具'));
    toolHead.appendChild(brushRow);
    toolScroll.appendChild(toolHead);

    // 3 列等宽网格：以前是「一行挤 4 个、放不下就掉一个」，看着像排版坏了。
    var toolGrid = h('div', 'ci-pet-toolgrid');
    toolBtn(toolGrid, '画笔', edit.tool === 'pen', function() { setTool('pen'); }, 'pen');
    toolBtn(toolGrid, '橡皮', edit.tool === 'eraser', function() { setTool('eraser'); }, 'eraser');
    toolBtn(toolGrid, '油漆桶', edit.tool === 'fill', function() { setTool('fill'); }, 'fill');
    toolBtn(toolGrid, '吸管', edit.tool === 'eyedropper', function() { setTool('eyedropper'); }, 'eyedropper');
    toolBtn(toolGrid, '直线', edit.tool === 'line', function() { setTool('line'); }, 'line');
    toolBtn(toolGrid, '矩形框', edit.tool === 'rect', function() { setTool('rect'); }, 'rect');
    toolBtn(toolGrid, '抓手', edit.tool === 'pan', function() { setTool('pan'); }, 'pan');
    toolBtn(toolGrid, '左右对称', edit.mirrorX, function() { edit.mirrorX = !edit.mirrorX; syncEditorUI(); }, 'mirrorX');
    toolBtn(toolGrid, '上下对称', edit.mirrorY, function() { edit.mirrorY = !edit.mirrorY; syncEditorUI(); }, 'mirrorY');
    toolScroll.appendChild(toolGrid);

    // 整图操作：翻转 / 平移 / 铺满（拼豆摆到板边时的真实需求）
    toolScroll.appendChild(h('div', 'ci-pet-sechead', '整图'));
    var moveRow = h('div', 'ci-pet-mover');
    function moveBtn(label, title, fn) {
      var b = h('button', 'ci-pet-movebtn', label);
      b.title = title;
      b.addEventListener('click', fn);
      moveRow.appendChild(b);
      return b;
    }
    moveBtn('↔ 翻转', '整幅左右翻转', function() { editorFlip('h'); });
    moveBtn('↕ 翻转', '整幅上下翻转', function() { editorFlip('v'); });
    moveBtn('←', '整幅左移一格（绕回）', function() { editorShift(-1, 0); });
    moveBtn('→', '整幅右移一格（绕回）', function() { editorShift(1, 0); });
    moveBtn('↑', '整幅上移一格（绕回）', function() { editorShift(0, -1); });
    moveBtn('↓', '整幅下移一格（绕回）', function() { editorShift(0, 1); });
    var recolorBtn = h('button', 'ci-pet-movebtn', '换色');
    recolorBtn.title = '点画板取要换掉的色，再点调色盘选新色';
    recolorBtn.addEventListener('click', function() {
      if (!edit) return;
      if (edit.tool === 'recolor') { edit.tool = 'pen'; edit.recolorFrom = null; }
      else { edit.tool = 'recolor'; edit.recolorFrom = null; sysToast('点画板取要换掉的色，再点调色盘选新色', 'info'); }
      syncEditorUI();
      paintFx();
    });
    moveRow.appendChild(recolorBtn);
    var importBtn = h('button', 'ci-pet-movebtn ci-pet-importbtn', '导入图片');
    importBtn.title = '把一张图片转成当前画板的拼豆草稿（居中裁成方形，最接近的 16 色）';
    importBtn.addEventListener('click', openCloudImport);
    moveRow.appendChild(importBtn);
    toolScroll.appendChild(moveRow);

    var row3 = h('div', 'ci-pet-btnrow');
    undoBtnEl = toolBtn(row3, '撤销', false, undoEdit, 'undo');
    redoBtnEl = toolBtn(row3, '重做', false, redoEdit, 'redo');
    toolBtn(row3, '铺满', false, function() {
      if (!edit) return;
      editorFillAll();
      sysToast('整块铺满 ' + beadCode(edit.color) + '（Ctrl+Z 可撤）', 'success');
    }, 'fillall');
    toolBtn(row3, '清空', false, function() {
      if (!edit) return;
      snapshot();
      edit.data = blankGrid(edit.w, edit.h);
      markAll();
      scheduleStats(true);
      scheduleDraftSave();
    }, 'clear');
    toolScroll.appendChild(row3);

    // 预览 + 备料清单
    toolScroll.appendChild(h('div', 'ci-pet-sechead', '预览 & 备料'));
    var meta = h('div', 'ci-pet-meta');
    var pvBox = h('div', 'ci-pet-previewbox');
    editPreviewEl = document.createElement('canvas');
    editPreviewEl.className = 'ci-pet-previewcv';
    pvBox.appendChild(editPreviewEl);
    pvBox.appendChild(h('div', 'ci-pet-previewcap', '桌面预览'));
    meta.appendChild(pvBox);

    var statBox = h('div', 'ci-pet-statbox');
    var statHead = h('div', 'ci-pet-stathead');
    editStatsLineEl = h('div', 'ci-pet-statline', '');
    statHead.appendChild(editStatsLineEl);
    var copyBtn = h('button', 'ci-pet-minibtn', '复制清单');
    copyBtn.title = '复制「色号 + 名称 + 颗数」，买豆子时直接发给店家';
    copyBtn.addEventListener('click', copyBeadList);
    statHead.appendChild(copyBtn);
    statBox.appendChild(statHead);
    editStatsWrapEl = h('div', 'ci-pet-statwrap');
    statBox.appendChild(editStatsWrapEl);
    meta.appendChild(statBox);
    toolScroll.appendChild(meta);

    // 完成行
    var pinbar = h('div', 'ci-pet-pinbar');
    var doneRow = h('div', 'ci-pet-btnrow');
    // 定稿前先把作品落库：手作党拼了半小时，不该因为「忘了点保存」在定稿后消失
    var doneBtn = toolBtn(doneRow, '就它了 →', true, function() {
      if (doneBtn.disabled) return;
      if (!edit) { renderNaming('pixel'); return; }
      if (!beadStats(edit.data).total) {
        sysToast('画板还是空的，先拼几颗豆子再定稿吧', 'info');
        return;
      }
      doneBtn.disabled = true;
      doneBtn.textContent = '保存中…';
      saveCurrentWork({
        then: function(ok) {
          if (!ok) sysToast('作品没能存进作品库，定稿后它仍会成为宠物形象', 'info');
          renderNaming('pixel');
        }
      });
    }, 'done');
    doneBtn.title = '先存进作品库，再用这一幅当宠物形象';
    doneBtn.classList.add('ci-pet-pinprimary');
    var cloudBtn = toolBtn(doneRow, '☁ 云盘', false, exportDesignCloud, 'exportCloud');
    cloudBtn.title = '把图纸（含备料清单）存进云盘';
    var dlBtn = toolBtn(doneRow, '↓ 下载', false, exportDesignPng, 'exportPng');
    dlBtn.title = '下载到本机';
    pinbar.appendChild(doneRow);
    // ⚠️ 这一条必须贴在工具列底部（position: sticky; bottom: 0）：
    //    「就它了」是拼完必点的动作，之前排在 1200px 长列的最末，平板横屏要滑两屏才够得到。
    tools.appendChild(pinbar);

    // 作品库
    var galSec = h('div', 'ci-pet-gallerysec');
    editGalleryHeadEl = h('div', 'ci-pet-sechead', '作品库 · 0 / ' + MAX_DESIGNS);
    galSec.appendChild(editGalleryHeadEl);
    var saveRow = h('div', 'ci-pet-saverow');
    editNameInput = document.createElement('input');
    editNameInput.className = 'ci-pet-input';
    editNameInput.type = 'text';
    editNameInput.maxLength = 16;
    // 载入作品后回填它自己的名字，保存时才知道该覆盖谁
    editNameInput.value = (edit.draftName ||
      (state && state.name ? state.name + '·手作' : '未命名作品')).slice(0, 16);
    editNameInput.addEventListener('input', function() {
      if (edit) edit.draftName = editNameInput.value;
    });
    saveRow.appendChild(editNameInput);
    var saveBtn = h('button', 'ci-pet-btn ci-pet-savebtn', edit.workId ? '保存修改' : '保存当前');
    saveBtn.title = edit.workId ? '覆盖作品库里的这一件' : '存成作品库里新的一件';
    saveBtn.addEventListener('click', function() { saveCurrentWork(); });
    saveRow.appendChild(saveBtn);
    galSec.appendChild(saveRow);
    editGalleryEl = h('div', 'ci-pet-gallery');
    galSec.appendChild(editGalleryEl);
    toolScroll.appendChild(galSec);

    // 顺序必须是「内容区在上、操作条在下」——appendChild 会把 pinbar 顶到最上面
    tools.insertBefore(toolScroll, pinbar);
    wrap.appendChild(tools);
    root.appendChild(wrap);

    // ---- 界面原地同步（不整页重绘）----
    // 旧版切工具/切色都调用 renderEditor()：整棵 DOM 重建、画布重新挂载、滚动位置归零，
    // 平板上一碰调色盘就是一白闪。现在只改 class 和文案。
    function syncEditorUI() {
      if (!edit) return;
      if (editColorLabelEl) {
        var dot = editColorLabelEl.querySelector('.ci-pet-curdot');
        var txt = editColorLabelEl.querySelector('.ci-pet-curtxt');
        if (dot) {
          dot.style.background = palette[edit.color] || '#888';
          dot.style.display = (edit.tool === 'recolor' && edit.recolorFrom != null) ? 'none' : '';
        }
        if (txt) {
          txt.textContent = edit.tool === 'recolor' && edit.recolorFrom != null
            ? ('换色：' + beadCode(edit.recolorFrom) + ' → 点调色盘选新色')
            : ('当前色 ' + beadCode(edit.color) + ' · ' + beadName(edit.color));
        }
      }
      for (var i = 0; i < swatchEls.length; i++) {
        var sw = swatchEls[i].querySelector('.ci-pet-swatch');
        if (sw) {
          if (swatchEls[i].__idx === edit.color) sw.classList.add('ci-pet-swatch--active');
          else sw.classList.remove('ci-pet-swatch--active');
        }
      }
      var active = {};
      active[edit.tool] = true;
      if (editStage) editStage.classList.toggle('is-pan', edit.tool === 'pan');
      if (edit.mirrorX) active.mirrorX = true;
      if (edit.mirrorY) active.mirrorY = true;
      for (var k in toolBtnEls) {
        if (!Object.prototype.hasOwnProperty.call(toolBtnEls, k)) continue;
        var b = toolBtnEls[k];
        var on = !!active[k];
        if (on) b.classList.remove('ci-pet-btn--ghost');
        else b.classList.add('ci-pet-btn--ghost');
        if (k === 'mirrorX') b.textContent = '左右对称';
        else if (k === 'mirrorY') b.textContent = '上下对称';
        else if (k === 'recolor') b.textContent = edit.tool === 'recolor' ? '选源色…' : '换色';
      }
      syncUndoBtns();
      renderRecentColors();
    }

    function renderRecentColors() {
      while (recentRow.firstChild) recentRow.removeChild(recentRow.firstChild);
      if (!edit.recent.length) { recentRow.style.display = 'none'; return; }
      recentRow.style.display = '';
      recentRow.appendChild(h('span', 'ci-pet-recent-label', '常用'));
      edit.recent.forEach(function(idx) {
        var b = h('button', 'ci-pet-recent-dot');
        b.style.background = palette[idx] || '#888';
        b.title = beadCode(idx) + ' · ' + beadName(idx);
        b.addEventListener('click', function() { pickColor(idx); });
        recentRow.appendChild(b);
      });
    }

    // ---- 指针交互（v0.38.0）----
    // 1) 坐标换算只在按下去时量一次 rect（旧版每个 move 都 getBoundingClientRect）
    // 2) pointermove 用 getCoalescedEvents 拿全两帧之间的采样点，快速划线不断豆
    // 3) rAF 合帧重画；统计面板 120ms 节流
    var padRect = null;
    var activePointer = null;
    var panState = null;
    // 双指手势（平板刚需）：单指画，两指缩放/平移。
    // ⚠️ 第二根手指落下时必须立刻停笔：否则两指移动会被当成拖动笔迹，画出一串乱豆。
    var pointers = {};
    var gesture = null;
    var suppressDraw = false;
    var strokeStartAt = 0;   // 这一笔的起笔时刻（双指介入时要撤销它）
    function refreshRect() {
      padRect = editCanvas ? editCanvas.getBoundingClientRect() : null;
    }
    function cellAt(x, y) {
      if (!edit || !padRect || !padRect.width) return null;
      var col = Math.floor((x - padRect.left) / (padRect.width / edit.w));
      var row = Math.floor((y - padRect.top) / (padRect.height / edit.h));
      if (col < 0 || row < 0 || col >= edit.w || row >= edit.h) return null;
      return { col: col, row: row };
    }

    function onDown(e) {
      if (!edit) return;
      pointers[e.pointerId] = { x: e.clientX, y: e.clientY };
      if (Object.keys(pointers).length >= 2) {
        startGesture();
        return;
      }
      if (suppressDraw) return;
      if (activePointer !== null && e.pointerId !== activePointer) return;
      refreshRect();
      var c = cellAt(e.clientX, e.clientY);
      if (!c) return;
      e.preventDefault();
      try { editStage.setPointerCapture(e.pointerId); } catch (err) {}
      activePointer = e.pointerId;
      lastPointerType = e.pointerType || 'mouse';
      showEditPos(c);
      hoverCell = c;
      if (edit.tool === 'eyedropper') {
        var cur = edit.data.charAt(c.row * edit.w + c.col);
        if (cur && cur !== '.') {
          edit.color = parseInt(cur, 16);
          edit.tool = 'pen';
          pushRecentColor(edit.color);
          syncEditorUI();
          addRipple(c.col, c.row);
          sysToast('已取色 ' + beadCode(edit.color) + ' · ' + beadName(edit.color), 'success');
        } else {
          sysToast('这里是空位，没有可吸的色号', 'info');
        }
        activePointer = null;
        return;
      }
      if (edit.tool === 'recolor') {
        var s = edit.data.charAt(c.row * edit.w + c.col);
        if (!s || s === '.') { sysToast('这里是空位，先点一颗有颜色的豆子', 'info'); activePointer = null; return; }
        edit.recolorFrom = parseInt(s, 16);
        edit.color = edit.recolorFrom;
        syncEditorUI();
        addRipple(c.col, c.row);
        return;
      }
      if (edit.tool === 'pan') {
        var vp = editCanvas.parentNode && editCanvas.parentNode.parentNode;
        panState = vp ? { x: e.clientX, y: e.clientY, sl: vp.scrollLeft, st: vp.scrollTop, el: vp } : null;
        return;
      }
      var ch = edit.tool === 'eraser' ? '.' : edit.color.toString(16);
      if (edit.tool === 'fill') {
        snapshot();
        floodFill(c.col, c.row, ch);
        markAll();
        scheduleStats(true);
        scheduleDraftSave();
        activePointer = null;
        return;
      }
      snapshot();
      strokeStartAt = Date.now();
      edit.painting = true;
      edit.last = c;
      if (edit.tool === 'line' || edit.tool === 'rect') {
        previewGeom(edit.tool, c.col, c.row, c.col, c.row, edit.tool === 'eraser' ? -1 : edit.color);
        return;
      }
      applyAt(c.col, c.row, ch);
      addRipple(c.col, c.row);
      scheduleStats();
    }

    function onMove(e) {
      if (!edit) return;
      if (pointers[e.pointerId]) {
        pointers[e.pointerId].x = e.clientX;
        pointers[e.pointerId].y = e.clientY;
      }
      if (gesture) { handleGesture(); return; }
      if (suppressDraw) return;
      if (panState) {
        panState.el.scrollLeft = panState.sl - (e.clientX - panState.x);
        panState.el.scrollTop = panState.st - (e.clientY - panState.y);
        return;
      }
      if (!padRect) refreshRect();
      var list = (e.getCoalescedEvents && e.getCoalescedEvents().length) ? e.getCoalescedEvents() : [e];
      var last = null;
      for (var i = 0; i < list.length; i++) {
        var c = cellAt(list[i].clientX, list[i].clientY);
        if (c) last = c;
      }
      if (!last) return;
      showEditPos(last);
      if (hoverCell !== last) { hoverCell = last; if (!edit.painting) paintFx(); }
      if (!edit.painting || e.pointerId !== activePointer) return;
      if (edit.drag) {
        if (edit.drag.x2 !== last.col || edit.drag.y2 !== last.row) {
          previewGeom(edit.drag.tool, edit.drag.x, edit.drag.y, last.col, last.row, edit.drag.colorIdx >= 0 ? edit.drag.colorIdx : -1);
        }
        return;
      }
      if (edit.tool !== 'pen' && edit.tool !== 'eraser') return;
      var ch = edit.tool === 'eraser' ? '.' : edit.color.toString(16);
      var prev = edit.last || last;
      if (prev.col === last.col && prev.row === last.row) return;
      strokeLine(prev.col, prev.row, last.col, last.row, ch);
      edit.last = last;
      scheduleStats();
    }

    function onUp(e) {
      if (!edit) return;
      if (e && pointers[e.pointerId]) delete pointers[e.pointerId];
      if (gesture) {
        if (Object.keys(pointers).length < 2) {
          gesture = null;
          // 手指全部离开前不再落豆：否则松手时残留的那根手指会画一笔
          if (!Object.keys(pointers).length) suppressDraw = false;
        }
        return;
      }
      if (panState) { panState = null; activePointer = null; suppressDraw = false; return; }
      if (edit.drag) {
        commitGeom();
        scheduleStats(true);
        scheduleDraftSave();
        edit.painting = false;
        edit.last = null;
        activePointer = null;
        return;
      }
      if (edit.painting) {
        scheduleStats(true);
        scheduleDraftSave();
      }
      edit.painting = false;
      edit.last = null;
      activePointer = null;
    }

    // 调试/探针钩子：编辑器内部状态（落豆为什么没发生，靠它一眼看出来）
    window.__ciBeadState = function() {
      return {
        painting: !!(edit && edit.painting),
        tool: edit && edit.tool,
        color: edit && edit.color,
        pointer: activePointer,
        last: edit && edit.last,
        hover: hoverCell,
        suppress: suppressDraw,
        pointers: Object.keys(pointers || {}).length,
        view: !!editView,
        rect: padRect ? { l: Math.round(padRect.left), t: Math.round(padRect.top), w: Math.round(padRect.width), h: Math.round(padRect.height) } : null,
        data: edit ? edit.data : null,
        perf: { paintAvg: perf.paintN ? +(perf.paintMs / perf.paintN).toFixed(2) : 0,
                paintMax: +perf.paintMax.toFixed(2), paintN: perf.paintN,
                latencyMax: +perf.latencyMax.toFixed(1) },
        probe: function(x, y) { return cellAt(x, y); }
      };
    };
    // ---- 双指：距离比触发换档，中点位移做平移 ----
    function gestureState() {
      var ids = Object.keys(pointers);
      var a = pointers[ids[0]], b = pointers[ids[1]];
      var dx = a.x - b.x, dy = a.y - b.y;
      return {
        dist: Math.sqrt(dx * dx + dy * dy) || 1,
        cx: (a.x + b.x) / 2,
        cy: (a.y + b.y) / 2
      };
    }
    function viewEl() {
      return (editCanvas && editCanvas.parentNode && editCanvas.parentNode.parentNode) || null;
    }
    function startGesture() {
      var st = gestureState();
      // 双指的第一根手指会先落一颗豆（手指不可能同时到）。这不是用户想要的，
      // 所以：如果这一笔刚起手（<500ms），把这次落笔整个撤掉，再进入手势。
      if (edit.painting && strokeStartAt && Date.now() - strokeStartAt < 500 && undoStack.length) {
        var s0 = undoStack.pop();
        applySnapshot(s0);
        redoStack = [];    // 误点的豆子不该还能「重做」回来
        scheduleDraftSave();
      }
      strokeStartAt = 0;
      // 停笔：已经落下的豆保留（撤销可回退），但不再继续画
      edit.painting = false;
      edit.last = null;
      edit.drag = null;
      edit.previewPts = null;
      panState = null;
      activePointer = null;
      suppressDraw = true;
      gesture = { dist: st.dist, cx: st.cx, cy: st.cy };
      paintFx();
    }
    function handleGesture() {
      if (!gesture) return;
      var st = gestureState();
      var v = viewEl();
      if (v) {
        v.scrollLeft -= (st.cx - gesture.cx);
        v.scrollTop -= (st.cy - gesture.cy);
      }
      var ratio = st.dist / gesture.dist;
      var z = edit.zoom || 1;
      var idx = ZOOMS.indexOf(z);
      if (idx < 0) idx = 0;
      if (ratio > 1.7 && idx < ZOOMS.length - 1) {
        setZoom(ZOOMS[idx + 1]);
        gesture.dist = st.dist;
        gesture.cx = st.cx;
        gesture.cy = st.cy;
      } else if (ratio < 0.6 && idx > 0) {
        setZoom(ZOOMS[idx - 1]);
        gesture.dist = st.dist;
        gesture.cx = st.cx;
        gesture.cy = st.cy;
      } else {
        gesture.cx = st.cx;
        gesture.cy = st.cy;
      }
    }

    editStage.addEventListener('pointerdown', onDown);
    editStage.addEventListener('pointermove', onMove);
    editStage.addEventListener('pointerup', onUp);
    editStage.addEventListener('pointercancel', onUp);
    // 手指全离开时清空：否则残留坐标会让下一次单指操作被判成双指
    function clearPointers() {
      pointers = {};
      gesture = null;
      suppressDraw = false;
    }
    if (editorGestureCleanup) {
      window.removeEventListener('pointerup', editorGestureCleanup);
      window.removeEventListener('pointercancel', editorGestureCleanup);
    }
    editorGestureCleanup = clearPointers;
    window.addEventListener('pointerup', clearPointers);
    window.addEventListener('pointercancel', clearPointers);
    editStage.addEventListener('pointerleave', function() {
      hoverCell = null;
      showEditPos(null);
      if (!edit || !edit.painting) paintFx();
    });
    // 长按不弹系统菜单；双指缩放交给浏览器但不动画板
    editStage.addEventListener('contextmenu', function(e) { e.preventDefault(); });

    // 挂上 DOM 之后才量得到真实可用面积：宽屏时工具列已经把宽度分走了
    fitEditorHeight();
    CELL = computeCell();
    mountEditView();
    syncZoomUI();
    syncEditorUI();
    scheduleStats(true);
    renderGallery();
  }

  // ================= 起名 / 定形象 =================
  // kind: 'video' 大肥鱼 | 'pixel' 手作拼豆 | 缺省按是否有草稿判定（向后兼容）
  // ⚠️ 必须显式传：模块级 edit 是跨页面常驻的，靠它"猜"会让「改名字」把上次
  //    编辑器里的草稿当成 design 提交（真实现象：改个名字，宠物形象被换掉）。
  function renderNaming(kind) {
    clearEditSession();
    clearRoot();
    leaveHomeLayout();
    var isPixelNaming = kind === 'pixel' ? true : (kind === 'video' ? false : !!(edit && edit.data));
    var existingName = (state && state.name) || '';
    root.appendChild(h('h2', null, existingName ? '改个名字' : '给它起个名字'));
    var preview = document.createElement('canvas');
    if (isPixelNaming) {
      // 预览按当前画板尺寸自适应：16/24/32 都固定 96px 见方，不写死 16 格
      paint(preview, editDesign(), 96 / edit.w);
    } else {
      var whaleCard = h('div', 'ci-pet-tpl-emoji', '🐳');
      whaleCard.style.cssText = 'font-size:64px;width:96px;height:96px;display:flex;align-items:center;justify-content:center;';
      preview = whaleCard;
    }
    var card = h('div', 'ci-pet-card');
    card.appendChild(preview);
    var info = h('div', 'ci-pet-card-info');
    var input = h('input', 'ci-pet-input');
    input.type = 'text';
    input.maxLength = 12;
    input.placeholder = '最多 12 个字';
    if (existingName) input.value = existingName;
    info.appendChild(input);
    var row = h('div', 'ci-pet-btnrow');
    var save = h('button', 'ci-pet-btn', isPixelNaming ? (existingName ? '保存造型与名字' : '领养它！') : (existingName ? '换成大肥鱼' : '领养大肥鱼！'));
    row.appendChild(save);
    if (existingName) {
      var cancel = h('button', 'ci-pet-btn ci-pet-btn--ghost', '取消');
      cancel.addEventListener('click', function() { renderHome(); });
      row.appendChild(cancel);
    }
    info.appendChild(row);
    card.appendChild(info);
    root.appendChild(card);

    save.addEventListener('click', function() {
      var name = input.value.trim();
      if (!name) { input.focus(); return; }
      save.disabled = true;
      save.textContent = '保存中…';
      var payload = { adopt: true, name: name };
      if (isPixelNaming) payload.design = editDesign();   // 尺寸跟随当前画板，不再写死 16×16
      else payload.design = { type: 'video', character: 'dsh-whale' }; // 显式覆盖：从手作切回大肥鱼
      api.put('/pet/state', payload).then(function(res) {
        state = (res.data && res.data.data && res.data.data.state) || state;
        edit = null;  // 草稿用完即弃，别让它在后续「改名字」里复活
        try { if (storage) storage.set(DRAFT_KEY, null); } catch (e) {}   // 已定稿，草稿可以清了
        notifyChanged();
        renderHome();
      }).catch(function(err) {
        save.disabled = false;
        save.textContent = isPixelNaming ? '领养它！' : '领养大肥鱼！';
        if (context && context.system && context.system.toast) {
          context.system.toast({ message: '保存失败：' + ((err && err.response && err.response.data && err.response.data.message) || '请重试'), type: 'error' });
        }
      });
    });
    setTimeout(function() { input.focus(); }, 60);
  }

  // ================= 状态推导（纯前端，不加后端字段）=================
  var TIER = [0, 20, 60, 120, 200];
  var TIER_NAMES = ['初识', '熟悉', '亲密', '形影不离', '灵魂伙伴'];
  function tierOf(b) { var t = 0; for (var i = 0; i < TIER.length; i++) { if (b >= TIER[i]) t = i; } return t; }

  // ⚠️ 2026-10-26 重写：旧版是「距上次喂食 4 小时线性衰减」，而后端判定是
  //    「每日 3 次上限 + 20 分钟冷却」（backend/routes.js INTERACT_RULES）。
  //    两套模型必然脱节 —— 早上喂满 3 次后，UI 到下午显示"有点饿"，
  //    但后端按次数拒绝，数值纹丝不动（实测连喂 4 次全部 gained=0）。
  //    现在以「今日已喂次数」为准画条，UI 说饿 = 真的还能喂。
  var FEED_DAILY_CAP = 3;

  // ---- 专注陪伴（v0.11.0）----
  // 专注是持久状态：用户可能中途切到别的页面、或把平板放着不管，
  // 所以「还剩多久」不能挂在 DOM 上，必须挂在模块级变量里，重绘后按 endAt 复原。
  // ⚠️ 别把它写进 state（服务端存档）—— 那是「上次结算的结果」，
  //    而计时器是「这一次正在进行」，两者混在一起会让刷新页面后出现幽灵倒计时。
  var FOCUS_ALLOWED = [15, 25, 45];
  var FOCUS_COIN_COST = 5;      // 与后端 FEAST_COST 对齐
  var FEAST_GAIN = 10;
  var focus = { active: false, endAt: 0, minutes: 0, timer: null, picking: false };
  var diaryInfo = null;         // /state 下发的日记视图
  var focusInfo = null;         // /state 下发的专注额度
  var dailyBonusInfo = null;    // /state 下发的每日登录奖励（v0.15.0）
  var offlineRecapInfo = null;  // /state 下发的离线时光 recap（v0.16.0）
  var wonderInfo = null;        // /state 下发的每日奇遇（v0.16.0）
  var autonomyInfo = null;      // /state 下发的自主行为（v0.17.0）
  var questInfo = null;         // /state 下发的今日任务（v0.10.0）
  var interactCombo = 0;
  var interactComboTimer = null;
  var interactComboLastAt = 0;

  function bumpInteractCombo() {
    var now = Date.now();
    if (now - interactComboLastAt > 8000) interactCombo = 0;
    interactCombo++;
    interactComboLastAt = now;
    if (interactComboTimer) { clearTimeout(interactComboTimer); interactComboTimer = null; }
    // ⚠️ 这里原来每点一次都 renderHome()。后果是：一次点击 = clearRoot + 重建整间屋子，
    //    于是「按下的 3px」「回弹」「角色刚走出的半步」全部在下一帧被抹掉，
    //    角色还会瞬移回初始位置（42%）。点得越勤，屋子闪得越厉害 ——
    //    这是全场最伤手感的一处，而且它伪装成「连击提示」躲在计数逻辑里。
    //    连击只在 3/5/7/10 次弹一条提示，没有任何常驻 UI 依赖重绘。
    interactComboTimer = setTimeout(function() { interactCombo = 0; }, 9000);
    if (interactCombo === 3 || interactCombo === 5 || interactCombo === 7 || interactCombo === 10) {
      try { sysToast('连击 x' + interactCombo + '！', 'success'); } catch (e) {}
      try { if (window.__ciPetSfx) window.__ciPetSfx.play('click'); } catch (e) {}
      // 连击浮字挂在「角色身上」（小家没有 .ci-pet-hero，原来这条在首页永远不显示）
      var anchor = root ? (root.querySelector('.world-pet') || root.querySelector('.ci-pet-hero')) : null;
      if (anchor) {
        var el = h('span', 'ci-pet-combo-float', '连击 x' + interactCombo + '!');
        anchor.appendChild(el);
        setTimeout(function() { if (el.parentNode) el.parentNode.removeChild(el); }, 1400);
      }
    }
  }

  function focusLeftSec() {
    if (!focus.active) return 0;
    return Math.max(0, Math.round((focus.endAt - Date.now()) / 1000));
  }
  function fmtMmSs(sec) {
    var m = Math.floor(sec / 60), s = sec % 60;
    return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
  }
  function coinCount() { return (state && state.coins) || 0; }
  function focusTodayMin() { return (state && state.focus_min) || 0; }

  // 专注结束（正常到点 / 提前收工）统一走这里。
  // ⚠️ 必须先停 timer 再请求：请求回调里会 renderHome，如果 timer 还活着，
  //    会在新 DOM 上继续跑，第二次结算同一轮。
  function finishFocus(completed) {
    if (!focus.active) return;
    var planned = focus.minutes;
    var total = planned * 60;
    var left = focusLeftSec();
    var elapsed = Math.max(0, total - left);
    stopFocusTimer();
    focus.active = false;
    focus.picking = false;
    var wantDone = completed === true && left <= 15;
    try {
      window.dispatchEvent(new CustomEvent('ci-pet-focus-end', { detail: { done: wantDone } }));
    } catch (e) {}
    api.post('/pet/focus', { minutes: planned, elapsedSec: elapsed, done: wantDone })
      .then(function(res) {
        var d = (res.data && res.data.data) || {};
        state = d.state || state;
        if (d.tooShort) {
          sysToast('这次不到 1 分钟，先不给小鱼干哦', 'info');
        } else {
          var msg = '专注 ' + Math.round(elapsed / 60) + ' 分钟 · 小鱼干 +' + (d.coinsGain || 0);
          if (d.bondGain > 0) msg += ' · 羁绊 +' + d.bondGain;
          sysToast(msg, 'success');
        }
        if (d.tierUp) { setTimeout(function() { sysToast('羁绊升级了！', 'success'); }, 400); try { window.dispatchEvent(new CustomEvent('ci-pet-tierup')); } catch (e) {} }
        if (d.capped) setTimeout(function() { sysToast('今天专注给的羁绊到顶啦，小鱼干照拿', 'info'); }, 400);
        renderHome();
      }, function(err) {
        var m = (err && err.response && err.response.data && err.response.data.message) || '结算失败';
        sysToast(m, 'error');
        renderHome();
      });
  }

  function stopFocusTimer() {
    if (focus.timer) {
      clearInterval(focus.timer);
      focus.timer = null;
    }
  }

  function startFocus(minutes) {
    if (focus.active) return;
    focus.active = true;
    focus.picking = false;
    focus.minutes = minutes;
    focus.endAt = Date.now() + minutes * 60 * 1000;
    try {
      window.dispatchEvent(new CustomEvent('ci-pet-focus-start', { detail: { minutes: minutes } }));
    } catch (e) {}
    // 只重绘一次把按钮切成「专注中」，之后每 500ms 只改文本，不重绘整页
    renderHome();
    armFocusTimer();
  }

  // 计时器与「专注是否进行中」解耦：
  // 离开页面时 timer 会被清掉（否则 root 已置空还会往里写），但 focus.active/endAt 保留；
  // 回到页面时按剩余时间恢复，或者发现已经超时就直接补结算。
  // 这样「切出去看一眼别的应用」不会把一轮 25 分钟作废。
  function armFocusTimer() {
    stopFocusTimer();
    focus.timer = setInterval(function() {
      var btn = root && root.querySelector('.ci-pet-focusbtn');
      var left = focusLeftSec();
      if (btn) {
        var sub = btn.querySelector('.ci-pet-bigbtn-sub');
        var label = btn.querySelector('.ci-pet-bigbtn-label');
        if (label) label.textContent = '专注中 ' + fmtMmSs(left);
        if (sub) sub.textContent = '点一下提前收工';
      }
      if (left <= 0) {
        finishFocus(true);
        return;
      }
      // 页面被切走时 interval 可能被节流到 1s 一次，但 endAt 是绝对时间，
      // 到点总能算出 left<=0 并结算，不会「越切越慢」。
    }, 500);
  }


  function fedCount() { return (state && state.fed_today) || 0; }
  function canFeed() { return fedCount() < FEED_DAILY_CAP; }

  // 饱食度条：今日已吃份数占比（0/3 = 空着肚子 → 喂满 3/3 = 100% 吃饱）。
  // ⚠️ 2026-10-27 修：原实现算的是「剩余可喂份数」，于是喂一次 100%→67%、喂满 0%，
  //    越吃越"饿"，与用户直觉完全相反（用户实报"饱食度越喂越少"）。
  //    饱食度必须随进食单调递增；"还能吃几顿"是另一件事，放在脚注里说（见 fedNote）。

  // 冷却剩余分钟数（用于按钮副标题的真实原因提示）
  function feedCooldownMin() {
    var t = state && state.last_fed_at ? new Date(state.last_fed_at).getTime() : 0;
    if (!t) return 0;
    var left = 20 * 60 * 1000 - (Date.now() - t);
    return left > 0 ? Math.ceil(left / 60000) : 0;
  }
  function todayInteracts() {
    return state ? (state.poked_today || 0) + (state.fed_today || 0) : 0;
  }
  // 喂食按钮副标题：把「为什么点不动」写在按钮上，而不是等用户点了才发现
  function feedBtnSub() {
    if (canFeed()) {
      var cd = feedCooldownMin();
      return cd > 0 ? ('歇 ' + cd + ' 分钟') : '+4 羁绊';
    }
    return '今天吃饱啦';
  }
  // 摸摸按钮副标题：把「今日已摸 n/10」写在按钮上，撞上限之前就看得到

  function petMood() {
    if (!state) return { emoji: '🐚', text: '…' };
    if (state.enabled === false) return { emoji: '💤', text: '正在桌面上休息' };
    var n = todayInteracts();
    if (n === 0) return { emoji: '😢', text: '今天还没被摸过，有点想你' };
    if (fedCount() === 0) return { emoji: '🍚', text: '今天还没吃饭呢…' };
    if (!canFeed()) return { emoji: '😋', text: '今天吃饱啦，明天再来' };
    if (feedCooldownMin() > 0) return { emoji: '😌', text: '肚皮圆滚滚，歇 ' + feedCooldownMin() + ' 分钟～' };
    return { emoji: '😊', text: '乖乖待在桌面上等你' };
  }

  // 它此刻的台词。优先级：心情（现在） > 性格（一直） > 旧版兜底。
  // 两者都要有，因为「心情」回答的是「它现在怎么样」，
  // 「性格」回答的是「它是个什么样的家伙」—— 只给一个，宠物就是一张贴纸。

  // 气泡轮播：每 9 秒换一句。这是「页面上有个活物」最便宜的实现 ——
  // 比多画几帧动画便宜得多，但玩家的感受是一样的：它会自己动心思。
  var bubbleTimer = null;
  function stopBubble() {
    if (bubbleTimer) { clearInterval(bubbleTimer); bubbleTimer = null; }
  }

  // 互动收益的飘字。它必须挂在 .ci-pet-hero 上（hero 是唯一的 position:relative），
  // 挂到 .ci-pethome 上的话会随页面滚动跑掉。
  function flashGain(n, crit) {
    if (!root || !(n > 0)) return;
    var hero = root.querySelector('.ci-pet-hero');
    if (!hero) return;
    var el = h('span', 'ci-pet-float' + (crit ? ' is-crit' : ''), (crit ? '大成功 +' : '+') + n);
    hero.appendChild(el);
    setTimeout(function() { if (el.parentNode) el.parentNode.removeChild(el); }, 1500);
  }

  // hero 区的活预览：从动画池挑一个待机动作循环播（池拉不到就用固定名）
  var heroPool = null;
  function heroIdleName() {
    return (heroPool && heroPool.idle && heroPool.idle.length) ? heroPool.idle[0] : '待机呼吸休闲';
  }
  function loadHeroPool() {
    if (heroPool) return;
    try {
      fetch('/market-static/pet/assets/anim-pools.json').then(function(r) { return r.json(); }).then(function(j) {
        heroPool = j;
        var v = root && root.querySelector('.ci-pet-hero-video');
        if (v && !v.getAttribute('src')) v.src = poolUrl(heroIdleName());
      }).catch(function() {});
    } catch (e) {}
  }
  function poolUrl(name) {
    return '/market-static/pet/assets/webm/' + encodeURIComponent(name) + '.webm';
  }

  // 小构件：状态条 / 大按钮 / 分区标题
  // 状态条：label 居左 / 数值居右，脚注单独一行（旧版把三样挤在一行，信息糊成一团）
  // valueText：右侧显示的文本。不传才落到「档位百分比」。
  // ⚠️ 2026-10-27 修：羁绊条原来右侧固定显示 "37%"（档位进度），而脚注写「还差 38」。
  //    用户把「还差 38」当成了羁绊值，摸一次（羁绊 +1）脚注 38 → 37，观感就是
  //    「摸一下羁绊掉了 1」（实报 38 摸到 37）。现在羁绊条右侧直接显示绝对值，
  //    进度百分比只负责条的宽度，脚注改成 "82 / 120" 这种只增不减的写法。
  // variant: 'primary' = 当日主行动（喂食），视觉上给出明确的主次差异
  // ⚠️ v0.14.0：图标从 emoji 换成内联 SVG。
  //    emoji 在深色底上等于「每台设备一套配色」——🍎 是红的、📣 是黄的、⏳ 是褐的，
  //    四个按钮四种色，整排看过去是杂色。线性图标用 currentColor 描边，
  //    颜色由 CSS 决定，才可能做到「一套语言」。
  function sectionTitle(text) {
    return h('div', 'ci-pet-section', text);
  }

  // ================= 换形象（共用）=================
  // 手作稿存档：从"拼豆 → 大肥鱼"时留一份，之后「换成手作拼豆」能原样换回去
  function savePixelDraft() {
    try {
      if (storage && state && state.design && state.design.type !== 'video') {
        storage.set('lastPixel', state.design);
      }
    } catch (e) {}
  }

  // 只换 design，名字/羁绊/开关全部保留（切换前后都通知悬浮层按新形态重建）
  function switchDesign(design, btn, label) {
    if (!api || !design) return;
    if (btn) { btn.disabled = true; btn.textContent = '切换中…'; }
    api.put('/pet/state', { design: design }).then(function(res) {
      state = (res.data && res.data.data && res.data.data.state) || state;
      notifyChanged();
      renderHome();
    }).catch(function(err) {
      if (btn) { btn.disabled = false; btn.textContent = label || '换形象'; }
      if (context && context.system && context.system.toast) {
        context.system.toast({
          message: '切换失败：' + ((err && err.response && err.response.data && err.response.data.message) || '请重试'),
          type: 'error'
        });
      }
    });
  }

  // ================= 今日面板（v0.19.0 游戏化重做）====================
  // 旧版首页把「天气 / 签到 / 奇遇 / 离线 / 自主 / 心愿 / 故事」七块各画成一张独立卡片，
  // 从上到下堆成一条长龙 —— 读起来是仪表盘，不是游戏。
  //
  // 现在改成一条「今日轨道」：横向滚动的关卡卡，每张卡是一个可点的事件。
  // 横向是刻意的 —— 一屏能同时看到三件事，而不是只能一屏一件。
  // 没有内容的卡不画（跟旧版一样：拿不到就整块不出现）。

  // 今日卡片的「领取」动作：签到走 daily，奇遇走 wonder。
  // 两者都是服务端裁决（今天没领过才给），前端只负责把结果画回去。

  // ================= 冒险关卡卡（v0.19.0）====================
  // 旧版是三行「图标 + 文字 + ›」的列表 —— 那也是报表语法。
  // 现在改成三张并列的关卡卡：每张有自己的图标底、进度、以及一个「进入」动作。
  // 竖排长龙 → 横向关卡，是这次重做最能一眼看出「这是游戏」的一步。

  // ================= 我的宠物 =================
  function buildDiag() {
    var lines = [];
    lines.push('1 服务端状态: ' + (state && state.adopted ? '已领养（' + (state.name || '') + '，显示开关=' + (state.enabled !== false ? '开' : '关') + '）' : '未领养'));
    var host = window.ClassIntraMarket;
    lines.push('2 宿主SDK: ' + (host ? '在' : '缺失'));
    lines.push('3 悬浮脚本已注册: ' + (typeof window.__ciPetDebug === 'function' ? '是' : '否（悬浮脚本未加载/未执行）'));
    if (typeof window.__ciPetDebug === 'function') {
      try {
        var d = window.__ciPetDebug();
        lines.push('4 桌宠DOM: ' + (d.domMounted ? '在桌面上（位置 ' + d.pos.x + ',' + d.pos.y + '）' : '未创建（状态 adopted=' + d.adopted + ' enabled=' + d.enabled + '）'));
        lines.push('5 画布: ' + (d.hasCanvas ? '正常' : '缺失'));
        lines.push('6 行为模式: ' + (d.mode || '?') + ' · 羁绊档: ' + (d.bondTier === undefined ? '?' : d.bondTier) + ' · 被销毁次数: ' + (d.kills === undefined ? '?' : d.kills));
        if (d.lastError) lines.push('!! 最近异常: ' + d.lastError);
      } catch (e) {
        lines.push('4 诊断异常: ' + e.message);
      }
    }
    return lines.join('\n');
  }

  // ---- 等级：HUD 与 hero 都要显示，合并成一次请求 ----
  // 之前只有 hero 里那块 Lv 徽章会去拉 /level/info。加了顶部 HUD 之后如果各自拉一次，
  // 每进一次页面就是两个请求；这里做一次广播，谁先挂上谁登记，值回填给所有人。
  var levelValue = null;
  var levelQueue = [];
  function bindLevel(el) {
    if (!el) return;
    if (levelValue !== null) { el.textContent = levelValue; return; }
    levelQueue.push(el);
    if (levelQueue.length > 1 || !api) return;
    api.get('/level/info').then(function(res) {
      var d = (res.data && res.data.data) || {};
      levelValue = 'Lv ' + (d.level || 0);
      flushLevel();
    }, function() { levelValue = 'Lv ?'; flushLevel(); });
  }
  function flushLevel() {
    for (var i = 0; i < levelQueue.length; i++) levelQueue[i].textContent = levelValue;
    levelQueue = [];
  }

  // ---- 舞台右上角 HUD（v0.14.0）----
  // 游戏主界面从不让玩家点进二级页面才知道自己有多少资源。
  // 战力 / 属性 / 小鱼干三样常驻在场景右上角，一眼可见。

  // ---- 顶部 HUD（v0.9.0 游戏化）----
  // 像游戏状态栏一样常驻：头像（进化形态）+ 名字 + 等级 / 羁绊，右侧战力与属性。
  // 每一页都画，因为「我现在多强、什么属性」是对战/图鉴/排行都要看的前提。
  function gameHud() {
    var tier = tierOf((state && state.bond) || 0);
    var evo = (battle && battle.evolution) || evolutionInfo;
    var hud = h('div', 'ci-pet-hud');

    var avatar = h('div', 'ci-pet-hud-avatar');
    avatar.appendChild(h('span', 'ci-pet-hud-evo', (evo && evo.icon) || '🌱'));
    hud.appendChild(avatar);

    var who = h('div', 'ci-pet-hud-who');
    var nameRow = h('div', 'ci-pet-hud-name-row');
    nameRow.appendChild(h('span', 'ci-pet-hud-name', (state && state.name) || '小家伙'));
    var lv = h('span', 'ci-pet-hud-lv', 'Lv ·');
    nameRow.appendChild(lv);
    bindLevel(lv);
    who.appendChild(nameRow);
    who.appendChild(h('div', 'ci-pet-hud-sub', TIER_NAMES[tier] + ' · 羁绊 ' + ((state && state.bond) || 0)));
    hud.appendChild(who);

    var chips = h('div', 'ci-pet-hud-chips');
    // v0.25.0：em（⚔️ / 🌿）换成 12×12 像素图标 —— 见 PIX_ICONS 的注释。
    // 数值由 fillHud 单独写入，所以这里只铺骨架，图标不会被 textContent 抹掉。
    var pow = h('span', 'ci-pet-hud-power');
    pow.setAttribute('data-hud', 'power');
    setIconText(pow, 'sword', '—');
    chips.appendChild(pow);
    var ty = h('span', 'ci-pet-hud-type');
    ty.setAttribute('data-hud', 'type');
    setIconText(ty, 'grass', '草');
    chips.appendChild(ty);
    hud.appendChild(chips);

    fillHud();
    return hud;
  }

  // 档案是异步来的：HUD 上的战力 / 属性 / 进化图标到手后原地补，
  // 不整页重绘（重绘会把正在播的宠物视频重新起一遍）。
  function fillHud() {
    if (!root) return;
    // v0.14.0：战力/属性现在有两个落点（内页顶栏、首页舞台右上角），
    // 所以按 data-hud 全量查，不再限定在 .ci-pet-hud 里面。
    var c = battle && battle.combat;
    var powEls = root.querySelectorAll('[data-hud="power"]');
    for (var pi = 0; pi < powEls.length; pi++) {
      // 图标是子节点，只能改数字 —— 写 textContent 会把整个图标抹掉（HUD 变「—」）
      setIconText(powEls[pi], 'sword', c ? String(c.power || 0) : '—');
    }
    var info = (battle && battle.typeInfo) || elementOf((battle && battle.battleType) || 'grass');
    var tyEls = root.querySelectorAll('[data-hud="type"]');
    for (var ti = 0; ti < tyEls.length; ti++) {
      var el = tyEls[ti];
      // 保留元素自己的类（舞台版还有自己的尺寸类），只换属性配色那一段
      el.className = String(el.className || '')
        .replace(/\s*ci-pet-el--[a-z]+/g, '') + ' ci-pet-el--' + info.id;
      setIconText(el, info.id, info.name);
    }
    var sub = root.querySelector('.ci-pet-hud-sub');
    if (sub) {
      var b = (state && state.bond) || 0;
      sub.textContent = TIER_NAMES[tierOf(b)] + ' · 羁绊 ' + b;
    }
    var evoEl = root.querySelector('.ci-pet-hud-evo');
    var e = (battle && battle.evolution) || evolutionInfo;
    if (evoEl && e) evoEl.textContent = e.icon || '🌱';
  }

  // ================= 页面分区（v0.8.0）====================
  // 之前「对战」被埋在宠物屋最底部：想打一场要先滚过形象、设置，
  // 而「图鉴/排行」根本没有位置。分区之后每个页只回答一个问题：
  //   小家 = 它今天怎么样；对战 = 今天打谁；图鉴 = 我收集了什么；排行 = 我在班里第几。
  function tabBadgeCount(id) {
    if (!battle) return 0;
    if (id === 'battle') return (battle.inbox || []).length;
    if (id === 'dex') {
      var d = battle.dex || {};
      return Math.max(0, (d.total || 0) - (d.ownedCount || 0));
    }
    return 0;
  }
  function refreshTabBadges() {
    var tabs = root ? root.querySelectorAll('.ci-pet-tab') : [];
    for (var i = 0; i < tabs.length; i++) {
      var id = tabs[i].getAttribute('data-tab');
      var old = tabs[i].querySelector('.ci-pet-tab-badge');
      if (old) tabs[i].removeChild(old);
      var n = tabBadgeCount(id);
      if (n > 0) tabs[i].appendChild(h('span', 'ci-pet-tab-badge', n > 9 ? '9+' : String(n)));
    }
  }
  function switchTab(id) {
    if (uiTab === id) return;
    // 离开对战页时把回放定时器停掉：否则动画会在看不见的 DOM 上继续跑
    if (uiTab === 'battle') stopFight();
    uiTab = id;
    tabAnim = true;
    renderHome();
    // 切页必须回到顶部：从小家滚到一半再点图鉴，不重置就会落在图鉴中间，
    // 用户以为是「没反应」。放在 render 之后设，才不会被新内容的高度顶回去。
    if (root && root.scrollTop) root.scrollTop = 0;
    if (id !== 'home' && !battle) {
      loadBattle(function() { if (uiTab === id) renderHome(); });
    }
  }
  // 自动化/诊断用：dock 已删，UI 上没有切页按钮，留一个跳转钩子。
  // 只做「切页」，不暴露任何状态，生产里也没有入口能触发它。
  window.__ciPetGo = function(t) { try { switchTab(t); } catch (e) {} };

  function pageHead(title, sub) {
    var box = h('div', 'ci-pet-pagehead');
    // v0.33 版式：左边「标题 + 说明」竖排，回家按钮靠右。
    // 旧版把按钮夹在标题和副标题之间，三行读起来像面包屑，
    // 而且按钮的深色底会贴着标题下沿，截图里像是压住了字。
    var row = h('div', 'ci-pet-pagehead-row');
    var left = h('div', 'ci-pet-pagehead-left');
    left.appendChild(h('div', 'ci-pet-pagehead-title', title));
    if (sub) left.appendChild(h('div', 'ci-pet-pagehead-sub', sub));
    row.appendChild(left);
    var home = h('button', 'ci-pet-pagehead-home');
    var hIco = pixIcon('home', 'ci-pet-pagehead-home-ico');
    if (hIco) home.appendChild(hIco);
    home.appendChild(h('span', null, '回家'));
    home.addEventListener('click', function() { switchTab('home'); });
    row.appendChild(home);
    box.appendChild(row);
    return box;
  }
  function renderBattleTab() {
    // v2.0：不放 pageHead —— 舞台本身就是页头。
    // 但**必须留一个回首页的入口**：dock 删掉之后，战斗页曾经是「进得去出不来」。
    // 这里用一枚悬浮像素按钮（固定在左上，避开 HUD 与舞台）。
    // 用一条「工具栏」承载返回键：绝对定位会和 HUD 撞（截图实证），
    // 走正常文档流则天然避开，也和其他内页「顶部一行」的结构一致。
    var bar = h('div', 'ci-pet-toolbar');
    var home = h('button', 'ci-pet-pagehead-home');
    var hIco = pixIcon('home', 'ci-pet-pagehead-home-ico');
    if (hIco) home.appendChild(hIco);
    home.appendChild(h('span', null, '回家'));
    home.addEventListener('click', function() { switchTab('home'); });
    bar.appendChild(home);
    root.appendChild(bar);
    root.appendChild(battleSection());
  }
  function renderDexTab() {
    if (!battle) {
      var box = h('div', 'ci-pet-battle ci-pet-battle-loading', '图鉴读取中…');
      root.appendChild(box);
      loadBattle(function() { if (uiTab === 'dex') renderHome(); });
      return;
    }
    root.appendChild(pageHead('图鉴', '收服野生精灵、选一只随行、看着自己的小家伙进化。'));
    root.appendChild(dexSection());
  }
  function renderRankTab() {
    if (!battle) {
      var box = h('div', 'ci-pet-battle ci-pet-battle-loading', '排行榜读取中…');
      root.appendChild(box);
      loadBattle(function() { if (uiTab === 'rank') renderHome(); });
      return;
    }
    root.appendChild(pageHead('排行', '只比战力积分。羁绊是你们俩的私事，不上榜。'));
    root.appendChild(rankSection());
  }
  function renderHome() {
    // ⚠️ 编辑器开着时一律不许重建首页。要真的回家请走 exitEditorToHome()。
    if (editorOpen) return;
    clearRoot();
    markCardTone();   // 先定卡片内文字用深还是亮，再画内容（否则首帧会闪一下白字）
    // 横屏分栏的开关：CSS 用它区分「首页双栏」与「内页单列加宽」。
    // 放在 clearRoot 之后立刻设，渲染中段就会带上，避免首帧按竖屏排一次再跳。
    if (root.classList) root.classList.toggle('is-hometab', uiTab === 'home');
    // 昼夜 class 必须在 markCardTone 之前挂上：markCardTone 读 --ci-color-bg-card，
    // is-day 把它重定义成浅卡色，darkcard 判定就自动跟着走（白天=浅卡=深字）。
    applyDayNight(false);
    if (!state || !state.adopted) { renderAdopt(); return; }
    // v0.9.0：HUD 常驻顶部，导航沉到底部（像手游的 dock），中间才是页面内容。
    // ⚠️ 先挂进 root 再 fillHud：gameHud() 内部的 fillHud 用 root.querySelector 找人，
    // 节点还没上树时查到的是 null，战力就永远停在占位符「⚔ —」，属性胶囊也丢了配色。
    // v0.14.0：首页不再挂顶部 gameHud —— 舞台底部已有名牌，
    // 顶部再放一份「头像 + 名字 + 等级」就是同一件事说两遍。
    // 战力/属性/小鱼干改到舞台右上角（stageHud），因为它们属于「实力与钱包」，
    // 该和场景在一起，而不是另起一行把场景往下挤。
    // 内页（对战/图鉴/排行）没有舞台，仍然沿用顶部 HUD。
    if (uiTab !== 'home') {
      root.appendChild(gameHud());
      fillHud();
    }
    if (uiTab === 'battle') renderBattleTab();
    else if (uiTab === 'dex') renderDexTab();
    else if (uiTab === 'rank') renderRankTab();
    else sceneHomeBody(root);
    // v0.20.0：dock 已删除 —— 小家是像素场景（家具即导航），
    // 内页由 pageHead 的「回家」按钮返回。tabBar() 函数保留（历史回滚用）。
    // 切页入场：整块内容从下方淡入上浮，撑住「换了一页」的空间感。
    // 只认 switchTab 设的那一次标记，日常刷新（喂食、打完一场）不重播动画。
    if (tabAnim) {
      tabAnim = false;
      root.classList.add('is-tabswitch');
      setTimeout(function() {
        if (root) root.classList.remove('is-tabswitch');
      }, 320);
    }
  }

  // 首页的「冒险入口」：把对战/图鉴/排行从长页面里提出来，各给一张可点的卡。
  // 用户原话是「把对战和其他页面区分开」，所以首页只留入口，不再塞完整对战。

  // 档案是异步来的：首页入口的副标题要在数据回来后原地补一次，
  // 不能整页重渲染（会把正在播的宠物视频重新起一遍）。
  function refreshHomeLinks() {
    if (!root || !battle) return;
    var links = root.querySelectorAll('.ci-pet-advlink');
    for (var i = 0; i < links.length; i++) {
      var id = links[i].getAttribute('data-link');
      var sub = links[i].querySelector('.ci-pet-advlink-sub');
      if (!sub) continue;
      if (id === 'battle') {
        sub.textContent = '今日 ' + (battle.today || 0) + ' 场 · 全班第 ' + (battle.myRank || '-') + ' 名';
      } else if (id === 'dex' && battle.dex) {
        sub.textContent = '已收服 ' + battle.dex.ownedCount + ' / ' + battle.dex.total + ' 只';
      }
    }
  }

  // 喂食的唯一入口：普通鱼干与豪华大餐走同一条路径，只是带不同的 food。
  // ⚠️ 为什么按钮不自己 post：2026-10-26 实测「页面 post 一次 + 悬浮层收到事件再 post 一次」
  //    = 一次点击两请求，第二发必然撞 20 分钟冷却返回 429 被静默吞掉，表现为「点了但数值不涨」。
  //    所以按钮只派发事件，请求由悬浮层统一发；本页保留 500ms 无回报兜底（桌宠没挂载时）。
  function doFeed(food, btn) {
    var isFeast = food === 'feast';
    if (!canFeed()) {
      sysToast(isFeast ? '今天已经吃饱啦，明天再喂' : feedBtnSub(), 'info');
      return;
    }
    if (isFeast && coinCount() < FOCUS_COIN_COST) {
      sysToast('小鱼干不够了（需要 ' + FOCUS_COIN_COST + ' 条，现在 ' + coinCount() + ' 条）', 'info');
      return;
    }
    if (btn) btn.disabled = true;
    pendingReply.feed = false;
    try {
      window.dispatchEvent(new CustomEvent('ci-pet-feed', { detail: { food: food } }));
    } catch (e) {}
    setTimeout(function() {
      if (pendingReply.feed) return;
      api.post('/pet/interact', { type: 'feed', food: food }).then(function(res) {
        var d = (res.data && res.data.data) || {};
        state = d.state || state;
        if (d.mood) moodInfo = d.mood;
        if (d.personality) personalityInfo = d.personality;
        absorbProgress(d);
        if (d.tierUp) { sysToast('羁绊升级了！', 'success'); try { window.dispatchEvent(new CustomEvent('ci-pet-tierup')); } catch (e) {} }
        else if (d.capped) sysToast(capMessage('feed'), 'info');
        renderHome();
        if (!d.capped && d.gained > 0) flashGain(d.gained, d.crit);
      }, function(err) {
        var msg = (err && err.response && err.response.data && err.response.data.message) || '投喂失败';
        sysToast(msg, 'error');
      }).then(function() { if (btn) btn.disabled = false; });
    }, 500);
  }

  // ================= 专注 / 小鱼干 / 日记（v0.11.0）====================
  // 这三块是一套闭环，不是三个独立功能：
  //   陪它专注 → 掉小鱼干 → 换豪华大餐 → 喂它涨更多羁绊 → 晚上留下一句日记
  // 所以它们共用同一份数据来源（/pet/state 的 diary + focus），
  // 任何一块拿不到都不影响另外两块 —— 探针桩环境缺字段时页面依然是完整的。

  // 日记卡：一句第一人称的今天。文案由服务端按事件模板生成，前端只负责排版。
  function diaryCard() {
    var d = diaryInfo;
    var box = h('div', 'ci-pet-diary');
    var head = h('div', 'ci-pet-diary-head');
    head.appendChild(h('span', 'ci-pet-diary-title', '它的小日记'));
    var min = focusTodayMin();
    if (min > 0) head.appendChild(h('span', 'ci-pet-diary-tag', '今天陪你专注 ' + min + ' 分钟'));
    box.appendChild(head);

    var text = (d && d.today && d.today.text) || '';
    var quote = h('div', 'ci-pet-diary-quote' + (text ? '' : ' is-empty'));
    quote.appendChild(h('span', 'ci-pet-diary-mark', '“'));
    quote.appendChild(h('span', 'ci-pet-diary-text',
      text || '今天还没什么可记的。陪它待一会儿，晚上就有故事了。'));
    box.appendChild(quote);

    var hist = (d && d.history) || [];
    if (hist.length) {
      // 用 details 而不是自绘展开：一行原生标签就能有键盘可达性，还省一个状态变量
      var det = document.createElement('details');
      det.className = 'ci-pet-diary-more';
      det.appendChild(h('summary', null, '翻翻以前（' + hist.length + ' 天）'));
      for (var i = 0; i < hist.length; i++) {
        var row = h('div', 'ci-pet-diary-row');
        row.appendChild(h('span', 'ci-pet-diary-date', String(hist[i].date || '').slice(5)));
        row.appendChild(h('span', 'ci-pet-diary-rowtext', hist[i].text || ''));
        det.appendChild(row);
      }
      box.appendChild(det);
    }
    return box;
  }

  // 小卖部：小鱼干余额 + 豪华大餐。只有这一种消耗品，
  // 不做成完整商店 —— 货架一多，玩家的注意力就从宠物跑到比价上了。
  function shoppeBar() {
    var box = h('div', 'ci-pet-shoppe');
    var coins = h('div', 'ci-pet-shoppe-coins');
    coins.appendChild(h('span', 'ci-pet-shoppe-coinicon', '🐟'));
    coins.appendChild(h('b', 'ci-pet-shoppe-num', String(coinCount())));
    coins.appendChild(h('i', 'ci-pet-shoppe-unit', '条小鱼干'));
    // 提示一句「钱从哪来」：专注才是鱼干的主产出，商店只是把它变成选择
    coins.appendChild(h('span', 'ci-pet-shoppe-tip', '陪它专注就有进账'));
    box.appendChild(coins);

    // 普通饭：这是「喂」不是「买」，放货架最上面横贯一行 —— 弹层打开，最先看到的
    // 应该是今天还喂不喂得动，然后才是「要不要顺便囤点货」。
    var normal = h('button', 'ci-pet-shoppe-item is-wide' + (canFeed() ? '' : ' is-off'));
    normal.setAttribute('data-shoppe', 'normal');
    var ntop = h('span', 'ci-pet-shoppe-item-top');
    ntop.appendChild(h('span', 'ci-pet-shoppe-item-icon', '🍚'));
    ntop.appendChild(h('span', 'ci-pet-shoppe-item-cost', '今日 ' + fedCount() + ' / 3'));
    normal.appendChild(ntop);
    normal.appendChild(h('span', 'ci-pet-shoppe-item-name', '开饭'));
    normal.appendChild(h('span', 'ci-pet-shoppe-item-desc', '普通的一餐，羁绊 +4'));
    normal.addEventListener('click', function() { doFeed('normal', normal); });
    box.appendChild(normal);

    // 货架（v0.25.0）：以前整个商店只有一件豪华大餐，鱼干攒到三位数也只有一个去处。
    // 现在一格一件：药水直接补战斗库存，铃铛买的是今天的第三张默契牌。
    var items = (shopInfo && shopInfo.items) || [];
    if (!items.length) {
      // 桩环境 / 老接口：货架拿不到就维持原样，只剩大餐按钮
      var legacy = h('button', 'ci-pet-shoppe-buy' + (coinCount() >= FOCUS_COIN_COST && canFeed() ? '' : ' is-off'));
      legacy.setAttribute('data-shoppe', 'feast');
      legacy.textContent = '🍱 豪华大餐 · ' + FOCUS_COIN_COST + '🐟';
      legacy.addEventListener('click', function() { doFeed('feast', legacy); });
      box.appendChild(legacy);
      return box;
    }
    var shelf = h('div', 'ci-pet-shoppe-shelf');
    for (var i = 0; i < items.length; i++) {
      (function(item) {
        var out = coinCount() < item.cost ||
                  (item.kind === 'feed' && !canFeed()) ||
                  item.soldOut;
        var card = h('button', 'ci-pet-shoppe-item' + (out ? ' is-off' : '') +
          (item.soldOut ? ' is-soldout' : ''));
        card.setAttribute('data-shoppe', item.id);
        var top = h('span', 'ci-pet-shoppe-item-top');
        top.appendChild(h('span', 'ci-pet-shoppe-item-icon', item.icon || ''));
        top.appendChild(h('span', 'ci-pet-shoppe-item-cost', item.cost + '🐟'));
        card.appendChild(top);
        card.appendChild(h('span', 'ci-pet-shoppe-item-name', item.name));
        card.appendChild(h('span', 'ci-pet-shoppe-item-desc', item.desc || ''));
        if (item.kind === 'item') {
          card.appendChild(h('span', 'ci-pet-shoppe-item-charges', '库存 ' + (item.charges || 0)));
        } else if (item.soldOut) {
          card.appendChild(h('span', 'ci-pet-shoppe-item-charges', '今日已购'));
        }
        card.addEventListener('click', function() { doShopBuy(item, card); });
        shelf.appendChild(card);
      })(items[i]);
    }
    box.appendChild(shelf);
    return box;
  }

  // 小卖部下单：大餐走喂食老路（那边管饱食度和每日上限），其余直接扣钱发货。
  // 成功后只重绘这一张卡 + 余额：整页 renderHome 会把闲逛动画打断（v0.23.1 的教训）。
  function doShopBuy(item, card) {
    if (item.kind === 'feed') { doFeed('feast', card); return; }
    if (!api) return;
    api.post('/pet/shop/buy', { id: item.id }).then(function(res) {
      var d = (res.data && res.data.data) || {};
      if (state) state.coins = d.coins;
      if (d.inventory && battle) battle.inventory = d.inventory;
      if (d.bellToday && shopInfo) {
        for (var i = 0; i < shopInfo.items.length; i++) {
          if (shopInfo.items[i].id === 'bell') shopInfo.items[i].soldOut = true;
        }
      }
      if (d.inventory && shopInfo) {
        for (var j = 0; j < shopInfo.items.length; j++) {
          var it = shopInfo.items[j];
          if (it.kind !== 'item') continue;
          for (var k = 0; k < d.inventory.owned.length; k++) {
            if (d.inventory.owned[k].id === it.id) it.charges = d.inventory.owned[k].charges;
          }
        }
      }
      sysToast('买到了 ' + (d.icon || '') + ' ' + (d.name || '东西') +
        (item.id === 'bell' ? '——今天多一张默契牌' : ''), 'success');
      // 只重绘余额数字与这张卡的状态，别动整页
      var numEl = root.querySelector('.ci-pet-shoppe-num');
      if (numEl) numEl.textContent = String(coinCount());
      if (card) {
        var fresh = shopInfo && shopInfo.items ? (function() {
          for (var i = 0; i < shopInfo.items.length; i++) {
            if (shopInfo.items[i].id === item.id) return shopInfo.items[i];
          }
          return null;
        })() : null;
        var chargesEl = card.querySelector('.ci-pet-shoppe-item-charges');
        if (chargesEl && fresh) chargesEl.textContent = '库存 ' + (fresh.charges || 0);
        if (item.id === 'bell' && card) {
          card.classList.add('is-soldout');
          if (chargesEl) chargesEl.textContent = '今日已购';
        }
      }
      refreshTabBadges();
    }, function(err) {
      var msg = (err && err.response && err.response.data && err.response.data.message) || '没买到';
      sysToast(msg, 'error');
    });
  }

  // 专注时长选择：15 / 25 / 45。三个数不是随手挑的：
  // 15 = 一个课间的长度，25 = 一个番茄钟，45 = 一节课。
  function focusPicker() {
    var box = h('div', 'ci-pet-focuspick');
    box.appendChild(h('span', 'ci-pet-focuspick-label', '陪它专注多久？'));
    for (var i = 0; i < FOCUS_ALLOWED.length; i++) {
      (function(min) {
        var b = h('button', 'ci-pet-focuspick-btn', min + ' 分钟');
        b.setAttribute('data-focus-min', String(min));
        b.addEventListener('click', function() { startFocus(min); });
        box.appendChild(b);
      })(FOCUS_ALLOWED[i]);
    }
    var cancel = h('button', 'ci-pet-focuspick-cancel', '算了');
    cancel.addEventListener('click', function() {
      focus.picking = false;
      renderHome();
    });
    box.appendChild(cancel);
    return box;
  }

  // ================= 今日天气 / 每日任务 / 最近战报（v0.10.0）====================
  // 这三块补的是同一个缺口：以前首页只能「喂饭 + 摸摸」，打开页面不知道今天还该做什么。
  // 数据全部来自 /pet/state（weather / quests）与 /pet/battle/profile（history），
  // 拿不到就整块不画 —— 探针桩环境没有这些字段时，页面照样是完整的 v0.9 样子。

  // 天气条：一句「今天适合谁上场」+ 加成说明 + 自己的本命是否吃到。
  // 刻意不做成卡片标题层级：它是一条横幅，看一眼前提就够。
  function weatherCard() {
    var w = weatherInfo || (battle && battle.weather);
    if (!w || !w.id) return null;
    var myType = (battle && (battle.battleType || (battle.types && battle.types.me))) || 'grass';
    var fit = w.type === myType;
    var box = h('div', 'ci-pet-weather' + (fit ? ' is-fit' : ''));

    box.appendChild(h('span', 'ci-pet-weather-icon', w.icon || '☀️'));
    var main = h('div', 'ci-pet-weather-main');
    var top = h('div', 'ci-pet-weather-top');
    top.appendChild(h('span', 'ci-pet-weather-name', '今日' + (w.name || '天气')));
    top.appendChild(elementChip(w.type, w.typeName));
    top.appendChild(h('span', 'ci-pet-weather-bonus', w.bonusText || ''));
    main.appendChild(top);
    main.appendChild(h('div', 'ci-pet-weather-desc', w.desc || ''));
    main.appendChild(h('div', 'ci-pet-weather-fit',
      fit ? '本命契合 · 属性加成已生效' : ('本命是' + elementOf(myType).name + '，今天换成' + (w.typeName || '') + '系更划算')));
    box.appendChild(main);
    return box;
  }

  // 每日登录奖励（v0.15.0）：服务端按 last_login_date 判定是否「今天第一次来」，
  // streak 连续天数，发小鱼干 + 羁绊。前端只负责把「今天有礼」画在天气条旁边，
  // 点一下展开说明 —— 这是唯一一个「不花钱就能涨」的东西，值得给一点存在感。

  // 每日奇遇（v0.16.0）：今天发生的「好事」，和签到/心愿/故事是三条不同的线。
  // 数据来自 /state 下发的 wonder（按日期 + uid 定种子，同一天永远是同一件事）。

  // 离线时光 recap（v0.16.0）：你不在的时候它也在生活。
  // 数据来自 /state 下发的 offlineRecap（服务端按 last_active_at 现算）。
  // ⚠️ 只在「真的离线过」时显示 —— 同一次打开页面 gapMin=0 就不该弹。

  // 自主行为卡（v0.17.0）：宠物在你不在的时候也在动。
  function autonomyCard() {
    var a = autonomyInfo;
    if (!a || !a.last) return null;
    var box = h('div', 'ci-pet-autonomy');
    var row = h('div', 'ci-pet-autonomy-row');
    var left = h('div', 'ci-pet-autonomy-left');
    left.appendChild(h('span', 'ci-pet-autonomy-icon', a.last.icon || '🐾'));
    var t = h('span', 'ci-pet-autonomy-text');
    t.appendChild(h('span', 'ci-pet-autonomy-title',
      '它刚刚 · ' + (a.last.text || '发呆中')));
    var sub = '离线 ' + (a.gapMin || 0) + ' 分钟';
    if (a.events && a.events.length > 1) sub += ' · 做了 ' + a.events.length + ' 件事';
    t.appendChild(h('span', 'ci-pet-autonomy-sub', sub));
    left.appendChild(t);
    row.appendChild(left);
    if (a.last.coin > 0 || a.last.bond > 0) {
      var pill = h('span', 'ci-pet-autonomy-pill',
        (a.last.coin > 0 ? '+' + a.last.coin + ' 鱼干 ' : '') +
        (a.last.bond > 0 ? '+' + a.last.bond + ' 羁绊' : ''));
      row.appendChild(pill);
    }
    box.appendChild(row);
    if (a.events && a.events.length > 1) {
      var list = h('div', 'ci-pet-autonomy-list');
      for (var i = 0; i < Math.min(3, a.events.length); i++) {
        var ev = a.events[i];
        var item = h('div', 'ci-pet-autonomy-item');
        item.appendChild(h('span', 'ci-pet-autonomy-item-icon', ev.icon || '·'));
        item.appendChild(h('span', 'ci-pet-autonomy-item-text', ev.text || ''));
        list.appendChild(item);
      }
      box.appendChild(list);
    }
    return box;
  }

  // 任务卡：三行清单。进度条只做「看清还差多少」，不做动画 —— 任务是一天一次的事。
  function questCard() {
    var q = questInfo || (battle && battle.quests);
    if (!q || !q.list || !q.list.length) return null;
    var box = h('div', 'ci-pet-quests');

    var head = h('div', 'ci-pet-quests-head');
    head.appendChild(h('span', 'ci-pet-quests-title',
      '今日任务 ' + (q.claimed || 0) + ' / ' + (q.total || q.list.length)));
    head.appendChild(h('span', 'ci-pet-quests-bonus',
      q.allClaimed ? '今天的都领完了' : (q.bonusText || '')));
    box.appendChild(head);

    for (var i = 0; i < q.list.length; i++) {
      (function(item) {
        var done = !!item.done;
        var claimed = !!item.claimed;
        var row = h('div', 'ci-pet-quest' + (done ? ' is-done' : '') + (claimed ? ' is-claimed' : ''));
        row.setAttribute('data-quest', item.id);

        row.appendChild(h('span', 'ci-pet-quest-icon', item.icon || '·'));
        var body = h('div', 'ci-pet-quest-body');
        var titleRow = h('div', 'ci-pet-quest-titlerow');
        titleRow.appendChild(h('span', 'ci-pet-quest-title', item.title || ''));
        titleRow.appendChild(h('span', 'ci-pet-quest-reward', item.rewardText || ''));
        body.appendChild(titleRow);
        body.appendChild(h('div', 'ci-pet-quest-desc', item.desc || ''));

        var bar = h('div', 'ci-pet-quest-bar');
        var fill = document.createElement('span');
        var pct = item.goal > 0 ? Math.round(Math.min(1, (item.progress || 0) / item.goal) * 100) : 0;
        fill.style.width = Math.max(claimed || done ? 100 : 0, pct) + '%';
        bar.appendChild(fill);
        body.appendChild(bar);
        row.appendChild(body);

        var right = h('div', 'ci-pet-quest-right');
        right.appendChild(h('span', 'ci-pet-quest-prog',
          Math.min(item.progress || 0, item.goal || 0) + ' / ' + (item.goal || 0)));
        if (claimed) {
          right.appendChild(h('span', 'ci-pet-quest-tag', '已领'));
        } else if (done) {
          var btn = h('button', 'ci-pet-quest-claim', '领取');
          btn.addEventListener('click', function() { claimQuest(item.id, btn); });
          right.appendChild(btn);
        } else {
          right.appendChild(h('span', 'ci-pet-quest-tag ci-pet-quest-tag--todo', '进行中'));
        }
        row.appendChild(right);
        box.appendChild(row);
      })(q.list[i]);
    }
    return box;
  }

  // 领奖：服务端是唯一裁判（今天抽到 + 已完成 + 没领过），前端只负责把结果画回去。
  function claimQuest(id, btn) {
    if (!api || !id) return;
    if (btn) { btn.disabled = true; btn.textContent = '领取中…'; }
    api.post('/pet/quest/claim', { id: id }).then(function(res) {
      var d = (res.data && res.data.data) || {};
      if (d.state) state = d.state;
      if (d.quests) questInfo = d.quests;
      // 本地跟着改一次积分，回对战页时不会先看到旧分数再跳一下；
      // 随后的 loadBattle 会从服务端拿准确值。
      if (battle) {
        if (d.quests) battle.quests = d.quests;
        if (battle.record && d.gained) {
          battle.record.points = (battle.record.points || 0) + (d.gained.points || 0) + (d.bonus || 0);
        }
      }
      if (d.bonus > 0) sysToast('三项任务都领完了，额外 +' + d.bonus + ' 积分', 'success');
      else sysToast((d.rewardText || '任务奖励') + ' 已领取', 'success');
      renderHome();
      loadBattle();   // 羁绊/积分变了：HUD 与首页入口文案顺手刷新
    }, function(err) {
      var msg = (err && err.response && err.response.data && err.response.data.message) || '领取失败';
      sysToast(msg, 'error');
      if (btn) { btn.disabled = false; btn.textContent = '领取'; }
    });
  }

  // 最近战报：只回答「刚才发生了什么」。最多 6 条，多了就不可读。
  function historyBox() {
    var list = (battle && battle.history) || [];
    var box = h('div', 'ci-pet-hist');
    var head = h('div', 'ci-pet-hist-head');
    head.appendChild(h('span', 'ci-pet-hist-title', '最近战报'));
    if (list.length) head.appendChild(h('span', 'ci-pet-hist-sub', '保留最近 ' + list.length + ' 场'));
    box.appendChild(head);

    if (!list.length) {
      box.appendChild(h('div', 'ci-pet-hist-empty', '还没有记录。挑一个对手开打，这里会留下最近 8 场。'));
      return box;
    }
    var rows = h('div', 'ci-pet-hist-rows');
    for (var i = 0; i < list.length && i < 6; i++) {
      var it = list[i] || {};
      var row = h('div', 'ci-pet-hist-row' + (it.win ? ' is-win' : ' is-lose'));
      row.appendChild(h('span', 'ci-pet-hist-mark', it.win ? '胜' : '负'));
      var body = h('div', 'ci-pet-hist-body');
      body.appendChild(h('span', 'ci-pet-hist-name', it.title || '对战'));
      body.appendChild(h('span', 'ci-pet-hist-meta', it.sub || ''));
      row.appendChild(body);
      if (it.gain > 0) row.appendChild(h('span', 'ci-pet-hist-gain', '+' + it.gain));
      rows.appendChild(row);
    }
    box.appendChild(rows);
    return box;
  }

// ================= 像素小家场景（v0.20.0）=================
// 首页不再是「舞台 + 信息卡片长龙」，而是一间桌宠生活的像素小屋：
// 功能入口长在家具上 —— 点物件进入对应玩法，点角色 = 摸摸。
// 联机大地图预留：SCENE_OBJECTS 是数据驱动清单，扩地图 = 扩清单。

// 字符画 → 像素 SVG：'.'/' ' 为透明，其余字符查调色板；
// 同色横向 run 合并为一个 rect，节点数可控。shape-rendering 强制锐边。
var MARK = '\u0001';
var PX_OUTLINE = '#1c1119';   // 统一描边色：近黑带一点紫，不与任何材质抢色

function pxArt(w, h, rows, palette) {
  // 先还原成字符网格 —— 描边需要知道「邻居是不是实心像素」
  var grid = [];
  for (var y = 0; y < h; y++) {
    var row = rows[y] || '';
    var line = [];
    for (var x = 0; x < w; x++) {
      var c = row.charAt(x);
      line.push(c === ' ' ? '.' : c);
    }
    grid.push(line);
  }
  function solid(x, y) {
    if (x < 0 || y < 0 || x >= w || y >= h) return false;
    var ch = grid[y][x];
    return ch !== '.' && ch !== MARK;
  }
  // 内描边：与实心像素正交相邻的透明格 → 深色轮廓。
  // 商业像素游戏里，物件全靠这 1px 从背景里「切」出来；
  // CSS 的模糊投影永远软塌塌，而且会随物件缩放变粗细 —— 描边必须长在美术里。
  for (var yy = 0; yy < h; yy++) {
    for (var xx = 0; xx < w; xx++) {
      if (solid(xx, yy)) continue;
      if (solid(xx - 1, yy) || solid(xx + 1, yy) || solid(xx, yy - 1) || solid(xx, yy + 1)) {
        grid[yy][xx] = MARK;   // 先打标记，避免描边被当成实心再扩散一圈
      }
    }
  }
  var rects = [];
  for (var y2 = 0; y2 < h; y2++) {
    var line2 = grid[y2];
    for (var x2 = 0; x2 < w; x2++) {
      var ch2 = line2[x2];
      var color = ch2 === MARK ? PX_OUTLINE : palette[ch2];
      if (!color) continue;
      var x3 = x2;
      while (x3 + 1 < w && line2[x3 + 1] === ch2) x3++;
      rects.push('<rect x="' + x2 + '" y="' + y2 + '" width="' + (x3 - x2 + 1) + '" height="1" fill="' + color + '"/>');
      x2 = x3;
    }
  }
  return '<svg viewBox="0 0 ' + w + ' ' + h + '" shape-rendering="crispEdges" preserveAspectRatio="xMidYMax meet" width="100%" height="100%">' + rects.join('') + '</svg>';
}


// 家具像素画：每件 = { w, h, art(字符画), pal(调色板) }。颜色三阶（暗/中/亮）保像素体积感。
// 每件家具都是字符画 → 内联 SVG，零外部图片依赖。
var SCENE_ART = {
  // 床：绒面圆窝 + 木脚
  bed: { w: 42, h: 20, pal: { 'a': '#5a3a22', 'b': '#7a4f2e', 'c': '#96643a', 'd': '#b47f4b', 'e': '#cfa066', 'x': '#c9b291', 'y': '#ddc9a8', 'z': '#ecdcbd', 'p': '#f2e8d4', 'q': '#fdf6e6', 'r': '#cbb99e', 'g': '#3c4a5e', 'h': '#4d5f78', 'i': '#647992', 'j': '#8098af' }, rows: [
    '..........................................',
    '..........................................',
    '..........................................',
    '..........................................',
    '............dddddddddddddddddd............',
    '........deeeeeeeeeeeeeeeeeeeeeeeec........',
    '......eeqqqqqqcccbbbbbbbbcccceeeeeee......',
    '....eeeeppppppzzzzzzzzxxxxxxxbbbbceeee....',
    '...eeecbqrrrrpzzzzzxxxyyyyggggggxxbceee...',
    '...eeebzzzzzzzzzxxxyyyyyggggggggggxbeee...',
    '...deeeczzzzzxxxyxyyyyyxggggggggggceeeb...',
    '...dbdeeeeexxyyyxyxyyxxxggggggggggeebcb...',
    '...dbdcccceeeeeeeeeeeeeeeggggggggbcbbcb...',
    '....cccccccccccccccccccbbcbggggcbbcbbc....',
    '.....cccccccccccccccbbcbbcbbcbbcbbcbb.....',
    '.......ccccccccbbbbbbbbbbbbbbbbbbbb.......',
    '..........ccbbbbbbbbbbbbbbbbbbbb..........',
    '...............bbbbbbbbbbbb...............',
    '..........................................',
    '..........................................'
  ] },
  // 书桌：厚桌面 + 抽屉 + 桌腿 + 桌上书与杯
  desk: { w: 38, h: 23, pal: { 'a': '#4a3220', 'b': '#63421f', 'c': '#7a5330', 'd': '#96693c', 'e': '#b0804a', 'f': '#c9975a', 'p': '#d8cbb0', 'r': '#8a4a3a', 'q': '#a8503c' }, rows: [
    '......................................',
    '......................................',
    '......................................',
    '.........................ppppppp......',
    '.........................rrrrrra......',
    '...ceeeeeeeeeeeeeeeeeeeeeeeeeeeeeea...',
    '...cdddddddddddddddddddddddddddddda...',
    '...caaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa...',
    '....cccccccccccccccccccccccccccccc....',
    '....cabbbbbbbbbbaccabbbbbabbbbbbbc....',
    '....caaafffffffaaccabbbbbabbbbbbbc....',
    '....aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa....',
    '....ec..........................ec....',
    '....ec..........................ec....',
    '....ec..........................ec....',
    '....ec..........................ec....',
    '....ec..........................ec....',
    '....ec..........................ec....',
    '....ec..........................ec....',
    '....ec..........................ec....',
    '....aa..........................aa....',
    '......................................',
    '......................................'
  ] },
  // 椅子：靠背 + 坐面 + 四条腿
  chair: { w: 15, h: 19, pal: { 'a': '#4a3220', 'b': '#5c3c22', 'c': '#75502c', 'd': '#8f6538', 'e': '#a87b47', 's': '#7a4a3a', 't': '#96604a' }, rows: [
    '...............',
    '...eeeeeeeee...',
    '...ddddddddd...',
    '...dd.cc..cc...',
    '...cc.cc..cc...',
    '...cc.cc..cc...',
    '...cc.cc..cc...',
    '...cc.cc..cc...',
    '...cc.cc..cc...',
    '..eeeeeeeeeee..',
    '..dsssssssssd..',
    '..dtttttttttd..',
    '...dc.....dc...',
    '...dc.....dc...',
    '...dbbbbbbbc...',
    '...dc.....dc...',
    '...dc.....dc...',
    '...bb.....bb...',
    '...............'
  ] },
  // 门：门框 + 两块凹板 + 把手
  door: { w: 26, h: 34, pal: { 'a': '#3a2618', 'b': '#4a3120', 'c': '#6b4626', 'd': '#83592f', 'e': '#a87b47', 'f': '#c9a06a', 'g': '#2a1a10' }, rows: [
    '..........................',
    '.ccccccccccccccccccccccca.',
    '.cbbbbbbbbbbbbbbbbbbbbbba.',
    '.cbbdddddddddddddddddbbba.',
    '.cbbcccccccccccccccccbaba.',
    '.cbbcccccccccccccccccbaba.',
    '.cbbccbbbbbbbbbbbbbbcbaba.',
    '.cbbccbeeeeeeeeeeecbcbaba.',
    '.cbbccbdddddddddddcbcbaba.',
    '.cbbccbdddddddddddcbcbaba.',
    '.cbbccbdddddddddddcbcbaba.',
    '.cbbccbdddddddddddcbcbaba.',
    '.cbbccbdddddddddddcbcbaba.',
    '.cbbccbdddddddddddcbcbaba.',
    '.cbbccbccccccccccccbcbaba.',
    '.cbbccbbbbbbbbbbbbbbcbaba.',
    '.cbbcccccccccccccccffbaba.',
    '.cbbcccccccccccccccffbaba.',
    '.cbbccbbbbbbbbbbbbbbcbaba.',
    '.cbbccbeeeeeeeeeeecbcbaba.',
    '.cbbccbdddddddddddcbcbaba.',
    '.cbbccbdddddddddddcbcbaba.',
    '.cbbccbdddddddddddcbcbaba.',
    '.cbbccbdddddddddddcbcbaba.',
    '.cbbccbdddddddddddcbcbaba.',
    '.cbbccbdddddddddddcbcbaba.',
    '.cbbccbdddddddddddcbcbaba.',
    '.cbbccbccccccccccccbcbaba.',
    '.cbbccbbbbbbbbbbbbbbcbaba.',
    '.cbbcccccccccccccccccbaba.',
    '.cbbggggggggggggggggggbba.',
    '.eeeeeeeeeeeeeeeeeeeeeeee.',
    '.fccccccccccccccccccccccf.',
    '..........................'
  ] },
  // 书柜：三层 + 书脊 + 罐子 + 抽屉
  shelf: { w: 30, h: 28, pal: { 'a': '#5a3c22', 'b': '#6b4828', 'c': '#7d5730', 'd': '#92683a', 'e': '#a87d47', 'p': '#e6dcc4', '1': '#5478a8', '2': '#a85a44', '3': '#6a9160', '4': '#c9a227' }, rows: [
    '..............................',
    '.acccccccccccccccccccccccccca.',
    '.aeeeeeeeeeeeeeeeeeeeeeeeeeea.',
    '.adddddddddddddddddddddddddda.',
    '.aaaaaaaaaaaaaaaaaaaaaaaaaaaa.',
    '.aaabbbbbbbbbbbbbbbbbbbbbbaaa.',
    '.aaabbbbbbbbbbbbbbbbbbbbbbaaa.',
    '.aaabbbbbbbbbbbbbbbbbbbbbbaaa.',
    '.aaabbbpbbbpbbbpbbbpbbbpbbaaa.',
    '.aaabpb2bpb4bpb2bpb4bpb1bbaaa.',
    '.aeeeeeeeeeeeeeeeeeeeeeeeeeea.',
    '.aaaaaaaaaaaaaaaaaaaaaaaaaaaa.',
    '.aaabbddddbbbbbbbbbbbbbbbbaaa.',
    '.aaabbeeeddbbbbb44bbbbbbbbaaa.',
    '.aaabbedddcbbbb4432bbbbbbbaaa.',
    '.aaabbdbbccbbbb4322bbbbbbbaaa.',
    '.aaabbbbbcbbbbbbbbbbbbbbbbaaa.',
    '.aeeeeeeeeeeeeeeeeeeeeeeeeeea.',
    '.aaaaaaaaaaaaaaaaaaaaaaaaaaaa.',
    '.aaabbbbbbbbbbbbbbbbbbbbbbaaa.',
    '.aaabbbpppppppbbbbbbbbbbbbaaa.',
    '.aaabbb1111111bbbdddddddbbaaa.',
    '.aaabppppppppppbbccaaaccbbaaa.',
    '.aaab2222222222bbcccccccbbaaa.',
    '.aaab2aaaaaaaa2bbcccccccbbaaa.',
    '.aaaaaaaaaaaaaaaaaaaaaaaaaaaa.',
    '.aaaaaaaaaaaaaaaaaaaaaaaaaaaa.',
    '..............................'
  ] },
  // 窗：夜空四阶 + 月亮 + 星 + 窗棂 + 窗台
  window: { w: 46, h: 32, pal: { 'a': '#141d42', 'b': '#1e2b5c', 'c': '#2c4a86', 'd': '#3f66a8', 'e': '#fff2c0', 'f': '#e8eeff' }, rows: [
    '..............................................',
    '.cccccccccccccccccccccccccccccccccccccccccccc.',
    '.cbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.',
    '.cbaaaaaaaaaaaaaaaaaaacbaaaaaaaaaaaaaaaaaaabb.',
    '.cbaaaaaaaaaaaaaaaaaaacbaaaaaaaaaaaaaaaaaaabb.',
    '.cbaaaaaaaaeeeeaaaaaaacbaaaaaaaaaaaaaaaaaaabb.',
    '.cbaaaaaaaeeee#fffbe4eaaaaaacbaaaaaaaffaaaaaaaaaabb.',
    '.cbaaaaaaee#e8dcae#e8dcaeeeeeaaaaacbaaaaaaafaaaaaaaaaaabb.',
    '.cbbbbbbbeeeeeeeebbbbbcbbbbbbbbbbbbbbbbbbbbbb.',
    '.cbbbbbbbee#fffbe4eeeeebbbbbcbbbbbbbbbbbbbbbbbbbbbb.',
    '.cbbbbbbbeeee#e8dcaeeeebbbbbcbbbbbbbbbbbbffbbbbbbbb.',
    '.cbbbbbbbbeeeeeebbbbbbcbbbbbbbbbbbbfbbbbbbbbb.',
    '.cbbbbbbbbbeeeebbbbbbbcbbbbbbbbbbbbbbbbbbbbbb.',
    '.cbbbbbbbbbbbbbbbbbbbbcbbbbbbbbbbbbbbbbbbbbbb.',
    '.cbccccccccccccccccccccccccccccccccccccccccbb.',
    '.cbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.',
    '.cbccccccccccccccccccccbcccfcccccccccccccccbb.',
    '.cbccccccccccccccccccccbcccccccccccccccccccbb.',
    '.cbccccccccccccccccccccbccccccccccccccffcccbb.',
    '.cbccccccccccccccccccccbccccccccccccccfccccbb.',
    '.cbccccccccccccccccccfcbcccccccccccccccccccbb.',
    '.cbccccccccccccccccccfcbcccccccccccccccccccbb.',
    '.cbdddddddddddddddddddcbdddddddddddddddddddbb.',
    '.cbdddddddddddddddddddcbdddddddddffddddddddbb.',
    '.cbdaadddddaadddddaaddcbdaadddddaadddddaaddbb.',
    '.cbaaaadddaaaadddaaaadcbaaaadddaaaadddaaaadbb.',
    '.cbaaaadddaaaadddaaaadcbaaaadddaaaadddaaaadbb.',
    '.cbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.',
    '.bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.',
    '.dddddddddddddddddddddddddddddddddddddddddddd.',
    '.aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.',
    '..............................................'
  ] },
  // 白天窗户（_art7.py 生成）：与夜窗同框 46x32，暖木框 + 蓝天渐变 + 硬边太阳 + 云 + 鸟。
    windowDay: { w: 46, h: 32, pal: {
    'k': '#6b4a2a', 'j': '#a87c4a', 'a': '#6fb0e0', 'b': '#8ec4ec', 'c': '#aedcf6', 'd': '#c8ecfc', 'y': '#ffd76e', 'w': '#fff6d0', 'r': '#ffc95e', 'n': '#ffffff', 'm': '#dceef8', 'v': '#4a3826', 'e': '#c79a5e', 'f': '#7a5530' }, rows: [
    '..................................r...........',
    '.kkkkkkkkkkkkkkkkkkkkkkjkkkkkrkkkkrkkkkrkkkkk.',
    '.kaaaaaaaaaaaaaaaaaaaaajaaaaaaraaaraaaraaaaak.',
    '.kaaaannnnnaaaaaaaaaaaajaaaaaaaaaayaaaaaaaaak.',
    '.kaaannnnnnnaaaaaaaaaaajaaaaaaaayywyyaaaaaaak.',
    '.kaannnnnnnnnaaaaaaaaaajaaaaaaaaywwwyaaaaaaak.',
    '.kaaammmmmmmaaaaaaaaaaajaaaarrrywwwwwyrrraaak.',
    '.kaaaaaaaaaaaaaaaaaaaaajaaaaaaaaywwwyaaaaaaak.',
    '.kbbbbbbbbbbbbbbbbbbbbbjbbbbbbbbyywyybbbbbbbk.',
    '.kbbbbbbbbbbvbvbbbbbbbbjbbbbbbbbbbybbbbbbbbbk.',
    '.kbbbbbbbbbbbvbbbbbbbbbjbbbbbbrbbbrbbbrbbbbbk.',
    '.kbbbbbbbbbbbbbbbbbbbbbjbbbbbrbbbbrbbbbrbbbbk.',
    '.kbbbbbbbbbbbbbbbvbvbbbjbbbbbbbbbbrbbbbbbbbbk.',
    '.kbbbbbbbbbbbbbbbbvbbbbjbbbbbbbbbbbbbbbbbbbbk.',
    '.kjjjjjjjjjjjjjjjjjjjjjjjjjjjjjjjjjjjjjjjjjjk.',
    '.kccccccnnnnnnnccccccccjcccccccccccccccccccck.',
    '.kcccccnnnnnnnnncccccccjcccccccccccccccccccck.',
    '.kccccnnnnnnnnnnnccccccjcccccccccccccccccccck.',
    '.kcccccmmmmmmmmmcccccccjcccccccccccccccccccck.',
    '.kcccccccccccccccccccccjcccccccccccccccccccck.',
    '.kcccccccccccccccccccccjcccccccccccccccccccck.',
    '.kdddddddddddddddddddddjddddddddddddddddddddk.',
    '.kdddddddjddddddddjddddjdddjdnnnndddjdddddddk.',
    '.kdddddjddddddddjddddddjdjddnnnnnnjddddddddjk.',
    '.kdddjddddddddjddddddddjdddnnnnnnnnddddddjddk.',
    '.kdjddddddddjddddddddjdjddddmmmmmmdddddjddddk.',
    '.kddddddddjddddddddjdddjddddjddddddddjddddddk.',
    '.kddddddjddddddddjdddddjddjddddddddjddddddddk.',
    '.kkkkkkkkkkkkkkkkkkkkkkjkkkkkkkkkkkkkkkkkkkkk.',
    'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
    'ffffffffffffffffffffffffffffffffffffffffffffff',
    '..............................................',
] },
  // 奖杯：杯身 + 双耳 + 底座
  trophy: { w: 15, h: 16, pal: { 'a': '#5a3c14', 'b': '#8a6320', 'c': '#b98c2e', 'd': '#dfb455', 'e': '#f6dd94', 'f': '#f6efdc', 'g': '#d9ccae', 'h': '#3a2418' }, rows: [
    '...............',
    '...............',
    '...............',
    '......f........',
    '..deefeeeeeed..',
    '..cdddddddddc..',
    '..c.eeddddc.c..',
    '..c.eddddcc.c..',
    '....dddcccc....',
    '.....dcccc.....',
    '...............',
    '......dcc......',
    '......dcc......',
    '....ccccccc....',
    '....baaaaab....',
    '...............'
  ] },
  // 食盆：碗体 + 食物堆
  bowl: { w: 21, h: 13, pal: { 'a': '#2e3d46', 'b': '#3f5460', 'c': '#54707e', 'd': '#6f8d9b', 'e': '#a8c2cc', 'f': '#7a4a2a', 'g': '#9c6238', 'h': '#c0824c', 'i': '#d99a5e' }, rows: [
    '.....................',
    '.....................',
    '.....................',
    '...............i.....',
    '.....ddddiidddhgd....',
    '...ddahhhgggfffaadd..',
    '...daaahgggfffaaaad..',
    '..dddddaaaaaaaadddbb.',
    '...ddddccccccbbbbbb..',
    '...dddccccccbbbbbbb..',
    '....ddccccccbbbbbb...',
    '....aaaaaaaaaaaaaa...',
    '.....................'
  ] },
  // 绿植：陶盆 + 六片叶
  plant: { w: 16, h: 22, pal: { 'a': '#2c6b3a', 'b': '#3f8a4b', 'c': '#5cb96b', 'd': '#8fe09b', 'p': '#8a4a30', 'q': '#b36141', 'r': '#cf7d59' }, rows: [
    '................',
    '................',
    '................',
    '................',
    '................',
    '.....dddcc......',
    '....dddcccb.....',
    '....ddcccbbd....',
    '..dddcccbbbdcc..',
    '..ddcccbbbdccc..',
    '..dcccbd.dcccb..',
    '.ddccbbcccccddc.',
    '.dcbbbbpcccddcb.',
    '.cbbbccpbbbbcbb.',
    '...rrrrprrrrr...',
    '....rrrrrrrr....',
    '....qqqqqqqq....',
    '....qppppppq....',
    '....qppppppq....',
    '....qqqqqqqq....',
    '....pppppppp....',
    '................'
  ] },
  // 书堆：三本叠放
  books: { w: 20, h: 11, pal: { 'a': '#2a1c14', 'b': '#3f5f8a', 'c': '#557aa8', 'd': '#8a5a2a', 'e': '#b07a3a', 'f': '#7a3a30', 'g': '#9c4e40', 'p': '#e6dcc4', 'q': '#f4eeda' }, rows: [
    '....................',
    '....................',
    '......eeeeeeeee.....',
    '.....eeeeeeeeeee....',
    '.....adddddddqqq....',
    '....acccccacccppp...',
    '....abbbbbabbbppp...',
    '...aggggggagggppp...',
    '...affffffffffppp...',
    '...affffffffffppp...',
    '....................'
  ] },
  // 窗帘：上端收褶 + 四道竖褶 + 底摆
  curtain: { w: 16, h: 38, pal: { 'a': '#4a2a37', 'b': '#66394a', 'c': '#8c5064' }, rows: [
    '................',
    '.....cccccc.....',
    '....aaaaaaaa....',
    '....aaaaaaaa....',
    '...acbabcbaca...',
    '...acbabcbaca...',
    '...acbabcbaca...',
    '..bacbabcbacab..',
    '..bacbabcbacab..',
    '..bacbabcbacab..',
    '..bacbabcbacab..',
    '..bacbabcbacab..',
    '..bacbabcbacab..',
    '..bacbabcbacab..',
    '..bacbabcbacab..',
    '..bacbabcbacab..',
    '..bacbabcbacab..',
    '..bacbabcbacab..',
    '..bacbabcbacab..',
    '..bacbabcbacab..',
    '..bacbabcbacab..',
    '..bacbabcbacab..',
    '..bacbabcbacab..',
    '..bacbabcbacab..',
    '..bacbabcbacab..',
    '..bacbabcbacab..',
    '..bacbabcbacab..',
    '..bacbabcbacab..',
    '..bacbabcbacab..',
    '..bacbabcbacab..',
    '..bacbabcbacab..',
    '..bacbabcbacab..',
    '..bacbabcbacab..',
    '..bacbabcbacab..',
    '..aaaaaaaaaaaa..',
    '..aaaaaaaaaaaa..',
    '..aaaaaaaaaaaa..',
    '................'
  ] },
  // 白天窗帘（v0.27.0 _art7.py）：形状复用夜帘（单字符调色板的好处），布色换米黄 —— 阳光下的棉布帘。
  curtainDay: { w: 16, h: 38, pal: { 'a': '#e3cda2', 'b': '#c9ab78', 'c': '#f7ecd0' }, rows: [
    '................',
    '.....cccccc.....',
    '....aaaaaaaa....',
    '....aaaaaaaa....',
    '...acbabcbaca...',
    '...acbabcbaca...',
    '...acbabcbaca...',
    '..bacbabcbacab..',
    '..bacbabcbacab..',
    '..bacbabcbacab..',
    '..bacbabcbacab..',
    '..bacbabcbacab..',
    '..bacbabcbacab..',
    '..bacbabcbacab..',
    '..bacbabcbacab..',
    '..bacbabcbacab..',
    '..bacbabcbacab..',
    '..bacbabcbacab..',
    '..bacbabcbacab..',
    '..bacbabcbacab..',
    '..bacbabcbacab..',
    '..bacbabcbacab..',
    '..bacbabcbacab..',
    '..bacbabcbacab..',
    '..bacbabcbacab..',
    '..bacbabcbacab..',
    '..bacbabcbacab..',
    '..bacbabcbacab..',
    '..bacbabcbacab..',
    '..bacbabcbacab..',
    '..bacbabcbacab..',
    '..bacbabcbacab..',
    '..bacbabcbacab..',
    '..bacbabcbacab..',
    '..aaaaaaaaaaaa..',
    '..aaaaaaaaaaaa..',
    '..aaaaaaaaaaaa..',
    '................'
  ] },
  // 窗帘杆：木杆 + 球头 + 两个墙托
  rod: { w: 66, h: 9, pal: { 'a': '#3a2619', 'b': '#5c3d29', 'c': '#7d5334' }, rows: [
    '..................................................................',
    '..................................................................',
    '..................................................................',
    '..cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc..',
    '..cccbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbccc..',
    '..cccaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaccc..',
    '...............aa................................aa...............',
    '...............aa................................aa...............',
    '..................................................................'
  ] },
  // 墙挂板：书 + 罐 + 小盆栽
  wallshelf: { w: 28, h: 14, pal: { 'a': '#2a1c12', 'b': '#6b4425', 'c': '#8d5f33', 'd': '#b98a52', '1': '#4a90d9', '2': '#e05656', '3': '#4caf6e', 'q': '#b36141', 'g': '#4fa85c' }, rows: [
    '............................',
    '............................',
    '.....22......aa....ggg......',
    '...d122.....cccc..ggggg.....',
    '...112233...bbbb..ggggg.....',
    '...112233...bbbb...ggg......',
    '...112233...bbbb...qqq......',
    '.dddddddddddddddddddddddddd.',
    '.cccccccccccccccccccccccccc.',
    '.aaaaaaaaaaaaaaaaaaaaaaaaaa.',
    '..aabbaaaaaaaaaaaaaaaabbaa..',
    '..aabbaaaaaaaaaaaaaaaabbaa..',
    '....bb................bb....',
    '............................'
  ] },
  clock: { w: 12, h: 12, pal: { 'a': '#5a3c14', 'b': '#8a6320', 'c': '#b98c2e', 'd': '#dfb455', 'e': '#f6dd94', 'f': '#f6efdc', 'g': '#d9ccae', 'h': '#3a2418' }, rows: [
    '............',
    '.....bb.....',
    '....dddd....',
    '...ddffcc...',
    '..ddfhffcc..',
    '..dffhhffb..',
    '..dffgfffb..',
    '..cffffffb..',
    '...ccffbb...',
    '...bbbbbb...',
    '...bb..bb...',
    '............'
  ] },
  // v0.37.0：墙上的小相框改成「心意」入口 —— 相框里放一颗心，
  // 它比一件纯装饰更值得点：这面墙承载回忆，也承载今天想说的话。
  // 15 行里 8 行留给心形：两瓣 + 尖底，左瓣点一块高光，远看也读得出是心，不是一团粉。
  frame: { w: 16, h: 15, pal: { a: '#5a3c1c', b: '#c9a227', c: '#f2e8d4', d: '#e86a86', e: '#ff9ebb' }, rows: [
    '................',
    '.aaaaaaaaaaaaaa.',
    '.abbbbbbbbbbbba.',
    '.abccccccccccba.',
    '.ab..ee..dd..ba.',
    '.ab.eedddddd.ba.',
    '.abddddddddddba.',
    '.abddddddddddba.',
    '.ab.dddddddd.ba.',
    '.ab..dddddd..ba.',
    '.ab...dddd...ba.',
    '.ab....dd....ba.',
    '.abccccccccccba.',
    '.abbbbbbbbbbbba.',
    '.aaaaaaaaaaaaaa.'
  ] },
  lamp: { w: 8, h: 11, pal: { a: '#8a5f38', b: '#ffe9a8', c: '#fff7d8' }, rows: [
    '..aaaa..',
    '.abbbba.',
    '.abcaba.',
    'aabccbaa',
    '.abcaba.',
    '.abbbba.',
    '..aaaa..',
    '...aa...',
    '...aa...',
    '..aaaa..',
    '.aaaaaa.'
  ] },
  poster: { w: 12, h: 14, pal: { a: '#4f3620', b: '#2b2238', c: '#4a90d9', d: '#ffe08a', e: '#f5f0e6', f: '#ff8fa3' }, rows: [
    'aaaaaaaaaaaa',
    'abbbbbbbbbba',
    'abceeeeeecba',
    'abceffffecba',
    'abcefdddfeba',
    'abceffffecba',
    'abceeeeeecba',
    'abbbbbbbbbba',
    'abcddddddcba',
    'abcddddddcba',
    'abcddddddcba',
    'abbbbbbbbbba',
    'aaaaaaaaaaaa',
    'aaaaaaaaaaaa'
  ] },
  gift: { w: 15, h: 14, pal: { 'a': '#7a2e2e', 'b': '#a83e3e', 'c': '#c95a52', 'd': '#e08a78', 'e': '#c9a227', 'f': '#e8c65a', 'g': '#8a6a18' }, rows: [
    '...............',
    '...............',
    '....ff..ff.....',
    '....eeffee.....',
    '....gg..gg.....',
    '..ddddefeddda..',
    '..bbbbefebbba..',
    '..bbbbefebbba..',
    '..bbbbefebbba..',
    '..bbbbefebbba..',
    '..bbbbefebbba..',
    '..aaaaefeaaaa..',
    '...............',
    '...............'
  ] },
  fishd: { w: 7, h: 4, pal: { a: '#c9a227', b: '#ffd76e' }, rows: [
    '..aa...',
    '.aabba.',
    'aabbbba',
    '.aaaaa.'
  ] },
  // v0.31.0：毛线球。原来 8×6（40×30px）在 1043 宽的房间里小得像粒豆子，
  // 而且角色（z=6）走上去就把家具（z=5）整个盖住 —— 40×30 被盖时几乎看不见。
  // 放大到 12×12（60×60），右侧留一截拖出去的线头，远看也知道是团线。
  yarn: { w: 12, h: 12, pal: { a: '#7a2f47', b: '#d9506b', c: '#ff9ebb', d: '#ffe3ea' }, rows: [
    '............',
    '....aaaa....',
    '..aabbbbaa..',
    '.aabbbbbbaa.',
    '.abbcbbbbba.',
    'abbbcbbbbbba',
    'abbbbbccbbba',
    'abbbbbbbbbba',
    '.abbbbbbbba.',
    '..aabbbbaa..',
    '....aaaa....',
    '.........ac.'
  ] },
};

// 家具清单（联机大地图 = 扩这张表）：
// wall = 靠后墙；hang = 挂在墙上（top 定位）；deco = 纯装饰（不可点无标签）；
// walkX = 角色走过去交互时站的横向位置（%）。
// 三条地面纵深线（距房间顶部的百分比）。房间高 636px 时分别是
// 448 / 512 / 578 —— 墙地交界线在 58%，往回退的三排家具。
// 落在这三条以外 = 「摆放位置有问题」；加物件时先选行，不要再写 bottom。
var GROUND_ROWS = { back: 29.56, mid: 19.5, front: 9.12, wall: 39.9 };

var SCENE_OBJECTS = [
  // ============================================================
  // 房间陈设。只允许落在三条地面纵深线上（见 GROUND_ROWS）。
  //
  // 上一版的问题：每件物件自己写一个 bottom —— 394 / 445 / 488 / 509 /
  // 528 / 560 / 585 / 598 / 604，七条互不相干的地平线。眼睛看到的是
  // 「家具随便摆在一块大空地上」，这就是「摆放位置有问题」的来源。
  // 现在只有三行：back(贴墙) / mid(中景) / front(前景)。
  //
  // 横向三簇，簇与簇之间留路：
  //   左簇 休息（床 / 食盆 / 礼物）   中簇 陪读（书桌压在窗下）   右簇 收藏 + 出口
  // ============================================================

  // ---- 左簇：休息 ----
  { id: 'bed',     name: '小窝', act: 'bed',    x: 16.7, row: 'back',  walkX: 23 },
  { id: 'bowl',    name: '喂食', act: 'feed',   x: 9.9,  row: 'front', walkX: 16 },
  { id: 'gift',    name: '惊喜', act: 'gift',   x: 22.4, row: 'front', walkX: 28 },
  // v0.31.0「逗它玩」：放在门的左侧、房间最右边。
  // 为什么不是在左簇（挨着礼物盒）：宠物闲逛的 x 范围是 15%~78%，身体框半宽 6.7%，
  // 只要球落在 8.3%~84.7% 之间，它一站过来就把球连同点击一起盖住
  // （实测连点 12 次才命中一次）。90% 在闲逛范围外，站着也压不到。
  { id: 'ball',    name: '逗它玩', act: 'play',   x: 90,   row: 'front', walkX: 88, art: 'yarn' },

  // ---- 中簇：陪读（书桌正对窗，光的落点就是工作区）----
  { id: 'desk',    name: null,   act: null,     x: 46.0, row: 'mid', deco: true },
  { id: 'clock',   name: '专注', act: 'focus',  x: 44.0, row: 'sit:desk', walkX: 38 },

  // ---- 右簇：收藏 + 出口 ----
  { id: 'shelf',   name: '图鉴', act: 'dex',    x: 66.7, row: 'back', walkX: 60 },
  { id: 'trophy',  name: '排行', act: 'rank',   x: 66.7, row: 'sit:shelf', walkX: 60 },
  { id: 'plant',   name: null,   act: null,     x: 79.2, row: 'back', deco: true },
  { id: 'door',    name: '冒险', act: 'battle', x: 90.6, row: 'wall', walkX: 84 },

  // ---- 墙面（hang：topY 是距顶百分比，不是地面线）----
  // 窗是主光源也是焦点：窗帘把它框住，书桌正好在窗下。
  { id: 'curtain',  name: null, act: null,      x: 30, hang: true, topY: 5,  deco: true },
  { id: 'curtain2', name: null, act: null,      x: 62, hang: true, topY: 5,  art: 'curtain', deco: true },
  { id: 'rod',      name: null, act: null,      x: 46, hang: true, topY: 3,  deco: true },
  { id: 'window',   name: '窗外', act: 'window', x: 46, hang: true, topY: 8, walkX: 46 },
  { id: 'poster',   name: null, act: null,      x: 19, hang: true, topY: 8,  deco: true },
  { id: 'wallshelf', name: null, act: null,     x: 18, hang: true, topY: 24, deco: true },
  // v0.37.0：相框从纯装饰变成「心意」入口（情绪 / 谈心 / 陪伴 / 回忆）。
  { id: 'frame',    name: '心意', act: 'heart',  x: 79, hang: true, topY: 16, walkX: 79 },
  { id: 'lamp',     name: null, act: null,      x: 6,  hang: true, topY: 22, deco: true }
];


// ---------- 场景弹层 ----------
var worldSheetEl = null;
// immediate = true 才是「立刻消失」（换内容时用）。
// 正常关闭走 160ms 的退场动画：面板下沉 + 淡出，scrim 同步淡掉 ——
// 直接 removeChild 会让一层 74% 高的面板「啪」地不见，比没有动画更生硬。
function worldSheetClose(immediate) {
  var el = worldSheetEl;
  if (!el) return;
  worldSheetEl = null;
  if (!el.parentNode) return;
  if (immediate === true) { el.parentNode.removeChild(el); return; }
  el.classList.add('is-closing');
  setTimeout(function() {
    if (el.parentNode) el.parentNode.removeChild(el);
    // 面板开着时被推迟的那次重绘，在这里补上（关掉之后才允许重建场景）
    if (pendingHomeRender) { pendingHomeRender = false; renderHomeWhenIdle(); }
  }, 170);
}
function worldSheet(title, build) {
  worldSheetClose(true);
  var wrap = h('div', 'world-sheet-wrap');
  var scrim = h('div', 'world-sheet-scrim');
  scrim.addEventListener('click', function() { worldSheetClose(); });
  var panel = h('div', 'world-sheet');
  var head = h('div', 'world-sheet-head');
  head.appendChild(h('span', 'world-sheet-title', title));
  var x = h('button', 'world-sheet-x', '✕');
  x.addEventListener('click', function() { worldSheetClose(); });
  head.appendChild(x);
  var body = h('div', 'world-sheet-body');
  build(body);
  panel.appendChild(head);
  panel.appendChild(body);
  wrap.appendChild(scrim);
  wrap.appendChild(panel);
  root.appendChild(wrap);
  worldSheetEl = wrap;
}

// 弹层内容：小窝（心情/任务/日记/故事/设置）
function nestSheetBody(body) {
  var mood = moodInfo || petMood();
  var moodRow = h('div', 'world-nest-mood');
  moodRow.appendChild(h('span', 'world-nest-moodicon', (mood && mood.icon) || '🙂'));
  var mt = h('div', 'world-nest-moodtext');
  mt.appendChild(h('b', 'world-nest-moodname', (mood && mood.name) || '心情不错'));
  mt.appendChild(h('span', 'world-nest-mooddesc', (mood && mood.text) || ''));
  moodRow.appendChild(mt);
  body.appendChild(moodRow);

  var q = questCard();
  if (q) body.appendChild(q);
  var d = diaryCard();
  if (d) body.appendChild(d);
  var s = storyCard();
  if (s) body.appendChild(s);
  var a = autonomyCard();
  if (a) body.appendChild(a);

  // 设置区：显示开关 + 改名 + 诊断收进来
  body.appendChild(sectionTitle('设置'));
  var misc = h('div', 'ci-pet-misc');
  var toggleRow = h('div', 'ci-pet-toggle-row');
  toggleRow.appendChild(h('span', null, '在桌面显示'));
  var sw = h('button', 'ci-pet-switch' + (state.enabled !== false ? ' ci-pet-switch--on' : ''));
  sw.addEventListener('click', function() {
    var nx = state.enabled === false;
    sw.classList.toggle('ci-pet-switch--on', nx);
    api.put('/pet/state', { enabled: nx }).then(function(res) {
      state = (res.data && res.data.data && res.data.data.state) || state;
      notifyChanged();
    });
  });
  toggleRow.appendChild(sw);
  misc.appendChild(toggleRow);
  // 形象入口并入小窝：场景里不再摆画板（它占地大、语义弱，
  // 「换个样子」本来就属于「关于它的一切」这个面板）。
  var lookRow = h('div', 'ci-pet-btnrow');
  var look = h('button', 'ci-pet-btn ci-pet-btn--ghost', '🎨 换个样子');
  look.addEventListener('click', function() {
    worldSheet('画板 · 形象', easelSheetBody);
  });
  lookRow.appendChild(look);
  misc.appendChild(lookRow);

  var renameRow = h('div', 'ci-pet-btnrow');
  var rename = h('button', 'ci-pet-btn ci-pet-btn--ghost', '✏️ 改名字');
  rename.addEventListener('click', function() {
    worldSheetClose();
    if (!(state.design && state.design.type === 'video') && state.design) {
      edit = makeEditState(state.design.data, state.design.w, state.design.h);
    }
    renderNaming(state.design && state.design.type === 'video' ? 'video' : 'pixel');
  });
  renameRow.appendChild(rename);
  misc.appendChild(renameRow);
  var adv = h('details', 'ci-pet-adv');
  adv.appendChild(h('summary', null, '桌宠没出现？点开诊断'));
  var diagOut = h('pre', 'ci-pet-adv-out');
  adv.appendChild(diagOut);
  adv.addEventListener('toggle', function() { if (adv.open) diagOut.textContent = buildDiag(); });
  misc.appendChild(adv);
  body.appendChild(misc);
}

// 弹层内容：画板（形象切换）
function easelSheetBody(body) {
  var isVideoPet = state.design && state.design.type === 'video';
  var styles = h('div', 'ci-pet-styles');
  var cWhale = h('div', 'ci-pet-stylecard' + (isVideoPet ? ' is-active' : ''));
  cWhale.appendChild(h('div', 'ci-pet-stylecard-art ci-pet-tpl-emoji', '🐳'));
  cWhale.appendChild(h('div', 'ci-pet-stylecard-name', '大肥鱼'));
  cWhale.appendChild(h('div', 'ci-pet-stylecard-desc', '100+ 个动作，会跳舞'));
  if (isVideoPet) {
    cWhale.appendChild(h('span', 'ci-pet-stylecard-tag', '使用中'));
  } else {
    var uw = h('button', 'ci-pet-stylecard-btn', '使用');
    uw.addEventListener('click', function() {
      savePixelDraft();
      switchDesign({ type: 'video', character: 'dsh-whale' }, uw, '使用');
    });
    cWhale.appendChild(uw);
  }
  styles.appendChild(cWhale);
  var cPixel = h('div', 'ci-pet-stylecard' + (!isVideoPet ? ' is-active' : ''));
  var shown = !isVideoPet && state.design ? state.design : null;
  if (!shown) {
    var sv0 = null;
    try { sv0 = storage && storage.get('lastPixel', null); } catch (e) {}
    if (sv0 && sv0.data) shown = sv0;
  }
  if (shown && shown.data) {
    var pv = document.createElement('canvas');
    paint(pv, shown, 5);
    cPixel.appendChild(pv);
  } else {
    cPixel.appendChild(h('div', 'ci-pet-stylecard-art ci-pet-tpl-emoji', '🎨'));
  }
  cPixel.appendChild(h('div', 'ci-pet-stylecard-name', '手作拼豆'));
  cPixel.appendChild(h('div', 'ci-pet-stylecard-desc', '自己画的小家伙'));
  if (!isVideoPet) {
    cPixel.appendChild(h('span', 'ci-pet-stylecard-tag', '使用中'));
    var rb = h('button', 'ci-pet-stylecard-btn', '再改改');
    rb.addEventListener('click', function() {
      worldSheetClose();
      var cur = state.design;
      startEditor(cur && cur.data, cur && cur.w, cur && cur.h);
    });
    cPixel.appendChild(rb);
  } else {
    var up = h('button', 'ci-pet-stylecard-btn', shown && shown.data ? '换回来' : '去画一只');
    up.addEventListener('click', function() {
      worldSheetClose();
      var sv = null;
      try { sv = storage && storage.get('lastPixel', null); } catch (e) {}
      startEditor(sv && sv.data ? sv.data : '', sv && sv.w, sv && sv.h);
    });
    cPixel.appendChild(up);
  }
  styles.appendChild(cPixel);
  body.appendChild(styles);
}

// 弹层内容：今日惊喜（签到 / 奇遇 / 离线）
function giftSheetBody(body) {
  var pushed = false;
  if (dailyBonusInfo) {
    var b = dailyBonusInfo;
    var r1 = h('div', 'world-gift-row');
    r1.appendChild(h('span', 'world-gift-icon', '🎁'));
    var t1 = h('div', 'world-gift-text');
    t1.appendChild(h('b', null, b.granted ? '今日签到 · 连续 ' + (b.streak || 1) + ' 天' : '已签到 · 连续 ' + (b.streak || 1) + ' 天'));
    t1.appendChild(h('span', null, b.granted ? ('+' + (b.coins || 0) + ' 小鱼干 +' + (b.bond || 0) + ' 羁绊') : '明天再来领新奖励'));
    r1.appendChild(t1);
    body.appendChild(r1);
    pushed = true;
  }
  if (wonderInfo && wonderInfo.wonder) {
    var w = wonderInfo;
    var r2 = h('div', 'world-gift-row');
    r2.appendChild(h('span', 'world-gift-icon', w.wonder.icon || '✨'));
    var t2 = h('div', 'world-gift-text');
    t2.appendChild(h('b', null, '今日奇遇 · ' + w.wonder.title));
    t2.appendChild(h('span', null, w.wonder.text || ''));
    r2.appendChild(t2);
    if (!w.claimed && w.reward) {
      var pill = h('button', 'world-gift-claim', '领取');
      pill.addEventListener('click', function() {
        pill.disabled = true; pill.textContent = '发现中…';
        api.post('/pet/wonder/claim', {}).then(function(res) {
          var d = (res.data && res.data.data) || {};
          if (d.state) state = d.state;
          if (d.wonder) wonderInfo = d.wonder;
          absorbProgress(d);
          if (window.__ciPetSfx) window.__ciPetSfx.play('coin');
          sysToast(w.wonder.title + '：+' + (d.addedCoins || 0) + ' 鱼干 +' + (d.addedBond || 0) + ' 羁绊', 'success');
          worldSheetClose();
        }, function(err) {
          pill.disabled = false; pill.textContent = '领取';
          sysToast((err && err.response && err.response.data && err.response.data.message) || '领取失败', 'error');
        });
      });
      r2.appendChild(pill);
    } else {
      r2.appendChild(h('span', 'world-gift-done', '✓'));
    }
    body.appendChild(r2);
    pushed = true;
  }
  var r = offlineRecapInfo;
  if (r && r.events && r.events.length) {
    var r3 = h('div', 'world-gift-row');
    r3.appendChild(h('span', 'world-gift-icon', '🌙'));
    var t3 = h('div', 'world-gift-text');
    t3.appendChild(h('b', null, '你不在的 ' + (r.gapMin || 0) + ' 分钟'));
    t3.appendChild(h('span', null, r.msg || ''));
    r3.appendChild(t3);
    body.appendChild(r3);
    pushed = true;
  }
  if (!pushed) body.appendChild(h('div', 'world-gift-empty', '今天暂时没有惊喜，明天再来。'));
}

// ==================== 情感陪伴 · 心意（v0.37.0）====================
// 全程静态台词 + 服务端状态机，不接任何模型。
// 页面负责把「情绪 / 心情 / 陪伴动作 / 谈心 / 晚安 / 回忆」排成一张像素手账；
// 台词、奖励、能不能做，全部由 /pet/heart 系列接口判定，前端只渲染结果。
var heartBodyEl = null;
var heartEcho = null;          // 最近一次陪伴动作的回话
var heartTalkState = null;     // 谈心流程（null = 还在选题）

// 断网/桩环境下的选题兜底：id 与后端一致，点了仍然会发请求；
// 请求失败就停在“它现在有点害羞”，不会白屏。
var TALK_TOPIC_FALLBACK = [
  { id: 'happy', icon: '🌞', name: '有件开心的事', userLine: '今天有件开心的事，想跟你讲。' },
  { id: 'tired', icon: '🌧️', name: '今天有点累', userLine: '今天有点累，想在你旁边待一会儿。' },
  { id: 'sad', icon: '🫧', name: '心里有点难过', userLine: '心里有点难过，不太想说话。' },
  { id: 'angry', icon: '🔥', name: '有件让我生气的事', userLine: '有件事让我很生气，越想越气。' },
  { id: 'lonely', icon: '🌙', name: '有点想找人说话', userLine: '有点想找人说话，就来找你了。' },
  { id: 'excited', icon: '✨', name: '有件期待的事', userLine: '有件很期待的事，想想就开心。' }
];

function heartClear(el) {
  while (el && el.firstChild) el.removeChild(el.firstChild);
}

function heartNum(v) {
  v = Number(v);
  return isFinite(v) ? v : 0;
}

// 十段像素心情条：段与段之间留 2px，填充段按序点亮（延迟由内联 style 给）
function heartMoodBar(value) {
  var bar = h('div', 'world-feel-moodbar');
  var n = Math.round(Math.max(0, Math.min(100, heartNum(value)) / 10));
  for (var i = 0; i < 10; i++) {
    var seg = h('i', 'world-feel-seg' + (i < n ? ' is-fill' : ''));
    seg.style.animationDelay = (i * 22) + 'ms';
    bar.appendChild(seg);
  }
  return bar;
}

// 区块标题：金方块 + 标题 + 虚线延展 + 右侧计数。
// 虚线是「手账分隔线」的像素说法，比一整条实线更轻，不会和卡片硬投影抢重量。
function heartSection(title, countText) {
  var row = h('div', 'world-feel-section');
  row.appendChild(h('span', 'world-feel-secbullet'));
  row.appendChild(h('span', 'world-feel-sectitle', title));
  row.appendChild(h('i', 'world-feel-rule'));
  if (countText) row.appendChild(h('span', 'world-feel-count', countText));
  return row;
}

// 入场：只在第一次打开面板时逐块上浮，后续交互重绘不播（否则每抱一下整页都在闪）
function heartBlock(el, index, animate) {
  if (animate === false) return el;
  el.classList.add('world-feel-block');
  el.style.animationDelay = Math.min(index, 8) * 46 + 'ms';
  return el;
}

function heartLocalDate(iso) {
  if (!iso) return '';
  var d = new Date(iso);
  if (isNaN(d.getTime())) return String(iso).slice(0, 10);
  return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
}

// 情感图标：一律走项目自带的像素图标流水线（12×12 → 内联 SVG）。
// 深色底上 emoji 会退化成单色小字，配色也不受控 —— 这正是内页图标当年被换掉的原因。
var HEART_ICON_MAP = {
  // 陪伴动作
  hug: 'hug', groom: 'groom', daze: 'cloud',
  // 谈心话题
  happy: 'sun', tired: 'rain', sad: 'drop', angry: 'fire', lonely: 'moon', excited: 'sparkle',
  // 情绪（头像框里那张「脸」也走像素图标，比 emoji 更贴屋子）
  miss: 'hug', sleepy: 'moon', down: 'rain', hungry: 'fish',
  bliss: 'sparkle', wait: 'sun', calm: 'cloud'
};
function heartIcon(id, cls, fallback) {
  var key = HEART_ICON_MAP[id];
  if (key) {
    var ic = pixIcon(key, cls);
    if (ic) { ic.classList.add('world-feel-pix'); return ic; }
  }
  return h('span', cls || null, fallback || '');
}

// 回忆册图标：同样用像素图标（各平台 emoji 渲染差异太大，剪贴簿会花掉）
var HEART_MEM_ICON = {
  first_meet: 'grass', first_feed: 'fish', first_focus: 'sun',
  first_talk: 'sparkle', talk_5: 'sparkle', talk_20: 'hug',
  night_3: 'moon', late_talk: 'moon', streak_7: 'sun',
  bond_60: 'hug', days_30: 'home', wonder_7: 'fish'
};
function heartMemoryIcon(id, unlocked) {
  var box = h('span', 'world-feel-memoryicon');
  if (!unlocked) {
    var lk = pixIcon('lock', 'world-feel-memory-pix');
    if (lk) { box.appendChild(lk); return box; }
    box.appendChild(document.createTextNode('🔒'));
    return box;
  }
  var ic = pixIcon(HEART_MEM_ICON[id] || 'sparkle', 'world-feel-memory-pix');
  if (ic) box.appendChild(ic);
  else box.appendChild(document.createTextNode('💗'));
  return box;
}

function heartMemoryToast(list) {
  if (!list || !list.length) return;
  for (var i = 0; i < list.length && i < 2; i++) {
    (function(m, idx) {
      setTimeout(function() {
        sysToast('它记住了 · ' + (m.title || '一件小事'), 'success');
      }, idx * 420);
    })(list[i], i);
  }
}

function heartDispatch() {
  try { window.dispatchEvent(new CustomEvent('ci-pet-heart')); } catch (e) {}
}

function heartRefresh() {
  if (!heartBodyEl || !heartBodyEl.isConnected) return;
  var sc = heartBodyEl.scrollTop;
  renderHeartSheet(heartBodyEl, false);
  heartBodyEl.scrollTop = sc;
}

// 骨架：比一行「加载中」更像一个正在翻开的本子
function heartSkeleton() {
  var wrap = h('div', 'world-feel-skel');
  wrap.appendChild(h('div', 'world-feel-skelhero'));
  for (var i = 0; i < 3; i++) {
    wrap.appendChild(h('div', 'world-feel-skelrow' + (i === 0 ? ' is-short' : '')));
  }
  return wrap;
}

function openHeartSheet() {
  heartEcho = null;
  heartTalkState = null;
  heartBodyEl = null;
  worldSheet('心意 · 它记得的事', function(body) {
    heartBodyEl = body;
    body.appendChild(heartSkeleton());
    if (!api) { renderHeartSheet(body, true); return; }
    // seen=1：告诉服务端「我真的看到它了」，回来时的「很想你」到此为止。
    api.get('/pet/heart?seen=1').then(function(res) {
      if (!body.isConnected) return;
      var d = (res.data && res.data.data) || {};
      if (d.state) state = d.state;
      heartInfo = d;
      heartMemoryToast(d.memoriesNew);
      renderHeartSheet(body, true);
    }, function() {
      if (!body.isConnected) return;
      renderHeartSheet(body, true);
      sysToast('它现在有点害羞，先用旧的记忆给你看', 'info');
    });
  });
}

function renderHeartSheet(body, animate) {
  var d = heartInfo || {};
  var em = d.emotion || { id: 'calm', name: '平静', icon: '🌙', tone: 'mid', text: '在桌上待着，听你敲键盘。' };
  var mood = d.mood || { value: 60, label: '心情不错', tone: 'mid' };
  var persona = d.personality || personalityInfo || { name: '好奇', icon: '🔍', desc: '' };
  var stats = d.stats || {};
  var tone = em.tone || mood.tone || 'mid';

  heartClear(body);

  // ---- 情绪卡：头像框 + 名字/解释 + 心情条 + 一排小标签 ----
  var hero = h('div', 'world-feel-hero is-' + tone);
  var mainRow = h('div', 'world-feel-hero-main');
  var portrait = h('div', 'world-feel-portrait');
  portrait.appendChild(heartIcon(em.id, 'world-feel-face-pix', em.icon || '💗'));
  portrait.appendChild(h('i', 'world-feel-live'));
  mainRow.appendChild(portrait);

  var info = h('div', 'world-feel-info');
  var nameRow = h('div', 'world-feel-namerow');
  nameRow.appendChild(h('b', 'world-feel-name', em.name || '平静'));
  // 性格只用文字：emoji 在深色底上会是单色小点，和右边的心情数字抢不到注意力
  nameRow.appendChild(h('span', 'world-feel-persona', '· ' + (persona.name || '好奇')));
  info.appendChild(nameRow);
  info.appendChild(h('div', 'world-feel-reason', em.text || ''));
  var meter = h('div', 'world-feel-meter');
  meter.appendChild(h('span', 'world-feel-meterlabel', '心情'));
  meter.appendChild(heartMoodBar(mood.value));
  meter.appendChild(h('b', 'world-feel-meterval', String(heartNum(mood.value))));
  info.appendChild(meter);
  mainRow.appendChild(info);
  hero.appendChild(mainRow);

  var tags = h('div', 'world-feel-tags');
  tags.appendChild(h('span', 'world-feel-tag', '陪伴 ' + (stats.days || d.anniversaryDays || 1) + ' 天'));
  tags.appendChild(h('span', 'world-feel-tag is-gold',
    '羁绊 ' + (stats.bond || 0) + (stats.tierName ? ' · ' + stats.tierName : '')));
  hero.appendChild(tags);
  body.appendChild(heartBlock(hero, 0, animate));

  // ---- 它想对你说：奶白纸便签，左侧金条 + 引号 ----
  if (d.greeting) {
    var greet = h('div', 'world-feel-greet');
    greet.appendChild(h('span', 'world-feel-quote', '\u201C'));
    var gbody = h('div', 'world-feel-greetbody');
    gbody.appendChild(h('span', 'world-feel-greettag', '它想对你说'));
    gbody.appendChild(h('span', 'world-feel-greettext', d.greeting));
    greet.appendChild(gbody);
    body.appendChild(heartBlock(greet, 1, animate));
  }

  // ---- 最近一次互动的回话 ----
  if (heartEcho) {
    var echo = h('div', 'world-feel-echo');
    echo.appendChild(h('span', 'world-feel-echoicon', heartEcho.icon || '💬'));
    var et = h('div', 'world-feel-echotext');
    et.appendChild(h('span', 'world-feel-echoline', heartEcho.text || ''));
    if (heartEcho.rewardText) et.appendChild(h('span', 'world-feel-echoreward', heartEcho.rewardText));
    echo.appendChild(et);
    body.appendChild(heartBlock(echo, 2, animate));
  }

  // ---- 陪陪它 ----
  var acts = d.actions || [];
  var leftTotal = 0;
  var hasLeft = false;
  for (var ai = 0; ai < acts.length; ai++) {
    if (acts[ai] && acts[ai].left != null) { hasLeft = true; leftTotal += acts[ai].left; }
  }
  body.appendChild(heartBlock(heartSection('陪陪它',
    hasLeft ? ('还能陪 ' + leftTotal + ' 次') : ''), 3, animate));
  body.appendChild(heartBlock(heartActionsBox(d), 4, animate));

  // ---- 说心里话 ----
  var talk = d.talk || {};
  var talkCount = talk.left === 0 ? '今天聊够啦' : ('还能聊 ' + (talk.left === undefined ? 2 : talk.left) + ' 次');
  body.appendChild(heartBlock(heartSection('说心里话', talkCount), 5, animate));
  body.appendChild(heartBlock(heartTalkBox(d), 6, animate));

  // ---- 晚安 ----
  body.appendChild(heartBlock(heartNightBox(d), 7, animate));

  // ---- 回忆册 ----
  body.appendChild(heartBlock(heartMemoriesBox(d), 8, animate));

  body.appendChild(heartBlock(h('div', 'world-feel-foot',
    '它是' + (persona.name || '小家伙') + (persona.desc ? '：' + persona.desc : '') +
    '。你说过的话，它都记在小本子里。'), 9, animate));
}

function heartActionsBox(d) {
  var list = (d.actions && d.actions.length) ? d.actions : [
    { id: 'hug', name: '抱一抱', icon: '🤗', desc: '把它抱起来，让它听一会儿心跳', left: null, ready: true },
    { id: 'groom', name: '顺顺毛', icon: '🪶', desc: '从头顶顺到尾巴，慢慢来', left: null, ready: true },
    { id: 'daze', name: '一起发呆', icon: '🌙', desc: '什么都不做，就陪它坐一会儿', left: null, ready: true }
  ];
  var wrap = h('div', 'world-feel-actions');
  for (var i = 0; i < list.length; i++) {
    (function(a) {
      var off = a.ready === false;
      var btn = h('button', 'world-feel-act' + (off ? ' is-off' : ''));
      btn.setAttribute('data-feel-act', a.id);
      var head = h('span', 'world-feel-act-head');
      var iconBox = h('span', 'world-feel-act-icon');
      iconBox.appendChild(heartIcon(a.id, 'world-feel-act-pix', a.icon));
      head.appendChild(iconBox);
      head.appendChild(h('span', 'world-feel-act-name', a.name || '陪陪它'));
      btn.appendChild(head);
      btn.appendChild(h('span', 'world-feel-act-desc', a.desc || ''));

      var metaText, metaCls;
      if (a.cooldownSec > 0) {
        metaText = Math.ceil(a.cooldownSec / 60) + ' 分钟后再来';
        metaCls = 'is-cool';
      } else if (a.left === 0) {
        metaText = '今天做够啦';
        metaCls = 'is-done';
      } else if (a.left != null) {
        metaText = '还能 ' + a.left + ' 次';
        metaCls = 'is-ready';
      } else {
        metaText = '点一下试试';
        metaCls = 'is-ready';
      }
      btn.appendChild(h('span', 'world-feel-act-meta ' + metaCls, metaText));

      btn.addEventListener('click', function() {
        if (off) {
          sysToast(a.left === 0 ? ('今天的「' + (a.name || '这个') + '」已经做够啦') : '先让它缓一缓', 'info');
          return;
        }
        doHeartAct(a.id, btn);
      });
      wrap.appendChild(btn);
    })(list[i]);
  }
  return wrap;
}

function doHeartAct(id, btn) {
  if (!api) { sysToast('暂时连不上服务器，等会儿再陪它', 'info'); return; }
  if (btn) btn.disabled = true;
  api.post('/pet/heart/act', { action: id }).then(function(res) {
    var d = (res.data && res.data.data) || {};
    if (d.state) state = d.state;
    if (!heartInfo) heartInfo = {};
    if (d.emotion) heartInfo.emotion = d.emotion;
    if (d.mood) heartInfo.mood = d.mood;
    if (d.greeting) heartInfo.greeting = d.greeting;
    if (d.actions) heartInfo.actions = d.actions;
    if (d.goodnight) heartInfo.goodnight = d.goodnight;
    if (d.memories) heartInfo.memories = d.memories;
    if (d.stats) heartInfo.stats = d.stats;
    var rewardText = '';
    if (d.addedBond > 0) rewardText += '羁绊 +' + d.addedBond;
    if (d.gainedMood > 0) rewardText += (rewardText ? ' · ' : '') + '心情 +' + d.gainedMood;
    if (d.capped && !rewardText) rewardText = '今天的陪伴羁绊已经满了';
    heartEcho = { icon: '💬', text: d.line || '（它靠了过来）', rewardText: rewardText };
    heartMemoryToast(d.memoriesNew);
    try { if (window.__ciPetSfx) window.__ciPetSfx.play('poke'); } catch (e) {}
    if (root) {
      var pet = root.querySelector('.world-pet');
      if (pet) worldHearts(pet, 2);
    }
    heartDispatch();
    heartRefresh();
  }, function(err) {
    var msg = (err && err.response && err.response.data && err.response.data.message) || '它好像没准备好';
    sysToast(msg, 'info');
    if (btn) btn.disabled = false;
  });
}

// 气泡：奶白纸（它）／暖紫（我），带一个像素小尖角
function heartBubble(cls, text) {
  var row = h('div', 'world-feel-row' + (cls ? ' ' + cls : ''));
  row.appendChild(h('div', 'world-feel-bubble', text || ''));
  return row;
}

// 思考中的气泡：文字 + 三个跳动的小方块，比干等一句「加载中」有生命感
function heartTypingRow(label) {
  var row = h('div', 'world-feel-row is-typing');
  var b = h('div', 'world-feel-bubble world-feel-bubble--typing');
  b.appendChild(h('span', 'world-feel-typingtext', label || '它在想怎么接话'));
  var dots = h('span', 'world-feel-dots');
  for (var i = 0; i < 3; i++) dots.appendChild(h('i', 'world-feel-tdot'));
  b.appendChild(dots);
  row.appendChild(b);
  return row;
}

function heartTalkBox(d) {
  if (heartTalkState) return heartDialogBox(d);
  var talk = d.talk || {};
  var box = h('div', 'world-feel-talk');
  if (talk.left === 0) {
    box.appendChild(h('div', 'world-feel-talknote',
      '今天的心里话聊完了。还想说也可以，只是不再加羁绊 —— 它一样愿意听。'));
  }
  var topics = (talk.topics && talk.topics.length) ? talk.topics : TALK_TOPIC_FALLBACK;
  var grid = h('div', 'world-feel-topics');
  for (var i = 0; i < topics.length; i++) {
    (function(t) {
      var b = h('button', 'world-feel-topic');
      b.setAttribute('data-feel-topic', t.id);
      var tIcon = h('span', 'world-feel-topic-icon');
      tIcon.appendChild(heartIcon(t.id, 'world-feel-topic-pix', t.icon));
      b.appendChild(tIcon);
      var txt = h('span', 'world-feel-topic-text');
      txt.appendChild(h('span', 'world-feel-topic-name', t.name || ''));
      txt.appendChild(h('span', 'world-feel-topic-preview', t.userLine || ''));
      b.appendChild(txt);
      b.appendChild(h('span', 'world-feel-topic-arrow', '\u203A'));
      b.addEventListener('click', function() { startHeartTalk(t); });
      grid.appendChild(b);
    })(topics[i]);
  }
  box.appendChild(grid);
  return box;
}

function heartDialogBox(d) {
  var st = heartTalkState;
  var box = h('div', 'world-feel-dialog');
  var tag = h('div', 'world-feel-dialogtag');
  var tagIcon = h('span', 'world-feel-dialogicon');
  tagIcon.appendChild(heartIcon(st.topic.id, 'world-feel-dialog-pix', st.topic.icon));
  tag.appendChild(tagIcon);
  tag.appendChild(h('span', null, st.topic.name || '说心里话'));
  box.appendChild(tag);
  box.appendChild(heartBubble('is-me', st.topic.userLine));
  if (st.open) box.appendChild(heartBubble('', st.open));
  if (st.ask) box.appendChild(heartBubble('', st.ask));

  if (st.step === 1) {
    if (st.loading) {
      box.appendChild(heartTypingRow('它在想怎么接你的话'));
    } else {
      var choices = h('div', 'world-feel-choices');
      for (var i = 0; i < st.choices.length; i++) {
        (function(c) {
          var b = h('button', 'world-feel-choice');
          b.appendChild(h('span', 'world-feel-choice-text', c.label || ''));
          b.appendChild(h('span', 'world-feel-choice-arrow', '\u203A'));
          b.addEventListener('click', function() { chooseHeartTalk(c); });
          choices.appendChild(b);
        })(st.choices[i]);
      }
      box.appendChild(choices);
    }
    return box;
  }

  if (st.choiceLabel) box.appendChild(heartBubble('is-me', st.choiceLabel));
  if (st.loading) {
    box.appendChild(heartTypingRow('它认真想了一会儿'));
  } else {
    if (st.reply) box.appendChild(heartBubble('', st.reply));
    if (st.close) box.appendChild(heartBubble('', st.close));
    var rewardText = '';
    if (st.reward) {
      if (st.reward.bond > 0) rewardText += '羁绊 +' + st.reward.bond;
      if (st.reward.mood > 0) rewardText += (rewardText ? ' · ' : '') + '心情 +' + st.reward.mood;
    }
    if (st.capped) rewardText = '今天聊够啦，明天再讲给它听';
    if (rewardText) {
      var rw = h('div', 'world-feel-reward');
      var ri = h('span', 'world-feel-rewardicon');
      var rh = pixIcon('hug', 'world-feel-reward-pix');
      if (rh) ri.appendChild(rh); else ri.appendChild(document.createTextNode('\u2665'));
      rw.appendChild(ri);
      rw.appendChild(h('span', null, rewardText));
      box.appendChild(rw);
    }
    var next = h('div', 'world-feel-next');
    var again = h('button', 'world-feel-choice is-ghost');
    again.appendChild(h('span', 'world-feel-choice-text', '再说点别的'));
    again.addEventListener('click', function() { heartTalkState = null; heartRefresh(); });
    next.appendChild(again);
    var hug = h('button', 'world-feel-choice is-primary');
    hug.appendChild(h('span', 'world-feel-choice-text', '去抱抱它'));
    hug.addEventListener('click', function() { doHeartAct('hug', hug); });
    next.appendChild(hug);
    box.appendChild(next);
  }
  return box;
}

function startHeartTalk(topic) {
  if (!api) { sysToast('暂时连不上服务器，等会儿再聊', 'info'); return; }
  heartTalkState = { topic: topic, step: 0, loading: true };
  heartRefresh();
  api.post('/pet/heart/talk', { topic: topic.id }).then(function(res) {
    if (!heartTalkState || heartTalkState.topic.id !== topic.id) return;
    var d = (res.data && res.data.data) || {};
    heartTalkState = {
      topic: d.topic || topic,
      step: 1,
      open: d.open || '',
      ask: d.ask || '',
      choices: d.choices || [],
      loading: false
    };
    heartRefresh();
  }, function(err) {
    heartTalkState = null;
    heartRefresh();
    var msg = (err && err.response && err.response.data && err.response.data.message) || '它没听清';
    sysToast(msg, 'error');
  });
}

function chooseHeartTalk(choice) {
  var st = heartTalkState;
  if (!st || st.loading) return;
  st.loading = true;
  st.choiceLabel = choice.label || '';
  st.choiceId = choice.id || '';
  heartRefresh();
  api.post('/pet/heart/talk', { topic: st.topic.id, choice: st.choiceId }).then(function(res) {
    if (!heartTalkState || heartTalkState.topic.id !== st.topic.id) return;
    var d = (res.data && res.data.data) || {};
    if (d.state) state = d.state;
    if (!heartInfo) heartInfo = {};
    if (d.mood) heartInfo.mood = d.mood;
    if (d.emotion) heartInfo.emotion = d.emotion;
    if (d.greeting) heartInfo.greeting = d.greeting;
    if (d.talk) heartInfo.talk = d.talk;
    if (d.actions) heartInfo.actions = d.actions;
    if (d.goodnight) heartInfo.goodnight = d.goodnight;
    if (d.memories) heartInfo.memories = d.memories;
    if (d.stats) heartInfo.stats = d.stats;
    heartTalkState.step = 2;
    heartTalkState.loading = false;
    heartTalkState.reply = d.reply || '';
    heartTalkState.close = d.close || '';
    heartTalkState.reward = d.reward || null;
    heartTalkState.capped = !!d.capped;
    heartMemoryToast(d.memoriesNew);
    heartDispatch();
    heartRefresh();
  }, function(err) {
    if (heartTalkState) heartTalkState.loading = false;
    heartRefresh();
    var msg = (err && err.response && err.response.data && err.response.data.message) || '它没听清';
    sysToast(msg, 'error');
  });
}

function heartNightBox(d) {
  var n = d.goodnight || {};
  var cls = 'world-feel-night' + (n.done ? ' is-done' : (n.available ? ' is-open' : ''));
  var box = h('div', cls);
  var nIcon = h('span', 'world-feel-nighticon');
  var nm = pixIcon(n.done ? 'moon' : 'moon', 'world-feel-night-pix');
  if (nm) nIcon.appendChild(nm); else nIcon.appendChild(document.createTextNode('🌙'));
  box.appendChild(nIcon);
  var text = h('div', 'world-feel-nighttext');
  text.appendChild(h('b', 'world-feel-nighttitle',
    n.done ? '今晚已经说过晚安' : (n.available ? '跟它说晚安' : '它还不困')));
  var chipText;
  if (n.done) chipText = '连续 ' + (n.streak || 1) + ' 天 · 累计 ' + (n.total || 1) + ' 次';
  else if (n.available) chipText = n.streak ? ('已连续 ' + n.streak + ' 天') : '第一次说晚安';
  else chipText = '18:00 之后开放';
  text.appendChild(h('span', 'world-feel-nightchip', chipText));
  box.appendChild(text);
  if (n.available && !n.done) {
    var btn = h('button', 'world-feel-nightbtn', '晚安');
    btn.addEventListener('click', function() { doGoodnight(btn); });
    box.appendChild(btn);
  } else if (n.done) {
    box.appendChild(h('span', 'world-feel-nightdone', '\u2713'));
  }
  return box;
}

function doGoodnight(btn) {
  if (!api) { sysToast('暂时连不上服务器', 'info'); return; }
  if (btn) btn.disabled = true;
  api.post('/pet/heart/goodnight', {}).then(function(res) {
    var d = (res.data && res.data.data) || {};
    if (d.state) state = d.state;
    if (!heartInfo) heartInfo = {};
    if (d.mood) heartInfo.mood = d.mood;
    if (d.emotion) heartInfo.emotion = d.emotion;
    if (d.greeting) heartInfo.greeting = d.greeting;
    if (d.goodnight) heartInfo.goodnight = d.goodnight;
    if (d.memories) heartInfo.memories = d.memories;
    if (d.stats) heartInfo.stats = d.stats;
    var rewardText = '';
    if (d.addedBond > 0) rewardText += '羁绊 +' + d.addedBond;
    if (d.gainedMood > 0) rewardText += (rewardText ? ' · ' : '') + '心情 +' + d.gainedMood;
    heartEcho = { icon: '🌙', text: d.line || '晚安。', rewardText: rewardText || (d.already ? '它已经睡下了' : '') };
    heartMemoryToast(d.memoriesNew);
    try { if (window.__ciPetSfx) window.__ciPetSfx.play('focus-end'); } catch (e) {}
    heartDispatch();
    heartRefresh();
  }, function(err) {
    var msg = (err && err.response && err.response.data && err.response.data.message) || '它还没准备好睡';
    sysToast(msg, 'info');
    if (btn) btn.disabled = false;
  });
}

function heartMemoriesBox(d) {
  var mem = d.memories || [];
  var total = mem.length || 12;
  var got = 0;
  for (var i = 0; i < mem.length; i++) if (mem[i].unlocked) got++;
  var box = h('div', 'world-feel-memories');
  box.appendChild(heartSection('它珍藏的回忆', got + ' / ' + total));
  var prog = h('div', 'world-feel-prog');
  var fill = h('i', 'world-feel-progfill');
  fill.style.width = (total > 0 ? Math.round(got / total * 100) : 0) + '%';
  prog.appendChild(fill);
  box.appendChild(prog);
  if (!mem.length) {
    box.appendChild(h('div', 'world-feel-empty', '回忆还没翻出来，等它想起来会告诉你。'));
    return box;
  }
  var now = Date.now();
  var grid = h('div', 'world-feel-memorygrid');
  for (var j = 0; j < mem.length; j++) {
    (function(m) {
      var at = m.at ? new Date(m.at).getTime() : 0;
      var isNew = m.unlocked && at > 0 && (now - at) < 3 * 86400000;
      var card = h('div', 'world-feel-memory' + (m.unlocked ? ' is-on' : ' is-off'));
      card.appendChild(heartMemoryIcon(m.id, !!m.unlocked));
      var body = h('div', 'world-feel-memorybody');
      var nameRow = h('div', 'world-feel-memorynamerow');
      nameRow.appendChild(h('span', 'world-feel-memoryname', m.title || ''));
      if (isNew) nameRow.appendChild(h('span', 'world-feel-new', 'NEW'));
      body.appendChild(nameRow);
      body.appendChild(h('span', 'world-feel-memorysub',
        m.unlocked ? ('想起于 ' + heartLocalDate(m.at)) : ('解锁：' + (m.hint || ''))));
      card.appendChild(body);
      grid.appendChild(card);
    })(mem[j]);
  }
  box.appendChild(grid);
  return box;
}

// ==================== 逗它玩（v0.31.0）====================
// 后端 POST /pet/play 从 v0.7 就存在（score → 羁绊，每日封顶 6 点），美术里也早就
// 画好了毛线球 `yarn`，但两边从来没接上 —— 小屋里找不到任何「玩」的地方，
// 这个玩法等于不存在。现在补成 12 秒抓光虫：点中得分，连击加成，分数换算羁绊。
//
// ⚠️ 定时器必须自己管：worldSheetClose 只移除 DOM，不会通知内容层。
//    每个 tick 用 isConnected 自检，节点没了就收摊 —— 否则关掉弹层后
//    游戏还在后台跑计时器，下一次打开会叠两套。
var PLAY_GAME = {
  dur: 12000,     // 一局 12 秒
  life: 1250,     // 每只光虫停留多久，超时自己飞走（连击清零）
  hitBase: 12,    // 每只基础分
  hitCombo: 3     // 连击加成：第 n 连额外 (n-1)×3 分
};

function playGameBody(body) {
  var g = PLAY_GAME;
  var score = 0, hits = 0, combo = 0, maxCombo = 0;
  var startedAt = 0, over = false, tickTimer = 0, bugTimer = 0;

  var box = h('div', 'petplay');
  var hud = h('div', 'petplay-hud');
  hud.appendChild(h('span', 'petplay-k', '得分'));
  var scoreEl = h('b', 'petplay-score', '0');
  hud.appendChild(scoreEl);
  var comboEl = h('span', 'petplay-combo', '');
  hud.appendChild(comboEl);
  var clockEl = h('span', 'petplay-clock', Math.round(g.dur / 1000) + 's');
  hud.appendChild(clockEl);
  box.appendChild(hud);

  var bar = h('div', 'petplay-bar');
  var fill = h('i', 'petplay-fill');
  bar.appendChild(fill);
  box.appendChild(bar);

  var stage = h('div', 'petplay-stage');
  var bug = h('button', 'petplay-bug');
  bug.setAttribute('type', 'button');
  bug.setAttribute('aria-label', '光虫');
  stage.appendChild(bug);
  box.appendChild(stage);

  box.appendChild(h('div', 'petplay-tip', '点中光虫得分 · 连击越高单只越值钱'));
  var result = h('div', 'petplay-result');
  box.appendChild(result);
  body.appendChild(box);

  function renderCombo() {
    if (combo >= 2) {
      comboEl.textContent = '连击 ×' + combo;
      comboEl.className = 'petplay-combo is-on';
    } else {
      comboEl.textContent = '';
      comboEl.className = 'petplay-combo';
    }
  }

  function placeBug() {
    if (over || !bug.isConnected) return;
    // 6%~90% / 10%~82%：留边，避免光点一半身子被 stage 的 overflow:hidden 裁掉
    bug.style.left = (6 + Math.random() * 84) + '%';
    bug.style.top = (10 + Math.random() * 72) + '%';
    if (bugTimer) clearTimeout(bugTimer);
    bugTimer = setTimeout(function() {
      bugTimer = 0;
      if (over) return;
      combo = 0;            // 追丢了就断连击，但不扣已经拿到的分
      renderCombo();
      placeBug();
    }, g.life);
  }

  function onHit(ev) {
    if (ev) {
      if (ev.preventDefault) ev.preventDefault();
      if (ev.stopPropagation) ev.stopPropagation();
    }
    if (over) return;
    combo += 1;
    if (combo > maxCombo) maxCombo = combo;
    hits += 1;
    score += g.hitBase + (combo - 1) * g.hitCombo;
    scoreEl.textContent = String(score);
    renderCombo();
    if (bugTimer) { clearTimeout(bugTimer); bugTimer = 0; }
    placeBug();
  }

  function stopTimers() {
    if (tickTimer) { clearInterval(tickTimer); tickTimer = 0; }
    if (bugTimer) { clearTimeout(bugTimer); bugTimer = 0; }
  }

  function tick() {
    if (over) return;
    if (!stage.isConnected) { over = true; stopTimers(); return; }
    var left = g.dur - (Date.now() - startedAt);
    if (left <= 0) { finish(); return; }
    clockEl.textContent = Math.ceil(left / 1000) + 's';
    fill.style.width = (left / g.dur * 100).toFixed(1) + '%';
  }

  function finish() {
    if (over) return;
    over = true;
    stopTimers();
    fill.style.width = '0%';
    clockEl.textContent = '0s';
    bug.style.display = 'none';
    comboEl.textContent = '';
    comboEl.className = 'petplay-combo';
    stage.className = 'petplay-stage is-done';

    result.className = 'petplay-result is-on';
    result.appendChild(h('div', 'petplay-rtitle', hits ? ('抓到 ' + hits + ' 只光虫') : '一只都没抓到'));
    result.appendChild(h('div', 'petplay-rsub',
      '得分 ' + score + (maxCombo >= 2 ? (' · 最高 ' + maxCombo + ' 连击') : '')));
    var gain = h('div', 'petplay-rgain', api ? '结算中…' : '暂时连不上服务器');
    result.appendChild(gain);
    var again = h('button', 'petplay-again', '再来一局');
    again.addEventListener('click', function() {
      clearEl(body);
      playGameBody(body);
    });
    result.appendChild(again);

    if (!api) return;
    api.post('/pet/play', { score: score }).then(function(res) {
      var d = (res.data && res.data.data) || {};
      if (d.state) state = d.state;
      absorbProgress(d);
      var added = d.added || 0;
      var total = d.total || 0;
      var cap = d.cap || 0;
      if (added > 0) {
        gain.textContent = '羁绊 +' + added + '（今天 ' + total + ' / ' + cap + '）';
        gain.className = 'petplay-rgain is-good';
        try { if (window.__ciPetSfx) window.__ciPetSfx.play('coin'); } catch (e) {}
        sysToast('玩得开心！羁绊 +' + added, 'success');
      } else {
        gain.textContent = '今天的玩耍羁绊已经拿满了（' + total + ' / ' + cap + '），明天再来';
        gain.className = 'petplay-rgain is-full';
      }
      notifyChanged();
      // 关掉弹层后让小屋重画一次，HUD 上的羁绊/鱼干才跟着变。
      // 不能立刻 renderHome —— 那会把正在看的结算面板连同弹层一起抹掉。
      pendingHomeRender = true;
    }, function(err) {
      var msg = (err && err.response && err.response.data && err.response.data.message) || '结算失败，稍后再试';
      gain.textContent = msg;
      gain.className = 'petplay-rgain is-bad';
    });
  }

  function start() {
    startedAt = Date.now();
    score = 0; hits = 0; combo = 0; maxCombo = 0;
    scoreEl.textContent = '0';
    renderCombo();
    fill.style.width = '100%';
    clockEl.textContent = Math.round(g.dur / 1000) + 's';
    tickTimer = setInterval(tick, 90);
    placeBug();
  }

  if (window.PointerEvent) bug.addEventListener('pointerdown', onHit);
  else {
    bug.addEventListener('touchstart', onHit);
    bug.addEventListener('mousedown', onHit);
  }
  start();
}

// 角色走动：RPG 的灵魂交互 —— 点家具，它先走过去，再打开对应的玩法。
// walkX 记录在 SCENE_OBJECTS；scaleX 让它面向目标。走完回调里再弹对话框。
var worldPetEl = null;
var worldEl = null;          // 场景容器引用（位移要用它的实时宽度）
var worldPetX = 50;          // 当前位置（%）
// 整页重绘（喂食 / 专注结算 / 摸摸回包）会把场景整个重建。若从固定值重新开始，
// 角色每次都「瞬移回房间中央」——用户看到的是「它被打断了一下」。
// 记住上一次站立的位置，重绘后原地续上。
var worldPetLastX = 30;
var worldWalking = false;
// ⚠️ 位移必须用 transform（GPU 合成）而不是 left —— left% 的过渡在
//    部分 WebView 上直接跳帧，用户看到的就是「瞬移」。
// 把视频逐帧「降采样」进小画布：这是把平滑素材变像素画的唯一可靠办法。
// 直接用 CSS 缩放视频只能得到「糊」，得不到硬边像素。
var worldPetCanvas = null;
var worldPixelRAF = 0;
function startWorldPetPixels(video, canvas, c2d) {
  if (worldPixelRAF) { cancelAnimationFrame(worldPixelRAF); worldPixelRAF = 0; }
  var w = canvas.width, h = canvas.height;
  function step() {
    if (!canvas || !canvas.parentNode) { worldPixelRAF = 0; return; }
    try {
      if (video && video.readyState >= 2) {
        c2d.clearRect(0, 0, w, h);
        c2d.drawImage(video, 0, 0, w, h);
        keyPetBackdrop(c2d, w, h);
      }
    } catch (e) {}
    worldPixelRAF = requestAnimationFrame(step);
  }
  worldPixelRAF = requestAnimationFrame(step);
}

// 抠底 + 硬化边缘。
// ⚠️ 素材的「透明背景」其实是 **纯黑 @ alpha 128**（不是真透明）——
//    直接画出来就是角色背后一块半透明黑板（截图实证：corner = 0/0/0/128）。
// 做法：①底色（近黑且 alpha<=140）直接抹成透明；
//      ②剩下的软边按 alpha 阈值二值化 —— 真像素画没有半透明边缘，
//        这一步同时消除了缩放带来的抗锯齿，是「像素感」的关键。
function keyPetBackdrop(c2d, w, h) {
  var img = c2d.getImageData(0, 0, w, h);
  var d = img.data;
  for (var i = 0; i < d.length; i += 4) {
    var a = d[i + 3];
    if (a === 0) continue;
    if (a <= 140 && d[i] < 26 && d[i + 1] < 26 && d[i + 2] < 26) {
      d[i + 3] = 0;                      // 底色 → 全透明
    } else {
      d[i + 3] = a >= 150 ? 255 : 0;     // 软边 → 硬边（消除抗锯齿）
    }
  }
  c2d.putImageData(img, 0, 0);
}

function worldPetApplyX(ms) {
  if (!worldPetEl || !worldEl) {
    if (window.__ciWorldIdle) window.__ciWorldIdle.applySkip++;
    return 0;
  }
  // 半宽从元素自身量，不写死 158 —— 改角色尺寸时这里不会错位
  var half = (worldPetEl.offsetWidth || 316) / 2;
  var px = Math.round(worldEl.clientWidth * worldPetX / 100 - half);
  if (ms) {
    // 步速跟距离挂钩：原来固定 0.5s，从床头走到门口就是「滑过去」，
    // 现在按 12ms/10px 折算（420~1300ms 封顶），观感是「走」不是「滑」。
    worldPetEl.style.transitionDuration = ms + 'ms';
  }
  worldPetEl.style.transform = 'translateX(' + px + 'px)';
  if (window.__ciWorldIdle) {
    window.__ciWorldIdle.apply++;
    window.__ciWorldIdle.lastPx = px;
    window.__ciWorldIdle.lastW = worldEl.clientWidth;
  }
  return px;
}

// 走近一点、慢一点：返回本段走动的时长（毫秒）
function worldWalkTo(x, done, speedFactor) {
  if (!worldPetEl) { if (done) done(); return; }
  if (Math.abs(x - worldPetX) < 1.2) { if (done) done(); return; }
  var fromX = worldPetX;
  var width = worldEl ? worldEl.clientWidth : 1080;
  var distPx = Math.abs(x - fromX) / 100 * width;
  var ms = Math.round(distPx * (speedFactor || 11));
  ms = Math.max(380, Math.min(1500, ms));

  worldWalking = true;
  worldPetEl.classList.toggle('is-flip', x < fromX);
  worldPetEl.classList.add('is-walk');
  worldPetX = x;
  worldPetLastX = x;
  worldPetApplyX(ms);
  if (window.__ciWorldIdle) window.__ciWorldIdle.lastMs = ms;

  // 走路扬尘：每隔一小段在脚下起一撮，落地即散。
  // 只在「真的在走」时挂节拍器，停下立即清 —— 不给低端平板留常驻定时器。
  if (worldDustTimer) { clearInterval(worldDustTimer); worldDustTimer = null; }
  worldDustPuff();
  worldDustTimer = setInterval(worldDustPuff, 320);

  if (worldWalkTimer) clearTimeout(worldWalkTimer);
  worldWalkTimer = setTimeout(function() {
    worldPetEl.classList.remove('is-walk');
    worldWalking = false;
    if (worldDustTimer) { clearInterval(worldDustTimer); worldDustTimer = null; }
    if (done) done();
  }, ms + 40);
}

var worldDustTimer = null;
// 脚下一撮像素尘：三粒小方块，随机横向散开，420ms 后自删
function worldDustPuff() {
  if (!worldPetEl || !worldEl) return;
  var box = document.createElement('span');
  box.className = 'world-dust';
  for (var i = 0; i < 3; i++) {
    var d = document.createElement('i');
    d.style.left = (18 + Math.random() * 22) + '%';
    d.style.animationDelay = (Math.random() * 0.08) + 's';
    d.style.width = (2 + Math.round(Math.random() * 2)) + 'px';
    d.style.height = d.style.width;
    box.appendChild(d);
  }
  worldPetEl.appendChild(box);
  setTimeout(function() { if (box.parentNode) box.parentNode.removeChild(box); }, 460);
}

// 张望：左右各看一眼（不是机械地 flip 一次）
function worldLookAround() {
  if (!worldPetEl || worldWalking) return;
  worldPetEl.classList.toggle('is-flip');
  if (window.__ciWorldIdle) window.__ciWorldIdle.look = (window.__ciWorldIdle.look || 0) + 1;
  laterWorld(function() {
    if (!worldPetEl || worldWalking) return;
    worldPetEl.classList.toggle('is-flip');
  }, 460);
}

var worldLaterTimers = [];
function laterWorld(fn, ms) {
  worldLaterTimers.push(setTimeout(fn, ms));
}
function clearWorldLater() {
  for (var i = 0; i < worldLaterTimers.length; i++) clearTimeout(worldLaterTimers[i]);
  worldLaterTimers = [];
}

function worldHop() {
  if (!worldPetEl) return;
  worldPetEl.classList.remove('is-hop');
  void worldPetEl.offsetWidth;
  worldPetEl.classList.add('is-hop');
  if (window.__ciWorldIdle) window.__ciWorldIdle.hop = (window.__ciWorldIdle.hop || 0) + 1;
}

// 摸头的心形反馈（v0.33）
// 为什么不用现成的 flashGain：那是旧首页 hero 区的飘字，新场景里没有 .ci-pet-hero 节点，
// 调了也是静默返回 —— 于是「摸头」在视觉上等于什么都没发生。
// 这里把粒子挂在 .world-pet 内部，角色走动/翻转时心跟着一起走。
function worldHearts(petBox, n) {
  if (!petBox) return;
  var layer = petBox.querySelector('.world-pet-fx');
  if (!layer) { layer = h('span', 'world-pet-fx'); petBox.appendChild(layer); }
  var count = n || 3;
  for (var i = 0; i < count; i++) {
    (function(i) {
      setTimeout(function() {
        if (!layer.parentNode) return;
        // 中间那颗用实心，两侧空心：比三颗一模一样的更像随手画的
        var heart = h('span', 'world-heart', i === 1 ? '\u2665' : '\u2661');
        var dx = (i - 1) * 22 + (Math.random() * 10 - 5);
        heart.style.left = 'calc(50% + ' + dx + 'px)';
        heart.style.animationDelay = (i * 0.05) + 's';
        layer.appendChild(heart);
        setTimeout(function() { if (heart.parentNode) heart.parentNode.removeChild(heart); }, 1300);
      }, i * 80);
    })(i);
  }
}

// ---------- 触屏交互层 ----------
// ⚠️ 这个应用的主战场是校园平板，而**平板没有 hover**。原来所有交互提示
//    （物件名、四角选中框、抬起 3px）都挂在 :hover 上 —— 后果有两个：
//    ①用户从来没见过「小窝 / 喂食 / 专注 / 图鉴 / 冒险」这些标签；
//    ②WebView 会把 hover 状态「粘」在最后点过的元素上，点一下书柜它就一直浮着，
//      像卡住了。所以按压反馈改由 pointerdown 驱动，和 hover 彻底解耦。
// ⚠️ 按压只用「整数位移」，绝不用 scale：像素图缩放会产生 4.8px 这种小数像素点，
//    边缘当场糊掉（全仓 30 处 :active{scale(.96)} 是同一个问题）。
function bindObjPress(btn, walkX) {
  var labelTimer = null;
  function showLabel(hold) {
    btn.classList.add('is-label');
    if (labelTimer) clearTimeout(labelTimer);
    labelTimer = setTimeout(function() {
      btn.classList.remove('is-label');
      labelTimer = null;
    }, hold || 1400);
  }
  btn.__showLabel = showLabel;      // 点击回调要把标签留到「它走过去」之后

  btn.addEventListener('pointerdown', function(e) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    btn.classList.add('is-press');
    // 触屏没有 mouseenter —— 按下这一下就是「它在注意你在看什么」的唯一时机。
    if (walkX != null && worldPetEl && !worldWalking) {
      worldPetEl.classList.toggle('is-flip', walkX < worldPetX);
    }
  });

  var release = function() {
    if (!btn.classList.contains('is-press')) return;
    btn.classList.remove('is-press');
    // 回弹：2 帧的「弹一下」，和像素动画的节奏一致（不是缓动）
    btn.classList.remove('is-bump');
    void btn.offsetWidth;
    btn.classList.add('is-bump');
    showLabel();
  };
  btn.addEventListener('pointerup', release);
  btn.addEventListener('pointercancel', release);
  btn.addEventListener('pointerleave', release);
  btn.addEventListener('animationend', function(e) {
    if (e.animationName === 'worldObjBump') btn.classList.remove('is-bump');
  });
}

// 走动状态对探针可见（和 window.__ciWorldIdle 同一类东西：只读，没有 UI 入口）。
// 触屏交互（点地板 / 点角色打断）只能靠状态断言，靠截图看不出「它是不是还在走」。
window.__ciWorldDbg = {
  stop: worldStopWalk,
  get x() { return worldPetX; },
  get walking() { return worldWalking; }
};

// 点地板的落点：三帧外扩的像素菱形。平滑涟漪属于矢量 UI，和这间屋子不是一套语言。
function worldTapMark(pct) {
  if (!worldEl) return;
  var old = worldEl.querySelector('.world-tap');
  if (old && old.parentNode) old.parentNode.removeChild(old);
  var m = h('span', 'world-tap');
  m.style.left = pct + '%';
  worldEl.appendChild(m);
  laterWorld(function() { if (m.parentNode) m.parentNode.removeChild(m); }, 560);
}

// 走动着被点：停在「当前画到的位置」。
// 不这么做的话，worldPetX 还停在目标值，下一次走动会按旧目标算距离 → 角色瞬移一格。
function worldStopWalk() {
  worldWalking = false;
  if (worldWalkTimer) { clearTimeout(worldWalkTimer); worldWalkTimer = null; }
  if (!worldPetEl) return;
  worldPetEl.classList.remove('is-walk');
  var el = worldPetEl;
  var tx = null;
  try {
    // getComputedStyle 拿的是过渡中的实时矩阵 —— style.transform 只有目标值
    var m = new DOMMatrixReadOnly(getComputedStyle(el).transform);
    tx = m.m41;
  } catch (e) {
    var mm = /translateX\((-?[\d.]+)px\)/.exec(el.style.transform || '');
    if (mm) tx = parseFloat(mm[1]);
  }
  if (tx == null || !worldEl) return;
  var half = (el.offsetWidth || 340) / 2;
  var w = worldEl.clientWidth || 1;
  worldPetX = (tx + half) / w * 100;
  worldPetLastX = worldPetX;
  el.style.transitionDuration = '0ms';
  el.style.transform = 'translateX(' + Math.round(tx) + 'px)';
  void el.offsetWidth;
  el.style.transitionDuration = '';
}

function sceneAction(act, walkX) {
  var open = function() {
    if (act === 'focus') { worldSheet('陪它专注', function(body) { body.appendChild(focusPicker()); }); return; }
    if (act === 'battle') { switchTab('battle'); return; }
    if (act === 'dex') { switchTab('dex'); return; }
    if (act === 'rank') { switchTab('rank'); return; }
    if (act === 'bed') { worldSheet('小窝', nestSheetBody); return; }
    if (act === 'window') {
      worldSheet('窗外天气', function(body) {
        var w = weatherCard();
        if (w) body.appendChild(w);
        else body.appendChild(h('div', 'world-gift-empty', '天气数据还没到，稍等一下。'));
      });
      return;
    }
    if (act === 'easel') { worldSheet('画板 · 形象', easelSheetBody); return; }
    if (act === 'gift') { worldSheet('今日惊喜', giftSheetBody); return; }
    if (act === 'play') { worldSheet('逗它玩', playGameBody); return; }
    if (act === 'heart') { openHeartSheet(); return; }
  };
  // 喂食不用走过去（食盆就在脚边），但它也不只是「喂」：
  // v0.24 起首页是像素小家，v0.19 的侧栏货架成了死代码，鱼干从此没有花处。
  // 现在点食盆 = 打开「食盆 · 小卖部」：买（货架）和喂（普通饭/大餐）在同一张弹层里，
  // 「吃」的来路与去处是同一条链，不必再造一个新物件占地板面积。
  if (act === 'feed') {
    bumpInteractCombo();
    worldSheet('食盆 · 小卖部', function(body) { body.appendChild(shoppeBar()); });
    return;
  }
  worldWalkTo(walkX, open);
}

// 重绘必须等角色停下来。
// 场景是整块重建的：clearRoot 之后 worldWalkTimer 被 clearTimeout，
// 于是「点它摸一下 → 0.5s 后回包重绘」会把用户在这 0.5s 内点的家具正在走的路线直接掐断
// （面板不弹、角色停在半路）。这不是理论问题，探针里第一次就复现了。
var pendingHomeRender = false;
function renderHomeWhenIdle(tries) {
  if (worldWalking) {
    if ((tries || 0) < 12) setTimeout(function() { renderHomeWhenIdle((tries || 0) + 1); }, 260);
    return;
  }
  // 面板开着也不能重建：它会把刚弹出的面板连同滚动位置一起抹掉。
  // 记一笔，等面板关掉再补（见 worldSheetClose 的 170ms 回调）。
  if (worldSheetEl) { pendingHomeRender = true; return; }
  try { renderHome(); } catch (e) {}
}

// 摸摸：点角色本体（复用原按钮的派发与兜底逻辑）
function scenePoke() {
  bumpInteractCombo();
  if (!canPoke()) { sysToast(capMessage('poke'), 'info'); return; }
  try { window.dispatchEvent(new CustomEvent('ci-pet-poke')); } catch (e) {}
  pendingReply.poke = false;
  setTimeout(function() {
    if (pendingReply.poke) return;
    api.post('/pet/interact', { type: 'poke' }).then(function(res) {
      var d = (res.data && res.data.data) || {};
      state = d.state || state;
      if (d.mood) moodInfo = d.mood;
      if (d.personality) personalityInfo = d.personality;
      renderHomeWhenIdle();      // 别在它走路时重建场景
    }, function() {
      sysToast('它好像没反应…再试一次？', 'info');
    });
  }, 500);
}

// ================= 场景渲染 =================
var worldIdleTimer = null;
var worldTipTimer = null;
var worldWalkTimer = null;
var worldMutterTimer = null;
var worldApplyXBound = false;
// 闲逛诊断计数（只在控制台/探针用；没有 UI 影响）
window.__ciWorldIdle = { ticks: 0, walk: 0, hop: 0, flip: 0, idle: 0,
  skipWalk: 0, skipSheet: 0, noPet: 0, apply: 0, applySkip: 0,
  lastPx: null, lastW: null, lastTarget: null };
// 闲逛：把「一次大动作」拆成「一直在做小动作」。
// 上一版 3~8 秒才动一次，用户看到的是「一直待着」——生命感其实取决于间隔，
// 不是动作幅度。现在 1.2~3.2 秒一个微动作，其中只有 1/3 是走动。
function scheduleWorldIdle(waitMs) {
  if (worldIdleTimer) clearTimeout(worldIdleTimer);
  var wait = waitMs || (1200 + Math.random() * 2000);
  worldIdleTimer = setTimeout(worldIdleTick, wait);
}

// 走动目的地：60% 去某件家具跟前（有目的感），40% 随便挪。
function worldWanderSpot() {
  if (Math.random() < 0.6) {
    var spots = [];
    for (var i = 0; i < SCENE_OBJECTS.length; i++) {
      if (SCENE_OBJECTS[i].walkX != null) spots.push(SCENE_OBJECTS[i].walkX);
    }
    if (spots.length) return spots[Math.floor(Math.random() * spots.length)];
  }
  return 16 + Math.round(Math.random() * 60);   // 16~76%：留在「生活区」里，不贴门不贴墙
}

function worldIdleTick() {
  var dbg = window.__ciWorldIdle;
  if (dbg) dbg.ticks++;
  if (!worldPetEl) { if (dbg) dbg.noPet++; return; }
  if (worldWalking || worldSheetEl) { scheduleWorldIdle(700); return; }

  var roll = Math.random();
  if (roll < 0.32) {
    var x = worldWanderSpot();
    if (dbg) { dbg.walk++; dbg.lastTarget = x; }
    worldWalkTo(x, function() { scheduleWorldIdle(260 + Math.random() * 700); });
  } else if (roll < 0.50) {
    worldLookAround();
    scheduleWorldIdle();
  } else if (roll < 0.64) {
    worldHop();
    scheduleWorldIdle();
  } else if (roll < 0.80) {
    // 小碎步：原地附近挪一点点，像重心在换脚
    var near = Math.max(15, Math.min(78, worldPetX + (Math.random() < 0.5 ? -1 : 1) * (3 + Math.random() * 5)));
    worldWalkTo(near, function() { scheduleWorldIdle(); }, 26);
  } else {
    // 什么都不做，但呼吸在动（视频本身就是待机呼吸）
    if (dbg) dbg.idle++;
    scheduleWorldIdle(1400 + Math.random() * 900);
  }
}

// 自言自语：RPG 村民式的生活气。35~70 秒一次，出现 2.6 秒就收。
var MUTTER_LINES = ['嗯…', '（伸懒腰）', '（看窗外）', '有点饿了…', '想被摸摸', '（打了个哈欠）', '今天也不错'];
function scheduleWorldMutter() {
  if (worldMutterTimer) clearTimeout(worldMutterTimer);
  worldMutterTimer = setTimeout(function() {
    if (worldPetEl && !worldSheetEl && !worldWalking) {
      var el = h('div', 'world-mutter', MUTTER_LINES[Math.floor(Math.random() * MUTTER_LINES.length)]);
      worldPetEl.appendChild(el);
      setTimeout(function() { if (el.parentNode) el.parentNode.removeChild(el); }, 2600);
    }
    scheduleWorldMutter();
  }, 35000 + Math.random() * 35000);
}

function sceneHomeBody(container) {
  // 重入清理：clearRoot 会移除旧 DOM，先掐掉上一间的闲逛定时器
  if (worldIdleTimer) { clearTimeout(worldIdleTimer); worldIdleTimer = null; }
  if (worldWalkTimer) { clearTimeout(worldWalkTimer); worldWalkTimer = null; }
  if (worldMutterTimer) { clearTimeout(worldMutterTimer); worldMutterTimer = null; }
  if (worldPixelRAF) { cancelAnimationFrame(worldPixelRAF); worldPixelRAF = 0; }
  worldPetCanvas = null;
  clearWorldLater();
  worldPetEl = null;
  worldEl = null;
  worldWalking = false;

  var isVideoPet = state.design && state.design.type === 'video';

  var world = h('div', 'ci-pet-world');
  // ⚠️ stageW 现在只用于日志/调试：家具尺寸改由「原生像素 × 5」决定，
  // 不再随视口缩放 —— 缩放会让像素点变成 3.7px 这种小数，等于亲手制造 mixel。
  var stageW = (container && container.clientWidth) || 1080;
  // 窗光是房间的主光源：位置由窗户物件驱动（CSS 里只写 var，不写死坐标，
  // 否则挪动窗户时地板光斑会和窗户对不上）。
  for (var wi = 0; wi < SCENE_OBJECTS.length; wi++) {
    if (SCENE_OBJECTS[wi].id === 'window') {
      world.style.setProperty('--win-x', SCENE_OBJECTS[wi].x + '%');
      world.style.setProperty('--win-w', SCENE_OBJECTS[wi].w + 'px');
    }
  }
  // 漂浮微尘（氛围）：5 枚像素小点缓缓上浮
  var motes = h('div', 'world-motes');
  for (var mi = 0; mi < 5; mi++) {
    var mote = h('span', 'world-mote');
    mote.style.left = (6 + mi * 19 + Math.random() * 8) + '%';
    mote.style.animationDelay = (mi * 1.7) + 's';
    motes.appendChild(mote);
  }
  world.appendChild(motes);
  // ⚠️ 这里原来有个 <div class="world-wall">：它高度为 0，
  //    而它的两个伪元素用 top:0 / top:46% 定位 —— 百分比在 0 高度上全塌到同一个 y，
  //    于是「天花板线」和「护墙板腰线」重叠成一条横贯全屋的线。
  //    「舞台中间那条线」找了八轮的真正根因就是它。职责已由 world-ceiling /
  //    world-baseboard 承担，删除。
  // 房间的建筑结构：天花板 / 地板 / 踢脚线。
  // 它们不是装饰 —— 是把「一面高墙 + 一条地板」框成一个房间的三条边。
  world.appendChild(h('div', 'world-ceiling'));
  world.appendChild(h('div', 'world-floor'));
  // 护墙板：把「一面到顶的空墙」切成「上部留白 + 下部木质板材」，
  // 这是房间的装修结构，不是装饰 —— 墙面因此不再是一片空墙纸。
  world.appendChild(h('div', 'world-wainscot'));
  world.appendChild(h('div', 'world-baseboard'));
  world.appendChild(h('div', 'world-beam'));   // 窗光光柱：光要有「来路」，不能只有落点

  // ---------- 墙上 HUD：名牌（可点 = 打开小窝） ----------
  var hud = h('button', 'world-hud-name');
  hud.appendChild(h('span', 'world-hud-petname', state.name || '小家伙'));
  var lv = h('span', 'world-hud-lv', 'Lv —');
  bindLevel(lv);
  hud.appendChild(lv);
  hud.appendChild(h('span', 'world-hud-bond', '❤ ' + (state.bond || 0)));
  hud.addEventListener('click', function() { sceneAction('bed'); });
  world.appendChild(hud);

  // 右上资源：昼夜切换 + 鱼干（v0.27.0 从 stageHud 挪进来 —— stageHud 是对战页的，
  // 家里的时间开关就该在家里；🐟 顺手换成 fish 像素图标）
  var res = h('div', 'world-hud-res');
  var dayBtn = h('button', 'world-hud-day');
  dayBtn.setAttribute('type', 'button');
  dayBtn.setAttribute('data-hud', 'daynight');
  dayBtn.setAttribute('title', '切换白天 / 夜晚');
  dayBtn.addEventListener('click', function(ev) {
    ev.stopPropagation();
    cycleDayNight();
  });
  // ⚠️ 此刻 world 还没上树，fillDayToggle 的 querySelector 查不到 ——
  // 图标必须当场铺；上树后由 applyDayNight 统一刷。
  setIconText(dayBtn, isDayNow() ? 'sun' : 'moon',
    dayNight.mode === 'auto' ? '自动' : (isDayNow() ? '白天' : '夜晚'));
  dayBtn.setAttribute('data-mode', dayNight.mode);
  res.appendChild(dayBtn);
  var coinSpan = h('span', 'world-hud-coin');
  setIconText(coinSpan, 'fish', ' ' + coinCount());
  res.appendChild(coinSpan);
  world.appendChild(res);

  // ---------- 家具物件 ----------
  var objLayer = h('div', 'world-objects');
  for (var i = 0; i < SCENE_OBJECTS.length; i++) {
    (function(o) {
      var artKey = o.art || o.id;
      // 昼夜换画：白天 = 蓝天太阳窗 + 米黄窗帘（_art7.py 生成），夜里才是月亮星星 + 梅紫帘
      if (o.id === 'window') artKey = isDayNow() ? 'windowDay' : 'window';
      else if (artKey === 'curtain') artKey = isDayNow() ? 'curtainDay' : 'curtain';
      var art = SCENE_ART[artKey];
      var isDeco = !!o.deco;
      // 像素网格：整间屋子 + 角色全部 5px/像素。
      // 角色的 canvas 是 68×38 渲染成 340×190 —— 正好 5px。原来每件家具各自
      // 吸附 3/4/6/8，一张床是 8px 的方块、旁边闹钟是 4px，眼睛一眼就看出「拼贴」。
      // 所以尺寸不再由表格里的 w 决定，而是「原生像素 × 5」，谁都改不了这个比例。
      var CELL = 5;
      var ow = CELL * art.w;
      var oh = CELL * art.h;
      var btn = h(isDeco ? 'div' : 'button', 'world-obj' +
        (o.wall ? ' world-obj--wall' : '') +
        (o.hang ? ' world-obj--hang' : '') +
        (isDeco ? ' world-obj--deco' : '') +
        (o.front ? ' world-obj--front' : '') +
        (o.hang ? '' : ' world-obj--ground'));
      btn.setAttribute('data-obj', o.id);
      // 站位对调试/探针可见：布局一改，walkX 也要跟着改，
      // 探针从这里读，而不是在脚本里写死一个百分比。
      if (o.walkX != null) btn.setAttribute('data-walk', String(o.walkX));
      btn.style.left = 'calc(' + o.x + '% - ' + Math.round(ow / 2) + 'px)';
      btn.style.width = ow + 'px';
      if (o.hang) {
        btn.style.top = (o.topY || 8) + '%';
      } else if (o.row && GROUND_ROWS[o.row] !== undefined) {
        // 地面线是「内容底边」。美术四周有 1px 描边留白（5px），必须减回去，
        // 否则每件家具都浮在地板上 5px —— 在像素尺度上非常刺眼。
        btn.style.bottom = 'calc(' + GROUND_ROWS[o.row] + '% - ' + CELL + 'px)';
      }
      btn.setAttribute('data-row', o.row || 'hang');
      var artEl = h('span', 'world-obj-art');
      artEl.innerHTML = pxArt(art.w, art.h, art.rows, art.pal);
      artEl.style.height = oh + 'px';
      btn.appendChild(artEl);
      if (!isDeco) {
        btn.appendChild(h('span', 'world-obj-name', o.name));
        bindObjPress(btn, o.walkX);
        btn.addEventListener('click', function() {
          bumpInteractCombo();
          // 标签留 2 秒：角色要先走过去（最远 1.5s），标签不能半路消失 ——
          // 否则用户刚看清「这是图鉴」，名字已经没了。
          if (btn.__showLabel) btn.__showLabel(2000);
          sceneAction(o.act, o.walkX);
        });
        // 你把注意力放到哪件家具，它就转过去看 —— 「它在注意你在看什么」，
        // 是最便宜也最有效的「活着」信号（比任何动画都省）。
        // 桌面保留 mouseenter（触屏那一路在 bindObjPress 的 pointerdown 里）。
        if (o.walkX != null) {
          btn.addEventListener('mouseenter', function() {
            if (!worldPetEl || worldWalking) return;
            worldPetEl.classList.toggle('is-flip', o.walkX < worldPetX);
          });
        }
      }
      objLayer.appendChild(btn);
    })(SCENE_OBJECTS[i]);
  }


  // 地毯（纯装饰）：像素三色阶椭圆
  var rug = h('div', 'world-rug');
  objLayer.appendChild(rug);
  world.appendChild(objLayer);


  // ---------- 角色（生活在家里，会走动） ----------
  var petBox = h('div', 'world-pet');
  // ⚠️ 这里必须是 left:0 + margin-left:0，**不能写 left:42%**。
  //    角色定位的唯一真相是 worldPetApplyX()：它把「百分比 → 像素」算成
  //    translateX(W × x% − half)，并假设元素的静态中心在 0。
  //    一旦这里给了 left:42%，静态中心就变成 42%，transform 再叠一次 →
  //    角色实际站在 66%（实测），而且所有 walkX 都偏右 24%：
  //    床在小屋最左，它却走到房间中间就停下 —— 用户看到的是「它没走到床边」。
  petBox.style.left = '0';
  petBox.style.marginLeft = '0px';
  petBox.appendChild(h('span', 'world-pet-shadow'));
  if (isVideoPet) {
    // ⚠️ 角色原始素材是 640×360 的平滑渲染 —— 直接放进像素房间，
    //    等于在一屋子硬像素里放了一张高清照片，这是最高级别的「mixel」
    //    （像素圈的术语：同一画面里混用不同像素密度，人眼一眼就能看出「拼贴感」）。
    //    修法：把视频画进一张很小的 canvas（85×48），再用 image-rendering:pixelated
    //    整数倍放大 4x —— 角色因此真正变成「像素画」，和家具同一个世界。
    var v = document.createElement('video');
    v.className = 'world-pet-src';
    v.muted = true;
    v.loop = true;
    v.autoplay = true;
    v.setAttribute('playsinline', 'playsinline');
    v.setAttribute('webkit-playsinline', 'webkit-playsinline');
    v.src = poolUrl(heroIdleName());
    loadHeroPool();
    petBox.appendChild(v);

    var pv = document.createElement('canvas');
    pv.className = 'world-pet-vid';
    // 68x38 原生像素 × 5 = 340x190 CSS（上一版的尺度）
    pv.width = 68;
    pv.height = 38;
    petBox.appendChild(pv);
    var pctx = pv.getContext('2d');
    if (pctx) pctx.imageSmoothingEnabled = false;
    worldPetCanvas = pv;
    startWorldPetPixels(v, pv, pctx);
  } else {
    var pv = document.createElement('canvas');
    // 显示框是 176×176（.world-pet-cv）。按「每格 9px」画会得到 576px 画布，
    // 再被 CSS 压到 176 —— 等于每 4 个像素丢 3 个，边缘全是锯齿糊。
    // 这里直接按显示尺寸算格宽，画布与显示 1:1（配合 paint 的取整边界）。
    var dispW = 176;
    paint(pv, state.design, dispW / Math.max(1, state.design.w));
    pv.className = 'world-pet-cv';
    petBox.appendChild(pv);
  }
  // 点角色 = 摸摸（它原地开心跳一下）
  petBox.addEventListener('click', function() {
    // 走动中也要有回应：点它就停下、回头、开心跳一下。
    // 原来这里是 `if (worldWalking) return;` —— 而它走动时恰好是用户最容易去点它的时刻，
    // 点下去毫无反应，等于告诉用户「这个东西是死的」。
    if (worldWalking) worldStopWalk();
    petBox.classList.remove('is-hop');
    void petBox.offsetWidth;
    petBox.classList.add('is-hop');
    worldHearts(petBox, 3);   // v0.33：跳还不够「被摸到」，加三颗心从头顶飘起来
    scenePoke();
  });
  worldPetEl = petBox;
  worldEl = world;
  worldPetX = worldPetLastX;
  world.appendChild(petBox);

  // 首次进入的玩法引导：一条 RPG 台词，5 秒后消失。
  // 交流靠「点它 / 点屋里的东西」这一句就够 —— 常驻文字说明会把场景切碎。
  var tip = h('div', 'world-tip', '点屋里的东西 · 点地板它就走过去 · 点它可以摸摸');
  world.appendChild(tip);
  if (worldTipTimer) clearTimeout(worldTipTimer);
  worldTipTimer = setTimeout(function() {
    if (tip.parentNode) tip.parentNode.removeChild(tip);
  }, 5200);

  // 闲逛启动（延迟一点，先让玩家看清房间）
  scheduleWorldIdle(900);
  scheduleWorldMutter();

  // 头顶气泡（复用现有 thought 内容源）
  var mood = petMood();
  // v0.37.0：有情感摘要时优先说「今天想对你说的话」——
  // 它会记得昨天聊过什么，这比一句固定的「今天也想被摸摸」更像一只活物。
  var bubbleText = (mood && mood.text) ? mood.text : (petMoodText ? petMoodText() : '今天也想被摸摸');
  if (state && state.enabled !== false && heartInfo && heartInfo.greeting) bubbleText = heartInfo.greeting;
  // 说话气泡挂在角色容器里 —— 它必须跟着角色走。
  // 原来固定在全屋 55%/46%，角色一走开，气泡就飘在书架上（"谁在说话？"）。
  var bubble = h('div', 'world-bubble');
  bubble.appendChild(h('span', 'ci-pet-hero-mood', bubbleText));
  petBox.appendChild(bubble);
  // 台词只出现 9 秒：常驻的话，场景会变成一块说明牌
  laterWorld(function() { bubble.classList.add('is-faded'); }, 9000);

  // 点地板 = 走过去。这是 RPG 房间的基本盘：不会走路的房间只是一张背景图。
  // 排除所有「自己有动作」的命中区（物件 / 角色 / 顶部名牌 / 点击不穿透的），
  // 否则点一次物件会额外触发一次「走过去」。
  world.addEventListener('click', function(e) {
    var t = e.target;
    if (t && t.closest && t.closest('.world-obj, .world-pet, .world-hud-name, .world-hud-res, .world-tip, .world-sheet-wrap, button')) return;
    if (worldSheetEl) return;
    var r = world.getBoundingClientRect();
    if (!r.width) return;
    var pct = (e.clientX - r.left) / r.width * 100;
    pct = Math.max(8, Math.min(92, pct));   // 别走进墙里/门外
    worldTapMark(pct);
    worldWalkTo(pct, null, 10);
  });

  container.appendChild(world);

  // 叠放：闹钟坐桌面、奖杯坐书架顶。
  // ⚠️ 必须等 world 真的进了文档再算 —— 游离 DOM 的 getBoundingClientRect 全是 0，
  //    这个坑我踩了两次（第一次在 append(objLayer) 之前算，全跳过）。
  // ⚠️ 台面行 surface 是「美术内容内的第几行」，不是盒子顶：
  //    desk 的桌面在第 4 行（上面还摆着书），shelf 的顶板就是第 0 行。
  //    上一版直接拿盒子顶当台面 → 摆件凭空高 10px（两层 1px 描边留白），
  //    奖杯看着像浮在柜子上方。
  (function() {
    var SIT = { clock: { on: 'desk', surface: 4 }, trophy: { on: 'shelf', surface: 0 } };
    var CELL = 5;
    for (var id in SIT) {
      var host = objLayer.querySelector('[data-obj="' + SIT[id].on + '"]');
      var sit = objLayer.querySelector('[data-obj="' + id + '"]');
      if (!host || !sit) continue;
      var hr = host.getBoundingClientRect();
      var wr = world.getBoundingClientRect();
      if (!hr.height || !wr.height) continue;
      // 盒子底 = 内容顶(hr.top+CELL) + 台面偏移 - 自己的描边留白(CELL)
      var boxBottom = hr.top + 2 * CELL + SIT[id].surface * CELL;
      sit.style.bottom = ((wr.bottom - boxBottom) / wr.height * 100) + '%';
    }
  })();

  // ⚠️ 角色初始位移必须在这里算（world 已经进文档 → clientWidth 才是真的）。
  //    放在 world.appendChild(petBox) 之后是没用的：那时 world 还在游离状态，
  //    clientWidth = 0 → px = -158 → 角色会一直偏在错误位置（首帧「贴左」的根因）。
  worldPetApplyX(0);

  // 窗口尺寸变了要重算（百分比 → 像素的换算依赖实时宽度）
  if (!worldApplyXBound) {
    worldApplyXBound = true;
    window.addEventListener('resize', function() { worldPetApplyX(0); });
  }
}


  // ================= 图鉴 / 进化 / 随行（v0.8.0）====================
  // 图鉴页把「养」和「收集」放在一起：进化决定能装几个技能，
  // 随行决定常驻多一条小加成，收服决定你有哪些可以选。
  function dexSection() {
    var dex = battle.dex || { total: 0, ownedCount: 0, list: [], byType: {}, buddy: null };
    var box = h('div', 'ci-pet-dex');
    box.appendChild(evoCard());
    box.appendChild(typePicker(null));
    box.appendChild(buddyCard());
    if (dex.spotlight) box.appendChild(spotlightCard(dex, box));
    box.appendChild(dexProgress(dex));
    box.appendChild(wildGroups(dex, box));
    return box;
  }

  // 进化：不改形象，改能装几个技能。所以卡片直接把「槽位」写成大字。
  function evoCard() {
    var e = battle.evolution || evolutionInfo;
    if (!e) return h('div', '');
    var box = h('div', 'ci-pet-evo');
    var head = h('div', 'ci-pet-evo-head');
    head.appendChild(h('span', 'ci-pet-evo-icon', e.icon || ''));
    var txt = h('div', 'ci-pet-evo-text');
    txt.appendChild(h('div', 'ci-pet-evo-name', e.name + ' · 技能槽 ' + e.slots));
    // ⚠️ bond/nextAt 兜底：stub 或降级环境下发可能缺这两个字段，
    //    裸拼接会显示「羁绊 undefined」（fin-land-dex 截图实证）。
    txt.appendChild(h('div', 'ci-pet-evo-sub',
      e.nextAt
        ? ('羁绊 ' + (e.bond || 0) + ' / ' + e.nextAt + '，再 +' + (e.nextAt - (e.bond || 0)) + ' 进化成「' + (e.nextName || '下一形态') + '」')
        : ('羁绊 ' + (e.bond || 0) + '，已经是最终形态')));
    head.appendChild(txt);
    box.appendChild(head);
    var bar = h('div', 'ci-pet-evo-bar');
    var fill = h('span', 'ci-pet-evo-fill');
    fill.style.width = Math.max(0, Math.min(100, e.pct || 0)) + '%';
    bar.appendChild(fill);
    box.appendChild(bar);
    if (e.desc) box.appendChild(h('div', 'ci-pet-evo-desc', e.desc));
    return box;
  }

  // 本命属性：免费随时改。它是「读对手后的选择」，收费就会变成一次性的错误。
  function typePicker(after) {
    var list = (battle.elements && battle.elements.length) ? battle.elements : elements;
    if (!list.length) {
      // 老服务端 / 桩环境没下发属性表：用本地兜底，页面照样能画、能点
      list = [];
      for (var f = 0; f < ELEMENT_ORDER.length; f++) list.push(ELEMENT_FALLBACK[ELEMENT_ORDER[f]]);
    }
    var cur = battle.battleType || 'grass';
    var curInfo = battle.typeInfo || elementOf(cur);
    var box = h('div', 'ci-pet-types');

    var headRow = h('div', 'ci-pet-types-head');
    headRow.appendChild(h('span', 'ci-pet-types-title', '本命属性'));
    headRow.appendChild(h('span', 'ci-pet-types-hint', '克制 +18% · 被克 -14% · 随时可改'));
    box.appendChild(headRow);

    var row = h('div', 'ci-pet-types-row');
    for (var i = 0; i < list.length; i++) {
      (function(t) {
        var on = t.id === cur;
        var chip = h('button', 'ci-pet-type ci-pet-el--' + t.id + (on ? ' is-on' : ''));
        chip.setAttribute('data-type', t.id);
        // 图标槽固定 24px，换成像素图之后五个属性是一套画风（emoji 是五张系统贴图）
        var tIco = pixIcon(t.id, 'ci-pet-type-icon');
        if (tIco) chip.appendChild(tIco);
        chip.appendChild(h('span', 'ci-pet-type-name', t.name));
        chip.addEventListener('click', function() {
          if (battle.battleType === t.id) return;
          doBattleType(t.id, after);
        });
        row.appendChild(chip);
      })(list[i]);
    }
    box.appendChild(row);

    var beatsEl = elementOf(curInfo.beats);
    var weakEl = elementOf(curInfo.weakTo);
    var note = h('div', 'ci-pet-types-note');
    note.appendChild(elementChip(cur));
    note.appendChild(h('span', null,
      ' 克制 ' + beatsEl.name + '，被 ' + weakEl.name + ' 克制'));
    box.appendChild(note);
    return box;
  }

  function currentBuddy() {
    // ⚠️ v0.19.0 修 bug：dex.buddy 是**对象**（后端 buddyPublic() 返回完整的
    //    精灵档案：name/icon/type/rarity/bonus），不是 id 字符串。
    //    旧代码直接把它当字符串用，buddyLine 读 b.name / b.icon 就成了
    //    undefined undefined（截图实证）。
    //    同时兼容旧形状：万一某个环境下发的是 id 字符串，就去 dex.list 里找。
    var d = battle && battle.dex;
    if (d && d.buddy) {
      if (typeof d.buddy === 'object') return d.buddy;
      // 旧形状：字符串 id → 从列表里找对应精灵
      var list = d.list || [];
      for (var i = 0; i < list.length; i++) {
        if (list[i] && list[i].id === d.buddy) return list[i];
      }
    }
    return buddyInfo;
  }

  function buddyBonusText(b) {
    if (!b) return '无加成';
    var keys = [['hp', '血'], ['atk', '攻'], ['def', '防'], ['spd', '速'], ['crit', '暴击']];
    var out = [];
    for (var i = 0; i < keys.length; i++) {
      if (b[keys[i][0]]) out.push('+' + b[keys[i][0]] + ' ' + keys[i][1]);
    }
    return out.length ? out.join(' · ') : '无加成';
  }

  function buddyLine(b, withOff) {
    var line = h('div', 'ci-pet-buddy-line');
    line.appendChild(h('span', 'ci-pet-buddy-icon', b.icon || ''));
    var txt = h('div', 'ci-pet-buddy-text');
    var nameRow = h('div', 'ci-pet-buddy-name');
    nameRow.appendChild(h('span', null, b.name));
    nameRow.appendChild(elementChip(b.type));
    txt.appendChild(nameRow);
    txt.appendChild(h('div', 'ci-pet-buddy-sub',
      b.rarityIcon + ' ' + b.rarityName + ' · ' + buddyBonusText(b.bonus)));
    line.appendChild(txt);
    if (withOff) {
      var off = h('button', 'ci-pet-btn ci-pet-btn--ghost', '取消随行');
      off.addEventListener('click', function() { doBuddy(''); });
      line.appendChild(off);
    }
    return line;
  }

  function buddyCard() {
    var b = currentBuddy();
    var box = h('div', 'ci-pet-buddy');
    var headRow = h('div', 'ci-pet-buddy-head');
    headRow.appendChild(h('span', 'ci-pet-buddy-title', '随行伙伴'));
    headRow.appendChild(h('span', 'ci-pet-buddy-hint', '加成永久生效，已收服的都能选'));
    box.appendChild(headRow);
    if (!b) {
      box.appendChild(h('div', 'ci-pet-buddy-empty',
        '还没有随行伙伴。先去收服一只——第一只会自动跟着你。'));
      return box;
    }
    box.appendChild(buddyLine(b, true));
    return box;
  }

  // 首页的随行卡：只报「谁在跟着你、加了什么」，切换入口在图鉴页。

  function spotlightCard(dex, dexBox) {
    var s = dex.spotlight;
    var box = h('div', 'ci-pet-wild-spot');
    box.appendChild(h('span', 'ci-pet-wild-spot-tag', '今日焦点'));
    box.appendChild(h('span', 'ci-pet-wild-spot-icon', s.icon || ''));
    box.appendChild(h('span', 'ci-pet-wild-spot-name', s.name));
    box.appendChild(elementChip(s.type));
    box.appendChild(h('span', 'ci-pet-wild-spot-bonus',
      '收服率 +' + Math.round((dex.spotlightBonus || 0.1) * 100) + '%'));

    // v0.34.0 焦点卡从「海报」升级成「入口」：44 人图鉴为 0 的根因是
    // 挑战按钮藏在页面最底部的精灵卡上，而焦点卡——全页第一个出现、
    // 自带加成理由的位置——原来点了没反应。现在未收服时直接挂挑战按钮，
    // 战报照旧播在图鉴容器顶部，体验与精灵卡上的挑战完全一致。
    var w = null;
    for (var i = 0; i < (dex.list || []).length; i++) {
      if (dex.list[i] && dex.list[i].spotlight) { w = dex.list[i]; break; }
    }
    if (w && !w.owned) {
      box.classList.add('is-actable');
      var fight = h('button', 'ci-pet-wild-spot-fight');
      fight.appendChild(pixIcon('sword', 'ci-pet-wild-spot-fight-ico'));
      fight.appendChild(h('span', null, '挑战 ' + (s.name || '')));
      if (w.capture) {
        fight.appendChild(h('span', 'ci-pet-wild-spot-chance',
          Math.round(w.capture * 100) + '%'));
      }
      fight.addEventListener('click', function() { doWildFight(w.id, fight, dexBox); });
      box.appendChild(fight);
    } else if (w && w.owned) {
      box.classList.add('is-owned');
      box.appendChild(h('span', 'ci-pet-wild-spot-done', '✓ 已收服'));
    }
    return box;
  }

  function dexProgress(dex) {
    var box = h('div', 'ci-pet-dex-progress');
    var headRow = h('div', 'ci-pet-dex-head');
    headRow.appendChild(h('span', 'ci-pet-dex-title', '图鉴 ' + dex.ownedCount + ' / ' + dex.total));
    headRow.appendChild(h('span', 'ci-pet-dex-hint', '打赢才有机会收服，失败一次下次 +12%'));
    box.appendChild(headRow);

    var row = h('div', 'ci-pet-dex-types');
    for (var i = 0; i < ELEMENT_ORDER.length; i++) {
      var id = ELEMENT_ORDER[i];
      var s = (dex.byType && dex.byType[id]) || { owned: 0, total: 0 };
      var e = elementOf(id);
      var chip = h('span', 'ci-pet-dex-type' + (s.total && s.owned >= s.total ? ' is-full' : ''));
      var dIco = pixIcon(id, 'ci-pet-dex-type-icon');
      if (dIco) chip.appendChild(dIco);
      chip.appendChild(h('span', null, e.name + ' ' + s.owned + '/' + s.total));
      row.appendChild(chip);
    }
    box.appendChild(row);
    return box;
  }

  function wildGroups(dex, dexBox) {
    var box = h('div', 'ci-pet-wilds');
    var rarities = [['common', '常见'], ['rare', '稀有'], ['legend', '传说']];
    for (var r = 0; r < rarities.length; r++) {
      var key = rarities[r][0];
      var list = [];
      for (var i = 0; i < dex.list.length; i++) if (dex.list[i].rarity === key) list.push(dex.list[i]);
      if (!list.length) continue;

      var head = h('div', 'ci-pet-wild-head');
      head.appendChild(h('span', 'ci-pet-wild-head-name', list[0].rarityIcon + ' ' + list[0].rarityName));
      var ownedN = 0;
      for (var j = 0; j < list.length; j++) if (list[j].owned) ownedN++;
      head.appendChild(h('span', 'ci-pet-wild-head-count', ownedN + ' / ' + list.length));
      box.appendChild(head);

      var grid = h('div', 'ci-pet-wild-grid');
      for (var k = 0; k < list.length; k++) grid.appendChild(wildCard(list[k], dexBox));
      box.appendChild(grid);
    }
    return box;
  }

  function wildCard(w, dexBox) {
    // 稀有度也做成一个类（v0.9.0）：图鉴卡按常见/稀有/传说上不同颜色的描边与角标，
    // 一眼能看出这张卡值不值得蹲。
    var card = h('div', 'ci-pet-wild ci-pet-rar--' + (w.rarity || 'common') +
      (w.owned ? ' is-owned' : '') + (w.spotlight ? ' is-spot' : ''));

    var top = h('div', 'ci-pet-wild-top');
    top.appendChild(h('span', 'ci-pet-wild-icon', w.icon || ''));
    var who = h('div', 'ci-pet-wild-who');
    who.appendChild(h('span', 'ci-pet-wild-name', w.name));
    var meta = h('div', 'ci-pet-wild-meta');
    meta.appendChild(elementChip(w.type));
    meta.appendChild(h('span', 'ci-pet-wild-bond', '羁绊 ' + w.bond));
    who.appendChild(meta);
    top.appendChild(who);
    if (w.owned) top.appendChild(h('span', 'ci-pet-wild-owned', '✓ 已收服'));
    card.appendChild(top);

    if (w.desc) card.appendChild(h('div', 'ci-pet-wild-desc', w.desc));

    var foot = h('div', 'ci-pet-wild-foot');
    if (w.owned) {
      var cur = currentBuddy();
      var on = !!(cur && cur.id === w.id);
      var b = h('button', 'ci-pet-foe-btn', on ? '随行中' : '设为随行');
      if (on) b.disabled = true;
      b.addEventListener('click', function() { doBuddy(w.id); });
      foot.appendChild(b);
      // 助战（v0.25.0）：图鉴的第二种用法。收服的野怪可以站上场边给本命加成。
      var curA = (battle && battle.assistant) || null;
      var onA = !!(curA && curA.id === w.id);
      var ab = h('button', 'ci-pet-foe-btn' + (onA ? ' is-assist' : ''),
        onA ? '⚔️ 助战中' : '⚔️ 助战');
      ab.setAttribute('data-assist', w.id);
      ab.setAttribute('title', (ASSIST_TEXT[w.type] || '给本命一个被动加成'));
      ab.addEventListener('click', function() { doAssistant(onA ? '' : w.id); });
      foot.appendChild(ab);
    } else {
      foot.appendChild(h('span', 'ci-pet-wild-chance',
        '收服率 ' + Math.round((w.capture || 0) * 100) + '%' +
        (w.fails ? '（已失败 ' + w.fails + ' 次）' : '')));
      var btn = h('button', 'ci-pet-foe-btn', '挑战');
      btn.addEventListener('click', function() { doWildFight(w.id, btn, dexBox); });
      foot.appendChild(btn);
    }
    card.appendChild(foot);
    return card;
  }

  function doBuddy(id) {
    if (!api) return;
    api.post('/pet/buddy', { id: id || '' }).then(function(res) {
      var d = (res.data && res.data.data) || {};
      buddyInfo = d.buddy || null;
      if (battle) {
        if (battle.dex) {
          battle.dex.buddy = d.buddy || null;
          battle.dex.buddyBonus = d.buddyBonus || null;
        }
        if (d.combat) battle.combat = d.combat;
        if (d.evolution) battle.evolution = d.evolution;
      }
      if (d.evolution) evolutionInfo = d.evolution;
      sysToast(id ? '随行伙伴已更换' : '已取消随行', 'success');
      renderHome();
    }, function(err) {
      var msg = (err && err.response && err.response.data && err.response.data.message) || '切换失败';
      sysToast(msg, 'error');
    });
  }

  // 助战五系加成的文案（与后端 ASSIST_BONUS 对齐；按钮 title 与提示共用）
  var ASSIST_TEXT = {
    fire: '攻击 +5%', water: '每回合回 1.5% 血', grass: '血量见底时挡一半（一次）',
    electric: '暴击率 +5', earth: '防御 +10%'
  };
  function doAssistant(id) {
    if (!api) return;
    api.post('/pet/assistant', { id: id || '' }).then(function(res) {
      var d = (res.data && res.data.data) || {};
      if (battle) battle.assistant = d.assistant || null;
      sysToast(d.assistant
        ? (d.assistant.name + ' 开始为你助战：' + d.assistant.bonusText)
        : '已取消助战', 'success');
      renderHome();
    }, function(err) {
      var msg = (err && err.response && err.response.data && err.response.data.message) || '切换失败';
      sysToast(msg, 'error');
    });
  }

  function doBattleType(type, after) {
    if (!api) return;
    api.post('/pet/battle/type', { type: type }).then(function(res) {
      var d = (res.data && res.data.data) || {};
      if (battle) {
        battle.battleType = d.battleType || type;
        battle.typeInfo = d.typeInfo || battle.typeInfo;
        if (d.opponents) battle.opponents = d.opponents;
        if (d.shadows) battle.shadows = d.shadows;
      }
      var e = elementOf(type);
      sysToast('本命改成' + e.name + '，对局里的克制关系已经变了', 'success');
      if (after) after(); else renderHome();
    }, function(err) {
      var msg = (err && err.response && err.response.data && err.response.data.message) || '切换属性失败';
      sysToast(msg, 'error');
    });
  }

  function doWildFight(id, btn, dexBox) {
    if (!api) return;
    btn.disabled = true;
    var txt = btn.textContent;
    btn.textContent = '靠近中…';
    var body = { id: id, mode: 'open' };
    if (battle && battle.tactic) body.tactic = battle.tactic;
    api.post('/pet/wild/fight', body).then(function(res) {
      var d = (res.data && res.data.data) || {};
      if (!d.steps || !dexBox) { btn.disabled = false; btn.textContent = txt; return; }
      absorbProgress(d);
      battle = null;    // 图鉴 / 战力都可能变了，回来重新取
      clearEl(dexBox);
      playFight(dexBox, d, { wild: true, creature: d.creature, endpoint: '/pet/wild/fight', extra: { id: id } });
      try { dexBox.scrollIntoView({ block: 'start' }); } catch (e) {}
    }, function(err) {
      var msg = (err && err.response && err.response.data && err.response.data.message) || '挑战失败';
      sysToast(msg, 'error');
      btn.disabled = false;
      btn.textContent = txt;
    });
  }

  // 排行页：我的位置 + 积分榜 + 成就 + 称号。只比积分，羁绊不上榜。
  function rankSection() {
    var box = h('div', 'ci-pet-rankpage');
    var c = battle.combat || {};
    var rec = battle.record || {};

    var me = h('div', 'ci-pet-rankme');
    me.appendChild(h('div', 'ci-pet-rankme-num',
      battle.myRank ? ('全班第 ' + battle.myRank + ' 名') : '还没上榜'));
    me.appendChild(h('div', 'ci-pet-rankme-sub',
      '积分 ' + (rec.points || 0) + ' · 战力 ' + (c.power || 0) + ' · 羁绊 ' + (c.bond || 0)));
    if (battle.typeInfo) {
      var trow = h('div', 'ci-pet-rankme-type');
      trow.appendChild(h('span', null, '本命'));
      trow.appendChild(elementChip(battle.typeInfo.id));
      me.appendChild(trow);
    }
    box.appendChild(me);

    var hasRank = (battle.rank || []).length > 0;
    box.appendChild(rankBox());
    if (!hasRank) {
      box.appendChild(h('div', 'ci-pet-battle-none',
        '还没有人上榜。去打几场，第一个名字就会是你。'));
    }
    box.appendChild(achBox());
    box.appendChild(titleBox());
    return box;
  }

  // ================= 对战（v0.4.0：练习赛）=================
  // 结算全在服务端（backend/routes.js 的 /pet/battle/fight），这里只做两件事：
  //   1) 展示战力 / 战绩 / 今日场次；2) 把返回的逐回合战报按节奏播出来。
  // 战报格式是通用契约 —— 以后换成真人对手（异步影子 / 实时房间），这一段一行都不用改。
  var battle = null;        // 服务端 profile 缓存
  var buildEdit = null;     // Build 编辑器草稿（进编辑器初始化，保存/返回清掉）
  var battleLoading = false;
  var battleFailed = false;
  var battleWaiters = [];
  var fightTimer = null;
  var fightToken = 0;
  // 服务端没返回 cap 时的兜底值。后端 BATTLE_DAILY_CAP 改这里要跟着改——
  // 之前两处兜底一个写 5 一个写 10，页面上就出现了「今日 3/10」和「每天共 5 场」并存。
  // 次数上限。0 = 不限（后端 BATTLE_DAILY_CAP 同步改成 0）。
  // 保留这个常量是因为所有「还剩几场」的判断都读它，将来要限就改一处。
  var CAP_FALLBACK = 0;

  function loadBattle(cb) {
    if (!api) { if (cb) cb(); return; }
    if (cb) battleWaiters.push(cb);
    if (battleLoading) return;      // 已有请求在飞：挂到等待队列，避免回调丢失导致一直「战力计算中…」
    battleLoading = true;
    api.get('/pet/battle/profile').then(function(res) {
      var d = res && res.data && res.data.data;
      // 宿主桩/降级环境下可能返回别的形状：只认带 combat 的才算拿到档案，
      // 否则当成失败，避免把 {state:...} 当成战斗档案渲染出一片 0。
      battle = (d && d.combat) ? d : null;
      battleFailed = !battle;
      // 战斗档案里也带天气与任务：首页先到的那一份可能已经过期（跨天 / 刚领过奖）。
      if (d && d.weather) weatherInfo = d.weather;
      if (d && d.quests) questInfo = d.quests;
    }, function() {
      battle = null;
      battleFailed = true;
    }).then(function() {
      battleLoading = false;
      var list = battleWaiters;
      battleWaiters = [];
      for (var i = 0; i < list.length; i++) { try { list[i](); } catch (e) {} }
      // 档案到手后把 tab 角标和首页入口文案补上，避免「首页写着 0 只，图鉴里其实有 3 只」
      if (root) { refreshTabBadges(); refreshHomeLinks(); fillHud(); }
    });
  }

  // 收服 / 换随行之后要重读一次 /pet/state：buddy、进化阶段、属性表都在那里。
  function reloadState(cb) {
    if (!api) { if (cb) cb(); return; }
    api.get('/pet/state').then(function(res) {
      var d = (res.data && res.data.data) || {};
      state = d.state || state;
      applyStateMeta(d);
      if (cb) cb();
    }, function() { if (cb) cb(); });
  }

  function clearEl(el) { while (el && el.firstChild) el.removeChild(el.firstChild); }

  function stopFight() {
    fightToken++;
    if (fightTimer) { clearTimeout(fightTimer); fightTimer = null; }
  }

  function battleSection() {
    var sec = h('div', 'ci-pet-battle');
    fillBattle(sec);
    return sec;
  }

  function fillBattle(sec) {
    if (!sec) return;
    stopFight();
    clearEl(sec);
    if (!battle) {
      // ⚠️ 失败必须停下来：之前「拿不到就再请求」会变成死循环——网断了就一直在刷接口。
      if (battleFailed) {
        var err = h('div', 'ci-pet-battle-loading', '战力档案没加载出来');
        var retry = h('button', 'ci-pet-foe-btn', '重试');
        retry.addEventListener('click', function() {
          battleFailed = false;
          fillBattle(sec);
        });
        err.appendChild(retry);
        sec.appendChild(err);
        return;
      }
      sec.appendChild(h('div', 'ci-pet-battle-loading', '战力计算中…'));
      loadBattle(function() { if (sec.parentNode) fillBattle(sec); });
      return;
    }
    var c = battle.combat || {};
    var rec = battle.record || {};

    // 布局（v2.1 竞技场制）：默认视野里没有任何卡片——
    //   场景占满首屏（我方宠物 vs 本周 Boss，双方 HP 牌浮在场景角上），
    //   底部一条指令条（对战/副本/备战/荣誉），所有信息都收进召唤出来的抽屉。
    // 这才是游戏的组织方式：先看到「它在打谁」，要做什么再点什么。
    var arenaPage = h('div', 'ci-pet-arena-page');
    arenaPage.appendChild(buildArena());
    arenaPage.appendChild(commandBar(sec));
    sec.appendChild(arenaPage);
  }


  // 对战页的属性条复用图鉴页那一套组件，只是改完要就地重画对手卡。
    // ==================== 竞技场（v2.1）：场景即页面 ====================
  function buildArena() {
    var env = battle.environment || {};
    var boss = env.boss || {};
    var c = battle.combat || {};
    var myPow = c.power || 0;

    var box = h('div', 'ci-pet-arena is-env-' + (env.id || 'wind_valley'));
    var scene = h('div', 'ci-pet-arena-scene');
    scene.appendChild(h('div', 'ci-pet-scene-sky'));
    scene.appendChild(h('div', 'ci-pet-scene-stars'));
    scene.appendChild(h('div', 'ci-pet-scene-hills'));
    scene.appendChild(h('div', 'ci-pet-scene-ground'));

    // 敌方 HP 牌（左上，宝可梦式浮牌）+ Boss 大盘（右）
    scene.appendChild(hpPlate(boss.name || '本周 Boss', boss.type, boss.power, 'foe'));
    var foeSide = h('div', 'ci-pet-arena-foe');
    var disc = h('div', 'ci-pet-bstage-foedisc');
    disc.appendChild(h('span', 'ci-pet-bstage-foeicon', boss.icon || env.icon || '👾'));
    if (boss.type) disc.appendChild(elementChip(boss.type));
    foeSide.appendChild(disc);
    scene.appendChild(foeSide);

    // VS
    scene.appendChild(h('div', 'ci-pet-bstage-vs', 'VS'));

    // 我方宠物（左下，大）+ 我方 HP 牌（右下）
    var me = h('div', 'ci-pet-arena-me');
    if (state && state.design && state.design.type === 'video') {
      var v = document.createElement('video');
      v.className = 'ci-pet-arena-video';
      v.muted = true; v.loop = true; v.autoplay = true;
      v.setAttribute('playsinline', 'playsinline');
      v.setAttribute('webkit-playsinline', 'webkit-playsinline');
      v.src = poolUrl(heroIdleName());
      loadHeroPool();
      me.appendChild(v);
    } else if (state && state.design) {
      var pv = document.createElement('canvas');
      paint(pv, state.design, 10);
      me.appendChild(pv);
    }
    scene.appendChild(me);
    scene.appendChild(hpPlate((state && state.name) || '小家伙', battle.battleType || 'grass', myPow, 'me'));

    // 场景角落的小灰字：战绩一览（能看见但不是主角）
    var rec = battle.record || {};
    scene.appendChild(h('div', 'ci-pet-arena-rec',
      (rec.win || 0) + ' 胜 ' + (rec.lose || 0) + ' 负 · ' + (rec.points || 0) + ' 分' +
      (rec.streak > 0 ? ' · 🔥' + rec.streak + ' 连胜' : '')));
    box.appendChild(scene);
    return box;
  }

  // 战绩细信息条（荣誉抽屉顶部）
  function battleMetaStrip() {
    var rec = battle.record || {};
    var capVal = (battle.cap === undefined ? CAP_FALLBACK : battle.cap);
    var parts = [];
    parts.push((rec.win || 0) + ' 胜 ' + (rec.lose || 0) + ' 负 · ' + (rec.points || 0) + ' 分');
    if (rec.streak > 0) parts.push('🔥 ' + rec.streak + ' 连胜');
    parts.push(capVal > 0
      ? ('今日 ' + (battle.today || 0) + ' / ' + capVal)
      : ('今日 ' + (battle.today || 0) + ' 场'));
    if (battle.myRank) parts.push('全班第 ' + battle.myRank + ' 名');
    var def = battle.defend || {};
    if (def.total) parts.push('守擂 ' + (def.held || 0) + ' 胜');
    var strip = h('div', 'ci-pet-bmetastrip');
    for (var i = 0; i < parts.length; i++) {
      strip.appendChild(h('span', 'ci-pet-bmetastrip-item', parts[i]));
    }
    return strip;
  }

  // HP 牌：名字 + Lv + 血条 + 战力，宝可梦式浮在场景角上
  function hpPlate(name, typeId, power, side) {
    var el = h('div', 'ci-pet-hpplate ci-pet-hpplate--' + side + (typeId ? ' is-t-' + typeId : ''));
    var top = h('div', 'ci-pet-hpplate-top');
    top.appendChild(h('span', 'ci-pet-hpplate-name', name));
    var lv = h('span', 'ci-pet-hpplate-lv', 'Lv');
    top.appendChild(lv);
    el.appendChild(top);
    var bar = h('div', 'ci-pet-hpplate-bar');
    bar.appendChild(h('span', 'ci-pet-hpplate-fill'));
    el.appendChild(bar);
    var bot = h('div', 'ci-pet-hpplate-bot');
    bot.appendChild(h('span', 'ci-pet-hpplate-hptag', 'HP'));
    bot.appendChild(h('span', 'ci-pet-hpplate-pow', String(power)));
    el.appendChild(bot);
    if (side === 'me') bindLevel(lv);
    return el;
  }

  // 指令条：对战的全部入口。游戏只给你四个词，不给报表。
  function commandBar(sec) {
    var bar = h('div', 'ci-pet-cmdbar');
    // v0.25.0：图标全部换成像素图（emoji 的尺寸/配色/描边都不受控，
    // 四个 26px 彩色 emoji 是整页最吵的一块）。tone 只作为「按键顶部的色条」，
    // 底色统一是木牌 —— 四个高饱和渐变按钮会让这一页和小家像是两个游戏。
    var defs = [
      { id: 'fight', icon: 'fight', label: '对战', tone: 'is-red' },
      { id: 'tower', icon: 'tower', label: '试炼塔', tone: 'is-blue' },
      { id: 'env',   icon: 'env',   label: '副本', tone: 'is-teal' },
      { id: 'build', icon: 'build', label: '备战', tone: 'is-purple' },
      { id: 'honor', icon: 'honor', label: '荣誉', tone: 'is-gold' }
    ];
    for (var i = 0; i < defs.length; i++) {
      (function(d) {
        var b = h('button', 'ci-pet-cmdbtn ' + d.tone);
        var ic = pixIcon(d.icon, 'ci-pet-cmdbtn-icon');
        if (ic) b.appendChild(ic);
        b.appendChild(h('span', 'ci-pet-cmdbtn-label', d.label));
        b.addEventListener('click', function() {
          if (d.id === 'build') { renderBuildEditor(); return; }
          // 塔一级直达塔 pane：它曾是抽屉里的第三个标签，实测没人翻到（深渊因此不可见）。
          // ⚠️ sheet 的 kind 仍是 'fight'（抽屉分类），塔只是它里面的初始 pane——
          //    直接 openSheet(sec,'tower') 会掉进空抽屉（三个分支都不匹配）。
          openSheet(sec, d.id === 'tower' ? 'fight' : d.id, d.id === 'tower' ? 'tower' : null);
        });
        bar.appendChild(b);
      })(defs[i]);
    }
    return bar;
  }

  // 抽屉：从底部升起的整幅菜单（ scrim + 面板 ）。一次只开一个。
  function openSheet(sec, kind) {
    closeSheet(sec);
    var wrap = h('div', 'ci-pet-sheet-wrap');
    wrap.setAttribute('data-kind', kind);
    var scrim = h('div', 'ci-pet-sheet-scrim');
    scrim.addEventListener('click', function() { closeSheet(sec); });
    var sheet = h('div', 'ci-pet-sheet');
    var head = h('div', 'ci-pet-sheet-head');
    var title = { fight: '选择对手', env: '本周副本', honor: '荣誉室' }[kind] || '';
    head.appendChild(h('span', 'ci-pet-sheet-title', title));
    var close = h('button', 'ci-pet-sheet-close');
    var xIco = pixIcon('close', 'ci-pet-sheet-close-ico');
    if (xIco) close.appendChild(xIco);
    close.addEventListener('click', function() { closeSheet(sec); });
    head.appendChild(close);
    sheet.appendChild(head);
    var body = h('div', 'ci-pet-sheet-body');
    if (kind === 'fight') buildFightSheet(body, sec, arguments.length > 2 ? arguments[2] : null);
    else if (kind === 'env') buildEnvSheet(body, sec);
    else if (kind === 'honor') buildHonorSheet(body, sec);
    sheet.appendChild(body);
    wrap.appendChild(scrim);
    wrap.appendChild(sheet);
    sec.appendChild(wrap);
  }
  function closeSheet(sec) {
    var old = sec.querySelector('.ci-pet-sheet-wrap');
    if (old && old.parentNode) old.parentNode.removeChild(old);
  }

  // 对战抽屉：准备（天气/属性/风格）+ 三个标签（影子/练习赛/试炼塔）
  function buildFightSheet(body, sec, initialTab) {
    body.appendChild(battleOpsRow(sec));
    var out = !battle || (typeof battle.left === 'number' && battle.left === 0 && battle.cap > 0);
    var tabs = h('div', 'ci-pet-sheettabs');
    var panes = {};
    var defs = [
      { id: 'shadow', label: '真人影子' },
      { id: 'spar', label: '练习赛' },
      { id: 'tower', label: '试炼之塔' },
      { id: 'exp', label: '远征' }
    ];
    defs.forEach(function(d, idx) {
      var t = h('button', 'ci-pet-sheettab' +
        ((initialTab ? d.id === initialTab : idx === 0) ? ' is-on' : ''));
      t.textContent = d.label;
      t.addEventListener('click', function() {
        var kids = tabs.childNodes;
        for (var m = 0; m < kids.length; m++) kids[m].className = 'ci-pet-sheettab';
        t.className = 'ci-pet-sheettab is-on';
        for (var k in panes) {
          if (Object.prototype.hasOwnProperty.call(panes, k)) {
            panes[k].style.display = (k === d.id) ? '' : 'none';
          }
        }
      });
      tabs.appendChild(t);
      var pane = h('div', 'ci-pet-sheetpane');
      if (d.id === 'shadow') {
        var shadows = battle.shadows || [];
        if (!shadows.length) {
          pane.appendChild(h('div', 'ci-pet-battle-none',
            '暂时没有和你羁绊相近的同学，先打练习赛，过几天再来看看。'));
        } else {
          pane.appendChild(foesSheet(sec, shadows, out));
        }
      } else if (d.id === 'spar') {
        pane.appendChild(foesSheet(sec, battle.opponents || [], out));
      } else if (d.id === 'exp') {
        pane.appendChild(expeditionSection(sec));
      } else {
        pane.appendChild(towerSection(sec));
      }
      var hidden = initialTab ? (d.id !== initialTab) : (idx > 0);
      if (hidden) pane.style.display = 'none';
      panes[d.id] = pane;
      body.appendChild(pane);
    });
    body.appendChild(tabs);
    // 标签栏固定在抽屉底部（拇指高度），pane 放上面 —— 见 CSS
    body.appendChild(tabs);
  }

  // 副本抽屉：环境横幅 + 挑战按钮
  function buildEnvSheet(body, sec) {
    body.appendChild(environmentCard(sec));
    var env = battle.environment || {};
    var dailyLeft = (env.dailyLeft === undefined) ? 1 : env.dailyLeft;
    var btn = h('button', 'ci-pet-bstage-fight', dailyLeft > 0 ? '挑战 ' + ((env.boss && env.boss.name) || 'Boss') : '今日 Boss 已挑战');
    if (dailyLeft <= 0) btn.disabled = true;
    btn.addEventListener('click', function() {
      closeSheet(sec);
      doBossFight(sec, btn);
    });
    body.appendChild(btn);
  }

  // 荣誉抽屉：战绩条 + 战报/成就/称号/积分榜
  function buildHonorSheet(body, sec) {
    var inboxEl = inboxBox(sec);
    if (inboxEl) body.appendChild(inboxEl);
    body.appendChild(battleMetaStrip());
    body.appendChild(metaFold());
    body.appendChild(h('div', 'ci-pet-battle-tip',
      '影子是同学家那只宠物的快照：他不用在线，打完会收到你的挑战留言。' +
      '练习赛和影子只涨战力积分，都不碰羁绊。当天打得越多，每场积分越少（前 5 场全额）。'));
  }

  // ==================== 环境副本（v2.0）====================
  // 每周轮换的战斗环境。Boss 本体在上方舞台，这里只留横幅与规则注解。
  function skillTypeLabel(s) {
    if (s.type === 'stat') return '属性';
    if (s.type === 'buff') return '增益';
    if (s.type === 'heal') return '回复';
    if (s.type === 'active') return '主动';
    return '被动';
  }
  function environmentCard(sec) {
    var env = battle.environment;
    if (!env) return h('div', '');
    var box = h('div', 'ci-pet-env is-env-' + (env.id || 'wind_valley'));
    // 横幅：大图标 + 环境名 + 效果，一眼「这是本周活动」
    var banner = h('div', 'ci-pet-env-banner');
    banner.appendChild(h('span', 'ci-pet-env-bigicon', env.icon || '🌍'));
    var bt = h('div', 'ci-pet-env-bannertxt');
    bt.appendChild(h('div', 'ci-pet-env-name', env.name || ''));
    bt.appendChild(h('div', 'ci-pet-env-effect', env.effectText || ''));
    banner.appendChild(bt);
    banner.appendChild(h('span', 'ci-pet-env-week', '第 ' + (env.week || 1) + ' 周'));
    box.appendChild(banner);

    // 注解：奖励与规则
    if (env.reward) {
      box.appendChild(h('div', 'ci-pet-env-rule',
        '首杀必掉 ' + (env.reward.icon || '') + ' ' + (env.reward.name || '') +
        ' · Boss 每天一次 · 胜 +8 / 负 +2 分'));
    }
    var b = env.boss || {};
    if (b.desc) box.appendChild(h('div', 'ci-pet-env-desc', b.desc));
    var footRow = h('div', 'ci-pet-env-foot');
    if (env.firstKillDone) footRow.appendChild(h('span', 'ci-pet-env-done', '✓ 本周首杀已拿'));
    else if (env.bossWins) footRow.appendChild(h('span', 'ci-pet-env-done is-dim', '累计击败 ' + env.bossWins + ' 次'));
    if (env.next) footRow.appendChild(h('span', 'ci-pet-env-next', '下周 · ' + (env.next.icon || '') + ' ' + (env.next.name || '')));
    if (footRow.childNodes.length) box.appendChild(footRow);
    return box;
  }

  function doBossFight(sec, btn) {
    if (!api) return;
    btn.disabled = true;
    btn.textContent = '挑战中…';
    var body = { mode: 'open' };
    if (battle && battle.tactic) body.tactic = battle.tactic;
    api.post('/pet/battle/environment/boss', body).then(function(res) {
      var d = (res.data && res.data.data) || {};
      if (!d.steps) { btn.disabled = false; btn.textContent = '挑战本周 Boss'; return; }
      absorbProgress(d);
      var envName = (d.env && d.env.name) || '环境副本';
      battle = null;
      playFight(sec, d, { boss: true, envName: envName, endpoint: '/pet/battle/environment/boss', extra: {} });
    }, function(err) {
      var msg = (err && err.response && err.response.data && err.response.data.message) || '挑战失败';
      sysToast(msg, 'error');
      btn.disabled = false;
      btn.textContent = '挑战本周 Boss';
    });
  }

  // ==================== 备战面板（v2.0）====================
  // 一个面板说完「上场带什么」：装备三槽 → 技能库 → 战力与入口。
  // 之前技能栏和 Build 卡是两张卡，玩家要在两张卡之间来回看——它们本来就是一件事。


  // ==================== Build 编辑器（v2.0）====================
  // 整页视图（和拼豆工作台同款模式）：clearRoot 起一页，保存/返回回 renderHome。
  // 每次点选整页重画——技能+装备总量不过二十几个 chips，重画比局部同步可靠得多。
  // 互斥提示（v0.28.3）：与后端 SKILL_CONFLICTS / 引擎 skillEffects 三处同源。
  // 之前提示「先选的生效」是错误承诺——引擎固定保留规则表靠前者（heavy>blast 等），
  // 玩家按提示以为 blast 生效，实战永远不触发。现在直接指名谁生效。
  var BUILD_HINTS = {
    blast: '爆发类互斥：实战只生效「千钧一击」',
    shield: '续航类互斥：实战只生效「鲸吞」',
    guard_stance: '增益类互斥：实战只生效「狂怒」'
  };
  var BUILD_CONFLICTS = {
    blast: ['heavy'], heavy: ['blast'],
    shield: ['lifesteal'], lifesteal: ['shield'],
    guard_stance: ['berserk'], berserk: ['guard_stance']
  };
  //
  // ⚠️ 入口与重画必须分开（v0.31.1 修复「选技能/装备没反应」）：
  //    以前点选回调直接调 renderBuildEditor()，而它在开头无条件把 buildEdit
  //    重新赋成 battle.equipped / battle.build.equipment —— 玩家刚点上的东西
  //    在重画的同一帧被抹回原样，表现就是「点了完全没反应」。
  //    现在 render = 初始化一次，paint = 纯重画。
  function renderBuildEditor() {
    if (!battle) { renderHome(); return; }
    var bd = battle.build || {};
    var eq0 = bd.equipment || {};
    buildEdit = {
      skills: (battle.equipped || []).slice(),
      equipment: {
        weapon: eq0.weapon || null,
        accessory: eq0.accessory || null,
        consumable: eq0.consumable || null
      },
      name: bd.strategy_name || ''
    };
    paintBuildEditor();
  }

  function paintBuildEditor() {
    if (!battle || !buildEdit) { renderHome(); return; }
    var inv = battle.inventory || { owned: [] };
    // 编辑器比一屏长（960×680 下约 1121px），装备区整个在折叠线以下。
    // 不保留滚动位置的话，每点一次就跳回顶部，玩家同样读作「没反应」。
    var keepTop = root ? root.scrollTop : 0;
    clearRoot();
    var box = h('div', 'ci-pet-beditor');
    var head = h('div', 'ci-pet-beditor-head');
    head.appendChild(h('div', 'ci-pet-beditor-title', 'Build 配置器'));
    var back = h('button', 'ci-pet-beditor-back', '← 返回');
    back.addEventListener('click', function() { buildEdit = null; renderHome(); });
    head.appendChild(back);
    box.appendChild(head);
    var slots = battle.skillSlots || 2;
    box.appendChild(h('div', 'ci-pet-beditor-sub',
      '技能最多 ' + slots + ' 个（随进化增多）。互斥的技能只生效其一：爆发留千钧、续航留鲸吞、增益留狂怒。'));

    var nameInput = document.createElement('input');
    nameInput.className = 'ci-pet-beditor-name';
    nameInput.maxLength = 12;
    nameInput.placeholder = '给这套 Build 起个名字（可不填）';
    nameInput.value = buildEdit.name;
    nameInput.addEventListener('input', function() { buildEdit.name = nameInput.value; });
    box.appendChild(nameInput);

    box.appendChild(h('div', 'ci-pet-beditor-sec',
      '技能 ' + buildEdit.skills.length + ' / ' + slots));
    var skillRow = h('div', 'ci-pet-beditor-skills');
    var catalog = battle.skillCatalog || battle.skills || [];
    for (var i = 0; i < catalog.length; i++) {
      (function(s) {
        var on = buildEdit.skills.indexOf(s.id) >= 0;
        var locked = s.unlocked === false;
        var cell = h('button', 'ci-pet-beditor-skill' +
          (on ? ' is-on' : '') + (locked ? ' is-locked' : '') +
          (s.rarity ? ' is-r-' + s.rarity : ''));
        cell.appendChild(h('span', 'ci-pet-beditor-skill-icon', s.icon || ''));
        var txt = h('span', 'ci-pet-beditor-skill-txt');
        txt.appendChild(h('span', 'ci-pet-beditor-skill-name', s.name));
        txt.appendChild(h('span', 'ci-pet-beditor-skill-desc',
          locked ? ('羁绊 ' + s.unlockBond + ' 解锁') : (s.desc || '')));
        cell.appendChild(txt);
        cell.appendChild(h('span', 'ci-pet-beditor-skill-sub',
          locked ? '🔒' : skillTypeLabel(s)));
        cell.setAttribute('title', s.desc || '');
        cell.addEventListener('click', function() {
          if (locked) {
            sysToast('羁绊到 ' + s.unlockBond + ' 解锁「' + s.name + '」', 'info');
            return;
          }
          var idx = buildEdit.skills.indexOf(s.id);
          if (idx >= 0) {
            buildEdit.skills.splice(idx, 1);
          } else {
            // 互斥提示：实战里引擎会自动只留先选的那个，这里先说清楚
            var conflicts = BUILD_CONFLICTS[s.id] || [];
            for (var c = 0; c < conflicts.length; c++) {
              if (buildEdit.skills.indexOf(conflicts[c]) >= 0) {
                sysToast(BUILD_HINTS[s.id] || ('「' + s.name + '」与已选技能互斥'), 'info');
                break;
              }
            }
            if (buildEdit.skills.length >= slots) buildEdit.skills.shift();
            buildEdit.skills.push(s.id);
          }
          paintBuildEditor();
        });
        skillRow.appendChild(cell);
      })(catalog[i]);
    }
    box.appendChild(skillRow);

    box.appendChild(h('div', 'ci-pet-beditor-sec', '装备（Boss 周首杀必掉 · 野怪战斗有概率掉落）'));
    box.appendChild(beditorEquipRow({ key: 'weapon', name: '武器', types: ['weapon'] }, inv));
    box.appendChild(beditorEquipRow({ key: 'accessory', name: '饰品', types: ['accessory'] }, inv));
    box.appendChild(beditorEquipRow({ key: 'consumable', name: '消耗品', types: ['consumable'] }, inv));

    // 实时预览：直接引用技能/装备的描述原文（服务端同一份数据，零口径漂移）
    var prev = h('div', 'ci-pet-beditor-preview');
    prev.appendChild(h('span', 'ci-pet-beditor-preview-label', '这套 Build 会生效'));
    var parts = [];
    for (var p = 0; p < buildEdit.skills.length; p++) {
      for (var q = 0; q < catalog.length; q++) {
        if (catalog[q].id === buildEdit.skills[p]) parts.push(catalog[q].icon + catalog[q].name + '：' + catalog[q].desc);
      }
    }
    var allSlots = ['weapon', 'accessory', 'consumable'];
    for (var r2 = 0; r2 < allSlots.length; r2++) {
      var eid = buildEdit.equipment[allSlots[r2]];
      if (!eid) continue;
      for (var w = 0; w < inv.owned.length; w++) {
        if (inv.owned[w].id === eid) parts.push(inv.owned[w].icon + inv.owned[w].name + '：' + inv.owned[w].effect);
      }
    }
    prev.appendChild(h('span', 'ci-pet-beditor-preview-val',
      parts.length ? parts.join('；') : '（裸装基线）'));
    box.appendChild(prev);

    var actions = h('div', 'ci-pet-beditor-actions');
    var save = h('button', 'ci-pet-beditor-save', '保存 Build');
    save.addEventListener('click', function() {
      if (!api) { buildEdit = null; renderHome(); return; }
      save.disabled = true;
      api.post('/pet/battle/build/update', {
        skills: buildEdit.skills,
        equipment: buildEdit.equipment,
        strategy_name: buildEdit.name
      }).then(function(res) {
        var d = (res.data && res.data.data) || {};
        if (d.build) battle.build = d.build;
        if (d.equipped) battle.equipped = d.equipped;
        if (d.inventory) battle.inventory = d.inventory;
        sysToast('Build 已保存', 'success');
        buildEdit = null;
        renderHome();
      }, function(err) {
        var msg = (err && err.response && err.response.data && err.response.data.message) || '保存失败';
        sysToast(msg, 'error');
        save.disabled = false;
      });
    });
    actions.appendChild(save);
    var cancel = h('button', 'ci-pet-beditor-cancel', '返回不保存');
    cancel.addEventListener('click', function() { buildEdit = null; renderHome(); });
    actions.appendChild(cancel);
    box.appendChild(actions);
    root.appendChild(box);
  }

  function beditorEquipRow(sd, inv) {
    var row = h('div', 'ci-pet-beditor-equiprow');
    row.appendChild(h('span', 'ci-pet-beditor-equipname', sd.name));
    var grid = h('div', 'ci-pet-beditor-equipgrid');
    var cur = (buildEdit.equipment || {})[sd.key] || null;
    var none = h('button', 'ci-pet-beditor-equip' + (cur ? '' : ' is-on'));
    none.appendChild(h('span', 'ci-pet-beditor-equip-item', '不装'));
    none.addEventListener('click', function() {
      buildEdit.equipment[sd.key] = null;
      paintBuildEditor();
    });
    grid.appendChild(none);
    for (var i = 0; i < inv.owned.length; i++) {
      (function(item) {
        if (sd.types.indexOf(item.type) < 0) return;
        var off = item.type === 'consumable' && (item.charges || 0) <= 0;
        var on = cur === item.id;
        var cell = h('button', 'ci-pet-beditor-equip' +
          (on ? ' is-on' : '') + (off ? ' is-empty' : '') +
          (item.rarity ? ' is-r-' + item.rarity : ''));
        cell.appendChild(h('span', 'ci-pet-beditor-equip-icon', item.icon || ''));
        var txt = h('span', 'ci-pet-beditor-equip-txt');
        txt.appendChild(h('span', 'ci-pet-beditor-equip-item', item.name));
        txt.appendChild(h('span', 'ci-pet-beditor-equip-desc', item.effect || ''));
        cell.appendChild(txt);
        if (item.type === 'consumable') {
          cell.appendChild(h('span', 'ci-pet-beditor-equip-charges', '×' + (item.charges || 0)));
        }
        if (off) {
          cell.disabled = true;
        } else {
          cell.addEventListener('click', function() {
            buildEdit.equipment[sd.key] = on ? null : item.id;
            paintBuildEditor();
          });
        }
        grid.appendChild(cell);
      })(inv.owned[i]);
    }
    row.appendChild(grid);
    return row;
  }

  // 试炼塔：线性进度。有终点、有台阶、有过不去的那一层。
  function towerSection(sec) {
    var t = battle.tower;
    if (!t) return h('div', '');
    var box = h('div', 'ci-pet-tower');

    var headRow = h('div', 'ci-pet-tower-head');
    headRow.appendChild(h('span', 'ci-pet-tower-title', '试炼塔 ' + (t.cleared || 0) + ' / ' + t.total));
    headRow.appendChild(h('span', 'ci-pet-tower-quota',
      t.cap > 0
        ? ('今日 ' + (t.today || 0) + ' / ' + t.cap + ' 次')
        : ('今日挑战 ' + (t.today || 0) + ' 次')));
    box.appendChild(headRow);

    // 今日规则（v0.28.0）：每天两条词缀，全班同一天完全相同（和天气一个先例）。
    // 它是「每天的变奏」——同一个人、同一个塔，今天的正确打法不一样。
    var mods = t.dailyMods || [];
    if (mods.length) {
      var modRow = h('div', 'ci-pet-modrow');
      modRow.appendChild(h('span', 'ci-pet-modrow-label', '今日规则'));
      for (var mi = 0; mi < mods.length; mi++) {
        var chip = h('span', 'ci-pet-modchip', mods[mi].icon + ' ' + mods[mi].name);
        chip.setAttribute('title', mods[mi].text);
        modRow.appendChild(chip);
      }
      var modTxt = h('span', 'ci-pet-modrow-text',
        mods.map(function(m) { return m.text; }).join(' · '));
      box.appendChild(modRow);
      box.appendChild(modTxt);
    }

    // 进度格：10 个小方块，通关的填色
    var pips = h('div', 'ci-pet-tower-pips');
    for (var i = 0; i < t.floors.length; i++) {
      var f = t.floors[i];
      pips.appendChild(h('span',
        'ci-pet-tower-pip' + (f.cleared ? ' is-done' : '') + (f.f === (t.cleared || 0) + 1 ? ' is-next' : ''),
        String(f.f)));
    }
    box.appendChild(pips);

    if (!t.next) {
      // ---- 深渊（v0.28.0）：塔打穿之后唯一的无尽内容 ----
      // 「你是塔顶传说」只是毕业典礼，不是终点。深渊没有底：
      // 每一层属性轮换（逼你换本命）、难度只按深度缓涨、积分进塔积分池接着上榜。
      var ab = t.abyss;
      var abx = h('div', 'ci-pet-abyss');
      abx.appendChild(h('div', 'ci-pet-abyss-head',
        '👑 十层全通 · 深渊已开'));
      if (ab && ab.next) {
        var nx = ab.next;
        abx.appendChild(h('div', 'ci-pet-abyss-depth',
          '当前深度 ' + ab.depth + ' 层'));
        var acard = h('div', 'ci-pet-tower-card is-abyss');
        var atop = h('div', 'ci-pet-foe-top');
        var awho = h('div', 'ci-pet-foe-who');
        awho.appendChild(h('span', 'ci-pet-foe-name',
          '深渊第 ' + nx.depth + ' 层 · ' + nx.name));
        if (nx.type) awho.appendChild(elementChip(nx.type));
        var aodds = oddsLabel(nx.power);
        awho.appendChild(h('span', 'ci-pet-odds ci-pet-odds--' + aodds.key, aodds.text));
        atop.appendChild(awho);
        var aout = typeof t.left === 'number' && t.left === 0 && t.cap > 0;
        var abtn = h('button', 'ci-pet-foe-btn is-abyss', aout ? '今日次数用完' : '下潜');
        if (aout) abtn.disabled = true;
        abtn.addEventListener('click', function() { doTowerFight(sec, abtn); });
        atop.appendChild(abtn);
        acard.appendChild(atop);
        acard.appendChild(h('div', 'ci-pet-foe-meta',
          '战力 ' + nx.power + ' · 难度 ×' + ab.buff +
          ' · 通关 +' + ab.gain + ' 塔积分'));
        if (nx.desc) acard.appendChild(h('div', 'ci-pet-foe-desc', nx.desc));
        abx.appendChild(acard);
        abx.appendChild(h('div', 'ci-pet-abyss-tip',
          '深渊对手的属性一层一换——克它的本命比硬冲多活两回合。' +
          '失败不清深度：卡在哪层，明天接着从那层往下走。'));
      }
      box.appendChild(abx);
      return box;
    }

    var n = t.next;
    var card = h('div', 'ci-pet-tower-card');
    var top = h('div', 'ci-pet-foe-top');
    var who = h('div', 'ci-pet-foe-who');
    who.appendChild(h('span', 'ci-pet-foe-name', '第 ' + n.f + ' 层 · ' + n.name));
    if (n.type) who.appendChild(elementChip(n.type));
    var odds = oddsLabel(n.power);
    who.appendChild(h('span', 'ci-pet-odds ci-pet-odds--' + odds.key, odds.text));
    top.appendChild(who);

    // 塔也不限次数（left = -1），按钮永远可点
    var out = typeof t.left === 'number' && t.left === 0 && t.cap > 0;
    var btn = h('button', 'ci-pet-foe-btn', out ? '今日次数用完' : '挑战');
    if (out) btn.disabled = true;
    btn.addEventListener('click', function() { doTowerFight(sec, btn); });
    top.appendChild(btn);
    card.appendChild(top);
    card.appendChild(h('div', 'ci-pet-foe-meta',
      '羁绊 ' + n.bond + ' · 战力 ' + n.power + (n.skills && n.skills.length ? ' · 会 ' + n.skills.length + ' 个技能' : '')));
    if (n.desc) card.appendChild(h('div', 'ci-pet-foe-desc', n.desc));
    box.appendChild(card);

    // 深渊预告（未通关）：「通关十层解锁深渊」是全游戏最长的目标，
    // 目标不可见就等于不存在——用一条锁定的预告把它挂在进度格下面。
    if ((t.cleared || 0) < t.total) {
      var lock = h('div', 'ci-pet-abyss is-locked');
      lock.appendChild(h('div', 'ci-pet-abyss-head', '🌑 深渊 · 尚未开启'));
      lock.appendChild(h('div', 'ci-pet-abyss-depth',
        '通过第 ' + t.total + ' 层解锁 · 还差 ' + (t.total - (t.cleared || 0)) + ' 层'));
      lock.appendChild(h('div', 'ci-pet-abyss-tip',
        '塔层不会跟着你变强——卡住的那层，喂饱它、涨了羁绊、换套技能，总能过去。'));
      box.appendChild(lock);
    }
    box.appendChild(h('div', 'ci-pet-tower-tip',
      '整座塔都是土属性：草本命打起来最轻松，电本命会被全程克制。' +
      '塔层不会跟着你变强，卡在哪层就是卡在哪层——喂饱宠物、涨了羁绊就能过去。' +
      '不限次数随时来打，和练习赛的积分分开算。'));
    return box;
  }

  // 按战力比给难度标签（与服务端同一套阈值）
  function oddsLabel(foePower) {
    var mine = (battle && battle.combat && battle.combat.power) || 0;
    if (!foePower || !mine) return { key: 'even', text: '势均' };
    var r = mine / foePower;
    if (r >= 1.12) return { key: 'easy', text: '好打' };
    if (r <= 0.90) return { key: 'hard', text: '吃力' };
    return { key: 'even', text: '势均' };
  }

  function doTowerFight(sec, btn) {
    if (!api) return;
    btn.disabled = true;
    var btnText = btn.textContent;
    btn.textContent = '爬塔中…';
    var body = { mode: 'open' };
    if (battle && battle.tactic) body.tactic = battle.tactic;
    api.post('/pet/tower/fight', body).then(function(res) {
      var d = (res.data && res.data.data) || {};
      if (!d.steps) { btn.disabled = false; btn.textContent = btnText; return; }
      absorbProgress(d);
      battle = null;    // 层数/次数都变了，回来时重新取
      playTowerFight(sec, d);
    }, function(err) {
      var msg = (err && err.response && err.response.data && err.response.data.message) || '爬塔失败';
      sysToast(msg, 'error');
      btn.disabled = false;
      btn.textContent = btnText;
      loadBattle(function() { fillBattle(sec); });
    });
  }

  // 深渊里程碑夸赞（v0.28.0）：结算横幅上的一次性高光。
  // 深度只有踩中里程碑才说话——每次都说就会变成打卡提示音。
  var ABYSS_CHEERS = {
    1: '第一层，只是开始——下面还有一整个无底的世界',
    3: '深度 3：渊行者称号到手',
    5: '深度 5：你已经站在大部分人到不了的地方',
    7: '深度 7：破晓者的门槛，跨过去了',
    10: '深度两位数：这已经不能叫运气了',
    12: '深度 12：渊之尽头在望',
    15: '深度 15：教室里可能没有第二个人到过这里',
    20: '深度 20：传说。真的。'
  };

  // 远征的战斗回放：与塔同构，结算分支走 opts.expedition
  function playExpeditionFight(sec, btn) {
    var txt = btn.textContent;
    btn.disabled = true;
    btn.textContent = '出发…';
    api.post('/pet/expedition/fight', { mode: 'open' }).then(function(res) {
      var d = (res.data && res.data.data) || {};
      if (!d.steps) { btn.disabled = false; btn.textContent = txt; return; }
      absorbProgress(d);
      battle = null;    // 远征进度变了，回来重新取
      playFight(sec, d, { expedition: true, depth: d.depth, endpoint: '/pet/expedition/fight', extra: {} });
    }, function(err) {
      btn.disabled = false;
      btn.textContent = txt;
      var msg = (err && err.response && err.response.data && err.response.data.message) || '出发失败';
      sysToast(msg, 'error');
    });
  }

  // 远征 pane：锁定 / 待出发 / 进行中（深度点 + 祝福）/ 等挑祝福（三选一）
  function expeditionSection(sec) {
    var box = h('div', 'ci-pet-exp');
    var ex = (battle && battle.expedition) || {};
    var headRow = h('div', 'ci-pet-tower-head');
    headRow.appendChild(h('span', 'ci-pet-tower-title', '🏕 远征'));
    headRow.appendChild(h('span', 'ci-pet-tower-quota', ex.best ? ('最佳深度 ' + ex.best) : '尚未出发'));
    box.appendChild(headRow);
    box.appendChild(h('div', 'ci-pet-tower-tip',
      '一次最多五层，赢了挑一个祝福接着往下走，输了就地结算。祝福只在这一次远征里有效——' +
      '每天路线全班相同，看谁走得深。'));

    if (ex.locked) {
      var lk = h('div', 'ci-pet-abyss is-locked');
      lk.appendChild(h('div', 'ci-pet-abyss-head', '🏕 远征 · 尚未开启'));
      lk.appendChild(h('div', 'ci-pet-abyss-depth',
        '通过试炼塔第 ' + (ex.unlockTower || 3) + ' 层解锁'));
      lk.appendChild(h('div', 'ci-pet-abyss-tip',
        '先把塔爬到三层，证明你能带它出门远行。'));
      box.appendChild(lk);
      return box;
    }

    if (ex.pending && ex.pending.length === 3) {
      // 层间三选一（Hades boons）：本局生效，输了就蒸发
      box.appendChild(h('div', 'ci-pet-exp-pendtitle',
        '第 ' + (ex.depth || 0) + ' 层已通过——选一个祝福带走'));
      var pickRow = h('div', 'ci-pet-exp-boons');
      for (var pi = 0; pi < ex.pending.length; pi++) {
        (function(b) {
          var card = h('button', 'ci-pet-exp-boon' + (b.once ? ' is-once' : ''));
          card.appendChild(h('span', 'ci-pet-exp-boon-icon', b.icon || ''));
          card.appendChild(h('span', 'ci-pet-exp-boon-name', b.name || b.id));
          card.appendChild(h('span', 'ci-pet-exp-boon-text', b.text || ''));
          card.addEventListener('click', function() {
            card.disabled = true;
            api.post('/pet/expedition/boon', { id: b.id }).then(function(res) {
              var d = (res.data && res.data.data) || {};
              if (d.expedition && battle) battle.expedition = d.expedition;
              sysToast('祝福到手：' + (b.icon || '') + ' ' + (b.name || ''), 'success');
              openSheet(sec, 'fight', 'exp');
            }, function(err) {
              card.disabled = false;
              var msg = (err && err.response && err.response.data && err.response.data.message) || '没能拿走这个祝福';
              sysToast(msg, 'error');
            });
          });
          pickRow.appendChild(card);
        })(ex.pending[pi]);
      }
      box.appendChild(pickRow);
      return box;
    }

    if (ex.active) {
      // 进行中：深度点 + 已持祝福 + 继续按钮
      var pips = h('div', 'ci-pet-exp-pips');
      for (var d2 = 1; d2 <= (ex.maxDepth || 5); d2++) {
        pips.appendChild(h('span', 'ci-pet-exp-pip' +
          (d2 <= ex.depth ? ' is-done' : '') + (d2 === ex.depth + 1 ? ' is-next' : ''),
          String(d2)));
      }
      box.appendChild(pips);
      if (ex.boons && ex.boons.length) {
        var chipRow = h('div', 'ci-pet-exp-owned');
        for (var ci = 0; ci < ex.boons.length; ci++) {
          chipRow.appendChild(h('span', 'ci-pet-exp-chip',
            (ex.boons[ci].icon || '') + ' ' + (ex.boons[ci].name || '')));
        }
        box.appendChild(chipRow);
      }
      var next = h('button', 'ci-pet-foe-btn is-abyss',
        ex.depth === 0 ? '出发 · 第 1 层' : '继续下探 · 第 ' + (ex.depth + 1) + ' 层');
      next.addEventListener('click', function() { playExpeditionFight(sec, next); });
      box.appendChild(next);
      // 重开一趟（放弃不单独结算保底分——重开即覆盖，下一趟结算按新深度算）
      var re = h('button', 'ci-pet-exp-abandon', '重新出发（放弃这次进度）');
      re.addEventListener('click', function() {
        re.disabled = true;
        api.post('/pet/expedition/start').then(function(res2) {
          var dd = (res2.data && res2.data.data) || {};
          if (dd.expedition && battle) battle.expedition = dd.expedition;
          openSheet(sec, 'fight', 'exp');
        }, function() { re.disabled = false; });
      });
      box.appendChild(re);
      return box;
    }

    // 待出发
    var go = h('button', 'ci-pet-foe-btn is-abyss', '出发');
    go.addEventListener('click', function() {
      go.disabled = true;
      api.post('/pet/expedition/start').then(function(res) {
        var d = (res.data && res.data.data) || {};
        if (d.expedition && battle) battle.expedition = d.expedition;
        openSheet(sec, 'fight', 'exp');
      }, function(err) {
        go.disabled = false;
        var msg = (err && err.response && err.response.data && err.response.data.message) || '出发失败';
        sysToast(msg, 'error');
      });
    });
    box.appendChild(go);
    if (ex.runsToday) {
      box.appendChild(h('div', 'ci-pet-abyss-tip', '今天已出发 ' + ex.runsToday + ' 次'));
    }
    return box;
  }

  // 塔的战斗回放：复用同一个播放器，只是结尾多一句「通关第 N 层」
  function playTowerFight(sec, d) {
    playFight(sec, d, {
      tower: true,
      floor: d.floor,
      abyss: d.abyss || null,
      total: d.towerTotal,
      cleared: d.cleared,
      endpoint: '/pet/tower/fight',
      extra: {}
    });
  }

  // 称号：全部由存档推导，只显示已获得的
  function titleBox() {
    var list = battle.titles || [];
    if (!list.length) return h('div', '');
    var box = h('div', 'ci-pet-titles');
    var headRow = h('div', 'ci-pet-titles-head');
    headRow.appendChild(h('span', 'ci-pet-titles-title', '称号'));
    box.appendChild(headRow);
    var row = h('div', 'ci-pet-titles-row');
    for (var i = 0; i < list.length; i++) {
      row.appendChild(h('span', 'ci-pet-title-chip',
        (list[i].icon || '') + ' ' + list[i].name));
    }
    box.appendChild(row);
    return box;
  }


  // 操作行（无框）：天气徽章 + 属性盘 + 出战风格。
  // 三个「小设置」原本各占一张卡——报表感的主要来源。这里全部去框，
  // 直接长在星空上，像游戏的准备界面而不是设置页。
  function battleOpsRow(sec) {
    var box = h('div', 'ci-pet-ops');

    // 天气徽章：今天谁上场有加成
    var w = battle.weather;
    if (w) {
      var wb = h('span', 'ci-pet-ops-weather');
      wb.appendChild(h('span', 'ci-pet-ops-wicon', w.icon || ''));
      var wt = h('span', 'ci-pet-ops-wtxt');
      wt.appendChild(h('b', null, w.name || ''));
      wt.appendChild(h('span', null, ' ' + (w.bonusText || '')));
      wb.appendChild(wt);
      wb.setAttribute('title', (w.desc || '') + (w.typeName ? ' · 本命 ' + w.typeName + ' 吃加成' : ''));
      box.appendChild(wb);
    }

    // 属性盘：圆形属性按钮（数据与交互同图鉴页的 typePicker，只是换成圆盘）
    var list = (battle.elements && battle.elements.length) ? battle.elements : elements;
    if (!list.length) {
      list = [];
      for (var f = 0; f < ELEMENT_ORDER.length; f++) list.push(ELEMENT_FALLBACK[ELEMENT_ORDER[f]]);
    }
    var cur = battle.battleType || 'grass';
    var curInfo = battle.typeInfo || elementOf(cur);
    var discs = h('div', 'ci-pet-ops-types');
    for (var i = 0; i < list.length; i++) {
      (function(t) {
        var on = t.id === cur;
        var disc = h('button', 'ci-pet-ops-type is-t-' + t.id + (on ? ' is-on' : ''));
        disc.setAttribute('data-type', t.id);
        disc.appendChild(h('span', 'ci-pet-ops-typeicon', t.icon || ''));
        disc.appendChild(h('span', 'ci-pet-ops-typename', t.name));
        disc.setAttribute('title', t.name + '本命 · 随时可改');
        disc.addEventListener('click', function() {
          if (battle.battleType === t.id) return;
          doBattleType(t.id, function() { fillBattle(sec); });
        });
        discs.appendChild(disc);
      })(list[i]);
    }
    box.appendChild(discs);

    // 克制注 + 出战风格 seg
    var beatsEl = elementOf(curInfo.beats);
    var weakEl = elementOf(curInfo.weakTo);
    var row2 = h('div', 'ci-pet-ops-row2');
    var note = h('span', 'ci-pet-ops-note');
    note.appendChild(elementChip(cur));
    note.appendChild(h('span', null, ' 克 ' + beatsEl.icon + beatsEl.name + ' · 弱 ' + weakEl.icon + weakEl.name));
    row2.appendChild(note);

    var seg = h('div', 'ci-pet-ops-seg');
    var tlist = battle.tactics || [];
    var curTac = battle.tactic || 'guard';
    for (var k = 0; k < tlist.length; k++) {
      (function(t) {
        var on = t.id === curTac;
        var chip = h('button', 'ci-pet-ops-tactic' + (on ? ' is-on' : ''));
        chip.appendChild(h('span', 'ci-pet-ops-tacticicon', t.icon || ''));
        chip.appendChild(h('span', null, t.name));
        chip.setAttribute('title', t.desc || '');
        chip.addEventListener('click', function() {
          if (battle.tactic === t.id) return;
          battle.tactic = t.id;
          var kids = seg.childNodes;
          for (var m = 0; m < kids.length; m++) {
            if (kids[m].className && kids[m].className.indexOf('ci-pet-ops-tactic') === 0) {
              kids[m].className = 'ci-pet-ops-tactic';
            }
          }
          chip.className = 'ci-pet-ops-tactic is-on';
          sysToast('出战风格：' + t.name + '——' + t.desc, 'info');
        });
        seg.appendChild(chip);
      })(tlist[k]);
    }
    row2.appendChild(seg);
    box.appendChild(row2);
    return box;
  }

  // 关卡面板：一个面板装全部对手行，行间用分隔线——
  // 「每张对手卡独立一个框」是报表感的另一半来源。
  function foesSheet(sec, list, out) {
    var box = h('div', 'ci-pet-foesheet');
    for (var i = 0; i < list.length; i++) box.appendChild(foeCard(sec, list[i], out));
    return box;
  }

  // 折叠区：战报 / 成就与称号 / 积分榜。都是「想起来才查一眼」的东西，
  // 默认收起，页面下半段不再铺四张报表卡。
  function metaFold() {
    var wrap = h('div', 'ci-pet-metafold');
    var hist = battle.history || [];
    if (hist.length) {
      var d1 = document.createElement('details');
      d1.className = 'ci-pet-metafold-g';
      var s1 = document.createElement('summary');
      s1.textContent = '📜 最近战报（' + hist.length + ' 条）';
      d1.appendChild(s1);
      d1.appendChild(historyBox());
      wrap.appendChild(d1);
    }
    var all = battle.achievementList || [];
    if (all.length) {
      var d2 = document.createElement('details');
      d2.className = 'ci-pet-metafold-g';
      var s2 = document.createElement('summary');
      s2.textContent = '🏅 成就 ' + (battle.achievements || []).length + ' / ' + all.length + ' · 称号';
      d2.appendChild(s2);
      d2.appendChild(achBox());
      d2.appendChild(titleBox());
      wrap.appendChild(d2);
    }
    if ((battle.rank || []).length) {
      var d3 = document.createElement('details');
      d3.className = 'ci-pet-metafold-g';
      var s3 = document.createElement('summary');
      s3.textContent = '🏆 积分榜' + (battle.myRank ? '（我第 ' + battle.myRank + ' 名）' : '');
      d3.appendChild(s3);
      d3.appendChild(rankBox());
      wrap.appendChild(d3);
    }
    return wrap;
  }

  // 成就：只显示已解锁的（空格子是压力，不是目标）
  function achBox() {
    var got = battle.achievements || [];
    var all = battle.achievementList || [];
    if (!all.length) return h('div', '');
    var box = h('div', 'ci-pet-ach');

    var headRow = h('div', 'ci-pet-ach-head');
    headRow.appendChild(h('span', 'ci-pet-ach-title', '成就 ' + got.length + ' / ' + all.length));
    box.appendChild(headRow);

    var row = h('div', 'ci-pet-ach-row');
    for (var i = 0; i < all.length; i++) {
      var a = all[i];
      var owned = got.indexOf(a.id) >= 0;
      var chip = h('span', 'ci-pet-ach-chip' + (owned ? ' is-on' : ''), (a.icon || '') + ' ' + a.name);
      chip.title = a.desc || '';
      row.appendChild(chip);
    }
    box.appendChild(row);
    return box;
  }

  // 排行榜：只排战力积分。羁绊不排——那是私事。
  function rankBox() {
    var rows = battle.rank || [];
    if (!rows.length) return h('div', '');
    var box = h('div', 'ci-pet-rank');
    var headRow = h('div', 'ci-pet-rank-head');
    headRow.appendChild(h('span', 'ci-pet-rank-title', '积分榜'));
    if (battle.myRank) headRow.appendChild(h('span', 'ci-pet-rank-mine', '我第 ' + battle.myRank + ' 名'));
    box.appendChild(headRow);

    var list = h('div', 'ci-pet-rank-list');
    for (var i = 0; i < rows.length && i < 5; i++) {
      var r = rows[i];
      var line = h('div', 'ci-pet-rank-item' + (battle.myRank === r.rank ? ' is-me' : ''));
      line.appendChild(h('span', 'ci-pet-rank-no', String(r.rank)));
      line.appendChild(h('span', 'ci-pet-rank-name', r.name));
      if (r.owner) line.appendChild(h('span', 'ci-pet-rank-owner', r.owner));
      line.appendChild(h('span', 'ci-pet-rank-pts', r.points + ' 分'));
      list.appendChild(line);
    }
    box.appendChild(list);
    return box;
  }

  // 挑战留言：被打之后这里会亮。看完即焚（调 inbox/read 清掉），不占长期版面。
  function inboxBox(sec) {
    var msgs = battle.inbox || [];
    if (!msgs.length) return h('div', '');
    var box = h('div', 'ci-pet-inbox');
    var headRow = h('div', 'ci-pet-inbox-head');
    var inTitle = h('span', 'ci-pet-inbox-title');
    setIconText(inTitle, 'fight', ' ' + msgs.length + ' 条挑战留言');
    headRow.appendChild(inTitle);
    headRow.appendChild(h('span', 'ci-pet-inbox-hint', '看过了就不再提示'));
    box.appendChild(headRow);
    for (var i = 0; i < msgs.length && i < 3; i++) {
      var m = msgs[i];
      var who = m.whoOwner ? (m.whoOwner + ' 的 ' + m.who) : (m.who || '有人');
      var line = h('div', 'ci-pet-inbox-item');
      line.appendChild(h('span', 'ci-pet-inbox-who', who));
      line.appendChild(h('span', 'ci-pet-inbox-what', m.held ? '没打过你，你守住了' : '把你打败了'));
      line.appendChild(h('span', 'ci-pet-inbox-rounds', m.rounds + ' 回合'));
      // 被打了总想还手，所以留言直接给一个入口——但要占当天场次，
      // 因此打满时按钮是灰的，不给「点了没反应」的错觉。
      if (m.uid) {
        var hit = h('button', 'ci-pet-inbox-hit', '找他算账');
        hit.addEventListener('click', function(uid) {
          return function() { doFight(sec, 'p:' + uid, this); };
        }(m.uid));
        line.appendChild(hit);
      }
      box.appendChild(line);
    }
    var clear = h('button', 'ci-pet-inbox-clear', '知道了');
    clear.addEventListener('click', function() {
      battle.inbox = [];
      if (api) api.post('/pet/battle/inbox/read', {}).then(function() {}, function() {});
      fillBattle(sec);
    });
    box.appendChild(clear);
    return box;
  }

  // kind='shadow' 时 foe.owner 是对方同学的昵称，要显示出来——
  // 「打同学」的乐趣一半来自知道那是谁，匿名列表就只剩数值了。
  // 对手卡（关卡卡）：属性大圆盘 + 战力对比条 + 挑战按钮。
  // 「我 450 vs 他 402」的长短条一眼读出强弱——比「战力 402」四个字有画面得多。
  function foeCard(sec, foe, out) {
    var card = h('div', 'ci-pet-foe' + (foe.kind === 'shadow' ? ' ci-pet-foe--shadow' : ''));
    var myPow = (battle && battle.combat && battle.combat.power) || 0;

    // 属性圆盘：属性色渐变底 + 大图标，就是这只/这层关卡的「立绘位」
    var disc = h('div', 'ci-pet-foe-disc' + (foe.type ? ' is-t-' + foe.type : ''));
    disc.appendChild(h('span', 'ci-pet-foe-discicon',
      (foe.typeIcon || '') || (foe.kind === 'shadow' ? '👤' : '❓')));
    card.appendChild(disc);

    var mid = h('div', 'ci-pet-foe-mid');
    var who = h('div', 'ci-pet-foe-who');
    who.appendChild(h('span', 'ci-pet-foe-name', foe.name || '?'));
    if (foe.owner) who.appendChild(h('span', 'ci-pet-foe-owner', foe.owner));
    if (foe.typeMul && foe.typeMul !== 1) {
      who.appendChild(h('span', 'ci-pet-typetag ' + (foe.typeMul > 1 ? 'is-adv' : 'is-dis'),
        foe.typeMul > 1 ? '克制它' : '被它克'));
    }
    if (foe.oddsText) {
      who.appendChild(h('span', 'ci-pet-odds ci-pet-odds--' + (foe.odds || 'even'), foe.oddsText));
    }
    mid.appendChild(who);

    // 战力对比条：左金右灰，比例 = 我方战力 / 双方合计
    var sum = Math.max(1, myPow + (foe.power || 0));
    var myPct = Math.round(myPow / sum * 100);
    var duel = h('div', 'ci-pet-foe-duel');
    var mine = h('span', 'ci-pet-foe-duel-mine');
    mine.style.width = myPct + '%';
    duel.appendChild(mine);
    mid.appendChild(duel);
    var duelTxt = h('div', 'ci-pet-foe-dueltxt');
    duelTxt.appendChild(h('span', 'ci-pet-foe-duelnum is-mine', '我 ' + myPow));
    duelTxt.appendChild(h('span', 'ci-pet-foe-duelmeta',
      '羁绊 ' + (foe.bond || 0) + (foe.desc ? ' · ' + foe.desc : '')));
    duelTxt.appendChild(h('span', 'ci-pet-foe-duelnum is-foe', String(foe.power || 0)));
    mid.appendChild(duelTxt);
    card.appendChild(mid);

    var btn = h('button', 'ci-pet-foe-btn', out ? '今日已打满' : '挑战');
    if (out) btn.disabled = true;
    btn.addEventListener('click', function() { doFight(sec, foe.id, btn); });
    card.appendChild(btn);
    return card;
  }

  function doFight(sec, oppId, btn) {
    if (!api) return;
    btn.disabled = true;
    var btnText = btn.textContent;
    btn.textContent = '出战中…';
    // 带上当前选的战术：服务端会用它改写属性，并记住作为下次的默认
    var body = { oppId: oppId, mode: 'open' };
    if (battle && battle.tactic) body.tactic = battle.tactic;
    api.post('/pet/battle/fight', body).then(function(res) {
      var d = (res.data && res.data.data) || {};
      if (!d.steps) { btn.disabled = false; btn.textContent = btnText; return; }
      absorbProgress(d);
      battle = null;                      // 战绩与今日次数都变了，回列表时重新取
      playFight(sec, d, { endpoint: '/pet/battle/fight', extra: { oppId: oppId } });
    }, function(err) {
      var msg = (err && err.response && err.response.data && err.response.data.message) || '挑战失败';
      sysToast(msg, 'error');
      btn.disabled = false;
      btn.textContent = btnText;
      // 429 = 今天打满 / 被拒：重新拉一次档案，让所有按钮一起变成「今日已打满」
      loadBattle(function() { fillBattle(sec); });
    });
  }

  // 血条：显示剩余 / 上限，宽度按比例
  function arenaSide(c, kind) {
    var el = h('div', 'ci-pet-arena-side ci-pet-arena-side--' + kind);
    el.appendChild(h('div', 'ci-pet-arena-name', c.name || '?'));
    var badgeRow = h('div', 'ci-pet-arena-badges');
    if (c.type) badgeRow.appendChild(elementChip(c.type));
    badgeRow.appendChild(h('div', 'ci-pet-arena-power', '战力 ' + (c.power || 0)));
    // 我方侧的「士气 + 助战」：把照顾与收集的回报画在血条旁边——
    // 玩家一眼能看见「今天照顾得好」和「场边站着谁」在这场战斗里是真实存在的。
    if (kind === 'me') {
      if (c.mood && c.mood.tone === 'high') {
        var moodEl = h('span', 'ci-pet-arena-mood', c.mood.icon + ' 士气高涨');
        moodEl.setAttribute('title', '心情好：攻击 +8%');
        badgeRow.appendChild(moodEl);
      }
      if (c.assist) {
        var asEl = h('span', 'ci-pet-arena-assist', c.assist.icon + ' ' + (c.assist.name || ''));
        asEl.setAttribute('title', '助战：' + (c.assist.bonusText || ''));
        badgeRow.appendChild(asEl);
      }
    }
    el.appendChild(badgeRow);
    var bar = h('div', 'ci-pet-hpbar');
    var fill = h('span', 'ci-pet-hpfill');
    bar.appendChild(fill);
    el.appendChild(bar);
    var txt = h('div', 'ci-pet-hptext', '');
    el.appendChild(txt);
    var max = Math.max(1, c.hp || 1);
    return {
      el: el,
      set: function(hp) {
        var v = Math.max(0, hp || 0);
        var pct = v / max;
        fill.style.width = Math.round(pct * 100) + '%';
        // v0.30.0：血量分档换色——绿（健康）→ 琥珀（过半告警）→ 红（残血求救）
        fill.classList.toggle('is-mid', pct < 0.62 && pct >= 0.3);
        fill.classList.toggle('is-low', pct < 0.3);
        txt.textContent = v + ' / ' + max;
      }
    };
  }

  function playFight(sec, d, opts) {
    opts = opts || {};
    stopFight();
    clearEl(sec);
    var token = ++fightToken;
    var arena = h('div', 'ci-pet-arena is-stage');

    // ==================== v0.28.0 战斗上舞台 ====================
    // 之前练习赛/影子/塔/收服的对战是一块「血条卡 + 文字 log」的裸面板
    // （v0.4.0 遗留布局），全屏舞台只有 Boss 独享 —— 用户问
    // 「为什么打练习赛根本不显示舞台」。现在与 buildArena 用同一套场景层：
    // 天光/星/远山/地面 + 我方立绘 + 对手盘，HP 牌浮到场景对角。
    var scene = h('div', 'ci-pet-arena-scene');
    scene.appendChild(h('div', 'ci-pet-scene-sky'));
    scene.appendChild(h('div', 'ci-pet-scene-stars'));
    scene.appendChild(h('div', 'ci-pet-scene-hills'));
    scene.appendChild(h('div', 'ci-pet-scene-ground'));
    // v0.30.0 舞台装修：天体/流云/萤火虫/旗杆/草丛小花石子（见 decorateStage）
    decorateStage(scene);

    // 对手盘：塔战用塔像素图标，其余用对手的属性像素图标
    // （后端 foe.typeIcon 是 emoji 家族，这里统一走 PIX_ICONS 保持像素语言）
    var foeInfo = d.foe || {};
    var foeBox = h('div', 'ci-pet-arena-foe');
    var disc = h('div', 'ci-pet-bstage-foedisc');
    var foeIconKind = opts.tower ? 'tower' : foeInfo.type;
    var foeIco = pixIcon(PIX_ICONS[foeIconKind] ? foeIconKind : 'fight', 'ci-pet-bstage-foeicon-pix');
    if (foeIco) disc.appendChild(foeIco);
    if (foeInfo.type) disc.appendChild(elementChip(foeInfo.type));
    foeBox.appendChild(disc);
    scene.appendChild(foeBox);

    scene.appendChild(h('div', 'ci-pet-bstage-vs', 'VS'));

    // 我方立绘：视频宠放视频，像素宠画 canvas（与 buildArena 同源）
    var meBox = h('div', 'ci-pet-arena-me');
    if (state && state.design && state.design.type === 'video') {
      var fv = document.createElement('video');
      fv.className = 'ci-pet-arena-video';
      fv.muted = true; fv.loop = true; fv.autoplay = true;
      fv.setAttribute('playsinline', 'playsinline');
      fv.setAttribute('webkit-playsinline', 'webkit-playsinline');
      fv.src = poolUrl(heroIdleName());
      loadHeroPool();
      meBox.appendChild(fv);
    } else if (state && state.design) {
      var fpv = document.createElement('canvas');
      paint(fpv, state.design, 10);
      meBox.appendChild(fpv);
    }
    scene.appendChild(meBox);

    arena.appendChild(scene);

    // HP 牌（动态血条 + 受击抖动 + 伤害浮字都挂在这两块上），
    // 绝对定位到场景对角（is-stage 的 CSS 在 §28）——不再是网页卡片。
    var meSide = arenaSide(d.me || {}, 'me');
    var foeSide = arenaSide(d.foe || {}, 'foe');
    meSide.set((d.me || {}).hp);
    foeSide.set((d.foe || {}).hp);
    scene.appendChild(foeSide.el);
    scene.appendChild(meSide.el);

    var logEl = h('div', 'ci-pet-arena-log', '第 1 回合即将开始…');
    arena.appendChild(logEl);

    // ==================== 默契指令（v0.25.0）====================
    // 这一条是「把录像变成一局」的全部：播放中随时可以按一张牌，
    // 服务端用同一个 seed 重算，前端快进到打断点接着放。
    // ⚠️ 没有 fightId 就不画（老响应 / 探针桩）：这时它仍然是一段纯回放，不会报错。
    var live = {
      fightId: d.fightId || '',
      endpoint: opts.endpoint || '',
      extra: opts.extra || {},
      cmds: (d.cmds || []).slice(),
      slots: (d.cmdSlots === undefined ? 0 : d.cmdSlots),
      commands: d.commands || [],
      manualSkills: d.manualSkills || [],
      busy: false
    };
    // 默契牌种类（与服务端 COMMAND_IDS 对齐）——refreshCmd/fireCommand 靠它分流两种牌
    var COMMAND_IDS = ['strike', 'guard', 'charge'];
    // 技能牌的冷却参数（与服务端 ACTIVE_SKILLS.cooldown 对齐）与战报 tag 映射。
    // 冷却靠扫 steps 推断：上次释放回合 + 冷却数 + 1 = 再次可用回合。
    var SKILL_CD = { blast: 2, smash: 3, heal: 4 };
    var SKILL_TAG = { blast: 'blast', smash: 'smash', heal: 'healskill' };
    function skillCdLeft(kind) {
      var cd = SKILL_CD[kind] || 2;
      var tag = SKILL_TAG[kind] || kind;
      var last = -99;
      for (var i = 0; i < cur.steps.length; i++) {
        var st = cur.steps[i];
        if (st.by === 0 && (st.tags || []).indexOf(tag) >= 0 && st.r > last) last = st.r;
      }
      var now = cur.steps[idx] ? cur.steps[idx].r : (cur.steps.length ? cur.steps[cur.steps.length - 1].r : 1);
      return (last + cd + 1) - now;
    }
    var cardEls = {};
    var countEl = null;
    var cmdRow = null;
    var cardRowCache = { tac: null, sk: null };
    function usedKinds() {
      var m = {};
      for (var i = 0; i < live.cmds.length; i++) m[live.cmds[i].kind] = 1;
      return m;
    }
    function refreshCmd() {
      if (!cmdRow) return;
      var used = usedKinds();
      var left = live.slots - live.cmds.length;
      if (countEl) countEl.textContent = left > 0 ? ('×' + left) : '用完了';
      if (countEl) countEl.className = 'ci-pet-cmdrow-count' + (left > 0 ? '' : ' is-out');
      for (var k in cardEls) {
        if (!Object.prototype.hasOwnProperty.call(cardEls, k)) continue;
        var el = cardEls[k];
        var cls = 'ci-pet-cmd';
        if (COMMAND_IDS.indexOf(k) >= 0) {
          // 默契牌：用过即灰
          cls += (used[k] ? ' is-used' : '') + (left <= 0 ? ' is-out' : '');
        } else {
          // 技能牌：is-skill 蓝牌底色必须保留（v0.28.3 修复：之前每 tick 重写
          // className 把它洗掉，牌面退化成默认木色、冷却角标样式失效）
          cls += ' is-skill';
          var cd = skillCdLeft(k);
          if (cd > 0) {
            cls += ' is-cd';
            el.setAttribute('data-cdleft', String(cd));
          } else {
            el.removeAttribute('data-cdleft');
          }
        }
        el.className = cls;
      }
      if (cardRowCache.tac) cardRowCache.tac.className = 'ci-pet-cmdrow';
      if (cardRowCache.sk) cardRowCache.sk.className = 'ci-pet-cmdrow is-skills';
    }
    if (live.fightId && live.commands.length) {
      // ---- 默契牌行 ----
      var tacRow = h('div', 'ci-pet-cmdrow');
      cmdRow = tacRow;
      var crowHead = h('div', 'ci-pet-cmdrow-head');
      crowHead.appendChild(h('span', 'ci-pet-cmdrow-label', '默契'));
      countEl = h('span', 'ci-pet-cmdrow-count', '×' + live.slots);
      crowHead.appendChild(countEl);
      crowHead.appendChild(h('span', 'ci-pet-cmdrow-hint', '点一张，它就会照着做'));
      cmdRow.appendChild(crowHead);
      var crowCards = h('div', 'ci-pet-cmdrow-cards');
      for (var ci = 0; ci < live.commands.length; ci++) {
        (function(cmd) {
          var card = h('button', 'ci-pet-cmd');
          card.setAttribute('data-cmd', cmd.id);
          card.appendChild(h('span', 'ci-pet-cmd-icon', cmd.icon));
          var txt = h('span', 'ci-pet-cmd-txt');
          txt.appendChild(h('span', 'ci-pet-cmd-name', cmd.name));
          txt.appendChild(h('span', 'ci-pet-cmd-desc', cmd.desc));
          card.appendChild(txt);
          card.setAttribute('title', cmd.desc);
          card.addEventListener('click', function() { fireCommand(cmd.id); });
          cardEls[cmd.id] = card;
          crowCards.appendChild(card);
        })(live.commands[ci]);
      }
      tacRow.appendChild(crowCards);
      cardRowCache.tac = tacRow;
      arena.appendChild(tacRow);

      // ---- 技能牌行（v0.28.2）：装备的主动技由玩家出手，不再由 AI 代放 ----
      if (live.manualSkills.length) {
        var skRow = h('div', 'ci-pet-cmdrow is-skills');
        var skHead = h('div', 'ci-pet-cmdrow-head');
        skHead.appendChild(h('span', 'ci-pet-cmdrow-label', '技能'));
        skHead.appendChild(h('span', 'ci-pet-cmdrow-hint', '由你出手 · 什么时候放大招你说了算'));
        skRow.appendChild(skHead);
        var skCards = h('div', 'ci-pet-cmdrow-cards');
        for (var si = 0; si < live.manualSkills.length; si++) {
          (function(sk) {
            var card = h('button', 'ci-pet-cmd is-skill');
            card.setAttribute('data-cmd', sk.id);
            card.appendChild(h('span', 'ci-pet-cmd-icon', sk.icon));
            var txt = h('span', 'ci-pet-cmd-txt');
            txt.appendChild(h('span', 'ci-pet-cmd-name', sk.name));
            txt.appendChild(h('span', 'ci-pet-cmd-desc', sk.desc));
            card.appendChild(txt);
            card.appendChild(h('span', 'ci-pet-cmd-cd', ''));
            card.setAttribute('title', sk.desc + '（冷却 ' + sk.cooldown + ' 回合）');
            card.addEventListener('click', function() { fireCommand(sk.id); });
            cardEls[sk.id] = card;
            skCards.appendChild(card);
          })(live.manualSkills[si]);
        }
        skRow.appendChild(skCards);
        cardRowCache.sk = skRow;
        arena.appendChild(skRow);
      }
    }

    var skip = h('button', 'ci-pet-arena-skip', '跳过动画');
    arena.appendChild(skip);
    sec.appendChild(arena);

    var cur = d;                    // 当前这一版战报（reroll 会整份换掉）
    var idx = 0;
    var lines = [];
    var myName = (d.me && d.me.name) || '你';
    var settled = false;
    var finished = false;

    // v2.0 新 tag 的战报文案表：各种回血的来源不同，说人话而不是统一「吸回」
    var HEAL_WORDS = {
      lifesteal: '吸回', bluntheal: '剑刃回血', healskill: '紧急治疗恢复',
      regen: '活力恢复', vial: '恢复药剂回复'
    };
    function applyStep(s) {
      meSide.set(s.hpMe);
      foeSide.set(s.hpFoe);
      var tags = s.tags || [];
      var actor = s.by === 0 ? myName : ((d.foe && d.foe.name) || '对手');
      var target = s.by === 0 ? ((d.foe && d.foe.name) || '对手') : myName;
      // 谁在承受这次效果：普通攻击/反击落在 by 的对面；灼烧与重锤自损落在 by 自己；
      // 回复也落在 by 自己（旧版治疗浮字飘在对手头顶，顺手修掉）。
      var onSelf = !!s.heal || !!s.self || tags.indexOf('dot') >= 0;
      var hurtSide = onSelf ? (s.by === 0 ? meSide : foeSide) : (s.by === 0 ? foeSide : meSide);
      var isCrit = !!s.crit || (tags.indexOf('heavy') >= 0);
      try {
        if ((s.dmg || 0) > 0 || s.heal) {
          hurtSide.el.classList.remove('ci-pet-arena-side--hit', 'ci-pet-arena-side--crit');
          void hurtSide.el.offsetWidth;
          hurtSide.el.classList.add('ci-pet-arena-side--hit');
          if (isCrit) hurtSide.el.classList.add('ci-pet-arena-side--crit');
          setTimeout(function() {
            if (hurtSide.el) {
              hurtSide.el.classList.remove('ci-pet-arena-side--hit', 'ci-pet-arena-side--crit');
            }
          }, 320);
          // 浮动数字：伤害在承受方头顶，治疗在回复方头顶
          if (!s.heal && (s.dmg || 0) > 0) {
            var floatEl = document.createElement('span');
            floatEl.className = 'ci-pet-dmgfloat' + (isCrit ? ' is-crit' : '');
            floatEl.textContent = (isCrit ? '!' : '') + (s.dmg || 0);
            hurtSide.el.appendChild(floatEl);
            setTimeout(function() { if (floatEl.parentNode) floatEl.parentNode.removeChild(floatEl); }, 900);
          } else if (s.heal) {
            var healEl = document.createElement('span');
            healEl.className = 'ci-pet-dmgfloat is-heal';
            healEl.textContent = '+' + s.heal;
            hurtSide.el.appendChild(healEl);
            setTimeout(function() { if (healEl.parentNode) healEl.parentNode.removeChild(healEl); }, 900);
          }
        }
        // ==================== v0.30.0 舞台演出 ====================
        // 血牌抖动只动了「牌」，立绘本身像没事人一样 —— 现在把招式画在角色身上：
        // 出手方扑击 + 血牌亮「正在行动」，承受方立绘闪白抖动 + 脚下扬尘，
        // 暴击叠一颗爆星，回复变成绿色疗愈粒子往上升。
        var actorBox = s.by === 0 ? meBox : foeBox;
        var hitBox2 = onSelf ? actorBox : (s.by === 0 ? foeBox : meBox);
        if (!s.heal && !s.skip && (s.dmg || 0) > 0) {
          // 扑击（me 向右扑 / foe 向左扑，方向写在 CSS keyframes 里）
          actorBox.classList.remove('is-act');
          void actorBox.offsetWidth;
          actorBox.classList.add('is-act');
          setTimeout(function() { if (actorBox) actorBox.classList.remove('is-act'); }, 500);
          // 出手方血牌短暂点亮（turn 灯）
          var actSide = s.by === 0 ? meSide : foeSide;
          if (actSide && actSide.el) {
            actSide.el.classList.add('is-turn');
            setTimeout(function() { if (actSide.el) actSide.el.classList.remove('is-turn'); }, 540);
          }
          // 承受方立绘受击
          hitBox2.classList.remove('is-hurt');
          void hitBox2.offsetWidth;
          hitBox2.classList.add('is-hurt');
          setTimeout(function() { if (hitBox2) hitBox2.classList.remove('is-hurt'); }, 520);
          spawnStageFx(hitBox2, isCrit ? 'burst' : 'dust');
        } else if (s.heal) {
          hitBox2.classList.remove('is-glow');
          void hitBox2.offsetWidth;
          hitBox2.classList.add('is-glow');
          setTimeout(function() { if (hitBox2) hitBox2.classList.remove('is-glow'); }, 700);
          spawnStageFx(hitBox2, 'heal');
        }
      } catch (e) {}
      if (s.skip) {
        lines.push('第 ' + s.r + ' 回合 · ' + actor +
          (tags.indexOf('paralyze') >= 0 ? ' 被麻痹了，动弹不得' : ' 在蓄力，这回合动不了'));
      } else if (s.buff) {
        lines.push('第 ' + s.r + ' 回合 · ' + actor +
          (s.buff === 'berserk' ? ' 狂怒了（攻 ↑ 防 ↓）' : ' 摆出钢铁壁垒（防 ↑）'));
      } else if (s.heal) {
        var word = '吸回';
        for (var hk in HEAL_WORDS) {
          if (Object.prototype.hasOwnProperty.call(HEAL_WORDS, hk) && tags.indexOf(hk) >= 0) word = HEAL_WORDS[hk];
        }
        lines.push('第 ' + s.r + ' 回合 · ' + actor + ' ' + word + ' ' + s.heal + ' 点');
      } else if (tags.indexOf('dot') >= 0) {
        lines.push('第 ' + s.r + ' 回合 · ' + actor + ' 被灼烧掉 ' + (s.dmg || 0) + ' 点');
      } else if (tags.indexOf('evade') >= 0) {
        // 闪避句的主语是挨打的一方（后端 step 的 by 是出手方）
        lines.push('第 ' + s.r + ' 回合 · ' + target + ' 闪避了这一击');
      } else if (s.self) {
        lines.push('第 ' + s.r + ' 回合 · ' + actor + ' 被重锤反噬掉 ' + (s.dmg || 0) + ' 点');
      } else {
        // 动作词按「最特别优先」：主动技 > 反击 > 千钧 > 追击 > 护盾 > 暴击
        var mark = '';
        if (tags.indexOf('blast') >= 0) mark = ' 爆发冲击 ';
        else if (tags.indexOf('smash') >= 0) mark = ' 重锤砸击 ';
        else if (tags.indexOf('counter') >= 0) mark = ' 反击 ';
        else if (tags.indexOf('heavy') >= 0) mark = ' 千钧一击 ';
        else if (tags.indexOf('combo') >= 0) mark = ' 追击 ';
        else if (tags.indexOf('shield') >= 0) mark = '（护盾挡下）';
        else if (s.crit) mark = ' 暴击 ';
        else mark = ' 打出 ';
        // 属性相克单独缀在句尾：它解释的是「为什么这一下特别疼 / 特别软」，
        // 不该顶掉暴击、千钧这些动作词。
        var eff = '';
        if (tags.indexOf('weak') >= 0) eff = '（效果拔群）';
        else if (tags.indexOf('fireup') >= 0) eff = '（烈焰加成）';
        else if (tags.indexOf('flame') >= 0) eff = '（火焰药水）';
        else if (tags.indexOf('resist') >= 0) eff = '（效果一般）';
        lines.push('第 ' + s.r + ' 回合 · ' + actor + mark + (s.dmg || 0) + ' 点' + eff);
      }
      if (lines.length > 4) lines.shift();
      logEl.textContent = lines.join('\n');
    }

    // 这一击该挂在哪一回合：本回合我方已经出过手，就只能挂下一回合。
    // 不是「随便挂一个」——引擎在回合开始就把指令预置好了，挂在已经过去的回合等于白按。
    function pickRound() {
      var s = cur.steps[idx];
      if (!s) return cur.steps.length ? cur.steps[cur.steps.length - 1].r : 1;
      var r = s.r;
      if (idx > 0 && cur.steps[idx - 1].r === r && cur.steps[idx - 1].by === 0) return r + 1;
      return r;
    }
    function bodyOf(extra) {
      var b = {};
      var k;
      for (k in live.extra) {
        if (Object.prototype.hasOwnProperty.call(live.extra, k)) b[k] = live.extra[k];
      }
      for (k in extra) {
        if (Object.prototype.hasOwnProperty.call(extra, k)) b[k] = extra[k];
      }
      return b;
    }
    function cmdOf(kind) {
      for (var i = 0; i < live.commands.length; i++) {
        if (live.commands[i].id === kind) return live.commands[i];
      }
      return null;
    }
    // 指令特写：一行大字 + 舞台轻震，0.9s 自己消失（不占布局，不用清）
    function commandFx(kind) {
      var cmd = cmdOf(kind);
      if (!cmd) return;
      var fx = h('div', 'ci-pet-cmdfx is-' + kind);
      fx.appendChild(h('span', 'ci-pet-cmdfx-icon', cmd.icon || ''));
      fx.appendChild(h('span', 'ci-pet-cmdfx-word', cmd.word || cmd.name));
      arena.appendChild(fx);
      arena.classList.remove('is-shake');
      void arena.offsetWidth;
      arena.classList.add('is-shake');
      setTimeout(function() {
        if (fx.parentNode) fx.parentNode.removeChild(fx);
        arena.classList.remove('is-shake');
      }, 900);
    }
    // 按下一条默契指令：服务端用**同一个 seed** 重算，我们快进到打断点接着放。
    // 这是「录像 → 一局」的全部机制，代价只有一次请求和一次静默补血条。
    function fireCommand(kind) {
      if (!live.fightId || live.busy || finished) return;
      var isTac = COMMAND_IDS.indexOf(kind) >= 0;
      if (isTac) {
        if (live.slots - live.cmds.length <= 0) { sysToast('这一场的默契已经用完了', 'info'); return; }
        if (usedKinds()[kind]) { sysToast('这一手已经打过了', 'info'); return; }
      } else {
        // 技能牌：冷却中给明确反馈（服务端引擎还会再查一遍，白按不亏）
        var cd = skillCdLeft(kind);
        if (cd > 0) { sysToast('还在冷却（还要 ' + cd + ' 回合）', 'info'); return; }
      }
      var r = pickRound();
      var next = live.cmds.concat([{ r: r, kind: kind }]);
      var cmd = cmdOf(kind);
      live.busy = true;
      if (cardEls[kind]) cardEls[kind].classList.add('is-busy');
      if (fightTimer) { clearTimeout(fightTimer); fightTimer = null; }
      api.post(live.endpoint, bodyOf({ mode: 'reroll', fightId: live.fightId, cmds: next })).then(function(res) {
        if (token !== fightToken) return;
        live.busy = false;
        if (cardEls[kind]) cardEls[kind].classList.remove('is-busy');
        var nd = (res.data && res.data.data) || {};
        if (!nd.steps) { tick(); return; }
        live.cmds = nd.cmds || next;
        // 第 r 回合之前的部分与旧战报逐位相同（同一个 seed，只多了一条指令），
        // 所以静默补血条就行——玩家看到的正是「从这一刻起不一样」。
        var resume = 0;
        while (resume < nd.steps.length && nd.steps[resume].r < r) resume++;
        cur = nd;
        for (var i = 0; i < resume; i++) { meSide.set(nd.steps[i].hpMe); foeSide.set(nd.steps[i].hpFoe); }
        idx = resume;
        lines = [];
        logEl.textContent = (cmd ? (cmd.icon + ' ' + (cmd.word || cmd.name)) : '出手') + ' · 第 ' + r + ' 回合';
        commandFx(kind);
        refreshCmd();
        if (idx >= cur.steps.length) { finish(); return; }
        tick();
      }, function(err) {
        if (token !== fightToken) return;
        live.busy = false;
        if (cardEls[kind]) cardEls[kind].classList.remove('is-busy');
        var msg = (err && err.response && err.response.data && err.response.data.message) || '这一手没能打出去';
        sysToast(msg, 'error');
        tick();
      });
    }

    function finish() {
      if (finished) return;
      finished = true;
      skip.style.display = 'none';
      if (cardRowCache.tac) cardRowCache.tac.className = 'ci-pet-cmdrow is-hidden';
      if (cardRowCache.sk) cardRowCache.sk.className = 'ci-pet-cmdrow is-skills is-hidden';
      if (fightTimer) { clearTimeout(fightTimer); fightTimer = null; }
      // 有会话就一定要走一次 settle：战绩、掉落、成就全在那一步才落地。
      // 没有会话（老响应 / 探针桩）就按老样子直接画结果。
      if (live.fightId && live.endpoint && !settled) {
        settled = true;
        logEl.textContent = '结算中…';
        api.post(live.endpoint, bodyOf({ mode: 'settle', fightId: live.fightId })).then(function(res) {
          if (token !== fightToken) return;
          showResult((res.data && res.data.data) || {}, false);
        }, function() {
          if (token !== fightToken) return;
          showResult(cur, true);
        });
        return;
      }
      showResult(cur, false);
    }

    // 结算横幅。dd 可能是 settle 的返回（没有 steps），也可能是当前战报——
    // 所以这里一个 steps 都不碰，只读结果字段。
    function showResult(dd, unsaved) {
      var banner = h('div', 'ci-pet-arena-result' + (dd.win ? ' is-win' : ' is-lose'));

      if (opts.expedition) {
        // 远征结算（v0.29.0）：讲「这一趟走到了哪」，赢了未完待续（回去挑祝福）。
        // 成就感三行：深度 / 保底与鱼干 / 完成大礼。
        var expNo = dd.depth || opts.depth || 1;
        if (dd.complete) {
          banner.appendChild(h('div', 'ci-pet-result-title', '🏔 远征五层全通！'));
          banner.appendChild(h('div', 'ci-pet-result-sub',
            '积分 +' + (dd.gain || 0) + '（含通关大礼 50）· 现在 ' + (dd.towerPoints || 0) + ' 分' +
            (dd.fishGain ? ' · 小鱼干 +' + dd.fishGain : '')));
          banner.appendChild(h('div', 'ci-pet-result-gate',
            '✦ 这一趟的祝福就到此为止——明天换一条新路线，再来'));
        } else if (dd.ended) {
          banner.appendChild(h('div', 'ci-pet-result-title', '💧 第 ' + expNo + ' 层没过去'));
          banner.appendChild(h('div', 'ci-pet-result-sub',
            '保底积分 +' + (dd.gain || 0) + ' · 这一趟走到第 ' + (expNo - 1) + ' 层' +
            (dd.fishGain ? ' · 小鱼干 +' + dd.fishGain : '')));
          banner.appendChild(h('div', 'ci-pet-result-quota',
            '祝福已收好留作回忆——再出发就是全新的一趟'));
        } else if (dd.win) {
          banner.appendChild(h('div', 'ci-pet-result-title', '🎉 第 ' + expNo + ' 层通过！'));
          banner.appendChild(h('div', 'ci-pet-result-sub',
            '积分 +' + (dd.gain || 0) + ' · 回去挑一个祝福，继续往下走'));
        } else {
          banner.appendChild(h('div', 'ci-pet-result-title', '💧 没打过'));
          banner.appendChild(h('div', 'ci-pet-result-quota', '稍息片刻，重新出发'));
        }
      } else if (opts.tower) {
        // 塔的结算完全不用「积分」这套说法：它讲的是层数，不是分数。
        // 深渊层（v0.28.0）另有一套话术：讲「下潜」不讲「爬」，讲深度不讲层号。
        var fNo = opts.floor;
        var isAbyssRun = !!opts.abyss;
        banner.appendChild(h('div', 'ci-pet-result-title',
          dd.win
            ? (isAbyssRun ? ('🌑 深渊第 ' + opts.abyss + ' 层通过！') : ('🎉 第 ' + fNo + ' 层通过！'))
            : (isAbyssRun ? ('💧 深渊第 ' + opts.abyss + ' 层没过') : ('💧 第 ' + fNo + ' 层没过'))));
        banner.appendChild(h('div', 'ci-pet-result-sub',
          dd.win
            ? ('+ ' + (dd.gain || 0) + ' 塔积分 · 现在 ' + (dd.towerPoints || 0) + ' 分' +
               (isAbyssRun ? ' · 深度 ' + (dd.abyssFloor || 0) : ''))
            : (isAbyssRun
                ? '深度还在——失败不清进度，换本命克它的属性，接着下潜'
                : '差一点。喂饱它、涨了羁绊再来，或者换套技能试试')));
        // 成就感三件套（v0.28.0）：门开仪式 / 里程碑夸赞 / 深度进度。
        // 「下潜成功」的爽点必须落在结算横幅上，而不是埋在成就列表里。
        if (dd.gateOpened) {
          var gate = h('div', 'ci-pet-result-gate',
            '🌑 深渊之门已开启——塔的下面还有整整一个无底的世界');
          banner.appendChild(gate);
        }
        if (isAbyssRun && ABYSS_CHEERS[dd.abyssFloor]) {
          banner.appendChild(h('div', 'ci-pet-result-gate', '✦ ' + ABYSS_CHEERS[dd.abyssFloor]));
        }
        banner.appendChild(h('div', 'ci-pet-result-quota',
          isAbyssRun
            ? '深渊每周榜上见 · 失败不清深度'
            : '今日爬塔 ' + dd.today + ' 次 · 已通 ' + (dd.towerFloor || 0) + ' / ' + (dd.towerTotal || 10) + ' 层'));
      } else if (opts.wild) {
        // 收服结算：三段只在三种结果里各出现一段，别把「没抓到」写成失败
        var cr = opts.creature || dd.creature || {};
        if (dd.captured) {
          banner.appendChild(h('div', 'ci-pet-result-title', '🎉 收服成功！'));
          banner.appendChild(h('div', 'ci-pet-result-sub',
            (cr.icon || '') + ' ' + (cr.name || '它') + ' 加入了图鉴 · 图鉴 ' + dd.dexCount + ' / ' + dd.dexTotal));
          if (dd.buddySet) {
            banner.appendChild(h('div', 'ci-pet-result-share',
              '它是你的第一只，已经自动成为随行伙伴。'));
          }
        } else if (dd.win) {
          banner.appendChild(h('div', 'ci-pet-result-title', '⚡ 打赢了，但它溜走了'));
          banner.appendChild(h('div', 'ci-pet-result-sub',
            '这次收服率 ' + Math.round((dd.chance || 0) * 100) + '% · 下次 ' +
            Math.round((dd.nextChance || 0) * 100) + '%（每失败一次 +12%）'));
        } else {
          banner.appendChild(h('div', 'ci-pet-result-title', '💧 没打过'));
          banner.appendChild(h('div', 'ci-pet-result-sub',
            '它跑了。喂饱宠物、涨了羁绊再来，或者换成本命克制它的属性。'));
        }
        banner.appendChild(h('div', 'ci-pet-result-quota',
          '收服不消耗练习赛次数，也不涨积分'));
      } else if (opts.boss) {
        // 环境副本 Boss：讲的是「本周的考试」，不是分数
        var envLabel = opts.envName || '环境副本';
        banner.appendChild(h('div', 'ci-pet-result-title',
          dd.win ? ('🎉 ' + envLabel + '通关！') : ('💧 ' + ((dd.foe && dd.foe.name) || 'Boss') + ' 太硬了')));
        banner.appendChild(h('div', 'ci-pet-result-sub',
          dd.firstKill
            ? '本周首杀！奖励装备已经进了你的背包'
            : (dd.win ? '积分 +' + (dd.gain || 0) + ' · Boss 每天一次，明天再来' : '保底积分 +' + (dd.gain || 0) + ' · 配套 Build、换克制属性，明天再试')));
        banner.appendChild(h('div', 'ci-pet-result-quota',
          '环境每周轮换 · Boss 每天一次 · 胜 +8 / 负 +2 分'));
      } else {
        banner.appendChild(h('div', 'ci-pet-result-title', dd.win ? '🏆 赢了！' : '💧 惜败'));
        banner.appendChild(h('div', 'ci-pet-result-sub',
          (dd.win ? '积分 +' : '保底积分 +') + dd.gain + ' · 现在 ' + ((dd.record && dd.record.points) || 0) + ' 分'));
        // 连胜只在赢了的时候报；断了就别在失败横幅上再补一句「连胜断了」——落井下石。
        if (dd.win && dd.record && dd.record.streak > 1) {
          banner.appendChild(h('div', 'ci-pet-result-streak', '🔥 ' + dd.record.streak + ' 连胜'));
        }
        // 次数不限之后，这里报的是「今天第几场」+ 积分衰减提示
        banner.appendChild(h('div', 'ci-pet-result-quota',
          '今日第 ' + dd.today + ' 场' + (dd.decayed ? '（今天打得多，收益已在递减）' : '')));
      }
      // 装备掉落（野怪 / 环境 Boss 通用）：掉东西是打完最想看到的一行
      if (dd.drop && dd.drop.id) {
        banner.appendChild(h('div', 'ci-pet-result-drop',
          '🎁 掉落 ' + (dd.drop.icon || '') + ' ' + (dd.drop.name || '') +
          (dd.drop.duplicate ? '（重复已分解，+' + (dd.drop.dust || 0) + ' 🐟）' : '')));
      }
      // 打真人时才有的那一行：让「对面是活人」这件事在结算的一瞬间被看见
      if (dd.defended && dd.opp && dd.opp.kind === 'shadow') {
        var nick = dd.opp.owner ? (dd.opp.owner + ' 的 ') : '';
        banner.appendChild(h('div', 'ci-pet-result-share',
          '已留言给 ' + nick + (dd.opp.name || '对方') +
          '：他这场' + (dd.defended.held ? '守住了（+' + dd.defended.gain + ' 分）' : '没守住')));
      }
      // 新解锁的成就：这是打完之后最该被看到的一行
      if (dd.unlocked && dd.unlocked.length) {
        var got = [];
        for (var u = 0; u < dd.unlocked.length; u++) {
          got.push((dd.unlocked[u].icon || '') + ' ' + dd.unlocked[u].name);
        }
        banner.appendChild(h('div', 'ci-pet-result-ach', '🎖 解锁成就：' + got.join('、')));
      }
      if (unsaved) {
        banner.appendChild(h('div', 'ci-pet-result-quota',
          '这一场没能记账（页面放太久或断线），它不算进战绩，也不算输。'));
      }
      var back = h('button', 'ci-pet-foe-btn',
        opts.expedition ? '回到远征' :
        (opts.wild ? '回到图鉴' : (opts.tower ? '回到塔' : '回到对手列表')));
      back.addEventListener('click', function() {
        // battle 在开打时已置 null（战绩/次数都变了），这里只负责重新取一次再渲染
        if (opts.expedition) {
          loadBattle(function() { openSheet(sec, 'fight', 'exp'); });
        } else if (opts.wild) {
          reloadState(function() {
            loadBattle(function() { renderHome(); });
          });
        } else {
          loadBattle(function() { fillBattle(sec); });
        }
      });
      banner.appendChild(back);
      arena.appendChild(banner);
      if (dd.win) { try { window.dispatchEvent(new CustomEvent('ci-pet-win')); } catch (e) {} }
    }

    function tick() {
      if (token !== fightToken) return;
      if (idx >= cur.steps.length) { finish(); return; }
      applyStep(cur.steps[idx]);
      idx++;
      // 冷却随回合推进变化：每步刷一次技能牌状态（class 写入，代价可忽略）
      refreshCmd();
      fightTimer = setTimeout(tick, 340);
    }

    skip.addEventListener('click', function() {
      if (token !== fightToken) return;
      // ⚠️ 这里不能调 stopFight()——它会把 fightToken 递增，导致 finish 里
      //    settle 回调的 token 校验永远失败，「跳过动画」= 白打一场没战绩。
      if (fightTimer) { clearTimeout(fightTimer); fightTimer = null; }
      while (idx < cur.steps.length) { applyStep(cur.steps[idx]); idx++; }
      finish();
    });

    fightTimer = setTimeout(tick, 320);
  }

  function notifyChanged() {
    try { window.dispatchEvent(new CustomEvent('ci-pet-state-changed')); } catch (e) {}
  }

  // 容器宽度变了（平板旋转 / 窗口缩放）→ 重算格子并重绘画布，保证画布永远在可视区内
  var resizeTimer = null;
  function onResize() {
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function() {
      resizeTimer = null;
      if (!root || !editCanvas) return;      // 只有编辑器在台上才需要重绘
      // 旋转/分屏后画板卡宽度和视口高度都变了：重算格宽并整块重挂
      try { if (window.__ciFitEditor) window.__ciFitEditor(); } catch (e) {}
      try { if (window.__ciPlacePalette) window.__ciPlacePalette(); } catch (e) {}
      var next = computeCell();
      if (next !== CELL) { CELL = next; mountEditView(); }
    }, 150);
  }

  // ================= 挂载契约 =================
  var context = null;
  function mount(container, ctx) {
    editorOpen = false;   // 重新挂载时清掉残留状态（否则首页会被守卫误拦）
    context = ctx;
    api = ctx && ctx.data && ctx.data.api;
    storage = ctx && ctx.data && ctx.data.storage;
    root = h('div', 'ci-pethome');
    // hover:none 的老 WebView 不一定认（Chrome 80 认），JS 再兜一层：
    // 触屏设备上没有物理键盘，快捷键提示白占两行，画板正好缺这点高度。
    var isTouch = false;
    try { isTouch = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0); } catch (e) { isTouch = false; }
    if (isTouch) root.classList.add('is-touch');
    container.appendChild(root);
    if (ctx && ctx.app && typeof ctx.app.onDestroy === 'function') {
      ctx.app.onDestroy(function() {
        window.removeEventListener('resize', onResize);
        document.removeEventListener('keydown', onEditorKey);
        // 专注计时器必须在这里停：离开页面后 root 会被置空，
        // interval 再跑一次就会在 null 上 querySelector 并触发结算 / 重绘。
        stopFocusTimer();
        root = null;
      });
    }
    // 调试/探针钩子：罐头战报直接上舞台（不发请求、不落战绩），
    // 用来验证「战斗舞台」——练习/影子/塔与 Boss 共用同一套场景层。
    window.__ciPetFightDemo = function() {
      if (!root) return 'no-root';
      var sec = root.querySelector('.ci-pet-battle');
      if (!sec) return 'no-battle';
      // 十一回合剧本：互相有来有回，第 5 回合重锤暴击，第 11 回合终结
      var steps = [
        { r: 1, by: 0, dmg: 14, hpMe: 88, hpFoe: 62, tags: [] },
        { r: 2, by: 1, dmg: 9,  hpMe: 79, hpFoe: 62, tags: [] },
        { r: 3, by: 0, dmg: 18, hpMe: 79, hpFoe: 44, tags: [] },
        { r: 4, by: 1, dmg: 7,  hpMe: 72, hpFoe: 44, tags: [] },
        { r: 5, by: 0, dmg: 12, hpMe: 72, hpFoe: 32, tags: ['heavy'], crit: true },
        { r: 6, by: 1, dmg: 15, hpMe: 57, hpFoe: 32, tags: [] },
        { r: 7, by: 0, dmg: 8,  hpMe: 57, hpFoe: 24, tags: [] },
        { r: 8, by: 1, dmg: 21, hpMe: 36, hpFoe: 24, tags: [] },
        { r: 9, by: 0, dmg: 12, hpMe: 36, hpFoe: 12, tags: ['heavy'], crit: true },
        { r: 10, by: 1, dmg: 6, hpMe: 30, hpFoe: 12, tags: [] },
        { r: 11, by: 0, dmg: 14, hpMe: 30, hpFoe: 0, tags: ['heavy'], crit: true }
      ];
      playFight(sec, {
        me: { name: (state && state.name) || '小家伙', power: 312, hp: 88, type: (battle && battle.battleType) || 'grass' },
        foe: { name: '练习桩 · 木人', power: 240, hp: 76, type: 'earth' },
        steps: steps,
        win: true, gain: 6, today: 1, decayed: false,
        record: { points: 120, streak: 2 }
      }, {});
      return 'ok';
    };

    window.addEventListener('resize', onResize);
    document.addEventListener('keydown', onEditorKey);   // 编辑器快捷键（B/E/G/I/L/R、M、Ctrl+Z/Y/S）只在编辑页生效
    renderSkeleton();
    // 昼夜：读回设备偏好 + 每分钟对表（auto 模式跨过 6:30/18:30 界线时自动换景）
    dayNightLoad();
    applyDayNight(false);
    dayNight.timer = setInterval(function() {
      if (dayNight.mode === 'auto') applyDayNight(true);
    }, 60000);
    // 调试/探针钩子：截图脚本用它钉住白天或黑夜
    window.__ciBeadImport = function(url, opts) {
      var fin = false, okv = false;
      importImageDataUrl(url, opts || importOpts, function(ok) { fin = true; okv = ok; });
      return { done: function() { return fin; }, ok: function() { return okv; } };
    };
    window.__ciPetDayNight = {
      get: function() { return { mode: dayNight.mode, day: isDayNow() }; },
      set: function(m) {
        if (m !== 'day' && m !== 'night' && m !== 'auto') return;
        dayNight.mode = m; dayNight.last = null; applyDayNight(true);
      }
    };
    api.get('/pet/state').then(function(res) {
      var d = (res.data && res.data.data) || {};
      palette = d.palette || [];
      templates = d.templates || [];
      state = d.state;
      applyStateMeta(d);
      renderHome();
      // 上次是在编辑器里被打断的（宿主重挂 / 刷新 / 切后台被回收）→ 直接续上草稿。
      // 标记只在「明确离开」时清除，所以这里命中就一定是中断，不是用户想回家。
      var wasEditing = false;
      try { wasEditing = !!(storage && storage.get(EDIT_SESSION_KEY, null)); } catch (e) {}
      if (wasEditing) {
        var draft = readDraft();
        if (draft) {
          startEditor(draft.data, draft.w, draft.h, {
            workId: draft.workId, workName: draft.workName
          });
          setTimeout(function() { sysToast('已回到上次没拼完的草稿', 'info'); }, 500);
        } else {
          clearEditSession();
        }
      }
      if (state && state.adopted && !petWishTimer) startWishLoop();
      loadStory(function() { renderHome(); });
      // 上次离开页面时可能有一轮专注还在跑：剩余时间没用完就接着计时，
      // 已经超时就当场补结算（否则按钮会永远停在「专注中 00:00」）。
      if (focus.active) {
        if (focusLeftSec() > 0) armFocusTimer();
        else finishFocus(true);
      }
      if (state && state.adopted) {
        notifyChanged();
        // 首页的入口卡要显示今日场次 / 图鉴进度，所以挂载后就顺手取一次档案。
        // loadBattle 成功后只原地补角标和副标题，不整页重绘。
        loadBattle(function() {});
      }
    }).catch(function() {
      clearRoot();
      root.appendChild(h('h2', null, '桌宠'));
      root.appendChild(h('p', 'ci-pethome-sub', '它好像在打瞌睡没应答，稍等一下再戳它～'));
    });
  }
  function unmount(container) {
    window.removeEventListener('resize', onResize);
    document.removeEventListener('keydown', onEditorKey);
    stopFocusTimer();   // 只停表，不清 focus.active —— 回来时还能接着计时（见 armFocusTimer）
    if (resizeTimer) { clearTimeout(resizeTimer); resizeTimer = null; }
    if (dayNight.timer) { clearInterval(dayNight.timer); dayNight.timer = null; }
    try { delete window.__ciPetDayNight; } catch (e) { window.__ciPetDayNight = null; }
    try { delete window.__ciPlacePalette; } catch (e) { window.__ciPlacePalette = null; }
    try { delete window.__ciFitEditor; } catch (e) { window.__ciFitEditor = null; }
    try { delete window.__ciBeadImport; } catch (e) { window.__ciBeadImport = null; }
    if (editorGestureCleanup) {
      window.removeEventListener('pointerup', editorGestureCleanup);
      window.removeEventListener('pointercancel', editorGestureCleanup);
      editorGestureCleanup = null;
    }
    if (root && root.parentNode) root.parentNode.removeChild(root);
    editCanvas = null;
    root = null;
  }

  var definition = { name: NAME, mount: mount, unmount: unmount };
  if (window.ClassIntraMarket && typeof window.ClassIntraMarket.define === 'function') {
    window.ClassIntraMarket.define(definition);
  }
})();
