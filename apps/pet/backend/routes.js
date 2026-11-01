// 桌宠后端：宠物状态（领养/设计/开关）存 user_kv_store，卸载 cleanup 清键。
// 数据格式（design）：
//   { v: 1, w: 16, h: 16, pal: 'p16', data: '<256 字符，每字符为调色板索引 0-f 或 . 表示空>' }
// 编码约定：var / function / 单引号
var express = require('express');
var path = require('path');
var router = express.Router();
var requireAuth = require(path.resolve(process.cwd(), 'src/middleware/auth')).requireAuth;
var db = require(path.resolve(process.cwd(), 'src/utils/db'));

var KV_KEY = 'desktop_pet';
var MAX_DIM = 32;
var PALETTE = {
  p16: ['#1B1B1F', '#8E8E93', '#FFFFFF', '#E5E5EA', '#FF3B30', '#FF9EBB', '#FF9500', '#FFD60A',
        '#A0715F', '#34C759', '#248A3D', '#64D2FF', '#0A84FF', '#BF5AF2', '#FFD8B8', '#FF7B92']
};

// 官方模板（16×16 字符画，'.' 为空，十六进制字符为调色板索引）
var TEMPLATES = [
  {
    id: 'danzi',
    name: '蛋黄团子',
    desc: '圆滚滚的小蛋黄，自带腮红',
    art: [
      '................',
      '................',
      '.....722777.....',
      '....77777777....',
      '...7777777777...',
      '..777777777777..',
      '..777777777777..',
      '.77770777707777.',
      '.7ff7777777ff77.',
      '.77777700777777.',
      '.77777777777777.',
      '..777777777777..',
      '....77777777....',
      '......7777......',
      '................',
      '................'
    ]
  },
  {
    id: 'cat',
    name: '团子猫',
    desc: '粉耳朵的小白猫，走路没有声音',
    art: [
      '................',
      '..22........22..',
      '..2f2......2f2..',
      '..222222222222..',
      '.22222222222222.',
      '.22022222222022.',
      '.22222200222222.',
      '.2ff22222222ff2.',
      '..222222222222..',
      '..222222222222..',
      '..211111111112..',
      '..222222222222..',
      '..222.2222.222..',
      '................',
      '................',
      '................'
    ]
  },
  {
    id: 'mame',
    name: '小绿豆',
    desc: '一颗有呆毛的豆，看着你的眼神很认真',
    art: [
      '................',
      '.......99.......',
      '.....999999.....',
      '....99999999....',
      '...9999999999...',
      '..999999999999..',
      '.99009999990099.',
      '.9f9999999999f9.',
      '.99999900999999.',
      '.99999999999999.',
      '..999999999999..',
      '...9999999999...',
      '....99999999....',
      '.....999999.....',
      '................',
      '................'
    ]
  }
];

function userId(req) {
  return String((req.user && req.user.user_id) || '');
}

function todayKey() {
  var d = new Date();
  return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
}

// 羁绊值获得规则（每日上限防刷：poke10 + feed3 + visit1 = 最高 +25/天）
var INTERACT_RULES = {
  poke:  { gain: 1, dailyCap: 10, cooldownMs: 0 },
  feed:  { gain: 4, dailyCap: 3, cooldownMs: 20 * 60 * 1000 },
  gift:  { gain: 2, dailyCap: 2, cooldownMs: 0 },
  visit: { gain: 3, dailyCap: 1, cooldownMs: 0 }
};

// 羁绊称号（客户端同步使用；服务端只存分数）
// 0-19 初识 / 20-59 熟悉 / 60-119 亲密 / 120-199 形影不离 / 200+ 灵魂伙伴
var TIER = [0, 20, 60, 120, 200];
var TIER_NAMES = ['初识', '熟悉', '亲密', '形影不离', '灵魂伙伴'];
function tierOf(b) { var t = 0; for (var i = 0; i < TIER.length; i++) { if (b >= TIER[i]) t = i; } return t; }

// ==================== 性格 / 心情 / 互动反应（v0.15.0）====================
// 桌宠最常见的死法不是「没事干」，是「每次干都一样」：
// 喂食 +4、摸摸 +1，点十次就是十个 +4，玩家第三天就摸清了全部规律，
// 从此这个应用只剩打卡。加功能救不了这件事，加法是「更多一样的动作」。
//
// 这里改的是「同一个动作的体感」：
//   · 性格 —— 领养时定下，恒久影响收益与台词。这只贪吃，那只高冷。
//   · 心情 —— 由时段 / 饱食 / 今日互动算出来，每次进页面都可能不同。
//   · 反应 —— 互动时有一定概率触发「大成功」，收益更高、有专门的表现。
//
// ⚠️ 三条硬约束（不遵守就会破坏已有平衡）：
//   1. 性格只加不减：最差也是原值。否则「随机到差性格」= 惩罚，玩家会重开。
//   2. 每日次数上限一律不动（poke 10 / feed 3 / gift 2 / visit 1），
//      特殊反应只在「本来就该给收益」的那一次里发生。
//   3. 全部字段可缺省：老存档没有 personality 就按 uid 现算，不迁移、不报错。
var PERSONALITIES = {
  glutton: {
    id: 'glutton', name: '贪吃', icon: '🍙', desc: '闻到香味就走不动',
    feedBonus: 2, pokeBonus: 0, critRate: 0.15,
    lines: ['闻到香味了…是给我带的吗', '刚才梦见一条很大的鱼', '肚子有点空，不过没关系']
  },
  clingy: {
    id: 'clingy', name: '粘人', icon: '💞', desc: '你走到哪它看到哪',
    feedBonus: 0, pokeBonus: 1, critRate: 0.15,
    lines: ['你去哪我就跟到哪', '刚刚一直在等你回头', '今天也想被摸很多下']
  },
  aloof: {
    id: 'aloof', name: '高冷', icon: '🌙', desc: '嘴上说不要，尾巴在摇',
    feedBonus: 0, pokeBonus: 0, critRate: 0.24,
    lines: ['……我不是在等你', '别摸了。再摸一下也可以', '这里风景还行，我随便站站']
  },
  curious: {
    id: 'curious', name: '好奇', icon: '🔍', desc: '什么都想闻一闻',
    feedBonus: 0, pokeBonus: 0, critRate: 0.30,
    lines: ['你桌上那个新东西是什么', '刚才有只虫飞过去，我盯了很久', '今天会发生什么']
  },
  sleepy: {
    id: 'sleepy', name: '贪睡', icon: '😴', desc: '一天能睡二十小时',
    feedBonus: 1, pokeBonus: 0, critRate: 0.12,
    lines: ['再睡五分钟…', '刚才打了个盹，梦见自己在打盹', '唔，你回来了']
  }
};
var PERSONALITY_IDS = ['glutton', 'clingy', 'aloof', 'curious', 'sleepy'];
var DEFAULT_PERSONALITY = 'curious';

// 性格存在 state.personality；缺省时用 uid 现算。
// 为什么用 uid 而不是 Math.random：性格不该「随机跳变」——
// 存档迁移、换设备、清缓存之后，它必须还是同一只贪吃的鱼。
function personalityOf(st, uid) {
  var id = st && st.personality;
  if (!PERSONALITIES[id]) {
    id = PERSONALITY_IDS[fnv1a('p:' + (uid || 0)) % PERSONALITY_IDS.length];
  }
  return PERSONALITIES[id];
}

// 心情：不是随机数，是可以被玩家「照顾出来」的状态。
// 优先级即这里的顺序 —— 半夜就是困，饿了就是饿，被照顾得多就是满足。
function moodOf(st, now) {
  var d = now || new Date();
  var h = d.getHours();
  var fed = (st && st.fed_today) || 0;
  var poked = (st && st.poked_today) || 0;
  var bondToday = (st && st.bond_today) || 0;
  if (h >= 23 || h < 6) {
    return { id: 'sleepy', name: '困了', icon: '😴', tone: 'low',
             text: '这个点还没睡吗…我趴一会儿，有事叫我' };
  }
  if (bondToday >= 15) {
    return { id: 'bliss', name: '很满足', icon: '😊', tone: 'high',
             text: '今天被照顾得很好，尾巴一直没放下来' };
  }
  if (fed === 0 && h >= 12) {
    return { id: 'hungry', name: '饿了', icon: '🍚', tone: 'low',
             text: '肚子叫了一声，你听见了吗' };
  }
  if (poked >= 3) {
    return { id: 'excited', name: '很兴奋', icon: '🤩', tone: 'high',
             text: '还想再被摸一下！就一下' };
  }
  return { id: 'calm', name: '平静', icon: '🌙', tone: 'mid',
           text: '在桌上待着，听你敲键盘' };
}

// 一次互动的收益：基础值 + 性格加成，再掷一次「大成功」。
// 心情好时概率翻 1.7 倍、心情差时压到 0.7 —— 这是「照顾得好会有回报」的唯一体现，
// 所以它只是概率浮动，不改变任何一种性格的收益下限。
function rollGain(type, p, mood) {
  var base = INTERACT_RULES[type].gain;
  if (type === 'feed') base += (p.feedBonus || 0);
  if (type === 'poke') base += (p.pokeBonus || 0);
  var rate = (p.critRate === undefined ? 0.15 : p.critRate);
  if (mood && mood.tone === 'high') rate *= 1.7;
  else if (mood && mood.tone === 'low') rate *= 0.7;
  if (Math.random() < rate) {
    return { gain: base + Math.max(2, Math.round(base * 0.6)), crit: true };
  }
  return { gain: base, crit: false };
}

// ==================== 专注陪伴 / 小鱼干 / 日记（v0.11.0）====================
// 桌宠最容易死在「每天点三下就没事可做」。解法不是再加一个每日任务，
// 而是给它一个和玩家真实生活绑定的产出：
//
//   陪它专注 N 分钟 → 掉小鱼干 → 换豪华大餐 → 喂它涨更多羁绊
//                                      ↓
//                            晚上自动生成一篇第一人称日记
//
// 这条链的关键是「收益必须来自玩家真的坐了 N 分钟」。所以：
//   - 只接受三种时长，服务端按 minutes 反推秒数上限，客户端虚报 elapsed 拿不到超额收益；
//   - 专注给的羁绊单独记额度（FOCUS_BOND_DAILY），不与摸摸/喂食抢那 25 点的日上限，
//     否则「专注 45 分钟」会把当天的互动额度吃光，反而劝退。
var FOCUS_ALLOWED = [15, 25, 45];
var FOCUS_COIN_MINUTES = 5;   // 每专注 5 分钟得 1 条小鱼干
var FOCUS_DONE_BONUS = 1;     // 完整走完（没中途放弃）额外 +1
var FOCUS_BOND = 2;           // 每完成一轮 +2 羁绊
var FOCUS_BOND_DAILY = 6;     // 专注羁绊每日上限（3 轮封顶）
var FEAST_COST = 5;           // 豪华大餐价格（小鱼干）
var FEAST_GAIN = 10;          // 豪华大餐羁绊（普通鱼干是 4）
var DIARY_KEEP_DAYS = 14;     // 日记保留天数
// 离线时光（v0.16.0）：桌宠在你不在时也有自己的生活
var OFFLINE_CAP_MIN = 480;    // 最多结算 8 小时
var OFFLINE_MIN_GAP = 30;     // 至少离线 30 分钟才触发
var OFFLINE_COIN_PER_HOUR = 2;// 每小时 2 条小鱼干
var OFFLINE_BOND_PER_HOUR = 1;// 每 2 小时 1 羁绊
var OFFLINE_CAP_COINS = 16;   // 8 小时上限 16 条
var OFFLINE_CAP_BOND = 4;     // 8 小时上限 4 羁绊

// 日记只存「事件计数」，文案在读取时用模板现算。
// 好处：① 存储极小（一天几行 JSON）；② 以后改文案，历史日记跟着一起变好；
// ③ 同一天用日期做种子选模板，刷新多少次都是同一句，不会闪来闪去。
function diaryPush(st, dateKey, ev) {
  if (!st) return;
  if (!st.diary || typeof st.diary !== 'object') st.diary = {};
  var day = st.diary[dateKey];
  if (!day || !day.length) day = st.diary[dateKey] = [];
  var found = null;
  for (var i = 0; i < day.length; i++) {
    if (day[i].k === ev.k) { found = day[i]; break; }
  }
  if (found) {
    if (ev.n) found.n = (found.n || 0) + ev.n;
    if (ev.m) found.m = (found.m || 0) + ev.m;
  } else {
    day.push({ k: ev.k, n: ev.n || 0, m: ev.m || 0 });
  }
  // 裁剪：只留最近 DIARY_KEEP_DAYS 天
  var keys = Object.keys(st.diary).sort();
  while (keys.length > DIARY_KEEP_DAYS) {
    delete st.diary[keys.shift()];
  }
}

function diaryText(dateKey, ev) {
  var feed = 0, feast = 0, poke = 0, focusMin = 0, wins = 0, caps = 0;
  for (var i = 0; i < ev.length; i++) {
    var e = ev[i] || {};
    if (e.k === 'feed') feed += (e.n || 0);
    else if (e.k === 'feast') feast += (e.n || 0);
    else if (e.k === 'poke') poke += (e.n || 0);
    else if (e.k === 'focus') focusMin += (e.m || 0);
    else if (e.k === 'win') wins += (e.n || 0);
    else if (e.k === 'capture') caps += (e.n || 0);
  }
  var seed = fnv1a(dateKey);
  // 每次取模板都推进一次种子：同一天刷新仍然是同一句（确定性），
  // 但同一篇日记里的几个分句不会共用同一个下标（否则全部第 0 句，读起来像模板）。
  var pick = function(arr) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return arr[seed % arr.length];
  };
  var parts = [];

  if (focusMin > 0) {
    parts.push(pick([
      '陪主人安静坐了 ' + focusMin + ' 分钟，我连尾巴都没晃。',
      '主人忙的时候，我就趴在旁边数呼吸。' + focusMin + ' 分钟，一次都没打扰。',
      '今天和主人一起专注了 ' + focusMin + ' 分钟，感觉自己也有点用。'
    ]));
  }
  if (feast > 0) {
    parts.push('还吃到了豪华大餐，是今天最亮的时刻。');
  } else if (feed > 0) {
    parts.push(pick([
      '吃了 ' + feed + ' 顿，肚子圆了一点。',
      '被喂了 ' + feed + ' 次，心情不错。',
      '今天有 ' + feed + ' 顿加餐，记在小本本上了。'
    ]));
  }
  if (poke > 0) {
    parts.push(pick(['被摸了 ' + poke + ' 下，毛都顺了。', '主人今天摸了我 ' + poke + ' 次。']));
  }
  if (wins > 0) parts.push('打架赢了 ' + wins + ' 场。');
  if (caps > 0) parts.push('交到了 ' + caps + ' 个新朋友。');

  if (!parts.length) {
    return pick([
      '今天主人在忙，我自己玩了一会儿影子。',
      '没什么事发生。阳光在桌面上挪了一格，我跟着挪了一格。',
      '安静的一天。我数了 137 次呼吸，最后数乱了。'
    ]);
  }
  return parts.join('');
}

// 日记视图：今天一句 + 过去若干天（新的在前）
function diaryView(st, today) {
  var diary = (st && st.diary) || {};
  var keys = Object.keys(diary).sort().reverse();
  var todayEv = diary[today] || [];
  var out = {
    today: { date: today, text: todayEv.length ? diaryText(today, todayEv) : '', count: todayEv.length },
    history: []
  };
  for (var i = 0; i < keys.length && out.history.length < 7; i++) {
    if (keys[i] === today) continue;
    out.history.push({ date: keys[i], text: diaryText(keys[i], diary[keys[i]] || []) });
  }
  return out;
}


// ==================== 系别（v0.8.0）====================
// 宝可梦最有用的那层设计不是「一百多种怪」，而是**属性相克**：
// 它让同一套数值在不同对局里产生不同的意义，玩家才会去想「我该带谁上场」。
//
// 这里只做 5 个属性，组成一条闭环：
//   火 → 草 → 土 → 电 → 水 → 火
// 每个属性克制下一个，被上一个克制。没有「免疫」「双属性」这些层，
// 因为这套战斗只有 24 回合，复杂度必须压到一眼能算清。
//
// ⚠️ 默认系别是「草」：它和三个 NPC 都是中性关系（见 NPC_TIERS），
//    这样老存档（没有 battle_type）的平衡数据不会因为新系统整体漂移。
var ELEMENTS = {
  fire:     { id: 'fire',     name: '火', icon: '🔥', color: '#FF6B4A', beats: 'grass' },
  grass:    { id: 'grass',    name: '草', icon: '🌿', color: '#34C759', beats: 'earth' },
  earth:    { id: 'earth',    name: '土', icon: '⛰️', color: '#B07A4A', beats: 'electric' },
  electric: { id: 'electric', name: '电', icon: '⚡', color: '#E6A700', beats: 'water' },
  water:    { id: 'water',    name: '水', icon: '💧', color: '#0A84FF', beats: 'fire' }
};
var ELEMENT_IDS = ['fire', 'grass', 'earth', 'electric', 'water'];
var DEFAULT_TYPE = 'grass';
var TYPE_ADV = 1.18;      // 克制：伤害 +18%
var TYPE_DIS = 0.86;      // 被克：伤害 -14%
function normType(id) { return ELEMENTS[id] ? id : DEFAULT_TYPE; }
function typeMul(atkType, defType) {
  var a = ELEMENTS[normType(atkType)];
  var d = normType(defType);
  if (a.beats === d) return TYPE_ADV;
  if (ELEMENTS[d].beats === a.id) return TYPE_DIS;
  return 1;
}
function elementList() {
  var out = [];
  for (var i = 0; i < ELEMENT_IDS.length; i++) {
    var e = ELEMENTS[ELEMENT_IDS[i]];
    out.push({
      id: e.id, name: e.name, icon: e.icon, color: e.color,
      beats: e.beats, beatsName: ELEMENTS[e.beats].name,
      weakTo: '', weakToName: ''
    });
  }
  // 反向关系单独补一遍：前端只读这两个名字就能把「克制谁 / 怕谁」写全
  for (var j = 0; j < out.length; j++) {
    for (var k = 0; k < out.length; k++) {
      if (ELEMENTS[out[k].id].beats === out[j].id) {
        out[j].weakTo = out[k].id;
        out[j].weakToName = out[k].name;
      }
    }
  }
  return out;
}
function typeInfo(id) {
  var e = ELEMENTS[normType(id)];
  var list = elementList();
  for (var i = 0; i < list.length; i++) if (list[i].id === e.id) return list[i];
  return list[0];
}

// 羁绊交互：POST /pet/interact { type: 'poke'|'feed'|'visit', food?: 'normal'|'feast' }
// 返回 { state, gained, tierUp, capped }
router.post('/interact', requireAuth, function(req, res) {
  var uid = userId(req);
  var type = req.body && req.body.type;
  var rule = INTERACT_RULES[type];
  if (!rule) return res.status(400).json({ code: 400, message: '未知交互类型' });

  // 豪华大餐：不是另一种「每日次数」，而是同一顿饭的加料。
  // 所以它共用 feed 的 20 分钟冷却和 3 次日上限，只是单次收益更高、要花小鱼干。
  // 不这么设计的话，玩家会把「免费鱼干」和「豪华大餐」当成两条独立产线，
  // 一天能刷 6 顿，羁绊曲线立刻崩掉。
  var food = (type === 'feed' && req.body && req.body.food === 'feast') ? 'feast' : 'normal';

  var row = db.prepare('SELECT value FROM user_kv_store WHERE user_id = ? AND key = ?').get(uid, KV_KEY);
  var state = {};
  if (row) { try { state = JSON.parse(row.value) || {}; } catch (e) { state = {}; } }
  if (!state.adopted) return res.status(400).json({ code: 400, message: '还未领养宠物' });

  // 先扣钱再判断次数：钱不够就别让他白点一次（错误信息要具体，不能只说「失败」）
  if (food === 'feast' && (state.coins || 0) < FEAST_COST) {
    return res.status(400).json({
      code: 400,
      message: '小鱼干不够了（需要 ' + FEAST_COST + ' 条，现在 ' + (state.coins || 0) + ' 条）'
    });
  }

  var today = todayKey();
  if (state.bond_date !== today) {
    state.bond_date = today;
    state.bond_today = 0;
    state.poked_today = 0;
    state.fed_today = 0;
    state.gift_today = 0;
    state.gift_date = today;
    state.visited_date = '';
  }

  var tierBefore = state.bond || 0;
  var gained = 0;
  var capped = false;
  var crit = false;
  // 性格/心情在这里算一次：既用于收益，也用于返回给前端的台词与表现。
  // 注意 mood 用的是「本次互动之前」的状态 —— 否则刚喂完就永远显示「很满足」，
  // 玩家看不到「从饿到饱」这个转变本身。
  var persona = personalityOf(state, uid);
  var moodNow = moodOf(state);

  // 冷却（feed）
  var now = Date.now();
  var lastFed = state.last_fed_at ? new Date(state.last_fed_at).getTime() : 0;
  if (rule.cooldownMs && now - lastFed < rule.cooldownMs) {
    var waitMin = Math.ceil((rule.cooldownMs - (now - lastFed)) / 60000);
    return res.status(429).json({ code: 429, message: '它刚吃过，' + waitMin + ' 分钟后再喂吧' });
  }

  // 送礼原本借用 visited_date 计数，但那个字段只标记「今天来过」，从来不累加，
  // 等于 gift 的每日上限形同虚设（可以无限刷羁绊）。这里给它独立的日期 + 计数。
  var used = type === 'poke' ? (state.poked_today || 0)
    : (type === 'feed' ? (state.fed_today || 0)
    : (type === 'gift' ? (state.gift_date === today ? (state.gift_today || 0) : 0)
    : (state.visited_date === today ? 1 : 0)));
  if (used >= rule.dailyCap) {
    capped = true;
  } else {
    // 豪华大餐只在真的吃下去时才扣小鱼干（上面余额检查只是提前拦截）。
    // 大餐是「花币买的确定性收益」，不吃随机浮动 —— 否则花 5 条鱼干换来一次
    // 「大成功」和一次「普通」，玩家会觉得亏。
    if (food === 'feast') {
      gained = FEAST_GAIN;
    } else {
      var roll = rollGain(type, persona, moodNow);
      gained = roll.gain;
      crit = roll.crit;
    }
    state.bond = (state.bond || 0) + gained;
    state.bond_today = (state.bond_today || 0) + gained;
    if (type === 'poke') { state.poked_today = used + 1; diaryPush(state, today, { k: 'poke', n: 1 }); }
    if (type === 'feed') {
      state.fed_today = used + 1;
      state.last_fed_at = new Date().toISOString();
      if (food === 'feast') {
        state.coins = Math.max(0, (state.coins || 0) - FEAST_COST);
        diaryPush(state, today, { k: 'feast', n: 1 });
      } else {
        diaryPush(state, today, { k: 'feed', n: 1 });
      }
    }
    if (type === 'gift') { state.gift_date = today; state.gift_today = used + 1; }
    if (type === 'visit') state.visited_date = today;
  }
  state.updated_at = new Date().toISOString();
  db.prepare('INSERT INTO user_kv_store (user_id, key, value) VALUES (?, ?, ?) ' +
    'ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value')
    .run(uid, KV_KEY, JSON.stringify(state));

  var tierUp = tierOf(state.bond) > tierOf(tierBefore);
  res.json({ code: 200, data: {
    state: publicState(state), gained: gained, tierUp: tierUp, capped: capped,
    food: food,
    // v0.15.0：这次互动是不是「大成功」，以及互动之后它现在什么心情。
    // 前端靠这两个字段决定飘字颜色、宠物动作和气泡台词 —— 没有它们，
    // 「+4」和「+10 大成功」在界面上是一模一样的，等于白算。
    crit: crit,
    mood: moodOf(state),
    personality: persona,
    quests: questsView(uid, state)
  } });
});

// ==================== 小游戏：逗它笑（v0.15.0）====================
// 为什么是「逗它笑」而不是又一个「每日任务」：
//   前者是玩家真的在动手（限时连点），后者是点一下看进度。
//   一次 15 秒的连点，比三条「点三次摸摸」更能让人停下来玩一会儿。
//
// ⚠️ 反作弊：服务端不信客户端报的 score 之外的任何东西。
//   - 上限 clamp 到 200，超出按 200 算；
//   - 每日只给一次结算（play_date），重复提交只返回上次的结果；
//   - 收益走独立的 PLAY_DAILY_CAP，不与互动那 25 点抢额度。
var PLAY_DAILY_CAP = 6;
var PLAY_SCORE_CAP = 200;
router.post('/play', requireAuth, function(req, res) {
  var uid = userId(req);
  var st = readPet(uid);
  if (!st || !st.adopted) return res.status(400).json({ code: 400, message: '还未领养宠物' });

  var today = todayKey();
  if (st.play_date !== today) { st.play_date = today; st.play_gain = 0; }

  var score = Math.min(PLAY_SCORE_CAP, Math.max(0, Math.floor(Number(req.body && req.body.score) || 0)));
  // 0 分也给一点保底，否则「差一点没点到」会变成完全白玩
  var base = score <= 0 ? 1 : Math.round(score * 0.06) + 1;
  var gain = Math.min(PLAY_DAILY_CAP, (st.play_gain || 0) + base);
  var added = gain - (st.play_gain || 0);
  st.bond = (st.bond || 0) + added;
  st.bond_today = (st.bond_today || 0) + added;
  st.play_gain = gain;
  st.updated_at = new Date().toISOString();
  db.prepare('INSERT INTO user_kv_store (user_id, key, value) VALUES (?, ?, ?) ' +
    'ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value')
    .run(uid, KV_KEY, JSON.stringify(st));

  res.json({ code: 200, data: {
    state: publicState(st), added: added, total: gain, cap: PLAY_DAILY_CAP,
    mood: moodOf(st), personality: personalityOf(st, uid),
    quests: questsView(uid, st)
  } });
});

// ==================== 故事章节（v0.15.0）====================
// GET：返回当前章节 + 进度 + 全部章节列表
router.get('/story', requireAuth, function(req, res) {
  var uid = userId(req);
  var st = readPet(uid);
  if (!st || !st.adopted) return res.status(400).json({ code: 400, message: '还未领养宠物' });
  var idx = storyChapterOf(st);
  var claimed = (st.story_claimed === undefined ? -1 : (st.story_claimed || 0));
  // 已领取到的最高章节
  var claimedIdx = Math.min(claimed, STORY_CHAPTERS.length - 1);
  var curChapter = STORY_CHAPTERS[idx];
  // 是否可领取奖励：当前章节 > 已领取章节
  var canClaim = idx > claimed;
  res.json({ code: 200, data: {
    chapters: STORY_CHAPTERS,
    currentIdx: idx,
    claimedIdx: claimedIdx,
    canClaim: canClaim,
    current: curChapter,
    unlockedCount: idx + 1,
    totalCount: STORY_CHAPTERS.length,
    progress: {
      bond: st.bond || 0,
      wins: st.battle_wins || 0,
      dex: st.dex_count || 0,
      achievements: (st.achievements || []).length,
      achievementsTotal: ACHIEVEMENTS.length
    }
  } });
});

// POST：领取当前章节奖励（幂等：已领取过的章节不再重复发放）
router.post('/story/claim', requireAuth, function(req, res) {
  var uid = userId(req);
  var st = readPet(uid);
  if (!st || !st.adopted) return res.status(400).json({ code: 400, message: '还未领养宠物' });
  var idx = storyChapterOf(st);
  var claimed = (st.story_claimed === undefined ? -1 : (st.story_claimed || 0));
  if (idx <= claimed) {
    return res.json({ code: 200, data: { alreadyClaimed: true, chapter: STORY_CHAPTERS[idx] } });
  }
  // 领取从 claimed+1 到 idx 的所有章节奖励（跳过的章节一并补发）
  var addedCoins = 0, addedBond = 0;
  for (var i = claimed + 1; i <= idx; i++) {
    var c = STORY_CHAPTERS[i];
    if (c && c.reward) {
      addedCoins += (c.reward.coins || 0);
      addedBond += (c.reward.bond || 0);
    }
  }
  st.coins = (st.coins || 0) + addedCoins;
  st.bond = (st.bond || 0) + addedBond;
  st.bond_today = (st.bond_today || 0) + addedBond;
  st.story_claimed = idx;
  writePet(uid, st);
  res.json({ code: 200, data: {
    claimed: idx,
    addedCoins: addedCoins,
    addedBond: addedBond,
    chapter: STORY_CHAPTERS[idx],
    state: publicState(st),
    mood: moodOf(st),
    personality: personalityOf(st, uid)
  } });
});

// 专注陪伴结算：POST /pet/focus { minutes: 15|25|45, elapsedSec, done }
//
// ⚠️ 反作弊思路：这里**不信**客户端报的 elapsedSec 以外的任何东西，
//    而 elapsedSec 本身也只用来「向下取整到分钟」并受 minutes 上限钳制。
//    真正的防线是收益上限（一轮最多 45 分钟的量），而不是时间戳校验——
//    校园平板上浏览器可能被切后台、系统时间也可能被改，硬校验时间戳只会误伤真用户。
router.post('/focus', requireAuth, function(req, res) {
  var uid = userId(req);
  var st = readPet(uid);
  if (!st || !st.adopted) return res.status(400).json({ code: 400, message: '还未领养宠物' });

  var minutes = Number(req.body && req.body.minutes);
  if (FOCUS_ALLOWED.indexOf(minutes) < 0) {
    return res.status(400).json({ code: 400, message: '不支持的专注时长' });
  }
  var capSec = minutes * 60;
  var elapsed = Number(req.body && req.body.elapsedSec);
  if (!isFinite(elapsed) || elapsed < 0) elapsed = 0;
  var usedSec = Math.min(Math.floor(elapsed), capSec);
  // 差 15 秒以内算完成：计时器在后台被节流时，最后一秒经常落不满
  var done = (req.body && req.body.done === true) && usedSec >= capSec - 15;

  var today = todayKey();
  if (st.focus_date !== today) {
    st.focus_date = today;
    st.focus_min = 0;
    st.focus_rounds = 0;
    st.focus_bond = 0;
  }

  var tierBefore = st.bond || 0;

  // 不到 1 分钟直接放弃：一分钱都不给。
  // 否则「开始 → 立刻结束」可以无限刷小鱼干，这个漏洞比收益本身更致命。
  if (usedSec < 60) {
    return res.json({ code: 200, data: {
      coinsGain: 0, bondGain: 0, capped: false, done: false, tooShort: true,
      focusMin: st.focus_min || 0, focusRounds: st.focus_rounds || 0,
      state: publicState(st)
    } });
  }

  var coinsGain = Math.floor(usedSec / (FOCUS_COIN_MINUTES * 60));
  if (done) coinsGain += FOCUS_DONE_BONUS;

  var bondGain = 0;
  var capped = false;
  if (done) {
    if ((st.focus_bond || 0) >= FOCUS_BOND_DAILY) {
      capped = true;   // 今天专注给的羁绊到顶了，但小鱼干照给
    } else {
      bondGain = Math.min(FOCUS_BOND, FOCUS_BOND_DAILY - (st.focus_bond || 0));
      st.focus_bond = (st.focus_bond || 0) + bondGain;
      st.bond = (st.bond || 0) + bondGain;
      st.focus_rounds = (st.focus_rounds || 0) + 1;
    }
  }

  var addMin = Math.round(usedSec / 60);
  st.coins = (st.coins || 0) + coinsGain;
  st.focus_min = (st.focus_min || 0) + addMin;
  if (addMin > 0) diaryPush(st, today, { k: 'focus', m: addMin });
  writePet(uid, st);

  res.json({ code: 200, data: {
    coinsGain: coinsGain,
    bondGain: bondGain,
    tierUp: tierOf(st.bond) > tierOf(tierBefore),
    capped: capped,
    done: done,
    tooShort: false,
    focusMin: st.focus_min || 0,
    focusRounds: st.focus_rounds || 0,
    state: publicState(st)
  } });
});

