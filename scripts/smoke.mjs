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
 *   node scripts/smoke.mjs                      全量检查
 *   node scripts/smoke.mjs --only cache         只跑某一组（可用组名见末尾提示）
 *   node scripts/smoke.mjs --wait 180           等待部署收敛，最多 180 秒（CI 用）
 *
 * 环境变量：
 *   LK_SITE  站点根地址，默认 https://youngray.asia
 *   LK_ROOT  仓库根目录，默认脚本上一级（用于读取 _headers 的声明值）
 *
 * 退出码：0 = 全部通过，1 = 有失败项（用了 --wait 则是预算耗尽后仍失败）
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

// --wait <秒>：等待部署收敛的预算。CI 在 push 后几秒就跑，Cloudflare 常还没部署完，
// 没有这个预算会把「还没部署」误报成「部署错了」。预算耗尽仍失败即判定为真实不一致。
const waitArg = process.argv.indexOf('--wait');
const waitBudget = waitArg !== -1 ? (Number(process.argv[waitArg + 1]) || 0) : 0;

const failures = [];
let checks = 0;
const output = [];

const ok = (group, name, detail) => {
  checks++;
  output.push(`  ✓ [${group}] ${name}${detail ? '  — ' + detail : ''}`);
};
const bad = (group, name, detail) => {
  checks++;
  failures.push({ group, name });
  output.push(`  ✗ [${group}] ${name}\n        ${String(detail).split('\n').join('\n        ')}`);
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

/* ── 2. 地址形态：.html 必须跳转，无扩展名才是最终地址 ─────────────
 * Cloudflare Pages 会把 /foo.html **308 永久重定向**到 /foo，这是平台硬编码行为，
 * 没有配置开关（社区与官方文档均已确认）。所以正确的做法不是去关它，而是顺着它：
 * canonical 与 sitemap 都写无扩展名形式，让「最终地址」唯一。
 * 这一组就是把这个事实固化成断言。
 */

group('urlform', async () => {
  const cases = [
    ['/privacy.html', '/privacy'],
    ['/tools/hash-calculator.html', '/tools/hash-calculator'],
  ];
  for (const [html, pretty] of cases) {
    const a = await probe(html, { follow: false });
    const loc = a.headers.get('location') || '';
    if ([301, 302, 303, 307, 308].includes(a.status) && loc.endsWith(pretty)) {
      ok('urlform', `${html} → ${a.status} ${pretty}`, '平台行为，符合预期');
    } else {
      bad('urlform', `${html} 的重定向行为异常`,
        `状态 ${a.status}，Location: ${loc || '(无)'}\n` +
        `        期望：重定向到 ${pretty}`);
    }

    const b = await probe(pretty, { follow: false });
    if (b.status === 200 && /text\/html/i.test(b.contentType)) {
      ok('urlform', `${pretty} 返回 200`, '最终地址可用');
    } else {
      bad('urlform', `${pretty} 未返回 200`, `实际 ${b.status} ${b.contentType || '(无 Content-Type)'}`);
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
  for (const p of ['/', '/tools/hash-calculator']) {
    const r = await probe(p, { follow: true });
    const m = r.body.match(/<link[^>]+rel="canonical"[^>]+href="([^"]+)"/i);
    if (!m) { bad('canonical', `${p} 无 canonical`, '取到的页面里找不到 canonical 标签'); continue; }

    const expected = SITE + (p === '/' ? '/' : p);
    if (m[1] === expected) ok('canonical', `${p} canonical 正确`, m[1]);
    else bad('canonical', `${p} 的 canonical 与站点不一致`, `期望 ${expected}\n        实际 ${m[1]}`);

    // canonical 必须指向最终地址；带 .html 就意味着指向一个会 308 跳转的中间地址
    if (/\.html$/.test(m[1])) {
      bad('canonical', `${p} 的 canonical 带了 .html 扩展名`,
        `${m[1]}\n        该地址会被 308 跳到无扩展名形式，canonical 应当直接写最终地址。`);
    }
  }
});

/* ── 执行 ─────────────────────────────────────────────────────────── */

const ALL_GROUPS = ['pages', 'urlform', 'headers', 'cache', 'thirdparty', 'boundary', 'canonical'];

if (!groups.length) {
  console.error(`未知的 --only 值: ${ONLY}`);
  console.error('可用分组：' + ALL_GROUPS.join(', '));
  process.exit(1);
}

/** 跑一遍全部分组，把格式化结果写进 output[]。 */
async function sweep() {
  failures.length = 0;
  checks = 0;
  output.length = 0;
  for (const g of groups) {
    output.push(`\n[${g.name}]`);
    try { await g.fn(); }
    catch (e) {
      bad(g.name, '分组执行异常', e.message + '\n' + (e.stack || '').split('\n').slice(1, 3).join('\n'));
    }
  }
  return failures.length;
}

console.log('生产站点冒烟检查');
console.log('─'.repeat(72));
console.log(`目标站点 : ${SITE}`);
console.log(`声明来源 : ${path.join(ROOT, '_headers')}`);
if (waitBudget > 0) console.log(`等待预算 : ${waitBudget}s（用于等部署完成，每 15s 重试一次）`);
console.log('─'.repeat(72));

/* 为什么需要等待：本检查断言的是**已部署**状态，而 CI 在 push 后几秒就开始跑，
 * Cloudflare Pages 往往还没部署完——于是一次「还没部署」被误报成「部署错了」。
 * 实测遇到过一次：push 后 12 秒跑冒烟，canonical 组全红；两分钟后再跑全绿。
 * 因此这里给一个**有界**的等待预算：反复重试直到通过或预算耗尽。
 * 预算耗尽仍失败 = 真的不一致，照常失败——不是把问题掩盖掉。 */
const deadline = Date.now() + waitBudget * 1000;
let attempt = 0;
let failed;   // 循环体至少执行一次，因此无需初值

for (;;) {
  attempt++;
  failed = await sweep();
  if (failed === 0 || Date.now() >= deadline) break;
  const left = Math.round((deadline - Date.now()) / 1000);
  if (left <= 0) break;
  process.stdout.write(`\n第 ${attempt} 次未通过（${failed} 项），等 15s 后重试（剩余预算约 ${left}s）…\n`);
  await new Promise((r) => setTimeout(r, 15_000));
}

if (waitBudget > 0 && attempt > 1) console.log(`\n（共尝试 ${attempt} 次）`);
console.log(output.join('\n'));

console.log('\n' + '─'.repeat(72));
if (failed) {
  console.log(`失败 ${failed} / ${checks} 项`);
  for (const f of failures) console.log(`  ✗ [${f.group}] ${f.name}`);
  if (waitBudget > 0) console.log(`（已用满 ${waitBudget}s 等待预算，判定为真实不一致）`);
} else {
  console.log(`全部通过（${checks} 项）`);
}
console.log('');
process.exit(failed ? 1 : 0);
