// backend/render.js
// 按需无头渲染引擎（兼容模式）。
//
// 用途：少数站点（腾讯/网易等 WAF）会返回 JS 挑战页，纯静态改写无法通过；
// 这里用系统已安装的 Edge/Chrome 以 headless 方式真实执行页面脚本，
// 再把渲染结果以 screencast 帧流推给前端 canvas，并把用户输入回灌给浏览器。
//
// 设计取舍：
//   - 复用系统浏览器，不下载任何 Chromium（零额外体积）；不引入新依赖（ws 已在 server 依赖中）
//   - 每个账号一个独立浏览器 profile（Cookie / 登录态互不串号），账号内多标签页会话；
//     会话总数仍有上限（默认 3），超限直接拒绝而不是排队卡死
//   - 某账号无会话空闲 90 秒后自动杀掉对应浏览器进程，回收约 500MB 内存
//   - 该模式是「少数站点兜底」，不作为默认浏览方式
//
// 代码风格遵循 ClassIntra 约定：var / function / 单引号 / 2 空格缩进。

var cp = require('child_process');
var fs = require('fs');
var os = require('os');
var path = require('path');
var WS = require('ws');

// 兼容模式的「可使用者」与登录校验：WS 握手在独立端口上，不经过 express 中间件，
// 因此这里自行验 token 并按白名单判断是否放行。
var access = require('./access');
var jwtUtil = require('../../../server/src/utils/jwt');

// 系统浏览器候选路径（Windows 常见安装位置）
var BROWSER_PATHS = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
];

var MAX_SESSIONS = 3;              // 同时存活的渲染会话上限（实测单浏览器约 1.8GB）
// 无会话时尽快回收渲染浏览器（约 500MB 常驻）：兼容模式是兜底功能，冷启动 2–3 秒可接受，
// 让内存和后台进程尽早归还给宿主，而不是白白挂 5 分钟。
var IDLE_KILL_MS = 90 * 1000;
var SESSION_IDLE_MS = 3 * 60 * 1000; // 单会话无操作多久后回收
var VIEW_WIDTH = 1280;
var VIEW_HEIGHT = 800;
var MIN_WIDTH = 320;
var MAX_WIDTH = 1600;
var MIN_HEIGHT = 320;
var MAX_HEIGHT = 1200;
var MAX_DPR = 2;
// 兼容模式双指缩放倍率范围（页面缩放，与浏览器 Ctrl+滚轮同一套机制）。
// 下限取 1：无头环境里 setPageScaleFactor 低于 1 会被浏览器夹回 1，
// 若不在本地同步夹紧，前端记录的状态就会与真实画面脱节。
var PINCH_MIN_SCALE = 1;
var PINCH_MAX_SCALE = 3;
var SCREENCAST_QUALITY = 55;

// 云游戏画质模式：以画质 / 流畅度优先（高分辨率、高码率、恒 60fps），
// 适合串流游戏与视频。代价是编码 CPU 与带宽明显上升，网络差时反而更卡，
// 因此只在用户显式打开时启用，且不参与自适应降档。
var GAME_QUALITY = 92;                 // JPEG 质量（普通模式 55）
var GAME_MAX_DPR = 3;                  // 允许按设备真实像素密度渲染（普通模式上限 2）
var GAME_MAX_WIDTH = 3840;             // 帧流编码上限（超出时等比缩小，避免超大帧撑爆内存）
var GAME_MAX_HEIGHT = 2160;
var GAME_FRAME_MAX_BUFFER = 6 * 1024 * 1024; // 高码率帧更大，给更多在途空间

// 音频回传：页面内采集脚本把 24kHz 单声道 PCM（base64）经 Runtime.addBinding 送回。
// 24kHz 比 16kHz 保留更多高频细节（音乐 / 人声更自然），每包约 43ms，延迟更低。
// 客户端发送缓冲积压时直接丢音频包，避免声音把画面帧挤在队列里。
var AUDIO_RATE = 24000;
var AUDIO_MAX_BUFFER = 2 * 1024 * 1024;
// 画面帧积压上限：超过说明客户端解码 / 网络跟不上，直接丢弃当前帧（仍回 ACK 让浏览器继续渲染），
// 避免旧帧在服务端内存里排队，造成「越看延迟越大」。
var FRAME_MAX_BUFFER = 1.5 * 1024 * 1024;
// 触摸会话的积压上限更小：手指滑动时屏幕内容变化大、帧也大，
// 队列一旦堆到 1MB 以上用户看到的就是「几秒前的画面」，主观感受就是卡住。
// 宁可丢掉中段帧，也要保证最新一帧尽快到达。
var FRAME_MAX_BUFFER_TOUCH = 700 * 1024;
// 自适应画质档位：弱网 / 低端手机上持续丢帧时自动降画质，
// 稳定一段时间后再逐档回升。帧率不在这里控制——见下面的「按需帧率」。
var QUALITY_LEVELS = [
  { quality: SCREENCAST_QUALITY },
  { quality: 48 },
  { quality: 40 }
];
// 按需帧率：用户操作期间跑满 60fps（滑动跟手），静置 1.5 秒后降到 30fps。
// 页面自播动画 / 视频在没人碰时不需要 60fps；这一档能实打实省掉约一半的编码 CPU 与带宽。
var ACTIVE_EVERY_NTH = 1;
var IDLE_EVERY_NTH = 2;
var ACTIVE_BOOST_MS = 1500;
// 媒体检测：在播时把高帧率窗口续到 5 秒，每 3 秒复查一次
var MEDIA_CHECK_MS = 3000;
var MEDIA_KEEP_MS = 5000;
var ADAPT_WINDOW_MS = 2000;    // 观察窗口长度
var ADAPT_DROP_RATIO = 0.25;   // 窗口内丢帧占比达到该值就降一档
var ADAPT_UPGRADE_MS = 12000;  // 连续多久不丢帧后回升一档

var AUDIO_INJECT = '';
try {
  AUDIO_INJECT = fs.readFileSync(path.join(__dirname, 'audio-inject.js'), 'utf8');
} catch (e) {
  AUDIO_INJECT = '';
}

// 移动端 UA：与触摸仿真、窄视口配合，让站点返回移动版布局而不是被强行塞进桌面版
var MOBILE_UA = 'Mozilla/5.0 (Linux; Android 12; Pixel 5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';

// 每个账号一份独立的浏览器 profile：站点 Cookie / 登录态 / 本地存储互不串号。
// 同一账号的多个会话共用一个浏览器进程（多标签页），不同账号各起一个。
// 兼容模式是兜底功能，同时保留的实例数设上限，超出时优先回收没有会话的实例。
var MAX_PROFILES = 3;
var GUEST_KEY = 'guest';
var PROFILE_ROOT = path.join(os.tmpdir(), 'classintra-render-profile');

var state = {
  sessions: {},
  seq: 0,
  lastError: ''
};

// key -> profile；profile 结构见 createProfile()
var profiles = {};

function profileKeyOf(uid) {
  var s = String(uid || '').replace(/[^0-9a-zA-Z_-]/g, '').substring(0, 40);
  return s ? 'u' + s : GUEST_KEY;
}

// 未登录 / 老版本客户端不带 uid 时沿用旧目录名，避免已有的登录态作废
function profileDirOf(key) {
  return key === GUEST_KEY ? PROFILE_ROOT : PROFILE_ROOT + '-' + key;
}

function createProfile(key) {
  var dir = profileDirOf(key);
  return {
    key: key,
    dir: dir,
    // 浏览器把 DevTools 端口写在该文件里（首行端口、次行 ws 路径），
    // 比解析 stderr 更可靠：新版 Edge/Chrome 会把启动请求转交给子进程，stderr 不再输出。
    portFile: path.join(dir, 'DevToolsActivePort'),
    proc: null,
    cdpUrl: '',
    cdp: null,
    starting: null,
    idleTimer: null,
    lastError: '',
    lastUsedAt: Date.now()
  };
}