// 读状态
router.get('/state', requireAuth, function(req, res) {
  var row = db.prepare('SELECT value FROM user_kv_store WHERE user_id = ? AND key = ?').get(userId(req), KV_KEY);
  var state = null;
  if (row) {
    try { state = JSON.parse(row.value); } catch (e) { state = null; }
  }
  // v0.15.0：每日登录奖励 + 连续登录天数。
  // 第一次打开宠物屋的那天给一份小礼物， streak 让「连续来」有 visibly 的进步。
  var dailyBonus = null;
  if (state && state.adopted) {
    var lastLogin = state.last_login_date || '';
    if (lastLogin !== todayKey()) {
      // streak：昨天来过就 +1，否则重置为 1
      var yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
      if (lastLogin === yesterday) state.login_streak = (state.login_streak || 0) + 1;
      else state.login_streak = 1;
      state.last_login_date = todayKey();
      var streak = state.login_streak || 1;
      var coinReward = 3 + Math.min(7, streak - 1); // 3..10
      var bondReward = 2 + Math.min(3, Math.floor((streak - 1) / 3)); // 2..5
      state.coins = (state.coins || 0) + coinReward;
      state.bond = (state.bond || 0) + bondReward;
      state.bond_today = (state.bond_today || 0) + bondReward;
      dailyBonus = { granted: true, streak: streak, coins: coinReward, bond: bondReward,
        msg: '欢迎回来！连续登录 ' + streak + ' 天，送你 ' + coinReward + ' 条小鱼干 + ' + bondReward + ' 羁绊' };
      writePet(userId(req), state);
    } else {
      dailyBonus = { granted: false, streak: state.login_streak || 1 };
    }
  }
  // v0.16.0：离线时光（Offline Time）。
  // 桌宠在你不在的时候也有自己的生活：会睡觉、会逛、会捡小鱼干。
  // 回来时给你一份「 Recap」—— 这是 Planet Pet / Deskpet 的核心卖点，
  // 也是「玩久了没意思」的解药：你离线时它也在变。
  //
  // ⚠️ 幂等不需要单独的「上次发过 recap」字段：
  //   last_active_at 每次请求都刷新成 nowMs，所以下一次请求 gapMin 必为 0，
  //   不可能重复触发。真正能再次触发的唯一方式是用户真的又离线了 30 分钟以上。
  var offlineRecap = null;
  if (state && state.adopted) {
    var nowMs = Date.now();
    var lastActive = Number(state.last_active_at) || 0;
    var gapMin = lastActive > 0 ? Math.floor((nowMs - lastActive) / 60000) : 0;
    if (gapMin < 0) gapMin = 0;

    if (gapMin >= OFFLINE_MIN_GAP) {
      if (gapMin > OFFLINE_CAP_MIN) gapMin = OFFLINE_CAP_MIN;

      // 离线收益（ capped，防刷）：每小时 2 条小鱼干 + 每 2 小时 1 羁绊
      var coinGain = Math.min(OFFLINE_CAP_COINS, Math.floor(gapMin / 60) * OFFLINE_COIN_PER_HOUR);
      var bondGain = Math.min(OFFLINE_CAP_BOND, Math.floor(gapMin / 120) * OFFLINE_BOND_PER_HOUR);

      // 离线事件：按 gapMin 生成 1~5 条 recap
      var events = [];
      if (gapMin >= 30) events.push({ kind: 'wait', text: '它一直在桌上等你回来' });
      if (gapMin >= 60) events.push({ kind: 'sleep', text: '它睡了一觉，做了个好梦' });
      if (gapMin >= 120) events.push({ kind: 'walk', text: '它自己逛了一圈桌面' });
      if (gapMin >= 180 && coinGain > 0) events.push({ kind: 'find', text: '它捡到了 ' + coinGain + ' 条小鱼干' });
      if (gapMin >= 240 && (state.fed_today || 0) === 0) events.push({ kind: 'hungry', text: '它有点饿了，等你喂它' });

      if (coinGain > 0) state.coins = (state.coins || 0) + coinGain;
      if (bondGain > 0) {
        state.bond = (state.bond || 0) + bondGain;
        state.bond_today = (state.bond_today || 0) + bondGain;
      }
      if (coinGain > 0 || bondGain > 0) {
        diaryPush(state, todayKey(), { k: 'offline', n: coinGain, m: gapMin });
      }

      offlineRecap = {
        gapMin: gapMin,
        coinGain: coinGain,
        bondGain: bondGain,
        events: events,
        msg: '你离开 ' + gapMin + ' 分钟，它：' + events.map(function(e){ return e.text; }).join('；')
      };
      state.last_active_at = nowMs;
      writePet(userId(req), state);
    } else {
      // 没触发 recap 也照样刷新「我回来了」的时间，否则一直挂着不动 gapMin 永远涨不起来
      state.last_active_at = nowMs;
      writePet(userId(req), state);
    }
  }
  res.json({ code: 200, data: {
    state: publicState(state),
    palette: PALETTE.p16,
    templates: TEMPLATES,
    elements: elementList(),
    wild: WILD,
    buddy: buddyPublic(state),
    evolution: evolutionOf(state),
    assistant: (state && state.adopted) ? assistantView(state) : null,
    shop: (state && state.adopted) ? shopView(state) : null,
    weather: weatherOf(todayKey()),
    personality: (state && state.adopted) ? personalityOf(state, userId(req)) : null,
    mood: (state && state.adopted) ? moodOf(state) : null,
    quests: (state && state.adopted) ? questsView(userId(req), state) : null,
    diary: (state && state.adopted) ? diaryView(state, todayKey()) : null,
    focus: (state && state.adopted) ? {
      todayMin: state.focus_min || 0,
      rounds: state.focus_rounds || 0,
      bondToday: state.focus_bond || 0,
      bondCap: FOCUS_BOND_DAILY,
      coins: state.coins || 0,
      feastCost: FEAST_COST
    } : null,
    dailyBonus: dailyBonus,
    offlineRecap: offlineRecap,
    wonder: wonderView(userId(req), state, todayKey()),
    autonomy: (state && state.adopted) ? autonomyView(state, userId(req)) : null
  } });
});

// 校验 design 数据（宽高 ≤ 32、字符集、长度匹配）
function validDesign(d) {
  if (!d || typeof d !== 'object') return 'design 非对象';
  // 视频形态（大肥鱼）：{ type: 'video', character: 'dsh-whale' }
  if (d.type === 'video') {
    return (d.character && typeof d.character === 'string') ? null : 'video 形象缺 character';
  }
  var w = Number(d.w), h = Number(d.h);
  if (!Number.isInteger(w) || !Number.isInteger(h) || w < 8 || h < 8 || w > MAX_DIM || h > MAX_DIM) {
    return '尺寸非法（8-' + MAX_DIM + '）';
  }
  if (d.pal !== 'p16') return '未知调色板';
  if (typeof d.data !== 'string' || d.data.length !== w * h) return 'data 长度与尺寸不符';
  if (!/^[0-9a-f.]*$/.test(d.data)) return 'data 含非法字符';
  return null;
}

// 写状态（部分合并：只接受白名单字段）
router.put('/state', requireAuth, function(req, res) {
  var uid = userId(req);
  var body = req.body || {};
  var row = db.prepare('SELECT value FROM user_kv_store WHERE user_id = ? AND key = ?').get(uid, KV_KEY);
  var state = {};
  if (row) {
    try { state = JSON.parse(row.value) || {}; } catch (e) { state = {}; }
  }
  if (body.adopt === true) {
    if (!state.adopted) {
      state.adopted = true;
      state.adopted_at = new Date().toISOString();
      // 默认形象：dsh-pet 大肥鱼（视频形态，CC BY-NC-SA，见 assets/THIRD-PARTY-LICENSE.md）
      if (!state.design) state.design = { type: 'video', character: 'dsh-whale' };
    }
  }
  if (body.name !== undefined) {
    var name = String(body.name || '').trim().slice(0, 12);
    if (!name) return res.status(400).json({ code: 400, message: '名字不能为空' });
    state.name = name;
  }
  if (body.design !== undefined) {
    var err = validDesign(body.design);
    if (err) return res.status(400).json({ code: 400, message: err });
    state.design = body.design;
  }
  if (body.enabled !== undefined) state.enabled = body.enabled === true;
  // v0.16.0：离线时光的两个内部时间字段。它们由 /state 现算并回写，
  // 但探针/测试需要直接拨回过去模拟「离线了一段时间」，所以放进白名单。
  // 真实用户不会 PUT 这两个字段，就算传了也只是被覆盖成新值，没有副作用。
  if (body.last_active_at !== undefined) state.last_active_at = Number(body.last_active_at) || 0;
  if (body.autonomy_at !== undefined) state.autonomy_at = Number(body.autonomy_at) || 0;
  state.updated_at = new Date().toISOString();
  db.prepare('INSERT INTO user_kv_store (user_id, key, value) VALUES (?, ?, ?) ' +
    'ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value')
    .run(uid, KV_KEY, JSON.stringify(state));
  res.json({ code: 200, data: { state: state } });
});
// ==================== 对战（v0.4.0：骨架 + 练习赛）====================
// 设计取舍：
//   - 战斗完全由服务端算，返回「逐回合战报 steps」，前端只负责播放。
//     以后接真人对手（异步影子 / 实时房间）时，只需要换对手来源，结算与反作弊一行都不用改。
//   - 随机数由 seed 驱动（seed = 用户 + 对手 + 第几场 + 日期）：同一场重放结果一致，
//     排查「为什么这局输了」可以直接复算，不会出现「再打一次数值全变」。
//   - 对战不碰羁绊（不加也不扣）。羁绊是「陪伴」的货币，被对战刷分就变味了；
//     对战只涨独立的战力积分 points。
// 对战不设每日次数上限（0 = 不限）。想打多少局就打多少局。
// ⚠️ 但「不限次数」会带来一个副作用：积分没有产出上限，榜单就会变成
//    「谁花的时间多」而不是「谁更会配技能」。所以积分改成分段衰减（见 pointsFor），
//    前几场全额、之后递减——次数完全自由，但刷不出无限分。
var BATTLE_DAILY_CAP = 0;
var BATTLE_MAX_ROUNDS = 24;
// 积分衰减：每天前 5 场全额，之后每场按比例降到保底。
// 这只是「收益曲线」，不是「次数限制」——你随时可以继续打，只是分数涨得慢。
var POINTS_FULL_GAMES = 5;
var POINTS_DECAY = 0.82;
function pointsFor(base, gamesToday) {
  if (gamesToday < POINTS_FULL_GAMES) return base;
  var over = gamesToday - POINTS_FULL_GAMES + 1;
  var mul = Math.pow(POINTS_DECAY, over);
  var v = Math.round(base * mul);
  return Math.max(base >= 10 ? 4 : 2, v);   // 保底，别让第 30 场只给 0 分
}

// ==================== 战术（v0.6.0）====================
// 打到现在为止，「对战」一直被一件事卡住：玩家只能点「挑战」，然后看一段动画。
// 没有决策 = 没有玩法。加战术就是把这个洞补上：
// 赛前在三种风格里选一个，它会真正改写属性，再进结算。
//
// ⚠️ 战术**不进 seed**。同一场、同一个 random 流，只换属性——
//    这样「换个战术会不会赢」才是可比较的，而不是连运气一起换掉。
// ⚠️ 数值是按伤害公式反推的，不能拍脑袋给 ±30%：
//    伤害 = atk - floor(def*0.6)，def 的系数只有 0.6，所以同样幅度的
//    「atk +30%」和「def +30%」完全不等价——前者实测把 spar 胜率推到 99%。
//
// 另一个坑：24 回合上限、打满比「剩余血量百分比」的规则下，
// 纯磨血的稳守是结构性亏的——它把每回合伤害压低，等于同时压低了
// 双方的血量下降速度，最后比百分比时并不占优。所以稳守不能只加防御，
// 必须额外补血（hp 倍数），把「拖」真正变成一条路。
// 三招的收益必须跟自身属性同量级，否则总有一招在某一档羁绊下通吃：
//   - 低羁绊（bond 20）时 def 只有 3，「+3 防御」等于翻倍 → 稳守通吃
//   - 高羁绊（bond 160）时 atk 26，固定 +3 显得无关紧要 → 灵巧的暴击通吃
// 所以改成按属性比例给，但比例要按「伤害公式里的实际系数」配平
// （def 在公式里权重 0.6，atk 权重 1，所以 def 的倍数要开得更大）。
var TACTICS = {
  assault: {
    id: 'assault', name: '猛攻', icon: '⚔️',
    desc: '攻击 x1.15，防御只留 0.75——速战速决，拖久了会崩',
    atk: 1.15, def: 0.75
  },
  guard: {
    id: 'guard', name: '稳守', icon: '🛡️',
    desc: '防御 x1.45、血量 x1.05，攻击降到 0.90——熬到对面先倒',
    atk: 0.90, def: 1.45, hpMul: 1.05
  },
  nimble: {
    id: 'nimble', name: '灵巧', icon: '🌀',
    desc: '速度 +5、暴击 +8 个点，但防御只剩 0.85——抢节奏的赌法',
    atk: 1.0, def: 0.85, crit: 8, spd: 5
  }
};
var TACTIC_IDS = ['assault', 'guard', 'nimble'];
function tacticOf(id) {
  return TACTICS[id] ? TACTICS[id] : TACTICS.guard;   // 没传或传错 → 稳守（最不容易被误伤的一档）
}
function tacticList() {
  var out = [];
  for (var i = 0; i < TACTIC_IDS.length; i++) {
    var t = TACTICS[TACTIC_IDS[i]];
    out.push({ id: t.id, name: t.name, icon: t.icon, desc: t.desc });
  }
  return out;
}
// 把战术作用到战力上，返回新对象（不改原 combat）
//
// ⚠️ 稳守的比例不能是固定值：低羁绊时 def 只有 2，x1.9 几乎不花成本，
//    而 hp x1.12 在小血量上却很明显，结果新手期「稳守」全线最优（实测 100%/93%/92%）。
//    这里改成「加固定值」而不是乘比例，让三招的收益都跟自身属性同量级。
function applyTactic(c, tacticId) {
  var t = tacticOf(tacticId);
  return {
    bond: c.bond, tier: c.tier, tierName: c.tierName,
    hp: Math.max(1, Math.round(c.hp * (t.hpMul || 1) + (t.hp || 0))),
    atk: Math.max(1, Math.round(c.atk * t.atk + (t.atkAdd || 0))),
    def: Math.max(0, Math.round(c.def * t.def + (t.defAdd || 0))),
    spd: c.spd + (t.spd || 0),
    crit: Math.min(90, c.crit + (t.crit || 0)),
    // v2.0：Build 的暴击伤害/治疗倍率要一路带到引擎，不能在战术层断掉
    critMul: c.critMul || 1, healMul: c.healMul || 1
  };
}

// ==================== 技能系统 v2.0（Roguelike Build）====================
// 战术改的是「属性怎么分配」，技能改的是「战斗里发生什么」。
// 两者叠加才算 build：同样的属性，带「千钧一击」和带「鲸吞」是两种宠物。
//
// v2.0 落地说明（与 docs/battle-build-system.md 的差异都写在这里）：
//   - 技能池 5 → 18（BASE + ACTIVE + PASSIVE 三张表，下方合并进 SKILLS/SKILL_IDS）
//   - 「技能池洗牌」实现为确定性展示顺序重排（seed = uid + 进化阶段），不随机剥夺
//     已解锁技能的访问权——剥夺会让「我攒了很久就想带这个」落空，和
//     「羁绊是确定性成长」的基调冲突。
//   - 技能槽位 2/3/4/5（幼生体/成长期/完全体/传说体），用户已确认的平滑阶梯
//   - 装备 3 槽位（武器/饰品/消耗品），消耗品按库存次数消耗，掉落补给
//   - 分享码格式 SSSSSEE-K（7 位载荷 + 1 位校验，共 9 字符）：5 技能槽需要 5 字符，
//     装备混合进制压进 2 字符；doc 的 SSSS-WWWW(8) 是示意格式
//
// ⚠️ 技能互斥规则（同一套 Build 不能同时带，引擎结算时无条件保留靠前者）：
//    heavy vs blast（都是爆发类）、lifesteal vs shield（都是续航）、berserk vs guard_stance（增益互斥）

// ---------- 基础技能（保留原有平衡数据，数值冻结）----------
var BASE_SKILLS = {
  heavy:     { id: 'heavy',     name: '千钧一击', icon: '💥', tier: 0, type: 'passive',
              desc: '每 3 回合打出 1.6 倍伤害' },
  lifesteal: { id: 'lifesteal', name: '鲸吞',       icon: '💫', tier: 0, type: 'passive',
              desc: '造成伤害的 12% 回血' },
  shield:    { id: 'shield',    name: '泡泡护盾',   icon: '🔵', tier: 1, type: 'passive',
              desc: '血量快见底时挡下一半伤害（一次）' },
  combo:     { id: 'combo',     name: '连打',       icon: '⚡', tier: 1, type: 'passive',
              desc: '25% 概率追加半次攻击' },
  pierce:    { id: 'pierce',    name: '破甲',       icon: '🔨', tier: 1, type: 'passive',
              desc: '无视对手 30% 防御，至少多打 1 点' }
};

// ---------- v2.0 新增主动技能----------
var ACTIVE_SKILLS = {
  blast: {
    id: 'blast',
    name: '爆发冲击',
    icon: '💢',
    tier: 1,
    type: 'active',
    cooldown: 2,
    desc: '单回合造成 200% 伤害，下回合无法行动',
    effect: { damage_mult: 2.0, skip_next_turn: true }
  },
  berserk: {
    id: 'berserk',
    name: '狂怒',
    icon: '🔥',
    tier: 1,
    type: 'buff',
    duration: 3,
    desc: '攻击 +50%，防御 -30%，持续 3 回合',
    effect: { atk_mul: 1.5, def_mul: 0.7, turns: 3 }
  },
  guard_stance: {
    id: 'guard_stance',
    name: '钢铁壁垒',
    icon: '🛡️',
    tier: 2,
    type: 'buff',
    duration: 3,
    desc: '防御 +40%，速度 -20%，持续 3 回合',
    effect: { def_mul: 1.4, spd_sub: 0.2, turns: 3 }
  },
  heal: {
    id: 'heal',
    name: '紧急治疗',
    icon: '💚',
    tier: 0,
    type: 'heal',
    cooldown: 4,
    desc: '立即恢复 30% 最大 HP',
    effect: { hp_percent: 0.3 }
  },
  smash: {
    id: 'smash',
    name: '重锤砸击',
    icon: '🔨',
    tier: 2,
    type: 'active',
    cooldown: 3,
    desc: '本回合伤害翻倍，但自身掉 15% 血',
    effect: { damage_mult: 2.0, self_damage: 0.15 }
  }
};

// ---------- v2.0 新增被动技能----------
var PASSIVE_SKILLS = {
  counter: {
    id: 'counter',
    name: '反击领域',
    icon: '⚔️',
    tier: 2,
    type: 'passive',
    desc: '受到攻击时有 40% 概率自动反击',
    effect: { counter_chance: 0.4 }
  },
  aura: {
    id: 'aura',
    name: '斗志光环',
    icon: '✨',
    tier: 1,
    type: 'passive',
    desc: '每场战斗首回合攻击力 +25%',
    effect: { first_turn_atk_mul: 1.25 }
  },
  evade: {
    id: 'evade',
    name: '闪避精通',
    icon: '🌀',
    tier: 2,
    type: 'passive',
    desc: '闪避率 +15%，连续触发时提升至 25%',
    effect: { evasion_base: 0.15, consecutive_evasion: 0.25 }
  },
  toughness: {
    id: 'toughness',
    name: '坚韧',
    icon: '💪',
    tier: 0,
    type: 'stat',
    stat: 'hp',
    bonus: '+15%',
    desc: '最大 HP +15%',
    effect: { hp_bonus: 0.15 }
  },
  strength: {
    id: 'strength',
    name: '力量',
    icon: '🏋️',
    tier: 0,
    type: 'stat',
    stat: 'atk',
    bonus: '+12%',
    desc: '攻击力 +12%',
    effect: { atk_bonus: 0.12 }
  },
  finesse: {
    id: 'finesse',
    name: '敏捷',
    icon: '🦶',
    tier: 1,
    type: 'stat',
    stat: 'spd',
    bonus: '+10%',
    desc: '速度 +10%',
    effect: { spd_bonus: 0.1 }
  },
  sharp: {
    id: 'sharp',
    name: '精准',
    icon: '🎯',
    tier: 2,
    type: 'stat',
    stat: 'crit_dmg',
    bonus: '+20%',
    desc: '暴击伤害 +20%',
    effect: { crit_dmg_bonus: 0.2 }
  },
  regen: {
    id: 'regen',
    name: '活力',
    icon: '🍀',
    tier: 1,
    type: 'passive',
    desc: '每回合结束恢复 2% 最大 HP',
    effect: { regen_percent: 0.02 }
  }
};

// ---------- 合并注册表 ----------
// SKILLS 是技能唯一查询入口；SKILL_IDS 的顺序 = 分享码编码顺序。
// ⚠️ SKILL_IDS 一旦有真实分享码在外流转就冻结——中间插新技能会让已发出的码整体错位，
//    新技能只能 push 到尾部。
var SKILLS = {};
var SKILL_IDS = [];
(function() {
  var groups = [BASE_SKILLS, ACTIVE_SKILLS, PASSIVE_SKILLS];
  for (var g = 0; g < groups.length; g++) {
    var ids = Object.keys(groups[g]);
    for (var i = 0; i < ids.length; i++) {
      SKILLS[ids[i]] = groups[g][ids[i]];
      SKILL_IDS.push(ids[i]);
    }
  }
})();

// 技能档位元数据（doc §8 的 tier 分级；cost/slot_weight 的「构建点数」经济暂不实现，
// 解锁门槛直接用 tier ≤ tierOf(bond)，与羁绊档位 0/20/60/120 自然对齐）
var SKILL_TIER_META = [
  { tier: 0, name: '普通', rarity: 'common',   unlockBond: 0 },
  { tier: 1, name: '优良', rarity: 'uncommon', unlockBond: 20 },
  { tier: 2, name: '稀有', rarity: 'rare',     unlockBond: 60 },
  { tier: 3, name: '史诗', rarity: 'epic',     unlockBond: 120 }
];
function skillTierMeta(tier) {
  return SKILL_TIER_META[tier] || SKILL_TIER_META[0];
}

// ========== 装备系统 v2.0 ==========
// 3 个槽位：武器/饰品/消耗品
// 提供被动效果 + Buff/Debuff

// ---------- 武器类 ----------
var WEAPONS = {
  blunt_sword: {
    id: 'blunt_sword',
    name: '钝剑',
    icon: '⚔️',
    type: 'weapon',
    effect: '攻击后回复 5% 最大 HP',
    effect_fn: function(atk, def, victim) { 
      return { heal: Math.round(victim.max_hp * 0.05) }; 
    },
    rarity: 'common'
  },
  electric_lance: {
    id: 'electric_lance',
    name: '电矛',
    icon: '🔱',
    type: 'weapon',
    effect: '有 30% 概率使目标麻痹（下回合速度 -50%)',
    effect_fn: function() { 
      return { stun_chance: 0.3, spd_reduction: 0.5, duration: 1 }; 
    },
    rarity: 'uncommon'
  },
  void_blade: {
    id: 'void_blade',
    name: '虚空之刃',
    icon: '🗡️',
    type: 'weapon',
    effect: '无视对手 20% 防御',
    effect_fn: function() {
      return { ignore_def_percent: 0.2 };
    },
    rarity: 'rare'
  },
  // doc 只列了 3 件武器，但掉落四档里 epic 档不能为空（roll 到了没东西发）。
  // 每一档至少一件，30+ 件的完整库留给后续版本。
  star_hammer: {
    id: 'star_hammer',
    name: '星陨锤',
    icon: '☄️',
    type: 'weapon',
    effect: '暴击伤害 +25%',
    effect_fn: function() {
      return { crit_dmg_mul: 1.25 };
    },
    rarity: 'epic'
  }
};

// ---------- 饰品类 ----------
var ACCESSORIES = {
  crystal_amulet: {
    id: 'crystal_amulet',
    name: '水晶护符',
    icon: '💎',
    type: 'accessory',
    effect: '防御 +15%',
    effect_fn: function() { 
      return { def_mul: 1.15 }; 
    },
    rarity: 'common'
  },
  lightning_stone: {
    id: 'lightning_stone',
    name: '闪电石',
    icon: '⚡',
    type: 'accessory',
    effect: '速度 +20%，暴击率 +10%',
    effect_fn: function() { 
      return { spd_mul: 1.2, crit_bonus: 10 }; 
    },
    rarity: 'rare'
  },
  life_orb: {
    id: 'life_orb',
    name: '生命宝珠',
    icon: '🔮',
    type: 'accessory',
    effect: '所有治疗效果 +25%',
    effect_fn: function() {
      return { healing_bonus: 0.25 };
    },
    rarity: 'epic'
  },
  wind_charm: {
    id: 'wind_charm',
    name: '风之铃',
    icon: '🎐',
    type: 'accessory',
    effect: '闪避率 +5%',
    effect_fn: function() {
      return { evasion_add: 0.05 };
    },
    rarity: 'uncommon'
  },
  phantom_cloak: {
    id: 'phantom_cloak',
    name: '幻影斗篷',
    icon: '🌫️',
    type: 'accessory',
    effect: '闪避率 +8%',
    effect_fn: function() {
      return { evasion_add: 0.08 };
    },
    rarity: 'epic'
  }
};

// ---------- 消耗品类 ----------
var CONSUMABLES = {
  flame_potion: {
    id: 'flame_potion',
    name: '火焰药水',
    icon: '🧪',
    type: 'consumable',
    effect: '首回合伤害翻倍（仅使用一次）',
    effect_fn: function() { 
      return { first_turn_damage_mult: 2.0, single_use: true }; 
    },
    stack: 3,
    rarity: 'uncommon'
  },
  restore_vial: {
    id: 'restore_vial',
    name: '恢复药剂',
    icon: '💊',
    type: 'consumable',
    effect: '战斗开始时立即恢复 40% HP',
    effect_fn: function() { 
      return { initial_heal_percent: 0.4 }; 
    },
    stack: 2,
    rarity: 'common'
  },
  strength_tonic: {
    id: 'strength_tonic',
    name: '力量合剂',
    icon: '💉',
    type: 'consumable',
    effect: '攻击力 +50%，持续整场战斗',
    effect_fn: function() {
      return { atk_mul: 1.5, full_battle_duration: true };
    },
    stack: 1,
    rarity: 'rare'
  },
  swift_draught: {
    id: 'swift_draught',
    name: '迅捷药剂',
    icon: '💨',
    type: 'consumable',
    effect: '速度 +15%，持续整场战斗',
    effect_fn: function() {
      return { spd_mul: 1.15, full_battle_duration: true };
    },
    stack: 2,
    rarity: 'uncommon'
  },
  healing_herb: {
    id: 'healing_herb',
    name: '治愈草',
    icon: '🌿',
    type: 'consumable',
    effect: '每回合结束恢复 3% 最大 HP',
    effect_fn: function() {
      return { regen_percent: 0.03 };
    },
    stack: 3,
    rarity: 'common'
  }
};

// 合并所有装备
var EQUIP_ITEMS = Object.assign({}, WEAPONS, ACCESSORIES, CONSUMABLES);
var WEAPON_IDS = Object.keys(WEAPONS);
var ACCESSORY_IDS = Object.keys(ACCESSORIES);
var CONSUMABLE_IDS = Object.keys(CONSUMABLES);

// 装备槽位定义
var EQUIP_SLOTS = ['weapon', 'accessory', 'consumable'];

// ---------- Build 配置系统 ----------
// 数据结构：
//   state.battle_build = { skills: [...镜像], equipment: { weapon, accessory, consumable }, strategy_name }
//   state.equip_inventory = { owned: [...装备 ID], charges: { 消耗品 ID: 剩余次数 } }
// ⚠️ 技能的唯一真源是 state.battle_skills（equippedSkills 读它），
//    battle_build.skills 只是镜像——两份真源必然漂移，所以读永远走 equippedSkills。
//    镜像只在 /battle/skills 与 /battle/build/update 两个写入点同步，供分享码编码用。

// 装备库存。首次读取时发新手包（钝剑 + 水晶护符 + 火焰药水×1），
// 否则 Build 编辑器一进来就是空的，玩家不知道这系统是干嘛的。
// _kit2 标记保证只发一次；即使标记还没来得及落盘，重复发放也是幂等的（owned 去重）。
var STARTER_KIT = ['blunt_sword', 'crystal_amulet'];
function inventoryOf(st) {
  if (!st.equip_inventory || typeof st.equip_inventory !== 'object') {
    st.equip_inventory = { owned: [], charges: {} };
  }
  var inv = st.equip_inventory;
  if (!Object.prototype.toString.call(inv.owned).match(/^\[object Array\]$/)) inv.owned = [];
  if (!inv.charges || typeof inv.charges !== 'object') inv.charges = {};
  if (!st._kit2) {
    for (var i = 0; i < STARTER_KIT.length; i++) {
      if (inv.owned.indexOf(STARTER_KIT[i]) < 0) inv.owned.push(STARTER_KIT[i]);
    }
    if (!inv.charges.flame_potion || inv.charges.flame_potion < 1) inv.charges.flame_potion = 1;
    st._kit2 = true;
  }
  return inv;
}

// 获取当前 Build（含旧存档迁移，doc §9）
// 旧战术 → 默认推荐 Build；技能永远以 battle_skills 为准。
function buildOf(st) {
  if (!st) return { skills: [], equipment: {}, strategy_name: '' };
  var b = st.battle_build;
  if (!b || typeof b !== 'object') {
    b = { skills: [], equipment: {}, strategy_name: '' };
    if (st.battle_tactic === 'assault') {
      b.strategy_name = '猛攻';
    } else if (st.battle_tactic === 'guard') {
      b.strategy_name = '稳守';
    } else if (st.battle_tactic === 'nimble') {
      b.strategy_name = '灵巧';
    }
    st.battle_build = b;
  }
  if (!b.equipment || typeof b.equipment !== 'object') b.equipment = {};
  if (Object.prototype.toString.call(b.skills) !== '[object Array]') b.skills = [];
  return b;
}

// ---------- 战斗包：把「属性 + 技能 + 装备」合成一份开打用的数据 ----------
// 返回 { combat, kit, skills }：
//   combat 战斗数值（含 stat 技能/饰品/静态消耗品），critMul/healMul 一并带上供引擎用
//   kit    引擎内才生效的动态效果（武器、药水、闪避加成）
// consume=true 时真的扣掉 1 个消耗品库存（只有真人上场才扣；影子是快照，白嫖不扣——
// 影子本来就「不需要参与」，扣他的库存等于替他做了决定）。
// 互斥解析（v0.28.3）：与 skillEffects 里 1642 行的规则表**严格同源**——
//    千钧(heavy) 吞 爆发冲击(blast)、鲸吞(lifesteal) 吞 护盾(shield)、狂怒(berserk) 吞 壁垒(guard_stance)。
//    之前只有引擎在结算时静默吞掉输家：Build 编辑器提示「先选的生效」（错误承诺），
//    战斗牌面把输家也画成卡，按了落普攻零反馈——玩家以为装备好了，实战永远不触发。
//    现在装备表先解析，牌面只画真正会生效的技能。
//    ⚠️ 改互斥规则必须同步三处：skillEffects（引擎）、这里（牌面）、entry.js BUILD_HINTS（文案）。
var SKILL_CONFLICTS = [
  { winner: 'heavy',     loser: 'blast',        label: '爆发类互斥，千钧一击生效' },
  { winner: 'lifesteal', loser: 'shield',       label: '续航类互斥，鲸吞生效' },
  { winner: 'berserk',   loser: 'guard_stance', label: '增益类互斥，狂怒生效' }
];
function resolveSkillConflicts(ids) {
  var out = (ids || []).slice();
  for (var i = 0; i < SKILL_CONFLICTS.length; i++) {
    var c = SKILL_CONFLICTS[i];
    var w = out.indexOf(c.winner);
    var l = out.indexOf(c.loser);
    if (w >= 0 && l >= 0) out.splice(l, 1);
  }
  return out;
}

function battleKitOf(st, env, consume) {
  var build = buildOf(st);
  var skillIds = resolveSkillConflicts(equippedSkills(st));
  var inv = inventoryOf(st);
  var eq = build.equipment || {};
  var kit = {
    weapon: null, flame: false, vial: false, herb: false, tonic: false, swift: false,
    evadeAdd: 0, critMul: 1, healMul: 1
  };

  var w = eq.weapon ? WEAPONS[eq.weapon] : null;
  if (w && inv.owned.indexOf(w.id) >= 0) {
    kit.weapon = w.id;
    if (w.id === 'star_hammer') kit.critMul *= 1.25;      // 暴击伤害是静态倍率
  }
  var acc = eq.accessory ? ACCESSORIES[eq.accessory] : null;
  if (acc && inv.owned.indexOf(acc.id) >= 0) {
    if (acc.id === 'wind_charm') kit.evadeAdd += 0.05;
    else if (acc.id === 'phantom_cloak') kit.evadeAdd += 0.08;
    else if (acc.id === 'life_orb') kit.healMul *= 1.25;
  }
  var cons = eq.consumable ? CONSUMABLES[eq.consumable] : null;
  // 消耗品的「拥有」看的是库存次数（用掉即无，不进 owned 列表）
  if (cons && (inv.charges[cons.id] || 0) > 0) {
    if (consume) inv.charges[cons.id] -= 1;
    if (cons.id === 'flame_potion') kit.flame = true;
    else if (cons.id === 'restore_vial') kit.vial = true;
    else if (cons.id === 'healing_herb') kit.herb = true;
    else if (cons.id === 'strength_tonic') kit.tonic = true;
    else if (cons.id === 'swift_draught') kit.swift = true;
  }

  var c = combatOf(st);
  var out = {
    bond: c.bond, tier: c.tier, tierName: c.tierName,
    hp: c.hp, atk: c.atk, def: c.def, spd: c.spd, crit: c.crit,
    critMul: kit.critMul, healMul: kit.healMul
  };
  for (var i = 0; i < skillIds.length; i++) {
    var s = SKILLS[skillIds[i]];
    if (!s) continue;
    if (s.id === 'toughness') out.hp = Math.round(out.hp * 1.15);
    else if (s.id === 'strength') out.atk = Math.round(out.atk * 1.12);
    else if (s.id === 'finesse') out.spd = Math.round(out.spd * (env && env.id === 'wind_valley' ? 1.15 : 1.10));
    else if (s.id === 'sharp') out.critMul *= 1.2;
  }
  if (acc && acc.id === 'crystal_amulet') out.def = Math.round(out.def * 1.15);
  if (acc && acc.id === 'lightning_stone') {
    out.spd = Math.round(out.spd * 1.2);
    out.crit = Math.min(90, out.crit + 10);
  }
  if (kit.tonic) out.atk = Math.round(out.atk * 1.5);
  if (kit.swift) out.spd = Math.round(out.spd * 1.15);
  // 助战（v0.25.0）：已收服的野怪按系别给一个永久小加成。
  // ⚠️ 只对「还在图鉴里」的生效——万一以后有移除机制，这里不会白给数值。
  var assist = st.assistant ? wildById(st.assistant) : null;
  if (assist && ownedMap(st)[assist.id]) {
    if (assist.type === 'fire') out.atk = Math.round(out.atk * 1.05);
    else if (assist.type === 'electric') out.crit = Math.min(90, out.crit + 5);
    else if (assist.type === 'earth') out.def = Math.round(out.def * 1.10);
    else if (assist.type === 'water') kit.assistRegen = 0.015;
    else if (assist.type === 'grass') kit.assistShield = true;
  }
  // 环境的暴击/治疗加成挂在 critMul/healMul 上，引擎直接乘
  if (env && env.critMul) out.critMul *= env.critMul;
  if (env && env.healMul) out.healMul *= env.healMul;
  return { combat: out, kit: kit, skills: skillIds };
}

// Build 评分：装备+技能全部生效后的实际战力。
// doc 里的 calcBuildPower（技能数×50 之类的计分）被替换成真实战力——
// 玩家看到的分数必须和打出来的强度是同一个数，否则「分数涨了却打不过」没法解释。
function buildScoreOf(st) {
  var k = battleKitOf(st, null, false);
  return powerOf(k.combat);
}

