import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRuntime } from '../src/index.js'

// TWPAR (PC video, 2026-11-06): T03-T06, T15, T17-T20. Lane movement
// and child callback counts come from the video, not the old PASS/DIFF oracle.
// Exact boundaries/order retain TWSEM rules; excluding skipped Join spans
// from completion is adopted policy (the video does not expose those times).
// Full-workspace evidence: probes/tween-parallel-20261106/README.md.
function scenario(t, build) {
  const rt = createRuntime()
  t.after(() => {
    try {
      assert.deepEqual(rt.mountErrors, [])
      assert.deepEqual(rt.logs.filter(entry => entry.level !== 'info'), [])
    } finally { rt.destroy() }
  })
  const root = rt.addRoot({ active: true, name: 'Host', kind: 'container', children:
    ['A', 'B', 'C', 'D', 'E'].map(name => ({ active: true, name, kind: 'image', anchoredPositionX: 0 })),
  })
  const script = rt.mountScript({ path: 'sequence', control: root, source: `
local seq
local function mark(tag) return function() print(tag) end end
local function X(name, duration)
  return game.Tween(script.object:GetChild(name), { anchoredPositionX = 100 }, duration)
    :SetOnComplete(mark(name))
end
function OnStart()
  seq = game.TweenSequence()
  ${build}
  seq:SetOnComplete(mark('complete')):Play()
end
function Command(name)
  if name == 'restart' then seq:Restart()
  elseif name == 'complete' then seq:Complete()
  elseif name == 'kill' then seq:Kill(false)
  elseif name == 'pause' then seq:Pause()
  elseif name == 'resume' then seq:Resume() end
end
` })
  return {
    rt,
    at(time) { rt.step(time - rt.clock.time) },
    command(name) { script.invoke('Command', [name]) },
    positions(names) { return [...names].map(name => Number(root.GetChild(name).anchoredPositionX.toFixed(6))) },
    events() { return rt.logs.map(({ text, time }) => [text, Number(time.toFixed(6))]) },
  }
}

for (const { label, order, durations } of [
  { label: 'T03 two joins', order: 'ABC', durations: [2.4, 2.4, 2.4] },
  { label: 'T04 reversed lanes', order: 'CBA', durations: [2.4, 2.4, 2.4] },
  { label: 'T05 four joins', order: 'ABCDE', durations: [2.4, 2.4, 2.4, 2.4, 2.4] },
  { label: 'T06 different durations', order: 'ABC', durations: [0.8, 1.6, 2.4] },
]) {
  test(`sequence ${label}: only the first Join plays and fires child callbacks`, (t) => {
    const q = scenario(t, [...order].map((name, i) =>
      `seq:${i ? 'Join' : 'Append'}(X('${name}', ${durations[i]}))`).join('\n') +
      "\nseq:AppendCallback(mark('tail'))")
    q.at(0.4)
    assert.deepEqual(q.positions(order), durations.map((duration, i) =>
      i < 2 ? Number((100 * 0.4 / duration).toFixed(6)) : 0))
    q.at(durations[0])
    const end = Math.max(durations[0], durations[1])
    q.at(end)
    assert.deepEqual(q.positions(order), [...order].map((_, i) => i < 2 ? 100 : 0))
    assert.deepEqual(q.events(), [[order[0], durations[0]], [order[1], durations[1]], ['tail', end], ['complete', end]])
    q.at(4)
    assert.equal(q.rt.animations.size, 0)
    assert.equal(q.events().length, 4, 'skipped joins never complete later')
  })
}

test('sequence T15: Insert does not move the Append cursor; completion waits for both', (t) => {
  const q = scenario(t, `seq:Append(X('A', 0.8)):Insert(0, X('B', 2.4)):Append(X('C', 0.8))
    :AppendCallback(mark('tail'))`)
  q.at(0.8)
  assert.deepEqual(q.positions('AC'), [100, 0])
  q.at(1.2)
  assert.deepEqual(q.positions('ABC'), [100, 50, 50])
  q.at(1.6)
  assert.deepEqual(q.events(), [['A', 0.8], ['C', 1.6], ['tail', 1.6]])
  q.at(2.4)
  assert.deepEqual(q.positions('ABC'), [100, 100, 100])
  assert.deepEqual(q.events().slice(-2), [['B', 2.4], ['complete', 2.4]])
})

test('sequence T17: future InsertCallback does not delay the next Append', (t) => {
  const q = scenario(t, `seq:Append(X('A', 1)):InsertCallback(2, mark('insert'))
    :Append(X('B', 1)):AppendCallback(mark('tail'))`)
  q.at(1)
  q.at(1.5)
  assert.deepEqual(q.positions('AB'), [100, 50])
  q.at(2)
  assert.deepEqual(q.events(), [['A', 1], ['B', 2], ['insert', 2], ['tail', 2], ['complete', 2]])
})

test('sequence T18: a later InsertCallback extends completion beyond the Append tail', (t) => {
  const q = scenario(t, `seq:Append(X('A', 1)):Append(X('B', 1)):AppendCallback(mark('tail'))
    :InsertCallback(3, mark('insert'))`)
  q.at(1)
  q.at(2)
  assert.deepEqual(q.events(), [['A', 1], ['B', 2], ['tail', 2]])
  q.at(3)
  assert.deepEqual(q.events().slice(-2), [['insert', 3], ['complete', 3]])
})

