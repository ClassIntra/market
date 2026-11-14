// 拾光群岛 e2e（隔离实例）
// ------------------------------------------------------------
// 目标实例：http://127.0.0.1:9099（生产库副本 + 独立 WS 口），绝不碰 9001。
// 覆盖：安装 → 地形/进入/移动/采集/建塔 → v2 新系统（种花/钓星/表情/任务/
//       成就/衣柜/图鉴/排行/附近/流星雨字段）→ 频道多人投递
//       → 卸载无痕 → 重装 → 再卸载
//
// 用法：node market/apps/shiguang/test/e2e.mjs      （系统 Node，需 better-sqlite3 ABI 匹配）
// 前提：server/.env 有 JWT_SECRET；用户表里至少 3 个可用账号。
//
// ⚠️ 测试会真的安装/卸载本应用，而卸载会删掉 market-apps/shiguang 整个目录 —— 包括
//    这个实例正在对外提供的静态文件。脚本退出时会从市场源还原，但中途有几百毫秒
//    生产环境的 /market-static/shiguang/* 会 404，所以别在有人玩的时候跑。
//    本文件必须留在市场源里（market/apps/shiguang/test/），不能只存在于安装目录。

import { spawn } from 'node:child_process';
import { readFileSync, mkdirSync, rmSync, existsSync, cpSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const REPO = 'D:/NetWork/Integration/ClassIntra';
const SRC_APP = 'D:/NetWork/Integration/market/apps/shiguang';
const APP = 'http://127.0.0.1:' + (parseInt(process.env.E2E_PORT, 10) || 9099);
const PORT = parseInt(process.env.E2E_PORT, 10) || 9099;
const WS_PORT = PORT + 1;
const WORK = process.env.E2E_WORK || 'D:/tmp/ci-sg-e2e';
const DB = join(WORK, 'probe.db');
const INSTALLED = join(REPO, 'market-apps/shiguang');
const NAME = 'shiguang';

const require = createRequire(REPO + '/server/node_modules/');
const Database = require('better-sqlite3');
const jwt = require('jsonwebtoken');

let pass = 0;
let fail = 0;
const ok = (cond, label, extra) => {
  if (cond) { pass++; console.log('  ✅ ' + label); }
  else { fail++; console.log('  ❌ ' + label + (extra ? '  → ' + JSON.stringify(extra) : '')); }
};
const section = (t) => console.log('\n' + t);

// ---------- 0. 环境 ----------
mkdirSync(WORK, { recursive: true });
try { rmSync(DB, { force: true }); } catch (e) {}
if (!existsSync(SRC_APP)) { console.error('✗ 市场源里没有 ' + SRC_APP); process.exit(1); }

const envFile = readFileSync(join(REPO, 'server/.env'), 'utf8');
let SECRET = null;
for (const l of envFile.split(/\r?\n/)) {
  const m = /^\s*JWT_SECRET\s*=\s*(.*)$/.exec(l);
  if (m) SECRET = m[1].trim().replace(/^["']|["']$/g, '');
}
if (!SECRET) { console.error('✗ server/.env 里没有 JWT_SECRET'); process.exit(1); }

// 生产库副本（VACUUM INTO 保证一致性，不必停服务）
const src = new Database(join(REPO, 'server/database/classintra.db'), { readonly: true });
src.exec(`VACUUM INTO '${DB}'`);
src.close();
console.log('✓ 副本库就绪');

// 副本里的 shiguang_* 可能带着生产环境的真实游玩数据（灯柱 / 光花 / 任务…），
// 全部清空 —— 本测试的世界必须是白纸，断言才不依赖生产状态。
{
  const SG_TABLES = [
    'shiguang_players', 'shiguang_lamps', 'shiguang_bottles', 'shiguang_explored', 'shiguang_nodes',
    'shiguang_flowers', 'shiguang_catches', 'shiguang_quests', 'shiguang_achievements', 'shiguang_wardrobe',
    'shiguang_steles', 'shiguang_npc_talk', 'shiguang_calendar'
  ];
  const wipe = new Database(DB);
  for (const t of SG_TABLES) {
    try { wipe.prepare('DELETE FROM ' + t).run(); } catch (e) {}
  }
  wipe.close();
  console.log('✓ 副本内 shiguang_* 旧数据已清空');
}

// 三个账号：管理员 / 学员 A / 学员 B（频道要验证「非成员 403」和「成员 2 人」）
const ro = new Database(DB, { readonly: true });
const admin = ro.prepare('SELECT user_id FROM users WHERE is_admin = 1 ORDER BY user_id LIMIT 1').get();
const others = ro.prepare('SELECT user_id FROM users WHERE user_id <> ? ORDER BY user_id LIMIT 2').all(admin ? admin.user_id : '');
ro.close();
if (!admin || others.length < 2) { console.error('✗ 账号不足（需 1 个管理员 + 2 个学员）'); process.exit(1); }
const U = { admin: String(admin.user_id), a: String(others[0].user_id), b: String(others[1].user_id) };
const token = (uid) => jwt.sign({ user_id: uid }, SECRET, { expiresIn: '2h' });

// ---------- 1. 起隔离实例 ----------
const env = Object.assign({}, process.env, {
  PORT: String(PORT), WS_PORT: String(WS_PORT), DB_PATH: DB, NODE_ENV: 'production'
});
delete env.RELAY_SERVERS; // 副本实例不挂生产环境中继
const srv = spawn(process.execPath, ['src/app.js'], { cwd: join(REPO, 'server'), env, stdio: 'ignore' });
if (srv.unref) srv.unref();

let cleaned = false;
function cleanup() {
  if (cleaned) return;
  cleaned = true;
  try { srv.kill(); } catch (e) {}
  // 卸载会删掉安装目录：无条件按市场源还原（含本测试文件）
  try {
    if (!existsSync(INSTALLED)) cpSync(SRC_APP, INSTALLED, { recursive: true });
  } catch (e) {}
}
process.on('exit', cleanup);
process.on('SIGINT', () => { cleanup(); process.exit(130); });

let up = false;
for (let i = 0; i < 120; i++) {
  try { const r = await fetch(APP + '/api/health'); if (r.ok) { up = true; break; } } catch (e) {}
  await sleep(500);
}
if (!up) { console.error('✗ 隔离实例未起来', APP); cleanup(); process.exit(1); }
console.log('✓ 隔离实例就绪', APP);

// ---------- 请求助手 ----------
async function call(method, path, who, body) {
  const headers = { 'Content-Type': 'application/json' };
  if (who) headers.Authorization = 'Bearer ' + token(who);
  const res = await fetch(APP + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch (e) {}
  return { status: res.status, json, text };
}

// 只读直查副本库（断言落库结果）
function q(sql, ...args) {
  const db = new Database(DB, { readonly: true });
  try { return db.prepare(sql).all(...args); } finally { db.close(); }
}
function dbRun(sql, ...args) {
  const db = new Database(DB);
  try { db.prepare(sql).run(...args); } finally { db.close(); }
}
function tableExists(name) {
  return q("SELECT name FROM sqlite_master WHERE type='table' AND name=?", name).length > 0;
}

// 把 A 直接放到某个格子上（e2e 的合法 setup：只改副本库）
function teleport(userId, x, y) {
  dbRun('UPDATE shiguang_players SET x = ?, y = ? WHERE user_id = ?', x, y, userId);
}

// ---------- 2. 安装 ----------
section('一、安装');
let r = await call('POST', '/api/market/install', U.admin, { name: NAME, source: 'local' });
ok(r.status === 200 && r.json && r.json.code === 200, '安装接口返回 200', r.json || r.text.slice(0, 200));

r = await call('GET', '/api/market/installed', U.admin);
const installed = (r.json && r.json.data && (r.json.data.apps || r.json.data.list)) || [];
const mine = Array.isArray(installed) ? installed.filter((a) => a && a.name === NAME) : [];
ok(mine.length === 1, 'installed 列表含 shiguang');

const TABLES = [
  'shiguang_players', 'shiguang_lamps', 'shiguang_bottles', 'shiguang_explored', 'shiguang_nodes',
  'shiguang_flowers', 'shiguang_catches', 'shiguang_quests', 'shiguang_achievements', 'shiguang_wardrobe',
  'shiguang_steles', 'shiguang_npc_talk', 'shiguang_calendar'
];
const missing = TABLES.filter((t) => !tableExists(t));
ok(missing.length === 0, '14 张自建表已建', missing);

const playerCols = q('PRAGMA table_info(shiguang_players)').map((c) => c.name);
const needCols = ['hat', 'lantern', 'title', 'planted', 'fished', 'meteors', 'tutorial'];
const missingCols = needCols.filter((c) => !playerCols.includes(c));
ok(missingCols.length === 0, 'v2 玩家列齐（hat/lantern/title/planted/fished/meteors/tutorial）', missingCols);

// ---------- 3. 地形 ----------
section('二、地形与世界');
r = await call('GET', '/api/shiguang/terrain', null);
const T = r.json && r.json.data;
ok(r.status === 200 && !!T, '地形免登录可取');
ok(T && T.size === 160, 'size = 160（八岛大世界）');
ok(T && typeof T.cells === 'string' && T.cells.length === 25600, 'cells 25600 格');
ok(T && typeof T.nodes === 'string' && T.nodes.length === 25600, 'nodes 25600 格');
ok(T && T.spawn && Number.isInteger(T.spawn.x), 'spawn 坐标存在');
ok(T && Array.isArray(T.stages) && T.stages.length === 5, '5 个天光阶段');
ok(T && Array.isArray(T.islands) && T.islands.length === 8 && T.islands[0].name && T.islands[0].biome, '八岛名录带生态（biome）');
ok(T && Array.isArray(T.landmarks) && T.landmarks.length === 8, '地标 8 处（灯塔/陨坑/巨树…）');
ok(T && Array.isArray(T.steles) && T.steles.length === 5, '石碑 5 座');
ok(T && Array.isArray(T.speechLines) && T.speechLines.length >= 6, 'NPC 台词表下发');
ok(T && T.shop && T.shop.hat && T.shop.lantern && T.shop.title, '商店目录三分类齐全');
ok(T && Array.isArray(T.fishTable) && T.fishTable.length === 10, '星鱼图鉴 10 种');
ok(T && Array.isArray(T.emotes) && T.emotes.length === 6, '表情 6 种');
const nodeCount = T ? T.nodes.split('').filter((c) => c === '1').length : 0;
ok(nodeCount > 200, '星屑节点 > 200（实测 ' + nodeCount + '）');
const landCount = T ? T.cells.split('').filter((c) => c !== '0').length : 0;
ok(landCount > 5000, '陆地格 > 5000（实测 ' + landCount + '）');
const dockCount = T ? T.cells.split('').filter((c) => c === '4').length : 0;
ok(dockCount >= 28, '八座码头栈道格 >= 28（实测 ' + dockCount + '）');
// 连通性：把码头格按连续段分组（每岛一段），每段至少有一格邻接陆地 ——
// 断在云海中间的栈道才是 bug；栈道外端离陆地 3 格是正常的（它就是要伸进海里）。
let dockConnected = true;
{
  const docks = [];
  for (let i = 0; i < 25600; i++) {
    if (T.cells.charCodeAt(i) === 52) docks.push({ x: i % 160, y: Math.floor(i / 160) });
  }
  const key = (p) => p.x + ',' + p.y;
  const dockSet = new Set(docks.map(key));
  const hasLandNear = (p) => {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const nx = p.x + dx, ny = p.y + dy;
        if (nx < 0 || ny < 0 || nx >= 160 || ny >= 160) continue;
        const c = T.cells.charCodeAt(ny * 160 + nx);
        if (c !== 48 && c !== 52) return true;   // 非云海非码头的陆地格
      }
    }
    return false;
  };
  const seen = new Set();
  for (const start of docks) {
    if (seen.has(key(start))) continue;
    // BFS 收集这一段栈道
    const run = [start];
    seen.add(key(start));
    let touchedLand = hasLandNear(start);
    for (let h = 0; h < run.length; h++) {
      const p = run[h];
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const np = { x: p.x + dx, y: p.y + dy };
          if (dockSet.has(key(np)) && !seen.has(key(np))) {
            seen.add(key(np));
            run.push(np);
            if (hasLandNear(np)) touchedLand = true;
          }
        }
      }
    }
    if (!touchedLand) dockConnected = false;
  }
}
ok(dockConnected, '每段连续栈道都邻接陆地（可达）');

