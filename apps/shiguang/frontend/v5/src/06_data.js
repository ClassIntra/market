  // ---------------- §12 客户端数据 ----------------
  // 技能：与 backend/v5/data.js 的 SKILLS 同名同参（数值以服务端为准，这里只管观感）
  var SKILLS = {
    spin: { name: '灯火回旋', mp: 18, cd: 4000, dmg: 1.6, radius: 2.8, lv: 1, desc: '周身一圈光刃，清群怪。' },
    dash: { name: '影步斩', mp: 14, cd: 3200, dmg: 2.2, dist: 6, lv: 4, desc: '向前冲刺斩击，冲刺中无敌。' },
    nova: { name: '星爆', mp: 30, cd: 9000, dmg: 3.4, radius: 4.2, lv: 9, desc: '蓄力爆炸，击退并点燃。' },
    lamp: { name: '守夜灯', mp: 24, cd: 20000, dur: 12000, radius: 4, lv: 6, desc: '放一盏灯：回血，幽灵不敢靠近。' },
    arrows: { name: '流星雨', mp: 36, cd: 12000, dmg: 1.0, radius: 5, lv: 14, desc: '指定区域落下流星。' }
  };

  // 镇上的 NPC —— 他们的位置钉在房子门口，不会乱走（走丢了玩家就找不到铁匠）
  var NPCS = [
    {
      id: 'smith', name: '铁匠 阿岩', x: 0, y: 0, look: 'NinjaGray', face: 0,
      line: ['刀要趁热打，词条也是。', '星屑带够了吗？重铸可不便宜。'],
      action: 'forge', actionText: '打开锻造台'
    },
    {
      id: 'shop', name: '杂货铺 阿禾', x: 0, y: 0, look: 'Woman', face: 0,
      line: ['回血药、灯油，都在这儿。', '夜里别空着手出门。'],
      action: 'shop', actionText: '看看货'
    },
    {
      id: 'inn', name: '客栈 阿灯', x: 0, y: 0, look: 'OldMan', face: 0,
      line: ['累了就歇会儿，灯火一直亮着。', '长夜不会走，但人会累。'],
      action: 'rest', actionText: '歇一会儿（回满生命）'
    },
    {
      id: 'hall', name: '守灯人 栗', x: 0, y: 0, look: 'Master', face: 0,
      line: ['灯塔一盏一盏灭下去的时候，我在数。', '你点亮一座，我就少数一个。'],
      action: 'story', actionText: '听她说话'
    }
  ];

  // 怪物形象：kind → 图集里的 mon_ 名字。没有对应素材的用最接近的替身，
  // 宁可「长得像」也不要「看不见」。
  var MOB_SPRITE = {
    slime: 'mon_Slime', slime2: 'mon_Slime2', bamboo: 'mon_Bamboo', mouse: 'mon_Mouse',
    eye: 'mon_Eye', mushroom: 'mon_Mushroom', owl: 'mon_Owl', beast: 'mon_Beast',
    snake: 'mon_Snake', frog: 'mon_Axolot', larva: 'mon_Larva', lantern: 'mon_LanternRed',
    skull: 'mon_Skull', cyclope: 'mon_Cyclope', mole: 'mon_Mole', reptile: 'mon_Reptile2',
    spirit2: 'mon_Spirit2', dragon: 'mon_Dragon', octopus: 'mon_Octopus2', flam: 'mon_Flam2',
    ghost: 'mon_Spirit'
  };
  var MOB_SIZE = {
    slime: 0.8, slime2: 0.85, bamboo: 1.05, mouse: 0.7, eye: 0.85, mushroom: 0.9,
    owl: 0.85, beast: 1.15, snake: 0.9, frog: 0.95, larva: 0.7, lantern: 0.9,
    skull: 1.0, cyclope: 1.35, mole: 0.85, reptile: 1.05, spirit2: 1.0, dragon: 1.25,
    octopus: 1.3, flam: 1.0, ghost: 1.0
  };

  var BOSS_SPRITE = {
    meadow: ['GiantFrog', 1], forest: ['TenguBlue', 0.75], swamp: ['GiantRacoonGold', 1],
    crag: ['GiantRedSamurai', 1], frost: ['GiantSpirit', 1], abyss: ['DemonCyclop', 1]
  };

  var ZONE_NAMES = {
    town: '拾光镇', meadow: '晨光草原', forest: '雾隐林', swamp: '萤火泽',
    crag: '星坠岩', frost: '霜屿', abyss: '长夜之心'
  };
  var ZONE_ORDER = ['meadow', 'forest', 'swamp', 'crag', 'frost', 'abyss'];

  // 七章《灯火纪》：按点亮灯塔的座数推进（全服进度，不是个人）
  var CHAPTERS = [
    { at: 0, title: '第一章 · 长夜从西边来', text: '镇上的灯还亮着。守灯人栗说，西边的草原上有一盏灯灭了 —— 从那天起，史莱姆开始聚成群。' },
    { at: 1, title: '第二章 · 草原的老国王', text: '巨蛙王倒下去的时候，雾退了一点点。原来长夜不是天气，它是活的。' },
    { at: 2, title: '第三章 · 林中的眼睛', text: '雾隐林里挂满了眼睛。天狗说它只是守着林子的边界 —— 守到忘了自己在守什么。' },
    { at: 3, title: '第四章 · 被偷走的萤火', text: '萤火泽的灯全都不见了。金爪把它们吞进肚子里，照亮自己过冬。' },
    { at: 4, title: '第五章 · 战争早就结束了', text: '赤武士还在等一道不会再来的命令。他守的山，已经塌了一半。' },
    { at: 5, title: '第六章 · 冰下的敲击', text: '霜屿的冰下面有东西在敲。它不是要出来，它是要你别再往里走。' },
    { at: 6, title: '第七章 · 所有熄灭的灯', text: '长夜之心里没有怪物，只有一地熄灭的灯。最后一盏，在你手上。' }
  ];
