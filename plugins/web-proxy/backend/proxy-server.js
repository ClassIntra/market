// backend/proxy-server.js
// Node 原生实现的网页代理服务器。
//
// 设计：
//   - 对外是一个普通 HTTP 服务，URL 形态为 /<scheme>/<host>/<path>?<query>
//   - 由 Node 以 http/https 客户端向上游发起请求（不做 TLS 拦截）
//   - 返回 HTML/CSS/JS 时改写其中的资源链接，并注入客户端 hook
//   - 由插件后端 require 时自动启动，随 ClassIntra 一同运行
//
// 代码风格遵循 ClassIntra 约定：var / function / 单引号 / 2 空格缩进。

var http = require('http');
var https = require('https');
var zlib = require('zlib');
var URL = require('url').URL;
var os = require('os');

var rewrite = require('./rewrite');

var DEFAULT_PORT = 9005;
var PORT_FALLBACKS = [9005, 9006, 9007, 9008, 9009];

// 上游 TLS 证书校验开关：默认「校验」（安全优先）。
// 仅在目标站点使用自签证书 / 证书异常导致无法代理时，显式设置
// WEB_PROXY_INSECURE_TLS=1 降级为不校验（异常场景的兼容降级，正常环境不生效）。
var INSECURE_TLS = String(process.env.WEB_PROXY_INSECURE_TLS || '') === '1';

var HOP_BY_HOP = {
  'connection': true,
  'keep-alive': true,
  'proxy-authenticate': true,
  'proxy-authorization': true,
  'te': true,
  'trailer': true,
  'transfer-encoding': true,
  'upgrade': true
};

// 需要剥离的响应头：这些头会阻止页面在 iframe 中运行或限制功能
var STRIP_RESPONSE_HEADERS = {
  'x-frame-options': true,
  'content-security-policy': true,
  'content-security-policy-report-only': true,
  'strict-transport-security': true,
  'public-key-pins': true,
  'public-key-pins-report-only': true,
  'x-content-type-options': true,
  'referrer-policy': true,
  'permissions-policy': true,
  'cross-origin-opener-policy': true,
  'cross-origin-embedder-policy': true,
  'cross-origin-resource-policy': true,
  'x-xss-protection': true,
  'x-download-options': true,
  'x-permitted-cross-domain-policies': true
};

// CORS 相关响应头：代理环境下这些头会导致问题
var STRIP_CORS_HEADERS = {
  'access-control-allow-origin': true,
  'access-control-allow-credentials': true,
  'access-control-expose-headers': true,
  'access-control-max-age': true,
  'access-control-allow-methods': true,
  'access-control-allow-headers': true,
  'timing-allow-origin': true
};

var TEXT_TYPES = {
  'text/html': true,
  'application/xhtml+xml': true,
  'text/css': true
};

var JS_TYPES = {
  'application/javascript': true,
  'text/javascript': true,
  'application/x-javascript': true,
  'application/ecmascript': true,
  'text/ecmascript': true
};

var MAX_REWRITE_BYTES = 12 * 1024 * 1024;
var UPSTREAM_TIMEOUT_MS = 45000;

// ---- 状态 ----

var state = {
  server: null,
  port: 0,
  running: false,
  startedAt: 0,
  requests: 0,
  errors: 0,
  lastError: ''
};

// ---- 路径解析 ----

// 把 /https/example.com/a/b?x=1 解析为 { scheme, host, path }
function parseTarget(rawPath) {
  var p = rawPath || '/';
  if (p.charAt(0) === '/') p = p.substring(1);
  if (!p) return null;
  var m = /^getassets\/(https?)\/(.+)$/i.exec(p);
  if (m) {
    p = m[1] + '/' + m[2];
  }
  m = /^(https?)\/(.+)$/i.exec(p);
  if (!m) return null;
  var scheme = m[1].toLowerCase();
  var rest = m[2];
  var slash = rest.indexOf('/');
  var host;
  var pathname;
  if (slash < 0) {
    host = rest;
    pathname = '/';
  } else {
    host = rest.substring(0, slash);
    pathname = rest.substring(slash);
  }
  if (!host) return null;
  return {
    scheme: scheme,
    host: host,
    path: pathname
  };
}

