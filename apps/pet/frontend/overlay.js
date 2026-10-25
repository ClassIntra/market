// 桌宠引擎 M2.7（全局悬浮层）：Shimeji 式行为 + dsh-pet 式手感
// ============================================================
// 行为状态机：
//   idle    呼吸 + 眨眼/小跳/张望；闲 3 分钟入睡
//   walk    底部巡逻（摇摆步态 + 朝向翻转）
//   dash    偶发冲刺；climb   边缘爬墙到顶 → 倒挂晃两下 → 手滑坠落
//   fly     被甩出的抛物线弹道（重力 + 反弹 + 衰减滑停）
//   sleep   趴下 + Zzz + 说梦话
// 动画链（参考 dsh-pet，github.com/PC2005-cloud/dsh-pet，MIT）：
//   空闲时按权重触发"道具小动作"——玩魔方/拍球/吃豆子/看书（CSS 道具 + 表演）
//   右键 / 长按宠物 = 点播菜单（睡觉/玩魔方/拍球/吃豆子/散步）
// 交互：
//   拖拽     弹簧跟手（阻尼）+ 倾斜 + 速度采样；甩出 = 真抛物线弹跳
//   触摸分区 上 40% 摸头（蹭手心），其余挠痒（扭动大笑）
//   叼礼物   低频 +2 羁绊；分身影分身彩蛋；升级/羁绊升档撒拼豆彩纸
// 情感系统：羁绊 bond（日上限防刷）+ 等级联动（exp_updated 庆祝）
// 编码约定：全 ES5（Chrome 80 基线），零外部依赖
(function() {
  'use strict';
  var NAME = 'pet';
  var SIZE = (Number(window.innerWidth) || 1280) >= 1500 ? 80 : 64;
  var WALK_SPEED = 26;
  var DASH_SPEED = 320;
  var GRAVITY = 2400;
  var SLEEP_AFTER_MS = 180000;
  var NIGHT_START = 22, NIGHT_END = 6;

  var el = null;
  var body = null;
  var bubble = null;
  var canvas = null;
  var palette = [];
  var state = null;
  var ctx = null;
  var storage = null;
  var realtime = null;
  var timers = [];
  var pos = { x: 0, y: 0 };
  var facing = 1;
  var mode = 'idle';            // idle | walk | dash | climb | fly | sleep
  var lastInteract = Date.now();
  var kills = 0;
  var levelInfo = null;
  var retryTimer = null;
  var retryDelay = 30000;
  var offExp = null;
  var lastGift = 0;
  var idleTimer = null;
  var videoEl = null;
  var isVideo = false;
  var builtVisual = null;
  var poolsV = null;
  var poolsLoaded = false;
  var menuEl = null;
  // 切换防闪：换源期间盖住 video 的"定格幕布"（把当前帧截图到 canvas）
  var freezeEl = null;
  var revealToken = 0;
  var failedAnims = {};

  function later(fn, ms) { timers.push(setTimeout(fn, ms)); }
  function every(fn, ms) { timers.push(setInterval(fn, ms)); }
  function isNight() { var h = new Date().getHours(); return h >= NIGHT_START || h < NIGHT_END; }
  function period() { var h = new Date().getHours(); return h < 5 ? 'night' : h < 11 ? 'morning' : h < 14 ? 'noon' : h < 18 ? 'afternoon' : 'evening'; }
  function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
  function todayKeyStr() {
    var d = new Date();
    return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
  }
  function busy() { return mode === 'fly' || mode === 'climb' || mode === 'dash'; }

  function bondTier() {
    var b = (state && state.bond) || 0;
    return b >= 200 ? 4 : b >= 120 ? 3 : b >= 60 ? 2 : b >= 20 ? 1 : 0;
  }

  // ---- 台词库 ----
  var LINES = {
    greet: {
      morning: ['早上好呀！', '新的一天，摸摸我吧'],
      noon: ['午安~', '吃饱了就想睡…'],
      afternoon: ['下午好！', '陪你写作业'],
      evening: ['晚上好呀', '今天累不累？'],
      night: ['还没睡呀…', '晚安前看我一眼吧']
    },
    poke: ['嗯？', '嘿嘿', '干嘛啦~', '摸摸', '嘿嘿嘿', '再摸摸', '痒痒的', '最喜欢你了', '（蹭蹭）'],
    pokeHigh: ['我知道你最爱我！', '（开心到冒泡）', '今天也喜欢你', '唔…被看穿了'],
    pat: ['（蹭蹭手心）', '咕噜咕噜', '就要摸这里', '好舒服…'],
    tickle: ['哈哈哈哈别挠了！', '（扭来扭去）', '饶了我吧——', '肚皮笑疼了！'],
    drag: ['哎哟！', '飞起来啦——', '放我下来嘛', '哇——'],
    throwFast: ['哇啊啊——', '自由飞行！', '再见了我世界！'],
    land: ['（拍拍灰）', '稳稳落地', '哼哼', '我的屁股…'],
    feed: ['好吃！！', '还想吃', '谢谢投喂~', '唔姆唔姆'],
    sleep: ['Zzz…', '呼…呼…'],
    dream: ['Zzz…（梦到豆子山）', '呼…（蹬腿）', '唔…再睡五分钟…'],
    wake: ['（伸懒腰）', '我睡着的哦？', '啊——睡得好饱'],
    walk: ['散散步~', '巡逻中', '咦，那边有啥'],
    dash: ['冲鸭——', '赶时间！', '咻——', '让一让让一让！'],
    climb: ['壁虎模式！', '咻咻咻往上爬', '看我爬墙绝活'],
    hang: ['（倒挂）嗨~', '看我的绝活！', '血液涌上头了…'],
    gift: ['捡到宝贝！', '给你看我的收藏', '这颗豆子送你！'],
    clone: ['（分身！）', '我不是一个人在战斗！', '影分身之术！'],
    cube: ['魔方又乱了…', '转过来…再转过去…', '快好了快好了！'],
    ball: ['拍球时间！', '看我的球技！', '咚、咚、咚'],
    bowl: ['开饭啦！', '一颗一颗吃', '好好吃…'],
    book: ['看书充电中…', '这一页好有意思', '嘘，别打扰我'],
    nap: ['小憩一会儿…', '就眯五分钟…'],
    levelup: ['升级啦！！', '我也变强了！', '一起变厉害！'],
    tierup: ['我们的羁绊变深了！', '（心里暖暖的）', '以后也请多指教！']
  };
  function bubbleSay(text, ms) {
    if (!el || !text) return;
    if (!bubble) {
      bubble = document.createElement('div');
      bubble.className = 'ci-pet-bubble';
      el.appendChild(bubble);
    }
    bubble.textContent = text;
    bubble.classList.add('ci-pet-bubble--show');
    later(function() { if (bubble) bubble.classList.remove('ci-pet-bubble--show'); }, ms || 1600);
  }
  function say(scene, ms) {
    var pool;
    if (scene === 'poke' && bondTier() >= 3) pool = LINES.poke.concat(LINES.pokeHigh);
    else if (scene === 'greet') pool = isNight() ? LINES.greet.night : (LINES.greet[period()] || LINES.greet.morning);
    else pool = LINES[scene] || [];
    if (pool.length) bubbleSay(pick(pool), ms || 1600);
  }

  // ---- 渲染（dpr 真实像素）----
  function draw(design) {
    if (isVideo || !canvas || !design) return;
    var dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(SIZE * dpr);
    canvas.height = Math.round(SIZE * dpr);
    canvas.style.width = SIZE + 'px';
    canvas.style.height = SIZE + 'px';
    var g = canvas.getContext('2d');
    g.clearRect(0, 0, canvas.width, canvas.height);
    var cell = SIZE * dpr / design.w;
    for (var y = 0; y < design.h; y++) {
      for (var x = 0; x < design.w; x++) {
        var ch = design.data.charAt(y * design.w + x);
        if (ch === '.') continue;
        var idx = parseInt(ch, 16);
        if (isNaN(idx) || !palette[idx]) continue;
        g.fillStyle = palette[idx];
        g.fillRect(x * cell, y * cell, cell + 0.5, cell + 0.5);
      }
    }
  }

  // ---- 动作原语 ----
  function anim(cls, ms) {
    if (!body) return;
    body.classList.remove('ci-pet-squash', 'ci-pet-blink', 'ci-pet-hop', 'ci-pet-stretch', 'ci-pet-wiggle');
    void body.offsetWidth;
    body.classList.add(cls);
    later(function() { if (body) body.classList.remove(cls); }, ms);
  }

  function heart(n) {
    if (!el) return;
    for (var i = 0; i < (n || 1); i++) {
      (function(i) {
        later(function() {
          if (!el) return;
          var h = document.createElement('span');
          h.className = 'ci-pet-heart';
          h.textContent = '♥';
          h.style.left = (20 + Math.random() * 50) + '%';
          el.appendChild(h);
          later(function() { if (h.parentNode) h.parentNode.removeChild(h); }, 900);
        }, i * 180);
      })(i);
    }
  }

  function confetti() {
    if (!el) return;
    var colors = ['#FF3B30', '#FFD60A', '#34C759', '#0A84FF', '#BF5AF2', '#FF9EBB'];
    for (var i = 0; i < 10; i++) {
      (function(i) {
        var c = document.createElement('span');
        c.className = 'ci-pet-confetti';
        c.style.background = colors[i % colors.length];
        c.style.left = (10 + Math.random() * 80) + '%';
        c.style.animationDelay = (Math.random() * 0.25) + 's';
        el.appendChild(c);
        later(function() { if (c.parentNode) c.parentNode.removeChild(c); }, 1400);
      })(i);
    }
  }

  // ---- 定位（transform 合成层）----
  function petH() {
    // 视频形态：命中区高约 200（fitVideo 设定）；像素形态 64
    return isVideo ? 200 : SIZE;
  }
  function visualSize() {
    if (isVideo) {
      var vh2 = Number(window.innerHeight) || 787;
      var h = Math.max(180, Math.min(330, Math.round(vh2 * 0.34)));
      var w = Math.round(h * 16 / 9);
      // 人物包围盒（与 fitVideo 完全一致）：活动边界按人物大小算，不是画幅
      return { w: Math.round(w * 0.4), h: Math.round(h * 0.65) };
    }
    return { w: SIZE, h: SIZE };
  }
  function bounds() {
    var vw = Number(window.innerWidth) || 1280;
    var vh = Number(window.innerHeight) || 787;
    var box = visualSize();
    return {
      minX: 4,
      maxX: Math.max(4, vw - box.w - 4),
      maxY: Math.max(4, vh - box.h - 4),
      floorY: Math.max(4, vh - box.h - 60),
      minY: 4
    };
  }
  function applyPos() {
    if (!el) return;
    if (!Number.isFinite(pos.x) || !Number.isFinite(pos.y)) return; // 坏坐标拒绝上屏
    el.style.transform = 'translate3d(' + pos.x + 'px,' + pos.y + 'px,0) scaleX(' + facing + ')';
  }
  function setPos(x, y) {
    var b = bounds();
    pos.x = Math.max(b.minX, Math.min(b.maxX, x));
    pos.y = Math.max(b.minY, Math.min(b.maxY, y));
    applyPos();
  }
  function clamp() {
    var b = bounds();
    if (!Number.isFinite(pos.x) || !Number.isFinite(pos.y)) {
      pos.x = b.maxX - 24;
      pos.y = b.floorY;
    }
    var nx = Math.max(b.minX, Math.min(b.maxX, pos.x));
    var ny = Math.max(b.minY, Math.min(b.maxY, pos.y));
    pos.x = Number.isFinite(nx) ? nx : (Number(b.maxX) ? b.maxX - 24 : 1280 - 88);
    pos.y = Number.isFinite(ny) ? ny : (Number(b.floorY) ? b.floorY : 627);
    applyPos();
  }
  function savePos() {
    try { if (storage) storage.set('pos', pos); } catch (e) {}
  }

  // ---- 行为状态机 ----
  function setMode(m) {
    if (mode === m) return;
    mode = m;
    if (el) {
      el.classList.toggle('ci-pet-sleeping', m === 'sleep');
      el.classList.toggle('ci-pet-walking', m === 'walk');
      el.classList.toggle('ci-pet-dashing', m === 'dash');
      el.classList.toggle('ci-pet-climbing', m === 'climb');
    }
  }

  function wake(reason) {
    lastInteract = Date.now();
    if (mode === 'sleep') {
      setMode('idle');
      anim('ci-pet-stretch', 700);
      say('wake', 1500);
    }
    if (reason !== 'silent') scheduleIdle();
  }

  var idleTimer = null;
  function scheduleIdle() {
    if (idleTimer) return;
    var tick = function() {
      idleTimer = null;
      if (!el) return;
      var idleMs = Date.now() - lastInteract;
      if (mode !== 'sleep' && idleMs > SLEEP_AFTER_MS) {
        setMode('sleep');
        say('sleep', 2200);
        if (isVideo) { playVideo('原地小憩沉眠', true); }
        return;
      }
      if (mode === 'idle') {
        var roll = Math.random();
        // 节奏设计：多数时候安静待着（呼吸/眨眼），偶尔才移动或表演 —— "活泼但不闹"
        if (roll < 0.34) { /* 什么都不做：让待机动画自然播放 */ }
        else if (roll < 0.48) anim('ci-pet-blink', 300);
        else if (roll < 0.58) anim('ci-pet-hop', 700);
        else if (roll < 0.72) startWalk();
        else if (roll < 0.78) startDash();
        else if (roll < 0.82) tryClimb();
        else if (roll < 0.92) propAction();
        else if (roll < 0.95) maybeGift();
        else if (roll < 0.97) cloneEvent();
        else if (Math.random() < 0.4) say('walk', 1500);
      }
      scheduleIdle();
    };
    // 空闲检查间隔：14-26 秒（原来 5-12 秒太频繁，显得一直在动）
    idleTimer = setTimeout(tick, 14000 + Math.random() * 12000);
    timers.push(idleTimer);
  }

  function moveByTransition(targetX, targetY, speed, done) {
    if (!el) return;
    var dur = Math.round(Math.max(200, Math.abs(targetX - pos.x) / speed * 1000));
    facing = targetX > pos.x ? 1 : -1;
    el.style.transition = 'transform ' + dur + 'ms linear';
    setPos(targetX, targetY);
    later(function() {
      if (el) el.style.transition = '';
      if (done) done();
    }, dur + 60);
  }

  function startWalk() {
    if (busy() || mode === 'sleep' || !el) return;
    setMode('walk');
    var b = bounds();
    var dist = 60 + Math.random() * 180;
    var tx = Math.max(b.minX, Math.min(b.maxX, pos.x + (Math.random() < 0.5 ? -dist : dist)));
    if (isVideo) {
      // 池未加载时保底用固定动作名；池加载后从 moves 池随机
      var mv = poolsV && poolsV.moves && poolsV.moves.actions && poolsV.moves.actions.length
        ? pick(poolsV.moves.actions) : null;
      var animName = mv ? mv.name : '螃蟹走路';
      playVideo(animName);
      // 移动速度固定（不依赖 loadedmetadata——部分环境不触发）
      moveByTransition(tx, b.floorY, WALK_SPEED * 1.5, function() {
        if (mode === 'walk') setMode('idle');
        scheduleIdle();
      });
      return;
    }
    moveByTransition(tx, b.floorY, WALK_SPEED, function() {
      if (mode === 'walk') setMode('idle');
    });
  }

  function startDash() {
    if (busy() || mode === 'sleep' || !el) return;
    setMode('dash');
    var b = bounds();
    var dir = Math.random() < 0.5 ? -1 : 1;
    facing = dir;
    say('dash', 1200);
    if (isVideo) playVideo('原地左转奔跑');
    moveByTransition(dir === 1 ? b.maxX : b.minX, b.floorY, DASH_SPEED, function() {
      setMode('idle');
      if (Math.random() < 0.4) say('land', 1000);
    });
  }

  // Shimeji 招牌：边缘爬墙到顶 → 倒挂晃两下 → 手滑坠落
  function tryClimb() {
    if (busy() || mode === 'sleep' || !el) return false;
    var b = bounds();
    var atLeft = pos.x <= b.minX + 40;
    var atRight = pos.x >= b.maxX - 40;
    if ((!atLeft && !atRight) || Math.random() > 0.4) return false;
    facing = atLeft ? -1 : 1;
    setMode('climb');
    say('climb', 1300);
    var climbDur = Math.round(pos.y - b.minY);
    el.style.transition = 'transform ' + climbDur + 'ms linear';
    pos.y = b.minY;
    applyPos();
    later(function() {
      if (el) el.style.transition = '';
      if (mode !== 'climb') return;
      el.classList.add('ci-pet-hanging');
      say('hang', 1500);
      later(function() {
        el.classList.remove('ci-pet-hanging');
        if (mode !== 'climb') return;
        setMode('fly');
        ballistic(0, 40); // 手滑坠落
      }, 1500);
    }, climbDur + 60);
    return true;
  }

  // 弹道（投掷/坠落共用）
  function ballistic(vx, vy) {
    setMode('fly');
    var last = Date.now();
    function step() {
      if (mode !== 'fly' || !el) return;
      var now = Date.now();
      var dt = Math.min(40, now - last) / 1000;
      last = now;
      vy += GRAVITY * dt;
      var b = bounds();
      pos.x += vx * dt;
      pos.y += vy * dt;
      if (pos.x <= b.minX) { pos.x = b.minX; vx = -vx * 0.5; }
      if (pos.x >= b.maxX) { pos.x = b.maxX; vx = -vx * 0.5; }
      if (pos.y <= b.minY) { pos.y = b.minY; vy = Math.abs(vy) * 0.4; }
      if (pos.y >= b.maxY) {
        pos.y = b.maxY;
        if (Math.abs(vy) > 420) { vy = -vy * 0.45; vx *= 0.72; }
        else { applyPos(); landed(); return; }
      }
      applyPos();
      requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  function landed() {
    setMode('idle');
    if (isVideo) { videoEl.loop = false; playVideo('原地重力下蹲压缩'); }
    else anim('ci-pet-squash', 450);
    if (Math.random() < 0.5) say('land', 1300);
    savePos();
    lastInteract = Date.now();
    scheduleIdle();
  }

  // 分身彩蛋
  function cloneEvent() {
    if (!el) return;
    say('clone', 1600);
    var twin = el.cloneNode(true);
    twin.style.opacity = '0.4';
    twin.style.transition = 'transform 1.4s linear, opacity 1.4s linear';
    var dir = Math.random() < 0.5 ? -1 : 1;
    twin.style.transform = 'translate3d(' + (dir === 1 ? -SIZE : window.innerWidth) + 'px,' + pos.y + 'px,0) scaleX(' + (-dir) + ')';
    document.body.appendChild(twin);
    later(function() {
      twin.style.transform = 'translate3d(' + (dir === 1 ? window.innerWidth + SIZE : -SIZE * 2) + 'px,' + pos.y + 'px,0) scaleX(' + (-dir) + ')';
      twin.style.opacity = '0';
    }, 60);
    later(function() { if (twin.parentNode) twin.parentNode.removeChild(twin); }, 1600);
  }

  function maybeGift() {
    if (Date.now() - lastGift < 2 * 60 * 60 * 1000) return;
    if (Math.random() > 0.5) return;
    lastGift = Date.now();
    say('gift', 1800);
    if (isVideo) playVideo('拆礼物');
    if (el) {
      var g = document.createElement('span');
      g.className = 'ci-pet-gift';
      g.textContent = '🎁';
      el.appendChild(g);
      later(function() { if (g.parentNode) g.parentNode.removeChild(g); }, 1600);
    }
    later(function() { heart(2); }, 500);
    reportInteract('gift');
  }

  // ---- 动画链：道具小动作（dsh-pet 式加权随机表演）----
  var PROPS = [
    { emoji: '🎲', side: 'right', line: 'cube' },
    { emoji: '⚽', side: 'right', line: 'ball' },
    { emoji: '🍚', side: 'right', line: 'bowl' },
    { emoji: '📖', side: 'left', line: 'book' }
  ];
  function propAction(force) {
    if (!el) return;
    var p = (typeof force === 'object') ? force : pick(PROPS);
    var prop = document.createElement('span');
    prop.className = 'ci-pet-prop ci-pet-prop--' + p.side;
    prop.textContent = p.emoji;
    el.appendChild(prop);
    say(p.line, Math.min(2600, 3200));
    later(function() { if (prop.parentNode) prop.parentNode.removeChild(prop); }, 3000);
  }

  function napAction() {
    if (mode === 'sleep') return;
    setMode('sleep');
    say('nap', 1500);
    later(function() {
      if (mode === 'sleep') { setMode('idle'); say('wake', 1300); scheduleIdle(); }
    }, 6000);
  }

  // ---- 点播菜单（右键 / 长按）----
  var MENU_ITEMS = [
    { label: '🎲 玩魔方', fn: function() { propAction(PROPS[0]); } },
    { label: '⚽ 拍球', fn: function() { propAction(PROPS[1]); } },
    { label: '🍚 吃豆子', fn: function() { propAction(PROPS[2]); } },
    { label: '📖 看书', fn: function() { propAction(PROPS[3]); } },
    { label: '🌙 小憩', fn: napAction },
    { label: '🚶 散步', fn: startWalk }
  ];
  function showMenu(x, y) {
    hideMenu();
    menuEl = document.createElement('div');
    menuEl.className = 'ci-pet-menu';
    MENU_ITEMS.forEach(function(item) {
      var b = document.createElement('button');
      b.type = 'button';
      b.textContent = item.label;
      b.addEventListener('click', function() {
        hideMenu();
        try { item.fn(); } catch (e) {}
      });
      menuEl.appendChild(b);
    });
    document.body.appendChild(menuEl);
    var mw = 150, mh = MENU_ITEMS.length * 38 + 12;
    menuEl.style.left = Math.max(8, Math.min(x, (window.innerWidth || 1280) - mw - 8)) + 'px';
    menuEl.style.top = Math.max(8, Math.min(y, (window.innerHeight || 787) - mh - 8)) + 'px';
    later(function() {
      document.addEventListener('pointerdown', onMenuOutside, true);
    }, 0);
  }
  function onMenuOutside(e) {
    if (menuEl && !menuEl.contains(e.target)) hideMenu();
  }
  function hideMenu() {
    if (menuEl) { document.removeEventListener('pointerdown', onMenuOutside, true); menuEl.parentNode.removeChild(menuEl); menuEl = null; }
  }

  // ---- 交互 ----
  function reportInteract(type) {
    var api = ctx && ctx.data && ctx.data.api;
    if (!api) return;
    api.post('/pet/interact', { type: type }).then(function(res) {
      var d = (res.data && res.data.data) || {};
      if (d.state) state = d.state;
      if (d.tierUp) later(function() { say('tierup', 2200); confetti(); }, 900);
    }).catch(function() {});
  }

  function poke(e) {
    if (mode === 'sleep') { wake(); reportInteract('poke'); return; }
    if (isVideo && poolsV && poolsV.clicks && poolsV.clicks.length) {
      lastInteract = Date.now();
      playVideo(pick(poolsV.clicks));
      // 双保险：250ms 后若仍 paused 再推一次（部分环境 play() promise 静默失败）
      later(function() {
        if (isVideo && videoEl && videoEl.paused) { var px = videoEl.play(); if (px && px.catch) px.catch(function() {}); }
      }, 250);
      reportInteract('poke');
      return;
    }
    var isPat = false;
    if (e && el && el.getBoundingClientRect) {
      var r = el.getBoundingClientRect();
      isPat = (e.clientY - r.top) / Math.max(1, r.height) < 0.4;
    }
    if (isPat) {
      anim('ci-pet-blink', 400);
      heart(2);
      bubbleSay(pick(LINES.pat), 1600);
    } else {
      anim('ci-pet-wiggle', 550);
      say('tickle', 1500);
    }
    reportInteract('poke');
  }

  function feed() {
    if (!el) return;
    wake('silent');
    heart(3);
    say('feed', 1800);
    if (isVideo) { playVideo('吃白饭'); } else { anim('ci-pet-hop', 700); }
    reportInteract('feed');
  }

  function celebrateLevel(level) {
    confetti();
    if (isVideo) playVideo('可爱宅舞');
    anim('ci-pet-hop', 700);
    later(function() { anim('ci-pet-hop', 700); }, 750);
    bubbleSay(pick(LINES.levelup) + (level ? ' Lv' + level : ''), 2400);
  }

  function bindDrag() {
    var dragging = false;
    var moved = 0;
    var sx = 0, sy = 0, ox = 0, oy = 0;
    var samples = [];
    var springActive = false;
    var springTx = 0, springTy = 0;
    // 弹簧跟手（阻尼跟随，参考 dsh-pet 手感）：目标与当前位置插值逼近
    function springLoop() {
      if (!springActive || !el) return;
      pos.x += (springTx - pos.x) * 0.3;
      pos.y += (springTy - pos.y) * 0.3;
      applyPos();
      requestAnimationFrame(springLoop);
    }
    function startLongPress() {
      later(function() {
        if (dragging && moved < 8) showMenu(sx, sy);
      }, 550);
    }
    el.addEventListener('pointerdown', function(e) {
      wake();
      dragging = true;
      moved = 0;
      samples = [{ t: Date.now(), x: e.clientX, y: e.clientY }];
      sx = e.clientX; sy = e.clientY;
      ox = pos.x; oy = pos.y;
      springTx = pos.x; springTy = pos.y;
      el.classList.add('ci-pet-grab');
      startLongPress();
      try { el.setPointerCapture(e.pointerId); } catch (err) {}
      e.preventDefault();
    });
    el.addEventListener('pointermove', function(e) {
      if (!dragging) return;
      samples.push({ t: Date.now(), x: e.clientX, y: e.clientY });
      if (samples.length > 6) samples.shift();
      var dx = e.clientX - sx, dy = e.clientY - sy;
      moved = Math.max(moved, Math.abs(dx) + Math.abs(dy));
      if (moved > 8) {
        if (!springActive) {
          springActive = true;
          requestAnimationFrame(springLoop);
        }
        if (isVideo && videoEl.paused) { playVideo('被鼠标拖拽悬空反馈', true); }
        setMode('idle');
        el.style.transition = '';
        springTx = ox + dx;
        springTy = oy + dy;
        body.style.transform = 'rotate(' + Math.max(-10, Math.min(10, dx / 5)) + 'deg)';
        if (Math.random() < 0.015) say('drag', 1200);
      }
    });
    function release(e) {
      if (!dragging) return;
      dragging = false;
      springActive = false;
      el.classList.remove('ci-pet-grab');
      body.style.transform = '';
      if (moved >= 8) {
        var vx = 0, vy = 0;
        if (samples.length >= 2) {
          var a = samples[0], b2 = samples[samples.length - 1];
          var dt = (b2.t - a.t) / 1000;
          if (dt > 0.016) {
            vx = (b2.x - a.x) / dt;
            vy = (b2.y - a.y) / dt;
          }
        }
        var sp = Math.sqrt(vx * vx + vy * vy);
        var cap = 1900;
        if (sp > cap) { vx = vx / sp * cap; vy = vy / sp * cap; }
        if (sp > 500) {
          setMode('fly');
          say('throwFast', 1300);
          if (isVideo) { playVideo('被鼠标拖拽悬空反馈', true); }
          ballistic(vx, vy - 260);
        } else {
          var b = bounds();
          el.style.transition = 'transform 420ms cubic-bezier(0.32, 0.72, 0, 1.28)';
          setPos(pos.x, b.floorY);
          later(function() {
            if (el) el.style.transition = '';
            anim('ci-pet-squash', 450);
            if (Math.random() < 0.5) say('land', 1200);
            savePos();
          }, 430);
        }
      } else {
        poke(e);
      }
    }
    el.addEventListener('pointerup', release);
    el.addEventListener('pointercancel', function() { release({ clientX: pos.x, clientY: pos.y }); });
    // 右键点播
    el.addEventListener('contextmenu', function(e) {
      e.preventDefault();
      showMenu(e.clientX, e.clientY);
    });
  }

  // 公共收尾：坐标/拖拽/调度（两形态共用——任何分支 return 都不会再跳过这些）
  function afterBuild(isPixel) {
    var sp = storage ? storage.get('pos', null) : null;
    if (sp && Number.isFinite(sp.x) && Number.isFinite(sp.y)) { pos.x = sp.x; pos.y = sp.y; }
    else { var bb = bounds(); pos.x = bb.maxX - 24; pos.y = bb.floorY; }
    clamp();
    bindDrag();
    if (isPixel) {
      anim('ci-pet-squash', 500);
      every(function() { if (mode === 'sleep' && Math.random() < 0.4) bubbleSay(pick(LINES.dream), 2000); }, 11000);
      later(function() { if (mode === 'idle') randomIdleTick(); }, 2200);
      if (!sp) later(function() { say('greet', 2000); }, 900);
    } else {
      anim('ci-pet-squash', 500);
      every(function() { if (mode === 'sleep' && Math.random() < 0.4) bubbleSay(pick(LINES.dream), 2000); }, 11000);
    }
    scheduleIdle();
  }

  // ---- 视频形态（默认形象：dsh-pet 大肥鱼，CC BY-NC-SA，见 assets/THIRD-PARTY-LICENSE.md）----
  function fitVideo() {
    var vh2 = Number(window.innerHeight) || 787;
    var videoVH = Math.max(180, Math.min(330, Math.round(vh2 * 0.34)));
    var videoVW = Math.round(videoVH * 16 / 9);
    // 素材规范：人物在 16:9 画幅内约占 水平 30%~70%、垂直 20%~85%。
    // el = 人物包围盒（不是画幅！）：视频放大 2.5x 并把人物区域对齐到 el。
    // 这样命中区、移动边界、活动范围都按"人物实际大小"算 —— 活动空间从 24px 恢复到 ~500px。
    el.style.width = Math.round(videoVW * 0.4) + 'px';
    el.style.height = Math.round(videoVH * 0.65) + 'px';
    videoEl.style.position = 'absolute';
    videoEl.style.width = '250%';       // 1 / 0.4
    videoEl.style.height = '153.85%';   // 1 / 0.65
    videoEl.style.left = '-75%';        // -(30% × 2.5)
    videoEl.style.top = '-30.77%';      // -(20% × 1.5385)
    videoEl.style.transform = 'none';
  }
  function loadPoolsOnce() {
    if (poolsLoaded) return;
    poolsLoaded = true;
    try {
      fetch('/market-static/pet/assets/anim-pools.json').then(function(r) { return r.json(); }).then(function(j) {
        poolsV = j;
        if (isVideo) chainNext();
      }).catch(function() {});
    } catch (e) {}
  }
  // 单视频元素方案：一个 <video> 搞定所有动作切换。
  // 浏览器原生处理 src 切换（无 display 操作、无双层），闪屏从结构上被消灭。
  var currentAnim = ''; // 当前动作名
  function poolUrl(name) {
    return '/market-static/pet/assets/webm/' + encodeURIComponent(name) + '.webm';
  }

  // ---- 切换防闪幕布 ----
  // 病根：直接改 video.src 会让媒体元素进入 load 算法，渲染退化成"空白/透明"，
  //       直到新素材首帧解码完成 —— 这一两帧到几百毫秒的空窗就是"切换时闪一下"。
  // 解法：换源前把当前帧 drawImage 到一张 canvas 幕布上盖住 video，
  //      等新素材 loadeddata/playing（已握有首帧）再撤幕布。全程屏幕上都有像素。
  function ensureFreeze() {
    if (freezeEl && freezeEl.parentNode === body && document.body.contains(freezeEl)) return freezeEl;
    if (freezeEl && freezeEl.parentNode) { try { freezeEl.parentNode.removeChild(freezeEl); } catch (e) {} }
    freezeEl = document.createElement('canvas');
    freezeEl.className = 'ci-pet-freeze';
    if (body) body.appendChild(freezeEl);
    return freezeEl;
  }
  function freezeFrame() {
    if (!isVideo || !videoEl || !videoEl.videoWidth || !body) return false;
    var vw = videoEl.videoWidth, vh = videoEl.videoHeight;
    if (!vw || !vh) return false;
    var c = ensureFreeze();
    if (c.width !== vw || c.height !== vh) { c.width = vw; c.height = vh; }
    try {
      var g = c.getContext('2d');
      g.clearRect(0, 0, vw, vh);
      g.drawImage(videoEl, 0, 0, vw, vh);
    } catch (e) { return false; }
    // 几何必须与 video 完全一致（fitVideo 用的是百分比，直接照抄内联值，包含块相同）
    c.style.position = 'absolute';
    c.style.width = videoEl.style.width;
    c.style.height = videoEl.style.height;
    c.style.left = videoEl.style.left;
    c.style.top = videoEl.style.top;
    c.style.opacity = '1';
    videoEl.style.opacity = '0';
    return true;
  }
  function revealVideo() {
    revealToken++; // 让尚未落地的兜底计时失效
    if (freezeEl) freezeEl.style.opacity = '0';
    if (videoEl) videoEl.style.opacity = '1';
  }
  // 首帧就绪即撤幕布；1.2s 兜底（素材慢/缺失也不能永久定格）
  function armReveal() {
    var my = ++revealToken;
    function once() {
      if (my !== revealToken) return;
      revealToken++;
      if (videoEl) {
        videoEl.removeEventListener('loadeddata', once);
        videoEl.removeEventListener('playing', once);
      }
      revealVideo();
    }
    if (videoEl) {
      videoEl.addEventListener('loadeddata', once);
      videoEl.addEventListener('playing', once);
    }
    later(function() { if (my === revealToken) once(); }, 1200);
  }

  function playVideo(name, loop) {
    if (!videoEl || !name) return;
    if (failedAnims[name]) name = idleName(); // 素材缺失：回落到待机，别再闪一次
    var url = poolUrl(name);
    // 同名且就是当前源：倒回去重播（不重载）—— 循环待机/被反复触发时零空窗
    if (name === currentAnim && videoEl.getAttribute('src') === url && videoEl.readyState >= 2) {
      try { videoEl.currentTime = 0; } catch (e) {}
      var p0 = videoEl.play();
      if (p0 && p0.catch) p0.catch(function() {});
      revealVideo();
      return;
    }
    // 同名且仍在播（拖拽 pointermove 每帧调用）：跳过
    if (name === currentAnim && !videoEl.paused && !videoEl.ended) return;
    currentAnim = name;
    videoEl.loop = !!loop;
    freezeFrame();          // 幕布先就位，再动 src
    videoEl.removeAttribute('src'); // 强制浏览器重载（同 URL 时不移除会卡在末帧）
    videoEl.src = url;
    var pr = videoEl.play();
    if (pr && pr.catch) pr.catch(function() {});
    armReveal();
  }

  // 素材拉取失败：撤幕布 + 记黑，避免"白 box 卡住 + 反复重试"
  function onVideoError() {
    if (!isVideo || !videoEl) return;
    if (currentAnim) failedAnims[currentAnim] = 1;
    revealVideo();
    if (currentAnim !== idleName()) {
      currentAnim = '';
      later(function() { playVideo(idleName()); }, 120);
    }
  }
  function onVideoEnded() {
    if (!isVideo || !videoEl) return;
    currentAnim = '';
    if (mode === 'sleep') { playVideo(idleName(), true); return; }
    if (mode === 'walk' || mode === 'dash') return;
    if (Date.now() - lastInteract > SLEEP_AFTER_MS) { setMode('sleep'); }
    if (mode === 'sleep') { playVideo(idleName(), true); return; }
    if (Math.random() < 0.55 || !poolsV) playVideo(idleName());
    else playVideo(pickWeighted());
  }
  function chainNext() { if (isVideo && videoEl) onVideoEnded(); }

  function pickWeighted() {
    var cats = (poolsV && poolsV.categories) || [];
    var total = 0;
    cats.forEach(function(c) { total += c.weight; });
    var r = Math.random() * total;
    for (var i = 0; i < cats.length; i++) {
      r -= cats[i].weight;
      if (r < 0) return pick(cats[i].actions);
    }
    return cats.length ? pick(cats[0].actions) : null;
  }
  function idleName() {
    return poolsV ? pick(poolsV.idle) : '待机呼吸休闲';
  }

  // ---- 构建 ----
  function build(visual) {
    builtVisual = visual || 'pixel';
    isVideo = builtVisual === 'video';
    el = document.createElement('div');
    el.className = 'ci-pet';
    el.style.width = SIZE + 'px';
    el.style.height = SIZE + 'px';
    document.body.appendChild(el); // 挂载必须先于任何分支 return（视频形态曾因此从未上屏）
    var shadow = document.createElement('div');
    shadow.className = 'ci-pet-shadow';
    el.appendChild(shadow);
    if (isVideo) {
      // 视频形态同样创建 body 容器：拖拽倾斜（body.style.transform）与松手清倾斜都读写它，
      // 缺了 body 会在每次 pointermove/释放时抛 TypeError（真机日志实锤）
      body = document.createElement('div');
      body.className = 'ci-pet-body';
      body.style.width = '100%';
      body.style.height = '100%';
      el.appendChild(body);
      videoEl = document.createElement('video');
      videoEl.className = 'ci-pet-video';
      videoEl.muted = true;
      videoEl.setAttribute('playsinline', 'playsinline');
      videoEl.setAttribute('webkit-playsinline', 'webkit-playsinline');
      videoEl.style.pointerEvents = 'none';
      el.classList.add('ci-pet--video');
      fitVideo();
      body.appendChild(videoEl);
      videoEl.addEventListener('ended', onVideoEnded);
      videoEl.addEventListener('error', onVideoError);
      afterBuild(false);
      return;
    }
    body = document.createElement('div');
    body.className = 'ci-pet-body';
    body.style.width = SIZE + 'px';
    body.style.height = SIZE + 'px';
    canvas = document.createElement('canvas');
    canvas.className = 'ci-pet-canvas';
    body.appendChild(canvas);
    el.appendChild(body);
    var z = document.createElement('div');
    z.className = 'ci-pet-zzz';
    z.textContent = 'Z z z';
    el.appendChild(z);
    afterBuild(true);
  }

  function randomIdleTick() {
    if (!el) return;
    var roll = Math.random();
    if (roll < 0.3) anim('ci-pet-blink', 300);
    else if (roll < 0.5) anim('ci-pet-hop', 700);
    else if (roll < 0.65) propAction();
    else if (roll < 0.75) startWalk();
    else if (roll < 0.8) startDash();
    else if (roll < 0.85) tryClimb();
    else if (roll < 0.87) cloneEvent();
  }

  function destroy() {
    hideMenu();
    if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
    if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
    for (var i = 0; i < timers.length; i++) { clearTimeout(timers[i]); clearInterval(timers[i]); }
    timers = [];
    if (offExp) { offExp(); offExp = null; }
    if (el && el.parentNode) el.parentNode.removeChild(el);
    if (freezeEl && freezeEl.parentNode) { try { freezeEl.parentNode.removeChild(freezeEl); } catch (e) {} }
    freezeEl = null;
    failedAnims = {}; currentAnim = '';
    if (videoEl) { try { videoEl.pause(); videoEl.removeAttribute('src'); } catch (e) {} }
    videoEl = null; isVideo = false; builtVisual = null;
    el = null; bubble = null; canvas = null; body = null;
    mode = 'idle';
    kills += 1;
  }

  // 坐标守卫 + 看门狗（无论什么路径弄丢桌宠，10s 内自动爬回来）
  var lastError = '';
  (function() {
    try {
      var realX = 0;
      Object.defineProperty(pos, 'x', {
        get: function() { return realX; },
        set: function(v) {
          if (!Number.isFinite(v)) {
            if (!lastError) lastError = 'pos.x 写入被拒绝: ' + String(v);
            return;
          }
          realX = v;
        },
        configurable: true
      });
      var realY = 0;
      Object.defineProperty(pos, 'y', {
        get: function() { return realY; },
        set: function(v) {
          if (!Number.isFinite(v)) {
            if (!lastError) lastError = 'pos.y 写入被拒绝: ' + String(v) + ' @ ' + String(new Error().stack || '').split('\n').slice(2, 8).join(' | ');
            return;
          }
          realY = v;
        },
        configurable: true
      });
    } catch (e) {}
  })();

  var watchdogTimer = null;
  function startWatchdog() {
    if (watchdogTimer) return;
    watchdogTimer = setInterval(function() { try { watchdogTick(); } catch (e) {} }, 10000);
  }
  function watchdogTick() {
    try {
      if (!state || !state.adopted || state.enabled === false) return;
      if (el && el.parentNode) {
        kills = 0;
        var r = el.getBoundingClientRect();
        var vw = window.innerWidth || 1, vh = window.innerHeight || 1;
        if (r.right < 0 || r.bottom < 0 || r.left > vw || r.top > vh) {
          console.warn('[pet] 看门狗：桌宠在视口外，拉回屏内');
          clamp();
        }
        return;
      }
      console.warn('[pet] 看门狗：桌宠丢失，自动重建（第 ' + (kills + 1) + ' 次）');
      build();
      draw(state.design);
    } catch (e) {
      lastError = e && e.message;
      console.error('[pet] 看门狗重建失败:', lastError);
    }
  }
  startWatchdog();

  // ---- 状态/等级 ----
  function loadLevel() {
    var api = ctx && ctx.data && ctx.data.api;
    if (!api) return;
    api.get('/level/info').then(function(res) {
      var d = (res.data && res.data.data) || {};
      levelInfo = { level: d.level || 0 };
    }).catch(function() {});
  }

  function reportVisitOnce() {
    var api = ctx && ctx.data && ctx.data.api;
    if (!api || (state && state.visited_date === todayKeyStr())) return;
    reportInteract('visit');
  }

  function applyState(s) {
    state = s;
    var show = s && s.adopted && s.enabled !== false && s.design;
    if (show) {
      var wantVisual = (s.design && s.design.type === 'video') ? 'video' : 'pixel';
      if (el && builtVisual !== wantVisual) { destroy(); }
      if (!el) build(wantVisual);
      if (wantVisual === 'video') { loadPoolsOnce(); chainNext(); }
      else draw(s.design);
      reportVisitOnce();
      loadLevel();
    } else if (el) {
      destroy();
    }
  }

  function scheduleRetry() {
    if (retryTimer) return;
    retryTimer = setTimeout(function() {
      retryTimer = null;
      if (ctx) loadState(ctx);
    }, retryDelay);
    retryDelay = Math.min(retryDelay * 2, 300000);
  }

  function loadState(context) {
    var api = context && context.data && context.data.api;
    if (!api) return;
    api.get('/pet/state').then(function(res) {
      var d = (res.data && res.data.data) || {};
      palette = d.palette || [];
      retryDelay = 30000;
      applyState(d.state);
    }).catch(function() {
      scheduleRetry();
    });
  }

  function onPetChanged() { if (ctx) loadState(ctx); }

  function onVisibility() {
    if (!el) return;
    if (document.hidden) {
      if (mode !== 'sleep') setMode('sleep');
    } else {
      wake('silent');
    }
  }

  function mount(container, context) {
    ctx = context;
    storage = context && context.data && context.data.storage;
    realtime = context && context.data && context.data.realtime;
    window.addEventListener('ci-pet-state-changed', onPetChanged);
    window.addEventListener('ci-pet-feed', function() { feed(); });
    window.addEventListener('resize', clamp);
    document.addEventListener('visibilitychange', onVisibility);
    if (realtime && typeof realtime.on === 'function') {
      var prevLevel = levelInfo && levelInfo.level;
      offExp = realtime.on('exp_updated', function(payload) {
        var newLevel = payload && payload.level;
        loadLevel();
        if (newLevel && prevLevel && newLevel > prevLevel) {
          later(function() { celebrateLevel(newLevel); }, 1200);
        }
        if (newLevel) prevLevel = newLevel;
      });
    }
    loadState(context);
    if (context && context.app && typeof context.app.onDestroy === 'function') {
      context.app.onDestroy(function() {
        window.removeEventListener('ci-pet-state-changed', onPetChanged);
        window.removeEventListener('ci-pet-feed', feed);
        window.removeEventListener('resize', clamp);
        document.removeEventListener('visibilitychange', onVisibility);
        destroy();
      });
    }
  }

  function unmount() { destroy(); }

  // 自诊断（宠物屋读取）
  window.__ciPetDebug = function() {
    return {
      domMounted: !!(el && el.parentNode),
      hasCanvas: !!canvas,
      stateKnown: !!state,
      adopted: !!(state && state.adopted),
      enabled: state ? state.enabled !== false : null,
      mode: mode,
      bond: state ? (state.bond || 0) : null,
      bondTier: bondTier(),
      kills: kills,
      level: levelInfo ? levelInfo.level : null,
      lastError: lastError || '',
      pos: { x: pos.x, y: pos.y }
    };
  };

  // 测试钩子（探针用）：直接触发 poke
  window.__ciPetPoke = function() { poke({ clientY: 0 }); }

  var definition = { name: NAME, mount: mount, unmount: unmount };
  if (window.ClassIntraMarket && typeof window.ClassIntraMarket.defineOverlay === 'function') {
    window.ClassIntraMarket.defineOverlay(definition);
  }
})();
