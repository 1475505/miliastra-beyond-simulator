# Harness 升级后会话无法加载与历史恢复

上级：[DSH 插件](../README.md)。适用：使用 `wonderland-lua-builder`（千星 2D+Lua 游戏制作）预设的会话，在升级 Harness 后无法新建、恢复或继续。

## 0.2.2 的预设兼容问题

Harness `0.2.2-rc.1` 的 `@deepseek-ai/dsh-tool-subagent-control` 主入口已统一注册 `send_message`、`interrupt_agent`、`list_agents`，不再导出 `/list-agents`。插件 2.2.3 及之前的预设同时加载主入口和这个旧子入口，会出现：

```text
ERR_PACKAGE_PATH_NOT_EXPORTED
tool-subagent-list-agents (@deepseek-ai/dsh-tool-subagent-control/list-agents): never started
agent-preset/invalid
```

历史会话记录预设 ID，恢复时仍须挂载该预设。预设加载失败会阻止恢复；界面上的“无法加载／可能已删除”不能单独证明日志丢失。DSH 的 JSONL 持久化服务没有删除日志的 API，但手动清理、使用不同的 `DSH_HOME`、文件损坏等仍需按实际文件检查。

2.2.4 按宿主是否可解析旧子入口决定是否禁用该行：旧宿主继续使用独立 `list_agents`，新宿主由主入口注册一次。保持预设 ID 与旧配置行 ID，便于原会话重新绑定，也避免破坏已有按行 ID 的 patch。npm peer 范围显式增加 `0.2.2-rc.1`；宿主准入范围与 npm 的预发布解析规则不同。

另同步持久化接口：查看尚未激活 Agent 的历史会话时，优先通过新版 `sessionPersistence.stat().header` 绑定模拟器工作区，旧宿主回退 `inspect().meta`，避免原工作区被误显示为“未绑定”。

## 用户恢复步骤

1. **保存工作并完整退出 Harness。** 确认所用数据根：默认 Windows 为 `%USERPROFILE%\.dsh`，macOS/Linux 为 `~/.dsh`；设置了 `DSH_HOME` 时以它为准。复制该目录作备份，尤其保留 `sessions/`、`attachments/`、`storages/`、`profiles/`、`.agent-presets/`。这也保留了工作区分组、附件与用户配置。
2. **安装含修复的插件到实际使用的 profile。** Desktop 使用 `desktop`，CLI Web 使用 `web`。Desktop 先通过应用菜单“管理 dsh 命令…”注册或修复内置命令，打开新终端核对 `dsh --version`，然后退出应用再执行安装；新版 Desktop profile 由其内置 CLI 管理，npm 全局安装的 CLI 不能修改它。本地修复包示例：

   ```powershell
   dsh plugin --profile desktop add "E:/path/to/dsh-plugin-beyond-simulator-2.2.4.tgz"
   ```

   对 CLI Web 换成 `--profile web` 并使用对应的 Web CLI。npm/GitHub 安装需确认远端已经包含修复；源码和本地包存在不表示公开版本已发布。DSH 0.2.2 需要 Node.js 24.9+，Desktop 内置命令使用应用自带运行时。
3. **重启后在设置 → Agent 预设检查“千星 2D+Lua 游戏制作”。** 在“查看配置”中确认旧 `tool-subagent-list-agents` 有兼容性 `disabled` 条件。然后从原工作区打开原会话；无需改会话 ID、重建对话或替换日志里的 `agentPreset`。
4. **仍报同一入口错误时检查用户覆盖。** 新版默认读取声明式预设，通常是插件生成项加 `$DSH_HOME/profiles/<profile>/cordis.patch.yml` 覆盖。若用户保存过整个 `config.plugins`，旧列表可能遮住升级后的包；保留自定义配置并修正那一行。只修改旧 `.agent-presets` 目录不一定会影响新版。
5. **恢复后导出一份可读记录。** DSH 0.2.2 会话标题更多菜单提供“复制会话为 Markdown”和“下载 Session 日志”；后者包含子会话与附件。Markdown 是便于阅读和交接的记录，原始日志备份用于完整恢复。

### 无需等待发布的应急修复

在确认运行 **DSH 0.2.2** 后，备份并修改实际加载的预设插件列表，将唯一的旧子入口行设为禁用，保留同级主入口：

```yaml
- id: tool-subagent-control
  name: '@deepseek-ai/dsh-tool-subagent-control'

- id: tool-subagent-list-agents
  name: '@deepseek-ai/dsh-tool-subagent-control/list-agents'
  disabled: true
```

