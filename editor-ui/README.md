# 共用编辑器

内部 workspace 包，由 Web 和 Harness 构建进浏览器资源，不单独发布。

`createEditor(React, { api, playUrl, saveToWorkspace })` 返回 `SimulatorView`、`ensureStyle()` 与 `removeStyle()`。宿主传入 React；`api(sessionId, action, body)` 返回 API envelope 内的 value，并将失败转成异常；`playUrl(sessionId)` 返回同源试玩页地址。Web 设置 `saveToWorkspace: true` 显示显式存档按钮。

所有编辑操作沿用 Controller snapshot、revision 与 patch 契约。此层不读取文件系统、不注册 Harness 服务，也不处理部署认证。

顶部导航栏「字体设置」旁提供「自动 / 中文 / English」语言选择；底栏提供按当前安装包检查 GitHub Release 更新及联系作者弹窗。默认按运行环境语言选择；切换保留编辑草稿，项目内容和 API 标识符不翻译。术语来源、更新匹配与验证边界见 [界面说明](../studio/docs/interface.md)。

顶栏「字体设置」通过本机专用 `/qxqy-font/settings` 接口配置宿主字体，独立于项目快照与 revision。支持自动尝试 Windows 原神常见安装位置、指定 TTF/OTF 绝对路径和使用系统字体；保存后重启宿主并刷新页面生效，表单不重载编辑器或丢弃草稿。应用范围可选「仅游戏内文本」或「整体 UI」（默认），后者还覆盖工具栏、属性表单、弹窗、代码和日志。原有 `QXQY_FONT_PATH` 优先并锁定来源与路径，仍可调整范围。范围选项随 Web 0.5.0 发布，已发布的 DSH 2.2.0 不含此选项。路径持久化、候选位置、错误回退及访问边界见 [本地字体说明](../studio/docs/local-fonts.md)。

颜色属性使用「颜色 + 透明度」两个编辑栏：颜色提供原生取色器与 `#RRGGBB` 输入，透明度提供滑块与 0–100 的整数百分比输入（Alpha：0% 完全透明、100% 完全不透明）。图片填充色、文本色、背景色和描边色共用 `color-field.js`，底层仍保存 uint32 ARGB；每次提交只替换对应通道，基于编辑队列中的最新快照合并，避免连续修改两栏时互相覆盖。Alpha 编辑后按 8 位量化，百分比四舍五入显示整数；仅查看、聚焦或失焦不重写原始 Alpha，未修改的通道原样保留。

