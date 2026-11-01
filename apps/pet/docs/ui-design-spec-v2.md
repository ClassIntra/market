# Pet App v2.0 - UI/UX 设计规范

## 1. 设计目标

将当前简陋的字符画界面升级为**游戏级精致 UI**，保持可爱治愈风格的同时，增加：
- ✨ **视觉吸引力**：让用户一打开就产生"哇"的感觉
- 🎮 **清晰度**：技能、装备信息一目了然
- 💕 **情感连接**：通过动效和配色增强宠物的"生命力"
- 📱 **一致性**：所有页面遵循统一的设计语言

---

## 2. 视觉风格定位

### 2.1 核心风格关键词

```
🐾 可爱治愈 × ⚔️ 游戏化 × 🎨 现代简约 × ✨ 微动效
```

### 2.2 色彩系统

#### 主色调（Brand Colors）
```css
--primary-purple: #9B52DE      /* 桌宠标志性紫色 */
--secondary-blue: #64D2FF      /* 清新蓝色 */
--accent-pink: #FF7B92         /* 活力粉色 */
--highlight-yellow: #FFD60A    /* 重要提示高亮 */
```

#### 背景渐变（Gradient Backgrounds）
```css
/* 主界面背景 */
bg-gradient-main: linear-gradient(
  135deg, 
  rgba(255, 250, 240, 0.95), 
  rgba(235, 228, 255, 0.9)
);

/* 战斗界面深色主题 */
bg-gradient-battle: linear-gradient(
  180deg, 
  rgba(40, 30, 60, 0.9), 
  rgba(60, 40, 80, 0.9)
);
```

#### 状态色（Status Colors）
```css
color-hp-high: #34C759;        /* 血量高 */
color-hp-mid: #FFD60A;         /* 血量中 */
color-hp-low: #FF3B30;         /* 血量低 */

color-skill-common: #8E8E93;   /* 普通技能 */
color-skill-uncommon: #34C759; /* 稀有技能 */
color-skill-rare: #0A84FF;     /* 史诗技能 */
color-skill-epic: #BF5AF2;     /* 传说技能 */
```

### 2.3 字体系统

```css
font-family-base: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;

font-size-title: 24px;          /* 大标题 */
font-size-heading: 18px;        /* 小标题 */
font-size-body: 14px;           /* 正文 */
font-size-caption: 12px;        /* 说明文字 */
```

### 2.4 圆角与阴影

```css
radius-card: 16px;              /* 卡片圆角 */
radius-button: 8px;             /* 按钮圆角 */
radius-badge: 12px;             /* 徽章圆角 */

shadow-card: 0 6px 20px rgba(155, 82, 222, 0.15),
             0 2px 6px rgba(155, 82, 222, 0.1);

shadow-elevated: 0 12px 32px rgba(155, 82, 222, 0.25),
                 0 4px 12px rgba(155, 82, 222, 0.15);
```

---

## 3. 核心组件设计

### 3.1 宠物展示区（Stage Area）

#### 视觉效果优化建议
参考来源：
- 虚拟宠物 app 设计：http://gips1.baidu.com/it/u=2491041476,256510097&fm=3074
- 宠物 UI 灵感：http://safe-img.xhscdn.com/bw1/a0a2ec42-0b5e-4225-92b6-397dd3102dc0

