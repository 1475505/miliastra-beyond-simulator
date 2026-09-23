# 七步制作工作流

这是 Agent 预设的主流程，顺序与仓库根 README 一致：

```text
PREFLIGHT（检查已有工程，不计入步骤）
  → 1 策划案
  → 2 TDD 制定测试用例
  → 3 HTML 效果展示
  → 4 准备千星美术参考图和素材
  → 5 Lua 编码实现
  → 6 测试
  → 7 真机试玩验证与 bug 修复
```

按退出证据推进，可因新发现回退。已有工程从最早缺失证据继续；窄修复不强迫重做前面的步骤。步骤 1–4 不启动模拟器、不改存档、不运行 `runCase`。HTML 是体验展示，不是 Lua 源码或交付物。

## PREFLIGHT — 接入与基线

先盘点用户想法、参考图、已有 Lua、GIA、存档和反馈。检查当前工作区 `AGENTS.md`、2D API 文档、可用工具与相关 Skill。已有项目先读策划案、测试、最近试玩记录、存档与源码；只创建当前步骤需要的文件。在 `docs/production-plan.md` 记当前步骤、目标、退出证据、阻塞项。缺官方 API 文档时可以推进步骤 1–4，但写依赖编辑器 API 的 Lua 前须请用户补齐。

## 1. 策划案

将创意写为 `docs/gdd.md`：目标玩家与单局时长、唯一核心动词、最短循环、成功/失败/重开、PC 与手机输入、P0/P1/不做项、美术意图和关键风险。区分可由用户试玩判断的 `HYPOTHESIS`、可测试的规则 `CONTRACT`、需官方文档或真机验证的 `UNKNOWN`。把状态机、输入动作和不变量写在 GDD，复杂时另开短的 `docs/game-spec.md`；不要提前引入 DOM 选择器或 Lua 函数名。

有真正玩法分歧时给用户可比较的选项和推荐。退出证据是明确的一局游戏体验、范围与规则语义。执行方法见 [design-and-tests.md](design-and-tests.md)。

## 2. TDD 制定测试用例

在生产 Lua 之前，根据步骤 1 的每条关键 `CONTRACT` 写 `requirement → rule/invariant → case → oracle → evidence` 追踪表。先覆盖 `boot`、`first-success`、`first-fail`、`restart`、`mobile-smoke`，每条写玩家动作、前置条件、可观察结果、画布与失败边界。用模拟器支持的 `qxqy-autotest` schema 落盘 `tests/*.json`，只做静态/schema 检查，不在此步运行模拟器。

随机和计时给出确定性入口；视觉、手感、未知 API 与真机项目另列人工检查。此时只称“用例已制定”。有效 Red 要等步骤 5 的最小存档和脚本骨架可运行后产生；坏路径、坏 JSON、工具故障不算 Red。规则变化先改策划案与用例。详见 [design-and-tests.md](design-and-tests.md)。

## 3. HTML 效果展示

根据已定义的规则制作可打开试玩的 `prototype/`，覆盖开局、第一次成功、失败与重开。请用户体验画面、操作和节奏；没有浏览器操作工具时标 `browser-run: user`，不声称 Agent 已亲自试玩。将网页特有的动画/效果标为 `must-reproduce`、`can-degrade` 或 `concept-only`。网页新增规则必须回写策划案与用例。

用户确认体验后再准备正式素材。HTML 通常原点左上、Y 向下；千星原点左下、Y 向上，禁止直接复制 CSS 像素。窄修复可跳过此步并记理由。详见 [prototype-art-playtest.md](prototype-art-playtest.md)。

## 4. 准备千星美术参考图和素材

以确认的 HTML 体验为依据，在 `docs/art-bible.md` 记录配色、轮廓、UI 层级、角色/道具识别特征、目标官方 `imageId`、素材来源与用途。准备参考图和素材清单，说明在千星控件中怎样还原；有真实视觉分歧时只做少量可比较方向请用户选择。使用工作区实际可见的像素画、图元拟合、UI 或帧动画 Skill。

模拟器对非 `100001–100006` 官方素材显示缺失框，这不等于素材不能在千星使用。记下目标 ID，留待真机核验。高成本拼图/动画可先准备方案和关键样本，批量制作随步骤 5 的实现需要推进。详见 [prototype-art-playtest.md](prototype-art-playtest.md)。

## 5. Lua 编码实现

从此步开始使用模拟器。核对工作区官方 2D API，建立服务端 UI、客户端控件/模板和 Lua 脚本的最小骨架，保存为 `workspace/<slug>/<slug>.save.json`。先运行步骤 2 的用例，确认目标生产行为缺失导致有效 Red；随后一次实现一条规则，执行目标 Green 与相关 Regress。将纯规则与 UI 副作用分离，计时显式使用 `dt`，随机行为可复现。

根据策划案重新实现玩法，不逐行翻译 HTML DOM/CSS/JavaScript。接入步骤 4 的目标素材；模拟器缺失框要记录真实目标 ID。交付物是可加载的 Lua 与存档，按需导出 GIA；记录脚本挂载点。未知 API 先查文档或做单问题探针，不猜字段。

## 6. 测试

运行 P0 与高风险边界用例，复现并修复实现缺陷。使用 `qxqy_studio_play` 走开局、首次成功、失败、重开，用 `qxqy_studio_ui_screenshot` 和 `qxqy_studio_play_screenshot` 检查静态/运行画面。手机 16:9 整屏可见，PC 等比放大/留边；必要时扩展五画布、触控、重复输入、暂停恢复、服务端信号与性能预算。

让用户在模拟器页观察试玩手感，分清规则失败、视觉问题和体验假设；一次调整少量变量，随后回归。模拟器结果标 `runtime=simulator`，不能写作真机通过。保留用例结果、截图、已知限制与导出警告。详见 [prototype-art-playtest.md](prototype-art-playtest.md)。

## 7. 真机试玩验证与 bug 修复

整理 Lua、完整存档/GIA、挂载说明、目标素材 ID、测试结果和已知限制，提供真机操作步骤。请用户在千星奇域实际试玩并回传画面、日志、步骤和期望/实际结果。Agent 不在真机上执行过的步骤必须标未验证。

对每个真机缺陷建立最小复现，判断是 Lua、素材、布局、模拟器差异还是平台未知；先更新用例或人工检查，再修复并重复模拟器与真机验证。只有真机证据覆盖目标行为，才能标记该行为通过；尚未回传则交付状态为“模拟器候选”。

## 产物与跨会话恢复

`workspace/<slug>/` 是项目产物位置。按需创建 `docs/gdd.md`、`docs/production-plan.md`、`tests/`、`prototype/`、`docs/art-bible.md`、`main.lua`、`<slug>.save.json`、`records/playtest.md`、`export/`。存档头部附近含 `"format": "qxqy-simulator-save"`，测试 JSON 不是存档。`docs/production-plan.md` 记录当前步骤和退出证据；`records/playtest.md` 按 `runtime=html|simulator|device` 记来源、结果、未知和修复后回归。恢复时先读这些实际产物，不凭聊天摘要重做项目。
