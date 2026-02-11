import assert from 'node:assert/strict'
import {describe, it} from 'node:test'
import {htmlEditorPage} from '../../../src/server/utils/htmlEditorPage.ts'
import type {RenderDocument, Upload, Route, DocumentId} from '../../../src/operations/types.ts'

// Helper to create a minimal valid RenderDocument
function createMockDocument(overrides: Partial<RenderDocument> = {}): RenderDocument {
  return {
    id: 1 as DocumentId,
    path: '/test-doc',
    title: 'Test Document',
    content: '# Hello World',
    content_type: 'markdown',
    data: '{"key": "value"}',
    data_type: 'json',
    style: 'body { color: red; }',
    script: 'console.log("test")',
    server: '',
    template_id: null,
    slot_id: null,
    mime_type: 'text/html; charset=UTF-8',
    extension: '.html',
    has_eta: false,
    published: false,
    created_at: new Date('2024-01-01'),
    updated_at: new Date('2024-01-02'),
    uploads: [],
    redirects: [],
    draft: false,
    redirect: false,
    ...overrides,
  }
}

// Helper to create a mock Upload
function createMockUpload(overrides: Partial<Upload> = {}): Upload {
  return {
    id: 1 as unknown as Upload['id'],
    filename: 'abc123.png',
    document_id: 1 as DocumentId,
    created_at: new Date('2024-01-01'),
    original_filename: 'test-image.png',
    hidden: false,
    hash: 'sha256:0000000000000000000000000000000000000000000000000000000000000000',
    ...overrides,
  }
}

// Helper to create a mock Route (redirect)
function createMockRedirect(overrides: Partial<Route> = {}): Route {
  return {
    id: 1 as unknown as Route['id'],
    path: '/old-path',
    document_id: 1 as DocumentId,
    created_at: new Date('2024-01-01'),
    ...overrides,
  }
}

