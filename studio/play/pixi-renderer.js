import { Application, CanvasSource, ImageSource, Container, DOMAdapter, Graphics, Matrix, Sprite, Text, TextStyle, Texture } from 'pixi.js'
import { imageFillRect } from './image-fill.js'
import { scrollBarGeometry, visibleTextLines, intersectClipPolygons } from './scroll-geometry.js'
import { loadBrowserImage, subscribeImageRefresh } from '../assets/browser.js'
// Pixi's default uniform sync uses Function().  Local Web intentionally has a
// restrictive CSP, so register Pixi's static sync implementation instead.
import 'pixi.js/unsafe-eval'

// The Runtime owns all gameplay semantics.  This module is intentionally a
// one-way projection of its compact paint list / hierarchical scene into a
// WebGL tree. Parent rotation/translation stays on the parent Container so a
// whale-girl of thousands of primitives can tilt without rewriting children.
const TRI_POINTS = [0, -0.5, 0.5, 0.5, -0.5, 0.5]
const STAR4_POINTS = [0, -0.5, 0.12, -0.12, 0.5, 0, 0.12, 0.12, 0, 0.5, -0.12, 0.12, -0.5, 0, -0.12, -0.12]
const STAR5_POINTS = [0, -0.5, 0.11, -0.15, 0.48, -0.15, 0.18, 0.07, 0.29, 0.41, 0, 0.2, -0.29, 0.41, -0.18, 0.07, -0.48, -0.15, -0.11, -0.15]
const PAINT_KINDS = new Set(['image', 'textbox', 'textwindow', 'button', 'grid'])

function argb(value, fallback = 0xffffffff) {
  const raw = Number(value == null ? fallback : value) >>> 0
  return {
    color: raw & 0x00ffffff,
    alpha: ((raw >>> 24) & 0xff) / 0xff,
  }
}

function finite(value, fallback = 0) {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

function affine(item) {
  const raw = item?.matrix
  if (!raw || typeof raw !== 'object') return null
  const values = [raw.a, raw.b, raw.c, raw.d, raw.tx, raw.ty].map(Number)
  return values.every(Number.isFinite) ? values : null
}

function textAnchor(item) {
  const horizontal = item.horizontalAlignment === 'Right' ? 1 : item.horizontalAlignment === 'Middle' ? 0.5 : 0
  const vertical = item.verticalAlignment === 'Bottom' ? 1 : item.verticalAlignment === 'Middle' ? 0.5 : 0
  return { x: horizontal, y: vertical }
}

function pointsFor(item, width, height) {
  const template = item.primitive === 'triangle'
    ? TRI_POINTS
    : item.primitive === 'fourstar'
      ? STAR4_POINTS
      : STAR5_POINTS
  const points = []
  for (let i = 0; i < template.length; i += 2) {
    points.push(template[i] * width, template[i + 1] * height)
  }
  return points
}

function visualKeyOf(item, width, height) {
  if (spriteCircle(item)) return [item.kind, item.primitive, item.imageId, 'sprite'].join('\t')
  return [
    item.kind, item.primitive, width, height, item.imageColor, item.imageId,
    item.fillType, item.fillHorizontalType, item.fillVerticalType, item.fillAmount,
    item.text, item.fontSize, item.fontColor, item.bgColor, item.enableOutline,
    item.outlineColor, item.horizontalAlignment, item.verticalAlignment, item.pressed,
    JSON.stringify(item.scroll),
  ].join('\t')
}

function spriteCircle(item) {
  return item.kind === 'image' && item.primitive === 'circle' && (!item.fillType || item.fillType === 'Unused')
}

export function createCircleTexture(size) {
  const canvas = DOMAdapter.get().createCanvas(size, size)
  canvas.width = canvas.height = size
  const context = canvas.getContext('2d')
  context.fillStyle = '#ffffff'
  context.beginPath()
  context.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2)
  context.fill()
  return new Texture({ source: new CanvasSource({ resource: canvas, width: size, height: size, resolution: 1 }) })
}

/**
 * WebGL-only display adapter for the deterministic Runtime.
 * Hierarchical scene nodes keep parent transforms on the parent Container;
 * the flattened paint list remains for tests and fallbacks.
 */
export class PixiPlayRenderer {
  constructor(canvas) {
    this.canvas = canvas
    this.app = null
    this.nodes = new Map()
    this.circleTextures = new Map()
    this.imageTextures = new Map()
    this.disposed = false
    this.unsubscribeImages = subscribeImageRefresh(id => this.invalidateImage(id))
    this.canvasWidth = 0
    this.canvasHeight = 0
    this.scratch = new Matrix()
    this.ready = this.initialize()
  }

