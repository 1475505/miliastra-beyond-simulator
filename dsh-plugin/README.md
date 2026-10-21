# 千星沙箱 DSH 插件

静态 Host + Client 插件。编辑状态按 DSH `sessionId` 隔离；每个会话以一个存档聚合服务端 UI、客户端模板和 Lua 脚本，支持完整存档包与单项 Authoring JSON/GIA/Lua 导入导出。Lua 试玩优先在独立浏览器标签页中展示；宿主拒绝新窗口时改为应用内全屏试玩，仍运行于可终止的 Worker。

## 安装与更新

准备 Node.js 22+ 和 DeepSeek Harness，选择下面一种安装方式。GitHub 源码安装还需要 Git；本地安装包路径以仓库根目录为基准，在其他目录安装时请换成 `.tgz` 的绝对路径。

```powershell
# 从 npm 安装
dsh plugin --profile web add dsh-plugin-beyond-simulator
# 或，从 GitHub 默认分支源码安装
dsh plugin --profile web add github:1475505/miliastra-beyond-simulator
# 或，从本地安装包安装
dsh plugin --profile web add ./release/dsh-plugin-beyond-simulator-2.2.1.tgz

dsh --profile web --dump-config
dsh web
```

安装新版时也使用 `add`，然后重启 Harness。`--dump-config` 可用于确认插件已加载。版本及文件名以 `release/manifest.json` 为准。使用预构建 tarball 安装，无需相邻 Studio 源码或构建工具。

