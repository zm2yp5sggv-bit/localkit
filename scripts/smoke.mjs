#!/usr/bin/env node
/**
 * 生产站点冒烟检查：直接探测线上环境，断言「我们声明的」与「实际生效的」一致。
 *
 * 为什么需要它：仓库里的检查（check:i18n / check:syntax / check:deploy）只能看到仓库，
 * 看不到线上。而本项目已经踩过两次「仓库是对的、线上不是」的坑：
 *   1. 所有非 HTML 静态资源的 Cache-Control 被 Cloudflare 的区域设置
 *      （Browser Cache TTL，默认 4 小时）覆盖掉，仓库声明的 max-age=0 根本没生效
 *      → 每次部署后最长 4 小时内，返回访客拿到「新 HTML + 旧字典」，
 *        页面直接显示出 footer.privacy 这类 i18n 键名。
 *   2. Cloudflare 的 Web Analytics 开启后会由边缘自动注入 beacon.min.js，
 *      与「零第三方脚本」的承诺冲突——这东西在仓库里根本不存在，只能靠线上探测发现。
 * 这两类问题都是在控制台改出来的，没有版本控制，因此必须定期探测。
 *
 * 用法：
 *   node scripts/smoke.mjs                 全量检查
 *   node scripts/smoke.mjs --only cache    只跑某一组（可用组名见末尾提示）
 *
 * 环境变量：
 *   LK_SITE  站点根地址，默认 https://youngray.asia
 *   LK_ROOT  仓库根目录，默认脚本上一级（用于读取 _headers 的声明值）
 *
 * 退出码：0 = 全部通过，1 = 有失败项
 */

import fs from 'node:fs';
import path from 'node:path';
import { parseHeaders, resolveHeaders } from './lib/deploy-config.mjs';

const ROOT = process.env.LK_ROOT
  ? path.resolve(process.env.LK_ROOT)
  : path.resolve(import.meta.dirname, '..');
const SITE = (process.env.LK_SITE || 'https://youngray.asia').replace(/\/$/, '');
const SITE_HOST = new URL(SITE).host;

const onlyArg = process.argv.indexOf('--only');
const ONLY = onlyArg !== -1 ? process.argv[onlyArg + 1] : null;

const failures = [];
let checks = 0;

const ok = (group, name, detail) => {
  checks++;
  console.log(`  ✓ [${group}] ${name}${detail ? '  — ' + detail : ''}`);
};
const bad = (group, name, detail) => {
  checks++;
  failures.push({ group, name });
  console.log(`  ✗ [${group}] ${name}\n        ${String(detail).split('\n').join('\n        ')}`);
};

/**
 * 探测一个路径。
 * follow=false 时不跟随重定向（用来看真实状态码与响应头）；
 * follow=true 时跟随到底（用来取最终页面的 HTML 做内容断言）。
 */
async function probe(p, { follow = false } = {}) {
  const res = await fetch(SITE + p, {
    redirect: follow ? 'follow' : 'manual',
    headers: { 'user-agent': 'localkit-smoke/1.0' },
  });
  const contentType = res.headers.get('content-type') || '';
  let body = '';
  if (/text\/html|application\/json|text\/plain/i.test(contentType)) {
    try { body = await res.text(); } catch { /* 忽略 */ }
  }
  return { status: res.status, headers: res.headers, contentType, body, redirected: res.redirected };
}

const groups = [];
const group = (name, fn) => { if (!ONLY || ONLY === name) groups.push({ name, fn }); };

/* ── 1. 关键页面可用（跟随重定向，不隐式依赖 URL 形态） ───────────── */

group('pages', async () => {
  const PAGES = ['/', '/404.html', '/privacy.html', '/about.html',
                 '/tools/hash-calculator.html', '/tools/compress-image.html'];
  for (const p of PAGES) {
    try {
      const r = await probe(p, { follow: true });
      if (r.status !== 200) bad('pages', `${p} 最终状态 ${r.status}`, '期望 200');
      else if (!/text\/html/i.test(r.contentType)) bad('pages', `${p} 的 Content-Type 异常`, r.contentType);
      else ok('pages', `${p} 可访问`, `200 text/html${r.redirected ? '（经重定向）' : ''}`);
    } catch (e) {
      bad('pages', `${p} 请求失败`, e.message);
    }
  }
});

