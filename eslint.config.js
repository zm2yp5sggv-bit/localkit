/**
 * ESLint 配置（flat config）。
 *
 * 语言基线的决定：
 *   浏览器侧脚本统一按 **ES2020** 检查。项目里其实从未存在真正的「ES5 / ES6 分裂」——
 *   assets/ 与 tools/ 都在用 const/let、箭头函数、对象方法简写、async/await，
 *   唯一的实际差异是个别地方还在用 `var`。因此基线定为 ES2020，
 *   并开启 `no-var` 把剩下那点差异消掉，让风格可以被强制而不是靠人记。
 *
 * 覆盖范围的已知边界：
 *   页面内联 <script>（约 2400 行）**不在**本配置的检查范围内，
 *   因为 ESLint 无法直接解析 HTML。要覆盖它需要引入 eslint-plugin-html，
 *   属于后续可选项；目前内联脚本只受 scripts/check-syntax.mjs 的语法检查保护。
 */

import js from '@eslint/js';
import globals from 'globals';

/** 两个执行环境共用的规则。 */
const shared = {
  'no-var': 'error',
  'prefer-const': 'error',
  eqeqeq: ['error', 'smart'],
  'no-unused-vars': ['error', {
    argsIgnorePattern: '^_',
    caughtErrors: 'none',          // `catch (e) { /* 忽略 */ }` 属常见写法
  }],
  'no-empty': ['error', { allowEmptyCatch: true }],
  'no-console': 'off',             // scripts/ 与 tests/ 是命令行工具，需要输出
};

export default [
  {
    ignores: [
      'node_modules/**',
      'test-results/**',
      'playwright-report/**',
      'blob-report/**',
      'assets/vendor/**',          // 第三方压缩产物，不归本项目维护
      'tests/fixtures/**',
    ],
  },

  js.configs.recommended,

  // 浏览器侧：被 <script src> 以传统脚本方式加载
  {
    files: ['assets/*.js'],
    languageOptions: {
      ecmaVersion: 2020,
      sourceType: 'script',
      globals: { ...globals.browser },
    },
    rules: shared,
  },

  // Node 侧：开发脚本与测试
  {
    files: ['scripts/**/*.mjs', 'scripts/**/*.js', 'playwright.config.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: shared,
  },

  // Playwright 用例：文件本身在 Node 里执行，但 page.evaluate() 的回调函数体
  // 是在浏览器上下文中运行的，会用到 window / document。ESLint 无法识别这种跨上下文，
  // 因此这里同时放开两套全局变量。scripts/ 下的脚本没有这个需求，所以不合并进去。
  {
    files: ['tests/**/*.js', 'tests/**/*.mjs'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.node, ...globals.browser },
    },
    rules: shared,
  },
];
