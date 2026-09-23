# simulator/studio

服务端控件模板 / 客户端控件模板 Authoring JSON、双根结构 GIA、锚点布局、五预览/四平台同步、交互试玩编排，以及试玩时间线自动测。Lua VM 的实现仍只在 `client/lua-runtime`。服务端变量/信号在 `../server/`。

`host-png.js` 是无 UI 宿主的编辑器/试玩 PNG 渲染器（截图与测试用）；`host/` 提供工作区边界、持久试玩 Worker 和通用 Controller，`play/pixi-renderer.js` 是 Web/DSH 共用的增量场景渲染器，`play/browser-session.js` 是两边共用的浏览器试玩循环。它们由 MCP、DSH 与本地 Web 适配层共同使用。

```sh
cd simulator
pnpm install --frozen-lockfile
pnpm --filter qxqy-studio test
pnpm --filter qxqy-studio generate:client-template
```

独立 CLI 仍可用于一次性无头任务：

```sh
node studio/cli.mjs --in job.json --out out.json
```

DSH 正式交付位于 `../dsh-plugin/`，编辑路径进程内，试玩使用持久 `worker_threads.Worker`。旧动态原型（`dsh-host-kernel.js`、`frontend/dsh/`）已删除，业务逻辑以本目录模块为唯一来源。

## 试玩场景与文字对齐

Runtime 控件内部保留 Lua `EnumItem` 身份；[`play/session.js`](play/session.js) 在 `paintList` / scene 输出边界把文字水平、垂直对齐统一为枚举 `Name` 字符串。Authoring 中已有的字符串保持原值。PNG 和 Pixi 消费同一场景表示，对齐变化也参与 scene fingerprint，因而只有对齐变化时仍产生增量更新。

### 2026-09-08 Lua 赋值后的居中失效

- 症状与追因：Lua 写 `Enum.TextHorizontalAlignment.Middle` / `Enum.TextVerticalAlignment.Middle` 后，Runtime 存的是枚举对象；若原样交给仅比较 `'Middle'` 等字符串的 PNG / Pixi 渲染器，就回退到左/顶部，造成文字未居中。修复只在上述场景边界取 `Name`，保留 Runtime 的枚举读回与身份语义。
- 独立依据：本地 [API 加工稿](../../knowledge/guide/Lua客户端UI脚本API.md) 的 `TextHorizontalAlignment` / `TextVerticalAlignment` 分别定义 `Middle` 为水平/垂直居中，文本控件对应字段为读写枚举；这是字段语义依据。回归夹具使用固定 240×160 画布和居中的 160×80 文本框，文字中心预期由矩形几何写定为 `(120, 80)`，没有从待测渲染器生成 golden。PNG 字形栅格与字体度量允许小范围容差。
- 回归证据：[`test/text-alignment.test.mjs`](test/text-alignment.test.mjs) 实际执行 Lua 的 Middle→Right/Bottom 赋值，检查 Runtime 读回、scene / paint 名称、仅对齐变化的增量补丁、PNG 白色字形像素范围和真实 Pixi Text 的 anchor / 位置。2026-09-08 在 Windows x64 / Node.js 22.23.2、`@napi-rs/canvas` 0.1.100 和 Pixi 8.20.0 本地运行 `node --test studio/test/text-alignment.test.mjs`（模拟器仓库根）3/3 通过；`evidence_source=observed`，运行端 `simulator`，`device_status=not_required`（本条只关闭模拟器表示转换缺陷）。
- 未覆盖范围：Pixi 回归使用其真实容器/文字对象与生产适配器，未启动浏览器 WebGL；不证明浏览器 GPU 字形栅格或千星真机像素一致。本次没有新增真机观察。

## 图片填充渲染边界

2026-09-08 已补齐 PNG / Pixi 试玩的水平与垂直填充。Runtime 保留原有正式字段与方法；[`play/session.js`](play/session.js) 的 compact paint / scene 投影 `fillType`、水平/垂直方向枚举 `Name` 和 `fillAmount`，并纳入 scene fingerprint / Pixi visual key。[`play/image-fill.js`](play/image-fill.js) 统一计算图片本地坐标中的矩形裁切：Horizontal 从 Left/Right 开始，Vertical 从 Top/Bottom 开始；0 不绘制，0.5 保留对应半边，1 完整，Unused 取消裁切。PNG 保存/恢复每项绘制状态，Pixi 只遮罩图片自身图元，不裁切其子控件；裁切随图元一起旋转/缩放。

修复前最小观察：白色圆形代理图片 `100002` 执行 `SetFillVertical(Enum.ImageFillVerticalType.Top, 0.25)`，Runtime 读回为 `Vertical / Top / 0.25` 且无 mount error，但 scene / paint 未携带 `fillAmount`，PNG 与调用 `SetFillUnused()` 后逐字节相同。原因为场景投影和两个渲染器均漏掉填充，不能据此判定千星图片不支持填充。

独立回归依据：本地 [API 加工稿](../../knowledge/guide/Lua客户端UI脚本API.md) 的水平/垂直方法、方向定义与进度字段，加上手写矩形几何预期。[`test/image-fill.test.mjs`](test/image-fill.test.mjs) 实际执行 Lua，对 240×160 画布中心的 100×80 图片检查四方向 × 0/0.5/1 的四象限固定像素和 Pixi mask bounds；另验 Unused、仅 fill 变化的补丁、枚举读回、圆形保持原半径、父节点旋转及子控件不被裁切。预期坐标不由待测裁切函数或截图生成。

