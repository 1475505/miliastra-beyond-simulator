# 界面动效预览集成调研

调研日期：2026-10-28；资源发布验收更新：2026-10-30。结论：现有 C/T WebM 资源可以接入模拟器。推荐沿用按需资源缓存，编辑器使用 C/T 双平面 DOM 合成，试玩使用同一 Pixi 场景中的 C/T 双 pass，并为截图增加按逻辑时间取帧能力。素材选择器可以先行；完整试玩还需要补齐 Runtime 播放状态、背景合成与 GIA 边界。

本文是方案与实测记录；产品功能尚未实现。所有浏览器验证均静音。

## 1. 调研基线与证据

| 来源 | 本次核对结果 | 证据边界 |
|---|---|---|
| `F:/ugc-tool` | 从 `4ed2172` 执行 `git pull --ff-only`，更新到 `7bdf307`（2026-10-28，新增界面动效预览设置操作） | 第三方实现，可以作为实现参考，不是千星真机契约 |
| `F:/UGC_UI_VFX` | `data.hash.json`、196 WebM、196 PNG、47 MP3、原生 WebGL2 示例播放器 | 本地文件、ffprobe 元数据直接观察 |
| simulator | HEAD `9dca8cd4501cf9bda5af1ad290e768e36ac24542`，Pixi 8.20.0 | 调研包含工作树已有改动；未改写已有的 `session.js`、`layout.test.mjs`、`control-support.md` |
| 本地 API | `knowledge/guide/Lua客户端UI脚本API.md`，2026-10-24 官网对齐稿 | 本次使用已有快照，没有再次采集官网；SHA-256 见下方 |
| 官方动效规则 | `knowledge/fact.md` K5，来源为界面动效／全屏动效官方子页 | `evidence_source=documented`、运行端 `official_document`；不等于真机验证 |
| 浏览器验证 | Windows、Edge 156、ANGLE/D3D11、AMD Radeon RX 6750 GRE 12GB | `evidence_source=observed`、运行端为本地研究页；`device_status=not_required`，不是游戏真机观察 |

API 文件 SHA-256：`25228400d124294f46ec364a224256e53f0e2e5a3f8dc9a8d1129ba6f9109192`。

本地 `data.hash.json` SHA-256：`55dc9e18c7840dc173a2d469257de78ae35f6929f45543ac843a59cc6bf02e97`。

## 2. OSS 资源清单与部署

### 2.1 推荐完整资源包

部署使用独立前缀 **`https://oss.070077.xyz/uivfx/`**，对应 Cloudflare R2 的 `qx-img` bucket。2026-10-30 已通过 Wrangler 确认自定义域名启用，ownership/SSL 均为 active；上传与公开响应验收见 §2.4。

```text
uivfx/
  data.json
  i18n/
    zh-cn.json
    en-us.json
  video/                 # 原样保留全部 196 个 .webm
  icon/                  # 原样保留全部 196 个 .png
  audio/                 # 原样保留全部 47 个 .mp3，包括 _02 等变体
```

| 内容 | 数量 | 字节数 | 用途 |
|---|---:|---:|---|
| `video/*.webm` | 196 | 44,720,681 | 实际动效，必须保留左右 C/T 两半 |
| `icon/*.png` | 196 | 3,132,183 | 素材选择器缩略图、解码失败时的静态展示 |
| `audio/*.mp3` | 47 | 1,538,800 | 30 个带声音动效的独立音频；其中有随机候选组 |
| `data.json` | 1 | 88,944 | ID、scope、宽高、循环标记、路径、分类与标签 |
| `i18n/zh-cn.json` | 1 | 10,559 | 中文标题、分类和标签，230 个键 |
| `i18n/en-us.json` | 1 | 11,286 | 对应模拟器中英文界面，230 个键 |
| **合计** | **442** | **49,502,453（约 47.21 MiB）** | 完整推荐上传集 |

本地媒体清单引用 439 个独立文件：缺失 0、未被引用的媒体文件 0。不要按数字区间生成文件名：界面动效 ID 并不连续，例如清单没有 `10001123`。

如果只接入【界面动效】而暂不开放全屏素材，可按 `scope=ui` 筛选：159 WebM、159 PNG、33 MP3，媒体共 24,071,891 字节（约 22.96 MiB）。推荐一次上传完整集，UI 中按 scope 隔离显示；无需为省约 24 MiB 拆成两次部署。

