# beyond-simulator-web

单用户自托管 Web 编辑器和磁盘存档预览，无需 Harness。复用共享 Studio、Lua Runtime、固定步长试玩 Worker、Pixi 渲染器及 `editor-ui` 编辑界面。

## 安装与启动

推荐 Node.js 22+。源码开发在仓库根执行：

```sh
pnpm install --frozen-lockfile
pnpm dev:web --workspace /absolute/path/to/workspace
```

从 npm 安装：

```sh
npm install -g beyond-simulator-web
beyond-simulator-web --workspace /absolute/path/to/workspace --open
```

默认地址 `http://127.0.0.1:4173`，入口：

| 地址 | 用途 |
|---|---|
| `/` | 只读预览工作区存档，监听磁盘变化，适合配合 MCP |
| `/editor` | UI、Lua、服务端逻辑编辑，导入导出、显式保存及独立试玩 |
| `/health` | 无敏感内容的存活检查，无需登录 |

参数：`--workspace <dir>`（默认 `QXQY_WORKSPACE` 或当前目录）、`--file <工作区相对路径>`、`--host <host>`（默认 `127.0.0.1`）、`--port <port>`（默认 `4173`）、`--open`。工作区必须已经存在。

构建后的入口是 `web/dist/server.js`，静态文件与 Worker 随包携带。安装者无需源码、pnpm 或 esbuild。

更新时再次执行 `npm install -g beyond-simulator-web`，再重启服务。包名与启动命令已统一为 `beyond-simulator-web`；此前使用旧命令的启动脚本也需同步更新。

## 编辑与保存

`/editor` 与 Harness 共用编辑界面，包括控件树、属性、五档设备画布、Lua 脚本、服务端变量/信号、导入导出和试玩。点击“保存存档”，输入工作区内相对路径，将三类资产写为完整存档 JSON。试玩或普通编辑不会自动写盘。

会话 ID 保存在浏览器标签页的 `sessionStorage`；刷新会保留进程内编辑与 Worker 状态。不同 ID 的会话相互独立；浏览器“复制标签页”可能复制 sessionStorage，从而共享会话。默认最多 8 个会话，不自动淘汰未保存内容。关闭标签页不会立即回收会话；达到上限时先保存，再重启服务。

服务重启会丢失未保存编辑。已存在的文件必须先从工作区加载才能覆盖；保存会同时检查编辑 revision 和加载时的文件哈希。若 MCP、其他标签页或外部工具更新文件，会拒绝覆盖，需重新加载或另存新路径。保存按钮会先提交当前脚本与逻辑草稿。

## 与 MCP 配合

MCP 显式调用 `qxqy_project_save` 保存工作区 JSON 后，`/` 每 700ms 检查当前文件，停止旧试玩、加载新存档并通过 SSE 刷新浏览器。该预览不写文件。`/editor` 不自动用磁盘内容覆盖正在编辑的草稿，需要手动“从工作区拉取存档”。

试玩使用固定 30 FPS Worker、增量场景和 Pixi/WebGL；刷新试玩页会接回已有 Worker，保留暂停和当前玩家。截图仍由 Host 根据统一场景输出 PNG。

## 部署与访问控制

绑定非回环地址前，设置 `QXQY_WEB_PASSWORD`，登录用户名固定为 `simulator`。设置口令后，即使回环访问也要求认证。业务静态文件、API、SSE 与截图均受保护；写请求只接受 JSON 并校验浏览器 Origin。路径只能落在配置工作区内。

```powershell
$env:QXQY_WEB_PASSWORD = '替换为自己的长口令'
beyond-simulator-web --workspace E:/my-project --host 0.0.0.0
```

HTTP Basic 不提供传输加密；对外部署需使用 HTTPS 反向代理。代理转发应保留外部 Host，与浏览器 Origin 一致；当前路径以站点根 `/` 部署，不支持 URL 子路径前缀。

仓库根的 `Dockerfile` 用 Node 22 构建并安装 Web tarball，运行阶段使用非 root 用户；`compose.yaml` 默认只暴露本机端口，存档放在持久卷 `/data`：

```sh
cp .env.example .env
# 填写 QXQY_WEB_PASSWORD
docker compose up --build -d
```

这是单个可信操作者的实例，不提供多租户权限、资源配额或恶意代码沙箱。不要把工作区设为含无关敏感文件的大目录。静态站点托管和多用户服务需要另行实现。
