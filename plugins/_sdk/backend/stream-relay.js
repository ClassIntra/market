// ClassIntra 插件 SDK - 媒体中转
// 抽取自 netease-music 插件的通用能力，供所有需要「客户端零外网依赖」的插件复用：
//   1. proxyConnect     —— HTTP 代理 CONNECT 隧道（HTTPS 目标）
//   2. fetchRaw         —— 通用出站请求（http/https 双协议、跟随一次 302、代理支持）
//   3. createRelay      —— 中转器工厂（音频 Range 断点续传 + 磁盘缓存 LRU、图片白名单透传）
//   4. createTicketKit  —— 一次性取流票据（<audio>/<img> 标签无法携带 Authorization 头）
// 零第三方依赖，仅 Node 内置模块（http/https/fs/path/crypto）。
//
// 插件侧使用方式（backend 目录内）：
//   var sdk = require('../../_sdk/backend/stream-relay');
//   var relay = sdk.createRelay({ getConfig: function () { return store.getConfig(); }, imageHostAllow: /正则/ });
//   var tickets = sdk.createTicketKit(store, 'streamticket:');
//   await relay.streamAudio(req, res, { resolveStreamUrl, songId, quality, userId });

var http = require('http');
var https = require('https');
var fs = require('fs');
var path = require('path');
var crypto = require('crypto');

// ---------- 一次性取流票据 ----------

// 票据工具工厂：把「资源 + 用户身份」绑定到短时票据上，弥补 <audio>/<img> 无法带请求头的限制。
// ticketStore 需提供：cacheGet(key) → { fresh, payload } | null；cacheSet(key, payload, ttl)
// （netease-music 的插件缓存表 cacheGet/cacheSet 直接满足该接口）
// prefix 用于同一缓存表内隔离不同插件的票据键空间。
function createTicketKit(ticketStore, prefix) {
  var p = prefix || 'streamticket:';
  return {
    // 创建票据：payload 为任意可 JSON 化对象（如 { userId, songId }），默认 15 分钟有效
    create: function (payload, ttl) {
      var ticket = crypto.randomBytes(16).toString('hex');
      ticketStore.cacheSet(p + ticket, payload || {}, ttl || 15 * 60 * 1000);
      return ticket;
    },
    // 校验票据：有效返回绑定的 payload，过期/不存在返回 null
    verify: function (ticket) {
      if (!ticket) return null;
      var entry = ticketStore.cacheGet(p + String(ticket));
      return entry && entry.fresh ? entry.payload : null;
    }
  };
}

// ---------- 代理隧道与出站请求 ----------

// 经 HTTP 代理为 HTTPS 目标建立 CONNECT 隧道（零依赖）
function proxyConnect(proxyUrl, targetHost, targetPort) {
  return new Promise(function (resolve, reject) {
    var p = new URL(proxyUrl);
    var req = http.request({
      hostname: p.hostname,
      port: parseInt(p.port, 10) || 80,
      method: 'CONNECT',
      path: targetHost + ':' + targetPort,
      headers: { 'Host': targetHost + ':' + targetPort }
    });
    req.on('connect', function (res, socket) {
      if (res.statusCode !== 200) { socket.destroy(); return reject(new Error('代理 CONNECT 失败: ' + res.statusCode)); }
      resolve(socket);
    });
    req.on('error', reject);
    req.setTimeout(15000, function () { req.destroy(new Error('代理连接超时')); });
    req.end();
  });
}