// 对当前环境的适配度：按环境的「吃香技能/装备/属性」数一数命中几条。
// 星级 = 1 + 命中数（封顶 5）。保底 1 星：不带任何适配也不该显示 0 星挨骂。
function buildFitnessOf(st, env) {
  if (!env || !env.fit) return { score: 0, stars: 1, max: 5 };
  var k = battleKitOf(st, null, false);
  var score = 0;
  var i;
  for (i = 0; i < k.skills.length; i++) {
    if (env.fit.skills[k.skills[i]]) score++;
  }
  var eq = buildOf(st).equipment || {};
  if (eq.weapon && env.fit.equip[eq.weapon]) score++;
  if (eq.accessory && env.fit.equip[eq.accessory]) score++;
  var t = normType(st && st.battle_type);
  if (env.fit.types[t]) score++;
  return { score: score, stars: Math.min(5, 1 + score), max: 5 };
}

// ---------- Build 分享码 ----------
// 格式：SSSSSEE-K（9 字符，含 1 个连字符）
//   SSSSS：5 个技能槽，每槽 1 个 base36 字符（'0' = 空，1..N = SKILL_IDS 索引+1）
//   EE：   3 个装备槽混合进制压成 2 字符（武器 5 选 1 × 饰品 6 选 1 × 消耗品 6 选 1 = 180 < 36²）
//   K：    校验位 = fnv1a(SECRET | 周桶 | 载荷) % 36
// 有效期：校验位接受当前周或上一周 → 约 7-14 天，跟着环境周轮换自然过期。
// ⚠️ 校验只防「手滑/过期/瞎编」，不防「故意构造」——真正的防线在导入时的
//    解锁/拥有校验：码里编了没解锁的技能，导入也会被剔掉。
var BUILD_SECRET = process.env.CI_JWT_SECRET || 'ci-pet-build-v2';
var B36 = '0123456789abcdefghijklmnopqrstuvwxyz';
function buildChecksum(payload, week) {
  return B36[fnv1a(BUILD_SECRET + '|' + week + '|' + payload) % 36];
}
function encodeBuildCode(build) {
  var skills = (build && build.skills) || [];
  var eq = (build && build.equipment) || {};
  var s = '';
  for (var i = 0; i < 5; i++) {
    var idx = skills[i] ? SKILL_IDS.indexOf(skills[i]) : -1;
    s += idx >= 0 ? B36[idx + 1] : '0';
  }
  var lists = [WEAPON_IDS, ACCESSORY_IDS, CONSUMABLE_IDS];
  var wi = eq.weapon ? lists[0].indexOf(eq.weapon) : -1;
  var ai = eq.accessory ? lists[1].indexOf(eq.accessory) : -1;
  var ci = eq.consumable ? lists[2].indexOf(eq.consumable) : -1;
  var n = (wi >= 0 ? wi + 1 : 0) * 36 + (ai >= 0 ? ai + 1 : 0) * 6 + (ci >= 0 ? ci + 1 : 0);
  var e = B36[Math.floor(n / 36)] + B36[n % 36];
  var payload = s + e;
  return payload + '-' + buildChecksum(payload, envWeekIndex());
}
function decodeBuildCode(code) {
  try {
    var raw = String(code || '').trim().toLowerCase().replace(/\s+/g, '');
    var parts = raw.split('-');
    if (parts.length !== 2 || parts[0].length !== 7 || !/^[0-9a-z]{7}$/.test(parts[0]) ||
        !/^[0-9a-z]$/.test(parts[1])) return null;
    var payload = parts[0];
    var week = envWeekIndex();
    if (buildChecksum(payload, week) !== parts[1] && buildChecksum(payload, week - 1) !== parts[1]) {
      return null;
    }
    var skills = [];
    for (var i = 0; i < 5; i++) {
      var v = B36.indexOf(payload[i]);
      if (v > 0 && SKILL_IDS[v - 1]) skills.push(SKILL_IDS[v - 1]);
      else skills.push(null);
    }
    var n = B36.indexOf(payload[5]) * 36 + B36.indexOf(payload[6]);
    if (n < 0 || n > 179) return null;
    var lists = [WEAPON_IDS, ACCESSORY_IDS, CONSUMABLE_IDS];
    var wi = Math.floor(n / 36), rest = n % 36;
    var ai = Math.floor(rest / 6), ci = rest % 6;
    var equipment = {
      weapon: wi > 0 ? lists[0][wi - 1] : null,
      accessory: ai > 0 ? lists[1][ai - 1] : null,
      consumable: ci > 0 ? lists[2][ci - 1] : null
    };
    return { skills: skills, equipment: equipment };
  } catch (e2) {
    return null;
  }
}

// 已解锁的技能（按羁绊档位）。
// 「技能池洗牌」：顺序按 fnv1a('pool|' + bond + '|' + id) 排——bond 一涨顺序就变，
// 正好实现「每次升级重新洗牌」；但它只是展示顺序，不剥夺任何已解锁技能的访问权。
function skillsOf(st) {
  var t = tierOf((st && st.bond) || 0);
  var bond = (st && st.bond) || 0;
  var out = [];
  for (var i = 0; i < SKILL_IDS.length; i++) {
    var s = SKILLS[SKILL_IDS[i]];
    if (s.tier <= t) {
      var meta = skillTierMeta(s.tier);
      out.push({ id: s.id, name: s.name, icon: s.icon, tier: s.tier, type: s.type || 'passive',
                 rarity: meta.rarity, tierName: meta.name, desc: s.desc,
                 _sort: fnv1a('pool|' + bond + '|' + s.id) });
    }
  }
  out.sort(function(a, b) { return a._sort - b._sort; });
  for (var j = 0; j < out.length; j++) delete out[j]._sort;
  return out;
}

// 全技能目录（含未解锁的，供 Build 编辑器画锁定态）。unlocked 是已解锁 ID 集合。
function skillCatalogOf(st) {
  var t = tierOf((st && st.bond) || 0);
  var out = [];
  for (var i = 0; i < SKILL_IDS.length; i++) {
    var s = SKILLS[SKILL_IDS[i]];
    var meta = skillTierMeta(s.tier);
    out.push({ id: s.id, name: s.name, icon: s.icon, tier: s.tier, type: s.type || 'passive',
               rarity: meta.rarity, tierName: meta.name,
               unlockBond: meta.unlockBond, unlocked: s.tier <= t, desc: s.desc });
  }
  return out;
}

// 实际生效的技能：只认「已解锁 + 已装备」的，防止改了存档就带上没解锁的。
//
// ⚠️ 这里不能「没选就自动装满」：那样玩家永远没法选择「不带技能」，
//    自测里也就量不出技能的净增益（实测「不带」和「带满」胜率一样）。
//    只在从没设置过（undefined）时才给默认；设成空数组就是真的不带。
function equippedSkills(st) {
  var unlocked = skillsOf(st);
  var ok = {};
  for (var i = 0; i < unlocked.length; i++) ok[unlocked[i].id] = true;
  var raw = (st && st.battle_skills);
  var neverSet = (raw === undefined || raw === null);
  var want = neverSet ? [] : raw;
  var slots = skillSlotsOf(st);
  var out = [];
  for (var j = 0; j < want.length && out.length < slots; j++) {
    if (ok[want[j]] && out.indexOf(want[j]) < 0) out.push(want[j]);
  }
  // 首次进入（从没设置过）只自动带 1 个最简单的技能，而不是装满 2 个：
  // 装满会让「带技能」变成默认基线，平衡性被整体推高一档（实测 spar 100%/rival 95%/boss 91%），
  // 也让「自己挑第二个技能」这个决策在玩家还没意识到之前就被替他做掉了。
  if (neverSet) {
    for (var k = 0; k < unlocked.length && out.length < 1; k++) out.push(unlocked[k].id);
  }
  return out;
}

// 把技能列表压成结算时用的标记表。
// stat 类技能（坚韧/力量/敏捷/精准）不在这里——它们改的是开场属性，走 battleKitOf。
function skillSet(ids) {
  var e = {
    // 基线 5 技能（数值冻结，别动）
    heavy: false, lifesteal: 0, shield: false, combo: 0, pierce: 0,
    // v2.0 被动
    counter: 0, aura: 0, evade: 0, regen: 0,
    // v2.0 主动（数值 = 伤害倍率 / 回复比）
    blast: 0, smash: 0, heal: 0,
    // v2.0 增益
    berserk: false, guard_stance: false
  };
  var list = ids || [];
  for (var i = 0; i < list.length; i++) {
    var id = list[i];
    if (!SKILLS[id]) continue;
    if (id === 'heavy') e.heavy = true;
    else if (id === 'lifesteal') e.lifesteal = 0.12;
    else if (id === 'shield') e.shield = true;
    else if (id === 'combo') e.combo = 0.25;
    else if (id === 'pierce') e.pierce = 0.3;
    else if (id === 'counter') e.counter = 0.4;
    else if (id === 'aura') e.aura = 1.25;
    else if (id === 'evade') e.evade = 0.15;
    else if (id === 'regen') e.regen = 0.02;
    else if (id === 'blast') e.blast = 2.0;
    else if (id === 'smash') e.smash = 2.0;
    else if (id === 'heal') e.heal = 0.3;
    else if (id === 'berserk') e.berserk = true;
    else if (id === 'guard_stance') e.guard_stance = true;
  }
  // ⚠️ 互斥规则（无条件保留规则表靠前者），都是为了压住「叠乘」：
  //    1) 千钧 vs 爆发/连打：都是单回合增伤，叠起来是乘算（实测把最难层推到 95%）
  //    2) 鲸吞 vs 护盾：都是续航，叠起来等于「打不死」，boss 胜率从 79% 冲到 90%
  //    3) 狂怒 vs 壁垒：两个增益各带一半代价，同时开等于没有代价
  //    互斥之后每个技能都对应一条明确的路线，选择才有意义。
  if (e.heavy && e.blast > 0) e.blast = 0;
  if (e.heavy && e.combo > 0) e.combo = 0;
  if (e.lifesteal > 0 && e.shield) e.shield = false;
  if (e.berserk && e.guard_stance) e.guard_stance = false;
  return e;
}

// ==================== 进化（v0.8.0 / v2.0 调整槽位）====================
// 进化不改形象（形象是玩家自己画的/选的，不能替他换），改的是**能装几个技能**。
// 这是最像宝可梦、又不会破坏已有平衡的奖励。
//
// v2.0 起槽位走平滑阶梯 2/3/4/5（用户确认）：每个进化阶段都有实质成长。
// ⚠️ 这意味着 bond 60+ 的玩家比旧版多一个槽位，中后期平衡整体上移一档——
//    对手（NPC/野怪/塔）不吃这个加成，所以「带满槽」是真实的成长红利；
//    _pet-build-selftest.mjs 里的平衡抽样会盯住「不要一键通关」这条线。
var EVOLUTIONS = [
  { stage: 0, name: '幼生体', icon: '🥚', at: 0,   slots: 2, desc: '刚来到你桌面的样子' },
  { stage: 1, name: '成长期', icon: '🌱', at: 60,  slots: 3, desc: '解锁第 3 个技能槽' },
  { stage: 2, name: '完全体', icon: '✨', at: 120, slots: 4, desc: '解锁第 4 个技能槽' },
  { stage: 3, name: '传说体', icon: '👑', at: 200, slots: 5, desc: '第 5 个技能槽，Build 的完全形态' }
];
function evolutionOf(st) {
  var bond = (st && st.bond) || 0;
  var idx = 0;
  for (var i = 0; i < EVOLUTIONS.length; i++) if (bond >= EVOLUTIONS[i].at) idx = i;
  var cur = EVOLUTIONS[idx];
  var next = EVOLUTIONS[idx + 1] || null;
  var pct = next
    ? Math.max(0, Math.min(100, Math.round((bond - cur.at) / (next.at - cur.at) * 100)))
    : 100;
  return {
    stage: cur.stage, name: cur.name, icon: cur.icon, bond: bond,
    slots: cur.slots, desc: cur.desc,
    nextAt: next ? next.at : null,
    nextName: next ? next.name : '',
    pct: pct
  };
}
function skillSlotsOf(st) { return evolutionOf(st).slots; }

// ==================== 野生精灵 / 图鉴（v0.8.0）====================
// 15 只野生精灵 = 5 属性 × 3 稀有度。它们不是「皮肤」：
//   - 打赢有概率收服，收进图鉴；
//   - 收服后可以选一只「随行」，按属性给一条永久小加成；
//   - 图鉴进度本身是长期目标，不需要每天打卡。
//
// ⚠️ 捕捉概率不跟玩家等级挂钩，只跟「这只怪多稀有」和「你为它失败过几次」有关。
//    失败一次 +12%，最多 95%——collection 不该变成纯运气，
//    也不该出现「打了 40 次还不给」的挫败。
var RARITY = {
  common: { id: 'common', name: '常见', icon: '⚪', capture: 0.62, buddyMul: 1, color: '#8E8E93' },
  rare:   { id: 'rare',   name: '稀有', icon: '🔵', capture: 0.40, buddyMul: 2, color: '#0A84FF' },
  legend: { id: 'legend', name: '传说', icon: '🟡', capture: 0.20, buddyMul: 3, color: '#C58B00' }
};
var CAPTURE_FAIL_BONUS = 0.12;
var CAPTURE_MAX = 0.95;
var CAPTURE_SPOTLIGHT_BONUS = 0.10;
// 野怪胜利的装备掉落率：低于一半，让掉落是「惊喜」而不是「刷材料的日常」
var WILD_DROP_CHANCE = 0.35;

var WILD = [
  // ---- 常见 ----
  { id: 'huomiao', name: '火苗狸', type: 'fire', rarity: 'common', bond: 18, icon: '🐱', skills: [],
    desc: '尾巴上有一簇不会灭的小火，下雨天会躲进你的口袋' },
  { id: 'caotuan', name: '草团子', type: 'grass', rarity: 'common', bond: 20, icon: '🌱', skills: [],
    desc: '在墙根晒太阳，一碰就滚成球' },
  { id: 'tubo', name: '土拨拨', type: 'earth', rarity: 'common', bond: 22, icon: '🐹', skills: [],
    desc: '挖洞专家，据说家里有三条暗道' },
  { id: 'dianqiu', name: '电球球', type: 'electric', rarity: 'common', bond: 24, icon: '🐭', skills: ['combo'],
    desc: '毛一炸就会噼啪响，摸它之前先摸一下门把手' },
  { id: 'shuidi', name: '水滴鱼', type: 'water', rarity: 'common', bond: 26, icon: '🐟', skills: ['lifesteal'],
    desc: '离开水也能活，但会一直哼同一首歌' },

  // ---- 稀有 ----
  { id: 'yanhu', name: '炎狐', type: 'fire', rarity: 'rare', bond: 52, icon: '🔥', skills: ['heavy'],
    desc: '跑过的地方会留下一串焦黑的小脚印' },
  { id: 'tengman', name: '藤蔓怪', type: 'grass', rarity: 'rare', bond: 58, icon: '🌿', skills: ['lifesteal'],
    desc: '会把你掉在地上的橡皮筋收进自己的窝' },
  { id: 'yanjia', name: '岩甲兽', type: 'earth', rarity: 'rare', bond: 64, icon: '🗿', skills: ['shield'],
    desc: '趴着的时候和操场边的石头一模一样' },
  { id: 'leiming', name: '雷鸟', type: 'electric', rarity: 'rare', bond: 70, icon: '⚡', skills: ['combo', 'pierce'],
    desc: '只在打雷前出现，翅膀上有细小的电弧' },
  { id: 'chaoxi', name: '潮汐豚', type: 'water', rarity: 'rare', bond: 76, icon: '🐬', skills: ['shield'],
    desc: '能听懂上下课铃，铃声一响就跃出水面' },

  // ---- 传说 ----
  { id: 'fenghuang', name: '不死鸟', type: 'fire', rarity: 'legend', bond: 108, icon: '🐦', skills: ['heavy', 'lifesteal'],
    desc: '据说每次考试前都会在教室窗台上重生一次' },
  { id: 'gushu', name: '古树精', type: 'grass', rarity: 'legend', bond: 116, icon: '🌳', skills: ['shield', 'pierce'],
    desc: '比学校还老，树皮里刻着历届学生的名字' },
  { id: 'taisui', name: '太岁', type: 'earth', rarity: 'legend', bond: 124, icon: '🗿', skills: ['shield', 'heavy'],
    desc: '在操场下面睡了很久，翻身时会轻微地震' },
  { id: 'leishen', name: '雷神兽', type: 'electric', rarity: 'legend', bond: 132, icon: '🐉', skills: ['combo', 'pierce'],
    desc: '一声吼能让整栋楼的路由器重启' },
  { id: 'shenhai', name: '深海马', type: 'water', rarity: 'legend', bond: 140, icon: '🐋', skills: ['lifesteal', 'pierce'],
    desc: '从教学楼的排水口一路游到了海里' }
];
var WILD_MAP = {};
for (var _wi = 0; _wi < WILD.length; _wi++) WILD_MAP[WILD[_wi].id] = WILD[_wi];
function wildById(id) { return WILD_MAP[String(id || '')] || null; }

function ownedMap(st) {
  var map = {};
  var dex = (st && st.dex) || [];
  for (var i = 0; i < dex.length; i++) map[String(dex[i])] = true;
  return map;
}
function wildPublic(w) {
  if (!w) return null;
  var t = typeInfo(w.type);
  var r = RARITY[w.rarity] || RARITY.common;
  return {
    id: w.id, name: w.name, type: w.type, typeName: t.name, typeIcon: t.icon, typeColor: t.color,
    rarity: w.rarity, rarityName: r.name, rarityIcon: r.icon, rarityColor: r.color,
    bond: w.bond, icon: w.icon, desc: w.desc, skills: w.skills,
    power: powerOf(combatOf({ bond: w.bond }))
  };
}
// 随行加成：按属性给一条明确的定位，不按单只怪微调（15 条数值表最容易调崩）
//   fire 攻击 / grass 防御 / earth 血+防 / electric 速度+暴击 / water 血
// 稀有度只放大同一条加成，所以「传说比常见强」是可预期的。
function buddyBonusOf(st) {
  var zero = { hp: 0, atk: 0, def: 0, spd: 0, crit: 0 };
  if (!st || !st.buddy) return zero;
  var owned = ownedMap(st);
  var w = wildById(st.buddy);
  if (!w || !owned[w.id]) return zero;
  var m = (RARITY[w.rarity] || RARITY.common).buddyMul || 1;
  if (w.type === 'fire') return { hp: 0, atk: 3 * m, def: 0, spd: 0, crit: 0 };
  if (w.type === 'grass') return { hp: 0, atk: 0, def: 2 * m, spd: 0, crit: 0 };
  if (w.type === 'earth') return { hp: 8 * m, atk: 0, def: 1 * m, spd: 0, crit: 0 };
  if (w.type === 'electric') return { hp: 0, atk: 0, def: 0, spd: 2 * m, crit: 1 * m };
  return { hp: 14 * m, atk: 0, def: 0, spd: 0, crit: 0 };   // water
}
function buddyPublic(st) {
  var w = wildById(st && st.buddy);
  if (!w) return null;
  var owned = ownedMap(st);
  if (!owned[w.id]) return null;
  var pub = wildPublic(w);
  pub.bonus = buddyBonusOf(st);
  return pub;
}
// 今日 spotlight：给「今天打哪只」一个理由，但不限制你打别的。
// 只从还没收服的里面挑，避免「幸运加成落在已经拥有的怪身上」。
function spotlightOf(uid, st) {
  var owned = ownedMap(st);
  var pool = [];
  for (var i = 0; i < WILD.length; i++) if (!owned[WILD[i].id]) pool.push(WILD[i]);
  if (!pool.length) return null;
  var rnd = rngFrom(fnv1a([String(uid), 'wild-spot', todayKey()].join('|')));
  return pool[Math.floor(rnd() * pool.length)];
}
function captureChanceOf(st, w, spot) {
  if (!w) return 0;
  var base = (RARITY[w.rarity] || RARITY.common).capture;
  var fails = (st && st.wild_fails && st.wild_fails[w.id]) || 0;
  var p = base + fails * CAPTURE_FAIL_BONUS;
  if (spot && spot.id === w.id) p += CAPTURE_SPOTLIGHT_BONUS;
  return Math.min(CAPTURE_MAX, Math.round(p * 100) / 100);
}
// 图鉴完整数据：一次给全，前端不需要再为每只怪单发请求
function dexOf(uid, st) {
  var owned = ownedMap(st);
  var spot = spotlightOf(uid, st);
  var list = [];
  var ownedCount = 0;
  var byType = {};
  for (var i = 0; i < ELEMENT_IDS.length; i++) byType[ELEMENT_IDS[i]] = { owned: 0, total: 0 };
  for (var j = 0; j < WILD.length; j++) {
    var w = WILD[j];
    var pub = wildPublic(w);
    pub.owned = !!owned[w.id];
    pub.capture = pub.owned ? null : captureChanceOf(st, w, spot);
    pub.fails = (st && st.wild_fails && st.wild_fails[w.id]) || 0;
    pub.spotlight = !!(spot && spot.id === w.id);
    if (pub.owned) ownedCount++;
    byType[w.type].total++;
    if (pub.owned) byType[w.type].owned++;
    list.push(pub);
  }
  var total = WILD.length;
  return {
    total: total,
    ownedCount: ownedCount,
    list: list,
    byType: byType,
    spotlight: spot ? wildPublic(spot) : null,
    spotlightBonus: CAPTURE_SPOTLIGHT_BONUS,
    buddy: buddyPublic(st),
    buddyBonus: buddyBonusOf(st),
    captureBase: { common: RARITY.common.capture, rare: RARITY.rare.capture, legend: RARITY.legend.capture }
  };
}

// ==================== 试炼塔（v0.7.0）====================
// 练习赛和影子是「每天打几场」的循环，缺一条**线性进度**：
// 有终点、有台阶、有过不去的那一层。塔就干这个。
//
// 塔层的敌人是固定羁绊，不跟着玩家缩放——所以「卡在第 7 层」是个真实的
// 里程碑，喂饱宠物涨了羁绊就能过去。这是唯一一条「羁绊会直接变成战力」的路。
//
// ⚠️ 层间跨度不能大：第一版每层 +20 bond，实测「要么 100% 通过、要么 0%」，
//    完全没有中间地带——玩家体验是一路平推到某层、然后突然撞死。
//
// ⚠️ 更根本的问题：这套战斗在「双方属性接近」时方差很小，
//    所以难度变化必然表现为 100% → 0% 的台阶。塔要做的不是拉平数值，
//    而是把「对手强度」变成一个连续量——
//    玩家在第 f 层面对的不是固定 bond，而是「按你的羁绊和层数算出来的强度」。
// 塔也不限次数（0 = 不限）。塔层是固定的，多打不会变强，
// 所以「次数」本来就只是人为摩擦；真正限制你的是「打不过」。
var TOWER_DAILY_CAP = 0;
// 整座塔是「土」属性：这是一条明确的攻略线——草本命打塔更轻松，
// 电本命则会被塔克制。十层共用同一属性，塔的难度曲线才不会因为
// 每层换属性而变成锯齿（实测会破坏「越高层越难」的单调性）。
var TOWER_TYPE = 'earth';
var TOWER_FLOORS = [
  { f: 1,  name: '纸箱里的小猫', bond: 10,  skills: [], desc: '刚睁眼，连爪子都还没收好' },
  { f: 2,  name: '幼儿园的皮球', bond: 20,  skills: [], desc: '会滚会弹，很难打中' },
  { f: 3,  name: '楼道口的守门犬', bond: 31,  skills: ['heavy'], desc: '认生，但只认一条道' },
  { f: 4,  name: '天台的鸽子王', bond: 43,  skills: ['combo'], desc: '啄得又快又密' },
  { f: 5,  name: '图书馆的猫头鹰', bond: 56,  skills: ['pierce'], desc: '专挑你的破绽下手' },
  { f: 6,  name: '暴雨里的流浪狗', bond: 70,  skills: ['lifesteal'], desc: '越打越精神' },
  { f: 7,  name: '老槐树下的猫老', bond: 86,  skills: ['shield'], desc: '活得久，什么都见过' },
  { f: 8,  name: '夜市的守护兽', bond: 104, skills: ['combo', 'heavy'], desc: '两个摊主都拦不住它' },
  { f: 9,  name: '月下的白鲸', bond: 126, skills: ['lifesteal', 'shield'], desc: '深海里没有对手' },
  { f: 10, name: '塔顶的另一个自己', bond: 152, skills: ['heavy', 'shield'], desc: '它知道你所有的招式' }
];
// 每层的「难度系数」：这个数量化「第 8 层到底有多强」。
//
// ⚠️ 这里有一个非常隐蔽的坑：战斗属性全部由 bond 经整数运算得出
//    （hp=40+bond、atk=6+floor(bond/8)…），所以**只要 bond 相同，胜率就完全相同**。
//    第一版按 `round(myBond * scale)` 算对手羁绊，结果整张难度表是 100%/0% 的台阶——
//    不是平衡没调好，是取整把连续的难度压成了离散值。
//
//    解法：难度不通过 bond 表达，而是给对手一层**独立的伤害乘区**（towerBuff）。
//    伤害是浮点数，可以连续调节，这样才能做出 30%/50%/70% 这样的过渡带。
var TOWER_SCALE = [0.86, 0.92, 0.99, 1.06, 1.13, 1.20, 1.27, 1.34, 1.46, 1.62];

// 某一层对某个玩家而言，实际要面对的羁绊值。
// 对手羁绊只做「新手保护」：不低于该层的基准值，避免低羁绊玩家撞墙；
// 上限跟着玩家走，但不放大——放大会让高羁绊玩家反而更难。
function towerFoeBond(st, floorDef) {
  var myBond = (st && st.bond) || 0;
  return Math.max(floorDef.bond, Math.min(myBond, floorDef.bond + 40), 6);
}

// 每层的伤害乘区 —— 塔的**唯一**难度旋钮。
//
// ⚠️ 这里必须只跟「层数」有关，不能跟玩家羁绊挂钩：
//    第一版写了 `1 + (scale-1) * f(bond)` 这样的补偿，结果高羁绊玩家
//    面对的对手更强、自己却更脆，实测 bond 160 能爬到的高度反而低于 bond 120。
//    难度应该是「第几层」的函数，玩家的成长通过「属性自然变强」体现。
function towerBuffFor(st, floorDef) {
  var idx = Math.max(0, Math.min(TOWER_SCALE.length - 1, floorDef.f - 1));
  return TOWER_SCALE[idx];
}
var TOWER_CLEAR_GAIN = 25;     // 首次通关的奖励，比日常一场多得多
function towerFloorOf(n) { return TOWER_FLOORS[n - 1] || null; }

// ==================== 今日规则（v0.28.0）====================
// 后期枯燥的根不是「打不过」，是「每天都一样」：同一个塔、同一套数值、
// 同一种打法，练到 bond 200 之后每场战斗的悬念只剩指令牌那 ±20%。
//
// 今日规则给塔装一个「每天的变奏」：从 8 条词缀里按**日期哈希**抽 2 条，
// 全班同一天完全相同（和天气同一个先例）——同学之间能聊「今天这规则真阴间」。
// 词缀是**双方对称**的：它不改变敌我相对强度（难度仍由层控制），
// 改变的是这一天的正确打法——「玻璃大炮」日憋一发更香，「硬壳时代」日破甲才有价值。
//
// ⚠️ 只作用于塔与深渊（PvE）：练习赛/影子是社交对抗，加词缀会干扰
// 「谁的宠物更强」的比较，那里永远用裸规则。
// ⚠️ 不进 seed：同一层、同一天、换本命重打要能对比，随机流不能因词缀漂移。
var DAILY_MODS = {
  haste:   { id: 'haste',   name: '疾风地带', icon: '💨', text: '双方速度 +25%',
             apply: function(c) { c.spd = Math.round(c.spd * 1.25); } },
  quag:    { id: 'quag',    name: '稠重空气', icon: '🌫️', text: '双方速度 -20%',
             apply: function(c) { c.spd = Math.max(1, Math.round(c.spd * 0.8)); } },
  glass:   { id: 'glass',   name: '玻璃大炮', icon: '🔮', text: '双方伤害 ×1.3',
             mod: { dmgMul: 1.3 } },
  turtle:  { id: 'turtle',  name: '硬壳时代', icon: '🐢', text: '双方防御 ×1.25',
             apply: function(c) { c.def = Math.round(c.def * 1.25); } },
  vampire: { id: 'vampire', name: '血之契约', icon: '🩸', text: '攻击方按伤害 8% 回血',
             mod: { vampire: 0.08 } },
  critup:  { id: 'critup',  name: '无防备',   icon: '🎯', text: '双方暴击率 +15',
             apply: function(c) { c.crit = Math.min(90, c.crit + 15); } },
  burn:    { id: 'burn',    name: '燃烧地面', icon: '🔥', text: '每回合双方掉 3% 最大血',
             mod: { dotPercent: 0.03 } },
  beefy:   { id: 'beefy',   name: '铜皮铁骨', icon: '🧱', text: '双方最大血 +30%',
             apply: function(c) { c.hp = Math.round(c.hp * 1.3); } }
};
var DAILY_MOD_IDS = Object.keys(DAILY_MODS);
function dailyModsOf(dateKey) {
  var rnd = rngFrom(fnv1a('mods|' + (dateKey || todayKey())));
  var a = DAILY_MOD_IDS[Math.floor(rnd() * DAILY_MOD_IDS.length)];
  var b = DAILY_MOD_IDS[Math.floor(rnd() * DAILY_MOD_IDS.length)];
  if (b === a) b = DAILY_MOD_IDS[(DAILY_MOD_IDS.indexOf(a) + 1) % DAILY_MOD_IDS.length];
  return [DAILY_MODS[a], DAILY_MODS[b]];
}
// 把今日规则折进一场战斗：combat 类直接改属性（要在 powerOf 之前调用），
// 引擎类汇成一个 mods 对象（dmgMul / vampire / dotPercent）交 simulateBattle。
// 返回 { mods: <引擎通道> }，dotPercent 与环境的灼烧叠加（都是「回合末掉血」）。
function applyDailyMods(mine, foe, mods) {
  var out = {};
  for (var i = 0; i < mods.length; i++) {
    var m = mods[i];
    if (m.apply) { m.apply(mine); m.apply(foe); }
    if (m.mod) {
      if (m.mod.dmgMul) out.dmgMul = (out.dmgMul || 1) * m.mod.dmgMul;
      if (m.mod.vampire) out.vampire = (out.vampire || 0) + m.mod.vampire;
      if (m.mod.dotPercent) out.dotPercent = (out.dotPercent || 0) + m.mod.dotPercent;
    }
  }
  return out;
}

// ==================== 深渊（v0.28.0）—— 打穿塔之后的无尽模式 ====================
// 塔 10 层打完，「你是塔顶传说」——然后呢？bond 涨到 200 之后数值全线封顶，
// 每场都是碾压，玩家第二次登顶就退坑了。深渊是塔的延伸：
// 层数无限、难度连续上升、对手属性按深度轮换（逼你换本命）、技能包逐段加厚。
//
// 设计红线：
//   1) 深度是**存档进度**（st.abyss_floor），失败不清零——深渊惩罚的是「上不去」，
//      不是「掉下来」，掉层会让后期玩家每个日常都变成守门战。
//   2) 名字按深度全局固定：同学之间能聊「你打到无面人了吗」。
//   3) 积分进塔积分池（tower_points），自动接入现有排行榜，不新开第二条榜。
var ABYSS_NAMES = [
  '守夜的影子', '无面的猫', '灰烬行者', '回声', '断线的木偶',
  '雾中的灯', '倒走的钟', '折角的页', '哑掉的铃', '熄不掉的烛'
];
var ABYSS_SKILLS = [
  ['heavy'],
  ['heavy', 'shield'],
  ['lifesteal', 'combo'],
  ['heavy', 'pierce', 'shield'],
  ['lifesteal', 'heavy', 'shield']
];
// 深度难度：1.62 + 0.05 × (depth-1)——第 1 层和塔顶**同难度**起步。
// 教训（两轮实测）：第一版 1.62×(1+0.09d) 让刚登顶的玩家进门就是墙（bond170 只有 10%）；
// 改 1.62+0.07d 仍只有 10%。深渊第 1 层的对手本来 bond 就比塔顶高 6 点，
// 再叠 buff 跳升，等于双倍惩罚。现在难度完全由「深度 +1 = +0.05」线性堆：
// d1=1.62（塔顶持平）、d5=1.82、d10=2.07、d20=2.57——上一层的你永远打得过这一层的你。
// 对手属性轮换与今日规则提供「新鲜感」，难度只提供「坡度」，两者不叠加共振。
function abyssBuffFor(depth) { return 1.62 + 0.03 * (depth - 1); }
// 对手羁绊：**固定** 150 + 深度 × 2（d1=152 与塔顶同源，d10=170，d20=190）。
// ⚠️ 绝不跟随玩家——这是两轮实测换来的教训。塔的 towerFoeBond 有
// 「min(myBond, base+40)」的跟随上限（防低层太弱），照抄到深渊就是灾难：
// 玩家 bond240 时对手也 240，深度坡度被完全抵消，甚至 spd 反超让玩家永远后手
// （实测 bond240 打深渊 5 = 0%，尽管属性全面占优）。深渊是「固定的墙」：
// 你变强 = 能下更深，这才是「后期也有事做」的全部意义。
// 能摸到深渊的玩家 bond 至少 ~200（塔 10 对手 192），不存在新手保护问题。
function abyssFoeBond(st, depth) {
  return Math.max(150 + depth * 2, 6);
}
// 深度 depth（从 1 起）的那一层。f 编号接着塔（11 起），让「第几层」只有一个说法。
function abyssFloorOf(st, depth) {
  if (!(depth >= 1)) return null;
  var types = ['earth', 'water', 'fire', 'grass', 'electric'];
  var type = types[(depth - 1) % types.length];
  var skills = ABYSS_SKILLS[Math.min(ABYSS_SKILLS.length - 1, Math.floor((depth - 1) / 4))];
  var seg = depth <= 5 ? 1 : (depth <= 10 ? 2 : (depth <= 15 ? 3 : 4));
  return {
    f: 10 + depth, depth: depth,
    name: ABYSS_NAMES[(depth - 1) % ABYSS_NAMES.length],
    desc: '深渊第 ' + seg + ' 段 · 它的系别一直在换',
    type: type, skills: skills.slice()
  };
}
function abyssClearGain(depth) {
  // 通关 10 层塔 = 25×10 = 250 分的分段产出；深渊每层起 30 分，每深一层 +15%，
  // 深度 10 一层 ≈ 120 分——够让「今天再下一层」有分量，又不至于把日常刷分比下去。
  return Math.round(30 * Math.pow(1.15, Math.min(depth - 1, 20)));
}

