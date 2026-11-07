# simulator/studio

Authoring JSON、GIA、四平台布局、试玩编排、日志、回放与断言的共享核心。Lua VM 由 [Runtime](../client/lua-runtime/README.md) 实现，变量/信号由 [Server](../server/README.md) 实现；MCP、Web、DSH 复用本模块。

上级：[项目文档树](../README.md#文档树)。

## 专题树

- **控件与渲染**
  - [控件支持矩阵](docs/control-support.md)：11 类控件、文字、旋转、遮罩、滚动及保真边界。
  - [浏览器输入](docs/browser-input.md)：键鼠映射、输入队列与焦点释放。
  - 素材：[图片](docs/image-assets.md) · [音频](docs/audio-assets.md) · [界面／全屏动效](docs/ui-vfx-playback.md)。
- **GIA 与脚本交付**
  - [客户端模板层序](docs/client-template-order.md)：wire 方向与导入索引校准。
  - [部分导出](docs/partial-export.md)：子树、依赖、预览和导出协议。
  - [Lua 索引同步](docs/control-guid-sync.md)：变更映射、文本替换和备份。
  - [实机脚本同步](docs/script-sync.md)：目录绑定、差异计划与复制。

界面集成、语言和字体由 [共用编辑器](../editor-ui/README.md) 管理；MCP 时钟和协议由 [MCP](../mcp/README.md) 管理。

## 实现与验证入口

| 位置 | 职责 |
|---|---|
| `ui/`、`gia/` | 存档、属性、布局、校验和编解码 |
| `host/` | Controller、工作区边界、持久 Worker、资源缓存 |
| `host/quick-start-source.js` | Web/DSH 共用教学示例下载、格式校验及路径清理；流程见 [快速上手](../web/README.md#快速上手) |
| `play/session.js`、`play/compile.js` | Authoring → Runtime、输入及运行快照 |
| `play/pixi-renderer.js`、`play/browser-session.js` | Web/DSH 共用增量渲染与浏览器循环 |
| `host-png.js` | 无浏览器的编辑器/试玩 PNG |
| `log/`、`autotest/` | 日志、录制回放与断言 |

在仓库根运行 `pnpm --filter qxqy-studio test`；全仓及浏览器检查见 [验证规则](../AGENTS.md#验证)。一次性无头任务可用 `node studio/cli.mjs --in job.json --out out.json`。

## 存档保存与导入

`host/controller.js` 统一维护存档路径、磁盘哈希和已保存内容。编辑器 `save` 与 `script-sync/save` 共用 `saveArchiveChecked(path, expectedRevision)`：校验编辑版本；已有目标须为本会话关联文件且哈希匹配。成功保存/另存更新关联，省略路径沿用最近成功加载或保存的文件；新工程必须指定路径。

`importData()` 在副本完成验证后提交，成功时解除文件关联、清除脚本复制计划/回执与索引同步计划；`loadArchive()` 成功后再关联加载文件。失败导入保留工程及关联。Web 休眠恢复同一份 Controller 保存状态，见 [Web 会话](../web/README.md#编辑与保存)。底层 `saveArchive()` 仍是直接写盘接口，MCP `qxqy_project_save` 使用该接口，其覆盖行为不等同于带 revision 的编辑器保存。

回归：`test/controller-archive.test.mjs` 验证混合入口、另存、冲突和导入关联；`test/script-sync.test.mjs` 验证计划失效，`web/test/editor.test.mjs` 验证 HTTP 与休眠恢复。

## JSON 画布布局与 GIA 平台槽

只保存四平台 `transformByPlatform`，五种画布从平台参数派生视口。完整存档为 version 4，资产为 `layoutSchemaVersion: 2`；编辑 revision 独立。读取支持 version 1–4，未知未来版本和缺损的新版平台数据拒绝。

旧存档入口迁移规则：已有平台值优先；缺少键鼠/触屏值时取同设备 16:9 画布，再按预设顺序取其他画布；手柄缺值继承对应键鼠/触屏值；完全无来源才用默认值。冲突和补缺通过 `migrationWarnings` 返回。迁移复制输入并移除旧画布表，不自动改写磁盘；五套旧布局不能保证无损转为四平台。

同步关闭只写当前平台；开启时按各平台自身父矩形投影到其余平台。切换宽高比不写参数。GIA 向量已存在时，省略的标量表示 0；只有整向量缺失才采用默认值。

`test/platform-layout.test.mjs` 覆盖迁移、幂等、四平台/五视口、零分量与失败原子性；这些检查验证模拟器布局契约，真机像素一致性未确认。

<a id="2026-09-25-日记-gia-的旋转与初始状态丢失"></a>
<a id="2026-09-25-gia-图元与初始状态"></a>
## GIA 图元与初始状态

按官方7.1.0对照样本读写 Z 旋转、初始可见性及客户端初始激活。文本垂直对齐上/下有样本，居中值1仍为授权推断，导出会提示。官方输入开关样本还覆盖常驻光标、隔离导航、穿透屏蔽、手柄聚焦与射线检测；未知原始非布尔值保留。

来源为完整工作区 `knowledge/ui/05_验证与不确定性.md` §8–9；独立字节回归见 `test/gia-observed-fields.test.mjs`、`test/gia-loss-warnings.test.mjs` 和 `web/test/gia-input-e2e.test.mjs`。单独 UI GIA 不含脚本源码，导出会提示；旧日记整合包初始化原因仍待设备日志，不能凭模拟器启动或叠页现象定因。

## 试玩场景与文字对齐

Runtime 保留 Lua `EnumItem` 身份，`play/session.js` 在 scene/paint 边界投影为枚举 `Name`，并纳入增量指纹；PNG/Pixi 消费同一表示。`test/text-alignment.test.mjs` 验证 Lua 赋值、几何、PNG 字形位置和 Pixi anchor，不证明游戏精确字形。

## 图片填充渲染边界

`play/image-fill.js` 统一水平/垂直矩形裁切；scene/paint 投影方向与进度，更新参与渲染缓存。0不画、1完整、Unused取消；只裁图片自身，子控件独立。径向填充未实现；超范围有限进度截到可见范围是模拟器策略。素材限制见 [图片说明](docs/image-assets.md)。

回归：`test/image-fill.test.mjs`，覆盖固定象限像素、Pixi mask bounds、父旋转与子控件。

## 浏览器图形缓存

<a id="试玩轮询与增量更新2026-11-07"></a>
### 试玩轮询与增量更新

`play/browser-session.js` 只保留一个在途场景请求，将请求、渲染和快照回调耗时计入本帧预算，再按剩余时间安排下一次观察。超时帧完成后尽快继续，不补排历史帧；输入触发的刷新共用调度、合并为一次后续观察。停止取消后续调度，旧 generation 的结果不能覆盖新会话。Lua 的固定步长时钟仍由 Worker 管理，界面选择60 FPS不保证浏览器每秒实际显示60帧。

`play/session.js` 的 `tree-v1` revision 只随场景实际变化推进；每个查看端传自己的 `sceneRev`，静止场景返回同版本空增量。缓存只存当前节点及有界变更 ID 历史（最多120次变更、累计10,000个ID），跨版本合并为当前 `changed` / `removed`。首次、过旧/未来版本或切换玩家返回完整 `reset`。浏览器同时传 `sceneSessionId`（快照中的 `audio.sessionId` 标识整局试玩），Worker 重建后标识不匹配即重置，避免跨局同号；只传 revision 的调用者须在新局主动读取完整场景。响应与缓存隔离，多个查看端互不消耗增量。

`compact` 先截取客户端日志、操作历史和服务端信号/日志尾部各100条，再复制输出；普通快照及历史接口仍可读取完整记录。它限制观察成本，不删除存储历史。服务端提供 `snapshot({ historyLimit })`，默认完整、0返回空历史。

`play/pixi-renderer.js` 的视窗裁剪按变动节点及其裁剪依赖更新，不逐帧扫描整棵美术树；父尺寸变化、换父、删除、取消裁剪和扁平回退同步维护依赖。Web预览仅在画布尺寸或容器尺寸变化时重新计算CSS视口，避免每帧读取布局。

回归：`test/play-snapshot.test.mjs` 验证多查看端、历史预算和截取前不复制；调度见 `test/browser-session.test.mjs`，裁剪复用见 `test/pixi-cache.test.mjs`，浏览器视口见 `web/test/key-input-browser.test.mjs`。性能对照保存在完整工作区 `probes/browser-play-performance-20261107/`：观察的是画面提交率，受传输链路和图形后端影响，不等于显示器呈现帧率；初始化和大组恢复仍可能有尖峰。

<a id="2026-10-18-高频文字更新与缓存残留16"></a>
### 文字更新与资源释放

普通 HUD 原位更新 Text；只有尺寸、底色、裁切等几何变化才重建视觉对象。销毁释放自有 TextStyle，沿 Pixi 引用计数回收纹理，仅清除已失效文字键；不能递归销毁共享图片或池化纹理。

回归入口为 `test/pixi-cache.test.mjs` 与 `web/test/text-churn-browser.test.mjs`，验证文字更新资源复用、隐藏恢复与跨局释放。[#16](https://github.com/1475505/miliastra-beyond-simulator/issues/16) 的 macOS 原工程、能耗与报告者纹理未释放路径未复现。

清理依赖锁定的 Pixi8.20 内部表，升级时运行上述浏览器回归。

<a id="2026-09-09-复发后的圆形绘制修复"></a>
<a id="2026-09-24-非正方形图元尺寸一致性"></a>
### 圆形纹理与图元尺寸

无填充圆形使用分辨率分档共享纹理/Sprite；删除实例不销毁共享纹理，Graphics 形状与遮罩释放自有 context。圆形/圆环按控件宽高分别生成椭圆，而非 `min(宽,高)` 正圆；填充圆形及圆环使用 ellipse。这是代理图元策略，不推定官方素材拉伸语义；历史黑三角的底层 GPU 触发条件未唯一定位。

回归：`test/pixi-circle.test.mjs`、`test/pixi-cache.test.mjs`、`test/primitive-stretch.test.mjs`，覆盖资源释放、非正方形双轴尺寸及旋转。浏览器渲染检查为 `observed / simulator / not_required`；更新后须重建实际使用的 Web/DSH 宿主、重启并刷新页面，重开 Lua 游戏不会替换渲染代码。

<a id="2026-10-11-客户端资产编号修复"></a>
## 客户端资产编号

`Info.index` 是资产登记编号，与控件GUID、类型和层序不同。`gia/asset-indices.js` 为新模板根和子控件登记持久 `giaInfoIndex`，`meta.giaNextAssetIndex` 保存高水位；排序、换父级、删除不重编号或复用。无现存编号时从2开始，1留给服务端组，这是模拟器分配策略。

- 旧JSON先保留合法编号，再一次性补缺。无创建历史时按保存树序登记，保留GUID、Lua和属性。
- 未标编号格式版本，且满足独立根共号、每种类型单号、编号组类型一致、无authoring新身份时，才识别旧类型兜底模式。保留每组第一份，从高水位且不低于13补号；保存 `giaAssetIndexSchemaVersion=1` 后不重复迁移。
- 原生模板/子实例合法共号保留；歧义来源不猜改，当前authoring错误不按旧数据迁移。独立和整合导出均校验模板森林、新资产身份和独立根共号。

证据：2026-10-11 用户确认编号补丁恢复官方编辑器属性面板，见完整工作区 `knowledge/ui/05_验证与不确定性.md` §13。`test/gia-asset-indices.test.mjs` 用独立合成 wire 覆盖新增、高水位、原生共号、旧类型迁移与原子性，不等于所有新导出包均经真机回验。层序与批量 GUID 校准见 [客户端模板层序](docs/client-template-order.md)。
