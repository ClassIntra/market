var express = require('express');
var path = require('path');
var router = express.Router();
var db = require(path.resolve(process.cwd(), 'src/utils/db'));
var requireAuth = require(path.resolve(process.cwd(), 'src/middleware/auth')).requireAuth;
var crypto = require('crypto');
var realtimeBus = require(path.resolve(process.cwd(), 'src/utils/realtime-bus'));
var relayBus = require(path.resolve(process.cwd(), 'src/utils/relay-bus'));
var config = require(path.resolve(process.cwd(), 'src/config'));
var http = require('http');
var SELF_SERVER_ID = (config.relay && config.relay.serverId) || '';
var RELAY_SECRET = (config.relay && config.relay.secret) || '';
// 跨班对局前提：配置了中继服务器且本机有服务器标识
var RELAY_ACTIVE = !!((config.relay && config.relay.servers && config.relay.servers.length) && SELF_SERVER_ID);
var DEFAULT_SIZE = 15;
var ALLOWED_SIZES = [15, 19, 21];

function userId(req) {
  return String((req.user && (req.user.user_id || req.user.id)) || 'guest');
}
function board(size) { return Array.from({ length: size }, function() { return Array(size).fill(null); }); }
function validSize(size) { return ALLOWED_SIZES.indexOf(Number(size)) !== -1; }
function validCoordinate(row, col, size) { return Number.isInteger(row) && Number.isInteger(col) && row >= 0 && col >= 0 && row < size && col < size; }
// 房间码：4 位纯数字（10000 组合），低龄用户念读/转述零负担；
// 旧 6 位房间码仍可加入（正则放宽为 4-6 位）
function makeCode() { return String(crypto.randomBytes(2).readUInt16BE(0) % 10000).padStart(4, '0'); }
function colorForMember(roomCode, id) { var row = db.prepare('SELECT color FROM gomoku_members WHERE room_code = ? AND user_id = ?').get(roomCode, id); return row && row.color; }
function roomRow(roomCode) { return db.prepare('SELECT * FROM gomoku_rooms WHERE room_code = ?').get(roomCode); }
function currentGame(roomCode) { return db.prepare('SELECT * FROM gomoku_games WHERE room_code = ? AND status = \'active\' ORDER BY id DESC LIMIT 1').get(roomCode); }
function ensureGame(roomCode, size) {
  var game = currentGame(roomCode);
  if (game) return game;
  var result = db.prepare('INSERT INTO gomoku_games (room_code, size, board) VALUES (?, ?, ?)').run(roomCode, size, JSON.stringify(board(size)));
  return db.prepare('SELECT * FROM gomoku_games WHERE id = ?').get(result.lastInsertRowid);
}
function hasWinner(state, row, col, color) {
  return [[1, 0], [0, 1], [1, 1], [1, -1]].some(function(direction) {
    var count = 1;
    [[1, 1], [-1, -1]].forEach(function(sign) {
      var r = row + direction[0] * sign[0], c = col + direction[1] * sign[1];
      while (r >= 0 && c >= 0 && r < state.length && c < state.length && state[r][c] === color) {
        count += 1; r += direction[0] * sign[0]; c += direction[1] * sign[1];
      }
    });
    return count >= 5;
  });
}
function stateFor(roomCode, game) {
  // 关联 users 表带出网名（net_name）：成员列表显示网名而非学号账号。
  // 跨班成员的账号在本机同样存在（relay user_registered 全量同步），LEFT JOIN 兜底。
  var members = db.prepare('SELECT m.user_id, m.role, m.color, m.joined_at, m.last_seen_at, u.net_name FROM gomoku_members m LEFT JOIN users u ON u.user_id = m.user_id WHERE m.room_code = ? ORDER BY m.joined_at').all(roomCode);
  // lastMove：供前端高亮最后一手（落子脉冲环）。按 id 倒序取本局最后一步。
  var last = db.prepare('SELECT user_id, color, row, col FROM gomoku_moves WHERE game_id = ? ORDER BY id DESC LIMIT 1').get(game.id);
  return {
    roomCode: roomCode,
    size: game.size,
    board: JSON.parse(game.board),
    turn: game.turn,
    winner: game.winner,
    status: game.status,
    gameId: game.id,
    members: members,
    lastMove: last ? { userId: last.user_id, color: last.color, row: last.row, col: last.col } : null
  };
}
function notifyRoom(roomCode, state) {
  var members = db.prepare('SELECT user_id FROM gomoku_members WHERE room_code = ?').all(roomCode);
  var memberIds = members.map(function(member) { return member.user_id; });
  realtimeBus.publishToUsers(memberIds, {
    type: 'extension_event',
    app_name: 'gomoku',
    event: 'gomoku.room.changed',
    payload: { roomCode: roomCode, state: state },
    created_at: new Date().toISOString()
  });
  // 跨班：把状态变化中继给成员所在的其他服务器，由对方投递给本机在线成员
  if (RELAY_ACTIVE) relayBus.relayOnly('gomoku_room_event', { room_code: roomCode, member_ids: memberIds, state: state });
}
// ===== 房间快捷聊天 =====
// 自包含实现，不依赖 chat 应用的消息表/已读状态/通知体系：房间级短消息，随房间销毁。
// 玩家与观战者都能发言（观战者不能落子，聊天是其唯一参与方式）。与 chess 1.5.0 同构。
var CHAT_FETCH_LIMIT = 80;    // 单次拉取上限：只取最近一段，长会话不整体回传
var CHAT_MAX_LENGTH = 200;