function buildProxyBase(req) {
  var host = req.headers.host || ((os.hostname() || '127.0.0.1') + ':' + state.port);
  return 'http://' + host;
}

// ---- 请求头处理 ----

function sanitizeRequestHeaders(src, target, req, proxyBase) {
  var out = {};
  for (var key in src) {
    if (!Object.prototype.hasOwnProperty.call(src, key)) continue;
    var lower = key.toLowerCase();
    if (HOP_BY_HOP[lower]) continue;
    if (lower === 'host') continue;
    if (lower === 'content-length') continue;
    if (lower === 'accept-encoding') continue;
    if (lower === 'x-proxy-base') continue;
    out[key] = src[key];
  }
  out['host'] = target.host;
  out['accept-encoding'] = 'identity';

  // 与目标站点的真实来源保持一致，减少防盗链/跨站拦截
  var browserReferer = src['referer'] || src['Referer'] || '';
  var realReferer = '';
  if (browserReferer) {
    realReferer = unproxyUrl(browserReferer, proxyBase) || '';
    var headerBase = src['x-proxy-base'] || src['X-Proxy-Base'] || '';
    if (!realReferer && headerBase) {
      realReferer = headerBase + '/';
    }
  }
  if (realReferer) {
    out['referer'] = realReferer;
    out['origin'] = originOf(realReferer);
  } else {
    delete out['referer'];
    delete out['Referer'];
    delete out['origin'];
    delete out['Origin'];
  }

  if (!out['user-agent'] && !out['User-Agent']) {
    out['user-agent'] = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
  }
  if (!out['accept'] && !out['Accept']) {
    out['accept'] = 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8';
  }
  if (!out['accept-language'] && !out['Accept-Language']) {
    out['accept-language'] = 'zh-CN,zh;q=0.9,en;q=0.8';
  }
  return out;
}

function unproxyUrl(u, proxyBase) {
  if (!u || typeof u !== 'string') return '';
  var base = proxyBase;
  if (!base) {
    try {
      var parsed = new URL(u);
      base = parsed.protocol + '//' + parsed.host;
    } catch (e) {
      return '';
    }
  }
  var prefix = base + '/';
  if (u.indexOf(prefix) !== 0) return '';
  var rest = u.substring(prefix.length);
  var m = /^(https?)\/([^\/]+)(\/.*)?$/i.exec(rest);
  if (!m) return '';
  return m[1].toLowerCase() + '://' + m[2] + (m[3] || '/');
}

function originOf(u) {
  try {
    var parsed = new URL(u);
    return parsed.protocol + '//' + parsed.host;
  } catch (e) {
    return '';
  }
}

// ---- 响应头处理 ----

// sitePrefix：形如 /https/www.example.com，用于把 Cookie 的 Path 收敛到单个站点，
// 否则同一代理域名下所有站点共用一个 Cookie 名字空间，会互相覆盖。
function sanitizeResponseHeaders(src, proxyBase, sitePrefix, realUrl) {
  var out = {};
  for (var key in src) {
    if (!Object.prototype.hasOwnProperty.call(src, key)) continue;
    var lower = key.toLowerCase();
    if (HOP_BY_HOP[lower]) continue;
    if (lower === 'content-length') continue;
    if (STRIP_RESPONSE_HEADERS[lower]) continue;
    if (STRIP_CORS_HEADERS[lower]) continue;
    if (lower === 'set-cookie') continue;
    out[key] = src[key];
  }

  // Cookie 重新下发：去掉 Domain / Secure，并把 Path 收敛到该站点前缀，
  // 避免同一代理域名下不同站点的同名 Cookie 互相覆盖。
  var cookies = src['set-cookie'];
  var rewritten = [];
  if (cookies) {
    var prefix = sitePrefix || '';
    for (var i = 0; i < cookies.length; i++) {
      var c = String(cookies[i]);
      var segments = c.split(';');
      var kept = [segments[0]];
      var originalPath = '/';
      for (var j = 1; j < segments.length; j++) {
        var seg = segments[j].trim();
        var segLower = seg.toLowerCase();
        if (segLower.indexOf('domain=') === 0) continue;
        if (segLower === 'secure') continue;
        if (segLower.indexOf('samesite=none') === 0) continue;
        if (segLower.indexOf('partitioned') === 0) continue;
        if (segLower.indexOf('path=') === 0) {
          var pv = seg.substring(5).trim();
          if (pv) originalPath = pv;
          continue;
        }
        kept.push(seg);
      }
      if (prefix) {
        var nextPath = prefix;
        if (originalPath && originalPath !== '/' && originalPath.charAt(0) === '/') {
          nextPath = prefix + (originalPath.charAt(originalPath.length - 1) === '/'
            ? originalPath.substring(0, originalPath.length - 1)
            : originalPath);
        }
        kept.push('Path=' + nextPath);
      } else {
        kept.push('Path=' + (originalPath || '/'));
      }
      rewritten.push(kept.join('; '));
    }
  }
  if (rewritten.length) out['set-cookie'] = rewritten;

  var location = src['location'] || src['Location'];
  if (location) {
    var ctx = {
      proxyBase: proxyBase,
      scheme: 'https',
      realUrl: realUrl || ''
    };
    delete out['location'];
    delete out['Location'];
    out['Location'] = rewrite.rewriteLocation(String(location), realUrl || '', ctx);
  }
  return out;
}

