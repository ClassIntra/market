// 中国象棋 —— 市场应用后端路由
// 房间制联机对战：房间/成员/对局/落子四张表，走子经 rules.js 服务端权威校验，
// 状态变化经 realtimeBus 广播给房间全体成员（chess.room.changed）。
// 结构对齐 gomoku 应用（去掉跨班中继，暂不支持跨服对局）。
var express = require('express');
var path = require('path');
var router = express.Router();
var db = require(path.resolve(process.cwd(), 'src/utils/db'));
var requireAuth = require(path.resolve(process.cwd(), 'src/middleware/auth')).requireAuth;
var crypto = require('crypto');
var realtimeBus = require(path.resolve(process.cwd(), 'src/utils/realtime-bus'));
var rules = require('./rules');

function userId(req) {
  return String((req.user && (req.user.user_id || req.user.id)) || 'guest');
}
// 房间码：4 位纯数字，低龄用户念读零负担（与 gomoku 一致）
function makeCode() { return String(crypto.randomBytes(2).readUInt16BE(0) % 10000).padStart(4, '0'); }
function roomRow(roomCode) { return db.prepare('SELECT * FROM chess_rooms WHERE room_code = ?').get(roomCode); }
function currentGame(roomCode) { return db.prepare('SELECT * FROM chess_games WHERE room_code = ? AND status = \'active\' ORDER BY id DESC LIMIT 1').get(roomCode); }
function ensureGame(roomCode) {
  var game = currentGame(roomCode);
  if (game) return game;
  var result = db.prepare('INSERT INTO chess_games (room_code, board, turn) VALUES (?, ?, ?)').run(roomCode, JSON.stringify(rules.initialBoard()), 'red');
  return db.prepare('SELECT * FROM chess_games WHERE id = ?').get(result.lastInsertRowid);
}

function stateFor(roomCode, game) {
  // LEFT JOIN users 带出网名；成员列表显示网名而非学号账号（对齐 gomoku）
  var members = db.prepare('SELECT m.user_id, m.role, m.color, m.joined_at, m.last_seen_at, u.net_name FROM chess_members m LEFT JOIN users u ON u.user_id = m.user_id WHERE m.room_code = ? ORDER BY m.joined_at').all(roomCode);
  var board = JSON.parse(game.board);
  var last = db.prepare('SELECT user_id, color, from_row, from_col, to_row, to_col FROM chess_moves WHERE game_id = ? ORDER BY id DESC LIMIT 1').get(game.id);
  return {
    roomCode: roomCode,
    gameId: game.id,
    board: board,
    turn: game.turn,
    winner: game.winner,
    result: game.result,
    status: game.status,
    // 轮到的一方是否正被将军（active 且未分胜负时才有意义）
    check: game.status === 'active' && !game.winner ? rules.isInCheck(board, game.turn) : false,
    members: members,
    lastMove: last ? { userId: last.user_id, color: last.color, fromRow: last.from_row, fromCol: last.from_col, toRow: last.to_row, toCol: last.to_col } : null
  };
}

function notifyRoom(roomCode, state) {
  var members = db.prepare('SELECT user_id FROM chess_members WHERE room_code = ?').all(roomCode);
  var memberIds = members.map(function(member) { return member.user_id; });
  realtimeBus.publishToUsers(memberIds, {
    type: 'extension_event',
    app_name: 'chess',
    event: 'chess.room.changed',
    payload: { roomCode: roomCode, state: state },
    created_at: new Date().toISOString()
  });
}

// ===== 房间快捷聊天 =====
// 自包含实现，不依赖 chat 应用的消息表/已读状态/通知体系：房间级短消息，
// 随房间销毁。玩家与观战者都可发言（观战者无棋可下，聊天是唯一的参与方式）。
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
  var memberIds = db.prepare('SELECT user_id FROM chess_members WHERE room_code = ?').all(roomCode).map(function(member) { return member.user_id; });
  if (!memberIds.length) return;
  realtimeBus.publishToUsers(memberIds, {
    type: 'extension_event',
    app_name: 'chess',
    event: 'chess.room.message',
    payload: { roomCode: roomCode, message: message },
    created_at: new Date().toISOString()
  });
}
// 房间销毁（关房 / 空置）时清空消息。调用方保证时机，这里只做删除。
function purgeRoomMessages(roomCode) {
  db.prepare('DELETE FROM chess_messages WHERE room_code = ?').run(roomCode);
}

