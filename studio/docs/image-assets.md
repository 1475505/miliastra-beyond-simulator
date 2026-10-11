# 白名单图片与元件图标预览、缓存

## 使用

图片控件选择图片源并填入白名单 `imageId` 后，编辑器画布、Pixi 试玩和 Host PNG 截图均可显示对应素材。首次实际使用时按需下载，重启后直接读取磁盘缓存，已缓存素材可离线使用。未知来源/ID 不发网络请求，下载失败保留占位。

- **静态引用 `StaticReference`**：素材源 `https://oss.070077.xyz/images/`。`studio/assets/catalog.js` 固定了 2026-10-02 核对的 `data.json` 非空条目；1,543 个目录 ID 中 1,522 个有路径，`100001–100006` 仍走图元代理，其余 1,516 个远程 ID 请求 `sprite/<id>.png` 与 `border/<id>.json`。
- **元件 `Prefab`**：素材源 `https://oss.070077.xyz/prefabs/`。`studio/assets/prefab-catalog.js` 固定 2026-10-11 核对的 `data.json`（schemaVersion 2、dataVersion 7.1.0）。2,727 个条目中 2,720 个有图片，7 个空条目排除；仅请求 `sprite/<id>.png`，不请求 border JSON。`10003004` 与 `10008001` 为 128×128，其余为 256×256。目录明确 `rendering.imageSource=Prefab`、`idVariableType=PrefabId`；该信息属于素材提供方清单，不是新的真机证据。
- 不接受存档传入任意 URL，不在启动时下载远程清单，也不会全量下载白名单素材。更新白名单需重新核对目录并修改源文件。
- 选中远程图片，在属性面板点击 **「↻ 重新下载此素材」** 可重新请求源文件并替换缓存。刷新失败保留之前的可用文件；刷新不会扩充 ID 白名单。
- 同源编辑器与试玩页通过浏览器 storage 通知刷新；若浏览器禁用 storage，可重新打开试玩页。不同源的页面（例如另一端口或另一宿主）不会收到通知，可能继续使用其 HTTP 缓存至到期。

### 设置元件图标

编辑器选择图片控件 → **图片设置 → 图片源：元件** → `imageId` 填 `10003004`。也可在 Lua 中使用当前 API：

```lua
imageControl:SetImage(Enum.ImageSource.Prefab, 10003004)
-- 切回静态图片：
imageControl:SetImage(Enum.ImageSource.StaticReference, 101001)
```

签名和来源枚举依据完整工作区 `knowledge/guide/Lua客户端UI脚本API.md` 的 `ClientUIImageControl.SetImage` 与 `Enum.ImageSource.Prefab`。Lua 中 `imageSource`、`imageId` 是只读字段，通过 `SetImage` 设置；编辑器的来源选择只改变 Authoring 配置，不改变 Lua 访问约束。

来源与 ID 必须匹配：`StaticReference + 10003004`、`Prefab + 101001` 都显示缺失框，不根据 ID 猜来源。旧工程/手写 Runtime spec 未提供来源时兼容为 `StaticReference`；`Item`、`Equipment` 等尚未接入的明确来源不会借用静态图片。

JSON 存档保留元件来源；GIA 图片来源槽尚未核实，导出会明确提示来源未映射，真机请在 Lua 中用上述 `SetImage` 设置。此功能显示元件的 **2D 图标**，不渲染其 3D 模型。

## 缓存位置与请求次数

Web、MCP、DSH 使用同一套 `ImageAssetStore`，同一系统用户默认共享以下目录：

| 平台 | 默认目录 |
|---|---|
| Windows | `%LOCALAPPDATA%/beyond-simulator/images` |
| macOS | `~/Library/Caches/beyond-simulator/images` |
| Linux | `$XDG_CACHE_HOME/beyond-simulator/images`，未设置时 `~/.cache/beyond-simulator/images` |

可在启动宿主前设置 `QXQY_IMAGE_CACHE_DIR` 指定其他目录。Docker/远程服务器缓存位于运行 Node 服务的机器上；需要跨容器重建保留时挂载该目录。缓存不写进游戏存档、工作区或安装包。

