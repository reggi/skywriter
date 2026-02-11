import {describe, it, afterEach, beforeEach, mock} from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp, rm, writeFile, mkdir} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createHash} from 'node:crypto'
import type {PathContext} from '../../../src/cli/utils/pageContext.ts'
import {createPrefixLog} from '../../../src/cli/utils/prefixLog.ts'

// Track fetch calls
let fetchCalls: Array<{url: string; method: string; body?: unknown}> = []
let mockFetchResponses: Map<string, {status: number; body?: unknown; ok: boolean}> = new Map()

// Mock cliName module
mock.module('../../../src/cli/utils/cliName.ts', {
  namedExports: {
    getCliName: () => 'wondoc',
    getCliId: () => 'wondoc',
  },
})

// Import after mocking
const {downloadPathUploads} = await import('../../../src/cli/pathOperations/downloadPathUploads.ts')
const {uploadPathUploads} = await import('../../../src/cli/pathOperations/uploadPathUploads.ts')
const {deletePathUploads} = await import('../../../src/cli/pathOperations/deletePathUploads.ts')

// Capture proc-log output (proc-log emits events on process)
let consoleOutput: string[] = []

// Handler for proc-log events
const logHandler = (...args: unknown[]) => {
  const messageParts = args.slice(1)
  consoleOutput.push(messageParts.map(String).join(' '))
}

function makeCtx(overrides: Partial<PathContext> & {uploadsDir?: string}): PathContext {
  return {
    reference: 'main',
    path: '/docs',
    normalizedPath: 'docs',
    serverUrl: 'https://example.com',
    auth: 'auth123',
    settings: {},
    dir: '.',
    log: createPrefixLog('test', 'test'),
    ...overrides,
  } as PathContext
}

