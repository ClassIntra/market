// 拾光群岛 v5 —— 装备生成与属性计算
'use strict';

var D = require('./data');
var C = require('./config');

function rnd() { return Math.random(); }

function pickRarity(bonus) {
  // bonus：精英 / 夜晚 / 金箱给的稀有度加成（0~1），把低档权重往高档挪
  var total = 0, ws = [];
  for (var i = 0; i < D.RARITY.length; i++) {
    var w = D.RARITY[i].w * (i === 0 ? Math.max(0.2, 1 - bonus) : (1 + bonus * i));
    ws.push(w); total += w;
  }
  var r = rnd() * total;
  for (var k = 0; k < ws.length; k++) { r -= ws[k]; if (r <= 0) return k; }
  return 0;
}

// 生成一件装备（掉落 / 宝箱 / 锻造共用）
//   ilvl：物品等级（通常 = 怪物等级），决定基础属性与词条数值
//   opts.slot：限定槽位（'weapon' / 'charm' / 'cape'）
//   opts.minRarity：保底稀有度
function rollItem(ilvl, opts) {
  opts = opts || {};
  var slot = opts.slot || (rnd() < 0.55 ? 'weapon' : (rnd() < 0.5 ? 'charm' : 'cape'));
  var base;
  if (slot === 'weapon') {
    var ws = D.WEAPONS.filter(function (w) { return w.lv <= ilvl + 2; });
    // 越接近当前等级的武器越容易掉
    ws.sort(function (a, b) { return b.lv - a.lv; });
    base = ws[Math.min(ws.length - 1, Math.floor(Math.pow(rnd(), 2) * Math.min(ws.length, 5)))];
  } else {
    var ts = D.TRINKETS.filter(function (t) { return t.slot === slot && t.lv <= ilvl + 2; });
    base = ts[ts.length - 1 - Math.floor(rnd() * Math.min(ts.length, 2))];
  }
  var rar = Math.max(opts.minRarity || 0, pickRarity(opts.bonus || 0));
  var R = D.RARITY[rar];
  var item = {
    uid: Date.now().toString(36) + Math.floor(rnd() * 1e9).toString(36),
    base: base.id,
    slot: slot,
    name: base.name,
    rarity: rar,
    ilvl: ilvl,
    affixes: {}
  };
  if (slot === 'weapon') {
    item.kind = base.kind;
    // 武器基础攻击 = 底值 + 物品等级成长，乘稀有度系数，±10% 浮动
    item.atk = Math.round((base.atk + ilvl * 0.9) * R.mul * (0.92 + rnd() * 0.16));
  }
  // 词条：不重复抽
  var keys = Object.keys(D.AFFIXES);
  var n = R.affixes;
  if (slot === 'charm' || slot === 'cape') n = Math.max(1, n); // 饰品至少一条，否则没意义
  for (var i = 0; i < n && keys.length; i++) {
    var idx = Math.floor(rnd() * keys.length);
    var k = keys.splice(idx, 1)[0];
    var A = D.AFFIXES[k];
    var v = A.v * (1 + ilvl * 0.12) * (0.6 + rnd() * 0.4) * (1 + rar * 0.1);
    if (A.cap) v = Math.min(A.cap * 0.6, v); // 单件不超过上限的 60%
    item.affixes[k] = Math.round(v * 10) / 10;
  }
  // 传说：带一句来历（纯文案）
  if (rar === 4) item.lore = LEGEND_LINES[Math.floor(rnd() * LEGEND_LINES.length)];
  return item;
}

var LEGEND_LINES = [
  '「它在长夜里亮了很久，久到忘了自己是一把武器。」',
  '「守灯人说，握着它的人不会迷路。」',
  '「第一个先行者的遗物。刻痕里还有星屑。」',
  '「据说它斩断过一缕长夜。断口还在发光。」',
  '「有人在镇口捡到它，旁边是一行小字：给下一个。」'
];

// 汇总角色属性：等级 + 装备 + 天赋
function computeStats(p) {
  var lv = p.level || 1;
  var s = {
    hp: C.BASE_HP + C.HP_PER_LEVEL * (lv - 1),
    mp: C.BASE_MP + C.MP_PER_LEVEL * (lv - 1),
    atk: C.BASE_ATK + C.ATK_PER_LEVEL * (lv - 1),
    crit: 5, critDmg: 50, leech: 0, mpGain: 0, speed: 0, dodgeCd: 0, skill: 0, night: 0,
    weaponKind: 'sword', weaponAtk: 0,
    talents: {}
  };
  var eq = p.equip || {};
  ['weapon', 'charm', 'cape'].forEach(function (slot) {
    var it = eq[slot];
    if (!it) return;
    if (slot === 'weapon') { s.weaponKind = it.kind || 'sword'; s.weaponAtk = it.atk || 0; }
    var af = it.affixes || {};
    Object.keys(af).forEach(function (k) {
      if (k === 'atk' || k === 'hp') s[k] += af[k];
      else s[k] = (s[k] || 0) + af[k];
    });
  });
  s.atk += s.weaponAtk;
  // 天赋
  var tl = p.talents || {};
  Object.keys(D.TALENTS).forEach(function (line) {
    var n = tl[line] || 0;
    for (var i = 0; i < n; i++) {
      var mod = D.TALENTS[line].tiers[i].mod;
      Object.keys(mod).forEach(function (k) {
        if (k === 'atkPct') s.atk *= 1 + mod[k] / 100;
        else if (k === 'hpPct') s.hp *= 1 + mod[k] / 100;
        else if (s[k] != null && typeof s[k] === 'number') s[k] += mod[k];
        else s.talents[k] = (s.talents[k] || 0) + mod[k];
      });
    }
  });
  // 上限
  Object.keys(D.AFFIXES).forEach(function (k) {
    var cap = D.AFFIXES[k].cap;
    if (cap && s[k] > cap) s[k] = cap;
  });
  s.hp = Math.round(s.hp);
  s.atk = Math.round(s.atk * 10) / 10;
  return s;
}

// 等级所需经验：前期快，后期平滑变慢
function xpToNext(lv) {
  return Math.round(30 + Math.pow(lv, 1.85) * 22);
}

// 出售价格（星屑）
function sellPrice(item) {
  return Math.round((4 + item.ilvl * 1.6) * (1 + item.rarity * item.rarity * 0.9));
}

module.exports = {
  rollItem: rollItem,
  computeStats: computeStats,
  xpToNext: xpToNext,
  sellPrice: sellPrice,
  pickRarity: pickRarity
};
