# MCP 问题核验摘要

上级：[MCP](../../mcp/README.md)。保留2026-10-06至07日核验中仍有用的结论；当前工具用法以MCP入口为准。

## #5 计时与脚本重载

旧MCP默认实时推进：10秒倒计时 `step(2)` 后等待3秒，截图已到time=5；截图自身没有step。用户确认后，MCP从0.3.5起默认manual，Web/DSH仍默认realtime。相同复现经真实stdio再次执行，等待和截图后保持time=2/frame=1；再step(0.2)到2.2/frame=2。

`pause/resume` 不切换模式，暂停时可显式step；device继承本局模式，新的start恢复宿主默认。非法模式在替换Worker前拒绝，异步截图准备不推进manual时钟。回归见 `mcp/test/protocol.test.mjs`、`studio/test/host-clock.test.mjs`。

来源：Windows / Node22.23.2、本地合成存档、MCP stdio→Controller→Worker→Lua；`evidence_source=observed`、运行端`simulator`、`device_status=not_required`。这是用户确认的工具策略，不是游戏时钟契约。

同一handle的stop/load/start执行旧脚本未复现：内联source和磁盘Lua的v1/v2均执行新标记。非空source优先于path，修改另一个进程或磁盘文件不等于加载当前工程的新源码；尚无证据认定这是报告者原问题的原因。

## 其他问题与未解决边界

| 问题 | 核验结论 |
|---|---|
| [#4 光标事件](https://github.com/1475505/miliastra-beyond-simulator/issues/4) | 合成动态光标区的pointer down/up、按名click可触发Lua；raycast/showCursor关时阻止。漏传click.name会留下`"undefined"`历史，候选参数校验曾撤回；原工程失败原因仍缺存档和调用参数。 |
| [#6 运行树与导入](https://github.com/1475505/miliastra-beyond-simulator/issues/6) | `get {inspect:true}`可取得运行树；MCP打开完整JSON，Studio/Web/DSH支持GIA子集，GIL整关卡导入未实现。 |
| [#7 GetChildren](https://github.com/1475505/miliastra-beyond-simulator/issues/7) | 元素是可操作的Control引用。官方本地rev223只声明直接子数组、Last置顶，未约定返回顺序。当前最上层在前是[模拟器策略](../../client/lua-runtime/docs/observed-contract.md#默认动态实例层序2026-09-28)；真机数组顺序仍unknown/pending。 |

对`[C,B,A]`逆序逐个调用Last会依次得到`[A,C,B] → [B,A,C] → [C,B,A]`；最终相同不表示方法无效。`client/lua-runtime/test/children-reference.test.mjs`按名称识别引用，仅检查显隐与显式排序，不固定数组顺序。以上合成核验不替代未提供原工程的复现。