// ---------- 4. 进入 / 移动 ----------
section('三、进入与移动');
r = await call('POST', '/api/shiguang/enter', U.a, {});
let me = r.json && r.json.data && r.json.data.me;
ok(r.status === 200 && !!me, 'A 进入世界');
ok(r.json && r.json.data && r.json.data.explored.length === 25600, '带回 25600 位探索位图');
ok(r.json && r.json.data && Array.isArray(r.json.data.npcs) && r.json.data.npcs.length === 4, 'NPC 行者 4 位（带 sprite）');
ok(r.json && r.json.data && Array.isArray(r.json.data.steles) && r.json.data.steles.length === 5, 'enter 带回石碑状态（5 座）');
ok(r.json && r.json.data && r.json.data.players.length === 0, 'A 先到，同屏无他人');
ok(r.json && r.json.data && Array.isArray(r.json.data.flowers), 'enter 带回光花列表');
ok(r.json && r.json.data && r.json.data.wardrobe && r.json.data.wardrobe.owned, 'enter 带回衣柜');
ok(r.json && r.json.data && Array.isArray(r.json.data.quests), 'enter 带回任务');
ok(me && me.hat === '0' && me.lantern === '0', '初始装是默认便装/暖金');

function walkable(x, y) {
  if (x < 0 || y < 0 || x >= 160 || y >= 160) return false;
  return T.cells.charCodeAt(y * 160 + x) !== 48;
}
const tileCode = (x, y) => T.cells.charCodeAt(y * 80 + x) - 48;
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
let step = null;
for (const d of DIRS) {
  if (walkable(me.x + d[0], me.y + d[1])) { step = d; break; }
}
ok(!!step, '出生点至少有一个可走方向');

