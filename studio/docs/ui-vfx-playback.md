# 界面动效与全屏动效播放

2026-10-30 源码接入。Web / DSH 共用编辑画布和浏览器试玩支持 C/T 视频动效；Lua Runtime 只管理确定性播放状态，网络和浏览器解码故障不进入 Lua VM。

## 使用

1. 新建或选中【界面动效】／【全屏动效】，点击属性栏的【选择素材】，按 ID、中文或英文名称搜索；也可直接输入动效索引。
2. 编辑画布自动静音预览，提供【重播 / 重试】与【停止预览】。普通动效支持【所有控件之上／之下】，全屏动效固定在普通控件下方。
3. 【播放动效音效】影响试玩；试玩音量沿用现有声音按钮和浏览器手势解锁。工具／自动化启动默认静音。
4. Lua 普通动效可调用 `control:PlayAnimation()`、`control:StopAnimation()`，可写 `animationId`、`playSoundEffect`、`layer`。全屏控件仅使用文档声明的 `animationId`、`playSoundEffect`，没有新增专属 Play/Stop Lua 方法。

新源码需要构建、重启 Web / DSH 宿主并刷新页面。`/` 的**编辑模式**仍使用静态 Host PNG；切换到试玩后显示动效。`/editor` 和 DSH 编辑画布直接显示动态预览。

## 资源与故障隔离

- `assets/ui-vfx-data.json` 固定 **196 条素材（159 界面、37 全屏）和439个媒体**的名称、尺寸、时长、字节数、SHA-256；运行时不下载目录 JSON，离线启动和编辑无需等待 OSS。
- 默认源为 `https://oss.070077.xyz/uivfx/`。浏览器仅访问同源 `/qxqy-vfx/ct-v1/{video,icon,audio}/...`；Web 和 DSH 共用 `host/ui-vfx-assets.js`，不依赖源站 CORS。
- 按需下载、同资源并发去重、每类4路下载、跨进程磁盘锁、原子落盘。读取缓存和下载均核对固定大小/SHA-256；损坏磁盘缓存会重新获取。GET / HEAD / ETag / 单字节区间 Range 均支持。
- 缓存目录可用 `QXQY_UI_VFX_CACHE_DIR` 指定；默认位于宿主用户缓存的 `beyond-simulator/ui-vfx`。`QXQY_UI_VFX_SOURCE` 可替换同结构资源源地址，内容仍须符合固定清单。
- 上游404、连接/下载超时、磁盘错误、内容不匹配通过当前请求的404/502返回；错误响应 `no-store`，不会停止宿主、Worker 或场景轮询。自动请求失败冷却60秒，单次远端下载限12秒、8 MiB，跨进程锁等待上限30秒。
- 浏览器加载限30秒；无法解码、尺寸错误、合成不受支持等只隐藏该实例，并在画布角落汇总提示。失败代次不逐帧重载，显式重播会释放旧解码器、重新加载，并绕过该资源之前的失败冷却；正常缓存仍可复用。未知/跨 scope 索引保留配置并显示缺失状态，空索引不报错。
- 动效图层 `pointer-events:none`，失败不拦截编辑/试玩输入。停止、删除、切玩家、重开、离开试玩、页面销毁释放对应视频、监听器、定时器和 Canvas；旧下载完成不会复活已停止的实例。

## 合成、层序与预算

`play/ui-vfx-player.js` 被编辑器和 `PixiPlayRenderer` 共用。每个播放实例持有一个静音 video，以及相邻的 T / C 两个 Canvas：

```text
T: multiply
C: plus-lighter
out.rgb = C + background.rgb * T
```

编辑器和试玩都使用 **DOM 双平面**，紧邻现有透明 Pixi Canvas／普通 DOM 控件。舞台 `isolation:isolate`、平面宿主 `display:contents`；不把 T/C 包进新的 transform/opacity/mask 隔离组，也不要求把 CSS 背景迁进 Pixi。每对平面始终按 `T1,C1,T2,C2` 排列，同一全局层内遵循场景绘制顺序，重新排序不重启解码器。

普通动效采用素材原生宽高乘世界变换，控件矩形不直接拉伸视频；全屏采用居中等比 cover 并在舞台边界裁切。祖先矩形/羽化遮罩和网格视口以世界坐标投影到两个平面的覆盖率；嵌套覆盖率相乘，得到 `m*C + B*(1-m+m*T)`。这些布局/羽化细节是模拟器预览策略。

