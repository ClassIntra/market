// 网易云音乐插件 - 存储层
// 基于 ClassIntra 主数据库（better-sqlite3）管理：
//   1. netease_accounts  每个系统用户的网易云登录态（cookie / profile）
//   2. netease_cache     接口响应缓存（TTL + 离线 stale 回退，内网弱网可用性核心）
//   3. netease_config    插件配置（引擎模式 / 上游地址 / 代理 / 音质 / 缓存开关等）
//   4. netease_likes     本地收藏镜像（离线也能查看收藏列表）
// 注意：不新建数据库文件，全部建表在主库 classintra.db 中，便于统一备份。

var db = require('../../../server/src/utils/db');
var config = require('../../../server/src/config');
var path = require('path');
var fs = require('fs');

// ---------- 建表（幂等） ----------

function ensureTables() {
  db.prepare(`
    CREATE TABLE IF NOT EXISTS netease_accounts (
      user_id    TEXT PRIMARY KEY,
      cookie     TEXT NOT NULL DEFAULT '',
      csrf       TEXT NOT NULL DEFAULT '',
      profile    TEXT NOT NULL DEFAULT '{}',
      updated_at INTEGER NOT NULL DEFAULT 0
    )
  `).run();

  db.prepare(`
    CREATE TABLE IF NOT EXISTS netease_cache (
      cache_key  TEXT PRIMARY KEY,
      payload    TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `).run();
  db.prepare('CREATE INDEX IF NOT EXISTS idx_netease_cache_exp ON netease_cache(expires_at)').run();

  db.prepare(`
    CREATE TABLE IF NOT EXISTS netease_config (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL DEFAULT ''
    )
  `).run();

  db.prepare(`
    CREATE TABLE IF NOT EXISTS netease_likes (
      user_id  TEXT NOT NULL,
      song_id  TEXT NOT NULL,
      song_json TEXT NOT NULL DEFAULT '{}',
      liked_at INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (user_id, song_id)
    )
  `).run();
}
ensureTables();

// ---------- 配置 ----------

// 配置默认值（可通过管理端 /admin/config 修改）
var CONFIG_DEFAULTS = {
  engine: 'auto',          // builtin：本机直连网易云；upstream：转发到上游 NCM API 服务；auto：builtin 失败回退 upstream
  upstreamUrl: '',         // upstream 模式的上游地址，如 http://127.0.0.1:3000（api-enhanced / NeteaseCloudMusicApi）
  upstreamStyle: 'enhanced', // upstream 路由风格：enhanced=api-enhanced 模块名（song_url_v1）；ncm=Binaryify 原版斜杠路由（song/url）
  proxy: '',               // 可选出站代理（HTTP/HTTPS），供服务器侧访问网易云
  quality: 'standard',     // 音质：standard/higher/exhigh/lossless/hires
  cacheEnabled: '1',       // 接口响应缓存开关
  audioCache: '1',         // 音频磁盘缓存开关
  cacheDir: path.join(path.dirname(config.dbPath), 'netease-cache'),
  audioCacheMaxMB: '512',  // 音频缓存总上限（MB），超出按最久未使用清理
  requestTimeout: '8000',  // 上游请求超时（毫秒）
  debug: '0'               // 调试日志开关：'1' 时输出风控触发/引擎回退/缓存命中等详细日志
};

// 读取全部配置（默认值 + 库内覆盖，值统一为字符串）
function getConfig() {
  var result = {};
  Object.keys(CONFIG_DEFAULTS).forEach(function (k) {
    result[k] = CONFIG_DEFAULTS[k];
  });
  var rows = db.prepare('SELECT key, value FROM netease_config').all();
  rows.forEach(function (r) {
    if (r.key in result) result[r.key] = r.value;
  });
  return result;
}

