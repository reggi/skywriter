import {describe, it, afterEach, beforeEach} from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp, rm, writeFile, mkdir, readFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {validatePathSettings} from '../../../src/cli/pathOperations/validatePathSettings.ts'
import {readSettings} from '../../../src/cli/utils/pageContext.ts'
import type {PathContext, Settings} from '../../../src/cli/utils/pageContext.ts'
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

function buildRootCtx(dir: string, settings: Settings): PathContext {
  return {
    reference: 'main',
    path: settings.path || '',
    normalizedPath: (settings.path || '').replace(/^\//, ''),
    serverUrl: '',
    auth: '',
    settings,
    dir: '.',
    absoluteDir: dir,
    log: mockLog,
    forbiddenPaths: [],
  }
}

describe('validatePathSettings', () => {
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
    const dir = await mkdtemp(join(tmpdir(), 'validate-path-settings-test-'))
    createdDirs.push(dir)
    return dir
  }

  it('returns issue when settings.json has no path', async () => {
    const dir = await makeTmpDir()
    process.chdir(dir)
    await writeFile(join(dir, 'settings.json'), JSON.stringify({title: 'No path'}))

    const settings = (await readSettings())!
    const issues = await validatePathSettings(buildRootCtx(dir, settings))
    assert.equal(issues.length, 1)
    assert.ok(issues[0].message.includes('missing the "path" field'))
  })

  it('returns no issues for valid settings', async () => {
    const dir = await makeTmpDir()
    process.chdir(dir)
    await writeFile(join(dir, 'settings.json'), JSON.stringify({path: '/test'}))

    const settings = (await readSettings())!
    const issues = await validatePathSettings(buildRootCtx(dir, settings))
    assert.equal(issues.length, 0)
  })

  it('detects template dir without template_path in settings', async () => {
    const dir = await makeTmpDir()
    process.chdir(dir)
    await writeFile(join(dir, 'settings.json'), JSON.stringify({path: '/test'}))
    await mkdir(join(dir, 'template'))

    const settings = (await readSettings())!
    const issues = await validatePathSettings(buildRootCtx(dir, settings))
    assert.ok(issues.length > 0)
    assert.ok(issues.some(i => i.message.includes('template_path is not set')))
    assert.ok(issues.some(i => i.apply))
  })

  it('detects slot dir without slot_path in settings', async () => {
    const dir = await makeTmpDir()
    process.chdir(dir)
    await writeFile(join(dir, 'settings.json'), JSON.stringify({path: '/test'}))
    await mkdir(join(dir, 'slot'))

    const settings = (await readSettings())!
    const issues = await validatePathSettings(buildRootCtx(dir, settings))
    assert.ok(issues.length > 0)
    assert.ok(issues.some(i => i.message.includes('slot_path is not set')))
    assert.ok(issues.some(i => i.apply))
  })

  it('detects template_path mismatch with template/settings.json', async () => {
    const dir = await makeTmpDir()
    process.chdir(dir)
    await writeFile(join(dir, 'settings.json'), JSON.stringify({path: '/test', template_path: '/old-tmpl'}))
    await mkdir(join(dir, 'template'))
    await writeFile(join(dir, 'template', 'settings.json'), JSON.stringify({path: '/new-tmpl'}))

    const settings = (await readSettings())!
    const issues = await validatePathSettings(buildRootCtx(dir, settings))
    assert.ok(issues.some(i => i.message.includes('template_path') && i.message.includes('differs')))
  })

  it('detects slot_path mismatch with slot/settings.json', async () => {
    const dir = await makeTmpDir()
    process.chdir(dir)
    await writeFile(join(dir, 'settings.json'), JSON.stringify({path: '/test', slot_path: '/old-slot'}))
    await mkdir(join(dir, 'slot'))
    await writeFile(join(dir, 'slot', 'settings.json'), JSON.stringify({path: '/new-slot'}))

    const settings = (await readSettings())!
    const issues = await validatePathSettings(buildRootCtx(dir, settings))
    assert.ok(issues.some(i => i.message.includes('slot_path') && i.message.includes('differs')))
  })

  it('detects out-of-sync uploads in main directory', async () => {
    const dir = await makeTmpDir()
    process.chdir(dir)
    await writeFile(join(dir, 'settings.json'), JSON.stringify({path: '/test', uploads: ['old.png']}))
    await mkdir(join(dir, 'uploads'))
    await writeFile(join(dir, 'uploads', 'new.png'), 'data')

    const settings = (await readSettings())!
    const issues = await validatePathSettings(buildRootCtx(dir, settings))
    assert.ok(issues.some(i => i.message.includes('uploads out of sync')))
  })

  it('detects out-of-sync uploads in template directory', async () => {
    const dir = await makeTmpDir()
    process.chdir(dir)
    await writeFile(join(dir, 'settings.json'), JSON.stringify({path: '/test', template_path: '/tmpl'}))
    await mkdir(join(dir, 'template'))
    await writeFile(join(dir, 'template', 'settings.json'), JSON.stringify({path: '/tmpl', uploads: []}))
    await mkdir(join(dir, 'template', 'uploads'))
    await writeFile(join(dir, 'template', 'uploads', 'img.png'), 'data')

    const settings = (await readSettings())!
    const issues = await validatePathSettings(buildRootCtx(dir, settings))
    assert.ok(issues.some(i => i.message.includes('uploads out of sync')))
  })

  it('fix for template_path sets it in settings.json', async () => {
    const dir = await makeTmpDir()
    process.chdir(dir)
    await writeFile(join(dir, 'settings.json'), JSON.stringify({path: '/test'}))
    await mkdir(join(dir, 'template'))
    await writeFile(join(dir, 'template', 'settings.json'), JSON.stringify({path: '/my-template'}))

    const settings = (await readSettings())!
    const issues = await validatePathSettings(buildRootCtx(dir, settings))
    const templateFix = issues.find(i => i.message.includes('template_path is not set'))
    assert.ok(templateFix?.apply)

    await templateFix!.apply!()

    const updated = JSON.parse(await readFile(join(dir, 'settings.json'), 'utf-8'))
    assert.equal(updated.template_path, '/my-template')
  })

  it('fix for slot_path sets it in settings.json', async () => {
    const dir = await makeTmpDir()
    process.chdir(dir)
    await writeFile(join(dir, 'settings.json'), JSON.stringify({path: '/test'}))
    await mkdir(join(dir, 'slot'))
    await writeFile(join(dir, 'slot', 'settings.json'), JSON.stringify({path: '/my-slot'}))

    const settings = (await readSettings())!
    const issues = await validatePathSettings(buildRootCtx(dir, settings))
    const slotFix = issues.find(i => i.message.includes('slot_path is not set'))
    assert.ok(slotFix?.apply)

    await slotFix!.apply!()

    const updated = JSON.parse(await readFile(join(dir, 'settings.json'), 'utf-8'))
    assert.equal(updated.slot_path, '/my-slot')
  })

  it('fix for uploads sync updates settings.json uploads array', async () => {
    const dir = await makeTmpDir()
    process.chdir(dir)
    await writeFile(join(dir, 'settings.json'), JSON.stringify({path: '/test', uploads: ['old.png']}))
    await mkdir(join(dir, 'uploads'))
    await writeFile(join(dir, 'uploads', 'new.png'), 'data')

    const settings = (await readSettings())!
    const issues = await validatePathSettings(buildRootCtx(dir, settings))
    const uploadFix = issues.find(i => i.message.includes('uploads out of sync'))
    assert.ok(uploadFix?.apply)

    await uploadFix!.apply!()

    const updated = JSON.parse(await readFile(join(dir, 'settings.json'), 'utf-8'))
    assert.deepEqual(updated.uploads, ['new.png'])
  })

  it('fix for template_path mismatch updates to correct path', async () => {
    const dir = await makeTmpDir()
    process.chdir(dir)
    await writeFile(join(dir, 'settings.json'), JSON.stringify({path: '/test', template_path: '/wrong'}))
    await mkdir(join(dir, 'template'))
    await writeFile(join(dir, 'template', 'settings.json'), JSON.stringify({path: '/correct'}))

    const settings = (await readSettings())!
    const issues = await validatePathSettings(buildRootCtx(dir, settings))
    const mismatchFix = issues.find(i => i.message.includes('differs'))
    assert.ok(mismatchFix?.apply)

    await mismatchFix!.apply!()

    const updated = JSON.parse(await readFile(join(dir, 'settings.json'), 'utf-8'))
    assert.equal(updated.template_path, '/correct')
  })

  it('uses default template_path when template/settings.json has no path', async () => {
    const dir = await makeTmpDir()
    process.chdir(dir)
    await writeFile(join(dir, 'settings.json'), JSON.stringify({path: '/test'}))
    await mkdir(join(dir, 'template'))
    // No settings.json in template dir

    const settings = (await readSettings())!
    const issues = await validatePathSettings(buildRootCtx(dir, settings))
    const templateFix = issues.find(i => i.message.includes('template_path is not set'))
    assert.ok(templateFix)
    // Default should be path + "/template"
    assert.ok(templateFix!.fix!.includes('/test/template'))
  })

  it('uses default slot_path when slot/settings.json has no path', async () => {
    const dir = await makeTmpDir()
    process.chdir(dir)
    await writeFile(join(dir, 'settings.json'), JSON.stringify({path: '/test'}))
    await mkdir(join(dir, 'slot'))
    // No settings.json in slot dir

    const settings = (await readSettings())!
    const issues = await validatePathSettings(buildRootCtx(dir, settings))
    const slotFix = issues.find(i => i.message.includes('slot_path is not set'))
    assert.ok(slotFix)
    assert.ok(slotFix!.fix!.includes('/test/slot'))
  })

  it('detects out-of-sync uploads in slot directory', async () => {
    const dir = await makeTmpDir()
    process.chdir(dir)
    await writeFile(join(dir, 'settings.json'), JSON.stringify({path: '/test', slot_path: '/myslot'}))
    await mkdir(join(dir, 'slot'))
    await writeFile(join(dir, 'slot', 'settings.json'), JSON.stringify({path: '/myslot', uploads: []}))
    await mkdir(join(dir, 'slot', 'uploads'))
    await writeFile(join(dir, 'slot', 'uploads', 'img.png'), 'data')

    const settings = (await readSettings())!
    const issues = await validatePathSettings(buildRootCtx(dir, settings))
    assert.ok(issues.some(i => i.message.includes('uploads out of sync')))
  })

  it('skips hidden files in uploads directory', async () => {
    const dir = await makeTmpDir()
    process.chdir(dir)
    await writeFile(join(dir, 'settings.json'), JSON.stringify({path: '/test', uploads: []}))
    await mkdir(join(dir, 'uploads'))
    await writeFile(join(dir, 'uploads', '.DS_Store'), '')

    const settings = (await readSettings())!
    const issues = await validatePathSettings(buildRootCtx(dir, settings))
    // .DS_Store should be ignored, so no sync issue
    assert.ok(!issues.some(i => i.message.includes('uploads out of sync')))
  })

  // --- New tests for fractal validation and forbidden path checks ---

  it('creates settings.json for template when missing', async () => {
    const dir = await makeTmpDir()
    process.chdir(dir)
    await writeFile(join(dir, 'settings.json'), JSON.stringify({path: '/test'}))
    await mkdir(join(dir, 'template'))

    const settings = (await readSettings())!
    const issues = await validatePathSettings(buildRootCtx(dir, settings))
    const createFix = issues.find(i => i.message.includes('template/settings.json is missing'))
    assert.ok(createFix)
    assert.ok(createFix!.apply)
    assert.ok(createFix!.fix!.includes('/test/template'))
  })

  it('creates settings.json for slot when missing', async () => {
    const dir = await makeTmpDir()
    process.chdir(dir)
    await writeFile(join(dir, 'settings.json'), JSON.stringify({path: '/test'}))
    await mkdir(join(dir, 'slot'))

    const settings = (await readSettings())!
    const issues = await validatePathSettings(buildRootCtx(dir, settings))
    const createFix = issues.find(i => i.message.includes('slot/settings.json is missing'))
    assert.ok(createFix)
    assert.ok(createFix!.apply)
    assert.ok(createFix!.fix!.includes('/test/slot'))
  })

  it('detects path collision between template and parent', async () => {
    const dir = await makeTmpDir()
    process.chdir(dir)
    await writeFile(join(dir, 'settings.json'), JSON.stringify({path: '/test', template_path: '/test'}))
    await mkdir(join(dir, 'template'))
    // Template uses same path as parent
    await writeFile(join(dir, 'template', 'settings.json'), JSON.stringify({path: '/test'}))

    const settings = (await readSettings())!
    const issues = await validatePathSettings(buildRootCtx(dir, settings))
    assert.ok(issues.some(i => i.message.includes('collides with a parent or sibling path')))
  })

  it('detects path collision between slot and parent', async () => {
    const dir = await makeTmpDir()
    process.chdir(dir)
    await writeFile(join(dir, 'settings.json'), JSON.stringify({path: '/test', slot_path: '/test'}))
    await mkdir(join(dir, 'slot'))
    // Slot uses same path as parent
    await writeFile(join(dir, 'slot', 'settings.json'), JSON.stringify({path: '/test'}))

    const settings = (await readSettings())!
    const issues = await validatePathSettings(buildRootCtx(dir, settings))
    assert.ok(issues.some(i => i.message.includes('collides with a parent or sibling path')))
  })

  it('detects path collision between template and slot sibling', async () => {
    const dir = await makeTmpDir()
    process.chdir(dir)
    await writeFile(
      join(dir, 'settings.json'),
      JSON.stringify({
        path: '/test',
        template_path: '/shared',
        slot_path: '/shared',
      }),
    )
    await mkdir(join(dir, 'template'))
    await writeFile(join(dir, 'template', 'settings.json'), JSON.stringify({path: '/shared'}))
    await mkdir(join(dir, 'slot'))
    await writeFile(join(dir, 'slot', 'settings.json'), JSON.stringify({path: '/shared'}))

    const settings = (await readSettings())!
    const issues = await validatePathSettings(buildRootCtx(dir, settings))
    // Both should be flagged as collisions (with each other as siblings)
    const collisions = issues.filter(i => i.message.includes('collides with a parent or sibling path'))
    assert.ok(collisions.length >= 1)
  })

  it('fractally validates nested template settings', async () => {
    const dir = await makeTmpDir()
    process.chdir(dir)
    await writeFile(join(dir, 'settings.json'), JSON.stringify({path: '/test', template_path: '/tmpl'}))
    await mkdir(join(dir, 'template'))
    await writeFile(join(dir, 'template', 'settings.json'), JSON.stringify({path: '/tmpl'}))
    // Template has its own template dir
    await mkdir(join(dir, 'template', 'template'))

    const settings = (await readSettings())!
    const issues = await validatePathSettings(buildRootCtx(dir, settings))
    // Should detect that template's template dir exists but template_path not set
    assert.ok(issues.some(i => i.message.includes('template_path is not set') && i.message.includes('template/')))
  })

  it('apply fix creates template/settings.json on disk', async () => {
    const dir = await makeTmpDir()
    process.chdir(dir)
    await writeFile(join(dir, 'settings.json'), JSON.stringify({path: '/test', template_path: '/tmpl'}))
    await mkdir(join(dir, 'template'))

    const settings = (await readSettings())!
    const issues = await validatePathSettings(buildRootCtx(dir, settings))
    const createFix = issues.find(i => i.message.includes('template/settings.json is missing'))
    assert.ok(createFix?.apply)

    await createFix!.apply!()

    const created = JSON.parse(await readFile(join(dir, 'template', 'settings.json'), 'utf-8'))
    assert.equal(created.path, '/tmpl')
  })
})
