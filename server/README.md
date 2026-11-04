# simulator/server

单进程薄服务端：关卡、最多 8 个玩家座位及其角色的自定义变量，以及客户端↔服务端信号队列。支持存档内的轻量 `serverLogic` 规则：实体创建时初始化变量，或监听客户端信号后设置变量、向当前玩家 / 指定座位 / 全部玩家发送客户端脚本信号。**不执行官方节点图。**

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

`serverLogic` 是模拟器存档格式，不是官方节点图格式。每条规则按触发事件顺序执行 `actions`：

- **监听客户端信号**：以 `signalName` 监听；省略 `event` 或设为 `"signal"` 均表示信号规则，旧存档无需迁移。
- **实体创建时**：设置 `event: "entityCreated"` 和 `entityType`，不需要 `signalName`。实体可选 `Level`、`PlayerSelf` 或 `Player1`–`Player8`；仅支持用字面量执行 `setCustomVariable`，不支持引用信号参数或发送客户端脚本信号。

两种动作：

- `setCustomVariable`：可写 `Level`、`PlayerSelf`（发信号或刚创建的玩家）或固定座位 `Player1`–`Player8`。
- `sendClientScriptSignal`：`target` 为 `PlayerSelf`（发信号者）、`Player1`–`Player8` 或 `AllPlayers`（本局全部试玩玩家）。

动作的 `value` 或 `params` 中，`{ "fromSignalParam": 0 }` 表示引用监听信号的第一个参数（从 0 开始）；用于转发时会保留原始参数类型。

### 使用与停用

- 编辑器「使用服务端逻辑」控制整份逻辑是否参与试玩，对应 `serverLogic.enabled`；每条规则的「启用规则」对应 `rules[].enabled`。
- 两级开关都默认启用，旧存档省略字段时保持原行为。仅接受布尔值；设为 `false` 相当于不使用该逻辑／规则，但保留完整配置与顺序，重新启用无需重新填写规则。
- 总开关关闭时不执行任何初始化或信号规则；总开关打开时仅执行启用的规则，不覆盖各规则自己的开关状态。
- 开关随完整 JSON 存档保存，编辑器保存后**下次试玩／重建运行时**生效，不热切换已运行的试玩，也不回滚已经写入的变量。
- 停用只控制自动规则，不关闭薄服务端：客户端信号仍记录，Lua 变量读写和工具手动 `serverSet` / `serverSend` 仍可使用。停用规则仍须通过格式校验，不能当作保存不完整草稿的方式。这不是官方节点图挂载或 GIA 导出能力。

### 实体创建时初始化（模拟器策略）

在编辑器「服务端逻辑」点击「＋ 实体创建时」，选择创建实体，再添加变量名和值。也可用 `setServerLogic` 写入：

```json
{
  "rules": [{
    "id": "initialize-gold",
    "event": "entityCreated",
    "entityType": "PlayerSelf",
    "actions": [
      { "kind": "setCustomVariable", "entityType": "PlayerSelf", "name": "Gold", "value": 10 }
    ]
  }]
}
```

- 试玩先加载配置中的变量，再调用 `server.initializeEntities()`，最后启动客户端 Runtime / Lua。客户端 `OnStart` 首次读取即可取得初始化值。
- 每局按 `Level` → `Player1` → … → 本局最后一个座位派发；同一实体匹配的规则及其动作保持存档顺序。`Level` 只触发一次；`PlayerSelf` 对每位参与玩家分别触发，动作中的 `PlayerSelf` 指刚创建的玩家；固定座位规则只在该座位参与时触发。
- `Level` 创建事件没有当前玩家，因此拒绝向 `PlayerSelf` 写入，需指定 `Level` 或固定座位。初始视角不影响初始化结果。
- 初始化每局只执行一次；步进、暂停/继续、切换玩家视角不重复执行，重新开始或重建设备试玩时重新执行。直接使用薄服务端时应在配置完成后显式调用 `initializeEntities()`；`reset()` 后可再次初始化。
- 当前不建模中途加入、动态实体或角色创建事件；不宣称与官方实体生命周期的时序完全一致。

证据边界：`evidence_source=inferred`、运行端 `simulator`、`device_status=not_required`，这是本项目初始化策略，不是官方节点图实现。行为回归见 `server/test/server.test.mjs`、`studio/test/autotest.test.mjs`；浏览器编辑保存见 `web/test/server-logic-browser.test.mjs`。
