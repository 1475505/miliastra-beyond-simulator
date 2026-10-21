# 实机脚本目录：显式复制同步

## 人工流程

1. 首次把 GIA 导入千星沙箱，建立脚本映射和必要的挂载。
2. 若控件索引被重映射，在模拟器校准后选择「全量替换脚本索引」（可能误改非索引内容，自动备份）或「复制提示词给 AI」（包含新旧映射读取方式），更新内联源码与相关 `.lua` 文件；边界见 [Lua 索引同步](control-guid-sync.md)。引用未处理时继续保留 `controlGuidChanges`。
3. 打开 Web `/editor` 或 DSH 的「Lua 脚本 → 实机脚本同步」。依次填写项目脚本文件夹、千星沙箱脚本文件夹、游戏里的项目子文件夹，以及模拟器存档文件。可以点击「发现本机目录」选择账号和关卡，也可粘贴完整路径。字段下方提供填写提示与复制路径示例，帮助核对源位置和目标位置。
4. 「保存设置」将脚本位置写入完整存档；不复制文件。「保存存档并查看更新」提交当前脚本/逻辑草稿、保存完整存档，再展示逐脚本来源、目标路径、新增/更新已有文件/内容相同/无法复制和更新前后代码。
5. 勾选本次文件，点击「确认复制 N 个脚本」。取消、打开存档、AI 配置、预览都不写实机文件。复制成功后，在千星沙箱保存并重新试玩。

例如工作区是 `E:/qxqy-lua`，脚本为 `workspace/topo5/src/view.lua`：

```text
workspaceDir:     workspace/topo5
clientImportRoot: C:/Users/<用户>/AppData/LocalLow/miHoYo/原神/BeyondLocal/<UID>/Beyond_Local_Save_Level/<编辑器ID>/external_lua_file/default_import_file
clientSubdir:     workspace/topo5

结果：<clientImportRoot>/workspace/topo5/src/view.lua
```

默认保留导入 GIA 的脚本映射路径；调整子目录时必须核对实机映射仍指向该位置。远程浏览器填写的是 **Web/DSH/MCP 宿主机器** 的目录。

## 数据与源码

完整存档 version 4 新增可选 `scriptSync: { version: 1, workspaceDir, clientImportRoot, clientSubdir }`；旧存档缺省为 `null`，支持完整存档导出、加载和另存，不写入 GIA。清除配置只更新并保存存档，不删除实机文件。

同步清单为存档登记的全部 Lua 脚本（含未挂载的 require 模块），不是递归镜像目录。路径必须在所选工作区脚本目录内，以 `.lua` 结尾。不存在、重复目标、路径穿越、符号链接目标等显示错误，错误项不能选择。

内容沿用试玩语义：非空白内联 `source` 优先，否则读取工作区 `path`。两份内容不同时明确提示，可查看项目文件内容并选择「改用项目文件里的代码」，然后重新保存和预览。不会自动重写 Lua 数字或修改脚本映射/挂载。新增脚本文件仍需在千星沙箱建立脚本映射。

## 确认与备份

Host 保存一个进程内同步计划，指纹包含完整存档、源文件、目标路径及原文件内容。确认时重新检查；工程/源码/目标有变化则要求重新预览。仅接受明确的 `confirmed: true`、有效计划 ID 和选中文件 ID；使用后计划失效。尚有未确认的控件索引引用时拒绝复制。

确认还要求当前完整存档已保存、磁盘存档哈希仍匹配。覆盖前备份原始字节到工作区 `.qxqy-script-sync-backups/<批次ID>/<目标相对路径>`（不在实机目录内），再用临时文件和 rename 替换。逐文件返回成功/失败；不是跨文件原子事务。未选中、未变化或实机额外文件不删除、不覆盖。备份按回执路径手工恢复。

配置持久化在存档；待确认计划和最近回执仅属于当前宿主会话，重启后重新检查差异。

## AI 更新接口

MCP 与 Harness 共用 `qxqy_script_sync({ action, args })`，MCP 另带工程 `handle`。支持：

| action | args | 作用 |
|---|---|---|
| `discover` | 无 | 发现宿主本机的账号 / 关卡脚本目录。 |
| `status` | 无 | 读取配置及最近一次复制回执。 |
| `configure` | `config`、`expectedRevision` | 设置或清除目录绑定，不复制文件。 |
| `save` | `expectedRevision`、可选 `path` | 保存当前完整存档；首次需工作区相对路径，后续可沿用已加载 / 保存的路径。拒绝覆盖外部已修改的存档或未加载的已有文件。 |
| `preview` | 无 | 返回计划 `id` 和逐脚本 `rows`，包含来源、目标、新旧源码、差异状态与错误。 |
| `apply` | `planId`、`scriptIds`、`confirmed: true` | 复制本次选择的脚本，返回 `completed`、`results` 和 `backupRoot`。 |