function towerOf(st) {
  var cleared = (st && st.tower_floor) || 0;
  var today = todayKey();
  var used = (st && st.tower_date === today) ? (st.tower_today || 0) : 0;
  var next = towerFloorOf(cleared + 1);
  var out = {
    cleared: cleared,
    total: TOWER_FLOORS.length,
    today: used,
    cap: TOWER_DAILY_CAP,
    left: TOWER_DAILY_CAP ? Math.max(0, TOWER_DAILY_CAP - used) : -1,
    floors: []
  };
  for (var i = 0; i < TOWER_FLOORS.length; i++) {
    var f = TOWER_FLOORS[i];
    var fb = towerFoeBond(st, f);
    var c = combatOf({ bond: fb });
    var ft = typeInfo(TOWER_TYPE);
    out.floors.push({
      f: f.f, name: f.name, desc: f.desc, bond: fb, baseBond: f.bond,
      tierName: c.tierName, power: powerOf(c), skills: f.skills,
      type: TOWER_TYPE, typeName: ft.name, typeIcon: ft.icon,
      cleared: f.f <= cleared
    });
  }
  if (next) {
    var nb = towerFoeBond(st, next);
    var nc = combatOf({ bond: nb });
    var nt = typeInfo(TOWER_TYPE);
    out.next = {
      f: next.f, name: next.name, desc: next.desc, bond: nb, baseBond: next.bond,
      tierName: nc.tierName, power: powerOf(nc), hp: nc.hp, skills: next.skills,
      type: TOWER_TYPE, typeName: nt.name, typeIcon: nt.icon
    };
  } else {
    out.next = null;   // 通关了
    // ---- 深渊（v0.28.0）：塔打穿之后的路。深度 = 已通过的深渊层数。 ----
    var depth = (st && st.abyss_floor) || 0;
    var nd = abyssFloorOf(st, depth + 1);
    if (nd) {
      var ab = abyssFoeBond(st, nd.depth);
      var ac = combatOf({ bond: ab });
      var at = typeInfo(nd.type);
      out.abyss = {
        depth: depth,
        gain: abyssClearGain(nd.depth),
        buff: Math.round(abyssBuffFor(nd.depth) * 100) / 100,
        next: {
          f: nd.f, name: nd.name, desc: nd.desc, depth: nd.depth,
          bond: ab, tierName: ac.tierName, power: powerOf(ac), skills: nd.skills,
          type: nd.type, typeName: at.name, typeIcon: at.icon
        }
      };
    }
  }
  out.dailyMods = dailyModsOf(today).map(function(m) {
    return { id: m.id, name: m.name, icon: m.icon, text: m.text };
  });
  return out;
}

// ==================== 称号（v0.7.0）====================
// 全部由存档推导，不单独存储——这样「改了数值称号就自动对」，
// 也不会出现「存档里写着塔顶传说但其实没通关」的脏数据。
function titlesOf(st) {
  var out = [];
  var rec = (st && st.battles) || {};
  var def = (st && st.battle_defend) || {};
  var floor = (st && st.tower_floor) || 0;
  if ((rec.total || 0) >= 1) out.push({ id: 'rookie', name: '初出茅庐', icon: '🌱' });
  if ((rec.best || 0) >= 3) out.push({ id: 'hot', name: '手感火热', icon: '🔥' });
  if ((rec.best || 0) >= 5) out.push({ id: 'unstoppable', name: '势不可挡', icon: '⚡' });
  if ((def.held || 0) >= 5) out.push({ id: 'warden', name: '守擂人', icon: '🏰' });
  if ((rec.points || 0) >= 100) out.push({ id: 'century', name: '百分战力', icon: '💯' });
  if (floor >= 3) out.push({ id: 'climber', name: '攀塔者', icon: '🧗' });
  if (floor >= 6) out.push({ id: 'veteran', name: '老练斗士', icon: '🗡️' });
  if (floor >= 10) out.push({ id: 'champion', name: '塔顶传说', icon: '👑' });
  // 深渊称号（v0.28.0）：塔顶之后的名声继续往上叠，后期玩家的「我是谁」有新答案
  var abyss = (st && st.abyss_floor) || 0;
  if (abyss >= 3) out.push({ id: 'abysswalker', name: '渊行者', icon: '🌑' });
  if (abyss >= 7) out.push({ id: 'daybreak', name: '破晓者', icon: '🌗' });
  if (abyss >= 12) out.push({ id: 'abyssend', name: '渊之尽头', icon: '🕳️' });
  // 图鉴与进化：这两条线不需要打得多，只需要养得久、收得全
  var dexCount = ((st && st.dex) || []).length;
  if (dexCount >= 5) out.push({ id: 'collector', name: '收藏家', icon: '📖' });
  if (dexCount >= 15) out.push({ id: 'dexmaster', name: '图鉴大师', icon: '🔮' });
  var evo = evolutionOf(st);
  if (evo.stage >= 2) out.push({ id: 'metamorph', name: '蜕变者', icon: '✨' });
  if (evo.stage >= 3) out.push({ id: 'legendary', name: '传说', icon: '👑' });
  return out;
}

// ==================== 每日奇遇（v0.16.0）====================
// 离线时光给的是「它在等你」，每日奇遇给的是「今天发生了好事」。
// 两者合起来才是 Planet Pet 说的「每分钟都在生活」。
//
// 设计取舍：
//   - 一天一次，按日期 + uid 用 fnv1a 定种子，不是随机数 —— 同一天刷新是同一件事，
//     不会闪来闪去，也不会出现「早上抽到硬币、下午又抽到硬币」的重复感。
//   - 奇遇是**独立于互动的收益线**：不占 bond_today 的 25 上限，也不占 feed 的 3 次。
//     否则「今天捡到硬币」会变成「少喂一顿饭」，玩家会觉得亏。
//   - 领取是幂等的：服务端记 claimed_date，同天第二次领返回 alreadyClaimed。
var DAILY_WONDERS = [
  { id: 'w1', icon: '🪙', title: '捡到一枚硬币', text: '它在桌角发现了一枚遗落的硬币，交给你保管', reward: { coins: 5 } },
  { id: 'w2', icon: '🌸', title: '春天的花瓣', text: '窗外飘进来一片花瓣，它追着转了三圈', reward: { bond: 2 } },
  { id: 'w3', icon: '📖', title: '翻到一页新书', text: '它翻开了你桌上的一本书，居然在读', reward: { bond: 1, coins: 2 } },
  { id: 'w4', icon: '🎮', title: '学会新把戏', text: '它自己学会了翻跟头，得意得不行', reward: { coins: 3, bond: 1 } },
  { id: 'w5', icon: '🌧️', title: '雨天的陪伴', text: '外面下雨了，它贴着窗玻璃看雨', reward: { bond: 2 } },
  { id: 'w6', icon: '☕', title: '偷喝一口咖啡', text: '它趁你不注意舔了一口咖啡，现在有点亢奋', reward: { coins: 4 } },
  { id: 'w7', icon: '🌙', title: '月光下的梦', text: '它梦见了什么，睡着时嘴角在动', reward: { bond: 3 } },
  { id: 'w8', icon: '🎯', title: '找到你掉的笔', text: '它把掉到桌下的笔叼了回来，邀功', reward: { coins: 2, bond: 1 } }
];
var DAILY_WONDERS_MAP = {};
for (var _wi = 0; _wi < DAILY_WONDERS.length; _wi++) DAILY_WONDERS_MAP[DAILY_WONDERS[_wi].id] = DAILY_WONDERS[_wi];

function wonderFor(uid, st, dateKey) {
  var seed = fnv1a('wonder:' + (uid || 0) + ':' + dateKey);
  return DAILY_WONDERS[seed % DAILY_WONDERS.length];
}

function wonderView(uid, st, dateKey) {
  if (!st || !st.adopted) return null;
  var w = wonderFor(uid, st, dateKey);
  var claimed = (st.wonder_claimed || '') === dateKey;
  return {
    date: dateKey,
    wonder: {
      id: w.id, icon: w.icon, title: w.title, text: w.text,
      rewardText: (w.reward.coins ? '+' + w.reward.coins + ' 鱼干 ' : '') + (w.reward.bond ? '+' + w.reward.bond + ' 羁绊' : '')
    },
    claimed: claimed,
    reward: claimed ? null : w.reward
  };
}

// POST /pet/wonder/claim —— 领取今日奇遇奖励（幂等）
router.post('/wonder/claim', requireAuth, function(req, res) {
  var uid = userId(req);
  var st = readPet(uid);
  if (!st || !st.adopted) return res.status(400).json({ code: 400, message: '还未领养宠物' });
  var dateKey = todayKey();
  var w = wonderFor(uid, st, dateKey);
  if ((st.wonder_claimed || '') === dateKey) {
    return res.json({ code: 200, data: { alreadyClaimed: true, wonder: wonderView(uid, st, dateKey) } });
  }
  st.wonder_claimed = dateKey;
  if (w.reward.coins) st.coins = (st.coins || 0) + w.reward.coins;
  if (w.reward.bond) {
    st.bond = (st.bond || 0) + w.reward.bond;
    st.bond_today = (st.bond_today || 0) + w.reward.bond;
  }
  if (w.reward.coins || w.reward.bond) {
    diaryPush(st, dateKey, { k: 'wonder', n: w.reward.coins || 0, m: w.reward.bond || 0 });
  }
  writePet(uid, st);
  res.json({ code: 200, data: {
    wonder: wonderView(uid, st, dateKey),
    state: publicState(st),
    addedCoins: w.reward.coins || 0,
    addedBond: w.reward.bond || 0
  } });
});

// GET /pet/autonomy —— 轻量轮询：只推进自主行为，不重跑离线 recap。
// 前端每 ~45s 调一次，让「它正在干嘛」持续更新。
router.get('/autonomy', requireAuth, function(req, res) {
  var uid = userId(req);
  var st = readPet(uid);
  if (!st || !st.adopted) return res.json({ code: 200, data: { autonomy: null } });
  var av = autonomyView(st, uid);
  writePet(uid, st);
  res.json({ code: 200, data: { autonomy: av, state: publicState(st) } });
});

// ==================== 异步影子赛场（v0.5.0）====================
// 「影子」是真实同学的宠物快照，不是 NPC：对方不用在线，服务端拿他当前的 bond 结算，
// 再把战报塞进他的 inbox。下次打开桌宠时会看到「谁来挑战过你」。
// ⚠️ 被挑战方的战绩不会被别人改写——只加独立的「守擂」记录和保底积分，
//    否则一个人疯狂打另一个人，对方的胜负就被操纵了。
// ==================== 自主行为（v0.17.0）====================
// 「玩久了没意思」的终极解药：宠物在你不在的时候也在动。
// 离线时光只在「你回来那一刻」结算一次 recap，但桌面宠物的真正卖点是
// 「它现在就在动」—— 发呆、闲逛、睡觉、找鱼干，按它自己的节奏。
//
// 行为引擎是**离线可推演**的：每条行为用「行为 id + 日期 + uid」定种子，
// 所以同一秒开两次页面，它做的事完全一样（不会闪来闪去）；
// 而「上次行为时间戳」存档在 KV 里，下一次请求就能算出它现在该干嘛。
//
// ⚠️ 收益全部走已有通道（coins/bond + diary），不发明新货币。
// ⚠️ 行为不占 bond_today 的 25 上限 —— 那是「你陪它」的额度，不是它的额度。
var AUTONOMY_GAP_MIN = 12;          // 多久没动就该做下一件事
var AUTONOMY_BEHAVIORS = [
  { id: 'idle',   icon: '😴', text: '趴着发呆',    weight: 3, coin: 0,  bond: 0,  kind: 'idle' },
  { id: 'wander', icon: '🐾', text: '逛了一小圈',  weight: 2, coin: 0,  bond: 0,  kind: 'walk' },
  { id: 'hunt',   icon: '🐟', text: '叼回一条鱼干',  weight: 2, coin: 1,  bond: 0,  kind: 'find' },
  { id: 'nap',    icon: '💤', text: '打了个小盹',    weight: 2, coin: 0,  bond: 1,  kind: 'sleep' },
  { id: 'mischief', icon: 'osi', text: '把笔推到地上', weight: 1, coin: 0,  bond: 0,  kind: 'mischief' }
];

function autonomyTick(st, uid) {
  if (!st || !st.adopted) return null;
  var nowMs = Date.now();
  var last = Number(st.autonomy_at) || 0;
  var gapMin = last > 0 ? Math.floor((nowMs - last) / 60000) : AUTONOMY_GAP_MIN;
  if (gapMin < 0) gapMin = 0;

  var events = [];
  // 每隔 GAP_MIN 就该动一次；离线越久，它做的事越多（像真宠物，不是钟表）
  var steps = gapMin >= AUTONOMY_GAP_MIN ? Math.min(6, 1 + Math.floor(gapMin / AUTONOMY_GAP_MIN)) : 0;
  var seed = fnv1a(['auto', String(uid || 0), String(nowMs)].join('|'));
  for (var i = 0; i < steps; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  var r = seed % 10;
  var sum = 0, chosen = AUTONOMY_BEHAVIORS[0];
  for (var b = 0; b < AUTONOMY_BEHAVIORS.length; b++) {
    sum += AUTONOMY_BEHAVIORS[b].weight;
    if (r < sum) { chosen = AUTONOMY_BEHAVIORS[b]; break; }
  }
    events.push({ id: chosen.id, icon: chosen.icon, text: chosen.text,
                  coin: chosen.coin, bond: chosen.bond, kind: chosen.kind });
    if (chosen.coin) st.coins = (st.coins || 0) + chosen.coin;
    if (chosen.bond) {
      st.bond = (st.bond || 0) + chosen.bond;
      st.bond_today = (st.bond_today || 0) + chosen.bond;
    }
    if (chosen.coin || chosen.bond) {
      diaryPush(st, todayKey(), { k: 'auto', n: chosen.coin, m: chosen.bond });
    }
  }
  st.autonomy_at = nowMs;
  if (events.length) {
    st.autonomy_last = events[events.length - 1];
  }
  return events.length ? events : null;
}

function autonomyView(st, uid) {
  var events = autonomyTick(st, uid);
  return {
    events: events,
    last: st && st.autonomy_last ? st.autonomy_last : null,
    gapMin: (st && st.autonomy_at) ? Math.max(0, Math.floor((Date.now() - Number(st.autonomy_at)) / 60000)) : 0
  };
}

var SHADOW_TTL_MS = 60 * 1000;      // 影子池进程内缓存：全表扫不能每次请求都跑
var SHADOW_PREFIX = 'p:';         // 影子对手 id 约定：p:<对方 user_id>
var SHADOW_POOL_MAX = 6;            // 一次最多展示几位同学
var SHADOW_DEFEND_WIN = 8;          // 守擂成功（对方视角：挑战者输了）给的分
var SHADOW_DEFEND_LOSE = 3;         // 被击败也给保底，别让「被挑战」变成惩罚
var SHADOW_INBOX_MAX = 20;

// ==================== 成就（v0.6.0）====================
// ==================== 故事章节（v0.15.0）====================
// 为什么加「故事」：现有系统都是「点一下涨一点」，玩家玩几小时后就进入
// 「我已经把所有东西都点过一遍」的死区。故事章节给的是一条长线 ——
// 每章解锁新内容、揭示宠物 backstory、给长期目标，让玩家每天回来都「有事可做」。
//
// 解锁条件全部基于已有数据（羁绊、战斗场次、图鉴、成就），不引入新维度。
// 章节奖励是 coins + bond，与日常互动叠加，不破坏经济曲线。
var STORY_CHAPTERS = [
  { id: 'ch1', title: '第一章 · 相遇', icon: '🌱', unlock: { bond: 0 }, reward: { coins: 5, bond: 2 },
    narrative: '它从一个小小的像素蛋里探出头，睁着圆圆的眼睛看你。从今天起，它就是你的了。',
    teaser: '多摸摸它，让它先熟悉你的手心。' },
  { id: 'ch2', title: '第二章 · 熟悉', icon: '🤝', unlock: { bond: 20 }, reward: { coins: 8, bond: 3 },
    narrative: '它开始会主动蹭你，晚上会蹲在桌角等你。它认得你的键盘声了。',
    teaser: '继续照顾它，羁绊到 60 进入下一章。' },
  { id: 'ch3', title: '第三章 · 亲密', icon: '💖', unlock: { bond: 60, wins: 3 }, reward: { coins: 12, bond: 5 },
    narrative: '它睡着时会把尾巴卷成一圈，把你的笔帽叼到窝里。你们之间有只属于自己的小秘密了。',
    teaser: '打赢 3 场练习赛，羁绊 120 进入下一章。' },
  { id: 'ch4', title: '第四章 · 形影不离', icon: '🌸', unlock: { bond: 120, wins: 5, dex: 5 }, reward: { coins: 18, bond: 8 },
    narrative: '它学会了一套自己的小把戏：会帮你把掉落的笔捡回来，会在你敲字时安静趴着。你不在时，它会自己翻翻书。',
    teaser: '羁绊 200 + 10 场胜利 + 10 只图鉴进入下一章。' },
  { id: 'ch5', title: '第五章 · 灵魂伙伴', icon: '✨', unlock: { bond: 200, wins: 10, dex: 10 }, reward: { coins: 30, bond: 12 },
    narrative: '它不再只是桌上的小宠物 —— 它是你每天打开电脑时第一个看到的伙伴。它会记得你所有的小习惯。',
    teaser: '解锁全部成就进入最终章。' },
  { id: 'ch6', title: '第六章 · 永远', icon: '👑', unlock: { bond: 200, wins: 30, achievements: 'all' }, reward: { coins: 50, bond: 20 },
    narrative: '你们的故事不会结束。明天、明年、很多年后，它都会在桌上等你，像第一次相遇那样。',
    teaser: '故事已到终点 —— 但冒险还没结束。' }
];

function storyChapterOf(st) {
  if (!st || !st.adopted) return 0;
  var ach = st.achievements || [];
  var achAll = (ach.length >= ACHIEVEMENTS.length);
  var wins = (st.battle_wins || 0);
  var dex = (st.dex_count || 0);
  var bond = st.bond || 0;
  var idx = 0;
  for (var i = STORY_CHAPTERS.length - 1; i >= 0; i--) {
    var c = STORY_CHAPTERS[i];
    var u = c.unlock;
    if (bond >= (u.bond || 0) &&
        wins >= (u.wins || 0) &&
        dex >= (u.dex || 0) &&
        (u.achievements !== 'all' || achAll)) {
      idx = i;
      break;
    }
  }
  return idx;
}

// ==================== 成就 ====================
// 只做「一次性的里程碑」，不做每日任务——每日任务会变成打卡负担，
// 而里程碑是「原来我做到了」的回忆。
var ACHIEVEMENTS = [
  { id: 'first_win',  name: '第一滴血', icon: '🎯', desc: '赢下第一场对战' },
  { id: 'streak_3',   name: '手感火热', icon: '🔥', desc: '拿到 3 连胜' },
  { id: 'streak_5',   name: '势不可挡', icon: '⚡', desc: '拿到 5 连胜' },
  { id: 'beat_boss',  name: '越级者',   icon: '🐙', desc: '击败深海水母' },
  { id: 'underdog',   name: '以弱胜强', icon: '🎯', desc: '战力低于对手仍获胜' },
  { id: 'shadow_10',  name: '同窗之谊', icon: '🏫', desc: '挑战真人影子 10 次' },
  { id: 'held_5',     name: '守擂如山', icon: '🏰', desc: '守住 5 次别人的挑战' },
  { id: 'points_100', name: '百分战力', icon: '💯', desc: '累计积分达到 100' },
  // 「今日满勤」原本是「一天打满上限」，但次数上限已经取消，这个成就失去意义。
  // 换成累计场次里程碑：同样奖励坚持，但不依赖某个每日额度。
  { id: 'veteran_30', name: '三十战老兵', icon: '🎖️', desc: '累计对战 30 场' },
  { id: 'tower_3',    name: '攀塔者',   icon: '🧗', desc: '通过试炼塔第 3 层' },
  { id: 'tower_6',    name: '老练斗士', icon: '🗡️', desc: '通过试炼塔第 6 层' },
  { id: 'tower_10',   name: '塔顶传说', icon: '👑', desc: '通关试炼塔第 10 层' },
  // 深水成就（v0.28.0）：塔只有 10 层，打完「塔顶传说」之后成长线就断了。
  // 深渊是唯一的无尽内容，它的里程碑必须够深——不是「多打几场」，是「再多撑几层」。
  { id: 'abyss_3',    name: '渊行者',   icon: '🌑', desc: '抵达深渊第 3 层' },
  { id: 'abyss_7',    name: '破晓者',   icon: '🌗', desc: '抵达深渊第 7 层' },
  { id: 'abyss_12',   name: '渊之尽头', icon: '🕳️', desc: '抵达深渊第 12 层' },
  { id: 'exp_3',      name: '远征老手', icon: '🏕️', desc: '单次远征到达第 3 层' },
  { id: 'exp_5',      name: '远征征服者', icon: '🏔️', desc: '单次远征五层全通' },
  { id: 'dex_1',      name: '初次收服', icon: '🔴', desc: '收服第一只野生精灵' },
  { id: 'dex_5',      name: '图鉴入门', icon: '📖', desc: '图鉴收录 5 只野生精灵' },
  { id: 'dex_15',     name: '图鉴大师', icon: '🔮', desc: '收服全部 15 只野生精灵' }
];
var ACH_MAP = {};
for (var _ai = 0; _ai < ACHIEVEMENTS.length; _ai++) ACH_MAP[ACHIEVEMENTS[_ai].id] = ACHIEVEMENTS[_ai];

// 返回本次新解锁的成就（已解锁的不重复返回）
function unlock(st, ids) {
  if (!st.achievements) st.achievements = [];
  var fresh = [];
  for (var i = 0; i < ids.length; i++) {
    var id = ids[i];
    if (!id || !ACH_MAP[id]) continue;
    if (st.achievements.indexOf(id) >= 0) continue;
    st.achievements.push(id);
    fresh.push(ACH_MAP[id]);
  }
  return fresh;
}

// ==================== 排行榜（v0.6.0）====================
// 只排「战力积分」，不排羁绊——羁绊是跟你自己宠物的私事，
// 拉出来排名会逼着人为了名次去刷摸摸，把陪伴变成 KPI。
//
// 读法与影子池共用一次全表扫（同一个缓存），所以排行榜几乎不额外花钱。
var RANK_MAX = 20;
function rankOf() {
  var all = shadowCandidates();          // 已含 adopted 过滤和 60s 缓存
  var rows = [];
  for (var i = 0; i < all.length; i++) {
    var st = all[i].raw || null;
    if (!st) continue;
    var rec = st.battles || {};
    var def = st.battle_defend || {};
    var c = combatOf(st);
    rows.push({
      uid: all[i].uid,
      name: st.name || '小家伙',
      power: powerOf(c),
      tierName: c.tierName,
      points: (rec.points || 0) + (def.points || 0),
      win: rec.win || 0,
      lose: rec.lose || 0,
      best: rec.best || 0,
      held: def.held || 0
    });
  }
  // 同分时按胜场、再按战力排：否则并列的人顺序会随数据库返回顺序飘
  rows.sort(function(a, b) {
    if (b.points !== a.points) return b.points - a.points;
    if (b.win !== a.win) return b.win - a.win;
    return b.power - a.power;
  });
  var uids = [];
  for (var k = 0; k < rows.length && k < RANK_MAX; k++) uids.push(rows[k].uid);
  var nicks = nicksOf(uids);
  var out = [];
  for (var m = 0; m < rows.length && m < RANK_MAX; m++) {
    var r = rows[m];
    r.rank = m + 1;
    r.owner = nicks[r.uid] || '';
    delete r.uid;
    out.push(r);
  }
  return out;
}

function readPet(uid) {
  var row = db.prepare('SELECT value FROM user_kv_store WHERE user_id = ? AND key = ?').get(uid, KV_KEY);
  if (!row) return null;
  try { return JSON.parse(row.value) || null; } catch (e) { return null; }
}

function writePet(uid, st) {
  st.updated_at = new Date().toISOString();
  db.prepare('INSERT INTO user_kv_store (user_id, key, value) VALUES (?, ?, ?) ' +
    'ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value')
    .run(uid, KV_KEY, JSON.stringify(st));
}

// 对外返回的存档：剥掉 diary。
// diary 是「服务端生成、只读」的展示数据，前端拿到的永远是 diaryView() 加工后的版本；
// 把原始事件表一起塞进每个响应只会让 /interact、/focus 的包白白大一圈。
function publicState(st) {
  if (!st) return st;
  var out = {};
  for (var k in st) {
    if (Object.prototype.hasOwnProperty.call(st, k) && k !== 'diary') out[k] = st[k];
  }
  return out;
}

// 战力派生（纯函数）。⚠️ 前端 entry.js 的 combatOf() 必须与此保持一致。
// 随行伙伴的加成在这里合入：它是「队伍」的一部分，不是战斗时的临时 buff，
// 所以战力、排行榜、对手难度标签都应该看得见它。
function combatOf(s) {
  var bond = (s && s.bond) || 0;
  var t = tierOf(bond);
  var b = buddyBonusOf(s);
  return {
    bond: bond,
    tier: t,
    tierName: TIER_NAMES[t],
    hp: 40 + bond + (b.hp || 0),
    atk: 6 + Math.floor(bond / 8) + (b.atk || 0),
    def: 2 + Math.floor(bond / 20) + (b.def || 0),
    spd: 3 + t * 2 + (b.spd || 0),
    crit: 8 + t * 4 + (b.crit || 0)
  };
}
function powerOf(c) {
  return c.hp + c.atk * 6 + c.def * 4 + c.spd * 3 + c.crit * 2;
}

// 练习赛对手：按玩家羁绊分三档。bond 只跟玩家走比例，保证「一直打得过 / 一直打不过」不会发生。
// spar 从 0.90 调到 0.96：0.90 时三招胜率都是 96%+，战术在最好打的档位上完全看不出区别，
// 等于「新手永远学不到战术有用」。留一点难度才让选择有意义。
var NPC_TIERS = [
  { id: 'spar',  name: '街角野猫', scale: 0.96, type: 'grass',    desc: '适合练手，先找找手感' },
  { id: 'rival', name: '巷口团子', scale: 1.02, type: 'water',    desc: '和你半斤八两的家伙' },
  { id: 'boss',  name: '深海水母', scale: 1.09, type: 'electric', desc: '比你壮一圈，敢不敢试' }
];
// 难度标签：把「我打他大概几成把握」直接算给前端。
// 用战力比而非真实胜率——真实胜率要跑模拟，列表里放 9 个对手就该卡了。
function oddsOf(myPower, foePower) {
  if (!foePower) return 'even';
  var r = myPower / foePower;
  if (r >= 1.12) return 'easy';
  if (r <= 0.90) return 'hard';
  return 'even';
}
var ODDS_TEXT = { easy: '好打', even: '势均', hard: '吃力' };

function opponentsOf(st) {
  var bond = (st && st.bond) || 0;
  var myPower = powerOf(combatOf(st));
  var myType = normType(st && st.battle_type);
  var out = [];
  for (var i = 0; i < NPC_TIERS.length; i++) {
    var n = NPC_TIERS[i];
    var ob = Math.max(4, Math.round(bond * n.scale));
    var c = combatOf({ bond: ob });
    var p = powerOf(c);
    var ft = typeInfo(n.type);
    out.push({
      id: n.id, name: n.name, kind: 'npc', desc: n.desc,
      bond: ob, tierName: c.tierName, power: p, hp: c.hp,
      type: n.type, typeName: ft.name, typeIcon: ft.icon,
      typeMul: typeMul(myType, n.type),
      odds: oddsOf(myPower, p), oddsText: ODDS_TEXT[oddsOf(myPower, p)]
    });
  }
  return out;
}

// ---- 真人影子：从库里挑出「真实同学的宠物快照」做异步对手 ----
// 影子是**快照**：对方不需要在线，也不需要参与。服务端拿他此刻的 bond 结算一场，
// 结果只写两处 —— 我的战绩 + 他的 inbox/守擂记录。
//
// ⚠️ 两个刻意的取舍：
//   1) 不改写对方的攻擂战绩（win/lose/points）：否则一个人反复挑战同班同学，
//      就能把对方的胜负摆成自己想要的样子。对方只多一条独立的「守擂」记录 + 保底积分。
//   2) 影子池带 60s 进程内缓存：user_kv_store 只对 (user_id, key) 建了索引，
//      WHERE key = ? 是一次全表扫，不能每个请求都扫一遍。
function shadowCandidates() {
  var today = todayKey();
  var now = Date.now();
  if (shadowCache.rows && shadowCache.key === today && now - shadowCache.at < SHADOW_TTL_MS) {
    return shadowCache.rows;
  }
  var rows;
  try {
    rows = db.prepare('SELECT user_id, value FROM user_kv_store WHERE key = ?').all(KV_KEY);
  } catch (e) { rows = []; }
  var out = [];
  for (var i = 0; i < rows.length; i++) {
    var st = null;
    try { st = JSON.parse(rows[i].value) || null; } catch (e2) { st = null; }
    if (!st || !st.adopted) continue;                 // 未领养 / 卸载后键已删
    out.push({ uid: String(rows[i].user_id), name: st.name || '小家伙', bond: st.bond || 0, raw: st });
  }
  shadowCache = { key: today, at: now, rows: out };
  return out;
}
var shadowCache = { key: '', at: 0, rows: null };

// 一次取多个昵称（避免候选一人一次查询）
function nicksOf(uids) {
  var map = {};
  if (!uids.length) return map;
  try {
    var ph = [];
    for (var i = 0; i < uids.length; i++) ph.push('?');
    var rows = db.prepare('SELECT user_id, net_name FROM users WHERE user_id IN (' + ph.join(',') + ')').all.apply(null, uids);
    for (var j = 0; j < rows.length; j++) {
      if (rows[j].net_name) map[String(rows[j].user_id)] = String(rows[j].net_name);
    }
  } catch (e) {}
  return map;
}
function nickOf(uid) { return nicksOf([uid])[String(uid)] || ''; }

// 兜底时最多容忍多大的战力差距。超过这个倍数的对手直接不出现在名单里——
// 打一场必输的仗除了 +3 保底分没有任何意义，反而让人觉得这玩法在欺负人。
var SHADOW_MAX_POWER_RATIO = 2.0;

// 影子对手名单：排除自己、按羁绊 ±30% 收敛，再按 (uid + 日期) 确定性洗牌取前 N 个。
// 「确定性」是刻意的：同一天刷新页面看到的对手不会乱跳，但明天、或换个人就换一批。
function shadowPoolFor(uid, myBond, myType) {
  var all = shadowCandidates();
  var myCombat = combatOf({ bond: myBond || 0 });
  var myPower = powerOf(myCombat);
  var pool = [];
  var others = [];
  for (var i = 0; i < all.length; i++) {
    if (all[i].uid === String(uid)) continue;
    others.push(all[i]);
    if (all[i].bond > Math.round(myBond * 1.3) || all[i].bond < Math.round(myBond * 0.7)) continue;
    pool.push(all[i]);
  }
  // 区间内一个人都没有时（新手 bond 很低、或全班都在另一头），退到「最接近的几个」，
  // 而不是把筛选整个关掉：关掉筛选会让 bond 8 的新手直接对上 bond 101 的宠物。
  // 但也不能无限放宽——差距超过 SHADOW_MAX_POWER_RATIO 倍的直接筛掉，宁可空列表。
  if (!pool.length && others.length) {
    var near = [];
    for (var m = 0; m < others.length; m++) {
      var c = combatOf({ bond: others[m].bond });
      var p = powerOf(c);
      if (myPower > 0 && Math.max(p, myPower) / Math.min(p, myPower) > SHADOW_MAX_POWER_RATIO) continue;
      near.push(others[m]);
    }
    near.sort(function(a, b) { return Math.abs(a.bond - myBond) - Math.abs(b.bond - myBond); });
    pool = near.slice(0, Math.min(SHADOW_POOL_MAX, near.length));
  }
  if (pool.length > SHADOW_POOL_MAX) {
    var rnd = rngFrom(fnv1a([String(uid), todayKey()].join('|')));
    for (var j = pool.length - 1; j > 0; j--) {
      var k = Math.floor(rnd() * (j + 1));
      var t = pool[j]; pool[j] = pool[k]; pool[k] = t;
    }
    pool = pool.slice(0, SHADOW_POOL_MAX);
  }
  var uids = [];
  for (var m = 0; m < pool.length; m++) uids.push(pool[m].uid);
  var nicks = nicksOf(uids);
  var out = [];
  for (var n = 0; n < pool.length; n++) {
    var p = pool[n];
    var c = combatOf({ bond: p.bond });
    var stype = normType(p.raw && p.raw.battle_type);
    out.push({
      id: SHADOW_PREFIX + p.uid, realId: p.uid, kind: 'shadow',
      name: p.name, owner: nicks[p.uid] || '', desc: '',
      bond: p.bond, tierName: c.tierName, power: powerOf(c), hp: c.hp,
      type: stype, typeName: ELEMENTS[stype].name, typeIcon: ELEMENTS[stype].icon,
      typeMul: typeMul(normType(myType), stype),
      odds: oddsOf(myPower, powerOf(c)), oddsText: ODDS_TEXT[oddsOf(myPower, powerOf(c))]
    });
  }
  return out;
}
function parseOppId(s) {
  s = String(s || '');
  if (s.indexOf(SHADOW_PREFIX) === 0) return { kind: 'shadow', uid: s.slice(SHADOW_PREFIX.length) };
  return { kind: 'npc', id: s };
}
// 从「我今天的对手名单」里按 id 取对手：NPC 和影子走同一个出口，
// 所以 /battle/fight 不需要分支判断挑战类型是练

