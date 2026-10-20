import { createDefaultProject, createNode } from '../../ui/authoring.js'
import { createRectTransform } from '../../ui/layout.js'
import { PLATFORMS } from '../../constants.js'

const matrix = (tx = 0, ty = 0) => ({ a: 1, b: 0, c: 0, d: 1, tx, ty })
const node = (id, parent, kind, width, height, extra = {}) => ({
  id, parent, z: 0, kind, name: id, sourceWidth: width, sourceHeight: height, group: false,
  matrix: matrix(), ...extra,
})
const image = (id, parent, extra = {}) => node(id, parent, 'image', 180, 60, {
  primitive: 'rect', imageId: 100001, imageSource: 'StaticReference', imageColor: 0xffff0000, ...extra,
})
const root = () => node('root', null, 'container', 240, 160, { matrix: matrix(120, 80) })
const mask = (id, parent, extra = {}) => image(id, parent, {
  sourceWidth: 100, sourceHeight: 60, imageColor: 0x00ffffff, enableMask: true, enableSoftEdge: true,
  softEdgeMode: 'Pixel', softEdgeWidthX: 20, softEdgeWidthY: 0, ...extra,
})
const scene = nodes => ({ format: 'tree-v1', revision: 1, reset: true, nodes })

export function maskScenes() {
  return {
    single: scene([root(), mask('mask', 'root'), image('red', 'mask')]),
    opaqueParent: scene([root(), mask('mask', 'root', { imageColor: 0xffffffff }), image('red', 'mask')]),
    overlap: scene([root(), mask('mask', 'root'), image('red1', 'mask'), image('red2', 'mask', { z: 1 })]),
    renderGroup: scene([root(), mask('mask', 'root', { group: true }), ...Array.from({ length: 20 }, (_, z) => image(`red-${z}`, 'mask', { z }))]),
    nested: scene([root(), mask('mask', 'root'), mask('inner', 'mask'), image('red', 'inner')]),
    siblings: scene([root(), mask('mask', 'root'), image('red1', 'mask'), mask('other', 'root', { z: 1 }), image('red2', 'other')]),
    zeroWidth: scene([root(), mask('mask', 'root', { sourceWidth: 0 }), image('red', 'mask')]),
    zeroHeight: scene([root(), mask('mask', 'root', { sourceHeight: 0 }), image('red', 'mask')]),
    grid: scene([root(), node('grid', 'root', 'grid', 40, 60), mask('mask', 'grid', { clipToParent: true }), image('red', 'mask')]),
  }
}

// x=80.5 lies 10.5 units inside a 20-unit linear feather: alpha round(255*.525)=134.
// Nested compositing yields round(134*.525)=70; independent sibling groups yield 198.
export const maskSamples = [[60, 80], [80, 80], [100, 80], [120, 80], [150, 80]]
export const maskAlphas = {
  single: [0, 134, 255, 255, 249], opaqueParent: [0, 134, 255, 255, 249], overlap: [0, 134, 255, 255, 249], renderGroup: [0, 134, 255, 255, 249],
  nested: [0, 70, 255, 255, 243], siblings: [0, 198, 255, 255, 255],
  zeroWidth: [0, 0, 0, 0, 0], zeroHeight: [0, 0, 0, 0, 0], grid: [0, 0, 255, 255, 0],
}

export function editorMaskProject({ nested = false } = {}) {
  const project = createDefaultProject()
  const image = (id, width, height, extra = {}) => createNode('image', {
    id, name: id, imageId: 100001, imageColor: 0xffff0000,
    transformByPlatform: Object.fromEntries(PLATFORMS.map(platform => [platform, createRectTransform({ size: [width, height] })])),
    ...extra,
  })
  const mask = image('mask', 100, 60, { imageColor: 0, enableMask: true, enableSoftEdge: true,
    softEdgeMode: 'Pixel', softEdgeWidthX: 20, softEdgeWidthY: 0 })
  mask.children = [image('red', 180, 60), image('red-behind', 180, 60)]
  if (nested) mask.children = [createNode('image', { ...mask, id: 'inner', name: 'inner', children: mask.children })]
  const sibling = image('sibling', 20, 20, { imageColor: 0xff0000ff })
  for (const transform of Object.values(sibling.transformByPlatform)) transform.offset.x = 110
  project.root.children[0].children = [sibling, mask]
  project.selectedId = 'n1'
  return project
}
