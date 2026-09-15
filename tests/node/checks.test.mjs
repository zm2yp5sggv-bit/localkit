/**
 * 校验脚本的自测：用「坏样本」证明它们真的会报错。
 *
 * 为什么需要这一层：scripts/ 下的检查脚本是整条质量链的裁判，如果裁判本身写错了，
 * 它会静默地给出「全部通过」——这比没有检查更危险，因为会制造虚假的安全感。
 * 本项目就出过一次：check-i18n 的死键检测把字典文件自己也纳入了搜索范围，
 * 导致每个键都「自己引用自己」，检查永远通过。
 *
 * 因此这里的每个用例都是「先注入一个已知缺陷，再断言脚本失败」。
 * 只断言「干净仓库能通过」是不够的——那种断言对永远返回 0 的脚本同样成立。
 *
 * 运行：npm run test:checks      （等价于 node --test tests/node/）
 */

import { test, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';

const SRC = path.resolve(import.meta.dirname, '..', '..');
const SKIP_DIRS = new Set(['.git', 'node_modules', 'test-results', 'playwright-report', 'blob-report']);

/** 会被用例改动的文件，每个用例结束后从源仓库恢复。 */
const VOLATILE = [
  'assets/i18n.js',
  'assets/app.js',
  'index.html',
  '404.html',
  'sitemap.xml',
  'tools/hash-calculator.html',
  '_headers',
  '_redirects',
  'assets/vendor/md5.min.js',
];

let WORK;

function copyFileFresh(rel) {
  const from = path.join(SRC, rel);
  const to = path.join(WORK, rel);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
}

function copyTree(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    if (SKIP_DIRS.has(e.name)) continue;
    const s = path.join(from, e.name);
    const d = path.join(to, e.name);
    if (e.isDirectory()) copyTree(s, d);
    else fs.copyFileSync(s, d);
  }
}