缓存按处理版本、来源及 ID 隔离：静态图片保存还原逻辑尺寸后的 PNG，元件保存原始完整图标 PNG。静态图片冷加载两个远端 GET（PNG、border JSON），元件冷加载仅一个 PNG GET；后续命中磁盘不发 HEAD/GET 校验。各来源进程内合并同 ID 请求、最多同时处理四个 ID，并用文件锁协调同缓存目录的跨进程冷下载。下载成功后原子发布，失败冷却 60 秒，避免试玩轮询反复请求。清理缓存可停止宿主后删除上述缓存目录；没有自动磁盘淘汰策略。

浏览器静态图片请求 `/qxqy-assets/sprite-v1/<id>.png`，元件图标请求 `/qxqy-assets/prefab-v1/<id>.png`。均响应 `private, max-age=43200` 和内容 ETag；HTTP 缓存命中可省去本地请求，过期校验仍只读本地素材。解码、GPU 纹理、乘色缓存及刷新通知均以 `imageSource + imageId` 区分。显式刷新使用新的查询参数避开旧浏览器副本，旧版按数字 ID 保存的刷新记录仅迁移到静态来源。源文件地址不含内容版本，所以不宣称永久 immutable；远端替换文件后需显式刷新。Cloudflare 可能继续按其自身策略缓存源响应。

## 渲染边界

静态 PNG 按元数据的 `m_Rect` 还原逻辑宽高，用 `m_RD.textureRectOffset` 恢复左下方向的透明留白。独立 PNG 不再按图集中 `textureRect.x/y` 二次裁切；浮点裁切边界按最近整数像素取整。已是完整逻辑尺寸的 PNG 保留原画布。尺寸不匹配、超大图和非 `None` 的 packingRotation 明确失败，避免静默画错。元件 PNG 校验清单尺寸后保留原图透明边界，不套用静态图片的裁切规则。