「变换」提供 X/Y/Z 旋转输入（度）。X/Y 的压缩、侧立与背面翻转由 `control-transform.js` 保留完整投影矩阵显示；90° 侧立时可从控件树选中并调整。GIA/试玩与组合策略见 [旋转支持](../studio/docs/control-support.md#xy-旋转投影2026-10-12)。

`image-preview.js` 显示白名单静态图片，复用浏览器图片加载器与 HTTP 缓存，Canvas2D 处理 RGB 乘色、alpha 和填充。宿主需提供同源 `/qxqy-assets/` 路由与 `image-refresh` action；「重新下载此素材」会刷新磁盘副本，并通知同源试玩页面重载纹理。完整边界见 [素材缓存](../studio/docs/image-assets.md)。

图片源可选「静态引用 / 元件」；元件来源的编辑预览、纹理与刷新使用 `imageSource + imageId` 作为资源身份。`image-refresh` body 接收 `imageSource`，省略时兼容静态来源；Prefab 请求 `/qxqy-assets/prefab-v1/<id>.png`。

编辑画布与编辑器截图支持图片矩形遮罩和羽化。`mask-preview.js` 按快照遮罩链分组，复用试玩覆盖率处理重叠与嵌套；选框保留在效果层外。属性提交后直接更新，支持范围与验证见 [编辑遮罩预览](../studio/docs/control-support.md#编辑画布遮罩与羽化2026-10-20)。

## 试玩窗口与内嵌兜底

`play-launcher.js` 同步尝试打开新标签页；宿主拒绝窗口（`window.open` 返回 `null`）时，保存脚本和服务端逻辑后，在顶层 modal dialog 中嵌入同源试玩页 `?embedded=1#<sessionId>`。底下的编辑器保持挂载。正常浏览器继续使用新标签页。

内嵌页等待父级 load 握手才启动，API 请求由父级持有并跟踪，避免 iframe 卸载导致未完成请求失去归属。关闭按钮、页内“返回编辑”和 Escape 都经同一流程：关闭输入及轮询 → 等待已发出请求结束 → 等待 `stop` 成功 → 移除遮罩并恢复焦点。失败保留遮罩供重试。父级只接受当前 iframe WindowProxy、当前 sessionId 和指定类型的关闭消息；不能仅凭消息字符串关闭视图。

会话切换或视图卸载也排空请求并停止旧会话；同会话重新打开先等待旧清理。整个应用文档关闭仍只能通过 `pagehide` keepalive 做尽力清理，不能当作显式 `stop` 的替代。新标签页和内嵌页复用 `dsh-plugin/lib/play.html`；键盘焦点落在试玩画布上，点击画布恢复焦点。

验证入口（先在根目录构建 Web 与 DSH）：

- 设置 `QXQY_BROWSER` 为 Chrome/Edge 可执行文件，执行 `node --test web/test/embedded-play-browser.test.mjs`：真实浏览器覆盖保存失败/等待、弹窗回退、焦点按键、消息校验、关闭重试、启动中关闭、卸载/重挂和普通新标签页。
- 设置 `QXQY_ELECTRON` 为 Electron 可执行文件，执行 `node --test web/test/desktop-play.test.mjs`：真实 Electron + 实际 DSH 插件 bundle，重建 0.2 的窗口拒绝与 `dsh-app` 认证转发策略，验证 iframe、输入与 Worker 停止。未配置环境变量时这些可选测试跳过。
- 2026-10-01 在 Windows / Node 22.23.2 / Edge / Electron 44.0.0 通过上述测试。`evidence_source=observed`，运行端 `simulator`，`device_status=not_required`。Electron 测试是隔离宿主夹具，不代表已在完整签名 DSH Desktop 应用、macOS 或真实游戏内验收。

「Lua 脚本 → 实机脚本同步」沿用纵向表单和原有控件顺序，通过简短说明引导「填写脚本位置 → 保存设置 → 查看更新 → 确认复制」，字段提供填写提示及复制路径示例。「保存设置」「清除设置」也显式保存完整存档；复制由宿主执行，替换旧文件前备份。代码不同可选择「改用项目文件里的代码」，再保存存档并查看更新。复制完成后提示用户回到千星沙箱保存关卡并重新试玩。完整规则及 E2E 证据见 [脚本同步](../studio/docs/script-sync.md)。

选择客户端控件后，在右侧「客户端控件索引」填写 GIA 导入后的真实索引并点击「修改」。索引变更保持控件身份、层级和挂载，页面上方提供两个选项：「全量替换脚本索引」按十进制文本一次替换所有已登记脚本，注明可能误改非索引内容，写前备份；「复制提示词给 AI」先保存最新存档，提示词明确完整新旧映射和脚本源码的读取方式。AI 完成后点击「AI 已处理，重新载入存档」。检查结果、保存并重新试玩，再进入实机脚本复制。能力边界、宿主协议和测试见 [Lua 索引同步](../studio/docs/control-guid-sync.md)。

客户端模板页新增「自动修改其他客户端索引值」（默认不勾选）。选择任意模板根或子控件，填写真实索引后勾选，页面预览覆盖数量与区间；提交后按 GIA 的模板根顺序、父先子后的原生遍历顺序连续编号，覆盖全部模板及子控件。每级实际子控件采用编辑器同级列表的反向；不能按旧 GUID 排序，也不能整体加减同一个偏移量。适用于同一批导入、结构未增删重排的模板；分批导入或资源复用可能不满足连续编号。服务端界面、脚本和图片资源编号不参与自动填充，外部索引冲突/越界会整批拒绝。编号交换及结构化模板引用一次性更新；同一 `batchId` 的 Lua 引用也须按原值同时映射，不能逐条数字替换。大批量记录只显示前 20 项，完整映射仍保存在 `controlGuidChanges`。
