# 界面动效与全屏动效播放

上级：[Studio](../README.md#专题树)。Web / DSH 共用编辑画布和浏览器试玩支持 C/T 视频动效；Lua Runtime 只管理确定性播放状态，网络和浏览器解码故障不进入 Lua VM。

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

编辑器和试玩都使用 **DOM 双平面**，紧邻现有透明 Pixi Canvas／普通 DOM 控件。舞台 `isolation:isolate`、平面宿主 `display:contents`；不把 T/C 包进新的 transform/opacity/mask 隔离组，也不要求把 CSS 背景迁进 Pixi。每对平面始终按 `T1,C1,T2,C2` 排列，同一全局层内遵循场景绘制顺序，重新排序不重启解码器。只有场景同步调整平面顺序；蒙版素材异步加载／刷新在原位重绘，不把受影响的后层动效移到最前。

普通动效采用素材原生宽高乘世界变换，控件矩形不直接拉伸视频；全屏采用居中等比 cover 并在舞台边界裁切。祖先[图片遮罩与羽化](control-support.md#图片遮罩与羽化)和网格视口以世界坐标投影到两个平面的覆盖率；嵌套覆盖率相乘，得到 `m*C + B*(1-m+m*T)`。这些布局/羽化细节是模拟器预览策略。

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

非空原生动效 GIA 的配置结构仍未核实。现有 `Details.effectSlot(86)` / `fullscreenEffectSlot(87)` 的string声明仅有空槽证据。第三方 `ugc-tool` 的 `7bdf307` 将普通动效86视为子消息（501为整数ID、502为音效布尔），与当前文本编码冲突；该实现也没有可靠的layer和完整fullscreen映射，不能直接照搬。

后续须用原生非空GIA分别改变ID、声音和Above/Below做最小差分，确认后再改codec。JSON/Lua预览不证明非空动效可可靠导入真机；未知字节不能按UTF-8猜读覆盖。

## 素材来源与更新

素材由 @xiaomol444 提供，参考 `ugc-tool` 提交 `7bdf307`。名称/分类源为 `https://oss.xiaomol444.xyz/ugc-tool-data/Public/UIVfx/data.json` 与相邻 `i18n/{zh-cn,en-us}.json`；`data.hash.json` 使用 TextMap hash，不能直接配合 `uiEffect.title.*` 翻译。

- 媒体格式为 VP9 Profile1、8-bit yuv444p、30fps，无音轨；编码宽度为素材宽度两倍，左右为 C/T。声音使用独立 MP3。部分视频编码宽度超过4096，不能假定所有设备都能解码；颜色转换未证明与游戏一致。
- 发布先上传媒体，再更新目录；内容变更须同步 `assets/ui-vfx-data.json` 的字节数/SHA-256及缓存版本。路径为前缀内相对路径，去掉开头 `/` 再拼接，避免丢失 `uivfx/`。
- 更新后核对公开内容、MIME、Range 和实际 Cache-Control；源站/CDN 可能覆盖上传设置，必要时使用版本路径。宿主按固定清单验证，浏览器同源缓存不依赖 OSS CORS。

## 验证与来源

- API：2026-10-24 本地官网对齐稿的[客户端控件API](https://act.mihoyo.com/ys/ugc/tutorial/detail/mhtakr07vej4)、[界面动效](https://act.mihoyo.com/ys/ugc/tutorial/detail/mh2iyk9fa4gy)、[全屏动效](https://act.mihoyo.com/ys/ugc/tutorial/detail/mhbn4i09l5ns)。字段、签名和全屏下层规则为 `documented / official_document`。
- 回归：`studio/test/ui-vfx.test.mjs`（目录、Lua生命周期、JSON、非消费式快照、PNG边界）；`studio/test/audio-player.test.mjs`（声音代次、静音/解锁、暂停、失败/重试、冷加载取消）；`web/test/ui-vfx.test.mjs`（HTTP缓存及真实浏览器）。
- 浏览器用例使用自包含的合成 VP9 Profile1 / yuv444p 视频，独立已知的 C/T/B 颜色断言，不依赖 OSS 或仓库外素材。覆盖彩色T、羽化、重叠实例顺序及后层蒙版异步完成、Above/Below、全屏cover、手动定帧、循环、预算、损坏/缺失媒体、编辑器搜索/重试、页面切换与解码器清理。
- 模拟器回归结果标为 `observed / simulator / not_required`；千星游戏时序、精确尺寸/色彩及未覆盖的浏览器/手机/操作系统仍保持 `device_status=pending`，不能把 Chromium 测试作为真机通过。

浏览器观察范围为 Windows / Edge，合成媒体及少量实际 OSS 样本可解码，manual 视频遵循逻辑定帧；未做全素材可用性或听感验收。
