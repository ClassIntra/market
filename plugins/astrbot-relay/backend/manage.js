// AstrBot Relay - 管理动作代理（管理员授权下，林晞代跑 CI 管理操作）
//
// 设计要点
// --------
// 1) **执行身份 = 林晞自己**（BOT_USER_ID，CI 里的「机器人管理员」）：
//    用 CI 自己的 jwt 工具给机器人账号签一张短期令牌，再打本机 /api/admin/*。
//    这样 WS 广播、中继 bus、同步墓碑、水位重置、审计日志全部由 CI 原有代码处理，
//    不发生逻辑漂移；而 CI 侧的审计里记的也是林晞，不是被冒充的真人。
// 2) **授权身份 = 人类管理员**：只有 ADMIN_USER_IDS 里的人（默认只有管理员本人）
//    能指挥林晞；非授权人一律拒绝。
// 3) op 表即白名单：AstrBot 只能传 op 名 + 参数，URL/方法由本文件决定，
//    不存在路径注入，也不会随 AstrBot 侧描述漂移而越权。
// 4) 破坏性动作（destructive:true）必须带 confirmed 标记；该标记由 AstrBot 侧
//    的「复述 → 等用户确认」两段式闸门产生，CI 侧只做二次校验与审计。
// 5) 每个动作都写 admin_logs：admin_id=授权人，action 前缀「林晞代理:」，
//    detail 里记执行者，可追溯「谁授权、谁执行」。
// 6) 批量动作：resolve() 可返回「一组计划」，run() 对多目标串行执行、逐条审计并聚合
//    结果（user_ban / user_unban 支持 targets 数组；单目标时返回结构与错误语义与旧版
//    完全一致，不影响既有动作的 data 形状）。
//    另有「全体」令牌 all / all_except_<用户…>：展开成**一个**计划打 CI 的
//    /users/bulk-status（单请求批量，避免上百次串行 PATCH 把调用方超时打爆），
//    展开范围始终排除管理员与班管。

var axios = require('axios');
var db = require('../../../server/src/utils/db');
var constants = require('../../../server/src/utils/constants');
var jwtUtil = require('../../../server/src/utils/jwt');

var CI_PORT = parseInt(process.env.PORT, 10) || 3000;
var BOT_USER_ID = process.env.BOT_USER_ID || 'linxi_ai';

// ===== 授权人（谁能指挥林晞管 CI）======
// 默认取 CI 自己的管理员白名单；可用 ASTRBOT_OWNER_IDS 单独收窄。
function ownerIds() {
  var raw = String(process.env.ASTRBOT_OWNER_IDS || process.env.ADMIN_USER_IDS || '').trim();
  return raw.split(/[,，\s]+/).map(function (s) { return s.trim(); }).filter(Boolean);
}

function isOwner(userId) {
  return ownerIds().indexOf(String(userId == null ? '' : userId).trim()) !== -1;
}

// ===== 自签林晞令牌（短缓存，避免每个动作都重查库签名）=====
var TOKEN_TTL = 5 * 60 * 1000;
var tokenCache = { token: null, exp: 0 };

function botToken() {
  if (tokenCache.token && Date.now() < tokenCache.exp) return tokenCache.token;
  var row = db.prepare('SELECT * FROM users WHERE user_id = ?').get(BOT_USER_ID);
  if (!row) throw new Error('机器人账号不存在：' + BOT_USER_ID);
  if (row.status === 'disabled') throw new Error('机器人账号当前被禁用，无法执行管理动作');
  var isAdmin = (row.is_admin === 1 || constants.isSystemAdmin(row.user_id)) ? 1 : 0;
  if (!isAdmin) {
    throw new Error('机器人账号 ' + BOT_USER_ID + ' 还不是管理员：请把它加入 server/.env 的 BOT_ADMIN_IDS 后重启 CI');
  }
  var token = jwtUtil.generateToken({
    user_id: row.user_id,
    net_name: row.net_name,
    real_name: row.real_name,
    is_admin: row.is_admin,
    is_class_admin: constants.isClassAdmin(row.user_id),
    role: row.role || 'user',
    officer_permissions: row.officer_permissions || '[]',
    officer_title: row.officer_title || '',
    gender: row.gender
  });
  tokenCache = { token: token, exp: Date.now() + TOKEN_TTL };
  return token;
}

