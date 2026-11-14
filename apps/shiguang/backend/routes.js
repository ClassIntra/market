// 拾光群岛 —— 世界服务端（v3 · 大世界）
//
// 架构一句话：**服务端是唯一真相**。客户端只发送「意图」（我要往哪走、我要采集、
// 我要点灯、我要种花、我要抛竿），所有合法性判定、资源结算、迷雾揭开都在这里完成，
// 再经平台的 realtimeBus 定向推给在线玩家。
//
// 为什么不自己做 WebSocket 服务器：
//   平台的 market 应用进程反代只支持 HTTP（见 docs/market-dev-guide.md §「独立端口服务形态」），
//   而宿主已经维护了一条带重连/心跳/X5 降级的全局 WS。复用 realtimeBus 既省一条连接，
//   又能让离线用户走 HTTP 长轮询兜底 —— 校园平板的网络环境比机房复杂得多。
//
// 广播策略：不做「一有动作就广播」。服务端维护 dirty 集合，每 200ms 打包一次
// （5Hz）。二十个人同时按方向键时，消息量从 1200 条/秒降到 100 条/秒且每条含多人位移。
//
// v3 新增：160×160 八岛大世界 / NPC 行者（游荡 + 台词）/ 五座石碑（全班共建解锁秘境）
//          / 纸鸢快线（码头跨岛飞行）/ 逐岛钓星特产品 / 灯柱带建造者灯色（星座化）。
'use strict';

var express = require('express');
var path = require('path');
var router = express.Router();
var db = require('_sdk/backend/host').db;
var auth = require('_sdk/backend/host').auth;
var realtimeBus = require('_sdk/backend/host').realtimeBus;
var world = require('./world');

var requireAuth = auth.requireAuth;

// ---------------- 数值参数（集中在这里，方便调平衡） ----------------
var LAMP_COST = 3;             // 一座灯柱消耗的星屑
var ENTER_REVEAL = 7;          // 首次进入时揭开的半径（太小则首屏几乎全黑）
var LAMP_LIGHT_RADIUS = 4;     // 灯柱照亮半径（切比雪夫距离）
var NODE_RESPAWN_MS = 90 * 1000;
var REVEAL_ON_MOVE = 3;        // 走一步揭开的半径
var REVEAL_ON_LAMP = 6;        // 建灯柱揭开的半径
var MOVE_MIN_GAP_MS = 80;      // 服务端移动节流（前端自觉 170ms）
var ONLINE_TTL_MS = 45 * 1000; // 心跳超时即视为离开世界
var BOTTLE_MAX_LEN = 80;
var BOTTLE_COOLDOWN_MS = 4 * 60 * 1000;
var BOTTLE_RADIUS = 3;
var BROADCAST_INTERVAL_MS = 200;

// 种花
var FLOWER_COST = 2;            // 一株光花的星屑
var FLOWER_COOLDOWN_MS = 8 * 1000;
var FLOWER_WORLD_CAP = 600;     // 全世界同时存在的光花上限（160×160 的大世界）
var FLOWER_PLAYER_CAP = 40;     // 每人同时拥有的光花上限
var FLOWER_GROW_MS = 90 * 1000; // 从破土到盛开（客户端按 planted_at 推算生长阶段）
// ---- 作物（2026-11-14）：光花从「纯装饰」升级成「有产出的作物」 ----
// 原来的花种下就永远开着，除了好看没有任何作用 —— 于是「种花」是一次性动作，
// 玩家点一次就再也不会点第二次。改成作物之后，它接上了整个经济：
//   种（2 星屑）→ 浇水（要回来，最多 3 次，每次让成熟提早）→ 收成（8 星屑）
// 于是星屑第一次有了「生产」而不只是「捡」，点灯的钱也有了来源。
var CROP_GROW_MS = 180 * 1000;   // 种下到成熟，3 分钟（一个课间）
var CROP_WATER_CUT_MS = 40 * 1000; // 每次浇水让成熟提早 40 秒
var CROP_WATER_MAX = 3;          // 最多浇 3 次 → 最快 60 秒
var CROP_WATER_GAP_MS = 20 * 1000; // 同一株的浇水中途冷却
var CROP_YIELD = 8;              // 收成
var CROP_HELPER_BONUS = 1;       // 帮别人浇过水的人，收成时也拿 1

// 钓星
var FISH_COOLDOWN_MS = 25 * 1000;
var FISH_SPECIAL_CHANCE = 0.4;  // 命中「本岛特产」的概率（只从特产池里抽）

// 纸鸢快线（码头跨岛飞行）
var FLY_COST = 2;

// 灯柱升级：二级灯柱半径 4→6，外观更亮更高
var UPGRADE_COST = 5;
var LAMP_RADIUS_L2 = 6;

// 送火：把一枚星屑送给身边的同学
var GIVE_COST = 1;
var GIVE_RADIUS = 6;

// 暗涌：全图灯柱周期性变暗 + 雾灵压境 —— 全班必须回到光边
var SURGE_MIN_GAP_MS = 10 * 60 * 1000;
var SURGE_MAX_GAP_MS = 16 * 60 * 1000;
var SURGE_DURATION_MS = 45 * 1000;

// 石碑
var STELE_REWARD = 5;           // 首次唤醒一座石碑的星屑奖励
var STELE_MAX_DIST_SQ = 2.5 * 2.5;  // 触碰距离

// 表情
var EMOTE_COOLDOWN_MS = 2 * 1000;
var EMOTES = ['wave', 'heart', 'note', 'zzz', 'spark', 'ask'];

// NPC 行者：世界里的常驻居民。客户端用 Kenney 精灵绘制，服务端负责游荡与说话。
var NPCS = [
  { id: 'npc_li',   name: '守灯人·栗', role: '守着启明岛灯塔的人', isle: 0, hx: 76, hy: 92, hat: '1', lantern: '0', sprite: 87 },
  { id: 'npc_yao',  name: '观星·遥',   role: '在星坠岛记天的人',   isle: 2, hx: 126, hy: 32, hat: '5', lantern: '1', sprite: 85 },
  { id: 'npc_lu',   name: '泽畔·芦',   role: '拾贝岛码头的渔人',   isle: 4, hx: 56, hy: 128, hat: '2', lantern: '2', sprite: 111 },
  { id: 'npc_lang', name: '花匠·榔',   role: '霜屿上种光花的人',   isle: 5, hx: 110, hy: 72, hat: '4', lantern: '3', sprite: 88 }
];
var NPC_BY_ID = {};
for (var _ni = 0; _ni < NPCS.length; _ni++) NPC_BY_ID[NPCS[_ni].id] = NPCS[_ni];
var NPC_WANDER_MS = 2200;       // 游荡节拍
var NPC_WANDER_RANGE = 7;       // 距锚点的最大切比雪夫距离
var NPC_SPEAK_MS = 11000;       // 说话节拍
var NPC_SPEAK_RADIUS = 8;       // 有玩家在附近才开口

// 台词（下发给客户端，NPC 随机说；索引进 delta.speech）
var SPEECH_LINES = [
  '灯塔的火，一夜都不能断。', '你脚下的星屑，昨天还在云里飘着。',
  '星光落进云海，就成了鱼。', '数到第七颗流星，许的愿会先给听见的人。',
  '雾里的巨树，比群岛老得多。', '芦苇只对安静的人低头。',
  '花要一颗一颗种，光要一盏一盏点。', '今天的风，是从拾贝岛吹来的。',
  '你闻，望潮岛的海是咸的。', '霜屿的夜里，能听见星星结霜。',
  '纸鸢记得每一座码头。', '别在云桥上打盹，会梦游进海里。'
];

// ---------------- NPC 对话 ----------------
// 「有角色没有戏」是这个世界最大的漏洞：NPC 原来只是随机游荡 + 从公共池里抽一句台词，
// 玩家走过他们身边什么也不会发生。这里把 NPC 改成**有记忆的人**：
//   · 每人一套专属台词，按见面次数推进（said 游标落库，跨会话不丢）
//   · 固定台词说完之后进入「动态模式」—— 每句话都从世界的真实状态现算，
//     所以永远不会重复，也永远不会说谎（灯几盏、花几朵、谁来过）。
// 这是「世界是活的」最廉价的实现：不需要真人在线，也能让人感到被记得。
var NPC_TALKS = {
  npc_li: [
    [
      '雾一起来，灯就得有人守。',
      '守了这么久，只守住这一盏。',
      '你手里没有火。去捡三颗星屑 —— 落在草里会自己闪的那些。',
      '够了就沿石板往北走，到灯塔底下。那儿还黑着，点上它。'
    ],
    [
      '还没点上？',
      '星屑落在草里会闪。低头看，别抬头 —— 抬头只有雾。'
    ],
    [
      '看见了。那点火光是你的。',
      '从今夜起，那盏灯认了你。它会替我记着，你来过。'
    ]
  ],
  npc_yao: [
    [
      '嘘。别踩影子。',
      '你抬头看看天 —— 那片黑不是夜，是一笔没被点亮的账。',
      '每十盏灯，天就退一寸。我记了三年，一天不差。',
      '风从西南来的时候，星屑落得最密。记住这个。'
    ],
    [
      '还在走？',
      '走也好。这岛上值得看的东西，都不在路中间。'
    ]
  ],
  npc_lu: [
    [
      '海里有星。',
      '落下来的那些，没死 —— 它们学会了游。',
      '码头上搁着竿。抛出去，等。别急着收。',
      '钓上来的东西会记进你的图鉴。每座岛的水里，游的不是同一批。'
    ],
    [
      '空手？',
      '钓鱼这事，急的人一条也钓不上来。'
    ]
  ],
  npc_lang: [
    [
      '别踩那朵。',
      '花不是种给眼睛的，是种给以后来的人。',
      '你走了以后，它还在这儿开着 —— 这就是种花的全部理由。',
      '两颗星屑一朵。种在路边，别人夜里走路会看见。'
    ],
    [
      '种下去要等一会儿。',
      '它自己会开。你只管种。'
    ]
  ]
};

// 动态台词：轮流播报六种「世界的真实状态」。
// phase 是「固定剧情之后聊到第几轮」，从 0 开始 —— 所以第一次进入动态模式
// 说的就是灯数（玩家最需要知道的那个数字），而不是随机某一条。
function npcDynamicLine(nid, phase, userId) {
  var out = null;
  var slot = phase % 6;
  var total = 0;
  try { total = lampCount(); } catch (e) {}

  if (slot === 0) {
    // 距离下一个阶段还差几盏 —— 这是玩家最需要知道的数字
    var stage = stageFor(total);
    var nextAt = -1;
    for (var i = 0; i < STAGES.length; i++) {
      if (STAGES[i].at > total) { nextAt = STAGES[i].at; break; }
    }
    if (nextAt < 0) {
      out = ['全班已经点了 ' + total + ' 盏灯。', '天亮了。真的亮了。'];
    } else {
      out = ['全班一共点了 ' + total + ' 盏灯。', '再点 ' + (nextAt - total) + ' 盏，天就再退一寸。'];
    }
  } else if (slot === 1) {
    // 最近来过的另一个人 —— 让「世界里有别人」变成一句具体的话
    var who = null;
    try {
      who = db.prepare('SELECT user_id, x, y, last_seen FROM shiguang_players WHERE user_id != ? ORDER BY last_seen DESC LIMIT 1').get(userId);
    } catch (e) {}
    if (who) {
      var nm = userName(who.user_id);
      var when = dayPhrase(who.last_seen);
      out = [nm + ' ' + when + '来过。', '在 (' + who.x + ', ' + who.y + ') 那个地方停了很久。'];
    } else {
      out = ['这片岛上，只有你一个人。', '我没算错 —— 三年了，我数得很清楚。'];
    }
  } else if (slot === 2) {
    var fl = 0;
    try { fl = db.prepare('SELECT COUNT(*) AS c FROM shiguang_flowers').get().c; } catch (e) {}
    if (fl > 0) {
      out = ['地上有 ' + fl + ' 朵光花。', '都是别人种下的。你路过的时候，替我看一眼。'];
    } else {
      out = ['一朵花也没有。', '不是没人来 —— 是没人舍得那两颗星屑。'];
    }
  } else if (slot === 3) {
    var on = online.size;
    if (on > 1) {
      out = ['此刻岛上还有 ' + (on - 1) + ' 个人。', '你们都听得见我说话。这很少见。'];
    } else {
      out = ['现在岛上只有你。', '别怕。灯亮着，我就还在。'];
    }
  } else if (slot === 4) {
    var st = STAGES[stageFor(total)];
    out = ['现在是「' + st.name + '」。', st.desc];
  } else {
    out = ['流星雨来的时候，星屑会自己落下来。', '别跑，站着等 —— 跑起来反而接不住。'];
  }
  return out;
}

// 时间措辞：必须按自然日算，不能按毫秒差。
// 「22 小时前」跨过午夜就是昨天 —— 如果 NPC 把昨天说成今天，
// 这个「会记得你」的世界当场就露馅了。
function dayPhrase(ts) {
  if (!ts) return '很久以前';
  var now = new Date();
  var d = new Date(ts);
  function key(x) { return x.getFullYear() + '-' + x.getMonth() + '-' + x.getDate(); }
  var today = key(now);
  var that = key(d);
  var diffMs = now.getTime() - d.getTime();
  if (today === that) {
    return diffMs < 120000 ? '刚才' : '今天早些时候';
  }
  var y = new Date(now.getTime() - 86400000);
  if (key(y) === that) return '昨天';
  var days = Math.floor(diffMs / 86400000);
  return (days <= 1 ? 1 : days) + ' 天前';
}

// 第一次见面时的「世界开场白」。
// 这是整个应用里最要紧的一句话：它必须让玩家在 5 秒内明白
// ——这个世界里来过别人，而且她记得住。
// 所以不求煽情，只求**每个数字都是真的**：几个人来过、上一个叫什么、在哪儿停的。
function npcWorldIntro(userId) {
  var out = [];
  var total = 0;
  try { total = db.prepare('SELECT COUNT(*) AS c FROM shiguang_players').get().c; } catch (e) {}

  var who = null;
  try {
    who = db.prepare('SELECT user_id, x, y, last_seen FROM shiguang_players WHERE user_id != ? ORDER BY last_seen DESC LIMIT 1').get(userId);
  } catch (e) {}

  if (who) {
    var nm = userName(who.user_id);
    var when = dayPhrase(who.last_seen);
    if (total <= 2) {
      out.push('这半个月只有两个人上过岛。');
      out.push('你，和一个叫 ' + nm + ' 的 —— ' + when + '他还在 (' + who.x + ', ' + who.y + ') 站着。');
    } else {
      out.push('你是第 ' + total + ' 个走到这里的人。');
      out.push('上一个叫 ' + nm + '，' + when + '还在 (' + who.x + ', ' + who.y + ') 那边。');
    }
  } else {
    out.push('你是第一个走到这里的人。');
    out.push('我在这条石板路上守了三年，头一回听见脚步声。');
  }
  return out;
}

