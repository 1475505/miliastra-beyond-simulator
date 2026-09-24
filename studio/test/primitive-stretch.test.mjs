import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createCanvas, loadImage } from '@napi-rs/canvas'
import { renderPaintPng } from '../host-png.js'

async function colored(primitive, x, y, rotationZ = 0) {
  const paint = [{ id: 1, kind: 'image', primitive, imageColor: 0xffff0000,
    left: 60, bottom: 90, width: 200, height: 60, rotationZ }]
  const png = renderPaintPng(paint, 320, 240)
  const canvas = createCanvas(320, 240)
  const context = canvas.getContext('2d')
  context.drawImage(await loadImage(png.data), 0, 0)
  const data = context.getImageData(x, y, 1, 1).data
  return data[0] > 220 && data[1] < 40 && data[2] < 40
}

test('PNG stretches circle and ring across both axes while retaining their distinct interiors', async () => {
  assert.equal(await colored('circle', 240, 120), true, 'wide ellipse reaches toward the right side')
  assert.equal(await colored('circle', 160, 145), true, 'ellipse reaches toward the bottom')
  assert.equal(await colored('circle', 240, 145), false, 'ellipse corner remains empty')
  assert.equal(await colored('ring', 255, 120), true, 'wide ring reaches the right edge')
  assert.equal(await colored('ring', 160, 120), false, 'ring center remains hollow')
  assert.equal(await colored('ring', 160, 148), true, 'ring reaches the bottom edge')
})

test('rotation applies to the stretched ellipse and rectangle', async () => {
  for (const primitive of ['circle', 'rect']) {
    assert.equal(await colored(primitive, 225, 82, 30), true, `${primitive} follows the rotated long axis`)
    assert.equal(await colored(primitive, 225, 120, 30), false, `${primitive} leaves the unrotated long axis`)
  }
})

test('rectangle, triangle and stars retain independent width and height geometry', async () => {
  assert.equal(await colored('rect', 80, 100), true, 'rectangle reaches both axes')
  assert.equal(await colored('triangle', 160, 100), true, 'triangle top follows height')
  assert.equal(await colored('triangle', 160, 140), true, 'triangle base follows height')
  assert.equal(await colored('triangle', 80, 100), false, 'triangle excludes its top corner')
  assert.equal(await colored('fourstar', 240, 120), true, 'four-point star reaches toward its wide tip')
  assert.equal(await colored('fourstar', 80, 100), false, 'four-point star excludes its corner')
  assert.equal(await colored('fivestar', 160, 94), true, 'five-point star reaches toward its top tip')
  assert.equal(await colored('fivestar', 240, 111), true, 'five-point star reaches toward its wide tip')
})
