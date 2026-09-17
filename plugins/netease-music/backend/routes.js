// 网易云音乐插件 - 后端路由
// 挂载路径：/api/netease-music（见 manifest.json）
//
//   GET  /status                 登录状态 + 插件配置摘要
//   POST /login/qr/create        生成扫码登录二维码（内置编码器，离线可用）
//   GET  /login/qr/check?key=    轮询扫码状态（801 等待 / 802 已扫 / 803 成功 / 800 过期）
//   POST /logout                 退出网易云登录
//   GET  /search                 搜索（type: 1单曲 10专辑 100歌手 1000歌单）
//   GET  /search/suggest         搜索联想
//   GET  /song/detail?ids=       歌曲详情（批量）
//   GET  /song/url?id=           播放地址（返回经服务器中转的同源 /stream 地址）
//   GET  /stream?id=             音频中转（支持 Range / 磁盘缓存）
//   GET  /lyric?id=              歌词
//   POST /like                   喜欢 / 取消喜欢（同步本地收藏镜像）
//   GET  /like/list              我喜欢的音乐（离线回退本地镜像）
//   GET  /like/check?ids=        批量检查喜欢状态
//   GET  /playlist/detail?id=    歌单详情
//   GET  /playlist/track/all     歌单全部歌曲
//   GET  /user/playlist          当前登录用户的网易云歌单
//   GET  /recommend/songs        每日推荐
//   GET  /personalized           推荐歌单
//   GET  /toplist                排行榜
//   GET  /image?u=               图片中转（白名单 *.music.126.net）
//   GET/POST /admin/config       插件配置（仅管理员）

var express = require('express');
var router = express.Router();
var crypto = require('crypto');
var auth = require('../../../server/src/middleware/auth');
var store = require('./store');
var gatewayMod = require('./gateway');
var streamMod = require('./stream');
var ncmApi = require('./ncm/api');

var requireAuth = auth.requireAuth;
var requireAdmin = auth.requireAdmin;

// 网关实例（进程级单例）
var gateway = gatewayMod.createGateway();

// 概率触发过期缓存清理（避免每次请求都做全表扫描）
if (Math.random() < 0.05) store.cacheCleanup();

// 创建一次性取流票据（<audio> 标签无法携带 Authorization 头，
// 用 15 分钟短时票据把「歌曲 + 用户登录态」绑定到 /stream 请求上）
function createStreamTicket(userId, songId) {
  var ticket = crypto.randomBytes(16).toString('hex');
  store.cacheSet('streamticket:' + ticket, { userId: String(userId), songId: String(songId) }, 15 * 60 * 1000);
  return ticket;
}

// 统一响应
function ok(res, data) {
  res.json(Object.assign({ code: 200 }, data || {}));
}

// 统一错误处理：业务错误对象 { code, message } 或 Error
function sendError(res, err) {
  if (err && typeof err === 'object' && err.code && err.message) {
    return res.status(err.code >= 400 && err.code < 600 ? err.code : 500).json({ code: err.code, message: err.message });
  }
  var message = (err && err.message) || '插件内部错误';
  console.error('[netease-music]', message);
  res.status(500).json({ code: 500, message: message });
}

// 包装 async 路由处理器
function wrap(handler) {
  return function (req, res) {
    Promise.resolve(handler(req, res)).catch(function (err) { sendError(res, err); });
  };
}

// 从网易云返回体中提取 profile.userId（likeList 等需要）
function profileUserId(userId) {
  var acc = store.getAccount(userId);
  return acc && acc.profile ? (acc.profile.userId || acc.profile.id) : null;
}

// ---------- 登录相关 ----------

// 登录状态
router.get('/status', requireAuth, wrap(async function (req, res) {
  var acc = store.getAccount(req.user.user_id);
  var cfg = store.getConfig();
  ok(res, {
    loggedIn: !!(acc && acc.cookie),
    profile: acc ? acc.profile : null,
    config: {
      engine: cfg.engine,
      quality: cfg.quality,
      upstreamConfigured: !!cfg.upstreamUrl
    }
  });
}));

// 生成扫码登录二维码
router.post('/login/qr/create', requireAuth, wrap(async function (req, res) {
  var info = await gateway.createQrLogin(req.user.user_id);
  ok(res, info); // { unikey, qrurl, size, rows }
}));

// 轮询扫码状态
router.get('/login/qr/check', requireAuth, wrap(async function (req, res) {
  if (!req.query.key) return sendError(res, { code: 400, message: '缺少 key 参数' });
  var result = await gateway.checkQrLogin(req.user.user_id, String(req.query.key));
  ok(res, result); // { code: 800/801/802/803, profile? }
}));

// 退出登录
router.post('/logout', requireAuth, wrap(async function (req, res) {
  try { await gateway.call('logout', {}, req.user.user_id, { noCache: true }); } catch (e) { /* 网易云侧登出失败不阻塞本地清理 */ }
  store.clearAccount(req.user.user_id);
  ok(res, {});
}));