// 取下一个 NPC 的对话。返回 { lines, said, fixed }：
//   fixed=true  还在一段固定剧情里（说完 said+1）
//   fixed=false 已经进入动态模式（每次现算，said 也推进，用来轮转话题）
function npcTalkFor(nid, userId) {
  var said = 0;
  try {
    var r = db.prepare('SELECT said FROM shiguang_npc_talk WHERE user_id = ? AND npc_id = ?').get(userId, nid);
    if (r) said = r.said | 0;
  } catch (e) {}

  var script = NPC_TALKS[nid] || [];
  if (said === 0) {
    // 初见：世界开场白 + 这个 NPC 的第一段剧情，拼成一次连续的对话
    var intro = npcWorldIntro(userId);
    var body = script[0] || [];
    return { lines: intro.concat(body), said: 1, fixed: true, step: 0 };
  }
  if (said < script.length) {
    return { lines: script[said], said: said + 1, fixed: true, step: said };
  }
  return { lines: npcDynamicLine(nid, said - script.length, userId), said: said + 1, fixed: false, step: said };
}

// 流星雨
var METEOR_MIN_GAP_MS = 8 * 60 * 1000;    // 两场之间的最小间隔
var METEOR_MAX_GAP_MS = 15 * 60 * 1000;
var METEOR_DURATION_MS = 100 * 1000;
var METEOR_RADIUS = 7;                    // 星屑撒落的半径
var METEOR_NODES = 14;                    // 一场撒多少颗星陨

// 世界阶段：灯柱总数跨过阈值时天光推进一次（大世界，门槛相应抬高）
var STAGES = [
  { at: 0, name: '长夜', desc: '云海吞没了群岛，只剩脚下的微光。' },
  { at: 10, name: '晨光初现', desc: '第一圈灯柱亮起，云海退去了一线。' },
  { at: 30, name: '云开见月', desc: '光连成了路，远处传来潮声。' },
  { at: 60, name: '群星归位', desc: '大灯塔睁开了眼睛，整片群岛都在发亮。' },
  { at: 100, name: '拾光之海', desc: '你们把整片云海，走成了星图。' }
];

// 逐岛钓星特产：岛编号 → 特产鱼 id。在对应岛的码头抛竿，有概率只从特产池抽。
var ISLAND_SPECIAL = {
  0: ['f_glow', 'f_lantern'],   // 启明：灯鱼
  1: ['f_jelly', 'f_moon'],     // 雾隐：海月与月翼
  2: ['f_puffer', 'f_ray'],     // 星坠：陨星与星砂
  3: ['f_chub', 'f_jelly'],     // 拾贝：浅滩常见种
  4: ['f_glow', 'f_aurora'],    // 萤火泽：萤蓝与虹光
  5: ['f_chub', 'f_lantern'],   // 织花谷：花间小鱼
  6: ['f_ray', 'f_whale'],      // 望潮：深水种
  7: ['f_moon', 'f_hour']       // 霜屿：寒水与传说
};

// ---------------- 目录（下发给前端 terrain.catalog） ----------------
// 商店：帽子 / 提灯配色 / 称号。id '0' 一律是默认装，免费且默认拥有。
var SHOP = {
  hat: [
    { id: '0', name: '便装', price: 0 },
    { id: '1', name: '草帽', price: 6 },
    { id: '2', name: '贝雷帽', price: 6 },
    { id: '3', name: '星辉尖帽', price: 8 },
    { id: '4', name: '花环', price: 8 },
    { id: '5', name: '星芒发卡', price: 10 }
  ],
  lantern: [
    { id: '0', name: '暖金', price: 0 },
    { id: '1', name: '月白', price: 4 },
    { id: '2', name: '青碧', price: 5 },
    { id: '3', name: '玫瑰', price: 5 },
    { id: '4', name: '星紫', price: 6 }
  ],
  title: [
    { id: 't_pick', name: '拾光者', price: 0 },
    { id: 't_lamp', name: '点灯人', price: 3 },
    { id: 't_flor', name: '花匠', price: 4 },
    { id: 't_fish', name: '钓星客', price: 5 },
    { id: 't_meteor', name: '追星者', price: 6 },
    { id: 't_pilot', name: '领航员', price: 8 }
  ]
};

// 光花品种（种下时随机定一种，永久的 —— 全班的颜色由每个人的选择汇成）
var FLOWER_SPECIES = ['萤蓝', '暖橘', '月白', '星紫'];

// 星鱼图鉴。权重合计必须 = 1（钓星按累积权重落点）。
// 稀有度：0 常见 / 1 稀有 / 2 史诗 / 3 传说。传说全服播报。
var FISH_TABLE = [
  { id: 'f_chub',    name: '云纹鲹',     rarity: 0, weight: 0.400, shards: 1, note: '云海里最常见的小鱼，成群贴着云面游。' },
  { id: 'f_jelly',   name: '泡泡海月',   rarity: 0, weight: 0.180, shards: 1, note: '半透明的伞盖里兜着一小团光。' },
  { id: 'f_glow',    name: '萤蓝灯鱼',   rarity: 0, weight: 0.120, shards: 1, note: '提着一盏小灯在云缝里找路。' },
  { id: 'f_lantern', name: '拾光灯笼鱼', rarity: 1, weight: 0.100, shards: 2, note: '它头顶的灯，和灯柱是同一种暖色。' },
  { id: 'f_ray',     name: '星砂魟',     rarity: 1, weight: 0.070, shards: 2, note: '翅膀上永远沾着抖不掉的星砂。' },
  { id: 'f_moon',    name: '月翼飞鱼',   rarity: 1, weight: 0.050, shards: 2, note: '只在月光最亮的那片云面起跳。' },
  { id: 'f_puffer',  name: '陨星鲀',     rarity: 2, weight: 0.040, shards: 4, note: '被流星雨砸中过一次，从此一身铁斑。' },
  { id: 'f_aurora',  name: '虹光鳐',     rarity: 2, weight: 0.025, shards: 4, note: '游过的地方会留下一道极光色的痕。' },
  { id: 'f_whale',   name: '星鲸幼崽',   rarity: 3, weight: 0.010, shards: 8, note: '据说鲸群只在拾光之海的上空迁徙。' },
  { id: 'f_hour',    name: '时之沙漏鱼', rarity: 3, weight: 0.005, shards: 8, note: '没人知道它从哪一天开始游，也没人知道到哪天。' }
];

// 任务。引导链按顺序解锁（上一条领了奖，下一条才开始计数）；每日任务并行。
// stat 对应 bumpQuest 的动作名。
var INTRO_DEFS = [
  { key: 'i_walk',   stat: 'walk',    goal: 8,   reward: 2, title: '初次漫步',   desc: '在岛上走走看 —— 走 8 步' },
  { key: 'i_gather', stat: 'gather',  goal: 3,   reward: 3, title: '第一捧星光', desc: '站到光点上采集 3 枚星屑' },
  { key: 'i_lamp',   stat: 'build',   goal: 1,   reward: 4, title: '点亮一盏灯', desc: '集 3 枚星屑，原地「点灯」' },
  { key: 'i_plant',  stat: 'plant',   goal: 1,   reward: 3, title: '种一朵光花', desc: '在草地上种下第一株光花' },
  { key: 'i_fish',   stat: 'fish',    goal: 1,   reward: 3, title: '垂钓云海',   desc: '走上码头，钓起第一条星光' },
  { key: 'i_bottle', stat: 'bottle',  goal: 1,   reward: 4, title: '字条与海',   desc: '放一只漂流瓶，给后来的人' }
];

var DAILY_POOL = [
  { key: 'd_gather', stat: 'gather',  goal: 10,  reward: 3, title: '拾光的日常', desc: '采集 10 枚星屑' },
  { key: 'd_lamp',   stat: 'build',   goal: 2,   reward: 4, title: '长夜点灯人', desc: '点亮 2 座灯柱' },
  { key: 'd_plant',  stat: 'plant',   goal: 3,   reward: 3, title: '花圃值日',   desc: '种下 3 株光花' },
  { key: 'd_fish',   stat: 'fish',    goal: 3,   reward: 3, title: '晨钓',       desc: '钓上 3 条星光' },
  { key: 'd_bottle', stat: 'bottle',  goal: 1,   reward: 2, title: '海风信使',   desc: '放下 1 只漂流瓶' },
  { key: 'd_walk',   stat: 'walk',    goal: 120, reward: 2, title: '环岛散步',   desc: '走 120 步' },
  { key: 'd_meteor', stat: 'meteor',  goal: 3,   reward: 5, title: '追星者',     desc: '流星雨里采 3 颗星陨' },
  { key: 'd_reveal', stat: 'reveal',  goal: 60,  reward: 3, title: '拓荒者',     desc: '揭开 60 格迷雾' }
];
var DAILY_COUNT = 3;

// 成就。stat 是 shiguang_players 的列；special 走专门查询。
var ACH_DEFS = [
  { key: 'a_lamp1',    stat: 'built',    goal: 1,    title: '第一盏灯',   desc: '点亮 1 座灯柱' },
  { key: 'a_lamp10',   stat: 'built',    goal: 10,   title: '灯柱世家',   desc: '点亮 10 座灯柱' },
  { key: 'a_lamp30',   stat: 'built',    goal: 30,   title: '拾光之海',   desc: '点亮 30 座灯柱' },
  { key: 'a_gather25', stat: 'gathered', goal: 25,   title: '星屑收藏家', desc: '累计采集 25 枚星屑' },
  { key: 'a_gather150',stat: 'gathered', goal: 150,  title: '星潮',       desc: '累计采集 150 枚星屑' },
  { key: 'a_reveal300',stat: 'revealed', goal: 300,  title: '云海拓荒',   desc: '揭开 300 格迷雾' },
  { key: 'a_reveal2000',stat:'revealed', goal: 2000, title: '群岛领航员', desc: '揭开 2000 格迷雾' },
  { key: 'a_plant10',  stat: 'planted',  goal: 10,   title: '光花农人',   desc: '亲手种下 10 株光花' },
  { key: 'a_fish10',   stat: 'fished',   goal: 10,   title: '云海钓客',   desc: '钓起 10 条星光' },
  { key: 'a_fish50',   stat: 'fished',   goal: 50,   title: '渔灯满舱',   desc: '钓起 50 条星光' },
  { key: 'a_meteor3',  stat: 'meteors',  goal: 3,    title: '星雨常客',   desc: '经历 3 场流星雨' },
  { key: 'a_legend',   special: 'legend',              title: '传说中的渔获', desc: '钓起一条传说级星光' },
  { key: 'a_collect5', special: 'collect5',            title: '半个博物学家', desc: '图鉴收录 5 种星鱼' },
  { key: 'a_runes',    special: 'runes',               title: '五碑之谜',   desc: '参与唤醒全部五座石碑' }
];

// ---------------- 建表 ----------------
// 全部 IF NOT EXISTS：应用可能被重复安装 / 更新重装，建表必须幂等。
db.exec([
  'CREATE TABLE IF NOT EXISTS shiguang_players (',
  '  user_id TEXT PRIMARY KEY,',
  '  x INTEGER NOT NULL DEFAULT 0,',
  '  y INTEGER NOT NULL DEFAULT 0,',
  '  dir INTEGER NOT NULL DEFAULT 0,',
  '  shards INTEGER NOT NULL DEFAULT 0,',
  '  gathered INTEGER NOT NULL DEFAULT 0,',
  '  built INTEGER NOT NULL DEFAULT 0,',
  '  revealed INTEGER NOT NULL DEFAULT 0,',
  '  joined_at INTEGER NOT NULL DEFAULT 0,',
  '  last_seen INTEGER NOT NULL DEFAULT 0,',
  '  last_move_at INTEGER NOT NULL DEFAULT 0,',
  '  last_bottle_at INTEGER NOT NULL DEFAULT 0',
  ')'
].join('\n'));

db.exec('CREATE TABLE IF NOT EXISTS shiguang_lamps (id INTEGER PRIMARY KEY AUTOINCREMENT, x INTEGER NOT NULL, y INTEGER NOT NULL, user_id TEXT NOT NULL, created_at INTEGER NOT NULL, level INTEGER NOT NULL DEFAULT 1)');
// v4 迁移：老灯柱补 level 列（升级玩法）
try {
  db.prepare("SELECT level FROM shiguang_lamps LIMIT 1").get();
} catch (e) {
  db.exec('ALTER TABLE shiguang_lamps ADD COLUMN level INTEGER NOT NULL DEFAULT 1');
}
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_shiguang_lamp_pos ON shiguang_lamps(x, y)');
db.exec('CREATE TABLE IF NOT EXISTS shiguang_bottles (id INTEGER PRIMARY KEY AUTOINCREMENT, x INTEGER NOT NULL, y INTEGER NOT NULL, user_id TEXT NOT NULL, content TEXT NOT NULL, created_at INTEGER NOT NULL)');
db.exec('CREATE INDEX IF NOT EXISTS idx_shiguang_bottle_pos ON shiguang_bottles(x, y)');
db.exec('CREATE TABLE IF NOT EXISTS shiguang_explored (x INTEGER NOT NULL, y INTEGER NOT NULL, at INTEGER NOT NULL, by_user TEXT NOT NULL DEFAULT \'\', PRIMARY KEY (x, y))');
db.exec('CREATE TABLE IF NOT EXISTS shiguang_nodes (x INTEGER NOT NULL, y INTEGER NOT NULL, ready_at INTEGER NOT NULL, PRIMARY KEY (x, y))');
// v2 新表
db.exec('CREATE TABLE IF NOT EXISTS shiguang_flowers (x INTEGER NOT NULL, y INTEGER NOT NULL, species INTEGER NOT NULL, user_id TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY (x, y))');
db.exec('CREATE INDEX IF NOT EXISTS idx_shiguang_flower_user ON shiguang_flowers(user_id)');
db.exec('CREATE TABLE IF NOT EXISTS shiguang_catches (user_id TEXT NOT NULL, species TEXT NOT NULL, count INTEGER NOT NULL DEFAULT 0, first_at INTEGER NOT NULL, PRIMARY KEY (user_id, species))');
db.exec('CREATE TABLE IF NOT EXISTS shiguang_quests (user_id TEXT NOT NULL, qkey TEXT NOT NULL, kind TEXT NOT NULL, day TEXT NOT NULL DEFAULT \'\', progress INTEGER NOT NULL DEFAULT 0, done INTEGER NOT NULL DEFAULT 0, claimed INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (user_id, qkey))');
db.exec('CREATE TABLE IF NOT EXISTS shiguang_achievements (user_id TEXT NOT NULL, akey TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (user_id, akey))');
db.exec('CREATE TABLE IF NOT EXISTS shiguang_wardrobe (user_id TEXT NOT NULL, kind TEXT NOT NULL, item TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (user_id, kind, item))');
// v3 —— 石碑：全班共建的唤醒记录（x,y 主键；激活人与时间）
db.exec('CREATE TABLE IF NOT EXISTS shiguang_steles (x INTEGER NOT NULL, y INTEGER NOT NULL, user_id TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (x, y))');
// v3.1 —— NPC 对话进度：每人跟每个 NPC 聊到第几句。
// 必须落库：一次会话里聊完就忘，等于「这个世界不记得你」。
db.exec('CREATE TABLE IF NOT EXISTS shiguang_npc_talk (user_id TEXT NOT NULL, npc_id TEXT NOT NULL, said INTEGER NOT NULL DEFAULT 0, at INTEGER NOT NULL, PRIMARY KEY (user_id, npc_id))');