test('sequence T19: AppendInterval advances only the Append cursor after InsertCallback', (t) => {
  const q = scenario(t, `seq:Append(X('A', 0.8)):InsertCallback(1.6, mark('insert'))
    :AppendInterval(0.4):Append(X('B', 0.8)):AppendCallback(mark('tail'))`)
  q.at(0.8)
  q.at(1)
  assert.deepEqual(q.positions('AB'), [100, 0])
  q.at(1.6)
  assert.deepEqual(q.positions('AB'), [100, 50])
  q.at(2)
  assert.deepEqual(q.events(), [['A', 0.8], ['insert', 1.6], ['B', 2], ['tail', 2], ['complete', 2]])
})

test('sequence T20: inserting a callback first leaves the first Append at zero', (t) => {
  const q = scenario(t, `seq:InsertCallback(1, mark('insert')):Append(X('A', 0.8))
    :Append(X('B', 0.8)):AppendCallback(mark('tail'))`)
  q.at(0.4)
  assert.deepEqual(q.positions('AB'), [50, 0])
  q.at(0.8)
  q.at(1)
  assert.deepEqual(q.positions('AB'), [100, 25])
  q.at(1.6)
  assert.deepEqual(q.events(), [['A', 0.8], ['insert', 1], ['B', 1.6], ['tail', 1.6], ['complete', 1.6]])
})

// These extensions encode the adopted scheduling policy, not additional
// device observations: T08/T14 were supplied in JSON but not run in the video.
for (const interval of [0, 1, 3]) {
  test(`Insert-only sequence with AppendInterval(${interval}) keeps its own tail`, (t) => {
    const q = scenario(t, `seq:Insert(0, X('A', 2.4)):Insert(0, X('B', 2.4)):Insert(0, X('C', 2.4))
      :AppendInterval(${interval}):AppendCallback(mark('tail'))`)
    q.at(0)
    assert.deepEqual(q.events(), interval ? [] : [['tail', 0]])
    q.at(1)
    assert.deepEqual(q.positions('ABC'), [41.666667, 41.666667, 41.666667])
    q.at(2.4)
    q.at(3)
    assert.deepEqual(q.events().filter(([tag]) => tag === 'tail' || tag === 'complete'),
      [['tail', interval], ['complete', Math.max(interval, 2.4)]])
  })
}

test('sequence policy: a new Append step has its own Join slot', (t) => {
  const q = scenario(t, `seq:Append(X('A', 0.4)):Join(X('B', 0.8)):Join(X('E', 5))
    :Append(X('C', 0.4)):Join(X('D', 0.8)):AppendCallback(mark('tail'))`)
  q.at(0.4)
  assert.deepEqual(q.positions('ABCDE'), [100, 50, 0, 0, 0])
  q.at(0.8)
  q.at(1.2)
  assert.deepEqual(q.positions('ABCDE'), [100, 100, 100, 50, 0])
  q.at(1.6)
  assert.deepEqual(q.events(), [['A', 0.4], ['B', 0.8], ['C', 1.2], ['D', 1.6], ['tail', 1.6], ['complete', 1.6]])
})

test('mixed sequence scheduling is retained across loops, Restart, Pause and Complete', (t) => {
  const q = scenario(t, `seq:Append(X('A', 0.4)):Join(X('B', 0.4)):Join(X('C', 5))
    :Insert(0, X('D', 1)):AppendCallback(mark('tail')):InsertCallback(0.8, mark('insert'))
    :SetLoops(2):SetOnStepComplete(mark('step'))`)
  q.at(0.4)
  assert.deepEqual(q.events(), [['A', 0.4], ['B', 0.4], ['tail', 0.4]])
  q.command('pause')
  q.at(0.9)
  assert.deepEqual(q.positions('ACD'), [100, 0, 40])
  q.command('resume')
  q.at(1.3)
  q.at(1.5)
  assert.deepEqual(q.events().slice(-3), [['insert', 1.3], ['D', 1.5], ['step', 1.5]])
  q.at(1.7)
  assert.deepEqual(q.positions('ABCD'), [50, 50, 0, 20])
  q.at(1.9)
  q.at(2.3)
  q.at(2.5)
  assert.deepEqual(q.events().filter(([tag]) => tag === 'tail' || tag === 'step' || tag === 'complete'),
    [['tail', 0.4], ['step', 1.5], ['tail', 1.9], ['step', 2.5], ['complete', 2.5]])
  q.command('restart')
  q.at(2.7)
  assert.deepEqual(q.positions('ABCD'), [50, 50, 0, 20])
  q.command('complete')
  const completed = q.events()
  assert.deepEqual(completed.slice(-7).map(([tag]) => tag), ['A', 'B', 'tail', 'insert', 'D', 'step', 'complete'])
  assert.deepEqual(q.positions('ABCD'), [100, 100, 0, 100])
  q.command('complete')
  q.at(3)
  assert.deepEqual(q.events(), completed)
  assert.equal(q.rt.animations.size, 0)
  q.command('restart')
  q.at(3.2)
  q.command('kill')
  const stopped = q.positions('ABCD')
  const killed = q.events()
  q.at(5)
  assert.deepEqual(q.positions('ABCD'), stopped)
  assert.deepEqual(q.events(), killed)
  assert.equal(q.rt.animations.size, 0)
})
