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

Harness 0.2.2 升级后若预设报 `tool-subagent-list-agents … never started`、原会话无法继续，见[会话恢复](../../dsh-plugin/docs/session-recovery.md)。修复保持 `wonderland-lua-builder` ID，历史恢复依赖该预设可再次挂载。

### Persona 工作目录变量兼容性

Persona 仅引用 `{{model}}`；工作目录由宿主上下文与工具提供。Harness0.2.1 移除了 `cwd` 提示词变量，旧 `Your working directory is {{cwd}}.` 会在请求组装时触发 `unknown prompt variable`，见[官方迁移说明](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-rc.2/packages/core/system-prompt/README.md#contribute-a-prompt-variable)（2026-10-18 核对）。

遇到旧引用先确认来源：旧目录预设需保留自定义内容、删除该句并重启；新版声明式预设需更新插件或修正用户 profile 覆盖，单改 `.agent-presets` 无效。注册项和包内副本由构建同步，不手改生成文件。宿主兼容范围及验证入口统一见[DSH 插件](../../dsh-plugin/README.md#宿主兼容契约)。

### 子智能体模型选择

Harness 0.2.2 起，预设按官方 `standard` 的方式在 spawn 工具声明能力（[#24](https://github.com/1475505/miliastra-beyond-simulator/issues/24)）：

```yaml
- id: tool-subagent
  name: '@deepseek-ai/dsh-tool-subagent'
  config:
    provider: spawn
    toolName: subagent
    modelSelection: true
    modelDiscovery: true
```

`modelSelection` 为 `subagent` 添加 `provider`、`model`、`reasoning_effort` 参数；`modelDiscovery` 在该预设作用域注册唯一的 `list_subagent_models`。fork 沿用官方默认，继承父模型。声明式预设、包内旧目录副本均从 `agent.cordis.yml` 构建。

Host 的 `@deepseek-ai/dsh-tool-subagent/model-selection-settings` 管理用户开关与模型白名单；在 Harness 的子智能体设置中配置后**新建会话**，由 Host 保存授权。子会话继承授权，切换预设和恢复历史保留原授权；后改设置不扩张旧会话的权限。没有会话授权时，查询和显式选模仅允许父 Agent 当前模型及其支持的推理强度。预设只声明工具能力，不复制 Host 设置服务或写入白名单，也不使用旧 `modelSelectionSettings`。

如果更新后参数或列表工具仍缺失，检查实际 profile 加载的插件与预设配置；用户保存的整份 `config.plugins` 可能覆盖新包。旧 `.agent-presets` 不会自动覆盖，修改目录副本也不保证声明式预设同步。此选模契约适用于 0.2.2+；0.2.1 及更早宿主仍按原有预设能力运行。

官方依据：[`dsh-v0.2.2-rc.1` standard 预设](https://github.com/deepseek-ai/deepseek-harness/blob/66491b05e3f05ad35bcdd4f6cd7ed26041d9e3db/packages/bundle/web-app/presets/standard.patch.yml)与 [tool-subagent 文档](https://github.com/deepseek-ai/deepseek-harness/blob/66491b05e3f05ad35bcdd4f6cd7ed26041d9e3db/packages/subagent/tool-subagent/README.md#selecting-a-child-llm)，2026-11-12 在线核对，`documented / official_document / device_status=not_required`。

回归入口 `scripts/smoke-harness-models.mjs` 随 `pnpm test:harness` 在隔离 Host 运行。Windows / Node24.21.0 / Harness0.2.2-rc.1 已验证实际工具参数与列表唯一性、Host 开关及白名单过滤／拒绝、非法推理强度拒绝、standard→本预设切换和关闭开关后的历史授权恢复（`observed / simulator / device_status=not_required`）。模型目录为合成适配器，未调用真实模型；不涵盖模型生成质量与 Desktop 界面操作。

## 资料与验证边界

启动前先检查工作区指引、本地知识目录，以及当前 AI 宿主的插件/MCP/Skill 配置和可见能力，寻找 `miliastra-toolbox` 系列或其他知识来源。确认当前能读到官方客户端 2D/Lua API 与使用指南，记录来源、版本和缺项；已有资料直接复用，仅询问仍缺少的内容。详见 [知识库发现与可用性核验](skills/qxqy-game-studio/references/workflow.md#知识库发现与可用性核验)。本工作流不捆绑官方知识库，不能从普通 Lua/UI 或 3D 节点经验猜接口。

步骤 7 同时负责交付后的协作：引导用户完成导入/挂载、核对真实索引并绑定脚本目录。AI 可按用户授权保存、预览并同步脚本，返回逐文件结果和备份位置；用户随后在千星沙箱保存试玩。手动修改也要同步回项目。详见 [真机交付步骤](skills/qxqy-game-studio/references/07-device-validation.md)及[实机脚本同步能力](../../studio/docs/script-sync.md)。

图片预览范围与缺失素材处理见 [素材说明](../../studio/docs/image-assets.md)，不把预览支持当真机资源已确认。行为评估见 [agent-behavior.md](evals/agent-behavior.md)；模拟器通过不等于真机通过。
