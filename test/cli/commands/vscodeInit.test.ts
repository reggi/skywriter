import {describe, it, afterEach, beforeEach, mock} from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp, rm, writeFile, access, mkdir, readFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {stripAnsi} from '../../helpers/stripAnsi.ts'

// Track executed commands
let executedCommands: string[] = []
let mockVscodeAvailable = true

// Mock child_process to intercept exec calls
mock.module('node:child_process', {
  namedExports: {
    exec: (command: string, callback: (error: Error | null, result: {stdout: string; stderr: string}) => void) => {
      executedCommands.push(command)
      if (command === 'which code') {
        if (mockVscodeAvailable) {
          callback(null, {stdout: '/usr/local/bin/code', stderr: ''})
        } else {
          callback(new Error('not found'), {stdout: '', stderr: ''})
        }
      } else if (command.startsWith('code "')) {
        // Mock opening VS Code - just succeed
        callback(null, {stdout: '', stderr: ''})
      } else {
        callback(null, {stdout: '', stderr: ''})
      }
    },
  },
})

// Import after mocking
const {vscodeInit} = await import('../../../src/cli/commands/vscodeInit.ts')
import {createMockCliContext} from '../test-context.ts'

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

// Capture proc-log output
let consoleOutput: string[] = []
let consoleWarnings: string[] = []

// Handler for proc-log events
const logHandler = (...args: unknown[]) => {
  const level = args[0] as string
  const messageParts = args.slice(1)
  const message = messageParts.map(String).join(' ')
  if (level === 'warn') {
    consoleWarnings.push(message)
  } else {
    consoleOutput.push(message)
  }
}

