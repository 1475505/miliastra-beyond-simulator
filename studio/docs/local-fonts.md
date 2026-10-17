# 本地自定义字体

模拟器支持由使用者提供的一份 TTF / OTF 字体。不内置、下载或提取任何商业字体，也不通过项目存档分发字体。

## 使用

在启动 Web、MCP 或 DSH 宿主的进程环境中设置 `QXQY_FONT_PATH`，值为本机字体文件的绝对路径。例如 PowerShell：

```powershell
$env:QXQY_FONT_PATH = 'C:\Fonts\my-licensed-font.ttf'
node web/dist/server.js --workspace . --host 127.0.0.1
```

该路径仅为示例，请替换为你有权用于此场景的字体。MCP 需要将变量设置在 MCP 服务进程的本机环境中；DSH 需要在启动宿主前设置。变量不会从项目 JSON 或 GIA 读取，模拟器也不会自动加载 `.env`。不要把本机路径写进共享配置或提交到仓库。文件建议保存在仓库外；仓库内的 `.local-fonts/` 也已忽略。

文件限制为单字体 TTF / OTF、最大 32 MiB；TTC、WOFF 和 WOFF2 不作为输入支持。字体读取或注册失败会明确报错，不会静默假装已加载。未配置变量时保留原有系统字体。修改字体或取消变量后，重启宿主并刷新已打开的编辑器及试玩页。

## 生效范围

- DOM 编辑画布的文字控件、Pixi 试玩文字、PNG 文字与宿主文字换行、自适应字号测量使用同一份自定义字体；未配置时也共用 `studio/fonts.js` 的默认字体栈。编辑器工具栏等界面文字不改。
- 宿主保留进程内的字体快照，试玩 Worker 收到相同字节，源文件随后被替换也不会让截图与换行测量使用不同版本。
- 浏览器等待字体加载后创建 Pixi 文字；加载失败会显示错误。浏览器和原生 Canvas 的栅格化仍可能不同，不承诺与游戏实机像素一致。
- 不添加 Lua 字体 API，不改项目模型、JSON 存档或 GIA。缺字时使用原有系统字体回退。

## 本地访问与分发边界

自定义字体通过 `/qxqy-font/manifest` 和内容标识对应的单个资源端点送到本机浏览器。接口不接收文件路径，不暴露路径/文件名，不提供目录浏览或上传，响应使用 `Cache-Control: no-store`。这仍会把字节交给本机浏览器，不能理解成防复制机制。

配置字体时，独立 Web 服务只允许监听回环地址。Web / DSH 的字体资源只接受直接回环连接与本机 Host，拒绝跨源及带常见代理转发头的请求；Web 现有口令认证同样适用于字体接口。不要将字体接口配置到反向代理、隧道或公共站点。远程使用、公共 Webfont 或随软件分发需要独立设计和相应授权，不在本功能范围内。

仓库忽略字体文件和 `.local-fonts/`，Web 静态资源复制及 Release 打包过滤字体文件和私有字体目录，Docker 构建上下文也排除它们。不要强制添加字体、Base64、转码/子集文件、字形图集、真实本机配置或私有测试样本；提交 PR 前仍须检查 diff 和产物清单。测试仅使用代码生成的简单几何字形，不依赖游戏文件或系统字体文件。

用户需要确认字体许可覆盖自己的实际使用方式。拥有文件或游戏客户端不代表拥有软件嵌入、Web 使用或再分发权；本项目的代码许可证不授予第三方字体许可。

证据范围：本功能属于模拟器字体加载与隔离策略，`evidence_source=inferred; device_status=not_required`，不新增千星真机字体能力结论。

## 排版整合与回归

`play/text-layout.js` 使用宿主字体快照测量，并将字体栈纳入排版缓存键；滚动文本复用同一排版器。PNG / Pixi 消费已计算的字号和分行，Pixi 不再二次换行。编辑器将加载的字体传给实际文字 span，避免 span 的默认样式覆盖外层字体。

长期回归只维护互补边界：`test/local-font.test.mjs` 用合成几何字体核对 PNG、换行、自适应字号及真实 Controller → Worker 的字节快照传递；`web/test/local-font.test.mjs` 验证 HTTP 认证/字体资源与可选浏览器的 DOM/Pixi 字体、字号增量更新。描边 alpha 并入 `test/text-alignment.test.mjs`，不另维护单用例文件。测试不使用外部字体或真机样本；模拟器验证不代表真机字体一致。

2026-10-18 整合核验：基于 `a74a873` 与工作区已有排版/显隐修改，Windows / Node.js 22.23.2；冻结锁文件安装、根 `pnpm test`（357 pass、9 skip、0 fail）、Web/DSH/MCP 构建均通过。Edge headless / SwiftShader 单独启用合并后的浏览器字体/字号用例，2/2 通过。此项为 `evidence_source=observed`、运行端 `simulator`、`device_status=not_required`；不涉及游戏实机验收。
