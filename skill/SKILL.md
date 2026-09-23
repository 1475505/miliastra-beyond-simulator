# 千星沙箱 UI 模拟器 · 插件使用技能

面向已安装 `dsh-plugin-beyond-simulator` 的 DeepSeek Harness 会话中的 AI。前提：用户已装好插件，`qxqy_studio_get` / `qxqy_studio_patch` / `qxqy_studio_play` / `qxqy_studio_play_screenshot` / `qxqy_studio_ui_screenshot` / `qxqy_studio_load` 当前可见；无需指导安装。

每个会话拥有独立内存存档，固定三类资产：`UI控件-服务端`（客户端控件容器）、`UI控件-客户端`（可被 Lua 实例化的模板）、`Lua 脚本`。编辑器在 Harness"模拟器"标签，分为“UI 编辑 / Lua 脚本 / 服务端逻辑”；试玩在独立标签页 `/qxqy-simulator/play#<会话ID>`。

两条核心工作流：**UI → JSON 转换与 GIA 往返**、**AI 驱动的交互测试**。

## 工作流一：把 UI 转成 JSON，并引导用户导入 GIA 尝试

目标：把某个 UI（用户手里的 GIA 文件、口头描述或截图）变成模拟器的 Authoring JSON，可继续编辑、试玩，再导出 GIA 送回真实链路验证。

### 1. 确认来源并入手

| 用户手里有什么 | 做法 |
|---|---|
| 真机导出的 `.gia` 文件 | 引导用户在"模拟器"标签顶栏点"导入"选择该文件；导入后调 `qxqy_studio_get` 读取转换出的 Authoring JSON 树 |
| 口头描述 / 截图 | 用 `qxqy_studio_patch` 从零构建：`newAsset` 重置工程 → `add` 逐个加控件 → `set` 改字段（每步后 `get` 验证） |
| 已有 Authoring JSON / 完整存档包 | 工作区里的 `qxqy-simulator-save` 用 `qxqy_studio_load` 拉取；也可让用户在顶栏选「工作区存档」，或「导入」本地文件 |
| 只有 Lua 脚本 | 引导用户"导入" `.lua`，只更新当前脚本，不影响其他资产 |

### 2. 构建与校验

- 每次写操作带最新 `expectedRevision`；收到 `revision conflict: expected N, current M` 时重新 `get`，基于新快照重算编辑，不要盲目重试。
- 未知字段不编造：检视器只暴露业务字段；`set` 不认识的 key 会报错，GIA 未验证语义以警告呈现。

### 3. 试玩验证

```
qxqy_studio_play { "action": "start", "args": {} }
qxqy_studio_play { "action": "get" }          ← 日志 / 时间 / 历史；默认不含运行树
qxqy_studio_play { "action": "get", "args": { "inspect": true } }  ← 按需拉完整运行树
qxqy_studio_play { "action": "pointer", "args": { "type": "click", "x": 800, "y": 450 } }
qxqy_studio_play_screenshot {}                    ← Host 按试玩页同一套 scene 树渲染当前试玩帧 PNG，无需打开试玩页
qxqy_studio_play { "action": "stop", "args": {} }
```

截图必须按目标选择，不能互相替代；二者都由 Host 在进程内出图，**不需要用户切换页签**：

- 要检查静态 UI 布局、选中项或控件图元，调用 `qxqy_studio_ui_screenshot`。它根据编辑器 `boxes` 渲染舞台 PNG，不含完整 Chrome DOM 工具栏/检视器。
- 要检查 Lua Runtime 的实际画面、动画或输入后的结果，调用 `qxqy_studio_play_screenshot`。它与独立试玩页共用同一份 Runtime `tree-v1` 场景树（同级先出现的子节点在上），再在 Host 里画成 PNG；返回 `canvasId`、Runtime `frame/time`、逻辑画布大小与实际 PNG 像素大小。不会步进时间，也不替代 `get {inspect:true}` 的结构化断言。需要先 `start` 试玩会话。用户说试玩页空/全挡时，以这张截图为准，不要另走扁平 `paint` 列表来否定用户画面。

