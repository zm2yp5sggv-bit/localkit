#!/usr/bin/env node
/**
 * 静态检查：JavaScript 语法 + JSON-LD 合法性 + 本地资源引用完整性。
 *
 * 检查内容：
 *   1. 独立 .js / .mjs 文件的语法（交给 node --check，遵循 package.json 的模块类型）
 *   2. 各页面内联 <script> 的语法（传统脚本语义，用 vm.Script 解析但不执行）
 *   3. <script type="application/ld+json"> 是否为合法 JSON（结构化数据直接关系 SEO）
 *   4. 页面里 src/href 指向的本站资源是否真实存在（防止改路径时漏改某页）
 *   5. 是否残留任何指向第三方 CDN 的引用（本项目承诺零外发请求）
 *
 * 用法：node scripts/check-syntax.mjs
 * 环境变量：LK_ROOT 指定仓库根目录（供自测使用，默认取脚本上一级）
 */

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';

const ROOT = process.env.LK_ROOT
  ? path.resolve(process.env.LK_ROOT)
  : path.resolve(import.meta.dirname, '..');

function walk(dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['.git', 'node_modules', 'test-results', 'playwright-report'].includes(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, acc); else acc.push(p);
  }
  return acc;
}

const all = walk(ROOT);
const htmlFiles = all.filter(f => f.endsWith('.html'));
const jsFiles = all.filter(f => f.endsWith('.js'));
const mjsFiles = all.filter(f => f.endsWith('.mjs'));

// assets/vendor 是第三方压缩产物：体积大且不归我们维护，
// 它们由 scripts/update-vendor.mjs 的 sha256 校验把关，这里跳过语法解析。
const VENDOR_RE = /^assets[\\/]vendor[\\/]/;

const errors = [];
let fileCount = 0, jsCount = 0, jsonLdCount = 0, refCount = 0;

const rel = (f) => path.relative(ROOT, f).replace(/\\/g, '/');

/* 1. 独立 .js / .mjs 文件
 * 交给 `node --check`：它会遵循 package.json 的 "type" 字段判断该文件是模块还是脚本，
 * 而 vm.Script 只会按传统脚本解析，遇到 tests/ 下的 ESM 用例会误报。
 * （浏览器侧的内联 <script> 依旧用 vm.Script，因为它们确实是传统脚本。） */
for (const f of [...jsFiles, ...mjsFiles]) {
  if (VENDOR_RE.test(rel(f))) continue;
  fileCount++;
  try {
    execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' });
  } catch (e) {
    errors.push(`[语法] ${rel(f)}: ${String(e.stderr).split('\n').slice(0, 3).join(' ').trim()}`);
  }
}

/* 2. 内联脚本 + JSON-LD */
for (const f of htmlFiles) {
  const src = fs.readFileSync(f, 'utf8');
  const re = /<script([^>]*)>([\s\S]*?)<\/script>/gi;
  let m, i = 0;
  while ((m = re.exec(src)) !== null) {
    const attrs = m[1], code = m[2];
    if (!code.trim() || /\bsrc=/.test(attrs)) continue;
    i++;

    if (/application\/ld\+json/i.test(attrs)) {
      jsonLdCount++;
      try { JSON.parse(code); }
      catch (e) { errors.push(`[JSON-LD] ${rel(f)} 第 ${i} 个 script: ${e.message}`); }
      continue;
    }

    try { new vm.Script(code, { filename: `${rel(f)}#script${i}` }); jsCount++; }
    catch (e) { errors.push(`[语法] ${rel(f)} 第 ${i} 个内联 script: ${e.message}`); }
  }
}

/* 3. 本站资源引用完整性 */
for (const f of htmlFiles) {
  const src = fs.readFileSync(f, 'utf8');
  const re = /(?:src|href)="([^"#?]+)"/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    const u = m[1];
    if (/^(https?:|mailto:|data:|blob:|#|\/\/)/.test(u)) continue;
    refCount++;
    const target = path.resolve(path.dirname(f), u);
    if (!fs.existsSync(target)) errors.push(`[引用] ${rel(f)} 指向不存在的文件: ${u}`);
  }
}

/* 5. 不得残留第三方 CDN 引用 */
const CDN_RE = /(?:src|href)=["'](https?:\/\/[^"']*(?:cdn\.|unpkg|googleapis|gstatic)[^"']*)["']/gi;
for (const f of [...htmlFiles, ...jsFiles]) {
  if (VENDOR_RE.test(rel(f))) continue;
  const src = fs.readFileSync(f, 'utf8');
  let m;
  while ((m = CDN_RE.exec(src)) !== null) {
    errors.push(`[外发] ${rel(f)} 仍引用外部资源（本站承诺零外发）: ${m[1]}`);
  }
}

/* 输出 */
console.log('静态检查');
console.log('─'.repeat(60));
console.log(`脚本文件         : ${fileCount}`);
console.log(`内联 JavaScript  : ${jsCount}`);
console.log(`JSON-LD 块       : ${jsonLdCount}`);
console.log(`本站资源引用     : ${refCount}`);
console.log('─'.repeat(60));

if (errors.length) {
  console.log(`\n错误 ${errors.length} 项：`);
  errors.forEach(e => console.log('  ✗ ' + e));
} else {
  console.log('\n全部检查通过。');
}
console.log('');
process.exit(errors.length ? 1 : 0);
