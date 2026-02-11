import {describe, it, afterEach, beforeEach} from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp, rm, mkdir} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {validateDirSettings} from '../../../src/cli/utils/settingsValidation.ts'
import {createLoggedFs} from '../../../src/cli/utils/createLoggedFs.ts'
import type {PrefixLog} from '../../../src/cli/utils/prefixLog.ts'

const noop = () => {}
const mockLog: PrefixLog = {
  info: noop,
  warn: noop,
  error: noop,
  verbose: noop,
  exec: noop,
  http: noop,
  fs: noop,
  prefix: () => mockLog,
}

function mockFs() {
  return createLoggedFs(mockLog, process.cwd())
}

describe('validateDirSettings', () => {
  let originalCwd: string
  const createdDirs: string[] = []

  beforeEach(() => {
    originalCwd = process.cwd()
  })

  afterEach(async () => {
    process.chdir(originalCwd)
    await Promise.all(
      createdDirs.splice(0).map(async dir => {
        await rm(dir, {recursive: true, force: true})
      }),
    )
  })

  async function makeTmpDir(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'validate-settings-test-'))
    createdDirs.push(dir)
    return dir
  }

  it('does not throw when template dir exists and template_path is set', async () => {
    const dir = await makeTmpDir()
    process.chdir(dir)
    await mkdir(join(dir, 'template'))

    await validateDirSettings({path: '/main', template_path: '/tmpl'}, 'wondoc', mockFs())
    // Should not throw
  })

  it('throws when template dir exists but template_path is not set', async () => {
    const dir = await makeTmpDir()
    process.chdir(dir)
    await mkdir(join(dir, 'template'))

    await assert.rejects(
      () => validateDirSettings({path: '/main'}, 'wondoc', mockFs()),
      /Template directory exists but template_path is not set/,
    )
  })

  it('does not throw when slot dir exists and slot_path is set', async () => {
    const dir = await makeTmpDir()
    process.chdir(dir)
    await mkdir(join(dir, 'slot'))

    await validateDirSettings({path: '/main', slot_path: '/myslot'}, 'wondoc', mockFs())
    // Should not throw
  })

  it('throws when slot dir exists but slot_path is not set', async () => {
    const dir = await makeTmpDir()
    process.chdir(dir)
    await mkdir(join(dir, 'slot'))

    await assert.rejects(
      () => validateDirSettings({path: '/main'}, 'wondoc', mockFs()),
      /Slot directory exists but slot_path is not set/,
    )
  })

  it('does not throw when neither template nor slot dirs exist', async () => {
    const dir = await makeTmpDir()
    process.chdir(dir)

    await validateDirSettings({path: '/main'}, 'wondoc', mockFs())
    // Should not throw
  })
})
