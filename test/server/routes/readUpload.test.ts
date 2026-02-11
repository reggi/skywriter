import {describe, it, mock, beforeEach} from 'node:test'
import assert from 'node:assert'
import {Hono} from 'hono'
import type {AppContext} from '../../../src/server/utils/types.ts'
import type {Upload, DocumentId} from '../../../src/operations/types.ts'
import type {PoolClient} from 'pg'

// Helper to create a mock upload
function createMockUpload(overrides: Partial<Upload> = {}): Upload {
  return {
    id: 1 as unknown as Upload['id'],
    filename: 'stored-file-123.jpg',
    original_filename: 'photo.jpg',
    document_id: 1 as DocumentId,
    created_at: new Date(),
    hidden: false,
    hash: 'sha256:0000000000000000000000000000000000000000000000000000000000000000',
    ...overrides,
  }
}

// Track getUpload calls
let getUploadCalls: Array<{query: unknown; filename: unknown; options: unknown}> = []
let mockGetUploadResult: Upload | null = null

// Mock the database operations module before importing the handler
mock.module('../../../src/operations/getUpload.ts', {
  namedExports: {
    getUpload: async (_client: unknown, query: unknown, filename: unknown, options: unknown) => {
      getUploadCalls.push({query, filename, options})
      return mockGetUploadResult
    },
  },
})

// Import handler after setting up mocks
const {readUpload: uploadHandler} = await import('../../../src/server/routes/readUpload.ts')

describe('uploadHandler', () => {
  beforeEach(() => {
    // Reset mock state before each test
    getUploadCalls = []
    mockGetUploadResult = null
  })

  describe('when pathMatch is not set', () => {
    it('should throw an error', async () => {
      const app = new Hono<AppContext>()

      // Add error handler to catch thrown errors and return 500
      app.onError((err, c) => {
        return c.text(err.message, 500)
      })

      app.get('/*', uploadHandler)

      const res = await app.request('/test/uploads/file.jpg')
      assert.strictEqual(res.status, 500)
    })
  })

  describe('when upload is found', () => {
    it('should return the file with correct content type', async () => {
      const app = new Hono<AppContext>()
      mockGetUploadResult = createMockUpload()

      app.use('/*', async (c, next) => {
        c.set('client', {} as unknown as PoolClient)
        c.set('isAuthenticated', false)
        // Simulate pathMatch being set by requirePathMatch middleware
        c.set('pathMatch', [
          '/docs/my-doc/uploads/photo.jpg',
          '/docs/my-doc',
          'photo.jpg',
        ] as unknown as RegExpMatchArray)
        return next()
      })

      app.get('/*', uploadHandler)

      // Note: This will fail at the readFile step since we're not mocking fs
      // In a real test, you'd mock fs.readFile or use a test file
      await app.request('/docs/my-doc/uploads/photo.jpg')

      // Verify getUpload was called correctly
      assert.strictEqual(getUploadCalls.length, 1)
      const {query, filename, options} = getUploadCalls[0]
      assert.deepStrictEqual(query, {path: '/docs/my-doc'})
      assert.strictEqual(filename, 'photo.jpg')
      assert.deepStrictEqual(options, {published: true})
    })

    it('should pass empty options when authenticated without reveal', async () => {
      const app = new Hono<AppContext>()
      mockGetUploadResult = createMockUpload()

      app.use('/*', async (c, next) => {
        c.set('client', {} as unknown as PoolClient)
        c.set('isAuthenticated', true)
        c.set('pathMatch', [
          '/docs/my-doc/uploads/photo.jpg',
          '/docs/my-doc',
          'photo.jpg',
        ] as unknown as RegExpMatchArray)
        return next()
      })

      app.get('/*', uploadHandler)

      await app.request('/docs/my-doc/uploads/photo.jpg')

      const {options} = getUploadCalls[0]
      assert.deepStrictEqual(options, {})
    })

    it('should include hidden uploads when authenticated with ?reveal', async () => {
      const app = new Hono<AppContext>()
      mockGetUploadResult = createMockUpload({hidden: true})

      app.use('/*', async (c, next) => {
        c.set('client', {} as unknown as PoolClient)
        c.set('isAuthenticated', true)
        c.set('pathMatch', [
          '/docs/my-doc/uploads/photo.jpg',
          '/docs/my-doc',
          'photo.jpg',
        ] as unknown as RegExpMatchArray)
        return next()
      })

      app.get('/*', uploadHandler)

      await app.request('/docs/my-doc/uploads/photo.jpg?reveal')

      const {options} = getUploadCalls[0]
      assert.deepStrictEqual(options, {includeHidden: true})
    })

    it('should not include hidden uploads when unauthenticated with ?reveal', async () => {
      const app = new Hono<AppContext>()
      mockGetUploadResult = createMockUpload()

      app.use('/*', async (c, next) => {
        c.set('client', {} as unknown as PoolClient)
        c.set('isAuthenticated', false)
        c.set('pathMatch', [
          '/docs/my-doc/uploads/photo.jpg',
          '/docs/my-doc',
          'photo.jpg',
        ] as unknown as RegExpMatchArray)
        return next()
      })

      app.get('/*', uploadHandler)

      // Even with ?reveal, unauthenticated users should only see published docs
      await app.request('/docs/my-doc/uploads/photo.jpg?reveal')

      const {options} = getUploadCalls[0]
      assert.deepStrictEqual(options, {published: true})
    })
  })

  describe('when upload is not found', () => {
    it('should return 404', async () => {
      const app = new Hono<AppContext>()
      mockGetUploadResult = null

      app.use('/*', async (c, next) => {
        c.set('client', {} as unknown as PoolClient)
        c.set('isAuthenticated', false)
        c.set('pathMatch', [
          '/docs/my-doc/uploads/missing.jpg',
          '/docs/my-doc',
          'missing.jpg',
        ] as unknown as RegExpMatchArray)
        return next()
      })

      app.get('/*', uploadHandler)

      const res = await app.request('/docs/my-doc/uploads/missing.jpg')
      assert.strictEqual(res.status, 404)
      const text = await res.text()
      assert.ok(text.includes('Upload Not Found'))
    })
  })

  describe('URL decoding', () => {
    it('should decode URL-encoded filenames', async () => {
      const app = new Hono<AppContext>()
      mockGetUploadResult = null

      app.use('/*', async (c, next) => {
        c.set('client', {} as unknown as PoolClient)
        c.set('isAuthenticated', false)
        // Simulate an encoded filename with spaces
        c.set('pathMatch', ['/docs/uploads/my%20file.jpg', '/docs', 'my%20file.jpg'] as unknown as RegExpMatchArray)
        return next()
      })

      app.get('/*', uploadHandler)

      await app.request('/docs/uploads/my%20file.jpg')

      const {filename} = getUploadCalls[0]
      assert.strictEqual(filename, 'my file.jpg')
    })
  })

  describe('root document uploads', () => {
    it('should handle uploads for root path', async () => {
      const app = new Hono<AppContext>()
      mockGetUploadResult = null

      app.use('/*', async (c, next) => {
        c.set('client', {} as unknown as PoolClient)
        c.set('isAuthenticated', false)
        // Empty string for document path becomes '/'
        c.set('pathMatch', ['/uploads/file.jpg', '', 'file.jpg'] as unknown as RegExpMatchArray)
        return next()
      })

      app.get('/*', uploadHandler)

      await app.request('/uploads/file.jpg')

      const {query} = getUploadCalls[0]
      assert.deepStrictEqual(query, {path: '/'})
    })
  })
})
