# 5. Lua 编码实现

本步骤回答：游戏能否在模拟器里按契约跑起来。

## 输入与适用时机

读取游戏卡片、GDD、`tests/*.json`、art-bible 和 UI 还原规格；已有工程再读存档、源码和最近的测试结果。从本步骤开始操作模拟器。

写依赖编辑器 API 的 Lua 前，用 [PREFLIGHT 已核验的来源](workflow.md#知识库发现与可用性核验)定向核对本次要用的官方 2D/Lua 文档。新 API 缺资料时，先查已配置的来源，再只向用户询问缺项。语义不明时查文档，或做只验证一个问题的探针。

## 执行动作

### 接入模拟器与搭建骨架

按当前宿主的工具说明和实际 schema 操作。有 `qxqy-simulator` 操作 Skill 时按需加载；MCP 不自带该 Skill，可读仓库中的 MCP 指南和共享操作说明。

- **句柄**：MCP 先用 `qxqy_project_open` 取得 `handle`，之后的工程操作都带上它；不要照搬缺少该参数的 Harness 示例。
- **写入与保存**：写操作使用最新的 `expectedRevision`，改完显式保存。内存中的修改和试玩都不会自动写盘。
- **资产结构**：存档有三类资产，即服务端 UI 容器、客户端 UI 模板和 Lua 脚本。脚本只能挂在客户端控件或模板上；模板脚本随实例化运行。
- **控件来源**：只预定义少量基础模板，控件用 `game.InstantiateClientUIControl` 等当前 API 在 Lua 中实例化，再由 Lua 设置布局、文本、图片和可见性。不在编辑器里预搭完整控件树，原因有二：GIA 格式尚未完全掌握，UI 侧（存档/模板）的复杂控件树或属性可能在导出或真机导入时不兼容；而且之后只改脚本时，同步 Lua 即可，不必重新导入 GIA。确需在 UI 侧定义的字段，记为待真机核验项。
- **存档**：保存为 `workspace/<slug>/<slug>.save.json`（开头附近有 `"format": "qxqy-simulator-save"`），并记录脚本挂载点。按需导出 GIA；GIA 不保存脚本挂载关系。
- **源码优先级**：`scripts[].source` 非空时，试玩使用内联源码，否则读取 `path`。改了外部 Lua 后，同步存档实际运行的源码，避免仍在运行旧版本。

### Red→Green→Regress

1. 搭建可加载的最小控件和 Lua 骨架，先排除 JSON、路径、挂载、事件路由、模拟器未启动和工具故障；这些都不算 Red。
2. 运行步骤 3 的用例，确认失败原因是目标生产行为缺失，即有效 Red。新游戏的 `first-success`、`first-fail`、`restart` 各至少有一次有效 Red。
3. 一次实现一条规则：目标用例转为 Green，再回归相关用例。修复已有规则的缺陷时，先补最小的失败用例。纯文案等窄改动按风险选择检查；不为制造 Red 而删改已有的生产行为。
4. 记录证据：

```text
case / red reason / failedAt / frame
minimal change / target result / full regression
screenshot or snapshot / remaining risk
```

实现要求：纯规则与 UI 副作用分离；计时显式使用 `dt`，随机 seed 或序列可复现；按 GDD 契约实现玩法，不逐行翻译 HTML 的 DOM/CSS/JavaScript。测试设计细节见 [步骤 3](03-test-cases.md)。

### 布局、素材与维护

- **素材**：接入步骤 4 的图片、动效和音效；仍显示缺失框的图片记录真实的目标 ID。
- **布局**：用父矩形、锚点和偏移表达；以手机 16:9 完整可见为基准，PC 等比放大或留边。缩放容器不要再加全屏不透明的兄弟节点。
- **文字**：文本框建议开启 `adaptiveFontSize = true`，并按可读性设置最小字号；`fontSize` 和 `minimumFontSize` 须为整数。使用固定字号时，检查文字在手机、PC 和真机上完整可读。
- **风格常量**：界面文字集中在一张文案表中，内容取自卡片的世界词表和金样；颜色、字号和动效时长同样集中为常量，与卡片和 art-bible 的 token 对应。卡片没有覆盖的新文案，按卡片的叙述者、语气和长度预算编写，不套用通用说法。
- **架构说明**：维护 `docs/tech-architecture.md`，写明 Lua 文件、控件/容器、服务端变量/信号各自的职责，以及关键数据流和脚本挂载点；结构变化时同步更新。

## 产物与完成条件

- 可加载的 Lua、完整存档、挂载与架构说明，以及 Red→Green→Regress 记录。
- P0 能完整玩一局，已实现规则的目标用例全部通过。
- 模拟器未知能力、素材占位和待验证项已记录。

## 下一步与回退

进入 [6. 测试](06-simulator-testing.md)。规则变化时回 [步骤 1](01-game-design.md)和 [步骤 3](03-test-cases.md)；素材问题回 [步骤 4](04-art-assets.md)；GIA 导入造成索引变化时，读 [步骤 7 的索引校准](07-device-validation.md#导入后的索引校准)。
