# 5. Lua 编码实现

## 输入与适用时机

读取策划案、`tests/*.json`、美术清单与 UI 还原方案；已有工程同时读取存档、源码和最近结果。从本步骤开始操作模拟器。

写依赖编辑器 API 的 Lua 前，复用 [PREFLIGHT 已核验的知识来源](workflow.md#知识库发现与可用性核验)，定向核对当前所需的官方 2D/Lua 文档，遵守 `AGENTS.md`。新增 API 的资料缺失时先检查已配置来源，仅请用户补齐仍缺少的内容；不从普通 Lua/UI 框架或 3D 节点图经验猜接口。未知语义先查文档或做单问题探针。

## 执行动作

### 接入模拟器与搭建骨架

使用当前宿主的模拟器工具说明和实际 schema。有 `qxqy-simulator` 操作 Skill 时按需加载；MCP 不自动附带该 Skill，可读取仓库中的 MCP 指南和共享操作说明。

- MCP 先用 `qxqy_project_open` 获取工程 `handle`，工程操作带该句柄；不要照搬 Harness 示例而遗漏参数。
- 写操作使用最新 `expectedRevision`；修改后显式保存。内存修改和试玩不会自动写盘。
- 三类资产为服务端 UI 容器、客户端 UI 模板、Lua 脚本。脚本仅挂客户端控件/模板；模板脚本随实例化运行。
- 保存为 `workspace/<slug>/<slug>.save.json`，文件头附近含 `"format": "qxqy-simulator-save"`；记录脚本挂载点。按需导出 GIA，GIA 不保存脚本挂载关系。
- 如果 `scripts[].source` 非空，试玩优先使用内联源码；否则读 `path`。修改外部 Lua 时同步实际使用的源码，避免存档仍运行旧版本。

### Red→Green→Regress

1. 建立可加载的最小控件和 Lua 骨架，先排除 JSON、路径、挂载、事件路由和工具故障。
2. 运行步骤 2 的用例，确认目标生产行为缺失导致有效 Red。新游戏的 `first-success`、`first-fail`、`restart` 至少各有一次有效 Red。
3. 一次实现一条规则，执行目标 Green 与相关 Regress；已有规则缺陷先补最小失败用例。纯文案等窄改动按风险检查，不人为破坏已有行为制造 Red。
4. 记录证据：

```text
case / red reason / failedAt / frame
minimal change / target result / full regression
screenshot or snapshot / remaining risk
```

纯规则与 UI 副作用分离；计时显式使用 `dt`，随机 seed/序列可复现。根据策划契约实现玩法，不逐行翻译 HTML DOM/CSS/JavaScript。测试设计细节需要时读 [步骤 2](02-test-cases.md)。

### 布局、素材与维护

接入步骤 4 的素材；缺失框记录真实目标 ID。千星原点左下、Y 向上，布局使用父矩形、锚点和偏移，以手机 16:9 完整可见为基准，PC 等比放大/留边。缩放容器不要再加全屏不透明兄弟节点。

建议文本框开启 `adaptiveFontSize = true`，按可读性设置最小字号；`fontSize` 与 `minimumFontSize` 仍须为整数。固定字号按设计使用，检查手机、PC 与真机文字是否完整可读。

维护 `docs/tech-architecture.md`：Lua 文件、控件/容器、服务端变量/信号的职责，关键数据流和脚本挂载点。结构变化同步更新，供后续维护使用。

## 产物与完成条件

产物为可加载的 Lua、完整存档、挂载与架构说明，以及 Red→Green→Regress 记录。P0 已形成完整一局，已实现规则的目标用例通过；模拟器未知能力、素材占位与待验证项有记录。

## 下一步与回退

进入 [6. 测试](06-simulator-testing.md)。规则变化回 [步骤 1](01-game-design.md)和 [步骤 2](02-test-cases.md)，素材问题回 [步骤 4](04-art-assets.md)。GIA 导入造成索引变化时读 [步骤 7 的索引校准](07-device-validation.md#导入后的索引校准)。
