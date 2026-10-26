// backend/browser-data.js
// 浏览器数据（历史 / 收藏 / 首页）按账号存到服务端，供同一账号在多台设备间同步。
//
// 为什么放服务端：此前只存 localStorage，同一账号换台设备（手机 / 平板 / 教室电脑）
// 就看不到自己之前的历史与收藏，等于每个设备各记一份。
//
// 存成 JSON 文件而不是数据库表：与 access.js 同样的理由——插件更新会整体替换
// plugins/web-proxy 目录，配置必须落在 server/database 下（与 SQLite 同目录，随数据备份）。
//
// 多设备写入采用「合并」而不是整包覆盖：历史按 url 去重并保留较新的浏览时间，
// 收藏按 url 去重并保留较早的收藏时间，避免 A 设备上传时把 B 设备的新记录冲掉。
//
// 代码风格遵循 ClassIntra 约定：var / function / 单引号 / 2 空格缩进。

var fs = require('fs');
var path = require('path');

var FILE = path.join(__dirname, '../../../server/database/web-proxy-browser-data.json');
var MAX_HISTORY = 100;
var MAX_BOOKMARKS = 200;
var MAX_URL = 2048;
var MAX_TITLE = 200;
// 单账号数据落盘上限（约 200KB），防止异常输入把 JSON 文件撑大
var MAX_USERS = 500;

var cache = null;

function emptyUser() {
  return { history: [], bookmarks: [], homepage: '', updatedAt: 0 };
}

function load() {
  if (cache) return cache;
  var raw = null;
  try {
    if (fs.existsSync(FILE)) raw = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch (e) {
    console.log('[web-proxy] 读取浏览器数据失败: ' + e.message);
  }
  var data = { users: {} };
  if (raw && typeof raw === 'object' && raw.users && typeof raw.users === 'object') {
    Object.keys(raw.users).forEach(function(key) {
      if (!/^u[0-9a-zA-Z_-]{1,40}$/.test(key)) return;
      data.users[key] = normalizeUser(raw.users[key]);
    });
  }
  cache = data;
  return cache;
}

function save() {
  var dir = path.dirname(FILE);
  try {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  } catch (e) {}
  // 先写临时文件再改名：写入过程中断电也不会留下半截 JSON
  var tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(cache, null, 2), 'utf8');
  fs.renameSync(tmp, FILE);
}

function cleanEntry(raw) {
  if (!raw || typeof raw !== 'object') return null;
  var url = String(raw.url || '').trim().substring(0, MAX_URL);
  if (!url) return null;
  return {
    url: url,
    title: String(raw.title || '').substring(0, MAX_TITLE),
    time: Number(raw.time) || 0
  };
}

// 合并两组条目：按 url 去重。preferNewer=true 取较新的时间（历史），
// false 取较早的时间（收藏，保留最初收藏时间），结果按时间倒序截断。
function mergeList(a, b, preferNewer, limit) {
  var map = {};
  var list = (Array.isArray(a) ? a : []).concat(Array.isArray(b) ? b : []);
  for (var i = 0; i < list.length; i++) {
    var item = cleanEntry(list[i]);
    if (!item) continue;
    var prev = map[item.url];
    if (!prev) {
      map[item.url] = item;
      continue;
    }
    if (preferNewer) {
      if (item.time > prev.time) map[item.url] = item;
    } else if (item.time && (!prev.time || item.time < prev.time)) {
      map[item.url] = item;
    }
  }
  var out = [];
  Object.keys(map).forEach(function(k) { out.push(map[k]); });
  out.sort(function(x, y) { return (y.time || 0) - (x.time || 0); });
  return out.slice(0, limit);
}

function normalizeUser(raw) {
  var out = emptyUser();
  if (!raw || typeof raw !== 'object') return out;
  out.history = mergeList(raw.history, [], true, MAX_HISTORY);
  out.bookmarks = mergeList(raw.bookmarks, [], false, MAX_BOOKMARKS);
  out.homepage = String(raw.homepage || '').substring(0, MAX_URL);
  out.updatedAt = Number(raw.updatedAt) || 0;
  return out;
}

function userKey(uid) {
  var s = String(uid || '').replace(/[^0-9a-zA-Z_-]/g, '').substring(0, 40);
  return s ? 'u' + s : '';
}

function clone(user) {
  return {
    history: user.history.map(function(e) { return { url: e.url, title: e.title, time: e.time }; }),
    bookmarks: user.bookmarks.map(function(e) { return { url: e.url, title: e.title, time: e.time }; }),
    homepage: user.homepage,
    updatedAt: user.updatedAt
  };
}

function getData(uid) {
  var key = userKey(uid);
  if (!key) return emptyUser();
  var data = load();
  return clone(data.users[key] || emptyUser());
}

// 只更新本次显式提交的字段；返回合并后的全量数据。
// 删除操作必须带 replaceHistory / replaceBookmarks：否则并集合并会把已删条目又合回来
// （前端删收藏时提交的是删后的完整列表，语义是「以这份为准」而不是「追加这些」）。
function mergeData(uid, patch) {
  var key = userKey(uid);
  if (!key) throw new Error('缺少用户标识');
  var data = load();
  var user = data.users[key] || emptyUser();
  patch = patch || {};

  if (Array.isArray(patch.history)) {
    user.history = patch.replaceHistory === true
      ? mergeList(patch.history, [], true, MAX_HISTORY)
      : mergeList(user.history, patch.history, true, MAX_HISTORY);
  }
  if (Array.isArray(patch.bookmarks)) {
    user.bookmarks = patch.replaceBookmarks === true
      ? mergeList(patch.bookmarks, [], false, MAX_BOOKMARKS)
      : mergeList(user.bookmarks, patch.bookmarks, false, MAX_BOOKMARKS);
  }
  if (typeof patch.homepage === 'string') {
    user.homepage = patch.homepage.trim().substring(0, MAX_URL);
  }
  user.updatedAt = Date.now();
  data.users[key] = user;

  // 控制账号数量：超出上限时淘汰最久未更新的账号（只清浏览器数据，不影响账号本身）
  var keys = Object.keys(data.users);
  if (keys.length > MAX_USERS) {
    keys.sort(function(a, b) { return (data.users[a].updatedAt || 0) - (data.users[b].updatedAt || 0); });
    for (var i = 0; i < keys.length - MAX_USERS; i++) delete data.users[keys[i]];
  }

  save();
  return clone(user);
}

module.exports = {
  getData: getData,
  mergeData: mergeData
};