// ---------- 搜索 / 歌曲 ----------

router.get('/search', requireAuth, wrap(async function (req, res) {
  var r = await gateway.call('search', {
    keywords: String(req.query.keywords || ''),
    type: parseInt(req.query.type, 10) || 1,
    limit: Math.min(parseInt(req.query.limit, 10) || 30, 100),
    offset: parseInt(req.query.offset, 10) || 0
  }, req.user.user_id);
  res.json(r.data); // 透传网易云结构 { code, result: { songs, songCount } }
}));

router.get('/search/suggest', requireAuth, wrap(async function (req, res) {
  var r = await gateway.call('suggest', { keywords: String(req.query.keywords || ''), limit: 8 }, req.user.user_id);
  res.json(r.data);
}));

router.get('/song/detail', requireAuth, wrap(async function (req, res) {
  var r = await gateway.call('songDetail', { ids: String(req.query.ids || '') }, req.user.user_id);
  res.json(r.data);
}));

// 播放地址：返回同源中转地址（带票据），客户端 <audio> 直接可播
router.get('/song/url', requireAuth, wrap(async function (req, res) {
  var songId = String(req.query.id || '');
  if (!songId) return sendError(res, { code: 400, message: '缺少 id 参数' });
  var quality = String(req.query.quality || '') || undefined;
  var info = await gateway.resolveStreamUrl(songId, quality);
  if (!info) return sendError(res, { code: 404, message: '该歌曲暂无可用播放地址（可能需要 VIP 或登录）' });
  var ticket = createStreamTicket(req.user.user_id, songId);
  ok(res, {
    data: [{
      id: parseInt(songId, 10),
      url: '/api/netease-music/stream?id=' + encodeURIComponent(songId) + '&quality=' + encodeURIComponent(info.level || quality || '') + '&ticket=' + ticket,
      level: info.level, size: info.size, type: info.type,
      freeTrialInfo: null
    }]
  });
}));

// 音频中转（支持 Range 断点续传 + 磁盘缓存）
// 鉴权：票据（15 分钟内有效，绑定用户+歌曲）
router.get('/stream', wrap(async function (req, res) {
  var songId = String(req.query.id || '');
  var ticket = String(req.query.ticket || '');
  if (!songId || !ticket) return sendError(res, { code: 400, message: '缺少 id 或 ticket 参数' });
  var entry = store.cacheGet('streamticket:' + ticket);
  if (!entry || !entry.fresh) return sendError(res, { code: 403, message: '票据已过期，请重新获取播放地址' });
  if (entry.payload.songId !== songId) return sendError(res, { code: 403, message: '票据与歌曲不匹配' });
  // 票据一次播放有效（GET /stream 可能伴随 Range 多次请求，票据在 TTL 内允许多次读）
  await streamMod.streamAudio(req, res, gateway, songId, String(req.query.quality || ''), entry.payload.userId);
}));

router.get('/lyric', requireAuth, wrap(async function (req, res) {
  var r = await gateway.call('lyric', { id: String(req.query.id || '') }, req.user.user_id);
  res.json(r.data); // { code, lrc: { lyric }, tlyric: { lyric } }
}));

// ---------- 收藏（红心） ----------

// 喜欢 / 取消喜欢：body { id, like }
router.post('/like', requireAuth, wrap(async function (req, res) {
  var songId = String((req.body && req.body.id) || '');
  var like = !(req.body && req.body.like === false);
  if (!songId) return sendError(res, { code: 400, message: '缺少 id 参数' });
  var userId = req.user.user_id;
  var loggedIn = !!store.getAccount(userId);
  var isOnline = !!profileUserId(userId);

  if (isOnline) {
    // 在线：调用网易云，成功后同步本地镜像
    var r = await gateway.call('like', { id: songId, like: like, userId: profileUserId(userId) }, userId, { noCache: true });
    if (r.data && r.data.code !== 200 && r.data.code !== 502) {
      // 网易云业务失败（如需 VIP 等）
      return res.status(400).json({ code: r.data.code, message: (r.data.message || r.data.msg || '操作失败') });
    }
    if (like) {
      try {
        var d = await gateway.call('songDetail', { ids: songId }, userId);
        var song = d.data && d.data.songs && d.data.songs[0];
        if (song) store.upsertLikeMeta(userId, songId, song);
      } catch (e) { /* 元数据缓存失败不影响收藏 */ }
    } else {
      store.removeLocalLike(userId, songId);
    }
  } else {
    // 离线 / 未登录：仅本地镜像收藏（云端红心待登录后可手动同步由网易云接管）
    if (like) {
      store.upsertLikeMeta(userId, songId, (req.body && req.body.song) || {});
    } else {
      store.removeLocalLike(userId, songId);
    }
  }
  ok(res, { like: like, online: isOnline, loggedIn: loggedIn });
}));

