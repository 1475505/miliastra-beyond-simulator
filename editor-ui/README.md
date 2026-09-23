# 共用编辑器

内部 workspace 包，由 Web 和 Harness 构建进浏览器资源，不单独发布。

`createEditor(React, { api, playUrl, saveToWorkspace })` 返回 `SimulatorView`、`ensureStyle()` 与 `removeStyle()`。宿主传入 React；`api(sessionId, action, body)` 返回 API envelope 内的 value，并将失败转成异常；`playUrl(sessionId)` 返回同源试玩页地址。Web 设置 `saveToWorkspace: true` 显示显式存档按钮。

所有编辑操作沿用 Controller snapshot、revision 与 patch 契约。此层不读取文件系统、不注册 Harness 服务，也不处理部署认证。
