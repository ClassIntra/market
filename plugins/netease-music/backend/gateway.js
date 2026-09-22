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
var errors = require('./errors');
var PluginError = errors.PluginError;
var isNetworkError = errors.isNetworkError; // 统一错误类型收编（见 errors.js）
var log = require('./log');

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

// upstream 模式：端点 → api-enhanced 模块名映射（默认风格，下划线模块名）
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

// upstream 模式：Binaryify NeteaseCloudMusicApi 原版路由映射（斜杠路径，如自建 NCM 服务）
var UPSTREAM_MODULE_NCM = {
  search: 'search',
  songDetail: 'song/detail',
  songUrl: 'song/url',
  lyric: 'lyric',
  commentMusic: 'comment/music',
  artistHome: 'artist',
  artistDesc: 'artist/desc',
  like: 'like',
  likeList: 'likelist',
  playlistDetail: 'playlist/detail',
  userPlaylists: 'user/playlist',
  recommendSongs: 'recommend/songs',
  personalized: 'personalized',
  toplist: 'toplist',
  loginQrKey: 'login/qr/key',
  loginQrCheck: 'login/qr/check',
  loginStatus: 'login/status',
  loginCellphone: 'login/cellphone',
  captchaSent: 'captcha/sent'
};

// HTTP(S) GET JSON 已下沉插件 SDK（stream.js 门面 re-export）
var httpGetJson = streamMod.httpGetJson;

// 搜索结果封面统一补全（builtin 与 upstream 共用的网关层后处理）
// 背景：封面补全原本只写在 builtin ncmApi.search 内部——风控期间 builtin search 失败
// 回退 upstream（第三方 NCM API），其搜索结果是老结构（album 无 picUrl）且无补全逻辑，
// 用户看到「搜索结果全无封面」。此处在网关层统一兜底：凡单曲缺 picUrl 就用
// songDetail 明文通道批量补齐（明文 song/detail 不属于 search 簇，不受其风控影响）。
// builtin 正常路径补全后全部带封面，这里 need 为空直接跳过，零额外请求。
function ensureSearchCovers(body, engine) {
  var result = (body && body.result) || {};
  var songs = result.songs;
  if (!Array.isArray(songs) || !songs.length) return Promise.resolve(body);
  var need = songs.filter(function (s) {
    return s && s.id && !((s.album && s.album.picUrl) || (s.al && s.al.picUrl));
  });
  if (!need.length) return Promise.resolve(body);
  var ids = need.map(function (s) { return s.id; }).join(',');
  var opts = { cookie: {}, timeout: engine.requestTimeout || 8000 };
  if (engine.proxy) opts.proxy = engine.proxy;
  return ncmApi.songDetail({ ids: ids }, opts).then(function (dres) {
    var map = {};
    (((dres.body || {}).songs) || []).forEach(function (d) { if (d && d.id) map[d.id] = d; });
    songs.forEach(function (s) {
      var d = map[s.id];
      if (!d) return;
      // 双结构兼容：老结构 album/artists，新结构 al/ar，两边都要能落封面
      var dpic = (d.album && d.album.picUrl) || (d.al && d.al.picUrl) || '';
      if (dpic) {
        if (s.album) s.album = Object.assign({}, s.album, { picUrl: dpic });
        else if (s.al) s.al = Object.assign({}, s.al, { picUrl: dpic });
        else s.album = { picUrl: dpic };
      }
      var dArtists = (d.artists && d.artists.length) ? d.artists : (d.ar || []);
      if (dArtists.length && (!s.artists || !s.artists.length)) s.artists = dArtists;
    });
    return body;
  }).catch(function () { return body; }); // 补全失败不阻塞搜索结果
}

// 可回退判定：网络级失败或「网易云侧不可用」（风控 -462 负数码、级联受限 503、接口异常 502）
// 都应尝试 upstream——本机通道被风控 ≠ 业务不可用，upstream（第三方自建 API）可能可用。
// 真业务错误（400/403 参数/VIP 等）不回退，直接抛给调用方。
function isFallbackable(err) {
  if (isNetworkError(err)) return true;
  var code = err && err.code;
  if (typeof code === 'number' && (code < 0 || code === 502 || code === 503)) return true;
  return false;
}

