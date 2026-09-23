---
name: qxqy-game-studio
description: 制作、改造或打磨原神千星奇域 2D+Lua 小游戏的八阶段工作流：GDD、美术方向、玩法契约、HTML 最终效果演示、测试设计、模拟器 TDD、试玩迭代、品质扩展与真机验证。用于从想法到可在模拟器与真机运行的完整一局游戏体验；不用于千星 3D 节点图设计。
---

# 千星 2D+Lua 游戏工作室

目标是交付 **可在模拟器与真机运行** 的完整一局游戏体验。前期用 HTML 对齐「最终效果演示」，开发完成后再用模拟器试玩/截图做交付验证。

## 先分清三类问题

| 类型 | 例子 | 正确证据 |
|---|---|---|
| 玩家体验假设 | 是否有爽感、提示是否易懂、美术是否统一 | 前期 HTML 最终效果演示、用户反馈；交付期模拟器试玩/截图 |
| 确定性规则契约 | 碰撞、计分、状态、重开、暂停、服务端变量 | 先失败的自动化用例、最小实现、回归 |
| 平台未知 | 某 API、GIA 字段、真机差异 | 限时探针、工作区知识库、真机记录 |

不要用日志断言证明“好玩”，也不要用主观试玩代替规则回归。HTML 演示不是千星运行时；模拟器绿灯不是真机通过。

## 能力路由

工具以**当前会话实际可见的 schema** 为准。本预设不注册模拟器或生图；它们来自 Web profile 插件。加载阶段 Skill 后，按工具名调用，不要在本 Skill 里凭记忆编造参数。

| 任务 | 何时 | 使用 |
|---|---|---|
| HTML 最终效果演示 | 阶段 4，**先于模拟器** | 生成可打开的 `prototype/`；请用户打开试玩。本 composition 没有浏览器试玩工具 |
| 概念图 | 阶段 2 | 可见的 `image_generate` / `imagegen` |
| 千星客户端 Lua / 控件 / GIA | 写 Lua 前 | 工作区用户自备知识库与 `AGENTS.md`；不要用 miliastra 3D 节点库 |
| 编辑工程、导入存档 | 阶段 6 起 | `qxqy_studio_get` / `patch` / `load`；先加载 `qxqy-simulator` |
| **交付验证：模拟行为** | 开发完成后 | `qxqy_studio_play`：`start` / `pointer` / `key` / `click` / `step` / `get` / `runCase` |
| **交付验证：静态舞台截图** | 同上 | `qxqy_studio_ui_screenshot` |
| **交付验证：运行画面截图** | 同上 | 先 `play start`，再 `qxqy_studio_play_screenshot` |
| 参考图 → Lua 拼图 / 序列帧 | 玩法成立后 | 先查看工作区是否有像素画、图元拟合、UI 制作或帧动画相关的 Skill，按需使用 |

阶段 1–4 **不要**为了对齐玩法去开模拟器、改存档或 `runCase`。没有 `qxqy_studio_*` 时仍可做 HTML 演示、策划和测试设计，但交付验证必须标明未执行。不要用网页截图冒充模拟器/真机画面。不要用 `tool-web` 搜索冒充试玩。

2D API 以**当前工作区**为准。没有文档时暂停写依赖 API 的 Lua，请用户把知识库放进工作区。缺少官方证据时写 `unknown`。

## 平台不变量

- 资产分为服务端客户端控件容器、客户端模板、Lua 脚本；脚本只能挂客户端控件/模板。GIA 不保存挂载关系。
- 主屏需要启用的客户端控件容器；只有仅存为模板的客户端零级父节点可实例化。
- **原神/千星官方图元与题材全部可用。** 模拟器对非 `100001–100006` 的 `imageId` 画缺失框——看不见美术效果，不是资源被禁。
- 坐标：千星与模拟器画布**原点左下、Y 向上**；HTML 多为左上、Y 向下。禁止把网页像素抄进 Lua。
- **布局基准是手机 16:9（`mobile-16-9` / 1280×720）。** 整屏构图必须在该画布完整可见，不要按 PC 1600×900 铺满后再在手机上裁切。PC 仍可用 1600×900 设计像素：把舞台放进固定设计尺寸的板，再按各画布 `min(canvas/design)` 等比缩放（不足处留边）。缩放容器不要再加全屏不透明兄弟节点（试玩页同级先出现的子节点会盖住后面的舞台）。五画布都属于发布回归范围；P0 至少 `mobile-16-9` 与 `pc-16-9`。
- 新脚本的模拟器 `require` 使用 `default_import_file/` + 脚本映射名。
- 存档固定为 `workspace/<slug>/<slug>.save.json`，文件头附近含 `"format": "qxqy-simulator-save"`。
- **交付物**是可在模拟器加载试玩、并导出后在真机运行的游戏（Lua + 存档/GIA），不是 HTML 网页。

