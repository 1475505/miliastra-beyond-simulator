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

详见 `docs/architecture.md`。

按键监听的模拟器派发按当前同级显示层序从上到下进行；Lua 调整 sibling 顺序后，下一次按键也使用新顺序。此行为对应创作者提供的后续版本规则，新版真机待验。

```sh
cd simulator/client/lua-runtime
npm test
```
