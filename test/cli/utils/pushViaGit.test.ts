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

const mockAuth = Buffer.from(`${mockConfig.username}:${mockConfig.password}`).toString('base64')

// Track git commands that were called
let gitCommands: Array<{cmd: string; cwd?: string}> = []

// Suppress proc-log output during tests
const logHandler = () => {}

// Capture log output for snapshot testing
let capturedLogs: string[] = []
const captureHandler = (...args: unknown[]) => {
  capturedLogs.push(args.slice(1).map(String).join(' '))
}

// Control mock behavior
let mockGitInstalled = true
let mockIsRepo = true
let mockHasRemoteResult = true
let mockGitError: Error | null = null
let mockNoUpstream = false

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
    isGitRepo: async () => mockIsRepo,
    hasRemote: async () => mockHasRemoteResult,
  },
})

// Track uploadPathUploads calls
let uploadPathCalls: Array<Record<string, unknown>> = []

// Mock uploadPathUploads module
mock.module('../../../src/cli/pathOperations/uploadPathUploads.ts', {
  namedExports: {
    uploadPathUploads: async (ctx: Record<string, unknown>) => {
      uploadPathCalls.push(ctx)
    },
  },
})

// Mock deletePathUploads module
mock.module('../../../src/cli/pathOperations/deletePathUploads.ts', {
  namedExports: {
    deletePathUploads: async () => {},
  },
})

// Mock populateCache module
mock.module('../../../src/cli/utils/populateCache.ts', {
  namedExports: {
    populateCache: async () => {},
  },
})