function getProfile(key) {
  if (!profiles[key]) profiles[key] = createProfile(key);
  return profiles[key];
}

function profileSessionCount(profile) {
  var n = 0;
  Object.keys(state.sessions).forEach(function (id) {
    if (state.sessions[id].profile === profile) n++;
  });
  return n;
}

function findBrowser() {
  for (var i = 0; i < BROWSER_PATHS.length; i++) {
    try {
      if (fs.existsSync(BROWSER_PATHS[i])) return BROWSER_PATHS[i];
    } catch (e) {}
  }
  return '';
}

// ---- 极简 CDP 客户端（只实现本项目用到的部分）----

function CdpClient(url) {
  var self = this;
  self.ws = new WS(url, { perMessageDeflate: false, maxPayload: 64 * 1024 * 1024 });
  self.nextId = 1;
  self.pending = {};
  self.listeners = [];
  self.closed = false;
  self.ws.on('message', function (raw) {
    var msg;
    try { msg = JSON.parse(String(raw)); } catch (e) { return; }
    if (msg.id && self.pending[msg.id]) {
      var p = self.pending[msg.id];
      delete self.pending[msg.id];
      if (msg.error) p.reject(new Error(msg.error.message || 'CDP 错误'));
      else p.resolve(msg.result || {});
      return;
    }
    if (msg.method) {
      for (var i = 0; i < self.listeners.length; i++) {
        try { self.listeners[i](msg.method, msg.params || {}, msg.sessionId || ''); } catch (e) {}
      }
    }
  });
  // CDP 通道刚创建时处于 CONNECTING，此时直接 send 会被 ws 抛错。
  // 用 ready 承诺把早期调用排队，等握手完成后再真正发出。
  self.ready = new Promise(function (resolve, reject) {
    self.ws.once('open', function () { resolve(); });
    self.ws.once('error', function (e) { reject(e); });
  });
  self.ready.catch(function () {});

  self.ws.on('close', function () {
    self.closed = true;
    for (var id in self.pending) {
      try { self.pending[id].reject(new Error('CDP 连接已关闭')); } catch (e) {}
    }
    self.pending = {};
  });
  self.ws.on('error', function () {});
}

CdpClient.prototype.send = function (method, params, sessionId) {
  var self = this;
  return self.ready.then(function () {
    return new Promise(function (resolve, reject) {
      if (self.closed) return reject(new Error('CDP 连接已关闭'));
      var id = self.nextId++;
      var payload = { id: id, method: method, params: params || {} };
      if (sessionId) payload.sessionId = sessionId;
      self.pending[id] = { resolve: resolve, reject: reject };
      try {
        self.ws.send(JSON.stringify(payload));
      } catch (e) {
        delete self.pending[id];
        reject(e);
      }
    });
  });
};

CdpClient.prototype.on = function (fn) {
  this.listeners.push(fn);
};

CdpClient.prototype.close = function () {
  try { this.ws.close(); } catch (e) {}
};

// ---- 浏览器进程管理 ----

// 先复用该账号上一轮遗留但仍活着的渲染浏览器（pm2 重启、异常退出时常见）：
// 旧实例占着 profile 时，新实例只会「转交启动」然后立刻退出，端口文件也不再刷新，
// 表现就是兼容模式一直连不上。这里按端口文件探活，探活失败才冷启动。
function ensureBrowser(profile, cb) {
  if (profile.cdp && !profile.cdp.closed) return cb(null, profile.cdp);
  if (profile.starting) {
    profile.starting.push(cb);
    return;
  }
  profile.starting = [cb];

  var exe = findBrowser();
  if (!exe) {
    profile.lastError = '未找到系统 Edge / Chrome，无法启用兼容模式';
    state.lastError = profile.lastError;
    failStarting(profile, new Error(profile.lastError));
    return;
  }

  trimProfiles(profile.key);
  var existing = readPortUrl(profile.portFile);
  if (!existing) return launchBrowser(exe, profile);

  var probe = new CdpClient(existing);
  var settled = false;
  var timer = setTimeout(function () {
    if (settled) return;
    settled = true;
    try { probe.close(); } catch (e) {}
    try { fs.unlinkSync(profile.portFile); } catch (e) {}
    launchBrowser(exe, profile);
  }, 2000);
  probe.send('Browser.getVersion', {}).then(function () {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    profile.cdpUrl = existing;
    profile.cdp = probe;
    profile.lastError = '';
    probe.on(dispatchListener(profile));
    scheduleIdleKill(profile);
    console.log('[web-proxy] 兼容模式复用已有浏览器[' + profile.key + ']: ' + existing);
    resolveStarting(profile, null, probe);
  }, function () {
    // 连接失败由上面的定时器统一兜底
  });
}

// 每个 profile 的 CDP 事件监听器（事件里同时带上 profile 归属，便于选择正确的连接）
function dispatchListener(profile) {
  return function (method, params, cdpSessionId) {
    dispatchEvent(profile, method, params, cdpSessionId);
  };
}

function failStarting(profile, err) {
  var waiting = profile.starting || [];
  profile.starting = null;
  waiting.forEach(function (fn) { fn(err); });
}

function resolveStarting(profile, err, client) {
  var waiting = profile.starting || [];
  profile.starting = null;
  waiting.forEach(function (fn) { fn(err, client); });
}

function readPortUrl(portFile) {
  var text = '';
  try { text = fs.readFileSync(portFile, 'utf8'); } catch (e) { return ''; }
  var lines = String(text).split(/\r?\n/);
  var port = parseInt(lines[0], 10);
  var wsPath = (lines[1] || '').trim();
  if (!port || !wsPath) return '';
  return 'ws://127.0.0.1:' + port + wsPath;
}

