-- 拾光群岛 —— 表结构（权威定义在 backend/routes.js 的 db.exec，此文件仅作查阅）
--
-- 为什么建表写在 routes.js 而不是这里：
--   市场应用的后端是「热挂载」的 router，安装流程不会执行 .sql 文件。
--   把 CREATE TABLE IF NOT EXISTS 放在模块加载时执行，才能保证
--   「装完即用、更新重装幂等、崩溃重启自愈」。
--
-- v2 迁移：shiguang_players 的新列（hat/lantern/title/planted/fished/meteors/tutorial
-- 与三个冷却时间戳）用 PRAGMA table_info 探测后逐列 ALTER TABLE 补齐 —— 更新重装
-- 保留旧数据，老玩家不掉线、不掉星屑。

-- 玩家在岛上的状态（一人一行，首次进入时创建）
CREATE TABLE IF NOT EXISTS shiguang_players (
  user_id       TEXT PRIMARY KEY,
  x             INTEGER NOT NULL DEFAULT 0,
  y             INTEGER NOT NULL DEFAULT 0,
  dir           INTEGER NOT NULL DEFAULT 0,   -- 0 下 / 1 左 / 2 右 / 3 上
  shards        INTEGER NOT NULL DEFAULT 0,   -- 当前持有星屑
  gathered      INTEGER NOT NULL DEFAULT 0,   -- 累计采集（榜单）
  built         INTEGER NOT NULL DEFAULT 0,   -- 累计点灯（榜单）
  revealed      INTEGER NOT NULL DEFAULT 0,   -- 累计揭开格数（榜单）
  joined_at     INTEGER NOT NULL DEFAULT 0,
  last_seen     INTEGER NOT NULL DEFAULT 0,   -- 心跳时间，45s 未更新视为离开
  last_move_at  INTEGER NOT NULL DEFAULT 0,   -- 服务端移动节流
  last_bottle_at INTEGER NOT NULL DEFAULT 0,  -- 漂流瓶冷却
  -- v2 追加列（ALTER TABLE 幂等补齐）
  hat           TEXT    NOT NULL DEFAULT '0',  -- 已装备帽子（商店目录 id）
  lantern       TEXT    NOT NULL DEFAULT '0',  -- 提灯配色
  title         TEXT    NOT NULL DEFAULT '',   -- 称号
  planted       INTEGER NOT NULL DEFAULT 0,    -- 累计种花
  fished        INTEGER NOT NULL DEFAULT 0,    -- 累计钓星
  meteors       INTEGER NOT NULL DEFAULT 0,    -- 经历的流星雨场次
  tutorial      INTEGER NOT NULL DEFAULT 0,    -- 新手引导已完成
  last_fish_at  INTEGER NOT NULL DEFAULT 0,    -- 钓星冷却
  last_emote_at INTEGER NOT NULL DEFAULT 0,    -- 表情冷却
  last_plant_at INTEGER NOT NULL DEFAULT 0     -- 种花冷却
);

