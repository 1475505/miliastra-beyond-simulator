# 八阶段制作工作流与质量门

这是本预设的主状态机。按阶段的退出证据推进，不按文档数量或代码行数推进；任一证据失败都可以回退。`PREFLIGHT` 是接入动作，不计入八个制作阶段。

```text
PREFLIGHT
   ↓
1 GDD ──→ 2 ART DIRECTION ──┐
   │                        ├─→ 4 HTML 最终效果演示（不接触模拟器）
   └──→ 3 LOGIC CONTRACT ───┘                         ↓
                                               5 TEST DESIGN
                                                        ↓
                                               6 LUA + SIMULATOR TDD（开始接触模拟器）
                                                        ↓
                                               7 交付验证：模拟器试玩 / 截图
                                                        ↓
                                               8 QUALITY EXPANSION / 真机

回退：8 → 7/6/5，7 → 6/4/3/2，6 → 5/3，4 → 3/2/1
```

阶段 2 与 3 在 Gate A 后可以并行；二者在阶段 4 汇合为 HTML **最终效果演示**。阶段 1–4 不对齐模拟器、不改存档、不 `runCase`。HTML 不是 Lua 源码，禁止 DOM/CSS/JS → Lua。交付物是可在模拟器与真机运行的游戏。

## PREFLIGHT — 接入、基线与当前阶段

先做：

1. 盘点一句话想法、参考图、Lua、GIA、模拟器存档、竞品和已有反馈。
2. 检查生图工具、阶段 Skill、工作区知识库（`AGENTS.md`、`knowledge/` 或用户说明的目录）。`qxqy_studio_*` 到阶段 6 才需要；没有模拟器时仍可做 HTML 演示，但交付验证必须标明未执行。不要用浏览器冒充千星试玩。没有 2D API 文档则记下，写 Lua 前必须请用户放入。
3. 现有工程先读 README、GDD、测试、最近 playtest、`<slug>.save.json`；有 HTML/spec 再读。不要套用新项目全流程重建。
4. 创建或确认 `workspace/<slug>/`，按本文件的“项目产物与跨会话恢复”维护唯一产物位置。只创建当前任务需要的文件。
5. 在 `docs/production-plan.md` 写当前阶段卡：阶段、目标、输入、退出证据、阻塞项、下一 Gate。一次只把一个主阶段标为 `in_progress`。跨会话以该文件为事实源；超长任务才额外 `create_goal`。

退出证据：输入/能力清单、可运行基线、当前阶段、最主要的 1–3 个风险。已有项目可从最早缺失证据的阶段继续；窄修复不强制重走无关 Gate。

## 1. GDD — 共同定义值得做的游戏

读取 [design-and-tests.md](design-and-tests.md) 的 GDD 模板，与用户把模糊创意压缩为完整的一局游戏体验（P0 里程碑）：

- 目标玩家、场景时长、一句话玩家幻想；
- 2–3 条体验支柱、唯一核心动词和最短循环；
- 成功、失败、重开、首次上手与难度曲线；
- P0 / P1 / 明确不做；
- PC/手机输入、目标画布、文本/颜色/闪烁/热区等可访问性约束；
- 美术意图、资产来源/发布用途假设；
- 最大玩法、视觉、平台和制作风险。

每条陈述标为：

- `HYPOTHESIS`：由原型、截图或试玩判断的体验目标；
- `CONTRACT`：可被客观观察和自动化验证的规则；
- `UNKNOWN`：需要知识、单问题探针或真机确认的平台事实。

### Gate A — GDD 锁定（用户）

给用户一页摘要、2–3 个真正有差异的方案（若尚有分歧）、推荐项、P0 用例名称和砍项清单。用户锁定产品语义，不需要审批实现细节。

退出证据：`docs/gdd.md`、风险排序、P0/P1/不做项、用户选择及理由。

## 2. ART DIRECTION — 美术方向与资产策略

