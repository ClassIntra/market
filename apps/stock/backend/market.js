// 交易市场规则（A 股）
// ============================================================
// 这里只放「规则」，不放数据。规则错了，整个模拟盘就假了，
// 所以每条都注明依据，改动前先想清楚。
//
// 时间：全部按**北京时间**（UTC+8）判断，服务器时区无关。
// 学校平板在国内，服务器可能跑在 UTC，不能依赖 new Date().getHours()。

// ---- 交易时段 ----
// 9:15-9:25 开盘集合竞价（可挂单，9:25 统一撮合）
// 9:25-9:30 静默（不可下单，真实券商此时段只收不报）
// 9:30-11:30 上午连续竞价
// 11:30-13:00 午休（可挂单，等下午开盘）
// 13:00-14:57 下午连续竞价
// 14:57-15:00 收盘集合竞价
// 15:00-15:02 收盘结算窗口：只给 15:00 前挂的单按收盘价成交，不接受新单立即成交
var SESSIONS = [
  { key: 'auction_open', label: '开盘集合竞价', from: '09:15', to: '09:25' },
  { key: 'pre_open', label: '开盘前', from: '09:25', to: '09:30' },
  { key: 'morning', label: '上午连续竞价', from: '09:30', to: '11:30' },
  { key: 'lunch', label: '午间休市', from: '11:30', to: '13:00' },
  { key: 'afternoon', label: '下午连续竞价', from: '13:00', to: '14:57' },
  { key: 'auction_close', label: '收盘集合竞价', from: '14:57', to: '15:00' },
  { key: 'close_settle', label: '收盘结算', from: '15:00', to: '15:02' }
];

// 这些时段接受「立即撮合」；其余时段挂单入队，等下一个可撮合时段
var CONTINUOUS_KEYS = { morning: true, afternoon: true };
// 这些时段允许撮合器用行情成交。集合竞价期间只收单不成交，
// 9:25 后用开盘价成交，15:00 后用收盘价结算 —— 与真实 A 股节奏对齐。
var MATCHABLE_KEYS = { pre_open: true, morning: true, afternoon: true, close_settle: true };

// 周末休市。法定节假日不在这里（没有权威数据源，硬编码会过期），
// 改为「行情源返回的昨收/日期」判断：休市日东财会给出上一交易日的数据，
// 撮合器靠 trade_date 与报价日期是否一致来识别「今天没开盘」。
function isWeekend(date) {
  var d = date.getUTCDay();
  return d === 0 || d === 6;
}

// 把任意时间转换成「北京时间」的日历字段
function bjParts(ts) {
  var d = new Date((ts || Date.now()) + 8 * 3600 * 1000);
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    hour: d.getUTCHours(),
    minute: d.getUTCMinutes(),
    second: d.getUTCSeconds(),
    weekday: d.getUTCDay()
  };
}

function pad2(n) { return n < 10 ? '0' + n : String(n); }

function dateKey(ts) {
  var p = bjParts(ts);
  return p.year + '-' + pad2(p.month) + '-' + pad2(p.day);
}

function hhmm(ts) {
  var p = bjParts(ts);
  return pad2(p.hour) + ':' + pad2(p.minute);
}

function toMinutes(hhmmStr) {
  var parts = String(hhmmStr).split(':');
  return parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10);
}

