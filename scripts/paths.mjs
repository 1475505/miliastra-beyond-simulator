import { fileURLToPath } from 'node:url'
import { resolve, relative, isAbsolute } from 'node:path'
import { rm } from 'node:fs/promises'

export const root = fileURLToPath(new URL('../', import.meta.url))
export const products = ['dsh-plugin', 'mcp', 'web']

// All recursive cleanup is confined to a known generated directory.
export async function cleanGenerated(path, boundary) {
  const target = resolve(path)
  const parent = resolve(boundary)
  const rel = relative(parent, target)
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) throw new Error(`Refusing to remove ${target}`)
  await rm(target, { recursive: true, force: true })
}
