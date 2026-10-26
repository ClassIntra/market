// backend/access.js
// 兼容模式「可使用者」设置：all（全班可用） / allowlist（仅指定成员）。
//
// 存成 JSON 文件而不是数据库表：插件更新时市场会整体替换 plugins/web-proxy 目录，
// 放在插件目录里的配置会被清掉，因此写到 server/database 下（与 SQLite 同目录，随数据备份）。
// 该文件只保存用户 ID 与昵称，不含任何凭据。
//
// 代码风格遵循 ClassIntra 约定：var / function / 单引号 / 2 空格缩进。

var fs = require('fs');
var path = require('path');

var FILE = path.join(__dirname, '../../../server/database/web-proxy-access.json');
var MAX_USERS = 200;

var cache = null;

function defaults() {
  return { mode: 'all', users: [] };
}

function normalizeUser(raw) {
  if (!raw || typeof raw !== 'object') return null;
  // 用户 ID 只保留安全字符，避免异常输入写进配置后影响后续查询
  var id = String(raw.id || '').replace(/[^0-9a-zA-Z_-]/g, '').substring(0, 40);
  if (!id) return null;
  return { id: id, name: String(raw.name || '').substring(0, 40) };
}

function normalize(raw) {
  var out = defaults();
  if (!raw || typeof raw !== 'object') return out;
  out.mode = raw.mode === 'allowlist' ? 'allowlist' : 'all';
  var list = Array.isArray(raw.users) ? raw.users : [];
  var seen = {};
  for (var i = 0; i < list.length; i++) {
    if (out.users.length >= MAX_USERS) break;
    var u = normalizeUser(list[i]);
    if (!u || seen[u.id]) continue;
    seen[u.id] = true;
    out.users.push(u);
  }
  return out;
}

function load() {
  if (cache) return cache;
  var raw = null;
  try {
    if (fs.existsSync(FILE)) raw = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch (e) {
    console.log('[web-proxy] 读取可使用者设置失败: ' + e.message);
  }
  cache = normalize(raw);
  return cache;
}

function clone(access) {
  return {
    mode: access.mode,
    users: access.users.map(function(u) { return { id: u.id, name: u.name }; })
  };
}

function getAccess() {
  return clone(load());
}

function setAccess(input) {
  var next = normalize(input);
  var dir = path.dirname(FILE);
  try {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  } catch (e) {}
  // 先写临时文件再改名：写入过程中断电也不会留下半截 JSON
  var tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2), 'utf8');
  fs.renameSync(tmp, FILE);
  cache = next;
  return clone(next);
}

// 管理员 / 班管始终放行，避免班管把自己锁在兼容模式之外
function isPrivileged(uid) {
  if (!uid) return false;
  try {
    var constants = require('../../../server/src/utils/constants');
    if (constants.isClassAdmin(uid)) return true;
    var db = require('../../../server/src/utils/db');
    var row = db.prepare('SELECT is_admin, role FROM users WHERE user_id = ?').get(uid);
    return !!(row && (row.is_admin === 1 || row.role === 'officer'));
  } catch (e) {
    return false;
  }
}

// 是否允许该用户使用兼容模式
function isAllowed(uid) {
  var access = load();
  if (access.mode !== 'allowlist') return true;
  var id = String(uid || '');
  if (!id) return false;
  for (var i = 0; i < access.users.length; i++) {
    if (access.users[i].id === id) return true;
  }
  return isPrivileged(id);
}

module.exports = {
  getAccess: getAccess,
  setAccess: setAccess,
  isAllowed: isAllowed,
  MAX_USERS: MAX_USERS
};
