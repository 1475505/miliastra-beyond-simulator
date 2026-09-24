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

## JSON 画布布局与 GIA 平台槽

当前只保存四平台 `transformByPlatform`。五种画布仅提供视口尺寸，预览、检视器、试玩和 GIA 使用同一份平台参数。完整存档保存为 version 4，资产保存为 `layoutSchemaVersion: 2`（与编辑 revision 分开）。读取入口支持 version 1–4；未标注布局版本或布局版本 1 的资产自动迁移，新版资产仍严格校验四平台完整性，未知未来版本拒绝。GIA 导入直接生成新版模型。

迁移为模拟器兼容策略：已有平台参数优先；缺失的键鼠/触屏参数取对应 16:9 画布，缺少标准画布时按预设顺序取同设备其他画布的锚点与尺寸；缺失手柄平台继承对应键鼠/触屏参数。没有任何来源才使用控件默认值。画布冲突、非标准来源及默认值使用均返回提示，导入界面显示实际提示，启动读取的提示放在快照 `migrationWarnings`。迁移复制输入并移除旧画布表，不改写原文件；后续预览/编辑/导出只读平台参数。五套互相独立的旧布局无法无损编码为四平台，因此冲突保留原输入供核对，不承诺所有旧视口外观同时不变。

2026-09-24 排查 `diary2.save.json` → `测试的· 整合包.gia`：服务端树 37 个节点的 `transformByPlatform` 均为空，实际布局在 `transformByCanvas`。导入时 `createNode` 为缺失平台槽填入控件默认值，预览读取画布布局而 GIA 读取平台布局，造成 STAGE 的 1280×720 导出为 150×150，子控件尺寸和偏移也被默认值替代。以原 JSON 重导出，修复前全部 37 个节点的平台变换与问题 GIA 一致。

最初采用“缺失平台槽从标准画布补齐”的运行时局部修复；该方案已由四平台唯一来源及入口迁移替代（`superseded_by=四平台唯一来源及入口迁移`）。原始日记旧格式现在可以直接导入，STAGE 在迁移及 GIA 往返后均为 1280×720。同步关闭仅写当前平台；同步开启将修改投影到另外三个平台，使用各平台自身父矩形。切换宽高比不写入参数，同平台共享锚点布局。

自动迁移回归：`test/platform-layout.test.mjs` 覆盖 version 1–3、旧单资产和包装项目输入、冲突及缺失提示、输入不变、再次读取幂等、GIA 尺寸保留、新版严格验证。Windows / Node 22.23.2 下聚焦测试 10/10、全仓测试通过；这属于模拟器观察，未增加真机证据。[研究稿](layout-authority-plan.md) 保留历史方案，当前策略以本节和源码为准。

证据：2026-09-24，Windows / Node 22.23.2，`evidence_source=observed`，运行端 `simulator`，`device_status=pending`（新版 GIA 尚未真机导入）。自包含回归 `test/platform-layout.test.mjs` 覆盖四平台独立值、五视口 × 同步开关 × 独立/整合 GIA 往返、独立手柄父矩形、失败导入及编辑不部分提交、读取不改变数据和零分量保留；相关布局测试 52/52，`pnpm install --frozen-lockfile`、根 `pnpm test` 通过。位置/尺寸含固定几何断言；GIA 编解码往返只证明模拟器支持字段的一致性，不代表真机像素一致。

新增回归还暴露了 `gia/codec.js` 的零值问题：protobuf 已存在向量中省略的标量分量表示 0，旧实现把 pivot.x=0 读为 0.5、scale 的 0 分量读为 1。现区分整个向量缺失与向量分量缺失，左上锚点的 240×60 控件不再在 GIA 往返后横移 120。整向量缺失的原有默认策略保持不变。

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

