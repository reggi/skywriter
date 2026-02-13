import {describe, it, mock, beforeEach} from 'node:test'
import assert from 'node:assert/strict'
import {Hono} from 'hono'
import type {DiscoveryResult} from '../../../src/cli/middleware/types.ts'

// --- Mutable mock state ---
let mockConfig: {serverUrl: string; username: string; password: string} | null = null
let mockReadConfigShouldThrow = false
let mockAssembleShouldThrow = false
let mockAssembleError = 'assemble failed'
let mockDocument = {path: '/', content: 'hello', data: {}, title: 'Test'}
let mockRenderResult = {html: '<p>hello</p>'}
let mockResponse: Response = new Response('<p>hello</p>', {status: 200, headers: {'Content-Type': 'text/html'}})
let mockFnClient = {
  getPage: async () => ({}),
  getPages: async () => [],
  getUploads: async () => [],
}
let functionContextClientCalls: unknown[] = []
let assembleCalls: unknown[] = []
let responderCalls: unknown[] = []

// --- Mock modules BEFORE importing the module under test ---

mock.module('node:child_process', {
  namedExports: {
    spawn: () => ({on: () => {}, stdout: {on: () => {}}, stderr: {on: () => {}}}),
    spawnSync: () => ({status: 0, stdout: '', stderr: ''}),
  },
})

mock.module('../../../src/cli/utils/config.ts', {
  namedExports: {
    readConfig: async () => {
      if (mockReadConfigShouldThrow) throw new Error('not logged in')
      return mockConfig
    },
    sanitizeServerUrl: (url: string) => url,
  },
})

mock.module('../../../src/cli/utils/assemble.ts', {
  namedExports: {
    assemble: async (...args: unknown[]) => {
      if (mockAssembleShouldThrow) throw new Error(mockAssembleError)
      assembleCalls.push(args)
      return mockDocument
    },
  },
})

mock.module('../../../src/render/index.ts', {
  namedExports: {
    render: async () => mockRenderResult,
  },
})

mock.module('../../../src/responder/index.ts', {
  namedExports: {
    responder: async (opts: unknown) => {
      responderCalls.push(opts)
      return mockResponse
    },
  },
})

mock.module('../../../src/fn/functionContextClient.ts', {
  namedExports: {
    functionContextClient: (...args: unknown[]) => {
      functionContextClientCalls.push(args)
      return mockFnClient
    },
  },
})

mock.module('../../../src/cli/utils/log.ts', {
  defaultExport: {
    info: () => {},
    error: () => {},
    warn: () => {},
  },
})

// --- Import AFTER mocking ---
const {serveDocument} = await import('../../../src/cli/middleware/serveDocument.ts')

// --- Helpers ---

function createMockDiscovery(options: {
  documents?: Map<
    string,
    {
      path: string
      fsPath: string
      hasTemplate: boolean
      hasSlot: boolean
      templatePath: string | null
      slotPath: string | null
    }
  >
  sortedPaths?: string[]
}): DiscoveryResult {
  return {
    documents: options.documents ?? new Map(),
    sortedPaths: options.sortedPaths ?? [],
    errors: [],
    duplicates: new Map(),
  }
}

const mockCtx = {cliName: 'skywriter', cliId: 'skywriter', cwd: '/tmp/test-config'}

