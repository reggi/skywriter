import {describe, it, before, after, afterEach} from 'node:test'
import assert from 'node:assert'
import {randomUUID} from 'node:crypto'
import {createDatabaseContext, closeDatabaseContext, closePool} from '../../src/db/index.ts'
import {upsert} from '../../src/operations/upsert.ts'
import {getPage} from '../../src/operations/getPage.ts'
import type {PoolClient} from 'pg'
import type {RenderDocument} from '../../src/operations/types.ts'
import type {FunctionContext} from '../../src/fn/types.ts'
import type {functionContext} from '../../src/fn/functionContext.ts'

const stubFnContext: FunctionContext = {
  getPage: async () => null,
  getPages: async () => [],
  getUploads: async () => [],
}

describe('getPage operation', () => {
  let ctx: PoolClient
  const createdDocumentIds: number[] = []

  const uniquePath = (base: string) => `${base}-${randomUUID()}`

  // Simple function context factory for testing
  const createFunctionContext: typeof functionContext = (_client, _doc, _requestQuery) => stubFnContext

  before(async () => {
    ctx = await createDatabaseContext()
  })

  afterEach(async () => {
    // Clean up all created documents and related data
    for (const docId of createdDocumentIds) {
      try {
        await ctx.query(`DELETE FROM documents WHERE id = $1`, [docId])
        await ctx.query(
          `DELETE FROM document_records 
           WHERE id NOT IN (
             SELECT current_record_id FROM documents WHERE current_record_id IS NOT NULL
             UNION
             SELECT draft_record_id FROM documents WHERE draft_record_id IS NOT NULL
           )`,
        )
      } catch (error) {
        console.error(`Failed to clean up document ${docId}:`, error)
      }
    }
    createdDocumentIds.length = 0
  })

  after(async () => {
    await closeDatabaseContext(ctx)
    await closePool()
  })

  describe('basic functionality', () => {
    it('should return rendered document by path string', async () => {
      const docPath = uniquePath('/getpage-test')
      const doc = await upsert(ctx, {
        path: docPath,
        title: 'Test Page',
        content: '<h1>Hello World</h1>',
        draft: false,
        published: true,
      })

      createdDocumentIds.push(doc.current!.id)

      const result = await getPage(ctx, docPath, undefined, createFunctionContext)

      assert.ok(result, 'Should return a rendered document')
      assert.ok(result.html, 'Should have rendered HTML')
      assert.ok(result.html.includes('Hello World'), 'HTML should contain content')
    })

    it('should return rendered document by path object', async () => {
      const docPath = uniquePath('/getpage-path-obj')
      const doc = await upsert(ctx, {
        path: docPath,
        title: 'Path Object Test',
        content: '<p>Content here</p>',
        draft: false,
        published: true,
      })

      createdDocumentIds.push(doc.current!.id)

      const result = await getPage(ctx, {path: docPath}, undefined, createFunctionContext)

      assert.ok(result, 'Should return a rendered document')
      assert.ok(result.html.includes('Content here'), 'HTML should contain content')
    })

    it('should return rendered document by id', async () => {
      const docPath = uniquePath('/getpage-by-id')
      const doc = await upsert(ctx, {
        path: docPath,
        title: 'By ID Test',
        content: '<div>ID lookup content</div>',
        draft: false,
        published: true,
      })

      createdDocumentIds.push(doc.current!.id)

      const result = await getPage(ctx, {id: doc.current!.id}, undefined, createFunctionContext)

      assert.ok(result, 'Should return a rendered document')
      assert.ok(result.html.includes('ID lookup content'), 'HTML should contain content')
    })

    it('should return null for non-existent document', async () => {
      const result = await getPage(ctx, '/does-not-exist-page', undefined, createFunctionContext)
      assert.strictEqual(result, null, 'Should return null for non-existent document')
    })

    it('should return null for non-existent path object', async () => {
      const result = await getPage(ctx, {path: '/also-does-not-exist'}, undefined, createFunctionContext)
      assert.strictEqual(result, null, 'Should return null for non-existent path object')
    })
  })

  describe('request query handling', () => {
    it('should accept request query parameters', async () => {
      const docPath = uniquePath('/getpage-query')
      const doc = await upsert(ctx, {
        path: docPath,
        title: 'Query Test',
        content: '<p>Query test content</p>',
        draft: false,
        published: true,
      })

      createdDocumentIds.push(doc.current!.id)

      const requestQuery = {foo: 'bar', baz: 'qux'}
      const result = await getPage(ctx, docPath, requestQuery, createFunctionContext)

      assert.ok(result, 'Should return a rendered document with query params')
      assert.ok(result.html, 'Should have rendered HTML')
    })

    it('should handle undefined request query', async () => {
      const docPath = uniquePath('/getpage-no-query')
      const doc = await upsert(ctx, {
        path: docPath,
        title: 'No Query Test',
        content: '<p>No query content</p>',
        draft: false,
        published: true,
      })

      createdDocumentIds.push(doc.current!.id)

      const result = await getPage(ctx, docPath, undefined, createFunctionContext)

      assert.ok(result, 'Should return a rendered document without query params')
      assert.ok(result.html, 'Should have rendered HTML')
    })

    it('should handle empty request query', async () => {
      const docPath = uniquePath('/getpage-empty-query')
      const doc = await upsert(ctx, {
        path: docPath,
        title: 'Empty Query Test',
        content: '<p>Empty query content</p>',
        draft: false,
        published: true,
      })

      createdDocumentIds.push(doc.current!.id)

      const result = await getPage(ctx, docPath, {}, createFunctionContext)

      assert.ok(result, 'Should return a rendered document with empty query')
      assert.ok(result.html, 'Should have rendered HTML')
    })
  })

  describe('function context integration', () => {
    it('should pass client to function context', async () => {
      const docPath = uniquePath('/getpage-fn-client')
      const doc = await upsert(ctx, {
        path: docPath,
        title: 'FN Client Test',
        content: '<p>Client test</p>',
        draft: false,
        published: true,
      })

      createdDocumentIds.push(doc.current!.id)

      let capturedClient: PoolClient | null = null
      const fnContext: typeof functionContext = (client, _doc, _requestQuery) => {
        capturedClient = client
        return stubFnContext
      }

      await getPage(ctx, docPath, undefined, fnContext)

      assert.ok(capturedClient, 'Function context should receive client')
      assert.strictEqual(capturedClient, ctx, 'Function context should receive the same client')
    })

    it('should pass document to function context', async () => {
      const docPath = uniquePath('/getpage-fn-doc')
      const doc = await upsert(ctx, {
        path: docPath,
        title: 'FN Doc Test',
        content: '<p>Doc test</p>',
        draft: false,
        published: true,
      })

      createdDocumentIds.push(doc.current!.id)

      let capturedDoc: RenderDocument | {path: string} | null = null
      const fnContext: typeof functionContext = (_client, docArg, _requestQuery) => {
        capturedDoc = docArg
        return stubFnContext
      }

      await getPage(ctx, docPath, undefined, fnContext)

      assert.ok(capturedDoc, 'Function context should receive document')
      assert.strictEqual((capturedDoc as RenderDocument).path, docPath, 'Document should have correct path')
    })

    it('should pass request query to function context', async () => {
      const docPath = uniquePath('/getpage-fn-query')
      const doc = await upsert(ctx, {
        path: docPath,
        title: 'FN Query Test',
        content: '<p>Query test</p>',
        draft: false,
        published: true,
      })

      createdDocumentIds.push(doc.current!.id)

      let capturedQuery: Record<string, string> | undefined = undefined
      const fnContext: typeof functionContext = (_client, _doc, requestQuery) => {
        capturedQuery = requestQuery
        return stubFnContext
      }

      const testQuery = {param1: 'value1', param2: 'value2'}
      await getPage(ctx, docPath, testQuery, fnContext)

      assert.ok(capturedQuery, 'Function context should receive query')
      assert.deepStrictEqual(capturedQuery, testQuery, 'Query should match input')
    })

    it('should receive empty object when request query is undefined', async () => {
      const docPath = uniquePath('/getpage-fn-undefined-query')
      const doc = await upsert(ctx, {
        path: docPath,
        title: 'FN Undefined Query Test',
        content: '<p>Undefined query test</p>',
        draft: false,
        published: true,
      })

      createdDocumentIds.push(doc.current!.id)

      let capturedQuery: Record<string, string> | undefined = undefined
      const fnContext: typeof functionContext = (_client, _doc, requestQuery) => {
        capturedQuery = requestQuery
        return stubFnContext
      }

      await getPage(ctx, docPath, undefined, fnContext)

      assert.ok(capturedQuery !== undefined, 'Function context should receive query')
      assert.deepStrictEqual(capturedQuery, {}, 'Query should be empty object when undefined')
    })
  })

  describe('content rendering', () => {
    it('should render HTML content', async () => {
      const docPath = uniquePath('/getpage-html')
      const doc = await upsert(ctx, {
        path: docPath,
        title: 'HTML Content',
        content: '<div class="container"><h1>Title</h1><p>Paragraph</p></div>',
        draft: false,
        published: true,
      })

      createdDocumentIds.push(doc.current!.id)

      const result = await getPage(ctx, docPath, undefined, createFunctionContext)

      assert.ok(result, 'Should return a rendered document')
      assert.ok(result.html.includes('container'), 'HTML should contain class')
      assert.ok(result.html.includes('Title'), 'HTML should contain title')
      assert.ok(result.html.includes('Paragraph'), 'HTML should contain paragraph')
    })

    it('should render document with style', async () => {
      const docPath = uniquePath('/getpage-style')
      const doc = await upsert(ctx, {
        path: docPath,
        title: 'Styled Page',
        content: '<p>Styled content</p>',
        style: 'body { background: red; }',
        draft: false,
        published: true,
      })

      createdDocumentIds.push(doc.current!.id)

      const result = await getPage(ctx, docPath, undefined, createFunctionContext)

      assert.ok(result, 'Should return a rendered document')
      assert.ok(result.html, 'Should have rendered HTML')
    })

    it('should render document with script', async () => {
      const docPath = uniquePath('/getpage-script')
      const doc = await upsert(ctx, {
        path: docPath,
        title: 'Scripted Page',
        content: '<p>Scripted content</p>',
        script: 'console.log("hello")',
        draft: false,
        published: true,
      })

      createdDocumentIds.push(doc.current!.id)

      const result = await getPage(ctx, docPath, undefined, createFunctionContext)

      assert.ok(result, 'Should return a rendered document')
      assert.ok(result.html, 'Should have rendered HTML')
    })

    it('should render document with data', async () => {
      const docPath = uniquePath('/getpage-data')
      const doc = await upsert(ctx, {
        path: docPath,
        title: 'Data Page',
        content: '<p>Data content</p>',
        data: '{"key": "value", "number": 42}',
        draft: false,
        published: true,
      })

      createdDocumentIds.push(doc.current!.id)

      const result = await getPage(ctx, docPath, undefined, createFunctionContext)

      assert.ok(result, 'Should return a rendered document')
      assert.ok(result.html, 'Should have rendered HTML')
    })
  })

  describe('template and slot handling', () => {
    it('should render document with template', async () => {
      // Create template first
      const templatePath = uniquePath('/template-for-getpage')
      const template = await upsert(ctx, {
        path: templatePath,
        title: 'Template',
        content: '<html><head></head><body><%= slot.html %></body></html>',
        draft: false,
        published: true,
        has_eta: true,
      })

      createdDocumentIds.push(template.current!.id)

      // Create document with template
      const docPath = uniquePath('/getpage-with-template')
      const doc = await upsert(ctx, {
        path: docPath,
        title: 'Templated Page',
        content: '<p>Inner content</p>',
        template_id: template.current!.id,
        draft: false,
        published: true,
      })

      createdDocumentIds.push(doc.current!.id)

      const result = await getPage(ctx, docPath, undefined, createFunctionContext)

      assert.ok(result, 'Should return a rendered document')
      assert.ok(result.html, 'Should have rendered HTML')
      assert.ok(result.html.includes('Inner content'), 'HTML should contain inner content')
    })

    it('should render document with slot', async () => {
      // Create slot first
      const slotPath = uniquePath('/slot-for-getpage')
      const slot = await upsert(ctx, {
        path: slotPath,
        title: 'Slot',
        content: '<nav>Navigation</nav>',
        draft: false,
        published: true,
      })

      createdDocumentIds.push(slot.current!.id)

      // Create document with slot
      const docPath = uniquePath('/getpage-with-slot')
      const doc = await upsert(ctx, {
        path: docPath,
        title: 'Page with Slot',
        content: '<%= slot.html %><main>Main content</main>',
        slot_id: slot.current!.id,
        draft: false,
        published: true,
        has_eta: true,
      })

      createdDocumentIds.push(doc.current!.id)

      const result = await getPage(ctx, docPath, undefined, createFunctionContext)

      assert.ok(result, 'Should return a rendered document')
      assert.ok(result.html, 'Should have rendered HTML')
      assert.ok(result.html.includes('Navigation'), 'HTML should contain slot content')
      assert.ok(result.html.includes('Main content'), 'HTML should contain main content')
    })
  })

  describe('options behavior', () => {
    it('should use current version (not draft) by default', async () => {
      // Create document with current version
      const docPath = uniquePath('/getpage-current')
      const doc = await upsert(ctx, {
        path: docPath,
        title: 'Current Version',
        content: '<p>Current content</p>',
        draft: false,
        published: true,
      })

      createdDocumentIds.push(doc.current!.id)

      // Create a draft version
      await upsert(ctx, {
        path: docPath,
        title: 'Draft Version',
        content: '<p>Draft content</p>',
        draft: true,
      })

      const result = await getPage(ctx, docPath, undefined, createFunctionContext)

      assert.ok(result, 'Should return a rendered document')
      assert.ok(result.html.includes('Current content'), 'Should render current version, not draft')
      assert.ok(!result.html.includes('Draft content'), 'Should not contain draft content')
    })
  })

  describe('edge cases', () => {
    it('should handle document with empty content', async () => {
      const docPath = uniquePath('/getpage-empty')
      const doc = await upsert(ctx, {
        path: docPath,
        title: 'Empty Content',
        content: '',
        draft: false,
        published: true,
      })

      createdDocumentIds.push(doc.current!.id)

      const result = await getPage(ctx, docPath, undefined, createFunctionContext)

      assert.ok(result, 'Should return a rendered document')
      assert.ok(typeof result.html === 'string', 'Should have HTML string')
    })

    it('should handle document with special characters in content', async () => {
      const docPath = uniquePath('/getpage-special')
      const doc = await upsert(ctx, {
        path: docPath,
        title: 'Special Characters',
        content: '<p>Special: &amp; &lt; &gt; "quotes" \'apostrophe\'</p>',
        draft: false,
        published: true,
      })

      createdDocumentIds.push(doc.current!.id)

      const result = await getPage(ctx, docPath, undefined, createFunctionContext)

      assert.ok(result, 'Should return a rendered document')
      assert.ok(result.html, 'Should have rendered HTML')
    })

    it('should handle document with unicode content', async () => {
      const docPath = uniquePath('/getpage-unicode')
      const doc = await upsert(ctx, {
        path: docPath,
        title: 'Unicode Content 日本語',
        content: '<p>Unicode: 你好世界 🌍 émojis</p>',
        draft: false,
        published: true,
      })

      createdDocumentIds.push(doc.current!.id)

      const result = await getPage(ctx, docPath, undefined, createFunctionContext)

      assert.ok(result, 'Should return a rendered document')
      assert.ok(result.html.includes('你好世界'), 'Should contain Chinese characters')
      assert.ok(result.html.includes('🌍'), 'Should contain emoji')
    })

    it('should handle very long paths', async () => {
      const docPath = uniquePath('/getpage' + '/nested'.repeat(10))
      const doc = await upsert(ctx, {
        path: docPath,
        title: 'Deeply Nested',
        content: '<p>Deep content</p>',
        draft: false,
        published: true,
      })

      createdDocumentIds.push(doc.current!.id)

      const result = await getPage(ctx, docPath, undefined, createFunctionContext)

      assert.ok(result, 'Should return a rendered document')
      assert.ok(result.html.includes('Deep content'), 'Should render nested path content')
    })
  })
})
