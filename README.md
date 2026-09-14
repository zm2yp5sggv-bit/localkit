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
3. 绑定自定义域名，把 `index.html`、`tools/*.html`、`sitemap.xml` 里的 `youngray.asia` 换成你的域名
4. 赞助渠道在 `assets/config.js` 配置（GitHub 默认；爱发电可选）

根目录的 `_headers` 会被 Cloudflare Pages 自动识别，用于下发 CSP 等安全响应头。其中
`connect-src 'none'` 会在浏览器层面**强制**禁止本站发起任何网络请求——隐私承诺不只写在文案里，
而是被策略锁死的。注意 `_headers` 只对 Cloudflare Pages 生效，自建服务器需自行转发。

## 💡 技术栈

零框架、零构建。第三方库共 **9 个**，全部已下载到 `assets/vendor/` 并随仓库提交
（版本精确锁定、带 sha256 校验，清单见 `scripts/vendor.json`）：

[PDF.js](https://github.com/mozilla/pdf.js) · [pdf-lib](https://github.com/Hopding/pdf-lib) · [docx](https://github.com/dolanmiu/docx) · [JSZip](https://github.com/Stuk/jszip) · [html2canvas](https://github.com/niklasvh/html2canvas) · [jsPDF](https://github.com/parallax/jsPDF) · [docx-preview](https://github.com/VolodymyrBaydalka/docxjs) · [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator) · [js-md5](https://github.com/emn178/js-md5)

库各自适用其原始许可证，详见 `assets/vendor/README.md`。

灵感来自 [it-tools](https://github.com/CorentinTh/it-tools) 与 [omni-tools](https://github.com/iib0011/omni-tools)，向开源社区致敬。

## 🧪 开发与测试

站点运行不需要 Node，但开发与测试需要（Node ≥ 20.11）。这些依赖只服务于本地检查与 CI，
不会进入部署产物。

```bash
npm install

npm run check      # 静态检查：i18n 一致性 + 语法/JSON-LD/资源引用 + 依赖哈希
npm test           # Playwright 端到端测试（会自动起本地服务器）
npm run serve      # 仅启动本地预览服务器
```

`npm run check` 包含三项：

- `check:i18n` —— 校验中英字典键是否对齐、页面引用的键是否存在、**静态兜底文案是否与字典英文一致**、
  是否存在无人引用的死键。页面静态源码与运行时字典是同一句文案的两份拷贝，这是防止二者漂移的门禁。
- `check:syntax` —— 校验所有 JS 与内联脚本的语法、JSON-LD 是否为合法 JSON、页面引用的本地资源是否存在、
  以及是否残留任何指向第三方 CDN 的引用。
- `check:vendor` —— 比对 `assets/vendor/` 下每个文件的 sha256 与清单是否一致。

端到端测试用 `window.__lk*` 钩子绕过 UI 直接驱动各工具的核心逻辑，并覆盖三件事：
**全站零第三方请求**、**断网后工具仍可用**、**带 HTML 的文件名不会被当作标签解析**。

## 🤝 贡献

欢迎 Issue 和 PR。新增一个工具只需要三步：一个 HTML 页面 + 首页一张卡片 + 在 `assets/i18n.js` 里补中英文案。

动手前请先读 [CONTRIBUTING.md](CONTRIBUTING.md)——里面写清了 i18n 的三种属性用法、
必须遵守的转义约定、以及提交前要跑哪些检查。

## 📄 许可

[MIT](LICENSE)