```css
.stage-container {
  position: relative;
  height: 400px;
  background: url('/assets/stage-bg.png'); /* 场景背景图 */
  background-size: cover;
  border-radius: var(--radius-card);
  overflow: hidden;
}

/* 地面层次 */
.stage-ground {
  position: absolute;
  bottom: 0;
  width: 100%;
  height: 80px;
  background: linear-gradient(
    to top,
    rgba(90, 200, 250, 0.3),
    transparent
  );
}

/* 宠物主体渲染层 */
.pet-renderer {
  position: absolute;
  bottom: 60px;
  left: 50%;
  transform: translateX(-50%);
  
  /* 呼吸动画 */
  animation: breathe 3s ease-in-out infinite;
}

@keyframes breathe {
  0%, 100% { transform: translateX(-50%) scale(1); }
  50% { transform: translateX(-50%) scale(1.02); }
}

/* 状态指示器（头顶气泡） */
.status-indicator {
  position: absolute;
  top: -40px;
  left: 50%;
  transform: translateX(-50%);
  padding: 6px 12px;
  background: rgba(255, 255, 255, 0.9);
  border-radius: 20px;
  font-size: 12px;
  box-shadow: var(--shadow-card);
}

/* 对话气泡 */
.chat-bubble {
  position: absolute;
  top: -60px;
  right: -30px;
  background: white;
  padding: 10px 14px;
  border-radius: 16px;
  border-top-right-radius: 4px;
  font-size: 13px;
  max-width: 150px;
  animation: bubble-pop 0.3s ease-out;
}

@keyframes bubble-pop {
  0% { opacity: 0; transform: scale(0.5); }
  50% { transform: scale(1.05); }
  100% { opacity: 1; transform: scale(1); }
}
```

#### 互动反馈效果
```css
/* 点击时的弹跳动画 */
.pet-sparkle-on-click {
  animation: click-bounce 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275);
}

@keyframes click-bounce {
  0% { transform: scale(1); }
  30% { transform: scale(1.3) translateY(-20px); }
  60% { transform: scale(1.1) translateY(-10px); }
  100% { transform: scale(1); }
}

/* 获得奖励时的粒子特效 */
.reward-particle {
  position: absolute;
  pointer-events: none;
  animation: float-up 1.2s ease-out forwards;
}

@keyframes float-up {
  0% { 
    opacity: 1;
    transform: translateY(0) rotate(0deg);
  }
  100% { 
    opacity: 0;
    transform: translateY(-80px) rotate(180deg);
  }
}
```

---

### 3.2 HUD 信息栏（顶部）

```css
.hud-bar {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 12px 20px;
  background: rgba(255, 255, 255, 0.95);
  backdrop-filter: blur(10px);
  border-radius: 12px;
  box-shadow: var(--shadow-card);
}

/* 宠物头像框 */
.avatar-frame {
  width: 48px;
  height: 48px;
  border-radius: 50%;
  border: 3px solid var(--primary-purple);
  overflow: hidden;
  position: relative;
}

.avatar-frame::after {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(135deg, 
    rgba(155, 82, 222, 0.2), 
    rgba(100, 210, 255, 0.2));
}

/* 进度条样式 */
.hp-bar-container {
  width: 120px;
  height: 8px;
  background: rgba(142, 142, 147, 0.2);
  border-radius: 4px;
  overflow: hidden;
  position: relative;
}

.hp-bar-fill {
  height: 100%;
  background: linear-gradient(90deg,
    var(--hp-high) 0%,
    var(--hp-mid) 50%,
    var(--hp-low) 100%
  );
  border-radius: 4px;
  transition: width 0.3s ease-out;
}

/* 数值标签 */
.stat-value {
  font-weight: 600;
  color: #2C3E50;
  font-size: 14px;
}

.stat-label {
  font-size: 11px;
  color: #8E8E93;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}
```

---

### 3.3 底部导航（TabBar）

```css
.tab-bar {
  position: sticky;
  bottom: 16px;
  left: 16px;
  right: 16px;
  display: flex;
  justify-content: space-around;
  padding: 12px 8px;
  background: rgba(255, 255, 255, 0.95);
  backdrop-filter: blur(20px);
  border-radius: 24px;
  box-shadow: var(--shadow-elevated);
}

.tab-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 8px 16px;
  cursor: pointer;
  transition: all 0.2s ease;
}

.tab-icon {
  font-size: 28px;
  filter: grayscale(0.5);
  opacity: 0.6;
  transition: all 0.2s ease;
}

.tab-item.active .tab-icon {
  filter: grayscale(0);
  opacity: 1;
  transform: scale(1.2);
}

.tab-label {
  font-size: 11px;
  color: #8E8E93;
  font-weight: 500;
}

.tab-item.active .tab-label {
  color: var(--primary-purple);
  font-weight: 600;
}

/* 未读红点 */
.badge-dot {
  position: absolute;
  top: 4px;
  right: 8px;
  width: 8px;
  height: 8px;
  background: var(--color-error);
  border-radius: 50%;
  animation: badge-pulse 1.5s ease-in-out infinite;
}

@keyframes badge-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}
```