function chatMessageView(row) {
  return {
    id: row.id,
    userId: row.user_id,
    netName: row.net_name || null,
    content: row.content
  };
}
function notifyRoomMessage(roomCode, message) {
  var memberIds = db.prepare('SELECT user_id FROM gomoku_members WHERE room_code = ?').all(roomCode).map(function(member) { return member.user_id; });
  if (!memberIds.length) return;
  realtimeBus.publishToUsers(memberIds, {
    type: 'extension_event',
    app_name: 'gomoku',
    event: 'gomoku.room.message',
    payload: { roomCode: roomCode, message: message },
    created_at: new Date().toISOString()
  });
  // 跨班房间的成员可能分布在不同服务器上，聊天同样要经中继送到对端本机在线成员手里。
  // 与 gomoku.room.changed 同构；漏掉这条则跨班对局的聊天单向可见（本机能看到对端发言，
  // 对端看不到本机发言），排查成本很高 —— 现象是「他明明说我说话了，我这边没显示」。
  if (RELAY_ACTIVE) relayBus.relayOnly('gomoku_room_message', { room_code: roomCode, member_ids: memberIds, message: message });
}
// 房间销毁（关房 / 空置）时清空消息。调用方保证时机，这里只做删除。
function purgeRoomMessages(roomCode) {
  db.prepare('DELETE FROM gomoku_messages WHERE room_code = ?').run(roomCode);
}
function notifySuccessfulRoomChange(req, res, next) {
  var originalJson = res.json;
  res.json = function(body) {
    // 代理侧转发请求：家服务器已负责通知全房成员，代理侧不再重复广播
    if (req.gomokuForwarding) return originalJson.call(this, body);
    var pathMatch = req.path.match(/^\/rooms\/([A-Z0-9]{4,6})\/(join|watch|leave|move|reset|color|undo)$/i);
    if (pathMatch && body && body.code >= 200 && body.code < 300) {
      var roomCode = pathMatch[1].toUpperCase();
      var result = body.data && body.data.members ? body.data : null;
      if (result) notifyRoom(roomCode, result);
    }
    return originalJson.call(this, body);
  };
  next();
}
router.use(notifySuccessfulRoomChange);

