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

来源：[官方客户端 API](https://kcnote9o8u33.feishu.cn/wiki/QF4qw7SEUig3q6kY0M3cUYYUnsh) 的 `KeyboardKeyCode` / `KeyEventType`，采用历史本地rev223表（加工稿Git blob `a60c6404d5cbf3b45a3b71f5e740c92c427fbd9e`），`documented / official_document`。完整工作区当前官方来源查 `knowledge/guide/official-sources.md`；这里的rev223不表示在线最新版本。

与 [PR #12 的作者回传](https://github.com/1475505/miliastra-beyond-simulator/pull/12#issuecomment-6220495342) 存在已知差异：回传的奇匠33–35为右方括号、反斜杠、逗号，本地文档表为逗号、句点、斜杠。按用户要求采用文档表，不将第三方回传升级为独立真机验证。

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

证据范围为 Windows / Node22.23.2 / Edge headless + SwiftShader，`observed / simulator / not_required`。

## 指针请求乱序（2026-10-24）

结论：并发Pointer请求可让DOM的 down→up 在Worker中变为 up→down，按名点击或直接串行API通过不能排除此类浏览器传输缺陷。共享 `play/browser-session.js` 将Pointer/Key、节流Move、滚轮和Cancel统一排队，以generation丢弃旧会话请求；不改变Lua点击逻辑、层级或拖动阈值。

回归入口为 `test/browser-session.test.mjs` 与上述浏览器用例，覆盖延迟Down、微移、取消、重启和真实输入链。原始时序证据见完整工作区 `probes/browser-pointer-order-20261024/{input-before,input-fixed-user}.json`，项目对照见 `workspace/woo/records/simulator/finale-eyes-input-20261024/verification/`。Windows / Node22.23.2 / Edge，`observed / simulator / not_required`；更早缺DOM坐标的点击不能归为相同原因或判为用户点错，本结论不扩大为真机事件时序。
