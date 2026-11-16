// 拾光群岛 v5 —— 存档（SQLite）
//
// 所有 v5 表以 shiguang5_ 开头，与 v4 的 shiguang_* 互不干扰（回滚 v4 不丢数据）。
// 玩家的装备与背包存 JSON 列：结构随版本演进，不值得为每个词条建一列。
'use strict';

var db = require('_sdk/backend/host').db;
var C = require('./config');
var L = require('./loot');

db.exec([
  'CREATE TABLE IF NOT EXISTS shiguang5_players (',
  '  user_id TEXT PRIMARY KEY,',
  '  x REAL NOT NULL, y REAL NOT NULL,',
  '  level INTEGER NOT NULL DEFAULT 1,',
  '  xp INTEGER NOT NULL DEFAULT 0,',
  '  hp INTEGER NOT NULL DEFAULT 60,',
  '  shards INTEGER NOT NULL DEFAULT 0,',
  '  look TEXT NOT NULL DEFAULT \'NinjaBlue\',',
  '  equip TEXT NOT NULL DEFAULT \'{}\',',
  '  bag TEXT NOT NULL DEFAULT \'[]\',',
  '  mats TEXT NOT NULL DEFAULT \'{}\',',
  '  talents TEXT NOT NULL DEFAULT \'{}\',',
  '  skills TEXT NOT NULL DEFAULT \'["spin"]\',',
  '  waystones TEXT NOT NULL DEFAULT \'["ws_town"]\',',
  '  dex TEXT NOT NULL DEFAULT \'{}\',',
  '  stats TEXT NOT NULL DEFAULT \'{}\',',
  '  flags TEXT NOT NULL DEFAULT \'{}\',',
  '  created_at INTEGER NOT NULL,',
  '  last_seen INTEGER NOT NULL',
  ')'
].join('\n'));
// 宝箱：每人每个宝箱一次（个人进度）
db.exec('CREATE TABLE IF NOT EXISTS shiguang5_chests (user_id TEXT NOT NULL, chest_id TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (user_id, chest_id))');
// 区域灯塔：全服进度（谁点亮的、什么时候）
db.exec('CREATE TABLE IF NOT EXISTS shiguang5_towers (zone TEXT PRIMARY KEY, lit_by TEXT NOT NULL, lit_at INTEGER NOT NULL, kills INTEGER NOT NULL DEFAULT 1)');
// 守护者击杀记录（每人每区，用于首杀奖励）
db.exec('CREATE TABLE IF NOT EXISTS shiguang5_boss_kills (user_id TEXT NOT NULL, zone TEXT NOT NULL, count INTEGER NOT NULL DEFAULT 0, first_at INTEGER NOT NULL, PRIMARY KEY (user_id, zone))');
// 全服日志（世界频道：点灯、首杀、传说掉落）
db.exec('CREATE TABLE IF NOT EXISTS shiguang5_feed (id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, kind TEXT NOT NULL, user_id TEXT NOT NULL, text TEXT NOT NULL)');

var LOOKS = ['NinjaBlue', 'NinjaRed', 'NinjaGreen', 'NinjaYellow', 'NinjaGray', 'NinjaMasked', 'Knight', 'Princess',
  'Monk', 'Hunter', 'Cavegirl', 'EggGirl', 'EggBoy', 'Boy', 'FighterWhite', 'NinjaEskimo', 'RedSamurai', 'BlueSamurai', 'Noble'];

function parse(s, d) { try { var v = JSON.parse(s); return v == null ? d : v; } catch (e) { return d; } }

function rowToPlayer(r) {
  return {
    userId: r.user_id, x: r.x, y: r.y, level: r.level, xp: r.xp, hp: r.hp, shards: r.shards, look: r.look,
    equip: parse(r.equip, {}), bag: parse(r.bag, []), mats: parse(r.mats, {}), talents: parse(r.talents, {}),
    skills: parse(r.skills, ['spin']), waystones: parse(r.waystones, ['ws_town']), dex: parse(r.dex, {}),
    stats: parse(r.stats, {}), flags: parse(r.flags, {}), createdAt: r.created_at
  };
}

