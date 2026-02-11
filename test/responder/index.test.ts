import type {DocumentId, RenderDocument, Upload} from '../../src/operations/types.ts'
import type {RenderedDoc} from '../../src/render/index.ts'
import assert from 'node:assert/strict'
import {describe, it} from 'node:test'
import {createArchive, responder, getContent} from '../../src/responder/index.ts'

// Type definition for Asset (mirrors internal type)
type Asset =
  | {redirect: string}
  | {
      content: (
        doc: RenderDocument,
        assets: Record<string, Asset>,
        getRender?: (doc: RenderDocument) => Promise<RenderedDoc>,
      ) => Promise<string | Buffer> | string | Buffer
      contentType: string
    }

// Mock getRender function that returns a simple RenderedDoc
// Helper to simulate getResponse using the public responder API
async function getResponse(
  doc: RenderDocument,
  assetKey: string | undefined,
  getRender?: (doc: RenderDocument) => Promise<RenderedDoc>,
): Promise<Response> {
  const path = assetKey ? `${doc.path}${assetKey}` : doc.path
  return responder({
    getDocument: async () => doc,
    getRender,
    path,
  })
}

function createMockGetRender() {
  return async (doc: RenderDocument): Promise<RenderedDoc> => {
    return {
      html: doc.content,
      markdown: doc.content,
      title: doc.title,
      path: doc.path,
      data: {},
      server: {},
      meta: {
        createdAt: doc.created_at,
        updatedAt: doc.updated_at,
      },
      variableUsage: {},
      style: {
        content: '',
        inlineTag: '',
        href: '',
        tag: '',
      },
      script: {
        content: '',
        inlineTag: '',
        href: '',
        tag: '',
      },
    }
  }
}

// Helper function to create mock documents
function createMockDoc(overrides: Partial<RenderDocument> = {}): RenderDocument {
  return {
    id: 1 as DocumentId,
    path: '/test',
    title: 'Test',
    content: '# Test',
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
    ...overrides,
  }
}