// ===== 跨班对局：房间目录 + 请求转发 =====
// 房间数据只存在于创建它的「家服务器」上；其他服务器的学生凭房间码加入时，
// 通过中继同步的目录找到家服务器，把请求原样转发过去（单写者，避免双机状态冲突）。
db.exec("CREATE TABLE IF NOT EXISTS gomoku_room_directory (room_code TEXT PRIMARY KEY, server_id TEXT NOT NULL, size INTEGER, updated_at TEXT DEFAULT (datetime('now')))");
// 房间快捷聊天表：消息挂在房间上，随房间生命周期销毁（关房 / 房间空置即清空），不做跨房投递。
// created_at 沿用 SQLite datetime('now')（UTC，与 gomoku_moves 一致）；界面不展示时间，
// 避免与中继/其他表的 ISO 格式混用（见项目「created_at 两格式」约定）。
// 不加 FK 到 gomoku_rooms：基础表由 migration 004 建，跨班房间在本机可能只有目录行没有房间行，
// 加 FK 会让「转发到家的服务器的发言」在本机误判失败；生命周期由 purgeRoomMessages 负责。
db.exec("CREATE TABLE IF NOT EXISTS gomoku_messages (id INTEGER PRIMARY KEY AUTOINCREMENT, room_code TEXT NOT NULL, user_id TEXT NOT NULL, content TEXT NOT NULL, created_at TEXT DEFAULT (datetime('now')))");
db.exec('CREATE INDEX IF NOT EXISTS idx_gomoku_messages_room ON gomoku_messages(room_code, id)');
function directoryGet(roomCode) { return db.prepare('SELECT room_code, server_id, size FROM gomoku_room_directory WHERE room_code = ?').get(roomCode); }
function directorySet(roomCode, serverId, size) { db.prepare("INSERT OR REPLACE INTO gomoku_room_directory (room_code, server_id, size, updated_at) VALUES (?, ?, ?, datetime('now'))").run(roomCode, serverId, size || null); }
function directoryDelete(roomCode) { db.prepare('DELETE FROM gomoku_room_directory WHERE room_code = ?').run(roomCode); }

// 中继事件处理器：目录同步（建/关房广播）、房间事件跨机投递
relayBus.register('gomoku_room_directory_sync', function(payload) {
  if (payload && payload.room_code && payload.server_id) directorySet(payload.room_code, payload.server_id, payload.size);
});
relayBus.register('gomoku_room_directory_remove', function(payload) {
  if (payload && payload.room_code) directoryDelete(payload.room_code);
});
relayBus.register('gomoku_room_event', function(payload) {
  if (!payload || !payload.room_code || !payload.state) return;
  var ids = Array.isArray(payload.member_ids) ? payload.member_ids : [];
  var targets = [];
  for (var i = 0; i < ids.length; i++) { if (realtimeBus.isRegistered(ids[i])) targets.push(ids[i]); }
  if (!targets.length) return;
  realtimeBus.publishToUsers(targets, {
    type: 'extension_event',
    app_name: 'gomoku',
    event: 'gomoku.room.changed',
    payload: { roomCode: payload.room_code, state: payload.state },
    created_at: new Date().toISOString()
  });
});
// 聊天消息的跨机投递：只推给本机在线成员，避免向全机广播无关流量
relayBus.register('gomoku_room_message', function(payload) {
  if (!payload || !payload.room_code || !payload.message) return;
  var ids = Array.isArray(payload.member_ids) ? payload.member_ids : [];
  var targets = [];
  for (var i = 0; i < ids.length; i++) { if (realtimeBus.isRegistered(ids[i])) targets.push(ids[i]); }
  if (!targets.length) return;
  realtimeBus.publishToUsers(targets, {
    type: 'extension_event',
    app_name: 'gomoku',
    event: 'gomoku.room.message',
    payload: { roomCode: payload.room_code, message: payload.message },
    created_at: new Date().toISOString()
  });
});

