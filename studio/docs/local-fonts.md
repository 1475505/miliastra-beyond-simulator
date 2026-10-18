# 本地自定义字体

模拟器支持读取本机的一份 TTF / OTF 字体。默认尝试 Windows 上原神的常见安装位置，也可指定文件或使用系统字体。不内置、下载或打包商业字体，也不通过项目存档分发字体。

## 使用

在 Web / Harness 编辑器上方点击「字体设置」，选择以下方式并保存：

- **自动尝试原神的默认安装位置**（默认）：依次尝试 Windows 的 `%ProgramFiles%\Genshin Impact\Genshin Impact Game\...`、`%SystemDrive%\Mihoyo\Genshin Impact\Genshin Impact Game\...`、`%ProgramFiles%\HoYoPlay\games\Genshin Impact game\...`、`%ProgramFiles%\miHoYo Launcher\games\Genshin Impact Game\...`；后缀均为 `YuanShen_Data\StreamingAssets\MiHoYoSDKRes\HttpServerResources\font\zh-cn.ttf`。这些是有限的候选位置，不保证涵盖每种启动器布局，不扫描整盘；都未找到时使用系统字体。非 Windows 不自动查找。
- **指定本机字体文件**：填写完整绝对路径，可粘贴 Windows「复制文件地址」得到的带引号路径。安装在 E: 等其他盘符时使用此项；输入框默认提供通用安装位置，代码不保存开发者的个人盘符。
- **使用系统字体**：明确关闭自动查找与自定义字体。

「应用范围」可选择 **仅游戏内文本**（画布、试玩、截图）或 **整体 UI**（同时覆盖工具栏、面板、代码和日志）。默认整体 UI，旧配置保持这一行为。该选项随 Web 0.5.0 提供；已发布的 DSH 2.2.0 不包含范围选择。

保存前校验字体，错误路径不会覆盖旧设置；自动查找会立即显示找到的路径或“未找到”结果。保存后重启对应的 Web、MCP 或 Harness 宿主，再刷新编辑器与试玩页；现有进程继续使用原字体快照，保存不会中断正在运行的试玩或丢弃编辑草稿。字体文件后来被移动、删除或损坏时，已保存的配置会回退到系统字体，并在设置面板显示错误，仍可重新配置。

设置保存在本机用户配置目录：Windows 为 `%APPDATA%\beyond-simulator\font.json`，macOS 为 `~/Library/Application Support/beyond-simulator/font.json`，Linux 为 `${XDG_CONFIG_HOME:-~/.config}/beyond-simulator/font.json`。同一用户的 Web / MCP / DSH 下次启动共用此配置；独立宿主可用 `QXQY_FONT_CONFIG_PATH` 指定另一份配置文件。

也可沿用环境变量 `QXQY_FONT_PATH`，值为本机字体文件的绝对路径。例如 PowerShell：

```powershell
$env:QXQY_FONT_PATH = 'C:\Fonts\my-licensed-font.ttf'
node web/dist/server.js --workspace . --host 127.0.0.1
```

该路径仅为示例，请替换为你有权用于此场景的字体。MCP 需要将变量设置在 MCP 服务进程的本机环境中；DSH 需要在启动宿主前设置。优先级为环境变量 → 本机保存设置 → 默认自动查找。非空 `QXQY_FONT_PATH` 锁定字体来源与路径；Web 0.5.0 仍允许保存应用范围，移除变量并重启后可恢复来源编辑。旧环境变量的无效配置仍明确报错。变量不会从项目 JSON 或 GIA 读取，模拟器也不会自动加载 `.env`。不要把本机路径写进共享配置或提交到仓库。文件建议保存在仓库外；仓库内的 `.local-fonts/` 也已忽略。

文件限制为单字体 TTF / OTF、最大 32 MiB；TTC、WOFF 和 WOFF2 不作为输入支持。字体读取或注册失败会明确报错，不会静默假装已加载。没有可用字体时保留原有系统字体。修改字体或取消变量后，重启宿主并刷新已打开的编辑器及试玩页。

## 生效范围

- 选择「整体 UI」时，自定义字体用于整个模拟器界面：编辑器工具栏、控件树、属性面板、按钮与表单、弹窗、Lua 脚本编辑区、服务端逻辑、预览页、试玩工具栏和日志；代码与日志中的显式等宽字体也随设置替换，字号、字重和行距保留。「仅游戏内文本」保留这些界面的原有字体。
- DOM 编辑画布的文字控件、Pixi 试玩文字、PNG 文字与宿主文字换行、自适应字号测量使用同一份自定义字体；未配置时也共用 `studio/fonts.js` 的默认字体栈，界面保留原有系统字体样式。
- 浏览器在字体成功加载且范围为 `all` 时统一设置带 `data-qxqy-font-ui` 标记的模拟器区域；独立预览与试玩页标记整个 body，Harness 内标记模拟器视图。范围为 `game` 时仅向画布/Pixi 传递字体。弹窗与后续动态生成的控件继承当前规则。
- 宿主保留进程内的字体与范围快照，试玩 Worker 收到相同字体字节，源文件随后被替换也不会让截图与换行测量使用不同版本。范围保存在本机配置的 `scope` 字段（`game` / `all`），通过 manifest 下发；保存后重启生效，两种范围都使用同一游戏字体，不写入项目存档。
- 浏览器等待字体加载后创建 Pixi 文字；加载失败会显示错误。浏览器和原生 Canvas 的栅格化仍可能不同，不承诺与游戏实机像素一致。
- 不添加 Lua 字体 API，不改项目模型、JSON 存档或 GIA。缺字时使用原有系统字体回退。

