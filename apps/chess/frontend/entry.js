(function() {
  var NAME = 'chess';
  var definitions = window.ClassIntraMarket && window.ClassIntraMarket.apps;

  // 清空子节点。
  // 不用 Element.replaceChildren()：该 API 需 Chrome 86+，校园平板基线为 Chrome 80，
  // 调用会抛 TypeError 导致挂载整体失败。
  function clearChildren(el) {
    if (!el) return;
    while (el.firstChild) el.removeChild(el.firstChild);
  }

  // 取 HTTP 客户端（规范入口 context.data.api，context.api 为 v1 兼容别名）。
  function httpClient(context) {
    if (context && context.data && context.data.api) return context.data.api;
    if (context && context.api) return context.api;
    return null;
  }

  function request(context, method, path, body) {
    var client = httpClient(context);
    var action = client && client[method.toLowerCase()];
    if (typeof action !== 'function') return Promise.reject(new Error('SDK API 不可用'));
    var response = method === 'GET' ? action.call(client, path) : action.call(client, path, body);
    return response.then(function(result) {
      var payload = result && result.data ? result.data : result;
      return payload && payload.data ? payload.data : payload;
    });
  }

  // 用 createElement 构建静态骨架，不用 innerHTML ——
  // 一是规避审查的 XSS 直插告警，二是避免 Chrome 80 上大段字符串解析的额外开销。
  // t(tag, className, attrs, children) 为最小构建器。
  function t(tag, className, attrs, children) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (attrs) {
      Object.keys(attrs).forEach(function(key) {
        if (attrs[key] === null || attrs[key] === undefined) return;
        if (key === 'text') node.textContent = attrs[key];
        else node.setAttribute(key, attrs[key]);
      });
    }
    (children || []).forEach(function(child) { node.appendChild(child); });
    return node;
  }

  // 提取后端业务错误消息：axios 默认消息生硬，可读提示在 error.response.data.message 里
  function errMsg(error, fallback) {
    var data = error && error.response && error.response.data;
    return (data && data.message) || (error && error.message) || fallback;
  }

  // ===== 棋子文字 =====
  var PIECE_CHARS = {
    'r_king': '帅', 'r_guard': '仕', 'r_elephant': '相', 'r_knight': '马',
    'r_rook': '车', 'r_cannon': '炮', 'r_pawn': '兵',
    'b_king': '将', 'b_guard': '士', 'b_elephant': '象', 'b_knight': '马',
    'b_rook': '车', 'b_cannon': '炮', 'b_pawn': '卒'
  };

  // ===== 象棋规则（客户端副本）=====
  // 与 backend/rules.js 保持同一坐标系与判定：board[row][col]，10 行 × 9 列，
  // 黑上（row 0-4）红下（row 5-9），红方向 row 减小方向前进。
  // 客户端副本用于本地对局判走法与联机落点提示；联机走子仍以后端校验为准。
  function pieceColor(piece) { return piece.indexOf('r_') === 0 ? 'red' : 'black'; }
  function pieceType(piece) { return piece.slice(2); }
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
    if (fr < 0 || fr > 9 || fc < 0 || fc > 8 || tr < 0 || tr > 9 || tc < 0 || tc > 8) return { ok: false };
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
    if (!piece || pieceColor(piece) !== color) return { ok: false };
    var reach = canReach(board, fr, fc, tr, tc);
    if (!reach.ok) return reach;
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
      if (clear) return { ok: false };
    }
    if (isInCheck(next, color)) return { ok: false };
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
  function legalMoves(board, fr, fc) {
    var piece = board[fr][fc];
    if (!piece) return [];
    var color = pieceColor(piece);
    var moves = [];
    for (var tr = 0; tr < 10; tr++) {
      for (var tc = 0; tc < 9; tc++) {
        if (tr === fr && tc === fc) continue;
        if (validateMove(board, fr, fc, tr, tc, color).ok) moves.push({ row: tr, col: tc });
      }
    }
    return moves;
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

  // ===== 棋盘线层 SVG（静态装饰）=====
  // viewBox 540×600：PADDING=30、格距 60、8 列 9 行格。棋子交点定位：
  // left = (30 + col*60)/540、top = (30 + row*60)/600（百分比对齐线层）。
  var BOARD_W = 540;
  var BOARD_H = 600;
  var BOARD_PAD = 30;
  var BOARD_CELL = 60;
  function pointLeft(col) { return ((BOARD_PAD + col * BOARD_CELL) / BOARD_W * 100) + '%'; }
  function pointTop(row) { return ((BOARD_PAD + row * BOARD_CELL) / BOARD_H * 100) + '%'; }

  function boardSvgMarkup() {
    var P = BOARD_PAD, C = BOARD_CELL;
    var paths = [];
    var r, c;
    // 10 条横线
    for (r = 0; r < 10; r++) paths.push('M' + P + ' ' + (P + r * C) + 'H' + (P + 8 * C));
    // 9 条竖线：楚河汉界处断开，首末两条贯通
    for (c = 0; c < 9; c++) {
      var x = P + c * C;
      if (c === 0 || c === 8) {
        paths.push('M' + x + ' ' + P + 'V' + (P + 9 * C));
      } else {
        paths.push('M' + x + ' ' + P + 'V' + (P + 4 * C));
        paths.push('M' + x + ' ' + (P + 5 * C) + 'V' + (P + 9 * C));
      }
    }
    // 九宫斜线（黑上 / 红下）
    paths.push('M' + (P + 3 * C) + ' ' + P + 'L' + (P + 5 * C) + ' ' + (P + 2 * C));
    paths.push('M' + (P + 5 * C) + ' ' + P + 'L' + (P + 3 * C) + ' ' + (P + 2 * C));
    paths.push('M' + (P + 3 * C) + ' ' + (P + 7 * C) + 'L' + (P + 5 * C) + ' ' + (P + 9 * C));
    paths.push('M' + (P + 5 * C) + ' ' + (P + 7 * C) + 'L' + (P + 3 * C) + ' ' + (P + 9 * C));
    // 炮位 / 兵位四角标记
    var markPoints = [];
    [1, 7].forEach(function(col) { markPoints.push([2, col], [7, col]); });
    [0, 2, 4, 6, 8].forEach(function(col) { markPoints.push([3, col], [6, col]); });
    var g = 5, d = 13;
    markPoints.forEach(function(pt) {
      var mx = P + pt[1] * C, my = P + pt[0] * C;
      [-1, 1].forEach(function(side) {
        if (pt[1] === 0 && side === -1) return;
        if (pt[1] === 8 && side === 1) return;
        var sx = mx + side * g;
        var ex = mx + side * (g + d);
        paths.push('M' + Math.min(sx, ex) + ' ' + (my - g) + 'H' + Math.max(sx, ex));
        paths.push('M' + Math.min(sx, ex) + ' ' + (my + g) + 'H' + Math.max(sx, ex));
        paths.push('M' + sx + ' ' + (my - g) + 'V' + (my - g - d));
        paths.push('M' + sx + ' ' + (my + g) + 'V' + (my + g + d));
      });
    });
    var mark = '<path d="' + paths.join('') + '" fill="none" stroke="#6d4c22" stroke-width="1.5" opacity="0.8"/>';
    var border = '<rect x="3.5" y="3.5" width="' + (BOARD_W - 7) + '" height="' + (BOARD_H - 7) + '" fill="none" stroke="#5e4018" stroke-width="2.5" opacity="0.85"/>';
    var river =
      '<text x="90" y="300" class="chess-river-text">楚</text>' +
      '<text x="150" y="300" class="chess-river-text">河</text>' +
      '<text x="390" y="300" class="chess-river-text">汉</text>' +
      '<text x="450" y="300" class="chess-river-text">界</text>';
    return '<svg viewBox="0 0 ' + BOARD_W + ' ' + BOARD_H + '" preserveAspectRatio="none" aria-hidden="true">' + border + mark + river + '</svg>';
  }

  function buildShell() {
    var status = t('p', 'chess-status', { 'aria-live': 'polite' });
    // 模式名与身份描述：挪进标题栏做副标题（room/identity 由渲染逻辑经 data-role 原地更新），
    // 连接红绿灯进标题栏右区
    var room = t('span', null, { 'data-role': 'room', text: '未进入房间' });
    var identity = t('span', null, { 'data-role': 'identity' });
    var connection = t('span', null, { 'data-role': 'connection', text: '未连接' });
    // 标题栏只留高频按钮：悔棋/认输/离开房间。低频的复制房间码/发到聊天
    // 移入侧栏「房间操作」区——五按钮全挤标题栏时右区 ~450px 宽，
    // 触发 ≤1180px 换行规则，联机对局标题栏变成两行（用户实测反馈）
    var actions = t('div', 'chess-actions', null, [
      t('button', 'is-secondary', { type: 'button', 'data-action': 'undo', text: '悔棋' }),
      t('button', 'is-secondary', { type: 'button', 'data-action': 'resign', text: '认输' }),
      t('button', 'is-secondary', { type: 'button', 'data-action': 'leave', text: '离开房间' })
    ]);
    // 头部即标题栏：manifest layout.navbar=custom 隐藏系统导航栏后，
    // 本头部承担标题栏职责。布局：返回 → 标题 → 对局信息段 → 右区灯+按钮
    var head = t('div', 'chess-header', null, [
      t('div', 'chess-header-left', null, [
        t('button', 'chess-back', { type: 'button', 'data-action': 'home', text: '返回' })
      ]),
      t('h1', 'chess-title', { text: '中国象棋' }),
      t('span', 'chess-subtitle', null, [status, room, identity]),
      t('div', 'chess-header-right', null, [connection, actions])
    ]);

    var roomInput = t('input', null, { 'data-field': 'room', maxlength: '6', autocomplete: 'off', placeholder: '4 位房间码', inputmode: 'numeric' });
    var roomLabel = t('label', null, { text: '房间码' });
    roomLabel.appendChild(roomInput);

    var entryCard = t('div', 'chess-entry-card', null, [
      t('h2', null, { text: '进入棋局' }),
      t('p', null, { text: '创建房间邀请同学对战，或用本地模式同屏对弈。红方先行。' }),
      t('div', 'chess-entry-row', null, [
        t('button', null, { type: 'button', 'data-action': 'create', text: '创建房间' })
      ]),
      t('div', 'chess-entry-row', null, [
        roomLabel,
        t('button', null, { type: 'button', 'data-action': 'join', text: '加入对局' }),
        t('button', 'is-secondary', { type: 'button', 'data-action': 'watch', text: '观战' })
      ]),
      t('div', 'chess-entry-row', null, [
        t('span', 'chess-entry-hint', { text: '单机模式' }),
        t('button', 'is-secondary', { type: 'button', 'data-action': 'local', text: '本地对战' })
      ])
    ]);
    var entry = t('div', 'chess-entry', null, [entryCard]);

    // ⚠️ 错误/提示条必须挂在 shell 层（房间内也可见），对齐 gomoku 的教训
    var error = t('p', 'chess-error', { 'data-role': 'error', 'aria-live': 'polite' });

    var board = t('div', 'chess-board', { role: 'grid', 'aria-label': '中国象棋棋盘' });
    // 回合横幅：侧栏顶部醒目展示当前手/胜负（放侧栏不加高、不挤棋盘；
    // 纯静态换色，无动效——遵循「棋子/界面不动」的反馈原则）
    var turnBanner = t('div', 'chess-turn-banner', { 'data-role': 'turn-banner', 'aria-live': 'polite' });
    turnBanner.hidden = true;
    // 被吃子展示：由初始子力推导（见 renderCaptured），不依赖后端字段
    var captured = t('div', 'chess-captured', { 'data-role': 'captured' });
    // 房间操作区（侧栏）：从标题栏移入的低频按钮，仅房间模式显示。
    // 「换方」放在这里而非「继续下一局」旁：换方只在尚未走子时有意义（后端也如此校验），
    // 对局结束后才是它的可用窗口反而是反的——放在常驻的房间操作区里随时可见、随时可点。
    var roomTools = t('div', 'chess-room-tools', { 'data-role': 'room-tools' }, [
      t('button', 'is-secondary', { type: 'button', 'data-action': 'copy', text: '复制房间码' }),
      t('button', 'is-secondary', { type: 'button', 'data-action': 'share-chat', text: '发到聊天' }),
      t('button', 'is-secondary', { type: 'button', 'data-action': 'share-community', text: '发到社区' }),
      t('button', 'is-secondary', { type: 'button', 'data-action': 'color', text: '换方' })
    ]);
    roomTools.hidden = true;
    // 房间快捷聊天（侧栏「聊天」页）：玩家与观战者都能发言，消息随房间销毁（关房/空置）。
    var chatList = t('ul', 'chess-chat-list', { 'data-role': 'chat-list' }, [
      t('li', 'chess-chat-empty', { text: '还没有人发言' })
    ]);
    var chatInput = t('input', 'chess-chat-input', {
      'data-field': 'chat', type: 'text', maxlength: '200',
      autocomplete: 'off', enterkeyhint: 'send', placeholder: '说点什么…'
    });
    var chat = t('div', 'chess-chat', { 'data-role': 'chat', role: 'tabpanel', 'aria-labelledby': 'chess-tab-chat' }, [
      chatList,
      t('div', 'chess-chat-form', null, [
        chatInput,
        t('button', 'chess-chat-send', { type: 'button', 'data-action': 'chat-send', text: '发送' })
      ])
    ]);
    chat.hidden = true;
    // 侧栏双页（信息 / 聊天）互斥显示：聊天页常驻会把成员与房间操作一路顶下去，
    // 侧栏高度随消息增长；横屏平板下 .chess-app 是 overflow:hidden，撑出去的部分
    // 既看不到也滑不动（2026-09-22 实测：聊天 8 条时侧栏 811px、棋盘 609px，底部越出视口 270px）。
    var infoPanel = t('div', 'chess-info-panel', { 'data-role': 'info-panel', role: 'tabpanel', 'aria-labelledby': 'chess-tab-info' }, [
      t('h2', null, { 'data-role': 'info-title', text: '房间成员' }),
      t('ul', null, { 'data-role': 'members' }),
      captured,
      roomTools,
      t('div', 'chess-finished', null, [
        t('p', null, { 'data-role': 'finished' }),
        t('button', null, { type: 'button', 'data-action': 'continue', text: '继续下一局' })
      ])
    ]);
    // 未读徽标：不打断对局，但也不能漏掉对手发言
    var chatTabBadge = t('span', 'chess-tab-badge', { text: '' });
    chatTabBadge.hidden = true;
    var chatTabButton = t('button', 'chess-tab', {
      type: 'button', 'data-action': 'tab-chat', role: 'tab', id: 'chess-tab-chat', 'aria-selected': 'false'
    }, [t('span', 'chess-tab-label', { text: '聊天' }), chatTabBadge]);
    var infoTabButton = t('button', 'chess-tab is-active', {
      type: 'button', 'data-action': 'tab-info', role: 'tab', id: 'chess-tab-info', 'aria-selected': 'true', text: '房间信息'
    });
    var tabs = t('div', 'chess-info-tabs', { role: 'tablist', 'aria-label': '侧栏切换' }, [infoTabButton, chatTabButton]);
    tabs.hidden = true;
    var info = t('aside', 'chess-info', null, [turnBanner, tabs, infoPanel, chat]);
    var layout = t('div', 'chess-layout', null, [board, info]);

    // 标题栏是 .chess-app 的直接子级：shell 有限宽居中，header 移出后全宽贴顶贴边
    return t('section', 'chess-app', null, [
      head,
      t('div', 'chess-shell', null, [entry, error, layout])
    ]);
  }

  function mount(container, context) {
    if (!container || container.__chessUnmount) return;
    var websocket = context.websocket || (window.ClassIntra && window.ClassIntra.websocket);
    var realtime = context.realtime;
    if (realtime && typeof realtime.connect === 'function') realtime.connect();
    var route = context.route || {};
    var routeRoom = (route.params && (route.params.roomCode || route.params.room_code)) || (route.query && (route.query.roomCode || route.query.room_code));
    var roomCode = routeRoom ? String(routeRoom).toUpperCase() : '';
    // 对局模式：'' 未进入 | 'room' 房间联机 | 'local' 本地双人（纯本地，不走后端）
    var mode = roomCode ? 'room' : '';
    var disposed = false;
    var pending = false;
    var selected = null;          // 当前选中棋子 { row, col }
    var legal = [];               // 选中棋子的合法落点提示
    var lastAnimatedKey = '';     // 最新一手动画去重键
    var labelsPrimed = false;     // 无障碍标签首轮是否已补齐
    // 本地对弈走子历史（悔棋依据）：{ fr, fc, tr, tc, piece, captured }
    var localHistory = [];
    var state = { board: initialBoard(), turn: 'red', winner: null, result: null, status: 'active', check: false, members: [], lastMove: null };
    // 会话持久化：切去聊天/社区再返回时恢复本地对局与房间（sessionStorage，关页即清）
    var SESSION_KEY = 'chess_session';
    function saveSession() {
      try {
        if (mode === 'room' && roomCode) {
          sessionStorage.setItem(SESSION_KEY, JSON.stringify({ mode: 'room', roomCode: roomCode }));
        } else if (mode === 'local' && (localHistory.length || state.winner)) {
          sessionStorage.setItem(SESSION_KEY, JSON.stringify({
            mode: 'local',
            offline: { board: state.board, turn: state.turn, winner: state.winner, result: state.result, status: state.status, lastMove: state.lastMove, history: localHistory }
          }));
        } else if (mode === 'local') {
          clearSession();
        }
      } catch (e) {}
    }
    function readSession() {
      try { return JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null'); } catch (e) { return null; }
    }
    function clearSession() { try { sessionStorage.removeItem(SESSION_KEY); } catch (e) {} }

    var subscriptions = [];
    var root = buildShell();
    clearChildren(container);
    container.appendChild(root);

    var statusElement = root.querySelector('.chess-status');
    var boardElement = root.querySelector('.chess-board');
    var entryElement = root.querySelector('.chess-entry');
    var errorElement = root.querySelector('.chess-error');
    var roomElement = root.querySelector('[data-role="room"]');
    var identityElement = root.querySelector('[data-role="identity"]');
    var connectionElement = root.querySelector('[data-role="connection"]');
    var membersElement = root.querySelector('[data-role="members"]');
    var infoTitleElement = root.querySelector('[data-role="info-title"]');
    var bannerElement = root.querySelector('[data-role="turn-banner"]');
    var capturedElement = root.querySelector('[data-role="captured"]');
    var finishedElement = root.querySelector('[data-role="finished"]');
    var roomToolsElement = root.querySelector('[data-role="room-tools"]');
    // 渲染热路径复用的节点引用：render 每次点击/推送都会跑，
    // querySelector 全家桶挪到 mount 时一次性缓存
    var headerActionButtons = root.querySelectorAll('.chess-actions [data-action], .chess-room-tools [data-action]');
    var leaveButton = root.querySelector('[data-action="leave"]');
    var undoButton = root.querySelector('[data-action="undo"]');
    var resignButton = root.querySelector('[data-action="resign"]');
    var copyButton = root.querySelector('[data-action="copy"]');
    var shareButton = root.querySelector('[data-action="share-chat"]');
    var communityButton = root.querySelector('[data-action="share-community"]');
    var colorButton = root.querySelector('[data-action="color"]');
    var continueButton = root.querySelector('[data-action="continue"]');
    var chatElement = root.querySelector('[data-role="chat"]');
    var chatListElement = root.querySelector('[data-role="chat-list"]');
    var chatInputElement = root.querySelector('[data-field="chat"]');
    var chatSendButton = root.querySelector('[data-action="chat-send"]');
    // 侧栏双页与提示条归位所需的节点：render 是热路径，全部在此一次性缓存
    var infoElement = root.querySelector('.chess-info');
    var shellElement = root.querySelector('.chess-shell');
    var layoutElement = root.querySelector('.chess-layout');
    var infoPanelElement = root.querySelector('[data-role="info-panel"]');
    var tabsElement = root.querySelector('.chess-info-tabs');
    var infoTabButtonElement = root.querySelector('[data-action="tab-info"]');
    var chatTabButtonElement = root.querySelector('[data-action="tab-chat"]');
    var chatTabBadgeElement = root.querySelector('.chess-tab-badge');

    function currentUserId() {
      return String(context.user && (context.user.user_id || context.user.id) || '');
    }
    function currentMember() {
      return state.members.filter(function(member) { return String(member.user_id) === currentUserId(); })[0] || null;
    }
    function setError(message) { errorElement.textContent = message || ''; }
    function send(message) { if (websocket && typeof websocket.send === 'function') websocket.send(message); }
    function onSocket(type, handler) {
      if (!websocket || typeof websocket.on !== 'function') return;
      websocket.on(type, handler);
      subscriptions.push(function() { if (typeof websocket.off === 'function') websocket.off(type, handler); });
    }
    function shareRoom(target) {
      if (!roomCode) { setError('请先进入房间'); return; }
      if (!context.router || typeof context.router.push !== 'function') {
        setError('当前环境不支持跳转，房间码：' + roomCode);
        return;
      }
      if (target === 'community') {
        // 社区：预填带 [chess:房间码] 标记的文本，发布后帖子内由社区页渲染为可点击邀请卡片
        var text = '来和我下一盘中国象棋！\n\n[chess:' + roomCode + ']';
        context.router.push({ path: '/community', query: { prefill: encodeURIComponent(text) } });
        setError('已打开社区发帖，发布后显示邀请卡片');
        return;
      }
      // 卡片消息：走聊天页现成的转发通道（?forward=&forwardType=）
      var cardData = {
        app: 'chess',
        roomCode: roomCode,
        senderName: (context.user && (context.user.net_name || context.user.user_id)) || ''
      };
      context.router.push('/chat?forward=' + encodeURIComponent(JSON.stringify(cardData)) + '&forwardType=chess_invite');
      setError('已打开聊天，选择会话即可发送邀请卡片');
    }

    // ===== 房间快捷聊天 =====
    // 消息以 textContent 渲染（绝不 innerHTML）：内容来自其他学生，按纯文本处理。
    var CHAT_MAX_NODES = 80;   // DOM 节点上限：超出丢最旧，长会话不拖慢合成
    var chatIds = {};          // id 去重表：自己的发言会经「POST 响应」和「实时广播」各到一次
    var chatSending = false;
    // 会话代次：离房/换房/恢复时 +1。异步回调（GET/POST 响应）回来时若代次已变，
    // 说明这条数据属于「上一个房间」，必须丢弃——否则会把旧房间的发言渲染进新房间的列表
    var chatEpoch = 0;
    // 历史是否已加载完：加载完成前的实时广播一律不追加，该区间的消息由随后的 GET 全量补齐
    var chatReady = false;
    // 侧栏双页状态：'info' | 'chat'。未读数只在「不在聊天页」时累积，进聊天页即清零
    var activeTab = 'info';
    var chatUnread = 0;
    // 历史回填期间不计未读，否则每次进房都会看到一串未读
    var chatHistoryRendering = false;

    function renderTabs() {
      var inRoom = mode === 'room' && !!roomCode;
      if (tabsElement) tabsElement.hidden = !inRoom;
      if (chatElement) chatElement.hidden = !inRoom || activeTab !== 'chat';
      // 信息页：非房间态（入场/本地对战）恒显示；房间态下与聊天页互斥
      if (infoPanelElement) infoPanelElement.hidden = inRoom && activeTab !== 'info';
      var infoActive = !inRoom || activeTab === 'info';
      if (infoTabButtonElement) {
        setClass(infoTabButtonElement, 'chess-tab' + (infoActive ? ' is-active' : ''));
        infoTabButtonElement.setAttribute('aria-selected', infoActive ? 'true' : 'false');
      }
      var chatActive = inRoom && activeTab === 'chat';
      var showBadge = inRoom && !chatActive && chatUnread > 0;
      if (chatTabButtonElement) {
        setClass(chatTabButtonElement, 'chess-tab' + (chatActive ? ' is-active' : '') + (showBadge ? ' is-unread' : ''));
        chatTabButtonElement.setAttribute('aria-selected', chatActive ? 'true' : 'false');
      }
      if (chatTabBadgeElement) {
        var badge = showBadge ? (chatUnread > 99 ? '99+' : String(chatUnread)) : '';
        if (chatTabBadgeElement.textContent !== badge) chatTabBadgeElement.textContent = badge;
        chatTabBadgeElement.hidden = !badge;
      }
    }
    function setTab(tab) {
      var next = tab === 'chat' ? 'chat' : 'info';
      if (next === activeTab) return;
      activeTab = next;
      if (activeTab === 'chat') chatUnread = 0;
      renderTabs();
    }

    function chatAtBottom() {
      return chatListElement.scrollHeight - chatListElement.scrollTop - chatListElement.clientHeight < 28;
    }
    function chatClear() {
      chatEpoch++;             // 一切清空动作都视为进入新一代，作废此前所有在途回调
      chatReady = false;
      chatUnread = 0;          // 列表清空即无未读
      chatIds = {};
      clearChildren(chatListElement);
      chatListElement.appendChild(t('li', 'chess-chat-empty', { text: '还没有人发言' }));
      renderTabs();
    }
    // 调用方（loadChatMessages / sendChat）必须先用 chatEpoch 校验再调用：
    // 本函数只负责渲染，不做代次判断
    function appendChatMessage(message) {
      if (!message || message.id === undefined || message.id === null) return;
      var key = String(message.id);
      if (chatIds[key]) return;   // 同一条消息到两次（响应 + 广播）只渲染一次
      chatIds[key] = true;
      var mine = String(message.userId) === currentUserId();
      var stick = chatAtBottom();
      var empty = chatListElement.querySelector('.chess-chat-empty');
      if (empty) chatListElement.removeChild(empty);
      chatListElement.appendChild(t('li', 'chess-chat-item' + (mine ? ' is-me' : ''), { 'data-id': key }, [
        t('span', 'chess-chat-name', { text: mine ? '我' : String(message.netName || message.userId || '同学') }),
        t('span', 'chess-chat-text', { text: message.content })
      ]));
      while (chatListElement.childNodes.length > CHAT_MAX_NODES) {
        var first = chatListElement.firstChild;
        if (first.className && first.className.indexOf('chess-chat-item') !== -1) {
          delete chatIds[String(first.getAttribute('data-id'))];
        }
        chatListElement.removeChild(first);
      }
      // 未读计数：只有「别人发言 + 我不在聊天页 + 不是历史回填」才累加，
      // 徽标挂在聊天页标签上（进聊天页即清零）
      if (!mine && !chatHistoryRendering && mode === 'room' && activeTab !== 'chat') {
        chatUnread++;
        renderTabs();
      }
      // 自己刚发的必须可见；别人发的只在用户本来就贴着底部时跟随（往上翻历史时不打断）
      if (stick || mine) chatListElement.scrollTop = chatListElement.scrollHeight;
    }
    function loadChatMessages() {
      if (!roomCode) { chatClear(); return; }
      // 快照：请求发出后用户可能已离房或换房，回调回来时靠这对值识别并丢弃
      var reqCode = roomCode;
      var reqEpoch = chatEpoch;
      request(context, 'GET', '/chess/rooms/' + encodeURIComponent(reqCode) + '/messages').then(function(data) {
        if (reqEpoch !== chatEpoch || reqCode !== roomCode) return;   // 房间已切换，这批消息作废
        var messages = (data && data.messages) || [];
        chatClear();
        chatHistoryRendering = true;   // 历史回填不计未读
        for (var i = 0; i < messages.length; i++) appendChatMessage(messages[i]);
        chatHistoryRendering = false;
        chatListElement.scrollTop = chatListElement.scrollHeight;
        chatReady = true;
      }).catch(function() {
        // 聊天是辅助能力：拉取失败（如成员行尚未落库的瞬时 403）静默留空即可，
        // 不占用错误条——错误条要留给走子/房间操作这类关键失败
        if (reqEpoch !== chatEpoch || reqCode !== roomCode) return;
        chatClear();
      });
    }
    function sendChat() {
      if (!roomCode || chatSending) return;
      var text = String(chatInputElement.value || '').trim();
      if (!text) return;
      var reqCode = roomCode;
      var reqEpoch = chatEpoch;
      chatSending = true;
      // 只禁发送按钮、不禁输入框：在平板上禁用输入框会收起软键盘，连续发言要重新点一次
      if (chatSendButton) chatSendButton.disabled = true;
      request(context, 'POST', '/chess/rooms/' + encodeURIComponent(reqCode) + '/messages', { content: text }).then(function(message) {
        if (reqEpoch !== chatEpoch || reqCode !== roomCode) return;   // 发送期间已离房/换房
        appendChatMessage(message);
        chatInputElement.value = '';
        setError('');
      }).catch(function(error) {
        if (reqEpoch !== chatEpoch || reqCode !== roomCode) return;
        setError(errMsg(error, '发送失败'));
      }).then(function() {
        chatSending = false;
        if (chatSendButton) chatSendButton.disabled = false;
      });
    }
    function onChatKeydown(event) {
      // 中文输入法组合态下 Enter 是「确认候选字」而非「发送」——不挡会连同候选字一起误发一条
      if (event.isComposing || event.keyCode === 229) return;
      if (event.key !== 'Enter' || event.shiftKey) return;
      event.preventDefault();
      sendChat();
    }
    // 渲染 diff 辅助：热路径（render 每次点击/推送都跑）的同值写入会触发
    // DOM mutation → 样式失效/回流。文本与类名经此写入，值没变就不碰 DOM
    function setText(el, text) { if (el && el.textContent !== text) el.textContent = text; }
    function setClass(el, cls) { if (el && el.className !== cls) el.className = cls; }

    // 连接状态红绿灯：文本 + 状态类（online/connecting/offline）
    function setConnection(text, kind) {
      setText(connectionElement, text);
      if (connectionElement.title !== text) connectionElement.title = text;
      setClass(connectionElement, 'chess-conn' + (kind ? ' is-' + kind : ''));
    }

    function applyState(next, opts) {
      if (!next) return;
      // 推送路径防回退：长轮询回退模式可能补发旧事件，吃子是合法减子所以这里
      // 只比 gameId 一致时棋子总数？象棋有吃子，无法像五子棋用子数单调递增判旧事件。
      // 改用回合守卫：同 gameId 且状态更旧（turn 回到上一手方且 lastMove 退格）不予应用，
      // 简化为本端已领先（lastMove 不一致且 board 变化）时以 HTTP 响应为最高优先。
      state = Object.assign(state, next);
      if (mode === 'room') saveSession();
      // 状态更新后选中项可能失效：被吃/不属于己方/对局结束
      if (selected) {
        var piece = state.board[selected.row] && state.board[selected.row][selected.col];
        if (!piece) { selected = null; legal = []; }
      }
      render();
    }

    // ===== 结果文案 =====
    function resultText(next) {
      if (next.result === 'resign') return (next.winner === 'red' ? '黑方认输，红方获胜' : '红方认输，黑方获胜');
      if (next.winner === 'draw') return '困毙，和棋';
      return next.winner === 'red' ? '红方将死黑方，红方获胜' : '黑方将死红方，黑方获胜';
    }

    // ===== 棋盘尺寸度量：交点按钮/棋子字号随棋盘宽度换算 =====
    var lastCellSize = '';
    function syncMetrics() {
      var width = boardElement.clientWidth;
      if (!width) return;
      var cell = width / 9; // viewBox 540 宽含 30 边距 → 交点距 = 宽/9
      var next = cell.toFixed(2) + 'px';
      // 值未变则不写：写 --chess-cell 会让 90 个交点按钮与全部棋子的尺寸、
      // 字号一起重算重绘。ResizeObserver 在软键盘弹出/滚动条出现等场景会以
      // 同一个尺寸重复触发，短路掉这些无意义的全盘重排（平板上的隐性卡顿源）。
      if (next === lastCellSize) return;
      lastCellSize = next;
      root.style.setProperty('--chess-cell', next);
    }

    // ===== 渲染 =====
    // 触摸反馈：安卓平板走子/选中时的轻震动（不支持振动的设备静默跳过）
    function buzz(ms) {
      try { if (navigator.vibrate) navigator.vibrate(ms); } catch (e) {}
    }
    function canSelectPiece(piece) {
      if (!piece || state.winner || state.status !== 'active' || pending) return false;
      // 本地双人：只许选中当前手一方的棋子（否则点击敌子会命中「改选」分支，
      // 永远走不到吃子判定——2026-09-21 实测发现的真 bug）
      if (mode === 'local') return pieceColor(piece) === state.turn;
      var member = currentMember();
      if (!member || !member.color) return false; // 观战者
      // 单人房间自由摆棋：允许选中任色；满员后只许自己的棋
      var playerCount = state.members.filter(function(m) { return m.color; }).length;
      if (playerCount < 2) return true;
      return pieceColor(piece) === member.color && state.turn === member.color;
    }

    // 成员名单签名缓存：render 每次点击都跑，名单/轮次/胜负没变就不重建
    // （clearChildren + 重建 li 会打断 is-turn 脉冲动画并造成无谓回流）
    var lastMembersSignature = '';
    function renderMembers() {
      var sig = mode + '|' + state.turn + '|' + (state.winner || '') + '|' + (state.status || '') + '|';
      for (var i = 0; i < state.members.length; i++) {
        var m = state.members[i];
        sig += m.user_id + ':' + (m.net_name || '') + ':' + m.role + ':' + (m.color || '') + ';';
      }
      if (sig === lastMembersSignature) return;
      lastMembersSignature = sig;
      clearChildren(membersElement);
      if (mode === 'local') {
        var sides = [['red', '红方', '先手'], ['black', '黑方', '后手']];
        sides.forEach(function(entry) {
          var isTurn = !state.winner && state.status === 'active' && state.turn === entry[0];
          membersElement.appendChild(t('li', 'chess-member' + (isTurn ? ' is-turn' : ''), null, [
            t('span', 'chess-member-dot is-' + entry[0], { 'aria-hidden': 'true' }),
            t('span', 'chess-member-name', { text: entry[1] }),
            t('span', 'chess-member-role', { text: entry[2] })
          ]));
        });
        return;
      }
      state.members.forEach(function(member) {
        var isMe = String(member.user_id) === currentUserId();
        var dotClass = 'chess-member-dot ' + (member.role === 'spectator' ? 'is-spectator' : (member.color ? 'is-' + member.color : 'is-none'));
        // 观战者标注「可替补」：玩家退出时空出的色位会按加入顺序递补给最早的观战者，
        // 这是「替补」能力的唯一可见线索，不写出来用户不会知道自己在排队等上场
        var roleText = (!member.color || member.role === 'spectator') ? '观战 · 可替补'
          : member.role === 'owner' ? '房主 · ' + (member.color === 'red' ? '红方' : '黑方')
          : member.color === 'red' ? '红方' : '黑方';
        var isTurn = !state.winner && state.status === 'active' && member.role !== 'spectator' && member.color && member.color === state.turn;
        membersElement.appendChild(t('li', 'chess-member' + (isMe ? ' is-me' : '') + (isTurn ? ' is-turn' : ''), null, [
          t('span', dotClass, { 'aria-hidden': 'true' }),
          t('span', 'chess-member-name', { text: isMe ? '我' : String(member.net_name || member.user_id) }),
          t('span', 'chess-member-role', { text: roleText })
        ]));
      });
    }

    // ===== 被吃子展示 =====
    // 用「初始子力 − 棋盘现存」推导被吃棋子，本地/联机通用（不依赖后端字段）。
    // 展示顺序：车马炮相士兵（帅/将不可能被吃，跳过）。
    var CAPTURE_TYPES = ['rook', 'knight', 'cannon', 'elephant', 'guard', 'pawn'];
    // 被吃子签名缓存：棋盘子力没变（纯选子/提示类重渲染）就不重建（最多 32 个 span）
    var lastCapturedSignature = '';
    function renderCaptured() {
      if (mode === '') {
        if (lastCapturedSignature !== '') { lastCapturedSignature = ''; clearChildren(capturedElement); }
        return;
      }
      var onBoard = {};
      for (var r = 0; r < 10; r++) {
        for (var c = 0; c < 9; c++) {
          var p = state.board[r][c];
          if (p) onBoard[p] = (onBoard[p] || 0) + 1;
        }
      }
      var sig = mode + '|';
      for (var t2 = 0; t2 < CAPTURE_TYPES.length; t2++) {
        sig += (onBoard['r_' + CAPTURE_TYPES[t2]] || 0) + ':' + (onBoard['b_' + CAPTURE_TYPES[t2]] || 0) + ';';
      }
      if (sig === lastCapturedSignature) return;
      lastCapturedSignature = sig;
      clearChildren(capturedElement);
      ['red', 'black'].forEach(function(color) {
        var prefix = color === 'red' ? 'r_' : 'b_';
        var row = t('div', 'chess-captured-row', null, [
          t('span', 'chess-captured-label', { text: color === 'red' ? '红失' : '黑失' })
        ]);
        var shown = 0;
        CAPTURE_TYPES.forEach(function(type) {
          var initial = type === 'pawn' ? 5 : 2;
          var remaining = onBoard[prefix + type] || 0;
          for (var i = remaining; i < initial; i++) {
            row.appendChild(t('span', 'chess-cap-piece is-' + color, { text: PIECE_CHARS[prefix + type] || '?' }));
            shown++;
          }
        });
        if (!shown) row.appendChild(t('span', 'chess-captured-empty', { text: '无损失' }));
        capturedElement.appendChild(row);
      });
    }

    // 棋子层增量渲染：90 个交点按钮壳只建一次，之后每次 render 逐交点 diff
    // （className/棋子/aria-label/disabled），状态没变的节点一个属性都不写。
    // 旧实现按 JSON 签名全量 clearChildren 重建 90 按钮 + SVG —— 低端安卓平板
    // 每次选中/走子都丢一帧合成层，用户感知为棋盘「抽搐」。
    var boardBuilt = false;
    // ===== 视角（orientation）=====
    // 棋盘数据坐标固定：row 0 = 黑方底线，row 9 = 红方底线（与服务端 rules 一致）。
    // 但呈现坐标要按「我在哪一方」定：黑方玩家若照着红方视角看，自己的棋在最远端、
    // 全部走法都要在脑子里翻转一次 —— 这是「棋盘是对方视角」的根源。
    // 处理：联机模式下我执黑 → 上下 + 左右同时镜像（等价 180° 旋转，黑方底线落到近端）。
    // data-row/data-col 始终写真实坐标，因此点击、走法、落点、标记全部无需感知翻转。
    // 本地双人同屏不翻转（一块屏侍两人，红方在下是通行布局）。
    var flipped = false;
    function syncOrientation(member) {
      var next = mode === 'room' && !!member && member.color === 'black';
      // 换色/被房主分配颜色后要重建交点层（90 个按钮的 left/top 变了）
      if (next !== flipped) { flipped = next; boardBuilt = false; }
    }
    function buildBoardLayer() {
      clearChildren(boardElement);
      // 线层 SVG（静态装饰）。棋盘线、九宫斜线、兵炮位标记在 180° 旋转下自映射，
      // 「楚河汉界」四字位置保持不变（装饰文字，不做镜像，避免读序颠倒），
      // 因此翻转时 SVG 无需重绘。
      boardElement.insertAdjacentHTML('beforeend', boardSvgMarkup());
      var pointsElement = t('div', 'chess-points');
      for (var row = 0; row < 10; row++) {
        for (var col = 0; col < 9; col++) {
          var cell = t('button', 'chess-point', { type: 'button', 'data-row': String(row), 'data-col': String(col) });
          // DOM 顺序保持真实坐标序（render 里的 allCells[index] 映射依赖它），
          // 只把呈现坐标按 flipped 镜像
          cell.style.left = pointLeft(flipped ? 8 - col : col);
          cell.style.top = pointTop(flipped ? 9 - row : row);
          pointsElement.appendChild(cell);
        }
      }
      boardElement.appendChild(pointsElement);
      labelsPrimed = false; // 交点重建后需在下一轮 render 重新补齐无障碍标签
      boardBuilt = true;
    }
    function render() {
      var inGame = mode !== '';
      var isLocal = mode === 'local';
      var member = currentMember();
      // 视角同步：我执黑则棋盘翻转（换色/入房后颜色变化在这里被检测到）
      syncOrientation(member);
      // 标题栏/侧栏按钮可见性：单机隐藏分享类，未进入对局隐藏全部
      // （headerActionButtons 在 mount 时缓存，含侧栏 room-tools 的低频按钮）
      var actionButtons = headerActionButtons;
      for (var a = 0; a < actionButtons.length; a++) {
        var kind = actionButtons[a].dataset.action;
        if (mode === '') { actionButtons[a].hidden = true; continue; }
        actionButtons[a].hidden = isLocal && (kind === 'copy' || kind === 'share-chat' || kind === 'share-community' || kind === 'color' || kind === 'resign');
      }
      root.classList.toggle('chess-room-mode', mode === 'room' && !!roomCode);
      setText(roomElement, isLocal ? '本地对战' : (roomCode ? '房间 ' + roomCode : '未进入房间'));
      setText(identityElement, isLocal ? '双人同屏 · 红方先手'
        : (member ? (member.role === 'spectator' ? '观战者' : (member.color === 'red' ? '红方' : member.color === 'black' ? '黑方' : '等待分配'))
          : ''));
      // 房间内对手未加入：状态条给出等待提示
      var soloRoom = mode === 'room' && state.status === 'active' && !state.winner && state.members.filter(function(m) { return m.color; }).length < 2;
      if (mode === '') {
        setClass(statusElement, 'chess-status');
        setText(statusElement, '');
        statusElement.hidden = true;
      } else {
        setClass(statusElement, 'chess-status' + (state.winner ? ' is-winner' : state.check ? ' is-check' : soloRoom ? ' is-waiting' : (state.status === 'active' ? ' is-turn is-turn-' + state.turn : '')));
        statusElement.hidden = false;
        setText(statusElement, state.winner
          ? resultText(state)
          : state.check ? (state.turn === 'red' ? '轮到红方 · 将军！' : '轮到黑方 · 将军！')
          : soloRoom ? '等待对手加入'
          : state.status !== 'active' ? '等待下一局'
          : state.turn === 'red' ? '轮到红方' : '轮到黑方');
      }
      // 回合横幅（侧栏顶部）：醒目展示当前手/将军/胜负，纯静态换色
      if (bannerElement) {
        bannerElement.hidden = !inGame;
        var bannerClass = 'chess-turn-banner';
        var bannerText = '';
        if (!inGame) {
          bannerText = '';
        } else if (state.winner) {
          bannerClass += ' is-winner';
          bannerText = resultText(state);
        } else if (state.status !== 'active') {
          bannerText = '等待下一局';
        } else if (soloRoom) {
          bannerClass += ' is-waiting';
          bannerText = '等待对手加入';
        } else {
          bannerClass += ' is-turn-' + state.turn + (state.check ? ' is-check' : '');
          bannerText = (state.check ? '将军！' : '') + (state.turn === 'red' ? '轮到红方' : '轮到黑方');
        }
        setClass(bannerElement, bannerClass);
        setText(bannerElement, bannerText);
      }
      if (isLocal) setConnection('本地对弈', 'online');
      else if (!roomCode) setConnection('未进入房间', '');
      // 入场态：隐藏副标题与棋盘区
      if (roomElement) roomElement.hidden = !inGame;
      if (identityElement) identityElement.hidden = !inGame;
      root.classList.toggle('chess-entering', !inGame);
      if (layoutElement) layoutElement.hidden = !inGame;
      entryElement.hidden = inGame;
      // 提示条归位：对局中挂进侧栏顶部——不占棋盘上方的高度（旧行为是提示条一出现就把
      // 棋盘整体下推 41px，「已进入观战」这类常驻提示尤其明显）；入场态放回 shell 层、
      // 仍排在入场卡下方。同一节点搬家，setError 的引用不受影响。
      var noticeParent = inGame ? infoElement : shellElement;
      if (noticeParent && errorElement.parentNode !== noticeParent) {
        if (inGame) noticeParent.insertBefore(errorElement, noticeParent.firstChild);
        else if (layoutElement && layoutElement.parentNode === noticeParent) noticeParent.insertBefore(errorElement, layoutElement);
        else noticeParent.appendChild(errorElement);
      }

      // 棋子层：增量 diff（按钮常驻，仅写变化节点，避免全量重建丢帧）
      if (!boardBuilt || !boardElement.firstElementChild) buildBoardLayer();
      var pointsElement = boardElement.lastElementChild;
      var checkKing = state.check && !state.winner ? getKingPos(state.board, state.turn) : null;
      var last = state.lastMove;
      var legalKeys = {};
      legal.forEach(function(mv) { legalKeys[mv.row + '_' + mv.col] = !!state.board[mv.row][mv.col]; });
      var newAnimatedKey = last ? last.toRow + '_' + last.toCol : '';
      var animateLast = newAnimatedKey !== lastAnimatedKey;
      var allCells = pointsElement.children;
      var primeLabels = !labelsPrimed;
      var index = 0;
      for (var row = 0; row < 10; row++) {
        for (var col = 0; col < 9; col++) {
          var cell = allCells[index];
          index++;
          var piece = state.board[row][col];
          var isSelected = selected && selected.row === row && selected.col === col;
          var isLastFrom = last && last.fromRow === row && last.fromCol === col;
          var isLastTo = last && last.toRow === row && last.toCol === col;
          // 交点按钮类名：先拼目标串再 diff 写，串相同则不写（不重启动画/不过渡）
          var cls = 'chess-point';
          if (isSelected) cls += ' is-selected';
          if (isLastFrom || isLastTo) cls += ' is-last';
          if (checkKing && checkKing.row === row && checkKing.col === col) cls += ' is-check';
          if (Object.prototype.hasOwnProperty.call(legalKeys, row + '_' + col)) cls += legalKeys[row + '_' + col] ? ' is-hint-capture' : ' is-hint';
          var clsChanged = cell.className !== cls;
          if (clsChanged) cell.className = cls;
          // 棋子 span：有子补挂 / 无子摘除 / 有子则逐属性 diff
          var span = cell.firstChild;
          var spanChanged = false;
          if (piece) {
            var pieceCls = 'chess-piece ' + (pieceColor(piece) === 'red' ? 'is-red' : 'is-black');
            var pieceChar = PIECE_CHARS[piece] || '?';
            if (isLastTo && animateLast) pieceCls += ' is-new';
            if (span) {
              if (span.className !== pieceCls) { span.className = pieceCls; spanChanged = true; }
              if (span.textContent !== pieceChar) { span.textContent = pieceChar; spanChanged = true; }
            } else {
              var node = document.createElement('span');
              node.className = pieceCls;
              node.textContent = pieceChar;
              node.setAttribute('aria-hidden', 'true');
              cell.appendChild(node);
              spanChanged = true;
            }
          } else if (span) {
            cell.removeChild(span);
            spanChanged = true;
          }
          // 无障碍标签：只在类名或棋子真的变了的那几个格子上重建。
          // 每次点击 90 格全量 getAttribute + 中文串拼接 ≈ 0.5~1ms 的纯浪费 JS，
          // 在低端平板上正好压在一帧预算里（primeLabels 负责首轮补齐全部标签）。
          if (clsChanged || spanChanged || primeLabels) {
            var label = (row + 1) + '行' + (col + 1) + '列' + (piece ? (pieceColor(piece) === 'red' ? '红' : '黑') + PIECE_CHARS[piece] : '');
            if (cell.getAttribute('aria-label') !== label) cell.setAttribute('aria-label', label);
          }
          // 可点状态：有选中时全部交点可点（落点/改选），无选中时只有己方可点
          var wantDisabled = selected ? false : !canSelectPiece(piece);
          if (cell.disabled !== wantDisabled) cell.disabled = wantDisabled;
        }
      }
      lastAnimatedKey = newAnimatedKey;
      labelsPrimed = true;
      // 不在此处调 syncMetrics：读 clientWidth 会强制布局，render 是每次点击的热路径。
      // 尺寸度量由 mount 末尾 + window resize + ResizeObserver 负责

      renderMembers();
      renderCaptured();
      setText(infoTitleElement, isLocal ? '对局信息' : '房间成员');
      setText(leaveButton, isLocal ? '退出练习' : '离开房间');
      // 房间操作区仅房间模式显示（低频按钮的常驻地）
      if (roomToolsElement) roomToolsElement.hidden = mode !== 'room';
      // 侧栏双页：聊天页仅在房间模式且被选中时显示（本地双人同屏共用一块屏，没有聊天的意义）
      renderTabs();
      var owner = member && member.role === 'owner';
      var finished = !!state.winner || state.status !== 'active';
      // 悔棋按钮可用性：本地看历史栈；房间看「最后一手是否本人所下」（后端二次校验）
      if (undoButton) {
        undoButton.disabled = isLocal
          ? !localHistory.length
          : (!roomCode || !state.lastMove || !!state.winner || state.status !== 'active' || pending || String(state.lastMove.userId) !== currentUserId());
      }
      if (resignButton) {
        resignButton.disabled = isLocal || !roomCode || !!state.winner || state.status !== 'active' || pending || !member || !member.color;
      }
      if (copyButton) copyButton.disabled = !roomCode;
      if (shareButton) shareButton.disabled = !roomCode;
      if (communityButton) communityButton.disabled = !roomCode;
      // 换方可用性与后端校验对齐：房间内、尚无走子、未分胜负、自己是玩家。
      // 观战者无色可换，直接禁用；禁用态交由 :disabled 视觉表达，避免点了才报错。
      if (colorButton) {
        colorButton.disabled = !roomCode || !!state.lastMove || !!state.winner || state.status !== 'active' || pending || !member || !member.color;
      }
      if (isLocal) {
        setText(finishedElement, state.winner ? resultText(state) : '');
        continueButton.hidden = !finished;
        continueButton.textContent = '重开一局';
      } else {
        setText(finishedElement, finished ? (state.winner ? '本局结束，房主可以继续或离开。' : '准备下一局。') : '');
        continueButton.hidden = !finished || !owner;
        continueButton.textContent = '继续下一局';
      }
    }

    // ===== 走子落盘（本地）：应用走法并判定将死/困毙 =====
    function applyLocalMove(fr, fc, tr, tc) {
      var piece = state.board[fr][fc];
      var captured = state.board[tr][tc] || null;
      var mover = pieceColor(piece);
      state.board[tr][tc] = piece;
      state.board[fr][fc] = null;
      localHistory.push({ fr: fr, fc: fc, tr: tr, tc: tc, piece: piece, captured: captured });
      state.lastMove = { fromRow: fr, fromCol: fc, toRow: tr, toCol: tc, color: mover };
      var nextTurn = mover === 'red' ? 'black' : 'red';
      if (captured === 'r_king' || captured === 'b_king') {
        state.winner = mover; state.result = 'checkmate'; state.status = 'finished'; state.check = false;
      } else if (isInCheck(state.board, nextTurn) && !hasAnyMove(state.board, nextTurn)) {
        state.winner = mover; state.result = 'checkmate'; state.status = 'finished'; state.check = false;
      } else if (!isInCheck(state.board, nextTurn) && !hasAnyMove(state.board, nextTurn)) {
        state.winner = 'draw'; state.result = 'stalemate'; state.status = 'finished'; state.check = false;
      } else {
        state.turn = nextTurn;
        state.check = isInCheck(state.board, nextTurn);
      }
      selected = null;
      legal = [];
      saveSession();
      render();
    }

    // ===== 本地悔棋：撤最后一手 =====
    function localUndo() {
      if (!localHistory.length) return;
      var mv = localHistory.pop();
      state.board[mv.tr][mv.tc] = mv.captured || null;
      state.board[mv.fr][mv.fc] = mv.piece;
      state.winner = null;
      state.result = null;
      state.status = 'active';
      state.turn = mv.color || pieceColor(mv.piece);
      state.lastMove = localHistory.length ? {
        fromRow: localHistory[localHistory.length - 1].fr,
        fromCol: localHistory[localHistory.length - 1].fc,
        toRow: localHistory[localHistory.length - 1].tr,
        toCol: localHistory[localHistory.length - 1].tc
      } : null;
      state.check = false;
      selected = null;
      legal = [];
      saveSession();
      render();
    }

    // ===== 交点点击：选子 / 落子 =====
    function onBoardClick(event) {
      var cell = event.target.closest('.chess-point');
      if (!cell || pending || disposed) return;
      var row = Number(cell.dataset.row);
      var col = Number(cell.dataset.col);
      var piece = state.board[row] && state.board[row][col];

      if (selected) {
        // 所选棋子已不在盘上（联机对手吃掉它）→ 清空选中
        if (!state.board[selected.row][selected.col]) {
          selected = null; legal = []; render(); return;
        }
        // 再次点击同一枚棋子 → 取消选中，收起落点提示
        // （此前同一枚棋子只会走「改选」分支重新选中，没有取消的出路）
        if (row === selected.row && col === selected.col) {
          selected = null; legal = [];
          buzz(8);
          render(); return;
        }
        // 点到与所选同色的棋子 → 改选；点到敌子 → 走吃子判定
        if (piece && pieceColor(piece) === pieceColor(state.board[selected.row][selected.col]) && canSelectPiece(piece)) {
          selected = { row: row, col: col };
          legal = legalMoves(state.board, row, col);
          buzz(8); // 触摸反馈：改选轻震
          render(); return;
        }
        // 落子尝试
        var fr = selected.row, fc = selected.col;
        var mover = pieceColor(state.board[fr][fc]);
        var verdict = validateMove(state.board, fr, fc, row, col, mover);
        if (!verdict.ok) { setError('不能这样走'); render(); return; }
        buzz(15); // 触摸反馈：合法落子重震（本地/联机统一在成功判定后）
        if (mode === 'local') {
          setError('');
          applyLocalMove(fr, fc, row, col);
          return;
        }
        if (!roomCode) return;
        setError('');
        setBusy(true);
        render();
        actionRequest('/move', '走子失败', { fromRow: fr, fromCol: fc, toRow: row, toCol: col }).then(function() {
          setBusy(false);
          render();
        });
        return;
      }

      // 未选中：尝试选子
      if (!piece || !canSelectPiece(piece)) return;
      selected = { row: row, col: col };
      legal = legalMoves(state.board, row, col);
      buzz(8); // 触摸反馈：选中轻震
      render();
    }

    function loadState(isRecovery) {
      if (!roomCode) { state.board = initialBoard(); render(); return Promise.resolve(); }
      return request(context, 'GET', '/chess/rooms/' + encodeURIComponent(roomCode)).then(function(data) {
        applyState(data);
        // 断线重连 / 会话恢复时补齐聊天记录（房间可能已有别人的发言）
        loadChatMessages();
      }).catch(function(error) {
        setError(errMsg(error, '房间加载失败'));
        // 仅会话恢复路径：房间已失效就清会话回入场页；断线重连的刷新不清（保留房间码等重连）
        if (isRecovery) { roomCode = ''; mode = ''; activeTab = 'info'; clearSession(); chatClear(); render(); }
      });
    }
    function enter(code, enterKind) {
      var normalized = String(code || '').trim().toUpperCase();
      if (!/^[A-Z0-9]{4,6}$/.test(normalized)) { setError('请输入 4-6 位房间码'); return Promise.resolve(); }
      var kind = enterKind === 'watch' ? 'watch' : 'join';
      return request(context, 'POST', '/chess/rooms/' + encodeURIComponent(normalized) + '/' + kind, {}).then(function(data) {
        if (roomCode !== normalized) { activeTab = 'info'; chatClear(); }   // 换房：先清空并作废上一房间的在途回调
        roomCode = normalized;
        mode = 'room';
        selected = null; legal = [];
        applyState(data);
        setError('');
        var me = currentMember();
        if (kind === 'watch') {
          setError('已进入观战，玩家退出时空位会递补给你');
        } else if (me && me.role === 'spectator') {
          // 满员自动观战：红黑两色都已有人，后端把新成员降级为 spectator——
          // 明确告知降级结果，避免用户误以为进错了房间（点邀请卡片进入的常见场景）
          setError('房间玩家已满，已为你转为观战');
        }
        loadChatMessages();
      }).catch(function(error) { setError(errMsg(error, '进入房间失败')); });
    }
    function create() {
      return request(context, 'POST', '/chess/rooms', {}).then(function(data) {
        if (roomCode !== data.roomCode) { activeTab = 'info'; chatClear(); }   // 建房：同上，作废上一房间的在途回调
        roomCode = data.roomCode;
        mode = 'room';
        selected = null; legal = [];
        applyState(data);
        setError('');
        loadChatMessages();
      }).catch(function(error) { setError(errMsg(error, '创建房间失败')); });
    }
    function actionRequest(path, message, body) {
      return request(context, 'POST', '/chess/rooms/' + encodeURIComponent(roomCode) + path, body || {}).then(function(data) {
        applyState(data);
        return data;
      }).catch(function(error) { setError(errMsg(error, message)); return null; });
    }
    function leaveRoom() {
      actionRequest('/leave', '离开房间失败').then(function() { roomCode = ''; mode = ''; activeTab = 'info'; clearSession(); chatClear(); render(); });
    }
    function navigateHome() { if (context.router && typeof context.router.push === 'function') context.router.push('/'); }
    function leave() {
      // 本地模式无房间状态，直接回入场页
      if (mode === 'local') {
        mode = '';
        localHistory = [];
        state = { board: initialBoard(), turn: 'red', winner: null, result: null, status: 'active', check: false, members: [], lastMove: null };
        selected = null; legal = [];
        clearSession();
        render();
        return;
      }
      if (!roomCode) return navigateHome();
      if (context.modal && typeof context.modal.confirm === 'function') {
        context.modal.confirm({ title: '离开房间', message: '离开后需要重新输入房间码才能回来，确定离开吗？', confirmText: '离开', cancelText: '取消' }).then(function(confirmed) {
          if (confirmed) leaveRoom();
        });
        return;
      }
      leaveRoom();
    }
    // 统一的忙碌锁：走子与房间操作共用，防止并发请求导致状态错乱
    function setBusy(flag) {
      pending = flag;
      var buttons = root.querySelectorAll('[data-action]:not([data-action="home"])');
      for (var i = 0; i < buttons.length; i++) buttons[i].disabled = flag;
    }
    function onAction(event) {
      var action = event.target.closest('[data-action]');
      if (!action || disposed) return;
      var kind = action.dataset.action;
      // 返回桌面：标题栏常驻出口，不受忙碌锁限制
      if (kind === 'home') return navigateHome();
      // 侧栏双页切换：纯前端状态，不受忙碌锁限制（对局请求在途也要能切页看聊天）
      if (kind === 'tab-info' || kind === 'tab-chat') return setTab(kind === 'tab-chat' ? 'chat' : 'info');
      if (pending) return;
      if (kind === 'local') {
        mode = 'local';
        roomCode = '';
        localHistory = [];
        state = { board: initialBoard(), turn: 'red', winner: null, result: null, status: 'active', check: false, members: [], lastMove: null };
        selected = null; legal = [];
        lastAnimatedKey = '';
        setError('');
        render();
        syncMetrics();
        return;
      }
      if (kind === 'create' || kind === 'join' || kind === 'watch') {
        action.disabled = true;
        setBusy(true);
        var done = function() { setBusy(false); };
        if (kind === 'create') create().then(done, done);
        else enter(root.querySelector('[data-field="room"]').value, kind).then(done, done);
        return;
      }
      if (kind === 'undo' && mode === 'local') { localUndo(); return; }
      if (kind === 'undo' && roomCode && !pending) {
        action.disabled = true;
        setBusy(true);
        actionRequest('/undo', '悔棋失败：等对方走子后才能悔棋').then(function() { setBusy(false); });
        return;
      }
      if (kind === 'resign' && roomCode && !pending) {
        var doResign = function() {
          action.disabled = true;
          setBusy(true);
          actionRequest('/resign', '认输失败').then(function() { setBusy(false); });
        };
        if (context.modal && typeof context.modal.confirm === 'function') {
          context.modal.confirm({ title: '认输', message: '确定要认输吗？', confirmText: '认输', cancelText: '取消' }).then(function(confirmed) {
            if (confirmed) doResign();
          });
        } else {
          doResign();
        }
        return;
      }
      if (kind === 'copy' && roomCode) {
        var copyPromise = navigator.clipboard && navigator.clipboard.writeText
          ? navigator.clipboard.writeText(roomCode)
          : Promise.reject(new Error('clipboard-unavailable'));
        copyPromise.then(function() { setError('房间码已复制'); }).catch(function() { setError('房间码：' + roomCode); });
        return;
      }
      if (kind === 'share-chat') return shareRoom('chat');
      if (kind === 'share-community') return shareRoom('community');
      if (kind === 'color' && roomCode && !pending) {
        action.disabled = true;
        setBusy(true);
        actionRequest('/color', '换方失败，对局已有走子').then(function() { setBusy(false); });
        return;
      }
      // 快捷聊天发言：不受房间忙碌锁约束（走子与聊天互不阻塞），自身有 sending 去重
      if (kind === 'chat-send') return sendChat();
      if (kind === 'leave') return leave();
      if (kind === 'continue') {
        if (mode === 'local') {
          localHistory = [];
          state = { board: initialBoard(), turn: 'red', winner: null, result: null, status: 'active', check: false, members: [], lastMove: null };
          selected = null; legal = [];
          lastAnimatedKey = '';
          saveSession();
          render();
          return;
        }
        if (!roomCode) return;
        action.disabled = true;
        setBusy(true);
        actionRequest('/reset', '继续下一局失败，只有房主可以重开').then(function() { setBusy(false); });
        return;
      }
    }

    // ===== realtime 订阅：房间状态变化（对齐 gomoku 的 extension_event 通道）=====
    if (realtime && typeof realtime.subscribe === 'function') {
      subscriptions.push(realtime.subscribe('chess.room.changed', function(message) {
        var data = message && message.payload ? message.payload : message;
        if (data && data.roomCode === roomCode && data.state) {
          pending = false;
          applyState(data.state, { fromPush: true });
        }
      }));
      // 房间聊天走独立事件：只带一条消息，避免每条发言都把整盘棋的状态重传一遍
      subscriptions.push(realtime.subscribe('chess.room.message', function(message) {
        // chatReady：本房间历史尚未加载完时，迟到的广播一律丢弃（该区间消息由随后的 GET 全量补齐），
        // 否则上一房间的迟到广播可能先于 GET 落进新房间列表；mode 守卫再加一道离房保险
        if (!chatReady || mode !== 'room') return;
        var data = message && message.payload ? message.payload : message;
        if (data && data.roomCode === roomCode && data.message) appendChatMessage(data.message);
      }));
    }
    if (!realtime) {
      // 旧版 WebSocket 协议兜底
      onSocket('chess_room_state', function(message) { if (message.room_code === roomCode) applyState(message.state, { fromPush: true }); });
      onSocket('chess_room_changed', function(message) { if (message.room_code === roomCode) { pending = false; applyState(message.state, { fromPush: true }); } });
    }
    // realtime.on 返回的解绑函数必须登记，否则断线重连会重复绑定、卸载后仍收事件
    if (realtime && typeof realtime.on === 'function') {
      var ready = realtime.isReady && realtime.isReady();
      setConnection(ready ? 'HTTP 实时连接正常' : '正在连接', ready ? 'online' : 'connecting');
      subscriptions.push(realtime.on('connected', function() { setConnection('HTTP 实时连接正常', 'online'); }));
      subscriptions.push(realtime.on('_connectionStateChange', function(message) {
        if (message && message.state === 'connected') setConnection('HTTP 实时连接正常', 'online');
        else if (roomCode) setConnection('连接断开，正在恢复', 'offline');
      }));
      subscriptions.push(realtime.on('error', function() { setConnection('连接断开，正在恢复', 'offline'); if (roomCode) loadState(); }));
    }

    // ===== 棋盘点击：触屏用 pointerdown/up 自行判定 =====
    // 安卓平板上手指轻触常带 1-3px 微动，浏览器把它判成滚动手势而不派发 click，
    // 表现为「经常选不上」。改为：按下记录交点，抬起时位移 <14px 且 <600ms 视为点击；
    // 大幅滑动会被浏览器接管滚动并派发 pointercancel，天然排除。
    //
    // 焦点滚动治理（真机「棋盘偏移」根因）：按下棋子按钮时浏览器默认让它获得焦点，
    // 并把焦点元素滚动进可视区——宿主容器/棋盘容器一旦有溢出（哪怕 overflow:hidden
    // 也会被程序化滚动），整个棋盘就被顶走且停住，后续落点全错。两道防线：
    //   1) pointerdown preventDefault → 按下不产生焦点 → 无焦点滚动；
    //   2) 快照所有可滚动祖先的滚动位置，tap 有效后还原（滑动滚动不干预）。
    var downPoint = null;    // { cell, x, y, id, time, locks }
    var tapHandledAt = 0;    // pointer 已处理的 tap 时间戳（抑制随后的兼容 click，防双触发）
    function lockAncestorScroll() {
      var locks = [];
      var el = boardElement.parentNode;
      while (el && el.nodeType === 1) {
        if (el.scrollHeight > el.clientHeight || el.scrollWidth > el.clientWidth) {
          locks.push({ el: el, top: el.scrollTop, left: el.scrollLeft });
        }
        el = el.parentNode;
      }
      return locks;
    }
    function restoreAncestorScroll(locks) {
      for (var i = 0; i < locks.length; i++) {
        if (locks[i].el.scrollTop !== locks[i].top) locks[i].el.scrollTop = locks[i].top;
        if (locks[i].el.scrollLeft !== locks[i].left) locks[i].el.scrollLeft = locks[i].left;
      }
    }
    function onBoardDown(event) {
      if (event.button !== 0) { downPoint = null; return; } // 仅主键/触摸/手写笔
      event.preventDefault(); // 防焦点：任何容器都不会因按下棋子而发生焦点滚动
      var cell = event.target && event.target.closest ? event.target.closest('.chess-point') : null;
      if (downPoint && downPoint.cell) downPoint.cell.classList.remove('is-pressed');
      downPoint = cell ? { cell: cell, x: event.clientX, y: event.clientY, id: event.pointerId, time: Date.now(), locks: lockAncestorScroll() } : null;
      // 按压反馈走 JS 类（pointerdown preventDefault 后 :active 在部分设备不生效）
      if (cell) cell.classList.add('is-pressed');
    }
    function onBoardUp(event) {
      if (!downPoint || event.pointerId !== downPoint.id) return;
      var dx = event.clientX - downPoint.x;
      var dy = event.clientY - downPoint.y;
      var elapsed = Date.now() - downPoint.time;
      var cell = downPoint.cell;
      var locks = downPoint.locks;
      downPoint = null;
      cell.classList.remove('is-pressed');
      if (dx * dx + dy * dy > 196 || elapsed > 600) return; // 超出 14px 容差或长按 → 放弃
      tapHandledAt = Date.now();
      onBoardClick({ target: cell });
      // tap 有效才还原滚动：滑动（滚动）场景下绝不动用户的滚动位置
      if (locks) restoreAncestorScroll(locks);
    }
    function onBoardCancel() {
      if (downPoint && downPoint.cell) downPoint.cell.classList.remove('is-pressed');
      downPoint = null;
    }
    // 兼容 click 只兜键盘 Enter/Space（触屏与鼠标 tap 已由 pointerup 处理）
    function onBoardTapClick(event) {
      if (Date.now() - tapHandledAt < 500) return;
      onBoardClick(event);
    }
    // 触摸优化：长按棋盘不弹系统菜单（安卓平板长按误触会打断对局）
    function preventContext(event) { event.preventDefault(); }
    boardElement.addEventListener('pointerdown', onBoardDown);
    boardElement.addEventListener('pointerup', onBoardUp);
    boardElement.addEventListener('pointercancel', onBoardCancel);
    boardElement.addEventListener('click', onBoardTapClick);
    boardElement.addEventListener('contextmenu', preventContext);
    root.addEventListener('click', onAction);
    // 快捷聊天：回车发送（平板软键盘的「发送」键同样派发 Enter）
    if (chatInputElement) chatInputElement.addEventListener('keydown', onChatKeydown);
    var removeChatInput = function() {
      if (chatInputElement) chatInputElement.removeEventListener('keydown', onChatKeydown);
    };
    var removeBoardEvents = function() {
      boardElement.removeEventListener('pointerdown', onBoardDown);
      boardElement.removeEventListener('pointerup', onBoardUp);
      boardElement.removeEventListener('pointercancel', onBoardCancel);
      boardElement.removeEventListener('click', onBoardTapClick);
      boardElement.removeEventListener('contextmenu', preventContext);
    };
    var removeRootClick = function() { root.removeEventListener('click', onAction); };
    var onResize = function() { syncMetrics(); };
    window.addEventListener('resize', onResize);
    var removeResize = function() { window.removeEventListener('resize', onResize); };
    // 棋盘自身尺寸变化（媒体查询切换/容器伸缩不走 window resize）也要重算交点度量
    var boardObserver = null;
    if (window.ResizeObserver) {
      boardObserver = new ResizeObserver(function() { syncMetrics(); });
      boardObserver.observe(boardElement);
    }
    var removeObserver = function() {
      if (boardObserver) { boardObserver.disconnect(); boardObserver = null; }
    };
    // 契约：资源回收必须在 context.app.onDestroy 中登记（market-registry 卸载时会先调它）
    if (context.app && typeof context.app.onDestroy === 'function') {
      context.app.onDestroy(function() {
        disposed = true;
        removeBoardEvents();
        removeRootClick();
        removeChatInput();
        removeResize();
        removeObserver();
        subscriptions.forEach(function(remove) { if (typeof remove === 'function') remove(); });
        subscriptions = [];
        clearChildren(container);
      });
    }
    container.__chessUnmount = function() {
      disposed = true;
      removeBoardEvents();
      removeRootClick();
      removeChatInput();
      removeResize();
      removeObserver();
      if (roomCode) send({ type: 'chess_unsubscribe', room_code: roomCode });
      subscriptions.forEach(function(remove) { if (typeof remove === 'function') remove(); });
      subscriptions = [];
      clearChildren(container);
      delete container.__chessUnmount;
    };

    // 会话恢复：路由未带房间码时，恢复上次对局——
    // 本地局直接还原棋盘；房间码经 loadState 校验存活，房间已关则自然回入场页
    var savedSession = routeRoom ? null : readSession();
    if (savedSession && savedSession.mode === 'local' && savedSession.offline && Array.isArray(savedSession.offline.board)) {
      mode = 'local';
      localHistory = Array.isArray(savedSession.offline.history) ? savedSession.offline.history : [];
      state = Object.assign({ members: [], check: false }, savedSession.offline);
      render();
      syncMetrics();
    } else if (savedSession && savedSession.mode === 'room' && /^[A-Z0-9]{4,6}$/.test(String(savedSession.roomCode || ''))) {
      roomCode = String(savedSession.roomCode);
      mode = 'room';
      loadState(true);
    } else if (roomCode) {
      // 路由携带房间码（点聊天卡片直达）：自动加入——满员时后端自动分配观战身份
      enter(roomCode);
    } else {
      loadState();
    }
    syncMetrics();
  }

  function unmount(container) { if (container && typeof container.__chessUnmount === 'function') container.__chessUnmount(); }
  var definition = { name: NAME, mount: mount, unmount: unmount };
  if (window.ClassIntraMarket && typeof window.ClassIntraMarket.define === 'function') window.ClassIntraMarket.define(definition);
  else if (definitions) definitions[NAME] = definition;
})();
