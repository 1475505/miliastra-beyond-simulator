# 设计、共享规格与测试

本 reference 用于阶段 1（GDD）、阶段 3（玩法抽象）和阶段 5/6（测试设计与生产 TDD）。只读取当前阶段需要的章节。它把原先的 GDD、逻辑契约、测试策略和 P0 用例合并到同一条追踪链：

```text
GDD requirement → HYPOTHESIS / CONTRACT / UNKNOWN
                → 短契约 / 需要时的 game-spec
                → HTML 最终效果演示（阶段 4，不碰模拟器）
                → qxqy case + 模拟器 play/screenshot（阶段 6–7）
```

## 1. GDD：把创意压缩为 P0

复制到 `workspace/<game>/docs/gdd.md`。未知项写 `TBD`/`UNKNOWN`，每条陈述标为 `HYPOTHESIS`、`CONTRACT` 或 `UNKNOWN`。

```markdown
# <游戏名> GDD

- slug / 当前里程碑：P0 完整一局游戏体验
- 当前阶段：1 GDD
- Gate A：draft / locked；用户确认摘要：
- 更新日期 / 本轮砍项及理由：

## 玩家与幻想
- 目标玩家、熟练度、典型场景、单局时长：
- 一句话幻想：玩家在 ______，通过 ______，获得 ______ 的感觉。
- 题材、角色/物件与边界：

## 体验支柱
| HYPOTHESIS | 玩家可感知表现 | 反例 | 验证方式 |
|---|---|---|---|
| | | | HTML 演示（前期）/ 模拟器试玩（交付） |

## P0 核心循环
- 唯一核心动词 / 键鼠与触屏输入：
- 开局看到什么 / 第一次有效操作：
- 成功、失败、反馈、重开和最短上手路径：
- 目标：`目标 → 操作 → 即时反馈 → 局势变化 → 成功/失败 → 重开`

## 范围
| 优先级 | 包含 | 成功标准 |
|---|---|---|
| P0 | | |
| P1 | | |
| P2 / 不做 | | |

## 体验与约束
- 可访问性：颜色之外的反馈、文字/语言、闪烁、音频依赖：
- PC/手机画布、触控热区、单手/双手假设：
- 美术意图、素材用途（参考/原型/发布候选）与权利假设：

## HTML 最终效果演示（阶段 4，不碰模拟器）
- 必须可玩的场景：boot / first-success / first-fail / restart
- `must-reproduce` / `can-degrade` / `concept-only`：
- 坐标：千星左下 Y 上；HTML 左上 Y 下；禁止从网页抄像素

## P0 用例与试玩
| 用例 | 关联 CONTRACT | 玩家动作 | 期望结果 | 画布 |
|---|---|---|---|---|
| boot | | | HUD/`game_start` | mobile-16-9 |
| first-success | | | | mobile-16-9 |
| first-fail | | | | mobile-16-9 |
| restart | | | | mobile-16-9 |
| mobile-smoke | | 最短成功路径 | 整屏可见+不崩溃+关键状态 | mobile-16-9 |

| HYPOTHESIS | 任务（不泄题） | Gate C（HTML 演示） | Gate D（模拟器交付） |
|---|---|---|---|
| | 请直接开始玩 | | |

## 风险与未知
| 风险/UNKNOWN | 影响 | 当前证据 | 验证方式/负责人 | 最晚阶段 |
|---|---|---|---|---|
| API / GIA / 资产 / 真机 | | | knowledge/probe/device | |
```

Gate A 只锁产品语义、P0、砍项和关键规则歧义；函数名、控件拆分和目录由 Agent 自行决定。

## 2. 共享 game-spec / ui-spec

P0 把契约写在 GDD 或短的 `docs/game-spec.md`。仅当选择 HTML 轨且两边共同消费时，才加 `prototype/game-spec.json`。不得写 DOM 选择器、CSS 类、JS/Lua 函数名。布局字段使用千星坐标：原点左下，Y 向上，锚点 0–1。

### game-spec 必须回答

