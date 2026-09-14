import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.LK_PORT) || 4173;
const BASE = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: './tests',
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
