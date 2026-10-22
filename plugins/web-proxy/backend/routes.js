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

module.exports = router;