并发预算：最多12个实例、24 Mi packed像素；每个输出平面最长边1536像素、约1 Mi像素。超限实例单独跳过并提示；前面实例停止后可重新获得预算。帧更新目标30fps，复杂遮罩或大量视频的实际帧率取决于浏览器和设备。

## 时钟与声音策略

以下均是明确的**模拟器策略**，不作为新增的千星真机契约：

| 行为 | 当前策略 |
|---|---|
| 开始 | 配置了有效索引的实例创建时自动开始；普通 `PlayAnimation()` 或修改索引增加 generation 并从当前逻辑时间重播 |
| 停止 | `StopAnimation()` 清除该实例画面、停止配套声音；再次 Play 从头开始 |
| 循环 | 标记为 loop 的素材先播完整片段，随后循环后半段（当前目录为0–10秒后循环5–10秒）；单次素材到逻辑时长后释放 |
| 暂停/单步 | 暂停视频并 seek 到逻辑帧；重复 get / 截图不推进时间。实时播放自然解码，按 Runtime 时间校正漂移 |
| 显隐 | 不可见或祖先未激活的实例不建立浏览器解码器；逻辑时间继续，恢复可见时投影到已过去的时间 |
| 音频候选 | 每个 control ID / generation 确定一条候选，写入非消费式 effects 快照；同素材不同实例独立播放 |
| 声音循环 | 每代只播一次，不随视频后半段循环；暂停后按逻辑偏移恢复。关闭声音配置立即停止该实例声音 |
| 冷加载声音 | 超出配套声音逻辑时长则丢弃；Stop/重开/销毁后异步结果不迟到播放。与 `game.PlayAudio2D` 保留一次冷播放的策略不同 |
| 手动时钟 | 动效画面支持确定性 seek，配套声音保持静默；音频设备时间不驱动 Lua |

`effects` 是快照的独立侧通道，包含实例 ID、素材 ID、generation、startedAt、声音候选、全局层、世界矩阵与遮罩；不依赖 scene delta 是否变化，不被读取动作消费。媒体字节可以共享，但 video/currentTime/播放状态不按素材 ID 共享。

## 截图与 GIA 边界

Host PNG（包括 MCP 截图和 `/` 的静态编辑预览）没有视频解码器，当前省略视频帧并返回 `assetWarnings`，不额外下载视频、不推进 Lua 时间；真实浏览器截图可以包含已合成的动态画面。

