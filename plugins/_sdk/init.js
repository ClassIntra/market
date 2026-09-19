#!/usr/bin/env node
// ClassIntra 插件 SDK - 插件脚手架生成器
// 一键生成新插件的目录骨架，开箱即用：
//   node plugins/_sdk/init.js my-plugin --label "我的插件"
// 生成内容：
//   plugins/my-plugin/
//   ├── manifest.json        # type: plugin + backend 挂载声明
//   ├── backend/routes.js    # Express 路由骨架（统一响应/错误处理/鉴权示例）
//   └── README.md            # 插件说明模板 + 开发指引
// 生成后按 README 指引开发即可，无需研究宿主加载机制。

var fs = require('fs');
var path = require('path');

var name = process.argv[2];
var label = '';
var labelIdx = process.argv.indexOf('--label');
if (labelIdx !== -1 && process.argv[labelIdx + 1]) label = process.argv[labelIdx + 1];

if (!name || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name)) {
  console.error('用法：node plugins/_sdk/init.js <plugin-name> [--label "显示名"]');
  console.error('plugin-name 必须是 kebab-case（小写字母/数字/连字符），如 netease-music');
  process.exit(1);
}

var pluginsRoot = path.resolve(__dirname, '..');
var target = path.join(pluginsRoot, name);
if (fs.existsSync(target)) {
  console.error('目录已存在：' + target);
  process.exit(1);
}

fs.mkdirSync(path.join(target, 'backend'), { recursive: true });

// ---------- manifest.json ----------
var manifest = {
  name: name,
  type: 'plugin',
  version: '0.1.0',
  label: label || name,
  category: 'general',
  order: 100,
  defaultEnabled: true,
  canDisable: true,
  description: 'TODO：一句话描述插件功能',
  backend: {
    mountPath: '/api/' + name,
    entry: './backend/routes.js',
    rateLimit: { max: 300, windowMs: 60000 }
  }
};
fs.writeFileSync(path.join(target, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');

// ---------- backend/routes.js ----------
var routesTemplate = `// {LABEL} 插件 - 后端路由
// 挂载路径：/api/{NAME}（见 manifest.json）
// 骨架说明：
//   - ok/sendError/wrap 是插件路由的推荐样板（统一响应与错误处理）
//   - 需要登录态的路由加 requireAuth；仅管理员加 requireAdmin
//   - 业务错误统一 throw new PluginError(code, '中文提示')，由 sendError 兜底
//   - 需要媒体中转/取流票据时复用插件 SDK（plugins/_sdk/backend/stream-relay.js）

var express = require('express');
var router = express.Router();
var auth = require('../../../server/src/middleware/auth');
var PluginError = require('../../_sdk/backend/errors').PluginError;

var requireAuth = auth.requireAuth;
var requireAdmin = auth.requireAdmin;

// 统一响应
function ok(res, data) {
  res.json(Object.assign({ code: 200 }, data || {}));
}

// 统一错误处理：PluginError / { code, message } / Error 一律兜底
function sendError(res, err) {
  if (err && typeof err === 'object' && err.code && err.message) {
    return res.status(err.code >= 400 && err.code < 600 ? err.code : 500).json({ code: err.code, message: err.message });
  }
  var message = (err && err.message) || '插件内部错误';
  console.error('[{NAME}]', message);
  res.status(500).json({ code: 500, message: message });
}

// 包装 async 路由处理器（异常自动进入 sendError）
function wrap(handler) {
  return function (req, res) {
    Promise.resolve(handler(req, res)).catch(function (err) { sendError(res, err); });
  };
}

// 健康检查（无需登录态，供诊断与宿主探活）
router.get('/status', function (req, res) {
  ok(res, { plugin: '{NAME}', version: '{VERSION}' });
});

// 示例：需要登录态的路由（req.user 由 requireAuth 注入）
router.get('/me', requireAuth, wrap(async function (req, res) {
  ok(res, { userId: req.user.user_id });
}));

// 示例：业务错误写法
router.get('/demo-error', wrap(async function (req, res) {
  throw new PluginError(400, '示例错误：请替换为真实业务');
}));

module.exports = router;
`;
fs.writeFileSync(
  path.join(target, 'backend', 'routes.js'),
  routesTemplate.replace(/\{LABEL\}/g, label || name).replace(/\{NAME\}/g, name).replace(/\{VERSION\}/g, '0.1.0')
);

// ---------- README.md ----------
var readmeTemplate = `# {LABEL}（{NAME}）

TODO：插件功能说明。

## 开发流程

1. **写业务**：编辑 \`backend/routes.js\`（骨架已含统一响应/错误处理/鉴权样板）
2. **本地诊断**：无需启动服务器，直接
   \`\`\`
   node plugins/{NAME}/cli.js help   # 若参照 netease-music 复制了诊断 CLI
   node --check plugins/{NAME}/backend/routes.js
   \`\`\`
3. **宿主验证**：重启服务器（cd server; node src/app.js），访问 \`/api/{NAME}/status\`
4. **同步双仓**：主仓 .gitignore 忽略 plugins/，改完必须执行
   \`\`\`
   .\\scripts\\sync-market.ps1 -Commit "feat: xxx"
   \`\`\`
5. **版本号**：本插件 manifest.json 的 version 独立语义化递增（功能 MINOR+1 / 修复 PATCH+1）

## 可复用能力（plugins/_sdk/）

| 能力 | 用法 |
|------|------|
| 媒体中转 | \`require('../../_sdk/backend/stream-relay').createRelay({ getConfig, imageHostAllow })\` |
| 取流票据 | \`createTicketKit(store, '前缀:')\`（弥补 <audio>/<img> 无法带 Authorization） |
| HTTP 转发 | \`proxyConnect / fetchRaw / httpGetJson\`（CONNECT 代理隧道 + 302 跟随） |
| 统一错误 | \`require('../../_sdk/backend/errors').PluginError\` |

完整文档见 \`plugins/README.md\`。
`;
fs.writeFileSync(path.join(target, 'README.md'), readmeTemplate.replace(/\{LABEL\}/g, label || name).replace(/\{NAME\}/g, name));

console.log('已生成插件骨架：plugins/' + name + '/');
console.log('  manifest.json        挂载 /api/' + name + '（默认限流 300/60s）');
console.log('  backend/routes.js    路由骨架（含 /status 健康检查）');
console.log('  README.md            开发指引');
console.log('');
console.log('下一步：');
console.log('  1. 编辑 backend/routes.js 写业务');
console.log('  2. node --check plugins/' + name + '/backend/routes.js 语法检查');
console.log('  3. 重启服务器，访问 /api/' + name + '/status 验证挂载');
console.log('  4. .\\scripts\\sync-market.ps1 -Commit "feat: 新增 ' + name + ' 插件骨架"');