// 通用出站请求（跟随一次 302，返回 { status, headers, stream }）
// proxyUrl 提供时：https 目标走 CONNECT 隧道；http 目标向代理发绝对路径请求
function fetchRaw(url, headers, proxyUrl) {
  return new Promise(function (resolve, reject) {
    var u = new URL(url);
    var port = parseInt(u.port, 10) || (u.protocol === 'http:' ? 80 : 443);
    var lib = u.protocol === 'http:' ? http : https;
    var mergedHeaders = Object.assign({
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Accept': '*/*'
    }, headers || {});

    function handle(res) {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume(); // 排空后跟随跳转
        var next = new URL(res.headers.location, url).toString();
        fetchRaw(next, headers, proxyUrl).then(resolve, reject);
        return;
      }
      resolve({ status: res.statusCode, headers: res.headers, stream: res });
    }
    function bind(r) {
      r.on('error', reject);
      r.setTimeout(15000, function () { r.destroy(new Error('媒体请求超时')); });
      r.end();
    }

    var req;
    if (proxyUrl && u.protocol === 'https:') {
      proxyConnect(proxyUrl, u.hostname, port).then(function (socket) {
        req = https.request({
          hostname: u.hostname, port: port, path: u.pathname + u.search,
          method: 'GET', headers: mergedHeaders, socket: socket, agent: false
        }, handle);
        bind(req);
      }, reject);
      return;
    }
    if (proxyUrl && u.protocol === 'http:') {
      var p = new URL(proxyUrl);
      mergedHeaders['Host'] = u.hostname;
      req = http.request({
        hostname: p.hostname, port: parseInt(p.port, 10) || 80,
        path: url, method: 'GET', headers: mergedHeaders
      }, handle);
      bind(req);
      return;
    }
    req = lib.request({
      hostname: u.hostname, port: port, path: u.pathname + u.search,
      method: 'GET', headers: mergedHeaders
    }, handle);
    bind(req);
  });
}

// ---------- 中转器工厂 ----------

// createRelay(options)：
//   options.getConfig     fn() → 配置对象，字段：proxy（出站代理）、audioCache（'1'/'0'）、
//                         audioCacheMaxMB（数字字符串）、cacheDir（磁盘缓存目录）
//   options.imageHostAllow RegExp，图片中转域名白名单（不传则拒绝所有图片请求）
//   options.audioMime     音频响应 Content-Type，默认 'audio/mpeg'
//
// 返回 { streamAudio, streamImage }：
//   streamAudio(req, res, opts) —— opts: { resolveStreamUrl, songId, quality, userId }
//     resolveStreamUrl: async (songId, quality, userId) → { url } | null（由插件提供，避免与网关循环依赖）
//   streamImage(req, res, imageUrl)
function createRelay(options) {
  options = options || {};
  var getConfig = options.getConfig || function () { return {}; };
  var audioMime = options.audioMime || 'audio/mpeg';
  var imageHostAllow = options.imageHostAllow || null;
  var imageHeaders = options.imageHeaders || {}; // 图片上游请求附加头（如 Referer 防盗链）

  // 音频缓存大小上限（MB → 字节），非法值回退 512MB
  function audioCacheMaxBytes() {
    var mb = parseInt(getConfig().audioCacheMaxMB, 10);
    if (!isFinite(mb) || mb <= 0) mb = 512;
    return mb * 1024 * 1024;
  }

  // 缓存文件路径：对 key 做哈希避免非法字符
  function cacheFilePath(key) {
    var dir = getConfig().cacheDir;
    if (!dir) return null;
    return path.join(dir, crypto.createHash('md5').update(String(key)).digest('hex') + '.media');
  }

  // LRU 清理：按访问时间删除最久未使用的缓存文件，直到总大小低于上限
  function evictCacheIfNeeded(extraBytes) {
    var dir = getConfig().cacheDir;
    if (!dir || !fs.existsSync(dir)) return;
    var maxBytes = audioCacheMaxBytes();
    var files = [];
    var total = 0;
    var names = fs.readdirSync(dir);
    for (var i = 0; i < names.length; i++) {
      var full = path.join(dir, names[i]);
      try {
        var st = fs.statSync(full);
        files.push({ full: full, size: st.size, atime: st.atimeMs });
        total += st.size;
      } catch (e) { /* 文件可能已被并发删除 */ }
    }
    if (total + (extraBytes || 0) <= maxBytes) return;
    files.sort(function (a, b) { return a.atime - b.atime; });
    for (var j = 0; j < files.length && total + (extraBytes || 0) > maxBytes; j++) {
      try { fs.unlinkSync(files[j].full); total -= files[j].size; } catch (e) { /* 忽略 */ }
    }
  }

  // 把上游流管道到响应，并按需落盘缓存
  function pipeWithCache(upstreamRes, res, cachePath, shouldCache) {
    var tmpPath = cachePath ? cachePath + '.part' : null;
    if (cachePath && shouldCache) {
      var ws = fs.createWriteStream(tmpPath);
      var failed = false;
      upstreamRes.stream.on('error', function () { failed = true; try { fs.unlinkSync(tmpPath); } catch (e) {} });
      ws.on('error', function () { failed = true; });
      upstreamRes.stream.pipe(ws);
      upstreamRes.stream.pipe(res);
      ws.on('finish', function () {
        if (failed) { try { fs.unlinkSync(tmpPath); } catch (e) {} return; }
        // 落盘成功后按新文件大小触发容量清理
        var size = 0;
        try { size = fs.statSync(tmpPath).size; } catch (e) {}
        fs.renameSync(tmpPath, cachePath);
        evictCacheIfNeeded(size);
      });
    } else {
      upstreamRes.stream.pipe(res);
    }
  }

  // 音频中转：支持 Range 断点续传（拖动进度条）+ 可选磁盘缓存（LRU 清理）
  // 逻辑：
  //   1. 计算缓存 key（音质 + 歌曲），命中且 Range 可满足 → 直接读磁盘
  //   2. 否则经 resolveStreamUrl 取真实播放地址，携带 Range 请求上游并透传
  //   3. 无 Range（完整下载）且开启缓存时落盘
  async function streamAudio(req, res, opts) {
    var resolveStreamUrl = opts.resolveStreamUrl;
    var songId = String(opts.songId);
    var quality = opts.quality || '';
    var userId = opts.userId || null;
    var rangeHeader = req.headers.range || '';
    var cachePath = cacheFilePath('audio:' + quality + ':' + songId);
    var audioCacheOn = getConfig().audioCache === '1';

    // 1) 磁盘缓存命中
    if (audioCacheOn && cachePath && fs.existsSync(cachePath)) {
      var size = fs.statSync(cachePath).size;
      var start = 0;
      var end = size - 1;
      if (rangeHeader) {
        var m = /bytes=(\d*)-(\d*)/.exec(rangeHeader);
        if (m && m[1] !== '') start = parseInt(m[1], 10);
        if (m && m[2] !== '') end = parseInt(m[2], 10);
        if (start >= size) {
          res.writeHead(416, { 'Content-Range': 'bytes */' + size });
          return res.end();
        }
      }
      var chunkSize = end - start + 1;
      var rs = fs.createReadStream(cachePath, { start: start, end: end });
      res.writeHead(rangeHeader ? 206 : 200, {
        'Content-Type': audioMime,
        'Accept-Ranges': 'bytes',
        'Content-Range': 'bytes ' + start + '-' + end + '/' + size,
        'Content-Length': chunkSize
      });
      rs.pipe(res);
      return;
    }

    // 2) 取真实播放地址（由插件提供解析函数；userId 为票据绑定的系统用户，可空 = 匿名）
    var urlInfo = await resolveStreamUrl(songId, quality, userId);
    if (!urlInfo || !urlInfo.url) {
      res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ code: 502, message: '无法获取播放地址（可能需要登录或该曲目为 VIP）' }));
    }

    // 3) 带上 Range 请求上游并透传
    var upstreamHeaders = {};
    if (rangeHeader) upstreamHeaders['Range'] = rangeHeader;
    var upstreamRes = await fetchRaw(urlInfo.url, upstreamHeaders, getConfig().proxy || '');
    var headers = {
      'Content-Type': upstreamRes.headers['content-type'] || audioMime,
      'Accept-Ranges': 'bytes'
    };
    if (upstreamRes.headers['content-length']) headers['Content-Length'] = upstreamRes.headers['content-length'];
    if (upstreamRes.headers['content-range']) headers['Content-Range'] = upstreamRes.headers['content-range'];
    res.writeHead(upstreamRes.status === 206 ? 206 : (upstreamRes.status >= 200 && upstreamRes.status < 300 ? 200 : upstreamRes.status), headers);
    // 无 Range 且开启缓存时落盘；带 Range 的部分响应不落盘
    pipeWithCache(upstreamRes, res, audioCacheOn ? cachePath : null, audioCacheOn && !rangeHeader && upstreamRes.status === 200);
  }

  // 图片中转：白名单域名校验，透传二进制与缓存头
  async function streamImage(req, res, imageUrl) {
    if (!imageHostAllow) { res.writeHead(403); return res.end('image relay not enabled'); }
    var u;
    try { u = new URL(imageUrl); } catch (e) {
      res.writeHead(400); return res.end('bad url');
    }
    if (u.protocol !== 'https:' && u.protocol !== 'http:') { res.writeHead(400); return res.end('bad protocol'); }
    if (!imageHostAllow.test(u.hostname)) { res.writeHead(403); return res.end('host not allowed'); }
    try {
      var upstreamRes = await fetchRaw(imageUrl, imageHeaders, getConfig().proxy || '');
      if (upstreamRes.status >= 400) { res.writeHead(502); return res.end('upstream error'); }
      res.writeHead(200, {
        'Content-Type': upstreamRes.headers['content-type'] || 'image/jpeg',
        'Cache-Control': 'public, max-age=604800'
      });
      upstreamRes.stream.pipe(res);
    } catch (e) {
      res.writeHead(502); res.end('fetch failed');
    }
  }

  return {
    streamAudio: streamAudio,
    streamImage: streamImage
  };
}

module.exports = {
  proxyConnect: proxyConnect,
  fetchRaw: fetchRaw,
  createTicketKit: createTicketKit,
  createRelay: createRelay
};
