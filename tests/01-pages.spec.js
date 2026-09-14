import { test, expect } from '@playwright/test';
import { allPages } from './helpers.js';

const pages = allPages();

test.describe('页面健康检查', () => {
  for (const p of pages) {
    test(`${p} 可加载、无控制台错误、无请求失败`, async ({ page }) => {
      const consoleErrors = [];
      const pageErrors = [];
      const failedRequests = [];

      page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
      page.on('pageerror', e => pageErrors.push(String(e)));
      page.on('requestfailed', r => failedRequests.push(`${r.url()} — ${r.failure()?.errorText || ''}`));

      const res = await page.goto('/' + p, { waitUntil: 'load' });

      expect(res.status(), 'HTTP 状态码').toBe(200);
      await expect(page.locator('header.site-header .logo')).toBeVisible();
      await expect(page.locator('footer.site-footer')).toBeVisible();
      await expect(page.locator('#langBtn')).toBeVisible();
      await expect(page.locator('main')).toBeVisible();

      const title = (await page.title()).trim();
      expect(title.length, '页面标题不应为空').toBeGreaterThan(0);

      expect(pageErrors, '未捕获异常:\n' + pageErrors.join('\n')).toEqual([]);
      expect(consoleErrors, '控制台错误:\n' + consoleErrors.join('\n')).toEqual([]);
      expect(failedRequests, '请求失败:\n' + failedRequests.join('\n')).toEqual([]);
    });
  }
});

test.describe('站点结构完整性', () => {
  test('首页列出了全部 20 个工具卡片', async ({ page }) => {
    await page.goto('/index.html');
    const hrefs = await page.$$eval('.tool-card', els => els.map(e => e.getAttribute('href')));
    const toolHrefs = hrefs.filter(h => h && h.startsWith('tools/')).sort();
    const expected = allPages().filter(p => p.startsWith('tools/')).sort();

    expect(toolHrefs.length, '卡片数量').toBe(20);
    expect(toolHrefs).toEqual(expected);
  });

  test('sitemap.xml 收录了全部页面且 URL 唯一', async ({ request }) => {
    const res = await request.get('/sitemap.xml');
    expect(res.status()).toBe(200);
    const xml = await res.text();
    const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]);

    expect(locs.length).toBe(allPages().length);
    expect(new Set(locs).size, 'URL 不应重复').toBe(locs.length);

    for (const p of allPages()) {
      const suffix = p === 'index.html' ? '/' : '/' + p;
      expect(locs.some(l => l.endsWith(suffix)), `sitemap 缺少 ${p}`).toBeTruthy();
    }
  });

  test('robots.txt 指向 sitemap', async ({ request }) => {
    const res = await request.get('/robots.txt');
    expect(res.status()).toBe(200);
    expect(await res.text()).toContain('Sitemap:');
  });

  test('每个工具页都有唯一的 canonical 与 JSON-LD', async ({ page }) => {
    for (const p of allPages().filter(x => x.startsWith('tools/'))) {
      await page.goto('/' + p);
      const canonical = await page.getAttribute('link[rel=canonical]', 'href');
      expect(canonical, `${p} 缺少 canonical`).toBeTruthy();
      expect(canonical).toContain(p);

      const blocks = await page.$$eval('script[type="application/ld+json"]', els => els.map(e => e.textContent));
      expect(blocks.length, `${p} 应有 JSON-LD`).toBeGreaterThan(0);
      for (const b of blocks) expect(() => JSON.parse(b), `${p} 的 JSON-LD 应为合法 JSON`).not.toThrow();
    }
  });
});
