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
// 票据生成/校验由插件 SDK 提供（存储复用插件缓存表）
function createStreamTicket(userId, songId) {
  return streamMod.createStreamTicket({ userId: String(userId), songId: String(songId) });
}

// 统一响应
function ok(res, data) {
  res.json(Object.assign({ code: 200 }, data || {}));
}

// 统一错误处理：业务错误对象 { code, message } 或 Error
// 底线原则：面向用户的 message 必须是中文——英文原始错误（如 TypeError 的
// 「Invalid URL」、Node ERR_* 系统码）一律在此拦下，改用通用提示 + 日志留痕。
// （ERR_INVALID_URL 曾因带字符串 code 误走业务码分支静默透传，前端 toast
//  直接显示「Invalid URL」且日志无痕，2026-09-23 修复）
function sendError(res, err) {
  if (err && typeof err === 'object' && err.code && err.message) {
    if (typeof err.code !== 'number') {
      // 字符串 code（Node 系统错误码）≠ 业务码：按内部错误处理
      console.error('[netease-music]', String(err.stack || err.message).slice(0, 300));
      return res.status(500).json({ code: 500, message: '服务暂时不可用，请稍后重试' });
    }
    return res.status(err.code >= 400 && err.code < 600 ? err.code : 500).json({ code: err.code, message: err.message });
  }
  var message = (err && err.message) || '';
  if (!/[\u4e00-\u9fa5]/.test(message)) {
    // 无中文的原始错误不透传，写日志便于诊断
    console.error('[netease-music]', (err && err.stack) ? String(err.stack).slice(0, 300) : String(message || '(空消息错误)'));
    message = '服务暂时不可用，请稍后重试';
  }
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

// 发送登录验证码（手机号登录 - 验证码模式）
router.post('/login/captcha/send', requireAuth, wrap(async function (req, res) {
  var phone = String((req.body && req.body.phone) || '').trim();
  if (!phone) return sendError(res, { code: 400, message: '缺少手机号' });
  // 参数名必须用 countrycode：内置通道（ncm eapi）内部会映射成 ctcode，
  // 而上游 Binaryify 服务只认 countrycode —— 传 ctcode 会被判「参数错误」400，
  // 而内置通道此时正被短信风控 -462 拦着，两路同时失败 = 「验证码发不出去」。
  var r = await gateway.call('captchaSent', { phone: phone, countrycode: String((req.body && req.body.countrycode) || '86') }, req.user.user_id, { noCache: true });
  if (r.data && r.data.code !== 200) {
    return res.status(400).json({ code: r.data.code, message: (r.data.message || r.data.msg || '验证码发送失败') });
  }
  ok(res, {});
}));

// 手机号登录：body { phone, countrycode?, password? | captcha? }
router.post('/login/cellphone', requireAuth, wrap(async function (req, res) {
  var body = req.body || {};
  var phone = String(body.phone || '').trim();
  if (!phone) return sendError(res, { code: 400, message: '缺少手机号' });
  if (!body.password && !body.captcha) return sendError(res, { code: 400, message: '缺少密码或验证码' });
  var args = {
    phone: phone,
    countrycode: String(body.countrycode || '86')
  };
  if (body.captcha) args.captcha = String(body.captcha);
  else args.password = String(body.password);
  var r = await gateway.loginCellphone(req.user.user_id, args);
  ok(res, r); // { code: 200, profile }
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
  var payload = streamMod.verifyStreamTicket(ticket);
  if (!payload) return sendError(res, { code: 403, message: '票据已过期，请重新获取播放地址' });
  if (payload.songId !== songId) return sendError(res, { code: 403, message: '票据与歌曲不匹配' });
  // 票据一次播放有效（GET /stream 可能伴随 Range 多次请求，票据在 TTL 内允许多次读）
  await streamMod.streamAudio(req, res, {
    resolveStreamUrl: gateway.resolveStreamUrl,
    songId: songId,
    quality: String(req.query.quality || ''),
    userId: payload.userId
  });
}));

router.get('/lyric', requireAuth, wrap(async function (req, res) {
  var r = await gateway.call('lyric', { id: String(req.query.id || '') }, req.user.user_id);
  res.json(r.data); // { code, lrc: { lyric }, tlyric: { lyric }, yrc?: { lyric }（原生逐字） }
}));

// 歌曲评论（热评 + 最新，支持分页；网易云公开数据，未登录网易云同样可读）
router.get('/comment/music', requireAuth, wrap(async function (req, res) {
  var r = await gateway.call('commentMusic', {
    id: String(req.query.id || ''),
    limit: Math.min(parseInt(req.query.limit, 10) || 20, 100),
    offset: parseInt(req.query.offset, 10) || 0,
    beforeTime: parseInt(req.query.beforeTime, 10) || 0
  }, req.user.user_id);
  res.json(r.data); // { code, total, more, hotComments: [], comments: [] }
}));

// 歌手主页：信息（头像/别名/热度）+ 热门 50 首
router.get('/artist/home', requireAuth, wrap(async function (req, res) {
  var r = await gateway.call('artistHome', { id: String(req.query.id || '') }, req.user.user_id);
  res.json(r.data); // { code, artist: {...}, hotSongs: [...] }
}));

// 歌手详细简介
router.get('/artist/desc', requireAuth, wrap(async function (req, res) {
  var r = await gateway.call('artistDesc', { id: String(req.query.id || '') }, req.user.user_id);
  res.json(r.data); // { code, briefDesc, introduction: [] }
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

// 本机收藏镜像的 ID 列表（未登录 / 云端不可用时的兜底数据源）
function localLikeIds(userId) {
  return store.getLocalLikes(userId).map(function (l) { return Number(l.id) || l.id; });
}

// 我喜欢的音乐
//   已登录网易云 → 取云端 likelist 并镜像到本地
//   未登录 / 云端失败 / 云端返回空 → 回退本机镜像（红心收藏在本机也能看到）
router.get('/like/list', requireAuth, wrap(async function (req, res) {
  var userId = req.user.user_id;
  var uid = profileUserId(userId);
  if (!uid) {
    return ok(res, { ids: localLikeIds(userId), offline: true });
  }
  var ids = [];
  try {
    var r = await gateway.call('likeList', { uid: uid }, userId, { noCache: true });
    var body = r.data || {};
    // 只有非空才覆盖镜像：空数组会把镜像清空，反而让用户「收藏全没了」
    if (Array.isArray(body.ids) && body.ids.length) {
      ids = body.ids.map(String);
      store.syncLikes(userId, ids);
    }
  } catch (e) {
    if (!(e && e.code === 503)) throw e; // 仅网络级失败兜底，其它错误不掩盖
    return ok(res, { ids: localLikeIds(userId), offline: true });
  }
  if (!ids.length) {
    var local = localLikeIds(userId);
    if (local.length) return ok(res, { ids: local, offline: true });
  }
  ok(res, { ids: ids, offline: false });
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
