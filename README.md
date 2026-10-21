# 千星沙箱模拟器

简体中文 | [English](README.en.md) | [Quick Guide](https://ppt.070077.xyz/beyond-ai/index.html)

面向千星奇域 **2D + Lua 游戏开发**的独立模拟器。在浏览器中编辑 UI、运行脚本、试玩调试，也可以让 AI 直接操作、截图和测试，完成后导出资产到游戏中验证。

提供 **Web 编辑器、MCP 服务和 DeepSeek Harness 插件**，支持 OpenCode、WorkBuddy、Codex 等 AI 工具。

## 包含什么

| 能力 | 说明 |
|---|---|
| **可视化 UI 编辑** | 创建 11 类客户端控件，调整层级、位置、尺寸、锚点和属性。 |
| **Lua 脚本运行** | 管理多个脚本，挂载到客户端控件或模板，调试输入与动画。 |
| **独立试玩** | 支持鼠标、触摸和按键，可暂停、单步并查看日志。 |
| **设备与多人模拟** | 提供 5 种 PC / 手机画布，支持本地 1–8 人试玩与视角切换。 |
| **AI 自动测试** | 编辑工程、发送输入、截图，录制和回放测试用例。 |
| **七步制作工作流** | 从策划、TDD、HTML 演示到美术、Lua 实现、测试与真机验证。 |
| **存档与资产交换** | 保存完整 JSON 工程，导入导出 UI、Lua 和已支持的 GIA 内容。 |

控件能力详见 [客户端控件支持矩阵](studio/docs/control-support.md)。

## 集成方式

| 方式 | 适用场景 |
|---|---|
| **[Web 编辑器](#web-部署)** | 在浏览器中独立编辑和试玩，或查看 AI 修改后的工程。 |
| **[MCP 服务](#mcp-接入)** | 让 OpenCode、WorkBuddy、Codex 等 AI 工具直接编辑和测试。 |
| **[DeepSeek Harness 插件](#deepseek-harness-插件)** | 在 Harness 内使用编辑器、模拟器工具和游戏制作 Agent。 |

### Web 部署

需要 **Node.js 22+**：

```sh
npm install -g beyond-simulator-web
mkdir ../my-game
beyond-simulator-web --workspace ../my-game --open
```

`my-game` 用于保存游戏文件；已有工程可直接指定目录，例如 `--workspace E:/my-game`。

- [编辑器](http://127.0.0.1:4173/editor)：编辑、保存和试玩。
- [存档预览](http://127.0.0.1:4173/)：查看已保存的工程，文件更新后自动刷新。

支持 Docker 部署。对外提供服务时需配置访问口令和 HTTPS，适合单个可信操作者使用。详见 [Web 指南](web/README.md)。

### MCP 接入

需要 Node.js 22+，以及支持本地 MCP stdio 的 AI 客户端：

```sh
npm install -g beyond-simulator-mcp
```

在客户端添加本地 stdio 服务：

| 配置项 | 值 |
|---|---|
| 服务名（自定） | `qxqy-simulator` |
| 命令 | `beyond-simulator-mcp` |
| 参数 | `--workspace`、已有游戏目录的绝对路径，例如 `E:/my-game` |

配置参考：[OpenCode](https://opencode.ai/docs/mcp-servers/)、[WorkBuddy](https://open.workbuddy.cn/docs/connector)、[Codex](mcp/README.md#codex-接入)。接入后应能看到 `qxqy_project_open`、`qxqy_studio_play` 等工具。

MCP 可独立使用，也可与 Web 指向同一工作区：AI 保存工程后，即可在 Web 存档预览中查看。完整配置见 [MCP 指南](mcp/README.md)。

### DeepSeek Harness 插件

需要 Node.js 22+ 和 DeepSeek Harness：

```sh
dsh plugin --profile web add dsh-plugin-beyond-simulator
dsh web
```

为会话绑定游戏工作区，打开「模拟器」视图。新建会话时可选择「千星 2D+Lua 游戏制作」Agent 预设。

更新时重新执行安装命令并重启 Harness；已有用户 Agent 预设会保留。GitHub / 本地包安装及版本兼容说明见 [Harness 插件指南](dsh-plugin/README.md)。

## 用 Agent 七步制作游戏

提供游戏想法、参考图或已有工程，在 Harness 中选择游戏制作 Agent，或让其他 AI 工具读取 [七步制作 Skill](agent/wonderland-lua-builder/skills/qxqy-game-studio/SKILL.md)，通过 MCP 开始制作。

| 步骤 | 产出 |
|---|---|
| **1. 策划案** | 核心玩法、操作、计分与胜负规则。 |
| **2. TDD 测试用例** | 开局、成功、失败、重开及边界情况的操作与预期。 |
| **3. HTML 演示** | 可试玩的效果展示，用于确认画面、操作和节奏。 |
| **4. 千星美术素材** | 参考图、素材清单与 UI 还原方案。 |
| **5. Lua 实现** | 可运行的游戏脚本与完整存档。 |
| **6. 测试** | AI 试玩、问题修复与回归结果。 |
| **7. 真机验证** | 导入、脚本挂载与更新说明，以及真机反馈修复。 |

开始前需连接可用的官方 2D/Lua 知识来源，例如 `miliastra-toolbox` 或本地文档；安装包不含官方知识库。配置与流程见 [Agent / Skill 指南](agent/wonderland-lua-builder/README.md)。

## 使用指南

### 1. 准备工程

一个存档包含 **服务端 UI、客户端控件模板和 Lua 脚本**。可从零创建，也可通过顶栏「工作区存档」打开已有工程，或用「导入」载入 JSON、GIA 和 Lua。

### 2. 编辑并试玩

1. 在「UI 编辑」中添加控件，切换 PC / 手机画布检查布局。
2. 在「Lua 脚本」中创建或导入脚本，挂载到客户端控件或模板；模板脚本在实例化时运行。
3. 按需在「服务端逻辑」中配置变量和信号。
4. 点击「试玩 ↗」，使用暂停、单步和「日志」排查问题，也可调整人数并切换玩家视角。宿主不支持新窗口时会进入内嵌试玩，通过「返回编辑」「关闭试玩」或 Escape 返回。

### 3. 让 AI 帮你测试

接入 MCP 或 Harness 后，可直接说明操作与预期，例如：

> 打开我的存档，在手机 16:9 画布试玩。点击开始，再点击目标，检查得分是否增加 1，截图并查看日志。把这组操作记录成测试用例，修改后重新回放。

### 4. 保存与导出

| 目的 | 操作 |
|---|---|
| 继续开发或备份 | 导出「资产包 JSON（三类合一）」，保留 UI、脚本和挂载关系。 |
| 保存到工作区 | 点击「保存存档」，填写相对路径，例如 `my-game.save.json`。 |
| 导入官方编辑器 | 导出对应 GIA，检查导出提示及导入效果。 |
| 单独交换 UI 或脚本 | 导出当前界面 Authoring JSON、脚本包或单个 Lua。 |

编辑和试玩不会自动把完整存档写入磁盘，请在退出前保存；使用 MCP 时可让 AI 调用保存工具。

### 5. 导入真机并持续更新

将资产和脚本导入千星沙箱后，核对实际控件 / 模板索引，并同步 Lua 引用。

后续可让 AI 更新已绑定的脚本目录，也可通过「Lua 脚本 → 实机脚本同步」绑定目录、预览差异并确认复制，再到千星沙箱保存并重新试玩。新增脚本仍需建立映射和挂载；无法直接访问游戏目录时可手动更新。

详见 [真机交付与验证](agent/wonderland-lua-builder/skills/qxqy-game-studio/references/07-device-validation.md)和 [实机脚本同步](studio/docs/script-sync.md)。

## 当前支持边界

- **模拟器通过不等于真机通过**，最终需在千星奇域中验证。
- **多人试玩为本地模拟**，服务端覆盖变量与信号，不包含完整官方节点图或网络联机。
- **图片**支持基础图元、静态素材、元件图标及「基础／拉伸」模式；动效和 3D 模型不在预览范围。详见 [素材说明](studio/docs/image-assets.md)。
- **Lua 2D 音效**支持试玩播放，素材按需下载。详见 [音频说明](studio/docs/audio-assets.md)。
- **GIA 支持已验证的内容子集**，请关注导出提示，保留原始文件和完整 JSON 存档。

## 从源码构建

需要 Node.js 22+、pnpm 10.15.0，在仓库根目录运行：

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm test
```

自行打包和发布见 [分发说明](DISTRIBUTION.md)。

## 开源协议

[GNU GPL v3.0（GPL-3.0-only）](LICENSE) · [源码仓库](https://github.com/1475505/miliastra-beyond-simulator)

## 界面语言与更新

顶部「字体设置」旁可切换语言；自动模式跟随系统语言，非中文环境默认英文。底栏提供「检查更新」和「联系作者」。详见 [界面说明](studio/docs/interface.md)。

## 本地自定义字体

在「字体设置」中选择本地 TTF/OTF 或系统字体，也可自动查找 Windows 原神安装目录。保存后重启宿主并刷新页面，设置仅保存在本机。详见 [字体说明](studio/docs/local-fonts.md)。
