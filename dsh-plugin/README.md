# 千星沙箱 DSH 插件

静态 Host + Client 插件。编辑状态按 DSH `sessionId` 隔离；每个会话以一个存档聚合服务端 UI、客户端模板和 Lua 脚本，支持完整存档包与单项 Authoring JSON/GIA/Lua 导入导出。Lua 试玩在独立浏览器标签页中展示，并运行于可终止的 Worker。

## 安装与更新

准备 Node.js 22+ 和 DeepSeek Harness，选择下面一种安装方式。GitHub 源码安装还需要 Git；本地安装包路径以仓库根目录为基准，在其他目录安装时请换成 `.tgz` 的绝对路径。

```powershell
# 从本地安装包安装
dsh plugin --profile web add ./release/dsh-plugin-beyond-simulator-1.0.5.tgz
# 或，从 GitHub 默认分支源码安装
dsh plugin --profile web add github:1475505/miliastra-beyond-simulator

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
```

Host Tools：`qxqy_studio_get`、`qxqy_studio_patch`、`qxqy_studio_play`、`qxqy_studio_ui_screenshot`、`qxqy_studio_play_screenshot`、`qxqy_studio_load`。截图由 Host 在进程内根据 `boxes` / `paint` 渲染 PNG，不需要打开模拟器标签或试玩页。

插件同时注册 runtime skill `qxqy-simulator`：正文源文件是 [`../skill/SKILL.md`](../skill/SKILL.md)，构建时复制为包内 `dsh-plugin/skill.md`，经独立 bundle 行（只注入 `skills` 服务）调用 `ctx.skills.register` 注册。模型通过技能目录自动发现并按需加载，无需用户手动安装；该服务缺失时仅技能不可见，主功能不受影响。

插件随包附带 agent 预设 `wonderland-lua-builder`（千星 2D+Lua 游戏制作）：源目录 [`../agent/wonderland-lua-builder`](../agent/wonderland-lua-builder)，构建时同步为包内 `dsh-plugin/presets/wonderland-lua-builder`，经独立 bundle 行（`dsh-plugin-beyond-simulator/preset`）在启动时复制到 `$DSH_HOME/.agent-presets/wonderland-lua-builder`。预设名册的 roots 被 CLI 钉死为 shipped 根，用户根（`includeUserRoot`）是唯一可扩展来源，因此用物化目录的方式安装；roster 每次读取重扫磁盘，复制完成预设立即可见。已存在则跳过、绝不覆盖用户改动；删除目标目录后重启即重装。

编辑器自动跟随 Harness 亮/暗主题并占满宿主内容高度，分为“UI 编辑 / Lua 脚本 / 服务端逻辑”三个页面。顶栏显示存档名、会话工作区和当前资产。点击“试玩 ↗”会先保存脚本与服务端逻辑，再打开同源 `/qxqy-simulator/play#<sessionId>`；试玩画面由 PixiJS v8 WebGL 渲染，Runtime 仍在 Worker 内推进并独占 Lua、布局、锚点、命中和测试语义。`qxqy_studio_play_screenshot` 根据 Runtime `paint` 在 Host 出 PNG，`qxqy_studio_ui_screenshot` 根据编辑器 `boxes` 出舞台 PNG，都不依赖可见页签。完整使用与排障见 [`../../docs/simulator-usage.md`](../../docs/simulator-usage.md)。