// 当前处于哪个时段
function currentSession(ts) {
  var p = bjParts(ts);
  var out;
  if (p.weekday === 0 || p.weekday === 6) {
    out = { key: 'closed', label: '周末休市', tradable: false, settles: false, matchable: false };
  } else {
    var m = p.hour * 60 + p.minute;
    out = null;
    for (var i = 0; i < SESSIONS.length; i++) {
      var s = SESSIONS[i];
      if (m >= toMinutes(s.from) && m < toMinutes(s.to)) {
        var isCloseSettle = s.key === 'close_settle';
        out = {
          key: s.key,
          label: s.label,
          // 收盘结算窗口只结算已有挂单，不再把新单当成盘中单成交
          tradable: !isCloseSettle,
          // 只有连续竞价能「立即成交」，集合竞价要等到结束时统一撮合
          settles: !!CONTINUOUS_KEYS[s.key],
          matchable: !!MATCHABLE_KEYS[s.key],
          force_quote: isCloseSettle,
          until: s.to
        };
        break;
      }
    }
    if (!out) {
      if (m < toMinutes('09:15')) out = { key: 'pre_market', label: '未开盘', tradable: false, settles: false, matchable: false, until: '09:15' };
      else out = { key: 'closed', label: '已收盘', tradable: false, settles: false, matchable: false, next: '次日 09:15' };
    }
  }

  // 测试通道：端到端测试在周末/夜间跑时，用这个开关把时段强制成「连续竞价」，
  // 这样成交链路（市价单即时成交、T+1、成就）在任何时间都能被验证。
  // 价格仍然来自真实行情快照（休市时是周五收盘价），只是撮合时钟被拨正了。
  // 只在显式设置环境变量的进程里生效，生产不会带上它。
  if (process.env.STOCK_FORCE_TRADABLE === '1' && (!out.tradable || !out.settles)) {
    out = {
      key: 'morning', label: '交易时段（测试强制）', tradable: true,
      settles: true, matchable: true, forced: true
    };
  }
  return out;
}

// 当日有效委托的到期时间：最近一个工作日 15:02（收盘结算结束）。
// 若写成 15:00，会在收盘结算窗口开始前就把单撤掉，收盘竞价永远轮不到。
// 15:00 之后下的单算下一交易日（收盘结算只收 15:00 前的单）；
// 周末顺延到周一。节假日没有权威表，由行情日期守卫保证不会在休市日成交，
// 到期只影响挂单寿命。
function nextCloseMs(ts) {
  var now = ts || Date.now();
  var p = bjParts(now);
  var afterClose = (p.hour * 60 + p.minute) >= 15 * 60;
  var base = Date.UTC(p.year, p.month - 1, p.day) + (afterClose ? 86400000 : 0);
  var d = new Date(base);
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d = new Date(d.getTime() + 86400000);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 15, 2, 0) - 8 * 3600000;
}

// 收盘结算只允许结算 15:00 之前已经挂出的委托；15:00 后新下的单等下一交易日。
function closeCutoffMs(ts) {
  var p = bjParts(ts);
  return Date.UTC(p.year, p.month - 1, p.day, 15, 0, 0) - 8 * 3600000;
}

// 休市日 / 行情源未更新时，别在界面上显示「交易中」。
// 判断依据是行情自带的交易日，不硬编码节假日表。
function sessionForSnapshot(session, snap) {
  if (!session) return session;
  if (snap && snap.stale) {
    return Object.assign({}, session, {
      key: 'stale', label: '行情延迟 · ' + session.label,
      tradable: false, settles: false, matchable: false, stale: true
    });
  }
  var today = dateKey();
  var quoteDate = snap && snap.quote_date;
  if (quoteDate && quoteDate !== today && session.tradable) {
    return {
      key: 'market_closed',
      label: '休市（行情未更新）',
      tradable: false, settles: false, matchable: false,
      quote_date: quoteDate
    };
  }
  return session;
}

// 是否允许下单。
// ---- 2026-11-03 全面放开（产品决策：校园平板不是天天用，时间门槛别卡学生）----
// 之前市价委托被限制在连续竞价时段，学生晚自习/周末打开平板就被拒 ——
// 平板场景下这个门槛只有挫败感没有教育价值。现在：
//   · **限价与市价委托任何时间都能下**（含周末/夜间/节假日）；
//   · 交易时段内下单：市价单立即按最新价成交；
//   · 休市时下单：委托入队，下一次撮合时成交（9:25 集合竞价按开盘价，
//     其余开市时段按最新价），永久有效直到成交或撤单。
// 撮合本身仍然只在有真实行情的时段发生 —— 休市没有新价格可撮，不会「假装成交」。
function canPlaceOrder(ts, orderType) {
  return true;
}

// ---- 手数与价格档位 ----
var LOT_SIZE = 100;             // 1 手 = 100 股
var MIN_BUY_QTY = 100;          // 买入最少 1 手
var SELL_ALL_OK = true;         // 卖出可不足 1 手（零股必须一次卖完，服务层校验）

// A 股报价最小变动单位：0.01 元
function roundPrice(priceYuan) {
  return Math.round(Number(priceYuan) * 100) / 100;
}