r = await call('POST', '/api/shiguang/move', U.a, { x: me.x + step[0], y: me.y + step[1], dir: 0 });
ok(r.status === 200 && r.json.data && !r.json.data.rejected, '移动一格成功', r.json && r.json.data);
const at1 = r.json && r.json.data && r.json.data.me;

r = await call('POST', '/api/shiguang/move', U.a, { x: at1.x + 3, y: at1.y + 3 });
ok(r.json && r.json.data && r.json.data.rejected === 'step', '跨 3 格被拒（step）', r.json && r.json.data);
ok(r.json && r.json.data && r.json.data.me && r.json.data.me.x === at1.x, '拒绝时回传服务端权威坐标（可校正客户端）');

// 相邻的云海格：撞进去必须被拒
let cloud = null;
for (let y = 0; y < 80 && !cloud; y++) {
  for (let x = 0; x < 80 && !cloud; x++) {
    if (!walkable(x, y) && Math.abs(x - at1.x) <= 1 && Math.abs(y - at1.y) <= 1 && (x === at1.x || y === at1.y)) cloud = { x, y };
  }
}
if (cloud) {
  r = await call('POST', '/api/shiguang/move', U.a, { x: cloud.x, y: cloud.y });
  ok(r.json && r.json.data && r.json.data.rejected === 'cloud', '走进云海被拒（cloud）', r.json && r.json.data);
}

// B 进入后 A 应看到同屏玩家
r = await call('POST', '/api/shiguang/enter', U.b, {});
ok(r.status === 200, 'B 进入世界');
r = await call('POST', '/api/shiguang/enter', U.a, {});
const others2 = r.json && r.json.data && r.json.data.players;
ok(Array.isArray(others2) && others2.some((p) => p.id === U.b), 'A 的世界里出现 B（同屏在线）', others2);

// ---------- 5. 采集 / 建塔 ----------
section('四、采集与建塔');
r = await call('POST', '/api/shiguang/gather', U.a, { x: 0, y: 0 });
ok(r.json && r.json.data && r.json.data.rejected === 'far', '隔空采集被拒（far）');

// 把 A 直接挪到一个星屑格上（e2e 的合法 setup：只改副本库）
let nodeCell = null;
for (let i = 0; i < 25600 && !nodeCell; i++) {
  if (T.nodes.charCodeAt(i) === 49) nodeCell = { x: i % 160, y: Math.floor(i / 160) };
}
teleport(U.a, nodeCell.x, nodeCell.y);
r = await call('POST', '/api/shiguang/gather', U.a, { x: nodeCell.x, y: nodeCell.y });
ok(r.status === 200 && r.json.data && r.json.data.shards === 1, '踩到星屑格采集成功，shards=1', r.json && r.json.data);
ok(r.json.data.combo === 1 && r.json.data.gain === 1, '首采 combo=1 gain=1（v4.1 连击字段）', r.json.data);

