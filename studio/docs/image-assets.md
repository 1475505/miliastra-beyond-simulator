# 白名单静态素材预览与缓存

## 使用

图片控件的 `imageId` 填入白名单 ID 后，编辑器画布、Pixi 试玩和 Host PNG 截图均可显示该静态素材。首次实际使用时下载 PNG 与配套 border JSON；重启后直接读取磁盘缓存，已缓存素材可离线使用。未知 ID 不发网络请求，下载失败保留占位。

- 素材源：`https://oss.070077.xyz/images/`。
- 白名单：`studio/assets/catalog.js` 固定了 2026-10-02 核对的 `data.json` 非空条目。1,543 个目录 ID 中 1,522 个有图片路径；其中 `100001–100006` 仍走原有图元代理，新增远程预览 ID 为 1,516 个。没有全量下载图片或逐项核验这 1,516 项的视觉。
- 来源路径已核对为 `sprite/<id>.png` 与 `border/<id>.json`；不接受存档传入任意 URL，不在启动时下载远程清单。更新白名单需重新核对目录并修改源文件。
- 选中远程图片，在属性面板点击 **「↻ 重新下载此素材」** 可重新请求源文件并替换缓存。刷新失败保留之前的可用文件；刷新不会扩充 ID 白名单。
- 同源编辑器与试玩页通过浏览器 storage 通知刷新；若浏览器禁用 storage，可重新打开试玩页。不同源的页面（例如另一端口或另一宿主）不会收到通知，可能继续使用其 HTTP 缓存至到期。

## 缓存位置与请求次数

Web、MCP、DSH 使用同一套 `ImageAssetStore`，同一系统用户默认共享以下目录：

| 平台 | 默认目录 |
|---|---|
| Windows | `%LOCALAPPDATA%/beyond-simulator/images` |
| macOS | `~/Library/Caches/beyond-simulator/images` |
| Linux | `$XDG_CACHE_HOME/beyond-simulator/images`，未设置时 `~/.cache/beyond-simulator/images` |

可在启动宿主前设置 `QXQY_IMAGE_CACHE_DIR` 指定其他目录。Docker/远程服务器缓存位于运行 Node 服务的机器上；需要跨容器重建保留时挂载该目录。缓存不写进游戏存档、工作区或安装包。

缓存按处理版本、源地址及 ID 隔离，保存恢复逻辑尺寸后的 PNG。一次冷加载通常有两个远端 GET（PNG、border JSON）；后续命中磁盘不发 HEAD/GET 校验。进程内合并同 ID 请求、最多同时处理四个 ID，并用文件锁协调同缓存目录的跨进程冷下载。下载成功后原子发布，失败冷却 60 秒，避免试玩轮询反复请求。清理缓存可停止宿主后删除上述缓存目录；没有自动磁盘淘汰策略。

浏览器统一请求 `/qxqy-assets/sprite-v1/<id>.png`，响应为 `private, max-age=43200` 和内容 ETag；HTTP 缓存命中可省去本地请求，过期校验仍只读本地素材。显式刷新使用新的查询参数避开旧浏览器副本。源文件地址不含内容版本，所以不宣称永久 immutable；远端替换文件后需显式刷新。Cloudflare 可能继续按其自身策略缓存源响应。

## 渲染边界

PNG 按元数据的 `m_Rect` 还原逻辑宽高，用 `m_RD.textureRectOffset` 恢复左下方向的透明留白。独立 PNG 不再按图集中 `textureRect.x/y` 二次裁切；浮点裁切边界按最近整数像素取整。已是完整逻辑尺寸的 PNG 保留原画布。尺寸不匹配、超大图和非 `None` 的 packingRotation 明确失败，避免静默画错。

这是素材提供方数据驱动的**模拟器预览策略**。支持控件尺寸/旋转、原图 alpha、`imageColor` RGB 乘色/alpha，以及已有水平和垂直填充。首版不使用 `m_Border` 实现九宫格拉伸，也未新增径向填充、羽化、材质或动效语义；不据此推断真机视觉一致。

网络和解码在宿主/显示层，Lua Worker 与存档不携带图片字节。Pixi 异步加载完成后主动重绘，静态或暂停场景也能更新；删除/换 ID 后丢弃过期结果，纹理按 ID 共用并在不再使用时释放。编辑器图片使用 Canvas2D 乘色。Host 截图先冻结当前快照，再有界等待资源准备，不调用 step；失败项通过截图元数据 `assetWarnings` 返回并使用占位。

底层 `renderPaintPng` / `renderScenePng` / `renderEditorPng` 仍是同步绘制函数，可通过 `options.images` 传已解码图片 Map；有网络准备职责的 `SimulatorController.uiScreenshot()` 与 DSH `requestUiScreenshot()` 现在是异步函数，调用方需 await。

## 验证与证据

- 环境：Windows、Node 22.23.2、Pixi 8.20.0、`@napi-rs/canvas` 0.1.100、Edge。
- `studio/test/image-assets.test.mjs`：白名单、两 Store 并发文件锁、离线重启、失败退避/刷新保留、损坏缓存修复、独立几何像素预期、RGB/alpha/填充、共享纹理以及无浏览器 Host 截图。
- `web/test/image-assets.test.mjs`：同源接口、ETag/HEAD/404、PNG 预览共用缓存；设置 `QXQY_BROWSER` 后验证真实浏览器 HTTP 命中、DOM 像素、WebGL 像素、静态异步完成、换 ID/删除竞态、GPU 释放和跨文档刷新。测试只使用合成图片和注入下载器，不访问 OSS。
- `dsh-plugin/test/image-assets.test.mjs`：真实 HTTP 请求经 DSH 注册的素材路由及刷新 API，并与无头截图共享缓存。根 `pnpm test` 288 项通过、6 项环境可选测试跳过；本功能的 Edge 浏览器回归单独启用后通过。`pnpm pack:release`、`pnpm test:packages` 验证独立 Web/MCP/DSH 包，覆盖 DSH Tools 0.1 与 0.2 两条依赖基线。
- 实际源抽查：`100101`、`101001`、`102001`、`105001`、`107001`、`112001` 的 PNG/元数据均成功下载和恢复尺寸，其中 `101001` 从 48×48 裁切图恢复到 64×64。未批量下载其他素材。
- `evidence_source=observed`，运行端 `simulator`，`device_status=not_required`（验证新增预览/缓存功能，不宣称千星真机对齐）。DSH Desktop 自定义协议的 HTTP 缓存效果未据普通浏览器测试推定。
