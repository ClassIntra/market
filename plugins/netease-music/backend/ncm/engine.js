// 网易云音乐请求引擎
// 协议行为移植自 api-enhanced 的 util/request.js，仅保留 eapi / weapi 两种加密通道，
// 网络层改用 Node 内置 http/https（支持直连、HTTP(S) 代理隧道、gzip 响应），
// 不引入任何第三方依赖，保证内网 / 离线服务器可直接运行。

var http = require('http');
var https = require('https');
var zlib = require('zlib');
var crypto = require('crypto');
var URL = require('url').URL;
var URLSearchParams = require('url').URLSearchParams;
var encrypt = require('./crypto');

// 接口域名（与 api-enhanced 的 util/config.json 一致）
var DOMAIN = 'https://music.163.com';
var EAPI_DOMAIN = 'https://interfacepc.music.163.com';

var DEFAULT_TIMEOUT = 15000;

// 客户端信息模板（api-enhanced osMap）
var OS_MAP = {
  pc: { os: 'pc', appver: '3.1.17.204416', osver: 'Microsoft-Windows-10-Professional-build-19045-64bit', channel: 'netease', mobilename: '', versioncode: '140', resolution: '1920x1080' },
  android: { os: 'android', appver: '8.20.20.231215173437', osver: '14', channel: 'xiaomi', mobilename: 'MI 9', versioncode: '140', resolution: '1920x1080' },
  iphone: { os: 'iPhone OS', appver: '9.0.90', osver: '16.2', channel: 'distribution', mobilename: 'iPhone', versioncode: '140', resolution: '1920x1080' }
};

// 匿名设备指纹：进程级固定，不随请求变化。
// 背景（2026-10-01 定位）：此前每次请求都随机生成 _ntes_nuid / deviceId / NMTID，
// 而扫码登录轮询每 2.5s 一次 —— 网易云看到的是「同一秒内不断冒出的全新设备」，
// 这是登录簇被打上 -462「请完成验证操作」的典型特征。固定后本机对网易云呈现为
// 「同一台设备」，与官方客户端行为一致，且已登录用户的 cookie 自带真实设备字段，
// 不受此处默认值影响。
var ANON_DEVICE = {
  _ntes_nuid: crypto.randomBytes(16).toString('hex'),
  WNMCID: randomHex(6) + '.' + Date.now() + '.01.0',
  NMTID: '00O' + randomHex(19)
};
var ANON_DEVICE_AT = Date.now();

// 解析本次请求应使用的客户端身份。
// 关键：eapi 的 os 绝不能落到 'pc'。域名 interfacepc.music.163.com 虽带 pc，
// 但走的是移动客户端协议；「os=pc + 移动端 UA」这种自相矛盾的身份会被网易云
// 判定为伪造客户端，登录 / 账号簇（二维码轮询、验证码、登录状态）直接返回
// -462 —— 这正是「三种登录方式全挂、验证码也发不出去」的根因。
// 实测：os=pc 时 login/qrcode/client/login 返回 -462；换成 iPhone 身份后
// 立即返回 801「等待扫码」，sms/captcha/sent 与 w/nuser/account/get 同时恢复 200。
function identityFor(cryptoType, rawCookie) {
  var raw = rawCookie || {};
  var want = raw.os;
  if (!want) want = (cryptoType === 'eapi') ? 'iphone' : 'pc';
  if (OS_MAP[want]) return OS_MAP[want];
  return (cryptoType === 'eapi') ? OS_MAP.iphone : OS_MAP.pc;
}

var UA_MAP = {
  weapi: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Edg/124.0.0.0',
  eapi: 'NeteaseMusic 9.0.90/5038 (iPhone; iOS 16.2; zh_CN)'
};

// 调用方是否携带了「真实身份」Cookie。
// MUSIC_U / MUSIC_A 是登录态；_ntes_nuid / deviceId / JSESSIONID-WYYY 是网易云
// 真正下发过的设备/会话字段。以上全无 = 匿名请求，此时若再塞一套自造的设备指纹，
// 会被网易云判为「未知设备 + 可疑网络」的组合（见 bareAuth 注释）。
function hasRealCookie(raw) {
  if (!raw) return false;
  var keys = ['MUSIC_U', 'MUSIC_A', '_ntes_nuid', 'deviceId', 'JSESSIONID-WYYY', 'WNMCID'];
  for (var i = 0; i < keys.length; i++) {
    if (raw[keys[i]]) return true;
  }
  return false;
}

