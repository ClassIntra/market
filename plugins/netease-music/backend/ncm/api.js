// 网易云音乐接口封装
// 各接口的加密通道与参数结构对齐 api-enhanced 的 module/* 实现（见文件内注释），
// 返回统一结构 { status, body, cookie }，由上层做缓存 / 降级处理。

var crypto = require('crypto');
var engine = require('./engine');
var streamMod = require('../stream');
var https = require('https');

// ---------- 全局请求节流 ----------
// 前端一次操作会并发触发多个官方接口（suggest + search、lyric + comment + songUrl…），
// 突发并发是升级风控（全簇拉黑）的主要诱因。所有对外请求串行排队，最小间隔 300ms，
// 把「并发轰击」变成「匀速排队」，单次请求代价不变，风控触发率显著下降。
var THROTTLE_GAP = 300;
var throttleTail = Promise.resolve();
var lastRequestAt = 0;

function throttled(task) {
  var run = throttleTail.then(function () {
    var wait = lastRequestAt + THROTTLE_GAP - Date.now();
    if (wait > 0) return new Promise(function (r) { setTimeout(r, wait); });
  }).then(function () {
    lastRequestAt = Date.now();
    return task();
  });
  throttleTail = run.catch(function () {}); // 队列吞错防断链，错误由调用方 Promise 承接
  return run;
}

function req(uri, data, ctx, cryptoType) {
  ctx = ctx || {};
  return throttled(function () {
    return engine.request(uri, data, {
      crypto: cryptoType || '',
      cookie: ctx.cookie || {},
      proxy: ctx.proxy || '',
      timeout: ctx.timeout || 0,
      domain: ctx.domain || ''
    });
  });
}

// ---------- 簇级 -462 冷却表 ----------
// 风控按「接口簇」独立计数且间歇性（HTTP 200 但 code:-462）。某通道触发 -462 后
// 记录 60s 冷却，期间级联直接跳过该通道：既不撞墙加深风控，也避免每次搜索都
// 白白浪费 1-2 次注定失败的高频请求。
var COOLDOWN_MS = 60 * 1000;
var channelCooldown = {};
function channelBlocked(name) { return (channelCooldown[name] || 0) > Date.now(); }
function markCooldown(name) { channelCooldown[name] = Date.now() + COOLDOWN_MS; }

// 明文老接口 GET（music.163.com/api/*）
// 背景：v6/playlist/detail、v3/song/detail 等对匿名请求触发 -462 风控（返回 200 但无数据），
// 明文老接口不经过该风控，且字段兼容（artists/album/fee 齐全）。
// proxyUrl 提供时 HTTPS 走 CONNECT 隧道（与 fetchRaw 同套代理逻辑）。
function plainGetJson(pathname, query, ctx) {
  ctx = ctx || {};
  return throttled(function () { return new Promise(function (resolve, reject) {
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
  }); });
}

