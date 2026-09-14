import { test, expect } from '@playwright/test';

/**
 * 纯函数型工具：借助各页面已有的 window.__lk* 钩子绕过 UI 直接验证核心逻辑。
 * 断言值都是可独立复算的固定值，不是「跑一遍看结果」式的假测试。
 */

test.describe('哈希计算', () => {
  const KNOWN = {
    MD5: '900150983cd24fb0d6963f7d28e17f72',
    'SHA-1': 'a9993e364706816aba3e25717850c26c9cd0d89d',
    'SHA-256': 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
  };

  test('"abc" 的 MD5 / SHA-1 / SHA-256 与标准值一致', async ({ page }) => {
    await page.goto('/tools/hash-calculator.html');
    const out = await page.evaluate(() => window.__lkHash('abc'));

    for (const [alg, expected] of Object.entries(KNOWN)) {
      expect(out[alg], alg).toBe(expected);
    }
    expect(out['SHA-384']).toMatch(/^[0-9a-f]{96}$/);
    expect(out['SHA-512']).toMatch(/^[0-9a-f]{128}$/);
  });

  test('相同输入的哈希稳定可复现', async ({ page }) => {
    await page.goto('/tools/hash-calculator.html');
    const a = await page.evaluate(() => window.__lkHash('LocalKit'));
    const b = await page.evaluate(() => window.__lkHash('LocalKit'));
    expect(a).toEqual(b);
  });
});

test.describe('Base64 与 URL 编解码', () => {
  test('中文与空格经过 UTF-8 编码后结果正确（Unicode 安全）', async ({ page }) => {
    await page.goto('/tools/base64-converter.html');
    const b64 = await page.evaluate(() => window.__lkB64('Hello 世界', 'b64', 'enc'));
    expect(b64).toBe('SGVsbG8g5LiW55WM');
  });

  test('Base64 解码可还原原文', async ({ page }) => {
    await page.goto('/tools/base64-converter.html');
    const back = await page.evaluate(() => window.__lkB64('SGVsbG8g5LiW55WM', 'b64', 'dec'));
    expect(back).toBe('Hello 世界');
  });

  test('URL 编码对非 ASCII 正确百分号转义', async ({ page }) => {
    await page.goto('/tools/base64-converter.html');
    const enc = await page.evaluate(() => window.__lkB64('Hello 世界', 'url', 'enc'));
    expect(enc).toBe('Hello%20%E4%B8%96%E7%95%8C');
    const dec = await page.evaluate(() => window.__lkB64('Hello%20%E4%B8%96%E7%95%8C', 'url', 'dec'));
    expect(dec).toBe('Hello 世界');
  });

  test('空输入返回空字符串而不是抛错', async ({ page }) => {
    await page.goto('/tools/base64-converter.html');
    expect(await page.evaluate(() => window.__lkB64('', 'b64', 'enc'))).toBe('');
  });
});

test.describe('大小写转换', () => {
  const CASES = [
    ['upper', 'HELLO WORLD FROM LOCAL KIT'],
    ['lower', 'hello world from local kit'],
    ['camel', 'helloWorldFromLocalKit'],
    ['pascal', 'HelloWorldFromLocalKit'],
    ['snake', 'hello_world_from_local_kit'],
    ['kebab', 'hello-world-from-local-kit'],
    ['constant', 'HELLO_WORLD_FROM_LOCAL_KIT'],
  ];

  test('10 种格式中的 7 种输出符合预期', async ({ page }) => {
    await page.goto('/tools/case-converter.html');
    for (const [kind, expected] of CASES) {
      const got = await page.evaluate(
        ({ k }) => window.__lkCase('hello world from local kit', k),
        { k: kind }
      );
      expect(got, kind).toBe(expected);
    }
  });

  test('invert 反转字母大小写', async ({ page }) => {
    await page.goto('/tools/case-converter.html');
    const got = await page.evaluate(() => window.__lkCase('AbC dEf', 'invert'));
    expect(got).toBe('aBc DeF');
  });
});

test.describe('JSON 格式化', () => {
  test('压缩模式输出紧凑 JSON', async ({ page }) => {
    await page.goto('/tools/json-formatter.html');
    const out = await page.evaluate(() => window.__lkJson('{ "b": 1, "a": [1, 2] }', true));
    expect(out).toBe('{"b":1,"a":[1,2]}');
  });

  test('美化模式可被重新解析回等价对象', async ({ page }) => {
    await page.goto('/tools/json-formatter.html');
    const src = '{"nested":{"x":[1,2,3],"y":null},"flag":true}';
    const out = await page.evaluate(({ s }) => window.__lkJson(s, false), { s: src });
    expect(out).toContain('\n');
    expect(JSON.parse(out)).toEqual(JSON.parse(src));
  });

  test('非法 JSON 返回 null 且不抛异常', async ({ page }) => {
    await page.goto('/tools/json-formatter.html');
    const out = await page.evaluate(() => window.__lkJson('{ oops }', true));
    expect(out).toBeNull();
  });
});

test.describe('文本对比', () => {
  test('单行修改产生一增一删', async ({ page }) => {
    await page.goto('/tools/text-diff.html');
    const r = await page.evaluate(() => {
      const res = window.__lkDiff('a\nb\nc', 'a\nB\nc');
      return {
        html: res.html,
        stats: res.stats,
        added: document.querySelectorAll('#output .diff-line.add').length,
        removed: document.querySelectorAll('#output .diff-line.del').length,
      };
    });
    expect(r.added).toBe(1);
    expect(r.removed).toBe(1);
    expect(r.html).toBeGreaterThan(0);
    expect(r.stats.length).toBeGreaterThan(0);
  });

  test('相同文本不产生差异行', async ({ page }) => {
    await page.goto('/tools/text-diff.html');
    const r = await page.evaluate(() => {
      window.__lkDiff('same\nlines', 'same\nlines');
      return {
        added: document.querySelectorAll('#output .diff-line.add').length,
        removed: document.querySelectorAll('#output .diff-line.del').length,
      };
    });
    expect(r.added).toBe(0);
    expect(r.removed).toBe(0);
  });
});

