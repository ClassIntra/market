// AstrBot Relay - 后端路由
// 挂载路径：/api/astrbot
//
//   GET  /status                 插件与机器人连接状态（CI WS + OneBot 反向 WS），需管理员会话
//   POST /publish                论坛发帖（AstrBot 端 LLM 工具回调），需共享密钥 x-publish-key
//
//   ── 站内信息共享（同样需 x-publish-key，供 AstrBot 端 LLM 工具读取 CI 实据）──
//   GET  /info/announcements     公告列表
//   GET  /info/broadcasts        快讯列表
//   GET  /info/forum             社区帖子列表（forum/poll/survey，按普通用户视角过滤）
//   GET  /info/post/:id/comments 某帖评论列表
//   GET  /info/resources         资源仓库列目录（排除 public/cloud）
//   GET  /info/weather           当前天气 + 今日预报 + 空气质量 + 预警 + 生活指数
//   GET  /info/pulse             聚合快照（公告+快讯+热帖+最新帖+天气+资源根）
//   POST /post/:id/comment       以林晞身份回帖
//
//   ── 管理动作代理（同样需 x-publish-key；仅管理员本人授权，破坏性动作需 confirmed）──
//   GET  /manage/ops             列出可执行的管理动作（op 表 / 是否破坏性 / 参数说明）
//   POST /manage                 执行管理动作 {requester_id, op, params, confirmed}
//
// require 时自动启动：机器人登录 CI WS + 连入 AstrBot OneBot 反向 WS（幂等）。

var express = require('express');
var router = express.Router();
var relay = require('./relay');
var info = require('./info');
var manage = require('./manage');
// 状态接口仅管理员可见；发布接口走共享密钥，见 publishKeyOk
var { requireAuth, requireAdmin } = require('../../../server/src/middleware/auth');

// 启动机器人（幂等；依赖 server/.env 中的 BOT_PASSWORD 等环境变量）
relay.start();

// 发布接口鉴权：请求头 x-publish-key 必须与 server/.env 的 ASTRBOT_PUBLISH_KEY 一致
function publishKeyOk(req) {
  var expected = process.env.ASTRBOT_PUBLISH_KEY || '';
  if (!expected) return false;
  return String(req.headers['x-publish-key'] || '') === expected;
}

// 论坛帖子字段清洗（与 community 应用路由保持一致）
function sanitizePostPayload(body) {
  body = body || {};
  var payload = {
    type: 'forum',
    title: String(body.title || '').trim(),
    content: String(body.content || '').trim(),
    is_anonymous: (body.anonymous || body.is_anonymous) ? 1 : 0,
    visible_groups: Array.isArray(body.visible_groups) ? body.visible_groups : [],
    hidden_groups: Array.isArray(body.hidden_groups) ? body.hidden_groups : [],
    tags: []
  };
  if (Array.isArray(body.tags)) {
    payload.tags = body.tags.filter(function (t) {
      return typeof t === 'string' && t.trim().length > 0 && t.trim().length <= 20;
    }).slice(0, 5);
  }
  return payload;
}

