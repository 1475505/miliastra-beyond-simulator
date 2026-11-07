# 共用编辑器

内部workspace包，由Web和Harness构建进浏览器资源，不单独发布。上级：[项目文档树](../README.md#文档树)。

## 接入契约

`createEditor(React, { api, playUrl, saveToWorkspace, quickStart })`返回`SimulatorView`、`ensureStyle()`和`removeStyle()`。宿主提供React；`api(sessionId, action, body)`返回envelope中的value并将失败转为异常；`playUrl(sessionId)`返回同源试玩页地址。Web设置`saveToWorkspace: true`显示显式存档按钮。

编辑操作沿用Controller的snapshot、revision与patch；本层不读取文件系统或处理部署认证。

## 按钮交互

共用 `.qxsim-action` / `.qxsim-iconbtn` 在亮暗主题下区分默认、悬停、按下与禁用状态。主按钮保持深蓝底白字，不能被通用悬停背景覆盖；禁用使用可读的中性色，不靠整体透明度淡出。键盘 `focus-visible` 显示外侧焦点环，`aria-busy="true"` 提供等待光标与加载标记；减少动态效果偏好下停止旋转和过渡。快速上手使用更大的主次操作区，长按钮名可换行，下载期间锁定重复触发。验证见 `web/test/editor-buttons-browser.test.mjs`。

按钮回归检查亮暗主题下主按钮默认/悬停/按下文字对比度不低于4.5:1、禁用状态、键盘焦点/Enter、慢速下载与防重复触发。主题切换截图须等待颜色过渡结束；这些是编辑器交互要求，不涉及游戏真机控件皮肤。

## 专题与实现入口

- **界面设置**
  - **快速上手**：`quick-start.js`，右下角常驻入口，以交付同一个游戏为主线，从真实「试玩」按钮直接开始，再带用户导出/导入 GIA、核对索引、找到并绑定目录、确认复制和实机试玩；不先安排功能介绍。关键操作用可见编号清单和加粗按钮名说明，游戏侧卡片在导航下方居中显示，继续按钮明确仅记录进度。宿主可选注入 `quickStart: { autoOpen, open(sessionId), back(sessionId) }` 提供远程示例副本；下载和会话切换属于宿主。定位使用 `data-quick-start-target`，遮罩透传输入、卡片避让目标，试玩时附加通用提示。接入与进度契约见 [Web 快速上手](../web/README.md#快速上手)。
  - [语言、联系作者与更新](../studio/docs/interface.md)：`footer.js`、`studio/i18n.js`。
  - [本地字体](../studio/docs/local-fonts.md)：`font-settings.js`，独立于项目revision。
- **画布**（能力契约由[Studio](../studio/README.md#专题树)维护）
  - [按键提示](../studio/docs/control-support.md#按键提示图标)：`key-hint-preview.js`，共用键帽/手柄图标绘制与设备预览选择。
  - [图片素材](../studio/docs/image-assets.md)：`image-preview.js`，使用`imageSource + imageId`身份、同源`/qxqy-assets/`及`image-refresh`。
  - [动效](../studio/docs/ui-vfx-playback.md)：`ui-vfx-preview.js`，搜索、静音预览、重播/重试与停止。
  - [旋转](../studio/docs/control-support.md#xy-旋转投影)与[遮罩](../studio/docs/control-support.md#编辑画布遮罩与羽化)：`control-transform.js`、`mask-preview.js`；选框独立于效果层。
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
- `node --test web/test/quick-start.test.mjs` 验证下载失败与重试、独立会话、重复请求复用及保存；设置 `QXQY_BROWSER` 时覆盖真实鼠标操作、高亮目标避让、窗口缩放与滚动定位、脚本草稿提交、试玩提示、逐项路径设置、进度恢复及返回原工程。夹具为合成工程。

既有观察范围为 Windows / Node22 / Edge，以及内嵌试玩的 Electron44 隔离夹具，属于 `observed / simulator / not_required`；不涵盖完整签名 Desktop、macOS或游戏真机。
