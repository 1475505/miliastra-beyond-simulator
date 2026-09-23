# 分发设计

## 仓库与包边界

采用单仓库 pnpm workspace，保留现有模块路径。根 `package.json` 同时是开发入口和 `dsh-plugin-beyond-simulator` 的对外清单，维护插件版本、exports、运行依赖与 `dsh.bundle`。`dsh-plugin/package.json` 仅声明私有源码包 `qxqy-dsh-adapter`，不再重复维护对外包名和版本。`client/lua-runtime`、`server`、`studio`、`editor-ui` 同样为私有内部包，通过 `workspace:*` 引用。Web、MCP 的对外清单与版本仍在各自目录。单一 `pnpm-lock.yaml` 记录依赖。

`scripts/build.mjs` 为 Web、Harness、MCP 分别生成 ESM Node 入口及同目录 Worker。核心 JavaScript 打入产品；`fengari`、`protobufjs`、`@napi-rs/canvas` 保留为明确的运行依赖。Canvas 的原生依赖按安装平台选取。Pixi 和 Web React 编译进浏览器资源；Harness 从宿主取得 React。

`editor-ui` 只接收 React、API 调用函数和试玩 URL，不依赖 Harness 服务。Harness 薄适配层负责 slots / ModuleLoader；Web 薄适配层负责 React 挂载、标签页会话与保存入口。双方共用原有控件编辑、脚本、服务端逻辑及试玩界面。

## 打包流程

在根目录执行 `pnpm pack:release`：

1. 构建三个产品；同步 Harness Skill 和 agent 预设，生成 Web / Harness 浏览器资源。
2. DSH 读取根清单，Web / MCP 读取子目录清单；按各自 `files` 白名单复制到 `release/staging`，去掉开发依赖、构建及安装生命周期脚本。
3. 拒绝生产依赖中的 `workspace:`、`file:`、`link:`；从 staging 执行 `npm pack --ignore-scripts`。
4. 生成三个 tarball、当前批次清单和 SHA-256。

然后运行 `pnpm test:packages`。检查在仓库外完成，内部核心包不可解析；验证真实 Worker、PNG、GIA、Web 编辑保存及 MCP stdio，防止通过本地软链接意外掩盖漏包。

`release/`、`dist/`、依赖与生成资源不提交。重复打包可能保留旧版本 tarball，以 `manifest.json` 为本轮产物清单。根包的 `prepare` 服务于源码安装；预构建交付使用根打包命令产生的清洁 tarball。DSH 安装包内保留 `dsh-plugin/` 路径，根 exports 和 bundle 声明定位到该目录的构建产物。

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

`dsh.bundle.patch` 与包内 `cordis.patch.yml` 保留，适配社区目录的插件入口要求。[社区收录](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/blob/main/contributing.md)及实际下载地址待发布完成后补充。

## Web 部署边界

本轮 Web 是 Node 单用户自托管服务，保留 `/` 的存档监听预览并新增 `/editor` 共用编辑器。每个会话独立 Controller / Worker；保存要求最新 revision，且校验加载时磁盘内容哈希，防止覆盖 MCP 或其他标签页的更新。

默认监听回环地址；绑定非回环地址必须提供口令，所有业务页面/API 都需要认证。请求 JSON 和同源校验用于限制浏览器跨站写入。工作区路径检查复用核心逻辑，不允许相对路径越界或符号链接逃逸。它们不是多租户授权或不可信代码执行隔离；不要将同一实例交给互不信任的用户。

Docker 使用相同的 tarball 流程，以非 root 用户运行并保留 `/data`。静态托管版本、多用户身份/配额、会话持久化以及 WebSocket 推送属于后续独立工作，不包含在当前交付中。

## 仓库与许可证

根包的 `repository` 已指向 `1475505/miliastra-beyond-simulator`。采用 [GPL-3.0-only](LICENSE)，三个分发包均附带完整许可证，并已通过 `dudukl` 发布到 npm。自动发布使用 [GitHub Actions](.github/workflows/publish-npm.yml)，从 Git tag 构建并验收三个 tarball，再通过 npm Trusted Publishing 暂存版本有变化的包，等待维护者审核后上线；不创建专用产物分支。

当前 npm `latest`：`dsh-plugin-beyond-simulator@1.0.9`、`beyond-simulator-web@0.1.3`、`beyond-simulator-mcp@0.1.3`。原 MCP 包名 `qxqy-simulator-mcp@0.1.3` 仍保留为历史名称；新项目使用 `beyond-simulator-mcp`。DSH 1.0.9 在旧版 DSH 缺少新版 Agent 预设模块时跳过注册项，保留目录复制入口；在 DSH 0.1.7-rc.1 中启用新版注册项。

## 自动发布到 npm

工作流文件是 `.github/workflows/publish-npm.yml`，推送 `npm-*` Git tag 时触发。它在 GitHub 托管的 Ubuntu runner 上运行冻结锁文件安装、回归测试、Git 源码安装验收、三个包的构建和仓库外安装验收。`scripts/publish-npm.mjs` 在发布前校验 tarball 哈希；同版本同内容会跳过，同版本不同内容会失败并要求增加版本号。首次推送该工作流前，先把本地源码改动提交并推送到仓库；标记的提交必须包含这份工作流和要发布的版本。