// 读取原始请求体（附图 base64 较大，绕过全局 1MB JSON 限制，由本路由自行限流）
function readRawBody(req, maxBytes) {
  return new Promise(function (resolve, reject) {
    var chunks = [];
    var size = 0;
    req.on('data', function (chunk) {
      size += chunk.length;
      if (size > maxBytes) {
        reject(new Error('请求体过大'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', function () {
      resolve(Buffer.concat(chunks).toString('utf8'));
    });
    req.on('error', reject);
  });
}

// 状态查询（管理员）
router.get('/status', requireAuth, requireAdmin, function (req, res) {
  res.json({ code: 200, message: 'ok', data: relay.getStatus() });
});

// 论坛发帖（AstrBot 插件用共享密钥调用，机器人账号身份）
router.post('/publish', async function (req, res) {
  if (!publishKeyOk(req)) {
    return res.status(401).json({ code: 401, message: 'publish key 无效' });
  }
  // 优先用 express 已解析的 JSON（application/json 且体积 ≤1MB）；
  // text/plain 等其余类型 express 不解析（req.body 为空对象），此时改读原始请求体
  var body = (req.body && typeof req.body === 'object' && Object.keys(req.body).length)
    ? req.body : null;
  if (!body) {
    var raw;
    try {
      raw = await readRawBody(req, 128 * 1024 * 1024);
    } catch (e) {
      return res.status(413).json({ code: 413, message: '请求体过大' });
    }
    if (!raw || !raw.trim()) {
      return res.status(400).json({ code: 400, message: '请求体必须是 JSON' });
    }
    try {
      body = JSON.parse(raw);
    } catch (e) {
      return res.status(400).json({ code: 400, message: '请求体必须是 JSON' });
    }
  }
  var payload = sanitizePostPayload(body);
  if (!payload.content) {
    return res.status(400).json({ code: 400, message: '帖子内容不能为空' });
  }
  var images = Array.isArray(body.images) ? body.images : [];
  if (images.length > 9) {
    return res.status(400).json({ code: 400, message: '帖子最多附带 9 张图片' });
  }
  try {
    // 附图先持久化到 botmedia/remote，转成站内 URL 追加为 Markdown 图片
    var imageUrls = [];
    for (var i = 0; i < images.length; i++) {
      imageUrls.push(await relay.persistPublishImage(images[i]));
    }
    if (imageUrls.length) {
      payload.content += '\n\n' + imageUrls.map(function (u) { return '![](' + u + ')'; }).join('\n\n');
    }
    var post = await relay.publishForumPost(payload);
    res.json({
      code: 200,
      message: 'ok',
      data: {
        id: post.id,
        type: post.type,
        title: post.title || '',
        content: post.content || '',
        anonymous: post.anonymous || post.is_anonymous || 0,
        created_at: post.created_at || null
      }
    });
  } catch (e) {
    var status = (e && e.response && e.response.status) || 500;
    var message = (e && e.response && e.response.data && e.response.data.message)
      || e.message || '发帖失败';
    if (status >= 500) console.error('[astrbot-relay] 发布帖子失败:', e);
    res.status(status >= 500 ? 500 : status).json({ code: status, message: message });
  }
});

// 帖子详情（AstrBot 端 read_classintra_post 工具用，含最新评论）
router.get('/post/:id', function (req, res) {
  if (!publishKeyOk(req)) {
    return res.status(401).json({ code: 401, message: 'publish key 无效' });
  }
  var detail = relay.getPostDetail(req.params.id);
  if (!detail) {
    return res.status(404).json({ code: 404, message: '帖子不存在或已删除' });
  }
  res.json({ code: 200, message: 'ok', data: detail });
});

// 删除社区帖子（bot 账号鉴权，仅能删自己发的帖子；权限由 CI 侧判定）
router.delete('/post/:id', async function (req, res) {
  if (!publishKeyOk(req)) {
    return res.status(401).json({ code: 401, message: 'publish key 无效' });
  }
  try {
    await relay.deleteForumPost(req.params.id);
    res.json({ code: 200, message: 'ok' });
  } catch (e) {
    var status = (e && e.response && e.response.status) || 500;
    var msg = (e && e.response && e.response.data && e.response.data.message) || e.message;
    res.status(status === 403 ? 403 : (status === 404 ? 404 : 500)).json({ code: status, message: msg });
  }
});

// 撤回 bot 最近发出的聊天消息（channel: public|private；2 分钟内有效，由 CI 侧最终判定）
router.post('/recall', function (req, res) {
  if (!publishKeyOk(req)) {
    return res.status(401).json({ code: 401, message: 'publish key 无效' });
  }
  var channel = String((req.body && req.body.channel) || '').trim();
  var target = String((req.body && req.body.target) || '').trim();
  var count = parseInt((req.body && req.body.count) || 1, 10);
  if (['public', 'private'].indexOf(channel) === -1) {
    return res.status(400).json({ code: 400, message: 'channel 必须为 public 或 private' });
  }
  if (isNaN(count) || count < 1 || count > 10) count = 1;
  if (channel === 'private' && !target) {
    return res.status(400).json({ code: 400, message: '私聊撤回必须提供 target' });
  }
  var okCount = relay.recallRecentByTarget(channel, target, count);
  res.json({ code: 200, message: 'ok', data: { recalled: okCount } });
});

// ===== 站内信息共享（让林晞以内生身份读 CI 实据）=====
//
// 设计：全部需 x-publish-key（与 /publish 同一把钥匙，只给 AstrBot 侧用）。
//   读公告/快讯/资源/天气 → 复用 CI 的库与配置（info.js），只读；
//   读社区帖子/评论、回帖 → 带林晞 JWT 调 CI 自身路由（relay.js），可见性与写权限同真人。

function requirePublishKey(req, res, next) {
  if (!publishKeyOk(req)) {
    return res.status(401).json({ code: 401, message: 'publish key 无效' });
  }
  next();
}

router.get('/info/announcements', requirePublishKey, function (req, res) {
  res.json({ code: 200, message: 'ok', data: info.listAnnouncements(req.query.limit) });
});

router.get('/info/broadcasts', requirePublishKey, function (req, res) {
  res.json({ code: 200, message: 'ok', data: info.listBroadcasts(req.query.limit) });
});

router.get('/info/forum', requirePublishKey, async function (req, res) {
  try {
    var data = await relay.fetchCommunityPosts({
      type: req.query.type,
      sort: req.query.sort,
      limit: req.query.limit,
      page: req.query.page
    });
    res.json({ code: 200, message: 'ok', data: data });
  } catch (e) {
    console.error('[astrbot-relay] 读取社区帖子失败:', e.message);
    res.status(502).json({ code: 502, message: e.message || '读取社区帖子失败' });
  }
});

router.get('/info/post/:id/comments', requirePublishKey, async function (req, res) {
  try {
    var list = await relay.fetchPostComments(req.params.id, req.query.limit);
    res.json({ code: 200, message: 'ok', data: list });
  } catch (e) {
    console.error('[astrbot-relay] 读取帖子评论失败:', e.message);
    res.status(502).json({ code: 502, message: e.message || '读取帖子评论失败' });
  }
});

router.get('/info/resources', requirePublishKey, function (req, res) {
  var data = info.listResources(req.query.path, req.query.limit);
  if (data && data.error) {
    return res.status(400).json({ code: 400, message: data.error });
  }
  res.json({ code: 200, message: 'ok', data: data });
});

router.get('/info/weather', requirePublishKey, async function (req, res) {
  try {
    var snap = await info.getWeatherSnapshot();
    res.json({ code: 200, message: 'ok', data: snap });
  } catch (e) {
    res.status(502).json({ code: 502, message: e.message || '获取天气失败' });
  }
});

// 一眼看 CI：公告 + 快讯 + 热帖 + 最新帖 + 天气（任一源失败不拖垮整体）
router.get('/info/pulse', requirePublishKey, async function (req, res) {
  var safe = function (p) { return p.then(function (v) { return v; }, function () { return null; }); };
  var results = await Promise.all([
    safe(Promise.resolve(info.listAnnouncements(5))),
    safe(Promise.resolve(info.listBroadcasts(8))),
    safe(relay.fetchCommunityPosts({ sort: 'hot', limit: 5 })),
    safe(relay.fetchCommunityPosts({ sort: 'latest', limit: 5 })),
    safe(info.getWeatherSnapshot()),
    safe(Promise.resolve(info.listResources('', 12)))
  ]);
  res.json({
    code: 200,
    message: 'ok',
    data: {
      generated_at: new Date().toISOString(),
      announcements: results[0] || [],
      broadcasts: results[1] || [],
      hot_posts: (results[2] && results[2].posts) || [],
      latest_posts: (results[3] && results[3].posts) || [],
      weather: results[4] || null,
      resources_root: (results[5] && results[5].entries) || []
    }
  });
});

// 以林晞身份回帖（写）
router.post('/post/:id/comment', requirePublishKey, async function (req, res) {
  var content = String((req.body && req.body.content) || '').trim();
  if (!content) {
    return res.status(400).json({ code: 400, message: '回帖内容不能为空' });
  }
  if (content.length > 2000) {
    return res.status(400).json({ code: 400, message: '回帖内容过长（上限 2000 字）' });
  }
  try {
    var comment = await relay.commentForumPost(req.params.id, content);
    res.json({ code: 200, message: 'ok', data: comment });
  } catch (e) {
    var status = (e && e.response && e.response.status) || 500;
    var msg = (e && e.response && e.response.data && e.response.data.message) || e.message || '回帖失败';
    console.error('[astrbot-relay] 回帖失败:', msg);
    res.status(status >= 400 && status < 600 ? status : 500).json({ code: status, message: msg });
  }
});

// ===== 管理动作代理（仅管理员本人授权；破坏性动作需 confirmed 标记）=====
//
// 模型只能传 op 名 + 参数，URL/方法由 manage.js 的 op 表决定 —— op 表即白名单，
// 不存在路径注入。每次执行都会写 admin_logs（action 以「林晞代理:」开头）。

router.get('/manage/ops', requirePublishKey, function (req, res) {
  res.json({ code: 200, message: 'ok', data: manage.catalog() });
});

router.post('/manage', requirePublishKey, async function (req, res) {
  var body = req.body || {};
  var requester = String(body.requester_id || '').trim();
  var op = String(body.op || '').trim();
  var params = (body.params && typeof body.params === 'object') ? body.params : {};
  var confirmed = body.confirmed === true || body.confirmed === 1 || body.confirmed === '1';
  if (!op) {
    return res.status(400).json({ code: 400, message: '缺少 op' });
  }
  try {
    var result = await manage.run(requester, op, params, confirmed);
    res.json({ code: 200, message: 'ok', data: result });
  } catch (e) {
    var st = e.httpStatus || 0;
    if (!st) {
      // 参数不合法 / 无权限 / 未确认 → 4xx，让 AstrBot 能把原因讲给用户
      st = /无权限|只有管理员/.test(e.message) ? 403 : 400;
    }
    console.error('[astrbot-relay] 管理动作失败:', op, requester, e.message);
    res.status(st).json({ code: st, message: e.message });
  }
});

module.exports = router;