describe('vscodeInit', () => {
  const createdDirs: string[] = []

  beforeEach(() => {
    consoleOutput = []
    consoleWarnings = []
    executedCommands = []
    mockVscodeAvailable = true
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

  describe('with valid project', () => {
    it('creates workspace file with root folder only when no template or slot', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'wondoc-vscode-init-'))
      createdDirs.push(dir)

      await writeFile(join(dir, 'settings.json'), JSON.stringify({path: '/docs'}), 'utf-8')

      await vscodeInit(createMockCliContext({cwd: dir}), {init: true})

      const workspacePath = join(dir, 'doc.code-workspace')
      assert.equal(await pathExists(workspacePath), true)

      const workspace = JSON.parse(await readFile(workspacePath, 'utf-8'))
      assert.equal(workspace.folders.length, 1)
      assert.equal(workspace.folders[0].name, 'root')
      assert.equal(workspace.folders[0].path, '.')
      assert.equal(workspace.settings['terminal.integrated.cwd'], '${workspaceFolder:root}')
    })

    it('creates workspace file with template folder when template_path is set', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'wondoc-vscode-init-'))
      createdDirs.push(dir)

      await mkdir(join(dir, 'template'), {recursive: true})
      await writeFile(
        join(dir, 'settings.json'),
        JSON.stringify({path: '/docs', template_path: '/docs-template'}),
        'utf-8',
      )

      await vscodeInit(createMockCliContext({cwd: dir}), {init: true})

      const workspacePath = join(dir, 'doc.code-workspace')
      const workspace = JSON.parse(await readFile(workspacePath, 'utf-8'))
      assert.equal(workspace.folders.length, 2)
      assert.equal(workspace.folders[1].name, 'template')
      assert.equal(workspace.folders[1].path, 'template')
    })

    it('creates workspace file with slot folder when slot_path is set', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'wondoc-vscode-init-'))
      createdDirs.push(dir)

      await mkdir(join(dir, 'slot'), {recursive: true})
      await writeFile(join(dir, 'settings.json'), JSON.stringify({path: '/docs', slot_path: '/docs-slot'}), 'utf-8')

      await vscodeInit(createMockCliContext({cwd: dir}), {init: true})

      const workspacePath = join(dir, 'doc.code-workspace')
      const workspace = JSON.parse(await readFile(workspacePath, 'utf-8'))
      assert.equal(workspace.folders.length, 2)
      assert.equal(workspace.folders[1].name, 'slot')
      assert.equal(workspace.folders[1].path, 'slot')
    })

    it('creates workspace file with both template and slot folders when both are set', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'wondoc-vscode-init-'))
      createdDirs.push(dir)

      await mkdir(join(dir, 'template'), {recursive: true})
      await mkdir(join(dir, 'slot'), {recursive: true})
      await writeFile(
        join(dir, 'settings.json'),
        JSON.stringify({path: '/docs', template_path: '/docs-template', slot_path: '/docs-slot'}),
        'utf-8',
      )

      await vscodeInit(createMockCliContext({cwd: dir}), {init: true})

      const workspacePath = join(dir, 'doc.code-workspace')
      const workspace = JSON.parse(await readFile(workspacePath, 'utf-8'))
      assert.equal(workspace.folders.length, 3)
      assert.equal(workspace.folders[0].name, 'root')
      assert.equal(workspace.folders[1].name, 'template')
      assert.equal(workspace.folders[2].name, 'slot')
    })

    it('creates .github directory with copilot-instructions.md', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'wondoc-vscode-init-'))
      createdDirs.push(dir)

      await writeFile(join(dir, 'settings.json'), JSON.stringify({path: '/docs'}), 'utf-8')

      await vscodeInit(createMockCliContext({cwd: dir}), {init: true})

      const githubDir = join(dir, '.github')
      assert.equal(await pathExists(githubDir), true)

      // Verify the content uses the CLI name from context
      const instructionsContent = await readFile(join(githubDir, 'copilot-instructions.md'), 'utf-8')
      assert.ok(instructionsContent.includes('wondoc render'), 'should contain CLI name in commands')
      assert.ok(!instructionsContent.includes('quandoc'), 'should not contain outdated quandoc name')
    })

    it('logs project path information', async t => {
      const dir = await mkdtemp(join(tmpdir(), 'wondoc-vscode-init-'))
      createdDirs.push(dir)

      await writeFile(join(dir, 'settings.json'), JSON.stringify({path: '/my-docs'}), 'utf-8')

      await vscodeInit(createMockCliContext({cwd: dir}), {init: true})

      assert.ok(consoleOutput.some(line => line.includes('/my-docs')))
      assert.ok(consoleOutput.some(line => line.includes('doc.code-workspace')))
      t.assert.snapshot(consoleOutput.map(stripAnsi))
    })
  })

  describe('with invalid project', () => {
    it('throws when settings.json does not exist', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'wondoc-vscode-init-'))
      createdDirs.push(dir)

      await assert.rejects(async () => {
        await vscodeInit(createMockCliContext({cwd: dir}), {init: true})
      }, /settings\.json not found/)
    })

    it('throws when settings.json has no path property', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'wondoc-vscode-init-'))
      createdDirs.push(dir)

      await writeFile(join(dir, 'settings.json'), JSON.stringify({other: 'value'}), 'utf-8')

      await assert.rejects(async () => {
        await vscodeInit(createMockCliContext({cwd: dir}), {init: true})
      }, /must have a "path" property/)
    })

    it('throws when slot_path is set but slot directory does not exist', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'wondoc-vscode-init-'))
      createdDirs.push(dir)

      await writeFile(join(dir, 'settings.json'), JSON.stringify({path: '/docs', slot_path: '/docs-slot'}), 'utf-8')

      await assert.rejects(async () => {
        await vscodeInit(createMockCliContext({cwd: dir}), {init: true})
      }, /Slot directory not found/)
    })

    it('throws when template_path is set but template directory does not exist', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'wondoc-vscode-init-'))
      createdDirs.push(dir)

      await writeFile(
        join(dir, 'settings.json'),
        JSON.stringify({path: '/docs', template_path: '/docs-template'}),
        'utf-8',
      )

      await assert.rejects(async () => {
        await vscodeInit(createMockCliContext({cwd: dir}), {init: true})
      }, /Template directory not found/)
    })
  })

  describe('VS Code integration', () => {
    it('opens workspace in VS Code when code CLI is available', async t => {
      const dir = await mkdtemp(join(tmpdir(), 'wondoc-vscode-init-'))
      createdDirs.push(dir)

      await writeFile(join(dir, 'settings.json'), JSON.stringify({path: '/docs'}), 'utf-8')
      mockVscodeAvailable = true

      await vscodeInit(createMockCliContext({cwd: dir}), {init: true, open: true})

      assert.ok(executedCommands.some(cmd => cmd === 'which code'))
      assert.ok(executedCommands.some(cmd => cmd.startsWith('code "')))
      t.assert.snapshot(consoleOutput.map(line => stripAnsi(line).replace(dir, '<tmpdir>')))
    })

    it('throws when VS Code CLI is not available', async t => {
      const dir = await mkdtemp(join(tmpdir(), 'wondoc-vscode-init-'))
      createdDirs.push(dir)

      await writeFile(join(dir, 'settings.json'), JSON.stringify({path: '/docs'}), 'utf-8')
      mockVscodeAvailable = false

      let error = ''
      try {
        await vscodeInit(createMockCliContext({cwd: dir}), {init: true, open: true})
      } catch (e) {
        error = (e as Error).message
      }

      assert.ok(executedCommands.some(cmd => cmd === 'which code'))
      assert.ok(!executedCommands.some(cmd => cmd.startsWith('code "')))
      // --init should NOT have run since --open check fails first
      assert.equal(await pathExists(join(dir, '.github')), false)
      t.assert.snapshot([...consoleOutput.map(line => stripAnsi(line).replace(dir, '<tmpdir>')), error])
    })

    it('--init only does not open VS Code', async t => {
      const dir = await mkdtemp(join(tmpdir(), 'wondoc-vscode-init-'))
      createdDirs.push(dir)

      await writeFile(join(dir, 'settings.json'), JSON.stringify({path: '/docs'}), 'utf-8')

      await vscodeInit(createMockCliContext({cwd: dir}), {init: true})

      assert.ok(!executedCommands.some(cmd => cmd === 'which code'))
      assert.ok(!executedCommands.some(cmd => cmd.startsWith('code "')))
      t.assert.snapshot(consoleOutput.map(line => stripAnsi(line).replace(dir, '<tmpdir>')))
    })

    it('--open only does not create workspace files', async t => {
      const dir = await mkdtemp(join(tmpdir(), 'wondoc-vscode-init-'))
      createdDirs.push(dir)

      await writeFile(join(dir, 'settings.json'), JSON.stringify({path: '/docs'}), 'utf-8')
      mockVscodeAvailable = true

      await vscodeInit(createMockCliContext({cwd: dir}), {open: true})

      // Should not have written workspace file
      assert.equal(await pathExists(join(dir, '.github')), false)
      // Should have tried to open
      assert.ok(executedCommands.some(cmd => cmd.startsWith('code "')))
      t.assert.snapshot(consoleOutput.map(line => stripAnsi(line).replace(dir, '<tmpdir>')))
    })
  })
})
