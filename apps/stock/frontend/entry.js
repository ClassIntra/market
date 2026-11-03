// 学元证券（前端）—— 券商终端式界面
// ============================================================
// 设计约束：
//   · Chrome 80 基线：不用可选链、不用 flex gap、不用 aspect-ratio
//   · 平板触控：所有可点区域 ≥ 44px，不依赖 hover
//   · 红涨绿跌（A 股习惯，与欧美相反）
//   · 数字等宽 + 刷新时只改文本节点，不整页重建（避免价格跳动时闪屏）
//
// 数据来源全部是后端 /api/stock/*，本文件不自己算钱、不算持仓成本 ——
// 那是服务端的职责，前端只负责显示。唯一的例外是「交易面板的预估」，
// 它必须与后端用同一套费率（market.calcFees 的镜像），否则学生看到
// 的预估和实际扣款对不上。

(function () {
  'use strict';

  var NAME = 'stock';
  var REFRESH_MARKET = 8000;    // 行情页刷新间隔
  var REFRESH_DETAIL = 5000;    // 详情页刷新间隔
  var REFRESH_ASSET = 15000;    // 资产刷新间隔

  // 与后端 backend/market.js 保持一致（改一处必须改另一处）
  var LOT = 100;
  var COMMISSION_RATE = 0.00025;
  var COMMISSION_MIN = 5;
  var STAMP_RATE = 0.0005;
  var TRANSFER_RATE = 0.00001;

  var root = null;
  var context = null;
  var api = null;
  var container_ = null;
  var chartGeo = null;   // 当前图表的坐标映射（供十字线反查）

  function volText(v) {
    var n = Number(v) || 0;
    if (n >= 10000) return (n / 10000).toFixed(2) + ' 万手';
    return n + ' 手';
  }

  var S = {
    tab: 'market',
    overview: null,
    market: null,
    marketError: '',   // 行情拉取失败的原因（拉不到 ≠ 没有，必须显示错误态）
    marketTab: 'all',
    sectorFilter: '',  // 板块快捷筛选（空 = 全部板块）
    q: '',             // 行情搜索关键字（代码/名称/板块）
    detail: null,
    detailCode: '',
    detailQuote: null,
    chartTab: 'trend',
    // 图表缓存：详情页每 5 秒刷新一次行情，若每次重拉分时/K线，
    // 一个人就是 12 次/分钟的整段请求，而且 canvas 每 5 秒重绘会闪。
    // key = code:tab，trend 缓存 30s、K线 5 分钟（2026-11-03）。
    chartCache: {},
    detailJustOpened: false,
    hoverIdx: null,     // 图表长按/拖动的十字线位置（null = 未激活）
    subview: '',        // 持仓页内的子视图：'' | 'ledger'
    ledger: null,       // 学元流水（{ list, next_before_id }）
    fastNews: null,     // 市场快讯
    fastNewsAt: 0,
    stockNews: {},      // code -> { list, at }
    notify: { list: [], unread: 0, at: 0 },
    orders: null,
    trades: null,
    rank: null,
    lastRankAt: 0,
    rules: null,
    peer: null,
    achievements: null,
    report: null,
    reportOpen: false,
    loading: {},
    error: {},
    watch: {},
    sheet: null,        // { code, side, type, price, qty }
    tour: null,         // 新手引导当前步（null = 未在引导中）
    toastTimer: null,
    refreshTimer: null,
    lastRefresh: 0
  };

  // ================= 工具 =================
  function h(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined && text !== null) e.textContent = String(text);
    return e;
  }

  function svg(inner, size) {
    var s = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" ' +
      'stroke-linecap="round" stroke-linejoin="round" width="' + (size || 21) + '" height="' + (size || 21) + '">' +
      inner + '</svg>';
    var wrap = document.createElement('div');
    wrap.innerHTML = s;
    return wrap.firstChild;
  }

  function clear(node) {
    while (node && node.firstChild) node.removeChild(node.firstChild);
  }

  function fmt(n, digits) {
    var v = Number(n);
    if (!isFinite(v)) return '--';
    var d = digits === undefined ? 2 : digits;
    return v.toFixed(d);
  }

  // 千分位金额：9155.97 → 9,155.97
  function money(n, digits) {
    var v = Number(n);
    if (!isFinite(v)) return '--';
    var d = digits === undefined ? 2 : digits;
    var neg = v < 0;
    var s = Math.abs(v).toFixed(d);
    var parts = s.split('.');
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return (neg ? '-' : '') + parts.join('.');
  }

  function signed(n, digits) {
    var v = Number(n);
    if (!isFinite(v)) return '--';
    return (v > 0 ? '+' : '') + money(v, digits);
  }

  function pct(n, digits) {
    var v = Number(n);
    if (!isFinite(v)) return '--';
    return (v > 0 ? '+' : '') + v.toFixed(digits === undefined ? 2 : digits) + '%';
  }

  function trendClass(v) {
    var n = Number(v);
    if (n > 0) return 'up';
    if (n < 0) return 'down';
    return 'flat';
  }

  function todayLabel(ts) {
    var d = new Date(ts);
    var hh = ('0' + d.getHours()).slice(-2);
    var mm = ('0' + d.getMinutes()).slice(-2);
    return hh + ':' + mm;
  }

  function toast(msg, type) {
    if (!root) return;
    var t = root.querySelector('.ci-stock-toast');
    if (!t) {
      t = h('div', 'toast ci-stock-toast');
      root.appendChild(t);
    }
    t.textContent = msg;
    t.className = 'toast ci-stock-toast show ' + (type || '');
    if (S.toastTimer) clearTimeout(S.toastTimer);
    S.toastTimer = setTimeout(function () {
      t.className = 'toast ci-stock-toast ' + (type || '');
    }, 2600);
  }

  function errMsg(err) {
    if (err && err.response && err.response.data && err.response.data.message) return err.response.data.message;
    if (err && err.message) return err.message;
    return '网络异常，请重试';
  }

  // ---- API ----
  function get(path, params) {
    var q = '';
    if (params) {
      var arr = [];
      for (var k in params) {
        if (Object.prototype.hasOwnProperty.call(params, k) && params[k] !== undefined && params[k] !== null && params[k] !== '') {
          arr.push(encodeURIComponent(k) + '=' + encodeURIComponent(params[k]));
        }
      }
      if (arr.length) q = '?' + arr.join('&');
    }
    return api.get('/stock' + path + q).then(function (res) {
      var body = res && res.data;
      if (body && body.code !== 200) throw new Error(body.message || '请求失败');
      return body ? body.data : null;
    });
  }

  function post(path, body) {
    return api.post('/stock' + path, body || {}).then(function (res) {
      var b = res && res.data;
      if (b && b.code !== 200) throw new Error(b.message || '请求失败');
      return b ? { data: b.data, message: b.message } : null;
    });
  }

  function del(path) {
    return api.delete('/stock' + path).then(function (res) {
      var b = res && res.data;
      if (b && b.code !== 200) throw new Error(b.message || '请求失败');
      return b ? b.data : null;
    });
  }

  // ================= 顶栏 =================
  function renderTop() {
    var top = root.querySelector('.ci-stock-top');
    if (!top) return;
    clear(top);

    // 左侧：交易时段状态（宿主导航栏已经有应用标题，这里不再重复品牌名）
    var sess = (S.overview && S.overview.session) || (S.market && S.market.session) || null;
    var status = h('div', 'market-status' + (sess && sess.tradable ? ' live' : ''));
    status.appendChild(h('span', 'ms-dot'));
    var text = sess ? sess.label : '连接中';
    if (sess && sess.settles) text = '交易中 · ' + text;
    status.appendChild(h('span', 'ms-text', text));
    top.appendChild(status);

    // 指数
    var strip = h('div', 'index-strip');
    var idx = (S.overview && S.overview.indexes) || [];
    for (var i = 0; i < idx.length; i++) {
      var it = idx[i];
      var pill = h('div', 'index-pill');
      pill.appendChild(h('span', 'nm', it.name));
      pill.appendChild(h('span', 'vl num', money(it.price, 2)));
      var pc = h('span', 'pc num ' + trendClass(it.change_pct), pct(it.change_pct));
      pill.appendChild(pc);
      strip.appendChild(pill);
    }
    if (!idx.length) strip.appendChild(h('div', 'index-pill', '指数加载中'));
    top.appendChild(strip);

    // 通知铃铛（未读红点）
    var bell = h('div', 'notify-bell');
    bell.appendChild(h('span', 'nb-ico', '🔔'));
    if (S.notify.unread > 0) {
      bell.appendChild(h('span', 'nb-badge', S.notify.unread > 99 ? '99+' : String(S.notify.unread)));
    }
    bell.onclick = openNotify;
    top.appendChild(bell);

    // 钱包
    var wallet = h('div', 'wallet');
    wallet.appendChild(h('span', 'lbl', '学元'));
    var avail = (S.overview && S.overview.summary && S.overview.summary.cash.available) || 0;
    wallet.appendChild(h('span', 'amt num', money(avail, 2)));
    top.appendChild(wallet);
  }

  function renderStaleBar(snap) {
    var old = root.querySelector('.stale-bar');
    if (!snap || !snap.stale) {
      if (old) old.parentNode.removeChild(old);
      return;
    }
    if (old) old.parentNode.removeChild(old);
    var bar = h('div', 'stale-bar');
    bar.appendChild(h('div', 'stale-dot'));
    bar.appendChild(h('span', null, '行情延迟：' + (snap.stale_reason || '暂时连不上行情服务器') + ' · 价格仅供参考，成交仍按延迟价计算'));
    var top = root.querySelector('.top');
    if (top && top.nextSibling) root.insertBefore(bar, top.nextSibling);
  }

  // ================= 导航 =================
  var NAV = [
    { key: 'market', label: '行情', icon: '<path d="M3 17l5-5 4 3 8-8"/><path d="M14 7h6v6"/>' },
    { key: 'positions', label: '持仓', icon: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M8 4v16"/>' },
    { key: 'orders', label: '委托', icon: '<path d="M8 6h13M8 12h13M8 18h13"/><circle cx="3.5" cy="6" r="1.2"/><circle cx="3.5" cy="12" r="1.2"/><circle cx="3.5" cy="18" r="1.2"/>' },
    { key: 'rank', label: '排行', icon: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>' },
    { key: 'guide', label: '指南', icon: '<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v16H6.5A2.5 2.5 0 0 0 4 21.5V5.5z"/><path d="M8 7h8M8 11h6"/>' },
    { key: 'rules', label: '规则', icon: '<circle cx="12" cy="12" r="9"/><path d="M12 8h.01M11 12h1v4h1"/>' }
  ];

  function renderNav() {
    var nav = root.querySelector('.nav');
    if (!nav) return;
    clear(nav);
    for (var i = 0; i < NAV.length; i++) {
      (function (item) {
        var e = h('div', 'nav-item' + (S.tab === item.key ? ' active' : ''));
        e.appendChild(svg(item.icon));
        e.appendChild(h('span', null, item.label));
        e.onclick = function () {
          if (S.tab === item.key && !S.detailCode && !S.subview) return;
          S.tab = item.key;
          S.detailCode = '';
          S.subview = '';
          renderNav();
          renderMain();
          loadTab(item.key);
        };
        nav.appendChild(e);
      })(NAV[i]);
    }
    nav.appendChild(h('div', 'nav-spacer'));
  }

  // ================= 主区 =================
  function renderMain() {
    var main = root.querySelector('.main');
    if (!main) return;
    var scroll = main.scrollTop;
    clear(main);

    if (S.detailCode && S.tab === 'market') {
      main.appendChild(viewDetail());
    } else if (S.tab === 'market') {
      main.appendChild(viewMarket());
    } else if (S.tab === 'positions') {
      main.appendChild(S.subview === 'ledger' ? viewLedger() : viewPositions());
    } else if (S.tab === 'orders') {
      main.appendChild(viewOrders());
    } else if (S.tab === 'rank') {
      main.appendChild(viewRank());
    } else if (S.tab === 'guide') {
      main.appendChild(viewGuide());
    } else {
      main.appendChild(viewRules());
    }

    if (scroll) main.scrollTop = scroll;
    renderStaleBar(S.tab === 'market' ? (S.market || S.detail) : null);
  }

  function loadingBox(text) {
    var box = h('div', 'loading');
    box.appendChild(h('div', 'spin'));
    box.appendChild(h('div', null, text || '加载中'));
    return box;
  }

  function emptyBox(icon, title, hint) {
    var box = h('div', 'empty');
    box.appendChild(h('div', 'empty-icon', icon));
    box.appendChild(h('div', null, title));
    if (hint) box.appendChild(h('div', 'empty-hint', hint));
    return box;
  }

  // 错误态：拉不到 ≠ 没有。列表/资产加载失败必须可见、可重试，
  // 绝不能渲染成空态让学生以为「今天没行情」。
  function errorBox(title, hint, retry) {
    var box = h('div', 'error-box');
    box.appendChild(h('div', 'error-icon', '⚠'));
    box.appendChild(h('div', 'error-title', title));
    if (hint) box.appendChild(h('div', 'error-hint', String(hint)));
    var btn = h('button', 'error-retry', '重试');
    btn.onclick = function () {
      btn.disabled = true;
      btn.textContent = '重试中…';
      retry();
    };
    box.appendChild(btn);
    return box;
  }

  // ================= 行情 =================
  // 触板：价格触及当日涨跌停时，把涨跌幅换成「涨停/跌停」——
  // 这是盘口最重要的状态，比一个 +10.00% 数字更有信息量。
  function badgeTextOf(q) {
    if (q.limit_up && q.price_cent >= Math.round(q.limit_up * 100)) return '涨停';
    if (q.limit_down && q.price_cent <= Math.round(q.limit_down * 100)) return '跌停';
    return null;
  }

  function viewMarket() {
    var wrap = h('div', 'view-market');
    var ov = S.overview;

    // 资产加载失败必须可见（但行情区继续可用）
    if (!ov && S.error.overview) {
      wrap.appendChild(errorBox('资产加载失败', S.error.overview, function () {
        S.error.overview = '';
        loadOverview().then(function () {
          if (S.tab === 'market' && !S.detailCode) renderMain();
        });
      }));
    }

    // 资产卡
    if (ov && ov.summary) {
      wrap.appendChild(heroCard(ov.summary));
    }

    // 收盘报告（昨日/最近一个交易日的真实行情摘要）
    wrap.appendChild(reportCard());

    // 市场快讯（7×24，点开看摘要）
    wrap.appendChild(newsStrip());

    // 分段：自选 / 全部 + 搜索框
    var bar = h('div', 'chart-tabs');
    var seg = h('div', 'seg');
    ['全部', '自选'].forEach(function (label, i) {
      var active = S.marketTab === (i === 0 ? 'all' : 'watch');
      var b = h('div', 'seg-item' + (active ? ' active' : ''), label);
      b.onclick = function () {
        S.marketTab = i === 0 ? 'all' : 'watch';
        renderMain();
      };
      seg.appendChild(b);
    });
    bar.appendChild(seg);

    var search = h('div', 'market-search');
    var input = document.createElement('input');
    input.className = 'market-search-input';
    input.type = 'text';
    input.placeholder = '搜代码 / 名称 / 板块';
    input.value = S.q || '';
    input.setAttribute('enterkeyhint', 'search');
    search.appendChild(input);

    // 清空按钮常驻、按 S.q 显隐。旧写法只在整页重绘且 S.q 非空时创建，
    // 而输入过程只重绘列表区 —— 按钮永远不会出现（探针实测点不到）。
    var clr = h('div', 'market-search-clear', '✕');
    clr.style.display = S.q ? 'flex' : 'none';
    clr.onclick = function () {
      S.q = '';
      input.value = '';
      clr.style.display = 'none';
      fillMarketList(listZone);
      input.focus();
    };
    search.appendChild(clr);
    bar.appendChild(search);
    wrap.appendChild(bar);

    // 板块快捷筛选（17 个板块时，横滑一排比在长列表里找快得多）
    if (S.market) {
      var chips = h('div', 'sector-chips');
      var all = h('div', 'chip' + (!S.sectorFilter ? ' active' : ''), '全部板块');
      all.onclick = function () { S.sectorFilter = ''; renderMain(); };
      chips.appendChild(all);
      var seenSector = {};
      var sectorNames = [];
      var listAll = S.market.list || [];
      for (var si = 0; si < listAll.length; si++) {
        var sn = listAll[si].sector || '其他';
        if (!seenSector[sn]) { seenSector[sn] = true; sectorNames.push(sn); }
      }
      sectorNames.forEach(function (name) {
        var chip = h('div', 'chip' + (S.sectorFilter === name ? ' active' : ''), name);
        chip.onclick = function () {
          S.sectorFilter = S.sectorFilter === name ? '' : name;
          renderMain();
        };
        chips.appendChild(chip);
      });
      wrap.appendChild(chips);
    }

    // 市场概况：涨跌家数 + 更新时间（行情延迟时也在这里说清楚）
    if (S.market) {
      var upN = 0;
      var downN = 0;
      var listMeta = S.market.list || [];
      for (var mi = 0; mi < listMeta.length; mi++) {
        if (listMeta[mi].change_pct > 0) upN++;
        else if (listMeta[mi].change_pct < 0) downN++;
      }
      var meta = h('div', 'market-meta');
      meta.appendChild(h('span', null, '股票池 ' + upN + ' 涨 · ' + downN + ' 跌'));
      meta.appendChild(h('span', 'num', (S.market.stale ? '行情延迟 · ' : '') +
        todayLabel(S.market.quoted_at) + ' 更新'));
      wrap.appendChild(meta);
    }

    var listZone = h('div', 'market-list');
    wrap.appendChild(listZone);

    // 输入时只重绘列表区：重建输入框本身会让平板键盘每敲一字丢一次焦点
    input.oninput = function () {
      S.q = input.value;
      clr.style.display = S.q ? 'flex' : 'none';
      fillMarketList(listZone);
    };

    fillMarketList(listZone);
    return wrap;
  }

  function marketFiltered() {
    var list = (S.market && S.market.list) || [];
    if (S.sectorFilter) {
      list = list.filter(function (x) { return (x.sector || '其他') === S.sectorFilter; });
    }
    var q = String(S.q || '').trim().toLowerCase();
    if (q) {
      return list.filter(function (x) {
        return x.code.indexOf(q) === 0 ||
          String(x.name).toLowerCase().indexOf(q) !== -1 ||
          String(x.sector || '').toLowerCase().indexOf(q) !== -1;
      });
    }
    if (S.marketTab === 'watch') {
      var watchCodes = {};
      ((S.overview && S.overview.watchlist) || []).forEach(function (x) { watchCodes[x.code] = true; });
      list = list.filter(function (x) { return watchCodes[x.code]; });
    }
    return list;
  }

  function fillMarketList(zone) {
    clear(zone);

    // 搜索态：平铺结果，不按板块分组
    if (S.q && S.market) {
      var hits = marketFiltered();
      var zhead = h('div', 'sector-head');
      zhead.appendChild(h('div', 'sector-name', hits.length ? '找到 ' + hits.length + ' 只' : ''));
      zone.appendChild(zhead);
      if (!hits.length) {
        zone.appendChild(emptyBox('🔍', '没有匹配的股票', '试试代码、名称或板块，比如 600519 / 平安 / 金融'));
        return;
      }
      var flat = h('div', 'card');
      for (var f = 0; f < hits.length; f++) flat.appendChild(quoteRow(hits[f]));
      zone.appendChild(flat);
      return;
    }

    if (!S.market) {
      if (S.marketError) {
        zone.appendChild(errorBox('行情加载失败', S.marketError, function () {
          S.marketError = '';
          loadMarket();
        }));
      } else {
        zone.appendChild(loadingBox('正在获取行情'));
      }
      return;
    }

    var list = marketFiltered();
    if (S.marketTab === 'watch' && !list.length) {
      zone.appendChild(emptyBox('☆', '还没有自选股', '点股票右侧的星标加入自选，个股详情页也可以'));
      return;
    }

    // 按板块分组
    var sectors = {};
    var order = [];
    for (var i = 0; i < list.length; i++) {
      var key = list[i].sector || '其他';
      if (!sectors[key]) { sectors[key] = []; order.push(key); }
      sectors[key].push(list[i]);
    }

    for (var s = 0; s < order.length; s++) {
      var box = h('div', 'sector');
      var head = h('div', 'sector-head');
      head.appendChild(h('div', 'sector-name', order[s]));
      var upCount = 0;
      for (var u = 0; u < sectors[order[s]].length; u++) {
        if (sectors[order[s]][u].change_pct > 0) upCount++;
      }
      head.appendChild(h('div', 'sector-name', upCount + '/' + sectors[order[s]].length + ' 上涨'));
      box.appendChild(head);

      var card = h('div', 'card');
      for (var j = 0; j < sectors[order[s]].length; j++) {
        card.appendChild(quoteRow(sectors[order[s]][j]));
      }
      box.appendChild(card);
      zone.appendChild(box);
    }
  }

  function heroCard(sum) {
    var hero = h('div', 'hero');
    var left = h('div', 'hero-left');
    left.appendChild(h('div', 'hero-label', '总资产'));

    var v = h('div', 'hero-value num');
    v.appendChild(document.createTextNode(money(sum.totals.total_asset, 2)));
    v.appendChild(h('span', 'unit', '学元'));
    left.appendChild(v);

    var sub = h('div', 'hero-sub');
    var dayPnl = sum.totals.today_pnl;
    var chip = h('span', 'hero-chip ' + trendClass(dayPnl), signed(dayPnl) + ' 今日');
    sub.appendChild(chip);
    var totalPnl = sum.totals.total_pnl;
    // 收益率口径：累计盈亏 / 投入本金（用「总资产 − 盈亏」反推，避免再统计入金流水）
    var base = sum.totals.total_asset - totalPnl;
    var chip2 = h('span', null, '累计 ' + signed(totalPnl) + '（' + pct(base > 0 ? totalPnl / base * 100 : 0) + '）');
    chip2.className = trendClass(totalPnl);
    sub.appendChild(chip2);
    left.appendChild(sub);
    hero.appendChild(left);

    var right = h('div', 'hero-right');
    right.appendChild(kv('可用', money(sum.cash.available, 2), 'num'));
    right.appendChild(kv('冻结', money(sum.cash.frozen, 2), 'num' + (sum.cash.frozen > 0 ? ' gold' : ' flat')));
    right.appendChild(kv('市值', money(sum.totals.market_value, 2), 'num'));
    hero.appendChild(right);
    return hero;
  }

  function kv(k, v, cls) {
    var row = h('div', 'hero-kv');
    row.appendChild(h('span', 'k', k));
    var val = h('span', 'v ' + (cls || ''), v);
    row.appendChild(val);
    return row;
  }

  function quoteRow(q) {
    var row = h('div', 'qrow');
    row.setAttribute('data-code', q.code);

    var id = h('div', 'qrow-id');
    id.appendChild(h('div', 'qrow-name', q.name));
    id.appendChild(h('div', 'qrow-code', q.code + (q.sector ? ' · ' + q.sector : '')));
    row.appendChild(id);

    var price = h('div', 'qrow-price num ' + trendClass(q.change_pct), fmt(q.price, 2));
    price.setAttribute('data-field', 'price');
    row.appendChild(price);

    var pctBox = h('div', 'qrow-pct');
    var bt = badgeTextOf(q);
    var badge = h('span', 'pct-badge ' + trendClass(q.change_pct) + (bt ? ' limit' : ''), bt || pct(q.change_pct));
    badge.setAttribute('data-field', 'pct');
    pctBox.appendChild(badge);
    row.appendChild(pctBox);

    var star = h('div', 'qrow-star' + (isWatched(q.code) ? ' on' : ''), isWatched(q.code) ? '★' : '☆');
    star.onclick = function (ev) {
      ev.stopPropagation();
      toggleWatch(q.code);
    };
    row.appendChild(star);

    row.onclick = function () {
      openDetail(q.code);
    };
    return row;
  }

  function isWatched(code) {
    if (S.watch && typeof S.watch[code] === 'boolean') return S.watch[code];
    var list = (S.overview && S.overview.watchlist) || [];
    for (var i = 0; i < list.length; i++) if (list[i].code === code) return true;
    return false;
  }

  function toggleWatch(code) {
    var on = isWatched(code);
    var p = on ? del('/watch/' + code) : post('/watch', { code: code });
    p.then(function () {
      S.watch[code] = !on;
      toast(on ? '已移出自选' : '已加入自选', 'success');
      loadOverview();
      renderMain();
    }).catch(function (e) {
      toast(errMsg(e), 'error');
    });
  }

  // 只更新价格文本，不重建 DOM（避免列表在刷新时闪烁/丢滚动位置）
  function patchQuotes(list) {
    if (!root || !list) return;
    for (var i = 0; i < list.length; i++) {
      var q = list[i];
      var row = root.querySelector('.qrow[data-code="' + q.code + '"]');
      if (!row) continue;
      var pEl = row.querySelector('[data-field="price"]');
      var cEl = row.querySelector('[data-field="pct"]');
      if (pEl) {
        pEl.textContent = fmt(q.price, 2);
        pEl.className = 'qrow-price num ' + trendClass(q.change_pct);
      }
      if (cEl) {
        var bt = badgeTextOf(q);
        cEl.textContent = bt || pct(q.change_pct);
        cEl.className = 'pct-badge ' + trendClass(q.change_pct) + (bt ? ' limit' : '');
      }
    }
  }

  // ================= 收盘报告卡 =================
  function reportCard() {
    var card = h('div', 'report-card');
    var r = S.report;

    var head = h('div', 'report-head');
    head.appendChild(h('span', 'report-tag', '收盘报告'));
    if (r && r.payload) {
      var sh = null;
      var idx = r.payload.indexes || [];
      for (var i = 0; i < idx.length; i++) if (idx[i].code === '000001') sh = idx[i];
      var pctStr = sh ? ('上证 ' + pct(sh.change_pct)) : '已生成';
      head.appendChild(h('span', 'report-title', r.payload.date_key + ' · ' + pctStr));
    } else {
      head.appendChild(h('span', 'report-title', '等待今日收盘'));
    }
    head.appendChild(h('span', 'report-arrow' + (S.reportOpen ? ' open' : ''), '▾'));
    head.onclick = function () {
      S.reportOpen = !S.reportOpen;
      renderMain();
    };
    card.appendChild(head);

    if (S.reportOpen && r && r.payload) {
      var p = r.payload;
      var body = h('div', 'report-body');
      body.appendChild(h('p', 'report-comment', p.comment));

      var idxRow = h('div', 'report-idx');
      for (var j = 0; j < p.indexes.length; j++) {
        var it = p.indexes[j];
        var sp = h('span', 'num ' + trendClass(it.change_pct),
          it.name + ' ' + money(it.price) + ' ' + pct(it.change_pct));
        idxRow.appendChild(sp);
      }
      body.appendChild(idxRow);

      var cols = h('div', 'report-cols');
      cols.appendChild(reportCol('领涨', p.gainers, 'pct'));
      cols.appendChild(reportCol('领跌', p.losers, 'pct'));
      cols.appendChild(reportCol('成交额', p.actives, 'amount'));
      body.appendChild(cols);

      body.appendChild(h('div', 'report-tip', '💡 ' + p.tip));

      var ca = p.class_activity || {};
      var hotStr = '';
      for (var hk = 0; hk < (ca.hot || []).length; hk++) {
        hotStr += (hk ? '、' : '') + ca.hot[hk].name;
      }
      body.appendChild(h('div', 'report-class',
        '本班今日 ' + ca.trades + ' 笔成交 · ' + ca.participants + ' 人参与' + (hotStr ? ' · 最热门：' + hotStr : '')));

      card.appendChild(body);
    }
    return card;
  }

  function reportCol(title, rows, mode) {
    var col = h('div', 'report-col');
    col.appendChild(h('div', 'report-col-h', title));
    for (var i = 0; i < rows.length; i++) {
      var row = h('div', 'report-col-row');
      row.appendChild(h('span', 'n', rows[i].name));
      var cls = '';
      var v;
      if (mode === 'amount') {
        v = money(rows[i].amount / 100000000, 1) + ' 亿';
      } else {
        v = pct(rows[i].change_pct);
        cls = trendClass(rows[i].change_pct);
      }
      row.appendChild(h('span', 'num ' + cls, v));
      col.appendChild(row);
    }
    return col;
  }

  // ================= 个股详情 =================
  function openDetail(code) {
    S.detailCode = code;
    S.detail = null;
    S.detailQuote = null;
    S.chartTab = 'trend';
    S.detailJustOpened = true;   // 刚打开时强制拉一次图表，不吃缓存
    S.hoverIdx = null;
    S.tab = 'market';
    renderMain();
    loadDetail(code);
  }

  function viewDetail() {
    var wrap = h('div', 'view-detail');
    var q = S.detailQuote;

    var top = h('div', 'detail-top');
    var back = h('div', 'back-btn');
    back.appendChild(document.createTextNode('‹ 行情'));
    back.onclick = function () {
      S.detailCode = '';
      S.detail = null;
      S.detailQuote = null;
      renderMain();
    };
    top.appendChild(back);

    var idBox = h('div', 'detail-id');
    idBox.appendChild(h('div', 'detail-name', q ? q.name : S.detailCode));
    idBox.appendChild(h('div', 'detail-code', S.detailCode + (q && q.sector ? ' · ' + q.sector : '')));
    top.appendChild(idBox);

    var px = h('div', 'detail-price');
    var priceEl = h('div', 'detail-px num ' + trendClass(q ? q.change_pct : 0), q ? fmt(q.price, 2) : '--');
    priceEl.setAttribute('data-field', 'dprice');
    px.appendChild(priceEl);
    var chgEl = h('div', 'detail-chg num ' + trendClass(q ? q.change_pct : 0),
      q ? (signed(q.change) + '  ' + pct(q.change_pct)) : '');
    chgEl.setAttribute('data-field', 'dchg');
    px.appendChild(chgEl);
    top.appendChild(px);

    // 自选星标（自选空态文案承诺过「详情页也可以加自选」，这里必须兑现）
    var watched = isWatched(S.detailCode);
    var star = h('div', 'detail-star' + (watched ? ' on' : ''), watched ? '★' : '☆');
    star.onclick = function () { toggleWatch(S.detailCode); };
    top.appendChild(star);
    wrap.appendChild(top);

    // 持仓速览：看 K 线的时候就知道自己的成本，不用来回切「持仓」页
    var myPos = null;
    if (S.overview && S.overview.summary && S.overview.summary.positions) {
      var ps = S.overview.summary.positions;
      for (var pi = 0; pi < ps.length; pi++) {
        if (ps[pi].code === S.detailCode) { myPos = ps[pi]; break; }
      }
    }
    if (myPos) {
      var strip = h('div', 'detail-pos');
      var dpL = h('div', 'dp-left');
      dpL.appendChild(h('div', 'dp-main', '持仓 ' + myPos.qty + ' 股'));
      dpL.appendChild(h('div', 'dp-sub', '成本 ' + fmt(myPos.avg_cost, 2) + ' · 可卖 ' + myPos.available_qty + ' 股'));
      strip.appendChild(dpL);
      strip.appendChild(h('div', 'dp-pnl num ' + trendClass(myPos.pnl),
        signed(myPos.pnl) + '（' + pct(myPos.pnl_pct) + '）'));
      strip.onclick = function () {
        S.tab = 'positions';
        S.detailCode = '';
        S.detail = null;
        S.detailQuote = null;
        renderNav();
        renderMain();
        loadTab('positions');
      };
      wrap.appendChild(strip);
    }

    // 图表
    var chartCard = h('div', 'card');
    var tabs = h('div', 'chart-tabs');
    var seg = h('div', 'seg');
    [['trend', '分时'], ['day', '日K'], ['week', '周K'], ['month', '月K']].forEach(function (item) {
      var b = h('div', 'seg-item' + (S.chartTab === item[0] ? ' active' : ''), item[1]);
      b.onclick = function () {
        if (S.chartTab === item[0]) return;
        S.chartTab = item[0];
        S.hoverIdx = null;
        renderMain();
        loadChart();
      };
      seg.appendChild(b);
    });
    tabs.appendChild(seg);
    if (q) {
      tabs.appendChild(h('div', 'card-more num', '昨收 ' + fmt(q.prev_close, 2)));
    }
    chartCard.appendChild(tabs);

    var chartWrap = h('div', 'chart-wrap');
    var canvas = document.createElement('canvas');
    canvas.setAttribute('data-chart', '1');
    chartWrap.appendChild(canvas);

    // 长按 / 拖动看某一天（或某一分钟）—— 平板没有鼠标悬停，只能按压
    var chartTip = h('div', 'chart-tip');
    chartTip.style.display = 'none';
    chartWrap.appendChild(chartTip);
    S.hoverIdx = null;
    var hovering = false;

    function clearHover() {
      if (S.hoverIdx === null) return;
      S.hoverIdx = null;
      chartTip.style.display = 'none';
      drawChart();
    }
    function hoverAt(ev) {
      if (!chartGeo || !chartGeo.n) return;
      var rect = canvas.getBoundingClientRect();
      if (!rect.width) return;
      var x = ev.clientX - rect.left;
      var i;
      if (chartGeo.kind === 'trend') {
        i = Math.round((x - 1) / Math.max(chartGeo.plotW - 2, 1) * (chartGeo.n - 1));
      } else {
        i = Math.floor(x / Math.max(chartGeo.step, 0.001));
      }
      i = Math.max(0, Math.min(chartGeo.n - 1, i));
      S.hoverIdx = i;
      drawChart();
      var text;
      if (chartGeo.kind === 'trend') {
        var pt = chartGeo.pts[i];
        text = (pt.time || '') + '  价 ' + fmt(pt.price, 2) + '  均 ' + (pt.avg > 0 ? fmt(pt.avg, 2) : '—');
      } else {
        var row = chartGeo.rows[i];
        text = String(row.date || '').slice(5) + '  开' + fmt(row.open, 2) + ' 高' + fmt(row.high, 2) +
          ' 低' + fmt(row.low, 2) + ' 收' + fmt(row.close, 2) + '  量 ' + volText(row.volume);
      }
      chartTip.textContent = text;
      chartTip.style.display = 'block';
      var tw = chartTip.offsetWidth || 200;
      var maxLeft = Math.max(4, (chartWrap.clientWidth || 300) - tw - 4);
      chartTip.style.left = Math.max(4, Math.min(x - tw / 2, maxLeft)) + 'px';
    }
    canvas.addEventListener('pointerdown', function (ev) { hovering = true; hoverAt(ev); });
    canvas.addEventListener('pointermove', function (ev) { if (hovering) hoverAt(ev); });
    canvas.addEventListener('pointerup', function () { hovering = false; clearHover(); });
    canvas.addEventListener('pointercancel', function () { hovering = false; clearHover(); });
    canvas.addEventListener('pointerleave', function () { hovering = false; clearHover(); });
    chartCard.appendChild(chartWrap);
    wrap.appendChild(chartCard);

    // 关键指标
    if (q) {
      var grid = h('div', 'detail-grid');
      // 盘前（约 08:50–09:15）没有真实成交，开盘/最高/最低一律显示 —，
      // 别把「昨收」伪装成「今开」——学生会以为开盘价就是昨天的收盘价
      var noTrade = !!q.pre_open;
      var cells = [
        ['今开', noTrade ? '—' : fmt(q.open, 2), noTrade ? '' : trendClass(q.open - q.prev_close)],
        ['最高', noTrade ? '—' : fmt(q.high, 2), noTrade ? '' : trendClass(q.high - q.prev_close)],
        ['最低', noTrade ? '—' : fmt(q.low, 2), noTrade ? '' : trendClass(q.low - q.prev_close)],
        ['涨停', fmt(q.limit_up, 2), 'up'],
        ['跌停', fmt(q.limit_down, 2), 'down'],
        ['成交额', money(q.amount / 100000000, 2) + ' 亿', ''],
        ['换手', fmt(q.turnover, 2) + '%', ''],
        ['市盈', q.pe > 0 ? fmt(q.pe, 1) : '—', '']
      ];
      for (var i = 0; i < cells.length; i++) {
        var it = h('div', 'dg-item');
        it.appendChild(h('div', 'dg-k', cells[i][0]));
        it.appendChild(h('div', 'dg-v num ' + cells[i][2], cells[i][1]));
        grid.appendChild(it);
      }
      wrap.appendChild(grid);
    }

    // 相关资讯（点了在应用内看摘要，不跳外链）
    wrap.appendChild(stockNewsCard(S.detailCode));

    // 操作按钮
    var act = h('div', 'sheet-foot');
    act.style.display = 'flex';
    act.style.padding = '16px 0 0';
    var buyBtn = h('button', 'submit buy', '买入');
    buyBtn.style.marginRight = '10px';
    buyBtn.onclick = function () { openTrade(S.detailCode, 'buy'); };
    var sellBtn = h('button', 'submit sell', '卖出');
    sellBtn.onclick = function () { openTrade(S.detailCode, 'sell'); };
    act.appendChild(buyBtn);
    act.appendChild(sellBtn);
    wrap.appendChild(act);

    // 首次渲染后画图
    setTimeout(function () { drawChart(); }, 0);
    return wrap;
  }

  function drawChart() {
    if (!root) return;
    var canvas = root.querySelector('canvas[data-chart]');
    if (!canvas) return;
    var wrap = canvas.parentNode;
    var w = wrap.clientWidth || 600;
    var hgt = wrap.clientHeight || 208;
    var dpr = window.devicePixelRatio || 1;
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(hgt * dpr);
    canvas.style.width = w + 'px';
    canvas.style.height = hgt + 'px';
    var ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, hgt);

    if (!S.detail) return;
    chartGeo = null;
    if (S.chartTab === 'trend') drawTrend(ctx, w, hgt, S.detail);
    else drawKline(ctx, w, hgt, S.detail);

    // 十字线（长按/拖动触发）：竖线 + 横线 + 黄点，数值由 DOM 气泡显示
    if (S.hoverIdx != null && chartGeo && chartGeo.n) {
      var hi2 = Math.max(0, Math.min(chartGeo.n - 1, S.hoverIdx));
      var hx = chartGeo.xAt(hi2);
      var hv = chartGeo.kind === 'trend' ? chartGeo.pts[hi2].price : chartGeo.rows[hi2].close;
      var hy = chartGeo.yAt(hv);
      ctx.save();
      ctx.strokeStyle = 'rgba(255,255,255,.42)';
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(hx, chartGeo.top);
      ctx.lineTo(hx, chartGeo.bottom);
      ctx.stroke();
      if (isFinite(hy)) {
        ctx.beginPath();
        ctx.moveTo(0, hy);
        ctx.lineTo(chartGeo.plotW, hy);
        ctx.stroke();
      }
      ctx.setLineDash([]);
      ctx.fillStyle = '#E8C36A';
      ctx.beginPath();
      ctx.arc(hx, hy, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  function gridLines(ctx, w, hgt, rows) {
    ctx.strokeStyle = 'rgba(255,255,255,.045)';
    ctx.lineWidth = 1;
    for (var i = 1; i < rows; i++) {
      var y = Math.round(hgt * i / rows) + 0.5;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }
  }

  function drawTrend(ctx, w, hgt, data) {
    var pts = (data.points || []).filter(function (p) { return p.price > 0; });
    var prev = Number(data.prev_close) || 0;
    if (!pts.length || !prev) {
      var sess = S.overview && S.overview.session;
      ctx.fillStyle = 'rgba(255,255,255,.28)';
      ctx.font = '12px -apple-system, sans-serif';
      ctx.textAlign = 'center';
      // 盘前/午休/收盘后本来就没有当日分时，别让学生以为是应用坏了
      ctx.fillText(sess && !sess.settles ? '休市中 · 开盘后自动显示当日分时' : '暂无分时数据', w / 2, hgt / 2);
      return;
    }

    var padTop = 12;
    var padBottom = 20;
    var padRight = 52;
    var plotW = w - padRight;
    var plotH = hgt - padTop - padBottom;

    var maxDev = 0;
    for (var i = 0; i < pts.length; i++) {
      var dev = Math.abs(pts[i].price - prev) / prev;
      if (dev > maxDev) maxDev = dev;
    }
    // 至少 ±1%，否则一条几乎水平的线在视觉上没有信息量
    maxDev = Math.max(maxDev * 1.15, 0.01);

    var midY = padTop + plotH / 2;
    var scale = (plotH / 2) / (prev * maxDev);

    // 昨收虚线
    ctx.strokeStyle = 'rgba(255,255,255,.18)';
    ctx.setLineDash([3, 4]);
    ctx.beginPath();
    ctx.moveTo(0, midY + 0.5);
    ctx.lineTo(plotW, midY + 0.5);
    ctx.stroke();
    ctx.setLineDash([]);

    // 区域填充
    var lastPrice = pts[pts.length - 1].price;
    var up = lastPrice >= prev;
    var lineColor = up ? '#F5535A' : '#22B573';
    var fillTop = up ? 'rgba(245,83,90,.22)' : 'rgba(34,181,115,.22)';
    var fillBottom = up ? 'rgba(245,83,90,0)' : 'rgba(34,181,115,0)';

    function xAt(i) { return (i / Math.max(pts.length - 1, 1)) * (plotW - 2) + 1; }
    function yAt(p) { return midY - (p - prev) * scale; }

    var grad = ctx.createLinearGradient(0, padTop, 0, padTop + plotH);
    grad.addColorStop(0, fillTop);
    grad.addColorStop(1, fillBottom);

    ctx.beginPath();
    ctx.moveTo(xAt(0), yAt(pts[0].price));
    for (var j = 1; j < pts.length; j++) ctx.lineTo(xAt(j), yAt(pts[j].price));
    ctx.lineTo(xAt(pts.length - 1), padTop + plotH);
    ctx.lineTo(xAt(0), padTop + plotH);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(xAt(0), yAt(pts[0].price));
    for (var k = 1; k < pts.length; k++) ctx.lineTo(xAt(k), yAt(pts[k].price));
    ctx.strokeStyle = lineColor;
    ctx.lineWidth = 1.6;
    ctx.lineJoin = 'round';
    ctx.stroke();

    // 均价线（黄）
    var hasAvg = pts.some(function (p) { return p.avg > 0; });
    if (hasAvg) {
      ctx.beginPath();
      for (var m = 0; m < pts.length; m++) {
        var ay = pts[m].avg > 0 ? yAt(pts[m].avg) : yAt(pts[m].price);
        if (m === 0) ctx.moveTo(xAt(m), ay); else ctx.lineTo(xAt(m), ay);
      }
      ctx.strokeStyle = 'rgba(232,195,106,.75)';
      ctx.lineWidth = 1.1;
      ctx.stroke();
    }

    // 右侧价格刻度：只留 上界 / 现价 / 下界 三个（昨收靠虚线表达，避免挤成一团）
    ctx.font = '10px ui-monospace, Consolas, monospace';
    ctx.textAlign = 'left';
    ctx.fillStyle = up ? '#F5535A' : '#22B573';
    ctx.fillText(fmt(lastPrice, 2), plotW + 6, yAt(lastPrice) + 3.5);

    ctx.fillStyle = 'rgba(255,255,255,.34)';
    ctx.fillText(fmt(prev * (1 + maxDev), 2), plotW + 6, padTop + 4);
    ctx.fillText(fmt(prev * (1 - maxDev), 2), plotW + 6, padTop + plotH);

    // 时间轴
    ctx.fillStyle = 'rgba(255,255,255,.24)';
    ctx.textAlign = 'left';
    ctx.fillText('09:30', 2, hgt - 6);
    ctx.textAlign = 'right';
    ctx.fillText('15:00', plotW - 2, hgt - 6);

    chartGeo = {
      kind: 'trend', n: pts.length, plotW: plotW, xAt: xAt, yAt: yAt, pts: pts,
      top: padTop, bottom: padTop + plotH
    };
  }

  function drawKline(ctx, w, hgt, data) {
    var rows = data.klines || [];
    if (!rows.length) {
      ctx.fillStyle = 'rgba(255,255,255,.28)';
      ctx.font = '12px -apple-system, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('暂无 K 线数据', w / 2, hgt / 2);
      return;
    }

    var padTop = 12;
    var padBottom = 18;
    var padRight = 50;
    var plotW = w - padRight;
    var plotH = hgt - padTop - padBottom;

    // 成交量副图占下方 26%，与蜡烛共用 x 轴 ——「量价配合」是看盘第一课，
    // 只有价格没有量，学生看不出「放量上涨」和「缩量上涨」的区别。
    var volH = Math.round(plotH * 0.26);
    var priceH = plotH - volH - 8;
    var volTop = padTop + priceH + 8;

    var hi = -Infinity, lo = Infinity;
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].high > hi) hi = rows[i].high;
      if (rows[i].low < lo) lo = rows[i].low;
    }
    if (!isFinite(hi) || !isFinite(lo) || hi <= lo) { hi = lo + 1; }
    var pad = (hi - lo) * 0.06;
    hi += pad; lo -= pad;

    var maxVol = 0;
    for (var vi = 0; vi < rows.length; vi++) {
      if (rows[vi].volume > maxVol) maxVol = rows[vi].volume;
    }
    if (!maxVol) maxVol = 1;

    var step = plotW / rows.length;
    var bodyW = Math.max(1.5, Math.min(step * 0.62, 7));

    function yOf(v) { return padTop + (hi - v) / (hi - lo) * priceH; }

    gridLines(ctx, plotW, priceH + padTop, 4);

    for (var j = 0; j < rows.length; j++) {
      var r = rows[j];
      var x = j * step + step / 2;
      var isUp = r.close >= r.open;
      var color = isUp ? '#F5535A' : '#22B573';

      // 影线
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(Math.round(x) + 0.5, yOf(r.high));
      ctx.lineTo(Math.round(x) + 0.5, yOf(r.low));
      ctx.stroke();

      // 实体
      var y1 = yOf(Math.max(r.open, r.close));
      var y2 = yOf(Math.min(r.open, r.close));
      var bh = Math.max(1, y2 - y1);
      ctx.fillStyle = color;
      ctx.fillRect(x - bodyW / 2, y1, bodyW, bh);

      // 成交量柱（与蜡烛同色、半透明，避免抢视线）
      var vh = Math.max(1, (r.volume / maxVol) * volH);
      ctx.fillStyle = isUp ? 'rgba(245,83,90,.5)' : 'rgba(34,181,115,.5)';
      ctx.fillRect(x - bodyW / 2, volTop + volH - vh, bodyW, vh);
    }

    // 量能区隔线与标注
    ctx.strokeStyle = 'rgba(255,255,255,.08)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, volTop - 2.5);
    ctx.lineTo(plotW, volTop - 2.5);
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,.24)';
    ctx.font = '9px ui-monospace, Consolas, monospace';
    ctx.textAlign = 'left';
    ctx.fillText('成交量', 2, volTop + 9);

    // 均线 MA20
    if (rows.length >= 20) {
      ctx.beginPath();
      var started = false;
      for (var m = 19; m < rows.length; m++) {
        var sum = 0;
        for (var n = m - 19; n <= m; n++) sum += rows[n].close;
        var ma = sum / 20;
        var mx = m * step + step / 2;
        var my = yOf(ma);
        if (!started) { ctx.moveTo(mx, my); started = true; } else ctx.lineTo(mx, my);
      }
      ctx.strokeStyle = 'rgba(232,195,106,.8)';
      ctx.lineWidth = 1.2;
      ctx.stroke();
    }

    // 价格刻度
    ctx.font = '10px ui-monospace, Consolas, monospace';
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(255,255,255,.34)';
    ctx.fillText(fmt(hi, 2), plotW + 6, padTop + 4);
    ctx.fillText(fmt((hi + lo) / 2, 2), plotW + 6, padTop + priceH / 2 + 3.5);
    ctx.fillText(fmt(lo, 2), plotW + 6, padTop + priceH);

    // 日期
    ctx.textAlign = 'left';
    ctx.fillText(String(rows[0].date).slice(5), 2, hgt - 5);
    ctx.textAlign = 'right';
    ctx.fillText(String(rows[rows.length - 1].date).slice(5), plotW - 2, hgt - 5);

    chartGeo = {
      kind: 'kline', n: rows.length, plotW: plotW, step: step,
      xAt: function (i) { return i * step + step / 2; }, yAt: yOf, rows: rows,
      top: padTop, bottom: padTop + priceH
    };
  }

  // ================= 持仓 =================
  function viewPositions() {
    var wrap = h('div', 'view-positions');
    var ov = S.overview;
    if (!ov) return loadingBox('加载资产');

    var sum = ov.summary;
    wrap.appendChild(heroCard(sum));

    var head = h('div', 'chart-tabs');
    head.appendChild(h('div', 'card-title', '我的持仓'));
    head.appendChild(h('div', 'card-more', sum.stats.position_count + ' 只 · 累计交易 ' + sum.stats.trade_count + ' 笔'));
    wrap.appendChild(head);

    if (!sum.positions.length) {
      wrap.appendChild(emptyBox('◱', '还没有持仓', '去行情里挑一只，用学元买入试试'));
    } else {
      var card = h('div', 'card');
      for (var i = 0; i < sum.positions.length; i++) {
        card.appendChild(positionCard(sum.positions[i]));
      }
      wrap.appendChild(card);
    }

    wrap.appendChild(achievementsCard());
    wrap.appendChild(ledgerCard());

    // 底部说明：T+0（教学盘放宽）
    var note = h('div', 'submit-warn', '今天买入的股票也能立刻卖出（教学盘放宽了真实 A 股的 T+1，因为平板不是天天开机）。真实市场记住：A 股是次日才能卖。');
    wrap.appendChild(note);
    return wrap;
  }

  // ---- 成就墙 ----
  function achievementsCard() {
    var a = S.achievements;
    var head = h('div', 'chart-tabs');
    head.appendChild(h('div', 'card-title', '我的成就'));
    head.appendChild(h('div', 'card-more', a ? a.unlocked_count + ' / ' + a.total : ''));
    var wrap = h('div');
    wrap.appendChild(head);

    if (!a) {
      var ld = h('div', 'card');
      ld.appendChild(h('div', 'loading', '加载成就…'));
      wrap.appendChild(ld);
      return wrap;
    }

    var card = h('div', 'card');
    var grid = h('div', 'ach-grid');
    for (var i = 0; i < a.list.length; i++) {
      (function (item) {
        var it = h('div', 'ach-item' + (item.unlocked ? ' unlocked' : ''));
        it.appendChild(h('div', 'ach-ico', item.icon));
        it.appendChild(h('div', 'ach-nm', item.label));
        it.appendChild(h('div', 'ach-rw', '+' + item.reward + ' 学元'));
        it.onclick = function () {
          toast(item.icon + ' ' + item.label + '：' + item.desc + (item.unlocked ? '' : '（未解锁）'), item.unlocked ? 'success' : '');
        };
        grid.appendChild(it);
      })(a.list[i]);
    }
    card.appendChild(grid);
    wrap.appendChild(card);
    return wrap;
  }

  // ---- 资金流水（学元账本）----
  function fmtDateTime(ts) {
    var d = new Date(Number(ts));
    if (!isFinite(d.getTime())) return '';
    var mm = ('0' + (d.getMonth() + 1)).slice(-2);
    var dd = ('0' + d.getDate()).slice(-2);
    var hh = ('0' + d.getHours()).slice(-2);
    var mi = ('0' + d.getMinutes()).slice(-2);
    return mm + '-' + dd + ' ' + hh + ':' + mi;
  }

  function ledgerRow(it) {
    var row = h('div', 'ledger-row');
    var left = h('div', 'lg-left');
    left.appendChild(h('div', 'lg-title', it.kind_label || it.kind));
    var sub = it.memo || '';
    if (sub) {
      var s = h('div', 'lg-sub', sub);
      s.title = sub;
      left.appendChild(s);
    }
    left.appendChild(h('div', 'lg-time num', fmtDateTime(it.created_at)));
    row.appendChild(left);

    var right = h('div', 'lg-right');
    var d = Number(it.delta) || 0;
    right.appendChild(h('div', 'lg-amt num ' + (d > 0 ? 'up' : (d < 0 ? 'down' : '')), signed(d)));
    right.appendChild(h('div', 'lg-bal num', '余额 ' + money(it.balance_after)));
    row.appendChild(right);
    return row;
  }

  function ledgerCard() {
    var box = h('div');
    var head = h('div', 'chart-tabs');
    head.appendChild(h('div', 'card-title', '资金流水'));
    var ov = S.overview;
    head.appendChild(h('div', 'card-more num', ov ? '余额 ' + money(ov.summary.cash.balance) + ' 学元' : ''));
    box.appendChild(head);

    var card = h('div', 'card');
    if (!S.ledger) {
      card.appendChild(h('div', 'loading', '加载流水…'));
    } else if (!S.ledger.list.length) {
      card.appendChild(h('div', 'empty-mini', '还没有流水记录，买入第一只股票就会有了'));
    } else {
      var list = S.ledger.list.slice(0, 6);
      for (var i = 0; i < list.length; i++) card.appendChild(ledgerRow(list[i]));
      var more = h('div', 'ledger-more', '查看全部流水 ›');
      more.onclick = function () {
        S.subview = 'ledger';
        renderMain();
        if (S.ledger && S.ledger.list.length < 20) loadLedger(false);
      };
      card.appendChild(more);
    }
    box.appendChild(card);
    return box;
  }

  function viewLedger() {
    var wrap = h('div', 'view-ledger');
    var top = h('div', 'detail-top');
    var back = h('div', 'back-btn');
    back.appendChild(document.createTextNode('‹ 持仓'));
    back.onclick = function () { S.subview = ''; renderMain(); };
    top.appendChild(back);

    var idBox = h('div', 'detail-id');
    idBox.appendChild(h('div', 'detail-name', '资金流水'));
    var ov = S.overview;
    idBox.appendChild(h('div', 'detail-code',
      ov ? '可用 ' + money(ov.summary.cash.available) + ' · 余额 ' + money(ov.summary.cash.balance) : '学元账本'));
    top.appendChild(idBox);
    wrap.appendChild(top);

    if (!S.ledger) {
      wrap.appendChild(loadingBox('加载流水'));
      return wrap;
    }
    if (!S.ledger.list.length) {
      wrap.appendChild(emptyBox('▤', '还没有流水记录', '买入、卖出、领津贴、班管发放都会记在这里'));
      return wrap;
    }

    var card = h('div', 'card');
    for (var i = 0; i < S.ledger.list.length; i++) card.appendChild(ledgerRow(S.ledger.list[i]));
    wrap.appendChild(card);

    if (S.ledger.next_before_id) {
      var moreBtn = h('button', 'ledger-more-btn', '加载更多');
      moreBtn.onclick = function () { loadLedger(false); };
      wrap.appendChild(moreBtn);
    } else {
      wrap.appendChild(h('div', 'submit-warn', '已到最早一笔。每一笔都能对上：买入扣「成交额 + 费用」，卖出得「成交额 − 费用」。'));
    }
    return wrap;
  }

  function positionCard(p) {
    var card = h('div', 'pos-card');

    var l1 = h('div', 'pos-line1');
    var name = h('div', 'pos-name');
    name.appendChild(document.createTextNode(p.name));
    if (p.t1_locked_qty > 0) {
      name.appendChild(h('span', 'pos-tag', '锁 ' + p.t1_locked_qty));
    }
    l1.appendChild(name);

    var pnl = h('div', 'pos-pnl num ' + trendClass(p.pnl), signed(p.pnl));
    l1.appendChild(pnl);
    card.appendChild(l1);

    var l2 = h('div', 'pos-line2');
    l2.appendChild(cell('持仓', p.qty + ' 股'));
    l2.appendChild(cell('可用', p.available_qty + ' 股'));
    l2.appendChild(cell('成本', fmt(p.avg_cost, 2)));
    var last = cell('现价', fmt(p.price, 2));
    last.querySelector('.pos-v').className = 'pos-v num ' + trendClass(p.change_pct);
    l2.appendChild(last);
    card.appendChild(l2);

    var l3 = h('div', 'pos-line2');
    l3.style.marginTop = '6px';
    var mv = cell('市值', money(p.market_value));
    l3.appendChild(mv);
    var pctCell = cell('盈亏比例', pct(p.pnl_pct));
    pctCell.querySelector('.pos-v').className = 'pos-v num ' + trendClass(p.pnl);
    l3.appendChild(pctCell);
    var dayCell = cell('今日', signed(p.day_pnl));
    dayCell.querySelector('.pos-v').className = 'pos-v num ' + trendClass(p.day_pnl);
    l3.appendChild(dayCell);
    card.appendChild(l3);

    card.onclick = function () { openDetail(p.code); };
    return card;
  }

  function cell(k, v) {
    var c = h('div', 'pos-cell');
    c.appendChild(h('div', 'pos-k', k));
    c.appendChild(h('div', 'pos-v num', v));
    return c;
  }

  // ================= 委托 / 成交 =================
  function viewOrders() {
    var wrap = h('div', 'view-orders');
    var bar = h('div', 'chart-tabs');
    var seg = h('div', 'seg');
    [['pending', '当前委托'], ['all', '全部委托'], ['trades', '成交记录']].forEach(function (item) {
      var active = (S.ordersTab || 'pending') === item[0];
      var b = h('div', 'seg-item' + (active ? ' active' : ''), item[1]);
      b.onclick = function () {
        S.ordersTab = item[0];
        renderMain();
        loadOrders();
      };
      seg.appendChild(b);
    });
    bar.appendChild(seg);
    wrap.appendChild(bar);

    var tab = S.ordersTab || 'pending';

    if (tab === 'trades') {
      if (!S.trades) return (wrap.appendChild(loadingBox('加载成交')), wrap);
      if (!S.trades.length) {
        wrap.appendChild(emptyBox('⇄', '还没有成交记录', '委托成交后会出现在这里'));
        return wrap;
      }
      var tc = h('div', 'card');
      var th = h('div', 'tbl-head');
      th.appendChild(h('div', 'tc-1', '股票'));
      th.appendChild(h('div', 'tc-2', '成交价'));
      th.appendChild(h('div', 'tc-3', '数量'));
      th.appendChild(h('div', 'tc-4', '金额 / 费用'));
      tc.appendChild(th);
      for (var i = 0; i < S.trades.length; i++) {
        var t = S.trades[i];
        var row = h('div', 'trow');
        var c1 = h('div', 'tc-1');
        c1.appendChild(h('span', 'side-tag ' + t.side, t.side_label));
        c1.appendChild(h('span', null, t.name));
        row.appendChild(c1);
        row.appendChild(h('div', 'tc-2 num', fmt(t.price, 2)));
        row.appendChild(h('div', 'tc-3 num', t.qty));
        var c4 = h('div', 'tc-4 num');
        c4.appendChild(h('div', null, money(t.amount)));
        c4.appendChild(h('div', 'flat', '费 ' + fmt(t.fee, 2)));
        row.appendChild(c4);
        // 点一行看费用明细：佣金 / 印花税 / 过户费 —— 「为什么赚了却少了钱」都在这
        (function (tr, rw) {
          rw.onclick = function () {
            var fd = tr.fee_detail || {};
            var parts = [
              '佣金 ' + fmt(fd.commission || 0, 2),
              '印花税 ' + fmt(fd.stamp || 0, 2),
              '过户费 ' + fmt(fd.transfer || 0, 2)
            ];
            var extra = tr.side === 'sell' ? ' · 已实现 ' + signed(tr.realized) : '';
            toast(tr.name + ' ' + tr.side_label + ' ' + tr.qty + ' 股 @' + fmt(tr.price, 2) +
              '：' + parts.join(' · ') + extra + '（合计 ' + fmt(tr.fee, 2) + ' 学元）');
          };
        })(t, row);
        tc.appendChild(row);
      }
      wrap.appendChild(tc);
      return wrap;
    }

    if (!S.orders) return (wrap.appendChild(loadingBox('加载委托')), wrap);

    var list = tab === 'pending'
      ? S.orders.filter(function (o) { return o.status === 'pending'; })
      : S.orders;

    if (!list.length) {
      wrap.appendChild(emptyBox('▤', tab === 'pending' ? '没有未成交的委托' : '还没有委托记录', '下单后可以在这里撤单'));
      return wrap;
    }

    var card = h('div', 'card');
    var head = h('div', 'tbl-head');
    head.appendChild(h('div', 'tc-1', '股票 / 方向'));
    head.appendChild(h('div', 'tc-2', '委托价'));
    head.appendChild(h('div', 'tc-3', '数量'));
    head.appendChild(h('div', 'tc-4', '状态'));
    card.appendChild(head);

    for (var j = 0; j < list.length; j++) {
      card.appendChild(orderRow(list[j]));
    }
    wrap.appendChild(card);

    var note = h('div', 'submit-warn', '委托会一直有效，直到成交或撤单；晚上和周末挂的单，开盘后自动撮合。');
    wrap.appendChild(note);
    return wrap;
  }

  function orderRow(o) {
    var row = h('div', 'trow');
    var c1 = h('div', 'tc-1');
    c1.appendChild(h('span', 'side-tag ' + o.side, o.side_label));
    c1.appendChild(h('span', null, o.name));
    var sub = h('div', 'flat');
    sub.style.fontSize = '10px';
    sub.style.marginTop = '2px';
    sub.textContent = o.type_label + ' · ' + todayLabel(o.created_at);
    c1.appendChild(sub);
    row.appendChild(c1);

    var priceCell = h('div', 'tc-2 num');
    priceCell.appendChild(h('div', null, o.type === 'market' ? '市价' : fmt(o.price, 2)));
    // 未成交的买单要显示冻结了多少学元 —— 学生对账时最常问的就是「我的钱去哪了」
    if (o.status === 'pending' && o.side === 'buy' && o.hold > 0) {
      var holdLine = h('div', 'flat');
      holdLine.style.fontSize = '10px';
      holdLine.style.marginTop = '2px';
      holdLine.textContent = '冻结 ' + money(o.hold);
      priceCell.appendChild(holdLine);
    }
    row.appendChild(priceCell);
    row.appendChild(h('div', 'tc-3 num', o.qty));

    var c4 = h('div', 'tc-4');
    if (o.status === 'pending' && o.can_cancel) {
      var btn = h('button', 'cancel-btn', '撤单');
      btn.onclick = function (ev) {
        ev.stopPropagation();
        cancelOrder(o.id);
      };
      c4.appendChild(btn);
    } else {
      c4.appendChild(h('span', 'status-tag ' + o.status, o.status_label));
      // 成交价 / 失效原因：撤单、拒绝之后学生最想知道「为什么」
      var sub2 = null;
      if (o.status === 'filled' && o.avg_fill > 0) {
        sub2 = h('div', 'flat', '成交价 ' + fmt(o.avg_fill, 2));
      } else if (o.reason) {
        sub2 = h('div', 'flat', o.reason);
      }
      if (sub2) {
        sub2.style.fontSize = '10px';
        sub2.style.marginTop = '2px';
        sub2.style.whiteSpace = 'normal';
        sub2.style.lineHeight = '1.4';
        c4.appendChild(sub2);
      }
    }
    row.appendChild(c4);
    return row;
  }

  function cancelOrder(id) {
    post('/order/' + id + '/cancel').then(function (r) {
      toast('已撤单，冻结资金已解冻', 'success');
      if (r.data && r.data.summary && S.overview) S.overview.summary = r.data.summary;
      loadOrders();
      loadOverview();
      loadLedger(true);   // 撤单解冻会写一笔流水，必须刷新，否则学生看到的余额对不上
      loadNotify(true);
    }).catch(function (e) {
      toast(errMsg(e), 'error');
    });
  }

  // ================= 排行 =================
  function viewRank() {
    var wrap = h('div', 'view-rank');
    if (!S.rank) return (wrap.appendChild(loadingBox('加载排行')), wrap);

    // 跨班对决（每周五收盘结算，胜方全班活跃学生拿学元）
    wrap.appendChild(vsCard());

    if (S.rank.me) {
      var bar = h('div', 'rank-bar');
      var l = h('div');
      l.appendChild(h('div', 'card-title', '我的排名'));
      l.appendChild(h('div', 'hero-label', '共 ' + S.rank.total + ' 位同学参与'));
      bar.appendChild(l);
      var r = h('div');
      r.style.textAlign = 'right';
      r.appendChild(h('div', 'rank-asset num', '第 ' + S.rank.me.rank + ' 名'));
      var rr = h('div', 'rank-pct num ' + trendClass(S.rank.me.return_pct), pct(S.rank.me.return_pct));
      r.appendChild(rr);
      bar.appendChild(r);
      wrap.appendChild(bar);
    }

    if (!S.rank.list.length) {
      wrap.appendChild(emptyBox('≡', '榜单还没有人', '开始交易后就会出现在这里'));
      return wrap;
    }

    var card = h('div', 'card');
    for (var i = 0; i < S.rank.list.length; i++) {
      var it = S.rank.list[i];
      var row = h('div', 'rank-row' + (it.rank <= 3 ? ' top' + it.rank : ''));
      row.appendChild(h('div', 'rank-no', it.rank));
      var nm = h('div', 'rank-name', it.net_name || it.user_id);
      if (S.rank.me && it.user_id === S.rank.me.user_id) nm.appendChild(h('span', 'rank-me', '我'));
      row.appendChild(nm);
      var v = h('div', 'rank-val');
      v.appendChild(h('div', 'rank-asset num', money(it.total_asset)));
      v.appendChild(h('div', 'rank-pct num ' + trendClass(it.pnl), signed(it.pnl) + ' · ' + pct(it.return_pct)));
      row.appendChild(v);
      card.appendChild(row);
    }
    wrap.appendChild(card);

    var note = h('div', 'submit-warn', '排名按「总资产」排序：可用学元 + 冻结学元 + 持仓市值。收益率 = 累计盈亏 ÷ 净投入（按成交流水反推，含手续费），与资产页口径一致。');
    wrap.appendChild(note);
    return wrap;
  }

  // ---- 跨班对决卡 ----
  function vsCard() {
    var wrap = h('div');
    var p = S.peer;

    var card = h('div', 'vs-card');
    var title = h('div', 'vs-title');
    title.appendChild(h('div', 't', '班级对决'));
    title.appendChild(h('div', 's', '每周五收盘结算'));
    card.appendChild(title);

    if (!p) {
      card.appendChild(h('div', 'vs-empty', '对决数据加载中…'));
      wrap.appendChild(card);
      return wrap;
    }

    var my = p.my || {};
    var peer = p.peer;
    var weekly = p.weekly || {};

    // 胜负按双方人均收益率比较；任一方收益率缺失时不挂奖杯
    var myAvg = Number(my.avg_return) || 0;
    var peerAvg = peer && peer.fresh ? (Number(peer.payload && peer.payload.avg_return) || 0) : null;

    var main = h('div', 'vs-main');
    main.appendChild(vsSide(my.class_name || '本班', myAvg, my.participants, peerAvg !== null && myAvg > peerAvg));

    var mid = h('div', 'vs-mid');
    mid.appendChild(h('div', 'vs-badge', 'VS'));
    main.appendChild(mid);

    if (peer && peer.fresh) {
      main.appendChild(vsSide(
        peer.class_name,
        peerAvg,
        peer.payload && peer.payload.participants,
        peerAvg > myAvg
      ));
    } else {
      var empty = h('div', 'vs-side');
      empty.appendChild(h('div', 'cn', '???'));
      empty.appendChild(h('div', 'av flat', '--'));
      empty.appendChild(h('div', 'ppl', '等待隔壁班战报'));
      main.appendChild(empty);
    }
    card.appendChild(main);

    // 胜负标记 + 本周状态
    var notes = [];
    if (weekly.settled && weekly.this_week) {
      var tw = weekly.this_week;
      if (tw.winner_class === my.class_no) notes.push('本周已结算：🏆 本班获胜，' + tw.rewarded_count + ' 人各得 ' + weekly.reward + ' 学元');
      else if (tw.winner_class === '') notes.push('本周已结算：平局，双方不开奖');
      else notes.push('本周已结算：' + peerClassLabel(p, tw.winner_class) + ' 获胜，下周再战');
    } else if (!peer || !peer.fresh) {
      notes.push('还没有收到隔壁班的战报 —— 对端也要安装本应用并联网（战报每 30 分钟同步一次）。');
    } else {
      notes.push('收益率领先到周五收盘的班级获胜，全班活跃学生每人 ' + weekly.reward + ' 学元。');
    }
    if (weekly.last && weekly.last.week_key && weekly.last.winner_class) {
      notes.push('上一场：' + weekly.last.week_key + '，' +
        (weekly.last.winner_class === my.class_no ? '本班获胜 🏆' : peerClassLabel(p, weekly.last.winner_class) + ' 获胜'));
    }
    card.appendChild(h('div', 'vs-note', notes.join('　·　')));

    wrap.appendChild(card);

    // 合并收益率榜（本班实时 + 对端战报）
    var merged = [];
    var myTop = (my.top || []).slice();
    for (var i = 0; i < myTop.length; i++) {
      merged.push({ name: myTop[i].net_name, return_pct: myTop[i].return_pct, cls: 'mine' });
    }
    if (peer && peer.fresh && peer.payload && Array.isArray(peer.payload.top)) {
      for (var j = 0; j < peer.payload.top.length; j++) {
        merged.push({ name: peer.payload.top[j].net_name, return_pct: peer.payload.top[j].return_pct, cls: 'peer' });
      }
    }
    merged.sort(function (a, b) { return b.return_pct - a.return_pct; });
    merged = merged.slice(0, 10);

    if (merged.length) {
      var head = h('div', 'vs-merged-head');
      head.appendChild(h('div', 'card-title', '跨班收益率榜'));
      head.appendChild(h('div', 'card-more', merged.length + ' 人'));
      wrap.appendChild(head);

      var card2 = h('div', 'card');
      for (var k = 0; k < merged.length; k++) {
        var m = merged[k];
        var row = h('div', 'mrow');
        row.appendChild(h('div', 'm-no', k + 1));
        var nm = h('div', 'm-name', m.name);
        row.appendChild(nm);
        row.appendChild(h('span', 'm-cls ' + m.cls, m.cls === 'mine' ? '本班' : (p.peer ? p.peer.class_name : '对端')));
        var val = h('div', 'm-val');
        val.appendChild(h('div', 'm-pct num ' + trendClass(m.return_pct), pct(m.return_pct)));
        row.appendChild(val);
        card2.appendChild(row);
      }
      var box = h('div', 'vs-merged');
      box.appendChild(card2);
      wrap.appendChild(box);
    }

    return wrap;
  }

  function peerClassLabel(p, classNo) {
    if (p && p.peer && String(p.peer.class_no) === String(classNo)) return p.peer.class_name;
    var n = parseInt(classNo, 10);
    return (isFinite(n) ? n : classNo) + ' 班';
  }

  // 对决双方的一侧。isWinner 由 vsCard 比较双方人均收益率后传入。
  // ⚠️ 这个函数此前从未实现过：peer 战报一到（两班部署后 30 分钟内必到），
  // vsCard 就抛 ReferenceError，renderMain 中途死掉留下白屏，而 loadRank
  // 的 catch 只弹一个 toast —— 表现为「排行页偶尔白屏、刷新又好了」。
  // 2026-11-03 UI 探针抓到，补实现。
  function vsSide(name, avgReturn, participants, isWinner) {
    var side = h('div', 'vs-side' + (isWinner ? ' winner' : ''));
    side.appendChild(h('div', 'cn', name || '本班'));
    var v = Number(avgReturn) || 0;
    side.appendChild(h('div', 'av num ' + trendClass(v), pct(v)));
    side.appendChild(h('div', 'ppl', (Number(participants) || 0) + ' 人参与'));
    return side;
  }

  // ================= 新手教程 / 指南 =================
  // 两层设计：
  //   · 首次进入 → 分步引导（TOUR_STEPS，遮罩高亮真实界面，5 步）；
  //   · 随时查阅 → 「指南」页（11 节：上手流程 / 读盘 / 下单 / 费用算例 / 术语表…）。
  // 完成或跳过一次后写 localStorage；「指南」页可随时重看。
  var GUIDE_KEY = 'ci-stock-guide-v1';

  function guideDone() {
    try { return localStorage.getItem(GUIDE_KEY) === '1'; } catch (e) { return true; }
  }
  function markGuideDone() {
    try { localStorage.setItem(GUIDE_KEY, '1'); } catch (e) {}
  }

  var TOUR_STEPS = [
    {
      target: '.hero',
      title: '这是你的账户',
      body: '开户送 <b>1000 学元</b>，首次进入本应用再发 <b>9000 投资练习金</b>。这里所有盈亏都只是学元：不能充值、不能提现，也不会变成真钱。'
    },
    {
      target: '.sector-chips',
      title: '先挑板块，再挑股票',
      body: '<b>20 个板块</b>横着滑：消费、金融、AI 链、AI 大模型、小米产业链……点一个就只看它。右边搜索框支持代码、名称、板块（试试输入「平安」或「600519」）。'
    },
    {
      target: '.market-list .qrow',
      title: '红涨绿跌，点开看详情',
      body: '<b>红 = 涨，绿 = 跌</b>（A 股习惯，和欧美相反）。右边星标加入自选；点一行进详情 —— 分时 / 日 K / 周 K / 月 K，<b>长按图表能看某一天的开高低收</b>。'
    },
    {
      target: '.nav',
      title: '六个功能页',
      body: '持仓看成本与可卖，委托看挂单和撤单，排行看班级名次与跨班对决，指南随时查教程，规则是交易规则原文。'
    },
    {
      target: '.notify-bell',
      title: '有情况它会叫你',
      body: '持仓涨跌超 5%、涨停跌停、浮亏浮盈、委托成交 —— 顶栏<b>铃铛</b>都会提醒你。红点是未读数，点开就能看，不用一直盯盘。'
    },
    {
      target: null,
      title: '三条最重要的规则',
      body: '<b>T+0（本盘）</b>：当天买的当天就能卖 —— 平板不是天天开机，不卡你。<br><b>手续费</b>：一买一卖至少 10 学元起，交易越勤亏得越快。<br><b>涨跌停</b>：涨停买不到、跌停卖不掉 —— 挂上了不等于会成交。'
    }
  ];

  function startTour() {
    if (!root) return;
    S.tour = 0;
    renderTourStep();
  }

  function endTour() {
    S.tour = null;
    var layer = root && root.querySelector('.tour-layer');
    if (layer && layer.parentNode) layer.parentNode.removeChild(layer);
  }

  function renderTourStep() {
    if (S.tour === null || !root) return;
    var step = TOUR_STEPS[S.tour];
    var layer = root.querySelector('.tour-layer');
    if (!layer) {
      layer = h('div', 'tour-layer ci-stock-tour');
      root.appendChild(layer);
    }
    clear(layer);
    // 遮罩层阻断底层点击：引导期间只认教程按钮，避免误触导航/下单
    layer.appendChild(h('div', 'tour-block'));

    var rootRect = root.getBoundingClientRect();
    var rect = null;
    var target = step.target ? root.querySelector(step.target) : null;
    if (target) {
      try { target.scrollIntoView({ block: 'center' }); } catch (e) {}
      var r = target.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) {
        rect = r;
        var hole = h('div', 'tour-hole');
        hole.style.left = (r.left - rootRect.left - 5) + 'px';
        hole.style.top = (r.top - rootRect.top - 5) + 'px';
        hole.style.width = (r.width + 10) + 'px';
        hole.style.height = (r.height + 10) + 'px';
        layer.appendChild(hole);
      }
    }

    var tip = h('div', 'tour-tip ci-stock-tour-tip');
    var head = h('div', 'tour-head');
    head.appendChild(h('div', 'tour-step', '第 ' + (S.tour + 1) + ' / ' + TOUR_STEPS.length + ' 步'));
    var skip = h('div', 'tour-skip', '跳过');
    skip.onclick = function () {
      markGuideDone();
      endTour();
      toast('可以随时在「指南」页重看新手引导');
    };
    head.appendChild(skip);
    tip.appendChild(head);

    tip.appendChild(h('div', 'tour-title', step.title));
    var bodyEl = h('div', 'tour-body');
    bodyEl.innerHTML = step.body;
    tip.appendChild(bodyEl);

    var acts = h('div', 'tour-actions');
    if (S.tour > 0) {
      var prev = h('button', 'tour-prev', '上一步');
      prev.onclick = function () { S.tour--; renderTourStep(); };
      acts.appendChild(prev);
    }
    if (S.tour < TOUR_STEPS.length - 1) {
      var next = h('button', 'tour-next', '下一步');
      next.onclick = function () { S.tour++; renderTourStep(); };
      acts.appendChild(next);
    } else {
      var toGuide = h('button', 'tour-to-guide', '看完整指南');
      toGuide.onclick = function () {
        markGuideDone();
        endTour();
        S.tab = 'guide';
        S.detailCode = '';
        renderNav();
        renderMain();
        loadTab('guide');
      };
      acts.appendChild(toGuide);
      var done = h('button', 'tour-done', '开始交易');
      done.onclick = function () { markGuideDone(); endTour(); };
      acts.appendChild(done);
    }
    tip.appendChild(acts);

    tip.style.visibility = 'hidden';
    layer.appendChild(tip);

    // 定位：优先贴着高亮框下方，其次上方；都放不下就居中（窄屏/竖屏兜底）
    var tipW = tip.offsetWidth || 330;
    var tipH = tip.offsetHeight || 180;
    var W = rootRect.width;
    var H = rootRect.height;
    var x;
    var y;
    if (!rect) {
      x = (W - tipW) / 2;
      y = (H - tipH) / 2;
    } else {
      var hx = rect.left - rootRect.left;
      var hy = rect.top - rootRect.top;
      var hw = rect.width;
      var hh = rect.height;
      if (hy + hh + 14 + tipH < H - 12) {
        x = hx + hw / 2 - tipW / 2;
        y = hy + hh + 14;
      } else if (hy - tipH - 14 > 12) {
        x = hx + hw / 2 - tipW / 2;
        y = hy - tipH - 14;
      } else if (hx + hw + 14 + tipW < W - 12) {
        x = hx + hw + 14;
        y = hy + hh / 2 - tipH / 2;
      } else {
        x = (W - tipW) / 2;
        y = (H - tipH) / 2;
      }
      x = Math.max(12, Math.min(x, W - tipW - 12));
      y = Math.max(12, Math.min(y, H - tipH - 12));
    }
    tip.style.left = x + 'px';
    tip.style.top = y + 'px';
    tip.style.visibility = 'visible';
  }

  // ---- 指南内容 ----
  // 费率/涨跌停幅度与后端 market.js 一致；能从 /rules 拿的就不写死（S.rules 兜底）
  var GUIDE_SECTIONS = [
    {
      icon: '🧭', title: '三分钟上手',
      html: '<ol class="gi-steps">' +
        '<li><b>开户有本金</b>：学元账户送 1000，首次进入本应用再发 9000 投资练习金 —— 这不是真钱，也不能充值。</li>' +
        '<li><b>找一只股票</b>：行情页按板块分组，也可以用板块胶囊或搜索框（代码、名称都行）。点一行打开详情，先看分时和日 K。</li>' +
        '<li><b>下单</b>：详情页点「买入」，选限价或市价，数量按「手」算（1 手 = 100 股）。确认前先看预估金额和手续费。</li>' +
        '<li><b>等成交</b>：开市时市价单立即成交；限价单价格合适才成交。可以在「委托 → 当前委托」随时撤单。</li>' +
        '<li><b>看结果</b>：「持仓」看每只的成本与盈亏（页面底部有资金流水，每笔钱都能对上），顶栏铃铛会在波动时提醒你，「排行」看班级名次，每周五还有跨班对决。</li>' +
        '</ol>'
    },
    {
      icon: '📈', title: '看懂行情',
      html: '<ul class="gi-list">' +
        '<li><b>红涨绿跌</b>：红色 = 上涨，绿色 = 下跌（A 股习惯，与欧美市场相反）。</li>' +
        '<li><b>涨跌幅</b>：相对「昨收」的百分比。价格碰到当日上限会显示「涨停」，下限显示「跌停」。</li>' +
        '<li><b>盘前</b>：开盘前显示的是昨收价、涨跌 0.00%，9:25 集合竞价后才出现今天的开盘价。</li>' +
        '<li><b>点开一只股票</b>：分时看当天走势（黄线是均价），日 K / 周 K / 月 K 看历史；下面的量柱是成交量 —— 放量上涨和缩量上涨是两回事。</li>' +
        '<li><b>长按图表</b>：出现十字线，显示那一分钟的价格和均价，或那一天的 开 / 高 / 低 / 收 和成交量。松手就消失。想知道「上周五到底收多少」，长按就知道了。</li>' +
        '<li><b>市场快讯</b>：行情页资产卡下面有 7×24 财经快讯，点开在应用内看摘要 —— 大消息常常就是涨跌的原因。</li>' +
        '</ul>'
    },
    {
      icon: '🎯', title: '限价还是市价',
      html: '<p><b>限价委托</b>：你指定一个价格上限（买）或下限（卖）。价格没到就挂着，<b>长期有效</b>；晚上、周末都能下，开盘自动撮合。适合「我就想在这个价位买」。</p>' +
        '<p><b>市价委托</b>：不指定价格，按当时最新价成交。开市时立即成交；休市时排队，开盘按开盘价成交。<b>涨停时买不到、跌停时卖不掉</b>，两种委托都一样。</p>'
    },
    {
      icon: '🧮', title: '一手、可用与预扣',
      html: '<p>买入必须是 <b>100 股（1 手）的整数倍</b>；卖出可以是零股，但零股要一次性卖完。</p>' +
        '<p>下单时系统按「委托价 × 数量 + 预估手续费」冻结学元，成交后按实际价格多退少补；撤单或委托失效会立刻解冻。</p>' +
        '<p><b>买不起怎么办</b>：看交易面板的「最多可买」。茅台一手要十几万学元 —— 这也是真实市场的一部分，高价股本来就不是给小额资金玩的。</p>'
    },
    {
      icon: '💸', title: '手续费怎么算（以 1 万学元为例）',
      html: '<p>买入 10,000 元：佣金 <b>5 元</b>（万 2.5 算出来 2.5 元，但单笔最低 5 元）+ 过户费 0.1 元（不足 1 分不计）≈ <b>5 元</b>。</p>' +
        '<p>卖出 10,000 元：佣金 5 元 + 印花税 5 元（0.05%，只有卖出收）+ 过户费 ≈ <b>10 元</b>。</p>' +
        '<p>一买一卖 ≈ <b>15 元</b>，相当于 0.15%。每周买卖 5 次，一个月光手续费就吃掉 3% —— 这就是「频繁交易」为什么不划算。</p>'
    },
    {
      icon: '⏳', title: '当天就能卖，但真实市场是 T+1',
      html: '<p>本盘为了「平板不是天天开机」放宽成 <b>T+0</b>：今天买的股票今天就能卖，卖出得到的学元马上又能买别的。</p>' +
        '<p>但请记住真实规则：<b>A 股是 T+1</b> —— 今天买入的股票，下一个交易日才能卖出。模拟盘的便利别变成真实交易的错误记忆；考试里「T+1」也是必考点。</p>' +
        '<p>也正因为本盘是 T+0，<b>当天买当天卖</b>在操作上可行 —— 但一买一卖至少 15 学元手续费，频繁进出只会把钱交给券商。把它当作「忘了卖也不会被卡住」的保险，而不是高频交易的邀请。</p>'
    },
    {
      icon: '🚧', title: '涨跌停',
      html: '<p>主板 ±10%，创业板 / 科创板 ±20%，北交所 ±30%，ST 股 ±5%。这是交易所的规则，不是应用随便定的 —— 涨跌幅越大的板块，波动和风险也越大。</p>' +
        '<p><b>涨停买不到、跌停卖不掉</b>：价格封在板上时，你的委托会一直排队。别把「挂上了」当成「会成交」—— 这是新手最容易误解的一点。</p>'
    },
    {
      icon: '📋', title: '委托状态说明',
      html: '<p><b>待成交</b>：已挂单，等待成交（可撤单，委托行会显示冻结了多少学元）。<b>已成交</b>：按某个价格完成，点行能看到成交价和费用明细。<b>已撤销</b>：你撤的单。<b>已失效</b>：委托价超出当天涨跌停范围（比如隔夜跳空），系统自动作废并解冻，也会发一条提醒。</p>' +
        '<p>「委托 → 全部委托」能看到所有历史；「成交记录」里有每笔的价格、数量和费用明细。</p>'
    },
    {
      icon: '🔔', title: '提醒：不用一直盯着盘',
      html: '<p>顶栏的<b>铃铛</b>是提醒中心，红点是未读数。以下情况会自动通知你：</p>' +
        '<ul class="gi-list">' +
        '<li>持仓股票<b>涨跌超过 5%</b> —— 每天每只只提醒一次，不会刷屏。</li>' +
        '<li><b>涨停 / 跌停</b> —— 涨停提醒你「可以卖」，跌停提醒你「卖不掉是正常的」。</li>' +
        '<li>对成本的<b>浮亏超 8%</b> 或 <b>浮盈超 10%</b> —— 提醒你回头看看当初为什么买它。</li>' +
        '<li><b>委托成交 / 失效</b> —— 不用反复刷新委托页等结果。</li>' +
        '</ul>' +
        '<p>点开提醒条目会直接跳到那只股票的详情。提醒只是「叫你看一眼」，<b>怎么决策还是你自己</b>。</p>'
    },
    {
      icon: '🧾', title: '资金流水：每笔钱都能对上',
      html: '<p>「持仓」页最下面是<b>资金流水</b>，点「查看全部」能看到从开户以来的每一笔：</p>' +
        '<p><b>买入</b>扣「成交额 + 手续费」，<b>卖出</b>得「成交额 − 手续费」，领练习金、成就奖励、班管发放、同学转账也都在里面。每行都带<b>当时的余额</b> —— 任何时刻「钱去哪了」都能一行行对出来。</p>' +
        '<p>这是复式记账（和银行一样）：账户余额永远等于所有流水的和。怀疑数字不对时，别猜，翻流水。</p>'
    },
    {
      icon: '📰', title: '资讯：先看新闻，再下单',
      html: '<p>行情页有 <b>7×24 市场快讯</b>，个股详情页有<b>相关资讯</b>（按这只股票的名字搜出来的报道）。点标题在应用内看摘要，不用跳出去。</p>' +
        '<p><b>怎么用</b>：一只股票突然大涨，先点开资讯看看发生了什么 —— 是真利好（业绩、订单）还是纯情绪。很多新手亏损就是因为「看到涨就追，却不知道为什么涨」。</p>' +
        '<p>资讯来自东方财富的公开接口，<b>仅供学习参考，不构成投资建议</b>；模拟盘里把它当作练习「消息 → 判断」的材料。</p>'
    },
    {
      icon: '⚠️', title: '新手最容易犯的五个错',
      html: '<ul class="gi-list">' +
        '<li><b>追涨</b>：看到涨停才想买 —— 买不到；真买到了也常常是高点。</li>' +
        '<li><b>满仓一只</b>：分散不是买十只，而是让不同板块的涨跌互相缓冲。</li>' +
        '<li><b>频繁交易</b>：每次进出至少 10 元手续费，交易越勤亏得越快。</li>' +
        '<li><b>把浮盈当盈利</b>：没卖出之前，账户里的数字随时会变。</li>' +
        '<li><b>不看成交量</b>：只看价格不看量，等于只看了一半的盘口。</li>' +
        '</ul>'
    },
    {
      icon: '🐳', title: 'DeepSeek、华为、小米：为什么买不到',
      html: '<p><b>三类「买不到」的公司</b>：① <b>没上市</b>：深度求索（DeepSeek）、华为 —— 交易所里根本没有它们的股票，任何号称「直接买」的都是假的；② <b>港股</b>：小米集团（1810.HK）、腾讯（700.HK）、阿里（9988.HK）、美团（3690.HK）、商汤（20.HK）；③ <b>美股</b>：英伟达、苹果、特斯拉。本模拟盘只做 <b>A 股</b>，所以这些都买不到。</p>' +
        '<p>A 股能买的是两类：<b>① 概念股 / 产业链公司</b>（「小米产业链」板块里的光弘科技、精研科技、拓普集团；「AI 大模型」板块里的每日互动、青云科技、优刻得 —— 后者与幻方-DeepSeek 有关联）；<b>② 已上市的大模型厂商</b>（科大讯飞·星火、三六零·智脑、昆仑万维·天工、云从科技·从容、拓尔思、万兴科技·天幕）。</p>' +
        '<p><b>概念股 ≠ 那家公司</b>：涨跌来自市场情绪和联想，和小米、DeepSeek 的真实业绩没有直接关系。消息出来时概念股可能连拉涨停，消息退潮时也跌得最快 —— 追概念股是最容易亏钱的玩法之一。</p>'
    },
    {
      icon: '📖', title: '术语表',
      html: '<div class="gi-terms">' +
        '<div><b>昨收</b><span>上一个交易日的收盘价，涨跌幅的基准。</span></div>' +
        '<div><b>今开</b><span>今天第一笔成交价（9:25 集合竞价产生）。</span></div>' +
        '<div><b>成交额</b><span>今天已成交的金额，衡量活跃度。</span></div>' +
        '<div><b>换手率</b><span>成交量占流通股本的比例，越高说明筹码交换越充分。</span></div>' +
        '<div><b>市盈率 PE</b><span>股价 ÷ 每股收益。高不一定贵，可能是市场预期它增长快。</span></div>' +
        '<div><b>持仓成本</b><span>买入金额 + 手续费；卖出时按比例冲减。</span></div>' +
        '<div><b>浮动盈亏</b><span>持仓市值 − 持仓成本，还没卖出，随价格变化。</span></div>' +
        '<div><b>已实现盈亏</b><span>卖出后真正落袋的盈亏（已扣手续费）。</span></div>' +
        '<div><b>集合竞价</b><span>9:15–9:25 汇总委托，9:25 统一按一个价格成交。</span></div>' +
        '<div><b>冻结学元</b><span>下限价买单时预扣的钱；成交按实际价多退少补，撤单/失效立刻解冻。</span></div>' +
        '<div><b>可卖数量</b><span>持仓 − 已挂的卖单。本盘 T+0，当天买的当天就能卖。</span></div>' +
        '<div><b>收盘报告</b><span>每天 15:00 后生成的当日市场摘要，在行情页顶部。</span></div>' +
        '</div>'
    },
    {
      icon: '🏆', title: '班级排行与跨班对决',
      html: '<p>排行按<b>总资产</b>排序（可用学元 + 冻结学元 + 持仓市值）；收益率 = 累计盈亏 ÷ 净投入（按成交流水反推，含手续费）。</p>' +
        '<p>每周五收盘后与隔壁班比<b>人均收益率</b>，胜方全班活跃学生每人 100 学元。成就墙的奖励也是学元，靠真实交易里程碑解锁。</p>'
    }
  ];

  function guideCard(sec, no) {
    var card = h('div', 'card guide-card');
    var head = h('div', 'guide-head');
    head.appendChild(h('span', 'guide-no', no));
    head.appendChild(h('span', 'guide-ico', sec.icon));
    head.appendChild(h('span', 'guide-title', sec.title));
    card.appendChild(head);
    var body = h('div', 'guide-body');
    body.innerHTML = sec.html;
    card.appendChild(body);
    return card;
  }

  function viewGuide() {
    var wrap = h('div', 'view-guide');

    var top = h('div', 'guide-top');
    var tl = h('div', 'guide-top-l');
    tl.appendChild(h('div', 'card-title', '新手教程'));
    tl.appendChild(h('div', 'hero-label', '5 步上手，下面是随时可查的完整指南'));
    top.appendChild(tl);
    var btn = h('button', 'guide-tour-btn', '重看新手引导');
    btn.onclick = function () { startTour(); };
    top.appendChild(btn);
    wrap.appendChild(top);

    for (var i = 0; i < GUIDE_SECTIONS.length; i++) {
      wrap.appendChild(guideCard(GUIDE_SECTIONS[i], i + 1));
    }

    var note = h('div', 'submit-warn', '本应用仅用于学习与练习，不构成任何投资建议。真实市场有风险，模拟盘的盈亏不代表真实收益。');
    wrap.appendChild(note);
    return wrap;
  }

  // ================= 站内通知 =================
  var NOTIFY_META = {
    up: { icon: '↑', cls: 'up' },
    down: { icon: '↓', cls: 'down' },
    limit_up: { icon: '↑', cls: 'up' },
    limit_down: { icon: '↓', cls: 'down' },
    gain: { icon: '↑', cls: 'up' },
    loss: { icon: '↓', cls: 'down' },
    fill: { icon: '✓', cls: 'gold' },
    expired: { icon: '!', cls: 'dim' }
  };

  function loadNotify(force) {
    if (!force && S.notify.at && Date.now() - S.notify.at < 10000) return Promise.resolve();
    return get('/notify', { limit: 20 }).then(function (d) {
      var prev = S.notify.unread;
      var first = !S.notify.at;
      S.notify = { list: (d && d.list) || [], unread: (d && d.unread) || 0, at: Date.now() };
      renderTop();
      // 新提醒到达时弹一条（首次进入不弹，避免一开应用就被刷）
      if (!first && S.notify.unread > prev) {
        var latest = S.notify.list[0];
        if (latest) toast(latest.title, 'success');
      }
      return d;
    }).catch(function () {});
  }

  function openNotify() {
    closeNewsModal();
    var layer = h('div', 'news-modal');
    var panel = h('div', 'news-panel');
    var head = h('div', 'news-panel-head');
    head.appendChild(h('div', 'news-panel-title', '提醒' + (S.notify.unread ? '（' + S.notify.unread + ' 条未读）' : '')));
    var x = h('div', 'news-close', '✕');
    x.onclick = closeNewsModal;
    head.appendChild(x);
    panel.appendChild(head);

    var body = h('div', 'news-panel-body');
    if (!S.notify.list.length) {
      body.appendChild(h('div', 'empty-mini', '还没有提醒。持仓有波动、委托成交时会在这里通知你'));
    } else {
      for (var i = 0; i < S.notify.list.length; i++) {
        body.appendChild(notifyRow(S.notify.list[i]));
      }
    }
    panel.appendChild(body);
    layer.appendChild(panel);
    layer.onclick = function (ev) { if (ev.target === layer) closeNewsModal(); };
    root.appendChild(layer);

    // 打开即已读
    if (S.notify.unread > 0) {
      post('/notify/read').then(function () {
        S.notify.unread = 0;
        for (var j = 0; j < S.notify.list.length; j++) {
          if (!S.notify.list[j].read_at) S.notify.list[j].read_at = Date.now();
        }
        renderTop();
      }).catch(function () {});
    }
  }

  function notifyRow(item) {
    var meta = NOTIFY_META[item.kind] || { icon: '·', cls: '' };
    var row = h('div', 'notify-item' + (item.read_at ? ' read' : ''));
    row.appendChild(h('span', 'nt-ico ' + meta.cls, meta.icon));
    var main = h('div', 'nt-main');
    main.appendChild(h('div', 'nt-title', item.title));
    if (item.body) main.appendChild(h('div', 'nt-body', item.body));
    main.appendChild(h('div', 'nt-time num', fmtDateTime(item.created_at)));
    row.appendChild(main);
    if (item.code) {
      row.onclick = function () {
        closeNewsModal();
        openDetail(item.code);
      };
    }
    return row;
  }

  // ================= 资讯 =================
  // 数据来自东财公开接口（后端 /news 与 /news/:code，带缓存）。
  // 校园平板不方便跳外链，所以点标题直接在应用内看摘要弹层。
  function newsTimeLabel(t) {
    var m = String(t || '').match(/(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
    if (m) return m[1] + '-' + m[2] + ' ' + m[3] + ':' + m[4];
    return String(t || '').slice(5, 16);
  }

  function newsRow(item) {
    var row = h('div', 'news-row');
    var main = h('div', 'news-main');
    main.appendChild(h('div', 'news-title', item.title));
    var meta = h('div', 'news-meta');
    meta.appendChild(h('span', null, item.source || ''));
    meta.appendChild(h('span', 'num', newsTimeLabel(item.time)));
    main.appendChild(meta);
    row.appendChild(main);
    row.onclick = function () { openNewsArticle(item); };
    return row;
  }

  function newsStrip() {
    var box = h('div', 'news-strip');
    var head = h('div', 'chart-tabs');
    head.appendChild(h('div', 'card-title', '市场快讯'));
    if (S.fastNews && S.fastNews.length) {
      var more = h('div', 'card-more', '更多 ›');
      more.onclick = function () { openNewsList('市场快讯', S.fastNews); };
      head.appendChild(more);
    }
    box.appendChild(head);

    var card = h('div', 'card');
    if (!S.fastNews) {
      card.appendChild(h('div', 'loading', '加载快讯…'));
    } else if (!S.fastNews.length) {
      card.appendChild(h('div', 'empty-mini', '暂时没有快讯（资讯源连不上时不影响行情）'));
    } else {
      var list = S.fastNews.slice(0, 3);
      for (var i = 0; i < list.length; i++) card.appendChild(newsRow(list[i]));
    }
    box.appendChild(card);
    return box;
  }

  function stockNewsCard(code) {
    var entry = S.stockNews[code];
    var box = h('div', 'news-card');
    var head = h('div', 'chart-tabs');
    head.appendChild(h('div', 'card-title', '相关资讯'));
    if (entry && entry.list && entry.list.length) {
      var more = h('div', 'card-more', '更多 ›');
      more.onclick = function () { openNewsList('相关资讯', entry.list); };
      head.appendChild(more);
    }
    box.appendChild(head);

    var card = h('div', 'card');
    if (!entry) card.appendChild(h('div', 'loading', '加载资讯…'));
    else if (!entry.list.length) card.appendChild(h('div', 'empty-mini', '暂时没有这只股票的资讯'));
    else {
      var n = Math.min(entry.list.length, 3);
      for (var i = 0; i < n; i++) card.appendChild(newsRow(entry.list[i]));
    }
    box.appendChild(card);
    return box;
  }

  function closeNewsModal() {
    var m = root && root.querySelector('.news-modal');
    if (m && m.parentNode) m.parentNode.removeChild(m);
  }

  function openNewsList(title, list) {
    closeNewsModal();
    var layer = h('div', 'news-modal');
    var panel = h('div', 'news-panel');
    var head = h('div', 'news-panel-head');
    head.appendChild(h('div', 'news-panel-title', title));
    var x = h('div', 'news-close', '✕');
    x.onclick = closeNewsModal;
    head.appendChild(x);
    panel.appendChild(head);

    var body = h('div', 'news-panel-body');
    if (!list || !list.length) body.appendChild(h('div', 'empty-mini', '暂时没有资讯'));
    else for (var i = 0; i < list.length; i++) body.appendChild(newsRow(list[i]));
    panel.appendChild(body);

    layer.appendChild(panel);
    layer.onclick = function (ev) { if (ev.target === layer) closeNewsModal(); };
    root.appendChild(layer);
  }

  function openNewsArticle(item) {
    closeNewsModal();
    var layer = h('div', 'news-modal');
    var panel = h('div', 'news-panel');
    var head = h('div', 'news-panel-head');
    head.appendChild(h('div', 'news-panel-title', '资讯'));
    var x = h('div', 'news-close', '✕');
    x.onclick = closeNewsModal;
    head.appendChild(x);
    panel.appendChild(head);

    var body = h('div', 'news-panel-body');
    body.appendChild(h('div', 'news-article-title', item.title));
    body.appendChild(h('div', 'news-meta', (item.source || '东方财富') + ' · ' + newsTimeLabel(item.time)));
    body.appendChild(h('div', 'news-article-body',
      item.summary || '（该资讯没有摘要，可在东方财富查看原文）'));
    body.appendChild(h('div', 'submit-warn', '资讯来源：东方财富公开接口，仅供学习参考，不构成投资建议。'));
    panel.appendChild(body);

    layer.appendChild(panel);
    layer.onclick = function (ev) { if (ev.target === layer) closeNewsModal(); };
    root.appendChild(layer);
  }

  function loadFastNews() {
    if (S.fastNews && Date.now() - S.fastNewsAt < 120000) return Promise.resolve();
    return get('/news', { limit: 8 }).then(function (d) {
      S.fastNews = (d && d.list) || [];
      S.fastNewsAt = Date.now();
      if (S.tab === 'market' && !S.detailCode) renderMain();
    }).catch(function () {
      if (!S.fastNews) S.fastNews = [];
      if (S.tab === 'market' && !S.detailCode) renderMain();
    });
  }

  function loadStockNews(code, name) {
    var hit = S.stockNews[code];
    if (hit && Date.now() - hit.at < 300000) return;
    get('/news/' + code, { name: name || '' }).then(function (d) {
      S.stockNews[code] = { list: (d && d.list) || [], at: Date.now() };
      if (S.detailCode === code) renderMain();
    }).catch(function () {
      S.stockNews[code] = { list: [], at: Date.now() };
      if (S.detailCode === code) renderMain();
    });
  }

  // ================= 规则 =================
  function viewRules() {
    var wrap = h('div', 'view-rules');
    var r = S.rules;
    if (!r) return (wrap.appendChild(loadingBox('加载规则')), wrap);

    var card = h('div', 'card');
    card.appendChild(ruleItem('这是什么', '用<b>学元</b>练手的 A 股模拟盘。行情来自真实市场，规则也按真实来。学元是校内虚拟货币，<b>不能充值、不能提现</b>，与人民币无关；也与 Cluss 的积分互不相通。'));
    card.appendChild(ruleItem('随时都能下单', r.orderWindow));
    card.appendChild(ruleItem('什么时候成交', r.session_note + ' ' + r.matching));
    card.appendChild(ruleItem('市价单', r.market_order));
    card.appendChild(ruleItem('卖出限制（T+0）', r.t1));
    card.appendChild(ruleItem('涨跌停', r.limits));
    card.appendChild(ruleItem('交易单位', r.lot.note));
    card.appendChild(ruleItem('费用', '佣金 <b>万 2.5</b>（单笔最低 <b>5 元</b>，买卖双向）；印花税 <b>卖出 0.05%</b>；过户费 <b>0.001%</b>（双向）。'));
    card.appendChild(ruleItem('委托有效期', r.expiry));
    card.appendChild(ruleItem('本金', '开户时学元账户会赠送 1000 学元；首次进入本应用再发放 9000 学元「投资练习金」。之后可以每天在学元账户领助学津贴，也可以由班管发放。'));
    wrap.appendChild(card);

    var note = h('div', 'submit-warn', '本应用仅用于学习与练习，不构成任何投资建议。真实市场有风险，模拟盘的盈亏不代表真实收益。');
    wrap.appendChild(note);
    return wrap;
  }

  function ruleItem(title, html) {
    var box = h('div', 'rule');
    var t = h('div', 'rule-t');
    t.appendChild(h('span', 'bullet'));
    t.appendChild(document.createTextNode(title));
    box.appendChild(t);
    var d = h('div', 'rule-d');
    d.innerHTML = html;
    box.appendChild(d);
    return box;
  }

  // ================= 交易面板 =================
  function openTrade(code, side) {
    if (!S.detailQuote || S.detailQuote.code !== code) {
      toast('行情还没加载完，稍等一下');
      return;
    }
    var q = S.detailQuote;
    var cash = (S.overview && S.overview.summary && S.overview.summary.cash) || { available: 0 };
    var pos = null;
    if (S.overview && S.overview.summary) {
      for (var i = 0; i < S.overview.summary.positions.length; i++) {
        if (S.overview.summary.positions[i].code === code) { pos = S.overview.summary.positions[i]; break; }
      }
    }

    var maxQty = 0;
    if (side === 'buy') {
      maxQty = maxBuyQty(cash.available, q.price);
      if (maxQty < LOT) {
        // 买不起一手是真实约束（比如一手茅台要 14 万），
        // 与其弹出一个数量为 0 的面板，不如直接说清楚差多少。
        var oneLot = q.price * LOT;
        toast('一手（' + LOT + ' 股）需要约 ' + money(oneLot + calcFee('buy', oneLot)) +
          ' 学元，当前可用 ' + money(cash.available) + ' 学元', 'error');
        return;
      }
    } else {
      maxQty = pos ? pos.available_qty : 0;
      if (maxQty <= 0) {
        toast(pos && pos.t1_locked_qty > 0 ? '今日买入的股票需下一交易日才能卖出' : '没有可卖持仓', 'error');
        return;
      }
    }

    S.sheet = {
      code: code,
      name: q.name,
      side: side,
      type: 'limit',
      price: q.price,
      qty: side === 'sell' ? maxQty : Math.min(LOT, maxQty),
      maxQty: maxQty,
      quote: q,
      cash: cash
    };
    renderSheet();
  }

  // 与服务端 market.maxBuyQty 同口径：钱要够成交额 + 费用。
  // 单位统一用「元」—— 之前这里混用过「分」，导致一手明明买得起却判成 0。
  function maxBuyQty(availableYuan, priceYuan) {
    var price = Number(priceYuan);
    var avail = Number(availableYuan);
    if (!(price > 0) || !(avail > 0)) return 0;
    var maxLots = Math.floor(avail / (price * LOT));
    for (var lots = maxLots; lots >= 1; lots--) {
      var amount = lots * LOT * price;
      if (amount + calcFee('buy', amount) <= avail) return lots * LOT;
    }
    return 0;
  }

  function calcFee(side, amountYuan) {
    var amountCent = Math.round(amountYuan * 100);
    var commission = Math.max(Math.round(amountCent * COMMISSION_RATE), COMMISSION_MIN * 100);
    var transfer = Math.round(amountCent * TRANSFER_RATE);
    var stamp = side === 'sell' ? Math.round(amountCent * STAMP_RATE) : 0;
    return (commission + transfer + stamp) / 100;
  }

  function renderSheet() {
    var old = root.querySelector('.ci-stock-mask');
    if (old) old.parentNode.removeChild(old);
    var oldSheet = root.querySelector('.ci-stock-sheet');
    if (oldSheet) oldSheet.parentNode.removeChild(oldSheet);

    if (!S.sheet) return;
    var st = S.sheet;

    var mask = h('div', 'mask ci-stock-mask');
    mask.onclick = closeSheet;
    root.appendChild(mask);

    var sheet = h('div', 'sheet ci-stock-sheet');
    var head = h('div', 'sheet-head');
    var title = h('div', 'sheet-title', st.name + ' · ' + (st.side === 'buy' ? '买入' : '卖出'));
    head.appendChild(title);
    var close = h('div', 'sheet-close', '✕');
    close.onclick = closeSheet;
    head.appendChild(close);
    sheet.appendChild(head);

    var body = h('div', 'sheet-body');

    // 买卖切换
    var sw = h('div', 'side-switch');
    ['buy', 'sell'].forEach(function (side) {
      var b = h('div', 'side-btn ' + side + (st.side === side ? ' active' : ''), side === 'buy' ? '买入' : '卖出');
      b.onclick = function () {
        if (st.side === side) return;
        st.side = side;
        var pos = currentPosition(st.code);
        st.maxQty = side === 'buy'
          ? maxBuyQty(st.cash.available, st.price)
          : (pos ? pos.available_qty : 0);
        if (st.maxQty <= 0) {
          toast(side === 'sell' ? '没有可卖持仓' : '可用学元不足', 'error');
          st.side = side === 'buy' ? 'sell' : 'buy';
          return;
        }
        st.qty = side === 'sell' ? st.maxQty : Math.min(LOT, st.maxQty);
        renderSheet();
      };
      sw.appendChild(b);
    });
    body.appendChild(sw);

    // 委托类型
    var typeField = h('div', 'field');
    var tl = h('div', 'field-label');
    tl.appendChild(h('span', null, '委托方式'));
    tl.appendChild(h('span', 'field-hint', st.type === 'market' ? '按最新价立即成交' : '价格合适才成交'));
    typeField.appendChild(tl);
    var tseg = h('div', 'seg');
    tseg.style.width = '100%';
    [['limit', '限价委托'], ['market', '市价委托']].forEach(function (t) {
      var b = h('div', 'seg-item' + (st.type === t[0] ? ' active' : ''), t[1]);
      b.style.flex = '1 1 0';
      b.style.textAlign = 'center';
      b.onclick = function () {
        st.type = t[0];
        if (t[0] === 'market') st.price = st.quote.price;
        renderSheet();
      };
      tseg.appendChild(b);
    });
    typeField.appendChild(tseg);
    body.appendChild(typeField);

    // 价格
    var priceField = h('div', 'field');
    var pl = h('div', 'field-label');
    pl.appendChild(h('span', null, '委托价格'));
    var limitText = '涨停 ' + fmt(st.quote.limit_up, 2) + ' / 跌停 ' + fmt(st.quote.limit_down, 2);
    pl.appendChild(h('span', 'field-hint', st.type === 'market' ? '市价单以最新成交价为准' : limitText));
    priceField.appendChild(pl);

    var stepper = h('div', 'stepper');
    var minus = h('button', 'stepper-btn', '−');
    minus.onclick = function () {
      if (st.type === 'market') return;
      st.price = round2(Math.max(st.quote.limit_down, st.price - 0.01));
      renderSheet();
    };
    stepper.appendChild(minus);

    var input = document.createElement('input');
    input.className = 'stepper-input num';
    input.type = 'text';
    input.inputMode = 'decimal';
    input.value = st.type === 'market' ? '市价' : fmt(st.price, 2);
    input.disabled = st.type === 'market';
    input.onchange = function () {
      var v = parseFloat(input.value);
      if (isFinite(v) && v > 0) {
        st.price = round2(v);
      }
      renderSheet();
    };
    stepper.appendChild(input);

    var plus = h('button', 'stepper-btn', '+');
    plus.onclick = function () {
      if (st.type === 'market') return;
      st.price = round2(Math.min(st.quote.limit_up, st.price + 0.01));
      renderSheet();
    };
    stepper.appendChild(plus);
    priceField.appendChild(stepper);

    // 限价快捷档：一键取现价/涨跌停。涨停买入、跌停卖出是真实盘口里
    // 最典型的「排队单」，学生需要亲手试过才理解「挂上了 ≠ 会成交」
    if (st.type === 'limit') {
      var pQuick = h('div', 'quick-row');
      [['现价', st.quote.price], ['涨停', st.quote.limit_up], ['跌停', st.quote.limit_down]].forEach(function (item) {
        var b = h('div', 'quick', item[0]);
        b.onclick = function () {
          st.price = round2(Math.min(Math.max(Number(item[1]) || st.quote.price, st.quote.limit_down), st.quote.limit_up));
          renderSheet();
        };
        pQuick.appendChild(b);
      });
      priceField.appendChild(pQuick);
    }
    body.appendChild(priceField);

    // 数量
    var qtyField = h('div', 'field');
    var ql = h('div', 'field-label');
    ql.appendChild(h('span', null, '委托数量'));
    ql.appendChild(h('span', 'field-hint', '1 手 = 100 股 · 最多 ' + st.maxQty + ' 股'));
    qtyField.appendChild(ql);

    var qStepper = h('div', 'stepper');
    var qMinus = h('button', 'stepper-btn', '−');
    qMinus.onclick = function () {
      st.qty = Math.max(st.side === 'sell' ? 1 : LOT, st.qty - LOT);
      renderSheet();
    };
    qStepper.appendChild(qMinus);
    var qInput = document.createElement('input');
    qInput.className = 'stepper-input num';
    qInput.type = 'text';
    qInput.inputMode = 'numeric';
    qInput.value = String(st.qty);
    qInput.onchange = function () {
      var v = parseInt(qInput.value, 10);
      if (isFinite(v) && v > 0) st.qty = v;
      renderSheet();
    };
    qStepper.appendChild(qInput);
    var qPlus = h('button', 'stepper-btn', '+');
    qPlus.onclick = function () {
      st.qty = Math.min(st.maxQty, st.qty + LOT);
      renderSheet();
    };
    qStepper.appendChild(qPlus);
    qtyField.appendChild(qStepper);

    var quick = h('div', 'quick-row');
    [['全仓', 1], ['半仓', 0.5], ['1/4', 0.25], ['1 手', 0]].forEach(function (item) {
      var b = h('div', 'quick', item[0]);
      b.onclick = function () {
        var q;
        if (item[0] === '1 手') q = LOT;
        else q = Math.floor(st.maxQty * item[1] / LOT) * LOT;
        if (st.side === 'sell') q = Math.min(q, st.maxQty);
        st.qty = Math.max(st.side === 'sell' ? 1 : LOT, q);
        renderSheet();
      };
      quick.appendChild(b);
    });
    qtyField.appendChild(quick);
    body.appendChild(qtyField);

    // 预估
    var amount = st.price * st.qty;
    var fee = calcFee(st.side, amount);
    var est = h('div', 'estimate');
    est.appendChild(estRow('成交金额', money(amount) + ' 学元'));
    est.appendChild(estRow('预估费用', fmt(fee, 2) + ' 学元'));
    if (st.side === 'buy') {
      est.appendChild(estRow('需要学元', money(amount + fee) + ' 学元', true));
      est.appendChild(estRow('可用学元', money(st.cash.available) + ' 学元'));
    } else {
      est.appendChild(estRow('预计到账', money(amount - fee) + ' 学元', true));
      est.appendChild(estRow('可卖数量', st.maxQty + ' 股'));
    }
    body.appendChild(est);

    sheet.appendChild(body);

    // 提交
    var foot = h('div', 'sheet-foot');
    var btn = h('button', 'submit ' + st.side, st.side === 'buy' ? '确认买入' : '确认卖出');
    var invalid = !(st.qty > 0) ||
      (st.side === 'buy' && (st.qty % LOT !== 0 || amount + fee > st.cash.available)) ||
      (st.side === 'sell' && st.qty > st.maxQty);
    if (invalid) btn.disabled = true;
    btn.onclick = submitOrder;
    foot.appendChild(btn);

    var warn = h('div', 'submit-warn', st.side === 'buy'
      ? (st.type === 'market'
        ? '市价单任何时间可下：开市时按最新价立即成交，休市时排队、开盘后按开盘价成交。当天买当天可卖（T+0，真实市场是 T+1）。'
        : '委托长期有效，价格合适就成交；晚上和周末挂的单开盘后自动撮合。当天买当天可卖（T+0，真实市场是 T+1）。')
      : '卖出不收冻结，成交后学元直接到账；印花税与佣金在成交时扣除。');
    foot.appendChild(warn);
    sheet.appendChild(foot);

    root.appendChild(sheet);
    setTimeout(function () {
      mask.className = 'mask show ci-stock-mask';
      sheet.className = 'sheet show ci-stock-sheet';
    }, 10);
  }

  function estRow(k, v, strong) {
    var row = h('div', 'est-row' + (strong ? ' total' : ''));
    row.appendChild(h('span', null, k));
    row.appendChild(h('span', 'v num', v));
    return row;
  }

  function currentPosition(code) {
    if (!S.overview || !S.overview.summary) return null;
    var list = S.overview.summary.positions;
    for (var i = 0; i < list.length; i++) if (list[i].code === code) return list[i];
    return null;
  }

  function round2(v) {
    return Math.round(Number(v) * 100) / 100;
  }

  function closeSheet() {
    S.sheet = null;
    var mask = root.querySelector('.ci-stock-mask');
    var sheet = root.querySelector('.ci-stock-sheet');
    if (mask) {
      mask.className = 'mask ci-stock-mask';
      setTimeout(function () { if (mask.parentNode) mask.parentNode.removeChild(mask); }, 200);
    }
    if (sheet) {
      sheet.className = 'sheet ci-stock-sheet';
      setTimeout(function () { if (sheet.parentNode) sheet.parentNode.removeChild(sheet); }, 260);
    }
  }

  function submitOrder() {
    var st = S.sheet;
    if (!st) return;
    var btn = root.querySelector('.ci-stock-sheet .submit');
    if (btn) { btn.disabled = true; btn.textContent = '提交中…'; }

    post('/order', {
      code: st.code,
      side: st.side,
      type: st.type,
      price: st.type === 'market' ? undefined : st.price,
      qty: st.qty
    }).then(function (r) {
      closeSheet();
      var msg = r.message || '委托已提交';
      if (r.data && r.data.filled) {
        var t = r.data.filled.trade;
        msg = '已成交：' + t.side_label + ' ' + t.name + ' ' + t.qty + ' 股 @ ' + fmt(t.price, 2) + '，费用 ' + fmt(t.fee, 2) + ' 学元';
      }
      toast(msg, 'success');
      // 成就解锁紧跟成交提示（逐条弹，间隔 2.2s 避免叠在一起）
      var unlocked = (r.data && r.data.achievements) || [];
      for (var i = 0; i < unlocked.length; i++) {
        (function (ach, delay) {
          setTimeout(function () {
            toast(ach.icon + ' 解锁成就「' + ach.label + '」 +' + ach.reward + ' 学元', 'success');
          }, delay);
        })(unlocked[i], 2200 * (i + 1));
      }
      if (r.data && r.data.summary && S.overview) S.overview.summary = r.data.summary;
      loadOverview();
      loadLedger(true);
      loadNotify(true);
      if (S.detailCode) loadDetail(S.detailCode);
      if (S.tab === 'orders') loadOrders();
    }).catch(function (e) {
      toast(errMsg(e), 'error');
      if (btn) { btn.disabled = false; btn.textContent = st.side === 'buy' ? '确认买入' : '确认卖出'; }
    });
  }

  // ================= 数据加载 =================
  function loadOverview() {
    return get('/overview').then(function (d) {
      var first = !S.overview;
      S.overview = d;
      S.watch = {};
      (d.watchlist || []).forEach(function (q) { S.watch[q.code] = true; });
      renderTop();
      loadNotify();   // overview 会触发服务端波动扫描，顺手把新提醒取回来（内部 10s 节流）
      if (first && d.practice_granted) {
        toast('已发放 ' + d.practice_granted + ' 学元投资练习金', 'success');
      }
      return d;
    }).catch(function (e) {
      S.error.overview = errMsg(e);
      return null;
    });
  }

  function loadMarket() {
    return get('/market').then(function (d) {
      S.market = d;
      if (S.tab === 'market' && !S.detailCode) {
        if (root.querySelector('.view-market .qrow')) patchQuotes(d.list);
        else renderMain();
      }
      return d;
    }).catch(function (e) {
      if (!S.market) {
        // 首次拉取失败：显示错误态而不是空态（拉不到 ≠ 没有）
        S.marketError = errMsg(e);
        if (S.tab === 'market' && !S.detailCode) renderMain();
      }
      // 已有行情时的刷新失败：保留旧数据，静默等下一轮
      return null;
    });
  }

  function loadDetail(code) {
    S.loading.detail = true;
    return get('/quote/' + code).then(function (d) {
      S.detailQuote = d.quote;
      S.detailSession = d.session;
      // 拿到名称后再查个股资讯（按名称搜命中率更高）
      if (S.detailCode === code && d.quote) loadStockNews(code, d.quote.name);
      if (S.detailCode === code) {
        // 首次拿到行情时，详情页的「关键指标」格子还没渲染（打开时 quote 为空），
        // 必须整页重建一次；之后只改价格文本，避免闪烁。
        var pEl = root.querySelector('[data-field="dprice"]');
        var hasGrid = !!root.querySelector('.detail-grid');
        if (pEl && hasGrid && S.detailQuote) {
          pEl.textContent = fmt(S.detailQuote.price, 2);
          pEl.className = 'detail-px num ' + trendClass(S.detailQuote.change_pct);
          var cEl = root.querySelector('[data-field="dchg"]');
          cEl.textContent = signed(S.detailQuote.change) + '  ' + pct(S.detailQuote.change_pct);
          cEl.className = 'detail-chg num ' + trendClass(S.detailQuote.change_pct);
        } else {
          renderMain();
        }
      }
      loadChart(S.detailJustOpened);
      S.detailJustOpened = false;
      return d;
    }).catch(function (e) {
      if (S.detailCode === code) {
        // 首次加载失败才退回列表；刷新失败只提示，保留页面上的最后数据 ——
        // 一次网络抖动就把学生踢回列表，体验上等于「页面会自己消失」
        if (!S.detailQuote) {
          toast(errMsg(e), 'error');
          S.detailCode = '';
          renderMain();
        } else {
          toast('行情刷新失败：' + errMsg(e));
        }
      }
      return null;
    });
  }

  function loadChart(force) {
    var code = S.detailCode;
    if (!code) return;
    var tab = S.chartTab;
    var key = code + ':' + tab;
    var now = Date.now();
    var cached = S.chartCache[key];
    var ttl = tab === 'trend' ? 30000 : 300000;
    if (!force && cached && now - cached.at < ttl) {
      S.detail = cached.data;
      drawChart();
      return;
    }
    var p;
    if (tab === 'trend') {
      p = get('/trends/' + code);
    } else {
      var klt = tab === 'month' ? 103 : (tab === 'week' ? 102 : 101);
      p = get('/kline/' + code, { klt: klt, limit: 90 });
    }
    p.then(function (d) {
      if (S.detailCode !== code || S.chartTab !== tab) return;
      S.detail = d;
      // 缓存上限 24 条（≈ 6 只股票 × 4 个周期），超了整表清掉，避免长会话堆积
      if (Object.keys(S.chartCache).length > 24) S.chartCache = {};
      S.chartCache[key] = { at: Date.now(), data: d };
      drawChart();
    }).catch(function () {
      if (S.detailCode !== code) return;
      S.detail = null;
      drawChart();
    });
  }

  function loadOrders() {
    var tab = S.ordersTab || 'pending';
    if (tab === 'trades') {
      return get('/trades', { limit: 50 }).then(function (d) {
        S.trades = d.list;
        if (S.tab === 'orders') renderMain();
      }).catch(function (e) { toast(errMsg(e), 'error'); });
    }
    return get('/orders', { status: tab === 'pending' ? 'pending' : 'all', limit: 50 }).then(function (d) {
      S.orders = d.list;
      if (S.tab === 'orders') renderMain();
    }).catch(function (e) { toast(errMsg(e), 'error'); });
  }

  function loadLedger(reset) {
    var beforeId = reset ? 0 : ((S.ledger && S.ledger.next_before_id) || 0);
    if (!reset && !beforeId) return Promise.resolve();
    return get('/ledger', { limit: 20, beforeId: beforeId }).then(function (d) {
      if (reset || !S.ledger) S.ledger = d;
      else S.ledger = { list: (S.ledger.list || []).concat(d.list || []), next_before_id: d.next_before_id };
      if (S.tab === 'positions') renderMain();
      return d;
    }).catch(function (e) {
      toast(errMsg(e), 'error');
    });
  }

  function loadRank() {
    loadPeer();
    return get('/rank').then(function (d) {
      S.rank = d;
      S.lastRankAt = Date.now();   // 防止进页面 5 秒内被刷新计时器再打一次
      if (S.tab === 'rank') renderMain();
    }).catch(function (e) {
      if (!S.rank) { S.rank = { list: [], me: null, total: 0 }; renderMain(); }
      toast(errMsg(e), 'error');
    });
  }

  function loadPeer() {
    return get('/peer').then(function (d) {
      S.peer = d;
      if (S.tab === 'rank') renderMain();
    }).catch(function () {
      // 对决是增强功能，失败不打扰
    });
  }

  function loadAchievements() {
    return get('/achievements').then(function (d) {
      S.achievements = d;
      if (S.tab === 'positions') renderMain();
    }).catch(function () {});
  }

  function loadReport() {
    return get('/report').then(function (d) {
      S.report = d && d.report ? d.report : null;
      if (S.tab === 'market' && !S.detailCode) renderMain();
    }).catch(function () {});
  }

  function loadRules() {
    return get('/rules').then(function (d) {
      S.rules = d;
      if (S.tab === 'rules') renderMain();
    }).catch(function () {});
  }

  function loadTab(tab) {
    if (tab === 'market') { loadMarket(); loadOverview(); loadReport(); loadFastNews(); }
    else if (tab === 'positions') { loadOverview(); loadAchievements(); loadLedger(true); }
    else if (tab === 'orders') { loadOrders(); }
    else if (tab === 'rank') { loadRank(); }
    else if (tab === 'guide') { if (!S.rules) loadRules(); }
    else if (tab === 'rules' && !S.rules) { loadRules(); }
  }

  // 定时刷新：按当前页面决定刷新什么，离开页面时清掉
  function startRefresh() {
    stopRefresh();
    S.refreshTimer = setInterval(function () {
      if (document.hidden) return;
      if (S.sheet) return;   // 交易面板打开时不刷新，避免价格变化导致预估跳动
      if (S.detailCode) {
        loadDetail(S.detailCode);
      } else if (S.tab === 'market') {
        loadMarket();
      } else if (S.tab === 'positions') {
        loadOverview();
      } else if (S.tab === 'orders') {
        // 撮合器 3 秒一轮：当前委托必须跟着动，否则学生盯着委托页
        // 永远看不到「已成交」状态变化
        if ((S.ordersTab || 'pending') === 'pending') loadOrders();
      } else if (S.tab === 'rank') {
        // 排行按总资产排序，30 秒刷新足够
        if (Date.now() - S.lastRankAt > 30000) {
          S.lastRankAt = Date.now();
          loadRank();
        }
      }
      if (Date.now() - S.lastRefresh > REFRESH_ASSET) {
        S.lastRefresh = Date.now();
        if (S.tab !== 'market' || !S.detailCode) loadOverview();
      }
    }, REFRESH_DETAIL);
  }

  function stopRefresh() {
    if (S.refreshTimer) { clearInterval(S.refreshTimer); S.refreshTimer = null; }
  }

  // ================= 生命周期 =================
  function mount(container, ctx) {
    context = ctx;
    api = ctx && ctx.data && ctx.data.api;
    container_ = container;

    root = h('div', 'ci-stock');
    container.appendChild(root);

    // 骨架：顶栏 + 主体（导航/主区在 render 时填充）
    var top = h('div', 'top ci-stock-top');
    root.appendChild(top);
    var body = h('div', 'body');
    body.appendChild(h('div', 'nav'));
    body.appendChild(h('div', 'main'));
    root.appendChild(body);

    renderTop();
    renderNav();
    var main = root.querySelector('.main');
    main.appendChild(loadingBox('正在连接行情'));

    // 首次加载：先拿资产（顺带发放练习金），再拿行情/规则/报告
    loadOverview().then(function () {
      renderMain();
      return Promise.all([loadMarket(), loadRules(), loadReport(), loadFastNews(), loadNotify(true)]);
    }).then(function () {
      renderTop();
      if (S.tab === 'market') renderMain();
      // 首次进入：等界面稳定后弹新手引导。localStorage 记住 —— 跳过也算看过，
      // 想重看可以随时去「指南」页（不打扰老用户是底线）。
      if (!guideDone()) {
        setTimeout(function () {
          if (S.tour === null && S.sheet === null && S.tab === 'market' && !S.detailCode) startTour();
        }, 700);
      }
    }).catch(function () {
      renderMain();
    });

    startRefresh();

    if (ctx && ctx.app && typeof ctx.app.onDestroy === 'function') {
      ctx.app.onDestroy(function () {
        stopRefresh();
      });
    }

    window.addEventListener('resize', onResize);
    document.addEventListener('visibilitychange', onVisibility);
  }

  var resizeTimer = null;
  function onResize() {
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () {
      if (S.detailCode) drawChart();
      // 引导的气泡是按像素定位的，横竖屏切换后必须重算，否则会飘到屏幕外
      if (S.tour !== null) renderTourStep();
    }, 180);
  }

  function onVisibility() {
    if (!document.hidden && S.detailCode) drawChart();
  }

  function unmount() {
    stopRefresh();
    endTour();
    window.removeEventListener('resize', onResize);
    document.removeEventListener('visibilitychange', onVisibility);
    if (resizeTimer) { clearTimeout(resizeTimer); resizeTimer = null; }
    if (root && root.parentNode) root.parentNode.removeChild(root);
    root = null;
    container_ = null;
    S.detail = null;
    S.market = null;
    S.overview = null;
    S.marketError = '';
    S.q = '';
    S.rank = null;
    S.orders = null;
    S.trades = null;
    S.peer = null;
    S.sheet = null;
    S.lastRankAt = 0;
  }

  var definition = { name: NAME, mount: mount, unmount: unmount };
  if (window.ClassIntraMarket && typeof window.ClassIntraMarket.define === 'function') {
    window.ClassIntraMarket.define(definition);
  }
})();
