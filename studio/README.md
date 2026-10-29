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
| `play/session.js`、`play/compile.js` | Authoring → Runtime、输入及运行快照 |
| `play/pixi-renderer.js`、`play/browser-session.js` | Web/DSH 共用增量渲染与浏览器循环 |
| `host-png.js` | 无浏览器的编辑器/试玩 PNG |
| `log/`、`autotest/` | 日志、录制回放与断言 |

在仓库根运行 `pnpm --filter qxqy-studio test`；全仓及浏览器检查见 [验证规则](../AGENTS.md#验证)。一次性无头任务可用 `node studio/cli.mjs --in job.json --out out.json`。

## JSON 画布布局与 GIA 平台槽

只保存四平台 `transformByPlatform`，五种画布从平台参数派生视口。完整存档为 version 4，资产为 `layoutSchemaVersion: 2`；编辑 revision 独立。读取支持 version 1–4，未知未来版本和缺损的新版平台数据拒绝。

旧存档入口迁移规则：已有平台值优先；缺少键鼠/触屏值时取同设备 16:9 画布，再按预设顺序取其他画布；手柄缺值继承对应键鼠/触屏值；完全无来源才用默认值。冲突和补缺通过 `migrationWarnings` 返回。迁移复制输入并移除旧画布表，不自动改写磁盘；五套旧布局不能保证无损转为四平台。

同步关闭只写当前平台；开启时按各平台自身父矩形投影到其余平台。切换宽高比不写参数。GIA 向量已存在时，省略的标量表示 0；只有整向量缺失才采用默认值。

来源：2026-09-24 Windows / Node 22.23.2 的日记存档复现中，37 个节点的平台槽为空，旧双表造成 STAGE 从1280×720导出为150×150。当前入口迁移取代该局部补槽方案（`superseded_by=四平台唯一来源及入口迁移`）。`test/platform-layout.test.mjs` 覆盖迁移、幂等、四平台/五视口、零分量与失败原子性；`observed / simulator`，新版包真机像素一致性 `pending`。

<a id="2026-09-25-日记-gia-的旋转与初始状态丢失"></a>
## 2026-09-25 GIA 图元与初始状态

按官方7.1.0对照样本读写 Z 旋转、初始可见性及客户端初始激活。文本垂直对齐上/下有样本，居中值1仍为授权推断，导出会提示。官方输入开关样本还覆盖常驻光标、隔离导航、穿透屏蔽、手柄聚焦与射线检测；未知原始非布尔值保留。

来源为完整工作区 `knowledge/ui/05_验证与不确定性.md` §8–9；独立字节回归见 `test/gia-observed-fields.test.mjs`、`test/gia-loss-warnings.test.mjs` 和 `web/test/gia-input-e2e.test.mjs`。单独 UI GIA 不含脚本源码，导出会提示；旧日记整合包初始化原因仍待设备日志，不能凭模拟器启动或叠页现象定因。

## 试玩场景与文字对齐

Runtime 保留 Lua `EnumItem` 身份，`play/session.js` 在 scene/paint 边界投影为枚举 `Name`，并纳入增量指纹。PNG/Pixi 消费同一表示。2026-09-08 的居中失效源于把枚举对象直接交给比较字符串的渲染器；`test/text-alignment.test.mjs` 用实际 Lua 赋值、固定几何、PNG 字形位置和 Pixi anchor 验证。`observed / simulator / not_required`，不证明游戏精确字形。

## 图片填充渲染边界

`play/image-fill.js` 统一水平/垂直矩形裁切；scene/paint 投影方向与进度，更新参与渲染缓存。0不画、1完整、Unused取消；只裁图片自身，子控件独立。径向填充未实现；超范围有限进度截到可见范围是模拟器策略。素材限制见 [图片说明](docs/image-assets.md)。

2026-09-08 复现中，Lua `SetFillVertical(Top, 0.25)` 读回正确而 PNG 与 Unused 相同，原因是场景和渲染器漏字段。`test/image-fill.test.mjs` 用固定象限像素、Pixi mask bounds、父旋转与子控件验证；`observed / simulator / not_required`，真机素材条件另行判断。

## 浏览器图形缓存

### 2026-10-18 高频文字更新与缓存残留（#16）

普通 HUD 原位更新 Text；只有尺寸、底色、裁切等几何变化才重建视觉对象。销毁释放自有 TextStyle，沿 Pixi 引用计数回收纹理，仅清除已失效文字键；不能递归销毁共享图片或池化纹理。

[#16](https://github.com/1475505/miliastra-beyond-simulator/issues/16) 的 Windows / Pixi8.20 / Edge合成复现中，三轮各400次改字造成失效键400/800/1200、每轮399次重建；修复后重建0、键数1、清场归零。`test/pixi-cache.test.mjs` 与 `web/test/text-churn-browser.test.mjs` 验证资源复用、隐藏恢复和跨局释放。`observed / simulator / not_required`；macOS原工程、能耗与报告者纹理未释放路径未复现。

清理依赖锁定的 Pixi8.20 内部表，升级时运行上述浏览器回归。加载修复须重启宿主并刷新页面，重开Lua游戏不会替换渲染代码。

### 2026-09-09 复发后的圆形绘制修复

Windows Web 棋子出现黑三角而同会话 PNG 正常；完整 scene 重建可恢复。最初修复 visual key 被清空的错误后仍复发，不能把它称为唯一原因（`superseded_by=共享圆形纹理与自有几何释放`）。

无填充圆形改用分辨率分档共享纹理/Sprite；删除单个实例不销毁共享纹理，Graphics形状与遮罩释放自有 context。`test/pixi-circle.test.mjs`、`test/pixi-cache.test.mjs` 保留资源与几何回归。2026-09-09 Edge 400帧及五种增量间隔的症状区域像素检查通过，证据在完整工作区 `workspace/topo5/records/web-stone-spike-20260909/`。`observed / simulator / not_required`；原Graphics的底层GPU触发条件未唯一定位。

### 2026-09-24 非正方形图元尺寸一致性

圆形/圆环按控件宽高分别生成椭圆，而非 `min(宽,高)` 正圆。无填充圆形保留共享Sprite，填充圆形及圆环使用ellipse。`test/primitive-stretch.test.mjs` 和 `test/pixi-circle.test.mjs` 核对340×60双轴尺寸、旋转及其他代理图元；`observed / simulator / not_required`，不推定官方素材拉伸语义。

## 2026-10-11 客户端资产编号修复

`Info.index` 是资产登记编号，与控件GUID、类型和层序不同。`gia/asset-indices.js` 为新模板根和子控件登记持久 `giaInfoIndex`，`meta.giaNextAssetIndex` 保存高水位；排序、换父级、删除不重编号或复用。无现存编号时从2开始，1留给服务端组，这是模拟器分配策略。

- 旧JSON先保留合法编号，再一次性补缺。无创建历史时按保存树序登记，保留GUID、Lua和属性。
- 未标编号格式版本，且满足独立根共号、每种类型单号、编号组类型一致、无authoring新身份时，才识别旧类型兜底模式。保留每组第一份，从高水位且不低于13补号；保存 `giaAssetIndexSchemaVersion=1` 后不重复迁移。
- 原生模板/子实例合法共号保留；歧义来源不猜改，当前authoring错误不按旧数据迁移。独立和整合导出均校验模板森林、新资产身份和独立根共号。

证据：2026-10-11 用户确认只改17个编号字节即可恢复官方编辑器属性面板，见完整工作区 `knowledge/ui/05_验证与不确定性.md` §13；不要求重复验证该补丁。`test/gia-asset-indices.test.mjs` 用独立合成wire覆盖新增、高水位、原生共号、旧类型迁移与原子性。自动迁移的通用覆盖属于 `observed / simulator`，不等于所有新导出包均经真机回验。层序与批量GUID校准见 [客户端模板层序](docs/client-template-order.md)。
