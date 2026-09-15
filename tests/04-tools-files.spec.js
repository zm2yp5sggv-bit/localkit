import { test, expect } from '@playwright/test';
import { callHookWithFile, expectCount, readFixture } from './helpers.js';

/**
 * 文件处理型工具：用 tests/fixtures 下自造的 PNG / PDF / DOCX 真实跑一遍处理链路。
 * 夹具由 tests/fixtures/make-fixtures.mjs 生成，内容完全可控，不依赖任何外部数据。
 */

/** 收集本次操作触发的下载文件名。 */
function collectDownloads(page) {
  const got = [];
  page.on('download', d => got.push(d.suggestedFilename()));
  return got;
}

/** 在页面里把若干夹具还原成 File 对象。 */
async function injectFiles(page, specs) {
  const payload = specs.map(s => ({
    b64: readFixture(s.file).base64,
    name: s.file,
    type: s.type,
  }));
  return payload;
}

test.describe('图片压缩', () => {
  test('单张 PNG 转 JPEG 后体积确实变小', async ({ page }) => {
    await page.goto('/tools/compress-image.html');
    await page.selectOption('#format', 'image/jpeg');
    // 夹具是高频条纹图，JPEG 在高质量下未必比 PNG 小；显式压低质量以确保确有压缩收益
    await page.locator('#quality').evaluate((el) => {
      el.value = '40';
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });

    const n = await callHookWithFile(page, '__lkProcess', 'sample.png', 'image/png');
    expect(n).toBe(1);

    await expect(page.locator('#results .result-item')).toHaveCount(1);
    // .saved 只在确有压缩收益时才渲染，它的存在即说明体积真的变小了
    await expect(page.locator('#results .saved')).toHaveCount(1);
    await expect(page.locator('#results .name')).toContainText('.jpg');
  });

  test('批量输入两张图片逐张产出结果', async ({ page }) => {
    await page.goto('/tools/compress-image.html');
    const payload = await injectFiles(page, [
      { file: 'sample.png', type: 'image/png' },
      { file: 'sample-wide.png', type: 'image/png' },
    ]);

    const n = await page.evaluate(async (items) => {
      const files = items.map(({ b64, name, type }) => {
        const bin = atob(b64);
        const arr = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
        return new File([arr], name, { type });
      });
      return await window.__lkProcess(files);
    }, payload);

    expect(n).toBe(2);
    await expect(page.locator('#results .result-item')).toHaveCount(2);
  });
});

/* ------------------------------------------------------------------ *
 * 输出命名与真实编码格式的一致性
 *
 * 背景：浏览器 canvas 只能编码 JPEG / WebP / PNG。把 GIF、BMP 这类格式交给
 * canvas.toBlob() 时它**会静默回退成 PNG**——实测确认：请求 image/gif 得到的是
 * image/png。因此输出文件的扩展名必须由「可编码白名单」推导，而不是照抄输入类型。
 * 修复前这里的兜底值是 'img'，GIF/BMP 会产出 xxx-min.img 这种文件。
 * ------------------------------------------------------------------ */

