import {describe, it, afterEach, mock, beforeEach} from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp, rm, writeFile, mkdir} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createGunzip} from 'node:zlib'
import {extract as tarExtract} from 'tar-stream'

const mockConfig = {
  serverUrl: 'http://localhost:3000',
  username: 'testuser',
  password: 'testpass',
}

const mockAuth = Buffer.from(`${mockConfig.username}:${mockConfig.password}`).toString('base64')

// Track fetch calls
let fetchCalls: Array<{url: string; method: string; body?: unknown}> = []

// Capture log output
let capturedLogs: string[] = []
const logHandler = () => {}
const captureHandler = (...args: unknown[]) => {
  capturedLogs.push(args.slice(1).map(String).join(' '))
}

// Track uploadPathUploads and deletePathUploads calls
let uploadPathCalls: Array<Record<string, unknown>> = []
let deletePathCalls: Array<Record<string, unknown>> = []

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

// Mock inquirer prompts to auto-confirm
mock.module('@inquirer/prompts', {
  namedExports: {
    confirm: async () => true,
  },
})

// Mock populateCache
mock.module('../../../src/cli/utils/populateCache.ts', {
  namedExports: {
    populateCache: async () => {},
  },
})

// Mock uploadPathUploads
mock.module('../../../src/cli/pathOperations/uploadPathUploads.ts', {
  namedExports: {
    uploadPathUploads: async (ctx: Record<string, unknown>) => {
      uploadPathCalls.push(ctx)
    },
  },
})

// Mock deletePathUploads
mock.module('../../../src/cli/pathOperations/deletePathUploads.ts', {
  namedExports: {
    deletePathUploads: async (ctx: Record<string, unknown>) => {
      deletePathCalls.push(ctx)
    },
  },
})

// Import after mocking
const {pushViaTar} = await import('../../../src/cli/utils/pushViaTar.ts')
import {createMockCliContext} from '../test-context.ts'
const mockCliContext = createMockCliContext({authType: 'file'})

/**
 * Extract filenames from a tar.gz buffer
 */
async function extractTarGzFiles(buffer: Buffer): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const gunzip = createGunzip()
    const extract = tarExtract()
    const files: string[] = []

    extract.on('entry', (header, stream, next) => {
      if (header.type === 'file') files.push(header.name)
      stream.resume()
      next()
    })
    extract.on('finish', () => resolve(files))
    extract.on('error', reject)

    gunzip.pipe(extract)
    gunzip.end(buffer)
  })
}