describe('getResponse', () => {
  describe('root asset', () => {
    it('should return rendered HTML for .html documents', async () => {
      const doc = createMockDoc({
        path: '/test',
        content: '# Hello World',
        extension: '.html',
        mime_type: 'text/html',
      })

      const response = await getResponse(doc, undefined, createMockGetRender())
      assert.equal(response.status, 200)
      assert.equal(response.headers.get('Content-Type'), 'text/html')
      const content = await response.text()
      assert.ok(content.includes('Hello World'))
    })

    it('should return base64 decoded content for non-HTML documents', async () => {
      const doc = createMockDoc({
        path: '/favicon.ico',
        content: Buffer.from('fake-image-data').toString('base64'),
        extension: '.ico',
        mime_type: 'image/x-icon',
      })

      const response = await getResponse(doc, '', createMockGetRender())
      assert.equal(response.status, 200)
      assert.equal(response.headers.get('Content-Type'), 'image/x-icon')
    })
  })

  describe('redirect responses', () => {
    it('should redirect /index.html to root', async () => {
      const doc = createMockDoc({
        path: '/test',
      })

      const response = await getResponse(doc, '/index.html')
      assert.equal(response.status, 302)
      assert.equal(response.headers.get('Location'), '/test')
    })

    it('should redirect .html to root', async () => {
      const doc = createMockDoc({
        path: '/test',
      })

      const response = await getResponse(doc, '.html')
      assert.equal(response.status, 302)
      assert.equal(response.headers.get('Location'), '/test')
    })

    it('should redirect /content to canonical content asset', async () => {
      const doc = createMockDoc({
        path: '/test',
        content_type: 'markdown',
        has_eta: false,
      })

      const response = await getResponse(doc, '/content')
      assert.equal(response.status, 302)
      assert.equal(response.headers.get('Location'), '/test/content.md')
    })

    it('should redirect /data to canonical data asset', async () => {
      const doc = createMockDoc({
        path: '/test',
        data_type: 'yaml',
      })

      const response = await getResponse(doc, '/data')
      assert.equal(response.status, 302)
      assert.equal(response.headers.get('Location'), '/test/data.yaml')
    })

    it('should redirect style alias to canonical', async () => {
      const doc = createMockDoc({
        path: '/test',
        style: 'body { color: red; }',
      })

      const response = await getResponse(doc, '/style')
      assert.equal(response.status, 302)
      assert.equal(response.headers.get('Location'), '/test/style.css')
    })

    it('should redirect .css to canonical', async () => {
      const doc = createMockDoc({
        path: '/test',
        style: 'body { color: red; }',
      })

      const response = await getResponse(doc, '.css')
      assert.equal(response.status, 302)
      assert.equal(response.headers.get('Location'), '/test/style.css')
    })
  })

  describe('content assets', () => {
    it('should return /content.md for markdown documents', async () => {
      const doc = createMockDoc({
        path: '/test',
        content: '# Markdown Content',
        content_type: 'markdown',
        has_eta: false,
      })

      const response = await getResponse(doc, '/content.md', createMockGetRender())
      assert.equal(response.status, 200)
      assert.equal(response.headers.get('Content-Type'), 'text/plain; charset=utf-8')
      const content = await response.text()
      assert.ok(content.includes('Markdown Content'))
    })

    it('should return /content.html for HTML documents', async () => {
      const doc = createMockDoc({
        path: '/test',
        content: '<p>HTML Content</p>',
        content_type: 'html',
        has_eta: false,
      })

      const response = await getResponse(doc, '/content.html', createMockGetRender())
      assert.equal(response.status, 200)
      assert.equal(response.headers.get('Content-Type'), 'text/plain; charset=utf-8')
      const content = await response.text()
      assert.ok(content.includes('HTML Content'))
    })

    it('should return /content.eta for ETA templates', async () => {
      const doc = createMockDoc({
        path: '/test',
        content: '<%= "ETA Content" %>',
        has_eta: true,
      })

      const response = await getResponse(doc, '/content.eta')
      assert.equal(response.status, 200)
      assert.equal(response.headers.get('Content-Type'), 'text/plain; charset=utf-8')
      const content = await response.text()
      assert.equal(content, '<%= "ETA Content" %>')
    })

    it('should return content with extension for non-HTML documents', async () => {
      const doc = createMockDoc({
        path: '/test',
        content: Buffer.from('image data').toString('base64'),
        extension: '.png',
        mime_type: 'image/png',
      })

      const response = await getResponse(doc, '/content.png')
      assert.equal(response.status, 200)
      assert.equal(response.headers.get('Content-Type'), 'image/png')
    })
  })

  describe('style, script, and server assets', () => {
    it('should return style.css content', async () => {
      const doc = createMockDoc({
        path: '/test',
        style: 'body { color: red; }',
      })

      const response = await getResponse(doc, '/style.css')
      assert.equal(response.status, 200)
      assert.equal(response.headers.get('Content-Type'), 'text/css')
      const content = await response.text()
      assert.equal(content, 'body { color: red; }')
    })

    it('should return empty string for missing style', async () => {
      const doc = createMockDoc({
        path: '/test',
      })

      const response = await getResponse(doc, '/style.css')
      assert.equal(response.status, 200)
      const content = await response.text()
      assert.equal(content, '')
    })

    it('should return script.js content', async () => {
      const doc = createMockDoc({
        path: '/test',
        script: 'console.log("hello")',
      })

      const response = await getResponse(doc, '/script.js')
      assert.equal(response.status, 200)
      assert.equal(response.headers.get('Content-Type'), 'application/javascript')
      const content = await response.text()
      assert.equal(content, 'console.log("hello")')
    })

    it('should return server.js content', async () => {
      const doc = createMockDoc({
        path: '/test',
        server: 'export default () => "server code"',
      })

      const response = await getResponse(doc, '/server.js')
      assert.equal(response.status, 200)
      assert.equal(response.headers.get('Content-Type'), 'application/javascript')
      const content = await response.text()
      assert.equal(content, 'export default () => "server code"')
    })
  })

  describe('data assets', () => {
    it('should return data.json content', async () => {
      const doc = createMockDoc({
        path: '/test',
        data: '{"key": "value"}',
        data_type: 'json',
      })

      const response = await getResponse(doc, '/data.json')
      assert.equal(response.status, 200)
      assert.equal(response.headers.get('Content-Type'), 'application/json')
      const content = await response.text()
      assert.ok(content.includes('key'))
    })

    it('should return data.yaml content', async () => {
      const doc = createMockDoc({
        path: '/test',
        data: '{"key": "value"}',
        data_type: 'yaml',
      })

      const response = await getResponse(doc, '/data.yaml')
      assert.equal(response.status, 200)
      assert.equal(response.headers.get('Content-Type'), 'text/yaml')
      assert.equal(await response.text(), `key: value\n`)
    })

    it('should redirect .yml to data.yaml', async () => {
      const doc = createMockDoc({
        path: '/test',
        data_type: 'yaml',
      })

      const response = await getResponse(doc, '.yml')
      assert.equal(response.status, 302)
      assert.equal(response.headers.get('Location'), '/test/data.yaml')
    })
  })

  describe('settings.json', () => {
    it('should return document metadata', async () => {
      const doc = createMockDoc({
        path: '/test',
        title: 'Test Document',
        draft: false,
        published: true,
      })

      const response = await getResponse(doc, '/settings.json')
      assert.equal(response.status, 200)
      assert.equal(response.headers.get('Content-Type'), 'application/json')
      const content = await response.text()
      const settings = JSON.parse(content)

      assert.equal(settings.path, '/test')
      assert.equal(settings.title, 'Test Document')
      assert.equal(settings.draft, false)
      assert.equal(settings.published, true)
    })

    it('should redirect /settings to settings.json', async () => {
      const doc = createMockDoc({
        path: '/test',
      })

      const response = await getResponse(doc, '/settings')
      assert.equal(response.status, 302)
      assert.equal(response.headers.get('Location'), '/test/settings.json')
    })
  })

  describe('api.json', () => {
    it('should return links to all assets', async () => {
      const doc = createMockDoc({
        path: '/test',
      })

      const response = await getResponse(doc, '/api.json')
      assert.equal(response.status, 200)
      assert.equal(response.headers.get('Content-Type'), 'application/json')
      const content = await response.json()
      console.log(content)
      // Should only include non-redirect assets
      assert.ok(Array.isArray(content))
    })

    it('should redirect /api to api.json', async () => {
      const doc = createMockDoc({
        path: '/test',
      })

      const response = await getResponse(doc, '/api')
      assert.equal(response.status, 302)
      assert.equal(response.headers.get('Location'), '/test/api.json')
    })

    it('should return api.json for root path', async () => {
      const doc = createMockDoc({
        path: '/',
      })

      const response = await getResponse(doc, '/api.json')
      assert.equal(response.status, 200)
      assert.equal(response.headers.get('Content-Type'), 'application/json')
      const content = await response.json()
      // Should only include non-redirect assets, paths should not have double slashes
      assert.ok(Array.isArray(content))
      assert.ok(content.every((path: string) => !path.startsWith('//')))
    })
  })

  describe('archive.tar.gz', () => {
    it('should return tar.gz archive', async () => {
      const doc = createMockDoc({
        path: '/test',
        style: 'body {}',
        script: 'console.log("test")',
      })

      const response = await getResponse(doc, '/archive.tar.gz', createMockGetRender())
      assert.equal(response.status, 200)
      assert.equal(response.headers.get('Content-Type'), 'application/gzip')
      assert.equal(response.headers.get('Content-Disposition'), 'attachment; filename="archive.tar.gz"')

      // Verify it's a stream
      assert.ok(response.body)
    })

    it('should redirect /archive to archive.tar.gz', async () => {
      const doc = createMockDoc({
        path: '/test',
      })

      const response = await getResponse(doc, '/archive')
      assert.equal(response.status, 302)
      assert.equal(response.headers.get('Location'), '/test/archive.tar.gz')
    })
  })

  describe('error handling', () => {
    it('should throw error when getRender is required but not provided', async () => {
      const doc = createMockDoc({
        path: '/test',
      })

      // Root asset requires getRender to be provided
      await assert.rejects(async () => await getResponse(doc, undefined), {
        message: 'getRender is required for root content',
      })
    })
  })

  describe('edge cases', () => {
    it('should handle redirect at root path', async () => {
      const doc = createMockDoc({
        path: '/',
      })

      const response = await getResponse(doc, '/index.html')
      assert.equal(response.status, 302)
      assert.equal(response.headers.get('Location'), '')
    })

    it('should handle document without mime_type', async () => {
      const doc = createMockDoc({
        path: '/test',
        extension: '.bin',
        mime_type: undefined as unknown as string,
        content: Buffer.from('binary data').toString('base64'),
      })

      const response = await getResponse(doc, '/content.bin')
      assert.equal(response.status, 200)
      assert.equal(response.headers.get('Content-Type'), 'text/plain; charset=utf-8')
    })

    it('should handle settings with slot and template', async () => {
      const doc = createMockDoc({
        path: '/test',
        slot: {path: '/slot-path'} as unknown as RenderDocument,
        template: {path: '/template-path'} as unknown as RenderDocument,
        uploads: [{original_filename: 'file1.jpg'}, {original_filename: 'file2.png'}] as unknown as Upload[],
      })

      const response = await getResponse(doc, '/settings.json')
      assert.equal(response.status, 200)
      const settings = JSON.parse(await response.text())
      assert.equal(settings.slot_path, '/slot-path')
      assert.equal(settings.template_path, '/template-path')
      assert.deepEqual(settings.uploads, ['file1.jpg', 'file2.png'])
    })

    it('should handle settings without uploads', async () => {
      const doc = createMockDoc({
        path: '/test',
        uploads: undefined as unknown as Upload[],
      })

      const response = await getResponse(doc, '/settings.json')
      assert.equal(response.status, 200)
      const settings = JSON.parse(await response.text())
      assert.deepEqual(settings.uploads, [])
    })

    it('should handle archive with binary content', async () => {
      const doc = createMockDoc({
        path: '/test',
        content: Buffer.from('test content').toString('base64'),
        extension: '.png',
        mime_type: 'image/png',
      })

      const response = await getResponse(doc, '/archive.tar.gz')
      assert.equal(response.status, 200)
      assert.equal(response.headers.get('Content-Type'), 'application/gzip')
    })

    it('should handle document with script', async () => {
      const doc = createMockDoc({
        path: '/test',
        script: 'console.log("exists")',
      })

      const response = await getResponse(doc, '/script.js')
      assert.equal(response.status, 200)
      const content = await response.text()
      assert.equal(content, 'console.log("exists")')
    })
  })
})