function contentTypeOf(headers) {
  var ct = headers['content-type'] || headers['Content-Type'] || '';
  return String(ct).toLowerCase();
}

function mimeOf(headers) {
  var ct = contentTypeOf(headers);
  var semi = ct.indexOf(';');
  if (semi >= 0) ct = ct.substring(0, semi);
  return ct.trim();
}

function charsetOf(headers) {
  var ct = contentTypeOf(headers);
  var m = /charset=([^;]+)/i.exec(ct);
  return m ? m[1].trim() : '';
}

// ---- 解压 ----

function decompressBuffer(buffer, encoding, cb) {
  var enc = String(encoding || '').toLowerCase();
  if (!enc || enc === 'identity') return cb(null, buffer);
  if (enc === 'gzip' || enc === 'x-gzip') {
    return zlib.gunzip(buffer, cb);
  }
  if (enc === 'deflate') {
    return zlib.inflate(buffer, cb);
  }
  if (enc === 'br') {
    return zlib.brotliDecompress(buffer, cb);
  }
  return cb(null, null);
}

// ---- 文本编码处理 ----

function decodeText(buffer, charset) {
  var cs = String(charset || '').toLowerCase();
  if (cs === 'gbk' || cs === 'gb2312' || cs === 'gb18030') {
    try {
      return new TextDecoder('gb18030').decode(buffer);
    } catch (e) {
      return buffer.toString('utf8');
    }
  }
  return buffer.toString('utf8');
}

function encodeText(text, charset) {
  var cs = String(charset || '').toLowerCase();
  if (cs === 'gbk' || cs === 'gb2312' || cs === 'gb18030') {
    try {
      // Node 无内置 GBK 编码器，统一按 UTF-8 输出并同步修改 charset
      return { body: Buffer.from(text, 'utf8'), charset: 'utf-8' };
    } catch (e) {
      return { body: Buffer.from(text, 'utf8'), charset: 'utf-8' };
    }
  }
  return { body: Buffer.from(text, 'utf8'), charset: cs || 'utf-8' };
}

// ---- 错误页 ----

function sendErrorPage(res, code, title, detail) {
  // 关键：一旦响应头已发出（流式透传中途出错），绝不能再写头，否则抛
  // ERR_HTTP_HEADERS_SENT，而 ClassIntra 的 crash-logger 会因此退出整个进程。
  if (res.headersSent || res.writableEnded) {
    try { res.destroy(); } catch (e) {}
    return;
  }
  var html = '<!DOCTYPE html><html><head><meta charset="utf-8">' +
    '<title>' + title + '</title>' +
    '<style>body{margin:0;background:#0f1115;color:#e6e8ee;font:14px/1.6 system-ui,sans-serif;' +
    'display:flex;align-items:center;justify-content:center;height:100vh}' +
    '.box{max-width:560px;padding:28px 32px;border:1px solid #2a2f3a;border-radius:14px;background:#161a22}' +
    'h1{font-size:17px;margin:0 0 10px}p{margin:0;color:#9aa3b2;word-break:break-all}</style>' +
    '</head><body><div class="box"><h1>' + title + '</h1><p>' + detail + '</p></div></body></html>';
  try {
    res.writeHead(code, {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Length': Buffer.byteLength(html)
    });
    res.end(html);
  } catch (e) {
    try { res.destroy(); } catch (err) {}
  }
}

