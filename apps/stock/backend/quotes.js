// 行情层：真实 A 股行情（东方财富公开行情接口）+ 缓存 + 离线兜底
// ============================================================
// ---- 真实性声明（不要删）----
// 价格来自东方财富的公开行情快照，盘中约 3 秒刷新一次。
// 网络不可用时**不会**假装行情正常：返回的 quote 会带 stale=true，
// 价格由「最后一次真实价 + 确定性微幅游走」生成，前端必须显示「行情延迟」。
// 校园网络断掉时，宁可让学生看到「行情中断」，也不能让他以为自己在看真实盘口。
//
// ---- 为什么只做一个股票池 ----
// 全市场 5000+ 只股票对一台班级服务器来说太重（一次全量快照要几十个请求），
// 而且教学场景不需要。池子覆盖主要板块，够讲清楚「行业轮动」「大盘 vs 个股」。
// 池外的代码不允许交易 —— 这是硬边界，也避免用错误 secid 拿到脏数据。
//
// 编码约定：var / function

var https = require('https');
var market = require('./market');

// ---- 教学股票池 ----
// sector 仅用于前端分组展示；名称一律以行情接口为准（本地写死会过期）
var UNIVERSE = [
  { code: '600519', sector: '消费' },   // 贵州茅台
  { code: '000858', sector: '消费' },   // 五粮液
  { code: '600887', sector: '消费' },   // 伊利股份
  { code: '601888', sector: '消费' },   // 中国中免
  { code: '000333', sector: '家电' },   // 美的集团
  { code: '000651', sector: '家电' },   // 格力电器
  { code: '600690', sector: '家电' },   // 海尔智家
  { code: '601318', sector: '金融' },   // 中国平安
  { code: '600036', sector: '金融' },   // 招商银行
  { code: '601398', sector: '金融' },   // 工商银行
  { code: '600030', sector: '金融' },   // 中信证券
  { code: '300059', sector: '金融' },   // 东方财富
  { code: '000001', sector: '金融' },   // 平安银行
  { code: '300750', sector: '新能源' }, // 宁德时代
  { code: '002594', sector: '新能源' }, // 比亚迪
  { code: '601012', sector: '新能源' }, // 隆基绿能
  { code: '300124', sector: '新能源' }, // 汇川技术
  { code: '688981', sector: '科技' },   // 中芯国际
  { code: '603501', sector: '科技' },   // 韦尔股份
  { code: '002415', sector: '科技' },   // 海康威视
  { code: '002230', sector: '人工智能' }, // 科大讯飞（AI 语音，2026-11-03 从科技移入 AI 板块）
  { code: '000063', sector: '科技' },   // 中兴通讯
  { code: '002475', sector: '科技' },   // 立讯精密
  { code: '688111', sector: '科技' },   // 金山办公
  { code: '000725', sector: '科技' },   // 京东方A
  { code: '600276', sector: '医药' },   // 恒瑞医药
  { code: '603259', sector: '医药' },   // 药明康德
  { code: '000538', sector: '医药' },   // 云南白药
  { code: '600900', sector: '公用' },   // 长江电力
  { code: '601088', sector: '能源' },   // 中国神华
  { code: '601857', sector: '能源' },   // 中国石油
  { code: '600028', sector: '能源' },   // 中国石化
  { code: '601899', sector: '资源' },   // 紫金矿业
  { code: '600585', sector: '建材' },   // 海螺水泥
  { code: '600309', sector: '化工' },   // 万华化学
  { code: '000002', sector: '地产' },   // 万科A
  { code: '601668', sector: '基建' },   // 中国建筑
  { code: '600104', sector: '汽车' },   // 上汽集团
  { code: '002352', sector: '物流' },   // 顺丰控股
  { code: '002714', sector: '农业' },   // 牧原股份

  // ---- 人工智能（2026-11-03 新增板块）----
  // 刻意覆盖「算力 → 光模块 → 服务器 → 终端应用」一条产业链：
  // 同一个消息（比如某大模型发布）在这条链上的涨跌先后不同，正是讲
  // 「产业链传导」的好素材。688/300 开头是 ±20% 涨跌停，与主板对照。
  { code: '688256', sector: '人工智能' }, // 寒武纪（AI 芯片）
  { code: '688041', sector: '人工智能' }, // 海光信息（国产 CPU/DCU）
  { code: '300308', sector: '人工智能' }, // 中际旭创（光模块）
  { code: '300502', sector: '人工智能' }, // 新易盛（光模块）
  { code: '000977', sector: '人工智能' }, // 浪潮信息（AI 服务器）
  { code: '603019', sector: '人工智能' }, // 中科曙光（算力）
  { code: '300496', sector: '人工智能' }, // 中科创达（端侧 AI）
  { code: '002236', sector: '人工智能' }, // 大华股份（AI 视觉）
  { code: '601138', sector: '人工智能' }, // 工业富联（AI 服务器）

  // ---- AI 大模型（2026-11-03 新增板块）----
  // 关键教学点：**DeepSeek（深度求索）没有上市**，交易所买不到它本身。
  // A 股能买到的只有两类：
  //   ① DeepSeek 概念股（算力/云服务/数据上与幻方-DeepSeek 有关联的公司）；
  //   ② 其它已上市的大模型厂商（讯飞星火、360 智脑、天工、从容、拓尔思、天幕）。
  // 概念股的涨跌和「那家公司」的真实业绩未必相关 —— 这是新手最容易搞混的地方。
  { code: '300766', sector: 'AI 大模型' }, // 每日互动（DeepSeek 概念）
  { code: '688316', sector: 'AI 大模型' }, // 青云科技（算力云，DeepSeek 概念）
  { code: '688158', sector: 'AI 大模型' }, // 优刻得（云计算，DeepSeek 概念）
  { code: '300846', sector: 'AI 大模型' }, // 首都在线（算力/IDC）
  { code: '002261', sector: 'AI 大模型' }, // 拓维信息（昇腾算力）
  { code: '601360', sector: 'AI 大模型' }, // 三六零（360 智脑）
  { code: '300418', sector: 'AI 大模型' }, // 昆仑万维（天工大模型）
  { code: '688327', sector: 'AI 大模型' }, // 云从科技（从容大模型）
  { code: '300229', sector: 'AI 大模型' }, // 拓尔思（行业大模型）
  { code: '300624', sector: 'AI 大模型' }, // 万兴科技（天幕大模型，AIGC）

  // ---- 小米产业链（2026-11-03 新增板块）----
  // 小米集团（1810.HK）在**港股**上市，A 股买不到；这里放的是小米手机/汽车
  // 的 A 股供应商 —— 「买不到那家公司，就买它的产业链」是概念股最典型的玩法。
  { code: '300735', sector: '小米产业链' }, // 光弘科技（小米手机主要代工厂）
  { code: '300709', sector: '小米产业链' }, // 精研科技（MIM 结构件）
  { code: '002600', sector: '小米产业链' }, // 领益智造（消费电子精密件）
  { code: '300433', sector: '小米产业链' }, // 蓝思科技（玻璃盖板）
  { code: '002126', sector: '小米产业链' }, // 银轮股份（热管理）
  { code: '601689', sector: '小米产业链' }, // 拓普集团（汽车零部件）
  { code: '002050', sector: '小米产业链' }, // 三花智控（热管理）
  { code: '605319', sector: '小米产业链' }  // 无锡振华（冲压件）
];

