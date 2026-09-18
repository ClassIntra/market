// 网易云音乐插件 - 请求网关
// 统一决定「一次网易云 API 调用」如何完成：
//   builtin  —— 本机内置协议实现（ncm/ 目录，weapi/eapi），零第三方依赖
//   upstream —— 转发到上游 NCM API 服务（api-enhanced / NeteaseCloudMusicApi 兼容）
//   auto     —— builtin 优先，网络级失败回退 upstream，仍失败回退缓存 stale
// 同时负责：
//   - 每个系统用户的网易云 cookie 上下文（登录态隔离）
//   - SQLite 响应缓存读写（TTL 各端点不同；离线时回退 stale 数据）
//   - 统一错误结构 { code, message }

var ncmApi = require('./ncm/api');
var ncmQrcode = require('./ncm/qrcode');
var store = require('./store');
var streamMod = require('./stream'); // 复用 CONNECT 隧道（代理支持）
var http = require('http');
var https = require('https');

// 各类端点的缓存 TTL（毫秒）。播放地址官方有效期 20 分钟，缓存须短于该值。
var TTL = {
  search: 5 * 60 * 1000,
  suggest: 10 * 60 * 1000,
  songDetail: 24 * 3600 * 1000,
  songUrl: 12 * 60 * 1000,
  lyric: 24 * 3600 * 1000,
  comment: 2 * 60 * 1000,
  artist: 30 * 60 * 1000,
  artistDesc: 7 * 24 * 3600 * 1000,
  playlist: 10 * 60 * 1000,
  userPlaylist: 5 * 60 * 1000,
  recommend: 30 * 60 * 1000,
  personalized: 6 * 3600 * 1000,
  toplist: 6 * 3600 * 1000,
  likeList: 5 * 60 * 1000,
  status: 0
};

// upstream 模式：端点 → api-enhanced 模块名映射
var UPSTREAM_MODULE = {
  search: 'search',
  songDetail: 'song_detail',
  songUrl: 'song_url_v1',
  lyric: 'lyric',
  commentMusic: 'comment_music',
  artistHome: 'artist',
  artistDesc: 'artist_desc',
  like: 'like',
  likeList: 'likelist',
  playlistDetail: 'playlist_detail',
  userPlaylists: 'user_playlist',
  recommendSongs: 'recommend_songs',
  personalized: 'personalized',
  toplist: 'toplist',
  loginQrKey: 'login_qr_key',
  loginQrCheck: 'login_qr_check',
  loginStatus: 'login_status',
  loginCellphone: 'login_cellphone',
  captchaSent: 'captcha_sent'
};

// 判定是否为「网络级失败」（可回退 upstream / 缓存），业务错误（如 VIP 限制）不算
function isNetworkError(err) {
  var msg = String((err && err.message) || '');
  return /ECONNREFUSED|ENOTFOUND|ETIMEDOUT|ECONNRESET|EAI_AGAIN|超时|网络|fetch failed|socket hang up/i.test(msg);
}

// HTTP(S) GET，用于 upstream 转发（零依赖；proxyUrl 提供时走代理）
function httpGetJson(url, proxyUrl) {
  return new Promise(function (resolve, reject) {
    var u = new URL(url);
    var port = parseInt(u.port, 10) || (u.protocol === 'http:' ? 80 : 443);
    var lib = u.protocol === 'http:' ? http : https;

    function handle(res) {
      var chunks = [];
      res.on('data', function (c) { chunks.push(c); });
      res.on('end', function () {
        var text = Buffer.concat(chunks).toString('utf8');
        try { resolve(JSON.parse(text)); } catch (e) { reject(new Error('上游响应解析失败')); }
      });
    }
    function bind(r) {
      r.on('error', reject);
      r.setTimeout(15000, function () { r.destroy(new Error('上游请求超时')); });
      r.end();
    }

    var req;
    if (proxyUrl && u.protocol === 'https:') {
      streamMod.proxyConnect(proxyUrl, u.hostname, port).then(function (socket) {
        req = https.request({
          hostname: u.hostname, port: port, path: u.pathname + u.search,
          method: 'GET', headers: { 'Accept': 'application/json' }, socket: socket, agent: false
        }, handle);
        bind(req);
      }, reject);
      return;
    }
    if (proxyUrl && u.protocol === 'http:') {
      var p = new URL(proxyUrl);
      req = http.request({
        hostname: p.hostname, port: parseInt(p.port, 10) || 80, path: url,
        method: 'GET', headers: { 'Accept': 'application/json', 'Host': u.hostname }
      }, handle);
      bind(req);
      return;
    }
    req = lib.request({
      hostname: u.hostname, port: port, path: u.pathname + u.search,
      method: 'GET', headers: { 'Accept': 'application/json' }
    }, handle);
    bind(req);
  });
}

