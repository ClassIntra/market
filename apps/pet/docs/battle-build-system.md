# Battle Build System v2.0 - 桌宠大乱斗战斗系统

## 概述

将传统被动对战改造为**主动 Build 构建系统**，类似宝可梦 + Roguelike 的结合：
- **技能池随机化**：每次升级/进化时重新洗牌
- **装备系统**：3 个装备槽提供被动效果
- **Build 分享**：8 位字符代码共享配置
- **环境副本**：每周刷新不同的战斗环境

## 核心组件

### 1. 技能系统扩展 (从 5 个→18+ 个)

#### 现有技能（保留）：
```javascript
SKILLS = {
  heavy:     { id: 'heavy',     name: '千钧一击', icon: '💥', tier: 0, 
              desc: '每 3 回合打出 1.6 倍伤害' },
  lifesteal: { id: 'lifesteal', name: '鲸吞',       icon: '💫', tier: 0, 
              desc: '造成伤害的 12% 回血' },
  shield:    { id: 'shield',    name: '泡泡护盾',   icon: '🔵', tier: 1, 
              desc: '血量快见底时挡下一半伤害（一次）' },
  combo:     { id: 'combo',     name: '连打',       icon: '⚡', tier: 1, 
              desc: '25% 概率追加半次攻击' },
  pierce:    { id: 'pierce',    name: '破甲',       icon: '🔨', tier: 1, 
              desc: '无视对手 30% 防御，至少多打 1 点' }
}
```

#### 新增主动技能（v2.0）：
```javascript
// 物理系
skill_blast:      { name: '爆发冲击', type: 'active', cooldown: 2, 
                   effect: '单回合造成 200% 伤害，下回合无法行动' },
skill_smash:      { name: '重锤砸击', type: 'active', cooldown: 3, 
                   effect: '本回合伤害翻倍，但自身掉 15% 血' },

// 辅助系
skill_berserk:    { name: '狂怒', type: 'buff', duration: 3, 
                   effect: '攻击 +50%，防御 -30%，持续 3 回合' },
skill_guard:      { name: '钢铁壁垒', type: 'buff', duration: 3, 
                   effect: '防御 +40%，速度 -20%，持续 3 回合' },
skill_heal:       { name: '紧急治疗', type: 'heal', cooldown: 4, 
                   effect: '立即恢复 30% 最大 HP' },

// 特殊系
skill_counter:    { name: '反击领域', type: 'passive', 
                   effect: '受到攻击时有 40% 概率自动反击' },
skill_aura:       { name: '斗志光环', type: 'passive', 
                   effect: '每场战斗首回合攻击力 +25%' },
skill_evade:      { name: '闪避精通', type: 'passive', 
                   effect: '闪避率 +15%，连续触发时提升至 25%' },
```

#### 被动技能（v2.0）：
```javascript
passive_toughness:{ name: '坚韧', stat: 'hp', bonus: '+15%', rarity: 'common' },
passive_strength: { name: '力量', stat: 'atk', bonus: '+12%', rarity: 'common' },
passive_finesse:  { name: '敏捷', stat: 'spd', bonus: '+10%', rarity: 'uncommon' },
passive_sharp:    { name: '精准', stat: 'crit_dmg', bonus: '+20%', rarity: 'rare' },
```

### 2. 装备系统

#### 装备槽位：
```javascript
EQUIP_SLOTS = ['weapon', 'accessory', 'consumable']; // 武器/饰品/消耗品
```

#### 武器类（Weapon）：
```javascript
WEAPONS = {
  blunt_sword: {
    id: 'blunt_sword',
    name: '钝剑',
    icon: '⚔️',
    type: 'weapon',
    effect: '攻击后回复 5% 最大 HP',
    rarity: 'common'
  },
  electric_lance: {
    id: 'electric_lance',
    name: '电矛',
    icon: '🔱',
    type: 'weapon',
    effect: '有 30% 概率使目标麻痹（下回合速度 -50%)',
    rarity: 'uncommon'
  },
  void_blade: {
    id: 'void_blade',
    name: '虚空之刃',
    icon: '🗡️',
    type: 'weapon',
    effect: '无视对手 20% 防御',
    rarity: 'rare'
  }
}
```

#### 饰品类（Accessory）：
```javascript
ACCESSORIES = {
  crystal_amulet: {
    id: 'crystal_amulet',
    name: '水晶护符',
    icon: '💎',
    type: 'accessory',
    effect: '防御 +15%',
    rarity: 'common'
  },
  lightning_stone: {
    id: 'lightning_stone',
    name: '闪电石',
    icon: '⚡',
    type: 'accessory',
    effect: '速度 +20%，暴击率 +10%',
    rarity: 'rare'
  },
  life_orb: {
    id: 'life_orb',
    name: '生命宝珠',
    icon: '🔮',
    type: 'accessory',
    effect: '所有治疗效果 +25%',
    rarity: 'epic'
  }
}
```