function resolveOpponent(st, uid, oppIdRaw) {
  var req = parseOppId(oppIdRaw);
  if (req.kind === 'npc') {
    var ops = opponentsOf(st);
    for (var j = 0; j < ops.length; j++) if (ops[j].id === req.id) return ops[j];
    return null;
  }
  // 影子走「今天看到的名单」：名单是 (uid + 日期) 确定性洗牌出来的，
  // 同一天进 profile 与 fight 得到同一批人。
  var myType = normType(st && st.battle_type);
  var pool = shadowPoolFor(uid, (st && st.bond) || 0, myType);
  for (var k = 0; k < pool.length; k++) if (pool[k].realId === req.uid) return pool[k];
  // 兜底：对方羁绊刚跨过 ±30% 边界时名单会变，这里直接读一次他的当前状态，
  // 免得「刚点开就在打的人」点下去报未知对手。
  if (!req.uid) return null;
  var defSt = readPet(req.uid);
  if (!defSt || !defSt.adopted) return null;   // 对方刚卸载桌宠
  var dc = combatOf({ bond: defSt.bond || 0 });
  var dType = normType(defSt.battle_type);
  return {
    id: SHADOW_PREFIX + req.uid, realId: req.uid, kind: 'shadow',
    name: defSt.name || '小家伙', owner: nickOf(req.uid) || '', desc: '',
    bond: defSt.bond || 0, tierName: dc.tierName, power: powerOf(dc), hp: dc.hp,
    type: dType, typeName: ELEMENTS[dType].name, typeIcon: ELEMENTS[dType].icon,
    typeMul: typeMul(myType, dType),
    odds: oddsOf(powerOf(combatOf({ bond: (st && st.bond) || 0 })), powerOf(dc)),
    oddsText: ODDS_TEXT[oddsOf(powerOf(combatOf({ bond: (st && st.bond) || 0 })), powerOf(dc))]
  };
}

// ---- 挑战留言：写进被挑战方的宠物存档 ----
// inbox 是「异步多人体验」的全部代价：不想为它单开一张表（market 应用卸载时
// 要自己清干净），直接挂在 desktop_pet 这个键里，卸载时随键一起消失。
function pushInbox(st, item) {
  if (!st.battle_inbox) st.battle_inbox = [];
  st.battle_inbox.unshift(item);
  if (st.battle_inbox.length > SHADOW_INBOX_MAX) st.battle_inbox.length = SHADOW_INBOX_MAX;
}

