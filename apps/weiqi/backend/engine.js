/*
 * 围棋 —— KataGo 服务器引擎适配器
 *
 * 引擎与模型不放进市场应用包（KataGo Windows 版依赖 .dll，且模型是 .bin.gz，
 * 不在市场文件白名单内）。默认从服务器的 Resources/engines/katago 读取，
 * 也可用环境变量 WEIQI_KATAGO_DIR 指定。
 *
 * 目录内需要：
 *   katago.exe（OpenCL 版；同目录保留 katago-eigen.exe 作为 CPU 后备）、
 *   analysis.cfg 以及依赖的 DLL。
 *   model.bin.gz —— 唯一模型（b18c384nbt），对局应手、AI 分析、整盘复盘都用它。
 *
 * 一台服务器只启动一个 analysis 进程，请求串行排队，避免把 CPU 打满。
 */
'use strict';

var fs = require('fs');
var path = require('path');
var childProcess = require('child_process');

var MAX_QUEUE = 3;
var QUERY_TIMEOUT_MS = 20000;
var BOOT_TIMEOUT_MS = 25000;
var ASSUME_READY_MS = 3500;
var COOLDOWN_MS = 10000;

var slotCache = null;

function engineError(code, message) {
  var err = new Error(message || code);
  err.code = code;
  return err;
}

function serverRoot() {
  // backend/engine.js -> weiqi -> market-apps -> 服务器根目录
  return path.resolve(__dirname, '..', '..', '..');
}

function findBase() {
  var dirs = [];
  if (process.env.WEIQI_KATAGO_DIR) dirs.push(path.resolve(process.env.WEIQI_KATAGO_DIR));
  // 市场应用可能位于 <根>/market-apps/weiqi/backend，也可能位于
  // <根>/market/apps/weiqi/backend（市场仓）。两种路径都尝试。
  dirs.push(path.join(serverRoot(), 'Resources', 'engines', 'katago'));
  dirs.push(path.resolve(serverRoot(), '..', 'ClassIntra', 'Resources', 'engines', 'katago'));
  dirs.push(path.join(__dirname, 'engine'));

  var exeNames = process.platform === 'win32' ? ['katago.exe', 'katago'] : ['katago', 'katago.exe'];
  for (var d = 0; d < dirs.length; d += 1) {
    var dir = dirs[d];
    if (!fs.existsSync(dir)) continue;
    var exe = null;
    for (var e = 0; e < exeNames.length; e += 1) {
      var candidate = path.join(dir, exeNames[e]);
      if (fs.existsSync(candidate)) { exe = candidate; break; }
    }
    if (!exe) continue;
    var cfg = null;
    var cfgNames = ['analysis.cfg', 'analysis_example.cfg'];
    for (var c = 0; c < cfgNames.length; c += 1) {
      var cfgPath = path.join(dir, cfgNames[c]);
      if (fs.existsSync(cfgPath)) { cfg = { file: cfgPath, name: cfgNames[c] }; break; }
    }
    if (!cfg) continue;
    return { dir: dir, exe: exe, config: cfg };
  }
  return null;
}

function listModels(dir) {
  try {
    var names = fs.readdirSync(dir);
    var list = [];
    for (var i = 0; i < names.length; i += 1) {
      if (/\.bin\.gz$/i.test(names[i])) list.push(names[i]);
    }
    return list;
  } catch (e) {
    return [];
  }
}

function pickModel(dir) {
  var preferred = ['model.bin.gz', 'model-b10c128.bin.gz', 'model-fast.bin.gz', 'model-b6c96.bin.gz'];
  for (var i = 0; i < preferred.length; i += 1) {
    if (fs.existsSync(path.join(dir, preferred[i]))) return preferred[i];
  }
  var all = listModels(dir);
  return all.length ? all[0] : '';
}

function resolve() {
  var base = findBase();
  if (!base) return null;
  var modelName = pickModel(base.dir);
  if (!modelName) return null;
  return { base: base, modelName: modelName, modelFile: path.join(base.dir, modelName) };
}

function available() {
  return !!findBase();
}

function clearTimer(item) {
  if (item && item.timer) {
    clearTimeout(item.timer);
    item.timer = null;
  }
}

function Slot(kind) {
  this.kind = kind;
  this.proc = null;
  this.ready = false;
  this.booting = null;
  this.readyFn = null;
  this.bootTimer = null;
  this.assumeTimer = null;
  this.activeId = null;
  this.queue = [];
  this.pending = {};
  this.failedUntil = 0;
  this.stderrTail = '';
  this.lastError = '';
  this.seq = 0;
}