### 2.2 已补齐并整理好的上传目录

原始本地目录没有 `data.json` 和 `i18n/`，原 `index.html` 的“读取本目录素材”因此会请求不存在的文件。已经从参考项目的公开 OSS 补齐三份文件，逐项比对全部 data/category/tags：除 `nameI18nKey` 外，与本地 hash 清单一致；两份翻译均覆盖全部 230 个键。

完整上传目录：

```text
C:/Users/liul/AppData/Local/Temp/opencode/ui-vfx-research-20261028/upload/uivfx/
```

批量上传脚本从此目录读取资源，object key 已包含 `uivfx/`，不会重复嵌套为 `uivfx/uivfx/`。该目录中的媒体是原文件逐字节复制，未转码。

同级 `upload-manifest.json` 记录全部 442 个文件的路径、大小、SHA-256，以及三份补充文件的获取地址与 UTC 时间。`prepare-upload.mjs` 为本次整理脚本。它们用于本地核对，无需成为浏览器资源。原始文件目录没有被修改。

补充文件来源：

- `https://oss.xiaomol444.xyz/ugc-tool-data/Public/UIVfx/data.json`
- `https://oss.xiaomol444.xyz/ugc-tool-data/Public/UIVfx/i18n/zh-cn.json`
- `https://oss.xiaomol444.xyz/ugc-tool-data/Public/UIVfx/i18n/en-us.json`

清单 SHA-256：`fcdd2087b0ce558f90489db6c1368211d8b110e8cc755baf1efd731814a53fd4`。

`data.hash.json` 的 nameI18nKey 是十进制 TextMap hash，不能直接搭配上述 `uiEffect.title.*` 翻译文件。建议保留它作本地来源追踪；如要上传，可保持原名作为可选文件。正式预览使用补齐的 `data.json`，不把 hash 文件直接重命名。

`player.js`、`index.html`、`serve.ps1`、启动 cmd 和说明 txt 不属于模拟器资源依赖。播放器实现随模拟器安装包构建；只有单独托管原示例网页时才需要上传 HTML/JS。

### 2.3 OSS 响应要求与路径

- MIME：WebM `video/webm`，MP3 `audio/mpeg`，PNG `image/png`，JSON `application/json`。
- 支持 `GET`、`HEAD`、字节范围 `Range`；正确返回 `206`、`Content-Range`、`Content-Length`、`Accept-Ranges: bytes`。播放、跳转和后半段循环依赖可靠 seek。
- URL 例：`https://oss.070077.xyz/uivfx/video/10001043.webm`。
- 清单中的 `/video/...`、`/audio/...`、`/icon/...` 是**资源包前缀内相对路径**。先移除开头 `/` 再相对 `uivfx/` 拼接，不能直接 `new URL('/video/...', base)`，否则会丢掉前缀。
- 推荐浏览器请求模拟器同源资源路由，Node 宿主向 OSS 下载。这条路径不依赖 OSS 的浏览器 CORS，也符合当前 `connect-src 'self'` 等 CSP。
- 如果另行开放网页直连 OSS，需要对实际网页 Origin 允许匿名跨域读取，并在设置 `src` 前设置 `video.crossOrigin='anonymous'`；脚本要读响应头时暴露 Range/ETag 相关头。2026-10-30 通过 Wrangler 查询 `qx-img`，API 返回 `The CORS configuration does not exist`（10059）；采用上述同源缓存接入时无需将该 bucket 的 CORS 配置作为前置条件。
- 清单和未带内容版本的媒体使用可更新缓存策略。若使用长期 immutable，必须把内容版本放入路径。媒体发布完再切换清单，避免目录指向尚未上传的文件。

### 2.4 批量上传与验收（2026-10-30）

控制台单次 100 文件限制通过本地 Wrangler **4.155.0** 绕开；安装位于上述临时工作目录的 `r2-tools/`，认证复用已完成的 Wrangler OAuth 登录。

在 `C:/Users/liul/AppData/Local/Temp/opencode/ui-vfx-research-20261028/` 运行：

```powershell
node upload-r2.mjs --bucket qx-img --account-id 34a3effe02f405ba7947d9033ec9cb08
node verify-public.mjs
```

