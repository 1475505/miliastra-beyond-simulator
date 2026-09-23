import { test } from 'node:test'
import assert from 'node:assert/strict'
import { flattenScenePaint, renderEditorPng, renderPaintPng, renderScenePng } from '../lib/host-png.js'

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47])

test('paint renderer draws visible primitives into a PNG', () => {
  const png = renderPaintPng([
    {
      id: 1,
      kind: 'button',
      left: 40,
      bottom: 40,
      width: 120,
      height: 40,
      sourceWidth: 120,
      sourceHeight: 40,
      matrix: { a: 1, b: 0, c: 0, d: 1, tx: 100, ty: 60 },
    },
    {
      id: 2,
      kind: 'image',
      primitive: 'fivestar',
      imageColor: 0xffffcc00,
      left: 180,
      bottom: 80,
      width: 80,
      height: 80,
      sourceWidth: 80,
      sourceHeight: 80,
      matrix: { a: 1, b: 0, c: 0, d: 1, tx: 220, ty: 120 },
    },
    {
      id: 3,
      kind: 'textbox',
      text: 'HOST',
      fontSize: 24,
      fontColor: 0xffffffff,
      bgColor: 0xff224466,
      enableOutline: true,
      outlineColor: 0xff000000,
      horizontalAlignment: 'Middle',
      verticalAlignment: 'Middle',
      left: 40,
      bottom: 140,
      width: 160,
      height: 48,
      sourceWidth: 160,
      sourceHeight: 48,
      matrix: { a: 1, b: 0, c: 0, d: 1, tx: 120, ty: 164 },
    },
  ], 320, 240)
  assert.equal(png.width, 320)
  assert.equal(png.height, 240)
  assert.ok(png.data.subarray(0, 4).equals(PNG))
  assert.ok(png.data.length > 400)
})

test('scene flatten matches Pixi sibling cover: first child paints last', () => {
  const paint = flattenScenePaint({
    format: 'tree-v1',
    nodes: [
      {
        id: 1, parent: null, z: 0, kind: 'image', name: 'front',
        sourceWidth: 1600, sourceHeight: 900, imageColor: 0xffff0000, primitive: 'rect',
        matrix: { a: 1, b: 0, c: 0, d: 1, tx: 800, ty: 450 },
      },
      {
        id: 2, parent: null, z: 1, kind: 'image', name: 'back',
        sourceWidth: 1600, sourceHeight: 900, imageColor: 0xff00ff00, primitive: 'rect',
        matrix: { a: 1, b: 0, c: 0, d: 1, tx: 800, ty: 450 },
      },
      {
        id: 3, parent: 2, z: 0, kind: 'image', name: 'child-of-back',
        sourceWidth: 10, sourceHeight: 10, imageColor: 0xff0000ff, primitive: 'rect',
        matrix: { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 },
      },
    ],
  })
  assert.deepEqual(paint.map((row) => row.name), ['back', 'child-of-back', 'front'])
  assert.equal(paint[2].matrix.tx, 800)
  assert.equal(paint[1].matrix.tx, 800)
})

test('scene renderer accepts a tree-v1 snapshot', () => {
  const png = renderScenePng({
    format: 'tree-v1',
    nodes: [
      {
        id: 1, parent: null, z: 0, kind: 'image', primitive: 'circle', imageColor: 0xffff0000,
        sourceWidth: 60, sourceHeight: 60,
        matrix: { a: 1, b: 0, c: 0, d: 1, tx: 200, ty: 120 },
      },
    ],
  }, 400, 300)
  assert.equal(png.width, 400)
  assert.equal(png.height, 300)
  assert.ok(png.data.subarray(0, 4).equals(PNG))
})

test('editor renderer keeps selected controls and skips hidden boxes', () => {
  const png = renderEditorPng({
    selectedId: 'n2',
    canvas: { width: 400, height: 300 },
    asset: { type: 'server-control-template' },
    boxes: [
      { id: 'sc1', kind: 'server-container', visible: true, left: 0, bottom: 0, width: 400, height: 300 },
      { id: 'n1', kind: 'button', name: '开采', visible: true, left: 40, bottom: 40, width: 120, height: 40 },
      { id: 'n2', kind: 'image', primitive: 'circle', imageColor: 0xffff0000, visible: true, left: 200, bottom: 80, width: 60, height: 60 },
      { id: 'n3', kind: 'textbox', text: 'hidden', visible: false, left: 10, bottom: 10, width: 40, height: 20 },
    ],
  })
  assert.equal(png.page, 'UI 编辑')
  assert.equal(png.width, 400)
  assert.equal(png.height, 300)
  assert.ok(png.data.subarray(0, 4).equals(PNG))
})