Slot.prototype.rejectAll = function (err) {
  var id;
  for (id in this.pending) {
    if (!Object.prototype.hasOwnProperty.call(this.pending, id)) continue;
    var item = this.pending[id];
    clearTimer(item);
    try { item.reject(err); } catch (e) {}
  }
  this.pending = {};
  this.activeId = null;
  while (this.queue.length) {
    var q = this.queue.shift();
    try { q.reject(err); } catch (e) {}
  }
};

Slot.prototype.resetProcess = function (errorMessage) {
  if (errorMessage) this.lastError = errorMessage;
  this.proc = null;
  this.ready = false;
  this.booting = null;
  this.readyFn = null;
  if (this.bootTimer) { clearTimeout(this.bootTimer); this.bootTimer = null; }
  if (this.assumeTimer) { clearTimeout(this.assumeTimer); this.assumeTimer = null; }
  this.failedUntil = Date.now() + COOLDOWN_MS;
};

Slot.prototype.killProcess = function (errorMessage) {
  var old = this.proc;
  this.resetProcess(errorMessage);
  if (old) {
    try { old.kill(); } catch (e) {}
  }
};

Slot.prototype.settle = function (id, err, result) {
  var item = this.pending[id];
  if (!item) return;
  clearTimer(item);
  delete this.pending[id];
  if (this.activeId === id) this.activeId = null;
  if (err) item.reject(err);
  else item.resolve(result);
  this.processQueue();
};

Slot.prototype.markReady = function () {
  if (this.ready) return;
  this.ready = true;
  this.booting = null;
  if (this.bootTimer) { clearTimeout(this.bootTimer); this.bootTimer = null; }
  if (this.assumeTimer) { clearTimeout(this.assumeTimer); this.assumeTimer = null; }
};

Slot.prototype.handleStdoutLine = function (line) {
  var text = String(line || '').trim();
  if (!text || text.charAt(0) !== '{') return;
  var msg;
  try { msg = JSON.parse(text); } catch (e) { return; }
  if (!msg || !msg.id || !this.pending[msg.id]) return;
  if (msg.isDuringSearch === true) return;
  if (msg.error) {
    this.lastError = String(msg.error);
    console.error('[weiqi-ai:' + this.kind + '] engine error: ' + this.lastError);
    this.settle(msg.id, engineError('ENGINE_ERROR', 'KataGo 返回错误：' + this.lastError));
    return;
  }
  if (msg.rootInfo && Array.isArray(msg.moveInfos)) {
    this.settle(msg.id, null, msg);
  }
};

Slot.prototype.handleStderr = function (chunk) {
  var text = chunk.toString();
  this.stderrTail = (this.stderrTail + text).slice(-4000);
  if (text.indexOf('Started, ready to begin handling requests') !== -1) {
    if (this.readyFn) this.readyFn();
    else this.markReady();
  }
};

Slot.prototype.ensureProcess = function () {
  var self = this;
  if (this.proc && this.ready) return Promise.resolve();
  if (this.booting) return this.booting;
  if (Date.now() < this.failedUntil) {
    return Promise.reject(engineError('COOLDOWN', 'KataGo 正在重启，请稍后'));
  }
  var info = resolve();
  if (!info) return Promise.reject(engineError('UNAVAILABLE', '服务器未安装 KataGo 引擎或模型'));

  this.lastError = '';
  this.stderrTail = '';
  try {
    this.proc = childProcess.spawn(info.base.exe, ['analysis', '-config', info.base.config.name, '-model', info.modelName], {
      cwd: info.base.dir,
      windowsHide: true
    });
  } catch (e) {
    this.proc = null;
    this.failedUntil = Date.now() + COOLDOWN_MS;
    return Promise.reject(engineError('SPAWN_FAILED', 'KataGo 启动失败'));
  }

  var child = this.proc;
  this.ready = false;
  this.booting = new Promise(function (resolveBoot, rejectBoot) {
    var settled = false;
    function fail(err) {
      if (settled) return;
      settled = true;
      self.readyFn = null;
      self.resetProcess(err && err.message ? err.message : 'KataGo 启动失败');
      try { child.kill(); } catch (e) {}
      rejectBoot(err);
    }
    function ok() {
      if (settled) return;
      settled = true;
      self.readyFn = null;
      self.markReady();
      resolveBoot();
    }
    self.readyFn = ok;
    self.bootTimer = setTimeout(function () {
      fail(engineError('BOOT_TIMEOUT', 'KataGo 启动超时' + (self.stderrTail ? '：' + self.stderrTail.slice(-300) : '')));
    }, BOOT_TIMEOUT_MS);
    // 引擎启动较慢时也先把请求写进 stdin，KataGo 就绪后会自行读取。
    self.assumeTimer = setTimeout(function () {
      if (child && !settled) ok();
    }, ASSUME_READY_MS);

    child.stdout.setEncoding('utf8');
    var buffer = '';
    child.stdout.on('data', function (chunk) {
      buffer += chunk;
      var lines = buffer.split(/\r?\n/);
      buffer = lines.pop();
      for (var i = 0; i < lines.length; i += 1) self.handleStdoutLine(lines[i]);
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', function (chunk) {
      self.handleStderr(chunk);
    });
    child.on('error', function (err) {
      fail(engineError('SPAWN_FAILED', 'KataGo 进程错误：' + (err && err.message ? err.message : '')));
    });
    child.on('exit', function (code) {
      var wasThis = self.proc === child;
      if (!wasThis) return;
      var msg = 'KataGo 引擎退出（code ' + code + '）';
      self.resetProcess(msg);
      if (!settled) fail(engineError('EXITED', msg));
      self.rejectAll(engineError('EXITED', msg));
    });
  });
  return this.booting;
};