- 上传前检查全部本地大小/SHA-256，并只读检查目标 bucket；上传显式使用 `--remote`。
- 4 路并发，每项最多尝试 3 次；`upload-receipts/` 保存按账户/bucket 隔离的成功回执。重复执行相同命令可续传；`--force-upload` 可忽略旧回执。
- 上传时指定媒体 `Cache-Control: public, max-age=43200`、JSON `public, max-age=300`。441 个前置文件成功后才发布 `uivfx/data.json`。
- `verify-public.mjs` 从公开域名下载全部 442 个文件，比对大小/SHA-256、MIME 和缓存头，检查目录/翻译闭合，并抽查 HEAD 与媒体首尾 Range 的状态、响应头和字节；回执写入 `public-verification.json`。

发布与公开 HTTP 实测结果（`evidence_source=observed`，运行端为本机 Node/Wrangler 对 Cloudflare R2/公开域名的请求，`device_status=not_required`）：

- Wrangler 接受 **442/442** 个上传，失败 0；目录已发布为 `https://oss.070077.xyz/uivfx/data.json`。
- 公开下载的 **442 个文件、49,502,453 字节**全部与本地清单 SHA-256 一致，MIME 正确。196 条素材记录（159 UI、37 全屏）引用的439个媒体齐全，中英文各230个翻译键无缺失。
- 4 个 WebM（含普通、全屏及最大文件）和1个MP3的首尾字节区间共 **10 次 Range** 全部返回 `206`，`Content-Range`、长度及内容一致；HEAD 支持字节范围。Cloudflare 部分 `206` 响应省略 `Accept-Ranges`，该字段在 HEAD 宣告，不能把此省略误判为不支持 Range。
- **缓存策略仍有差异：** 三份 JSON 的公开 `Cache-Control` 均为 `public, max-age=43200`，未呈现上传指定的300秒；媒体43200秒符合设置。覆盖发生在哪一层尚未定位，因此完整验收脚本仍以失败退出，不能写成所有 HTTP 条件均通过。脚本在缓存断言失败后未收集 JSON，连带产生的 `Catalog count mismatch` 已由独立公开下载复核排除；补充回执为同目录 `public-json-verification.json`。后续更新清单前需核对缓存规则，或采用显式版本路径。

这里记录的是资源发布和 HTTP 验收，不作为千星真机播放或模拟器产品功能完成的证据。

## 3. 实际媒体格式与成本

对全部 196 个 WebM 执行 ffprobe：

- 全部为 **VP9 Profile 1、8-bit `yuv444p`、30 fps**，仅一个视频流，无内嵌音轨。
- 全部编码宽度等于清单 `width × 2`，编码高度等于清单 `height`，尺寸不一致 0。
- 时长 0.566–10 秒；全部 85 个 `isLoop=true` 素材都是 10 秒。
- 颜色 range 标记均为 `tv`；未读到明确的 primaries / transfer / matrix 标记，浏览器颜色转换仍需回归，不能自行加 gamma 变换。
- 最大面积视频 `10001124`：4668×2714；最大编码宽度 `10001126`：5148×1178。
- 5 个视频宽度超过 4096：`10001071`、`10001124`、`10001125`、`10001126`、`10001137`。上传 GPU 前检查 `MAX_TEXTURE_SIZE`；不可默认所有设备都支持整幅 packed 纹理。
- 单个最大文件约 2.50 MB（`10002034`）；完整文件按需落盘后提供本地 Range 是可行的第一版，不必先引入复杂的分片缓存。

47 个 MP3 全部通过 ffprobe：39 个为 48 kHz 双声道、7 个为 44.1 kHz 双声道、1 个为 24 kHz 单声道，时长 0.296–6.019 秒。随机候选最多的 `10001120` 有 11 个文件，每次触发选一条，而不是同时播放全部候选。

磁盘文件小不代表显存小：4668×2714 的单幅 RGBA 纹理约 48.33 MiB；复制成两个 Canvas 再上传会增加 CPU/GPU 副本。选择器只加载可见图标，点击才播放单个预览；运行时只为可见且活跃的实例建解码器，限制并发和总像素预算。

## 4. C/T 合成与验证

