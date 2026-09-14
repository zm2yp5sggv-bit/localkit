# 贡献指南

感谢愿意帮忙。这个项目刻意保持简单：**零框架、零构建、零运行时依赖**。请尽量在现有约定内工作，
不要为了「更现代」而引入打包器或框架。

## 本地准备

只需要 Node ≥ 20.11（仅用于检查和测试，站点本身不需要）：

```bash
npm install
npm run serve     # http://127.0.0.1:4173
```

也可以直接 `python -m http.server 8080`，或双击 `index.html`。

## 提交前必须跑

```bash
npm run check     # 静态检查，必须零错误
npm test          # 端到端测试
```

CI 会跑同样的命令，任何一项失败都不会合并。这些检查各自负责什么：

| 命令 | 检查什么 | 为什么需要 |
|---|---|---|
| `check:i18n` | 中英字典键对齐、引用无悬空、**静态文案与字典一致**、无死键 | 页面静态源码与字典是同一句文案的两份拷贝，很容易改了一处忘了另一处 |
| `check:syntax` | JS/内联脚本语法、JSON-LD 合法性、本地资源引用存在、**无第三方 CDN 引用** | 本项目承诺零外发请求 |
| `check:deploy` | `_headers` 重复响应头、`_redirects` 状态码、**开发产物屏蔽覆盖率** | 写错了不会报错，只会静默不生效或静默泄露 |
| `check:vendor` | `assets/vendor/` 内文件 sha256 与清单一致 | 依赖是提交进仓库的，需要防止被意外改动 |
| `lint` | ESLint（ES2020 基线 + `no-var` / `prefer-const` / `eqeqeq`） | 风格靠人记必然漂移 |
| `test:checks` | 用坏样本验证上面几个脚本确实会报错 | 裁判自己写错时会静默报告「全部通过」，比不检查更危险 |

## 新增一个工具

三步，缺一不可：

1. 在 `tools/` 下新建一个 HTML 页面，可以直接复制一个相近的工具页改。
2. 在 `index.html` 对应分类里加一张 `.tool-card`。
3. 在 `assets/i18n.js` 里补上**中英两份**文案。

别忘了用 `node scripts/check-syntax.mjs` 顺便验证资源路径，以及把新页面加入 `sitemap.xml`。

## 部署边界（容易被忽略）

Cloudflare Pages 以**仓库根目录**作为发布目录，所以仓库里任何文件默认都会被当作站点资源公开服务——
`/tests/fixtures/sample.pdf`、`/package.json`、`/scripts/vendor.json` 都实测可被公网直接下载。

因此：**在仓库根目录新增任何非站点文件时，必须同时在 `_redirects` 里加一条屏蔽规则。**
漏加会让 `npm run check:deploy` 失败并列出具体是哪些文件。

另外，`_headers` 有一个坑值得先知道：Cloudflare 对**多条规则命中的同名响应头做逗号合并**，不是覆盖。
所以两条规则都设置 `Cache-Control` 会产出 `public, max-age=0, must-revalidate, public, max-age=31536000, immutable`
这样互相冲突的指令串。`check:deploy` 会拦截这种情况；确实需要按路径分别设置时，
可以在后一条规则里先写 `! Cache-Control` 取消前一条的值。

## i18n 约定（最容易出错的地方）

页面静态源码**保持英文**，这是给搜索引擎和无 JS 环境看的；运行时由 `assets/i18n.js`
把可见文案替换成当前语言。因此同一句文案存在两份拷贝，**必须逐字一致**（`check:i18n` 会校验）。

三种属性各有用途，不要混用：

| 属性 | 写入目标 | 用在哪 |
|---|---|---|
| `data-i18n="key"` | `textContent` | 纯文本。**值里不能含 HTML 标签或实体**，否则会原样显示出来 |
| `data-i18n-html="key"` | `innerHTML` | 字典值**自带安全标记**的富文本（例如含 `<a>` 的句子） |
| `data-i18n-ph="key"` | `placeholder` 属性 | 输入框 / 文本域的提示语 |

页面标题用 `<html data-title-key="key">`。

JS 里需要动态文案时用 `LKI.t(key, vars)`，占位符写作 `{n}`：

```js
setStatus(t('pd.ready', { name: f.name, n: 3 }), 'ok');
```

> ⚠️ 曾经踩过的坑：`data-i18n-ph` 在运行时一度没有实现，导致 6 个页面的输入框提示语
> 切到中文后仍是英文，字典里对应的翻译成了孤儿词条。**新增属性后一定要在 `apply()` 里接线，
> 并用 `npm test` 里的占位符用例兜住。**

## 安全约定：不要手写转义

任何要拼进 `innerHTML` 的动态字符串（文件名、用户输入、外部数据）都必须经过 `LK.esc()`：

```js
item.innerHTML = '<span class="name">' + esc(file.name) + '</span>';
```

不要在各工具页里自己写 `.replace(/&/g, '&amp;')` 之类的逻辑——转义逻辑只保留共享层一份。
能改用 `textContent` / `createElement` 组装 DOM 的话更好。

## 依赖

第三方库不从 CDN 引入，而是下载到 `assets/vendor/` 并提交进仓库。原因见 `assets/vendor/README.md`。

升级或新增依赖：

1. 编辑 `scripts/vendor.json`，写明库名、**精确版本**（不要用 `^` 或 `latest`）、许可证、来源 URL。
2. 运行 `node scripts/update-vendor.mjs` 下载并回写 sha256。
3. 同步更新 `assets/vendor/README.md` 的清单表、`index.html` 与本文件的致谢（`about.credits.p`）。

## 代码风格

**语言基线：ES2020。** 浏览器侧脚本统一按 ES2020 检查并使用 `const` / `let`
（`no-var` 由 lint 强制），工具页的脚本用 IIFE 包裹并加 `'use strict'`。

- 传统脚本，不使用 ES module（这样 `file://` 直接打开也能跑）。`scripts/` 与 `tests/` 下的
  Node 脚本可以正常使用 ESM。
- 全局只挂 `window.LK`（共享工具函数）与 `window.LKI`（i18n），不要在别处污染全局。
- 缩进 2 空格，单引号，语句末尾保留分号。`.editorconfig` 已配置好基础规则，`npm run lint` 兜底。
- 每个工具页保留一个 `window.__lkXxx` 测试钩子，返回结构化结果而不是触发下载——端到端测试靠它驱动。

已知的覆盖边界：页面内联 `<script>`（约 2400 行）**不在 ESLint 的检查范围内**，因为 ESLint 无法直接解析 HTML。
它目前只受 `check:syntax` 的语法检查保护。要覆盖它需要引入 `eslint-plugin-html`，属可选改进。

## 提交信息

用一句话说清「改了什么、为什么」。如果提交信息里声称做了某件事，请确保代码里真的做了
（历史上有过提交信息写着「为 20 个工具配好测试钩子」而仓库里一个测试文件都没有的情况）。

## 许可

提交的代码将以 [MIT](LICENSE) 许可发布。
