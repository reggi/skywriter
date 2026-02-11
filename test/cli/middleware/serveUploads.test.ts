import {describe, it, beforeEach, afterEach} from 'node:test'
import assert from 'node:assert'
import {Hono} from 'hono'
import {serveUploads} from '../../../src/cli/middleware/serveUploads.ts'
import type {DiscoveryResult} from '../../../src/cli/middleware/types.ts'
import {mkdir, writeFile, rm} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'

/**
 * Create a mock DiscoveryResult for testing
 */
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
  duplicates?: Map<string, string[]>
  sortedPaths?: string[]
}): DiscoveryResult {
  return {
    documents: options.documents ?? new Map(),
    duplicates: options.duplicates ?? new Map(),
    sortedPaths: options.sortedPaths ?? [],
    errors: [],
  }
}

describe('serveUploads', () => {
  let testDir: string

  beforeEach(async () => {
    // Create a temporary test directory
    testDir = join(tmpdir(), `serveUploads-test-${Date.now()}`)
    await mkdir(testDir, {recursive: true})
  })

  afterEach(async () => {
    // Clean up temporary directory
    await rm(testDir, {recursive: true, force: true})
  })

  describe('when path does not contain /uploads/', () => {
    it('should call next() and skip handler', async () => {
      const discovery = createMockDiscovery({})

      const app = new Hono()
      let nextHandlerCalled = false

      app.get(
        '/*',
        serveUploads(() => discovery),
        c => {
          nextHandlerCalled = true
          return c.text('Not an upload')
        },
      )

      const res = await app.request('/about')
      assert.strictEqual(res.status, 200)
      assert.strictEqual(await res.text(), 'Not an upload')
      assert.strictEqual(nextHandlerCalled, true)
    })
  })

  describe('with document uploads', () => {
    it('should serve files from document uploads directory', async () => {
      // Create test file
      const docDir = join(testDir, 'about')
      const uploadsDir = join(docDir, 'uploads')
      await mkdir(uploadsDir, {recursive: true})
      await writeFile(join(uploadsDir, 'image.png'), 'fake image content')

      const discovery = createMockDiscovery({
        documents: new Map([
          [
            '/about',
            {path: '/about', fsPath: docDir, hasTemplate: false, hasSlot: false, templatePath: null, slotPath: null},
          ],
        ]),
        sortedPaths: ['/about'],
      })

      const app = new Hono()

      app.get(
        '/*',
        serveUploads(() => discovery),
      )

      const res = await app.request('/about/uploads/image.png')
      assert.strictEqual(res.status, 200)
      assert.strictEqual(res.headers.get('Content-Type'), 'image/png')
      assert.strictEqual(await res.text(), 'fake image content')
    })

    it('should serve files from root document uploads', async () => {
      // Create test file for root document
      const docDir = join(testDir, 'home')
      const uploadsDir = join(docDir, 'uploads')
      await mkdir(uploadsDir, {recursive: true})
      await writeFile(join(uploadsDir, 'logo.svg'), '<svg></svg>')

      const discovery = createMockDiscovery({
        documents: new Map([
          ['/', {path: '/', fsPath: docDir, hasTemplate: false, hasSlot: false, templatePath: null, slotPath: null}],
        ]),
        sortedPaths: ['/'],
      })

      const app = new Hono()

      app.get(
        '/*',
        serveUploads(() => discovery),
      )

      const res = await app.request('/uploads/logo.svg')
      assert.strictEqual(res.status, 200)
      assert.strictEqual(res.headers.get('Content-Type'), 'image/svg+xml')
      assert.strictEqual(await res.text(), '<svg></svg>')
    })

    it('should call next() when file does not exist', async () => {
      const docDir = join(testDir, 'about')
      const uploadsDir = join(docDir, 'uploads')
      await mkdir(uploadsDir, {recursive: true})

      const discovery = createMockDiscovery({
        documents: new Map([
          [
            '/about',
            {path: '/about', fsPath: docDir, hasTemplate: false, hasSlot: false, templatePath: null, slotPath: null},
          ],
        ]),
        sortedPaths: ['/about'],
      })

      const app = new Hono()
      let nextHandlerCalled = false

      app.get(
        '/*',
        serveUploads(() => discovery),
        c => {
          nextHandlerCalled = true
          return c.text('Not found fallback')
        },
      )

      const res = await app.request('/about/uploads/missing.png')
      assert.strictEqual(res.status, 200)
      assert.strictEqual(await res.text(), 'Not found fallback')
      assert.strictEqual(nextHandlerCalled, true)
    })
  })

  describe('with template uploads', () => {
    it('should serve files from template uploads directory', async () => {
      // Create test file in template uploads
      const docDir = join(testDir, 'page')
      const templateUploadsDir = join(docDir, 'template', 'uploads')
      await mkdir(templateUploadsDir, {recursive: true})
      await writeFile(join(templateUploadsDir, 'bg.jpg'), 'fake jpeg')

      const discovery = createMockDiscovery({
        documents: new Map([
          [
            '/page',
            {
              path: '/page',
              fsPath: docDir,
              hasTemplate: true,
              hasSlot: false,
              templatePath: '/shared-template',
              slotPath: null,
            },
          ],
        ]),
        sortedPaths: ['/page'],
      })

      const app = new Hono()

      app.get(
        '/*',
        serveUploads(() => discovery),
      )

      const res = await app.request('/shared-template/uploads/bg.jpg')
      assert.strictEqual(res.status, 200)
      assert.strictEqual(res.headers.get('Content-Type'), 'image/jpeg')
      assert.strictEqual(await res.text(), 'fake jpeg')
    })
  })

  describe('with slot uploads', () => {
    it('should serve files from slot uploads directory', async () => {
      // Create test file in slot uploads
      const docDir = join(testDir, 'page')
      const slotUploadsDir = join(docDir, 'slot', 'uploads')
      await mkdir(slotUploadsDir, {recursive: true})
      await writeFile(join(slotUploadsDir, 'content.pdf'), 'fake pdf')

      const discovery = createMockDiscovery({
        documents: new Map([
          [
            '/page',
            {
              path: '/page',
              fsPath: docDir,
              hasTemplate: false,
              hasSlot: true,
              templatePath: null,
              slotPath: '/page-slot',
            },
          ],
        ]),
        sortedPaths: ['/page'],
      })

      const app = new Hono()

      app.get(
        '/*',
        serveUploads(() => discovery),
      )

      const res = await app.request('/page-slot/uploads/content.pdf')
      assert.strictEqual(res.status, 200)
      assert.strictEqual(res.headers.get('Content-Type'), 'application/pdf')
      assert.strictEqual(await res.text(), 'fake pdf')
    })
  })

  describe('content type detection', () => {
    it('should return correct MIME type for various file types', async () => {
      const docDir = join(testDir, 'files')
      const uploadsDir = join(docDir, 'uploads')
      await mkdir(uploadsDir, {recursive: true})

      const files = [
        {name: 'style.css', type: 'text/css'},
        {name: 'script.js', type: 'text/javascript'},
        {name: 'data.json', type: 'application/json'},
        {name: 'doc.html', type: 'text/html'},
      ]

      for (const file of files) {
        await writeFile(join(uploadsDir, file.name), 'content')
      }

      const discovery = createMockDiscovery({
        documents: new Map([
          [
            '/files',
            {path: '/files', fsPath: docDir, hasTemplate: false, hasSlot: false, templatePath: null, slotPath: null},
          ],
        ]),
        sortedPaths: ['/files'],
      })

      const app = new Hono()

      app.get(
        '/*',
        serveUploads(() => discovery),
      )

      for (const file of files) {
        const res = await app.request(`/files/uploads/${file.name}`)
        assert.strictEqual(res.status, 200, `Failed for ${file.name}`)
        assert.ok(
          res.headers.get('Content-Type')?.includes(file.type.split(';')[0]),
          `Expected ${file.type} for ${file.name}, got ${res.headers.get('Content-Type')}`,
        )
      }
    })

    it('should return application/octet-stream for unknown file types', async () => {
      const docDir = join(testDir, 'files')
      const uploadsDir = join(docDir, 'uploads')
      await mkdir(uploadsDir, {recursive: true})
      await writeFile(join(uploadsDir, 'data.unknownext'), 'unknown content')

      const discovery = createMockDiscovery({
        documents: new Map([
          [
            '/files',
            {path: '/files', fsPath: docDir, hasTemplate: false, hasSlot: false, templatePath: null, slotPath: null},
          ],
        ]),
        sortedPaths: ['/files'],
      })

      const app = new Hono()

      app.get(
        '/*',
        serveUploads(() => discovery),
      )

      const res = await app.request('/files/uploads/data.unknownext')
      assert.strictEqual(res.status, 200)
      assert.strictEqual(res.headers.get('Content-Type'), 'application/octet-stream')
    })
  })

  describe('with mutable discovery', () => {
    it('should use the current discovery result on each request', async () => {
      const docDir1 = join(testDir, 'doc1')
      const uploadsDir1 = join(docDir1, 'uploads')
      await mkdir(uploadsDir1, {recursive: true})
      await writeFile(join(uploadsDir1, 'file.txt'), 'from doc1')

      const docDir2 = join(testDir, 'doc2')
      const uploadsDir2 = join(docDir2, 'uploads')
      await mkdir(uploadsDir2, {recursive: true})
      await writeFile(join(uploadsDir2, 'file.txt'), 'from doc2')

      let discovery = createMockDiscovery({
        documents: new Map([
          [
            '/doc',
            {path: '/doc', fsPath: docDir1, hasTemplate: false, hasSlot: false, templatePath: null, slotPath: null},
          ],
        ]),
        sortedPaths: ['/doc'],
      })

      const app = new Hono()

      app.get(
        '/*',
        serveUploads(() => discovery),
      )

      // First request - uses docDir1
      const res1 = await app.request('/doc/uploads/file.txt')
      assert.strictEqual(res1.status, 200)
      assert.strictEqual(await res1.text(), 'from doc1')

      // Mutate discovery to point to docDir2
      discovery = createMockDiscovery({
        documents: new Map([
          [
            '/doc',
            {path: '/doc', fsPath: docDir2, hasTemplate: false, hasSlot: false, templatePath: null, slotPath: null},
          ],
        ]),
        sortedPaths: ['/doc'],
      })

      // Second request - uses docDir2
      const res2 = await app.request('/doc/uploads/file.txt')
      assert.strictEqual(res2.status, 200)
      assert.strictEqual(await res2.text(), 'from doc2')
    })
  })
})
