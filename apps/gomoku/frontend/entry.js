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
    // 模式名与身份描述：挪进标题栏做副标题（room/identity 由渲染逻辑经 data-role 原地更新），
    // 连接红绿灯进标题栏右区；原 roombar 整行删除，纵向空间让给棋盘
    var room = t('span', null, { 'data-role': 'room', text: '未进入房间' });
    var identity = t('span', null, { 'data-role': 'identity' });
    var connection = t('span', null, { 'data-role': 'connection', text: '未连接' });
    var actions = t('div', 'gomoku-actions', null, [
      t('button', 'is-secondary', { type: 'button', 'data-action': 'undo', text: '悔棋' }),
      t('button', 'is-secondary', { type: 'button', 'data-action': 'copy', text: '复制房间码' }),
      t('button', 'is-secondary', { type: 'button', 'data-action': 'share-chat', text: '发到聊天' }),
      t('button', 'is-secondary', { type: 'button', 'data-action': 'share-community', text: '发到社区' }),
      t('button', 'is-secondary', { type: 'button', 'data-action': 'leave', text: '离开房间' })
    ]);
    // 头部即标题栏：manifest layout.navbar=custom 隐藏系统导航栏后，
    // 本头部承担标题栏职责。布局与其他应用一致：标题靠左紧跟返回按钮，
    // 对局信息段（轮次/模式/身份）随其后可截断，右区灯+按钮推到最右
    var head = t('div', 'gomoku-header', null, [
      t('div', 'gomoku-header-left', null, [
        t('button', 'gomoku-back', { type: 'button', 'data-action': 'home', text: '返回' })
      ]),
      t('h1', 'gomoku-title', { text: '五子棋' }),
      // 对局信息动态三段（轮次在前，截断只截静态尾部）：status/room/identity 经 data-role 原地更新
      t('span', 'gomoku-subtitle', null, [status, room, identity]),
      t('div', 'gomoku-header-right', null, [connection, actions])
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

    // 标题栏是 .gomoku-app 的直接子级（shell 之外）：
    // shell 有 max-width 居中限宽，header 留在里面永远贴不到视口边缘，
    // 吸顶也会被限宽块「架空」；移出后全宽贴顶贴边。
    // roombar 已并入标题栏（模式/身份做副标题、连接灯进右区），shell 内不再有独立行
    return t('section', 'gomoku-app', null, [
      head,
      t('div', 'gomoku-shell', null, [entry, error, layout])
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
    // 统计棋盘上的棋子数（用于推送防回退判据）
    function stoneCount(b) {
      if (!Array.isArray(b)) return -1;
      var n = 0;
      for (var i = 0; i < b.length; i++) {
        var row = b[i];
        if (!Array.isArray(row)) continue;
        for (var j = 0; j < row.length; j++) if (row[j]) n++;
      }
      return n;
    }
    function applyState(next, opts) {
      if (!next) return;
      // 推送路径防回退：HTTP 长轮询回退模式会把服务端 5 分钟 TTL 队列里的积压事件整批补发，
      // 落子成功后可能收到「不含这颗子」的旧房间广播 —— 无条件应用会让棋子闪现后消失。
      // 判据：同 gameId 且新状态棋子数少于当前 → 视为旧事件重放，直接丢弃。
      // （悔棋/重开的合法减子走 actionRequest 响应路径，不经此守卫；对手悔棋的广播会被
      //   丢弃，但下一手落子广播会带完整棋盘自动对齐。）
      if (opts && opts.fromPush && mode === 'room' && state.gameId && next.gameId === state.gameId) {
        var incoming = stoneCount(next.board);
        if (incoming >= 0 && incoming < stoneCount(state.board)) return;
      }
      state = Object.assign(state, next);
      state.size = Number(state.size) || 15;
      state.board = Array.isArray(state.board) ? state.board : emptyBoard(state.size);
      if (mode === 'room') saveSession();
      render();
    }
    // 连接状态红绿灯：文本 + 状态类（online/connecting/offline）。
    // 标题栏内灯体纯化为圆点（CSS font-size:0），原文转存 title 供悬停查看
    function setConnection(text, kind) {
      connectionElement.textContent = text;
      connectionElement.title = text;
      connectionElement.className = 'gomoku-conn' + (kind ? ' is-' + kind : '');
    }
    // 棋盘状态签名：size/board/lastMove/winner/status 任一变化才重建棋子层。
    // 落子链路会连续两次 render（POST 响应 applyState 一次、then 解锁 busy 一次），
    // 全量重建会销毁刚启动的入场动画节点 —— 视觉上棋子「闪一下」。
    // 签名未变时只刷新格子可点状态（忙碌锁解锁），棋子层不动、动画继续播放。
    var lastBoardSignature = '';
    function boardDisabled(color, isOffline, member) {
      return isOffline
        ? (!!color || !!state.winner || state.status !== 'active' || (mode === 'solo' && state.turn !== 'black'))
        : (!roomCode || !!color || !!state.winner || state.status !== 'active' || pending || !member || !member.color);
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
    // 大师级 AI（棋型识别 + VCF/VCT 算杀 + 迭代加深 negamax + Zobrist 置换表）：
    //   1. 棋型模式识别——以落点为中心取 9 格窗口做串匹配，识别连五/活四/冲四/
    //      活三/眠三/活二（含跳子型）
    //   2. 战术层强制手：成五必下 → 堵对方成五 → 活四必下 → 堵对方活四点 →
    //      拆对方双威胁 → 我方 VCF/VCT 连杀速胜 → 封堵对方连杀链（P1-P7）。
    //      VCF（纯冲四链）与 VCT（活三+冲四混合链，应答集=堵点∪反四）用
    //      「对手被迫应」的性质把视野延伸到 depth 搜索永远看不穿的连杀
    //   3. negamax 迭代加深（2→4→6 层）+ α-β 剪枝 + Zobrist 置换表层间复用 +
    //      叶子静态搜索（冲四/活四强制延伸防水平线效应），预算内取最深完整层
    //      ——低端机超时自动降级浅层结果，不卡死
    //   4. 候选启发排序收缩 + 双威胁杀点强制并入候选前列
    // AI 执白，候选攻防合成防守权重 0.9（进攻略优先）。
    var GOMOKU_SCORE = {
      FIVE: 10000000,      // 连五
      LIVE_FOUR: 1000000,  // 活四
      RUSH_FOUR: 100000,   // 冲四（含跳冲）
      LIVE_THREE: 80000,   // 活三（含跳活三）
      SLEEP_THREE: 3000,   // 眠三
      LIVE_TWO: 1500,      // 活二
      SLEEP_TWO: 100       // 眠二/散子
    };
    // ---- 大师级参数：时间预算优先于固定深度，低端机超时自动用浅一层结果 ----
    var GOMOKU_VCF_DEPTH = 8;     // VCF 我方冲四手数预算（最长 4 组冲四连杀）
    var GOMOKU_VCF_NODES = 8000;  // VCF 节点上限（超限视为无杀，防极端局面卡死）
    var GOMOKU_VCT_NODES = 3000;  // VCT 节点上限（活三应答集大，独立限额）
    var GOMOKU_VCT_MAXDEF = 8;    // VCT 应答集上限（超过=威胁不强制，判无杀——保守不误报）
    var GOMOKU_VCT_DEPTH = 5;     // VCT 攻防手数预算（3 攻 2 防，覆盖活三→活四→五）
    var GOMOKU_MAX_DEPTH = 6;     // negamax 迭代加深最大深度
    var GOMOKU_BUDGET = 350;      // 搜索时间预算 ms（420ms 拟人延迟之上，玩家总感知 <1s）
    var gmkZobrist = null;        // [r][c][0=白/1=黑] 32 位随机数表
    var gmkHash = 0;              // 当前局面 Zobrist 哈希（落子/撤子 XOR 增量维护）
    var gmkTT = null;             // 置换表：hash*2+行棋色 → {depth, score, flag}
    var gmkNodes = 0;             // 搜索节点计数（超时抽查用）
    var gmkDeadline = 0;          // 搜索截止时间戳
    var gmkTimeout = false;       // 超时标志（逐层上抛，分数不入表）
    var gmkVcfCount = 0;          // VCF 节点计数（预算保险）
    var gmkVctCount = 0;          // VCT 节点计数（独立限额，防活三分支爆炸）
    var gmkVcfDeadline = 0;       // VCF 截止时间戳（每次调用前设置）
    // 假设 color 落 (row,col)，沿 (dr,dc) 取两侧各 4 格构建长度 9 的窗口串：
    // '1'=己方 '0'=空 '2'=对方或边界，中心恒 '1'（假设落子）。
    // 性质：任何长度 ≥5 的子串必然覆盖中心位，匹配到的棋型一定包含本次落子。
    function gmkLineWindow(board, size, row, col, dr, dc, color) {
      var s = '';
      for (var i = -4; i <= 4; i++) {
        if (i === 0) { s += '1'; continue; }
        var r = row + dr * i, c = col + dc * i;
        if (r < 0 || c < 0 || r >= size || c >= size) { s += '2'; continue; }
        var v = board[r][c];
        s += !v ? '0' : (v === color ? '1' : '2');
      }
      return s;
    }
    // 单方向棋型识别：按分值从高到低匹配，首个命中即返回（天然无重复计分）
    function gmkShapeScore(win) {
      if (win.indexOf('11111') >= 0) return GOMOKU_SCORE.FIVE;
      if (win.indexOf('011110') >= 0) return GOMOKU_SCORE.LIVE_FOUR;
      // 冲四：连冲（恰好一端被堵）或跳冲
      if (win.indexOf('211110') >= 0 || win.indexOf('011112') >= 0 ||
          win.indexOf('10111') >= 0 || win.indexOf('11011') >= 0 || win.indexOf('11101') >= 0) return GOMOKU_SCORE.RUSH_FOUR;
      // 活三：可成活四（连活三需一侧两连空，跳活三同理）
      if (win.indexOf('011100') >= 0 || win.indexOf('001110') >= 0 ||
          win.indexOf('010110') >= 0 || win.indexOf('011010') >= 0) return GOMOKU_SCORE.LIVE_THREE;
      // 眠三：可成冲四但不可成活四
      if (win.indexOf('211100') >= 0 || win.indexOf('001112') >= 0 ||
          win.indexOf('211010') >= 0 || win.indexOf('010112') >= 0 ||
          win.indexOf('210110') >= 0 || win.indexOf('011012') >= 0 ||
          win.indexOf('10011') >= 0 || win.indexOf('11001') >= 0 || win.indexOf('10101') >= 0) return GOMOKU_SCORE.SLEEP_THREE;
      // 活二：可成活三
      if (win.indexOf('001100') >= 0 || win.indexOf('010100') >= 0 ||
          win.indexOf('001010') >= 0 || win.indexOf('010010') >= 0) return GOMOKU_SCORE.LIVE_TWO;
      return GOMOKU_SCORE.SLEEP_TWO;
    }
    // 单方向棋型等级（用于威胁计数）：5=连五 4=活四 3=冲四 2=活三 1=眠三 0=其他
    function gmkDirLevel(win) {
      if (win.indexOf('11111') >= 0) return 5;
      if (win.indexOf('011110') >= 0) return 4;
      if (win.indexOf('211110') >= 0 || win.indexOf('011112') >= 0 ||
          win.indexOf('10111') >= 0 || win.indexOf('11011') >= 0 || win.indexOf('11101') >= 0) return 3;
      if (win.indexOf('011100') >= 0 || win.indexOf('001110') >= 0 ||
          win.indexOf('010110') >= 0 || win.indexOf('011010') >= 0) return 2;
      if (win.indexOf('211100') >= 0 || win.indexOf('001112') >= 0 ||
          win.indexOf('211010') >= 0 || win.indexOf('010112') >= 0 ||
          win.indexOf('210110') >= 0 || win.indexOf('011012') >= 0 ||
          win.indexOf('10011') >= 0 || win.indexOf('11001') >= 0 || win.indexOf('10101') >= 0) return 1;
      return 0;
    }
    // 假设 color 落 (r,c) 后统计四方向威胁数。gmkLineWindow 本身就是「假设落子」
    // 语义（中心恒 '1'），因此这里零副作用、无需真的改盘。
    function gmkThreats(r, c, color) {
      var dirs = [[0, 1], [1, 0], [1, 1], [1, -1]];
      var t = { five: 0, live4: 0, rush4: 0, live3: 0 };
      for (var d = 0; d < 4; d++) {
        var lv = gmkDirLevel(gmkLineWindow(state.board, state.size, r, c, dirs[d][0], dirs[d][1], color));
        if (lv === 5) t.five++;
        else if (lv === 4) t.live4++;
        else if (lv === 3) t.rush4++;
        else if (lv === 2) t.live3++;
      }
      return t;
    }
    // 多个强制点里挑「落子后我方增益最大」的（用完整棋型分而非廉价启发，防漏选）
    function gmkBestOf(list) {
      var best = null, bestScore = -Infinity;
      for (var i = 0; i < list.length; i++) {
        var s = gmkEvalPoint(state.board, state.size, list[i].row, list[i].col, 'white');
        if (s > bestScore) { bestScore = s; best = list[i]; }
      }
      return best || list[0];
    }
    // 单点完整棋型分：四方向求和（用于叶子评估与根层排序，每手每点仅算一次量级）
    function gmkEvalPoint(board, size, row, col, color) {
      var dirs = [[0, 1], [1, 0], [1, 1], [1, -1]], total = 0;
      for (var d = 0; d < 4; d++) {
        total += gmkShapeScore(gmkLineWindow(board, size, row, col, dirs[d][0], dirs[d][1], color));
      }
      return total;
    }
    // 廉价启发分：连子数 + 开放端（无字符串构建），仅供搜索内部候选排序提速
    function soloLineScore(count, open) {
      if (count >= 5) return 100000;
      if (count === 4) return open >= 2 ? 50000 : (open === 1 ? 6000 : 0);
      if (count === 3) return open >= 2 ? 3000 : (open === 1 ? 300 : 0);
      if (count === 2) return open >= 2 ? 250 : (open === 1 ? 30 : 0);
      return open >= 2 ? 20 : (open === 1 ? 4 : 0);
    }
    function gmkQuickPoint(board, size, row, col, color) {
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
    // 候选生成：已有棋子 2 格邻域内的空位，按攻防启发分降序
    function gmkCandidates(color) {
      var size = state.size, board = state.board, out = [], r, c;
      var opp = color === 'white' ? 'black' : 'white';
      for (r = 0; r < size; r++) {
        for (c = 0; c < size; c++) {
          if (board[r][c]) continue;
          var near = false;
          for (var dr = -2; dr <= 2 && !near; dr++) {
            for (var dc = -2; dc <= 2; dc++) {
              var rr = r + dr, cc = c + dc;
              if (rr >= 0 && cc >= 0 && rr < size && cc < size && board[rr][cc]) { near = true; break; }
            }
          }
          if (!near) continue;
          var s = gmkQuickPoint(board, size, r, c, color) + gmkQuickPoint(board, size, r, c, opp) * 0.9;
          out.push({ row: r, col: c, score: s });
        }
      }
      out.sort(function(a, b) { return b.score - a.score; });
      return out;
    }
    // 全局面评估：双方全部已落子棋型总分（对称零和，保证 negamax 负号传递不失真）。
    // 叶子层用它而非单点分，搜索才能看到「存量威胁」——自己的活三/活四还在、
    // 对方的冲四没堵；活四存量高分同时驱动 AI 主动构筑攻势。
    // 双威胁结构分：任一方同时持有 ≥2 组活三、或活三+冲四组合（四三架势），
    // 即为「下一手可造双活三/四三杀」的必败级结构，额外重罚/奖励——
    // 让搜索在成型前一手就开始规避/追逐，弥补固定深度的视野盲区。
    function gmkBoardEval(color) {
      var size = state.size, board = state.board, mine = 0, theirs = 0;
      var myL3 = 0, myR4 = 0, opL3 = 0, opR4 = 0;
      var opp = color === 'white' ? 'black' : 'white';
      for (var r = 0; r < size; r++) {
        for (var c = 0; c < size; c++) {
          var v = board[r][c];
          if (!v) continue;
          var dirs = [[0, 1], [1, 0], [1, 1], [1, -1]];
          for (var d = 0; d < 4; d++) {
            var lv = gmkDirLevel(gmkLineWindow(board, size, r, c, dirs[d][0], dirs[d][1], v));
            if (v === color) {
              if (lv === 2) { mine += GOMOKU_SCORE.LIVE_THREE; myL3++; }
              else if (lv === 3) { mine += GOMOKU_SCORE.RUSH_FOUR; myR4++; }
              else if (lv === 4) mine += GOMOKU_SCORE.LIVE_FOUR;
            } else {
              if (lv === 2) { theirs += GOMOKU_SCORE.LIVE_THREE; opL3++; }
              else if (lv === 3) { theirs += GOMOKU_SCORE.RUSH_FOUR; opR4++; }
              else if (lv === 4) theirs += GOMOKU_SCORE.LIVE_FOUR;
            }
          }
        }
      }
      if (myL3 >= 2 || (myL3 && myR4) || myR4 >= 2) mine += 300000;
      if (opL3 >= 2 || (opL3 && opR4) || opR4 >= 2) theirs += 300000;
      return mine - theirs;
    }
    // ---- 大师级：Zobrist 哈希 + 置换表基础设施 ----
    function gmkRand32() { return (Math.random() * 4294967296) | 0; }
    // 哈希表按棋盘规格生成；规格切换/会话恢复后调用 gmkHashRebuild 重建
    function gmkHashRebuild() {
      if (!gmkZobrist || gmkZobrist.length !== state.size) {
        gmkZobrist = [];
        for (var r = 0; r < state.size; r++) {
          var row = [];
          for (var c = 0; c < state.size; c++) row.push([gmkRand32(), gmkRand32()]);
          gmkZobrist.push(row);
        }
      }
      var board = state.board, size = state.size, h = 0;
      for (r = 0; r < size; r++) {
        for (c = 0; c < size; c++) {
          var v = board[r][c];
          if (v) h = (h ^ gmkZobrist[r][c][v === 'white' ? 0 : 1]) | 0;
        }
      }
      gmkHash = h;
    }
    // 落子/撤子必须经这两个封装，保证哈希与棋盘同步（XOR 自逆）
    function gmkPlace(r, c, color) {
      state.board[r][c] = color;
      gmkHash = (gmkHash ^ gmkZobrist[r][c][color === 'white' ? 0 : 1]) | 0;
    }
    function gmkUnplace(r, c) {
      var v = state.board[r][c];
      state.board[r][c] = null;
      if (v) gmkHash = (gmkHash ^ gmkZobrist[r][c][v === 'white' ? 0 : 1]) | 0;
    }
    // ---- 大师级：VCF 连续冲四算杀 ----
    // 有子邻域 2 格内的空点（无排序轻量版，VCF 每层重建——落子会改变邻域）
    function gmkNearCells() {
      var size = state.size, board = state.board, out = [], r, c;
      for (r = 0; r < size; r++) {
        for (c = 0; c < size; c++) {
          if (board[r][c]) continue;
          var near = false;
          for (var dr = -2; dr <= 2 && !near; dr++) {
            for (var dc = -2; dc <= 2; dc++) {
              var rr = r + dr, cc = c + dc;
              if (rr >= 0 && cc >= 0 && rr < size && cc < size && board[rr][cc]) { near = true; break; }
            }
          }
          if (near) out.push({ row: r, col: c });
        }
      }
      return out;
    }
    // color 落子即成五的点集合
    function gmkFivePoints(cells, color) {
      var out = [];
      for (var i = 0; i < cells.length; i++) {
        if (gmkThreats(cells[i].row, cells[i].col, color).five) out.push(cells[i]);
      }
      return out;
    }
    // color 落子成四（活四/冲四，不含成五）的点集合
    function gmkFourPoints(cells, color) {
      var out = [];
      for (var i = 0; i < cells.length; i++) {
        var t = gmkThreats(cells[i].row, cells[i].col, color);
        if (t.five) continue;
        if (t.live4 || t.rush4) out.push(cells[i]);
      }
      return out;
    }
    // defender 堵住 attacker 全部即时成五点的落点：候选取成五点 ±2 邻域空点
    // （威胁线破坏点基本邻近成五点，±2 覆盖绝大多数；逐个试落并重查过滤——
    // 不堵净的无效。纯反四点无需枚举：反四不堵五时行棋方入口成五检查直接获胜）
    function gmkDefensePoints(fives, attacker) {
      if (!fives.length) return [];
      var size = state.size, board = state.board;
      var defender = attacker === 'white' ? 'black' : 'white';
      var seen = {}, cand = [], i;
      for (i = 0; i < fives.length; i++) {
        for (var dr = -2; dr <= 2; dr++) {
          for (var dc = -2; dc <= 2; dc++) {
            var r = fives[i].row + dr, c = fives[i].col + dc;
            if (r < 0 || c < 0 || r >= size || c >= size || board[r][c]) continue;
            var k = r * size + c;
            if (seen[k]) continue;
            seen[k] = 1;
            cand.push({ row: r, col: c });
          }
        }
      }
      var out = [];
      for (i = 0; i < cand.length; i++) {
        gmkPlace(cand[i].row, cand[i].col, defender);
        var still = gmkFivePoints(gmkNearCells(), attacker).length > 0;
        gmkUnplace(cand[i].row, cand[i].col);
        if (!still) out.push(cand[i]);
      }
      return out;
    }
    // VCF 主搜索：color 方能否仅靠「冲四/活四」强制取胜（对手每手被迫应，
    // 视野与搜索深度解耦）。返回制胜首手或 null；后续每手重跑即可沿链走完。
    // 规则完备性：每层入口先查行棋方即时成五；对手反四不堵五时入口检查即胜，
    // 故防守应对只需枚举「堵点」；堵防与杀链共用深度预算（防堵防循环）。
    function gmkVcf(color, depth) {
      if (depth <= 0 || gmkVcfCount > GOMOKU_VCF_NODES) return null;
      if ((gmkVcfCount & 127) === 0 && Date.now() > gmkVcfDeadline) return null;
      gmkVcfCount++;
      var opp = color === 'white' ? 'black' : 'white';
      var cells = gmkNearCells();
      // 我方即时成五 → 胜（VCF 链终点）
      var myFives = gmkFivePoints(cells, color);
      if (myFives.length) return myFives[0];
      // 对手即时成五 → 我必须先堵（堵防消耗 1 手预算，防对手连环反五死循环）
      var oppFives = gmkFivePoints(cells, opp);
      if (oppFives.length) {
        var musts = gmkDefensePoints(oppFives, opp);
        for (var i = 0; i < musts.length; i++) {
          gmkPlace(musts[i].row, musts[i].col, color);
          // 堵防后守方获得 1 手自由棋：若其仍有反四资源，自由手可再造四反先，
          // 而递归会跳过这手自由棋（当作守方弃权）→ 乐观误判。守方有四点资源时
          // 此防守线不可靠，保守判失败（只漏不误，防 P6/P7 幻影杀链）
          var risky = gmkFourPoints(gmkNearCells(), opp).length > 0;
          var r = risky ? null : gmkVcf(color, depth - 1);
          gmkUnplace(musts[i].row, musts[i].col);
          if (r) return r;
        }
        return null;
      }
      if (depth <= 1) return null;
      // 无紧急威胁：展开我方四（冲四后对手被迫应，递归延续杀链）
      var fours = gmkFourPoints(cells, color);
      for (i = 0; i < fours.length; i++) {
        var f = fours[i];
        gmkPlace(f.row, f.col, color);
        var win = null;
        // 落子后对手无即时成五才有连杀意义（有则对手反先，链断）
        if (!gmkFivePoints(gmkNearCells(), opp).length) {
          var myFiveNow = gmkFivePoints(gmkNearCells(), color);
          var defs = gmkDefensePoints(myFiveNow, color);
          if (!defs.length) {
            // 活四/双成五点：对手一手堵不完 → 必胜
            win = f;
          } else {
            var allLose = true;
            for (var j = 0; j < defs.length; j++) {
              gmkPlace(defs[j].row, defs[j].col, opp);
              var rr = gmkVcf(color, depth - 1);
              gmkUnplace(defs[j].row, defs[j].col);
              if (!rr) { allLose = false; break; }
            }
            if (allLose) win = f;
          }
        }
        gmkUnplace(f.row, f.col);
        if (win) return win;
      }
      return null;
    }
    // defender 堵住 attacker 全部「活四点」的落点（活三的强制威胁是下一手活四=
    // 双五点必胜）。候选取活四点 ±2 邻域空点，逐个试落后复查原活四点是否消失
    // （对手落子对 attacker 只会阻挡不会新增棋型，复查原集合即充分）。
    // 注意：活四点被防守方占点即消灭——gmkThreats 是「假设落子」语义（中心恒己方），
    // 对被占点直接复评会误判成 attacker 仍可在此成活四，导致应答集被错误清空
    function gmkStopLive4(l4pts, attacker) {
      if (!l4pts.length) return [];
      var size = state.size, board = state.board;
      var defender = attacker === 'white' ? 'black' : 'white';
      var seen = {}, cand = [], i;
      for (i = 0; i < l4pts.length; i++) {
        for (var dr = -2; dr <= 2; dr++) {
          for (var dc = -2; dc <= 2; dc++) {
            var r = l4pts[i].row + dr, c = l4pts[i].col + dc;
            if (r < 0 || c < 0 || r >= size || c >= size || board[r][c]) continue;
            var k = r * size + c;
            if (seen[k]) continue;
            seen[k] = 1;
            cand.push({ row: r, col: c });
          }
        }
      }
      var out = [];
      for (i = 0; i < cand.length; i++) {
        gmkPlace(cand[i].row, cand[i].col, defender);
        var still4 = false;
        for (var q = 0; q < l4pts.length; q++) {
          var lr = l4pts[q].row, lc = l4pts[q].col;
          // 已被占（防守方占点杀）→ 该活四点已消灭，跳过而非复评
          if (board[lr][lc]) continue;
          if (gmkThreats(lr, lc, attacker).live4) { still4 = true; break; }
        }
        gmkUnplace(cand[i].row, cand[i].col);
        if (!still4) out.push(cand[i]);
      }
      return out;
    }
    // color 落子即成活四的点集合（VCT 活三的强制威胁载体）
    function gmkLive4Points(cells, color) {
      var out = [];
      for (var i = 0; i < cells.length; i++) {
        if (gmkThreats(cells[i].row, cells[i].col, color).live4) out.push(cells[i]);
      }
      return out;
    }
    // VCT 威胁空间搜索：color 方用「冲四 + 活三」连续威胁强制取胜。
    // 与 VCF 的本质差异：活三的对手应答不唯一——
    // 应答集 = 堵活四点（堵净我方下一手活四=双五点，gmkStopLive4 语义）
    //          ∪ 对手反四点（反四拖一手或反堵活三线，必须并入否则误报必胜）。
    // 对手其他任何应答（不堵净不反四）→ 我方活四点仍在，下一手活四必胜。
    // 应答集超过 GOMOKU_VCT_MAXDEF 判无杀：威胁不够强制（保守，只漏不误）。
    function gmkVct(color, depth) {
      if (depth <= 0 || gmkVctCount > GOMOKU_VCT_NODES) return null;
      if ((gmkVctCount & 63) === 0 && Date.now() > gmkVcfDeadline) return null;
      gmkVctCount++;
      var opp = color === 'white' ? 'black' : 'white';
      var cells = gmkNearCells();
      // 我方即时成五 → 胜（链终点）
      var myFives = gmkFivePoints(cells, color);
      if (myFives.length) return myFives[0];
      // 对手即时成五 → 堵防（堵不住=对手双五点，败）
      var oppFives = gmkFivePoints(cells, opp);
      if (oppFives.length) {
        var musts = gmkDefensePoints(oppFives, opp);
        for (var m = 0; m < musts.length; m++) {
          gmkPlace(musts[m].row, musts[m].col, color);
          // 堵防后守方获得 1 手自由棋：若其仍有反四资源，自由手可再造四反先，
          // 而递归会跳过这手自由棋（当作守方弃权）→ 乐观误判。守方有四点资源时
          // 此防守线不可靠，保守判失败（与 gmkVcf 同构同修，只漏不误）
          var risky = gmkFourPoints(gmkNearCells(), opp).length > 0;
          var mr = risky ? null : gmkVct(color, depth - 1);
          gmkUnplace(musts[m].row, musts[m].col);
          if (mr) return mr;
        }
        return null;
      }
      if (depth <= 1) return null;
      // 威胁手两轮展开：先四（应答单一，堵五点，同 VCF）后活三（应答=堵活四点∪反四）
      var fours = gmkFourPoints(cells, color);
      var threes = [];
      for (var i = 0; i < cells.length; i++) {
        var t3 = gmkThreats(cells[i].row, cells[i].col, color);
        if (t3.live3) threes.push(cells[i]);
      }
      for (var round = 0; round < 2; round++) {
        var moves = round === 0 ? fours : threes;
        for (i = 0; i < moves.length; i++) {
          var mv = moves[i];
          gmkPlace(mv.row, mv.col, color);
          var win = null;
          // 落子后对手有即时成五 → 对手反先，此手无连杀意义
          if (!gmkFivePoints(gmkNearCells(), opp).length) {
            if (round === 0) {
              // 冲四：我方必有成五点，对手应答仅堵点（反四不堵五时入口检查即胜）
              var myFiveNow = gmkFivePoints(gmkNearCells(), color);
              var defs = gmkDefensePoints(myFiveNow, color);
              if (!defs.length) {
                // 活四/双成五点：对手一手堵不完 → 必胜
                win = mv;
              } else {
                var allLose = true;
                for (var j = 0; j < defs.length; j++) {
                  gmkPlace(defs[j].row, defs[j].col, opp);
                  var rr = gmkVct(color, depth - 1);
                  gmkUnplace(defs[j].row, defs[j].col);
                  if (!rr) { allLose = false; break; }
                }
                if (allLose) win = mv;
              }
            } else {
              // 活三：我方无即时成五点（有则在上面 myFives/四手处理），强制威胁是
              // 下一手活四。应答 = 堵净活四点 ∪ 对手反四点；应答集空 = 对手无解
              var myL4 = gmkLive4Points(gmkNearCells(), color);
              var stop4 = gmkStopLive4(myL4, color);
              var oppFours = gmkFourPoints(gmkNearCells(), opp);
              var replies = [], seenR = {}, k;
              for (j = 0; j < stop4.length; j++) { k = stop4[j].row * state.size + stop4[j].col; if (!seenR[k]) { seenR[k] = 1; replies.push(stop4[j]); } }
              for (j = 0; j < oppFours.length; j++) { k = oppFours[j].row * state.size + oppFours[j].col; if (!seenR[k]) { seenR[k] = 1; replies.push(oppFours[j]); } }
              if (replies.length <= GOMOKU_VCT_MAXDEF) {
                var allLose2 = true;
                for (j = 0; j < replies.length; j++) {
                  gmkPlace(replies[j].row, replies[j].col, opp);
                  var rr2 = gmkVct(color, depth - 1);
                  gmkUnplace(replies[j].row, replies[j].col);
                  if (!rr2) { allLose2 = false; break; }
                }
                if (allLose2) win = mv;
              }
            }
          }
          gmkUnplace(mv.row, mv.col);
          if (win) return win;
        }
      }
      return null;
    }
    // 搜索宽度：根层随深度收缩（depth2 全评防漏杀点、depth4 收 10、depth6 收 8，
    // 宽 14 时 depth6 在预算内跑不完会静默退化）；内层 depth≥4 收 8、其余 10
    var gmkTopN = 12;
    // negamax 搜索：返回「color 行棋方在当前局面下的最优价值」。
    // 置换表：hash+行棋色作键，depth/flag(EXACT=0/LOWER=1/UPPER=2) 标准存取，
    // 迭代加深层间复用结果大幅提速；超时上抛分数不入表。
    function gmkNegamax(depth, alpha, beta, color) {
      if ((++gmkNodes & 127) === 0 && Date.now() > gmkDeadline) { gmkTimeout = true; return 0; }
      var opp = color === 'white' ? 'black' : 'white';
      var key = gmkHash * 2 + (color === 'white' ? 0 : 1);
      var e = gmkTT.get(key);
      if (e && e.depth >= depth) {
        if (e.flag === 0) return e.score;
        if (e.flag === 1 && e.score >= beta) return e.score;
        if (e.flag === 2 && e.score <= alpha) return e.score;
        if (e.flag === 1 && e.score > alpha) alpha = e.score;
        if (e.flag === 2 && e.score < beta) beta = e.score;
        if (alpha >= beta) return e.score;
      }
      var cands = gmkCandidates(color);
      if (!cands.length) return 0;
      // 内层宽度随深度收缩：深层少分支保证在预算内到达 depth6（浅层宽是根层的事）
      var width = depth >= 4 ? 8 : (depth >= 2 ? 10 : 8);
      var best = -Infinity, flag = 2; // UPPER 默认：best 从未超过 alpha 即上界
      for (var i = 0; i < cands.length && i < width; i++) {
        var p = cands[i];
        gmkPlace(p.row, p.col, color);
        var v;
        if (soloHasWin(p.row, p.col, color)) {
          // 成五即胜：剩余深度越大（赢越早）分越高，驱动 AI 择快胜
          v = GOMOKU_SCORE.FIVE * 10 + depth * 1000;
        } else if (depth <= 1) {
          // 叶子：静态搜索延伸强制手（防水平线效应），无强制手回落棋型分。
          // 落子后轮 opp 行棋，返回 opp 视角取负
          v = -gmkQuiesce(-beta, -alpha, opp, 2);
        } else {
          v = -gmkNegamax(depth - 1, -beta, -alpha, opp);
        }
        gmkUnplace(p.row, p.col);
        if (gmkTimeout) return 0; // 超时上抛（棋盘已还原，分数不可信不入表）
        if (v > best) best = v;
        if (best > alpha) { alpha = best; flag = 0; }
        if (alpha >= beta) { flag = 1; break; }
      }
      if (!e || e.depth <= depth) gmkTT.set(key, { depth: depth, score: best, flag: flag });
      return best;
    }
    // 静态搜索（quiescence）：叶子处不直接静态评估，先展开强制手——
    // 行棋方即时成五必胜；有冲四/活四点则只延伸这些点（对手被迫应对），
    // 消解 depth 边界外的短杀链（水平线效应）。无强制手才回落棋型分。
    // qdepth 上限 2：延伸链最多 2 手冲四交互，成本约每叶子数千 ops，预算内。
    function gmkQuiesce(alpha, beta, color, qdepth) {
      if ((++gmkNodes & 127) === 0 && Date.now() > gmkDeadline) { gmkTimeout = true; return 0; }
      var opp = color === 'white' ? 'black' : 'white';
      var cands = gmkCandidates(color);
      var forced = null, best = -Infinity;
      for (var i = 0; i < cands.length; i++) {
        var t = gmkThreats(cands[i].row, cands[i].col, color);
        if (t.five) return GOMOKU_SCORE.FIVE * 10 + qdepth * 1000; // 行棋方即时成五
        if (t.live4 || t.rush4) { if (!forced) forced = []; forced.push(cands[i]); }
      }
      if (!forced || qdepth <= 0) return gmkBoardEval(color);
      for (i = 0; i < forced.length; i++) {
        var p = forced[i];
        gmkPlace(p.row, p.col, color);
        var v = -gmkQuiesce(-beta, -alpha, opp, qdepth - 1);
        gmkUnplace(p.row, p.col);
        if (gmkTimeout) return 0;
        if (v > best) best = v;
        if (best > alpha) alpha = best;
        if (alpha >= beta) break;
      }
      return best;
    }
    function soloAiPick() {
      var size = state.size, board = state.board, r, c;
      var hasStone = false;
      for (r = 0; r < size && !hasStone; r++) for (c = 0; c < size; c++) { if (board[r][c]) { hasStone = true; break; } }
      if (!hasStone) {
        // 空盘：天元附近 3×3 内随机起手，避免每局开局完全一样
        var mid = Math.floor(size / 2);
        return { row: mid + Math.floor(Math.random() * 3) - 1, col: mid + Math.floor(Math.random() * 3) - 1 };
      }
      // 哈希必须在 VCF（P6/P7 会经 gmkPlace 落子试探）之前就绪——
      // offlineStart/会话恢复已重建，这里兜底规格变化与首次调用
      gmkHashRebuild();
      // ---- 战术层：强制手检测（在候选邻域上做威胁归类，零副作用） ----
      var near = gmkCandidates('white');
      var myFive = [], oppFive = [], myLive4 = [], oppLive4 = [], oppDouble = [], double = [];
      for (var i = 0; i < near.length; i++) {
        r = near[i].row; c = near[i].col;
        var tw = gmkThreats(r, c, 'white');
        if (tw.five) { myFive.push({ row: r, col: c }); continue; }
        var th = gmkThreats(r, c, 'black');
        if (th.five) { oppFive.push({ row: r, col: c }); continue; }
        if (tw.live4) myLive4.push({ row: r, col: c });
        if (th.live4) oppLive4.push({ row: r, col: c });
        // 双威胁杀点：四三杀 / 双冲四 / 双活三（quick 启发识别不了，必须棋型计数）
        if ((tw.rush4 && tw.live3) || tw.rush4 >= 2 || tw.live3 >= 2) double.push({ row: r, col: c });
        // 对方的双威胁点：黑下这里即成四三/双活三，两步后活四白堵不完，必须提前拆
        if ((th.rush4 && th.live3) || th.rush4 >= 2 || th.live3 >= 2) oppDouble.push({ row: r, col: c });
      }
      // P1 我方成五：直接取胜（多个任选）
      if (myFive.length) return myFive[Math.floor(Math.random() * myFive.length)];
      // P2 对方成五：必堵（多个已难全防，堵我方增益最大的点拖延待变）
      if (oppFive.length) return gmkBestOf(oppFive);
      // P3 我方活四：下一手两个成五点，对方堵不完
      if (myLive4.length) return myLive4[Math.floor(Math.random() * myLive4.length)];
      // P4 对方活四点：必堵（敌活三不处理即成活四制胜；堵点选我方增益最大）
      if (oppLive4.length) return gmkBestOf(oppLive4);
      // P5 对方双威胁点：提前拆杀（黑四三/双活三一旦成型即为必败结构）
      if (oppDouble.length) return gmkBestOf(oppDouble);
      // P6 我方连杀：先 VCF（冲四链，应答单一最快）再 VCT（活三+冲四混合链），
      // 共用 deadline 自动挤占——VCF 命中直接下首手（后续每手重跑沿链走完）
      gmkVcfCount = 0;
      gmkVctCount = 0;
      gmkVcfDeadline = Date.now() + 150;
      var myVcf = gmkVcf('white', GOMOKU_VCF_DEPTH);
      if (myVcf) return { row: myVcf.row, col: myVcf.col };
      gmkVctCount = 0;
      var myVct = gmkVct('white', GOMOKU_VCT_DEPTH);
      if (myVct) return { row: myVct.row, col: myVct.col };
      // P7 对方连杀链（VCF+VCT 双检）：试占首手点 ±1 邻域空点，找到使对方
      // 杀链消解的破坏点。无破坏点说明必败已定或超预算，只能进搜索层拖延
      gmkVcfCount = 0;
      gmkVctCount = 0;
      gmkVcfDeadline = Date.now() + 220;
      var vcfThreat = gmkVcf('black', GOMOKU_VCF_DEPTH);
      if (!vcfThreat) {
        gmkVctCount = 0;
        vcfThreat = gmkVct('black', GOMOKU_VCT_DEPTH);
      }
      var forced = null;
      if (vcfThreat) {
        var seenB = {}, blocks = [];
        for (var dr = -1; dr <= 1 && blocks.length < 2; dr++) {
          for (var dc = -1; dc <= 1 && blocks.length < 2; dc++) {
            var rr = vcfThreat.row + dr, cc = vcfThreat.col + dc;
            if (rr < 0 || cc < 0 || rr >= size || cc >= size || board[rr][cc]) continue;
            var k = rr * size + cc;
            if (seenB[k]) continue;
            seenB[k] = 1;
            gmkPlace(rr, cc, 'white');
            var still = gmkVcf('black', GOMOKU_VCF_DEPTH) || gmkVct('black', GOMOKU_VCT_DEPTH);
            gmkUnplace(rr, cc);
            if (!still) blocks.push({ row: rr, col: cc });
          }
        }
        if (blocks.length) forced = blocks;
      }
      // ---- 搜索层：迭代加深 negamax（2→4→6 层，预算内取最深完整层） ----
      gmkTopN = size <= 15 ? 14 : 10;
      var cands = near.slice(0, gmkTopN);
      // 双威胁杀点强制并入候选前列：quick 启发按连子数排序会低估四三杀点，
      // 只靠 topN 截断可能根本进不了搜索视野
      for (i = 0; i < double.length; i++) {
        var dup = false;
        for (var j = 0; j < cands.length; j++) {
          if (cands[j].row === double[i].row && cands[j].col === double[i].col) { dup = true; break; }
        }
        if (!dup) cands.unshift({ row: double[i].row, col: double[i].col });
      }
      if (forced) {
        // 黑 VCF 可解：候选锁定为破坏点（黑绕路重建杀链的分支会被破坏点占位改变，
        // 搜索层在此范围内评估哪个破坏点后续最优）
        cands = forced;
      }
      if (!cands.length) return null;
      gmkTT = new Map();
      gmkNodes = 0;
      gmkDeadline = Date.now() + GOMOKU_BUDGET;
      gmkTimeout = false;
      var finalScored = null, alpha = -Infinity, depth;
      for (depth = 2; depth <= GOMOKU_MAX_DEPTH; depth += 2) {
        // 根层宽度随深度收缩：depth2 全评（广撒网防漏杀点）、depth4 收到 10、
        // depth6 收到 8（深线聚焦）。PV 点每层提到首位必在前 8，不会被截掉
        var rootWidth = depth >= 6 ? 8 : (depth >= 4 ? 10 : cands.length);
        // PV 优先：上一层最优候选提到首位，加速 α-β 剪枝
        if (finalScored) {
          var pvR = finalScored[0].row, pvC = finalScored[0].col;
          for (i = 0; i < cands.length; i++) {
            if (cands[i].row === pvR && cands[i].col === pvC) { cands.unshift(cands.splice(i, 1)[0]); break; }
          }
        }
        alpha = -Infinity;
        var scored = [];
        for (i = 0; i < cands.length && i < rootWidth; i++) {
          var p = cands[i];
          gmkPlace(p.row, p.col, 'white');
          var v;
          if (soloHasWin(p.row, p.col, 'white')) {
            v = GOMOKU_SCORE.FIVE * 10 + depth * 1000;
          } else {
            v = -gmkNegamax(depth - 1, -Infinity, -alpha, 'black');
          }
          gmkUnplace(p.row, p.col);
          if (gmkTimeout) break;
          scored.push({ row: p.row, col: p.col, score: v });
          if (v > alpha) alpha = v;
        }
        // 半成品层不可信：沿用上一层完整结果
        if (gmkTimeout) break;
        scored.sort(function(a, b) { return b.score - a.score; });
        finalScored = scored;
      }
      if (!finalScored) return null;
      // 最优分容差内的候选随机选（容差封顶 300：远小于棋型等级差与成五深度罚差，
      // 不会把「立即成五」和「拖延取胜」混为一谈，也不会跨级乱选），
      // 兼顾「等分随机不机械」与「稳赢稳防的点绝不放过」
      var best = finalScored[0].score;
      var eps = Math.min(300, Math.max(20, Math.abs(best) * 0.02));
      var pool = [];
      for (i = 0; i < finalScored.length; i++) {
        if (finalScored[i].score >= best - eps) pool.push({ row: finalScored[i].row, col: finalScored[i].col });
      }
      if (!pool.length) pool = [{ row: finalScored[0].row, col: finalScored[0].col }];
      return pool[Math.floor(Math.random() * pool.length)];
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
      gmkHashRebuild(); // AI 哈希表随棋盘规格初始化（15/19/21 各自的随机数表）
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
      // solo 玩家固定执黑，撤完轮玩家；local 黑先轮流，按剩余手数推算当前手
      //（撤掉白棋刚下的 1 手后 N 为奇数 → 仍轮白棋重下，而非错误地跳给黑棋）
      state.turn = mode === 'solo' ? 'black' : (offlineHistory.length % 2 === 0 ? 'black' : 'white');
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
        // 未进入对局：标题栏不显示对局操作（创建/加入入口在入场卡片，返回在左侧）
        if (mode === '') { actionButtons[a].hidden = true; continue; }
        actionButtons[a].hidden = isOffline && (kind === 'copy' || kind === 'share-chat' || kind === 'share-community');
      }
      // 房间模式加标记类：宽视口下右区（信息段+五按钮）更宽，媒体查询按此决定标题栏是否换行
      root.classList.toggle('gomoku-room-mode', mode === 'room' && !!roomCode);
      roomElement.textContent = mode === 'solo' ? '人机练习' : mode === 'local' ? '本地对战' : (roomCode ? '房间 ' + roomCode : '未进入房间');
      identityElement.textContent = mode === 'solo' ? '我执黑 · 电脑执白' : mode === 'local' ? '双人同屏 · 黑方先手' : (member ? (member.role === 'spectator' ? '观战者' : member.role === 'owner' ? '房主 · ' + (member.color === 'black' ? '黑棋' : '白棋') : member.color === 'black' ? '黑棋' : '白棋') : '');
      // 房间内对手未加入：后端放行自由摆棋，状态条给出提示而非轮次
      var soloRoom = mode === 'room' && state.status === 'active' && !state.winner && state.members.filter(function(m) { return m.color; }).length < 2;
      // 入场态状态条隐藏（未进入对局无轮次可言；hidden 让它在右区信息段中彻底不占位）
      if (mode === '') {
        statusElement.className = 'gomoku-status';
        statusElement.textContent = '';
        statusElement.hidden = true;
      } else {
        statusElement.className = 'gomoku-status' + (state.winner ? ' is-winner' : soloRoom ? ' is-waiting' : (state.status === 'active' ? ' is-turn is-turn-' + state.turn : ''));
        statusElement.hidden = false;
        statusElement.textContent = state.winner ? (state.winner === 'black' ? '黑棋获胜' : '白棋获胜') : soloRoom ? '等待对手加入' : state.status !== 'active' ? '等待下一局' : '轮到' + (state.turn === 'black' ? '黑棋' : '白棋');
      }
      if (isOffline) setConnection('本地对弈', 'online');
      else if (!roomCode) setConnection('未进入房间', '');
      // 单机模式直接本地判手；房间模式按成员身份
      var myTurn = isOffline
        ? (state.status === 'active' && !state.winner)
        : !!(member && member.color && !state.winner && state.status === 'active' && member.color === state.turn);
      boardElement.className = 'gomoku-board' + (state.winner ? ' has-winner' : '') + (myTurn ? ' is-my-turn' : '') + (state.turn === 'white' ? ' turn-white' : ' turn-black');
      entryElement.hidden = inGame;
      // 入场态隐藏标题栏副标题（模式/身份信息在入场卡片已有完整说明，避免重复）；
      // 同时给根节点打 entering 标记，横屏 CSS 据此让入场内容垂直居中。
      if (roomElement) roomElement.hidden = !inGame;
      if (identityElement) identityElement.hidden = !inGame;
      root.classList.toggle('gomoku-entering', !inGame);
      // 未进入房间时隐藏棋盘区：此前空棋盘 + 禁用格子也一直渲染，横屏下与入场卡片挤在一起
      var layoutElement = root.querySelector('.gomoku-layout');
      if (layoutElement) layoutElement.hidden = !inGame;
      // 棋盘层跳过重建：签名含 mode（房间/单机切换必重建）
      var boardSignature = JSON.stringify([mode, state.size, state.board, state.lastMove, state.winner, state.status]);
      var boardUnchanged = boardSignature === lastBoardSignature && boardElement.childElementCount > 0;
      lastBoardSignature = boardSignature;
      if (boardUnchanged) {
        // 仅刷新格子可点状态（忙碌锁解锁/轮次变化），棋子层不动 → 入场动画继续播放
        var keptStones = boardElement.querySelector('.gomoku-stones');
        if (keptStones) {
          var keptCells = keptStones.querySelectorAll('.gomoku-cell');
          for (var k = 0; k < keptCells.length; k++) {
            var kc = keptCells[k];
            var kcColor = kc.classList.contains('is-black') ? 'black' : kc.classList.contains('is-white') ? 'white' : null;
            kc.disabled = boardDisabled(kcColor, isOffline, member);
          }
        }
      } else {
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
          cell.disabled = boardDisabled(color, isOffline, member);
          stonesElement.appendChild(cell);
        });
      });
      lastAnimatedKey = state.lastMove ? state.lastMove.row + '_' + state.lastMove.col : '';
      } // 棋盘层重建分支结束（签名未变时跳过，保住入场动画）

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
      // 返回按钮豁免忙碌锁：请求卡住时用户仍能退出应用
      var buttons = root.querySelectorAll('[data-action]:not([data-action="home"])');
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
      var kind = action.dataset.action;
      // 返回桌面：标题栏常驻出口，不受忙碌锁限制（onBoardClick 的落子锁只锁棋盘）
      if (kind === 'home') return navigateHome();
      if (pending) return;
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
         if (data && data.roomCode === roomCode && data.state) applyState(data.state, { fromPush: true });
       }));
     }
     if (!realtime) {
       onSocket('gomoku_room_state', function(message) { if (message.room_code === roomCode) applyState(message.state, { fromPush: true }); });
       onSocket('gomoku_room_changed', function(message) { if (message.room_code === roomCode) { pending = false; applyState(message.state, { fromPush: true }); } });
       onSocket('gomoku_game_continued', function(message) { if (message.room_code === roomCode) { pending = false; applyState(message.state, { fromPush: true }); } });
       onSocket('gomoku_move_rejected', function(message) { if (message.room_code === roomCode) { pending = false; setError(message.reason || '落子被拒绝'); if (message.state) applyState(message.state, { fromPush: true }); else render(); } });
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
      gmkHashRebuild(); // 恢复的对局重建 AI 哈希（随机数表与棋盘规格对齐）
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
