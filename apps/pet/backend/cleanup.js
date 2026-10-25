// 桌宠卸载清理：删除所有用户的宠物状态键（卸载即无痕）
var path = require('path');
var db = require(path.resolve(process.cwd(), 'src/utils/db'));
module.exports = function cleanup(ctx) {
  db.prepare("DELETE FROM user_kv_store WHERE key = 'desktop_pet'").run();
};