describe('path-uploads', () => {
  const createdDirs: string[] = []
  let originalFetch: typeof fetch

  beforeEach(() => {
    consoleOutput = []
    fetchCalls = []
    mockFetchResponses = new Map()
    originalFetch = globalThis.fetch

    // Listen for proc-log events
    process.on('log', logHandler)

    // Default mock fetch
    globalThis.fetch = mock.fn(async (url: string | URL, options?: RequestInit) => {
      const urlStr = url.toString()
      const method = options?.method || 'GET'
      fetchCalls.push({url: urlStr, method, body: options?.body})

      const response = mockFetchResponses.get(urlStr)
      if (response) {
        return new Response(response.body ? JSON.stringify(response.body) : null, {
          status: response.status,
          headers: {'Content-Type': 'application/json'},
        })
      }

      // Default: 200 OK with success response for POST to /edit (uploads)
      if (method === 'POST' && urlStr.includes('/edit')) {
        return new Response(JSON.stringify({success: true}), {
          status: 200,
          headers: {'Content-Type': 'application/json'},
        })
      }

      // Default: 200 OK with empty body
      return new Response(null, {status: 200})
    }) as typeof fetch
  })

  afterEach(async () => {
    process.removeListener('log', logHandler)
    globalThis.fetch = originalFetch

    await Promise.all(
      createdDirs.splice(0).map(async dir => {
        await rm(dir, {recursive: true, force: true})
      }),
    )
  })

  describe('downloadPathUploads', () => {
    it('does nothing when settings has no uploads', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'wondoc-sync-'))
      createdDirs.push(dir)

      await downloadPathUploads(makeCtx({settings: {path: '/docs'}, dir}))

      assert.equal(fetchCalls.length, 0)
    })

    it('does nothing when uploads array is empty', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'wondoc-sync-'))
      createdDirs.push(dir)

      await downloadPathUploads(makeCtx({settings: {path: '/docs', uploads: []}, dir}))

      assert.equal(fetchCalls.length, 0)
    })

    it('reports all uploads up to date when all exist locally', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'wondoc-sync-'))
      createdDirs.push(dir)
      const uploadsDir = join(dir, 'uploads')

      await mkdir(uploadsDir, {recursive: true})
      await writeFile(join(uploadsDir, 'image1.png'), 'fake image data')
      await writeFile(join(uploadsDir, 'image2.png'), 'fake image data')

      const hash = `sha256:${createHash('sha256').update(Buffer.from('fake image data')).digest('hex')}`

      globalThis.fetch = mock.fn(async (url: string | URL, options?: RequestInit) => {
        const urlStr = url.toString()
        fetchCalls.push({url: urlStr, method: options?.method || 'GET'})

        if (urlStr.includes('/uploads.json')) {
          return new Response(
            JSON.stringify([
              {name: 'image1.png', hash},
              {name: 'image2.png', hash},
            ]),
            {status: 200, headers: {'Content-Type': 'application/json'}},
          )
        }
        return new Response(null, {status: 200})
      }) as typeof fetch

      await downloadPathUploads(
        makeCtx({
          settings: {path: '/docs', uploads: ['image1.png', 'image2.png']},
          dir,
        }),
      )

      assert.equal(fetchCalls.length, 1)
      assert.ok(consoleOutput.some(line => line.includes('All uploads are up to date')))
    })

    it('downloads missing uploads from server', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'wondoc-sync-'))
      createdDirs.push(dir)
      const uploadsDir = join(dir, 'uploads')

      await mkdir(uploadsDir, {recursive: true})
      await writeFile(join(uploadsDir, 'existing.png'), 'existing data')

      const existingHash = `sha256:${createHash('sha256').update(Buffer.from('existing data')).digest('hex')}`
      const missingHash = `sha256:${createHash('sha256').update(Buffer.from('downloaded file content')).digest('hex')}`

      // Mock fetch to return uploads.json and file content
      globalThis.fetch = mock.fn(async (url: string | URL, options?: RequestInit) => {
        const urlStr = url.toString()
        fetchCalls.push({url: urlStr, method: options?.method || 'GET'})

        if (urlStr.includes('/uploads.json')) {
          return new Response(
            JSON.stringify([
              {name: 'existing.png', hash: existingHash},
              {name: 'missing.png', hash: missingHash},
            ]),
            {status: 200, headers: {'Content-Type': 'application/json'}},
          )
        }

        if (urlStr.includes('missing.png')) {
          return new Response(Buffer.from('downloaded file content'), {
            status: 200,
            headers: {'Content-Type': 'application/octet-stream'},
          })
        }
        return new Response(null, {status: 404})
      }) as typeof fetch

      await downloadPathUploads(
        makeCtx({
          settings: {path: '/docs', uploads: ['existing.png', 'missing.png']},
          dir,
        }),
      )

      // 1 fetch for uploads.json + 1 download for missing.png
      assert.equal(fetchCalls.length, 2)
      assert.ok(fetchCalls[1].url.includes('missing.png'))
      assert.ok(consoleOutput.some(line => line.includes('Downloading 1 new upload')))
    })

    it('handles 404 responses gracefully', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'wondoc-sync-'))
      createdDirs.push(dir)

      globalThis.fetch = mock.fn(async (url: string | URL, options?: RequestInit) => {
        fetchCalls.push({url: url.toString(), method: options?.method || 'GET'})
        return new Response(null, {status: 404})
      }) as typeof fetch

      await downloadPathUploads(
        makeCtx({
          settings: {path: '/docs', uploads: ['notfound.png']},
          dir,
        }),
      )

      assert.ok(consoleOutput.some(line => line.includes('File not found')))
    })

    it('constructs correct download URL', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'wondoc-sync-'))
      createdDirs.push(dir)

      globalThis.fetch = mock.fn(async (url: string | URL, options?: RequestInit) => {
        fetchCalls.push({url: url.toString(), method: options?.method || 'GET'})
        return new Response(null, {status: 404})
      }) as typeof fetch

      await downloadPathUploads(
        makeCtx({
          settings: {path: '/my/doc', uploads: ['test.png']},
          normalizedPath: 'my/doc',
          dir,
        }),
      )

      assert.equal(fetchCalls[0].url, 'https://example.com/my/doc/uploads/test.png')
    })

    it('handles non-404 server errors during download', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'wondoc-sync-'))
      createdDirs.push(dir)

      globalThis.fetch = mock.fn(async (url: string | URL, options?: RequestInit) => {
        fetchCalls.push({url: url.toString(), method: options?.method || 'GET'})
        return new Response('Internal Server Error', {status: 500, statusText: 'Internal Server Error'})
      }) as typeof fetch

      await downloadPathUploads(
        makeCtx({
          settings: {path: '/docs', uploads: ['error.png']},
          dir,
        }),
      )

      assert.ok(consoleOutput.some(line => line.includes('Failed to download')))
    })

    it('handles response with no body', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'wondoc-sync-'))
      createdDirs.push(dir)

      globalThis.fetch = mock.fn(async (url: string | URL, options?: RequestInit) => {
        fetchCalls.push({url: url.toString(), method: options?.method || 'GET'})
        const response = new Response(null, {status: 200})
        Object.defineProperty(response, 'body', {value: null})
        return response
      }) as typeof fetch

      await downloadPathUploads(
        makeCtx({
          settings: {path: '/docs', uploads: ['nobody.png']},
          dir,
        }),
      )

      assert.ok(consoleOutput.some(line => line.includes('Failed to download') || line.includes('No response body')))
    })
  })

  describe('uploadPathUploads', () => {
    it('does nothing when uploads directory does not exist', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'wondoc-sync-'))
      createdDirs.push(dir)

      await uploadPathUploads(makeCtx({settings: {path: '/docs', uploads: []}, dir}))

      assert.equal(fetchCalls.length, 0)
    })

    it('reports all uploads synced when local matches server', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'wondoc-sync-'))
      createdDirs.push(dir)
      const uploadsDir = join(dir, 'uploads')

      await mkdir(uploadsDir, {recursive: true})
      await writeFile(join(uploadsDir, 'image.png'), 'data')

      const hash = `sha256:${createHash('sha256').update(Buffer.from('data')).digest('hex')}`

      // Mock server uploads.json to return same uploads with matching hash
      globalThis.fetch = mock.fn(async (url: string | URL, options?: RequestInit) => {
        const urlStr = url.toString()
        fetchCalls.push({url: urlStr, method: options?.method || 'GET'})

        if (urlStr.includes('/uploads.json')) {
          return new Response(JSON.stringify([{name: 'image.png', hash}]), {
            status: 200,
            headers: {'Content-Type': 'application/json'},
          })
        }
        return new Response(null, {status: 200})
      }) as typeof fetch

      await uploadPathUploads(makeCtx({settings: {path: '/docs', uploads: ['image.png']}, dir}))

      assert.ok(consoleOutput.some(line => line.includes('All uploads are synced')))
    })

    it('uploads new local files to server', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'wondoc-sync-'))
      createdDirs.push(dir)
      const uploadsDir = join(dir, 'uploads')

      await mkdir(uploadsDir, {recursive: true})
      await writeFile(join(uploadsDir, 'existing.png'), 'existing')
      await writeFile(join(uploadsDir, 'new.png'), 'new file')

      const existingHash = `sha256:${createHash('sha256').update(Buffer.from('existing')).digest('hex')}`

      // Mock server uploads.json to only have existing.png
      globalThis.fetch = mock.fn(async (url: string | URL, options?: RequestInit) => {
        const urlStr = url.toString()
        fetchCalls.push({url: urlStr, method: options?.method || 'GET'})

        if (urlStr.includes('/uploads.json')) {
          return new Response(JSON.stringify([{name: 'existing.png', hash: existingHash}]), {
            status: 200,
            headers: {'Content-Type': 'application/json'},
          })
        }
        if (options?.method === 'POST') {
          return new Response(JSON.stringify({success: true}), {
            status: 200,
            headers: {'Content-Type': 'application/json'},
          })
        }
        return new Response(null, {status: 200})
      }) as typeof fetch

      await uploadPathUploads(makeCtx({settings: {path: '/docs', uploads: ['existing.png']}, dir}))

      assert.ok(fetchCalls.some(c => c.method === 'POST'))
      assert.ok(consoleOutput.some(line => line.includes('Uploading 1 new upload')))
      assert.ok(consoleOutput.some(line => line.includes('Uploaded new.png')))
    })

    it('handles upload errors gracefully', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'wondoc-sync-'))
      createdDirs.push(dir)
      const uploadsDir = join(dir, 'uploads')

      await mkdir(uploadsDir, {recursive: true})
      await writeFile(join(uploadsDir, 'fail.png'), 'data')

      globalThis.fetch = mock.fn(async (url: string | URL, options?: RequestInit) => {
        const urlStr = url.toString()
        fetchCalls.push({url: urlStr, method: options?.method || 'GET'})

        if (urlStr.includes('/settings.json')) {
          return new Response(JSON.stringify({uploads: []}), {status: 200})
        }
        return new Response('Error', {status: 500})
      }) as typeof fetch

      await uploadPathUploads(makeCtx({settings: {path: '/docs', uploads: []}, dir}))

      assert.ok(consoleOutput.some(line => line.includes('Failed to upload')))
    })
  })

  describe('deletePathUploads', () => {
    it('deletes uploads from server that no longer exist locally', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'wondoc-sync-'))
      createdDirs.push(dir)

      // No local uploads dir — server has server.png
      globalThis.fetch = mock.fn(async (url: string | URL, options?: RequestInit) => {
        const urlStr = url.toString()
        fetchCalls.push({url: urlStr, method: options?.method || 'GET'})

        if (urlStr.includes('/uploads.json')) {
          return new Response(JSON.stringify([{name: 'server.png', hash: 'sha256:abc'}]), {
            status: 200,
            headers: {'Content-Type': 'application/json'},
          })
        }
        if (options?.method === 'DELETE') {
          return new Response(null, {status: 200})
        }
        return new Response(null, {status: 404})
      }) as typeof fetch

      await deletePathUploads(makeCtx({settings: {path: '/docs', uploads: []}, dir}))

      assert.ok(fetchCalls.some(c => c.url.includes('upload=server.png') && c.method === 'DELETE'))
    })

    it('does nothing when server and local match', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'wondoc-sync-'))
      createdDirs.push(dir)
      const uploadsDir = join(dir, 'uploads')
      await mkdir(uploadsDir, {recursive: true})
      await writeFile(join(uploadsDir, 'image.png'), 'data')

      globalThis.fetch = mock.fn(async (url: string | URL, options?: RequestInit) => {
        const urlStr = url.toString()
        fetchCalls.push({url: urlStr, method: options?.method || 'GET'})

        if (urlStr.includes('/settings.json')) {
          return new Response(JSON.stringify({uploads: ['image.png']}), {status: 200})
        }
        return new Response(null, {status: 200})
      }) as typeof fetch

      await deletePathUploads(makeCtx({settings: {path: '/docs', uploads: ['image.png']}, dir}))

      assert.ok(!fetchCalls.some(c => c.method === 'DELETE'))
    })

    it('handles delete failure gracefully', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'wondoc-sync-'))
      createdDirs.push(dir)

      globalThis.fetch = mock.fn(async (url: string | URL, options?: RequestInit) => {
        const urlStr = url.toString()
        fetchCalls.push({url: urlStr, method: options?.method || 'GET'})

        if (urlStr.includes('/uploads.json')) {
          return new Response(JSON.stringify([{name: 'server-only.png', hash: 'sha256:abc'}]), {
            status: 200,
            headers: {'Content-Type': 'application/json'},
          })
        }
        if (options?.method === 'DELETE') {
          throw new Error('Delete failed')
        }
        return new Response(null, {status: 404})
      }) as typeof fetch

      await deletePathUploads(makeCtx({settings: {path: '/docs', uploads: []}, dir}))

      assert.ok(consoleOutput.some(line => line.includes('Failed to delete')))
    })
  })
})
