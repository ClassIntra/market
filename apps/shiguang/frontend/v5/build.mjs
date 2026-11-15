// 拾光群岛 v5 —— 前端分片拼接构建
//
// 市场应用的 entry.js 是直接下发浏览器的单文件，不能 import。但 6000 行塞一个文件
// 无法维护，所以源码按系统切成 src/*.js，构建时按文件名排序拼接进一个 IIFE。
//
// 为什么不是「运行时加载多个 script」：多一轮网络往返 + 顺序不可控 + 卸载时
// 还得自己拆 script 标签。拼接是零成本的。
//
// 用法：node frontend/v5/build.mjs
import fs from 'node:fs';
import path from 'node:path';

const DIR = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const SRC = path.join(DIR, 'src');
const OUT = path.join(DIR, '..', 'entry.js');

const files = fs.readdirSync(SRC).filter((f) => f.slice(-3) === '.js').sort();
if (!files.length) throw new Error('src 里没有 js');

const head = [
  '/* 拾光群岛 v5「长夜」—— 市场应用入口（俯视角像素动作 RPG）',
  ' *',
  ' * 这个文件由 frontend/v5/build.mjs 从 src/*.js 拼接生成，不要直接改。',
  ' *',
  ' * 运行约束（市场应用不构建，直接下发浏览器；校园平板基线 Chrome 80）：',
  ' *   · 全 ES5：var / function / 单引号；不用箭头函数、模板串、?.、??、class、async',
  ' *   · 不用 Element.replaceChildren()（86+）、Object.values（54+ 但写法统一用 for in）',
  ' *   · 一切订阅 / 计时器 / 监听都登记到 context.app.onDestroy',
  ' *',
  ' * 世界的真相在服务端：位置、生命、怪物、掉落、灯塔进度都由 /shiguang/v5/* 决定，',
  ' * 客户端只负责「手感」——本地立刻播动画、算出命中、把结果上报，服务端校验后回传结论。',
  ' * 手感与权威的分界线就在 combat.js 顶部那段注释里。',
  ' */',
  '(function () {',
  "  'use strict';",
  '',
  "  var NAME = 'shiguang';",
  ''
].join('\n');

const tail = [
  '',
  '  window.ClassIntraMarket.define({ name: NAME, mount: mount, unmount: unmount });',
  '})();',
  ''
].join('\n');

const body = files.map((f) => {
  const code = fs.readFileSync(path.join(SRC, f), 'utf8');
  return '\n  // ======================== ' + f + ' ========================\n' + code.replace(/\s+$/, '') + '\n';
}).join('\n');

fs.writeFileSync(OUT, head + body + tail, 'utf8');
const kb = (Buffer.byteLength(head + body + tail) / 1024).toFixed(1);
console.log('built', OUT, '←', files.length, 'parts,', kb, 'KB');
