// 拾光群岛 v5.3 —— 农场核心循环（服务端权威）
//
// 存档：挂在 player.flags.farm 这一份 JSON 上，零改表、零迁移。
// 日历：全班共享（epoch 由服务器进程决定），玩家侧 lazy 补算落下的天数，
//       所以「服务器重启 / 玩家几天没上线」都不会漏掉作物生长。
// 所有数值来自 farmdata.js；所有金币与物品的写入都经过本模块，杜绝客户端伪造。

var FD = require('./farmdata');
var D = FD.DATA;

module.exports = function createFarm(ctx) {
  var router = ctx.router, S = ctx.S, requireAuth = ctx.requireAuth, uidOf = ctx.uidOf;
  var ok = ctx.ok, fail = ctx.fail, push = ctx.push, broadcast = ctx.broadcast;
  var nowMs = ctx.nowMs, TOWN_SPAWN = ctx.TOWN_SPAWN, onlineIds = ctx.onlineIds;
  var SIMc = ctx.SIM;
  var isBlockedWorld = ctx.isBlockedWorld;

  // 进程级日历（热挂载/热更新不重置 epoch）
  var CAL = global.__shiguang5FarmCal || (global.__shiguang5FarmCal = { epoch: Date.now(), lastDay: 0 });
  function dayNow() { return Math.floor((nowMs() - CAL.epoch) / D.DAY_MS) + 1; }
  function dayProgress() { var m = (nowMs() - CAL.epoch) % D.DAY_MS; return (m < 0 ? 0 : m) / D.DAY_MS; }
  function setEpochForDay(day) { CAL.epoch = nowMs() - (day - 1) * D.DAY_MS; CAL.lastDay = 0; }

  function has(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  function merge(a, b) { if (b) for (var k in b) if (has(b, k)) a[k] = b[k]; return a; }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  function defFarm() {
    return {
      gold: D.START_GOLD, energy: D.START_ENERGY, maxEnergy: D.START_ENERGY,
      lastDay: 0, sleptDay: 0, faint: 0, sleepN: 0, sleepDay: 0, mineDay: null,
      plots: {}, inv: {}, ship: {}, shipTotal: 0, chest: {},
      tools: { hoe: 0, watercan: 0, axe: 0, pickaxe: 0, sickle: 0, rod: 0 },
      toolOrder: null, sprinklers: {},
      skills: { farming: 0, mining: 0, foraging: 0, fishing: 0, combat: 0 }, profs: [],
      backpack: 12, animals: [], animalSeq: 0,
      fishCaught: {}, cropsGrown: {}, mineFloor: 0, mineBest: 0, elevator: 0,
      relations: {}, bundles: {}, rooms: {}, greenhouse: false,
      festivalSeen: {}, todayTalk: {}, weekGifts: {}, lastWeek: 0,
      pendingFish: null, mineRun: null, spouse: '', houseLv: 0,
      machines: {}, forageCd: {}, chopped: {}, seenForage: 0,
      // v5.5 节日小游戏：彩蛋节（eggHunt/eggTaken/eggRedeem）、冰雪钓赛、丰收展
      eggHunt: { day: 0, found: 0 }, eggTaken: {},
      eggRedeem: { day: 0, seed_strawberry: 0, speedgro: 0, gold: 0 },
      fishContest: { day: 0, total: 0, rods: 0, claimed: 0 },
      exhibit: { day: 0, items: null, grade: null },
      stats: { harvest: 0, fish: 0, ore: 0, gift: 0, ship: 0 }
    };
  }
  function ensure(rec) {
    var f = rec.flags && rec.flags.farm;
    if (!f) { f = defFarm(); rec.flags = rec.flags || {}; rec.flags.farm = f; }
    var d = defFarm();
    for (var k in d) if (has(d, k) && !has(f, k)) f[k] = d[k];
    // 嵌套表也要补，老存档才不会 undefined
    for (var t in d.tools) if (has(d.tools, t) && !has(f.tools, t)) f.tools[t] = 0;
    for (var s in d.skills) if (has(d.skills, s) && !has(f.skills, s)) f.skills[s] = 0;
    for (var q in d.stats) if (has(d.stats, q) && !has(f.stats, q)) f.stats[q] = 0;
    return f;
  }
  function of(id) {
    var rec = S.load(id, TOWN_SPAWN);
    var f = ensure(rec);
    settle(id, f, rec);
    return f;
  }
  function save(id) { S.markDirty(id); }

  // ---------- 物品 ----------
  function itemName(id) {
    if (!id) return '';
    var parts = String(id).split('_q');
    var base = parts[0], q = parts[1] ? Number(parts[1]) : 0;
    var n = '';
    if (base.indexOf('seed_') === 0) {
      var c = D.CROPS[base.slice(5)];
      n = (c ? c.name : base.slice(5)) + '种子';
    } else if (D.CROPS[base]) n = D.CROPS[base].name;
    else if (D.ANIMALS[base]) n = D.ANIMALS[base].name;
    else {
      for (var i = 0; i < D.FISH.length; i++) if (D.FISH[i].id === base) n = D.FISH[i].name;
      if (!n) for (var j = 0; j < D.ORES.length; j++) if (D.ORES[j].id === base) n = D.ORES[j].name;
      if (!n) {
        var FIX = { egg: '鸡蛋', big_egg: '大鸡蛋', duck_egg: '鸭蛋', duck_feather: '鸭毛',
          milk: '牛奶', big_milk: '大牛奶', goat_milk: '羊奶', big_goat_milk: '大瓶羊奶',
          wool: '羊毛', big_wool: '优质羊毛', truffle: '松露',
          hay: '干草', wood: '木材', speedgro: '生长激素', quality_fert: '高级肥料',
          sprinkler: '洒水器', bait: '鱼饵', rod: '鱼竿', furnace: '熔炉', seeds: '混合种子',
          ticket: '彩蛋彩券', gem: '宝石', stone: '石头' };
        n = FIX[base] || (D.ITEM_NAMES && D.ITEM_NAMES[base]) || base;
      }
    }
    return n + (q ? '★' + q : '');
  }
  function itemCategory(id) {
    if (!id) return 'other';
    var b = String(id).split('_q')[0];
    if (b === 'hay' || b === 'wood' || b === 'hardwood' || b === 'stone' || b === 'speedgro' || b === 'quality_fert') return 'crop';
    if (D.CROPS[b]) return /tulip|jazz|poppy|spangle|fairrose/.test(b) ? 'flower' : 'crop';
    if (b.indexOf('seed_') === 0) return 'crop';
    for (var i = 0; i < D.FISH.length; i++) if (D.FISH[i].id === b) return 'fish';
    for (var j = 0; j < D.ORES.length; j++) if (D.ORES[j].id === b) return b === 'gem' ? 'gem' : 'ore';
    if (/egg|milk|wool|truffle|feather/.test(b)) return 'animal';
    // v5.4：锭按矿石、加工品 / 料理按食物归类（送礼口味与图鉴都用它）
    if (/_bar$/.test(b)) return 'ore';
    if (/^food_/.test(b) || b === 'mayonnaise' || b === 'cheese' || b === 'pale_ale' || b === 'beer') return 'food';
    if (b === 'crab') return 'fish';
    if (b === 'ticket') return 'food';   // v5.5 彩蛋彩券：送礼按一般处理
    if (b === 'bait' || b === 'rod' || b === 'furnace' || b === 'sprinkler' || b === 'seeds') return 'food';
    return 'other';
  }
  // v5.4：加工产物 id 集合（artisan +40% 用）与采集物基价表，模块加载时算一次
  // 锭归铁匠专属（blacksmith ×1.5），不吃工匠加成 —— 双倍叠加会让金属失控
  var ARTISAN_OUT = {};
  (function () {
    for (var k in D.RECIPES) {
      if (!has(D.RECIPES, k)) continue;
      var out = String(D.RECIPES[k].out).split('_q')[0];
      if (/_bar$/.test(out)) continue;
      ARTISAN_OUT[out] = 1;
    }
  })();
  var FORAGE_SELL = {};
  (function () {
    for (var i = 0; i < D.FORAGE.length; i++) FORAGE_SELL[D.FORAGE[i].id] = D.FORAGE[i].sell;
  })();

  // 单件售价：只有「真正有价的东西」才能变现。未知物品返回 0 —— 不能给兜底价，
  // 否则任何随手捡到的杂物都能无限换钱，整个经济会漏。
  function unitPrice(f, k, perk) {
    var ps = String(k).split('_q'), base = ps[0], q = ps[1] ? Number(ps[1]) : 0;
    if (D.CROPS[base]) return FD.cropPrice(base, q, f.profs, perk);
    for (var i = 0; i < D.FISH.length; i++) if (D.FISH[i].id === base) return FD.fishPrice(base, q, f.profs, false);
    for (var j = 0; j < D.ORES.length; j++) if (D.ORES[j].id === base) return Math.floor(D.ORES[j].sell * FD.qualityMul(q));
    var AM = { egg: 50, big_egg: 95, duck_egg: 95, duck_feather: 125, milk: 125, big_milk: 190,
      goat_milk: 225, big_goat_milk: 345, wool: 340, big_wool: 480, truffle: 625 };
    var u = AM[base] || 0;
    if (u) {
      if (f.profs.indexOf('rancher') >= 0) u = u * 1.2;
      return Math.floor(u * FD.qualityMul(q));
    }
    // v5.4：锭 / 加工品 / 料理 / 硬木 / 蟹 / 野外采集物各有基价表
    var fs = FORAGE_SELL[base];
    if (fs) return Math.floor(fs * FD.qualityMul(q));
    u = D.SELL[base] || 0;
    if (u) {
      if (/_bar$/.test(base) && f.profs.indexOf('blacksmith') >= 0) u *= 1.5;   // 铁匠：锭 +50%
      if (ARTISAN_OUT[base] && f.profs.indexOf('artisan') >= 0) u *= 1.4;       // 工匠：加工品 +40%
      return Math.floor(u * FD.qualityMul(q));
    }
    if (base.indexOf('seed_') === 0) {          // 种子按半价回收，和商店一致
      var c = D.CROPS[base.slice(5)];
      return c ? Math.floor(c.seed * 0.5) : 0;
    }
    return 0;
  }

  function invCount(f) { var n = 0; for (var k in f.inv) if (has(f.inv, k)) n++; return n; }
  function addItem(f, id, n) {
    if (!id || !n) return 0;
    var q = Number(n) || 0;
    var old = f.inv[id] || 0;
    var room = Math.max(0, f.backpack - invCount(f));
    if (old <= 0 && room <= 0) return 0;
    f.inv[id] = old + q;
    return q;
  }
  function takeItem(f, id, n) {
    var q = Number(n) || 1;
    if (!id || (f.inv[id] || 0) < q) return false;
    f.inv[id] -= q;
    if (f.inv[id] <= 0) delete f.inv[id];
    return true;
  }
  function goldAdd(f, n) { f.gold = Math.max(0, Math.round((f.gold || 0) + n)); }
  function xpAdd(f, skill, n) {
    if (!f.skills[skill] && f.skills[skill] !== 0) f.skills[skill] = 0;
    var before = FD.levelOf(f.skills[skill]);
    f.skills[skill] += Math.max(0, Math.round(n));
    var after = FD.levelOf(f.skills[skill]);
    return after > before ? { skill: skill, lv: after, prev: before } : null;
  }
  function energyUse(f, base, toolLv) {
    // 升级后的工具更省力（原作：水壶/锄头蓄力一次多格，单格消耗下降）
    var e = Math.max(1, base - Math.floor((toolLv || 0) * 0.3));
    return f.energy >= e ? e : 0;
  }

  // ---------- 跨日结算（lazy，幂等） ----------
  function settle(id, f, rec) {
    var today = dayNow();
    if (!f.lastDay) f.lastDay = today;
    var gap = today - f.lastDay;
    if (gap <= 0) return;
    if (gap > 120) gap = 120;                 // 长时间不来最多补 120 天，避免卡死
    var notices = [];
    for (var step = 0; step < gap; step++) {
      var d = f.lastDay + 1;
      advanceOne(id, f, d, notices);
      f.lastDay = d;
    }
    // v5.6 W3：新的一天不再自动回满体力 —— 恢复只来自睡觉（分段）；跨日清零当日睡次
    f.sleepN = 0; f.sleepDay = 0;
    f.todayTalk = {};
    if (f.mineRun) f.mineRun = null;
    if (f.pendingFish) f.pendingFish = null;
    if (f.mineDay) f.mineDay = { day: today, n: 0 };
    S.markDirty(id);
    if (notices.length) push(id, { k: 'farm-dawn', day: today, n: notices.length, msg: notices[0] });
  }

  function advanceOne(id, f, day, notices) {
    var season = FD.seasonOf(day), wet = FD.isWet(FD.weatherFor(day));
    // 生长加速只在 growthOf 里按 need ×0.9 生效一次，别在这里再乘一遍
    var greenhouse = !!f.greenhouse;
    // 1. 出货箱到账（星露谷：次日清晨结算）
    var gain = 0;
    for (var sk in f.ship) if (has(f.ship, sk)) {
      gain += unitPrice(f, sk, '') * f.ship[sk];
    }
    if (gain > 0) {
      goldAdd(f, gain); f.shipTotal += gain; f.stats.ship += gain;
      notices.push('出货箱结了 ' + gain + ' 金');
    }
    f.ship = {};
    // 2. 作物：浇过水 / 下雨 / 洒水器才长一节；过季枯萎（温室免疫）
    for (var key in f.plots) {
      if (!has(f.plots, key)) continue;
      var p = f.plots[key];
      if (!p || !p.crop) continue;
      var c = D.CROPS[p.crop];
      if (!c) { delete f.plots[key]; continue; }
      if (!greenhouse && c.s.length && c.s.indexOf(season) < 0) {
        delete f.plots[key]; continue;
      }
      var auto = !!f.sprinklers[key];
      var watered = wet || p.watered || auto;
      if (watered) {
        if (p.harvested && c.regrow) {
          // 复收靠「距离上次收获的天数」判定，不必再 +grow
        } else {
          p.grow = (p.grow || 0) + 1;
        }
      }
      p.watered = wet || auto ? 1 : 0;
    }
    // 3. 动物：喂过食才产出，好感按是否喂食/抚摸变化
    var animalGain = 0;
    for (var ai = 0; ai < (f.animals || []).length; ai++) {
      var a = f.animals[ai], def = D.ANIMALS[a.kind];
      if (!def) continue;
      if (day >= a.matureDay) {
        if (a.fedDay === day - 1 || a.fedDay === day) {
          var big = a.love >= 800 && Math.random() < 0.4;
          var pid = big ? def.big : def.product;
          if (addItem(f, pid, 1)) animalGain++;
          a.love = Math.min(1000, a.love + 8);
          a.product = pid; a.collected = 0;
        } else {
          a.love = Math.max(0, a.love - 20);
        }
      }
      if (a.pettedDay !== day - 1) a.love = Math.max(0, a.love - 5);
      a.fedDay = 0;
    }
    if (animalGain) notices.push('棚里收了 ' + animalGain + ' 份产物');
    // 4. 工具升级到货
    if (f.toolOrder && day >= f.toolOrder.readyDay) {
      f.tools[f.toolOrder.tool] = f.toolOrder.lv;
      notices.push(D.TOOL_NAMES[f.toolOrder.tool] + '升到' + f.toolOrder.name + '了');
      f.toolOrder = null;
    }
    // 5. 节日 / 生日提醒
    var fes = FD.festivalOn(day);
    if (fes && !f.festivalSeen[day]) notices.push('今天是' + fes.name);
    // 5.5 trapper：蟹笼每天清晨自己收一只蟹
    if (f.profs && f.profs.indexOf('trapper') >= 0) {
      if (addItem(f, 'crab', 1)) notices.push('蟹笼里收了一只蟹');
    }
    var vk = Object.keys(D.VILLAGERS);
    for (var vi = 0; vi < vk.length; vi++) {
      var v = D.VILLAGERS[vk[vi]];
      if (v.birthday[0] === season && v.birthday[1] === FD.dayInSeason(day)) notices.push('今天是' + v.name + '的生日');
    }
    // 6. 昏厥惩罚（v5.6：当日没收工昏厥（没睡 + 耗尽），或睡了但跨日时体力仍 ≤0 → 扣 10% 金币）
    if (f.energy <= 0) {
      var loss = Math.min(1000, Math.floor(f.gold * 0.1));
      goldAdd(f, -loss); f.faint++;
      notices.push('昨晚累倒在地，花了 ' + loss + ' 金');
    }
  }

  // ---------- v5.5 彩蛋节：当日 12 颗彩蛋（确定性 per uid+day，过滤阻挡格） ----------
  // eggList 的候选主环排前、外环垫底：先取主环里走得通的，不足 12 颗自然放宽到外环补齐。
  // 索引 i = 过滤后 12 颗里的序号，全天稳定，pick 只认 i；
  // payload 下发的 eggsLeft = 12 颗里去掉已采索引的剩余列表（i 保持原序号不变）。
  function eggsOf(id, f, day) {
    var cands = FD.eggList(day, id), full = [], i;
    for (i = 0; i < cands.length && full.length < 12; i++) {
      var cx = cands[i].x, cy = cands[i].y;
      if (isBlockedWorld && isBlockedWorld(cx + 0.5, cy + 0.5)) continue;
      full.push({ i: full.length, x: cx, y: cy });
    }
    var taken = (f.eggTaken && f.eggTaken[day]) || [];
    var out = [];
    for (i = 0; i < full.length; i++) if (taken.indexOf(full[i].i) < 0) out.push(full[i]);
    var found = taken.length;
    if (found > full.length) found = full.length;   // 老档容错：登记数不该超过总蛋数
    return { eggs: out, found: found, total: full.length };
  }

  // ---------- 快照 ----------
  function cal() {
    var day = dayNow();
    return {
      day: day, season: FD.seasonOf(day), seasonName: D.SEASONS[FD.seasonOf(day)],
      dayInSeason: FD.dayInSeason(day), year: FD.yearOf(day),
      weather: FD.weatherFor(day), clock: FD.clockOf(dayProgress()),
      progress: dayProgress(), dayMs: D.DAY_MS,
      festival: FD.festivalOn(day), totalDays: D.SEASON_DAYS * 4
    };
  }
  function payload(id, f) {
    var c = cal();
    return {
      gold: f.gold, energy: f.energy, maxEnergy: f.maxEnergy,
      plots: f.plots, inv: f.inv, ship: f.ship, shipTotal: f.shipTotal, chest: f.chest,
      tools: f.tools, toolOrder: f.toolOrder, sprinklers: f.sprinklers,
      skills: f.skills, profs: f.profs, backpack: f.backpack,
      animals: f.animals, fishCaught: f.fishCaught, cropsGrown: f.cropsGrown,
      mineFloor: f.mineFloor, mineBest: f.mineBest, elevator: f.elevator, mineRun: f.mineRun,
      relations: f.relations, bundles: f.bundles, rooms: f.rooms, greenhouse: f.greenhouse,
      festivalSeen: f.festivalSeen, spouse: f.spouse, houseLv: f.houseLv,
      stats: f.stats, lastDay: f.lastDay, sleptDay: f.sleptDay, faint: f.faint,
      machines: f.machines, forageCd: f.forageCd, chopped: f.chopped,
      // v5.5：彩蛋节当日下发剩余彩蛋与进度；钓赛 / 丰收展状态常驻（前端渲染成绩卡与展台锁定态）
      eggsLeft: (function () {
        var fes = FD.festivalOn(dayNow());
        return fes && fes.name === '彩蛋节' ? eggsOf(id, f, dayNow()).eggs : [];
      })(),
      eggHunt: (function () {
        var fes = FD.festivalOn(dayNow());
        if (!fes || fes.name !== '彩蛋节') return { day: 0, found: 0, total: 12 };
        var e = eggsOf(id, f, dayNow());
        return { day: dayNow(), found: e.found, total: e.total };
      })(),
      eggRedeem: f.eggRedeem,
      fishContest: f.fishContest, exhibit: f.exhibit,
      forage: (function () {
        // 生成端就过滤掉不可达格：提示与实际可采保持一致，别让玩家对着栅栏发呆
        var list = FD.forageList(dayNow(), f.forageCd), out = [];
        for (var i = 0; i < list.length; i++) {
          if (isBlockedWorld && isBlockedWorld(list[i].x + 0.5, list[i].y + 0.5)) continue;
          out.push(list[i]);
        }
        return out;
      })(),
      recipes: D.RECIPES, eat: D.EAT,
      cal: c, data: D,
      prices: (function () { var o = {}; for (var k in f.inv) if (has(f.inv, k)) o[k] = unitPrice(f, k, ''); return o; })(),
      invCount: invCount(f), heartPts: D.HEART_PTS,
      nextLevelXp: (function () { var o = {}; for (var k in f.skills) if (has(f.skills, k)) o[k] = FD.xpToNext(f.skills[k]); return o; })(),
      levels: (function () { var o = {}; for (var k in f.skills) if (has(f.skills, k)) o[k] = FD.levelOf(f.skills[k]); return o; })()
    };
  }

  // ---------- 动作包装 ----------
  function guard(id, res, cost, fn) {
    var rec;
    try { rec = S.load(id, TOWN_SPAWN); } catch (e) { return fail(res, '世界暂时进不去，再试一次', 500); }
    var f = ensure(rec);
    settle(id, f, rec);
    if (cost > 0 && f.energy < cost) {
      save(id);
      return fail(res, '体力不够了，去客栈歇一会儿（或等到明天）', 400);
    }
    var extra = fn(id, rec, f);
    if (extra === false) { save(id); return; }       // fn 内部已 fail
    if (cost > 0) f.energy = Math.max(0, f.energy - cost);
    save(id);
    ok(res, merge({ farm: payload(id, f) }, extra === true ? null : extra));
  }
  function keyOf(r, c) { return r + ',' + c; }
  function plotOf(f, r, c) { return f.plots[keyOf(r, c)] || null; }
  function inFarm(r, c) { return r >= 0 && c >= 0 && r < D.FARM_H && c < D.FARM_W; }
  function badCell(res, r, c) {
    if (!inFarm(r, c)) { fail(res, '这格不在你的田里', 400); return true; }
    return false;
  }

  // ---------- 路由：状态 ----------
  router.get('/v5/farm/state', requireAuth, function (req, res) {
    var id = uidOf(req);
    var p;
    try { p = payload(id, of(id)); } catch (e) { return fail(res, '农场暂时打不开', 500); }
    ok(res, { farm: p });
  });

  // ---------- 路由：锄地 / 播种 / 浇水 / 收获 / 施肥 ----------
  router.post('/v5/farm/till', requireAuth, function (req, res) {
    var b = req.body || {};
    guard(uidOf(req), res, 2, function (id, rec, f) {
      var cells = b.cells || [[b.r, b.c]];
      var n = 0, max = D.TOOL_RANGE[f.tools.hoe] || 1;
      for (var i = 0; i < cells.length && n < max; i++) {
        var r = Math.floor(Number(cells[i][0])), c = Math.floor(Number(cells[i][1]));
        if (!inFarm(r, c)) continue;
        var k = keyOf(r, c), p = f.plots[k];
        if (p && p.crop) continue;
        f.plots[k] = p || { tilled: 1, watered: 0, crop: '', grow: 0, fert: '' };
        f.plots[k].tilled = 1;
        n++;
      }
      if (!n) { fail(res, '这里已经翻好了', 400); return false; }
      return { tilled: n };
    });
  });

  router.post('/v5/farm/plant', requireAuth, function (req, res) {
    var b = req.body || {};
    guard(uidOf(req), res, 0, function (id, rec, f) {
      var r = Math.floor(Number(b.r)), c = Math.floor(Number(b.c));
      if (badCell(res, r, c)) return false;
      var seed = String(b.seed || '');
      if (seed.indexOf('seed_') !== 0 || !D.CROPS[seed.slice(5)]) { fail(res, '这不是种子', 400); return false; }
      if (!takeItem(f, seed, 1)) { fail(res, '背包里没有这包种子', 400); return false; }
      var crop = seed.slice(5), def = D.CROPS[crop];
      var season = FD.seasonOf(dayNow());
      if (!f.greenhouse && def.s.length && def.s.indexOf(season) < 0) {
        addItem(f, seed, 1);
        fail(res, def.name + '不在当季，等' + (def.s.length ? D.SEASONS[def.s[0]] : '') + '再种', 400);
        return false;
      }
      var k = keyOf(r, c), p = f.plots[k];
      if (!p || !p.tilled) { addItem(f, seed, 1); fail(res, '先用锄头翻一块地', 400); return false; }
      if (p.crop) { addItem(f, seed, 1); fail(res, '这格已经种了东西', 400); return false; }
      p.crop = crop; p.grow = 0; p.harvested = 0; p.regrowDay = 0;
      f.stats.harvest = f.stats.harvest || 0;
      return { planted: crop, name: def.name };
    });
  });

  router.post('/v5/farm/water', requireAuth, function (req, res) {
    var b = req.body || {};
    guard(uidOf(req), res, 2, function (id, rec, f) {
      if (FD.isWet(FD.weatherFor(dayNow()))) { fail(res, '今天下雨，云替你浇过了', 400); return false; }
      var cells = b.cells || [[b.r, b.c]];
      var max = D.TOOL_RANGE[f.tools.watercan] || 1, n = 0;
      for (var i = 0; i < cells.length && n < max; i++) {
        var r = Math.floor(Number(cells[i][0])), c = Math.floor(Number(cells[i][1]));
        if (!inFarm(r, c)) continue;
        var p = f.plots[keyOf(r, c)];
        if (!p || !p.tilled || p.watered) continue;
        p.watered = 1; n++;
      }
      if (!n) { fail(res, '这些地不用再浇了', 400); return false; }
      return { watered: n };
    });
  });

  router.post('/v5/farm/fertilize', requireAuth, function (req, res) {
    var b = req.body || {};
    guard(uidOf(req), res, 0, function (id, rec, f) {
      var r = Math.floor(Number(b.r)), c = Math.floor(Number(b.c));
      if (badCell(res, r, c)) return false;
      var p = f.plots[keyOf(r, c)];
      if (!p || !p.tilled || p.crop) { fail(res, '先翻地，趁没播种前施肥', 400); return false; }
      var fert = String(b.fert || '');
      if (fert === 'sprinkler') {
        if (!takeItem(f, 'sprinkler', 1)) { fail(res, '没有洒水器', 400); return false; }
        f.sprinklers[keyOf(r, c)] = 1;
      } else {
        if (fert !== 'speedgro' && fert !== 'quality_fert') { fail(res, '未知肥料', 400); return false; }
        if (!takeItem(f, fert, 1)) { fail(res, '背包里没有这份肥料', 400); return false; }
        p.fert = fert;
      }
      return { fertilized: fert };
    });
  });

  router.post('/v5/farm/harvest', requireAuth, function (req, res) {
    var b = req.body || {};
    guard(uidOf(req), res, 2, function (id, rec, f) {
      var r = Math.floor(Number(b.r)), c = Math.floor(Number(b.c));
      if (badCell(res, r, c)) return false;
      var k = keyOf(r, c), p = f.plots[k];
      if (!p || !p.crop) { fail(res, '这格没有可收的东西', 400); return false; }
      var def = D.CROPS[p.crop]; if (!def) { delete f.plots[k]; return false; }
      var g = FD.growthOf(p, dayNow(), f.profs.indexOf('agriculturist') >= 0);
      if (!g.ready) { fail(res, def.name + '还要长 ' + Math.max(1, (g.need || def.days) - Math.floor(g.stage)) + ' 天', 400); return false; }
      var n = def.yield || 1;
      if (def.extra && Math.random() < def.extra) n += 1;
      var got = [], levels = [];
      for (var i = 0; i < n; i++) {
        var q = FD.qualityRoll(FD.levelOf(f.skills.farming), p.fert === 'quality_fert' ? 'quality' : '', Math.random());
        var iid = p.crop + (q ? '_q' + q : '');
        if (!addItem(f, iid, 1)) break;
        got.push(iid);
        f.cropsGrown[p.crop] = (f.cropsGrown[p.crop] || 0) + 1;
      }
      if (!got.length) { fail(res, '背包满了，先卖点东西', 400); return false; }
      var up = xpAdd(f, 'farming', (def.xp || 8) * got.length);
      if (up) { levels.push(up); push(id, { k: 'farm-level', skill: 'farming', lv: up.lv }); }
      f.stats.harvest += got.length;
      if (def.regrow) { p.harvested = 1; p.regrowDay = dayNow(); p.grow = def.days; }
      else { f.plots[k] = { tilled: 1, watered: p.watered, crop: '', grow: 0, fert: p.fert || '' }; }
      return { got: got, levels: levels, crop: p.crop };
    });
  });

  // ---------- 路由：商店 / 出售 / 出货箱 / 箱子 ----------
  router.post('/v5/farm/buy', requireAuth, function (req, res) {
    var b = req.body || {};
    guard(uidOf(req), res, 0, function (id, rec, f) {
      var kind = String(b.kind || ''), n = Math.max(1, Math.min(99, Math.floor(Number(b.n) || 1)));
      var unit = 0, item = '';
      if (kind === 'seed') {
        item = String(b.id || '');
        if (item.indexOf('seed_') !== 0 || !D.CROPS[item.slice(5)]) { fail(res, '没有这种种子', 400); return false; }
        var def = D.CROPS[item.slice(5)];
        if (def.seed <= 0) { fail(res, '这包种子不卖', 400); return false; }
        var fes = FD.festivalOn(dayNow());
        if (item === 'seed_strawberry' && !(fes && fes.perk === 'strawberry')) { fail(res, '草莓种子只在彩蛋节开卖', 400); return false; }
        if (!f.greenhouse && def.s.length && def.s.indexOf(FD.seasonOf(dayNow())) < 0) {
          fail(res, def.name + '不在当季', 400); return false;
        }
        unit = def.seed * D.SHOP_SEED_MARKUP;
      } else if (kind === 'animal') {
        item = String(b.id || '');
        if (!D.ANIMALS[item]) { fail(res, '没有这种动物', 400); return false; }
        if ((f.animals || []).length >= 12) { fail(res, '棚里住满了', 400); return false; }
        unit = D.ANIMALS[item].cost; n = 1;
      } else if (kind === 'machine') {
        // v5.4：设备不进背包，买一台记一台（可重复买，只用于展示「第 N 台」）
        item = String(b.id || '');
        if (!D.MACHINES[item]) { fail(res, '没有这种设备', 400); return false; }
        unit = D.MACHINES[item].cost; n = 1;
      } else if (kind === 'hay') { item = 'hay'; unit = 50; }
      else if (kind === 'wood') { item = 'wood'; unit = 10; }
      else if (kind === 'fert') {
        item = String(b.id || '');
        if (item === 'speedgro') unit = 100;
        else if (item === 'quality_fert') unit = 150;
        else if (item === 'sprinkler') unit = 400;
        else { fail(res, '没有这种资材', 400); return false; }
      } else if (kind === 'backpack') {
        var next = f.backpack >= 24 ? 36 : 24;
        if (f.backpack >= 36) { fail(res, '背包已经最大了', 400); return false; }
        var cost = D.BACKPACK_COSTS[f.backpack >= 24 ? 1 : 0];
        if (f.gold < cost) { fail(res, '金币不够', 400); return false; }
        goldAdd(f, -cost); f.backpack = next;
        return { bought: 'backpack', backpack: next };
      } else if (kind === 'house') {
        if (f.houseLv >= 2) { fail(res, '房子已经扩建到头了', 400); return false; }
        var hc = f.houseLv === 0 ? 10000 : 50000;
        if (f.gold < hc) { fail(res, '金币不够，需要 ' + hc + ' 金', 400); return false; }
        goldAdd(f, -hc); f.houseLv++;
        return { bought: 'house', houseLv: f.houseLv };
      } else { fail(res, '不卖这个', 400); return false; }

      var total = unit * n;
      if (f.gold < total) { fail(res, '金币不够，需要 ' + total + ' 金', 400); return false; }
      if (kind === 'machine') {
        goldAdd(f, -total);
        f.machines[item] = (f.machines[item] || 0) + 1;
        return { bought: item, machine: item, count: f.machines[item], name: D.MACHINES[item].name, cost: total };
      }
      if (kind === 'animal') {
        goldAdd(f, -total);
        f.animalSeq = (f.animalSeq || 0) + 1;
        var ad = D.ANIMALS[item];
        f.animals.push({ uid: 'a' + f.animalSeq, kind: item, name: ad.name + ' #' + f.animalSeq,
          love: 0, fedDay: 0, pettedDay: 0, matureDay: dayNow() + ad.matures, product: '', collected: 1 });
        return { bought: item, animal: f.animals[f.animals.length - 1] };
      }
      var free = f.backpack - invCount(f);
      if ((f.inv[item] || 0) <= 0 && free <= 0) { fail(res, '背包满了', 400); return false; }
      goldAdd(f, -total); addItem(f, item, n);
      return { bought: item, n: n, cost: total };
    });
  });

  router.post('/v5/farm/sell', requireAuth, function (req, res) {
    var b = req.body || {};
    guard(uidOf(req), res, 0, function (id, rec, f) {
      var items = b.items || {}, list = [], total = 0, count = 0;
      var perk = (FD.festivalOn(dayNow()) || {}).perk;
      // 先整轮校验再统一扣物品：中途报错不能把前面几样吞掉
      for (var k in items) {
        if (!has(items, k)) continue;
        var n = Math.max(0, Math.floor(Number(items[k]) || 0)); if (!n) continue;
        if ((f.inv[k] || 0) < n) { fail(res, '背包里没有这么多 ' + itemName(k), 400); return false; }
        var unit = unitPrice(f, k, perk);
        if (!unit) { fail(res, itemName(k) + '不收', 400); return false; }
        list.push([k, n]); total += unit * n; count += n;
      }
      if (!count) { fail(res, '没有选中要卖的东西', 400); return false; }
      for (var z = 0; z < list.length; z++) takeItem(f, list[z][0], list[z][1]);
      goldAdd(f, total); f.shipTotal += total;
      return { sold: count, gold: total };
    });
  });

  router.post('/v5/farm/ship', requireAuth, function (req, res) {
    var b = req.body || {};
    guard(uidOf(req), res, 0, function (id, rec, f) {
      var items = b.items || {}, n = 0;
      for (var k in items) {
        if (!has(items, k)) continue;
        var q = Math.max(0, Math.floor(Number(items[k]) || 0));
        if (!q || (f.inv[k] || 0) < q) continue;
        if (!unitPrice(f, k, '')) continue;    // 不收的东西别让玩家白扔进箱子
        takeItem(f, k, q); f.ship[k] = (f.ship[k] || 0) + q; n += q;
      }
      if (!n) { fail(res, '出货箱是空的', 400); return false; }
      return { shipped: n };
    });
  });

  router.post('/v5/farm/chest', requireAuth, function (req, res) {
    var b = req.body || {};
    guard(uidOf(req), res, 0, function (id, rec, f) {
      var mode = b.mode === 'take' ? 'take' : 'put', items = b.items || {}, n = 0;
      for (var k in items) {
        if (!has(items, k)) continue;
        var q = Math.max(0, Math.floor(Number(items[k]) || 0)); if (!q) continue;
        if (mode === 'put') {
          if ((f.inv[k] || 0) < q) continue;
          takeItem(f, k, q); f.chest[k] = (f.chest[k] || 0) + q;
        } else {
          if ((f.chest[k] || 0) < q) continue;
          f.chest[k] -= q; if (f.chest[k] <= 0) delete f.chest[k];
          var room = f.backpack - invCount(f);
          if ((f.inv[k] || 0) <= 0 && room <= 0) { f.chest[k] = (f.chest[k] || 0) + q; continue; }
          f.inv[k] = (f.inv[k] || 0) + q;
        }
        n += q;
      }
      if (!n) { fail(res, '没有可搬的东西（或背包满了）', 400); return false; }
      return { moved: n, mode: mode };
    });
  });

  // ---------- 路由：工具升级 / 职业 / 睡觉 ----------
  router.post('/v5/farm/tool', requireAuth, function (req, res) {
    var b = req.body || {};
    guard(uidOf(req), res, 0, function (id, rec, f) {
      var tool = String(b.tool || '');
      if (!has(D.TOOL_NAMES, tool)) { fail(res, '没有这件工具', 400); return false; }
      if (f.toolOrder) { fail(res, '铁匠还在打上一件工具', 400); return false; }
      var cur = f.tools[tool] || 0;
      if (cur >= 4) { fail(res, '已经是铱制了', 400); return false; }
      var up = D.TOOL_UPGRADES[cur];
      var bar = up.bar;
      if (f.gold < up.cost) { fail(res, '需要 ' + up.cost + ' 金', 400); return false; }
      if ((f.inv[bar] || 0) < up.bars) { fail(res, '还差 ' + up.bars + ' 个' + itemName(bar), 400); return false; }
      goldAdd(f, -up.cost); takeItem(f, bar, up.bars);
      f.toolOrder = { tool: tool, lv: up.lv, name: up.name, readyDay: dayNow() + up.days };
      return { ordered: tool, readyDay: f.toolOrder.readyDay };
    });
  });

  router.post('/v5/farm/profession', requireAuth, function (req, res) {
    var b = req.body || {};
    guard(uidOf(req), res, 0, function (id, rec, f) {
      var skill = String(b.skill || ''), pid = String(b.id || '');
      if (!D.PROFESSIONS[skill]) { fail(res, '没有这项技能', 400); return false; }
      var lv = FD.levelOf(f.skills[skill] || 0);
      var tier = lv >= 10 ? 10 : lv >= 5 ? 5 : 0;
      if (!tier) { fail(res, '还没到选职业的等级', 400); return false; }
      var list = D.PROFESSIONS[skill][tier], found = false;
      for (var i = 0; i < list.length; i++) if (list[i][0] === pid) found = true;
      // 5 级那次没回来选的人，到了 10 级也该能补上 —— 别让一次错过变成永久惩罚
      if (!found && lv >= 5 && tier === 10) {
        var l5 = D.PROFESSIONS[skill][5];
        for (var q = 0; q < l5.length; q++) if (l5[q][0] === pid) found = true;
        if (found) list = l5;
      }
      if (!found) { fail(res, '这个等级没有这个职业', 400); return false; }
      // 同一层只能选一次
      for (var j = 0; j < list.length; j++) if (f.profs.indexOf(list[j][0]) >= 0) { fail(res, '这一级已经选过了', 400); return false; }
      f.profs.push(pid);
      return { chosen: pid, skill: skill, tier: tier };
    });
  });

  router.post('/v5/farm/sleep', requireAuth, function (req, res) {
    guard(uidOf(req), res, 0, function (id, rec, f) {
      var day = dayNow();
      f.sleptDay = day;
      // v5.6 W3：睡觉分段恢复 —— 当日第 1 次 +60% max，第 2 次起每次 +30%，封顶 maxEnergy；不跳时间
      if (f.sleepDay !== day) { f.sleepN = 0; f.sleepDay = day; }
      f.sleepN = (f.sleepN || 0) + 1;
      var gain = Math.round(f.maxEnergy * (f.sleepN === 1 ? 0.6 : 0.3));
      f.energy = Math.min(f.maxEnergy, (f.energy || 0) + gain);
      push(id, { k: 'farm-sleep', day: day, n: f.sleepN, energy: f.energy });
      return { slept: day, n: f.sleepN, energy: f.energy };
    });
  });

  // ---------- 农场入口：服务端权威地把人送到自家田里 ----------
  // 不能只靠前端 __sg5.teleport：/v5/sync 会按移动速度把瞬移硬拉回镇上。
  router.post('/v5/farm/goto', requireAuth, function (req, res) {
    guard(uidOf(req), res, 0, function (id, rec, f) {
      var x = D.FARM_X + D.FARM_W / 2, y = D.FARM_Y + D.FARM_H / 2;
      rec.x = x; rec.y = y;
      try {
        var live = SIMc && SIMc.players && SIMc.players[id];
        if (live) { live.x = x; live.y = y; live.seen = nowMs(); }
      } catch (e) {}
      S.flush(id);
      return { x: x, y: y };
    });
  });

  // ---------- tick：全班共享的「晨光」广播 ----------
  function tick() {
    var day = dayNow();
    if (day === CAL.lastDay) return;
    CAL.lastDay = day;
    var c = cal();
    try {
      broadcast('farm-dawn', {
        day: day, season: c.seasonName, weather: c.weather,
        festival: c.festival ? c.festival.name : ''
      }, onlineIds());
    } catch (e) {}
  }

  return {
    DATA: D, FD: FD, cal: cal, payload: payload, of: of, ensure: ensure, save: save,
    settle: settle, addItem: addItem, takeItem: takeItem, goldAdd: goldAdd, xpAdd: xpAdd,
    itemName: itemName, itemCategory: itemCategory, invCount: invCount, unitPrice: unitPrice, dayNow: dayNow,
    energyUse: energyUse, merge: merge, has: has, push: push, broadcast: broadcast,
    onlineIds: onlineIds, TOWN_SPAWN: TOWN_SPAWN, S: S, fail: fail, ok: ok,
    uidOf: uidOf, requireAuth: requireAuth, router: router, nowMs: nowMs,
    world: ctx.world,
    setEpochForDay: setEpochForDay, tick: tick,
    // 供 life.js 复用的动作包装
    guard: guard, defFarm: defFarm,
    // v5.5：彩蛋列表（life.js 的 egg/pick 用同一份过滤逻辑，别让提示与实际可捡不一致）
    eggsOf: eggsOf
  };
};
