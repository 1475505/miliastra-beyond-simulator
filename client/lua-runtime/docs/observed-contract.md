# 运行时契约（结论）

来源：官方 API 文档表面 + 三轮 `probes/engine-fidelity` 日志。细节探索过程不在此重复。

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
14. `ClientUIImageControl.imageType`：创作者确认只有部分图片支持设置。已观察：对一组刚 Instantiate 出的图片赋值报 `cannot set imageType, no such field`。在能力判定条件通过 probe/GIA 明确前，模拟器保守跟该拒绝路径，不全局开放。
15. Lua 表面只开放官方 API 文档列出的字段/方法。文档未写的（`script.tickEnabled`、`EnumItem.__kind`、`enableFill`、按钮四态等）读为 nil，写报 `cannot set`。
16. 控件标识字段：`Id`（客户端控件运行时ID，首字母大写）/ `prefabIndex`；Script 字段 `scriptMappingId`（GetScript 参数同名）；grid 的 `itemPrefabIndex`；reference 的 `referencedPrefabIndex`。InstantiateClientUIControl / GetClientUIControl 仅形参名变化。旧 probe 中的 `control.id` / `prefabId` 是旧版本接口，不作为兼容口径。
17. math 沙箱：按正式服探针保留 modf、ult；额外提供 isnan、isinf。文档异常行提到的 `math.isnaf` 语义无处记载——按反编造政策不提供（读为 nil）。
18. Runtime capability fidelity: load/loadfile/dofile/package/coroutine/collectgarbage、string.dump/pack/unpack 按客户端裁剪；字符串方法语法保留，但全局 getmetatable 对字符串隐藏。普通 Lua 表的 typeof 返回 table。Fengari 的整数仍是 32 位，这是已知的底层限制，不能作为客户端整数结论。
19. `game` 全局函数按当前 API 用点号调用。2026-09-25 日记脚本真机回传 `game:GetClientUIRoots()` 的 `bad argument count ... (0 expected, got 1)`；模拟器现核对固定参数个数。该脚本的 `game:GetUICanvasSize()` 也应改为点号。旧 Probe5 的 `game.GetClientUIRoots()` 返回空表，故日记脚本从已挂载的 `script.object` 查找 `STAGE`；修正包只有模拟器验证，真机待验。

20. `script.path` 保留映射路径中的目录。2026-09-27 用户提供的真机故障日志明确返回 `default_import_file/levelScript`，不是 `levelScript`（正式服 PC，具体客户端版本未提供；聊天回传，原件待补）。`af397ac` 将挂载脚本路径统一截为短名的结论已被此回传替代（superseded_by: 本条）；恢复该提交之前的 `normalizeRequirePath`：保留目录、统一斜杠、去掉结尾小写 `.lua`。后两项为恢复的模拟器处理策略，不将本次回传外推为所有路径格式的真机证明，也不自动添加导入前缀。回归覆盖完整路径、原有归一化以及不同目录同名脚本的 `GetScriptByPath` 精确查找；原故障真机状态为 `failed`，模拟器测试不等同于完整游戏真机启动通过。