// 光花的作物字段：water 浇过几次、ready_at 何时可收、last_water_by 谁浇的最后一瓢。
// ALTER 没有幂等语法，先查 PRAGMA 再补（和 players 表同一套写法）。
(function ensureFlowerColumns() {
  try {
    var cols = {};
    var rows = db.prepare('PRAGMA table_info(shiguang_flowers)').all();
    for (var i = 0; i < rows.length; i++) cols[rows[i].name] = true;
    if (!cols.water) db.exec('ALTER TABLE shiguang_flowers ADD COLUMN water INTEGER NOT NULL DEFAULT 0');
    if (!cols.ready_at) db.exec('ALTER TABLE shiguang_flowers ADD COLUMN ready_at INTEGER NOT NULL DEFAULT 0');
    if (!cols.last_water_by) db.exec('ALTER TABLE shiguang_flowers ADD COLUMN last_water_by TEXT NOT NULL DEFAULT \'\'');
    if (!cols.water_at) db.exec('ALTER TABLE shiguang_flowers ADD COLUMN water_at INTEGER NOT NULL DEFAULT 0');
    if (!cols.harvested) db.exec('ALTER TABLE shiguang_flowers ADD COLUMN harvested INTEGER NOT NULL DEFAULT 0');
  } catch (e) { /* 表还没建出来：下一个请求会再走一遍 */ }
})();

// v1 → v2 迁移：更新重装时数据保留，players 表需要补新列。
// ALTER TABLE 没有幂等语法，只能先查 PRAGMA 再逐个补。
(function ensureColumns() {
  var want = {
    hat: "TEXT NOT NULL DEFAULT '0'",
    lantern: "TEXT NOT NULL DEFAULT '0'",
    title: 'TEXT NOT NULL DEFAULT \'\'',
    planted: 'INTEGER NOT NULL DEFAULT 0',
    fished: 'INTEGER NOT NULL DEFAULT 0',
    meteors: 'INTEGER NOT NULL DEFAULT 0',
    tutorial: 'INTEGER NOT NULL DEFAULT 0',
    last_fish_at: 'INTEGER NOT NULL DEFAULT 0',
    last_emote_at: 'INTEGER NOT NULL DEFAULT 0',
    last_plant_at: 'INTEGER NOT NULL DEFAULT 0',
    combo: 'INTEGER NOT NULL DEFAULT 0',
    combo_at: 'INTEGER NOT NULL DEFAULT 0'
  };
  try {
    var cols = {};
    var rows = db.prepare('PRAGMA table_info(shiguang_players)').all();
    for (var i = 0; i < rows.length; i++) cols[rows[i].name] = true;
    for (var name in want) {
      if (Object.prototype.hasOwnProperty.call(want, name) && !cols[name]) {
        db.exec('ALTER TABLE shiguang_players ADD COLUMN ' + name + ' ' + want[name]);
      }
    }
  } catch (e) {
    // 表还没建出来（极端时序）不致命：下一请求进来时 ensurePlayer 之前会再走一遍
  }
})();

// ---------------- 内存状态 ----------------
// 探索集合全量驻留内存：80×80 最多 6400 条，占不到 200KB，
// 却能免掉「每走一步查一次库」的读放大。写入用脏队列每 5 秒批量落盘。
var exploredSet = new Set();
var exploredDirty = [];
var exploredFlushTimer = null;

// 在线玩家：userId -> { x, y, dir, name, shards, hat, lantern, title }
// 名字/装扮在这里缓存，广播时就不必每 200ms 回查 users 表。
var online = new Map();
var nameCache = new Map();
var dirty = new Set();
var pendingLamps = [];
var pendingGathers = [];
var pendingPlants = [];
var pendingEmotes = [];
var pendingReveals = [];
var pendingJoins = [];
var pendingLeaves = [];
var pendingAwards = [];      // [{uid, payload}] 定向推给个人（任务/成就）
var pendingSpeech = [];      // [[npcId, lineIdx]] NPC 台词（随 delta 下发）
var disabled = false;

// NPC 行者的内存状态：位置与朝向。不落库 —— 重启后回到锚点重新散步即可。
var npcState = new Map();    // npcId -> { x, y, dir }
(function initNpcs() {
  for (var i = 0; i < NPCS.length; i++) {
    var n = NPCS[i];
    var spot = world.nearestWalkable(n.hx, n.hy);
    npcState.set(n.id, { x: spot.x, y: spot.y, dir: 0, def: n });
  }
})();
var npcDirty = new Set();

// 流星雨：纯内存状态。场次和临时星屑都不落库 —— 活动本来就是「此刻」的事，
// 重启丢一场也就丢一场，不值得为它建表。
var meteor = { active: false, x: 0, y: 0, island: '', endsAt: 0, nodes: {}, startedAt: 0 };
var meteorNextAt = Date.now() + (5 + Math.floor(Math.random() * 6)) * 60 * 1000;

// 暗涌：灯柱集体变暗的生存事件。纯内存状态，重启即清。
var surge = { active: false, endsAt: 0, nextAt: Date.now() + SURGE_MIN_GAP_MS + Math.floor(Math.random() * (SURGE_MAX_GAP_MS - SURGE_MIN_GAP_MS)) };

function key(x, y) { return x + ',' + y; }

// 从库中恢复探索集合。失败（表被卸载）时降级为空集合而不是让整个模块挂掉。
function loadExplored() {
  try {
    var rows = db.prepare('SELECT x, y FROM shiguang_explored').all();
    for (var i = 0; i < rows.length; i++) exploredSet.add(key(rows[i].x, rows[i].y));
  } catch (e) {
    disabled = true;
  }
}
loadExplored();

function flushExplored() {
  if (disabled || !exploredDirty.length) return;
  var batch = exploredDirty;
  exploredDirty = [];
  try {
    var insert = db.prepare('INSERT OR IGNORE INTO shiguang_explored (x, y, at, by_user) VALUES (?, ?, ?, ?)');
    var now = Date.now();
    var tx = db.transaction(function (items) {
      for (var i = 0; i < items.length; i++) insert.run(items[i].x, items[i].y, now, items[i].u || '');
    });
    tx(batch);
  } catch (e) {
    // 卸载后表被 DROP：停掉一切周期任务，避免每分钟刷错误日志
    if (/no such table/i.test(String(e && e.message))) disabled = true;
  }
}

// 揭开半径 r 内的格子（欧氏距离，视觉上是圆形光斑）。
// 早先用切比雪夫距离画的是正方形 —— 玩家一进世界看到的是一个硬边矩形，
// 像渲染出错而不像「灯照到的地方」，实测截图里尤其明显。
// 返回真正新增的坐标 —— 只有新增的才进广播，避免重复数据的流量浪费。
function reveal(cx, cy, r, byUser) {
  var fresh = [];
  var rr = r * r + r;   // +r 让边缘稍微圆润一点，避免小半径下像菱形
  for (var y = cy - r; y <= cy + r; y++) {
    for (var x = cx - r; x <= cx + r; x++) {
      var ddx = x - cx, ddy = y - cy;
      if (ddx * ddx + ddy * ddy > rr) continue;
      if (x < 0 || y < 0 || x >= world.SIZE || y >= world.SIZE) continue;
      if (!world.walkable(x, y)) continue;
      var k = key(x, y);
      if (exploredSet.has(k)) continue;
      exploredSet.add(k);
      exploredDirty.push({ x: x, y: y, u: byUser || '' });
      fresh.push([x, y]);
    }
  }
  if (fresh.length && byUser) {
    try { db.prepare('UPDATE shiguang_players SET revealed = revealed + ? WHERE user_id = ?').run(fresh.length, byUser); } catch (e) {}
  }
  return fresh;
}

function ensureFlushTimer() {
  if (exploredFlushTimer || disabled) return;
  exploredFlushTimer = setInterval(flushExplored, 5000);
  // unref：不让这个定时器把 Node 进程钉住（服务器重启时能干净退出）
  if (exploredFlushTimer.unref) exploredFlushTimer.unref();
}

// ---------------- 玩家 ----------------
function userName(userId) {
  if (nameCache.has(userId)) return nameCache.get(userId);
  var name = null;
  try {
    var row = db.prepare('SELECT net_name, name, user_id FROM users WHERE user_id = ?').get(userId);
    if (row) name = row.net_name || row.name || String(row.user_id);
  } catch (e) {}
  if (!name) name = '拾光者' + String(userId).slice(-3);
  nameCache.set(userId, name);
  return name;
}

function playerRow(userId) {
  try { return db.prepare('SELECT * FROM shiguang_players WHERE user_id = ?').get(userId); } catch (e) { return null; }
}

// 首次进入（或数据被清理后）就地创建一行。出生点做占位处理：
// 若同格已有人，螺旋找一个空位，避免两个人叠在一起分辨不出。
function ensurePlayer(userId) {
  var row = playerRow(userId);
  if (row) return row;
  var spawn = world.nearestWalkable(world.SPAWN.x, world.SPAWN.y);
  var occupied = {};
  online.forEach(function (p) { occupied[key(p.x, p.y)] = true; });
  var guard = 0;
  while (occupied[key(spawn.x, spawn.y)] && guard < 40) {
    guard++;
    var found = false;
    var r = Math.ceil(guard / 2);
    var ring = [
      { x: spawn.x + r, y: spawn.y }, { x: spawn.x - r, y: spawn.y },
      { x: spawn.x, y: spawn.y + r }, { x: spawn.x, y: spawn.y - r },
      { x: spawn.x + r, y: spawn.y + r }, { x: spawn.x - r, y: spawn.y - r }
    ];
    for (var i = 0; i < ring.length; i++) {
      if (world.walkable(ring[i].x, ring[i].y) && !occupied[key(ring[i].x, ring[i].y)]) {
        spawn = ring[i];
        found = true;
        break;
      }
    }
    if (!found && r > 8) break;
  }
  var now = Date.now();
  try {
    db.prepare('INSERT INTO shiguang_players (user_id, x, y, dir, shards, joined_at, last_seen) VALUES (?, ?, ?, 0, 0, ?, ?)')
      .run(userId, spawn.x, spawn.y, now, now);
  } catch (e) {
    // 并发首进：另一请求已插入，直接读回
  }
  row = playerRow(userId);
  if (!row) throw new Error('无法创建角色');
  reveal(spawn.x, spawn.y, 3, userId);
  return row;
}

function playerPublic(row) {
  return {
    id: row.user_id,
    name: userName(row.user_id),
    x: row.x,
    y: row.y,
    dir: row.dir,
    shards: row.shards,
    built: row.built,
    gathered: row.gathered,
    hat: row.hat || '0',
    lantern: row.lantern || '0',
    title: row.title || ''
  };
}

function markOnline(row) {
  online.set(row.user_id, {
    x: row.x, y: row.y, dir: row.dir, shards: row.shards,
    name: userName(row.user_id), hat: row.hat || '0', lantern: row.lantern || '0', title: row.title || ''
  });
  ensureFlushTimer();
  var exists = false;
  for (var i = 0; i < pendingJoins.length; i++) if (pendingJoins[i].id === row.user_id) { exists = true; break; }
  if (!exists) {
    pendingJoins.push({
      id: row.user_id, name: userName(row.user_id), x: row.x, y: row.y, dir: row.dir,
      hat: row.hat || '0', lantern: row.lantern || '0', title: row.title || ''
    });
  }
}

// ---------------- 广播 ----------------
function onlineIds() {
  var ids = [];
  online.forEach(function (_v, k) { ids.push(k); });
  return ids;
}

function lampCount() {
  try {
    var row = db.prepare('SELECT COUNT(*) AS c FROM shiguang_lamps').get();
    return row ? row.c : 0;
  } catch (e) { return 0; }
}

function stageFor(count) {
  var idx = 0;
  for (var i = 0; i < STAGES.length; i++) if (count >= STAGES[i].at) idx = i;
  return idx;
}

function broadcast(event, payload, targetIds) {
  var ids = targetIds || onlineIds();
  if (!ids.length) return;
  try {
    realtimeBus.publishToUsers(ids, {
      type: 'extension_event',
      app_name: 'shiguang',
      event: event,
      payload: payload,
      created_at: new Date().toISOString()
    });
  } catch (e) {}
}

// ---------------- 任务与成就 ----------------

// 当天日期串。每日任务换日重建：旧行的 day 不等于今天 → 重置。
function todayStr() {
  var d = new Date();
  return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
}

// 从池里挑今日 3 个。用日期串做种子取确定性哈希排序 ——
// 全班同一天看到同一组任务，「咱们今天追这个」才成立。
function pickDailies(day) {
  function h(s) {
    var v = 2166136261;
    for (var i = 0; i < s.length; i++) {
      v = v ^ s.charCodeAt(i);
      v = (v * 16777619) >>> 0;
    }
    return v >>> 0;
  }
  var scored = [];
  for (var i = 0; i < DAILY_POOL.length; i++) {
    scored.push({ def: DAILY_POOL[i], score: h(day + ':' + DAILY_POOL[i].key) });
  }
  scored.sort(function (a, b) { return a.score - b.score; });
  return scored.slice(0, DAILY_COUNT).map(function (s) { return s.def; });
}

// 任务行（含自动建行与每日重置）。返回 { intro, daily } 两列。
function questRowsFor(userId) {
  var day = todayStr();
  var rows;
  try {
    rows = db.prepare('SELECT * FROM shiguang_quests WHERE user_id = ?').all(userId);
  } catch (e) { rows = []; }
  var byKey = {};
  for (var i = 0; i < rows.length; i++) byKey[rows[i].qkey] = rows[i];

  // 引导链：保证六行都在
  var insertQuest = db.prepare('INSERT OR IGNORE INTO shiguang_quests (user_id, qkey, kind, day) VALUES (?, ?, \'intro\', ?)');
  for (var a = 0; a < INTRO_DEFS.length; a++) {
    if (!byKey[INTRO_DEFS[a].key]) {
      insertQuest.run(userId, INTRO_DEFS[a].key, day);
      byKey[INTRO_DEFS[a].key] = db.prepare('SELECT * FROM shiguang_quests WHERE user_id = ? AND qkey = ?').get(userId, INTRO_DEFS[a].key);
    }
  }
  // 每日：先按今天日期挑出来；旧行 day 不匹配 → 重置进度
  var dailies = pickDailies(day);
  var upsertDay = db.prepare('INSERT OR IGNORE INTO shiguang_quests (user_id, qkey, kind, day) VALUES (?, ?, \'daily\', ?)');
  var resetDay = db.prepare('UPDATE shiguang_quests SET day = ?, progress = 0, done = 0, claimed = 0 WHERE user_id = ? AND qkey = ? AND day <> ?');
  for (var b = 0; b < dailies.length; b++) {
    var def = dailies[b];
    var row = byKey[def.key];
    if (!row) {
      upsertDay.run(userId, def.key, day);
      row = db.prepare('SELECT * FROM shiguang_quests WHERE user_id = ? AND qkey = ?').get(userId, def.key);
      byKey[def.key] = row;
    } else if (row.day !== day) {
      resetDay.run(day, userId, def.key, day);
      row = db.prepare('SELECT * FROM shiguang_quests WHERE user_id = ? AND qkey = ?').get(userId, def.key);
      byKey[def.key] = row;
    }
    row._def = def;
  }
  for (var c = 0; c < INTRO_DEFS.length; c++) byKey[INTRO_DEFS[c].key]._def = INTRO_DEFS[c];
  return byKey;
}

