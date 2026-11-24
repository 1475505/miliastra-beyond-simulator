# 3. TDD 制定测试用例

本步骤回答：怎样算做对。

## 输入与适用时机

读取 HTML 确认后的 GDD（`CONTRACT`、状态机、不变量和目标画布）和 `records/playtest.md` 中的 HTML 反馈。新游戏在 HTML 确认之后、生产 Lua 之前制定用例；修复已有缺陷时只补相关的回归用例。

## 执行动作

1. 建追踪表：`requirement → rule/invariant → 模拟器场景 → case → oracle → evidence`。每条用例写明前置条件、玩家动作、可观察结果、画布和失败边界。
2. 按内容分流：

   | 内容 | 处理 |
   |---|---|
   | 状态、胜负、计分、冷却、碰撞边界、暂停/重开、稳定的输入语义、服务端变量/信号、已复现的缺陷 | 写成用例，进入 Red→Green→Regress |
   | HTML 已确认的反馈与节奏 | 能写成可观察结果的写成用例（如“点中后计数在同一帧 +1”）；不能的列为人工检查 |
   | 仍不稳定的手感和语义 | 留到步骤 6 观察试玩，稳定后再补用例 |
   | 文档未覆盖的 API、imageId、GIA 字段、生命周期、真机行为 | 查文档或做探针；没有证据时标 `UNKNOWN` |
   | 视觉和真机项 | 列为人工检查 |

   `HYPOTHESIS` 对应体验检查，`CONTRACT` 对应可观察断言，`UNKNOWN` 对应资料、探针或真机验证。
3. 按下方格式写用例 JSON，只做静态/schema 检查。

### 确定性与 oracle

- 运动、冷却和计时显式使用 `dt`；随机玩法通过配置、变量、首个事件或测试入口注入可复现的 seed 或序列。
- 每个用例独立启动，切换画布即开始新的生命周期；不依赖真实时钟、机器速度或偶然的帧时序。
- 日志使用稳定的领域事件：`game_start`、`score <n>`、`fail <reason>`、`restart`。
- 断言优先级：玩家可见的控件和状态 > 稳定事件 > `query.*` 诊断。测试不复制生产算法。
- 覆盖顺序按风险高低、使用频率、近期缺陷和状态转换的复杂度排列，不追求覆盖率数字。

### 用例格式与 P0 覆盖

使用模拟器支持的 `qxqy-autotest` / `version: 1`，不自创 schema。断言类型有 `log`（日志）、`control`（控件字段，如文字、字号、颜色、图片 ID、可见性、位置）、`var`（服务端变量）、`signal`（信号）、`tree`（控件是否存在）和 `lua`（Lua 查询脚本），按规则需要选用。每个用例单独一个文件，放在 `workspace/<slug>/tests/`：

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

- P0 至少包含 `boot`、`first-success`、`first-fail`、`restart`、`mobile-smoke`。
- 点击稳定控件用 `click`；只有坐标本身属于规则时才用 `pointer`。
- `mobile-smoke` 使用单独的 `args.canvasId`，不和 PC 用例串联。
- 布局与 HUD 以 `mobile-16-9` 完整可见为基准；PC 画布只等比放大或留边，不能裁掉手机上可见的内容。

## 产物与完成条件

- 追踪表和 `tests/*.json` 已就绪，并通过静态/schema 检查。
- 本步骤不启动模拟器、不改存档、不运行 `runCase`，状态只记为“用例已制定”；有效 Red 在 [步骤 5](05-lua-implementation.md) 判定。

## 下一步与回退

新游戏进入 [4. 准备千星美术参考图和素材](04-art-assets.md)，用例留到 [5. Lua 编码实现](05-lua-implementation.md)执行。规则不清时回 [1. 策划案](01-game-design.md)；规则变化时先改契约，再改用例。