function launchBrowser(exe, profile) {
  try { fs.mkdirSync(profile.dir, { recursive: true }); } catch (e) {}
  // 清掉残留的端口文件：否则可能连到一个已经退出的浏览器端口
  try { fs.unlinkSync(profile.portFile); } catch (e) {}

  var args = [
    '--headless=new',
    // 不再强制关闭 GPU：headless=new 支持 GPU 合成，滚动 / 动画的合成由 GPU 完成，
    // 明显更顺滑；显卡驱动不可用时 Chromium 会自动回退软件渲染，不会启动失败。
    '--force-color-profile=srgb',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--disable-background-networking',
    // 放开自动播放，避免页面脚本创建的音频上下文被手势策略挂起。
    // --disable-web-security：跨域媒体（CDN 音源）默认在 Web Audio 里会被判为
    // 「受污染」而输出静音，关掉同源策略后才能采集。渲染浏览器使用独立的临时
    // profile，与用户真实浏览器完全隔离，风险仅限于该兜底模式内部（见 README 安全说明）。
    '--autoplay-policy=no-user-gesture-required',
    '--disable-web-security',
    // 老师机保持静音：页面声音只经采集管道回传给学生的手机，不落到宿主机扬声器。
    // 静音改由页面内的 audio-inject 完成（媒体元素强制 muted、WebAudio 出口接 0 增益），
    // 这里刻意不再传 --mute-audio：该参数会让 Chromium 以「静音会话」占用系统音频端点，
    // 在部分 Windows 驱动 / 蓝牙耳机上会把整台电脑的音频一起拉哑（用户反馈过该故障）。
    '--hide-scrollbars',
    // 多个渲染标签页共存时，后台标签会被节流 / 停止合成，
    // 表现为「画面停在上一帧、手指滑不动」；这三个开关保证每个会话都持续渲染。
    '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    '--remote-debugging-port=0',
    // 账号隔离的关键：每个账号使用自己的用户数据目录，Cookie / 登录态互不可见
    '--user-data-dir=' + profile.dir,
    '--window-size=' + VIEW_WIDTH + ',' + VIEW_HEIGHT,
    'about:blank'
  ];

  var proc = cp.spawn(exe, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  profile.proc = proc;

  var resolved = false;
  var output = '';
  var portFile = profile.portFile;

  function finish(err, cdpUrl) {
    if (resolved) return;
    resolved = true;
    clearPortPoll();
    if (err) {
      profile.lastError = err.message;
      state.lastError = err.message;
      console.log('[web-proxy] 兼容模式浏览器启动失败[' + profile.key + ']: ' + err.message);
      failStarting(profile, err);
      return;
    }
    profile.cdpUrl = cdpUrl;
    profile.lastError = '';
    console.log('[web-proxy] 兼容模式浏览器就绪[' + profile.key + ']: ' + cdpUrl);
    var client = new CdpClient(cdpUrl);
    profile.cdp = client;
    client.on(dispatchListener(profile));
    try { proc.stdout.resume(); } catch (e) {}
    scheduleIdleKill(profile);
    resolveStarting(profile, null, client);
  }

  function onData(chunk) {
    output += String(chunk);
    var m = /DevTools listening on (ws:\/\/\S+)/.exec(output);
    if (m) finish(null, m[1]);
  }

  // 已有 Edge 后台实例时，启动器会把请求转交出去并立即退出（code 0），
  // 真正的无头浏览器作为独立进程继续运行，DevTools 地址只写进 profile 下的
  // DevToolsActivePort 文件（首行端口、次行 ws 路径），stdout/stderr 不再输出。
  // 只监听 stderr 会把这种情况误判成「启动失败」，因此同时轮询该文件。
  function readPortFile() {
    if (resolved) return;
    var text = '';
    try { text = fs.readFileSync(portFile, 'utf8'); } catch (e) { return; }
    var lines = String(text).split(/\r?\n/);
    var port = parseInt(lines[0], 10);
    var wsPath = (lines[1] || '').trim();
    if (!port || !wsPath) return;
    finish(null, 'ws://127.0.0.1:' + port + wsPath);
  }

  var portTimer = setInterval(readPortFile, 150);
  if (portTimer.unref) portTimer.unref();

  function clearPortPoll() {
    if (portTimer) {
      clearInterval(portTimer);
      portTimer = null;
    }
  }

  try { proc.stderr.on('data', onData); } catch (e) {}
  try { proc.stdout.on('data', onData); } catch (e) {}
  readPortFile();

  proc.on('error', function (e) { finish(e); });
  proc.on('exit', function (code) {
    if (!resolved) {
      if (code === 0) {
        // 转交启动：启动器已退出，真正的浏览器仍在运行，继续等端口文件
        profile.proc = null;
        return;
      }
      finish(new Error('浏览器进程启动失败'));
      profile.proc = null;
      return;
    }
    profile.proc = null;
    profile.cdp = null;
    profile.cdpUrl = '';
    clearPortPoll();
    closeProfileSessions(profile, '浏览器进程已退出');
  });

  setTimeout(function () {
    if (!resolved) {
      try { proc.kill(); } catch (e) {}
      finish(new Error('浏览器启动超时（15s）'));
    }
  }, 15000);
}

// 回收某个账号的渲染浏览器：优先让浏览器自己退出（转交启动时拿不到真实进程句柄，
// proc 是已退出的启动器），兜底再按该账号的 profile 结束残留进程。
// 注意：Browser.close 必须等浏览器回包或超时后才能断开 CDP 连接，
// 否则紧跟着的 close() 会把这条消息吞掉，浏览器就一直挂着不退。
function killProfile(profile) {
  if (!profile) return;
  console.log('[web-proxy] 回收渲染浏览器[' + profile.key + ']（无活跃会话）');
  if (profile.idleTimer) { clearTimeout(profile.idleTimer); profile.idleTimer = null; }
  var cdp = profile.cdp;
  var proc = profile.proc;
  profile.cdp = null;
  profile.proc = null;
  profile.cdpUrl = '';

  var settled = false;
  function settle(closed) {
    if (settled) return;
    settled = true;
    try { if (cdp) cdp.close(); } catch (e) {}
    try { if (proc) proc.kill(); } catch (e) {}
    if (!closed) killByProfile(profile);
  }
  if (cdp && !cdp.closed) {
    try {
      cdp.send('Browser.close', {}).then(function () { settle(true); }, function () { settle(false); });
    } catch (e) { settle(false); }
    setTimeout(function () { settle(false); }, 1500);
  } else {
    settle(true);
  }
}

// 只结束使用该账号独立 profile 的渲染浏览器进程，绝不触碰其他账号或用户日常浏览器
function killByProfile(profile) {
  if (process.platform !== 'win32' || !profile) return;
  // 精确匹配 --user-data-dir 参数（后面紧跟空格），避免把前缀相同的其他账号一起杀掉
  var needle = '--user-data-dir=' + profile.dir;
  var script = "Get-CimInstance Win32_Process | Where-Object { "
    + "($_.Name -eq 'msedge.exe' -or $_.Name -eq 'chrome.exe') -and "
    + "$_.CommandLine -like '*" + needle + " *' } | "
    + "ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }";
  try {
    cp.execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true }, function () {});
  } catch (e) {}
}

// 服务退出时回收所有账号的渲染浏览器
function killAllProfiles() {
  Object.keys(profiles).forEach(function (key) {
    killProfile(profiles[key]);
  });
}

// 某个账号没有活跃会话时，空闲一段时间后回收它的浏览器内存
function scheduleIdleKill(profile) {
  if (!profile) return;
  if (profile.idleTimer) { clearTimeout(profile.idleTimer); profile.idleTimer = null; }
  profile.idleTimer = setTimeout(function () {
    if (profileSessionCount(profile) === 0 && profile.cdp) killProfile(profile);
  }, IDLE_KILL_MS);
  if (profile.idleTimer.unref) profile.idleTimer.unref();
}

// 同时保留的浏览器实例数超限时，优先回收最早使用且没有会话的实例
function trimProfiles(keepKey) {
  var keys = Object.keys(profiles);
  var live = 0;
  for (var i = 0; i < keys.length; i++) {
    if (keys[i] === keepKey) continue;
    var p = profiles[keys[i]];
    if (p.cdp || p.proc || p.starting) live++;
  }
  while (live >= MAX_PROFILES) {
    var victimKey = '';
    var oldest = Infinity;
    for (var j = 0; j < keys.length; j++) {
      if (keys[j] === keepKey) continue;
      var q = profiles[keys[j]];
      if (!q.cdp && !q.proc && !q.starting) continue;
      if (profileSessionCount(q) > 0) continue;
      if (q.lastUsedAt < oldest) { oldest = q.lastUsedAt; victimKey = keys[j]; }
    }
    if (!victimKey) return;
    killProfile(profiles[victimKey]);
    live--;
  }
}

// 浏览器进程意外退出时，只关闭属于该 profile 的会话
function closeProfileSessions(profile, message) {
  Object.keys(state.sessions).forEach(function (id) {
    var s = state.sessions[id];
    if (s.profile !== profile) return;
    try { sendJson(s.out, { type: 'error', message: message }); } catch (e) {}
    closeSession(s, false);
  });
}

// ---- 会话 ----

function sendJson(ws, obj) {
  try {
    if (ws.readyState === WS.OPEN) ws.send(JSON.stringify(obj));
  } catch (e) {}
}

// 画面帧走二进制：服务端把 CDP 的 base64 一次性解码成 JPEG 字节直接发出，
// 客户端不再需要在主线程上逐字符 atob + 拷贝（大帧时这段循环会占满主线程，
// 触摸事件排在其后处理，表现就是「画面在动、手指滑不动」），
// 同时通道传输量也比 JSON + base64 少约 25%。
function sendBinary(ws, buf) {
  try {
    if (ws.readyState === WS.OPEN) ws.send(buf);
  } catch (e) {}
}