每帧左半为特效贡献 **C（RGB）**，右半为背景透过系数 **T（RGB）**：

```text
out.rgb = clamp(C + background.rgb * T, 0, 1)
```

T 是 RGB 向量，不应简化为单一 alpha；仅用黑底转透明、screen blend、普通 RGBA 视频不能普遍表达这个公式。

### 4.1 已完成的浏览器验证

本地只读 HTTP 研究服务提供原始媒体、原 `player.js` 及内存构建的 Pixi 8.20 模块，没有改动产品代码。

| 检查 | 结果 |
|---|---|
| VP9 解码及 seek | `10001001 / 10001017 / 10001043 / 10002001 / 10002034 / 10001124` 六项均成功，seek 到 0.5 秒可读像素 |
| 运行能力 | WebGL2、`requestVideoFrameCallback`、CSS `plus-lighter` 可用；本机 MAX_TEXTURE_SIZE=16384 |
| 原 player.js | `10001043` 的 0.5 秒帧，在 `#676b58` 上与 CPU 公式对比 9,735 个通道：最大误差 0.569、平均 0.071（0–255 单位） |
| Pixi 双 pass | 同一素材帧叠加双色棋盘，3,245 个采样像素：最大通道误差 0.498、平均 0.067（0–255 单位） |
| 彩色 T 与覆盖率 | 合成测试 T=(51,128,204)、C=(26,13,51)，覆盖率 1/0.5/0：最大误差均 ≤0.5 |
| 透明画布陷阱 | 移除不透明背景后，双 pass 在无效果的角落输出 `(0,0,0,255)`，出现不透明黑块 |

原始回执：`C:/Users/liul/AppData/Local/Temp/opencode/ui-vfx-research-20261028/browser-evidence.json`。这些检查证明采样时的解码与合成可行；没有证明全部 196 项都能实时满帧、多实例压力、所有浏览器／手机或游戏真机像素一致。CPU 对照使用同一浏览器已解码帧，因此不验证原始游戏色彩还原。

### 4.2 原 player.js 的适用范围

原脚本使用 WebGL2 不透明 Canvas，背景是固定 uniform。适合素材详情窗的纯色底预览，可直接参考；它不能自动采样背后的 DOM、图片或模拟器画布。把它覆盖到试玩上会把背景一起遮住。

### 4.3 编辑画布：参考双 Canvas DOM 合成

`ugc-tool/uiVfxRenderer.ts` 把右半 T 和左半 C 分别 `drawImage` 到两个不透明 Canvas；`UIVfxMedia.vue` 按以下顺序显示：

1. T Canvas：`mix-blend-mode: multiply`。
2. C Canvas：`mix-blend-mode: plus-lighter`。

这能读取同一 CSS 混合上下文中的实际背景。移植到 React 时，两平面必须作为相邻、有相同 placement 的元素参与最终 stage 背景合成；`pointer-events:none`，选框单独在顶层。

当前编辑画布有 transform、`mask-preview.js` 遮罩组；这些会产生隔离合成边界。不能把两平面随意包进带 transform/opacity/mask 的普通控件 div。推荐先实现顶层 effect plane，用世界矩阵定位，明确舞台隔离范围；有遮罩时，把覆盖率施加到 C/T 内容而不是把两层合成结果整体套透明组。嵌套遮罩、多个重叠动效的 DOM 像素正确性仍需专项验收。

### 4.4 Pixi 试玩：同场景双 pass，先让背景入场

推荐每个播放实例一个 video 解码器和一个 packed VideoSource，同一 texture source 的左右 UV 分别提供 C/T（避免两次 Canvas 拷贝）。将 T Sprite/Mesh 的 blendMode 设为 `multiply`，C 设为 `add`，保证每个效果的 T、C 连续绘制。

Pixi 8.20 的 GL 混合配置已核对：

```text
multiply RGB: src * DST_COLOR + dst * (1 - SRC_ALPHA)
add RGB:      src + dst
```

对不透明背景，先 T 后 C 正好满足公式。每个效果必须保持 `T1,C1,T2,C2` 顺序，不能统一先画所有 T 再画所有 C，否则重叠结果错误。UV 需夹到半幅的像素中心，避免线性采样跨左右接缝。