// 保持连接复用，降低内网弱网环境下的握手开销
var httpAgent = new http.Agent({ keepAlive: true, maxSockets: 32 });
var httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 32 });

// 代理 Agent 缓存（同一代理地址只建一个隧道 Agent）
var proxyAgentCache = {};

function randomHex(len) {
  return crypto.randomBytes(Math.ceil(len / 2)).toString('hex').slice(0, len);
}

// Cookie 字符串 → 对象
function cookieToJson(cookie) {
  var obj = {};
  if (!cookie) return obj;
  var parts = String(cookie).split(';');
  for (var i = 0; i < parts.length; i++) {
    var item = parts[i].trim();
    if (!item) continue;
    var idx = item.indexOf('=');
    if (idx === -1) continue;
    obj[item.substring(0, idx).trim()] = item.substring(idx + 1).trim();
  }
  return obj;
}

// Cookie 对象 → 字符串
function cookieObjToString(cookie) {
  var keys = Object.keys(cookie || {});
  var parts = [];
  for (var i = 0; i < keys.length; i++) {
    if (cookie[keys[i]] === undefined || cookie[keys[i]] === null) continue;
    parts.push(encodeURIComponent(keys[i]) + '=' + encodeURIComponent(cookie[keys[i]]));
  }
  return parts.join('; ');
}

// Cookie 补全（对应 api-enhanced processCookieObject）
// 设备指纹改为进程级固定（ANON_DEVICE），不再每次请求随机 —— 见 ANON_DEVICE 注释。
function processCookie(cookie, cryptoType) {
  var raw = {};
  var keys = Object.keys(cookie || {});
  for (var i = 0; i < keys.length; i++) {
    if (cookie[keys[i]] === undefined || cookie[keys[i]] === null || cookie[keys[i]] === '') continue;
    raw[keys[i]] = String(cookie[keys[i]]);
  }
  var os = identityFor(cryptoType, raw);
  var result = {
    __remember_me: 'true',
    ntes_kaola_ad: '1',
    _ntes_nuid: raw._ntes_nuid || ANON_DEVICE._ntes_nuid,
    WNMCID: raw.WNMCID || ANON_DEVICE.WNMCID,
    WEVNSM: raw.WEVNSM || '1.0.0',
    osver: raw.osver || os.osver,
    deviceId: raw.deviceId || raw._ntes_nuid || ANON_DEVICE._ntes_nuid,
    os: raw.os || os.os,
    channel: raw.channel || os.channel,
    appver: raw.appver || os.appver
  };
  result._ntes_nnid = raw._ntes_nnid || result._ntes_nuid + ',' + ANON_DEVICE_AT;
  // 透传登录态与其余业务 Cookie
  var passthrough = ['MUSIC_U', 'MUSIC_A', '__csrf', '__remember_me', 'NMTID', 'JSESSIONID-WYYY', 'sDeviceId', 'buildver', 'versioncode', 'resolution', 'mobilename'];
  for (var j = 0; j < passthrough.length; j++) {
    var k = passthrough[j];
    if (raw[k]) result[k] = raw[k];
  }
  var restKeys = Object.keys(raw);
  for (var m = 0; m < restKeys.length; m++) {
    if (result[restKeys[m]] === undefined) result[restKeys[m]] = raw[restKeys[m]];
  }
  if (!result.NMTID) result.NMTID = ANON_DEVICE.NMTID;
  return result;
}

// 生成 HTTP(S) 代理隧道 Agent（CONNECT 方式，支持 http / https 代理）
function createProxyAgent(proxyUrl) {
  if (proxyAgentCache[proxyUrl]) return proxyAgentCache[proxyUrl];
  var purl;
  try {
    purl = new URL(proxyUrl);
  } catch (e) {
    return null;
  }
  if (!purl.hostname) return null;
  var proxyHost = purl.hostname;
  var proxyPort = Number(purl.port || (purl.protocol === 'https:' ? 443 : 80));
  var authHeader = '';
  if (purl.username) {
    authHeader = 'Basic ' + Buffer.from(decodeURIComponent(purl.username) + ':' + decodeURIComponent(purl.password || '')).toString('base64');
  }
  var transport = purl.protocol === 'https:' ? https : http;

  function TunnelAgent() {
    https.Agent.call(this);
    this.keepAlive = true;
    this.maxSockets = 16;
  }
  TunnelAgent.prototype = Object.create(https.Agent.prototype);
  TunnelAgent.prototype.constructor = TunnelAgent;
  TunnelAgent.prototype.createConnection = function (options, cb) {
    var target = options.host + ':' + (options.port || 443);
    var headers = { Host: target };
    if (authHeader) headers['Proxy-Authorization'] = authHeader;
    var req = transport.request({ host: proxyHost, port: proxyPort, method: 'CONNECT', path: target, headers: headers });
    req.on('connect', function (res, socket, head) {
      if (res.statusCode !== 200) {
        socket.destroy();
        cb(new Error('代理隧道建立失败: HTTP ' + res.statusCode));
        return;
      }
      if (head && head.length) socket.unshift(head);
      cb(null, socket);
    });
    req.on('error', function (err) {
      cb(err);
    });
    req.end();
  };
  var agent = new TunnelAgent();
  proxyAgentCache[proxyUrl] = agent;
  return agent;
}