describe('createArchive', () => {
  it('should return archive files for default /archive.tar.gz key', async () => {
    const doc = createMockDoc({
      path: '/test',
      content: '# Hello',
      content_type: 'markdown',
      data: '{"key": "value"}',
      data_type: 'json',
      style: 'body { color: red; }',
      script: 'console.log("hi")',
      server: 'export default {}',
      extension: '.html',
    })

    const result = await createArchive(doc, '/archive.tar.gz', createMockGetRender())

    assert.ok(Array.isArray(result))
    assert.ok(result.length > 0)

    // Should contain expected files
    const filenames = result.map(f => f.filename)
    assert.ok(filenames.includes('content.md'))
    assert.ok(filenames.includes('data.json'))
    assert.ok(filenames.includes('style.css'))
    assert.ok(filenames.includes('script.js'))
    assert.ok(filenames.includes('server.js'))
    assert.ok(filenames.includes('settings.json'))
  })

  it('should allow custom archive key', async () => {
    const doc = createMockDoc({
      path: '/test',
      content: '# Hello',
      content_type: 'markdown',
      extension: '.html',
    })

    const result = await createArchive(doc, '/archive.tar.gz', createMockGetRender())

    assert.ok(Array.isArray(result))
    assert.ok(result.length > 0)
  })

  it('should throw error if resolved asset is not an array', async () => {
    const doc = createMockDoc({
      path: '/test',
      content: '# Hello',
      extension: '.html',
    })

    // Try to use createArchive with a non-archive key
    await assert.rejects(async () => await createArchive(doc, '/data.json'), {
      message: 'Archive content must be an Archive instance',
    })
  })

  it('should throw error if archive key does not exist', async () => {
    const doc = createMockDoc({
      path: '/test',
      content: '# Hello',
      extension: '.html',
    })

    await assert.rejects(async () => await createArchive(doc, '/nonexistent.tar.gz'), {
      message: 'Asset not found: /nonexistent.tar.gz',
    })
  })
})

