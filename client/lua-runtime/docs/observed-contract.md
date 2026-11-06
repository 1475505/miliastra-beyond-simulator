# 运行时契约（结论）

来源：官方 API 文档、`probes/engine-fidelity` 及下列专项真机回传。这里只维护采用的结论、证据边界与回归入口，不记录执行流水。

1. 生命周期：OnInit → OnEnable → OnStart；EnableUpdate 前无 OnUpdate；退出 OnDisable → OnDestroy。`SetActive(false)` 立刻 `OnDisable`，`SetActive(true)` 再 `OnEnable`，不重跑 `OnStart`（2026-08-29 真机）。
2. Instantiate：官方 API 未记载生命周期限制。探针：OnInit/OnDestroy → nil；OnStart → 控件；未观察到父 OnStart 重入。实例的 `active`/`visible` 继承模板定义，运行时不再强制打开。
2a. `ClientUIBaseControl.active` 官方加工稿写「默认为 false」。真机未改过的客户端模板实例为 `true`；明确 false 的模板实例为 `false`。编辑器 Authoring 新建节点默认 true。runtime spec 省略该字段时仍按 false（手写树），compile 带入编辑器保存值。
3. GetParam：string / integer / float / boolean 保型。
4. require：已映射脚本路径；独立环境；return 值；缓存；不跑 OnInit/OnStart。
5. Tween 默认绝对；Linear 时间线性。
6. PauseLevelTime 只挡 LevelUpdate。
7. 按键监听 `true` 中断后续。
8. SimulateCursorClick 发 Click，坐标不必是中心。
9. FindChild 支持 `A/B`；GetChild 仅一层。
10. Color 为打包整数。
11. 无标准 `package`；有 `require` 函数。
12. 控件 userdata 按类型封死：当前类型没有的字段读为 nil，写为 `cannot set <field>, no such field`。光标监听只挂在预设按钮 / 光标检测区。
13. 显式层级数值大的在上；编辑器同级列表先出现的在上。Lua sibling 大索引置顶，First 置底、Last 置顶（官方原始快照 rev223；2026-09-06 用户真机反馈）。scene.js 将 API 数值反向映射到内部前到后 children 列表；绘制和命中共享该树。图片不把指针传给子级光标区。证据范围见根 knowledge/fact.md，不把模拟器回归当成真机通过。
13a. 动态 `InstantiateClientUIControl` 的新实例根默认置于已有同父兄弟上方（最大 Lua sibling 索引）；模板内部的静态子列表保持原序。该规则于 2026-09-28 按用户要求采用，来源与回归见下节，不能把默认创建时间与编辑器列表位置混为一谈。
14. `ClientUIImageControl.imageType`：创作者确认只有部分图片支持设置。已观察：基础图元模板赋值报 `cannot set imageType, no such field`。2.1.0 按用户指定的图片编辑器规则对 Studio 远程静态白名单接通 Basic/Stretch 选择请求，渲染按 m_Border 决定是否切片；基础图元/Prefab/未知来源仍拒绝。此为[模拟器预览策略](../../../studio/docs/image-assets.md#图片类型基础拉伸210)，不能据白名单接受赋值推断真机字段能力；独立 Runtime 默认仍拒绝，宿主可注入策略。
15. Lua 表面只开放官方 API 文档列出的字段/方法。文档未写的（`script.tickEnabled`、`EnumItem.__kind`、`enableFill`、按钮四态等）读为 nil，写报 `cannot set`。
16. 控件标识字段：当前[官方 API](https://act.mihoyo.com/ys/ugc/tutorial/detail/mhtakr07vej4)（2026-10-24 已核对）为小写 `id` / `prefabIndex`；模拟器同时保留大写 `Id` 兼容，二者返回相同的只读整数运行时 ID，销毁后均不可读。`Id` 兼容属于模拟器策略，不证明真机也提供该别名。Script 字段仍为 `scriptMappingId`（不新增 `script.id`）；grid 的 `itemPrefabIndex`；reference 的 `referencedPrefabIndex`。`prefabId` 仍不开放。自包含回归见 `test/runtime.test.mjs` 的 control id 用例。
17. math 沙箱：按正式服探针保留 modf、ult；额外提供 isnan、isinf。文档异常行提到的 `math.isnaf` 语义无处记载——按反编造政策不提供（读为 nil）。
18. Runtime capability fidelity: load/loadfile/dofile/package/coroutine/collectgarbage、string.dump/pack/unpack 按客户端裁剪；字符串方法语法保留，但全局 getmetatable 对字符串隐藏。普通 Lua 表的 typeof 返回 table。Fengari 的整数仍是 32 位，这是已知的底层限制，不能作为客户端整数结论。
19. `game` 全局函数按当前 API 用点号调用。2026-09-25 日记脚本真机回传 `game:GetClientUIRoots()` 的 `bad argument count ... (0 expected, got 1)`；模拟器现核对固定参数个数。该脚本的 `game:GetUICanvasSize()` 也应改为点号。旧 Probe5 的 `game.GetClientUIRoots()` 返回空表，故日记脚本从已挂载的 `script.object` 查找 `STAGE`；修正包只有模拟器验证，真机待验。

20. `script.path` 保留映射路径中的目录。2026-09-27 真机故障日志返回 `default_import_file/levelScript`（正式服 PC，客户端版本未知；聊天回传，原件待补），证据见完整工作区 `probes/script-path-20260927/`。`normalizeRequirePath` 保留目录、统一斜杠、去掉结尾小写 `.lua`，不自动添加导入前缀；后两项是模拟器策略，不外推为所有路径格式的真机证明。回归覆盖完整路径、归一化与不同目录同名脚本的 `GetScriptByPath` 精确查找；原故障为 `failed / device`，不代表完整游戏修复后真机通过。

21. 按键与点击回调时机相同，回调内写入立即生效。2026-10-01 KEYRD v1 真机（PC，按键、点击各 1 次）：两类回调都在第 N 帧 `OnUpdate` 结束后、第 N+1 帧之前执行，回调内直接写文本/位置/颜色/显隐、启动 Tween 均正常显示。创作者“按键回调帧外写入不重绘”的回传未复现，`injectKey`/`injectCursor` 维持在 `step()` 之外同步派发、写入即进场景，不增加帧外冻结。证据与未覆盖范围见根 `probes/key-render-20261001/` 与 knowledge/fact.md 同名条目。

跨控件按键派发的官方渲染顺序声明与模拟器消费边界见[架构](architecture.md#模拟器策略非官方证明)；不能用上述旧版同控件真机探针证明新版跨控件顺序。

## SetVisible 布尔参数校验（2026-10-13）

- 真机证据：WOO 回传 `bad argument #2 to 'SetVisible' (boolean expected, got nil)`，调用链为 `main:1909 render → OnUpdate`；客户端版本、平台未知，截图原件待补，见完整工作区 `probes/woo-setvisible-20261013/`。`observed / device / failed` 只证明 nil 被拒，不证明完整玩法修复后通过。
- 依据：本地官方 API 快照 rev223 声明 `visible:boolean`，`SetVisible` 只改变可见性、不停止脚本逻辑（`documented / official_document`）。
- 当前桥接仅接受 true/false；nil、遗漏实参及其他非布尔值在转换前报错，拒绝后值不变。对其他类型的统一拒绝是模拟器防错策略，未逐类真机验证，不扩展到其他方法或宿主内部 scene 调用。
- 回归：`test/set-visible.test.mjs` 覆盖无效类型、拒绝原子性、active 与 OnUpdate 不受显隐影响；`observed / simulator`，完整游戏真机复验仍为 `pending`。

## TweenSequence 追加与插入排程（2026-11-06，TWPAR）

- 来源：PC 真机/模拟器对照视频及 20 例 JSON 存档，探针构建标记 `2.2.0-20261103`，实际客户端版本未知。完整工作区的 `probes/tween-parallel-20261106/README.md` 保存原件哈希、视频时点和前后重放；真机结论统一见根 `knowledge/fact.md` 的 TWPAR 条目。视频可读泳道为 `observed / device / failed`（相对于旧模拟器参考行为），未提供真机 print 报告。
- 排程实现（`src/tween.js` `_schedule`）：追加游标只由 `Append`、`AppendInterval`、首个有效 `Join` 推进，`AppendCallback` 位于该游标；`Insert`/`InsertCallback` 使用绝对时间且不改变它。序列结束取追加末尾与全部插入项末尾的最大值，`SetOnComplete` 由该结束点触发。T15/T17/T19/T20 验证追加独立性，T18 的画面 PASS 支持尾回调早于插入项及整体完成。
- 连续 Join：同一追加组仅排入第一个 Join，后续项不启动、不写值、不触发其回调、不延长组时长。T03–T06 视频确认不启动及无子项完成；不延长组时长为采用策略，T06 视频未展开尾回调/整体完成的具体时刻。保留旧 TWSEM 的同刻事件顺序和 TWALL 的子 Tween 循环槽位。
- 未测边界的策略（`inferred / simulator`，对应真机 `pending`）：新的 `Append`/`AppendInterval` 开启新的 Join 名额；回调和 Insert 不重开；无 Append 时首个 Join 从零开始。纯 Insert 后追加等待/尾回调沿同一游标规则处理（用户已报告，视频未展示 T08/T14）。循环、Restart、Pause、Complete/Kill 复用同一排程；本轮组合的真机边界未测。这些策略不证明内部实际有两条序列，也不证明整个序列全局只允许一个 Join。
- 回归：`test/tween-sequence.test.mjs` 通过真实 Lua 验证子项位置/回调、插入后的追加、尾回调与整体完成，并覆盖循环重播、暂停、强制完成与清理；用例不依赖外部原件。原 JSON 内置的 PASS/DIFF 参考值来自旧行为，不能以它全部 PASS 作为真机一致性标准。修复在共享 Runtime 中生效，DSH/Web/MCP 须重建并重启所用宿主加载新代码。

## Tween 缓动、生命周期边界与字段读回（2026-09-29，TWALL v1）

- 来源：TWALL v1 真机探针，PC，2026-09-29 聊天粘贴日志（完整 294 帧已存档，原始文件待补），见 `probes/tween-coverage-20260929/` 与根 `knowledge/fact.md` 同名条目。`evidence_source=observed`，运行端 `device`。
- 采用结论：31 种 `EaseType` 与 `src/ease.js`（easings.net 公式）逐帧一致；Pause/Resume（含序列回调与循环边界）冻结时间；两个 Tween 写同一字段按 Play 顺序后者覆盖、先完成者停止写入；`SetVisible(false)`/`SetActive(false)` 不停补间；关卡时停不影响 Tween/序列，OnLevelUpdate 暂停；锚点/轴心/缩放/尺寸/羽化/`fillAmount`/文本三色的补间与颜色截断。
- 生命周期（`src/tween.js`）：相对 Tween 自身循环每轮回到首次捕获，不累加；时长 0 的 Tween 在 Play 时不写值，下一次更新到终值并完成；播放中再 `Play()` 无效果；`Kill(false)` 后 `Play()` 无效果；已完成的 Tween/序列再 `Complete()` 不再触发回调。序列子 Tween 的槽位为时长×自身 `SetLoops` 次数，槽内按自己的时钟循环，槽结束时强制到终值。
- 字段（`src/runtime.js`）：`number` 类型字段读回为浮点（`137.0`），API 标为 `integer` 的字段为整数，颜色保持原编码；控件销毁后除 `alive` 外读字段报错；取字段的异常转为 Lua 错误。
- 策略（未验证）：暂停中 `Play()` 视为继续；`Kill(false)` 后 `Restart()`/`Complete()` 同样无效；序列在播放中 `Play()` 无效果；`minimumFontSize` 补间同 `fontSize` 截断；序列内子 Tween 设无限循环时按 1 次处理。
- 未对齐：跨脚本 `Invoke` 的身份（真机各脚本共享同一 Lua state，控件/Tween/table 往返 `rawequal=true`；模拟器每脚本一个 Lua state，只能复制值，table 也会被复制）。需把运行时改为单 VM + 每脚本 `_ENV`，另行处理。
- 回归：`test/runtime.test.mjs` 的缓动、暂停、循环、重复完成和字段读回用例；逐帧 dt 回放支持上述模拟器结论，不扩大真机观察范围。

## Tween 帧级语义与旋转读回（2026-09-29，TWSEM v1）

- 来源：TWSEM v1 真机探针，PC，2026-09-29 聊天粘贴日志（完整 133 帧已存档，原始文件待补），完整工作区见 `probes/tween-semantics-20260929/` 与根 `knowledge/fact.md` 同名条目。`evidence_source=observed`，运行端 `device`。
- 旋转读回（`src/scene.js` `readbackEuler`/`luaFieldValue`）：Lua 读 `localRotationX/Y/Z` 与 `GetLocalRotation` 返回按 Z-X-Y 四元数往返后的欧拉角，落在 [0,360)、恒为浮点；写入值原样保存供渲染。X=-116 读回 296、90.5 读回 89.5 由此得出。补间起点取读回值，因此绝对 -116→-136 实际走 244→-136。
- 捕获与顺序（`src/tween.js`）：Tween 在 Play/子项开始时捕获。子 Tween 由序列时间线驱动，同刻按“子项结束 → 回调 → 子项开始”处理，最后插值运行中的子项；`Play()` 不同步触发 0 秒条目；`Complete()`/`Kill(true)` 按时间顺序执行剩余时间线（未播放序列同样），再触发步骤完成与完成。Tween 与序列在同一集合中按 Play 顺序更新。
- 循环边界：到达终点的帧显示终值并触发步骤完成，下一帧以该帧 dt 从头开始，丢弃溢出（单 Tween 与序列一致）。这也解释了 TWINV 每轮约一帧的相位差（真机 dt 不整除时的溢出被丢弃）。
- 取整：`fontSize` 补间截断为整数；颜色通道截断（原实现即如此，已由真机确认）；`Color.ToRGBA` 返回整数。
- 已知差异：Fengari 的 `string.format`/`tostring` 不输出 `-0.0` 的负号（真机 X=0 可显示 `-0.000`），不保证浮点日志文本逐字相同。
- 回归：`test/runtime.test.mjs` 的捕获、同刻顺序、循环边界、旋转读回与取整用例。Pause/Resume、相对循环及重复 Complete 见上节 TWALL；X/Y 渲染见 [控件支持](../../../studio/docs/control-support.md#xy-旋转投影2026-10-12)。

## TweenSequence 循环与 `script:Invoke` 传递（2026-09-29）

- 来源：TWINV v1 真机探针，PC，2026-09-29 聊天粘贴日志（原始文件待补），完整工作区见 `probes/tween-invoke-20260928/` 与根 `knowledge/fact.md` 同名条目。`evidence_source=observed`，运行端 `device`。
- 序列每轮从初始快照重播，相对子项不跨轮累加；回调和步骤完成每轮一次，完成回调只在最后一次，Restart 播完可再次完成。循环溢出与子项调度以 TWSEM 结论为准（`superseded_by=TWSEM v1`），不沿用早期计入溢出的实现。
- Invoke（`src/runtime.js` `luaInvoke`）：同一 Lua state 内保持 userdata/table 身份、多返回值与错误；跨脚本仍经 JS 值转换，身份差异见 TWALL。`typeof` 对 Tween/TweenSequence/ServerSignal 返回同名，桥接不将序列或信号展开为普通表。
- 回归：`test/runtime.test.mjs` 的序列重播及同VM Invoke身份用例；对照证据见上述TWINV目录。

## 默认动态实例层序（2026-09-28）

- 采用规则：同一父控件下，后实例化的根默认在已有兄弟上方；显式 First/Last/Index 可覆盖默认顺序。依据是用户采纳的兼容性规则，不是新增官方声明；原报告为 `provided_unverified / device / pending`。聊天日志只证实事件接收，旧“九格真机通过”已撤回，证据更正见完整工作区 `probes/sibling-order-20260928/device-20260928.md`。
- 实现范围：`src/runtime.js` 的 `instantiate` 在 `parent.addChild` 后将新根置顶，再挂载模板脚本；模板 OnStart 可主动置底。公共 parent setter、模板内部静态列表、GIA wire、渲染与模拟点击语义不受此规则改变。
- 自包含回归：`test/instantiate-order.test.mjs` 通过真实 Lua 创建两个带脚本的实例，验证已有静态兄弟、模板内部顺序、子脚本身份及模板 OnStart 主动置底。Studio 的 `test/sibling-order.test.mjs` 增加 A/B 交换创建、PNG 独占区/重叠区、后续帧创建的场景增量与 Pixi 容器排序、显式排序、按钮/光标区的坐标命中、父组边界。输入相关期望用于验证模拟器绘制/命中一致性，不能冒充真机重叠点击证明。
- 上述回归为 `observed / simulator`；真机图层与重叠命中独立复核仍为 `device_status=pending`。

## 字号整数校验（2026-09-27）

- 来源：用户在聊天中提供的七圣真机日志（原始文件待补，具体客户端版本未提供），`previous=RUNNING phase=mulligan`，报 `bad argument #2 to 'fontSize' (integer expected, got number)`，调用链为 `src/ui:94 → badge → artCard → setupScreen`。该调用计算字号 `38 * .62 = 23.56`。此拒绝行为为 `evidence_source=observed`、运行端 `device`、原故障 `device_status=failed`；它不能证明完整游戏已运行通过。
- 文档依据：本地官方API对文本框与文本视窗的 `fontSize`、`minimumFontSize` 均声明为 `integer`（`documented / official_document`，未在线重采）。
- 模拟器在 Lua 控件可写字段赋值处校验这两个字段，仅接受整数数值，拒绝小数、非有限值和非数字，拒绝后不改变旧值。原字段访问权限错误保留。此修复覆盖直接赋值；不外推为 Tween 内部插值、所有控件字段或字号范围已对齐。
- `20.0` 等整数数值浮点输入仍允许，是模拟器策略；真机是否按 Lua 数字子类型区分这类输入未知。没有额外字号上下限，也不自动四舍五入脚本传入值。
- 自包含回归：`test/font-size.test.mjs`，涵盖两种文本控件、两个字号字段、原始小数输入、无效类型、拒绝后值不变，以及布局尺寸仍可为小数。模拟器测试不等同于游戏的真机修复验收。
