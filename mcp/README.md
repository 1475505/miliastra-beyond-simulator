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
node .\mcp\dist\index.js --workspace E:\qxqy-lua --web-url http://127.0.0.1:4173
```

也支持环境变量：

```powershell
$env:QXQY_WORKSPACE = 'E:\qxqy-lua'
$env:QXQY_WEB_URL = 'http://127.0.0.1:4173'
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
QXQY_WEB_URL = "http://127.0.0.1:4173"
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
- `qxqy_preview_status` / `qxqy_preview_open`

典型调用顺序：

```text
qxqy_project_open({ path: "workspace/flappy-fish/flappy-fish.save.json" })
qxqy_studio_get({ handle: "project-1" })
qxqy_studio_patch({ handle: "project-1", op: { ... , expectedRevision: N } })
qxqy_project_save({ handle: "project-1", path: "workspace/flappy-fish/flappy-fish.save.json" })
qxqy_preview_open({ path: "workspace/flappy-fish/flappy-fish.save.json" })
```

`qxqy_project_open` 返回的 `handle` 是 MCP server 进程内的工程句柄；工程级读写和试玩工具必须带它，预览工具无需句柄。写操作必须使用最新的 `expectedRevision`。工程保存是显式操作，不会因为 `patch` 自动写盘。保存省略 `path` 时沿用最近成功打开或保存的路径；只有新工程默认使用 `qxqy-simulator.save.json`。传入新路径表示另存，此后省略路径会写回该新路径。

截图工具以标准 MCP image content 返回 PNG；`qxqy_studio_play_screenshot` 需要先 `qxqy_studio_play({ action: "start" })`，且不会推进运行时。

如果希望在 Codex 保存 JSON 后立即在浏览器查看，而不导入 DSH，可同时启动 `../web`：

```powershell
cd E:\qxqy-lua\simulator
pnpm start:web --workspace E:\qxqy-lua --open
```

Web 的 `/` 预览页会监听磁盘：启动时还没有存档，会在 Codex 保存后自动打开发现的最新 JSON；已经打开的文件变化时会重新加载。预览正在显示 A 时，保存 B 不会自动切换到 B；使用 `qxqy_preview_open({ path: "B.save.json" })` 明确切换。`/editor` 中的未保存草稿不会自动被替换。详见 [`../web/README.md`](../web/README.md)。

预览连接默认使用 `http://127.0.0.1:4173`；`--web-url` 优先于 `QXQY_WEB_URL`。地址须为 HTTP(S) origin，例如 `http://127.0.0.1:4180`，不含用户名、口令或路径。Web 启用口令时，在 MCP 与 Web 进程环境中设置相同的 `QXQY_WEB_PASSWORD`，MCP 使用用户名 `simulator` 的 HTTP Basic 认证。两边的 `--workspace` 必须指向同一个本地目录，桥接会解析真实路径并在发送打开请求前验证服务身份和工作区；服务端也验证预期工作区。

`qxqy_preview_status()` 返回 Web 确认的 `url`、`version`、`workspace`、`activePath`、`name`、`revision`、`lastError` 与 `lastLoadedAt`。`qxqy_preview_open()` 返回同类回执和 `requestedPath`，只打开磁盘中的文件，不会保存 MCP 中的修改，也不会绕过工作区路径边界。直接指定路径不受自动存档列表的筛选限制，已有存档无需为了预览再次写盘。回执确认的是 Web 服务已加载的状态，浏览器通过现有事件订阅刷新；它不表示某个浏览器标签页已完成渲染。

保存返回的 `preview.status: "not-requested"` 只表示此次调用没有请求 Web 确认；保存本身不访问网络，Web 未启动也能成功。需要确认页面对应内容时，在保存后使用返回路径调用 `qxqy_preview_open`。预览工具支持取消，整个请求默认 4 秒超时；连接、认证、旧版 API 和工作区不一致均返回明确错误。打开超时后可调用 `qxqy_preview_status` 检查实际状态，避免将超时误认为服务端必定未加载。

## 工具边界

- 路径只能是配置工作区内的相对路径；server 会拒绝路径穿越和符号链接逃逸。
- `qxqy_studio_play` 的动作和参数沿用 DSH 模拟器工具契约。
- 未实现或未知的模拟器语义返回明确错误，不会伪造成功。
- 每个工程句柄串行执行操作；不同句柄相互隔离。

## 协议实现

当前使用 MCP stdio 的逐行 JSON-RPC 传输，支持 `initialize`、`ping`、`tools/list`、`tools/call` 以及取消通知，并协商 `2024-11-05` 至 `2025-11-25` 的 legacy MCP 版本。MCP 包不包含 DSH Client UI 或 Skill；可视编辑可使用独立 Web 的 `/editor` 或 DSH 插件。
