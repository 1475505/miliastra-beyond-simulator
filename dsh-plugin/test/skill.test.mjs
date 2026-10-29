import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { name, inject, apply, SKILL_NAME, SKILL_DESCRIPTION } from '../lib/skill.js'

test('skill plugin registers the simulator usage skill from the bundled body', () => {
  assert.equal(name, 'qxqy-simulator-skill')
  assert.deepEqual(inject, ['skills'])

  const registered = []
  apply({ skills: { register(skill) { registered.push(skill) } } })
  assert.equal(registered.length, 1)
  assert.equal(registered[0].name, SKILL_NAME)
  assert.equal(registered[0].source, 'runtime')
  assert.equal(registered[0].description, SKILL_DESCRIPTION)

  assert.equal(registered[0].content, readFileSync(new URL('../../skill/SKILL.md', import.meta.url), 'utf8'))
})

test('package ships the skill body and its subpath export', () => {
  const manifest = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'))
  assert.equal(manifest.exports['./skill'], './dsh-plugin/dist/skill.js')
  assert.ok(manifest.files.includes('dsh-plugin/skill.md'))
})
