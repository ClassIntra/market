#!/usr/bin/env node
// ClassIntra Market 仓库体检（零依赖，Node 18+）
// ============================================================
// 这条脚本是市场仓的 CI 门禁。它只做三件事：
//   1. 目录与包的一致性：index.json ↔ 实际文件 ↔ manifest ↔ 逐文件 sha256
//   2. 安装期会拒绝的硬约束：命名、路径归属、大小上限、路由/端口冲突
//   3. 会让平板白屏的 Chrome 80 语法红线（CSS 红线降级为警告）
//
// 用法：
//   node tools/check.mjs            # 全量检查（CI 用）
//   node tools/check.mjs --json     # 机器可读
//   node tools/check.mjs --allow-missing-hashes   # 首次迁移期容忍未生成 hashes
//
// 退出码：0 = 通过（可有警告）；1 = 存在错误。
//
// 设计原则：不做「代码风格审查」，只拦会真实造成安装失败或白屏的问题。

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import process from 'node:process';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const INDEX = path.join(ROOT, 'index.json');
const SECTIONS = { apps: 'app', plugins: 'plugin', themes: 'theme' };
const LIMITS = { files: 300, fileBytes: 60 * 1024 * 1024, totalBytes: 80 * 1024 * 1024 };

const ARGV = new Set(process.argv.slice(2));
const JSON_OUT = ARGV.has('--json');
const ALLOW_MISSING_HASHES = ARGV.has('--allow-missing-hashes');

const errors = [];
const warnings = [];
const stat = { packages: 0, files: 0, bytes: 0 };

function err(scope, msg) { errors.push({ scope, msg }); }
function warn(scope, msg) { warnings.push({ scope, msg }); }

function rel(p) { return path.relative(ROOT, p).replace(/\\/g, '/'); }

function readJson(file, scope) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    err(scope, `JSON 解析失败: ${rel(file)} — ${e.message}`);
    return null;
  }
}

