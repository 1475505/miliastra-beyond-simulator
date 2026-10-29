# 千星沙箱 DSH 插件

静态Host + Client适配层。编辑状态按DSH `sessionId`隔离，复用Studio Controller与持久Worker。上级：[项目文档树](../README.md#文档树)。

## 安装与更新

需要Node.js22+和DeepSeek Harness；GitHub源码安装另需Git。任选一种：

```powershell
dsh plugin --profile web add dsh-plugin-beyond-simulator
dsh plugin --profile web add github:1475505/miliastra-beyond-simulator
dsh plugin --profile web add ./release/dsh-plugin-beyond-simulator-2.2.2.tgz
```

更新也用`add`，之后重启Harness；`dsh --profile web --dump-config`检查加载，`dsh web`启动。tarball文件名以当次`release/manifest.json`为准，在其他目录安装时使用绝对路径。

源码安装入口是仓库根，`prepare`负责构建；`dsh-plugin/`只是内部包。pnpm若拒绝构建，按实际错误批准本插件或精确Git依赖键。预构建包无需源码和构建工具；详见[分发说明](../DISTRIBUTION.md#harness-安装入口)。

## 文档与功能入口

- [版本公告](CHANGELOG.md)：面向使用者的发布变化。
- [模拟器操作Skill](../skill/SKILL.md)：工具工作流；构建复制到包内`dsh-plugin/skill.md`，通过独立skills组件注册`qxqy-simulator`。
- [游戏制作预设](../agent/wonderland-lua-builder/README.md)：源码、七步流程与行为评估。构建嵌入声明式预设，并携带旧宿主目录副本；已有用户副本不覆盖。
- [共用编辑器](../editor-ui/README.md)：UI、Lua、服务端逻辑、主题、语言、字体与试玩窗口。
- [Studio专题](../studio/README.md#专题树)：图片/音频/动效缓存、输入、部分导出、索引与脚本同步。

Host Tools为`qxqy_script_sync`、`qxqy_studio_get/patch/export/play/load`、`qxqy_studio_ui_screenshot/play_screenshot`。截图使用Host PNG，无需可见标签页；动效视频帧的省略提示见[动效边界](../studio/docs/ui-vfx-playback.md#截图与-gia-边界)。

工作区绑定DSH会话原始工程根。存档发现复用Studio，支持大于8MiB的存档，选最近50项并返回`discovery`限制/诊断；指定工作区内路径不受列表筛选限制。加载成功记住相对路径，省略保存路径时写回；未绑定时返回`{ bound:false, archives:[] }`。

## Desktop protobuf 导入失败

2.1.2起把完整protobufjs编入Host/Worker，GIA解析不再依赖宿主共享CommonJS导出。遇到旧包`hu.parse is not a function`，更新后保存工作、从托盘完整退出Harness再启动；仅禁用/启用不能清除失败的ESM导入缓存。

2026-10-18 Desktop0.2.1-rc.2旧进程有此报告，新进程可加载旧包，具体触发链未确认。`test/protobuf-bundle.test.mjs`在子进程令外部parse缺失，旧包同型失败、新包GIA往返通过；此为依赖隔离证据，不等于复现原进程。Windows / Node22及Desktop自带Node24.21.0、临时完整SDK宿主验证为`observed / simulator / not_required`；用户原窗口回验未取得。

## Desktop 内嵌试玩（2.0.8）

DSH Desktop0.2拒绝页面子窗口；插件从2.0.8起在保存成功后回退同源全屏iframe。返回编辑、关闭或Escape等待stop成功，失败可重试；编辑器保持挂载。生命周期与浏览器/Electron验收边界见[共用编辑器](../editor-ui/README.md#试玩窗口与内嵌兜底)。

## 路由重复注册（2.0.11）

`webserver: duplicate prefix route "/qxqy-simulator/api"`本身不能证明重复安装。[WebServer.register](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.0-rc.2/packages/host/webserver/src/index.ts)返回普通注销函数；旧插件丢弃它，单组件重启或tools依赖重载即可残留路由。

2.0.11起所有HTTP路由通过`ctx.effect`接管注销，部分注册失败回滚，卸载等待Worker退出并拒绝迟到请求。真实同时挂载冲突仍报错，不覆盖其他组件。更新并完整重启可清除旧残留；保留原版主组件insert。

`test/lifecycle.test.mjs`覆盖重复重启、依赖重载、失败回滚、Worker等待和迟到请求，检查HTTP/工具共用Registry。2026-10-07 Windows / Node22.23.2 / Harness0.2.0-rc.2验证为`observed / simulator / not_required`；反馈者Desktop原始再激活事件与修复回验未覆盖。

## Harness 0.2 兼容性

- 宿主依据DSH peer范围准入；npm预发布匹配与宿主的`includePrerelease`不同。当前兼容范围以根package.json为准，不用忽略peer代替适配。依据：[插件兼容](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.0-rc.2/packages/boot/plugin-manager/README.md#version-compatibility-and-exemptions)。
- 嵌入预设的`baseUrl`可能来自合成profile，Skill路径须按安装包定位；旧目录预设才使用相邻`skills/`。`test:harness`需读到正文及`references/workflow.md`，仅菜单可见不算通过。
- 已用的defineTool、JSON输出、附件、会话cwd、HTTP路由、ModuleLoader与conversation.view沿用；VM与存档格式不因宿主版本另建分支。

## Harness 0.2.1 兼容性

依据2026-10-18核对的[官方0.2.1-rc.1说明](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.2.1-rc.1)及[rc.2](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.2.1-rc.2)，`documented / official_document`：

| 接口变化 | 适配 |
|---|---|
| 移除cwd提示词变量 | persona已移除旧引用，保留model；见[预设迁移](../agent/wonderland-lua-builder/README.md#persona-工作目录变量兼容性)。 |
| 默认声明式预设 | 更新插件内嵌注册项才更新默认预设；改旧`.agent-presets`副本不一定生效。 |
| 优先engines.dsh，回退peer | 本插件使用peer，显式涵盖0.2.1 RC，避免npm ERESOLVE。 |
| working_directory服务 | 模拟器仍绑定Session.header.cwd原始工程；Shell切目录不等于切编辑工程。 |
| 子代理/Agent Team调整 | 由官方插件处理；旧backgroundMode配置不构成新版同步等待承诺。 |
| 热重载和扩展位 | 路由走effect清理；完整宿主验证实际预设提示词渲染、Skill发现及模块加载。 |

## 验证入口与边界

构建/安装检查统一见[分发验收](../DISTRIBUTION.md#验收入口与证据范围)。`test:packages`覆盖dsh-tools0.1.0-rc.6、0.2.0-rc.2、0.2.1-rc.2；`test:harness`默认0.2.1-rc.2，可传已有CLI路径测旧版本。浏览器语言验收另设`QXQY_BROWSER`。

2026-10-18 Windows / Node22.23.2的三组安装与两个完整Web宿主通过，标为`observed / simulator / not_required`；未调用真实模型/Agent Team，未证明完整签名Desktop、Linux/macOS、SSH或子路径public-url部署。Windows隔离Git安装曾因已加载Canvas DLL无法unlink报EPERM，测试子进程采用`npm_config_package_import_method=copy`；这与构建审批拒绝不同。