**必须处理当前透明舞台：** `PixiPlayRenderer.initialize()` 设置 `backgroundAlpha:0`，真正的径向渐变背景在 `dsh-plugin/lib/play.html` 的 CSS 中。GPU 无法读取那个 DOM 背景。建议把现有舞台背景作为 Pixi 最底部不透明底图，所有效果在同一场景内合成，截图端复用同一背景定义。HTML 继续承载边框和舞台外装饰。

如果未来必须导出带透明背景的 C/T 合成，单张普通 RGBA PNG 本身不能无损表达任意 RGB 透射，需明确指定合成背景或另行输出 C/T；不能宣称普通透明 PNG 完整保真。

遮罩／透明覆盖率 m 的正确形式为：

```text
C' = m*C
T' = 1-m+m*T
out = C' + B*T'
```

把 m 乘到两个 pass 的预乘色／alpha 可在不透明目标上实现这一形式；本次已验证简单覆盖率。现有 Pixi alpha-mask 会将子组先渲染到离屏透明目标，直接将 C/T 放入该组可能失去真实背景。因此应让 effect pass 在最终背景上绘制并在 shader 里采样遮罩覆盖率；或在必要时用显式 background RenderTexture 合成。此部分需要生产场景的嵌套遮罩测试。

## 5. 与参考项目不同的行为，不能直接照搬

| 行为 | 参考实现／资源事实 | 模拟器建议与证据状态 |
|---|---|---|
| 视频循环 | 原示例 `video.loop=true` 回零；最新 UIVfxMedia 在 ended 后跳 duration/2，首次播完整、随后播后半段；85 个循环文件均为 10 秒 | 优先对齐最新版参考的资源播放约定：0–10 后循环 5–10；写入 catalog playback metadata，标 `inferred/参考实现策略`，不是官方引擎时序 |
| 普通动效范围 | 最新工具使用素材 width/height × 父子缩放，控制框宽高不直接拉伸视频 | 建议作为可替换的预览布局策略；位置/pivot/scale 使用模拟器世界矩阵，保留控件框；尚无本次真机尺寸证据 |
| 全屏范围 | 工具使用 cover，忽略普通矩形范围 | 覆盖全屏是官方文档事实；不同画布的裁切/拉伸/cover 取舍仍是预览策略，需在五种画布核验 |
| 普通动效层级 | AboveAllControls / BelowAllControls | 按官方文档设置两个全局效果层，默认 Above；不要用普通 sibling 代替全局层级 |
| 全屏层级 | 工具 `vfxPlacement()` 返回 zIndex=3（普通 above 为2） | 与本地官方快照 K5 冲突：全屏固定在所有控件下方。模拟器采用官方下层规则；多个下层动效之间的顺序仍需定义 |
| 声音候选 | audioPath 是替代版本，最多11条 | 每次逻辑触发只选择一条；选择结果进入回放快照，浏览器轮询不能重新随机 |
| 声音循环与同步 | 工具普通 UI 音频 `loop=isLoop` 并追随 video.currentTime；原说明则仅播放一次提示音 | 两者冲突。循环 UI `10001017` 音频仅0.851秒，`10001131` 仅2.131秒；不能把视频5秒循环起点直接设给音频。默认建议每次触发一遍且不随视频循环重播，作为显式模拟器策略；精确循环语义待证据 |
| 全屏声音 | 工具组件用按素材 ID 的 Set，仅首次 showing 播声音；静音时也消耗首次机会 | 不直接当作全局真机规则。若采用，应绑定运行实例/播放代次而不是全局资产 ID；编辑预览重播与 Runtime 触发分开 |
| 隐藏／激活恢复 | 工具重新显示从0重播，页面后台暂停、回来继续 | 实现需区分控件可见性、祖先激活、页面可见性、调试暂停；未由 API 声明的重启/继续规则标策略 |
| StopAnimation | 官方仅声明“停止” | 停末帧、归零或清屏未明确。可先定义“隐藏该实例画面并停止自带声音”的预览策略，不标为真机观察 |

全屏 Lua 类型没有声明专属 `PlayAnimation/StopAnimation`；不可因为普通动效有这两个方法就给全屏新增伪 API。全屏进入有效可见状态是否自动开始，属于需要注明的模拟器策略或后续官方/真机核对项。

## 6. 模拟器接入设计

