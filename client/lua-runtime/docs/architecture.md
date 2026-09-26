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
| `imageType` | 文档标读写。已观察 Instantiate 后赋值被拒；脚本默认不写；模拟器读 nil、写报同一错误 |
| 同级绘制 / 命中 | 内部树列表先出现的在上；Lua sibling 数值越大越靠上，在 API 边界反向映射，First 置底、Last 置顶；图片不把指针传给子级光标区 |
| `GetChild` | 仅直接子节点 |
| Invoke | 同步调用并返回值 |
| 画布（PC） | 默认 1600×900（探针约此值） |
| id | Lua integer |

## 模拟器策略（非官方证明）

- 非 Linear 的 Ease：Penner 公式。
- 旋转后命中：不做精确旋转盒。
- `return false` 的按键穿透：当前仅 `true` 中断链。
- `game` 全局函数的参数个数：Lua 桥接按当前 API 签名逐项核对，冒号调用产生的隐式 `game` 实参会报错。真机已确认 `GetClientUIRoots()` 的零参数约束；其他函数的统一检查是模拟器防错策略。
- 按键跨控件派发：创作者预告后续版本同层级上层控件先接收事件。模拟器按当前 `children[]` 的前到后层序派发；同一根容器内回调返回 `true` 后停止后续派发。前半是待版更规则，后半是依据现有 API 文案的模拟器策略；新版真机尚未验证。父子层级和不同容器的官方顺序仍未确定。
- 网格视窗方法：调用即抛错。
- `GetText`：原样返回 id。
- `GetLanguageType`：未传入时默认 `LanguageChs`。DSH / Web / MCP 试玩启动时读取本机「原神」`output_log.txt` 最近一次 `Request to set language`，映射到 `LanguageType` 的 Name；读不到或无法映射则仍用默认。这不是真机契约。
- 整数宽度：Fengari 32-bit；现有 id 均在范围内。
- Lua 表面只开放官方 API 文档列出的字段/方法。Authoring 内部字段（`enableFill`、按钮四态、网格 cellSize 等）不进 userdata。

## 模块值与环境实现

每个挂载脚本拥有一台 Lua VM；其 require 模块在同一 VM 中用独立 `_ENV` 执行。模块环境从挂载代码执行前的沙箱/宿主全局表复制，`_G` 指向模块自身，`script` 是该模块的独立身份；不会执行模块 OnInit/OnStart。模块导出值直接放入所属 VM 的 registry，路径别名共用缓存；不得经 `toJs` / `pushValue` 往返，否则循环表、metatable、函数 upvalue 与线程会损坏。嵌套 require 和测试启用的 coroutine 使用主线程 registry 中的同一缓存。卸载挂载脚本时一起释放缓存和环境。

### 2026-09-08 require 原生值回归

- 症状与追因：含 `Counter.__index = Counter` / `Counter.self = Counter` 的类模块曾触发 stack overflow；即使无循环，跨 VM 的 `toJs` / `pushValue` 重建也不能保留 Lua metatable、闭包 upvalue 和嵌套模块表身份。修复位置为 [`src/runtime.js`](../src/runtime.js) 的模块加载、按主线程归属的 registry 缓存及卸载清理。
- 最小输入与独立预期：模块返回自引用的 `Counter`，`new(4)` 创建 metatable 为 `Counter` 的实例，`one:add(3)` 返回 `7, one`，闭包计数连续返回 `1, 2`。恒等式由夹具直接写定，另一个模块和路径别名 require 的结果必须与同一 VM 中已加载模块相等；不以生产游戏输出作为预期值。
- 回归证据：[`test/require-native.test.mjs`](../test/require-native.test.mjs) 共 4 项，覆盖上述原生值、独立 `_ENV` / `script`、不同挂载 VM 的缓存隔离、失败后重试、循环加载报错和销毁清理。2026-09-08 在 Windows x64 / Node.js 22.23.2 / Fengari 0.1.5 本地运行 `node --test client/lua-runtime/test/require-native.test.mjs`（模拟器仓库根）4/4 通过；`evidence_source=observed`，运行端 `simulator`，`device_status=not_required`（本条只关闭模拟器实现缺陷）。
- 未覆盖范围：循环 require 报 `cyclic require` 是模拟器策略；标准库/宿主库表在同一 VM 中共用是实现边界。第 4 项单独恢复测试 VM 的 coroutine 库，只验证续体与 registry 身份；生产沙箱仍裁剪 coroutine。本次没有新增真机观察，也不将测试中的扩展库认定为千星可用能力。

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
