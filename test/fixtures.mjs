import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// Original device samples and game projects are optional, never synthesized.
export const externalRoot = resolve(process.env.QXQY_FIXTURE_ROOT || fileURLToPath(new URL('../../', import.meta.url)))
export const externalFixture = path => resolve(externalRoot, path)
export const missingFixture = path => existsSync(externalFixture(path)) ? false : `Missing external fixture: ${path}; set QXQY_FIXTURE_ROOT to run this test`
