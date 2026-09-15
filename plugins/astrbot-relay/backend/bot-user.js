// AstrBot Relay - 机器人账号管理
// 确保机器人（如"白露未晞"）在 ClassIntra users 表中存在独立账号，
// 用于登录 WS 与真人用户私聊。账号信息来自环境变量（声明式，改完重启即生效）：
//   BOT_USER_ID  （默认 linxi_ai）
//   BOT_NET_NAME （默认 林晞）
//   BOT_REAL_NAME（默认 林晞）
//   BOT_PASSWORD （必填，同时用于自动建号与 WS 登录）
//   BOT_GENDER   （默认 女）
//
// 2026-09-15 修正：原实现是「账号已存在即 return」的幂等建号，导致改 .env 的
//   BOT_NET_NAME / BOT_REAL_NAME 对已建好的账号永远不生效（表现为「网名改了好几次
//   都没变」，DB 里始终是旧名）。现改为：账号已存在时按 .env 声明**同步差异字段**。
//   注意 net_name 有 UNIQUE 约束，被他人占用时降级为保留原名并告警（不影响其它字段）。

var db = require('../../../server/src/utils/db');
var pwdUtil = require('../../../server/src/utils/password');
var time = require('../../../server/src/utils/time');

function getBotConfig() {
  return {
    userId: process.env.BOT_USER_ID || 'linxi_ai',
    netName: process.env.BOT_NET_NAME || '林晞',
    realName: process.env.BOT_REAL_NAME || '林晞',
    password: process.env.BOT_PASSWORD || '',
    gender: process.env.BOT_GENDER || '女'
  };
}

// 把已存在账号按 .env 声明对齐
// 返回 { notes: [...变更说明], nameTakenBy: 占用目标网名的 userId | null }
function syncExistingUser(cfg, existing) {
  var sets = [];
  var params = [];
  var notes = [];
  var nameTakenBy = null;

  if (existing.net_name !== cfg.netName) {
    var taken = db.prepare('SELECT user_id FROM users WHERE net_name = ? AND user_id != ?').get(cfg.netName, cfg.userId);
    if (taken) {
      nameTakenBy = taken.user_id;
    } else {
      sets.push('net_name = ?');
      params.push(cfg.netName);
      notes.push('网名「' + existing.net_name + '」→「' + cfg.netName + '」');
    }
  }

  if (existing.real_name !== cfg.realName) {
    sets.push('real_name = ?');
    params.push(cfg.realName);
    notes.push('真名「' + existing.real_name + '」→「' + cfg.realName + '」');
  }

  if (cfg.gender && existing.gender !== cfg.gender) {
    sets.push('gender = ?');
    params.push(cfg.gender);
    notes.push('性别「' + existing.gender + '」→「' + cfg.gender + '」');
  }

  // 密码：先用 .env 密码校验现有 hash，只有对不上才重置（避免每次启动都重算 bcrypt）
  var passwordOk = false;
  try {
    passwordOk = pwdUtil.verifyPassword(cfg.password, existing.password_hash);
  } catch (e) {
    passwordOk = false;
  }
  if (!passwordOk) {
    sets.push('password_hash = ?');
    params.push(pwdUtil.hashPassword(cfg.password));
    notes.push('密码按 .env 重置');
  }

  if (sets.length > 0) {
    sets.push('updated_at = ?');
    params.push(time.nowISO());
    params.push(cfg.userId);
    // better-sqlite3 铁律：stmt 方法必须 apply(stmt, ...) 绑定 this，否则 Illegal invocation
    var stmt = db.prepare('UPDATE users SET ' + sets.join(', ') + ' WHERE user_id = ?');
    stmt.run.apply(stmt, params);
  }

  return { notes: notes, nameTakenBy: nameTakenBy };
}

// 确保机器人账号存在，并与 .env 声明保持一致（无差异时不做任何写入）
function ensureBotUser() {
  var cfg = getBotConfig();
  if (!cfg.password) {
    console.warn('[astrbot-relay] 未配置 BOT_PASSWORD，跳过机器人账号检查与登录');
    return null;
  }
  try {
    var existing = db.prepare(
      'SELECT user_id, net_name, real_name, gender, password_hash FROM users WHERE user_id = ?'
    ).get(cfg.userId);

    if (existing) {
      var result = syncExistingUser(cfg, existing);
      if (result.nameTakenBy) {
        console.warn('[astrbot-relay] 网名「' + cfg.netName + '」已被账号 ' + result.nameTakenBy + ' 占用，保留原名「' + existing.net_name + '」');
      }
      if (result.notes.length > 0) {
        console.log('[astrbot-relay] 机器人账号已同步: ' + cfg.userId + ' — ' + result.notes.join('；'));
      } else {
        console.log('[astrbot-relay] 机器人账号已存在且与 .env 一致: ' + cfg.userId + ' (' + existing.net_name + ')');
      }
      return cfg;
    }

    var passwordHash = pwdUtil.hashPassword(cfg.password);
    db.prepare(
      'INSERT INTO users (net_name, real_name, user_id, gender, password_hash, status, is_admin, info_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(cfg.netName, cfg.realName, cfg.userId, cfg.gender, passwordHash, 'active', 0, '{}');
    db.prepare('UPDATE users SET updated_at = ? WHERE user_id = ?').run(time.nowISO(), cfg.userId);
    console.log('[astrbot-relay] 已创建机器人账号: ' + cfg.userId + ' (' + cfg.netName + ')');
    return cfg;
  } catch (e) {
    console.error('[astrbot-relay] 机器人账号初始化失败:', e.message);
    return null;
  }
}

module.exports = { getBotConfig: getBotConfig, ensureBotUser: ensureBotUser };
