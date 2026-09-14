import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.LK_PORT) || 4173;
const BASE = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: './tests',
  // tests/node/ 下是「校验脚本自测」，用 node:test 编写、由 npm run test:checks 运行。
  // 它的文件名匹配 Playwright 的默认 testMatch（*.test.mjs），若不排除，
  // 每次跑端到端都会把它加载一遍 —— Playwright 在其中找不到自己的用例，
  // 但 node:test 的用例会照常在进程里跑完并把 TAP 输出混进结果，既拖慢套件也让输出难读。
  testIgnore: ['node/**'],
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  // 本地默认 4 个 worker：全站 20 多个工具页同时跑会争抢 CPU 与内存，
  // 在负载高的机器上容易出现与代码无关的偶发失败。
  workers: process.env.CI ? 2 : 4,
  reporter: process.env.CI
    ? [['list'], ['html', { open: 'never' }]]
    : [['list']],
  timeout: 90_000,
  expect: { timeout: 15_000 },

  use: {
    baseURL: BASE,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },

  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],

  webServer: {
    command: `node scripts/serve.mjs ${PORT}`,
    url: `${BASE}/index.html`,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