---

### 3.4 Build 编辑器（弹窗组件）

```css
.build-editor-dialog {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  backdrop-filter: blur(8px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  animation: dialog-fade-in 0.2s ease-out;
}

@keyframes dialog-fade-in {
  0% { opacity: 0; }
  100% { opacity: 1; }
}

.build-editor-container {
  width: 90%;
  max-width: 600px;
  max-height: 85vh;
  background: white;
  border-radius: 24px;
  box-shadow: var(--shadow-elevated);
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.editor-header {
  padding: 20px 24px;
  border-bottom: 1px solid rgba(0, 0, 0, 0.06);
  display: flex;
  justify-content: space-between;
  align-items: center;
  background: linear-gradient(to right, 
    rgba(155, 82, 222, 0.08), 
    rgba(100, 210, 255, 0.08));
}

.editor-title {
  font-size: 20px;
  font-weight: 600;
  color: #2C3E50;
}

/* 技能选择区 */
.skill-selection-area {
  padding: 24px;
}

.skill-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  gap: 12px;
  margin-top: 16px;
}

.skill-card {
  position: relative;
  padding: 16px;
  background: rgba(142, 142, 147, 0.05);
  border: 2px solid transparent;
  border-radius: 12px;
  cursor: pointer;
  transition: all 0.2s ease;
}

.skill-card:hover {
  border-color: var(--secondary-blue);
  background: rgba(100, 210, 255, 0.1);
  transform: translateY(-2px);
}

.skill-card.selected {
  border-color: var(--primary-purple);
  background: linear-gradient(135deg,
    rgba(155, 82, 222, 0.15),
    rgba(100, 210, 255, 0.1)
  );
}

.skill-card.rare {
  border-color: var(--skill-rare);
}

.skill-card.epic {
  border: 2px solid var(--skill-epic);
  box-shadow: 0 4px 12px rgba(191, 90, 242, 0.2);
}

.skill-icon {
  font-size: 28px;
  margin-bottom: 8px;
}

.skill-name {
  font-size: 13px;
  font-weight: 600;
  color: #2C3E50;
  margin-bottom: 4px;
}

.skill-desc {
  font-size: 11px;
  color: #8E8E93;
  line-height: 1.3;
}

/* 装备穿戴区 */
.equipment-wear-zone {
  display: flex;
  gap: 16px;
  padding: 20px 24px;
  background: rgba(0, 0, 0, 0.02);
  border-radius: 12px;
}

.equip-slot {
  flex: 1;
  min-width: 100px;
  aspect-ratio: 1;
  background: white;
  border: 2px dashed rgba(142, 142, 147, 0.3);
  border-radius: 12px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.2s ease;
}

.equip-slot:hover {
  border-color: var(--primary-purple);
  background: rgba(155, 82, 222, 0.05);
}

.equip-slot.filled {
  border-style: solid;
  border-color: var(--primary-purple);
  background: rgba(155, 82, 222, 0.08);
}

.equip-icon {
  font-size: 32px;
  margin-bottom: 8px;
}

.equip-name {
  font-size: 11px;
  text-align: center;
  color: #2C3E50;
}

/* 实时预览面板 */
.stats-preview-panel {
  margin: 0 24px 24px;
  padding: 16px;
  background: linear-gradient(135deg,
    rgba(100, 210, 255, 0.1),
    rgba(155, 82, 222, 0.1)
  );
  border-radius: 12px;
}

.power-score {
  text-align: center;
  margin-bottom: 12px;
}

.score-label {
  font-size: 12px;
  color: #8E8E93;
  text-transform: uppercase;
  letter-spacing: 1px;
}

.score-value {
  font-size: 36px;
  font-weight: 700;
  background: linear-gradient(135deg,
    var(--primary-purple),
    var(--secondary-blue)
  );
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

.effect-list {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 8px;
}

.effect-item {
  padding: 8px 12px;
  background: white;
  border-radius: 8px;
  font-size: 13px;
  display: flex;
  align-items: center;
  gap: 8px;
}

.effect-plus {
  color: var(--color-hp-high);
  font-weight: 600;
}

.effect-minus {
  color: var(--color-hp-low);
  font-weight: 600;
}
```