写 Lua 前读工作区知识库。操作模拟器前加载 `qxqy-simulator`。

## 八阶段主状态机

每个新游戏都按 [workflow.md](references/workflow.md) 管理当前阶段、进入条件、退出证据、回退和停止条件：

| 阶段 | 结果 | 主要证据 |
|---|---|---|
| 1 GDD | 共同锁定值得做的 P0 | GDD、砍项、Gate A |
| 2 ART DIRECTION | 锁定视觉语言与资产策略 | art-bible、方向预览、Gate B（无分歧可并入 A） |
| 3 LOGIC CONTRACT | 形成渲染器无关的玩法抽象 | 状态机、不变量 |
| 4 HTML 最终效果演示 | 用网页对齐「看起来/玩起来像什么」；**不接触模拟器** | 可打开 HTML、用户试玩、Gate C |
| 5 TEST DESIGN | 在生产 Lua 前建立验收网 | 追踪矩阵、P0 用例 |
| 6 LUA + SIMULATOR TDD | 在目标运行时实现可运行游戏 | Lua、存档、Red–Green–Regress |
| 7 交付验证与试玩 | 模拟器 play/screenshot + 用户反馈 | 对比证据、Gate D |
| 8 QUALITY EXPANSION | 扩测试、GIA、真机 | 五画布、预算、Gate E |

先做 `PREFLIGHT`。阶段 2/3 可在 Gate A 后并行，在阶段 4 汇合为 HTML 演示。HTML 是最终效果演示，不是 Lua 源码，禁止 DOM/CSS/JS → Lua。细节见 [prototype-art-playtest.md](references/prototype-art-playtest.md)。

## 用户闸门

只在决定会改变产品方向时暂停。没有真正分歧就不要为凑满 A–E 而提问。

- Gate A：锁定 GDD 的受众、幻想、核心循环、P0/P1/不做项与规则语义。
- Gate B：仅当有 2+ 个真正不同的视觉方向时；否则并入 A。
- Gate C：试玩 HTML 最终效果演示后，锁定循环、信息层级、节奏和允许降级项。
- Gate D：开发完成后，用模拟器试玩/截图确认集成体验。
- Gate E：是否把模拟器候选送入 GIA/真机，并返回真机结果。

文件位置、函数命名、测试断言、控件拆分自行处理。不要反复问“是否继续”。

## 按阶段加载 References

- 阶段 1/3/5/6：读取 [design-and-tests.md](references/design-and-tests.md)。
- 阶段 2/4/7/8：读取 [prototype-art-playtest.md](references/prototype-art-playtest.md)。
- 进入/退出证据、Gate、回退、目录：读取 [workflow.md](references/workflow.md)。

不要默认加载整个 references 目录。

## 证据账本

跨会话事实源是 `docs/production-plan.md`。超长任务才额外 `create_goal`。每次阶段切换更新 `records/playtest.md`：

- 本轮假设/契约与改动；
- 当前阶段与退出证据；
- HTML 演示反馈（阶段 4）或 `qxqy_studio_play` / `runCase` / 截图（阶段 6 起）；
- 红灯原因、绿灯结果；
- `unknown`、导出警告、目标 imageId、真机状态。

失败分成设计问题、实现缺陷、测试缺陷、模拟器限制（含看不见官方图）、平台未知。不要为了绿灯偷改需求语义。

## P0 交付候选（阶段 7）

交付物必须是 **可在模拟器运行、并可导出到真机运行的游戏**，不是 HTML。

- Gate A、C 已锁定；无美术分歧则 B 已并入。
- P0 玩法用例曾因缺少生产行为而红，现全部绿。
- `workspace/<slug>/<slug>.save.json` 可被模拟器加载；`main.lua` 挂在客户端控件上。
- 开局、首次成功、失败、一档手机：模拟器 `play_screenshot` / 必要的 `ui_screenshot`。
- README 写清操作、挂载、目标 imageId（模拟器可能看不见）、导出警告、真机状态。

阶段 8 由 Gate E 与真机结果决定能否称为发布候选。
