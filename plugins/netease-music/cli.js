#!/usr/bin/env node
// 网易云音乐插件 - 本地诊断 CLI
// 免启动服务器、免 JWT_SECRET，直接在命令行诊断插件全链路（网关/风控/缓存/配置）。
// 所有请求按匿名上下文执行（不冒用任何系统用户的网易云登录态），只操作本地 SQLite 与网易云公开接口。
//
// 用法：
//   node plugins/netease-music/cli.js diag all                        全端点健康巡检（观察风控状态）
//   node plugins/netease-music/cli.js diag search '{"keywords":"周杰伦","limit":3}'
//   node plugins/netease-music/cli.js diag songUrl '{"id":"347230"}'  支持 --fresh 跳过缓存
//   node plugins/netease-music/cli.js status                          插件配置 + 引擎模式摘要
//   node plugins/netease-music/cli.js config                          查看全部配置
//   node plugins/netease-music/cli.js config debug=1                  修改配置（可多项，空格分隔）
//   node plugins/netease-music/cli.js cache list [N]                  最近缓存前 N 条（默认 20）
//   node plugins/netease-music/cli.js cache get <key>                 查看某条缓存
//   node plugins/netease-music/cli.js cache clear                     清空响应缓存（含历史脏缓存）
//   node plugins/netease-music/cli.js help

// 免 JWT_SECRET：JWT_SECRET 仅在签发/校验系统登录 token 时使用，CLI 不签 token；
// 未设置时注入本地诊断值，避免 store → server config 依赖链抛错，也不影响真实服务器。
if (!process.env.JWT_SECRET) process.env.JWT_SECRET = 'cli-local-diag';

var store = require('./backend/store');
var gatewayMod = require('./backend/gateway');
var gateway = gatewayMod.createGateway();

// 巡检端点集：覆盖高频簇（搜索/联想/详情/播放/歌词/推荐），便于一次观察全部风控簇状态
var DIAG_ENDPOINTS = [
  { name: 'search', args: { keywords: '周杰伦', type: 1, limit: 3 } },
  { name: 'suggest', args: { keywords: '周杰伦' } },
  { name: 'songDetail', args: { ids: '347230' } },
  { name: 'songUrl', args: { id: '347230' } },
  { name: 'lyric', args: { id: '347230' } },
  { name: 'personalized', args: { limit: 3 } },
  { name: 'toplist', args: {} }
];

function printJson(obj) {
  console.log(JSON.stringify(obj, null, 2));
}

// 摘要一段响应体，避免整包打印淹没终端
function summarize(name, body) {
  if (!body || typeof body !== 'object') return String(body).slice(0, 80);
  if (name === 'search' && body.result) {
    return body.result.songs ? body.result.songs.length + ' 首单曲' : JSON.stringify(body.result).slice(0, 80);
  }
  if (name === 'songUrl' && Array.isArray(body.data)) {
    return body.data[0] && body.data[0].url ? 'url ok（' + (body.data[0].level || '?') + '）' : '无 url';
  }
  if (name === 'lyric') {
    return body.lrc && body.lrc.lyric ? 'lrc ' + body.lrc.lyric.length + ' 字符' + (body.yrc ? ' + yrc' : '') : '无歌词';
  }
  if (name === 'suggest') return body.result ? 'ok' : '空';
  return 'code=' + body.code;
}

// 诊断单个端点（走 gateway 全链路：节流/冷却/级联/缓存，真实反映运行时行为）
async function diagOne(name, args, fresh) {
  var t0 = Date.now();
  var pad = function (s) { s = String(s); while (s.length < 12) s += ' '; return s; };
  try {
    var r = await gateway.call(name, args, null, { noCache: !!fresh });
    var dt = Date.now() - t0;
    console.log('[OK]   ' + pad(name) + dt + 'ms  via=' + (r.via || '-') + (r.cached ? '（缓存命中）' : '') + '  ' + summarize(name, r.data));
    return true;
  } catch (err) {
    var dt2 = Date.now() - t0;
    console.log('[FAIL] ' + pad(name) + dt2 + 'ms  code=' + (err.code || '-') + '  ' + err.message);
    return false;
  }
}