// 底层 HTTP 请求：返回 { statusCode, headers, body(Buffer) }
function requestRaw(settings) {
  return new Promise(function (resolve, reject) {
    var purl = new URL(settings.url);
    var isHttps = purl.protocol === 'https:';
    var transport = isHttps ? https : http;
    var options = {
      method: settings.method || 'POST',
      hostname: purl.hostname,
      port: purl.port || (isHttps ? 443 : 80),
      path: purl.pathname + purl.search,
      headers: settings.headers || {},
      timeout: settings.timeout || DEFAULT_TIMEOUT
    };
    var proxyAgent = settings.proxy ? createProxyAgent(settings.proxy) : null;
    if (proxyAgent) {
      options.agent = proxyAgent;
    } else {
      options.agent = isHttps ? httpsAgent : httpAgent;
    }

    var req = transport.request(options, function (res) {
      var chunks = [];
      var stream = res;
      var encoding = String(res.headers['content-encoding'] || '').toLowerCase();
      if (encoding === 'gzip' || encoding === 'deflate') {
        stream = res.pipe(encoding === 'gzip' ? zlib.createGunzip() : zlib.createInflate());
      } else if (encoding === 'br') {
        stream = res.pipe(zlib.createBrotliDecompress());
      }
      stream.on('data', function (chunk) {
        chunks.push(chunk);
      });
      stream.on('end', function () {
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body: Buffer.concat(chunks)
        });
      });
      stream.on('error', reject);
    });
    req.on('timeout', function () {
      req.destroy(new Error('请求超时（' + (settings.timeout || DEFAULT_TIMEOUT) + 'ms）'));
    });
    req.on('error', reject);
    if (settings.body) req.write(settings.body);
    req.end();
  });
}

// 解析响应体：JSON 优先；若为加密响应（e_r / x-aeapi）尝试 eapi 解密
function parseBody(res) {
  var text = res.body.toString('utf8');
  var contentType = String(res.headers['content-type'] || '');
  if (contentType.indexOf('json') === -1 && text && text.charAt(0) !== '{' && text.charAt(0) !== '[') {
    // 非 JSON：可能为十六进制密文
    if (/^[0-9A-Fa-f]+$/.test(text.trim()) && text.trim().length > 32) {
      try {
        var decrypted = encrypt.aesDecrypt(text.trim().toUpperCase(), encrypt.EAPI_KEY, 'ecb');
        if (decrypted[0] === 0x1f && decrypted[1] === 0x8b) decrypted = zlib.gunzipSync(decrypted);
        return JSON.parse(decrypted.toString('utf8'));
      } catch (e) {
        // 落到 JSON.parse 分支，交由上层报错
      }
    }
  }
  try {
    return JSON.parse(text);
  } catch (e) {
    // 少数接口会返回「两份拼接的 JSON」，这里做一次容错提取
    var match = text.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch (e2) {
        // 落入下方统一报错
      }
    }
    var err = new Error('响应解析失败: ' + text.slice(0, 120));
    err.__parse = true;
    throw err;
  }
}

