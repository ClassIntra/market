// 拾光群岛 —— 卸载清理钩子
//
// 宿主在删除应用目录之前执行本文件。失败会中止卸载（文件与记录都会保留，
// 修好之后可以重试），所以这里只做清理，不做任何有风险的写操作。
//
// 责任范围：后端自建的每一张表都要在这里 DROP。
// 漏掉一张，用户重装后就会看到上一批人的幽灵数据。
//
// v5 的表全部带 shiguang5_ 前缀；v4 的旧表也一并清掉 —— 这个应用已经整体升级，
// 留着 v4 的十张表只会让「重装后数据还在」变成一个 bug 报告。
'use strict';

module.exports = function cleanup(ctx) {
  var db = require('_sdk/backend/host').db;
  var tables = [
    // v5
    'shiguang5_players',
    'shiguang5_chests',
    'shiguang5_towers',
    'shiguang5_boss_kills',
    'shiguang5_feed',
    // v4（历史遗留）
    'shiguang_players',
    'shiguang_lamps',
    'shiguang_bottles',
    'shiguang_explored',
    'shiguang_nodes',
    'shiguang_flowers',
    'shiguang_catches',
    'shiguang_quests',
    'shiguang_achievements',
    'shiguang_wardrobe',
    'shiguang_steles',
    'shiguang_npc_talk',
    'shiguang_calendar',
    'shiguang_crops'
  ];
  var dropped = [];
  for (var i = 0; i < tables.length; i++) {
    try {
      db.prepare('DROP TABLE IF EXISTS ' + tables[i]).run();
      dropped.push(tables[i]);
    } catch (e) {}
  }
  return { dropped: dropped };
};
