// 拾光群岛 v5 —— 把 atlas.json 生成为 JS 帧表
// 手抄 263 个坐标迟早错一个，错了就是「某个怪看不见」。生成器只做一件事：
// 让前端拿到与图集严格一致的 [x, y, w, h, fw, fh]。
//
// 用法：node frontend/v5/gen-frames.mjs
import fs from 'node:fs';
import path from 'node:path';

const DIR = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const src = JSON.parse(fs.readFileSync(path.join(DIR, 'atlas.json'), 'utf8'));
const out = path.join(DIR, 'src', '00_frames.js');

const keys = Object.keys(src.atlas).sort();
const lines = [];
lines.push('// 由 gen-frames.mjs 从 atlas.json 生成 —— 不要手改');
lines.push('// [x, y, w, h, 帧宽, 帧高]');
lines.push('var FR = {');
const rows = keys.map(function (k) {
  const r = src.atlas[k];
  return '  ' + JSON.stringify(k) + ': [' + r.join(',') + ']';
});
lines.push(rows.join(',\n'));
lines.push('};');
lines.push('');
lines.push('var SFX = ' + JSON.stringify(src.sfx || {}, null, 0).replace(/,"/g, ', "').replace(/^\{/, '{\n  ').replace(/\}$/, '\n}') + ';');
lines.push('var MUSIC = ' + JSON.stringify(src.music || {}, null, 0).replace(/,"/g, ', "').replace(/^\{/, '{\n  ').replace(/\}$/, '\n}') + ';');
lines.push('');

fs.writeFileSync(out, lines.join('\n'), 'utf8');
console.log('frames:', keys.length, '→', out);