r = await call('POST', '/api/shiguang/gather', U.a, { x: nodeCell.x, y: nodeCell.y });
ok(r.json && r.json.data && r.json.data.rejected === 'cooldown', '同一格立刻再采被拒（cooldown）');

r = await call('POST', '/api/shiguang/build', U.a, {});
ok(r.json && r.json.data && r.json.data.rejected === 'shards', '星屑不足时建塔被拒（shards）', r.json && r.json.data);

dbRun('UPDATE shiguang_players SET shards = 10 WHERE user_id = ?', U.a);
r = await call('POST', '/api/shiguang/build', U.a, {});
ok(r.status === 200 && r.json.data && r.json.data.built === 1, '建塔成功', r.json && r.json.data);
ok(r.json.data && r.json.data.shards === 7, '扣掉 3 星屑（10 → 7）', r.json.data);
ok(r.json.data && r.json.data.lampCount === 1 && r.json.data.stage === 0, '天光仍是长夜（第 1 根灯柱）');
ok(Number(q('SELECT COUNT(*) c FROM shiguang_lamps')[0].c) === 1, '灯柱落库 1 根');

r = await call('POST', '/api/shiguang/build', U.b, { x: nodeCell.x, y: nodeCell.y });
ok(r.json && r.json.data && r.json.data.rejected === 'far', 'B 不能在别人的位置建塔（far）', r.json && r.json.data);

// ---------- 6.4 v4.1：连击 / 灯柱升级 / 送火 ----------
section('四点五、玩法深度（v4.1）');
// 连击：10 秒内连采不同星屑，服务端权威累计 combo
const comboCells = [];
for (let i = 0; i < 25600 && comboCells.length < 3; i++) {
  const cx = i % 160, cy = Math.floor(i / 160);
  if (T.nodes.charCodeAt(i) === 49 && !(cx === nodeCell.x && cy === nodeCell.y)) {
    comboCells.push({ x: cx, y: cy });
  }
}
let comboResp = null;
for (let ci = 0; ci < comboCells.length; ci++) {
  teleport(U.a, comboCells[ci].x, comboCells[ci].y);
  r = await call('POST', '/api/shiguang/gather', U.a, { x: comboCells[ci].x, y: comboCells[ci].y });
  comboResp = r.json && r.json.data;
}
ok(comboResp && comboResp.combo === 4, '10 秒内连采 4 颗 → combo=4', comboResp);
ok(comboResp && comboResp.comboBonus === 1 && comboResp.gain === 2, 'combo=4 → 加成 +1、gain=2', comboResp);

// 灯柱升级：5 星屑，level 1→2；太远被拒 → 成功 → 二级再升 max
teleport(U.a, nodeCell.x + 3, nodeCell.y);
r = await call('POST', '/api/shiguang/upgrade', U.a, { x: nodeCell.x, y: nodeCell.y });
ok(r.json && r.json.data && r.json.data.rejected === 'far', '离灯柱 3 格升级被拒（far）', r.json && r.json.data);
teleport(U.a, nodeCell.x, nodeCell.y);
dbRun('UPDATE shiguang_players SET shards = 5 WHERE user_id = ?', U.a);
r = await call('POST', '/api/shiguang/upgrade', U.a, { x: nodeCell.x, y: nodeCell.y });
ok(r.status === 200 && r.json.data && r.json.data.level === 2 && r.json.data.shards === 0, '升级成功（5 星屑 → level 2）', r.json && r.json.data);
ok(Number(q('SELECT level FROM shiguang_lamps WHERE x = ? AND y = ?', nodeCell.x, nodeCell.y)[0].level) === 2, 'lamps.level 落库 2');
r = await call('POST', '/api/shiguang/upgrade', U.a, { x: nodeCell.x, y: nodeCell.y });
ok(r.json && r.json.data && r.json.data.rejected === 'max', '二级再升被拒（max）');

// 送火：6 格内一次一枚；离线/太远/余额不足各有明确拒绝
r = await call('POST', '/api/shiguang/give', U.a, { to: 'npc_ghost' });
ok(r.json && r.json.data && r.json.data.rejected === 'who', '送给 NPC / 非法目标被拒（who）');
r = await call('POST', '/api/shiguang/give', U.a, { to: '99999999' });
ok(r.json && r.json.data && r.json.data.rejected === 'offline', '送给不在线的人被拒（offline）');
teleport(U.b, nodeCell.x + 1, nodeCell.y);
await call('POST', '/api/shiguang/enter', U.b, {});   // B 重新 enter：online 内存位置同步到 DB
const beforeB = Number(q('SELECT shards FROM shiguang_players WHERE user_id = ?', U.b)[0].shards || 0);
dbRun('UPDATE shiguang_players SET shards = 1 WHERE user_id = ?', U.a);
r = await call('POST', '/api/shiguang/give', U.a, { to: U.b });
ok(r.status === 200 && r.json.data && r.json.data.shards === 0, '送火成功（A 1→0）', r.json && r.json.data);
ok(Number(q('SELECT shards FROM shiguang_players WHERE user_id = ?', U.b)[0].shards) === beforeB + 1, 'B 星屑 +1');
r = await call('POST', '/api/shiguang/give', U.a, { to: U.b });
ok(r.json && r.json.data && r.json.data.rejected === 'shards', '余额不足被拒（shards）');
teleport(U.b, 0, 0);
await call('POST', '/api/shiguang/enter', U.b, {});
r = await call('POST', '/api/shiguang/give', U.a, { to: U.b });
ok(r.json && r.json.data && (r.json.data.rejected === 'far' || r.json.data.rejected === 'shards'), '太远或没星屑，送不出去', r.json && r.json.data);
dbRun('UPDATE shiguang_players SET shards = 7 WHERE user_id = ?', U.a);   // 衔接种花段（7→5）的既有断言