后续版本的同级控件按键派发顺序另见[架构中的模拟器策略](architecture.md#模拟器策略非官方证明)。创作者预告上层控件优先接收；这不是上述真机探针已观察到的顺序结论。

## Tween 帧级语义与旋转读回（2026-09-29，TWSEM v1）

- 来源：TWSEM v1 真机探针，PC，2026-09-29 聊天粘贴日志（完整 133 帧已存档，原始文件待补），完整工作区见 `probes/tween-semantics-20260929/` 与根 `knowledge/fact.md` 同名条目。`evidence_source=observed`，运行端 `device`。
- 旋转读回（`src/scene.js` `readbackEuler`/`luaFieldValue`）：Lua 读 `localRotationX/Y/Z` 与 `GetLocalRotation` 返回按 Z-X-Y 四元数往返后的欧拉角，落在 [0,360)、恒为浮点；写入值原样保存供渲染。X=-116 读回 296、90.5 读回 89.5 由此得出。补间起点取读回值，因此绝对 -116→-136 实际走 244→-136。
- 捕获与顺序（`src/tween.js`）：Tween 在 Play/子项开始时捕获。序列不再把子 Tween 注册为独立补间，而在自身时间线上按时间顺序处理：同刻“子项结束 → 回调 → 子项开始”，最后插值运行中的子项；`Play()` 不同步触发 0 秒条目；`Complete()`/`Kill(true)` 一次性按时间顺序跑完剩余时间线（未播放序列同样），再触发步骤完成与完成。Tween 与序列在同一集合中按 Play 顺序更新。
- 循环边界：到达终点的帧显示终值并触发步骤完成，下一帧以该帧 dt 从头开始，丢弃溢出（单 Tween 与序列一致）。这也解释了 TWINV 每轮约一帧的相位差（真机 dt 不整除时的溢出被丢弃）。
- 取整：`fontSize` 补间截断为整数；颜色通道截断（原实现即如此，已由真机确认）；`Color.ToRGBA` 返回整数。
- 回放核对：用真机逐帧 dt 重放同一 GIA，133 帧全部字段在 0.02 内一致、整数/浮点类型一致，事件顺序一致；唯一差异是 fengari 的 `string.format`/`tostring` 不输出 `-0.0` 的负号（真机 X=0 读回显示 `-0.000`），属 Lua VM 格式化差异，未修。
- 未覆盖：Pause/Resume 跨边界、单个相对 Tween 自身循环、Complete 重复调用、X/Y 旋转的渲染。自包含回归为 `test/runtime.test.mjs` 末四项及更新后的循环边界断言，修复前 5 项失败。

## TweenSequence 循环与 `script:Invoke` 传递（2026-09-29）

- 来源：TWINV v1 真机探针，PC，2026-09-29 聊天粘贴日志（原始文件待补），完整工作区见 `probes/tween-invoke-20260928/` 与根 `knowledge/fact.md` 同名条目。`evidence_source=observed`，运行端 `device`。
- 序列循环（`src/tween.js`）：每轮从头重播；进入新一轮与 `Play()`/`Restart()` 时先 `Kill(false)` 仍在播放的已触发子 Tween，子 Tween 只在自己的槽位到来时复位。已播放过的子 Tween 用 `Restart()`（初始快照）而非 `Play()`（当前值重新捕获），因此相对子项不跨轮累加。溢出时间计入下一轮并当帧触发到期条目（`superseded_by` TWSEM v1：改为丢弃溢出、下一帧开始，子项由序列直接驱动）。回调、步骤完成每轮一次，完成回调仅最后一次；Restart 播完后再次触发完成。
- 残差：真机每跨一轮约晚一帧（L5 两轮后真机 16.6、模拟器 23.3，Kill 值 96.2 对 103.3）。已由 TWSEM v1 逐帧确认为“边界帧保持终值、丢弃溢出”并修复，见上节；固定 1/60 步长下模拟器基线不产生溢出，与变步长真机的采样值仍会有同量级差异。单个相对 Tween 自身循环是否累加未测，维持原实现。
- Invoke（`src/runtime.js` `luaInvoke`）：同一 Lua state 内直接在栈上传参与返回值，保持 userdata/table 身份、多返回值与错误；调用其他脚本（另一 Lua state）仍经 JS 值转换，跨脚本身份未经真机验证。`typeof` 对 Tween/TweenSequence/ServerSignal 返回同名；桥接对序列与信号不再展开为普通表。
- 自包含回归：`test/runtime.test.mjs` 末两项，修复前 2 项均失败，修复后全套 `pnpm test` 通过。探针重跑结果 `simulator-baseline.log` 与真机语义一致，修复前日志保留为 `simulator-baseline-before-fix.log`。

## 默认动态实例层序（2026-09-28）

- 采用规则：同一父控件下，后实例化的根默认在已有兄弟上方；显式 First/Last/Index 可随后覆盖默认顺序。用户要求将该规则写成测试并修复模拟器。原问题报告称真机默认后创建在上，属于 `provided_unverified / device`；本轮截图无法读取，聊天中的点击日志只证实 08/09 的 A/B 可收到事件，不足以单独证明重叠区颜色或命中优先级。先前“九格截图已通过”的判读已撤回，完整工作区证据记录见 `probes/sibling-order-20260928/device-20260928.md`。本次实现依据是用户采纳的兼容性规则，并非新增官方文档声明。
- 修复范围：`src/runtime.js` 的 `instantiate` 在 `parent.addChild` 后调用新根的 `SetAsLastSibling()`，随后才挂载模板脚本。复用已有索引映射与 dirty 通知，既让模板 OnStart 看到默认顶层，又允许它主动置底。公共 parent setter、模板内部数组、静态 Authoring、GIA wire、渲染器遍历及 `SimulateCursorClick` 不在此处修改。
- 自包含回归：`test/instantiate-order.test.mjs` 通过真实 Lua 创建两个带脚本的实例，验证已有静态兄弟、模板内部顺序、子脚本身份及模板 OnStart 主动置底。Studio 的 `test/sibling-order.test.mjs` 增加 A/B 交换创建、PNG 独占区/重叠区、后续帧创建的场景增量与 Pixi 容器排序、显式排序、按钮/光标区的坐标命中、父组边界。输入相关期望用于验证模拟器绘制/命中一致性，不能冒充真机重叠点击证明。
- 红/绿验证：修复前定向 13 项中 8 失败、5 通过；修复后 13/13。包含新增 9 项与原有 4 项。`evidence_source=observed`，运行端 `simulator`；真机图层/重叠命中独立复核仍为 `device_status=pending`。

## 字号整数校验（2026-09-27）

- 来源：用户在聊天中提供的七圣真机日志（原始文件待补，具体客户端版本未提供），`previous=RUNNING phase=mulligan`，报 `bad argument #2 to 'fontSize' (integer expected, got number)`，调用链为 `src/ui:94 → badge → artCard → setupScreen`。该调用计算字号 `38 * .62 = 23.56`。此拒绝行为为 `evidence_source=observed`、运行端 `device`、原故障 `device_status=failed`；它不能证明完整游戏已运行通过。
- 文档依据：工作区本地《Lua客户端UI脚本API》对文本框与文本视窗的 `fontSize`、`minimumFontSize` 均声明为 `integer`（`evidence_source=documented`，来源 `official_document` 本地快照，非本轮在线核验）。
- 模拟器在 Lua 控件可写字段赋值处校验这两个字段，仅接受整数数值，拒绝小数、非有限值和非数字，拒绝后不改变旧值。原字段访问权限错误保留。此修复覆盖直接赋值；不外推为 Tween 内部插值、所有控件字段或字号范围已对齐。
- `20.0` 等整数数值浮点输入仍允许，是模拟器策略；本次日志不确定真机是否按 Lua 数字子类型区分这类输入。未猜测额外的字号上下限，也未自动四舍五入脚本传入值。
- 自包含回归：`test/font-size.test.mjs`，涵盖两种文本控件、两个字号字段、原始小数输入、无效类型、拒绝后值不变，以及布局尺寸仍可为小数。模拟器测试不等同于游戏的真机修复验收。
