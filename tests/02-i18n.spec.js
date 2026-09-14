import { test, expect } from '@playwright/test';
import { allPages, setLang, visibleText } from './helpers.js';

test.describe('多语言', () => {
  test('默认按浏览器语言选择，切换后写入 localStorage', async ({ page }) => {
    await page.goto('/index.html');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');

    await page.click('#langBtn');
    await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
    await expect(page.locator('#langBtn')).toHaveText('English');

    // 中文界面下同一句文案应确实变化
    await expect(page.locator('[data-i18n="index.why.h2"]')).toHaveText('LocalKit 有什么不同');

    const stored = await page.evaluate(() => localStorage.getItem('lk-lang'));
    expect(stored).toBe('zh');

    // 刷新后保持中文
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
  });

  test('切换回英文可正常还原', async ({ page }) => {
    await page.goto('/index.html');
    await page.click('#langBtn');
    await page.click('#langBtn');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.locator('[data-i18n="index.why.h2"]')).toHaveText('Why LocalKit is different');
  });

  test('页面标题随语言切换', async ({ page }) => {
    await page.goto('/tools/hash-calculator.html');
    const en = await page.title();
    expect(en.length).toBeGreaterThan(0);
    await page.click('#langBtn');
    const zh = await page.title();
    expect(zh).not.toBe(en);
  });
});

test.describe('输入框占位符翻译（data-i18n-ph 回归）', () => {
  // 曾经的问题：i18n.js 只处理 data-i18n / data-i18n-html，
  // 页面上的 data-i18n-ph 从未生效，6 条翻译成了孤儿词条。
  const CASES = [
    ['tools/base64-converter.html', '#input', '输入要编码的文本，或要解码的编码文本…'],
    ['tools/hash-calculator.html', '#verify', '粘贴期望的哈希值进行比对…'],
    ['tools/image-watermark.html', '#wmText', '© 我的工作室 2026'],
    ['tools/timestamp-converter.html', '#tsIn', '粘贴时间戳（自动识别秒/毫秒）'],
  ];

  for (const [page_, selector, expected] of CASES) {
    test(`${page_} 的 ${selector} 占位符应随语言切换`, async ({ page }) => {
      await page.goto('/' + page_);
      const before = await page.getAttribute(selector, 'placeholder');
      expect(before, '英文占位符不应为空').toBeTruthy();

      await page.click('#langBtn');
      await expect(page.locator(selector)).toHaveAttribute('placeholder', expected);
    });
  }
});

test.describe('文案双源一致性回归', () => {
  test('隐私口径必须统一为「无广告」，不得残留 AdSense 表述', async ({ page }) => {
    // 曾经的问题：静态 HTML 写「靠 Google AdSense 广告维持」并提到 EEA 同意弹窗，
    // 而 i18n 字典写「完全没有广告，靠自愿赞助」，两者互相矛盾且站内并无同意弹窗。
    //
    // 注意模式要收紧到「肯定式广告声明」。正确的文案里含 "no advertising cookies are set"
    // 这类否定句，宽泛地匹配 "advertising cookies" 会误伤自己。
    const BANNED = new RegExp([
      'AdSense',
      'supported by advertising',
      'display ads',
      'to serve ads',
      'personalized advertising',
      'Google Ads',
      'consent prompt',
      '同意提示',
      '个性化广告',
    ].join('|'), 'i');

    for (const lang of ['en', 'zh']) {
      await setLang(page, lang);
      for (const p of ['index.html', 'privacy.html', 'about.html', 'donate.html']) {
        await page.goto('/' + p);
        const text = await visibleText(page);
        expect(BANNED.test(text), `${p} 在 ${lang} 下仍出现广告口径：${text.match(BANNED)?.[0]}`).toBe(false);
        expect(text, `${p} 在 ${lang} 下不应出现裸 HTML 标签`).not.toContain('</a>');
      }
    }

    await setLang(page, 'en');
    await page.goto('/privacy.html');
    expect(await visibleText(page)).toContain('runs no advertising');
    await page.goto('/index.html');
    expect(await visibleText(page)).toContain('voluntary donations');
  });

  test('全站任意页面都不得把 HTML 标记当作纯文本显示出来', async ({ page }) => {
    // 曾经的问题：privacy.html 的 priv.eea 用 data-i18n（写 textContent），
    // 而字典值是含 <a> 的富文本，导致页面上直接显示出一段标签源码。
    for (const p of allPages()) {
      await page.goto('/' + p);
      const text = await visibleText(page);
      expect(text, `${p} 把 HTML 标记当成了纯文本`).not.toContain('</a>');
      expect(text, `${p} 把 HTML 标记当成了纯文本`).not.toContain('<span');
    }
  });

  test('页脚隐私链接使用独立词条，与头部导航区分', async ({ page }) => {
    await page.goto('/index.html');
    await expect(page.locator('.site-footer [data-i18n="footer.privacy"]')).toHaveText('Privacy Policy');
    await expect(page.locator('.site-header [data-i18n="nav.privacy"]')).toHaveText('Privacy');
  });

  test('donate 页的仓库链接由 config.js 接管（config.repo 回归）', async ({ page }) => {
    // 曾经的问题：内联脚本早于 i18n 翻译执行，getElementById('repoLink') 拿到 null，
    // 配置项形同虚设；翻译完成后又会把硬编码 href 写回来。
    await page.goto('/donate.html');
    const href = await page.getAttribute('#repoLink', 'href');
    expect(href).toBe('https://github.com/zm2yp5sggv-bit/localkit');

    // 切换语言后链接仍应存在且正确（翻译会重建这段富文本）
    await page.click('#langBtn');
    await expect(page.locator('#repoLink')).toHaveAttribute('href', 'https://github.com/zm2yp5sggv-bit/localkit');

    const gh = await page.getAttribute('#ghLink', 'href');
    expect(gh).toBe('https://github.com/zm2yp5sggv-bit');
  });
});
