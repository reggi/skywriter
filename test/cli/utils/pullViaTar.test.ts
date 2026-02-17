import {describe, it, afterEach, mock, beforeEach} from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp, rm, writeFile, readFile, access as fsAccess} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createGzip} from 'node:zlib'
import {pack} from 'tar-stream'
import {promisify} from 'node:util'

const mockConfig = {
  serverUrl: 'http://localhost:3000',
  username: 'testuser',
  password: 'testpass',
}

// Track git commands
let gitCommands: Array<{cmd: string; cwd?: string}> = []

// Suppress proc-log output during tests
const logHandler = () => {}

// Capture log output
let capturedLogs: string[] = []
const captureHandler = (...args: unknown[]) => {
  capturedLogs.push(args.slice(1).map(String).join(' '))
}

// Control mock behavior
let mockGitInstalled = true

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
        return JSON.stringify({active: mockServerKey, servers: {[mockServerKey]: {password: mockConfig.password}}})
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

// Mock populateCache
mock.module('../../../src/cli/utils/populateCache.ts', {
  namedExports: {
    populateCache: async () => {},
  },
})

// Mock downloadPathUploads
mock.module('../../../src/cli/pathOperations/downloadPathUploads.ts', {
  namedExports: {
    downloadPathUploads: async () => {},
  },
})

// Mock @inquirer/prompts
mock.module('@inquirer/prompts', {
  namedExports: {
    confirm: async () => true,
  },
})

// Helper to get mock exec result for git commands within pullPathViaTar
function getMockExecResult(cmd: string, _options: Record<string, unknown>): {stdout: string; stderr: string} | Error {
  // git status --porcelain (check uncommitted changes)
  if (cmd.includes('git status --porcelain')) {
    return {stdout: '', stderr: ''}
  }
  // git remote get-url origin (check for remote)
  if (cmd.includes('git remote get-url origin')) {
    return new Error('fatal: No such remote')
  }
  return {stdout: '', stderr: ''}
}

// Create exec mock
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

// Mock child_process
mock.module('node:child_process', {
  namedExports: {
    exec: mockExec,
    execFile: (
      _file: string,
      _args: string[],
      callback?: (error: Error | null, result: {stdout: string; stderr: string}) => void,
    ) => {
      if (callback) callback(null, {stdout: '', stderr: ''})
      return {stdin: {write: () => {}, end: () => {}}, on: () => ({})}
    },
    spawn: () => ({on: () => {}, stdout: {on: () => {}}, stderr: {on: () => {}}}),
    spawnSync: () => ({status: 0, stdout: '', stderr: ''}),
  },
})

// Import after mocking
const {pullViaTar} = await import('../../../src/cli/utils/pullViaTar.ts')
import {createMockCliContext} from '../test-context.ts'
const mockCliContext = createMockCliContext()

async function pathExists(path: string): Promise<boolean> {
  try {
    await fsAccess(path)
    return true
  } catch {
    return false
  }
}

/**
 * Create a tar.gz buffer with the given files
 */
async function createTarGz(files: Record<string, string>): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const tarPack = pack()
    const gzip = createGzip()
    const chunks: Buffer[] = []

    gzip.on('data', (chunk: Buffer) => chunks.push(chunk))
    gzip.on('end', () => resolve(Buffer.concat(chunks)))
    gzip.on('error', reject)

    tarPack.pipe(gzip)

    for (const [name, content] of Object.entries(files)) {
      tarPack.entry({name}, content)
    }

    tarPack.finalize()
  })
}

