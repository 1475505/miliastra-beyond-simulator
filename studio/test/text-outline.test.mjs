import test from 'node:test'
import assert from 'node:assert/strict'
import { Container, Text } from 'pixi.js'
import { PixiPlayRenderer } from '../play/pixi-renderer.js'

test('Pixi text preserves the supplied outline alpha instead of making a faint outline opaque', t => {
  const renderer = Object.create(PixiPlayRenderer.prototype)
  const root = new Container()
  t.after(() => root.destroy({ children: true }))
  const item = { id: 1, kind: 'textbox', text: 'A', fontSize: 38,
    fontColor: 0xffffffff, enableOutline: true, outlineColor: 0x33333333 }
  for (const [outlineColor, alpha] of [[0x33333333, 0.2], [0x00333333, 0], [0xff333333, 1]]) {
    renderer.replaceVisual(root, { ...item, outlineColor }, 160, 80)
    const text = root.__visual.children.find(child => child instanceof Text)
    assert.equal(text.style.stroke.color, 0x333333)
    assert.equal(text.style.stroke.alpha, alpha)
    assert.equal(text.style.stroke.width, 38 * 0.12)
  }
})