/* ── 2. URL 形态：.html 必须直接返回 200 ───────────────────────────
 * 本项目明确选择「保留 .html 扩展名」（即关闭 Cloudflare Pages 的 Pretty URLs）。
 * 若该开关仍打开，.html 会 308 跳到无扩展名地址，而页面的 canonical 与 sitemap
 * 写的都是 .html —— 等于 canonical 指向了一个「非最终地址」。
 * 这一组失败时，去 Pages 的 Settings → Builds & deployments 关闭 Pretty URLs。
 */

group('urlform', async () => {
  for (const p of ['/privacy.html', '/tools/hash-calculator.html']) {
    const r = await probe(p, { follow: false });
    if (r.status === 200) ok('urlform', `${p} 直接返回 200`, '扩展名形态正确');
    else if ([301, 302, 303, 307, 308].includes(r.status)) {
      bad('urlform', `${p} 被 ${r.status} 重定向`,
        `Location: ${r.headers.get('location') || '(未提供)'}\n` +
        `        → Pretty URLs 仍处于开启状态。请在 Cloudflare Pages 的\n` +
        `          Settings → Builds & deployments 中关闭它。`);
    } else {
      bad('urlform', `${p} 返回 ${r.status}`, '期望 200');
    }
  }
});

/* ── 3. 安全响应头 ───────────────────────────────────────────────── */

group('headers', async () => {
  const r = await probe('/');
  const h = (n) => r.headers.get(n) || '';

  const csp = h('content-security-policy');
  if (csp.includes("connect-src 'none'")) ok('headers', "CSP 含 connect-src 'none'");
  else bad('headers', "CSP 缺少 connect-src 'none'", csp || '(无 CSP)');

  for (const [name, want] of Object.entries({
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    'referrer-policy': 'no-referrer',
    'cross-origin-opener-policy': 'same-origin',
  })) {
    const got = h(name);
    if (got === want) ok('headers', `${name}: ${want}`);
    else bad('headers', `${name} 不符`, `期望 "${want}"，实际 "${got || '(缺失)'}"`);
  }

  // HSTS：必须是单个 max-age。若同时在 _headers 与 Cloudflare 控制台开启，
  // 该响应头会被逗号合并成 "max-age=A, max-age=B"，属非法值浏览器会整条忽略。
  const hsts = h('strict-transport-security');
  if (!hsts) {
    bad('headers', '缺少 Strict-Transport-Security', 'HSTS 未下发，首次请求仍可被 SSL-stripping');
  } else {
    const count = (hsts.match(/max-age=/g) || []).length;
    const val = Number((hsts.match(/max-age=(\d+)/) || [])[1]);
    if (count !== 1) bad('headers', 'HSTS 出现多个 max-age（被逗号合并？）', hsts);
    else if (!(val >= 86400)) bad('headers', 'HSTS max-age 过小', hsts);
    else ok('headers', 'HSTS 取值合法', hsts);
  }
});

/* ── 4. 缓存策略：线上实际值 vs 仓库 _headers 声明值 ──────────────── */

group('cache', async () => {
  const headersPath = path.join(ROOT, '_headers');
  if (!fs.existsSync(headersPath)) { bad('cache', '找不到 _headers', headersPath); return; }
  const rules = parseHeaders(fs.readFileSync(headersPath, 'utf8'));

  const paths = ['/assets/i18n.js', '/assets/app.js', '/assets/style.css',
                 '/assets/vendor/jszip.min.js', '/robots.txt', '/index.html'];

  for (const p of paths) {
    const deployed = resolveHeaders(rules, p);
    const declared = deployed['Cache-Control'] || deployed['cache-control'];
    if (!declared) { bad('cache', `${p} 在 _headers 中没有声明 Cache-Control`, ''); continue; }
    const live = (await probe(p)).headers.get('cache-control') || '(缺失)';
    if (live === declared) ok('cache', `${p} 与声明一致`, live);
    else bad('cache', `${p} 的缓存策略被覆盖`,
      `仓库声明: ${declared}\n` +
      `        线上实际: ${live}\n` +
      `        → 常见原因：Cloudflare 区域的 Browser Cache TTL 覆盖了 max-age，\n` +
      `          且只作用于非 HTML 资源（HTML 不受影响，所以容易被忽略）。\n` +
      `          修复：Caching → Configuration → Browser Cache TTL 设为 "Respect Existing Headers"。`);
  }
});

/* ── 5. 零第三方脚本 ─────────────────────────────────────────────── */

