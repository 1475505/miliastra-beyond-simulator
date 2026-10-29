# 浏览器键位响应

上级：[Studio](../README.md#专题树)。

Web 预览、Web 编辑器试玩及 DSH 共用试玩页提供「键位响应：开／关」。默认开启，当前页面内重开试玩保留开关，刷新页面恢复默认；开关不保存进工程、不修改 Lua 监听器。

开启时，把官方键鼠默认绑定转为 `Enum.KeyEventType` 对应的 Down / Up。关闭时停止这层转发，普通光标点击、拖拽、滚轮仍有效；MCP 的显式 `key` 输入不受浏览器开关影响。

## 默认绑定与依据

| 绑定 | 默认物理键 |
|---|---|
| 奇匠 1–10 | 1–9、0 |
| 奇匠 11–22 | U Z Y G H I O P J K L V |
| 奇匠 23–28 | F5–F10 |
| 奇匠 29–35 | 反引号、减号、等号、左方括号、逗号、句点、斜杠 |
| 奇匠 36–43 | 上、下、左、右、右 Ctrl、右 Shift、Backspace、CapsLock |
| 移动／行走切换 | W、S、A、D／左 Ctrl |
| 冲刺／跳跃／落下 | 鼠标右键／Space／X |
| 快捷轮盘／交互／普通攻击 | Tab／F／鼠标左键 |
| 角色技能 1–4 | E、Q、R、T |

来源：[官方客户端 API](https://kcnote9o8u33.feishu.cn/wiki/QF4qw7SEUig3q6kY0M3cUYYUnsh) 的 `KeyboardKeyCode` / `KeyEventType`。本轮使用完整知识工作区 `knowledge/guide/Lua客户端UI脚本API.md` 的本地加工稿（Git blob SHA-1 `a60c6404d5cbf3b45a3b71f5e740c92c427fbd9e`），并回查原始 `feishu-import/lua-client-ui-api/latest/02-all-sheets.json`、revision 223。未在线刷新飞书原表；`evidence_source=documented`、运行端 `official_document`（本地快照）。

与 [PR #12 的作者回传](https://github.com/1475505/miliastra-beyond-simulator/pull/12#issuecomment-6220495342) 存在已知差异：回传的奇匠 33–35 为右方括号、反斜杠、逗号，当前官方快照为逗号、句点、斜杠。按用户要求采用文档表；不把第三方回传升级为本轮真机验证，不混用两套映射。

## 浏览器策略

- 共 58 个键鼠绑定、116 个 Down/Up 名称；不把键盘按键冒充手柄输入。
- 字母按实际输入的 ASCII 字母解释，兼容 Colemak/Dvorak；未支持的字母（如 C/B/N）不会回落成另一个物理键。数字、标点、左右修饰键按 `KeyboardEvent.code` 区分。组合输入期间不转发。
- 仅试玩输入页面接收；输入框、文本域、下拉框、可编辑内容及工具栏控件保留浏览器交互，日志页不驱动游戏。Web 预览需要先聚焦画布。
- 按住产生一次 Down，释放使用按下时记录的绑定；浏览器自动重复不生成额外 Down。关闭开关、失焦、页面隐藏、切换玩家和解绑时释放已按键，避免 Lua 留在按住状态。重建/停止 Worker 时丢弃旧输入。
- Pointer 与 Key 请求共用顺序队列，防止快速 Down/Up、补发 Move、Cancel 的 HTTP 请求乱序。物理鼠标左右键同时映射攻击/冲刺；触屏合成的鼠标事件不映射。只有开启响应时才在画布上屏蔽右键菜单。
- 只对已接收的键阻止浏览器默认操作；操作系统或浏览器保留、未投递到页面的快捷键无法由模拟器接管。

以上是模拟器宿主策略（`device_status=not_required`），不是新增官方输入时序契约。

## 实现与验证

- `play/key-bindings.js`：默认映射；`play/browser-session.js`：开关、按键状态与生命周期。
- `studio/test/browser-session.test.mjs`：文档表全部键位与枚举覆盖、真实 Lua 回调、开关、输入焦点、释放、鼠标组合及指针独立性。
- `web/test/key-input-browser.test.mjs`：真实浏览器分别走 Web 预览和 DSH/Web 共用试玩页，验证键位、F5 防刷新、开关和日志输入；内嵌试玩生命周期复用已有 `embedded-play-browser.test.mjs`。

源码更新后重建 Web/DSH 并重启宿主，刷新已打开页面。模拟器测试不证明上述默认表与任意真机版本或用户改键一致。

2026-10-18 Windows / Node22.23.2 / Edge headless + SwiftShader的键位及内嵌试玩回归通过，含1280px工具栏可见性；`observed / simulator / not_required`。

## 指针请求乱序（2026-10-24）

WOO「播放花神诞祭」实际浏览器点击中，DOM 先发 pointerdown、后发 pointerup，位置都在可见命中区内；Worker history 却记录同一时刻 `up → down`，未产生 settle。旧浏览器代码对指针使用并发 `void act`，仅 Key 排队；`flushMove` 只保证调用顺序，无法保证 HTTP 到达顺序。直接串行调用 pointer API 或模拟点击曾成功，因此这类测试不能排除真实浏览器输入故障。本次复现没有层级遮挡证据。

修复在共享 `play/browser-session.js`：Pointer/Key 统一排队；按下前和松开前的节流 Move、滚轮和 Cancel 都保持事件顺序；替换会话时通过 generation 丢弃旧队列。Lua 点击逻辑、按钮层级和拖动阈值沿用。更新 Web/DSH 构建后需刷新试玩页，让新模块生效。

独立回归依据是实际DOM/HTTP/Worker时序及按下→松开的点击语义。`test/browser-session.test.mjs`覆盖延迟Down、微移、取消和重启队列；旧版两例失败，修复后与真实Edge键位、鼠标拖动、滚轮、触摸回归均通过。

原始记录：完整工作区 `probes/browser-pointer-order-20261024/input-before.json`（含用户历史、DOM isTrusted、请求时间、Worker history），`input-fixed-user.json`为同一内置浏览器刷新后的可信点击，down/up有序且一次触发播放。WOO专项验收位于 `workspace/woo/records/simulator/finale-eyes-input-20261024/verification/`：真实Edge在实际canvas上走通30关、庆生及两次重播31项检查，包含延迟Down160ms、微移、长按和拖出取消。Windows / Node.js 22.23.2，`evidence_source=observed`、运行端`simulator`、`device_status=not_required`（仅此模拟器传输缺陷）。用户更早两次点击落在其他位置，缺当时DOM坐标，不能归为同一个已证实原因，也不能据此认定用户点错；本条不增加真机事件顺序结论。
