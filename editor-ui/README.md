# 共用编辑器

内部workspace包，由Web和Harness构建进浏览器资源，不单独发布。上级：[项目文档树](../README.md#文档树)。

## 接入契约

`createEditor(React, { api, playUrl, saveToWorkspace })`返回`SimulatorView`、`ensureStyle()`和`removeStyle()`。宿主提供React；`api(sessionId, action, body)`返回envelope中的value并将失败转为异常；`playUrl(sessionId)`返回同源试玩页地址。Web设置`saveToWorkspace: true`显示显式存档按钮。

编辑操作沿用Controller的snapshot、revision与patch；本层不读取文件系统或处理部署认证。

## 专题与实现入口

- **界面设置**
  - [语言、联系作者与更新](../studio/docs/interface.md)：`footer.js`、`studio/i18n.js`。
  - [本地字体](../studio/docs/local-fonts.md)：`font-settings.js`，独立于项目revision。
- **画布**（能力契约由[Studio](../studio/README.md#专题树)维护）
  - [图片素材](../studio/docs/image-assets.md)：`image-preview.js`，使用`imageSource + imageId`身份、同源`/qxqy-assets/`及`image-refresh`。
  - [动效](../studio/docs/ui-vfx-playback.md)：`ui-vfx-preview.js`，搜索、静音预览、重播/重试与停止。
  - [旋转](../studio/docs/control-support.md#xy-旋转投影2026-10-12)与[遮罩](../studio/docs/control-support.md#编辑画布遮罩与羽化2026-10-20)：`control-transform.js`、`mask-preview.js`；选框独立于效果层。
- **导出与实机更新**
  - [部分导出](../studio/docs/partial-export.md)：属性栏单项GIA、顶栏组合勾选预览。
  - [Lua索引同步](../studio/docs/control-guid-sync.md)：索引修改、同时映射、备份和AI核对。
  - [脚本同步](../studio/docs/script-sync.md)：目录设置、差异预览、选定复制与回执。

## 颜色编辑

`color-field.js`共用颜色和透明度两栏：原生取色器/`#RRGGBB`，以及0–100整数百分比。底层保存uint32 ARGB，基于队列最新快照仅替换被编辑通道，避免连续改两栏互相覆盖。Alpha按8位量化，显示百分比四舍五入；聚焦、失焦和仅查看不重写值。

## 试玩窗口与内嵌兜底

`play-launcher.js`同步尝试打开标签页；`window.open`返回null时，保存脚本/服务端逻辑后在modal中嵌入同源试玩页`?embedded=1#<sessionId>`，编辑器保持挂载。两种入口共用`dsh-plugin/lib/play.html`。

内嵌页等待父级load握手才启动；父级跟踪API请求。关闭、返回编辑和Escape统一执行：关闭输入/轮询 → 排空请求 → 等stop成功 → 移除遮罩、恢复焦点；失败保留重试。只接受当前iframe WindowProxy、sessionId和指定消息类型。

切换会话或卸载同样停止旧会话，同会话重开先等旧清理。整个文档关闭的pagehide/keepalive仅为尽力清理。键盘焦点在试玩画布，点击可恢复焦点。

## 验证

在根目录构建Web/DSH后：

- `QXQY_BROWSER`指定Chrome/Edge，运行`node --test web/test/embedded-play-browser.test.mjs`，覆盖保存、弹窗回退、输入、消息校验、关闭重试及重挂。
- `QXQY_ELECTRON`指定Electron，运行`node --test web/test/desktop-play.test.mjs`，使用真实插件bundle和隔离宿主夹具验证窗口拒绝、`dsh-app`转发、iframe和Worker停止。

2026-10-01 Windows / Node22.23.2 / Edge / Electron44.0.0验收为`observed / simulator / not_required`；完整签名Desktop、macOS和游戏真机不在该范围。
