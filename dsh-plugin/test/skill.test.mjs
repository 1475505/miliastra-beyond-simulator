import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { name, inject, apply, SKILL_NAME, SKILL_DESCRIPTION } from '../lib/skill.js'

test('skill plugin registers the simulator usage skill from the bundled body', () => {
  assert.equal(name, 'qxqy-simulator-skill')
  assert.deepEqual(inject, ['skills'])
  assert.match(SKILL_NAME, /^[a-z0-9]+(-[a-z0-9]+)*$/)
  assert.ok(SKILL_DESCRIPTION.length > 20)

  const registered = []
  apply({ skills: { register(skill) { registered.push(skill) } } })
  assert.equal(registered.length, 1)
  assert.equal(registered[0].name, SKILL_NAME)
  assert.equal(registered[0].source, 'runtime')
  assert.equal(registered[0].description, SKILL_DESCRIPTION)

  const content = registered[0].content
  assert.match(content, /qxqy_studio_get/)
  assert.match(content, /qxqy_studio_patch/)
  assert.match(content, /qxqy_studio_play/)
  assert.match(content, /qxqy_studio_load/)
  assert.match(content, /工作流一：把 UI 转成 JSON/)
  assert.match(content, /工作流二：自定义交互测试队列/)
  assert.match(content, /qxqy-autotest/)
  assert.match(content, /serverSet/)
  assert.match(content, /revision conflict/)
})

test('package ships the skill body and its subpath export', () => {
  const manifest = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'))
  assert.equal(manifest.exports['./skill'], './dsh-plugin/dist/skill.js')
  assert.ok(manifest.files.includes('dsh-plugin/skill.md'))
})