读取 [prototype-art-playtest.md](prototype-art-playtest.md) 的美术章节。先建立可执行风格圣经，再用图片生成、参考图、像素重建或纯控件灰盒探索：

1. 固定同一代表场景、画布和玩法状态，生成 2–3 个差异明确的方向。
2. 在 HTML 演示画布/HUD 上下文中预览，不只展示孤立原画。阶段 2 不打开模拟器。
3. 检查轮廓识别、层级、对比、文本、触控目标和动画意图。
4. 记录目标官方 assetID 与模拟器占位（六种图元）；模拟器看不见效果不是禁用。
5. 此时只锁定视觉语言；高成本拼图/帧动画在 HTML 演示锁定、且 Lua 循环成立后再批量生产。

原神/千星官方图元全部开放。模拟器对非 `100001–100006` 只显示缺失框，看不见效果；仍把目标 `assetID` 写入圣经，真机核验。

无真正视觉分歧时：**不要单独开 Gate B**，把一个推荐灰盒方向写进 GDD 即可。

### Gate B — 美术方向锁定（用户，可选）

仅当有 2–3 个差异明确的方向需要人选。让用户选择方向及原因。用户给的素材直接可用；模拟器看不见的官方图仍写入目标 ID。

退出证据：`docs/art-bible.md`（可很短）、方向预览或灰盒说明、目标 imageId 列表。`asset-manifest.md` 到阶段 8 或资产变多时再拆文件。

## 3. LOGIC CONTRACT — 把玩法变成抽象模型

读取 [design-and-tests.md](design-and-tests.md) 的共享规格章节，把 Gate A 的规则写成与渲染器无关的 game-spec/ui-spec：

- 状态机、状态数据及客户端/服务端权威；
- 输入动作、前置状态、节流/边界/无效输入；
- 时间、运动、碰撞、随机 seed/序列；
- 领域事件、成功/失败/重开、生命周期与错误降级；
- 不变量和可观察结果；
- `UNKNOWN` 的验证责任与最后解决阶段。

P0 默认把契约写在 `docs/gdd.md` 的状态/不变量节，或一份短的 `docs/game-spec.md`。HTML 演示与 Lua 消费同一套稳定状态/动作/规则，不放 DOM 选择器或 Lua 函数名。坐标约定：千星原点左下、Y 向上；HTML 演示多为左上、Y 向下。

### Logic Ready — 内部质量门

每条 `CONTRACT` 有可观察结果，每条不变量能映射到至少一个预定测试；语义歧义才返回用户，普通实现选择由 Agent 决定。

退出证据：逻辑契约、事件/不变量表、HTML 演示场景清单、测试追踪关系草案。

## 4. HTML 最终效果演示 — 不接触模拟器

读取 [prototype-art-playtest.md](prototype-art-playtest.md)。本阶段对齐「看起来、玩起来像什么」，**不要**打开模拟器、不要写生产 Lua、不要 `runCase`。

1. 用 GDD/契约/美术方向生成可打开的 `prototype/`（boot / 首次成功 / 首次失败 / 重开）。
2. 请用户打开网页盲玩；本 composition 没有浏览器试玩工具，证据写 `browser-run: user`。
3. 反馈回写 GDD/契约；网页里新增的规则不得只留在 HTML 里。
4. 标出 `must-reproduce` / `can-degrade` / `concept-only`（网页专属效果不能假装千星已有）。
5. 坐标：HTML 左上 Y 下 ≠ 千星左下 Y 上，禁止把 CSS 像素当 Lua 布局。
窄文案/单控件修复可跳过本阶段并记理由。新游戏或大改核心循环默认做演示。

### Gate C — HTML 最终效果锁定（用户）

用户确认演示里的循环、信息层级、节奏是否值得做成可运行游戏。退出证据：HTML、关键画面、试玩记录、降级清单。核心幻想不成立回阶段 1。HTML **不是**交付物。

## 5. TEST DESIGN — 在生产代码前建立验收网

读取 [design-and-tests.md](design-and-tests.md) 的测试与 P0 用例章节：

