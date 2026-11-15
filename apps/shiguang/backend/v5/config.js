// 拾光群岛 v5「长夜」—— 数值配置（集中在这里调平衡）
'use strict';

module.exports = {
  WORLD_SIZE: 256,          // 地图边长（格），一格 16px
  TICK_MS: 100,             // 世界模拟 10Hz
  ONLINE_TTL_MS: 20000,     // 超过这么久没同步视为离线
  VIEW_RADIUS: 26,          // 同步时下发玩家周围多少格内的实体
  ACTIVE_RADIUS: 34,        // 玩家周围多少格内的怪物会被唤醒
  SYNC_MIN_GAP_MS: 60,      // 同一玩家两次同步的最小间隔
  MAX_SPEED: 9.5,           // 位置上报校验：格/秒（含翻滚与冲刺余量）

  // 昼夜：一天 12 分钟，全班共享同一个时钟（由 Date.now 推算，不落库）
  DAY_MS: 12 * 60 * 1000,
  DUSK_AT: 0.62,            // 0~0.62 白天，0.62~0.70 黄昏，0.70~0.95 夜晚，0.95~1 黎明
  NIGHT_AT: 0.70,
  DAWN_AT: 0.95,

  // 玩家成长
  MAX_LEVEL: 30,
  BASE_HP: 60,
  HP_PER_LEVEL: 12,
  BASE_ATK: 8,
  ATK_PER_LEVEL: 2.2,
  BASE_MP: 40,              // 灯火（技能资源）
  MP_PER_LEVEL: 2,
  TALENT_EVERY: 3,          // 每 3 级一个天赋点

  // 战斗校验
  HIT_REACH: 3.2,           // 近战命中上报允许的最大距离（格，含插值误差）
  RANGED_REACH: 11,         // 远程武器命中上报允许的最大距离
  HIT_MIN_GAP_MS: 70,       // 同一玩家两次命中上报的最小间隔
  DMG_TOLERANCE: 1.35,      // 上报伤害允许超出理论最大值的比例（随机浮动余量）

  // 死亡与复活
  DOWN_MS: 9000,            // 倒地后等待队友扶起的时间
  REVIVE_MS: 2200,          // 扶起需要的持续时间
  RESPAWN_HP_RATIO: 0.6,

  // 掉落
  LOOT_SHARE_RADIUS: 18,    // 击杀时多少格内参与过伤害的玩家都分到奖励
  EQUIP_DROP_BASE: 0.07,    // 普通怪掉装备的基础概率
  ELITE_CHANCE: 0.06,       // 刷新时成为精英的概率
  NIGHT_LOOT_MUL: 1.5,

  // 刷怪
  SPAWN_CHECK_MS: 1500,
  RESPAWN_MS: 25000,        // 刷怪点被清空后多久重生
  LEASH_RADIUS: 14,         // 怪物追出刷怪点多远就回去

  // 组队
  PARTY_MAX: 4,
  PARTY_XP_BONUS: 0.15,     // 每多一名队友 +15% 经验

  // 长夜潮汐（世界事件）
  TIDE_GAP_MIN_MS: 30 * 60 * 1000,
  TIDE_GAP_MAX_MS: 45 * 60 * 1000,
  TIDE_DURATION_MS: 3 * 60 * 1000
};