多设备试玩（`GetUICanvasSize` 与预设像素同一套，PC KEYBOARD：1600×900、2100×900；手机 TOUCHSCREEN：1280×720、1560×720、1280×960）：

```
qxqy_studio_play { "action": "start",  "args": { "canvasId": "mobile-16-9" } }  ← 指定设备启动
qxqy_studio_play { "action": "device", "args": { "canvasId": "pc-21-9" } }      ← 试玩中切换设备（重建运行时，新生命周期）
```

- 切换设备后 `GetUICanvasSize`、指针坐标、锚点布局都换到新预设像素；快照带 `canvasId`/`platform`/`device`/`canvasPresets` 可直接断言。
- 切设备 = 换了台真机：时间归零、历史重置，用例不跨设备；要回归多画布就用 `runCase` 加 `args.canvasId` 分别跑。
- 不带 `canvasId` 的 `start` 跟随编辑器当前画布；`stop` 后粘性设备失效，回到跟随编辑器。

用户也可自己点顶栏"试玩 ↗"（会先保存脚本再开独立标签页）；独立试玩页顶栏有「切换设备画布」「人数」「视角」下拉。

多人试玩（最多 8 人，每位玩家一份独立客户端；Lua `PlayerSelf` 相对当前客户端）：

```
qxqy_studio_play { "action": "start", "args": { "playerCount": 2 } }     ← 指定人数启动
qxqy_studio_play { "action": "view",  "args": { "playerIndex": 2 } }     ← 切换当前玩家视角（不重建）
```

### 4. 导出与引导 GIA 尝试

导出由用户在顶栏"导出"完成，格式选择：

| 需求 | 选什么 |
|---|---|
| 继续编辑 / 整体备份 | 完整存档包 JSON（`qxqy-simulator-save`，含服务端 + 客户端 + 两类脚本） |
| 无损工程格式 | Authoring JSON（11 类控件、五画布变换、按钮四状态、脚本挂载全保留） |
| 与真实编辑器/GIA 链路交换 | 「当前界面 GIA」只导出左栏正在看的那棵树；「资产包 GIA（已改动项）」按官方三类独立文件下载，不夹带未改动的出厂默认模板；「资产包 GIA 整合包」把服务端 `UIControlGroup` 与客户端 `UIControlTemplate` 并排写入同一 GIA 的 `Root.graph`，脚本映射同样并排；导入时拆回两类资产，模板边界保留，挂载关系仍不进 GIA |
| 单个脚本 | 分项导出 Lua |

引导用户导入 GIA 尝试时必须同步说明边界，管理预期：

- GIA 导出会附简明警告（如"部分内容暂不支持 GIA"）；旋转线号未验证就不写猜测字段，部分填充形状/方向、自定义羽化值、非 100% 进度只保存在 Authoring JSON。
- 未知 protobuf 字段不保证往返回写。
- 若当前工作区就是模拟器源码仓库，可先运行 `cd simulator/studio && npm run generate:client-template` 生成探针文件 `probes/client-template-import/qxqy-lua-instantiable-panel.gia`，再导入验证 Lua 动态实例化（预期模板索引 `1073742100`；真实编辑器若重映射，以导入后检视器显示值为准）。

## 工作流二：自定义交互测试队列（自动化测试用例）

试玩会把指针、按键、点击和服务端写变量/发信号记进时间线（`t` 为引擎时钟，不是墙钟）。可用 `qxqy_studio_play` 保存、回放并断言。

```
qxqy_studio_play { "action": "start" }
qxqy_studio_play { "action": "pointer", "args": { "type": "click", "x": 800, "y": 450 } }
qxqy_studio_play { "action": "history" }          ← 当前试玩已记录的事件
qxqy_studio_play { "action": "saveCase", "args": { "name": "click-ok", "asserts": [{ "kind": "log", "contains": "clicked" }] } }
qxqy_studio_play { "action": "runCase", "args": { "case": <上一步返回的用例> } }
```

用例格式 `qxqy-autotest` / `version: 1`：`events[]` + `asserts[]`。也接受技能旧队列写法（`do`/`check`），会在运行前规范化。