GitHub 安装使用仓库默认分支，无需指定 `#master`。安装时会安装构建依赖并运行根目录的 `prepare`，生成插件及其资源。若 pnpm 提示需要批准构建，请按提示允许本插件（或错误中给出的精确 Git 依赖键），再重新执行安装命令。安装入口是仓库根目录，`dsh-plugin` 子目录是内部源码包。实现见 [分发说明](../DISTRIBUTION.md#harness-安装入口)。

支持目录预设的旧宿主中，已有的用户 Agent 预设不会被升级覆盖。Harness 0.2.1 使用声明式注册项，更新插件包才能更新随包预设，单改旧 `.agent-presets` 文件无效；区别见 [0.2.1 兼容性](#harness-021-兼容性)。

若需要从源码生成安装包，准备 pnpm 10.15.0，在仓库根执行：

```sh
pnpm install --frozen-lockfile
pnpm test
pnpm pack:release
pnpm test:packages
pnpm test:git-install
pnpm test:harness
```

Host Tools：`qxqy_script_sync`、`qxqy_studio_get`、`qxqy_studio_patch`、`qxqy_studio_play`、`qxqy_studio_ui_screenshot`、`qxqy_studio_play_screenshot`、`qxqy_studio_load`。截图由 Host 在进程内根据 `boxes` / `paint` 渲染 PNG，不需要打开模拟器标签或试玩页。

`qxqy_script_sync` 支持目录配置、保存、差异预览和复制。用户授权更新后，AI 可通过 `save → preview → apply` 完成同步并取得文件回执与备份位置。参数与流程见 [脚本同步接口](../studio/docs/script-sync.md#ai-更新接口)。

独立及内嵌试玩共用「键位响应」开关，默认按官方键鼠表派发 Down/Up，关闭不影响光标点击；输入框和日志页不驱动游戏。规则与验证见 [浏览器键位响应](../studio/docs/browser-input.md)。

白名单静态素材经同源 `/qxqy-assets/` 路由按需显示，与 Web/MCP 共用磁盘缓存；浏览器复用 HTTP 缓存。图片属性面板可重新下载当前素材。`QXQY_IMAGE_CACHE_DIR` 可指定缓存目录，详情见 [素材缓存](../studio/docs/image-assets.md)。

2.1.0 增加 `ImageSource.Prefab` 元件图标：图片源选择「元件」并填写 ID（如 `10003004`），或在 Lua 中调用 `SetImage(Enum.ImageSource.Prefab, id)`。2,720 个白名单图标按需缓存，来源与 ID 一起参与缓存/刷新/渲染；GIA 来源尚未映射，导出有提示。

2.1.0 增加图片类型「基础／拉伸」：按 `m_Border` 三切片／九切片，编辑器、Pixi 试玩及 PNG 一致处理；边界 JSON 独立按需缓存，旧 PNG 无需重下。Lua 白名单选择规则、缺边界回退和客户端 GIA 类型槽见 [图片类型](../studio/docs/image-assets.md#图片类型基础拉伸210)。

2.0.10 接通 Lua 2D 音效（`PlayAudio2D` / `StopAudio` / `IsAudioAlive`）；试玩页经 `/qxqy-audio/` 按需加载并缓存 MP3，提供声音解锁/静音按钮。`QXQY_AUDIO_CACHE_DIR` 可指定音频缓存目录，接口与模拟策略见 [音频说明](../studio/docs/audio-assets.md)。

磁盘存档发现与 MCP / Web 共用 Studio 实现：支持超过 8 MiB 的存档，按修改时间选取最新 50 项，并返回扫描限制和读取问题的 `discovery` 信息。显式加载仍允许工作区内的相对路径或绝对路径；隐藏目录、列表上限等自动发现限制不影响指定路径加载，路径穿越与符号链接逃逸仍会被拒绝。控制器加载成功后记住工作区相对路径，后续省略保存路径会写回该文件；未绑定工作区时列表仍返回 `{ bound: false, archives: [] }`。

插件同时注册 runtime skill `qxqy-simulator`：正文源文件是 [`../skill/SKILL.md`](../skill/SKILL.md)，构建时复制为包内 `dsh-plugin/skill.md`，经独立 bundle 行（只注入 `skills` 服务）调用 `ctx.skills.register` 注册。模型通过技能目录自动发现并按需加载，无需用户手动安装；该服务缺失时仅技能不可见，主功能不受影响。

插件随包附带 agent 预设 `wonderland-lua-builder`（千星 2D+Lua 游戏制作）：源目录 [`../agent/wonderland-lua-builder`](../agent/wonderland-lua-builder)。构建时把 `agent.cordis.yml` 嵌入 `dsh-plugin/cordis.patch.yml`。在提供 `@deepseek-ai/dsh-agent-preset` 的 DSH 0.1.7-rc.1 及更新版本中，新版注册项会启用；旧版 DSH 自动跳过它，避免缺失模块阻塞启动。旧版复制入口始终保留：启动时仅当 `$DSH_HOME/.agent-presets/wonderland-lua-builder` 不存在，才从包内 `dsh-plugin/presets/` 复制，已有用户预设不覆盖。支持预设选择的 DSH 中，可在「设置 → Agent 预设」选择；已有任务不会自动切换。

编辑器自动跟随 Harness 亮/暗主题并占满宿主内容高度，分为“UI 编辑 / Lua 脚本 / 服务端逻辑”三个页面。顶栏显示存档名、会话工作区和当前资产。点击“试玩 ↗”会先保存脚本与服务端逻辑，再打开同源 `/qxqy-simulator/play#<sessionId>`；试玩画面由 PixiJS v8 WebGL 渲染，Runtime 仍在 Worker 内推进并独占 Lua、布局、锚点、命中和测试语义。`qxqy_studio_play_screenshot` 根据 Runtime `paint` 在 Host 出 PNG，`qxqy_studio_ui_screenshot` 根据编辑器 `boxes` 出舞台 PNG，都不依赖可见页签。完整使用与排障见 [`../../docs/simulator-usage.md`](../../docs/simulator-usage.md)。

## Desktop protobuf 导入失败

2026-10-18 用户在持续运行的 Desktop 0.2.1-rc.2 中更新并启用本地 2.1.1 包，报告 `failed to import: TypeError: hu.parse is not a function`。构建符号对应 GIA codec 的外部 protobufjs.parse 调用。只读核对确认安装的 Host 文件与交付包一致，protobufjs 8.7.2 文件完整，新的 Node 22 / Desktop 自带 Node 24.21.0 子进程中均有 parse；同一个旧包在 Desktop 自带 SDK 的全新临时 profile 中也可启动。因此没有证据将原有宿主取得错误导出值的具体原因定为缺包、某个版本或特定缓存机制。当前主进程自 02:46 持续运行是直接观察，旧模块状态参与故障仍是推断。

2.1.2 将完整 protobufjs 编入 DSH Host 和 Worker，GIA 初始化不再读取宿主外部 CommonJS 对象的 parse。SDK 与原生 Canvas、Lua VM 仍按原兼容边界使用；没有修改用户的 Desktop profile 或第三方依赖文件。采用新补丁版本区分本地 2.1.1 构建，本地打包不代表已发布 npm。

最小受控回归在独立子进程中将外部 protobufjs.parse 设为 undefined：旧交付文件产生相同的 `hu.parse is not a function`，新包能导入并完成 GIA 导入导出的字节一致往返。测试另检查 Host/Worker 没有 protobufjs 的外部导入。该夹具验证依赖隔离，不能写成已复现原有进程产生错误导出值的完整触发链。新增回归见 test/protobuf-bundle.test.mjs。

修复包安装后，应保存工作、从托盘完整退出 Harness，再启动；仅切换启用状态或关闭窗口不等于重启宿主。Node 会缓存已经失败的 ESM 导入，宿主 app-boot 的 importFailure 也会重新取得该缓存错误，所以替换磁盘文件后必须让进程重新加载。

最终验收：Windows x64 / Node.js 22.23.2 全仓 387 pass / 13 条件 skip / 0 fail；首次认证用例被本机已保存的自定义字体影响，补上独立系统字体夹具后通过，未改用户字体文件或生产配置。2.1.2 的三组 dsh-tools 0.1.0-rc.6、0.2.0-rc.2、0.2.1-rc.2 安装验收通过。Desktop 0.2.1-rc.2 随附 Electron 44.7.0 / Node 24.21.0 下，解析器隔离回归及独立临时 profile 的完整 SDK 启动、工具、GIA、Worker/PNG、语言与真实浏览器编辑/试玩均通过。

以上为 `evidence_source=observed`、运行端 `simulator`、`device_status=not_required`；原有进程的确切触发机制未确认，用户原窗口中的修复回验尚未取得。受控夹具与新进程验收不能替代这一边界。

## Desktop 内嵌试玩（2.0.8）

DSH Desktop 0.2 拒绝页面创建子窗口，旧版插件因此误报“浏览器阻止了试玩标签页”。2.0.8 在新窗口不可用时，保存成功后用全屏 iframe 加载同一试玩页，无需修改浏览器弹窗权限。点击“返回编辑”“关闭试玩”或按 Escape 会等待停止成功后关闭；停止失败时可重试。编辑器保持原页面、草稿、选择和滚动状态。技术说明与浏览器/Electron 验证边界见 [共用编辑器](../editor-ui/README.md#试玩窗口与内嵌兜底)。

## 路由重复注册（2.0.11）

**现象：** 主组件报 `webserver: duplicate prefix route "/qxqy-simulator/api"`，Skill 与两种预设组件仍运行。用户反馈 2.0.8 / 2.0.10 在单份安装、完整退出重装、原版 bundle patch 下仍出现；原始完整日志待补（`evidence_source=provided_unverified`，运行端 `unknown`，`device_status=not_required`）。

**已复现的缺陷：** Harness [`WebServer.register()`](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.0-rc.2/packages/host/webserver/src/index.ts) 返回普通注销函数，不会自动把路由绑定到调用组件的生命周期。旧插件丢弃返回值；同一组件重启或 `tools` 依赖重载后，工具已清理而 HTTP 路由仍保留，下一次 `apply()` 在第一条 API 路由上失败。只需一个插件实例即可复现，故这条报错本身不能证明 patch 插入了两次；用户环境中触发再激活的具体事件仍未知。

**修复：** 所有五条 HTTP 路由统一使用 `ctx.effect(() => ctx.webServer.register(route))` 接管注销，包括 API、试玩页、渲染脚本、图片与音频。注册中途抛错时回滚本次已注册的路由；会话清理提前登记并等待 Worker 退出。已卸载的 Registry 拒绝仍在等请求体或工作区查询的旧请求。真实的同时挂载冲突仍报错，不吞异常、不覆盖其他组件的路由，也不让新工具连着旧 HTTP Registry。

**获取修复：** 修复版本为 2.0.11，更新内容与安装方式见 [版本公告](CHANGELOG.md#2011--2026-10-07)。npm 暂存流程需维护者审核后才公开，可先安装 Release 附带的 `dsh-plugin-beyond-simulator-2.0.11.tgz`。替换旧代码后完整退出并重启一次，以清掉旧进程中未托管的路由。保留原版 `qxqy-simulator` insert；注释它会移除主组件，继续重装旧包也不会补上清理逻辑。

**回归入口与边界：** `test/lifecycle.test.mjs` 覆盖单组件反复重启、依赖重载、部分失败回滚、Worker 退出等待和卸载后的迟到请求，并通过 HTTP/工具双向修改验证共用当前 Registry。`scripts/smoke-dsh-tools.mjs` 在旧/新 Cordis 与工具运行时矩阵检查安装包重启和卸载；`scripts/smoke-harness-probe.mjs` 在完整 Harness 0.2.0-rc.2 宿主对唯一实例执行带活跃 Worker 的重启。修复前分别复现重复路由、残留路由和 Worker 未等待。

2026-10-07 在 Windows x64 / Node.js 22.23.2 / pnpm 10.15.0 完成：冻结锁文件安装；`pnpm test`（309 通过、7 项条件测试跳过、0 失败，其中插件 35 项全通过）；`pnpm pack:release`；`pnpm test:packages`（dsh-tools 0.1.0-rc.6 + Cordis 4.0.1、dsh-tools 0.2.0-rc.2 + Cordis 4.0.4）；`pnpm test:harness`（真实 Harness 0.2.0-rc.2，唯一实例两轮带 Worker 重启，HTTP/工具状态一致）。以上为本地直接观察：`evidence_source=observed`，运行端 `simulator`，`device_status=not_required`。反馈者 Desktop 的原始再激活触发链与修复包回验仍未覆盖。

## Harness 0.2 兼容性

2026-09-30 核对：npm 的 `latest` / `next` 均为 **0.2.0-rc.2**，0.2 仍为候选版本。主要发布变化：

- [0.2.0-rc.1（9 月 28 日）](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.2.0-rc.1)：插件管理、安装引导与配置保存优化；DeepSeek 账号模型免额外 API Key 搜索；图片失效重传和工具调度失败恢复；Windows 沙箱权限诊断；自动化任务拆为可选插件。
- [0.2.0-rc.2（9 月 29 日）](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.2.0-rc.2)：macOS / Windows 桌面端可安装内置 `dsh` 命令管理插件；模型搜索、文件夹外部打开、插件升级提示优化；PowerShell 完成状态识别修复；图形启动环境修复；第三方模型目录更新与实验性异步问答。

### 对模拟器的影响

1. **安装准入需要扩展。** Harness 依据 `peerDependencies` 中 `@deepseek-ai/dsh-*` 的范围检查当前宿主版本，预发布版本参与匹配；安装与启动分别检查。旧声明 `^0.1.0-rc.6` 不包含 0.2。插件 **2.0.7** 改为 `^0.1.0-rc.6 || ^0.2.0-rc.1`；继续由宿主提供 `dsh-tools`，开发基线保留旧版。依据：[0.2 App boot](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.0-rc.2/packages/boot/app-boot/README.md#profiles)、[Plugin Manager](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.0-rc.2/packages/boot/plugin-manager/README.md#version-compatibility-and-exemptions)。这是 0.2 实际执行的准入规则，不表示该机制首次出现在 0.2。
2. **修复声明式预设的 Skill 路径。** 完整宿主验收发现：预设虽在菜单可见，`qxqy-game-studio` 却无法发现。嵌入配置中的 `baseUrl` 来自合成 profile，并非预设目录；`new URL('skills/', baseUrl)` 指错位置。`scripts/build.mjs` 现在为嵌入版本通过包名解析安装目录，再定位随包 Skill；旧版复制预设仍使用相邻 `skills/`。回归入口 `test:harness` 必须读取到 Skill 正文和 `references/workflow.md`，只看到预设名称不算通过。
3. **已使用的运行接口兼容。** 实测 `defineTool`、JSON 参数/输出、附件图片、会话 cwd、HTTP 路由、ModuleLoader 与 `conversation.view` 可继续使用。本次不需要修改 Lua VM、Studio 数据格式或试玩协议。

### 验证与边界

- `pnpm test:packages` 在仓库外分别安装 `dsh-tools 0.1.0-rc.6 / Cordis 4.0.1` 和 `dsh-tools 0.2.0-rc.2 / Cordis 4.0.4`，经真实 ToolRuntime 验证 7 个工具、会话隔离、对象/字符串 JSON 参数、revision 冲突、Worker 与 PNG 图片内容，并验证 Web / MCP 包。
- 当时的 `pnpm test:harness` 使用 Harness `0.2.0-rc.2`，用独立 `DSH_HOME` 完成 tarball 安装、完整 Web 启动、宿主版本准入、Agent 预设与 Skill 发现、真实工具调用及附件服务、HTTP 页面检查；可传入已有 CLI 的 `lib/bin.js` 绝对路径复用安装。当前默认版本与扩展矩阵见下节；无需模型 API Key，该项已加入 npm 发布前验收。
- `pnpm test:git-install <CLI 的 lib/bin.js>` 使用 0.2 CLI 验证纯源码安装与 profile 注册。
- 本轮观察：Windows x64 / Node.js 22.23.2 / pnpm 10.15.0；浏览器实测模拟器标签、文本编辑、独立试玩启动与停止；0.2.0-rc.1 仅检查版本准入，完整执行验收针对 rc.2。桌面 Electron 宿主、Linux/macOS 和真实模型对话未在本机验收；桌面端文件协议与新窗口路径需单独验证，内置 `dsh` 命令可用不等于桌面嵌入 UI 已通过。

官方行为标记：`evidence_source=documented`，运行端 `official_document`；本轮测试标记：`evidence_source=observed`，运行端 `simulator`，`device_status=not_required`。模拟器包版本以根 `package.json` 为准；本地构建完成不等于 npm 已发布。

## Harness 0.2.1 兼容性

2026-10-18 核对官方 [0.2.1-rc.1 更新汇总](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.2.1-rc.1)（覆盖 0.2.0-rc.2 以来的变更）及 [0.2.1-rc.2](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.2.1-rc.2)。后者主要增加 DeepSeek-V4.1-Flash-1017 与 DeepSeek Search/Fetch API 支持；不应只看最后一个补丁版本而漏掉整个 0.2.1 系列的接口调整。以下官方结论均为 `evidence_source=documented`，运行端 `official_document`，`device_status=not_required`。

| 更新项 | 本插件的适配结论 |
|---|---|
| 不再注册 `cwd` 提示词变量 | 已移除随包 persona 中的旧引用，保留 `{{model}}`，兼容旧版。详见 [预设迁移](../agent/wonderland-lua-builder/README.md#persona-工作目录变量兼容性)与[官方变量约定](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-rc.2/packages/core/system-prompt/README.md#contribute-a-prompt-variable)。 |
| Agent 预设改为声明式注册 | 新版 [agent-preset-registry](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-rc.2/packages/preset/agent-preset-registry/src/index.ts) 不提供旧目录扫描。现有 `@deepseek-ai/dsh-agent-preset` 注册项可直接使用；旧版复制入口继续保留。新版需要更新插件内嵌预设，旧目录副本不是默认生效源。 |
| 版本兼容判断优先采用 `engines.dsh` | 我们未声明该字段，宿主仍按 DSH peer 范围并启用 `includePrerelease` 判断。但 npm 的普通 peer 解析不会把 0.2.1-rc.2 纳入原有 `^0.2.0-rc.1`，实际安装报 `ERESOLVE`。已为 `dsh-tools` 显式追加 `\|\| ^0.2.1-rc.1`，保留原两段范围和 0.1.0-rc.6 开发依赖，不用 `--force` 或忽略 peer 绕过。依据[宿主准入实现](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-rc.2/packages/boot/app-boot/src/plugin-compatibility.ts)与[SemVer 预发布规则](https://github.com/npm/node-semver#prerelease-tags)。 |
| 会话可通过 `working_directory` 切换当前目录 | [新服务](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-rc.2/packages/session/working-directory/README.md) 将当前目录放在投影中，`Session.header.cwd` 仍是原始工程。模拟器继续以原始工程根绑定存档和相对脚本，不把 Shell 的目录切换当作切换编辑器工程；这项行为保持旧版一致。 |
| 子代理统一立即返回 ID、支持独立预设；Agent Team 调整通知 | 本预设挂载官方 `tool-subagent`、控制和工作流插件，没有自写 SDK runtime、`session/wait` 或 outbox 消费代码。无需复制新协议；旧 `backgroundMode` 等配置在新版已不参与行为，保留供旧宿主使用。新子代理的行为由宿主决定，不能把旧配置当作新版同步等待承诺。 |
| 移除 invariant、`both` 展示及逐行 `agent-instructions.dshHome` | 本插件和预设未依赖这些入口/字段，也未替换旧 `stats` 行，无需兼容补丁。新增的模型、凭据优先级和搜索能力由官方服务处理；本插件不固定模型 ID、不读取模型密钥。 |
| 插件热重载、子路径元信息、界面扩展位调整 | 现有路由已由 effect 注销，重载验证继续执行。`conversation.view`、ModuleLoader、`defineTool`、JSON 输出和图片附件接口仍可用。子路径元信息不再回退根 package.json，但本插件没有依赖这种回退，不因此改动执行接口。 |

验收入口已补齐：`test:packages` 增加 `dsh-tools 0.2.1-rc.2 / Cordis 4.0.5`，保留 0.1.0-rc.6 与 0.2.0-rc.2 两组；`test:harness` 默认使用 0.2.1-rc.2，仍可传入旧版 CLI 路径。完整宿主探针会组装实际挂载预设的提示词并调用官方 `renderPrompt`，在发模型请求前检查变量错误，避免仅凭“预设可见、Skill 可读”漏掉这类启动故障。路由回归比较首次激活的数量，避免新增字体等正常路由造成固定条数误报。

本轮本地观察：Windows x64 / Node.js 22.23.2 / pnpm 10.15.0，本地插件构建版本 2.1.1；以下均为 `evidence_source=observed`，运行端 `simulator`，`device_status=not_required`。

- `pnpm install --lockfile-only --frozen-lockfile --offline --ignore-scripts` 通过，锁文件无需改动；`pnpm test` 共 357 项通过、9 项条件跳过、0 失败；`pnpm pack:release` 三个本地包构建通过。
- `pnpm test:packages` 三组均通过，覆盖实际 npm 安装、真实 ToolRuntime、JSON 参数、会话隔离、revision、Worker、PNG 附件、路由重载清理及 Web/MCP。修复前前两组通过，0.2.1-rc.2 组在安装阶段复现 `ERESOLVE`；追加 peer 范围后不加任何忽略 peer 的选项即可通过。
- 同一最终 tarball 分别经 Harness 0.2.0-rc.2 与 0.2.1-rc.2 的隔离 `DSH_HOME` 完整 Web 启动。预设实际提示词渲染、Skill 正文/引用读取、7 个工具、两种 PNG 附件、HTTP 试玩资源及两轮带 Worker 的组件重启均通过。
- `test:git-install` 传入 0.2.1-rc.2 CLI，通过源码 Git 依赖、`prepare` 构建、profile 注册、`--dump-config`、Client/Skill/预设、Worker 和 PNG。Windows 首次执行因 pnpm store 中已加载的 Canvas 原生 DLL 无法 unlink 而失败；对子进程设置 `npm_config_package_import_method=copy` 后通过。该次原始错误为 `EPERM`，不是构建审批拒绝，不能仅根据 Harness 随附的通用 Git 构建审批提示修改允许名单。此设置只用于隔离验收，没有修改用户的包管理器或 DSH 配置。

完整宿主验收与准入检查、单独 renderer 测试分别记录，不互相替代。

验证边界：没有调用真实模型，没有实跑模型子代理或 Agent Team，也没有操作用户的 Desktop 安装。Electron `file://`、Linux/macOS、SSH 文件系统和带路径前缀的 `--public-url` 代理部署未在本轮验收；现有 UI/试玩资源使用根绝对 URL，不能据此宣称子路径部署已兼容。更新说明中的这些新增部署能力不等于第三方插件自动完成适配。本地构建/测试完成不表示 npm 已发布。