// 32 位确定性随机（fnv1a 播种 + mulberry32），足够做战报复现，不用于任何安全用途
function fnv1a(str) {
  var h = 2166136261;
  for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function rngFrom(seed) {
  var a = seed >>> 0;
  return function() {
    a = (a + 0x6D2B79F5) | 0;
    var t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ==================== 环境副本（v2.0）====================
// 每周轮换一个战斗环境，全班同步：按周序号取模，不是个人随机。
// 与天气同一条底线：环境不改 seed、不改先手，只在数值层叠固定倍率，同一场重放一致。
var ENVIRONMENTS = {
  wind_valley: {
    id: 'wind_valley', name: '风之峡谷', icon: '🍃',
    effects: { evasion_rate: 1.2, speed_skill_power: 1.5 },
    effectText: '闪避率 +20% · 速度系技能 +50%',
    boss: { name: '风元素精灵', icon: '🌪️', type: 'electric', skills: ['evade', 'finesse', 'lifesteal'],
            desc: '峡谷的风里全是残影，打不中它什么都白搭' },
    rewardItem: 'lightning_stone',
    fit: {
      skills: { evade: 1, finesse: 1 },
      equip: { lightning_stone: 1, wind_charm: 1 },
      types: { electric: 1 }
    }
  },
  magma_cave: {
    id: 'magma_cave', name: '岩浆洞窟', icon: '🔥',
    // doc 原文 fire_skill_power: 1.8 与注释「冷却减半」矛盾：两个都做，
    // 倍率收敛到 1.5（1.8 实测会碾压），冷却按 -1 结算
    effects: { fire_skill_power: 1.5, damage_over_time: true },
    effectText: '火属性伤害 +50% · 主动技能冷却 -1 · 每回合双方灼烧 5% HP',
    boss: { name: '熔岩巨兽', icon: '🌋', type: 'fire', skills: ['smash', 'toughness', 'lifesteal'],
            desc: '洞窟尽头的那团火，砸下去自己也要掉血' },
    rewardItem: 'void_blade',
    fit: {
      skills: { blast: 1, smash: 1, toughness: 1, regen: 1 },
      equip: { void_blade: 1, flame_potion: 1 },
      types: { fire: 1 }
    }
  },
  moon_altar: {
    id: 'moon_altar', name: '月光祭坛', icon: '🌙',
    effects: { night_crit_multiplier: 1.5, healing_bonus: 1.3 },
    effectText: '暴击伤害 +50% · 治疗效果 +30%',
    boss: { name: '月影猎手', icon: '🌙', type: 'water', skills: ['counter', 'aura', 'lifesteal'],
            desc: '你打它的每一拳，都可能有半拳还回来' },
    rewardItem: 'life_orb',
    fit: {
      skills: { sharp: 1, heal: 1, lifesteal: 1 },
      equip: { life_orb: 1, star_hammer: 1 },
      types: { water: 1 }
    }
  }
};
var ENV_IDS = ['wind_valley', 'magma_cave', 'moon_altar'];
var ENV_EPOCH = Date.UTC(2026, 0, 5);   // 2026-01-05（周一）为第 0 周
var ENV_BOSS_DAILY_CAP = 1;
var ENV_BOSS_SCALE = 1.10;              // Boss 属性随玩家羁绊缩放
// Boss 血量独立系数：拉长战局让乘区平均化的旋钮。扫描结论 1.0 最优
//（1.15 会把中坚档胜率压到 22%，见 _tmp-boss-probe 的矩阵），保留做后续调参用。
var ENV_BOSS_HP_MUL = 1.0;
var ENV_BOSS_WIN_POINTS = 8;
var ENV_BOSS_LOSE_POINTS = 2;
var EQUIP_DUST_POINTS = 3;              // 重复装备「分解」的小鱼干

function envWeekIndex(now) {
  return Math.floor(((now || Date.now()) - ENV_EPOCH) / (7 * 86400000));
}
function currentEnvironment(now) {
  var idx = envWeekIndex(now);
  return ENVIRONMENTS[ENV_IDS[((idx % 3) + 3) % 3]];
}
// 环境数值层：给引擎与 battleKitOf 消费的扁平倍率
function envModsOf(env) {
  if (!env) return null;
  var e = env.effects || {};
  return {
    id: env.id,
    evadeMul: e.evasion_rate || 1,
    fireMul: e.fire_skill_power || 1,
    dotPercent: e.damage_over_time ? 0.05 : 0,
    cdBonus: e.fire_skill_power ? 1 : 0,
    critMul: e.night_crit_multiplier || 1,
    healMul: e.healing_bonus || 1
  };
}
// 环境页 / profile 用：把「当前环境 + Boss + 我的进度」打包。Boss 数值按玩家羁绊现算。
function envView(uid, st) {
  var env = currentEnvironment();
  var week = envWeekIndex();
  var boss = env.boss;
  var bossBond = Math.max(4, Math.round(((st && st.bond) || 0) * ENV_BOSS_SCALE));
  var bc = combatOf({ bond: bossBond });
  var prog = (st && st.env_progress) || {};
  var bossWeek = prog.boss_week || {};
  var wins = prog.boss_wins || {};
  var today = todayKey();
  var usedToday = (st && st.env_boss_date === today) ? (st.env_boss_today || 0) : 0;
  var reward = EQUIP_ITEMS[env.rewardItem];
  var nextId = ENV_IDS[(((week + 1) % 3) + 3) % 3];
  return {
    id: env.id, name: env.name, icon: env.icon,
    week: week + 1,
    effectText: env.effectText,
    mods: envModsOf(env),
    boss: {
      name: boss.name, icon: boss.icon || '', desc: boss.desc || '',
      type: boss.type, typeName: ELEMENTS[boss.type].name, typeIcon: ELEMENTS[boss.type].icon,
      bond: bossBond, hp: bc.hp, power: powerOf(bc), skills: boss.skills || []
    },
    reward: reward ? { id: reward.id, name: reward.name, icon: reward.icon } : null,
    firstKillDone: bossWeek[env.id] === week,
    bossWins: wins[env.id] || 0,
    dailyLeft: Math.max(0, ENV_BOSS_DAILY_CAP - usedToday),
    dailyCap: ENV_BOSS_DAILY_CAP,
    next: { id: nextId, name: ENVIRONMENTS[nextId].name, icon: ENVIRONMENTS[nextId].icon, preview: '下周开放' },
    bestScore: prog.best_score || 0
  };
}

// 装备掉落（doc §8 DROP_RATES）。返回掉落的装备 ID 或 null。
// 稀有度先 roll 后挑货：epic 桶里现在有 3 件，roll 到哪件看运气。
var DROP_RATES = [
  { rarity: 'epic', p: 0.05 },
  { rarity: 'rare', p: 0.15 },
  { rarity: 'uncommon', p: 0.30 },
  { rarity: 'common', p: 0.50 }
];
function rollDropItem(rnd) {
  var r = rnd();
  var acc = 0;
  var rarity = 'common';
  for (var i = 0; i < DROP_RATES.length; i++) {
    acc += DROP_RATES[i].p;
    if (r < acc) { rarity = DROP_RATES[i].rarity; break; }
  }
  var pool = [];
  var ids = Object.keys(EQUIP_ITEMS);
  for (var j = 0; j < ids.length; j++) {
    if (EQUIP_ITEMS[ids[j]].rarity === rarity) pool.push(ids[j]);
  }
  if (!pool.length) return null;
  return pool[Math.floor(rnd() * pool.length) % pool.length];
}
// 入库：新装备 → owned + 消耗品按 stack 充能；重复装备 → 分解成小鱼干。
// 返回 { item, duplicate, dust }（item=null 表示没掉东西）。
function grantEquip(st, id) {
  var item = EQUIP_ITEMS[id];
  if (!item) return { item: null, duplicate: false, dust: 0 };
  var inv = inventoryOf(st);
  if (item.type === 'consumable') {
    inv.charges[id] = (inv.charges[id] || 0) + (item.stack || 1);
    return { item: item, duplicate: false, dust: 0 };
  }
  if (inv.owned.indexOf(id) >= 0) {
    return { item: item, duplicate: true, dust: EQUIP_DUST_POINTS };
  }
  inv.owned.push(id);
  return { item: item, duplicate: false, dust: 0 };
}

// 前端视图：当前 Build（技能只列实际生效的；装备原样返回 + 评分/适配度）
function buildViewOf(st) {
  var env = envModsOf(currentEnvironment());
  var k = battleKitOf(st, env, false);
  var build = buildOf(st);
  return {
    skills: k.skills,
    equipment: build.equipment,
    strategy_name: build.strategy_name || '',
    power_score: powerOf(k.combat),
    fitness: buildFitnessOf(st, currentEnvironment()),
    slots: skillSlotsOf(st)
  };
}
// 前端视图：装备库存（owned 出完整物品表）。
// 消耗品不进 owned（用掉即无），有库存的按 charges 单独列出——编辑器靠这个画货架。
function inventoryView(st) {
  var inv = inventoryOf(st);
  var items = [];
  var seen = {};
  for (var i = 0; i < inv.owned.length; i++) {
    var it = EQUIP_ITEMS[inv.owned[i]];
    if (it) {
      seen[it.id] = true;
      items.push({
        id: it.id, name: it.name, icon: it.icon, type: it.type,
        effect: it.effect, rarity: it.rarity,
        charges: it.type === 'consumable' ? (inv.charges[it.id] || 0) : null
      });
    }
  }
  var ids = Object.keys(CONSUMABLES);
  for (var j = 0; j < ids.length; j++) {
    var cid = ids[j];
    var ch = inv.charges[cid] || 0;
    if (seen[cid] || ch <= 0) continue;
    var c2 = CONSUMABLES[cid];
    items.push({ id: c2.id, name: c2.name, icon: c2.icon, type: c2.type,
                 effect: c2.effect, rarity: c2.rarity, charges: ch });
  }
  return { owned: items };
}
// 前端视图：Build 相对裸装的可读增减摘要（编辑器实时预览用）
function kitEffectsView(st) {
  var base = combatOf(st);
  var env = envModsOf(currentEnvironment());
  var k = battleKitOf(st, env, false);
  var c = k.combat;
  function pct(a, b) {
    if (!b) return null;
    var d = Math.round((a - b) / b * 100);
    return d === 0 ? null : (d > 0 ? '+' + d + '%' : d + '%');
  }
  return {
    hp: pct(c.hp, base.hp), atk: pct(c.atk, base.atk),
    def: pct(c.def, base.def), spd: pct(c.spd, base.spd),
    crit: (c.crit - base.crit) || null,
    crit_dmg: c.critMul !== 1 ? '+' + Math.round((c.critMul - 1) * 100) + '%' : null,
    heal: c.healMul !== 1 ? '+' + Math.round((c.healMul - 1) * 100) + '%' : null,
    evade: k.kit.evadeAdd ? '+' + Math.round(k.kit.evadeAdd * 100) + '%' : null
  };
}

// ==================== 默契指令（v0.25.0）====================
// 为什么加这个：v0.24 之前，一场战斗在服务端第 0 帧就演完了，前端只是按 340ms
// 一步把它放出来，玩家唯一能按的键叫「跳过动画」。赢是算出来的，输是注定的——
// 这不是玩法，是录像。
//
// 解法不是把引擎改成实时会话（每回合一个请求、战斗状态入库、断线续战全要重做），
// 而是吃「引擎是 seed 决定的纯函数」这口红利：
//   演算 → 播放中插一条指令 → 用**同一个 seed** 重算 → 快进到打断点接着放。
// 同一场、同一条随机流，只多了一条指令，所以「换一种打法会不会更好」是可比的；
// 而「什么时候按」是玩家的事，不是 seed 的事。
//
// 三条硬约束：
//   1) 指令**不进 seed**（和战术/技能同理），否则换打法连运气一起换掉；
//   2) 指令条数由羁绊决定，服务端钳制，客户端报多少都不认；
//   3) 一个回合只认一条指令；同一回合叠两条直接丢后面的。
var COMMANDS = {
  strike: {
    id: 'strike', name: '全力一击', icon: '💥', word: '豁出去了',
    desc: '这一击 ×1.8，代价是接下来两回合挨打 ×1.25'
  },
  guard: {
    id: 'guard', name: '护住它', icon: '🛡️', word: '挡在它前面',
    desc: '这一击只吃 35% 伤害，但自己这一回合的攻击只剩 75%'
  },
  charge: {
    id: 'charge', name: '憋一发', icon: '✨', word: '深吸一口气',
    desc: '这一回合不出手，下一击 ×1.2 且必定暴击'
  }
};
var COMMAND_IDS = ['strike', 'guard', 'charge'];
// 技能牌（v0.28.2）：装备了的主动技可以由玩家点牌出手。冷却在引擎里逐回合生效。
var MANUAL_SKILL_KINDS = ['blast', 'smash', 'heal'];
// 技能牌视图：从装备表筛出主动技，前端据此渲染「由你出手」的牌
function manualSkillView(skillIds) {
  var out = [];
  var ids = (skillIds && Object.prototype.toString.call(skillIds) === '[object Array]') ? skillIds : [];
  for (var i = 0; i < MANUAL_SKILL_KINDS.length; i++) {
    var id = MANUAL_SKILL_KINDS[i];
    if (ids.indexOf(id) < 0) continue;
    var d = ACTIVE_SKILLS[id];
    if (d) out.push({ id: id, name: d.name, icon: d.icon, cooldown: d.cooldown, desc: d.desc });
  }
  return out;
}

// ---- 战斗会话（open / reroll / settle）----
// 为什么必须延迟结算：玩家要在**播放中**才决定插不插手。如果开战就把药水扣了、
// 败场记了，而他中途关掉页面，这场就变成「扣了东西没结果」。
// 反过来「先演算、后结算」让「中途退出 = 这场没打」成为自然语义，一行回滚代码都不用写。
//
// 会话存在 st.battle_open 里，30 分钟过期。过期后重开会覆盖；
// 因为还没扣过任何东西，所以不存在「白扣一个药水」。
var OPEN_TTL_MS = 30 * 60 * 1000;
function newFightId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}
// 这一场会用掉哪个消耗品（**结算时**才真正扣）。open 与 reroll 必须得到同一个答案，
// 否则重算一次就多吃一个药水。
function consumableInPlay(st) {
  var eq = buildOf(st).equipment || {};
  var id = eq.consumable;
  if (!id || !CONSUMABLES[id]) return null;
  var inv = inventoryOf(st);
  return (inv.charges[id] || 0) > 0 ? id : null;
}
// 结算时扣一个。库存已经在别处被清空（并发/改配置）就静默跳过。
function spendConsumable(st, id) {
  if (!id) return;
  var inv = inventoryOf(st);
  if ((inv.charges[id] || 0) > 0) inv.charges[id] -= 1;
}

// ---- 四个战斗入口共用的小工具 ----
// 每个入口自己拼「最后返回什么」，但「怎么开、怎么接、怎么收」必须是同一套。
function parseFightMode(req) {
  var m = String((req.body && req.body.mode) || '');
  return (m === 'open' || m === 'reroll' || m === 'settle') ? m : 'legacy';
}
// 取会话；拿不到就返回 { err }，调用方直接回错误即可（不在这里写响应，免得各入口文案不一）。
function loadOpen(st, kind, req) {
  var id = String((req.body && req.body.fightId) || '');
  var ob = st.battle_open;
  if (!ob || ob.kind !== kind || !id || ob.id !== id) return { err: 409, ob: null };
  if (Date.now() - (ob.at || 0) > OPEN_TTL_MS) return { err: 410, ob: null };
  return { err: 0, ob: ob };
}
function saveOpen(st, kind, seed, useCons, cmds, r, ref) {
  var id = (st.battle_open && st.battle_open.id) || newFightId();
  st.battle_open = {
    id: id, kind: kind, at: Date.now(), seed: seed, useCons: useCons,
    cmds: cmds, ref: ref || null,
    res: { win: r.win, rounds: r.rounds, hpMe: r.hpMe, hpFoe: r.hpFoe, maxMe: r.maxMe, maxFoe: r.maxFoe }
  };
  return id;
}
// settle 时不重算：把存下来的结果拼成引擎同样的形状（steps 为空，前端此时已经播完）。
function settledRes(ob) {
  return { win: ob.res.win, rounds: ob.res.rounds, hpMe: ob.res.hpMe, hpFoe: ob.res.hpFoe,
           maxMe: ob.res.maxMe, maxFoe: ob.res.maxFoe, steps: [] };
}
// 指令点：羁绊越深，它越信你。2 → 3 的台阶放在「亲密」，和第三个技能槽同档——
// 两处一起涨，玩家能感觉到「关系变好 = 打法变宽」，而不是两个各自为政的进度条。
function cmdSlotsOf(st) {
  var base = tierOf((st && st.bond) || 0) >= 2 ? 3 : 2;
  // 默契铃铛（小卖部 v0.25.0）：今天买过就 +1。花钱买默契，但每天只卖一枚——
  // 「摸得到的上限」：玩家不会为了多一张牌把鱼干刷穿，但攒一枚会有盼头。
  if (st && st.bell_date === todayKey() && (st.bell_bought || 0) > 0) base += 1;
  return base;
}
// 清洗客户端上报的指令：只留合法回合、合法类型、不重复、不超上限。
// ⚠️ 每种指令**每场只能用一次**：三张牌是三选一的口味，不是三份同款弹药。
// 不加这条时实测「三回合全猛攻」把 rival 胜率从 61% 推到 98%，
// 玩家也永远不会去碰另外两张牌——同一种牌能重复，另外两张就永远是摆设。
function sanitizeCmds(raw, max, maxRound, mySkills) {
  if (Object.prototype.toString.call(raw) !== '[object Array]') return [];
  var out = [];
  var seenR = {};
  var seenK = {};
  var tacCount = 0;                        // 默契牌单独计数：额度只属于三张默契牌
  var limit = max > 0 ? max : 0;
  var skills = (mySkills && Object.prototype.toString.call(mySkills) === '[object Array]') ? mySkills : [];
  for (var i = 0; i < raw.length; i++) {
    var c = raw[i] || {};
    var r = parseInt(c.r, 10);
    var k = String(c.kind || '');
    if (!(r >= 1 && r <= (maxRound || BATTLE_MAX_ROUNDS))) continue;
    if (seenR[r]) continue;                 // 一个回合只认一张牌（默契牌/技能牌同权）
    // 默契牌：三种口味各一次，共用额度上限（cmdSlots）
    if (COMMAND_IDS.indexOf(k) >= 0) {
      if (tacCount >= limit) continue;
      if (seenK[k]) continue;
      seenR[r] = 1; seenK[k] = 1; tacCount++;
      out.push({ r: r, kind: k });
      continue;
    }
    // 技能牌（v0.28.2）：爆发冲击/重锤砸击/紧急治疗从 AI 手里还给玩家。
    // 前提是「真的装备了」；冷却由引擎逐回合查（报了没冷却好的会被当普攻略过）。
    // 不占默契额度——它的限制是冷却，不是次数。
    if (MANUAL_SKILL_KINDS.indexOf(k) >= 0) {
      if (skills.indexOf(k) < 0) continue;
      seenR[r] = 1;
      out.push({ r: r, kind: k });
    }
  }
  out.sort(function(x, y) { return x.r - y.r; });
  return out;
}

// 回合制结算：速度高者先手；同速由 seed 决定先后（固定玩家先手对低速度宠物不公平）
//
// 技能全部在这里生效。⚠️ 技能**不进 seed**（和战术同理）：
// 同一场换技能要能对比出「是不是这套更好」。
// 三条要注意的实现细节：
//   1) 吸血按「实际造成的伤害」算，不是按攻击力——否则打高防对手时吸血会虚高
//   2) 护盾是「一次性的」，触发后永久失效（一场只保一条命），且必须在血量归零前判定
//   3) 破甲改的是防御系数（0.6 → 0.6*(1-0.5)），不是直接减防御
//
// v2.0 起支持（第 8 参 extra = { env, myKit, foeKit }）：
//   主动技能（爆发冲击/重锤砸击/紧急治疗）、增益（狂怒/壁垒）、反击/闪避/活力/光环、
//   武器与消耗品的动态效果、环境（火伤/灼烧/闪避/冷却）。
// ⚠️ 随机流守恒：所有新增 rnd() 消耗都以「对应技能/装备/环境存在」为前提——
//    基线 build（⊆5 技能、无装备、无环境）的随机流与 v0.7 逐位一致，
//    _pet-build-selftest.mjs 用同 seed 断言新旧引擎 steps 完全相等。
function simulateBattle(mine, foe, seed, mySkills, foeSkills, foeBuff, types, extra) {
  extra = extra || {};
  var env = extra.env || null;
  var rnd = rngFrom(seed);
  var ms = skillSet(mySkills);
  var fs = skillSet(foeSkills);
  // 属性相克：只改伤害，不改命中/速度。mulMe = 我打他的倍率，mulFoe = 他打我的倍率。
  var myType = normType(types && types.me);
  var foeType = normType(types && types.foe);
  var mulMe = typeMul(myType, foeType);
  var mulFoe = typeMul(foeType, myType);
  // foeBuff：对手的伤害乘区（试炼塔专用）。1 = 无加成。
  // 之所以要这个参数：塔的难度必须是连续值，而属性只能取整（见 towerBuffFor 的注释）。
  var fBuff = typeof foeBuff === 'number' && foeBuff > 0 ? foeBuff : 1;
  // 默契指令：{r, kind} 的数组，只作用于我方（who === 0）。
  var cmdBy = {};
  var cmds = (extra.cmds && Object.prototype.toString.call(extra.cmds) === '[object Array]') ? extra.cmds : [];
  // 今日规则的引擎通道（v0.28.0）：dmgMul（玻璃大炮）/ vampire（血之契约）。
  // 只在有词缀时才生效，无词缀路径的随机流与基线逐位一致（自测基线 [1] 会红）。
  var modsG = extra.mods || {};
  if (modsG.dotPercent && env) env.dotPercent = (env.dotPercent || 0) + modsG.dotPercent;
  // 技能玩家化（v0.28.2）：true = 我方主动技交给玩家点牌，引擎不再代放。
  // 缺省 false——老路径与 v0.7 基线保持「自动放」逐位一致。
  var playerCtl = !!extra.playerCtl;
  for (var ci = 0; ci < cmds.length; ci++) {
    var cc = cmds[ci] || {};
    // 默契牌与技能牌都走「回合预置」通道；合法性已在 sanitize 层验证过
    if (cc.r >= 1 && (COMMAND_IDS.indexOf(cc.kind) >= 0 || MANUAL_SKILL_KINDS.indexOf(cc.kind) >= 0)) {
      cmdBy[cc.r] = cc.kind;
    }
  }

  function mkSide(c, sk, kit) {
    return {
      hp: c.hp, max: c.hp, atk: c.atk, def: c.def, spd: c.spd, crit: c.crit,
      critMul: c.critMul || 1, healMul: c.healMul || 1,
      sk: sk, shield: sk.shield || !!(kit && kit.assistShield), kit: kit || {},
      buffAtk: 1, buffDef: 1, buffTurns: 0,   // 狂怒/壁垒的乘区（回合数每轮结束递减）
      cd: {},                                  // 主动技能冷却
      skipNext: false,                         // 爆发冲击的后摇
      auraDone: false,                         // 斗志光环：本场第一击生效
      evadeStreak: 0,                          // 连续闪避计数（第二次起 +10 个点）
      stunNext: false,                         // 被电矛麻痹：下回合 50% 无法行动
      flameUsed: false,                        // 火焰药水首击一次性
      // ---- 默契指令的回合状态（每回合开始重置）----
      cmd: null,                               // 本回合挂着的指令
      striking: false,                         // 全力一击：本击 ×1.8
      guarding: false,                         // 护住它：本回合受伤 ×0.3
      charging: false,                         // 憋一发：本回合不出手
      charged: false,                          // 憋完了，下一击 ×2.2 必暴
      vulnTurns: 0                             // 全力一击的破防：受到伤害 ×1.25
    };
  }
  var a = mkSide(mine, ms, extra.myKit);
  var b = mkSide(foe, fs, extra.foeKit);
  var first = a.spd === b.spd ? (rnd() < 0.5 ? 0 : 1) : (a.spd > b.spd ? 0 : 1);
  var steps = [];
  var round = 0;

  function pushStep(r, who, obj) {
    obj.r = r; obj.by = who; obj.hpMe = a.hp; obj.hpFoe = b.hp;
    steps.push(obj);
  }
  // 所有回复统一走这里：受治疗加成（生命宝珠/月光祭坛）影响，不能溢出上限
  function healBy(S, who, amount, tag, r) {
    var heal = Math.max(1, Math.round(amount * S.healMul));
    var before = S.hp;
    S.hp = Math.min(S.max, S.hp + heal);
    if (S.hp > before) pushStep(r, who, { heal: S.hp - before, tags: [tag] });
  }
  // 主动技能冷却：岩浆洞窟的「冷却减半」实现为冷却 -1（doc 原文「1.8 倍」与
  // 「冷却减半」自相矛盾，两个都做但倍率收敛到 1.5，见 docs 差异说明）
  function cdOf(id) {
    var base = (ACTIVE_SKILLS[id] && ACTIVE_SKILLS[id].cooldown) || 1;
    return Math.max(1, base - (env && env.cdBonus ? env.cdBonus : 0));
  }

  function strike(atkSide, defSide, who, r, opts) {
    opts = opts || {};

    // 闪避（只判主击；连打的半次、反击不再触发）
    var dodge = (defSide.sk.evade || 0) + (defSide.kit.evadeAdd || 0);
    if (dodge > 0) {
      dodge = dodge * (env && env.evadeMul ? env.evadeMul : 1);
      if (defSide.evadeStreak > 0) dodge = Math.min(0.5, dodge + 0.10);
      if (rnd() < dodge) {
        defSide.evadeStreak++;
        pushStep(r, who, { dmg: 0, crit: false, tags: ['evade'] });
        return;
      }
      defSide.evadeStreak = 0;
    }

    // 破甲：无视对手一部分防御（虚空之刃与之叠加，封顶 60%）。
    // ⚠️ 只做百分比在低防御时会退化成 0（def=3 时 floor(1.8)=floor(1.08)=1），
    //    所以补一个保底增伤；但它是**无条件**生效的，比千钧/连打（有概率和回合限制）
    //    更容易赢，实测在 bond 50 档把 boss 推到 88%。
    //    这里把保底压到攻击力的 6%，让它的定位回到「对付高防御的解法」，
    //    而不是「对所有对手都稳赚」。
    var defCoef = 0.6;
    var pierceBonus = 0;
    var ignore = (atkSide.sk.pierce || 0) + (atkSide.kit.weapon === 'void_blade' ? 0.2 : 0);
    if (ignore > 0) {
      ignore = Math.min(0.6, ignore);
      defCoef = 0.6 * (1 - ignore);
      pierceBonus = Math.max(1, Math.round(atkSide.atk * 0.06));
    }
    // 攻防有效值：狂怒/壁垒的乘区在这里生效；斗志光环只加成本场第一击
    var auraMul = 1;
    if (atkSide.sk.aura > 0 && !atkSide.auraDone) {
      auraMul = atkSide.sk.aura;
      atkSide.auraDone = true;
    }
    var atkEff = Math.round(atkSide.atk * atkSide.buffAtk * auraMul);
    var defEff = Math.floor(defSide.def * defSide.buffDef * defCoef);
    var dmg = Math.max(2, atkEff - defEff + Math.floor(rnd() * 4));
    var crit = rnd() * 100 < atkSide.crit;
    // 蓄力的「必定暴击」只是把结果改成 true，rnd() 照常消耗——
    // 否则带指令的战斗会整体错开随机流，和基线对不上（自测 [11] 会红）。
    if (atkSide.charged) crit = true;
    if (crit) dmg = Math.round(dmg * 1.8 * atkSide.critMul);
    // 破甲的保底增伤放在暴击之后加：放在前面会被 1.8 倍放大，
    // 实测 bond 50 时把 boss 胜率从 79% 推到 89%。
    dmg += pierceBonus;

    var tags = [];
    if (crit) tags.push('crit');

    // 属性相克：在暴击与破甲之后统一乘，避免被暴击放大成「一克制就必赢」。
    // 1.18 / 0.86 是实测过的幅度：够让玩家愿意换本命，又不会让一局变成猜属性。
    var em = who === 0 ? mulMe : mulFoe;
    if (em !== 1) {
      dmg = Math.max(1, Math.round(dmg * em));
      if (em > 1) tags.push('weak'); else tags.push('resist');
    }

    // 岩浆洞窟：火属性伤害 ×1.5（双方同规则——带火本命上场才有意义）
    if (env && env.fireMul && env.fireMul !== 1 &&
        ((who === 0 && myType === 'fire') || (who === 1 && foeType === 'fire'))) {
      dmg = Math.max(1, Math.round(dmg * env.fireMul));
      tags.push('fireup');
    }

    // 塔的伤害乘区：只对手对手（who===1）生效。
    // 这是塔唯一的连续难度旋钮——属性只能取整，取整会把难度压成台阶。
    if (who === 1 && fBuff !== 1) dmg = Math.max(1, Math.round(dmg * fBuff));

    // 今日规则「玻璃大炮」：双方伤害统一 ×dmgMul。放在塔乘区之后、
    // 主动技能之前——它是对称变奏，不该被「乘在哪个系数前」的顺序放大或缩小。
    if (modsG.dmgMul && modsG.dmgMul !== 1) {
      dmg = Math.max(1, Math.round(dmg * modsG.dmgMul));
      tags.push('moddmg');
    }
    // 远征祝福「巨力」：只放大**我方**（who===0）的攻击。祝福是玩家的奖励，
    // 不该同时喂给对手——与 dmgMul（对称变奏）严格区分两条通道。
    if (who === 0 && modsG.myDmgMul && modsG.myDmgMul !== 1) {
      dmg = Math.max(1, Math.round(dmg * modsG.myDmgMul));
      tags.push('modmydmg');
    }

    // 主动技能倍率（爆发冲击/重锤砸击）
    if (opts.mult && opts.mult !== 1) {
      dmg = Math.round(dmg * opts.mult);
      tags.push(opts.tag || 'active');
    }

    // 护住它的代价：防守的那一回合，自己打出去只剩 60%。
    // ⚠️ 这条不能省——省掉之后「三回合全格挡」实测把练习赛推到 99%、boss 推到 39%，
    //    因为玩家只吃减伤、不吃任何代价，格挡就变成了纯粹的数值膨胀。
    if (atkSide.guarding) {
      dmg = Math.max(1, Math.round(dmg * 0.75));
      tags.push('cmd-guard-atk');
    }

    // 全力一击：这一击 ×1.8。放在主动技能之后乘——两个都吃会让「爆发冲击 + 全力一击」
    // 变成 3.6 倍一发秒杀，boss 胜率直接翻倍。
    // ⚠️ vulnTurns 设 3 而不是 2：它在**回合结束**递减，设 2 只能盖住 1 个回合。
    if (atkSide.striking) {
      dmg = Math.round(dmg * 1.8);
      atkSide.vulnTurns = 3;
      tags.push('cmd-strike');
    }
    // 蓄力释放：×1.5。暴击已经在上面的判定里被强制为真，所以实际是 1.5×1.8≈2.7 倍——
    // 原来写 2.2 时实测 2.2×1.8≈4 倍，配合「跳过一回合」的代价仍然把 boss 胜率推到 95%。
    if (atkSide.charged) {
      dmg = Math.round(dmg * 1.2);
      atkSide.charged = false;
      tags.push('cmd-charge');
    }

    // ---- 承受方的默契指令：护住它 / 破防 ----
    // 格挡只挡主击，不挡连打与反击：一次「挡在它前面」是挡一下，不是开无敌，
    // 而且连打/反击各走各的分支，硬塞进去会把伤害公式变成一团没法解释的乘区。
    if (defSide.guarding) {
      dmg = Math.max(1, Math.round(dmg * 0.35));
      tags.push('cmd-guard');
    }
    // 全力一击的代价：接下来两回合挨打 ×1.25（和格挡可以叠加 → 0.375 倍）
    if (defSide.vulnTurns > 0) {
      dmg = Math.max(1, Math.round(dmg * 1.25));
      tags.push('cmd-vuln');
    }

    // 千钧一击：每 3 回合一次重击
    if (atkSide.sk.heavy && r % 3 === 0) {
      dmg = Math.round(dmg * 1.6);
      tags.push('heavy');
    }

    // 火焰药水：首回合伤害 ×2（一次性）
    if (atkSide.kit.flame && !atkSide.flameUsed) {
      atkSide.flameUsed = true;
      dmg = Math.round(dmg * 2);
      tags.push('flame');
    }

    // 泡泡护盾：血量会归零时挡下一半（一次性）
    if (defSide.shield && defSide.hp - dmg <= 0) {
      dmg = Math.max(1, Math.round(dmg * 0.5));
      defSide.shield = false;
      tags.push('shield');
    }

    defSide.hp = Math.max(0, defSide.hp - dmg);
    pushStep(r, who, { dmg: dmg, crit: crit, tags: tags });

    // 重锤砸击的代价：自身掉 15% 最大血（保底 1，不能把自己砸死）
    if (opts.selfPct) {
      var selfDmg = Math.max(1, Math.round(atkSide.max * opts.selfPct));
      atkSide.hp = Math.max(1, atkSide.hp - selfDmg);
      pushStep(r, who, { dmg: selfDmg, self: true, crit: false, tags: ['smashcost'] });
    }

    // 鲸吞：按实际伤害回血，且不能溢出上限。
    // ⚠️ 单纯按伤害百分比会奖励低血量宠物（同样伤害占血量比例更高），
    //    实测 bond 20 时把 boss 胜率推到 90%。加一条「单次回血不超过最大血量 8%」
    //    的上限，让它在高血量时也有意义，低血量时不至于变成无限续航。
    if (atkSide.sk.lifesteal > 0 && dmg > 0 && atkSide.hp > 0) {
      var lsHeal = Math.min(
        Math.round(dmg * atkSide.sk.lifesteal),
        Math.max(1, Math.round(atkSide.max * 0.08))
      );
      healBy(atkSide, who, lsHeal, 'lifesteal', r);
    }

    // 今日规则「血之契约」：攻击方按实际伤害 8% 回血。挂在鲸吞后面——
    // 两者同发时按顺序各自结算，上限规则（不溢出）由 healBy 统一保证。
    if (modsG.vampire > 0 && dmg > 0 && atkSide.hp > 0) {
      healBy(atkSide, who, Math.round(dmg * modsG.vampire), 'modvamp', r);
    }

    // 钝剑：攻击后回复 5% 最大 HP（受治疗加成影响）
    if (atkSide.kit.weapon === 'blunt_sword' && dmg > 0) {
      healBy(atkSide, who, Math.round(atkSide.max * 0.05), 'bluntheal', r);
    }

    // 电矛：30% 概率麻痹。doc 字面是「下回合速度 -50%」，但先手序固定是
    // 可复现性的底线，中途改速度在固定序引擎里没有意义——实现为
    // 「下回合 50% 概率无法行动」，同样是白拿一个回合的差距。
    if (atkSide.kit.weapon === 'electric_lance' && dmg > 0 && defSide.hp > 0) {
      if (rnd() < 0.3) defSide.stunNext = true;
    }

    // 反击领域：受击后 40% 反击（半伤、不暴击、不触发护盾/吸血/反击链）
    if (defSide.sk.counter > 0 && defSide.hp > 0 && dmg > 0 && rnd() < defSide.sk.counter) {
      var cdmg = Math.max(1, Math.round(defSide.atk * 0.5 * defSide.buffAtk));
      atkSide.hp = Math.max(0, atkSide.hp - cdmg);
      pushStep(r, who === 0 ? 1 : 0, { dmg: cdmg, crit: false, tags: ['counter'] });
    }

    // 连打：追加半次攻击（不再触发连打，避免无限链）
    if (atkSide.sk.combo > 0 && defSide.hp > 0 && rnd() < atkSide.sk.combo) {
      var dmg2 = Math.max(1, Math.round(atkSide.atk * 0.5 - defSide.def * defCoef * 0.5));
      if (em !== 1) dmg2 = Math.max(1, Math.round(dmg2 * em));
      defSide.hp = Math.max(0, defSide.hp - dmg2);
      pushStep(r, who, { dmg: dmg2, crit: false, tags: ['combo'] });
    }
  }

  // 一方的整回合行动：麻痹/后摇 → 增益 → 治疗 → 爆发 → 普攻。
  // 主动技能的使用是确定性策略（不掷随机数），否则「AI 会不会放大招」本身变成运气。
  function act(S, D, who, r) {
    if (S.stunNext) {
      S.stunNext = false;
      if (rnd() < 0.5) {
        pushStep(r, who, { skip: true, tags: ['paralyze'] });
        return;
      }
    }
    if (S.skipNext) {
      S.skipNext = false;
      pushStep(r, who, { skip: true, tags: ['skip'] });
      return;
    }
    // 憋一发：这回合不出手，把力气存到下一击。
    // 放在麻痹/后摇之后：动不了的人没资格蓄力（否则「被麻痹反而攒出大招」很荒谬）。
    if (S.charging) {
      S.charging = false;
      S.charged = true;
      pushStep(r, who, { cmd: 'charge', skip: true, tags: ['cmd-charge'] });
      return;
    }
    if (r === 1 && S.sk.berserk) {
      S.buffAtk = 1.5; S.buffDef = 0.7; S.buffTurns = 3;
      pushStep(r, who, { buff: 'berserk', tags: ['berserk'] });
    } else if (r === 1 && S.sk.guard_stance) {
      S.buffDef = 1.4; S.buffTurns = 3;
      pushStep(r, who, { buff: 'guard_stance', tags: ['guard'] });
    }
    // ---- 主动技能（v0.28.2 技能玩家化）----
    // 玩家侧（playerCtl）：爆发冲击/重锤砸击/紧急治疗**不再自动释放**——
    // 它们是玩家手里的技能牌，什么时候按、值不值得按，是战中决策的一部分。
    // 之前自动策略下「AI 第一回合就放大招」，碾压局两回合结束，
    // 玩家原话是「技能还没放就打完了」——技能系统存在感为零。
    // 对手侧照旧自动（NPC 的强度需要它；玩家对手的快照也保留 AI 行为）。
    var manual = who === 0 && !!playerCtl;
    if (manual) {
      // 玩家的技能牌：回合开始预置在 S.cmd 上，条件不满足就当普攻（白按不亏）。
      if (S.cmd === 'heal' && S.sk.heal > 0 && (S.cd.heal || 0) <= 0 && S.hp < S.max) {
        S.cmd = null;
        S.cd.heal = cdOf('heal');
        healBy(S, who, Math.round(S.max * S.sk.heal), 'healskill', r);
        return;
      }
      if (S.cmd === 'blast' && S.sk.blast > 0 && (S.cd.blast || 0) <= 0) {
        S.cmd = null;
        S.cd.blast = cdOf('blast');
        S.skipNext = true;
        strike(S, D, who, r, { mult: S.sk.blast, tag: 'blast' });
        return;
      }
      if (S.cmd === 'smash' && S.sk.smash > 0 && (S.cd.smash || 0) <= 0) {
        S.cmd = null;
        S.cd.smash = cdOf('smash');
        strike(S, D, who, r, { mult: S.sk.smash, tag: 'smash', selfPct: 0.15 });
        return;
      }
    } else {
      if (S.sk.heal > 0 && (S.cd.heal || 0) <= 0 && S.hp < S.max * 0.5) {
        S.cd.heal = cdOf('heal');
        healBy(S, who, Math.round(S.max * S.sk.heal), 'healskill', r);
        return;
      }
      if (S.sk.blast > 0 && (S.cd.blast || 0) <= 0) {
        S.cd.blast = cdOf('blast');
        S.skipNext = true;
        strike(S, D, who, r, { mult: S.sk.blast, tag: 'blast' });
        return;
      }
      if (S.sk.smash > 0 && (S.cd.smash || 0) <= 0) {
        S.cd.smash = cdOf('smash');
        strike(S, D, who, r, { mult: S.sk.smash, tag: 'smash', selfPct: 0.15 });
        return;
      }
    }
    strike(S, D, who, r, {});
  }

  // 回合结束：冷却/增益递减、活力与治愈草回复、恢复药剂（第 1 回合末）、环境灼烧
  function roundEnd(S, who, r) {
    for (var k in S.cd) {
      if (Object.prototype.hasOwnProperty.call(S.cd, k) && S.cd[k] > 0) S.cd[k]--;
    }
    if (S.buffTurns > 0) {
      S.buffTurns--;
      if (S.buffTurns === 0) { S.buffAtk = 1; S.buffDef = 1; }
    }
    // 破防计时（全力一击的代价）。见 strike 里为什么初值是 3。
    if (S.vulnTurns > 0) S.vulnTurns--;
    if (S.hp > 0) {
      var regenPct = (S.sk.regen || 0) + (S.kit.herb ? 0.03 : 0) + (S.kit.assistRegen || 0);
      if (regenPct > 0) healBy(S, who, Math.round(S.max * regenPct), 'regen', r);
      if (S.kit.vial && r === 1) healBy(S, who, Math.round(S.max * 0.4), 'vial', r);
    }
    if (env && env.dotPercent > 0 && S.hp > 0) {
      var dot = Math.max(1, Math.round(S.max * env.dotPercent));
      S.hp = Math.max(0, S.hp - dot);
      pushStep(r, who, { dmg: dot, crit: false, tags: ['dot'] });
    }
  }

  while (a.hp > 0 && b.hp > 0 && round < BATTLE_MAX_ROUNDS) {
    round++;
    // 回合开始先把这一轮的默契指令预置到双方身上，再依次行动。
    // ⚠️ 必须在双方行动**之前**置位：后手方挨打时也要能吃到「护住它」，
    //    否则「对手先手」这一半的情况里格挡完全失效（而且不会报错，只是悄悄没用）。
    var myCmd = cmdBy[round] || null;
    a.cmd = myCmd;
    a.striking = !!(myCmd && myCmd === 'strike');
    a.guarding = !!(myCmd && myCmd === 'guard');
    a.charging = !!(myCmd && myCmd === 'charge');
    b.cmd = null; b.striking = false; b.guarding = false; b.charging = false;
    for (var k = 0; k < 2; k++) {
      var who = (first + k) % 2;               // 0 = 我方，1 = 对手
      var atkSide = who === 0 ? a : b;
      var defSide = who === 0 ? b : a;
      if (atkSide.hp <= 0 || defSide.hp <= 0) continue;
      act(atkSide, defSide, who, round);
      if (defSide.hp <= 0) break;
    }
    // 回合结束效果（灼烧可能致死，交给上面的 while 条件收尾）
    roundEnd(a, 0, round);
    roundEnd(b, 1, round);
  }
  var win;
  if (b.hp <= 0 && a.hp > 0) win = true;
  else if (a.hp <= 0) win = false;
  else win = (a.hp / a.max) > (b.hp / b.max);   // 打满回合数按剩余血量百分比判
  return { win: win, rounds: round, steps: steps, hpMe: a.hp, hpFoe: b.hp, maxMe: a.max, maxFoe: b.max };
}

// ==================== 天气 / 每日任务 / 最近战报（v0.10.0）====================
// 这三样解决同一个问题：每天打开页面只有「喂饭 + 摸头」，没有「今天该干点什么」。
//   - 天气：给当天一个「今天适合带谁上场」的理由。按日期哈希，全班一致，不是个人随机。
//   - 每日任务：把已有的动作（摸摸 / 喂食 / 练习赛 / 爬塔 / 野怪）串成一张当天的小清单。
//   - 战报：让「打过什么」留在页面上，而不是结算完就消失。
//
// ⚠️ 天气不改战斗 seed，也不改「谁先手」的随机流：
//    它在战术之后叠固定加成，同一场重放仍然一致，不会把胜负变成运气游戏。
var WEATHERS = {
  sunny: { id: 'sunny', name: '晴天', icon: '☀️', type: 'fire',     desc: '阳光正好，火属性的孩子格外有劲' },
  rain:  { id: 'rain',  name: '细雨', icon: '🌧️', type: 'water',    desc: '雨声助眠，水属性的孩子更沉得住气' },
  wind:  { id: 'wind',  name: '微风', icon: '🍃', type: 'grass',    desc: '风穿过草地，草属性的孩子脚步更轻' },
  sand:  { id: 'sand',  name: '沙尘', icon: '🌪️', type: 'earth',    desc: '尘土飞扬，土属性的孩子站得更稳' },
  storm: { id: 'storm', name: '雷暴', icon: '⛈️', type: 'electric', desc: '云层带电，电属性的孩子快得看不清' }
};
var WEATHER_IDS = ['sunny', 'rain', 'wind', 'sand', 'storm'];
var WEATHER_ATK = 2;
var WEATHER_SPD = 1;

function weatherOf(dateKey) {
  var key = dateKey || todayKey();
  var pick = WEATHER_IDS[fnv1a('weather|' + key) % WEATHER_IDS.length];
  var w = WEATHERS[pick];
  var e = ELEMENTS[w.type];
  return {
    id: w.id, name: w.name, icon: w.icon, desc: w.desc,
    type: w.type, typeName: e.name, typeIcon: e.icon, typeColor: e.color,
    bonus: { atk: WEATHER_ATK, spd: WEATHER_SPD },
    bonusText: '攻 +' + WEATHER_ATK + ' · 速 +' + WEATHER_SPD
  };
}

// 只有「本命属性与今日天气同系」的一方吃加成。双方同规则：
// 对手也能吃到，所以这不是白送，而是「今天带谁上场更划算」。
// ==================== 士气：心情的战斗面（v0.25.0）====================
// 以前心情只影响「互动大成功的概率」，玩家看不见摸不着——「我把它照顾得很好」
// 这件事，在它最重要的场合（上场打架）没有任何体现。
// 现在心情好 = 士气高涨 = 出战攻击 +8%，照护的回报多一条看得见的路。
// ⚠️ 只加不减：困了/饿了不扣攻击。它们已经让互动收益打折，战斗再罚一次
//    就是双重惩罚——这里的 8% 是「照顾的礼物」，不是「没照顾的罚金」。
function applyMood(c, st, now) {
  var m = moodOf(st, now);
  if (m.tone === 'high') c.atk = Math.round(c.atk * 1.08);
  c.mood = { id: m.id, name: m.name, icon: m.icon, tone: m.tone };
  return c;
}
function applyWeather(c, type, w) {
  if (!w || normType(type) !== w.type) return c;
  return {
    bond: c.bond, tier: c.tier, tierName: c.tierName,
    hp: c.hp, atk: c.atk + WEATHER_ATK, def: c.def,
    spd: c.spd + WEATHER_SPD, crit: c.crit,
    critMul: c.critMul || 1, healMul: c.healMul || 1
  };
}

// 任务池：陪伴组 2 个、对战相关 4 个。每天固定抽「陪伴 1 + 对战 1 + 剩下随机 1」，
// 保证任务里永远有一件「不打架也能做」的事，否则不爱对战的孩子每天都领不到奖励。
var QUESTS = [
  { id: 'care',  group: 'care',   icon: '🤝', title: '陪它一会儿', desc: '摸摸 + 喂食累计 5 次', goal: 5, reward: { bond: 2 } },
  { id: 'feed',  group: 'care',   icon: '🍚', title: '按时开饭',   desc: '喂食 2 次',           goal: 2, reward: { bond: 2 } },
  { id: 'spar',  group: 'battle', icon: '⚔️', title: '活动筋骨',   desc: '练习赛打满 3 场',     goal: 3, reward: { points: 4 } },
  { id: 'win',   group: 'battle', icon: '🏆', title: '赢回来',     desc: '练习赛赢 2 场',       goal: 2, reward: { points: 5 } },
  { id: 'tower', group: 'battle', icon: '🗼', title: '往上爬一层', desc: '挑战试炼塔 1 次',     goal: 1, reward: { points: 3 } },
  { id: 'wild',  group: 'battle', icon: '🌿', title: '去野外看看', desc: '挑战野生精灵 2 次',   goal: 2, reward: { points: 3 } }
];
var QUEST_MAP = {};
for (var qIdx = 0; qIdx < QUESTS.length; qIdx++) QUEST_MAP[QUESTS[qIdx].id] = QUESTS[qIdx];
var QUEST_COUNT = 3;
var QUEST_BONUS = 6;      // 三个全领完的额外奖励，用来收尾「今天都做完了」

function questIdsFor(uid, dateKey) {
  var today = dateKey || todayKey();
  var rnd = rngFrom(fnv1a(['quest', String(uid), today].join('|')));
  var carePool = [], battlePool = [];
  for (var i = 0; i < QUESTS.length; i++) {
    if (QUESTS[i].group === 'care') carePool.push(QUESTS[i].id);
    else battlePool.push(QUESTS[i].id);
  }
  var pickCare = carePool[Math.floor(rnd() * carePool.length) % carePool.length];
  var pickBattle = battlePool[Math.floor(rnd() * battlePool.length) % battlePool.length];
  var rest = [];
  for (var j = 0; j < QUESTS.length; j++) {
    if (QUESTS[j].id !== pickCare && QUESTS[j].id !== pickBattle) rest.push(QUESTS[j].id);
  }
  var pickRest = rest[Math.floor(rnd() * rest.length) % rest.length];
  return [pickCare, pickBattle, pickRest];
}

// 进度全部从「当天计数」现推，不额外存一份进度表：
// 存档里多一个需要加减的字段，就多一处能对不上的地方。
function dayCountOf(st, dateField, countField, today) {
  return (st && st[dateField] === today) ? (st[countField] || 0) : 0;
}
function questProgressOf(st, id, today) {
  var d = today || todayKey();
  var s = st || {};
  if (id === 'care') return s.bond_date === d ? ((s.poked_today || 0) + (s.fed_today || 0)) : 0;
  if (id === 'feed') return s.bond_date === d ? (s.fed_today || 0) : 0;
  if (id === 'spar') return dayCountOf(s, 'battle_date', 'battle_today', d);
  if (id === 'win') return dayCountOf(s, 'battle_date', 'battle_win_today', d);
  if (id === 'tower') return dayCountOf(s, 'tower_date', 'tower_today', d);
  if (id === 'wild') return dayCountOf(s, 'wild_date', 'wild_today', d);
  return 0;
}
function questRewardText(def) {
  if (def.reward && def.reward.bond) return '羁绊 +' + def.reward.bond;
  return '积分 +' + ((def.reward && def.reward.points) || 0);
}
function questsView(uid, st) {
  var today = todayKey();
  var ids = questIdsFor(uid, today);
  var claimed = (st && st.quest_date === today && st.quest_claimed) ? st.quest_claimed : [];
  var list = [];
  var doneCount = 0, claimedCount = 0, pendingCount = 0;
  for (var i = 0; i < ids.length; i++) {
    var def = QUEST_MAP[ids[i]];
    var cur = Math.min(def.goal, questProgressOf(st, def.id, today));
    var done = cur >= def.goal;
    var isClaimed = claimed.indexOf(def.id) >= 0;
    if (done) doneCount++;
    if (isClaimed) claimedCount++;
    if (done && !isClaimed) pendingCount++;
    list.push({
      id: def.id, icon: def.icon, title: def.title, desc: def.desc,
      goal: def.goal, progress: cur, done: done, claimed: isClaimed,
      reward: def.reward, rewardText: questRewardText(def)
    });
  }
  return {
    date: today, list: list, total: ids.length,
    done: doneCount, claimed: claimedCount, pending: pendingCount,
    allDone: doneCount >= ids.length,
    allClaimed: claimedCount >= ids.length,
    bonus: QUEST_BONUS,
    bonusText: '三个都领完再 +' + QUEST_BONUS + ' 积分',
    bonusClaimed: claimedCount >= ids.length
  };
}

// 最近战报只留 8 条：它是「刚才发生了什么」的回顾，不是完整历史。
// 存成纯展示结构（标题 / 副标题 / 胜负 / 得分），前端不需要再拿 id 去查表。
var HISTORY_MAX = 8;
function pushHistory(st, item) {
  st.history = st.history || [];
  st.history.unshift(item);
  if (st.history.length > HISTORY_MAX) st.history = st.history.slice(0, HISTORY_MAX);
}

// 对战面板：战力 / 战绩 / 今日次数 / 可挑战的对手 / 战术 / 成就 / 排行榜
router.get('/battle/profile', requireAuth, function(req, res) {
  var uid = userId(req);
  var st = readPet(uid);
  if (!st || !st.adopted) return res.status(400).json({ code: 400, message: '还未领养宠物' });
  var today = todayKey();
  var used = st.battle_date === today ? (st.battle_today || 0) : 0;
  var c = combatOf(st);
  c.power = powerOf(c);

  var rank = rankOf();
  var myRank = myRankOf(uid, c);
  var myType = normType(st.battle_type);
  var evo = evolutionOf(st);

  res.json({ code: 200, data: {
    combat: c,
    record: st.battles || { total: 0, win: 0, lose: 0, points: 0 },
    today: used,
    cap: BATTLE_DAILY_CAP,
    left: BATTLE_DAILY_CAP ? Math.max(0, BATTLE_DAILY_CAP - used) : -1,
    full: BATTLE_DAILY_CAP ? used >= BATTLE_DAILY_CAP : false,
    opponents: opponentsOf(st),
    shadows: shadowPoolFor(uid, st.bond || 0, myType),
    defend: st.battle_defend || null,
    inbox: st.battle_inbox || [],
    tactics: tacticList(),
    tactic: st.battle_tactic || 'guard',
    skills: skillsOf(st),
    equipped: equippedSkills(st),
    skillSlots: skillSlotsOf(st),
    skillCatalog: skillCatalogOf(st),
    build: buildViewOf(st),
    inventory: inventoryView(st),
    equippedEffects: kitEffectsView(st),
    environment: envView(uid, st),
    evolution: evo,
    elements: elementList(),
    battleType: myType,
    typeInfo: typeInfo(myType),
    dex: dexOf(uid, st),
    tower: towerOf(st),
    expedition: expViewOf(st),
    titles: titlesOf(st),
    achievements: st.achievements || [],
    achievementList: ACHIEVEMENTS,

    rank: rank,
    myRank: myRank,
    assistant: assistantView(st),
    cmdSlots: cmdSlotsOf(st),
    last: st.battle_last || null,
    weather: weatherOf(today),
    quests: questsView(uid, st),
    history: st.history || []
  }});
});

// 领取每日任务奖励：POST /pet/quest/claim { id }
// 只有「今天抽到 + 已完成 + 没领过」三个条件同时成立才发奖。
// 三个全领完额外 +6 分——奖励只发一次，因为它只在第三笔领取时才会被触发。
router.post('/quest/claim', requireAuth, function(req, res) {
  var uid = userId(req);
  var st = readPet(uid);
  if (!st || !st.adopted) return res.status(400).json({ code: 400, message: '还未领养宠物' });
  var today = todayKey();
  if (st.quest_date !== today) { st.quest_date = today; st.quest_claimed = []; }
  st.quest_claimed = st.quest_claimed || [];

  var id = String((req.body && req.body.id) || '');
  var ids = questIdsFor(uid, today);
  if (ids.indexOf(id) < 0) return res.status(400).json({ code: 400, message: '今天的任务里没有这一项' });
  if (st.quest_claimed.indexOf(id) >= 0) return res.status(400).json({ code: 400, message: '这个任务已经领过了' });

  var def = QUEST_MAP[id];
  var progress = questProgressOf(st, id, today);
  if (progress < def.goal) {
    return res.status(400).json({ code: 400, message: '还没做完：' + progress + ' / ' + def.goal });
  }

  var gotBond = 0, gotPoints = 0;
  var tierBefore = st.bond || 0;
  if (def.reward && def.reward.bond) {
    gotBond = def.reward.bond;
    st.bond = (st.bond || 0) + gotBond;
    st.bond_today = (st.bond_today || 0) + gotBond;
  }
  if (def.reward && def.reward.points) {
    gotPoints = def.reward.points;
    st.battles = st.battles || { total: 0, win: 0, lose: 0, points: 0 };
    st.battles.points = (st.battles.points || 0) + gotPoints;
  }

  st.quest_claimed.push(id);
  var bonus = 0;
  if (st.quest_claimed.length >= QUEST_COUNT && st.quest_bonus_date !== today) {
    bonus = QUEST_BONUS;
    st.battles = st.battles || { total: 0, win: 0, lose: 0, points: 0 };
    st.battles.points = (st.battles.points || 0) + bonus;
    st.quest_bonus_date = today;
  }

  st.updated_at = new Date().toISOString();
  writePet(uid, st);
  shadowCache.at = 0;   // 积分变了，榜单缓存要跟着失效

  res.json({ code: 200, data: {
    state: st,
    quests: questsView(uid, st),
    gained: { bond: gotBond, points: gotPoints },
    rewardText: questRewardText(def),
    bonus: bonus,
    tierUp: tierOf(st.bond || 0) > tierOf(tierBefore)
  } });
});

// 我在全班排第几：按「积分 → 胜场 → 战力」同一套规则重算一遍。
// 不塞进 rankOf 是为了排行榜只取前 20，而我的名次可能是第 30。
//
// ⚠️ 自己的数据不能走 60 秒缓存：刚打完一场、积分刚涨，名次却还是旧的，
//    这是最容易被当成「分数没加上」的地方。所以这里对「我」这一行单独实时读。
function myRankOf(uid, myCombat) {
  var uidStr = String(uid);
  var all = shadowCandidates();
  var mySt = readPet(uidStr);
  var list = [];
  var me = null;
  for (var i = 0; i < all.length; i++) {
    var isMe = all[i].uid === uidStr;
    var st = isMe ? (mySt || all[i].raw) : all[i].raw;
    if (!st) continue;
    var rec = st.battles || {};
    var def = st.battle_defend || {};
    var row = {
      uid: all[i].uid,
      points: (rec.points || 0) + (def.points || 0),
      win: rec.win || 0,
      power: powerOf(combatOf(st))
    };
    // 战力按「当前实时属性」算，避免缓存里的旧快照把名次算错
    if (isMe) {
      if (myCombat) row.power = myCombat.power;
      me = row;
    }
    list.push(row);
  }
  // 极端兜底：如果我根本不在名单里（缓存刚建好、我还没被扫到），
  // 至少也要给出一个有效名次，而不是 0——页面上显示「第 0 名」比不给还糟。
  if (!me) {
    var mrec = (mySt && mySt.battles) || {};
    var mdef = (mySt && mySt.battle_defend) || {};
    me = {
      uid: uidStr,
      points: (mrec.points || 0) + (mdef.points || 0),
      win: mrec.win || 0,
      power: myCombat ? myCombat.power : powerOf(combatOf(mySt || {}))
    };
    list.push(me);
  }
  var rank = 1;
  for (var j = 0; j < list.length; j++) {
    var o = list[j];
    if (o === me) continue;
    if (o.points > me.points) rank++;
    else if (o.points === me.points && o.win > me.win) rank++;
    else if (o.points === me.points && o.win === me.win && o.power > me.power) rank++;
  }
  return rank;
}

// 打一场：POST /pet/battle/fight { oppId: 'spar'|'rival'|'boss'|'p:<uid>', tactic?: 'assault'|'guard'|'nimble' }
// NPC 练习赛与真人影子共用同一条结算，区别只在「打完之后要不要给对方留个言」。
router.post('/battle/fight', requireAuth, function(req, res) {
  var uid = userId(req);
  var st = readPet(uid);
  if (!st || !st.adopted) return res.status(400).json({ code: 400, message: '还未领养宠物' });

  var today = todayKey();
  if (st.battle_date !== today) { st.battle_date = today; st.battle_today = 0; st.battle_win_today = 0; }
  // 不设次数上限（BATTLE_DAILY_CAP = 0 表示不限）。
  // 保留这段是为了万一以后要限：改回一个正数就自动生效。
  if (BATTLE_DAILY_CAP > 0 && (st.battle_today || 0) >= BATTLE_DAILY_CAP) {
    return res.status(429).json({ code: 429, message: '今天打满 ' + BATTLE_DAILY_CAP + ' 场啦，明天再来' });
  }

  // ---- 战斗会话（v0.25.0）：open / reroll / settle ----
  // mode 缺省 = 老路径（一次算完 + 立即结算）。老客户端不会因为这次改动卡住。
  var mode = String((req.body && req.body.mode) || '');
  var openId = String((req.body && req.body.fightId) || '');
  var ob = null;
  if (mode === 'reroll' || mode === 'settle') {
    ob = st.battle_open;
    if (!ob || ob.kind !== 'fight' || !openId || ob.id !== openId) {
      return res.status(409).json({ code: 409, message: '这场战斗已经结束了，重新打一场吧' });
    }
    if (Date.now() - (ob.at || 0) > OPEN_TTL_MS) {
      delete st.battle_open;
      writePet(uid, st);
      return res.status(409).json({ code: 409, message: '这一场放太久了，重新打一场吧' });
    }
  }
  // settle 用「会话里记着的那一套指令」，不信客户端这一刻再报一遍——
  // 否则前端漏传一次 cmds，结算出来的就是另一场（而且玩家会看到「赢了却算输」）。
  var cmds = (mode === 'settle' && ob)
    ? (ob.cmds || [])
    : sanitizeCmds(req.body && req.body.cmds, cmdSlotsOf(st), BATTLE_MAX_ROUNDS, equippedSkills(st));

  var opp = ob ? ob.opp : resolveOpponent(st, uid, (req.body && req.body.oppId) || '');
  if (!opp) return res.status(400).json({ code: 400, message: '未知对手' });
  if (!ob && opp.kind === 'shadow' && opp.realId === String(uid)) {
    return res.status(400).json({ code: 400, message: '不能挑战自己的影子' });
  }

  // 战术：没传就沿用上次选的（存档里记住），传了就更新偏好
  var tacticId = (req.body && req.body.tactic) || st.battle_tactic || 'guard';
  if (TACTIC_IDS.indexOf(tacticId) < 0) tacticId = 'guard';
  st.battle_tactic = tacticId;

  // 技能：没传就沿用已装备的（存档里记住）。只认已解锁的，防止改存档带上高级技能。
  if (req.body && req.body.skills && Object.prototype.toString.call(req.body.skills) === '[object Array]') {
    st.battle_skills = req.body.skills.slice(0, skillSlotsOf(st));
  }
  // 存档归一化保留用户原始选择；mySkillIds 解析互斥——牌面/返回体只画真正会生效的技能
  // （v0.28.3 修复：fight 端点之前直接用未解析表，互斥输家也会被画成牌、按了落普攻）
  st.battle_skills = equippedSkills(st);
  var mySkillIds = resolveSkillConflicts(equippedSkills(st));

  var weather = weatherOf(today);
  var env = envModsOf(currentEnvironment());
  var baseMine = combatOf(st);
  var myType = normType(st.battle_type);
  // 我的 Build：技能 + 装备全部生效；消耗品每场扣 1 个（只有真人上场才扣）。
  // ⚠️ v0.25 起这里**不扣**（consume=false）：扣费挪到 settle。battleKitOf 在
  //    consume=false 时依然让消耗品生效（只看库存 > 0），所以战斗强度一点没变。
  var myKit = battleKitOf(st, env, false);
  var useCons = consumableInPlay(st);
  var mine = applyMood(applyWeather(applyTactic(myKit.combat, tacticId), myType, weather), st);
  mine.power = powerOf(mine);
  var foeType = normType(opp.type);
  var foe = applyWeather(combatOf({ bond: opp.bond }), foeType, weather);
  foe.power = powerOf(foe);
  // 对手带的技能：影子会带上他自己的（真实感），NPC 练习赛不带。
  // 影子的装备同样生效（那就是他「长这样」），但消耗品不扣库存——
  // 快照语义：不能替对方做「用掉一个药水」的决定。
  var foeSkillIds = [];
  var foeKit = null;
  if (opp.kind === 'shadow') {
    var dKit = battleKitOf(readPet(opp.realId) || {}, env, false);
    foeSkillIds = dKit.skills;
    foeKit = dKit.kit;
  }

  var rec = st.battles || { total: 0, win: 0, lose: 0, points: 0 };
  rec.total = rec.total || 0;
  rec.win = rec.win || 0;
  rec.lose = rec.lose || 0;
  rec.points = rec.points || 0;
  // 老存档没有这两个字段；首战就输时 best 会一直是 undefined，前端算「最好 4」
  // 时会显示成 NaN，所以这里无条件补 0。
  rec.streak = rec.streak || 0;
  rec.best = rec.best || 0;

  // ⚠️ seed 里不带战术、也不带默契指令：同一对手、同一天、同一场次，换打法要能对比出
  // 「是不是这一招更好」。如果战术/指令进了 seed，每次换打法连运气都换了，玩家永远学不到东西。
  var seed = ob ? ob.seed : fnv1a([uid, opp.id, String(rec.total + 1), today].join('|'));
  // 演算视图：open / reroll 两次返回的形状必须一模一样，否则前端「快进到打断点」
  // 会因为少一个字段而画出另一个舞台。
  function previewData() {
    return {
      win: r.win, rounds: r.rounds, steps: r.steps, seed: seed,
      me: { name: st.name || '小家伙', power: mine.power, hp: r.maxMe, atk: mine.atk, def: mine.def, spd: mine.spd, crit: mine.crit, type: myType, typeName: ELEMENTS[myType].name, typeIcon: ELEMENTS[myType].icon, mood: mine.mood, assist: assistantView(st) || null },
      foe: { name: opp.name, power: foe.power, hp: r.maxFoe, atk: foe.atk, def: foe.def, spd: foe.spd, crit: foe.crit, type: foeType, typeName: ELEMENTS[foeType].name, typeIcon: ELEMENTS[foeType].icon },
      opp: opp,
      types: { me: myType, foe: foeType, mulMe: typeMul(myType, foeType), mulFoe: typeMul(foeType, myType) },
      weather: weather,
      tactic: tacticId,
      skills: mySkillIds,
      foeSkills: foeSkillIds,
      cmdSlots: cmdSlotsOf(st),
      commands: COMMAND_IDS.map(function(id) { return COMMANDS[id]; }),
      manualSkills: manualSkillView(mySkillIds),
      cmds: cmds
    };
  }
  // settle 直接用会话里存下的结果，**不再重算**：从 reroll 到 settle 之间万一
  // 羁绊/装备有变动（另一个标签页在喂食），重算会得出另一场，玩家会看到「赢了算输」。
  var r;
  if (mode === 'settle') {
    r = { win: ob.res.win, rounds: ob.res.rounds, hpMe: ob.res.hpMe, hpFoe: ob.res.hpFoe,
          maxMe: ob.res.maxMe, maxFoe: ob.res.maxFoe, steps: [] };
  } else {
    r = simulateBattle(mine, foe, seed, myKit.skills, foeSkillIds, 1, { me: myType, foe: foeType },
      { env: env, myKit: myKit.kit, foeKit: foeKit, cmds: cmds, playerCtl: mode === 'open' || mode === 'reroll' });
  }

  // 只演算、不落任何副作用：不扣药水、不记战绩、不涨次数、不发成就。
  if (mode === 'open' || mode === 'reroll') {
    var sid = (ob && ob.id) || newFightId();
    st.battle_open = {
      id: sid, kind: 'fight', at: Date.now(), seed: seed,
      useCons: useCons, cmds: cmds, opp: opp,
      res: { win: r.win, rounds: r.rounds, hpMe: r.hpMe, hpFoe: r.hpFoe, maxMe: r.maxMe, maxFoe: r.maxFoe }
    };
    writePet(uid, st);
    var pd = previewData();
    pd.fightId = sid;
    return res.json({ code: 200, data: pd });
  }
  // settle 时才真正扣掉这一场用过的消耗品
  spendConsumable(st, useCons);

  var gamesToday = st.battle_today || 0;
  var baseGain = r.win ? 10 : 3;   // 输了也给保底分，别让玩家觉得白打
  // 次数不限，但积分按当天第几场衰减：前 5 场全额，之后递减到保底。
  // 这样「想打多久打多久」和「榜单不比谁肝」两件事可以同时成立。
  var gain = pointsFor(baseGain, gamesToday);
  var decayed = gain < baseGain;
  var prevPoints = rec.points;
  rec.total += 1;
  if (r.win) {
    rec.win += 1;
    // 连胜是这套玩法里唯一的「长期钩子」：积分只增不减，没有失去感，
    // 而连胜会断，断了才会想再打一次。
    rec.streak = (rec.streak || 0) + 1;
    if (rec.streak > (rec.best || 0)) rec.best = rec.streak;
  } else {
    rec.lose += 1;
    rec.streak = 0;
  }
  rec.points += gain;

  st.battles = rec;
  st.battle_wins = rec.win;
  st.battle_today = (st.battle_today || 0) + 1;
  if (r.win) st.battle_win_today = (st.battle_win_today || 0) + 1;
  st.battle_last = { at: new Date().toISOString(), oppId: opp.id, oppName: opp.name, win: r.win, rounds: r.rounds };
  pushHistory(st, {
    at: st.battle_last.at,
    kind: 'battle',
    win: r.win,
    title: (opp.owner ? opp.owner + ' 的 ' : '') + opp.name,
    sub: '练习赛 · ' + r.rounds + ' 回合',
    gain: gain,
    points: rec.points
  });
  if (opp.kind === 'shadow') st.shadow_fought = (st.shadow_fought || 0) + 1;
  // 胜利才写日记：输了也写会让日记变成战报流水账，而它应该记「今天发生过什么好事」
  if (r.win) diaryPush(st, todayKey(), { k: 'win', n: 1 });

  // ---- 成就判定（在自己存档上，结算完统一 unlock 一次）----
  var wanted = [];
  if (r.win) wanted.push('first_win');
  if (rec.streak >= 3) wanted.push('streak_3');
  if (rec.streak >= 5) wanted.push('streak_5');
  if (r.win && opp.id === 'boss') wanted.push('beat_boss');
  // 用原始战力比（不算战术/装备加成）。⚠️ 之前写成 baseMine.power——combatOf 不带 power
  // 字段，这个成就从来没触发过；这里改成现算。
  if (r.win && powerOf(baseMine) < foe.power) wanted.push('underdog');
  if ((st.shadow_fought || 0) >= 10) wanted.push('shadow_10');
  if (rec.points >= 100) wanted.push('points_100');
  if (rec.total >= 30) wanted.push('veteran_30');
  var fresh = unlock(st, wanted);

  // 结算完成，会话作废。留着会让下一场「重算」打到一场已经记过账的战斗上。
  delete st.battle_open;
  writePet(uid, st);

  // ---- 影子专属：给对方留一条留言，顺便记他自己的「守擂」战绩 ----
  var defended = null;
  if (opp.kind === 'shadow') {
    defended = pushShadowResult(opp, uid, st, r, today);
    // 影子缓存里这份快照可能已经过期（对方刚刚喂食涨了羁绊），下次重新扫
    shadowCache.at = 0;
  }
  // 打完一场，我自己和对方的积分都变了 —— 排行榜缓存必须失效，
  // 否则「刚赢了却看不到自己名次上升」，会被当成分数没加上。
  shadowCache.at = 0;

  res.json({ code: 200, data: {
    win: r.win,
    rounds: r.rounds,
    steps: r.steps,
    seed: seed,
    me: { name: st.name || '小家伙', power: mine.power, hp: r.maxMe, atk: mine.atk, def: mine.def, spd: mine.spd, crit: mine.crit, type: myType, typeName: ELEMENTS[myType].name, typeIcon: ELEMENTS[myType].icon, mood: mine.mood, assist: assistantView(st) || null },
    foe: { name: opp.name, power: foe.power, hp: r.maxFoe, atk: foe.atk, def: foe.def, spd: foe.spd, crit: foe.crit, type: foeType, typeName: ELEMENTS[foeType].name, typeIcon: ELEMENTS[foeType].icon },
    opp: opp,
    types: { me: myType, foe: foeType, mulMe: typeMul(myType, foeType), mulFoe: typeMul(foeType, myType) },
    gain: gain,
    record: rec,
    today: st.battle_today,
    cap: BATTLE_DAILY_CAP,
    full: BATTLE_DAILY_CAP ? st.battle_today >= BATTLE_DAILY_CAP : false,
    baseGain: baseGain,
    decayed: decayed,
    tactic: tacticId,
    skills: mySkillIds,
    manualSkills: manualSkillView(mySkillIds),
    foeSkills: foeSkillIds,
    unlocked: fresh,
    titles: titlesOf(st),
    defended: defended,
    weather: weather,
    cmdSlots: cmdSlotsOf(st),
    commands: COMMAND_IDS.map(function(id) { return COMMANDS[id]; }),
    cmds: cmds,
    quests: questsView(uid, st)
  }});
});

// ==================== 试炼塔开打（v0.7.0）====================
// POST /pet/tower/fight —— 只打「下一层」，不能跳层、不能回头刷。
// 塔也不限次数（TOWER_DAILY_CAP = 0 表示不限）：
// 塔层固定，反复挑战不会变强，唯一真实的门槛是「打不过」。
router.post('/tower/fight', requireAuth, function(req, res) {
  var uid = userId(req);
  var st = readPet(uid);
  if (!st || !st.adopted) return res.status(400).json({ code: 400, message: '还未领养宠物' });

  var today = todayKey();
  if (st.tower_date !== today) { st.tower_date = today; st.tower_today = 0; }
  if (TOWER_DAILY_CAP > 0 && (st.tower_today || 0) >= TOWER_DAILY_CAP) {
    return res.status(429).json({ code: 429, message: '今天爬塔的 ' + TOWER_DAILY_CAP + ' 次机会用完了，明天再来' });
  }

  var cleared = st.tower_floor || 0;
  // v0.25：reroll/settle 用会话里记住的层，不信"此刻的下一层"——
  // 中途在另一个标签页通了关，这里会变成另一层，结算出来的就是别人的战报。
  var mode = parseFightMode(req);
  var ob = null;
  if (mode === 'reroll' || mode === 'settle') {
    var lo = loadOpen(st, 'tower', req);
    if (lo.err) {
      delete st.battle_open;
      writePet(uid, st);
      return res.status(lo.err).json({ code: lo.err, message: '这一层已经打完了，重新挑战吧' });
    }
    ob = lo.ob;
  }
  // 层定义：普通层走塔表；塔打穿（cleared >= 10）后走深渊——
  // 深度 = st.abyss_floor + 1，失败不清零（深渊惩罚的是「上不去」，不是「掉下来」）。
  // reroll/settle 用会话 ref.f 复原层号（11+ 表示深渊），防止中途进度变化拿到另一层。
  var floorDef = null;
  if (ob) {
    floorDef = ob.ref.f > TOWER_FLOORS.length
      ? abyssFloorOf(st, ob.ref.f - TOWER_FLOORS.length)
      : towerFloorOf(ob.ref.f);
  } else {
    floorDef = towerFloorOf(cleared + 1) ||
      (cleared >= TOWER_FLOORS.length ? abyssFloorOf(st, ((st.abyss_floor || 0) + 1)) : null);
  }
  if (!floorDef) return res.status(400).json({ code: 400, message: '塔已经爬完了，你是塔顶传说' });
  // 深渊层的对手属性按深度轮换（打破「全塔土系」的单调，逼你换本命应对）
  var foeType2 = floorDef.type || TOWER_TYPE;
  var isAbyss = !!floorDef.depth;
  var cmds = (mode === 'settle' && ob)
    ? (ob.cmds || [])
    : sanitizeCmds(req.body && req.body.cmds, cmdSlotsOf(st), BATTLE_MAX_ROUNDS, equippedSkills(st));

  var tacticId = (req.body && req.body.tactic) || st.battle_tactic || 'guard';
  if (TACTIC_IDS.indexOf(tacticId) < 0) tacticId = 'guard';
  st.battle_tactic = tacticId;

  var weather = weatherOf(today);
  var env = envModsOf(currentEnvironment());
  // consume=false：扣费挪到 settle，见 /battle/fight 的同名注释
  var myKit = battleKitOf(st, env, false);
  var useCons = consumableInPlay(st);
  var myType = normType(st.battle_type);
  var mine = applyMood(applyWeather(applyTactic(myKit.combat, tacticId), myType, weather), st);
  mine.power = powerOf(mine);
  var foeBond = isAbyss ? abyssFoeBond(st, floorDef.depth) : towerFoeBond(st, floorDef);
  var foe = applyWeather(combatOf({ bond: foeBond }), foeType2, weather);
  // 今日规则（v0.28.0）：双方对称的变奏。必须落在 powerOf 之前，分数才和强度一致。
  var dailyMods = dailyModsOf(today);
  var modCh = applyDailyMods(mine, foe, dailyMods);
  mine.power = powerOf(mine);
  foe.power = powerOf(foe);
  var foeBuff = isAbyss ? abyssBuffFor(floorDef.depth) : towerBuffFor(st, floorDef);

  // seed 带上「这一层已经试了多少次」：同一层反复挑战会拿到不同的随机流，
  // 否则「打不过就是永远打不过」，反复尝试没有任何意义。
  // 但同一次的结果依然可复现（相同 uid + 层 + 次数 + 日期 → 相同战报）。
  // ⚠️ 递增挪到 settle：reroll 一次就多算一次「试过」，同一次战斗会被洗成另一场。
  var tries = (st.tower_tries && st.tower_tries[String(floorDef.f)]) || 0;

  var seed = ob ? ob.seed : fnv1a([uid, 'tower', String(floorDef.f), String(tries), today].join('|'));
  var r;
  if (mode === 'settle') {
    r = settledRes(ob);
  } else {
    r = simulateBattle(mine, foe, seed, myKit.skills, floorDef.skills || [], foeBuff, { me: myType, foe: foeType2 },
      { env: env, myKit: myKit.kit, cmds: cmds, mods: modCh, playerCtl: mode === 'open' || mode === 'reroll' });
  }

  // 只演算：不涨次数、不推进层数、不发成就
  if (mode === 'open' || mode === 'reroll') {
    var sid = saveOpen(st, 'tower', seed, useCons, cmds, r, { f: floorDef.f });
    writePet(uid, st);
    return res.json({ code: 200, data: {
      win: r.win, rounds: r.rounds, steps: r.steps, seed: seed, fightId: sid,
      floor: floorDef.f, cleared: false, abyss: floorDef.depth || null,
      me: { name: st.name || '小家伙', power: mine.power, hp: r.maxMe, atk: mine.atk, def: mine.def, spd: mine.spd, crit: mine.crit, type: myType, typeName: ELEMENTS[myType].name, typeIcon: ELEMENTS[myType].icon, mood: mine.mood, assist: assistantView(st) || null },
      foe: { name: floorDef.name, power: foe.power, hp: r.maxFoe, atk: foe.atk, def: foe.def, spd: foe.spd, crit: foe.crit, skills: floorDef.skills || [], type: foeType2, typeName: ELEMENTS[foeType2].name, typeIcon: ELEMENTS[foeType2].icon },
      types: { me: myType, foe: foeType2, mulMe: typeMul(myType, foeType2), mulFoe: typeMul(foeType2, myType) },
      skills: myKit.skills, foeSkills: floorDef.skills || [],
      manualSkills: manualSkillView(myKit.skills),
      towerFloor: st.tower_floor || 0, towerTotal: TOWER_FLOORS.length, towerPoints: st.tower_points || 0,
      today: st.tower_today || 0, cap: TOWER_DAILY_CAP,
      dailyMods: dailyMods.map(function(m) { return { id: m.id, name: m.name, icon: m.icon, text: m.text }; }),
      cmdSlots: cmdSlotsOf(st), commands: COMMAND_IDS.map(function(id) { return COMMANDS[id]; }), cmds: cmds,
      weather: weather
    }});
  }

  // ---- settle：到这里才动存档 ----
  spendConsumable(st, useCons);
  st.tower_tries = st.tower_tries || {};
  st.tower_tries[String(floorDef.f)] = tries + 1;
  st.tower_today = (st.tower_today || 0) + 1;

  var clearedNow = false;
  var gateOpened = false;
  var gain = 0;
  var fresh = [];
  if (r.win) {
    clearedNow = true;
    if (isAbyss) {
      // 深渊：推进深度、积分按深度指数给（进塔积分池 = 自动进榜）。
      gain = abyssClearGain(floorDef.depth);
      st.abyss_floor = floorDef.depth;
      var abyssWins = [];
      if (floorDef.depth >= 3) abyssWins.push('abyss_3');
      if (floorDef.depth >= 7) abyssWins.push('abyss_7');
      if (floorDef.depth >= 12) abyssWins.push('abyss_12');
      fresh = unlock(st, abyssWins);
    } else {
      gain = TOWER_CLEAR_GAIN;
      st.tower_floor = floorDef.f;
      st.tower_best = Math.max(st.tower_best || 0, floorDef.f);
      // 塔层里程碑：3/6/10 层各一个，给「爬到哪了」一个说法
      var towerWins = [];
      if (floorDef.f >= 3) towerWins.push('tower_3');
      if (floorDef.f >= 6) towerWins.push('tower_6');
      if (floorDef.f >= 10) towerWins.push('tower_10');
      fresh = unlock(st, towerWins);
      // 仪式点：首次登顶的那一场，前端要给「深渊之门开启」一个独立的高亮行——
      // 这是整个游戏最大的内容门槛，值得一句自己的台词，而不是混在通用结算里。
      gateOpened = floorDef.f >= TOWER_FLOORS.length;
    }
    // 塔的积分单独记：练习赛积分是社交货币（要跟同学比），
    // 塔是线性进度，两条线混在一个数字里会让人看不懂自己到底在比什么。
    st.tower_points = (st.tower_points || 0) + gain;
  }
  st.tower_last = { at: new Date().toISOString(), f: floorDef.f, win: r.win, rounds: r.rounds,
                    abyss: floorDef.depth || null };
  pushHistory(st, {
    at: st.tower_last.at,
    kind: 'tower',
    win: r.win,
    title: (isAbyss ? '深渊第 ' + floorDef.depth + ' 层 · ' : '第 ' + floorDef.f + ' 层 · ') + floorDef.name,
    sub: (isAbyss ? '深渊 · ' : '试炼塔 · ') + r.rounds + ' 回合',
    gain: gain,
    points: st.tower_points || 0
  });
  // 结算完成，会话作废
  delete st.battle_open;
  writePet(uid, st);
  // 塔积分也会进榜，所以同样要失效缓存
  shadowCache.at = 0;

  res.json({ code: 200, data: {
    win: r.win,
    floor: floorDef.f,
    cleared: clearedNow,
    abyss: floorDef.depth || null,
    gateOpened: gateOpened,
    rounds: r.rounds,
    steps: r.steps,
    seed: seed,
    me: { name: st.name || '小家伙', power: mine.power, hp: r.maxMe, atk: mine.atk, def: mine.def, spd: mine.spd, crit: mine.crit, type: myType, typeName: ELEMENTS[myType].name, typeIcon: ELEMENTS[myType].icon, mood: mine.mood, assist: assistantView(st) || null },
    foe: { name: floorDef.name, power: foe.power, hp: r.maxFoe, atk: foe.atk, def: foe.def, spd: foe.spd, crit: foe.crit, skills: floorDef.skills || [], type: foeType2, typeName: ELEMENTS[foeType2].name, typeIcon: ELEMENTS[foeType2].icon },
    types: { me: myType, foe: foeType2, mulMe: typeMul(myType, foeType2), mulFoe: typeMul(foeType2, myType) },
    gain: gain,
    today: st.tower_today,
    cap: TOWER_DAILY_CAP,
    towerFloor: st.tower_floor || 0,
    towerTotal: TOWER_FLOORS.length,
    abyssFloor: st.abyss_floor || 0,
    towerPoints: st.tower_points || 0,
    skills: myKit.skills,
    manualSkills: manualSkillView(myKit.skills),
    foeSkills: floorDef.skills || [],
    unlocked: fresh,
    titles: titlesOf(st),
    weather: weather,
    dailyMods: dailyMods.map(function(m) { return { id: m.id, name: m.name, icon: m.icon, text: m.text }; }),
    cmdSlots: cmdSlotsOf(st),
    commands: COMMAND_IDS.map(function(id) { return COMMANDS[id]; }),
    cmds: cmds,
    quests: questsView(uid, st)
  }});
});

// 给被挑战方记账：只写 inbox + 独立的「守擂」记录。
// ⚠️ 刻意不动他的 battles.win/lose/points —— 那是他自己打出来的战绩，
//    让别人代笔会造成「刷分 / 被操纵」，他回头翻自己的战绩也会不明所以。
function pushShadowResult(opp, challengerUid, challengerSt, r, today) {
  var dSt = readPet(opp.realId);
  if (!dSt || !dSt.adopted) return null;          // 对方期间卸载了桌宠：这场依然有效，只是没人收到
  var def = dSt.battle_defend || { total: 0, held: 0, broken: 0, points: 0 };
  def.total = (def.total || 0) + 1;
  var held = !r.win;                              // 站在对方视角：挑战者输了 = 他守住了
  if (held) def.held = (def.held || 0) + 1; else def.broken = (def.broken || 0) + 1;
  var dGain = held ? SHADOW_DEFEND_WIN : SHADOW_DEFEND_LOSE;  // 被击败也给保底：挨打不是他的错
  def.points = (def.points || 0) + dGain;
  dSt.battle_defend = def;

  pushInbox(dSt, {
    at: new Date().toISOString(),
    date: today,
    uid: String(challengerUid),
    who: challengerSt.name || '小家伙',
    whoOwner: nickOf(String(challengerUid)) || '',
    held: held,
    rounds: r.rounds
  });

  // 守擂的人也在「玩」，所以成就同样要判：被打 5 次守住 5 次也是本事。
  var wanted = [];
  if (def.held >= 5) wanted.push('held_5');
  var fresh = unlock(dSt, wanted);

  writePet(opp.realId, dSt);
  return { name: opp.name, held: held, gain: dGain, unlocked: fresh };
}

// 装备技能：POST /pet/battle/skills { skills: ['heavy','shield'] }
// 只接受已解锁的；超出槽位截断。返回最终生效的组合，前端据此渲染。
router.post('/battle/skills', requireAuth, function(req, res) {
  var uid = userId(req);
  var st = readPet(uid);
  if (!st || !st.adopted) return res.status(400).json({ code: 400, message: '还未领养宠物' });
  var want = (req.body && req.body.skills) || [];
  if (Object.prototype.toString.call(want) !== '[object Array]') {
    return res.status(400).json({ code: 400, message: '技能列表格式不对' });
  }
  st.battle_skills = want.slice(0, skillSlotsOf(st));
  var finalIds = equippedSkills(st);   // equippedSkills 会剔掉未解锁的、并自动补齐
  st.battle_skills = finalIds;
  buildOf(st).skills = finalIds;       // 同步 battle_build.skills 镜像（分享码编码用）
  writePet(uid, st);
  res.json({ code: 200, data: { equipped: finalIds, skills: skillsOf(st), build: buildViewOf(st) } });
});

// ==================== 野生精灵（v0.8.0）====================
// 打野生精灵不消耗练习赛次数，也不涨战力积分：它是「收集」不是「排位」。
// 赢了才有收服判定；输了只是没打过，不掉任何东西。
router.post('/wild/fight', requireAuth, function(req, res) {
  var uid = userId(req);
  var st = readPet(uid);
  if (!st || !st.adopted) return res.status(400).json({ code: 400, message: '还未领养宠物' });

  var mode = parseFightMode(req);
  var ob = null;
  if (mode === 'reroll' || mode === 'settle') {
    var lo = loadOpen(st, 'wild', req);
    if (lo.err) {
      delete st.battle_open;
      writePet(uid, st);
      return res.status(lo.err).json({ code: lo.err, message: '这一场已经结束了，重新找它吧' });
    }
    ob = lo.ob;
  }
  var cmds = (mode === 'settle' && ob)
    ? (ob.cmds || [])
    : sanitizeCmds(req.body && req.body.cmds, cmdSlotsOf(st), BATTLE_MAX_ROUNDS, equippedSkills(st));

  var w = ob ? wildById(ob.ref.w) : wildById(req.body && req.body.id);
  if (!w) return res.status(400).json({ code: 400, message: '未知的野生精灵' });
  // 只有新开这一场才拦「已经收过」；reroll/settle 时它本来就在图鉴里（或不在），
  // 再判一次会让刚刚收服成功的那一场结算不了。
  if (!ob && ownedMap(st)[w.id]) return res.status(400).json({ code: 400, message: '这只已经在你的图鉴里了' });

  var today = todayKey();
  if (st.wild_date !== today) { st.wild_date = today; st.wild_today = 0; }

  var tacticId = (req.body && req.body.tactic) || st.battle_tactic || 'guard';
  if (TACTIC_IDS.indexOf(tacticId) < 0) tacticId = 'guard';
  st.battle_tactic = tacticId;

  var weather = weatherOf(today);
  var env = envModsOf(currentEnvironment());
  var myKit = battleKitOf(st, env, false);
  var useCons = consumableInPlay(st);
  var myType = normType(st.battle_type);
  var mine = applyMood(applyWeather(applyTactic(myKit.combat, tacticId), myType, weather), st);
  mine.power = powerOf(mine);
  var foe = applyWeather(combatOf({ bond: w.bond }), w.type, weather);
  foe.power = powerOf(foe);

  // ⚠️ 递增挪到 settle：reroll 一次就多算一次「找过它」，同一次遭遇会被洗成另一场。
  st.wild_tries = st.wild_tries || {};
  var tries = st.wild_tries[w.id] || 0;
  // 每次尝试都换一条随机流：同一只怪反复挑战不会永远同一个结果，
  // 但同一次尝试仍可复现（uid + 怪 + 第几次 + 日期）。
  var seed = ob ? ob.seed : fnv1a([uid, 'wild', w.id, String(tries), today].join('|'));

  var spot = spotlightOf(uid, st);
  var chance = captureChanceOf(st, w, spot);
  var r;
  if (mode === 'settle') {
    r = settledRes(ob);
  } else {
    r = simulateBattle(mine, foe, seed, myKit.skills, w.skills || [], 1, { me: myType, foe: w.type },
      { env: env, myKit: myKit.kit, cmds: cmds, playerCtl: mode === 'open' || mode === 'reroll' });
  }

  // 只演算：不抓、不掉、不涨次数、进不了图鉴
  if (mode === 'open' || mode === 'reroll') {
    var sid = saveOpen(st, 'wild', seed, useCons, cmds, r, { w: w.id });
    writePet(uid, st);
    return res.json({ code: 200, data: {
      win: r.win, rounds: r.rounds, steps: r.steps, seed: seed, fightId: sid,
      captured: false, buddySet: false, nextChance: null, drop: null,
      chance: chance,
      me: { name: st.name || '小家伙', power: mine.power, hp: r.maxMe, atk: mine.atk, def: mine.def, spd: mine.spd, crit: mine.crit, type: myType, typeName: ELEMENTS[myType].name, typeIcon: ELEMENTS[myType].icon, mood: mine.mood, assist: assistantView(st) || null },
      foe: { name: w.name, power: foe.power, hp: r.maxFoe, atk: foe.atk, def: foe.def, spd: foe.spd, crit: foe.crit, type: w.type, typeName: ELEMENTS[w.type].name, typeIcon: ELEMENTS[w.type].icon },
      creature: wildPublic(w),
      dexCount: (st.dex || []).length, dexTotal: WILD.length,
      types: { me: myType, foe: w.type, mulMe: typeMul(myType, w.type), mulFoe: typeMul(w.type, myType) },
      skills: myKit.skills, manualSkills: manualSkillView(myKit.skills),
      cmdSlots: cmdSlotsOf(st), commands: COMMAND_IDS.map(function(id) { return COMMANDS[id]; }), cmds: cmds,
      weather: weather
    }});
  }

  // ---- settle：到这里才动存档 ----
  spendConsumable(st, useCons);
  st.wild_tries[w.id] = tries + 1;
  st.wild_fights = (st.wild_fights || 0) + 1;
  st.wild_today = (st.wild_today || 0) + 1;
  var captured = false;
  var buddySet = false;
  var fresh = [];
  var nextChance = null;
  var drop = null;

  if (r.win) {
    // 掉落随机流也独立成一条：掉不掉装备和「这只怪今天给不给收服」互不干扰，
    // 玩家不会研究出「用什么阵容能同时提高两样」的玄学。
    // 重复装备直接分解成小鱼干（装备满背包没有意义，给点零钱更实在）。
    var dropRoll = rngFrom(fnv1a([uid, 'drop', w.id, String(tries), today].join('|')));
    if (dropRoll() < WILD_DROP_CHANCE) {
      var got = grantEquip(st, rollDropItem(dropRoll));
      if (got.item) {
        drop = { id: got.item.id, name: got.item.name, icon: got.item.icon,
                 duplicate: got.duplicate, dust: got.dust };
        if (got.dust) st.coins = (st.coins || 0) + got.dust;
      }
    }
    // 捕捉随机流和战斗随机流分开：换战术/换技能不会改变「这只怪今天给不给」，
    // 否则玩家会开始研究「用什么阵容才能刷出高捕捉率」——那不是收集，是玄学。
    var cr = rngFrom(fnv1a([uid, 'capture', w.id, String(tries), todayKey()].join('|')))();
    captured = cr < chance;
    if (captured) {
      st.dex = st.dex || [];
      st.dex.push(w.id);
      st.dex_count = st.dex.length;
      if (st.wild_fails) delete st.wild_fails[w.id];
      // 第一只自动随行：新手不用先学「随行」这个概念，先让他看到收益
      if (!st.buddy) { st.buddy = w.id; buddySet = true; }
      var wanted = ['dex_1'];
      if (st.dex.length >= 5) wanted.push('dex_5');
      if (st.dex.length >= 15) wanted.push('dex_15');
      fresh = unlock(st, wanted);
    } else {
      st.wild_fails = st.wild_fails || {};
      st.wild_fails[w.id] = (st.wild_fails[w.id] || 0) + 1;
      nextChance = captureChanceOf(st, w, spot);
    }
  }

  st.wild_last = { at: new Date().toISOString(), id: w.id, win: r.win, captured: captured, rounds: r.rounds };
  pushHistory(st, {
    at: st.wild_last.at,
    kind: 'wild',
    win: r.win,
    title: w.name,
    sub: '野外 · ' + r.rounds + ' 回合' + (captured ? ' · 已收服' : (r.win ? ' · 跑掉了' : ' · 没打过')),
    gain: 0,
    points: (st.battles && st.battles.points) || 0
  });
  if (captured) diaryPush(st, todayKey(), { k: 'capture', n: 1 });
  delete st.battle_open;
  writePet(uid, st);
  shadowCache.at = 0;   // 随行会让战力变化，排行榜缓存要跟着失效

  res.json({ code: 200, data: {
    win: r.win,
    captured: captured,
    buddySet: buddySet,
    chance: chance,
    nextChance: nextChance,
    rounds: r.rounds,
    steps: r.steps,
    seed: seed,
    me: { name: st.name || '小家伙', power: mine.power, hp: r.maxMe, atk: mine.atk, def: mine.def, spd: mine.spd, crit: mine.crit, type: myType, typeName: ELEMENTS[myType].name, typeIcon: ELEMENTS[myType].icon, mood: mine.mood, assist: assistantView(st) || null },
    foe: { name: w.name, power: foe.power, hp: r.maxFoe, atk: foe.atk, def: foe.def, spd: foe.spd, crit: foe.crit, type: w.type, typeName: ELEMENTS[w.type].name, typeIcon: ELEMENTS[w.type].icon },
    creature: wildPublic(w),
    drop: drop,
    dexCount: (st.dex || []).length,
    dexTotal: WILD.length,
    skills: myKit.skills,
    manualSkills: manualSkillView(myKit.skills),
    unlocked: fresh,
    types: { me: myType, foe: w.type, mulMe: typeMul(myType, w.type), mulFoe: typeMul(w.type, myType) },
    weather: weather,
    cmdSlots: cmdSlotsOf(st),
    commands: COMMAND_IDS.map(function(id) { return COMMANDS[id]; }),
    cmds: cmds,
    quests: questsView(uid, st)
  }});
});

// 选一只已收服的随行：POST /pet/buddy { id }（id 为空 = 取消随行）
router.post('/buddy', requireAuth, function(req, res) {
  var uid = userId(req);
  var st = readPet(uid);
  if (!st || !st.adopted) return res.status(400).json({ code: 400, message: '还未领养宠物' });
  var id = String((req.body && req.body.id) || '');
  if (id) {
    if (!wildById(id)) return res.status(400).json({ code: 400, message: '未知的野生精灵' });
    if (!ownedMap(st)[id]) return res.status(400).json({ code: 400, message: '还没有收服这只，不能随行' });
  }
  st.buddy = id;
  writePet(uid, st);
  shadowCache.at = 0;
  var c = combatOf(st);
  c.power = powerOf(c);
  res.json({ code: 200, data: {
    buddy: buddyPublic(st), buddyBonus: buddyBonusOf(st),
    combat: c, evolution: evolutionOf(st)
  }});
});

// ==================== 助战（v0.25.0）：图鉴的第二种用法 ====================
// 收服的野怪以前只有一种用法：看图鉴条目、选一只随行。收第 8 只的意义只剩
// 「图鉴 8/24」。助战给它们一个岗位：一只已收服的野怪可以站在场边，
// 按自己的系别给本命一个**永久的小加成**——火加攻、水回血、草护盾、电加暴击、土加防。
// 一个格子、随时可换、战斗前在图鉴里点一下就生效。收集于是有了第二种理由。
var ASSIST_BONUS = {
  fire:     { text: '攻击 +5%' },
  water:    { text: '每回合回 1.5% 血' },
  grass:    { text: '血量见底时挡一半（一次）' },
  electric: { text: '暴击率 +5' },
  earth:    { text: '防御 +10%' }
};
function assistantView(st) {
  var id = st && st.assistant;
  if (!id) return null;
  var w = wildById(id);
  if (!w) return null;
  var bonus = ASSIST_BONUS[w.type] || { text: '' };
  return { id: w.id, name: w.name, icon: w.icon, type: w.type,
           typeName: ELEMENTS[w.type].name, typeIcon: ELEMENTS[w.type].icon, bonusText: bonus.text };
}
router.post('/assistant', requireAuth, function(req, res) {
  var uid = userId(req);
  var st = readPet(uid);
  if (!st || !st.adopted) return res.status(400).json({ code: 400, message: '还未领养宠物' });
  var id = String((req.body && req.body.id) || '');
  if (id) {
    if (!wildById(id)) return res.status(400).json({ code: 400, message: '未知的野生精灵' });
    if (!ownedMap(st)[id]) return res.status(400).json({ code: 400, message: '还没有收服这只，不能助战' });
    st.assistant = id;
  } else {
    st.assistant = null;
  }
  writePet(uid, st);
  shadowCache.at = 0;   // 助战会改战力，排行榜缓存跟着失效
  res.json({ code: 200, data: { assistant: assistantView(st) } });
});

// 本命属性：POST /pet/battle/type { type }
// 免费改、随时改——属性克制是「读对手后的选择」，收费会让它变成一次性的错误。
router.post('/battle/type', requireAuth, function(req, res) {
  var uid = userId(req);
  var st = readPet(uid);
  if (!st || !st.adopted) return res.status(400).json({ code: 400, message: '还未领养宠物' });
  var type = String((req.body && req.body.type) || '');
  if (!ELEMENTS[type]) return res.status(400).json({ code: 400, message: '未知属性' });
  st.battle_type = type;
  writePet(uid, st);
  res.json({ code: 200, data: {
    battleType: type,
    typeInfo: typeInfo(type),
    opponents: opponentsOf(st),
    shadows: shadowPoolFor(uid, st.bond || 0, type)
  }});
});

// 清空挑战留言：POST /pet/battle/inbox/read
// 前端展开 inbox 后调一次，避免同一批留言每次进页面都亮着红点。
router.post('/battle/inbox/read', requireAuth, function(req, res) {
  var st = readPet(userId(req));
  if (!st || !st.adopted) return res.status(400).json({ code: 400, message: '还未领养宠物' });
  st.battle_inbox = [];
  writePet(userId(req), st);
  res.json({ code: 200, data: { ok: true } });
});

// ==================== Build API（v2.0，doc §6）====================
// 反作弊边界：战力评分/适配度全部服务端现算，客户端只传「配置」，不传任何数值。

// 当前 Build 配置 + 技能目录 + 装备库存（编辑器一次拉全）
router.get('/battle/build', requireAuth, function(req, res) {
  var uid = userId(req);
  var st = readPet(uid);
  if (!st || !st.adopted) return res.status(400).json({ code: 400, message: '还未领养宠物' });
  res.json({ code: 200, data: {
    build: buildViewOf(st),
    inventory: inventoryView(st),
    skillCatalog: skillCatalogOf(st),
    equippedEffects: kitEffectsView(st)
  }});
});

// 更新 Build：{ skills: [...], equipment: { weapon, accessory, consumable }, strategy_name }
// 技能只收「已解锁 + 槽位内」（与 /battle/skills 同语义）；装备必须已拥有；
// 消耗品库存为 0 时不能装（装了也是空槽，不如直接拒绝，让前端提示去刷掉落）。
router.post('/battle/build/update', requireAuth, function(req, res) {
  var uid = userId(req);
  var st = readPet(uid);
  if (!st || !st.adopted) return res.status(400).json({ code: 400, message: '还未领养宠物' });
  var body = req.body || {};
  var build = buildOf(st);
  var inv = inventoryOf(st);

  if (body.skills !== undefined) {
    if (Object.prototype.toString.call(body.skills) !== '[object Array]') {
      return res.status(400).json({ code: 400, message: '技能列表格式不对' });
    }
    st.battle_skills = body.skills.slice(0, skillSlotsOf(st));
  }
  if (body.equipment !== undefined) {
    if (!body.equipment || typeof body.equipment !== 'object') {
      return res.status(400).json({ code: 400, message: '装备配置格式不对' });
    }
    var eq = {};
    var w = body.equipment.weapon;
    if (w) {
      if (!WEAPONS[w] || inv.owned.indexOf(w) < 0) {
        return res.status(400).json({ code: 400, message: '武器还没拿到：' + w });
      }
      eq.weapon = w;
    }
    var a = body.equipment.accessory;
    if (a) {
      if (!ACCESSORIES[a] || inv.owned.indexOf(a) < 0) {
        return res.status(400).json({ code: 400, message: '饰品还没拿到：' + a });
      }
      eq.accessory = a;
    }
    var c = body.equipment.consumable;
    if (c) {
      if (!CONSUMABLES[c] || (inv.charges[c] || 0) <= 0) {
        return res.status(400).json({ code: 400, message: '消耗品没有库存：' + c });
      }
      eq.consumable = c;
    }
    build.equipment = eq;
  }
  if (body.strategy_name !== undefined) {
    var name = String(body.strategy_name || '').trim().slice(0, 12);
    build.strategy_name = name;
  }
  var finalSkills = equippedSkills(st);
  st.battle_skills = finalSkills;
  build.skills = finalSkills;          // 镜像同步
  writePet(uid, st);
  res.json({ code: 200, data: {
    build: buildViewOf(st),
    inventory: inventoryView(st),
    equipped: finalSkills
  }});
});

// 生成分享码：对当前「实际生效」的 Build 编码，无副作用、可重复调用
router.post('/battle/build/share', requireAuth, function(req, res) {
  var uid = userId(req);
  var st = readPet(uid);
  if (!st || !st.adopted) return res.status(400).json({ code: 400, message: '还未领养宠物' });
  var code = encodeBuildCode({ skills: equippedSkills(st), equipment: buildOf(st).equipment });
  res.json({ code: 200, data: { share_code: code, expires_hint: '约 7-14 天内有效' } });
});

// 导入分享码：{ share_code }
// 技能只收已解锁的（没解锁的列进 missing.skills）；装备只收已拥有的
//（没有的列进 missing.equipment，不自动穿上）。导入即保存。
router.post('/battle/build/import', requireAuth, function(req, res) {
  var uid = userId(req);
  var st = readPet(uid);
  if (!st || !st.adopted) return res.status(400).json({ code: 400, message: '还未领养宠物' });
  var decoded = decodeBuildCode(req.body && req.body.share_code);
  if (!decoded) return res.status(400).json({ code: 400, message: '分享码无效或已过期' });

  var unlocked = skillsOf(st);
  var okSkill = {};
  for (var i = 0; i < unlocked.length; i++) okSkill[unlocked[i].id] = true;
  var inv = inventoryOf(st);
  var missing = { skills: [], equipment: [] };

  var skills = [];
  for (var j = 0; j < decoded.skills.length; j++) {
    var sid = decoded.skills[j];
    if (!sid) continue;
    if (!okSkill[sid]) { missing.skills.push(sid); continue; }
    if (skills.indexOf(sid) < 0) skills.push(sid);
  }
  var eq = {};
  var lists = [[WEAPONS, 'weapon'], [ACCESSORIES, 'accessory'], [CONSUMABLES, 'consumable']];
  for (var k = 0; k < lists.length; k++) {
    var table = lists[k][0];
    var slot = lists[k][1];
    var iid = decoded.equipment[slot];
    if (!iid) continue;
    var has = table[iid] && (table === CONSUMABLES
      ? (inv.charges[iid] || 0) > 0
      : inv.owned.indexOf(iid) >= 0);
    if (has) eq[slot] = iid;
    else missing.equipment.push(iid);
  }

  st.battle_skills = skills.slice(0, skillSlotsOf(st));
  var finalSkills = equippedSkills(st);
  st.battle_skills = finalSkills;
  var build = buildOf(st);
  build.equipment = eq;
  build.skills = finalSkills;
  writePet(uid, st);
  res.json({ code: 200, data: {
    build: buildViewOf(st),
    inventory: inventoryView(st),
    import_success: true,
    applied: { skills: finalSkills, equipment: eq },
    missing: missing
  }});
});

// 当前环境信息（含 Boss 与我的进度）
router.get('/battle/environment', requireAuth, function(req, res) {
  var uid = userId(req);
  var st = readPet(uid);
  if (!st || !st.adopted) return res.status(400).json({ code: 400, message: '还未领养宠物' });
  res.json({ code: 200, data: envView(uid, st) });
});

// 环境副本 Boss 战：POST /pet/battle/environment/boss
// 每日 1 次；本周首杀必掉环境奖励装备，之后的胜利按 50% 再 roll 一次 DROP_RATES。
router.post('/battle/environment/boss', requireAuth, function(req, res) {
  var uid = userId(req);
  var st = readPet(uid);
  if (!st || !st.adopted) return res.status(400).json({ code: 400, message: '还未领养宠物' });

  var today = todayKey();
  if (st.env_boss_date !== today) { st.env_boss_date = today; st.env_boss_today = 0; }
  if (ENV_BOSS_DAILY_CAP > 0 && (st.env_boss_today || 0) >= ENV_BOSS_DAILY_CAP) {
    return res.status(429).json({ code: 429, message: '今天的 Boss 挑战过了，明天再来' });
  }

  var env = currentEnvironment();
  var envDef = env.boss;
  var mods = envModsOf(env);
  var mode = parseFightMode(req);
  var ob = null;
  if (mode === 'reroll' || mode === 'settle') {
    var lo = loadOpen(st, 'boss', req);
    if (lo.err) {
      delete st.battle_open;
      writePet(uid, st);
      return res.status(lo.err).json({ code: lo.err, message: '这一场已经结束了，重新挑战吧' });
    }
    ob = lo.ob;
  }
  var cmds = (mode === 'settle' && ob)
    ? (ob.cmds || [])
    : sanitizeCmds(req.body && req.body.cmds, cmdSlotsOf(st), BATTLE_MAX_ROUNDS, equippedSkills(st));
  var tacticId = (req.body && req.body.tactic) || st.battle_tactic || 'guard';
  if (TACTIC_IDS.indexOf(tacticId) < 0) tacticId = 'guard';
  st.battle_tactic = tacticId;

  var myKit = battleKitOf(st, mods, false);
  var useCons = consumableInPlay(st);
  var myType = normType(st.battle_type);
  var weather = weatherOf(today);
  var mine = applyMood(applyWeather(applyTactic(myKit.combat, tacticId), myType, weather), st);
  mine.power = powerOf(mine);

  var bossBond = Math.max(4, Math.round((st.bond || 0) * ENV_BOSS_SCALE));
  var foe = applyWeather(combatOf({ bond: bossBond }), envDef.type, weather);
  foe.hp = Math.round(foe.hp * ENV_BOSS_HP_MUL);
  foe.power = powerOf(foe);

  // ⚠️ 递增挪到 settle：reroll 一次就多算一次「试过」，同一次挑战会被洗成另一场。
  var tries = (st.env_boss_tries && st.env_boss_tries[env.id]) || 0;
  st.env_boss_tries = st.env_boss_tries || {};
  var seed = ob ? ob.seed : fnv1a([uid, 'envboss', env.id, String(tries), today].join('|'));
  var r;
  if (mode === 'settle') {
    r = settledRes(ob);
  } else {
    r = simulateBattle(mine, foe, seed, myKit.skills, envDef.skills || [], 1,
      { me: myType, foe: envDef.type }, { env: mods, myKit: myKit.kit, cmds: cmds, playerCtl: mode === 'open' || mode === 'reroll' });
  }

  // 只演算：不消耗今日次数、不发奖励、不写战绩
  if (mode === 'open' || mode === 'reroll') {
    var sid = saveOpen(st, 'boss', seed, useCons, cmds, r, { env: env.id });
    writePet(uid, st);
    return res.json({ code: 200, data: {
      win: r.win, rounds: r.rounds, steps: r.steps, seed: seed, fightId: sid,
      env: { id: env.id, name: env.name, icon: env.icon },
      firstKill: false, drop: null,
      me: { name: st.name || '小家伙', power: mine.power, hp: r.maxMe, atk: mine.atk, def: mine.def, spd: mine.spd, crit: mine.crit, type: myType, typeName: ELEMENTS[myType].name, typeIcon: ELEMENTS[myType].icon, mood: mine.mood, assist: assistantView(st) || null },
      foe: { name: envDef.name, power: foe.power, hp: r.maxFoe, atk: foe.atk, def: foe.def, spd: foe.spd, crit: foe.crit, skills: envDef.skills || [], type: envDef.type, typeName: ELEMENTS[envDef.type].name, typeIcon: ELEMENTS[envDef.type].icon },
      types: { me: myType, foe: envDef.type, mulMe: typeMul(myType, envDef.type), mulFoe: typeMul(envDef.type, myType) },
      dailyLeft: Math.max(0, ENV_BOSS_DAILY_CAP - (st.env_boss_today || 0)),
      skills: myKit.skills, foeSkills: envDef.skills || [],
      manualSkills: manualSkillView(myKit.skills),
      cmdSlots: cmdSlotsOf(st), commands: COMMAND_IDS.map(function(id) { return COMMANDS[id]; }), cmds: cmds,
      weather: weather
    }});
  }

  // ---- settle：到这里才动存档 ----
  spendConsumable(st, useCons);
  st.env_boss_tries[env.id] = tries + 1;
  st.env_boss_today = (st.env_boss_today || 0) + 1;

  // 结算：积分进练习赛分（社交货币），奖励装备进库存
  var rec = st.battles || { total: 0, win: 0, lose: 0, points: 0 };
  rec.total = (rec.total || 0) + 1;
  var gain = r.win ? ENV_BOSS_WIN_POINTS : ENV_BOSS_LOSE_POINTS;
  rec.points = (rec.points || 0) + gain;
  st.battles = rec;

  var drop = null;
  var firstKill = false;
  if (r.win) {
    st.env_progress = st.env_progress || { best_score: 0, boss_week: {}, boss_wins: {} };
    if (!st.env_progress.boss_week) st.env_progress.boss_week = {};
    if (!st.env_progress.boss_wins) st.env_progress.boss_wins = {};
    st.env_progress.boss_wins[env.id] = (st.env_progress.boss_wins[env.id] || 0) + 1;
    st.env_progress.best_score = Math.max(st.env_progress.best_score || 0, powerOf(myKit.combat));
    // 本周首杀：必掉环境奖励；之后的胜利 50% 再 roll 一次
    if (st.env_progress.boss_week[env.id] !== envWeekIndex()) {
      st.env_progress.boss_week[env.id] = envWeekIndex();
      firstKill = true;
      drop = grantEquip(st, env.rewardItem);
    } else {
      var dr = rngFrom(fnv1a([uid, 'envdrop', env.id, String(tries), today].join('|')));
      if (dr() < 0.5) drop = grantEquip(st, rollDropItem(dr));
    }
    if (drop && drop.item) {
      drop = { id: drop.item.id, name: drop.item.name, icon: drop.item.icon,
               duplicate: drop.duplicate, dust: drop.dust };
      if (drop.dust) st.coins = (st.coins || 0) + drop.dust;
    } else {
      drop = null;
    }
  }

  pushHistory(st, {
    at: new Date().toISOString(),
    kind: 'env',
    win: r.win,
    title: env.name + ' · ' + envDef.name,
    sub: '环境副本 · ' + r.rounds + ' 回合' + (firstKill ? ' · 周首杀' : ''),
    gain: gain,
    points: rec.points || 0
  });
  if (r.win) diaryPush(st, todayKey(), { k: 'win', n: 1 });
  delete st.battle_open;
  writePet(uid, st);
  shadowCache.at = 0;

  res.json({ code: 200, data: {
    win: r.win,
    rounds: r.rounds,
    steps: r.steps,
    seed: seed,
    env: { id: env.id, name: env.name, icon: env.icon },
    firstKill: firstKill,
    drop: drop,
    me: { name: st.name || '小家伙', power: mine.power, hp: r.maxMe, atk: mine.atk, def: mine.def, spd: mine.spd, crit: mine.crit, type: myType, typeName: ELEMENTS[myType].name, typeIcon: ELEMENTS[myType].icon, mood: mine.mood, assist: assistantView(st) || null },
    foe: { name: envDef.name, power: foe.power, hp: r.maxFoe, atk: foe.atk, def: foe.def, spd: foe.spd, crit: foe.crit, skills: envDef.skills || [], type: envDef.type, typeName: ELEMENTS[envDef.type].name, typeIcon: ELEMENTS[envDef.type].icon },
    types: { me: myType, foe: envDef.type, mulMe: typeMul(myType, envDef.type), mulFoe: typeMul(envDef.type, myType) },
    gain: gain,
    dailyLeft: Math.max(0, ENV_BOSS_DAILY_CAP - (st.env_boss_today || 0)),
    skills: myKit.skills,
    manualSkills: manualSkillView(myKit.skills),
    foeSkills: envDef.skills || [],
    weather: weather,
    cmdSlots: cmdSlotsOf(st),
    commands: COMMAND_IDS.map(function(id) { return COMMANDS[id]; }),
    cmds: cmds,
    quests: questsView(uid, st)
  }});
});

// ==================== 小卖部（v0.25.0）====================
// 以前整个商店只有一件「豪华大餐」：小鱼干攒到三位数也只有一个去处，
// 钱包从「资源」退化成「数字」。货架的意义不是多几个按钮，是让专注产出的
// 每一条鱼干都有「现在买还是攒着」的选择。
// 定价锚定产出（专注 25 分钟 ≈ 6 条、8 小时离线 ≈ 16 条）：
//   药水 = 两三天的零花；铃铛 = 一周攒一次的大件。
// ⚠️ 豪华大餐不在这里扣钱：它走 /interact 的老路（那边还有饱食度与每日上限），
//    商店里它只是「展示价格」，点了等于喂饭。
var SHOP = {
  feast:        { id: 'feast',        name: '豪华大餐', icon: '🍱', cost: 5,  kind: 'feed', desc: '喂一次，羁绊 +10（普通饭 +4）' },
  restore_vial: { id: 'restore_vial', name: '恢复药剂', icon: '💊', cost: 15, kind: 'item', desc: '下一场战斗第 1 回合末回 40% 血' },
  healing_herb: { id: 'healing_herb', name: '治愈草',   icon: '🌿', cost: 20, kind: 'item', desc: '下一场战斗每回合回 3% 血' },
  flame_potion: { id: 'flame_potion', name: '火焰药水', icon: '🧪', cost: 25, kind: 'item', desc: '下一场战斗首击伤害 ×2' },
  bell:         { id: 'bell',         name: '默契铃铛', icon: '🔔', cost: 40, kind: 'bell', desc: '今天所有战斗默契 +1（每日一枚）' }
};
// 货架视图：/state 随存档一起下发（首页不用多打一个请求），/shop 也在用它。
function shopView(st) {
  var inv = inventoryOf(st);
  var bellToday = st && st.bell_date === todayKey() && (st.bell_bought || 0) > 0;
  var items = [];
  for (var k in SHOP) {
    if (!Object.prototype.hasOwnProperty.call(SHOP, k)) continue;
    var sku = SHOP[k];
    items.push({
      id: sku.id, name: sku.name, icon: sku.icon, cost: sku.cost,
      kind: sku.kind, desc: sku.desc,
      charges: sku.kind === 'item' ? (inv.charges[sku.id] || 0) : null,
      soldOut: sku.kind === 'bell' && bellToday
    });
  }
  return { items: items };
}
router.get('/shop', requireAuth, function(req, res) {
  var st = readPet(userId(req)) || {};
  res.json({ code: 200, data: { coins: st.coins || 0, feastCost: FEAST_COST, items: shopView(st).items } });
});
router.post('/shop/buy', requireAuth, function(req, res) {
  var uid = userId(req);
  var st = readPet(uid);
  if (!st || !st.adopted) return res.status(400).json({ code: 400, message: '还未领养宠物' });
  var id = String((req.body && req.body.id) || '');
  var sku = SHOP[id];
  if (!sku) return res.status(400).json({ code: 400, message: '小卖部没有这件东西' });
  if (sku.kind === 'bell' && st.bell_date === todayKey() && (st.bell_bought || 0) >= 1) {
    return res.status(429).json({ code: 429, message: '铃铛每天只卖一枚，明天再来' });
  }
  if ((st.coins || 0) < sku.cost) {
    return res.status(400).json({ code: 400, message: '小鱼干不够（要 ' + sku.cost + ' 条，现在 ' + (st.coins || 0) + ' 条）' });
  }
  st.coins = (st.coins || 0) - sku.cost;
  if (sku.kind === 'item') {
    var inv = inventoryOf(st);
    inv.charges[sku.id] = (inv.charges[sku.id] || 0) + 1;
  } else if (sku.kind === 'bell') {
    st.bell_date = todayKey();
    st.bell_bought = 1;
  }
  writePet(uid, st);
  res.json({ code: 200, data: {
    id: sku.id, name: sku.name, icon: sku.icon,
    coins: st.coins || 0,
    inventory: inventoryView(st),
    cmdSlots: cmdSlotsOf(st),
    bellToday: sku.kind === 'bell'
  }});
});

// ==================== 远征（v0.29.0）—— 借鉴 Hades / 杀戮尖塔的 roguelite 跑趟 ====================
// 「玩久了无聊」的解法不是再加一条成长线（bond/塔/深渊已经够了），是让**每一局的打法本身**
// 不一样：出发时你不知道这趟会拿到什么祝福，五层打完祝福全部蒸发——
// 局内 build 是一次性的实验，局外的 bond/图鉴/深渊进度分毫不动（roguelite 的核心切分：
// 单局可丢弃，长线不归零）。每日路线全班相同（天气/今日规则同一先例）：
// 同学间能聊「你今天第一趟拿到汲血了吗」「我 4 层就跪了」。
//
// 结构：一天不限趟数；每趟最多 5 层，每层一场战斗；赢了三选一拿祝福（本局生效，可叠加）；
// 输了即刻结算（按到达深度给积分）。祝福全走现有引擎通道（kit/mods），引擎只加了
// myDmgMul（我方专属伤害乘区）。
var BOONS = {
  regen:    { id: 'regen',    icon: '\🌿', name: '回春',     text: '每回合回复 2% 最大 HP',        once: false,
              apply: function(c, kit, m) { kit.assistRegen = (kit.assistRegen || 0) + 0.02; } },
  vamp:     { id: 'vamp',     icon: '\🩸', name: '汲血',     text: '攻击附带 8% 吸血',             once: false,
              apply: function(c, kit, m) { m.vampire = (m.vampire || 0) + 0.08; } },
  swift:    { id: 'swift',    icon: '\⚡',  name: '迅捷',     text: '速度 +15%',                    once: false,
              apply: function(c, kit, m) { c.spd = Math.round(c.spd * 1.15); } },
  blaze:    { id: 'blaze',    icon: '\🔥', name: '燃魂',     text: '攻击 +15%',                    once: false,
              apply: function(c, kit, m) { c.atk = Math.round(c.atk * 1.15); } },
  wall:     { id: 'wall',     icon: '\🛡', name: '铁壁',     text: '防御 +20%',                    once: false,
              apply: function(c, kit, m) { c.def = Math.round(c.def * 1.20); } },
  eagle:    { id: 'eagle',    icon: '\🎯', name: '鹰眼',     text: '暴击率 +8',                    once: false,
              apply: function(c, kit, m) { c.crit = Math.min(90, c.crit + 8); } },
  fury:     { id: 'fury',     icon: '\💢', name: '巨力',     text: '你的攻击伤害 +18%',            once: false,
              apply: function(c, kit, m) { m.myDmgMul = (m.myDmgMul || 1) * 1.18; } },
  shadow:   { id: 'shadow',   icon: '\🌑', name: '暗影步',   text: '闪避率 +8%',                   once: false,
              apply: function(c, kit, m) { kit.evadeAdd = (kit.evadeAdd || 0) + 0.08; } },
  ancestor: { id: 'ancestor', icon: '\💚', name: '先祖庇佑', text: '开局获得一层护盾',             once: true,
              apply: function(c, kit, m) { kit.assistShield = true; } },
  spark:    { id: 'spark',    icon: '\🌟', name: '星火',     text: '这一层首击伤害 ×2（一次性）',  once: true,
              apply: function(c, kit, m) { kit.flame = true; } }
};
var EXP_MAX_DEPTH = 5;
var EXP_UNLOCK_TOWER = 3;   // 塔通到第 3 层解锁——中期内容，但要早点被看见
var EXP_BOON_IDS = ['regen', 'vamp', 'swift', 'blaze', 'wall', 'eagle', 'fury', 'shadow', 'ancestor', 'spark'];

// 每层对手：属性按层轮换（逼你在层间换思路），名字池固定（同学间能聊）。
function expFloorOf(depth, seed) {
  var types = ['fire', 'water', 'grass', 'electric', 'earth'];
  var type = types[(seed + depth) % 5];
  var names = {
    fire: ['炭火武士', '熔岩小鬼', '烬羽'],
    water: ['深水影子', '潮汐卫兵', '泡影'],
    grass: ['荆棘拳师', '藤蔓妖', '菇菇力士'],
    electric: ['电光鼠', '雷鸣鸟', '伏特蛇'],
    earth: ['岩壳兵', '山岭巨像', '沙暴蜥']
  };
  var pool = names[type] || ['迷影'];
  var name = pool[(seed + depth * 3) % pool.length];
  var final = depth >= EXP_MAX_DEPTH;
  if (final) name = '守关者 · ' + name;
  // 技能包随深度加厚（与塔同一套技能词汇表）
  var skills = depth <= 1 ? [] : (depth === 2 ? ['combo'] : (depth === 3 ? ['combo', 'pierce'] : ['combo', 'pierce', 'heavy']));
  return {
    depth: depth, final: final, name: name, type: type,
    typeName: ELEMENTS[type].name, typeIcon: ELEMENTS[type].icon,
    bond: 140 + depth * 12,          // d1=152（≈塔顶）→ d5=200（毕业线）
    buff: 1.55 + depth * 0.10,       // d1=1.65 → d5=2.05
    skills: skills
  };
}

// 三选一：seed 驱动（同一天同趟同深度，全班看到的三个选项一致）
function expBoonChoices(seed, depth) {
  var ids = EXP_BOON_IDS.slice();
  // Fisher-Yates 用确定性随机流洗牌，取前三个
  var rnd = rngFrom(fnv1a(['expboon', String(seed), String(depth)].join('|')));
  for (var i = ids.length - 1; i > 0; i--) {
    var j = Math.floor(rnd() * (i + 1));
    var t = ids[i]; ids[i] = ids[j]; ids[j] = t;
  }
  return ids.slice(0, 3);
}

function expBoonView(ids) {
  var out = [];
  for (var i = 0; i < (ids || []).length; i++) {
    var b = BOONS[ids[i]];
    if (b) out.push({ id: b.id, icon: b.icon, name: b.name, text: b.text, once: !!b.once });
  }
  return out;
}

function expViewOf(st) {
  var today = todayKey();
  var e = st.expedition;
  var active = !!(e && e.date === today && (e.depth || 0) < EXP_MAX_DEPTH && !e.ended);
  var locked = (st.tower_floor || 0) < EXP_UNLOCK_TOWER;
  return {
    locked: locked,
    unlockTower: EXP_UNLOCK_TOWER,
    maxDepth: EXP_MAX_DEPTH,
    active: active,
    depth: active ? (e.depth || 0) : 0,
    boons: active ? expBoonView(e.boons) : [],
    pending: active && e.pending ? expBoonView(e.pending) : null,
    best: st.exp_best || 0,
    runsToday: st.exp_date === today ? (st.exp_runs_today || 0) : 0
  };
}

// 祝福落进战斗参数：战斗属性进 combat，引擎通道进 kit/mods（全部是现有通道）
function applyBoons(combat, kit, mods, boonIds) {
  for (var i = 0; i < (boonIds || []).length; i++) {
    var b = BOONS[boonIds[i]];
    if (b && b.apply) b.apply(combat, kit, mods);
  }
}

router.post('/expedition/start', requireAuth, function(req, res) {
  var uid = userId(req);
  var st = readPet(uid);
  if (!st || !st.adopted) return res.status(400).json({ code: 400, message: '还未领养宠物' });
  if ((st.tower_floor || 0) < EXP_UNLOCK_TOWER) {
    return res.status(403).json({ code: 403, message: '通过试炼塔第 ' + EXP_UNLOCK_TOWER + ' 层后解锁远征' });
  }
  var today = todayKey();
  if (st.exp_date !== today) { st.exp_date = today; st.exp_runs_today = 0; }
  st.exp_runs_today = (st.exp_runs_today || 0) + 1;
  st.expedition = { date: today, run: st.exp_runs_today, depth: 0, boons: [], ended: false };
  writePet(uid, st);
  res.json({ code: 200, data: { expedition: expViewOf(st) } });
});

// 祝福三选一：只在层间（赢了上一层、还没打下一层）可点
router.post('/expedition/boon', requireAuth, function(req, res) {
  var uid = userId(req);
  var st = readPet(uid);
  if (!st || !st.adopted) return res.status(400).json({ code: 400, message: '还未领养宠物' });
  var e = st.expedition;
  if (!e || e.date !== todayKey() || e.ended || !e.pending) {
    return res.status(409).json({ code: 409, message: '现在没有祝福可以挑' });
  }
  var id = String((req.body && req.body.id) || '');
  if ((e.pending || []).indexOf(id) < 0) {
    return res.status(400).json({ code: 400, message: '这三个祝福里没有它' });
  }
  e.boons = (e.boons || []).concat([id]);
  e.pending = null;
  writePet(uid, st);
  res.json({ code: 200, data: { expedition: expViewOf(st) } });
});

router.post('/expedition/fight', requireAuth, function(req, res) {
  var uid = userId(req);
  var st = readPet(uid);
  if (!st || !st.adopted) return res.status(400).json({ code: 400, message: '还未领养宠物' });
  if ((st.tower_floor || 0) < EXP_UNLOCK_TOWER) {
    return res.status(403).json({ code: 403, message: '通过试炼塔第 ' + EXP_UNLOCK_TOWER + ' 层后解锁远征' });
  }
  var mode = parseFightMode(req);
  var today = todayKey();
  var e = st.expedition;
  if (mode === 'open' || mode === 'reroll') {
    if (!e || e.date !== today || e.ended || (e.depth || 0) >= EXP_MAX_DEPTH) {
      return res.status(409).json({ code: 409, message: '先出发，才能开打' });
    }
    if (e.pending) return res.status(409).json({ code: 409, message: '先挑一个祝福再继续' });
  }
  var ob = null;
  if (mode === 'reroll' || mode === 'settle') {
    var lo = loadOpen(st, 'exp', req);
    if (lo.err) {
      delete st.battle_open;
      writePet(uid, st);
      return res.status(lo.err).json({ code: lo.err, message: '这一场已经结束了，重新出发吧' });
    }
    ob = lo.ob;
  }
  // settle 用会话里存的层号——层间玩家可能已挑了祝福，祝福要按「开打那一刻」的状态算
  var depth = ob ? ob.ref.depth : (e ? (e.depth || 0) + 1 : 1);
  var runSeed = ob ? ob.ref.seed : fnv1a(['exp', today, String((e && e.run) || 1)].join('|'));
  var floorDef = expFloorOf(depth, runSeed);
  var tacticId = (req.body && req.body.tactic) || st.battle_tactic || 'guard';
  if (TACTIC_IDS.indexOf(tacticId) < 0) tacticId = 'guard';
  if (mode === 'open' && req.body && req.body.tactic) st.battle_tactic = tacticId;
  // 指令牌（默契牌 + 技能牌）清洗：与其他四个战斗端点同一套规则
  var cmds = sanitizeCmds(req.body && req.body.cmds, cmdSlotsOf(st), BATTLE_MAX_ROUNDS, equippedSkills(st));

  var weather = weatherOf(today);
  var env = envModsOf(currentEnvironment());
  var myKit = battleKitOf(st, env, false);
  var useCons = consumableInPlay(st);
  var myType = normType(st.battle_type);
  var mine = applyMood(applyWeather(applyTactic(myKit.combat, tacticId), myType, weather), st);
  var foe = applyWeather(combatOf({ bond: floorDef.bond }), floorDef.type, weather);
  var dailyMods = dailyModsOf(today);
  var modCh = applyDailyMods(mine, foe, dailyMods);
  // 祝福（reroll/settle 用会话里存的那份——中途换祝福不能追溯生效）
  var boons = ob ? (ob.ref.boons || []) : ((e && e.boons) || []);
  applyBoons(mine, myKit.kit, modCh, boons);
  mine.power = powerOf(mine);
  foe.power = powerOf(foe);

  var seed = ob ? ob.seed : fnv1a([uid, 'exp', today, String((e && e.run) || 1), String(depth)].join('|'));
  var r;
  if (mode === 'settle') {
    r = settledRes(ob);
  } else {
    r = simulateBattle(mine, foe, seed, myKit.skills, floorDef.skills, floorDef.buff,
      { me: myType, foe: floorDef.type },
      { env: env, myKit: myKit.kit, cmds: cmds, mods: modCh, playerCtl: mode === 'open' || mode === 'reroll' });
  }

  if (mode === 'open' || mode === 'reroll') {
    var sid = saveOpen(st, 'exp', seed, useCons, cmds, r,
      { depth: depth, seed: runSeed, boons: boons });
    writePet(uid, st);
    return res.json({ code: 200, data: {
      win: r.win, rounds: r.rounds, steps: r.steps, seed: seed, fightId: sid,
      floor: depth, depth: depth, expedition: true,
      me: { name: st.name || '小家伙', power: mine.power, hp: r.maxMe, atk: mine.atk, def: mine.def, spd: mine.spd, crit: mine.crit, type: myType, typeName: ELEMENTS[myType].name, typeIcon: ELEMENTS[myType].icon, mood: mine.mood, assist: assistantView(st) || null },
      foe: { name: floorDef.name, power: foe.power, hp: r.maxFoe, atk: foe.atk, def: foe.def, spd: foe.spd, crit: foe.crit, skills: floorDef.skills, type: floorDef.type, typeName: floorDef.typeName, typeIcon: floorDef.typeIcon },
      types: { me: myType, foe: floorDef.type, mulMe: typeMul(myType, floorDef.type), mulFoe: typeMul(floorDef.type, myType) },
      skills: myKit.skills, foeSkills: floorDef.skills,
      manualSkills: manualSkillView(myKit.skills),
      cmdSlots: cmdSlotsOf(st), commands: COMMAND_IDS.map(function(id) { return COMMANDS[id]; }), cmds: cmds,
      weather: weather
    }});
  }

  // ---- settle：到这里才动存档 ----
  spendConsumable(st, useCons);
  var gain = 0;
  var fresh = [];
  var ended = false;
  var complete = false;
  var boonChoices = null;
  var fishGain = 0;
  var win = r.win;
  var curDepth = (ob && ob.ref && ob.ref.depth) || 1;
  var e2 = st.expedition;
  if (win) {
    gain = 20 * curDepth;
    st.tower_points = (st.tower_points || 0) + gain;
    e2.depth = curDepth;
    if (curDepth >= EXP_MAX_DEPTH) {
      // 五层全通：远征完成
      gain += 50;
      st.tower_points = (st.tower_points || 0) + 50;
      complete = true; ended = true;
    } else {
      // 层间：发三选一（seed 驱动，全班一致）
      boonChoices = expBoonChoices(ob.ref.seed, curDepth);
      e2.pending = boonChoices;
    }
  } else {
    ended = true;
    gain = 5 * (curDepth - 1);   // 败了也有保底：走到第几层就按深度给
    st.tower_points = (st.tower_points || 0) + gain;
  }
  if (ended) {
    var reached = e2.depth || 0;
    st.exp_best = Math.max(st.exp_best || 0, reached);
    // 每日新深度奖：今天第一次到达的每一层 +6 鱼干（重复深度不重复发钱）
    var prevToday = st.exp_best_today || 0;
    if (reached > prevToday) {
      fishGain = (reached - prevToday) * 6;
      st.coins = (st.coins || 0) + fishGain;
      st.exp_best_today = reached;
    }
    var expWins = [];
    if (reached >= 3) expWins.push('exp_3');
    if (reached >= EXP_MAX_DEPTH) expWins.push('exp_5');
    fresh = unlock(st, expWins);
    e2.ended = true;
    delete st.battle_open;
  }
  if (win) diaryPush(st, today, { k: 'win', n: 1 });
  writePet(uid, st);
  shadowCache.at = 0;

  res.json({ code: 200, data: {
    win: win, rounds: r.rounds, seed: seed,
    floor: curDepth, depth: curDepth, expedition: true,
    ended: ended, complete: complete,
    gain: gain, fishGain: fishGain, newBest: st.exp_best || 0,
    boonChoices: boonChoices ? expBoonView(boonChoices) : null,
    boons: expBoonView((e2 && e2.boons) || []),
    towerPoints: st.tower_points || 0,
    me: { name: st.name || '小家伙', power: mine.power, hp: r.maxMe, atk: mine.atk, def: mine.def, spd: mine.spd, crit: mine.crit, type: myType, typeName: ELEMENTS[myType].name, typeIcon: ELEMENTS[myType].icon, mood: mine.mood, assist: assistantView(st) || null },
    foe: { name: floorDef.name, power: foe.power, hp: r.maxFoe, type: floorDef.type, typeName: floorDef.typeName, typeIcon: floorDef.typeIcon },
    unlocked: fresh,
    weather: weather,
    quests: questsView(uid, st)
  }});
});

module.exports = router;