  async initialize() {
    const app = new Application()
    await app.init({
      canvas: this.canvas,
      width: 1,
      height: 1,
      autoStart: false,
      // CSS owns the scaled stage size; Pixi only owns the high-DPI backing
      // buffer through `resolution`. autoDensity would overwrite this with
      // the logical canvas dimensions on every renderer resize.
      autoDensity: false,
      resolution: Math.min(2, window.devicePixelRatio || 1),
      antialias: true,
      backgroundAlpha: 0,
      preference: 'webgl',
      powerPreference: 'high-performance',
    })
    app.ticker.stop()
    app.stage.eventMode = 'none'
    app.stage.sortableChildren = true
    this.app = app
  }

  resize(width, height) {
    const w = Math.max(1, Math.round(finite(width, 1)))
    const h = Math.max(1, Math.round(finite(height, 1)))
    if (w === this.canvasWidth && h === this.canvasHeight) return
    this.canvasWidth = w
    this.canvasHeight = h
    this.app.renderer.resize(w, h)
  }

  createNode(item, { group = false } = {}) {
    const root = new Container({ isRenderGroup: !!group })
    root.label = `runtime:${item.id}`
    root.eventMode = 'none'
    root.sortableChildren = true
    root.__runtimeId = item.id
    root.__group = !!group
    this.nodes.set(item.id, root)
    this.app.stage.addChild(root)
    return root
  }

  clearVisual(root) {
    if (!root.__visual) return
    root.removeChild(root.__visual)
    // Every Graphics in a visual owns its context. Passing only `children`
    // suppresses Pixi's default context disposal and leaves old geometry in
    // the timed GC pool after animated sizes/colors replace the visual.
    root.__visual.destroy({ children: true, context: true })
    root.__visual = null
    root.__visualKey = ''
  }

  circleTexture(diameter) {
    // Keep small animated circles in one size bucket. The shared texture has
    // a fixed four-vertex Sprite mesh, so radius/color animation cannot reuse
    // a stale triangle fan from a differently sized Graphics object.
    const resolution = this.app?.renderer.resolution || 2
    const size = Math.min(4096, Math.max(256, 2 ** Math.ceil(Math.log2(Math.max(1, diameter * resolution)))))
    this.circleTextures ||= new Map()
    let texture = this.circleTextures.get(size)
    if (!texture) {
      texture = createCircleTexture(size)
      this.circleTextures.set(size, texture)
    }
    return texture
  }

  imageTexture(id) {
    this.imageTextures ||= new Map()
    if (this.imageTextures.has(id)) return this.imageTextures.get(id)
    const entry = { texture: null, error: '' }
    this.imageTextures.set(id, entry)
    // Do not block scene polling or Lua time on network I/O. Completion
    // repaints even a paused/static scene, using each node's latest item.
    entry.promise = loadBrowserImage(id).then(image => {
      if (this.disposed || this.imageTextures.get(id) !== entry) return
      // Renderer-owned GPU source; never destroy another renderer's texture
      // through Pixi's global Texture.from(resource) cache.
      entry.texture = new Texture({ source: new ImageSource({ resource: image }) })
      for (const root of this.nodes.values()) {
        const item = root.__sceneItem
        if (item?.kind !== 'image' || item.imageId !== id) continue
        root.__visualKey = ''
        this.updateNode(root, item, { nested: !root.__flat && item.parent != null })
      }
      this.app?.render()
    }).catch(error => { entry.error = error.message })
    return entry
  }

  invalidateImage(id) {
    const entry = this.imageTextures.get(id)
    this.imageTextures.delete(id)
    for (const root of this.nodes.values()) {
      const item = root.__sceneItem
      if (item?.kind !== 'image' || item.imageId !== id) continue
      root.__visualKey = ''
      this.updateNode(root, item, { nested: !root.__flat && item.parent != null })
    }
    entry?.texture?.destroy(true)
    this.app?.render()
  }

  pruneImageTextures() {
    if (!this.imageTextures?.size) return
    const used = new Set([...this.nodes.values()].filter(root => root.__sceneItem?.primitive === 'sprite').map(root => root.__sceneItem.imageId))
    for (const [id, entry] of this.imageTextures || []) {
      if (used.has(id)) continue
      this.imageTextures.delete(id)
      entry.texture?.destroy(true)
    }
  }

