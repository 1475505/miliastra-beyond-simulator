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
14. `ClientUIImageControl.imageType`：创作者确认只有部分图片支持设置。已观察：对一组刚 Instantiate 出的图片赋值报 `cannot set imageType, no such field`。在能力判定条件通过 probe/GIA 明确前，模拟器保守跟该拒绝路径，不全局开放。
15. Lua 表面只开放官方 API 文档列出的字段/方法。文档未写的（`script.tickEnabled`、`EnumItem.__kind`、`enableFill`、按钮四态等）读为 nil，写报 `cannot set`。
16. 控件标识字段：`Id`（客户端控件运行时ID，首字母大写）/ `prefabIndex`；Script 字段 `scriptMappingId`（GetScript 参数同名）；grid 的 `itemPrefabIndex`；reference 的 `referencedPrefabIndex`。InstantiateClientUIControl / GetClientUIControl 仅形参名变化。旧 probe 中的 `control.id` / `prefabId` 是旧版本接口，不作为兼容口径。
17. math 沙箱：按正式服探针保留 modf、ult；额外提供 isnan、isinf。文档异常行提到的 `math.isnaf` 语义无处记载——按反编造政策不提供（读为 nil）。
18. Runtime capability fidelity: load/loadfile/dofile/package/coroutine/collectgarbage、string.dump/pack/unpack 按客户端裁剪；字符串方法语法保留，但全局 getmetatable 对字符串隐藏。普通 Lua 表的 typeof 返回 table，挂载脚本的 script.path 暴露短名。Fengari 的整数仍是 32 位，这是已知的底层限制，不能作为客户端整数结论。
19. `game` 全局函数按当前 API 用点号调用。2026-09-25 日记脚本真机回传 `game:GetClientUIRoots()` 的 `bad argument count ... (0 expected, got 1)`；模拟器现核对固定参数个数。该脚本的 `game:GetUICanvasSize()` 也应改为点号。旧 Probe5 的 `game.GetClientUIRoots()` 返回空表，故日记脚本从已挂载的 `script.object` 查找 `STAGE`；修正包只有模拟器验证，真机待验。

后续版本的同级控件按键派发顺序另见[架构中的模拟器策略](architecture.md#模拟器策略非官方证明)。创作者预告上层控件优先接收；这不是上述真机探针已观察到的顺序结论。