// ---- 主处理 ----

function handleProxyRequest(req, res, target, proxyBase) {
  var isHttps = target.scheme === 'https';
  var transport = isHttps ? https : http;

  var upstreamUrl = target.scheme + '://' + target.host + target.path;

  // 本请求自己的上游连接（客户端提前断开时只清理它自己，不能误伤并发请求）
  var myUpstream = null;
  res.on('close', function () {
    try { if (myUpstream) myUpstream.destroy(); } catch (e) {}
  });

  var chunks = [];
  var bodyBytes = 0;
  req.on('data', function (c) {
    bodyBytes += c.length;
    if (bodyBytes > 64 * 1024 * 1024) {
      req.destroy();
      return;
    }
    chunks.push(c);
  });

  req.on('end', function () {
    var body = chunks.length ? Buffer.concat(chunks) : null;
    var headers = sanitizeRequestHeaders(req.headers, target, req, proxyBase);
    if (body && body.length) {
      headers['content-length'] = String(body.length);
    }

    var options = {
      method: req.method,
      headers: headers,
      timeout: UPSTREAM_TIMEOUT_MS,
      rejectUnauthorized: !INSECURE_TLS
    };

    var upstream;
    try {
      upstream = transport.request(upstreamUrl, options, function (upRes) {
        try {
          onUpstreamResponse(req, res, upRes, target, proxyBase);
        } catch (e) {
          state.errors++;
          state.lastError = 'response handler: ' + e.message;
          sendErrorPage(res, 502, '代理处理失败', String(e.message));
        }
      });
    } catch (e) {
      state.errors++;
      state.lastError = e.message;
      sendErrorPage(res, 502, '代理请求失败', String(e.message));
      return;
    }
    myUpstream = upstream;

    var settled = false;

    upstream.on('timeout', function () {
      if (settled) return;
      settled = true;
      state.errors++;
      state.lastError = 'upstream timeout';
      try { upstream.destroy(); } catch (e) {}
      // 已开始回传（流式）时只断开，不再写错误页
      if (res.headersSent) {
        try { res.destroy(); } catch (e) {}
        return;
      }
      sendErrorPage(res, 504, '上游响应超时', '目标站点在 ' + (UPSTREAM_TIMEOUT_MS / 1000) + ' 秒内没有响应。');
    });

    upstream.on('error', function (e) {
      state.errors++;
      state.lastError = e.message;
      if (!res.headersSent) {
        sendErrorPage(res, 502, '无法连接目标站点', String(e.message));
      } else {
        try { res.destroy(); } catch (err) {}
      }
    });

    if (body && body.length) {
      upstream.write(body);
    }
    upstream.end();
  });

  req.on('error', function (e) {
    state.errors++;
    state.lastError = 'client request: ' + e.message;
    sendErrorPage(res, 400, '请求中断', String(e.message));
  });
}