describe('serveDocument', () => {
  beforeEach(() => {
    mockConfig = {serverUrl: 'http://localhost:3000', username: 'user', password: 'pass'}
    mockReadConfigShouldThrow = false
    mockAssembleShouldThrow = false
    mockAssembleError = 'assemble failed'
    mockDocument = {path: '/', content: 'hello', data: {}, title: 'Test'}
    mockRenderResult = {html: '<p>hello</p>'}
    mockResponse = new Response('<p>hello</p>', {status: 200, headers: {'Content-Type': 'text/html'}})
    mockFnClient = {
      getPage: async () => ({}),
      getPages: async () => [],
      getUploads: async () => [],
    }
    functionContextClientCalls = []
    assembleCalls = []
    responderCalls = []
  })

  describe('findDocumentForPath (via middleware)', () => {
    it('should match a direct path and return a response', async () => {
      const discovery = createMockDiscovery({
        documents: new Map([
          [
            '/about',
            {
              path: '/about',
              fsPath: '/docs/about',
              hasTemplate: false,
              hasSlot: false,
              templatePath: null,
              slotPath: null,
            },
          ],
        ]),
        sortedPaths: ['/about'],
      })

      const app = new Hono()
      app.get(
        '/*',
        serveDocument(() => discovery, mockCtx),
      )

      const res = await app.request('/about')
      assert.strictEqual(res.status, 200)
    })

    it('should strip asset suffix to find parent path', async () => {
      const discovery = createMockDiscovery({
        documents: new Map([
          [
            '/blog',
            {
              path: '/blog',
              fsPath: '/docs/blog',
              hasTemplate: false,
              hasSlot: false,
              templatePath: null,
              slotPath: null,
            },
          ],
        ]),
        sortedPaths: ['/blog'],
      })

      const app = new Hono()
      app.get(
        '/*',
        serveDocument(() => discovery, mockCtx),
      )

      const res = await app.request('/blog/style.css')
      assert.strictEqual(res.status, 200)
      assert.ok(assembleCalls.length > 0, 'assemble should have been called')
    })

    it('should call next() when no document found', async () => {
      const discovery = createMockDiscovery({})

      const app = new Hono()
      let nextCalled = false
      app.get(
        '/*',
        serveDocument(() => discovery, mockCtx),
        c => {
          nextCalled = true
          return c.text('fallback')
        },
      )

      const res = await app.request('/nonexistent')
      assert.strictEqual(nextCalled, true)
      assert.strictEqual(await res.text(), 'fallback')
    })

    it('should return null for completely unmatched paths', async () => {
      const discovery = createMockDiscovery({
        documents: new Map([
          [
            '/home',
            {
              path: '/home',
              fsPath: '/docs/home',
              hasTemplate: false,
              hasSlot: false,
              templatePath: null,
              slotPath: null,
            },
          ],
        ]),
        sortedPaths: ['/home'],
      })

      const app = new Hono()
      let nextCalled = false
      app.get(
        '/*',
        serveDocument(() => discovery, mockCtx),
        c => {
          nextCalled = true
          return c.text('not found')
        },
      )

      const _res = await app.request('/other/deep/path')
      assert.strictEqual(nextCalled, true)
    })
  })

  describe('middleware handler', () => {
    it('should call assemble with the correct fsPath', async () => {
      const discovery = createMockDiscovery({
        documents: new Map([
          [
            '/page',
            {
              path: '/page',
              fsPath: '/docs/page',
              hasTemplate: false,
              hasSlot: false,
              templatePath: null,
              slotPath: null,
            },
          ],
        ]),
        sortedPaths: ['/page'],
      })

      const app = new Hono()
      app.get(
        '/*',
        serveDocument(() => discovery, mockCtx),
      )

      await app.request('/page')
      assert.ok(assembleCalls.length > 0)
      const [fsPath] = assembleCalls[0] as [string, unknown]
      assert.strictEqual(fsPath, '/docs/page')
    })

    it('should call responder and return its Response', async () => {
      mockResponse = new Response('custom body', {status: 200})

      const discovery = createMockDiscovery({
        documents: new Map([
          [
            '/test',
            {
              path: '/test',
              fsPath: '/docs/test',
              hasTemplate: false,
              hasSlot: false,
              templatePath: null,
              slotPath: null,
            },
          ],
        ]),
        sortedPaths: ['/test'],
      })

      const app = new Hono()
      app.get(
        '/*',
        serveDocument(() => discovery, mockCtx),
      )

      const res = await app.request('/test')
      assert.strictEqual(res.status, 200)
      assert.ok(responderCalls.length > 0, 'responder should have been called')
    })

    it('should return 500 on error', async () => {
      mockAssembleShouldThrow = true
      mockAssembleError = 'assemble failed'

      const discovery = createMockDiscovery({
        documents: new Map([
          [
            '/broken',
            {
              path: '/broken',
              fsPath: '/docs/broken',
              hasTemplate: false,
              hasSlot: false,
              templatePath: null,
              slotPath: null,
            },
          ],
        ]),
        sortedPaths: ['/broken'],
      })

      const app = new Hono()
      const {serveDocument: serveDocumentFresh} = await import('../../../src/cli/middleware/serveDocument.ts')
      app.get(
        '/*',
        serveDocumentFresh(() => discovery, mockCtx),
      )

      const res = await app.request('/broken')
      assert.strictEqual(res.status, 500)
      const text = await res.text()
      assert.ok(text.includes('assemble failed'))
    })
  })

  describe('getFn lazy initialization', () => {
    it('should create functionContextClient when readConfig succeeds', async () => {
      mockConfig = {serverUrl: 'http://example.com', username: 'admin', password: 'secret'}
      mockReadConfigShouldThrow = false

      const discovery = createMockDiscovery({
        documents: new Map([
          [
            '/auth',
            {
              path: '/auth',
              fsPath: '/docs/auth',
              hasTemplate: false,
              hasSlot: false,
              templatePath: null,
              slotPath: null,
            },
          ],
        ]),
        sortedPaths: ['/auth'],
      })

      const app = new Hono()
      app.get(
        '/*',
        serveDocument(() => discovery, mockCtx),
      )

      await app.request('/auth')
      assert.ok(functionContextClientCalls.length > 0, 'functionContextClient should have been called')
      const [serverUrl, creds] = functionContextClientCalls[0] as [string, {username: string; password: string}]
      assert.strictEqual(serverUrl, 'http://example.com')
      assert.strictEqual(creds.username, 'admin')
      assert.strictEqual(creds.password, 'secret')
    })

    it('should fall back to stub functions when readConfig throws', async () => {
      mockReadConfigShouldThrow = true

      const discovery = createMockDiscovery({
        documents: new Map([
          [
            '/noauth',
            {
              path: '/noauth',
              fsPath: '/docs/noauth',
              hasTemplate: false,
              hasSlot: false,
              templatePath: null,
              slotPath: null,
            },
          ],
        ]),
        sortedPaths: ['/noauth'],
      })

      const app = new Hono()
      // Create a fresh middleware to get a new lazy init
      const {serveDocument: serveDocFresh} = await import('../../../src/cli/middleware/serveDocument.ts')
      app.get(
        '/*',
        serveDocFresh(() => discovery, mockCtx),
      )

      const res = await app.request('/noauth')
      // Should still return a response (not crash)
      assert.strictEqual(res.status, 200)
      // functionContextClient should NOT have been called since readConfig threw
      assert.strictEqual(functionContextClientCalls.length, 0)
    })

    it('should only initialize fn once across multiple requests', async () => {
      mockReadConfigShouldThrow = false
      functionContextClientCalls = []

      const discovery = createMockDiscovery({
        documents: new Map([
          [
            '/a',
            {path: '/a', fsPath: '/docs/a', hasTemplate: false, hasSlot: false, templatePath: null, slotPath: null},
          ],
          [
            '/b',
            {path: '/b', fsPath: '/docs/b', hasTemplate: false, hasSlot: false, templatePath: null, slotPath: null},
          ],
        ]),
        sortedPaths: ['/a', '/b'],
      })

      const app = new Hono()
      const {serveDocument: serveDocOnce} = await import('../../../src/cli/middleware/serveDocument.ts')
      app.get(
        '/*',
        serveDocOnce(() => discovery, mockCtx),
      )

      await app.request('/a')
      await app.request('/b')

      // functionContextClient should have been called exactly once
      assert.strictEqual(functionContextClientCalls.length, 1)
    })
  })

  describe('resolveDocumentPath', () => {
    it('should resolve paths from discovery documents', async () => {
      const discovery = createMockDiscovery({
        documents: new Map([
          [
            '/main',
            {
              path: '/main',
              fsPath: '/docs/main',
              hasTemplate: false,
              hasSlot: false,
              templatePath: null,
              slotPath: null,
            },
          ],
          [
            '/ref',
            {path: '/ref', fsPath: '/docs/ref', hasTemplate: false, hasSlot: false, templatePath: null, slotPath: null},
          ],
        ]),
        sortedPaths: ['/main', '/ref'],
      })

      const app = new Hono()
      const {serveDocument: serveDocResolve} = await import('../../../src/cli/middleware/serveDocument.ts')
      app.get(
        '/*',
        serveDocResolve(() => discovery, mockCtx),
      )

      await app.request('/main')
      assert.ok(assembleCalls.length > 0)
      // Verify assemble was called with a resolveDocumentPath option
      const [, opts] = assembleCalls[0] as [string, {resolveDocumentPath: (path: string) => Promise<string | null>}]
      assert.ok(opts.resolveDocumentPath, 'resolveDocumentPath should be passed to assemble')
      // Test the resolver
      const resolved = await opts.resolveDocumentPath('/ref')
      assert.strictEqual(resolved, '/docs/ref')
      const notFound = await opts.resolveDocumentPath('/missing')
      assert.strictEqual(notFound, null)
    })
  })
})
