#!/usr/bin/env node
/**
 * 部署配置检查：_headers 与 _redirects。
 *
 * 这两份文件是「声明式」的，写错了不会报错，只会静默地不生效——本项目就吃过两次亏，
 * 因此把两类错误都固化成了检查项：
 *
 *   1. _redirects 状态码合法性
 *      Cloudflare Pages 只支持 301 / 302 / 303 / 307 / 308 与 200（代理）。
 *      官方文档「Rewrites (other status codes): No」——写 404 / 410 会被静默忽略。
 *      （曾经打算用 `... 404` 来屏蔽开发文件，查文档才发现根本不会生效。）
 *
 *   2. _headers 同名响应头的重叠设置
 *      多条规则命中同一路径时，Cloudflare 把同名响应头的值**用逗号合并**，不是覆盖。
 *      因此两条规则同时设置 Cache-Control 会产出一串互相冲突的指令。
 *      （曾经三条规则都设 Cache-Control，导致 immutable 实际未生效。）
 *
 *   3. 缓存策略必须全站一致
 *      要求 _headers 对通配路径声明 Cache-Control，且 max-age 只出现一次。
 *      （这条只是「声明是否自洽」；声明有没有在线上真正生效由 scripts/smoke.mjs 探测，
 *        因为 Cloudflare 区域的 Browser Cache TTL 会覆盖 max-age，那是仓库看不到的。）
 *
 *   4. 开发产物屏蔽覆盖率
 *      Cloudflare Pages 以仓库根目录为发布目录，git 里跟踪的非站点文件会被公开服务。
 *      _redirects 必须逐条把它们拦掉，否则等于把测试与脚本一起发布出去。
 *      （曾经 /tests/fixtures/sample.pdf 可被公网直接下载。）
 *      统计范围包含「已跟踪 + 未跟踪但未被忽略」的文件，因此新建文件在 git add 之前
 *      就会被提醒补 _redirects 规则。
 *
 * 用法：node scripts/check-deploy.mjs
 * 环境变量：LK_ROOT 指定仓库根目录（供自测使用，默认取脚本上一级）
 */

import path from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  readDeployConfig, resolveRedirect, resolveHeaders,
  samplePath, matches, SUPPORTED_REDIRECT_CODES,
} from './lib/deploy-config.mjs';

const ROOT = process.env.LK_ROOT
  ? path.resolve(process.env.LK_ROOT)
  : path.resolve(import.meta.dirname, '..');

const errors = [];
const warnings = [];

const { headers: headerRules, redirects: redirectRules } = readDeployConfig(ROOT);

/* ------------------------------------------------------------------ *
 * 站点内容白名单：这些路径本来就该被公开服务
 * ------------------------------------------------------------------ */

const SITE_PATTERNS = [
  /^index\.html$/,
  /^about\.html$/,
  /^privacy\.html$/,
  /^donate\.html$/,
  /^404\.html$/,            // Cloudflare Pages 在未找到路径时自动使用它
  /^tools\/[^/]+\.html$/,
  /^assets\/(?!vendor\/README\.md$).+$/,
  /^robots\.txt$/,
  /^sitemap\.xml$/,
  /^_headers$/,
  /^_redirects$/,
  /^LICENSE$/,
];

const isSiteContent = (p) => SITE_PATTERNS.some(re => re.test(p));

/* ------------------------------------------------------------------ *
 * 检查 1：_redirects 语法与状态码
 * ------------------------------------------------------------------ */

for (const rule of redirectRules) {
  if (rule.invalid) {
    errors.push(`_redirects 第 ${rule.lineNo} 行格式不合法（应为 source destination [code]）: ${rule.line}`);
    continue;
  }
  if (!Number.isInteger(rule.code)) {
    errors.push(`_redirects 第 ${rule.lineNo} 行状态码不是整数: ${rule.line}`);
    continue;
  }
  if (!SUPPORTED_REDIRECT_CODES.has(rule.code)) {
    errors.push(
      `_redirects 第 ${rule.lineNo} 行使用了 Cloudflare Pages 不支持的状态码 ${rule.code}: ${rule.line}\n` +
      `      官方仅支持 301 / 302 / 303 / 307 / 308 与 200（代理），其余会被静默忽略。`
    );
  }
}

/* ------------------------------------------------------------------ *
 * 检查 2：_headers 模式与同名响应头重叠
 * ------------------------------------------------------------------ */

