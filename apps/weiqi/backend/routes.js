/*
 * 围棋（weiqi）—— 市场应用后端
 *
 * 职责：
 *   - 房间创建 / 加入 / 观战 / 离开 / 关闭 / 开新局
 *   - 服务端权威落子校验（规则核心与前端共用 core/go-core.js）
 *   - 停一手、认输、悔棋
 *   - 双方确认数子（死子标定、确认、继续对弈）
 *   - 房间快捷聊天
 *   - 跨班对局：房间目录 + 中继请求转发（与五子棋/象棋同构，单写者避免双机冲突）
 *
 * 数据表由本应用自建（市场应用契约允许），卸载时由 backend/cleanup.js 清理。
 * 所有房间状态以服务端为准：客户端发送意图，服务端回传完整状态。
 */
'use strict';

var express = require('express');
var http = require('http');
var crypto = require('crypto');
var path = require('path');
var router = express.Router();

var host = require('_sdk/backend/host');
var db = host.db;
var requireAuth = host.auth.requireAuth;
var realtimeBus = host.realtimeBus;
var relayBus = host.relayBus;
var config = host.config;

// 规则核心：前端 / 后端 / AI 共用同一份实现，保证联机判定与本地一致
var Core = require(path.join(__dirname, '..', 'core', 'go-core.js'));
var aiEngine = require('./engine');
// AI 请求构造 / 结果转换 / 逐手评级：与后台复盘 runner 共用（唯一实现，勿复制）
var Shared = require('./ai-shared');
var reviewRunner = require('./review-runner');

var NAME = 'weiqi';
var EVENT_CHANGED = 'weiqi.room.changed';
var EVENT_MESSAGE = 'weiqi.room.message';
var EVENT_CLOSED = 'weiqi.room.closed';
var DEFAULT_SIZE = 9;
var ALLOWED_SIZES = [9, 13, 19];
var ALLOWED_HANDICAPS = [0, 2, 3, 4, 5, 6, 7, 8, 9];
var DEFAULT_KOMI = 7.5;
var HANDICAP_KOMI = 0.5;
var CHAT_FETCH_LIMIT = 80;
var CHAT_MAX_LENGTH = 200;
var MAX_DEAD = 400;

// 跨班对局前提：配置了中继服务器且本机有服务器标识
var SELF_SERVER_ID = (config.relay && config.relay.serverId) || '';
var RELAY_SECRET = (config.relay && config.relay.secret) || '';
var RELAY_ACTIVE = !!((config.relay && config.relay.servers && config.relay.servers.length) && SELF_SERVER_ID);

// ============ 建表 ============
db.exec("CREATE TABLE IF NOT EXISTS weiqi_rooms (" +
  " room_code TEXT PRIMARY KEY," +
  " owner_id TEXT NOT NULL," +
  " size INTEGER NOT NULL DEFAULT 9," +
  " komi REAL NOT NULL DEFAULT 7.5," +
  " handicap INTEGER NOT NULL DEFAULT 0," +
  " rules TEXT NOT NULL DEFAULT 'chinese'," +
  " status TEXT NOT NULL DEFAULT 'open'," +
  " rev INTEGER NOT NULL DEFAULT 1," +
  " created_at TEXT DEFAULT (datetime('now'))," +
  " updated_at TEXT DEFAULT (datetime('now'))" +
  ")");
db.exec("CREATE TABLE IF NOT EXISTS weiqi_members (" +
  " room_code TEXT NOT NULL," +
  " user_id TEXT NOT NULL," +
  " role TEXT NOT NULL DEFAULT 'player'," +
  " color TEXT," +
  " confirmed_game_id INTEGER NOT NULL DEFAULT 0," +
  " joined_at TEXT DEFAULT (datetime('now'))," +
  " last_seen_at TEXT DEFAULT (datetime('now'))," +
  " PRIMARY KEY (room_code, user_id)" +
  ")");
db.exec("CREATE TABLE IF NOT EXISTS weiqi_games (" +
  " id INTEGER PRIMARY KEY AUTOINCREMENT," +
  " room_code TEXT NOT NULL," +
  " size INTEGER NOT NULL," +
  " komi REAL NOT NULL," +
  " handicap INTEGER NOT NULL DEFAULT 0," +
  " rules TEXT NOT NULL DEFAULT 'chinese'," +
  " status TEXT NOT NULL DEFAULT 'active'," +
  " turn TEXT NOT NULL DEFAULT 'black'," +
  " pass_count INTEGER NOT NULL DEFAULT 0," +
  " dead_stones TEXT NOT NULL DEFAULT '[]'," +
  " winner TEXT," +
  " result_text TEXT," +
  " result_code TEXT," +
  " started_at TEXT DEFAULT (datetime('now'))," +
  " ended_at TEXT" +
  ")");
db.exec("CREATE TABLE IF NOT EXISTS weiqi_moves (" +
  " id INTEGER PRIMARY KEY AUTOINCREMENT," +
  " game_id INTEGER NOT NULL," +
  " user_id TEXT NOT NULL," +
  " color TEXT NOT NULL," +
  " row INTEGER NOT NULL," +
  " col INTEGER NOT NULL," +
  " is_pass INTEGER NOT NULL DEFAULT 0," +
  " created_at TEXT DEFAULT (datetime('now'))" +
  ")");
db.exec("CREATE TABLE IF NOT EXISTS weiqi_messages (" +
  " id INTEGER PRIMARY KEY AUTOINCREMENT," +
  " room_code TEXT NOT NULL," +
  " user_id TEXT NOT NULL," +
  " content TEXT NOT NULL," +
  " created_at TEXT DEFAULT (datetime('now'))" +
  ")");
db.exec("CREATE TABLE IF NOT EXISTS weiqi_room_directory (" +
  " room_code TEXT PRIMARY KEY," +
  " server_id TEXT NOT NULL," +
  " size INTEGER," +
  " updated_at TEXT DEFAULT (datetime('now'))" +
  ")");
db.exec("CREATE INDEX IF NOT EXISTS idx_weiqi_games_room ON weiqi_games(room_code)");
db.exec("CREATE INDEX IF NOT EXISTS idx_weiqi_moves_game ON weiqi_moves(game_id)");
db.exec("CREATE INDEX IF NOT EXISTS idx_weiqi_messages_room ON weiqi_messages(room_code, id)");

// ============ 基础工具 ============
function userId(req) {
  return String((req.user && (req.user.user_id || req.user.id)) || 'guest');
}

function colorCode(value) {
  if (value === 1 || value === 'black' || value === 'B' || value === 'b') return 1;
  if (value === 2 || value === 'white' || value === 'W' || value === 'w') return 2;
  return 0;
}