// ===== 参数清洗 =====
function digits(v) {
  return String(v == null ? '' : v).replace(/[^0-9]/g, '');
}
function safeId(v) {
  // 用户 ID / 应用名 / 房间名：只允许字母数字下划线连字符
  return String(v == null ? '' : v).trim().replace(/[^0-9A-Za-z_\-\u4e00-\u9fa5]/g, '');
}
function text(v, max) {
  var s = String(v == null ? '' : v).trim();
  return max && s.length > max ? s.slice(0, max) : s;
}

// 用户类管理端点的 :id 是 users.id（自增主键），**不是** user_id。
// 这里做宽容解析：主键 id / user_id / 网名 / 真名 都能给。
function resolveUser(target) {
  var raw = text(target, 40);
  if (!raw) throw new Error('需要指定用户（user_id、网名或真名）');
  var cols = 'id, user_id, net_name';
  var row = null;
  if (/^\d{5,}$/.test(raw)) {
    // 5 位以上数字优先当学号 user_id（2508xx / 2518xx）
    row = db.prepare('SELECT ' + cols + ' FROM users WHERE user_id = ?').get(raw);
  } else if (/^\d+$/.test(raw)) {
    row = db.prepare('SELECT ' + cols + ' FROM users WHERE id = ?').get(parseInt(raw, 10));
  }
  if (!row) {
    row = db.prepare('SELECT ' + cols + ' FROM users WHERE user_id = ? OR net_name = ? OR real_name = ? LIMIT 1')
      .get(raw, raw, raw);
  }
  if (!row) throw new Error('找不到用户：' + raw);
  return row;
}

// ── 「全体」令牌 ──
// all                → 全部用户，但**始终排除** is_admin=1 的账号与班管（与 CI 原生
//                      /users/batch-status 的口径一致；机器人自己 is_admin=1，天然被排除）
// all_except_<用户…> → 上述集合再减去列出的人（用户可用逗号/顿号/空格分隔，写 user_id、
//                      网名、真名都行，例如 all_except_251800  或  all_except:张三,25180123）
function isAllToken(s) {
  return /^all(_except)?([\s:：_]|$)/i.test(String(s == null ? '' : s).trim());
}

function allScopeRows() {
  // is_admin=1（含机器人自己 linxi_ai）与班管一律不进「全体」范围 —— 与 CI 原生
  // /users/batch-status 的口径一致，避免把管理员锁在门外。is_admin 在 SQL 里过滤：
  // 踩过一次「SELECT 漏列 → rows[i].is_admin 恒为 undefined → 管理员没被排除」。
  var rows = db.prepare(
    'SELECT id, user_id, net_name FROM users WHERE COALESCE(is_admin, 0) = 0'
  ).all();
  var out = [];
  for (var i = 0; i < rows.length; i++) {
    if (constants.isClassAdmin(String(rows[i].user_id))) continue;
    out.push(rows[i]);
  }
  return out;
}