var cache = {}; // userId -> player（内存为准，定期落库）
var dirty = {};

function load(userId, spawn) {
  if (cache[userId]) return cache[userId];
  var r = db.prepare('SELECT * FROM shiguang5_players WHERE user_id = ?').get(userId);
  if (!r) {
    var t = Date.now();
    // 新角色：外观按 userId 散列挑一个（之后可在镇上换）
    var h = 0; for (var i = 0; i < userId.length; i++) h = (h * 31 + userId.charCodeAt(i)) | 0;
    var look = LOOKS[Math.abs(h) % 7];
    // 起始装备：木棍 + 旅人斗篷
    var stick = { uid: 'start' + t.toString(36), base: 'w_stick', slot: 'weapon', kind: 'sword', name: '木棍', rarity: 0, ilvl: 1, atk: 5, affixes: {} };
    var equip = { weapon: stick };
    var mats = { potion: 3 };
    // v4 迁移：老玩家的星屑按 1:1 带过来（上限 500），金币不动
    var shards = 0;
    try {
      var old = db.prepare('SELECT stardust FROM shiguang_players WHERE user_id = ?').get(userId);
      if (old && old.stardust) shards = Math.min(500, Math.floor(old.stardust));
    } catch (e) {}
    db.prepare('INSERT INTO shiguang5_players (user_id, x, y, level, xp, hp, shards, look, equip, bag, mats, created_at, last_seen) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(userId, spawn.x, spawn.y, 1, 0, C.BASE_HP, shards, look, JSON.stringify(equip), '[]', JSON.stringify(mats), t, t);
    r = db.prepare('SELECT * FROM shiguang5_players WHERE user_id = ?').get(userId);
    r._new = true;
  }
  var p = rowToPlayer(r);
  p.isNew = !!r._new;
  cache[userId] = p;
  return p;
}

function markDirty(userId) { dirty[userId] = 1; }

function flush(userId) {
  var p = cache[userId];
  if (!p) return;
  try {
    db.prepare('UPDATE shiguang5_players SET x=?, y=?, level=?, xp=?, hp=?, shards=?, look=?, equip=?, bag=?, mats=?, talents=?, skills=?, waystones=?, dex=?, stats=?, flags=?, last_seen=? WHERE user_id=?')
      .run(p.x, p.y, p.level, p.xp, Math.max(1, Math.round(p.hp)), p.shards, p.look, JSON.stringify(p.equip), JSON.stringify(p.bag),
        JSON.stringify(p.mats), JSON.stringify(p.talents), JSON.stringify(p.skills), JSON.stringify(p.waystones),
        JSON.stringify(p.dex), JSON.stringify(p.stats), JSON.stringify(p.flags), Date.now(), userId);
  } catch (e) { console.error('[shiguang5] flush', userId, e.message); }
  delete dirty[userId];
}

function flushAll() { Object.keys(dirty).forEach(flush); }
// 同上：热挂载会留下旧实例的定时器，句柄挂 global 才能回收
var G = global.__shiguang5flush || (global.__shiguang5flush = {});
if (G.timer) { try { clearInterval(G.timer); } catch (e) {} }
G.timer = setInterval(flushAll, 5000);
if (G.timer.unref) G.timer.unref();
var flushTimer = G.timer;

function evict(userId) { flush(userId); delete cache[userId]; }

function chestOpened(userId, id) {
  return !!db.prepare('SELECT 1 FROM shiguang5_chests WHERE user_id = ? AND chest_id = ?').get(userId, id);
}
function openChest(userId, id) {
  db.prepare('INSERT OR IGNORE INTO shiguang5_chests (user_id, chest_id, at) VALUES (?,?,?)').run(userId, id, Date.now());
}
function openedChests(userId) {
  return db.prepare('SELECT chest_id FROM shiguang5_chests WHERE user_id = ?').all(userId).map(function (r) { return r.chest_id; });
}

function towers() {
  var o = {};
  db.prepare('SELECT zone, lit_by, lit_at FROM shiguang5_towers').all().forEach(function (r) { o[r.zone] = { by: r.lit_by, at: r.lit_at }; });
  return o;
}
function lightTower(zone, userId) {
  var ex = db.prepare('SELECT 1 FROM shiguang5_towers WHERE zone = ?').get(zone);
  if (ex) { db.prepare('UPDATE shiguang5_towers SET kills = kills + 1 WHERE zone = ?').run(zone); return false; }
  db.prepare('INSERT INTO shiguang5_towers (zone, lit_by, lit_at) VALUES (?,?,?)').run(zone, userId, Date.now());
  return true;
}
function bossKill(userId, zone) {
  var r = db.prepare('SELECT count FROM shiguang5_boss_kills WHERE user_id = ? AND zone = ?').get(userId, zone);
  if (r) { db.prepare('UPDATE shiguang5_boss_kills SET count = count + 1 WHERE user_id = ? AND zone = ?').run(userId, zone); return r.count + 1; }
  db.prepare('INSERT INTO shiguang5_boss_kills (user_id, zone, count, first_at) VALUES (?,?,1,?)').run(userId, zone, Date.now());
  return 1;
}

function feed(kind, userId, text) {
  try {
    db.prepare('INSERT INTO shiguang5_feed (at, kind, user_id, text) VALUES (?,?,?,?)').run(Date.now(), kind, userId, text);
    db.prepare('DELETE FROM shiguang5_feed WHERE id < (SELECT MAX(id) - 200 FROM shiguang5_feed)').run();
  } catch (e) {}
}
function recentFeed(n) {
  return db.prepare('SELECT at, kind, user_id, text FROM shiguang5_feed ORDER BY id DESC LIMIT ?').all(n || 30);
}

var nameCache = {};
function userName(userId) {
  if (nameCache[userId]) return nameCache[userId];
  var nm = '旅人';
  try {
    var r = db.prepare('SELECT COALESCE(NULLIF(real_name, \'\'), NULLIF(net_name, \'\'), name, user_id) AS nm FROM users WHERE user_id = ?').get(userId);
    if (r && r.nm) nm = String(r.nm);
  } catch (e) {
    try { var r2 = db.prepare('SELECT COALESCE(net_name, name, user_id) AS nm FROM users WHERE user_id = ?').get(userId); if (r2 && r2.nm) nm = String(r2.nm); } catch (e2) {}
  }
  nameCache[userId] = nm;
  return nm;
}

// v5.8 守夜仪式（全服状态）：进程级、随进程重建 —— 唯一必须持久的是「塔亮了」（towers 表），
// 仪式中断重开一场即可；热挂载不重置（挂 global）。
var FINALE = global.__shiguang5finale || (global.__shiguang5finale = { lamp: null, done: false, roster: null });
if (!FINALE.init) {
  FINALE.init = 1;
  if (towers().abyss) FINALE.done = true;   // 已经亮过的服务器：仪式视为完成，不回卷
}

module.exports = {
  LOOKS: LOOKS,
  load: load,
  markDirty: markDirty,
  flush: flush,
  flushAll: flushAll,
  evict: evict,
  chestOpened: chestOpened,
  openChest: openChest,
  openedChests: openedChests,
  towers: towers,
  lightTower: lightTower,
  bossKill: bossKill,
  feed: feed,
  recentFeed: recentFeed,
  userName: userName,
  finale: FINALE,
  TABLES: ['shiguang5_players', 'shiguang5_chests', 'shiguang5_towers', 'shiguang5_boss_kills', 'shiguang5_feed']
};