function sessionCount() {
  return Object.keys(state.sessions).length;
}

// 建立一次渲染会话：新建标签页 → 视口/触摸仿真 → 开启 screencast → 导航到目标地址
// opts: { width, height, dpr, touch } —— 由前端按自身可用区域传入，缺省用桌面尺寸
function createSession(url, out, opts, cb) {
  if (sessionCount() >= MAX_SESSIONS) {
    return cb(new Error('兼容模式同时最多 ' + MAX_SESSIONS + ' 个会话，请稍后再试'));
  }
  var o = opts || {};
  // 同一账号复用同一个浏览器 profile；不同账号完全隔离 Cookie / 登录态 / 本地存储
  var profile = getProfile(profileKeyOf(o.uid));
  profile.lastUsedAt = Date.now();
  var game = !!o.game;
  var vw = clampSize(o.width, VIEW_WIDTH, MIN_WIDTH, MAX_WIDTH);
  var vh = clampSize(o.height, VIEW_HEIGHT, MIN_HEIGHT, MAX_HEIGHT);
  // 云游戏模式允许按设备真实像素密度渲染（上限 3），普通模式仍是 2
  var dpr = clampSize(o.dpr, 1, 1, game ? GAME_MAX_DPR : MAX_DPR);
  var touch = !!o.touch;

  ensureBrowser(profile, function (err, cdp) {
    if (err) return cb(err);
    cdp.send('Target.createTarget', { url: 'about:blank' }).then(function (r) {
      var targetId = r.targetId;
      return cdp.send('Target.attachToTarget', { targetId: targetId, flatten: true }).then(function (a) {
        var sessionId = a.sessionId;
        var id = String(++state.seq);
        var sess = {
          id: id,
          // 归属的账号 profile：后续所有 CDP 命令都走这个连接
          profile: profile,
          targetId: targetId,
          cdpSession: sessionId,
          out: out,
          lastActive: Date.now(),
          url: url,
          width: vw,
          height: vh,
          dpr: dpr,
          touch: touch,
          // 云游戏画质：高码率 + 恒 60fps + 高像素密度，不参与自适应降档
          gameMode: game,
          // 使用该会话的用户标识：由前端在 WS 握手时带上，仅供班管查看使用情况
          uid: o.uid ? String(o.uid) : '',
          uname: o.uname ? String(o.uname) : '',
          startedAt: Date.now(),
          // 音频默认关闭：前端点开后才开始采集回传
          audioEnabled: false,
          // 页面不可见时暂停帧流与采集（前端 visibilitychange 控制）
          paused: false,
          // 自适应画质：窗口内统计收发与丢弃，持续丢帧则降档
          qualityLevel: 0,
          framesSent: 0,
          framesDropped: 0,
          adaptStart: Date.now(),
          lastDropAt: 0,
          // 双指缩放：记录当前页面缩放倍率，捏合时按增量累计
          pageScale: 1,
          // 按需帧率：输入后的一小段时间内视为「操作中」，跑满 60fps；
          // frameNth 记录当前实际下发的抽帧步长，用于判断是否需要重开帧流
          activeUntil: 0,
          frameNth: game ? ACTIVE_EVERY_NTH : IDLE_EVERY_NTH,
          // 画面帧因积压被丢弃后，页面静止就不会再出帧，需要主动补拍一张最新画面
          needRefresh: false,
          refreshTimer: null,
          refreshTries: 0,
          // 操作窗口结束的一次性判定定时器（降帧 / 媒体续期）
          activeTimer: null
        };
        state.sessions[id] = sess;
        var chain = Promise.resolve();
        // 触摸设备：开启触摸仿真并切到移动 UA，否则移动版站点不会响应触摸也不返回移动布局
        if (touch) {
          chain = chain.then(function () {
            return cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 }, sessionId);
          }).then(function () {
            return cdp.send('Emulation.setUserAgentOverride', {
              userAgent: MOBILE_UA,
              acceptLanguage: 'zh-CN,zh;q=0.9,en;q=0.8',
              platform: 'Linux armv8l'
            }, sessionId);
          });
        }
        return chain.then(function () {
          return cdp.send('Page.enable', {}, sessionId);
        })
          .then(function () {
            return cdp.send('Runtime.enable', {}, sessionId);
          })
          // 无头标签页默认被当作「未聚焦」，页面会压低动画 / 定时器频率；
          // 开启焦点仿真后页面以正常帧率运行，滚动与动画更顺滑。
          .then(function () {
            // 老版本浏览器可能没有该命令：失败不影响会话，按普通无头模式继续
            return cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true }, sessionId).catch(function () {});
          })
          // 音频分片回传通道：页面脚本调用 window.__ciAudioChunk(base64) 即触发 bindingCalled
          .then(function () {
            return cdp.send('Runtime.addBinding', { name: '__ciAudioChunk' }, sessionId);
          })
          // 采集脚本在每次文档加载前注入，页面刷新/站内跳转后依然生效
          .then(function () {
            if (!AUDIO_INJECT) return null;
            return cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: AUDIO_INJECT }, sessionId);
          })
          .then(function () {
            return cdp.send('Emulation.setDeviceMetricsOverride', {
              width: vw,
              height: vh,
              deviceScaleFactor: dpr,
              mobile: touch
            }, sessionId);
          })
          .then(function () {
            // 帧尺寸按物理像素下发（dpr 缩放），前端画布等比显示，文字更清晰
            return cdp.send('Page.startScreencast', screencastParams(sess), sessionId);
          })
          .then(function () {
            return navigate(sess, url);
          })
          .then(function () {
            cb(null, sess);
          });
      });
    }).catch(function (e) {
      cb(e);
    });
  });
}

function clampSize(value, fallback, min, max) {
  var n = Number(value);
  if (!n || !isFinite(n)) n = fallback;
  return Math.max(min, Math.min(max, Math.round(n)));
}

