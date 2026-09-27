# 2. TDD 制定测试用例

## 输入与适用时机

读取策划案中的 `CONTRACT`、状态机、不变量和目标画布。新游戏在 HTML 展示与生产 Lua 之前制定用例；已有缺陷只补充相关回归用例。

## 执行动作

建立 `requirement → rule/invariant → 模拟器场景 → case → oracle → evidence` 追踪表。每条用例明确前置条件、玩家动作、可观察结果、画布与失败边界。

- 状态、胜负、计分、冷却、碰撞边界、暂停/重开、稳定输入语义、服务端变量/信号和已复现缺陷，进入 Red→Green→Regress。
- 手感、反馈节奏、UI 层级和尚未稳定的语义先通过原型和观察试玩判断，形成稳定规则后再固化。
- 未文档化 API、imageId、GIA 字段、生命周期和真机行为先查文档或探针，缺证据标 `UNKNOWN`。
- `HYPOTHESIS` 关联体验检查；`CONTRACT` 关联可观察断言；`UNKNOWN` 关联资料、探针或真机验证。视觉、手感和真机项目另列人工检查。

### 确定性与 oracle

- 运动、冷却和计时显式消费 `dt`；随机玩法由配置、变量、首事件或测试入口注入可复现 seed/序列；
- 每个用例独立启动，切画布是新生命周期；不依赖墙钟、机器速度或偶然帧；
- 稳定日志使用 `game_start`、`score <n>`、`fail <reason>`、`restart` 等领域事件；
- 优先断言玩家可见控件/状态，其次稳定事件，最后才是 `query.*` 诊断；测试不得复制生产算法；
- 覆盖顺序按高风险、高频、最近缺陷和复杂状态转换，而非虚假的百分比。

### 用例格式与 P0 覆盖

使用模拟器支持的 `qxqy-autotest` / `version: 1`，不要自创 schema。每个用例独立保存到 `workspace/<slug>/tests/`：

```json
{
  "format": "qxqy-autotest",
  "version": 1,
  "name": "boot",
  "dt": 0.03333333333333333,
  "events": [],
  "asserts": [
    { "kind": "log", "contains": "game_start", "source": "client" },
    { "kind": "tree", "name": "ScoreText", "exists": true }
  ]
}
```

最小 P0：`boot`、`first-success`、`first-fail`、`restart`、`mobile-smoke`。稳定控件优先用 `click`，只有坐标本身是规则时才用 `pointer`；`mobile-smoke` 使用独立 `args.canvasId`，不要与 PC 串联。布局与 HUD 以 `mobile-16-9` 为完整可见基准，PC 画布只做放大/留边，不裁掉手机上看得到的内容。缩放容器不要再加全屏不透明兄弟节点。

## 产物与完成条件

产物为追踪表与 `tests/*.json`。步骤 2 只做静态/schema 检查，不启动模拟器、不修改存档、不运行 `runCase`；此时只记录“用例已制定”。

有效 Red 要等步骤 5 的骨架可运行后，由目标生产行为缺失产生。坏 JSON、路径错误、事件到不了控件、模拟器未启动或工具故障都不算 Red。已有完整行为的工程不为制造 Red 而删除生产代码。

## 下一步与回退

新游戏进入 [3. HTML 效果展示](03-html-prototype.md)，用例留给 [5. Lua 编码实现](05-lua-implementation.md)执行。规则不清回 [1. 策划案](01-game-design.md)；规则变化先改契约与用例。