group('thirdparty', async () => {
  const BANNED = /cloudflareinsights|beacon\.min\.js|data-cf-beacon|cdn\.jsdelivr|unpkg\.com|googleapis|gstatic/i;

  // 只查「会被浏览器加载的资源」。刻意不含 <a href>：外链（GitHub Issue、赞助页）
  // 是站点的正常内容，不是第三方脚本——把它们算进来会制造假警报。
  const RESOURCE_TAGS = ['script', 'link', 'img', 'iframe', 'source', 'video', 'audio', 'embed', 'object'];

  for (const p of ['/', '/privacy.html', '/tools/compress-image.html']) {
    const r = await probe(p, { follow: true });
    if (!r.body) { bad('thirdparty', `${p} 未取到 HTML`, r.contentType || '(无 Content-Type)'); continue; }

    const offenders = [];
    const hit = r.body.match(BANNED);
    if (hit) offenders.push('响应体含被禁标识：' + hit[0]);

    let checked = 0;
    for (const tag of RESOURCE_TAGS) {
      const re = new RegExp(`<${tag}\\b[^>]*\\b(?:src|href)="([^"]+)"`, 'gi');
      for (const m of r.body.matchAll(re)) {
        const u = m[1];
        checked++;
        if (/^(data:|blob:|#|\/)/.test(u) || !/^[a-z]+:/i.test(u)) continue;
        let host;
        try { host = new URL(u).host; } catch { continue; }
        if (host && host !== SITE_HOST) offenders.push(`<${tag}> ${u}`);
      }
    }

    if (offenders.length) bad('thirdparty', `${p} 存在外部加载的资源`, offenders.join('\n'));
    else ok('thirdparty', `${p} 无外部加载的资源`, `检查了 ${checked} 个 script/link/img 等引用，全部同源`);
  }
});

/* ── 6. 部署边界：开发产物不得被当作站点资源返回 ──────────────────── */

group('boundary', async () => {
  const cases = [
    ['/package.json', /json/i],
    ['/tests/helpers.js', /javascript/i],
    ['/scripts/vendor.json', /json/i],
    ['/eslint.config.js', /javascript/i],
    ['/tests/fixtures/sample.pdf', /pdf/i],
  ];
  for (const [p, forbidden] of cases) {
    const r = await probe(p, { follow: false });
    if (forbidden.test(r.contentType)) bad('boundary', `${p} 竟以 ${r.contentType} 返回`, '应被 _redirects 拦截');
    else ok('boundary', `${p} 已被拦截`, `HTTP ${r.status}，Content-Type: ${r.contentType.split(';')[0] || '(无)'}`);
  }
});

/* ── 7. canonical 主机与地址形态一致 ─────────────────────────────── */

group('canonical', async () => {
  for (const p of ['/', '/tools/hash-calculator.html']) {
    const r = await probe(p, { follow: true });
    const m = r.body.match(/<link[^>]+rel="canonical"[^>]+href="([^"]+)"/i);
    if (!m) { bad('canonical', `${p} 无 canonical`, '取到的页面里找不到 canonical 标签'); continue; }
    const expected = SITE + (p === '/' ? '/' : p);
    if (m[1] === expected) ok('canonical', `${p} canonical 正确`, m[1]);
    else bad('canonical', `${p} 的 canonical 与站点不一致`, `期望 ${expected}\n        实际 ${m[1]}`);
  }
});

/* ── 执行 ─────────────────────────────────────────────────────────── */

console.log('生产站点冒烟检查');
console.log('─'.repeat(72));
console.log(`目标站点 : ${SITE}`);
console.log(`声明来源 : ${path.join(ROOT, '_headers')}`);
console.log('─'.repeat(72));

const ALL_GROUPS = ['pages', 'urlform', 'headers', 'cache', 'thirdparty', 'boundary', 'canonical'];

if (!groups.length) {
  console.error(`未知的 --only 值: ${ONLY}`);
  console.error('可用分组：' + ALL_GROUPS.join(', '));
  process.exit(1);
}

for (const g of groups) {
  console.log(`\n[${g.name}]`);
  try { await g.fn(); }
  catch (e) { bad(g.name, '分组执行异常', e.message + '\n' + (e.stack || '').split('\n').slice(1, 3).join('\n')); }
}

console.log('\n' + '─'.repeat(72));
if (failures.length) {
  console.log(`失败 ${failures.length} / ${checks} 项`);
  for (const f of failures) console.log(`  ✗ [${f.group}] ${f.name}`);
} else {
  console.log(`全部通过（${checks} 项）`);
}
console.log('');
process.exit(failures.length ? 1 : 0);
