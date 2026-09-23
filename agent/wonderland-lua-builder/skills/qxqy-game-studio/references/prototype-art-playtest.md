# 美术、HTML 最终效果演示与交付试玩

本 reference 用于阶段 2（美术）、阶段 4（HTML 最终效果演示）、阶段 7/8（模拟器交付验证）。前期 **不接触模拟器**。每个证据标明 `runtime=html|simulator|device`。

## 1. 美术方向（Gate B 可选）

生成图是设计沟通工具。运行时仍是千星控件 + imageId。

### 风格圣经

在 `docs/art-bible.md`（可很短）写：2–3 个体验形容词及反例；主/辅/警示色；轮廓与 UI 层级；角色/道具识别特征；**目标官方 `assetID` 列表**；模拟器交付时用 `100001–100006` 占位。

“原神风”要写成地区/元素意象、轮廓、配色，而不是一句空话。

**原神/千星官方素材全部开放。** 模拟器对非六种基础图元画缺失框——看不见美术效果，不是禁用。

### 方向探索

无真正分歧时跳过 Gate B。若有分歧：固定同一代表场景，只做 2–3 个方向；放进 **HTML 演示 HUD** 比较，不只看孤立原画。阶段 2 不打开模拟器。

高成本像素重建/帧动画等到 HTML 演示锁定、Lua 循环成立后再批量做。

## 2. 阶段 4：HTML 最终效果演示（不接触模拟器）

对齐「看起来、玩起来像什么」。不是 Lua 源码，也不能证明千星 API。网页新增规则必须回写 GDD/契约。

### 坐标域（强制）

| | HTML 演示 | 千星 / 模拟器 |
|---|---|---|
| 原点 | 通常左上 | **左下** |
| Y | 向下为正 | **向上为正** |
| 单位 | CSS 像素 | 当前画布逻辑像素 |

禁止把网页坐标抄进 `SetAnchoredPosition` 或 `pointer`。

### 最小产物

```text
prototype/index.html
prototype/README.md    启动、操作、不可移植项、坐标差异
```

覆盖 boot / first-success / first-fail / restart。标 `must-reproduce` / `can-degrade` / `concept-only`。

本 composition **没有**浏览器试玩工具。请用户打开网页；证据写 `browser-run: user`。Agent 不得声称已亲自点过网页，除非会话里真有对应工具。

窄修复可跳过并记理由。新游戏默认做演示。

### Gate C

用户确认演示是否值得做成可运行游戏。HTML **不是**交付物。

## 3. 阶段 7：模拟器交付验证

加载 `qxqy-simulator`。不要用网页截图冒充千星画面。

| 目的 | 工具 |
|---|---|
| 模拟点击/按键/时间/断言 | `qxqy_studio_play` |
| 静态布局 | `qxqy_studio_ui_screenshot` |
| Runtime 画面 | 先 `play start`，再 `qxqy_studio_play_screenshot` |

坐标：画布原点**左下**，Y 向上。切 `canvasId` = 新生命周期。布局基准是 `mobile-16-9`（1280×720）：P0 截图与 HUD 必须在该画布完整可见；PC 1600×900 用同一块设计板等比放大，不要按 PC 铺满后再在手机上裁切。缩放容器不要再加全屏不透明兄弟节点。

### 观察式试玩（Gate D）

1. 本轮只验证 1–2 个问题。
2. 先跑 P0 回归；已知红灯必须说明。
3. Agent 用 play 走最短成功/失败/重开并截图；可请用户在模拟器页盲玩。

反馈：`bug` 回 5/6；`design` 回 GDD/契约/HTML 演示；`art-content` 回美术；`platform` 探针或真机。一次改 1–2 个变量。

Gate D：玩家能开始并复述目标，契约回归仍绿，模拟器截图齐全。交付物是可加载的存档 + Lua。

## 4. 运行时资产与质量扩展

每次换占位为官方 ID：先保存截图和预算，跑回归；模拟器仍可能是缺失框，写 `visual: simulator-missing-box, targetId: …`。阶段 8 扩五画布、GIA、真机。