- 状态机：`boot → ready → playing → resolved(win|fail) → restart`，暂停若为 P0 也要建模；
- 状态数据、生命周期、客户端/服务端权威；
- 输入动作、前置状态、节流、热区、无效输入与结束后行为；
- 显式 `dt`、位置/速度/碰撞边界、可注入 seed/序列；
- 成功/失败/重开、领域事件、稳定日志和错误降级；
- 每条不变量（INV）及对应的可观察 oracle；
- 未知平台事实、责任人、探针或真机验证。

### ui-spec 必须回答

| 字段 | 含义 |
|---|---|
| `id` / `kind` | 稳定控件名与 `container/image/text/button/progress` 等目标类型 |
| `parent` / `anchor` / `offset` / `size` | 控件树与跨画布布局 |
| `styleToken` / `assetId` | 色板、字号、间距与资产清单引用 |
| `visibleWhen` / `action` | 可见状态与抽象玩家动作 |
| `motionIntent` | 触发、时长、曲线和可降级方式 |

HTML（若存在）与 Lua 可以有不同适配层；稳定的状态、动作、控件和资产 id 必须可追踪。网页坐标不得进入 Lua。

## 3. 测试设计与追踪

在阶段 5 建立 `requirement → rule/invariant → 模拟器场景 → qxqy case → oracle → evidence` 表。`HYPOTHESIS` 指向 play/screenshot/用户试玩，`CONTRACT` 指向自动化 oracle，`UNKNOWN` 指向知识、探针或真机。

### 五层证据

| 层 | 验证 | 证据 |
|---|---|---|
| L0 | JSON、路径、挂载、控件树 | 静态检查、`qxqy_studio_get` |
| L1 | 纯状态、计分、碰撞、生成、边界 | 纯函数/窄接口回放 |
| L2 | 输入→状态/日志/控件/变量/信号 | `qxqy-autotest` + `runCase` |
| L3 | 布局、层级、裁切、反馈、动画 | `qxqy_studio_ui_screenshot` / `qxqy_studio_play_screenshot` |
| L4 | 易懂、公平、节奏、触控、真机 | 观察式试玩、用户反馈、真机 |

可选 HTML 只能提前沟通体验；不能替代 L2–L4。模拟器看不见的官方图不算视觉回归失败，记目标 ID，真机看效果。

### TDD 边界

必须 Red→Green→Regress：状态、胜负、计分、冷却、碰撞边界、暂停/重开、稳定输入语义、服务端变量/信号和已复现缺陷。

先原型后固化：跳跃/速度手感、反馈节奏、UI 层级和尚未确定的玩法语义。

先探针后规格：未文档化 API、imageId、GIA 字段、生命周期和真机行为。

有效 Red 必须是“目标生产行为缺失”。坏 JSON、路径错误、事件到不了控件、模拟器未启动和 schema 错误是基础设施失败，不算 TDD Red。

### 确定性与 oracle

- 运动、冷却和计时显式消费 `dt`；随机玩法由配置、变量、首事件或测试入口注入可复现 seed/序列；
- 每个用例独立启动，切画布是新生命周期；不依赖墙钟、机器速度或偶然帧；
- 稳定日志使用 `game_start`、`score <n>`、`fail <reason>`、`restart` 等领域事件；
- 优先断言玩家可见控件/状态，其次稳定事件，最后才是 `query.*` 诊断；测试不得复制生产算法；
- 覆盖顺序按高风险、高频、最近缺陷和复杂状态转换，而非虚假的百分比。

## 4. P0 qxqy-autotest

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

阶段 5 完成用例和静态/schema 校验；阶段 6 运行最小存档后，`first-success`、`first-fail`、`restart` 至少一次因生产行为缺失而 Red。每次实现记录：

```text
case / red reason / failedAt / frame
minimal change / target result / full regression
screenshot or snapshot / remaining risk
```

P0 后按玩法增加 `edge-contact`、`input-spam`、`pause-resume`、`restart-twice`、`large-dt` 和其余四画布 smoke。体验反馈只有形成稳定规则后才转自动化测试。