var INDEXES = [
  { code: '000001', secid: '1.000001', name: '上证指数' },
  { code: '399001', secid: '0.399001', name: '深证成指' },
  { code: '399006', secid: '0.399006', name: '创业板指' }
];

var UNIVERSE_MAP = {};
for (var i = 0; i < UNIVERSE.length; i++) UNIVERSE_MAP[UNIVERSE[i].code] = UNIVERSE[i];

var SNAPSHOT_TTL = 3000;        // 内存缓存 3 秒（盘中）
var SNAPSHOT_TTL_CLOSED = 60000; // 休市 60 秒（价格本来就不动）
var HTTP_TIMEOUT = 5000;

// ---- HTTP ----
function httpGet(host, path, referer) {
  return new Promise(function (resolve, reject) {
    var req = https.request({
      hostname: host,
      path: path,
      method: 'GET',
      timeout: HTTP_TIMEOUT,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ClassIntra-Stock/1.0',
        'Referer': referer || 'https://quote.eastmoney.com/',
        'Accept': 'application/json,text/plain,*/*'
      }
    }, function (res) {
      var chunks = [];
      res.on('data', function (c) { chunks.push(c); });
      res.on('end', function () {
        var body = Buffer.concat(chunks).toString('utf8');
        if (res.statusCode !== 200) return reject(new Error('行情源返回 ' + res.statusCode));
        try { resolve(JSON.parse(body)); }
        catch (e) { reject(new Error('行情源返回了非 JSON 内容')); }
      });
    });
    req.on('timeout', function () { req.destroy(); reject(new Error('行情请求超时')); });
    req.on('error', function (e) { reject(new Error('行情请求失败: ' + e.message)); });
    req.end();
  });
}