断言 kind：`log`（默认查客户端脚本 `print`/`printerr`；`source: "server"` 才查服务端变量/信号日志）、`control`（控件字段，回放时按需检视）、`var`（服务端自定义变量）、`signal`（入/出站信号）、`tree`（控件是否存在，回放时按需检视）、`lua`（只能调查询 API：`query.var` / `query.control` / `query.logContains` / `query.logs` / `query.serverLogContains` / `query.serverLogs` / `query.signals`，与玩法脚本分 state）。失败时报告带 `failedAt`、帧号和现场快照，不要急着 `stop`。日常试玩不要每帧 `step` 拉树。

服务端薄模拟：

```
qxqy_studio_play { "action": "serverSet", "args": { "entityType": "PlayerSelf", "name": "Gold", "value": 10 } }
qxqy_studio_play { "action": "serverGet" }   ← 列出全部变量
qxqy_studio_play { "action": "serverGet", "args": { "entityType": "PlayerSelf", "name": "Gold" } }
qxqy_studio_play { "action": "serverSend", "args": { "target": "PlayerSelf", "name": "Battle_OnReward", "params": [1] } }
```

`entityType` 可以是 Lua 的 `Level` / `PlayerSelf` / `AvatarSelf`，或模拟器座位 `Player1`–`Player8` / `Avatar1`–`Avatar8`。未定义变量的 Lua Get 返回 `nil`（模拟器策略）。`serverSend.target` 可以是 `PlayerSelf`（当前视角玩家）、`Player1`–`Player8` 或 `AllPlayers`。

要定义随客户端信号自动执行的服务端逻辑，可让用户在编辑器“服务端逻辑”页配置，或用 `qxqy_studio_patch` 的 `setServerLogic`。它是模拟器存档格式，不是官方节点图；规则按信号名监听，顺序执行设置变量和向玩家发客户端脚本信号：

```json
{
  "op": "setServerLogic",
  "expectedRevision": 1,
  "logic": {
    "rules": [{
      "id": "earn-gold",
      "signalName": "EarnGold",
      "actions": [
        { "kind": "setCustomVariable", "entityType": "PlayerSelf", "name": "Gold", "value": { "fromSignalParam": 0 } },
        { "kind": "setCustomVariable", "entityType": "Level", "name": "LastReward", "value": "gold" },
        { "kind": "sendClientScriptSignal", "target": "PlayerSelf", "signalName": "GoldChanged", "params": [{ "fromSignalParam": 0 }, "ok"] }
      ]
    }]
  }
}
```

`{ "fromSignalParam": 0 }` 引用监听信号的第一个参数（从 0 开始）；用在回传参数时会保留原信号参数类型。动作可写 `Level` / `PlayerSelf` / `Player1`–`Player8`；`sendClientScriptSignal.target` 为 `PlayerSelf`（发信号者）、`Player1`–`Player8` 或 `AllPlayers`。Lua 侧 `PlayerSelf` 始终相对当前客户端。

约束：每会话最多一个试玩 Worker；单次操作默认 8 秒超时；`stop` 是唯一确定性回收方式；暂停（`pause`）后才能单帧调试（`step`）。

## 工具速查

| 工具 | 用途 | 要点 |
|---|---|---|
| `qxqy_studio_get` | 读工程无损 JSON 快照 | 无参数；严格 JSON |
| `qxqy_studio_patch` | 编辑工程，参数 `{ "op": { ... } }` | 带 `expectedRevision`；成功后 revision +1 |
| `qxqy_studio_ui_screenshot` | 获取编辑器舞台 PNG | Host 根据 boxes 渲染；不需要打开模拟器标签；不含完整 DOM 工具栏 |
| `qxqy_studio_play_screenshot` | 获取当前试玩 Runtime PNG | Host 根据 paint 渲染；需要已 start，不需要打开试玩页；不推进 Runtime |
| `qxqy_studio_load` | 从会话工作区列出/拉取存档 | 不传 `path` 列出；传相对路径加载 |
| `qxqy_studio_play` | 试玩控制，参数 `{ "action": "...", "args": {} }` | 见下 |