// 搜索（单曲 1 / 专辑 10 / 歌手 100 / 歌单 1000 / 用户 1002）
// 背景：网易云搜索接口存在间歇性 -462 风控（HTTP 200 但 code:-462「请完成验证操作」），
// 风控按接口簇独立计数——同一时刻某簇被风控，其他簇可能正常。
// 应对：多通道级联 + 簇级冷却，code!==200 或请求失败自动换下一个通道：
//   1. weapi /api/search/get        网页主搜索（老字段 artists/album，单曲缺封面）
//   2. 明文 music.163.com search/get 明文老接口（不带加密）
//   3. eapi  /api/search/pc          PC 客户端搜索
//   4. weapi /api/cloudsearch/pc    云搜索（新字段 ar/al，封面稳定）
// 全部通道失败时抛出风控错误（gateway 不缓存，前端给出明确提示与重试入口），
// 避免「风控空结果」与「真的无结果」混淆。
// 单曲结果按需用 songDetail（明文 song/detail，字段稳定带 al.picUrl）批量补全封面
// ——仅当结果里存在缺 picUrl / 缺歌手的歌才补，cloudsearch 通道原生带封面时零额外请求。
function search(params, ctx) {
  var type = params.type || 1;
  var args = {
    s: params.keywords,
    type: type,
    limit: params.limit || 30,
    offset: params.offset || 0
  };
  var channels = [
    { name: 'search:weapi', fn: function () { return req('/api/search/get', args, ctx, 'weapi'); } },
    { name: 'search:plain', fn: function () { return plainGetJson('/api/search/get', args, ctx).then(function (body) { return { status: 200, body: body, cookie: [] }; }); } },
    { name: 'search:eapi', fn: function () { return req('/api/search/pc', args, ctx, 'eapi'); } },
    { name: 'search:cloud', fn: function () { return req('/api/cloudsearch/pc', args, ctx, 'weapi'); } }
  ];
  function tryAt(i) {
    if (i >= channels.length) return null; // 全部通道失败
    if (channelBlocked(channels[i].name)) return tryAt(i + 1); // 冷却期内跳过
    return channels[i].fn().then(function (res) {
      var body = res.body || {};
      if (body.code && body.code !== 200) {
        if (body.code === -462) markCooldown(channels[i].name); // 触发风控 → 该簇冷却 60s
        return tryAt(i + 1); // 风控/异常 → 换通道
      }
      return res;
    }, function () { return tryAt(i + 1); }); // 网络/协议错误 → 换通道
  }
  return tryAt(0).then(function (res) {
    if (!res) throw { code: 503, message: '搜索暂时受限（网易云风控），请稍后重试' };
    var body = res.body || {};
    var result = body.result || {};
    if (type === 1 && body.code === 200 && result.songs && result.songs.length) {
      // 封面按需补全：全部歌曲都已带 picUrl 和歌手信息时不再发起 songDetail 请求
      var needDetail = result.songs.some(function (s) {
        return (s.album && !s.album.picUrl) || (!s.artists || !s.artists.length);
      });
      if (!needDetail) return res;
      var ids = result.songs.map(function (s) { return s.id; }).join(',');
      return songDetail({ ids: ids }, ctx).then(function (dres) {
        var detailMap = {};
        (((dres.body || {}).songs) || []).forEach(function (d) { if (d && d.id) detailMap[d.id] = d; });
        result.songs = result.songs.map(function (s) {
          var d = detailMap[s.id];
          if (!d) return s;
          // 明文 song/detail 返回老结构（album/artists），v3 weapi 返回新结构（al/ar），两者都要认——
          // 此前只读 d.al.picUrl，明文通道补的封面全部落空（搜索无封面根因）
          var dpic = (d.al && d.al.picUrl) || (d.album && d.album.picUrl) || '';
          if (s.album && !s.album.picUrl && dpic) s.album = Object.assign({}, s.album, { picUrl: dpic });
          var dArtists = (d.ar && d.ar.length) ? d.ar : (d.artists || []);
          if (dArtists.length && (!s.artists || !s.artists.length)) s.artists = dArtists;
          return s;
        });
        return res;
      }).catch(function () { return res; }); // 补封面失败不阻塞搜索结果
    }
    return res;
  });
}

// 搜索建议（关键词联想）
// 级联：weapi suggest/keyword（allMatch 关键词）→ weapi suggest/web（ songs/artists 实体）
// 统一归一化为 { code, result: { allMatch: [{ keyword }] } }，前端按下拉关键词展示。
function searchSuggest(params, ctx) {
  function fromKeyword(res) {
    var body = res.body || {};
    if (body.code !== 200) throw res;
    var matches = ((body.result || {}).allMatch || []).map(function (m) { return m.keyword || ''; });
    return matches;
  }
  function fromWeb(res) {
    var body = res.body || {};
    if (body.code !== 200) throw res;
    var result = body.result || {};
    var out = [];
    (result.order || []).forEach(function (key) {
      ((result[key]) || []).forEach(function (it) { if (it && it.name) out.push(it.name); });
    });
    return out;
  }
  function uniqueLimit(list) {
    var seen = {}, out = [];
    for (var i = 0; i < list.length && out.length < (params.limit || 8); i++) {
      var k = String(list[i]);
      if (k && !seen[k]) { seen[k] = true; out.push(k); }
    }
    return out;
  }
  // suggest 失败降级为空联想（不阻塞搜索），但 -462 时记录该簇冷却
  function onChannelFail(name) {
    return function (err) {
      if (err && err.body && err.body.code === -462) markCooldown(name);
      return [];
    };
  }
  var keywordStep = channelBlocked('suggest:keyword')
    ? Promise.resolve([])
    : req('/api/search/suggest/keyword', { s: params.keywords }, ctx, 'weapi').then(fromKeyword, onChannelFail('suggest:keyword'));
  return keywordStep
    .then(function (list) {
      if (list.length) return list;
      return req('/api/search/suggest/web', { s: params.keywords, limit: params.limit || 8 }, ctx, 'weapi').then(fromWeb, onChannelFail('suggest:web'));
    })
    .then(function (list) {
      return { status: 200, body: { code: 200, result: { allMatch: uniqueLimit(list).map(function (k) { return { keyword: k, type: 1 }; }) } }, cookie: [] };
    });
}

