# 客户端控件单项 / 部分组合 GIA 导出

## 界面

- 「UI控件-客户端」选中控件后，右侧属性栏提供「导出 GIA」，导出该控件及其完整子树。
- 顶部「导出 → 部分组合导出」打开客户端控件勾选列表。点击名称查看当前项独立导出的静态预览；勾选决定最终范围。支持全选、清除、包含脚本开关、取消和 Escape。
- 父子同时选择只保留父节点，子树不会重复写入；输出根顺序沿用编辑器树顺序，不按点击顺序或 GUID 排序。预览和导出不修改原项目的选择、父级、四平台参数、GUID、资产编号或 revision。
- 选中子控件时仅在副本中提升为独立 `UIControlTemplate`，保留四平台局部变换。原父级的缩放、旋转、遮罩和显隐不被烘焙进副本，界面预览与此规则一致；导出说明提示该边界。

## 文件与依赖

复用客户端 GIA 的多 `UIControlTemplate` + 子控件附件结构，不把所有控件塞进服务端树。单项和部分组合均输出一个 `.gia`，不改变原来的全资产导出行为。

默认包含所选子树的挂载脚本及已登记的未挂载模块，脚本映射写入同一 GIA 的附件，GenericSlot 保留挂载；不带其他子树的挂载脚本。取消「包含挂载脚本及未挂载模块」时，副本不写脚本映射和挂载槽。未挂载模块一并包含是宿主策略：不能凭 Lua 字符串可靠静态推断动态 `require`。

已知 `referencedPrefabId` / `itemPrefabId` 指向范围外时提示依赖，不静默勾选额外模板。未知二进制引用保持原样并提示无法判断；Lua 中动态创建的模板也不自动推断。仅登记 path、没有内联 source 的脚本提示核对游戏内文件；导出不执行 Lua、不隐式读盘填充源码。

## 共用 API / AI 工具

Studio 提供：

```js
studio.exportChoices() // 客户端 revision、树顺序的 rows（id / guid / parentId / ancestorIds / 控件数）
studio.exportPreview({ controlIds: ['n1'], includeScripts: true, expectedRevision: revision })
studio.exportData('gia-partial', 'client-control-template', {
  controlIds: ['n1', 'n4'], includeScripts: true, expectedRevision: revision,
})
```

范围中的 ID 是 Authoring `id`，不是名称或数值 GUID；资产固定为客户端模板列表，不受编辑器当前服务端页影响。空数组、未知 ID、错误类型、过期客户端 revision 均拒绝，不回退导出全部。

Web / DSH HTTP 共用 `export-list`、`export-preview`、`export`（`format: 'gia-partial'`，其余参数同上）。其他 `export` 格式继续兼容。

MCP / DSH 工具统一为 `qxqy_studio_export`，动作 `list` / `preview` / `export`，后两项参数放 `args`。MCP 另传 `handle`。`export` 支持已有 `format` / `assetType`；省略 format 为 `gia-partial`，省略 path 返回原有 base64 结果。显式 path 写入工作区内新文件，拒绝路径越界与覆盖已有文件；不会保存工程存档。回执含 `selection` 与 `warnings`，写盘回执另含 `path` / `bytes`。

## 验证边界

`evidence_source=observed`，运行端 `simulator`；界面/选择策略 `device_status=not_required`，新增部分 GIA 的真机导入 `device_status=pending`。沿用已有 GIA 结构不代表新增子树组合已在游戏内验收。

- `studio/test/partial-export.test.mjs`：固定身份与四平台参数、根/兄弟顺序、父子去重、子控件提升、源码/挂载范围、无脚本、失败原子性和旧导出兼容。
- `web/test/partial-export.test.mjs`：真实 HTTP；配置 `QXQY_BROWSER` 后，以生产编辑器验证属性栏单项下载、勾选窗口、红色图元预览、部分组合文件内容和 Escape 取消。
- `mcp/test/protocol.test.mjs`：stdio list / preview / base64 / 工作区写盘及防覆盖/越界。
- `dsh-plugin/test/lifecycle.test.mjs`：同一会话的 AI 工具 list/export 与 HTTP preview，组件重启后工具仍可用。

源码更新后重建 Web/MCP/DSH 并重启宿主；仅刷新新前端而沿用旧后端会报 Unknown editor action。

2026-10-25 本轮验证：Windows x64 / Node.js 22.23.2 / pnpm 10.15.0，冻结锁文件安装通过；根 `pnpm test` 为 415 pass / 16 环境相关 skip / 0 fail。另启用真实 Edge 执行本页 Web 测试 2/2，通过属性栏根/子控件导出、部分组合勾选、红色图元预览、下载内容检查、Escape 取消及中英文切换；小窗口截图核对预览完整缩放。`pnpm pack:release` 与 `pnpm test:packages` 通过，仓库外三组 dsh-tools（0.1.0-rc.6 / 0.2.0-rc.2 / 0.2.1-rc.2）均实际调用 DSH 导出工具、Web 部分导出及 MCP 导出写盘。只生成并验收本地安装包，未发布；本轮未做千星真机导入。