play 动作：`start`（重建运行时；可带 `canvasId` 指定设备画布、`playerCount` 指定 1–8 人）、`device`（按 `args.canvasId` 切换设备画布并重建运行时）、`view`（按 `args.playerIndex` 切换当前玩家视角，不重建运行时）、`get`、`step`（`dt` 秒）、`pointer`（`type` = move/down/up/click，click = down+up；`x`/`y` 为当前画布像素）、`key`（按脚本注册监听的键名）、`click`（按控件名直接触发）、`pause`/`resume`、`stop`、`serverGet`/`serverSet`/`serverSend`、`history`/`saveCase`/`runCase`（可带 `canvasId` 钉住用例设备，可带 `playerCount`）。未 start 时 `pointer` / `key` / `click` 都会报 `play session has not started`。

常用 patch op：`select`（id）、`pick`（x/y 命中）、`setCanvas`（canvasId）、`addScript` / `updateScript` / `removeScript`（脚本由存档统一管理；服务端容器会被拒绝）、`setServerLogic`（规则定义）、`newAsset`（assetType）、`addTemplate`、`add`（parentId/kind/name）、`reparent`、`moveSibling`（direction=up/down）、`remove`、`set`（id/key/value）、`replace`（project）。数据写操作必须带 `expectedRevision`。

`set` 常用 key：变换类 `posX/posY/width/height`、`rotationZ`、`anchorType`、`anchorMinX/Y`、`anchorMaxX/Y`、`pivotX/Y`；业务类 `text`、`fontSize`、`imageId`、`enableMask`、`enableFill`、`fillType`、`fillAmount`(0–1)、按钮四状态 `unavailableChildId/hoverChildId/pressedChildId/selectedChildId`、`syncAllDevices`；颜色接受 `#AARRGGBB`。以上是常用子集，未列出的字段不要猜——`set` 对不认识的 key 会直接报错，以报错为准。

脚本 `require` 使用导入根：脚本映射路径去掉 `.lua` 后，前面加 `default_import_file/`。例如映射路径为 `workspace/flappy-fish/draws.lua` 时，写：`local ok, mod = pcall(require, "default_import_file/workspace/flappy-fish/draws")`。裸路径只为旧存档兼容，新脚本一律使用该前缀。

## 领域规则速记（写 op 前自查）

- 服务端"客户端控件容器"只是资源分组，**不能挂客户端脚本**；脚本挂到客户端控件上。
- 画布 5 个：`pc-16-9`(1600×900)、`pc-21-9`(2100×900)、`mobile-16-9`(1280×720)、`mobile-19.5-9`(1560×720)、`mobile-4-3`(1280×960)；原点左下，锚点相对父矩形 0–1。
- **2D 游戏布局基准是手机 16:9（`mobile-16-9` / 1280×720）。** 整屏构图必须在该画布完整可见。PC 可用 1600×900 设计像素，但应把舞台放进固定设计尺寸的板，再按 `min(canvas/design)` 等比缩放（不足处留边），禁止按 PC 铺满后再在手机上裁切。缩放容器不要再加全屏不透明兄弟节点（试玩页同级先出现的子节点会盖住后面的舞台）。P0 至少覆盖 `mobile-16-9` 与 `pc-16-9`。
- 多设备试玩：试玩 `device` 动作或 `start {canvasId}` 在五个预设间切换；切换只改画布宽高并选用对应平台的 RectTransform 槽位（PC→KEYBOARD/KeyboardAndMouse，手机→TOUCHSCREEN/Mobile），锚点在新父矩形下重新解算。
- `imageId` 100001–100006 画占位图元，其他显示缺失框——不伪造官方素材。
- 旋转进入运行时，但点击命中按旋转前轴对齐矩形计算。

## 排障（运行时）

| 症状 | 处理 |
|---|---|
| 工具不可见 | 插件未加载，请用户重启 `dsh web` 并确认 profile；不是本技能能修的 |
| revision conflict | 重新 `get` 后重算编辑 |
| `play session has not started` | 先 `start` 再发其他动作 |
| 路径脚本不生效 | 路径相对工作区；先用内联 source 排除路径问题 |