// 写入配置（仅允许覆盖默认键）
function setConfig(patch) {
  var keys = Object.keys(CONFIG_DEFAULTS);
  var stmt = db.prepare('INSERT INTO netease_config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
  var applied = {};
  keys.forEach(function (k) {
    if (patch[k] !== undefined) {
      stmt.run(k, String(patch[k]));
      applied[k] = String(patch[k]);
    }
  });
  return applied;
}

// ---------- 用户登录态 ----------

// 获取某系统用户的网易云登录态
function getAccount(userId) {
  var row = db.prepare('SELECT * FROM netease_accounts WHERE user_id = ?').get(String(userId));
  if (!row) return null;
  var profile = {};
  try { profile = JSON.parse(row.profile || '{}'); } catch (e) { profile = {}; }
  return { userId: row.user_id, cookie: row.cookie, csrf: row.csrf, profile: profile, updatedAt: row.updated_at };
}

// 保存登录态（cookie 为字符串或对象均可，统一转字符串存储）
function setAccount(userId, cookie, profile) {
  var cookieStr = typeof cookie === 'string' ? cookie : JSON.stringify(cookie || {});
  db.prepare(`
    INSERT INTO netease_accounts (user_id, cookie, csrf, profile, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET cookie = excluded.cookie, csrf = excluded.csrf, profile = excluded.profile, updated_at = excluded.updated_at
  `).run(String(userId), cookieStr, (profile && profile.csrf) || '', JSON.stringify(profile || {}), Date.now());
}

// 清除登录态（登出）
function clearAccount(userId) {
  db.prepare('DELETE FROM netease_accounts WHERE user_id = ?').run(String(userId));
}

// ---------- 响应缓存 ----------

// 读取缓存：fresh 命中返回 { fresh: true, payload }；
// 过期但存在返回 { fresh: false, payload }（供离线 stale 回退）；无则 null
function cacheGet(key) {
  var row = db.prepare('SELECT payload, expires_at FROM netease_cache WHERE cache_key = ?').get(key);
  if (!row) return null;
  var payload = null;
  try { payload = JSON.parse(row.payload); } catch (e) { return null; }
  return { fresh: row.expires_at > Date.now(), payload: payload };
}

// 写入缓存（ttl 毫秒）
function cacheSet(key, payload, ttl) {
  var now = Date.now();
  db.prepare(`
    INSERT INTO netease_cache (cache_key, payload, expires_at, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(cache_key) DO UPDATE SET payload = excluded.payload, expires_at = excluded.expires_at, updated_at = excluded.updated_at
  `).run(key, JSON.stringify(payload), now + ttl, now);
}

// 写入缓存（带健康校验：负数 code 的响应——如 -462 风控——不落缓存，
// 防止风控空结果在整个 TTL 周期内毒害命中结果；返回是否真正写入）
// 票据等非响应体数据（无 code 字段）不受影响，正常写入。
function cacheSetIfOk(key, payload, ttl) {
  if (payload && typeof payload === 'object' && typeof payload.code === 'number' && payload.code < 200) return false;
  cacheSet(key, payload, ttl);
  return true;
}

// 清理过期缓存（供定期调用 / 概率触发）
function cacheCleanup() {
  try {
    db.prepare('DELETE FROM netease_cache WHERE expires_at < ?').run(Date.now() - 7 * 24 * 3600 * 1000);
  } catch (e) { /* 忽略清理失败 */ }
}

// ---------- 本地收藏镜像 ----------

// 覆盖式同步某用户的收藏 ID 列表（来自网易云 likelist）
function syncLikes(userId, songIds) {
  var now = Date.now();
  var tx = db.transaction(function () {
    db.prepare('DELETE FROM netease_likes WHERE user_id = ?').run(String(userId));
    var ins = db.prepare('INSERT OR IGNORE INTO netease_likes (user_id, song_id, liked_at) VALUES (?, ?, ?)');
    songIds.forEach(function (id) { ins.run(String(userId), String(id), now); });
  });
  tx();
}

// 更新单首歌的镜像元数据（便于离线展示歌名/歌手/封面）
function upsertLikeMeta(userId, songId, songJson) {
  db.prepare(`
    INSERT INTO netease_likes (user_id, song_id, song_json, liked_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(user_id, song_id) DO UPDATE SET song_json = excluded.song_json
  `).run(String(userId), String(songId), JSON.stringify(songJson || {}), Date.now());
}

// 本地收藏列表（含已缓存的元数据）
function getLocalLikes(userId) {
  return db.prepare('SELECT song_id, song_json, liked_at FROM netease_likes WHERE user_id = ? ORDER BY liked_at DESC').all(String(userId))
    .map(function (r) {
      var meta = {};
      try { meta = JSON.parse(r.song_json || '{}'); } catch (e) { meta = {}; }
      return { id: r.song_id, meta: meta, likedAt: r.liked_at };
    });
}

// 判断某首歌是否在本地收藏镜像中
function hasLocalLike(userId, songId) {
  return !!db.prepare('SELECT 1 FROM netease_likes WHERE user_id = ? AND song_id = ?').get(String(userId), String(songId));
}

// 删除本地收藏镜像
function removeLocalLike(userId, songId) {
  db.prepare('DELETE FROM netease_likes WHERE user_id = ? AND song_id = ?').run(String(userId), String(songId));
}

// ---------- 音频缓存目录 ----------

function ensureCacheDir() {
  var dir = getConfig().cacheDir;
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

module.exports = {
  getConfig: getConfig,
  setConfig: setConfig,
  getAccount: getAccount,
  setAccount: setAccount,
  clearAccount: clearAccount,
  cacheGet: cacheGet,
  cacheSet: cacheSet,
  cacheSetIfOk: cacheSetIfOk,
  cacheCleanup: cacheCleanup,
  syncLikes: syncLikes,
  upsertLikeMeta: upsertLikeMeta,
  getLocalLikes: getLocalLikes,
  hasLocalLike: hasLocalLike,
  removeLocalLike: removeLocalLike,
  ensureCacheDir: ensureCacheDir
};
