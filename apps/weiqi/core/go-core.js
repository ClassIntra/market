/*
 * 围棋规则核心 —— 前端（本地对局 / 复盘）、后端（联机权威校验）、AI 共用
 *
 * 设计说明：
 *   - 纯 ES5，无任何宿主依赖；浏览器挂 window.WeiqiCore，Node 走 module.exports。
 *   - 棋盘用一维数组（0 空 / 1 黑 / 2 白），index = row * size + col，row 0 在顶部。
 *   - 规则：中国数子法（默认）/ 日韩数目法；单劫 + 位置超级劫；禁止自杀。
 *   - 终局：双方连续停一手进入「数子」阶段，死子由双方在界面上点选标死后确认；
 *     核心只负责按死子列表算分，不替用户判断死活。
 *   - 本文件是自研实现；规则依据公开的中国围棋竞赛规则（数子法）与 SGF FF[4] 规范。
 */
(function (global) {
  'use strict';

  var EMPTY = 0;
  var BLACK = 1;
  var WHITE = 2;
  var COL_LETTERS = 'ABCDEFGHJKLMNOPQRSTUVWXYZ';

  var NEIGHBOR_CACHE = {};
  var STAR_CACHE = {};

  function otherColor(color) {
    return color === BLACK ? WHITE : BLACK;
  }

  function colorName(color) {
    return color === BLACK ? '黑' : color === WHITE ? '白' : '空';
  }

  // 四邻接表（-1 表示越界）。按棋盘规格缓存，避免每次落子重建。
  function getNeighbors(size) {
    if (NEIGHBOR_CACHE[size]) return NEIGHBOR_CACHE[size];
    var list = new Array(size * size);
    for (var row = 0; row < size; row++) {
      for (var col = 0; col < size; col++) {
        var arr = [];
        if (row > 0) arr.push((row - 1) * size + col);
        if (row < size - 1) arr.push((row + 1) * size + col);
        if (col > 0) arr.push(row * size + col - 1);
        if (col < size - 1) arr.push(row * size + col + 1);
        list[row * size + col] = arr;
      }
    }
    NEIGHBOR_CACHE[size] = list;
    return list;
  }

  function makeBoard(size) {
    var n = size * size;
    var board = new Array(n);
    for (var i = 0; i < n; i++) board[i] = EMPTY;
    return board;
  }

  function boardKey(board) {
    return board.join('');
  }

  function normalizeSize(size) {
    var n = Number(size) || 19;
    if (n < 2) n = 2;
    if (n > 25) n = 25;
    return n;
  }

  function normalizeColor(color) {
    return color === WHITE ? WHITE : color === BLACK ? BLACK : EMPTY;
  }

  // ============ 分组与气 ============
  function collectGroup(board, size, start) {
    var color = board[start];
    var neighbors = getNeighbors(size);
    var stack = [start];
    var seen = {};
    var stones = [];
    var liberties = [];
    var libertySeen = {};
    seen[start] = true;
    while (stack.length) {
      var point = stack.pop();
      stones.push(point);
      var nb = neighbors[point];
      for (var i = 0; i < nb.length; i++) {
        var q = nb[i];
        if (board[q] === EMPTY) {
          if (!libertySeen[q]) {
            libertySeen[q] = true;
            liberties.push(q);
          }
        } else if (board[q] === color && !seen[q]) {
          seen[q] = true;
          stack.push(q);
        }
      }
    }
    return { color: color, stones: stones, liberties: liberties, libertyCount: liberties.length };
  }

  // 单点快速合法性：不修改棋盘。用于候选着法生成（AI / 提示）。
  function isPointEmpty(board, idx) {
    return board[idx] === EMPTY;
  }

  // ============ 状态 ============
  function createState(options) {
    options = options || {};
    var size = normalizeSize(options.size);
    var rules = options.rules === 'japanese' ? 'japanese' : 'chinese';
    var handicap = Math.max(0, Math.min(9, Number(options.handicap) || 0));
    var komi = options.komi === undefined || options.komi === null ? 7.5 : Number(options.komi);
    if (!isFinite(komi)) komi = 7.5;
    if (handicap > 0 && options.komi === undefined) komi = 0.5;

    var board = makeBoard(size);
    var setup = [];
    var i;
    if (Array.isArray(options.setup) && options.setup.length) {
      for (i = 0; i < options.setup.length; i++) {
        var s = options.setup[i];
        var sr = Number(s.row);
        var sc = Number(s.col);
        if (!isFinite(sr) || !isFinite(sc) || sr < 0 || sc < 0 || sr >= size || sc >= size) continue;
        var scolor = s.color === WHITE || s.color === 'white' || s.color === 'W' ? WHITE : BLACK;
        setup.push({ color: scolor, row: sr, col: sc });
        board[sr * size + sc] = scolor;
      }
    } else if (handicap > 0) {
      var points = handicapPoints(size, handicap);
      for (i = 0; i < points.length; i++) {
        setup.push({ color: BLACK, row: points[i][0], col: points[i][1] });
        board[points[i][0] * size + points[i][1]] = BLACK;
      }
      if (setup.length > 1) handicap = setup.length;
    }

    var turn = normalizeColor(options.turn);
    if (!turn) turn = handicap > 1 ? WHITE : BLACK;

    var initialKey = boardKey(board);
    var positions = {};
    positions[initialKey] = true;

    return {
      size: size,
      rules: rules,
      komi: komi,
      handicap: handicap,
      board: board,
      setup: setup,
      turn: turn,
      initialTurn: turn,
      captures: [0, 0, 0],
      moves: [],
      koPoint: -1,
      positions: positions,
      positionKeys: [initialKey],
      passCount: 0,
      status: 'active',
      winner: 0,
      resultText: '',
      resultCode: '',
      lastMove: null,
      invalidAt: -1
    };
  }

  function copyMeta(target, source) {
    target.size = source.size;
    target.rules = source.rules;
    target.komi = source.komi;
    target.handicap = source.handicap;
    target.board = source.board;
    target.setup = source.setup;
    target.turn = source.turn;
    target.initialTurn = source.initialTurn;
    target.captures = source.captures;
    target.moves = source.moves;
    target.koPoint = source.koPoint;
    target.positions = source.positions;
    target.positionKeys = source.positionKeys;
    target.passCount = source.passCount;
    target.status = source.status;
    target.winner = source.winner;
    target.resultText = source.resultText;
    target.resultCode = source.resultCode;
    target.lastMove = source.lastMove;
    target.invalidAt = source.invalidAt;
    return target;
  }

  function cloneState(state) {
    var clone = createState({
      size: state.size,
      rules: state.rules,
      komi: state.komi,
      handicap: state.handicap,
      setup: state.setup,
      turn: state.initialTurn
    });
    clone.board = state.board.slice();
    clone.captures = state.captures.slice();
    clone.moves = state.moves.map(function (move) {
      return {
        color: move.color,
        row: move.row,
        col: move.col,
        pass: !!move.pass,
        captured: move.captured ? move.captured.slice() : [],
        koPoint: move.koPoint
      };
    });
    clone.koPoint = state.koPoint;
    clone.positions = {};
    for (var key in state.positions) {
      if (Object.prototype.hasOwnProperty.call(state.positions, key)) clone.positions[key] = true;
    }
    clone.positionKeys = state.positionKeys.slice();
    clone.passCount = state.passCount;
    clone.status = state.status;
    clone.winner = state.winner;
    clone.resultText = state.resultText;
    clone.resultCode = state.resultCode;
    clone.lastMove = state.lastMove ? { row: state.lastMove.row, col: state.lastMove.col, color: state.lastMove.color } : null;
    clone.invalidAt = state.invalidAt;
    return clone;
  }

  function stateOptions(state) {
    return {
      size: state.size,
      rules: state.rules,
      komi: state.komi,
      handicap: state.handicap,
      setup: state.setup,
      turn: state.initialTurn
    };
  }

  // 用新的着法序列重建状态（悔棋 / 复盘 / 服务端重算共用）。
  // 返回新的 state；调用方可 copyMeta 到原对象上，保持 UI 引用不变。
  function replay(options, moves, settings) {
    settings = settings || {};
    var state = createState(options);
    var list = Array.isArray(moves) ? moves : [];
    for (var i = 0; i < list.length; i++) {
      var move = list[i];
      var result;
      if (move.pass) {
        result = applyPass(state, move.color, { ignoreTurn: !!settings.ignoreTurn, ignoreStatus: true, ignoreEnd: true });
      } else {
        result = applyMove(state, move.color, move.row, move.col, {
          ignoreTurn: !!settings.ignoreTurn,
          ignoreStatus: true,
          ignoreEnd: true
        });
      }
      if (!result.ok) {
        state.invalidAt = i;
        break;
      }
    }
    if (settings.status) {
      state.status = settings.status;
    } else if (settings.autoStatus) {
      state.status = state.passCount >= 2 ? 'scoring' : 'active';
    }
    if (settings.turn) state.turn = settings.turn;
    if (settings.winner) state.winner = settings.winner;
    if (settings.resultText) state.resultText = settings.resultText;
    if (settings.resultCode) state.resultCode = settings.resultCode;
    return state;
  }

  function replaceState(target, source) {
    return copyMeta(target, source);
  }

  // ============ 落子 ============
  function applyMove(state, color, row, col, options) {
    options = options || {};
    color = normalizeColor(color);
    row = Number(row);
    col = Number(col);
    var size = state.size;

    if (state.status !== 'active' && !options.ignoreStatus) {
      return { ok: false, error: '对局不在进行中' };
    }
    if (!color) return { ok: false, error: '棋子颜色不合法' };
    if (!options.ignoreTurn && color !== state.turn) return { ok: false, error: '还没轮到这一方' };
    if (!isFinite(row) || !isFinite(col) || row < 0 || col < 0 || row >= size || col >= size) {
      return { ok: false, error: '坐标超出棋盘' };
    }

    var idx = row * size + col;
    if (state.board[idx] !== EMPTY) return { ok: false, error: '这里已经有棋子' };
    if (idx === state.koPoint) return { ok: false, error: '劫争：不能立即回提' };

    var backup = state.board.slice();
    var oldCaptures = state.captures.slice();
    var oldKo = state.koPoint;
    var neighbors = getNeighbors(size);
    var opponent = otherColor(color);
    var captured = [];
    var processed = {};
    var i;
    var k;

    state.board[idx] = color;

    var nb = neighbors[idx];
    for (i = 0; i < nb.length; i++) {
      var q = nb[i];
      if (state.board[q] !== opponent || processed[q]) continue;
      var group = collectGroup(state.board, size, q);
      var j;
      for (j = 0; j < group.stones.length; j++) processed[group.stones[j]] = true;
      if (group.libertyCount === 0) {
        for (j = 0; j < group.stones.length; j++) {
          state.board[group.stones[j]] = EMPTY;
          captured.push(group.stones[j]);
        }
      }
    }

    var ownGroup = collectGroup(state.board, size, idx);
    if (ownGroup.libertyCount === 0) {
      state.board = backup;
      state.captures = oldCaptures;
      state.koPoint = oldKo;
      return { ok: false, error: '不能自杀' };
    }

    var nextKey = boardKey(state.board);
    if (state.positions[nextKey]) {
      state.board = backup;
      state.captures = oldCaptures;
      state.koPoint = oldKo;
      return { ok: false, error: '全局同形：这手会造成重复局面' };
    }

    var newKo = -1;
    if (captured.length === 1 && ownGroup.stones.length === 1 && ownGroup.libertyCount === 1) {
      newKo = captured[0];
    }

    state.positions[nextKey] = true;
    state.positionKeys.push(nextKey);
    state.captures[color] += captured.length;
    state.koPoint = newKo;
    state.passCount = 0;
    state.turn = opponent;
    state.lastMove = { row: row, col: col, color: color };
    if (state.status === 'scoring') state.status = 'active';
    state.moves.push({ color: color, row: row, col: col, pass: false, captured: captured, koPoint: newKo });

    return { ok: true, captured: captured, koPoint: newKo };
  }

  function applyPass(state, color, options) {
    options = options || {};
    color = normalizeColor(color);
    if (state.status !== 'active' && !options.ignoreStatus) {
      return { ok: false, error: '对局不在进行中' };
    }
    if (!color) return { ok: false, error: '棋子颜色不合法' };
    if (!options.ignoreTurn && color !== state.turn) return { ok: false, error: '还没轮到这一方' };

    state.passCount += 1;
    state.koPoint = -1;
    state.turn = otherColor(color);
    state.lastMove = null;
    state.moves.push({ color: color, row: -1, col: -1, pass: true, captured: [], koPoint: -1 });
    if (state.passCount >= 2 && !options.ignoreEnd) state.status = 'scoring';
    return { ok: true };
  }

  // 轻量合法性判断（供 UI 悬停提示与 AI 兜底校验；不检查全局同形，正式落子仍走 applyMove）。
  function isLegal(state, color, row, col, ignoreTurn) {
    color = normalizeColor(color);
    row = Number(row);
    col = Number(col);
    if (!state || state.status !== 'active' || !color) return false;
    if (!ignoreTurn && color !== state.turn) return false;
    if (!isFinite(row) || !isFinite(col) || row < 0 || col < 0 || row >= state.size || col >= state.size) return false;
    var idx = row * state.size + col;
    if (state.board[idx] !== EMPTY) return false;
    if (idx === state.koPoint) return false;

    var board = state.board.slice();
    var size = state.size;
    var neighbors = getNeighbors(size);
    var opp = otherColor(color);
    var processed = {};
    var i;
    var j;
    board[idx] = color;
    var nb = neighbors[idx];
    for (i = 0; i < nb.length; i++) {
      var q = nb[i];
      if (board[q] !== opp || processed[q]) continue;
      var group = collectGroup(board, size, q);
      for (j = 0; j < group.stones.length; j++) processed[group.stones[j]] = true;
      if (group.libertyCount === 0) {
        for (j = 0; j < group.stones.length; j++) board[group.stones[j]] = EMPTY;
      }
    }
    var own = collectGroup(board, size, idx);
    return own.libertyCount > 0;
  }

  function undo(state) {
    if (!state.moves.length) return null;
    var removed = state.moves[state.moves.length - 1];
    var remaining = state.moves.slice(0, state.moves.length - 1);
    var fresh = replay(stateOptions(state), remaining, {});
    fresh.status = state.status === 'finished' ? 'active' : state.status;
    fresh.winner = 0;
    fresh.resultText = '';
    fresh.resultCode = '';
    if (fresh.passCount >= 2) fresh.status = 'scoring';
    copyMeta(state, fresh);
    return removed;
  }

  function resume(state) {
    state.passCount = 0;
    if (state.status === 'scoring') state.status = 'active';
  }

  function resign(state, color) {
    color = normalizeColor(color);
    if (!color || state.status === 'finished') return false;
    state.status = 'finished';
    state.winner = otherColor(color);
    state.resultText = colorName(state.winner) + '中盘胜';
    state.resultCode = (state.winner === BLACK ? 'B' : 'W') + '+R';
    return true;
  }

  function finishByScore(state, score) {
    state.status = 'finished';
    state.winner = score.winner;
    state.resultText = score.resultText;
    state.resultCode = score.resultCode;
  }

  // ============ 数子 ============
  function normalizeDead(dead) {
    var mask = {};
    if (!dead) return mask;
    if (Array.isArray(dead)) {
      for (var i = 0; i < dead.length; i++) mask[Number(dead[i])] = true;
    } else if (typeof dead === 'object') {
      for (var key in dead) {
        if (!Object.prototype.hasOwnProperty.call(dead, key)) continue;
        if (dead[key]) mask[Number(key)] = true;
      }
    }
    return mask;
  }

  function formatPoints(value) {
    var rounded = Math.round(value * 100) / 100;
    if (Math.abs(rounded - Math.round(rounded)) < 0.001) return String(Math.round(rounded));
    return String(rounded);
  }

  function computeScore(state, dead) {
    var size = state.size;
    var n = size * size;
    var board = state.board.slice();
    var deadMask = normalizeDead(dead);
    var deadBlack = 0;
    var deadWhite = 0;
    var i;
    for (var key in deadMask) {
      if (!Object.prototype.hasOwnProperty.call(deadMask, key)) continue;
      var idx = Number(key);
      if (!isFinite(idx) || idx < 0 || idx >= n) continue;
      if (board[idx] === BLACK) {
        deadBlack += 1;
        board[idx] = EMPTY;
      } else if (board[idx] === WHITE) {
        deadWhite += 1;
        board[idx] = EMPTY;
      }
    }

    var blackStones = 0;
    var whiteStones = 0;
    for (i = 0; i < n; i++) {
      if (board[i] === BLACK) blackStones += 1;
      else if (board[i] === WHITE) whiteStones += 1;
    }

    var territory = new Array(n);
    for (i = 0; i < n; i++) territory[i] = 0;
    var visited = new Array(n);
    var neighbors = getNeighbors(size);
    var blackTerritory = 0;
    var whiteTerritory = 0;

    for (i = 0; i < n; i++) {
      if (board[i] !== EMPTY || visited[i]) continue;
      var stack = [i];
      var region = [];
      var hasBlack = false;
      var hasWhite = false;
      visited[i] = true;
      while (stack.length) {
        var point = stack.pop();
        region.push(point);
        var nb = neighbors[point];
        for (var j = 0; j < nb.length; j++) {
          var q = nb[j];
          if (board[q] === EMPTY) {
            if (!visited[q]) {
              visited[q] = true;
              stack.push(q);
            }
          } else if (board[q] === BLACK) {
            hasBlack = true;
          } else if (board[q] === WHITE) {
            hasWhite = true;
          }
        }
      }
      if (hasBlack && !hasWhite) {
        blackTerritory += region.length;
        for (var a = 0; a < region.length; a++) territory[region[a]] = BLACK;
      } else if (hasWhite && !hasBlack) {
        whiteTerritory += region.length;
        for (var b = 0; b < region.length; b++) territory[region[b]] = WHITE;
      }
    }

    var blackScore;
    var whiteScore;
    if (state.rules === 'japanese') {
      blackScore = blackStones + blackTerritory + state.captures[BLACK] + deadWhite;
      whiteScore = whiteStones + whiteTerritory + state.captures[WHITE] + deadBlack + state.komi;
    } else {
      blackScore = blackStones + blackTerritory;
      whiteScore = whiteStones + whiteTerritory + state.komi;
    }

    var diff = blackScore - whiteScore;
    var winner = diff > 0 ? BLACK : diff < 0 ? WHITE : 0;
    var resultText;
    var resultCode;
    if (winner === 0) {
      resultText = '和棋';
      resultCode = '0';
    } else {
      var lead = Math.abs(diff);
      resultText = colorName(winner) + '胜 ' + formatPoints(lead) + ' 目';
      resultCode = (winner === BLACK ? 'B' : 'W') + '+' + formatPoints(lead);
    }

    return {
      black: blackScore,
      white: whiteScore,
      diff: diff,
      winner: winner,
      resultText: resultText,
      resultCode: resultCode,
      territory: territory,
      deadMask: deadMask,
      deadBlack: deadBlack,
      deadWhite: deadWhite,
      blackStones: blackStones,
      whiteStones: whiteStones,
      blackTerritory: blackTerritory,
      whiteTerritory: whiteTerritory,
      komi: state.komi,
      rules: state.rules
    };
  }

  // 快速形势估计（不做死活判断），供 AI 停一手决策与界面参考。
  function estimateScore(state, dead) {
    return computeScore(state, dead);
  }

  // ============ 坐标 / 星位 / 让子 ============
  function pointLabel(size, row, col) {
    var letter = COL_LETTERS.charAt(col) || '?';
    var number = size - row;
    return letter + number;
  }

  function starPoints(size) {
    if (STAR_CACHE[size]) return STAR_CACHE[size];
    var points = [];
    var mid = (size - 1) / 2;
    if (!isFinite(mid) || mid % 1 !== 0) {
      STAR_CACHE[size] = points;
      return points;
    }
    var line = size >= 19 ? 3 : size >= 13 ? 3 : size >= 9 ? 2 : 1;
    var corners = [
      [line, line],
      [line, size - 1 - line],
      [size - 1 - line, line],
      [size - 1 - line, size - 1 - line]
    ];
    for (var i = 0; i < corners.length; i++) {
      if (corners[i][0] === mid && corners[i][1] === mid) continue;
      points.push(corners[i]);
    }
    points.push([mid, mid]);
    if (size >= 13) {
      points.push([line, mid]);
      points.push([mid, line]);
      points.push([size - 1 - line, mid]);
      points.push([mid, size - 1 - line]);
    }
    STAR_CACHE[size] = points;
    return points;
  }

  function handicapPoints(size, count) {
    var mid = (size - 1) / 2;
    var line = size >= 13 ? 3 : 2;
    var ur = [line, size - 1 - line];
    var ll = [size - 1 - line, line];
    var lr = [size - 1 - line, size - 1 - line];
    var ul = [line, line];
    var center = [mid, mid];
    var left = [mid, line];
    var right = [mid, size - 1 - line];
    var top = [line, mid];
    var bottom = [size - 1 - line, mid];
    var list;
    count = Math.max(0, Math.min(9, Number(count) || 0));
    if (count <= 1) list = count === 1 ? [ur] : [];
    else if (count === 2) list = [ur, ll];
    else if (count === 3) list = [ur, ll, lr];
    else if (count === 4) list = [ur, ll, lr, ul];
    else if (count === 5) list = [ur, ll, lr, ul, center];
    else if (count === 6) list = [ur, ll, lr, ul, left, right];
    else if (count === 7) list = [ur, ll, lr, ul, left, right, center];
    else if (count === 8) list = [ur, ll, lr, ul, left, right, top, bottom];
    else list = [ur, ll, lr, ul, left, right, top, bottom, center];
    return list.slice(0, count);
  }

  // ============ SGF ============
  function escapeSGF(text) {
    return String(text === undefined || text === null ? '' : text)
      .replace(/\\/g, '\\\\')
      .replace(/\]/g, '\\]')
      .replace(/\r?\n/g, '\\n');
  }

  function sgfPoint(size, row, col) {
    if (row < 0 || col < 0 || row >= size || col >= size) return '';
    return String.fromCharCode(97 + col) + String.fromCharCode(97 + row);
  }

  function parseSGFPoint(value, size) {
    if (!value || value.length < 2) return null;
    var col = value.charCodeAt(0) - 97;
    var row = value.charCodeAt(1) - 97;
    if (col < 0 || row < 0 || col >= size || row >= size) return null;
    return { row: row, col: col };
  }

  function toSGF(state, meta) {
    meta = meta || {};
    var size = state.size;
    var parts = ['(;GM[1]FF[4]CA[UTF-8]AP[ClassIntra:Weiqi:1.4]'];
    parts.push('SZ[' + size + ']');
    parts.push('KM[' + formatPoints(state.komi) + ']');
    parts.push('RU[' + (state.rules === 'japanese' ? 'Japanese' : 'Chinese') + ']');
    if (state.handicap > 1) parts.push('HA[' + state.handicap + ']');
    if (meta.blackName) parts.push('PB[' + escapeSGF(meta.blackName) + ']');
    if (meta.whiteName) parts.push('PW[' + escapeSGF(meta.whiteName) + ']');
    if (meta.event) parts.push('EV[' + escapeSGF(meta.event) + ']');
    if (meta.date) parts.push('DT[' + escapeSGF(meta.date) + ']');
    if (meta.comment) parts.push('C[' + escapeSGF(meta.comment) + ']');
    if (state.status === 'finished' && state.resultCode) parts.push('RE[' + state.resultCode + ']');

    var blackSetup = [];
    var whiteSetup = [];
    for (var i = 0; i < state.setup.length; i++) {
      var stone = state.setup[i];
      var coord = sgfPoint(size, stone.row, stone.col);
      if (!coord) continue;
      if (stone.color === BLACK) blackSetup.push('[' + coord + ']');
      else whiteSetup.push('[' + coord + ']');
    }
    if (blackSetup.length) parts.push('AB' + blackSetup.join(''));
    if (whiteSetup.length) parts.push('AW' + whiteSetup.join(''));
    if (state.initialTurn === WHITE && state.handicap <= 1) parts.push('PL[W]');

    for (var m = 0; m < state.moves.length; m++) {
      var move = state.moves[m];
      if (move.pass) {
        parts.push(';' + (move.color === BLACK ? 'B' : 'W') + '[]');
      } else {
        parts.push(';' + (move.color === BLACK ? 'B' : 'W') + '[' + sgfPoint(size, move.row, move.col) + ']');
      }
    }
    parts.push(')');
    return parts.join('');
  }

  function parseSGF(text) {
    if (!text || !String(text).trim()) throw new Error('棋谱内容为空');
    var src = String(text).replace(/^\uFEFF/, '');
    var i = 0;
    var len = src.length;

    function skipWs() {
      while (i < len) {
        var ch = src.charAt(i);
        if (ch === ' ' || ch === '\t' || ch === '\r' || ch === '\n') i++;
        else break;
      }
    }

    function parseValue() {
      i += 1;
      var out = '';
      while (i < len) {
        var ch = src.charAt(i);
        if (ch === '\\') {
          i += 1;
          var next = src.charAt(i);
          if (next === '') break;
          if (next === '\n') { i += 1; continue; }
          if (next === '\r') { i += 1; if (src.charAt(i) === '\n') i += 1; continue; }
          out += next;
          i += 1;
        } else if (ch === ']') {
          i += 1;
          break;
        } else {
          out += ch;
          i += 1;
        }
      }
      return out;
    }

    function parseNode() {
      var props = {};
      while (i < len) {
        skipWs();
        var ch = src.charAt(i);
        if (ch < 'A' || ch > 'Z') {
          if (ch < 'a' || ch > 'z') break;
        }
        var id = '';
        while (i < len) {
          var c = src.charAt(i);
          if ((c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z')) {
            id += c;
            i += 1;
          } else break;
        }
        id = id.toUpperCase();
        if (!id) break;
        var values = [];
        skipWs();
        while (src.charAt(i) === '[') {
          values.push(parseValue());
          skipWs();
        }
        if (!props[id]) props[id] = [];
        props[id] = props[id].concat(values);
      }
      return props;
    }

    function parseCollection() {
      skipWs();
      if (src.charAt(i) !== '(') throw new Error('SGF 格式错误：缺少 (');
      i += 1;
      var nodes = [];
      while (i < len) {
        skipWs();
        if (src.charAt(i) === ';') {
          i += 1;
          nodes.push(parseNode());
        } else break;
      }
      var children = [];
      while (i < len) {
        skipWs();
        if (src.charAt(i) === '(') children.push(parseCollection());
        else break;
      }
      skipWs();
      if (src.charAt(i) === ')') i += 1;
      return { nodes: nodes, children: children };
    }

    function flatten(collection) {
      var out = collection.nodes.slice();
      var current = collection;
      while (current.children && current.children.length) {
        current = current.children[0];
        out = out.concat(current.nodes);
      }
      return out;
    }

    skipWs();
    var rootCollection = parseCollection();
    var nodes = flatten(rootCollection);

    var rootProps = nodes.length ? nodes[0] : {};
    var sizeRaw = rootProps.SZ && rootProps.SZ[0] ? String(rootProps.SZ[0]) : '19';
    var size = normalizeSize(parseInt(sizeRaw.split(':')[0], 10));
    var komiRaw = rootProps.KM && rootProps.KM[0] !== undefined ? parseFloat(rootProps.KM[0]) : NaN;
    var ha = rootProps.HA && rootProps.HA[0] ? parseInt(rootProps.HA[0], 10) : 0;
    var rulesRaw = (rootProps.RU && rootProps.RU[0] || '').toLowerCase();
    var rules = rulesRaw.indexOf('japanese') !== -1 || rulesRaw.indexOf('korean') !== -1 ? 'japanese' : 'chinese';

    var setup = [];
    var seenSetup = {};
    var setupNodes = 0;
    var moves = [];
    var warnings = [];

    for (var n = 0; n < nodes.length; n++) {
      var node = nodes[n];
      var hasMove = !!(node.B && node.B.length || node.W && node.W.length);
      if (!hasMove) {
        var ab = node.AB || [];
        var aw = node.AW || [];
        var ae = node.AE || [];
        if (ab.length || aw.length || ae.length) {
          setupNodes += 1;
          if (moves.length && setupNodes > 1) warnings.push('棋谱中段有摆子，已忽略该节点');
          if (!moves.length) {
            for (var a = 0; a < ab.length; a++) {
              var abPoint = parseSGFPoint(ab[a], size);
              if (abPoint) {
                var abKey = abPoint.row * size + abPoint.col;
                if (!seenSetup[abKey]) {
                  seenSetup[abKey] = true;
                  setup.push({ color: BLACK, row: abPoint.row, col: abPoint.col });
                }
              }
            }
            for (var w = 0; w < aw.length; w++) {
              var awPoint = parseSGFPoint(aw[w], size);
              if (awPoint) {
                var awKey = awPoint.row * size + awPoint.col;
                if (!seenSetup[awKey]) {
                  seenSetup[awKey] = true;
                  setup.push({ color: WHITE, row: awPoint.row, col: awPoint.col });
                }
              }
            }
          }
        }
        continue;
      }
      var color = node.B && node.B.length ? BLACK : WHITE;
      var raw = color === BLACK ? node.B[0] : node.W[0];
      if (!raw || (raw === 'tt' && size <= 19)) {
        moves.push({ color: color, row: -1, col: -1, pass: true });
      } else {
        var point = parseSGFPoint(raw, size);
        if (!point) {
          warnings.push('第 ' + (moves.length + 1) + ' 手坐标无法解析：' + raw);
          break;
        }
        moves.push({ color: color, row: point.row, col: point.col, pass: false });
      }
    }

    var handicap = setup.length > 1 ? setup.length : ha;
    var komi = isFinite(komiRaw) ? komiRaw : (handicap > 1 ? 0.5 : 7.5);
    var turn = BLACK;
    if (rootProps.PL && rootProps.PL[0]) turn = String(rootProps.PL[0]).toUpperCase() === 'W' ? WHITE : BLACK;
    else if (handicap > 1) turn = WHITE;

    var state = createState({ size: size, komi: komi, handicap: handicap, rules: rules, setup: setup, turn: turn });
    for (var m = 0; m < moves.length; m++) {
      var result = moves[m].pass
        ? applyPass(state, moves[m].color, { ignoreTurn: true, ignoreStatus: true, ignoreEnd: true })
        : applyMove(state, moves[m].color, moves[m].row, moves[m].col, { ignoreTurn: true, ignoreStatus: true, ignoreEnd: true });
      if (!result.ok) {
        warnings.push('第 ' + (m + 1) + ' 手不合法（' + result.error + '），后续着法已忽略');
        state.invalidAt = m;
        break;
      }
    }

    var meta = {
      blackName: rootProps.PB && rootProps.PB[0] || '',
      whiteName: rootProps.PW && rootProps.PW[0] || '',
      event: rootProps.EV && rootProps.EV[0] || '',
      date: rootProps.DT && rootProps.DT[0] || '',
      result: rootProps.RE && rootProps.RE[0] || '',
      comment: rootProps.C && rootProps.C[0] || '',
      size: size,
      komi: komi,
      handicap: handicap,
      rules: rules
    };

    return { state: state, moves: moves, meta: meta, warnings: warnings };
  }

  // ============ 导出 ============
  var WeiqiCore = {
    EMPTY: EMPTY,
    BLACK: BLACK,
    WHITE: WHITE,
    otherColor: otherColor,
    colorName: colorName,
    createState: createState,
    cloneState: cloneState,
    replaceState: replaceState,
    replay: replay,
    stateOptions: stateOptions,
    applyMove: applyMove,
    applyPass: applyPass,
    isLegal: isLegal,
    undo: undo,
    resume: resume,
    resign: resign,
    finishByScore: finishByScore,
    computeScore: computeScore,
    estimateScore: estimateScore,
    normalizeDead: normalizeDead,
    collectGroup: collectGroup,
    pointLabel: pointLabel,
    starPoints: starPoints,
    handicapPoints: handicapPoints,
    formatPoints: formatPoints,
    toSGF: toSGF,
    parseSGF: parseSGF,
    boardKey: boardKey,
    getNeighbors: getNeighbors
  };

  if (typeof module === 'object' && module.exports) module.exports = WeiqiCore;
  if (global) global.WeiqiCore = WeiqiCore;
})(typeof self !== 'undefined' ? self : typeof window !== 'undefined' ? window : typeof global !== 'undefined' ? global : null);
