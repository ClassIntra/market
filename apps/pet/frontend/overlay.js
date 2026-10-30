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
  // 翻转层：只包住「身体」，朝向 scaleX 写在这里。
  // ⚠️ 不能写在 el 上 —— el 里还住着气泡/爱心/Zzz/道具 emoji，跟着 scaleX(-1)
  //    一起镜像，台词就会变成反字（桌宠朝左时尤其明显）。
  var flipEl = null;
  var bubble = null;
  var canvas = null;
  var palette = [];
  var state = null;
  var ctx = null;
  var storage = null;
  var realtime = null;
  var timers = [];

  // ---- 音效引擎（WebAudio 合成，零音频文件，Chrome 80 兼容）----
  // 所有音效用振荡器 + 增益 + 滤波器合成，不下载任何文件；
  // AudioContext 必须在用户手势后 resume；提供静音开关与音量。
  var sfxCtx = null;
  var sfxGain = null;
  var sfxEnabled = true;
  try {
    if (storage && storage.get) {
      if (storage.get('sfx') === 'off') sfxEnabled = false;
    }
  } catch (e) {}
  function sfxEnsureCtx() {
    if (sfxCtx) return sfxCtx;
    try {
      var C = window.AudioContext || window.webkitAudioContext;
      if (!C) return null;
      sfxCtx = new C();
      sfxGain = sfxCtx.createGain();
      sfxGain.gain.value = 0.32;
      sfxGain.connect(sfxCtx.destination);
    } catch (e) { sfxCtx = null; }
    return sfxCtx;
  }
  function sfxResume() {
    if (sfxCtx && sfxCtx.state === 'suspended') { try { sfxCtx.resume(); } catch (e) {} }
  }
  function sfxTone(freq, type, dur, vol, delay) {
    var ctx = sfxEnsureCtx(); if (!ctx) return;
    var now = ctx.currentTime + (delay || 0);
    var osc = ctx.createOscillator();
    var g = ctx.createGain();
    osc.type = type || 'sine';
    osc.frequency.setValueAtTime(freq, now);
    g.gain.setValueAtTime((vol || 0.25) * (sfxGain ? 1 : 1), now);
    g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    osc.connect(g); g.connect(sfxGain || ctx.destination);
    osc.start(now); osc.stop(now + dur + 0.02);
  }
  function sfxSweep(f0, f1, type, dur, vol, delay) {
    var ctx = sfxEnsureCtx(); if (!ctx) return;
    var now = ctx.currentTime + (delay || 0);
    var osc = ctx.createOscillator();
    var g = ctx.createGain();
    osc.type = type || 'sine';
    osc.frequency.setValueAtTime(f0, now);
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, f1), now + dur);
    g.gain.setValueAtTime(vol || 0.25, now);
    g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    osc.connect(g); g.connect(sfxGain || ctx.destination);
    osc.start(now); osc.stop(now + dur + 0.02);
  }
  function sfxNoise(dur, vol, delay) {
    var ctx = sfxEnsureCtx(); if (!ctx) return;
    var now = ctx.currentTime + (delay || 0);
    var bufSize = Math.floor(ctx.sampleRate * dur);
    var buf = ctx.createBuffer(1, bufSize, ctx.sampleRate);
    var data = buf.getChannelData(0);
    for (var i = 0; i < bufSize; i++) data[i] = (Math.random() * 2 - 1) * 0.6;
    var src = ctx.createBufferSource();
    src.buffer = buf;
    var g = ctx.createGain();
    var filt = ctx.createBiquadFilter();
    filt.type = 'lowpass'; filt.frequency.value = 1200;
    g.gain.setValueAtTime(vol || 0.2, now);
    g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    src.connect(filt); filt.connect(g); g.connect(sfxGain || ctx.destination);
    src.start(now); src.stop(now + dur + 0.02);
  }
  function sfxPlay(name) {
    if (!sfxEnabled) return;
    sfxEnsureCtx(); sfxResume();
    var map = {
      click: function(){ sfxTone(880, 'sine', 0.06, 0.18); },
      open: function(){ sfxTone(659, 'sine', 0.08, 0.2); sfxTone(880, 'sine', 0.12, 0.2, 0.08); },
      feed: function(){ sfxSweep(520, 260, 'triangle', 0.18, 0.22); },
      poke: function(){ sfxTone(440, 'sine', 0.09, 0.2); },
      crit: function(){ sfxTone(1046, 'sine', 0.08, 0.22); sfxTone(1318, 'sine', 0.1, 0.24, 0.06); sfxTone(1568, 'sine', 0.12, 0.2, 0.12); },
      coin: function(){ sfxTone(988, 'sine', 0.07, 0.2); sfxTone(1318, 'sine', 0.12, 0.22, 0.07); },
      tierup: function(){ sfxTone(523, 'sine', 0.1, 0.2); sfxTone(659, 'sine', 0.1, 0.2, 0.1); sfxTone(784, 'sine', 0.1, 0.2, 0.2); sfxTone(1046, 'sine', 0.22, 0.24, 0.3); },
      'focus-start': function(){ sfxSweep(220, 330, 'sine', 0.25, 0.18); },
      'focus-end': function(){ sfxTone(784, 'sine', 0.1, 0.2); sfxTone(1046, 'sine', 0.2, 0.24, 0.1); },
      'battle-win': function(){ sfxTone(523,'sine',0.1,0.2); sfxTone(659,'sine',0.1,0.2,0.1); sfxTone(784,'sine',0.1,0.2,0.2); sfxTone(1046,'sine',0.25,0.26,0.3); },
      'battle-lose': function(){ sfxSweep(440, 220, 'sawtooth', 0.3, 0.18); },
      capture: function(){ sfxTone(880,'sine',0.08,0.2); sfxTone(1175,'sine',0.08,0.22,0.08); sfxTone(1568,'sine',0.15,0.2,0.16); sfxNoise(0.12,0.12,0.05); },
      levelup: function(){ sfxTone(659,'sine',0.1,0.2); sfxTone(784,'sine',0.1,0.2,0.1); sfxTone(988,'sine',0.1,0.2,0.2); sfxTone(1318,'sine',0.25,0.26,0.3); },
      daily: function(){ sfxTone(659,'sine',0.1,0.2); sfxTone(880,'sine',0.1,0.2,0.1); sfxTone(1046,'sine',0.2,0.24,0.2); },
      error: function(){ sfxSweep(220, 160, 'square', 0.15, 0.16); }
    };
    var fn = map[name];
    if (fn) { try { fn(); } catch (e) {} }
  }
  function sfxSetEnabled(v) {
    sfxEnabled = !!v;
    try { if (storage && storage.set) storage.set('sfx', sfxEnabled ? 'on' : 'off'); } catch (e) {}
  }
  window.__ciPetSfx = { play: sfxPlay, setEnabled: sfxSetEnabled, isEnabled: function(){ return sfxEnabled; } };
  var timers = [];
  var pos = { x: 0, y: 0 };
  var facing = 1;
  var mode = 'idle';            // idle | walk | dash | climb | fly | sleep | focus
  // 专注模式开关：true 时 scheduleIdle 只做呼吸，不主动表演（v0.11.0）
  var focusOn = false;
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
  // ⚠️ 2026-10-27 起主路径已换成双缓冲（见 videoEl2 / startSwap），幕布仅留作回退。
  var freezeEl = null;
  var revealToken = 0;
  var failedAnims = {};
  // ---- 双缓冲换源（2026-10-27）----
  // videoEl 永远指"前台"（可见、正在播），videoEl2 指"后台"（预载新素材，被前台遮住）。
  var videoEl2 = null;
  var swapping = false;        // 后台正在装料
  var swapToken = 0;           // 让过期的等待循环自行退场
  var swapPrevAnim = '';       // 装料失败时要退回的动作名

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
  function clamp(v) { return Math.max(0, Math.min(100, v)); }

  // ---- 反馈层：连击浮字 / 落地灰尘 / 拖拽拖尾 ----
  // 全部只动 opacity + transform，且元素用完即删 —— 低端平板上不加持续负担。
  var comboEl = null;
  function showCombo(n) {
    if (!el) return;
    if (!comboEl) {
      comboEl = document.createElement('div');
      comboEl.className = 'ci-pet-combo';
      el.appendChild(comboEl);   // 挂在 el 上而不是翻转层里，数字不会镜像
    }
    comboEl.textContent = '连击 ×' + n;
    comboEl.classList.remove('ci-pet-combo--pop');
    void comboEl.offsetWidth;
    comboEl.classList.add('ci-pet-combo--pop', 'ci-pet-combo--show');
    later(function() { if (comboEl) comboEl.classList.remove('ci-pet-combo--show'); }, 1500);
  }

  function puff(n) {
    if (!el) return;
    for (var i = 0; i < (n || 5); i++) {
      (function(i) {
        var p = document.createElement('span');
        p.className = 'ci-pet-dust';
        p.style.left = (8 + i * 18 + Math.random() * 6) + '%';
        p.style.animationDelay = (i * 28) + 'ms';
        el.appendChild(p);
        later(function() { if (p.parentNode) p.parentNode.removeChild(p); }, 720);
      })(i);
    }
  }

  function trail(x, y) {
    if (!el) return;
    var t = document.createElement('span');
    t.className = 'ci-pet-trail';
    t.style.left = x + 'px';
    t.style.top = y + 'px';
    el.appendChild(t);
    later(function() { if (t.parentNode) t.parentNode.removeChild(t); }, 520);
  }

  // ---- 连击：连续戳会升级，到了档位给彩蛋 ----
  var combo = 0;
  var comboResetTimer = null;
  var lastPokeAt = 0;
  function bumpCombo() {
    var now = Date.now();
    if (now - lastPokeAt > 1800) combo = 0;   // 停手 1.8s 视为一轮结束
    lastPokeAt = now;
    combo += 1;
    if (comboTimer) { clearTimeout(comboTimer); }
    comboTimer = setTimeout(function() {
      if (combo > (save.stats.maxCombo || 0)) {
        save.stats.maxCombo = combo;
        pushSave();
      }
      combo = 0;
    }, 1800);
    return combo;
  }

  // ---- 进度存档（宠物屋与悬浮层共用同一份键，两侧即时互通）----
  // 数据结构刻意扁平且小：整包存进 SDK storage（ci:app:pet:progress），
  // 不做增量 RPC —— 平板弱网下"存得下、读得快"比"服务端权威"重要。
  var SAVE_KEY = 'progress';
  var save = null;

  function defaultSave() {
    return {
      v: 1,
      beans: 0,
      mood: 72,
      fed: 60,
      energy: 84,
      ts: Date.now(),
      gacha: [],
      ach: {},
      stats: { poke: 0, pat: 0, feed: 0, game: 0, gift: 0, maxCombo: 0 }
    };
  }

  function loadSave() {
    var raw = null;
    try { raw = storage && storage.get(SAVE_KEY, null); } catch (e) {}
    var s = (raw && typeof raw === 'object') ? raw : defaultSave();
    var d = defaultSave();
    if (!s.stats || typeof s.stats !== 'object') s.stats = d.stats;
    if (!s.ach || typeof s.ach !== 'object') s.ach = {};
    if (!(s.gacha instanceof Array)) s.gacha = [];
    if (typeof s.beans !== 'number' || !isFinite(s.beans)) s.beans = 0;
    if (typeof s.mood !== 'number' || !isFinite(s.mood)) s.mood = d.mood;
    if (typeof s.fed !== 'number' || !isFinite(s.fed)) s.fed = d.fed;
    if (typeof s.energy !== 'number' || !isFinite(s.energy)) s.energy = d.energy;
    if (typeof s.ts !== 'number' || !isFinite(s.ts)) s.ts = Date.now();
    save = s;
    return s;
  }

  // 时间衰减：心情 −1.2/h，饱食 −6/h，活力 −2/h。
  // 一节课后回来补个互动就有明显回升 —— 这是"养成感"的来源。
  function decaySave(force) {
    if (!save) return;
    var now = Date.now();
    var hours = (now - (save.ts || now)) / 3600000;
    if (hours < 0) hours = 0;
    if (!force && hours < 0.005) return;   // <18s 不结算，省一次写
    save.mood = clamp(save.mood - hours * 1.2);
    save.fed = clamp(save.fed - hours * 6);
    save.energy = clamp(save.energy - hours * 2);
    save.ts = now;
  }

  function pushSave() {
    try {
      if (storage) { save.ts = Date.now(); storage.set(SAVE_KEY, save); }
    } catch (e) {}
    try { window.dispatchEvent(new CustomEvent('ci-pet-progress')); } catch (e) {}
  }

  // 心情档位：由三值均值决定（影响台词与自动播放的动作池）
  function moodState() {
    var avg = (clamp(save.mood) + clamp(save.fed) + clamp(save.energy)) / 3;
    if (avg >= 82) return { key: 'great', emoji: '🤩', label: '超开心' };
    if (avg >= 60) return { key: 'happy', emoji: '😊', label: '心情不错' };
    if (avg >= 38) return { key: 'ok', emoji: '🙂', label: '一般般' };
    return { key: 'sad', emoji: '😢', label: '有点低落' };
  }

  // 互动回复（每次戳/喂/玩都有数值变化 → 状态条与台词都动起来）
  var CARE = {
    pat: { mood: 3, energy: -0.6, fed: 0 },
    tickle: { mood: 2, energy: -1, fed: 0 },
    feed: { mood: 2, energy: 1, fed: 25 },
    gift: { mood: 2, energy: 0, fed: 0 },
    game: { mood: 4, energy: -3, fed: 0 }
  };
  function care(kind, combo) {
    decaySave(false);
    var c = CARE[kind] || { mood: 0, energy: 0, fed: 0 };
    var bonus = combo && combo >= 5 ? Math.min(2, Math.floor(combo / 5)) : 0;
    save.mood = clamp(save.mood + c.mood + bonus * 0.5);
    save.fed = clamp(save.fed + c.fed);
    save.energy = clamp(save.energy + c.energy);
    if (c.fed > 0) save.lastFed = Date.now();
    pushSave();
  }

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
    // 豪华大餐（小鱼干换的）：台词要和普通喂食拉开差距，否则玩家感觉白花 5 条鱼干
    feast: ['哇！豪华大餐！！', '（眼睛发光）这是过节才吃的吧…', '我、我真的可以吃这个吗？'],
    // 专注（v0.11.0）：开场安静，不喊口号——它在陪你，不是在给你加油
    focus: ['（安静趴下）', '我在这儿，你忙你的。', '（把尾巴收好）'],
    focusEnd: ['（伸了个懒腰）结束了？', '辛苦啦。', '陪你坐了好久，腿有点麻…'],
    sleep: ['Zzz…', '呼…呼…'],
    dream: ['Zzz…（梦到豆子山）', '呼…（蹬腿）', '唔…再睡五分钟…'],
    wake: ['（伸懒腰）', '我睡着的哦？', '啊——睡得好饱'],
    walk: ['散散步~', '巡逻中', '咦，那边有啥'],
    dash: ['冲鸭——', '赶时间！', '咻——', '让一让让一让！'],
    climb: ['壁虎模式！', '咻咻咻往上爬', '看我爬墙绝活'],
    hang: ['（倒挂）嗨~', '看我的绝活！', '血液涌上头了…'],
    gift: ['捡到宝贝！', '给你看我的收藏', '这颗豆子送你！'],
    clone: ['（分身！）', '我不是一个人在战斗！', '影分身之术！'],
    call: ['哎——来啦！', '叫我吗？', '（小跑过来）', '在呢在呢！'],
    cube: ['魔方又乱了…', '转过来…再转过去…', '快好了快好了！'],
    ball: ['拍球时间！', '看我的球技！', '咚、咚、咚'],
    bowl: ['开饭啦！', '一颗一颗吃', '好好吃…'],
    book: ['看书充电中…', '这一页好有意思', '嘘，别打扰我'],
    nap: ['小憩一会儿…', '就眯五分钟…'],
    levelup: ['升级啦！！', '我也变强了！', '一起变厉害！'],
    tierup: ['我们的羁绊变深了！', '（心里暖暖的）', '以后也请多指教！'],
    // 对战胜利：桌宠在桌面上替你欢呼（页面里打完一场会派发 'ci-pet-win'）
    win: ['赢啦！', '这一局漂亮！', '看到没，我很能打的！']
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
    // el 只负责位移；朝向交给翻转层，UI 文本保持正读
    el.style.transform = 'translate3d(' + pos.x + 'px,' + pos.y + 'px,0)';
    if (flipEl) flipEl.style.transform = 'scaleX(' + facing + ')';
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
      // 专注态挂个类：一是不用额外字段就能被探针读到，二是方便 CSS 做「安静」的微调
      el.classList.toggle('ci-pet-focusing', m === 'focus');
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
      // 专注期间不做任何随机动作。
      // 这是「陪伴」和「打扰」的分界线：一只每 20 秒跳一下的宠物，
      // 在你要专心写作业时是噪音，不是陪伴。只保留待机呼吸。
      if (focusOn) { scheduleIdle(); return; }
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
    if (isVideo) { playVideo('原地重力下蹲压缩'); }
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
    // 顶层只做位移；朝向按新结构写在分身的翻转层里，避免 UI 元素跟着镜像
    var twinFlip = twin.querySelector('.ci-pet-flip');
    if (twinFlip) twinFlip.style.transform = 'scaleX(' + (-dir) + ')';
    twin.style.transform = 'translate3d(' + (dir === 1 ? -SIZE : window.innerWidth) + 'px,' + pos.y + 'px,0)';
    document.body.appendChild(twin);
    later(function() {
      twin.style.transform = 'translate3d(' + (dir === 1 ? window.innerWidth + SIZE : -SIZE * 2) + 'px,' + pos.y + 'px,0)';
      twin.style.opacity = '0';
    }, 60);
    later(function() { if (twin.parentNode) twin.parentNode.removeChild(twin); }, 1600);
  }

  function maybeGift() {
    if (Date.now() - lastGift < 2 * 60 * 60 * 1000) return;
    if (Math.random() > 0.5) return;
    lastGift = Date.now();
    say('gift', 1800);
    if (window.__ciPetSfx) window.__ciPetSfx.play('coin');
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
  // extra.food：'feast' 时带豪华大餐（只对 feed 有意义），其余交互不传。
  function reportInteract(type, extra) {
    var api = ctx && ctx.data && ctx.data.api;
    if (!api) return;
    var payload = { type: type };
    if (extra && extra.food) payload.food = extra.food;
    api.post('/pet/interact', payload).then(function(res) {
      var d = (res.data && res.data.data) || {};
      if (d.state) state = d.state;
      if (d.tierUp) later(function() { say('tierup', 2200); confetti(); if (window.__ciPetSfx) window.__ciPetSfx.play('tierup'); }, 900);
      // 回报给宠物屋页面：让它刷新状态条，且自己别再发一次请求（否则撞冷却）
      try {
        window.dispatchEvent(new CustomEvent('ci-pet-fed', {
          detail: { type: type, state: d.state, gained: d.gained || 0, capped: !!d.capped,
                    tierUp: !!d.tierUp,
                    // v0.15.0：把「大成功」和「新心情」一并回报。
                    // 不传的话，页面上的 +10 和 +2 长得一模一样，性格与心情永远只在后端。
                    crit: !!d.crit, mood: d.mood, personality: d.personality }
        }));
      } catch (e) {}
    }, function(err) {
      // 冷却/上限被拒：把服务端给的原因原样回报，别静默吞掉（用户看到的就是"点了没反应"）
      var msg = (err && err.response && err.response.data && err.response.data.message) || '互动失败';
      try {
        window.dispatchEvent(new CustomEvent('ci-pet-fed', {
          detail: { type: type, gained: 0, capped: true, message: msg }
        }));
      } catch (e) {}
      say('sad', 1800);
    });
  }

  function poke(e) {
    if (mode === 'sleep') { wake(); reportInteract('poke'); return; }
    if (isVideo && poolsV && poolsV.clicks && poolsV.clicks.length) {
      lastInteract = Date.now();
      say('poke', 1500);          // 视频形态以前只播动画不说话，戳上去像在戳石头
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
      if (window.__ciPetSfx) window.__ciPetSfx.play('poke');
      bubbleSay(pick(LINES.pat), 1600);
    } else {
      anim('ci-pet-wiggle', 550);
      say('tickle', 1500);
    }
    reportInteract('poke');
  }

  function feed(food) {
    if (!el) return;
    wake('silent');
    var feast = food === 'feast';
    heart(feast ? 5 : 3);
    say(feast ? 'feast' : 'feed', 1800);
    if (window.__ciPetSfx) window.__ciPetSfx.play(feast ? 'tierup' : 'feed');
    // 大餐给一个「更贵」的动作：普通饭是白饭，大餐是大闸蟹。
    // 桌宠的反馈必须让玩家一眼看出「这 5 条小鱼干花得值」。
    if (isVideo) { playVideo(feast ? '吃大闸蟹' : '吃白饭'); } else { anim('ci-pet-hop', 700); }
    reportInteract('feed', { food: food });
  }

  function celebrateLevel(level) {
    confetti();
    if (window.__ciPetSfx) window.__ciPetSfx.play('levelup');
    if (isVideo) playVideo('可爱宅舞');
    anim('ci-pet-hop', 700);
    later(function() { anim('ci-pet-hop', 700); }, 750);
    bubbleSay(pick(LINES.levelup) + (level ? ' Lv' + level : ''), 2400);
  }

  // ---- 专注模式（v0.11.0）----
  // 只做三件事：停随机调度、放一个安静待机、结束时报个信。
  // 不做倒计时气泡：真正的倒计时在宠物屋页面上，桌宠脑袋上再挂一个数字，
  // 就成了「换了皮的计时器」，反而提醒你去盯时间。
  function enterFocus(minutes) {
    if (!el) return;
    focusOn = true;
    lastInteract = Date.now();
    if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
    setMode('focus');
    heart(1);
    say('focus', 2600);
    if (window.__ciPetSfx) window.__ciPetSfx.play('focus-start');
    if (isVideo) playVideo('原地小憩沉眠', true);
  }

  function exitFocus(done) {
    focusOn = false;
    if (mode === 'focus') setMode('idle');
    lastInteract = Date.now();
    if (done) {
      heart(4);
      say('focusEnd', 2200);
      if (window.__ciPetSfx) window.__ciPetSfx.play('focus-end');
      later(function() { confetti(); }, 420);
    }
    scheduleIdle();
  }

  // 宠物屋「呼唤」：悬浮桌宠就在应用页面之上，当场应一声可见可感
  function callPet() {
    if (!el) return;
    wake('silent');
    heart(2);
    say('call', 1900);
    if (window.__ciPetSfx) window.__ciPetSfx.play('open');
    if (isVideo && poolsV && poolsV.clicks && poolsV.clicks.length) playVideo(pick(poolsV.clicks));
    reportInteract('poke');
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
  // 视频几何：素材规范里人物在 16:9 画幅内约占 水平 30%~70%、垂直 20%~85%，
  // el 表示"人物包围盒"而非画幅 → 视频放大 2.5x 把人物区域对齐到 el。
  // 双缓冲的两个元素必须共用同一套几何，否则交换时会看起来"跳一下"。
  function applyVideoGeom(v) {
    if (!v) return;
    v.style.position = 'absolute';
    v.style.width = '250%';       // 1 / 0.4
    v.style.height = '153.85%';   // 1 / 0.65
    v.style.left = '-75%';        // -(30% × 2.5)
    v.style.top = '-30.77%';      // -(20% × 1.5385)
    v.style.transform = 'none';
  }
  function fitVideo() {
    var vh2 = Number(window.innerHeight) || 787;
    var videoVH = Math.max(180, Math.min(330, Math.round(vh2 * 0.34)));
    var videoVW = Math.round(videoVH * 16 / 9);
    el.style.width = Math.round(videoVW * 0.4) + 'px';
    el.style.height = Math.round(videoVH * 0.65) + 'px';
    applyVideoGeom(videoEl);
    applyVideoGeom(videoEl2);
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
  // 开跑：幕布在下方垫着，video 盖在上面。
  // 这样"撤幕布"不是把幕布变透明，而是让 video 显形 —— 只要 video 没帧，露出的是幕布。
  var currentAnim = ''; // 当前动作名
  function poolUrl(name) {
    return '/market-static/pet/assets/webm/' + encodeURIComponent(name) + '.webm';
  }

  // ---- 切换防闪幕布 ----
  // 病根：直接改 video.src 会让媒体元素进入 load 算法，渲染退化成"空白/透明"，
  //       直到新素材首帧解码完成 —— 那一两帧到几百毫秒的空窗就是"切换时闪一下"。
  // 解法：换源前把当前帧 drawImage 到一张 canvas 幕布上盖住 video，
  //       等新素材 loadeddata/playing（已握有首帧）再撤幕布。全程屏幕上都有像素。
  //
  // ⚠️ 2026-10-26 连点闪烁修复：幕布必须「持久保留最后一张好帧」。
  //    连点时新动作常在上一次换源还没解码完时被请求，此刻 videoWidth=0，
  //    drawImage 拿不到像素 —— 旧实现此时静默 return，video.style.opacity 仍是 '1'，
  //    于是视频图层裸露在 readyState<2 的空白态 = 闪一下。
  //    现在：快照失败也照样把幕布盖上（用上一张留存的好帧），绝不裸露。
  //    幕布有帧记忆（hasFrame），不是每次都要现抓。
  var hasFrame = false;
  var lastFreezeAt = 0;
  var lastSwitchAt = 0;        // 上次真正换源的时间（连点冷却用）
  var pendingAnim = null;      // 冷却期里排队的最新动作
  var pendingTimer = null;

  function ensureFreeze() {
    if (freezeEl && freezeEl.parentNode === body && document.body.contains(freezeEl)) return freezeEl;
    if (freezeEl && freezeEl.parentNode) { try { freezeEl.parentNode.removeChild(freezeEl); } catch (e) {} }
    freezeEl = document.createElement('canvas');
    freezeEl.className = 'ci-pet-freeze';
    hasFrame = false;
    if (body) body.appendChild(freezeEl);
    return freezeEl;
  }

  // 抓当前帧进幕布。返回 true = 幕布上有可用像素。
  function captureFrame() {
    if (!isVideo || !videoEl || !body) return false;
    var vw = videoEl.videoWidth, vh = videoEl.videoHeight;
    if (!vw || !vh || videoEl.readyState < 2) return false;   // 没数据，抓不到
    var c = ensureFreeze();
    if (c.width !== vw || c.height !== vh) { c.width = vw; c.height = vh; hasFrame = false; }
    try {
      var g = c.getContext('2d');
      g.clearRect(0, 0, vw, vh);
      g.drawImage(videoEl, 0, 0, vw, vh);
    } catch (e) { return false; }
    hasFrame = true;
    lastFreezeAt = Date.now();
    syncFreezeGeometry(c);
    return true;
  }

  // 幕布几何必须与 video 完全一致（fitVideo 用百分比内联值，包含块相同 → 照抄即可）
  function syncFreezeGeometry(c) {
    if (!c || !videoEl) return;
    c.style.position = 'absolute';
    c.style.width = videoEl.style.width;
    c.style.height = videoEl.style.height;
    c.style.left = videoEl.style.left;
    c.style.top = videoEl.style.top;
  }

  // ⚠️ 2026-10-26 补：抓不到帧时，旧实现直接 return false = 放弃遮挡 = 裸露。
  //    桌面 Chrome 解码快所以抓得到；校园平板（Chrome 80 WebView）解码慢，
  //    readyState 常停在 0/1，抓帧必失败 —— 这正是"探针全绿但真机还在闪"的根因。
  //    现在分三级兜底，保证幕布上永远有像素：
  //      1) 本次能抓 → 用新帧
  //      2) 抓不到但留过好帧 → 复用留存帧
  //      3) 连留存帧都没有（刚挂载/首帧未到）→ 画一张中性占位底图
  function drawPlaceholder(c) {
    var w = c.width || 300, h = c.height || 200;
    var g = c.getContext('2d');
    g.clearRect(0, 0, w, h);
    // 柔和的圆形剪影，颜色取当前主题的次级文字色，任何背景下都不刺眼
    g.fillStyle = 'rgba(255,255,255,0.16)';
    g.beginPath();
    g.arc(w / 2, h * 0.46, Math.min(w, h) * 0.26, 0, Math.PI * 2);
    g.fill();
    g.beginPath();
    g.ellipse(w / 2, h * 0.82, Math.min(w, h) * 0.22, Math.min(w, h) * 0.09, 0, 0, Math.PI * 2);
    g.fill();
  }

  // 换源瞬间调用：无论如何把幕布盖上（抓帧失败也盖，用留存帧或占位图）
  function freezeFrame() {
    if (!isVideo || !videoEl || !body) return false;
    var c = ensureFreeze();
    var got = captureFrame();
    if (!got && !hasFrame) {
      // 首帧都还没有：至少保证几何正确，再画占位底图
      if (!c.width) { c.width = 300; c.height = 200; }
      syncFreezeGeometry(c);
      drawPlaceholder(c);
      hasFrame = true;              // 占位图算"有像素"，后续可安全复用
    } else if (!got) {
      syncFreezeGeometry(c);        // 有留存帧：仅同步几何，像素保持上次好帧
    }
    c.style.opacity = '1';
    c.style.zIndex = '3';           // 压在 video 上方 = 遮挡中
    return true;
  }

  // 就绪后把幕布降回 video 之下（内容保留，下次换源还能当"留存帧"用）
  function revealVideo() {
    revealToken++; // 让尚未落地的兜底计时失效
    if (freezeEl) { freezeEl.style.zIndex = '1'; freezeEl.style.opacity = '0'; }
  }

  // 首帧就绪即撤幕布；兜底按时长重试，不当"到点就撤"用
  function armReveal() {
    var my = ++revealToken;
    function ready() {
      return !!(videoEl && videoEl.readyState >= 3 && videoEl.videoWidth > 0);
    }
    function once() {
      if (my !== revealToken) return;
      if (!ready()) return;             // 还没好，继续等（别裸露）
      revealToken++;
      if (videoEl) {
        videoEl.removeEventListener('loadeddata', once);
        videoEl.removeEventListener('playing', once);
        videoEl.removeEventListener('timeupdate', once);
      }
      revealVideo();
    }
    if (videoEl) {
      videoEl.addEventListener('loadeddata', once);
      videoEl.addEventListener('playing', once);
      // timeupdate：真正在解码推进时才代表有可用帧（hover 到 readyState=1 的那种假就绪不会触发）
      videoEl.addEventListener('timeupdate', once);
    }
    // 兜底：每 100ms 检查一次，最长守 2.5s。素材缺失时由 error 事件接管回落。
    var tries = 0;
    (function watchdog() {
      if (my !== revealToken) return;
      if (ready()) { once(); return; }
      if (++tries > 25) { once(); return; }
      later(watchdog, 100);
    })();
  }

  // ---- 换源：双缓冲（2026-10-27）----
  // 为什么彻底废掉 canvas 幕布：
  //   幕布的本质是「遮住空白」，不是「消除空白」。只要画面来自那个正在换 src 的元素，
  //   就必然有一段没有帧的窗口。真机（Chrome 80 WebView）解码慢，抓帧必然失败，
  //   三级兜底最后只能画占位剪影 —— 用户看到「宠物 → 白圈 → 宠物」，那还是闪。
  // 现在：两台 video 前后台分工。前台一直在正常播放（画面从未中断），
  //   新素材在后台静默装载并 play()，等它真正握有可播帧后原子交换 —— 空白帧不存在。
  function makeVideoEl() {
    var v = document.createElement('video');
    v.className = 'ci-pet-video';
    v.muted = true;
    v.setAttribute('playsinline', 'playsinline');
    v.setAttribute('webkit-playsinline', 'webkit-playsinline');
    v.style.pointerEvents = 'none';
    v.addEventListener('ended', onVideoEnded);
    v.addEventListener('error', onVideoError);
    return v;
  }

  function playVideo(name, loop) {
    if (!videoEl || !name) return;
    if (failedAnims[name]) name = idleName(); // 素材缺失：回落到待机，别再闪一次
    var url = poolUrl(name);

    // 前台就是这个源：续播 / 重播，一个元素都不动（零空窗）
    if (name === currentAnim && videoEl.getAttribute('src') === url) {
      if (videoEl.paused || videoEl.ended) {
        try { videoEl.currentTime = 0; } catch (e) {}
        var p0 = videoEl.play();
        if (p0 && p0.catch) p0.catch(function() {});
      }
      return;
    }

    // 后台还在装上一个请求：只记最新意图，装完立刻接手（连点不雪崩）
    if (swapping) { pendingAnim = { name: name, loop: !!loop }; return; }
    startSwap(name, url, !!loop);
  }

  function startSwap(name, url, loop) {
    if (!videoEl || !videoEl2) return;
    var back = videoEl2;
    var my = ++swapToken;
    swapping = true;
    swapPrevAnim = currentAnim;
    currentAnim = name;
    lastSwitchAt = Date.now();

    back.loop = loop;
    // 必须 removeAttribute：同 URL 不清 src，浏览器会认为没变，卡在末帧
    back.removeAttribute('src');
    back.src = url;
    var pr = back.play();
    if (pr && pr.catch) pr.catch(function() {});

    var tries = 0;
    (function waitFrame() {
      if (my !== swapToken) return;
      // readyState >= 3（HAVE_FUTURE_DATA）：不仅握有当前帧，还够继续播 → 切过去不会立刻卡住
      if (back.readyState >= 3 && back.videoWidth > 0) { commit(); return; }
      if (++tries <= 36) { later(waitFrame, 100); return; }
      // 3.6s 还没就绪：素材有问题。宁可留在旧动作上，也不要把空白推上屏。
      if (back.readyState < 2 || !back.videoWidth) {
        if (name) failedAnims[name] = 1;
        currentAnim = swapPrevAnim;
        swapping = false;
        try { back.pause(); } catch (e) {}
        try { videoEl.play(); } catch (e2) {}
        return;
      }
      commit();
    })();

    function commit() {
      if (my !== swapToken) return;
      // 双 rAF：让后台元素在被「看见」之前先完成一帧光栅化。
      // 交换本身只改 z-index/opacity，浏览器下一帧统一合成 → 原子，不会出现半张脸。
      var raf = window.requestAnimationFrame || function(f) { return setTimeout(f, 16); };
      raf(function() {
        raf(function() {
          if (my !== swapToken) return;
          var old = videoEl;
          back.style.zIndex = '2';
          back.style.opacity = '1';
          videoEl = back;
          videoEl2 = old;
          old.style.zIndex = '1';
          // 用 0.001 而非 0：完全不透明会被「不可见就别解码」的优化盯上，后台就不再备料了
          old.style.opacity = '0.001';
          swapping = false;
          // 换下来的元素稍后才停：确保合成器已完成这次交换
          later(function() {
            if (old === videoEl) return;     // 它又被换回来了，别停
            try { old.pause(); } catch (e) {}
          }, 160);
          var p = pendingAnim;
          pendingAnim = null;
          if (p && isVideo) startSwap(p.name, poolUrl(p.name), p.loop);
        });
      });
    }
  }

  // 素材拉取失败：撤幕布 + 记黑，避免"白 box 卡住 + 反复重试"
  function onVideoError(e) {
    if (!isVideo || !videoEl) return;
    // 后台装料失败：前台还在正常演，别撤幕布也别打断它，安静退回原动作
    if (e && e.target && e.target !== videoEl) {
      if (currentAnim) failedAnims[currentAnim] = 1;
      currentAnim = swapPrevAnim;
      swapping = false;
      var p = pendingAnim;
      pendingAnim = null;
      if (p && !failedAnims[p.name]) {
        later(function() { startSwap(p.name, poolUrl(p.name), p.loop); }, 120);
      }
      return;
    }
    if (currentAnim) failedAnims[currentAnim] = 1;
    revealVideo();
    if (currentAnim !== idleName()) {
      currentAnim = '';
      later(function() { playVideo(idleName()); }, 120);
    }
  }
  function onVideoEnded(e) {
    if (!isVideo || !videoEl) return;
    // 只有前台元素播完才算数：后台是被换下来的，它的 ended 不该触发换动作
    if (e && e.target && e.target !== videoEl) return;
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
    flipEl = document.createElement('div');
    flipEl.className = 'ci-pet-flip';
    el.appendChild(flipEl);
    if (isVideo) {
      // 视频形态同样创建 body 容器：拖拽倾斜（body.style.transform）与松手清倾斜都读写它，
      // 缺了 body 会在每次 pointermove/释放时抛 TypeError（真机日志实锤）
      body = document.createElement('div');
      body.className = 'ci-pet-body';
      body.style.width = '100%';
      body.style.height = '100%';
      flipEl.appendChild(body);
      // 双缓冲：先挂后台、再挂前台（DOM 顺序 + z-index 双保险，前台永远在最上面）
      videoEl2 = makeVideoEl();
      body.appendChild(videoEl2);
      videoEl = makeVideoEl();
      body.appendChild(videoEl);
      el.classList.add('ci-pet--video');
      fitVideo();
      videoEl.style.zIndex = '2';
      videoEl.style.opacity = '1';
      videoEl2.style.zIndex = '1';
      videoEl2.style.opacity = '0.001';
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
    flipEl.appendChild(body);
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
    if (videoEl2) { try { videoEl2.pause(); videoEl2.removeAttribute('src'); } catch (e) {} }
    videoEl = null; videoEl2 = null;
    swapping = false; swapToken++; swapPrevAnim = ''; pendingAnim = null;
    isVideo = false; builtVisual = null;
    el = null; bubble = null; canvas = null; body = null; flipEl = null;
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
      // 专注中不睡：它正在「陪你」，切个后台就趴下睡觉，回来看到会很出戏。
      if (!focusOn && mode !== 'sleep') setMode('sleep');
    } else {
      wake('silent');
    }
  }

  function mount(container, context) {
    ctx = context;
    storage = context && context.data && context.data.storage;
    realtime = context && context.data && context.data.realtime;
    // ⚠️ 注册与移除必须用同一个函数引用：之前 feed 的是匿名包装、移除的是裸 feed，
    //    removeEventListener 静默失效，事件监听跨挂载周期累积。
    var onFeedEvent = function(e) { feed(e && e.detail && e.detail.food); };
    // 专注：页面只负责计时与结算，桌面这只负责「安静地陪着」。
    // 两个世界通过事件解耦，桌宠被关掉时页面逻辑照样成立（只是没有陪伴表现）。
    var onFocusStart = function(e) { enterFocus(e && e.detail && e.detail.minutes); };
    var onFocusEnd = function(e) { exitFocus(!!(e && e.detail && e.detail.done)); };
    var onPokeEvent = function() { poke(null); };
    var onCallEvent = function() { callPet(); };
    // 对战胜利：页面（entry.js）结算完派发，桌面这只跟着欢呼一下。
    // 只做表现，不碰任何数值——战报结算全在服务端。
    var onWinEvent = function() {
      say('win', 2200);
      if (window.__ciPetSfx) window.__ciPetSfx.play('battle-win');
      later(function() { confetti(); }, 260);
    };
    var onTierupEvent = function() {
      say('tierup', 2000);
      if (window.__ciPetSfx) window.__ciPetSfx.play('tierup');
      later(function() { confetti(); }, 200);
    };
    var onWishEvent = function() {
      say('poke', 1600);
      if (window.__ciPetSfx) window.__ciPetSfx.play('poke');
    };
    window.addEventListener('ci-pet-state-changed', onPetChanged);
    window.addEventListener('ci-pet-feed', onFeedEvent);
    window.addEventListener('ci-pet-poke', onPokeEvent);
    window.addEventListener('ci-pet-call', onCallEvent);
    window.addEventListener('ci-pet-win', onWinEvent);
    window.addEventListener('ci-pet-tierup', onTierupEvent);
    window.addEventListener('ci-pet-wish', onWishEvent);
    window.addEventListener('ci-pet-focus-start', onFocusStart);
    window.addEventListener('ci-pet-focus-end', onFocusEnd);
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
        window.removeEventListener('ci-pet-feed', onFeedEvent);
        window.removeEventListener('ci-pet-poke', onPokeEvent);
        window.removeEventListener('ci-pet-call', onCallEvent);
        window.removeEventListener('ci-pet-win', onWinEvent);
        window.removeEventListener('ci-pet-tierup', onTierupEvent);
        window.removeEventListener('ci-pet-wish', onWishEvent);
        window.removeEventListener('ci-pet-focus-start', onFocusStart);
        window.removeEventListener('ci-pet-focus-end', onFocusEnd);
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
      focusOn: focusOn,
      bond: state ? (state.bond || 0) : null,
      bondTier: bondTier(),
      kills: kills,
      level: levelInfo ? levelInfo.level : null,
      lastError: lastError || '',
      pos: { x: pos.x, y: pos.y },
      // 双缓冲可观测性（探针与真机排查都靠这几项）
      anim: currentAnim,
      swapping: swapping,
      frontReady: videoEl ? videoEl.readyState : -1,
      backReady: videoEl2 ? videoEl2.readyState : -1,
      frontSrc: videoEl ? String(videoEl.getAttribute('src') || '').split('/').pop() : '',
      backSrc: videoEl2 ? String(videoEl2.getAttribute('src') || '').split('/').pop() : '',
      frontZ: videoEl ? videoEl.style.zIndex : '',
      backZ: videoEl2 ? videoEl2.style.zIndex : ''
    };
  };

  // 测试钩子（探针用）：直接触发 poke
  window.__ciPetPoke = function() { poke({ clientY: 0 }); }

  var definition = { name: NAME, mount: mount, unmount: unmount };
  if (window.ClassIntraMarket && typeof window.ClassIntraMarket.defineOverlay === 'function') {
    window.ClassIntraMarket.defineOverlay(definition);
  }
})();
