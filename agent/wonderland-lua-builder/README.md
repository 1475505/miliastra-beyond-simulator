# 千星 2D+Lua 游戏制作工作流与 Agent 预设

这里维护一套可由不同 AI 工具读取的七步制作工作流，以及 DeepSeek Harness 的 Agent 注册配置。工作流目标是交付 Lua 游戏与完整存档，并根据真机回传修复问题。

## 文档组织

[Skill 入口](skills/qxqy-game-studio/SKILL.md)保留共同约束和步骤索引；首次进入或恢复时读取 [workflow.md](skills/qxqy-game-studio/references/workflow.md)做 PREFLIGHT，先发现工作区与 AI 配置中的知识来源并核验可用性，随后只读取当前步骤。每份步骤文档统一说明输入、执行动作、产物/完成条件以及下一步/回退。

| 步骤 | 独立文档 |
|---|---|
| 1. 策划案 | [01-game-design.md](skills/qxqy-game-studio/references/01-game-design.md) |
| 2. TDD 制定测试用例 | [02-test-cases.md](skills/qxqy-game-studio/references/02-test-cases.md) |
| 3. HTML 效果展示 | [03-html-prototype.md](skills/qxqy-game-studio/references/03-html-prototype.md) |
| 4. 准备千星美术参考图和素材 | [04-art-assets.md](skills/qxqy-game-studio/references/04-art-assets.md) |
| 5. Lua 编码实现 | [05-lua-implementation.md](skills/qxqy-game-studio/references/05-lua-implementation.md) |
| 6. 测试 | [06-simulator-testing.md](skills/qxqy-game-studio/references/06-simulator-testing.md) |
| 7. 真机试玩验证与 bug 修复 | [07-device-validation.md](skills/qxqy-game-studio/references/07-device-validation.md) |

PREFLIGHT 不计入七步。新游戏按顺序推进；已有工程从缺失证据继续，窄修复只读取受影响步骤。步骤 1–4 不操作模拟器；HTML 是体验展示。七份文档按需读取才能减少无关上下文，无需一次加载全部内容。

## 在 OpenCode、WorkBuddy、Codex 等工具中使用

1. 按 [MCP 接入指南](../../mcp/README.md)连接模拟器，检查实际工具是否可见；需要浏览器查看和试玩时，同时启动指向同一工作区的 [Web](../../web/README.md)。
2. 把完整的 `skills/qxqy-game-studio/` 放在 AI 可读取的位置，保留 `SKILL.md` 与 `references/` 的相对路径。可按宿主的 Skill 机制安装，或在项目指引/对话中直接指定入口文件，按需读取即可。
3. 给 AI 提供当前项目、想法或待修复问题。安装 MCP 服务不会自动加载此工作流，也不会安装 Harness 的 Agent 预设。

例如，在本仓库可读时：

> 请读取 agent/wonderland-lua-builder/skills/qxqy-game-studio/SKILL.md，先检查已有工程并确定当前步骤，再只读取该步骤文档。通过当前 MCP 工具制作和测试游戏，把结果保存到我的游戏工作区。

模拟器操作说明见 [skill/SKILL.md](../../skill/SKILL.md)，其中 UI 路径和无 `handle` 的示例以 Harness 为背景；MCP 的句柄、保存和 Web 同步方式以 [MCP 指南](../../mcp/README.md)及当前工具 schema 为准。只使用 Web 时，AI 可以编辑工作区文件，由用户加载检查；直接操作网页需要宿主提供浏览器能力。

## 在 DeepSeek Harness 中使用与分发

预设 ID：`wonderland-lua-builder`；显示名：**千星 2D+Lua 游戏制作**。`preset.yml` 与 `agent.cordis.yml` 是 Harness 专属配置，其他工具复用上述 Skill 内容。

DSH 0.1.7-rc.1 起，本仓库根包 `dsh-plugin-beyond-simulator` 在构建时读取这两个配置，生成 `dsh-plugin/cordis.patch.yml` 中的 Agent 预设注册项，并把 Skill 连同全部步骤文档复制到包内。旧版复制入口同时保留，启动时仅在 `$DSH_HOME/.agent-presets/wonderland-lua-builder` 不存在时复制预设，不覆盖用户修改。

通过仓库根目录的 `dsh plugin --profile web add github:1475505/miliastra-beyond-simulator` 安装插件后，在 DSH 的 **设置 → Agent 预设** 中查找本预设；新任务可选择它，已有任务不会自动切换。修改此目录中的主维护源后，在仓库根运行 `pnpm build` 同步包内副本；已安装的用户预设不会自动被覆盖。

## 资料与验证边界

启动前先检查工作区指引、本地知识目录，以及当前 AI 宿主的插件/MCP/Skill 配置和可见能力，寻找 `miliastra-toolbox` 系列或其他知识来源。确认当前能读到官方客户端 2D/Lua API 与使用指南，记录来源、版本和缺项；已有资料直接复用，仅询问仍缺少的内容。详见 [知识库发现与可用性核验](skills/qxqy-game-studio/references/workflow.md#知识库发现与可用性核验)。本工作流不捆绑官方知识库，不能从普通 Lua/UI 或 3D 节点经验猜接口。

步骤 7 同时负责交付后的协作：引导用户完成导入/挂载、核对真实索引、选择脚本更新方式；需要时绑定导入后的脚本目录。AI 准备修改、保存和差异预览，用户在编辑器确认复制并在千星沙箱保存试玩；手动修改也要同步回项目。详见 [真机交付步骤](skills/qxqy-game-studio/references/07-device-validation.md)及[实机脚本同步能力](../../studio/docs/script-sync.md)。

模拟器只预览 `100001–100006` 六种基础图元，其他官方图片 ID 显示缺失框，需真机确认。行为评估见 [agent-behavior.md](evals/agent-behavior.md)；模拟器通过不等于真机通过。
