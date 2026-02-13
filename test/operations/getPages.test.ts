import {describe, it, before, after, afterEach} from 'node:test'
import assert from 'node:assert'
import {randomUUID} from 'node:crypto'
import {createTestContext} from '../helpers/db.ts'
import {upsert} from '../../src/operations/upsert.ts'
import {getPages} from '../../src/operations/getPages.ts'
import {functionContext} from '../../src/fn/functionContext.ts'
import type {PoolClient} from 'pg'
import type {FunctionContext} from '../../src/fn/types.ts'
import type {RenderedDoc} from '../../src/render/utils/base.ts'

const stubFnContext: FunctionContext = {
  getPage: async () => null,
  getPages: async () => [],
  getUploads: async () => [],
}

describe('getPages operation', () => {
  let ctx: PoolClient
  let cleanup: () => Promise<void>
  const createdDocumentIds: number[] = []

  const uniquePath = (base: string) => `${base}-${randomUUID().slice(0, 8)}`

  const createStubFunctionContext: typeof functionContext = (_client, _doc, _requestQuery) => stubFnContext

  before(async () => {
    const tc = await createTestContext()
    ctx = tc.client
    cleanup = tc.cleanup
  })

  afterEach(async () => {
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
    await cleanup()
  })

  describe('basic functionality', () => {
    it('should return rendered documents', async () => {
      const prefix = uniquePath('/getpages-basic')
      const doc1 = await upsert(ctx, {path: `${prefix}-1`, title: 'Doc 1', content: '# One', published: true})
      createdDocumentIds.push(doc1.id)
      const doc2 = await upsert(ctx, {path: `${prefix}-2`, title: 'Doc 2', content: '# Two', published: true})
      createdDocumentIds.push(doc2.id)

      const result = await getPages(ctx, {startsWithPath: prefix}, undefined, createStubFunctionContext)

      assert.ok(Array.isArray(result), 'Should return an array')
      assert.strictEqual(result.length, 2)
      assert.ok(
        result.every((d: RenderedDoc) => d.html),
        'All documents should have rendered HTML',
      )
    })

    it('should respect limit option', async () => {
      const prefix = uniquePath('/getpages-limit')
      const doc1 = await upsert(ctx, {path: `${prefix}-1`, title: 'Doc 1', content: '# One', published: true})
      createdDocumentIds.push(doc1.id)
      const doc2 = await upsert(ctx, {path: `${prefix}-2`, title: 'Doc 2', content: '# Two', published: true})
      createdDocumentIds.push(doc2.id)

      const result = await getPages(ctx, {startsWithPath: prefix, limit: 1}, undefined, createStubFunctionContext)

      assert.strictEqual(result.length, 1)
    })
  })

  describe('excludePaths', () => {
    it('should exclude documents by path', async () => {
      const prefix = uniquePath('/getpages-exclude')
      const doc1 = await upsert(ctx, {path: `${prefix}-a`, title: 'Doc A', content: '# A', published: true})
      createdDocumentIds.push(doc1.id)
      const doc2 = await upsert(ctx, {path: `${prefix}-b`, title: 'Doc B', content: '# B', published: true})
      createdDocumentIds.push(doc2.id)
      const doc3 = await upsert(ctx, {path: `${prefix}-c`, title: 'Doc C', content: '# C', published: true})
      createdDocumentIds.push(doc3.id)

      const result = await getPages(
        ctx,
        {startsWithPath: prefix, excludePaths: [`${prefix}-b`]},
        undefined,
        createStubFunctionContext,
      )

      assert.strictEqual(result.length, 2)
      const paths = result.map((d: RenderedDoc) => d.path)
      assert.ok(!paths.includes(`${prefix}-b`), 'Excluded path should not be in results')
      assert.ok(paths.includes(`${prefix}-a`), 'Non-excluded path A should be in results')
      assert.ok(paths.includes(`${prefix}-c`), 'Non-excluded path C should be in results')
    })

    it('should exclude multiple paths', async () => {
      const prefix = uniquePath('/getpages-excl-multi')
      const doc1 = await upsert(ctx, {path: `${prefix}-a`, title: 'Doc A', content: '# A', published: true})
      createdDocumentIds.push(doc1.id)
      const doc2 = await upsert(ctx, {path: `${prefix}-b`, title: 'Doc B', content: '# B', published: true})
      createdDocumentIds.push(doc2.id)
      const doc3 = await upsert(ctx, {path: `${prefix}-c`, title: 'Doc C', content: '# C', published: true})
      createdDocumentIds.push(doc3.id)

      const result = await getPages(
        ctx,
        {startsWithPath: prefix, excludePaths: [`${prefix}-a`, `${prefix}-c`]},
        undefined,
        createStubFunctionContext,
      )

      assert.strictEqual(result.length, 1)
      assert.strictEqual(result[0].path, `${prefix}-b`)
    })

    it('should return empty array when all paths are excluded', async () => {
      const prefix = uniquePath('/getpages-excl-all')
      const doc1 = await upsert(ctx, {path: `${prefix}-a`, title: 'Doc A', content: '# A', published: true})
      createdDocumentIds.push(doc1.id)

      const result = await getPages(
        ctx,
        {startsWithPath: prefix, excludePaths: [`${prefix}-a`]},
        undefined,
        createStubFunctionContext,
      )

      assert.strictEqual(result.length, 0)
    })
  })

  describe('recursion prevention', () => {
    it('should not hang when a document server calls getPages (self-referential)', async () => {
      const prefix = uniquePath('/getpages-self-ref')
      const serverCode = `export default async function(ctx) {
        const pages = await ctx.fn.getPages({ startsWithPath: '${prefix}' })
        return { count: pages.length }
      }`

      const doc = await upsert(ctx, {
        path: `${prefix}-rss`,
        title: 'RSS Page',
        content: '<%= JSON.stringify(server) %>',
        server: serverCode,
        published: true,
      })
      createdDocumentIds.push(doc.id)

      // Create a normal document alongside
      const doc2 = await upsert(ctx, {
        path: `${prefix}-normal`,
        title: 'Normal Page',
        content: '# Normal',
        published: true,
      })
      createdDocumentIds.push(doc2.id)

      // Use real functionContext — this would hang without recursion prevention
      const result = await getPages(ctx, {startsWithPath: prefix}, undefined, functionContext)

      assert.ok(Array.isArray(result), 'Should return results without hanging')
      assert.strictEqual(result.length, 2, 'Should return both documents')

      // The RSS page's server should have run. Since getPages renders all docs
      // in a batch, renderingPaths includes all sibling paths. The nested
      // getPages call excludes those siblings, so it sees 0 pages within the prefix.
      const rssDoc = result.find((d: RenderedDoc) => d.path === `${prefix}-rss`)
      assert.ok(rssDoc, 'RSS document should be in results')
      assert.ok(rssDoc.server, 'RSS document should have server result')
      const serverResult = rssDoc.server as {count: number}
      assert.strictEqual(serverResult.count, 0, 'Server should see 0 pages (all siblings in the batch are excluded)')
    })

    it('should not hang with mutual recursion (two documents calling getPages)', async () => {
      const prefix = uniquePath('/getpages-mutual')
      const serverCode = (name: string) => `export default async function(ctx) {
        const pages = await ctx.fn.getPages({ startsWithPath: '${prefix}' })
        return { source: '${name}', count: pages.length }
      }`

      const doc1 = await upsert(ctx, {
        path: `${prefix}-rss`,
        title: 'RSS Feed',
        content: '<%= JSON.stringify(server) %>',
        server: serverCode('rss'),
        published: true,
      })
      createdDocumentIds.push(doc1.id)

      const doc2 = await upsert(ctx, {
        path: `${prefix}-rss-xml`,
        title: 'RSS XML',
        content: '<%= JSON.stringify(server) %>',
        server: serverCode('rss-xml'),
        published: true,
      })
      createdDocumentIds.push(doc2.id)

      // Create a normal document
      const doc3 = await upsert(ctx, {
        path: `${prefix}-page`,
        title: 'Regular Page',
        content: '# Hello',
        published: true,
      })
      createdDocumentIds.push(doc3.id)

      // This would cause infinite mutual recursion without the fix
      const result = await getPages(ctx, {startsWithPath: prefix}, undefined, functionContext)

      assert.ok(Array.isArray(result), 'Should return results without hanging')
      assert.strictEqual(result.length, 3, 'Should return all 3 documents')
    })

    it('should not hang when rendering a single document whose server calls getPages', async () => {
      const prefix = uniquePath('/getpages-single')
      const serverCode = `export default async function(ctx) {
        const pages = await ctx.fn.getPages({ startsWithPath: '${prefix}' })
        return { titles: pages.map(p => p.title) }
      }`

      // The main document that calls getPages
      const mainDoc = await upsert(ctx, {
        path: `${prefix}-main`,
        title: 'Main',
        content: '<%= JSON.stringify(server) %>',
        server: serverCode,
        published: true,
      })
      createdDocumentIds.push(mainDoc.id)

      // Some regular documents it should list
      const pageA = await upsert(ctx, {
        path: `${prefix}-a`,
        title: 'Page A',
        content: '# A',
        published: true,
      })
      createdDocumentIds.push(pageA.id)

      const pageB = await upsert(ctx, {
        path: `${prefix}-b`,
        title: 'Page B',
        content: '# B',
        published: true,
      })
      createdDocumentIds.push(pageB.id)

      // Simulate how documents.ts renders a single document
      const {render} = await import('../../src/render/index.ts')
      const {getRenderDocument} = await import('../../src/operations/getRenderDocument.ts')

      const renderDoc = await getRenderDocument(
        ctx,
        {path: `${prefix}-main`},
        {
          includeSlot: true,
          includeTemplate: true,
          draft: false,
        },
      )
      assert.ok(renderDoc, 'Document should exist')

      const rendered = await render(renderDoc, {
        fn: functionContext(ctx, renderDoc),
        query: {},
      })

      assert.ok(rendered.html, 'Should render without hanging')
      const serverResult = rendered.server as {titles: string[]}
      assert.ok(Array.isArray(serverResult.titles), 'Server should return titles array')
      // The main doc excludes itself, so it should only see Page A and Page B
      assert.strictEqual(serverResult.titles.length, 2, 'Should list 2 pages (excluding itself)')
      assert.ok(serverResult.titles.includes('Page A'), 'Should include Page A')
      assert.ok(serverResult.titles.includes('Page B'), 'Should include Page B')
    })

    it('should prevent deep mutual recursion chains (A → getPages → B → getPages → A)', async () => {
      const prefix = uniquePath('/getpages-deep')

      // Doc A's server calls getPages, which renders Doc B
      // Doc B's server also calls getPages, which could render Doc A again
      const serverCode = `export default async function(ctx) {
        const pages = await ctx.fn.getPages({ startsWithPath: '${prefix}' })
        return { count: pages.length, paths: pages.map(p => p.path) }
      }`

      const docA = await upsert(ctx, {
        path: `${prefix}-a`,
        title: 'Doc A',
        content: '<%= JSON.stringify(server) %>',
        server: serverCode,
        published: true,
      })
      createdDocumentIds.push(docA.id)

      const docB = await upsert(ctx, {
        path: `${prefix}-b`,
        title: 'Doc B',
        content: '<%= JSON.stringify(server) %>',
        server: serverCode,
        published: true,
      })
      createdDocumentIds.push(docB.id)

      const docC = await upsert(ctx, {
        path: `${prefix}-c`,
        title: 'Doc C',
        content: '# Plain page',
        published: true,
      })
      createdDocumentIds.push(docC.id)

      // Render via getPages - this exercises the full chain
      const result = await getPages(ctx, {startsWithPath: prefix}, undefined, functionContext)

      assert.ok(Array.isArray(result), 'Should complete without hanging')
      assert.strictEqual(result.length, 3, 'Should return all 3 documents')

      // Verify each server-calling doc got results without its siblings
      const renderedA = result.find((d: RenderedDoc) => d.path === `${prefix}-a`)
      const renderedB = result.find((d: RenderedDoc) => d.path === `${prefix}-b`)
      assert.ok(renderedA, 'Doc A should be rendered')
      assert.ok(renderedB, 'Doc B should be rendered')

      const serverA = renderedA.server as {count: number; paths: string[]}
      const serverB = renderedB.server as {count: number; paths: string[]}

      // When getPages renders A, B, C together:
      // A's server calls getPages excluding [A, B, C] → gets nothing within prefix
      // B's server calls getPages excluding [A, B, C] → gets nothing within prefix
      assert.ok(!serverA.paths.includes(`${prefix}-a`), 'Doc A server should not see itself')
      assert.ok(!serverA.paths.includes(`${prefix}-b`), 'Doc A server should not see sibling B')
      assert.ok(!serverB.paths.includes(`${prefix}-b`), 'Doc B server should not see itself')
      assert.ok(!serverB.paths.includes(`${prefix}-a`), 'Doc B server should not see sibling A')
    })

    it('should allow server code to call getPages with different startsWithPath', async () => {
      const prefix1 = uniquePath('/getpages-cross')
      const prefix2 = uniquePath('/getpages-other')

      // Doc in prefix1 calls getPages for prefix2 (different namespace)
      const serverCode = `export default async function(ctx) {
        const pages = await ctx.fn.getPages({ startsWithPath: '${prefix2}' })
        return { count: pages.length }
      }`

      const mainDoc = await upsert(ctx, {
        path: `${prefix1}-main`,
        title: 'Main',
        content: '<%= JSON.stringify(server) %>',
        server: serverCode,
        published: true,
      })
      createdDocumentIds.push(mainDoc.id)

      const otherDoc = await upsert(ctx, {
        path: `${prefix2}-page`,
        title: 'Other Page',
        content: '# Other',
        published: true,
      })
      createdDocumentIds.push(otherDoc.id)

      const result = await getPages(ctx, {startsWithPath: prefix1}, undefined, functionContext)

      assert.strictEqual(result.length, 1)
      const serverResult = result[0].server as {count: number}
      assert.strictEqual(serverResult.count, 1, 'Should find the document in the other namespace')
    })
  })
})
