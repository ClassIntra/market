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

// 羁绊交互：POST /pet/interact { type: 'poke'|'feed'|'visit' }
// 返回 { state, gained, tierUp, capped }
router.post('/interact', requireAuth, function(req, res) {
  var uid = userId(req);
  var type = req.body && req.body.type;
  var rule = INTERACT_RULES[type];
  if (!rule) return res.status(400).json({ code: 400, message: '未知交互类型' });

  var row = db.prepare('SELECT value FROM user_kv_store WHERE user_id = ? AND key = ?').get(uid, KV_KEY);
  var state = {};
  if (row) { try { state = JSON.parse(row.value) || {}; } catch (e) { state = {}; } }
  if (!state.adopted) return res.status(400).json({ code: 400, message: '还未领养宠物' });

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
    gained = rule.gain;
    state.bond = (state.bond || 0) + gained;
    state.bond_today = (state.bond_today || 0) + gained;
    if (type === 'poke') state.poked_today = used + 1;
    if (type === 'feed') { state.fed_today = used + 1; state.last_fed_at = new Date().toISOString(); }
    if (type === 'gift') { state.gift_date = today; state.gift_today = used + 1; }
    if (type === 'visit') state.visited_date = today;
  }
  state.updated_at = new Date().toISOString();
  db.prepare('INSERT INTO user_kv_store (user_id, key, value) VALUES (?, ?, ?) ' +
    'ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value')
    .run(uid, KV_KEY, JSON.stringify(state));

  var tierUp = tierOf(state.bond) > tierOf(tierBefore);
  res.json({ code: 200, data: {
    state: state, gained: gained, tierUp: tierUp, capped: capped,
    quests: questsView(uid, state)
  } });
});