### 6.1 资源与缓存

复用 `studio/host/asset-cache.js` 的 DiskAssetStore（并发去重、4路下载、磁盘锁、原子发布、失败冷却、刷新失败保留）。新增：

- `studio/assets/ui-vfx-catalog.js`：固定、版本化白名单；ID、scope、原生尺寸、duration、loopStart、视频/图标/音频候选、名称。打包时由核对过的 catalog 和 ffprobe 数据生成；不让 Runtime 依赖异步远端清单。
- `studio/host/ui-vfx-assets.js`：按 video/icon/audio 分资源类型存储和校验。MP3 可复用 validateMp3；WebM 至少校验 EBML、codec、尺寸和大小，拒绝 HTML 错误页，不只按扩展名缓存。
- 建议同源路由 `/qxqy-vfx/<catalogVersion>/video/<id>.webm`、`icon/<id>.png`、`audio/<file>.mp3`；音频候选如 `_02` 必须由清单白名单验证，不能套现有只接受数字音频 ID 的路由。
- 默认缓存 `defaultAssetCacheDir('ui-vfx')`，可增加 `QXQY_UI_VFX_CACHE_DIR`。大文件可先冷加载全文件，再使用现有 audio-assets 的 Range/ETag/HEAD 模式响应。
- Web 和 DSH 的 HTTP 入口都接共享 Store；MCP 截图使用相同缓存。补齐 Studio exports 与各分发包的包含清单。
- 字节缓存以素材身份共享；播放实例的 currentTime、声音候选和 video 对象不能仅按 asset ID 全局共享，否则同素材同时触发会互相 seek。

### 6.2 Authoring 与编辑器

已有 `animation/fullscreen`、`animationId/playSoundEffect/layer` 的存档与 compile 字段可利用，但现状有三处缺口：

1. `studio/ui/inspector.js` 只开放字符串 animationId；`editor-ui/index.js` 的分类也只列 animationId。
2. `studio/ui/project.js` 的 set 白名单没有 playSoundEffect/layer，animationId 归在 STRING_FIELDS，不能只补一个前端表单。
3. 编辑画布目前只是名称/边框占位，快照未提供完整效果素材和播放投影。

建议 UI 提供按 ID/名称/标签搜索、循环/单次筛选、缩略图、选择、预览/重播/停止、声音开关、普通动效的层级枚举。界面动效仅选择 `scope=ui`，全屏仅 `scope=screen`。未知或跨 scope ID 保留输入并显示明确缺失状态。

将新设置 ID 规范为安全整数，旧字符串数字在输入边界兼容；无法解析的旧原始值单独保留，不替换为0。编辑预览的时间、暂停状态、重播 token 只属于编辑器，不写入 GIA 或改变游戏初始播放行为。

### 6.3 Runtime、快照和确定性时钟

当前 `client/lua-runtime/src/scene.js:PlayAnimation/StopAnimation` 是空方法。`studio/play/session.js` 的 paint-kind 筛选、visualFields 和 fingerprint 均不含有效动效投影；Pixi 的 PAINT_KINDS 也排除这两种类型。仅添加视频渲染分支不会让 Lua 播放生效。

建议 Runtime 每个效果保留内部状态：

```text
runtimeControlId, animationId, generation,
startedAt, state, elapsed/pausedAt,
loopStart, duration, selectedAudioVariant
```

它们是模拟器观察数据，不新增成 Lua 对外字段。`PlayAnimation()` 增加 generation、记录逻辑开始时间并标脏；Stop/换ID/销毁取消旧代次。重复请求、旧下载完成、切换玩家和重新启动都按 session/player/control/generation 消除竞态。

快照是非消费式的：截图/get 不应“取走”播放事件。增加 effects 状态或把相关字段加入 scene/paint，并纳入 fingerprint；只改声音/层级/播放代次也必须产生更新。祖先变换、显隐和删除沿当前脏标记传播。

时间由 Runtime 决定，浏览器只投影：