## 本地访问与分发边界

自定义字体通过 `/qxqy-font/manifest` 和内容标识对应的单个资源端点送到本机浏览器。这两类资源端点不接收文件路径、不暴露路径/文件名。新增的 `/qxqy-font/settings` 仅对本机直接连接开放：GET 返回当前路径、已保存设置和候选路径；POST 接收最大 8 KiB 的 JSON 并只保存经字体验证的配置，不提供目录浏览或上传。所有响应使用 `Cache-Control: no-store`。这仍会把字节交给本机浏览器，不能理解成防复制机制。

启用本机字体时，独立 Web 服务只允许监听回环地址。Web / DSH 的字体资源只接受直接回环连接与本机 Host，拒绝跨源及带常见代理转发头的请求；设置端点即使未启用字体也执行相同检查，且只接受 JSON 写入。监听非回环地址的独立 Web 不开放设置端点。Web 现有口令认证同样适用于字体接口。不要将字体接口配置到反向代理、隧道或公共站点。远程使用、公共 Webfont 或随软件分发需要独立设计和相应授权，不在本功能范围内。

仓库忽略字体文件和 `.local-fonts/`，Web 静态资源复制及 Release 打包过滤字体文件和私有字体目录，Docker 构建上下文也排除它们。不要强制添加字体、Base64、转码/子集文件、字形图集、真实本机配置或私有测试样本；提交 PR 前仍须检查 diff 和产物清单。测试仅使用代码生成的简单几何字形，不依赖游戏文件或系统字体文件。

用户需要确认字体许可覆盖自己的实际使用方式。拥有文件或游戏客户端不代表拥有软件嵌入、Web 使用或再分发权；本项目的代码许可证不授予第三方字体许可。

证据范围：本功能属于模拟器字体加载与隔离策略，`evidence_source=inferred; device_status=not_required`，不新增千星真机字体能力结论。

## 排版整合与回归

`play/text-layout.js` 使用宿主字体快照测量，并将字体栈纳入排版缓存键；滚动文本复用同一排版器。PNG / Pixi 消费已计算的字号和分行，Pixi 不再二次换行。编辑器将加载的字体传给实际文字 span，避免 span 的默认样式覆盖外层字体。

长期回归只维护互补边界：`test/local-font.test.mjs` 用合成几何字体核对 PNG、换行、自适应字号及真实 Controller → Worker 的字节快照传递；`web/test/local-font.test.mjs` 验证 HTTP 认证/字体资源与可选浏览器的 DOM/Pixi 字体、字号增量更新。描边 alpha 并入 `test/text-alignment.test.mjs`，不另维护单用例文件。测试不使用外部字体或真机样本；模拟器验证不代表真机字体一致。

2026-10-18 整合核验：基于 `a74a873` 与工作区已有排版/显隐修改，Windows / Node.js 22.23.2；冻结锁文件安装、根 `pnpm test`（357 pass、9 skip、0 fail）、Web/DSH/MCP 构建均通过。Edge headless / SwiftShader 单独启用合并后的浏览器字体/字号用例，2/2 通过。此项为 `evidence_source=observed`、运行端 `simulator`、`device_status=not_required`；不涉及游戏实机验收。

同日前端配置核验：`test/local-font.test.mjs` 以合成字体和独立子进程验证保存后不改变当前快照、重启后加载、环境变量优先、错误路径不覆盖以及损坏文件可恢复；`web/test/local-font.test.mjs` 覆盖配置接口认证与跨源拒绝，以及真实 Chromium 中的表单输入、带引号路径、失败保护、保存提示与既有 DOM/Pixi 字体渲染。Windows / Node.js 22.23.2，全仓 364 pass、11 条件 skip、0 fail；Chromium 真实浏览器用例另启用，2/2 通过；Web/DSH/MCP 构建通过。标记为 `evidence_source=observed`、运行端 `simulator`、`device_status=not_required`；未在完整签名 Harness Desktop 或其他系统验收。本轮用户给出的本机字体仅作临时读取验证，未放入源码、测试夹具或配置默认值。

同日全界面字体核验：按用户要求扩展到整个模拟器 UI。Windows / Node.js 22.23.2，直接运行字体、国际化与译文审校专项测试，11 pass、1 条件 skip。另以 Edge headless、合成几何字体和隔离配置直接加载当前编辑器与字体 ES 模块，复用现有 Pixi 依赖资源；45 项计算样式检查覆盖工具栏、控件树、属性表单、顶层弹窗、Lua 编辑区、服务端逻辑、内嵌试玩标题、独立试玩和 Web 预览，另确认 iframe 字体、20px 下 AB 的实际 DOM 字宽为 28px、系统字体回退及加载失败后重试。验证未调用构建或改写 dist，不代表当前安装包或完整 Harness Desktop 已更新。`evidence_source=observed`、运行端 `simulator`、`device_status=not_required`。

同日范围选择核验：Web 0.5.0 源码，Windows / Node.js 22.23.2 / Edge headless。既有字体测试以合成字体验证旧配置默认 `all`、非法范围拒绝、环境变量锁定来源但允许范围修改；浏览器通过设置表单保存 `game` / `all` 并启动真实新宿主，确认 manifest 与界面字体一致，两种模式的 DOM 画布及 Pixi 游戏文字都保留自定义字体。字体与翻译专项 11 pass、1 条件 skip；单独启用字体浏览器用例 2/2 通过。`evidence_source=observed`、运行端 `simulator`、`device_status=not_required`。DSH 2.2.0 安装包保持原发布内容。