// ---- 数值清洗 ----
function num(v, fallback) {
  if (v === '-' || v === null || v === undefined || v === '') return fallback === undefined ? null : fallback;
  var n = Number(v);
  return isFinite(n) ? n : (fallback === undefined ? null : fallback);
}

function toCent(yuan) {
  if (yuan === null || yuan === undefined) return null;
  return Math.round(Number(yuan) * 100);
}

// ---- 快照 ----
var _snapshot = { at: 0, list: [], byCode: {}, stale: false, error: null };
var _lastGood = {};    // code -> quote（离线兜底用，也用于落库）

function buildQuote(f) {
  var code = String(f.f12 || '');
  var price = num(f.f2);
  var prevClose = num(f.f18);
  // 只有代码和昨收是硬要求：**开盘前（约 08:50–09:15）东财的 f2 现价返回 "-"**，
  // 之前这里直接 return null 把全池丢掉，整张行情表变空 —— 恰好是学生
  // 早读开平板的时段（2026-11-03 实踩）。盘前用昨收价顶上，涨跌记 0。
  if (!code || prevClose === null) return null;
  var preOpen = price === null;
  if (preOpen) price = prevClose;

  var limits = market.limitPrices(code, prevClose);
  return {
    code: code,
    name: String(f.f14 || ''),
    price: price,
    prev_close: prevClose,
    open: preOpen ? prevClose : num(f.f17, prevClose),
    high: preOpen ? prevClose : num(f.f15, price),
    low: preOpen ? prevClose : num(f.f16, price),
    change: preOpen ? 0 : num(f.f4, price - prevClose),
    change_pct: preOpen ? 0 : num(f.f3, prevClose ? (price - prevClose) / prevClose * 100 : 0),
    volume: num(f.f5, 0),            // 手
    amount: num(f.f6, 0),            // 元
    turnover: num(f.f8, 0),          // 换手率 %
    pe: num(f.f9, 0),
    pb: num(f.f23, 0),
    market_cap: num(f.f20, 0),
    limit_up: limits.up,
    limit_down: limits.down,
    limit_ratio: limits.ratio,
    price_cent: toCent(price),
    prev_close_cent: toCent(prevClose),
    sector: (UNIVERSE_MAP[code] && UNIVERSE_MAP[code].sector) || '',
    tradable: !!UNIVERSE_MAP[code],
    stale: false,
    pre_open: preOpen,
    quoted_at: Date.now()
  };
}

