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

module.exports = router;