#### 消耗品类（Consumable）：
```javascript
CONSUMABLES = {
  flame_potion: {
    id: 'flame_potion',
    name: '火焰药水',
    icon: '🧪',
    type: 'consumable',
    effect: '首回合伤害翻倍（仅使用一次）',
    stack: 3,
    rarity: 'uncommon'
  },
  restore_vial: {
    id: 'restore_vial',
    name: '恢复药剂',
    icon: '💊',
    type: 'consumable',
    effect: '战斗开始时立即恢复 40% HP',
    stack: 2,
    rarity: 'common'
  }
}
```

### 3. Build 分享系统

#### 编码格式：
```javascript
// 8 位字符：SSSS-WWWW
// SSSS: 技能 ID 组合（4 位数字索引）
// WWWW: 装备 ID 组合（4 位十六进制）

// 示例："G4K9-M2P7" → "skill_1,skill_3,skill_5|weapon_crystal,acc_lightning,cons_flame"
```

#### 解码逻辑：
```javascript
function decodeBuildCode(code) {
  const [skillsPart, itemsPart] = code.split('-');
  const skillIds = decodeBase36(skillsPart); // 解码为技能数组
  const itemIds = decodeHex(itemsPart);      // 解码为装备对象
  return { skills: skillIds, equipment: itemIds };
}
```

### 4. 环境副本系统

#### 每周刷新规则：
```javascript
ENVIRONMENTS = {
  wind_valley: {
    id: 'wind_valley',
    name: '风之峡谷',
    week: 1,
    effects: {
      speed_skill_power: 1.5,   // 速度系技能威力 +50%
      evasion_rate: 1.2         // 闪避率 +20%
    },
    boss: '风元素精灵',
    reward: '闪电石×1'
  },
  magma_cave: {
    id: 'magma_cave',
    name: '岩浆洞窟',
    week: 2,
    effects: {
      fire_skill_power: 1.8,    // 火系技能冷却减半
      damage_over_time: true    // 每回合受 5% 伤害
    },
    boss: '熔岩巨兽',
    reward: '虚空之刃×1'
  },
  moon_altar: {
    id: 'moon_altar',
    name: '月光祭坛',
    week: 3,
    effects: {
      night_crit_multiplier: 1.5, // 夜间战斗暴击 +50%
      healing_bonus: 1.3          // 治疗效果 +30%
    },
    boss: '月影猎手',
    reward: '生命宝珠×1'
  }
};
```

### 5. 数据模型变更

#### User State 新增字段：
```javascript
state.battle_build = {
  skills: ['heavy', 'combo'],           // 已选择的技能 ID 数组（最多 5 个）
  equipment: {
    weapon: 'blunt_sword',
    accessory: 'crystal_amulet',
    consumable: 'flame_potion'
  },
  strategy_name: '攻防一体'             // Build 名称（用户自定义）
};

state.skill_pool = {
  available: ['heavy', 'lifesteal', 'blast', ...],  // 当前可选择的技能池
  max_slots: 3                                       // 最大技能槽位数
};

state.equipment_inventory = {
  owned: ['blunt_sword', 'electric_lance', ...],    // 已拥有的装备 ID 列表
  equipped: { ... }                                  // 当前佩戴状态
};

state.environment_progress = {
  current_week: 2,
  unlocked_environments: ['wind_valley'],           // 已解锁的环境
  best_score: 1250                                   // 最高战力评分
};
```

### 6. API 端点设计

#### GET /api/pet/battle/build —— 获取当前 Build 配置
```javascript
// Response:
{
  code: 200,
  data: {
    build: {
      skills: ['heavy', 'combo'],
      equipment: { weapon: '...', accessory: '...', consumable: '...' },
      strategy_name: 'xxx'
    },
    skill_pool: [...],
    equipped_skills_effect: { atk: '+20%', def: '+15%', ... }
  }
}
```

#### POST /api/pet/battle/build/update —— 更新 Build 配置
```javascript
// Request:
{
  skills: ['heavy', 'blast'],
  equipment: { weapon: 'electric_lance', accessory: '...', consumable: null },
  strategy_name: '新 Build 名称'
}

// Response:
{
  code: 200,
  data: {
    build: { ... },
    power_score: 1250,        // 计算后的战力评分
    effectiveness: '高'       // 对当前环境的适配度评级
  }
}
```

