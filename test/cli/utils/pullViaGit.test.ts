import {describe, it, afterEach, mock, beforeEach} from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp, rm, writeFile, mkdir} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {promisify} from 'node:util'

const mockConfig = {
  serverUrl: 'http://localhost:3000',
  username: 'testuser',
  password: 'testpass',
}

// Track git commands that were called
let gitCommands: Array<{cmd: string; cwd?: string}> = []

// Suppress proc-log output during tests
const logHandler = () => {}

// Capture log output for snapshot testing
let capturedLogs: string[] = []
const captureHandler = (...args: unknown[]) => {
  capturedLogs.push(args.slice(1).map(String).join(' '))
}

// Track populateCache calls
let populateCacheCalls: Array<Record<string, unknown>> = []

// Control mock behavior
let mockGitInstalled = true
let mockGitError: Error | null = null

// Save real fs readFile before mocking
const realFsPromises = await import('node:fs/promises')
const originalReadFile = realFsPromises.readFile

// Build server key matching credentials.ts serverKey() format
const mockServerKey = (() => {
  const url = new URL(mockConfig.serverUrl)
  url.username = mockConfig.username
  return url.href.replace(/\/$/, '')
})()

// Mock node:fs/promises — intercept config/credential file reads so real
// config.ts → credentials.ts → createLoggedFs chain runs with natural logging
mock.module('node:fs/promises', {
  namedExports: {
    ...realFsPromises,
    readFile: async (...args: unknown[]) => {
      const pathStr = String(args[0])
      const basename = pathStr.split('/').pop() || ''
      if (basename === '.wondoc.json') {
        return JSON.stringify({active: mockServerKey, servers: {[mockServerKey]: {}}})
      }
      if (basename === '.wondoc-cli-credentials.json') {
        return JSON.stringify({[`${mockConfig.serverUrl}:${mockConfig.username}`]: mockConfig})
      }
      return (originalReadFile as (...a: unknown[]) => Promise<string>)(...args)
    },
  },
})

// Mock git module
mock.module('../../../src/cli/utils/git.ts', {
  namedExports: {
    isGitInstalled: async () => mockGitInstalled,
    isGitRepo: async () => false,
    isDirectoryEmpty: async () => true,
    hasRemote: async () => false,
  },
})

// Mock populateCache module
mock.module('../../../src/cli/utils/populateCache.ts', {
  namedExports: {
    populateCache: async (config: Record<string, unknown>) => {
      populateCacheCalls.push(config)
    },
  },
})

// Mock downloadPathUploads
mock.module('../../../src/cli/pathOperations/downloadPathUploads.ts', {
  namedExports: {
    downloadPathUploads: async () => {},
  },
})

// Mock @inquirer/prompts to prevent child_process issues
mock.module('@inquirer/prompts', {
  namedExports: {
    confirm: async () => true,
  },
})

// Helper to get mock exec result
function getMockExecResult(cmd: string, _options: Record<string, unknown>): {stdout: string; stderr: string} | Error {
  if (mockGitError) {
    return mockGitError
  }
  // Return a matching clean URL for git remote get-url origin
  if (cmd.includes('git remote get-url origin')) {
    // Return a URL that matches the expected URL for the test
    const cwd = (_options.cwd as string) || '.'
    // Check if this is a sub-context (template/slot) or main
    if (cwd.includes('template')) {
      return {stdout: 'http://localhost:3000/test-template.git\n', stderr: ''}
    }
    if (cwd.includes('slot')) {
      return {stdout: 'http://localhost:3000/test-slot.git\n', stderr: ''}
    }
    return {stdout: 'http://localhost:3000/test-doc.git\n', stderr: ''}
  }
  if (cmd.includes('git status --porcelain')) {
    return {stdout: '', stderr: ''}
  }
  return {stdout: '', stderr: ''}
}