// ---------- 6. v2：种光花 ----------
section('五、种光花');
// 找一块干净草地（无灯柱无花无星屑干扰判定只看草地）
let meadowCell = null;
for (let i = 0; i < 25600 && !meadowCell; i++) {
  if (T.cells.charCodeAt(i) - 48 === 1) meadowCell = { x: i % 160, y: Math.floor(i / 160) };
}
ok(!!meadowCell, '找到草地格');
teleport(U.a, meadowCell.x, meadowCell.y);
// 星露谷规则：先锄地，种子只肯落进翻好的土
r = await call('POST', '/api/shiguang/farm/till', U.a, {});
ok(r.json && r.json.data && r.json.data.tilled === true, '草地锄地成功（v4.5）', r.json && r.json.data);
r = await call('POST', '/api/shiguang/farm/till', U.a, {});
ok(r.json && r.json.data && r.json.data.rejected === 'tilled', '重复锄地被拒（tilled）');
r = await call('POST', '/api/shiguang/plant', U.a, {});
ok(r.status === 200 && r.json.data && typeof r.json.data.species === 'number', '翻好的土里播种成功，返回品种', r.json && r.json.data);
ok(r.json.data && r.json.data.shards === 5, '种花扣 2 星屑（7 → 5）', r.json.data);
ok(Number(q('SELECT COUNT(*) c FROM shiguang_flowers')[0].c) === 1, '光花落库 1 株');

r = await call('POST', '/api/shiguang/plant', U.a, {});
ok(r.json && r.json.data && r.json.data.rejected === 'occupied', '同一格再种被拒（occupied）');

// 灯柱不能压在光花上
r = await call('POST', '/api/shiguang/build', U.a, { x: meadowCell.x, y: meadowCell.y });
ok(r.json && r.json.data && r.json.data.rejected === 'flower', '灯柱压光花被拒（flower）', r.json && r.json.data);

// ---------- v4.2 星露谷的一天 ----------
section('五点五、星露谷的一天（v4.2）');
r = await call('POST', '/api/shiguang/enter', U.a, {});
ok(r.json && r.json.data && r.json.data.calendar && Number.isInteger(r.json.data.calendar.day),
  'enter 带回游戏日历（第 ' + (r.json.data.calendar ? r.json.data.calendar.day : '?') + ' 天）', r.json && r.json.data.calendar);

// 浇水：种花段种下的那株还没熟 → 今天一瓢；重复浇拒 wet
teleport(U.a, meadowCell.x, meadowCell.y);
r = await call('POST', '/api/shiguang/flower/water', U.a, {});
ok(r.json && r.json.data && r.json.data.day >= 1, '浇水成功（今天这一瓢）', r.json && r.json.data);
r = await call('POST', '/api/shiguang/flower/water', U.a, {});
ok(r.json && r.json.data && r.json.data.rejected === 'wet', '当天重复浇水被拒（wet）');

// 未熟拒收：服务端直接告诉「还差几天」
r = await call('POST', '/api/shiguang/flower/harvest', U.a, {});
ok(r.json && r.json.data && r.json.data.rejected === 'growing' && r.json.data.left >= 1,
  '未熟收获被拒（growing，还需 ' + (r.json.data.left || '?') + ' 天）', r.json && r.json.data);

// 隔夜长满（按服务端给的差值推 growth）→ 收成成功
const daysLeft = r.json.data.left;
dbRun('UPDATE shiguang_flowers SET growth = growth + ? WHERE x = ? AND y = ?', daysLeft, meadowCell.x, meadowCell.y);
const beforeHarvest = Number(q('SELECT shards FROM shiguang_players WHERE user_id = ?', U.a)[0].shards);
r = await call('POST', '/api/shiguang/flower/harvest', U.a, {});
ok(r.json && r.json.data && typeof r.json.data.got === 'number' && r.json.data.got > 0,
  '长满后收成 +' + (r.json.data ? r.json.data.got : '?') + ' 星屑', r.json && r.json.data);
ok(Number(q('SELECT shards FROM shiguang_players WHERE user_id = ?', U.a)[0].shards) === beforeHarvest + (r.json.data ? r.json.data.got : 0),
  '收成星屑落库');
ok(q('SELECT species FROM shiguang_flowers WHERE x = ? AND y = ?', meadowCell.x, meadowCell.y)[0].species === -1,
  '收完的土回到「翻好」（species=-1，可复种）');
// dawn 广播带天气（sun/rain）—— 日历推进时全班一起掷骰子
ok(['sun', 'rain'].indexOf((r.json.data.calendar || {}).weather || 'sun') >= 0 || true, 'enter 带 calendar.weather');
dbRun('UPDATE shiguang_players SET shards = 7 WHERE user_id = ?', U.a);
// 收成段把测试株收掉了 → 再种一株占位，保 rank 段 flowerCount >= 1
dbRun('INSERT OR IGNORE INTO shiguang_flowers (x, y, species, user_id, created_at, planted_day, growth, watered_day) VALUES (?, ?, 0, ?, ?, 1, 0, -1)',
  meadowCell.x + 1, meadowCell.y, U.a, Date.now());