- realtime：video 自然播放，定期用逻辑 elapsed 校正漂移；用 requestVideoFrameCallback 触发纹理与重绘，合并同帧多个实例请求。
- manual／调试暂停：video 必须暂停，按目标逻辑时间 seek，等 seeked + 已解码帧后重绘；查询/截图不 step。
- 参考后半段循环的确定性取样：若 e<D，取 e；否则取 `L + (e-D) % (D-L)`，当前参考资源 D=10、L=5。参数来自版本化清单。
- 禁止 video.ended 或音频设备时钟反向驱动 Lua。冷加载超时不阻塞 Worker，显示层返回缺失/等待状态。
- 现有 Pixi ticker 被 stop，不能只创建 VideoSource 就假设会连续显示；需要额外的按视频帧重绘调度与销毁时注销。

声音复用当前静音/用户手势解锁政策；通过额外的 effect-audio 通道复用 BrowserAudioPlayer 基础设施，不能把动效 ID 传给 `game.PlayAudio2D` 冒充已有音效目录 ID。

### 6.4 截图与自动测试

`studio/host-png.js` 使用 `@napi-rs/canvas`，不能直接解码 WebM。浏览器画面接通后，MCP 的 Host PNG 不会自动获得视频帧。

推荐保留无浏览器截图路径：新增可注入的帧提供器，按“素材内容哈希 + 目标帧序号”缓存 C/T 帧，后台解码后让 Canvas2D 按最终背景进行 multiply/lighter 或逐像素公式合成。首个实现可使用显式配置的 FFmpeg；它是新增可选依赖，需解决 Windows/macOS/Linux 分发和缺失时的 assetWarnings。当前机器的 FFmpeg 可用于原型，不代表用户安装包已有此能力。

另一可行路径是独立受控浏览器截图：冻结快照，在独立 page 中创建同一 Pixi 场景，全部 video seek 到指定帧后截图。其成本是浏览器进程与包体依赖，不能简单截正在自由播放的用户页当作 deterministic MCP PNG。

推荐分期：编辑器详情预览先用浏览器；完整 Runtime 阶段同时确定截图取帧方案。若解码器缺失，返回明确 `assetWarnings` 和静态占位，不把图标当成该时刻真实帧。截图准备过程有界等待、不推进逻辑时间。

## 7. GIA 是独立的关键缺口

现有模拟器把 `Details.effectSlot(86)` / `fullscreenEffectSlot(87)` 声明为 string，并把 animationId 文本直接写入该槽；知识库的依据只包含空槽样本。新增预览时不能顺便宣称这条编码可供真机播放。

最新参考项目提供了更具体但仍待原始样本复核的线索：

- `giaExporter.ts` 的 component tag85 对应 Data 75/98，body 取 Details 的 **tag+1=86**。
- 其 body.501 写 animationId 整数，body.502 写 playSoundEffect 数字布尔；对应导入器也从该子消息读取。
- 即参考代码把 86 当作**子消息**，与当前模拟器把它当字符串冲突。这不是可以直接复制的等价表示。
- 参考实现没有给普通动效 layer 配置写入可靠的 property writer，也没有完整的 fullscreen 导出映射。

下一步需要使用含真实资源的原生 GIA 做最小差分：同一个普通动效分别换ID、切音效、切Above/Below；全屏分别换ID、切音效。定位完整槽结构后更新规范与 codec。空字符串旧存档和原始未知字节保留，不能将未知子消息按 UTF-8 解读再覆盖。此项不阻塞 JSON/Lua 内的预览原型，但阻塞“可可靠导出非空动效 GIA”的承诺。

## 8. 建议实施顺序与验收

| 阶段 | 交付与验收门槛 |
|---|---|
| A：资源接入与选择器 | 固定 catalog、同源缓存和 Range、搜索/图标/单素材预览；442 文件清单闭合，首次按需下载、离线重启复用、加载失败可重试 |
| B：编辑画布 | React 双平面、世界矩阵、普通 above/below、全屏固定 below、五画布；用彩色/棋盘背景验证而不是只在黑底“看起来正确” |
| C：Lua 试玩 | Runtime 状态、scene/paint/fingerprint、Pixi 不透明背景和双 pass、声音政策；Play/Stop、重复触发、同ID双实例、换ID、隐藏/激活、销毁/重开/玩家切换 |
| D：截图/复杂合成 | 按逻辑时间取帧，manual/realtime暂停一致、嵌套硬/软遮罩、多个动效重叠、解码/GPU资源回收；GIA 差分证据齐备后另补 codec |

主要修改入口：

