# 界面语言、联系作者与检查更新

上级：[共用编辑器](../../editor-ui/README.md)。Web与Harness共用顶部语言选择、底栏更新检查和联系弹窗。

## 联系作者

- QQ群号1007538100
- 作者邮箱 725230880@qq.com
- 开源仓库 https://github.com/1475505/miliastra-beyond-simulator
- 感谢@xiaomol444提供的图片、音效、界面动效素材

## 检查更新

由用户点击触发，宿主读取公开[GitHub Release API](https://docs.github.com/en/rest/releases/releases#list-releases)，浏览器只访问自身宿主。当前版本来自对应产品的package.json；`studio/host/updates.js`在最近100条Release附件中按包名匹配最高正式版本，忽略草稿、预发布和其他产品；tag不参与版本排序。

结果区分有更新、相同、本地较新、未找到与失败，提供对应Release/安装包链接；不自动下载安装。成功缓存5分钟、合并并发查询，失败可重试，离线或限流不能显示“已是最新”。链接仅接受本仓库的HTTPS Release地址。

### 构建后后台仍为旧进程

重建磁盘资源不会替换运行中的Node/Harness。前端有新功能而后台报`Unknown editor action`或字体接口`404 Font not found`时，保存工作、重启宿主并刷新页面；仅刷新不能加载新后台路由。界面保留重试入口，并将旧后台提示与网络错误区分。

## 界面语言

- 优先级：手动选择 → 本机直连时的宿主系统UI语言 → 浏览器`navigator.language/languages/Intl`。中文系语言使用简体中文，其余英文；自动选项显示实际语言代码。
- Windows通过独立、无窗口、无Profile的PowerShell读取[`Get-UICulture`](https://learn.microsoft.com/powershell/module/microsoft.powershell.utility/get-uiculture)；macOS读取AppleLanguages；Linux按LANGUAGE/LC_ALL/LC_MESSAGES/LANG。C/POSIX、读取失败或超时回退浏览器，不阻断启动。
- 宿主结果按进程缓存，locale动作不创建项目会话。只有直接回环连接及回环Host取得系统提示；代理和远程访问用浏览器语言。透明SSH转发等无法辨别访问端时可手动选择。
- 偏好存在当前origin的localStorage，同源页面同步；切换不重挂载编辑器、不改变revision、草稿或项目数据，与Lua `game.GetLanguageType()`独立。
- 独立/内嵌试玩和预览订阅异步语言更新；iframe握手不等待语言查询。

### DSH 接入

Harness可选locale服务负责刷新`conversation.view`的缓存标签，插件不改宿主全局偏好，也不重新登记编辑器；缺少该服务的旧宿主仍可加载。`dsh-plugin/dist/play-renderer.js`必须导出试玩HTML所引用的语言函数。回归见`dsh-plugin/test/client-language.test.mjs`，包括真实构建模块的named exports契约。

## 术语核对

唯一完整译文表为`studio/locales/en.js`。新增文案使用`t()`或参数模板；静态HTML使用`data-i18n`标记。项目名称、控件名、游戏文字、Lua、日志、路径、JSON/GIA和API标识符保持原文，不对整棵DOM做替换。

核心术语按以下依据维护；普通说明文案按上下文审校，避免再建立一份全量译文副本。

| 术语 | 英文 | 依据 |
|---|---|---|
| 千星沙箱／千星奇域 | Miliastra Sandbox / Miliastra Wonderland | 2026-10-18术语接口等值结果 |
| 元件／光标检测区域 | Prefab / CursorEventArea | 同上 |
| 位置／初始激活／初始可见性 | Location / Initially Active / Initially Visible | 同上 |
| 90/180/360度环绕 | Radial90 / Radial180 / Radial360 | 同上 |
| 容器节点／文本框／文本视窗／网格视窗 | Container Control / Text Box / Text Window / Grid Scroller | 本地Lua UI API类型名的界面译法 |
| 模板引用控件／图片／预设按钮／按键提示 | Reference Control / Image / Preset Button / Key Hint | 同上 |
| 界面动效／全屏动效／边缘羽化 | UI Animation / Fullscreen UI Animation / Soft Edge | 本地API类型/字段术语 |
| 客户端控件模板 | Client Control Template | 项目语境，与素材Prefab区分 |
| 中心／居中 | Pivot / Center | 变换轴心与对齐语境；接口对“中心”返回Center，不直接套用 |
| 关闭弹窗 | Close | 弹窗语境；接口Turn Off不适用 |

术语接口为`POST https://ugc.070077.xyz/api/v1/translate/terms/batch`（chs→en）。只接受`source_term == chs`、`matched=true`且译文非空；相似候选和GET的`exact_match`不等于等值命中。2026-10-18本地API快照SHA-256为`4a43f93f2b322be8336ff33d9cb07b3bc3a8d4c8a931a45d18f90e4e64941bab`，类型拆词后的界面译法不冒充在线API原文。

需要重新核对时可运行`node scripts/query-translation-terms.mjs <新的输出文件.json>`；输出供审校，不自动覆盖译文，临时查询结果无需跟随每次文案修改长期维护。原逐条审校记录可在Git提交`c47e91b`查阅。

## 验证与边界

- `studio/test/i18n.test.mjs`：语言选择、占位参数、内容保留及真实inspector的类型/枚举显示。
- `studio/test/translation-terms.test.mjs`：查询批处理、等值匹配与失败语义；不访问在线服务。
- `studio/test/system-language.test.mjs`、`updates.test.mjs`：系统来源、回环范围、分产品版本匹配、缓存与重试。
- `web/test/i18n-footer-browser.test.mjs`、`system-language.test.mjs`：真实浏览器语言持久化、草稿/存档保留、联系弹窗与更新重试。字体配置用隔离夹具。
- `scripts/smoke-harness-language.mjs`：真实Harness ModuleLoader、延迟语言响应、缓存标签和试玩页；通过配置`QXQY_BROWSER`的`test:harness`运行。

2026-10-18 Windows / Node22.23.2及Harness0.2.0-rc.2、0.2.1-rc.2验收为`observed / simulator / not_required`；macOS/Linux仅合成平台夹具，完整签名Desktop和游戏英文界面不在该验收范围。模拟器测试不能证明译法本身或游戏真机行为。
