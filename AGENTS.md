# simulator — 实现分工

这里是独立 Git 仓库，修改前检查本目录状态并保留已有改动。仓库与分发入口见 [README](README.md)、[分发设计](DISTRIBUTION.md)。若位于完整知识工作区中，再读 [父级 AGENTS](../AGENTS.md)、[需求](../docs/demand.md)、[模块地图](../docs/workspace-map.md)；独立检出时这些外部资料可以不存在，不创建替身。

## 读哪里、改哪里

| 职责 | 实现位置与入口 |
|---|---|
| Lua 5.3 VM、script/game/Enum、控件、输入、Tween、require | [client/lua-runtime](client/lua-runtime/README.md)；[架构](client/lua-runtime/docs/architecture.md)、[观察契约](client/lua-runtime/docs/observed-contract.md) |
| 关卡/玩家/角色变量、信号 | [server](server/README.md)；不执行完整官方节点图 |
| Authoring JSON、GIA、布局、试玩编排、日志、回放与断言 | [studio](studio/README.md) 的 `ui/`、`gia/`、`play/`、`log/`、`autotest/` |
| 共用 Controller、工作区边界、持久 Worker、截图和场景渲染 | `studio/host/`、`studio/host-png.js`、`studio/play/pixi-renderer.js`、`studio/play/browser-session.js` |
| Web / DSH 共用编辑器 | [editor-ui](editor-ui/README.md)；宿主注入 React、API 和试玩 URL |
| DSH Host/Tools、Client UI 适配 | [dsh-plugin](dsh-plugin/README.md)；工具流程见 [skill/SKILL.md](skill/SKILL.md) |
| MCP stdio 与工具映射 | [mcp](mcp/README.md)、`mcp/index.js`；复用 `studio/host/controller.js` |
| Web 编辑与只读预览 | [web](web/README.md)、`web/server.js`、`web/lib/session.js`、`web/lib/editor-sessions.js` |
| workspace、DSH 源码安装入口、打包与独立安装验收 | 根 `package.json` 为 DSH 对外清单；`dsh-plugin/package.json` 仅为内部源码包；`pnpm-workspace.yaml`、`scripts/` |
| 编辑器视觉设计（非实现） | `frontend/ui/ui-mockups.md` |

Lua VM 只放在 Runtime，Authoring/GIA 只放在 Studio，接入层复用共享宿主，不另建引擎。未知语义标策略或明确失败，需要真机证据的调查放根 `probes/`。

旧动态原型 `frontend/dsh/`、`studio/dsh-host-kernel.js` 已删除，不恢复；不要安装或调试失败的旧包 `qxqy-dsh-plugin`，使用现行静态包。

## 实现约束

- UI 层级：服务端“客户端控件容器” → 客户端“容器节点” → 子控件。三类存档资产为服务端 UI、客户端模板、Lua 脚本，没有“服务端 Lua”。
- 层序：显式【层级】数值高的在上（Lua sibling 大的在上，First 置底、Last 置顶）；编辑器同级列表第一项在上。内部 children 保持列表顺序，Lua 数值在 scene.js 边界反向映射；不要把编辑器树/GIA wire/运行时索引混成一个方向。主证据见根 knowledge/fact.md“同级绘制与命中”。
- 仅客户端控件/模板允许挂脚本，以 `controlAsset` 区分两棵树同名 ID；模板脚本随实例化运行。11 类控件按 GIA 证据分级，N/U 字段只读，不伪造。
- 图片 `100001–100006` 分别用矩形、圆、等腰三角、四角星、五角星、圆环（内外径比 0.8）代理，其他 ID 显示缺失框；代理不代表官方素材。
- 五档画布与 `GetUICanvasSize` 同源，尺寸见根 [fact.md](../knowledge/fact.md)“模拟器画布预设”。原点左下、锚点相对父矩形；手机 16:9（1280×720）完整可见，PC 等比放大/留边。
- 独立脚本 GIA 与整合包的挂载能力不同；按根本地 [GIA 数据结构](../knowledge/ui/02_UI核心数据结构.md) §5“通用关联槽”/§8 和 `studio/gia/codec.js` 实施，不写未观察字段。排错见 [P11](../knowledge/pitfalls.md)。

## 验证

修改 Git 源码安装入口、根 `prepare` 或 DSH exports 时，另跑 `pnpm test:git-install`；可传入本机 DSH CLI 的 `lib/bin.js` 绝对路径，在临时 profile 中验证真实安装与配置注册。

根目录统一运行 `pnpm install --frozen-lockfile`、`pnpm test`；分发修改另执行 `pnpm pack:release`、`pnpm test:packages`。源码和测试入库，依赖、构建产物与生成的 Skill/预设副本继续忽略，不用 `git add -f`。测试必须自包含，只使用仓库内源码与合成数据，不依赖仓库外的样本文件。真机证据、模拟器策略和测试结果分开记录；在完整知识工作区中遵守 [知识维护规范](../knowledge/AGENTS.md)。
