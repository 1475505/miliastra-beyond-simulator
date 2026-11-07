# 千星沙箱 DSH 插件

静态Host + Client适配层。编辑状态按DSH `sessionId`隔离，复用Studio Controller与持久Worker。上级：[项目文档树](../README.md#文档树)。

## 安装与更新

插件需要Node.js22+，Harness 0.2.2宿主要求Node.js24.9+；GitHub源码安装另需Git。以下为CLI Web安装示例，Desktop内置命令与profile操作见[恢复指引](docs/session-recovery.md#用户恢复步骤)。任选一种：

```powershell
dsh plugin --profile web add dsh-plugin-beyond-simulator
dsh plugin --profile web add github:1475505/miliastra-beyond-simulator
dsh plugin --profile web add ./release/dsh-plugin-beyond-simulator-2.2.4.tgz
```

更新也用`add`，之后重启Harness；`dsh --profile web --dump-config`检查加载，`dsh web`启动。tarball文件名以当次`release/manifest.json`为准，在其他目录安装时使用绝对路径。

源码安装入口是仓库根，`prepare`负责构建；`dsh-plugin/`只是内部包。pnpm若拒绝构建，按实际错误批准本插件或精确Git依赖键。预构建包无需源码和构建工具；详见[分发说明](../DISTRIBUTION.md#harness-安装入口)。

## 文档与功能入口

- [GitHub Releases](https://github.com/1475505/miliastra-beyond-simulator/releases)：公开发布说明与安装包。
- [模拟器操作Skill](../skill/SKILL.md)：工具工作流；构建复制到包内`dsh-plugin/skill.md`，通过独立skills组件注册`qxqy-simulator`。
- [游戏制作预设](../agent/wonderland-lua-builder/README.md)：源码、七步流程与行为评估。构建嵌入声明式预设，并携带旧宿主目录副本；已有用户副本不覆盖。
- [升级后会话无法加载与历史恢复](docs/session-recovery.md)：预设入口兼容、用户覆盖修正、原始日志位置与导出。
- [共用编辑器](../editor-ui/README.md)：UI、Lua、服务端逻辑、主题、语言、字体与试玩窗口。
- [Studio专题](../studio/README.md#专题树)：图片/音频/动效缓存、输入、部分导出、索引与脚本同步。

Host Tools为`qxqy_script_sync`、`qxqy_studio_get/patch/export/play/load`、`qxqy_studio_ui_screenshot/play_screenshot`。截图使用Host PNG，无需可见标签页；动效视频帧的省略提示见[动效边界](../studio/docs/ui-vfx-playback.md#截图与-gia-边界)。

工作区绑定DSH会话原始工程根。存档发现复用Studio，支持大于8MiB的存档，选最近50项并返回`discovery`限制/诊断；指定工作区内路径不受列表筛选限制。加载成功记住相对路径，省略保存路径时写回；未绑定时返回`{ bound:false, archives:[] }`。

<a id="harness-02-兼容性"></a>
<a id="harness-021-兼容性"></a>
## 宿主兼容契约

- 宿主准入与 npm peer 的预发布匹配规则不同；兼容范围以根 `package.json` 为准，不用忽略 peer 代替适配。依据：[插件兼容](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.0-rc.2/packages/boot/plugin-manager/README.md#version-compatibility-and-exemptions)。
- 新版默认使用声明式预设；构建从主维护源生成注册项与旧目录副本，更新旧 `.agent-presets` 不一定生效。Persona 变量与用户副本处理见[预设说明](../agent/wonderland-lua-builder/README.md#persona-工作目录变量兼容性)，`list-agents` 入口及持久化接口见[会话恢复](docs/session-recovery.md)。
- 嵌入预设的 `baseUrl` 可能来自合成 profile，Skill 须按安装包定位；旧目录预设才使用相邻 `skills/`。`test:harness` 验证正文及 `references/workflow.md` 可读，不能只检查菜单可见。
- 模拟器绑定会话原始工程 cwd；Shell 切目录不切换编辑工程。工具定义、JSON 输出、附件、HTTP 路由、ModuleLoader 与 `conversation.view` 由适配层对接，共享 VM/存档不按宿主版本另建分支。子代理与 Agent Team 调度由官方插件处理，旧 `backgroundMode` 不构成新版同步等待承诺。

<a id="desktop-内嵌试玩208"></a>
## Desktop 内嵌试玩

Desktop 拒绝页面子窗口时，在保存成功后回退同源全屏 iframe。关闭、返回和 Escape 等待 stop 成功，失败可重试，编辑器保持挂载；完整生命周期见[共用编辑器](../editor-ui/README.md#试玩窗口与内嵌兜底)。

## 故障定位

### Desktop protobuf 导入失败

完整 protobufjs 编入 Host/Worker，使 GIA 解析独立于宿主共享 CommonJS 导出。旧包报 `hu.parse is not a function` 时，更新插件、保存工作并从托盘完整退出 Harness 后启动；禁用/启用无法清除失败的 ESM 导入缓存。`test/protobuf-bundle.test.mjs` 验证独立进程中的依赖隔离与 GIA 往返；原 Desktop0.2.1-rc.2 窗口的完整触发链和回验未确认。

<a id="路由重复注册2011"></a>
### 路由重复注册

`webserver: duplicate prefix route "/qxqy-simulator/api"` 不足以证明重复安装。HTTP 路由的注销函数由 `ctx.effect` 管理，部分注册失败回滚；卸载等待 Worker 退出并拒绝迟到请求。更新并完整重启可清除旧残留；真实同时挂载冲突仍报错，不覆盖其他组件。`test/lifecycle.test.mjs` 覆盖重启、依赖重载、回滚及 HTTP/工具共用 Registry；反馈者原始 Desktop 再激活事件未复现。

## 验证入口与边界

构建/安装检查统一见[分发验收](../DISTRIBUTION.md#验收入口与证据范围)。`test:packages`覆盖dsh-tools0.1.0-rc.6、0.2.0-rc.2、0.2.1-rc.2、0.2.2-rc.1；`test:harness`默认0.2.2-rc.1，可传已有CLI路径测旧版本。DSH 0.2.2 要求 Node.js 24.9+（Desktop 使用自带运行时）；Web/MCP 的 Node.js 最低版本仍查各自清单。浏览器语言验收另设`QXQY_BROWSER`。

`test/plugin.test.mjs` 与 `test/lifecycle.test.mjs` 只维护宿主协议、注册工具、会话隔离和 Worker 生命周期；共享编辑、存档、GIA 与 PNG 的功能回归归 Studio，安装包与真实 Harness 检查继续验证交付边界。

既有完整 Web 宿主观察范围为 Windows / Node24.21.0 / Harness0.2.1-rc.2 与0.2.2-rc.1，`observed / simulator / not_required`，不涵盖真实模型/Agent Team、完整签名 Desktop、Linux/macOS、SSH 或子路径 public-url 部署。Windows 隔离 Git 安装可用 `npm_config_package_import_method=copy` 避免已加载 Canvas DLL 的 unlink/EPERM 冲突；文件占用与构建审批拒绝应分别处理。
