# 千星 2D+Lua 游戏制作 Agent 预设

预设 ID：`wonderland-lua-builder`；显示名：**千星 2D+Lua 游戏制作**。它引导 Agent 用千星沙箱模拟器制作客户端 UI + Lua 游戏，并把最终真机验证留给实际游戏环境。

## 七步制作游戏

1. **策划案**：明确玩法、操作、计分、胜负与首版范围。
2. **TDD 制定测试用例**：先写开局、成功、失败、重开和边界情况的操作与预期结果。
3. **HTML 效果展示**：做可打开试玩的效果演示，确认画面、操作与节奏。
4. **准备千星美术参考图和素材**：根据确认的效果准备参考图、目标图片 ID、图元和 UI 还原方案。
5. **Lua 编码实现**：核对 2D API，在模拟器中搭建控件、脚本和完整存档；执行测试驱动的 Red→Green→Regress。
6. **测试**：运行用例，模拟器试玩与截图，检查移动端/PC 布局并修复问题。
7. **真机试玩验证与 bug 修复**：导出资产供用户在千星奇域试玩，依据真机回传复现、修复和回归。

`PREFLIGHT` 是读取已有工程与能力的接入动作，不计入七步。步骤 1–4 不操作模拟器；HTML 是体验展示，不是 Lua 或真机证据。已有工程从需要补齐的步骤继续，窄修复不重走无关流程。细节见 [Skill](skills/qxqy-game-studio/SKILL.md)及[工作流](skills/qxqy-game-studio/references/workflow.md)。

## 使用与分发

DSH 0.1.7-rc.1 起，本仓库根包 `dsh-plugin-beyond-simulator` 在构建时读取这里的 `preset.yml` 和 `agent.cordis.yml`，生成 `dsh-plugin/cordis.patch.yml` 中的 Agent 预设注册项。旧版复制入口同时保留，启动时仅在 `$DSH_HOME/.agent-presets/wonderland-lua-builder` 不存在时复制包内预设，不覆盖用户修改。通过仓库根目录的 `dsh plugin --profile web add github:1475505/miliastra-beyond-simulator` 安装插件后，在 DSH 的 **设置 → Agent 预设** 中查找本预设；新任务可选择它，已有任务不会自动切换。

写 Lua 之前，Agent 工作区需要用户提供的千星 2D API 文档与 `AGENTS.md`；本预设不捆绑官方知识库。模拟器只预览 `100001–100006` 六种基础图元，其他官方图片 ID 在模拟器中显示缺失框，需在真机确认。行为评估见 [agent-behavior.md](evals/agent-behavior.md)。