  replaceVisual(root, item, width, height) {
    this.clearVisual(root)
    if (!PAINT_KINDS.has(item.kind)) return
    const visual = new Container()
    visual.eventMode = 'none'
    visual.label = `visual:${item.id}`
    if (item.kind === 'grid') visual.zIndex = Number.MAX_SAFE_INTEGER
    if (item.kind === 'textbox' || item.kind === 'textwindow') {
      const background = new Graphics()
      const bg = argb(item.bgColor, 0x00ffffff)
      background.rect(-width / 2, -height / 2, width, height).fill(bg)
      visual.addChild(background)
      const font = Math.max(8, finite(item.fontSize, 12))
      const anchor = textAnchor(item)
      const scroll = item.kind === 'textwindow' ? item.scroll : null
      const slice = scroll ? visibleTextLines(scroll, height) : null
      const text = new Text({
        text: slice ? slice.text : String(item.text || ''),
        style: new TextStyle({
          fontFamily: 'Inter, "Microsoft YaHei UI", "Microsoft YaHei", sans-serif',
          fontSize: font,
          fill: argb(item.fontColor, 0xffffffff),
          stroke: item.enableOutline ? { color: argb(item.outlineColor, 0xff000000).color, width: Math.max(2, font * 0.12), join: 'round' } : undefined,
          wordWrap: !scroll,
          wordWrapWidth: Math.max(4, width - 4),
          breakWords: true,
          align: anchor.x === 1 ? 'right' : anchor.x === 0.5 ? 'center' : 'left',
          lineHeight: font * 1.2,
        }),
      })
      text.anchor.set(anchor.x, anchor.y)
      text.x = anchor.x === 0 ? -width / 2 + 2 : anchor.x === 1 ? width / 2 - 2 : 0
      text.y = anchor.y === 0 ? -height / 2 : anchor.y === 1 ? height / 2 : 0
      if (scroll) {
        text.anchor.set(anchor.x, 0)
        text.x = -width / 2 + 2 + anchor.x * scroll.textWidth
        text.y = -height / 2 - scroll.offset + slice.y + (scroll.max > 0 ? 0 : anchor.y * (height - scroll.contentLength))
      }
      const clip = new Graphics().rect(-width / 2, -height / 2, width, height).fill({ color: 0xffffff, alpha: 1 })
      text.mask = clip
      visual.addChild(clip, text)
    } else if (item.kind === 'button') {
      const graphic = new Graphics()
      graphic.roundRect(-width / 2, -height / 2, width, height, 6).fill({ color: 0x3268cf, alpha: 1 })
      graphic.roundRect(-width / 2, -height / 2, width, height, 6).stroke({ color: 0x70a0ff, alpha: 0.8, width: 1 })
      if (item.pressed) graphic.roundRect(-width / 2, -height / 2, width, height, 6).fill({ color: 0x000000, alpha: 0.28 })
      visual.addChild(graphic)
    } else if (item.kind === 'image' && item.primitive === 'sprite' && this.imageTexture(item.imageId).texture) {
      const sprite = new Sprite({ texture: this.imageTextures.get(item.imageId).texture, anchor: 0.5 })
      const color = argb(item.imageColor, 0xffffffff)
      sprite.width = width
      sprite.height = height
      sprite.tint = color.color
      sprite.alpha = color.alpha
      const fill = imageFillRect(item, width, height)
      sprite.visible = width > 0 && height > 0 && (!fill || (fill.width > 0 && fill.height > 0))
      if (fill && sprite.visible) {
        const clip = new Graphics().rect(fill.x, fill.y, fill.width, fill.height).fill(0xffffff)
        sprite.mask = clip
        visual.addChild(clip)
      }
      visual.addChild(sprite)
    } else if (spriteCircle(item)) {
      const circle = new Sprite({ texture: this.circleTexture(Math.max(width, height)), anchor: 0.5 })
      visual.__circle = circle
      visual.addChild(circle)
    } else if (item.kind !== 'grid') {
      const graphic = new Graphics()
      const color = argb(item.imageColor, 0xffffffff)
      if (item.primitive === 'missing' || item.primitive === 'sprite') {
        graphic.rect(-width / 2, -height / 2, width, height).fill({ color: 0x482228, alpha: 0.36 })
        graphic.rect(-width / 2 + 0.5, -height / 2 + 0.5, Math.max(0, width - 1), Math.max(0, height - 1)).stroke({ color: 0xff7481, alpha: 1, width: 1 })
      } else if (item.primitive === 'circle') {
        graphic.ellipse(0, 0, width / 2, height / 2).fill(color)
      } else if (item.primitive === 'ring') {
        graphic.ellipse(0, 0, Math.max(1, width / 2 - 3.5), Math.max(1, height / 2 - 3.5)).stroke({ ...color, width: 7 })
      } else if (item.primitive === 'triangle' || item.primitive === 'fourstar' || item.primitive === 'fivestar') {
        graphic.poly(pointsFor(item, width, height)).fill(color)
      } else {
        graphic.rect(-width / 2, -height / 2, width, height).fill(color)
      }
      const fill = imageFillRect(item, width, height)
      if (fill) {
        // A zero-size Graphics mask has no geometry; hide the image explicitly
        // so all rendering backends agree that amount zero is empty.
        graphic.visible = fill.width > 0 && fill.height > 0
        if (graphic.visible) {
          const clip = new Graphics().rect(fill.x, fill.y, fill.width, fill.height).fill({ color: 0xffffff, alpha: 1 })
          graphic.mask = clip
          visual.addChild(clip)
        }
      }
      visual.addChild(graphic)
    }
    const bar = scrollBarGeometry(item.scroll, width, height)
    if (bar) {
      const graphic = new Graphics()
      graphic.label = 'scrollbar'
      for (const [rect, color] of [[bar.track, 0x263447], [bar.thumb, 0x90aecb]]) graphic.rect(rect.x, rect.y, rect.width, rect.height).fill({ color, alpha: 1 })
      visual.addChild(graphic)
    }
    visual.scale.set(item.pressed ? 0.98 : 1)
    root.addChildAt(visual, 0)
    root.__visual = visual
  }