test.describe('文本统计（中日韩感知）', () => {
  test('中英混排的字符、行、段落、句子计数正确', async ({ page }) => {
    await page.goto('/tools/text-statistics.html');
    const r = await page.evaluate(() => window.__lkStat('Hello world.\n\n你好世界。'));
    expect(r.chars).toBe(19);
    // 去掉空白后剩 16：全部 19 个字符中，Hello 与 world 之间的空格加上两个换行共 3 个空白
    expect(r.charsNs).toBe(16);
    expect(r.words).toBe(6);      // 2 个拉丁词 + 4 个汉字
    expect(r.lines).toBe(3);
    expect(r.paras).toBe(2);
    expect(r.sents).toBe(1);      // 只有英文句点被计入（中文句号不算句末标点）
  });

  test('空输入各项为 0', async ({ page }) => {
    await page.goto('/tools/text-statistics.html');
    const r = await page.evaluate(() => window.__lkStat(''));
    expect(r.chars).toBe(0);
    expect(r.words).toBe(0);
    expect(r.lines).toBe(0);
    expect(r.paras).toBe(0);
  });
});

test.describe('时间戳转换', () => {
  test('秒与毫秒都能正确识别', async ({ page }) => {
    await page.goto('/tools/timestamp-converter.html');
    const epoch = await page.evaluate(() => window.__lkTs('0'));
    expect(epoch.iso).toBe('1970-01-01T00:00:00.000Z');

    const ms = await page.evaluate(() => window.__lkTs('1000000000000'));
    expect(ms.iso).toBe('2001-09-09T01:46:40.000Z');

    const sec = await page.evaluate(() => window.__lkTs('1000000000'));
    expect(sec.iso).toBe('2001-09-09T01:46:40.000Z');
  });

  test('非法输入不产生日期（保留占位符，结果面板隐藏）', async ({ page }) => {
    await page.goto('/tools/timestamp-converter.html');
    const r = await page.evaluate(() => window.__lkTs('not-a-number'));
    expect(r.iso).toBe('-');
    await expect(page.locator('#dOut')).toBeHidden();
  });
});

test.describe('颜色转换', () => {
  test('HEX 转 RGB / HSL 正确', async ({ page }) => {
    await page.goto('/tools/color-converter.html');
    const r = await page.evaluate(() => window.__lkColor('#ff0000'));
    expect(r.hex).toBe('#ff0000');
    expect(r.rgb).toBe('rgb(255, 0, 0)');
    expect(r.hsl).toBe('hsl(0, 100%, 50%)');
  });

  test('rgb() 输入可反向解析出 HEX', async ({ page }) => {
    await page.goto('/tools/color-converter.html');
    const r = await page.evaluate(() => window.__lkColor('rgb(0, 128, 255)'));
    expect(r.hex).toBe('#0080ff');
  });

  test('非法颜色返回 null', async ({ page }) => {
    await page.goto('/tools/color-converter.html');
    expect(await page.evaluate(() => window.__lkColor('nope'))).toBeNull();
  });
});

test.describe('UUID 生成', () => {
  test('批量生成 20 个、格式合法且互不重复', async ({ page }) => {
    await page.goto('/tools/uuid-generator.html');
    const list = await page.evaluate(() => window.__lkUuid());
    expect(list.length).toBe(20);
    expect(new Set(list).size).toBe(20);
    for (const u of list) {
      expect(u).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    }
  });
});

test.describe('密码生成', () => {
  test('生成 10 条 16 位密码且互不重复', async ({ page }) => {
    await page.goto('/tools/password-generator.html');
    const list = await page.evaluate(() => window.__lkPw());
    expect(list.length).toBe(10);
    expect(new Set(list).size).toBe(10);
    for (const pw of list) {
      expect(pw.length).toBe(16);
      expect(pw).toMatch(/^[\x21-\x7E]{16}$/);
    }
  });
});

test.describe('JSON 转 TypeScript', () => {
  test('生成根接口与导出类型别名', async ({ page }) => {
    await page.goto('/tools/json-to-typescript.html');
    await page.fill('#input', '{"id":1,"name":"Ada"}');
    await page.click('#runBtn');

    const out = await page.inputValue('#output');
    expect(out).toContain('export interface Root {');
    expect(out).toContain('id: number;');
    expect(out).toContain('name: string;');
    expect(out).toContain('export type RootValue = Root;');
    expect(out.trim().startsWith('export interface Root {')).toBe(true);
  });

  test('非法 JSON 给出错误提示且不产生输出', async ({ page }) => {
    await page.goto('/tools/json-to-typescript.html');
    await page.fill('#input', '{{{');
    await page.click('#runBtn');
    expect(await page.inputValue('#output')).toBe('');
    await expect(page.locator('.status')).not.toHaveText('');
  });
});

test.describe('二维码生成', () => {
  test('输入网址后渲染出 SVG 并可下载', async ({ page }) => {
    await page.goto('/tools/qr-generator.html');
    await page.fill('#content', 'https://localkit.example/check');
    await expect(page.locator('#preview svg')).toBeVisible();
    await expect(page.locator('#dlPng')).toBeEnabled();
    await expect(page.locator('#dlSvg')).toBeEnabled();
  });
});
