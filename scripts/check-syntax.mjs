#!/usr/bin/env node
/**
 * 静态检查：JavaScript 语法 + JSON-LD 合法性 + 本地资源引用完整性。
 *
 * 检查内容：
 *   1. 独立 .js / .mjs 文件的语法（交给 node --check，遵循 package.json 的模块类型）
 *   2. 各页面内联 <script> 的语法（传统脚本语义，用 vm.Script 解析但不执行）
 *   3. <script type="application/ld+json"> 是否为合法 JSON（结构化数据直接关系 SEO）
 *   4. 页面里 src/href 指向的本站资源是否真实存在（防止改路径时漏改某页）
 *   5. canonical 与 sitemap 的地址形态是否一致、是否都指向真实存在的文件
 *   6. 是否残留任何指向第三方 CDN 的引用（本项目承诺零外发请求）
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

/* 5. canonical 与 sitemap 的地址形态一致性
 *
 * 背景：Cloudflare Pages 会把 /foo.html **308 永久重定向**到 /foo，且这是平台硬编码行为，
 * 没有配置开关可以关闭。因此 /foo 才是「最终地址」，canonical 与 sitemap 都必须写它——
 * 写成 .html 就等于把 canonical 指向一个会跳转的中间地址，白白浪费抓取预算，
 * 搜索引擎也可能把这些页面报成「Page with redirect」。
 *
 * 这条检查用「地址必须能映射回真实存在的文件，且不得带 .html」把结论锁死：
 * 无扩展名地址会被还原成同名 .html 文件去校验存在性，而带 .html 的会被显式判错。
 */
const ORIGIN = 'https://youngray.asia';
const ERROR_PAGE = '404.html';

const relPaths = htmlFiles.map(rel).sort();
const indexablePages = relPaths.filter(r => r !== ERROR_PAGE);

/** 页面自身的「最终地址」：去掉 .html；index.html 归一到根。 */
const ownUrl = (r) => (r === 'index.html' ? ORIGIN + '/' : ORIGIN + '/' + r.replace(/\.html$/, ''));

/** 把「最终地址」映射回仓库里的文件；无扩展名 → 同名 .html。 */
function urlToRelPath(url) {
  if (!url.startsWith(ORIGIN)) return null;
  const p = url.slice(ORIGIN.length).split('#')[0].split('?')[0];
  if (p === '' || p === '/') return 'index.html';
  const rel = p.replace(/^\//, '');
  return /\.html$/.test(rel) ? rel : rel + '.html';
}

let canonicalCount = 0;
let selfUrlCount = 0;
let sitemapCount = 0;

for (const f of htmlFiles) {
  const r = rel(f);
  const src = fs.readFileSync(f, 'utf8');
  const canonical = (src.match(/<link[^>]+rel="canonical"[^>]+href="([^"]+)"/i) || [])[1];

  if (r === ERROR_PAGE) {
    if (canonical) errors.push(`[canonical] ${r} 不应设置 canonical（它是错误页）`);
    if (!/<meta[^>]+name="robots"[^>]+content="[^"]*noindex/i.test(src)) {
      errors.push(`[canonical] ${r} 缺少 noindex，错误页不应被搜索引擎收录`);
    }
    continue;
  }

  if (!canonical) errors.push(`[canonical] ${r} 缺少 <link rel="canonical">`);
  else canonicalCount++;

  /* 「本页地址」有三个载体：canonical、og:url、JSON-LD 的 "url"。
   * 三者必须一致，否则等于对搜索引擎与社交平台给出互相矛盾的地址。
   * 之前只校验了 canonical，结果迁移时漏掉了另外两处——所以在这里一并锁死。 */
  const expected = ownUrl(r);
  const carriers = [
    ['canonical', canonical],
    ['og:url', (src.match(/<meta[^>]+property="og:url"[^>]+content="([^"]+)"/i) || [])[1]],
    ...[...src.matchAll(/"url":\s*"(https?:\/\/[^"]+)"/g)].map(m => ['JSON-LD url', m[1]]),
  ];

  for (const [label, val] of carriers) {
    if (!val) continue;
    selfUrlCount++;
    if (!val.startsWith(ORIGIN)) {
      errors.push(`[self-url] ${r} 的 ${label} 不是本站地址: ${val}`);
    } else if (val !== expected) {
      errors.push(
        `[self-url] ${r} 的 ${label} 与本页地址不一致\n` +
        `      应为 ${expected}\n` +
        `      实为 ${val}`
      );
    }
    if (/\.html$/.test(val)) {
      errors.push(
        `[self-url] ${r} 的 ${label} 带了 .html 扩展名: ${val}\n` +
        `      Cloudflare Pages 会把 /foo.html 308 跳到 /foo，应当直接写最终地址。`
      );
    }
  }
}

const sitemapPath = path.join(ROOT, 'sitemap.xml');
if (!fs.existsSync(sitemapPath)) {
  errors.push('[sitemap] 缺少 sitemap.xml');
} else {
  const xml = fs.readFileSync(sitemapPath, 'utf8');
  const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1].trim());
  sitemapCount = locs.length;

  const seen = new Set();
  for (const loc of locs) {
    if (seen.has(loc)) errors.push(`[sitemap] URL 重复: ${loc}`);
    seen.add(loc);

    const p = urlToRelPath(loc);
    if (p === null) { errors.push(`[sitemap] 不是本站地址: ${loc}`); continue; }
    if (p === ERROR_PAGE) { errors.push(`[sitemap] 不应收录错误页: ${loc}`); continue; }
    if (/\.html$/.test(loc)) {
      errors.push(
        `[sitemap] URL 带了 .html 扩展名: ${loc}\n` +
        `      Cloudflare Pages 会把 /foo.html 308 跳到 /foo，所以最终地址不带扩展名。\n` +
        `      sitemap 应当收录最终地址，否则等于让爬虫多走一次跳转。`
      );
      continue;
    }
    if (!fs.existsSync(path.join(ROOT, p))) {
      errors.push(
        `[sitemap] URL 映射不到真实文件: ${loc}\n` +
        `      按地址推导出的文件是 ${p}，但它不存在。`
      );
    }
  }

  for (const r of indexablePages) {
    if (!seen.has(ownUrl(r))) errors.push(`[sitemap] 未收录页面: ${ownUrl(r)}`);
  }
}

/* 6. 不得残留第三方 CDN 引用 */
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
console.log(`canonical 标签   : ${canonicalCount}（另有 1 个错误页不设 canonical）`);
console.log(`页面自身地址核对 : ${selfUrlCount} 处（canonical / og:url / JSON-LD url）`);
console.log(`sitemap URL      : ${sitemapCount}`);
console.log('─'.repeat(60));

if (errors.length) {
  console.log(`\n错误 ${errors.length} 项：`);
  errors.forEach(e => console.log('  ✗ ' + e));
} else {
  console.log('\n全部检查通过。');
}
console.log('');
process.exit(errors.length ? 1 : 0);