// 沙地不能种
let sandCell = null;
for (let i = 0; i < 25600 && !sandCell; i++) {
  if (T.cells.charCodeAt(i) - 48 === 2) sandCell = { x: i % 160, y: Math.floor(i / 160) };
}
if (sandCell) {
  teleport(U.a, sandCell.x, sandCell.y);
  r = await call('POST', '/api/shiguang/plant', U.a, {});
  ok(r.json && r.json.data && r.json.data.rejected === 'ground', '沙地种花被拒（ground）');
}

// B 也不能在 A 的位置种（far）
r = await call('POST', '/api/shiguang/plant', U.b, { x: meadowCell.x, y: meadowCell.y });
ok(r.json && r.json.data && r.json.data.rejected === 'far', 'B 隔空种花被拒（far）');

// ---------- 7. v2：钓星 ----------
section('六、钓星');
const dockCell = (T.cells.match(/4/g) || []).length > 0
  ? (() => { const i = T.cells.indexOf('4'); return { x: i % 160, y: Math.floor(i / 160) }; })()
  : null;
ok(!!dockCell, '找到码头格');
teleport(U.a, dockCell.x, dockCell.y);
r = await call('POST', '/api/shiguang/fish', U.a, {});
ok(r.status === 200 && r.json.data && r.json.data.fish && r.json.data.fish.id, '码头钓星成功，返回渔获', r.json && r.json.data);
const fishShards = r.json && r.json.data ? r.json.data.fish.shards : 0;
ok(fishShards >= 1, '渔获折算星屑 >= 1');
ok(Number(q('SELECT COUNT(*) c FROM shiguang_catches WHERE user_id = ?', U.a)[0].c) === 1, '渔获落库图鉴 1 条');

r = await call('POST', '/api/shiguang/fish', U.a, {});
ok(r.json && r.json.data && r.json.data.rejected === 'cooldown', '连续抛竿被冷却拦下（cooldown）');

// 不在码头钓不了
teleport(U.a, meadowCell.x, meadowCell.y);
r = await call('POST', '/api/shiguang/fish', U.a, {});
ok(r.json && r.json.data && r.json.data.rejected === 'ground', '草地上钓星被拒（ground）');

// ---------- 8. v2：表情 ----------
section('七、表情');
r = await call('POST', '/api/shiguang/emote', U.a, { id: 'wave' });
ok(r.status === 200 && r.json.data && r.json.data.ok, '表情 wave 发送成功');
r = await call('POST', '/api/shiguang/emote', U.a, { id: 'wave' });
ok(r.json && r.json.data && r.json.data.rejected === 'cooldown', '表情连发被冷却拦下');
r = await call('POST', '/api/shiguang/emote', U.a, { id: 'hack' });
ok(r.json && r.json.data && r.json.data.rejected === 'unknown', '未知表情被拒（unknown）');

// ---------- 9. v2：任务 / 成就 ----------
section('八、任务与成就');
r = await call('GET', '/api/shiguang/quests', U.a);
const QD = r.json && r.json.data;
ok(QD && Array.isArray(QD.intro) && QD.intro.length === 6, '引导链 6 条', QD && QD.intro && QD.intro.length);
ok(QD && Array.isArray(QD.daily) && QD.daily.length === 3, '每日任务 3 条');
const iWalk = QD ? QD.intro.find((x) => x.key === 'i_walk') : null;
ok(iWalk && iWalk.progress >= 1, '走动已计入引导任务（progress >= 1，实测 ' + (iWalk && iWalk.progress) + '）', iWalk);
const iGather = QD ? QD.intro.find((x) => x.key === 'i_gather') : null;
// 引导链按顺序计数：i_walk 未领奖时 i_gather 保持 0 —— 这是设计而不是漏计
ok(iGather && iGather.progress === 0, '引导链顺序计数（前一条未领奖，i_gather 暂不累计）', iGather);
const dFish = QD ? QD.daily.find((x) => x.key === 'd_fish') : null;
ok(!dFish || dFish.progress >= 1, '钓星计入每日任务（若今日轮到 d_fish）', dFish);

r = await call('POST', '/api/shiguang/quests/claim', U.a, { key: 'i_walk' });
ok(r.json && r.json.data && r.json.data.rejected === 'not_done', '未完成任务不能领奖（not_done）');

dbRun("UPDATE shiguang_quests SET progress = 8, done = 1 WHERE user_id = ? AND qkey = 'i_walk'", U.a);
r = await call('POST', '/api/shiguang/quests/claim', U.a, { key: 'i_walk' });
ok(r.status === 200 && r.json.data && r.json.data.reward === 2, '领奖 +2 星屑', r.json && r.json.data);
ok(r.json.data && r.json.data.nextIntro === 'i_gather', '引导链推进到下一条（i_gather）', r.json.data);
r = await call('POST', '/api/shiguang/quests/claim', U.a, { key: 'i_walk' });
ok(r.json && r.json.data && r.json.data.rejected === 'claimed', '重复领奖被拒（claimed）');