// 解析「一个或多个目标用户」。返回 { bulk, rows }：
//   bulk=false → rows 是逐个 resolveUser 出来的用户（按 users.id 去重）
//   bulk=true  → rows 是「全体令牌」展开后的用户集合，调用方应合并成**一个**批量请求
//                （上百人逐个 PATCH 会把调用方 70s 超时打爆）
function planTargets(p) {
  // 先收集「未切分」的原始条目，否则 all_except_251800 会被逗号切分规则拆散
  var chunks = [];
  if (Array.isArray(p.targets)) {
    for (var i = 0; i < p.targets.length; i++) {
      var t = p.targets[i];
      if (Array.isArray(t)) {
        for (var j = 0; j < t.length; j++) chunks.push(String(t[j] == null ? '' : t[j]));
      } else {
        chunks.push(String(t == null ? '' : t));
      }
    }
  } else if (typeof p.targets === 'string' && p.targets.trim()) {
    chunks.push(p.targets);
  }
  if (p.target) chunks.push(String(p.target));

  var allHit = null;
  var names = [];
  for (var k = 0; k < chunks.length; k++) {
    var c = chunks[k].trim();
    if (!c) continue;
    if (isAllToken(c)) { allHit = c; continue; }
    names = names.concat(c.split(/[,，、;；\s]+/));
  }

  if (allHit) {
    // all_except_ 后面的人名（也把同时给出的其它条目一起当作排除项）
    var tail = allHit.replace(/^all(_except)?[\s:：_]*/i, '');
    if (tail) names = names.concat(tail.split(/[,，、;；\s]+/));
    var exIds = {};
    for (var m = 0; m < names.length; m++) {
      var nm = text(names[m], 40);
      if (!nm) continue;
      exIds[resolveUser(nm).id] = 1;   // 找不到就抛错，不静默放过
    }
    var base = allScopeRows();
    var kept = [];
    for (var n = 0; n < base.length; n++) {
      if (!exIds[base[n].id]) kept.push(base[n]);
    }
    if (!kept.length) throw new Error('「全体」解析后没有可操作的用户');
    return { bulk: true, rows: kept };
  }

  var cleaned = [];
  for (var q = 0; q < names.length; q++) {
    var v = text(names[q], 40);
    if (v) cleaned.push(v);
  }
  if (!cleaned.length) throw new Error('需要指定用户（user_id、网名或真名），或用 all / all_except_<用户> 指定全体');
  if (cleaned.length > 50) throw new Error('一次最多 50 个目标');

  var rows = [], seen = {};
  for (var r = 0; r < cleaned.length; r++) {
    var u = resolveUser(cleaned[r]);
    if (!seen[u.id]) { seen[u.id] = 1; rows.push(u); }
  }
  return { bulk: false, rows: rows };
}