function navigate(sess, url) {
  var cdp = sess && sess.profile && sess.profile.cdp;
  if (!cdp) return Promise.reject(new Error('渲染引擎未就绪'));
  if (!/^https?:\/\//i.test(url)) return Promise.reject(new Error('仅支持 http/https 地址'));
  sess.url = url;
  sess.lastActive = Date.now();
  // 换页面后回到 100%：上一个站点放大的倍率不该带到下一个站点
  sess.pageScale = 1;
  return cdp.send('Page.navigate', { url: url }, sess.cdpSession);
}

// 当前会话档位对应的 screencast 参数（尺寸按物理像素下发）
function screencastParams(sess) {
  var maxW = Math.round(sess.width * sess.dpr);
  var maxH = Math.round(sess.height * sess.dpr);
  if (sess.gameMode) {
    // 云游戏：高码率 + 恒定 60fps；尺寸设上限防止 4K 以上超采样把帧撑爆
    return {
      format: 'jpeg',
      quality: GAME_QUALITY,
      maxWidth: Math.min(maxW, GAME_MAX_WIDTH),
      maxHeight: Math.min(maxH, GAME_MAX_HEIGHT),
      everyNthFrame: ACTIVE_EVERY_NTH
    };
  }
  var lv = QUALITY_LEVELS[sess.qualityLevel] || QUALITY_LEVELS[0];
  return {
    format: 'jpeg',
    quality: lv.quality,
    maxWidth: maxW,
    maxHeight: maxH,
    // 有人操作时 60fps，静置后 30fps（省约一半编码 CPU 与带宽）
    everyNthFrame: isActive(sess) ? ACTIVE_EVERY_NTH : IDLE_EVERY_NTH
  };
}

// 当前会话允许的在途帧积压上限：云游戏帧更大，单独放宽
function frameLimitOf(sess) {
  if (!sess) return FRAME_MAX_BUFFER;
  if (sess.gameMode) return GAME_FRAME_MAX_BUFFER;
  return sess.touch ? FRAME_MAX_BUFFER_TOUCH : FRAME_MAX_BUFFER;
}

// 是否处于「操作中」窗口：触摸 / 滚轮 / 键盘等输入后的一小段时间内跑满帧率
function isActive(sess) {
  return !!(sess && sess.activeUntil && Date.now() < sess.activeUntil);
}

// 输入到达时标记为操作中：立刻升到 60fps，1.5 秒后按需降回 30fps
function markActive(sess) {
  // 云游戏模式已恒定 60fps，无需再维护操作窗口
  if (!sess || sess.paused || sess.gameMode) return;
  sess.activeUntil = Date.now() + ACTIVE_BOOST_MS;
  applyFrameMode(sess);
  scheduleActiveEnd(sess);
}

// 操作窗口结束时立刻判断一次（不必等周期巡检），让降帧在 1.6 秒内生效
function scheduleActiveEnd(sess) {
  if (sess.activeTimer) clearTimeout(sess.activeTimer);
  sess.activeTimer = setTimeout(function () {
    sess.activeTimer = null;
    if (!state.sessions[sess.id] || sess.paused) return;
    mediaPlaying(sess).then(function (playing) {
      if (!state.sessions[sess.id] || sess.paused) return;
      if (playing) sess.activeUntil = Date.now() + MEDIA_KEEP_MS;
      applyFrameMode(sess);
    });
  }, ACTIVE_BOOST_MS + 100);
  if (sess.activeTimer.unref) sess.activeTimer.unref();
}

// 只有帧率档位真正变化时才重开帧流，避免每次输入都 stop/start
function applyFrameMode(sess) {
  if (!sess || sess.paused || !sess.profile || !sess.profile.cdp) return;
  // 云游戏模式固定跑满帧率，不做按需降帧
  var nth = sess.gameMode ? ACTIVE_EVERY_NTH : (isActive(sess) ? ACTIVE_EVERY_NTH : IDLE_EVERY_NTH);
  if (sess.frameNth === nth) return;
  sess.frameNth = nth;
  restartScreencast(sess);
}

// 页面有媒体在播放时降帧会明显顿（视频 / 音乐需要连续帧）：
// 每 3 秒做一次轻量 DOM 查询，在播就把「操作中」窗口续期，播完自然回落到 30fps。
function watchMedia() {
  Object.keys(state.sessions).forEach(function (id) {
    var sess = state.sessions[id];
    if (!sess || sess.paused || sess.gameMode || !sess.profile || !sess.profile.cdp) return;
    mediaPlaying(sess).then(function (playing) {
      if (!state.sessions[sess.id] || sess.paused) return;
      if (playing) sess.activeUntil = Date.now() + MEDIA_KEEP_MS;
      applyFrameMode(sess);
    });
  });
}
setInterval(watchMedia, MEDIA_CHECK_MS).unref();

function mediaPlaying(sess) {
  var cdp = sess && sess.profile && sess.profile.cdp;
  if (!cdp) return Promise.resolve(false);
  return cdp.send('Runtime.evaluate', {
    expression: '(function(){var m=document.querySelectorAll("video,audio");'
      + 'for(var i=0;i<m.length;i++){var e=m[i];'
      + 'if(!e.paused&&!e.ended&&e.readyState>2)return true;}return false;})()',
    returnByValue: true
  }, sess.cdpSession).then(function (r) {
    return !!(r && r.result && r.result.value);
  }, function () { return false; });
}

// 按当前会话视口重开 screencast：改过视口后必须重开，否则帧尺寸仍是旧的
function restartScreencast(sess) {
  var cdp = sess && sess.profile && sess.profile.cdp;
  if (!cdp) return Promise.resolve();
  var sid = sess.cdpSession;
  var start = function () {
    // 暂停期间（页面隐藏）不重开帧流，恢复时由 resume 统一启动
    if (sess.paused) return Promise.resolve();
    sess.frameNth = sess.gameMode ? ACTIVE_EVERY_NTH : (isActive(sess) ? ACTIVE_EVERY_NTH : IDLE_EVERY_NTH);
    return cdp.send('Page.startScreencast', screencastParams(sess), sid);
  };
  return cdp.send('Page.stopScreencast', {}, sid).then(start, start);
}

// 自适应画质：每隔一个窗口看丢帧比例，持续跟不上就降一档；长时间稳定再回升
function adaptScreencast(sess) {
  // 云游戏模式不降档：用户主动要画质，自动降档会让画面忽清忽糊
  if (sess.gameMode) return;
  var now = Date.now();
  if (now - sess.adaptStart < ADAPT_WINDOW_MS) return;
  var total = sess.framesSent + sess.framesDropped;
  var ratio = total ? sess.framesDropped / total : 0;
  sess.framesSent = 0;
  sess.framesDropped = 0;
  sess.adaptStart = now;
  // 页面几乎不动时样本太少，不做判断，避免误降档
  if (total < 10) return;
  if (ratio >= ADAPT_DROP_RATIO && sess.qualityLevel < QUALITY_LEVELS.length - 1) {
    sess.qualityLevel++;
    sendQualityLevel(sess);
    restartScreencast(sess);
    return;
  }
  if (ratio === 0 && sess.qualityLevel > 0 && now - sess.lastDropAt > ADAPT_UPGRADE_MS) {
    sess.qualityLevel--;
    sendQualityLevel(sess);
    restartScreencast(sess);
  }
}

// 档位变化时通知前端一次（前端可忽略）：便于诊断与后续按档位提示
function sendQualityLevel(sess) {
  sendJson(sess.out, {
    type: 'quality',
    level: sess.qualityLevel,
    quality: QUALITY_LEVELS[sess.qualityLevel].quality,
    fps: 60 / (isActive(sess) ? ACTIVE_EVERY_NTH : IDLE_EVERY_NTH)
  });
}

// 补拍最新画面：丢帧后等客户端缓冲回落到低水位，再主动截一张当前画面，
// 保证「滑动结束 / 动画停止」后屏幕一定停在最终状态，而不是旧帧。
function scheduleRefresh(sess) {
  if (!sess || sess.refreshTimer || sess.paused) return;
  sess.refreshTimer = setTimeout(function () {
    sess.refreshTimer = null;
    if (!sess.needRefresh || sess.paused) return;
    var cdp = sess.profile && sess.profile.cdp;
    if (!cdp || !state.sessions[sess.id]) return;
    var limit = frameLimitOf(sess);
    var backlog = 0;
    try { backlog = sess.out.bufferedAmount || 0; } catch (e) {}
    // 缓冲仍高说明网络 / 解码没跟上，稍后再补拍，避免继续堆帧
    if (backlog > limit / 3) {
      if (sess.refreshTries < 20) {
        sess.refreshTries++;
        scheduleRefresh(sess);
      }
      return;
    }
    sess.refreshTries = 0;
    sess.needRefresh = false;
    var lv = QUALITY_LEVELS[sess.qualityLevel] || QUALITY_LEVELS[0];
    cdp.send('Page.captureScreenshot', {
      format: 'jpeg',
      quality: sess.gameMode ? GAME_QUALITY : lv.quality,
      fromSurface: true
    }, sess.cdpSession).then(function (r) {
      if (!r || !r.data) return;
      var jpeg = null;
      try { jpeg = Buffer.from(r.data, 'base64'); } catch (e) { return; }
      if (!jpeg || !jpeg.length) return;
      if (sess.out.readyState !== WS.OPEN) return;
      sendBinary(sess.out, jpeg);
    }).catch(function () {});
  }, 300);
  if (sess.refreshTimer.unref) sess.refreshTimer.unref();
}

function closeSession(sess, notify) {
  if (!sess) return;
  delete state.sessions[sess.id];
  // 会话关闭时清掉补拍与降帧定时器，避免对已关闭的连接继续截图 / 查询
  if (sess.refreshTimer) {
    clearTimeout(sess.refreshTimer);
    sess.refreshTimer = null;
  }
  if (sess.activeTimer) {
    clearTimeout(sess.activeTimer);
    sess.activeTimer = null;
  }
  var cdp = sess.profile && sess.profile.cdp;
  if (cdp) {
    try { cdp.send('Target.closeTarget', { targetId: sess.targetId }).catch(function () {}); } catch (e) {}
  }
  if (notify) sendJson(sess.out, { type: 'closed' });
  try { sess.out.close(); } catch (e) {}
  scheduleIdleKill(sess.profile);
}

function findSessionByCdp(cdpSessionId) {
  for (var id in state.sessions) {
    if (state.sessions[id].cdpSession === cdpSessionId) return state.sessions[id];
  }
  return null;
}

// 查询页面自身的导航历史，让前端的「返回 / 前进」按钮反映真实可用状态
function sendHistoryState(sess) {
  var cdp = sess && sess.profile && sess.profile.cdp;
  if (!cdp) return;
  cdp.send('Page.getNavigationHistory', {}, sess.cdpSession).then(function (r) {
    var entries = r.entries || [];
    var idx = Number(r.currentIndex) || 0;
    var entry = entries[idx] || {};
    sendJson(sess.out, {
      type: 'history',
      // 会话最初打开的 about:blank 占第 0 条，真正可用的「后退」从第 2 条起算，
      // 否则第一次后退会退到空白页而不是回到上一站。
      canBack: idx > 1,
      canForward: idx < entries.length - 1,
      title: entry.title || ''
    });
  }).catch(function () {});
}

// ---- CDP 事件分发 ----

function dispatchEvent(profile, method, params, cdpSessionId) {
  var cdp = profile && profile.cdp;
  var sess = findSessionByCdp(cdpSessionId);
  if (!sess) return;
  if (method === 'Page.screencastFrame') {
    var backlog = 0;
    try { backlog = sess.out.bufferedAmount || 0; } catch (e) {}
    var frameLimit = frameLimitOf(sess);
    if (backlog < frameLimit) {
      sess.framesSent++;
      var jpeg = null;
      try { jpeg = Buffer.from(params.data, 'base64'); } catch (e) { jpeg = null; }
      if (jpeg && jpeg.length) {
        sendBinary(sess.out, jpeg);
      } else {
        // 兜底：极端情况下解码失败仍走 JSON + base64（前端两种格式都兼容）
        sendJson(sess.out, { type: 'frame', data: params.data });
      }
    } else {
      sess.framesDropped++;
      sess.lastDropAt = Date.now();
      // 积压时丢的是「旧帧」，但页面停手后不再出帧，最新画面就永远到不了，
      // 用户看到的是滑动中途的旧位置（主观就是「卡住」）。标记后由补拍兜底。
      sess.needRefresh = true;
      scheduleRefresh(sess);
    }
    // 无论是否丢弃都要回 ACK，否则 Chromium 会停止继续出帧
    try {
      if (cdp) cdp.send('Page.screencastFrameAck', { sessionId: params.sessionId }, cdpSessionId).catch(function () {});
    } catch (e) {}
    adaptScreencast(sess);
    return;
  }
  if (method === 'Page.frameNavigated') {
    var f = params.frame || {};
    if (!f.parentId && f.url) {
      sess.url = f.url;
      sendJson(sess.out, { type: 'url', url: f.url });
      sendHistoryState(sess);
    }
    return;
  }
  if (method === 'Page.loadEventFired') {
    sendJson(sess.out, { type: 'loaded' });
    sendHistoryState(sess);
    // 新文档是全新的脚本环境：音频开启状态下要重新启动页面内采集
    if (cdp && sess.audioEnabled && !sess.paused && AUDIO_INJECT) {
      try {
        cdp.send('Runtime.evaluate', {
          expression: 'window.__ciAudioStart&&window.__ciAudioStart()',
          userGesture: true,
          returnByValue: true
        }, cdpSessionId).then(function (r) {
          var ok = !!(r && r.result && r.result.value === true);
          if (!ok) sendJson(sess.out, { type: 'audio-state', enabled: false, available: false, rate: AUDIO_RATE });
        }).catch(function () {});
      } catch (e) {}
    }
    // 标题在 load 之后才稳定（SPA 还会异步改写），单独回传一次供分享使用
    if (cdp) {
      try {
        cdp.send('Runtime.evaluate', { expression: 'document.title', returnByValue: true }, cdpSessionId)
          .then(function (r) {
            var title = r && r.result ? String(r.result.value || '') : '';
            if (title) sendJson(sess.out, { type: 'title', title: title });
          }).catch(function () {});
      } catch (e) {}
    }
    return;
  }
  if (method === 'Runtime.bindingCalled') {
    // 页面采集脚本回传的音频分片（base64 编码的 16kHz 单声道 PCM）
    if (params.name === '__ciAudioChunk' && sess.audioEnabled && params.payload) {
      var queued = 0;
      try { queued = sess.out.bufferedAmount || 0; } catch (e) {}
      if (queued < AUDIO_MAX_BUFFER) {
        sendJson(sess.out, { type: 'audio', rate: AUDIO_RATE, data: params.payload });
      }
    }
    return;
  }
  if (method === 'Runtime.executionContextCreated') {
    // 新文档 / 子 iframe 的脚本环境建立后，若音频正在开启则同步启动该环境的采集
    var ctxInfo = params.context || {};
    if (cdp && sess.audioEnabled && !sess.paused && ctxInfo.id && AUDIO_INJECT) {
      cdp.send('Runtime.evaluate', {
        expression: 'window.__ciAudioStart&&window.__ciAudioStart()',
        contextId: ctxInfo.id,
        userGesture: true,
        returnByValue: true
      }, cdpSessionId).catch(function () {});
    }
    return;
  }
  if (method === 'Page.javascriptDialogOpening') {
    try {
      if (cdp) cdp.send('Page.handleJavaScriptDialog', { accept: true }, cdpSessionId).catch(function () {});
    } catch (e) {}
    return;
  }
  if (method === 'Target.targetDestroyed') {
    if (state.sessions[sess.id]) closeSession(sess, true);
  }
}

// ---- 输入事件 ----

var KEY_CODES = {
  'Enter': { code: 'Enter', vk: 13 },
  'Backspace': { code: 'Backspace', vk: 8 },
  'Tab': { code: 'Tab', vk: 9 },
  'Escape': { code: 'Escape', vk: 27 },
  'Delete': { code: 'Delete', vk: 46 },
  'ArrowUp': { code: 'ArrowUp', vk: 38 },
  'ArrowDown': { code: 'ArrowDown', vk: 40 },
  'ArrowLeft': { code: 'ArrowLeft', vk: 37 },
  'ArrowRight': { code: 'ArrowRight', vk: 39 },
  'Home': { code: 'Home', vk: 36 },
  'End': { code: 'End', vk: 35 },
  'PageUp': { code: 'PageUp', vk: 33 },
  'PageDown': { code: 'PageDown', vk: 34 }
};

function handleInput(sess, msg) {
  if (!sess) return;
  var cdp = sess.profile && sess.profile.cdp;
  if (!cdp) return;
  sess.lastActive = Date.now();
  var sid = sess.cdpSession;
  // 有输入即视为「操作中」：帧率临时升到 60fps，松手静置 1.5 秒后回落 30fps。
  // 只对真正的交互类型升帧：暂停 / 恢复 / 导航等控制消息不改变画面流畅度需求。
  if (msg.type === 'mouse' || msg.type === 'touch' || msg.type === 'wheel' ||
      msg.type === 'key' || msg.type === 'text' || msg.type === 'pinch') {
    markActive(sess);
  }
  // 输入事件失败只需记一次，避免把日志刷爆
  function guard(promise, label) {
    promise.catch(function (e) {
      if (!sess.inputErrorLogged) {
        sess.inputErrorLogged = true;
        console.log('[web-proxy] ' + label + ' 事件失败: ' + e.message);
      }
    });
  }

  // 画质模式切换：运行中打开/关闭云游戏画质，无需重建会话（保留页面与滚动位置）
  if (msg.type === 'mode') {
    var game = !!msg.game;
    var nd = clampSize(msg.dpr, sess.dpr, 1, game ? GAME_MAX_DPR : MAX_DPR);
    if (sess.gameMode === game && sess.dpr === nd) {
      sendJson(sess.out, {
        type: 'mode-state',
        game: sess.gameMode,
        dpr: sess.dpr,
        quality: sess.gameMode ? GAME_QUALITY : (QUALITY_LEVELS[sess.qualityLevel] || QUALITY_LEVELS[0]).quality,
        fps: sess.gameMode ? 60 : 30
      });
      return;
    }
    sess.gameMode = game;
    sess.dpr = nd;
    // 切换档位后重新开始统计，避免把上一模式的丢帧算进自适应窗口
    sess.qualityLevel = 0;
    sess.framesSent = 0;
    sess.framesDropped = 0;
    sess.adaptStart = Date.now();
    if (!game) sess.activeUntil = 0;
    // 像素密度变化必须重设设备指标，否则帧尺寸仍是旧的
    guard(cdp.send('Emulation.setDeviceMetricsOverride', {
      width: sess.width,
      height: sess.height,
      deviceScaleFactor: nd,
      mobile: sess.touch
    }, sid).then(function () {
      return restartScreencast(sess);
    }).then(function () {
      sendJson(sess.out, {
        type: 'mode-state',
        game: sess.gameMode,
        dpr: sess.dpr,
        quality: game ? GAME_QUALITY : (QUALITY_LEVELS[0] || { quality: SCREENCAST_QUALITY }).quality,
        fps: game ? 60 : 30
      });
    }), 'mode');
    return;
  }

  if (msg.type === 'mouse') {
    guard(cdp.send('Input.dispatchMouseEvent', {
      type: msg.event || 'mouseMoved',
      x: Number(msg.x) || 0,
      y: Number(msg.y) || 0,
      button: msg.button || 'none',
      buttons: Number(msg.buttons) || 0,
      clickCount: Number(msg.clickCount) || 0
    }, sid), 'mouse');
    return;
  }
  // 触摸：移动端必须走真实 touch 事件，页面才会响应点击、原生滚动与手势
  if (msg.type === 'touch') {
    var ev = msg.event;
    var cdpType = ev === 'start' ? 'touchStart'
      : ev === 'move' ? 'touchMove'
        : ev === 'end' ? 'touchEnd' : 'touchCancel';
    var points = [];
    var list = Array.isArray(msg.points) ? msg.points : [];
    for (var i = 0; i < list.length; i++) {
      points.push({
        x: Number(list[i].x) || 0,
        y: Number(list[i].y) || 0,
        id: Number(list[i].id) || 1,
        radiusX: 1,
        radiusY: 1,
        force: 1
      });
    }
    guard(cdp.send('Input.dispatchTouchEvent', { type: cdpType, touchPoints: points }, sid), 'touch');
    // 触摸结束后检查页面是否把焦点落在可输入元素上：移动端没有真实键盘可唤起，
    // 此时通知前端展开中转输入条，否则用户点了搜索框却打不了字。
    if (cdpType === 'touchEnd') {
      setTimeout(function () {
        cdp.send('Runtime.evaluate', {
          expression: '(function(){var a=document.activeElement;return !!(a&&(a.tagName==="INPUT"||a.tagName==="TEXTAREA"||a.isContentEditable));})()',
          returnByValue: true
        }, sid).then(function (r) {
          if (r && r.result && r.result.value) sendJson(sess.out, { type: 'focus', input: true });
        }).catch(function () {});
      }, 120);
    }
    return;
  }
  // 双指捏合：直接调页面缩放倍率。
  // 无头环境里 Input.synthesizePinchGesture 不改变 visualViewport.scale（实测 scale 恒为 1），
  // 而 Emulation.setPageScaleFactor 是确定生效的：前端按增量下发，这里累计成绝对倍率。
  if (msg.type === 'pinch') {
    var cur = Number(sess.pageScale) || 1;
    var next = cur * (Number(msg.scaleFactor) || 1);
    if (next < PINCH_MIN_SCALE) next = PINCH_MIN_SCALE;
    if (next > PINCH_MAX_SCALE) next = PINCH_MAX_SCALE;
    // 变化太小时不发，避免高频命令把渲染端输入队列打满
    if (Math.abs(next - cur) < 0.01) return;
    sess.pageScale = next;
    guard(cdp.send('Emulation.setPageScaleFactor', { pageScaleFactor: next }, sid), 'pinch');
    return;
  }
  if (msg.type === 'wheel') {
    guard(cdp.send('Input.dispatchMouseEvent', {
      type: 'mouseWheel',
      x: Number(msg.x) || 0,
      y: Number(msg.y) || 0,
      deltaX: Number(msg.deltaX) || 0,
      deltaY: Number(msg.deltaY) || 0
    }, sid), 'wheel');
    return;
  }
  if (msg.type === 'text') {
    guard(cdp.send('Input.insertText', { text: String(msg.text || '') }, sid), 'text');
    return;
  }
  if (msg.type === 'key') {
    var k = String(msg.key || '');
    var info = KEY_CODES[k];
    var isDown = msg.event !== 'up';
    if (info) {
      guard(cdp.send('Input.dispatchKeyEvent', {
        type: isDown ? 'rawKeyDown' : 'keyUp',
        key: k,
        code: info.code,
        windowsVirtualKeyCode: info.vk,
        nativeVirtualKeyCode: info.vk
      }, sid), 'key');
      return;
    }
    // 可打印字符：走 insertText 更稳（避免输入法/组合键问题）
    if (isDown && k.length === 1) {
      guard(cdp.send('Input.insertText', { text: k }, sid), 'text');
    }
    return;
  }
  if (msg.type === 'navigate') {
    navigate(sess, String(msg.url || '')).catch(function () {});
    return;
  }
  if (msg.type === 'reload') {
    guard(cdp.send('Page.reload', { ignoreCache: !!msg.hard }, sid), 'reload');
    return;
  }
  // 前端可用区域变化（手机旋转 / 窗口拖拽）时同步无头浏览器视口，
  // 否则页面会按旧尺寸排版，出现留白或滚动条。
  if (msg.type === 'resize') {
    var nw = clampSize(msg.width, sess.width, MIN_WIDTH, MAX_WIDTH);
    var nh = clampSize(msg.height, sess.height, MIN_HEIGHT, MAX_HEIGHT);
    if (nw === sess.width && nh === sess.height) return;
    sess.width = nw;
    sess.height = nh;
    guard(cdp.send('Emulation.setDeviceMetricsOverride', {
      width: nw,
      height: nh,
      deviceScaleFactor: sess.dpr,
      mobile: sess.touch
    }, sid).then(function () {
      return restartScreencast(sess);
    }).then(function () {
      sendJson(sess.out, { type: 'resized', width: nw, height: nh });
      sendHistoryState(sess);
    }), 'resize');
    return;
  }
  // 页面不可见（手机锁屏 / 切到其他应用）时暂停帧流与声音采集：
  // 否则无头浏览器仍在渲染、编码 JPEG 并占用带宽，纯属浪费。
  if (msg.type === 'pause') {
    if (sess.paused) return;
    sess.paused = true;
    guard(cdp.send('Page.stopScreencast', {}, sid), 'pause');
    if (sess.audioEnabled) {
      cdp.send('Runtime.evaluate', {
        expression: 'window.__ciAudioStop&&window.__ciAudioStop()',
        returnByValue: true
      }, sid).catch(function () {});
    }
    return;
  }
  if (msg.type === 'resume') {
    if (!sess.paused) return;
    sess.paused = false;
    guard(restartScreencast(sess), 'resume');
    if (sess.audioEnabled) {
      cdp.send('Runtime.evaluate', {
        expression: 'window.__ciAudioStart&&window.__ciAudioStart()',
        userGesture: true,
        returnByValue: true
      }, sid).catch(function () {});
    }
    return;
  }
  if (msg.type === 'back') {
    guard(cdp.send('Runtime.evaluate', { expression: 'history.back()' }, sid), 'back');
    return;
  }
  if (msg.type === 'forward') {
    guard(cdp.send('Runtime.evaluate', { expression: 'history.forward()' }, sid), 'forward');
    return;
  }
  // 音频开关：开启后由页面内脚本采集媒体元素 / WebAudio 声音，分片经 binding 回传；
  // 关闭即断开采集，服务端不再有音频流量。
  if (msg.type === 'audio') {
    var audioOn = !!msg.enabled;
    var expr = audioOn
      ? '(function(){try{return !!(window.__ciAudioStart&&window.__ciAudioStart());}catch(e){return false;}})()'
      : '(function(){try{if(window.__ciAudioStop)window.__ciAudioStop();}catch(e){}return true;})()';
    sess.audioEnabled = audioOn;
    guard(cdp.send('Runtime.evaluate', {
      expression: expr,
      userGesture: true,
      returnByValue: true
    }, sid).then(function (r) {
      var ok = !!(r && r.result && r.result.value);
      if (audioOn && !ok) sess.audioEnabled = false;
      sendJson(sess.out, { type: 'audio-state', enabled: audioOn && ok, available: ok, rate: AUDIO_RATE });
    }), 'audio');
    return;
  }
  if (msg.type === 'click-text') {
    // 预留：按文本点击（暂未使用）
    return;
  }
}

// ---- 对外入口：接管 WebSocket 升级 ----

// 校验握手身份：优先用 token 取真实 user_id（uid 参数可被伪造），
// 再按「可使用者」设置决定放行。旧版前端不带 token 时退回 uid，保持兼容。
function resolveViewer(params) {
  var uid = String(params.uid || '');
  var uname = String(params.uname || '');
  var token = String(params.token || '');
  if (token) {
    var result = null;
    try { result = jwtUtil.verifyToken(token); } catch (e) { result = null; }
    if (!result || !result.valid || !result.data || !result.data.user_id) {
      return { error: '登录状态已失效，请重新登录后再使用兼容模式' };
    }
    uid = String(result.data.user_id);
  }
  if (!access.isAllowed(uid)) {
    return { error: '管理员尚未授权你使用兼容模式' };
  }
  return { uid: uid, uname: uname };
}

function handleUpgrade(req, socket, head) {
  var query = '';
  var idx = String(req.url || '').indexOf('?');
  if (idx >= 0) query = String(req.url).substring(idx + 1);
  var params = {};
  var parts = query.split('&');
  for (var i = 0; i < parts.length; i++) {
    if (!parts[i]) continue;
    var kv = parts[i].split('=');
    var key = kv[0];
    var val = kv.slice(1).join('=');
    try { val = decodeURIComponent(val); } catch (e) {}
    params[key] = val;
  }
  var url = params.url || '';

  var wss = new WS.Server({ noServer: true, perMessageDeflate: false, maxPayload: 4 * 1024 * 1024 });
  wss.handleUpgrade(req, socket, head, function (client) {
    if (!url || !/^https?:\/\//i.test(url)) {
      sendJson(client, { type: 'error', message: '缺少合法的 url 参数' });
      try { client.close(); } catch (e) {}
      return;
    }
    var viewer = resolveViewer(params);
    if (viewer.error) {
      sendJson(client, { type: 'error', message: viewer.error });
      try { client.close(); } catch (e) {}
      return;
    }
    createSession(url, client, {
      width: params.w,
      height: params.h,
      dpr: params.dpr,
      touch: params.touch === '1',
      game: params.mode === 'game',
      uid: viewer.uid,
      uname: viewer.uname
    }, function (err, sess) {
      if (err) {
        console.log('[web-proxy] 兼容模式会话创建失败: ' + err.message);
        sendJson(client, { type: 'error', message: err.message });
        try { client.close(); } catch (e) {}
        return;
      }
      sendJson(client, {
        type: 'ready',
        session: sess.id,
        width: sess.width,
        height: sess.height,
        touch: sess.touch,
        // 供前端恢复云游戏开关状态
        game: !!sess.gameMode,
        dpr: sess.dpr
      });
      client.on('message', function (raw) {
        var msg;
        try { msg = JSON.parse(String(raw)); } catch (e) { return; }
        handleInput(sess, msg);
      });
      client.on('close', function () {
        closeSession(sess, false);
      });
      client.on('error', function () {});
    });
  });
}

// 会话空闲回收
setInterval(function () {
  var now = Date.now();
  Object.keys(state.sessions).forEach(function (id) {
    var s = state.sessions[id];
    if (now - s.lastActive > SESSION_IDLE_MS) closeSession(s, true);
  });
}, 30000).unref();

function status() {
  // 聚合所有账号 profile：只要有一个实例活着就算运行中
  var running = 0;
  var lastError = state.lastError;
  Object.keys(profiles).forEach(function (key) {
    var p = profiles[key];
    if (p.cdp && !p.cdp.closed) running++;
    if (p.lastError) lastError = p.lastError;
  });
  return {
    available: !!findBrowser(),
    browser: findBrowser(),
    running: running > 0,
    browsers: running,
    profiles: Object.keys(profiles).length,
    sessions: sessionCount(),
    maxSessions: MAX_SESSIONS,
    maxProfiles: MAX_PROFILES,
    lastError: lastError
  };
}

// 列出当前所有兼容模式会话（仅暴露班管做使用管理所需的最小字段）
function listSessions() {
  var now = Date.now();
  return Object.keys(state.sessions).map(function (id) {
    var s = state.sessions[id];
    return {
      id: s.id,
      url: s.url,
      user: { id: s.uid || '', name: s.uname || '' },
      startedAt: s.startedAt || 0,
      lastActive: s.lastActive || 0,
      // 前端直接展示时长，省去两端时钟不一致带来的偏差
      duration: now - (s.startedAt || now),
      audioEnabled: !!s.audioEnabled,
      paused: !!s.paused,
      touch: !!s.touch,
      game: !!s.gameMode,
      width: s.width,
      height: s.height,
      framesSent: s.framesSent || 0,
      framesDropped: s.framesDropped || 0
    };
  });
}

// 按会话 ID 断开：返回是否确实关掉了一个会话
function closeSessionById(id) {
  var sess = state.sessions[String(id || '')];
  if (!sess) return false;
  closeSession(sess, true);
  return true;
}

// 断开全部会话：返回实际断开的数量
function closeAllSessions() {
  var ids = Object.keys(state.sessions);
  for (var i = 0; i < ids.length; i++) {
    closeSession(state.sessions[ids[i]], true);
  }
  return ids.length;
}

module.exports = {
  handleUpgrade: handleUpgrade,
  status: status,
  listSessions: listSessions,
  closeSessionById: closeSessionById,
  closeAllSessions: closeAllSessions,
  kill: killAllProfiles
};
