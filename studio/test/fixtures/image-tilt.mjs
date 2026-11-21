import { createRuntime } from '../../../client/lua-runtime/src/index.js'
import { playSnapshot } from '../../play/session.js'

// Sized like IMGGEOM, but with one group that can change pose between snapshots.
export function imageTiltFixture(t) {
  const runtime = createRuntime({ canvasWidth: 240, canvasHeight: 160 })
  t.after(() => runtime.destroy())
  const control = (kind, name, w, h, extra = {}) => ({ kind, name, active: true, sizeDeltaX: w, sizeDeltaY: h, ...extra })
  const image = (name, w, h, imageColor, extra) => control('image', name, w, h, { imageId: 100001, imageColor, ...extra })
  const root = runtime.addRoot(control('container', 'Root', 240, 160, { children: [
    control('container', 'Parent', 120, 58, { children: [
      image('Face', 100, 42, 0xff37cbe7, { children: [
        image('Left', 10, 26, 0xffff0000, { anchoredPositionX: -39 }),
        image('Right', 10, 26, 0xffffff00, { anchoredPositionX: 39 }),
      ] }),
      control('cursor', 'Hit', 100, 42),
    ] }),
    image('Static', 12, 10, 0xff008800, { anchoredPositionX: -108 }),
  ] }))
  const script = runtime.mountScript({ path: 'nested-tilt', control: root, source: `
local parent = script.object:GetChild('Parent')
local face = parent:GetChild('Face')
local hit = parent:GetChild('Hit')
function Pose(parentY, childY)
  parent:SetLocalRotation(0, parentY, 0)
  face.localRotationY = childY
  hit.localRotationY = childY
end
function SetDepth(z) parent:SetLocalScale(1, 1, z) end
function DepthField(z) parent.localScaleZ = z end
function DepthTween(z) game.Tween(parent, { localScaleZ = z }, 1):Play() end
` })
  const session = { runtime, compiled: { canvasId: 'pc-16-9', platform: 'PC' } }
  return { runtime, session, parent: root.GetChild('Parent'),
    scene: sceneRev => playSnapshot(session, { view: true, sceneRev }).scene,
    lua: (method, ...args) => runtime.invokeOn(script.env, method, args),
  }
}