// ===== 跨班请求转发（经中继 WS 通道，零配置）=====
// 不直接猜测对端 HTTP 地址（relay hub 可能与本机同机，URL 推导不可靠），
// 改为把请求打包成中继事件发给对端，对端自调用本地 HTTP 后把响应事件发回。
var pendingForwards = {};
relayBus.register('gomoku_room_response', function(payload) {
  if (!payload || !payload.req_id) return;
  var entry = pendingForwards[payload.req_id];
  if (!entry) return; // 非本机发起或已超时
  delete pendingForwards[payload.req_id];
  clearTimeout(entry.timer);
  entry.resolve(payload);
});
relayBus.register('gomoku_room_request', function(payload) {
  // 家服务器侧：收到对端转发来的房间请求 → 自调用本地 HTTP → 回发响应
  if (!payload || !payload.req_id || !payload.path || !payload.user_id) return;
  var hasBody = payload.method !== 'GET' && payload.method !== 'HEAD';
  var body = hasBody ? JSON.stringify(payload.body || {}) : null;
  var options = {
    hostname: '127.0.0.1',
    port: config.port || 9001,
    path: payload.path,
    method: payload.method || 'GET',
    headers: { 'X-Relay-Secret': RELAY_SECRET, 'X-Gomoku-User': payload.user_id }
  };
  if (body) {
    options.headers['Content-Type'] = 'application/json';
    options.headers['Content-Length'] = Buffer.byteLength(body);
  }
  var upstream = http.request(options, function(upRes) {
    var chunks = [];
    upRes.on('data', function(chunk) { chunks.push(chunk); });
    upRes.on('end', function() {
      var parsed = null;
      try { parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch (e) {}
      if (RELAY_ACTIVE) relayBus.relayOnly('gomoku_room_response', { req_id: payload.req_id, status: upRes.statusCode, body: parsed });
    });
  });
  upstream.setTimeout(6000, function() { upstream.destroy(new Error('timeout')); });
  upstream.on('error', function() {
    if (RELAY_ACTIVE) relayBus.relayOnly('gomoku_room_response', { req_id: payload.req_id, status: 502, body: { code: 502, message: '家服务器处理失败' } });
  });
  if (body) upstream.write(body);
  upstream.end();
});

// 把房间请求经中继转发到家服务器，并把响应透传回本机客户端
function forwardRoomRequest(req, res) {
  if (!RELAY_ACTIVE) return res.status(502).json({ code: 502, message: '跨班对局不可用：本机未配置中继服务器' });
  var reqId = crypto.randomBytes(8).toString('hex');
  var done = false;
  var timer = setTimeout(function() {
    if (done) return;
    done = true;
    delete pendingForwards[reqId];
    res.status(502).json({ code: 502, message: '跨班对局不可用：对方服务器无响应（可能离线）' });
  }, 8000);
  pendingForwards[reqId] = {
    timer: timer,
    resolve: function(reply) {
      if (done) return;
      done = true;
      // 家服务器已无此房 → 目录失效，就地清理
      if (reply.status === 404) directoryDelete(req.params.roomCode);
      res.status(reply.status || 502);
      if (reply.body) return res.json(reply.body);
      res.status(502);
      return res.json({ code: 502, message: '跨班对局响应异常' });
    }
  };
  relayBus.relayOnly('gomoku_room_request', {
    req_id: reqId,
    method: req.method,
    path: '/api/gomoku' + req.path,
    body: (req.method === 'GET' || req.method === 'HEAD') ? null : (req.body || {}),
    user_id: userId(req)
  });
}

// 房间路由认证：中继转发请求凭 X-Relay-Secret + 显式用户身份直通；
// 普通客户端仍走 JWT（requireAuth）。
function roomAuth(req, res, next) {
  var secret = req.get('X-Relay-Secret') || '';
  var fwdUser = req.get('X-Gomoku-User') || '';
  if (RELAY_SECRET && secret && secret === RELAY_SECRET && /^[A-Za-z0-9_-]{1,64}$/.test(fwdUser)) {
    req.user = { user_id: fwdUser };
    req.fromRelay = true;
    return next();
  }
  return requireAuth(req, res, next);
}

function requireRoom(req, res, next) {
  var roomCode = req.params.roomCode;
  var room = roomRow(roomCode);
  if (room && room.status !== 'closed') {
    req.gomokuRoom = room;
    return next();
  }
  // 本地无房 → 查跨班目录，转发到家服务器（来自中继的请求不允许再转发，防环）
  var entry = directoryGet(roomCode);
  if (entry && entry.server_id && entry.server_id !== SELF_SERVER_ID && RELAY_ACTIVE && !req.fromRelay) {
    req.gomokuForwarding = true;
    return forwardRoomRequest(req, res);
  }
  // 目录指向自己但房间已不存在 → 陈旧目录，清理
  if (entry) directoryDelete(roomCode);
  return res.status(404).json({ code: 404, message: '房间不存在或已关闭' });
}
function join(roomCode, id) {
  var existing = db.prepare('SELECT * FROM gomoku_members WHERE room_code = ? AND user_id = ?').get(roomCode, id);
  if (existing) {
    db.prepare('UPDATE gomoku_members SET last_seen_at = datetime(\'now\') WHERE room_code = ? AND user_id = ?').run(roomCode, id);
    return existing;
  }
  var colors = db.prepare('SELECT color FROM gomoku_members WHERE room_code = ? AND color IS NOT NULL').all(roomCode).map(function(row) { return row.color; });
  var color = colors.indexOf('black') === -1 ? 'black' : colors.indexOf('white') === -1 ? 'white' : null;
  db.prepare('INSERT INTO gomoku_members (room_code, user_id, role, color) VALUES (?, ?, ?, ?)').run(roomCode, id, color ? 'player' : 'spectator', color);
  return db.prepare('SELECT * FROM gomoku_members WHERE room_code = ? AND user_id = ?').get(roomCode, id);
}
function legacyKey(req) { return req.user && (req.user.user_id || req.user.id) ? String(req.user.user_id || req.user.id) : String(req.get('x-gomoku-room') || 'default'); }
function legacyRoom(req) {
  var key = legacyKey(req), room = roomRow(key);
  if (!room) {
    var code = key;
    if (code.length > 32) code = makeCode();
    try { db.prepare('INSERT INTO gomoku_rooms (room_code, owner_id, size) VALUES (?, ?, ?)').run(code, userId(req), DEFAULT_SIZE); } catch (e) {}
    room = roomRow(code);
    join(code, userId(req));
  }
  return room;
}
function createRoom(req, res) {
  var size = req.body && req.body.size === undefined ? DEFAULT_SIZE : Number(req.body && req.body.size);
  if (!validSize(size)) return res.status(400).json({ code: 400, message: '棋盘大小必须为15、19或21' });
  var code;
  do { code = makeCode(); } while (roomRow(code) || directoryGet(code));
  db.prepare('INSERT INTO gomoku_rooms (room_code, owner_id, size) VALUES (?, ?, ?)').run(code, userId(req), size);
  db.prepare('INSERT INTO gomoku_members (room_code, user_id, role, color) VALUES (?, ?, ?, ?)').run(code, userId(req), 'owner', 'black');
  db.prepare('UPDATE gomoku_rooms SET updated_at = datetime(\'now\') WHERE room_code = ?').run(code);
  var createdState = stateFor(code, ensureGame(code, size));
  notifyRoom(code, createdState);
  // 跨班：登记目录并广播给其他服务器，让他们能凭房间码找到本机
  directorySet(code, SELF_SERVER_ID, size);
  if (RELAY_ACTIVE) relayBus.relayOnly('gomoku_room_directory_sync', { room_code: code, server_id: SELF_SERVER_ID, size: size });
  return res.status(201).json({ code: 201, data: createdState });
}
router.post('/rooms', requireAuth, createRoom);
router.get('/rooms/:roomCode', requireRoom, function(req, res) { res.json({ code: 200, data: stateFor(req.params.roomCode, ensureGame(req.params.roomCode, req.gomokuRoom.size)) }); });
// ===== 房间快捷聊天接口 =====
// 聊天记录：只对房间成员开放（房间码只有 4 位，不校验成员等于把聊天内容暴露给猜码者）。
// 倒序取最近 N 条再反转 —— 长会话下要拿的是最新一段而不是最早一段。
// 挂 roomAuth 而非 requireAuth：跨班房间的请求会被 requireRoom 转发回家服务器，
// 转发请求凭 X-Relay-Secret 直通，用 requireAuth 会被判未登录。
router.get('/rooms/:roomCode/messages', roomAuth, requireRoom, function(req, res) {
  var id = userId(req), roomCode = req.params.roomCode;
  var member = db.prepare('SELECT user_id FROM gomoku_members WHERE room_code = ? AND user_id = ?').get(roomCode, id);
  if (!member) return res.status(403).json({ code: 403, message: '不在房间中' });
  var rows = db.prepare('SELECT m.id, m.user_id, m.content, m.created_at, u.net_name FROM gomoku_messages m LEFT JOIN users u ON u.user_id = m.user_id WHERE m.room_code = ? ORDER BY m.id DESC LIMIT ?').all(roomCode, CHAT_FETCH_LIMIT);
  rows.reverse();
  res.json({ code: 200, data: { messages: rows.map(chatMessageView) } });
});
// 发言：玩家与观战者都可发（观战者不能落子，聊天是其唯一参与方式）。
// 内容以 textContent 在前端渲染，不做 HTML 解析；这里仍做长度与空值约束。
router.post('/rooms/:roomCode/messages', roomAuth, requireRoom, function(req, res) {
  var id = userId(req), roomCode = req.params.roomCode;
  var member = db.prepare('SELECT user_id FROM gomoku_members WHERE room_code = ? AND user_id = ?').get(roomCode, id);
  if (!member) return res.status(403).json({ code: 403, message: '请先进入房间再发言' });
  var content = String((req.body && req.body.content) || '').trim();
  if (!content) return res.status(400).json({ code: 400, message: '请输入内容' });
  if (content.length > CHAT_MAX_LENGTH) {
    content = content.slice(0, CHAT_MAX_LENGTH);
    // 截断落在代理对中间会得到半个 emoji（渲染成替换字符），退一个码元
    if (/[\uD800-\uDBFF]$/.test(content)) content = content.slice(0, -1);
  }
  var result = db.prepare('INSERT INTO gomoku_messages (room_code, user_id, content) VALUES (?, ?, ?)').run(roomCode, id, content);
  var row = db.prepare('SELECT m.id, m.user_id, m.content, m.created_at, u.net_name FROM gomoku_messages m LEFT JOIN users u ON u.user_id = m.user_id WHERE m.id = ?').get(result.lastInsertRowid);
  var message = chatMessageView(row);
  notifyRoomMessage(roomCode, message);
  res.status(201).json({ code: 201, data: message });
});
router.post('/rooms/:roomCode/join', roomAuth, requireRoom, function(req, res) { join(req.params.roomCode, userId(req)); var result = stateFor(req.params.roomCode, ensureGame(req.params.roomCode, req.gomokuRoom.size)); notifyRoom(req.params.roomCode, result); res.json({ code: 200, data: result }); });
router.post('/rooms/:roomCode/watch', roomAuth, requireRoom, function(req, res) { var member = join(req.params.roomCode, userId(req)); if (member.color) db.prepare('UPDATE gomoku_members SET role = \'spectator\', color = NULL WHERE room_code = ? AND user_id = ?').run(req.params.roomCode, userId(req)); res.json({ code: 200, data: stateFor(req.params.roomCode, ensureGame(req.params.roomCode, req.gomokuRoom.size)) }); });
// 观战递补：退出的玩家（有色）空出的颜色按加入顺序补位给最早的观战者，再广播，
// 否则对局会从「双人/等待」退化成单色孤立，留下的观战者永远无法上场。
router.post('/rooms/:roomCode/leave', roomAuth, requireRoom, function(req, res) {
  var id = userId(req);
  var member = db.prepare('SELECT * FROM gomoku_members WHERE room_code = ? AND user_id = ?').get(req.params.roomCode, id);
  if (!member) return res.status(404).json({ code: 404, message: '不在房间中' });
  var roomCode = req.params.roomCode;
  db.prepare('DELETE FROM gomoku_members WHERE room_code = ? AND user_id = ?').run(roomCode, id);
  if (member.role === 'owner') {
    var next = db.prepare('SELECT user_id FROM gomoku_members WHERE room_code = ? ORDER BY joined_at LIMIT 1').get(roomCode);
    if (next) db.prepare('UPDATE gomoku_rooms SET owner_id = ? WHERE room_code = ?').run(next.user_id, roomCode);
  }
  // 玩家退出 → 把其颜色让给最早加入的观战者（自觉不参与，不强制别人的对局开局）
  if (member.color) {
    var promoted = db.prepare('SELECT user_id FROM gomoku_members WHERE room_code = ? AND color IS NULL AND role = \'spectator\' ORDER BY joined_at LIMIT 1').get(roomCode);
    if (promoted) db.prepare('UPDATE gomoku_members SET color = ?, role = \'player\' WHERE room_code = ? AND user_id = ?').run(member.color, roomCode, promoted.user_id);
  }
  // 房间空置（最后一人离开）即清空聊天记录：成员都走光了，记录再留着既无人可读，
  // 又会在同一房间码被重新加入时把上一批人的对话铺出来。关房路径见 /close。
  var remaining = db.prepare('SELECT COUNT(*) AS c FROM gomoku_members WHERE room_code = ?').get(roomCode).c;
  if (!remaining) purgeRoomMessages(roomCode);
  var room = db.prepare('SELECT * FROM gomoku_rooms WHERE room_code = ?').get(roomCode);
  if (room) notifyRoom(roomCode, stateFor(roomCode, ensureGame(roomCode, room.size)));
  res.json({ code: 200, data: { roomCode: roomCode } });
});
router.post('/rooms/:roomCode/close', roomAuth, requireRoom, function(req, res) { if (req.gomokuRoom.owner_id !== userId(req)) return res.status(403).json({ code: 403, message: '只有房主可以关闭房间' }); db.prepare('UPDATE gomoku_rooms SET status = \'closed\', updated_at = datetime(\'now\') WHERE room_code = ?').run(req.params.roomCode); purgeRoomMessages(req.params.roomCode); // 关房即销毁聊天记录；跨班：目录下线
directoryDelete(req.params.roomCode); if (RELAY_ACTIVE) relayBus.relayOnly('gomoku_room_directory_remove', { room_code: req.params.roomCode }); res.json({ code: 200, data: { roomCode: req.params.roomCode, status: 'closed' } }); });
// 对局结束后（有胜者或已 finished）currentGame() 返回 undefined，
// 直接取 game.id 会抛 TypeError 导致 500 —— 必须判空：无进行中对局时直接开新局。
router.post('/rooms/:roomCode/reset', roomAuth, requireRoom, function(req, res) { if (req.gomokuRoom.owner_id !== userId(req)) return res.status(403).json({ code: 403, message: '只有房主可以重开对局' }); var game = currentGame(req.params.roomCode); if (game) db.prepare('UPDATE gomoku_games SET status = \'finished\', ended_at = datetime(\'now\') WHERE id = ?').run(game.id); var result = stateFor(req.params.roomCode, ensureGame(req.params.roomCode, req.gomokuRoom.size)); notifyRoom(req.params.roomCode, result); res.json({ code: 200, data: result }); });
// 换色：与对手互换颜色；对手未加入时直接翻转自己颜色（空出的颜色留给后来者，join 按空色分配）。
// 已有落子（含等待态自由摆棋）一律禁止：换色后既有棋子的颜色归属会错乱。
router.post('/rooms/:roomCode/color', roomAuth, requireRoom, function(req, res) {
  var id = userId(req), roomCode = req.params.roomCode;
  var member = db.prepare('SELECT * FROM gomoku_members WHERE room_code = ? AND user_id = ?').get(roomCode, id);
  if (!member || !member.color) return res.status(403).json({ code: 403, message: '只有玩家可以换色' });
  var game = currentGame(roomCode);
  if (game && db.prepare('SELECT COUNT(*) AS c FROM gomoku_moves WHERE game_id = ?').get(game.id).c > 0) return res.status(409).json({ code: 409, message: '对局已有落子，不能换色' });
  // 与异色对手互换；旧实现误写成找同色玩家（同色恒不存在）→ 恒 409「没有可交换的玩家」
  var nextColor = member.color === 'black' ? 'white' : 'black';
  var other = db.prepare('SELECT * FROM gomoku_members WHERE room_code = ? AND color = ? AND user_id != ?').get(roomCode, nextColor, id);
  if (other) {
    db.prepare('UPDATE gomoku_members SET color = ? WHERE room_code = ? AND user_id = ?').run(nextColor, roomCode, id);
    db.prepare('UPDATE gomoku_members SET color = ? WHERE room_code = ? AND user_id = ?').run(member.color, roomCode, other.user_id);
  } else {
    db.prepare('UPDATE gomoku_members SET color = ? WHERE room_code = ? AND user_id = ?').run(nextColor, roomCode, id);
  }
  var result = stateFor(roomCode, ensureGame(roomCode, req.gomokuRoom.size));
  notifyRoom(roomCode, result);
  return res.json({ code: 200, data: result });
});
router.get('/rooms/:roomCode/history', requireRoom, function(req, res) { var games = db.prepare('SELECT id, size, turn, winner, status, started_at, ended_at FROM gomoku_games WHERE room_code = ? ORDER BY id DESC').all(req.params.roomCode); var moves = db.prepare('SELECT game_id as gameId, user_id as userId, color, row, col, created_at as createdAt FROM gomoku_moves WHERE game_id IN (SELECT id FROM gomoku_games WHERE room_code = ?) ORDER BY id').all(req.params.roomCode); res.json({ code: 200, data: { games: games, moves: moves } }); });
// 悔棋：撤销本局最后一手。双人对局只能悔「自己刚下的那一手」（即必须轮回自己）；
// 对手未加入时（单人摆棋）可悔任意最后一手。悔棋后该色重下。
router.post('/rooms/:roomCode/undo', roomAuth, requireRoom, function(req, res) {
  var id = userId(req), roomCode = req.params.roomCode;
  var member = db.prepare('SELECT * FROM gomoku_members WHERE room_code = ? AND user_id = ?').get(roomCode, id);
  if (!member || !member.color) return res.status(403).json({ code: 403, message: '只有玩家可以悔棋' });
  var game = currentGame(roomCode);
  if (!game || game.winner || game.status !== 'active') return res.status(409).json({ code: 409, message: '对局已结束，不能悔棋' });
  var last = db.prepare('SELECT * FROM gomoku_moves WHERE game_id = ? ORDER BY id DESC LIMIT 1').get(game.id);
  if (!last) return res.status(409).json({ code: 409, message: '还没有落子，无法悔棋' });
  var playerCount = db.prepare('SELECT COUNT(*) AS c FROM gomoku_members WHERE room_code = ? AND color IS NOT NULL').get(roomCode).c;
  if (playerCount >= 2 && String(last.user_id) !== String(id)) return res.status(409).json({ code: 409, message: '等对方落子后才能悔棋' });
  var state = JSON.parse(game.board);
  state[last.row][last.col] = null;
  db.prepare('UPDATE gomoku_games SET board = ?, turn = ?, winner = NULL WHERE id = ?').run(JSON.stringify(state), last.color, game.id);
  db.prepare('DELETE FROM gomoku_moves WHERE id = ?').run(last.id);
  return res.json({ code: 200, data: stateFor(roomCode, db.prepare('SELECT * FROM gomoku_games WHERE id = ?').get(game.id)) });
});
function move(req, res, roomCode, room) { var id = userId(req), game = ensureGame(roomCode, room.size), row = req.body && req.body.row, col = req.body && req.body.col, state = JSON.parse(game.board), member = db.prepare('SELECT * FROM gomoku_members WHERE room_code = ? AND user_id = ?').get(roomCode, id); if (!member) member = join(roomCode, id); if (!member.color) return res.status(403).json({ code: 403, message: '观战者不能落子' }); if (!validCoordinate(row, col, game.size)) return res.status(400).json({ code: 400, message: '坐标不合法' }); if (game.winner || game.status !== 'active') return res.status(409).json({ code: 409, message: '对局已结束', data: stateFor(roomCode, game) }); // 房间内只有一名玩家时放行轮次校验：对手未加入前可自由摆棋练习，turn 照常翻转，第二人加入后恢复严格轮流
 var playerCount = db.prepare('SELECT COUNT(*) AS c FROM gomoku_members WHERE room_code = ? AND color IS NOT NULL').get(roomCode).c; if (game.turn !== member.color && playerCount >= 2) return res.status(409).json({ code: 409, message: '尚未轮到该棋子' }); if (state[row][col]) return res.status(409).json({ code: 409, message: '该位置已有棋子', data: stateFor(roomCode, game) }); state[row][col] = member.color; var winner = hasWinner(state, row, col, member.color) ? member.color : null; var turn = winner ? member.color : member.color === 'black' ? 'white' : 'black'; db.prepare('UPDATE gomoku_games SET board = ?, turn = ?, winner = ?, status = ?, ended_at = CASE WHEN ? IS NULL THEN ended_at ELSE datetime(\'now\') END WHERE id = ?').run(JSON.stringify(state), turn, winner, winner ? 'finished' : 'active', winner, game.id); db.prepare('INSERT INTO gomoku_moves (game_id, user_id, color, row, col) VALUES (?, ?, ?, ?, ?)').run(game.id, id, member.color, row, col); return res.json({ code: 200, data: stateFor(roomCode, db.prepare('SELECT * FROM gomoku_games WHERE id = ?').get(game.id)) }); }
router.post('/rooms/:roomCode/move', roomAuth, requireRoom, function(req, res) { move(req, res, req.params.roomCode, req.gomokuRoom); });
router.get('/state', function(req, res) { var room = legacyRoom(req); res.json({ code: 200, data: stateFor(room.room_code, ensureGame(room.room_code, room.size)) }); });
router.post('/move', function(req, res) { var room = legacyRoom(req); move(req, res, room.room_code, room); });
router.post('/reset', function(req, res) { var room = legacyRoom(req); var game = currentGame(room.room_code); if (game) db.prepare('UPDATE gomoku_games SET status = \'finished\', ended_at = datetime(\'now\') WHERE id = ?').run(game.id); res.json({ code: 200, data: stateFor(room.room_code, ensureGame(room.room_code, room.size)) }); });
module.exports = router;
