import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRuntime } from '../src/index.js'

for (const kind of ['textbox', 'textwindow']) {
  for (const field of ['fontSize', 'minimumFontSize']) {
    test(`${kind}.${field} rejects fractional/non-number values before assignment`, () => {
      const rt = createRuntime()
      try {
        const control = rt.addRoot({ active: true, name: 'Text', kind })
        rt.mountScript({
          path: 'font-validation', control,
          source: `function OnStart()
            local c = script.object
            c.${field} = 24
            local function reject(value, valueType)
              local ok, err = pcall(function() c.${field} = value end)
              assert(not ok, 'invalid font size accepted')
              assert(string.find(tostring(err), "integer expected, got " .. valueType, 1, true))
              assert(c.${field} == 24, 'rejected assignment changed the field')
            end
            reject(38 * .62, 'number')
            reject(0 / 0, 'number')
            reject(math.huge, 'number')
            reject(-math.huge, 'number')
            reject('24', 'string')
            reject(true, 'boolean')
            reject(nil, 'nil')
            c.${field} = math.floor(38 * .62 + .5)
            assert(c.${field} == 24)
            -- Integer-valued floats remain accepted as a simulator policy;
            -- the device report only establishes rejection of fractional values.
            c.${field} = 20.0
            assert(c.${field} == 20)
            c:SetSizeDelta(38.5, 40.25)
            local w, h = c:GetSizeDelta()
            assert(w == 38.5 and h == 40.25)
          end`,
        })
        assert.deepEqual(rt.mountErrors, [])
        assert.equal(control[field], 20)
      } finally { rt.destroy() }
    })
  }
}

test('font size validation preserves unsupported-field errors', () => {
  const rt = createRuntime()
  try {
    const control = rt.addRoot({ active: true, name: 'Image', kind: 'image' })
    rt.mountScript({ path: 'unsupported-font', control, source: `function OnStart()
      local ok, err = pcall(function() script.object.fontSize = 23.56 end)
      assert(not ok and string.find(tostring(err), 'cannot set fontSize, no such field', 1, true))
    end` })
    assert.deepEqual(rt.mountErrors, [])
  } finally { rt.destroy() }
})
