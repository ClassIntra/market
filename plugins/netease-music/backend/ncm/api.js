// 网易云音乐接口封装
// 各接口的加密通道与参数结构对齐 api-enhanced 的 module/* 实现（见文件内注释），
// 返回统一结构 { status, body, cookie }，由上层做缓存 / 降级处理。

var crypto = require('crypto');
var engine = require('./engine');

function req(uri, data, ctx, cryptoType) {
  ctx = ctx || {};
  return engine.request(uri, data, {
    crypto: cryptoType || '',
    cookie: ctx.cookie || {},
    proxy: ctx.proxy || '',
    timeout: ctx.timeout || 0,
    domain: ctx.domain || ''
  });
}

// 搜索（单曲 1 / 专辑 10 / 歌手 100 / 歌单 1000 / 用户 1002）
// 使用 cloudsearch 接口：返回 songs[].al.picUrl 封面稳定，结构与 v3 song detail 一致
function search(params, ctx) {
  return req('/api/cloudsearch/pc', {
    s: params.keywords,
    type: params.type || 1,
    limit: params.limit || 30,
    offset: params.offset || 0
  }, ctx, 'weapi');
}

// 搜索建议（关键词联想）
function searchSuggest(params, ctx) {
  return req('/api/search/suggest/web', {
    s: params.keywords,
    limit: params.limit || 8
  }, ctx, 'weapi');
}

// 歌曲详情（批量，最多 1000 首）
function songDetail(params, ctx) {
  var ids = String(params.ids || '').split(/\s*,\s*/).filter(function (id) { return id; });
  var c = '[' + ids.map(function (id) { return '{"id":' + id + '}'; }).join(',') + ']';
  return req('/api/v3/song/detail', { c: c }, ctx, 'weapi');
}

// 播放链接（v1 音质等级：standard / higher / exhigh / lossless / hires）
function songUrl(params, ctx) {
  var level = params.level || 'exhigh';
  var data = { ids: '[' + params.id + ']', level: level, encodeType: 'flac' };
  return req('/api/song/enhance/player/url/v1', data, ctx, 'weapi').then(function (res) {
    var first = res.body && res.body.data && res.body.data[0];
    if (first && first.url) return res;
    // 回退到旧接口（按码率取流），覆盖部分只支持 br 参数的老接口行为
    var brMap = { standard: 128000, higher: 192000, exhigh: 320000, lossless: 999000, hires: 1999000 };
    return req('/api/song/enhance/player/url', { ids: '[' + params.id + ']', br: brMap[level] || 320000 }, ctx, 'weapi');
  });
}

// 歌词（含翻译）
function lyric(params, ctx) {
  return req('/api/song/lyric', { id: params.id, lv: -1, kv: -1, tv: -1 }, ctx, 'weapi');
}

// 喜欢 / 取消喜欢
function like(params, ctx) {
  return req('/api/song/like', {
    trackId: params.id,
    userid: params.uid,
    like: params.like === false ? false : true
  }, ctx, 'weapi');
}

// 我喜欢的音乐 ID 列表
function likeList(params, ctx) {
  return req('/api/song/like/get', { uid: params.uid }, ctx, 'weapi');
}

// 批量检查是否已喜欢
function likeCheck(params, ctx) {
  return req('/api/song/like/check', { trackIds: params.ids }, ctx, 'weapi');
}

// 歌单详情（s=8 时附带 trackIds）
function playlistDetail(params, ctx) {
  return req('/api/v6/playlist/detail', { id: params.id, n: 100000, s: params.s || 8 }, ctx, 'weapi');
}