Slot.prototype.processQueue = function () {
  var self = this;
  if (this.activeId || !this.queue.length) return;
  this.ensureProcess().then(function () {
    if (self.activeId || !self.queue.length || !self.proc) return;
    var item = self.queue.shift();
    self.activeId = item.id;
    self.pending[item.id] = item;
    item.timer = setTimeout(function () {
      self.lastError = '查询超时';
      self.killProcess('KataGo 查询超时');
      self.settle(item.id, engineError('TIMEOUT', 'KataGo 查询超时'));
    }, QUERY_TIMEOUT_MS);
    try {
      item.payload.id = item.id;
      self.proc.stdin.write(JSON.stringify(item.payload) + '\n');
    } catch (e) {
      self.killProcess('KataGo 写入失败');
      self.settle(item.id, engineError('WRITE_FAILED', 'KataGo 写入失败'));
    }
  }, function (err) {
    var item = self.queue.shift();
    if (item) item.reject(err);
    if (self.queue.length) setTimeout(function () { self.processQueue(); }, 0);
  });
};

Slot.prototype.analyze = function (payload) {
  var self = this;
  if (!resolve()) {
    return Promise.reject(engineError('UNAVAILABLE', '服务器未安装 KataGo 引擎或模型'));
  }
  if (this.queue.length >= MAX_QUEUE) {
    return Promise.reject(engineError('BUSY', 'KataGo 正在忙，请稍后再试'));
  }
  return new Promise(function (resolvePromise, rejectPromise) {
    self.seq += 1;
    var id = 'weiqi-ai-' + self.kind + '-' + self.seq;
    self.queue.push({ id: id, payload: payload, resolve: resolvePromise, reject: rejectPromise, timer: null });
    self.processQueue();
  });
};

Slot.prototype.warmup = function () {
  var self = this;
  return this.ensureProcess().then(function () { return self.status(); });
};

Slot.prototype.shutdown = function () {
  this.rejectAll(engineError('SHUTDOWN', 'KataGo 已关闭'));
  this.killProcess('');
};

Slot.prototype.status = function () {
  var info = resolve();
  return {
    model: info ? info.modelName : '',
    running: !!this.proc,
    ready: this.ready,
    busy: !!this.activeId,
    queue: this.queue.length,
    lastError: this.lastError || ''
  };
};

function getSlot() {
  if (!slotCache) slotCache = new Slot('default');
  return slotCache;
}

function status() {
  var slot = getSlot().status();
  return {
    available: available(),
    running: slot.running,
    ready: slot.ready,
    busy: slot.busy,
    queue: slot.queue,
    engine: 'KataGo',
    model: slot.model,
    lastError: slot.lastError
  };
}

function warmup() {
  return getSlot().warmup();
}

function analyze(payload) {
  return getSlot().analyze(payload);
}

function shutdown() {
  if (slotCache) {
    try { slotCache.shutdown(); } catch (e) {}
  }
  slotCache = null;
}

if (process && typeof process.on === 'function') {
  process.on('exit', function () {
    try { shutdown(); } catch (e) {}
  });
}

module.exports = {
  available: available,
  status: status,
  warmup: warmup,
  analyze: analyze,
  shutdown: shutdown
};