  applyMatrix(root, item, nested) {
    const matrix = affine(item)
    if (!matrix) {
      const width = Math.max(0, finite(item.sourceWidth, finite(item.width)))
      const height = Math.max(0, finite(item.sourceHeight, finite(item.height)))
      root.x = finite(item.left) + width / 2
      root.y = this.canvasHeight - finite(item.bottom) - height / 2
      root.rotation = -finite(item.rotationZ) * Math.PI / 180
      root.scale.set(1)
      return
    }
    const [a, b, c, d, tx, ty] = matrix
    // Runtime matrices use bottom-left / Y-up coordinates. Pixi's local
    // and stage coordinates are Y-down, hence the signs on b/c and ty.
    // Nested nodes are already relative to a converted parent, so ty flips
    // about 0 rather than the canvas height.
    this.scratch.set(a, -b, -c, d, tx, nested ? -ty : this.canvasHeight - ty)
    root.setFromMatrix(this.scratch)
  }

  updateNode(root, item, { nested = false } = {}) {
    const width = Math.max(0, finite(item.sourceWidth, finite(item.width)))
    const height = Math.max(0, finite(item.sourceHeight, finite(item.height)))
    const visualKey = visualKeyOf(item, width, height)
    if (root.__visualKey !== visualKey) {
      this.replaceVisual(root, item, width, height)
      // replaceVisual clears the previous key while disposing its Graphics.
      // Commit the new key afterwards so movement does not keep destroying
      // and recreating the same geometry after a size/color update.
      root.__visualKey = visualKey
    }
    if (root.__visual) root.__visual.scale.set(item.pressed ? 0.98 : 1)
    const circle = root.__visual?.__circle
    if (circle) {
      const diameter = Math.max(width, height)
      const color = argb(item.imageColor, 0xffffffff)
      circle.texture = this.circleTexture(diameter)
      circle.width = width
      circle.height = height
      circle.tint = color.color
      circle.alpha = color.alpha
      circle.visible = width > 0 && height > 0
    }
    this.applyMatrix(root, item, nested)
  }

  attachNode(root, item) {
    const parentId = item.parent
    const parent = parentId == null ? this.app.stage : this.nodes.get(parentId)
    const host = parent || this.app.stage
    if (root.parent !== host) host.addChild(root)
    host.sortableChildren = true
    root.zIndex = -finite(item.z)
  }

