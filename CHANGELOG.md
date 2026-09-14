# 更新日志

本项目遵循 [语义化版本](https://semver.org/lang/zh-CN/)。
早期提交没有打 tag，此处按日期追溯记录。

## [未发布]

### 部署配置修复与工程化补强

#### 修复

- **`_headers` 的 `Cache-Control` 实际未生效**：Cloudflare Pages 对多条规则命中的同名响应头是
  **逗号合并**而非覆盖。原先三条规则都设置 `Cache-Control`，导致 vendor 文件收到
  `public, max-age=0, must-revalidate, public, max-age=31536000, immutable, public, max-age=3600`
  一串互相冲突的指令，预期的 `immutable` 根本没生效。现收敛为单条通配规则。
- **开发产物被公开服务**：Cloudflare Pages 以仓库根目录作为发布目录，实测
  `/tests/fixtures/sample.pdf`、`/package.json`、`/scripts/vendor.json`、`/.github/workflows/ci.yml`、
  `/README.md` 等均以正确的 MIME 类型返回给公网。现新增 `_redirects` 逐条屏蔽。
- **本地测试环境与线上语义不一致**：`scripts/serve.mjs` 自行实现的响应头合并用的是「后覆盖前」，
  与 Cloudflare 官方的「逗号合并」相反，导致上面第一个缺陷在本地怎么测都测不出来。
  现改为与校验脚本共用 `scripts/lib/deploy-config.mjs`，并让本地服务器一并执行 `_redirects`。
- 修正 `_headers` 里「同名的后一条覆盖前一条」这条与官方文档相反的错误注释。
- **`npm run test:checks` 在 Linux 上无法运行**：`node --test tests/node/` 的目录形式会被
  Node 当成模块去执行（`Cannot find module .../tests/node`），Windows 上同样失败。
  改用 glob 形式 `node --test "tests/node/**/*.test.mjs"`。
  这个疏漏本身也值得一提——本地验证时我习惯直接传文件路径，从未跑过 `package.json` 里
  真正的那个命令，于是「验证方式」与「被验证的对象」不是同一个东西。CI 抓到了它。

#### 新增

- **`scripts/check-deploy.mjs`**：校验 `_redirects` 状态码合法性（Cloudflare Pages 不支持
  404 / 410，写了会被静默忽略）、`_headers` 同名响应头重叠、以及开发产物的屏蔽覆盖率。
- **`tests/node/checks.test.mjs`**：17 个自测用例，用「坏样本」证明四个校验脚本确实会报错。
  裁判本身也需要被验证——此前 `check-i18n` 的死键检测就因把字典文件也纳入搜索范围而形同虚设，
  会静默地返回「全部通过」，比没有检查更危险。
- `eslint.config.js` 与 ESLint 依赖：浏览器侧统一按 ES2020 检查，开启 `no-var` / `prefer-const` / `eqeqeq`。
- `.github/pull_request_template.md` 与 `.github/ISSUE_TEMPLATE/`。
- `_redirects`：屏蔽开发产物的重定向规则。

#### 变更

- `assets/i18n.js` 与 `assets/app.js` 中残留的 `var` 统一为 `const` / `let`，
  语言基线正式定为 **ES2020** 并由 lint 强制。
  （注：此前报告称「`app.js` 与 `i18n.js` 都是 ES5 风格」并不准确——`app.js` 本就以 ES6 为主，
  只有 `injectSponsor` 一个函数里残留 `var`；真正整体使用 `var` 的是 `i18n.js`。）

### 审计修复（commit 9a2e808）

#### 修复

- **隐私口径自相矛盾**：`privacy.html` 与 `index.html` 的静态源码写着「靠 Google AdSense 广告维持」
  并提到 EEA 同意弹窗，而 `assets/i18n.js` 的字典写的是「完全没有广告，靠自愿赞助」，两者互相否定。
  且站内既没有 AdSense 脚本、也没有任何同意弹窗。现统一为「无广告、靠自愿赞助」口径。
- **隐私政策把 HTML 标记当纯文本显示**：`priv.eea` 用 `data-i18n`（写 `textContent`），
  但字典值含 `<a>` 标签，导致页面上直接显示出标签源码。已删除该冗余词条与对应段落。
- **输入框提示语从不翻译**：6 个工具页使用了 `data-i18n-ph`，但 `i18n.js` 的 `apply()`
  从未处理该属性，切到中文后占位符仍是英文，6 条翻译成为孤儿词条。已在运行时接线。
- **`config.repo` 形同虚设**：`donate.html` 的内联脚本早于 i18n 翻译执行，
  `getElementById('repoLink')` 拿到 `null`；即便拿到，翻译完成后也会把硬编码 href 写回来。
  现改为注册到新增的 `LKI.onApply` 回调，在每次翻译落地后重新应用配置。
- **页脚隐私链接词条错用**：24 个页面的页脚复用了头部导航的 `nav.privacy`，
  导致静态文案（Privacy Policy）与字典值（Privacy）在每一页都不一致。现为页脚新增 `footer.privacy`。
- **文件名未转义即拼入 `innerHTML`**：5 个工具页（压缩图片、格式转换、批量水印、PDF 合并、PDF 转图片）
  把文件名直接拼进 `innerHTML`，而同一仓库的文本对比与密码生成却做了转义，规范不统一。
  现统一走新增的 `LK.esc()`。
- **`pdf-to-docx` 的段落/表格描述与实际能力不符**：字典里把它说得比实现更笼统，
  现改为与实现一致的「带框线表格从 PDF 自身边框线读取」表述。
- `donate.html` 的 meta description 仍写着已被移除的「扫描二维码赞助」。
- 删除 `donate.html` 中残留的空 `<style></style>` 块。
- `docx-to-pdf` 的状态提示「— ready.」为硬编码英文，未走 i18n，现补 `dp.ready` 词条。

### 变更

- **第三方依赖全部本地化**：9 个库从 jsDelivr CDN 改为随仓库提交的 `assets/vendor/`。
  由此消除供应链风险与访问者的 IP 外泄，并让「断网可用」覆盖到 PDF 与图片处理工具。
  新增 `scripts/vendor.json` 与 `scripts/update-vendor.mjs` 管理版本与 sha256 校验。
- **新增 CSP 等安全响应头**（`_headers`）：其中 `connect-src 'none'` 在浏览器层面强制禁止本站发起网络请求。
  本地与 CI 的测试服务器 `scripts/serve.mjs` 会读取并下发同一套响应头，保证测试环境与线上一致。
- README 的「20+ 个工具」改为准确表述「20 个工具」；技术栈补齐遗漏的 `js-md5` 披露（About 页同步）。

### 新增

- **端到端测试与 CI**：Playwright 用例覆盖 20 个工具的核心逻辑，并额外把三件事变成可自动验证的约束——
  全站零第三方请求、断网后工具仍可用、带 HTML 的文件名不会被当作标签解析。
  GitHub Actions 在 push / PR 时运行静态检查与测试。
- **i18n 一致性门禁** `scripts/check-i18n.mjs`：校验中英字典键对齐、引用无悬空、
  **静态兜底文案与字典英文逐字一致**、无死键。首次运行即查出 42 处既有不一致。
- **静态检查** `scripts/check-syntax.mjs`：JS 与内联脚本语法、JSON-LD 合法性、
  本地资源引用完整性、无第三方 CDN 引用残留。
- **测试夹具生成器** `tests/fixtures/make-fixtures.mjs`：零依赖手工构造 PNG / PDF（含带框线表格的 PDF）/ DOCX，
  供文件类工具测试使用。
- `CONTRIBUTING.md`、`SECURITY.md`、`.editorconfig`、`package.json`。
- `assets/vendor/README.md`：记录各库版本、许可证与升级方式。

### 移除

- 字典中 7 个确认无人引用的死键：`priv.eea`、`pg.weak`、`pg.ok`、`pg.strong`、`pg.vault`、`ug.copy`、`tsp.ms`。
- `pdf-to-docx.html` 中 `__lkConvert` 重复实现的一整套转换流水线（约 50 行）——
  现改为复用主流程的 `dryRun` 模式，避免两处发散。

## 2026-09-13

- 站点 URL 切换为自有域名 youngray.asia。

## 2026-09-12

- 首发版本：20 个纯浏览器端工具，中英双语，MIT 许可。
- 清理失效的 `.btn` 选择器，把 `config.repo` 接入仓库链接，为 20 个工具补测试钩子。
- 移除二维码赞助区块，联系方式改为 GitHub Issues。
- 赞助页合规改造（商户收款码 + 法律声明 + 可选爱发电）。