// 我喜欢的音乐（在线取网易云并镜像；离线/未登录回退本地镜像）
router.get('/like/list', requireAuth, wrap(async function (req, res) {
  var userId = req.user.user_id;
  var uid = profileUserId(userId);
  var ids = [];
  if (uid) {
    try {
      var r = await gateway.call('likeList', { uid: uid }, userId, { noCache: true });
      var body = r.data || {};
      ids = (body.ids || []).map(String);
      if (Array.isArray(body.ids)) store.syncLikes(userId, ids);
    } catch (e) {
      if (e && e.code === 503) {
        // 网络失败：回退本地镜像
        var local = store.getLocalLikes(userId);
        return ok(res, { ids: local.map(function (l) { return Number(l.id) || l.id; }), offline: true });
      }
      throw e;
    }
  } else {
    var localLikes = store.getLocalLikes(userId);
    ids = localLikes.map(function (l) { return Number(l.id) || l.id; });
  }
  ok(res, { ids: ids, offline: !uid });
}));

// 批量检查喜欢状态
router.get('/like/check', requireAuth, wrap(async function (req, res) {
  var userId = req.user.user_id;
  var ids = String(req.query.ids || '').split(',').filter(Boolean);
  if (!ids.length) return ok(res, { code: 200, checkInfo: [] });
  var uid = profileUserId(userId);
  if (uid) {
    var r = await gateway.call('likeCheck', { ids: ids.join(',') }, userId);
    return res.json(r.data); // { code, checkInfo: [{ id, liked }] }
  }
  // 未登录：以本地镜像为准
  ok(res, {
    code: 200,
    checkInfo: ids.map(function (id) { return { id: Number(id) || id, liked: store.hasLocalLike(userId, id) }; })
  });
}));

// ---------- 歌单 / 推荐 / 榜单 ----------

router.get('/playlist/detail', requireAuth, wrap(async function (req, res) {
  var r = await gateway.call('playlistDetail', { id: String(req.query.id || '') }, req.user.user_id);
  res.json(r.data);
}));

router.get('/playlist/track/all', requireAuth, wrap(async function (req, res) {
  var id = String(req.query.id || '');
  if (!id) return sendError(res, { code: 400, message: '缺少 id 参数' });
  var limit = Math.min(parseInt(req.query.limit, 10) || 0, 1000);
  var offset = parseInt(req.query.offset, 10) || 0;
  var engineCfg = gateway.readEngine();
  // upstream 模式：转发歌单详情（上游自行决定附带曲目）
  if (engineCfg.engine === 'upstream') {
    var r = await gateway.call('playlistDetail', { id: id }, req.user.user_id);
    return res.json(r.data);
  }
  // builtin / auto 模式：走内置 playlistTrackAll（详情 + 批量详情 + 重排，自带分页）
  var acc = store.getAccount(req.user.user_id);
  var opts = { cookie: acc ? acc.cookie : {}, timeout: engineCfg.requestTimeout };
  if (engineCfg.proxy) opts.proxy = engineCfg.proxy;
  try {
    var r2 = await ncmApi.playlistTrackAll({ id: id, limit: limit || undefined, offset: offset }, opts);
    return res.json(r2.body);
  } catch (e) {
    // 失败回退：仅返回歌单详情
    var r3 = await gateway.call('playlistDetail', { id: id }, req.user.user_id);
    res.json(r3.data);
  }
}));

router.get('/user/playlist', requireAuth, wrap(async function (req, res) {
  var uid = profileUserId(req.user.user_id);
  if (!uid) return ok(res, { code: 200, playlist: [], more: false });
  var r = await gateway.call('userPlaylists', { uid: uid }, req.user.user_id);
  res.json(r.data);
}));

router.get('/recommend/songs', requireAuth, wrap(async function (req, res) {
  var r = await gateway.call('recommendSongs', {}, req.user.user_id);
  res.json(r.data);
}));

router.get('/personalized', requireAuth, wrap(async function (req, res) {
  var r = await gateway.call('personalized', { limit: Math.min(parseInt(req.query.limit, 10) || 12, 30) }, req.user.user_id);
  res.json(r.data);
}));

router.get('/toplist', requireAuth, wrap(async function (req, res) {
  var r = await gateway.call('toplist', {}, req.user.user_id);
  res.json(r.data);
}));

// ---------- 媒体中转 ----------

// 图片中转（白名单 *.music.126.net）
router.get('/image', wrap(async function (req, res) {
  await streamMod.streamImage(req, res, String(req.query.u || ''));
}));

// ---------- 管理配置 ----------

router.get('/admin/config', requireAdmin, function (req, res) {
  ok(res, { config: store.getConfig() });
});

router.post('/admin/config', requireAdmin, function (req, res) {
  var applied = store.setConfig(req.body || {});
  ok(res, { applied: applied });
});

module.exports = router;