修复直接绕开可变半径的圆形 Graphics 网格：无填充裁切的圆形图片使用按分辨率分档共享的白色圆形纹理和四顶点 Sprite；尺寸、颜色、透明度及位置变化只更新 Sprite。该版本按较小宽高取圆直径；2026-09-24 已修正为分别按宽高缩放，详见下节。纹理由渲染器统一持有、销毁，单个圆形删除不影响其他实例；水平/垂直填充继续使用已有 Graphics 和局部遮罩。同时补齐 `clearVisual` 的 `context: true`，同步释放自有形状及遮罩几何，避免尺寸/颜色动画的旧 context 留到定时 GC。释放断言修复前失败、修复后通过。

回归证据：[`test/pixi-circle.test.mjs`](test/pixi-circle.test.mjs) 验证圆内不透明/圆外透明、0→1→20→60→50尺寸变化、非正方形尺寸、色彩/透明度、共享纹理、删除及跨分辨率分档；[`test/pixi-cache.test.mjs`](test/pixi-cache.test.mjs) 验证自有形状/遮罩释放。Windows / Node 22.23.2 / Pixi 8.20.0 下 Studio 100/100、Web 2/2、DSH 28/28通过。真实浏览器运行400帧缩放与删除重用，在21个检查点对圆形外部像素断言；相同现场输入按1、2、3、5、10帧间隔生成五种增量序列，实际浏览器输出均有两颗棋子、尖角区域黑色像素为0。证据保存在本地 `workspace/topo5/records/web-stone-spike-20260909/` 的 `pixel-check.json`、`stress-fixed.json`、`stride-*.png`，生成/检查工具位于该项目 `tools/`。这些是轮廓与症状区域的像素检查，不要求浏览器与原生PNG抗锯齿逐像素相同。

现场接入：Web/DSH渲染包已重建；原Web页加载新版后保留“第1/2条、第3/5颗”和58个棋子图元（两颗分层棋子），画面恢复圆形，Worker继续运行且Lua error为0。`evidence_source=observed`，运行端 `simulator`，`device_status=not_required`。本条关闭此次浏览器圆形显示故障；底层Graphics不稳定复现条件仍未独立定因，后续若其他Graphics形状出现同类异常，应继续收集其GPU证据。本轮不改变Lua/GIA，也没有新增千星真机结论。

### 2026-09-24 非正方形图元尺寸一致性

旧实现的图片代理 `100002` 圆形和 `100006` 圆环在 Pixi 试玩与 PNG 中使用 `min(宽, 高)` 生成正圆，而编辑画布通过百分比圆角在 340×60 控件上显示椭圆。可追溯到 2026-09-05 提交 `6e32354`，9 月 22 日的 Sprite 路径沿用了较短边直径，与本次四平台布局迁移无关。现统一按控件宽、高分别绘制椭圆及椭圆环：无填充圆形保留共享圆形纹理 Sprite 并分别设置两轴尺寸，有填充圆形和圆环走 Pixi ellipse，PNG 使用 Canvas ellipse。父级变换、颜色、透明度与填充遮罩路径保留。编辑画布的矩形、三角形、四角星、五角星与 Pixi/PNG 都按宽高分别生成外框或顶点，未发现相同的较短边截断。这里是模拟器代理图元的内部一致性修复，不宣称官方素材的拉伸规则已由真机核实。

回归：`test/pixi-circle.test.mjs` 断言 340×60 的 Sprite 双轴尺寸、填充圆形及圆环的 Pixi ellipse 半轴；`test/primitive-stretch.test.mjs` 对 PNG 的椭圆/椭圆环像素、旋转后的椭圆/矩形以及另外四种代理图元进行独立坐标检查。`evidence_source=observed`，运行端 `simulator`，`device_status=not_required`；真机素材行为仍待原生观察。

## GIA rotation, visibility and vertical alignment

GIA import/export preserves Z rotation in `RectTransform.field508` and initial client visibility in `Details.field14.field17`. Export also saves the current script and logic drafts before creating the file.

Official 7.1.0 sample bytes confirm Z angles 0/30/90, hidden image/container state, and `TextConfig.509` values Top=0 and Bottom=2. Middle=1 is inferred with user authorization and retains an export warning pending device validation. `studio/test/gia-observed-fields.test.mjs` uses independent synthetic wire fixtures; simulator round trips do not establish device correctness.
