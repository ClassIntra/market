// backend/render.js
// 按需无头渲染引擎（兼容模式）。
//
// 用途：少数站点（腾讯/网易等 WAF）会返回 JS 挑战页，纯静态改写无法通过；
// 这里用系统已安装的 Edge/Chrome 以 headless 方式真实执行页面脚本，
// 再把渲染结果以 screencast 帧流推给前端 canvas，并把用户输入回灌给浏览器。
//
// 设计取舍：
//   - 复用系统浏览器，不下载任何 Chromium（零额外体积）；不引入新依赖（ws 已在 server 依赖中）
//   - 单浏览器进程、多标签页会话；会话数有上限（默认 3），超限直接拒绝而不是排队卡死
//   - 无会话空闲 5 分钟后自动杀掉浏览器进程，回收约 1.8GB 内存
//   - 该模式是「少数站点兜底」，不作为默认浏览方式
//
// 代码风格遵循 ClassIntra 约定：var / function / 单引号 / 2 空格缩进。

var cp = require('child_process');
var fs = require('fs');
var os = require('os');
var path = require('path');
var WS = require('ws');

// 系统浏览器候选路径（Windows 常见安装位置）
var BROWSER_PATHS = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
];

var MAX_SESSIONS = 3;              // 同时存活的渲染会话上限（实测单浏览器约 1.8GB）
var IDLE_KILL_MS = 5 * 60 * 1000;  // 无会话空闲多久后关闭浏览器进程
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
// 自适应画质档位：弱网 / 低端手机上持续丢帧时自动降帧率与画质，
// 稳定一段时间后再逐档回升，既不卡也不长期糊。
var QUALITY_LEVELS = [
  { quality: SCREENCAST_QUALITY, everyNthFrame: 1 },
  { quality: 48, everyNthFrame: 2 },
  { quality: 40, everyNthFrame: 3 }
];
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

var state = {
  proc: null,
  cdpUrl: '',
  cdp: null,
  starting: null,
  sessions: {},
  seq: 0,
  idleTimer: null,
  lastError: ''
};

var PROFILE_DIR = path.join(os.tmpdir(), 'classintra-render-profile');
// 浏览器把 DevTools 端口写在该文件里（首行端口、次行 ws 路径），
// 比解析 stderr 更可靠：新版 Edge/Chrome 会把启动请求转交给子进程，stderr 不再输出。
var DEVTOOLS_PORT_FILE = path.join(PROFILE_DIR, 'DevToolsActivePort');

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

// 先复用上一轮遗留但仍活着的渲染浏览器（pm2 重启、异常退出时常见）：
// 旧实例占着 profile 时，新实例只会「转交启动」然后立刻退出，端口文件也不再刷新，
// 表现就是兼容模式一直连不上。这里按端口文件探活，探活失败才冷启动。
function ensureBrowser(cb) {
  if (state.cdp && !state.cdp.closed) return cb(null, state.cdp);
  if (state.starting) {
    state.starting.push(cb);
    return;
  }
  state.starting = [cb];

  var exe = findBrowser();
  if (!exe) {
    state.lastError = '未找到系统 Edge / Chrome，无法启用兼容模式';
    var waiting = state.starting;
    state.starting = null;
    waiting.forEach(function (fn) { fn(new Error(state.lastError)); });
    return;
  }

  var existing = readExistingPortUrl();
  if (!existing) return launchBrowser(exe);

  var probe = new CdpClient(existing);
  var settled = false;
  var timer = setTimeout(function () {
    if (settled) return;
    settled = true;
    try { probe.close(); } catch (e) {}
    try { fs.unlinkSync(DEVTOOLS_PORT_FILE); } catch (e) {}
    launchBrowser(exe);
  }, 2000);
  probe.send('Browser.getVersion', {}).then(function () {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    state.cdpUrl = existing;
    state.cdp = probe;
    probe.on(dispatchEvent);
    scheduleIdleKill();
    console.log('[web-proxy] 兼容模式复用已有浏览器: ' + existing);
    var pending = state.starting || [];
    state.starting = null;
    pending.forEach(function (fn) { fn(null, probe); });
  }, function () {
    // 连接失败由上面的定时器统一兜底
  });
}