---

### 3.5 战斗界面

参考来源：
- 宝可梦对战界面：http://i1.hdslb.com/bfs/archive/b3e3c7ead9492d8f20148f7babce5f067bf390bf.jpg@1200w_630h
- 游戏图标设计：http://gips3.baidu.com/it/u=2658262874,1635074868&fm=3074

```css
.battle-stage {
  height: 500px;
  position: relative;
  background: linear-gradient(180deg,
    rgba(40, 30, 60, 0.8),
    rgba(60, 40, 80, 0.8)
  );
  border-radius: 16px;
  overflow: hidden;
}

/* 战场环境效果 */
.environment-effect {
  position: absolute;
  inset: 0;
  opacity: 0.3;
  pointer-events: none;
}

.environment-effect.fire::before {
  content: '';
  position: absolute;
  inset: 0;
  background: radial-gradient(circle at 50% 80%,
    rgba(255, 107, 74, 0.3),
    transparent
  );
}

/* 双方角色位置 */
.battle-character {
  position: absolute;
  bottom: 100px;
  transition: all 0.3s ease;
}

.battle-character.player {
  left: 10%;
  transform: scaleX(1);
}

.battle-character.enemy {
  right: 10%;
  transform: scaleX(-1);
}

/* 伤害飘字 */
.damage-floating-text {
  position: absolute;
  font-size: 28px;
  font-weight: 700;
  pointer-events: none;
  animation: float-damage 1.2s ease-out forwards;
  z-index: 100;
}

.damage-floating-text.crit {
  font-size: 36px;
  color: var(--skill-epic);
  animation: float-crit 1.5s ease-out forwards;
}

@keyframes float-damage {
  0% {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
  50% {
    transform: translateY(-30px) scale(1.2);
  }
  100% {
    opacity: 0;
    transform: translateY(-60px) scale(1);
  }
}

@keyframes float-crit {
  0% {
    opacity: 0;
    transform: scale(0.5) rotate(-10deg);
  }
  20% {
    opacity: 1;
    transform: scale(1.5) rotate(10deg);
  }
  80% {
    opacity: 1;
    transform: scale(1.2) rotate(-5deg);
  }
  100% {
    opacity: 0;
    transform: translateY(-80px) scale(1);
  }
}

/* 技能释放特效 */
.skill-visual-effect {
  position: absolute;
  inset: 0;
  pointer-events: none;
}

.skill-visual-effect.shockwave {
  animation: shockwave-expand 0.6s ease-out;
}

@keyframes shockwave-expand {
  0% {
    transform: scale(0);
    opacity: 0.8;
  }
  100% {
    transform: scale(2);
    opacity: 0;
  }
}
```

---

### 3.6 资源卡片（小鱼干/羁绊）

```css
.resource-pill {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  background: rgba(255, 255, 255, 0.9);
  border-radius: 20px;
  font-size: 13px;
  font-weight: 600;
  box-shadow: var(--shadow-card);
}

.resource-coins {
  background: linear-gradient(135deg,
    rgba(255, 214, 10, 0.2),
    rgba(255, 155, 187, 0.2)
  );
}

.resource-bond {
  background: linear-gradient(135deg,
    rgba(155, 82, 222, 0.2),
    rgba(100, 210, 255, 0.2)
  );
}

.icon-badge {
  font-size: 16px;
}
```

---

## 4. 配色方案参考

根据搜索到的设计灵感和行业标准，推荐以下配色组合：