// 引导链当前激活的任务 key：第一条「未领奖」的。前面的都领完了才轮到它。
function activeIntroKey(byKey) {
  for (var i = 0; i < INTRO_DEFS.length; i++) {
    var row = byKey[INTRO_DEFS[i].key];
    if (row && !row.claimed) return INTRO_DEFS[i].key;
  }
  return null;
}

// 动作计数进任务。引导链只给激活的那条计数；每日任务并行计数。
// done 在这里判定；领奖（claim）才发星屑 —— 引导的节奏感靠「回来领」这一步。
function bumpQuest(userId, stat, n) {
  var byKey = questRowsFor(userId);
  var changed = [];
  var introKey = activeIntroKey(byKey);
  var now = Date.now();

  function feed(row, def) {
    if (row.claimed || row.done) return;
    if (def.stat !== stat) return;
    row.progress = Math.min(def.goal, row.progress + (n || 1));
    if (row.progress >= def.goal) row.done = 1;
    db.prepare('UPDATE shiguang_quests SET progress = ?, done = ? WHERE user_id = ? AND qkey = ?')
      .run(row.progress, row.done, userId, row.qkey);
    changed.push({ key: row.qkey, kind: row.kind, title: def.title, done: !!row.done, reward: def.reward, day: row.day });
  }

  if (introKey && byKey[introKey]) feed(byKey[introKey], byKey[introKey]._def);
  for (var i = 0; i < DAILY_POOL.length; i++) {
    var def = DAILY_POOL[i];
    var row = byKey[def.key];
    if (row && row.kind === 'daily' && row.day === todayStr()) feed(row, def);
  }

  // 完成但未领奖的 → 定向推送提醒（个人事件，走 publishToUsers 单发）
  for (var c = 0; c < changed.length; c++) {
    if (changed[c].done) {
      pendingAwards.push({ uid: userId, payload: { kind: 'quest', questKey: changed[c].key, title: '任务完成 · ' + changed[c].title, desc: '回任务面板领奖 +' + changed[c].reward + ' 星屑' } });
    }
  }
  return now;
}

// 成就评估：全部跑一遍，没解锁的按行/专查判定，解锁的落库 + 定向推送。
function evaluateAchievements(userId) {
  var row = playerRow(userId);
  if (!row) return [];
  var owned = {};
  try {
    var existing = db.prepare('SELECT akey FROM shiguang_achievements WHERE user_id = ?').all(userId);
    for (var i = 0; i < existing.length; i++) owned[existing[i].akey] = true;
  } catch (e) {}
  var unlocked = [];
  for (var a = 0; a < ACH_DEFS.length; a++) {
    var def = ACH_DEFS[a];
    if (owned[def.key]) continue;
    var hit = false;
    if (def.stat) {
      hit = (row[def.stat] || 0) >= def.goal;
    } else if (def.special === 'legend') {
      try {
        hit = !!db.prepare('SELECT 1 FROM shiguang_catches WHERE user_id = ? AND species IN (?, ?)').get(userId, 'f_whale', 'f_hour');
      } catch (e) {}
    } else if (def.special === 'collect5') {
      try {
        hit = db.prepare('SELECT COUNT(*) AS c FROM shiguang_catches WHERE user_id = ?').get(userId).c >= 5;
      } catch (e) {}
    } else if (def.special === 'runes') {
      try {
        hit = db.prepare('SELECT COUNT(*) AS c FROM shiguang_steles').get().c >= world.STELES.length;
      } catch (e) {}
    }
    if (hit) {
      try { db.prepare('INSERT OR IGNORE INTO shiguang_achievements (user_id, akey, at) VALUES (?, ?, ?)').run(userId, def.key, Date.now()); } catch (e) {}
      unlocked.push({ key: def.key, title: def.title, desc: def.desc });
    }
  }
  for (var u = 0; u < unlocked.length; u++) {
    pendingAwards.push({ uid: userId, payload: { kind: 'achv', achKey: unlocked[u].key, title: '成就解锁 · ' + unlocked[u].title, desc: unlocked[u].desc } });
  }
  return unlocked;
}

// ---------------- 流星雨 ----------------

// 开一场：随机岛 + 撒星陨。全服广播一次，节点列表随事件下发，
// 客户端不需要再拉 —— 迟到的人由 heartbeat 的 meteor 字段补齐。
function startMeteor() {
  var island = world.ISLANDS[Math.floor(Math.random() * world.ISLANDS.length)];
  var candidates = world.walkableInRadius(island.cx, island.cy, METEOR_RADIUS);
  // 挑空地：有灯柱的格子跳过（光点叠光点，谁也说不清哪个能采）
  var pool = [];
  for (var i = 0; i < candidates.length; i++) {
    var c = candidates[i];
    var hasLamp = false;
    try { hasLamp = !!db.prepare('SELECT 1 FROM shiguang_lamps WHERE x = ? AND y = ?').get(c.x, c.y); } catch (e) {}
    if (!hasLamp) pool.push(c);
  }
  // 洗牌取前 N 个：Math.random 就够了，这是「今晚哪里下星星」，不需要可复现
  for (var s = pool.length - 1; s > 0; s--) {
    var j = Math.floor(Math.random() * (s + 1));
    var tmp = pool[s]; pool[s] = pool[j]; pool[j] = tmp;
  }
  var picked = pool.slice(0, METEOR_NODES);
  var nodes = {};
  var list = [];
  for (var p = 0; p < picked.length; p++) {
    nodes[key(picked[p].x, picked[p].y)] = true;
    list.push([picked[p].x, picked[p].y]);
  }
  var now = Date.now();
  meteor = { active: true, x: island.cx, y: island.cy, island: island.name, endsAt: now + METEOR_DURATION_MS, nodes: nodes, startedAt: now };
  // 参与感从「收到播报」开始算：此刻在线的人都计入流星雨场次（成就 a_meteor3）
  try {
    var bump = db.prepare('UPDATE shiguang_players SET meteors = meteors + 1 WHERE user_id = ?');
    var ids = onlineIds();
    for (var u = 0; u < ids.length; u++) bump.run(ids[u]);
  } catch (e) {}
  broadcast('shiguang.world.meteor', {
    active: true, x: island.cx, y: island.cy, island: island.name,
    endsAt: meteor.endsAt, nodes: list, startedAt: now
  });
}

function endMeteor() {
  meteor = { active: false, x: 0, y: 0, island: '', endsAt: 0, nodes: {}, startedAt: 0 };
  meteorNextAt = Date.now() + (METEOR_MIN_GAP_MS + Math.floor(Math.random() * (METEOR_MAX_GAP_MS - METEOR_MIN_GAP_MS)));
  broadcast('shiguang.world.meteor', { active: false });
}

function meteorPublic() {
  if (!meteor.active) return null;
  var list = [];
  for (var k in meteor.nodes) {
    if (Object.prototype.hasOwnProperty.call(meteor.nodes, k)) {
      var parts = k.split(',');
      list.push([parseInt(parts[0], 10), parseInt(parts[1], 10)]);
    }
  }
  return { active: true, x: meteor.x, y: meteor.y, island: meteor.island, endsAt: meteor.endsAt, startedAt: meteor.startedAt, nodes: list };
}

// ---------------- 周期任务 ----------------

// 心跳循环：200ms 打包一次脏数据。
// 这个循环只在有人进入世界后才真正有内容可发，空转成本是一次 Set 判空。
var flushTimer = setInterval(function () {
  if (disabled) return;
  try {
    if (!dirty.size && !npcDirty.size && !pendingLamps.length && !pendingGathers.length && !pendingPlants.length
      && !pendingEmotes.length && !pendingJoins.length && !pendingLeaves.length && !pendingReveals.length
      && !pendingAwards.length && !pendingSpeech.length) return;
    var moves = [];
    dirty.forEach(function (uid) {
      var p = online.get(uid);
      if (p) moves.push([uid, p.x, p.y, p.dir, p.hat || '0', p.lantern || '0']);
    });
    // NPC 的位移走同一条 moves 通道：客户端把 NPC 当普通角色渲染（精灵图标记在第 7 位）。
    npcDirty.forEach(function (nid) {
      var n = npcState.get(nid);
      if (n) moves.push([nid, n.x, n.y, n.dir, n.def.hat, n.def.lantern, 1]);
    });
    npcDirty.clear();
    var payload = { moves: moves };
    if (pendingSpeech.length) { payload.speech = pendingSpeech; pendingSpeech = []; }
    if (pendingJoins.length) { payload.joins = pendingJoins; pendingJoins = []; }
    if (pendingLeaves.length) { payload.leaves = pendingLeaves; pendingLeaves = []; }
    if (pendingLamps.length) { payload.lamps = pendingLamps; pendingLamps = []; }
    if (pendingGathers.length) { payload.gathers = pendingGathers; pendingGathers = []; }
    if (pendingPlants.length) { payload.plants = pendingPlants; pendingPlants = []; }
    if (pendingEmotes.length) { payload.emotes = pendingEmotes; pendingEmotes = []; }
    // 点亮揭开的格子量可能很大（一次 121 格），只在量小的时候随 delta 下发，
    // 大量揭开由调用方单独发 shiguang.world.reveal，避免 delta 膨胀。
    if (pendingReveals.length && pendingReveals.length <= 60) { payload.reveals = pendingReveals; pendingReveals = []; }
    dirty.clear();
    broadcast('shiguang.world.delta', payload);

    if (pendingReveals.length > 0) {
      broadcast('shiguang.world.reveal', { cells: pendingReveals });
      pendingReveals = [];
    }
    if (pendingAwards.length) {
      for (var i = 0; i < pendingAwards.length; i++) {
        broadcast('shiguang.you.award', pendingAwards[i].payload, [pendingAwards[i].uid]);
      }
      pendingAwards = [];
    }
  } catch (e) {
    if (/no such table/i.test(String(e && e.message))) disabled = true;
  }
}, BROADCAST_INTERVAL_MS);
if (flushTimer.unref) flushTimer.unref();

// 在线清理 + 流星雨调度：心跳超时的玩家从内存里摘掉并广播 leave；
// 到点开一场流星雨，结束的场次清场。
var sweepTimer = setInterval(function () {
  if (disabled) return;
  try {
    var now = Date.now();
    var gone = [];
    online.forEach(function (p, uid) {
      var row = playerRow(uid);
      if (!row || now - row.last_seen > ONLINE_TTL_MS) gone.push(uid);
    });
    for (var i = 0; i < gone.length; i++) {
      online.delete(gone[i]);
      pendingLeaves.push(gone[i]);
    }
    if (meteor.active) {
      if (now >= meteor.endsAt) endMeteor();
    } else if (now >= meteorNextAt && online.size > 0) {
      // 没人在世界里就不开 —— 流星雨下给空岛看没有意义，白白消耗全服广播
      startMeteor();
    }
    // 暗涌：开/收。与流星雨错峰（同屏两个全服事件太吵）。
    if (surge.active) {
      if (now >= surge.endsAt) {
        surge = { active: false, endsAt: 0, nextAt: now + SURGE_MIN_GAP_MS + Math.floor(Math.random() * (SURGE_MAX_GAP_MS - SURGE_MIN_GAP_MS)) };
        broadcast('shiguang.world.surge', { active: false });
      }
    } else if (now >= surge.nextAt && online.size > 0 && !meteor.active) {
      surge = { active: true, endsAt: now + SURGE_DURATION_MS };
      broadcast('shiguang.world.surge', { active: true, until: surge.endsAt, now: now });
    }
  } catch (e) {
    if (/no such table/i.test(String(e && e.message))) disabled = true;
  }
}, 15000);
if (sweepTimer.unref) sweepTimer.unref();

// NPC 游荡：每 2.2s 一拍，60% 概率走一步，活动范围锁在锚点附近的岛上。
var npcTimer = setInterval(function () {
  if (disabled || online.size === 0) return;
  try {
    npcState.forEach(function (n, nid) {
      if (Math.random() > 0.6) return;
      var dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
      var d = dirs[Math.floor(Math.random() * 4)];
      var nx = n.x + d[0];
      var ny = n.y + d[1];
      var def = n.def;
      if (!world.walkable(nx, ny)) return;
      if (Math.max(Math.abs(nx - def.hx), Math.abs(ny - def.hy)) > NPC_WANDER_RANGE) return;
      var blocked = false;
      online.forEach(function (p) { if (p.x === nx && p.y === ny) blocked = true; });
      npcState.forEach(function (o) { if (o.x === nx && o.y === ny) blocked = true; });
      if (blocked) return;
      n.x = nx; n.y = ny;
      n.dir = d[0] > 0 ? 2 : (d[0] < 0 ? 1 : (d[1] > 0 ? 0 : 3));
      npcDirty.add(nid);
    });
  } catch (e) {
    if (/no such table/i.test(String(e && e.message))) disabled = true;
  }
}, NPC_WANDER_MS);
if (npcTimer.unref) npcTimer.unref();

// NPC 说话：每 11s 一拍，有玩家在附近时 55% 概率冒一句台词。
var npcSpeakTimer = setInterval(function () {
  if (disabled || online.size === 0 || pendingSpeech.length > 4) return;
  try {
    npcState.forEach(function (n, nid) {
      if (Math.random() > 0.55) return;
      var near = false;
      online.forEach(function (p) {
        if (Math.abs(p.x - n.x) <= NPC_SPEAK_RADIUS && Math.abs(p.y - n.y) <= NPC_SPEAK_RADIUS) near = true;
      });
      if (!near) return;
      pendingSpeech.push([nid, Math.floor(Math.random() * SPEECH_LINES.length)]);
    });
  } catch (e) {
    if (/no such table/i.test(String(e && e.message))) disabled = true;
  }
}, NPC_SPEAK_MS);
if (npcSpeakTimer.unref) npcSpeakTimer.unref();

// ---------------- 路由：地形与世界快照 ----------------

