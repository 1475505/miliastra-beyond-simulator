import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { syncBuiltinESMExports } from 'node:module'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { createStudio } from '../index.js'
import { SimulatorController } from '../host/controller.js'
import { listWorkspaceArchives, resolveWorkspaceFile } from '../host/workspace.js'

function workspaceFor(t) {
  const workspace = fs.mkdtempSync(join(tmpdir(), 'qxqy-workspace-discovery-'))
  t.after(() => fs.rmSync(workspace, { recursive: true, force: true }))
  return workspace
}

function archiveAt(workspace, path, name = path, transform = (archive) => archive) {
  const studio = createStudio()
  studio.patch({ op: 'renameSave', name })
  const absolute = join(workspace, path)
  fs.mkdirSync(dirname(absolute), { recursive: true })
  fs.writeFileSync(absolute, JSON.stringify(transform(studio.archiveData())))
  return absolute
}

function mockBuiltin(t, method, implementation) {
  const mock = t.mock.method(fs, method, implementation)
  syncBuiltinESMExports()
  t.after(() => {
    mock.mock.restore()
    syncBuiltinESMExports()
  })
}

test('discovery finds a valid archive larger than 8 MiB without reading its entire payload', (t) => {
  const workspace = workspaceFor(t)
  archiveAt(workspace, 'large.save.json', 'Large archive', (archive) => {
    archive.assets.scripts.push({ id: 'large-script', guid: 0, path: 'large.lua', source: `--${'x'.repeat(8 * 1024 * 1024)}`, controlId: '', controlAsset: '' })
    return archive
  })
  const originalRead = fs.readSync
  let bytesRead = 0
  mockBuiltin(t, 'readSync', (...args) => {
    const read = originalRead(...args)
    bytesRead += read
    return read
  })
  const result = listWorkspaceArchives(workspace)
  assert.equal(result.archives.length, 1)
  assert.equal(result.archives[0].path, 'large.save.json')
  assert.equal(result.archives[0].name, 'Large archive')
  assert.ok(result.archives[0].bytes > 8 * 1024 * 1024)
  assert.equal(bytesRead, 4096)
  assert.equal(result.discovery.truncated, false)
  assert.deepEqual(result.discovery.warnings, [])
  const controller = new SimulatorController(workspace)
  controller.loadArchive('large.save.json')
  assert.equal(controller.get().save.name, 'Large archive')
})

test('discovery keeps the latest 50 archives after scanning every candidate within its budget', (t) => {
  const workspace = workspaceFor(t)
  for (let index = 0; index < 60; index += 1) {
    const path = archiveAt(workspace, `${String(index).padStart(2, '0')}.save.json`)
    const modified = new Date(Date.UTC(2026, 0, 1) + index * 1000)
    fs.utimesSync(path, modified, modified)
  }
  const { archives, discovery } = listWorkspaceArchives(workspace)
  assert.equal(archives.length, 50)
  assert.deepEqual(archives.map((archive) => archive.path), Array.from({ length: 50 }, (_, index) => `${59 - index}.save.json`))
  assert.equal(discovery.matchedArchives, 60)
  assert.equal(discovery.scannedJsonFiles, 60)
  assert.equal(discovery.truncated, true)
  assert.match(discovery.warnings.join('\n'), /60.*50/)
})

test('excluded and deep archives remain accessible by an explicit workspace path', (t) => {
  const workspace = workspaceFor(t)
  const deepPath = `${Array.from({ length: 9 }, (_, i) => `level-${i}`).join('/')}/deep.save.json`
  const paths = ['.hidden/hidden.save.json', 'dist/generated.save.json', deepPath]
  for (const path of paths) archiveAt(workspace, path, path)
  const { archives, discovery } = listWorkspaceArchives(workspace)
  assert.deepEqual(archives, [])
  assert.equal(discovery.skippedDirectories, 2)
  assert.equal(discovery.depthLimitedDirectories, 1)
  assert.equal(discovery.truncated, true)
  assert.equal(discovery.warnings.length, 2)
  assert.equal(discovery.policy.hiddenEntries, false)
  for (const path of paths) {
    assert.equal(resolveWorkspaceFile(workspace, path), fs.realpathSync(join(workspace, path)))
    const controller = new SimulatorController(workspace)
    controller.loadArchive(path)
    assert.equal(controller.get().save.name, path)
  }
})

test('header discovery keeps malformed candidates visible and leaves JSON validation to opening', (t) => {
  const workspace = workspaceFor(t)
  fs.writeFileSync(join(workspace, 'broken.save.json'), '{"format":"qxqy-simulator-save","name":"bad\\q",')
  fs.writeFileSync(join(workspace, 'unrelated.json'), '{broken ordinary json')
  const { archives, discovery } = listWorkspaceArchives(workspace)
  assert.equal(archives.length, 1)
  assert.equal(archives[0].path, 'broken.save.json')
  assert.equal(archives[0].name, 'broken.save')
  assert.equal(discovery.unreadableEntries, 0)
  assert.equal(discovery.policy.validatesJson, false)
  assert.throws(() => new SimulatorController(workspace).loadArchive('broken.save.json'), /JSON|escape|Unexpected|position/i)
})

test('unreadable archives and directories produce one aggregated diagnostic', (t) => {
  const workspace = workspaceFor(t)
  const blockedFile = archiveAt(workspace, 'denied.save.json')
  const readableFile = archiveAt(workspace, 'readable.save.json')
  const blockedDirectory = join(workspace, 'denied-directory')
  fs.mkdirSync(blockedDirectory)
  const originalOpen = fs.openSync
  const originalOpenDir = fs.opendirSync
  mockBuiltin(t, 'openSync', (...args) => {
    if (args[0] === blockedFile) throw Object.assign(new Error('access denied'), { code: 'EACCES' })
    return originalOpen(...args)
  })
  mockBuiltin(t, 'opendirSync', (...args) => {
    if (args[0] === blockedDirectory) throw Object.assign(new Error('access denied'), { code: 'EACCES' })
    return originalOpenDir(...args)
  })
  const { archives, discovery } = listWorkspaceArchives(workspace)
  assert.deepEqual(archives.map((archive) => archive.path), ['readable.save.json'])
  assert.equal(discovery.unreadableEntries, 2)
  assert.equal(discovery.warnings.length, 1)
  assert.match(discovery.warnings[0], /无法读取 2/)
  assert.equal(resolveWorkspaceFile(workspace, 'readable.save.json'), fs.realpathSync(readableFile))
})

test('discovery stops streaming entries at its budget and reports an incomplete list', (t) => {
  const workspace = workspaceFor(t)
  let reads = 0
  let closed = false
  mockBuiltin(t, 'opendirSync', () => ({
    readSync() {
      reads += 1
      return { name: `${reads}.txt`, isDirectory: () => false, isFile: () => true }
    },
    closeSync() { closed = true },
  }))
  const { archives, discovery } = listWorkspaceArchives(workspace)
  assert.deepEqual(archives, [])
  assert.equal(discovery.scannedEntries, discovery.limits.entries)
  assert.equal(reads, discovery.limits.entries + 1)
  assert.equal(closed, true)
  assert.equal(discovery.entryLimitReached, true)
  assert.equal(discovery.truncated, true)
  assert.match(discovery.warnings.join('\n'), /扫描上限/)
})
