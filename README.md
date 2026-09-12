# LocalKit · 本地优先的免费在线工具站

> **Free online tools that never upload your files.**
> 20+ 个纯浏览器端工具：图片压缩/转换/水印、PDF 合并/拆分/转图片/双向 Word 互转、二维码、JSON、文本对比、哈希、密码……
> 所有处理 100% 在你的浏览器里完成——没有上传、没有账号、没有追踪。

[在线使用 →](https://localkit.tools) · [GitHub →](https://github.com/zm2yp5sggv-bit) · [赞助支持 ♥](donate.html)

## ✨ 特性

- 🔒 **隐私优先**：每个工具都是运行在浏览器标签页里的小程序，文件从不离开你的设备（断网也能用大部分工具）
- ⚡ **即时响应**：没有上传排队，处理速度就是你设备的速度
- 🆓 **免费无限制**：无账号、无水印、无次数限制，靠爱心赞助维持运转
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

```bash
# 任选其一
python -m http.server 8080
npx serve .
```

打开 `http://localhost:8080` 即可。也可以直接双击 `index.html`（全站相对路径）。

## 🛠 部署

1. Fork / 克隆本仓库
2. [Cloudflare Pages](https://pages.dev) → Create → 连接仓库（或直接拖拽上传文件夹）
3. 绑定自定义域名，把 `index.html`、`tools/*.html`、`sitemap.xml` 里的 `localkit.tools` 换成你的域名
4. 赞助渠道在 `assets/config.js` 配置（GitHub 默认；爱发电可选）

## 💡 技术栈

零框架、零构建。依赖库经 CDN 引入：[PDF.js](https://github.com/mozilla/pdf.js) · [pdf-lib](https://github.com/Hopding/pdf-lib) · [docx](https://github.com/dolanmiu/docx) · [JSZip](https://github.com/Stuk/jszip) · [html2canvas](https://github.com/niklasvh/html2canvas) · [jsPDF](https://github.com/parallax/jsPDF) · [docx-preview](https://github.com/VolodymyrBaydalka/docxjs) · [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator)

灵感来自 [it-tools](https://github.com/CorentinTh/it-tools) 与 [omni-tools](https://github.com/iib0011/omni-tools)，向开源社区致敬。

## 🤝 贡献

欢迎 Issue 和 PR！新增一个工具只需要：一个 HTML 页面 + 首页一张卡片 + `assets/i18n.js` 里加中英文案。

## 📄 许可

[MIT](LICENSE)