function colorName(code) {
  return code === 1 ? 'black' : code === 2 ? 'white' : null;
}

function colorLabel(code) {
  return code === 1 ? '黑' : code === 2 ? '白' : '';
}

function otherColorName(name) {
  return name === 'black' ? 'white' : 'black';
}

function isValidSize(size) {
  return ALLOWED_SIZES.indexOf(Number(size)) !== -1;
}

function normalizeHandicap(value) {
  var n = Number(value) || 0;
  if (ALLOWED_HANDICAPS.indexOf(n) === -1) return -1;
  return n;
}

function validRoomCode(code) {
  return /^\d{4,6}$/.test(String(code || ''));
}

function makeCode() {
  return String(crypto.randomBytes(2).readUInt16BE(0) % 10000).padStart(4, '0');
}

function roomRow(roomCode) {
  return db.prepare('SELECT * FROM weiqi_rooms WHERE room_code = ?').get(roomCode);
}

function memberRow(roomCode, id) {
  return db.prepare('SELECT * FROM weiqi_members WHERE room_code = ? AND user_id = ?').get(roomCode, id);
}

function membersOf(roomCode) {
  return db.prepare(
    'SELECT m.user_id, m.role, m.color, m.confirmed_game_id, m.joined_at, m.last_seen_at, u.net_name ' +
    'FROM weiqi_members m LEFT JOIN users u ON u.user_id = m.user_id ' +
    'WHERE m.room_code = ? ORDER BY m.joined_at, m.user_id'
  ).all(roomCode);
}

function playersOf(roomCode) {
  return db.prepare("SELECT user_id, color FROM weiqi_members WHERE room_code = ? AND color IS NOT NULL").all(roomCode);
}

function currentGame(roomCode) {
  return db.prepare("SELECT * FROM weiqi_games WHERE room_code = ? AND status IN ('active','scoring') ORDER BY id DESC LIMIT 1").get(roomCode);
}

function latestGame(roomCode) {
  return db.prepare('SELECT * FROM weiqi_games WHERE room_code = ? ORDER BY id DESC LIMIT 1').get(roomCode);
}

function createGame(room) {
  var turn = room.handicap > 1 ? 'white' : 'black';
  var result = db.prepare(
    "INSERT INTO weiqi_games (room_code, size, komi, handicap, rules, turn, status) VALUES (?, ?, ?, ?, ?, ?, 'active')"
  ).run(room.room_code, room.size, room.komi, room.handicap, room.rules, turn);
  return db.prepare('SELECT * FROM weiqi_games WHERE id = ?').get(result.lastInsertRowid);
}

function ensureGame(room) {
  var game = currentGame(room.room_code);
  if (game) return game;
  return createGame(room);
}

function gameMoves(gameId) {
  return db.prepare('SELECT id, user_id, color, row, col, is_pass, created_at FROM weiqi_moves WHERE game_id = ? ORDER BY id').all(gameId);
}

function moveListForClient(rows) {
  var out = [];
  for (var i = 0; i < rows.length; i++) {
    var row = rows[i];
    out.push({
      color: colorCode(row.color),
      row: row.is_pass ? -1 : Number(row.row),
      col: row.is_pass ? -1 : Number(row.col),
      pass: !!row.is_pass
    });
  }
  return out;
}

// 从着法重建局面；status 以数据库为准（支持「数子后继续对弈」时 pass_count 归零）。
function replayGame(game) {
  var state = Core.createState({
    size: game.size,
    komi: game.komi,
    handicap: game.handicap,
    rules: game.rules || 'chinese'
  });
  var rows = gameMoves(game.id);
  for (var i = 0; i < rows.length; i++) {
    var row = rows[i];
    var color = colorCode(row.color);
    var result;
    if (row.is_pass) {
      result = Core.applyPass(state, color, { ignoreTurn: true, ignoreStatus: true, ignoreEnd: true });
    } else {
      result = Core.applyMove(state, color, Number(row.row), Number(row.col), {
        ignoreTurn: true,
        ignoreStatus: true,
        ignoreEnd: true
      });
    }
    if (!result.ok) break;
  }
  state.status = game.status;
  state.passCount = Number(game.pass_count) || 0;
  state.winner = colorCode(game.winner);
  state.resultText = game.result_text || '';
  state.resultCode = game.result_code || '';
  if (game.status === 'active') {
    // 数据库中的 turn 是权威值（悔棋/恢复后可能与纯重放不同）
    var dbTurn = colorCode(game.turn);
    if (dbTurn) state.turn = dbTurn;
  }
  return { state: state, moves: rows };
}

