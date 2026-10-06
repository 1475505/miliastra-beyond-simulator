import test from 'node:test'
import assert from 'node:assert/strict'
import { createRuntime } from '../src/index.js'

test('Lua audio API returns independent instance IDs, stops a specific instance and expires on runtime time', t => {
  const rt = createRuntime({ audioDuration: id => id === 50888 ? 0.495 : null })
  t.after(() => rt.destroy())
  const root = rt.addRoot({ kind: 'container', active: true })
  rt.mountScript({ path: 'audio', control: root, source: `
function OnStart()
  a = game.PlayAudio2D(50888)
  b = game.PlayAudio2D(50888)
  assert(type(a) == 'number' and math.type(a) == 'integer' and a ~= b)
  assert(game.IsAudioAlive(a) and game.IsAudioAlive(b))
  game.StopAudio(a)
  assert(not game.IsAudioAlive(a) and game.IsAudioAlive(b))
  game.StopAudio(a)
  game.StopAudio(-99)
  assert(not game.IsAudioAlive(-99))
  local unknown = game.PlayAudio2D(999999)
  assert(not game.IsAudioAlive(unknown))
  game.PauseLevelTime(true)
  script:EnableUpdate(true)
end
function OnUpdate()
  print('alive', game.IsAudioAlive(b))
end` })
  assert.deepEqual(rt.mountErrors, [])
  assert.equal(rt.audios.size, 1)
  assert.equal(rt.audioSnapshot().recent[0].stopped, true)
  rt.step(0.49)
  assert.equal(rt.logs.at(-1).text, 'alive\ttrue')
  rt.step(0.005)
  assert.equal(rt.logs.at(-1).text, 'alive\tfalse')
  assert.equal(rt.clock.levelTime, 0, 'audio clock is independent of PauseLevelTime (preview policy)')
  assert.equal(rt.audios.size, 0)
})

test('audio rejects wrong arity/non-integers and bounds retained instances', t => {
  const rt = createRuntime({ audioDuration: () => 2 })
  t.after(() => rt.destroy())
  const root = rt.addRoot({ kind: 'container', active: true })
  rt.mountScript({ path: 'bad-audio', control: root, source: `
function OnStart()
  for _, fn in ipairs({game.PlayAudio2D, game.StopAudio, game.IsAudioAlive}) do
    for _, value in ipairs({'50888', 1.5, true, {}, math.huge}) do assert(not pcall(fn, value)) end
    assert(not pcall(fn))
  end
  assert(not pcall(function() game:PlayAudio2D(50888) end))
  print('validations-passed')
end` })
  assert.deepEqual(rt.mountErrors, [])
  assert.ok(rt.logs.some(row => row.text === 'validations-passed'))
  for (let i = 0; i < 300; i++) rt.playAudio(50888)
  assert.equal(rt.audios.size, 128)
  assert.equal(rt.audioHistory.length, 128)
  rt.destroy()
  assert.equal(rt.audios.size, 0)
})