用户要求更新已绑定目录时，AI 可在授权范围内完成「保存 → 预览 → 复制」，无需用户再到编辑器点击。仅绑定目录或查看差异不会触发复制。先核对控件索引引用和源码差异；非空白内联 `source` 优先于工作区文件，不能只改磁盘文件后就复制旧内联代码。

例如已配置目录后，先读取最新 revision，再调用：

```text
qxqy_script_sync({ action: "save", args: { path: "game.save.json", expectedRevision: N } })
qxqy_script_sync({ action: "preview" })
qxqy_script_sync({ action: "apply", args: {
  planId: "预览返回的 id", scriptIds: ["本次选中的 rows[].id"], confirmed: true
} })
```

MCP 的每次调用使用同一个 `handle`；Harness 使用同一会话。计划不跨工程或进程复用，源文件、目标文件或存档变化后需重新预览。只选择无错误且有变化的行；保留未选择和无关文件。复制回执只表示写入磁盘，随后仍需在千星沙箱保存并重新试玩。

## 接入

- 共用核心：`studio/host/script-sync.js`，存档配置校验：`studio/script-sync-config.js`。
- 编辑器 API：`script-sync`，以及保留兼容的 `script-sync-apply`（planId/scriptIds/confirmed）。
- AI 工具：`qxqy_script_sync`，开放 discover/status/configure/save/preview/apply，使用同一复制核心与校验。
- MCP 与 Web 为独立进程。AI 可在 MCP 中完成同步；若改用 Web 编辑器确认，先加载 AI 保存的同一存档并重新预览，MCP 返回的 planId 不跨进程使用。只读 `/` 预览页不执行复制。

## AI 接口验证（2026-10-19）

- `evidence_source: observed`，运行端 `simulator`，`device_status: not_required`，Windows / Node.js 22.23.2：冻结锁文件安装通过，全仓 `pnpm test` 391 pass / 13 条件 skip / 0 fail。新增测试覆盖保存时的 revision / 磁盘变更检查、显式文件选择、布尔确认、备份及结果查询；既有过期计划、路径约束和索引引用检查继续通过。
- MCP 经真实 stdio 子进程完成配置、保存、预览、部分复制与新增文件复制，核对备份原始字节、未选文件保留、过期和跨 handle 计划拒绝。Harness 经实际 `defineTool` 注册 / execute 与合成宿主上下文完成同一流程，覆盖 JSON 字符串参数和跨会话拒绝；不是 Desktop 窗口端到端验收。全部复制使用临时目录，未操作真实游戏脚本，真机保存与试玩仍待用户验证。

## 验证记录（2026-09-26）

- `evidence_source: observed`，运行端 `simulator`，`device_status: pending`，Windows + Node 22+：`web/test/script-sync-e2e.test.mjs` 以仓库合成 GIA 经实际 HTTP API 导入，校准模板索引、修改 Lua 语义引用、确认记录、保存/重载配置、预览/确认复制；校验嵌套路径、原文件备份、无关文件保留，并在模拟器中执行实际复制的字节验证新模板索引。此测试以临时目录模拟千星沙箱已导入的文件，不操作游戏 UI。
- `evidence_source: observed`，运行端 `simulator`，`device_status: not_required`：`studio/test/script-sync.test.mjs` 覆盖源码优先级、过期计划、文件缺失、路径约束、目录发现、配置导入原子性和显式确认。
- `evidence_source: observed`，运行端 `simulator`，`device_status: not_required`：`web/test/script-sync-browser.test.mjs` 使用临时 Edge headless profile 点击实际编辑器按钮，验证保存配置、预览、取消不复制，确认才复制。运行前构建 Web，设置 `QXQY_BROWSER` 为 Chrome/Edge 可执行文件路径；未配置时跳过该可选测试。
- 真机待验：将 GIA 导入实际千星沙箱，按实际索引校准后同步已有脚本，在千星沙箱保存并试玩，确认无需重新导入 GIA 即使用新源码。保存脚本后还需在千星沙箱保存并试玩，依据本地官方指南“脚本上传规则”；本轮自动化结果不等于这一步通过。
