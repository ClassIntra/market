// 插件/市场应用后端 SDK 门面 —— 宿主内部模块的稳定出口
// ============================================================
// 第三方后端（plugins/<name>/backend、market-apps/<name>/backend）一律通过本门面
// 引用宿主能力，禁止直接 require 宿主内部路径：
//
//   var sdk = require('_sdk/backend/host');      // 推荐（宿主已把 plugins/ 目录加入 NODE_PATH）
//   var sdk = require('../_sdk/backend/host');   // 等价（仓库内插件的相对写法）
//   sdk.db.prepare('SELECT ...');
//   sdk.auth.requireAuth
//
// 为什么：`../../../server/src/utils/db`、`path.resolve(process.cwd(), 'src/...')`
// 这类写法把第三方代码钉死在宿主的目录结构上——宿主一重构、部署 cwd 一变就全碎。
// 门面把「宿主提供什么」收敛成一张稳定的名字表；内部实现路径由宿主仓库随版本维护。
//
// 稳定承诺：以下命名空间名向后兼容；宿主重构内部实现时不改这张表。
// 类型见 classintra-devkit/backend（devkit/types/backend.d.ts）。
//
// 经济能力面：市场应用只允许通过 sdk.ledger（server/src/ledger/app-api）读写学元，
// 这是宿主登记的受控白名单接口（只能碰 PRACTICE 资产）。sdk.yuanbao 仅供红包面板
// 类应用沿用既有流程（与 /api/wallet 同一服务），新增经济能力一律先走 ledger。

'use strict';

var HOST_SRC = '../../../server/src';

var sdk = {
  // ---- 数据 ----
  /** better-sqlite3 句柄（与宿主同一连接池） */
  db: require(HOST_SRC + '/utils/db'),
  /** 宿主配置（.env 解析结果） */
  config: require(HOST_SRC + '/config'),
  /** 进程内缓存 */
  cache: require(HOST_SRC + '/utils/cache'),
  /** 时间工具 */
  time: require(HOST_SRC + '/utils/time'),
  /** 常量（学号规则等） */
  constants: require(HOST_SRC + '/utils/constants'),

  // ---- 认证与账号 ----
  /** requireAuth / requireAdmin 中间件（挂到自己的 express 路由上） */
  auth: require(HOST_SRC + '/middleware/auth'),
  /** JWT 签发/校验（宿主同一密钥） */
  jwt: require(HOST_SRC + '/utils/jwt'),
  /** 口令哈希 */
  password: require(HOST_SRC + '/utils/password'),

  // ---- 实时与事件 ----
  /** 实时总线（WS 广播桥） */
  realtimeBus: require(HOST_SRC + '/utils/realtime-bus'),
  /** 联邦中继总线（跨实例事件） */
  relayBus: require(HOST_SRC + '/utils/relay-bus'),
  /** 应用级事件总线（in-process；订阅自动挂 owner，卸载时宿主整批清理） */
  appEvents: require(HOST_SRC + '/core/app-events'),

  // ---- 应用级存储 / 配置 / 定时任务 ----
  /** KV + blob 存储（配额、按 app+用户隔离；HTTP 面 /api/app-data/*） */
  appData: require(HOST_SRC + '/core/app-data'),
  /** manifest.config 声明的配置读取（DB → env → default 三级回退） */
  appConfig: require(HOST_SRC + '/utils/app-config'),
  /** 定时任务（manifest.backend.jobs 的宿主托管运行器） */
  appScheduler: require(HOST_SRC + '/core/app-scheduler'),

  // ---- 经济（受控能力面） ----
  /** 学元账本应用 API：唯一登记的第三方经济入口（只能碰 PRACTICE 资产） */
  ledger: require(HOST_SRC + '/ledger/app-api'),
  /** 元宝/红包服务：红包面板沿用（与 /api/wallet 同源）；新增能力请走 ledger */
  yuanbao: require(HOST_SRC + '/services/yuanbao'),

  // ---- 站点服务（按需；宿主自带服务的稳定出口） ----
  /** 天气服务（astrbot-relay 等使用） */
  weather: require(HOST_SRC + '/services/weather'),

  // ---- 插件 SDK（错误与出站请求/媒体中转） ----
  /** PluginError / isNetworkError */
  errors: require('./errors'),
  /** createTicketKit / createRelay / fetchRaw / httpGetJson / proxyConnect */
  relay: require('./stream-relay')
};

module.exports = sdk;
