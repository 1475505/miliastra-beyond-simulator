# 共用编辑器

内部 workspace 包，由 Web 和 Harness 构建进浏览器资源，不单独发布。

`createEditor(React, { api, playUrl, saveToWorkspace })` 返回 `SimulatorView`、`ensureStyle()` 与 `removeStyle()`。宿主传入 React；`api(sessionId, action, body)` 返回 API envelope 内的 value，并将失败转成异常；`playUrl(sessionId)` 返回同源试玩页地址。Web 设置 `saveToWorkspace: true` 显示显式存档按钮。

所有编辑操作沿用 Controller snapshot、revision 与 patch 契约。此层不读取文件系统、不注册 Harness 服务，也不处理部署认证。

「Lua 脚本 → 实机脚本同步」支持发现/配置实机目录、保存完整存档、预览逐文件差异、勾选并确认复制。保存目录配置及清除配置也显式保存存档；复制由宿主执行，覆盖前备份。源码不同可从工作区文件更新存档源码再预览。完整规则及 E2E 证据见 [脚本同步](../studio/docs/script-sync.md)。

选择客户端控件（包含服务端界面下的容器节点与子控件）后，可在右侧「客户端控件索引」输入 GIA 导入后的真实索引并点击「修改」。索引变更不会改变控件内部身份、层级或脚本挂载。页面顶部保留待同步的旧/新索引，可点「复制给 AI」要求同步存档 Lua 源码及相关源文件；完成核对与试玩后，再确认「已完成脚本同步」并保存完整存档。修改索引本身不会自动替换 Lua 中的数字。
