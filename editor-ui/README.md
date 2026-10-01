# 共用编辑器

内部 workspace 包，由 Web 和 Harness 构建进浏览器资源，不单独发布。

`createEditor(React, { api, playUrl, saveToWorkspace })` 返回 `SimulatorView`、`ensureStyle()` 与 `removeStyle()`。宿主传入 React；`api(sessionId, action, body)` 返回 API envelope 内的 value，并将失败转成异常；`playUrl(sessionId)` 返回同源试玩页地址。Web 设置 `saveToWorkspace: true` 显示显式存档按钮。

所有编辑操作沿用 Controller snapshot、revision 与 patch 契约。此层不读取文件系统、不注册 Harness 服务，也不处理部署认证。

## 试玩窗口与内嵌兜底

`play-launcher.js` 同步尝试打开新标签页；宿主拒绝窗口（`window.open` 返回 `null`）时，保存脚本和服务端逻辑后，在顶层 modal dialog 中嵌入同源试玩页 `?embedded=1#<sessionId>`。底下的编辑器保持挂载。正常浏览器继续使用新标签页。

内嵌页等待父级 load 握手才启动，API 请求由父级持有并跟踪，避免 iframe 卸载导致未完成请求失去归属。关闭按钮、页内“返回编辑”和 Escape 都经同一流程：关闭输入及轮询 → 等待已发出请求结束 → 等待 `stop` 成功 → 移除遮罩并恢复焦点。失败保留遮罩供重试。父级只接受当前 iframe WindowProxy、当前 sessionId 和指定类型的关闭消息；不能仅凭消息字符串关闭视图。

会话切换或视图卸载也排空请求并停止旧会话；同会话重新打开先等待旧清理。整个应用文档关闭仍只能通过 `pagehide` keepalive 做尽力清理，不能当作显式 `stop` 的替代。新标签页和内嵌页复用 `dsh-plugin/lib/play.html`；键盘焦点落在试玩画布上，点击画布恢复焦点。

验证入口（先在根目录构建 Web 与 DSH）：

- 设置 `QXQY_BROWSER` 为 Chrome/Edge 可执行文件，执行 `node --test web/test/embedded-play-browser.test.mjs`：真实浏览器覆盖保存失败/等待、弹窗回退、焦点按键、消息校验、关闭重试、启动中关闭、卸载/重挂和普通新标签页。
- 设置 `QXQY_ELECTRON` 为 Electron 可执行文件，执行 `node --test web/test/desktop-play.test.mjs`：真实 Electron + 实际 DSH 插件 bundle，重建 0.2 的窗口拒绝与 `dsh-app` 认证转发策略，验证 iframe、输入与 Worker 停止。未配置环境变量时这些可选测试跳过。
- 2026-10-01 在 Windows / Node 22.23.2 / Edge / Electron 44.0.0 通过上述测试。`evidence_source=observed`，运行端 `simulator`，`device_status=not_required`。Electron 测试是隔离宿主夹具，不代表已在完整签名 DSH Desktop 应用、macOS 或真实游戏内验收。

「Lua 脚本 → 实机脚本同步」支持发现/配置实机目录、保存完整存档、预览逐文件差异、勾选并确认复制。保存目录配置及清除配置也显式保存存档；复制由宿主执行，覆盖前备份。源码不同可从工作区文件更新存档源码再预览。完整规则及 E2E 证据见 [脚本同步](../studio/docs/script-sync.md)。

选择客户端控件（包含服务端界面下的容器节点与子控件）后，可在右侧「客户端控件索引」输入 GIA 导入后的真实索引并点击「修改」。索引变更不会改变控件内部身份、层级或脚本挂载。页面顶部保留待同步的旧/新索引，可点「复制给 AI」要求同步存档 Lua 源码及相关源文件；完成核对与试玩后，再确认「已完成脚本同步」并保存完整存档。修改索引本身不会自动替换 Lua 中的数字。
