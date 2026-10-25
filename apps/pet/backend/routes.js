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

  var used = type === 'poke' ? (state.poked_today || 0) : (type === 'feed' ? (state.fed_today || 0) : (state.visited_date === today ? 1 : 0));
  if (used >= rule.dailyCap) {
    capped = true;
  } else {
    gained = rule.gain;
    state.bond = (state.bond || 0) + gained;
    state.bond_today = (state.bond_today || 0) + gained;
    if (type === 'poke') state.poked_today = used + 1;
    if (type === 'feed') { state.fed_today = used + 1; state.last_fed_at = new Date().toISOString(); }
    if (type === 'visit') state.visited_date = today;
  }
  state.updated_at = new Date().toISOString();
  db.prepare('INSERT INTO user_kv_store (user_id, key, value) VALUES (?, ?, ?) ' +
    'ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value')
    .run(uid, KV_KEY, JSON.stringify(state));

  var TIER = [0, 20, 60, 120, 200];
  function tierOf(b) { var t = 0; for (var i = 0; i < TIER.length; i++) { if (b >= TIER[i]) t = i; } return t; }
  var tierUp = tierOf(state.bond) > tierOf(tierBefore);
  res.json({ code: 200, data: { state: state, gained: gained, tierUp: tierUp, capped: capped } });
});

// 读状态
router.get('/state', requireAuth, function(req, res) {
  var row = db.prepare('SELECT value FROM user_kv_store WHERE user_id = ? AND key = ?').get(userId(req), KV_KEY);
  var state = null;
  if (row) {
    try { state = JSON.parse(row.value); } catch (e) { state = null; }
  }
  res.json({ code: 200, data: { state: state, palette: PALETTE.p16, templates: TEMPLATES } });
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
module.exports = router;