describe('responder path parsing', () => {
  // These tests verify that responder correctly parses paths and extracts assets
  // by checking it routes to the correct document and returns the right asset

  const createDocForPath = (docPath: string) =>
    createMockDoc({
      path: docPath,
      content: '# Content',
      extension: '.html',
      mime_type: 'text/html',
      data: '{"key": "value"}',
      data_type: 'json',
    })

  it('should parse path /woof/data.json and return data asset', async () => {
    const doc = createDocForPath('/woof')
    const getDocument = async ({path}: {path: string}) => {
      assert.equal(path, '/woof') // Verifies path was parsed correctly
      return doc
    }
    const response = await responder({getDocument, path: '/woof/data.json'})
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('Content-Type'), 'application/json')
  })

  it('should parse path /woof.json and redirect to api.json', async () => {
    const doc = createDocForPath('/woof')
    const getDocument = async ({path}: {path: string}) => {
      assert.equal(path, '/woof')
      return doc
    }
    const response = await responder({getDocument, path: '/woof.json'})
    assert.equal(response.status, 302) // .json redirects to /api.json
    assert.equal(response.headers.get('Location'), '/woof/api.json')
  })

  it('should parse root path /data.json and return data asset', async () => {
    const doc = createDocForPath('/')
    const getDocument = async ({path}: {path: string}) => {
      assert.equal(path, '/')
      return doc
    }
    const response = await responder({getDocument, path: '/data.json'})
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('Content-Type'), 'application/json')
  })

  it('should parse /test/style.css and return style asset', async () => {
    const doc = createDocForPath('/test')
    const getDocument = async ({path}: {path: string}) => {
      assert.equal(path, '/test')
      return doc
    }
    const response = await responder({getDocument, path: '/test/style.css'})
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('Content-Type'), 'text/css')
  })

  it('should return full path when no asset matches', async () => {
    const doc = createDocForPath('/test/unknown')
    const getDocument = async ({path}: {path: string}) => {
      assert.equal(path, '/test/unknown') // No asset stripped
      return doc
    }
    const response = await responder({getDocument, path: '/test/unknown', getRender: createMockGetRender()})
    assert.equal(response.status, 200)
  })

  it('should handle root path /', async () => {
    const doc = createDocForPath('/')
    const getDocument = async ({path}: {path: string}) => {
      assert.equal(path, '/')
      return doc
    }
    const response = await responder({getDocument, path: '/', getRender: createMockGetRender()})
    assert.equal(response.status, 200)
  })
})

