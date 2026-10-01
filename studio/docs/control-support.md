# 客户端控件支持状态与基础滚动

检查日期：2026-10-02。范围是当前源码中的编辑、Lua 运行时和 Web/DSH/PNG 试玩；下表的“可用”不代表千星真机已验证。11 类控件均可创建、配置公共变换、保存 JSON，并按已知子集交换 GIA。编辑器可创建、Lua 字段可读写和试玩实际有效是三个不同层次。

## 支持矩阵

| 控件 | 当前可用 | 主要缺口 |
|---|---|---|
| 容器节点 | 层级、锚点、位置/缩放/Z 旋转、显隐/激活、脚本挂载、子控件查询、动态实例与 sibling 排序；`showCursor` 参与光标回调门控 | 导航隔离、按键/点击穿透屏蔽字段可保存/读写，但没有完整对应行为；手柄导航不完整 |
| 文本框 | 文本、字号/颜色/背景/描边、横纵对齐、裁切、Lua 更新；浏览器自动换行 | 自适应字号未生效；普通文本框 PNG 只按显式换行分行，尚未与浏览器自动换行统一；富文本未实现 |
| 图片 | 100001–100006 六类代理图元、颜色/透明度、独立宽高拉伸、Z 旋转、水平/垂直进度填充 | 非代理图片资源缺图；径向填充、图片遮罩/反转、羽化和 X/Y 旋转显示未实现；这些字段不等于视觉支持 |
| 预设按钮 | 点击、悬停、按下、选中、不可用状态；直接子控件四态；射线/交互开关；光标事件与按键监听 | 官方皮肤/音效未播放；完整手柄导航与焦点外观未实现 |
| 光标检测区域 | 射线命中、进入/离开、按下/抬起/点击、拖拽生命周期、坐标/位移；祖先 `showCursor` 门控 | 单活动指针策略，未完整模拟多点触控；与真机的复杂穿透规则不完全一致 |
| 文本视窗 | 文本显示、统一分行、纵向滚轮/拖动/触摸、滚动条轨道点击和滑块拖动、边界限制、内容变更后重算、PNG/Pixi 输出 | 无惯性/回弹、无手柄滚动、自适应字号未实现；交互/滚动条开关 GIA 映射未核实 |
| 网格视窗 | `RefreshItems` 模板项实例化与复用；横纵向排列、AutoWrap/Fixed；滚轮/拖拽/触摸/滚动条；裁切与命中；`scrollProgress`（含 Tween）、`ScrollToItemAt`、数量/尺寸/间隔/边距/内容长度查询 | 完整实例化，未做虚拟列表；单次最多 2000 项；惯性/回弹/手柄滚动未实现；部分 GIA 配置未映射；布局、索引等采取下述模拟器策略 |
| 模板引用控件 | 公共变换、引用索引保存与读回 | 不会根据引用索引自动实例化/展开目标模板；显式 `game.InstantiateClientUIControl` 是另一条已支持能力 |
| 按键提示 | 公共变换、键鼠/手柄按键字段 | 试玩未绘制按键图标，也不随输入设备自动切换提示 |
| 界面动效 | 公共变换、动效/音效/层级字段；`PlayAnimation` / `StopAnimation` 可调用 | 两个方法仍为空操作，无资源播放、动画视觉和音效 |
| 全屏动效 | 公共变换和全屏布局、动效/音效字段 | 无全屏动效资源播放与显示 |

公共能力也有保真边界：显示布局是二维仿真，X/Y 旋转的数值读写不代表三维投影已渲染；手柄配置存取不代表导航事件/最近邻寻路已实现。字段可写但效果未实现的情况，应以上表和对应渲染实现为准。

## 基础滚动（2026-10-02）

### 使用

- **文本视窗**：在检视器填写超过视窗高度的文本，开启“允许滚动交互”，进入试玩后直接滚轮或拖动。隐藏滚动条仍可滚动。文本变短、字号或尺寸变化会重新测量并限制偏移。
- **网格视窗**：配置“列表项模板索引”、尺寸/间距/排列，在运行脚本中调用 `RefreshItems(itemCount, callback)`。编辑器“预览数量”不自动生成运行条目。只有 `RefreshItems` 管理的模板项随列表移动和裁切；静态子控件保持原位。
- **工具/回放**：沿用 `pointer`，新增 `type: "wheel"`，传 `x/y/deltaX/deltaY`。例如 `{"type":"wheel","x":600,"y":450,"deltaY":48}`。正 `deltaY` 往后滚动；横向列表优先使用 `deltaX`，没有横向量时使用 `deltaY`。`type: "cancel"` 结束当前指针事务，不产生点击。
- 编辑视图保持静态布局；滚动在试玩生效。运行偏移保存在各玩家的运行时控件上，停止/重开复位，不写回 Authoring JSON。

### 明确采用的模拟器策略

这些细节由本次“先基本可用”的需求授权，不宣称为官方行为：

