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

test.describe('部署边界', () => {
  // Cloudflare Pages 以仓库根目录作为发布目录，开发产物默认会被公开服务。
  // 线上实测过 /tests/fixtures/sample.pdf 以 application/pdf 正常返回。
  // _redirects 负责拦掉它们，这里从行为上验证拦截确实生效。
  const DEV_PATHS = [
    ['/package.json', /json/i],
    ['/package-lock.json', /json/i],
    ['/playwright.config.js', /javascript/i],
    ['/eslint.config.js', /javascript/i],
    ['/scripts/vendor.json', /json/i],
    ['/tests/helpers.js', /javascript/i],
    ['/tests/fixtures/sample.pdf', /pdf/i],
    ['/README.md', /markdown/i],
  ];

  for (const [devPath, forbiddenType] of DEV_PATHS) {
    test(`${devPath} 不得作为站点资源返回`, async ({ request }) => {
      const res = await request.get(devPath);
      const contentType = res.headers()['content-type'] || '';
      expect(
        forbiddenType.test(contentType),
        `${devPath} 竟然以 ${contentType} 返回了内容`
      ).toBe(false);
    });
  }

  test('站点自身资源仍应正常服务（避免拦截规则误伤）', async ({ request }) => {
    for (const [p, type] of [
      ['/index.html', /html/],
      ['/assets/style.css', /css/],
      ['/assets/app.js', /javascript/],
      ['/assets/vendor/jszip.min.js', /javascript/],
      ['/robots.txt', /plain/],
      ['/sitemap.xml', /xml/],
    ]) {
      const res = await request.get(p);
      expect(res.status(), `${p} 应可访问`).toBe(200);
      expect(res.headers()['content-type'] || '', `${p} 的 Content-Type 不符`).toMatch(type);
    }
  });

  test('响应头不得出现被逗号合并的同名指令', async ({ request }) => {
    // Cloudflare 对多条规则命中的同名响应头是「逗号合并」。曾经 _headers 里三条规则
    // 都设置 Cache-Control，导致指令串里出现两个互相冲突的 max-age。
    for (const p of ['/index.html', '/assets/app.js', '/assets/vendor/jszip.min.js']) {
      const res = await request.get(p);
      const cc = res.headers()['cache-control'] || '';
      const maxAgeCount = (cc.match(/max-age/g) || []).length;
      expect(maxAgeCount, `${p} 的 Cache-Control 出现了多个 max-age: ${cc}`).toBeLessThanOrEqual(1);
    }
  });

  test('安全响应头仍正常下发', async ({ request }) => {
    const res = await request.get('/index.html');
    const csp = res.headers()['content-security-policy'] || '';
    expect(csp).toContain("connect-src 'none'");
    expect(res.headers()['x-content-type-options']).toBe('nosniff');
    expect(res.headers()['referrer-policy']).toBe('no-referrer');
  });
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
