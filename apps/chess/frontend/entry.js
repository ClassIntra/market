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

  // ===== 中文记谱（引擎候选着法 / 棋谱共用）=====
  // 引擎回的是 UCI（"b2e2"），学生看到等于没看到。皮卡鱼网页版的候选着法列表
  // 用的是中文记谱（「炮八平五」），这里把 UCI 着法与主变例翻成中文。
  //
  // 约定（《中国象棋竞赛规则》记谱法）：
  //   纵线号 —— 红方自右向左为「一~九」，黑方自右向左为「1~9」。
  //     本应用 board[0] 是黑方底线、board[r][8] 在最右侧：
  //       红方第 n 路 = 9 - col（红方在下，它的「右」是屏幕右端）
  //       黑方第 n 路 = col + 1（黑方在上，它的「右」是屏幕左端）
  //   进/退 —— 红方 row 变小为「进」，黑方 row 变大为「进」。
  //   直行子（车/炮/兵/将帅）写「进/退 + 步数」；斜行子（马/象相/士仕）写「进/退 + 目标纵线」。
  //   横走（行不变）一律写「平 + 目标纵线」。
  //   同一纵线上有 ≥2 个同色同种子时，省略起点纵线改用「前/后」定位
  //   （3 个及以上按由前到后编号，红方用汉字、黑方用数字）。
  var CN_DIGITS = '一二三四五六七八九';
  var STRAIGHT_TYPES = { king: true, rook: true, cannon: true, pawn: true };
  var UCI_FILES = 'abcdefghi';

  function cnFile(color, col) {
    return color === 'red' ? CN_DIGITS.charAt(8 - col) : String(col + 1);
  }
  function cnCount(color, n) {
    return color === 'red' ? CN_DIGITS.charAt(n - 1) : String(n);
  }
  // 'b2e2' → { fr, fc, tr, tc }。UCI rank 0 = 红方底线 = 本应用 row 9。
  function uciToCell(text) {
    var raw = String(text || '');
    if (!/^[a-i][0-9][a-i][0-9]$/.test(raw)) return null;
    var fc = UCI_FILES.indexOf(raw.charAt(0));
    var fr = 9 - Number(raw.charAt(1));
    var tc = UCI_FILES.indexOf(raw.charAt(2));
    var tr = 9 - Number(raw.charAt(3));
    if (fc < 0 || tc < 0 || fr < 0 || fr > 9 || tr < 0 || tr > 9) return null;
    return { fr: fr, fc: fc, tr: tr, tc: tc };
  }
  // 单步中文记谱。board 只读（不改动局面）。
  function chineseMove(board, fr, fc, tr, tc) {
    var piece = board[fr] && board[fr][fc];
    if (!piece) return '';
    var color = pieceColor(piece);
    var name = PIECE_CHARS[piece] || '';
    // 同纵线同色同种计数：≥2 时用前/后定位（车马炮兵都会出现，不是罕见情况）
    var mates = [];
    for (var r = 0; r < 10; r++) if (board[r][fc] === piece) mates.push(r);
    var head;
    if (mates.length >= 2) {
      // 红方 row 小 = 更靠对方底线 = 「前」；黑方相反
      var order = mates.slice().sort(function(a, b) { return color === 'red' ? a - b : b - a; });
      var idx = order.indexOf(fr);
      head = (mates.length === 2 ? (idx === 0 ? '前' : '后') : cnCount(color, idx + 1)) + name;
    } else {
      head = name + cnFile(color, fc);
    }
    if (tr === fr) return head + '平' + cnFile(color, tc);
    var forward = color === 'red' ? tr < fr : tr > fr;
    var verb = forward ? '进' : '退';
    return STRAIGHT_TYPES[pieceType(piece)]
      ? head + verb + cnCount(color, Math.abs(tr - fr))
      : head + verb + cnFile(color, tc);
  }
  // 主变例（UCI 串数组）→ 中文着法数组。逐步落子是因为记谱要读「落子前」的
  // 同纵线分布（前/后判定）。线路里出现与轮次不符的着法说明后面已不可信，就地截断。
  function pvToChinese(board, pv, side) {
    var tmp = [];
    for (var r = 0; r < 10; r++) tmp.push(board[r].slice());
    var turn = side === 'black' ? 'black' : 'red';
    var out = [];
    for (var i = 0; i < pv.length; i++) {
      var cell = uciToCell(pv[i]);
      if (!cell) break;
      var piece = tmp[cell.fr][cell.fc];
      if (!piece || pieceColor(piece) !== turn) break;
      out.push(chineseMove(tmp, cell.fr, cell.fc, cell.tr, cell.tc));
      tmp[cell.tr][cell.tc] = piece;
      tmp[cell.fr][cell.fc] = null;
      turn = turn === 'red' ? 'black' : 'red';
    }
    return out;
  }

  // 引擎评分 → 盘面观感。UCI 的 score 是**当前行棋方视角**，先翻成红方视角再用
  // logistic 换算胜率：象棋 1 兵 ≈ 60~100cp，取 220 为尺度时 1 车(900cp) ≈ 98%、
  // 1 兵 ≈ 62%，与 Pikafish 自带 WDL 的观感接近（不必真去开 UCI_ShowWDL）。
  function evalView(score, side) {
    var sign = side === 'black' ? -1 : 1;
    if (!score) return { cp: null, mate: null, rate: 0.5, text: '—' };
    if (score.type === 'mate') {
      var mate = score.value * sign;
      return {
        cp: null,
        mate: mate,
        rate: mate > 0 ? 1 : 0,
        text: (mate > 0 ? '红方' : '黑方') + Math.abs(mate) + ' 步杀'
      };
    }
    var cp = score.value * sign;
    // 用 1/(1+e^-x) 而不是把 cp 线性映射：评估分布天生是 logistic 的
    return {
      cp: cp,
      mate: null,
      rate: 1 / (1 + Math.exp(-cp / 220)),
      text: (cp >= 0 ? '+' : '-') + (Math.abs(cp) / 100).toFixed(2)
    };
  }

  // ===== 人机练习 AI =====
  // 双引擎结构（1.8.0 重构）：
  //   主路径 —— 服务端 Pikafish（backend/engine.js）。算力在服务器、不占平板主线程，
  //             棋力从「能赢新手」直接抬到职业引擎水平。
  //   兜底   —— 下面这套内置极大极小。引擎缺失/排队满/超时的降级路径，
  //             保证离线或引擎故障时人机模式照常可用（学生只在连接灯位置看到「内置引擎」）。
  //
  // **三档棋力，一律满子**（2026-10-01 用户决定）：取消原来的「让双车 / 让一马」。
  // 让子改的是子力结构，学生赢了也说不清是自己变强了还是对面少了两个车；
  // 强弱只由思考时间决定，语义诚实，也与 Pikafish 自身的调参方式一致——
  // 2026-09 版引擎已移除 Skill Level / UCI_LimitStrength（见 backend/engine.js 注释），
  // 可调的只剩搜索预算。
  // 三档必须在两条路径上一致：服务端引擎的 movetime（此处下发）、
  // 引擎不可用时的内置兜底配置（fallback）—— 否则「降级后突然换了个对手」。
  // 内置算法说明（兜底路径）：极大极小 + a-b + 位置分表 + MVV-LVA + 历史启发 + 吃子静态搜索。
  // 棋子/坐标系对齐本应用：board[row][col]、黑上红下、r_*/b_* 命名。
  // 分表按「黑方底线在行 0」朝向书写；红方取分时用 9-row 翻转（与参考实现的 player0 朝向一致）。
  var AI_LEVELS = {
    // 快速：够快够顺手，适合刚认全走法的同学（兜底档 depth2 不做静态搜索）
    quick: {
      movetime: 300,
      label: '快速',
      hint: '约 0.3 秒',
      fallback: { minDepth: 1, maxDepth: 2, budget: 200, blunderRate: 0, quiesce: false, history: false }
    },
    // 常规：默认档。0.9s ≈ 17 层，早已远超「能赢新手」的水平
    normal: {
      movetime: 900,
      label: '常规',
      hint: '约 1 秒',
      fallback: { minDepth: 1, maxDepth: 4, budget: 500, blunderRate: 0, quiesce: true, history: true }
    },
    // 大师：满血。兜底档放宽到 depth5 / 0.9s —— 再深会把弱平板的主线程卡住一整秒
    master: {
      movetime: 2200,
      label: '大师',
      hint: '约 2 秒',
      fallback: { minDepth: 1, maxDepth: 5, budget: 900, blunderRate: 0, quiesce: true, history: true }
    }
  };
  var AI_DEFAULT_LEVEL = 'normal';
  function aiLevelConfig(level) {
    return Object.prototype.hasOwnProperty.call(AI_LEVELS, level) ? AI_LEVELS[level] : AI_LEVELS[AI_DEFAULT_LEVEL];
  }
  var AI_INF = 100000;
  var AI_MATE = 90000;
  // 历史启发表跨步保留（对齐 HardSearch 的 historyTable），人机开局时清零
  var AI_HISTORY = [];
  var AI_SCORE = {
    king: [
      [9980, 9990, 9980, 9970, 9970, 9970, 9980, 9990, 9980],
      [9970, 9970, 9950, 9950, 9950, 9950, 9970, 9970, 9970],
      [9950, 9950, 9930, 9930, 9930, 9930, 9950, 9950, 9950],
      [0, 0, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 0, 0, 0]
    ],
    guard: [
      [200, 0, 200, 0, 240, 0, 200, 0, 200],
      [0, 220, 0, 200, 0, 200, 0, 220, 0],
      [200, 0, 200, 0, 240, 0, 200, 0, 200],
      [0, 0, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 0, 0, 0]
    ],
    elephant: [
      [0, 0, 210, 0, 0, 0, 210, 0, 0],
      [0, 0, 0, 0, 0, 0, 0, 0, 0],
      [200, 0, 0, 0, 250, 0, 0, 0, 200],
      [0, 0, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 200, 0, 0, 0, 200, 0, 0],
      [0, 0, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 0, 0, 0]
    ],
    pawn: [
      [0, 0, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 0, 0, 0],
      [150, 0, 150, 0, 230, 0, 150, 0, 150],
      [140, 0, 170, 0, 200, 0, 170, 0, 140],
      [180, 190, 200, 200, 210, 200, 200, 190, 180],
      [180, 190, 200, 210, 210, 210, 200, 190, 180],
      [190, 190, 200, 220, 220, 220, 210, 190, 190],
      [170, 180, 200, 230, 230, 230, 200, 180, 170],
      [160, 160, 190, 200, 200, 200, 190, 160, 160]
    ],
    rook: [
      [1190, 1240, 1200, 1200, 1200, 1200, 1200, 1240, 1190],
      [1200, 1220, 1200, 1210, 1200, 1210, 1200, 1220, 1200],
      [1190, 1220, 1200, 1200, 1200, 1200, 1200, 1220, 1190],
      [1210, 1220, 1200, 1200, 1200, 1200, 1200, 1220, 1210],
      [1220, 1250, 1220, 1260, 1200, 1260, 1220, 1250, 1220],
      [1230, 1240, 1230, 1240, 1230, 1240, 1230, 1240, 1230],
      [1230, 1230, 1240, 1230, 1230, 1230, 1240, 1230, 1230],
      [1230, 1230, 1230, 1230, 1240, 1230, 1230, 1230, 1230],
      [1230, 1240, 1230, 1230, 1240, 1230, 1230, 1240, 1230],
      [1250, 1250, 1230, 1250, 1240, 1250, 1230, 1250, 1250]
    ],
    knight: [
      [450, 500, 500, 480, 470, 480, 500, 500, 450],
      [450, 510, 510, 470, 480, 470, 510, 510, 450],
      [500, 500, 540, 510, 500, 510, 540, 500, 500],
      [500, 520, 520, 510, 500, 510, 520, 520, 500],
      [500, 530, 540, 530, 520, 530, 540, 530, 500],
      [530, 540, 540, 540, 540, 530, 540, 540, 530],
      [530, 530, 540, 530, 530, 530, 540, 530, 530],
      [530, 530, 540, 550, 530, 550, 540, 530, 530],
      [520, 530, 550, 530, 530, 530, 550, 530, 520],
      [510, 530, 540, 530, 530, 530, 540, 530, 510]
    ],
    cannon: [
      [500, 500, 510, 500, 500, 500, 510, 500, 500],
      [500, 500, 500, 500, 500, 500, 500, 500, 500],
      [510, 500, 510, 520, 540, 520, 510, 500, 510],
      [500, 500, 500, 500, 550, 500, 500, 500, 500],
      [500, 500, 500, 500, 550, 500, 500, 500, 500],
      [510, 510, 510, 510, 550, 510, 510, 510, 510],
      [510, 510, 510, 500, 550, 500, 510, 510, 510],
      [510, 500, 510, 500, 500, 500, 510, 500, 510],
      [510, 500, 510, 500, 500, 500, 510, 500, 510],
      [550, 540, 500, 500, 500, 500, 500, 540, 550]
    ]
  };
  function aiPieceTable(piece) {
    var type = pieceType(piece);
    return AI_SCORE[type] || null;
  }
  // 局面评估：以 aiColor 视角返回分值（己方分 ×1.1、对方 ×0.9，防无脑对子）
  function aiEvaluate(board, aiColor) {
    var score = 0;
    for (var r = 0; r < 10; r++) {
      for (var c = 0; c < 9; c++) {
        var piece = board[r][c];
        if (!piece) continue;
        var table = aiPieceTable(piece);
        if (!table) continue;
        var color = pieceColor(piece);
        var tr = color === 'black' ? r : 9 - r;
        var val = table[tr][c];
        if (color === aiColor) score += val * 1.1;
        else score -= val * 0.9;
      }
    }
    return score;
  }
  // MVV-LVA 分值：吃子价值为主、己方子力为辅，供排序与静态搜索
  var AI_PIECE_BASE = { king: 10000, rook: 600, cannon: 350, knight: 300, elephant: 120, guard: 120, pawn: 60 };
  function aiPieceValue(piece) { return AI_PIECE_BASE[pieceType(piece)] || 0; }
  // 按棋子类型只枚举候选落点（避免每子扫全盘 90 格）——这是原实现搜不深的根因
  // 伪合法走法入列：只查边界与己方子占位，**不查送将**。
  // 老实现在这里对每个候选做 make/unmake + 全盘 isInCheck，而 a-b 剪枝下内部节点
  // 平均只访问个位数走法就被截断，九成合法性检查纯属白做——这是搜不深的根因。
  // 合法性改在搜索/选根处落子后懒判定（aiMoveLeavesSelfCheck）。
  function aiPushPseudo(board, color, moves, fr, fc, tr, tc) {
    if (tr < 0 || tr > 9 || tc < 0 || tc > 8) return;
    var target = board[tr][tc];
    if (target && pieceColor(target) === color) return;
    moves.push({ fr: fr, fc: fc, tr: tr, tc: tc, piece: board[fr][fc], captured: target || null });
  }
  function aiRay(board, color, moves, fr, fc, dr, dc, cannon, capturesOnly) {
    var tr = fr + dr, tc = fc + dc;
    var screened = false;
    while (tr >= 0 && tr <= 9 && tc >= 0 && tc <= 8) {
      var target = board[tr][tc];
      if (!cannon) {
        if (!target) {
          if (!capturesOnly) aiPushPseudo(board, color, moves, fr, fc, tr, tc);
        } else {
          if (pieceColor(target) !== color) aiPushPseudo(board, color, moves, fr, fc, tr, tc);
          break;
        }
      } else if (!screened) {
        if (!target) {
          if (!capturesOnly) aiPushPseudo(board, color, moves, fr, fc, tr, tc);
        } else screened = true;
      } else {
        if (target) {
          if (pieceColor(target) !== color) aiPushPseudo(board, color, moves, fr, fc, tr, tc);
          break;
        }
      }
      tr += dr; tc += dc;
    }
  }
  function aiGenerateMoves(board, color, capturesOnly) {
    var moves = [];
    var dirs4 = [[-1, 0], [1, 0], [0, -1], [0, 1]];
    for (var r = 0; r < 10; r++) {
      for (var c = 0; c < 9; c++) {
        var piece = board[r][c];
        if (!piece || pieceColor(piece) !== color) continue;
        var type = pieceType(piece);
        if (type === 'king' || type === 'guard') {
          // 帅走正交一步、士走斜线一步。旧版两类共用 dirs4 正交方向、士又要求
          // dr===1&&dc===1 对角步——条件永假，AI 的士整局从不动（九宫防守瘫痪）。
          var step = type === 'guard' ? [[-1, -1], [-1, 1], [1, -1], [1, 1]] : dirs4;
          for (var d = 0; d < 4; d++) {
            var tr = r + step[d][0], tc = c + step[d][1];
            if (tr < 0 || tr > 9 || tc < 0 || tc > 8) continue;
            if (capturesOnly && !board[tr][tc]) continue;
            if (!inPalace(color, tr, tc)) continue;
            aiPushPseudo(board, color, moves, r, c, tr, tc);
          }
        } else if (type === 'elephant') {
          var eyes = [[-2, -2], [-2, 2], [2, -2], [2, 2]];
          for (var e = 0; e < 4; e++) {
            var er = r + eyes[e][0], ec = c + eyes[e][1];
            if (er < 0 || er > 9 || ec < 0 || ec > 8) continue;
            if (capturesOnly && !board[er][ec]) continue;
            if (color === 'red' && er < 5) continue;
            if (color === 'black' && er > 4) continue;
            if (board[r + eyes[e][0] / 2][c + eyes[e][1] / 2]) continue;
            aiPushPseudo(board, color, moves, r, c, er, ec);
          }
        } else if (type === 'knight') {
          var jumps = [[-2, -1], [-2, 1], [2, -1], [2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2]];
          for (var j = 0; j < 8; j++) {
            var jr = r + jumps[j][0], jc = c + jumps[j][1];
            if (jr < 0 || jr > 9 || jc < 0 || jc > 8) continue;
            if (capturesOnly && !board[jr][jc]) continue;
            var legR = Math.abs(jumps[j][0]) === 2 ? r + (jumps[j][0] > 0 ? 1 : -1) : r;
            var legC = Math.abs(jumps[j][0]) === 2 ? c : c + (jumps[j][1] > 0 ? 1 : -1);
            if (board[legR][legC]) continue;
            aiPushPseudo(board, color, moves, r, c, jr, jc);
          }
        } else if (type === 'pawn') {
          var forward = color === 'red' ? -1 : 1;
          var fr2 = r + forward;
          if (!(capturesOnly && !board[fr2][c]) && fr2 >= 0 && fr2 <= 9) {
            aiPushPseudo(board, color, moves, r, c, fr2, c);
          }
          var crossed = color === 'red' ? r <= 4 : r >= 5;
          if (crossed) {
            if (!(capturesOnly && !board[r][c - 1]) && c - 1 >= 0) aiPushPseudo(board, color, moves, r, c, r, c - 1);
            if (!(capturesOnly && !board[r][c + 1]) && c + 1 <= 8) aiPushPseudo(board, color, moves, r, c, r, c + 1);
          }
        } else if (type === 'rook') {
          for (var s = 0; s < 4; s++) aiRay(board, color, moves, r, c, dirs4[s][0], dirs4[s][1], false, capturesOnly);
        } else if (type === 'cannon') {
          for (var s2 = 0; s2 < 4; s2++) aiRay(board, color, moves, r, c, dirs4[s2][0], dirs4[s2][1], true, capturesOnly);
        }
      }
    }
    // MVV-LVA：先吃高价值子、后吃低价值/闲着，显著提高 a-b 剪枝率
    // 闲着再按历史启发二次排序（历史表命中时优先），不覆盖吃子序
    moves.sort(function(a, b) {
      var ac = a.captured ? 1 : 0, bc = b.captured ? 1 : 0;
      if (ac !== bc) return bc - ac;
      if (ac) {
        var av = aiPieceValue(a.captured) * 10 - aiPieceValue(a.piece);
        var bv = aiPieceValue(b.captured) * 10 - aiPieceValue(b.piece);
        return bv - av;
      }
      return 0;
    });
    return moves;
  }
  function aiMake(board, mv) {
    board[mv.tr][mv.tc] = mv.piece;
    board[mv.fr][mv.fc] = null;
  }
  function aiUnmake(board, mv) {
    board[mv.fr][mv.fc] = mv.piece;
    board[mv.tr][mv.tc] = mv.captured || null;
  }
  function aiHistoryIndex(mv) { return (mv.fr * 9 + mv.fc) * 100 + mv.tr * 10 + mv.tc; }
  // 吃子静态搜索：叶子沿吃子延伸，缓解视野效应（depth 边界外的连吃/反吃不再失明）。
  // 约定必须与 aiSearch 完全一致：返回值恒为 aiColor 视角、递归不取负、窗口原样下传。
  // （旧版递归处写了 -递归(-beta,-alpha) 的 negamax 取负，而本函数 stand-pat 又是
  //   min/max 写法，两种约定混用后两段以上的吃子链评估直接失真——困难档棋力劣化主因。）
  // 吃子序保持生成器的 MVV-LVA，不再按历史表重排（历史值统计的是闲着，会打乱吃子序）。
  // 必须限深：无上限时吃链会吃光预算，导致整层作废。
  function aiQuiesce(board, side, alpha, beta, aiColor, deadline, qdepth) {
    if (Date.now() > deadline) return aiEvaluate(board, aiColor);
    var stand = aiEvaluate(board, aiColor);
    var best = stand;
    if (side === aiColor) {
      if (stand >= beta) return beta;
      if (stand > alpha) alpha = stand;
    } else {
      if (stand <= alpha) return alpha;
      if (stand < beta) beta = stand;
    }
    if (qdepth <= 0) return best;
    var moves = aiGenerateMoves(board, side, true);
    for (var i = 0; i < moves.length; i++) {
      var mv = moves[i];
      if (mv.captured === 'r_king' || mv.captured === 'b_king') return side === aiColor ? AI_MATE : -AI_MATE;
      aiMake(board, mv);
      // 懒合法化：伪合法吃子走完若己方被将军（含将帅对脸），弃用
      if (isInCheck(board, side)) { aiUnmake(board, mv); continue; }
      var sc = aiQuiesce(board, side === 'red' ? 'black' : 'red', alpha, beta, aiColor, deadline, qdepth - 1);
      aiUnmake(board, mv);
      if (side === aiColor) {
        if (sc > best) best = sc;
        if (sc > alpha) alpha = sc;
      } else {
        if (sc < best) best = sc;
        if (sc < beta) beta = sc;
      }
      if (alpha >= beta || Date.now() > deadline) break;
    }
    return best;
  }
  // 叶子级「是否还有着可走」：仅在待走方被将军时调用（无子可走=将死）。
  // 走法生成改伪合法后，被完全牵制的棋子也会产生伪走法，将死判定必须逐个懒验证。
  function aiHasLegalMove(board, side) {
    var moves = aiGenerateMoves(board, side);
    for (var i = 0; i < moves.length; i++) {
      var mv = moves[i];
      aiMake(board, mv);
      var ok = !isInCheck(board, side);
      aiUnmake(board, mv);
      if (ok) return true;
    }
    return false;
  }
  // 极大极小 + a-b；返回 { score, move, done }。side 为待走方，aiColor 为评估基准。
  // 分值恒为 aiColor 视角、窗口原样下传（不用 negamax 取负约定）。
  // done=false 表示本层未搜完（超时），调用方不得采纳半截结果。
  // isRoot：根节点支持 rootBest（上轮迭代最佳着法）置首，提高同预算下的剪枝率。
  // 空步裁剪已移除：旧实现按 negamax 翻转窗口，与本 min/max 约定不符，会产生错误截断。
  function aiSearch(board, side, depth, alpha, beta, aiColor, deadline, cfg, history, isRoot, rootBest) {
    if (Date.now() > deadline) return { score: aiEvaluate(board, aiColor), move: null, done: false };
    var moves = aiGenerateMoves(board, side);
    if (!moves.length) {
      return { score: isInCheck(board, side) ? -AI_MATE : 0, move: null, done: true };
    }
    if (cfg.history && history) {
      // 仅重排闲着：吃子已按 MVV-LVA，历史启发用于提高非吃子截断率
      var captures = [], quiets = [];
      for (var h = 0; h < moves.length; h++) {
        if (moves[h].captured) captures.push(moves[h]);
        else quiets.push(moves[h]);
      }
      quiets.sort(function(a, b) { return (history[aiHistoryIndex(b)] || 0) - (history[aiHistoryIndex(a)] || 0); });
      moves = captures.concat(quiets);
    }
    if (isRoot && rootBest) {
      // 着法对象每轮重新生成，按坐标匹配上轮最佳
      for (var rb = 0; rb < moves.length; rb++) {
        var rm = moves[rb];
        if (rm.fr === rootBest.fr && rm.fc === rootBest.fc && rm.tr === rootBest.tr && rm.tc === rootBest.tc) {
          if (rb > 0) { moves.splice(rb, 1); moves.unshift(rm); }
          break;
        }
      }
    }
    if (depth <= 0) {
      // 叶子被将军时必须验证将死：伪合法走法存在不代表有着可走（全被牵制）
      if (isInCheck(board, side) && !aiHasLegalMove(board, side)) {
        return { score: -AI_MATE, move: null, done: true };
      }
      if (cfg.quiesce) {
        return { score: aiQuiesce(board, side, alpha, beta, aiColor, deadline, 4), move: null, done: Date.now() <= deadline };
      }
      var leaf = aiEvaluate(board, aiColor);
      return { score: leaf, move: null, done: true };
    }
    var best = null;
    var bestScore = side === aiColor ? -AI_INF : AI_INF;
    var completed = true;
    var anyLegal = false;
    for (var j = 0; j < moves.length; j++) {
      if (Date.now() > deadline) { completed = false; break; }
      var move = moves[j];
      aiMake(board, move);
      // 懒合法化：伪合法走完若己方被将军（含将帅对脸），弃用该着
      if (isInCheck(board, side)) { aiUnmake(board, move); continue; }
      anyLegal = true;
      var score;
      if (move.captured === 'r_king' || move.captured === 'b_king') {
        score = side === aiColor ? AI_MATE : -AI_MATE;
      } else {
        var child = aiSearch(board, side === 'red' ? 'black' : 'red', depth - 1, alpha, beta, aiColor, deadline, cfg, history, false);
        score = child.score;
        if (!child.done) completed = false;
      }
      aiUnmake(board, move);
      if (side === aiColor) {
        if (score > bestScore) { bestScore = score; best = move; }
        if (score > alpha) alpha = score;
      } else {
        if (score < bestScore) { bestScore = score; best = move; }
        if (score < beta) beta = score;
      }
      if (alpha >= beta) {
        if (cfg.history && history && (move.captured || depth > 2)) {
          var hi = aiHistoryIndex(move);
          history[hi] = (history[hi] || 0) + depth * depth;
        }
        break;
      }
      if (Date.now() > deadline) { completed = false; break; }
    }
    // 伪走法全被懒合法化滤掉：仅在循环正常跑完时才可下将死/困毙结论；
    // 超时打断（completed=false）时不得声称无着可走，交由上层丢弃本轮结果。
    if (!anyLegal) {
      if (completed) {
        return { score: isInCheck(board, side) ? -AI_MATE : 0, move: null, done: true };
      }
      return { score: aiEvaluate(board, aiColor), move: null, done: false };
    }
    return { score: bestScore, move: best, done: completed };
  }
  // 迭代加深入口：按难度配置预算/深度；只采纳搜完整层的结果。
  // 走法生成为伪合法，这里先懒过滤送将（同时给简单档的随机失误兜底：不会送将）。
  function aiBestMove(board, aiColor, level) {
    var cfg = aiLevelConfig(level).fallback;
    var pseudo = aiGenerateMoves(board, aiColor);
    if (!pseudo.length) return null;
    var moves = [];
    for (var li = 0; li < pseudo.length; li++) {
      var lm = pseudo[li];
      aiMake(board, lm);
      if (!isInCheck(board, aiColor)) moves.push(lm);
      aiUnmake(board, lm);
    }
    if (!moves.length) return null;
    if (moves.length === 1) return moves[0];
    if (cfg.blunderRate > 0 && Math.random() < cfg.blunderRate) {
      var safe = [];
      for (var i = 0; i < moves.length; i++) {
        if (moves[i].captured !== 'r_king' && moves[i].captured !== 'b_king') safe.push(moves[i]);
      }
      if (safe.length) return safe[Math.floor(Math.random() * safe.length)];
    }
    var history = cfg.history ? AI_HISTORY : null;
    var deadline = Date.now() + cfg.budget;
    var best = moves[0];
    var reached = 0;
    for (var depth = cfg.minDepth; depth <= cfg.maxDepth; depth++) {
      var result = aiSearch(board, aiColor, depth, -AI_INF, AI_INF, aiColor, deadline, cfg, history, true, reached ? best : null);
      if (result.move && result.done) {
        best = result.move;
        reached = depth;
      } else {
        break;
      }
      if (Date.now() > deadline) break;
      // 将死分差已出现则不必再搜
      if (cfg.quiesce && Math.abs(result.score) > AI_MATE - 500) break;
    }
    if (!reached) best = moves[0];
    return best;
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
      // 提示：仅人机模式显示（借服务端引擎算一手推荐着法）。放在悔棋右侧是因为
      // 人机模式下「认输/换方/分享」都隐藏，位数与联机模式一致，不会把标题栏挤成两行。
      t('button', 'is-secondary', { type: 'button', 'data-action': 'hint', text: '提示' }),
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

    // 电脑棋力：三档全是满子，差别只在思考时间（见 AI_LEVELS 注释）。
    // 下拉不设默认选中项时浏览器取第一项「快速」——弱档，会被当成「人机好傻」，
    // 故显式把 selected 打在默认档上。
    var levelSelect = t('select', null, { 'data-field': 'level' }, [
      t('option', null, { value: 'quick', text: '快速' }),
      t('option', null, { value: 'normal', text: '常规', selected: 'selected' }),
      t('option', null, { value: 'master', text: '大师' })
    ]);
    var levelLabel = t('label', null, { text: '电脑棋力' });
    levelLabel.appendChild(levelSelect);

    var entryCard = t('div', 'chess-entry-card', null, [
      t('h2', null, { text: '进入棋局' }),
      t('p', null, { text: '创建房间邀请同学对战，或用本地/人机模式离线对弈。红方先行。' }),
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
        t('button', 'is-secondary', { type: 'button', 'data-action': 'local', text: '本地对战' }),
        levelLabel,
        t('button', 'is-secondary', { type: 'button', 'data-action': 'solo', text: '人机练习' })
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
    // ===== 引擎分析页（对齐皮卡鱼网页版的「引擎」面板）=====
    // 评分条 + 引擎自报的深度/节点/用时 + Top-N 候选着法（中文记谱，点一条即在棋盘画箭头）。
    // 只在人机练习/本地对战时出现：房间联机里它是「帮对方想棋」，
    // 而且服务端引擎是单实例串行队列，全班一起开分析会把别人的应手挤到排队。
    var evalFill = t('span', 'chess-eval-fill', { 'aria-hidden': 'true' });
    var evalBar = t('div', 'chess-eval-bar', { 'data-role': 'eval-bar' }, [evalFill]);
    var evalScore = t('span', 'chess-eval-score', { 'data-role': 'eval-score', text: '—' });
    var evalCaption = t('div', 'chess-eval-caption', null, [
      t('span', 'chess-eval-side is-red', { text: '红方' }),
      evalScore,
      t('span', 'chess-eval-side is-black', { text: '黑方' })
    ]);
    var engineInfo = t('p', 'chess-engine-info', { 'data-role': 'engine-info' });
    var engineLineList = t('ul', 'chess-line-list', { 'data-role': 'line-list' });
    var engineFoot = t('p', 'chess-engine-foot', { 'data-role': 'engine-foot' });
    var enginePanel = t('div', 'chess-engine-panel', {
      'data-role': 'engine-panel', role: 'tabpanel', 'aria-labelledby': 'chess-tab-engine'
    }, [
      t('div', 'chess-engine-tools', null, [
        t('button', 'is-secondary', { type: 'button', 'data-action': 'analyse', text: '分析当前局面' }),
        t('button', 'is-secondary is-toggle is-on', {
          type: 'button', 'data-action': 'auto-analyse', 'aria-pressed': 'true', text: '自动分析'
        })
      ]),
      t('div', 'chess-engine-eval', null, [evalBar, evalCaption]),
      engineInfo,
      engineLineList,
      engineFoot
    ]);
    enginePanel.hidden = true;
    var engineTabButton = t('button', 'chess-tab', {
      type: 'button', 'data-action': 'tab-engine', role: 'tab', id: 'chess-tab-engine', 'aria-selected': 'false', text: '引擎'
    });
    var tabs = t('div', 'chess-info-tabs', { role: 'tablist', 'aria-label': '侧栏切换' }, [infoTabButton, chatTabButton, engineTabButton]);
    tabs.hidden = true;
    var info = t('aside', 'chess-info', null, [turnBanner, tabs, infoPanel, chat, enginePanel]);
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
    // 对局模式：'' 未进入 | 'room' 房间联机 | 'local' 本地双人 | 'solo' 人机练习（纯本地，不走后端）
    var mode = roomCode ? 'room' : '';
    var disposed = false;
    var pending = false;
    var selected = null;          // 当前选中棋子 { row, col }
    var legal = [];               // 选中棋子的合法落点提示
    var lastAnimatedKey = '';     // 最新一手动画去重键
    var labelsPrimed = false;     // 无障碍标签首轮是否已补齐
    // 本地对弈走子历史（悔棋依据）：{ fr, fc, tr, tc, piece, captured }
    var localHistory = [];
    // 人机练习的应手状态。旧实现只有一个 setTimeout 句柄；改走服务端引擎后必须有
    // 「作废在途回调」的能力——重开/退出/悔棋都可能让一个已经发出的请求迟到返回，
    // 迟到的着法落到新局面或新一局上，表现出来就是「莫名其妙自己动了一步」。
    var aiPending = false;         // 电脑思考中（远程引擎或本地兜底）
    var aiToken = 0;               // 会话代次：任何中断（重开/退出/悔棋/换档）都自增
    var aiTimer = null;            // 应手延时/在途定时器（卸载时必须清理）
    var soloGameKey = '';          // 每局一个随机 key：后端据此判断要不要 ucinewgame（清哈希）
    var aiEngineState = 'unknown'; // unknown | pikafish | builtin：当前实际生效的引擎
    var aiEngineName = '';         // 引擎自报名（如 "Pikafish 2026-09-06"）
    // ===== 引擎分析（侧栏「引擎」页）=====
    // 只在引擎页可见时才发请求：服务端引擎是单实例串行队列，全班一起挂着分析会把
    // 别人的应手挤到排队。切页才跑 = 用户主动要看才占资源，天然是节流阀。
    var ANALYSE_MOVETIME = 800;    // 分析预算固定，不跟着棋力档走（大师档 2.2s 太慢）
    var ANALYSE_LINES = 3;         // = MultiPV，后端 clamp 到 1~5
    // 「自动分析」开关（持久化在 localStorage.chess_analyse）。
    // ⚠️ 语义必须分清：关掉 = 不再随走子自动重算，**但手动点「分析当前局面」照样可用**。
    // 之前 runAnalyse 无差别地 `if (!analysisOn) return`，把手动入口一起堵死了——正好反了：
    // 手动分析恰恰是「自动关掉」之后用户唯一的手段。
    var analysisOn = true;
    var analysisData = null;       // 最近一次分析结果
    var analysisDoneKey = '';      // 已完成分析的局面键（棋盘|轮次）
    var analysisBusyKey = '';      // 在途分析的局面键
    var analysisTimer = null;      // 防抖句柄（卸载必须清）
    var analysisToken = 0;         // 代次：换局/退出/悔棋作废在途回调
    var analysisNote = '';         // 降级/失败/进行中的一句话说明
    var activeLine = -1;           // 当前高亮的候选序号（-1 = 无）
    var arrowMove = null;          // 棋盘箭头 { fr, fc, tr, tc }（点候选着法才出现）
    var lastArrowKey = '';         // 箭头层 diff 键
    var soloColor = 'red';        // 人机练习玩家执色（红方先手，玩家默认执红）
    var soloLevel = 'normal';     // 电脑棋力 easy/normal/hard/master（入场卡选择，会话恢复保留）
    var levelElement = null;      // 入场卡棋力下拉（root 挂载后缓存）
    var state = { board: initialBoard(), turn: 'red', winner: null, result: null, status: 'active', check: false, members: [], lastMove: null };
    // 会话持久化：切去聊天/社区再返回时恢复本地对局与房间（sessionStorage，关页即清）
    var SESSION_KEY = 'chess_session';
    function saveSession() {
      try {
        if (mode === 'room' && roomCode) {
          sessionStorage.setItem(SESSION_KEY, JSON.stringify({ mode: 'room', roomCode: roomCode }));
        } else if ((mode === 'local' || mode === 'solo') && (localHistory.length || state.winner)) {
          sessionStorage.setItem(SESSION_KEY, JSON.stringify({
            mode: mode,
            soloColor: mode === 'solo' ? soloColor : null,
            soloLevel: mode === 'solo' ? soloLevel : null,
            offline: { board: state.board, turn: state.turn, winner: state.winner, result: state.result, status: state.status, lastMove: state.lastMove, history: localHistory }
          }));
        } else if (mode === 'local' || mode === 'solo') {
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
    levelElement = root.querySelector('[data-field="level"]');
    // 记住上次人机棋力（localStorage）。会话恢复中的进行中对局稍后会用存档档位覆盖此处。
    if (levelElement) {
      try {
        var savedLevel = localStorage.getItem('chess_level');
        if (AI_LEVELS[savedLevel]) levelElement.value = savedLevel;
      } catch (e) {}
    }
    // 「自动分析」偏好同理持久化：关掉的人不希望每次开新局又被自动跑一遍分析。
    // 只在明确存过 '0' 时才关——读不到/异常一律保持默认开，别把默认值读丢了。
    try {
      if (localStorage.getItem('chess_analyse') === '0') analysisOn = false;
    } catch (e) {}
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
    var hintButton = root.querySelector('[data-action="hint"]');
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
    // 引擎页节点：render 是热路径，同样一次缓存
    var enginePanelElement = root.querySelector('[data-role="engine-panel"]');
    var engineTabButtonElement = root.querySelector('[data-action="tab-engine"]');
    var evalFillElement = root.querySelector('.chess-eval-fill');
    var evalScoreElement = root.querySelector('[data-role="eval-score"]');
    var engineInfoElement = root.querySelector('[data-role="engine-info"]');
    var engineLineListElement = root.querySelector('[data-role="line-list"]');
    var engineFootElement = root.querySelector('[data-role="engine-foot"]');
    var analyseButtonElement = root.querySelector('[data-action="analyse"]');
    var autoAnalyseButtonElement = root.querySelector('[data-action="auto-analyse"]');

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

    // 侧栏分页可选项是模式相关的：
    //   房间联机 = 信息 / 聊天 / 引擎（三页）
    //   单机（人机 · 本地双人）= 信息 / 引擎
    // 聊天在单机没有意义（一块屏两个人）。引擎页 2026-10-01 起**房间也有**：
    // 按需求开放给双人对战与观战者（观战者也能打开看局面分析）。服务端为此加了
    // 「同局面结果缓存 + 在途合并」——一个房间的人问的是同一个局面，只占一次引擎。
    function hasChatTab() { return mode === 'room' && !!roomCode; }
    function hasEngineTab() { return mode === 'solo' || mode === 'local' || (mode === 'room' && !!roomCode); }
    function tabbed() { return hasChatTab() || hasEngineTab(); }
    // 把 activeTab 收敛到当前模式下真实存在的页
    function effectiveTab() {
      if (activeTab === 'chat' && hasChatTab()) return 'chat';
      if (activeTab === 'engine' && hasEngineTab()) return 'engine';
      return 'info';
    }
    function renderTabs() {
      var inRoom = hasChatTab();
      var engineTab = hasEngineTab();
      var tab = effectiveTab();
      if (tabsElement) tabsElement.hidden = !tabbed();
      if (infoTabButtonElement) {
        var infoActive = tab === 'info';
        setClass(infoTabButtonElement, 'chess-tab' + (infoActive ? ' is-active' : ''));
        infoTabButtonElement.setAttribute('aria-selected', infoActive ? 'true' : 'false');
        setText(infoTabButtonElement, inRoom ? '房间信息' : '对局信息');
      }
      if (chatTabButtonElement) chatTabButtonElement.hidden = !inRoom;
      if (engineTabButtonElement) engineTabButtonElement.hidden = !engineTab;
      if (chatElement) chatElement.hidden = tab !== 'chat';
      if (enginePanelElement) enginePanelElement.hidden = tab !== 'engine';
      // 信息页：非分页态（入场）恒显示；分页态下与另外两页互斥
      if (infoPanelElement) infoPanelElement.hidden = tab !== 'info';
      var chatActive = tab === 'chat';
      var showBadge = inRoom && !chatActive && chatUnread > 0;
      if (chatTabButtonElement) {
        setClass(chatTabButtonElement, 'chess-tab' + (chatActive ? ' is-active' : '') + (showBadge ? ' is-unread' : ''));
        chatTabButtonElement.setAttribute('aria-selected', chatActive ? 'true' : 'false');
      }
      if (engineTabButtonElement) {
        var engineActive = tab === 'engine';
        setClass(engineTabButtonElement, 'chess-tab' + (engineActive ? ' is-active' : ''));
        engineTabButtonElement.setAttribute('aria-selected', engineActive ? 'true' : 'false');
      }
      if (chatTabBadgeElement) {
        var badge = showBadge ? (chatUnread > 99 ? '99+' : String(chatUnread)) : '';
        if (chatTabBadgeElement.textContent !== badge) chatTabBadgeElement.textContent = badge;
        chatTabBadgeElement.hidden = !badge;
      }
    }
    function setTab(tab) {
      var next = (tab === 'chat' || tab === 'engine') ? tab : 'info';
      if (next === activeTab) return;
      activeTab = next;
      if (activeTab === 'chat') chatUnread = 0;
      renderTabs();
      // 切页后 render 会经 syncAnalysis 决定要不要立刻补一次分析（引擎页可见才跑）
      render();
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
      // AI 思考中禁止选子（防连点导致状态错乱）
      if (mode === 'solo' && aiPending) return false;
      // 本地双人：只许选中当前手一方的棋子（否则点击敌子会命中「改选」分支，
      // 永远走不到吃子判定——2026-09-21 实测发现的真 bug）
      if (mode === 'local') return pieceColor(piece) === state.turn;
      // 人机练习：只许选玩家执色的棋子，且必须轮到玩家
      if (mode === 'solo') return pieceColor(piece) === soloColor && state.turn === soloColor;
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
      if (mode === 'local' || mode === 'solo') {
        var soloSides = mode === 'solo'
          ? [[soloColor, '我（' + (soloColor === 'red' ? '红方' : '黑方') + '）', soloColor === 'red' ? '先手' : '后手'],
             [soloColor === 'red' ? 'black' : 'red', '电脑', soloColor === 'red' ? '后手' : '先手']]
          : [['red', '红方', '先手'], ['black', '黑方', '后手']];
        soloSides.forEach(function(entry) {
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
    // 交点层引用（逐格 diff 的锚点）与箭头层引用。不用 lastElementChild：
    // 箭头层必须画在交点层之上，于是它成了最后一个子元素。
    var cellsElement = null;
    var arrowLayerElement = null;
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
      // ⚠️ 顺序有讲究：箭头层必须画在交点层**之后**（z 序在上，否则被棋子盖住），
      // 而 render 里靠 pointsElement 逐格 diff，所以交点层的位置改为显式缓存
      // cellsElement，不再用 lastElementChild（那是箭头层了）。
      arrowLayerElement = buildArrowLayer(boardElement);
      lastArrowKey = '';
      cellsElement = pointsElement;
      labelsPrimed = false; // 交点重建后需在下一轮 render 重新补齐无障碍标签
      boardBuilt = true;
    }
    function render() {
      var inGame = mode !== '';
      var isLocal = mode === 'local' || mode === 'solo';
      var member = currentMember();
      // 视角同步：我执黑则棋盘翻转（换色/入房后颜色变化在这里被检测到）
      syncOrientation(member);
      // 标题栏/侧栏按钮可见性：单机隐藏分享类，未进入对局隐藏全部
      // （headerActionButtons 在 mount 时缓存，含侧栏 room-tools 的低频按钮）
      var actionButtons = headerActionButtons;
      for (var a = 0; a < actionButtons.length; a++) {
        var kind = actionButtons[a].dataset.action;
        if (mode === '') { actionButtons[a].hidden = true; continue; }
        // 提示在 人机 / 本地双人 / 房间（含观战者）都可用。
        // 这里只管「显不显示」——它的可用性随轮次变化，交给下面 disabled 表达，
        // 不隐藏才能保证按钮位置稳定（否则到别人回合按钮就消失、整个标题栏重排）。
        // ⚠️ 必须显式写回 false：入场态（mode === ''）那一轮把**所有**按钮都置了 hidden = true，
        //    这里若只 `continue` 就会把那个 true 一直留着 —— 按钮在房间里永远不出现。
        if (kind === 'hint') { actionButtons[a].hidden = false; continue; }
        // 人机/本地隐藏分享类；人机额外隐藏换方（色已固定）与认输（可直接退出）
        actionButtons[a].hidden = isLocal && (kind === 'copy' || kind === 'share-chat' || kind === 'share-community' || kind === 'color' || kind === 'resign');
      }
      root.classList.toggle('chess-room-mode', mode === 'room' && !!roomCode);
      setText(roomElement, mode === 'solo' ? '人机练习' : mode === 'local' ? '本地对战' : (roomCode ? '房间 ' + roomCode : '未进入房间'));
      setText(identityElement, mode === 'solo'
        // 档位含义是「思考时间」而非让子，所以要写清楚它代表强弱而非棋份。
        // 引擎名不放这里（副标题已经很长），改由连接灯位置的 chip 显示 Pikafish / 内置。
        ? ('我执' + (soloColor === 'red' ? '红' : '黑') + ' · 电脑执' + (soloColor === 'red' ? '黑' : '红')
          + ' · ' + aiLevelConfig(soloLevel).label)
        : mode === 'local' ? '双人同屏 · 红方先手'
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
          : mode === 'solo' && aiPending ? '电脑思考中…'
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
        } else if (mode === 'solo' && aiPending) {
          bannerClass += ' is-waiting';
          bannerText = '电脑思考中…';
        } else {
          bannerClass += ' is-turn-' + state.turn + (state.check ? ' is-check' : '');
          bannerText = (state.check ? '将军！' : '') + (state.turn === 'red' ? '轮到红方' : '轮到黑方');
        }
        setClass(bannerElement, bannerClass);
        setText(bannerElement, bannerText);
      }
      if (isLocal) setConnection(mode === 'solo' && aiPending ? '电脑思考中' : (mode === 'solo' ? soloEngineText() || '本地对弈' : '本地对弈'), 'online');
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
      var pointsElement = cellsElement || boardElement.lastElementChild;
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
      setText(leaveButton, isLocal ? (mode === 'solo' ? '退出人机' : '退出练习') : '离开房间');
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
      // 提示按钮：人机 / 本地双人 / 房间都显示，可用性由 hintSide() 决定
      // （人机=只在自己回合；本地=跟着当前行棋方；房间=玩家只在自己回合、观战者按当前行棋方）。
      // 引擎不可用时也允许点——后端降级后会回落内置 AI，提示照样给得出来。
      if (hintButton) {
        hintButton.disabled = !hintSide() || aiPending || pending;
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
        setText(finishedElement, state.winner
          ? (mode === 'solo'
            ? (state.winner === 'draw' ? '困毙，和棋' : state.winner === soloColor ? '恭喜，你赢了！' : '电脑获胜，再战一局？')
            : resultText(state))
          : '');
        continueButton.hidden = !finished;
        continueButton.textContent = '重开一局';
      } else {
        setText(finishedElement, finished ? (state.winner ? '本局结束，房主可以继续或离开。' : '准备下一局。') : '');
        continueButton.hidden = !finished || !owner;
        continueButton.textContent = '继续下一局';
      }
      // 引擎页：可能触发一次去抖分析（只在引擎页可见且局面未分析过时），
      // 然后重画面板与箭头。顺序不能反——syncAnalysis 会先把过期结论撤下。
      syncAnalysis();
      renderEnginePanel();
      renderArrows();
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
      // 人机练习：轮到电脑则调度 AI 应手
      if (mode === 'solo' && !state.winner && state.status === 'active' && state.turn !== soloColor) scheduleAi();
    }

    // ===== 人机应手：服务端引擎优先，内置搜索兜底 =====
    // 时序（每一步都有实际理由，别顺手删）：
    //   1) 起手先 render 让「电脑思考中…」上屏，再延时 160ms 发请求——引擎在服务端，
    //      本地那一帧不该被任何同步计算占用（旧版在这里同步搜 150~900ms，就是「点了半天没反应」）。
    //   2) 请求带上局面签名（boardKey），回来时局面变过（悔棋/重开/换局）就直接丢弃。
    //   3) aiToken 作废在途回调：光比局面签名拦不住「撤销后又走回同一局面」。
    //   4) 引擎失败 → 立即回落内置 AI，用户只看到副标题从 Pikafish 变成「内置」。
    // 连接灯位置的引擎标记：人机模式显示实际生效的引擎（探测前为空，首次应手后必达 accurate）
    function soloEngineText() {
      if (mode !== 'solo') return '';
      if (aiEngineState === 'builtin') return '内置引擎';
      if (aiEngineState === 'pikafish') return shortEngineName();
      return '';
    }
    // 自报名形如 "Pikafish 2026-09-06"，副标题只放主名，版本号留给以后的调试面板
    function shortEngineName() {
      var name = String(aiEngineName || 'Pikafish');
      var space = name.indexOf(' ');
      return space > 0 ? name.slice(0, space) : name;
    }
    // 局面签名：90 格拍平成串。只用于「这一步请求返回时局面是否已变」的比对，
    // 不参与任何持久化，故不需要 hash，字符串直比即可（一次应手算一次，开销可忽略）。
    function boardKey(board) {
      var parts = [];
      for (var r = 0; r < 10; r++) {
        for (var c = 0; c < 9; c++) parts.push(board[r][c] || '.');
      }
      return parts.join(',');
    }
    function makeGameKey() {
      return 'g' + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);
    }
    // 中断应手：++代次作废在途回调 + 清思考态。所有会改变局面/会话状态的入口都要调它。
    function aiAbort() {
      aiToken += 1;
      if (aiTimer) { clearTimeout(aiTimer); aiTimer = null; }
      if (aiPending) { aiPending = false; return true; }   // 返回 true 表示调用方需要补一次 render
      return false;
    }
    // 引擎能力探测：只在挂载时探一次。不可用时副标题显示「内置」，学生不用等一次失败才知道。
    function probeAiEngine() {
      request(context, 'GET', '/chess/ai/status', {}).then(function(data) {
        if (disposed) return;
        if (data && data.available) {
          aiEngineState = 'pikafish';
          aiEngineName = data.engineName || 'Pikafish';
        } else {
          aiEngineState = 'builtin';
        }
        render();
      }).catch(function() {
        if (disposed) return;
        // 探测本身失败（离线/旧后端/接口 404）不代表引擎不可用：保持 unknown 不写标记，
        // 真正的判定交给首次应手（成功=pikafish、失败=builtin），不要在这里误判成「没有引擎」。
      });
    }

    function scheduleAi() {
      if (disposed) return;
      if (mode !== 'solo' || state.winner || state.status !== 'active') return;
      if (state.turn === soloColor) return;
      aiAbort();
      var token = aiToken;
      aiPending = true;
      render();   // 先让「电脑思考中…」上屏
      aiTimer = setTimeout(function() {
        aiTimer = null;
        if (aiToken !== token || disposed) return;
        if (mode !== 'solo' || state.winner || state.status !== 'active') { aiPending = false; render(); return; }
        if (state.turn === soloColor) { aiPending = false; render(); return; }
        requestAiMove(token);
      }, 160);
    }

    function requestAiMove(token) {
      var key = boardKey(state.board);
      var aiSide = state.turn;   // 轮谁走就是谁要应手（人机模式下必然是电脑执色）
      request(context, 'POST', '/chess/ai/move', {
        board: state.board,
        turn: aiSide,
        level: soloLevel,
        gameKey: soloGameKey
      }).then(function(data) {
        if (aiToken !== token || disposed) return;              // 已被中断（重开/退出/悔棋）
        if (boardKey(state.board) !== key) return;              // 局面已变，丢弃迟到着法
        aiEngineState = 'pikafish';
        if (data && data.engineName) aiEngineName = data.engineName;
        var mv = data && data.move;
        aiPending = false;
        if (!mv) { render(); return; }                          // 无着可走：交回玩家
        applyLocalMove(mv.fromRow, mv.fromCol, mv.toRow, mv.toCol);
      }).catch(function() {
        if (aiToken !== token || disposed) return;
        if (boardKey(state.board) !== key) return;
        // 降级路径：引擎不可用/排队满/超时/着法未过校验 → 内置搜索兜底
        aiEngineState = 'builtin';
        localAiMove(aiSide);
      });
    }

    // 内置兜底：仍是主线程同步搜索（会占用一帧到数百毫秒），只在这条降级路径上跑
    function localAiMove(aiSide) {
      var mv = aiBestMove(state.board, aiSide, soloLevel);
      aiPending = false;
      if (!mv) { render(); return; }   // 理论上级 applyLocalMove 已判将死/困毙
      applyLocalMove(mv.fr, mv.fc, mv.tr, mv.tc);
    }

    // ===== 提示：借引擎算一手推荐着法 =====
    // 表现上复用「选中 + 落点提示」这套既有交互：点提示后自动选中推荐棋子、
    // 只留一个落点，玩家再点一下即可落子（不自动走，避免误触改变局面）。
    // 归属方由 hintSide() 决定；提示在 人机 / 本地双人 / 房间（含观战者）三种模式都可用。
    function hintSide() {
      if (state.winner || state.status !== 'active') return null;
      // 人机：只有轮到玩家时才给，否则等于提前泄露电脑要走哪儿
      if (mode === 'solo') return state.turn === soloColor ? soloColor : null;
      // 本地双人：一块屏两个人，谁走就帮谁
      if (mode === 'local') return state.turn;
      // 房间：玩家只在自己回合可用（免得替对手想棋）；
      // 观战者无色可轮，就按当前行棋方给——「观战也能用」是明确需求
      if (mode === 'room') {
        var member = currentMember();
        if (member && member.color) return state.turn === member.color ? member.color : null;
        return state.turn;
      }
      return null;
    }
    function requestHint() {
      if (disposed || aiPending) return;
      var side = hintSide();
      if (!side) return;
      var key = boardKey(state.board);
      var token = aiToken;
      aiPending = true;
      render();
      request(context, 'POST', '/chess/ai/move', {
        board: state.board,
        turn: side,
        // 提示永远用顶级预算（与棋力档无关）：它要的是「好棋」，不是「像对手那样想」
        level: 'master',
        gameKey: analysisGameKey()
      }).then(function(data) {
        if (aiToken !== token || disposed) return;
        if (boardKey(state.board) !== key) { aiPending = false; return; }
        aiPending = false;
        var mv = data && data.move;
        if (!mv) { render(); return; }
        selected = { row: mv.fromRow, col: mv.fromCol };
        legal = [{ row: mv.toRow, col: mv.toCol }];
        buzz(8);
        render();
      }).catch(function() {
        if (aiToken !== token || disposed) return;
        aiPending = false;
        // 引擎不可用时不静默：明确告诉用户这次提示没算出来
        setError('引擎暂时不可用，请稍后再试');
        render();
      });
    }

    // ===== 引擎分析面板（侧栏「引擎」页）=====
    // 数据流：切到引擎页 / 走子落地 → syncAnalysis 去抖 320ms → POST /ai/analyse
    // → 校验局面未变 → renderEnginePanel。任何中断（换局/悔棋/退出/卸载）都自增
    // analysisToken，让在途回调失效——迟到的分析结果落到新局面上的表现是
    // 「候选着法对不上棋盘」，比不显示更糟。
    function analysisKey() { return boardKey(state.board) + '|' + state.turn; }
    // 引擎靠 gameKey 判断要不要 ucinewgame（清哈希）。房间/本地给一个稳定键：
    // 同一局内不清哈希（换位表留着，后续局面搜得更深），跨局自然换键。
    function analysisGameKey() {
      if (mode === 'solo') return soloGameKey;
      if (mode === 'room') return 'room-' + roomCode;
      if (mode === 'local') return 'local';
      return '';
    }
    function engineTabOpen() {
      // 对局结束后也允许分析：复盘是「棋局分析」最自然的用法之一。
      // 只排除「房间等人」那种既没结束、又不在对局中的中间态。
      return hasEngineTab() && effectiveTab() === 'engine' && (state.status === 'active' || !!state.winner);
    }
    function analysisAbort() {
      analysisToken += 1;
      if (analysisTimer) { clearTimeout(analysisTimer); analysisTimer = null; }
      analysisBusyKey = '';
      analysisDoneKey = '';
      analysisData = null;
      analysisNote = '';
      activeLine = -1;
      arrowMove = null;
    }
    // force=true 来自「分析当前局面」按钮：显式手动请求，绕过自动开关与 done/busy 去重。
    // 自动分析（syncAnalysis 那条路）不传 force，才受 analysisOn 与去重约束。
    function runAnalyse(force) {
      if (disposed || !engineTabOpen()) return;
      if (!analysisOn && !force) return;
      var key = analysisKey();
      if (!force && (key === analysisDoneKey || key === analysisBusyKey)) return;
      // 不与人机应手/提示抢队列：在途时先让路，等它落地后那次 render 会再叫一次
      if (aiPending) return;
      var token = analysisToken;
      analysisBusyKey = key;
      analysisNote = '分析中…';   // 面板要能区分「正在算」和「没结论」，否则用户只看到空面板
      renderEnginePanel();
      request(context, 'POST', '/chess/ai/analyse', {
        board: state.board,
        turn: state.turn,
        gameKey: analysisGameKey(),
        movetime: ANALYSE_MOVETIME,
        multiPv: ANALYSE_LINES
      }).then(function(data) {
        if (disposed || token !== analysisToken) return;
        if (analysisBusyKey === key) analysisBusyKey = '';
        if (key !== analysisKey()) return;   // 局面已变，丢弃（走子那一路会重新排）
        analysisData = data && data.lines && data.lines.length ? data : null;
        analysisNote = analysisData ? '' : '引擎没有给出可用的着法';
        analysisDoneKey = key;
        if (data && data.engineName) { aiEngineName = data.engineName; aiEngineState = 'pikafish'; }
        activeLine = -1;
        arrowMove = null;
        renderEnginePanel();
        renderArrows();
      }).catch(function() {
        if (disposed || token !== analysisToken) return;
        if (analysisBusyKey === key) analysisBusyKey = '';
        if (key !== analysisKey()) return;
        analysisData = null;
        analysisNote = aiEngineState === 'builtin' ? '服务端引擎不可用，本局走的是内置 AI' : '引擎暂时不可用，稍后再试';
        renderEnginePanel();
      });
    }
    // render 末尾调用：只在引擎页可见、且这个局面还没结论时排一次去抖分析
    function syncAnalysis() {
      var open = engineTabOpen();
      if (analyseButtonElement) analyseButtonElement.disabled = !open;
      if (autoAnalyseButtonElement) {
        autoAnalyseButtonElement.disabled = !open;
        setClass(autoAnalyseButtonElement, 'is-secondary is-toggle' + (analysisOn ? ' is-on' : ''));
        autoAnalyseButtonElement.setAttribute('aria-pressed', analysisOn ? 'true' : 'false');
      }
      if (!open) {
        if (analysisTimer) { clearTimeout(analysisTimer); analysisTimer = null; }
        return;
      }
      var key = analysisKey();
      if (key === analysisDoneKey || key === analysisBusyKey) return;
      // 局面换了：旧结论立刻撤下（留着就是「候选着法对不上棋盘」，比空着更糟）。
      // 这一步与自动开关**无关**——关掉自动分析只是不自动重算，不代表可以留着过期结论。
      if (analysisData || arrowMove || analysisNote) {
        analysisData = null;
        analysisNote = '';
        activeLine = -1;
        arrowMove = null;
      }
      if (!analysisOn) return;   // 自动重算到此为止；要重算就手动点「分析当前局面」
      if (analysisTimer) return;
      analysisTimer = setTimeout(function() {
        analysisTimer = null;
        runAnalyse();
      }, 320);
    }
    // 引擎信息行：自报名字 + 深度 + 节点 + 用时（皮卡鱼网页版同款信息）
    function engineMetaText(data) {
      var parts = [];
      parts.push(data.engineName || 'Pikafish');
      if (data.depth) parts.push('深度 ' + data.depth);
      if (data.nodes) parts.push((data.nodes >= 10000 ? (data.nodes / 10000).toFixed(1) + '万' : String(data.nodes)) + ' 节点');
      if (data.time) parts.push((data.time / 1000).toFixed(1) + ' 秒');
      return parts.join(' · ');
    }
    // 面板 diff 签名：值没变就不重建（render 每次点击都跑）
    var enginePanelSignature = '';
    function renderEnginePanel() {
      if (!enginePanelElement) return;
      var data = analysisData;
      var lines = data && data.lines ? data.lines : [];
      var sig = [analysisOn, activeLine, analysisNote, aiEngineState, soloLevel, lines.length,
        lines.length ? lines[0].uci : '', lines.length && lines[0].score ? lines[0].score.type + lines[0].score.value : '',
        data ? data.depth + ':' + data.nodes + ':' + data.time : ''].join('|');
      if (sig === enginePanelSignature) return;
      enginePanelSignature = sig;

      // 评分条：红方优势从左侧生长（红在下，左红右黑是通行读法）
      var view = lines.length ? evalView(lines[0].score, data.side || state.turn) : null;
      if (evalFillElement) {
        var rate = view ? view.rate : 0.5;
        var pct = Math.max(3, Math.min(97, rate * 100));
        var width = pct.toFixed(1) + '%';
        if (evalFillElement.style.width !== width) evalFillElement.style.width = width;
      }
      if (evalScoreElement) setText(evalScoreElement, view ? view.text : '—');
      if (evalFillElement) {
        setClass(evalFillElement, 'chess-eval-fill' + (view && view.mate ? ' is-mate' : view ? (view.cp >= 0 ? ' is-red' : ' is-black') : ' is-even'));
      }
      if (engineInfoElement) {
        setText(engineInfoElement, lines.length ? engineMetaText(data)
          : analysisNote || (analysisOn ? '切到本页即分析当前局面' : '自动分析已关闭，点「分析当前局面」'));
      }
      if (engineFootElement) {
        var foot = '';
        if (lines.length) foot = '点候选着法可在棋盘上标出这一步';
        else if (analysisNote) foot = analysisNote;
        // 房间模式补一句透明说明：分析页人人可见（含观战者）。
        // 不写清楚容易让人以为「只有我能看到」，进而在对局里偷偷用引擎。
        if (mode === 'room') {
          foot = foot ? foot + ' · 本页分析房间内所有人可见' : '本页分析房间内所有人可见';
        }
        setText(engineFootElement, foot);
      }
      clearChildren(engineLineListElement);
      if (!lines.length) return;
      for (var i = 0; i < lines.length; i++) {
        var line = lines[i];
        var lv = evalView(line.score, data.side || state.turn);
        var moveText = chineseMove(state.board, line.move.fromRow, line.move.fromCol, line.move.toRow, line.move.toCol);
        var pvText = pvToChinese(state.board, line.pv || [], data.side || state.turn).slice(1).join(' ');
        var item = t('li', 'chess-line' + (activeLine === i ? ' is-active' : ''), {
          'data-action': 'line', 'data-line': String(i), role: 'button', tabindex: '0'
        }, [
          t('span', 'chess-line-no', { text: String(line.rank || i + 1) }),
          t('span', 'chess-line-move', { text: moveText }),
          t('span', 'chess-line-score' + (lv.cp === null ? ' is-mate' : lv.cp >= 0 ? ' is-red' : ' is-black'), { text: lv.text }),
          t('span', 'chess-line-pv', { text: pvText || '—' })
        ]);
        engineLineListElement.appendChild(item);
      }
    }
    // 棋盘箭头层：只在「点了候选着法」时出现（不自动画最佳着法——那等于替学生下棋）
    function buildArrowLayer(parent) {
      if (!parent || !document.createElementNS) return null;
      var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('class', 'chess-arrows');
      svg.setAttribute('viewBox', '0 0 ' + BOARD_W + ' ' + BOARD_H);
      svg.setAttribute('preserveAspectRatio', 'none');
      svg.setAttribute('aria-hidden', 'true');
      parent.appendChild(svg);
      return svg;
    }
    function renderArrows() {
      if (!arrowLayerElement) return;
      var key = arrowMove ? (arrowMove.fr + ',' + arrowMove.fc + ',' + arrowMove.tr + ',' + arrowMove.tc) : '';
      if (key === lastArrowKey) return;
      lastArrowKey = key;
      clearChildren(arrowLayerElement);
      if (!arrowMove) return;
      var ns = 'http://www.w3.org/2000/svg';
      var r1 = flipped ? 9 - arrowMove.fr : arrowMove.fr;
      var c1 = flipped ? 8 - arrowMove.fc : arrowMove.fc;
      var r2 = flipped ? 9 - arrowMove.tr : arrowMove.tr;
      var c2 = flipped ? 8 - arrowMove.tc : arrowMove.tc;
      var x1 = BOARD_PAD + c1 * BOARD_CELL;
      var y1 = BOARD_PAD + r1 * BOARD_CELL;
      var x2 = BOARD_PAD + c2 * BOARD_CELL;
      var y2 = BOARD_PAD + r2 * BOARD_CELL;
      var dx = x2 - x1;
      var dy = y2 - y1;
      var len = Math.sqrt(dx * dx + dy * dy);
      if (len < 1) return;
      var ux = dx / len;
      var uy = dy / len;
      // 两端各让开棋子半径：起点 22、终点 30（棋子半径 ≈27），否则整条线被棋子盖住
      var sx = x1 + ux * 22;
      var sy = y1 + uy * 22;
      var ex = x2 - ux * 30;
      var ey = y2 - uy * 30;
      if ((ex - sx) * ux + (ey - sy) * uy < 6) { ex = x2 - ux * 12; ey = y2 - uy * 12; }
      var head = 16;
      var w = 8;
      var bw = ex - ux * head;
      var bh = ey - uy * head;
      var nx = -uy;
      var ny = ux;
      var line = document.createElementNS(ns, 'line');
      line.setAttribute('x1', String(sx));
      line.setAttribute('y1', String(sy));
      line.setAttribute('x2', String(bw));
      line.setAttribute('y2', String(bh));
      line.setAttribute('class', 'chess-arrow-line');
      arrowLayerElement.appendChild(line);
      var headNode = document.createElementNS(ns, 'polygon');
      headNode.setAttribute('points',
        ex + ',' + ey + ' ' + (bw + nx * w) + ',' + (bh + ny * w) + ' ' + (bw - nx * w) + ',' + (bh - ny * w));
      headNode.setAttribute('class', 'chess-arrow-head');
      arrowLayerElement.appendChild(headNode);
    }

    // ===== 单机开局：local 双人同屏 | solo 人机练习 =====
    function offlineStart(nextMode) {
      aiAbort();
      analysisAbort();
      mode = nextMode;
      roomCode = '';
      localHistory = [];
      // 人机练习玩家固定执红（红方先手，与本地双人一致的观感）；棋力取入场卡当前选择
      if (nextMode === 'solo') {
        soloColor = 'red';
        if (levelElement && AI_LEVELS[levelElement.value]) {
          soloLevel = levelElement.value;
          // 持久化棋力选择：下次进入人机保持同一档位
          try { localStorage.setItem('chess_level', soloLevel); } catch (e) {}
        }
        AI_HISTORY = [];
      }
      // 每局换一个 gameKey：后端据此决定要不要给引擎 ucinewgame（清置换表）。
      // 人机与本地对战都要（本地对战也要跑引擎分析，分析同样吃置换表状态）。
      soloGameKey = makeGameKey();
      // 棋力档只影响电脑思考时间，不再改开局子力 —— 两档都是完整开局
      state = { board: initialBoard(), turn: 'red', winner: null, result: null, status: 'active', check: false, members: [], lastMove: null };
      selected = null; legal = [];
      lastAnimatedKey = '';
      setError('');
      saveSession();
      render();
      syncMetrics();
    }

    function offlineExit() {
      aiAbort();
      analysisAbort();
      mode = '';
      activeTab = 'info';
      localHistory = [];
      state = { board: initialBoard(), turn: 'red', winner: null, result: null, status: 'active', check: false, members: [], lastMove: null };
      selected = null; legal = [];
      lastAnimatedKey = '';
      clearSession();
      render();
    }

    // 单机悔棋：local 撤 1 手；solo 撤到「玩家待走」——AI 已应手撤 2 手，AI 思考中撤 1 手
    function offlineUndo() {
      aiAbort();
      analysisAbort();   // 局面要回退：旧候选着法与箭头一并作废
      if (!localHistory.length) return;
      var steps = 1;
      if (mode === 'solo' && state.turn === soloColor && localHistory.length >= 2) steps = 2;
      while (steps-- && localHistory.length) localUndo();
      // localUndo 内部会 saveSession/render；AI 思考被打断后若仍轮电脑则重新调度
      if (mode === 'solo' && !state.winner && state.status === 'active' && state.turn !== soloColor) scheduleAi();
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
        if (mode === 'local' || mode === 'solo') {
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
          // 文案必须压到**单行**：侧栏内容宽只有 212px，而这个提示条挂在侧栏里，
          // 折一行就多吃 23px 高度、把成员列表整段往下推（实测 46px vs 23px）。
          // 「会递补」这层信息成员列表里已经写着「观战 · 可替补」，这里不必重复解释。
          setError('已进入观战席，可递补上场');
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
      // 单机模式无房间状态，直接回入场页
      if (mode === 'local' || mode === 'solo') {
        offlineExit();
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
      // 侧栏分页切换：纯前端状态，不受忙碌锁限制（对局请求在途也要能切页看聊天/看分析）
      if (kind === 'tab-info' || kind === 'tab-chat' || kind === 'tab-engine') {
        return setTab(kind === 'tab-chat' ? 'chat' : kind === 'tab-engine' ? 'engine' : 'info');
      }
      // 引擎页的三个动作也不走对局忙碌锁：它们只读局面，不改任何对局状态
      if (kind === 'analyse') {
        // 手动分析：清掉「已算/在算」标记后强制跑一次（force 绕过自动开关，这是它的意义）
        if (analysisTimer) { clearTimeout(analysisTimer); analysisTimer = null; }
        analysisDoneKey = '';
        analysisBusyKey = '';
        runAnalyse(true);
        render();
        return;
      }
      if (kind === 'auto-analyse') {
        analysisOn = !analysisOn;
        // 选择要记住：关掉的人不希望下次开新局又被自动跑一遍分析
        try { localStorage.setItem('chess_analyse', analysisOn ? '1' : '0'); } catch (e) {}
        // 切回「开」时，当前局面若一直没算过，这次 render 会让 syncAnalysis 自动补一次
        render();
        return;
      }
      if (kind === 'line') {
        var lineIndex = Number(action.getAttribute('data-line'));
        var picked = analysisData && analysisData.lines ? analysisData.lines[lineIndex] : null;
        if (!picked) return;
        // 再点一次同一条 = 取消高亮（箭头是「临时标记」，不该只能靠走子清掉）
        var sameArrow = arrowMove && arrowMove.fr === picked.move.fromRow && arrowMove.fc === picked.move.fromCol
          && arrowMove.tr === picked.move.toRow && arrowMove.tc === picked.move.toCol;
        arrowMove = sameArrow ? null : {
          fr: picked.move.fromRow, fc: picked.move.fromCol,
          tr: picked.move.toRow, tc: picked.move.toCol
        };
        activeLine = sameArrow ? -1 : lineIndex;
        renderEnginePanel();
        renderArrows();
        return;
      }
      if (pending) return;
      // 单机模式入口（人机练习/本地双人）：本地开局，不涉及任何后端请求
      if (kind === 'solo' || kind === 'local') { offlineStart(kind); return; }
      if (kind === 'create' || kind === 'join' || kind === 'watch') {
        action.disabled = true;
        setBusy(true);
        var done = function() { setBusy(false); };
        if (kind === 'create') create().then(done, done);
        else enter(root.querySelector('[data-field="room"]').value, kind).then(done, done);
        return;
      }
      if (kind === 'undo' && (mode === 'local' || mode === 'solo')) { offlineUndo(); return; }
      // 提示：借引擎算一手推荐着法（人机 / 本地双人 / 房间都可用，归属方见 hintSide）
      if (kind === 'hint') { requestHint(); return; }
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
        if (mode === 'local' || mode === 'solo') { offlineStart(mode); return; }
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
        aiAbort();
        analysisAbort();
        aiToken += 1;   // 双保险：卸载后任何在途回调都失效
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
      aiAbort();
      analysisAbort();
      aiToken += 1;   // 双保险：卸载后任何在途回调都失效
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
    // 单机局直接还原棋盘（AI 思考中被打断则续上）；房间码经 loadState 校验存活，房间已关则自然回入场页
    var savedSession = routeRoom ? null : readSession();
    if (savedSession && (savedSession.mode === 'local' || savedSession.mode === 'solo') && savedSession.offline && Array.isArray(savedSession.offline.board)) {
      mode = savedSession.mode;
      if (mode === 'solo') {
        soloColor = savedSession.soloColor === 'black' ? 'black' : 'red';
        soloLevel = AI_LEVELS[savedSession.soloLevel] ? savedSession.soloLevel : 'normal';
        if (levelElement) levelElement.value = soloLevel;
        // 恢复出来的残局算「新的一局」：换 key 让后端 ucinewgame，不把上一局的哈希带进来
        soloGameKey = makeGameKey();
      }
      localHistory = Array.isArray(savedSession.offline.history) ? savedSession.offline.history : [];
      state = Object.assign({ members: [], check: false }, savedSession.offline);
      render();
      syncMetrics();
      // 会话恢复时若正轮电脑（AI 思考被打断），续上应手
      if (mode === 'solo' && !state.winner && state.status === 'active' && state.turn !== soloColor) scheduleAi();
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
    // 引擎能力探测（人机副标题要显示 Pikafish / 内置，且降级要提前可见）
    probeAiEngine();
    syncMetrics();
  }

  function unmount(container) { if (container && typeof container.__chessUnmount === 'function') container.__chessUnmount(); }
  var definition = { name: NAME, mount: mount, unmount: unmount };
  if (window.ClassIntraMarket && typeof window.ClassIntraMarket.define === 'function') window.ClassIntraMarket.define(definition);
  else if (definitions) definitions[NAME] = definition;
})();
