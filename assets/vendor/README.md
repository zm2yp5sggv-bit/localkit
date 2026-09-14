# assets/vendor — 第三方依赖（已本地化）

这些文件是从 jsDelivr 下载后**提交进仓库**的第三方构建产物，不经过任何构建步骤，
由各工具页通过相对路径直接 `<script>` 引入。

## 为什么本地化

原本这些库通过 CDN 引入，带来三个问题，本地化后一次性解决：

1. **供应链风险** —— CDN 侧被投毒或被劫持时，页面会静默执行被篡改的代码。本地文件随仓库一起被审计。
2. **隐私泄露** —— 每个访问者都会因 CDN 请求把 IP 与 Referer 暴露给第三方，这与本站「不向任何第三方
   发送数据」的隐私政策冲突。本地化后全站对外请求数为零。
3. **离线可用** —— 依赖 CDN 时断网即失效。本地化后所有工具（含 PDF、图片处理）断网均可用。

## 清单

| 文件 | 库 | 版本 | 许可证 | 来源 |
|---|---|---|---|---|
| `pdfjs/pdf.min.js`、`pdfjs/pdf.worker.min.js` | pdfjs-dist | 3.11.174 | Apache-2.0 | https://github.com/mozilla/pdf.js |
| `pdf-lib.min.js` | pdf-lib | 1.17.1 | MIT | https://github.com/Hopding/pdf-lib |
| `docx.umd.js` | docx | 8.5.0 | MIT | https://github.com/dolanmiu/docx |
| `docx-preview.min.js` | docx-preview | 0.3.2 | MIT | https://github.com/VolodymyrBaydalka/docxjs |
| `jspdf.umd.min.js` | jsPDF | 2.5.1 | MIT | https://github.com/parallax/jsPDF |
| `html2canvas.min.js` | html2canvas | 1.4.1 | MIT | https://github.com/niklasvh/html2canvas |
| `jszip.min.js` | JSZip | 3.10.1 | MIT / GPLv3 | https://github.com/Stuk/jszip |
| `qrcode.min.js` | qrcode-generator | 1.4.4 | MIT | https://github.com/kazuhikoarase/qrcode-generator |
| `md5.min.js` | js-md5 | 0.8.3 | MIT | https://github.com/emn178/js-md5 |

合计约 3.4 MB。

## 升级方式

```bash
node scripts/update-vendor.mjs          # 按 scripts/vendor.json 里的版本重新下载并校验
node scripts/update-vendor.mjs --check  # 只校验现有文件是否与清单一致
```

新增依赖时，请同时更新本文件与 `scripts/vendor.json`，并把版本**精确锁定**（不要用 `^` 或 `latest`）。

## 注意

- 这些是压缩后的构建产物，**不要手工编辑**。需要改动请改上游或用补丁脚本。
- `pdfjs/dist` 只取了 `legacy/build` 下的两个文件。pdfjs 3.x 的 legacy 构建会暴露全局
  `pdfjsLib`，与本项目现有用法一致；如果将来升级到 4.x（改为 ESM-only），
  工具页的加载方式需要一并调整。