// Create exec mock with custom promisify support
const mockExec = (
  cmd: string,
  optionsOrCallback: Record<string, unknown> | ((err: Error | null, stdout: string, stderr: string) => void),
  callback?: (err: Error | null, stdout: string, stderr: string) => void,
) => {
  const options = typeof optionsOrCallback === 'object' ? optionsOrCallback : {}
  const cb = typeof optionsOrCallback === 'function' ? optionsOrCallback : callback

  gitCommands.push({cmd, cwd: options.cwd as string | undefined})

  setImmediate(() => {
    const result = getMockExecResult(cmd, options)
    if (result instanceof Error) {
      cb?.(result, '', result.message)
    } else {
      cb?.(null, result.stdout, result.stderr)
    }
  })

  return {
    stdout: {on: () => {}},
    stderr: {on: () => {}},
    on: () => {},
  }
}

;(mockExec as unknown as Record<symbol, unknown>)[promisify.custom] = (
  cmd: string,
  options: Record<string, unknown> = {},
) => {
  gitCommands.push({cmd, cwd: options.cwd as string | undefined})
  return new Promise((resolve, reject) => {
    setImmediate(() => {
      const result = getMockExecResult(cmd, options)
      if (result instanceof Error) {
        reject(result)
      } else {
        resolve(result)
      }
    })
  })
}

// Mock child_process exec
mock.module('node:child_process', {
  namedExports: {
    exec: mockExec,
    spawn: () => ({on: () => {}, stdout: {on: () => {}}, stderr: {on: () => {}}}),
    spawnSync: () => ({status: 0, stdout: '', stderr: ''}),
  },
})

// Import after mocking
const {pullViaGit} = await import('../../../src/cli/utils/pullViaGit.ts')
import {createMockCliContext} from '../test-context.ts'
const mockCliContext = createMockCliContext({authType: 'file'})

