
import { readFileSync, writeFileSync } from 'node:fs';
const p = '../market/apps/pet/frontend/overlay.js';
let s = readFileSync(p, 'utf8');
// 全栈记录（5 帧）+ 保留首犯逻辑
const t = "lastError = 'pos.y ← ' + String(v) + ' @ ' + String(new Error().stack || '').split('\n')[2];";
const t2 = "lastError = 'pos.y ← ' + String(v) + ' @ ' + String(new Error().stack || '').split('\n').slice(2, 7).join(' | ');".replace(/\\n/g, '\n');
if (s.indexOf(t) === -1) throw new Error('tracker not found');
s = s.replace(t, t2);
writeFileSync(p, s);
console.log('全栈追踪完成');
