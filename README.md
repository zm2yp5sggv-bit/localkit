# LocalKit · 本地优先的免费在线工具站

> **Free online tools that never upload your files.**
> 20 个纯浏览器端工具：图片压缩/转换/水印、PDF 合并/拆分/转图片/双向 Word 互转、二维码、JSON、文本对比、哈希、密码……
> 所有处理 100% 在你的浏览器里完成——没有上传、没有账号、没有追踪、没有任何第三方请求。

[在线使用 →](https://youngray.asia) · [GitHub →](https://github.com/zm2yp5sggv-bit) · [赞助支持 ♥](donate.html)

## ✨ 特性

- 🔒 **隐私优先**：每个工具都是运行在浏览器标签页里的小程序，文件从不离开你的设备
- 📴 **完全离线可用**：全部依赖库已本地化到仓库内，断网状态下所有工具（含 PDF、图片处理）都能正常使用
- 🚫 **零第三方请求**：站点不加载任何 CDN、统计或广告脚本，访问者不会因使用本站而向第三方暴露 IP
- ⚡ **即时响应**：没有上传排队，处理速度就是你设备的速度
- 🆓 **免费无限制**：无账号、无水印、无次数限制，靠自愿赞助维持运转
- 🌐 **中英双语**：一键切换，自动跟随浏览器语言
- 📦 **零构建**：纯静态 HTML/CSS/JS，克隆即用，拖拽即可部署到 Cloudflare Pages / Vercel / GitHub Pages

## 🧰 工具列表

| 分类 | 工具 |
|---|---|
| 🖼️ 图片工具 | 图片压缩（批量+ZIP）、格式转换（PNG/JPG/WebP）、批量文字水印、二维码生成（链接/文本/Wi-Fi） |
| 📄 文档工具 | PDF 合并、PDF 拆分、PDF 转图片、DOCX 转 PDF、PDF 转 Word（含表格网格与图片重建） |
| 📝 文本工具 | 文本对比（LCS 行级 diff）、大小写转换（10 种格式）、文本统计（中日韩感知） |
| 💻 开发者工具 | JSON → TypeScript、JSON 格式化/校验、Base64/URL 编解码（Unicode 安全）、哈希计算（MD5/SHA 全家桶）、强密码生成、UUID v4、时间戳转换、颜色转换 |

## 🚀 本地运行

站点是纯静态的，**不需要构建**，任选一种方式起一个静态服务器：

```bash
python -m http.server 8080     # 任意静态服务器都行
npx serve .

node scripts/serve.mjs 4173    # 仓库自带的零依赖服务器，会一并下发 _headers 里的安全响应头
```

打开 `http://localhost:8080` 即可。也可以直接双击 `index.html`（全站使用相对路径）。

## 🛠 部署

1. Fork / 克隆本仓库
2. [Cloudflare Pages](https://pages.dev) → Create → 连接仓库（或直接拖拽上传文件夹）
3. **把 Caching → Configuration → Browser Cache TTL 设为「遵循现有标头」**
   （英文界面 `Respect Existing Headers`）。**这是最容易漏、后果最迷惑的一项**，
   理由见下方「为什么必须关掉 Browser Cache TTL」。
4. 绑定自定义域名，把 `index.html`、`tools/*.html`、`sitemap.xml` 里的 `youngray.asia` 换成你的域名
5. 建议同时添加 `www` 子域并在 Rules → Redirect Rules 里做 `www` → 根域 301
6. 确认 **Web Analytics 处于关闭状态**（它会注入 `beacon.min.js`，与「零第三方脚本」冲突）
7. 赞助渠道在 `assets/config.js` 配置（GitHub 默认；爱发电可选）

> 不需要、也**无法**配置「地址形态」：Cloudflare Pages 会把 `.html` 308 跳到无扩展名地址，
> 这是平台硬编码行为，没有开关。项目顺着它走——canonical 与 sitemap 都写无扩展名形式。

部署完成后跑一次 `npm run smoke` 验证线上状态。

根目录的 `_headers` 会被 Cloudflare Pages 自动识别，用于下发 CSP、HSTS 等安全响应头。其中
`connect-src 'none'` 会在浏览器层面**强制**禁止本站发起任何网络请求——隐私承诺不只写在文案里，
而是被策略锁死的。注意 `_headers` 只对 Cloudflare Pages 生效，自建服务器需自行转发。

### 为什么必须关掉 Browser Cache TTL

Cloudflare 区域默认的 **Browser Cache TTL（4 小时）会覆盖 `_headers` 里声明的 `max-age`**，
而且**只作用于非 HTML 资源**——HTML 完全不受影响。这个不对称正是它难以发现的原因：
页面看起来正常，但 `assets/*.js`、`*.css`、`vendor/*` 都变成了 4 小时缓存。

后果是每次部署后最长 4 小时内，返回访客会拿到「**新 HTML + 旧字典**」：浏览器认为缓存的
`i18n.js` 还新鲜、根本不去问服务器，于是新页面引用到旧字典里不存在的词条，
`LKI.t()` 回退成键名本身，**页脚就直接显示出 `footer.privacy` 这样的字面量**。
刷新也没用——这不是缓存过期的问题，是缓存还没过期。

`npm run smoke` 的 `[cache]` 分组专门守着这一点：它从 `_headers` 读取声明值，再和线上实际
响应头逐一比对，被覆盖时会直接指出这一项与修复位置。

### 地址形态：无扩展名才是最终地址

Cloudflare Pages 会把 `/foo.html` **308 永久重定向**到 `/foo`。这**不是可配置项**——
平台硬编码，没有开关（官方社区与文档均已确认）。所以正确的做法不是去关掉它，
而是顺着它：**把无扩展名地址当作最终地址**，让全站只有一种地址形态。

因此以下三处**都必须写无扩展名形式**，且必须一致：

| 载体 | 位置 | 示例 |
|---|---|---|
| `canonical` | 各页 `<head>` | `https://youngray.asia/privacy` |
| `og:url` | 各页 `<head>` | `https://youngray.asia/privacy` |
| `url` | 各页 JSON-LD | `https://youngray.asia/tools/hash-calculator` |
| `<loc>` | `sitemap.xml` | `https://youngray.asia/privacy` |

`npm run check:syntax` 会核对全部 46 处载体：地址必须是本站的、必须等于该页自身的最终地址、
且不得带 `.html`。漏改任何一处都会被 CI 拦下——**这条检查是被漏改教育出来的**：
第一次迁移只改了 `canonical` 与 sitemap，漏掉了 `og:url` 与 JSON-LD，所以现在三者一起校验。

本地开发服务器（`scripts/serve.mjs`）会复现平台的这三条行为，保证本地与线上一致：
`.html` → 308、`/index.html` → `/`、无扩展名 → 解析到同名 `.html` 文件。

> 历史说明：上一版文档曾建议「在 Pages 设置里关闭 Pretty URLs」——那是错的，
> 该设置不存在。已在 CHANGELOG 更正。

### 404 页面

根目录的 `404.html` 由 Cloudflare Pages 在未找到路径时自动使用（前提是 SPA fallback 处于关闭状态）。
它带 `noindex` 且不进 `sitemap.xml`；若配置了 SPA fallback，所有未知路径都会返回首页并带 200 状态
（soft-404），`404.html` 就不会生效——建议在 Pages 设置里关闭 SPA fallback。

### HSTS 只在一个地方配置

`_headers` 已经下发 `Strict-Transport-Security`。**不要**再去 Cloudflare 控制台
（SSL/TLS → Edge Certificates）打开 HSTS 开关：两处同时设置会让响应头被逗号合并成
`max-age=15552000, max-age=...`，属非法值，浏览器可能直接忽略整条头——刚好与启用 HSTS 的意图相反。

## 💡 技术栈

零框架、零构建。第三方库共 **9 个**，全部已下载到 `assets/vendor/` 并随仓库提交
（版本精确锁定、带 sha256 校验，清单见 `scripts/vendor.json`）：

[PDF.js](https://github.com/mozilla/pdf.js) · [pdf-lib](https://github.com/Hopding/pdf-lib) · [docx](https://github.com/dolanmiu/docx) · [JSZip](https://github.com/Stuk/jszip) · [html2canvas](https://github.com/niklasvh/html2canvas) · [jsPDF](https://github.com/parallax/jsPDF) · [docx-preview](https://github.com/VolodymyrBaydalka/docxjs) · [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator) · [js-md5](https://github.com/emn178/js-md5)

库各自适用其原始许可证，详见 `assets/vendor/README.md`。

灵感来自 [it-tools](https://github.com/CorentinTh/it-tools) 与 [omni-tools](https://github.com/iib0011/omni-tools)，向开源社区致敬。

## 🧪 开发与测试

站点运行不需要 Node，但开发与测试需要（**Node ≥ 22**；Node 20 已于 2026-04 EOL，不再支持）。这些依赖只服务于本地检查与 CI，
不会进入部署产物。

```bash
npm install

npm run check        # 静态检查（i18n / 语法 / 部署配置 / 依赖哈希）
npm run lint         # ESLint
npm run test:checks  # 校验脚本自身的自测（坏样本注入）
npm run smoke        # 探测线上：缓存策略、零第三方脚本、安全头是否真生效
npm test             # Playwright 端到端测试（会自动起本地服务器）
npm run serve        # 仅启动本地预览服务器
```

`npm run smoke` 是唯一会访问线上环境的检查，因此**不在**默认的 `check` 里。
它分 `pages` / `urlform` / `headers` / `cache` / `thirdparty` / `boundary` / `canonical` 七组，
可用 `npm run smoke -- --only cache` 只跑其中一组。它的核心价值是探测**仓库看不到的东西**——
Cloudflare 控制台的设置改动（Browser Cache TTL、Web Analytics、SPA fallback）没有版本控制，
只能靠线上断言发现。

CI 里用的是 `npm run smoke -- --wait 180`。因为该 job 在 push 后几秒就开始，
而 Cloudflare Pages 通常还没部署完——不加等待预算会把「还没部署」误报成「部署错了」
（实测遇到过：push 后 12 秒跑冒烟时 `canonical` 组全红，两分钟后再跑全绿）。
`--wait` 是**有界**的：预算耗尽仍失败即判定为真的不一致，照常失败。

`npm run check` 包含四项：

- `check:i18n` —— 校验中英字典键是否对齐、页面引用的键是否存在、**静态兜底文案是否与字典英文一致**、
  是否存在无人引用的死键。页面静态源码与运行时字典是同一句文案的两份拷贝，这是防止二者漂移的门禁。
- `check:syntax` —— 校验所有 JS 与内联脚本的语法、JSON-LD 是否为合法 JSON、页面引用的本地资源是否存在、
  以及是否残留任何指向第三方 CDN 的引用。
- `check:deploy` —— 校验 `_headers` 是否重复设置同名响应头（Cloudflare 会把它们逗号合并，
  产出互相冲突的指令）、`_redirects` 是否使用了不受支持的状态码、
  以及**开发产物是否都被屏蔽**（否则 `tests/`、`scripts/` 会连同站点一起被公开服务）。
- `check:vendor` —— 比对 `assets/vendor/` 下每个文件的 sha256 与清单是否一致。

`npm run test:checks` 是给校验脚本本身做的体检：它把仓库复制到临时目录，逐个注入**已知缺陷**
（文案不一致、缺词条、语法错误、CDN 残留、`_redirects` 写了 404、`_headers` 重复响应头、依赖被篡改……），
再断言脚本确实会失败。没有这一层，一个写错的校验脚本会静默地报告「全部通过」，
比不检查更危险。

端到端测试用 `window.__lk*` 钩子绕过 UI 直接驱动各工具的核心逻辑，并覆盖这些**承诺**而非只是功能：
**全站零第三方请求**、**断网后工具仍可用**、**带 HTML 的文件名不会被当作标签解析**、
**开发产物不会作为站点资源返回**、**响应头没有被逗号合并**。

### 部署边界

`tests/`、`scripts/`、`package.json` 等开发文件与站点同处一个仓库根目录，而 Cloudflare Pages
正是以根目录为发布目录——所以默认情况下它们会被当作站点资源公开服务（实测确实如此）。
`_redirects` 负责把它们拦掉。**新增根目录下的开发文件时，记得同步加一条规则**，
`npm run check:deploy` 会在漏加时报错。

## 🤝 贡献

欢迎 Issue 和 PR。新增一个工具只需要三步：一个 HTML 页面 + 首页一张卡片 + 在 `assets/i18n.js` 里补中英文案。

动手前请先读 [CONTRIBUTING.md](CONTRIBUTING.md)——里面写清了 i18n 的三种属性用法、
必须遵守的转义约定、以及提交前要跑哪些检查。

## 📄 许可

[MIT](LICENSE)
