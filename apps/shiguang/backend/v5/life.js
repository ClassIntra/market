// 拾光群岛 v5.3 —— 农场之外的生活系统
//
// 养殖 / 钓鱼 / 矿洞 / 献祭 / 节日 / 村民好感 / 心事件 / 结婚。
// 与 farm.js 共用同一份 flags.farm 存档和 guard 动作包装：
// 金币、物品、经验、体力只有一条写入路径，客户端无法伪造产物。

module.exports = function createLife(ctx) {
  var router = ctx.router, FARM = ctx.FARM, FD = ctx.FARM.FD, D = ctx.FARM.DATA;
  var requireAuth = ctx.requireAuth, uidOf = ctx.uidOf, ok = ctx.ok, fail = ctx.fail;
  var guard = ctx.FARM.guard, nowMs = ctx.nowMs, push = ctx.FARM.push;
  var has = ctx.FARM.has, merge = ctx.FARM.merge;
  var broadcast = ctx.FARM.broadcast, onlineIds = ctx.FARM.onlineIds;
  var world = ctx.FARM.world;
  var WG = require('./worldgen');
  var TREE_TILE = {}; TREE_TILE[WG.TILE.TREE] = 1; TREE_TILE[WG.TILE.PINE] = 1; TREE_TILE[WG.TILE.DEADTREE] = 1;

  function day() { return FARM.dayNow(); }
  function prof(f, id) { return f.profs && f.profs.indexOf(id) >= 0; }
  function tileAt(x, y) {
    if (!world || !world.grid || x < 0 || y < 0 || x >= world.size || y >= world.size) return -1;
    return world.grid[y * world.size + x];
  }
  function weekKey(d) { return Math.floor((d - 1) / 7); }
  function rel(f, npc) {
    if (!D.VILLAGERS[npc]) return null;
    if (!f.relations[npc]) {
      f.relations[npc] = { pts: 0, talkedDay: 0, gifts: {}, bouquet: 0, seen: [], spouse: 0 };
    }
    return f.relations[npc];
  }
  function relCap(r) { return r.bouquet ? 10 * D.HEART_PTS : 8 * D.HEART_PTS; }
  function heartEvent(id, f, r, npc) {
    var v = D.VILLAGERS[npc];
    var h = FD.heartsOf(r.pts);
    var marks = [2, 4, 6, 8, 10];
    for (var i = 0; i < marks.length; i++) {
      if (h >= marks[i] && r.seen.indexOf(marks[i]) < 0) {
        r.seen.push(marks[i]);
        var lines = v.hearts || [];
        var text = lines.length ? lines[i % lines.length] : v.name + '第一次主动叫住了你。';
        push(id, { k: 'relation-heart', npc: npc, name: v.name, heart: marks[i], text: text });
      }
    }
  }
  function normalizeNeed(n) {
    if (n.indexOf('gold_') === 0) return n.slice(5) + '_q2';
    return n;
  }
  function bundleItem(f, n) { return f.inv[normalizeNeed(n)] || 0; }

  // ---------- 动物：喂食 / 抚摸 / 收取 ----------
  router.post('/v5/life/animal', requireAuth, function (req, res) {
    var b = req.body || {};
    var mode = String(b.mode || ''), uid = String(b.uid || '');
    guard(uidOf(req), res, mode === 'feed' ? 1 : 0, function (id, rec, f) {
      var a = null;
      for (var i = 0; i < (f.animals || []).length; i++) if (f.animals[i].uid === uid) a = f.animals[i];
      if (!a) { fail(res, '棚里没有这只小家伙', 400); return false; }
      var def = D.ANIMALS[a.kind];
      if (mode === 'feed') {
        if (a.fedDay === day()) { fail(res, '今天已经喂过了', 400); return false; }
        if (!FARM.takeItem(f, 'hay', 1)) { fail(res, '没有干草了（杂货铺有卖）', 400); return false; }
        a.fedDay = day(); a.love = Math.min(1000, a.love + 12);
        return { fed: uid, love: a.love };
      }
      if (mode === 'pet') {
        if (a.pettedDay === day()) { fail(res, '今天已经摸过了', 400); return false; }
        a.pettedDay = day(); a.love = Math.min(1000, a.love + 18);
        return { petted: uid, love: a.love };
      }
      if (mode === 'collect') {
        if (!a.product || a.collected) { fail(res, '今天还没有产出', 400); return false; }
        var pid = a.product;
        var q = a.love >= 900 ? 2 : a.love >= 500 ? 1 : 0;
        var iid = pid + (q ? '_q' + q : '');
        if (!FARM.addItem(f, iid, 1)) { fail(res, '背包满了', 400); return false; }
        a.collected = 1; a.product = '';
        FARM.xpAdd(f, 'farming', 5);
        return { collected: iid, name: FARM.itemName(iid) };
      }
      fail(res, '不认识这个动作', 400); return false;
    });
  });

  // ---------- 钓鱼：服务端决定鱼，客户端只玩绿条 ----------
  router.post('/v5/life/fish/start', requireAuth, function (req, res) {
    var b = req.body || {};
    guard(uidOf(req), res, D.TOOL_ENERGY.fish, function (id, rec, f) {
      if (f.pendingFish) { fail(res, '手上还有一条没拉上来', 400); return false; }
      var s = FD.seasonOf(day()), w = FD.weatherFor(day());
      var fes = FD.festivalOn(day());
      var pool = [];
      for (var i = 0; i < D.FISH.length; i++) {
        var fish = D.FISH[i];
        if (fish.s.indexOf(s) < 0) continue;
        if (fish.w !== 'any' && ((fish.w === 'rain' && !FD.isWet(w)) || (fish.w === 'sun' && FD.isWet(w)))) continue;
        if (fish.id === 'legend' && f.fishCaught.legend) continue;   // 传说之鱼一辈子一条
        var weight = fish.diff >= 90 ? 1 : fish.diff >= 60 ? 3 : 6;
        if (fes && fes.perk === 'fish' && fish.diff >= 60) weight *= 2;
        for (var q = 0; q < weight; q++) pool.push(fish);
      }
      if (!pool.length) { fail(res, '这个时节这里没有鱼', 400); return false; }
      var pick = pool[Math.floor(Math.random() * pool.length)];
      var lv = FD.levelOf(f.skills.fishing || 0);
      var rod = f.tools.rod || 0;
      var green = Math.min(0.85, 0.28 + lv * 0.035 + rod * 0.06 + (fes && fes.perk === 'fish' ? 0.08 : 0));
      f.pendingFish = { id: pick.id, diff: pick.diff, green: green, at: nowMs(), season: s };
      return { fish: pick.id, name: pick.name, diff: pick.diff, green: green, xp: pick.xp };
    });
  });

  router.post('/v5/life/fish/result', requireAuth, function (req, res) {
    var b = req.body || {};
    guard(uidOf(req), res, 0, function (id, rec, f) {
      var p = f.pendingFish;
      if (!p) { fail(res, '没有正在钓的鱼', 400); return false; }
      if (nowMs() - p.at > 90000) { f.pendingFish = null; fail(res, '鱼等太久了，跑了', 400); return false; }
      f.pendingFish = null;
      var score = Math.max(0, Math.min(1, Number(b.score) || 0));
      var okCatch = score >= 0.55 - (FD.levelOf(f.skills.fishing || 0) * 0.02);
      if (!okCatch) return { caught: null, reason: '鱼挣脱了' };
      var def = null;
      for (var i = 0; i < D.FISH.length; i++) if (D.FISH[i].id === p.id) def = D.FISH[i];
      if (!def) return { caught: null, reason: '鱼跑了' };
      var perfect = score >= 0.86;
      var q = perfect ? FD.qualityRoll(FD.levelOf(f.skills.fishing || 0), 'quality', Math.random())
        : FD.qualityRoll(0, '', Math.random());
      var iid = p.id + (q ? '_q' + q : '');
      if (!FARM.addItem(f, iid, 1)) { fail(res, '背包满了，鱼又溜了', 400); return false; }
      f.fishCaught[p.id] = (f.fishCaught[p.id] || 0) + 1;
      f.stats.fish = (f.stats.fish || 0) + 1;
      var up = FARM.xpAdd(f, 'fishing', def.xp * (perfect ? 1.5 : 1));
      if (up) push(id, { k: 'farm-level', skill: 'fishing', lv: up.lv });
      // 钓到的鱼顺手计入图鉴，稀有鱼给全班报一声
      if (def.sell >= 200) {
        try { broadcast('farm-rare', { who: id, fish: def.name }, onlineIds()); } catch (e) {}
      }
      return { caught: iid, name: def.name, perfect: perfect, quality: q,
        price: FD.fishPrice(p.id, q, f.profs, perfect), levels: up ? [up] : [] };
    });
  });

  // ---------- 矿洞：120 层 / 每 5 层电梯 / 矿石 / 楼梯 ----------
  router.post('/v5/life/mine/enter', requireAuth, function (req, res) {
    var b = req.body || {};
    guard(uidOf(req), res, 0, function (id, rec, f) {
      var floor = Math.floor(Number(b.floor) || 1);
      if (floor < 1) floor = 1;
      if (floor > D.MINE_MAX) floor = D.MINE_MAX;
      if (floor > 1 && floor % 5 !== 0) { fail(res, '只能从电梯层下矿', 400); return false; }
      if (floor > (f.elevator || 0) + 1) { fail(res, '这层电梯还没到', 400); return false; }
      // v5.4：fighter 洞里血上限 ×1.15、defender +25（职业在进洞那一刻生效）
      var hp = 40 + FD.levelOf(f.skills.combat || 0) * 10;
      if (prof(f, 'fighter')) hp = Math.round(hp * 1.15);
      if (prof(f, 'defender')) hp += 25;
      f.mineRun = { floor: floor, hp: hp, maxHp: hp, stair: 0, digs: 0 };
      f.mineFloor = floor;
      return { mine: f.mineRun };
    });
  });

  router.post('/v5/life/mine/dig', requireAuth, function (req, res) {
    guard(uidOf(req), res, D.TOOL_ENERGY.mine, function (id, rec, f) {
      var m = f.mineRun;
      if (!m) { fail(res, '先下矿', 400); return false; }
      if (f.energy <= 0) { fail(res, '体力见底了，回去睡一觉', 400); return false; }
      m.digs++;
      // 怪物：越深越常见，打赢给战斗经验，掉血
      // v5.4：scout 遇怪率 ×0.5，brute 承伤 ×0.85
      var monsterChance = Math.min(0.42, 0.12 + m.floor * 0.002) * (prof(f, 'scout') ? 0.5 : 1);
      if (Math.random() < monsterChance) {
        var dmg = Math.max(1, Math.round((4 + Math.floor(m.floor / 12)) * (prof(f, 'brute') ? 0.85 : 1)));
        m.hp -= dmg;
        FARM.xpAdd(f, 'combat', 6 + Math.floor(m.floor / 10));
        if (m.hp <= 0) {
          f.mineRun = null;
          var loss = Math.min(1000, Math.floor(f.gold * 0.1));
          FARM.goldAdd(f, -loss); f.faint++;
          return { mine: null, down: 1, loss: loss };
        }
      }
      // 矿石：按层段解锁，镐等级 + 矿工职业影响产出
      var pool = [];
      for (var i = 0; i < D.ORES.length; i++) {
        var o = D.ORES[i];
        if (m.floor < o.from) continue;
        var w = o.id === 'stone' ? 3 : o.id === 'coal' ? 3 : o.id === 'gem' ? 1 : 4;
        if (o.id === 'iridium') w = 2;
        if (o.id === 'coal' && prof(f, 'prospector')) w *= 2;   // 勘探者：煤更多
        for (var q = 0; q < w; q++) pool.push(o);
      }
      var got = [], n = 1 + (f.profs.indexOf('miner') >= 0 ? 1 : 0) + (f.tools.pickaxe >= 3 && Math.random() < 0.3 ? 1 : 0);
      for (var j = 0; j < n; j++) {
        if (!pool.length) break;
        var ore = pool[Math.floor(Math.random() * pool.length)];
        var oq = FD.qualityRoll(0, '', Math.random()) > 1 ? 1 : 0;
        var iid = ore.id + (oq ? '_q' + oq : '');
        if (FARM.addItem(f, iid, 1)) got.push(iid);
        // 地质学家：宝石成对（第二次必得）
        if (ore.id === 'gem' && prof(f, 'geologist') && FARM.addItem(f, iid, 1)) got.push(iid);
        FARM.xpAdd(f, 'mining', ore.xp);
      }
      f.stats.ore = (f.stats.ore || 0) + got.length;
      // 海盗：5% 挖出矿洞宝箱（金币 100~300 + 宝石 ×1），全班广播一声
      var chest = null;
      if (prof(f, 'pirate') && Math.random() < 0.05) {
        var coins = 100 + Math.floor(Math.random() * 201);
        FARM.goldAdd(f, coins);
        FARM.addItem(f, 'gem', 1);
        chest = { gold: coins, gem: 1 };
        push(id, { k: 'farm-pirate', gold: coins, gem: 1 });
      }
      if (!m.stair && (m.digs >= 2 || Math.random() < 0.35)) m.stair = 1;
      return { mine: m, got: got, chest: chest };
    });
  });

  router.post('/v5/life/mine/stair', requireAuth, function (req, res) {
    guard(uidOf(req), res, 0, function (id, rec, f) {
      var m = f.mineRun;
      if (!m) { fail(res, '先下矿', 400); return false; }
      if (!m.stair) { fail(res, '还没找到往下的楼梯', 400); return false; }
      if (m.floor >= D.MINE_MAX) return { mine: m, bottom: 1 };
      m.floor++; m.stair = 0; m.digs = 0;
      f.mineFloor = m.floor;
      f.mineBest = Math.max(f.mineBest || 0, m.floor);
      if (m.floor % 5 === 0) {
        f.elevator = Math.max(f.elevator || 0, m.floor);
        push(id, { k: 'farm-elevator', floor: m.floor });
      }
      if (m.floor === D.MINE_MAX && !f.inv.skull_key) {
        FARM.addItem(f, 'skull_key', 1);
        push(id, { k: 'farm-mine-bottom', text: '矿洞最底层：头骨钥匙到手了' });
      }
      return { mine: m };
    });
  });

  router.post('/v5/life/mine/leave', requireAuth, function (req, res) {
    guard(uidOf(req), res, 0, function (id, rec, f) {
      f.mineRun = null;
      return { mine: null };
    });
  });

  // ---------- v5.4 加工：设备 + 配方 ----------
  router.post('/v5/life/craft', requireAuth, function (req, res) {
    var b = req.body || {};
    var def = D.RECIPES[String(b.id || '')];
    var n = Math.floor(Number(b.n) || 1) === 5 ? 5 : 1;
    guard(uidOf(req), res, def ? def.energy * n : 0, function (id, rec, f) {
      if (!def) { fail(res, '没有这个配方', 400); return false; }
      var md = D.MACHINES[def.machine];
      if (!f.machines || !f.machines[def.machine]) {
        fail(res, '还没有' + (md ? md.name : def.machine) + '，先去商店买一台', 400); return false;
      }
      // 先整轮校验材料，再统一扣：中途报错不能吞掉前面扣掉的材料
      for (var k in def.inputs) {
        if (!has(def.inputs, k)) continue;
        var need = def.inputs[k] * n;
        if ((f.inv[k] || 0) < need) {
          fail(res, '材料不够：' + FARM.itemName(k) + '还差 ' + (need - (f.inv[k] || 0)) + ' 个', 400); return false;
        }
      }
      for (var k2 in def.inputs) if (has(def.inputs, k2)) FARM.takeItem(f, k2, def.inputs[k2] * n);
      if (!FARM.addItem(f, def.out, def.n * n)) { fail(res, '背包满了，先腾个位置', 400); return false; }
      // 熔炼记采矿经验，其余记耕种经验；经验 = 单次体力 × 3
      var skill = def.machine === 'furnace' ? 'mining' : 'farming';
      var up = FARM.xpAdd(f, skill, def.energy * 3 * n);
      if (up) push(id, { k: 'farm-level', skill: skill, lv: up.lv });
      return { crafted: def.out, n: def.n * n, name: FARM.itemName(def.out), skill: skill };
    });
  });

  // ---------- v5.4 吃：料理回体力，星果永久加体力上限 ----------
  router.post('/v5/life/eat', requireAuth, function (req, res) {
    var b = req.body || {};
    guard(uidOf(req), res, 0, function (id, rec, f) {
      var item = String(b.item || '');
      var base = item.split('_q')[0];
      var def = D.EAT[base];
      if (!def) { fail(res, '这个不能吃', 400); return false; }
      if ((f.inv[item] || 0) < 1) { fail(res, '背包里没有 ' + FARM.itemName(item), 400); return false; }
      if (typeof def === 'object') {
        // starfruit：maxEnergy +34 永久，可重复吃，硬上限 200
        var before = f.maxEnergy;
        f.maxEnergy = Math.min(def.cap || D.ENERGY_CAP, f.maxEnergy + def.maxEnergy);
        if (f.maxEnergy === before) { fail(res, '体力上限已经到头了（' + D.ENERGY_CAP + '）', 400); return false; }
        FARM.takeItem(f, item, 1);
        return { ate: item, gain: 0, maxEnergy: f.maxEnergy, energy: f.energy, capUp: f.maxEnergy - before };
      }
      if (f.energy >= f.maxEnergy) { fail(res, '体力已满', 400); return false; }
      FARM.takeItem(f, item, 1);
      f.energy = Math.min(f.maxEnergy, f.energy + def);
      return { ate: item, gain: def, energy: f.energy, maxEnergy: f.maxEnergy };
    });
  });

  // ---------- v5.4 野外采集 ----------
  router.post('/v5/life/forage/pick', requireAuth, function (req, res) {
    var b = req.body || {};
    guard(uidOf(req), res, 0, function (id, rec, f) {
      var x = Math.floor(Number(b.x)), y = Math.floor(Number(b.y));
      var key = x + ',' + y;
      var list = FD.forageList(day(), f.forageCd);
      var found = null;
      for (var i = 0; i < list.length; i++) if (list[i].x === x && list[i].y === y) found = list[i];
      if (!found) { fail(res, '这里没有可以采集的东西', 400); return false; }
      if (f.forageCd[key] === day()) { fail(res, '这株刚刚采过了', 400); return false; }
      var botanist = prof(f, 'botanist'), gatherer = prof(f, 'gatherer');
      var iid = found.item + (botanist ? '_q2' : '');
      var got = [];
      if (!FARM.addItem(f, iid, 1)) { fail(res, '背包满了', 400); return false; }
      got.push(iid);
      if (gatherer && Math.random() < 0.2 && FARM.addItem(f, iid, 1)) got.push(iid);   // 采集者：20% 双份
      FARM.xpAdd(f, 'foraging', 12);
      f.forageCd[key] = day();
      f.stats.forage = (f.stats.forage || 0) + got.length;
      if (!f.seenForage) f.seenForage = 1;
      return { picked: found.item, got: got, name: FARM.itemName(iid), x: x, y: y };
    });
  });

  // ---------- v5.4 砍树：服务端用世界数据校验树格 ----------
  router.post('/v5/life/chop', requireAuth, function (req, res) {
    var b = req.body || {};
    // 斧头一次的力气（TOOL_ENERGY.axe=4，spec 没写，但砍树免费会让木材经济漏）
    guard(uidOf(req), res, D.TOOL_ENERGY.axe, function (id, rec, f) {
      var x = Math.floor(Number(b.x)), y = Math.floor(Number(b.y));
      var key = x + ',' + y;
      var t = tileAt(x, y);
      if (!TREE_TILE[t]) { fail(res, '这里没有树可以砍', 400); return false; }
      var cd = f.chopped[key];
      if (cd && day() - cd < 3) { fail(res, '这棵树刚被砍过，过几天再来', 400); return false; }
      var forester = prof(f, 'forester'), lumberjack = prof(f, 'lumberjack');
      var woodN = 3 + Math.floor(Math.random() * 3) + (forester ? 1 : 0);   // 3~5（护林人 +1）
      if (!FARM.addItem(f, 'wood', woodN)) { fail(res, '背包满了', 400); return false; }
      var got = { wood: woodN };
      if (Math.random() < (lumberjack ? 0.5 : 0.25) && FARM.addItem(f, 'hardwood', 1)) got.hardwood = 1;
      FARM.xpAdd(f, 'foraging', 10);
      f.chopped[key] = day();
      return { chopped: key, got: got, x: x, y: y };
    });
  });

  // ---------- 村民：对话 / 送礼 / 花束 / 求婚 ----------
  router.post('/v5/life/talk', requireAuth, function (req, res) {
    var b = req.body || {};
    guard(uidOf(req), res, 0, function (id, rec, f) {
      var npc = String(b.npc || '');
      var v = D.VILLAGERS[npc]; if (!v) { fail(res, '这里没有这个人', 400); return false; }
      var r = rel(f, npc); if (!r) { fail(res, '这里没有这个人', 400); return false; }
      if (r.talkedDay === day()) return { talked: 0, pts: r.pts };
      r.talkedDay = day();
      r.pts = Math.min(relCap(r), r.pts + 20);
      heartEvent(id, f, r, npc);
      return { talked: 1, pts: r.pts, hearts: FD.heartsOf(r.pts) };
    });
  });

  router.post('/v5/life/gift', requireAuth, function (req, res) {
    var b = req.body || {};
    guard(uidOf(req), res, 0, function (id, rec, f) {
      var npc = String(b.npc || ''), item = String(b.item || '');
      var v = D.VILLAGERS[npc]; if (!v) { fail(res, '这里没有这个人', 400); return false; }
      var r = rel(f, npc);
      var wk = weekKey(day());
      var used = r.gifts[wk] || 0;
      if (used >= 2 && !(FD.festivalOn(day()) || {}).perk) { fail(res, '这周已经送过两次礼物了', 400); return false; }
      if (!FARM.takeItem(f, item, 1)) { fail(res, '背包里没有 ' + FARM.itemName(item), 400); return false; }
      var ps = item.split('_q'), q = ps[1] ? Number(ps[1]) : 0;
      var taste = FD.tasteOf(v, FARM.itemCategory(item));
      var c = calBirthday(v);
      var pts = FD.giftPoints(taste, q, c, (FD.festivalOn(day()) || {}).perk);
      r.pts = Math.max(0, Math.min(relCap(r), r.pts + pts));
      r.gifts[wk] = used + 1;
      f.stats.gift = (f.stats.gift || 0) + 1;
      heartEvent(id, f, r, npc);
      return { gift: item, taste: taste, pts: pts, total: r.pts, hearts: FD.heartsOf(r.pts), birthday: c };
    });
  });
  function calBirthday(v) {
    var d = day();
    return v.birthday[0] === FD.seasonOf(d) && v.birthday[1] === FD.dayInSeason(d);
  }

  router.post('/v5/life/bouquet', requireAuth, function (req, res) {
    var b = req.body || {};
    guard(uidOf(req), res, 0, function (id, rec, f) {
      var npc = String(b.npc || ''), v = D.VILLAGERS[npc];
      if (!v) { fail(res, '这里没有这个人', 400); return false; }
      var r = rel(f, npc);
      if (FD.heartsOf(r.pts) < 8) { fail(res, '要到 8 颗心才能送花束', 400); return false; }
      if (r.bouquet) { fail(res, '已经送过了', 400); return false; }
      if (f.gold < 200) { fail(res, '花束要 200 金', 400); return false; }
      FARM.goldAdd(f, -200); r.bouquet = 1;
      return { bouquet: 1, npc: npc };
    });
  });

  router.post('/v5/life/marry', requireAuth, function (req, res) {
    var b = req.body || {};
    guard(uidOf(req), res, 0, function (id, rec, f) {
      var npc = String(b.npc || ''), v = D.VILLAGERS[npc];
      if (!v) { fail(res, '这里没有这个人', 400); return false; }
      if (f.spouse) { fail(res, '已经有伴了', 400); return false; }
      var r = rel(f, npc);
      if (FD.heartsOf(r.pts) < 10 || !r.bouquet) { fail(res, '要 10 颗心，并且先送过花束', 400); return false; }
      if (!f.houseLv) { fail(res, '先扩一次房子', 400); return false; }
      if (f.gold < 1500) { fail(res, '美人鱼吊坠要 1500 金', 400); return false; }
      FARM.goldAdd(f, -1500);
      f.spouse = npc; r.spouse = 1;
      try { broadcast('farm-marry', { who: id, name: v.name }, onlineIds()); } catch (e) {}
      return { spouse: npc, name: v.name };
    });
  });

  router.post('/v5/life/spouse', requireAuth, function (req, res) {
    guard(uidOf(req), res, 0, function (id, rec, f) {
      if (!f.spouse) return { spouse: '' };
      var r = rel(f, f.spouse);
      if (r.talkedDay === day()) return { spouse: f.spouse, pts: r.pts };
      r.talkedDay = day(); r.pts = Math.min(relCap(r), r.pts + 20);
      return { spouse: f.spouse, pts: r.pts, hearts: FD.heartsOf(r.pts) };
    });
  });

  // ---------- 社区中心献祭包 ----------
  router.post('/v5/life/bundle', requireAuth, function (req, res) {
    var b = req.body || {};
    guard(uidOf(req), res, 0, function (id, rec, f) {
      var bid = String(b.id || ''), def = null;
      for (var i = 0; i < D.BUNDLES.length; i++) if (D.BUNDLES[i].id === bid) def = D.BUNDLES[i];
      if (!def) { fail(res, '没有这个献祭包', 400); return false; }
      var slot = f.bundles[bid] || (f.bundles[bid] = { items: {}, done: 0 });
      if (slot.done) { fail(res, '这一包已经交齐了', 400); return false; }
      var submitting = b.items || {}, moved = 0;
      for (var j = 0; j < def.need.length; j++) {
        var n = def.need[j];
        if (slot.items[n]) continue;
        if (!submitting[n]) continue;
        if (bundleItem(f, n) < 1) { fail(res, '还缺 ' + n, 400); return false; }
        FARM.takeItem(f, normalizeNeed(n), 1);
        slot.items[n] = 1; moved++;
      }
      if (!moved) { fail(res, '没有可交的东西', 400); return false; }
      var left = 0;
      for (var k = 0; k < def.need.length; k++) if (!slot.items[def.need[k]]) left++;
      var reward = null;
      if (!left) {
        slot.done = 1;
        f.rooms[def.room] = (f.rooms[def.room] || 0) + 1;
        var rw = def.reward;
        if (rw.id === 'rod') { f.tools.rod = Math.min(4, (f.tools.rod || 0) + 1); reward = '鱼竿升级'; }
        else { FARM.addItem(f, rw.id, rw.n); reward = FARM.itemName(rw.id) + ' ×' + rw.n; }
        // 全部包完成 → 温室（冬天也能种）
        var all = 0, done = 0;
        for (var z = 0; z < D.BUNDLES.length; z++) { all++; if (f.bundles[D.BUNDLES[z].id] && f.bundles[D.BUNDLES[z].id].done) done++; }
        if (done >= all && !f.greenhouse) {
          f.greenhouse = true;
          push(id, { k: 'farm-greenhouse', text: '社区中心修好了：温室解锁，冬天也能种地' });
        }
        push(id, { k: 'farm-bundle', name: def.name, reward: reward });
      }
      return { bundle: bid, moved: moved, left: left, reward: reward, greenhouse: f.greenhouse };
    });
  });

  // ---------- 节日 ----------
  router.post('/v5/life/festival', requireAuth, function (req, res) {
    guard(uidOf(req), res, 0, function (id, rec, f) {
      var d = day(), fes = FD.festivalOn(d);
      if (!fes) { fail(res, '今天不是节日', 400); return false; }
      if (f.festivalSeen[d]) { fail(res, '今天的礼已经领过了', 400); return false; }
      f.festivalSeen[d] = 1;
      var gift = null;
      if (fes.perk === 'strawberry') { FARM.addItem(f, 'seed_strawberry', 5); gift = '草莓种子 ×5'; }
      else if (fes.perk === 'fish') { FARM.addItem(f, 'bait', 20); gift = '鱼饵 ×20'; }
      else if (fes.perk === 'sell') { FARM.goldAdd(f, 200); gift = '200 金'; }
      else if (fes.perk === 'exhibit') { FARM.goldAdd(f, 500); gift = '500 金'; }
      else if (fes.perk === 'gift' || fes.perk === 'dance') {
        var keys = Object.keys(D.VILLAGERS);
        for (var i = 0; i < keys.length; i++) {
          var r = rel(f, keys[i]);
          r.pts = Math.min(relCap(r), r.pts + (fes.perk === 'gift' ? 60 : 40));
          heartEvent(id, f, r, keys[i]);
        }
        gift = '和镇上每个人都聊上了';
      } else { FARM.addItem(f, 'hay', 10); gift = '干草 ×10'; }
      return { festival: fes.name, perk: fes.perk, gift: gift };
    });
  });

  // ---------- 玩家之间：送礼（复用好感，把同学也纳入关系网） ----------
  router.post('/v5/life/playergift', requireAuth, function (req, res) {
    var b = req.body || {};
    guard(uidOf(req), res, 0, function (id, rec, f) {
      var to = String(b.to || ''), item = String(b.item || '');
      if (!to || to === id) { fail(res, '不能送给自己', 400); return false; }
      if (!FARM.takeItem(f, item, 1)) { fail(res, '背包里没有 ' + FARM.itemName(item), 400); return false; }
      var other;
      try { other = FARM.of(to); } catch (e) { fail(res, '对方还没进过群岛', 400); return false; }
      if (!other) { fail(res, '对方还没进过群岛', 400); return false; }
      FARM.addItem(other, item, 1);
      FARM.save(to);
      push(to, { k: 'farm-gift', from: id, item: item, name: FARM.itemName(item) });
      return { sent: item, to: to };
    });
  });

  return { rel: rel, normalizeNeed: normalizeNeed, bundleItem: bundleItem, day: day };
};