// ===== op 表（唯一白名单）=====
// resolve(params) -> { method, path, body, query }；抛错即参数不合法。
// destructive=true 的动作必须带 confirmed 标记。
var OPS = {
  // ── 公告 ──
  announce_publish: {
    destructive: false, desc: '发布一条公告',
    args: 'title=标题（必填）, content=正文（必填）, extra=类型 notice/homework（可选，默认 notice）',
    resolve: function (p) {
      var title = text(p.title, 200);
      var content = text(p.content, 20000);
      if (!title) throw new Error('公告标题不能为空');
      if (!content) throw new Error('公告正文不能为空');
      var type = ['notice', 'homework'].indexOf(text(p.extra)) !== -1 ? text(p.extra) : 'notice';
      return { method: 'post', path: '/announcements', body: { title: title, content: content, type: type } };
    }
  },
  announce_edit: {
    destructive: false, desc: '修改已有公告',
    args: 'num=公告ID（必填）, title=新标题（必填）, content=新正文（必填）, extra=类型（可选）',
    resolve: function (p) {
      var id = digits(p.num);
      if (!id) throw new Error('需要公告 ID（num）');
      var title = text(p.title, 200);
      var content = text(p.content, 20000);
      if (!title || !content) throw new Error('标题与正文都不能为空');
      var body = { title: title, content: content };
      if (['notice', 'homework'].indexOf(text(p.extra)) !== -1) body.type = text(p.extra);
      return { method: 'put', path: '/announcements/' + id, body: body };
    }
  },
  announce_pin: {
    destructive: false, desc: '置顶或取消置顶公告',
    args: 'num=公告ID（必填）, flag=true 置顶 / false 取消',
    resolve: function (p) {
      var id = digits(p.num);
      if (!id) throw new Error('需要公告 ID（num）');
      return { method: 'patch', path: '/announcements/' + id + '/pin', body: { pinned: !!p.flag } };
    }
  },
  announce_delete: {
    destructive: true, desc: '删除一条公告',
    args: 'num=公告 ID（必填）',
    resolve: function (p) {
      var id = digits(p.num);
      if (!id) throw new Error('需要公告 ID（num）');
      return { method: 'delete', path: '/announcements/' + id };
    }
  },
  announce_list: {
    destructive: false, desc: '查看现有公告（管理视角）',
    resolve: function () { return { method: 'get', path: '/announcements' }; }
  },

  // ── 快讯 ──
  broadcast_publish: {
    destructive: false, desc: '发一条快讯（会实时推送到在线设备）',
    args: 'content=快讯内容（必填）, extra=优先级 normal/important/urgent（可选）',
    resolve: function (p) {
      var content = text(p.content, 500);
      if (!content) throw new Error('快讯内容不能为空');
      var pr = ['normal', 'important', 'urgent'].indexOf(text(p.extra)) !== -1 ? text(p.extra) : 'normal';
      return { method: 'post', path: '/broadcasts', body: { content: content, priority: pr } };
    }
  },

  // ── 聊天 ──
  chat_clear: {
    destructive: true, desc: '清空公共聊天室（或指定群）历史消息',
    args: 'target=房间名（可选，默认 public；填群 ID 则清该群）',
    resolve: function (p) {
      var room = safeId(p.target) || 'public';
      return { method: 'post', path: '/clear-chat', body: { room: room } };
    }
  },
  chat_delete_message: {
    destructive: true, desc: '删除某条聊天消息',
    args: 'num=消息 ID（必填）',
    resolve: function (p) {
      var id = digits(p.num);
      if (!id) throw new Error('需要消息 ID（num）');
      return { method: 'delete', path: '/chat/messages/' + id };
    }
  },

  // ── 用户 ──
  user_list: {
    destructive: false, desc: '查用户列表（支持搜索/筛选）',
    args: 'target=搜索关键词（网名/真名/ID，可选）, content=状态 active/disabled（可选）, extra=班号（可选）',
    resolve: function (p) {
      var q = {};
      var s = text(p.target, 50);
      if (s) q.search = s;
      var st = text(p.content, 20);
      if (st === 'active' || st === 'disabled') q.status = st;
      var cls = digits(p.extra);
      if (cls) q.class = cls;
      return { method: 'get', path: '/users', query: q };
    }
  },
  user_ban: {
    destructive: true, desc: '封禁一个或多个用户（可设时长，默认永久）',
    args: 'targets=用户数组 或 target=单个用户（user_id / 网名 / 真名；多个可用逗号分隔）, ' +
      '也支持全体令牌 all / all_except_<用户…>（排除管理员与班管）, content=封禁原因（可选）, num=时长分钟（0 或不填=永久）',
    resolve: function (p) {
      var mins = parseInt(p.num, 10);
      if (isNaN(mins) || mins < 0) mins = 0;
      var reason = text(p.content, 200);
      var t = planTargets(p);
      if (t.bulk) {
        // 全走 CI 的单请求批量端点：一次循环 UPDATE + 一次审计，避免上百次串行 PATCH
        return {
          method: 'post', path: '/users/bulk-status',
          body: {
            user_ids: t.rows.map(function (u) { return u.user_id; }),
            status: 'disabled', reason: reason, duration: mins
          },
          auditTarget: '全体 ' + t.rows.length + ' 人'
        };
      }
      return t.rows.map(function (u) {
        return {
          method: 'patch', path: '/users/' + u.id + '/status',
          body: { status: 'disabled', reason: reason, duration: mins },
          auditTarget: u.user_id + (u.net_name ? '(' + u.net_name + ')' : '')
        };
      });
    }
  },
  user_unban: {
    destructive: false, desc: '解封一个或多个用户',
    args: 'targets=用户数组 或 target=单个用户（user_id / 网名 / 真名；多个可用逗号分隔）, ' +
      '也支持全体令牌 all / all_except_<用户…>（排除管理员与班管）',
    resolve: function (p) {
      var t = planTargets(p);
      if (t.bulk) {
        return {
          method: 'post', path: '/users/bulk-status',
          body: {
            user_ids: t.rows.map(function (u) { return u.user_id; }),
            status: 'active'
          },
          auditTarget: '全体 ' + t.rows.length + ' 人'
        };
      }
      return t.rows.map(function (u) {
        return {
          method: 'patch', path: '/users/' + u.id + '/status',
          body: { status: 'active' },
          auditTarget: u.user_id + (u.net_name ? '(' + u.net_name + ')' : '')
        };
      });
    }
  },
  user_update: {
    destructive: true, desc: '修改用户资料（网名/真名/性别）',
    args: 'target=用户（user_id / 网名 / 真名，必填）, title=新网名（可选）, content=新真名（可选）, extra=性别 男/女（可选）',
    resolve: function (p) {
      var u = resolveUser(p.target);
      var body = {};
      var nn = text(p.title, 30);
      var rn = text(p.content, 30);
      var gd = text(p.extra, 5);
      if (nn) body.net_name = nn;
      if (rn) body.real_name = rn;
      if (gd === '男' || gd === '女') body.gender = gd;
      if (!Object.keys(body).length) throw new Error('至少要指定一项要改的内容（网名/真名/性别）');
      return {
        method: 'patch', path: '/users/' + u.id, body: body,
        auditTarget: u.user_id + (u.net_name ? '(' + u.net_name + ')' : '')
      };
    }
  },
  user_reset_password: {
    destructive: true, desc: '重置用户密码（不指定则随机生成临时密码）',
    args: 'target=用户（user_id / 网名 / 真名，必填）, content=新密码（可选，不填则随机生成）',
    resolve: function (p) {
      var u = resolveUser(p.target);
      var pw = text(p.content, 64);
      return {
        method: 'post', path: '/users/' + u.id + '/reset-password',
        body: pw ? { password: pw } : {},
        auditTarget: u.user_id + (u.net_name ? '(' + u.net_name + ')' : '')
      };
    }
  },
  user_delete: {
    destructive: true, desc: '删除用户账号（不可恢复）',
    args: 'target=用户（user_id / 网名 / 真名，必填）',
    resolve: function (p) {
      var u = resolveUser(p.target);
      return {
        method: 'delete', path: '/users/' + u.id,
        auditTarget: u.user_id + (u.net_name ? '(' + u.net_name + ')' : '')
      };
    }
  },

  // ── 系统 ──
  lock_screen_set: {
    destructive: true, desc: '锁定或解锁全体学生设备屏幕',
    args: 'flag=true 锁屏 / false 解锁',
    resolve: function (p) { return { method: 'put', path: '/lock-screen', body: { enabled: !!p.flag } }; }
  },
  lock_screen_get: {
    destructive: false, desc: '查看当前锁屏状态',
    resolve: function () { return { method: 'get', path: '/lock-screen' }; }
  },
  app_control_list: {
    destructive: false, desc: '查看应用开关列表',
    resolve: function () { return { method: 'get', path: '/app-control' }; }
  },
  app_control_set: {
    destructive: true, desc: '开启或关闭某个应用',
    args: 'target=应用名（必填）, flag=true 开启 / false 关闭',
    resolve: function (p) {
      var name = safeId(p.target);
      if (!name) throw new Error('需要应用名（target）');
      return { method: 'put', path: '/app-control/' + encodeURIComponent(name), body: { enabled: !!p.flag } };
    }
  },
  server_mode_set: {
    destructive: true, desc: '切换服务器模式',
    args: 'target=single 单班 / multi 多班',
    resolve: function (p) {
      var mode = text(p.target).toLowerCase();
      if (mode !== 'single' && mode !== 'multi') throw new Error('模式只能是 single 或 multi');
      return { method: 'post', path: '/server-mode', body: { mode: mode } };
    }
  },
  pm2_status: {
    destructive: false, desc: '查看 PM2 进程状态',
    resolve: function () { return { method: 'get', path: '/pm2/status' }; }
  },
  pm2_restart: {
    destructive: true, desc: '重启 classintra-server（会短暂断开全班）',
    resolve: function () { return { method: 'post', path: '/pm2/restart' }; }
  },
  pm2_stop: {
    destructive: true, desc: '停止 classintra-server（全班将无法使用）',
    resolve: function () { return { method: 'post', path: '/pm2/stop' }; }
  },
  pm2_start: {
    destructive: false, desc: '启动 classintra-server',
    resolve: function () { return { method: 'post', path: '/pm2/start' }; }
  },
  server_stats: {
    destructive: false, desc: '查看服务器统计（CPU/内存/磁盘/在线数）',
    resolve: function () { return { method: 'get', path: '/server-stats' }; }
  }
};