test.describe('图片压缩 · 输出命名', () => {
  /** 跑一次压缩并取回结构化结果（含 blob 的真实 MIME 类型）。 */
  async function compress(page, fixture, mime, format) {
    await page.goto('/tools/compress-image.html');
    if (format) await page.selectOption('#format', format);
    const n = await callHookWithFile(page, '__lkProcess', fixture, mime);
    const results = await page.evaluate(() => window.__lkResults());
    return { n, results };
  }

  test('GIF 输入（默认保持原格式）输出为 .png 而不是 .img', async ({ page }) => {
    const { n, results } = await compress(page, 'sample.gif', 'image/gif');
    expect(n).toBe(1);

    const r = results[0];
    expect(r.outName, 'GIF 无法被 canvas 编码，应替换为 PNG').toMatch(/\.png$/);
    expect(r.outName.endsWith('.img'), '不得再出现 .img 兜底名').toBe(false);
    expect(r.type, 'blob 的真实类型必须是 PNG').toBe('image/png');
    expect(r.substituted, '应标记发生了格式替换').toBe(true);

    // 界面上要能看到这次替换的说明
    await expect(page.locator('#results .subst'), '应显示替换说明').toHaveCount(1);
  });

  test('BMP 输入（默认保持原格式）输出为 .png 且类型为 PNG', async ({ page }) => {
    const { n, results } = await compress(page, 'sample.bmp', 'image/bmp');
    expect(n).toBe(1);

    const r = results[0];
    expect(r.outName).toMatch(/\.png$/);
    expect(r.type).toBe('image/png');
    expect(r.substituted).toBe(true);
  });

  test('PNG 输入（默认保持原格式）输出为 -min.png 且不发生替换', async ({ page }) => {
    const { n, results } = await compress(page, 'sample.png', 'image/png');
    expect(n).toBe(1);

    const r = results[0];
    expect(r.outName).toMatch(/-min\.png$/);
    expect(r.type).toBe('image/png');
    expect(r.substituted).toBe(false);

    // 未发生替换时不应出现替换说明（防止提示条件写反）
    await expect(page.locator('#results .subst')).toHaveCount(0);
  });

  test('PNG 输入、显式选择 JPEG 时输出 .jpg 且不带 -min 后缀', async ({ page }) => {
    const { n, results } = await compress(page, 'sample.png', 'image/png', 'image/jpeg');
    expect(n).toBe(1);

    const r = results[0];
    expect(r.outName).toMatch(/\.jpg$/);
    expect(r.outName).not.toContain('-min');
    expect(r.type).toBe('image/jpeg');
    expect(r.substituted).toBe(false);
  });
});

test.describe('图片格式转换', () => {
  test('PNG 转 WebP 输出扩展名正确', async ({ page }) => {
    await page.goto('/tools/convert-image.html');
    await page.selectOption('#format', 'image/webp');

    const n = await callHookWithFile(page, '__lkProcess', 'sample.png', 'image/png');
    expect(n).toBe(1);

    await expect(page.locator('#results .result-item')).toHaveCount(1);
    await expect(page.locator('#results .name')).toContainText('.webp');
  });

  test('限制最大边后仍能产出结果', async ({ page }) => {
    await page.goto('/tools/convert-image.html');
    await page.selectOption('#format', 'image/png');
    await page.fill('#maxDim', '64');

    await callHookWithFile(page, '__lkProcess', 'sample-wide.png', 'image/png');
    await expect(page.locator('#results .result-item')).toHaveCount(1);
    expect(await page.locator('#results .meta').first().textContent()).toMatch(/→/);
  });
});

test.describe('图片批量水印', () => {
  test('加文字水印后产出结果并显示缩略图', async ({ page }) => {
    await page.goto('/tools/image-watermark.html');
    await callHookWithFile(page, '__lkProcess', 'sample.png', 'image/png');

    await expectCount(page.locator('#results .result-item'), 1, '应产出一个结果条目');
    await expect(page.locator('#results .result-item img')).toBeVisible();
    await expect(page.locator('#results .name').first()).toBeVisible();
  });
});

test.describe('PDF 合并', () => {
  test('两个 PDF 合并为一个文件并触发下载', async ({ page }) => {
    await page.goto('/tools/merge-pdf.html');
    const downloads = collectDownloads(page);
    const payload = await injectFiles(page, [
      { file: 'sample.pdf', type: 'application/pdf' },
      { file: 'table.pdf', type: 'application/pdf' },
    ]);

    const n = await page.evaluate(async (items) => {
      const files = items.map(({ b64, name, type }) => {
        const bin = atob(b64);
        const arr = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
        return new File([arr], name, { type });
      });
      return await window.__lkProcess(files);
    }, payload);

    expect(n).toBe(2);
    expect(downloads.length, '应触发下载').toBeGreaterThan(0);
    expect(downloads[0]).toMatch(/\.pdf$/i);
  });
});