// upstream 调用：GET {upstreamUrl}/{module}?query&cookie=...
async function callUpstream(engine, endpoint, query, cookieStr) {
  var base = engine.upstreamUrl.replace(/\/+$/, '');
  var moduleName = UPSTREAM_MODULE[endpoint];
  if (!moduleName) throw new Error('upstream 不支持端点: ' + endpoint);
  var params = new URLSearchParams();
  Object.keys(query || {}).forEach(function (k) {
    if (query[k] !== undefined && query[k] !== null && query[k] !== '') params.set(k, String(query[k]));
  });
  if (cookieStr) params.set('cookie', cookieStr);
  params.set('timestamp', String(Date.now())); // 防上游缓存
  var url = base + '/' + moduleName + '?' + params.toString();
  var body = await httpGetJson(url, engine.proxy);
  if (body && (body.code === 301 || body.code === 302 || body.status >= 400)) {
    throw new Error('上游返回错误: ' + JSON.stringify(body).slice(0, 200));
  }
  return body;
}

// builtin 调用：注入该用户的 cookie（api.js 统一签名 (params, ctx)）
async function callBuiltin(engine, endpoint, args, cookieStr) {
  var opts = { cookie: cookieStr || {}, timeout: engine.requestTimeout };
  if (engine.proxy) opts.proxy = engine.proxy;
  switch (endpoint) {
    case 'search': return ncmApi.search({ keywords: args.keywords, type: args.type || 1, limit: args.limit || 30, offset: args.offset || 0 }, opts);
    case 'suggest': return ncmApi.searchSuggest({ keywords: args.keywords, limit: args.limit || 8 }, opts);
    case 'songDetail': return ncmApi.songDetail({ ids: args.ids }, opts);
    case 'songUrl': return ncmApi.songUrl({ id: args.id, level: args.level || engine.quality }, opts);
    case 'lyric': return ncmApi.lyric({ id: args.id }, opts);
    case 'commentMusic': return ncmApi.commentMusic({ id: args.id, limit: args.limit || 20, offset: args.offset || 0, beforeTime: args.beforeTime || 0 }, opts);
    case 'artistHome': return ncmApi.artistHome({ id: args.id }, opts);
    case 'artistDesc': return ncmApi.artistDesc({ id: args.id }, opts);
    case 'like': return ncmApi.like({ id: args.id, uid: args.userId, like: args.like }, opts);
    case 'likeList': return ncmApi.likeList({ uid: args.uid }, opts);
    case 'likeCheck': return ncmApi.likeCheck({ ids: args.ids }, opts);
    case 'playlistDetail': return ncmApi.playlistDetail({ id: args.id }, opts);
    case 'userPlaylists': return ncmApi.userPlaylists({ uid: args.uid, limit: args.limit || 100, offset: args.offset || 0 }, opts);
    case 'recommendSongs': return ncmApi.recommendSongs({}, opts);
    case 'personalized': return ncmApi.personalized({ limit: args.limit || 12 }, opts);
    case 'toplist': return ncmApi.toplist({}, opts);
    case 'loginQrKey': return ncmApi.loginQrKey({}, opts);
    case 'loginQrCheck': return ncmApi.loginQrCheck({ key: args.key }, opts);
    case 'loginStatus': return ncmApi.loginStatus({}, opts);
    case 'logout': return ncmApi.logout({}, opts);
    case 'loginCellphone': return ncmApi.loginCellphone({ phone: args.phone, countrycode: args.countrycode, password: args.password, captcha: args.captcha }, opts);
    case 'captchaSent': return ncmApi.captchaSent({ phone: args.phone, ctcode: args.countrycode }, opts);
    default: throw new Error('未知端点: ' + endpoint);
  }
}