// 地形 + 目录只需取一次，客户端长期缓存（带 version 失效）。
// 目录放这里而不是 enter：商店价格 / 图鉴表是「世界规则」，和地形一个更新节奏。
router.get('/terrain', function (req, res) {
  res.json({
    code: 200,
    data: {
      version: world.TERRAIN_VERSION,
      size: world.SIZE,
      cells: world.terrainCells(),
      nodes: world.nodeBits(),
      spawn: world.SPAWN,
      lampCost: LAMP_COST,
      lampRadius: LAMP_LIGHT_RADIUS,
      stages: STAGES,
      flowerCost: FLOWER_COST,
      flowerCap: FLOWER_PLAYER_CAP,
      flowerGrowMs: FLOWER_GROW_MS,
      fishCooldownMs: FISH_COOLDOWN_MS,
      emotes: EMOTES,
      // 岛屿名与位置：明信片邮戳按脚下位置查岛名
      islands: world.ISLANDS.map(function (is) {
        return { name: is.name, cx: is.cx, cy: is.cy, r: is.r, biome: is.biome };
      }),
      shop: SHOP,
      fishTable: FISH_TABLE.map(function (f) {
        // 权重不下发 —— 图鉴只展示稀有度和名字，概率是服务端的秘密，
        // 全班对着权重表算期望会让钓鱼变成查表作业
        return { id: f.id, name: f.name, rarity: f.rarity, shards: f.shards, note: f.note };
      }),
      flowerSpecies: FLOWER_SPECIES,
      // v3：地标 / 石碑 / NPC 台词 —— 世界结构的唯一真相在服务端，客户端只绘制
      landmarks: world.LANDMARKS,
      steles: world.STELES,
      speechLines: SPEECH_LINES
    }
  });
});

// 全量世界：进入时调一次。探索位图用 '0'/'1' 字符串，gzip 后不到 1KB。
router.post('/enter', requireAuth, function (req, res) {
  var userId = String(req.user.user_id);
  var row;
  try { row = ensurePlayer(userId); } catch (e) { return res.status(500).json({ code: 500, message: '世界暂时无法进入' }); }

  var now = Date.now();
  try { db.prepare('UPDATE shiguang_players SET last_seen = ? WHERE user_id = ?').run(now, userId); } catch (e) {}
  row.last_seen = now;

  // ⚠️ 自愈：玩家可能停在一格**不可走**的地面上（地图改版、早期缺少校验的移动接口、
  // 任何异常写入）。此时 /move 会拒绝他的每一步 —— 摇杆拖到底也一动不动，
  // 而客户端救不了自己：坐标是服务端权威下发的。
  // 所以每次进入都校验一次，不合格就挪到最近的可走格并落库。
  if (!world.walkable(row.x, row.y)) {
    var safe = world.nearestWalkable(row.x, row.y);
    try {
      db.prepare('UPDATE shiguang_players SET x = ?, y = ? WHERE user_id = ?')
        .run(safe.x, safe.y, userId);
    } catch (e) {}
    console.log('[shiguang] 自愈：%s 卡在 %d,%d（不可走），挪到 %d,%d',
      userId, row.x, row.y, safe.x, safe.y);
    row.x = safe.x;
    row.y = safe.y;
  }

  var fresh = reveal(row.x, row.y, ENTER_REVEAL, userId);
  markOnline(row);

  // 开放世界的门铃声：有人进岛，全班都该知道 —— 多人感不靠巧合，靠广播。
  (function () {
    var others = [];
    online.forEach(function (p, uid) { if (uid !== userId) others.push(uid); });
    if (others.length) broadcast('shiguang.world.enter', { id: userId, name: row.name, x: row.x, y: row.y }, others);
  })();
  // 进入时推进一次探索落盘，避免刚揭开的格子因进程重启丢失
  flushExplored();

  var lamps = [];
  // 灯柱带建造者的灯色：全班各自的灯色在夜里汇成一片星座（LEFT JOIN 兼容旧数据）
  try {
    lamps = db.prepare("SELECT l.x, l.y, COALESCE(p.lantern, '0') AS c, COALESCE(l.level, 1) AS level FROM shiguang_lamps l LEFT JOIN shiguang_players p ON p.user_id = l.user_id").all();
  } catch (e) {}
  var count = lampCount();
  var stage = stageFor(count);

  var flowers = [];
  try {
    flowers = db.prepare('SELECT x, y, species, user_id, created_at, water, ready_at, last_water_by FROM shiguang_flowers').all();
  } catch (e) {}

  var bits = [];
  for (var y = 0; y < world.SIZE; y++) {
    for (var x = 0; x < world.SIZE; x++) bits.push(exploredSet.has(key(x, y)) ? '1' : '0');
  }

  var players = [];
  online.forEach(function (p, uid) {
    if (uid === userId) return;
    if (String(uid).indexOf('npc_') === 0) return;   // NPC 单独走 npcs 字段
    players.push({ id: uid, name: p.name, x: p.x, y: p.y, dir: p.dir, hat: p.hat || '0', lantern: p.lantern || '0', title: p.title || '' });
  });

  // NPC 行者：进世界就能看见。sprite 是 Kenney 精灵索引（客户端 img/dungeon.png）。
  var npcs = [];
  npcState.forEach(function (n, nid) {
    npcs.push({ id: nid, name: n.def.name, x: n.x, y: n.y, dir: n.dir, hat: n.def.hat, lantern: n.def.lantern, sprite: n.def.sprite });
  });

  // 石碑唤醒状态：activated 的有 by/at
  var steles = [];
  try {
    var activated = {};
    var steleRows = db.prepare('SELECT x, y, user_id, at FROM shiguang_steles').all();
    for (var sr = 0; sr < steleRows.length; sr++) activated[key(steleRows[sr].x, steleRows[sr].y)] = steleRows[sr];
    for (var sd = 0; sd < world.STELES.length; sd++) {
      var sdef = world.STELES[sd];
      var got = activated[key(sdef.x, sdef.y)];
      steles.push({ x: sdef.x, y: sdef.y, name: sdef.name, rune: sdef.rune, isle: sdef.isle, by: got ? got.user_id : null, at: got ? got.at : 0 });
    }
  } catch (e) {
    for (var se = 0; se < world.STELES.length; se++) {
      steles.push({ x: world.STELES[se].x, y: world.STELES[se].y, name: world.STELES[se].name, rune: world.STELES[se].rune, isle: world.STELES[se].isle, by: null, at: 0 });
    }
  }

  // 个人的面板数据：任务 / 衣柜 / 图鉴 / 成就数
  var quests = [];
  try {
    var byKey = questRowsFor(userId);
    for (var qk in byKey) {
      if (!Object.prototype.hasOwnProperty.call(byKey, qk)) continue;
      var q = byKey[qk];
      if (q.kind === 'daily' && q.day !== todayStr()) continue;
      quests.push({ key: q.qkey, kind: q.kind, day: q.day, progress: q.progress, done: q.done, claimed: q.claimed, def: q._def || null });
    }
  } catch (e) {}

  var wardrobe = { owned: {}, hat: row.hat || '0', lantern: row.lantern || '0', title: row.title || '' };
  try {
    var ownedRows = db.prepare('SELECT kind, item FROM shiguang_wardrobe WHERE user_id = ?').all(userId);
    for (var w = 0; w < ownedRows.length; w++) {
      if (!wardrobe.owned[ownedRows[w].kind]) wardrobe.owned[ownedRows[w].kind] = [];
      wardrobe.owned[ownedRows[w].kind].push(ownedRows[w].item);
    }
  } catch (e) {}
  // 默认装（price 0）人人可用
  ['hat', 'lantern', 'title'].forEach(function (kind) {
    var defaults = [];
    for (var s = 0; s < SHOP[kind].length; s++) if (!SHOP[kind][s].price) defaults.push(SHOP[kind][s].id);
    if (!wardrobe.owned[kind]) wardrobe.owned[kind] = [];
    for (var d2 = 0; d2 < defaults.length; d2++) {
      if (wardrobe.owned[kind].indexOf(defaults[d2]) === -1) wardrobe.owned[kind].push(defaults[d2]);
    }
  });

  var collection = [];
  var achCount = 0;
  try {
    collection = db.prepare('SELECT species, count, first_at FROM shiguang_catches WHERE user_id = ?').all(userId);
  } catch (e) {}
  try { achCount = db.prepare('SELECT COUNT(*) AS c FROM shiguang_achievements WHERE user_id = ?').get(userId).c; } catch (e) {}

  res.json({
    code: 200,
    data: {
      me: playerPublic(row),
      explored: bits.join(''),
      lamps: lamps,
      flowers: flowers,
      players: players,
      stage: stage,
      stageInfo: STAGES[stage],
      lampCount: count,
      flowerCount: flowers.length,
      onlineCount: online.size,
      meteor: meteorPublic(),
      surge: surge.active ? { active: true, until: surge.endsAt } : null,
      quests: quests,
      wardrobe: wardrobe,
      collection: collection,
      achCount: achCount,
      npcs: npcs,
      steles: steles,
      reveal: fresh
    }
  });
});

router.post('/leave', requireAuth, function (req, res) {
  var userId = String(req.user.user_id);
  var leaving = online.get(userId);
  online.delete(userId);
  pendingLeaves.push(userId);
  // 离岛也广播：同学能看见「谁还在、谁走了」，世界才有在场感
  if (leaving) broadcast('shiguang.world.leave', { id: userId, name: leaving.name });
  try { db.prepare('UPDATE shiguang_players SET last_seen = 0 WHERE user_id = ?').run(userId); } catch (e) {}
  res.json({ code: 200, message: 'ok' });
});

// 轻量心跳：只回世界指针 + 流星雨状态 + 可领任务数，不传大对象
router.post('/heartbeat', requireAuth, function (req, res) {
  var userId = String(req.user.user_id);
  var row = playerRow(userId);
  if (!row) return res.status(404).json({ code: 404, message: '尚未进入世界' });
  var now = Date.now();
  try { db.prepare('UPDATE shiguang_players SET last_seen = ? WHERE user_id = ?').run(now, userId); } catch (e) {}
  if (!online.has(userId)) {
    row.last_seen = now;
    markOnline(row);
  }
  var count = lampCount();
  var claimable = 0;
  try {
    claimable = db.prepare('SELECT COUNT(*) AS c FROM shiguang_quests WHERE user_id = ? AND done = 1 AND claimed = 0').get(userId).c;
  } catch (e) {}
  res.json({
    code: 200,
    data: {
      onlineCount: online.size,
      lampCount: count,
      stage: stageFor(count),
      serverNow: now,
      meteor: meteorPublic(),
      surge: surge.active ? { active: true, until: surge.endsAt } : null,
      claimable: claimable
    }
  });
});

// 教程看完一次就记档：换设备不再弹（存服务端而不是 storage，是为了「同一账号」语义）
router.post('/tutorial', requireAuth, function (req, res) {
  var userId = String(req.user.user_id);
  try { db.prepare('UPDATE shiguang_players SET tutorial = 1 WHERE user_id = ?').run(userId); } catch (e) {}
  res.json({ code: 200, message: 'ok' });
});

// ---------------- 路由：移动 ----------------

// 四向移动，服务端权威校验。
// 拒绝的情形一律返回 200 + rejected 原因：这是高频操作，用 4xx 会让浏览器控制台
// 刷满红色错误，而「撞到云海」并不是异常，是正常玩法的一部分。
router.post('/move', requireAuth, function (req, res) {
  var userId = String(req.user.user_id);
  var row = playerRow(userId);
  if (!row) return res.status(404).json({ code: 404, message: '尚未进入世界' });

  // 拒绝时一并回传服务端认定的位置：客户端做了乐观移动，收到拒绝必须能校正回来，
  // 否则「网络抖动 + 连按方向键」会让本地虚拟位置越走越偏（画面里人已经飘到云海上）。
  function rejectMove(reason) {
    return res.json({
      code: 200,
      data: { rejected: reason, me: { x: row.x, y: row.y, dir: row.dir } }
    });
  }

  // 同上：万一是在「进入之后」才变成不可走（地图热更），这里也自愈一次，
  // 并把修正后的坐标随拒绝一起回给客户端（客户端收到 me 会直接校正）。
  if (!world.walkable(row.x, row.y)) {
    var heal = world.nearestWalkable(row.x, row.y);
    try {
      db.prepare('UPDATE shiguang_players SET x = ?, y = ? WHERE user_id = ?')
        .run(heal.x, heal.y, userId);
    } catch (e) {}
    console.log('[shiguang] 自愈：%s 卡在 %d,%d（不可走），挪到 %d,%d',
      userId, row.x, row.y, heal.x, heal.y);
    row.x = heal.x;
    row.y = heal.y;
    return rejectMove('healed');
  }

  var body = req.body || {};
  var tx = body.x;
  var ty = body.y;
  var dir = typeof body.dir === 'number' ? body.dir : row.dir;
  if (!Number.isInteger(tx) || !Number.isInteger(ty)) {
    return rejectMove('coords');
  }
  if (tx < 0 || ty < 0 || tx >= world.SIZE || ty >= world.SIZE) {
    return rejectMove('bounds');
  }
  // 只允许走一格：曼哈顿距离 1。防瞬移脚本。
  if (world.stepDistance(row.x, row.y, tx, ty) !== 1) {
    return rejectMove('step');
  }
  if (!world.walkable(tx, ty)) {
    return rejectMove('cloud');
  }
  var now = Date.now();
  if (now - (row.last_move_at || 0) < MOVE_MIN_GAP_MS) {
    return rejectMove('fast');
  }

  try {
    db.prepare('UPDATE shiguang_players SET x = ?, y = ?, dir = ?, last_seen = ?, last_move_at = ? WHERE user_id = ?')
      .run(tx, ty, dir, now, now, userId);
  } catch (e) {
    return res.status(500).json({ code: 500, message: '移动失败' });
  }

  var p = online.get(userId) || { name: userName(userId) };
  p.x = tx; p.y = ty; p.dir = dir;
  if (!p.hat) p.hat = row.hat || '0';
  if (!p.lantern) p.lantern = row.lantern || '0';
  online.set(userId, p);
  dirty.add(userId);

  var fresh = reveal(tx, ty, REVEAL_ON_MOVE, userId);
  if (fresh.length) pendingReveals = pendingReveals.concat(fresh);

  // 引导链第 1 步 / 每日散步：只对真正走成的步数计数
  bumpQuest(userId, 'walk', 1);

  res.json({
    code: 200,
    data: {
      me: { x: tx, y: ty, dir: dir },
      reveal: fresh,
      node: world.hasNode(tx, ty) && nodeReady(tx, ty),
      dock: world.tileAt(tx, ty) === world.TILE.DOCK
    }
  });
});

// ---------------- 路由：采集 ----------------

function nodeReady(x, y) {
  try {
    var row = db.prepare('SELECT ready_at FROM shiguang_nodes WHERE x = ? AND y = ?').get(x, y);
    return !row || row.ready_at <= Date.now();
  } catch (e) { return false; }
}