这是素材提供方数据驱动的**模拟器预览策略**。支持控件尺寸/旋转、原图 alpha、`imageColor` RGB 乘色/alpha，以及水平和垂直填充。基础／九切片拉伸见下节；矩形遮罩与软边见 [控件支持](control-support.md#基础矩形遮罩2026-10-11)。径向填充、材质及动效未在此处扩展，不据此推断真机视觉一致。

网络和解码在宿主/显示层，Lua Worker 与存档不携带图片字节。Pixi 异步加载完成后主动重绘，静态或暂停场景也能更新；删除/换来源/换 ID 后丢弃过期结果，纹理按来源+ID 共用并在不再使用时释放。只有来源变化也会触发增量场景更新。编辑器图片使用 Canvas2D 乘色。Host 截图先冻结当前快照，再有界等待资源准备，不调用 step；失败项通过截图元数据 `assetWarnings` 返回来源、ID 与错误，并使用占位。

底层 `renderPaintPng` / `renderScenePng` / `renderEditorPng` 仍是同步绘制函数，可通过 `options.images` 传已解码图片 Map，键由 `imageAssetKey(id, source)` 生成（例如 `Prefab:10003004`）；有网络准备职责的 `SimulatorController.uiScreenshot()` 与 DSH `requestUiScreenshot()` 为异步函数，调用方需 await。

## 验证与证据

图片类型与边界缓存的新规则见文末；以下保留原始图元/元件接入的历史验证。

- 环境：Windows、Node 22.23.2、Pixi 8.20.0、`@napi-rs/canvas` 0.1.100、Edge。
- `studio/test/image-assets.test.mjs`：白名单、两 Store 并发文件锁、离线重启、失败退避/刷新保留、损坏缓存修复、独立几何像素预期、RGB/alpha/填充、共享纹理以及无浏览器 Host 截图。
- `web/test/image-assets.test.mjs`：同源接口、ETag/HEAD/404、PNG 预览共用缓存；设置 `QXQY_BROWSER` 后验证真实浏览器 HTTP 命中、DOM 像素、WebGL 像素、静态异步完成、换 ID/删除竞态、GPU 释放和跨文档刷新。测试只使用合成图片和注入下载器，不访问 OSS。
- `dsh-plugin/test/image-assets.test.mjs`：真实 HTTP 请求经 DSH 注册的素材路由及刷新 API，并与无头截图共享缓存。根 `pnpm test` 288 项通过、6 项环境可选测试跳过；本功能的 Edge 浏览器回归单独启用后通过。`pnpm pack:release`、`pnpm test:packages` 验证独立 Web/MCP/DSH 包，覆盖 DSH Tools 0.1 与 0.2 两条依赖基线。
- 实际源抽查：`100101`、`101001`、`102001`、`105001`、`107001`、`112001` 的 PNG/元数据均成功下载和恢复尺寸，其中 `101001` 从 48×48 裁切图恢复到 64×64。未批量下载其他素材。
- 2026-10-11 元件扩展：完整清单的 ID、空项及尺寸与固定目录逐项比对，无差异。通过生产 Store 抽查 `10003004`、`10005001`、`20001001`、`30001001`，均只有一个 PNG 请求，重新创建离线 Store 后复用成功。
- 元件扩展提交前已完成一次性验证：来源白名单、单 PNG 下载、并发去重/离线/刷新失败保留、透明边界、同 ID 不同来源乘色、真实 Lua 仅改来源的增量、JSON 保留/GIA 警告、编辑与试玩截图，以及 Web/DSH HTTP 与真实 Edge 画面和刷新检查；这些元件专用验证脚本及用例在验收后按要求删除。
- 清理一次性测试前：`pnpm install --frozen-lockfile` 和 `pnpm test` 通过（315 通过、8 项环境可选跳过）；单独启用 Edge 的图片/元件与 DSH 素材测试 5/5 通过。
- `evidence_source=observed`，运行端 `simulator`，`device_status=not_required`（验证新增预览/缓存功能，不宣称千星真机对齐）。DSH Desktop 自定义协议的 HTTP 缓存效果未据普通浏览器测试推定。

## 图片类型：基础／拉伸（2.1.0）

参考 `D:/Codes/Miliastra-image-editor-webui` 提交 `20659b3` 的 `frontend/src/imageStretch.ts`、`backend/app/image_stretch.py` 和 `docs/image-stretch.md`，按用户要求对齐：

- **基础 `Basic`**：整张贴图随控件宽高缩放。
- **拉伸 `Stretch`**：使用原始 `m_Border`（X 左、Y 下、Z 右、W 上）三切片／九切片。角保持本地 UI 尺寸，边单向伸长、中心双向伸长。边界不乘 2/3，也不除以 `m_PixelsToUnits`；父级缩放在切片之后应用。
- 源边界超过源图尺寸时先归一化；控件小于左右／上下边界和时，分别按轴等比例压缩边界。零宽／零高源中心仍绘制目标区域，重复接缝的双线性样本，不留空洞。
- 任一边界大于零时支持且默认拉伸；明确选择基础会保留。边界为零或缺失、基础图元、Prefab 图标都按基础绘制。换来源/ID 时清除旧类型选择，重新按素材确定默认。
- Authoring `imageType` 为 `null | "Basic" | "Stretch"`，null 表示未指定、由素材边界选择。编辑器类型下拉在边界读取期间禁用，已知不支持时只显示基础。保存保留明确的选择；未知 GIA 类型值单独保存在 `giaRaw.imageSlotType`，显式编辑才替换。

Lua 使用已声明的枚举字段：

```lua
image:SetImage(Enum.ImageSource.StaticReference, 106030)
image.imageType = Enum.ImageType.Basic
-- 或：
image.imageType = Enum.ImageType.Stretch
```

**Lua 兼容边界：** Runtime 不联网，也不以异步加载结果决定脚本字段是否存在。Studio 对远程静态图片白名单接受 Basic/Stretch 选择请求，类型未指定时读回 Stretch；三种渲染端根据实际边界统一解析，不支持切片的图片即使收到 Stretch 仍按基础绘制。这一请求层策略不证明该 ID 的真机 `imageType` 可写。基础图元 100001–100006、Prefab 与其他未知来源仍保留此前的字段不可写行为。正式脚本对未实机确认的素材继续用 `pcall`；直接使用独立 Runtime 时需注入 `canSelectImageType` 策略。

### 元数据缓存与旧版本兼容

原始 border JSON 独立保存到同一 `QXQY_IMAGE_CACHE_DIR` 下的 `border-v1/<源哈希>/<id>.json`，复用文件锁、并发去重、失败退避和显式刷新机制。首次静态图片仍只需要 PNG+JSON 两次源请求；PNG 与元数据接口的并发请求共享同一次下载。

旧缓存只有 PNG 时，保留旧文件，仅按需补下载一次元数据。已有 PNG 但补元数据失败时继续基础显示，属性面板/截图 `assetWarnings` 明确报告，不将错误当作“素材无边框”。元数据源 404 缓存为缺失，按基础处理；网络/JSON 错误保持失败并可重试。浏览器通过同源 `/qxqy-assets/sprite-v1/<id>.json` 取得归一化边界，同样有 12 小时 HTTP 缓存和 ETag。手动刷新素材同时刷新 PNG 和边界。

PNG 截图和 DOM 编辑画布共用逐像素双线性九切片采样；单张目标栅格最长边限制为 4096 后缩放显示。Pixi 使用共享纹理加独立 UV 网格（最多九个四边形），支持零宽中心并在类型/尺寸改变时释放旧网格。尺寸、填充、透明度、父级变换和已有遮罩继续参与渲染。底层 Host 绘制可传 `options.imageMetadata` Map，键与图片相同。

### GIA 类型槽与证据

参考仓库报告了 7.1.0 客户端模板 `基础&拉伸图片gia.gia`（SHA256 `10f04eba8af9d18a3ada66e88f328e15bbccacf0567c4cf1070e76707fcaaf6b`）：`Details.imageSlot(84).field504` 省略/0 为基础、1 为拉伸。模拟器按此读写，没有采用其旧素材组 `image_settings.field5` 的猜测映射，也不改 `ImageConfig.field507=2`。本轮未取得该原始样本，仅以代码与说明交叉核对，映射证据为 `provided_unverified`；自包含独立 wire 测试只证明本实现的编码位置，真机回导状态为 `pending`。

GIA 无“按素材自动”值：尚未明确选择类型时暂按基础导出并提示；需要拉伸可在属性面板明确选择，或在真机通过 Lua 设置。字段支持不改变元件图片来源仍未映射的边界。

### 本轮验证

Windows / Node 22.23.2 / Pixi 8.20.0 / Edge，`evidence_source=observed`、运行端 `simulator`、`device_status=not_required`（本轮预览扩展）。

- 提交前已完成一次性验证：合成色块检查九切片/三切片边界、小尺寸压缩、零宽中心混合值、透明度/填充、父级缩放、网格释放、旧缓存补元数据、404 与网络失败区分、真实 Lua 类型切换及 JSON/GIA 往返。
- 独立编码的客户端 slot84.field504 字节验证基础省略/拉伸=1和未知枚举保留；真实 DOM/Pixi 验证类型下拉、零中心像素、增量更新、GPU 几何释放、零边界素材和缓存请求数。这些图片类型专用测试文件及新增用例在验收后按要求删除。
- 清理一次性测试前，`pnpm install --frozen-lockfile`、根 `pnpm test` 通过（333 通过，9 环境可选跳过）；单独启用 Edge 的图片类型/缓存/遮罩检查合计 4/4 通过。
- 实际源抽查 106030：90×90、四边 45，按 407.5×265 绘制；再次以离线 Store 加载 PNG/边界无告警。素材中心本身透明，中心采样透明不等于切片漏绘。100001/105222 元数据边界全零。
