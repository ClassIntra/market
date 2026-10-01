// 中国象棋规则引擎 —— 服务端权威校验副本
// 与 frontend/entry.js 的客户端副本保持同一坐标系与判定：
// board[row][col]，10 行 × 9 列，黑上（row 0-4）红下（row 5-9），红方向 row 减小方向前进。
// 联机走子一律经本模块校验（防客户端作弊）；本地对局由前端副本自行判定。

function pieceColor(piece) { return piece.indexOf('r_') === 0 ? 'red' : 'black'; }
function pieceType(piece) { return piece.slice(2); }
function validCoordinate(r, c) {
  return typeof r === 'number' && typeof c === 'number' &&
    isFinite(r) && isFinite(c) && r >= 0 && r <= 9 && c >= 0 && c <= 8;
}
function inPalace(color, row, col) {
  if (col < 3 || col > 5) return false;
  return color === 'red' ? row >= 7 && row <= 9 : row >= 0 && row <= 2;
}
function isClearPath(board, r1, c1, r2, c2) {
  if (r1 === r2) {
    var step = c2 > c1 ? 1 : -1;
    for (var c = c1 + step; c !== c2; c += step) if (board[r1][c]) return false;
    return true;
  }
  if (c1 === c2) {
    var step2 = r2 > r1 ? 1 : -1;
    for (var r = r1 + step2; r !== r2; r += step2) if (board[r][c1]) return false;
    return true;
  }
  return false;
}
function countPiecesBetween(board, r1, c1, r2, c2) {
  var count = 0;
  if (r1 === r2) {
    var step = c2 > c1 ? 1 : -1;
    for (var c = c1 + step; c !== c2; c += step) if (board[r1][c]) count++;
  } else if (c1 === c2) {
    var step2 = r2 > r1 ? 1 : -1;
    for (var r = r1 + step2; r !== r2; r += step2) if (board[r][c1]) count++;
  }
  return count;
}
function getKingPos(board, color) {
  var king = color === 'red' ? 'r_king' : 'b_king';
  for (var r = 0; r < 10; r++) {
    for (var c = 0; c < 9; c++) {
      if (board[r][c] === king) return { row: r, col: c };
    }
  }
  return null;
}
function canReach(board, fr, fc, tr, tc) {
  if (!validCoordinate(fr, fc) || !validCoordinate(tr, tc)) return { ok: false };
  var piece = board[fr][fc];
  if (!piece) return { ok: false };
  var color = pieceColor(piece);
  var target = board[tr][tc];
  if (target && pieceColor(target) === color) return { ok: false };
  var type = pieceType(piece);
  var dr = Math.abs(tr - fr);
  var dc = Math.abs(tc - fc);
  if (type === 'king') {
    if (!inPalace(color, tr, tc)) return { ok: false };
    if (dr + dc !== 1) return { ok: false };
    return { ok: true };
  }
  if (type === 'guard') {
    if (!inPalace(color, tr, tc)) return { ok: false };
    if (dr !== 1 || dc !== 1) return { ok: false };
    return { ok: true };
  }
  if (type === 'elephant') {
    if (color === 'red' && tr < 5) return { ok: false };
    if (color === 'black' && tr > 4) return { ok: false };
    if (dr !== 2 || dc !== 2) return { ok: false };
    if (board[(fr + tr) / 2][(fc + tc) / 2]) return { ok: false };
    return { ok: true };
  }
  if (type === 'knight') {
    if (!((dr === 2 && dc === 1) || (dr === 1 && dc === 2))) return { ok: false };
    var legRow = dr === 2 ? fr + (tr > fr ? 1 : -1) : fr;
    var legCol = dr === 2 ? fc : fc + (tc > fc ? 1 : -1);
    if (board[legRow][legCol]) return { ok: false };
    return { ok: true };
  }
  if (type === 'rook') {
    if (fr !== tr && fc !== tc) return { ok: false };
    if (!isClearPath(board, fr, fc, tr, tc)) return { ok: false };
    return { ok: true };
  }
  if (type === 'cannon') {
    if (fr !== tr && fc !== tc) return { ok: false };
    var between = countPiecesBetween(board, fr, fc, tr, tc);
    if (target === null ? between !== 0 : between !== 1) return { ok: false };
    return { ok: true };
  }
  if (type === 'pawn') {
    var mr = tr - fr;
    var mc = tc - fc;
    if (color === 'red') {
      if (fr >= 5) { if (!(mr === -1 && mc === 0)) return { ok: false }; }
      else if (!((mr === -1 && mc === 0) || (mr === 0 && Math.abs(mc) === 1))) return { ok: false };
    } else {
      if (fr <= 4) { if (!(mr === 1 && mc === 0)) return { ok: false }; }
      else if (!((mr === 1 && mc === 0) || (mr === 0 && Math.abs(mc) === 1))) return { ok: false };
    }
    return { ok: true };
  }
  return { ok: false };
}
function canAttack(board, fr, fc, tr, tc) {
  var piece = board[fr][fc];
  if (!piece) return false;
  var color = pieceColor(piece);
  var type = pieceType(piece);
  var dr = Math.abs(tr - fr);
  var dc = Math.abs(tc - fc);
  if (type === 'king') return dr + dc === 1 && inPalace(color, tr, tc);
  if (type === 'guard') return dr === 1 && dc === 1 && inPalace(color, tr, tc);
  if (type === 'elephant') {
    if (color === 'red' && tr < 5) return false;
    if (color === 'black' && tr > 4) return false;
    if (dr !== 2 || dc !== 2) return false;
    return !board[(fr + tr) / 2][(fc + tc) / 2];
  }
  if (type === 'knight') {
    if (!((dr === 2 && dc === 1) || (dr === 1 && dc === 2))) return false;
    var legRow = dr === 2 ? fr + (tr > fr ? 1 : -1) : fr;
    var legCol = dr === 2 ? fc : fc + (tc > fc ? 1 : -1);
    return !board[legRow][legCol];
  }
  if (type === 'rook') return fr === tr || fc === tc ? isClearPath(board, fr, fc, tr, tc) : false;
  if (type === 'cannon') return fr === tr || fc === tc ? countPiecesBetween(board, fr, fc, tr, tc) === 1 : false;
  if (type === 'pawn') {
    var mr = tr - fr;
    var mc = tc - fc;
    if (color === 'red') {
      if (fr >= 5) return mr === -1 && mc === 0;
      return (mr === -1 && mc === 0) || (mr === 0 && Math.abs(mc) === 1);
    }
    if (fr <= 4) return mr === 1 && mc === 0;
    return (mr === 1 && mc === 0) || (mr === 0 && Math.abs(mc) === 1);
  }
  return false;
}
function isInCheck(board, color) {
  var king = getKingPos(board, color);
  if (!king) return false;
  var oppPrefix = color === 'red' ? 'b_' : 'r_';
  var oppKing = getKingPos(board, color === 'red' ? 'black' : 'red');
  // 将见面：两将同列且中间无子，当前局面直接违规
  if (oppKing && oppKing.col === king.col) {
    var clear = true;
    var from = Math.min(king.row, oppKing.row);
    var to = Math.max(king.row, oppKing.row);
    for (var r = from + 1; r < to; r++) {
      if (board[r][king.col]) { clear = false; break; }
    }
    if (clear) return true;
  }
  for (var row = 0; row < 10; row++) {
    for (var col = 0; col < 9; col++) {
      var piece = board[row][col];
      if (piece && piece.indexOf(oppPrefix) === 0 && canAttack(board, row, col, king.row, king.col)) return true;
    }
  }
  return false;
}
function validateMove(board, fr, fc, tr, tc, color) {
  var piece = board[fr][fc];
  if (!piece) return { ok: false, message: '起始位置没有棋子' };
  if (pieceColor(piece) !== color) return { ok: false, message: '只能移动自己的棋子' };
  var target = board[tr][tc];
  if (target && pieceColor(target) === color) return { ok: false, message: '目标位置有自己的棋子' };
  var reach = canReach(board, fr, fc, tr, tc);
  if (!reach.ok) return { ok: false, message: '不符合走子规则' };
  var next = board.map(function(row) { return row.slice(); });
  next[tr][tc] = next[fr][fc];
  next[fr][fc] = null;
  var redKing = getKingPos(next, 'red');
  var blackKing = getKingPos(next, 'black');
  if (redKing && blackKing && redKing.col === blackKing.col) {
    var clear = true;
    var from = Math.min(redKing.row, blackKing.row);
    var to = Math.max(redKing.row, blackKing.row);
    for (var r = from + 1; r < to; r++) {
      if (next[r][redKing.col]) { clear = false; break; }
    }
    if (clear) return { ok: false, message: '不能送将（将帅直接对面）' };
  }
  if (isInCheck(next, color)) return { ok: false, message: '走后会被将军，不能送将' };
  return { ok: true };
}
function hasAnyMove(board, color) {
  for (var r = 0; r < 10; r++) {
    for (var c = 0; c < 9; c++) {
      var piece = board[r][c];
      if (piece && pieceColor(piece) === color) {
        for (var tr = 0; tr < 10; tr++) {
          for (var tc = 0; tc < 9; tc++) {
            if (validateMove(board, r, c, tr, tc, color).ok) return true;
          }
        }
      }
    }
  }
  return false;
}
// 将死：被将军且无任何可解除的走法
function isCheckmate(board, color) {
  return isInCheck(board, color) && !hasAnyMove(board, color);
}
// 困毙：未被将军但无子可动。注意**中国象棋判负**（困毙方输，走子方胜），
// 国际象棋的 stalemate 才是和棋——判负逻辑在 routes.js 的 move 路由里，别在这里改语义。
function isStalemate(board, color) {
  return !isInCheck(board, color) && !hasAnyMove(board, color);
}
function initialBoard() {
  return [
    ['b_rook', 'b_knight', 'b_elephant', 'b_guard', 'b_king', 'b_guard', 'b_elephant', 'b_knight', 'b_rook'],
    [null, null, null, null, null, null, null, null, null],
    [null, 'b_cannon', null, null, null, null, null, 'b_cannon', null],
    ['b_pawn', null, 'b_pawn', null, 'b_pawn', null, 'b_pawn', null, 'b_pawn'],
    [null, null, null, null, null, null, null, null, null],
    [null, null, null, null, null, null, null, null, null],
    ['r_pawn', null, 'r_pawn', null, 'r_pawn', null, 'r_pawn', null, 'r_pawn'],
    [null, 'r_cannon', null, null, null, null, null, 'r_cannon', null],
    [null, null, null, null, null, null, null, null, null],
    ['r_rook', 'r_knight', 'r_elephant', 'r_guard', 'r_king', 'r_guard', 'r_elephant', 'r_knight', 'r_rook']
  ];
}

module.exports = {
  initialBoard: initialBoard,
  isInCheck: isInCheck,
  isCheckmate: isCheckmate,
  isStalemate: isStalemate,
  hasAnyMove: hasAnyMove,
  validateMove: validateMove,
  validCoordinate: validCoordinate,
  pieceColor: pieceColor
};
