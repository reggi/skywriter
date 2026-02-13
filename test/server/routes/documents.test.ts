import {describe, it, mock, beforeEach} from 'node:test'
import assert from 'node:assert'
import {Hono} from 'hono'
import type {AppContext} from '../../../src/server/utils/types.ts'
import type {
  RenderDocument,
  DocumentId,
  DocumentQuery,
  RenderDocumentGetOptions,
} from '../../../src/operations/types.ts'
import type {PoolClient} from 'pg'

// Mock state
let mockGetRenderDocumentResult: unknown = null
let mockGetRenderDocumentError: Error | null = null
let getRenderDocumentCalls: Array<{query: unknown; options: unknown}> = []

// Mock the db operations
mock.module('../../../src/operations/getRenderDocument.ts', {
  namedExports: {
    getRenderDocument: async (_client: unknown, query: unknown, options: unknown) => {
      getRenderDocumentCalls.push({query, options})
      if (mockGetRenderDocumentError) throw mockGetRenderDocumentError
      return mockGetRenderDocumentResult
    },
  },
})

// Mock functionContext to avoid database calls
mock.module('../../../src/fn/functionContext.ts', {
  namedExports: {
    functionContext: () => ({}),
  },
})

// Import after mocking
const {documents: documentHandler} = await import('../../../src/server/routes/documents.ts')

function resetMocks() {
  mockGetRenderDocumentResult = null
  mockGetRenderDocumentError = null
  getRenderDocumentCalls = []
}

// Helper to create a mock RenderDocument
function createMockRenderDocument(overrides: Partial<RenderDocument> = {}): RenderDocument {
  return {
    id: 1 as DocumentId,
    path: '/test',
    title: 'Test Document',
    content: '# Hello World',
    content_type: 'html',
    data: '{}',
    data_type: 'json',
    style: '',
    script: '',
    server: '',
    extension: '.html',
    mime_type: 'text/html',
    has_eta: false,
    draft: false,
    published: true,
    created_at: new Date(),
    updated_at: new Date(),
    template_id: null,
    slot_id: null,
    uploads: [],
    redirect: false,
    ...overrides,
  }
}

describe('documentHandler', () => {
  beforeEach(() => {
    resetMocks()
  })

  describe('when document is found', () => {
    it('should return rendered document for unauthenticated users', async () => {
      const app = new Hono<AppContext>()
      const mockDoc = createMockRenderDocument({path: '/test', content: '# Test Content'})
      mockGetRenderDocumentResult = mockDoc

      app.use('/*', async (c, next) => {
        c.set('client', {} as unknown as PoolClient)
        c.set('isAuthenticated', false)
        return next()
      })

      app.get('/*', documentHandler, c => c.text('Not found handler'))

      const res = await app.request('/test')
      assert.strictEqual(res.status, 200)

      // Verify getRenderDocument was called with published: true for unauthenticated
      assert.strictEqual(getRenderDocumentCalls.length, 1)
      const {query, options} = getRenderDocumentCalls[0] as {query: DocumentQuery; options: RenderDocumentGetOptions}
      assert.deepStrictEqual(query, {path: '/test'})
      assert.strictEqual(options!.published, true)
      assert.strictEqual(options!.includeSlot, true)
      assert.strictEqual(options!.includeTemplate, true)
    })

    it('should return draft document for authenticated users', async () => {
      resetMocks()
      const app = new Hono<AppContext>()
      const mockDoc = createMockRenderDocument({path: '/test', draft: true})
      mockGetRenderDocumentResult = mockDoc

      app.use('/*', async (c, next) => {
        c.set('client', {} as unknown as PoolClient)
        c.set('isAuthenticated', true)
        return next()
      })

      app.get('/*', documentHandler, c => c.text('Not found handler'))

      const res = await app.request('/test')
      assert.strictEqual(res.status, 200)

      // Verify getRenderDocument was called with draft: true for authenticated
      const {options: authOptions} = getRenderDocumentCalls[0] as {
        query: DocumentQuery
        options: RenderDocumentGetOptions
      }
      assert.strictEqual(authOptions!.draft, true)
      assert.strictEqual(authOptions!.published, undefined)
    })
  })

  describe('when document is not found', () => {
    it('should call next() to allow other handlers to process', async () => {
      resetMocks()
      const app = new Hono<AppContext>()
      let nextHandlerCalled = false
      mockGetRenderDocumentResult = null

      app.use('/*', async (c, next) => {
        c.set('client', {} as unknown as PoolClient)
        c.set('isAuthenticated', false)
        return next()
      })

      app.get('/*', documentHandler, c => {
        nextHandlerCalled = true
        return c.text('Fallback handler')
      })

      const res = await app.request('/nonexistent')
      assert.strictEqual(res.status, 200)
      assert.strictEqual(await res.text(), 'Fallback handler')
      assert.strictEqual(nextHandlerCalled, true)
    })
  })

  describe('when database throws non-NotFoundError', () => {
    it('should propagate the error', async () => {
      resetMocks()
      const app = new Hono<AppContext>()
      mockGetRenderDocumentError = new Error('Database connection failed')

      app.use('/*', async (c, next) => {
        c.set('client', {} as unknown as PoolClient)
        c.set('isAuthenticated', false)
        return next()
      })

      app.get('/*', documentHandler)

      app.onError((err, c) => {
        return c.text(err.message, 500)
      })

      const res = await app.request('/test')
      assert.strictEqual(res.status, 500)
      assert.strictEqual(await res.text(), 'Database connection failed')
    })
  })

  describe('path handling', () => {
    it('should use request path for document lookup', async () => {
      resetMocks()
      const app = new Hono<AppContext>()
      const mockDoc = createMockRenderDocument({path: '/docs/nested/page'})
      mockGetRenderDocumentResult = mockDoc

      app.use('/*', async (c, next) => {
        c.set('client', {} as unknown as PoolClient)
        c.set('isAuthenticated', false)
        return next()
      })

      app.get('/*', documentHandler)

      await app.request('/docs/nested/page')

      const {query: pathQuery} = getRenderDocumentCalls[0] as {query: DocumentQuery; options: unknown}
      assert.deepStrictEqual(pathQuery, {path: '/docs/nested/page'})
    })

    it('should handle root path', async () => {
      resetMocks()
      const app = new Hono<AppContext>()
      const mockDoc = createMockRenderDocument({path: '/'})
      mockGetRenderDocumentResult = mockDoc

      app.use('/*', async (c, next) => {
        c.set('client', {} as unknown as PoolClient)
        c.set('isAuthenticated', false)
        return next()
      })

      app.get('/*', documentHandler)

      await app.request('/')

      const {query: rootQuery} = getRenderDocumentCalls[0] as {query: DocumentQuery; options: unknown}
      assert.deepStrictEqual(rootQuery, {path: '/'})
    })
  })
})