// 读状态
router.get('/state', requireAuth, function(req, res) {
  var row = db.prepare('SELECT value FROM user_kv_store WHERE user_id = ? AND key = ?').get(userId(req), KV_KEY);
  var state = null;
  if (row) {
    try { state = JSON.parse(row.value); } catch (e) { state = null; }
  }
  res.json({ code: 200, data: {
    state: state,
    palette: PALETTE.p16,
    templates: TEMPLATES,
    elements: elementList(),
    wild: WILD,
    buddy: buddyPublic(state),
    evolution: evolutionOf(state),
    // v0.10.0：天气与每日任务和「当前存档」一起下发，
    // 首页不必先拉战斗档案就能渲染天气条 / 任务卡。
    weather: weatherOf(todayKey()),
    quests: (state && state.adopted) ? questsView(userId(req), state) : null
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
    crit: Math.min(90, c.crit + (t.crit || 0))
  };
}

// ==================== 技能（v0.7.0）====================
// 战术改的是「属性怎么分配」，技能改的是「战斗里发生什么」。
// 两者叠加才算 build：同样的属性，带「千钧一击」和带「鲸吞」是两种宠物。
//
// 技能按羁绊档位解锁（tier 就是 TIER_NAMES 的下标），同时只能带 2 个——
// 有取舍才有搭配，全带满就变成「数值总和」了。
//
// ⚠️ 解锁门槛必须平缓：班里 25 只宠物绝大多数在 bond 17–40（tier 1），
//    如果技能要 tier 3/4 才能用，等于绝大多数人永远看不到这套玩法。
//    实测门槛定成 0/0/1/1/2 之后，bond 20 就能选 3 个技能，选择立刻成立。
var SKILLS = {
  heavy:     { id: 'heavy',     name: '千钧一击', icon: '💥', tier: 0, desc: '每 3 回合打出 1.6 倍伤害' },
  lifesteal: { id: 'lifesteal', name: '鲸吞',     icon: '🩸', tier: 0, desc: '造成伤害的 12% 回血' },
  shield:    { id: 'shield',    name: '泡泡护盾', icon: '🫧', tier: 1, desc: '血量快见底时挡下一半伤害（一次）' },
  combo:     { id: 'combo',     name: '连打',     icon: '⚡', tier: 1, desc: '25% 概率追加半次攻击' },
  // ⚠️ 破甲用「无视 40% 防御 + 至少 1 点」而不是纯百分比：
  //    低羁绊时 def 只有 3，`def*0.6*0.6` 取整后和没带一样（实测与不带完全重合），
  //    等于这个技能在低档位不存在。加一条最小值保证它在任何档位都有手感。
  // 同时把解锁门槛降到 tier 1（bond 20），让新手也能摸到破甲这条线。
  pierce:    { id: 'pierce',    name: '破甲',     icon: '🔨', tier: 1, desc: '无视对手 30% 防御，至少多打 1 点' }
};
var SKILL_IDS = ['heavy', 'lifesteal', 'shield', 'combo', 'pierce'];
var SKILL_SLOTS = 2;

// 已解锁的技能（按羁绊档位）
function skillsOf(st) {
  var t = tierOf((st && st.bond) || 0);
  var out = [];
  for (var i = 0; i < SKILL_IDS.length; i++) {
    var s = SKILLS[SKILL_IDS[i]];
    if (s.tier <= t) out.push({ id: s.id, name: s.name, icon: s.icon, tier: s.tier, desc: s.desc });
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

// 把技能列表压成结算时用的标记表
function skillSet(ids) {
  var e = { heavy: false, lifesteal: 0, shield: false, combo: 0, pierce: 0 };
  for (var i = 0; i < (ids || []).length; i++) {
    var id = ids[i];
    if (!SKILLS[id]) continue;
    if (id === 'heavy') e.heavy = true;
    else if (id === 'lifesteal') e.lifesteal = 0.12;
    else if (id === 'shield') e.shield = true;
    else if (id === 'combo') e.combo = 0.25;
    else if (id === 'pierce') e.pierce = 0.3;
  }
  // ⚠️ 两个互斥规则，都是为了压住「叠乘」：
  //    1) 千钧 vs 连打：都是单回合增伤，叠起来是乘算（实测把最难层推到 95%）
  //    2) 鲸吞 vs 护盾：都是续航，叠起来等于「打不死」，boss 胜率从 79% 冲到 90%
  //    互斥之后每个技能都对应一条明确的路线，选择才有意义。
  if (e.heavy && e.combo > 0) e.combo = 0;
  if (e.lifesteal > 0 && e.shield) e.shield = false;
  return e;
}

// ==================== 进化（v0.8.0）====================
// 进化不改形象（形象是玩家自己画的/选的，不能替他换），改的是**能装几个技能**。
// 这是最像宝可梦、又不会破坏已有平衡的奖励：
//   - 前两阶段仍是 2 个槽位，所以 bond 82 以下的所有旧平衡数据完全不变；
//   - bond 120 起开第 3 个槽位，给「养了很久」一个质变，而不是只多几点属性。
var EVOLUTIONS = [
  { stage: 0, name: '幼生体', icon: '🥚', at: 0,   slots: 2, desc: '刚来到你桌面的样子' },
  { stage: 1, name: '成长期', icon: '🌱', at: 60,  slots: 2, desc: '开始有自己的脾气了' },
  { stage: 2, name: '完全体', icon: '✨', at: 120, slots: 3, desc: '解锁第 3 个技能槽' },
  { stage: 3, name: '传说体', icon: '👑', at: 200, slots: 3, desc: '已经不需要再证明什么' }
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

var WILD = [
  // ---- 常见 ----
  { id: 'huomiao', name: '火苗狸', type: 'fire', rarity: 'common', bond: 18, icon: '🦊', skills: [],
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
  { id: 'yanjia', name: '岩甲兽', type: 'earth', rarity: 'rare', bond: 64, icon: '🪨', skills: ['shield'],
    desc: '趴着的时候和操场边的石头一模一样' },
  { id: 'leiming', name: '雷鸟', type: 'electric', rarity: 'rare', bond: 70, icon: '⚡', skills: ['combo', 'pierce'],
    desc: '只在打雷前出现，翅膀上有细小的电弧' },
  { id: 'chaoxi', name: '潮汐豚', type: 'water', rarity: 'rare', bond: 76, icon: '🐬', skills: ['shield'],
    desc: '能听懂上下课铃，铃声一响就跃出水面' },

  // ---- 传说 ----
  { id: 'fenghuang', name: '不死鸟', type: 'fire', rarity: 'legend', bond: 108, icon: '🦅', skills: ['heavy', 'lifesteal'],
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
  }
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
  // 图鉴与进化：这两条线不需要打得多，只需要养得久、收得全
  var dexCount = ((st && st.dex) || []).length;
  if (dexCount >= 5) out.push({ id: 'collector', name: '收藏家', icon: '📖' });
  if (dexCount >= 15) out.push({ id: 'dexmaster', name: '图鉴大师', icon: '🔮' });
  var evo = evolutionOf(st);
  if (evo.stage >= 2) out.push({ id: 'metamorph', name: '蜕变者', icon: '✨' });
  if (evo.stage >= 3) out.push({ id: 'legendary', name: '传说', icon: '👑' });
  return out;
}

// ==================== 异步影子赛场（v0.5.0）====================
// 「影子」是真实同学的宠物快照，不是 NPC：对方不用在线，服务端拿他当前的 bond 结算，
// 再把战报塞进他的 inbox。下次打开桌宠时会看到「谁来挑战过你」。
// ⚠️ 被挑战方的战绩不会被别人改写——只加独立的「守擂」记录和保底积分，
//    否则一个人疯狂打另一个人，对方的胜负就被操纵了。
var SHADOW_TTL_MS = 60 * 1000;      // 影子池进程内缓存：全表扫不能每次请求都跑
var SHADOW_PREFIX = 'p:';         // 影子对手 id 约定：p:<对方 user_id>
var SHADOW_POOL_MAX = 6;            // 一次最多展示几位同学
var SHADOW_DEFEND_WIN = 8;          // 守擂成功（对方视角：挑战者输了）给的分
var SHADOW_DEFEND_LOSE = 3;         // 被击败也给保底，别让「被挑战」变成惩罚
var SHADOW_INBOX_MAX = 20;

// ==================== 成就（v0.6.0）====================
// 只做「一次性的里程碑」，不做每日任务——每日任务会变成打卡负担，
// 而里程碑是「原来我做到了」的回忆。
var ACHIEVEMENTS = [
  { id: 'first_win',  name: '第一滴血', icon: '🩸', desc: '赢下第一场对战' },
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

// 回合制结算：速度高者先手；同速由 seed 决定先后（固定玩家先手对低速度宠物不公平）
//
// 技能全部在这里生效。⚠️ 技能**不进 seed**（和战术同理）：
// 同一场换技能要能对比出「是不是这套更好」。
// 三条要注意的实现细节：
//   1) 吸血按「实际造成的伤害」算，不是按攻击力——否则打高防对手时吸血会虚高
//   2) 护盾是「一次性的」，触发后永久失效（一场只保一条命），且必须在血量归零前判定
//   3) 破甲改的是防御系数（0.6 → 0.6*(1-0.5)），不是直接减防御
function simulateBattle(mine, foe, seed, mySkills, foeSkills, foeBuff, types) {
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
  var a = { hp: mine.hp, max: mine.hp, atk: mine.atk, def: mine.def, spd: mine.spd, crit: mine.crit, sk: ms, shield: ms.shield };
  var b = { hp: foe.hp, max: foe.hp, atk: foe.atk, def: foe.def, spd: foe.spd, crit: foe.crit, sk: fs, shield: fs.shield };
  var first = a.spd === b.spd ? (rnd() < 0.5 ? 0 : 1) : (a.spd > b.spd ? 0 : 1);
  var steps = [];
  var round = 0;

  function strike(atkSide, defSide, who, r) {
    // 破甲：无视对手一部分防御。
    // ⚠️ 只做百分比在低防御时会退化成 0（def=3 时 floor(1.8)=floor(1.08)=1），
    //    所以补一个保底增伤；但它是**无条件**生效的，比千钧/连打（有概率和回合限制）
    //    更容易赢，实测在 bond 50 档把 boss 推到 88%。
    //    这里把保底压到攻击力的 6%，让它的定位回到「对付高防御的解法」，
    //    而不是「对所有对手都稳赚」。
    var defCoef = 0.6;
    var pierceBonus = 0;
    if (atkSide.sk.pierce) {
      defCoef = 0.6 * (1 - atkSide.sk.pierce);
      pierceBonus = Math.max(1, Math.round(atkSide.atk * 0.06));
    }
    var dmg = Math.max(2, atkSide.atk - Math.floor(defSide.def * defCoef) + Math.floor(rnd() * 4));
    var crit = rnd() * 100 < atkSide.crit;
    if (crit) dmg = Math.round(dmg * 1.8);
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

    // 塔的伤害乘区：只对手对手（who===1）生效。
    // 这是塔唯一的连续难度旋钮——属性只能取整，取整会把难度压成台阶。
    if (who === 1 && fBuff !== 1) dmg = Math.max(1, Math.round(dmg * fBuff));

    // 千钧一击：每 3 回合一次重击
    if (atkSide.sk.heavy && r % 3 === 0) {
      dmg = Math.round(dmg * 1.6);
      tags.push('heavy');
    }

    // 泡泡护盾：血量会归零时挡下一半（一次性）
    if (defSide.shield && defSide.hp - dmg <= 0) {
      dmg = Math.max(1, Math.round(dmg * 0.5));
      defSide.shield = false;
      tags.push('shield');
    }

    defSide.hp = Math.max(0, defSide.hp - dmg);
    steps.push({
      r: r, by: who, dmg: dmg, crit: crit,
      tags: tags, hpMe: a.hp, hpFoe: b.hp
    });

    // 鲸吞：按实际伤害回血，且不能溢出上限。
    // ⚠️ 单纯按伤害百分比会奖励低血量宠物（同样伤害占血量比例更高），
    //    实测 bond 20 时把 boss 胜率推到 90%。加一条「单次回血不超过最大血量 8%」
    //    的上限，让它在高血量时也有意义，低血量时不至于变成无限续航。
    if (atkSide.sk.lifesteal > 0 && dmg > 0 && atkSide.hp > 0) {
      var heal = Math.min(
        Math.round(dmg * atkSide.sk.lifesteal),
        Math.max(1, Math.round(atkSide.max * 0.08))
      );
      var before = atkSide.hp;
      atkSide.hp = Math.min(atkSide.max, atkSide.hp + heal);
      if (atkSide.hp > before) {
        steps.push({
          r: r, by: who, heal: atkSide.hp - before, tags: ['lifesteal'],
          hpMe: a.hp, hpFoe: b.hp
        });
      }
    }

    // 连打：追加半次攻击（不再触发连打，避免无限链）
    if (atkSide.sk.combo > 0 && defSide.hp > 0 && rnd() < atkSide.sk.combo) {
      var dmg2 = Math.max(1, Math.round(atkSide.atk * 0.5 - defSide.def * defCoef * 0.5));
      if (em !== 1) dmg2 = Math.max(1, Math.round(dmg2 * em));
      defSide.hp = Math.max(0, defSide.hp - dmg2);
      steps.push({
        r: r, by: who, dmg: dmg2, crit: false, tags: ['combo'],
        hpMe: a.hp, hpFoe: b.hp
      });
    }
  }

  while (a.hp > 0 && b.hp > 0 && round < BATTLE_MAX_ROUNDS) {
    round++;
    for (var k = 0; k < 2; k++) {
      var who = (first + k) % 2;               // 0 = 我方，1 = 对手
      var atkSide = who === 0 ? a : b;
      var defSide = who === 0 ? b : a;
      if (atkSide.hp <= 0 || defSide.hp <= 0) continue;
      strike(atkSide, defSide, who, round);
      if (defSide.hp <= 0) break;
    }
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
function applyWeather(c, type, w) {
  if (!w || normType(type) !== w.type) return c;
  return {
    bond: c.bond, tier: c.tier, tierName: c.tierName,
    hp: c.hp, atk: c.atk + WEATHER_ATK, def: c.def,
    spd: c.spd + WEATHER_SPD, crit: c.crit
  };
}

// 任务池：陪伴组 2 个、对战相关 4 个。每天固定抽「陪伴 1 + 对战 1 + 剩下随机 1」，
// 保证任务里永远有一件「不打架也能做」的事，否则不爱对战的孩子每天都领不到奖励。
var QUESTS = [
  { id: 'care',  group: 'care',   icon: '🫶', title: '陪它一会儿', desc: '摸摸 + 喂食累计 5 次', goal: 5, reward: { bond: 2 } },
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
    evolution: evo,
    elements: elementList(),
    battleType: myType,
    typeInfo: typeInfo(myType),
    dex: dexOf(uid, st),
    tower: towerOf(st),
    titles: titlesOf(st),
    achievements: st.achievements || [],
    achievementList: ACHIEVEMENTS,

    rank: rank,
    myRank: myRank,
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

  var opp = resolveOpponent(st, uid, (req.body && req.body.oppId) || '');
  if (!opp) return res.status(400).json({ code: 400, message: '未知对手' });
  if (opp.kind === 'shadow' && opp.realId === String(uid)) {
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
  var mySkillIds = equippedSkills(st);
  st.battle_skills = mySkillIds;

  var weather = weatherOf(today);
  var baseMine = combatOf(st);
  var myType = normType(st.battle_type);
  var mine = applyWeather(applyTactic(baseMine, tacticId), myType, weather);
  mine.power = powerOf(mine);
  var foeType = normType(opp.type);
  var foe = applyWeather(combatOf({ bond: opp.bond }), foeType, weather);
  foe.power = powerOf(foe);
  // 对手带的技能：影子会带上他自己的（真实感），NPC 练习赛不带
  var foeSkillIds = (opp.kind === 'shadow') ? equippedSkills(readPet(opp.realId) || {}) : [];

  var rec = st.battles || { total: 0, win: 0, lose: 0, points: 0 };
  rec.total = rec.total || 0;
  rec.win = rec.win || 0;
  rec.lose = rec.lose || 0;
  rec.points = rec.points || 0;
  // 老存档没有这两个字段；首战就输时 best 会一直是 undefined，前端算「最好 4」
  // 时会显示成 NaN，所以这里无条件补 0。
  rec.streak = rec.streak || 0;
  rec.best = rec.best || 0;

  // ⚠️ seed 里不带战术：同一对手、同一天、同一场次，换战术要能对比出「是不是这一招更好」。
  // 如果战术进了 seed，每次换战术连运气都换了，玩家永远学不到东西。
  var seed = fnv1a([uid, opp.id, String(rec.total + 1), today].join('|'));
  var r = simulateBattle(mine, foe, seed, mySkillIds, foeSkillIds, 1, { me: myType, foe: foeType });

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

  // ---- 成就判定（在自己存档上，结算完统一 unlock 一次）----
  var wanted = [];
  if (r.win) wanted.push('first_win');
  if (rec.streak >= 3) wanted.push('streak_3');
  if (rec.streak >= 5) wanted.push('streak_5');
  if (r.win && opp.id === 'boss') wanted.push('beat_boss');
  if (r.win && baseMine.power < foe.power) wanted.push('underdog');   // 用原始战力比，不算战术加成
  if ((st.shadow_fought || 0) >= 10) wanted.push('shadow_10');
  if (rec.points >= 100) wanted.push('points_100');
  if (rec.total >= 30) wanted.push('veteran_30');
  var fresh = unlock(st, wanted);

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
    me: { name: st.name || '小家伙', power: mine.power, hp: r.maxMe, atk: mine.atk, def: mine.def, spd: mine.spd, crit: mine.crit, type: myType, typeName: ELEMENTS[myType].name, typeIcon: ELEMENTS[myType].icon },
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
    foeSkills: foeSkillIds,
    unlocked: fresh,
    titles: titlesOf(st),
    defended: defended,
    weather: weather,
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
  var floorDef = towerFloorOf(cleared + 1);
  if (!floorDef) return res.status(400).json({ code: 400, message: '塔已经爬完了，你是塔顶传说' });

  var tacticId = (req.body && req.body.tactic) || st.battle_tactic || 'guard';
  if (TACTIC_IDS.indexOf(tacticId) < 0) tacticId = 'guard';
  st.battle_tactic = tacticId;
  var mySkillIds = equippedSkills(st);
  st.battle_skills = mySkillIds;

  var weather = weatherOf(today);
  var baseMine = combatOf(st);
  var myType = normType(st.battle_type);
  var mine = applyWeather(applyTactic(baseMine, tacticId), myType, weather);
  mine.power = powerOf(mine);
  var foeBond = towerFoeBond(st, floorDef);
  var foe = applyWeather(combatOf({ bond: foeBond }), TOWER_TYPE, weather);
  foe.power = powerOf(foe);
  var foeBuff = towerBuffFor(st, floorDef);

  // seed 带上「这一层已经试了多少次」：同一层反复挑战会拿到不同的随机流，
  // 否则「打不过就是永远打不过」，反复尝试没有任何意义。
  // 但同一次的结果依然可复现（相同 uid + 层 + 次数 + 日期 → 相同战报）。
  var tries = (st.tower_tries && st.tower_tries[String(floorDef.f)]) || 0;
  st.tower_tries = st.tower_tries || {};
  st.tower_tries[String(floorDef.f)] = tries + 1;

  var seed = fnv1a([uid, 'tower', String(floorDef.f), String(tries), today].join('|'));
  var r = simulateBattle(mine, foe, seed, mySkillIds, floorDef.skills || [], foeBuff, { me: myType, foe: TOWER_TYPE });

  st.tower_today = (st.tower_today || 0) + 1;

  var clearedNow = false;
  var gain = 0;
  var fresh = [];
  if (r.win) {
    clearedNow = true;
    gain = TOWER_CLEAR_GAIN;
    st.tower_floor = floorDef.f;
    st.tower_best = Math.max(st.tower_best || 0, floorDef.f);
    // 塔的积分单独记：练习赛积分是社交货币（要跟同学比），
    // 塔是线性进度，两条线混在一个数字里会让人看不懂自己到底在比什么。
    st.tower_points = (st.tower_points || 0) + gain;
    // 塔层里程碑：3/6/10 层各一个，给「爬到哪了」一个说法
    var towerWins = [];
    if (floorDef.f >= 3) towerWins.push('tower_3');
    if (floorDef.f >= 6) towerWins.push('tower_6');
    if (floorDef.f >= 10) towerWins.push('tower_10');
    fresh = unlock(st, towerWins);
  }
  st.tower_last = { at: new Date().toISOString(), f: floorDef.f, win: r.win, rounds: r.rounds };
  pushHistory(st, {
    at: st.tower_last.at,
    kind: 'tower',
    win: r.win,
    title: '第 ' + floorDef.f + ' 层 · ' + floorDef.name,
    sub: '试炼塔 · ' + r.rounds + ' 回合',
    gain: gain,
    points: st.tower_points || 0
  });
  writePet(uid, st);
  // 塔积分也会进榜，所以同样要失效缓存
  shadowCache.at = 0;

  res.json({ code: 200, data: {
    win: r.win,
    floor: floorDef.f,
    cleared: clearedNow,
    rounds: r.rounds,
    steps: r.steps,
    seed: seed,
    me: { name: st.name || '小家伙', power: mine.power, hp: r.maxMe, atk: mine.atk, def: mine.def, spd: mine.spd, crit: mine.crit, type: myType, typeName: ELEMENTS[myType].name, typeIcon: ELEMENTS[myType].icon },
    foe: { name: floorDef.name, power: foe.power, hp: r.maxFoe, atk: foe.atk, def: foe.def, spd: foe.spd, crit: foe.crit, skills: floorDef.skills || [], type: TOWER_TYPE, typeName: ELEMENTS[TOWER_TYPE].name, typeIcon: ELEMENTS[TOWER_TYPE].icon },
    types: { me: myType, foe: TOWER_TYPE, mulMe: typeMul(myType, TOWER_TYPE), mulFoe: typeMul(TOWER_TYPE, myType) },
    gain: gain,
    today: st.tower_today,
    cap: TOWER_DAILY_CAP,
    towerFloor: st.tower_floor || 0,
    towerTotal: TOWER_FLOORS.length,
    towerPoints: st.tower_points || 0,
    skills: mySkillIds,
    foeSkills: floorDef.skills || [],
    unlocked: fresh,
    titles: titlesOf(st),
    weather: weather,
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
  writePet(uid, st);
  res.json({ code: 200, data: { equipped: finalIds, skills: skillsOf(st) } });
});

// ==================== 野生精灵（v0.8.0）====================
// 打野生精灵不消耗练习赛次数，也不涨战力积分：它是「收集」不是「排位」。
// 赢了才有收服判定；输了只是没打过，不掉任何东西。
router.post('/wild/fight', requireAuth, function(req, res) {
  var uid = userId(req);
  var st = readPet(uid);
  if (!st || !st.adopted) return res.status(400).json({ code: 400, message: '还未领养宠物' });

  var w = wildById(req.body && req.body.id);
  if (!w) return res.status(400).json({ code: 400, message: '未知的野生精灵' });
  if (ownedMap(st)[w.id]) return res.status(400).json({ code: 400, message: '这只已经在你的图鉴里了' });

  var today = todayKey();
  if (st.wild_date !== today) { st.wild_date = today; st.wild_today = 0; }

  var tacticId = (req.body && req.body.tactic) || st.battle_tactic || 'guard';
  if (TACTIC_IDS.indexOf(tacticId) < 0) tacticId = 'guard';
  st.battle_tactic = tacticId;
  var mySkillIds = equippedSkills(st);
  st.battle_skills = mySkillIds;

  var weather = weatherOf(today);
  var baseMine = combatOf(st);
  var myType = normType(st.battle_type);
  var mine = applyWeather(applyTactic(baseMine, tacticId), myType, weather);
  mine.power = powerOf(mine);
  var foe = applyWeather(combatOf({ bond: w.bond }), w.type, weather);
  foe.power = powerOf(foe);

  st.wild_tries = st.wild_tries || {};
  var tries = st.wild_tries[w.id] || 0;
  // 每次尝试都换一条随机流：同一只怪反复挑战不会永远同一个结果，
  // 但同一次尝试仍可复现（uid + 怪 + 第几次 + 日期）。
  var seed = fnv1a([uid, 'wild', w.id, String(tries), today].join('|'));
  st.wild_tries[w.id] = tries + 1;

  var spot = spotlightOf(uid, st);
  var chance = captureChanceOf(st, w, spot);
  var r = simulateBattle(mine, foe, seed, mySkillIds, w.skills || [], 1, { me: myType, foe: w.type });

  st.wild_fights = (st.wild_fights || 0) + 1;
  st.wild_today = (st.wild_today || 0) + 1;
  var captured = false;
  var buddySet = false;
  var fresh = [];
  var nextChance = null;

  if (r.win) {
    // 捕捉随机流和战斗随机流分开：换战术/换技能不会改变「这只怪今天给不给」，
    // 否则玩家会开始研究「用什么阵容才能刷出高捕捉率」——那不是收集，是玄学。
    var cr = rngFrom(fnv1a([uid, 'capture', w.id, String(tries), todayKey()].join('|')))();
    captured = cr < chance;
    if (captured) {
      st.dex = st.dex || [];
      st.dex.push(w.id);
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
    me: { name: st.name || '小家伙', power: mine.power, hp: r.maxMe, atk: mine.atk, def: mine.def, spd: mine.spd, crit: mine.crit, type: myType, typeName: ELEMENTS[myType].name, typeIcon: ELEMENTS[myType].icon },
    foe: { name: w.name, power: foe.power, hp: r.maxFoe, atk: foe.atk, def: foe.def, spd: foe.spd, crit: foe.crit, type: w.type, typeName: ELEMENTS[w.type].name, typeIcon: ELEMENTS[w.type].icon },
    creature: wildPublic(w),
    dexCount: (st.dex || []).length,
    dexTotal: WILD.length,
    unlocked: fresh,
    types: { me: myType, foe: w.type, mulMe: typeMul(myType, w.type), mulFoe: typeMul(w.type, myType) },
    weather: weather,
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

module.exports = router;