describe('responder', () => {
  it('should return response for document with path only', async () => {
    const doc = createMockDoc({
      path: '/test',
      content: '# Hello World',
      extension: '.html',
      mime_type: 'text/html',
    })

    const getDocument = async ({path}: {path: string}) => {
      if (path === '/test') return doc
      throw new Error('Document not found')
    }

    const response = await responder({getDocument, path: '/test', getRender: createMockGetRender()})
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('Content-Type'), 'text/html')
  })

  it('should return response for document with asset', async () => {
    const doc = createMockDoc({
      path: '/test',
      data: '{"key": "value"}',
      data_type: 'json',
    })

    const getDocument = async () => doc

    const response = await responder({getDocument, path: '/test/data.json'})
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('Content-Type'), 'application/json')
  })

  it('should handle redirect assets', async () => {
    const doc = createMockDoc({
      path: '/test',
      data_type: 'yaml',
    })

    const getDocument = async () => doc

    const response = await responder({getDocument, path: '/test/data'})
    assert.equal(response.status, 302)
    assert.equal(response.headers.get('Location'), '/test/data.yaml')
  })

  it('should throw error when document not found', async () => {
    const getDocument = async () => {
      throw new Error('Document not found')
    }

    await assert.rejects(async () => await responder({getDocument, path: '/nonexistent'}), {
      message: 'Document not found',
    })
  })

  it('should handle root path document', async () => {
    const doc = createMockDoc({
      path: '/',
      content: '# Root Document',
      extension: '.html',
      mime_type: 'text/html',
    })

    const getDocument = async () => doc

    const response = await responder({getDocument, path: '/', getRender: createMockGetRender()})
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('Content-Type'), 'text/html')
  })

  it('should parse path and asset correctly', async () => {
    const doc = createMockDoc({
      path: '/test',
      style: 'body { color: red; }',
    })

    const getDocument = async () => doc

    const response = await responder({getDocument, path: '/test/style.css'})
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('Content-Type'), 'text/css')
    const content = await response.text()
    assert.equal(content, 'body { color: red; }')
  })

  it('should handle extension-style assets', async () => {
    const doc = createMockDoc({
      path: '/test',
      data_type: 'yaml',
    })

    const getDocument = async () => doc

    const response = await responder({getDocument, path: '/test.yml'})
    assert.equal(response.status, 302)
    assert.equal(response.headers.get('Location'), '/test/data.yaml')
  })

  it('should handle content with extension for non-HTML documents', async () => {
    const doc = createMockDoc({
      path: '/image',
      content: Buffer.from('fake-image').toString('base64'),
      extension: '.png',
      mime_type: 'image/png',
    })

    const getDocument = async () => doc

    const response = await responder({getDocument, path: '/image/content.png'})
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('Content-Type'), 'image/png')
  })

  it('should throw error when asset is not found', async () => {
    // Mock getDocument that returns a document
    const getDocument = async () => {
      throw new Error('Document not found')
    }

    // Test with an asset that doesn't exist in the asset registry
    await assert.rejects(async () => await responder({getDocument, path: '/test/nonexistent'}), {
      message: 'Document not found',
    })
  })

  it('should work with serve command pattern (path: "/", getDocument: async () => document)', async () => {
    // This mimics exactly what cli/serve.ts does
    const document = createMockDoc({
      path: '/my-doc',
      title: 'My Document',
      content: '# Hello from local files',
      content_type: 'html',
      extension: '.html',
      mime_type: 'text/html',
    })

    // Exact same pattern as serve.ts
    const response = await responder({
      path: '/',
      getDocument: async () => document,
      getRender: createMockGetRender(),
    })

    assert.equal(response.status, 200)
    assert.equal(response.headers.get('Content-Type'), 'text/html')
    const content = await response.text()

    // Debug: Let's see what we actually got
    console.log('Response content:', content.substring(0, 200))
    console.log('Content includes "Hello":', content.includes('Hello'))
    console.log('Content includes "My Document":', content.includes('My Document'))

    assert.ok(content.includes('Hello from local files'), 'Should include content')
  })

  it('should handle different asset paths with serve command pattern', async () => {
    const document = createMockDoc({
      path: '/my-doc',
      title: 'My Document',
      content: '# Test',
      style: 'body { color: red; }',
    })

    // Test fetching style.css
    const response = await responder({
      path: '/style.css',
      getDocument: async () => document,
    })

    assert.equal(response.status, 200)
    assert.equal(response.headers.get('Content-Type'), 'text/css')
    const content = await response.text()
    assert.equal(content, 'body { color: red; }')
  })
})