test.describe('PDF 拆分', () => {
  test('识别出 2 页并产出结果', async ({ page }) => {
    await page.goto('/tools/split-pdf.html');
    const downloads = collectDownloads(page);

    const pages = await callHookWithFile(page, '__lkProcess', 'sample.pdf', 'application/pdf');
    expect(pages).toBe(2);
    expect(downloads.length).toBeGreaterThan(0);
    expect(downloads[0]).toMatch(/\.(pdf|zip)$/i);
  });
});

test.describe('PDF 转图片', () => {
  test('2 页 PDF 渲染出 2 张图片', async ({ page }) => {
    await page.goto('/tools/pdf-to-image.html');
    await callHookWithFile(page, '__lkProcess', 'sample.pdf', 'application/pdf');

    await expectCount(page.locator('#results .result-item'), 2, '2 页应渲染出 2 张图片');
  });
});

test.describe('PDF 转 Word', () => {
  /** __lkConvert 返回的 summary 里带 Blob，无法直接跨进程序列化，这里只取可序列化字段。 */
  async function convertPdf(page, fixture) {
    const { base64 } = readFixture(fixture);
    return page.evaluate(async ({ b64, name }) => {
      const bin = atob(b64);
      const arr = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      const file = new File([arr], name, { type: 'application/pdf' });
      const s = await window.__lkConvert([file]);
      return {
        pages: s.pages,
        paras: s.paras,
        tables: s.tables,
        gridTables: s.gridTables,
        images: s.images,
        firstGrid: s.firstGrid,
        sampleCellText: s.sampleCellText || [],
        texts: s.texts || [],
        blobSize: s.blob ? s.blob.size : 0,
      };
    }, { b64: base64, name: fixture });
  }

  test('纯文本 PDF 产出段落与可下载的 docx', async ({ page }) => {
    await page.goto('/tools/pdf-to-docx.html');
    const summary = await convertPdf(page, 'sample.pdf');

    expect(summary.pages).toBe(2);
    expect(summary.paras).toBeGreaterThan(0);
    expect(summary.blobSize, 'dryRun 也应生成 docx blob').toBeGreaterThan(0);
    expect(summary.texts.join(' ')).toContain('LocalKit sample PDF');
  });

  test('带框线表格的 PDF 被识别为真正的 Word 表格', async ({ page }) => {
    await page.goto('/tools/pdf-to-docx.html');
    const summary = await convertPdf(page, 'table.pdf');

    expect(summary.gridTables, '应识别出至少一个矢量网格表格').toBeGreaterThanOrEqual(1);
    expect(summary.firstGrid, '应能取到表格前几行文本').toBeTruthy();
    const cells = summary.sampleCellText.join(' ');
    expect(cells).toContain('Region');
    expect(cells).toContain('Revenue');
    expect(cells).toContain('North');
    expect(cells).toContain('1200');
  });

  test('非 PDF 输入被拒绝且不启用转换按钮', async ({ page }) => {
    await page.goto('/tools/pdf-to-docx.html');
    await page.setInputFiles('#fileInput', {
      name: 'not-a-pdf.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('hello'),
    });
    await expect(page.locator('.status')).toContainText(/PDF/i);
    await expect(page.locator('#runBtn')).toBeDisabled();
  });
});

test.describe('DOCX 转 PDF', () => {
  test('夹具文档可渲染并导出为 PDF', async ({ page }) => {
    await page.goto('/tools/docx-to-pdf.html');

    const pages = await callHookWithFile(page, '__lkProcess', 'sample.docx',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document');

    expect(pages, '至少转换出 1 页').toBeGreaterThanOrEqual(1);
  });
});
