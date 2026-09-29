# 千星沙箱 DSH 插件

静态 Host + Client 插件。编辑状态按 DSH `sessionId` 隔离；每个会话以一个存档聚合服务端 UI、客户端模板和 Lua 脚本，支持完整存档包与单项 Authoring JSON/GIA/Lua 导入导出。Lua 试玩在独立浏览器标签页中展示，并运行于可终止的 Worker。

## 安装与更新

准备 Node.js 22+ 和 DeepSeek Harness，选择下面一种安装方式。GitHub 源码安装还需要 Git；本地安装包路径以仓库根目录为基准，在其他目录安装时请换成 `.tgz` 的绝对路径。

```powershell
# 从 npm 安装
dsh plugin --profile web add dsh-plugin-beyond-simulator
# 或，从 GitHub 默认分支源码安装
dsh plugin --profile web add github:1475505/miliastra-beyond-simulator
# 或，从本地安装包安装
dsh plugin --profile web add ./release/dsh-plugin-beyond-simulator-2.0.7.tgz

dsh --profile web --dump-config
dsh web
```

安装新版时也使用 `add`，然后重启 Harness。`--dump-config` 可用于确认插件已加载。版本及文件名以 `release/manifest.json` 为准。使用预构建 tarball 安装，无需相邻 Studio 源码或构建工具。

GitHub 安装使用仓库默认分支，无需指定 `#master`。安装时会安装构建依赖并运行根目录的 `prepare`，生成插件及其资源。若 pnpm 提示需要批准构建，请按提示允许本插件（或错误中给出的精确 Git 依赖键），再重新执行安装命令。安装入口是仓库根目录，`dsh-plugin` 子目录是内部源码包。实现见 [分发说明](../DISTRIBUTION.md#harness-安装入口)。

已有的用户 Agent 预设不会被升级覆盖；如需更新预设，请先备份自己的修改，再按下文的预设安装说明处理。

若需要从源码生成安装包，准备 pnpm 10.15.0，在仓库根执行：

```sh
pnpm install --frozen-lockfile
pnpm test
pnpm pack:release
pnpm test:packages
pnpm test:git-install
pnpm test:harness
```

Host Tools：`qxqy_studio_get`、`qxqy_studio_patch`、`qxqy_studio_play`、`qxqy_studio_ui_screenshot`、`qxqy_studio_play_screenshot`、`qxqy_studio_load`。截图由 Host 在进程内根据 `boxes` / `paint` 渲染 PNG，不需要打开模拟器标签或试玩页。

磁盘存档发现与 MCP / Web 共用 Studio 实现：支持超过 8 MiB 的存档，按修改时间选取最新 50 项，并返回扫描限制和读取问题的 `discovery` 信息。显式加载仍允许工作区内的相对路径或绝对路径；隐藏目录、列表上限等自动发现限制不影响指定路径加载，路径穿越与符号链接逃逸仍会被拒绝。控制器加载成功后记住工作区相对路径，后续省略保存路径会写回该文件；未绑定工作区时列表仍返回 `{ bound: false, archives: [] }`。

插件同时注册 runtime skill `qxqy-simulator`：正文源文件是 [`../skill/SKILL.md`](../skill/SKILL.md)，构建时复制为包内 `dsh-plugin/skill.md`，经独立 bundle 行（只注入 `skills` 服务）调用 `ctx.skills.register` 注册。模型通过技能目录自动发现并按需加载，无需用户手动安装；该服务缺失时仅技能不可见，主功能不受影响。

插件随包附带 agent 预设 `wonderland-lua-builder`（千星 2D+Lua 游戏制作）：源目录 [`../agent/wonderland-lua-builder`](../agent/wonderland-lua-builder)。构建时把 `agent.cordis.yml` 嵌入 `dsh-plugin/cordis.patch.yml`。在提供 `@deepseek-ai/dsh-agent-preset` 的 DSH 0.1.7-rc.1 及更新版本中，新版注册项会启用；旧版 DSH 自动跳过它，避免缺失模块阻塞启动。旧版复制入口始终保留：启动时仅当 `$DSH_HOME/.agent-presets/wonderland-lua-builder` 不存在，才从包内 `dsh-plugin/presets/` 复制，已有用户预设不覆盖。支持预设选择的 DSH 中，可在「设置 → Agent 预设」选择；已有任务不会自动切换。

编辑器自动跟随 Harness 亮/暗主题并占满宿主内容高度，分为“UI 编辑 / Lua 脚本 / 服务端逻辑”三个页面。顶栏显示存档名、会话工作区和当前资产。点击“试玩 ↗”会先保存脚本与服务端逻辑，再打开同源 `/qxqy-simulator/play#<sessionId>`；试玩画面由 PixiJS v8 WebGL 渲染，Runtime 仍在 Worker 内推进并独占 Lua、布局、锚点、命中和测试语义。`qxqy_studio_play_screenshot` 根据 Runtime `paint` 在 Host 出 PNG，`qxqy_studio_ui_screenshot` 根据编辑器 `boxes` 出舞台 PNG，都不依赖可见页签。完整使用与排障见 [`../../docs/simulator-usage.md`](../../docs/simulator-usage.md)。

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
- `pnpm test:harness` 默认在临时目录安装 Harness `0.2.0-rc.2`，用独立 `DSH_HOME` 完成 tarball 安装、完整 Web 启动、宿主版本准入、Agent 预设与 Skill 发现、真实工具调用及附件服务、HTTP 页面检查；可传入已有 CLI 的 `lib/bin.js` 绝对路径复用安装。无需模型 API Key。该项已加入 npm 发布前验收。
- `pnpm test:git-install <CLI 的 lib/bin.js>` 使用 0.2 CLI 验证纯源码安装与 profile 注册。
- 本轮观察：Windows x64 / Node.js 22.23.2 / pnpm 10.15.0；浏览器实测模拟器标签、文本编辑、独立试玩启动与停止；0.2.0-rc.1 仅检查版本准入，完整执行验收针对 rc.2。桌面 Electron 宿主、Linux/macOS 和真实模型对话未在本机验收；桌面端文件协议与新窗口路径需单独验证，内置 `dsh` 命令可用不等于桌面嵌入 UI 已通过。

官方行为标记：`evidence_source=documented`，运行端 `official_document`；本轮测试标记：`evidence_source=observed`，运行端 `simulator`，`device_status=not_required`。模拟器包版本以根 `package.json` 为准；本地构建完成不等于 npm 已发布。
