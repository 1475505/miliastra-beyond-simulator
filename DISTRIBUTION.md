# 分发设计

上级：[项目文档树](README.md#文档树)。

## 仓库与包边界

采用单仓库 pnpm workspace，保留现有模块路径。根 `package.json` 同时是开发入口和 `dsh-plugin-beyond-simulator` 的对外清单，维护插件版本、exports、运行依赖与 `dsh.bundle`。`dsh-plugin/package.json` 仅声明私有源码包 `qxqy-dsh-adapter`，不再重复维护对外包名和版本。`client/lua-runtime`、`server`、`studio`、`editor-ui` 同样为私有内部包，通过 `workspace:*` 引用。Web、MCP 的对外清单与版本仍在各自目录。单一 `pnpm-lock.yaml` 记录依赖。

`scripts/build.mjs` 为 Web、Harness、MCP 分别生成 ESM Node 入口及同目录 Worker。核心 JavaScript 打入产品；`fengari`、`@napi-rs/canvas` 保留为明确的运行依赖。DSH 的完整 `protobufjs` 随 Host 和 Worker 打入，避免 GIA 的导入期解析依赖宿主共享 CommonJS 状态；Web/MCP 继续显式依赖外部 `protobufjs`。Canvas 的原生依赖按安装平台选取。Pixi 和 Web React 编译进浏览器资源；Harness 从宿主取得 React。

`editor-ui` 只接收 React、API 调用函数和试玩 URL，不依赖 Harness 服务。Harness 薄适配层负责 slots / ModuleLoader；Web 薄适配层负责 React 挂载、标签页会话与保存入口。双方共用原有控件编辑、脚本、服务端逻辑及试玩界面。

## 打包流程

在根目录执行 `pnpm pack:release`：

1. 构建三个产品；同步 Harness Skill 和 agent 预设，生成 Web / Harness 浏览器资源。
2. DSH 读取根清单，Web / MCP 读取子目录清单；按各自 `files` 白名单复制到 `release/staging`，去掉开发依赖、构建及安装生命周期脚本。
3. 拒绝生产依赖中的 `workspace:`、`file:`、`link:`；从 staging 执行 `npm pack --ignore-scripts`。
4. 生成三个 tarball、当前批次清单和 SHA-256。

然后运行 `pnpm test:packages`。检查在仓库外完成，内部核心包不可解析；验证真实 Worker、PNG、GIA、Web 编辑保存及 MCP stdio，防止通过本地软链接意外掩盖漏包。

DSH 分发同时执行 `pnpm test:harness`，在隔离 profile 中安装并启动真实 Harness 0.2.2；该宿主要求 Node.js 24.9+，发布 CI 使用 Node.js 24.21.0。旧/新工具运行时矩阵、完整宿主和预设资源的验证范围见 [插件兼容说明](dsh-plugin/README.md#验证入口与边界)。构建与上述测试应顺序运行，`pnpm test` 和 `pack:release` 都会重建同一批资源，不能并行。

`release/`、`dist/`、依赖与生成资源不提交。重复打包可能保留旧版本 tarball，以 `manifest.json` 识别当次产物。根包的 `prepare` 服务于源码安装；预构建交付使用根打包命令产生的清洁 tarball。DSH 安装包内保留 `dsh-plugin/` 路径，根 exports 和 bundle 声明定位到该目录的构建产物。

## Harness 安装入口

Harness 将 `plugin add` 的参数交给 pnpm，可直接从 GitHub 源码安装，不要求先发布到 npm。机制依据见 [Harness 发布文档](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/basic/publish.md#installing-from-github-the-build-script-catch)及 [pnpm 10 包来源](https://pnpm.io/10.x/package-sources)。

从仓库默认分支安装：

```sh
dsh plugin --profile web add github:1475505/miliastra-beyond-simulator
```

安装流程如下：

1. pnpm 获取整个源码仓库，并根据 workspace 与锁文件安装构建依赖。
2. 根 `prepare` 执行 `node scripts/build.mjs dsh-plugin`，复用现有构建脚本生成插件、Worker、浏览器资源、Skill 和 Agent 预设。
3. 按根 `files` 白名单打包安装产物；运行时依赖在根清单中声明，不依赖源码里的 workspace 链接。
4. Harness 根据根 `dsh.bundle` 注册插件，通过 exports 加载 Host、Client、Skill 和旧版预设复制入口；Agent 预设同时由构建生成的 patch 声明注册。旧入口仅在目标不存在时复制到 `.agent-presets`，不覆盖用户文件。

维护一个源码分支即可。需要固定版本时，可在仓库地址后附加 `#<tag>` 或 `#<commit>`。Git 源码安装需要 Node.js 22+、Git 和构建脚本执行权限；若 pnpm 拒绝执行 `prepare`，按错误提示在该 profile 的允许名单中加入本插件或指定的精确 Git 依赖键后重试。预构建 `.tgz` 安装仍保留，安装者无需编译。

`pnpm test:git-install` 会把 Git 跟踪文件和未忽略的新文件复制成临时纯源码仓库，确认不包含 `dist`，再通过真实 Git 依赖安装并验证。可传入本机 DSH CLI 的 `lib/bin.js` 绝对路径，额外在临时 `DSH_HOME` 中执行真正的 `dsh plugin add` 和 `--dump-config`；不会修改原仓库历史或用户 profile。它与 `test:packages` 分别覆盖源码安装和预构建包安装。

`dsh.bundle.patch` 与包内 `cordis.patch.yml` 保留，适配[社区目录](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/blob/main/contributing.md)的插件入口要求；收录与下载状态以实际公开页面为准。

## Web 部署边界

Web 是Node单用户自托管服务，`/` 为存档监听预览，`/editor` 为共用编辑器。每个会话独立Controller / Worker；保存要求最新revision并校验加载时磁盘内容哈希，防止覆盖MCP或其他标签页的更新。

默认监听回环地址；绑定非回环地址必须提供口令，所有业务页面/API 都需要认证。请求 JSON 和同源校验用于限制浏览器跨站写入。工作区路径检查复用核心逻辑，不允许相对路径越界或符号链接逃逸。它们不是多租户授权或不可信代码执行隔离；不要将同一实例交给互不信任的用户。

Docker 使用相同的 tarball 流程，以非 root 用户运行并保留 `/data`。静态托管版本、多用户身份/配额、会话持久化以及 WebSocket 推送属于后续独立工作，不包含在当前交付中。

## 仓库与许可证

源码仓库为 `1475505/miliastra-beyond-simulator`，采用 [GPL-3.0-only](LICENSE)，三个分发包均附带完整许可证。自动发布流程见下节，公开发布说明见 [GitHub Releases](https://github.com/1475505/miliastra-beyond-simulator/releases)。

源码版本以各产品 `package.json` 为准，本地安装包以 `release/manifest.json` 为准，npm 公开版本以 registry 为准；暂存工作流成功不表示已经公开上线。

## 自动发布到 npm

工作流文件是 `.github/workflows/publish-npm.yml`，推送 `npm-*` Git tag 时触发。它在 GitHub 托管的 Ubuntu runner 上运行冻结锁文件安装、回归测试、Git 源码安装验收、三个包的构建和仓库外安装验收。`scripts/publish-npm.mjs` 在发布前校验 tarball 哈希；同版本同内容会跳过，同版本不同内容会失败并要求增加版本号。Tag 必须指向已提交并推送的目标源码与版本。

Ubuntu CI 显式安装 Fontconfig、DejaVu 和 Noto CJK，不依赖 runner 镜像预装字体。字体只安装在验收环境，不进入源码或发布包；文字绘制由常规渲染回归验证，不另设重复的 CI 绘字检查。

仅验证测试或文档改动时，可手动运行同一工作流；仍执行完整验收，但跳过 npm 暂存，不必为重复验收创建发布 tag。

在 npm 的以下三个包页面分别进入 **Settings → Trusted publishing → GitHub Actions**，配置相同的发布者：[DSH 插件](https://www.npmjs.com/package/dsh-plugin-beyond-simulator)、[Web](https://www.npmjs.com/package/beyond-simulator-web)、[MCP](https://www.npmjs.com/package/beyond-simulator-mcp)。填写 **Organization or user** `1475505`、**Repository** `miliastra-beyond-simulator`、**Workflow filename** `publish-npm.yml`；**Environment name** 留空，**Allow npm publish** 保持不勾选，只允许 `npm stage publish`。不需要在 GitHub 配置 `NPM_TOKEN`。工作流使用 `id-token: write` 获取 npm 的短期 OIDC 凭据。

发布时，为发生变更的包更新 `package.json` 版本并提交推送，再在该提交创建并推送新 tag。未变化的包会跳过。工作流成功后，在 npmjs.com 的 **Staged Packages** 页面逐个检查并点击 **Approve**，通过 2FA 后版本才会公开；也可用 `npm stage list <包名>` 查找 stage ID，再运行 `npm stage approve <stage-id>`。审批后到 registry 可查询可能有几分钟延迟。

按产品发布时使用以下 tag；仍执行完整构建/验收，最后仅校验和暂存所选产品的 tarball，不检查或发布其他产品的同版本产物：

| 发布范围 | Tag 示例 | 本地预检 |
|---|---|---|
| 仅 DSH 插件 | `npm-dsh-2026-10-07-1` | `node scripts/publish-npm.mjs --check --product=dsh-plugin` |
| 仅 MCP | `npm-mcp-2026-10-07-1` | `node scripts/publish-npm.mjs --check --product=mcp` |
| 仅 Web | `npm-web-2026-10-18-1` | `node scripts/publish-npm.mjs --check --product=web` |
| 三包 | `npm-2026-10-07-1` | `node scripts/publish-npm.mjs --check` |

Git tag 触发 npm 流程，不会自动创建 GitHub Release。版本公告单独创建 Release，并仅附加本次发布产品的安装包。

## 验收入口与证据范围

日常回归执行 `pnpm test`；分发改动另执行 `pnpm pack:release`、`pnpm test:packages`；Git 源码安装入口、根 `prepare` 或 DSH exports 改动另执行 `pnpm test:git-install`。测试使用仓库内合成数据，不依赖父级知识库或游戏工程。

浏览器测试通过`QXQY_BROWSER`指定Chrome/Edge，Electron隔离宿主测试通过`QXQY_ELECTRON`启用；未配置时明确跳过。包检查使用`scripts/smoke-installed.mjs`，真实Harness使用`scripts/smoke-harness*.mjs`；兼容矩阵与未覆盖环境见[DSH入口](dsh-plugin/README.md#验证入口与边界)。测试结果是`observed / simulator`，发布身份记录在当次manifest及发布记录，专题文档不重复维护历史测试总数。