function onUpstreamResponse(req, res, upRes, target, proxyBase) {
  var status = upRes.statusCode || 502;
  // 响应头已到，取消"等待响应"的超时，避免长连接/大文件下载中途被误判超时
  try { upRes.req && upRes.req.setTimeout(0); } catch (e) {}
  var sitePrefix = '/' + target.scheme + '/' + target.host;
  var realUrl = target.scheme + '://' + target.host + target.path;
  var headers = sanitizeResponseHeaders(upRes.headers, proxyBase, sitePrefix, realUrl);
  var mime = mimeOf(upRes.headers);
  var encoding = upRes.headers['content-encoding'] || '';
  var charset = charsetOf(upRes.headers);

  var needsRewrite = !!TEXT_TYPES[mime] || !!JS_TYPES[mime];
  var isHead = req.method === 'HEAD';

  if (!needsRewrite || isHead) {
    // 二进制/流式资源直接透传
    if (isHead) {
      res.writeHead(status, headers);
      res.end();
      upRes.resume();
      return;
    }
    res.writeHead(status, headers);
    upRes.on('error', function () {
      try { res.destroy(); } catch (e) {}
    });
    upRes.pipe(res);
    return;
  }

  // 文本资源：整体缓冲后重写
  var buffered = [];
  var total = 0;
  var aborted = false;

  upRes.on('data', function (chunk) {
    total += chunk.length;
    if (total > MAX_REWRITE_BYTES) {
      aborted = true;
      // 超限时退化为透传（已缓冲部分先写出去）
      try { upRes.destroy(); } catch (e) {}
      if (!res.headersSent) {
        res.writeHead(status, headers);
      }
      for (var i = 0; i < buffered.length; i++) {
        res.write(buffered[i]);
      }
      res.end();
      return;
    }
    buffered.push(chunk);
  });

  upRes.on('end', function () {
    if (aborted) return;
    var raw = Buffer.concat(buffered);
    decompressBuffer(raw, encoding, function (err, inflated) {
      var payload = err || !inflated ? raw : inflated;
      var text = decodeText(payload, charset);
      var ctx = {
        proxyBase: proxyBase,
        scheme: target.scheme,
        host: target.host,
        realUrl: target.scheme + '://' + target.host + target.path
      };

      if (TEXT_TYPES[mime]) {
        if (mime === 'text/css') {
          text = rewrite.rewriteCss(text, ctx);
        } else {
          text = rewrite.rewriteHtml(text, ctx);
        }
      } else if (JS_TYPES[mime]) {
        text = rewrite.rewriteJs(text, ctx);
      }

      var encoded = encodeText(text, charset);
      var outHeaders = sanitizeResponseHeaders(upRes.headers, proxyBase, sitePrefix, realUrl);
      delete outHeaders['content-encoding'];
      delete outHeaders['Content-Encoding'];
      var ct = outHeaders['content-type'] || outHeaders['Content-Type'] || mime;
      if (encoded.charset) {
        ct = ct.replace(/;\s*charset=[^;]*/i, '');
        ct = ct + '; charset=' + encoded.charset;
      }
      outHeaders['Content-Type'] = ct;
      delete outHeaders['content-type'];
      outHeaders['Content-Length'] = String(encoded.body.length);
      res.writeHead(status, outHeaders);
      res.end(encoded.body);
    });
  });

  upRes.on('error', function (e) {
    if (!res.headersSent) {
      sendErrorPage(res, 502, '读取上游响应失败', String(e.message));
    } else {
      try { res.end(); } catch (err) {}
    }
  });
}

// ---- WebSocket 支持 ----

var net = require('net');
var crypto = require('crypto');