function secIds() {
  var ids = [];
  for (var i = 0; i < UNIVERSE.length; i++) ids.push(market.toSecId(UNIVERSE[i].code));
  return ids;
}

// 拉一次全池快照（一次请求，东财支持批量）
function fetchSnapshot() {
  var ids = secIds();
  var fields = 'f2,f3,f4,f5,f6,f8,f9,f12,f14,f15,f16,f17,f18,f20,f23';
  var path = '/api/qt/ulist.np/get?fltt=2&invt=2&fields=' + fields + '&secids=' + ids.join(',');
  return httpGet('push2.eastmoney.com', path).then(function (body) {
    var diff = body && body.data && body.data.diff;
    if (!diff || !diff.length) throw new Error('行情源没有返回数据');
    var list = [];
    for (var i = 0; i < diff.length; i++) {
      var q = buildQuote(diff[i]);
      if (q) list.push(q);
    }
    if (!list.length) throw new Error('行情数据为空');
    return list;
  });
}

// 离线兜底：最后一次真实价 + 微小确定性游走（幅度受限，且明确标记 stale）
function simulateFromLast(code, ts) {
  var last = _lastGood[code];
  if (!last) return null;
  var seed = 0;
  for (var i = 0; i < code.length; i++) seed = (seed * 31 + code.charCodeAt(i)) % 100000;
  var minutes = Math.floor(ts / 60000);
  var wave = Math.sin((minutes + seed % 97) / 11.3) * 0.0025 +
             Math.sin((minutes + seed % 37) / 3.7) * 0.0012;
  var pct = Math.max(-0.03, Math.min(0.03, wave));
  var price = market.roundPrice(last.price * (1 + pct));
  var prevClose = last.prev_close;
  return {
    code: code,
    name: last.name,
    price: price,
    prev_close: prevClose,
    open: last.open,
    high: Math.max(last.high, price),
    low: Math.min(last.low, price),
    change: market.roundPrice(price - prevClose),
    change_pct: Math.round((price - prevClose) / prevClose * 10000) / 100,
    volume: last.volume,
    amount: last.amount,
    turnover: last.turnover,
    pe: last.pe,
    pb: last.pb,
    market_cap: last.market_cap,
    limit_up: last.limit_up,
    limit_down: last.limit_down,
    limit_ratio: last.limit_ratio,
    price_cent: toCent(price),
    prev_close_cent: toCent(prevClose),
    sector: last.sector,
    tradable: last.tradable,
    stale: true,
    quoted_at: ts
  };
}

// 对外主入口：返回 { list, byCode, stale, error, at }
function getSnapshot(opts) {
  var o = opts || {};
  var now = Date.now();
  var session = market.currentSession(now);
  var ttl = session.settles ? SNAPSHOT_TTL : SNAPSHOT_TTL_CLOSED;

  if (!o.force && _snapshot.at && now - _snapshot.at < ttl && _snapshot.list.length) {
    return Promise.resolve(_snapshot);
  }

  return fetchSnapshot().then(function (list) {
    var byCode = {};
    for (var i = 0; i < list.length; i++) {
      byCode[list[i].code] = list[i];
      _lastGood[list[i].code] = list[i];
    }
    _snapshot = { at: now, list: list, byCode: byCode, stale: false, error: null };
    persist(list);
    return _snapshot;
  }).catch(function (err) {
    console.warn('[stock] 行情拉取失败，使用兜底数据:', err.message);
    // 兜底：优先用内存最后价，其次用库里落的最后价
    var fallbackList = [];
    for (var i = 0; i < UNIVERSE.length; i++) {
      var code = UNIVERSE[i].code;
      if (!_lastGood[code]) {
        var row = readCachedQuote(code);
        if (row) _lastGood[code] = row;
      }
      var q = simulateFromLast(code, now);
      if (q) fallbackList.push(q);
    }
    // 从未成功拉过行情（首次启动且断网）：不编造价格，返回空 + 错误
    _snapshot = {
      at: now,
      list: fallbackList,
      byCode: (function () {
        var m = {};
        for (var j = 0; j < fallbackList.length; j++) m[fallbackList[j].code] = fallbackList[j];
        return m;
      })(),
      stale: true,
      error: err.message
    };
    return _snapshot;
  });
}