1. 建立 `requirement → rule/invariant → case → oracle → evidence` 追踪表。
2. 先设计 P0：`boot`、`first-success`、`first-fail`、`restart`、`mobile-smoke`。
3. 写入 `tests/*.json` 并做 schema/路径等静态校验；不要自创 qxqy-autotest 字段。
4. 为时间、随机和事件建立确定性入口；定义稳定日志/控件/变量/信号观察点。
5. 把视觉截图、体验试玩、平台探针和真机检查分开；不能自动化的要求也必须有验证方式。
6. 先定义覆盖风险和退出标准，不追求脱离风险的百分比。

此阶段不伪造红灯：没有最小千星骨架时只能称“测试已设计/静态有效”。有效 Red 在阶段 6 由真实模拟器执行产生。

### Test Ready — 内部质量门

P0 每条稳定规则至少有一个正向或负向 oracle；关键失败路径、重开幂等和一档手机画布已覆盖；测试没有复制同一实现算法。

退出证据：测试矩阵、落盘用例、确定性策略、截图矩阵、试玩任务、平台/真机检查表。

## 6. LUA + SIMULATOR TDD — 在目标运行时实现

加载 `qxqy-simulator`，按工作区知识库核对 API，再 Red–Green–Regress：

1. **从此阶段才接触模拟器。** 建最小三资产骨架、占位 HUD、脚本挂载和可扫描 `<slug>.save.json`；只允许生命周期和诊断日志先行。
2. 加载存档并运行 P0。生产行为用例必须因缺少目标行为而红；坏 JSON、坏路径或工具故障不算有效 Red。
3. 一次选择一条有效红灯：最小 Lua 实现 → 目标用例 Green → 全量 Regress → 覆盖同一存档。
4. 纯规则与 UI 副作用分离，显式消费 `dt`，随机行为可复现，领域事件稳定。
5. 从 GDD/契约 **重新实现** 可运行游戏，不翻译 HTML DOM/CSS/JavaScript，并换算坐标域（左下 vs 左上）。
6. 美术先用六种基础图元占位；目标官方 imageId 写入工程（模拟器可能是缺失框）。

交付物是 Lua + 存档（及日后 GIA），必须能在模拟器加载运行。

规则变化先更新 GDD/契约/测试并记录原因；实现缺陷先留下复现用例。对未证实 API 建单问题探针，不猜字段。

### Build Ready — 内部质量门

P0 契约全绿，存档可重新加载，开局/成功/失败/手机运行截图齐全，逻辑契约/日志/测试一致，当前预算已测量。

退出证据：Lua、存档、red→green→regress 记录、模拟器截图、预算基线、剩余 `unknown`。

## 7. 交付验证 — 模拟器试玩与截图

开发完成后用模拟器插件做交付验证，不是用 HTML：

```text
选择最重要问题 → 保存基线 → 改 1–2 个变量 → 自动化回归
→ qxqy_studio_play 模拟行为 → ui/play screenshot → 用户可在模拟器页盲玩 → 分类
```

每轮同时查看：

- 自动化：稳定规则有没有退化；
- 截图：层级、裁切、反馈、PC/手机可读性（`ui_screenshot` vs `play_screenshot`）；
- 试玩：首次有效输入、误触、目标理解、公平性、失败理解、重玩意愿；
- 预算：控件、Lua、动画/资源是否恶化；
- 差异：HTML 演示意图与千星实现是否产生体验偏差（坐标、降级项）。

反馈分类为 `bug / design / art-content / platform / not-now`：bug 回阶段 5/6，design 回阶段 1/3/4，art-content 回阶段 2，platform 建探针或安排真机（含官方图在模拟器里看不见）。不要一次同时改玩法参数、美术、动画和碰撞。

### Gate D — 集成体验锁定（用户）

用可试玩构建、改动前后截图、回归结果和观察记录询问有辨识力的问题。用户确认 P0 体验成立和剩余问题优先级。