在 npm 的以下三个包页面分别进入 **Settings → Trusted publishing → GitHub Actions**，配置相同的发布者：[DSH 插件](https://www.npmjs.com/package/dsh-plugin-beyond-simulator)、[Web](https://www.npmjs.com/package/beyond-simulator-web)、[MCP](https://www.npmjs.com/package/beyond-simulator-mcp)。填写 **Organization or user** `1475505`、**Repository** `miliastra-beyond-simulator`、**Workflow filename** `publish-npm.yml`；**Environment name** 留空，**Allow npm publish** 保持不勾选，只允许 `npm stage publish`。不需要在 GitHub 配置 `NPM_TOKEN`。工作流使用 `id-token: write` 获取 npm 的短期 OIDC 凭据。

以后发布时，先为发生变更的包更新 `package.json` 版本并提交推送，再在该提交创建并推送一个新 tag，例如 `npm-2026-09-24-1`。只改代码而不增加对应包的版本号会触发“同版本不同内容”保护，不会覆盖 npm 上已发布的内容；未变化的包会跳过。工作流成功后，在 npmjs.com 的 **Staged Packages** 页面逐个检查并点击 **Approve**，通过 2FA 后版本才会公开；也可以使用 `npm stage list <包名>` 查找 stage ID，再运行 `npm stage approve <stage-id>`。审批后到 npm registry 可查询可能有几分钟延迟。

## 最新验收：主分支源码安装

2026-09-23，DSH 更新为 `1.0.5`，Web / MCP 保持 `0.1.2`。验证环境为 Windows x64 / Node.js 22.23.2 / pnpm 10.15.0 / Harness CLI 0.1.0-rc.6。

- 冻结锁文件安装通过，根 `prepare` 自动生成 DSH 插件。
- 完整回归 181 项通过，0 失败、0 跳过。
- 从不含构建产物的临时 Git 仓库通过 `#master` 安装成功；验证 bundle、Client、Skill、预设、Worker 和 PNG。
- 在临时 `DSH_HOME` 中执行实际 `dsh plugin --profile web add` 成功，profile 自动登记插件，`--dump-config` 包含主插件、Skill 和预设三项配置。
- 重建 `dsh-plugin-beyond-simulator-1.0.5.tgz`、`beyond-simulator-web-0.1.2.tgz`、`qxqy-simulator-mcp-0.1.2.tgz`；三个包均通过仓库外安装验收，校验值、README、Skill 与预设内容已核对。

以上 Git 安装使用本地 Git 源，未验证公开 GitHub 地址；代码尚未推送，用户的 Harness profile 未改动。没有新增发布分支。本机没有 Docker，未实跑容器。

## 先前本地构建

2026-09-23，重新构建并验证以下安装包：

| 产品 | 包名 | 版本 | 本地安装包 |
|---|---|---|---|
| Harness 插件 | `dsh-plugin-beyond-simulator` | `1.0.4` | `release/dsh-plugin-beyond-simulator-1.0.4.tgz` |
| Web | `beyond-simulator-web` | `0.1.2` | `release/beyond-simulator-web-0.1.2.tgz` |
| MCP | `qxqy-simulator-mcp` | `0.1.2` | `release/qxqy-simulator-mcp-0.1.2.tgz` |

Web 启动命令同步改为 `beyond-simulator-web`；Docker 配置和安装验收使用同一包名。

验证环境为 Windows x64 / Node.js 22.23.2 / pnpm 10.15.0：冻结锁文件安装成功；181 项回归通过，0 失败、0 跳过；三个安装包在源码仓库外安装并通过 DSH、Web 和 MCP 验收。另核对了包名、版本、SHA-256、包内 README、Skill 与 Agent 预设和源文件一致。未安装到用户的 Harness profile，未公开发布；本机没有 Docker，未实跑容器。

## 先前验收记录

2026-09-22，Windows x64 / Node.js 22.23.2 / pnpm 10.15.0：

- 冻结锁文件安装成功；本机具备外部样本时，完整回归 181 项通过，0 失败、0 跳过。
- 将 `QXQY_FIXTURE_ROOT` 指向空工作区时，166 项通过，15 项外部样本测试明确跳过，0 失败。
- 三个 tarball 在源码目录外、禁用安装生命周期脚本的临时 npm 工程中通过 Controller、Worker、GIA、PNG、Web 编辑保存、MCP stdio 验证。
- 实际浏览器检查 Web 编辑界面、修改属性、保存落盘与独立试玩页渲染/暂停；Harness Client 通过编译及 ModuleLoader 导出契约检查，没有修改用户现有 Harness profile。
- 本机没有 Docker，未实跑容器；尚未验证 Linux/macOS 或公开 npm/GitHub 安装渠道。以上都是模拟器与分发验证，不新增千星真机结论。