function catalog() {
  var out = [];
  Object.keys(OPS).forEach(function (op) {
    out.push({ op: op, destructive: !!OPS[op].destructive, desc: OPS[op].desc, args: OPS[op].args || '' });
  });
  return out;
}

// 写审计（CI 自身也会写一条 admin_logs，这里是「谁授权 + 经林晞代理」的留痕）
function audit(requesterId, op, target, params) {
  try {
    var detail = JSON.stringify({ executor: BOT_USER_ID, params: params || {} }).slice(0, 500);
    db.prepare(
      "INSERT INTO admin_logs (admin_id, action, target, detail, created_at) VALUES (?, ?, ?, ?, datetime('now'))"
    ).run(String(requesterId), '林晞代理:' + op, String(target || ''), detail);
  } catch (e) {
    console.error('[astrbot-relay] 审计写入失败:', e.message);
  }
}

// 执行一个管理动作
// 返回 Promise<{op, destructive, status, data, message}>
function run(requesterId, op, params, confirmed) {
  return Promise.resolve().then(function () {
    var who = String(requesterId == null ? '' : requesterId).trim();
    if (!who) throw new Error('缺少授权人标识（requester_id）');
    if (!isOwner(who)) {
      throw new Error('无权限：只有管理员本人可以让林晞执行 ClassIntra 管理动作');
    }
    var spec = OPS[op];
    if (!spec) throw new Error('未知的管理动作：' + op);
    if (spec.destructive && !confirmed) {
      throw new Error('这是破坏性动作，必须经管理员确认后才能执行');
    }
    // resolve 可返回「一个计划」或「一组计划」（批量动作，如 user_ban 多目标）。
    var resolved = spec.resolve(params || {});
    var plans = Array.isArray(resolved) ? resolved : [resolved];
    if (!plans.length) throw new Error('没有可执行的目标');
    var token = botToken();

    // ── 单目标：保持原有返回结构与错误语义 ──
    // 既有动作（user_list / server_stats / announce_publish / lock_screen_* …）的
    // data 形状依赖 CI 原始响应，绝不能被批量包装改动。
    if (plans.length === 1) {
      var plan = plans[0];
      var cfg = {
        method: plan.method,
        url: 'http://localhost:' + CI_PORT + '/api/admin' + plan.path,
        headers: { Authorization: 'Bearer ' + token },
        timeout: 60000
      };
      if (plan.query) cfg.params = plan.query;
      if (plan.body) cfg.data = plan.body;

      return axios.request(cfg).then(function (resp) {
        audit(who, op, plan.auditTarget || plan.path, plan.body || plan.query || {});
        return {
          op: op,
          destructive: !!spec.destructive,
          desc: spec.desc,
          status: resp.status,
          message: (resp.data && resp.data.message) || 'ok',
          data: (resp.data && resp.data.data) || null
        };
      }).catch(function (e) {
        var st = (e && e.response && e.response.status) || 0;
        var msg = (e && e.response && e.response.data && e.response.data.message) || e.message || '执行失败';
        var err = new Error('执行失败' + (st ? '（HTTP ' + st + '）' : '') + '：' + msg);
        err.httpStatus = st;
        throw err;
      });
    }

    // ── 多目标：串行执行，逐条审计，聚合成功/失败；单条失败不中断整批 ──
    var okList = [], failList = [];

    function execOne(pl) {
      var cfg1 = {
        method: pl.method,
        url: 'http://localhost:' + CI_PORT + '/api/admin' + pl.path,
        headers: { Authorization: 'Bearer ' + token },
        timeout: 60000
      };
      if (pl.query) cfg1.params = pl.query;
      if (pl.body) cfg1.data = pl.body;
      return axios.request(cfg1).then(function (resp) {
        audit(who, op, pl.auditTarget || pl.path, pl.body || pl.query || {});
        okList.push({ target: pl.auditTarget || pl.path, status: resp.status });
      }, function (e) {
        var st = (e && e.response && e.response.status) || 0;
        var msg = (e && e.response && e.response.data && e.response.data.message) || e.message || '执行失败';
        failList.push({ target: pl.auditTarget || pl.path, status: st, message: msg });
      });
    }

    var chain = Promise.resolve();
    plans.forEach(function (pl) {
      chain = chain.then(function () { return execOne(pl); });
    });

    return chain.then(function () {
      var total = plans.length;
      return {
        op: op,
        destructive: !!spec.destructive,
        desc: spec.desc,
        status: failList.length ? 207 : 200,
        message: failList.length
          ? '成功 ' + okList.length + '/' + total + ' 人，失败 ' + failList.length + ' 人'
          : '成功 ' + okList.length + '/' + total + ' 人',
        data: { affected: okList.length, total: total, failed: failList, results: okList }
      };
    });
  });
}

module.exports = {
  isOwner: isOwner,
  ownerIds: ownerIds,
  catalog: catalog,
  run: run,
  OPS: OPS
};