function getQuote(code, opts) {
  var c = market.normalizeCode(code);
  if (!c) return Promise.reject(new Error('股票代码不合法'));
  if (!UNIVERSE_MAP[c]) return Promise.reject(new Error('该股票不在可交易范围内'));
  return getSnapshot(opts).then(function (snap) {
    var q = snap.byCode[c];
    if (!q) throw new Error('暂时拿不到该股票的行情');
    return q;
  });
}

// ---- 落库兜底（进程重启后仍有「最后真实价」可用）----
var _persistAt = 0;
function persist(list) {
  var now = Date.now();
  if (now - _persistAt < 30000) return;
  _persistAt = now;
  try {
    var db = require('./store').db();
    var stmt = db.prepare([
      'INSERT INTO stock_quotes (code, name, price_cent, prev_close_cent, open_cent, high_cent, low_cent,',
      '  volume, amount, quoted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      'ON CONFLICT(code) DO UPDATE SET name = excluded.name, price_cent = excluded.price_cent,',
      '  prev_close_cent = excluded.prev_close_cent, open_cent = excluded.open_cent,',
      '  high_cent = excluded.high_cent, low_cent = excluded.low_cent,',
      '  volume = excluded.volume, amount = excluded.amount, quoted_at = excluded.quoted_at'
    ].join('\n'));
    var tx = db.transaction(function () {
      for (var i = 0; i < list.length; i++) {
        var q = list[i];
        stmt.run(q.code, q.name, q.price_cent, q.prev_close_cent,
          toCent(q.open), toCent(q.high), toCent(q.low),
          Math.round(q.volume || 0), Math.round(q.amount || 0), q.quoted_at);
      }
    });
    tx();
  } catch (e) {
    // 落库失败不影响行情本身，下次再试
  }
}

function readCachedQuote(code) {
  try {
    var db = require('./store').db();
    var r = db.prepare('SELECT * FROM stock_quotes WHERE code = ?').get(code);
    if (!r) return null;
    var prev = r.prev_close_cent / 100;
    var price = r.price_cent / 100;
    var limits = market.limitPrices(code, prev);
    return {
      code: r.code, name: r.name, price: price, prev_close: prev,
      open: r.open_cent / 100, high: r.high_cent / 100, low: r.low_cent / 100,
      change: market.roundPrice(price - prev),
      change_pct: prev ? Math.round((price - prev) / prev * 10000) / 100 : 0,
      volume: r.volume, amount: r.amount, turnover: 0, pe: 0, pb: 0, market_cap: 0,
      limit_up: limits.up, limit_down: limits.down, limit_ratio: limits.ratio,
      price_cent: r.price_cent, prev_close_cent: r.prev_close_cent,
      sector: (UNIVERSE_MAP[code] && UNIVERSE_MAP[code].sector) || '',
      tradable: true, stale: true, quoted_at: r.quoted_at
    };
  } catch (e) {
    return null;
  }
}

// ---- 指数 ----
function getIndexes() {
  var ids = INDEXES.map(function (x) { return x.secid; }).join(',');
  var path = '/api/qt/ulist.np/get?fltt=2&invt=2&fields=f2,f3,f4,f12,f14&secids=' + ids;
  return httpGet('push2.eastmoney.com', path).then(function (body) {
    var diff = (body && body.data && body.data.diff) || [];
    var out = [];
    for (var i = 0; i < INDEXES.length; i++) {
      var hit = null;
      for (var j = 0; j < diff.length; j++) {
        if (String(diff[j].f12) === INDEXES[i].code) { hit = diff[j]; break; }
      }
      if (hit) {
        out.push({
          code: INDEXES[i].code, name: hit.f14 || INDEXES[i].name,
          price: num(hit.f2, 0), change: num(hit.f4, 0), change_pct: num(hit.f3, 0)
        });
      }
    }
    return out;
  }).catch(function () { return []; });
}