// 落子/加入/离开等写操作成功后统一广播（代理转发场景与 gomoku 同理预留）
function notifySuccessfulRoomChange(req, res, next) {
  var originalJson = res.json;
  res.json = function(body) {
    if (req.chessForwarding) return originalJson.call(this, body);
    var pathMatch = req.path.match(/^\/rooms\/([A-Z0-9]{4,6})\/(join|watch|leave|move|reset|undo|resign|color)$/i);
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

// 建表兜底：正常路径由 migration 008 负责，此处幂等兜底（market-apps 自举场景）
db.exec("CREATE TABLE IF NOT EXISTS chess_rooms (room_code TEXT PRIMARY KEY, owner_id TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open', created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')))");
db.exec("CREATE TABLE IF NOT EXISTS chess_members (room_code TEXT NOT NULL, user_id TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'player', color TEXT, joined_at TEXT DEFAULT (datetime('now')), last_seen_at TEXT DEFAULT (datetime('now')), PRIMARY KEY (room_code, user_id), FOREIGN KEY (room_code) REFERENCES chess_rooms(room_code) ON DELETE CASCADE)");
db.exec("CREATE TABLE IF NOT EXISTS chess_games (id INTEGER PRIMARY KEY AUTOINCREMENT, room_code TEXT NOT NULL, board TEXT NOT NULL, turn TEXT NOT NULL DEFAULT 'red', winner TEXT, result TEXT, status TEXT NOT NULL DEFAULT 'active', started_at TEXT DEFAULT (datetime('now')), ended_at TEXT, FOREIGN KEY (room_code) REFERENCES chess_rooms(room_code) ON DELETE CASCADE)");
db.exec("CREATE TABLE IF NOT EXISTS chess_moves (id INTEGER PRIMARY KEY AUTOINCREMENT, game_id INTEGER NOT NULL, user_id TEXT NOT NULL, color TEXT NOT NULL, from_row INTEGER NOT NULL, from_col INTEGER NOT NULL, to_row INTEGER NOT NULL, to_col INTEGER NOT NULL, piece TEXT NOT NULL, captured TEXT, created_at TEXT DEFAULT (datetime('now')), FOREIGN KEY (game_id) REFERENCES chess_games(id) ON DELETE CASCADE)");
// 房间快捷聊天：消息挂在房间上，随房间生命周期销毁（关房 / 房间空置即清空），不做跨房投递。
// created_at 沿用 SQLite datetime('now')（UTC，与 chess_moves 一致）；界面不展示时间，
// 避免与中继/其他表的 ISO 格式混用（见项目「created_at 两格式」约定）。
db.exec("CREATE TABLE IF NOT EXISTS chess_messages (id INTEGER PRIMARY KEY AUTOINCREMENT, room_code TEXT NOT NULL, user_id TEXT NOT NULL, content TEXT NOT NULL, created_at TEXT DEFAULT (datetime('now')), FOREIGN KEY (room_code) REFERENCES chess_rooms(room_code) ON DELETE CASCADE)");
db.exec('CREATE INDEX IF NOT EXISTS idx_chess_games_room ON chess_games(room_code)');
db.exec('CREATE INDEX IF NOT EXISTS idx_chess_moves_game ON chess_moves(game_id)');
db.exec('CREATE INDEX IF NOT EXISTS idx_chess_messages_room ON chess_messages(room_code, id)');

function requireRoom(req, res, next) {
  var room = roomRow(req.params.roomCode);
  if (room && room.status !== 'closed') {
    req.chessRoom = room;
    return next();
  }
  return res.status(404).json({ code: 404, message: '房间不存在或已关闭' });
}

// 加入房间：红位空补红，黑位空补黑，双满转观战（邀请卡片/观战共用入口）
function join(roomCode, id) {
  var existing = db.prepare('SELECT * FROM chess_members WHERE room_code = ? AND user_id = ?').get(roomCode, id);
  if (existing) {
    db.prepare("UPDATE chess_members SET last_seen_at = datetime('now') WHERE room_code = ? AND user_id = ?").run(roomCode, id);
    return existing;
  }
  var colors = db.prepare('SELECT color FROM chess_members WHERE room_code = ? AND color IS NOT NULL').all(roomCode).map(function(row) { return row.color; });
  var color = colors.indexOf('red') === -1 ? 'red' : colors.indexOf('black') === -1 ? 'black' : null;
  db.prepare('INSERT INTO chess_members (room_code, user_id, role, color) VALUES (?, ?, ?, ?)').run(roomCode, id, color ? 'player' : 'spectator', color);
  return db.prepare('SELECT * FROM chess_members WHERE room_code = ? AND user_id = ?').get(roomCode, id);
}

function createRoom(req, res) {
  var code;
  do { code = makeCode(); } while (roomRow(code));
  db.prepare('INSERT INTO chess_rooms (room_code, owner_id) VALUES (?, ?)').run(code, userId(req));
  db.prepare('INSERT INTO chess_members (room_code, user_id, role, color) VALUES (?, ?, ?, ?)').run(code, userId(req), 'owner', 'red');
  db.prepare("UPDATE chess_rooms SET updated_at = datetime('now') WHERE room_code = ?").run(code);
  var createdState = stateFor(code, ensureGame(code));
  notifyRoom(code, createdState);
  return res.status(201).json({ code: 201, data: createdState });
}
router.post('/rooms', requireAuth, createRoom);

router.get('/rooms/:roomCode', requireRoom, function(req, res) {
  res.json({ code: 200, data: stateFor(req.params.roomCode, ensureGame(req.params.roomCode)) });
});

// 聊天记录：只对房间成员开放（房间码只有 4 位，不校验成员等于把聊天内容暴露给猜码者）。
// 倒序取最近 N 条再反转 —— 长会话下要拿的是最新一段而不是最早一段。
router.get('/rooms/:roomCode/messages', requireAuth, requireRoom, function(req, res) {
  var id = userId(req), roomCode = req.params.roomCode;
  var member = db.prepare('SELECT user_id FROM chess_members WHERE room_code = ? AND user_id = ?').get(roomCode, id);
  if (!member) return res.status(403).json({ code: 403, message: '不在房间中' });
  var rows = db.prepare('SELECT m.id, m.user_id, m.content, m.created_at, u.net_name FROM chess_messages m LEFT JOIN users u ON u.user_id = m.user_id WHERE m.room_code = ? ORDER BY m.id DESC LIMIT ?').all(roomCode, CHAT_FETCH_LIMIT);
  rows.reverse();
  res.json({ code: 200, data: { messages: rows.map(chatMessageView) } });
});

// 发言：玩家与观战者都可发（观战者不能走子，聊天是其唯一参与方式）。
// 内容以 textContent 在前端渲染，不做 HTML 解析；这里仍做长度与空值约束。
router.post('/rooms/:roomCode/messages', requireAuth, requireRoom, function(req, res) {
  var id = userId(req), roomCode = req.params.roomCode;
  var member = db.prepare('SELECT user_id FROM chess_members WHERE room_code = ? AND user_id = ?').get(roomCode, id);
  if (!member) return res.status(403).json({ code: 403, message: '请先进入房间再发言' });
  var content = String((req.body && req.body.content) || '').trim();
  if (!content) return res.status(400).json({ code: 400, message: '请输入内容' });
  if (content.length > CHAT_MAX_LENGTH) {
    content = content.slice(0, CHAT_MAX_LENGTH);
    // 截断落在代理对中间会得到半个 emoji（渲染成替换字符），退一个码元
    if (/[\uD800-\uDBFF]$/.test(content)) content = content.slice(0, -1);
  }
  var result = db.prepare('INSERT INTO chess_messages (room_code, user_id, content) VALUES (?, ?, ?)').run(roomCode, id, content);
  var row = db.prepare('SELECT m.id, m.user_id, m.content, m.created_at, u.net_name FROM chess_messages m LEFT JOIN users u ON u.user_id = m.user_id WHERE m.id = ?').get(result.lastInsertRowid);
  var message = chatMessageView(row);
  notifyRoomMessage(roomCode, message);
  res.status(201).json({ code: 201, data: message });
});
// 房间操作一律挂 requireAuth：此前 join/move 等未认证，userId(req) 恒为 'guest'——
// 第二个玩家加入后被登记为 guest 而非真实学号，前端 currentMember() 匹配不上自己
// → canSelectPiece 恒 false → 「联机进房后点棋子毫无反应」（2026-09-21 用户实测）
router.post('/rooms/:roomCode/join', requireAuth, requireRoom, function(req, res) {
  join(req.params.roomCode, userId(req));
  var result = stateFor(req.params.roomCode, ensureGame(req.params.roomCode));
  notifyRoom(req.params.roomCode, result);
  res.json({ code: 200, data: result });
});
// 观战：进入房间但强制降级为观战者（邀请卡片直达 + 用户主动选择「观战」共用入口）。
// 已是有色玩家时不降级（对局中不该把自己踢下场），由前端按钮可用性兜住。
router.post('/rooms/:roomCode/watch', requireAuth, requireRoom, function(req, res) {
  var roomCode = req.params.roomCode, id = userId(req);
  var member = join(roomCode, id);
  if (member.color) {
    db.prepare('UPDATE chess_members SET role = \'spectator\', color = NULL WHERE room_code = ? AND user_id = ?').run(roomCode, id);
  }
  res.json({ code: 200, data: stateFor(roomCode, ensureGame(roomCode)) });
});

// 离开房间。若离开者带色（是正在进行的一方的玩家），把该色位让给最早加入的观战者——
// 即「替补」：玩家掉线/退出后对局不会退化成单色孤立，观战者可以接着下。
router.post('/rooms/:roomCode/leave', requireAuth, requireRoom, function(req, res) {
  var id = userId(req), roomCode = req.params.roomCode;
  var member = db.prepare('SELECT * FROM chess_members WHERE room_code = ? AND user_id = ?').get(roomCode, id);
  if (!member) return res.status(404).json({ code: 404, message: '不在房间中' });
  db.prepare('DELETE FROM chess_members WHERE room_code = ? AND user_id = ?').run(roomCode, id);
  if (member.role === 'owner') {
    var next = db.prepare('SELECT user_id FROM chess_members WHERE room_code = ? ORDER BY joined_at LIMIT 1').get(roomCode);
    if (next) db.prepare('UPDATE chess_rooms SET owner_id = ? WHERE room_code = ?').run(next.user_id, roomCode);
  }
  // 替补递补：空出的色位按加入顺序交给最早的观战者
  if (member.color) {
    var promoted = db.prepare('SELECT user_id FROM chess_members WHERE room_code = ? AND color IS NULL AND role = \'spectator\' ORDER BY joined_at LIMIT 1').get(roomCode);
    if (promoted) db.prepare('UPDATE chess_members SET color = ?, role = \'player\' WHERE room_code = ? AND user_id = ?').run(member.color, roomCode, promoted.user_id);
  }
  // 房间空置即销毁聊天记录（房间行本身保留，沿用既有语义：只有房主能显式关房）
  var remaining = db.prepare('SELECT COUNT(*) AS c FROM chess_members WHERE room_code = ?').get(roomCode).c;
  if (!remaining) purgeRoomMessages(roomCode);
  // 响应体不带 members，notifySuccessfulRoomChange 不广播 → 这里显式广播，
  // 否则留在房里的人看不到名单变化（也看不到替补上位）
  var room = roomRow(roomCode);
  if (room && room.status !== 'closed') notifyRoom(roomCode, stateFor(roomCode, ensureGame(roomCode)));
  res.json({ code: 200, data: { roomCode: roomCode } });
});
router.post('/rooms/:roomCode/close', requireAuth, requireRoom, function(req, res) {
  if (req.chessRoom.owner_id !== userId(req)) return res.status(403).json({ code: 403, message: '只有房主可以关闭房间' });
  db.prepare("UPDATE chess_rooms SET status = 'closed', updated_at = datetime('now') WHERE room_code = ?").run(req.params.roomCode);
  purgeRoomMessages(req.params.roomCode);  // 关房即销毁聊天记录
  res.json({ code: 200, data: { roomCode: req.params.roomCode, status: 'closed' } });
});
// 房主重开一局：旧局标记结束，同房间同色位开新局
router.post('/rooms/:roomCode/reset', requireAuth, requireRoom, function(req, res) {
  if (req.chessRoom.owner_id !== userId(req)) return res.status(403).json({ code: 403, message: '只有房主可以重开对局' });
  var game = currentGame(req.params.roomCode);
  if (game) db.prepare("UPDATE chess_games SET status = 'finished', ended_at = datetime('now') WHERE id = ?").run(game.id);
  var result = stateFor(req.params.roomCode, ensureGame(req.params.roomCode));
  notifyRoom(req.params.roomCode, result);
  res.json({ code: 200, data: result });
});

// 换方：与对手互换红黑；对手未加入时直接翻转自己颜色（空出的色位留给后来者，
// join 按空色分配——房主可以让出先手红方）。已有走子一律禁止：
// 换方后棋盘上既有棋子的归属会与成员颜色错位，等于换了一盘棋。
router.post('/rooms/:roomCode/color', requireAuth, requireRoom, function(req, res) {
  var id = userId(req), roomCode = req.params.roomCode;
  var member = db.prepare('SELECT * FROM chess_members WHERE room_code = ? AND user_id = ?').get(roomCode, id);
  if (!member || !member.color) return res.status(403).json({ code: 403, message: '只有玩家可以换方' });
  var game = currentGame(roomCode);
  if (game && db.prepare('SELECT COUNT(*) AS c FROM chess_moves WHERE game_id = ?').get(game.id).c > 0) {
    return res.status(409).json({ code: 409, message: '对局已有走子，不能换方' });
  }
  var nextColor = member.color === 'red' ? 'black' : 'red';
  var other = db.prepare('SELECT * FROM chess_members WHERE room_code = ? AND color = ? AND user_id != ?').get(roomCode, nextColor, id);
  if (other) {
    db.prepare('UPDATE chess_members SET color = ? WHERE room_code = ? AND user_id = ?').run(nextColor, roomCode, id);
    db.prepare('UPDATE chess_members SET color = ? WHERE room_code = ? AND user_id = ?').run(member.color, roomCode, other.user_id);
  } else {
    db.prepare('UPDATE chess_members SET color = ? WHERE room_code = ? AND user_id = ?').run(nextColor, roomCode, id);
  }
  // 棋子尚未走动，红先手不变：turn 无需改动（新局恒为 red）
  return res.json({ code: 200, data: stateFor(roomCode, ensureGame(roomCode)) });
});

// 认输：对方获胜（result=resign）
router.post('/rooms/:roomCode/resign', requireAuth, requireRoom, function(req, res) {
  var id = userId(req), roomCode = req.params.roomCode;
  var member = db.prepare('SELECT * FROM chess_members WHERE room_code = ? AND user_id = ?').get(roomCode, id);
  if (!member || !member.color) return res.status(403).json({ code: 403, message: '只有玩家可以认输' });
  var game = currentGame(roomCode);
  if (!game || game.winner || game.status !== 'active') return res.status(409).json({ code: 409, message: '对局已结束' });
  var winner = member.color === 'red' ? 'black' : 'red';
  db.prepare("UPDATE chess_games SET winner = ?, result = 'resign', status = 'finished', ended_at = datetime('now') WHERE id = ?").run(winner, game.id);
  return res.json({ code: 200, data: stateFor(roomCode, db.prepare('SELECT * FROM chess_games WHERE id = ?').get(game.id)) });
});

// 悔棋：撤销本局最后一手。双人对局只能悔「自己刚下的那一手」（必须轮到自己）；
// 对手未加入时可悔任意最后一手。悔棋后该色重下。
router.post('/rooms/:roomCode/undo', requireAuth, requireRoom, function(req, res) {
  var id = userId(req), roomCode = req.params.roomCode;
  var member = db.prepare('SELECT * FROM chess_members WHERE room_code = ? AND user_id = ?').get(roomCode, id);
  if (!member || !member.color) return res.status(403).json({ code: 403, message: '只有玩家可以悔棋' });
  var game = currentGame(roomCode);
  if (!game || game.winner || game.status !== 'active') return res.status(409).json({ code: 409, message: '对局已结束，不能悔棋' });
  var last = db.prepare('SELECT * FROM chess_moves WHERE game_id = ? ORDER BY id DESC LIMIT 1').get(game.id);
  if (!last) return res.status(409).json({ code: 409, message: '还没有走子，无法悔棋' });
  var playerCount = db.prepare('SELECT COUNT(*) AS c FROM chess_members WHERE room_code = ? AND color IS NOT NULL').get(roomCode).c;
  if (playerCount >= 2 && String(last.user_id) !== String(id)) return res.status(409).json({ code: 409, message: '等对方走子后才能悔棋' });
  var state = JSON.parse(game.board);
  // 复原：棋子退回起点，被吃子回到原位
  state[last.to_row][last.to_col] = last.captured || null;
  state[last.from_row][last.from_col] = last.piece;
  db.prepare('UPDATE chess_games SET board = ?, turn = ?, winner = NULL, result = NULL, status = \'active\' WHERE id = ?').run(JSON.stringify(state), last.color, game.id);
  db.prepare('DELETE FROM chess_moves WHERE id = ?').run(last.id);
  return res.json({ code: 200, data: stateFor(roomCode, db.prepare('SELECT * FROM chess_games WHERE id = ?').get(game.id)) });
});

// 走子：服务端权威校验（轮次/棋子归属/走法规则/送将/将见面），
// 走后判定将死与困毙（无子可动判和，按中国象棋规则）。
router.post('/rooms/:roomCode/move', requireAuth, requireRoom, function(req, res) {
  var id = userId(req), roomCode = req.params.roomCode;
  var game = ensureGame(roomCode);
  var fr = req.body && req.body.fromRow, fc = req.body && req.body.fromCol;
  var tr = req.body && req.body.toRow, tc = req.body && req.body.toCol;
  if (!rules.validCoordinate(fr, fc) || !rules.validCoordinate(tr, tc)) return res.status(400).json({ code: 400, message: '坐标不合法' });
  if (game.winner || game.status !== 'active') return res.status(409).json({ code: 409, message: '对局已结束', data: stateFor(roomCode, game) });

  var member = db.prepare('SELECT * FROM chess_members WHERE room_code = ? AND user_id = ?').get(roomCode, id);
  if (!member) member = join(roomCode, id);
  if (!member.color) return res.status(403).json({ code: 403, message: '观战者不能走子' });

  var board = JSON.parse(game.board);
  var moving = board[fr][fc];
  if (!moving) return res.status(409).json({ code: 409, message: '起始位置没有棋子' });
  var moverColor = rules.pieceColor(moving);

  var playerCount = db.prepare('SELECT COUNT(*) AS c FROM chess_members WHERE room_code = ? AND color IS NOT NULL').get(roomCode).c;
  if (playerCount >= 2) {
    // 双人对局：只能走自己的棋、必须轮到自己
    if (moverColor !== member.color) return res.status(403).json({ code: 403, message: '只能移动自己的棋子' });
    if (game.turn !== member.color) return res.status(409).json({ code: 409, message: '尚未轮到该方走子' });
  }
  // 单人房间放行自由摆棋：允许任色走子（复盘/练开局），turn 照常翻转，对手加入后恢复严格轮流

  var verdict = rules.validateMove(board, fr, fc, tr, tc, moverColor);
  if (!verdict.ok) return res.status(409).json({ code: 409, message: verdict.message });

  var captured = board[tr][tc] || null;
  board[tr][tc] = moving;
  board[fr][fc] = null;
  var nextTurn = moverColor === 'red' ? 'black' : 'red';
  var winner = null, result = null, status = 'active';
  if (captured === 'r_king' || captured === 'b_king') {
    // 理论上被送将规则拦截，兜底判负
    winner = moverColor; result = 'checkmate'; status = 'finished';
  } else if (rules.isCheckmate(board, nextTurn)) {
    winner = moverColor; result = 'checkmate'; status = 'finished';
  } else if (rules.isStalemate(board, nextTurn)) {
    winner = 'draw'; result = 'stalemate'; status = 'finished';
  }
  db.prepare('UPDATE chess_games SET board = ?, turn = ?, winner = ?, result = ?, status = ?, ended_at = CASE WHEN ? IS NULL THEN ended_at ELSE datetime(\'now\') END WHERE id = ?')
    .run(JSON.stringify(board), winner ? moverColor : nextTurn, winner, result, status, winner, game.id);
  db.prepare('INSERT INTO chess_moves (game_id, user_id, color, from_row, from_col, to_row, to_col, piece, captured) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(game.id, id, moverColor, fr, fc, tr, tc, moving, captured);
  return res.json({ code: 200, data: stateFor(roomCode, db.prepare('SELECT * FROM chess_games WHERE id = ?').get(game.id)) });
});

// ===== 人机练习引擎（Pikafish）=====
// 前端人机模式把「该电脑走」的局面 POST 上来，由服务端常驻的 Pikafish 进程算一步。
// 为什么放服务端而不是前端：① 平板算力 + 主线程预算把棋力锁死（旧版极大极小只能赢新手）；
// ② 引擎冷启动要加载 50MB 权重，绝不能每步新建进程（engine.js 保活单实例 + 串行队列）。
// 引擎不可用/排队满/超时一律回 503 + fallback 标记，前端回落内置 AI——人机模式
// 不允许因为一个可选二进制缺失而整体不可用。
var engine = require('./engine');

// 同一用户并发上限：连点/脚本刷会把单进程队列塞满，别人跟着排队等超时
var AI_MAX_INFLIGHT_PER_USER = 2;
var aiInflight = {};

function aiRelease(id) {
  var next = (aiInflight[id] || 1) - 1;
  if (next <= 0) delete aiInflight[id];
  else aiInflight[id] = next;
}

// ===== 引擎结果缓存（观战扩容的关键）=====
// 房间模式下「凡是打开引擎页的人，每走一步都各发一次分析请求」，而服务端引擎是
// **单实例串行队列**：一个班 20 个人观战同一盘棋 = 20 次串行搜索，最后一位要等十几秒，
// 还会把别人的**人机应手**一起挤到队尾。但关键事实是——**他们问的是同一个局面**。
// 所以按局面做两级去重：
//   ① 结果缓存：TTL 内算过的局面直接回，连引擎都不碰（观战者成本 ≈ 0）
//   ② 在途合并：同一局面正在算，后来的请求搭同一个 Promise（全程只跑一次引擎）
// 命中/搭车**不计入 per-user 并发闸**：它们没占任何引擎资源，没理由被限流。
// 缓存键用 boardToFen 的产物（规范 FEN），不同客户端用不同表示传来的同一局面会归一到同键。
// ⚠️ 分析键必须建立在**真实下发到引擎的参数**上（movetime/multiPv 经归一化），
//    否则 {movetime:0} 与 {movetime:999} 会算成两个键却跑同一个预算，缓存形同虚设。
var MOVE_CACHE_TTL = 20 * 1000;
var ANALYSE_CACHE_TTL = 15 * 1000;
var CACHE_MAX_ENTRIES = 64;
var moveCache = {};
var analyseCache = {};
var inflightJobs = {};   // key -> Promise<{ok,data|error}>
var cacheStats = { moveHits: 0, analyseHits: 0, joined: 0, misses: 0 };

function cacheGet(store, key, ttl) {
  var entry = store[key];
  if (!entry) return null;
  if (Date.now() - entry.at > ttl) { delete store[key]; return null; }
  return entry.data;
}

function cachePut(store, key, data) {
  store[key] = { at: Date.now(), data: data };
  var keys = Object.keys(store);
  if (keys.length <= CACHE_MAX_ENTRIES) return;
  // 条目本身很小（几 KB），但没上限就会随一个学期无限增长 → 超限按时间淘汰最旧的
  keys.sort(function(a, b) { return store[a].at - store[b].at; });
  for (var i = 0; i < keys.length - CACHE_MAX_ENTRIES; i++) delete store[keys[i]];
}

// 局面键。boardToFen 对非法棋盘会抛，缓存键构造失败时返回 null → 调用方跳过缓存走直算。
function fenKeyOf(board, turn, suffix) {
  var fen;
  try { fen = engine.boardToFen(board, turn); } catch (e) { return null; }
  return fen + (suffix ? '|' + suffix : '');
}

// 统一把「job 结果」翻译成 HTTP 响应。job 约定为永不 reject 的 { ok, data | error }，
// 这样搭车的请求不必各自再写一遍 catch 分支。
function respondJob(job, res) {
  job.then(function(payload) {
    if (payload.ok) return res.json({ code: 200, data: payload.data });
    var error = payload.error;
    if (error && error.code === 'BAD_POSITION') {
      return res.status(400).json({ code: 400, message: error.message });
    }
    return res.status(503).json({
      code: 503,
      message: '引擎暂时不可用',
      data: { fallback: true, reason: (error && error.code) || 'ENGINE_ERROR' }
    });
  });
}

// 起一个在途任务（并把 per-user 并发计数挂上）。调用方必须先确认没有同键在途任务。
function startJob(key, id, work) {
  aiInflight[id] = (aiInflight[id] || 0) + 1;
  var job = work().then(
    function(data) { return { ok: true, data: data }; },
    function(error) { return { ok: false, error: error }; }
  );
  inflightJobs[key] = job;
  var clear = function() { delete inflightJobs[key]; aiRelease(id); };
  job.then(clear, clear);
  return job;
}

function overLimit(id) { return (aiInflight[id] || 0) >= AI_MAX_INFLIGHT_PER_USER; }

function turnLabel(value) {
  return value === 'black' ? 'black' : value === 'red' ? 'red' : null;
}

// 引擎能力探测：前端用它决定标题栏显示「Pikafish」还是「内置」，并提前知道要不要降级。
// 刻意不回传 exe/权重路径：这是学生端可见的接口，服务器目录结构没必要外泄。
router.get('/ai/status', requireAuth, function(req, res) {
  var info = engine.status();
  res.json({
    code: 200,
    data: {
      available: info.available && !info.disabled,
      engineName: info.engineName || '',
      running: info.running,
      pending: info.pending,
      cooldownMs: info.cooldownMs,
      levels: info.levels,
      defaultLevel: info.defaultLevel,
      // 缓存观测：房间观战是否真的被去重，看 hit/joined 与引擎 pending 的对比即可
      cache: {
        hit: cacheStats.moveHits + cacheStats.analyseHits,
        moveHits: cacheStats.moveHits,
        analyseHits: cacheStats.analyseHits,
        joined: cacheStats.joined,
        misses: cacheStats.misses,
        entries: Object.keys(moveCache).length + Object.keys(analyseCache).length
      }
    }
  });
});

router.post('/ai/move', requireAuth, function(req, res) {
  var id = userId(req);
  var body = req.body || {};
  var turn = turnLabel(body.turn);
  if (!turn) return res.status(400).json({ code: 400, message: '缺少行棋方' });
  var level = engine.normalizeLevel(body.level);
  var gameKey = String(body.gameKey == null ? '' : body.gameKey).slice(0, 64).replace(/\s+/g, '-');

  // ① 结果缓存：同局面 + 同档位在 TTL 内算过就直接回。班级场景收益很大——
  //    一节课几十个人从初始局面开人机，问的其实是同一手，缓存后只有第一个人真占引擎。
  var moveKey = fenKeyOf(body.board, turn, 'L' + level);
  var cachedMove = moveKey ? cacheGet(moveCache, moveKey, MOVE_CACHE_TTL) : null;
  if (cachedMove) {
    cacheStats.moveHits += 1;
    return res.json({ code: 200, data: cachedMove });
  }
  // ② 在途合并：同局面已在算，后来的搭同一个 Promise（不再起第二个引擎任务）
  var running = moveKey ? inflightJobs[moveKey] : null;
  if (running) {
    cacheStats.joined += 1;
    return respondJob(running, res);
  }
  // ③ 只有真要占引擎时才计 per-user 并发（缓存命中/搭车都不占资源，不该被限流）
  if (overLimit(id)) {
    return res.status(429).json({ code: 429, message: '引擎请求过于频繁', data: { fallback: true } });
  }
  cacheStats.misses += 1;
  var job = startJob(moveKey || ('move:' + id + ':' + Date.now()), id, function() {
    return engine.bestMove({ board: body.board, turn: turn, level: level, gameKey: gameKey }).then(function(result) {
      if (!result.move) {
        // 引擎判定无着可走（被将死/困毙）。前端自己也会先判定，这里只是把结论如实回传。
        return { move: null, engine: 'pikafish', engineName: result.engineName, level: level };
      }
      // 二次校验引擎着法：合法才交回前端。不合法=局面或引擎状态出了偏差，
      // 宁可让前端回落内置 AI，也不要让一步非法棋把整盘下崩。
      var verdict = rules.validateMove(body.board, result.move.fr, result.move.fc, result.move.tr, result.move.tc, turn);
      if (!verdict.ok) {
        var bad = new Error('引擎着法未通过校验');
        bad.code = 'BAD_MOVE';
        throw bad;
      }
      return {
        move: {
          fromRow: result.move.fr,
          fromCol: result.move.fc,
          toRow: result.move.tr,
          toCol: result.move.tc
        },
        uci: result.uci,
        engine: 'pikafish',
        engineName: result.engineName,
        level: level,
        depth: result.depth,
        nodes: result.nodes,
        nps: result.nps,
        time: result.time,
        score: result.score,
        pv: result.pv,
        movetime: result.movetime
      };
    });
  });
  // 只缓存算成功的：引擎失败（不可用/冷却中）返回的 503 不该被固化住 20 秒
  job.then(function(payload) { if (payload.ok && moveKey) cachePut(moveCache, moveKey, payload.data); });
  respondJob(job, res);
});

// 局面分析（MultiPV）：给一个局面回「Top-N 候选着法 + 各自评分与主变例」。
// 与 /ai/move 共用同一个常驻进程与串行队列，所以同样受 per-user 并发闸门约束：
// 分析是低频动作（切到引擎页才发），但连点也必须挡住，否则会挤掉别人的应手。
// 降级口径一致：引擎不在就 503 + fallback，由前端决定是否提示。
router.post('/ai/analyse', requireAuth, function(req, res) {
  var id = userId(req);
  var body = req.body || {};
  var turn = turnLabel(body.turn);
  if (!turn) return res.status(400).json({ code: 400, message: '缺少行棋方' });
  var gameKey = String(body.gameKey == null ? '' : body.gameKey).slice(0, 64).replace(/\s+/g, '-');

  // 归一化必须与真正下发给引擎的参数一致，缓存键才有意义（见 normalizeAnalyseOpts 注释）
  var budget = engine.normalizeAnalyseOpts(body);
  var analyseKey = fenKeyOf(body.board, turn, 'A' + budget.movetime + 'x' + budget.multiPv);

  // ① 结果缓存：同一局面（同预算）在 TTL 内算过 → 直接回。这是观战扩容的主力：
  //    一个房间所有人看的是同一个局面，只有第一个人真的占用引擎。
  var cachedAnalyse = analyseKey ? cacheGet(analyseCache, analyseKey, ANALYSE_CACHE_TTL) : null;
  if (cachedAnalyse) {
    cacheStats.analyseHits += 1;
    return res.json({ code: 200, data: cachedAnalyse });
  }
  // ② 在途合并：第一个人还在算，其余人搭同一个 Promise，全程只跑一次引擎
  var runningAnalyse = analyseKey ? inflightJobs[analyseKey] : null;
  if (runningAnalyse) {
    cacheStats.joined += 1;
    return respondJob(runningAnalyse, res);
  }
  if (overLimit(id)) {
    return res.status(429).json({ code: 429, message: '引擎请求过于频繁', data: { fallback: true } });
  }
  cacheStats.misses += 1;
  var analyseJob = startJob(analyseKey || ('analyse:' + id + ':' + Date.now()), id, function() {
    return engine.analyse({
      board: body.board,
      turn: turn,
      movetime: budget.movetime,
      multiPv: budget.multiPv,
      gameKey: gameKey
    }).then(function(result) {
      // 候选着法逐条过校验：引擎给的是 UCI 串，转成内部坐标后必须能在当前局面下走。
      // 非法项直接剔除（而不是整批失败）——少一条候选不影响面板可用。
      var lines = [];
      for (var i = 0; i < result.lines.length; i++) {
        var line = result.lines[i];
        var verdict = rules.validateMove(body.board, line.move.fr, line.move.fc, line.move.tr, line.move.tc, turn);
        if (!verdict.ok) continue;
        lines.push({
          rank: lines.length + 1,
          uci: line.uci,
          move: {
            fromRow: line.move.fr, fromCol: line.move.fc,
            toRow: line.move.tr, toCol: line.move.tc
          },
          score: line.score,
          depth: line.depth,
          nodes: line.nodes,
          time: line.time,
          pv: line.pv
        });
      }
      return {
        engine: 'pikafish',
        engineName: result.engineName,
        side: result.side,
        depth: result.depth,
        nodes: result.nodes,
        nps: result.nps,
        time: result.time,
        movetime: result.movetime,
        multiPv: budget.multiPv,
        lines: lines
      };
    });
  });
  analyseJob.then(function(payload) { if (payload.ok && analyseKey) cachePut(analyseCache, analyseKey, payload.data); });
  respondJob(analyseJob, res);
});

module.exports = router;
