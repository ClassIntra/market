(function() {
  var NAME = 'gomoku';
  var definitions = window.ClassIntraMarket && window.ClassIntraMarket.apps;

  // 清空子节点。
  // 不用 Element.replaceChildren()：该 API 需 Chrome 86+，校园平板基线为 Chrome 80，
  // 调用会抛 TypeError 导致挂载整体失败（第十三轮修复）。
  function clearChildren(el) {
    if (!el) return;
    while (el.firstChild) el.removeChild(el.firstChild);
  }

  // 取 HTTP 客户端。
  // 规范入口是 context.data.api（context.api 是 v1 兼容别名，未来会移除）。
  // 只取其中一个、不叠加别名：兼容层的 getter 返回同一对象，叠加只会掩盖问题。
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

  // 传统星位（天元 + 四星/九星），0-based 交叉点索引。
  // 落点渲染为百分比（(idx+0.5)/size），与网格线的半格偏移对齐。
  function starPoints(size) {
    if (size === 15) return [[3, 3], [3, 11], [11, 3], [11, 11], [7, 7]];
    if (size === 19) return [[3, 3], [3, 9], [3, 15], [9, 3], [9, 9], [9, 15], [15, 3], [15, 9], [15, 15]];
    if (size === 21) return [[3, 3], [3, 17], [17, 3], [17, 17], [10, 10]];
    if (size >= 13) return [[3, 3], [3, size - 4], [size - 4, 3], [size - 4, size - 4]];
    return [];
  }

  function buildShell() {
    var status = t('p', 'gomoku-status', { 'aria-live': 'polite' });
    var actions = t('div', 'gomoku-actions', null, [
      t('button', 'is-secondary', { type: 'button', 'data-action': 'undo', text: '悔棋' }),
      t('button', 'is-secondary', { type: 'button', 'data-action': 'copy', text: '复制房间码' }),
      t('button', 'is-secondary', { type: 'button', 'data-action': 'share-chat', text: '发到聊天' }),
      t('button', 'is-secondary', { type: 'button', 'data-action': 'share-community', text: '发到社区' }),
      t('button', 'is-secondary', { type: 'button', 'data-action': 'leave', text: '离开房间' })
    ]);
    var head = t('div', 'gomoku-header', null, [
      t('div', null, null, [
        t('p', 'gomoku-kicker', { text: 'CLASSINTRA GAME' }),
        t('h1', null, { text: '五子棋' }),
        status
      ]),
      actions
    ]);

    var sizeSelect = t('select', null, { 'data-field': 'size', 'data-size': '15' }, [
      t('option', null, { value: '15', text: '15 × 15' }),
      t('option', null, { value: '19', text: '19 × 19' }),
      t('option', null, { value: '21', text: '21 × 21' })
    ]);
    var sizeLabel = t('label', null, { text: '棋盘规格' });
    sizeLabel.appendChild(sizeSelect);

    var roomInput = t('input', null, { 'data-field': 'room', maxlength: '6', autocomplete: 'off', placeholder: '4 位房间码', inputmode: 'numeric' });
    var roomLabel = t('label', null, { text: '房间码' });
    roomLabel.appendChild(roomInput);

    var entryCard = t('div', 'gomoku-entry-card', null, [
      t('h2', null, { text: '进入棋局' }),
      t('p', null, { text: '创建房间邀请同学对战，或用单机模式离线对弈。' }),
      t('div', 'gomoku-entry-row', null, [
        sizeLabel,
        t('button', null, { type: 'button', 'data-action': 'create', text: '创建房间' })
      ]),
      t('div', 'gomoku-entry-row', null, [
        roomLabel,
        t('button', null, { type: 'button', 'data-action': 'join', text: '加入对局' }),
        t('button', 'is-secondary', { type: 'button', 'data-action': 'watch', text: '观战' })
      ]),
      t('div', 'gomoku-entry-row', null, [
        t('span', 'gomoku-entry-hint', { text: '单机模式' }),
        t('button', 'is-secondary', { type: 'button', 'data-action': 'local', text: '本地对战' }),
        t('button', 'is-secondary', { type: 'button', 'data-action': 'solo', text: '人机练习' })
      ])
    ]);
    var entry = t('div', 'gomoku-entry', null, [entryCard]);

    var roombar = t('div', 'gomoku-roombar', null, [
      t('strong', null, { 'data-role': 'room', text: '未进入房间' }),
      t('span', null, { 'data-role': 'identity' }),
      t('span', null, { 'data-role': 'connection', text: '未连接' })
    ]);

    // ⚠️ 错误/提示条必须挂在 shell 层（房间内也可见）。
    // 此前它嵌在进入卡片区里，进入房间后随卡片一起 hidden ——
    // 换色 409、非房主 403 等所有失败反馈都不可见，用户视角就是「按钮没反应」。
    var error = t('p', 'gomoku-error', { 'data-role': 'error', 'aria-live': 'polite' });

    var board = t('div', 'gomoku-board', { role: 'grid', 'aria-label': '五子棋棋盘' });
    var info = t('aside', 'gomoku-info', null, [
      t('h2', null, { 'data-role': 'info-title', text: '房间成员' }),
      t('ul', null, { 'data-role': 'members' }),
      t('div', 'gomoku-finished', null, [
        t('p', null, { 'data-role': 'finished' }),
        t('button', null, { type: 'button', 'data-action': 'continue', text: '继续下一局' }),
        t('button', 'is-secondary', { type: 'button', 'data-action': 'color', text: '换色' })
      ])
    ]);
    var layout = t('div', 'gomoku-layout', null, [board, info]);

    return t('section', 'gomoku-app', null, [
      t('div', 'gomoku-shell', null, [head, entry, roombar, error, layout])
    ]);
  }

  function mount(container, context) {
    if (!container || container.__gomokuUnmount) return;
    var websocket = context.websocket || (window.ClassIntra && window.ClassIntra.websocket);
    var realtime = context.realtime;
    if (realtime && typeof realtime.connect === 'function') realtime.connect();
    var route = context.route || {};
    var routeRoom = (route.params && (route.params.roomCode || route.params.room_code)) || (route.query && (route.query.roomCode || route.query.room_code));
    var roomCode = routeRoom ? String(routeRoom).toUpperCase() : '';
    var state = { size: 15, board: [], turn: 'black', winner: null, status: 'active', members: [], lastMove: null };
    // 对局模式：'' 未进入 | 'room' 房间对弈 | 'solo' 人机练习（纯本地，不走后端）
    var mode = roomCode ? 'room' : '';
    var disposed = false;
    var pending = false;
    // 最新一手动画去重键：重渲染（成员变动/断线重连等）不重播落子动画
    var lastAnimatedKey = '';
    // 人机练习的 AI 落子定时器：卸载/离开时必须清理，防止已卸载组件操作 DOM
    var soloTimer = null;
    // 单机模式落子历史（row/col 顺序栈）：悔棋依据；offlineStart 重置、offlineMove 入栈
    var offlineHistory = [];
    // 会话持久化：切去聊天/社区再返回时恢复房间与单机对局（sessionStorage，关页即清）
    var SESSION_KEY = 'gomoku_session';
    function saveSession() {
      try {
        if (mode === 'room' && roomCode) {
          sessionStorage.setItem(SESSION_KEY, JSON.stringify({ mode: 'room', roomCode: roomCode }));
        } else if ((mode === 'solo' || mode === 'local') && state.board.length && (offlineHistory.length || state.winner)) {
          sessionStorage.setItem(SESSION_KEY, JSON.stringify({
            mode: mode,
            offline: { size: state.size, board: state.board, turn: state.turn, winner: state.winner, status: state.status, lastMove: state.lastMove, history: offlineHistory }
          }));
        } else if (mode === 'solo' || mode === 'local') {
          // 空单机局（悔棋清空、刚开局未落子）不留旧快照，避免返回时恢复出过期棋盘
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

    var statusElement = root.querySelector('.gomoku-status');
    var boardElement = root.querySelector('.gomoku-board');
    var entryElement = root.querySelector('.gomoku-entry');
    var errorElement = root.querySelector('.gomoku-error');
    var roomElement = root.querySelector('[data-role="room"]');
    var identityElement = root.querySelector('[data-role="identity"]');
    var connectionElement = root.querySelector('[data-role="connection"]');
    var membersElement = root.querySelector('[data-role="members"]');
    var infoTitleElement = root.querySelector('[data-role="info-title"]');
    var finishedElement = root.querySelector('[data-role="finished"]');
    var continueButton = root.querySelector('[data-action="continue"]');
    var colorButton = root.querySelector('[data-action="color"]');

    function currentUserId() {
      return String(context.user && (context.user.user_id || context.user.id) || '');
    }
    function currentMember() {
      return state.members.filter(function(member) { return String(member.user_id) === currentUserId(); })[0] || null;
    }
    function emptyBoard(size) {
      return Array.from({ length: size }, function() { return Array(size).fill(null); });
    }
    function setError(message) { errorElement.textContent = message || ''; }
    // 旧版 WebSocket 协议保留给兼容客户端；当前默认路径使用 HTTP 房间 API。
    function send(message) { if (websocket && typeof websocket.send === 'function') websocket.send(message); }
    function transportReady() { return !!(websocket && typeof websocket.send === 'function' && typeof websocket.on === 'function'); }
    function shareRoom(target) {
      if (!roomCode) { setError('请先进入房间'); return; }
      if (!context.router || typeof context.router.push !== 'function') {
        setError('当前环境不支持跳转，房间码：' + roomCode);
        return;
      }
      if (target === 'chat') {
        // 卡片消息：走聊天页现成的转发通道（?forward=&forwardType=）——
        // 用户选会话后直接发出邀请卡片，对方点卡片直达对局，不再预填文本手动发送
        var cardData = {
          app: 'gomoku',
          roomCode: roomCode,
          size: state.size,
          senderName: (context.user && (context.user.net_name || context.user.user_id)) || ''
        };
        context.router.push('/chat?forward=' + encodeURIComponent(JSON.stringify(cardData)) + '&forwardType=gomoku_invite');
        setError('已打开聊天，选择会话即可发送邀请卡片');
      } else {
        // 社区：预填带 [gomoku:房间码] 标记的文本，发布后帖子内自动渲染为可点击邀请卡片
        var text = '来和我一起下五子棋！\n\n[gomoku:' + roomCode + ']';
        context.router.push({ path: '/community', query: { prefill: encodeURIComponent(text) } });
        setError('已打开社区发帖，发布后显示邀请卡片');
      }
    }
    function onSocket(type, handler) {
      if (!websocket || typeof websocket.on !== 'function') return;
      websocket.on(type, handler);
      subscriptions.push(function() { if (typeof websocket.off === 'function') websocket.off(type, handler); });
    }
    function applyState(next) {
      if (!next) return;
      state = Object.assign(state, next);
      state.size = Number(state.size) || 15;
      state.board = Array.isArray(state.board) ? state.board : emptyBoard(state.size);
      if (mode === 'room') saveSession();
      render();
    }
    // 连接状态红绿灯：文本 + 状态类（online/connecting/offline）
    function setConnection(text, kind) {
      connectionElement.textContent = text;
      connectionElement.className = 'gomoku-conn' + (kind ? ' is-' + kind : '');
    }
    function renderMembers() {
      clearChildren(membersElement);
      // 单机模式：固定两行显示对局双方，is-turn 跟随当前手色
      if (mode === 'solo' || mode === 'local') {
        var sides = mode === 'solo'
          ? [['black', '我', 'is-me', '执黑'], ['white', '电脑', '', '执白']]
          : [['black', '黑方', '', '先手'], ['white', '白方', '', '后手']];
        sides.forEach(function(entry) {
          var isTurn = !state.winner && state.status === 'active' && state.turn === entry[0];
          membersElement.appendChild(t('li', 'gomoku-member' + (entry[2] ? ' ' + entry[2] : '') + (isTurn ? ' is-turn' : ''), null, [
            t('span', 'gomoku-member-dot is-' + entry[0], { 'aria-hidden': 'true' }),
            t('span', 'gomoku-member-name', { text: entry[1] }),
            t('span', 'gomoku-member-role', { text: entry[3] })
          ]));
        });
        return;
      }
      state.members.forEach(function(member) {
        var isMe = String(member.user_id) === currentUserId();
        var dotClass = 'gomoku-member-dot ' + (member.role === 'spectator' ? 'is-spectator' : (member.color ? 'is-' + member.color : 'is-none'));
        var roleText = member.role === 'owner' ? '房主' : member.role === 'spectator' ? '观战' : member.color === 'black' ? '黑棋' : '白棋';
        var roleClass = 'gomoku-member-role' + (member.role === 'owner' ? ' is-owner' : '');
        // 轮到谁的成员行：色点加红圈脉冲（观战与已结束状态除外）
        var isTurn = !state.winner && state.status === 'active' && member.role !== 'spectator' && member.color === state.turn;
        membersElement.appendChild(t('li', 'gomoku-member' + (isMe ? ' is-me' : '') + (isTurn ? ' is-turn' : ''), null, [
          t('span', dotClass, { 'aria-hidden': 'true' }),
          t('span', 'gomoku-member-name', { text: isMe ? '我' : String(member.net_name || member.user_id) }),
          t('span', roleClass, { text: roleText })
        ]));
      });
    }
    // 找出获胜的五连（用于棋盘高亮）。无获胜方则返回空数组。
    function findWinLine() {
      if (!state.winner) return [];
      var size = state.size;
      var dirs = [[0, 1], [1, 0], [1, 1], [1, -1]];
      for (var r = 0; r < size; r++) {
        for (var c = 0; c < size; c++) {
          if (state.board[r][c] !== state.winner) continue;
          for (var d = 0; d < dirs.length; d++) {
            var dr = dirs[d][0], dc = dirs[d][1];
            var cells = [];
            var rr = r, cc = c;
            while (rr >= 0 && cc >= 0 && rr < size && cc < size && state.board[rr][cc] === state.winner) {
              cells.push([rr, cc]);
              rr += dr; cc += dc;
            }
            if (cells.length >= 5) return cells.slice(0, 5);
          }
        }
      }
      return [];
    }

    // 提取后端业务错误消息：axios 默认消息是生硬的「Request failed with status code 409」，
    // 真正的可读提示在 error.response.data.message 里
    function errMsg(error, fallback) {
      var data = error && error.response && error.response.data;
      return (data && data.message) || (error && error.message) || fallback;
    }
    // ===== 人机练习（solo）：纯前端本地对弈，不占用房间系统 =====
    // 启发式评分：沿四方向数「落此点后形成的连子数 + 开放端数」，
    // 五连 > 活四 > 冲四/活三 > …… AI 执白，进攻分略高于同级的防守分。
    function soloLineScore(count, open) {
      if (count >= 5) return 100000;
      if (count === 4) return open >= 2 ? 50000 : (open === 1 ? 6000 : 0);
      if (count === 3) return open >= 2 ? 3000 : (open === 1 ? 300 : 0);
      if (count === 2) return open >= 2 ? 250 : (open === 1 ? 30 : 0);
      return open >= 2 ? 20 : (open === 1 ? 4 : 0);
    }
    function soloEvalPoint(board, size, row, col, color) {
      var dirs = [[0, 1], [1, 0], [1, 1], [1, -1]], total = 0;
      for (var d = 0; d < 4; d++) {
        var count = 1, open = 0;
        for (var sign = -1; sign <= 1; sign += 2) {
          var rr = row + dirs[d][0] * sign, cc = col + dirs[d][1] * sign;
          while (rr >= 0 && cc >= 0 && rr < size && cc < size && board[rr][cc] === color) { count++; rr += dirs[d][0] * sign; cc += dirs[d][1] * sign; }
          if (rr >= 0 && cc >= 0 && rr < size && cc < size && !board[rr][cc]) open++;
        }
        total += soloLineScore(count, open);
      }
      return total;
    }
    function soloAiPick() {
      var size = state.size, board = state.board;
      var hasStone = false, r, c;
      for (r = 0; r < size && !hasStone; r++) for (c = 0; c < size; c++) { if (board[r][c]) { hasStone = true; break; } }
      if (!hasStone) return { row: Math.floor(size / 2), col: Math.floor(size / 2) };
      var best = [], bestScore = -1;
      for (r = 0; r < size; r++) {
        for (c = 0; c < size; c++) {
          if (board[r][c]) continue;
          // 只考察已有棋子 2 格邻域内的空位，19/21 路也不卡顿
          var near = false;
          for (var dr = -2; dr <= 2 && !near; dr++) {
            for (var dc = -2; dc <= 2; dc++) {
              var rr = r + dr, cc = c + dc;
              if (rr >= 0 && cc >= 0 && rr < size && cc < size && board[rr][cc]) { near = true; break; }
            }
          }
          if (!near) continue;
          // 进攻（AI 自己连白）略优于防守（堵黑），形成「能赢先赢、能堵必堵」
          var score = soloEvalPoint(board, size, r, c, 'white') * 1.1 + soloEvalPoint(board, size, r, c, 'black');
          if (score > bestScore) { bestScore = score; best = [{ row: r, col: c }]; }
          else if (score === bestScore) best.push({ row: r, col: c });
        }
      }
      // 同分候选随机挑一个，避免每局走法完全雷同
      if (!best.length) return null;
      return best[Math.floor(Math.random() * best.length)];
    }
    // 本地胜负判定：从落点出发四方向数连子（solo 专用，房间对局由后端判定）
    function soloHasWin(row, col, color) {
      var size = state.size, dirs = [[0, 1], [1, 0], [1, 1], [1, -1]];
      for (var d = 0; d < 4; d++) {
        var count = 1;
        for (var sign = -1; sign <= 1; sign += 2) {
          var rr = row + dirs[d][0] * sign, cc = col + dirs[d][1] * sign;
          while (rr >= 0 && cc >= 0 && rr < size && cc < size && state.board[rr][cc] === color) { count++; rr += dirs[d][0] * sign; cc += dirs[d][1] * sign; }
        }
        if (count >= 5) return true;
      }
      return false;
    }
    // ===== 单机模式：'solo' 人机练习（AI 执白）| 'local' 本地双人（同屏轮流，无 AI）=====
    // 两者共用本地对弈引擎：纯前端，不占房间系统、不发任何请求。
    function offlineStart(nextMode) {
      if (soloTimer) { clearTimeout(soloTimer); soloTimer = null; }
      mode = nextMode;
      roomCode = '';
      offlineHistory = [];
      state = {
        size: Number(root.querySelector('[data-field="size"]').value) || 15,
        board: emptyBoard(15), turn: 'black', winner: null, status: 'active', members: [], lastMove: null
      };
      state.board = emptyBoard(state.size);
      lastAnimatedKey = '';
      setError('');
      render();
    }
    function offlineExit() {
      if (soloTimer) { clearTimeout(soloTimer); soloTimer = null; }
      mode = '';
      offlineHistory = [];
      state = { size: state.size, board: emptyBoard(state.size), turn: 'black', winner: null, status: 'active', members: [], lastMove: null };
      lastAnimatedKey = '';
      clearSession();
      render();
    }
    // 单机悔棋：local 撤 1 手；solo 撤到「玩家执黑待落」——AI 已应手撤 2 手，AI 思考中撤 1 手
    function offlineUndo() {
      if (!offlineHistory.length) return;
      if (soloTimer) { clearTimeout(soloTimer); soloTimer = null; }
      var steps = 1;
      if (mode === 'solo' && state.turn === 'black' && offlineHistory.length >= 2) steps = 2;
      while (steps-- && offlineHistory.length) {
        var mv = offlineHistory.pop();
        state.board[mv.row][mv.col] = null;
      }
      state.winner = null;
      state.status = 'active';
      state.turn = 'black';
      var last = offlineHistory[offlineHistory.length - 1];
      state.lastMove = last ? { row: last.row, col: last.col } : null;
      lastAnimatedKey = '';
      saveSession();
      render();
    }
    // AI 应手（人机练习专用）：420ms 延迟模拟思考；恢复对局时也用它续上被打断的回合
    function scheduleAi() {
      soloTimer = setTimeout(function() {
        soloTimer = null;
        if (disposed || mode !== 'solo') return;
        var mv = soloAiPick();
        if (!mv) { state.turn = 'black'; render(); return; }
        state.board[mv.row][mv.col] = 'white';
        state.lastMove = mv;
        offlineHistory.push({ row: mv.row, col: mv.col });
        if (soloHasWin(mv.row, mv.col, 'white')) { state.winner = 'white'; state.status = 'finished'; }
        else state.turn = 'black';
        saveSession();
        render();
      }, 420);
    }
    function offlineMove(row, col) {
      if (state.winner || state.status !== 'active' || state.board[row][col]) return;
      var color = state.turn;
      // 人机练习里玩家只能执黑；本地双人黑白双方轮流落子
      if (mode === 'solo' && color !== 'black') return;
      state.board[row][col] = color;
      state.lastMove = { row: row, col: col };
      offlineHistory.push({ row: row, col: col });
      if (soloHasWin(row, col, color)) { state.winner = color; state.status = 'finished'; saveSession(); render(); return; }
      state.turn = color === 'black' ? 'white' : 'black';
      render();
      // 人机练习：AI 应手。本地双人无 AI，落完即轮转。
      if (mode === 'solo') { scheduleAi(); return; }
      saveSession();
    }

    function render() {
      root.style.setProperty('--gomoku-size', state.size);
      var inGame = mode !== '';
      var isOffline = mode === 'solo' || mode === 'local';
      var member = currentMember();
      // 单机模式：分享/复制类按钮无意义，隐藏；「离开」按钮作为退出单机对局入口
      var actionButtons = root.querySelectorAll('.gomoku-actions [data-action]');
      for (var a = 0; a < actionButtons.length; a++) {
        var kind = actionButtons[a].dataset.action;
        actionButtons[a].hidden = isOffline && (kind === 'copy' || kind === 'share-chat' || kind === 'share-community');
      }
      roomElement.textContent = mode === 'solo' ? '人机练习' : mode === 'local' ? '本地对战' : (roomCode ? '房间码 ' + roomCode : '未进入房间');
      identityElement.textContent = mode === 'solo' ? '我执黑 · 电脑执白' : mode === 'local' ? '双人同屏 · 黑方先手' : (member ? '我的身份：' + (member.role === 'spectator' ? '观战者' : member.role === 'owner' ? '房主 · ' + (member.color === 'black' ? '黑棋' : '白棋') : member.color === 'black' ? '黑棋' : '白棋') : '');
      // 房间内对手未加入：后端放行自由摆棋，状态条给出提示而非轮次
      var soloRoom = mode === 'room' && state.status === 'active' && !state.winner && state.members.filter(function(m) { return m.color; }).length < 2;
      statusElement.className = 'gomoku-status' + (state.winner ? ' is-winner' : ((state.status === 'active' && !soloRoom) ? ' is-turn is-turn-' + state.turn : ''));
      statusElement.textContent = state.winner ? (state.winner === 'black' ? '黑棋获胜' : '白棋获胜') : soloRoom ? '自由练习中，对手加入后恢复轮流' : state.status !== 'active' ? '等待下一局' : '轮到' + (state.turn === 'black' ? '黑棋' : '白棋');
      if (isOffline) setConnection('本地对弈', 'online');
      else if (!roomCode) setConnection('未进入房间', '');
      // 单机模式直接本地判手；房间模式按成员身份
      var myTurn = isOffline
        ? (state.status === 'active' && !state.winner)
        : !!(member && member.color && !state.winner && state.status === 'active' && member.color === state.turn);
      boardElement.className = 'gomoku-board' + (state.winner ? ' has-winner' : '') + (myTurn ? ' is-my-turn' : '') + (state.turn === 'white' ? ' turn-white' : ' turn-black');
      entryElement.hidden = inGame;
      // 未进房时隐藏房间条（只剩「未进入房间」的重复文案，且在入场卡片下方孤行）；
      // 同时给根节点打 entering 标记，横屏 CSS 据此让入场内容垂直居中。
      var roombarElement = root.querySelector('.gomoku-roombar');
      if (roombarElement) roombarElement.hidden = !inGame;
      root.classList.toggle('gomoku-entering', !inGame);
      // 未进入房间时隐藏棋盘区：此前空棋盘 + 禁用格子也一直渲染，横屏下与入场卡片挤在一起
      var layoutElement = root.querySelector('.gomoku-layout');
      if (layoutElement) layoutElement.hidden = !inGame;
      clearChildren(boardElement);

      // 网格线层（纯装饰，pointer-events: none）
      var gridElement = document.createElement('div');
      gridElement.className = 'gomoku-grid';
      gridElement.setAttribute('aria-hidden', 'true');
      // 星位：天元 + 四星/九星。定位按「交叉点 = (idx+0.5)/size」，
      // 与网格线的半格偏移对齐（棋子落在线的交叉点上，而非格子中心）。
      var size = state.size;
      var stars = starPoints(size);
      for (var s = 0; s < stars.length; s++) {
        var star = document.createElement('span');
        star.className = 'gomoku-star';
        star.style.left = ((stars[s][1] + 0.5) / size * 100) + '%';
        star.style.top = ((stars[s][0] + 0.5) / size * 100) + '%';
        gridElement.appendChild(star);
      }
      boardElement.appendChild(gridElement);

      // 棋子层：承载可点击格子。独立成层是为了让按钮脱离网格线背景，
      // 同时保留 CSS Grid 定位（棋子需逐个可点，无法用背景图替代）。
      var stonesElement = document.createElement('div');
      stonesElement.className = 'gomoku-stones';
      boardElement.appendChild(stonesElement);

      var winLine = findWinLine();

      (state.board.length ? state.board : emptyBoard(state.size)).forEach(function(row, rowIndex) {
        row.forEach(function(color, colIndex) {
          var cell = document.createElement('button');
          cell.type = 'button';
          var isWin = false;
          for (var w = 0; w < winLine.length; w++) {
            if (winLine[w][0] === rowIndex && winLine[w][1] === colIndex) { isWin = true; break; }
          }
          var isLast = color && state.lastMove && state.lastMove.row === rowIndex && state.lastMove.col === colIndex;
          cell.className = 'gomoku-cell' + (color ? ' is-' + color : '') + (isWin ? ' is-win' : '') + (isLast ? ' is-last' : '');
          // 只有最新一手播放入场动画：去重键等于当前 lastMove 时（重渲染）跳过
          if (isLast && lastAnimatedKey !== rowIndex + '_' + colIndex) cell.classList.add('is-new');
          if (color) {
            var stone = document.createElement('span');
            stone.className = 'gomoku-stone';
            stone.setAttribute('aria-hidden', 'true');
            cell.appendChild(stone);
          }
          cell.dataset.row = rowIndex;
          cell.dataset.col = colIndex;
          cell.setAttribute('aria-label', (rowIndex + 1) + '行' + (colIndex + 1) + '列' + (color ? (color === 'black' ? '黑棋' : '白棋') : ''));
          cell.disabled = isOffline
            ? (!!color || !!state.winner || state.status !== 'active' || (mode === 'solo' && state.turn !== 'black'))
            : (!roomCode || !!color || !!state.winner || state.status !== 'active' || pending || !member || !member.color);
          stonesElement.appendChild(cell);
        });
      });
      lastAnimatedKey = state.lastMove ? state.lastMove.row + '_' + state.lastMove.col : '';

      renderMembers();
      // 侧栏标题随模式切换；「离开房间」按钮在单机模式下语义变为「退出练习」
      infoTitleElement.textContent = isOffline ? '对局信息' : '房间成员';
      var leaveButton = root.querySelector('[data-action="leave"]');
      if (leaveButton) leaveButton.textContent = isOffline ? '退出练习' : '离开房间';
      var owner = member && member.role === 'owner';
      var finished = !!state.winner || state.status !== 'active';
      // 悔棋按钮可用性：单机看历史栈；房间看「最后一手是否本人所下」（后端二次校验）
      var undoButton = root.querySelector('[data-action="undo"]');
      if (undoButton) {
        undoButton.disabled = isOffline
          ? !offlineHistory.length
          : (!roomCode || !state.lastMove || !!state.winner || state.status !== 'active' || pending || String(state.lastMove.userId) !== currentUserId());
      }
      if (isOffline) {
        // 单机模式：文案本地化；继续按钮人人可见（重开一局），换色无意义
        finishedElement.textContent = state.winner
          ? (mode === 'solo'
            ? (state.winner === 'black' ? '恭喜，你赢了！' : '电脑获胜，再战一局？')
            : (state.winner === 'black' ? '黑棋获胜！' : '白棋获胜！'))
          : '';
        continueButton.hidden = !finished;
        colorButton.hidden = true;
      } else {
        finishedElement.textContent = finished ? (state.winner ? '本局结束，房主可以继续或离开。' : '准备下一局。') : '';
        continueButton.hidden = !finished || !owner;
        colorButton.hidden = !finished || !member || !member.color;
      }
    }
    function loadState(isRecovery) {
      if (!roomCode) { state.board = emptyBoard(15); render(); return Promise.resolve(); }
      return request(context, 'GET', '/gomoku/rooms/' + encodeURIComponent(roomCode)).then(applyState).catch(function(error) {
        setError(errMsg(error, '房间加载失败'));
        // 仅会话恢复路径：房间已失效就清会话回入场页；断线重连的刷新不清（保留房间码等重连）
        if (isRecovery) { roomCode = ''; mode = ''; clearSession(); render(); }
      });
    }
    function enter(code, enterKind) {
      var normalized = String(code || '').trim().toUpperCase();
      // 校验失败也返回 resolved Promise：onAction 统一在 then 里解除忙碌锁
      if (!/^[A-Z0-9]{4,6}$/.test(normalized)) { setError('请输入 4-6 位房间码'); return Promise.resolve(); }
      var path = '/gomoku/rooms/' + encodeURIComponent(normalized) + '/' + enterKind;
      return request(context, 'POST', path, {}).then(function(data) {
        roomCode = normalized;
        mode = 'room';
        applyState(data);
        setError('');
        // 满员自动观战：join 时黑白棋位已满，后端把新成员分配为 spectator ——
        // 明确告知降级结果，避免用户误以为进错了房间（点邀请卡片进入的常见场景）
        var me = currentMember();
        if (enterKind === 'join' && me && me.role === 'spectator') {
          setError('房间玩家已满，已为你转为观战');
        }
      }).catch(function(error) { setError(errMsg(error, '进入房间失败')); });
    }
    function create() {
      return request(context, 'POST', '/gomoku/rooms', { size: Number(root.querySelector('[data-field="size"]').value) }).then(function(data) {
        roomCode = data.roomCode;
        mode = 'room';
        applyState(data);
        setError('');
      }).catch(function(error) { setError(errMsg(error, '创建房间失败')); });
    }
    function actionRequest(path, message, body) {
      return request(context, 'POST', '/gomoku/rooms/' + encodeURIComponent(roomCode) + path, body || {}).then(function(data) {
        applyState(data);
        return data;
      }).catch(function(error) { setError(errMsg(error, message)); return null; });
    }
    function leaveRoom() {
      actionRequest('/leave', '离开房间失败').then(function() { roomCode = ''; mode = ''; clearSession(); render(); });
    }
    function leave() {
      // 单机模式无房间状态，直接回入场页
      if (mode === 'solo' || mode === 'local') return offlineExit();
      if (!roomCode) return navigateHome();
      if (context.modal && typeof context.modal.confirm === 'function') {
        context.modal.confirm({ title: '离开房间', message: '离开后需要重新输入房间码才能回来，确定离开吗？', confirmText: '离开', cancelText: '取消' }).then(function(confirmed) {
          if (confirmed) leaveRoom();
        });
        return;
      }
      leaveRoom();
    }
    function navigateHome() { if (context.router && typeof context.router.push === 'function') context.router.push('/'); }
    // 统一的忙碌锁：落子与房间操作共用，防止并发请求导致状态错乱。
    // actionRequest 的 catch 返回 null 而非 reject，因此 then 必达 ——
    // 不再需要此前的 1200ms setTimeout 兜底（它会在慢请求未返回时提前解锁）。
    function setBusy(flag) {
      pending = flag;
      var buttons = root.querySelectorAll('[data-action]');
      for (var i = 0; i < buttons.length; i++) buttons[i].disabled = flag;
    }
    function onBoardClick(event) {
      var cell = event.target.closest('.gomoku-cell');
      if (!cell || pending) return;
      // 单机模式（人机练习/本地双人）：纯本地落子，不发请求、不占忙碌锁
      if (mode === 'solo' || mode === 'local') { offlineMove(Number(cell.dataset.row), Number(cell.dataset.col)); return; }
      if (!roomCode) return;
      setBusy(true);
      render();
      actionRequest('/move', '落子失败', { row: Number(cell.dataset.row), col: Number(cell.dataset.col) }).then(function() {
        setBusy(false);
        render();
      });
    }
    function onAction(event) {
      var action = event.target.closest('[data-action]');
      if (!action) return;
      if (pending) return;
      var kind = action.dataset.action;
      // 单机模式入口（人机练习/本地双人）：本地开局，不涉及任何后端请求
      if (kind === 'solo' || kind === 'local') { offlineStart(kind); return; }
      // 房间操作统一走忙碌锁：按钮禁用给出即时反馈，
      // 失败信息经 shell 层错误条展示（进入房间后也可见）。
      if (kind === 'create' || kind === 'join' || kind === 'watch') {
        action.disabled = true;
        setBusy(true);
        var done = function() { setBusy(false); };
        if (kind === 'create') create().then(done, done);
        else enter(root.querySelector('[data-field="room"]').value, kind).then(done, done);
        return;
      }
      // 单机模式悔棋：纯本地回退（无需忙碌锁）
      if (kind === 'undo' && (mode === 'solo' || mode === 'local')) { offlineUndo(); return; }
      // 房间悔棋：撤自己刚下的最后一手（后端校验轮次并广播）
      if (kind === 'undo' && roomCode && !pending) {
        action.disabled = true;
        setBusy(true);
        actionRequest('/undo', '悔棋失败：等对方落子后才能悔棋').then(function() { setBusy(false); });
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
      if (kind === 'leave') return leave();
      if (kind === 'continue') {
        if (mode === 'solo' || mode === 'local') { offlineStart(mode); return; }
        // 兼容旧 WebSocket 客户端仍使用 gomoku_continue；新客户端走 HTTP reset。
        // 两个操作都要求已进入房间 —— 此前 continue 缺少该检查，未进房时会发出空房间请求。
        if (!roomCode) return;
        action.disabled = true;
        setBusy(true);
        actionRequest('/reset', '继续下一局失败，只有房主可以重开').then(function() { setBusy(false); });
        return;
      }
      if (kind === 'color' && roomCode) {
        action.disabled = true;
        setBusy(true);
        actionRequest('/color', '换色失败：需要房间内有另一位玩家').then(function() { setBusy(false); });
        return;
      }
    }
     if (realtime && typeof realtime.subscribe === 'function') {
       subscriptions.push(realtime.subscribe('gomoku.room.changed', function(message) {
         var data = message && message.payload ? message.payload : message;
         if (data && data.roomCode === roomCode && data.state) applyState(data.state);
       }));
     }
     if (!realtime) {
       onSocket('gomoku_room_state', function(message) { if (message.room_code === roomCode) applyState(message.state); });
       onSocket('gomoku_room_changed', function(message) { if (message.room_code === roomCode) { pending = false; applyState(message.state); } });
       onSocket('gomoku_game_continued', function(message) { if (message.room_code === roomCode) { pending = false; applyState(message.state); } });
       onSocket('gomoku_move_rejected', function(message) { if (message.room_code === roomCode) { pending = false; setError(message.reason || '落子被拒绝'); if (message.state) applyState(message.state); else render(); } });
     }
       // realtime.on 返回的解绑函数必须登记，否则断线重连会重复绑定、卸载后仍收事件。
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
    boardElement.addEventListener('click', onBoardClick);
    root.addEventListener('click', onAction);
    var removeBoardClick = function() { boardElement.removeEventListener('click', onBoardClick); };
    var removeRootClick = function() { root.removeEventListener('click', onAction); };
    // 契约：资源回收必须在 context.app.onDestroy 中登记（market-registry 卸载时会先调它）。
    // 逆序执行 —— 先解绑事件与订阅，最后清 DOM。
    if (context.app && typeof context.app.onDestroy === 'function') {
      context.app.onDestroy(function() {
        disposed = true;
        if (soloTimer) { clearTimeout(soloTimer); soloTimer = null; }
        removeBoardClick();
        removeRootClick();
        subscriptions.forEach(function(remove) { if (typeof remove === 'function') remove(); });
        subscriptions = [];
        clearChildren(container);
      });
    }
    container.__gomokuUnmount = function() { disposed = true; if (soloTimer) { clearTimeout(soloTimer); soloTimer = null; } if (roomCode) send({ type: 'gomoku_unsubscribe', room_code: roomCode }); removeBoardClick(); removeRootClick(); subscriptions.forEach(function(remove) { if (typeof remove === 'function') remove(); }); subscriptions = []; clearChildren(container); delete container.__gomokuUnmount; };
    // 会话恢复：路由未带房间码时，恢复上次对局——
    // 单机局直接还原棋盘（AI 思考中被打断则续上）；房间码经 loadState 校验存活，房间已关则自然回入场页
    var savedSession = routeRoom ? null : readSession();
    if (savedSession && (savedSession.mode === 'solo' || savedSession.mode === 'local') && savedSession.offline && Array.isArray(savedSession.offline.board)) {
      mode = savedSession.mode;
      offlineHistory = Array.isArray(savedSession.offline.history) ? savedSession.offline.history : [];
      state = Object.assign({ members: [] }, savedSession.offline);
      state.size = Number(state.size) || 15;
      state.board = savedSession.offline.board;
      render();
      if (mode === 'solo' && !state.winner && state.status === 'active' && state.turn === 'white') scheduleAi();
    } else if (savedSession && savedSession.mode === 'room' && /^[A-Z0-9]{4,6}$/.test(String(savedSession.roomCode || ''))) {
      roomCode = String(savedSession.roomCode);
      mode = 'room';
      loadState(true);
    } else if (roomCode) {
      // 路由携带房间码（点聊天卡片/社区卡片直达）：自动加入对局——
      // 满员时后端自动分配观战身份；已是成员则幂等返回现有身份
      enter(roomCode, 'join');
    } else {
      loadState();
    }
  }

  function unmount(container) { if (container && typeof container.__gomokuUnmount === 'function') container.__gomokuUnmount(); }
  var definition = { name: NAME, mount: mount, unmount: unmount };
  if (window.ClassIntraMarket && typeof window.ClassIntraMarket.define === 'function') window.ClassIntraMarket.define(definition);
  else if (definitions) definitions[NAME] = definition;
})();