// 处理 WebSocket 升级请求
function handleWebSocket(req, socket, head, target, proxyBase) {
  var isHttps = target.scheme === 'https';
  var upstreamUrl = target.scheme + '://' + target.host + target.path;

  // 解析上游主机和端口
  var upstreamHost = target.host;
  var upstreamPort = isHttps ? 443 : 80;
  var colonIdx = upstreamHost.lastIndexOf(':');
  if (colonIdx > 0) {
    upstreamPort = parseInt(upstreamHost.substring(colonIdx + 1), 10);
    upstreamHost = upstreamHost.substring(0, colonIdx);
  }

  // 构建转发请求头
  var headers = sanitizeRequestHeaders(req.headers, target, req, proxyBase);

  // 构建 HTTP 请求头字符串
  var headerLines = [];
  for (var key in headers) {
    if (!Object.prototype.hasOwnProperty.call(headers, key)) continue;
    headerLines.push(key + ': ' + headers[key]);
  }

  // WebSocket 握手密钥
  var wsKey = req.headers['sec-websocket-key'] || '';
  var wsAccept = '';
  if (wsKey) {
    var magic = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
    wsAccept = crypto.createHash('sha1').update(wsKey + magic).digest('base64');
  }

  var requestLine = req.method + ' ' + target.path + ' HTTP/1.1\r\n';
  var rawHeaders = requestLine + headerLines.join('\r\n') + '\r\n\r\n';

  var upstreamSocket = null;
  var settled = false;

  function cleanup() {
    try { if (upstreamSocket) upstreamSocket.destroy(); } catch (e) {}
    try { socket.destroy(); } catch (e) {}
  }

  try {
    if (isHttps) {
      // HTTPS 使用 TLS
      var tls = require('tls');
      upstreamSocket = tls.connect({
        host: upstreamHost,
        port: upstreamPort,
        rejectUnauthorized: !INSECURE_TLS,
        servername: upstreamHost
      }, function () {
        upstreamSocket.write(rawHeaders);
      });
    } else {
      upstreamSocket = net.connect({
        host: upstreamHost,
        port: upstreamPort
      }, function () {
        upstreamSocket.write(rawHeaders);
      });
    }
  } catch (e) {
    state.errors++;
    state.lastError = 'websocket connect: ' + e.message;
    cleanup();
    return;
  }

  // 上游响应处理
  var handshakeComplete = false;
  var buffer = Buffer.alloc(0);

  upstreamSocket.on('data', function (chunk) {
    buffer = Buffer.concat([buffer, chunk]);

    if (!handshakeComplete) {
      // 查找 HTTP 头部结束标记
      var headerEnd = buffer.indexOf('\r\n\r\n');
      if (headerEnd < 0) return;

      var headerPart = buffer.substring(0, headerEnd).toString('utf8');
      buffer = buffer.substring(headerEnd + 4);

      // 解析状态码
      var statusMatch = /^HTTP\/\d\.\d\s+(\d+)/i.exec(headerPart);
      var wsStatus = statusMatch ? parseInt(statusMatch[1], 10) : 101;

      // 转发握手响应给客户端：仅 101 才是真正的协议升级，其余状态沿用「Bad Gateway」原因短语，
      // 避免「非 101 也回 Switching Protocols」误导客户端（原实现把原因短语写死）。
      var reason = wsStatus === 101 ? 'Switching Protocols' : 'Bad Gateway';
      var responseHeader = 'HTTP/1.1 ' + wsStatus + ' ' + reason + '\r\n';
      responseHeader += 'Upgrade: websocket\r\n';
      responseHeader += 'Connection: Upgrade\r\n';
      if (wsAccept) responseHeader += 'Sec-WebSocket-Accept: ' + wsAccept + '\r\n';
      responseHeader += '\r\n';

      try {
        socket.write(responseHeader);
      } catch (e) {
        cleanup();
        return;
      }

      handshakeComplete = true;

      // 发送缓冲区中剩余的数据
      if (buffer.length > 0) {
        try {
          socket.write(buffer);
        } catch (e) {
          cleanup();
          return;
        }
        buffer = Buffer.alloc(0);
      }
    } else {
      // 握手完成，直接转发数据
      if (buffer.length > 0) {
        try {
          socket.write(buffer);
        } catch (e) {
          cleanup();
          return;
        }
        buffer = Buffer.alloc(0);
      }
    }
  });

  // 客户端数据转发到上游
  socket.on('data', function (chunk) {
    if (!handshakeComplete) return;
    try {
      upstreamSocket.write(chunk);
    } catch (e) {
      cleanup();
    }
  });

  upstreamSocket.on('error', function (e) {
    state.errors++;
    state.lastError = 'websocket upstream: ' + e.message;
    cleanup();
  });

  socket.on('error', function (e) {
    state.errors++;
    state.lastError = 'websocket client: ' + e.message;
    cleanup();
  });

  upstreamSocket.on('close', function () {
    cleanup();
  });

  socket.on('close', function () {
    cleanup();
  });

  // 发送初始数据（如果有）
  if (head && head.length > 0) {
    upstreamSocket.write(head);
  }
}

// ---- 服务器创建 ----

