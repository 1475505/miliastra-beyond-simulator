# 3. HTML 效果展示

## 输入与适用时机

读取策划案和步骤 2 已制定的用例。网页用于确认画面、操作与节奏；已有工程的窄修复可以跳过并记录理由。

## 执行动作

制作可打开试玩的 `prototype/`，覆盖开局、第一次成功、失败和重开：

```text
prototype/index.html
prototype/README.md    启动、操作、不可移植项、坐标差异
```

请用户体验目标是否易懂、成功/失败反馈和节奏。只按实际使用的工具记录试玩来源；没有浏览器操作工具时标 `browser-run: user`，不能声称 Agent 已亲自试玩。记录为 `runtime=html`。

将网页画面与动画分为 `must-reproduce`、`can-degrade`、`concept-only`，说明哪些效果需要在千星重新实现。网页新增或变更规则时回写策划案和用例。

HTML 通常原点左上、Y 向下；千星原点左下、Y 向上。不可直接复制 DOM/CSS 坐标，也不逐行翻译 JavaScript 为 Lua。此步骤不操作模拟器。

## 产物与完成条件

产物为可打开的 HTML 演示、启动操作说明，以及 `records/playtest.md` 中的体验反馈和不可移植项。用户已确认核心画面、操作与节奏；网页可玩只证明 HTML 演示的结果。

## 下一步与回退

进入 [4. 准备千星美术参考图和素材](04-art-assets.md)。体验暴露规则问题时回 [1. 策划案](01-game-design.md)和 [2. 测试用例](02-test-cases.md)，再调整演示。