function readExistingPortUrl() {
  var text = '';
  try { text = fs.readFileSync(DEVTOOLS_PORT_FILE, 'utf8'); } catch (e) { return ''; }
  var lines = String(text).split(/\r?\n/);
  var port = parseInt(lines[0], 10);
  var wsPath = (lines[1] || '').trim();
  if (!port || !wsPath) return '';
  return 'ws://127.0.0.1:' + port + wsPath;
}

function launchBrowser(exe) {
  try { fs.mkdirSync(PROFILE_DIR, { recursive: true }); } catch (e) {}
  // 清掉残留的端口文件：否则可能连到一个已经退出的浏览器端口
  try { fs.unlinkSync(DEVTOOLS_PORT_FILE); } catch (e) {}

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
    // 老师机保持静音：页面声音只经采集管道回传给学生的手机，
    // 不落到宿主机扬声器（headless=new 默认仍可能占用系统音频输出）。
    // 该开关只静音输出设备，页面内的媒体解码与 captureStream 采集不受影响。
    '--mute-audio',
    '--hide-scrollbars',
    // 多个渲染标签页共存时，后台标签会被节流 / 停止合成，
    // 表现为「画面停在上一帧、手指滑不动」；这三个开关保证每个会话都持续渲染。
    '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    '--remote-debugging-port=0',
    '--user-data-dir=' + PROFILE_DIR,
    '--window-size=' + VIEW_WIDTH + ',' + VIEW_HEIGHT,
    'about:blank'
  ];

  var proc = cp.spawn(exe, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  state.proc = proc;

  var resolved = false;
  var output = '';
  var portFile = DEVTOOLS_PORT_FILE;

  function finish(err, cdpUrl) {
    if (resolved) return;
    resolved = true;
    clearPortPoll();
    var waiting = state.starting || [];
    state.starting = null;
    if (err) {
      state.lastError = err.message;
      console.log('[web-proxy] 兼容模式浏览器启动失败: ' + err.message);
      waiting.forEach(function (fn) { fn(err); });
      return;
    }
    state.cdpUrl = cdpUrl;
    console.log('[web-proxy] 兼容模式浏览器就绪: ' + cdpUrl);
    var client = new CdpClient(cdpUrl);
    state.cdp = client;
    client.on(dispatchEvent);
    try { proc.stdout.resume(); } catch (e) {}
    scheduleIdleKill();
    waiting.forEach(function (fn) { fn(null, client); });
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
        state.proc = null;
        return;
      }
      finish(new Error('浏览器进程启动失败'));
      state.proc = null;
      return;
    }
    state.proc = null;
    state.cdp = null;
    state.cdpUrl = '';
    clearPortPoll();
    Object.keys(state.sessions).forEach(function (id) {
      var s = state.sessions[id];
      try { sendJson(s.out, { type: 'error', message: '浏览器进程已退出' }); } catch (e) {}
      try { s.out.close(); } catch (e) {}
      delete state.sessions[id];
    });
  });

  setTimeout(function () {
    if (!resolved) {
      try { proc.kill(); } catch (e) {}
      finish(new Error('浏览器启动超时（15s）'));
    }
  }, 15000);
}

function killBrowser() {
  if (state.idleTimer) { clearTimeout(state.idleTimer); state.idleTimer = null; }
  // 转交启动时拿不到真正的浏览器进程句柄，用 CDP 让浏览器自己退出，避免留下孤儿进程
  try {
    if (state.cdp && !state.cdp.closed) state.cdp.send('Browser.close', {}).catch(function () {});
  } catch (e) {}
  try { if (state.cdp) state.cdp.close(); } catch (e) {}
  state.cdp = null;
  try { if (state.proc) state.proc.kill(); } catch (e) {}
  state.proc = null;
  state.cdpUrl = '';
}