describe('renderEditor', () => {
  describe('basic rendering', () => {
    it('should return a Response object', () => {
      const result = htmlEditorPage({state: null})
      assert.ok(result instanceof Response)
    })

    it('should return 200 status', () => {
      const result = htmlEditorPage({state: null})
      assert.equal(result.status, 200)
    })

    it('should return HTML content type', () => {
      const result = htmlEditorPage({state: null})
      assert.equal(result.headers.get('Content-Type'), 'text/html; charset=utf-8')
    })
  })

  describe('null state handling', () => {
    it('should create default state when state is null', async () => {
      const result = htmlEditorPage({state: null})
      const html = await result.text()
      assert.ok(html.includes('<!DOCTYPE html>'))
      assert.ok(html.includes('editor-container'))
    })

    it('should use fallbackPath when state is null', async () => {
      const result = htmlEditorPage({state: null, fallbackPath: '/new-document'})
      const html = await result.text()
      assert.ok(html.includes('/new-document'))
    })

    it('should default to "/" path when no fallbackPath provided', async () => {
      const result = htmlEditorPage({state: null})
      const html = await result.text()
      assert.ok(html.includes('value="/"'))
    })

    it('should disable publish button for new documents', async () => {
      const result = htmlEditorPage({state: null})
      const html = await result.text()
      // New documents have id: 0 which should disable publish button
      assert.ok(html.includes('id="publish-btn"'))
      assert.ok(html.includes('disabled'))
    })
  })

  describe('document state rendering', () => {
    it('should render document path in slug input', async () => {
      const doc = createMockDocument({path: '/my-custom-path'})
      const result = htmlEditorPage({state: {document: doc, render: {html: ''}, api: []}})
      const html = await result.text()
      assert.ok(html.includes('value="/my-custom-path"'))
    })

    it('should render document title in settings', async () => {
      const doc = createMockDocument({title: 'My Test Title'})
      const result = htmlEditorPage({state: {document: doc, render: {html: ''}, api: []}})
      const html = await result.text()
      assert.ok(html.includes('value="My Test Title"'))
    })

    it('should render document content in textarea', async () => {
      const doc = createMockDocument({content: '# Test Content Here'})
      const result = htmlEditorPage({state: {document: doc, render: {html: ''}, api: []}})
      const html = await result.text()
      assert.ok(html.includes('# Test Content Here'))
    })

    it('should escape HTML in document content', async () => {
      const doc = createMockDocument({content: '<script>alert("xss")</script>'})
      const result = htmlEditorPage({state: {document: doc, render: {html: ''}, api: []}})
      const html = await result.text()
      assert.ok(html.includes('&lt;script&gt;'))
      assert.ok(!html.includes('<script>alert'))
    })

    it('should render document data in data textarea', async () => {
      const doc = createMockDocument({data: '{"test": "data"}'})
      const result = htmlEditorPage({state: {document: doc, render: {html: ''}, api: []}})
      const html = await result.text()
      // Quotes get escaped in HTML attributes
      assert.ok(html.includes('{&quot;test&quot;: &quot;data&quot;}'))
    })

    it('should render document style in style textarea', async () => {
      const doc = createMockDocument({style: '.test { color: blue; }'})
      const result = htmlEditorPage({state: {document: doc, render: {html: ''}, api: []}})
      const html = await result.text()
      assert.ok(html.includes('.test { color: blue; }'))
    })

    it('should render document script in script textarea', async () => {
      const doc = createMockDocument({script: 'console.log("script")'})
      const result = htmlEditorPage({state: {document: doc, render: {html: ''}, api: []}})
      const html = await result.text()
      // Quotes get escaped in HTML
      assert.ok(html.includes('console.log(&quot;script&quot;)'))
    })

    it('should render document server in server textarea', async () => {
      const doc = createMockDocument({server: 'return {serverData: true}'})
      const result = htmlEditorPage({state: {document: doc, render: {html: ''}, api: []}})
      const html = await result.text()
      assert.ok(html.includes('return {serverData: true}'))
    })
  })

  describe('published state', () => {
    it('should show "Unpublish" for published documents', async () => {
      const doc = createMockDocument({published: true})
      const result = htmlEditorPage({state: {document: doc, render: {html: ''}, api: []}})
      const html = await result.text()
      assert.ok(html.includes('>Unpublish</button>'))
      assert.ok(html.includes('data-published="true"'))
    })

    it('should show "Publish" for unpublished documents', async () => {
      const doc = createMockDocument({published: false})
      const result = htmlEditorPage({state: {document: doc, render: {html: ''}, api: []}})
      const html = await result.text()
      assert.ok(html.includes('>Publish</button>'))
      assert.ok(html.includes('data-published="false"'))
    })

    it('should enable view button for published documents', async () => {
      const doc = createMockDocument({published: true})
      const result = htmlEditorPage({state: {document: doc, render: {html: ''}, api: []}})
      const html = await result.text()
      // View button should not be disabled for published docs
      const viewBtnMatch = html.match(/<button[^>]*id="view-btn"[^>]*>/)?.[0]
      assert.ok(viewBtnMatch)
      assert.ok(!viewBtnMatch.includes('disabled'))
    })

    it('should disable view button for unpublished documents', async () => {
      const doc = createMockDocument({published: false})
      const result = htmlEditorPage({state: {document: doc, render: {html: ''}, api: []}})
      const html = await result.text()
      // View button should be disabled for unpublished docs
      const viewBtnMatch = html.match(/<button[^>]*id="view-btn"[^>]*>/)?.[0]
      assert.ok(viewBtnMatch)
      assert.ok(viewBtnMatch.includes('disabled'))
    })
  })

  describe('MIME type handling', () => {
    it('should render mime_type in settings input', async () => {
      const doc = createMockDocument({mime_type: 'application/xml'})
      const result = htmlEditorPage({state: {document: doc, render: {html: ''}, api: []}})
      const html = await result.text()
      assert.ok(html.includes('value="application/xml"'))
    })

    it('should wrap text/plain content in pre-styled HTML for preview', async () => {
      const doc = createMockDocument({mime_type: 'text/plain', content: 'plain text content'})
      const result = htmlEditorPage({state: {document: doc, render: {html: 'plain text content'}, api: []}})
      const html = await result.text()
      assert.ok(html.includes('white-space: pre-wrap'))
      assert.ok(html.includes('font-family: monospace'))
    })

    it('should escape HTML in text/plain preview', async () => {
      const doc = createMockDocument({mime_type: 'text/plain'})
      const result = htmlEditorPage({state: {document: doc, render: {html: '<script>alert("xss")</script>'}, api: []}})
      const html = await result.text()
      // The srcdoc should have escaped content
      const srcdocMatch = html.match(/srcdoc="([^"]*)"/)?.[1]
      assert.ok(srcdocMatch)
      assert.ok(srcdocMatch.includes('&amp;lt;script&amp;gt;'))
    })
  })

  describe('extension handling', () => {
    it('should render extension in settings input', async () => {
      const doc = createMockDocument({extension: '.xml'})
      const result = htmlEditorPage({state: {document: doc, render: {html: ''}, api: []}})
      const html = await result.text()
      assert.ok(html.includes('value=".xml"'))
    })
  })

  describe('template and slot rendering', () => {
    it('should render template info when template exists', async () => {
      const doc = createMockDocument({
        template_id: 2 as DocumentId,
        template: createMockDocument({id: 2 as DocumentId, path: '/templates/base', title: 'Base Template'}),
      })
      const result = htmlEditorPage({state: {document: doc, render: {html: ''}, api: []}})
      const html = await result.text()
      assert.ok(html.includes('Base Template'))
      assert.ok(html.includes('/templates/base'))
    })

    it('should render slot info when slot exists', async () => {
      const doc = createMockDocument({
        slot_id: 3 as DocumentId,
        slot: createMockDocument({id: 3 as DocumentId, path: '/slots/sidebar', title: 'Sidebar Slot'}),
      })
      const result = htmlEditorPage({state: {document: doc, render: {html: ''}, api: []}})
      const html = await result.text()
      assert.ok(html.includes('Sidebar Slot'))
      assert.ok(html.includes('/slots/sidebar'))
    })

    it('should hide template search input when template is selected', async () => {
      const doc = createMockDocument({
        template_id: 2 as DocumentId,
        template: createMockDocument({id: 2 as DocumentId, title: 'Template'}),
      })
      const result = htmlEditorPage({state: {document: doc, render: {html: ''}, api: []}})
      const html = await result.text()
      assert.ok(html.includes('id="template-search"'))
      assert.ok(html.includes('style="display:none;"'))
    })
  })

  describe('uploads rendering', () => {
    it('should render uploads table with document uploads', async () => {
      const uploads = [
        createMockUpload({original_filename: 'image1.png'}),
        createMockUpload({id: 2 as unknown as Upload['id'], original_filename: 'image2.jpg'}),
      ]
      const doc = createMockDocument({uploads})
      const result = htmlEditorPage({state: {document: doc, render: {html: ''}, api: []}})
      const html = await result.text()
      assert.ok(html.includes('image1.png'))
      assert.ok(html.includes('image2.jpg'))
    })

    it('should render empty uploads state', async () => {
      const doc = createMockDocument({uploads: []})
      const result = htmlEditorPage({state: {document: doc, render: {html: ''}, api: []}})
      const html = await result.text()
      assert.ok(html.includes('No uploads yet'))
    })
  })

  describe('redirects rendering', () => {
    it('should render redirects table with document redirects', async () => {
      const redirects = [
        createMockRedirect({path: '/old-url-1'}),
        createMockRedirect({id: 2 as unknown as Route['id'], path: '/old-url-2'}),
      ]
      const doc = createMockDocument({redirects})
      const result = htmlEditorPage({state: {document: doc, render: {html: ''}, api: []}})
      const html = await result.text()
      assert.ok(html.includes('/old-url-1'))
      assert.ok(html.includes('/old-url-2'))
    })

    it('should render empty redirects state', async () => {
      const doc = createMockDocument({redirects: []})
      const result = htmlEditorPage({state: {document: doc, render: {html: ''}, api: []}})
      const html = await result.text()
      assert.ok(html.includes('No redirects yet'))
    })
  })

  describe('API links rendering', () => {
    it('should render API links', async () => {
      const doc = createMockDocument()
      const api = ['http://localhost:3000/api/doc/1', 'http://localhost:3000/api/doc/1/json']
      const result = htmlEditorPage({state: {document: doc, render: {html: ''}, api}})
      const html = await result.text()
      assert.ok(html.includes('http://localhost:3000/api/doc/1'))
    })

    it('should truncate long API URLs', async () => {
      const doc = createMockDocument()
      const longUrl = 'http://localhost:3000/' + 'a'.repeat(100)
      const api = [longUrl]
      const result = htmlEditorPage({state: {document: doc, render: {html: ''}, api}})
      const html = await result.text()
      // Should contain ellipsis for truncated display text
      assert.ok(html.includes('…'))
      // But the href should have the full URL
      assert.ok(html.includes(longUrl))
    })

    it('should show "No API links" message when api array is empty', async () => {
      const doc = createMockDocument()
      const result = htmlEditorPage({state: {document: doc, render: {html: ''}, api: []}})
      const html = await result.text()
      assert.ok(html.includes('No API links until doc exists'))
    })
  })

  describe('preview rendering', () => {
    it('should render HTML preview in iframe srcdoc', async () => {
      const doc = createMockDocument()
      const renderHtml = '<h1>Preview Content</h1>'
      const result = htmlEditorPage({state: {document: doc, render: {html: renderHtml}, api: []}})
      const html = await result.text()
      assert.ok(html.includes('srcdoc='))
      // Content should be escaped in srcdoc attribute
      assert.ok(html.includes('&lt;h1&gt;Preview Content&lt;/h1&gt;'))
    })
  })

  describe('delete form rendering', () => {
    it('should render delete form with correct action for root path', async () => {
      const doc = createMockDocument({path: '/'})
      const result = htmlEditorPage({state: {document: doc, render: {html: ''}, api: []}})
      const html = await result.text()
      assert.ok(html.includes('action="/edit?remove=true"'))
    })

    it('should render delete form with correct action for non-root path', async () => {
      const doc = createMockDocument({path: '/docs/test'})
      const result = htmlEditorPage({state: {document: doc, render: {html: ''}, api: []}})
      const html = await result.text()
      assert.ok(html.includes('action="/docs/test/edit?remove=true"'))
    })
  })

  describe('logout form rendering', () => {
    it('should render logout form with correct action for root path', async () => {
      const doc = createMockDocument({path: '/'})
      const result = htmlEditorPage({state: {document: doc, render: {html: ''}, api: []}})
      const html = await result.text()
      assert.ok(html.includes('action="/edit?logout"'))
    })

    it('should render logout form with correct action for non-root path', async () => {
      const doc = createMockDocument({path: '/docs/test'})
      const result = htmlEditorPage({state: {document: doc, render: {html: ''}, api: []}})
      const html = await result.text()
      assert.ok(html.includes('action="/docs/test/edit?logout"'))
    })
  })

  describe('data-state attribute', () => {
    it('should include escaped JSON state in body data attribute', async () => {
      const doc = createMockDocument({title: 'Test "Title" & More'})
      const result = htmlEditorPage({state: {document: doc, render: {html: ''}, api: []}})
      const html = await result.text()
      assert.ok(html.includes('data-state="'))
      // JSON should be escaped for HTML attribute
      assert.ok(html.includes('&quot;'))
    })
  })

  describe('editor tabs', () => {
    it('should render all editor tabs', async () => {
      const result = htmlEditorPage({state: null})
      const html = await result.text()
      assert.ok(html.includes('data-tab="content"'))
      assert.ok(html.includes('data-tab="data"'))
      assert.ok(html.includes('data-tab="style"'))
      assert.ok(html.includes('data-tab="script"'))
      assert.ok(html.includes('data-tab="server"'))
      assert.ok(html.includes('data-tab="settings"'))
    })

    it('should have content tab active by default', async () => {
      const result = htmlEditorPage({state: null})
      const html = await result.text()
      // Content tab button should be active
      assert.ok(html.includes('class="tab-button active" data-tab="content"'))
      // Content tab panel should be active
      assert.ok(html.includes('class="tab-content active" data-tab-content="content"'))
    })
  })
})
