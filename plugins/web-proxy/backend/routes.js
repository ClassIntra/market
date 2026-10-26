// backend/routes.js
// 网页代理插件的后端路由。
//
// 说明：
//   - 插件被 require 时会自动启动代理服务器（随 ClassIntra 一起跑）
//   - 代理服务器监听独立端口（默认 9101，第三方应用段），对外提供 /<scheme>/<host>/<path> 形态的转发
//   - 本路由只负责状态查询与手动控制
//
// 代码风格遵循 ClassIntra 约定：var / function / 单引号 / 2 空格缩进。

var express = require('express');
var router = express.Router();
var auth = require('../../../server/src/middleware/auth');
var os = require('os');

var proxy = require('./proxy-server');
var access = require('./access');

// 插件加载即启动代理（可通过环境变量 WEB_PROXY_AUTOSTART=0 关闭）
var startError = null;

function ensureStarted() {
  if (proxy.status().running) return;
  proxy.start({}, function (err) {
    if (err) {
      startError = err.message;
      console.log('[web-proxy] 启动失败: ' + startError);
    }
  });
}

if (String(process.env.WEB_PROXY_AUTOSTART || '1') !== '0') {
  ensureStarted();
}

// 代理状态（公开，供前端与内嵌页面探测端口）
router.get('/status', function (req, res) {
  var s = proxy.status();
  var render = proxy.renderStatus ? proxy.renderStatus() : { available: false };
  res.json({
    code: 200,
    data: {
      running: s.running,
      port: s.port,
      requests: s.requests,
      errors: s.errors,
      lastError: s.lastError || startError || '',
      // 兼容模式（服务器端无头浏览器渲染）能力：前端据此决定是否展示入口
      render: {
        available: !!render.available,
        browser: render.browser || '',
        sessions: render.sessions || 0,
        maxSessions: render.maxSessions || 0,
        lastError: render.lastError || render.reason || ''
      },
      urlPattern: 'http://<host>:' + (s.port || proxy.DEFAULT_PORT) + '/<scheme>/<host>/<path>'
    }
  });
});

// 代理配置（公开，等价于 status 的轻量版本）
router.get('/config', function (req, res) {
  var s = proxy.status();
  res.json({
    enabled: s.running,
    port: s.port || proxy.DEFAULT_PORT,
    scheme: 'http',
    mode: 'reverse',
    autoStart: String(process.env.WEB_PROXY_AUTOSTART || '1') !== '0'
  });
});

// 把真实 URL 转成代理 URL（公开，仅做纯字符串转换，不发起请求）
// GET /api/web-proxy/resolve?url=https://example.com/a/b
router.get('/resolve', function (req, res) {
  var raw = req.query.url || '';
  if (!raw) {
    return res.status(400).json({ code: 400, message: '缺少 url 参数' });
  }
  var host = req.headers.host || (os.hostname() || '127.0.0.1') + ':' + (proxy.status().port || proxy.DEFAULT_PORT);
  var proxyBase = 'http://' + host;
  var absolute;
  try {
    absolute = /^https?:\/\//i.test(raw) ? raw : 'https://' + raw;
    var parsed = new (require('url').URL)(absolute);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return res.status(400).json({ code: 400, message: '仅支持 http/https 地址' });
    }
    var scheme = parsed.protocol === 'https:' ? 'https' : 'http';
    var out = proxyBase + '/' + scheme + '/' + parsed.host + (parsed.pathname || '/');
    if (parsed.search) out += parsed.search;
    res.json({ code: 200, data: { url: out, proxyBase: proxyBase } });
  } catch (e) {
    res.status(400).json({ code: 400, message: 'URL 解析失败: ' + e.message });
  }
});

// 手动启动
router.post('/start', auth.requireAuth, auth.requireAdmin, function (req, res) {
  if (proxy.status().running) {
    return res.json({ code: 200, data: proxy.status(), message: '已在运行' });
  }
  proxy.start({}, function (err) {
    if (err) {
      return res.status(500).json({ code: 500, message: '启动失败: ' + err.message });
    }
    res.json({ code: 200, data: proxy.status() });
  });
});

