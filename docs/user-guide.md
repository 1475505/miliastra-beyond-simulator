# 千星沙箱模拟器使用指南

千星沙箱模拟器用于制作千星奇域 2D + Lua 游戏。你和 AI 可以先在电脑上编辑界面、试玩和修改，再把作品导入千星沙箱。

文中的按钮和菜单名称以简体中文界面为准。

## 目录

- [一、从哪里开始](#about)
- [二、安装到 DeepSeek Harness：全步骤](#harness)
- [三、安装到其他 AI 应用：全步骤](#connect-ai)
- [四、快速入门示例：试玩、保存，再让 AI 改一次](#quick-start)
- [五、制作自己的游戏：从想法到可试玩作品](#ai)
- [六、带到千星沙箱：导入、校准和试玩](#device)
- [七、下次继续制作与更新](#continue)
- [八、常见问题](#faq)
- [工具与参考入口](#references)

<a id="about"></a>
## 一、从哪里开始

### 先选一条路线

| 你的情况 | 从这里开始 | 完成后能做什么 |
|---|---|---|
| 想在一个应用里聊天、制作和试玩 | [DeepSeek Harness 全步骤](#harness) | 在同一对话中让 AI 制作，并打开模拟器查看。 |
| 已经在用 WorkBuddy、Codex、OpenCode 等 AI 应用 | [其他 AI 应用全步骤](#connect-ai) | 让现有 AI 操作模拟器，在浏览器里看结果。 |
| 只想先体验示例 | [只安装 Web 编辑器](#web-only) → [快速入门示例](#quick-start) | 自己打开、试玩和保存作品，无需先配置 AI 或编写 Lua。 |
| 模拟器已经打开 | [快速入门示例](#quick-start) | 试玩并保存第一份工程；已有作品也可直接[导入游戏](#device)。 |

两条 AI 安装路线任选一条。想边看边做，可以配合[在线图文课件](https://ppt.070077.xyz/beyond-ai/index.html)或[视频教程](https://www.bilibili.com/video/BV1goHj6REq4/)。

### 为什么要同时准备模拟器和知识库？

AI 会写代码，但制作千星游戏时，还需要查到客户端接口，看到代码运行后的画面。知识库提供千星文档；模拟器让 AI 编辑工程、运行脚本、查看截图和日志。玩法和风格由你决定，试玩后的反馈也要告诉 AI。

模拟器方便反复调整。做完后，把资产导入千星沙箱，完成关卡配置，再走一遍开局、操作、结算和重开，确认实际效果后发布。

<a id="harness"></a>
## 二、安装到 DeepSeek Harness：全步骤

### 2.1 安装 Harness，准备游戏文件夹

1. 从 [DeepSeek Harness 官网](https://www.deepseek.com/harness/)下载适合电脑系统的桌面版，安装并打开。
2. 新建一个存放游戏的文件夹。本文用 Windows 路径 `C:/my-game` 举例，按自己的电脑情况选择位置即可。
3. 点击 Harness 的 **「选择工作区」**，添加并选中这个文件夹。

这个文件夹就是工作区。模拟器使用当前对话的工作区，下次继续同一个游戏时，要选回这里。

### 2.2 配好模型，先确认能聊天

打开 **「设置 → 模型」**，配置所用服务商，再到对话中选择模型。使用 DeepSeek API 时，从 [DeepSeek 开放平台](https://platform.deepseek.com/)取得 API Key，填入设置；其他服务商的配置方法见 [Harness 模型配置说明](https://deepseek-harness.github.io/deepseek-harness/guide/providers)。

新建对话，问一个普通问题。能正常回复后，继续安装插件。

### 2.3 安装并启用两个插件

打开侧栏 **「插件 → 添加插件」**，分别输入下表中的内容，安装后点击 **「立即启用」**。

| 插件 | 在「添加插件」中输入 | 用来做什么 |
|---|---|---|
| 千星沙箱模拟器 | `dsh-plugin-beyond-simulator` | 编辑、试玩、测试和保存游戏，并提供七步制作预设。 |
| 千星沙箱知识库 | `github:1475505/dsh-plugin-miliastra-toolbox` | 让 AI 查询千星沙箱文档与客户端 Lua 接口。 |

桌面版使用自带运行环境，可直接从界面安装插件。GitHub 来源的安装需要 Git；如果电脑尚未安装，先从 [Git 官网](https://git-scm.com/downloads)安装，再完整退出并重新打开 Harness。

在「插件」页确认两个插件都已启用，界面可参考[课件：安装 Harness 插件](https://ppt.070077.xyz/beyond-ai/index.html#harness)。报错时查看[模拟器插件说明](https://github.com/1475505/miliastra-beyond-simulator/blob/master/dsh-plugin/README.md)或[知识库插件说明](https://github.com/1475505/dsh-plugin-miliastra-toolbox)。

### 2.4 选择游戏制作预设，确认接通

1. 在这个工作区新建会话，选择 **「千星 2D+Lua 游戏制作」** 预设。它会指导 AI 按策划、实现、测试和交付的顺序推进。
2. 在该会话打开 **「模拟器」** 视图。顶栏应显示你选择的工作区；新工程暂时空白是正常的。
3. 把下面这段发给 AI：

> 请先检查制作环境：读取当前模拟器状态，告诉我工作区路径和是否已有工程；确认能读取七步制作工作流；通过知识库读取客户端控件使用说明和客户端 Lua API，列出实际读到的文档来源。缺少哪一项就指出哪一项，检查完成后带我打开快速上手示例。

检查 AI 的工具调用结果：工作区路径应与你选择的一致，知识查询应返回文档来源。只回复“已经准备好了”还不足以确认接通。

找不到预设时，先在 **「设置 → Agent 预设」** 核对插件是否已注册，再新建会话选择。完成后进入[第四章：快速入门示例](#quick-start)。

使用命令行版 Harness 的用户，另见[插件命令安装说明](https://github.com/1475505/miliastra-beyond-simulator/blob/master/dsh-plugin/README.md#安装与更新)；桌面版命令操作见 [Desktop 指引](https://github.com/1475505/miliastra-beyond-simulator/blob/master/dsh-plugin/docs/session-recovery.md#用户恢复步骤)。

<a id="connect-ai"></a>
## 三、安装到其他 AI 应用：全步骤

先确认你的 AI 应用能正常对话，并支持本地 MCP 服务。下面分别给出 WorkBuddy、Codex 和 OpenCode 的配置方法。

MCP 让 AI 调用模拟器工具，Web 则是你查看和编辑游戏的网页。后面还会准备制作 Skill 和知识库，分别指导 AI 按步骤制作、查阅千星接口。

<a id="prepare-node"></a>
### 3.1 准备 Node.js 和固定工作区

1. 从 [Node.js 官网](https://nodejs.org/zh-cn)下载适合系统的 **LTS 安装包，版本至少为 22**。Node.js 用来运行模拟器，随附的 npm 用来安装工具。
2. 安装完成后，在 Windows 开始菜单搜索 `cmd`，打开 **「命令提示符」**。已有命令窗口的话，关掉后重新打开，再逐行运行：

   ```sh
   node --version
   npm --version
   ```

   两条都显示版本号，就可以继续。

3. 用文件资源管理器新建游戏文件夹，例如 `C:/my-game`，并在 AI 应用中打开或选择它作为项目工作区。

后文的 `C:/my-game` 都替换成这个文件夹的完整路径。macOS / Linux 用户在系统终端运行相同的安装和启动命令，路径换成本机位置，如 `/Users/你的用户名/my-game`。

### 3.2 安装模拟器工具

在刚才的命令窗口运行，等待安装完成：

```sh
npm install -g beyond-simulator-web beyond-simulator-mcp
```

### 3.3 把 MCP 添加到自己的 AI 应用

配置内容见下表，按所用应用的步骤添加即可。

| 配置项 | 内容 |
|---|---|
| 名称 | `qxqy_simulator`，也可以自定。 |
| 类型 | 本地服务 / stdio。 |
| 命令 | `beyond-simulator-mcp`。 |
| 参数 | `--workspace` 和 `C:/my-game`，作为两个独立参数。 |

#### WorkBuddy

进入 **「插件 → MCP 服务器 → 配置 MCP」**，将下面的服务加入配置并保存。部分版本入口为「连接器 → 自定义连接器」，选择本地命令方式。已有其他服务时，将 `qxqy_simulator` 加入原来的 `mcpServers`，保留已有内容。

```json
{
  "mcpServers": {
    "qxqy_simulator": {
      "command": "beyond-simulator-mcp",
      "args": ["--workspace", "C:/my-game"]
    }
  }
}
```

启用服务，确认显示绿色连接状态；需要时重启应用。配置位置与界面见 [WorkBuddy 官方 MCP 指南](https://www.workbuddy.cn/docs/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/MCP-Guide)。

#### Codex

在 Codex 的 `~/.codex/config.toml` 加入下面一段。Windows 可以在文件资源管理器地址栏输入 `%USERPROFILE%\.codex` 找到该文件；没有时新建 `config.toml`，已有文件则保留原设置。

```toml
[mcp_servers.qxqy_simulator]
command = "beyond-simulator-mcp"
args = ["--workspace", "C:/my-game"]
```

保存并重新启动 Codex，在 MCP 状态中确认服务已加载；CLI 可用 `/mcp` 查看。详细位置见 [Codex 官方 MCP 指南](https://developers.openai.com/codex/mcp)。

#### OpenCode V2

在项目文件夹中添加 MCP。Windows 命令提示符中运行：

```bat
cd /d C:\my-game
opencode mcp add qxqy-simulator -- beyond-simulator-mcp --workspace "C:/my-game"
opencode mcp list
```

在这个项目打开 OpenCode，用 `/mcps` 查看连接状态。配置通常自动生效，需要时用 `/reload` 重新载入。手动配置格式见 [OpenCode 官方 MCP 指南](https://opencode.ai/docs/mcp-servers)。

如果 AI 能读取本机文件并运行命令，也可以把本节连同下面的话发给它：

> 我的游戏工作区是 `C:/my-game`，使用的 AI 应用是【填名称】。请按本指南安装并接入模拟器，保留已有 MCP 配置，让 MCP 和 Web 指向这个工作区。完成后告诉我需要在应用中启用或重启的步骤，并实际检查连接状态。

<a id="web-start"></a>
### 3.4 启动 Web，打开编辑界面

回到命令窗口运行：

```sh
beyond-simulator-web --workspace "C:/my-game" --open
```

保持窗口运行，打开 **[编辑器与快速上手](http://127.0.0.1:4173/editor?quickStart=1)**。默认地址是 `http://127.0.0.1:4173`；若终端显示其他地址，以它为准。首页显示「等待工作区存档」时，进入 `/editor` 开始编辑。

**Web 和 MCP 必须使用同一个工作区。** 这个窗口要一直运行，后面需要执行其他命令时另开窗口。

### 3.5 让 AI 获得制作流程和千星知识

Skill 是供 AI 阅读的操作指南。把下面两个 Skill 文件夹放进工作区：

| 内容 | 获取位置 | 建议放置位置 |
|---|---|---|
| 七步游戏制作 Skill | [模拟器仓库](https://github.com/1475505/miliastra-beyond-simulator)中的 `agent/wonderland-lua-builder/skills/qxqy-game-studio/` | `C:/my-game/skills/qxqy-game-studio/` |
| 客户端 Lua 知识 Skill | [知识库仓库](https://github.com/1475505/Miliastra-toolbox)中的 `skills/miliastra-knowledge-lua/` | `C:/my-game/skills/miliastra-knowledge-lua/` |

打开对应仓库，点击 **「Code → Download ZIP」**。解压后，找到表中的文件夹，连同 `SKILL.md`、`references/` 等内容一起复制到建议位置。也可以按 AI 应用的 Skill 安装方式导入；知识工具另有 [SkillHub 入口](https://skillhub.cn/skills/user_3a6be892/miliastra-toolbox)。

放好后，在对话中让 AI 读取 `SKILL.md`。支持自动识别 Skill 的应用也可按名称调用；已经有知识库插件或本地官方资料的，先让 AI 检查是否可用。

客户端资料的官方入口是[客户端控件和客户端脚本使用指南](https://act.mihoyo.com/ys/ugc/tutorial/detail/mhbgxf0nynww)和[客户端控件 API](https://act.mihoyo.com/ys/ugc/tutorial/detail/mhtakr07vej4)。如果 AI 无法读取网页，可以把所需正文保存或复制给它，并附原链接。

### 3.6 做一次连接检查

把下面这段发给 AI，路径按你的情况替换：

> 请读取 `skills/qxqy-game-studio/SKILL.md` 和 `skills/miliastra-knowledge-lua/SKILL.md`。检查模拟器 MCP 工具是否可用，查询 Web 预览状态并确认工作区是 `C:/my-game`；读取一份客户端控件文档和客户端 Lua API，给出实际来源。新工作区还没有存档是正常的，请分别报告工具连接、Web 连接和知识读取结果。

检查结果中应包含 `qxqy_project_open` 等模拟器工具；`qxqy_preview_status` 应返回正确的工作区，知识查询也应读到文档。接下来[打开并保存示例](#quick-start)，再让 AI 读取这份存档。

<a id="web-only"></a>
### 只想先试玩：最短 Web 路线

按[准备步骤](#prepare-node)安装 Node.js 并创建游戏文件夹，在命令窗口依次运行：

```sh
npm install -g beyond-simulator-web
beyond-simulator-web --workspace "C:/my-game" --open
```

保持窗口运行，打开[编辑器](http://127.0.0.1:4173/editor?quickStart=1)，继续下面的示例。以后想让 AI 制作时，再按本章配置 MCP、准备 Skill 和知识资料。

<a id="quick-start"></a>
## 四、快速入门示例：试玩、保存，再让 AI 改一次

Web 和 Harness 使用同一套编辑器，下面的试玩和导出操作通用。

<a id="open-example"></a>
### 4.1 下载示例，先玩一遍

1. 打开编辑器右下角 **「快速上手」**，选择 **「下载示例，开始实操」**。
2. 下载完成后，点击右上角 **「试玩 ↗」**，按游戏画面的提示操作。
3. 体验开局、主要操作和失败或结束后的重开，再点击 **「返回编辑」**。

下载的飞鱼示例已包含界面和代码，会作为独立教学副本打开。已有工程可通过「返回原工程」切回。下载需要联网，遇到问题见[示例打不开](#faq-example)。

<a id="project"></a>
<a id="files"></a>
### 4.2 保存第一份工程，确认能找回来

存档是工作区里的工程文件，包含界面、脚本及其关联。普通编辑和试玩不会自动保存完整工程，结束制作前记得保存。

- **Web 和 Harness：**打开示例或修改工程后，顶栏最右边会出现 **「保存存档」**。点击它，填写工作区内的相对路径（例如 `first-game.save.json`），再点「保存」。保存成功后按钮隐藏；只切换页面、选择控件或试玩不会让它出现。
- **Harness：**也可以在同一对话告诉 AI：**“请把当前模拟器中的示例副本保存为 `first-game.save.json`，返回保存路径。”**

保存后，从顶部 **「工作区存档」** 重新打开它，再试玩一次。

几个保存按钮的作用不同：

| 操作 | 保存什么、放在哪里 |
|---|---|
| **保存脚本** | 把正在编辑的代码提交给当前工程，之后还要保存完整存档。 |
| **保存存档** | 把完整工程写入工作区，供下次继续。 |
| **导出 → 资产包 JSON（三类合一）** | 下载完整工程副本，适合备份或分享；通常在浏览器下载目录。 |

收到别人的完整 JSON 时，用 **「导入」** 打开，再保存到自己的工作区。若作品还引用独立 `.lua` 文件而没有把代码放入存档，交接时也要带上这些文件。切换工程前先保存当前修改。

### 4.3 让 AI 改一个小地方

已按第二章或第三章接通 AI 后，发送：

> 请打开 `first-game.save.json`，先说明这个游戏的玩法和操作，再把标题改成「我的第一个游戏」。在手机 16:9 和 PC 16:9 下试玩，确认标题完整、开始和重开正常。完成后保存完整存档，告诉我保存路径和测试结果；使用独立 Web 时，请同时在 Web 预览中打开。

只体验 Web 的用户，接通 AI 后再做这一步。

### 4.4 查看新版，再试一次

- **独立 Web 看成果：**打开[存档预览首页](http://127.0.0.1:4173/)。AI 应先保存，再让预览加载这份存档。
- **独立 Web 继续手动编辑：**先保留当前修改，再从编辑器顶部「工作区存档」重新打开 AI 保存的文件。
- **Harness：**在同一对话的「模拟器」视图查看，确认标题已变化，再试玩。

Web 编辑器会保留当前草稿，AI 保存后要重新打开新版。交替制作时，按 **“一方保存 → 另一方打开最新存档”** 交接。

接下来可以[制作自己的游戏](#ai)，或打开右下角「快速上手」，[把示例导入千星沙箱](#device)。

<a id="ai"></a>
## 五、制作自己的游戏：从想法到可试玩作品

### 5.1 先把想法说清楚

先说清这一轮想做到哪里，再用下面六项整理想法。

| 要告诉 AI 的事 | 可以怎样说 |
|---|---|
| **目标** | 先做能玩一局的版本，还是准备发布的完整作品？ |
| **玩家视角** | 玩家先看到什么，点击什么，会得到怎样的反馈？ |
| **原神包装** | 想用哪些角色、场景或世界观元素？ |
| **核心乐趣** | 是反应、解谜、收集，还是选择与成长？ |
| **创作者表达** | 想让玩家感到紧张、轻松、温暖，还是惊喜？ |
| **验收标准** | 哪些操作和结果都成立，才算完成这一轮？ |

想法零散也可以先发给 AI：

> 先帮我把这些想法整理成提纲，把不清楚的地方列出来问我：【写下你的想法】。整理后先复述目标、玩法与验收标准，再列出不确定的地方，我补充后再开始制作。

想练习从零制作，可以用课件中的“30 秒点击星星”：

> 我想做一个单人点击星星小游戏，每局 30 秒。玩家点击星星加 1 分，星星随后换到新的位置；时间结束显示总分，可以重新开始。希望画面轻松明亮，手机上容易点中。第一版验收：每点一次只加 1 分，超时后停止计分，重开后分数和时间重置。请使用七步制作工作流，先复述需求、补齐不确定项，再给我策划提纲。

第四章的飞鱼示例用来熟悉操作，这里的星星小游戏用来练习策划。

### 5.2 按七步制作

Harness 使用「千星 2D+Lua 游戏制作」预设；其他应用让 AI 读取已准备的 `skills/qxqy-game-studio/SKILL.md`。

| 步骤 | 为什么要做 | 你要看什么 |
|---|---|---|
| 1. 策划案 | 把想法变成明确规则和本轮范围。 | 玩法、输赢、操作是否是你想要的。 |
| 2. 测试用例 | 提前约定“什么算做对”。 | 开始、操作、结算、重开的预期结果。 |
| 3. HTML 效果展示 | 先用直观演示确认流程与画面安排。 | 信息是否清楚，下一步操作是否明显。 |
| 4. 美术参考与素材 | 给 AI 具体的视觉方向。 | 配色、角色、图标和背景是否协调。 |
| 5. Lua 实现 | 把已经确认的玩法和画面接入千星控件。 | 能在模拟器打开的完整工程。 |
| 6. 模拟器测试 | 运行规则、检查日志和不同屏幕效果。 | 实际测试结果、截图和仍待处理的问题。 |
| 7. 千星沙箱试玩与修复 | 核对游戏内配置和最终体验。 | 实际可玩，并完成反馈后的修复。 |

HTML 展示用于确认设计，之后再用千星控件和 Lua 实现。完成后，让 AI 保存完整存档、返回路径，从模拟器的「工作区存档」打开试玩。

修改已有作品时，从相关步骤继续。详细流程见[七步制作说明](https://github.com/1475505/miliastra-beyond-simulator/blob/master/agent/wonderland-lua-builder/README.md)。

### 5.3 用参考图和工具确定美术方向

只说“好看一点”，AI 很难知道你的偏好。附一张参考图，说明想用它的哪些特点，以及玩家应该先看到哪里：

> 参考这张图的森林配色与纸感，按我的玩法，让下一步操作更突出。主按钮最醒目，分数和时间清晰，背景装饰不要干扰点击。先给我一版效果展示，确认方向后再制作千星可用的素材。

参考图也可以请具备生图能力的 AI 生成。选好方向后，再用这些工具制作素材：

| 工具 | 适合什么时候用 | 最短使用路径 |
|---|---|---|
| [千星拼图工具](https://qx.070077.xyz) | 用基础图形逐块搭建角色、图标和装饰，方便精细调整。 | 打开工具，制作或调整构图，导出支持的素材格式，再按用途接入作品。 |
| [图元拟合与 GIA 转换](https://qx-img.070077.xyz) | 已有参考图，希望转换为圆、矩形、三角形等千星可用的图元组合。 | 上传图片 → 选择图元种类和数量 → 查看拟合效果 → 导出合适的 GIA 或 Lua。 |
| [千星美术构建 Skill](https://skillhub.cn/skills/user_3a6be892/miliastra-image-css-builder) | 希望 AI 按千星素材规则协助构图和接入。 | 按页面安装说明交给 AI，结合参考图使用。 |

拟合时先用较少图元确认轮廓，再增加细节。素材组 GIA、客户端控件模板和 Lua 绘制脚本的用法不同，导出前先选清用途。把文件交给 AI 时，让它说明放在哪里、怎样显示到游戏中。

若要让 AI 直接操作拼图网页，还需要 AI 应用提供该网页支持的浏览器 / WebMCP 能力。图文演示见[拼图工具](https://ppt.070077.xyz/beyond-ai/index.html#puzzle)和[图元拟合](https://ppt.070077.xyz/beyond-ai/index.html#primitive)。

<a id="usage"></a>
<a id="ui"></a>
### 5.4 在模拟器里查看和调整作品

打开 AI 做好的工程。UI 就是界面：文字显示分数，图片显示目标，按钮接收操作，容器把相关控件放在一起。

在「UI 编辑」中，左侧选控件，右侧改文字、位置、大小或颜色。按 Enter 或点到别处，中央画布就会显示修改结果。

| 编辑器中的位置 | 在制作中怎样理解 |
|---|---|
| **UI控件-服务端** | 组织开局界面，模拟器试玩从这里开始。 |
| **UI控件-客户端** | 管理可反复创建的模板，例如不断生成的星星或障碍物。模板要被创建为实例，才会出现在试玩中。 |
| **Lua 脚本** | 实现点击、计分、倒计时、动画等行为。 |

<a id="scripts"></a>
挂载就是把脚本关联到客户端控件。入口脚本挂在初始界面的客户端控件上，开局时运行；模板上的脚本随实例创建而运行。公共模块由其他脚本调用。

手动改代码时，在「Lua 脚本」选中脚本，查看路径、代码和「挂载目标」。改完先点「保存脚本」，再保存完整存档。开局脚本通常挂在服务端界面内的**容器节点**上，外层“客户端控件容器”负责组织它们。

调整后先切到 **手机 16:9**，确认主要内容完整，再检查 PC 和其他比例。「同步信息至所有设备」用于把布局修改同步到其他平台；需要分别调整时可关闭。同一平台的不同屏幕比例共用布局参数，切换比例用来检查适配。

<a id="settings"></a>
顶部可切换语言，「字体设置」可选择本地字体。保存字体设置后重启模拟器、刷新页面；详见[字体说明](https://github.com/1475505/miliastra-beyond-simulator/blob/master/studio/docs/local-fonts.md)。

<a id="play"></a>
### 5.5 试玩和测试

点击「试玩 ↗」，走完一局游戏。也可以把测试交给 AI：

> 请按策划中的验收标准测试：开始一局、点击目标、等待结束、重新开始，并检查手机 16:9 和 PC 16:9 的画面。报告每项操作的预期与实际结果，检查日志；失败项修复后重新验证。把可重复的操作保存为回放用例，并保存完整工程供我试玩。

排查问题时可以用到：

- **日志**记录脚本输出和错误，适合排查“点了没反应”。
- **暂停和单帧调试**把快速变化停下来，适合检查动画和某个瞬间。
- **回放用例**重复同一组操作，帮助确认修改后原本正常的流程仍能运行。
- **人数与视角**可在本地模拟 1–8 位玩家，查看各自界面；改变人数或设备会重新开局。

<a id="server"></a>
玩法需要共享数据或服务端回应时，让 AI 说明变量和信号的用途，在「服务端逻辑」模拟交互，并列出导入游戏时需要做的服务端配置。

反馈时附上操作步骤和截图，例如“手机上右下角按钮被裁掉”“点一次加了两分”。模拟器测试完成后，继续下一章，在千星沙箱里验证。

<a id="device"></a>
## 六、带到千星沙箱：导入、校准和试玩

第一次导入时，可以同时打开编辑器右下角的 **「快速上手」**，它会提示何时切到千星沙箱、何时回到模拟器。

<a id="export"></a>
### 6.1 保存工程，导出 GIA

先保存完整工程，再选择导出格式：

| 目的 | 导出菜单中的选择 |
|---|---|
| 备份或交给别人继续编辑 | **资产包 JSON（三类合一）**。 |
| 把 UI 和脚本一起导入千星沙箱 | **资产包 GIA 整合包（控件+脚本）**。 |
| 只交付一部分内容 | 按需选择当前界面、部分组合或脚本导出。 |

首次导入用整合包，它包含脚本映射和控件挂载关系。导出后查看 **「上次导出说明」**，确认文件包含哪些内容。单独导出脚本 GIA 时，还要配置挂载，详见 [GIA 导出说明](https://github.com/1475505/miliastra-beyond-simulator/blob/master/studio/README.md#gia-导出与脚本挂载)。

有 AI 协助时，让它列出导入时要核对的内容：

> 请为当前工程列出游戏内交付清单：入口脚本及挂载控件、需要实例化的模板、Lua 实际引用的控件或模板索引、是否需要服务端配置，以及试玩的预期结果。保存完整存档，并按我接下来的实际导入结果协助校准。

### 6.2 导入资产，把界面加入布局

1. 打开千星沙箱中的目标关卡。第一次做单人小游戏时，可在 **「关卡设置 → 人数设置」** 选择 **「固定人数 1」**。
2. 进入 **「系统菜单 → 资产导入导出工具 → 导入与转存」**，点击右下角「加载外部资产」。在弹窗里先「打开目录」，把 GIA 放入该目录，再点击弹窗内「加载外部资产」，选中资产并转存。
3. 进入 **「界面控件组管理 → 界面布局」**，选择当前使用的布局，点击左下角「添加界面控件」，从「自定义模板」选择导入的客户端控件容器。
4. 在 **「窗口 → 客户端脚本资源管理器 → 客户端脚本映射」** 核对脚本名称与文件路径；再选中对应客户端控件，在其 **「脚本」页签**核对挂载。

映射告诉游戏去哪里找代码，挂载告诉游戏哪个控件使用它。与模拟器「Lua 脚本」里的路径和「挂载目标」逐项对照即可。

整合包已包含这些关联，先核对导入结果。映射缺失时，在脚本资源管理器「新建脚本映射」并选择对应 Lua 文件；挂载缺失时，在客户端控件的「脚本」页签「添加脚本」，选择对应映射。

图文位置见[课件：导入与转存](https://ppt.070077.xyz/beyond-ai/index.html#gia-export)，官方说明见[资产导入](https://act.mihoyo.com/ys/ugc/tutorial/detail/mhxbd59urbfu)和[客户端脚本使用指南](https://act.mihoyo.com/ys/ugc/tutorial/detail/mhbgxf0nynww)。

<a id="indices"></a>
### 6.3 校准索引，更新 Lua 引用

索引是控件或模板的编号。导入后编号可能变化，Lua 中用到它的地方也要更新，才能找到控件或创建模板。

1. 在游戏 **「界面控件组库 → 客户端控件模板」** 找到对应模板或子控件，在右侧顶部名称下方复制「索引」。初次示例优先核对 `RectTemplate`、`CircleTemplate`、`TriangleTemplate`。
2. 回模拟器 **「UI控件-客户端」**，选中**同一个模板或子控件**，填入实际索引，点击「修改」。只处理确实变化的相关编号；索引相同就跳过。
3. 有变更时，点击 **「复制提示词给 AI」**。该按钮会先保存当前工程，再提供任务文本；把文本粘贴给已经连接此工作区的 AI。
4. 等 AI 核对并更新相关 Lua 引用、保存完成，点击 **「AI 已处理，重新载入存档」**。
5. 重新试玩确认，再按下一步把新版脚本复制到游戏目录。

重点核对 Lua 用到的对象，尤其是要创建的模板，索引要从模板本身复制。尚未配置 AI 的 Web 用户，先按[第二章](#harness)或[第三章](#connect-ai)接通，再发送任务。

也可使用面板的「全量替换脚本索引」，但它会替换脚本中所有相同文本，包括同值的非索引数字，使用前后都要核对。批量校准和同步规则见[索引同步说明](https://github.com/1475505/miliastra-beyond-simulator/blob/master/studio/docs/control-guid-sync.md)，画面位置见[课件：索引核对](https://ppt.070077.xyz/beyond-ai/index.html#gia-lua-sync)。

<a id="script-sync"></a>
### 6.4 绑定游戏脚本目录，复制最新代码

实机脚本同步会把代码复制到千星沙箱使用的目录。首次绑定后，再改速度、分数、判定等脚本内容，都可以这样更新。

先在游戏 **「窗口 → 客户端脚本资源管理器」** 中，从「客户端脚本映射」找到本游戏脚本，双击打开目录，向上找到并复制 `default_import_file` 文件夹的完整路径。

回到模拟器 **「Lua 脚本 → 实机脚本同步」**，填写：

| 字段 | 快速上手下载示例怎样填 | 自己的工程怎样判断 |
|---|---|---|
| 项目脚本文件夹 | **留空**。代码已经包含在存档中。 | 按脚本在工作区中的位置填写，让 AI 提供路径。 |
| 千星沙箱脚本文件夹 | 填刚复制的 `default_import_file` 完整路径。 | 同样填写当前账号、当前关卡对应的目录。 |
| 游戏里的项目子文件夹 | **留空**，保留原脚本映射路径。 | 与游戏中已有脚本映射路径对应。 |
| 模拟器存档文件 | 例如 `first-game.save.json`。 | 当前完整工程的工作区相对路径。 |

也可以用「发现本机目录」选择账号与关卡。下载示例无需先创建独立 Lua 文件夹。填好后依次操作：

**「保存设置」→「保存存档并查看更新」→ 核对源文件和目标路径 → 勾选脚本 →「确认复制」。**

点「保存设置」会记住目录，点「确认复制」才会更新文件。目录示例见[脚本同步指南](https://github.com/1475505/miliastra-beyond-simulator/blob/master/studio/docs/script-sync.md#人工流程)，截图见[课件：路径绑定](https://ppt.070077.xyz/beyond-ai/index.html#gia-path-binding)。模拟器运行在另一台电脑上时，按游戏映射路径手动复制代码。

### 6.5 保存关卡，实际试玩并反馈

回到千星沙箱，**保存关卡，再重新试玩**。走完开始、主要操作、结束和重开，并核对手机等目标设备上的表现。

出现错误时，在游戏 **「窗口 → 日志」** 勾选 **「客户端脚本」**，重现问题，双击报错查看详情。把完整错误、截图和操作步骤交给 AI：

> 工程是【存档名】。我在千星沙箱中按【操作顺序】操作，预期【结果】，实际【结果】。设备/游戏版本是【填写】，客户端脚本日志如下：【粘贴详情】。请结合当前工程和实际索引定位问题，修复后说明改了哪些文件、如何更新，以及我需要重试的步骤。

日志位置可参考[课件：查看日志](https://ppt.070077.xyz/beyond-ai/index.html#logs)。每轮修复后，更新脚本、保存关卡并重试相同步骤，直到实际结果符合验收标准。

<a id="continue"></a>
## 七、下次继续制作与更新

### 7.1 保存并关闭，下次继续

结束前保存完整存档；重要阶段可再导出 JSON 备份。

- **Harness：**下次打开应用，选择同一工作区和会话，再打开「模拟器」并加载已保存的作品。
- **独立 Web：**保存后可在启动它的终端按 `Ctrl+C` 停止。下次打开命令窗口，运行相同的完整路径命令，再到编辑器的「工作区存档」打开作品：

  ```sh
  beyond-simulator-web --workspace "C:/my-game" --open
  ```

- **MCP：**通常随 AI 应用启动。继续工作前确认它仍指向同一工作区。

### 7.2 把修改更新到游戏

| 这次改了什么 | 下一步 |
|---|---|
| 已有脚本的数值、逻辑、脚本生成的画面 | 保存并试玩 → 查看脚本更新 → 确认复制 → 游戏保存并重试。 |
| 新增脚本 | 更新文件，并在游戏建立对应映射和必要挂载。 |
| 编辑器里的 UI 或模板结构 | 重新导入相应资产，核对关联和索引，再同步脚本。 |

AI 和你交替制作时继续使用[保存后重新打开的交接方法](#quick-start)。希望 AI 直接同步已绑定的游戏目录时，可以明确说：“请保存当前工程，核对本次差异并把改动脚本同步到已绑定目录，返回复制结果；我会在游戏内保存试玩。”

### 7.3 更新模拟器

先保存作品。Harness 用户从插件安装入口更新，完整退出后重新打开应用。Web / MCP 用户重新执行安装命令，例如两者都安装时运行：

```sh
npm install -g beyond-simulator-web beyond-simulator-mcp
```

安装完成后，重启 Web 和 AI 应用，刷新网页。更新内容见 [GitHub Releases](https://github.com/1475505/miliastra-beyond-simulator/releases)。

<a id="faq"></a>
## 八、常见问题

### 只体验示例，需要 AI、知识库或会写 Lua 吗？

按[最短 Web 路线](#web-only)安装后就能试玩和保存示例。想让 AI 修改或从零制作时，再配置 MCP 和知识库。游戏导入后若索引变化，按[索引同步流程](#indices)处理。

<a id="faq-install"></a>
### 安装失败、找不到命令，或页面打不开？

独立 Web / MCP 用户依次检查：

1. 新开命令窗口，运行 `node --version` 和 `npm --version`，确认安装完成。PowerShell 若提示 `npm.ps1` 禁止执行，改用开始菜单里的「命令提示符」运行相同命令。
2. 确认 npm 安装命令成功，工作区文件夹已经存在；找不到新装命令时，重新打开终端或 AI 应用。
3. 确认 Web 启动窗口仍在运行，访问地址与其输出一致。只安装 MCP 时，继续完成[启动 Web](#web-start)。

仍有报错时，把完整错误和所用命令交给 AI，或查阅 [Web 启动说明](https://github.com/1475505/miliastra-beyond-simulator/blob/master/web/README.md#安装与启动)。Harness 用户按[插件安装步骤](#harness)检查启用状态。

### 关闭终端后网页打不开，下次还要重装吗？

重新启动即可。关闭终端会停止 Web，下次运行[第七章的启动命令](#continue)，选择同一工作区，再打开已保存的存档。

<a id="faq-mcp"></a>
### MCP 已添加，为什么 AI 仍说没有工具？

先在应用的 MCP 页面确认服务已启用且连接正常，再重启应用或新建会话。配置中的命令和工作区必须有效；终端能找到命令，但应用找不到时，重新启动应用以加载安装后的环境。

已经保存示例的，可以让 AI 调用工具打开 `first-game.save.json`，返回作品名称。仍失败时，把 MCP 连接错误和配置交给 AI；配置入口见[第三章](#connect-ai)。

<a id="faq-example"></a>
### 快速上手没有示例，或示例下载失败？

- 已选「用当前存档继续」：点击引导卡片的 **「打开示例存档」** 返回欢迎页，再选择下载。
- 欢迎页根本没有下载按钮：更新**正在使用的 Web 或 Harness 插件**，重启后再看；仍没有时提供版本和截图。
- 下载报错：检查运行模拟器的电脑能否联网。也可手动下载[示例 JSON](https://ppt.070077.xyz/beyond-ai/flappy-fish.save.json)，在模拟器「导入」后保存自己的副本，或使用已有完整工程继续引导。

<a id="faq-preview"></a>
### 首页一直等待存档，或 AI 修改后页面没变？

新工作区还没有作品时，进入[编辑器](http://127.0.0.1:4173/editor)开始即可。已有作品时，让 AI 确认已经保存，并让 Web 预览打开正确文件；同时核对 MCP 与 Web 的工作区。

如果你在编辑器中，先保留当前修改，再从「工作区存档」打开新版。索引同步任务完成后，使用「AI 已处理，重新载入存档」。

<a id="faq-archive-list"></a>
### 找不到自己的存档？

先看顶栏的工作区位置，再检查文件是否在这个文件夹里。导出的 JSON 可能还在浏览器下载目录，用「导入」打开后再保存。GIA、单项 UI 文件和 Lua 脚本也用「导入」打开，存档列表只显示完整工程。

Harness 显示「工作区未绑定」时，通过「选择工作区」添加并选择游戏文件夹，再在该工作区新建或打开对应会话。

<a id="faq-save-conflict"></a>
### 保存时提示文件已存在或被修改？

通常是文件已经存在，或 AI、另一个窗口保存了新版本。先另存为其他文件名，或导出完整 JSON 保留当前修改，再打开最新存档。需要合并时，把两份文件和各自改动告诉 AI。

<a id="faq-script-mount"></a>
<a id="faq-layout"></a>
### 编辑器里有内容，为什么试玩时没显示或没有反应？

先确认它属于初始界面，还是等待脚本创建的客户端模板，再检查入口脚本挂载和试玩日志。概念与查看位置见[在模拟器里查看作品](#usage)。

左侧树的眼睛开关只影响编辑画布。控件开局是否显示，由「初始可见性」和脚本决定。

### GIA 已导入，为什么千星沙箱里空白或不能操作？

先检查导入的客户端控件容器是否已加入**当前布局**，再核对入口脚本的映射和挂载。查看客户端脚本日志；若报找不到对象或无法创建模板，检查实际索引及 Lua 引用是否同步。按[第六章](#device)顺序检查，最后保存关卡并重新试玩。

<a id="faq-script-source"></a>
### `.lua` 文件改了，为什么试玩还是旧代码？

AI 或外部编辑器可能只改了 `.lua` 文件，工程里还是旧代码；试玩优先使用工程中的版本。在「实机脚本同步」查看差异，选择「改用项目文件里的代码」，或让 AI 把两份代码更新一致，再保存并重新试玩。

<a id="faq-input"></a>
<a id="faq-audio"></a>
### 键盘没反应，或者没有声音？

先点击试玩画布，并确认「键位响应」开启。声音需要点击「开启声音」，同时检查静音和暂停状态；AI 工具启动的试玩默认静音。

<a id="faq-script-sync"></a>
### 脚本复制成功，为什么游戏仍是旧效果？

回千星沙箱**保存关卡并重新试玩**。仍未变化时，检查目标是否为当前账号、当前关卡的目录，映射是否指向该文件。新增脚本要有映射和必要挂载，索引变化也要同步进 Lua。

<a id="faq-update"></a>
### 更新后为什么还是旧界面？

安装新版后，旧进程可能仍在运行。按[更新步骤](#continue)保存、重启对应入口并刷新网页；Harness 需要完整退出应用，必要时从系统托盘退出后再打开。

<a id="faq-scope"></a>
### 能制作 3D 游戏、真实联机或直接发布吗？

模拟器主要用于 2D + Lua 客户端游戏。多人试玩在本地模拟多位玩家的界面与交互；完整 3D 关卡、服务端节点图、真实网络联机和发布，需要在千星沙箱及相应环境中完成。

### 知识库网页能回答 Lua 问题吗？

[知识问答网页](https://ugc.070077.xyz)适合查询通用千星知识和节点图问题。客户端 2D + Lua 制作请使用 Harness 知识库插件的客户端能力，或第三章的 `miliastra-knowledge-lua` Skill 与官方客户端文档。

<a id="faq-report"></a>
### 还有问题，怎样求助？

可以先问协助制作的 AI，或使用底栏「联系作者」及 [GitHub Issues](https://github.com/1475505/miliastra-beyond-simulator/issues)。说明使用入口、模拟器版本、操作步骤、预期与实际结果，并附相关存档、错误文本或截图。

问题只出现在千星沙箱时，再提供游戏版本、设备和客户端脚本日志，便于核对游戏内配置。

<a id="references"></a>
## 工具与参考入口

- **跟着演示操作：**[在线课件](https://ppt.070077.xyz/beyond-ai/index.html) · [视频教程](https://www.bilibili.com/video/BV1goHj6REq4/)。
- **安装和接入细节：**[Harness 插件](https://github.com/1475505/miliastra-beyond-simulator/blob/master/dsh-plugin/README.md) · [MCP](https://github.com/1475505/miliastra-beyond-simulator/blob/master/mcp/README.md) · [Web](https://github.com/1475505/miliastra-beyond-simulator/blob/master/web/README.md) · [七步制作工作流](https://github.com/1475505/miliastra-beyond-simulator/blob/master/agent/wonderland-lua-builder/README.md)。
- **知识资料：**[客户端使用指南](https://act.mihoyo.com/ys/ugc/tutorial/detail/mhbgxf0nynww) · [客户端 API](https://act.mihoyo.com/ys/ugc/tutorial/detail/mhtakr07vej4) · [知识工具仓库](https://github.com/1475505/Miliastra-toolbox) · [通用知识问答](https://ugc.070077.xyz)。
- **美术工具：**[拼图](https://qx.070077.xyz) · [图元拟合与 GIA 转换](https://qx-img.070077.xyz) · [美术构建 Skill](https://skillhub.cn/skills/user_3a6be892/miliastra-image-css-builder)。
- **游戏交付细节：**[GIA 导出](https://github.com/1475505/miliastra-beyond-simulator/blob/master/studio/README.md#gia-导出与脚本挂载) · [索引同步](https://github.com/1475505/miliastra-beyond-simulator/blob/master/studio/docs/control-guid-sync.md) · [脚本同步](https://github.com/1475505/miliastra-beyond-simulator/blob/master/studio/docs/script-sync.md)。
- **确认支持范围：**[控件](https://github.com/1475505/miliastra-beyond-simulator/blob/master/studio/docs/control-support.md) · [图片](https://github.com/1475505/miliastra-beyond-simulator/blob/master/studio/docs/image-assets.md) · [音频](https://github.com/1475505/miliastra-beyond-simulator/blob/master/studio/docs/audio-assets.md) · [动效](https://github.com/1475505/miliastra-beyond-simulator/blob/master/studio/docs/ui-vfx-playback.md)。
