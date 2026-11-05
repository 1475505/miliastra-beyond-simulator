// A shared test font makes pixel/line-breaking assertions independent of the
// host's installed fonts. It is generated from rectangles, never distributed.
import { before, after } from 'node:test'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { GlobalFonts } from '@napi-rs/canvas'
import { geometryFont } from './geometry-font.mjs'

let directory, key
const previous = process.env.QXQY_FONT_PATH
before(() => {
  directory = mkdtempSync(join(tmpdir(), 'qxqy-render-font-'))
  const path = join(directory, 'geometry.ttf'), bytes = geometryFont({ extended: true })
  writeFileSync(path, bytes)
  process.env.QXQY_FONT_PATH = path
  key = GlobalFonts.register(bytes, 'Times New Roman')
})
after(() => {
  if (previous === undefined) delete process.env.QXQY_FONT_PATH
  else process.env.QXQY_FONT_PATH = previous
  if (key) GlobalFonts.remove(key)
  if (directory) rmSync(directory, { recursive: true, force: true })
})