async function cmdDiag(args) {
  var fresh = args.indexOf('--fresh') !== -1;
  args = args.filter(function (a) { return a !== '--fresh'; });
  if (!args.length || args[0] === 'all') {
    console.log('== 全端点巡检（匿名上下文' + (fresh ? '，跳过缓存' : '') + '）==');
    var pass = 0;
    for (var i = 0; i < DIAG_ENDPOINTS.length; i++) {
      var ep = DIAG_ENDPOINTS[i];
      if (await diagOne(ep.name, ep.args, fresh)) pass++;
    }
    console.log('== 结果：' + pass + '/' + DIAG_ENDPOINTS.length + ' 通过 ==');
    if (pass < DIAG_ENDPOINTS.length) {
      console.log('提示：FAIL 多为 -462 风控（60s 簇级冷却自动规避）或网络问题；重复执行 diag all 可观察恢复情况。');
    }
    return;
  }
  var name = args[0];
  var parsed = {};
  if (args[1]) {
    try { parsed = JSON.parse(args[1]); } catch (e) {
      console.error('参数必须是 JSON：\'{"keywords":"周杰伦"}\''); process.exit(1);
    }
  }
  await diagOne(name, parsed, fresh);
}

function cmdStatus() {
  var cfg = store.getConfig();
  console.log('== 插件配置摘要 ==');
  printJson({
    engine: cfg.engine,
    quality: cfg.quality,
    proxy: cfg.proxy || '（无）',
    upstreamUrl: cfg.upstreamUrl || '（未配置）',
    cacheEnabled: cfg.cacheEnabled,
    audioCache: cfg.audioCache,
    requestTimeout: cfg.requestTimeout + 'ms',
    debug: cfg.debug
  });
}

function cmdConfig(args) {
  if (!args.length) {
    printJson(store.getConfig());
    return;
  }
  var patch = {};
  args.forEach(function (kv) {
    var idx = kv.indexOf('=');
    if (idx < 1) { console.error('格式应为 key=value：' + kv); process.exit(1); }
    patch[kv.slice(0, idx)] = kv.slice(idx + 1);
  });
  var applied = store.setConfig(patch);
  console.log('已应用：');
  printJson(applied);
}

// 缓存命令直接使用主库连接（与 store 同一 db 模块），不为 CLI 增加生产 API
function cmdCache(args) {
  var sub = args[0] || 'list';
  var db = require('../../server/src/utils/db');
  if (sub === 'list') {
    var n = parseInt(args[1], 10) || 20;
    var total = db.prepare('SELECT COUNT(*) AS c FROM netease_cache').get().c;
    var dirty = db.prepare("SELECT COUNT(*) AS c FROM netease_cache WHERE payload LIKE '%\"code\":-%'").get().c;
    console.log('缓存总数：' + total + '（其中负数 code 可疑条目：' + dirty + '）');
    var rows = db.prepare('SELECT cache_key, expires_at, updated_at FROM netease_cache ORDER BY updated_at DESC LIMIT ?').all(n);
    rows.forEach(function (r) {
      var fresh = r.expires_at > Date.now();
      console.log((fresh ? '[新鲜] ' : '[过期] ') + r.cache_key.slice(0, 90));
    });
  } else if (sub === 'get') {
    if (!args[1]) { console.error('用法：cache get <key>'); process.exit(1); }
    var row = db.prepare('SELECT payload, expires_at FROM netease_cache WHERE cache_key = ?').get(args[1]);
    if (!row) { console.log('（无此缓存）'); return; }
    console.log('expires_at: ' + new Date(row.expires_at).toLocaleString() + (row.expires_at > Date.now() ? '（新鲜）' : '（已过期）'));
    try { printJson(JSON.parse(row.payload)); } catch (e) { console.log(row.payload); }
  } else if (sub === 'clear') {
    var info = db.prepare('DELETE FROM netease_cache WHERE cache_key NOT LIKE \'streamticket:%\'').run();
    console.log('已清空响应缓存 ' + info.changes + ' 条（票据不受影响）。重启服务器无需执行——缓存在运行时直读直写。');
  } else {
    console.error('未知子命令：' + sub);
    process.exit(1);
  }
}

function cmdHelp() {
  console.log(
    '网易云音乐插件诊断 CLI\n' +
    '  node plugins/netease-music/cli.js diag all                          全端点健康巡检\n' +
    '  node plugins/netease-music/cli.js diag <endpoint> \'{"k":"v"}\' [--fresh]\n' +
    '  node plugins/netease-music/cli.js status                            配置 + 引擎模式摘要\n' +
    '  node plugins/netease-music/cli.js config [key=value ...]            查看/修改配置\n' +
    '  node plugins/netease-music/cli.js cache list|get <key>|clear        缓存管理\n'
  );
}

var cmd = process.argv[2];
var rest = process.argv.slice(3);
var commands = {
  diag: function () { cmdDiag(rest); },
  status: cmdStatus,
  config: function () { cmdConfig(rest); },
  cache: function () { cmdCache(rest); },
  help: cmdHelp
};

if (!cmd || !commands[cmd]) {
  if (cmd) console.error('未知命令：' + cmd + '\n');
  cmdHelp();
  process.exit(cmd ? 1 : 0);
}
commands[cmd]();