#### POST /api/pet/battle/build/share —— 生成分享码
```javascript
// Request:
{ build_id: 'xxx' }

// Response:
{
  code: 200,
  data: {
    share_code: 'G4K9-M2P7',
    expires_at: '2026-11-06T00:00:00Z'  // 7 天有效期
  }
}
```

#### POST /api/pet/battle/build/import —— 导入他人 Build
```javascript
// Request:
{ share_code: 'G4K9-M2P7' }

// Response:
{
  code: 200,
  data: {
    build: { /* 对方 Build 配置 */ },
    import_success: true
  }
}
```

#### GET /api/pet/battle/environment —— 获取当前环境信息
```javascript
// Response:
{
  code: 200,
  data: {
    current: {
      id: 'magma_cave',
      name: '岩浆洞窟',
      week: 2,
      active_effects: { /* 生效的环境加成 */ },
      boss: '熔岩巨兽',
      unlock_requirement: '击败风之峡谷 Boss'
    },
    next: {
      id: 'moon_altar',
      name: '月光祭坛',
      preview: '下周开放'
    }
  }
}
```

### 7. 前端 UI 组件

#### BattleTab 新增入口：
```javascript
renderBattleTab() {
  return h('div', 'ci-battle-tab', [
    h('h2', '⚔️ 对战'),
    
    // Build 配置按钮组
    h('div', 'battle-actions', [
      h('button', '配置 Build', onClick: openBuildEditor),
      h('button', '挑战影子对手', onClick: startShadowBattle),
      h('button', '排名赛', onClick: startRankedBattle),
    ]),
    
    // 当前 Build 展示
    h('div', 'current-build-preview', [
      h('span', '策略名称'),
      h('div', 'skills-display', [...]),
      h('div', 'equipment-display', {...})
    ]),
    
    // 环境信息显示
    h('div', 'environment-badge', '当前环境：岩浆洞窟 🔥')
  ]);
}
```

#### Build Editor 弹窗：
```javascript
openBuildEditor() {
  return h('dialog', 'build-editor-dialog', [
    h('h3', 'Build 配置器'),
    
    // 技能选择区
    h('div', 'skill-selection', [
      h('h4', '技能槽位 × 5'),
      h('select.multi', [], skill_options)
    ]),
    
    // 装备穿戴区
    h('div', 'equipment-wear', [
      h('h4', '装备槽位'),
      h('div.weapon-slot', renderEquipSlot('weapon')),
      h('div.accessory-slot', renderEquipSlot('accessory')),
      h('div.consumable-slot', renderEquipSlot('consumable'))
    ]),
    
    // 实时预览
    h('div', 'stats-preview', [
      h('span', '总战力：', value: calculated_power),
      h('span', '适应度：', value: '★★★★☆')
    ]),
    
    // 操作按钮
    h('div', 'editor-actions', [
      h('button', '保存 Build'),
      h('button', '生成分享码'),
      h('button', '关闭')
    ])
  ]);
}
```

### 8. 数值平衡原则

#### 技能强度分级：
```javascript
tier_common:    { cost: 0,     slot_weight: 1.0, unlock: 'bond 0' },
tier_uncommon:  { cost: 10,    slot_weight: 1.2, unlock: 'bond 20' },
tier_rare:      { cost: 20,    slot_weight: 1.5, unlock: 'bond 60' },
tier_epic:      { cost: 35,    slot_weight: 2.0, unlock: 'bond 120' },
```

#### 装备掉落概率：
```javascript
DROP_RATES = {
  common: 0.5,      // 普通装备
  uncommon: 0.3,    // 稀有装备
  rare: 0.15,       // 史诗装备
  epic: 0.05        // 传说装备
};
```

### 9. 迁移计划

#### 向后兼容：
```javascript
function migrateOldState(state) {
  if (!state.battle_skills && state.battle_tactic) {
    // 旧版战术 → 默认推荐 Build
    state.battle_build = getDefaultBuildFromTactic(state.battle_tactic);
  }
  
  if (!state.skill_pool) {
    // 初始化为当前解锁的技能池
    state.skill_pool = {
      available: getUnlockedSkills(state),
      max_slots: getSkillSlots(state)
    };
  }
  
  return state;
}
```

## 实施步骤

### Phase 1: 技能系统扩展 (Week 1-2)
1. 定义 18+ 新技能的完整数据表
2. 实现技能池随机化算法
3. 更新战斗引擎以支持新技能机制
4. 测试技能互斥逻辑

### Phase 2: 装备系统开发 (Week 3)
1. 定义装备数据库（30+ 种装备）
2. 实现装备效果计算引擎
3. 添加装备库存管理
4. 前端 UI 开发（穿戴界面）

