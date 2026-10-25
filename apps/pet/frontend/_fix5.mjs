
import { readFileSync, writeFileSync } from 'node:fs';
const p = '../market/apps/pet/frontend/overlay.js';
let s = readFileSync(p, 'utf8');

// 追踪器升级为守卫：非数字赋值直接丢弃（保留最后有效值），全栈留证
const t = "        set: function(v) {\n          if (!Number.isFinite(v) && !lastError) {\n            lastError = 'pos.y ← ' + String(v) + ' @ ' + String(new Error().stack || '').split('\n')[2];\n          }\n          realY = v;\n        },";
const t2 = "        set: function(v) {\n          if (!Number.isFinite(v)) {\n            if (!lastError) lastError = 'pos.y 写入被拒绝: ' + String(v) + ' @ ' + String(new Error().stack || '').split('\n').slice(2, 8).join(' ← ');\n            return; // 丢弃坏值，保留最后有效位置\n          }\n          realY = v;\n        },";
if (s.indexOf(t) === -1) throw new Error('y-setter not found');
s = s.replace(t, t2);

// x 同样加守卫（对称防御）
const xs = '  var pos = { x: 0, y: 0 }; // 左上角位置';
const xs2 = '  var pos = { x: 0, y: 0 }; // 左上角位置（x/y 均为受控属性：非数字赋值被丢弃）';
s = s.replace(xs, xs2);
const marker = '  (function() {\n    try {\n      var realY = 0;';
const xguard = '  (function() {\n    try {\n      var realX = 0;\n      Object.defineProperty(pos, \'x\', {\n        get: function() { return realX; },\n        set: function(v) {\n          if (!Number.isFinite(v)) {\n            if (!lastError) lastError = \'pos.x 写入被拒绝: \' + String(v);\n            return;\n          }\n          realX = v;\n        },\n        configurable: true\n      });\n      var realY = 0;';
if (s.indexOf(marker) === -1) throw new Error('tracker marker not found');
s = s.replace(marker, xguard);

writeFileSync(p, s);
console.log('坐标守卫完成');