将这段变化应用到“查看配置”所对应的来源，按原层级和缩进编辑；不要用这两项替换整份预设。由插件管理的包内 `dsh-plugin/cordis.patch.yml` 会被下次更新覆盖，适合作临时修复；用户 profile 覆盖需单独同步。保存后完整重启。旧 0.2.1 宿主仍有这个子入口，通用修复应采用 2.2.4 的条件判断而非永久禁用。

## 原始历史在哪里

默认位置：

```text
$DSH_HOME/sessions/
  --<规范化工作目录>--/
    <会话ID>/
      session.jsonl.zstd
      session.v3.jsonl.zstd
      session.v4.jsonl.zstd
```

也可能使用未压缩的 `.jsonl`。版本升级保留旧 generation，运行时选择最高版本；**同一 ID 的整个目录应一并保留**。不要把压缩文件当文本编辑，也不要通过删掉新版文件、改版本号或覆盖 `agentPreset` 来强行降级。

Windows 可先只列文件定位历史：

```powershell
$dshHome = if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $HOME '.dsh' }
Get-ChildItem (Join-Path $dshHome 'sessions') -Recurse -File -Filter 'session*.jsonl*' |
  Select-Object FullName, Length, LastWriteTime
```

| 观察结果 | 下一步 |
|---|---|
| 文件存在，预设报 `list-agents` 导入失败 | 按上述预设修复，重新打开同一个 ID。 |
| 文件存在，但当前列表找不到 | 核对 `DSH_HOME`、宿主连接、归档状态和原工作区；0.2.2 侧栏搜索支持会话 ID 子串。仅列表缺失不代表原始日志不存在。 |
| 文件存在，报旧版 `subagent/descriptor` 或迁移错误 | 官方 0.2.2-alpha.3/rc.1 修复过旧描述读取问题，先确认宿主版本。保留完整根目录和父子会话，再取具体错误；不要把所有读取失败都归入预设缺陷。 |
| 原会话目录确实不存在 | 从系统备份或曾复制的 `.dsh` 恢复；若只有游戏存档和 Lua，可在新会话重新加载工程，无法据此重建原聊天全文。 |
| 日志可读但 Agent 暂时不能激活 | 0.2.2 的 Markdown 导出使用被动历史读取，不要求启动 Agent；若菜单可用，可先导出记录。 |

技术支持至少需要：Harness 完整版本、插件版本、Desktop/Web 与 profile、预设错误原文、目标会话 ID、原始文件是否存在。日志含对话和附件信息，应由用户选择提供必要范围。

## 依据与回归入口

- **官方源码/文档**：`dsh-v0.2.2-rc.1`（`66491b05e3f05ad35bcdd4f6cd7ed26041d9e3db`），2026-11-06 核对；`evidence_source=documented`，运行端 `official_document`，`device_status=not_required`。
  - [控制工具迁移](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.2-rc.1/docs/upgrade-guide/v0.2.1-rc.1/subagent-control-tools/guide.zh.md)。该指南目录名不是移除子入口的发布版本证明；0.2.1-rc.2/rc.5 的 package exports 仍有旧入口，0.2.2-rc.1 已无。
  - [预设恢复与错误处理](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.2-rc.1/packages/api/session-controller/src/agent.ts)、[预设挂载](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.2-rc.1/packages/preset/agent-preset-registry/src/index.ts)。
  - [持久化布局与不删除日志的边界](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.2-rc.1/packages/session/session-persistence-jsonl/README.md)、[历史导出](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.2-rc.1/packages/session-query/session-log-export/README.zh.md)。
  - [Desktop 内置命令与插件管理](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.2-rc.1/apps/desktop/README.zh.md#bundled-command-runtime)。
  - [0.2.2-rc.1 发布说明](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.2.2-rc.1)：Node.js 24.9+、旧子代理描述修复、Markdown 导出与工具执行接口变化。
- **本地复现**：Windows / Node 24.21.0 / 隔离 Harness 0.2.2-rc.1 Web / 插件 2.2.3，预期预设可挂载，实际 `broken: tool-subagent-list-agents … never started`；`observed / simulator / not_required`。
- **回归**：Windows / Node 24.21.0 / 隔离 Harness 0.2.1-rc.2 与 0.2.2-rc.1 Web / 插件 2.2.4 均通过，`observed / simulator / not_required`。`scripts/smoke-harness-probe.mjs` 验证实际预设挂载、工具唯一性、持久化会话卸载后原 ID/消息恢复、冷历史工作区与新会话创建；`scripts/smoke-dsh-tools.mjs` 同时走旧单调用与 0.2.2 批处理执行接口。完整宿主用 `pnpm test:harness`；旧宿主可传 CLI 路径。该检查使用合成会话且不请求模型，不代表反馈者原始会话已逐一恢复，也不涵盖损坏日志的修复。