// 歌曲详情（批量，最多 1000 首）
// 明文老接口优先（匿名不触发风控，ids 为数字数组形式），失败回退 v3 weapi（登录用户带 cookie）
// 明文接口可能「静默丢歌」——部分歌曲（无版权/下架等）不在返回里但 HTTP 200，
// 此时对缺失的 id 再走 v3 weapi 补齐（搜索补封面依赖此处的完整性）
function songDetail(params, ctx) {
  var ids = String(params.ids || '').split(/\s*,\s*/).filter(function (id) { return id; });
  var plainIds = '[' + ids.join(',') + ']';
  var c = '[' + ids.map(function (id) { return '{"id":' + id + '}'; }).join(',') + ']';
  return plainGetJson('/api/song/detail', { ids: plainIds, n: 1000 }, ctx).then(function (body) {
    var got = body.songs || [];
    if (got.length >= ids.length) {
      return { status: 200, body: { code: 200, songs: got }, cookie: [] };
    }
    // 明文通道静默丢歌：对缺失 id 走 v3 weapi 补齐（失败不阻塞，已有的照常返回）
    var have = {};
    got.forEach(function (d) { if (d && d.id) have[String(d.id)] = true; });
    var missing = ids.filter(function (id) { return !have[String(id)]; });
    if (!missing.length) {
      return { status: 200, body: { code: 200, songs: got }, cookie: [] };
    }
    var missingC = '[' + missing.map(function (id) { return '{"id":' + id + '}'; }).join(',') + ']';
    return req('/api/v3/song/detail', { c: missingC }, ctx, 'weapi').then(function (res2) {
      var extra = ((res2.body || {}).songs) || [];
      return { status: 200, body: { code: 200, songs: got.concat(extra) }, cookie: [] };
    }, function () {
      return { status: 200, body: { code: 200, songs: got }, cookie: [] };
    });
  }).catch(function () {
    return req('/api/v3/song/detail', { c: c }, ctx, 'weapi');
  });
}

// 播放链接（v1 音质等级：standard / higher / exhigh / lossless / hires）
// v1 失败回退旧接口（按码率取流）；播放簇触发 -462 时记录 60s 冷却，
// 期间直接拒绝新请求——连续点播多首歌会成倍放大请求，加深风控。
function songUrl(params, ctx) {
  if (channelBlocked('songurl')) {
    return Promise.reject({ code: 503, message: '网易云风控限制，请稍后重试' });
  }
  var level = params.level || 'exhigh';
  var brMap = { standard: 128000, higher: 192000, exhigh: 320000, lossless: 999000, hires: 1999000 };
  var data = { ids: '[' + params.id + ']', level: level, encodeType: 'flac' };
  return req('/api/song/enhance/player/url/v1', data, ctx, 'weapi').then(function (res) {
    var first = res.body && res.body.data && res.body.data[0];
    if (first && first.url) return res;
    // 回退到旧接口（按码率取流），覆盖部分只支持 br 参数的老接口行为
    return req('/api/song/enhance/player/url', { ids: '[' + params.id + ']', br: brMap[level] || 320000 }, ctx, 'weapi');
  }).then(function (res) {
    if (res.body && res.body.code === -462) markCooldown('songurl');
    return res;
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
  // 账号簇统一走 eapi + 移动端身份（os=pc 会被风控 -462）
  return req('/api/w/nuser/account/get', {}, ctx, 'eapi');
}

// 退出登录
function logout(params, ctx) {
  return req('/api/logout', {}, ctx, 'weapi');
}

// 手机号登录（密码或验证码二选一；password 需 md5 后传输）
// 通道用 eapi + 移动端身份：账号簇在 os=pc 身份下会被网易云风控 -462，
// 换移动端身份后同接口返回真实业务码（实测假账号返回 502「账号或密码错误」）。
// 注意：网易云已对「密码登录」加了网易云盾验证，密码/验证码登录在部分网络
// 环境仍可能被拒（返回 -462/-460），此时网关会回退上游；扫码登录始终可用。
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
  return req('/api/w/login/cellphone', data, ctx, 'eapi');
}

// 发送登录验证码（ctcode 为国家码，默认 86）
// 路径必须是 /api/sms/captcha/sent：此前写成 /api/captcha/sent，weapi 通道下
// 网易云直接返回 code 404「接口未找到！」—— 前端看到的就是「验证码发送失败」。
// 通道用 eapi + 移动端身份：weapi/eapi 都会带上客户端身份，但账号簇（验证码、
// 登录、登录状态）在 os=pc 身份下会被风控 -462，移动端身份可正常下发短信。
// 参数名按网易云协议为 cellphone（不是 phone）。
function captchaSent(params, ctx) {
  return req('/api/sms/captcha/sent', {
    cellphone: params.phone,
    ctcode: String(params.ctcode || 86)
  }, ctx, 'eapi');
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