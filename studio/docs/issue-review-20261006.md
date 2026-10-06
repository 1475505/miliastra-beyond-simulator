# GitHub issue 核验 · 2026-10-06

范围：[1475505/miliastra-beyond-simulator](https://github.com/1475505/miliastra-beyond-simulator) 的未关闭 #4–#7，同时核对已关闭 #2/#3 的后续回传。初次核验代码基线为 `864f5fd` 加当时工作区已有改动；MCP 包版本 0.3.3。初次核验使用自包含合成存档，通过真实 MCP stdio → Controller → Worker → Lua 链路执行，未使用报告者未上传的游戏存档。

**当前状态：初次候选修改按用户要求撤回后，用户进一步确认并授权修复 #5 的计时问题。现实现 MCP 默认手动时钟、可选实时模式，Web/DSH 保持默认实时；详见下节。这是用户确认的工具设计，不宣称官方/真机要求。#4 的点击参数校验仍未修改，#7 仅保留与数组顺序无关的 GetChildren 控件操作测试。**

## #5 后续授权修复（2026-10-07）

- 实测旧行为：10 秒倒计时启动后 `step(2)` 得到 time=2；等待3秒再截图已是 time=5。先 pause 再 step(2)，等待后仍为 time=2。截图自身不调用 step，问题是调用间自动计时。
- 经用户明确同意，MCP 创建 Controller 时默认 `manual`，Worker 在此模式下不自动推进。`start {clockMode:"realtime"}` 可恢复实时运行；共享 Controller/Web/DSH 的默认模式仍为 realtime。
- `pause/resume` 不改变模式；暂停时仍允许显式 step。`device` 默认继承本局模式，新的 start 未传模式时恢复该宿主默认值。非法模式在销毁旧 Worker 前拒绝。
- 运行快照及截图回执返回 `clockMode`；截图的异步素材准备也不会让 manual Worker 偷跑。Lua 生命周期、Tween 算法与绘制逻辑未因时钟模式改变。
- 依据：用户确认的模拟器产品要求 + 本地复现，`evidence_source=observed`、运行端 `simulator`；不作为千星真机时钟结论。
- 回归：`mcp/test/protocol.test.mjs` 用真实 stdio 检查等待/截图/step、暂停恢复、实时选项、设备切换及参数失败后会话保留；`studio/test/host-clock.test.mjs` 检查异步截图等待。修改前新增 MCP 计时测试两项失败。
- #5.3 仍未复现：同一 handle 上的 stop/load/start，内联 source v1/v2 与磁盘 Lua v1/v2 均执行新标记；保留回归，没有添加未经证实的缓存修复。
- 验证：Windows / Node 22.23.2，冻结锁文件安装与根 `pnpm test` 通过（304 通过、7 跳过、0 失败）；MCP 本地构建通过。相同10秒倒计时经真实 MCP stdio 复测：step(2)→等3秒→截图仍 time=2/frame=1；再等2秒→step(0.2) 为 time=2.2/frame=2，Lua 显示剩余7.80秒。随后按用户要求纳入 MCP 0.3.5 单包 npm 发布；Web/DSH 不升版，不创建 GitHub Release。

## 证据口径

- **官方文档本地快照**：完整知识工作区 `knowledge/guide/feishu-import/lua-client-ui-api/latest/02-all-sheets.json`，revision 223，SHA-256 `1184b1cfed1c5ae5bde3b1b04bb441c45de0fe3037a844de4d3b054944b069e9`。本轮没有在线刷新飞书原文。加工稿 `knowledge/guide/Lua客户端UI脚本API.md`，SHA-256 `4a43f93f2b322be8336ff33d9cb07b3bc3a8d4c8a931a45d18f90e4e64941bab`。
  - `ClientUIBaseControl`：GetChildren 返回控件数组，SetAsLastSibling 置顶；原表 `04wPa0`，L7635–7677。
  - `ClientUICursorEventAreaControl` / `ClientUIPresetButtonControl`：raycastTarget 为可被光标射线检测，AddCursorEventListener 接收 CursorEventData；加工稿 L907–952。`ClientUIContainerControl.showCursor` 明确为 CursorEvent 正常使用前提，L1073。以上为 `evidence_source=documented`、运行端 `official_document` 的本地快照依据。
- **官方教程的第三方抓取副本**：知识库返回抓取时间 2026-09-25，原地址为[光标检测区域控件](https://act.mihoyo.com/ys/ugc/tutorial/detail/mhd4fxr5v6la)、[容器节点控件](https://act.mihoyo.com/ys/ugc/tutorial/detail/mh3qqq9xc102)。用于交叉核对，不冒称本轮已刷新官方页面。
- **既有真机证据**：完整工作区 `probes/sibling-order-20260928/device-20260928.md` 中 A/B 的 Down/Up/Click 与 raycast 开关聊天回传（原始文件待补）；`probes/key-render-20261001/` 的按键/点击回调写入。仅证明各记录的观察范围，不能证明本轮 MCP 或所有重叠命中情况。
- **初次核验的模拟器观察**：`evidence_source=observed`、运行端 `simulator`。MCP 时钟、输入参数校验和数据查询属于模拟器工具行为，不能作为官方/真机依据；不以 `device_status=not_required` 替代用户的证据要求。真机 `GetChildren()` 数组顺序仍 `unknown/pending`。

## 逐项结论

| Issue | 判定 | 依据与处理 |
|---|---|---|
| [#4](https://github.com/1475505/miliastra-beyond-simulator/issues/4) 光标事件永远不派发 | **核心指控未复现；参数错误静默成功属实** | 动态创建光标区，`pointer down/up` 和按名 `click` 均触发 Lua；raycast=false / showCursor=false 阻止点击，恢复后再次生效。漏传 `click.name` 会被 `String(undefined)` 写入历史，恰好复现 issue 的 `"undefined"`。新增名称/类型校验属于工具设计，无官方或真机依据，现已撤回。原工程 pointer 失败原因仍缺其存档和调用参数，不能仅凭初次模拟器测试定因。 |
| [#5](https://github.com/1475505/miliastra-beyond-simulator/issues/5) 3.1 截图时刻前移 / 3.2 调用间时间流逝 | **已复现，并经用户授权修复** | 截图只 get，不直接 step；旧 Worker 的 timer 持续推进。初次候选方案撤回后，用户确认采用 MCP 默认 manual、可选 realtime 的工具设计，见上节。 |
| #5 3.3 stop → load → start 执行旧脚本 | **未复现** | 每次 start 终止旧 Worker，重新取工程和脚本。内联 source v1/v2、磁盘 Lua v1/v2 均执行新标记。非空 source 优先于 path 是既有契约；仅改磁盘文件或只刷新另一进程可表现为旧内容，但未证实这就是报告者原因。 |
| [#6](https://github.com/1475505/miliastra-beyond-simulator/issues/6) 4.1 get 缺运行树 | **能力已存在，参数说明不足** | `args:{inspect:true}` 即返回 tree，初次核验验证了动态控件、文本、射线标记与固定几何。原默认 tree=[] 为轻量观察策略；本轮补充的工具参数说明随回滚撤回。 |
| #6 4.2 GIA/GIL 导入 | **部分属实，应拆分** | Studio/Web/DSH 已支持 GIA UI 和脚本资产子集；MCP 打开工具确实只接完整 JSON。GIL 整关卡导入未实现，属于新增格式支持，现有客户端 API/探针不足以推导完整协议。本轮未改格式实现。 |
| [#7](https://github.com/1475505/miliastra-beyond-simulator/issues/7) GetChildren 对象方法无效 | **给出的最小复现不支持此结论** | 返回数组元素桥接到实际 Control；经列表引用改显隐、单次置顶有效。逆序遍历并逐个 Last 最终还原原顺序，见下节。 |
| #7 GetChildren 新建在前，应改创建序 | **现象属实，尚无官方/真机依据判定为缺陷** | 官方只声明返回直接子控件数组，未约定数组顺序。当前前到后返回为[模拟器策略](../../client/lua-runtime/docs/observed-contract.md#默认动态实例层序2026-09-28)，不能凭直觉改成创建序。 |

已关闭项：#2 的 npm bin 软链入口确有 `realpathSync` 修复；#3 的提报者已于 2026-10-03 回传确认 Right 枚举及动态层序在 MCP 0.3.3 / Web 0.3.5 正常。动态默认置顶的真机证据等级仍以现有契约为准，不能将提报者的模拟器复核升级为新真机探针结果。

## #7 循环为何不反转

官方 rev223 声明 `GetChildren(): ClientUIBaseControl[]`、`SetAsLastSibling(): boolean`，后者置顶；未声明列表返回次序。模拟器列表为最上层在前，创建 A→B→C 得到 `[C,B,A]`。对这份数组逆序调用 Last：

```text
A 置顶 → [A,C,B]
B 置顶 → [B,A,C]
C 置顶 → [C,B,A]
```

每次调用都成功且立即改变树，最终相同不等于方法 no-op。数组是一次性引用列表，控件不是只读快照。若按已知目标排序，优先保留控件引用并显式 `SetSiblingIndex`，不要把未知的真机 GetChildren 数组顺序当作排序依据。

## 初次回滚范围与保留项（历史）

- 撤回 `studio/host/worker.js`、`studio/host/controller.js`、`mcp/index.js` 中本轮新增的时钟模式、模式回执、默认模式和暂停/恢复计时残量处理。
- 撤回 `studio/play/session.js` 中本轮新增的点击名称/目标校验。
- 撤回本轮新增的 MCP 测试、工具描述、README 操作说明和避坑索引中的“已修复”记录。
- 保留本文的来源核验与历史模拟器观察，明确标注证据等级和撤回状态。
- `client/lua-runtime/test/children-reference.test.mjs` 仅检查官方 API 支持的直接子控件、显隐操作和显式 First/Last 索引语义；按名称识别控件，不再固定数组顺序、动态默认层序或数组快照语义。Runtime 实现未修改。

保留测试执行：

```sh
node --test client/lua-runtime/test/children-reference.test.mjs mcp/test/protocol.test.mjs
```

上述测试不证明未提供的原游戏已修复，也不新增真机行为结论。初次回滚时没有保留运行行为修复；后续 #5 授权修复见本文开头。

### 回滚后验证

- `studio/host/worker.js`、`mcp/test/protocol.test.mjs` 与初次核验前一致；Controller、MCP 入口和 session 的剩余差异属于工作区其他图片/音频改动。
- 保留的 GetChildren 测试与原有 MCP 协议测试：3/3 通过。
- MCP、Web、DSH 本地产物已按回滚后的源码重建。
- 根 `pnpm test`：Runtime 58、Server 11、Studio 171、DSH 30、MCP 12、Web 18 项通过，Web 7 项跳过，合计 300 通过、7 跳过、0 失败。
- `git diff --check` 通过。该次回滚验证时尚未提交、推送、发布或重启常驻服务。

### 初次候选方案执行结果（回滚前历史，不代表当前代码）

环境：Windows x64、Node.js 22.23.2、pnpm 10.15.0。

| 检查 | 结果 |
|---|---|
| `pnpm install --frozen-lockfile` | 通过 |
| 当时的定向测试 | 8/8 通过；修复前 5 通过、3 失败（计时漂移、缺失名称静默成功、时钟选项缺失）；配套 MCP 新增测试已撤回 |
| `pnpm --filter beyond-simulator-mcp test` | 17/17 通过，含独立 MCP/Web 进程联动 |
| DSH `node --test test/*.test.mjs` | 30/30 通过，含默认实时 Worker 和 GIA 导入 |
| Web `node --test test/*.test.mjs` | 17 通过、6 跳过、0 失败；跳过项含本平台软链和需额外环境的浏览器/Electron 测试 |
| `node scripts/build.mjs mcp` | 构建通过 |
| `git diff --check`（模拟器仓库） | 通过 |
| 根 `pnpm test` | **未全绿**：Runtime 58/58、Server 11/11；Studio 145 通过、26 失败，随后停止。DSH/MCP/Web 已按上表单独运行。 |

当时全仓阻断定位：工作区音频功能改动在 `playSnapshot` 中新增 `audio.sessionId = session.audioSessionId`；部分既有合成 session 未提供该字段，统一报 `undefined at $.audio.sessionId`。失败集中于 image-fill（5）、scroll（9）、sibling-order（9）、text-alignment（3）。这是初次运行的历史结果；音频改动不属于本次回滚范围，不据此判断其后续状态。
