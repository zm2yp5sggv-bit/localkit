# 贡献指南

感谢愿意帮忙。这个项目刻意保持简单：**零框架、零构建、零运行时依赖**。请尽量在现有约定内工作，
不要为了「更现代」而引入打包器或框架。

## 本地准备

只需要 Node ≥ 22（仅用于检查和测试，站点本身不需要）：

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
| `check:deploy` | `_headers` 重复响应头、缓存策略一致性、`_redirects` 状态码、**开发产物屏蔽覆盖率** | 写错了不会报错，只会静默不生效或静默泄露 |
| `check:vendor` | `assets/vendor/` 内文件 sha256 与清单一致 | 依赖是提交进仓库的，需要防止被意外改动 |
| `lint` | ESLint（ES2020 基线 + `no-var` / `prefer-const` / `eqeqeq`） | 风格靠人记必然漂移 |
| `test:checks` | 用坏样本验证上面几个脚本确实会报错 | 裁判自己写错时会静默报告「全部通过」，比不检查更危险 |

还有两件事**只在线上才有意义**，因此不放进 `check`、也不在 PR 阶段跑：

- `npm run smoke` —— 探测线上实际状态是否与仓库声明一致（缓存策略、零第三方脚本、
  安全响应头）。仓库里看不到 Cloudflare 控制台的设置，只能靠它发现被改动。
- `npm run smoke -- --only cache` —— 只验证缓存这一点，日常改配置后自查很快。

### 本地跑测试的两个注意事项（Windows）

- **`npm test` 在本地可能以非零码退出，但测试其实全部通过。**
  常见输出是 `worker-0 process did not exit within 300000ms after stop`——
  测试跑完了，只是 Playwright 的 worker 在收尾时没能及时退出，5 分钟后被强制结束。
  判断依据要看 `N passed` 那一行，而不是只看退出码。CI（Linux）没有这个问题。
- **本地调试建议加 `--workers=1`。** 并行度较高时在负载重的机器上更容易出现
  与代码无关的偶发失败。

## 新增一个工具

三步，缺一不可：

1. 在 `tools/` 下新建一个 HTML 页面，可以直接复制一个相近的工具页改。
2. 在 `index.html` 对应分类里加一张 `.tool-card`。
3. 在 `assets/i18n.js` 里补上**中英两份**文案。

别忘了用 `node scripts/check-syntax.mjs` 顺便验证资源路径，以及把新页面加入 `sitemap.xml`。

## 工具实现的两个坑

**1. `canvas.toBlob()` 会对不支持的格式静默回退成 PNG。**
浏览器 canvas 只能编码 JPEG / WebP / PNG 三种。请求 `canvas.toBlob(cb, 'image/gif')`
不会报错，而是给你一份 **PNG 字节**。因此：

- 输出文件的扩展名必须从「可编码白名单」推导，**不要**照着输入类型去查表并留一个
  像 `|| 'img'` 这样的兜底值——那会让扩展名与实际内容不符；
- 不可编码的输入（GIF / BMP / TIFF / AVIF…）应当**显式替换**为 PNG，
  并在界面上把这次替换说明给用户。

`compress-image` 曾经就栽在这里，产出过 `xxx-min.img` 这种文件。

**2. 大输入的算法要先看空间复杂度，而且要先量再改。**
`text-diff` 用的是行级 LCS，完整 DP 表的内存是 `4 × (n+1) × (m+1)` 字节。
**但不要凭这个公式去推断实际表现**——本项目就犯过这个错：曾断言「20000 行会到 GB 级」，
而实际上代码里早就有 `MAX_CELLS` 守卫拦住了，那个场景根本触发不到。

实测数据（Chromium，本机，优化前后对比）：

| 规模 | 优化前 | 优化后 |
|---|---|---|
| 2000×2000 | 71ms / 16.9MB | 67ms / **9.3MB** |
| 5000×5000 | 419ms / **97.7MB** | 380ms / **49.9MB** |

两条经验：

