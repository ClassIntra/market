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

  var S = {
    tab: 'market',
    overview: null,
    market: null,
    marketError: '',   // 行情拉取失败的原因（拉不到 ≠ 没有，必须显示错误态）
    marketTab: 'all',
    q: '',             // 行情搜索关键字（代码/名称/板块）
    detail: null,
    detailCode: '',
    detailQuote: null,
    chartTab: 'trend',
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
          if (S.tab === item.key && !S.detailCode) return;
          S.tab = item.key;
          S.detailCode = '';
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
      main.appendChild(viewPositions());
    } else if (S.tab === 'orders') {
      main.appendChild(viewOrders());
    } else if (S.tab === 'rank') {
      main.appendChild(viewRank());
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
    S.chartTab = 'trend';
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

    // 图表
    var chartCard = h('div', 'card');
    var tabs = h('div', 'chart-tabs');
    var seg = h('div', 'seg');
    [['trend', '分时'], ['day', '日K'], ['week', '周K']].forEach(function (item) {
      var b = h('div', 'seg-item' + (S.chartTab === item[0] ? ' active' : ''), item[1]);
      b.onclick = function () {
        if (S.chartTab === item[0]) return;
        S.chartTab = item[0];
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
    chartCard.appendChild(chartWrap);
    wrap.appendChild(chartCard);

    // 关键指标
    if (q) {
      var grid = h('div', 'detail-grid');
      var cells = [
        ['今开', fmt(q.open, 2), trendClass(q.open - q.prev_close)],
        ['最高', fmt(q.high, 2), trendClass(q.high - q.prev_close)],
        ['最低', fmt(q.low, 2), trendClass(q.low - q.prev_close)],
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
    if (S.chartTab === 'trend') drawTrend(ctx, w, hgt, S.detail);
    else drawKline(ctx, w, hgt, S.detail);
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
      ctx.fillStyle = 'rgba(255,255,255,.28)';
      ctx.font = '12px -apple-system, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('暂无分时数据', w / 2, hgt / 2);
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

    var hi = -Infinity, lo = Infinity;
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].high > hi) hi = rows[i].high;
      if (rows[i].low < lo) lo = rows[i].low;
    }
    if (!isFinite(hi) || !isFinite(lo) || hi <= lo) { hi = lo + 1; }
    var pad = (hi - lo) * 0.06;
    hi += pad; lo -= pad;

    var step = plotW / rows.length;
    var bodyW = Math.max(1.5, Math.min(step * 0.62, 7));

    function yOf(v) { return padTop + (hi - v) / (hi - lo) * plotH; }

    gridLines(ctx, plotW, plotH + padTop, 4);

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
    }

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
    ctx.fillText(fmt((hi + lo) / 2, 2), plotW + 6, padTop + plotH / 2 + 3.5);
    ctx.fillText(fmt(lo, 2), plotW + 6, padTop + plotH);

    // 日期
    ctx.textAlign = 'left';
    ctx.fillText(String(rows[0].date).slice(5), 2, hgt - 5);
    ctx.textAlign = 'right';
    ctx.fillText(String(rows[rows.length - 1].date).slice(5), plotW - 2, hgt - 5);
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

    // 底部说明：T+1
    var note = h('div', 'submit-warn', '当日买入的股票需下一交易日才能卖出（T+1）。带「锁」标记的是今日买入、暂不可卖的部分。');
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

    row.appendChild(h('div', 'tc-2 num', o.type === 'market' ? '市价' : fmt(o.price, 2)));
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
    card.appendChild(ruleItem('T+1', r.t1));
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
          toast(side === 'sell' ? '没有可卖持仓（T+1）' : '可用学元不足', 'error');
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
        ? '市价单任何时间可下：开市时按最新价立即成交，休市时排队、开盘后按开盘价成交。买入后当日不可卖出（T+1）。'
        : '委托长期有效，价格合适就成交；晚上和周末挂的单开盘后自动撮合。买入后当日不可卖出（T+1）。')
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
      loadChart();
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

  function loadChart() {
    var code = S.detailCode;
    if (!code) return;
    var tab = S.chartTab;
    var p;
    if (tab === 'trend') {
      p = get('/trends/' + code);
    } else {
      p = get('/kline/' + code, { klt: tab === 'week' ? 102 : 101, limit: 90 });
    }
    p.then(function (d) {
      if (S.detailCode !== code || S.chartTab !== tab) return;
      S.detail = d;
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

  function loadRank() {
    loadPeer();
    return get('/rank').then(function (d) {
      S.rank = d;
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
    if (tab === 'market') { loadMarket(); loadOverview(); loadReport(); }
    else if (tab === 'positions') { loadOverview(); loadAchievements(); }
    else if (tab === 'orders') { loadOrders(); }
    else if (tab === 'rank') { loadRank(); }
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
      return Promise.all([loadMarket(), loadRules(), loadReport()]);
    }).then(function () {
      renderTop();
      if (S.tab === 'market') renderMain();
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
    }, 180);
  }

  function onVisibility() {
    if (!document.hidden && S.detailCode) drawChart();
  }

  function unmount() {
    stopRefresh();
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