// ---- K 线 ----
// klt: 101 日 / 102 周 / 103 月；fqt: 1 前复权
function getKline(code, klt, limit) {
  var c = market.normalizeCode(code);
  if (!c || !UNIVERSE_MAP[c]) return Promise.reject(new Error('该股票不在可交易范围内'));
  var secid = market.toSecId(c);
  var lmt = Math.min(Math.max(parseInt(limit, 10) || 90, 20), 240);
  var path = '/api/qt/stock/kline/get?secid=' + secid +
    '&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57,f58' +
    '&klt=' + (klt || 101) + '&fqt=1&end=20500101&lmt=' + lmt;

  return httpGet('push2his.eastmoney.com', path).then(function (body) {
    var data = body && body.data;
    if (!data || !data.klines) throw new Error('暂无 K 线数据');
    var rows = [];
    for (var i = 0; i < data.klines.length; i++) {
      var p = String(data.klines[i]).split(',');
      rows.push({
        date: p[0],
        open: num(p[1], 0),
        close: num(p[2], 0),
        high: num(p[3], 0),
        low: num(p[4], 0),
        volume: num(p[5], 0),
        amount: num(p[6], 0),
        change_pct: num(p[8], 0)
      });
    }
    return { code: c, name: data.name || '', klines: rows };
  });
}

// ---- 分时 ----
function getTrends(code) {
  var c = market.normalizeCode(code);
  if (!c || !UNIVERSE_MAP[c]) return Promise.reject(new Error('该股票不在可交易范围内'));
  var secid = market.toSecId(c);
  var path = '/api/qt/stock/trends2/get?secid=' + secid +
    '&fields1=f1,f2,f3,f4,f5,f6,f7,f8&fields2=f51,f52,f53,f54,f55,f56,f57,f58&ndays=1&iscr=0';

  return httpGet('push2his.eastmoney.com', path).then(function (body) {
    var data = body && body.data;
    if (!data || !data.trends) throw new Error('暂无分时数据');
    var rows = [];
    for (var i = 0; i < data.trends.length; i++) {
      var p = String(data.trends[i]).split(',');
      rows.push({
        time: String(p[0] || '').slice(11),
        price: num(p[2], 0),
        avg: num(p[7], 0),
        volume: num(p[5], 0)
      });
    }
    return {
      code: c,
      name: data.name || '',
      prev_close: num(data.preClose, 0),
      points: rows
    };
  });
}

// ---- 检索（只在本池内）----
function search(keyword) {
  var k = String(keyword || '').trim().toLowerCase();
  if (!k) return [];
  return getSnapshot().then(function (snap) {
    var out = [];
    for (var i = 0; i < snap.list.length; i++) {
      var q = snap.list[i];
      if (q.code.indexOf(k) === 0 || String(q.name).toLowerCase().indexOf(k) !== -1 ||
          String(q.sector).toLowerCase().indexOf(k) !== -1) {
        out.push(q);
      }
      if (out.length >= 20) break;
    }
    return out;
  });
}

module.exports = {
  UNIVERSE: UNIVERSE,
  UNIVERSE_MAP: UNIVERSE_MAP,
  INDEXES: INDEXES,
  getSnapshot: getSnapshot,
  getQuote: getQuote,
  getIndexes: getIndexes,
  getKline: getKline,
  getTrends: getTrends,
  search: search,
  isTradable: function (code) {
    var c = market.normalizeCode(code);
    return !!(c && UNIVERSE_MAP[c]);
  }
};
