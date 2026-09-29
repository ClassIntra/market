// AstrBot Relay - 站内信息共享（只读取数）
//
// 目的：让林晞（AstrBot）以「ClassIntra 的一等居民」身份读取站内公开信息，
//   而不是靠猜。读的是 CI 自己的库 / 配置 / 服务，零侵入 CI 应用代码。
//
// 本模块负责不涉及用户身份可见性的数据源（公告 / 快讯 / 资源仓库 / 天气）；
// 社区帖子与回帖涉及「按性别分组的可见性」与写权限，走 relay.js 里的
//   fetchCommunityPosts / fetchPostComments / commentForumPost（带林晞 JWT 调 CI 自身路由，
//   保证看到的、能做的与一个真实普通用户完全一致）。

var fs = require('fs');
var path = require('path');
var db = require('../../../server/src/utils/db');
var config = require('../../../server/src/config');
var time = require('../../../server/src/utils/time');
var cache = require('../../../server/src/utils/cache');
var weatherService = require('../../../server/src/services/weather');

var RESOURCES_DIR = config.resourcesDir;

// 列表类接口的通用参数钳制
function clampInt(v, min, max, dflt) {
  var n = parseInt(v, 10);
  if (isNaN(n)) return dflt;
  if (n < min) return min;
  if (n > max) return max;
  return n;
}

// 单条正文截断，避免一次性把超长内容塞进模型上下文
function clip(text, max) {
  var s = String(text == null ? '' : text);
  if (s.length <= max) return s;
  return s.slice(0, max) + '…（已截断）';
}

var RESOURCE_HIDDEN = ['public', 'cloud']; // 与 apps/resource 非管理员视角一致

function formatSize(bytes) {
  var n = Number(bytes) || 0;
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
  if (n < 1024 * 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + ' MB';
  return (n / 1024 / 1024 / 1024).toFixed(2) + ' GB';
}

// ===== 公告（待办式：看过即消；这里只做读取）=====
function listAnnouncements(limit) {
  limit = clampInt(limit, 1, 50, 10);
  var rows = db.prepare(
    'SELECT id, title, content, type, author_name, pinned, created_at FROM announcements ' +
    'ORDER BY pinned DESC, created_at DESC LIMIT ?'
  ).all(limit);
  return rows.map(function (r) {
    return {
      id: r.id,
      title: r.title || '',
      content: clip(r.content, 800),
      type: r.type || 'notice',
      author: r.author_name || '',
      pinned: !!r.pinned,
      created_at: time.toISOString(r.created_at)
    };
  });
}

// ===== 快讯（播报式：只决定要不要吭声）=====
function listBroadcasts(limit) {
  limit = clampInt(limit, 1, 50, 10);
  var rows = db.prepare(
    'SELECT id, content, priority, created_at FROM broadcasts ORDER BY created_at DESC LIMIT ?'
  ).all(limit);
  return rows.map(function (r) {
    return {
      id: r.id,
      content: clip(r.content, 500),
      priority: r.priority || 'normal',
      created_at: time.toISOString(r.created_at)
    };
  });
}

// ===== 资源仓库：列目录（与 apps/resource 同口径，排除 public/cloud 与点文件）=====
function listResources(dirPath, limit) {
  limit = clampInt(limit, 1, 200, 60);
  var rel = String(dirPath || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  if (rel.indexOf('..') !== -1) {
    return { error: '路径不合法' };
  }
  var full = path.resolve(RESOURCES_DIR, rel);
  var root = path.resolve(RESOURCES_DIR);
  if (full !== root && full.indexOf(root + path.sep) !== 0) {
    return { error: '路径不合法' };
  }

  var names;
  try {
    names = fs.readdirSync(full);
  } catch (e) {
    return { error: '目录不存在' };
  }

  var entries = [];
  for (var i = 0; i < names.length; i++) {
    var name = names[i];
    if (name.charAt(0) === '.') continue;
    if (RESOURCE_HIDDEN.indexOf(name) !== -1) continue;
    var stat;
    try {
      stat = fs.statSync(path.join(full, name));
    } catch (e) {
      continue;
    }
    entries.push({
      name: name,
      is_dir: stat.isDirectory(),
      size: stat.isDirectory() ? null : stat.size,
      size_text: stat.isDirectory() ? '--' : formatSize(stat.size),
      modified: stat.mtime.toISOString()
    });
  }
  entries.sort(function (a, b) {
    if (a.is_dir !== b.is_dir) return a.is_dir ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return {
    path: rel || '/',
    count: entries.length,
    truncated: entries.length > limit,
    entries: entries.slice(0, limit)
  };
}

// ===== 天气：复用 CI 的缓存键，与天气应用共享同一份上游结果 =====
function cachedFetch(key, ttl, fn) {
  var hit = cache.get(key);
  if (hit) return Promise.resolve(hit);
  return Promise.resolve()
    .then(fn)
    .then(function (data) {
      if (data) cache.set(key, data, ttl);
      return data;
    })
    .catch(function () { return null; });
}

function getWeatherSnapshot() {
  return Promise.all([
    cachedFetch('weather_current_default', 15 * 60 * 1000, function () { return weatherService.getCurrentWeather(); }),
    cachedFetch('weather_daily_default', 60 * 60 * 1000, function () { return weatherService.getDailyForecast(); }),
    cachedFetch('weather_air_default', 30 * 60 * 1000, function () { return weatherService.getAirQuality(); }),
    cachedFetch('weather_warning_default', 10 * 60 * 1000, function () { return weatherService.getWeatherAlert(); }),
    cachedFetch('weather_indices_default', 6 * 60 * 60 * 1000, function () { return weatherService.getIndices(); })
  ]).then(function (r) {
    var current = r[0], daily = r[1], air = r[2], alert = r[3], indices = r[4];
    var airIndex = null;
    if (air && air.indexes && air.indexes.length) {
      var a = air.indexes[0];
      airIndex = { name: a.name || a.code || '空气质量', aqi: a.aqi, category: a.category || '', primary: a.primaryPollutant || '' };
    }
    return {
      location: config.qweather.location || '',
      current: (current && current.now) || null,
      today: (daily && daily.daily && daily.daily[0]) || null,
      air: airIndex,
      alerts: (alert && alert.warning)
        ? alert.warning.slice(0, 5).map(function (w) {
            return { type: w.typeName || w.type || '天气预警', title: w.title || '', severity: w.severity || '', text: clip(w.text, 300) };
          })
        : [],
      indices: (indices && indices.daily)
        ? indices.daily.slice(0, 8).map(function (d) {
            return { name: d.name || '', category: d.category || '', text: clip(d.text, 200) };
          })
        : []
    };
  });
}

module.exports = {
  listAnnouncements: listAnnouncements,
  listBroadcasts: listBroadcasts,
  listResources: listResources,
  getWeatherSnapshot: getWeatherSnapshot,
  RESOURCES_DIR: RESOURCES_DIR
};