非空原生动效 GIA 的配置结构仍未核实。JSON/Lua 播放接入不代表已有文本槽编码可用于真机导入；证据缺口与参考子消息线索见[调研 §7](ui-vfx-preview-research.md#7-gia-是独立的关键缺口)。

## 验证与来源

- API：2026-10-24 官网对齐的本地 `ClientUIAnimationControl`、`ClientUIFullscreenAnimationControl`、`Enum.UIAnimationLayer` 文档；字段/签名为 `documented / official_document`。全屏下层规则来源见[调研基线](ui-vfx-preview-research.md#1-调研基线与证据)。
- 回归：`studio/test/ui-vfx.test.mjs`（目录、Lua生命周期、JSON、非消费式快照、PNG边界）；`studio/test/audio-player.test.mjs`（声音代次、静音/解锁、暂停、失败/重试、冷加载取消）；`web/test/ui-vfx.test.mjs`（HTTP缓存及真实浏览器）。
- 浏览器用例使用自包含的合成 VP9 Profile1 / yuv444p 视频，独立已知的 C/T/B 颜色断言，不依赖 OSS 或仓库外素材。覆盖彩色T、羽化、重叠实例顺序、Above/Below、全屏cover、手动定帧、循环、预算、损坏/缺失媒体、编辑器搜索/重试、页面切换与解码器清理。
- 模拟器回归结果标为 `observed / simulator / not_required`；未由本次验证覆盖的千星游戏时序、精确尺寸/色彩、其他浏览器/手机/操作系统仍保持 `device_status=pending`，不能把 Chromium 测试作为真机通过。

### 2026-10-30 集成验收

源码基线为 `19ca7bd` 加本次动效集成工作树；平台为 Windows / Microsoft Edge，浏览器用例通过 `QXQY_BROWSER` 指定本机 `msedge.exe`。下表均为 `evidence_source=observed`、运行端 `simulator`、`device_status=not_required`。

| 检查 | 结果 |
|---|---|
| `pnpm install --frozen-lockfile` | 通过，锁文件无需更新 |
| `pnpm test` | **426 通过、18 按环境跳过、0 失败**；覆盖 Runtime、Server、Studio、DSH、MCP、Web |
| `node --test web/test/ui-vfx.test.mjs`（设置 `QXQY_BROWSER`） | **3/3 通过**；包括 HTTP 故障/缓存/Range、实际浏览器 C/T 像素断言、编辑器交互和预览模式切换 |
| 浏览器输入/声音回归 | `web/test/key-input-browser.test.mjs` 通过；`web/test/audio-assets.test.mjs` **2/2 通过**，含自动化默认静音和显式声音开关 |
| `pnpm pack:release` | Web、MCP、DSH 三个包构建成功 |
| `pnpm test:packages` | 仓库外独立安装通过；dsh-tools `0.1.0-rc.6`、`0.2.0-rc.2`、`0.2.1-rc.2` 三组兼容矩阵全部通过，含打包后的动效快照、PNG边界、媒体路由/Range断言 |
| `pnpm test:harness` | **Harness 0.2.1-rc.2 通过**；真实 CLI 安装、Web 启动、Skill/预设发现、工具、附件、HTTP 试玩、语言与插件重启生命周期 |
| `git diff --check` | 通过 |

全仓命令中的环境跳过项保留其原始结果；动效、声音和键位浏览器用例另外显式启用 Edge 运行。测试曾发现旧 DSH 清理数量断言未计入新增媒体路由，以及旧音频浏览器断言未反映自动化默认静音；已更新对应断言并通过复验。

**实际 OSS 媒体检查：** 使用默认资源源和正式同源缓存路由，在编辑器及独立试玩页加载 `10001017`（能量满值1）与 `10001043`（点击效果2）。两个 WebM 和本次选中的 `audio/10001017.mp3`、`audio/10001043_02.mp3` 均返回200，通过固定清单校验；浏览器成功解码两个视频和两个 MP3。手动时钟步进到 **0.5秒** 后，视频均为 `currentTime=0.5`、`paused=true`，画面可见，动效警告为空，页面异常为空；声音按钮保持【声音已关闭】，本次没有进行听感验收。

原始报告 `checkedAt=2026-10-29T17:19:34.450Z`（北京时间2026-10-30），位于本机 `C:/Users/liul/AppData/Local/Temp/opencode/ui-vfx-research-20261028/integrated-verification/`：`report.json`、`real-editor.png`、`real-play.png`；复现脚本为上一级 `verify-integrated.mjs`。这些本地文件是附加实测证据，仓库内回归仍只使用自包含合成媒体。

本次验证的本地安装包身份如下，未提升版本或发布；后续重新打包应以新的 `release/manifest.json` 为准：

| 包文件 | SHA-256 |
|---|---|
| `dsh-plugin-beyond-simulator-2.2.1.tgz` | `d901a0c19c557036481e9518e166e40bc222ff7f75721af9f3faa4c997443bfd` |
| `beyond-simulator-mcp-0.5.1.tgz` | `fec5442fab6c57faf4d6ebd0624e6d6b1171de17d0dfb6e2e0287aab2a0825dd` |
| `beyond-simulator-web-0.5.1.tgz` | `0078f789264eb4065d7f495cab4038cf48ae2031be1dd564265ee15325a7420a` |

### 同日代码整理与本地预览

合并视频加载失败/移除实例时的媒体释放逻辑；实例同步共用一份目标 ID 集合，删除重复遍历和 Map 写入；媒体完整性校验统一在缓存读取与下载入口执行，去掉返回前的重复计算。「联系作者」增加素材贡献者致谢，并补齐中英文文案与术语查询记录。

整理后冻结锁文件安装和全仓测试通过（426 pass / 18 环境 skip / 0 fail），Edge 动效3项及联系/语言1项浏览器回归通过。本轮还修正联系/语言测试对用户本机字体配置、默认文本框裁切尺寸的依赖，改用隔离的系统字体配置及足以容纳验证文字的控件。Web/DSH 已重新构建；上表安装包仍对应整理前的验收批次。

资源上传、原始媒体统计、先期 Pixi 双 pass 实验和来源记录保留于[预览调研](ui-vfx-preview-research.md)；本文为当前实现入口。
