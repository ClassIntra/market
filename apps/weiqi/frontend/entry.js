/*
 * 围棋（weiqi）—— 市场应用前端入口
 *
 * 运行环境：ClassIntra 宿主运行时装载的原生 ES5 脚本（Chrome 80 / 腾讯 X5 基线）。
 * 约束：var / function / 单引号；不用箭头函数、模板字符串、可选链、class、async/await；
 *      不用 innerHTML（用户数据一律 textContent），不用 flex gap / aspect-ratio。
 *
 * 组成：
 *   - 入场：人机练习 / 本地双人 / 房间联机 / SGF 打谱
 *   - 棋盘：Canvas 2D，木纹与棋子贴图缓存，DPR 适配，落子/提子动画
 *   - 单机：规则核心在 core/go-core.js，AI 在 frontend/ai-worker.js（Web Worker）
 *   - 联机：后端权威房间状态，实时推送 + 轮询兜底，双方确认数子
 *   - 复盘：棋谱列表逐手回看，键盘方向键换手，SGF 导入/导出
 */
(function () {
  'use strict';

  var NAME = 'weiqi';
  var BLACK = 1;
  var WHITE = 2;
  var Core = null;

  // ============ 基础工具 ============
  function clearChildren(el) {
    if (!el) return;
    while (el.firstChild) el.removeChild(el.firstChild);
  }

  function t(tag, className, attrs, children) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (attrs) {
      for (var key in attrs) {
        if (!Object.prototype.hasOwnProperty.call(attrs, key)) continue;
        var value = attrs[key];
        if (value === null || value === undefined) continue;
        if (key === 'text') node.textContent = String(value);
        else node.setAttribute(key, String(value));
      }
    }
    if (children) {
      for (var i = 0; i < children.length; i++) {
        if (children[i]) node.appendChild(children[i]);
      }
    }
    return node;
  }

  function setText(el, text) {
    if (el && el.textContent !== String(text)) el.textContent = String(text);
  }

  function setHidden(el, hidden) {
    if (el) el.hidden = !!hidden;
  }

  function setDisabled(el, disabled) {
    if (el) el.disabled = !!disabled;
  }

  function toggleClass(el, className, on) {
    if (!el) return;
    if (on) {
      if (el.classList) el.classList.add(className);
      else if ((' ' + el.className + ' ').indexOf(' ' + className + ' ') === -1) el.className += ' ' + className;
    } else {
      if (el.classList) el.classList.remove(className);
      else el.className = (' ' + el.className + ' ').replace(' ' + className + ' ', ' ').replace(/^\s+|\s+$/g, '');
    }
  }

  function isTouchDevice() {
    return 'ontouchstart' in window || (navigator.maxTouchPoints && navigator.maxTouchPoints > 0);
  }

  function now() {
    return (window.performance && window.performance.now) ? window.performance.now() : Date.now();
  }

  function pad2(n) {
    return n < 10 ? '0' + n : String(n);
  }

  function formatDate() {
    var d = new Date();
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }

  function loadScript(url, callback) {
    var script = document.createElement('script');
    var done = false;
    script.async = true;
    script.src = url;
    script.onload = function () { if (!done) { done = true; callback(true); } };
    script.onerror = function () { if (!done) { done = true; callback(false); } };
    document.head.appendChild(script);
  }

  function isArray(value) {
    return Object.prototype.toString.call(value) === '[object Array]';
  }

  function clamp(value, min, max) {
    return value < min ? min : value > max ? max : value;
  }

  // ============ 入口 ============
  function mount(container, context) {
    if (!container) return;
    var loading = t('div', 'weiqi-loading', null, [
      t('div', 'weiqi-loading-mark', { text: '围棋' }),
      t('p', null, { text: '正在准备棋盘…' })
    ]);
    container.appendChild(loading);
    var settled = false;

    function finish(error) {
      if (settled) return;
      settled = true;
      if (error) {
        clearChildren(container);
        var box = t('div', 'weiqi-app weiqi-app-error', null, [
          t('div', 'weiqi-fatal', null, [
            t('h2', null, { text: '围棋加载失败' }),
            t('p', null, { text: error.message || String(error) }),
            t('button', 'weiqi-btn weiqi-btn-primary', { type: 'button', text: '返回桌面' })
          ])
        ]);
        var back = box.querySelector('button');
        if (back) back.addEventListener('click', function () {
          try { context.system.goDesktop(); } catch (e) {}
        });
        container.appendChild(box);
        return;
      }
      clearChildren(container);
      boot(container, context);
    }

    if (window.WeiqiCore) {
      Core = window.WeiqiCore;
      finish();
      return;
    }
    var url = context && context.app && typeof context.app.assetUrl === 'function'
      ? context.app.assetUrl('core/go-core.js')
      : 'core/go-core.js';
    loadScript(url, function (ok) {
      if (ok && window.WeiqiCore) {
        Core = window.WeiqiCore;
        finish();
      } else {
        finish(new Error('规则模块 core/go-core.js 加载失败，请检查应用包是否完整'));
      }
    });
  }

  // ============ 主体 ============
  function boot(container, context) {
    var disposed = false;
    var storage = (context.data && context.data.storage) || null;
    var realtime = (context.data && context.data.realtime) || context.realtime || null;
    var hostNavbar = (context.ui && context.ui.hostNavbar) || null;
    var userId = '';
    try {
      var user = (context.system && context.system.user) || context.user || null;
      userId = user ? String(user.user_id || user.id || '') : '';
    } catch (e) { userId = ''; }

    var settings = readSettings();
    var opts = {
      size: settings.size,
      aiLevel: settings.aiLevel,
      humanColor: settings.humanColor,
      handicap: settings.handicap,
      sound: settings.sound,
      showNumbers: settings.showNumbers,
      confirmMove: settings.confirmMove,
      katago: settings.katago
    };

    var state = null;            // 当前对局核心状态
    var room = null;             // 服务端房间快照
    var roomCode = '';
    var mode = '';               // '' | 'solo' | 'local' | 'room' | 'review'
    var currentMember = null;
    var reviewIndex = -1;
    var deadSet = {};
    var scoringPreview = null;
    var finalScore = null;
    var importedMeta = null;
    var tab = 'info';
    var chatMessages = [];
    var chatLoadedFor = '';
    var unreadChat = 0;
    var pendingPoint = null;
    var busy = false;
    var aiThinking = false;
    var aiProgress = 0;
    var aiProgressTotal = 0;
    var aiStartedAt = 0;
    var aiTickTimer = null;
    var aiSeq = 0;
    var activeAiId = 0;
    var pendingHint = null;
    var aiContext = null;
    var analysisSeq = 0;
    var analysisLoading = false;
    var analysis = null;
    var analysisTimer = null;
    var pendingConfirm = null;
    var reviewPlaying = false;
    var reviewTimer = null;
    var reviewReport = null;
    var reviewReportToken = 0;
    var aiTimer = null;
    var aiFallback = typeof window.Worker !== 'function';
    var kataGoAvailable = false;
    var kataGoChecked = false;
    var kataGoCooldownUntil = 0;
    var kataGoFailures = 0;
    var kataRecoverTimer = null;
    var aiEngineKind = 'local';
    var aiFallbackLoading = false;
    var worker = null;
    var mainAiCancel = null;
    var pollTimer = null;
    var pollTick = 0;
    var saveTimer = null;
    var toastTimer = null;
    var resizeGuard = null;
    var lastActionEvent = null;
    var reduceMotion = false;
    try {
      reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch (e) { reduceMotion = false; }
    var viewCache = { key: '', state: null };
    var movesKey = '';
    var chatKey = '';
    var subscriptions = [];
    var timers = [];

    // ============ DOM 骨架 ============
    var root = t('div', 'weiqi-app', { 'data-mode': 'entry' });

    var statusText = t('span', 'weiqi-nav-status-text', { 'aria-live': 'polite' });
    var subText = t('span', 'weiqi-nav-sub');
    var navStatus = t('div', 'weiqi-nav-status', null, [statusText, subText]);
    var connectionText = t('span', 'weiqi-conn', { 'data-role': 'connection' });
    var undoNavButton = t('button', 'weiqi-btn weiqi-btn-sm', { type: 'button', 'data-action': 'undo', text: '悔棋' });
    var leaveNavButton = t('button', 'weiqi-btn weiqi-btn-sm', { type: 'button', 'data-action': 'leave', text: '离开' });
    var navActions = t('div', 'weiqi-nav-actions', null, [undoNavButton, leaveNavButton]);
    var fallbackBar = t('div', 'weiqi-statusbar', null, [
      navStatus,
      t('div', 'weiqi-statusbar-right', null, [connectionText, navActions])
    ]);

    // 入场页
    var sizeSeg = buildSegmented('size', [
      { value: 9, label: '9 路 快棋' },
      { value: 13, label: '13 路 标准' },
      { value: 19, label: '19 路 正式' }
    ], opts.size);
    var colorSeg = buildSegmented('color', [
      { value: BLACK, label: '执黑' },
      { value: WHITE, label: '执白' }
    ], opts.humanColor);
    var levelSeg = buildSegmented('level', [
      { value: 1, label: '入门' },
      { value: 2, label: '进阶' },
      { value: 3, label: '高手' }
    ], opts.aiLevel);
    var handicapSelect = t('select', 'weiqi-select', { 'data-field': 'handicap' }, []);
    var handicapValues = [0, 2, 3, 4, 5, 6, 7, 8, 9];
    for (var hi = 0; hi < handicapValues.length; hi++) {
      var hv = handicapValues[hi];
      handicapSelect.appendChild(t('option', null, { value: String(hv), text: hv === 0 ? '不让子' : hv + ' 子' }));
    }
    handicapSelect.value = String(opts.handicap);

    var colorField = buildField('我执', colorSeg);
    colorField.appendChild(t('button', 'weiqi-btn weiqi-btn-sm weiqi-btn-quiet weiqi-guess', {
      type: 'button', 'data-action': 'guess-first', text: '猜先'
    }));

    var roomInput = t('input', 'weiqi-input', {
      'data-field': 'room', type: 'text', inputmode: 'numeric', maxlength: '6',
      autocomplete: 'off', placeholder: '输入 4 位房间码'
    });

    var entryError = t('p', 'weiqi-error', { 'aria-live': 'polite' });
    var resumeCard = t('div', 'weiqi-resume', { hidden: 'hidden' });
    var resumeText = t('p', 'weiqi-resume-text');
    var resumeContinue = t('button', 'weiqi-btn weiqi-btn-primary', { type: 'button', 'data-action': 'resume-session', text: '继续上次' });
    var resumeDiscard = t('button', 'weiqi-btn', { type: 'button', 'data-action': 'discard-session', text: '放弃' });
    resumeCard.appendChild(resumeText);
    resumeCard.appendChild(resumeContinue);
    resumeCard.appendChild(resumeDiscard);
    var historyList = t('div', 'weiqi-history-list');

    var entry = t('div', 'weiqi-entry', null, [
      t('header', 'weiqi-hero', null, [
        t('div', 'weiqi-hero-copy', null, [
          t('p', 'weiqi-kicker', { text: 'ClassIntra · 棋类' }),
          t('h1', null, { text: '围棋' }),
          t('p', 'weiqi-hero-desc', { text: '围地、做活、手谈。9 / 13 / 19 路，单机与联机都能下。' })
        ]),
        buildHeroBoard()
      ]),
      t('section', 'weiqi-settings', null, [
        buildField('棋盘', sizeSeg),
        colorField,
        buildField('棋力', levelSeg),
        buildField('让子', handicapSelect)
      ]),
      t('div', 'weiqi-entry-grid', null, [
        t('article', 'weiqi-card weiqi-card-primary', null, [
          t('h2', null, { text: '人机练习' }),
          t('p', null, { text: '本地 AI 在后台思考，落子不卡界面。适合入门与随手一盘。' }),
          t('ul', 'weiqi-card-list', null, [
            t('li', null, { text: '三档棋力：入门 / 进阶 / 高手' }),
            t('li', null, { text: '可让子、可执白后行' }),
            t('li', null, { text: '支持 AI 分析与悔棋，无后台线程时自动兼容' }),
            t('li', null, { text: '服务器已装 KataGo 时自动启用强力 AI' })
          ]),
          t('button', 'weiqi-btn weiqi-btn-primary weiqi-btn-block', { type: 'button', 'data-action': 'start-solo', text: '开始人机对弈' })
        ]),
        t('article', 'weiqi-card', null, [
          t('h2', null, { text: '本地双人' }),
          t('p', null, { text: '同一台平板轮流落子，适合课间面对面手谈。' }),
          t('ul', 'weiqi-card-list', null, [
            t('li', null, { text: '同一套规则与数子流程' }),
            t('li', null, { text: '黑先白后，可让子' }),
            t('li', null, { text: '可随时复盘' })
          ]),
          t('button', 'weiqi-btn weiqi-btn-block', { type: 'button', 'data-action': 'start-local', text: '开始本地对局' })
        ]),
        t('article', 'weiqi-card', null, [
          t('h2', null, { text: '房间联机' }),
          t('p', null, { text: '凭 4 位房间码同桌对弈，隔壁班也能加入；支持观战与聊天。' }),
          t('div', 'weiqi-room-create', null, [
            t('button', 'weiqi-btn weiqi-btn-primary', { type: 'button', 'data-action': 'create-room', text: '创建房间' }),
            t('span', 'weiqi-hint', { text: '按上方的棋盘 / 执子设置建房' })
          ]),
          t('div', 'weiqi-join', null, [
            roomInput,
            t('button', 'weiqi-btn', { type: 'button', 'data-action': 'join-room', text: '加入' }),
            t('button', 'weiqi-btn weiqi-btn-quiet', { type: 'button', 'data-action': 'watch-room', text: '观战' })
          ])
        ]),
        t('article', 'weiqi-card', null, [
          t('h2', null, { text: '打谱复盘' }),
          t('p', null, { text: '设备不支持文件时，用「粘贴棋谱」或下面的棋谱库；对局结束会自动留档。' }),
          t('ul', 'weiqi-card-list', null, [
            t('li', null, { text: '支持 SGF FF[4] 主线与让子摆子' }),
            t('li', null, { text: '方向键换手，点棋谱跳转' }),
            t('li', null, { text: '导入后可继续研究变化' })
          ]),
          t('div', 'weiqi-row', null, [
            t('button', 'weiqi-btn weiqi-btn-primary', { type: 'button', 'data-action': 'paste-sgf', text: '粘贴棋谱' }),
            t('button', 'weiqi-btn weiqi-btn-quiet', { type: 'button', 'data-action': 'import-sgf', text: '选择 SGF 文件' })
          ])
        ]),
        t('article', 'weiqi-card', null, [
          t('h2', null, { text: '棋谱库' }),
          t('p', null, { text: '对局结束自动保存在本机，点开即可复盘，不需要导出/导入文件。' }),
          historyList
        ])
      ]),
      resumeCard,
      entryError,
      t('p', 'weiqi-entry-foot', { text: '规则：中国数子法 · 贴 7.5 目 · 让子局白先、贴 0.5 目 · 双方连续停一手后进入数子' })
    ]);

    // 对局页
    var turnDot = t('span', 'weiqi-turn-dot', { 'data-role': 'turn-dot' });
    var turnText = t('strong', 'weiqi-turn-text', { 'data-role': 'turn-text', text: '轮到黑棋' });
    var moveMeta = t('span', 'weiqi-board-meta', { 'data-role': 'move-meta' });
    var thinkingText = t('span', 'weiqi-thinking', { 'data-role': 'thinking', hidden: 'hidden' });
    var boardBar = t('div', 'weiqi-board-bar', null, [turnDot, turnText, moveMeta, thinkingText]);

    var canvas = t('canvas', 'weiqi-board', {
      width: '600', height: '600', tabindex: '0', role: 'application',
      'aria-label': '围棋棋盘。方向键移动选点，回车落子。'
    });
    var boardWrap = t('div', 'weiqi-board-wrap', { 'data-role': 'board-wrap' }, [canvas]);
    var coordHint = t('span', 'weiqi-board-hint', { 'data-role': 'coord', text: '方向键选点 · 回车落子' });
    var aiProgressText = t('span', 'weiqi-board-hint', { 'data-role': 'ai-progress' });
    var boardFoot = t('div', 'weiqi-board-foot', null, [coordHint, aiProgressText]);

    var scoreTitle = t('strong', null, { text: '数子' });
    var scoreText = t('span', 'weiqi-score-text', { 'data-role': 'score-text' });
    var scoreDetail = t('p', 'weiqi-score-detail', { 'data-role': 'score-detail' });
    var confirmScoreButton = t('button', 'weiqi-btn weiqi-btn-primary', { type: 'button', 'data-action': 'confirm-score', text: '确认结果' });
    var resumeGameButton = t('button', 'weiqi-btn', { type: 'button', 'data-action': 'resume-game', text: '继续下棋' });
    var scoringBar = t('div', 'weiqi-scoring', { 'data-role': 'scoring', hidden: 'hidden' }, [
      t('div', 'weiqi-scoring-head', null, [scoreTitle, scoreText]),
      scoreDetail,
      t('div', 'weiqi-scoring-actions', null, [confirmScoreButton, resumeGameButton])
    ]);

    var gameMain = t('div', 'weiqi-game-main', null, [boardBar, boardWrap, boardFoot, scoringBar]);

    var tabInfo = t('button', 'weiqi-tab is-active', { type: 'button', 'data-tab': 'info', text: '对局' });
    var tabMoves = t('button', 'weiqi-tab', { type: 'button', 'data-tab': 'moves', text: '棋谱' });
    var chatBadge = t('span', 'weiqi-badge', { hidden: 'hidden' });
    var tabChat = t('button', 'weiqi-tab', { type: 'button', 'data-tab': 'chat' }, [
      t('span', null, { text: '聊天' }),
      chatBadge
    ]);
    tabChat.hidden = true;
    var sideClose = t('button', 'weiqi-side-close', { type: 'button', 'data-action': 'close-sheet', 'aria-label': '收起面板', text: '×' });
    var sideHead = t('div', 'weiqi-side-head', null, [
      t('div', 'weiqi-tabs', { role: 'tablist' }, [tabInfo, tabMoves, tabChat]),
      sideClose
    ]);
    var panelInfo = t('div', 'weiqi-panel weiqi-panel-info', { 'data-panel': 'info', role: 'tabpanel' });
    var panelMoves = t('div', 'weiqi-panel weiqi-panel-moves', { 'data-panel': 'moves', role: 'tabpanel', hidden: 'hidden' });
    var panelChat = t('div', 'weiqi-panel weiqi-panel-chat', { 'data-panel': 'chat', role: 'tabpanel', hidden: 'hidden' });
    var side = t('aside', 'weiqi-side', { 'data-role': 'side' }, [
      sideHead,
      t('div', 'weiqi-panels', null, [panelInfo, panelMoves, panelChat])
    ]);

    var mobileUndo = t('button', 'weiqi-mobile-btn', { type: 'button', 'data-action': 'undo', text: '悔棋' });
    var mobilePass = t('button', 'weiqi-mobile-btn', { type: 'button', 'data-action': 'pass', text: '停一手' });
    var mobileMoves = t('button', 'weiqi-mobile-btn', { type: 'button', 'data-action': 'open-moves', text: '棋谱' });
    var mobileMenu = t('button', 'weiqi-mobile-btn', { type: 'button', 'data-action': 'open-menu', text: '菜单' });
    var mobileActions = t('div', 'weiqi-mobile-actions', null, [mobileUndo, mobilePass, mobileMoves, mobileMenu]);
    var sheetMask = t('div', 'weiqi-sheet-mask', { 'data-role': 'sheet-mask', hidden: 'hidden' });

    var toast = t('div', 'weiqi-toast', { role: 'status', 'aria-live': 'polite' });
    var srOnly = t('div', 'weiqi-sr', { 'aria-live': 'polite' });

    var game = t('div', 'weiqi-game', { hidden: 'hidden' }, [
      gameMain,
      side,
      sheetMask,
      mobileActions
    ]);

    var shell = t('div', 'weiqi-shell', null, [fallbackBar, entry, game, toast, srOnly]);
    root.appendChild(shell);
    container.appendChild(root);

    // ============ 主题 / 尺寸监听 ============
    var themeName = (context.theme && context.theme.current) || 'light';
    if (context.theme && typeof context.theme.subscribe === 'function') {
      subscriptions.push(context.theme.subscribe(function (theme) {
        themeName = (theme && theme.name) || (typeof theme === 'string' ? theme : themeName);
        boardView.theme = themeName;
        buildBoardBackground();
        requestDraw();
      }));
    }

    // ============ 画板 ============
    var boardView = {
      canvas: canvas,
      wrap: boardWrap,
      ctx: canvas.getContext ? canvas.getContext('2d') : null,
      size: opts.size,
      px: 0,
      dpr: 1,
      cell: 0,
      ox: 0,
      oy: 0,
      bg: null,
      blackSprite: null,
      whiteSprite: null,
      spritePx: 0,
      theme: themeName,
      hover: null,
      cursor: null,
      hint: null,
      anim: null,
      fade: null,
      raf: 0,
      keyboard: false
    };
    if (!boardView.ctx) {
      entryError.textContent = '当前浏览器不支持 Canvas，无法显示棋盘。';
    }

    function layoutBoard() {
      var rect = boardWrap.getBoundingClientRect();
      var availW = rect.width || boardWrap.clientWidth || 0;
      var availH = rect.height || boardWrap.clientHeight || 0;
      if (!availW || !availH) return false;
      var px = Math.floor(Math.min(availW, availH));
      if (px < 120) return false;
      var dpr = clamp(window.devicePixelRatio || 1, 1, 2.5);
      if (px === boardView.px && dpr === boardView.dpr && boardView.size === (state ? state.size : opts.size)) return true;
      boardView.px = px;
      boardView.dpr = dpr;
      boardView.size = state ? state.size : opts.size;
      canvas.style.width = px + 'px';
      canvas.style.height = px + 'px';
      canvas.width = Math.round(px * dpr);
      canvas.height = Math.round(px * dpr);
      boardView.cell = Math.floor(px / (boardView.size + 1.35));
      var span = boardView.cell * (boardView.size - 1);
      boardView.ox = (px - span) / 2;
      boardView.oy = (px - span) / 2;
      buildSprites();
      buildBoardBackground();
      requestDraw();
      return true;
    }

    function buildSprites() {
      var cell = boardView.cell;
      if (!cell) return;
      var dpr = boardView.dpr;
      var spriteCss = cell * 1.06;
      var spritePx = Math.max(8, Math.round(spriteCss * dpr));
      if (boardView.spritePx === spritePx && boardView.blackSprite && boardView.whiteSprite) return;
      boardView.spritePx = spritePx;
      boardView.blackSprite = makeStoneSprite(spritePx, dpr, true);
      boardView.whiteSprite = makeStoneSprite(spritePx, dpr, false);
    }

    function makeStoneSprite(px, dpr, black) {
      var c = document.createElement('canvas');
      c.width = px;
      c.height = px;
      var ctx = c.getContext('2d');
      if (!ctx) return c;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      var size = px / dpr;
      var r = size * 0.42;
      var cx = size / 2;
      var cy = size / 2;
      ctx.save();
      ctx.shadowColor = 'rgba(22, 14, 4, 0.42)';
      ctx.shadowBlur = size * 0.10;
      ctx.shadowOffsetX = size * 0.03;
      ctx.shadowOffsetY = size * 0.05;
      var grad = ctx.createRadialGradient(cx - r * 0.38, cy - r * 0.42, r * 0.08, cx, cy, r * 1.02);
      if (black) {
        grad.addColorStop(0, '#6f7480');
        grad.addColorStop(0.18, '#3a3d44');
        grad.addColorStop(0.62, '#15171b');
        grad.addColorStop(1, '#020304');
      } else {
        grad.addColorStop(0, '#ffffff');
        grad.addColorStop(0.55, '#f5f3ee');
        grad.addColorStop(0.88, '#dcd8cf');
        grad.addColorStop(1, '#bfb9ad');
      }
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      // 顶部高光
      ctx.save();
      var hl = ctx.createRadialGradient(cx - r * 0.34, cy - r * 0.38, 0, cx - r * 0.34, cy - r * 0.38, r * 0.62);
      hl.addColorStop(0, black ? 'rgba(255,255,255,0.22)' : 'rgba(255,255,255,0.9)');
      hl.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = hl;
      ctx.beginPath();
      ctx.arc(cx - r * 0.2, cy - r * 0.24, r * 0.62, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      if (!black) {
        ctx.strokeStyle = 'rgba(120, 113, 100, 0.55)';
        ctx.lineWidth = Math.max(0.6, size * 0.012);
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.stroke();
      }
      return c;
    }

    function buildBoardBackground() {
      if (!boardView.ctx || !boardView.px) return;
      var px = boardView.px;
      var dpr = boardView.dpr;
      var c = document.createElement('canvas');
      c.width = Math.round(px * dpr);
      c.height = Math.round(px * dpr);
      var ctx = c.getContext('2d');
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      var dark = boardView.theme === 'dark';
      // 木纹底色
      var wood = ctx.createLinearGradient(0, 0, px * 0.25, px);
      if (dark) {
        wood.addColorStop(0, '#c9a465');
        wood.addColorStop(0.45, '#bd9554');
        wood.addColorStop(1, '#a97f44');
      } else {
        wood.addColorStop(0, '#f0d6a2');
        wood.addColorStop(0.35, '#e8c88f');
        wood.addColorStop(0.72, '#ddb877');
        wood.addColorStop(1, '#cfa15f');
      }
      ctx.fillStyle = wood;
      ctx.fillRect(0, 0, px, px);
      // 木纹：确定性的细线，不依赖随机数（避免每次 resize 纹理跳动）
      var i;
      ctx.save();
      ctx.globalAlpha = dark ? 0.10 : 0.08;
      ctx.strokeStyle = '#6b451d';
      ctx.lineWidth = 1;
      for (i = 0; i < 46; i++) {
        var y = (i + 0.5) * px / 46;
        ctx.beginPath();
        for (var x = 0; x <= px; x += 14) {
          var wave = Math.sin((x / px) * Math.PI * 2.2 + i * 0.9) * (px * 0.004 + i * 0.02);
          if (x === 0) ctx.moveTo(x, y + wave);
          else ctx.lineTo(x, y + wave);
        }
        ctx.stroke();
      }
      ctx.restore();
      // 顶部高光与四周暗角
      var light = ctx.createLinearGradient(0, 0, 0, px);
      light.addColorStop(0, 'rgba(255,255,255,0.20)');
      light.addColorStop(0.18, 'rgba(255,255,255,0.04)');
      light.addColorStop(0.82, 'rgba(70,40,10,0.03)');
      light.addColorStop(1, 'rgba(70,40,10,0.18)');
      ctx.fillStyle = light;
      ctx.fillRect(0, 0, px, px);

      var size = boardView.size;
      var cell = boardView.cell;
      var ox = boardView.ox;
      var oy = boardView.oy;
      var span = cell * (size - 1);
      var lineColor = dark ? 'rgba(52, 32, 10, 0.86)' : 'rgba(74, 48, 22, 0.78)';
      ctx.strokeStyle = lineColor;
      ctx.lineWidth = 1;
      // 网格
      for (i = 0; i < size; i++) {
        var gx = Math.round(ox + i * cell) + 0.5;
        ctx.beginPath();
        ctx.moveTo(gx, Math.round(oy) + 0.5);
        ctx.lineTo(gx, Math.round(oy + span) + 0.5);
        ctx.stroke();
        var gy = Math.round(oy + i * cell) + 0.5;
        ctx.beginPath();
        ctx.moveTo(Math.round(ox) + 0.5, gy);
        ctx.lineTo(Math.round(ox + span) + 0.5, gy);
        ctx.stroke();
      }
      // 外框
      ctx.lineWidth = 1.7;
      ctx.strokeStyle = dark ? 'rgba(46, 28, 8, 0.92)' : 'rgba(66, 42, 18, 0.9)';
      ctx.strokeRect(Math.round(ox) + 0.5, Math.round(oy) + 0.5, Math.round(span), Math.round(span));
      // 星位
      var stars = Core.starPoints(size);
      ctx.fillStyle = dark ? 'rgba(42, 26, 8, 0.92)' : 'rgba(60, 40, 16, 0.9)';
      for (i = 0; i < stars.length; i++) {
        var sx = ox + stars[i][1] * cell;
        var sy = oy + stars[i][0] * cell;
        ctx.beginPath();
        ctx.arc(sx, sy, Math.max(1.6, cell * 0.075), 0, Math.PI * 2);
        ctx.fill();
      }
      // 坐标：上方字母、左侧数字
      var fontSize = Math.max(9, Math.round(cell * 0.30));
      ctx.font = '500 ' + fontSize + 'px -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif';
      ctx.fillStyle = dark ? 'rgba(48, 30, 10, 0.62)' : 'rgba(74, 48, 22, 0.58)';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      var letters = 'ABCDEFGHJKLMNOPQRSTUVWXYZ';
      for (i = 0; i < size; i++) {
        var lx = ox + i * cell;
        var ly = oy - cell * 0.52;
        ctx.fillText(letters.charAt(i), lx, ly);
      }
      ctx.textAlign = 'right';
      for (i = 0; i < size; i++) {
        var num = size - i;
        ctx.fillText(String(num), ox - cell * 0.30, oy + i * cell);
      }
      boardView.bg = c;
    }

    function requestDraw() {
      if (disposed) return;
      if (boardView.raf) return;
      boardView.raf = window.requestAnimationFrame ? window.requestAnimationFrame(function () {
        boardView.raf = 0;
        drawBoard();
      }) : window.setTimeout(function () {
        boardView.raf = 0;
        drawBoard();
      }, 16);
    }

    function displayedState() {
      if (!state) return null;
      if (reviewIndex < 0) return state;
      var key = reviewIndex + '/' + state.moves.length + '/' + state.size + '/' + state.rules;
      if (viewCache.key === key) return viewCache.state;
      var moves = state.moves.slice(0, reviewIndex + 1);
      var vs = Core.replay(Core.stateOptions(state), moves, {});
      vs.status = reviewIndex >= state.moves.length - 1 ? state.status : 'active';
      viewCache.key = key;
      viewCache.state = vs;
      return vs;
    }

    function pointPixel(row, col) {
      return { x: boardView.ox + col * boardView.cell, y: boardView.oy + row * boardView.cell };
    }

    function drawStone(ctx, color, row, col, alpha, scale) {
      var cell = boardView.cell;
      var p = pointPixel(row, col);
      var sprite = color === BLACK ? boardView.blackSprite : boardView.whiteSprite;
      var theCtx = ctx || boardView.ctx;
      if (!sprite) return;
      var size = cell * 1.06 * (scale || 1);
      theCtx.save();
      if (alpha !== undefined && alpha < 1) theCtx.globalAlpha = alpha;
      theCtx.drawImage(sprite, p.x - size / 2, p.y - size / 2, size, size);
      theCtx.restore();
    }

    function drawBoard() {
      var ctx = boardView.ctx;
      if (!ctx || !boardView.px) return;
      var px = boardView.px;
      var dpr = boardView.dpr;
      var view = displayedState();
      var size = view ? view.size : boardView.size;
      if (size !== boardView.size) {
        boardView.size = size;
        boardView.px = 0;
        layoutBoard();
        return;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, px, px);
      if (boardView.bg) ctx.drawImage(boardView.bg, 0, 0, px, px);
      if (!view) return;
      var i;
      var scoring = view.status === 'scoring' || view.status === 'finished';
      var preview = scoring ? getScoringPreview(view) : null;
      var deadMask = preview ? preview.deadMask : null;

      // 数目点
      if (preview && preview.territory) {
        for (i = 0; i < preview.territory.length; i++) {
          if (preview.territory[i] === 0) continue;
          if (view.board[i] !== 0) continue;
          var tr = (i / size) | 0;
          var tc = i % size;
          var tp = pointPixel(tr, tc);
          ctx.save();
          ctx.globalAlpha = 0.55;
          ctx.fillStyle = preview.territory[i] === BLACK ? '#1f2937' : '#ffffff';
          ctx.strokeStyle = preview.territory[i] === BLACK ? 'rgba(255,255,255,0.45)' : 'rgba(31,41,55,0.55)';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.arc(tp.x, tp.y, Math.max(1.8, boardView.cell * 0.105), 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
          ctx.restore();
        }
      }

      // 棋子（动画缩放）
      var anim = boardView.anim;
      var animT = 1;
      if (anim && !reduceMotion) {
        animT = clamp((now() - anim.start) / 180, 0, 1);
        if (animT >= 1) {
          boardView.anim = null;
          anim = null;
        }
      } else if (anim) {
        boardView.anim = null;
        anim = null;
      }
      for (i = 0; i < view.board.length; i++) {
        var color = view.board[i];
        if (!color) continue;
        var row = (i / size) | 0;
        var col = i % size;
        if (anim && i === anim.placed) {
          drawStone(ctx, color, row, col, 0.35 + animT * 0.65, 0.68 + animT * 0.32);
        } else {
          drawStone(ctx, color, row, col, 1, 1);
        }
      }
      // 提子淡出
      if (anim && anim.captured && anim.captured.length) {
        for (i = 0; i < anim.captured.length; i++) {
          var cap = anim.captured[i];
          drawStone(ctx, cap.color, (cap.idx / size) | 0, cap.idx % size, 1 - animT, 1);
        }
      }
      // 死子标记
      if (deadMask) {
        for (var key in deadMask) {
          if (!Object.prototype.hasOwnProperty.call(deadMask, key)) continue;
          var di = Number(key);
          if (!deadMask[key] || view.board[di] === 0) continue;
          var dp = pointPixel((di / size) | 0, di % size);
          var r = boardView.cell * 0.26;
          ctx.save();
          ctx.strokeStyle = '#dc2626';
          ctx.lineWidth = Math.max(2, boardView.cell * 0.075);
          ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.moveTo(dp.x - r, dp.y - r);
          ctx.lineTo(dp.x + r, dp.y + r);
          ctx.moveTo(dp.x + r, dp.y - r);
          ctx.lineTo(dp.x - r, dp.y + r);
          ctx.stroke();
          ctx.restore();
        }
      }
      // 手数
      if (opts.showNumbers && !scoring && view.moves) {
        var limit = reviewIndex >= 0 ? reviewIndex + 1 : view.moves.length;
        var fontSize = Math.max(8, Math.round(boardView.cell * 0.30));
        ctx.save();
        ctx.font = '600 ' + fontSize + 'px -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        for (i = 0; i < limit && i < view.moves.length; i++) {
          var mv = view.moves[i];
          if (mv.pass) continue;
          var idx = mv.row * size + mv.col;
          if (!view.board[idx]) continue;
          var mp = pointPixel(mv.row, mv.col);
          ctx.fillStyle = mv.color === BLACK ? 'rgba(255,255,255,0.92)' : 'rgba(30,30,30,0.88)';
          ctx.fillText(String(i + 1), mp.x, mp.y + 0.5);
        }
        ctx.restore();
      }
      // 最后一手
      var last = null;
      if (reviewIndex >= 0 && view.moves.length) last = view.moves[view.moves.length - 1];
      else if (state && state.lastMove) last = state.lastMove;
      if (last && !last.pass && view.board[last.row * size + last.col]) {
        var lp = pointPixel(last.row, last.col);
        ctx.save();
        ctx.fillStyle = last.color === BLACK ? '#f8fafc' : '#0f172a';
        ctx.globalAlpha = 0.92;
        ctx.beginPath();
        ctx.arc(lp.x, lp.y, Math.max(2, boardView.cell * 0.095), 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
      // 提示
      if (boardView.hint) {
        var hp = pointPixel(boardView.hint.row, boardView.hint.col);
        ctx.save();
        ctx.strokeStyle = '#0d9488';
        ctx.lineWidth = Math.max(2, boardView.cell * 0.06);
        ctx.beginPath();
        ctx.arc(hp.x, hp.y, boardView.cell * 0.34, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
      // 复盘：标出当前这手的 AI 推荐点
      if (mode === 'review' && reviewReport && reviewReport.status === 'done') {
        var reviewBest = currentReviewResult();
        if (reviewBest && reviewBest.bestRow !== null && reviewBest.bestCol !== null && !reviewBest.pass) {
          var rbp = pointPixel(reviewBest.bestRow, reviewBest.bestCol);
          ctx.save();
          ctx.strokeStyle = '#d97706';
          ctx.lineWidth = Math.max(2, boardView.cell * 0.055);
          ctx.setLineDash([Math.max(2, boardView.cell * 0.12), Math.max(2, boardView.cell * 0.09)]);
          ctx.beginPath();
          ctx.arc(rbp.x, rbp.y, boardView.cell * 0.33, 0, Math.PI * 2);
          ctx.stroke();
          ctx.restore();
        }
      }
      // 悬停 / 键盘光标
      var hover = boardView.hover;
      var canPlay = isBoardInputAllowed();
      if (hover && canPlay) {
        var hp2 = pointPixel(hover.row, hover.col);
        var occupied = view.board[hover.row * size + hover.col] !== 0;
        if (!occupied) {
          var legal = isLegalPoint(view, view.turn, hover.row, hover.col);
          if (legal) {
            drawStone(ctx, view.turn, hover.row, hover.col, 0.46, 1);
          } else {
            ctx.save();
            ctx.strokeStyle = 'rgba(220, 38, 38, 0.85)';
            ctx.lineWidth = Math.max(1.5, boardView.cell * 0.055);
            ctx.beginPath();
            ctx.arc(hp2.x, hp2.y, boardView.cell * 0.25, 0, Math.PI * 2);
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(hp2.x - boardView.cell * 0.12, hp2.y - boardView.cell * 0.12);
            ctx.lineTo(hp2.x + boardView.cell * 0.12, hp2.y + boardView.cell * 0.12);
            ctx.moveTo(hp2.x + boardView.cell * 0.12, hp2.y - boardView.cell * 0.12);
            ctx.lineTo(hp2.x - boardView.cell * 0.12, hp2.y + boardView.cell * 0.12);
            ctx.stroke();
            ctx.restore();
          }
        } else if (scoring && canToggleDead()) {
          ctx.save();
          ctx.strokeStyle = 'rgba(220, 38, 38, 0.75)';
          ctx.lineWidth = Math.max(1.5, boardView.cell * 0.05);
          ctx.beginPath();
          ctx.arc(hp2.x, hp2.y, boardView.cell * 0.30, 0, Math.PI * 2);
          ctx.stroke();
          ctx.restore();
        }
      }
      // 二次确认：第一下落子后画一个确认环，再点同一点才真正落子
      if (pendingConfirm && canPlay && view.status === 'active') {
        var pc = pointPixel(pendingConfirm.row, pendingConfirm.col);
        var pr = Math.max(2, boardView.cell * 0.31);
        ctx.save();
        ctx.strokeStyle = '#0d9488';
        ctx.lineWidth = Math.max(2, boardView.cell * 0.06);
        ctx.beginPath();
        ctx.arc(pc.x, pc.y, pr, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = '#0d9488';
        ctx.beginPath();
        ctx.arc(pc.x + pr * 0.78, pc.y - pr * 0.78, Math.max(2, boardView.cell * 0.08), 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
      if (boardView.cursor && boardView.keyboard) {
        var cp = pointPixel(boardView.cursor.row, boardView.cursor.col);
        ctx.save();
        ctx.strokeStyle = 'rgba(13, 148, 136, 0.95)';
        ctx.lineWidth = Math.max(1.5, boardView.cell * 0.05);
        ctx.strokeRect(cp.x - boardView.cell * 0.42, cp.y - boardView.cell * 0.42, boardView.cell * 0.84, boardView.cell * 0.84);
        ctx.restore();
      }
      // 动画继续
      if (anim) requestDraw();
    }

    function getScoringPreview(view) {
      if (finalScore) return finalScore;
      if (scoringPreview) return scoringPreview;
      if (view && view.status === 'scoring') {
        scoringPreview = Core.computeScore(view, Object.keys(deadSet));
        return scoringPreview;
      }
      return null;
    }

    function isLegalPoint(view, color, row, col) {
      if (!view || view.status !== 'active') return false;
      return Core.isLegal ? Core.isLegal(view, color, row, col) : true;
    }

    // ============ 对局输入 ============
    function currentMoveCount() {
      return state && state.moves ? state.moves.length : 0;
    }

    function isReviewing() {
      return reviewIndex >= 0;
    }

    function isScoring() {
      return !!state && (state.status === 'scoring' || (mode === 'room' && room && room.status === 'scoring'));
    }

    function myColor() {
      if (mode === 'solo') return opts.humanColor;
      if (mode === 'room') return currentMember && currentMember.color ? currentMember.color : 0;
      return 0;
    }

    function seatedPlayerCount() {
      if (!room) return 0;
      var list = room.members || [];
      var count = 0;
      for (var i = 0; i < list.length; i++) {
        if (list[i] && list[i].color) count += 1;
      }
      return count;
    }

    function isBoardInputAllowed() {
      if (!state || disposed || busy || isReviewing()) return false;
      if (state.status !== 'active') return false;
      if (mode === 'solo') return !aiThinking && state.turn === opts.humanColor;
      if (mode === 'local') return true;
      if (mode === 'room') {
        if (!room || room.status !== 'active') return false;
        if (!currentMember || !currentMember.color) return false;
        if (seatedPlayerCount() < 2) return false;
        return currentMember.color === state.turn;
      }
      return false;
    }

    function canToggleDead() {
      if (!state || state.status !== 'scoring') return false;
      if (mode === 'room') return !!(currentMember && currentMember.color);
      return mode === 'local' || mode === 'solo';
    }

    function canUndo() {
      if (!state || disposed || busy || isReviewing() || mode === 'review') return false;
      if (mode === 'room') {
        if (!(currentMember && currentMember.color && room && room.status === 'active')) return false;
        var last = state.moves.length ? state.moves[state.moves.length - 1] : null;
        return !!(last && last.color === currentMember.color);
      }
      return state.moves.length > 0 && state.status !== 'finished';
    }

    function canPass() {
      if (!state || disposed || busy || isReviewing()) return false;
      if (state.status !== 'active') return false;
      if (mode === 'solo') return !aiThinking && state.turn === opts.humanColor;
      if (mode === 'local') return true;
      if (mode === 'room') {
        return !!(currentMember && currentMember.color && room && room.status === 'active' && state.turn === currentMember.color && seatedPlayerCount() >= 2);
      }
      return false;
    }

    function canHint() {
      return (mode === 'solo' || mode === 'local' || mode === 'review') && state && state.status === 'active' &&
        !aiThinking && !isReviewing() && !analysisLoading &&
        !(reviewReport && reviewReport.status === 'running');
    }

    function hitTest(clientX, clientY) {
      if (!boardView.cell) return null;
      var rect = canvas.getBoundingClientRect();
      var x = clientX - rect.left;
      var y = clientY - rect.top;
      var col = Math.round((x - boardView.ox) / boardView.cell);
      var row = Math.round((y - boardView.oy) / boardView.cell);
      var size = state ? state.size : boardView.size;
      if (row < 0 || col < 0 || row >= size || col >= size) return null;
      var p = pointPixel(row, col);
      var dx = x - p.x;
      var dy = y - p.y;
      if (Math.sqrt(dx * dx + dy * dy) > boardView.cell * 0.62) return null;
      return { row: row, col: col };
    }

    function attemptPlay(row, col) {
      if (!state) return;
      if (isScoring() || state.status === 'scoring') {
        toggleDead(row, col);
        return;
      }
      if (isReviewing()) {
        exitReview();
        return;
      }
      if (aiThinking) {
        showToast('电脑正在思考，请稍候');
        return;
      }
      if (!isBoardInputAllowed()) {
        if (mode === 'room' && currentMember && currentMember.color && state.turn !== currentMember.color) showToast('还没轮到你落子');
        else if (mode === 'solo' && state.turn !== opts.humanColor) showToast('请等电脑落子');
        else if (mode === 'room' && (!currentMember || !currentMember.color)) showToast('观战中，不能落子');
        return;
      }
      var color = mode === 'room' ? currentMember.color : state.turn;
      if (!isLegalPoint(state, color, row, col)) {
        pendingConfirm = null;
        requestDraw();
        showToast('这手棋不合规则');
        return;
      }
      if (opts.confirmMove && state.status === 'active') {
        if (!pendingConfirm || pendingConfirm.row !== row || pendingConfirm.col !== col) {
          pendingConfirm = { row: row, col: col };
          boardView.hover = pendingConfirm;
          boardView.keyboard = false;
          requestDraw();
          showToast('再点一次同一位置确认落子');
          announce('待确认：' + Core.pointLabel(state.size, row, col) + '，再点一次确认');
          return;
        }
        pendingConfirm = null;
      }
      invalidateAnalysis();
      boardView.hint = null;
      hideSheet();
      if (mode === 'room') {
        if (pendingPoint) return;
        pendingPoint = { row: row, col: col, color: color };
        busy = true;
        renderBoardBar();
        requestDraw();
        apiRequest('post', '/weiqi/rooms/' + roomCode + '/move', { row: row, col: col }).then(function (next) {
          pendingPoint = null;
          busy = false;
          applyRoomState(next);
        }, function (error) {
          pendingPoint = null;
          busy = false;
          setError(error.message || '落子失败');
          renderBoardBar();
          requestDraw();
          refreshRoom();
        });
        return;
      }
      var before = state.board.slice();
      var move = Core.applyMove(state, color, row, col);
      if (!move.ok) {
        showToast(move.error || '落子失败');
        return;
      }
      afterLocalMove(before, state.lastMove);
      render();
      if (state.status === 'scoring') {
        scoringPreview = Core.computeScore(state, []);
        deadSet = {};
        render();
      } else if (mode === 'solo' && state.turn !== opts.humanColor) {
        scheduleAi();
      }
    }

    function afterLocalMove(before, last) {
      var captured = [];
      if (last) {
        var placed = last.row * state.size + last.col;
        for (var i = 0; i < state.board.length; i++) {
          if (before[i] !== 0 && state.board[i] === 0) captured.push({ idx: i, color: before[i] });
        }
        boardView.anim = { start: now(), placed: placed, captured: captured };
      }
      playStoneSound(captured.length ? 'capture' : 'place');
      vibrate();
      pendingConfirm = null;
      invalidateAnalysis();
      boardView.hint = null;
      saveSessionSoon();
      announce(last ? ('落子 ' + Core.pointLabel(state.size, last.row, last.col)) : '停一手');
    }

    function toggleDead(row, col) {
      if (!canToggleDead() || !state) return;
      pendingConfirm = null;
      var idx = row * state.size + col;
      if (!state.board[idx]) return;
      if (mode === 'room') {
        var player = currentMember && currentMember.color;
        if (!player) return;
      }
      if (deadSet[idx]) delete deadSet[idx];
      else deadSet[idx] = true;
      scoringPreview = Core.computeScore(state, Object.keys(deadSet).map(Number));
      render();
      if (mode === 'room') scheduleDeadSync();
    }

    var deadSyncTimer = null;
    var deadSyncing = false;
    function scheduleDeadSync() {
      if (deadSyncTimer) clearTimeout(deadSyncTimer);
      deadSyncing = true;
      deadSyncTimer = setTimeout(function () {
        deadSyncTimer = null;
        if (!roomCode || !state || state.status !== 'scoring') {
          deadSyncing = false;
          return;
        }
        var list = [];
        for (var key in deadSet) {
          if (Object.prototype.hasOwnProperty.call(deadSet, key) && deadSet[key]) list.push(Number(key));
        }
        apiRequest('post', '/weiqi/rooms/' + roomCode + '/dead', { dead: list }).then(function (next) {
          deadSyncing = false;
          applyRoomState(next);
        }, function (error) {
          deadSyncing = false;
          setError(error.message || '标记死子失败');
          refreshRoom();
          renderScoring();
        });
      }, 160);
    }

    function passTurn() {
      if (!canPass()) {
        if (isReviewing()) showToast('复盘中不能停一手');
        return;
      }
      hideSheet();
      pendingConfirm = null;
      invalidateAnalysis();
      if (mode === 'room') {
        busy = true;
        render();
        apiRequest('post', '/weiqi/rooms/' + roomCode + '/pass', {}).then(function (next) {
          busy = false;
          applyRoomState(next);
        }, function (error) {
          busy = false;
          setError(error.message || '停一手失败');
          render();
        });
        return;
      }
      var color = state.turn;
      var result = Core.applyPass(state, color, {});
      if (!result.ok) {
        showToast(result.error || '停一手失败');
        return;
      }
      playStoneSound('pass');
      boardView.hint = null;
      if (state.status === 'scoring') {
        deadSet = {};
        scoringPreview = Core.computeScore(state, []);
      }
      saveSessionSoon();
      render();
      announce('停一手');
      if (mode === 'solo' && state.status === 'active' && state.turn !== opts.humanColor) scheduleAi();
    }

    function undoMove() {
      if (!state || isReviewing()) {
        if (isReviewing()) {
          exitReview();
          return;
        }
        return;
      }
      stopReviewPlay();
      invalidateAnalysis();
      pendingConfirm = null;
      if (mode === 'room') {
        if (!currentMember || !currentMember.color) {
          showToast('观战中不能悔棋');
          return;
        }
        busy = true;
        render();
        apiRequest('post', '/weiqi/rooms/' + roomCode + '/undo', {}).then(function (next) {
          busy = false;
          applyRoomState(next);
          showToast('已悔棋');
        }, function (error) {
          busy = false;
          setError(error.message || '悔棋失败');
          render();
        });
        return;
      }
      if (mode === 'solo') {
        // 白方玩家刚开局时，AI 的第一手没有可悔的余地
        if (opts.humanColor === WHITE && state.moves.length <= 1) {
          showToast('还没有可悔的棋');
          return;
        }
      }
      if (mode === 'solo') cancelAi();
      var steps = 1;
      if (mode === 'solo') {
        // 撤到玩家待落：AI 已应手撤 2 手；AI 思考中撤 1 手
        if (state.turn === opts.humanColor && state.moves.length >= 2) {
          var lastMove = state.moves[state.moves.length - 1];
          if (lastMove && lastMove.color !== opts.humanColor) steps = 2;
        } else if (state.turn !== opts.humanColor) {
          steps = 1;
        } else {
          steps = 1;
        }
      }
      var removed = 0;
      for (var i = 0; i < steps; i++) {
        if (Core.undo(state)) removed += 1;
      }
      deadSet = {};
      scoringPreview = null;
      finalScore = null;
      deadSyncing = false;
      if (deadSyncTimer) { clearTimeout(deadSyncTimer); deadSyncTimer = null; }
      boardView.hint = null;
      viewCache.key = '';
      if (removed) {
        playStoneSound();
        showToast('已悔棋');
        saveSessionSoon();
        render();
      }
      if (mode === 'solo' && state.status === 'active' && state.turn !== opts.humanColor) scheduleAi();
    }

    function resignGame() {
      if (!state || isReviewing() || state.status === 'finished') return;
      invalidateAnalysis();
      pendingConfirm = null;
      var color = mode === 'solo' ? opts.humanColor : mode === 'room' ? (currentMember && currentMember.color) : state.turn;
      if (!color) return;
      confirmAction('认输', '确定认输吗？这盘棋会立即结束。').then(function (yes) {
        if (!yes) return;
        if (mode === 'room') {
          busy = true;
          render();
          apiRequest('post', '/weiqi/rooms/' + roomCode + '/resign', {}).then(function (next) {
            busy = false;
            applyRoomState(next);
          }, function (error) {
            busy = false;
            setError(error.message || '认输失败');
            render();
          });
          return;
        }
        Core.resign(state, color);
        deadSet = {};
        scoringPreview = null;
        finalScore = null;
        saveSessionSoon();
        render();
        announce('认输');
      });
    }

    function enterReviewMode() {
      if (!state || !state.moves.length) return;
      if (mode !== 'solo' && mode !== 'local') return;
      cancelAi();
      stopReviewPlay();
      invalidateAnalysis();
      resetReviewReport();
      mode = 'review';
      room = null;
      roomCode = '';
      currentMember = null;
      importedMeta = null;
      reviewIndex = -1;
      pendingConfirm = null;
      scoringPreview = state.status === 'scoring' ? Core.computeScore(state, []) : null;
      tab = 'info';
      boardView.px = 0;
      boardView.hint = null;
      viewCache.key = '';
      showGame();
      render();
      layoutBoard();
      showToast('已进入复盘，可点「AI 复盘」逐手评级');
      announce('进入复盘');
    }

    function restartSameGame() {
      if (mode !== 'solo' && mode !== 'local') return;
      var kind = mode;
      startGame(kind);
    }

    function newGame() {
      if (mode === 'room') {
        if (!room || room.ownerId !== userId) {
          showToast('只有房主可以开新局');
          return;
        }
        confirmAction('开新局', '结束当前对局，重新开始一盘？').then(function (yes) {
          if (!yes) return;
          busy = true;
          render();
          apiRequest('post', '/weiqi/rooms/' + roomCode + '/reset', {}).then(function (next) {
            busy = false;
            applyRoomState(next);
          }, function (error) {
            busy = false;
            setError(error.message || '开新局失败');
            render();
          });
        });
        return;
      }
      if (mode === 'review') {
        showEntry();
        return;
      }
      confirmAction('开新局', '结束当前对局，重新开始一盘？').then(function (yes) {
        if (!yes) return;
        var kind = mode;
        startGame(kind);
      });
    }

    function startGame(kind) {
      cancelAi();
      stopReviewPlay();
      invalidateAnalysis();
      resetReviewReport();
      lastAutoSaveSig = '';
      kataGoCooldownUntil = 0;
      kataGoFailures = 0;
      pendingConfirm = null;
      var size = opts.size;
      var handicap = opts.handicap;
      var komi = handicap > 0 ? 0.5 : 7.5;
      state = Core.createState({ size: size, komi: komi, handicap: handicap, rules: 'chinese' });
      mode = kind;
      room = null;
      roomCode = '';
      currentMember = null;
      reviewIndex = -1;
      deadSet = {};
      scoringPreview = null;
      finalScore = null;
      importedMeta = null;
      pendingPoint = null;
      busy = false;
      tab = 'info';
      chatMessages = [];
      chatLoadedFor = '';
      unreadChat = 0;
      // 强制重建棋盘缓存：切换 9/13/19 路时画布像素尺寸可能不变，
      // 不能只改 boardView.size 就跳过 layoutBoard 的网格/贴图重建。
      boardView.px = 0;
      boardView.anim = null;
      boardView.hint = null;
      boardView.hover = null;
      boardView.cursor = { row: (size - 1) / 2 | 0, col: (size - 1) / 2 | 0 };
      viewCache.key = '';
      stopPolling();
      showGame();
      saveSettings();
      saveSessionSoon();
      setText(entryError, '');
      render();
      layoutBoard();
      if (mode === 'solo') checkKataGo(true);
      if (mode === 'solo' && state.turn !== opts.humanColor) scheduleAi();
      announce(kind === 'solo' ? '人机对弈开始' : '本地对局开始');
    }

    function showGame() {
      root.setAttribute('data-mode', 'game');
      entry.hidden = true;
      game.hidden = false;
      navActions.hidden = false;
      if (hostNavbar) {
        try {
          hostNavbar.setTitle(roomCode ? '围棋 · 房 ' + roomCode : '围棋');
          hostNavbar.setStatus(navStatus);
          hostNavbar.setActions([{ id: 'connection', element: connectionText }, { id: 'actions', element: navActions }]);
        } catch (e) {}
      }
      // 重新挂载被宿主导航栏搬走的节点前，确保 fallbackBar 仍可兜底
      layoutBoard();
      setTimeout(layoutBoard, 80);
    }

    function showEntry(keepSession) {
      cancelAi();
      stopReviewPlay();
      invalidateAnalysis();
      resetReviewReport();
      lastAutoSaveSig = '';
      pendingConfirm = null;
      stopPolling();
      state = null;
      room = null;
      roomCode = '';
      mode = '';
      currentMember = null;
      reviewIndex = -1;
      deadSet = {};
      scoringPreview = null;
      finalScore = null;
      importedMeta = null;
      pendingPoint = null;
      busy = false;
      toggleClass(root, 'is-busy', false);
      chatMessages = [];
      chatLoadedFor = '';
      unreadChat = 0;
      viewCache.key = '';
      tab = 'info';
      hideSheet();
      root.setAttribute('data-mode', 'entry');
      game.hidden = true;
      entry.hidden = false;
      navActions.hidden = true;
      setText(statusText, '');
      setText(subText, '');
      setText(connectionText, '');
      if (hostNavbar) {
        try {
          hostNavbar.setTitle('围棋');
          hostNavbar.setStatus(navStatus);
          hostNavbar.setActions([]);
        } catch (e) {}
      }
      if (!keepSession) clearSession();
      setText(entryError, '');
      renderEntry();
      render();
      requestDraw();
    }

    // ============ 渲染 ============
    function modeLabel() {
      if (mode === 'solo') return '人机 · ' + (opts.humanColor === BLACK ? '我执黑' : '我执白') + ' · ' + levelLabel(opts.aiLevel);
      if (mode === 'local') return '本地双人 · ' + (state && state.handicap > 1 ? '让子局 · 白先' : '黑先');
      if (mode === 'room') return roomCode ? '房间 ' + roomCode : '房间';
      if (mode === 'review') return '打谱复盘';
      return '';
    }

    function levelLabel(level) {
      return level === 1 ? '入门' : level === 3 ? '高手' : '进阶';
    }

    function render() {
      if (disposed) return;
      var inGame = !!state && mode !== '';
      root.setAttribute('data-mode', inGame ? 'game' : 'entry');
      entry.hidden = inGame;
      game.hidden = !inGame;
      if (!inGame) {
        renderEntry();
        return;
      }
      if (state && boardView.size !== state.size) layoutBoard();
      boardView.hint = mode === 'review' ? null : boardView.hint;
      renderNav();
      renderBoardBar();
      renderMobileActions();
      renderScoring();
      renderInfo();
      renderMoves();
      maybeAutoSaveFinishedGame();
      if (tab === 'chat') renderChat();
      updateTabs();
      requestDraw();
    }

    function renderNav() {
      navActions.hidden = false;
      var head;
      var sub = modeLabel();
      if (isReviewing()) {
        head = '复盘中 · 第 ' + (reviewIndex + 1) + ' 手';
        sub = (importedMeta && (importedMeta.blackName || importedMeta.whiteName))
          ? (importedMeta.blackName || '黑方') + ' vs ' + (importedMeta.whiteName || '白方')
          : modeLabel();
      } else if (mode === 'review') {
        head = '打谱复盘';
        sub = ((importedMeta && (importedMeta.blackName || importedMeta.whiteName))
          ? (importedMeta.blackName || '黑方') + ' vs ' + (importedMeta.whiteName || '白方')
          : 'SGF 棋谱') + ' · ' + currentMoveCount() + ' 手';
      } else if (state.status === 'scoring') {
        head = '数子';
        sub = '点掉死子后确认结果';
      } else if (state.status === 'finished') {
        head = state.resultText || '对局结束';
        sub = modeLabel();
      } else if (aiThinking) {
        head = '电脑思考中';
        sub = modeLabel();
      } else {
        head = '轮到' + (state.turn === BLACK ? '黑棋' : '白棋');
        sub = modeLabel();
        if (mode === 'room') {
          if (!currentMember) sub += ' · 观战';
          else if (!currentMember.color) sub += ' · 观战';
          else sub += currentMember.color === BLACK ? ' · 我执黑' : ' · 我执白';
        }
      }
      setText(statusText, head);
      setText(subText, sub);
      if (mode === 'room') setText(connectionText, realtime ? (realtime.isReady && realtime.isReady() ? '实时' : '连接中') : '同步');
      else setText(connectionText, '');
    }

    function renderBoardBar() {
      if (!state) return;
      var title;
      if (isReviewing()) title = '复盘中 · 第 ' + (reviewIndex + 1) + ' 手';
      else if (mode === 'review') title = '打谱复盘 · 共 ' + currentMoveCount() + ' 手';
      else if (state.status === 'scoring') title = '数子阶段';
      else if (state.status === 'finished') title = state.resultText || '对局结束';
      else if (aiThinking) title = '电脑思考中…';
      else title = '轮到' + (state.turn === BLACK ? '黑棋' : '白棋');
      setText(turnText, title);
      toggleClass(turnDot, 'is-white', state.turn === WHITE);
      toggleClass(turnDot, 'is-thinking', aiThinking);
      turnDot.hidden = state.status !== 'active' || isReviewing() || mode === 'review';
      var meta = '第 ' + currentMoveCount() + ' 手';
      meta += ' · 黑提 ' + state.captures[BLACK] + ' 子';
      meta += ' · 白提 ' + state.captures[WHITE] + ' 子';
      meta += ' · 贴 ' + Core.formatPoints(state.komi) + ' 目';
      setText(moveMeta, meta);
      setHidden(thinkingText, !aiThinking);
      if (aiThinking) {
        if (!aiTickTimer) {
          aiTickTimer = setInterval(function () {
            if (!aiThinking || disposed) {
              clearInterval(aiTickTimer);
              aiTickTimer = null;
              return;
            }
            renderBoardBar();
          }, 300);
        }
      } else if (aiTickTimer) {
        clearInterval(aiTickTimer);
        aiTickTimer = null;
      }
      if (aiThinking) {
        if (aiEngineKind === 'katago') {
          var elapsed = aiStartedAt ? Math.max(0, (now() - aiStartedAt) / 1000) : 0;
          setText(thinkingText, 'KataGo 思考中');
          setText(aiProgressText, '已用 ' + elapsed.toFixed(1) + ' 秒 · 服务器引擎');
        } else {
          var pct = aiProgressTotal > 0 ? Math.min(99, Math.round(aiProgress / aiProgressTotal * 100)) : 0;
          setText(thinkingText, (aiFallback ? '兼容模式 ' : 'AI ') + pct + '%');
          setText(aiProgressText, aiProgress > 0 ? ('已搜索 ' + aiProgress + ' 局面') : '正在读棋…');
        }
      } else {
        setText(aiProgressText, '');
      }
      var hint = '';
      if (mode === 'room') {
        if (!currentMember || !currentMember.color) hint = '观战中 · 可查看棋谱与聊天';
        else if (state.status === 'active' && state.turn !== currentMember.color) hint = '等待对手落子';
        else if (state.status === 'active') hint = '轮到你落子';
      } else if (mode === 'solo') {
        hint = aiThinking ? '电脑正在思考' : (state.turn === opts.humanColor ? '轮到你落子' : '等待电脑');
      } else if (mode === 'local') {
        hint = '同屏轮流 · 黑先白后';
      } else if (mode === 'review') {
        hint = '打谱模式 · 点棋谱或用方向键换手';
      }
      if (state.status === 'scoring') hint = '点选死子，确认后计算胜负';
      setText(coordHint, hint);
      toggleClass(boardWrap, 'is-my-turn', state.status === 'active' && !isReviewing() && isBoardInputAllowed());
      setDisabled(undoNavButton, !canUndo());
      setDisabled(leaveNavButton, false);
    }

    function renderMobileActions() {
      setDisabled(mobileUndo, !canUndo());
      setDisabled(mobilePass, !canPass());
      setText(mobilePass, state && state.status === 'scoring' ? '数子中' : '停一手');
    }

    function renderScoring() {
      var show = !!state && (state.status === 'scoring' || state.status === 'finished' && finalScore);
      setHidden(scoringBar, !show);
      if (!show) return;
      var preview = finalScore || scoringPreview;
      if (!preview && state.status === 'scoring') {
        preview = Core.computeScore(state, Object.keys(deadSet));
        scoringPreview = preview;
      }
      if (!preview) return;
      setText(scoreText, preview.resultText);
      var detail = '黑 ' + Core.formatPoints(preview.black) + '（子 ' + preview.blackStones + ' + 地 ' + preview.blackTerritory + '）';
      detail += ' · 白 ' + Core.formatPoints(preview.white) + '（子 ' + preview.whiteStones + ' + 地 ' + preview.whiteTerritory + ' + 贴 ' + Core.formatPoints(preview.komi) + '）';
      if (preview.rules === 'japanese') {
        detail += ' · 提子 黑 ' + state.captures[BLACK] + ' / 白 ' + state.captures[WHITE];
      }
      if (mode === 'room' && room) {
        var confirmed = isArray(room.confirmed) ? room.confirmed : [];
        var players = (room.members || []).filter(function (m) { return m.color; });
        detail += ' · 已确认 ' + confirmed.length + '/' + Math.max(1, players.length);
      }
      setText(scoreDetail, detail);
      if (state.status === 'finished') {
        confirmScoreButton.hidden = true;
        resumeGameButton.hidden = true;
      } else {
        confirmScoreButton.hidden = false;
        resumeGameButton.hidden = mode === 'review';
        var mine = mode === 'room' && room && isArray(room.confirmed) ? room.confirmed.indexOf(userId) !== -1 : false;
        var syncing = deadSyncing || deadSyncTimer !== null;
        setText(confirmScoreButton, mine ? '已确认，等待对手' : '确认结果');
        setDisabled(confirmScoreButton, mine || syncing || (mode === 'room' && (!currentMember || !currentMember.color)));
        setDisabled(resumeGameButton, syncing);
      }
    }

    function updateTabs() {
      tabChat.hidden = mode !== 'room';
      toggleClass(tabInfo, 'is-active', tab === 'info');
      toggleClass(tabMoves, 'is-active', tab === 'moves');
      toggleClass(tabChat, 'is-active', tab === 'chat');
      setHidden(panelInfo, tab !== 'info');
      setHidden(panelMoves, tab !== 'moves');
      setHidden(panelChat, tab !== 'chat');
      if (unreadChat > 0 && tab !== 'chat') {
        chatBadge.hidden = false;
        setText(chatBadge, unreadChat > 99 ? '99+' : String(unreadChat));
      } else {
        chatBadge.hidden = true;
      }
      mobileMenu.className = 'weiqi-mobile-btn' + (unreadChat > 0 && tab !== 'chat' ? ' has-badge' : '');
    }

    function playerName(color) {
      if (mode === 'room' && room) {
        var list = room.members || [];
        for (var i = 0; i < list.length; i++) {
          if (list[i].color === color) return list[i].net_name || list[i].netName || ('同学' + (i + 1));
        }
        return '等待加入';
      }
      if (mode === 'solo') {
        if (color === opts.humanColor) return '我';
        return '电脑（' + levelLabel(opts.aiLevel) + '）';
      }
      if (mode === 'review' && importedMeta) {
        return color === BLACK ? (importedMeta.blackName || '黑方') : (importedMeta.whiteName || '白方');
      }
      return color === BLACK ? '黑方' : '白方';
    }

    function renderInfo() {
      if (!panelInfo || !state) return;
      var infoScroll = panelInfo.scrollTop;
      clearChildren(panelInfo);
      var info = t('div', 'weiqi-info');

      // 双方
      var players = t('div', 'weiqi-players');
      var liveTurn = state.status === 'active' && mode !== 'review' && !isReviewing();
      [BLACK, WHITE].forEach(function (color) {
        var row = t('div', 'weiqi-player' + (liveTurn && state.turn === color ? ' is-turn' : ''));
        row.appendChild(t('span', 'weiqi-player-stone ' + (color === BLACK ? 'is-black' : 'is-white')));
        var body = t('div', 'weiqi-player-body');
        var name = playerName(color);
        var tags = [];
        if (mode === 'solo' && color === opts.humanColor) tags.push('我');
        if (mode === 'room' && currentMember && currentMember.color === color) tags.push('我');
        var nameRow = t('div', 'weiqi-player-name', null, [
          t('strong', null, { text: name }),
          tags.length ? t('span', 'weiqi-tag', { text: tags.join(' · ') }) : null
        ]);
        var sub = '提 ' + state.captures[color] + ' 子';
        if (mode === 'solo' && color !== opts.humanColor) sub += ' · ' + levelLabel(opts.aiLevel);
        body.appendChild(nameRow);
        body.appendChild(t('span', 'weiqi-player-sub', { text: sub }));
        row.appendChild(body);
        if (liveTurn && state.turn === color) {
          row.appendChild(t('span', 'weiqi-turn-pill', { text: '轮到' }));
        }
        players.appendChild(row);
      });
      info.appendChild(players);

      // 对局信息
      var facts = t('dl', 'weiqi-facts');
      addFact(facts, '棋盘', state.size + ' 路');
      addFact(facts, '贴目', Core.formatPoints(state.komi) + ' 目');
      addFact(facts, '规则', state.rules === 'japanese' ? '日韩数目' : '中国数子');
      if (state.handicap > 1) addFact(facts, '让子', state.handicap + ' 子');
      addFact(facts, '手数', currentMoveCount() + ' 手');
      if (mode === 'room') addFact(facts, '房间', roomCode || '—');
      if (mode === 'solo') addFact(facts, '棋力', levelLabel(opts.aiLevel));
      if (mode === 'solo') {
        var engineName;
        if (opts.katago && kataGoAvailable) {
          engineName = Date.now() < kataGoCooldownUntil ? 'KataGo（重试中）' : 'KataGo（服务器）';
        } else if (opts.katago && !kataGoChecked) engineName = '检测中…';
        else if (opts.katago && !kataGoAvailable) engineName = aiFallback ? '本地 AI（兼容模式）' : '本地 AI（线程）';
        else engineName = aiFallback ? '本地 AI（兼容模式）' : '本地 AI（线程）';
        addFact(facts, 'AI 引擎', engineName);
      } else if (mode === 'local' || mode === 'review') {
        addFact(facts, '分析引擎', opts.katago && kataGoAvailable
          ? (Date.now() < kataGoCooldownUntil ? 'KataGo（重试中）' : 'KataGo（服务器）')
          : '本地 AI');
      }
      info.appendChild(facts);

      // 终局结果放在显眼位置
      if (state.status === 'finished') {
        var doneBox = t('div', 'weiqi-finished');
        doneBox.appendChild(t('strong', null, { text: state.resultText || '对局结束' }));
        var doneBtns = t('div', 'weiqi-row weiqi-row-tight');
        doneBtns.appendChild(t('button', 'weiqi-btn weiqi-btn-sm', { type: 'button', 'data-action': 'copy-result', text: '复制结果' }));
        if (mode === 'solo' || mode === 'local') {
          doneBtns.appendChild(t('button', 'weiqi-btn weiqi-btn-sm', { type: 'button', 'data-action': 'enter-review', text: '复盘' }));
          doneBtns.appendChild(t('button', 'weiqi-btn weiqi-btn-sm weiqi-btn-primary', { type: 'button', 'data-action': 'restart-same', text: '再来一局' }));
        }
        doneBox.appendChild(doneBtns);
        info.appendChild(doneBox);
      }

      // AI 参考：只有本地/人机/打谱使用，联机不提供分析（避免作弊）
      if ((mode === 'solo' || mode === 'local' || mode === 'review') && (analysisLoading || analysis)) {
        var abox = t('div', 'weiqi-analysis');
        var ahead = t('div', 'weiqi-analysis-head', null, [
          t('strong', null, { text: 'AI 参考' }),
          t('button', 'weiqi-btn weiqi-btn-sm weiqi-btn-quiet', { type: 'button', 'data-action': 'clear-analysis', text: '清除' })
        ]);
        abox.appendChild(ahead);
        if (analysisLoading) {
          abox.appendChild(t('p', 'weiqi-analysis-loading', {
            text: kataGoUsable()
              ? 'KataGo 正在分析当前局面…'
              : (aiFallback ? '正在兼容模式下分析（主线程分片，稍慢但不会阻塞落子）…' : '正在分析当前局面，约 1–3 秒…')
          }));
        } else if (analysis) {
          var settled = analysis.engine === 'katago' || currentMoveCount() >= state.size * 2;
          var leadText;
          if (!settled) {
            leadText = '布局阶段';
          } else if (Math.abs(analysis.blackLead) < 0.5) {
            leadText = '双方接近';
          } else if (analysis.blackLead > 0) {
            leadText = '黑领先 ' + Core.formatPoints(analysis.blackLead) + ' 目';
          } else {
            leadText = '白领先 ' + Core.formatPoints(-analysis.blackLead) + ' 目';
          }
          abox.appendChild(t('p', 'weiqi-analysis-lead', {
            text: (analysis.engine === 'katago' ? 'KataGo 判断：' : 'AI 判断：') +
              (settled ? leadText + ' · ' : '') + '黑胜率 ' + Math.round((analysis.blackWin || 0) * 100) + '%'
          }));
          if (analysis.pass) {
            abox.appendChild(t('p', 'weiqi-analysis-note', { text: 'AI 认为当前可以停一手。' }));
          } else if (analysis.candidates.length) {
            var candList = t('div', 'weiqi-analysis-list');
            for (var ci = 0; ci < analysis.candidates.length; ci++) {
              var cand = analysis.candidates[ci];
              var cbtn = t('button', 'weiqi-analysis-cand', {
                type: 'button', 'data-action': 'analysis-move',
                'data-row': String(cand.row), 'data-col': String(cand.col)
              });
              cbtn.appendChild(t('span', 'weiqi-analysis-move', { text: Core.pointLabel(state.size, cand.row, cand.col) }));
              cbtn.appendChild(t('span', 'weiqi-analysis-pct', { text: '黑胜率 ' + Math.round((cand.winrate || 0) * 100) + '%' }));
              candList.appendChild(cbtn);
            }
            abox.appendChild(candList);
          }
          abox.appendChild(t('p', 'weiqi-analysis-note', {
            text: analysis.engine === 'katago'
              ? 'KataGo 服务器分析；点击候选可在棋盘标出。'
              : ((aiFallback ? '当前为主线程兼容模式；' : '') + 'AI 面积估计仅供参考；点击候选可在棋盘标出。')
          }));
        }
        info.appendChild(abox);
      }

      // 整盘 AI 复盘结果
      if (mode === 'review' && reviewReport && reviewReport.key === reviewKey()) {
        var rbox = t('div', 'weiqi-analysis weiqi-review-box');
        rbox.appendChild(t('div', 'weiqi-analysis-head', null, [
          t('strong', null, { text: 'AI 复盘' })
        ]));
        if (reviewReport.status === 'running') {
          rbox.appendChild(t('p', 'weiqi-analysis-loading', {
            text: '正在逐手分析 ' + reviewReport.done + '/' + reviewReport.total + '，可停止…'
          }));
          rbox.appendChild(buildReviewChart(reviewReport));
        } else if (reviewReport.status === 'done') {
          rbox.appendChild(t('p', 'weiqi-analysis-lead', { text: reviewSummaryText(reviewReport) }));
          rbox.appendChild(buildReviewChart(reviewReport));
          var currentResult = currentReviewResult();
          if (currentResult) {
            var currentIndex = reviewIndex >= 0 ? reviewIndex : state.moves.length - 1;
            var coord = currentResult.pass ? '停一手' : Core.pointLabel(state.size, currentResult.row, currentResult.col);
            rbox.appendChild(t('p', 'weiqi-analysis-note', {
              text: '第 ' + (currentIndex + 1) + ' 手 ' + coord + ' · ' + reviewGradeText(currentResult)
            }));
          }
          var worst = reviewWorstMoves(reviewReport);
          if (worst.length) {
            var worstBox = t('div', 'weiqi-review-worst');
            worstBox.appendChild(t('span', 'weiqi-review-worst-title', { text: '最大失误' }));
            for (var wi = 0; wi < worst.length; wi++) {
              var wr = worst[wi];
              var wcoord = wr.pass ? '停一手' : Core.pointLabel(state.size, wr.row, wr.col);
              worstBox.appendChild(t('button', 'weiqi-review-worst-item', {
                type: 'button',
                'data-action': 'review-goto',
                'data-index': String(wr.index),
                text: '第 ' + (wr.index + 1) + ' 手 ' + wcoord + ' · ' +
                  reviewGrade(wr.grade).label + ' · 损失 ' + (wr.loss * 100).toFixed(1) + '%'
              }));
            }
            rbox.appendChild(worstBox);
          }
          rbox.appendChild(t('p', 'weiqi-analysis-note', { text: '点棋谱任意一手查看评级；妙手要求是唯一明显好手，阈值较严。' }));
        } else if (reviewReport.status === 'error') {
          rbox.appendChild(t('p', 'weiqi-analysis-note', { text: '复盘中断：' + (reviewReport.error || '未知错误') }));
        }
        info.appendChild(rbox);
      }

      // 房间
      if (mode === 'room' && room) {
        var roomBox = t('div', 'weiqi-room-box');
        roomBox.appendChild(t('span', 'weiqi-room-label', { text: '房间码' }));
        roomBox.appendChild(t('strong', 'weiqi-room-code', { text: roomCode }));
        var roomBtns = t('div', 'weiqi-row weiqi-row-tight', null, [
          t('button', 'weiqi-btn weiqi-btn-sm', { type: 'button', 'data-action': 'copy-room', text: '复制' }),
          t('button', 'weiqi-btn weiqi-btn-sm', { type: 'button', 'data-action': 'share-room', text: '邀请' }),
          t('button', 'weiqi-btn weiqi-btn-sm weiqi-btn-quiet', { type: 'button', 'data-action': 'refresh-room', text: '刷新' })
        ]);
        if (room.ownerId === userId) {
          roomBtns.appendChild(t('button', 'weiqi-btn weiqi-btn-sm weiqi-btn-quiet', { type: 'button', 'data-action': 'close-room', text: '关闭' }));
        }
        roomBox.appendChild(roomBtns);
        var waiting = (room.members || []).filter(function (m) { return m.color; }).length < 2;
        if (waiting && room.status === 'active') roomBox.appendChild(t('p', 'weiqi-note', { text: '等待另一位玩家加入…' }));
        info.appendChild(roomBox);
        // 观战者
        var watchers = (room.members || []).filter(function (m) { return !m.color; });
        if (watchers.length) {
          info.appendChild(t('p', 'weiqi-note', { text: '观战 ' + watchers.length + ' 人' }));
        }
      }

      // 操作
      var actions = t('div', 'weiqi-actions-grid');
      actions.appendChild(makeActionButton('pass', '停一手', !canPass()));
      var resignDisabled = state.status !== 'active' || isReviewing() || mode === 'review' ||
        (mode === 'room' && (!currentMember || !currentMember.color || seatedPlayerCount() < 2));
      actions.appendChild(makeActionButton('resign', '认输', resignDisabled));
      if (mode === 'solo' || mode === 'local' || mode === 'review') actions.appendChild(makeActionButton('hint', 'AI 分析', !canHint()));
      if (mode === 'review') {
        var reviewRunning = !!(reviewReport && reviewReport.status === 'running');
        actions.appendChild(makeActionButton('review-analyze', reviewRunning ? '复盘分析中…' : 'AI 复盘', reviewRunning));
      } else if ((mode === 'solo' || mode === 'local') && state.status === 'finished') {
        actions.appendChild(makeActionButton('enter-review', '进入复盘', false));
      }
      if (state.moves.length) {
        actions.appendChild(makeActionButton('save-history', '存入棋谱库', false));
      }
      actions.appendChild(makeActionButton('undo', '悔棋', !canUndo()));
      if (mode === 'room') {
        actions.appendChild(makeActionButton('leave', '离开房间', false));
        if (room && room.ownerId === userId) actions.appendChild(makeActionButton('new-game', '开新局', false));
        else actions.appendChild(makeActionButton('new-game', '开新局', true));
      } else if (mode === 'review') {
        actions.appendChild(makeActionButton('leave', '返回入场', false));
      } else {
        actions.appendChild(makeActionButton('new-game', '开新局', false));
      }
      info.appendChild(actions);

      // 显示设置
      var prefs = t('div', 'weiqi-prefs');
      prefs.appendChild(makeToggle('显示手数', 'numbers', opts.showNumbers));
      prefs.appendChild(makeToggle('落子声音', 'sound', opts.sound));
      prefs.appendChild(makeToggle('落子二次确认', 'confirm', opts.confirmMove));
      if (mode !== 'room') prefs.appendChild(makeToggle('强力 AI（KataGo）', 'katago', opts.katago));
      info.appendChild(prefs);

      // 玩法
      var help = t('div', 'weiqi-help');
      help.appendChild(t('h3', null, { text: '怎么下' }));
      help.appendChild(t('p', null, { text: '黑先白后，轮流在交叉点落子；围住的空点就是你的地。' }));
      help.appendChild(t('p', null, { text: '双方连续各停一手后进入数子：点掉死子，确认结果。' }));
      help.appendChild(t('p', null, { text: '让子局由白棋先行，贴 0.5 目；普通局贴 7.5 目。' }));
      help.appendChild(t('p', null, { text: '本地/人机/打谱可点「AI 分析」看候选与形势；棋谱页可自动复盘；触屏默认二次确认落子。' }));
      help.appendChild(t('p', null, { text: '键盘：方向键选点 · 回车落子 · P 停一手 · U 悔棋 · 空格（复盘）播放/暂停 · Esc 退出复盘。' }));
      info.appendChild(help);

      panelInfo.appendChild(info);
      panelInfo.scrollTop = infoScroll;
    }

    function addFact(dl, label, value) {
      dl.appendChild(t('dt', null, { text: label }));
      dl.appendChild(t('dd', null, { text: value }));
    }

    function makeActionButton(action, label, disabled) {
      var b = t('button', 'weiqi-btn weiqi-btn-block weiqi-btn-quiet', { type: 'button', 'data-action': action, text: label });
      b.disabled = !!disabled;
      return b;
    }

    function makeToggle(label, key, on) {
      var b = t('button', 'weiqi-switch' + (on ? ' is-on' : ''), { type: 'button', 'data-action': 'toggle-' + key, 'aria-pressed': on ? 'true' : 'false' });
      b.appendChild(t('span', 'weiqi-switch-label', { text: label }));
      b.appendChild(t('span', 'weiqi-switch-knob'));
      return b;
    }

    function renderMoves() {
      if (!panelMoves || !state) return;
      var reportTick = reviewReport ? reviewReport.status + ':' + reviewReport.done : '';
      var key = state.moves.length + '/' + reviewIndex + '/' + mode + '/' + (state.status || '') + '/' + (reviewPlaying ? 'play' : 'stop') + '/' + reportTick;
      if (key === movesKey) return;
      movesKey = key;
      var listScroll = 0;
      var panelScroll = panelMoves.scrollTop;
      var oldList = panelMoves.querySelector('.weiqi-move-list');
      if (oldList) listScroll = oldList.scrollTop;
      clearChildren(panelMoves);
      var head = t('div', 'weiqi-moves-head');
      head.appendChild(t('h3', null, { text: '棋谱' }));
      head.appendChild(t('span', 'weiqi-moves-count', { text: currentMoveCount() + ' 手' }));
      panelMoves.appendChild(head);

      var toolbar = t('div', 'weiqi-moves-tools');
      toolbar.appendChild(t('button', 'weiqi-btn weiqi-btn-sm', { type: 'button', 'data-action': 'review-first', text: '⏮' }));
      toolbar.appendChild(t('button', 'weiqi-btn weiqi-btn-sm', { type: 'button', 'data-action': 'review-prev', text: '◀' }));
      toolbar.appendChild(t('button', 'weiqi-btn weiqi-btn-sm', { type: 'button', 'data-action': 'review-next', text: '▶' }));
      toolbar.appendChild(t('button', 'weiqi-btn weiqi-btn-sm', { type: 'button', 'data-action': 'review-last', text: '⏭' }));
      if (isReviewing()) toolbar.appendChild(t('button', 'weiqi-btn weiqi-btn-sm weiqi-btn-primary', { type: 'button', 'data-action': 'review-live', text: '返回当前' }));
      panelMoves.appendChild(toolbar);

      if (state.moves.length > 1) {
        panelMoves.appendChild(t('button', 'weiqi-btn weiqi-btn-sm weiqi-btn-block weiqi-moves-auto' + (reviewPlaying ? ' weiqi-btn-primary' : ''), {
          type: 'button', 'data-action': 'review-play', text: reviewPlaying ? '暂停复盘' : '自动复盘'
        }));
      }

      if (mode === 'review' && state.moves.length) {
        if (reviewReport && reviewReport.status === 'running') {
          var progress = t('div', 'weiqi-review-progress');
          progress.appendChild(t('span', null, { text: 'AI 复盘 ' + reviewReport.done + '/' + reviewReport.total }));
          progress.appendChild(t('button', 'weiqi-btn weiqi-btn-sm weiqi-btn-quiet', {
            type: 'button', 'data-action': 'review-cancel', text: '停止'
          }));
          panelMoves.appendChild(progress);
        } else {
          var reportLabel = reviewReport && reviewReport.status === 'done' ? '重新 AI 复盘' : 'AI 复盘（本手 / 俗手 / 妙手）';
          panelMoves.appendChild(t('button', 'weiqi-btn weiqi-btn-sm weiqi-btn-block weiqi-moves-auto', {
            type: 'button', 'data-action': 'review-analyze', text: reportLabel
          }));
        }
        if (reviewReport && reviewReport.status === 'done') {
          var summary = t('div', 'weiqi-review-summary');
          summary.appendChild(t('span', 'weiqi-review-summary-title', { text: 'AI 复盘' }));
          summary.appendChild(t('span', 'weiqi-review-summary-text', { text: reviewSummaryText(reviewReport) }));
          panelMoves.appendChild(summary);
        } else if (reviewReport && reviewReport.status === 'error') {
          panelMoves.appendChild(t('p', 'weiqi-analysis-note', { text: '复盘中断：' + (reviewReport.error || '未知错误') }));
        }
      }

      if (isReviewing()) {
        var banner = t('div', 'weiqi-review-banner', null, [
          t('span', null, { text: '复盘中 · 第 ' + (reviewIndex + 1) + ' 手' }),
          t('button', 'weiqi-btn weiqi-btn-sm', { type: 'button', 'data-action': 'review-live', text: '回到当前' })
        ]);
        panelMoves.appendChild(banner);
      }

      var list = t('div', 'weiqi-move-list');
      if (!state.moves.length) {
        list.appendChild(t('p', 'weiqi-empty', { text: '还没有落子' }));
      } else {
        var current = reviewIndex >= 0 ? reviewIndex : state.moves.length - 1;
        for (var i = 0; i < state.moves.length; i++) {
          var mv = state.moves[i];
          var row = t('button', 'weiqi-move-row' + (i === current ? ' is-current' : '') + (mv.color === BLACK ? ' is-black' : ' is-white'), {
            type: 'button', 'data-action': 'goto-move', 'data-index': String(i)
          });
          row.appendChild(t('span', 'weiqi-move-no', { text: String(i + 1) }));
          row.appendChild(t('span', 'weiqi-move-stone ' + (mv.color === BLACK ? 'is-black' : 'is-white')));
          row.appendChild(t('span', 'weiqi-move-coord', { text: mv.pass ? '停一手' : Core.pointLabel(state.size, mv.row, mv.col) }));
          if (reviewReport && reviewReport.results[i]) {
            var graded = reviewReport.results[i];
            var g = reviewGrade(graded.grade);
            row.appendChild(t('span', 'weiqi-grade ' + g.className, {
              text: g.short,
              title: reviewGradeText(graded)
            }));
          }
          list.appendChild(row);
        }
      }
      panelMoves.appendChild(list);
      if (oldList) list.scrollTop = listScroll;

      var tools = t('div', 'weiqi-row weiqi-row-tight weiqi-moves-export');
      tools.appendChild(t('button', 'weiqi-btn weiqi-btn-sm', { type: 'button', 'data-action': 'copy-sgf', text: '复制棋谱' }));
      tools.appendChild(t('button', 'weiqi-btn weiqi-btn-sm weiqi-btn-quiet', { type: 'button', 'data-action': 'export-sgf', text: '下载 SGF' }));
      panelMoves.appendChild(tools);
      panelMoves.scrollTop = panelScroll;
      var currentRow = list.querySelector('.weiqi-move-row.is-current');
      if (currentRow && currentRow.scrollIntoView) {
        try {
          currentRow.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        } catch (e) {}
      }
    }

    function renderChat() {
      if (!panelChat) return;
      var oldInput = panelChat.querySelector('[data-field="chat"]');
      var oldValue = oldInput ? oldInput.value : '';
      var hadFocus = !!(oldInput && document.activeElement === oldInput);
      clearChildren(panelChat);
      if (mode !== 'room') {
        panelChat.appendChild(t('p', 'weiqi-empty', { text: '进入联机房间后可以聊天' }));
        return;
      }
      var list = t('div', 'weiqi-chat-list', { 'data-role': 'chat-list' });
      if (!chatMessages.length) {
        list.appendChild(t('p', 'weiqi-empty', { text: '还没有人发言，聊聊这盘棋吧' }));
      } else {
        for (var i = 0; i < chatMessages.length; i++) {
          var msg = chatMessages[i];
          var mine = String(msg.userId || msg.user_id || '') === userId;
          var row = t('div', 'weiqi-chat-msg' + (mine ? ' is-me' : ''));
          row.appendChild(t('span', 'weiqi-chat-name', { text: (msg.netName || msg.net_name || '同学') + (mine ? '（我）' : '') }));
          row.appendChild(t('p', 'weiqi-chat-text', { text: msg.content || '' }));
          list.appendChild(row);
        }
      }
      panelChat.appendChild(list);
      var quickTexts = ['好棋', '加油', '再来一盘', '谢谢'];
      var quick = t('div', 'weiqi-chat-quick');
      for (var qi = 0; qi < quickTexts.length; qi++) {
        quick.appendChild(t('button', 'weiqi-chip', {
          type: 'button', 'data-action': 'chat-quick', 'data-text': quickTexts[qi], text: quickTexts[qi]
        }));
      }
      panelChat.appendChild(quick);
      var form = t('form', 'weiqi-chat-form', { 'data-role': 'chat-form' });
      var input = t('input', 'weiqi-input weiqi-chat-input', {
        type: 'text', maxlength: '200', autocomplete: 'off', enterkeyhint: 'send',
        placeholder: '说点什么…', 'data-field': 'chat'
      });
      if (oldValue) input.value = oldValue;
      var send = t('button', 'weiqi-btn weiqi-btn-primary weiqi-btn-sm', { type: 'submit', text: '发送' });
      form.appendChild(input);
      form.appendChild(send);
      form.addEventListener('submit', function (event) {
        event.preventDefault();
        sendChat(input);
      });
      panelChat.appendChild(form);
      chatKey = 'ready';
      if (hadFocus) {
        setTimeout(function () { try { input.focus(); } catch (e) {} }, 0);
      }
      if (tab === 'chat') {
        window.setTimeout(function () {
          if (list && list.parentNode) list.scrollTop = list.scrollHeight;
        }, 30);
      }
    }

    function renderEntry() {
      if (root.getAttribute('data-mode') === 'game') return;
      // 恢复卡片
      var session = readSession();
      if (session && session.mode) {
        resumeCard.hidden = false;
        var text;
        if (session.mode === 'room' && session.roomCode) {
          text = '上次在房间 ' + session.roomCode + ' 对弈';
        } else {
          text = '上次' + (session.mode === 'solo' ? '人机' : session.mode === 'local' ? '本地' : '') + '对局 · ' + (session.size || 9) + ' 路 · ' + ((session.moves || []).length) + ' 手';
        }
        setText(resumeText, text);
      } else {
        resumeCard.hidden = true;
      }
      // 同步分段控件
      syncSegments();
      handicapSelect.value = String(opts.handicap);
      renderHistory();
    }

    function syncSegments() {
      updateSegment(sizeSeg, opts.size);
      updateSegment(colorSeg, opts.humanColor);
      updateSegment(levelSeg, opts.aiLevel);
    }

    function updateSegment(wrap, value) {
      if (!wrap) return;
      var buttons = wrap.getElementsByTagName('button');
      for (var i = 0; i < buttons.length; i++) {
        var on = String(buttons[i].getAttribute('data-value')) === String(value);
        toggleClass(buttons[i], 'is-active', on);
        buttons[i].setAttribute('aria-pressed', on ? 'true' : 'false');
      }
    }

    // ============ AI ============
    function scheduleAi() {
      if (disposed || mode !== 'solo') return;
      if (aiTimer) clearTimeout(aiTimer);
      aiTimer = setTimeout(function () {
        aiTimer = null;
        if (disposed || mode !== 'solo') return;
        if (!state || state.status !== 'active' || state.turn === opts.humanColor) return;
        requestAiMove(0);
      }, 120);
    }

    function handleWorkerMessage(event) {
      var msg = event.data || {};
      if (pendingHint && msg.id === pendingHint.id) {
        if (msg.type === 'result') {
          var hint = pendingHint;
          pendingHint = null;
          try {
            hint.done(msg.result);
          } catch (e) {
            analysisLoading = false;
            renderInfo();
            showToast('AI 分析失败');
          }
        } else if (msg.type === 'error') {
          var hintFail = pendingHint;
          pendingHint = null;
          if (hintFail && hintFail.fail) hintFail.fail(msg.message);
          else { analysisLoading = false; renderInfo(); showToast('AI 分析失败'); }
        }
        return;
      }
      if (!aiContext || msg.id !== aiContext.id) return;
      if (msg.type === 'progress') {
        if (aiContext.onProgress) aiContext.onProgress(msg);
      } else if (msg.type === 'result') {
        var ctx = aiContext;
        aiContext = null;
        ctx.onDone(msg.result);
      } else if (msg.type === 'error') {
        var errCtx = aiContext;
        aiContext = null;
        if (errCtx.onError) errCtx.onError(msg.message || 'AI 引擎运行出错');
      }
    }

    function ensureAiWorker() {
      if (worker) return worker;
      var url = context.app && typeof context.app.assetUrl === 'function'
        ? context.app.assetUrl('frontend/ai-worker.js')
        : 'frontend/ai-worker.js';
      worker = new Worker(url);
      worker.onmessage = handleWorkerMessage;
      worker.onerror = function () {
        var ctx = aiContext;
        try { worker.terminate(); } catch (e) {}
        worker = null;
        aiFallback = true;
        if (pendingHint && pendingHint.fail) {
          var hintFail = pendingHint;
          pendingHint = null;
          hintFail.fail('AI 引擎加载失败');
        } else if (analysisLoading) {
          analysisLoading = false;
          renderInfo();
          showToast('AI 分析失败，请重试');
        }
        if (ctx) {
          aiContext = null;
          if (ctx.onError) ctx.onError('AI 引擎加载失败');
        }
      };
      return worker;
    }

    // 兜底着法：AI 引擎超时/崩溃/连续返回非法着法时，保证对局继续，而不是永远停在电脑回合。
    function pickFallbackPoint() {
      if (!state || state.status !== 'active') return null;
      var size = state.size;
      var color = state.turn;
      var last = state.lastMove;
      var best = null;
      var bestScore = -1e9;
      for (var row = 0; row < size; row++) {
        for (var col = 0; col < size; col++) {
          if (!Core.isLegal(state, color, row, col)) continue;
          var score = Math.random() * 8;
          if (last) {
            var dr = row - last.row;
            var dc = col - last.col;
            if (dr < 0) dr = -dr;
            if (dc < 0) dc = -dc;
            var dist = dr > dc ? dr : dc;
            if (dist === 1) score += 30;
            else if (dist === 2) score += 18;
            else if (dist === 3) score += 8;
          }
          var edge = row;
          if (col < edge) edge = col;
          if (size - 1 - row < edge) edge = size - 1 - row;
          if (size - 1 - col < edge) edge = size - 1 - col;
          if (edge === 2 || edge === 3) score += 16;
          if (score > bestScore) {
            bestScore = score;
            best = { row: row, col: col };
          }
        }
      }
      return best;
    }

    function applyFallbackAiMove(reason) {
      if (disposed || mode !== 'solo' || !state || state.status !== 'active') return false;
      if (state.turn === opts.humanColor) return false;
      cancelAi();
      pendingConfirm = null;
      boardView.hint = null;
      var point = pickFallbackPoint();
      var before = state.board.slice();
      if (!point) {
        var passResult = Core.applyPass(state, state.turn, {});
        if (!passResult.ok) return false;
        playStoneSound('pass');
      } else {
        var applied = Core.applyMove(state, state.turn, point.row, point.col);
        if (!applied.ok) {
          var fallbackPass = Core.applyPass(state, state.turn, {});
          if (!fallbackPass.ok) return false;
          playStoneSound('pass');
        } else {
          afterLocalMove(before, state.lastMove);
        }
      }
      if (state.status === 'scoring') {
        deadSet = {};
        scoringPreview = Core.computeScore(state, []);
      }
      saveSessionSoon();
      render();
      if (reason) showToast(reason + '，已自动走一手（可悔棋重试）');
      announce('电脑自动走了一手');
      return true;
    }

    function checkKataGo(force) {
      if (disposed) return;
      if (kataGoChecked && !force) return;
      apiRequest('get', '/weiqi/ai/status').then(function (info) {
        if (disposed) return;
        kataGoChecked = true;
        kataGoAvailable = !!(info && info.available);
        if (kataGoAvailable) {
          kataGoFailures = 0;
          kataGoCooldownUntil = 0;
          if (mode === 'solo') {
            apiRequest('post', '/weiqi/ai/warmup', {}).catch(function () {});
          }
        }
        if (state) renderInfo();
      }, function () {
        if (disposed) return;
        kataGoChecked = true;
        kataGoAvailable = false;
        if (state) renderInfo();
        // 网络/服务暂时不可用时定时重试，避免整局永远退回本地 AI。
        if (opts.katago && (mode === 'solo' || mode === 'local' || mode === 'review')) {
          scheduleKataGoRetry(15000);
        }
      });
    }

    function kataGoUsable() {
      return !!(opts.katago && kataGoAvailable && Date.now() >= kataGoCooldownUntil);
    }

    function scheduleKataGoRetry(wait) {
      if (kataRecoverTimer) clearTimeout(kataRecoverTimer);
      kataRecoverTimer = setTimeout(function () {
        kataRecoverTimer = null;
        if (disposed) return;
        checkKataGo(true);
      }, wait);
    }

    function noteKataGoFailure(message) {
      kataGoFailures += 1;
      var wait = Math.min(60000, 10000 * kataGoFailures);
      kataGoCooldownUntil = Date.now() + wait;
      if (message) {
        showToast(message + '，本手改用本地 AI，' + Math.round(wait / 1000) + ' 秒后自动重试');
      }
      scheduleKataGoRetry(wait);
      if (state) renderInfo();
    }

    function requestAiMove(retry) {
      if (disposed || mode !== 'solo' || !state) return;
      if (state.status !== 'active' || state.turn === opts.humanColor) return;
      aiSeq += 1;
      var id = aiSeq;
      activeAiId = id;
      aiThinking = true;
      aiProgress = 0;
      aiProgressTotal = 0;
      aiStartedAt = now();
      var useKataGo = !!(kataGoUsable() && mode === 'solo');
      aiEngineKind = useKataGo ? 'katago' : (aiFallback ? 'compat' : 'local');
      render();
      var request = {
        type: 'genmove',
        id: id,
        size: state.size,
        board: state.board.slice(),
        turn: state.turn,
        komi: state.komi,
        level: opts.aiLevel,
        koPoint: state.koPoint,
        passes: state.passCount,
        lastMove: state.lastMove ? state.lastMove.row * state.size + state.lastMove.col : -1,
        moveCount: state.moves.length
      };
      if (retry && retry.avoid && retry.avoid.length) request.avoid = retry.avoid;
      if (aiTimer) {
        clearTimeout(aiTimer);
        aiTimer = null;
      }
      if (useKataGo) {
        var kataWatchdog = setTimeout(function () {
          if (disposed || !aiThinking || activeAiId !== id) return;
          noteKataGoFailure('KataGo 响应超时');
          requestAiMove(retry);
        }, 30000);
        timers.push(kataWatchdog);
        var kataPayload = {
          size: state.size,
          komi: state.komi,
          handicap: state.handicap,
          turn: state.initialTurn,
          setup: (state.setup || []).map(function (s) {
            return { color: s.color, row: s.row, col: s.col };
          }),
          moves: state.moves.map(function (m) {
            return { color: m.color, row: m.row, col: m.col, pass: !!m.pass };
          }),
          level: opts.aiLevel,
          avoid: retry && retry.avoid ? retry.avoid.slice() : []
        };
        apiRequest('post', '/weiqi/ai/move', kataPayload).then(function (result) {
          clearTimeout(kataWatchdog);
          if (disposed || activeAiId !== id || mode !== 'solo') return;
          aiThinking = false;
          aiProgress = 0;
          aiProgressTotal = 0;
          if (!result) {
            applyFallbackAiMove('电脑没有返回着法');
            return;
          }
          try {
            applyAiResult(result, retry || { avoid: [] });
          } catch (e) {
            applyFallbackAiMove('电脑落子失败');
          }
        }, function () {
          clearTimeout(kataWatchdog);
          if (disposed || activeAiId !== id) return;
          aiThinking = false;
          noteKataGoFailure('KataGo 暂时不可用');
          requestAiMove(retry);
        });
        return;
      }
      // 超时兜底：取消搜索并自动走一手，绝不把对局留在电脑回合。
      var watchdog = setTimeout(function () {
        if (disposed || !aiThinking || activeAiId !== id) return;
        cancelAi();
        if (!applyFallbackAiMove('电脑思考超时')) {
          showToast('电脑思考超时，请悔棋或重开');
        }
      }, 6000);
      timers.push(watchdog);

      function onProgress(info) {
        if (disposed || activeAiId !== id) return;
        aiProgress = info.visits || 0;
        aiProgressTotal = info.total || 0;
        renderBoardBar();
      }

      function onDone(result) {
        clearTimeout(watchdog);
        if (disposed || activeAiId !== id || mode !== 'solo') return;
        aiThinking = false;
        aiProgress = 0;
        aiProgressTotal = 0;
        if (!result) {
          applyFallbackAiMove('电脑没有返回着法');
          return;
        }
        try {
          applyAiResult(result, retry || { avoid: [] });
        } catch (e) {
          applyFallbackAiMove('电脑落子失败');
        }
      }

      function onError(message) {
        clearTimeout(watchdog);
        if (disposed || activeAiId !== id) return;
        aiThinking = false;
        if (!applyFallbackAiMove(message || '电脑暂时不可用')) {
          showToast(message || '电脑落子失败');
          render();
        }
      }

      if (!aiFallback) {
        try {
          var currentWorker = ensureAiWorker();
          aiContext = { id: id, onProgress: onProgress, onDone: onDone, onError: onError };
          currentWorker.postMessage(request);
          return;
        } catch (e) {
          aiFallback = true;
          worker = null;
          aiContext = null;
        }
      }
      loadFallbackAi(function () {
        if (disposed) return;
        startMainAi(request, onProgress, onDone, onError);
      }, function () {
        onError('电脑暂时不可用');
      });
    }

    function startMainAi(request, onProgress, onDone, onError) {
      if (!window.WeiqiAICore || !window.WeiqiAICore.Session) {
        if (onError) onError('电脑暂时不可用');
        return;
      }
      if (mainAiCancel) {
        try { mainAiCancel(); } catch (e) {}
        mainAiCancel = null;
      }
      var session;
      try {
        session = new window.WeiqiAICore.Session(request);
      } catch (e) {
        if (onError) onError('电脑暂时不可用');
        return;
      }
      var cancelled = false;
      mainAiCancel = function () { cancelled = true; };
      if (session.shouldPassImmediately()) {
        var lead = session.staticLead(session.root.board);
        mainAiCancel = null;
        onDone({
          move: null,
          pass: true,
          visits: 0,
          winrate: 0.9,
          scoreLead: session.color === BLACK ? lead : -lead,
          elapsed: 0,
          candidates: []
        });
        return;
      }
      function slice() {
        if (cancelled || disposed) return;
        var finished = false;
        try {
          if (typeof session.runSlice === 'function') {
            finished = session.runSlice(10);
          } else {
            session.run(8);
            finished = session.done;
          }
        } catch (e) {
          if (onError) onError('AI 运行出错');
          return;
        }
        if (onProgress) onProgress({ visits: session.visits, total: session.cfg.visits, elapsed: now() - session.start });
        if (finished) {
          var result;
          try {
            result = session.result();
          } catch (e2) {
            if (onError) onError('AI 结果异常');
            return;
          }
          mainAiCancel = null;
          onDone(result);
          return;
        }
        setTimeout(slice, 0);
      }
      setTimeout(slice, 0);
    }

    function loadFallbackAi(callback, onFail) {
      if (window.WeiqiAICore) {
        callback();
        return;
      }
      if (aiFallbackLoading) {
        if (onFail) onFail();
        return;
      }
      aiFallbackLoading = true;
      var url = context.app && typeof context.app.assetUrl === 'function'
        ? context.app.assetUrl('frontend/ai-worker.js')
        : 'frontend/ai-worker.js';
      loadScript(url, function (ok) {
        aiFallbackLoading = false;
        if (ok && window.WeiqiAICore) callback();
        else {
          showToast('电脑暂时不可用');
          if (onFail) onFail();
        }
      });
    }

    function applyAiResult(result, retry) {
      if (!state || state.status !== 'active' || mode !== 'solo') return;
      if (!result) {
        applyFallbackAiMove('电脑没有返回着法');
        return;
      }
      var before = state.board.slice();
      if (result.pass) {
        var pass = Core.applyPass(state, state.turn, {});
        if (!pass.ok) {
          applyFallbackAiMove('电脑停一手失败');
          return;
        }
        playStoneSound('pass');
        if (state.status === 'scoring') {
          deadSet = {};
          scoringPreview = Core.computeScore(state, []);
        }
        saveSessionSoon();
        render();
        announce('电脑停一手');
        return;
      }
      var move = result.move;
      if (!move || !isFinite(move.row) || !isFinite(move.col)) {
        applyFallbackAiMove('电脑没有返回落点');
        return;
      }
      var applied = Core.applyMove(state, state.turn, move.row, move.col);
      if (!applied.ok) {
        var avoid = (retry.avoid || []).slice();
        avoid.push(move.row * state.size + move.col);
        if (avoid.length < 4) {
          requestAiMove({ avoid: avoid });
        } else {
          applyFallbackAiMove('电脑连续返回非法着法');
        }
        return;
      }
      afterLocalMove(before, state.lastMove);
      render();
      if (state.status === 'scoring') {
        deadSet = {};
        scoringPreview = Core.computeScore(state, []);
        render();
      }
    }

    function cancelAi() {
      if (aiTimer) { clearTimeout(aiTimer); aiTimer = null; }
      if (worker) {
        try { worker.postMessage({ type: 'cancel', id: activeAiId }); } catch (e) {}
        try { worker.terminate(); } catch (e) {}
        worker = null;
      }
      aiContext = null;
      if (mainAiCancel) {
        try { mainAiCancel(); } catch (e) {}
        mainAiCancel = null;
      }
      aiThinking = false;
      aiProgress = 0;
      aiProgressTotal = 0;
      activeAiId = 0;
      pendingHint = null;
      analysisSeq += 1;
      analysisLoading = false;
      analysis = null;
      if (analysisTimer) { clearTimeout(analysisTimer); analysisTimer = null; }
    }

    function positionFingerprint() {
      if (!state) return '';
      return state.size + ':' + state.moves.length + ':' + state.turn + ':' + state.passCount + ':' + state.koPoint;
    }

    function cancelHint() {
      if (!pendingHint && !analysisLoading) return;
      analysisSeq += 1;
      pendingHint = null;
      analysisLoading = false;
      if (analysisTimer) {
        clearTimeout(analysisTimer);
        analysisTimer = null;
      }
      if (worker) {
        try { worker.terminate(); } catch (e) {}
        worker = null;
      }
      if (mainAiCancel) {
        try { mainAiCancel(); } catch (e) {}
        mainAiCancel = null;
      }
    }

    // 局面一变就作废旧分析：位置相关的提示/候选不能跨手复用。
    function invalidateAnalysis() {
      if (pendingHint || analysisLoading) cancelHint();
      analysis = null;
      analysisLoading = false;
      boardView.hint = null;
    }

    function requestHint() {
      if (!canHint()) {
        if (isReviewing()) showToast('复盘中不能提示');
        return;
      }
      stopReviewPlay();
      invalidateAnalysis();
      analysisSeq += 1;
      var myId = analysisSeq;
      var fingerprint = positionFingerprint();
      var useKataGo = !!kataGoUsable();
      analysisLoading = true;
      if (analysisTimer) {
        clearTimeout(analysisTimer);
        analysisTimer = null;
      }
      analysisTimer = setTimeout(function () {
        analysisTimer = null;
        if (disposed || myId !== analysisSeq || !analysisLoading) return;
        cancelHint();
        renderInfo();
        showToast('AI 分析超时，请重试');
      }, useKataGo ? 15000 : 6000);
      renderInfo();
      var request = {
        type: 'genmove',
        id: 'hint-' + myId,
        size: state.size,
        board: state.board.slice(),
        turn: state.turn,
        komi: state.komi,
        level: 3,
        koPoint: state.koPoint,
        passes: state.passCount,
        lastMove: state.lastMove ? state.lastMove.row * state.size + state.lastMove.col : -1,
        moveCount: state.moves.length
      };
      showToast(useKataGo ? '正在用 KataGo 分析…' : '正在分析当前局面…');
      function done(result) {
        if (disposed || myId !== analysisSeq) return;
        if (analysisTimer) {
          clearTimeout(analysisTimer);
          analysisTimer = null;
        }
        if (!state || mode === 'room' || positionFingerprint() !== fingerprint) {
          analysisLoading = false;
          renderInfo();
          return;
        }
        analysisLoading = false;
        if (!result) {
          renderInfo();
          return;
        }
        var blackLead;
        var blackWin;
        if (result.engine === 'katago' || result.blackWinrate !== undefined || result.blackScoreLead !== undefined) {
          blackWin = Number(result.blackWinrate !== undefined ? result.blackWinrate : result.winrate);
          blackLead = Number(result.blackScoreLead !== undefined ? result.blackScoreLead : result.scoreLead);
          if (!isFinite(blackWin)) blackWin = 0.5;
          if (!isFinite(blackLead)) blackLead = 0;
        } else {
          var turn = state.turn;
          var lead = Number(result.scoreLead);
          if (!isFinite(lead)) lead = 0;
          blackLead = turn === BLACK ? lead : -lead;
          var wr = Number(result.winrate);
          if (!isFinite(wr)) wr = 0.5;
          blackWin = turn === BLACK ? wr : 1 - wr;
        }
        var candidates = [];
        var list = result.candidates || [];
        for (var i = 0; i < list.length && candidates.length < 3; i++) {
          var item = list[i];
          if (!item || !isFinite(item.row) || !isFinite(item.col)) continue;
          var cw;
          if (item.blackWinrate !== undefined) {
            cw = Number(item.blackWinrate);
          } else {
            cw = Number(item.winrate);
            if (!isFinite(cw)) cw = 0.5;
            if (state.turn === WHITE) cw = 1 - cw;
          }
          if (!isFinite(cw)) cw = 0.5;
          candidates.push({
            row: Number(item.row),
            col: Number(item.col),
            winrate: cw,
            visits: Number(item.visits) || 0
          });
        }
        analysis = {
          candidates: candidates,
          blackLead: blackLead,
          blackWin: blackWin,
          visits: Number(result.visits) || 0,
          pass: !!result.pass,
          engine: result.engine || 'local'
        };
        if (result.pass || !result.move) {
          boardView.hint = null;
          showToast('AI 建议停一手');
        } else {
          boardView.hint = { row: result.move.row, col: result.move.col };
          showToast('AI 推荐：' + Core.pointLabel(state.size, result.move.row, result.move.col));
        }
        requestDraw();
        renderInfo();
      }
      function fail(message) {
        if (myId !== analysisSeq) return;
        if (analysisTimer) {
          clearTimeout(analysisTimer);
          analysisTimer = null;
        }
        analysisLoading = false;
        renderInfo();
        showToast(message || '电脑暂时不可用');
      }
      function runLocalHint() {
        if (aiFallback || !worker) {
          pendingHint = null;
          loadFallbackAi(function () {
            startMainAi(request, null, done, fail);
          }, function () {
            fail('AI 分析不可用');
          });
          return;
        }
        pendingHint = { id: request.id, done: done, fail: fail };
        try {
          worker.postMessage(request);
        } catch (e) {
          pendingHint = null;
          loadFallbackAi(function () {
            startMainAi(request, null, done, fail);
          }, function () {
            fail('AI 分析不可用');
          });
        }
      }
      if (useKataGo) {
        var payload = {
          size: state.size,
          komi: state.komi,
          handicap: state.handicap,
          turn: state.initialTurn,
          setup: (state.setup || []).map(function (s) {
            return { color: s.color, row: s.row, col: s.col };
          }),
          moves: state.moves.map(function (m) {
            return { color: m.color, row: m.row, col: m.col, pass: !!m.pass };
          }),
          level: 3
        };
        apiRequest('post', '/weiqi/ai/analyze', payload).then(function (result) {
          if (disposed || myId !== analysisSeq) return;
          done(result);
        }, function () {
          if (disposed || myId !== analysisSeq) return;
          noteKataGoFailure('KataGo 分析不可用');
          runLocalHint();
        });
        return;
      }
      runLocalHint();
    }

    // ============ 联机 ============
    function apiRequest(method, path, body) {
      var data = context.data || {};
      if (typeof data.request === 'function') {
        return data.request({ url: path, method: method, data: body }).catch(function (error) {
          throw normalizeError(error);
        });
      }
      var client = data.api || context.api || null;
      if (!client) return Promise.reject(new Error('网络组件不可用'));
      var fn = client[method.toLowerCase()];
      if (typeof fn !== 'function') return Promise.reject(new Error('网络组件不可用'));
      var promise = method === 'GET' ? fn.call(client, path) : fn.call(client, path, body);
      return promise.then(function (response) {
        var payload = response && response.data ? response.data : response;
        if (payload && payload.data !== undefined) return payload.data;
        return payload;
      }).catch(function (error) {
        throw normalizeError(error);
      });
    }

    function normalizeError(error) {
      if (!error) return new Error('请求失败');
      var response = error.response;
      var data = response && response.data;
      var status = response && (response.status || response.statusCode);
      if (data && data.message) return new Error(data.message);
      if (status === 401) return new Error('登录已过期，请重新登录后再试');
      if (status === 403) return new Error('没有权限，请确认已登录');
      if (status >= 500) return new Error('服务器暂时不可用（' + status + '），请稍后重试');
      if (error.code === 'SDK_TIMEOUT') return new Error('请求超时，请重试');
      if (error.code === 'SDK_NETWORK_ERROR' || error.message === 'Network Error') return new Error('网络不可用，请检查连接');
      if (error.message && error.message !== 'Network Error') return error;
      return new Error('请求失败');
    }

    // 服务器重启/网络抖动时自动重试一次，避免一次失败就放弃。
    function apiRequestRetry(method, path, body, retries) {
      var left = retries === undefined ? 1 : retries;
      return apiRequest(method, path, body).catch(function (error) {
        var message = (error && error.message) || '';
        var transient = /网络|超时|Network|fetch|502|503|504/i.test(message);
        if (left > 0 && transient) {
          return new Promise(function (resolve) { setTimeout(resolve, 1200); }).then(function () {
            return apiRequestRetry(method, path, body, left - 1);
          });
        }
        throw error;
      });
    }

    function createRoom() {
      actionBusy(true);
      setText(entryError, '');
      apiRequestRetry('post', '/weiqi/rooms', {
        size: opts.size,
        handicap: opts.handicap,
        color: opts.humanColor === WHITE ? 'white' : 'black'
      }).then(function (next) {
        actionBusy(false);
        roomCode = next.roomCode;
        mode = 'room';
        applyRoomState(next);
        startPolling();
        loadChat();
      }, function (error) {
        actionBusy(false);
        setError('创建房间失败：' + (error.message || '请稍后重试'));
      });
    }

    function enterRoom(code, watch) {
      if (!/^\d{4,6}$/.test(code)) {
        setError('请输入 4 位房间码');
        return;
      }
      actionBusy(true);
      setText(entryError, '');
      var path = '/weiqi/rooms/' + code + (watch ? '/watch' : '/join');
      apiRequestRetry('post', path, {}).then(function (next) {
        actionBusy(false);
        roomCode = next.roomCode || code;
        mode = 'room';
        applyRoomState(next);
        startPolling();
        loadChat();
      }, function (error) {
        actionBusy(false);
        setError((watch ? '观战失败：' : '加入房间失败：') + (error.message || '请稍后重试'));
      });
    }

    function refreshRoom() {
      if (!roomCode || mode !== 'room') return;
      apiRequest('get', '/weiqi/rooms/' + roomCode).then(function (next) {
        if (next && next.roomCode) applyRoomState(next);
      }, function (error) {
        if (error && error.message && error.message.indexOf('不存在') !== -1) {
          showToast('房间已关闭');
          leaveRoom(true);
        }
      });
    }

    function startPolling() {
      stopPolling();
      pollTick = 0;
      pollTimer = setInterval(function () {
        if (disposed || mode !== 'room' || !roomCode) return;
        if (realtime && realtime.isReady && realtime.isReady()) return;
        pollTick += 1;
        refreshRoom();
        // 没有实时通道时，聊天每 4 次轮询（约 10 秒）补拉一次，避免对方发言永远收不到。
        if (pollTick % 4 === 0) loadChat();
      }, 2500);
    }

    function stopPolling() {
      if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    }

    function applyRoomState(next) {
      if (!next || !next.roomCode || disposed) return;
      // 状态版本保护：同一房间内，迟到的轮询响应（rev 更小）直接丢弃。
      if (room && room.roomCode === next.roomCode &&
          typeof room.rev === 'number' && typeof next.rev === 'number' &&
          next.rev < room.rev) {
        return;
      }
      // 只有「进入房间」或「rev 变化」才算真正的新状态；相同 rev 的轮询不能
      // 清掉待确认落子、AI 分析或复盘播放，否则联机时每 2.5 秒就会打断用户操作。
      var changed = mode !== 'room' || !room || room.roomCode !== next.roomCode ||
        (typeof room.rev === 'number' && typeof next.rev === 'number' ? room.rev !== next.rev : true);
      if (!changed) return;
      stopReviewPlay();
      pendingConfirm = null;
      if (analysis || analysisLoading || pendingHint) invalidateAnalysis();
      var previous = state;
      room = next;
      roomCode = next.roomCode;
      mode = 'room';
      var result = Core.replay({
        size: next.size,
        komi: next.komi,
        handicap: next.handicap,
        rules: next.rules || 'chinese'
      }, next.moves || [], {});
      result.status = next.status || 'active';
      result.winner = next.winner || 0;
      result.resultText = next.resultText || '';
      result.resultCode = next.resultCode || '';
      result.passCount = next.passes || 0;
      if (next.turn) result.turn = next.turn;
      state = result;
      currentMember = findMember(userId);
      if (changed) {
        deadSet = {};
        if (isArray(next.deadStones)) {
          for (var i = 0; i < next.deadStones.length; i++) deadSet[Number(next.deadStones[i])] = true;
        }
        var scoredFinish = next.status === 'finished' && next.resultCode && String(next.resultCode).indexOf('+R') === -1;
        if (result.status === 'scoring' || scoredFinish) {
          scoringPreview = Core.computeScore(state, Object.keys(deadSet).map(Number));
        } else {
          scoringPreview = null;
        }
        if (scoredFinish) finalScore = scoringPreview;
        else finalScore = null;
        pendingPoint = null;
        busy = false;
        deadSyncing = false;
      }
      if (reviewIndex >= state.moves.length) reviewIndex = -1;
      if (previous && next.moves && next.moves.length > previous.moves.length) {
        var last = next.moves[next.moves.length - 1];
        if (last && !last.pass) {
          var placed = last.row * state.size + last.col;
          var captured = [];
          for (var j = 0; j < state.board.length; j++) {
            if (previous.board[j] !== 0 && state.board[j] === 0) captured.push({ idx: j, color: previous.board[j] });
          }
          boardView.anim = { start: now(), placed: placed, captured: captured };
          playStoneSound(captured.length ? 'capture' : 'place');
          announce('落子 ' + Core.pointLabel(state.size, last.row, last.col));
        } else {
          announce('对方停一手');
        }
      }
      if (next.status === 'scoring') {
        // 刚进入数子：清除上一局的最终结果
        finalScore = null;
      }
      viewCache.key = '';
      setText(entryError, '');
      if (game.hidden) showGame();
      else if (hostNavbar) {
        try { hostNavbar.setTitle('围棋 · 房 ' + roomCode); } catch (e) {}
      }
      saveSessionSoon();
      render();
      if (chatLoadedFor !== roomCode) loadChat();
    }

    function findMember(id) {
      if (!room || !id) return null;
      var list = room.members || [];
      for (var i = 0; i < list.length; i++) {
        var mid = String(list[i].userId || list[i].user_id || '');
        if (mid === String(id)) return list[i];
      }
      return null;
    }

    function leaveRoom(silent) {
      var code = roomCode;
      if (!silent && code) {
        apiRequest('post', '/weiqi/rooms/' + code + '/leave', {}).catch(function () {});
      }
      stopPolling();
      showEntry();
      if (!silent) showToast('已离开房间');
    }

    function loadChat() {
      if (!roomCode || mode !== 'room') return;
      chatLoadedFor = roomCode;
      apiRequest('get', '/weiqi/rooms/' + roomCode + '/messages').then(function (data) {
        if (disposed || roomCode !== chatLoadedFor) return;
        chatMessages = (data && data.messages) || [];
        chatKey = '';
        if (tab === 'chat') renderChat();
        updateTabs();
      }, function () {
        // 聊天失败不影响对局
      });
    }

    function sendChat(input) {
      if (!roomCode || mode !== 'room') return;
      var text = String(input.value || '').replace(/^\s+|\s+$/g, '');
      if (!text) return;
      input.value = '';
      apiRequest('post', '/weiqi/rooms/' + roomCode + '/messages', { content: text }).then(function (message) {
        if (message) appendChat(message);
        else loadChat();
      }, function (error) {
        input.value = text;
        showToast(error.message || '发送失败');
      });
    }

    function sendChatText(text) {
      if (!roomCode || mode !== 'room') return;
      var content = String(text || '').replace(/^\s+|\s+$/g, '');
      if (!content) return;
      apiRequest('post', '/weiqi/rooms/' + roomCode + '/messages', { content: content }).then(function (message) {
        if (message) appendChat(message);
        else loadChat();
      }, function (error) {
        showToast(error.message || '发送失败');
      });
    }

    function resultSummary() {
      if (!state) return '';
      var text = state.resultText || '对局结束';
      if (mode === 'room' && room) {
        return state.size + ' 路 · ' + playerName(BLACK) + ' vs ' + playerName(WHITE) + ' · ' + text;
      }
      if (mode === 'solo') {
        return state.size + ' 路 · 我执' + (opts.humanColor === BLACK ? '黑' : '白') + ' · ' + text;
      }
      return state.size + ' 路 · ' + text;
    }

    function appendChat(message) {
      if (!message) return;
      for (var i = 0; i < chatMessages.length; i++) {
        if (chatMessages[i].id === message.id) return;
      }
      chatMessages.push(message);
      chatKey = '';
      if (tab === 'chat') unreadChat = 0;
      else unreadChat += 1;
      if (tab === 'chat') renderChat();
      updateTabs();
    }

    // ============ 复盘 ============
    function stopReviewPlay() {
      if (reviewTimer) {
        clearInterval(reviewTimer);
        reviewTimer = null;
      }
      reviewPlaying = false;
    }

    function toggleReviewPlay() {
      if (!state || state.moves.length < 2) return;
      if (reviewPlaying) {
        stopReviewPlay();
        render();
        return;
      }
      invalidateAnalysis();
      pendingConfirm = null;
      reviewPlaying = true;
      if (reviewIndex < 0 || reviewIndex >= state.moves.length - 1) reviewIndex = 0;
      viewCache.key = '';
      render();
      // 移动端抽屉会盖住棋盘：开始播放后收起，便于看棋；需要暂停时再打开「棋谱」。
      if (window.innerWidth <= 900) hideSheet();
      reviewTimer = setInterval(function () {
        if (disposed || !reviewPlaying || !state) {
          stopReviewPlay();
          return;
        }
        var next = (reviewIndex >= 0 ? reviewIndex : 0) + 1;
        if (next >= state.moves.length - 1) {
          reviewIndex = -1;
          viewCache.key = '';
          stopReviewPlay();
          render();
          showToast('复盘播放完毕');
          return;
        }
        reviewIndex = next;
        viewCache.key = '';
        render();
      }, 850);
    }

    function exitReview() {
      stopReviewPlay();
      if (reviewIndex < 0) return;
      invalidateAnalysis();
      pendingConfirm = null;
      reviewIndex = -1;
      viewCache.key = '';
      render();
      announce('已回到当前局面');
    }

    function gotoMove(index) {
      if (!state || index < 0 || index >= state.moves.length) return;
      stopReviewPlay();
      invalidateAnalysis();
      pendingConfirm = null;
      if (index >= state.moves.length - 1) {
        reviewIndex = -1;
      } else {
        reviewIndex = index;
      }
      viewCache.key = '';
      render();
      announce('第 ' + (index + 1) + ' 手');
    }

    function stepReview(delta) {
      if (!state || !state.moves.length) return;
      stopReviewPlay();
      invalidateAnalysis();
      pendingConfirm = null;
      var current = reviewIndex >= 0 ? reviewIndex : state.moves.length - 1;
      var next = current + delta;
      if (next < 0) next = 0;
      if (next >= state.moves.length - 1) {
        reviewIndex = -1;
      } else {
        reviewIndex = next;
      }
      viewCache.key = '';
      render();
    }

    function reviewFirst() {
      if (!state || !state.moves.length) return;
      stopReviewPlay();
      invalidateAnalysis();
      pendingConfirm = null;
      reviewIndex = 0;
      viewCache.key = '';
      render();
    }

    function reviewLast() {
      stopReviewPlay();
      invalidateAnalysis();
      pendingConfirm = null;
      reviewIndex = -1;
      viewCache.key = '';
      render();
    }

    // ============ 整盘 AI 复盘：本手 / 俗手 / 妙手 ============

    var REVIEW_GRADES = {
      brilliant: { label: '妙手', short: '妙', className: 'is-brilliant' },
      proper: { label: '本手', short: '本', className: 'is-proper' },
      vulgar: { label: '俗手', short: '俗', className: 'is-vulgar' },
      mistake: { label: '失误', short: '失', className: 'is-mistake' },
      blunder: { label: '恶手', short: '恶', className: 'is-blunder' },
      unknown: { label: '未评', short: '—', className: 'is-unknown' }
    };

    function reviewGrade(grade) {
      return REVIEW_GRADES[grade] || REVIEW_GRADES.unknown;
    }

    function reviewGradeText(result) {
      if (!result) return '';
      var g = reviewGrade(result.grade);
      var text = g.label;
      if (result.loss > 0.0005) text += ' · 损失 ' + (result.loss * 100).toFixed(1) + '%';
      if (result.bestRow !== null && result.bestCol !== null) {
        text += ' · AI 推荐 ' + Core.pointLabel(state.size, result.bestRow, result.bestCol);
      }
      return text;
    }

    function reviewSummaryText(report) {
      if (!report) return '';
      var s = report.summary;
      var parts = [];
      if (s.brilliant) parts.push('妙手 ' + s.brilliant);
      parts.push('本手 ' + s.proper);
      if (s.vulgar) parts.push('俗手 ' + s.vulgar);
      if (s.mistake) parts.push('失误 ' + s.mistake);
      if (s.blunder) parts.push('恶手 ' + s.blunder);
      return parts.join(' · ');
    }

    function reviewKey() {
      if (!state) return '';
      var parts = [state.size, state.komi, state.handicap];
      for (var i = 0; i < state.moves.length; i++) {
        var m = state.moves[i];
        parts.push((m.color === BLACK ? 'b' : 'w') + (m.pass ? 'p' : (m.row * state.size + m.col)));
      }
      return parts.join('|');
    }

    function resetReviewReport() {
      reviewReportToken += 1;
      reviewReport = null;
    }

    function currentReviewResult() {
      if (!reviewReport || reviewReport.status !== 'done' || !state || !state.moves.length) return null;
      var index = reviewIndex >= 0 ? reviewIndex : state.moves.length - 1;
      return reviewReport.results[index] || null;
    }

    var REVIEW_GRADE_COLORS = {
      brilliant: '#d97706',
      proper: '#0d9488',
      vulgar: '#a16207',
      mistake: '#ea580c',
      blunder: '#dc2626'
    };

    function reviewWorstMoves(report) {
      var list = [];
      for (var i = 0; i < report.results.length; i++) {
        var r = report.results[i];
        if (r && (r.grade === 'mistake' || r.grade === 'blunder')) list.push(r);
      }
      list.sort(function (a, b) { return b.loss - a.loss; });
      return list.slice(0, 3);
    }

    function gotoReviewIndex(index) {
      if (!state) return;
      stopReviewPlay();
      invalidateAnalysis();
      pendingConfirm = null;
      reviewIndex = Math.max(-1, Math.min(state.moves.length - 1, index));
      viewCache.key = '';
      render();
    }

    // 复盘胜率曲线：黑胜率从下到上，彩色点表示每手评级，点曲线可跳转。
    function buildReviewChart(report) {
      var wrap = t('div', 'weiqi-winrate');
      var canvas = t('canvas', 'weiqi-winrate-canvas');
      var foot = t('div', 'weiqi-winrate-foot', null, [
        t('span', null, { text: '黑胜率' }),
        t('span', 'weiqi-winrate-tip', { text: '点曲线跳转' })
      ]);
      wrap.appendChild(canvas);
      wrap.appendChild(foot);

      function draw() {
        if (!canvas.parentNode) return;
        var cssW = wrap.clientWidth || 260;
        var cssH = 68;
        var dpr = window.devicePixelRatio || 1;
        canvas.width = Math.round(cssW * dpr);
        canvas.height = Math.round(cssH * dpr);
        canvas.style.width = cssW + 'px';
        canvas.style.height = cssH + 'px';
        var ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, cssW, cssH);
        ctx.fillStyle = 'rgba(148,163,184,0.10)';
        ctx.fillRect(0, 0, cssW, cssH);
        ctx.strokeStyle = 'rgba(148,163,184,0.45)';
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(0, cssH / 2);
        ctx.lineTo(cssW, cssH / 2);
        ctx.stroke();
        ctx.setLineDash([]);

        var positions = report.positions || [];
        var total = report.total || positions.length;
        if (total < 2) return;

        function xAt(i) { return (i / (total - 1)) * cssW; }
        function yAt(win) { return (1 - Math.max(0, Math.min(1, win))) * (cssH - 6) + 3; }

        var started = false;
        ctx.strokeStyle = '#3b82f6';
        ctx.lineWidth = 1.8;
        ctx.beginPath();
        for (var i = 0; i < positions.length; i++) {
          var pos = positions[i];
          if (!pos || !isFinite(pos.blackWin)) continue;
          var x = xAt(i);
          var y = yAt(pos.blackWin);
          if (!started) { ctx.moveTo(x, y); started = true; }
          else ctx.lineTo(x, y);
        }
        if (started) ctx.stroke();

        for (var k = 0; k < report.results.length; k++) {
          var r = report.results[k];
          var p = report.positions[k + 1];
          if (!r || !p || !isFinite(p.blackWin)) continue;
          ctx.fillStyle = REVIEW_GRADE_COLORS[r.grade] || '#94a3b8';
          ctx.beginPath();
          ctx.arc(xAt(k + 1), yAt(p.blackWin), 2.3, 0, Math.PI * 2);
          ctx.fill();
        }

        var current = reviewIndex >= 0 ? reviewIndex + 1 : positions.length - 1;
        if (current >= 0 && current < total) {
          ctx.strokeStyle = 'rgba(59,130,246,0.55)';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(xAt(current), 0);
          ctx.lineTo(xAt(current), cssH);
          ctx.stroke();
        }
      }

      canvas.addEventListener('click', function (e) {
        var rect = canvas.getBoundingClientRect();
        var total = report.total || 0;
        if (total < 2) return;
        var idx = Math.round(((e.clientX - rect.left) / Math.max(1, rect.width)) * (total - 1));
        idx = Math.max(0, Math.min(total - 1, idx));
        gotoReviewIndex(idx - 1);
      });
      if (window.requestAnimationFrame) window.requestAnimationFrame(draw);
      else setTimeout(draw, 0);
      return wrap;
    }

    // 用「着法前/后两个局面的黑胜率」估算这一手的损失；
    // 如果实战着法在候选里，直接用候选与最佳着法的胜率差，更准。
    function classifyReviewMove(index, prev, curr, move) {
      var mover = move.color;
      var posLoss = mover === BLACK ? prev.blackWin - curr.blackWin : curr.blackWin - prev.blackWin;
      var bestWin = null;
      var best = null;
      var i;
      for (i = 0; i < prev.candidates.length; i++) {
        var c = prev.candidates[i];
        if (!c || !isFinite(c.blackWinrate)) continue;
        var w = Number(c.blackWinrate);
        if (bestWin === null || (mover === BLACK ? w > bestWin : w < bestWin)) {
          bestWin = w;
          best = c;
        }
      }
      var played = null;
      if (!move.pass) {
        for (i = 0; i < prev.candidates.length; i++) {
          var p = prev.candidates[i];
          if (Number(p.row) === move.row && Number(p.col) === move.col) { played = p; break; }
        }
      }
      var loss = posLoss;
      if (played && bestWin !== null) {
        var pw = Number(played.blackWinrate);
        var direct = mover === BLACK ? bestWin - pw : pw - bestWin;
        if (isFinite(direct) && direct > -0.02) loss = direct;
      }
      if (!isFinite(loss) || loss < 0) loss = 0;
      var gap = 0;
      if (bestWin !== null) {
        for (i = 0; i < prev.candidates.length; i++) {
          var w2 = Number(prev.candidates[i].blackWinrate);
          if (!isFinite(w2)) continue;
          var diff = Math.abs(w2 - bestWin);
          if (diff > 0.005 && diff > gap) gap = diff;
        }
      }
      var isBest = !!(played && bestWin !== null && Math.abs(Number(played.blackWinrate) - bestWin) < 0.005);
      var grade;
      if (isBest && gap >= 0.08 && loss <= 0.01) grade = 'brilliant';
      else if (loss <= 0.015) grade = 'proper';
      else if (loss <= 0.06) grade = 'vulgar';
      else if (loss <= 0.15) grade = 'mistake';
      else grade = 'blunder';
      return {
        index: index,
        color: mover,
        row: move.row,
        col: move.col,
        pass: !!move.pass,
        grade: grade,
        loss: loss,
        bestRow: best ? Number(best.row) : null,
        bestCol: best ? Number(best.col) : null,
        bestWin: bestWin,
        playedWin: played ? Number(played.blackWinrate) : null
      };
    }

    function cancelReviewReport(silent) {
      reviewReportToken += 1;
      if (reviewReport && reviewReport.status === 'running') {
        reviewReport.status = 'error';
        reviewReport.error = '已停止';
        if (!silent) showToast('已停止复盘分析');
      }
      movesKey = '';
      renderMoves();
      renderInfo();
    }

    function startReviewReport() {
      if (mode !== 'review' || !state || !state.moves.length) return;
      var key = reviewKey();
      if (reviewReport && reviewReport.key === key && reviewReport.status === 'done') {
        showToast('本局已复盘完成：' + reviewSummaryText(reviewReport));
        return;
      }
      if (!kataGoUsable()) {
        showToast('整盘复盘需要服务器 KataGo');
        return;
      }
      reviewReportToken += 1;
      var token = reviewReportToken;
      reviewReport = {
        key: key,
        status: 'running',
        done: 0,
        total: state.moves.length + 1,
        positions: [],
        results: [],
        summary: { brilliant: 0, proper: 0, vulgar: 0, mistake: 0, blunder: 0, unknown: 0 },
        error: ''
      };
      movesKey = '';
      renderMoves();
      renderInfo();
      showToast('开始 AI 复盘：共 ' + state.moves.length + ' 手，可随时停止');
      step(0);

      function stale() {
        return disposed || token !== reviewReportToken || mode !== 'review' || !state || reviewKey() !== key;
      }

      function step(i) {
        if (stale()) return;
        var prefix = [];
        for (var k = 0; k < i; k++) {
          var m = state.moves[k];
          prefix.push({ color: m.color, row: m.row, col: m.col, pass: !!m.pass });
        }
        apiRequest('post', '/weiqi/ai/review', {
          size: state.size,
          komi: state.komi,
          handicap: state.handicap,
          turn: state.initialTurn,
          setup: (state.setup || []).map(function (s) {
            return { color: s.color, row: s.row, col: s.col };
          }),
          moves: prefix,
          level: 2
        }).then(function (result) {
          if (stale()) return;
          var blackWin = Number(result && result.blackWinrate);
          if (!isFinite(blackWin)) blackWin = 0.5;
          reviewReport.positions[i] = {
            blackWin: blackWin,
            candidates: (result && result.candidates) || []
          };
          reviewReport.done = i + 1;
          if (i > 0) {
            var prev = reviewReport.positions[i - 1];
            var curr = reviewReport.positions[i];
            var item = classifyReviewMove(i - 1, prev, curr, state.moves[i - 1]);
            reviewReport.results[i - 1] = item;
            reviewReport.summary[item.grade] += 1;
          }
          movesKey = '';
          renderMoves();
          renderInfo();
          if (i >= reviewReport.total - 1) {
            reviewReport.status = 'done';
            movesKey = '';
            renderMoves();
            renderInfo();
            showToast('AI 复盘完成：' + reviewSummaryText(reviewReport));
            return;
          }
          // 不要再人为加延迟：引擎本身是串行队列，这里多等 60ms
          // 只是在整盘复盘上白加几秒（50 手就是 3 秒）。
          setTimeout(function () { step(i + 1); }, 0);
        }, function (error) {
          if (stale()) return;
          var message = (error && error.message) || '复盘分析失败';
          if (/繁忙|频繁|busy|429/i.test(message)) {
            setTimeout(function () { step(i); }, 900);
            return;
          }
          reviewReport.status = 'error';
          reviewReport.error = message;
          movesKey = '';
          renderMoves();
          renderInfo();
          showToast('复盘中断：' + message);
        });
      }
    }

    // ============ 数子确认 ============
    function confirmScore() {
      if (!state || state.status !== 'scoring') return;
      invalidateAnalysis();
      pendingConfirm = null;
      if (mode === 'room') {
        if (!currentMember || !currentMember.color) return;
        busy = true;
        render();
        apiRequest('post', '/weiqi/rooms/' + roomCode + '/score/confirm', {}).then(function (next) {
          busy = false;
          applyRoomState(next);
          showToast('已确认，等待对手');
        }, function (error) {
          busy = false;
          setError(error.message || '确认失败');
          render();
        });
        return;
      }
      var preview = Core.computeScore(state, Object.keys(deadSet).map(Number));
      finalScore = preview;
      Core.finishByScore(state, preview);
      scoringPreview = preview;
      playStoneSound();
      saveSessionSoon();
      render();
      announce(preview.resultText);
    }

    function resumeGame() {
      if (!state || state.status !== 'scoring') return;
      invalidateAnalysis();
      pendingConfirm = null;
      if (mode === 'room') {
        busy = true;
        render();
        apiRequest('post', '/weiqi/rooms/' + roomCode + '/resume', {}).then(function (next) {
          busy = false;
          applyRoomState(next);
          showToast('继续对弈');
        }, function (error) {
          busy = false;
          setError(error.message || '继续对弈失败');
          render();
        });
        return;
      }
      Core.resume(state);
      deadSet = {};
      scoringPreview = null;
      finalScore = null;
      saveSessionSoon();
      render();
      if (mode === 'solo' && state.turn !== opts.humanColor) scheduleAi();
    }

    // ============ SGF ============
    function sgfMeta() {
      var meta = {
        date: formatDate(),
        event: 'ClassIntra 围棋'
      };
      if (mode === 'review' && importedMeta) {
        meta.blackName = importedMeta.blackName || '黑方';
        meta.whiteName = importedMeta.whiteName || '白方';
      } else if (mode === 'room' && room) {
        meta.blackName = playerName(BLACK);
        meta.whiteName = playerName(WHITE);
      } else if (mode === 'solo') {
        meta.blackName = opts.humanColor === BLACK ? '我' : '电脑';
        meta.whiteName = opts.humanColor === WHITE ? '我' : '电脑';
      } else {
        meta.blackName = '黑方';
        meta.whiteName = '白方';
      }
      return meta;
    }

    function exportSGF(saveFile) {
      if (!state) return;
      var text = Core.toSGF(state, sgfMeta());
      if (saveFile) {
        try {
          var blob = new Blob([text], { type: 'application/x-go-sgf;charset=utf-8' });
          var url = URL.createObjectURL(blob);
          var a = document.createElement('a');
          a.href = url;
          a.download = 'weiqi-' + formatDate() + '.sgf';
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
          showToast('已导出 SGF');
        } catch (e) {
          showToast('导出失败，可尝试复制棋谱');
        }
        return;
      }
      copyText(text, '棋谱已复制');
    }

    function copyText(text, message) {
      function fallback() {
        try {
          var area = document.createElement('textarea');
          area.value = text;
          area.setAttribute('readonly', 'readonly');
          area.style.position = 'fixed';
          area.style.opacity = '0';
          document.body.appendChild(area);
          area.select();
          document.execCommand('copy');
          document.body.removeChild(area);
          if (message) showToast(message);
        } catch (e) {
          if (message) showToast('复制失败');
        }
      }
      try {
        if (context.system && context.system.clipboard && context.system.clipboard.write) {
          context.system.clipboard.write(text).then(function () {
            if (message) showToast(message);
          }, fallback);
        } else {
          fallback();
        }
      } catch (e) {
        fallback();
      }
    }

    function importSGFText(text) {
      try {
        var parsed = Core.parseSGF(text);
        if (!parsed || !parsed.state) throw new Error('棋谱解析失败');
        cancelAi();
        stopPolling();
        stopReviewPlay();
        invalidateAnalysis();
        resetReviewReport();
        pendingConfirm = null;
        state = parsed.state;
        state.status = 'active';
        mode = 'review';
        room = null;
        roomCode = '';
        currentMember = null;
        importedMeta = parsed.meta;
        reviewIndex = -1;
        deadSet = {};
        scoringPreview = null;
        finalScore = null;
        tab = 'info';
        boardView.px = 0;
        boardView.anim = null;
        boardView.hint = null;
        boardView.hover = null;
        deadSyncing = false;
        if (deadSyncTimer) { clearTimeout(deadSyncTimer); deadSyncTimer = null; }
        viewCache.key = '';
        showGame();
        render();
        layoutBoard();
        if (parsed.warnings && parsed.warnings.length) showToast(parsed.warnings[0]);
        else showToast('已载入棋谱：' + state.moves.length + ' 手');
        announce('已载入棋谱');
      } catch (e) {
        setError(e.message || '棋谱解析失败');
      }
    }

    function pickSGF() {
      if (context.device && typeof context.device.filePicker === 'function') {
        context.device.filePicker({ accept: '.sgf,application/x-go-sgf,text/plain', multiple: false }).then(function (files) {
          if (!files || !files.length) return;
          readSGFFile(files[0]);
        }, function (error) {
          setError((error && error.message) || '选择文件失败');
        });
        return;
      }
      var input = document.createElement('input');
      input.type = 'file';
      input.accept = '.sgf,application/x-go-sgf,text/plain';
      input.style.position = 'fixed';
      input.style.opacity = '0';
      document.body.appendChild(input);
      input.onchange = function () {
        if (input.files && input.files.length) readSGFFile(input.files[0]);
        document.body.removeChild(input);
      };
      input.click();
    }

    function readSGFFile(file) {
      try {
        var reader = new FileReader();
        reader.onload = function () {
          importSGFText(String(reader.result || ''));
        };
        reader.onerror = function () { setError('读取文件失败'); };
        reader.readAsText(file, 'utf-8');
      } catch (e) {
        setError('读取文件失败');
      }
    }

    // ============ 弹层 ============
    var modal = null;
    function openPasteModal() {
      closeModal();
      var textarea = t('textarea', 'weiqi-textarea', { rows: '8', placeholder: '(;GM[1]FF[4]SZ[19]…' });
      var mask = t('div', 'weiqi-modal-mask');
      var dialog = t('div', 'weiqi-modal', { role: 'dialog', 'aria-modal': 'true', 'aria-label': '粘贴 SGF 棋谱' }, [
        t('h3', null, { text: '粘贴 SGF 棋谱' }),
        t('p', 'weiqi-note', { text: '支持 SGF FF[4] 主线；变例会取第一条主线。' }),
        textarea,
        t('div', 'weiqi-modal-actions', null, [
          t('button', 'weiqi-btn', { type: 'button', 'data-action': 'close-modal', text: '取消' }),
          t('button', 'weiqi-btn weiqi-btn-primary', { type: 'button', 'data-action': 'paste-confirm', text: '载入' })
        ])
      ]);
      modal = t('div', 'weiqi-modal-wrap', null, [mask, dialog]);
      root.appendChild(modal);
      dialog.getElementsByTagName('button')[1].addEventListener('click', function () {
        var text = String(textarea.value || '').trim();
        if (!text) {
          showToast('请先粘贴棋谱');
          return;
        }
        closeModal();
        importSGFText(text);
      });
      dialog.getElementsByTagName('button')[0].addEventListener('click', closeModal);
      mask.addEventListener('click', closeModal);
      setTimeout(function () { try { textarea.focus(); } catch (e) {} }, 50);
    }

    function closeModal() {
      if (modal && modal.parentNode) modal.parentNode.removeChild(modal);
      modal = null;
    }

    function openSheet(which) {
      tab = which || 'info';
      side.className = 'weiqi-side is-open';
      sheetMask.hidden = false;
      updateTabs();
      renderChat();
    }

    function hideSheet() {
      side.className = 'weiqi-side';
      sheetMask.hidden = true;
    }

    function showToast(message, type) {
      if (!toast) return;
      setText(toast, message || '');
      toast.className = 'weiqi-toast is-visible' + (type === 'error' ? ' is-error' : '');
      if (toastTimer) clearTimeout(toastTimer);
      toastTimer = setTimeout(function () {
        toastTimer = null;
        toast.className = 'weiqi-toast';
      }, 2400);
    }

    function setError(message) {
      setText(entryError, message || '');
      if (message) showToast(message, 'error');
    }

    function announce(message) {
      setText(srOnly, message || '');
    }

    function confirmAction(title, message) {
      try {
        if (context.system && context.system.modal && context.system.modal.confirm) {
          return context.system.modal.confirm({ title: title, message: message, confirmText: '确定', cancelText: '取消' });
        }
      } catch (e) {}
      return Promise.resolve(window.confirm(message));
    }

    function actionBusy(on) {
      busy = !!on;
      toggleClass(root, 'is-busy', !!on);
    }

    // ============ 声音 / 触感 ============
    var audioCtx = null;
    function playStoneSound(kind) {
      if (!opts.sound) return;
      try {
        var Ctx = window.AudioContext || window.webkitAudioContext;
        if (!Ctx) return;
        if (!audioCtx) audioCtx = new Ctx();
        if (audioCtx.state === 'suspended' && audioCtx.resume) audioCtx.resume();
        var t0 = audioCtx.currentTime;
        var capture = kind === 'capture';
        var pass = kind === 'pass';
        var osc = audioCtx.createOscillator();
        var gain = audioCtx.createGain();
        osc.type = capture ? 'sawtooth' : 'triangle';
        var f0 = capture ? 520 : pass ? 460 : 760;
        var f1 = capture ? 150 : pass ? 300 : 240;
        var dur = capture ? 0.11 : pass ? 0.06 : 0.09;
        osc.frequency.setValueAtTime(f0, t0);
        osc.frequency.exponentialRampToValueAtTime(f1, t0 + dur * 0.7);
        gain.gain.setValueAtTime(0.0001, t0);
        gain.gain.exponentialRampToValueAtTime(capture ? 0.055 : 0.065, t0 + 0.004);
        gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start(t0);
        osc.stop(t0 + dur + 0.01);
        if (capture) {
          var osc2 = audioCtx.createOscillator();
          var gain2 = audioCtx.createGain();
          osc2.type = 'sine';
          osc2.frequency.setValueAtTime(300, t0 + 0.045);
          osc2.frequency.exponentialRampToValueAtTime(120, t0 + 0.12);
          gain2.gain.setValueAtTime(0.0001, t0 + 0.045);
          gain2.gain.exponentialRampToValueAtTime(0.045, t0 + 0.05);
          gain2.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.13);
          osc2.connect(gain2);
          gain2.connect(audioCtx.destination);
          osc2.start(t0 + 0.045);
          osc2.stop(t0 + 0.14);
        }
      } catch (e) {}
    }

    function vibrate() {
      try {
        if (context.device && typeof context.device.vibrate === 'function') context.device.vibrate(8);
        else if (navigator.vibrate) navigator.vibrate(8);
      } catch (e) {}
    }

    // ============ 存储 ============
    function readSettings() {
      var fallback = { size: 9, aiLevel: 2, humanColor: BLACK, handicap: 0, sound: true, showNumbers: false, confirmMove: isTouchDevice(), katago: true };
      if (!storage) return fallback;
      try {
        var saved = storage.get('settings', null);
        if (!saved || typeof saved !== 'object') return fallback;
        var size = Number(saved.size);
        var level = Number(saved.aiLevel);
        var color = Number(saved.humanColor);
        var handicap = Number(saved.handicap);
        if ([9, 13, 19].indexOf(size) === -1) size = 9;
        if ([1, 2, 3].indexOf(level) === -1) level = 2;
        if (color !== BLACK && color !== WHITE) color = BLACK;
        if ([0, 2, 3, 4, 5, 6, 7, 8, 9].indexOf(handicap) === -1) handicap = 0;
        return {
          size: size,
          aiLevel: level,
          humanColor: color,
          handicap: handicap,
          sound: saved.sound !== false,
          showNumbers: !!saved.showNumbers,
          confirmMove: saved.confirmMove === undefined ? isTouchDevice() : !!saved.confirmMove,
          katago: saved.katago !== false
        };
      } catch (e) {
        return fallback;
      }
    }

    function saveSettings() {
      if (!storage) return;
      try {
        storage.set('settings', {
          size: opts.size,
          aiLevel: opts.aiLevel,
          humanColor: opts.humanColor,
          handicap: opts.handicap,
          sound: opts.sound,
          showNumbers: opts.showNumbers,
          confirmMove: opts.confirmMove,
          katago: opts.katago
        });
      } catch (e) {}
    }

    function readSession() {
      if (!storage) return null;
      try {
        var saved = storage.get('session', null);
        if (!saved || typeof saved !== 'object' || !saved.mode) return null;
        return saved;
      } catch (e) {
        return null;
      }
    }

    // ============ 本机棋谱库（替代文件导入/导出） ============
    var HISTORY_KEY = 'history';
    var HISTORY_LIMIT = 30;
    var lastAutoSaveSig = '';

    function readHistory() {
      if (!storage) return [];
      try {
        var list = storage.get(HISTORY_KEY, []);
        return Array.isArray(list) ? list : [];
      } catch (e) {
        return [];
      }
    }

    function writeHistory(list) {
      if (!storage) return;
      try { storage.set(HISTORY_KEY, list); } catch (e) {}
    }

    function compactSetup() {
      if (!state || !state.setup) return [];
      return state.setup.map(function (s) {
        return { color: s.color, row: s.row, col: s.col };
      });
    }

    function formatHistoryDate(ts) {
      try {
        var d = new Date(Number(ts) || Date.now());
        return (d.getMonth() + 1) + '-' + d.getDate() + ' ' +
          ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
      } catch (e) {
        return '';
      }
    }

    function historySignature(record) {
      var first = record.moves.length
        ? [record.moves[0].color, record.moves[0].pass ? 'p' : record.moves[0].row + ',' + record.moves[0].col].join('')
        : '';
      var lastMove = record.moves.length ? record.moves[record.moves.length - 1] : null;
      var last = lastMove
        ? [lastMove.color, lastMove.pass ? 'p' : lastMove.row + ',' + lastMove.col].join('')
        : '';
      return [record.size, record.komi, record.handicap, record.moves.length, first, last, record.status, record.resultText].join('|');
    }

    function buildHistoryRecord(source) {
      if (!state) return null;
      var kind = source || mode;
      var modeText = kind === 'room' ? '联机' : kind === 'solo' ? '人机' : '本地';
      var record = {
        id: 'g' + Date.now() + '-' + Math.floor(Math.random() * 1000),
        savedAt: Date.now(),
        source: kind,
        size: state.size,
        komi: state.komi,
        handicap: state.handicap,
        rules: state.rules,
        turn: state.initialTurn,
        setup: compactSetup(),
        moves: state.moves.map(function (m) {
          return { color: m.color, row: m.row, col: m.col, pass: !!m.pass };
        }),
        status: state.status,
        winner: state.winner || 0,
        resultText: state.resultText || '',
        resultCode: state.resultCode || '',
        humanColor: opts.humanColor,
        aiLevel: opts.aiLevel
      };
      record.label = record.size + ' 路 · ' + modeText +
        (record.resultText ? ' · ' + record.resultText : ' · ' + record.moves.length + ' 手');
      return record;
    }

    function saveGameToHistory(manual) {
      if (!state || !state.moves.length) {
        if (manual) showToast('还没有落子，无法保存');
        return false;
      }
      var record = buildHistoryRecord(mode);
      if (!record) return false;
      var sig = historySignature(record);
      var list = readHistory();
      var existingId = null;
      for (var i = 0; i < list.length; i++) {
        if (historySignature(list[i]) === sig) {
          existingId = list[i].id;
          list.splice(i, 1);
          break;
        }
      }
      if (existingId) record.id = existingId;
      list.unshift(record);
      if (list.length > HISTORY_LIMIT) list.length = HISTORY_LIMIT;
      writeHistory(list);
      lastAutoSaveSig = sig;
      renderHistory();
      if (manual) showToast(existingId ? '这盘棋已经在棋谱库' : '已存入棋谱库');
      return true;
    }

    function maybeAutoSaveFinishedGame() {
      if (!state || state.status !== 'finished' || !state.moves.length) return;
      if (mode !== 'solo' && mode !== 'local' && mode !== 'room') return;
      var record = buildHistoryRecord(mode);
      if (!record) return;
      var sig = historySignature(record);
      if (sig === lastAutoSaveSig) return;
      lastAutoSaveSig = sig;
      saveGameToHistory(false);
    }

    function renderHistory() {
      if (!historyList) return;
      clearChildren(historyList);
      var list = readHistory();
      if (!list.length) {
        historyList.appendChild(t('p', 'weiqi-empty', { text: '还没有棋谱。对局结束后会自动保存在这里。' }));
        return;
      }
      var shown = Math.min(list.length, 8);
      for (var i = 0; i < shown; i++) {
        var record = list[i];
        var row = t('div', 'weiqi-history-row');
        var main = t('button', 'weiqi-history-main', {
          type: 'button', 'data-action': 'open-history', 'data-id': record.id
        });
        main.appendChild(t('span', 'weiqi-history-label', { text: record.label || ((record.size || 9) + ' 路 · ' + (record.moves || []).length + ' 手') }));
        main.appendChild(t('span', 'weiqi-history-sub', { text: formatHistoryDate(record.savedAt) + ' · ' + ((record.moves || []).length) + ' 手' }));
        row.appendChild(main);
        row.appendChild(t('button', 'weiqi-btn weiqi-btn-sm weiqi-btn-quiet', {
          type: 'button', 'data-action': 'delete-history', 'data-id': record.id, text: '删除'
        }));
        historyList.appendChild(row);
      }
      if (list.length > shown) {
        historyList.appendChild(t('p', 'weiqi-note', { text: '仅显示最近 ' + shown + ' 盘，共 ' + list.length + ' 盘' }));
      }
      historyList.appendChild(t('div', 'weiqi-row weiqi-row-tight', null, [
        t('button', 'weiqi-btn weiqi-btn-sm weiqi-btn-quiet', { type: 'button', 'data-action': 'clear-history', text: '清空棋谱库' })
      ]));
    }

    function deleteHistoryGame(id) {
      confirmAction('删除棋谱', '删除后无法恢复，确定删除？').then(function (yes) {
        if (!yes) return;
        var list = readHistory().filter(function (record) { return record.id !== id; });
        writeHistory(list);
        renderHistory();
        showToast('已删除');
      });
    }

    function clearHistory() {
      confirmAction('清空棋谱库', '所有本机棋谱都会被删除，确定？').then(function (yes) {
        if (!yes) return;
        writeHistory([]);
        lastAutoSaveSig = '';
        renderHistory();
        showToast('棋谱库已清空');
      });
    }

    function openHistoryGame(id) {
      var list = readHistory();
      var record = null;
      for (var i = 0; i < list.length; i++) {
        if (list[i] && list[i].id === id) { record = list[i]; break; }
      }
      if (!record || !record.moves || !record.moves.length) {
        showToast('棋谱不存在或已损坏');
        return;
      }
      var replayed;
      try {
        replayed = Core.replay({
          size: Number(record.size) || 9,
          komi: record.komi === undefined ? 7.5 : Number(record.komi),
          handicap: Number(record.handicap) || 0,
          rules: record.rules === 'japanese' ? 'japanese' : 'chinese',
          setup: Array.isArray(record.setup) ? record.setup : [],
          turn: record.turn
        }, record.moves, {
          status: record.status === 'active' ? 'active' : 'finished',
          winner: record.winner || 0,
          resultText: record.resultText || '',
          resultCode: record.resultCode || ''
        });
      } catch (e) {
        showToast('棋谱数据异常');
        return;
      }
      if (replayed.invalidAt >= 0) {
        showToast('棋谱第 ' + (replayed.invalidAt + 1) + ' 手无法回放');
        return;
      }
      cancelAi();
      stopPolling();
      stopReviewPlay();
      invalidateAnalysis();
      resetReviewReport();
      pendingConfirm = null;
      state = replayed;
      mode = 'review';
      room = null;
      roomCode = '';
      currentMember = null;
      importedMeta = null;
      reviewIndex = -1;
      deadSet = {};
      scoringPreview = null;
      finalScore = null;
      tab = 'info';
      boardView.px = 0;
      boardView.anim = null;
      boardView.hint = null;
      boardView.hover = null;
      viewCache.key = '';
      showGame();
      render();
      layoutBoard();
      showToast('已打开棋谱：' + replayed.moves.length + ' 手');
      announce('已打开本机棋谱');
    }

    function saveSessionSoon() {
      if (saveTimer) clearTimeout(saveTimer);
      saveTimer = setTimeout(saveSessionNow, 280);
    }

    function saveSessionNow() {
      if (!storage) return;
      try {
        if (mode === 'room' && roomCode) {
          storage.set('session', { mode: 'room', roomCode: roomCode, savedAt: Date.now() });
        } else if ((mode === 'solo' || mode === 'local') && state) {
          storage.set('session', {
            mode: mode,
            size: state.size,
            komi: state.komi,
            handicap: state.handicap,
            moves: state.moves.map(function (m) { return { color: m.color, row: m.row, col: m.col, pass: !!m.pass }; }),
            humanColor: opts.humanColor,
            aiLevel: opts.aiLevel,
            status: state.status,
            winner: state.winner,
            resultText: state.resultText,
            resultCode: state.resultCode,
            savedAt: Date.now()
          });
        }
      } catch (e) {}
    }

    function clearSession() {
      if (!storage) return;
      try { storage.remove('session'); } catch (e) {}
    }

    function resumeSession() {
      var saved = readSession();
      if (!saved) return;
      if (saved.mode === 'room' && saved.roomCode) {
        enterRoom(String(saved.roomCode), false);
        return;
      }
      if (saved.mode !== 'solo' && saved.mode !== 'local') return;
      try {
        var options = {
          size: Number(saved.size) || 9,
          komi: saved.komi === undefined ? 7.5 : Number(saved.komi),
          handicap: Number(saved.handicap) || 0,
          rules: 'chinese'
        };
      var replayed = Core.replay(options, saved.moves || [], {});
      replayed.status = saved.status === 'finished' ? 'finished' : 'active';
      replayed.winner = saved.winner || 0;
      replayed.resultText = saved.resultText || '';
      replayed.resultCode = saved.resultCode || '';
      if (saved.status !== 'finished' && (saved.status === 'scoring' || replayed.passCount >= 2)) {
        replayed.status = 'scoring';
      }
        cancelAi();
        stopReviewPlay();
        invalidateAnalysis();
        resetReviewReport();
        pendingConfirm = null;
        state = replayed;
        mode = saved.mode;
        opts.humanColor = saved.humanColor === WHITE ? WHITE : BLACK;
        opts.aiLevel = saved.aiLevel >= 1 && saved.aiLevel <= 3 ? saved.aiLevel : 2;
        opts.size = state.size;
        opts.handicap = state.handicap;
        room = null;
        roomCode = '';
        currentMember = null;
        reviewIndex = -1;
        deadSet = {};
        scoringPreview = state.status === 'scoring' ? Core.computeScore(state, []) : null;
        finalScore = null;
        importedMeta = null;
        tab = 'info';
        boardView.px = 0;
        boardView.anim = null;
        boardView.hint = null;
        viewCache.key = '';
        showGame();
        render();
        layoutBoard();
        if (state.status === 'scoring') showToast('已恢复数子阶段');
        else showToast('已恢复上次对局');
        if (mode === 'solo' && state.status === 'active' && state.turn !== opts.humanColor) scheduleAi();
      } catch (e) {
        clearSession();
        setError('上次对局已损坏，已清除');
      }
    }

    // ============ 交互 ============
    function onAction(event) {
      if (lastActionEvent === event) return;
      lastActionEvent = event;
      var target = event.target;
      if (!target || !target.closest) return;

      var seg = target.closest('[data-group]');
      if (seg) {
        var group = seg.getAttribute('data-group');
        var value = target.getAttribute('data-value');
        if (value !== null) {
          var num = Number(value);
          if (group === 'size') { opts.size = num; saveSettings(); syncSegments(); }
          else if (group === 'color') { opts.humanColor = num; saveSettings(); syncSegments(); }
          else if (group === 'level') { opts.aiLevel = num; saveSettings(); syncSegments(); }
          return;
        }
      }
      if (target.getAttribute && target.getAttribute('data-field') === 'handicap') return;

      var tabButton = target.closest('[data-tab]');
      if (tabButton) {
        tab = tabButton.getAttribute('data-tab');
        if (tab === 'chat') unreadChat = 0;
        updateTabs();
        renderChat();
        renderMoves();
        return;
      }

      var actionEl = target.closest('[data-action]');
      if (!actionEl) return;
      var action = actionEl.getAttribute('data-action');
      if (action === 'close-modal') { closeModal(); return; }
      if (action === 'paste-confirm') return; // 由弹层自己的按钮处理
      if (action === 'start-solo') { hideSheet(); startGame('solo'); return; }
      if (action === 'start-local') { hideSheet(); startGame('local'); return; }
      if (action === 'create-room') { hideSheet(); createRoom(); return; }
      if (action === 'join-room') { hideSheet(); enterRoom(String(roomInput.value || '').replace(/\s/g, ''), false); return; }
      if (action === 'watch-room') { hideSheet(); enterRoom(String(roomInput.value || '').replace(/\s/g, ''), true); return; }
      if (action === 'refresh-room') { refreshRoom(); return; }
      if (action === 'import-sgf') { pickSGF(); return; }
      if (action === 'paste-sgf') { openPasteModal(); return; }
      if (action === 'save-history') { saveGameToHistory(true); return; }
      if (action === 'open-history') { openHistoryGame(actionEl.getAttribute('data-id')); return; }
      if (action === 'delete-history') { deleteHistoryGame(actionEl.getAttribute('data-id')); return; }
      if (action === 'clear-history') { clearHistory(); return; }
      if (action === 'resume-session') { resumeSession(); return; }
      if (action === 'discard-session') { clearSession(); renderEntry(); showToast('已放弃上次对局'); return; }
      if (action === 'undo') { undoMove(); return; }
      if (action === 'pass') { passTurn(); return; }
      if (action === 'resign') { resignGame(); return; }
      if (action === 'new-game') { newGame(); return; }
      if (action === 'leave') {
        if (mode === '') { try { context.system.goDesktop(); } catch (e) {} return; }
        if (mode === 'review') { showEntry(); return; }
        if (mode === 'room') {
          confirmAction('离开房间', '离开后可以凭房间码回来。').then(function (yes) { if (yes) leaveRoom(false); });
        } else {
          confirmAction('离开对局', '离开后这盘棋会被保存到「上次对局」。').then(function (yes) {
            if (!yes) return;
            saveSessionNow();
            showEntry(true);
          });
        }
        return;
      }
      if (action === 'copy-room') { copyText(roomCode, '房间码已复制'); return; }
      if (action === 'share-room') { shareRoom(); return; }
      if (action === 'close-room') {
        confirmAction('关闭房间', '关闭后所有人都将离开。').then(function (yes) {
          if (!yes) return;
          apiRequest('post', '/weiqi/rooms/' + roomCode + '/close', {}).then(function () { leaveRoom(true); }, function (error) { setError(error.message || '关闭失败'); });
        });
        return;
      }
      if (action === 'hint') { requestHint(); return; }
      if (action === 'confirm-score') { confirmScore(); return; }
      if (action === 'resume-game') { resumeGame(); return; }
      if (action === 'review-first') { reviewFirst(); return; }
      if (action === 'review-prev') { stepReview(-1); return; }
      if (action === 'review-next') { stepReview(1); return; }
      if (action === 'review-last') { reviewLast(); return; }
      if (action === 'review-live') { exitReview(); return; }
      if (action === 'review-analyze') { startReviewReport(); return; }
      if (action === 'review-cancel') { cancelReviewReport(); return; }
      if (action === 'review-goto') { gotoReviewIndex(Number(actionEl.getAttribute('data-index'))); return; }
      if (action === 'enter-review') { enterReviewMode(); return; }
      if (action === 'restart-same') { restartSameGame(); return; }
      if (action === 'goto-move') {
        var idx = Number(actionEl.getAttribute('data-index'));
        if (isFinite(idx)) gotoMove(idx);
        return;
      }
      if (action === 'export-sgf') { exportSGF(true); return; }
      if (action === 'copy-sgf') { exportSGF(false); return; }
      if (action === 'open-moves') { openSheet('moves'); return; }
      if (action === 'open-menu') { openSheet('info'); return; }
      if (action === 'close-sheet') { hideSheet(); return; }
      if (action === 'toggle-sound') { opts.sound = !opts.sound; saveSettings(); renderInfo(); showToast(opts.sound ? '落子声音已开' : '落子声音已关'); return; }
      if (action === 'toggle-numbers') { opts.showNumbers = !opts.showNumbers; saveSettings(); renderInfo(); requestDraw(); return; }
      if (action === 'toggle-katago') {
        opts.katago = !opts.katago;
        saveSettings();
        if (opts.katago) {
          kataGoCooldownUntil = 0;
          kataGoFailures = 0;
          checkKataGo(true);
          showToast('正在检测 KataGo…');
        } else {
          showToast('已切换到本地 AI');
        }
        renderInfo();
        renderBoardBar();
        return;
      }
      if (action === 'toggle-confirm') {
        opts.confirmMove = !opts.confirmMove;
        pendingConfirm = null;
        saveSettings();
        renderInfo();
        requestDraw();
        showToast(opts.confirmMove ? '落子二次确认已开' : '落子二次确认已关');
        return;
      }
      if (action === 'guess-first') {
        opts.humanColor = Math.random() < 0.5 ? BLACK : WHITE;
        saveSettings();
        syncSegments();
        showToast('猜先：你执' + (opts.humanColor === BLACK ? '黑' : '白'));
        return;
      }
      if (action === 'clear-analysis') {
        invalidateAnalysis();
        renderInfo();
        requestDraw();
        showToast('已清除分析');
        return;
      }
      if (action === 'analysis-move') {
        var ar = Number(actionEl.getAttribute('data-row'));
        var ac = Number(actionEl.getAttribute('data-col'));
        if (state && isFinite(ar) && isFinite(ac)) {
          boardView.hint = { row: ar, col: ac };
          boardView.cursor = { row: ar, col: ac };
          hideSheet();
          requestDraw();
          showToast('已标出 ' + Core.pointLabel(state.size, ar, ac));
        }
        return;
      }
      if (action === 'copy-result') {
        copyText(resultSummary(), '结果已复制');
        return;
      }
      if (action === 'chat-quick') {
        sendChatText(actionEl.getAttribute('data-text') || '');
        return;
      }
      if (action === 'review-play') {
        toggleReviewPlay();
        return;
      }
    }

    function shareRoom() {
      if (!roomCode) return;
      var url = location.origin + '/weiqi?room=' + roomCode;
      var payload = { title: '围棋邀请', text: '来下围棋：房间 ' + roomCode, url: url };
      try {
        if (context.system && context.system.share) {
          context.system.share(payload).then(function (result) {
            if (result && result.channel !== 'cancelled') showToast('邀请已发出');
          }, function () { copyText(url, '邀请链接已复制'); });
        } else {
          copyText(url, '邀请链接已复制');
        }
      } catch (e) {
        copyText(url, '邀请链接已复制');
      }
    }

    // ============ 棋盘事件 ============
    var pointerSupported = !!window.PointerEvent;
    var pressPoint = null;
    var lastTouchAt = 0;

    function eventPoint(event) {
      if (event.changedTouches && event.changedTouches.length) return event.changedTouches[0];
      if (event.touches && event.touches.length) return event.touches[0];
      return event;
    }

    function onPointerDown(event) {
      if (event.pointerType === 'touch') lastTouchAt = Date.now();
      var point = hitTest(event.clientX, event.clientY);
      if (!point) return;
      pressPoint = point;
      boardView.keyboard = false;
      boardView.hover = point;
      requestDraw();
      if (event.preventDefault) event.preventDefault();
      try { canvas.focus(); } catch (e) {}
    }

    function onPointerMove(event) {
      if (event.pointerType === 'touch' && !pressPoint) return;
      var point = hitTest(event.clientX, event.clientY);
      if (point) {
        if (!boardView.hover || boardView.hover.row !== point.row || boardView.hover.col !== point.col) {
          boardView.hover = point;
          requestDraw();
        }
      } else if (boardView.hover) {
        boardView.hover = null;
        requestDraw();
      }
    }

    function onPointerUp(event) {
      if (!pressPoint) return;
      var point = hitTest(event.clientX, event.clientY);
      var pressed = pressPoint;
      pressPoint = null;
      if (point && point.row === pressed.row && point.col === pressed.col) {
        attemptPlay(point.row, point.col);
      }
    }

    function onPointerLeave() {
      pressPoint = null;
      if (boardView.hover) {
        boardView.hover = null;
        requestDraw();
      }
    }

    function onTouchStart(event) {
      lastTouchAt = Date.now();
      var p = eventPoint(event);
      var point = hitTest(p.clientX, p.clientY);
      if (!point) return;
      pressPoint = point;
      boardView.keyboard = false;
      boardView.hover = point;
      requestDraw();
      if (event.preventDefault) event.preventDefault();
    }

    function onTouchEnd(event) {
      if (!pressPoint) return;
      var p = eventPoint(event);
      var point = hitTest(p.clientX, p.clientY);
      var pressed = pressPoint;
      pressPoint = null;
      if (point && point.row === pressed.row && point.col === pressed.col) {
        attemptPlay(point.row, point.col);
        if (event.preventDefault) event.preventDefault();
      }
    }

    function onTouchMove(event) {
      var p = eventPoint(event);
      var point = hitTest(p.clientX, p.clientY);
      if (point) {
        boardView.hover = point;
        requestDraw();
      }
      if (event.preventDefault) event.preventDefault();
    }

    function onCanvasClick(event) {
      // 老内核兜底（无 PointerEvent / TouchEvent）
      if (pointerSupported || ('ontouchstart' in window)) return;
      if (Date.now() - lastTouchAt < 700) return;
      var point = hitTest(event.clientX, event.clientY);
      if (point) attemptPlay(point.row, point.col);
    }

    function onBoardKey(event) {
      if (!state) return;
      var key = event.key;
      if (reviewIndex >= 0 && (key === 'ArrowLeft' || key === 'ArrowRight')) {
        event.preventDefault();
        event.stopPropagation();
        stepReview(key === 'ArrowLeft' ? -1 : 1);
        return;
      }
      if (key === 'ArrowLeft' || key === 'ArrowRight' || key === 'ArrowUp' || key === 'ArrowDown') {
        event.preventDefault();
        event.stopPropagation();
        boardView.keyboard = true;
        var size = state.size;
        var cursor = boardView.cursor || { row: (size - 1) / 2 | 0, col: (size - 1) / 2 | 0 };
        if (key === 'ArrowLeft') cursor.col = Math.max(0, cursor.col - 1);
        if (key === 'ArrowRight') cursor.col = Math.min(size - 1, cursor.col + 1);
        if (key === 'ArrowUp') cursor.row = Math.max(0, cursor.row - 1);
        if (key === 'ArrowDown') cursor.row = Math.min(size - 1, cursor.row + 1);
        boardView.cursor = cursor;
        boardView.hover = cursor;
        requestDraw();
        announce('选点 ' + Core.pointLabel(size, cursor.row, cursor.col));
        return;
      }
      if (key === ' ') {
        if (isReviewing()) {
          event.preventDefault();
          event.stopPropagation();
          toggleReviewPlay();
          return;
        }
      }
      if (key === 'Enter' || key === ' ') {
        event.preventDefault();
        event.stopPropagation();
        var c = boardView.cursor;
        if (c) attemptPlay(c.row, c.col);
        return;
      }
      if (key === 'p' || key === 'P') { event.preventDefault(); event.stopPropagation(); passTurn(); return; }
      if (key === 'u' || key === 'U') { event.preventDefault(); event.stopPropagation(); undoMove(); return; }
      if (key === 'Escape') {
        event.stopPropagation();
        if (pendingConfirm) {
          pendingConfirm = null;
          requestDraw();
          showToast('已取消待落子');
          return;
        }
        if (isReviewing()) exitReview();
        else if (side.className.indexOf('is-open') !== -1) hideSheet();
        return;
      }
      if (reviewIndex >= 0 && state.moves.length) {
        if (key === 'Home') { event.preventDefault(); reviewFirst(); }
        if (key === 'End') { event.preventDefault(); reviewLast(); }
      }
    }

    function onRootKey(event) {
      if (!state || event.target === canvas || event.target === roomInput) return;
      if (event.target && (event.target.tagName === 'INPUT' || event.target.tagName === 'TEXTAREA' || event.target.tagName === 'SELECT')) return;
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        if (!isReviewing() && state.moves.length < 2) return;
        event.preventDefault();
        stepReview(event.key === 'ArrowLeft' ? -1 : 1);
        return;
      }
      if (event.key === 'Home' && isReviewing()) { event.preventDefault(); reviewFirst(); return; }
      if (event.key === 'End' && isReviewing()) { event.preventDefault(); reviewLast(); return; }
      if (event.key === 'Escape') {
        if (pendingConfirm) {
          event.preventDefault();
          pendingConfirm = null;
          requestDraw();
          showToast('已取消待落子');
          return;
        }
        if (isReviewing()) { event.preventDefault(); exitReview(); }
        else if (side.className.indexOf('is-open') !== -1) { event.preventDefault(); hideSheet(); }
      }
    }

    // ============ 生命周期 / 订阅 ============
    root.addEventListener('click', onAction);
    navActions.addEventListener('click', onAction);
    canvas.addEventListener('click', onCanvasClick);
    if (pointerSupported) {
      canvas.addEventListener('pointerdown', onPointerDown);
      canvas.addEventListener('pointermove', onPointerMove);
      canvas.addEventListener('pointerup', onPointerUp);
      canvas.addEventListener('pointercancel', onPointerLeave);
      canvas.addEventListener('pointerleave', onPointerLeave);
    } else {
      canvas.addEventListener('mousedown', function (e) { onPointerDown(e); });
      canvas.addEventListener('mousemove', function (e) { onPointerMove(e); });
      canvas.addEventListener('mouseup', function (e) { onPointerUp(e); });
      canvas.addEventListener('mouseleave', onPointerLeave);
      canvas.addEventListener('touchstart', onTouchStart);
      canvas.addEventListener('touchmove', onTouchMove);
      canvas.addEventListener('touchend', onTouchEnd);
    }
    canvas.addEventListener('keydown', onBoardKey);
    root.addEventListener('keydown', onRootKey);
    canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    sheetMask.addEventListener('click', hideSheet);
    if (handicapSelect) {
      handicapSelect.addEventListener('change', function () {
        opts.handicap = Number(handicapSelect.value) || 0;
        saveSettings();
      });
    }
    roomInput.addEventListener('keydown', function (event) {
      if (event.key === 'Enter') {
        event.preventDefault();
        enterRoom(String(roomInput.value || '').replace(/\s/g, ''), false);
      }
    });

    // 实时订阅
    if (realtime && typeof realtime.connect === 'function') {
      try { realtime.connect(); } catch (e) {}
    }
    if (realtime && typeof realtime.subscribe === 'function') {
      subscriptions.push(realtime.subscribe('weiqi.room.changed', function (message) {
        var payload = message && message.payload ? message.payload : message;
        if (!payload || !payload.roomCode || payload.roomCode !== roomCode || mode !== 'room') return;
        if (payload.state) applyRoomState(payload.state);
      }));
      subscriptions.push(realtime.subscribe('weiqi.room.message', function (message) {
        var payload = message && message.payload ? message.payload : message;
        if (!payload || payload.roomCode !== roomCode || mode !== 'room') return;
        if (payload.message) appendChat(payload.message);
      }));
      subscriptions.push(realtime.subscribe('weiqi.room.closed', function (message) {
        var payload = message && message.payload ? message.payload : message;
        if (!payload || payload.roomCode !== roomCode || mode !== 'room') return;
        showToast('房间已关闭');
        leaveRoom(true);
      }));
      if (typeof realtime.on === 'function') {
        subscriptions.push(realtime.on('connected', function () {
          if (mode === 'room') { refreshRoom(); setText(connectionText, '实时'); }
        }));
        subscriptions.push(realtime.on('_connectionStateChange', function (message) {
          if (mode !== 'room') return;
          setText(connectionText, message && message.state === 'connected' ? '实时' : '重连中');
        }));
        subscriptions.push(realtime.on('error', function () {
          if (mode === 'room') setText(connectionText, '同步');
        }));
      }
    }

    // 尺寸监听
    var roRaf = 0;
    if (window.ResizeObserver) {
      try {
        var ro = new ResizeObserver(function () {
          // 延迟到下一帧再改画布尺寸：ResizeObserver 回调里直接改被观察区域的尺寸
          // 会触发 "ResizeObserver loop completed with undelivered notifications" 警告。
          if (roRaf) return;
          roRaf = window.requestAnimationFrame ? window.requestAnimationFrame(function () {
            roRaf = 0;
            layoutBoard();
          }) : window.setTimeout(function () {
            roRaf = 0;
            layoutBoard();
          }, 16);
        });
        ro.observe(boardWrap);
        subscriptions.push(function () {
          if (roRaf) {
            if (window.cancelAnimationFrame) window.cancelAnimationFrame(roRaf);
            else clearTimeout(roRaf);
            roRaf = 0;
          }
          ro.disconnect();
        });
      } catch (e) {}
    }
    window.addEventListener('resize', onWindowResize);
    resizeGuard = setInterval(function () {
      if (mode === 'entry' || disposed) return;
      layoutBoard();
    }, 900);
    function onWindowResize() {
      layoutBoard();
      requestDraw();
    }

    // 初始路由
    var initialRoom = '';
    try {
      var route = (context.system && context.system.route) || context.route || null;
      if (route) {
        initialRoom = (route.params && (route.params.roomCode || route.params.room_code)) ||
          (route.query && (route.query.roomCode || route.query.room_code)) || '';
      }
    } catch (e) { initialRoom = ''; }
    if (initialRoom) {
      roomInput.value = String(initialRoom);
      enterRoom(String(initialRoom).toUpperCase(), false);
    } else {
      renderEntry();
      render();
    }

    if (hostNavbar) {
      try {
        hostNavbar.setTitle('围棋');
        hostNavbar.setStatus(navStatus);
        hostNavbar.setActions([{ id: 'connection', element: connectionText }, { id: 'actions', element: navActions }]);
      } catch (e) {}
    }
    navActions.hidden = true;
    layoutBoard();
    checkKataGo();

    // 清理
    if (context.app && typeof context.app.onDestroy === 'function') {
      context.app.onDestroy(function () {
        disposed = true;
        // 离开路由前把当前对局落盘：saveSessionSoon 的 280ms 防抖可能来不及执行。
        if (mode === 'solo' || mode === 'local' || mode === 'room') saveSessionNow();
        cancelAi();
        stopReviewPlay();
        resetReviewReport();
        if (kataRecoverTimer) { clearTimeout(kataRecoverTimer); kataRecoverTimer = null; }
        if (aiTickTimer) { clearInterval(aiTickTimer); aiTickTimer = null; }
        stopPolling();
        closeModal();
        if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
        if (toastTimer) { clearTimeout(toastTimer); toastTimer = null; }
        if (deadSyncTimer) { clearTimeout(deadSyncTimer); deadSyncTimer = null; }
        if (resizeGuard) { clearInterval(resizeGuard); resizeGuard = null; }
        for (var i = 0; i < timers.length; i++) clearTimeout(timers[i]);
        timers = [];
        for (var j = 0; j < subscriptions.length; j++) {
          try { subscriptions[j](); } catch (e) {}
        }
        subscriptions = [];
        window.removeEventListener('resize', onWindowResize);
        if (hostNavbar) { try { hostNavbar.clear(); } catch (e) {} }
        if (audioCtx && audioCtx.close) { try { audioCtx.close(); } catch (e) {} }
        clearChildren(container);
      });
    }
  }

  // ============ 骨架辅助 ============
  function buildSegmented(group, options, value) {
    var wrap = t('div', 'weiqi-seg', { 'data-group': group });
    for (var i = 0; i < options.length; i++) {
      var active = String(options[i].value) === String(value);
      wrap.appendChild(t('button', 'weiqi-seg-btn' + (active ? ' is-active' : ''), {
        type: 'button',
        'data-value': String(options[i].value),
        'aria-pressed': active ? 'true' : 'false',
        text: options[i].label
      }));
    }
    return wrap;
  }

  function buildField(label, control) {
    return t('label', 'weiqi-field', null, [
      t('span', 'weiqi-field-label', { text: label }),
      control
    ]);
  }

  function buildHeroBoard() {
    var board = t('div', 'weiqi-hero-board', { 'aria-hidden': 'true' });
    var grid = t('div', 'weiqi-hero-grid');
    for (var i = 0; i < 6; i++) {
      grid.appendChild(t('span', 'weiqi-hero-line h', { style: 'top:' + (i * 20) + '%' }));
      grid.appendChild(t('span', 'weiqi-hero-line v', { style: 'left:' + (i * 20) + '%' }));
    }
    board.appendChild(grid);
    var stones = [
      [2, 2, 'b'], [3, 2, 'w'], [2, 3, 'w'], [3, 3, 'b'], [1, 1, 'b'], [4, 4, 'w']
    ];
    for (var j = 0; j < stones.length; j++) {
      board.appendChild(t('span', 'weiqi-hero-stone ' + stones[j][2], {
        style: 'left:' + (stones[j][1] * 20 + 10) + '%;top:' + (stones[j][0] * 20 + 10) + '%'
      }));
    }
    return board;
  }

  window.ClassIntraMarket = window.ClassIntraMarket || { apps: {} };
  var definition = { name: NAME, mount: mount, unmount: function (container) { if (container) clearChildren(container); } };
  if (typeof window.ClassIntraMarket.define === 'function') window.ClassIntraMarket.define(definition);
  else window.ClassIntraMarket.apps[NAME] = definition;
})();