// 主请求方法
// uri: 形如 '/api/song/lyric'
// data: 业务参数对象
// options: { cookie, crypto: 'eapi'|'weapi', ua, proxy, timeout, domain }
function ncmRequest(uri, data, options) {
  options = options || {};
  data = data || {};
  var cryptoType = options.crypto || 'eapi';
  var cookie = options.cookie || {};
  if (typeof cookie === 'string') cookie = cookieToJson(cookie);
  var rawCookie = cookie; // 补全前的原始 cookie，用于判断是否携带真实身份
  var ident = identityFor(cryptoType, cookie); // 身份必须先于 processCookie 解析（cookie 源里可能带 os）

  // bareAuth：登录簇匿名请求「完全不发 Cookie 头」。
  // 背景（2026-10-01 隔离探针实测，唯一变量 = 有无 Cookie 头）：
  //   /api/w/login/cellphone（eapi，验证码 0000）
  //     无 Cookie 头 → code 503「验证码错误」   ← 真实业务码，风控放行
  //     伪造 Cookie → code -462「请完成验证操作」← 风控拦截
  //   密码登录同理：无 Cookie → 502「账号或密码错误」。
  // 原因：processCookie 会无条件补一套自造设备指纹（_ntes_nuid / deviceId /
  // WNMCID / os=iPhone OS…），而这套字段在官方客户端里是「登录成功后由服务端
  // 下发」的。拿着服务端从未见过的设备去登录，风控自然判为脚本/伪造客户端。
  // 官方客户端首次登录时请求里本就没有 Cookie —— 这里对齐该行为。
  // 已登录用户（或调用方显式提供了设备字段）走原逻辑，登录态不受影响。
  var bareAuth = !!options.bareAuth && !hasRealCookie(rawCookie);
  cookie = processCookie(cookie, cryptoType);

  var headers = {
    'Accept-Encoding': 'gzip, deflate',
    'Content-Type': 'application/x-www-form-urlencoded'
  };
  var csrfToken = cookie.__csrf || '';
  var url = '';
  var encryptData = null;

  if (cryptoType === 'weapi') {
    headers.Referer = options.domain || DOMAIN;
    headers['User-Agent'] = options.ua || UA_MAP.weapi;
    if (!bareAuth) headers.Cookie = cookieObjToString(cookie);
    data.csrf_token = csrfToken;
    encryptData = encrypt.weapi(data);
    url = (options.domain || DOMAIN) + '/weapi/' + uri.substr(5);
  } else {
    headers['User-Agent'] = options.ua || UA_MAP.eapi;
    // 注意：eapi 的客户端身份（os / appver / deviceId…）同时存在于两处 ——
    // ① 加密载荷内的 data.header  ② HTTP Cookie 头（下面的 Object.assign）。
    // bareAuth 只剥掉 ②，① 必须保留：探针验证「无 Cookie + 完整 data.header」
    // 仍返回真实业务码，说明风控盯的是 Cookie 头里那套设备指纹，而非载荷身份。
    var header = {
      osver: cookie.osver,
      deviceId: cookie.deviceId,
      os: cookie.os,
      appver: cookie.appver,
      versioncode: cookie.versioncode || ident.versioncode || '140',
      mobilename: cookie.mobilename || ident.mobilename || '',
      buildver: cookie.buildver || String(Date.now()).substr(0, 10),
      resolution: cookie.resolution || ident.resolution || '1920x1080',
      __csrf: csrfToken,
      channel: cookie.channel,
      requestId: Date.now() + '_' + Math.floor(Math.random() * 1000).toString().padStart(4, '0')
    };
    if (cookie.MUSIC_U) header.MUSIC_U = cookie.MUSIC_U;
    if (cookie.MUSIC_A) header.MUSIC_A = cookie.MUSIC_A;
    if (cookie.NMTID) header.NMTID = cookie.NMTID;
    if (!bareAuth) headers.Cookie = cookieObjToString(Object.assign({}, cookie, header));
    data.header = header;
    encryptData = encrypt.eapi(uri, data);
    url = (options.domain || EAPI_DOMAIN) + '/eapi/' + uri.substr(5);
  }

  var body = new URLSearchParams(encryptData).toString();
  return requestRaw({ url: url, method: 'POST', headers: headers, body: body, proxy: options.proxy, timeout: options.timeout })
    .then(function (res) {
      var setCookies = res.headers['set-cookie'] || [];
      var cookies = [];
      for (var i = 0; i < setCookies.length; i++) {
        cookies.push(String(setCookies[i]).replace(/\s*Domain=[^(;|$)]+;*/, ''));
      }
      var parsed = parseBody(res);
      if (parsed && parsed.code !== undefined) parsed.code = Number(parsed.code);
      return { status: res.statusCode, body: parsed, cookie: cookies };
    });
}

module.exports = {
  request: ncmRequest,
  cookieToJson: cookieToJson,
  cookieObjToString: cookieObjToString,
  DOMAIN: DOMAIN,
  EAPI_DOMAIN: EAPI_DOMAIN
};