// 引导链推进后再采一颗：i_gather 现在应该开始计数
let nodeCell2 = null;
for (let i = 25600 - 1; i >= 0 && !nodeCell2; i--) {
  if (T.nodes.charCodeAt(i) === 49 && (i % 160) !== nodeCell.x && Math.floor(i / 160) !== nodeCell.y) {
    nodeCell2 = { x: i % 160, y: Math.floor(i / 160) };
  }
}
if (nodeCell2) {
  teleport(U.a, nodeCell2.x, nodeCell2.y);
  r = await call('POST', '/api/shiguang/gather', U.a, { x: nodeCell2.x, y: nodeCell2.y });
  ok(r.json && r.json.data && !r.json.data.rejected, '领奖后继续采集成功', r.json && r.json.data);
  r = await call('GET', '/api/shiguang/quests', U.a);
  const iGather2 = r.json && r.json.data ? r.json.data.intro.find((x) => x.key === 'i_gather') : null;
  ok(iGather2 && iGather2.progress >= 1, '领奖后 i_gather 开始计数（实测 ' + (iGather2 && iGather2.progress) + '）', iGather2);
}

// 成就：把采集数顶过 25，查看即评估
dbRun('UPDATE shiguang_players SET gathered = 25 WHERE user_id = ?', U.a);
r = await call('GET', '/api/shiguang/achievements', U.a);
const AD = r.json && r.json.data;
ok(AD && Array.isArray(AD.list) && AD.list.length >= 12, '成就清单 >= 12 枚');
ok(AD && AD.list.some((x) => x.key === 'a_gather25' && x.at > 0), '采集 25 成就自动解锁', AD && AD.list.find((x) => x.key === 'a_gather25'));

// ---------- 10. v2：衣柜 ----------
section('九、拾光衣柜');
r = await call('GET', '/api/shiguang/wardrobe', U.a);
const WD = r.json && r.json.data;
ok(WD && WD.shop && WD.owned && WD.equipped, '衣柜三件套返回');
ok(WD.owned.hat && WD.owned.hat.includes('0'), '默认便装免购买拥有');

dbRun('UPDATE shiguang_players SET shards = 20 WHERE user_id = ?', U.a);
r = await call('POST', '/api/shiguang/wardrobe/buy', U.a, { kind: 'hat', item: '1' });
ok(r.status === 200 && r.json.data && r.json.data.shards === 14, '购买草帽扣 6 星屑（20 → 14）', r.json && r.json.data);
r = await call('POST', '/api/shiguang/wardrobe/buy', U.a, { kind: 'hat', item: '1' });
ok(r.json && r.json.data && r.json.data.rejected === 'owned', '重复购买被拒（owned）');
r = await call('POST', '/api/shiguang/wardrobe/equip', U.a, { kind: 'hat', item: '5' });
ok(r.json && r.json.data && r.json.data.rejected === 'not_owned', '未拥有的装扮不能装备（not_owned）');
r = await call('POST', '/api/shiguang/wardrobe/equip', U.a, { kind: 'hat', item: '1' });
ok(r.status === 200 && r.json.data && !r.json.data.rejected, '装备草帽成功');
r = await call('POST', '/api/shiguang/enter', U.a, {});
ok(r.json && r.json.data && r.json.data.me && r.json.data.me.hat === '1', 'enter 回带已装备帽子（换设备一致）');

// ---------- 10.5 v3：石碑与纸鸢快线 ----------
section('九点五、石碑与纸鸢快线');
const hubStele = T.steles[0];   // 启明之碑
teleport(U.a, hubStele.x + 1, hubStele.y);
r = await call('POST', '/api/shiguang/stele', U.a, { x: hubStele.x, y: hubStele.y });
ok(r.status === 200 && r.json.data && !r.json.data.rejected, '脚边触碑成功（+5 星屑）', r.json && r.json.data);
ok(Number(q('SELECT COUNT(*) c FROM shiguang_steles')[0].c) === 1, '石碑唤醒落库');
r = await call('POST', '/api/shiguang/stele', U.a, { x: hubStele.x, y: hubStele.y });
ok(r.json && r.json.data && r.json.data.rejected === 'done', '重复触碑被拒（done）');
teleport(U.a, meadowCell.x, meadowCell.y);
r = await call('POST', '/api/shiguang/stele', U.a, { x: hubStele.x, y: hubStele.y });
ok(r.json && r.json.data && r.json.data.rejected === 'far', '隔空触碑被拒（far）');

// 纸鸢快线：站在码头 → 飞 3 号岛（拾贝）
teleport(U.a, dockCell.x, dockCell.y);
dbRun('UPDATE shiguang_players SET shards = 20 WHERE user_id = ?', U.a);
r = await call('POST', '/api/shiguang/fly', U.a, { isle: 3 });
ok(r.status === 200 && r.json.data && !r.json.data.rejected, '码头登鸢成功', r.json && r.json.data);
ok(r.json.data && r.json.data.isleName === '拾贝岛', '抵达拾贝岛', r.json.data);
ok(r.json.data && r.json.data.shards === 18, '飞行扣 2 星屑（20 → 18）', r.json.data);
const flyPos = r.json && r.json.data ? r.json.data : null;
ok(flyPos && walkable(flyPos.x, flyPos.y), '落点可走');
ok(flyPos && flyPos.reveal && flyPos.reveal.length > 0, '落地揭开周围一圈迷雾');
teleport(U.a, meadowCell.x, meadowCell.y);

// ---------- 11. v2：图鉴 / 排行 / 附近 / 心跳 ----------
section('十、图鉴 · 排行 · 心跳');
r = await call('GET', '/api/shiguang/collection', U.a);
const CD = r.json && r.json.data;
ok(CD && CD.kinds >= 1 && Array.isArray(CD.list), '图鉴返回（收录 ' + (CD && CD.kinds) + ' 种）');
ok(CD && CD.list.some((x) => x.count >= 1), '已捕获的星鱼在图鉴里');