describe('pullViaTar', () => {
  const createdDirs: string[] = []
  let originalFetch: typeof fetch
  let originalCwd: string

  beforeEach(() => {
    originalFetch = globalThis.fetch
    originalCwd = process.cwd()
    gitCommands = []
    capturedLogs = []
    mockGitInstalled = true
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

  describe('basic pull', () => {
    it('fetches and extracts a document to a new directory', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'pull-tar-'))
      createdDirs.push(dir)
      process.chdir(dir)

      const tarGzBuffer = await createTarGz({
        'settings.json': JSON.stringify({path: '/test-doc', title: 'Test'}),
        'content.eta': '# Hello World',
        'style.css': 'body { color: red; }',
      })

      globalThis.fetch = mock.fn(async (url: string) => {
        if (String(url).includes('/archive.tar.gz')) {
          return new Response(tarGzBuffer, {status: 200})
        }
        return new Response(null, {status: 404})
      }) as typeof fetch

      await pullViaTar(mockCliContext, '/test-doc')

      // Files should be extracted to test-doc directory
      const dest = join(dir, 'test-doc')
      assert.equal(await pathExists(join(dest, 'settings.json')), true)
      assert.equal(await pathExists(join(dest, 'content.eta')), true)
      assert.equal(await pathExists(join(dest, 'style.css')), true)

      // Verify content
      const settings = JSON.parse(await readFile(join(dest, 'settings.json'), 'utf-8'))
      assert.equal(settings.path, '/test-doc')
      const content = await readFile(join(dest, 'content.eta'), 'utf-8')
      assert.equal(content, '# Hello World')
    })

    it('fetches and extracts into current dir in update mode', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'pull-tar-'))
      createdDirs.push(dir)
      process.chdir(dir)

      await writeFile(join(dir, 'settings.json'), JSON.stringify({path: '/test-doc'}))
      await writeFile(join(dir, 'content.eta'), '# Old content')

      const tarGzBuffer = await createTarGz({
        'settings.json': JSON.stringify({path: '/test-doc'}),
        'content.eta': '# New content',
      })

      globalThis.fetch = mock.fn(async (url: string) => {
        if (String(url).includes('/archive.tar.gz')) {
          return new Response(tarGzBuffer, {status: 200})
        }
        return new Response(null, {status: 404})
      }) as typeof fetch

      await pullViaTar(mockCliContext)

      const content = await readFile(join(dir, 'content.eta'), 'utf-8')
      assert.equal(content, '# New content')
    })

    it('uses custom destination when provided', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'pull-tar-'))
      createdDirs.push(dir)
      process.chdir(dir)

      const tarGzBuffer = await createTarGz({
        'settings.json': JSON.stringify({path: '/test-doc'}),
        'content.eta': '# Hello',
      })

      globalThis.fetch = mock.fn(async (url: string) => {
        if (String(url).includes('/archive.tar.gz')) {
          return new Response(tarGzBuffer, {status: 200})
        }
        return new Response(null, {status: 404})
      }) as typeof fetch

      await pullViaTar(mockCliContext, '/test-doc', 'my-folder')

      assert.equal(await pathExists(join(dir, 'my-folder', 'content.eta')), true)
    })
  })

  describe('error handling', () => {
    it('throws when no source and no settings.json', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'pull-tar-'))
      createdDirs.push(dir)
      process.chdir(dir)

      await assert.rejects(async () => pullViaTar(mockCliContext), /No source argument and no settings.json found/)
    })

    it('throws on server error', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'pull-tar-'))
      createdDirs.push(dir)
      process.chdir(dir)

      globalThis.fetch = mock.fn(async () => {
        return new Response('Server Error', {status: 500, statusText: 'Internal Server Error'})
      }) as typeof fetch

      await assert.rejects(async () => pullViaTar(mockCliContext, '/test-doc'), /pull failed.*Failed to download: 500/)
    })

    it('throws on no response body', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'pull-tar-'))
      createdDirs.push(dir)
      process.chdir(dir)

      globalThis.fetch = mock.fn(async () => {
        return new Response(null, {status: 200})
      }) as typeof fetch

      await assert.rejects(async () => pullViaTar(mockCliContext, '/test-doc'), /pull failed.*No response body/)
    })

    it('handles 404 archive gracefully (warns and skips)', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'pull-tar-'))
      createdDirs.push(dir)
      process.chdir(dir)

      globalThis.fetch = mock.fn(async () => {
        return new Response(null, {status: 404})
      }) as typeof fetch

      process.removeListener('log', logHandler)
      process.on('log', captureHandler)

      // Should not throw — 404 skips gracefully
      await pullViaTar(mockCliContext, '/test-doc')

      process.removeListener('log', captureHandler)
      process.on('log', logHandler)

      assert.ok(
        capturedLogs.some(l => l.includes('not found')),
        'should warn about missing archive',
      )
    })
  })

  describe('already up to date', () => {
    it('shows "already up to date" when files are identical', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'pull-tar-'))
      createdDirs.push(dir)
      process.chdir(dir)

      const settingsContent = JSON.stringify({path: '/test-doc'})
      const contentText = '# Hello World'
      await writeFile(join(dir, 'settings.json'), settingsContent)
      await writeFile(join(dir, 'content.eta'), contentText)

      const tarGzBuffer = await createTarGz({
        'settings.json': settingsContent,
        'content.eta': contentText,
      })

      globalThis.fetch = mock.fn(async (url: string) => {
        if (String(url).includes('/archive.tar.gz')) {
          return new Response(tarGzBuffer, {status: 200})
        }
        return new Response(null, {status: 404})
      }) as typeof fetch

      process.removeListener('log', logHandler)
      process.on('log', captureHandler)

      await pullViaTar(mockCliContext)

      process.removeListener('log', captureHandler)
      process.on('log', logHandler)

      assert.ok(
        capturedLogs.some(l => l.includes('up to date')),
        'should show up to date message',
      )
    })
  })

  describe('git integration', () => {
    it('runs git init and commit on fresh pull (default git=true)', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'pull-tar-'))
      createdDirs.push(dir)
      process.chdir(dir)

      const tarGzBuffer = await createTarGz({
        'settings.json': JSON.stringify({path: '/test-doc'}),
        'content.eta': '# Hello',
      })

      globalThis.fetch = mock.fn(async (url: string) => {
        if (String(url).includes('/archive.tar.gz')) {
          return new Response(tarGzBuffer, {status: 200})
        }
        return new Response(null, {status: 404})
      }) as typeof fetch

      await pullViaTar(mockCliContext, '/test-doc')

      const initCmd = gitCommands.find(c => c.cmd.includes('git init'))
      assert.ok(initCmd, 'should run git init')

      const commitCmd = gitCommands.find(c => c.cmd.includes('git commit'))
      assert.ok(commitCmd, 'should run git commit')
    })

    it('skips git operations when git option is false (--no-git)', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'pull-tar-'))
      createdDirs.push(dir)
      process.chdir(dir)

      const tarGzBuffer = await createTarGz({
        'settings.json': JSON.stringify({path: '/test-doc'}),
        'content.eta': '# Hello',
      })

      globalThis.fetch = mock.fn(async (url: string) => {
        if (String(url).includes('/archive.tar.gz')) {
          return new Response(tarGzBuffer, {status: 200})
        }
        return new Response(null, {status: 404})
      }) as typeof fetch

      await pullViaTar(mockCliContext, '/test-doc', undefined, {git: false})

      const initCmd = gitCommands.find(c => c.cmd.includes('git init'))
      assert.equal(initCmd, undefined, 'should NOT run git init with --no-git')

      const commitCmd = gitCommands.find(c => c.cmd.includes('git commit'))
      assert.equal(commitCmd, undefined, 'should NOT run git commit with --no-git')
    })

    it('creates .gitignore on fresh init', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'pull-tar-'))
      createdDirs.push(dir)
      process.chdir(dir)

      const tarGzBuffer = await createTarGz({
        'settings.json': JSON.stringify({path: '/test-doc'}),
        'content.eta': '# Hello',
      })

      globalThis.fetch = mock.fn(async (url: string) => {
        if (String(url).includes('/archive.tar.gz')) {
          return new Response(tarGzBuffer, {status: 200})
        }
        return new Response(null, {status: 404})
      }) as typeof fetch

      await pullViaTar(mockCliContext, '/test-doc')

      const dest = join(dir, 'test-doc')
      assert.equal(await pathExists(join(dest, '.gitignore')), true, 'should create .gitignore')

      const gitignore = await readFile(join(dest, '.gitignore'), 'utf-8')
      assert.ok(gitignore.includes('settings.json'), '.gitignore should include settings.json')
      assert.ok(gitignore.includes('content.*'), '.gitignore should include content.*')
    })
  })

  describe('template and slot', () => {
    it('pulls template and slot sub-repos via harness', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'pull-tar-'))
      createdDirs.push(dir)
      process.chdir(dir)

      const mainArchive = await createTarGz({
        'settings.json': JSON.stringify({
          path: '/test-doc',
          template_path: '/my-template',
          slot_path: '/my-slot',
        }),
        'content.eta': '# Main Content',
      })

      const templateArchive = await createTarGz({
        'settings.json': JSON.stringify({path: '/my-template'}),
        'content.eta': '# Template Content',
      })

      const slotArchive = await createTarGz({
        'settings.json': JSON.stringify({path: '/my-slot'}),
        'content.eta': '# Slot Content',
      })

      globalThis.fetch = mock.fn(async (url: string) => {
        const urlStr = String(url)
        if (urlStr.includes('test-doc/archive.tar.gz')) {
          return new Response(mainArchive, {status: 200})
        }
        if (urlStr.includes('my-template/archive.tar.gz')) {
          return new Response(templateArchive, {status: 200})
        }
        if (urlStr.includes('my-slot/archive.tar.gz')) {
          return new Response(slotArchive, {status: 200})
        }
        return new Response(null, {status: 404})
      }) as typeof fetch

      await pullViaTar(mockCliContext, '/test-doc')

      const dest = join(dir, 'test-doc')
      assert.equal(await pathExists(join(dest, 'content.eta')), true, 'main content should exist')
      assert.equal(await pathExists(join(dest, 'template', 'content.eta')), true, 'template content should exist')
      assert.equal(await pathExists(join(dest, 'slot', 'content.eta')), true, 'slot content should exist')

      const templateContent = await readFile(join(dest, 'template', 'content.eta'), 'utf-8')
      assert.equal(templateContent, '# Template Content')

      const slotContent = await readFile(join(dest, 'slot', 'content.eta'), 'utf-8')
      assert.equal(slotContent, '# Slot Content')
    })

    it('handles template archive 404 gracefully', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'pull-tar-'))
      createdDirs.push(dir)
      process.chdir(dir)

      const mainArchive = await createTarGz({
        'settings.json': JSON.stringify({
          path: '/test-doc',
          template_path: '/missing-template',
        }),
        'content.eta': '# Main Content',
      })

      globalThis.fetch = mock.fn(async (url: string) => {
        const urlStr = String(url)
        if (urlStr.includes('test-doc/archive.tar.gz')) {
          return new Response(mainArchive, {status: 200})
        }
        if (urlStr.includes('missing-template/archive.tar.gz')) {
          return new Response(null, {status: 404})
        }
        return new Response(null, {status: 404})
      }) as typeof fetch

      // Should not throw
      await pullViaTar(mockCliContext, '/test-doc')

      const dest = join(dir, 'test-doc')
      assert.equal(await pathExists(join(dest, 'content.eta')), true, 'main content should exist')
    })
  })

  describe('change detection', () => {
    it('detects new files', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'pull-tar-'))
      createdDirs.push(dir)
      process.chdir(dir)

      // Start with just settings.json and content
      await writeFile(join(dir, 'settings.json'), JSON.stringify({path: '/test-doc'}))
      await writeFile(join(dir, 'content.eta'), '# Hello')

      const tarGzBuffer = await createTarGz({
        'settings.json': JSON.stringify({path: '/test-doc'}),
        'content.eta': '# Hello',
        'style.css': 'body { color: blue; }',
      })

      globalThis.fetch = mock.fn(async (url: string) => {
        if (String(url).includes('/archive.tar.gz')) {
          return new Response(tarGzBuffer, {status: 200})
        }
        return new Response(null, {status: 404})
      }) as typeof fetch

      process.removeListener('log', logHandler)
      process.on('log', captureHandler)

      await pullViaTar(mockCliContext)

      process.removeListener('log', captureHandler)
      process.on('log', logHandler)

      // New style.css should be detected
      assert.ok(
        capturedLogs.some(l => l.includes('style.css')),
        'should log new file',
      )
      assert.ok(
        capturedLogs.some(l => l.includes('new')),
        'should indicate file is new',
      )
    })

    it('detects modified files', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'pull-tar-'))
      createdDirs.push(dir)
      process.chdir(dir)

      await writeFile(join(dir, 'settings.json'), JSON.stringify({path: '/test-doc'}))
      await writeFile(join(dir, 'content.eta'), '# Old content')

      const tarGzBuffer = await createTarGz({
        'settings.json': JSON.stringify({path: '/test-doc'}),
        'content.eta': '# New content',
      })

      globalThis.fetch = mock.fn(async (url: string) => {
        if (String(url).includes('/archive.tar.gz')) {
          return new Response(tarGzBuffer, {status: 200})
        }
        return new Response(null, {status: 404})
      }) as typeof fetch

      process.removeListener('log', logHandler)
      process.on('log', captureHandler)

      await pullViaTar(mockCliContext)

      process.removeListener('log', captureHandler)
      process.on('log', logHandler)

      assert.ok(
        capturedLogs.some(l => l.includes('content.eta')),
        'should log modified file',
      )
      assert.ok(
        capturedLogs.some(l => l.includes('modified')),
        'should indicate file is modified',
      )
    })
  })

  describe('uploads in settings', () => {
    it('downloads uploads from server when listed in extracted settings', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'pull-tar-'))
      createdDirs.push(dir)
      process.chdir(dir)

      const tarGzBuffer = await createTarGz({
        'settings.json': JSON.stringify({path: '/test-doc', uploads: ['image.png']}),
        'content.eta': '# Content',
      })

      let uploadRequested = false

      globalThis.fetch = mock.fn(async (url: string) => {
        const urlStr = String(url)
        if (urlStr.includes('/archive.tar.gz')) {
          return new Response(tarGzBuffer, {status: 200})
        }
        if (urlStr.includes('/uploads/image.png')) {
          uploadRequested = true
          return new Response(Buffer.from('fake-image-data'), {status: 200})
        }
        return new Response(null, {status: 404})
      }) as typeof fetch

      await pullViaTar(mockCliContext, '/test-doc')

      assert.ok(uploadRequested, 'should request upload file from server')
    })
  })

  describe('log output', () => {
    const normalizeLogs = (logs: string[]) =>
      logs.map(l => l.replace(/Archive: \d+ B \([a-f0-9]+\)/, 'Archive: <size> (<hash>)'))

    /** Group parallel logs by path so snapshot order is deterministic */
    const normalizeParallelLogs = (logs: string[]) => {
      const normalized = normalizeLogs(logs)
      // Split into: header (no path prefix), then path-grouped sections
      const header: string[] = []
      const groups = new Map<string, string[]>()
      const groupOrder: string[] = []
      for (const line of normalized) {
        // Match path prefix like "/test-doc" or "/my-template"
        const m = line.match(/pull (\/[^\s]+)/)
        if (m) {
          const path = m[1]
          if (!groups.has(path)) {
            groups.set(path, [])
            groupOrder.push(path)
          }
          groups.get(path)!.push(line)
        } else {
          if (groups.size === 0) {
            header.push(line)
          } else {
            // Trailing line after all groups — add to a special tail
            if (!groups.has('__tail__')) {
              groups.set('__tail__', [])
              groupOrder.push('__tail__')
            }
            groups.get('__tail__')!.push(line)
          }
        }
      }
      // Keep first group (main doc, runs sequentially) in place, sort the rest
      const [first, ...rest] = groupOrder.filter(k => k !== '__tail__')
      const sortedKeys = [first, ...rest.sort()]
      if (groupOrder.includes('__tail__')) sortedKeys.push('__tail__')
      return [...header, ...sortedKeys.flatMap(k => groups.get(k)!)]
    }

    it('logs clone flow', async t => {
      const dir = await mkdtemp(join(tmpdir(), 'pull-tar-'))
      createdDirs.push(dir)
      process.chdir(dir)

      const tarGzBuffer = await createTarGz({
        'settings.json': JSON.stringify({path: '/test-doc'}),
        'content.eta': '# Hello',
      })

      globalThis.fetch = mock.fn(async (url: string) => {
        if (String(url).includes('/archive.tar.gz')) {
          return new Response(tarGzBuffer, {status: 200})
        }
        return new Response(null, {status: 404})
      }) as typeof fetch

      process.removeListener('log', logHandler)
      process.on('log', captureHandler)

      await pullViaTar(mockCliContext, '/test-doc')

      process.removeListener('log', captureHandler)
      process.on('log', logHandler)

      t.assert.snapshot(normalizeLogs(capturedLogs))
    })

    it('logs update flow with changes', async t => {
      const dir = await mkdtemp(join(tmpdir(), 'pull-tar-'))
      createdDirs.push(dir)
      process.chdir(dir)

      await writeFile(join(dir, 'settings.json'), JSON.stringify({path: '/test-doc'}))
      await writeFile(join(dir, 'content.eta'), '# Old content')

      const tarGzBuffer = await createTarGz({
        'settings.json': JSON.stringify({path: '/test-doc'}),
        'content.eta': '# New content',
      })

      globalThis.fetch = mock.fn(async (url: string) => {
        if (String(url).includes('/archive.tar.gz')) {
          return new Response(tarGzBuffer, {status: 200})
        }
        return new Response(null, {status: 404})
      }) as typeof fetch

      process.removeListener('log', logHandler)
      process.on('log', captureHandler)

      await pullViaTar(mockCliContext)

      process.removeListener('log', captureHandler)
      process.on('log', logHandler)

      t.assert.snapshot(normalizeLogs(capturedLogs))
    })

    it('logs already up to date', async t => {
      const dir = await mkdtemp(join(tmpdir(), 'pull-tar-'))
      createdDirs.push(dir)
      process.chdir(dir)

      const settingsContent = JSON.stringify({path: '/test-doc'})
      const contentText = '# Hello World'
      await writeFile(join(dir, 'settings.json'), settingsContent)
      await writeFile(join(dir, 'content.eta'), contentText)

      const tarGzBuffer = await createTarGz({
        'settings.json': settingsContent,
        'content.eta': contentText,
      })

      globalThis.fetch = mock.fn(async (url: string) => {
        if (String(url).includes('/archive.tar.gz')) {
          return new Response(tarGzBuffer, {status: 200})
        }
        return new Response(null, {status: 404})
      }) as typeof fetch

      process.removeListener('log', logHandler)
      process.on('log', captureHandler)

      await pullViaTar(mockCliContext)

      process.removeListener('log', captureHandler)
      process.on('log', logHandler)

      t.assert.snapshot(normalizeLogs(capturedLogs))
    })

    it('logs clone with template and slot', async t => {
      const dir = await mkdtemp(join(tmpdir(), 'pull-tar-'))
      createdDirs.push(dir)
      process.chdir(dir)

      const mainArchive = await createTarGz({
        'settings.json': JSON.stringify({
          path: '/test-doc',
          template_path: '/my-template',
          slot_path: '/my-slot',
        }),
        'content.eta': '# Main Content',
      })

      const templateArchive = await createTarGz({
        'settings.json': JSON.stringify({path: '/my-template'}),
        'content.eta': '# Template Content',
      })

      const slotArchive = await createTarGz({
        'settings.json': JSON.stringify({path: '/my-slot'}),
        'content.eta': '# Slot Content',
      })

      globalThis.fetch = mock.fn(async (url: string) => {
        const urlStr = String(url)
        if (urlStr.includes('test-doc/archive.tar.gz')) {
          return new Response(mainArchive, {status: 200})
        }
        if (urlStr.includes('my-template/archive.tar.gz')) {
          return new Response(templateArchive, {status: 200})
        }
        if (urlStr.includes('my-slot/archive.tar.gz')) {
          return new Response(slotArchive, {status: 200})
        }
        return new Response(null, {status: 404})
      }) as typeof fetch

      process.removeListener('log', logHandler)
      process.on('log', captureHandler)

      await pullViaTar(mockCliContext, '/test-doc')

      process.removeListener('log', captureHandler)
      process.on('log', logHandler)

      t.assert.snapshot(normalizeParallelLogs(capturedLogs))
    })
  })

  describe('URL construction', () => {
    it('constructs correct archive URL', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'pull-tar-'))
      createdDirs.push(dir)
      process.chdir(dir)

      const tarGzBuffer = await createTarGz({
        'settings.json': JSON.stringify({path: '/my-doc'}),
        'content.eta': '# Hello',
      })

      let requestedUrl = ''

      globalThis.fetch = mock.fn(async (url: string) => {
        const urlStr = String(url)
        if (urlStr.includes('/archive.tar.gz')) {
          requestedUrl = urlStr
          return new Response(tarGzBuffer, {status: 200})
        }
        return new Response(null, {status: 404})
      }) as typeof fetch

      await pullViaTar(mockCliContext, '/my-doc')

      assert.ok(requestedUrl.includes('my-doc/archive.tar.gz'), 'archive URL should include normalized path')
      assert.ok(!requestedUrl.includes('//my-doc'), 'archive URL should not have double slashes')
    })

    it('handles paths without leading slash', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'pull-tar-'))
      createdDirs.push(dir)
      process.chdir(dir)

      const tarGzBuffer = await createTarGz({
        'settings.json': JSON.stringify({path: '/bare-name'}),
        'content.eta': '# Hello',
      })

      let requestedUrl = ''

      globalThis.fetch = mock.fn(async (url: string) => {
        const urlStr = String(url)
        if (urlStr.includes('/archive.tar.gz')) {
          requestedUrl = urlStr
          return new Response(tarGzBuffer, {status: 200})
        }
        return new Response(null, {status: 404})
      }) as typeof fetch

      await pullViaTar(mockCliContext, 'bare-name')

      assert.ok(requestedUrl.includes('bare-name/archive.tar.gz'), 'should handle bare name source')
    })
  })

  describe('git option validation', () => {
    it('throws when git=true but git is not installed', async () => {
      mockGitInstalled = false

      await assert.rejects(
        async () => pullViaTar(mockCliContext, '/test-doc', undefined, {git: true}),
        /Git is not installed/,
      )
    })

    it('does not check git installation when git option is not set', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'pull-tar-'))
      createdDirs.push(dir)
      process.chdir(dir)

      mockGitInstalled = false

      const tarGzBuffer = await createTarGz({
        'settings.json': JSON.stringify({path: '/test-doc'}),
        'content.eta': '# Hello',
      })

      globalThis.fetch = mock.fn(async (url: string) => {
        if (String(url).includes('/archive.tar.gz')) {
          return new Response(tarGzBuffer, {status: 200})
        }
        return new Response(null, {status: 404})
      }) as typeof fetch

      // Should not throw even though git is not installed (default git=true in pullPathViaTar
      // but the check in pullViaTar only triggers when options.git is explicitly true)
      await pullViaTar(mockCliContext, '/test-doc')
    })
  })
})
