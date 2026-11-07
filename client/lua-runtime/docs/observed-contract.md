# 运行时契约与保真边界

来源：官方 API 文档、`probes/engine-fidelity` 及下列专项真机回传。这里只维护采用的结论、证据边界与回归入口，不记录执行流水。

## 生命周期与脚本路径

- 挂载执行 chunk → `OnInit` → `OnEnable` → `OnStart`；`EnableUpdate` 前无 `OnUpdate`；退出 `OnDisable` → `OnDestroy`。`SetActive(false/true)` 立即触发对应 Disable/Enable，不重跑 `OnStart`（2026-08-29 真机）。`PauseLevelTime` 只暂停 `OnLevelUpdate`。
- 实例化：官方 API 未记载生命周期限制；探针中 `OnInit/OnDestroy` 返回 nil，`OnStart` 返回控件，未观察到父 `OnStart` 重入。实例继承模板的 `active/visible`。官方加工稿写 active 默认 false，真机未改模板为 true、显式 false 为 false；Authoring 新节点默认 true，手写 runtime spec 省略仍按 false，compile 带入保存值。
- `GetParam` 保持 string/integer/float/boolean 类型，未配置返回 nil。`require` 使用映射路径、独立环境、返回值及缓存，不执行模块生命周期；加载失败为 `failed to load script '…'`。原生值与环境实现见[架构](architecture.md#模块值与环境实现)。
- `script.path` 保留目录。PC 真机日志返回 `default_import_file/levelScript`（2026-09-27，客户端版本未知、聊天回传原件待补），见完整工作区 `probes/script-path-20260927/`。路径归一保留目录、统一斜杠、去掉结尾小写 `.lua`，不自动添加导入前缀；归一规则是模拟器策略。回归覆盖不同目录同名脚本的 `GetScriptByPath` 精确查找，不表示原游戏真机修复通过。

## 沙箱与值类型

- `_VERSION` 为 nil；裁剪 `io/load/loadfile/dofile/package/coroutine/collectgarbage`、`string.dump/pack/unpack`。保留 `utf8`、`os.time/date/clock/difftime`、`debug.traceback` 和字符串方法语法，但全局 `getmetatable` 对字符串隐藏。
- math 按正式服探针保留 `modf/ult`，提供 `isnan/isinf`；文档异常拼写 `isnaf` 无已知语义，不提供。Fengari 整数为 32 位，这是底层限制，不是客户端整数结论。
- `typeof` 区分 Script、控件类、EnumItem、CursorEventData、Tween、TweenSequence、ServerSignal；普通 Lua 表返回 table。Enum 是 userdata，以身份比较，提供 `Name/FullName/EnumType`。
- Color 为 AARRGGBB 打包整数，提供 `Color()`、`FromRGB`、`ToRGBA`；后者返回整数通道。
- 本地化策略：`GetText` 原样返回 id；`GetLanguageType` 未注入时默认 `LanguageChs`。DSH/Web/MCP 试玩从本机原神 `output_log.txt` 最近一次 `Request to set language` 读取语言，无法映射时回退默认；这不是千星真机契约。

## 控件字段与调用校验

- userdata 按类型封闭，只开放官方 API 字段/方法；缺字段读 nil，写 `cannot set <field>, no such field`。Authoring 的按钮四态、`enableFill`、网格 cellSize 等不进入 Lua 表面；`script.tickEnabled`、`EnumItem.__kind` 也不开放。
- [官方 API](https://act.mihoyo.com/ys/ugc/tutorial/detail/mhtakr07vej4)（2026-10-24 核对）采用小写 `id/prefabIndex`。模拟器兼容只读整数 `Id`，与 `id` 相同且销毁后不可读；别名不证明真机支持。Script 使用 `scriptMappingId`，grid 使用 `itemPrefabIndex`，reference 使用 `referencedPrefabIndex`，不新增 `script.id/prefabId`。回归见 `test/runtime.test.mjs`。
- `FindChild` 支持 `A/B`，`GetChild` 仅直接子节点。`GetChildren` 返回可操作的 Control 引用；历史本地 API rev223 未约定数组顺序，模拟器采用最上层在前。`test/children-reference.test.mjs` 验证引用和排序，不以此证明真机数组顺序。
- `imageType` 只有部分真机图片可写，基础图元模板赋值曾报缺字段。独立 Runtime 默认拒绝，Studio 注入白名单策略；具体接受范围、读回及渲染规则统一见[图片类型](../../../studio/docs/image-assets.md#图片类型基础拉伸)。
- `game` 全局函数用点号，桥接逐项核对 API 参数个数。2026-09-25 日记回传 `game:GetClientUIRoots()` 报 `(0 expected, got 1)`；对其他函数的统一检查是模拟器防错策略。日记初始化未解决范围见[Studio](../../../studio/README.md#gia-图元与初始状态)。

## 输入与显示层序

- 显式层级数值大的在上；编辑器同级列表先出现的在上；Lua sibling 大索引置顶，First 置底、Last 置顶（官方原始快照 rev223、2026-09-06 真机反馈）。`scene.js` 在 API 边界反向映射内部 children 列表，绘制/命中共享该树。默认新实例位置见[动态层序](#默认动态实例层序)。
- 光标监听仅限预设按钮/光标检测区；图片不把指针转给子级光标区。`SimulateCursorClick` 触发 Click，坐标不必是中心，`GetUIPos` 可为 `(0,0)`。投影和命中边界见[控件支持](../../../studio/docs/control-support.md)。
- `injectKey/injectCursor` 在 `step()` 外同步派发，回调内写入立即进入场景。KEYRD v1（2026-10-01 PC，按键/点击各一次）观察到两者均在本帧 `OnUpdate` 后、下帧前执行，直接写字段与启动 Tween 均显示；未复现“按键帧外写入不重绘”。证据见完整工作区 `probes/key-render-20261001/`。
- 按键按 children 前到后的显示层序派发，Lua 调整 sibling 后，下一次按键使用新顺序；仅 `true` 中断同根后续回调。2026-10-24 官方公开指南声明按渲染顺序优先；生效版本、新版真机及父子/跨容器消费边界未确认，同根消费为模拟器策略。旧同控件探针不能证明新版跨控件顺序。

<a id="setvisible-布尔参数校验2026-10-13"></a>
## SetVisible 布尔参数校验

- 真机证据：WOO 回传 `bad argument #2 to 'SetVisible' (boolean expected, got nil)`，调用链为 `main:1909 render → OnUpdate`；客户端版本、平台未知，截图原件待补，见完整工作区 `probes/woo-setvisible-20261013/`。`observed / device / failed` 只证明 nil 被拒，不证明完整玩法修复后通过。
- 依据：本地官方 API 快照 rev223 声明 `visible:boolean`，`SetVisible` 只改变可见性、不停止脚本逻辑（`documented / official_document`）。
- 当前桥接仅接受 true/false；nil、遗漏实参及其他非布尔值在转换前报错，拒绝后值不变。对其他类型的统一拒绝是模拟器防错策略，未逐类真机验证，不扩展到其他方法或宿主内部 scene 调用。
- 回归：`test/set-visible.test.mjs` 覆盖无效类型、拒绝原子性、active 与 OnUpdate 不受显隐影响；`observed / simulator`，完整游戏真机复验仍为 `pending`。

<a id="tweensequence-追加与插入排程2026-11-06twpar"></a>
## TweenSequence 追加与插入排程

- 来源：TWPAR PC 对照视频及存档（2026-11-06，实际客户端版本未知、无真机 print 报告），原件定位与时点见完整工作区 `probes/tween-parallel-20261106/README.md`。可读泳道为 `observed / device / failed`（相对于旧模拟器参考行为）；原 JSON 的 PASS/DIFF 基于旧模拟器预期，不是真机一致性标准。
- `src/tween.js` 的追加游标只由 `Append`、`AppendInterval`、首个有效 `Join` 推进，`AppendCallback` 位于该游标；`Insert/InsertCallback` 使用绝对时间且不改变它。结束取追加末尾与全部插入项末尾的最大值，`SetOnComplete` 在该点触发。
- 同一追加组仅排入首个 Join，后续项不启动、不写值、不触发回调、不延长组时长。视频确认不启动及无子项完成；不延长组时长为策略，具体尾回调时点未测。同刻顺序及子 Tween 循环槽位沿用下节契约。
- 未测策略（`inferred / simulator`，真机 `pending`）：新 `Append/AppendInterval` 开启 Join 名额；回调和 Insert 不重开；无 Append 时首个 Join 从零开始。纯 Insert 后追加等待/尾回调，以及循环、Restart、Pause、Complete/Kill 复用该排程；组合边界未获真机确认，不推断引擎内部结构或全局只允许一个 Join。
- 回归：`test/tween-sequence.test.mjs`，覆盖真实 Lua 的子项位置/回调、插入后追加、尾回调/整体完成、循环、暂停、强制完成与清理。

<a id="tween-缓动生命周期边界与字段读回2026-09-29twall-v1"></a>
## Tween 缓动、生命周期边界与字段读回

- 来源：TWALL v1（2026-09-29 PC，聊天日志已存档、原始文件待补），见完整工作区 `probes/tween-coverage-20260929/` 与 `knowledge/fact.md`，`observed / device`。
- Tween 默认绝对，`SetRelative(true)` 为增量；Linear 按时间插值。31 种 `EaseType` 在受测探针中与 `src/ease.js` 公式逐帧一致。Pause/Resume 冻结时间；同字段按 Play 顺序后者覆盖、先完成者停止写入；显隐/激活和关卡时停不停 Tween/序列。受测字段包括锚点、轴心、缩放、尺寸、羽化、`fillAmount`、文本三色。
- 生命周期（`src/tween.js`）：相对 Tween 自身循环每轮回到首次捕获，不累加；时长 0 的 Tween 在 Play 时不写值，下一次更新到终值并完成；播放中再 `Play()` 无效果；`Kill(false)` 后 `Play()` 无效果；已完成的 Tween/序列再 `Complete()` 不再触发回调。序列子 Tween 的槽位为时长×自身 `SetLoops` 次数，槽内按自己的时钟循环，槽结束时强制到终值。
- 字段（`src/runtime.js`）：`number` 类型字段读回为浮点（`137.0`），API 标为 `integer` 的字段为整数，颜色保持原编码；控件销毁后除 `alive` 外读字段报错；取字段的异常转为 Lua 错误。
- 策略（未验证）：暂停中 `Play()` 视为继续；`Kill(false)` 后 `Restart()`/`Complete()` 同样无效；序列在播放中 `Play()` 无效果；`minimumFontSize` 补间同 `fontSize` 截断；序列内子 Tween 设无限循环时按 1 次处理。
- 已知差异：跨脚本 `Invoke` 在真机探针中保持控件/Tween/table 的 `rawequal` 身份；模拟器每脚本一个 Lua state，跨 VM 经 JS 转换，table 会被复制。当前架构不能保证该身份契约。
- 回归：`test/runtime.test.mjs` 的缓动、暂停、循环、重复完成和字段读回用例；逐帧 dt 回放支持上述模拟器结论，不扩大真机观察范围。

<a id="tween-帧级语义与旋转读回2026-09-29twsem-v1"></a>
## Tween 帧级语义与旋转读回

- 来源：TWSEM v1（2026-09-29 PC，聊天日志已存档、原始文件待补），见完整工作区 `probes/tween-semantics-20260929/` 与 `knowledge/fact.md`，`observed / device`。
- 旋转读回（`src/scene.js` `readbackEuler`/`luaFieldValue`）：Lua 读 `localRotationX/Y/Z` 与 `GetLocalRotation` 返回按 Z-X-Y 四元数往返后的欧拉角，落在 [0,360)、恒为浮点；写入值原样保存供渲染。X=-116 读回 296、90.5 读回 89.5 由此得出。补间起点取读回值，因此绝对 -116→-136 实际走 244→-136。
- 捕获与顺序（`src/tween.js`）：Tween 在 Play/子项开始时捕获。子 Tween 由序列时间线驱动，同刻按“子项结束 → 回调 → 子项开始”处理，最后插值运行中的子项；`Play()` 不同步触发 0 秒条目；`Complete()`/`Kill(true)` 按时间顺序执行剩余时间线（未播放序列同样），再触发步骤完成与完成。Tween 与序列在同一集合中按 Play 顺序更新。
- 循环边界：到达终点的帧显示终值并触发步骤完成，下一帧以该帧 dt 从头开始，丢弃溢出，单 Tween 与序列一致。
- 取整：`fontSize` 补间和颜色通道截断为整数。
- 已知差异：Fengari 的 `string.format`/`tostring` 不输出 `-0.0` 的负号（真机 X=0 可显示 `-0.000`），不保证浮点日志文本逐字相同。
- 回归：`test/runtime.test.mjs` 的捕获、同刻顺序、循环边界、旋转读回与取整用例。Pause/Resume、相对循环及重复 Complete 见上节 TWALL；X/Y 渲染见 [控件支持](../../../studio/docs/control-support.md#xy-旋转投影)。

<a id="tweensequence-循环与-scriptinvoke-传递2026-09-29"></a>
## TweenSequence 循环与 `script:Invoke` 传递

- 来源：TWINV v1（2026-09-29 PC，聊天日志、原始文件待补），见完整工作区 `probes/tween-invoke-20260928/` 与 `knowledge/fact.md`，`observed / device`。
- 序列每轮从初始快照重播，相对子项不跨轮累加；回调和步骤完成每轮一次，完成回调只在最后一次，Restart 播完可再次完成。循环溢出与子项调度以[帧级语义](#tween-帧级语义与旋转读回)为准。
- Invoke（`src/runtime.js` 的 `luaInvoke`）同步调用并返回值；同一 Lua state 内保持 userdata/table 身份、多返回值与错误，桥接不将序列或信号展开为普通表。跨脚本身份差异见[生命周期与字段读回](#tween-缓动生命周期边界与字段读回)。
- 回归：`test/runtime.test.mjs` 的序列重播及同VM Invoke身份用例；对照证据见上述TWINV目录。

<a id="默认动态实例层序2026-09-28"></a>
## 默认动态实例层序

- 采用规则：同一父控件下，后实例化的根默认在已有兄弟上方；显式 First/Last/Index 可覆盖。依据是用户采纳的兼容性规则，不是官方声明；原报告 `provided_unverified / device / pending`，日志只证实事件接收，未证实图层与重叠命中。证据范围见完整工作区 `probes/sibling-order-20260928/device-20260928.md`。
- 实现范围：`src/runtime.js` 的 `instantiate` 在 `parent.addChild` 后将新根置顶，再挂载模板脚本；模板 OnStart 可主动置底。公共 parent setter、模板内部静态列表、GIA wire、渲染与模拟点击语义不受此规则改变。
- 自包含回归：`test/instantiate-order.test.mjs` 通过真实 Lua 创建两个带脚本的实例，验证已有静态兄弟、模板内部顺序、子脚本身份及模板 OnStart 主动置底。Studio 的 `test/sibling-order.test.mjs` 增加 A/B 交换创建、PNG 独占区/重叠区、后续帧创建的场景增量与 Pixi 容器排序、显式排序、按钮/光标区的坐标命中、父组边界。输入相关期望用于验证模拟器绘制/命中一致性，不能冒充真机重叠点击证明。
- 上述回归为 `observed / simulator`；真机图层与重叠命中独立复核仍为 `device_status=pending`。

<a id="字号整数校验2026-09-27"></a>
## 字号整数校验

- 来源：七圣真机聊天日志中，小数字号 `23.56` 报 `fontSize (integer expected, got number)`；原始文件与客户端版本缺失，`observed / device / failed` 仅证明拒绝该输入，不代表完整游戏已通过。
- 文档依据：本地官方API对文本框与文本视窗的 `fontSize`、`minimumFontSize` 均声明为 `integer`（`documented / official_document`，未在线重采）。
- 模拟器在 Lua 控件可写字段赋值处校验这两个字段，仅接受整数数值，拒绝小数、非有限值和非数字，拒绝后不改变旧值。原字段访问权限错误保留。此修复覆盖直接赋值；不外推为 Tween 内部插值、所有控件字段或字号范围已对齐。
- `20.0` 等整数数值浮点输入仍允许，是模拟器策略；真机是否按 Lua 数字子类型区分这类输入未知。没有额外字号上下限，也不自动四舍五入脚本传入值。
- 自包含回归：`test/font-size.test.mjs`，涵盖两种文本控件、两个字号字段、原始小数输入、无效类型、拒绝后值不变，以及布局尺寸仍可为小数。模拟器测试不等同于游戏的真机修复验收。
