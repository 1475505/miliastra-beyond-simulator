# Lua 2D 音效预览与按需缓存

## Lua 接口

本轮核对完整知识工作区 `knowledge/guide/Lua客户端UI脚本API.md`「关卡、音效与本地化」：

| 接口 | 返回值 | 作用 |
|---|---|---|
| `game.PlayAudio2D(audioId: integer)` | `integer` | 播放配置音效 ID，返回本次音效实例 ID |
| `game.StopAudio(audioInstanceId: integer)` | 无 | 停止指定实例 |
| `game.IsAudioAlive(audioInstanceId: integer)` | `boolean` | 查询实例是否存活 |

使用点号，不把素材 ID 当成实例 ID；文档没有声明音量、循环或文件 URL 参数。

```lua
local voice

function OnStart()
    voice = game.PlayAudio2D(50888)
end

-- 在需要停止的回调中：
-- if voice and game.IsAudioAlive(voice) then
--     game.StopAudio(voice)
-- end
```

## 素材目录与缓存

目录来源：`https://oss.070077.xyz/audio/data.json`，2026-10-06 核对 1,997 个不同 ID，均有 `audio/<id>.mp3` 路径和正数时长。路径相对于域名根，例：

```text
https://oss.070077.xyz/audio/50888.mp3
```

`studio/assets/audio-catalog.js` 固定这批白名单及毫秒时长。为减小随包数据，时长以 base36 字符串按 ID 顺序存储；解析后仍是秒数。已逐项比对当前远程清单的全部 ID/时长，无差异；没有下载全部音频。

缓存与图片复用 `studio/host/asset-cache.js`：

- 只在浏览器实际处理播放请求时按需下载，一个冷素材一次 MP3 GET；启动时不拉清单、不预下载。
- 进程内合并同 ID 请求、最多四个并行下载；文件锁协调同目录的跨进程冷加载，成功后原子写入。
- 磁盘命中不发 OSS HEAD/GET，重启后继续复用；已缓存的声音断网仍可播放。
- 失败冷却 60 秒；校验 MP3 帧结构，拒绝 HTML 错误页和截断文件。失败或解码异常不让 Lua Worker 报错退出。
- Web/DSH 统一同源 `/qxqy-audio/mp3-v1/<id>.mp3`，提供 `audio/mpeg`、12 小时 HTTP 缓存、ETag、HEAD 和单字节范围 Range。浏览器缓存到期访问的仍是本地服务，不触发 OSS 校验。
- 浏览器按 ID 复用解码音频，使用带容量控制的内存缓存；同一 ID 多次调用创建独立的播放源，可以叠加。

默认磁盘目录：

| 平台 | 路径 |
|---|---|
| Windows | `%LOCALAPPDATA%/beyond-simulator/audio` |
| macOS | `~/Library/Caches/beyond-simulator/audio` |
| Linux | `$XDG_CACHE_HOME/beyond-simulator/audio`，未设置时 `~/.cache/beyond-simulator/audio` |

启动前可设置 `QXQY_AUDIO_CACHE_DIR`。缓存位于运行 Node 服务的电脑/容器，不在 Lua 存档内。源文件覆盖更新后，可在退出宿主后清理音频缓存，再重新打开播放页并清理旧浏览器资源缓存；首版没有音频逐项刷新界面。缓存没有自动磁盘淘汰策略。

## 播放与生命周期

试玩页提供「开启声音 / 声音已开启 / 声音已关闭」。首次受浏览器自动播放策略阻止时，点击该按钮，或在页面内进行真实按键/点击，即可解锁；无需更改浏览器全局设置。悬停按钮可查看加载/解码错误。

每个 Runtime 保留实例序号、音效 ID、开始时间、存活与显式停止状态。快照观察不消费事件，MCP get/截图不会抢走浏览器声音。浏览器用本局标识 + 玩家索引 + 实例 ID 去重：

- 正常轮询不重复播放同一个实例。
- `StopAudio` 停止对应声音，包括尚未下载完的声音。
- 暂停试玩冻结媒体播放，继续从已播放位置恢复；重开、换设备、结束试玩、关闭页面会清理旧声音。
- 切换玩家只接入当前玩家仍活跃的声音，按逻辑已过时间定位，不重播其全部历史。
- 无浏览器时仍可检查 `playGet().audio`，但 Node/MCP 不向电脑扬声器输出声音，也不会仅为状态查询下载 MP3。
- 首次下载/解锁有延迟。已经接收到的新实例会在加载成功后播放一次，即使其逻辑时长已到；显式停止、结束试玩仍会取消延迟播放。首次接回已有场景只恢复仍存活的声音。冷加载不保证音画同步，缓存后的常规播放延迟较小。

### 明确的模拟器策略

官方文档明确三接口的签名与用途；以下不是新增真机证据：

- `IsAudioAlive` 按素材清单时长和 Runtime `clock.time` 确定，到时自然结束；不由浏览器下载/解码或设备音频时钟反向控制 Lua。`PauseLevelTime` 不暂停这条时钟；调试暂停不推进它，手动 step 可以推进。
- 未知 ID 返回一个不同的实例 ID，存活为 false，并记录去重警告；停止未知或已经结束的实例为 no-op。
- 每个 Runtime 最多保留 128 个活跃实例、最近 128 条播放记录；浏览器最多 64 个声音，超过上限回收最早项。
- 参数严格要求整数数值；整值浮点可用，字符串/小数拒绝。
- Runtime 单独使用时需注入 `audioDuration(id)`，Studio 统一注入固定目录。不在 Runtime 内访问网络或存储素材。
- 本轮接通上述 Lua API；没有新增循环、音量控制、空间音效、按钮 `clickAudioId` 自动播放或界面动效声音语义。

## 验证

环境：Windows x64、Node 22.23.2、Edge。`evidence_source=documented` / `official_document` 指本地 API 加工稿签名；`evidence_source=observed` / `simulator` 指下列实现验证，`device_status=not_required`。真机暂停/结束边界没有本轮观察，不宣称完全一致。

- `client/lua-runtime/test/audio.test.mjs`：真实 Lua 的返回值、独立实例、停止/自然结束、参数拒绝、回收上限。
- `studio/test/audio-assets.test.mjs`：固定目录、按需/并发/离线/损坏恢复/失败退避、多人隔离、非消费式快照。
- `studio/test/audio-player.test.mjs`：独立声音叠加、轮询去重、暂停定位、换玩家、冷下载取消、自然结束后的首次加载、自动播放解锁与销毁竞态。
- `web/test/audio-assets.test.mjs`：HTTP 缓存/ETag/Range；设置 `QXQY_BROWSER` 后运行生产试玩页面，由真实 Lua 触发，使用 Web Audio 解码合成 MP3，检查非零波形、真实按键解锁、播放/停止计数与冷加载取消。
- `dsh-plugin/test/image-assets.test.mjs` 同时覆盖 DSH 注册的音频 HTTP 路由及缓存复用。
- 实际 OSS 仅抽查 `50888`、`20001`、`10008`：均成功下载并通过 MP3 帧校验。自动测试全部使用仓库内合成 440Hz 音频，不依赖网络。
- 发版前根 `pnpm test`：300 通过、7 项环境可选跳过、0 失败；随后启用 Edge 运行音频、图片和内嵌试玩相关测试 5/5 通过。浏览器播放链路验证不等于对扬声器作听觉验收，也不等于 DSH Desktop 自定义协议已实机验收。