  upsertSceneNode(item) {
    if (!item || item.id === undefined || item.id === null) return
    const group = item.group === true
    let root = this.nodes.get(item.id)
    if (!root) root = this.createNode(item, { group })
    else if (root.__group !== group) {
      if (group) root.enableRenderGroup?.()
      else root.disableRenderGroup?.()
      root.__group = group
    }
    this.updateNode(root, item, { nested: item.parent != null })
    this.attachNode(root, item)
    root.__sceneItem = item
    root.__flat = false
  }

  updateViewportClip(root) {
    const item = root.__sceneItem
    const parent = this.nodes.get(item?.parent)?.__sceneItem
    let polygons = item?.clipPolygons || []
    if (!root.__flat && item?.clipToParent && parent) {
      const w = parent.sourceWidth / 2, h = parent.sourceHeight / 2
      polygons = [[[-w, -h], [w, -h], [w, h], [-w, h]].map(([x, y]) => ({ x, y }))]
    }
    const key = JSON.stringify([polygons, item?.matrix])
    if (root.__clipKey === key) return
    root.__clipKey = key
    root.mask = null
    root.__viewportClip?.destroy({ context: true })
    root.__viewportClip = null
    root.visible = true
    if (!polygons.length) return
    const values = affine(item)
    if (!values || Math.abs(values[0] * values[3] - values[1] * values[2]) < 1e-8) { root.visible = false; return }
    const matrix = new Matrix(...values).invert()
    const points = intersectClipPolygons(polygons).flatMap(point => { const p = matrix.apply(point); return [p.x, -p.y] })
    if (points.length < 6 || !points.every(Number.isFinite)) { root.visible = false; return }
    const clip = new Graphics().poly(points).fill({ color: 0xffffff, alpha: 1 })
    root.addChild(clip)
    root.mask = clip
    root.__viewportClip = clip
  }

  removeNode(id) {
    const root = this.nodes.get(id)
    if (!root) return
    for (const child of [...root.children]) {
      if (child.__runtimeId != null) root.removeChild(child)
    }
    root.parent?.removeChild(root)
    this.clearVisual(root)
    root.mask = null
    root.__viewportClip?.destroy({ context: true })
    root.destroy({ children: false })
    this.nodes.delete(id)
  }

  clearNodes() {
    for (const id of [...this.nodes.keys()]) this.removeNode(id)
  }

  async applyScene(scene, width, height) {
    await this.ready
    this.resize(width, height)
    if (!scene || scene.format !== 'tree-v1') {
      this.app.render()
      return
    }
    if (scene.reset) this.clearNodes()
    for (const id of scene.removed || []) this.removeNode(id)
    const list = scene.reset ? scene.nodes : scene.changed
    for (let i = 0; i < (list || []).length; i += 1) {
      const item = list[i]
      if (!item || item.id === undefined || item.id === null) continue
      if (!this.nodes.has(item.id)) this.createNode(item, { group: item.group === true })
    }
    for (let i = 0; i < (list || []).length; i += 1) this.upsertSceneNode(list[i])
    for (const root of this.nodes.values()) if (root.__sceneItem?.clipToParent || root.__viewportClip) this.updateViewportClip(root)
    this.pruneImageTextures()
    this.app.render()
  }

  async render(items, width, height) {
    await this.ready
    this.resize(width, height)
    const visible = new Set()
    const list = Array.isArray(items) ? items : []
    for (let index = 0; index < list.length; index += 1) {
      const item = list[index]
      if (!item || item.id === undefined || item.id === null) continue
      visible.add(item.id)
      const root = this.nodes.get(item.id) || this.createNode(item)
      this.updateNode(root, item)
      root.__sceneItem = item
      root.__flat = true
      this.updateViewportClip(root)
      root.zIndex = index
      if (root.parent !== this.app.stage) this.app.stage.addChild(root)
    }
    for (const [id] of this.nodes) {
      if (visible.has(id)) continue
      this.removeNode(id)
    }
    this.pruneImageTextures()
    this.app.render()
  }

  destroy() {
    this.disposed = true
    this.unsubscribeImages?.()
    this.clearNodes()
    for (const entry of this.imageTextures?.values() || []) entry.texture?.destroy(true)
    this.imageTextures?.clear()
    for (const texture of this.circleTextures.values()) texture.destroy(true)
    this.circleTextures.clear()
    this.app?.destroy({ removeView: false }, { children: true, texture: true, textureSource: true })
    this.app = null
  }
}

export {
  PLAY_MOVE_THROTTLE_MS,
  PLAY_POLL_INTERVAL_MS,
  createPlaySession,
  keyEventName,
  stagePoint,
} from './browser-session.js'
