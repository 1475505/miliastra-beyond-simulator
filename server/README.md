# simulator/server

单进程薄服务端：关卡、最多 8 个玩家座位及其角色的自定义变量，以及客户端↔服务端信号队列。支持存档内的轻量 `serverLogic` 规则：监听客户端信号后设置变量，或向当前玩家 / 指定座位 / 全部玩家发送客户端脚本信号。**不执行官方节点图。**

```sh
cd simulator/server
npm test
```

## 已文档契约

- Lua `Enum.CustomVariableEntityType` 仍只有 `Level` / `PlayerSelf` / `AvatarSelf`。`PlayerSelf` / `AvatarSelf` 相对**发出 Get/Set/信号的那位客户端**。
- 模拟器额外提供固定座位 `Player1`–`Player8` 与 `Avatar1`–`Avatar8`，供工具、服务端逻辑和快照区分玩家。
- 变量按名索引，同一实体槽上不可重名。
- `设置自定义变量` 即使新值等于旧值也会触发变化事件；`是否触发事件=否` 时不通知。
- 整数合法范围 `-2147483647 ~ 2147483647`；越界保留上一次合法值。
- 客户端 `ServerSignal:SendSignal` 参数按添加顺序入队；`RegisterServerSignalHandler` 收到的 `params` 是值数组。
- 联机下服务器发信号最低延迟 100ms（官方）。配置里出现非信号/变量节点时加载失败。

## 模拟器策略（不是官方语义）

| 项 | 策略 | 原因 |
|---|---|---|
| Lua `GetGlobalCustomVariableValue` 读不存在的变量 | 返回 `nil`，并记一条 `engine` 日志 | Lua API 未写缺省；节点图「类型默认值」在无类型信息时无法构造 |
| 单人信号延迟 | 默认 0；`onlineLatencyMs > 0` 时服务端→客户端按该毫秒延迟投递 | 官方只写了联机 100ms |
| 容器从 Lua Get | 每次推一张新表（值拷贝） | 节点图引用语义未在 Lua API 证实 |
| 未声明类型的 `setVar` | 按值推断并允许动态创建 | 节点图允许 `设置自定义变量` 动态建变量 |
| 试玩人数 | `playerCount` 1–8；每位玩家一份独立 Lua Runtime | 官方是多客户端连同一关卡；模拟器在同一进程内并列 |
| `PlayerSelf` | 绑定到发信号/读变量的那位玩家座位 | 与官方「玩家自身」一致，不是全局单槽 |

试玩层通过 `attachRuntime(runtime, { playerIndex })` 或 `attachRuntimes(list)` 接到 `lua-runtime`，不要在本目录实现 Lua 绑定。服务端日志只存在 `server.snapshot().logs` / 试玩快照的 `serverLogs`，不会写入客户端脚本 `print`/`printerr` 通道。

## 可执行服务端逻辑

`serverLogic` 是模拟器存档格式，不是官方节点图格式。每条规则以 `signalName` 监听客户端信号，顺序执行 `actions`：

- `setCustomVariable`：可写 `Level`、`PlayerSelf`（发信号的那位玩家）或固定座位 `Player1`–`Player8`。
- `sendClientScriptSignal`：`target` 为 `PlayerSelf`（发信号者）、`Player1`–`Player8` 或 `AllPlayers`（本局全部试玩玩家）。

动作的 `value` 或 `params` 中，`{ "fromSignalParam": 0 }` 表示引用监听信号的第一个参数（从 0 开始）；用于转发时会保留原始参数类型。
