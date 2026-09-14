import { test, expect } from '@playwright/test';
import { allPages, callHookWithFile, readFixture } from './helpers.js';

/**
 * 把「文件不上传、不请求第三方」这条核心卖点变成可自动验证的约束。
 * 只要将来有人重新引入 CDN 引用或埋点，这里就会失败。
 */

test.describe('隐私承诺', () => {
  test('浏览全部页面不会向任何第三方发起请求', async ({ page }) => {
    const external = [];
    page.on('request', (req) => {
      const url = req.url();
      if (/^https?:/i.test(url) && !url.startsWith('http://127.0.0.1:')) {
        external.push(`${req.resourceType()} ${url}`);
      }
    });

    for (const p of allPages()) {
      await page.goto('/' + p, { waitUntil: 'load' });
      await page.waitForTimeout(120);
    }

    expect(external, '检测到对外请求：\n' + external.join('\n')).toEqual([]);
  });

  test('所有外部资源引用都指向本站', async ({ page }) => {
    for (const p of allPages()) {
      await page.goto('/' + p);
      const srcs = await page.$$eval('script[src]', els => els.map(e => e.getAttribute('src')));
      for (const s of srcs) {
        expect(/^(https?:)?\/\//.test(s), `${p} 引用了外部脚本 ${s}`).toBe(false);
      }
      const extStyles = await page.$$eval('link[rel=stylesheet]', els => els.map(e => e.getAttribute('href')));
      for (const s of extStyles) {
        expect(/^(https?:)?\/\//.test(s), `${p} 引用了外部样式 ${s}`).toBe(false);
      }
    }
  });

  test('pdf.js 的 worker 也走本地路径', async ({ page }) => {
    await page.goto('/tools/pdf-to-docx.html');
    const worker = await page.evaluate(() => window.pdfjsLib.GlobalWorkerOptions.workerSrc);
    expect(worker).toContain('/assets/vendor/');
    expect(worker).not.toMatch(/^https?:/);
  });

  test('解析 PDF 期间也不会产生对外请求', async ({ page }) => {
    await page.goto('/tools/pdf-to-docx.html');
    const external = [];
    page.on('request', (req) => {
      const url = req.url();
      if (/^https?:/i.test(url) && !url.startsWith('http://127.0.0.1:')) external.push(url);
    });

    const { base64 } = readFixture('sample.pdf');
    await page.evaluate(async ({ b64 }) => {
      const bin = atob(b64);
      const arr = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      await window.__lkConvert([new File([arr], 'sample.pdf', { type: 'application/pdf' })]);
    }, { b64: base64 });

    expect(external, 'PDF 解析触发了对外请求：' + external.join(', ')).toEqual([]);
  });
});

test.describe('离线可用', () => {
  test('断网后纯计算型工具照常工作', async ({ page, context }) => {
    await page.goto('/tools/hash-calculator.html');
    await page.click('#langBtn');              // 确保 i18n 已初始化
    await context.setOffline(true);

    const out = await page.evaluate(() => window.__lkHash('abc'));
    expect(out.MD5).toBe('900150983cd24fb0d6963f7d28e17f72');

    await context.setOffline(false);
  });

  test('断网后基于 Canvas 的图片压缩照常工作', async ({ page, context }) => {
    await page.goto('/tools/compress-image.html');
    await context.setOffline(true);

    const n = await callHookWithFile(page, '__lkProcess', 'sample.png', 'image/png');
    expect(n).toBe(1);
    await expect(page.locator('#results .result-item')).toHaveCount(1);

    await context.setOffline(false);
  });
});

test.describe('输出转义（innerHTML 注入回归）', () => {
  test('带 HTML 的文件名只作为文本显示，不会被解析成标签', async ({ page }) => {
    await page.goto('/tools/compress-image.html');

    const evil = '<img src=x onerror="window.__xss=1">.png';
    const { base64 } = readFixture('sample.png');

    await page.evaluate(async ({ b64, name }) => {
      const bin = atob(b64);
      const arr = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      await window.__lkProcess([new File([arr], name, { type: 'image/png' })]);
    }, { b64: base64, name: evil });

    await expect(page.locator('#results .result-item')).toHaveCount(1);

    // 结果区不应出现被注入的元素，全局标记也不应被写入
    expect(await page.locator('#results img').count(), '结果区不应出现注入的 img 元素').toBe(0);
    expect(await page.evaluate(() => window.__xss)).toBeUndefined();

    // 文件名应以原文形式呈现为文本
    const shown = await page.locator('#results .name').first().textContent();
    expect(shown).toContain('<img');
  });

  test('带引号与 & 的文件名同样被安全处理', async ({ page }) => {
    await page.goto('/tools/compress-image.html');
    const { base64 } = readFixture('sample.png');
    const evil = `a"b'c&d.png`;

    await page.evaluate(async ({ b64, name }) => {
      const bin = atob(b64);
      const arr = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      await window.__lkProcess([new File([arr], name, { type: 'image/png' })]);
    }, { b64: base64, name: evil });

    // 默认输出格式为「与原文件相同」，因此产出名带 -min 后缀
    const shown = await page.locator('#results .name').first().textContent();
    expect(shown).toBe(`a"b'c&d-min.png`);
  });
});