### 主配色方案（可爱治愈风）
```css
--brand-primary: #9B52DE      /* 紫色主调 */
--brand-secondary: #64D2FF    /* 天蓝辅助 */
--brand-accent: #FF7B92       /* 粉色点缀 */
--warm-neutral: #F8F2E4       /* 暖米色背景 */
--cool-neutral: #E3ECF5       /* 冷灰白强调 */
```

### 游戏化配色方案（类似 Pokémon）
```css
--battle-dark: #281E3C        /* 战斗暗黑背景 */
--power-gold: #FFD60A         /* 战力金色 */
--rarity-common: #8E8E93      /* 普通灰色 */
--rarity-uncommon: #34C759    /* 稀有绿色 */
--rarity-rare: #0A84FF        /* 史诗蓝色 */
--rarity-epic: #BF5AF2        /* 传说紫色 */
--rarity-legendary: #FFAA00   /* 传说橙金 */
```

### 来源参考
- 虚拟宠物界面设计：https://a.zdmimg.com/202411/26/6744ae2ea40f5694.jpg_e1080.jpg
- 卡牌类游戏 UI: http://safe-img.xhscdn.com/bw1/a0a2ec42-0b5e-4225-92b6-397dd3102dc0
- 宝可梦战斗界面：http://i1.hdslb.com/bfs/archive/b3e3c7ead9492d8f20148f7babce5f067bf390bf.jpg@1200w_630h

---

## 5. 动效设计原则

### 5.1 基础缓动函数

```css
ease-out-back: cubic-bezier(0.34, 1.56, 0.44, 1);
ease-smooth: cubic-bezier(0.4, 0, 0.2, 1);
ease-bounce: cubic-bezier(0.68, -0.55, 0.265, 1.55);
```

### 5.2 常见动效时长

| 动效类型 | 时长 | 缓动曲线 |
|---------|------|---------|
| 卡片加载 | 0.3s | ease-out |
| 点击反馈 | 0.15s | ease-smooth |
| 页面切换 | 0.4s | ease-out-back |
| 悬浮 hover | 0.2s | ease-smooth |
| 重要通知 | 0.5s | ease-bounce |

### 5.3 触发时机

- ✅ 页面初次加载（淡入上浮）
- ✅ 数据更新完成（元素脉动）
- ✅ 成就达成（完整动画序列）
- ❌ 日常刷新/后台同步
- ❌ 快速滚动过程中的中间态

---

## 6. 实施优先级

### Phase 1 - MVP（1 周内）
1. **色彩系统与字体规范** - 建立全局 CSS 变量
2. **HUD 与信息栏美化** - 立即看到明显改善
3. **基础卡片样式** - 技能/装备卡片的视觉升级

### Phase 2 - 核心体验（2 周）
1. **Build 编辑器完整实现** - 交互最复杂的组件
2. **战斗界面可视化** - 伤害飘字 + 技能特效
3. **底部导航美化** - TabBar 过渡动画

### Phase 3 - 细节打磨（1 周）
1. **宠物主体渲染优化** - 引入更好的 SVG/Canvas 渲染
2. **互动反馈动效** - 点击、获得奖励等微观交互
3. **响应式适配** - 不同窗口尺寸的完美显示

---

## 7. 设计资源链接

### 图片参考
- 虚拟宠物应用设计示例：http://gips1.baidu.com/it/u=2491041476,256510097&fm=3074
- 宠物类 UI 要点分享：http://safe-img.xhscdn.com/bw1/a0a2ec42-0b5e-4225-92b6-397dd3102dc0
- 游戏 UI 图标集：http://gips3.baidu.com/it/u=2658262874,1635074868&fm=3074

### 颜色搭配工具
- Coolors: https://coolors.co/
- Material Design Color Tool: https://material.io/resources/color

### 图标资源
- Emoji 组合（临时方案）
- Feather Icons: https://feathericons.com/
- FontAwesome: https://fontawesome.com/

---

**版本**: v1.0  
**最后更新**: 2026-10-30  
**下一步**: 等待你确认这个设计方案是否符合你的预期，我会开始编写对应的 CSS 代码并应用到项目中！