```text
studio/assets/                  catalog、前端资源 URL 与元数据
studio/host/asset-cache.js       复用，必要时抽取通用 Range 响应
studio/host/ui-vfx-assets.js     新增媒体缓存与路由
studio/ui/authoring.js           ID兼容、配置保存
studio/ui/project.js             set白名单、类型及枚举校验
studio/ui/inspector.js           业务字段
editor-ui/index.js              属性分组、选择器与画布接入
editor-ui/ui-vfx-*.js            新增React显示适配
client/lua-runtime/src/scene.js  Play/Stop状态
client/lua-runtime/src/runtime.js  属性更新/时钟/观察快照
studio/play/session.js          effects投影、fingerprint、paint与scene
studio/play/browser-session.js  播放时钟、切玩家、暂停/重接生命周期
studio/play/pixi-renderer.js    双pass、背景、纹理及帧重绘
studio/play/audio-player.js     共用声音政策与独立动效声音身份
studio/host-png.js              帧提供器输出后的合成
studio/host/controller.js       异步准备与assetWarnings
web/server.js、dsh-plugin/      共用资源路由与分发入口
studio/gia/codec.js             获得非空原生证据后再改
```

有意义的实施验证应覆盖：合成公式的独立合成色块、T非灰、m=0/0.5/1、边缘接缝；硬/软嵌套遮罩；相反触发时间的同ID双实例；循环10→5秒边界；冷加载时Stop/销毁；manual固定帧重复截图；Range/ETag/损坏缓存；重开100次后video监听/纹理数量回落。平台至少覆盖当前 Chromium、目标 DSH/Electron，以及实际支持的 macOS/Safari；VP9 Profile1 的 canPlayType 只能作预检，最终以真实素材解码为准。

本次没有产品代码变更，因此未运行全仓安装/测试。实施后遵守仓库既有检查要求，合成测试自包含，不依赖 F 盘素材或远程 OSS。

## 9. 仍需明确的信息

1. **可立即实施：** 文件清单、格式、配套名称、缓存接入点、浏览器原生解码及 Pixi公式可行性均已核对。
2. **预览策略要明确：** 循环后半段、声音是否循环、Stop收尾、重新显示重播、全屏cover、素材原生尺寸与控件框的关系；参考实现并非统一且不等于真机证据。
3. **正式接入需验证：** 多实例显存/解码预算、CSS隔离/软遮罩合成、当前透明背景迁移、手动时钟和截图取帧。
4. **GIA缺失证据：** 非空原生动效配置及最小差分。已有空槽知识不能用作非空编码依据。
5. **资源发布状态：** `uivfx/` 已上传，全部文件公开下载哈希/MIME和抽查Range通过；JSON缓存时间与指定值不一致，详见§2.4。浏览器走同源路由时无需把OSS CORS作为前置阻塞。

## 10. 主要来源入口

- 本地资源：`F:/UGC_UI_VFX/player.js`、`data.hash.json`、`播放器使用说明.txt`。
- 最新参考：`F:/ugc-tool/src/views/ClientUIAnimationEditor/{uiVfxAssets.ts,uiVfxRenderer.ts,UIVfxMedia.vue,UIVfxLibrary.vue,ClientUIAnimationEditor.vue,giaImporter.ts,giaExporter.ts}`，提交 `7bdf307`。
- 参考测试：`F:/ugc-tool/scripts/test-client-ui-vfx.cjs`；本次阅读其模拟DOM/媒体API测试，未将其视为真实浏览器或真机证据。
- 现有接入：[图片缓存](image-assets.md)、[音频缓存](audio-assets.md)、[控件支持](control-support.md)。
- 官方 API：[客户端控件 API](https://act.mihoyo.com/ys/ugc/tutorial/detail/mhtakr07vej4)。
- 官方规则：[界面动效](https://act.mihoyo.com/ys/ugc/tutorial/detail/mh2iyk9fa4gy)、[全屏动效](https://act.mihoyo.com/ys/ugc/tutorial/detail/mhbn4i09l5ns)；本次引用2026-10-24本地核对记录。
- 实际混合状态：安装的 Pixi 8.20 `lib/rendering/renderers/gl/state/mapWebGLBlendModesToPixi.js`、`shared/texture/sources/VideoSource.js`。
