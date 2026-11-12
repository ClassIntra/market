// 拾光群岛 —— 卸载清理钩子
//
// 宿主在删除应用目录之前执行本文件。失败会中止卸载（文件与记录都会保留，
// 修好之后可以重试），所以这里只做清理，不做任何有风险的写操作。
//
// 责任范围：routes.js 里自建的每一张表都要在这里 DROP。
// 漏掉一张，用户重装后就会看到上一批人的幽灵数据。
'use strict';

var path = require('path');

module.exports = function cleanup(ctx) {
  var db = require('_sdk/backend/host').db;
  var tables = [
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
    'shiguang_steles'
  ];
  for (var i = 0; i < tables.length; i++) {
    db.prepare('DROP TABLE IF EXISTS ' + tables[i]).run();
  }
  return { dropped: tables };
};