证据范围：2026-09-08，Windows x64 / Node.js 22.23.2 / `@napi-rs/canvas` 0.1.100 / Pixi 8.20.0；填充定向回归 5/5、Studio `npm test` 93/93 通过。`evidence_source=observed`，运行端 `simulator`，`device_status=not_required`（本条关闭模拟器水平/垂直填充缺陷）。Pixi 使用真实 Graphics/mask 对象，未运行浏览器 GPU 像素测试；本轮没有真机验证。径向 90/180/360 填充仍未实现；超出 0–1 的有限进度按可见范围截断、缺失/非有限进度按完整代理显示，是模拟器策略。千星具体图片资产的填充条件仍需按既有证据判断，未验条件保持 `pending`。

## 浏览器图形缓存

2026-09-08，Windows / Pixi 8.20.0 的 Web 试玩回传：拓扑五子棋回廊第二条教学落下两颗棋子后，棋子向棋盘中心拉出黑色三角形。直接观察当前浏览器存在该图形；同一运行会话的完整 scene 在 PNG 中正常，浏览器收到完整 scene 重建后异常消失，棋盘和教学进度未改变。结论为 `evidence_source=observed`、运行端 `simulator`、`device_status=not_required`；不据此推断千星客户端图片能力。

检查 [`play/pixi-renderer.js`](play/pixi-renderer.js) 发现明确的缓存顺序错误：`updateNode` 先登记新 visual key，`replaceVisual → clearVisual` 随后又将它清空，尺寸/颜色变更后的后续位置更新因此反复销毁并重建同一 Graphics。现将 key 提交移至替换完成后。独立回归 [`test/pixi-cache.test.mjs`](test/pixi-cache.test.mjs) 以“外观不变的移动应保留同一几何对象，外观改变应正确更新”为依据，修复前两例均失败，修复后均通过。另增浏览器 `attach`，刷新页面时只读取完整场景接回已有 Worker，不调用 start、切换玩家或解除暂停；见 [`test/browser-session.test.mjs`](test/browser-session.test.mjs)。

Studio 全套96/96、Web全套2/2通过；原页面刷新接入后仍保留两颗棋子及“第2/2条、第3/5颗”。项目 `workspace/topo5/records/web-stone-spike/` 留存原场景、实际输入和原生对照，`tools/repro-web-stone-spike.mjs --user` 可产生去掉长时间空闲后的472帧实际输入增量序列。**黑三角的底层GPU触发条件未在这段独立序列中重现**，不能将已修正的缓存缺陷说成经独立复现证明的唯一原因，也不能把对象级回归当作GPU像素证明。完整重建已直接验证能恢复原画面；后续若复发，继续从GPU批次/生命周期收集证据，不重复检查已确认正常的Lua规则与场景几何。

### 2026-09-09 复发后的圆形绘制修复

上一条 visual key 修正未关闭黑三角问题（`superseded_by=本节`）。用户在回廊第一条教学的第3/5颗再次回传两颗棋子拉向棋盘中心；同一 Worker 的 flat paint 和 PNG 仍正常。独立重放首页→平面教学→回廊两子的338帧增量时也观察到一次相同尖角，但重复重放并不稳定。检查顶点、索引内容和绑定未形成可重复的唯一底层原因，不能把已确认的 key 错误或资源泄漏单独称为该尖角的唯一原因。

修复直接绕开可变半径的圆形 Graphics 网格：无填充裁切的圆形图片使用按分辨率分档共享的白色圆形纹理和四顶点 Sprite；尺寸、颜色、透明度及位置变化只更新 Sprite，保留较小宽高对应的圆半径和父节点变换。纹理由渲染器统一持有、销毁，单个圆形删除不影响其他实例；水平/垂直填充继续使用已有 Graphics 和局部遮罩。同时补齐 `clearVisual` 的 `context: true`，同步释放自有形状及遮罩几何，避免尺寸/颜色动画的旧 context 留到定时 GC。释放断言修复前失败、修复后通过。

回归证据：[`test/pixi-circle.test.mjs`](test/pixi-circle.test.mjs) 验证圆内不透明/圆外透明、0→1→20→60→50尺寸变化、非正方形尺寸、色彩/透明度、共享纹理、删除及跨分辨率分档；[`test/pixi-cache.test.mjs`](test/pixi-cache.test.mjs) 验证自有形状/遮罩释放。Windows / Node 22.23.2 / Pixi 8.20.0 下 Studio 100/100、Web 2/2、DSH 28/28通过。真实浏览器运行400帧缩放与删除重用，在21个检查点对圆形外部像素断言；相同现场输入按1、2、3、5、10帧间隔生成五种增量序列，实际浏览器输出均有两颗棋子、尖角区域黑色像素为0。证据保存在本地 `workspace/topo5/records/web-stone-spike-20260909/` 的 `pixel-check.json`、`stress-fixed.json`、`stride-*.png`，生成/检查工具位于该项目 `tools/`。这些是轮廓与症状区域的像素检查，不要求浏览器与原生PNG抗锯齿逐像素相同。

现场接入：Web/DSH渲染包已重建；原Web页加载新版后保留“第1/2条、第3/5颗”和58个棋子图元（两颗分层棋子），画面恢复圆形，Worker继续运行且Lua error为0。`evidence_source=observed`，运行端 `simulator`，`device_status=not_required`。本条关闭此次浏览器圆形显示故障；底层Graphics不稳定复现条件仍未独立定因，后续若其他Graphics形状出现同类异常，应继续收集其GPU证据。本轮不改变Lua/GIA，也没有新增千星真机结论。