-- 灯柱：世界共享，UNIQUE(x,y) 防重复建造
CREATE TABLE IF NOT EXISTS shiguang_lamps (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  x          INTEGER NOT NULL,
  y          INTEGER NOT NULL,
  user_id    TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_shiguang_lamp_pos ON shiguang_lamps(x, y);

-- 漂流瓶：留在世界里的一句话
CREATE TABLE IF NOT EXISTS shiguang_bottles (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  x          INTEGER NOT NULL,
  y          INTEGER NOT NULL,
  user_id    TEXT NOT NULL,
  content    TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_shiguang_bottle_pos ON shiguang_bottles(x, y);

-- 已揭开的格子：全班共享。进程内常驻内存，5 秒批量落盘。
CREATE TABLE IF NOT EXISTS shiguang_explored (
  x       INTEGER NOT NULL,
  y       INTEGER NOT NULL,
  at      INTEGER NOT NULL,
  by_user TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (x, y)
);

-- 星屑采集点的重生时间：只记录「被采过」的格子，没记录 = 可采
CREATE TABLE IF NOT EXISTS shiguang_nodes (
  x        INTEGER NOT NULL,
  y        INTEGER NOT NULL,
  ready_at INTEGER NOT NULL,
  PRIMARY KEY (x, y)
);

-- v2 —— 光花：种下的位置全班共享、永久存在；UNIQUE(x,y) 保证一格一株
CREATE TABLE IF NOT EXISTS shiguang_flowers (
  x          INTEGER NOT NULL,
  y          INTEGER NOT NULL,
  species    INTEGER NOT NULL,              -- 0 萤蓝 / 1 暖橘 / 2 月白 / 3 星紫
  user_id    TEXT NOT NULL,
  created_at INTEGER NOT NULL,              -- 客户端据此推算生长阶段
  PRIMARY KEY (x, y)
);
CREATE INDEX IF NOT EXISTS idx_shiguang_flower_user ON shiguang_flowers(user_id);

-- v2 —— 星鱼图鉴：一人一鱼一行，count 累计捕获次数
CREATE TABLE IF NOT EXISTS shiguang_catches (
  user_id  TEXT NOT NULL,
  species  TEXT NOT NULL,                   -- 鱼表 id（f_chub … f_hour）
  count    INTEGER NOT NULL DEFAULT 0,
  first_at INTEGER NOT NULL,                -- 首次捕获（图鉴展示「初见」时间）
  PRIMARY KEY (user_id, species)
);

-- v2 —— 任务：引导链（kind='intro'）与每日（kind='daily'，day 是重置周期）
CREATE TABLE IF NOT EXISTS shiguang_quests (
  user_id  TEXT NOT NULL,
  qkey     TEXT NOT NULL,                   -- 任务 key（i_walk / d_gather …）
  kind     TEXT NOT NULL,                   -- 'intro' | 'daily'
  day      TEXT NOT NULL DEFAULT '',        -- 每日任务的归属日期，换日重置
  progress INTEGER NOT NULL DEFAULT 0,
  done     INTEGER NOT NULL DEFAULT 0,
  claimed  INTEGER NOT NULL DEFAULT 0,      -- 领过奖才算真正完成引导链的一步
  PRIMARY KEY (user_id, qkey)
);

-- v2 —— 成就：解锁时间戳；未解锁的行不存在
CREATE TABLE IF NOT EXISTS shiguang_achievements (
  user_id TEXT NOT NULL,
  akey    TEXT NOT NULL,
  at      INTEGER NOT NULL,
  PRIMARY KEY (user_id, akey)
);

-- v2 —— 衣柜：已购买的装扮（购买时间即行的时间戳）
CREATE TABLE IF NOT EXISTS shiguang_wardrobe (
  user_id TEXT NOT NULL,
  kind    TEXT NOT NULL,                    -- 'hat' | 'lantern' | 'title'
  item    TEXT NOT NULL,                    -- 商店目录 id
  at      INTEGER NOT NULL,
  PRIMARY KEY (user_id, kind, item)
);

-- v3 —— 石碑：全班共建的唤醒记录（谁先碰到算谁的，UNIQUE 天然防重复）
CREATE TABLE IF NOT EXISTS shiguang_steles (
  x       INTEGER NOT NULL,
  y       INTEGER NOT NULL,
  user_id TEXT NOT NULL,
  at      INTEGER NOT NULL,
  PRIMARY KEY (x, y)
);

-- v3 世界扩容：SIZE 80 → 160（cells/nodes 位图 6400 → 25600 字符），
-- 八岛生态（biome 决定客户端调色），码头 5 → 8 条，新增石板路（TILE '5'）。
-- NPC 行者是纯内存状态（游荡 + 台词），不落库；灯柱查询 LEFT JOIN 出建造者灯色。