// 网关工厂：routes.js 持有一个实例
function createGateway() {
  // 引擎配置快照（每次请求刷新读取，便于管理端改配置即时生效）
  function readEngine() {
    var c = store.getConfig();
    return {
      engine: c.engine || 'auto',
      upstreamUrl: c.upstreamUrl || '',
      proxy: c.proxy || '',
      quality: c.quality || 'standard',
      requestTimeout: parseInt(c.requestTimeout, 10) || 8000,
      cacheEnabled: c.cacheEnabled === '1'
    };
  }

  // 组装某系统用户的网易云请求上下文（cookie 字符串 → ncm 需要对象）
  function userCookie(userId) {
    var acc = userId ? store.getAccount(userId) : null;
    return acc ? acc.cookie : '';
  }

  // 统一调用入口
  // endpoint: 见 UPSTREAM_MODULE；args: 端点参数；userId: 系统用户 ID（可空 = 匿名）
  // 返回 { data: 上游 body } 或抛错 { code, message }
  async function call(endpoint, args, userId, options) {
    options = options || {};
    var engine = readEngine();
    var cookieStr = userCookie(userId);

    // 缓存键：端点 + 参数（不含时间戳类参数）+ 用户登录态指纹
    var cacheKey = null;
    if (engine.cacheEnabled && TTL[endpoint] > 0 && !options.noCache) {
      cacheKey = endpoint + ':' + JSON.stringify(args) + ':' + (cookieStr ? cookieStr.length + ':' + (cookieStr.match(/MUSIC_U=([^;]+)/) || ['', 'anon'])[1].slice(0, 8) : 'anon');
    }
    if (cacheKey) {
      var hit = store.cacheGet(cacheKey);
      if (hit && hit.fresh) return { data: hit.payload, cached: true };
    }

    var lastErr = null;
    var order = [];
    if (engine.engine === 'builtin') order = ['builtin'];
    else if (engine.engine === 'upstream') order = ['upstream'];
    else order = ['builtin', 'upstream'];

    for (var i = 0; i < order.length; i++) {
      var mode = order[i];
      try {
        var body;
        if (mode === 'builtin') {
          var res = await callBuiltin(engine, endpoint, args, cookieStr);
          body = (res && res.body !== undefined) ? res.body : res;
        } else {
          body = await callUpstream(engine, endpoint, args, cookieStr);
        }
        if (cacheKey) store.cacheSet(cacheKey, body, TTL[endpoint]);
        return { data: body, cached: false, via: mode };
      } catch (err) {
        lastErr = err;
        if (!isNetworkError(err)) throw err; // 业务错误直接抛出，不回退
      }
    }

    // 全部引擎网络失败 → stale 缓存兜底
    if (cacheKey) {
      var stale = store.cacheGet(cacheKey);
      if (stale) return { data: stale.payload, cached: true, stale: true };
    }
    throw { code: 503, message: '无法连接网易云音乐服务' + (lastErr ? '（' + lastErr.message + '）' : '') };
  }

  // 扫码登录：生成 key 与二维码矩阵（内置编码器，离线可用）
  async function createQrLogin(userId) {
    var res = await call('loginQrKey', {}, userId, { noCache: true });
    var body = res.data || {};
    var unikey = (body.data && body.data.unikey) || body.unikey || (body.result && body.result.unikey);
    if (!unikey) throw { code: 502, message: '获取登录二维码失败' };
    var qrurl = 'https://music.163.com/login?codekey=' + unikey;
    var qr = ncmQrcode.encode(qrurl, 'M');
    return { unikey: unikey, qrurl: qrurl, size: qr.size, rows: ncmQrcode.toRows(qr) };
  }

  // 登录成功后的 cookie 落库（二维码 / 手机号登录共用）
  // 网易云登录响应体自带 cookie: [Set-Cookie...] 数组，其中含 MUSIC_U / __csrf
  async function saveLoginCookie(userId, body) {
    var cookieArr = (body.cookie && Array.isArray(body.cookie)) ? body.cookie : [];
    var cookieStr = cookieArr.join('; ');
    var profile = {};
    if (!cookieStr) return profile;
    // 先保存 cookie（loginStatus 需要它），再拉取 profile 后回写
    store.setAccount(userId, cookieStr, { profile: {} });
    try {
      var st = await call('loginStatus', {}, userId, { noCache: true });
      var sb = st.data || {};
      if (sb.profile) profile = sb.profile;
    } catch (e) { /* profile 拿不到不阻塞登录 */ }
    store.setAccount(userId, cookieStr, { profile: profile, csrf: (cookieStr.match(/__csrf=([^;]+)/) || ['', ''])[1] });
    return profile;
  }

  // 手机号登录（密码 / 验证码二选一）；成功后保存登录态
  async function loginCellphone(userId, args) {
    var res = await call('loginCellphone', args, userId, { noCache: true });
    var body = res.data || {};
    if (body.code !== 200) {
      throw { code: 400, message: (body.message || body.msg || '登录失败，请检查账号信息') };
    }
    var profile = await saveLoginCookie(userId, body);
    return { code: 200, profile: profile };
  }

  // 扫码登录：轮询；code 803 时保存登录态
  async function checkQrLogin(userId, key) {
    var res = await call('loginQrCheck', { key: key }, userId, { noCache: true });
    var body = res.data || {};
    var code = body.code;
    if (code === 803) {
      var profile = await saveLoginCookie(userId, body);
      return { code: 803, profile: profile };
    }
    return { code: code }; // 800 过期 / 801 等待 / 802 已扫描待确认
  }

  // 供 stream.js 使用：解析真实播放地址（不信任客户端传 URL）
  // userId 为票据绑定的系统用户（可空 = 匿名），用于取该用户的网易云 cookie（VIP 曲目）
  async function resolveStreamUrl(songId, quality, userId) {
    var res = await call('songUrl', { id: String(songId), level: quality || undefined }, userId || null, { noCache: false });
    var body = res.data || {};
    var item = null;
    if (Array.isArray(body.data) && body.data.length) item = body.data[0];
    else if (body.data && body.data[0]) item = body.data[0];
    if (!item || !item.url) return null;
    if (item.type && item.url.indexOf('http') === 0) item.url = item.url.replace(/^http:/, 'https:');
    return { url: item.url, type: item.type, size: item.size, level: item.level };
  }

  return {
    call: call,
    createQrLogin: createQrLogin,
    checkQrLogin: checkQrLogin,
    loginCellphone: loginCellphone,
    resolveStreamUrl: resolveStreamUrl,
    readEngine: readEngine,
    userCookie: userCookie
  };
}

module.exports = { createGateway: createGateway, isNetworkError: isNetworkError };