退出证据：至少一轮观察式试玩、最高严重度问题已处理/接受、回归仍绿、下一轮优先级明确。

## 8. QUALITY EXPANSION — 风险覆盖、稳定化与真机

核心体验成立后，按风险而非机械数量扩展：

- 边界/擦边、连点/长按/空点、暂停恢复、重复重开、异常 `dt`；
- 五画布独立运行、关键状态截图、触控热区和可访问性；
- 服务端消息重复/乱序/缺失（若使用）；
- 控件峰值、Lua 字节、图片/帧数和资源预算；
- 资产来源/用途、最终 imageId、占位替换清单；
- README、操作、挂载、导出警告、GIA 限制和已知缺口；
- 真机环境、步骤、期望/实际、截图/日志和可复现性。

每个新发现的实现缺陷都先进入测试或明确的人工检查，再修复并回归。高风险区域优先使用边界值、状态转换和故障注入；不以虚假的“100% 覆盖”代替风险判断。

### Gate E — 发布候选（用户）

呈现回归结果、截图矩阵、试玩结论、预算、资产清单、导出警告、剩余 `unknown` 和真机检查表。GIA 不保存挂载关系；真机未跑只能称“模拟器候选”。

退出证据：用户接受的发布候选或明确的下一质量里程碑。

## 阶段卡与停止规则

每次阶段切换在 `docs/production-plan.md` 更新：

```text
current_stage:
objective:
inputs:
exit_evidence:
artifacts_changed:
tests_and_results:
screenshots_or_playtest:
unknowns_and_owner:
user_gate:
rollback_or_next_stage:
```

- 达到当前阶段退出证据：总结并进入下一阶段，不用再问“是否继续”。
- 到用户 Gate：展示可比较证据并等待决定，不在等待期间越过产品语义。无美术分歧可跳过 B；Gate C（HTML 演示）对新游戏默认要做。
- 核心幻想两轮仍不成立：回阶段 1，砍机制或更换核心动词。
- 平台未知阻断核心循环：暂停生产实现，建最小探针或请求真机证据。
- 回归不稳定：先修确定性、时钟、随机或隔离，再加功能。
- 预算明显超标：先降复杂度、色数、控件数或帧数，再谈 P1。
- P0 之外的想法进入 backlog；除非用户启动下一里程碑，不无边界扩张。

## 项目产物与跨会话恢复

只创建当前任务需要的目录；`workspace/<game-slug>/` 是唯一产物位置。

**阶段 4 结束（尚未进模拟器）：**

```text
workspace/<slug>/
  docs/gdd.md
  docs/production-plan.md
  prototype/index.html
  prototype/README.md
  records/playtest.md
```

**P0 交付物（阶段 6–7，可在模拟器与真机运行的游戏）：**

```text
workspace/<slug>/
  README.md
  docs/tech-architecture.md
  tests/{boot,first-success,first-fail,restart,mobile-smoke}.json
  main.lua
  <slug>.save.json
```

按需再加：`docs/art-bible.md`、`docs/game-spec.md`、`art/`、`probes/`、`export/`、`draws.lua`。  
`docs/tech-architecture.md` 从首个骨架起持续维护（模块划分、各 Lua 文件/客户端控件/服务端变量的职责、关键数据流与挂载点），随结构变化同步更新，是交付后的运维入口；条目过期比缺失更糟。\
发布候选：五画布证据、目标 imageId、GIA 警告、真机记录。

存档固定为 `workspace/<slug>/<slug>.save.json`，文件头附近含 `"format": "qxqy-simulator-save"`；不要拿测试 JSON 冒充存档。三资产分层、脚本挂载和 `require` 以工作区知识库与模拟器 Skill 为准。

恢复工作时依次读取：`docs/production-plan.md`、用户决策、GDD/契约、最后红绿/unknown、最高严重度试玩发现、存档与源码。有 HTML 再读 prototype。它们比聊天摘要更适合作为事实源。