// ---- 涨跌停 ----
// 科创板 / 创业板注册制：±20%；主板：±10%；ST：±5%；北交所：±30%
function limitRatio(code) {
  var c = String(code || '');
  if (c.indexOf('688') === 0 || c.indexOf('689') === 0) return 0.20;  // 科创板
  if (c.indexOf('300') === 0 || c.indexOf('301') === 0) return 0.20;  // 创业板
  if (c.indexOf('8') === 0 || c.indexOf('4') === 0) return 0.30;      // 北交所
  return 0.10;
}

function limitPrices(code, prevCloseYuan, isST) {
  var ratio = isST ? 0.05 : limitRatio(code);
  var prev = Number(prevCloseYuan) || 0;
  return {
    ratio: ratio,
    up: roundPrice(prev * (1 + ratio)),
    down: roundPrice(prev * (1 - ratio))
  };
}

// ---- 费用（单位：分，四舍五入）----
// 佣金：万分之 2.5，单笔最低 5 元（双向）
// 印花税：卖出 0.05%（2023-08-28 减半后标准，仅卖出）
// 过户费：成交额 0.001%（双向，沪深均收）
var COMMISSION_RATE = 0.00025;
var COMMISSION_MIN_CENT = 500;       // 5 元
var STAMP_RATE = 0.0005;
var TRANSFER_RATE = 0.00001;

function calcFees(side, amountCent) {
  var amt = Math.max(0, Math.round(amountCent));
  var commission = Math.max(Math.round(amt * COMMISSION_RATE), COMMISSION_MIN_CENT);
  var transfer = Math.round(amt * TRANSFER_RATE);
  var stamp = side === 'sell' ? Math.round(amt * STAMP_RATE) : 0;
  return {
    commission_cent: commission,
    transfer_cent: transfer,
    stamp_cent: stamp,
    total_cent: commission + transfer + stamp
  };
}

// 买入最大可买手数（考虑费用：钱要够付成交额+费用）
function maxBuyQty(availableCent, priceYuan) {
  var priceCent = Math.round(Number(priceYuan) * 100);
  if (!(priceCent > 0)) return 0;
  var lo = 0;
  var hi = Math.floor(availableCent / priceCent / LOT_SIZE) + 1;
  // 费用是阶梯式的（有 5 元下限），用二分找临界点，避免解析解算错
  while (lo < hi) {
    var mid = Math.ceil((lo + hi) / 2);
    var qty = mid * LOT_SIZE;
    var amount = qty * priceCent;
    var need = amount + calcFees('buy', amount).total_cent;
    if (need <= availableCent) lo = mid; else hi = mid - 1;
  }
  return lo * LOT_SIZE;
}

// ---- 代码规范化 ----
// 用户输入 600519 / sh600519 / 1.600519 都能认
function normalizeCode(input) {
  var s = String(input || '').trim().toUpperCase();
  s = s.replace(/^(SH|SZ|BJ)/, '').replace(/^\d\./, '');
  if (!/^\d{6}$/.test(s)) return null;
  return s;
}

// 东财 secid：沪市 1.，深市/北交所 0.
function toSecId(code) {
  var c = String(code || '');
  if (c.indexOf('6') === 0 || c.indexOf('9') === 0) return '1.' + c;
  return '0.' + c;
}

module.exports = {
  SESSIONS: SESSIONS,
  LOT_SIZE: LOT_SIZE,
  MIN_BUY_QTY: MIN_BUY_QTY,
  COMMISSION_RATE: COMMISSION_RATE,
  COMMISSION_MIN_CENT: COMMISSION_MIN_CENT,
  STAMP_RATE: STAMP_RATE,
  TRANSFER_RATE: TRANSFER_RATE,
  bjParts: bjParts,
  dateKey: dateKey,
  hhmm: hhmm,
  isWeekend: isWeekend,
  currentSession: currentSession,
  sessionForSnapshot: sessionForSnapshot,
  closeCutoffMs: closeCutoffMs,
  nextCloseMs: nextCloseMs,
  canPlaceOrder: canPlaceOrder,
  roundPrice: roundPrice,
  limitRatio: limitRatio,
  limitPrices: limitPrices,
  calcFees: calcFees,
  maxBuyQty: maxBuyQty,
  normalizeCode: normalizeCode,
  toSecId: toSecId
};