// Helper to execute mock git command
function getMockExecResult(cmd: string, _options: Record<string, unknown>): {stdout: string; stderr: string} | Error {
  if (mockGitError) {
    return mockGitError
  }

  if (cmd.includes('git rev-parse --abbrev-ref --symbolic-full-name @{u}') && mockNoUpstream) {
    return new Error('fatal: no upstream configured for branch')
  }

  if (cmd.includes('git rev-parse --abbrev-ref HEAD')) {
    return {stdout: 'main\n', stderr: ''}
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

// Mock @inquirer/prompts to prevent child_process dependency chain
mock.module('@inquirer/prompts', {
  namedExports: {
    confirm: async () => true,
  },
})

// Mock child_process exec (include spawn/spawnSync for @inquirer compatibility)
mock.module('node:child_process', {
  namedExports: {
    exec: mockExec,
    spawn: () => ({on: () => {}, stdout: {on: () => {}}, stderr: {on: () => {}}}),
    spawnSync: () => ({status: 0, stdout: '', stderr: ''}),
  },
})

// Import after mocking
const {pushViaGit} = await import('../../../src/cli/utils/pushViaGit.ts')
import {createMockCliContext} from '../test-context.ts'
const mockCliContext = createMockCliContext({authType: 'file'})

describe('pushViaGit', () => {
  const createdDirs: string[] = []
  let originalCwd: string
  let originalFetch: typeof globalThis.fetch

  beforeEach(() => {
    originalCwd = process.cwd()
    originalFetch = globalThis.fetch
    gitCommands = []
    uploadPathCalls = []
    capturedLogs = []
    mockGitInstalled = true
    mockIsRepo = true
    mockHasRemoteResult = true
    mockGitError = null
    mockNoUpstream = false
    process.on('log', logHandler)
  })

  afterEach(async () => {
    process.removeListener('log', logHandler)
    process.removeListener('log', captureHandler)
    globalThis.fetch = originalFetch
    process.chdir(originalCwd)

    await Promise.all(
      createdDirs.splice(0).map(async dir => {
        await rm(dir, {recursive: true, force: true})
      }),
    )
  })

  describe('validation errors', () => {
    it('throws when git is not installed', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'push-git-'))
      createdDirs.push(dir)
      process.chdir(dir)

      mockGitInstalled = false

      await assert.rejects(async () => pushViaGit(mockCliContext), /Git is not installed/)
    })

    it('throws when not in a git repository', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'push-git-'))
      createdDirs.push(dir)
      process.chdir(dir)

      mockIsRepo = false

      await assert.rejects(async () => pushViaGit(mockCliContext), /not a git repository/)
    })

    it('throws when settings.json is missing', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'push-git-'))
      createdDirs.push(dir)
      process.chdir(dir)

      await assert.rejects(async () => pushViaGit(mockCliContext), /No source argument and no settings.json found/)
    })

    it('throws when no content file exists', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'push-git-'))
      createdDirs.push(dir)
      process.chdir(dir)

      await writeFile(join(dir, 'settings.json'), JSON.stringify({path: '/test-doc'}))

      await assert.rejects(async () => pushViaGit(mockCliContext), /No content file found/)
    })

    it('throws when template directory exists but template_path is not set', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'push-git-'))
      createdDirs.push(dir)
      process.chdir(dir)

      await writeFile(join(dir, 'settings.json'), JSON.stringify({path: '/test-doc'}))
      await writeFile(join(dir, 'content.md'), '# Test')
      await mkdir(join(dir, 'template'), {recursive: true})

      await assert.rejects(
        async () => pushViaGit(mockCliContext),
        /Template directory exists but template_path is not set/,
      )
    })

    it('throws when slot directory exists but slot_path is not set', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'push-git-'))
      createdDirs.push(dir)
      process.chdir(dir)

      await writeFile(join(dir, 'settings.json'), JSON.stringify({path: '/test-doc'}))
      await writeFile(join(dir, 'content.md'), '# Test')
      await mkdir(join(dir, 'slot'), {recursive: true})

      await assert.rejects(async () => pushViaGit(mockCliContext), /Slot directory exists but slot_path is not set/)
    })
  })

  describe('push main repository via git', () => {
    it('pushes main repository when .git and remote exist', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'push-git-'))
      createdDirs.push(dir)
      process.chdir(dir)

      await mkdir(join(dir, '.git'), {recursive: true})
      await writeFile(join(dir, 'settings.json'), JSON.stringify({path: '/test-doc'}))
      await writeFile(join(dir, 'content.md'), '# Hello World')

      await pushViaGit(mockCliContext)

      const pushCmd = gitCommands.find(c => c.cmd === 'git push' && c.cwd === '.')
      assert.ok(pushCmd, 'main repository should be pushed via git')
    })

    it('uses set-upstream when no upstream branch exists', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'push-git-'))
      createdDirs.push(dir)
      process.chdir(dir)

      await mkdir(join(dir, '.git'), {recursive: true})
      await writeFile(join(dir, 'settings.json'), JSON.stringify({path: '/test-doc'}))
      await writeFile(join(dir, 'content.md'), '# Hello World')
      mockNoUpstream = true

      await pushViaGit(mockCliContext)

      const setUpstreamPush = gitCommands.find(c => c.cmd.includes('git push -u origin main'))
      assert.ok(setUpstreamPush, 'should use --set-upstream for first push')
    })

    it('sets auth URL then restores clean URL on remote', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'push-git-'))
      createdDirs.push(dir)
      process.chdir(dir)

      await mkdir(join(dir, '.git'), {recursive: true})
      await writeFile(join(dir, 'settings.json'), JSON.stringify({path: '/test-doc'}))
      await writeFile(join(dir, 'content.md'), '# Hello World')

      await pushViaGit(mockCliContext)

      const setUrlCmds = gitCommands.filter(c => c.cmd.includes('git remote set-url origin'))
      assert.ok(setUrlCmds.length >= 2, 'should set auth URL then restore clean URL')
      // First set-url adds auth
      assert.ok(setUrlCmds[0].cmd.includes('testuser'), 'first set-url should include credentials')
      // Last set-url cleans credentials
      assert.ok(!setUrlCmds[setUrlCmds.length - 1].cmd.includes('testuser'), 'final set-url should clean credentials')
    })

    it('falls back to tar upload when .git directory is missing', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'push-git-'))
      createdDirs.push(dir)
      process.chdir(dir)

      // No .git directory — pushPathViaGit falls back to pushPathViaTar
      await writeFile(join(dir, 'settings.json'), JSON.stringify({path: '/test-doc'}))
      await writeFile(join(dir, 'content.md'), '# Hello World')

      let tarUploadCalled = false
      globalThis.fetch = mock.fn(async (url: string) => {
        if (String(url).includes('/edit?update=true')) {
          tarUploadCalled = true
        }
        return new Response(JSON.stringify({success: true}), {status: 200})
      }) as typeof fetch

      await pushViaGit(mockCliContext)

      assert.ok(tarUploadCalled, 'should fall back to tar upload')
      const gitPush = gitCommands.find(c => c.cmd === 'git push')
      assert.equal(gitPush, undefined, 'should NOT do a git push')
    })

    it('falls back to tar upload when no remote is configured', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'push-git-'))
      createdDirs.push(dir)
      process.chdir(dir)

      await mkdir(join(dir, '.git'), {recursive: true})
      await writeFile(join(dir, 'settings.json'), JSON.stringify({path: '/test-doc'}))
      await writeFile(join(dir, 'content.md'), '# Hello World')
      mockHasRemoteResult = false

      let tarUploadCalled = false
      globalThis.fetch = mock.fn(async (url: string) => {
        if (String(url).includes('/edit?update=true')) {
          tarUploadCalled = true
        }
        return new Response(JSON.stringify({success: true}), {status: 200})
      }) as typeof fetch

      await pushViaGit(mockCliContext)

      assert.ok(tarUploadCalled, 'should fall back to tar upload')
    })
  })

  describe('push with source argument', () => {
    it('resolves source path for push', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'push-git-'))
      createdDirs.push(dir)
      process.chdir(dir)

      await mkdir(join(dir, '.git'), {recursive: true})
      await writeFile(join(dir, 'settings.json'), JSON.stringify({path: '/test-doc'}))
      await writeFile(join(dir, 'content.md'), '# Hello World')

      // Push with explicit source path — resolveTarget will use resolveSource
      await pushViaGit(mockCliContext, '/test-doc')

      const pushCmd = gitCommands.find(c => c.cmd === 'git push')
      assert.ok(pushCmd, 'should push the repository')
    })
  })

  describe('push template and slot repositories', () => {
    it('pushes template before main when template exists', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'push-git-'))
      createdDirs.push(dir)
      process.chdir(dir)

      await mkdir(join(dir, '.git'), {recursive: true})
      await writeFile(join(dir, 'settings.json'), JSON.stringify({path: '/test-doc', template_path: '/test-template'}))
      await writeFile(join(dir, 'content.md'), '# Main')
      await mkdir(join(dir, 'template', '.git'), {recursive: true})
      await writeFile(join(dir, 'template', 'settings.json'), JSON.stringify({path: '/test-template'}))
      await writeFile(join(dir, 'template', 'content.md'), '# Template')

      await pushViaGit(mockCliContext)

      const templatePush = gitCommands.find(c => c.cmd === 'git push' && c.cwd === 'template')
      const mainPush = gitCommands.find(c => c.cmd === 'git push' && c.cwd === '.')

      assert.ok(templatePush, 'template should be pushed')
      assert.ok(mainPush, 'main should be pushed')

      const templateIndex = gitCommands.findIndex(c => c.cmd === 'git push' && c.cwd === 'template')
      const mainIndex = gitCommands.findIndex(c => c.cmd === 'git push' && c.cwd === '.')
      assert.ok(templateIndex < mainIndex, 'template should be pushed before main')
    })

    it('pushes slot before main when slot exists', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'push-git-'))
      createdDirs.push(dir)
      process.chdir(dir)

      await mkdir(join(dir, '.git'), {recursive: true})
      await writeFile(join(dir, 'settings.json'), JSON.stringify({path: '/test-doc', slot_path: '/test-slot'}))
      await writeFile(join(dir, 'content.md'), '# Main')
      await mkdir(join(dir, 'slot', '.git'), {recursive: true})
      await writeFile(join(dir, 'slot', 'settings.json'), JSON.stringify({path: '/test-slot'}))
      await writeFile(join(dir, 'slot', 'content.md'), '# Slot')

      await pushViaGit(mockCliContext)

      const slotPush = gitCommands.find(c => c.cmd === 'git push' && c.cwd === 'slot')
      const mainPush = gitCommands.find(c => c.cmd === 'git push' && c.cwd === '.')

      assert.ok(slotPush, 'slot should be pushed')
      assert.ok(mainPush, 'main should be pushed')

      const slotIndex = gitCommands.findIndex(c => c.cmd === 'git push' && c.cwd === 'slot')
      const mainIndex = gitCommands.findIndex(c => c.cmd === 'git push' && c.cwd === '.')
      assert.ok(slotIndex < mainIndex, 'slot should be pushed before main')
    })

    it('pushes template, slot, then main in correct order', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'push-git-'))
      createdDirs.push(dir)
      process.chdir(dir)

      await mkdir(join(dir, '.git'), {recursive: true})
      await writeFile(
        join(dir, 'settings.json'),
        JSON.stringify({
          path: '/test-doc',
          template_path: '/test-template',
          slot_path: '/test-slot',
        }),
      )
      await writeFile(join(dir, 'content.md'), '# Main')
      await mkdir(join(dir, 'template', '.git'), {recursive: true})
      await writeFile(join(dir, 'template', 'settings.json'), JSON.stringify({path: '/test-template'}))
      await writeFile(join(dir, 'template', 'content.md'), '# Template')
      await mkdir(join(dir, 'slot', '.git'), {recursive: true})
      await writeFile(join(dir, 'slot', 'settings.json'), JSON.stringify({path: '/test-slot'}))
      await writeFile(join(dir, 'slot', 'content.md'), '# Slot')

      await pushViaGit(mockCliContext)

      const templateIndex = gitCommands.findIndex(c => c.cmd === 'git push' && c.cwd === 'template')
      const slotIndex = gitCommands.findIndex(c => c.cmd === 'git push' && c.cwd === 'slot')
      const mainIndex = gitCommands.findIndex(c => c.cmd === 'git push' && c.cwd === '.')

      assert.ok(templateIndex >= 0, 'template should be pushed')
      assert.ok(slotIndex >= 0, 'slot should be pushed')
      assert.ok(mainIndex >= 0, 'main should be pushed')
      assert.ok(templateIndex < mainIndex, 'template should be pushed before main')
      assert.ok(slotIndex < mainIndex, 'slot should be pushed before main')
    })

    it('skips template push when template has no .git (falls back to tar)', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'push-git-'))
      createdDirs.push(dir)
      process.chdir(dir)

      await mkdir(join(dir, '.git'), {recursive: true})
      await writeFile(join(dir, 'settings.json'), JSON.stringify({path: '/test-doc', template_path: '/test-template'}))
      await writeFile(join(dir, 'content.md'), '# Main')
      // Template directory WITHOUT .git
      await mkdir(join(dir, 'template'), {recursive: true})
      await writeFile(join(dir, 'template', 'settings.json'), JSON.stringify({path: '/test-template'}))
      await writeFile(join(dir, 'template', 'content.md'), '# Template')

      let tarUploadUrl = ''
      globalThis.fetch = mock.fn(async (url: string) => {
        tarUploadUrl = String(url)
        return new Response(JSON.stringify({success: true}), {status: 200})
      }) as typeof fetch

      await pushViaGit(mockCliContext)

      const templateGitPush = gitCommands.find(c => c.cmd === 'git push' && c.cwd === 'template')
      assert.equal(templateGitPush, undefined, 'template should NOT be git pushed')
      assert.ok(tarUploadUrl.includes('test-template'), 'template should be tar uploaded')
    })
  })

  describe('upload handling', () => {
    it('calls uploadPathUploads after pushing', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'push-git-'))
      createdDirs.push(dir)
      process.chdir(dir)

      await mkdir(join(dir, '.git'), {recursive: true})
      await writeFile(join(dir, 'settings.json'), JSON.stringify({path: '/test-doc', uploads: ['image.png']}))
      await writeFile(join(dir, 'content.md'), '# Test')

      await pushViaGit(mockCliContext)

      assert.equal(uploadPathCalls.length, 1, 'uploadPathUploads should be called once')
      assert.equal(uploadPathCalls[0].serverUrl, 'http://localhost:3000')
    })

    it('passes correct auth to uploadPathUploads', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'push-git-'))
      createdDirs.push(dir)
      process.chdir(dir)

      await mkdir(join(dir, '.git'), {recursive: true})
      await writeFile(join(dir, 'settings.json'), JSON.stringify({path: '/test-doc'}))
      await writeFile(join(dir, 'content.md'), '# Test')

      await pushViaGit(mockCliContext)

      assert.equal(uploadPathCalls[0].auth, mockAuth)
    })
  })

  describe('error handling', () => {
    it('wraps git errors in Push failed message', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'push-git-'))
      createdDirs.push(dir)
      process.chdir(dir)

      await mkdir(join(dir, '.git'), {recursive: true})
      await writeFile(join(dir, 'settings.json'), JSON.stringify({path: '/test-doc'}))
      await writeFile(join(dir, 'content.md'), '# Test')
      mockGitError = new Error('remote: Permission denied')

      await assert.rejects(async () => pushViaGit(mockCliContext), /Push failed.*Permission denied/)
    })
  })

  describe('log output', () => {
    it('logs push flow', async t => {
      const dir = await mkdtemp(join(tmpdir(), 'push-git-'))
      createdDirs.push(dir)
      process.chdir(dir)

      await mkdir(join(dir, '.git'), {recursive: true})
      await writeFile(join(dir, 'settings.json'), JSON.stringify({path: '/test-doc'}))
      await writeFile(join(dir, 'content.md'), '# Test')

      process.removeListener('log', logHandler)
      process.on('log', captureHandler)

      await pushViaGit(mockCliContext)

      process.removeListener('log', captureHandler)
      process.on('log', logHandler)

      t.assert.snapshot(capturedLogs)
    })

    it('logs push with template and slot', async t => {
      const dir = await mkdtemp(join(tmpdir(), 'push-git-'))
      createdDirs.push(dir)
      process.chdir(dir)

      await mkdir(join(dir, '.git'), {recursive: true})
      await writeFile(
        join(dir, 'settings.json'),
        JSON.stringify({path: '/test-doc', template_path: '/test-template', slot_path: '/test-slot'}),
      )
      await writeFile(join(dir, 'content.md'), '# Main')
      await mkdir(join(dir, 'template', '.git'), {recursive: true})
      await writeFile(join(dir, 'template', 'settings.json'), JSON.stringify({path: '/test-template'}))
      await writeFile(join(dir, 'template', 'content.md'), '# Template')
      await mkdir(join(dir, 'slot', '.git'), {recursive: true})
      await writeFile(join(dir, 'slot', 'settings.json'), JSON.stringify({path: '/test-slot'}))
      await writeFile(join(dir, 'slot', 'content.md'), '# Slot')

      process.removeListener('log', logHandler)
      process.on('log', captureHandler)

      await pushViaGit(mockCliContext)

      process.removeListener('log', captureHandler)
      process.on('log', logHandler)

      t.assert.snapshot(capturedLogs.map(l => l.replaceAll(`/private${dir}`, '<tmpdir>').replaceAll(dir, '<tmpdir>')))
    })
  })
})