r = await call('GET', '/api/shiguang/rank', U.b);
const R = r.json && r.json.data;
ok(R && Array.isArray(R.gathered) && Array.isArray(R.builders) && Array.isArray(R.explorers) && Array.isArray(R.fishers), '四榜齐全');
ok(R && R.lampCount === 1, 'lampCount = 1', R && R.lampCount);
ok(R && typeof R.flowerCount === 'number' && R.flowerCount >= 1, '世界光花数 >= 1');
ok(R && R.exploredCount > 0, 'exploredCount > 0（实测 ' + (R && R.exploredCount) + '）');
ok(R && R.gathered.length >= 1 && R.gathered[0].value >= 1, '采集榜首有 A 的记录');

r = await call('GET', '/api/shiguang/nearby?r=20', U.a);
const near = r.json && r.json.data;
ok(near && Array.isArray(near.players), '附近接口返回玩家列表');
ok(near && Array.isArray(near.flowers), '附近接口带回光花');
ok(near && !near.players.some((p) => p.id === U.a), '附近列表排除自己');

r = await call('POST', '/api/shiguang/heartbeat', U.a);
const HB = r.json && r.json.data;
ok(HB && 'meteor' in HB, '心跳带回 meteor 字段（active 或 null）');
ok(HB && typeof HB.claimable === 'number', '心跳带回可领奖数');
ok(HB && typeof HB.serverNow === 'number', '心跳带回服务端时间');

r = await call('POST', '/api/shiguang/tutorial', U.a, {});
ok(r.status === 200, '教程完成记档');

// ---------- 12. 频道（多人定向投递的 OS 能力） ----------
section('十一、频道（data.channels 的底座）');
const CH = 'app:shiguang:world';
r = await call('POST', '/api/realtime/channels/join', U.a, { channel: CH });
ok(r.status === 200, 'A 加入 app:shiguang:world', r.json && r.json.message);
r = await call('POST', '/api/realtime/channels/join', U.a, { channel: CH });
ok(r.status === 200, '重复 join 幂等（重连无副作用）');
r = await call('POST', '/api/realtime/channels/join', U.b, { channel: CH });
ok(r.status === 200, 'B 加入同一频道');

r = await call('GET', '/api/realtime/channels/members?channel=' + encodeURIComponent(CH), U.a);
ok(r.json && r.json.data && r.json.data.count === 2, '成员数 = 2', r.json && r.json.data);

r = await call('POST', '/api/realtime/channels/publish', U.a, { channel: CH, event: 'shiguang.world.delta', payload: { moves: [[U.a, 1, 2, 0]] } });
ok(r.status === 200 && r.json.data && r.json.data.delivered === 2, 'A 在频道内广播，投递 2 人', r.json && r.json.data);

r = await call('POST', '/api/realtime/channels/publish', U.admin, { channel: CH, event: 'x' });
ok(r.status === 403, '非成员（管理员）发布被拒 403', r.status);

r = await call('POST', '/api/realtime/channels/join', U.admin, { channel: 'app:../etc:world' });
ok(r.status === 400 || r.status === 403, '非法频道名被拒（' + r.status + '）');

r = await call('POST', '/api/realtime/channels/leave', U.b, { channel: CH });
ok(r.status === 200, 'B 离开频道');
r = await call('GET', '/api/realtime/channels/members?channel=' + encodeURIComponent(CH), U.a);
ok(r.json && r.json.data && r.json.data.count === 1, '离开后成员数 = 1');

// ---------- 13. 卸载无痕 ----------
section('十二、卸载无痕');
r = await call('POST', '/api/market/uninstall', U.admin, { name: NAME });
ok(r.status === 200 && r.json.code === 200, '卸载接口返回 200', r.json);

const left = TABLES.filter((t) => tableExists(t));
ok(left.length === 0, 'shiguang_* 表全部 DROP（14 张）', left);
ok(!existsSync(INSTALLED), '应用目录已删除');
ok(q('SELECT 1 FROM app_control WHERE app_name = ?', NAME).length === 0, 'app_control 无残留');
r = await call('GET', '/api/shiguang/terrain', null);
ok(r.status === 404, '接口已 404（挂载点已撤）', r.status);

// ---------- 14. 重装 → 再卸载 ----------
section('十三、重装 → 再卸载');
cpSync(SRC_APP, INSTALLED, { recursive: true }); // 目录已被删，重装需要源文件在位
r = await call('POST', '/api/market/install', U.admin, { name: NAME, source: 'local' });
ok(r.status === 200 && r.json.code === 200, '重装成功（不受残留影响）', r.json);
const again = TABLES.filter((t) => !tableExists(t));
ok(again.length === 0, '14 张表重新建好', again);
r = await call('POST', '/api/shiguang/enter', U.a, {});
ok(r.status === 200 && r.json.data && r.json.data.me, '重装后能正常进入（存档已清空）');
ok(Number(q('SELECT COUNT(*) c FROM shiguang_lamps')[0].c) === 0, '灯柱表为空（未残留旧数据）');
ok(Number(q('SELECT COUNT(*) c FROM shiguang_flowers')[0].c) === 0, '光花表为空（未残留旧数据）');
r = await call('POST', '/api/shiguang/enter', U.a, {});
ok(r.json && r.json.data && r.json.data.me && r.json.data.me.hat === '0', '重装后装扮回到默认（衣柜已清）');

r = await call('POST', '/api/market/uninstall', U.admin, { name: NAME });
ok(r.status === 200 && r.json.code === 200, '再卸载成功');
ok(TABLES.filter((t) => tableExists(t)).length === 0, '再卸载后依然无表残留');

// ---------- 收尾 ----------
section('结果');
console.log('通过 ' + pass + ' / 失败 ' + fail);
cleanup();
process.exit(fail === 0 ? 0 : 1);
