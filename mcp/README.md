# beyond-simulator-mcp

独立的 MCP stdio server，让 Codex 或其他 MCP client 直接驱动千星沙箱模拟器。它不依赖 DSH；编辑和试玩仍复用 `../studio`、`../client/lua-runtime` 与 `../server`。

## 安装与自检

推荐 Node.js 22+。源码开发在仓库根统一安装与构建：

```powershell
cd E:\qxqy-lua\simulator
pnpm install --frozen-lockfile
pnpm build
pnpm --filter beyond-simulator-mcp test
```

直接运行时，server 通过 stdin/stdout 使用 MCP JSON-RPC；stdout 只输出协议消息，诊断信息应写到 stderr。工作区默认是启动进程的当前目录，也可以显式指定：

```powershell
node .\mcp\dist\index.js --workspace E:\qxqy-lua
```

也支持环境变量：

```powershell
$env:QXQY_WORKSPACE = 'E:\qxqy-lua'
node .\mcp\dist\index.js
```

## Codex 接入

在 Codex 的 MCP 配置中添加一个本地 stdio server。Codex CLI/Desktop 的配置文件通常是 `%USERPROFILE%/.codex/config.toml`，配置如下：

```toml
[mcp_servers.qxqy_simulator]
command = "node"
args = ["E:/qxqy-lua/simulator/mcp/dist/index.js", "--workspace", "E:/qxqy-lua"]
startup_timeout_sec = 120
```

也可以把工作区放进环境变量：

```toml
[mcp_servers.qxqy_simulator.env]
QXQY_WORKSPACE = "E:/qxqy-lua"
```

也可以直接从 npm 安装：

```sh
npm install -g beyond-simulator-mcp
```

包包含核心和 Worker，无需相邻源码。安装到 PATH 后，可把 `command` 设为 `beyond-simulator-mcp` 并仅传 `--workspace` 和工作区绝对路径。更新时再次执行 `npm install -g beyond-simulator-mcp` 并重启客户端。保存配置并重启客户端后，在工具列表中应看到：

- `qxqy_project_open` / `qxqy_project_save`
- `qxqy_studio_get` / `qxqy_studio_patch`
- `qxqy_studio_play`
- `qxqy_studio_ui_screenshot` / `qxqy_studio_play_screenshot`
- `qxqy_studio_load`

典型调用顺序：

```text
qxqy_project_open({ path: "workspace/flappy-fish/flappy-fish.save.json" })
qxqy_studio_get({ handle: "project-1" })
qxqy_studio_patch({ handle: "project-1", op: { ... , expectedRevision: N } })
qxqy_project_save({ handle: "project-1", path: "workspace/flappy-fish/flappy-fish.save.json" })
```

`qxqy_project_open` 返回的 `handle` 是 MCP server 进程内的工程句柄；每个后续工具调用都必须带它。写操作必须使用最新的 `expectedRevision`。工程保存是显式操作，不会因为 `patch` 自动写盘。

截图工具以标准 MCP image content 返回 PNG；`qxqy_studio_play_screenshot` 需要先 `qxqy_studio_play({ action: "start" })`，且不会推进运行时。

如果希望在 Codex 保存 JSON 后立即在浏览器查看，而不导入 DSH，可同时启动 `../web`：

```powershell
cd E:\qxqy-lua\simulator
pnpm start:web --workspace E:\qxqy-lua --open
```

Web 的 `/` 预览页会监听当前存档并刷新；`/editor` 中的未保存草稿不会自动被替换。详见 [`../web/README.md`](../web/README.md)。

## 工具边界

- 路径只能是配置工作区内的相对路径；server 会拒绝路径穿越和符号链接逃逸。
- `qxqy_studio_play` 的动作和参数沿用 DSH 模拟器工具契约。
- 未实现或未知的模拟器语义返回明确错误，不会伪造成功。
- 每个工程句柄串行执行操作；不同句柄相互隔离。

## 协议实现

当前使用 MCP stdio 的逐行 JSON-RPC 传输，支持 `initialize`、`ping`、`tools/list`、`tools/call` 以及取消通知，并协商 `2024-11-05` 至 `2025-11-25` 的 legacy MCP 版本。MCP 包不包含 DSH Client UI 或 Skill；可视编辑可使用独立 Web 的 `/editor` 或 DSH 插件。