// 每条规则的首行必须是一个 URL 路径模式。
// 这条检查是踩坑换来的：_headers 里的 `/*` 是「匹配所有路径」的通配模式，
// 格式中并没有 C 风格的块结束符，一旦顺手补上 `*/` 收尾，
// 就会被解析成一条模式为 "*/" 的规则（空规则，不报错但会让规则数虚增、语义混乱）。
for (const rule of headerRules) {
  if (/^https?:\/\//.test(rule.pattern)) continue;
  if (!rule.pattern.startsWith('/')) {
    errors.push(
      `_headers 第 ${rule.lineNo} 行的模式不像 URL 路径: "${rule.pattern}"\n` +
      `      提示：/* 是「匹配所有路径」的通配模式，格式里没有块结束符，不要写 */ 收尾。`
    );
  }
}

for (let i = 0; i < headerRules.length; i++) {
  for (let j = i + 1; j < headerRules.length; j++) {
    const a = headerRules[i], b = headerRules[j];
    const overlap = matches(b.pattern, samplePath(a.pattern)) || matches(a.pattern, samplePath(b.pattern));
    if (!overlap) continue;

    const namesA = Object.keys(a.headers).map(n => n.toLowerCase());
    const namesB = Object.keys(b.headers).map(n => n.toLowerCase());
    for (const name of namesA) {
      if (!namesB.includes(name)) continue;
      if (b.detach.has(name)) continue;   // 显式取消后再设值，属有意为之
      errors.push(
        `_headers：规则 "${a.pattern}"（第 ${a.lineNo} 行）与 "${b.pattern}"（第 ${b.lineNo} 行）` +
        `都可能命中同一路径，且都设置了 ${name}。\n` +
        `      Cloudflare 会把同名响应头用逗号合并，产生互相冲突的指令串。\n` +
        `      请合并为一条规则，或在后者中先写 "! ${name}" 取消前者的值。`
      );
    }
  }
}

for (const rule of headerRules) {
  for (const name of rule.detach) {
    const setsIt = Object.keys(rule.headers).some(n => n.toLowerCase() === name);
    if (!setsIt) {
      warnings.push(`_headers 第 ${rule.lineNo} 行取消了 ${name}，但本规则未重新设置它——该响应头将不会下发。`);
    }
  }
}

/* ------------------------------------------------------------------ *
 * 检查 3：缓存策略必须全站一致
 *
 * 曾经为了给 assets/vendor/ 单独设长缓存，加了两条按路径规则，结果同名响应头被
 * Cloudflare 逗号合并成一串互相冲突的指令。现在统一为一条通配规则，
 * 这里把「必须有 Cache-Control」和「max-age 只能出现一次」固化下来，
 * 防止有人为了性能又把它拆开。
 * 另外，这条声明是否真的在线上生效，由 scripts/smoke.mjs 负责探测——
 * 因为 Cloudflare 的 Browser Cache TTL 会覆盖 max-age，那是仓库看不到的。
 */

if (!headerRules.length) {
  errors.push('_headers 不存在或没有任何规则。');
} else {
  const probes = ['/index.html', '/assets/i18n.js', '/assets/vendor/jszip.min.js', '/robots.txt'];
  for (const p of probes) {
    const resolved = resolveHeaders(headerRules, p);
    const cc = resolved['Cache-Control'] || resolved['cache-control'];
    if (!cc) {
      errors.push(`_headers 未对 ${p} 声明 Cache-Control（通配规则应当覆盖它）。`);
      continue;
    }
    const ages = cc.match(/max-age/g) || [];
    if (ages.length !== 1) {
      errors.push(
        `_headers 对 ${p} 生效的 Cache-Control 里 max-age 出现了 ${ages.length} 次: ${cc}\n` +
        `      这说明多条规则同时设置了它——Cloudflare 会把同名响应头逗号合并，\n` +
        `      产出互相冲突的指令串。请合并为一条通配规则。`
      );
    }
  }
}

if (!headerRules.some(r => Object.keys(r.headers).some(n => n.toLowerCase() === 'content-security-policy'))) {
  errors.push('_headers 未设置 Content-Security-Policy。');
}

/* ------------------------------------------------------------------ *
 * 检查 4：开发产物屏蔽覆盖率
 * ------------------------------------------------------------------ */

let tracked = [];
try {
  // --cached 列出已跟踪的，--others --exclude-standard 列出尚未 add 且未被 .gitignore 忽略的。
  // 两者合起来才是「提交后会被发布」的完整集合——只用 --cached 会漏掉刚新建、
  // 还没 git add 的文件，而那恰恰是最需要提醒的时刻。
  tracked = execFileSync(
    'git', ['ls-files', '--cached', '--others', '--exclude-standard'],
    { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
  ).split(/\r?\n/).filter(Boolean);
} catch {
  warnings.push('无法执行 git ls-files，跳过开发产物屏蔽覆盖率检查（非 git 仓库环境）。');
}

const uncovered = [];
for (const file of tracked) {
  const p = file.replace(/\\/g, '/');
  if (isSiteContent(p)) continue;

  const urlPath = '/' + p;
  const rule = resolveRedirect(redirectRules, urlPath);
  if (!rule) { uncovered.push(p); continue; }
  // 只有真正的「重定向走」才算屏蔽；200 是代理，仍会把内容送出去
  if (rule.code === 200) uncovered.push(`${p}  （被 ${rule.line} 以 200 代理，内容仍会被返回）`);
}

if (uncovered.length) {
  errors.push(
    `以下 ${uncovered.length} 个 git 跟踪的文件不属于站点内容，但未被 _redirects 屏蔽，` +
    `上线后可被公网直接访问：\n` +
    uncovered.map(u => '        · ' + u).join('\n')
  );
}

/* ------------------------------------------------------------------ *
 * 输出
 * ------------------------------------------------------------------ */

const devCount = tracked.filter(p => !isSiteContent(p.replace(/\\/g, '/'))).length;

console.log('部署配置检查（_headers / _redirects）');
console.log('─'.repeat(64));
console.log(`_headers 规则      : ${headerRules.length}`);
console.log(`_redirects 规则    : ${redirectRules.filter(r => !r.invalid).length}`);
console.log(`将被发布的文件     : ${tracked.length}（其中非站点内容 ${devCount} 个）`);
console.log('─'.repeat(64));

if (errors.length) {
  console.log(`\n错误 ${errors.length} 项：`);
  errors.forEach(e => console.log('  ✗ ' + e));
}
if (warnings.length) {
  console.log(`\n警告 ${warnings.length} 项：`);
  warnings.forEach(w => console.log('  ! ' + w));
}
if (!errors.length && !warnings.length) {
  console.log('\n全部检查通过。');
}
console.log('');
process.exit(errors.length ? 1 : 0);
