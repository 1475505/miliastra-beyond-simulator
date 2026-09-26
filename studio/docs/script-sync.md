# 实机脚本目录：显式复制同步

## 人工流程

1. 首次把 GIA 导入千星沙箱，建立脚本映射和必要的挂载。
2. 若控件索引被重映射，在模拟器校准索引，让 AI 按控件身份同步内联源码与相关 `.lua` 文件，核验后确认 `controlGuidChanges`。
3. 打开 Web `/editor` 或 DSH 的「Lua 脚本 → 实机脚本同步」。配置工作区相对目录、实机导入根目录、实机对应子目录，以及完整存档保存路径。可以发现本机 UID / 编辑器 ID 候选，也可粘贴路径。
4. 「保存目录配置」将配置写入完整存档；不复制文件。「保存存档并检查差异」提交当前脚本/逻辑草稿、保存完整存档，再展示逐脚本来源、目标路径、新增/覆盖/未变化/错误和复制前后内容。
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

内容沿用试玩语义：非空白内联 `source` 优先，否则读取工作区 `path`。两份内容不同时明确提示，可查看工作区内容并选择「从工作区文件更新存档源码」，然后重新保存和预览。不会自动重写 Lua 数字或修改脚本映射/挂载。新增脚本文件仍需在千星沙箱建立脚本映射。

## 确认与备份

Host 保存一个进程内同步计划，指纹包含完整存档、源文件、目标路径及原文件内容。确认时重新检查；工程/源码/目标有变化则要求重新预览。仅接受明确的 `confirmed: true`、有效计划 ID 和选中文件 ID；使用后计划失效。尚有未确认的控件索引引用时拒绝复制。

确认还要求当前完整存档已保存、磁盘存档哈希仍匹配。覆盖前备份原始字节到工作区 `.qxqy-script-sync-backups/<批次ID>/<目标相对路径>`（不在实机目录内），再用临时文件和 rename 替换。逐文件返回成功/失败；不是跨文件原子事务。未选中、未变化或实机额外文件不删除、不覆盖。备份按回执路径手工恢复。

配置持久化在存档；待确认计划和最近回执仅属于当前宿主会话，重启后重新检查差异。

## 接入

- 共用核心：`studio/host/script-sync.js`，存档配置校验：`studio/script-sync-config.js`。
- 人工 API：`script-sync`（discover/status/configure/preview），`script-sync-apply`（planId/scriptIds/confirmed）。
- AI 工具：`qxqy_script_sync`，只开放 discover/status/configure/preview。configure 的 args 需 config 与 expectedRevision。
- MCP 与 Web 为独立进程。AI 保存后，用户在 Web 编辑器加载同一存档并生成自己的确认计划；MCP 返回的 planId 不跨进程使用。只读 `/` 预览页不执行复制。

## 验证记录（2026-09-26）

- `evidence_source: observed`，运行端 `simulator`，`device_status: pending`，Windows + Node 22+：`web/test/script-sync-e2e.test.mjs` 以仓库合成 GIA 经实际 HTTP API 导入，校准模板索引、修改 Lua 语义引用、确认记录、保存/重载配置、预览/确认复制；校验嵌套路径、原文件备份、无关文件保留，并在模拟器中执行实际复制的字节验证新模板索引。此测试以临时目录模拟千星沙箱已导入的文件，不操作游戏 UI。
- `evidence_source: observed`，运行端 `simulator`，`device_status: not_required`：`studio/test/script-sync.test.mjs` 覆盖源码优先级、过期计划、文件缺失、路径约束、目录发现、配置导入原子性和显式确认。
- `evidence_source: observed`，运行端 `simulator`，`device_status: not_required`：`web/test/script-sync-browser.test.mjs` 使用临时 Edge headless profile 点击实际编辑器按钮，验证保存配置、预览、取消不复制，确认才复制。运行前构建 Web，设置 `QXQY_BROWSER` 为 Chrome/Edge 可执行文件路径；未配置时跳过该可选测试。
- 真机待验：将 GIA 导入实际千星沙箱，按实际索引校准后同步已有脚本，在千星沙箱保存并试玩，确认无需重新导入 GIA 即使用新源码。保存脚本后还需在千星沙箱保存并试玩，依据本地官方指南“脚本上传规则”；本轮自动化结果不等于这一步通过。