describe('pullViaGit', () => {
  const createdDirs: string[] = []
  let originalCwd: string

  beforeEach(() => {
    originalCwd = process.cwd()
    gitCommands = []
    populateCacheCalls = []
    capturedLogs = []
    mockGitInstalled = true
    mockGitError = null
    process.on('log', logHandler)
  })

  afterEach(async () => {
    process.removeListener('log', logHandler)
    process.removeListener('log', captureHandler)
    process.chdir(originalCwd)

    await Promise.all(
      createdDirs.splice(0).map(async dir => {
        await rm(dir, {recursive: true, force: true})
      }),
    )
  })

  describe('validation', () => {
    it('throws when git is not installed', async () => {
      mockGitInstalled = false
      await assert.rejects(async () => pullViaGit(mockCliContext, '/test-doc'), /Git is not installed/)
    })
  })

  describe('clone (fresh)', () => {
    it('clones main repository into destination directory', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'pull-git-'))
      createdDirs.push(dir)
      process.chdir(dir)

      await pullViaGit(mockCliContext, '/test-doc')

      const cloneCmd = gitCommands.find(c => c.cmd.includes('git clone') && c.cmd.includes('/test-doc.git'))
      assert.ok(cloneCmd, 'git clone should have been called with the doc path')
    })

    it('uses basename of path as destination directory', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'pull-git-'))
      createdDirs.push(dir)
      process.chdir(dir)

      await pullViaGit(mockCliContext, '/test-doc')

      const cloneCmd = gitCommands.find(c => c.cmd.includes('git clone'))
      assert.ok(cloneCmd, 'git clone should have been called')
      // The clone uses absolute path for destination
      assert.ok(cloneCmd.cmd.includes('test-doc'), 'should clone into test-doc directory')
    })

    it('uses custom destination when provided', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'pull-git-'))
      createdDirs.push(dir)
      process.chdir(dir)

      await pullViaGit(mockCliContext, '/test-doc', 'my-folder')

      const cloneCmd = gitCommands.find(c => c.cmd.includes('git clone'))
      assert.ok(cloneCmd, 'git clone should have been called')
      assert.ok(cloneCmd.cmd.includes('my-folder'), 'should clone into custom directory')
    })

    it('parses full URL source', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'pull-git-'))
      createdDirs.push(dir)
      process.chdir(dir)

      await pullViaGit(mockCliContext, 'http://localhost:3000/test-doc')

      const cloneCmd = gitCommands.find(c => c.cmd.includes('git clone'))
      assert.ok(cloneCmd, 'git clone should have been called')
      assert.ok(cloneCmd.cmd.includes('/test-doc.git'), 'should include document path')
    })

    it('strips .git suffix from URL source', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'pull-git-'))
      createdDirs.push(dir)
      process.chdir(dir)

      await pullViaGit(mockCliContext, 'http://localhost:3000/test-doc.git')

      const cloneCmd = gitCommands.find(c => c.cmd.includes('git clone'))
      assert.ok(cloneCmd, 'git clone should have been called')
      assert.ok(cloneCmd.cmd.includes('/test-doc.git'), 'git URL should include .git')
    })

    it('cleans credentials from remote URL after clone', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'pull-git-'))
      createdDirs.push(dir)
      process.chdir(dir)

      await pullViaGit(mockCliContext, '/test-doc')

      const setUrlCmd = gitCommands.find(c => c.cmd.includes('git remote set-url'))
      assert.ok(setUrlCmd, 'should clean remote URL after clone')
      assert.ok(!setUrlCmd.cmd.includes('testuser'), 'cleaned URL should not contain username')
      assert.ok(!setUrlCmd.cmd.includes('testpass'), 'cleaned URL should not contain password')
    })

    it('clones template when settings has template_path', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'pull-git-'))
      createdDirs.push(dir)
      process.chdir(dir)

      // Pre-create settings.json in the destination (simulates post-clone state)
      const dest = join(dir, 'test-doc')
      await mkdir(dest, {recursive: true})
      await writeFile(join(dest, 'settings.json'), JSON.stringify({path: '/test-doc', template_path: '/test-template'}))

      await pullViaGit(mockCliContext, '/test-doc')

      const templateClone = gitCommands.find(c => c.cmd.includes('git clone') && c.cmd.includes('/test-template.git'))
      assert.ok(templateClone, 'template should have been cloned')
    })

    it('clones slot when settings has slot_path', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'pull-git-'))
      createdDirs.push(dir)
      process.chdir(dir)

      const dest = join(dir, 'test-doc')
      await mkdir(dest, {recursive: true})
      await writeFile(join(dest, 'settings.json'), JSON.stringify({path: '/test-doc', slot_path: '/test-slot'}))

      await pullViaGit(mockCliContext, '/test-doc')

      const slotClone = gitCommands.find(c => c.cmd.includes('git clone') && c.cmd.includes('/test-slot.git'))
      assert.ok(slotClone, 'slot should have been cloned')
    })

    it('clones template and slot in parallel', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'pull-git-'))
      createdDirs.push(dir)
      process.chdir(dir)

      const dest = join(dir, 'test-doc')
      await mkdir(dest, {recursive: true})
      await writeFile(
        join(dest, 'settings.json'),
        JSON.stringify({path: '/test-doc', template_path: '/test-template', slot_path: '/test-slot'}),
      )

      await pullViaGit(mockCliContext, '/test-doc')

      const templateClone = gitCommands.find(c => c.cmd.includes('git clone') && c.cmd.includes('/test-template.git'))
      const slotClone = gitCommands.find(c => c.cmd.includes('git clone') && c.cmd.includes('/test-slot.git'))
      assert.ok(templateClone, 'template should have been cloned')
      assert.ok(slotClone, 'slot should have been cloned')
    })

    it('calls populateCache after clone', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'pull-git-'))
      createdDirs.push(dir)
      process.chdir(dir)

      const dest = join(dir, 'test-doc')
      await mkdir(dest, {recursive: true})
      await writeFile(join(dest, 'settings.json'), JSON.stringify({path: '/test-doc'}))

      await pullViaGit(mockCliContext, '/test-doc')

      assert.equal(populateCacheCalls.length, 1, 'populateCache should be called once')
    })
  })

  describe('update (existing repo)', () => {
    it('pulls when inside existing repo with no source', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'pull-git-'))
      createdDirs.push(dir)
      process.chdir(dir)

      // Create .git dir and settings.json to simulate existing repo
      await mkdir(join(dir, '.git'), {recursive: true})
      await writeFile(join(dir, 'settings.json'), JSON.stringify({path: '/test-doc'}))

      await pullViaGit(mockCliContext)

      const pullCmd = gitCommands.find(c => c.cmd === 'git pull')
      assert.ok(pullCmd, 'git pull should have been called')
    })

    it('sets auth URL before pull and restores after', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'pull-git-'))
      createdDirs.push(dir)
      process.chdir(dir)

      await mkdir(join(dir, '.git'), {recursive: true})
      await writeFile(join(dir, 'settings.json'), JSON.stringify({path: '/test-doc'}))

      await pullViaGit(mockCliContext)

      const setUrlCmds = gitCommands.filter(c => c.cmd.includes('git remote set-url origin'))
      assert.ok(setUrlCmds.length >= 2, 'should set auth URL then restore clean URL')
    })
  })

  describe('error handling', () => {
    it('wraps git errors in pull failed message', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'pull-git-'))
      createdDirs.push(dir)
      process.chdir(dir)

      mockGitError = new Error('remote: Repository not found')

      await assert.rejects(async () => pullViaGit(mockCliContext, '/test-doc'), /pull failed.*Repository not found/)
    })

    it('throws when no source and no settings.json', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'pull-git-'))
      createdDirs.push(dir)
      process.chdir(dir)

      await assert.rejects(async () => pullViaGit(mockCliContext), /No source argument and no settings.json found/)
    })
  })

  describe('log output', () => {
    it('logs clone flow', async t => {
      const dir = await mkdtemp(join(tmpdir(), 'pull-git-'))
      createdDirs.push(dir)
      process.chdir(dir)

      process.removeListener('log', logHandler)
      process.on('log', captureHandler)

      await pullViaGit(mockCliContext, '/test-doc')

      process.removeListener('log', captureHandler)
      process.on('log', logHandler)

      t.assert.snapshot(capturedLogs)
    })

    it('logs update flow', async t => {
      const dir = await mkdtemp(join(tmpdir(), 'pull-git-'))
      createdDirs.push(dir)
      process.chdir(dir)

      await mkdir(join(dir, '.git'), {recursive: true})
      await writeFile(join(dir, 'settings.json'), JSON.stringify({path: '/test-doc'}))

      process.removeListener('log', logHandler)
      process.on('log', captureHandler)

      await pullViaGit(mockCliContext)

      process.removeListener('log', captureHandler)
      process.on('log', logHandler)

      t.assert.snapshot(capturedLogs)
    })

    it('logs clone with template and slot', async t => {
      const dir = await mkdtemp(join(tmpdir(), 'pull-git-'))
      createdDirs.push(dir)
      process.chdir(dir)

      const dest = join(dir, 'test-doc')
      await mkdir(dest, {recursive: true})
      await writeFile(
        join(dest, 'settings.json'),
        JSON.stringify({path: '/test-doc', template_path: '/test-template', slot_path: '/test-slot'}),
      )

      process.removeListener('log', logHandler)
      process.on('log', captureHandler)

      await pullViaGit(mockCliContext, '/test-doc')

      process.removeListener('log', captureHandler)
      process.on('log', logHandler)

      t.assert.snapshot(capturedLogs)
    })

    it('logs update with slot', async t => {
      const dir = await mkdtemp(join(tmpdir(), 'pull-git-'))
      createdDirs.push(dir)
      process.chdir(dir)

      // Main repo exists with .git and settings referencing a slot
      await mkdir(join(dir, '.git'), {recursive: true})
      await writeFile(join(dir, 'settings.json'), JSON.stringify({path: '/test-doc', slot_path: '/test-slot'}))

      // Slot repo already exists with .git
      await mkdir(join(dir, 'slot', '.git'), {recursive: true})
      await writeFile(join(dir, 'slot', 'settings.json'), JSON.stringify({path: '/test-slot'}))

      process.removeListener('log', logHandler)
      process.on('log', captureHandler)

      await pullViaGit(mockCliContext)

      process.removeListener('log', captureHandler)
      process.on('log', logHandler)

      t.assert.snapshot(capturedLogs)
    })
  })
})