router.post('/gather', requireAuth, function (req, res) {
  var userId = String(req.user.user_id);
  var row = playerRow(userId);
  if (!row) return res.status(404).json({ code: 404, message: '尚未进入世界' });

  var body = req.body || {};
  var x = body.x;
  var y = body.y;
  if (!Number.isInteger(x) || !Number.isInteger(y)) return res.status(400).json({ code: 400, message: '坐标无效' });
  // 只能采脚下这一格：站得远一点就够不着，避免「隔空吸星屑」
  if (x !== row.x || y !== row.y) return res.json({ code: 200, data: { rejected: 'far' } });

  // 流星雨的临时星陨优先判定 —— 它不在地形位图里，只活在 meteor.nodes 里
  if (meteor.active && meteor.nodes[key(x, y)]) {
    var nowM = Date.now();
    delete meteor.nodes[key(x, y)];
    try {
      db.prepare('UPDATE shiguang_players SET shards = shards + 1, last_seen = ? WHERE user_id = ?').run(nowM, userId);
    } catch (e) {}
    var pm = online.get(userId);
    if (pm) { pm.shards = (pm.shards || 0) + 1; online.set(userId, pm); }
    pendingGathers.push([x, y]);
    bumpQuest(userId, 'meteor', 1);
    evaluateAchievements(userId);
    var updM = playerRow(userId);
    return res.json({
      code: 200,
      data: {
        shards: updM ? updM.shards : 0,
        meteor: true,
        left: Object.keys(meteor.nodes).length
      }
    });
  }

  if (!world.hasNode(x, y)) return res.json({ code: 200, data: { rejected: 'empty' } });
  if (!nodeReady(x, y)) return res.json({ code: 200, data: { rejected: 'cooldown' } });

  var now = Date.now();
  // 连击采集：10 秒内连续采集叠连击，断档清零。
  // 「保持节奏」比「走到就按」多了技巧与规划 —— 连击越高单次收益越高。
  var combo = 1;
  if (now - (row.combo_at || 0) < 10000) combo = (row.combo || 0) + 1;
  var comboBonus = combo >= 8 ? 2 : (combo >= 4 ? 1 : 0);
  var gain = 1 + comboBonus;
  try {
    var tx = db.transaction(function () {
      db.prepare('INSERT INTO shiguang_nodes (x, y, ready_at) VALUES (?, ?, ?) ON CONFLICT(x, y) DO UPDATE SET ready_at = excluded.ready_at')
        .run(x, y, now + NODE_RESPAWN_MS);
      db.prepare('UPDATE shiguang_players SET shards = shards + ?, gathered = gathered + 1, combo = ?, combo_at = ?, last_seen = ? WHERE user_id = ?')
        .run(gain, combo, now, now, userId);
    });
    tx();
  } catch (e) {
    return res.status(500).json({ code: 500, message: '采集失败' });
  }

  var p = online.get(userId);
  if (p) { p.shards = (p.shards || 0) + gain; online.set(userId, p); }
  pendingGathers.push([x, y]);

  var fresh = reveal(x, y, 1, userId);
  if (fresh.length) pendingReveals = pendingReveals.concat(fresh);

  bumpQuest(userId, 'gather', 1);
  evaluateAchievements(userId);

  var updated = playerRow(userId);
  res.json({
    code: 200,
    data: {
      shards: updated ? updated.shards : 0,
      gathered: updated ? updated.gathered : 0,
      combo: combo,
      comboBonus: comboBonus,
      gain: gain,
      respawnIn: Math.round(NODE_RESPAWN_MS / 1000),
      reveal: fresh
    }
  });
});

// ---------------- 路由：建造灯柱 ----------------

router.post('/build', requireAuth, function (req, res) {
  var userId = String(req.user.user_id);
  var row = playerRow(userId);
  if (!row) return res.status(404).json({ code: 404, message: '尚未进入世界' });

  var body = req.body || {};
  var x = Number.isInteger(body.x) ? body.x : row.x;
  var y = Number.isInteger(body.y) ? body.y : row.y;
  if (x !== row.x || y !== row.y) return res.json({ code: 200, data: { rejected: 'far' } });
  if (!world.walkable(x, y)) return res.json({ code: 200, data: { rejected: 'cloud' } });
  if (world.tileAt(x, y) === world.TILE.DOCK) return res.json({ code: 200, data: { rejected: 'dock' } });
  if (row.shards < LAMP_COST) return res.json({ code: 200, data: { rejected: 'shards', need: LAMP_COST, have: row.shards } });

  var existing = null;
  try { existing = db.prepare('SELECT id FROM shiguang_lamps WHERE x = ? AND y = ?').get(x, y); } catch (e) {}
  if (existing) return res.json({ code: 200, data: { rejected: 'occupied' } });
  // 灯柱不能压在光花上：花是别人种下的心意，拔了种灯就变味了
  var flower = null;
  try { flower = db.prepare('SELECT 1 FROM shiguang_flowers WHERE x = ? AND y = ?').get(x, y); } catch (e) {}
  if (flower) return res.json({ code: 200, data: { rejected: 'flower' } });

  var beforeCount = lampCount();
  var beforeStage = stageFor(beforeCount);
  var now = Date.now();
  try {
    var tx = db.transaction(function () {
      db.prepare('INSERT INTO shiguang_lamps (x, y, user_id, created_at, level) VALUES (?, ?, ?, ?, 1)').run(x, y, userId, now);
      db.prepare('UPDATE shiguang_players SET shards = shards - ?, built = built + 1, last_seen = ? WHERE user_id = ?')
        .run(LAMP_COST, now, userId);
    });
    tx();
  } catch (e) {
    return res.status(409).json({ code: 409, message: '这里已经有一座灯柱了' });
  }

  var afterCount = beforeCount + 1;
  var afterStage = stageFor(afterCount);

  var p = online.get(userId);
  if (p) { p.shards = Math.max(0, (p.shards || 0) - LAMP_COST); online.set(userId, p); }
  // 灯柱带上建造者的灯色 —— 夜里远远看去，灯柱是全班每个人的颜色
  pendingLamps.push([x, y, row.lantern || '0', 1]);

  var fresh = reveal(x, y, REVEAL_ON_LAMP, userId);
  if (fresh.length) pendingReveals = pendingReveals.concat(fresh);

  bumpQuest(userId, 'build', 1);
  evaluateAchievements(userId);

  // 天光推进：这是全服事件，单独一条广播，前端会播报 + 放光
  if (afterStage > beforeStage) {
    broadcast('shiguang.world.dawn', {
      stage: afterStage,
      info: STAGES[afterStage],
      lampCount: afterCount,
      by: userName(userId)
    });
  }

  var updated = playerRow(userId);
  res.json({
    code: 200,
    data: {
      shards: updated ? updated.shards : 0,
      built: updated ? updated.built : 0,
      lampCount: afterCount,
      stage: afterStage,
      stageInfo: STAGES[afterStage],
      dawn: afterStage > beforeStage,
      reveal: fresh
    }
  });
});

// ---------------- 路由：种光花 ----------------
// 光花是「第二支笔」：灯柱负责照亮迷雾，光花负责把草地变成每个人的颜色。
// 全班共享、永久存在，种下去就是这个世界的一部分。

