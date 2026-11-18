/*
 * 围棋（weiqi）—— 卸载清理钩子
 *
 * 市场应用契约：routes.js 自建的表，cleanup.js 负责删除；失败会中止卸载，
 * 因此这里只做确定性的 DROP TABLE，不做任何业务写操作。
 */
'use strict';

var db = require('_sdk/backend/host').db;

module.exports = function cleanup() {
  // 先停掉共享的 KataGo 子进程，避免卸载后仍占用 CPU/端口。
  try {
    var aiEngine = require('./engine');
    aiEngine.shutdown();
  } catch (e) {}
  var tables = [
    'weiqi_messages',
    'weiqi_moves',
    'weiqi_games',
    'weiqi_members',
    'weiqi_room_directory',
    'weiqi_rooms'
  ];
  for (var i = 0; i < tables.length; i++) {
    db.exec('DROP TABLE IF EXISTS ' + tables[i]);
  }
};
