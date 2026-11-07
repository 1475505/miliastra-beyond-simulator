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

<a id="已观察契约真机-7050"></a>
<a id="模拟器策略非官方证明"></a>
## 契约与宿主边界

生命周期、沙箱、字段、输入、层序和 Tween 的采用规则统一维护在[运行时契约](observed-contract.md)。其中区分官方文档、不同版本的真机观察与模拟器策略，不将全部行为归为某一次真机版本。

Runtime 管理逻辑状态；宿主提供画布、输入与素材能力。像素布局、投影和命中由 Studio 负责，不能从纯 Runtime 控件树推断渲染保真度。

| 宿主能力 | 契约入口 |
|---|---|
| `canSelectImageType(id, source)`、素材边界与切片 | [图片类型](../../../studio/docs/image-assets.md#图片类型基础拉伸) |
| 网格刷新、滚动、矩形遮罩与旋转投影 | [控件支持](../../../studio/docs/control-support.md) |
| `audioDuration(id)`、逻辑音效实例与浏览器播放 | [音效与缓存](../../../studio/docs/audio-assets.md) |
| 布局平台与视口 | [Studio 布局](../../../studio/README.md#json-画布布局与-gia-平台槽) |
| Worker 手动/实时时钟与帧率 | [试玩时钟](../../../mcp/README.md#试玩时钟) |

## 模块值与环境实现

每个挂载脚本拥有一台 Lua VM；其 require 模块在同一 VM 中用独立 `_ENV` 执行。模块环境从挂载代码执行前的沙箱/宿主全局表复制，`_G` 指向模块自身，`script` 是该模块的独立身份。模块导出值直接放入所属 VM 的 registry，路径别名及嵌套 require 共用缓存；不得经 `toJs` / `pushValue` 往返，否则循环表、metatable 与函数 upvalue 会损坏。卸载挂载脚本时一起释放缓存和环境。跨脚本 VM 的身份限制见[生命周期与字段读回](observed-contract.md#tween-缓动生命周期边界与字段读回)。

<a id="2026-09-08-require-原生值回归"></a>
### require 原生值与验证边界

[`test/require-native.test.mjs`](../test/require-native.test.mjs) 用独立合成模块验证自引用表、metatable、闭包 upvalue、多返回值、独立环境、路径别名及嵌套身份，并覆盖挂载 VM 缓存隔离、失败后重试和销毁。循环 require 报 `cyclic require` 是模拟器策略；同一 VM 内的标准库/宿主库表共用。检查属于 `observed / simulator / not_required`。

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

在本包运行 `npm test`，或在仓库根运行 `pnpm --filter qxqy-lua-runtime test`，执行 `test/*.test.mjs`。用例采用仓库内合成脚本与控件树，不依赖外部游戏工程；专项回归入口见运行时契约。