router.post('/plant', requireAuth, function (req, res) {
  var userId = String(req.user.user_id);
  var row = playerRow(userId);
  if (!row) return res.status(404).json({ code: 404, message: '尚未进入世界' });

  var body = req.body || {};
  var x = Number.isInteger(body.x) ? body.x : row.x;
  var y = Number.isInteger(body.y) ? body.y : row.y;
  if (x !== row.x || y !== row.y) return res.json({ code: 200, data: { rejected: 'far' } });
  // 只能种在草地上：沙滩保住「镶边」的干净，岩地本来就不是土
  if (world.tileAt(x, y) !== world.TILE.MEADOW) return res.json({ code: 200, data: { rejected: 'ground' } });
  if (row.shards < FLOWER_COST) return res.json({ code: 200, data: { rejected: 'shards', need: FLOWER_COST, have: row.shards } });

  // 占位判定放在冷却之前：「这里已经有一朵花」比「歇 N 秒再种」信息量大得多，
  // 玩家该听到的是与位置相关的原因，而不是一个与位置无关的秒数。
  var exists = null;
  try { exists = db.prepare('SELECT 1 FROM shiguang_flowers WHERE x = ? AND y = ?').get(x, y); } catch (e) {}
  if (exists) return res.json({ code: 200, data: { rejected: 'occupied' } });
  var lamp = null;
  try { lamp = db.prepare('SELECT 1 FROM shiguang_lamps WHERE x = ? AND y = ?').get(x, y); } catch (e) {}
  if (lamp) return res.json({ code: 200, data: { rejected: 'lamp' } });

  var now = Date.now();
  if (now - (row.last_plant_at || 0) < FLOWER_COOLDOWN_MS) {
    var wait = Math.ceil((FLOWER_COOLDOWN_MS - (now - row.last_plant_at)) / 1000);
    return res.json({ code: 200, data: { rejected: 'cooldown', wait: wait } });
  }

  var worldCount = 0;
  var mineCount = 0;
  try {
    worldCount = db.prepare('SELECT COUNT(*) AS c FROM shiguang_flowers').get().c;
    mineCount = db.prepare('SELECT COUNT(*) AS c FROM shiguang_flowers WHERE user_id = ?').get(userId).c;
  } catch (e) {}
  if (worldCount >= FLOWER_WORLD_CAP) return res.json({ code: 200, data: { rejected: 'world_cap' } });
  if (mineCount >= FLOWER_PLAYER_CAP) return res.json({ code: 200, data: { rejected: 'my_cap', cap: FLOWER_PLAYER_CAP } });

  var species = Math.floor(Math.random() * FLOWER_SPECIES.length) % FLOWER_SPECIES.length;
  try {
    var tx2 = db.transaction(function () {
      db.prepare('INSERT INTO shiguang_flowers (x, y, species, user_id, created_at, ready_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(x, y, species, userId, now, now + CROP_GROW_MS);
      db.prepare('UPDATE shiguang_players SET shards = shards - ?, planted = planted + 1, last_seen = ?, last_plant_at = ? WHERE user_id = ?')
        .run(FLOWER_COST, now, now, userId);
    });
    tx2();
  } catch (e) {
    return res.status(409).json({ code: 409, message: '这里已经开了一朵花' });
  }

  var p = online.get(userId);
  if (p) { p.shards = Math.max(0, (p.shards || 0) - FLOWER_COST); online.set(userId, p); }
  pendingPlants.push([x, y, species, userId]);

  bumpQuest(userId, 'plant', 1);
  evaluateAchievements(userId);

  var updated = playerRow(userId);
  res.json({
    code: 200,
    data: {
      shards: updated ? updated.shards : 0,
      planted: updated ? updated.planted : 0,
      species: species,
      speciesName: FLOWER_SPECIES[species],
      readyAt: now + CROP_GROW_MS
    }
  });
});

// ---------- 作物：浇水 ----------
// 为什么浇水值得单独一个接口：它是这套循环里唯一「需要你回来」的动作。
// 不浇水 3 分钟也会熟，浇满 3 次 1 分钟就熟 —— 想快点就得回来。
// 别人也能浇：浇的人最后分 1 星屑，于是「顺手帮个忙」第一次有了回报。
router.post('/flower/water', requireAuth, function (req, res) {
  var userId = String(req.user.user_id);
  var row = playerRow(userId);
  if (!row) return res.status(404).json({ code: 404, message: '尚未进入世界' });

  var f = null;
  try { f = db.prepare('SELECT * FROM shiguang_flowers WHERE x = ? AND y = ?').get(row.x, row.y); } catch (e) {}
  if (!f) return res.json({ code: 200, data: { rejected: 'none' } });

  var now = Date.now();
  var readyAt = f.ready_at || (f.created_at + CROP_GROW_MS);
  if (now >= readyAt) return res.json({ code: 200, data: { rejected: 'ripe' } });
  if ((f.water || 0) >= CROP_WATER_MAX) return res.json({ code: 200, data: { rejected: 'full' } });
  if (f.water_at && now - f.water_at < CROP_WATER_GAP_MS) {
    return res.json({ code: 200, data: { rejected: 'cooldown', wait: Math.ceil((CROP_WATER_GAP_MS - (now - f.water_at)) / 1000) } });
  }

  var nextReady = Math.max(now + 5000, readyAt - CROP_WATER_CUT_MS);
  var water = (f.water || 0) + 1;
  try {
    db.prepare('UPDATE shiguang_flowers SET water = ?, ready_at = ?, water_at = ?, last_water_by = ? WHERE x = ? AND y = ?')
      .run(water, nextReady, now, userId, row.x, row.y);
  } catch (e) {
    return res.status(500).json({ code: 500, message: '浇水失败' });
  }

  bumpQuest(userId, 'water', 1);
  res.json({
    code: 200,
    data: {
      water: water,
      readyAt: nextReady,
      byMe: String(f.user_id) === userId,
      owner: String(f.user_id)
    }
  });
});

// ---------- 作物：收成 ----------
router.post('/flower/harvest', requireAuth, function (req, res) {
  var userId = String(req.user.user_id);
  var row = playerRow(userId);
  if (!row) return res.status(404).json({ code: 404, message: '尚未进入世界' });

  var f = null;
  try { f = db.prepare('SELECT * FROM shiguang_flowers WHERE x = ? AND y = ?').get(row.x, row.y); } catch (e) {}
  if (!f) return res.json({ code: 200, data: { rejected: 'none' } });

  var now = Date.now();
  var readyAt = f.ready_at || (f.created_at + CROP_GROW_MS);
  if (now < readyAt) {
    return res.json({ code: 200, data: { rejected: 'growing', left: Math.ceil((readyAt - now) / 1000) } });
  }
  // 只有主人能收：别人的田不能拔，这是多人底线
  if (String(f.user_id) !== userId) return res.json({ code: 200, data: { rejected: 'notMine' } });

  var got = CROP_YIELD;
  try {
    var tx = db.transaction(function () {
      db.prepare('DELETE FROM shiguang_flowers WHERE x = ? AND y = ?').run(row.x, row.y);
      db.prepare('UPDATE shiguang_players SET shards = shards + ?, last_seen = ? WHERE user_id = ?')
        .run(got, now, userId);
      // 帮过忙的人分一点：这是他「顺手浇过一瓢」的回报
      var helper = String(f.last_water_by || '');
      if (helper && helper !== userId) {
        db.prepare('UPDATE shiguang_players SET shards = shards + ? WHERE user_id = ?')
          .run(CROP_HELPER_BONUS, helper);
      }
    });
    tx();
  } catch (e) {
    return res.status(500).json({ code: 500, message: '收成失败' });
  }

  var p = online.get(userId);
  if (p) { p.shards = (p.shards || 0) + got; online.set(userId, p); }
  pendingPlants.push([row.x, row.y, -1, userId]);
  bumpQuest(userId, 'harvest', 1);
  evaluateAchievements(userId);

  var updated = playerRow(userId);
  res.json({
    code: 200,
    data: {
      shards: updated ? updated.shards : 0,
      got: got,
      species: f.species,
      helped: String(f.last_water_by || '') !== '' && String(f.last_water_by) !== userId
    }
  });
});

// ---------------- 路由：钓星 ----------------
// 站在码头上抛竿。落竿即结算（服务端权威），前端自己放一段收线动画制造悬念。

router.post('/fish', requireAuth, function (req, res) {
  var userId = String(req.user.user_id);
  var row = playerRow(userId);
  if (!row) return res.status(404).json({ code: 404, message: '尚未进入世界' });
  if (world.tileAt(row.x, row.y) !== world.TILE.DOCK) {
    return res.json({ code: 200, data: { rejected: 'ground' } });
  }
  var now = Date.now();
  if (now - (row.last_fish_at || 0) < FISH_COOLDOWN_MS) {
    var wait = Math.ceil((FISH_COOLDOWN_MS - (now - row.last_fish_at)) / 1000);
    return res.json({ code: 200, data: { rejected: 'cooldown', wait: wait } });
  }

  // 逐岛特产：40% 概率只从本岛特产池里抽 —— 「雾隐的海月、望潮的深水种」
  var isle = world.dockMap[key(row.x, row.y)];
  var specials = (typeof isle === 'number' && ISLAND_SPECIAL[isle]) || null;
  var catchDef = null;
  var roll = Math.random();
  if (specials && roll < FISH_SPECIAL_CHANCE) {
    var want = specials[Math.floor(Math.random() * specials.length)];
    catchDef = FISH_TABLE[0];
    for (var sp = 0; sp < FISH_TABLE.length; sp++) {
      if (FISH_TABLE[sp].id === want) { catchDef = FISH_TABLE[sp]; break; }
    }
  } else {
    var acc = 0;
    var roll2 = Math.random();
    catchDef = FISH_TABLE[FISH_TABLE.length - 1];
    for (var i = 0; i < FISH_TABLE.length; i++) {
      acc += FISH_TABLE[i].weight;
      if (roll2 <= acc) { catchDef = FISH_TABLE[i]; break; }
    }
  }

  try {
    var tx3 = db.transaction(function () {
      db.prepare('INSERT INTO shiguang_catches (user_id, species, count, first_at) VALUES (?, ?, 1, ?) ON CONFLICT(user_id, species) DO UPDATE SET count = count + 1')
        .run(userId, catchDef.id, now);
      db.prepare('UPDATE shiguang_players SET shards = shards + ?, fished = fished + 1, last_seen = ?, last_fish_at = ? WHERE user_id = ?')
        .run(catchDef.shards, now, now, userId);
    });
    tx3();
  } catch (e) {
    return res.status(500).json({ code: 500, message: '线断了，稍后再试' });
  }

  var p = online.get(userId);
  if (p) { p.shards = (p.shards || 0) + catchDef.shards; online.set(userId, p); }

  bumpQuest(userId, 'fish', 1);
  evaluateAchievements(userId);

  // 传说级渔获全服播报 —— 这是一条 WS 消息换全班一声「哇」的交易
  if (catchDef.rarity === 3) {
    broadcast('shiguang.world.legend', {
      who: userId, name: userName(userId), species: catchDef.id,
      speciesName: catchDef.name
    });
  }

  var updated = playerRow(userId);
  res.json({
    code: 200,
    data: {
      shards: updated ? updated.shards : 0,
      fished: updated ? updated.fished : 0,
      fish: { id: catchDef.id, name: catchDef.name, rarity: catchDef.rarity, shards: catchDef.shards, note: catchDef.note },
      cooldownMs: FISH_COOLDOWN_MS
    }
  });
});

// ---------------- 路由：表情 ----------------
// 表情不落库，只是 200ms delta 里的一条记录 + 4 秒的气泡。
// 成本极低，却是「岛上有人」最直接的证据。

router.post('/emote', requireAuth, function (req, res) {
  var userId = String(req.user.user_id);
  var row = playerRow(userId);
  if (!row) return res.status(404).json({ code: 404, message: '尚未进入世界' });
  var id = String((req.body && req.body.id) || '');
  if (EMOTES.indexOf(id) === -1) return res.json({ code: 200, data: { rejected: 'unknown' } });
  var now = Date.now();
  if (now - (row.last_emote_at || 0) < EMOTE_COOLDOWN_MS) {
    return res.json({ code: 200, data: { rejected: 'cooldown' } });
  }
  try { db.prepare('UPDATE shiguang_players SET last_emote_at = ? WHERE user_id = ?').run(now, userId); } catch (e) {}
  pendingEmotes.push([userId, id, row.x, row.y]);
  res.json({ code: 200, data: { ok: true } });
});

// ---------------- 路由：漂流瓶 ----------------

// ---------------- 路由：跟 NPC 说话 ----------------
// 客户端靠近 NPC 自动调用。服务端校验距离，防止远程刷剧情。
router.post('/npc/talk', requireAuth, function (req, res) {
  var userId = String(req.user.user_id);
  var nid = String((req.body && req.body.npc) || '');
  var n = npcState.get(nid);
  if (!n) return res.status(404).json({ code: 404, message: '岛上没有这个人' });
  var row = playerRow(userId);
  if (!row) return res.status(404).json({ code: 404, message: '尚未进入世界' });
  // 5 格容差：NPC 在游荡，客户端看到的位置可能比服务端晚一拍
  if (Math.abs(row.x - n.x) > 5 || Math.abs(row.y - n.y) > 5) {
    return res.json({ code: 200, data: { rejected: 'far' } });
  }

  var got = npcTalkFor(nid, userId);
  try {
    db.prepare('INSERT OR REPLACE INTO shiguang_npc_talk (user_id, npc_id, said, at) VALUES (?, ?, ?, ?)')
      .run(userId, nid, got.said, Date.now());
  } catch (e) {}

  res.json({
    code: 200,
    data: {
      npc: nid,
      name: n.def.name,
      role: n.def.role || '岛民',
      lines: got.lines,
      fixed: got.fixed,
      said: got.said
    }
  });
});

router.get('/bottles', requireAuth, function (req, res) {
  var x = parseInt(req.query.x, 10);
  var y = parseInt(req.query.y, 10);
  if (!Number.isInteger(x) || !Number.isInteger(y)) return res.status(400).json({ code: 400, message: '坐标无效' });
  var r = Math.min(6, Math.max(1, parseInt(req.query.r, 10) || BOTTLE_RADIUS));
  var rows = [];
  try {
    rows = db.prepare('SELECT id, x, y, user_id, content, created_at FROM shiguang_bottles WHERE x BETWEEN ? AND ? AND y BETWEEN ? AND ? ORDER BY id DESC LIMIT 30')
      .all(x - r, x + r, y - r, y + r);
  } catch (e) {}
  res.json({
    code: 200,
    data: {
      bottles: rows.map(function (b) {
        return { id: b.id, x: b.x, y: b.y, userId: b.user_id, name: userName(b.user_id), content: b.content, at: b.created_at };
      })
    }
  });
});

router.post('/bottles', requireAuth, function (req, res) {
  var userId = String(req.user.user_id);
  var row = playerRow(userId);
  if (!row) return res.status(404).json({ code: 404, message: '尚未进入世界' });

  var content = String((req.body && req.body.content) || '').trim();
  if (!content) return res.status(400).json({ code: 400, message: '写点什么再放下' });
  if (content.length > BOTTLE_MAX_LEN) {
    content = content.slice(0, BOTTLE_MAX_LEN);
    // 截断落在 emoji 代理对中间会变成乱码方块，退一个码元
    if (/[\uD800-\uDBFF]$/.test(content)) content = content.slice(0, -1);
  }

  var now = Date.now();
  if (now - (row.last_bottle_at || 0) < BOTTLE_COOLDOWN_MS) {
    var wait = Math.ceil((BOTTLE_COOLDOWN_MS - (now - row.last_bottle_at)) / 1000);
    return res.status(429).json({ code: 429, message: '歇一会儿再写吧（还需 ' + wait + ' 秒）' });
  }

  try {
    var result = db.prepare('INSERT INTO shiguang_bottles (x, y, user_id, content, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(row.x, row.y, userId, content, now);
    db.prepare('UPDATE shiguang_players SET last_bottle_at = ? WHERE user_id = ?').run(now, userId);
    broadcast('shiguang.bottle.new', { id: result.lastInsertRowid, x: row.x, y: row.y, name: userName(userId) });
    bumpQuest(userId, 'bottle', 1);
    evaluateAchievements(userId);
    res.status(201).json({
      code: 201,
      data: { id: result.lastInsertRowid, x: row.x, y: row.y, content: content, name: userName(userId), at: now }
    });
  } catch (e) {
    res.status(500).json({ code: 500, message: '瓶子没能放进海里' });
  }
});

// ---------------- 路由：任务 / 成就 / 图鉴 ----------------

router.get('/quests', requireAuth, function (req, res) {
  var userId = String(req.user.user_id);
  var byKey = questRowsFor(userId);
  var intro = [];
  var daily = [];
  for (var i = 0; i < INTRO_DEFS.length; i++) {
    var row = byKey[INTRO_DEFS[i].key];
    intro.push({ key: row.qkey, progress: row.progress, done: row.done, claimed: row.claimed, def: row._def });
  }
  for (var d = 0; d < DAILY_POOL.length; d++) {
    var def = DAILY_POOL[d];
    var row2 = byKey[def.key];
    // 池里今天没被选中的任务不发 —— 客户端不用再猜哪些是今日的
    if (!row2 || row2.kind !== 'daily' || row2.day !== todayStr()) continue;
    daily.push({ key: row2.qkey, progress: row2.progress, done: row2.done, claimed: row2.claimed, def: row2._def });
  }
  res.json({ code: 200, data: { intro: intro, daily: daily } });
});

router.post('/quests/claim', requireAuth, function (req, res) {
  var userId = String(req.user.user_id);
  var qkey = String((req.body && req.body.key) || '');
  var row = null;
  try { row = db.prepare('SELECT * FROM shiguang_quests WHERE user_id = ? AND qkey = ?').get(userId, qkey); } catch (e) {}
  if (!row) return res.status(404).json({ code: 404, message: '没有这个任务' });
  var def = null;
  if (row.kind === 'intro') {
    for (var i = 0; i < INTRO_DEFS.length; i++) if (INTRO_DEFS[i].key === qkey) def = INTRO_DEFS[i];
  } else {
    // 每日任务必须「今天的」才能领 —— 换了天旧进度自动清零，这里再拦一次
    for (var d = 0; d < DAILY_POOL.length; d++) if (DAILY_POOL[d].key === qkey && row.day === todayStr()) def = DAILY_POOL[d];
  }
  if (!def) return res.status(404).json({ code: 404, message: '任务已过期' });
  if (row.claimed) return res.json({ code: 200, data: { rejected: 'claimed' } });
  if (!row.done) return res.json({ code: 200, data: { rejected: 'not_done' } });

  var now = Date.now();
  try {
    var tx = db.transaction(function () {
      db.prepare('UPDATE shiguang_quests SET claimed = 1 WHERE user_id = ? AND qkey = ?').run(userId, qkey);
      db.prepare('UPDATE shiguang_players SET shards = shards + ? WHERE user_id = ?').run(def.reward, userId);
    });
    tx();
  } catch (e) {
    return res.status(500).json({ code: 500, message: '领奖失败' });
  }

  var p = online.get(userId);
  if (p) { p.shards = (p.shards || 0) + def.reward; online.set(userId, p); }

  var updated = playerRow(userId);
  res.json({
    code: 200,
    data: {
      key: qkey,
      reward: def.reward,
      shards: updated ? updated.shards : 0,
      nextIntro: activeIntroKey(questRowsFor(userId))
    }
  });
});

router.get('/achievements', requireAuth, function (req, res) {
  var userId = String(req.user.user_id);
  evaluateAchievements(userId);   // 查看即评估：打开面板就能看到刚跨过的门槛
  var owned = {};
  try {
    var rows = db.prepare('SELECT akey, at FROM shiguang_achievements WHERE user_id = ?').all(userId);
    for (var i = 0; i < rows.length; i++) owned[rows[i].akey] = rows[i].at;
  } catch (e) {}
  var list = [];
  for (var a = 0; a < ACH_DEFS.length; a++) {
    var def = ACH_DEFS[a];
    list.push({ key: def.key, title: def.title, desc: def.desc, at: owned[def.key] || 0 });
  }
  var count = 0;
  for (var k in owned) if (Object.prototype.hasOwnProperty.call(owned, k)) count++;
  res.json({ code: 200, data: { list: list, count: count, total: ACH_DEFS.length } });
});

router.get('/collection', requireAuth, function (req, res) {
  var userId = String(req.user.user_id);
  var rows = [];
  try { rows = db.prepare('SELECT species, count, first_at FROM shiguang_catches WHERE user_id = ?').all(userId); } catch (e) {}
  var byId = {};
  for (var i = 0; i < rows.length; i++) byId[rows[i].species] = rows[i];
  var list = [];
  for (var f = 0; f < FISH_TABLE.length; f++) {
    var def = FISH_TABLE[f];
    var got = byId[def.id];
    list.push({ id: def.id, name: got ? def.name : '', rarity: def.rarity, shards: def.shards, note: got ? def.note : '', count: got ? got.count : 0, firstAt: got ? got.first_at : 0 });
  }
  var kinds = 0;
  for (var k in byId) if (Object.prototype.hasOwnProperty.call(byId, k)) kinds++;
  res.json({ code: 200, data: { list: list, kinds: kinds, total: FISH_TABLE.length } });
});

// ---------------- 路由：拾光商店（装扮） ----------------

router.get('/wardrobe', requireAuth, function (req, res) {
  var userId = String(req.user.user_id);
  var row = playerRow(userId);
  var owned = {};
  try {
    var rows = db.prepare('SELECT kind, item FROM shiguang_wardrobe WHERE user_id = ?').all(userId);
    for (var i = 0; i < rows.length; i++) {
      if (!owned[rows[i].kind]) owned[rows[i].kind] = [];
      owned[rows[i].kind].push(rows[i].item);
    }
  } catch (e) {}
  ['hat', 'lantern', 'title'].forEach(function (kind) {
    var defaults = [];
    for (var s = 0; s < SHOP[kind].length; s++) if (!SHOP[kind][s].price) defaults.push(SHOP[kind][s].id);
    if (!owned[kind]) owned[kind] = [];
    for (var d2 = 0; d2 < defaults.length; d2++) {
      if (owned[kind].indexOf(defaults[d2]) === -1) owned[kind].push(defaults[d2]);
    }
  });
  res.json({
    code: 200,
    data: {
      shop: SHOP,
      owned: owned,
      equipped: { hat: (row && row.hat) || '0', lantern: (row && row.lantern) || '0', title: (row && row.title) || '' }
    }
  });
});

router.post('/wardrobe/buy', requireAuth, function (req, res) {
  var userId = String(req.user.user_id);
  var kind = String((req.body && req.body.kind) || '');
  var item = String((req.body && req.body.item) || '');
  if (!SHOP[kind]) return res.json({ code: 200, data: { rejected: 'kind' } });
  var def = null;
  for (var i = 0; i < SHOP[kind].length; i++) if (SHOP[kind][i].id === item) def = SHOP[kind][i];
  if (!def) return res.json({ code: 200, data: { rejected: 'item' } });
  if (!def.price) return res.json({ code: 200, data: { rejected: 'free' } });

  var dup = false;
  try { dup = !!db.prepare('SELECT 1 FROM shiguang_wardrobe WHERE user_id = ? AND kind = ? AND item = ?').get(userId, kind, item); } catch (e) {}
  if (dup) return res.json({ code: 200, data: { rejected: 'owned' } });

  var row = playerRow(userId);
  if (!row || row.shards < def.price) return res.json({ code: 200, data: { rejected: 'shards', need: def.price, have: row ? row.shards : 0 } });

  try {
    var tx = db.transaction(function () {
      db.prepare('INSERT INTO shiguang_wardrobe (user_id, kind, item, at) VALUES (?, ?, ?, ?)').run(userId, kind, item, Date.now());
      db.prepare('UPDATE shiguang_players SET shards = shards - ? WHERE user_id = ?').run(def.price, userId);
    });
    tx();
  } catch (e) {
    return res.status(500).json({ code: 500, message: '购买失败' });
  }
  var p = online.get(userId);
  if (p) { p.shards = Math.max(0, (p.shards || 0) - def.price); online.set(userId, p); }

  var updated = playerRow(userId);
  res.json({ code: 200, data: { shards: updated ? updated.shards : 0, kind: kind, item: item } });
});

router.post('/wardrobe/equip', requireAuth, function (req, res) {
  var userId = String(req.user.user_id);
  var kind = String((req.body && req.body.kind) || '');
  var item = String((req.body && req.body.item) || '');
  if (['hat', 'lantern', 'title'].indexOf(kind) === -1) return res.json({ code: 200, data: { rejected: 'kind' } });
  var def = null;
  for (var i = 0; i < SHOP[kind].length; i++) if (SHOP[kind][i].id === item) def = SHOP[kind][i];
  if (!def) return res.json({ code: 200, data: { rejected: 'item' } });
  var owned = !def.price;
  if (!owned) {
    try { owned = !!db.prepare('SELECT 1 FROM shiguang_wardrobe WHERE user_id = ? AND kind = ? AND item = ?').get(userId, kind, item); } catch (e) {}
  }
  if (!owned) return res.json({ code: 200, data: { rejected: 'not_owned' } });

  var col = kind === 'hat' ? 'hat' : (kind === 'lantern' ? 'lantern' : 'title');
  try { db.prepare('UPDATE shiguang_players SET ' + col + ' = ? WHERE user_id = ?').run(item, userId); } catch (e) {}

  var p = online.get(userId);
  if (p) {
    if (kind === 'title') p.title = item; else p[kind] = item;
    online.set(userId, p);
    // 装扮是别人看得见的：立刻把自己标脏，下一次 delta 就带上新装扮
    dirty.add(userId);
    // 帽子/提灯变了要重发一次 join（后进的人靠 enter、在场的靠 moves —— moves 已带）
  }

  res.json({ code: 200, data: { kind: kind, item: item } });
});

// ---------------- 路由：石碑与纸鸢快线 ----------------

// 石碑：走近（≤2.5 格）才能触碰；第一人唤醒，全班受益。
router.post('/stele', requireAuth, function (req, res) {
  var userId = String(req.user.user_id);
  var row = playerRow(userId);
  if (!row) return res.status(404).json({ code: 404, message: '尚未进入世界' });

  var body = req.body || {};
  var sx = Number.isInteger(body.x) ? body.x : row.x;
  var sy = Number.isInteger(body.y) ? body.y : row.y;
  var near = world.nearestStele(row.x, row.y);
  if (!near.stele || near.distSq > STELE_MAX_DIST_SQ) {
    return res.json({ code: 200, data: { rejected: 'far' } });
  }
  var stele = near.stele;
  if (stele.x !== sx || stele.y !== sy) {
    return res.json({ code: 200, data: { rejected: 'far' } });
  }

  var existing = null;
  try { existing = db.prepare('SELECT 1 FROM shiguang_steles WHERE x = ? AND y = ?').get(stele.x, stele.y); } catch (e) {}
  if (existing) return res.json({ code: 200, data: { rejected: 'done' } });

  var now = Date.now();
  try {
    var tx = db.transaction(function () {
      db.prepare('INSERT INTO shiguang_steles (x, y, user_id, at) VALUES (?, ?, ?, ?)').run(stele.x, stele.y, userId, now);
      db.prepare('UPDATE shiguang_players SET shards = shards + ? WHERE user_id = ?').run(STELE_REWARD, userId);
    });
    tx();
  } catch (e) {
    return res.status(500).json({ code: 500, message: '石碑没有回应' });
  }

  var p = online.get(userId);
  if (p) { p.shards = (p.shards || 0) + STELE_REWARD; online.set(userId, p); }

  var count = 0;
  try { count = db.prepare('SELECT COUNT(*) AS c FROM shiguang_steles').get().c; } catch (e) {}

  broadcast('shiguang.world.stele', {
    x: stele.x, y: stele.y, name: stele.name, rune: stele.rune,
    by: userName(userId), count: count, total: world.STELES.length
  });

  if (count >= world.STELES.length) {
    try {
      db.prepare('INSERT OR IGNORE INTO shiguang_achievements (user_id, akey, at) VALUES (?, ?, ?)').run(userId, 'a_runes', now);
    } catch (e) {}
    pendingAwards.push({ uid: userId, payload: { kind: 'achv', achKey: 'a_runes', title: '成就解锁 · 五碑之谜', desc: '五座石碑全部苏醒，秘境之门开启' } });
    broadcast('shiguang.world.secret', { by: userName(userId), at: now });
  }

  var updated = playerRow(userId);
  res.json({
    code: 200,
    data: {
      shards: updated ? updated.shards : 0,
      name: stele.name, rune: stele.rune,
      count: count, total: world.STELES.length,
      reward: STELE_REWARD
    }
  });
});

// 纸鸢快线：码头登鸢，2 星屑跨岛。
router.post('/fly', requireAuth, function (req, res) {
  var userId = String(req.user.user_id);
  var row = playerRow(userId);
  if (!row) return res.status(404).json({ code: 404, message: '尚未进入世界' });
  if (world.tileAt(row.x, row.y) !== world.TILE.DOCK) {
    return res.json({ code: 200, data: { rejected: 'ground' } });
  }
  var isle = Number((req.body && req.body.isle));
  if (!Number.isInteger(isle) || isle < 0 || isle >= world.ISLANDS.length) {
    return res.json({ code: 200, data: { rejected: 'isle' } });
  }
  var target = world.ISLANDS[isle];
  var head = target._dockHead;
  if (!head) return res.json({ code: 200, data: { rejected: 'isle' } });
  if (row.shards < FLY_COST) return res.json({ code: 200, data: { rejected: 'shards', need: FLY_COST, have: row.shards } });

  var dest = world.nearestWalkable(head.x, head.y);
  var now = Date.now();
  try {
    db.prepare('UPDATE shiguang_players SET x = ?, y = ?, shards = shards - ?, last_seen = ? WHERE user_id = ?')
      .run(dest.x, dest.y, FLY_COST, now, userId);
  } catch (e) {
    return res.status(500).json({ code: 500, message: '纸鸢没有来' });
  }

  var p = online.get(userId);
  if (p) { p.x = dest.x; p.y = dest.y; p.shards = Math.max(0, (p.shards || 0) - FLY_COST); online.set(userId, p); }
  dirty.add(userId);

  var fresh = reveal(dest.x, dest.y, 8, userId);
  if (fresh.length) pendingReveals = pendingReveals.concat(fresh);

  var updated = playerRow(userId);
  res.json({
    code: 200,
    data: {
      x: dest.x, y: dest.y,
      isle: isle, isleName: target.name,
      shards: updated ? updated.shards : 0,
      reveal: fresh
    }
  });
});

// ---------------- 路由：灯柱升级与送火 ----------------

// 灯柱升级：站在灯柱格或相邻格，5 星屑，半径 4→6。
// 点灯从一次性变成空间规划谜题 —— 「这两根二级灯柱的圈能不能接上」。
router.post('/upgrade', requireAuth, function (req, res) {
  var userId = String(req.user.user_id);
  var row = playerRow(userId);
  if (!row) return res.status(404).json({ code: 404, message: '尚未进入世界' });

  var body = req.body || {};
  var x = Number.isInteger(body.x) ? body.x : row.x;
  var y = Number.isInteger(body.y) ? body.y : row.y;
  var lamp = null;
  try { lamp = db.prepare('SELECT x, y, user_id, level FROM shiguang_lamps WHERE x = ? AND y = ?').get(x, y); } catch (e) {}
  if (!lamp) return res.json({ code: 200, data: { rejected: 'no_lamp' } });
  if (lamp.level >= 2) return res.json({ code: 200, data: { rejected: 'max' } });
  // 必须站在灯柱格或相邻格
  if (Math.abs(row.x - x) > 1 || Math.abs(row.y - y) > 1) {
    return res.json({ code: 200, data: { rejected: 'far' } });
  }
  if (row.shards < UPGRADE_COST) return res.json({ code: 200, data: { rejected: 'shards', need: UPGRADE_COST, have: row.shards } });

  var now = Date.now();
  try {
    var tx = db.transaction(function () {
      db.prepare('UPDATE shiguang_lamps SET level = 2 WHERE x = ? AND y = ?').run(x, y);
      db.prepare('UPDATE shiguang_players SET shards = shards - ?, last_seen = ? WHERE user_id = ?').run(UPGRADE_COST, now, userId);
    });
    tx();
  } catch (e) {
    return res.status(500).json({ code: 500, message: '升级失败' });
  }

  var p = online.get(userId);
  if (p) { p.shards = Math.max(0, (p.shards || 0) - UPGRADE_COST); online.set(userId, p); }
  broadcast('shiguang.world.lamp_up', { x: x, y: y, by: userName(userId), level: 2 });

  var updated = playerRow(userId);
  res.json({
    code: 200,
    data: { shards: updated ? updated.shards : 0, x: x, y: y, level: 2, cost: UPGRADE_COST }
  });
});

// 送火：把一枚星屑送给 6 格内的在线同学。星屑不可转账（防刷），
// 「送火」是唯一的赠予通道 —— 一次一枚，亲手点过去。
router.post('/give', requireAuth, function (req, res) {
  var userId = String(req.user.user_id);
  var row = playerRow(userId);
  if (!row) return res.status(404).json({ code: 404, message: '尚未进入世界' });

  var body = req.body || {};
  var to = String(body.to || '');
  if (!to || to === userId || to.indexOf('npc_') === 0) {
    return res.json({ code: 200, data: { rejected: 'who' } });
  }
  var target = null;
  online.forEach(function (p, uid) {
    if (uid === to) target = p;
  });
  if (!target) return res.json({ code: 200, data: { rejected: 'offline' } });
  if (Math.abs(target.x - row.x) > GIVE_RADIUS || Math.abs(target.y - row.y) > GIVE_RADIUS) {
    return res.json({ code: 200, data: { rejected: 'far' } });
  }
  if (row.shards < GIVE_COST) return res.json({ code: 200, data: { rejected: 'shards', need: GIVE_COST, have: row.shards } });

  var now = Date.now();
  try {
    var tx = db.transaction(function () {
      db.prepare('UPDATE shiguang_players SET shards = shards - ?, last_seen = ? WHERE user_id = ?').run(GIVE_COST, now, userId);
      db.prepare('UPDATE shiguang_players SET shards = shards + ?, last_seen = ? WHERE user_id = ?').run(GIVE_COST, now, to);
    });
    tx();
  } catch (e) {
    return res.status(500).json({ code: 500, message: '星屑没能送出去' });
  }

  var p = online.get(userId);
  if (p) { p.shards = Math.max(0, (p.shards || 0) - GIVE_COST); online.set(userId, p); }
  var tp = online.get(to);
  if (tp) { tp.shards = (tp.shards || 0) + GIVE_COST; online.set(to, tp); }

  // 双端定向通知：送礼人「送出」、收礼人「收到」
  broadcast('shiguang.you.gave', { from: userId, fromName: userName(userId), to: to, toName: userName(to) }, [userId, to]);

  var updated = playerRow(userId);
  res.json({
    code: 200,
    data: {
      shards: updated ? updated.shards : 0,
      to: to, toName: userName(to)
    }
  });
});

// ---------------- 路由：排行与世界总览 ----------------

router.get('/rank', requireAuth, function (req, res) {
  var gathered = [];
  var builders = [];
  var explorers = [];
  var fishers = [];
  try {
    gathered = db.prepare('SELECT user_id, gathered FROM shiguang_players WHERE gathered > 0 ORDER BY gathered DESC LIMIT 20').all();
    builders = db.prepare('SELECT user_id, built FROM shiguang_players WHERE built > 0 ORDER BY built DESC, user_id LIMIT 20').all();
    explorers = db.prepare('SELECT user_id, revealed FROM shiguang_players WHERE revealed > 0 ORDER BY revealed DESC LIMIT 20').all();
    fishers = db.prepare('SELECT user_id, fished FROM shiguang_players WHERE fished > 0 ORDER BY fished DESC, user_id LIMIT 20').all();
  } catch (e) {}
  function pack(rows, field) {
    return rows.map(function (r) {
      return { name: userName(r.user_id), value: r[field], userId: r.user_id };
    });
  }
  var count = lampCount();
  var stage = stageFor(count);
  var bottleCount = 0;
  var flowerCount = 0;
  try { bottleCount = db.prepare('SELECT COUNT(*) AS c FROM shiguang_bottles').get().c; } catch (e) {}
  try { flowerCount = db.prepare('SELECT COUNT(*) AS c FROM shiguang_flowers').get().c; } catch (e) {}
  res.json({
    code: 200,
    data: {
      gathered: pack(gathered, 'gathered'),
      builders: pack(builders, 'built'),
      explorers: pack(explorers, 'revealed'),
      fishers: pack(fishers, 'fished'),
      lampCount: count,
      stage: stage,
      stageInfo: STAGES[stage],
      onlineCount: online.size,
      exploredCount: exploredSet.size,
      bottleCount: bottleCount,
      flowerCount: flowerCount
    }
  });
});

// 附近状态修正：客户端长时间停留或从后台切回来时，用它把本地世界对齐服务端。
router.get('/nearby', requireAuth, function (req, res) {
  var userId = String(req.user.user_id);
  var row = playerRow(userId);
  if (!row) return res.status(404).json({ code: 404, message: '尚未进入世界' });
  var radius = Math.min(20, Math.max(4, parseInt(req.query.r, 10) || 12));
  var players = [];
  online.forEach(function (p, uid) {
    if (uid === userId) return;
    if (Math.abs(p.x - row.x) > radius || Math.abs(p.y - row.y) > radius) return;
    players.push({ id: uid, name: p.name, x: p.x, y: p.y, dir: p.dir, hat: p.hat || '0', lantern: p.lantern || '0', title: p.title || '' });
  });
  var lamps = [];
  try {
    lamps = db.prepare("SELECT l.x, l.y, COALESCE(p.lantern, '0') AS c, COALESCE(l.level, 1) AS level FROM shiguang_lamps l LEFT JOIN shiguang_players p ON p.user_id = l.user_id WHERE l.x BETWEEN ? AND ? AND l.y BETWEEN ? AND ?")
      .all(row.x - radius, row.x + radius, row.y - radius, row.y + radius);
  } catch (e) {}
  var flowers = [];
  try {
    flowers = db.prepare('SELECT x, y, species, user_id, created_at FROM shiguang_flowers WHERE x BETWEEN ? AND ? AND y BETWEEN ? AND ?')
      .all(row.x - radius, row.x + radius, row.y - radius, row.y + radius);
  } catch (e) {}
  res.json({
    code: 200,
    data: { me: { x: row.x, y: row.y, shards: row.shards }, players: players, lamps: lamps, flowers: flowers }
  });
});

module.exports = router;