/** 在临时副本里跑一个校验脚本，返回退出码与合并输出。 */
function run(script, args = []) {
  const file = path.join(WORK, 'scripts', script);
  try {
    const out = execFileSync(process.execPath, [file, ...args], {
      cwd: WORK,
      env: { ...process.env, LK_ROOT: WORK },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { code: 0, out };
  } catch (e) {
    return { code: e.status ?? 1, out: String(e.stdout || '') + String(e.stderr || '') };
  }
}

/** 修改临时副本里的一个文本文件。 */
function patch(rel, fn) {
  const p = path.join(WORK, rel);
  fs.writeFileSync(p, fn(fs.readFileSync(p, 'utf8')), 'utf8');
}

before(() => {
  WORK = fs.mkdtempSync(path.join(os.tmpdir(), 'localkit-checks-'));
  copyTree(SRC, WORK);
  // check-deploy 用 git ls-files 判断「哪些文件会被发布」，因此副本需要是一个 git 仓库
  execFileSync('git', ['init', '-q'], { cwd: WORK });
  execFileSync('git', ['add', '-A'], { cwd: WORK });
});

after(() => {
  try { fs.rmSync(WORK, { recursive: true, force: true }); } catch { /* Windows 偶发占用，忽略 */ }
});

beforeEach(() => VOLATILE.forEach(copyFileFresh));
afterEach(() => VOLATILE.forEach(copyFileFresh));

/* ================================================================== *
 * 前置断言：干净副本必须全部通过
 * 如果这一条失败，说明基线本身有问题，后面所有「注入缺陷后失败」的结论都不可信。
 * ================================================================== */

test('基线：干净副本上四个校验脚本全部通过', () => {
  for (const [script, args] of [
    ['check-i18n.mjs', []],
    ['check-syntax.mjs', []],
    ['check-deploy.mjs', []],
    ['update-vendor.mjs', ['--check']],
  ]) {
    const r = run(script, args);
    assert.equal(r.code, 0, `${script} 在干净副本上应通过，实际退出码 ${r.code}\n${r.out}`);
  }
});

/* ================================================================== *
 * check-i18n.mjs
 * ================================================================== */

test('check-i18n 能查出「静态文案与字典英文不一致」', () => {
  patch('index.html', s => s.replace(
    'no “premium” upsells',
    'no “premium” add-ons'
  ));
  const r = run('check-i18n.mjs');
  assert.equal(r.code, 1, '应报错退出');
  assert.match(r.out, /静态文案与字典英文不一致/, '错误信息应指出文案不一致');
  assert.match(r.out, /index\.why3\.d/, '应定位到具体词条');
});

test('check-i18n 能查出「中文缺词条」', () => {
  // 中文字典里多个键写在同一行，这里只摘掉其中一个键值对
  patch('assets/i18n.js', s => s.replace(", 'nav.privacy': '隐私政策'", ''));
  const r = run('check-i18n.mjs');
  assert.equal(r.code, 1, '应因中英键数不等而失败\n' + r.out);
  assert.match(r.out, /nav\.privacy/, '应指出缺失的键');
  assert.match(r.out, /缺少中文/, '应说明是中文侧缺失');
});

test('check-i18n 能查出「引用了不存在的键」', () => {
  patch('index.html', s => s.replace('data-i18n="index.why.h2"', 'data-i18n="index.why.nope"'));
  const r = run('check-i18n.mjs');
  assert.equal(r.code, 1);
  assert.match(r.out, /未定义的键|悬空/, '应指出悬空引用');
});

test('check-i18n 能查出死键（作为警告而非错误）', () => {
  patch('assets/i18n.js', s => s.replace(
    "      'nav.tools': 'Tools',",
    "      'zz.deadkey': 'Nobody uses me',\n      'nav.tools': 'Tools',"
  ).replace(
    "      'nav.tools': '工具',",
    "      'zz.deadkey': '没人用我',\n      'nav.tools': '工具',"
  ));
  const r = run('check-i18n.mjs');
  assert.match(r.out, /zz\.deadkey/, '应把死键列为警告');
  assert.match(r.out, /死键/, '应说明是死键');
  assert.equal(r.code, 0, '死键目前只算警告，不应导致失败');
});

test('check-i18n 能查出 data-i18n 的值里含 HTML 实体', () => {
  patch('assets/i18n.js', s => s.replace(
    "'priv.changes.h2': 'Changes',",
    "'priv.changes.h2': 'Changes &amp; notes',"
  ));
  const r = run('check-i18n.mjs');
  assert.equal(r.code, 1);
  assert.match(r.out, /HTML 实体|textContent/, '应指出 textContent 路径不应含实体');
});

/* ================================================================== *
 * check-syntax.mjs
 * ================================================================== */

test('check-syntax 能查出 JavaScript 语法错误', () => {
  patch('assets/app.js', s => s.replace('window.LK = {', 'window.LK = { ,,,'));
  const r = run('check-syntax.mjs');
  assert.equal(r.code, 1);
  assert.match(r.out, /\[语法\]/, '应报语法错误');
  assert.match(r.out, /app\.js/, '应定位到文件');
});

test('check-syntax 能查出残留的第三方 CDN 引用', () => {
  patch('index.html', s => s.replace(
    '</head>',
    '  <script src="https://cdn.jsdelivr.net/npm/foo@1.0.0/foo.min.js"></script>\n</head>'
  ));
  const r = run('check-syntax.mjs');
  assert.equal(r.code, 1);
  assert.match(r.out, /\[外发\]/, '应报外发引用');
  assert.match(r.out, /jsdelivr/, '应指出具体来源');
});

test('check-syntax 能查出指向不存在文件的资源引用', () => {
  patch('index.html', s => s.replace(
    'assets/style.css',
    'assets/style-does-not-exist.css'
  ));
  const r = run('check-syntax.mjs');
  assert.equal(r.code, 1);
  assert.match(r.out, /\[引用\]/, '应报引用缺失');
  assert.match(r.out, /style-does-not-exist\.css/, '应指出具体路径');
});

test('check-syntax 能查出非法的 JSON-LD', () => {
  patch('index.html', s => s.replace('"@context": "https://schema.org"', '"@context" "https://schema.org"'));
  const r = run('check-syntax.mjs');
  assert.equal(r.code, 1);
  assert.match(r.out, /\[JSON-LD\]/, '应报 JSON-LD 解析失败');
});

/* ================================================================== *
 * check-deploy.mjs
 * ================================================================== */

test('check-deploy 能查出 Cloudflare 不支持的重定向状态码', () => {
  patch('_redirects', s => s.replace('/tests/*               /  301', '/tests/*               /  404'));
  const r = run('check-deploy.mjs');
  assert.equal(r.code, 1);
  assert.match(r.out, /不支持的状态码 404/, '应指出状态码不受支持');
});

test('check-deploy 能查出 _headers 中重复设置同名响应头', () => {
  patch('_headers', s => s + '\n/assets/vendor/*\n  Cache-Control: public, max-age=31536000, immutable\n');
  const r = run('check-deploy.mjs');
  assert.equal(r.code, 1);
  assert.match(r.out, /逗号合并/, '应解释合并语义');
  assert.match(r.out, /cache-control/i, '应指出冲突的响应头名');
});

test('check-deploy 允许先用 "! Name" 取消再重新设置', () => {
  patch('_headers', s => s + '\n/assets/vendor/*\n  ! Cache-Control\n  Cache-Control: public, max-age=31536000\n');
  const r = run('check-deploy.mjs');
  assert.equal(r.code, 0, '显式取消应被视为有意为之\n' + r.out);
});

test('check-deploy 能查出发产物未被 _redirects 屏蔽', () => {
  patch('_redirects', s => s.replace('/tests/*               /  301\n', ''));
  const r = run('check-deploy.mjs');
  assert.equal(r.code, 1);
  assert.match(r.out, /未被 _redirects 屏蔽/, '应报覆盖不足');
  assert.match(r.out, /tests\//, '应列出未被覆盖的文件');
});

test('check-deploy 能察觉缺少 CSP', () => {
  patch('_headers', s => s.replace(/^\s*Content-Security-Policy:.*$/m, ''));
  const r = run('check-deploy.mjs');
  assert.equal(r.code, 1);
  assert.match(r.out, /Content-Security-Policy/, '应报缺少 CSP');
});

test('check-deploy 能察觉 _headers 里误加了 C 风格的 */ 收尾', () => {
  // _headers 的 /* 是「匹配所有路径」的通配模式，格式里没有块结束符。
  // 顺手补 */ 会被当成一条模式为 "*/" 的规则。
  patch('_headers', s => s.replace(
    '  Cache-Control: public, max-age=0, must-revalidate\n',
    '  Cache-Control: public, max-age=0, must-revalidate\n*/\n'
  ));
  const r = run('check-deploy.mjs');
  assert.equal(r.code, 1, '应报错退出\n' + r.out);
  assert.match(r.out, /不像 URL 路径/, '应指出模式不是合法路径');
});

/* ================================================================== *
 * check-syntax.mjs —— canonical 与 sitemap 一致性
 *
 * 项目明确选择「保留 .html 扩展名」（Pages 的 Pretty URLs 关闭），
 * 这些用例确保这个决定被脚本锁住，而不是只写在文档里。
 * ================================================================== */

test('check-syntax 能查出 sitemap 里写了带 .html 的地址', () => {
  // 反过来：带 .html 才是错的。Cloudflare Pages 会把 /foo.html 308 跳到 /foo，
  // sitemap 应收录最终地址。
  patch('sitemap.xml', s => s.replace(
    '<loc>https://youngray.asia/tools/hash-calculator</loc>',
    '<loc>https://youngray.asia/tools/hash-calculator.html</loc>'
  ));
  const r = run('check-syntax.mjs');
  assert.equal(r.code, 1, '应报错退出\n' + r.out);
  assert.match(r.out, /带了 \.html 扩展名/, '应指出应当使用无扩展名地址');
});

test('check-syntax 能查出 canonical 与本页地址不一致', () => {
  patch('tools/hash-calculator.html', s => s.replace(
    'href="https://youngray.asia/tools/hash-calculator"',
    'href="https://youngray.asia/tools/sha256"'
  ));
  const r = run('check-syntax.mjs');
  assert.equal(r.code, 1);
  assert.match(r.out, /canonical 与本页地址不一致/, '应指出 canonical 与本页不符');
});

test('check-syntax 能查出 canonical 指向站外地址', () => {
  patch('about.html', s => s.replace(
    'href="https://youngray.asia/about"',
    'href="https://example.com/about"'
  ));
  const r = run('check-syntax.mjs');
  assert.equal(r.code, 1);
  assert.match(r.out, /不是本站地址/, '应指出 canonical 不是本站地址');
});

test('check-syntax 能查出 og:url 与本页地址不一致', () => {
  // 「本页地址」有三处载体，og:url 是其中之一——迁移时最容易漏掉的一处
  patch('index.html', s => s.replace(
    'property="og:url" content="https://youngray.asia/"',
    'property="og:url" content="https://youngray.asia/home"'
  ));
  const r = run('check-syntax.mjs');
  assert.equal(r.code, 1, '应报错退出\n' + r.out);
  assert.match(r.out, /og:url 与本页地址不一致/, '应指出 og:url 与页面地址不符');
});

test('check-syntax 能查出 JSON-LD 的 url 带了 .html', () => {
  patch('tools/hash-calculator.html', s => s.replace(
    '"url": "https://youngray.asia/tools/hash-calculator"',
    '"url": "https://youngray.asia/tools/hash-calculator.html"'
  ));
  const r = run('check-syntax.mjs');
  assert.equal(r.code, 1, '应报错退出\n' + r.out);
  assert.match(r.out, /JSON-LD url 带了 \.html 扩展名/, '应指出结构化数据用了会跳转的地址');
});

test('check-syntax 能查出 sitemap 漏收页面', () => {
  patch('sitemap.xml', s => s.replace(
    '  <url><loc>https://youngray.asia/about</loc><changefreq>yearly</changefreq><priority>0.4</priority></url>\n',
    ''
  ));
  const r = run('check-syntax.mjs');
  assert.equal(r.code, 1);
  assert.match(r.out, /未收录页面/, '应指出漏收的页面');
});

test('check-syntax 能查出错误页被写进 sitemap', () => {
  patch('sitemap.xml', s => s.replace(
    '</urlset>',
    '  <url><loc>https://youngray.asia/404</loc></url>\n</urlset>'
  ));
  const r = run('check-syntax.mjs');
  assert.equal(r.code, 1);
  assert.match(r.out, /不应收录错误页/, '应指出错误页不该进 sitemap');
});

test('check-syntax 能查出错误页缺少 noindex', () => {
  patch('404.html', s => s.replace('<meta name="robots" content="noindex">\n', ''));
  const r = run('check-syntax.mjs');
  assert.equal(r.code, 1);
  assert.match(r.out, /缺少 noindex/, '应指出错误页缺少 noindex');
});

/* ================================================================== *
 * update-vendor.mjs
 * ================================================================== */

test('update-vendor --check 能查出被篡改的依赖文件', () => {
  const p = path.join(WORK, 'assets/vendor/md5.min.js');
  const buf = fs.readFileSync(p);
  buf[buf.length - 2] = buf[buf.length - 2] === 0x20 ? 0x21 : 0x20;   // 改一个字节
  fs.writeFileSync(p, buf);

  const r = run('update-vendor.mjs', ['--check']);
  assert.equal(r.code, 1);
  assert.match(r.out, /哈希不匹配/, '应报哈希不一致');
});

test('update-vendor --check 能查出缺失的依赖文件', () => {
  fs.unlinkSync(path.join(WORK, 'assets/vendor/md5.min.js'));
  const r = run('update-vendor.mjs', ['--check']);
  assert.equal(r.code, 1);
  assert.match(r.out, /文件缺失/, '应报文件缺失');
});
