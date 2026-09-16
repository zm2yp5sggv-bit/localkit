# 更新日志

本项目遵循 [语义化版本](https://semver.org/lang/zh-CN/)。
早期提交没有打 tag，此处按日期追溯记录。

## [未发布]

### text-diff：内存减半、修正规模上限语义、修掉一处残留结果的缺陷

先做了实测（Chromium，本机），再决定改什么——因为原先的判断是错的：

- 此前文档断言「20000 行会到 GB 级内存」，但代码里本来就有 `MAX_LINES = 5000` 守卫，
  那个场景**根本触发不到**。实测最坏情况（5000×5000，守卫上限）是 **419ms / 97.7MB**，
  并不像描述的那样危险。**把一个不存在的崩溃当成优化论据，是这次要改掉的习惯。**

#### 修复

- **超限时旧结果不会被清掉。** 守卫触发后只设了错误提示，
  而 `#output` 里的差异行与 `#stats` 里的统计仍是上一次的——**看起来就像本次输入算出来的**。
  边界测试正是被这一点误导过（5001 / 8000 行读出的统计与 5000 行一模一样）。
  现统一走 `clearResult()`，并加了会真正失败的回归用例。

#### 变更

- **规模上限改为按「计算量」限制**：`MAX_LINES`（每侧 5000 行）→ `MAX_CELLS = 25e6`。
  LCS 的代价是 `n×m` 而不是 `max(n,m)`，旧规则会把「5001 行 vs 5 行」这种
  几乎不花钱的对比也拒掉。现另设 `MAX_LINES = 20000` 单侧上限，
  但它卡的是**输出规模**（每行一个 DOM 节点），与计算量无关。
  提示文案同步改为说明两条规则（`td.toolarge` 中英各一份）。

#### 性能

- **LCS 的长度表由 `Uint16` 存储**（原 `Uint32`）。值不会超过 `min(n,m)`，
  在 `MAX_CELLS` 约束下远小于 65535，不会溢出；**输出完全不变**，内存直接减半：

  | 规模 | 优化前 | 优化后 |
  |---|---|---|
  | 2000×2000 | 71ms / 16.9MB | 67ms / 9.3MB |
  | 5000×5000 | 419ms / 97.7MB | 380ms / 49.9MB |

#### 测试

- 新增 3 个用例：
  - **差异可还原出两侧原文**——「把差异应用回原文必须得到修改后的文本」。
    这条不变量**与具体算法无关**，任何最小差异实现都必须满足，
    因此它是将来更换算法（如线性空间的 Hirschberg）时的安全网。
  - 超限输入会先清掉上一次的结果（已用「撤掉修复即失败」验证过它真能抓到该缺陷）。
  - 不对称输入不再被「行数」规则误拒。

#### 未做（附理由）

未改为 Hirschberg 线性空间实现。它能把空间降到 `O(min(n,m))`，
但**时间常数约为 2 倍**——在内存本来就只有 50MB、且守卫已限住规模的前提下，
这是笔不划算的交易。若将来要大幅提高上限，再连同 Worker 一起做。

### 冒烟检查增加部署收敛等待

#### 修复

- **`npm run smoke` 在 CI 上会把「还没部署」误报成「部署错了」。**
  该 job 在 push 后几秒就开始跑，而 Cloudflare Pages 往往还没部署完——
  实测遇到一次：push 后 12 秒跑冒烟时 `canonical` 组全红，两分钟后再跑全绿。
  现增加 `--wait <秒>` 选项（CI 用 `--wait 180`）：反复重试直到通过或预算耗尽。
  **预算耗尽仍失败即判定为真的不一致，照常失败**——是等待收敛，不是掩盖问题。

### 更正地址形态：无扩展名才是最终地址

#### 更正

- **上一版文档声称「在 Cloudflare Pages 设置里关闭 Pretty URLs」——该设置不存在。**
  核实结论（官方社区与文档一致）：`/foo.html` → `/foo` 的 308 跳转是**平台硬编码行为，
  没有配置开关**。一位 Cloudflare MVP 的原话是 "There's no supported way to prevent Pages
  today from removing the .html file extension"；社区里也有用户专门为此开帖请求开放开关。
  也就是说，上一轮选定的「保留 .html」方案在该平台上无法实现，
  而文档把用户引向了一个不存在的入口。

#### 变更

- **地址形态改为「无扩展名即最终地址」**，顺着平台走而不是对抗它。
  全站 46 处「自身地址」声明统一改为无扩展名形式：

  | 载体 | 数量 |
  |---|---|
  | `<link rel="canonical">` | 24（错误页不设） |
  | `<meta property="og:url">` | 2 |
  | JSON-LD 里的 `"url"` | 20 |
  | `sitemap.xml` 的 `<loc>` | 24（含根路径 1 条不变） |

  第一轮迁移只改了 canonical 与 sitemap，漏掉了 og:url 与 JSON-LD——
  三者是同一份信息的三个载体，漏掉任何一个都等于对搜索引擎给出互相矛盾的页地址。
  现已在 `check-syntax` 中把三者一起校验，不会再漏。
- **`scripts/serve.mjs` 复现平台的 URL 行为**，使本地与线上一致：
  `/foo.html` → 308、`/index.html` → `/`、无扩展名 → 解析到同名 `.html` 文件；
  未找到时返回 `404.html` 的内容（与关闭 SPA fallback 后的行为一致）。
- **`scripts/smoke.mjs` 的 `urlform` 组期望值反转**：不再断言「`.html` 应返回 200」
  （那是基于错误假设），改为断言平台的真实行为——`.html` 308 到无扩展名、无扩展名返回 200。
  `canonical` 组同步增加了「不得带 `.html`」的断言。
- 文档同步更正：README 与 CONTRIBUTING 的「地址形态」一节重写，部署清单里删掉了
  「关闭 Pretty URLs」这一步，并说明为什么不需要也无法配置。

#### 明确保留的取舍

站内链接仍写作 `.html`（如 `href="privacy.html"`），每次点击会多一次 308 跳转。
之所以不改成无扩展名：那会让「双击 `index.html` 直接打开」失效——`file://` 下不存在
名为 `privacy` 的文件，而这是本项目已验证并对外说明的能力。取舍已记入 CONTRIBUTING。

### Node 版本要求收紧到 ≥ 22

#### 变更

- **`engines.node` 从 `>=20.11` 改为 `>=22`，CI 矩阵去掉 Node 20。**
  起因是 CI 在 Node 20 上失败了，而报错信息完全没有指向真正的原因：
  `Could not find '.../tests/node/**/*.test.mjs'`。
  实际原因是 **`node --test` 的 glob 参数要到 Node 21 才支持**，Node 20 会把 `**`
  当成字面路径。也就是说，`engines` 声称支持的版本上，`npm run test:checks` 根本跑不通——
  **声称支持却跑不通，比明确不支持更糟**。
  而 Node 20 已于 **2026-04-30 EOL**（官方不再提供安全修复），为一个无补丁的运行时
  做兼容没有意义，因此直接收紧要求。
- 新增 `.npmrc` 并开启 `engine-strict=true`：版本不符时会在 `npm install` 阶段
  以明确信息失败，而不是等到某个命令抛出指向错误的异常。

### 生产环境守卫与图片压缩修复

#### 新增

- **`scripts/smoke.mjs`：生产站点冒烟检查**（`npm run smoke`）。
  这是唯一会访问线上环境的检查，因此不放进默认的 `check`。分七组：`pages` / `urlform` /
  `headers` / `cache` / `thirdparty` / `boundary` / `canonical`，支持 `--only <组>` 单跑。
  它的价值在于探测**仓库看不到的东西**——Cloudflare 控制台的设置没有版本控制，
  只能靠线上断言发现。其中两点尤其重要：
  - `cache` 分组从 `_headers` 读取**声明值**再与线上实际响应头逐一比对，而不是硬编码期望值；
  - `thirdparty` 分组是唯一能发现 Cloudflare 边缘注入 `beacon.min.js` 的手段
    （仓库里根本没有这段代码）。该分组只检查**会被加载的资源**（script/link/img…），
    刻意不含 `<a href>`——外链是站点正常内容，算进来会造成假警报。
- `tests/fixtures/sample.gif`（1×1、2 色调色板的最小合法 GIF89a）与 `sample.bmp`
  （8×8 24 位无压缩），由 `make-fixtures.mjs` 手工构造，用于覆盖不可编码格式的处理路径。
- `check-deploy` 新增「缓存策略必须全站一致」检查：要求 `_headers` 对通配路径声明
  `Cache-Control`，且其值里 `max-age` 只出现一次——防止有人为了性能又加回按路径规则
  （那会导致同名响应头被 Cloudflare 逗号合并）。

#### 修复

- **`compress-image` 会产出 `xxx-min.img` 这类文件**。
  根因比「兜底值写得难看」更麻烦：浏览器 canvas 只能编码 JPEG / WebP / PNG，
  其它格式交给 `canvas.toBlob()` 时**会静默回退成 PNG**——实测确认请求 `image/gif`
  得到的是 `image/png`。而原代码照着输入类型去查扩展名表，查不到就兜底成 `img`，
  于是扩展名与实际字节从来就没对上过。
  现改为：把不可编码的输入**显式替换为 PNG**，扩展名只从可编码白名单推导（三种，无兜底），
  `-min` 后缀依据「输出类型 === 规范化后的输入类型」判断，并在结果行显示替换说明。
  用默认设置拖入 GIF/BMP 即可复现原缺陷，因此这是默认路径上的问题。
- **首页把图片压缩描述成「压到目标大小」**，而工具只有质量滑块与最大尺寸两个控制项。
  改为「按质量与最大尺寸压缩 JPG、PNG 与 WebP」，与实现一致。
  （若将来真要支持目标大小，可对质量做二分搜索实现，届时应单独立项而不是沿用现在的文案。）
- 工具页的投放提示改为明示「GIF 与 BMP 将输出为 PNG」，与新的替换行为对齐。

### 站点可达性与错误页

#### 新增

- **HSTS**：`_headers` 增加 `Strict-Transport-Security: max-age=15552000`。
  此前 http→https 虽有 301，但首次请求仍是明文，可被 SSL-stripping 利用。
  取值刻意不含 `includeSubDomains` 与 `preload`：前者给将来新增子域留余地，
  后者一旦进浏览器内置列表几乎无法撤回。**注意 HSTS 只应在 `_headers` 一处配置**，
  若同时在 Cloudflare 控制台开启，响应头会被逗号合并成非法值而被浏览器整条忽略。
- **`404.html`**：带 `noindex`、不设 canonical、不进 sitemap。
  Cloudflare Pages 在未找到路径时自动使用它（需在设置中关闭 SPA fallback 才会生效）。
- **canonical 与 sitemap 一致性检查**（`scripts/check-syntax.mjs`）：
  校验每个页面的 canonical 等于其自身地址、sitemap 每条 URL 都能映射到真实文件、
  收录全部可索引页面且不含错误页。

#### 变更

- **明确地址形态为「保留 `.html` 扩展名」**（即关闭 Cloudflare Pages 的 Pretty URLs）。
  Pretty URLs 会把 `/foo.html` 308 跳到 `/foo`，而页面的 canonical 与 sitemap 里写的是 `.html`——
  等于 canonical 指向了一个非最终地址。关闭后三者天然一致，本地开发服务器行为也与线上一致。
  该决定已由 `check:syntax` 强制，不再只是文档中的约定。
  代价：已存在的无扩展名链接（如外部引用的 `/privacy`）会 404。

#### 修复

- **`_headers` 里误加的 `*/`**：`/*` 是「匹配所有路径」的通配模式，格式中并没有 C 风格的块结束符。
  此前按注释习惯补了 `*/` 收尾，被解析成一条模式为 `*/` 的空规则（规则数虚增为 2）。
  现已移除，并新增一条检查：每条规则的首行模式必须像 URL 路径，否则报错。
- **Playwright 把 `tests/node/checks.test.mjs` 也当成了自己的用例文件**：
  该文件名匹配 Playwright 默认的 `*.test.mjs`，于是每次跑端到端都会额外加载它一遍——
  Playwright 在其中找不到自己的用例，但 `node:test` 的 24 个自测会照常跑完，
  把 TAP 输出混进结果，并让套件多花约 30 秒。已在 `playwright.config.js` 中加
  `testIgnore: ['node/**']`，两个测试入口从此互不干扰。

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
