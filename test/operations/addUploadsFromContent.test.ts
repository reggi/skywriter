import {describe, it, mock, beforeEach} from 'node:test'
import assert from 'node:assert/strict'
import type {PoolClient} from 'pg'
import type {DocumentQuery} from '../../src/operations/types.ts'

// Mock state
let uploadCounter = 0
let addUploadCalls: Array<{filename: string}> = []

// Mock the addUpload operation to avoid database and filesystem access
mock.module('../../src/operations/addUpload.ts', {
  namedExports: {
    addUpload: async (_client: unknown, _query: unknown, _uploadsPath: string, file: {filename: string}) => {
      addUploadCalls.push({filename: file.filename})
      uploadCounter++
      return {
        id: uploadCounter,
        original_filename: file.filename,
        storage_filename: `storage-${uploadCounter}.jpg`,
        created_at: new Date(),
      }
    },
  },
})

// Import after mocking
const {addUploadsFromContent} = await import('../../src/operations/addUploadsFromContent.ts')

// Mock database client
const mockClient = {} as PoolClient
const mockQuery: DocumentQuery = {path: '/test'}
const mockUploadsPath = '/tmp/uploads'

// Helper to create a mock fetch response
function createMockResponse(ok: boolean, contentType: string, body: ArrayBuffer): Response {
  return {
    ok,
    status: ok ? 200 : 404,
    headers: new Headers({'content-type': contentType}),
    arrayBuffer: async () => body,
  } as Response
}

// Tests for internal behavior through the public addUploadsFromContent API
// Internal functions like isForeignUrl, extractHtmlImages, extractMarkdownImages
// are tested implicitly through their effects on addUploadsFromContent output

