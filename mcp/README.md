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

### 实机脚本复制同步

`qxqy_script_sync({ handle, action, args })` 支持 `discover`、`status`、`configure`、`preview`。配置示例：

```json
{ "handle": "project-1", "action": "configure", "args": {
  "expectedRevision": 12,
  "config": { "version": 1, "workspaceDir": "workspace/topo5", "clientImportRoot": "C:/Users/<用户>/AppData/LocalLow/miHoYo/原神/BeyondLocal/<UID>/Beyond_Local_Save_Level/<编辑器ID>/external_lua_file/default_import_file", "clientSubdir": "workspace/topo5" }
} }
```

配置保存在完整存档；调用 `qxqy_project_save` 后，用户在 Web `/editor` 加载同一存档，在「Lua 脚本 → 实机脚本同步」保存并检查差异、确认复制。AI 工具不开放执行复制，MCP 预览计划不跨进程传给 Web。复制内容采用内联源码优先、否则工作区文件；若有待处理 `controlGuidChanges`，先完成索引引用核对。见 [完整流程与验证](../studio/docs/script-sync.md)。

### 客户端控件索引校准

真实编辑器导入 GIA 后若重新分配了客户端控件索引，可在 Web/DSH 编辑器修改选中客户端控件的「索引」，或使用当前资产的 `setControlGuid`。`id` 是存档内部控件 ID，`guid` 是用户回传的实际索引（整数 `1–2147483647`）；操作保留内部 ID 和脚本挂载，拒绝服务端容器及工程中重复的控件/脚本索引。

先确认当前资产与目标控件一致；需要时调用 `selectAsset`，其 `assetType` 为 `server-control-template` 或 `client-control-template`，然后重新 `get` 读取控件及 revision。

```text
qxqy_studio_get({ handle: "project-1" })
qxqy_studio_patch({ handle: "project-1", op: {
  op: "setControlGuid", id: "目标控件内部 id", guid: 1073742200, expectedRevision: N
} })
```

此操作不会自动修改 Lua。快照与完整存档的 `controlGuidChanges` 按时间保存 `{ id, controlAsset, controlId, controlName, oldGuid, newGuid }`，AI 必须结合控件身份把连续变更解析到最终索引，检查并同步相关 `scripts[].source` 和实际 `.lua` 源文件中的调用、常量、配置表及身份校验。非空内联 `source` 会优先于 `path` 文件执行，不能遗漏其中一份。模板索引、运行时控件 `Id`、图片 ID 和脚本映射 ID 各有含义，禁止全局替换同值数字；无法读取或判断的引用保留为未处理。

确认引用全部同步，或该变更无 Lua 引用后，才清理对应记录。每次写操作使用当时最新的 revision，随后显式保存完整存档并重启试玩验证受影响流程：

```text
qxqy_studio_patch({ handle: "project-1", op: {
  op: "acknowledgeControlGuidChanges", changeIds: ["已核验的变更记录 id"], expectedRevision: M
} })
qxqy_project_save({ handle: "project-1" })
qxqy_studio_play({ handle: "project-1", action: "start" })
```

确认操作只清理记录，不改写脚本；未处理记录会随完整存档保存，导出时提醒同步引用。完整 AI 检查流程见 [`skill/SKILL.md`](../skill/SKILL.md#5-导入后校准客户端控件索引并同步-lua)。

### 通用限制

- 路径只能是配置工作区内的相对路径；server 会拒绝路径穿越和符号链接逃逸。
- `qxqy_studio_play` 的动作和参数沿用 DSH 模拟器工具契约。
- 未实现或未知的模拟器语义返回明确错误，不会伪造成功。
- 每个工程句柄串行执行操作；不同句柄相互隔离。

## 协议实现

当前使用 MCP stdio 的逐行 JSON-RPC 传输，支持 `initialize`、`ping`、`tools/list`、`tools/call` 以及取消通知，并协商 `2024-11-05` 至 `2025-11-25` 的 legacy MCP 版本。MCP 包不包含 DSH Client UI 或 Skill；可视编辑可使用独立 Web 的 `/editor` 或 DSH 插件。
