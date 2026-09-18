// 网易云音乐插件 - 媒体中转层
// 职责：客户端零外网依赖，所有网易云音频 / 图片流量由 ClassIntra 服务器中转。
//   1. 音频中转：支持 Range 断点续传（拖动进度条），可选磁盘缓存（LRU 清理）
//   2. 图片中转：白名单域名校验，透传二进制与缓存头
// 仅使用 Node 内置模块（http/https/fs/path/crypto），符合内网零依赖要求。

var http = require('http');
var https = require('https');
var fs = require('fs');
var path = require('path');
var crypto = require('crypto');
var store = require('./store');

// 图片中转白名单（网易云 CDN 域）
var IMAGE_HOST_RE = /(^|\.)music\.126\.net$/i;

// 音频缓存大小上限的默认值（MB），实际以 store.getConfig().audioCacheMaxMB 为准
function audioCacheMaxBytes() {
  var mb = parseInt(store.getConfig().audioCacheMaxMB, 10);
  if (!isFinite(mb) || mb <= 0) mb = 512;
  return mb * 1024 * 1024;
}

// 缓存文件路径：对 key 做哈希避免非法字符
function cacheFilePath(key) {
  var dir = store.ensureCacheDir();
  return path.join(dir, crypto.createHash('md5').update(String(key)).digest('hex') + '.media');
}

// LRU 清理：按访问时间删除最久未使用的缓存文件，直到总大小低于上限
function evictCacheIfNeeded(extraBytes) {
  var dir = store.ensureCacheDir();
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

// 音频中转：/stream?id=&quality=
// 逻辑：
//   1. 计算缓存 key（歌曲 + 音质），命中且 Range 可满足 → 直接读磁盘
//   2. 否则向网易云取真实播放地址（gateway，按票据对应的用户登录态），携带 Range 请求上游并透传
//   3. 无 Range（完整下载）且开启缓存时落盘
async function streamAudio(req, res, gateway, songId, quality, userId) {
  var rangeHeader = req.headers.range || '';
  var cachePath = cacheFilePath('audio:' + quality + ':' + songId);
  var audioCacheOn = store.getConfig().audioCache === '1';

  // 1) 磁盘缓存命中
  if (audioCacheOn && fs.existsSync(cachePath)) {
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
      'Content-Type': 'audio/mpeg',
      'Accept-Ranges': 'bytes',
      'Content-Range': 'bytes ' + start + '-' + end + '/' + size,
      'Content-Length': chunkSize
    });
    rs.pipe(res);
    return;
  }

  // 2) 取真实播放地址（票据绑定的用户上下文；userId 可空 = 匿名）
  var urlInfo = await gateway.resolveStreamUrl(songId, quality, userId);
  if (!urlInfo || !urlInfo.url) {
    res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify({ code: 502, message: '无法获取播放地址（可能需要登录或该曲目为 VIP）' }));
  }

  // 3) 带上 Range 请求上游并透传
  var upstreamHeaders = {};
  if (rangeHeader) upstreamHeaders['Range'] = rangeHeader;
  var upstreamRes = await fetchRaw(urlInfo.url, upstreamHeaders, store.getConfig().proxy || '');
  var headers = {
    'Content-Type': upstreamRes.headers['content-type'] || 'audio/mpeg',
    'Accept-Ranges': 'bytes'
  };
  if (upstreamRes.headers['content-length']) headers['Content-Length'] = upstreamRes.headers['content-length'];
  if (upstreamRes.headers['content-range']) headers['Content-Range'] = upstreamRes.headers['content-range'];
  res.writeHead(upstreamRes.status === 206 ? 206 : (upstreamRes.status >= 200 && upstreamRes.status < 300 ? 200 : upstreamRes.status), headers);
  // 无 Range 且开启缓存时落盘；带 Range 的部分响应不落盘
  pipeWithCache(upstreamRes, res, cachePath, audioCacheOn && !rangeHeader && upstreamRes.status === 200);
}

// 图片中转：/image?u=<encodeURIComponent(图片url)>
async function streamImage(req, res, imageUrl) {
  var u;
  try { u = new URL(imageUrl); } catch (e) {
    res.writeHead(400); return res.end('bad url');
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') { res.writeHead(400); return res.end('bad protocol'); }
  if (!IMAGE_HOST_RE.test(u.hostname)) { res.writeHead(403); return res.end('host not allowed'); }
  try {
    var upstreamRes = await fetchRaw(imageUrl, { 'Referer': 'https://music.163.com' }, store.getConfig().proxy || '');
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

module.exports = {
  streamAudio: streamAudio,
  streamImage: streamImage,
  proxyConnect: proxyConnect
};
