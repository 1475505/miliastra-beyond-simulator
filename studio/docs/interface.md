# 界面语言、联系作者与检查更新

Web 与 Harness 共用编辑器：所有编辑页面的顶部导航栏在「字体设置」旁提供语言选择，底栏提供「检查更新」「联系作者」和作者 B站链接。联系作者弹窗显示：

- QQ群号1007538100
- 作者邮箱 725230880@qq.com
- 开源仓库 https://github.com/1475505/miliastra-beyond-simulator

## 检查更新

用户点击后，由宿主读取公开 GitHub Release 元数据，浏览器只访问自身宿主，不直接依赖外部站点的 CORS 或 CSP。启动编辑器不触发更新查询，不自动下载、安装或重启。

当前版本来自当前产品的 package.json，构建时分别带入 Web 或 DSH；不会从工作区、全局安装或另一个产品猜版本。studio/host/updates.js 在最近 100 条 Release 的附件中匹配当前包名，选取最高正式版本；忽略草稿、预发布和其他产品的附件。因此单独发布 MCP 不会被误报为 DSH/Web 更新，日期形式的 tag 也不会参与版本大小比较。

结果区分有更新、同版本、本地版本较新、未找到正式版本和查询失败。找到更新时提供该版本说明及对应安装包链接，由用户按安装方式更新。成功结果缓存 5 分钟，同一宿主内并发查询合并；失败允许重试，不得把离线、限流或不完整结果显示为“已是最新”。链接仅接受本仓库的 HTTPS Release 地址。GitHub API 的公开访问及 Release 字段见 [GitHub 官方说明](https://docs.github.com/en/rest/releases/releases#list-releases)。

### 构建后后台仍为旧进程

重新构建会更新磁盘上的前端资源，已经启动的 Node / Harness 后台继续执行内存中的旧代码。前端出现新入口而后台返回 `Unknown editor action` 时，检查更新明确提示重启宿主，不归为网络故障；失败窗口保留重试及公开 Release 链接。字体设置接口返回 `404 Font not found` 时也明确提示后台未加载该功能，并支持在原弹窗重试。应先保存当前工作，再重启后台并刷新页面；仅刷新页面无法加载新的后台路由。

2026-10-18 本机直接读取旧 Web 进程（02:26 启动、磁盘构建随后更新）的接口，字体设置返回 404、更新返回 400 / `Unknown editor action`，确认为前后端构建混用。`evidence_source=observed`、运行端 `simulator`、`device_status=not_required`。浏览器回归通过合成旧接口响应覆盖两种提示、失败重试及恢复表单；实际外部网络故障仍单独显示网络错误。

同日修复核验：新后台的字体设置与真实 GitHub 更新查询均返回 200，后者识别 Web 0.4.1 为当前公开正式版本。全仓测试 370 pass / 12 条件 skip / 0 fail；另启用 Chromium 的配置输入、字体渲染和语言/更新浏览器检查 3/3 通过。字体保存回归使用合成字体与隔离配置，不改用户的实际字体设置。

## 界面语言

默认「自动（系统语言）」按以下顺序选择：手动选择保持最高优先级；本机直接访问时，使用宿主读取的系统界面语言；无法读取或远程访问时，回退到 navigator.language / navigator.languages / Intl locale。zh、cmn、yue 等中文系语言使用简体中文，其他语言使用英文。自动选项会显示实际采用的语言代码（如 zh-CN），不会因系统另装了中文输入法就改成中文。

Windows 通过无窗口、无 Profile 的独立 PowerShell 调用 `(Get-UICulture).Name` 读取当前用户的界面语言，不把 LANG=C.UTF-8、键盘语言或日期格式直接当作 Windows 显示语言，接口定义见 [Microsoft Get-UICulture](https://learn.microsoft.com/powershell/module/microsoft.powershell.utility/get-uiculture)。macOS 读取 AppleLanguages 首选项，Linux 使用 LANGUAGE / LC_ALL / LC_MESSAGES / LANG 的有效语言；C / POSIX 不作为中文或英文的系统证据。命令超时、缺失或输出无效时保留浏览器回退，不阻止编辑器启动。

宿主结果按进程缓存，由现有 API 前缀中的 locale 动作返回，不创建项目会话，不写系统设置。仅对直接回环连接与回环 Host 返回本机语言，转发请求和远程访问者继续使用自身浏览器语言，不能用服务器的中文设置覆盖远程用户的英文界面。独立编辑器、只读预览和试玩页均在初始化时读取；Harness 组件异步读取后更新已有界面，不重挂载编辑器或改动草稿。

试玩页同步登记内嵌控制器，语言查询完成后通过订阅更新界面，不能因等系统语言而延后 iframe onLoad 所需的握手。透明 SSH 转发等无法从连接地址辨别访问端的场景，仍可能取得宿主语言，可使用手动选择；没有把服务器语言作为跨机器用户偏好的通用判断依据。

2026-10-18 本机观察：Windows 界面语言 zh-CN，环境 LANG / LC_ALL 为 C.UTF-8，真实 locale 接口返回 language=zh-CN、source=windows-ui。独立 Chromium 的 navigator.language=en-US、偏好 auto，实际页面 lang=zh-CN，自动选项显示 zh-CN。全仓 382 pass / 13 条件 skip / 0 fail；另启用的 6 项浏览器检查全部通过，覆盖本机语言优先、手动选择与持久化、编辑/试玩/预览一致、草稿及项目数据不变和内嵌试玩生命周期。Web、DSH 前端已重建。`evidence_source=observed`、运行端 `simulator`、`device_status=not_required`；macOS / Linux 使用合成平台夹具验证，未在对应系统实机验收。

可手动选择「简体中文」或 English，选择保存在当前浏览器/宿主 origin 的 localStorage。切换不重挂载编辑器、不保存或丢弃草稿、不改变项目 revision。同源页面可同步语言偏好。它独立于 Lua 的 game.GetLanguageType()；游戏语言仍遵循原有 Runtime/客户端日志策略。

### DSH 插件的接入检查

2026-10-18 对实际安装的 DSH tarball 补充验收，发现并修复两处仅检查独立 Web 时无法发现的问题：

- Harness 会缓存 conversation.view 的标签。系统语言晚于视图登记返回时，编辑器已切中文，宿主标签仍可能保留 Simulator；手动切换也不会主动刷新该缓存。插件通过可选的 locale 服务发布自身标签字典，使用该服务的正常 revision 通知刷新标签，不修改 Harness 的全局语言偏好，也不重新登记或卸载编辑器。缺少该服务的旧宿主仍可加载插件。
- DSH 的 play-renderer.js 是独立的公开入口，之前没有转出试玩 HTML 新引用的语言函数，浏览器会报 missing export 并终止脚本。已补齐这些导出，新增测试将实际构建模块的导出与页面全部 named imports 对照，不能只删除 import 后检查剩余脚本能否解析。

dsh-plugin/test/client-language.test.mjs 覆盖延迟响应、手动优先、旧接口回退、可选 locale 服务、订阅清理及试玩模块导出契约。scripts/smoke-harness-probe.mjs 在真实 Harness 中、不提供 sessionId 的情况下查询 locale，检查实际系统值、转发回退及插件重启后的路由；没有为语言查询创建模拟器控制器。

给 test:harness 设置 QXQY_BROWSER 后，额外运行 scripts/smoke-harness-language.mjs：使用隔离 DSH_HOME 安装 tarball，打开真实 Harness 页面，由其 ModuleLoader 和 conversation.view 加载插件。浏览器固定 en-US，保留真实语言请求并延迟交付响应，检查初始英文到系统中文、宿主标签同步、手动 English、未保存 Lua 草稿与导出存档保持、编辑器节点不替换、新试玩页读取持久化偏好及同源语言同步。测试只在临时目录写合成会话和脚本，不向模型提交消息，不修改正在使用的 Desktop profile。

最终本机验收：同一修复后的 tarball 在 Harness 0.2.0-rc.2、0.2.1-rc.2 的完整 Web 宿主和上述真实浏览器流程均通过，实际接口均返回 zh-CN / windows-ui。全仓 386 pass / 13 条件 skip / 0 fail；独立安装在 dsh-tools 0.1.0-rc.6、0.2.0-rc.2、0.2.1-rc.2 三组均通过。Windows / Node.js 22.23.2，`evidence_source=observed`、运行端 `simulator`、`device_status=not_required`；不是签名 Electron 窗口中的人工端到端验收，也不代表代码已经公开发布。

同日只读检查当前 Desktop 进程的语言接口，POST 空对象返回 400 / sessionId is required，表明运行中的后台尚不支持新的无会话语言接口。仅重建源码不会替换该进程；应更新本轮插件安装包并保存工作后重启 Harness。该项观察不能写成当前 Desktop 已完成新版本验收。

英文覆盖编辑器、属性与枚举显示、颜色、字体、索引与脚本同步、导入导出、更新/联系弹窗、独立/内嵌试玩和 Web 只读预览。翻译表随软件构建，不在运行时调用翻译服务。

studio/i18n.js 仅在显式标记的界面字符串和宿主显示元数据上翻译；模板参数保留原值和 API 标识符。项目名称、控件名称、游戏文字、Lua 源码与原始日志保持原文，包括原来默认工程里的中文示例。JSON、GIA、枚举值、索引、存档路径和信号/变量名不按界面语言改写。新界面文案使用 t() 或带参数的 t 模板，补入 studio/locales/en.js；静态 HTML 使用 data-i18n 及对应的属性标记，禁止对整棵 DOM 或项目内容做字符串替换。

## 术语核对

2026-10-18 已对 en.js 全部 740 条文案执行在线批量精确查询并逐项审校，替代此前只核对 26 个候选术语的记录。查询使用 [批量端点](https://ugc.070077.xyz/api/v1/translate/terms/batch)，参数为 source_lang=chs、target_lang=en；只接受 source_term 与返回 chs 完全相同、matched=true 且译文非空的结果，不把 GET 的 exact_match 或相似候选直接视为等值匹配。

740 条中，26 条有等值译文：24 条按接口对齐；关闭弹窗的「关闭」保留 Close（接口 Turn Off），变换轴心的「中心」保留 Pivot（接口 Center），两处均登记语境和代码依据。其余 714 条没有 API 等值译文，已结合控件类型、属性含义、统一术语表、占位参数和界面上下文人工审校，不标成 API 已命中。共修正 40 条译文，包括 Grid Scroller、Text Window、Soft Edge、Location、Radial90/180/360 及相关说明。

完整逐条结果、原译文与修正值、API 返回值、两处语境例外及术语依据保存在 [英文核对清单](english-translation-audit.json)。控件英文类型和 Soft Edge 等术语参考完整知识工作区的本地 Lua UI API 文档快照；记录明确区分术语接口、本地 API 文档和项目语境，不把文档中拆词后的界面译法写成在线 API 原文。客户端控件模板使用 Client Control Template，与素材来源中的 Prefab 区分；存档、试玩、工作区等本软件功能按实际界面语境翻译。

再次在线核对可在仓库根执行 `node scripts/query-translation-terms.mjs <新的输出文件.json>`。工具只查询并输出证据，不自动覆盖译文或审校清单；已有输出文件不覆盖。`studio/test/translation-audit.test.mjs` 离线检查全部文案的审校覆盖、当前译文与审校值一致、接口等值规则、语境例外、术语传播及真实 inspector 的控件和枚举显示。以后新增或修改英文须补查询与审校记录，不能仅靠占位符测试通过来声称译法正确。

本轮验收：Windows / Node.js 22.23.2，静态扫描 537 个直接界面消息键无遗漏；全仓 377 pass / 12 条件 skip / 0 fail。另启用 Chromium 的 3 项检查通过，覆盖新控件名、Soft Edge 属性、Radial90 显示与未改动枚举值，以及语言切换、项目文字/草稿保留、字体路径和更新重试。Web、DSH 前端已重建；界面核验为 observed / simulator、device_status=not_required，不表示已逐项观察游戏英文界面。

## 验证边界

测试使用自包含夹具：studio/test/i18n.test.mjs 验证语言选择、术语、占位参数和内容保留；studio/test/updates.test.mjs 验证分产品匹配、数字版本排序、预发布过滤、缓存、并发与失败重试；web/test/i18n-footer-browser.test.mjs 通过真实浏览器验证非中文环境、联系链接、更新失败重试、语言持久化、草稿/存档不变、原文游戏文字、英文试玩/日志及只读预览。旧浏览器夹具固定 zh-CN，新语言用例单独指定其他系统语言。

本功能属于模拟器界面策略，evidence_source=inferred、device_status=not_required；本机测试及公开更新接口实测为 observed / simulator，不新增游戏真机契约，也不表示完整签名 Harness Desktop 已验收。

2026-10-18 本机验收：Windows / Node.js 22.23.2，冻结锁文件检查通过；全仓 370 pass、12 条件 skip、0 fail；另启用 Chromium 的 5 项浏览器检查全部通过。三产品已生成本地 tarball，仓库外安装及真实 Worker/PNG/Web/MCP 验收在 dsh-tools 0.1.0-rc.6、0.2.0-rc.2、0.2.1-rc.2 三组均通过。直接请求公开 Release 接口识别 DSH 2.1.1 为当前公开正式版本；这不表示本轮代码已公开发布。
