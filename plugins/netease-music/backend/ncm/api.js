// 网易云音乐接口封装
// 各接口的加密通道与参数结构对齐 api-enhanced 的 module/* 实现（见文件内注释），
// 返回统一结构 { status, body, cookie }，由上层做缓存 / 降级处理。

var crypto = require('crypto');
var engine = require('./engine');
var streamMod = require('../stream');
var https = require('https');

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

// 明文老接口 GET（music.163.com/api/*）
// 背景：v6/playlist/detail、v3/song/detail 等对匿名请求触发 -462 风控（返回 200 但无数据），
// 明文老接口不经过该风控，且字段兼容（artists/album/fee 齐全）。
// proxyUrl 提供时 HTTPS 走 CONNECT 隧道（与 fetchRaw 同套代理逻辑）。
function plainGetJson(pathname, query, ctx) {
  ctx = ctx || {};
  return new Promise(function (resolve, reject) {
    var qs = [];
    for (var k in query) {
      if (query[k] !== undefined && query[k] !== null && query[k] !== '') {
        qs.push(k + '=' + encodeURIComponent(query[k]));
      }
    }
    var url = 'https://music.163.com' + pathname + '?' + qs.join('&');
    function handleBody(res) {
      var chunks = [];
      res.on('data', function (c) { chunks.push(c); });
      res.on('end', function () {
        var text = Buffer.concat(chunks).toString('utf8');
        try {
          var body = JSON.parse(text);
          if (body.code === 200) resolve(body);
          else reject(new Error('明文接口返回 code ' + body.code));
        } catch (e) { reject(new Error('明文接口响应解析失败')); }
      });
    }
    function requestWithSocket(socket) {
      var r = https.get(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/80.0 Safari/537.36',
          'Referer': 'https://music.163.com/',
          'Cookie': 'os=pc; appver=2.9.7'
        },
        socket: socket,
        agent: false
      }, handleBody);
      r.setTimeout(ctx.timeout || 10000, function () { r.destroy(new Error('明文接口请求超时')); });
      r.on('error', reject);
    }
    if (ctx.proxy) {
      streamMod.proxyConnect(ctx.proxy, 'music.163.com', 443).then(requestWithSocket, reject);
      return;
    }
    requestWithSocket(undefined);
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
// 明文老接口优先（匿名不触发风控，ids 为数字数组形式），失败回退 v3 weapi（登录用户带 cookie）
function songDetail(params, ctx) {
  var ids = String(params.ids || '').split(/\s*,\s*/).filter(function (id) { return id; });
  var plainIds = '[' + ids.join(',') + ']';
  var c = '[' + ids.map(function (id) { return '{"id":' + id + '}'; }).join(',') + ']';
  return plainGetJson('/api/song/detail', { ids: plainIds, n: 1000 }, ctx).then(function (body) {
    return { status: 200, body: { code: 200, songs: body.songs || [] }, cookie: [] };
  }).catch(function () {
    return req('/api/v3/song/detail', { c: c }, ctx, 'weapi');
  });
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

// 歌词 v1：优先取 yrc 原生逐字歌词（字级时间戳）+ 翻译；部分老歌 v1 无数据时回退旧接口
function lyric(params, ctx) {
  return req('/api/song/lyric/v1', {
    id: params.id,
    cv: 160390,
    lv: -1, kv: -1, tv: -1, rv: -1,
    yv: 1, ytv: -1, yrv: -1
  }, ctx, 'weapi').then(function (res) {
    var body = res.body || {};
    if (body.code === 200 && ((body.yrc && body.yrc.lyric) || (body.lrc && body.lrc.lyric))) return res;
    // 回退旧接口（仅 lrc / tlyric）
    return req('/api/song/lyric', { id: params.id, lv: -1, kv: -1, tv: -1 }, ctx, 'weapi');
  });
}

// 歌曲评论（热评 + 最新，cloud 类型 R_SO_4 = 歌曲）
function commentMusic(params, ctx) {
  return req('/api/v1/resource/comments/R_SO_4_' + params.id, {
    rid: params.id,
    offset: params.offset || 0,
    limit: params.limit || 20,
    beforeTime: params.beforeTime || 0
  }, ctx, 'weapi');
}

// 歌手主页：信息（头像/别名/简介摘要）+ 热门 50 首
function artistHome(params, ctx) {
  return req('/api/artist/' + params.id, { id: params.id }, ctx, 'weapi');
}

// 歌手详细简介
function artistDesc(params, ctx) {
  return req('/api/artist/desc/' + params.id, { id: params.id }, ctx, 'weapi');
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

// 歌单详情：明文老接口优先（匿名可用），result 字段统一归一化为 playlist 供调用方使用
// （明文接口不传用户 cookie，公开歌单不受影响）；失败回退 v6 weapi（s=8 时附带 trackIds）
function playlistDetail(params, ctx) {
  return plainGetJson('/api/playlist/detail', { id: params.id, n: params.n || 1000 }, ctx).then(function (body) {
    var pl = body.result || {};
    return { status: 200, body: { code: 200, playlist: pl }, cookie: [] };
  }).catch(function () {
    return req('/api/v6/playlist/detail', { id: params.id, n: params.n || 100000, s: params.s || 8 }, ctx, 'weapi');
  });
}

// 歌单全部歌曲：明文老接口直接携带 tracks（含 artists/album/fee），按 offset/limit 截取
// 失败回退原链路（v6 详情取 trackIds + 批量歌曲详情 + 按 trackIds 重排）
function playlistTrackAll(params, ctx) {
  var offset = params.offset || 0;
  var limit = params.limit || 0;
  return plainGetJson('/api/playlist/detail', { id: params.id, n: 1000 }, ctx).then(function (body) {
    var pl = body.result || {};
    var tracks = pl.tracks || [];
    var slice = limit ? tracks.slice(offset, offset + limit) : tracks.slice(offset);
    return {
      status: 200,
      body: {
        code: 200,
        songs: slice,
        playlist: { id: pl.id, name: pl.name, coverImgUrl: pl.coverImgUrl, trackCount: pl.trackCount || tracks.length, trackIds: [] }
      },
      cookie: []
    };
  }).catch(function () {
    return playlistDetail({ id: params.id, s: 8 }, ctx).then(function (res) {
      var playlist = (res.body && res.body.playlist) || {};
      var ids = playlist.trackIds || [];
      var slice = limit ? ids.slice(offset, offset + limit).map(function (t) { return t.id; }) : ids.slice(offset).map(function (t) { return t.id; });
      if (!slice.length) return { status: 200, body: { code: 200, songs: playlist.tracks || [], playlist: playlist }, cookie: [] };
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
  commentMusic: commentMusic,
  artistHome: artistHome,
  artistDesc: artistDesc,
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