### Phase 3: 分享码系统 (Week 4)
1. 实现编解码算法
2. 后端验证接口
3. 防作弊校验
4. 过期机制

### Phase 4: 环境副本框架 (Week 5)
1. 环境配置数据结构
2. 周刷新逻辑
3. 环境效果应用引擎
4. Boss 战特殊规则

### Phase 5: 整合测试 & 上线 (Week 6)
1. 端到端流程测试
2. 数值平衡调优
3. Bug 修复
4. 版本发布

## 注意事项

⚠️ **反作弊要点**：
- 所有技能计算必须在服务端完成
- 分享码需要签名验证（JWT 或 HMAC）
- 禁止客户端传递战力值（只传 Build 配置）

⚠️ **性能考虑**：
- 技能池缓存：避免每次请求都重新计算
- 装备效果预计算：Save 时预先算好数值
- 环境切换增量更新：只改差异部分

⚠️ **用户体验优化**：
- Build 编辑器要有实时预览
- 技能说明要清晰易懂（hover 提示）
- 分享码生成一键复制
- 提供"推荐 Build"快速模板

---

**版本**: v2.0  
**最后更新**: 2026-10-30  
**维护者**: Nevino

## v2.0 实现差异说明（2026-10-31 落地版）

规格与实现不一致处，以实现为准（后端 routes.js 对应位置均有注释）：

1. **技能槽位阶梯 = 2/3/4/5**（幼生体/成长期/完全体/传说体）。doc 内部三处说法冲突
   （`max_slots: 3` / UI 草图「×5」/「传说体开第 4-5 槽」），用户拍板平滑阶梯。
2. **技能池「洗牌」= 展示顺序重排**（seed = fnv1a('pool|' + bond + id)），不随机剥夺
   已解锁技能的访问权——剥夺与「羁绊是确定性成长」的产品基调冲突。
3. **岩浆洞窟**：doc 自相矛盾（`fire_skill_power: 1.8` vs 注释「冷却减半」）→
   实现为火属性伤害 ×1.5 + 主动技能冷却 -1 + 双方每回合 5% max HP 灼烧（1.8 实测碾压）。
4. **电矛麻痹**：字面「下回合速度 -50%」在先手序固定的引擎里无意义（速度只决定先手，
   固定序是可复现性的底线）→ 实现为 30% 附着麻痹、附着后目标下回合 50% 概率无法行动。
5. **分享码格式 `SSSSSEE-K`**（9 字符）：5 技能槽需要 5 字符；3 装备槽混合进制压成
   2 字符（180 组合 < 36²）；末位校验 = fnv1a(CI_JWT_SECRET | 周桶 | 载荷) % 36，
   接受当前/上一周桶 → 有效期约 7-14 天。doc 的 SSSS-WWWW(8) 是示意格式。
   校验位防手滑/过期，真正的防线是导入时的解锁/拥有校验。
6. **消耗品按库存次数消耗**（doc stack 语义）：每场战斗消耗 1，掉落补给；
   影子对手的消耗品生效但不扣他的库存（快照语义，不替对方做决定）。
7. **恢复药剂**：「战斗开始时回 40% HP」在满血开局引擎里永远浪费 →
   改为第 1 回合结束时恢复 40%（等价于多扛一轮的定位）。
8. **装备 14 件**（doc 列 9 件）：补齐使 DROP_RATES 四档每档非空；
   「30+ 种」留后续版本。
9. **新增第 18 个技能 `regen 活力`**（每回合回 2% max HP），补齐「18 个」口径。
10. **build.power_score = 装备+技能生效后的真实战力**（doc 的「技能数×50」计分弃用）：
    分数必须和打出来的强度是同一个数。
11. **tier 成本经济（cost/slot_weight）暂不实现**：解锁门槛直接用 tier ≤ tierOf(bond)，
    与羁绊档位 0/20/60/120 自然对齐。
12. **环境 Boss**：每日 1 次挑战；本周首杀必掉环境奖励装备，之后每胜 50% 再 roll
    DROP_RATES；重复装备分解 +3 小鱼干；胜 +8 / 负 +2 练习赛积分。
    Boss 配置：scale 1.10 + 三技能包（identity + lifesteal），满配传说体胜率 ~70%，
    中坚 ~38%（扫描矩阵见 selftest [10]）。
13. **顺带修复**：`/battle/fight` 的 underdog 成就条件引用了不存在的 `baseMine.power`，
    此成就从未触发过；改为现算。技能注册表（SKILLS/SKILL_IDS）在上一轮重构中被删，
    五个战斗端点此前全部 500，本版本重建。

自测：`node scripts/_pet-build-selftest.mjs`（39 项，含与 v0.7 引擎的基线逐位对比）。
