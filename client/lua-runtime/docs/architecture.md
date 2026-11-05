# Lua 运行时架构

包路径：`simulator/client/lua-runtime`（npm name：`qxqy-lua-runtime`）  
语言：Fengari（Lua 5.3，32-bit integer）+ 自写宿主。  
不负责 UI JSON / GIA / 编辑器 / DSH 插件壳。

## 分层

```text
LuaRuntime          时钟、日志、模板、脚本映射、信号/变量
  Lua VM (Fengari)  沙箱 + require + userdata 桥
  Control tree      控件字段/方法（无像素级布局引擎）
  Tween / Sequence  绝对默认；Linear 已对照真机
```

入口：`createRuntime(options)` → `addRoot` / `registerTemplate` / `registerScriptFile` / `mountScript` / `step` / `injectKey` / `destroy`。

`mountScript` 顺序（已观察）：执行 chunk → `OnInit` → `OnEnable` → `OnStart`。`InstantiateClientUIControl` 仅在 `OnStart`（及 running）成功，Init/Destroy 返回 nil。

## 已观察契约（真机 7.0.50）

| 项 | 结论 |
|---|---|
| `_VERSION` | nil |
| 裁剪 | 无 `io`/`package`/`loadfile`/`coroutine`/`string.dump`；保留 `utf8`、`os.time/date/clock/difftime`、`debug.traceback`、`math.isnan/isinf` |
| `require` | 映射路径 `子目录/文件名`（无 `.lua`）；`.lua` 与 `\` 归一；独立 `_ENV`；缓存；不跑生命周期；失败 `failed to load script '…'` |
| `GetParam` | 保编辑器类型；未配置为 nil |
| `typeof` | `Script`、控件类名、`EnumItem`、`CursorEventData` |
| Color | 打包整数 AARRGGBB；`Color()` / `FromRGB` / `ToRGBA` |
| Enum | userdata；`==` 比身份；有 Name/FullName/EnumType |
| Tween | 默认**绝对**；`SetRelative(true)` 增量；Linear 按时间插值 |
| 时停 | `PauseLevelTime` 停 `OnLevelUpdate`，不停 `OnUpdate` |
| 按键 | 同类型监听 `return true` 拦住后续 |
| `SimulateCursorClick` | 触发 Click；`GetUIPos` 可为 (0,0) |
| `FindChild` | `/` 路径；无斜杠也可找直接子节点 |
| 控件字段 | 按类型封死；缺字段读 nil、写 `cannot set <field>, no such field` |
| `imageType` | 文档条件读写；基础图元 Instantiate 后曾被拒。Studio 2.1.0 的白名单选择/边框绘制策略见下文，不扩大真机结论 |
| 同级绘制 / 命中 | 内部树列表先出现的在上；Lua sibling 数值越大越靠上，在 API 边界反向映射，First 置底、Last 置顶；图片不把指针传给子级光标区 |
| `GetChild` | 仅直接子节点 |
| Invoke | 同步调用并返回值 |
| 画布（PC） | 默认 1600×900（探针约此值） |
| id | Lua integer |

## 模拟器策略（非官方证明）

- 图片类型由 `canSelectImageType(id, source)` 注入选择请求的可用范围。Studio 允许白名单远程静态图片 Basic/Stretch，渲染端用缓存边界解析；图元、元件和未知来源仍不可写。接口、默认读回及 GIA 边界见 [图片类型](../../../studio/docs/image-assets.md#图片类型基础拉伸210)。

- 非 Linear 的 Ease：Penner 公式。
- 旋转后命中：不做精确旋转盒。
- `return false` 的按键穿透：当前仅 `true` 中断链。
- `game` 全局函数的参数个数：Lua 桥接按当前 API 签名逐项核对，冒号调用产生的隐式 `game` 实参会报错。真机已确认 `GetClientUIRoots()` 的零参数约束；其他函数的统一检查是模拟器防错策略。
- 按键跨控件派发：按 `children[]` 前到后的显示层序派发，同根回调返回 `true` 后停止。2026-10-24官方公开指南声明按渲染顺序优先（完整工作区 `knowledge/fact.md`）；客户端生效版本、新版真机及父子/跨容器消费边界仍未确认，同根消费按模拟器策略处理。
- 网格视窗方法：基础模板项刷新/复用、排列、进度、定位和查询已实现；采用 0 起始索引、最多 2000 个完整实例等明确策略，见 [控件支持与滚动](../../../studio/docs/control-support.md)。
- `GetText`：原样返回 id。
- 音频：`PlayAudio2D` 创建实例，`StopAudio` 停指定实例，`IsAudioAlive` 查询存活；Studio 注入目录时长，Runtime 按自身时间自然结束并输出非消费式快照，不依赖浏览器/网络。无效 ID、上限、时停等模拟策略见 [音效与缓存](../../../studio/docs/audio-assets.md)。
- `GetLanguageType`：未传入时默认 `LanguageChs`。DSH / Web / MCP 试玩启动时读取本机「原神」`output_log.txt` 最近一次 `Request to set language`，映射到 `LanguageType` 的 Name；读不到或无法映射则仍用默认。这不是真机契约。
- 整数宽度：Fengari 32-bit；现有 id 均在范围内。
- Lua 表面只开放官方 API 文档列出的字段/方法。Authoring 内部字段（`enableFill`、按钮四态、网格 cellSize 等）不进 userdata。

## 模块值与环境实现

每个挂载脚本拥有一台 Lua VM；其 require 模块在同一 VM 中用独立 `_ENV` 执行。模块环境从挂载代码执行前的沙箱/宿主全局表复制，`_G` 指向模块自身，`script` 是该模块的独立身份；不会执行模块 OnInit/OnStart。模块导出值直接放入所属 VM 的 registry，路径别名及嵌套 require 共用缓存；不得经 `toJs` / `pushValue` 往返，否则循环表、metatable 与函数 upvalue 会损坏。卸载挂载脚本时一起释放缓存和环境。

<a id="2026-09-08-require-原生值回归"></a>
### require 原生值与验证边界

- [`src/runtime.js`](../src/runtime.js) 的模块加载、主线程 registry 缓存及卸载清理必须保留自引用表、metatable、闭包 upvalue 与嵌套模块身份；不得经 JS 值重建。
- 最小输入与独立预期：模块返回自引用的 `Counter`，`new(4)` 创建 metatable 为 `Counter` 的实例，`one:add(3)` 返回 `7, one`，闭包计数连续返回 `1, 2`。恒等式由夹具直接写定，另一个模块和路径别名 require 的结果必须与同一 VM 中已加载模块相等；不以生产游戏输出作为预期值。
- 回归：[`test/require-native.test.mjs`](../test/require-native.test.mjs) 覆盖原生值、独立 `_ENV` / `script`、挂载 VM 缓存隔离、失败后重试、循环加载与销毁。证据范围为 Windows x64 / Node.js 22.23.2 / Fengari 0.1.5，`observed / simulator / not_required`。
- 边界：循环 require 报 `cyclic require` 是模拟器策略；标准库/宿主库表在同一 VM 中共用。生产沙箱裁剪 coroutine。

## 文件

| 文件 | 职责 |
|---|---|
| `src/runtime.js` | 会话、game/script、require、生命周期 |
| `src/lua-bridge.js` | Fengari 值转换、沙箱 |
| `src/scene.js` | 控件树 |
| `src/tween.js` | Tween / Sequence |
| `src/color.js` | 打包色 |
| `src/enums.js` | Enum 名表 |
| `src/ease.js` | 缓动 |

## 回归入口

本包运行 `npm test`，执行 `test/runtime.test.mjs` 和 `test/require-native.test.mjs`。用例采用仓库内合成脚本与控件树，不依赖外部游戏工程。