function sha256File(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

// ---------- 规则表 ----------
const NAME_RE = /^[a-z][a-z0-9-]{1,63}$/;
const VERSION_RE = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;

// CSS 软红线：老内核上会掉样式，但不至于白屏 → 警告
const CSS_RULES = [
  { re: /(^|[;{\s])gap\s*:/, msg: 'flex/grid gap（需 Chrome 84+）', hint: '改用子元素 margin' },
  { re: /:is\s*\(|:where\s*\(/, msg: ':is() / :where()（需 Chrome 88+）', hint: '展开选择器' },
  { re: /aspect-ratio\s*:/, msg: 'aspect-ratio（需 Chrome 88+）', hint: '用 padding-top 百分比' },
  { re: /transition\s*:\s*all\b/, msg: 'transition: all', hint: '只过渡 transform / opacity' }
];

// 粗粒度去字符串与注释，避免把文案里的 "const" 当成语法
function stripJsLiterals(src) {
  let out = src.replace(/\/\*[\s\S]*?\*\//g, ' ');
  out = out.replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
  out = out.replace(/'(?:\\.|[^'\\\n])*'/g, "''");
  out = out.replace(/"(?:\\.|[^"\\\n])*"/g, '""');
  return out;
}

// 找到「代码里的反引号」：注释与 '...' / "..." 字符串内的不算。
// （最初直接 src.indexOf('`')，把中文注释里引用的 `code` 全误判成模板字符串。）
function findBacktick(src) {
  const noComments = src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
  let inSingle = false;
  let inDouble = false;
  let esc = false;
  for (let i = 0; i < noComments.length; i++) {
    const ch = noComments[i];
    if (esc) { esc = false; continue; }
    if (ch === '\\') { esc = true; continue; }
    if (inSingle) { if (ch === "'") inSingle = false; continue; }
    if (inDouble) { if (ch === '"') inDouble = false; continue; }
    if (ch === "'") { inSingle = true; continue; }
    if (ch === '"') { inDouble = true; continue; }
    if (ch === '`') return i;
  }
  return -1;
}

function lintJs(file, scope) {
  const src = fs.readFileSync(file, 'utf8');
  const bt = findBacktick(src);
  if (bt !== -1) {
    const line = src.slice(0, bt).split('\n').length;
    err(scope, `${rel(file)}:${line} 使用模板字符串（反引号）—— Chrome 80 直接白屏`);
  }
  const stripped = stripJsLiterals(src);
  const scan = [
    { re: /\bconst\s+[A-Za-z_$]/, msg: 'const 声明', hint: '改用 var' },
    { re: /\blet\s+[A-Za-z_$]/, msg: 'let 声明', hint: '改用 var' },
    { re: /=>/, msg: '箭头函数', hint: '改用 function' },
    { re: /\?\./, msg: '可选链 ?.', hint: '改用 a && a.b' },
    { re: /\?\?/, msg: '空值合并 ??', hint: '改用显式 null 判断' },
    { re: /\bclass\s+[A-Za-z_$]/, msg: 'class 声明', hint: '改用构造函数 + prototype' },
    { re: /\basync\s+function|\bawait\s+/, msg: 'async / await', hint: '改用 Promise 链' },
    { re: /\.replaceChildren\s*\(/, msg: 'Element.replaceChildren()', hint: "改用 innerHTML = ''" }
  ];
  for (const rule of scan) {
    const m = stripped.match(rule.re);
    if (m) {
      const line = stripped.slice(0, m.index).split('\n').length;
      err(scope, `${rel(file)}:${line} 使用 ${rule.msg}（${rule.hint}）`);
    }
  }
}

function lintCss(file, scope) {
  const src = fs.readFileSync(file, 'utf8');
  for (const rule of CSS_RULES) {
    const m = src.match(rule.re);
    if (m) {
      const line = src.slice(0, m.index).split('\n').length;
      warn(scope, `${rel(file)}:${line} 使用 ${rule.msg}（${rule.hint}）`);
    }
  }
}

function walk(dir, out) {
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return out; }
  for (const ent of entries) {
    if (ent.name === 'node_modules' || ent.name.startsWith('.')) continue;
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

// ---------- 主流程 ----------
function main() {
  if (!fs.existsSync(INDEX)) {
    err('index.json', '仓库根目录缺少 index.json');
    return;
  }
  const index = readJson(INDEX, 'index.json');
  if (!index) return;

  if (typeof index.version !== 'number') err('index.json', 'version 必须是数字');
  if (!index.updated_at) warn('index.json', '缺少 updated_at（市场页会显示空更新时间）');

  const seenNames = new Map();
  const seenRoutes = new Map();
  const seenMounts = new Map();
  const seenPorts = new Map();

  for (const [section, kind] of Object.entries(SECTIONS)) {
    const list = index[section];
    if (list === undefined) continue;
    if (!Array.isArray(list)) { err(section, `${section} 必须是数组`); continue; }

    for (const entry of list) {
      const scope = `${section}/${entry && entry.name}`;
      stat.packages++;

      // --- 条目基础字段 ---
      if (!entry || typeof entry !== 'object') { err(scope, '条目不是对象'); continue; }
      const name = String(entry.name || '');
      if (!NAME_RE.test(name)) err(scope, `name 非法（kebab-case，2-64 位）: ${name || '(空)'}`);
      if (seenNames.has(name)) err(scope, `name 与 ${seenNames.get(name)} 重复`);
      else seenNames.set(name, section);
      if (!entry.label) err(scope, '缺少 label');
      if (!VERSION_RE.test(String(entry.version || ''))) err(scope, `version 非法: ${entry.version}`);
      if (!Array.isArray(entry.files) || entry.files.length === 0) {
        err(scope, 'files 为空');
        continue;
      }
      if (entry.files.length > LIMITS.files) err(scope, `文件数 ${entry.files.length} 超过上限 ${LIMITS.files}`);

      // --- 文件清单：路径归属 / 存在性 / 大小 / 哈希 ---
      const prefix = `${section}/${name}/`;
      let total = 0;
      let manifestSeen = false;
      const listed = new Set();

      for (const f of entry.files) {
        if (typeof f !== 'string' || f.indexOf(prefix) !== 0) {
          err(scope, `文件路径必须位于 ${prefix} 下: ${f}`);
          continue;
        }
        if (f.indexOf('..') !== -1 || f.indexOf('\\') !== -1) {
          err(scope, `文件路径含穿越/反斜杠: ${f}`);
          continue;
        }
        const full = path.join(ROOT, f);
        if (!fs.existsSync(full) || !fs.statSync(full).isFile()) {
          err(scope, `文件不存在: ${f}`);
          continue;
        }
        listed.add(f);
        const size = fs.statSync(full).size;
        total += size;
        stat.files++;
        if (size > LIMITS.fileBytes) err(scope, `单文件超过 60MB: ${f}`);
        if (f === `${prefix}manifest.json`) manifestSeen = true;

        if (entry.hashes && typeof entry.hashes === 'object') {
          const innerKey = f.slice(prefix.length);
          const expect = entry.hashes[innerKey] || entry.hashes[f];
          if (!expect) {
            warn(scope, `hashes 缺少该文件（安装时不做完整性校验）: ${f}`);
          } else {
            const actual = sha256File(full);
            if (actual !== String(expect).toLowerCase()) err(scope, `sha256 不匹配: ${f}`);
          }
        }
      }
      stat.bytes += total;
      if (total > LIMITS.totalBytes) err(scope, `包总大小超过 80MB`);

      if (!entry.hashes && !ALLOW_MISSING_HASHES) {
        err(scope, '缺少 hashes（请运行主仓 scripts/market-index-gen.mjs 生成）');
      }

      // --- 目录内未被索引的文件（常见于忘了重跑 index-gen）---
      const dirFiles = walk(path.join(ROOT, section, name), []);
      for (const abs of dirFiles) {
        const r = rel(abs);
        if (!listed.has(r) && !r.endsWith('.md')) warn(scope, `文件存在但未登记到 index.json: ${r}`);
      }

      if (!manifestSeen) {
        err(scope, `文件清单缺少 ${prefix}manifest.json`);
        continue;
      }

      // --- manifest 与条目一致性 ---
      const manifestPath = path.join(ROOT, prefix + 'manifest.json');
      const manifest = readJson(manifestPath, scope);
      if (!manifest) continue;
      if (manifest.name !== name && manifest.id !== name) {
        err(scope, `manifest 名称 (${manifest.name || manifest.id}) 与条目名 (${name}) 不一致`);
      }
      if (String(manifest.version || '') !== String(entry.version || '')) {
        err(scope, `manifest.version (${manifest.version}) 与 index.json (${entry.version}) 不一致`);
      }
      // 主题没有 type=theme 这一说：它的 type 是 light / dark（渲染基底）
      const typeOk = kind === 'theme'
        ? (manifest.type === 'light' || manifest.type === 'dark')
        : manifest.type === kind;
      if (!typeOk) {
        err(scope, `manifest.type 应为 "${kind === 'theme' ? 'light | dark' : kind}"，实际为 "${manifest.type || '(空)'}"`);
      }

      // --- 路由与挂载点冲突 ---
      const route = manifest.frontend && manifest.frontend.route;
      if (route) {
        const key = String(route);
        if (seenRoutes.has(key)) err(scope, `前端路由 ${key} 与 ${seenRoutes.get(key)} 冲突`);
        else seenRoutes.set(key, scope);
      }
      const mount = manifest.backend && manifest.backend.mountPath;
      if (mount) {
        const key = String(mount);
        if (seenMounts.has(key)) err(scope, `后端挂载点 ${key} 与 ${seenMounts.get(key)} 冲突`);
        else seenMounts.set(key, scope);
      }
      const port = manifest.backend && manifest.backend.process && manifest.backend.process.port;
      if (port !== undefined) {
        if (!Number.isInteger(port) || port < 1024 || port > 65535) {
          err(scope, `backend.process.port 非法: ${port}`);
        } else if (seenPorts.has(port)) {
          err(scope, `端口 ${port} 与 ${seenPorts.get(port)} 冲突`);
        } else {
          seenPorts.set(port, scope);
        }
      }

      // --- Chrome 80 语法体检（只查运行时脚本，不查后端）---
      const jsFiles = dirFiles.filter((abs) => {
        const r = rel(abs);
        if (!r.endsWith('.js')) return false;
        // 只查会下发到浏览器的目录：frontend/ 与包根
        return r.startsWith(prefix + 'frontend/') || r === prefix + 'entry.js';
      });
      for (const abs of jsFiles) lintJs(abs, scope);
      for (const abs of dirFiles.filter((a) => rel(a).endsWith('.css'))) lintCss(abs, scope);

      // --- 运营字段（不阻断，但影响市场页观感）---
      // 截图只对「有界面」的应用有意义；插件是 backend-only，主题是纯数据，都不该逼着交图。
      if (kind === 'app' && (!entry.screenshots || !entry.screenshots.length)) {
        warn(scope, '缺少 screenshots（市场详情页会是空的）');
      }
      if (!entry.changelog || !entry.changelog.length) warn(scope, '缺少 changelog（用户看不到更新了什么）');
    }
  }

  // 目录里存在但 index.json 完全没登记的包
  for (const section of Object.keys(SECTIONS)) {
    const dir = path.join(ROOT, section);
    if (!fs.existsSync(dir)) continue;
    for (const name of fs.readdirSync(dir)) {
      if (name.startsWith('.') || name.startsWith('_') || name === 'node_modules') continue;
      if (!fs.statSync(path.join(dir, name)).isDirectory()) continue;
      if (!seenNames.has(name)) err(section, `目录存在但未在 index.json 登记: ${section}/${name}`);
    }
  }

  stat.bytesMb = (stat.bytes / 1024 / 1024).toFixed(1);
}

main();

if (JSON_OUT) {
  process.stdout.write(JSON.stringify({ ok: errors.length === 0, errors, warnings, stats: stat }, null, 2));
} else {
  const errCount = errors.length;
  const warnCount = warnings.length;
  console.log('');
  console.log('ClassIntra Market 体检');
  console.log('='.repeat(56));
  if (errCount === 0 && warnCount === 0) {
    console.log('未发现问题。');
  }
  if (errCount) {
    console.log(`\n错误 ${errCount} 项（会阻断安装或导致白屏）：`);
    for (const e of errors.slice(0, 80)) console.log(`  ✗ [${e.scope}] ${e.msg}`);
    if (errCount > 80) console.log(`  … 其余 ${errCount - 80} 项省略`);
  }
  if (warnCount) {
    console.log(`\n警告 ${warnCount} 项（不阻断，建议修）：`);
    const grouped = new Map();
    for (const w of warnings) {
      const key = w.msg.replace(/^[^ ]+ /, '');
      grouped.set(key, (grouped.get(key) || 0) + 1);
    }
    for (const [msg, count] of [...grouped.entries()].slice(0, 20)) {
      console.log(`  ! ${msg} ×${count}`);
    }
  }
  console.log('');
  console.log(`结果：错误 ${errCount}，警告 ${warnCount}`);
  console.log('');
}


process.exit(errors.length ? 1 : 0);
