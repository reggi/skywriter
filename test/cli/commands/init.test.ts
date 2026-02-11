import {describe, it, afterEach, beforeEach} from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp, rm, writeFile, access, mkdir, readFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {init} from '../../../src/cli/commands/init.ts'
import {createMockCliContext} from '../test-context.ts'
import {stripAnsi} from '../../helpers/stripAnsi.ts'

// Capture proc-log output
let consoleOutput: string[] = []
const logHandler = (...args: unknown[]) => {
  const messageParts = args.slice(1)
  consoleOutput.push(messageParts.map(String).join(' '))
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

describe('cli init', () => {
  const createdDirs: string[] = []

  beforeEach(() => {
    consoleOutput = []
    process.on('log', logHandler)
  })

  afterEach(async () => {
    process.removeListener('log', logHandler)
    await Promise.all(
      createdDirs.splice(0).map(async dir => {
        await rm(dir, {recursive: true, force: true})
      }),
    )
  })

  it('wondoc init /root --template --slot', async t => {
    const dir = await mkdtemp(join(tmpdir(), 'wondoc-init-'))
    createdDirs.push(dir)

    await init(createMockCliContext({cwd: dir}), {path: '/root', template: true, slot: true})

    // Root
    assert.equal(await pathExists(join(dir, 'settings.json')), true)
    assert.equal(await pathExists(join(dir, 'content.eta')), true)
    assert.equal(await pathExists(join(dir, 'style.css')), true)
    assert.equal(await pathExists(join(dir, 'server.js')), true)
    assert.equal(await pathExists(join(dir, 'script.js')), true)

    // Template
    assert.equal(await pathExists(join(dir, 'template', 'settings.json')), true)
    assert.equal(await pathExists(join(dir, 'template', 'content.eta')), true)

    const templateSettings = JSON.parse(await readFile(join(dir, 'template', 'settings.json'), 'utf-8'))
    assert.equal(templateSettings.path, '/root-template')

    // Slot
    assert.equal(await pathExists(join(dir, 'slot', 'settings.json')), true)
    assert.equal(await pathExists(join(dir, 'slot', 'content.eta')), true)

    const slotSettings = JSON.parse(await readFile(join(dir, 'slot', 'settings.json'), 'utf-8'))
    assert.equal(slotSettings.path, '/root-slot')

    // Root settings should have template_path and slot_path
    const rootSettings = JSON.parse(await readFile(join(dir, 'settings.json'), 'utf-8'))
    assert.equal(rootSettings.template_path, '/root-template')
    assert.equal(rootSettings.slot_path, '/root-slot')
    t.assert.snapshot(consoleOutput.map(stripAnsi))
  })

  it('wondoc init foo --slot=bar --template=baz', async t => {
    const dir = await mkdtemp(join(tmpdir(), 'wondoc-init-'))
    createdDirs.push(dir)

    await init(createMockCliContext({cwd: dir}), {path: 'foo', template: 'baz', slot: 'bar'})

    // Root
    assert.equal(await pathExists(join(dir, 'settings.json')), true)
    assert.equal(await pathExists(join(dir, 'content.eta')), true)
    assert.equal(await pathExists(join(dir, 'style.css')), true)
    assert.equal(await pathExists(join(dir, 'server.js')), true)
    assert.equal(await pathExists(join(dir, 'script.js')), true)

    const rootSettings = JSON.parse(await readFile(join(dir, 'settings.json'), 'utf-8'))
    assert.equal(rootSettings.path, '/foo')
    assert.equal(rootSettings.template_path, '/baz')
    assert.equal(rootSettings.slot_path, '/bar')

    // Template
    assert.equal(await pathExists(join(dir, 'template', 'settings.json')), true)
    assert.equal(await pathExists(join(dir, 'template', 'content.eta')), true)

    const templateSettings = JSON.parse(await readFile(join(dir, 'template', 'settings.json'), 'utf-8'))
    assert.equal(templateSettings.path, '/baz')

    // Slot
    assert.equal(await pathExists(join(dir, 'slot', 'settings.json')), true)
    assert.equal(await pathExists(join(dir, 'slot', 'content.eta')), true)

    const slotSettings = JSON.parse(await readFile(join(dir, 'slot', 'settings.json'), 'utf-8'))
    assert.equal(slotSettings.path, '/bar')

    t.assert.snapshot(consoleOutput.map(stripAnsi))
  })

  it('wondoc init --template', async t => {
    const dir = await mkdtemp(join(tmpdir(), 'wondoc-init-'))
    createdDirs.push(dir)

    await writeFile(
      join(dir, 'settings.json'),
      JSON.stringify({path: '/existing', draft: true}, null, 2) + '\n',
      'utf-8',
    )

    await init(createMockCliContext({cwd: dir}), {template: true})

    // Should not overwrite root content files
    assert.equal(await pathExists(join(dir, 'content.eta')), false)

    assert.equal(await pathExists(join(dir, 'template', 'settings.json')), true)
    assert.equal(await pathExists(join(dir, 'template', 'content.eta')), true)

    // Template path derived from root: /existing-template
    const templateSettings = JSON.parse(await readFile(join(dir, 'template', 'settings.json'), 'utf-8'))
    assert.equal(templateSettings.path, '/existing-template')

    // Parent settings.json should have template_path added
    const parentSettings = JSON.parse(await readFile(join(dir, 'settings.json'), 'utf-8'))
    assert.equal(parentSettings.path, '/existing')
    assert.equal(parentSettings.template_path, '/existing-template')
    t.assert.snapshot(consoleOutput.map(stripAnsi))
  })

  it('wondoc init --slot', async t => {
    const dir = await mkdtemp(join(tmpdir(), 'wondoc-init-'))
    createdDirs.push(dir)

    await writeFile(
      join(dir, 'settings.json'),
      JSON.stringify({path: '/existing', draft: true}, null, 2) + '\n',
      'utf-8',
    )

    await init(createMockCliContext({cwd: dir}), {slot: true})

    // Should not overwrite root content files
    assert.equal(await pathExists(join(dir, 'content.eta')), false)

    assert.equal(await pathExists(join(dir, 'slot', 'settings.json')), true)
    assert.equal(await pathExists(join(dir, 'slot', 'content.eta')), true)

    // Slot path derived from root: /existing-slot
    const slotSettings = JSON.parse(await readFile(join(dir, 'slot', 'settings.json'), 'utf-8'))
    assert.equal(slotSettings.path, '/existing-slot')

    // Parent settings.json should have slot_path added
    const parentSettings = JSON.parse(await readFile(join(dir, 'settings.json'), 'utf-8'))
    assert.equal(parentSettings.path, '/existing')
    assert.equal(parentSettings.slot_path, '/existing-slot')
    t.assert.snapshot(consoleOutput.map(stripAnsi))
  })

  it('wondoc init --slot=meow', async t => {
    const dir = await mkdtemp(join(tmpdir(), 'wondoc-init-'))
    createdDirs.push(dir)

    await writeFile(
      join(dir, 'settings.json'),
      JSON.stringify({path: '/existing', draft: true}, null, 2) + '\n',
      'utf-8',
    )

    await init(createMockCliContext({cwd: dir}), {slot: 'meow'})

    assert.equal(await pathExists(join(dir, 'slot', 'settings.json')), true)
    assert.equal(await pathExists(join(dir, 'slot', 'content.eta')), true)

    // Slot settings.json should use explicit name
    const slotSettings = JSON.parse(await readFile(join(dir, 'slot', 'settings.json'), 'utf-8'))
    assert.equal(slotSettings.path, '/meow')

    // Parent settings.json should have slot_path added
    const parentSettings = JSON.parse(await readFile(join(dir, 'settings.json'), 'utf-8'))
    assert.equal(parentSettings.path, '/existing')
    assert.equal(parentSettings.slot_path, '/meow')
    t.assert.snapshot(consoleOutput.map(stripAnsi))
  })

  it('wondoc init --template --slot (non-empty)', async t => {
    const dir = await mkdtemp(join(tmpdir(), 'wondoc-init-'))
    createdDirs.push(dir)

    await writeFile(join(dir, 'settings.json'), JSON.stringify({path: '/existing'}, null, 2) + '\n', 'utf-8')

    await init(createMockCliContext({cwd: dir}), {template: true, slot: true})

    // Template
    assert.equal(await pathExists(join(dir, 'template', 'settings.json')), true)
    const templateSettings = JSON.parse(await readFile(join(dir, 'template', 'settings.json'), 'utf-8'))
    assert.equal(templateSettings.path, '/existing-template')

    // Slot
    assert.equal(await pathExists(join(dir, 'slot', 'settings.json')), true)
    const slotSettings = JSON.parse(await readFile(join(dir, 'slot', 'settings.json'), 'utf-8'))
    assert.equal(slotSettings.path, '/existing-slot')

    // Parent settings updated
    const parentSettings = JSON.parse(await readFile(join(dir, 'settings.json'), 'utf-8'))
    assert.equal(parentSettings.template_path, '/existing-template')
    assert.equal(parentSettings.slot_path, '/existing-slot')
    t.assert.snapshot(consoleOutput.map(stripAnsi))
  })

  it('wondoc init /root (non-empty, errors)', async t => {
    const dir = await mkdtemp(join(tmpdir(), 'wondoc-init-'))
    createdDirs.push(dir)

    await writeFile(join(dir, 'existing.txt'), 'keep me', 'utf-8')

    let error: string | undefined
    try {
      await init(createMockCliContext({cwd: dir}), {path: '/root'})
      assert.fail('Expected error')
    } catch (err) {
      error = (err as Error).message
    }
    t.assert.snapshot([...consoleOutput.map(stripAnsi), error])
  })

  it('wondoc init --template (template/ not empty, errors)', async t => {
    const dir = await mkdtemp(join(tmpdir(), 'wondoc-init-'))
    createdDirs.push(dir)

    await writeFile(join(dir, 'settings.json'), JSON.stringify({path: '/existing'}, null, 2) + '\n', 'utf-8')

    const templateDir = join(dir, 'template')
    await mkdir(templateDir, {recursive: true})
    await writeFile(join(templateDir, 'some-file.txt'), 'nope', 'utf-8')

    let error: string | undefined
    try {
      await init(createMockCliContext({cwd: dir}), {template: true})
      assert.fail('Expected error')
    } catch (err) {
      error = (err as Error).message
    }
    t.assert.snapshot([...consoleOutput.map(stripAnsi), error])
  })

  it('wondoc init --slot=existing (collides with root, errors)', async t => {
    const dir = await mkdtemp(join(tmpdir(), 'wondoc-init-'))
    createdDirs.push(dir)

    await writeFile(join(dir, 'settings.json'), JSON.stringify({path: '/existing'}, null, 2) + '\n', 'utf-8')

    let error: string | undefined
    try {
      await init(createMockCliContext({cwd: dir}), {slot: 'existing'})
      assert.fail('Expected error')
    } catch (err) {
      error = (err as Error).message
    }

    // No side effects
    assert.equal(await pathExists(join(dir, 'slot', 'settings.json')), false)
    t.assert.snapshot([...consoleOutput.map(stripAnsi), error])
  })

  it('wondoc init --slot (root has no path, errors)', async t => {
    const dir = await mkdtemp(join(tmpdir(), 'wondoc-init-'))
    createdDirs.push(dir)

    await writeFile(join(dir, 'settings.json'), JSON.stringify({draft: true}, null, 2) + '\n', 'utf-8')

    let error: string | undefined
    try {
      await init(createMockCliContext({cwd: dir}), {slot: true})
      assert.fail('Expected error')
    } catch (err) {
      error = (err as Error).message
    }
    assert.ok(error?.includes('Settings validation failed'))
    assert.ok(!error?.includes('settings --fix'))
    t.assert.snapshot([...consoleOutput.map(stripAnsi), error])
  })

  it('wondoc init --slot (slot_path already set, errors)', async t => {
    const dir = await mkdtemp(join(tmpdir(), 'wondoc-init-'))
    createdDirs.push(dir)

    await writeFile(
      join(dir, 'settings.json'),
      JSON.stringify({path: '/existing', slot_path: '/existing-slot'}, null, 2) + '\n',
      'utf-8',
    )

    let error: string | undefined
    try {
      await init(createMockCliContext({cwd: dir}), {slot: true})
      assert.fail('Expected error')
    } catch (err) {
      error = (err as Error).message
    }
    t.assert.snapshot([...consoleOutput.map(stripAnsi), error])
  })

  it('wondoc init --template (template_path already set, errors)', async t => {
    const dir = await mkdtemp(join(tmpdir(), 'wondoc-init-'))
    createdDirs.push(dir)

    await writeFile(
      join(dir, 'settings.json'),
      JSON.stringify({path: '/existing', template_path: '/existing-template'}, null, 2) + '\n',
      'utf-8',
    )

    let error: string | undefined
    try {
      await init(createMockCliContext({cwd: dir}), {template: true})
      assert.fail('Expected error')
    } catch (err) {
      error = (err as Error).message
    }
    t.assert.snapshot([...consoleOutput.map(stripAnsi), error])
  })

  it('wondoc init /wrong --slot (path mismatch, errors)', async t => {
    const dir = await mkdtemp(join(tmpdir(), 'wondoc-init-'))
    createdDirs.push(dir)

    await writeFile(join(dir, 'settings.json'), JSON.stringify({path: '/existing'}, null, 2) + '\n', 'utf-8')

    let error: string | undefined
    try {
      await init(createMockCliContext({cwd: dir}), {path: '/wrong', slot: true})
      assert.fail('Expected error')
    } catch (err) {
      error = (err as Error).message
    }
    t.assert.snapshot([...consoleOutput.map(stripAnsi), error])
  })

  it('wondoc init /root --template=same --slot=same (collision, errors)', async t => {
    const dir = await mkdtemp(join(tmpdir(), 'wondoc-init-'))
    createdDirs.push(dir)

    let error: string | undefined
    try {
      await init(createMockCliContext({cwd: dir}), {path: '/root', template: 'same', slot: 'same'})
      assert.fail('Expected error')
    } catch (err) {
      error = (err as Error).message
    }
    t.assert.snapshot([...consoleOutput.map(stripAnsi), error])
  })

  it('wondoc init root --template=root (collision, errors)', async t => {
    const dir = await mkdtemp(join(tmpdir(), 'wondoc-init-'))
    createdDirs.push(dir)

    let error: string | undefined
    try {
      await init(createMockCliContext({cwd: dir}), {path: 'root', template: 'root'})
      assert.fail('Expected error')
    } catch (err) {
      error = (err as Error).message
    }
    t.assert.snapshot([...consoleOutput.map(stripAnsi), error])
  })

  it('wondoc init root --slot=root (collision, errors)', async t => {
    const dir = await mkdtemp(join(tmpdir(), 'wondoc-init-'))
    createdDirs.push(dir)

    let error: string | undefined
    try {
      await init(createMockCliContext({cwd: dir}), {path: 'root', slot: 'root'})
      assert.fail('Expected error')
    } catch (err) {
      error = (err as Error).message
    }
    t.assert.snapshot([...consoleOutput.map(stripAnsi), error])
  })

  it('wondoc init --slot=taken (collides with template_path, errors)', async t => {
    const dir = await mkdtemp(join(tmpdir(), 'wondoc-init-'))
    createdDirs.push(dir)

    await writeFile(
      join(dir, 'settings.json'),
      JSON.stringify({path: '/existing', template_path: '/taken'}, null, 2) + '\n',
      'utf-8',
    )

    let error: string | undefined
    try {
      await init(createMockCliContext({cwd: dir}), {slot: 'taken'})
      assert.fail('Expected error')
    } catch (err) {
      error = (err as Error).message
    }
    t.assert.snapshot([...consoleOutput.map(stripAnsi), error])
  })

  it('wondoc init --slot (dirty root settings, errors)', async t => {
    const dir = await mkdtemp(join(tmpdir(), 'wondoc-init-'))
    createdDirs.push(dir)

    // Root has template_path but no template/ dir with settings — that's fine.
    // But template/ dir exists without settings.json — that's a validation error.
    await writeFile(join(dir, 'settings.json'), JSON.stringify({path: '/existing'}, null, 2) + '\n', 'utf-8')
    await mkdir(join(dir, 'template'), {recursive: true})
    await writeFile(join(dir, 'template', 'dummy.txt'), 'x', 'utf-8')

    let error: string | undefined
    try {
      await init(createMockCliContext({cwd: dir}), {slot: true})
      assert.fail('Expected error')
    } catch (err) {
      error = (err as Error).message
    }
    assert.ok(error?.includes('settings --fix'))
    t.assert.snapshot([...consoleOutput.map(stripAnsi), error])
  })
})