- **存储 LCS 长度用 `Uint16` 就够**（值不超过 `min(n,m)`，在 `MAX_CELLS` 约束下远小于 65535），
  不必用 `Uint32`——内存直接减半，且完全不改变输出。这是「零风险收益」的典型。
- **规模上限应按「计算量」而不是「行数」设**：LCS 的代价是 `n×m` 而非 `max(n,m)`，
  按行数设会把「5001 行 vs 5 行」这种几乎不花钱的对比也拒掉。现在用 `MAX_CELLS = 25e6`。

**在考虑迁入 Worker 之前，先确认算法本身的空间占用是合理的**：Worker 只解决「阻塞主线程」，
不解决内存占用。反过来，如果内存本来就不紧张，就不必为了「线性空间」付出
Hirschberg 那样约 2 倍的时间常数。

## 部署边界（容易被忽略）

Cloudflare Pages 以**仓库根目录**作为发布目录，所以仓库里任何文件默认都会被当作站点资源公开服务——
`/tests/fixtures/sample.pdf`、`/package.json`、`/scripts/vendor.json` 都实测可被公网直接下载。

因此：**在仓库根目录新增任何非站点文件时，必须同时在 `_redirects` 里加一条屏蔽规则。**
漏加会让 `npm run check:deploy` 失败并列出具体是哪些文件。

另外，`_headers` 有一个坑值得先知道：Cloudflare 对**多条规则命中的同名响应头做逗号合并**，不是覆盖。
所以两条规则都设置 `Cache-Control` 会产出 `public, max-age=0, must-revalidate, public, max-age=31536000, immutable`
这样互相冲突的指令串。`check:deploy` 会拦截这种情况；确实需要按路径分别设置时，
可以在后一条规则里先写 `! Cache-Control` 取消前一条的值。

还要注意：`_headers` 里那个 `/*` 是「匹配所有路径」的**通配模式**，不是 C 风格注释的开头。
**不要顺手补 `*/` 收尾**——它会被解析成一条模式为 `*/` 的规则。检查脚本会校验每行模式是否像 URL 路径。

### 地址形态：无扩展名才是最终地址

Cloudflare Pages 会把 `/foo.html` **308 永久重定向**到 `/foo`，且这是平台硬编码行为，
**没有配置开关**。所以 `/foo` 才是「最终地址」，全站的自身地址声明都必须是这一形式。

新增或修改页面时，**四处载体都要同步**，缺一处都会被 `npm run check:syntax` 拦下：

| 载体 | 位置 |
|---|---|
| `<link rel="canonical">` | 页面 `<head>` |
| `<meta property="og:url">` | 页面 `<head>`（有则必须对） |
| JSON-LD 里的 `"url"` | 页面内的结构化数据 |
| `<loc>` | `sitemap.xml` |

（这条检查是「漏改」教育出来的：第一次迁移只改了 canonical 与 sitemap，
漏掉了 `og:url` 与 JSON-LD，所以现在三处一起校验。）

`tests/01-pages.spec.js` 另有一份行为层的用例（页面里的 canonical 必须等于其最终地址、
sitemap 不得出现 `.html`、无扩展名地址必须返回 200）。

`404.html` 是例外：它不设 canonical，必须带 `noindex`，且**不得**写进 `sitemap.xml`。

**站内链接目前仍写作 `.html`**（例如 `href="privacy.html"`），每次点击会多一次 308 跳转。
之所以没改成无扩展名，是因为那会让「双击 `index.html` 直接打开」失效——
`file://` 协议下不存在名为 `privacy` 的文件。这是一个已知的、有意的取舍。

### 安全响应头的唯一来源

`_headers` 是本项目所有安全响应头的唯一来源，包括 `Strict-Transport-Security`。
**不要再去 Cloudflare 控制台开启 HSTS**——两处同时设置会让该响应头被逗号合并成非法值，
浏览器可能整条忽略。

HSTS 的 `max-age` 目前是 180 天，且刻意不含 `includeSubDomains` 与 `preload`：
前者是为了给将来新增子域留余地，后者一旦进浏览器内置列表几乎无法撤回，应当单独决策。

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