// upstream 调用：GET {upstreamUrl}/{module}?query&cookie=...
async function callUpstream(engine, endpoint, query, cookieStr) {
  var base = engine.upstreamUrl.replace(/\/+$/, '');
  // upstreamStyle=ncm → Binaryify 原版斜杠路由；默认 enhanced → api-enhanced 模块名
  var moduleMap = engine.upstreamStyle === 'ncm' ? UPSTREAM_MODULE_NCM : UPSTREAM_MODULE;
  var moduleName = moduleMap[endpoint];
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
      upstreamStyle: c.upstreamStyle || 'enhanced',
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

  // 请求指纹（缓存键 / 并发去重键共用）：区分登录态，避免 A 用户的响应被 B 用户命中
  function fingerprint(cookieStr) {
    return cookieStr ? cookieStr.length + ':' + (cookieStr.match(/MUSIC_U=([^;]+)/) || ['', 'anon'])[1].slice(0, 8) : 'anon';
  }

  // 并发去重表：同「端点+参数+登录态」的进行中请求共享同一 Promise
  var inflight = {};

  // 执行一次真实调用（多引擎级联 + 缓存写入 + stale 兜底）
  async function execCall(endpoint, args, cookieStr, cacheKey) {
    var engine = readEngine(); // 引擎配置快照（与 call() 内一致；缺失将导致 engine is not defined）
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
        // 风控/异常响应（负数码，如 -462）不落缓存、直接抛出——
        // 否则会被当成功结果缓存 5 分钟，风控解除后用户仍看到空结果。
        // QR 登录轮询的 800/801/802/803 为正数业务码，不受影响。
        if (body && typeof body.code === 'number' && body.code < 200) {
          log.debug('gateway', '风控/异常响应（code ' + body.code + '），endpoint=' + endpoint + ' via=' + mode);
          throw new PluginError(502, '网易云接口异常（code ' + body.code + '），请稍后重试');
        }
        if (endpoint === 'search') body = await ensureSearchCovers(body, engine); // 搜索封面统一补全（upstream 路径裸奔根因）
        if (cacheKey) store.cacheSetIfOk(cacheKey, body, TTL[endpoint]); // 成功才缓存（写入口自带负数 code 拦截）
        return { data: body, cached: false, via: mode };
      } catch (err) {
        lastErr = err;
        if (!isFallbackable(err)) throw err; // 业务错误直接抛出，不回退
        log.debug('gateway', '引擎 ' + mode + ' 失败（' + err.message + '），endpoint=' + endpoint + (i < order.length - 1 ? '，回退下一引擎' : ''));
      }
    }

    // 全部引擎网络失败 → stale 缓存兜底
    if (cacheKey) {
      var stale = store.cacheGet(cacheKey);
      if (stale) return { data: stale.payload, cached: true, stale: true };
    }
    throw new PluginError(503, '无法连接网易云音乐服务' + (lastErr ? '（' + lastErr.message + '）' : ''), lastErr);
  }

  // 统一调用入口
  // endpoint: 见 UPSTREAM_MODULE；args: 端点参数；userId: 系统用户 ID（可空 = 匿名）
  // 返回 { data: 上游 body } 或抛错 { code, message }
  async function call(endpoint, args, userId, options) {
    options = options || {};
    var engine = readEngine();
    var cookieStr = userCookie(userId);

    var fp = fingerprint(cookieStr);

    // 缓存键：端点 + 参数（不含时间戳类参数）+ 用户登录态指纹
    var cacheKey = null;
    if (engine.cacheEnabled && TTL[endpoint] > 0 && !options.noCache) {
      cacheKey = endpoint + ':' + JSON.stringify(args) + ':' + fp;
    }
    if (cacheKey) {
      var hit = store.cacheGet(cacheKey);
      if (hit && hit.fresh) {
        // 读取时同样拦截负数码响应：防御历史脏缓存（风控响应曾被旧版本误写入）
        // 在整个 TTL 周期内持续毒害命中结果
        if (hit.payload && typeof hit.payload.code === 'number' && hit.payload.code < 200) {
          log.debug('gateway', '脏缓存拦截（code ' + hit.payload.code + '）:', cacheKey);
          // 跳过命中，走正常请求流程，成功后覆盖写入
        } else {
          log.debug('gateway', '缓存命中:', cacheKey);
          return { data: hit.payload, cached: true };
        }
      }
    }

    // 并发去重：同一时刻相同请求只发出一次（搜索联想+列表、快速翻页、
    // 重复渲染等场景会把相同请求放大数倍，正是触发风控的突发流量来源）
    var dedupeKey = endpoint + ':' + JSON.stringify(args) + ':' + fp;
    if (inflight[dedupeKey]) return inflight[dedupeKey];

    var task = execCall(endpoint, args, cookieStr, cacheKey);
    inflight[dedupeKey] = task;
    function clearInflight() { delete inflight[dedupeKey]; }
    task.then(clearInflight, clearInflight);
    return task;
  }

  // 扫码登录：生成 key 与二维码矩阵（内置编码器，离线可用）
  async function createQrLogin(userId) {
    var res = await call('loginQrKey', {}, userId, { noCache: true });
    var body = res.data || {};
    var unikey = (body.data && body.data.unikey) || body.unikey || (body.result && body.result.unikey);
    if (!unikey) throw new PluginError(502, '获取登录二维码失败');
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
      throw new PluginError(400, (body.message || body.msg || '登录失败，请检查账号信息'));
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