// 没有活跃会话时，空闲一段时间后回收浏览器内存
function scheduleIdleKill() {
  if (state.idleTimer) { clearTimeout(state.idleTimer); state.idleTimer = null; }
  state.idleTimer = setTimeout(function () {
    if (Object.keys(state.sessions).length === 0 && state.cdp) killBrowser();
  }, IDLE_KILL_MS);
  if (state.idleTimer.unref) state.idleTimer.unref();
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
  var vw = clampSize(o.width, VIEW_WIDTH, MIN_WIDTH, MAX_WIDTH);
  var vh = clampSize(o.height, VIEW_HEIGHT, MIN_HEIGHT, MAX_HEIGHT);
  var dpr = clampSize(o.dpr, 1, 1, MAX_DPR);
  var touch = !!o.touch;

  ensureBrowser(function (err, cdp) {
    if (err) return cb(err);
    cdp.send('Target.createTarget', { url: 'about:blank' }).then(function (r) {
      var targetId = r.targetId;
      return cdp.send('Target.attachToTarget', { targetId: targetId, flatten: true }).then(function (a) {
        var sessionId = a.sessionId;
        var id = String(++state.seq);
        var sess = {
          id: id,
          targetId: targetId,
          cdpSession: sessionId,
          out: out,
          lastActive: Date.now(),
          url: url,
          width: vw,
          height: vh,
          dpr: dpr,
          touch: touch,
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
          // 画面帧因积压被丢弃后，页面静止就不会再出帧，需要主动补拍一张最新画面
          needRefresh: false,
          refreshTimer: null,
          refreshTries: 0
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
  if (!state.cdp) return Promise.reject(new Error('渲染引擎未就绪'));
  if (!/^https?:\/\//i.test(url)) return Promise.reject(new Error('仅支持 http/https 地址'));
  sess.url = url;
  sess.lastActive = Date.now();
  // 换页面后回到 100%：上一个站点放大的倍率不该带到下一个站点
  sess.pageScale = 1;
  return state.cdp.send('Page.navigate', { url: url }, sess.cdpSession);
}

// 当前会话档位对应的 screencast 参数（尺寸按物理像素下发）
function screencastParams(sess) {
  var lv = QUALITY_LEVELS[sess.qualityLevel] || QUALITY_LEVELS[0];
  return {
    format: 'jpeg',
    quality: lv.quality,
    maxWidth: Math.round(sess.width * sess.dpr),
    maxHeight: Math.round(sess.height * sess.dpr),
    everyNthFrame: lv.everyNthFrame
  };
}

// 按当前会话视口重开 screencast：改过视口后必须重开，否则帧尺寸仍是旧的
function restartScreencast(sess) {
  if (!state.cdp || !sess) return Promise.resolve();
  var sid = sess.cdpSession;
  var start = function () {
    // 暂停期间（页面隐藏）不重开帧流，恢复时由 resume 统一启动
    if (sess.paused) return Promise.resolve();
    return state.cdp.send('Page.startScreencast', screencastParams(sess), sid);
  };
  return state.cdp.send('Page.stopScreencast', {}, sid).then(start, start);
}

// 自适应画质：每隔一个窗口看丢帧比例，持续跟不上就降一档；长时间稳定再回升
function adaptScreencast(sess) {
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
    fps: Math.round(60 / QUALITY_LEVELS[sess.qualityLevel].everyNthFrame)
  });
}

// 补拍最新画面：丢帧后等客户端缓冲回落到低水位，再主动截一张当前画面，
// 保证「滑动结束 / 动画停止」后屏幕一定停在最终状态，而不是旧帧。
function scheduleRefresh(sess) {
  if (!sess || sess.refreshTimer || sess.paused) return;
  sess.refreshTimer = setTimeout(function () {
    sess.refreshTimer = null;
    if (!sess.needRefresh || sess.paused) return;
    if (!state.cdp || !state.sessions[sess.id]) return;
    var limit = sess.touch ? FRAME_MAX_BUFFER_TOUCH : FRAME_MAX_BUFFER;
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
    state.cdp.send('Page.captureScreenshot', {
      format: 'jpeg',
      quality: lv.quality,
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
  // 会话关闭时清掉补拍定时器，避免对已关闭的连接继续截图
  if (sess.refreshTimer) {
    clearTimeout(sess.refreshTimer);
    sess.refreshTimer = null;
  }
  if (state.cdp) {
    try { state.cdp.send('Target.closeTarget', { targetId: sess.targetId }).catch(function () {}); } catch (e) {}
  }
  if (notify) sendJson(sess.out, { type: 'closed' });
  try { sess.out.close(); } catch (e) {}
  scheduleIdleKill();
}

function findSessionByCdp(cdpSessionId) {
  for (var id in state.sessions) {
    if (state.sessions[id].cdpSession === cdpSessionId) return state.sessions[id];
  }
  return null;
}

// 查询页面自身的导航历史，让前端的「返回 / 前进」按钮反映真实可用状态
function sendHistoryState(sess) {
  if (!state.cdp || !sess) return;
  state.cdp.send('Page.getNavigationHistory', {}, sess.cdpSession).then(function (r) {
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

function dispatchEvent(method, params, cdpSessionId) {
  var sess = findSessionByCdp(cdpSessionId);
  if (!sess) return;
  if (method === 'Page.screencastFrame') {
    var backlog = 0;
    try { backlog = sess.out.bufferedAmount || 0; } catch (e) {}
    var frameLimit = sess.touch ? FRAME_MAX_BUFFER_TOUCH : FRAME_MAX_BUFFER;
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
      state.cdp.send('Page.screencastFrameAck', { sessionId: params.sessionId }, cdpSessionId).catch(function () {});
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
    if (sess.audioEnabled && !sess.paused && AUDIO_INJECT) {
      try {
        state.cdp.send('Runtime.evaluate', {
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
    try {
      state.cdp.send('Runtime.evaluate', { expression: 'document.title', returnByValue: true }, cdpSessionId)
        .then(function (r) {
          var title = r && r.result ? String(r.result.value || '') : '';
          if (title) sendJson(sess.out, { type: 'title', title: title });
        }).catch(function () {});
    } catch (e) {}
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
    if (sess.audioEnabled && !sess.paused && ctxInfo.id && AUDIO_INJECT) {
      state.cdp.send('Runtime.evaluate', {
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
      state.cdp.send('Page.handleJavaScriptDialog', { accept: true }, cdpSessionId).catch(function () {});
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
  if (!state.cdp || !sess) return;
  sess.lastActive = Date.now();
  var cdp = state.cdp;
  var sid = sess.cdpSession;
  // 输入事件失败只需记一次，避免把日志刷爆
  function guard(promise, label) {
    promise.catch(function (e) {
      if (!sess.inputErrorLogged) {
        sess.inputErrorLogged = true;
        console.log('[web-proxy] ' + label + ' 事件失败: ' + e.message);
      }
    });
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
    createSession(url, client, {
      width: params.w,
      height: params.h,
      dpr: params.dpr,
      touch: params.touch === '1'
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
        touch: sess.touch
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
  return {
    available: !!findBrowser(),
    browser: findBrowser(),
    running: !!(state.cdp && !state.cdp.closed),
    sessions: sessionCount(),
    maxSessions: MAX_SESSIONS,
    lastError: state.lastError
  };
}

module.exports = {
  handleUpgrade: handleUpgrade,
  status: status,
  kill: killBrowser
};