// 歌单全部歌曲（v6 详情 + 批量歌曲详情，对齐 api-enhanced playlist_track_all）
function playlistTrackAll(params, ctx) {
  return playlistDetail({ id: params.id, s: 8 }, ctx).then(function (res) {
    var playlist = (res.body && res.body.playlist) || {};
    var ids = playlist.trackIds || [];
    var offset = params.offset || 0;
    var limit = params.limit || ids.length;
    var slice = ids.slice(offset, offset + limit).map(function (t) { return t.id; });
    if (!slice.length) return { status: 200, body: { code: 200, songs: [], playlist: playlist }, cookie: [] };
    return songDetail({ ids: slice.join(',') }, ctx).then(function (detailRes) {
      var songs = (detailRes.body && detailRes.body.songs) || [];
      // 按 trackIds 顺序重排（song detail 返回顺序可能与歌单顺序不同）
      var map = {};
      for (var i = 0; i < songs.length; i++) map[songs[i].id] = songs[i];
      var ordered = [];
      for (var j = 0; j < slice.length; j++) {
        if (map[slice[j]]) ordered.push(map[slice[j]]);
      }
      return { status: 200, body: { code: 200, songs: ordered, playlist: playlist }, cookie: [] };
    });
  });
}

// 用户歌单（含「我喜欢的音乐」）
function userPlaylists(params, ctx) {
  return req('/api/user/playlist', {
    uid: params.uid,
    limit: params.limit || 100,
    offset: params.offset || 0,
    includeVideo: true
  }, ctx, 'weapi');
}

// 每日推荐歌曲
function recommendSongs(params, ctx) {
  return req('/api/v3/discovery/recommend/songs', { afresh: params.afresh }, ctx, 'weapi');
}

// 推荐歌单
function personalized(params, ctx) {
  return req('/api/personalized/playlist', {
    limit: params.limit || 12,
    total: true,
    n: 1000
  }, ctx, 'weapi');
}

// 榜单列表
function toplist(params, ctx) {
  return req('/api/toplist', {}, ctx, 'weapi');
}

// 二维码登录：生成 unikey
function loginQrKey(params, ctx) {
  return req('/api/login/qrcode/unikey', { type: 3 }, ctx, 'eapi');
}

// 二维码登录：轮询状态（800 过期 / 801 等待扫码 / 802 待确认 / 803 成功）
function loginQrCheck(params, ctx) {
  return req('/api/login/qrcode/client/login', { key: params.key, type: 3 }, ctx, 'eapi');
}

// 登录状态 / 账号信息
function loginStatus(params, ctx) {
  return req('/api/w/nuser/account/get', {}, ctx, 'weapi');
}

// 退出登录
function logout(params, ctx) {
  return req('/api/logout', {}, ctx, 'weapi');
}

// 手机号登录（密码或验证码二选一；password 需 md5 后传输）
function loginCellphone(params, ctx) {
  var data = {
    phone: params.phone,
    countrycode: params.countrycode || '86',
    rememberLogin: 'true'
  };
  if (params.captcha) {
    data.captcha = params.captcha;
  } else {
    // 网易云协议要求密码先做 md5 再传输
    data.password = crypto.createHash('md5').update(String(params.password)).digest('hex');
  }
  return req('/api/w/login/cellphone', data, ctx, 'weapi');
}

// 发送登录验证码（ctcode 为国家码，默认 86）
function captchaSent(params, ctx) {
  return req('/api/captcha/sent', { phone: params.phone, ctcode: params.ctcode || 86 }, ctx, 'weapi');
}

module.exports = {
  search: search,
  searchSuggest: searchSuggest,
  songDetail: songDetail,
  songUrl: songUrl,
  lyric: lyric,
  like: like,
  likeList: likeList,
  likeCheck: likeCheck,
  playlistDetail: playlistDetail,
  playlistTrackAll: playlistTrackAll,
  userPlaylists: userPlaylists,
  recommendSongs: recommendSongs,
  personalized: personalized,
  toplist: toplist,
  loginQrKey: loginQrKey,
  loginQrCheck: loginQrCheck,
  loginStatus: loginStatus,
  logout: logout,
  loginCellphone: loginCellphone,
  captchaSent: captchaSent
};