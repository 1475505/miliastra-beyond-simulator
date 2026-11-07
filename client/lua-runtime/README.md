# qxqy-lua-runtime

千星奇域客户端 Lua 运行时模拟器（语言层 + 宿主 API）。  
不解析 GIA / Authoring JSON，不提供编辑器或 DSH UI。那些属于 `simulator/studio/`、`simulator/editor-ui/` 与宿主适配层。

```js
import { createRuntime } from 'qxqy-lua-runtime'

const rt = createRuntime({ canvasWidth: 1600, canvasHeight: 900 })
const root = rt.addRoot({ name: 'Root', kind: 'container', children: [...] })
rt.registerTemplate(10001, { kind: 'textbox', name: '文本框' })
rt.registerScriptFile('mods/foo', 'return { ok = true }')
rt.mountScript({ path: 'main', source, control: root, params: { textBoxPrefabId: 10001 } })
rt.step(1 / 30)
rt.injectKey('KeyboardCraftspersonKey1Down')
rt.destroy()
```

## 文档

- [架构](docs/architecture.md)：VM、桥接、调度与实现位置。
- [观察契约](docs/observed-contract.md)：文档、真机观察和模拟器策略的边界。

上级：[项目文档树](../../README.md#文档树)。

按键派发与 sibling 调整的规则、官方来源及未验证边界见[输入与显示层序](docs/observed-contract.md#输入与显示层序)。

```sh
cd simulator/client/lua-runtime
npm test
```
