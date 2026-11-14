// 学元红包（证券应用侧）
// ============================================================
// 2026-11-04：红包核心逻辑已上移到平台层 `server/src/services/yuanbao.js`，
// 因为「学元钱包」成了系统应用，两个入口必须共用同一份实现与同一张表，
// 否则会出现「钱包里还能领已经领过的红包」这类分叉。
//
// 本文件只剩两件事：
//   1. 把 app 标记成 'stock'（流水里能看出是在哪个应用发/领的）
//   2. 领取成功后给发送者发一条站内提醒（stock_notify 是本应用私有的表，
//      平台服务不该知道它）
//
// 对外 API 与拆分前完全一致，routes.js 无需改动。
//
// 编码约定：var / function

var nodePath = require('path');
var db = require('_sdk/backend/host').db;
var yuanbao = require('_sdk/backend/host').yuanbao;
var notify = require('./notify');

function create(sender, totalCent, count, note) {
  return yuanbao.create(sender, totalCent, count, note, 'stock');
}

function claim(packetId, userId) {
  var out = yuanbao.claim(packetId, userId, 'stock');

  // 通知发送者（资金已在服务层落账，通知失败不影响结果）
  if (out && !out.duplicate && out.amount > 0) {
    try {
      notify.push(out.sender, {
        kind: 'packet',
        title: yuanbao.userName(userId) + ' 领了你的红包 ' + out.amount.toFixed(2) + ' 学元',
        body: out.note ? '备注：' + out.note : '',
        ref: 'packet-claim:' + packetId + ':' + userId
      });
    } catch (e) { /* ignore */ }
  }
  return out;
}

// 历史调用方（stock/routes.js）只用这四个方法 + 常量
module.exports = {
  ensure: yuanbao.ensure,
  toCent: yuanbao.toCent,
  create: create,
  claim: claim,
  list: yuanbao.list,
  sweepExpired: yuanbao.sweepExpired,
  userName: yuanbao.userName,
  MAX_TOTAL_CENT: yuanbao.MAX_TOTAL_CENT,
  MAX_COUNT: yuanbao.MAX_COUNT
};