// 手动停止
router.post('/stop', auth.requireAuth, auth.requireAdmin, function (req, res) {
  proxy.stop(function (err) {
    if (err) {
      return res.status(500).json({ code: 500, message: '停止失败: ' + err.message });
    }
    res.json({ code: 200, data: proxy.status() });
  });
});

// ---- 兼容模式使用管理（仅班管 / 管理员）----

// 当前兼容模式会话列表：谁在用哪个站点、用了多久、声音是否打开
router.get('/sessions', auth.requireAuth, auth.requireAdmin, function (req, res) {
  var s = proxy.status();
  var render = proxy.renderStatus ? proxy.renderStatus() : { available: false };
  res.json({
    code: 200,
    data: {
      running: !!s.running,
      port: s.port || proxy.DEFAULT_PORT,
      available: !!render.available,
      browser: render.browser || '',
      maxSessions: render.maxSessions || 0,
      lastError: render.lastError || render.reason || '',
      // 可使用者设置：管理浮窗打开时一并返回，省去一次额外请求
      access: access.getAccess(),
      sessions: proxy.listRenderSessions ? proxy.listRenderSessions() : []
    }
  });
});

// 谁可以使用兼容模式（班管 / 管理员可读写）
router.get('/access', auth.requireAuth, auth.requireAdmin, function (req, res) {
  res.json({ code: 200, data: access.getAccess() });
});

router.post('/access', auth.requireAuth, auth.requireAdmin, function (req, res) {
  var body = req.body || {};
  if (body.mode !== 'all' && body.mode !== 'allowlist') {
    return res.status(400).json({ code: 400, message: 'mode 只能是 all 或 allowlist' });
  }
  if (body.mode === 'allowlist' && Array.isArray(body.users) && body.users.length > access.MAX_USERS) {
    return res.status(400).json({ code: 400, message: '最多只能指定 ' + access.MAX_USERS + ' 位成员' });
  }
  try {
    var saved = access.setAccess({ mode: body.mode, users: body.users || [] });
    res.json({ code: 200, data: saved });
  } catch (e) {
    res.status(500).json({ code: 500, message: '保存失败: ' + e.message });
  }
});

// 搜索可指定的成员：只读 users 表的公开字段，不依赖 manage_users 权限
router.get('/users', auth.requireAuth, auth.requireAdmin, function (req, res) {
  var q = String(req.query.q || '').trim().substring(0, 40);
  var db = require('../../../server/src/utils/db');
  var rows;
  try {
    if (q) {
      var like = '%' + q + '%';
      rows = db.prepare(
        'SELECT user_id, net_name, real_name FROM users '
        + 'WHERE user_id LIKE ? OR net_name LIKE ? OR real_name LIKE ? '
        + 'ORDER BY user_id LIMIT 20'
      ).all(like, like, like);
    } else {
      rows = db.prepare('SELECT user_id, net_name, real_name FROM users ORDER BY user_id LIMIT 20').all();
    }
  } catch (e) {
    return res.status(500).json({ code: 500, message: '查询成员失败: ' + e.message });
  }
  res.json({
    code: 200,
    data: {
      users: (rows || []).map(function (r) {
        return {
          id: r.user_id,
          name: r.net_name || r.real_name || r.user_id,
          realName: r.real_name || ''
        };
      })
    }
  });
});

// 断开全部会话
router.post('/sessions/close-all', auth.requireAuth, auth.requireAdmin, function (req, res) {
  var count = proxy.closeAllRenderSessions ? proxy.closeAllRenderSessions() : 0;
  res.json({ code: 200, data: { closed: count } });
});

// 断开单个会话
router.post('/sessions/:id/close', auth.requireAuth, auth.requireAdmin, function (req, res) {
  var ok = proxy.closeRenderSession ? proxy.closeRenderSession(req.params.id) : false;
  if (!ok) {
    return res.status(404).json({ code: 404, message: '会话不存在或已结束' });
  }
  res.json({ code: 200, data: { closed: 1 } });
});

module.exports = router;
