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
var SCREENCAST_QUALITY = 55;

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

// 建立一次渲染会话：新建标签页 → 开启 screencast → 导航到目标地址
function createSession(url, out, cb) {
  if (sessionCount() >= MAX_SESSIONS) {
    return cb(new Error('兼容模式同时最多 ' + MAX_SESSIONS + ' 个会话，请稍后再试'));
  }
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
          url: url
        };
        state.sessions[id] = sess;
        return cdp.send('Page.enable', {}, sessionId)
          .then(function () {
            return cdp.send('Emulation.setDeviceMetricsOverride', {
              width: VIEW_WIDTH,
              height: VIEW_HEIGHT,
              deviceScaleFactor: 1,
              mobile: false
            }, sessionId);
          })
          .then(function () {
            return cdp.send('Page.startScreencast', {
              format: 'jpeg',
              quality: SCREENCAST_QUALITY,
              maxWidth: VIEW_WIDTH,
              maxHeight: VIEW_HEIGHT,
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

function navigate(sess, url) {
  if (!state.cdp) return Promise.reject(new Error('渲染引擎未就绪'));
  if (!/^https?:\/\//i.test(url)) return Promise.reject(new Error('仅支持 http/https 地址'));
  sess.url = url;
  sess.lastActive = Date.now();
  return state.cdp.send('Page.navigate', { url: url }, sess.cdpSession);
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

// ---- CDP 事件分发 ----

function dispatchEvent(method, params, cdpSessionId) {
  var sess = findSessionByCdp(cdpSessionId);
  if (!sess) return;
  if (method === 'Page.screencastFrame') {
    sendJson(sess.out, {
      type: 'frame',
      data: params.data,
      width: (params.metadata && params.metadata.deviceWidth) || VIEW_WIDTH,
      height: (params.metadata && params.metadata.deviceHeight) || VIEW_HEIGHT
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
    }
    return;
  }
  if (method === 'Page.loadEventFired') {
    sendJson(sess.out, { type: 'loaded' });
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

  if (msg.type === 'mouse') {
    cdp.send('Input.dispatchMouseEvent', {
      type: msg.event || 'mouseMoved',
      x: Number(msg.x) || 0,
      y: Number(msg.y) || 0,
      button: msg.button || 'none',
      buttons: Number(msg.buttons) || 0,
      clickCount: Number(msg.clickCount) || 0
    }, sid).catch(function () {});
    return;
  }
  if (msg.type === 'wheel') {
    cdp.send('Input.dispatchMouseEvent', {
      type: 'mouseWheel',
      x: Number(msg.x) || 0,
      y: Number(msg.y) || 0,
      deltaX: Number(msg.deltaX) || 0,
      deltaY: Number(msg.deltaY) || 0
    }, sid).catch(function () {});
    return;
  }
  if (msg.type === 'text') {
    cdp.send('Input.insertText', { text: String(msg.text || '') }, sid).catch(function () {});
    return;
  }
  if (msg.type === 'key') {
    var k = String(msg.key || '');
    var info = KEY_CODES[k];
    var isDown = msg.event !== 'up';
    if (info) {
      cdp.send('Input.dispatchKeyEvent', {
        type: isDown ? 'rawKeyDown' : 'keyUp',
        key: k,
        code: info.code,
        windowsVirtualKeyCode: info.vk,
        nativeVirtualKeyCode: info.vk
      }, sid).catch(function () {});
      return;
    }
    // 可打印字符：走 insertText 更稳（避免输入法/组合键问题）
    if (isDown && k.length === 1) {
      cdp.send('Input.insertText', { text: k }, sid).catch(function () {});
    }
    return;
  }
  if (msg.type === 'navigate') {
    navigate(sess, String(msg.url || '')).catch(function () {});
    return;
  }
  if (msg.type === 'reload') {
    cdp.send('Page.reload', { ignoreCache: !!msg.hard }, sid).catch(function () {});
    return;
  }
  if (msg.type === 'back') {
    cdp.send('Runtime.evaluate', { expression: 'history.back()' }, sid).catch(function () {});
    return;
  }
  if (msg.type === 'forward') {
    cdp.send('Runtime.evaluate', { expression: 'history.forward()' }, sid).catch(function () {});
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
  var url = '';
  var parts = query.split('&');
  for (var i = 0; i < parts.length; i++) {
    var kv = parts[i].split('=');
    if (kv[0] === 'url') {
      try { url = decodeURIComponent(kv.slice(1).join('=')); } catch (e) { url = kv.slice(1).join('='); }
    }
  }

  var wss = new WS.Server({ noServer: true, perMessageDeflate: false, maxPayload: 4 * 1024 * 1024 });
  wss.handleUpgrade(req, socket, head, function (client) {
    if (!url || !/^https?:\/\//i.test(url)) {
      sendJson(client, { type: 'error', message: '缺少合法的 url 参数' });
      try { client.close(); } catch (e) {}
      return;
    }
    createSession(url, client, function (err, sess) {
      if (err) {
        sendJson(client, { type: 'error', message: err.message });
        try { client.close(); } catch (e) {}
        return;
      }
      sendJson(client, { type: 'ready', session: sess.id, width: VIEW_WIDTH, height: VIEW_HEIGHT });
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