1. 单活动鼠标/触点，无惯性、弹性或手柄滚动；`interactable=false` 禁止原生滚动；网格还检查 `raycastTarget`。滚动命中遵循当前显示树，遮挡在上的可交互控件不会把滚轮传给无亲缘关系的下层视窗。嵌套视窗取命中链中最近的可滚动祖先，不做到边缘后继续传递。
2. 滚动条为简单 8px 轨道、最短 18px 滑块；点击轨道把滑块中心定位到指针，拖动按轨道有效行程换算。浏览器像素/行/页滚轮单位转为画布单位，行按 16 CSS px、页按一视口。内容拖动按控件本地变换换算。
3. 文本在宿主端用本机字体测量、按字符换行，行高 `fontSize × 1.2`；溢出时从顶部开始滚动，内容不溢出时遵循垂直对齐。PNG/Pixi 使用同一份分行和偏移；Pixi 只绘制可见行附近的文字，避免长文本生成超大纹理。字体栅格仍可能不同。
4. 网格项索引 **0 起始**，非本列表项返回 `-1`；`scrollProgress` 限制在 `[0,1]`，0 为顶部/左侧，1 为底部/右侧。`ScrollToItemAt` 的 Top/Center/Bottom 在横向对应左/中/右。
5. 纵向按行填充，横向按列填充；AutoWrap 根据交叉轴空间计算项数；Fixed 使用 `layoutConstraintFixedCount`，最小 1。`padding1X/Y` 暂解释为左/上，`padding2X/Y` 为右/下；cell 最小 1，间距/边距最小 0。这一边距映射尚无真机证据。
6. `RefreshItems` 同步为全部项调用 `(control,index)` 回调，同模板项按索引复用，减少数量时销毁尾项，更换模板后重建；新项激活，模板脚本沿用已有实例化生命周期。没有可见区虚拟化，最多 2000 项；递归刷新同一网格、无效数量/模板明确报错。同步回调完成后释放自身引用。
7. 滚动过程中不额外触发列表项 Click；拖动由内建滚动消费，不同时派发列表项 Drag。滑块盖在列表项之上，输入和显示使用同一视窗裁切。

### API 依据与证据

- API 来源：完整知识工作区 `knowledge/guide/Lua客户端UI脚本API.md`，SHA256 `4A43F93F2B322BE8336FF33D9CB07B3BC3A8D4C8A931A45D18F90E4E64941BAB`，本地快照，未本轮在线核验。`ClientUITextWindowControl` 的 `interactable/showScrollBar`、网格字段及七个方法、`ScrollDirection/ScrollLayoutConstraint/ScrollAlignType` 为 documented / official_document；范围、索引起点、间距向量方向等未明之处见上方策略。
- 支持清单来自源码核对：Runtime `scene.js/runtime.js`、`studio/play/compile.js/session.js/pixi-renderer.js`、`studio/host-png.js`、`studio/ui/inspector.js`、`studio/gia/codec.js`；属于 observed / simulator，`device_status=not_required`（本次只验模拟器可用性）。官方还原程度未作验证。
- 修复前最小复现：160×80 文本视窗、字号 20、40 行文字、交互与滚动条均开启，按下→拖动 35→松开，命中/拖拽状态成立但 paint 与 PNG 完全不变；网格七方法直接抛 `not implemented`。当前相同输入改变内容偏移与画面。
- 自动回归：`studio/test/scroll.test.mjs` 使用手写几何期望（10 行 ×24 行高 −80=160 溢出、拖动 35=偏移 35；两列网格 5×30−80=70），覆盖边界、遮挡/缩放、显隐/禁用、取消、文本重排、Lua 回调/复用/定位/Tween/释放、PNG 与树形/扁平 Pixi 裁切、滚轮录制回放。`browser-session.test.mjs` 检查滚轮单位换算、多指过滤和取消；`gia-loss-warnings.test.mjs` 检查新增字段 JSON 往返和 GIA 损失提示。
- 浏览器证据：`web/test/scroll-browser.test.mjs`，Windows / Node 22.23.2 / Edge headless / SwiftShader / Pixi 8.20.0；真实浏览器鼠标滚轮、鼠标拖拽、滚动条点击、模拟触摸输入均到达 Worker 并移动两类视窗；GPU 截图检查网格内部固定色像素和视窗外裁切。单独设置 `QXQY_BROWSER` 后 2/2 通过；全仓默认测试会跳过需浏览器环境变量的用例。
- 最终检查：`pnpm install --frozen-lockfile`、`pnpm build` 成功（Web/MCP/DSH 三端）；根 `pnpm test` 279 项通过、5 项按环境跳过、0 失败；滚动浏览器用例随后单独启用 Edge 运行 2/2 通过。`git diff --check` 无差异格式错误。
- GIA：此次开放的视窗交互/滚动条、列表模板、方向/排列字段只保证 JSON/Lua。未核实 wire 映射不猜写；导出有对应改动时返回明确提示。已有已知尺寸/间距与文本字段继续沿用原编解码。

### 实现入口

| 路径 | 职责 |
|---|---|
| `client/lua-runtime/src/grid.js`、`scene.js`、`runtime.js` | 网格 API、条目生命周期、布局/进度与 Lua 参数桥接 |
| `studio/play/scroll.js`、`scroll-geometry.js` | 文本测量、滚动条和裁切几何 |
| `studio/play/session.js` | 输入仲裁、运行偏移、scene/paint、命中 |
| `studio/play/browser-session.js` | 滚轮/指针/取消与 CSS→画布坐标 |
| `studio/play/pixi-renderer.js`、`studio/host-png.js` | 内容偏移、滚动条和视窗裁切 |
| `studio/host/worker.js`、`studio/autotest/` | 输入透传、录制与确定性回放 |

源码更新后运行 `pnpm build`，并重启加载旧代码的 Web/MCP/Harness 宿主；已有浏览器页需刷新、重新开始试玩。只构建不会替运行中的进程重新加载模块。