describe('pushViaTar', () => {
  const createdDirs: string[] = []
  let originalFetch: typeof fetch
  let originalCwd: string

  beforeEach(() => {
    originalFetch = globalThis.fetch
    originalCwd = process.cwd()
    fetchCalls = []
    uploadPathCalls = []
    deletePathCalls = []
    capturedLogs = []
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

  describe('basic upload', () => {
    it('uploads document as tar.gz to server', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'push-tar-'))
      createdDirs.push(dir)
      process.chdir(dir)

      await writeFile(join(dir, 'content.md'), '# Hello World')
      await writeFile(join(dir, 'settings.json'), JSON.stringify({path: '/test-doc'}))

      let uploadedBody: ArrayBuffer | null = null

      globalThis.fetch = mock.fn(async (url: string, options?: RequestInit) => {
        const urlStr = String(url)
        fetchCalls.push({url: urlStr, method: options?.method || 'GET', body: options?.body})
        if (options?.body && options?.method === 'POST') {
          uploadedBody = options.body as ArrayBuffer
        }
        if (urlStr.includes('/settings.json')) {
          return new Response(JSON.stringify({uploads: []}), {status: 200})
        }
        return new Response(JSON.stringify({success: true}), {status: 200})
      }) as typeof fetch

      await pushViaTar(mockCliContext, '/test-doc')

      const uploadCall = fetchCalls.find(c => c.url.includes('/edit?update=true'))
      assert.ok(uploadCall, 'should POST to /edit?update=true')
      assert.equal(uploadCall.method, 'POST')
      assert.ok(uploadedBody !== null, 'should have uploaded body')
    })

    it('includes content and settings in tarball', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'push-tar-'))
      createdDirs.push(dir)
      process.chdir(dir)

      await writeFile(join(dir, 'content.md'), '# Hello World')
      await writeFile(join(dir, 'settings.json'), JSON.stringify({path: '/test-doc'}))
      await writeFile(join(dir, 'style.css'), 'body { color: red; }')

      let uploadedBuffer: Buffer | null = null

      globalThis.fetch = mock.fn(async (url: string, options?: RequestInit) => {
        if (options?.body && options?.method === 'POST') {
          uploadedBuffer = Buffer.from(options.body as ArrayBuffer)
        }
        if (String(url).includes('/settings.json')) {
          return new Response(JSON.stringify({uploads: []}), {status: 200})
        }
        return new Response(JSON.stringify({success: true}), {status: 200})
      }) as typeof fetch

      await pushViaTar(mockCliContext, '/test-doc')

      assert.ok(uploadedBuffer, 'tarball should be uploaded')
      const files = await extractTarGzFiles(uploadedBuffer!)
      assert.ok(files.includes('content.md'), 'tarball should contain content.md')
      assert.ok(files.includes('settings.json'), 'tarball should contain settings.json')
      assert.ok(files.includes('style.css'), 'tarball should contain style.css')
    })

    it('sends correct auth header', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'push-tar-'))
      createdDirs.push(dir)
      process.chdir(dir)

      await writeFile(join(dir, 'content.md'), '# Test')
      await writeFile(join(dir, 'settings.json'), JSON.stringify({path: '/test-doc'}))

      let authHeader = ''

      globalThis.fetch = mock.fn(async (url: string, options?: RequestInit) => {
        if (options?.method === 'POST') {
          authHeader = (options?.headers as Record<string, string>)?.Authorization || ''
        }
        if (String(url).includes('/settings.json')) {
          return new Response(JSON.stringify({uploads: []}), {status: 200})
        }
        return new Response(JSON.stringify({success: true}), {status: 200})
      }) as typeof fetch

      await pushViaTar(mockCliContext, '/test-doc')

      assert.equal(authHeader, `Basic ${mockAuth}`, 'should send correct auth header')
    })

    it('sends content-type gzip header', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'push-tar-'))
      createdDirs.push(dir)
      process.chdir(dir)

      await writeFile(join(dir, 'content.md'), '# Test')
      await writeFile(join(dir, 'settings.json'), JSON.stringify({path: '/test-doc'}))

      let contentType = ''

      globalThis.fetch = mock.fn(async (url: string, options?: RequestInit) => {
        if (options?.method === 'POST') {
          contentType = (options?.headers as Record<string, string>)?.['Content-Type'] || ''
        }
        if (String(url).includes('/settings.json')) {
          return new Response(JSON.stringify({uploads: []}), {status: 200})
        }
        return new Response(JSON.stringify({success: true}), {status: 200})
      }) as typeof fetch

      await pushViaTar(mockCliContext, '/test-doc')

      assert.equal(contentType, 'application/gzip', 'should send gzip content type')
    })
  })

  describe('validation errors', () => {
    it('throws when no content file exists', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'push-tar-'))
      createdDirs.push(dir)
      process.chdir(dir)

      await writeFile(join(dir, 'settings.json'), JSON.stringify({path: '/test-doc'}))

      globalThis.fetch = mock.fn(async (url: string) => {
        if (String(url).includes('/settings.json')) {
          return new Response(JSON.stringify({uploads: []}), {status: 200})
        }
        return new Response(JSON.stringify({success: true}), {status: 200})
      }) as typeof fetch

      await assert.rejects(async () => pushViaTar(mockCliContext, '/test-doc'), /No content file found/)
    })

    it('throws when no settings.json exists', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'push-tar-'))
      createdDirs.push(dir)
      process.chdir(dir)

      await assert.rejects(async () => pushViaTar(mockCliContext), /No source argument and no settings.json found/)
    })

    it('throws when template directory exists but template_path is not set', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'push-tar-'))
      createdDirs.push(dir)
      process.chdir(dir)

      await writeFile(join(dir, 'settings.json'), JSON.stringify({path: '/test-doc'}))
      await writeFile(join(dir, 'content.md'), '# Test')
      await mkdir(join(dir, 'template'), {recursive: true})

      await assert.rejects(
        async () => pushViaTar(mockCliContext, '/test-doc'),
        /Template directory exists but template_path is not set/,
      )
    })

    it('throws when slot directory exists but slot_path is not set', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'push-tar-'))
      createdDirs.push(dir)
      process.chdir(dir)

      await writeFile(join(dir, 'settings.json'), JSON.stringify({path: '/test-doc'}))
      await writeFile(join(dir, 'content.md'), '# Test')
      await mkdir(join(dir, 'slot'), {recursive: true})

      await assert.rejects(
        async () => pushViaTar(mockCliContext, '/test-doc'),
        /Slot directory exists but slot_path is not set/,
      )
    })
  })

  describe('server response errors', () => {
    it('throws on 401 authentication failure', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'push-tar-'))
      createdDirs.push(dir)
      process.chdir(dir)

      await writeFile(join(dir, 'content.md'), '# Test')
      await writeFile(join(dir, 'settings.json'), JSON.stringify({path: '/test-doc'}))

      globalThis.fetch = mock.fn(async (url: string, options?: RequestInit) => {
        if (String(url).includes('/settings.json')) {
          return new Response(JSON.stringify({uploads: []}), {status: 200})
        }
        if (options?.method === 'POST') {
          return new Response('Unauthorized', {status: 401})
        }
        return new Response(null, {status: 404})
      }) as typeof fetch

      await assert.rejects(async () => pushViaTar(mockCliContext, '/test-doc'), /Authentication failed/)
    })

    it('throws on 500 server error with error text', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'push-tar-'))
      createdDirs.push(dir)
      process.chdir(dir)

      await writeFile(join(dir, 'content.md'), '# Test')
      await writeFile(join(dir, 'settings.json'), JSON.stringify({path: '/test-doc'}))

      globalThis.fetch = mock.fn(async (url: string, options?: RequestInit) => {
        if (String(url).includes('/settings.json')) {
          return new Response(JSON.stringify({uploads: []}), {status: 200})
        }
        if (options?.method === 'POST') {
          return new Response('Internal Server Error', {status: 500})
        }
        return new Response(null, {status: 404})
      }) as typeof fetch

      await assert.rejects(async () => pushViaTar(mockCliContext, '/test-doc'), /upload failed.*500/)
    })
  })

  describe('template and slot upload', () => {
    it('uploads template and main when template_path is set', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'push-tar-'))
      createdDirs.push(dir)
      process.chdir(dir)

      await writeFile(join(dir, 'settings.json'), JSON.stringify({path: '/test-doc', template_path: '/test-template'}))
      await writeFile(join(dir, 'content.md'), '# Main')
      await mkdir(join(dir, 'template'), {recursive: true})
      await writeFile(join(dir, 'template', 'settings.json'), JSON.stringify({path: '/test-template'}))
      await writeFile(join(dir, 'template', 'content.md'), '# Template')

      const uploadedUrls: string[] = []

      globalThis.fetch = mock.fn(async (url: string, options?: RequestInit) => {
        const urlStr = String(url)
        if (options?.method === 'POST') {
          uploadedUrls.push(urlStr)
        }
        if (urlStr.includes('/settings.json')) {
          return new Response(JSON.stringify({uploads: []}), {status: 200})
        }
        return new Response(JSON.stringify({success: true}), {status: 200})
      }) as typeof fetch

      await pushViaTar(mockCliContext, '/test-doc')

      const templateUpload = uploadedUrls.find(u => u.includes('test-template'))
      const mainUpload = uploadedUrls.find(u => u.includes('test-doc'))
      assert.ok(templateUpload, 'template should be uploaded')
      assert.ok(mainUpload, 'main should be uploaded')
    })

    it('uploads slot and main when slot_path is set', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'push-tar-'))
      createdDirs.push(dir)
      process.chdir(dir)

      await writeFile(join(dir, 'settings.json'), JSON.stringify({path: '/test-doc', slot_path: '/test-slot'}))
      await writeFile(join(dir, 'content.md'), '# Main')
      await mkdir(join(dir, 'slot'), {recursive: true})
      await writeFile(join(dir, 'slot', 'settings.json'), JSON.stringify({path: '/test-slot'}))
      await writeFile(join(dir, 'slot', 'content.md'), '# Slot')

      const uploadedUrls: string[] = []

      globalThis.fetch = mock.fn(async (url: string, options?: RequestInit) => {
        const urlStr = String(url)
        if (options?.method === 'POST') {
          uploadedUrls.push(urlStr)
        }
        if (urlStr.includes('/settings.json')) {
          return new Response(JSON.stringify({uploads: []}), {status: 200})
        }
        return new Response(JSON.stringify({success: true}), {status: 200})
      }) as typeof fetch

      await pushViaTar(mockCliContext, '/test-doc')

      const slotUpload = uploadedUrls.find(u => u.includes('test-slot'))
      const mainUpload = uploadedUrls.find(u => u.includes('test-doc'))
      assert.ok(slotUpload, 'slot should be uploaded')
      assert.ok(mainUpload, 'main should be uploaded')
    })
  })

  describe('upload plan display', () => {
    it('fetches server settings for upload plan', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'push-tar-'))
      createdDirs.push(dir)
      process.chdir(dir)

      await writeFile(join(dir, 'content.md'), '# Test')
      await writeFile(join(dir, 'settings.json'), JSON.stringify({path: '/test-doc'}))

      let fetchedSettingsUrl = ''

      globalThis.fetch = mock.fn(async (url: string, _options?: RequestInit) => {
        const urlStr = String(url)
        if (urlStr.includes('/settings.json')) {
          fetchedSettingsUrl = urlStr
          return new Response(JSON.stringify({uploads: []}), {status: 200})
        }
        return new Response(JSON.stringify({success: true}), {status: 200})
      }) as typeof fetch

      await pushViaTar(mockCliContext, '/test-doc')

      assert.ok(fetchedSettingsUrl.includes('test-doc/settings.json'), 'should fetch server settings')
    })

    it('handles 404 for server settings (new document)', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'push-tar-'))
      createdDirs.push(dir)
      process.chdir(dir)

      await writeFile(join(dir, 'content.md'), '# Test')
      await writeFile(join(dir, 'settings.json'), JSON.stringify({path: '/new-doc'}))

      globalThis.fetch = mock.fn(async (url: string, _options?: RequestInit) => {
        const urlStr = String(url)
        if (urlStr.includes('/settings.json')) {
          return new Response(null, {status: 404})
        }
        return new Response(JSON.stringify({success: true}), {status: 200})
      }) as typeof fetch

      // Should not throw — 404 means "Create" mode in the upload plan
      await pushViaTar(mockCliContext, '/new-doc')
    })
  })

  describe('upload and delete path operations', () => {
    it('calls uploadPathUploads and deletePathUploads after push', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'push-tar-'))
      createdDirs.push(dir)
      process.chdir(dir)

      await writeFile(join(dir, 'content.md'), '# Test')
      await writeFile(join(dir, 'settings.json'), JSON.stringify({path: '/test-doc'}))

      globalThis.fetch = mock.fn(async (url: string) => {
        if (String(url).includes('/settings.json')) {
          return new Response(JSON.stringify({uploads: []}), {status: 200})
        }
        return new Response(JSON.stringify({success: true}), {status: 200})
      }) as typeof fetch

      await pushViaTar(mockCliContext, '/test-doc')

      assert.equal(uploadPathCalls.length, 1, 'uploadPathUploads should be called')
      assert.equal(deletePathCalls.length, 1, 'deletePathUploads should be called')
    })
  })

  describe('optional files', () => {
    it('includes data file in tarball when present', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'push-tar-'))
      createdDirs.push(dir)
      process.chdir(dir)

      await writeFile(join(dir, 'content.md'), '# Test')
      await writeFile(join(dir, 'settings.json'), JSON.stringify({path: '/test-doc'}))
      await writeFile(join(dir, 'data.yaml'), 'key: value')

      let uploadedBuffer: Buffer | null = null

      globalThis.fetch = mock.fn(async (url: string, options?: RequestInit) => {
        if (options?.body && options?.method === 'POST') {
          uploadedBuffer = Buffer.from(options.body as ArrayBuffer)
        }
        if (String(url).includes('/settings.json')) {
          return new Response(JSON.stringify({uploads: []}), {status: 200})
        }
        return new Response(JSON.stringify({success: true}), {status: 200})
      }) as typeof fetch

      await pushViaTar(mockCliContext, '/test-doc')

      assert.ok(uploadedBuffer, 'tarball should be uploaded')
      const files = await extractTarGzFiles(uploadedBuffer!)
      assert.ok(files.includes('data.yaml'), 'tarball should contain data.yaml')
    })

    it('includes server.js and script.js when present', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'push-tar-'))
      createdDirs.push(dir)
      process.chdir(dir)

      await writeFile(join(dir, 'content.md'), '# Test')
      await writeFile(join(dir, 'settings.json'), JSON.stringify({path: '/test-doc'}))
      await writeFile(join(dir, 'server.js'), 'module.exports = {}')
      await writeFile(join(dir, 'script.js'), 'console.log("hi")')

      let uploadedBuffer: Buffer | null = null

      globalThis.fetch = mock.fn(async (url: string, options?: RequestInit) => {
        if (options?.body && options?.method === 'POST') {
          uploadedBuffer = Buffer.from(options.body as ArrayBuffer)
        }
        if (String(url).includes('/settings.json')) {
          return new Response(JSON.stringify({uploads: []}), {status: 200})
        }
        return new Response(JSON.stringify({success: true}), {status: 200})
      }) as typeof fetch

      await pushViaTar(mockCliContext, '/test-doc')

      const files = await extractTarGzFiles(uploadedBuffer!)
      assert.ok(files.includes('server.js'), 'tarball should contain server.js')
      assert.ok(files.includes('script.js'), 'tarball should contain script.js')
    })
  })

  describe('log output', () => {
    it('logs push flow', async t => {
      const dir = await mkdtemp(join(tmpdir(), 'push-tar-'))
      createdDirs.push(dir)
      process.chdir(dir)

      await writeFile(join(dir, 'content.md'), '# Test')
      await writeFile(join(dir, 'settings.json'), JSON.stringify({path: '/test-doc'}))

      globalThis.fetch = mock.fn(async (url: string) => {
        if (String(url).includes('/settings.json')) {
          return new Response(JSON.stringify({uploads: []}), {status: 200})
        }
        return new Response(JSON.stringify({success: true}), {status: 200})
      }) as typeof fetch

      process.removeListener('log', logHandler)
      process.on('log', captureHandler)

      await pushViaTar(mockCliContext, '/test-doc')

      process.removeListener('log', captureHandler)
      process.on('log', logHandler)

      t.assert.snapshot(capturedLogs)
    })

    it('logs push with template and slot', async t => {
      const dir = await mkdtemp(join(tmpdir(), 'push-tar-'))
      createdDirs.push(dir)
      process.chdir(dir)

      await writeFile(
        join(dir, 'settings.json'),
        JSON.stringify({path: '/test-doc', template_path: '/test-template', slot_path: '/test-slot'}),
      )
      await writeFile(join(dir, 'content.md'), '# Main')
      await mkdir(join(dir, 'template'), {recursive: true})
      await writeFile(join(dir, 'template', 'settings.json'), JSON.stringify({path: '/test-template'}))
      await writeFile(join(dir, 'template', 'content.md'), '# Template')
      await mkdir(join(dir, 'slot'), {recursive: true})
      await writeFile(join(dir, 'slot', 'settings.json'), JSON.stringify({path: '/test-slot'}))
      await writeFile(join(dir, 'slot', 'content.md'), '# Slot')

      globalThis.fetch = mock.fn(async (url: string) => {
        if (String(url).includes('/settings.json')) {
          return new Response(JSON.stringify({uploads: []}), {status: 200})
        }
        return new Response(JSON.stringify({success: true}), {status: 200})
      }) as typeof fetch

      process.removeListener('log', logHandler)
      process.on('log', captureHandler)

      await pushViaTar(mockCliContext, '/test-doc')

      process.removeListener('log', captureHandler)
      process.on('log', logHandler)

      t.assert.snapshot(capturedLogs.map(l => l.replaceAll(`/private${dir}`, '<tmpdir>').replaceAll(dir, '<tmpdir>')))
    })

    it('logs new document (404 server settings)', async t => {
      const dir = await mkdtemp(join(tmpdir(), 'push-tar-'))
      createdDirs.push(dir)
      process.chdir(dir)

      await writeFile(join(dir, 'content.md'), '# Test')
      await writeFile(join(dir, 'settings.json'), JSON.stringify({path: '/new-doc'}))

      globalThis.fetch = mock.fn(async (url: string) => {
        if (String(url).includes('/settings.json')) {
          return new Response(null, {status: 404})
        }
        return new Response(JSON.stringify({success: true}), {status: 200})
      }) as typeof fetch

      process.removeListener('log', logHandler)
      process.on('log', captureHandler)

      await pushViaTar(mockCliContext, '/new-doc')

      process.removeListener('log', captureHandler)
      process.on('log', logHandler)

      t.assert.snapshot(capturedLogs)
    })
  })

  describe('URL construction', () => {
    it('constructs correct upload URL with normalized path', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'push-tar-'))
      createdDirs.push(dir)
      process.chdir(dir)

      await writeFile(join(dir, 'content.md'), '# Test')
      await writeFile(join(dir, 'settings.json'), JSON.stringify({path: '/my-doc'}))

      const postUrls: string[] = []

      globalThis.fetch = mock.fn(async (url: string, options?: RequestInit) => {
        const urlStr = String(url)
        if (options?.method === 'POST') {
          postUrls.push(urlStr)
        }
        if (urlStr.includes('/settings.json')) {
          return new Response(JSON.stringify({uploads: []}), {status: 200})
        }
        return new Response(JSON.stringify({success: true}), {status: 200})
      }) as typeof fetch

      await pushViaTar(mockCliContext, '/my-doc')

      const editUrl = postUrls.find(u => u.includes('/edit'))
      assert.ok(editUrl, 'should have a POST to edit URL')
      assert.ok(editUrl!.includes('my-doc/edit?update=true'), 'URL should include normalized path')
    })
  })
})
