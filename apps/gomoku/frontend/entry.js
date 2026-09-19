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

    var roomInput = t('input', null, { 'data-field': 'room', maxlength: '6', autocomplete: 'off', placeholder: '输入 6 位房间码' });
    var roomLabel = t('label', null, { text: '房间码' });
    roomLabel.appendChild(roomInput);

    var entryCard = t('div', 'gomoku-entry-card', null, [
      t('h2', null, { text: '进入棋局' }),
      t('p', null, { text: '创建房间或把房间码分享给同学，支持 15、19、21 路棋盘。' }),
      t('div', 'gomoku-entry-row', null, [
        sizeLabel,
        t('button', null, { type: 'button', 'data-action': 'create', text: '创建房间' })
      ]),
      t('div', 'gomoku-entry-row', null, [
        roomLabel,
        t('button', null, { type: 'button', 'data-action': 'join', text: '加入对局' }),
        t('button', 'is-secondary', { type: 'button', 'data-action': 'watch', text: '观战' })
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
      t('h2', null, { text: '房间成员' }),
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
    var disposed = false;
    var pending = false;
    // 最新一手动画去重键：重渲染（成员变动/断线重连等）不重播落子动画
    var lastAnimatedKey = '';
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
      var message = '来和我一起下五子棋，房间码：' + roomCode;
      if (target === 'chat') {
        if (context.eventBus && typeof context.eventBus.emit === 'function') context.eventBus.emit('chat:compose', { content: message });
        else if (context.router && typeof context.router.push === 'function') context.router.push({ path: '/chat', query: { compose: message } });
        setError('已打开聊天，房间码可直接发送');
        return;
      }
      if (context.router && typeof context.router.push === 'function') context.router.push({ path: '/community', query: { compose: message } });
      setError('已打开社区，房间码可直接发布');
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
      render();
    }
    // 连接状态红绿灯：文本 + 状态类（online/connecting/offline）
    function setConnection(text, kind) {
      connectionElement.textContent = text;
      connectionElement.className = 'gomoku-conn' + (kind ? ' is-' + kind : '');
    }
    function renderMembers() {
      clearChildren(membersElement);
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

    function render() {
      root.style.setProperty('--gomoku-size', state.size);
      roomElement.textContent = roomCode ? '房间码 ' + roomCode : '未进入房间';
      var member = currentMember();
      identityElement.textContent = member ? '我的身份：' + (member.role === 'spectator' ? '观战者' : member.role === 'owner' ? '房主 · ' + (member.color === 'black' ? '黑棋' : '白棋') : member.color === 'black' ? '黑棋' : '白棋') : '';
      // 状态条：获胜金色强调；进行中前置当前手色点
      statusElement.className = 'gomoku-status' + (state.winner ? ' is-winner' : (state.status === 'active' ? ' is-turn is-turn-' + state.turn : ''));
      statusElement.textContent = state.winner ? (state.winner === 'black' ? '黑棋获胜' : '白棋获胜') : state.status !== 'active' ? '等待下一局' : '轮到' + (state.turn === 'black' ? '黑棋' : '白棋');
      if (!roomCode) setConnection('未进入房间', '');
      // 棋盘级状态类：幽灵预览需要 is-my-turn + turn-*；胜负弱化需要 has-winner
      var myTurn = !!(member && member.color && !state.winner && state.status === 'active' && member.color === state.turn);
      boardElement.className = 'gomoku-board' + (state.winner ? ' has-winner' : '') + (myTurn ? ' is-my-turn' : '') + (state.turn === 'white' ? ' turn-white' : ' turn-black');
      entryElement.hidden = !!roomCode;
      // 未进房时隐藏房间条（只剩「未进入房间」的重复文案，且在入场卡片下方孤行）；
      // 同时给根节点打 entering 标记，横屏 CSS 据此让入场内容垂直居中。
      var roombarElement = root.querySelector('.gomoku-roombar');
      if (roombarElement) roombarElement.hidden = !roomCode;
      root.classList.toggle('gomoku-entering', !roomCode);
      // 未进入房间时隐藏棋盘区：此前空棋盘 + 禁用格子也一直渲染，横屏下与入场卡片挤在一起
      var layoutElement = root.querySelector('.gomoku-layout');
      if (layoutElement) layoutElement.hidden = !roomCode;
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
          cell.disabled = !roomCode || !!color || !!state.winner || state.status !== 'active' || pending || !member || !member.color;
          stonesElement.appendChild(cell);
        });
      });
      lastAnimatedKey = state.lastMove ? state.lastMove.row + '_' + state.lastMove.col : '';

      renderMembers();
      var owner = member && member.role === 'owner';
      var finished = !!state.winner || state.status !== 'active';
      finishedElement.textContent = finished ? (state.winner ? '本局结束，房主可以继续或离开。' : '准备下一局。') : '';
      continueButton.hidden = !finished || !owner;
      colorButton.hidden = !finished || !member || !member.color;
    }
    function loadState() {
      if (!roomCode) { state.board = emptyBoard(15); render(); return Promise.resolve(); }
      return request(context, 'GET', '/gomoku/rooms/' + encodeURIComponent(roomCode)).then(applyState).catch(function(error) { setError(error.message || '房间加载失败'); });
    }
    function enter(code, mode) {
      var normalized = String(code || '').trim().toUpperCase();
      // 校验失败也返回 resolved Promise：onAction 统一在 then 里解除忙碌锁
      if (!/^[A-Z0-9]{6}$/.test(normalized)) { setError('请输入 6 位房间码'); return Promise.resolve(); }
      var path = '/gomoku/rooms/' + encodeURIComponent(normalized) + '/' + mode;
      return request(context, 'POST', path, {}).then(function(data) {
        roomCode = normalized;
        applyState(data);
        setError('');
      }).catch(function(error) { setError(error.message || '进入房间失败'); });
    }
    function create() {
      return request(context, 'POST', '/gomoku/rooms', { size: Number(root.querySelector('[data-field="size"]').value) }).then(function(data) {
        roomCode = data.roomCode;
        applyState(data);
        setError('');
      }).catch(function(error) { setError(error.message || '创建房间失败'); });
    }
    function actionRequest(path, message, body) {
      return request(context, 'POST', '/gomoku/rooms/' + encodeURIComponent(roomCode) + path, body || {}).then(function(data) {
        applyState(data);
        return data;
      }).catch(function(error) { setError(error.message || message); return null; });
    }
    function leaveRoom() {
      actionRequest('/leave', '离开房间失败').then(function() { roomCode = ''; render(); });
    }
    function leave() {
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
      if (!cell || !roomCode || pending) return;
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
      // 兼容旧 WebSocket 客户端仍使用 gomoku_continue；新客户端走 HTTP reset。
      // 两个操作都要求已进入房间 —— 此前 continue 缺少该检查，未进房时会发出空房间请求。
      if (kind === 'continue' && roomCode) {
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
        removeBoardClick();
        removeRootClick();
        subscriptions.forEach(function(remove) { if (typeof remove === 'function') remove(); });
        subscriptions = [];
        clearChildren(container);
      });
    }
    container.__gomokuUnmount = function() { disposed = true; if (roomCode) send({ type: 'gomoku_unsubscribe', room_code: roomCode }); removeBoardClick(); removeRootClick(); subscriptions.forEach(function(remove) { if (typeof remove === 'function') remove(); }); subscriptions = []; clearChildren(container); delete container.__gomokuUnmount; };
    loadState();
  }

  function unmount(container) { if (container && typeof container.__gomokuUnmount === 'function') container.__gomokuUnmount(); }
  var definition = { name: NAME, mount: mount, unmount: unmount };
  if (window.ClassIntraMarket && typeof window.ClassIntraMarket.define === 'function') window.ClassIntraMarket.define(definition);
  else if (definitions) definitions[NAME] = definition;
})();