function createServer() {
  var server = http.createServer(function (req, res) {
    state.requests++;
    res.on('error', function () {});
    req.on('error', function () {});

    // 兜底：任何未预料的异常都不能冒泡到进程级（ClassIntra 会因此退出）
    try {
      // 健康检查与工具页
      var pathname = (req.url || '/').split('?')[0];
      if (pathname === '/' || pathname === '') {
        var info = buildInfoPage(req);
        res.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'Content-Length': Buffer.byteLength(info)
        });
        res.end(info);
        return;
      }

      var target = parseTarget(req.url);
      if (!target) {
        var proxyBase = buildProxyBase(req);
        sendErrorPage(res, 400, '无法解析代理目标',
          '代理地址格式应为 <code>' + proxyBase + '/&lt;https|http&gt;/&lt;域名&gt;/&lt;路径&gt;</code>' +
          '，当前请求：' + String(req.url || '').substring(0, 200));
        return;
      }

      handleProxyRequest(req, res, target, buildProxyBase(req));
    } catch (e) {
      state.errors++;
      state.lastError = 'server handler: ' + e.message;
      sendErrorPage(res, 500, '代理内部错误', String(e.message));
    }
  });

  // WebSocket 升级处理
  server.on('upgrade', function (req, socket, head) {
    state.requests++;
    try {
      var target = parseTarget(req.url);
      if (!target) {
        socket.destroy();
        return;
      }
      handleWebSocket(req, socket, head, target, buildProxyBase(req));
    } catch (e) {
      state.errors++;
      state.lastError = 'websocket handler: ' + e.message;
      try { socket.destroy(); } catch (err) {}
    }
  });

  server.on('clientError', function (err, socket) {
    try { socket.destroy(); } catch (e) {}
  });

  return server;
}

function buildInfoPage(req) {
  var proxyBase = buildProxyBase(req);
  return '<!DOCTYPE html><html><head><meta charset="utf-8"><title>网页代理</title>' +
    '<style>body{margin:0;background:#0f1115;color:#e6e8ee;font:14px/1.6 system-ui,sans-serif;' +
    'padding:40px}h1{font-size:18px;margin:0 0 16px}code{background:#1d2330;padding:2px 6px;border-radius:5px}' +
    '.k{color:#9aa3b2}</style></head><body>' +
    '<h1>网页代理服务运行中</h1>' +
    '<p class="k">代理地址：<code>' + proxyBase + '/&lt;https|http&gt;/&lt;域名&gt;/&lt;路径&gt;</code></p>' +
    '<p class="k">示例：<code>' + proxyBase + '/https/www.example.com/</code></p>' +
    '<p class="k">已处理请求：' + state.requests + ' · 错误：' + state.errors + '</p>' +
    '</body></html>';
}

function listenOn(port, cb) {
  var server = createServer();

  server.once('error', function (e) {
    server.close();
    if (e && e.code === 'EADDRINUSE') {
      return cb(e);
    }
    return cb(e);
  });

  server.listen(port, '0.0.0.0', function () {
    cb(null, server);
  });
}

function start(opts, cb) {
  var done = typeof cb === 'function' ? cb : function () {};
  if (state.running) return done(null, state);

  var preferred = (opts && opts.port) || DEFAULT_PORT;
  var candidates = [preferred];
  for (var i = 0; i < PORT_FALLBACKS.length; i++) {
    if (candidates.indexOf(PORT_FALLBACKS[i]) < 0) candidates.push(PORT_FALLBACKS[i]);
  }

  var idx = 0;

  function tryNext() {
    if (idx >= candidates.length) {
      state.lastError = '所有候选端口都被占用';
      return done(new Error(state.lastError));
    }
    var port = candidates[idx++];
    listenOn(port, function (err, server) {
      if (err) {
        if (err.code === 'EADDRINUSE') return tryNext();
        state.lastError = err.message;
        return done(err);
      }
      state.server = server;
      state.port = port;
      state.running = true;
      state.startedAt = Date.now();
      console.log('[web-proxy] 网页代理已启动，监听 0.0.0.0:' + port);
      return done(null, state);
    });
  }

  tryNext();
}

function stop(cb) {
  var done = typeof cb === 'function' ? cb : function () {};
  if (!state.server) {
    state.running = false;
    return done(null);
  }
  try {
    state.server.close(function () {
      state.running = false;
      state.server = null;
      state.port = 0;
      console.log('[web-proxy] 网页代理已停止');
      done(null);
    });
  } catch (e) {
    state.running = false;
    state.server = null;
    return done(e);
  }
}

function status() {
  return {
    running: state.running,
    port: state.port,
    startedAt: state.startedAt,
    requests: state.requests,
    errors: state.errors,
    lastError: state.lastError
  };
}

module.exports = {
  DEFAULT_PORT: DEFAULT_PORT,
  start: start,
  stop: stop,
  status: status,
  parseTarget: parseTarget,
  unproxyUrl: unproxyUrl
};
