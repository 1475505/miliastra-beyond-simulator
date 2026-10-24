import { createStudio } from '../../index.js'
import { createNode } from '../../ui/authoring.js'
import { PLATFORMS } from '../../constants.js'

export function exportFixture() {
  const save = createStudio().archiveData()
  const a = createNode('container', { id: 'a', guid: 1073744000, name: 'Card' })
  const image = createNode('image', { id: 'image', guid: 1073744001, name: 'Badge', imageId: 100001, imageColor: 0xffff0000 })
  const text = createNode('textbox', { id: 'text', guid: 1073744002, name: 'Title', text: 'SELECTED' })
  a.children = [image, text]
  const b = createNode('container', { id: 'b', guid: 1073744003, name: 'Other' })
  for (const [index, platform] of PLATFORMS.entries()) {
    a.transformByPlatform[platform].size = { x: 400 + index, y: 240 }
    image.transformByPlatform[platform].size = { x: 80 + index, y: 60 }
    image.transformByPlatform[platform].rotation.z = 15 + index
  }
  save.assets.client.root.children = [a, b]
  save.assets.client.selectedId = 'a'
  save.assets.scripts = [
    { guid: 1073744100, path: 'card.lua', source: 'print("card")', controlId: 'a', controlAsset: 'client-control-template' },
    { guid: 1073744101, path: 'badge.lua', source: 'print("badge")', controlId: 'image', controlAsset: 'client-control-template' },
    { guid: 1073744102, path: 'other.lua', source: 'print("other")', controlId: 'b', controlAsset: 'client-control-template' },
    { guid: 1073744103, path: 'module.lua', source: 'return {}', controlId: '' },
  ]
  return createStudio(save)
}
