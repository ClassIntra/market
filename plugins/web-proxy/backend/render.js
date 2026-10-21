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
var SCREENCAST_QUALITY = 55;

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

  try { fs.mkdirSync(PROFILE_DIR, { recursive: true }); } catch (e) {}

  var args = [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--disable-background-networking',
    '--mute-audio',
    '--hide-scrollbars',
    '--remote-debugging-port=0',
    '--user-data-dir=' + PROFILE_DIR,
    '--window-size=' + VIEW_WIDTH + ',' + VIEW_HEIGHT,
    'about:blank'
  ];

  var proc = cp.spawn(exe, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  state.proc = proc;

  var resolved = false;
  var output = '';

  function finish(err, cdpUrl) {
    if (resolved) return;
    resolved = true;
    var waiting = state.starting || [];
    state.starting = null;
    if (err) {
      state.lastError = err.message;
      waiting.forEach(function (fn) { fn(err); });
      return;
    }
    state.cdpUrl = cdpUrl;
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

  try { proc.stderr.on('data', onData); } catch (e) {}
  try { proc.stdout.on('data', onData); } catch (e) {}

  proc.on('error', function (e) { finish(e); });
  proc.on('exit', function () {
    if (!resolved) finish(new Error('浏览器进程启动失败'));
    state.proc = null;
    state.cdp = null;
    state.cdpUrl = '';
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
    if (Object.keys(state.sessions).length === 0 && state.proc) killBrowser();
  }, IDLE_KILL_MS);
  if (state.idleTimer.unref) state.idleTimer.unref();
}

// ---- 会话 ----

function sendJson(ws, obj) {
  try {
    if (ws.readyState === WS.OPEN) ws.send(JSON.stringify(obj));
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
          touch: touch
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
            return cdp.send('Emulation.setDeviceMetricsOverride', {
              width: vw,
              height: vh,
              deviceScaleFactor: dpr,
              mobile: touch
            }, sessionId);
          })
          .then(function () {
            // 帧尺寸按物理像素下发（dpr 缩放），前端画布等比显示，文字更清晰
            return cdp.send('Page.startScreencast', {
              format: 'jpeg',
              quality: SCREENCAST_QUALITY,
              maxWidth: Math.round(vw * dpr),
              maxHeight: Math.round(vh * dpr),
              everyNthFrame: 1
            }, sessionId);
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
  return state.cdp.send('Page.navigate', { url: url }, sess.cdpSession);
}

// 按当前会话视口重开 screencast：改过视口后必须重开，否则帧尺寸仍是旧的
function restartScreencast(sess) {
  if (!state.cdp || !sess) return Promise.resolve();
  var sid = sess.cdpSession;
  var start = function () {
    return state.cdp.send('Page.startScreencast', {
      format: 'jpeg',
      quality: SCREENCAST_QUALITY,
      maxWidth: Math.round(sess.width * sess.dpr),
      maxHeight: Math.round(sess.height * sess.dpr),
      everyNthFrame: 1
    }, sid);
  };
  return state.cdp.send('Page.stopScreencast', {}, sid).then(start, start);
}

function closeSession(sess, notify) {
  if (!sess) return;
  delete state.sessions[sess.id];
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
    sendJson(sess.out, {
      type: 'frame',
      data: params.data,
      // viewWidth/viewHeight 是坐标换算的唯一依据（Input.* 用 CSS 像素）；
      // 帧的实际像素以 JPEG 为准，前端按 naturalWidth 校正画布，避免高 dpr 下裁切。
      width: (params.metadata && params.metadata.deviceWidth) || sess.width,
      height: (params.metadata && params.metadata.deviceHeight) || sess.height,
      viewWidth: sess.width,
      viewHeight: sess.height
    });
    try {
      state.cdp.send('Page.screencastFrameAck', { sessionId: params.sessionId }, cdpSessionId).catch(function () {});
    } catch (e) {}
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
  if (msg.type === 'back') {
    guard(cdp.send('Runtime.evaluate', { expression: 'history.back()' }, sid), 'back');
    return;
  }
  if (msg.type === 'forward') {
    guard(cdp.send('Runtime.evaluate', { expression: 'history.forward()' }, sid), 'forward');
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