function deadList(game) {
  try {
    var parsed = JSON.parse(game.dead_stones || '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed.map(Number).filter(function (v) { return isFinite(v); });
  } catch (e) {
    return [];
  }
}

function stateFor(roomCode, room) {
  var game = currentGame(roomCode) || latestGame(roomCode) || createGame(room);
  var replayed = replayGame(game);
  var state = replayed.state;
  var members = membersOf(roomCode);
  var dead = deadList(game);
  var preview = null;
  var isResignation = game.result_code && String(game.result_code).indexOf('+R') !== -1;
  if ((game.status === 'scoring' || game.status === 'finished') && !isResignation) {
    try {
      preview = Core.computeScore(state, dead);
    } catch (e) {
      preview = null;
    }
  }
  var confirmed = [];
  for (var i = 0; i < members.length; i++) {
    if (members[i].color && Number(members[i].confirmed_game_id) === Number(game.id)) {
      confirmed.push(String(members[i].user_id));
    }
  }
  var lastMove = null;
  var moves = replayed.moves;
  for (var j = moves.length - 1; j >= 0; j--) {
    if (!moves[j].is_pass) {
      lastMove = {
        row: Number(moves[j].row),
        col: Number(moves[j].col),
        color: colorCode(moves[j].color)
      };
      break;
    }
  }
  return {
    roomCode: room.room_code,
    ownerId: String(room.owner_id),
    size: Number(game.size),
    komi: Number(game.komi),
    handicap: Number(game.handicap),
    rules: game.rules || 'chinese',
    status: game.status,
    turn: state.turn,
    winner: colorCode(game.winner),
    resultText: game.result_text || '',
    resultCode: game.result_code || '',
    passes: Number(game.pass_count) || 0,
    moves: moveListForClient(moves),
    moveCount: moves.length,
    captures: { black: state.captures[1], white: state.captures[2] },
    members: members.map(function (m) {
      return {
        userId: String(m.user_id),
        role: m.role,
        color: colorCode(m.color),
        net_name: m.net_name || null,
        netName: m.net_name || null,
        confirmed: Number(m.confirmed_game_id) === Number(game.id)
      };
    }),
    deadStones: dead,
    confirmed: confirmed,
    preview: preview ? {
      black: preview.black,
      white: preview.white,
      diff: preview.diff,
      winner: preview.winner,
      resultText: preview.resultText,
      resultCode: preview.resultCode,
      blackStones: preview.blackStones,
      whiteStones: preview.whiteStones,
      blackTerritory: preview.blackTerritory,
      whiteTerritory: preview.whiteTerritory
    } : null,
    lastMove: lastMove,
    gameId: game.id,
    rev: Number(room.rev) || 0,
    startedAt: game.started_at,
    updatedAt: room.updated_at
  };
}

// ============ 通知 ============
function notifyRoom(roomCode, state) {
  var members = membersOf(roomCode);
  var ids = [];
  for (var i = 0; i < members.length; i++) ids.push(String(members[i].user_id));
  if (!ids.length) return;
  try {
    realtimeBus.publishToUsers(ids, {
      type: 'extension_event',
      app_name: NAME,
      event: EVENT_CHANGED,
      payload: { roomCode: roomCode, state: state },
      created_at: new Date().toISOString()
    });
  } catch (e) {}
  if (RELAY_ACTIVE) {
    try {
      relayBus.relayOnly('weiqi_room_event', { room_code: roomCode, member_ids: ids, state: state });
    } catch (e) {}
  }
}

function notifyClosed(roomCode) {
  var members = membersOf(roomCode);
  var ids = [];
  for (var i = 0; i < members.length; i++) ids.push(String(members[i].user_id));
  if (!ids.length) return;
  try {
    realtimeBus.publishToUsers(ids, {
      type: 'extension_event',
      app_name: NAME,
      event: EVENT_CLOSED,
      payload: { roomCode: roomCode },
      created_at: new Date().toISOString()
    });
  } catch (e) {}
  if (RELAY_ACTIVE) {
    try {
      relayBus.relayOnly('weiqi_room_closed', { room_code: roomCode, member_ids: ids });
    } catch (e) {}
  }
}

function chatMessageView(row) {
  return {
    id: row.id,
    userId: String(row.user_id),
    netName: row.net_name || null,
    content: row.content
  };
}

function notifyRoomMessage(roomCode, message) {
  var members = membersOf(roomCode);
  var ids = [];
  for (var i = 0; i < members.length; i++) ids.push(String(members[i].user_id));
  if (!ids.length) return;
  try {
    realtimeBus.publishToUsers(ids, {
      type: 'extension_event',
      app_name: NAME,
      event: EVENT_MESSAGE,
      payload: { roomCode: roomCode, message: message },
      created_at: new Date().toISOString()
    });
  } catch (e) {}
  if (RELAY_ACTIVE) {
    try {
      relayBus.relayOnly('weiqi_room_message', { room_code: roomCode, member_ids: ids, message: message });
    } catch (e) {}
  }
}

function purgeRoomMessages(roomCode) {
  try {
    db.prepare('DELETE FROM weiqi_messages WHERE room_code = ?').run(roomCode);
  } catch (e) {}
}

function sendState(res, roomCode, room, statusCode, notify) {
  if (notify) {
    // 每次成功的状态变更递增 rev：客户端据此丢弃迟到的轮询响应，
    // 避免「落子响应已应用 → 更早发出的轮询返回旧局面」把棋盘覆盖回去。
    try {
      db.prepare("UPDATE weiqi_rooms SET rev = rev + 1, updated_at = datetime('now') WHERE room_code = ?").run(roomCode);
      var freshRoom = roomRow(roomCode);
      if (freshRoom) room = freshRoom;
    } catch (e) {}
  }
  var data;
  try {
    data = stateFor(roomCode, room);
  } catch (e) {
    return res.status(500).json({ code: 500, message: '房间状态读取失败' });
  }
  if (notify) notifyRoom(roomCode, data);
  return res.status(statusCode || 200).json({ code: statusCode || 200, data: data });
}

function fail(res, status, message, data) {
  var body = { code: status, message: message };
  if (data) body.data = data;
  return res.status(status).json(body);
}

// ============ 跨班目录与中继 ============
function directoryGet(roomCode) {
  try {
    return db.prepare('SELECT room_code, server_id, size FROM weiqi_room_directory WHERE room_code = ?').get(roomCode);
  } catch (e) { return null; }
}
function directorySet(roomCode, serverId, size) {
  try {
    db.prepare("INSERT OR REPLACE INTO weiqi_room_directory (room_code, server_id, size, updated_at) VALUES (?, ?, ?, datetime('now'))").run(roomCode, serverId, size || null);
  } catch (e) {}
}
function directoryDelete(roomCode) {
  try { db.prepare('DELETE FROM weiqi_room_directory WHERE room_code = ?').run(roomCode); } catch (e) {}
}

relayBus.register('weiqi_room_directory_sync', function (payload) {
  if (payload && payload.room_code && payload.server_id) directorySet(payload.room_code, payload.server_id, payload.size);
});
relayBus.register('weiqi_room_directory_remove', function (payload) {
  if (payload && payload.room_code) directoryDelete(payload.room_code);
});
relayBus.register('weiqi_room_event', function (payload) {
  if (!payload || !payload.room_code || !payload.state) return;
  var ids = Array.isArray(payload.member_ids) ? payload.member_ids : [];
  var targets = [];
  for (var i = 0; i < ids.length; i++) {
    if (realtimeBus.isRegistered(ids[i])) targets.push(ids[i]);
  }
  if (!targets.length) return;
  try {
    realtimeBus.publishToUsers(targets, {
      type: 'extension_event',
      app_name: NAME,
      event: EVENT_CHANGED,
      payload: { roomCode: payload.room_code, state: payload.state },
      created_at: new Date().toISOString()
    });
  } catch (e) {}
});
relayBus.register('weiqi_room_message', function (payload) {
  if (!payload || !payload.room_code || !payload.message) return;
  var ids = Array.isArray(payload.member_ids) ? payload.member_ids : [];
  var targets = [];
  for (var i = 0; i < ids.length; i++) {
    if (realtimeBus.isRegistered(ids[i])) targets.push(ids[i]);
  }
  if (!targets.length) return;
  try {
    realtimeBus.publishToUsers(targets, {
      type: 'extension_event',
      app_name: NAME,
      event: EVENT_MESSAGE,
      payload: { roomCode: payload.room_code, message: payload.message },
      created_at: new Date().toISOString()
    });
  } catch (e) {}
});
relayBus.register('weiqi_room_closed', function (payload) {
  if (!payload || !payload.room_code) return;
  var ids = Array.isArray(payload.member_ids) ? payload.member_ids : [];
  var targets = [];
  for (var i = 0; i < ids.length; i++) {
    if (realtimeBus.isRegistered(ids[i])) targets.push(ids[i]);
  }
  if (!targets.length) return;
  try {
    realtimeBus.publishToUsers(targets, {
      type: 'extension_event',
      app_name: NAME,
      event: EVENT_CLOSED,
      payload: { roomCode: payload.room_code },
      created_at: new Date().toISOString()
    });
  } catch (e) {}
});

// ===== 跨班请求转发（经中继 WS 通道，零配置）=====
var pendingForwards = {};
relayBus.register('weiqi_room_response', function (payload) {
  if (!payload || !payload.req_id) return;
  var entry = pendingForwards[payload.req_id];
  if (!entry) return;
  delete pendingForwards[payload.req_id];
  clearTimeout(entry.timer);
  entry.resolve(payload);
});
relayBus.register('weiqi_room_request', function (payload) {
  if (!payload || !payload.req_id || !payload.path || !payload.user_id) return;
  var hasBody = payload.method !== 'GET' && payload.method !== 'HEAD';
  var body = hasBody ? JSON.stringify(payload.body || {}) : null;
  var options = {
    hostname: '127.0.0.1',
    port: config.port || 9001,
    path: payload.path,
    method: payload.method || 'GET',
    headers: {
      'X-Relay-Secret': RELAY_SECRET,
      'X-Weiqi-User': payload.user_id
    }
  };
  if (body) {
    options.headers['Content-Type'] = 'application/json';
    options.headers['Content-Length'] = Buffer.byteLength(body);
  }
  var upstream = http.request(options, function (upRes) {
    var chunks = [];
    upRes.on('data', function (chunk) { chunks.push(chunk); });
    upRes.on('end', function () {
      var parsed = null;
      try { parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch (e) {}
      if (RELAY_ACTIVE) {
        try {
          relayBus.relayOnly('weiqi_room_response', { req_id: payload.req_id, status: upRes.statusCode, body: parsed });
        } catch (e) {}
      }
    });
  });
  upstream.setTimeout(6000, function () { upstream.destroy(new Error('timeout')); });
  upstream.on('error', function () {
    if (RELAY_ACTIVE) {
      try {
        relayBus.relayOnly('weiqi_room_response', { req_id: payload.req_id, status: 502, body: { code: 502, message: '家服务器处理失败' } });
      } catch (e) {}
    }
  });
  if (body) upstream.write(body);
  upstream.end();
});

function forwardRoomRequest(req, res) {
  if (!RELAY_ACTIVE) return fail(res, 502, '跨班对局不可用：本机未配置中继服务器');
  var reqId = crypto.randomBytes(8).toString('hex');
  var done = false;
  var timer = setTimeout(function () {
    if (done) return;
    done = true;
    delete pendingForwards[reqId];
    fail(res, 502, '跨班对局不可用：对方服务器无响应（可能离线）');
  }, 8000);
  pendingForwards[reqId] = {
    timer: timer,
    resolve: function (reply) {
      if (done) return;
      done = true;
      if (reply.status === 404) directoryDelete(req.params.roomCode);
      res.status(reply.status || 502);
      if (reply.body) return res.json(reply.body);
      return fail(res, 502, '跨班对局响应异常');
    }
  };
  try {
    relayBus.relayOnly('weiqi_room_request', {
      req_id: reqId,
      method: req.method,
      path: '/api/weiqi' + req.path,
      body: (req.method === 'GET' || req.method === 'HEAD') ? null : (req.body || {}),
      user_id: userId(req)
    });
  } catch (e) {
    clearTimeout(timer);
    delete pendingForwards[reqId];
    return fail(res, 502, '跨班对局请求发送失败');
  }
}

// ============ 中间件 ============
function roomAuth(req, res, next) {
  var secret = req.get('X-Relay-Secret') || '';
  var forwardUser = req.get('X-Weiqi-User') || '';
  if (RELAY_SECRET && secret && secret === RELAY_SECRET && /^[A-Za-z0-9_-]{1,64}$/.test(forwardUser)) {
    req.user = { user_id: forwardUser };
    req.fromRelay = true;
    return next();
  }
  return requireAuth(req, res, next);
}

function requireRoom(req, res, next) {
  var roomCode = String(req.params.roomCode || '');
  if (!validRoomCode(roomCode)) return fail(res, 400, '房间码不合法');
  var room = roomRow(roomCode);
  if (room && room.status !== 'closed') {
    req.weiqiRoom = room;
    return next();
  }
  var entry = directoryGet(roomCode);
  if (entry && entry.server_id && entry.server_id !== SELF_SERVER_ID && RELAY_ACTIVE && !req.fromRelay) {
    req.weiqiForwarding = true;
    return forwardRoomRequest(req, res);
  }
  if (entry) directoryDelete(roomCode);
  return fail(res, 404, '房间不存在或已关闭');
}

var lastActionAt = {};
function throttle(user, roomCode) {
  var now = Date.now();
  var key = String(user) + ':' + roomCode;
  if (lastActionAt[key] && now - lastActionAt[key] < 80) return true;
  lastActionAt[key] = now;
  return false;
}

// ============ 房间接口 ============
function purgeStaleRooms() {
  try {
    db.prepare(
      "DELETE FROM weiqi_rooms WHERE status = 'open' AND updated_at < datetime('now', '-24 hours') " +
      "AND NOT EXISTS (SELECT 1 FROM weiqi_members m WHERE m.room_code = weiqi_rooms.room_code)"
    ).run();
    db.prepare("DELETE FROM weiqi_rooms WHERE status = 'closed' AND updated_at < datetime('now', '-24 hours')").run();
    db.prepare('DELETE FROM weiqi_members WHERE room_code NOT IN (SELECT room_code FROM weiqi_rooms)').run();
    db.prepare('DELETE FROM weiqi_moves WHERE game_id NOT IN (SELECT id FROM weiqi_games)').run();
    db.prepare('DELETE FROM weiqi_games WHERE room_code NOT IN (SELECT room_code FROM weiqi_rooms)').run();
    db.prepare('DELETE FROM weiqi_messages WHERE room_code NOT IN (SELECT room_code FROM weiqi_rooms)').run();
    db.prepare('DELETE FROM weiqi_room_directory WHERE room_code NOT IN (SELECT room_code FROM weiqi_rooms)').run();
    reviewRunner.prune();
  } catch (e) {}
}

function createRoom(req, res) {
  purgeStaleRooms();
  var body = req.body || {};
  var size = Number(body.size === undefined ? DEFAULT_SIZE : body.size);
  if (!isValidSize(size)) return fail(res, 400, '棋盘规格只能是 9、13 或 19 路');
  var handicap = normalizeHandicap(body.handicap);
  if (handicap === -1) return fail(res, 400, '让子数只能是 0、2-9');
  var color = String(body.color || '').toLowerCase() === 'white' ? 'white' : 'black';
  var komi = handicap > 0 ? HANDICAP_KOMI : DEFAULT_KOMI;
  var code;
  var guard = 0;
  do {
    code = makeCode();
    guard += 1;
  } while ((roomRow(code) || directoryGet(code)) && guard < 200);
  if (roomRow(code)) return fail(res, 500, '房间码生成失败，请重试');

  var owner = userId(req);
  try {
    var createTx = db.transaction(function () {
      db.prepare('INSERT INTO weiqi_rooms (room_code, owner_id, size, komi, handicap, rules) VALUES (?, ?, ?, ?, ?, ?)')
        .run(code, owner, size, komi, handicap, 'chinese');
      db.prepare('INSERT INTO weiqi_members (room_code, user_id, role, color) VALUES (?, ?, ?, ?)')
        .run(code, owner, 'owner', color);
      createGame(roomRow(code));
    });
    createTx();
  } catch (e) {
    console.error('[weiqi] create room failed:', e && e.stack ? e.stack : e);
    return fail(res, 500, '创建房间失败，请稍后重试');
  }
  var room = roomRow(code);
  directorySet(code, SELF_SERVER_ID, size);
  if (RELAY_ACTIVE) {
    try {
      relayBus.relayOnly('weiqi_room_directory_sync', { room_code: code, server_id: SELF_SERVER_ID, size: size });
    } catch (e) {}
  }
  // 宿主 SDK 只把 code === 200 视为成功，这里必须返回 200（不能用 201），
  // 否则房间已经建好，前端却会显示「请求失败」。
  return sendState(res, code, room, 200, true);
}

function joinRoom(req, res) {
  var code = req.params.roomCode;
  var id = userId(req);
  var existing = memberRow(code, id);
  if (existing) {
    db.prepare("UPDATE weiqi_members SET last_seen_at = datetime('now') WHERE room_code = ? AND user_id = ?").run(code, id);
    return sendState(res, code, req.weiqiRoom, 200, false);
  }
  var colors = playersOf(code).map(function (m) { return m.color; });
  var color = null;
  if (colors.indexOf('black') === -1) color = 'black';
  else if (colors.indexOf('white') === -1) color = 'white';
  db.prepare('INSERT INTO weiqi_members (room_code, user_id, role, color) VALUES (?, ?, ?, ?)')
    .run(code, id, color ? 'player' : 'spectator', color);
  db.prepare("UPDATE weiqi_rooms SET updated_at = datetime('now') WHERE room_code = ?").run(code);
  return sendState(res, code, req.weiqiRoom, 200, true);
}

function watchRoom(req, res) {
  var code = req.params.roomCode;
  var id = userId(req);
  var existing = memberRow(code, id);
  if (!existing) {
    db.prepare("INSERT INTO weiqi_members (room_code, user_id, role, color) VALUES (?, ?, 'spectator', NULL)").run(code, id);
    db.prepare("UPDATE weiqi_rooms SET updated_at = datetime('now') WHERE room_code = ?").run(code);
    return sendState(res, code, req.weiqiRoom, 200, true);
  }
  db.prepare("UPDATE weiqi_members SET last_seen_at = datetime('now') WHERE room_code = ? AND user_id = ?").run(code, id);
  return sendState(res, code, req.weiqiRoom, 200, false);
}

function leaveRoom(req, res) {
  var code = req.params.roomCode;
  var id = userId(req);
  var member = memberRow(code, id);
  if (!member) return fail(res, 404, '不在房间中');
  db.prepare('DELETE FROM weiqi_members WHERE room_code = ? AND user_id = ?').run(code, id);

  // 房主离开：把房主转给最早加入的成员
  var room = req.weiqiRoom;
  if (room && String(room.owner_id) === String(id)) {
    var next = db.prepare('SELECT user_id FROM weiqi_members WHERE room_code = ? ORDER BY joined_at, user_id LIMIT 1').get(code);
    if (next) {
      db.prepare('UPDATE weiqi_rooms SET owner_id = ? WHERE room_code = ?').run(next.user_id, code);
      room = roomRow(code);
    }
  }
  // 玩家离开：把颜色让给最早的观战者（若对局尚未结束，保持可继续）
  if (member.color) {
    var promoted = db.prepare("SELECT user_id FROM weiqi_members WHERE room_code = ? AND color IS NULL ORDER BY joined_at, user_id LIMIT 1").get(code);
    if (promoted) {
      db.prepare("UPDATE weiqi_members SET color = ?, role = 'player' WHERE room_code = ? AND user_id = ?")
        .run(member.color, code, promoted.user_id);
    }
  }
  var remaining = db.prepare('SELECT COUNT(*) AS c FROM weiqi_members WHERE room_code = ?').get(code).c;
  if (!remaining) purgeRoomMessages(code);
  db.prepare("UPDATE weiqi_rooms SET updated_at = datetime('now') WHERE room_code = ?").run(code);
  var fresh = roomRow(code);
  if (fresh) sendState(res, code, fresh, 200, true);
  else return res.json({ code: 200, data: { roomCode: code } });
}

function closeRoom(req, res) {
  var code = req.params.roomCode;
  var room = req.weiqiRoom;
  if (String(room.owner_id) !== String(userId(req))) return fail(res, 403, '只有房主可以关闭房间');
  notifyClosed(code);
  db.prepare("UPDATE weiqi_rooms SET status = 'closed', updated_at = datetime('now') WHERE room_code = ?").run(code);
  purgeRoomMessages(code);
  directoryDelete(code);
  if (RELAY_ACTIVE) {
    try { relayBus.relayOnly('weiqi_room_directory_remove', { room_code: code }); } catch (e) {}
  }
  return res.json({ code: 200, data: { roomCode: code, status: 'closed' } });
}

function resetGame(req, res) {
  var code = req.params.roomCode;
  var room = req.weiqiRoom;
  if (String(room.owner_id) !== String(userId(req))) return fail(res, 403, '只有房主可以开新局');
  var game = currentGame(code);
  if (game) {
    db.prepare("UPDATE weiqi_games SET status = 'finished', ended_at = datetime('now') WHERE id = ? AND status != 'finished'").run(game.id);
  }
  createGame(room);
  db.prepare('UPDATE weiqi_members SET confirmed_game_id = 0 WHERE room_code = ?').run(code);
  db.prepare("UPDATE weiqi_rooms SET updated_at = datetime('now') WHERE room_code = ?").run(code);
  return sendState(res, code, roomRow(code), 200, true);
}

function moveHandler(req, res) {
  var code = req.params.roomCode;
  var room = req.weiqiRoom;
  var id = userId(req);
  if (throttle(id, code)) return fail(res, 429, '落子太快，请稍候');
  var member = memberRow(code, id);
  if (!member || !member.color) return fail(res, 403, '观战者不能落子');
  var game = currentGame(code);
  if (!game) return fail(res, 409, '对局已结束，请房主开新局');
  if (game.status !== 'active') return fail(res, 409, '当前不在对局中');
  var players = playersOf(code);
  if (players.length < 2) return fail(res, 409, '等待对手加入');
  var replayed = replayGame(game);
  var color = colorCode(member.color);
  if (replayed.state.turn !== color) return fail(res, 409, '还没轮到你落子');
  var row = Number(req.body && req.body.row);
  var col = Number(req.body && req.body.col);
  if (!isFinite(row) || !isFinite(col) || row < 0 || col < 0 || row >= game.size || col >= game.size || row % 1 !== 0 || col % 1 !== 0) {
    return fail(res, 400, '坐标不合法');
  }
  var result = Core.applyMove(replayed.state, color, row, col, { ignoreEnd: true });
  if (!result.ok) return fail(res, 409, result.error || '落子不合法');
  db.prepare(
    "INSERT INTO weiqi_moves (game_id, user_id, color, row, col, is_pass) VALUES (?, ?, ?, ?, ?, 0)"
  ).run(game.id, id, colorName(color), row, col);
  var nextTurn = colorName(replayed.state.turn);
  db.prepare("UPDATE weiqi_games SET turn = ?, pass_count = 0, status = 'active' WHERE id = ?").run(nextTurn, game.id);
  db.prepare("UPDATE weiqi_rooms SET updated_at = datetime('now') WHERE room_code = ?").run(code);
  return sendState(res, code, roomRow(code), 200, true);
}

function passHandler(req, res) {
  var code = req.params.roomCode;
  var room = req.weiqiRoom;
  var id = userId(req);
  if (throttle(id, code)) return fail(res, 429, '操作太快，请稍候');
  var member = memberRow(code, id);
  if (!member || !member.color) return fail(res, 403, '观战者不能停一手');
  var game = currentGame(code);
  if (!game) return fail(res, 409, '对局已结束，请房主开新局');
  if (game.status !== 'active') return fail(res, 409, '当前不在对局中');
  var players = playersOf(code);
  if (players.length < 2) return fail(res, 409, '等待对手加入');
  var replayed = replayGame(game);
  var color = colorCode(member.color);
  if (replayed.state.turn !== color) return fail(res, 409, '还没轮到你');
  var result = Core.applyPass(replayed.state, color, { ignoreEnd: true });
  if (!result.ok) return fail(res, 409, result.error || '停一手失败');
  var passCount = (Number(game.pass_count) || 0) + 1;
  var status = passCount >= 2 ? 'scoring' : 'active';
  db.prepare("INSERT INTO weiqi_moves (game_id, user_id, color, row, col, is_pass) VALUES (?, ?, ?, -1, -1, 1)")
    .run(game.id, id, colorName(color));
  db.prepare("UPDATE weiqi_games SET turn = ?, pass_count = ?, status = ?, dead_stones = '[]' WHERE id = ?")
    .run(colorName(replayed.state.turn), passCount, status, game.id);
  if (status === 'scoring') {
    db.prepare('UPDATE weiqi_members SET confirmed_game_id = 0 WHERE room_code = ?').run(code);
  }
  db.prepare("UPDATE weiqi_rooms SET updated_at = datetime('now') WHERE room_code = ?").run(code);
  return sendState(res, code, roomRow(code), 200, true);
}

function resignHandler(req, res) {
  var code = req.params.roomCode;
  var room = req.weiqiRoom;
  var id = userId(req);
  var member = memberRow(code, id);
  if (!member || !member.color) return fail(res, 403, '观战者不能认输');
  var game = currentGame(code);
  if (!game) return fail(res, 409, '对局已结束');
  if (game.status === 'finished') return fail(res, 409, '对局已结束');
  var winner = otherColorName(member.color);
  var winnerCode = colorCode(winner);
  db.prepare("UPDATE weiqi_games SET status = 'finished', winner = ?, result_text = ?, result_code = ?, ended_at = datetime('now') WHERE id = ?")
    .run(winner, colorLabel(winnerCode) + '中盘胜', winnerCode === 1 ? 'B+R' : 'W+R', game.id);
  db.prepare("UPDATE weiqi_rooms SET updated_at = datetime('now') WHERE room_code = ?").run(code);
  // 终局即入队后台复盘：双方都可以立刻离开，回来时结果已经算好。
  startRoomReviewForGame(latestGame(code));
  return sendState(res, code, roomRow(code), 200, true);
}

function undoHandler(req, res) {
  var code = req.params.roomCode;
  var room = req.weiqiRoom;
  var id = userId(req);
  var member = memberRow(code, id);
  if (!member || !member.color) return fail(res, 403, '观战者不能悔棋');
  var game = currentGame(code);
  if (!game) return fail(res, 409, '当前不能悔棋');
  if (game.status !== 'active') return fail(res, 409, '当前不能悔棋');
  var last = db.prepare('SELECT * FROM weiqi_moves WHERE game_id = ? ORDER BY id DESC LIMIT 1').get(game.id);
  if (!last) return fail(res, 409, '还没有落子');
  if (String(last.user_id) !== String(id)) return fail(res, 409, '只能悔自己刚下的一手');
  db.prepare('DELETE FROM weiqi_moves WHERE id = ?').run(last.id);
  // 重新计算连续停一手次数与轮次
  var remaining = db.prepare('SELECT color, is_pass FROM weiqi_moves WHERE game_id = ? ORDER BY id').all(game.id);
  var passCount = 0;
  for (var i = remaining.length - 1; i >= 0; i--) {
    if (remaining[i].is_pass) passCount += 1;
    else break;
  }
  db.prepare("UPDATE weiqi_games SET turn = ?, pass_count = ?, status = 'active', dead_stones = '[]', winner = NULL, result_text = NULL, result_code = NULL, ended_at = NULL WHERE id = ?")
    .run(last.color, passCount, game.id);
  db.prepare('UPDATE weiqi_members SET confirmed_game_id = 0 WHERE room_code = ?').run(code);
  db.prepare("UPDATE weiqi_rooms SET updated_at = datetime('now') WHERE room_code = ?").run(code);
  return sendState(res, code, roomRow(code), 200, true);
}

function deadHandler(req, res) {
  var code = req.params.roomCode;
  var room = req.weiqiRoom;
  var member = memberRow(code, userId(req));
  if (!member || !member.color) return fail(res, 403, '观战者不能标死子');
  var game = currentGame(code);
  if (!game) return fail(res, 409, '当前不在数子阶段');
  if (game.status !== 'scoring') return fail(res, 409, '当前不在数子阶段');
  var replayed = replayGame(game);
  var list = req.body && req.body.dead;
  if (!Array.isArray(list)) list = [];
  if (list.length > MAX_DEAD) list = list.slice(0, MAX_DEAD);
  var unique = {};
  var clean = [];
  for (var i = 0; i < list.length; i++) {
    var idx = Number(list[i]);
    if (!isFinite(idx) || idx % 1 !== 0 || idx < 0 || idx >= replayed.state.board.length) continue;
    if (replayed.state.board[idx] === 0) continue;
    if (unique[idx]) continue;
    unique[idx] = true;
    clean.push(idx);
  }
  db.prepare('UPDATE weiqi_games SET dead_stones = ? WHERE id = ?').run(JSON.stringify(clean), game.id);
  // 死子一变，之前的确认全部作废
  db.prepare('UPDATE weiqi_members SET confirmed_game_id = 0 WHERE room_code = ?').run(code);
  db.prepare("UPDATE weiqi_rooms SET updated_at = datetime('now') WHERE room_code = ?").run(code);
  return sendState(res, code, roomRow(code), 200, true);
}

function confirmScoreHandler(req, res) {
  var code = req.params.roomCode;
  var room = req.weiqiRoom;
  var id = userId(req);
  var member = memberRow(code, id);
  if (!member || !member.color) return fail(res, 403, '观战者不能确认数子');
  var game = currentGame(code);
  if (!game) return fail(res, 409, '当前不在数子阶段');
  if (game.status !== 'scoring') return fail(res, 409, '当前不在数子阶段');
  db.prepare('UPDATE weiqi_members SET confirmed_game_id = ? WHERE room_code = ? AND user_id = ?').run(game.id, code, id);
  var players = playersOf(code);
  var confirmed = db.prepare(
    'SELECT user_id FROM weiqi_members WHERE room_code = ? AND color IS NOT NULL AND confirmed_game_id = ?'
  ).all(code, game.id);
  if (players.length > 0 && confirmed.length >= players.length) {
    var replayed = replayGame(game);
    var dead = deadList(game);
    var score = Core.computeScore(replayed.state, dead);
    var winnerName = colorName(score.winner);
    db.prepare("UPDATE weiqi_games SET status = 'finished', winner = ?, result_text = ?, result_code = ?, ended_at = datetime('now') WHERE id = ?")
      .run(winnerName, score.resultText, score.resultCode, game.id);
    // 终局即入队后台复盘：双方都可以立刻离开，回来时结果已经算好。
    startRoomReviewForGame(latestGame(code));
  }
  db.prepare("UPDATE weiqi_rooms SET updated_at = datetime('now') WHERE room_code = ?").run(code);
  return sendState(res, code, roomRow(code), 200, true);
}

function resumeHandler(req, res) {
  var code = req.params.roomCode;
  var room = req.weiqiRoom;
  var member = memberRow(code, userId(req));
  if (!member || !member.color) return fail(res, 403, '观战者不能继续对弈');
  var game = currentGame(code);
  if (!game) return fail(res, 409, '当前不在数子阶段');
  if (game.status !== 'scoring') return fail(res, 409, '当前不在数子阶段');
  db.prepare("UPDATE weiqi_games SET status = 'active', pass_count = 0, dead_stones = '[]' WHERE id = ?").run(game.id);
  db.prepare('UPDATE weiqi_members SET confirmed_game_id = 0 WHERE room_code = ?').run(code);
  db.prepare("UPDATE weiqi_rooms SET updated_at = datetime('now') WHERE room_code = ?").run(code);
  return sendState(res, code, roomRow(code), 200, true);
}

// ============ 聊天 ============
function listMessages(req, res) {
  var code = req.params.roomCode;
  var member = memberRow(code, userId(req));
  if (!member) return fail(res, 403, '请先进入房间');
  var rows = db.prepare(
    'SELECT m.id, m.user_id, m.content, m.created_at, u.net_name ' +
    'FROM weiqi_messages m LEFT JOIN users u ON u.user_id = m.user_id ' +
    'WHERE m.room_code = ? ORDER BY m.id DESC LIMIT ?'
  ).all(code, CHAT_FETCH_LIMIT);
  rows.reverse();
  return res.json({ code: 200, data: { messages: rows.map(chatMessageView) } });
}

function postMessage(req, res) {
  var code = req.params.roomCode;
  var member = memberRow(code, userId(req));
  if (!member) return fail(res, 403, '请先进入房间再发言');
  var content = String((req.body && req.body.content) || '').replace(/^\s+|\s+$/g, '');
  if (!content) return fail(res, 400, '请输入内容');
  if (content.length > CHAT_MAX_LENGTH) {
    content = content.slice(0, CHAT_MAX_LENGTH);
    if (/[\uD800-\uDBFF]$/.test(content)) content = content.slice(0, -1);
  }
  var result = db.prepare('INSERT INTO weiqi_messages (room_code, user_id, content) VALUES (?, ?, ?)').run(code, userId(req), content);
  var row = db.prepare(
    'SELECT m.id, m.user_id, m.content, m.created_at, u.net_name FROM weiqi_messages m LEFT JOIN users u ON u.user_id = m.user_id WHERE m.id = ?'
  ).get(result.lastInsertRowid);
  var message = chatMessageView(row);
  notifyRoomMessage(code, message);
  // 同上：宿主 SDK 只接受 code === 200，发送聊天也必须返回 200。
  return res.status(200).json({ code: 200, data: message });
}

// ============ 历史（供复盘扩展） ============
function historyHandler(req, res) {
  var code = req.params.roomCode;
  if (!memberRow(code, userId(req))) return fail(res, 403, '请先进入房间');
  var games = db.prepare(
    'SELECT id, size, komi, handicap, status, winner, result_text, result_code, started_at, ended_at FROM weiqi_games WHERE room_code = ? ORDER BY id DESC LIMIT 20'
  ).all(code);
  var result = [];
  for (var i = 0; i < games.length; i++) {
    result.push({
      id: games[i].id,
      size: games[i].size,
      komi: games[i].komi,
      handicap: games[i].handicap,
      status: games[i].status,
      winner: games[i].winner,
      resultText: games[i].result_text,
      resultCode: games[i].result_code,
      startedAt: games[i].started_at,
      endedAt: games[i].ended_at,
      moves: moveListForClient(gameMoves(games[i].id))
    });
  }
  return res.json({ code: 200, data: { games: result } });
}

// ============ 挂载 ============
router.post('/rooms', requireAuth, createRoom);
router.get('/rooms/:roomCode', roomAuth, requireRoom, function (req, res) {
  var id = userId(req);
  var member = memberRow(req.params.roomCode, id);
  if (member) {
    db.prepare("UPDATE weiqi_members SET last_seen_at = datetime('now') WHERE room_code = ? AND user_id = ?").run(req.params.roomCode, id);
  }
  return sendState(res, req.params.roomCode, req.weiqiRoom, 200, false);
});
router.post('/rooms/:roomCode/join', roomAuth, requireRoom, joinRoom);
router.post('/rooms/:roomCode/watch', roomAuth, requireRoom, watchRoom);
router.post('/rooms/:roomCode/leave', roomAuth, requireRoom, leaveRoom);
router.post('/rooms/:roomCode/close', roomAuth, requireRoom, closeRoom);
router.post('/rooms/:roomCode/reset', roomAuth, requireRoom, resetGame);
router.post('/rooms/:roomCode/move', roomAuth, requireRoom, moveHandler);
router.post('/rooms/:roomCode/pass', roomAuth, requireRoom, passHandler);
router.post('/rooms/:roomCode/resign', roomAuth, requireRoom, resignHandler);
router.post('/rooms/:roomCode/undo', roomAuth, requireRoom, undoHandler);
router.post('/rooms/:roomCode/dead', roomAuth, requireRoom, deadHandler);
router.post('/rooms/:roomCode/score/confirm', roomAuth, requireRoom, confirmScoreHandler);
router.post('/rooms/:roomCode/resume', roomAuth, requireRoom, resumeHandler);
router.get('/rooms/:roomCode/messages', roomAuth, requireRoom, listMessages);
router.post('/rooms/:roomCode/messages', roomAuth, requireRoom, postMessage);
router.get('/rooms/:roomCode/history', roomAuth, requireRoom, historyHandler);

var aiLastAt = {};

function buildAiQuery(body, purpose) {
  return Shared.buildAiQuery(body, purpose);
}

function convertAiResult(raw, size, body) {
  return Shared.convertAiResult(raw, size, body);
}

function aiRateLimit(req, res, next) {
  var user = req.user || {};
  var key = String(user.user_id || user.id || user.userId || user.username || req.ip || 'anon');
  var nowTs = Date.now();
  if (aiLastAt[key] && nowTs - aiLastAt[key] < 300) {
    return res.status(429).json({ code: 429, message: '请求过于频繁' });
  }
  aiLastAt[key] = nowTs;
  next();
}

function aiHandler(purpose) {
  return function (req, res) {
    var built;
    try {
      built = buildAiQuery(req.body, purpose);
    } catch (e) {
      return res.status(400).json({ code: 400, message: e.message });
    }
    // 对局、分析、复盘统一使用同一个模型（model.bin.gz），只是预算不同。
    aiEngine.analyze(built.payload).then(function (raw) {
      res.json({ code: 200, data: convertAiResult(raw, built.size, req.body) });
    }, function (e) {
      var status = e && e.code === 'BUSY' ? 429 : 503;
      res.status(status).json({ code: status, message: e && e.message ? e.message : 'KataGo 不可用', error: e && e.code ? e.code : 'ENGINE_ERROR' });
    });
  };
}

router.get('/ai/status', requireAuth, function (req, res) {
  res.json({ code: 200, data: aiEngine.status() });
});

router.post('/ai/warmup', requireAuth, function (req, res) {
  aiEngine.warmup().then(function (s) {
    res.json({ code: 200, data: s });
  }, function (e) {
    res.status(503).json({ code: 503, message: e && e.message ? e.message : 'KataGo 不可用', error: e && e.code ? e.code : 'ENGINE_ERROR' });
  });
});

router.post('/ai/move', requireAuth, aiRateLimit, aiHandler('move'));
router.post('/ai/analyze', requireAuth, aiRateLimit, aiHandler('analyze'));
// 单局面分析（保留）：前端「AI 分析」面板仍用它；整盘复盘改走下面的后台任务。
router.post('/ai/review', requireAuth, aiRateLimit, aiHandler('review'));

// ============ 整盘复盘（后台任务） ============
// 需求：对局结束后自动复盘、用户可以离开，回来直接看结果。
// 触发 → 服务端排队逐手分析、进度落库 → 前端轮询 status 取结果。
function startRoomReviewForGame(game) {
  if (!game) return;
  try {
    var rows = gameMoves(game.id);
    if (!rows.length) return;
    reviewRunner.startReview({
      size: Number(game.size),
      komi: Number(game.komi),
      handicap: Number(game.handicap) || 0,
      turn: Number(game.handicap) > 1 ? Core.WHITE : Core.BLACK,
      setup: [],
      moves: moveListForClient(rows),
      level: 2
    });
  } catch (e) {
    // 后台自动触发失败不能让终局请求失败，静默记日志即可。
    console.error('[weiqi] auto review start failed:', e && e.message ? e.message : e);
  }
}

router.post('/ai/review-async/start', requireAuth, function (req, res) {
  var out;
  try {
    out = reviewRunner.startReview(req.body || {});
  } catch (e) {
    var code = e && e.code === 'BUSY' ? 429 : (e && e.code === 'TOO_SHORT' ? 400 : (e && e.code === 'UNAVAILABLE' ? 503 : 400));
    return res.status(code).json({ code: code, message: e && e.message ? e.message : '复盘启动失败', error: e && e.code ? e.code : 'REVIEW_ERROR' });
  }
  res.json({ code: 200, data: out });
});

router.get('/ai/review-async/:reviewId', requireAuth, function (req, res) {
  var out = reviewRunner.statusOf(req.params.reviewId);
  if (!out) return res.status(404).json({ code: 404, message: '复盘任务不存在' });
  res.json({ code: 200, data: out });
});

module.exports = router;