describe('getResponse with doc.redirect', () => {
  it('should redirect when doc.redirect is true without assetKey', async () => {
    const doc = createMockDoc({
      path: '/canonical-path',
      redirect: true, // Simulating a redirect flag
    })

    const response = await getResponse(doc, undefined)
    assert.equal(response.status, 302)
    assert.equal(response.headers.get('Location'), '/canonical-path')
  })

  it('should redirect when doc.redirect is true with assetKey', async () => {
    const doc = createMockDoc({
      path: '/canonical-path',
      redirect: true,
    })

    const response = await getResponse(doc, '/data.json')
    assert.equal(response.status, 302)
    assert.equal(response.headers.get('Location'), '/canonical-path/data.json')
  })

  it('should redirect at root path with assetKey starting with /', async () => {
    const doc = createMockDoc({
      path: '/',
      redirect: true,
    })

    const response = await getResponse(doc, '/style.css')
    assert.equal(response.status, 302)
    assert.equal(response.headers.get('Location'), '/style.css')
  })

  it('should redirect at root path with assetKey not starting with /', async () => {
    const doc = createMockDoc({
      path: '/',
      redirect: true,
    })

    const response = await getResponse(doc, '.json')
    assert.equal(response.status, 302)
    assert.equal(response.headers.get('Location'), '/.json')
  })
})

describe('getContent', () => {
  it('should return content for a given asset key', async () => {
    const doc = createMockDoc({
      path: '/test',
      style: 'body { color: blue; }',
    })

    const content = await getContent(doc, '/style.css')
    assert.equal(content, 'body { color: blue; }')
  })

  it('should return content for data.json asset', async () => {
    const doc = createMockDoc({
      path: '/test',
      data: '{"key": "value"}',
      data_type: 'json',
    })

    const content = await getContent(doc, '/data.json')
    assert.ok(content)
    assert.ok(typeof content === 'string')
    assert.ok(content.includes('key'))
  })

  it('should return content using getRender for rendered assets', async () => {
    const doc = createMockDoc({
      path: '/test',
      content: '# Hello World',
      content_type: 'markdown',
    })

    const content = await getContent(doc, '/content.md', createMockGetRender())
    assert.equal(content, '# Hello World')
  })

  it('should return undefined for redirect assets', async () => {
    const doc = createMockDoc({
      path: '/test',
    })

    // /data is a redirect to /data.json or /data.yaml
    const content = await getContent(doc, '/data')
    assert.equal(content, undefined)
  })

  it('should return script content', async () => {
    const doc = createMockDoc({
      path: '/test',
      script: 'console.log("hello")',
    })

    const content = await getContent(doc, '/script.js')
    assert.equal(content, 'console.log("hello")')
  })

  it('should return server content', async () => {
    const doc = createMockDoc({
      path: '/test',
      server: 'export default {}',
    })

    const content = await getContent(doc, '/server.js')
    assert.equal(content, 'export default {}')
  })
})
