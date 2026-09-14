/**
 * 测试公共工具。不是测试文件本身，不匹配 Playwright 的 testMatch。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from '@playwright/test';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const FIXTURES = path.join(ROOT, 'tests', 'fixtures');

/**
 * 不应被搜索引擎收录的页面。
 * 404.html 由 Cloudflare Pages 在未找到路径时自动返回，必须带 noindex 且不进 sitemap。
 */
export const NON_INDEXABLE = ['404.html'];

/** 全站页面清单：站点页 + 错误页 + tools/ 下全部工具页。用于逐页健康检查。 */
export function allPages() {
  const site = ['index.html', 'about.html', 'privacy.html', 'donate.html', ...NON_INDEXABLE];
  const tools = fs.readdirSync(path.join(ROOT, 'tools'))
    .filter(f => f.endsWith('.html'))
    .sort()
    .map(f => 'tools/' + f);
  return [...site, ...tools];
}

/** 应当出现在 sitemap.xml 中的页面（即全站页面减去不可收录的那些）。 */
export function indexablePages() {
  return allPages().filter(p => !NON_INDEXABLE.includes(p));
}

/** 读取夹具并转成 base64，便于传进浏览器上下文。 */
export function readFixture(name) {
  const buf = fs.readFileSync(path.join(FIXTURES, name));
  return { base64: buf.toString('base64'), bytes: buf.length };
}

/**
 * 在页面里把夹具还原成 File 对象，再调用指定的 window.__lk* 测试钩子。
 * 返回钩子的原始返回值（经 Playwright 序列化）。
 */
export async function callHookWithFile(page, hook, fixture, mime) {
  const { base64 } = readFixture(fixture);
  return page.evaluate(async ({ b64, name, type, hookName }) => {
    const bin = atob(b64);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    const files = [new File([arr], name, { type })];
    const fn = window[hookName];
    if (typeof fn !== 'function') throw new Error('缺少测试钩子 ' + hookName);
    return await fn(files);
  }, { b64: base64, name: fixture, type: mime, hookName: hook });
}

/**
 * 监听并记录页面发出的每一个请求。
 * 返回 { requests, external } —— external 为所有非本站来源的请求。
 */
export function recordRequests(page) {
  const requests = [];
  page.on('request', (req) => {
    requests.push({ url: req.url(), type: req.resourceType() });
  });
  return {
    requests,
    external() {
      const origin = new URL(page.url() || 'http://127.0.0.1/').origin;
      return requests.filter(r =>
        /^https?:/i.test(r.url) && !r.url.startsWith(origin)
      );
    },
  };
}

/**
 * 在后续所有导航中预置语言偏好。
 * 语言选择存在 localStorage，同一个 page 上连续访问多个页面会互相污染，
 * 因此需要显式指定而不是靠点击按钮来回切。
 */
export async function setLang(page, lang) {
  await page.addInitScript((l) => {
    try { localStorage.setItem('lk-lang', l); } catch (e) { /* 隐私模式下可能不可用 */ }
  }, lang);
}

/**
 * 取页面上真正可见的文本。
 *
 * 必须先把所有 <details> 展开：innerText 会跳过折叠元素的内容，
 * 而本站的 FAQ 答案是写在 <details> 里的，直接读 innerText 会漏掉整段文案。
 * 不用 textContent 是因为它会把 <script> 的源码也算进去。
 */
export async function visibleText(page) {
  await page.evaluate(() => {
    document.querySelectorAll('details').forEach((d) => { d.open = true; });
  });
  return page.evaluate(() => document.body.innerText);
}

/**
 * 等待结果区出现预期数量的条目。
 *
 * 注意：不能用 page.waitForFunction —— 站点下发的 CSP 不含 'unsafe-eval'，
 * 而 waitForFunction 的轮询实现依赖 eval，会直接抛 CSP 错误。
 * 基于 locator 的断言由 Playwright 在页面外驱动，不受页面 CSP 约束，
 * 因此这里统一用它。为了测试方便去放开 'unsafe-eval' 是本末倒置。
 */
export async function expectCount(locator, n, message) {
  await expect(locator, message).toHaveCount(n);
}