describe('addUploadsFromContent (extractForeignImages behavior)', () => {
  beforeEach(() => {
    uploadCounter = 0
    addUploadCalls = []
    // Mock global fetch to return successful image responses
    mock.method(globalThis, 'fetch', async () => {
      return createMockResponse(true, 'image/jpeg', new ArrayBuffer(100))
    })
  })

  describe('URL filtering (isForeignUrl behavior)', () => {
    it('should extract http URLs', async () => {
      const content = '![Image](http://example.com/image.jpg)'
      const result = await addUploadsFromContent(mockClient, mockQuery, mockUploadsPath, content)
      assert.strictEqual(result.uploads.length, 1)
    })

    it('should extract https URLs', async () => {
      const content = '![Image](https://example.com/image.png)'
      const result = await addUploadsFromContent(mockClient, mockQuery, mockUploadsPath, content)
      assert.strictEqual(result.uploads.length, 1)
    })

    it('should skip relative URLs starting with ./', async () => {
      const content = '![Image](./uploads/image.jpg)'
      const result = await addUploadsFromContent(mockClient, mockQuery, mockUploadsPath, content)
      assert.strictEqual(result.uploads.length, 0)
    })

    it('should skip relative URLs starting with ../', async () => {
      const content = '![Image](../images/photo.png)'
      const result = await addUploadsFromContent(mockClient, mockQuery, mockUploadsPath, content)
      assert.strictEqual(result.uploads.length, 0)
    })

    it('should skip absolute path URLs starting with /', async () => {
      const content = '![Image](/uploads/image.jpg)'
      const result = await addUploadsFromContent(mockClient, mockQuery, mockUploadsPath, content)
      assert.strictEqual(result.uploads.length, 0)
    })

    it('should skip uploads/ relative URLs', async () => {
      const content = '![Image](uploads/photo.jpg)'
      const result = await addUploadsFromContent(mockClient, mockQuery, mockUploadsPath, content)
      assert.strictEqual(result.uploads.length, 0)
    })

    it('should skip data URLs', async () => {
      const content = '<img src="data:image/png;base64,iVBORw0KGgo=">'
      const result = await addUploadsFromContent(mockClient, mockQuery, mockUploadsPath, content)
      assert.strictEqual(result.uploads.length, 0)
    })

    it('should handle URLs with query parameters', async () => {
      const content = '![Image](https://example.com/image.jpg?size=large)'
      const result = await addUploadsFromContent(mockClient, mockQuery, mockUploadsPath, content)
      assert.strictEqual(result.uploads.length, 1)
    })

    it('should handle URLs with fragments', async () => {
      const content = '![Image](https://example.com/image.jpg#section)'
      const result = await addUploadsFromContent(mockClient, mockQuery, mockUploadsPath, content)
      assert.strictEqual(result.uploads.length, 1)
    })
  })

  describe('HTML image extraction (extractHtmlImages behavior)', () => {
    it('should extract image with double-quoted src', async () => {
      const content = '<img src="https://example.com/photo.jpg">'
      const result = await addUploadsFromContent(mockClient, mockQuery, mockUploadsPath, content)
      assert.strictEqual(result.uploads.length, 1)
      assert.strictEqual(result.uploads[0].original.url, 'https://example.com/photo.jpg')
      assert.strictEqual(result.uploads[0].original.type, 'html')
    })

    it('should extract image with single-quoted src', async () => {
      const content = "<img src='https://example.com/photo.jpg'>"
      const result = await addUploadsFromContent(mockClient, mockQuery, mockUploadsPath, content)
      assert.strictEqual(result.uploads.length, 1)
      assert.strictEqual(result.uploads[0].original.url, 'https://example.com/photo.jpg')
    })

    it('should extract alt text when present', async () => {
      const content = '<img src="https://example.com/photo.jpg" alt="A beautiful photo">'
      const result = await addUploadsFromContent(mockClient, mockQuery, mockUploadsPath, content)
      assert.strictEqual(result.uploads.length, 1)
      assert.strictEqual(result.uploads[0].original.alt, 'A beautiful photo')
    })

    it('should extract multiple HTML images', async () => {
      const content = `
        <img src="https://example.com/photo1.jpg">
        <img src="https://example.com/photo2.png">
      `
      const result = await addUploadsFromContent(mockClient, mockQuery, mockUploadsPath, content)
      assert.strictEqual(result.uploads.length, 2)
    })

    it('should handle img tags with other attributes', async () => {
      const content = '<img class="hero" src="https://example.com/hero.jpg" width="100" height="50">'
      const result = await addUploadsFromContent(mockClient, mockQuery, mockUploadsPath, content)
      assert.strictEqual(result.uploads.length, 1)
      assert.strictEqual(result.uploads[0].original.url, 'https://example.com/hero.jpg')
    })

    it('should preserve the full match for replacement', async () => {
      const content = '<img src="https://example.com/photo.jpg" alt="Photo">'
      const result = await addUploadsFromContent(mockClient, mockQuery, mockUploadsPath, content)
      assert.strictEqual(result.uploads[0].original.match, content)
    })
  })

  describe('Markdown image extraction (extractMarkdownImages behavior)', () => {
    it('should extract simple markdown image', async () => {
      const content = '![Alt text](https://example.com/photo.jpg)'
      const result = await addUploadsFromContent(mockClient, mockQuery, mockUploadsPath, content)
      assert.strictEqual(result.uploads.length, 1)
      assert.strictEqual(result.uploads[0].original.url, 'https://example.com/photo.jpg')
      assert.strictEqual(result.uploads[0].original.alt, 'Alt text')
      assert.strictEqual(result.uploads[0].original.type, 'markdown')
    })

    it('should extract image with empty alt', async () => {
      const content = '![](https://example.com/photo.jpg)'
      const result = await addUploadsFromContent(mockClient, mockQuery, mockUploadsPath, content)
      assert.strictEqual(result.uploads.length, 1)
      assert.strictEqual(result.uploads[0].original.url, 'https://example.com/photo.jpg')
      assert.strictEqual(result.uploads[0].original.alt, undefined)
    })

    it('should extract image with title', async () => {
      const content = '![Alt](https://example.com/photo.jpg "Image title")'
      const result = await addUploadsFromContent(mockClient, mockQuery, mockUploadsPath, content)
      assert.strictEqual(result.uploads.length, 1)
      assert.strictEqual(result.uploads[0].original.url, 'https://example.com/photo.jpg')
    })

    it('should extract multiple markdown images', async () => {
      const content = `
        ![First](https://example.com/first.jpg)
        Some text in between
        ![Second](https://example.com/second.png)
      `
      const result = await addUploadsFromContent(mockClient, mockQuery, mockUploadsPath, content)
      assert.strictEqual(result.uploads.length, 2)
    })

    it('should preserve the full match for replacement', async () => {
      const content = '![Alt text](https://example.com/photo.jpg)'
      const result = await addUploadsFromContent(mockClient, mockQuery, mockUploadsPath, content)
      assert.strictEqual(result.uploads[0].original.match, content)
    })

    it('should not confuse with regular links', async () => {
      const content = '[Link text](https://example.com/page.html)'
      const result = await addUploadsFromContent(mockClient, mockQuery, mockUploadsPath, content)
      assert.strictEqual(result.uploads.length, 0)
    })
  })

  describe('combined extraction', () => {
    it('should extract both HTML and Markdown images', async () => {
      const content = `
        <img src="https://example.com/html.jpg">
        ![Markdown](https://example.com/md.png)
      `
      const result = await addUploadsFromContent(mockClient, mockQuery, mockUploadsPath, content)
      assert.strictEqual(result.uploads.length, 2)
    })

    it('should deduplicate images by URL', async () => {
      const content = `
        <img src="https://example.com/same.jpg">
        ![Same image](https://example.com/same.jpg)
      `
      const result = await addUploadsFromContent(mockClient, mockQuery, mockUploadsPath, content)
      assert.strictEqual(result.uploads.length, 1)
    })

    it('should return empty array for content without foreign images', async () => {
      const content = `
        <img src="./uploads/local.jpg">
        ![Local](../images/local.png)
      `
      const result = await addUploadsFromContent(mockClient, mockQuery, mockUploadsPath, content)
      assert.strictEqual(result.uploads.length, 0)
    })
  })
})
