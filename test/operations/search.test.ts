import {describe, it, before, after, afterEach} from 'node:test'
import assert from 'node:assert'
import {createDatabaseContext, closeDatabaseContext, closePool} from '../../src/db/index.ts'
import {upsert} from '../../src/operations/upsert.ts'
import {search} from '../../src/operations/search.ts'
import type {PoolClient} from 'pg'

describe('search operation', () => {
  let ctx: PoolClient
  const createdDocumentIds: number[] = []
  const testId = Date.now()

  before(async () => {
    ctx = await createDatabaseContext()
  })

  afterEach(async () => {
    // Clean up all created documents
    for (const docId of createdDocumentIds) {
      try {
        await ctx.query('DELETE FROM documents WHERE id = $1', [docId])
      } catch (error) {
        console.error(`Failed to delete document ${docId}:`, error)
      }
    }

    // Clean up orphaned document records
    try {
      await ctx.query(
        `UPDATE document_records 
         SET template_id = NULL
         WHERE id NOT IN (
           SELECT current_record_id FROM documents WHERE current_record_id IS NOT NULL
           UNION
           SELECT draft_record_id FROM documents WHERE draft_record_id IS NOT NULL
         )`,
      )
      await ctx.query(
        `DELETE FROM document_records 
         WHERE id NOT IN (
           SELECT current_record_id FROM documents WHERE current_record_id IS NOT NULL
           UNION
           SELECT draft_record_id FROM documents WHERE draft_record_id IS NOT NULL
         )`,
      )
    } catch (error) {
      console.error(`Failed to clean up orphaned records:`, error)
    }

    createdDocumentIds.length = 0
  })

  after(async () => {
    await closeDatabaseContext(ctx)
    await closePool()
  })

  it('should find documents by path', async () => {
    const doc = await upsert(ctx, {
      path: `/search-by-path-${testId}`,
      title: 'Some Title',
      content: 'Content here',
      published: true,
    })
    createdDocumentIds.push(doc.current!.id)

    const results = await search(ctx, {query: `search-by-path-${testId}`})

    assert.strictEqual(results.length, 1)
    assert.strictEqual(results[0].path, `/search-by-path-${testId}`)
    assert.strictEqual(results[0].title, 'Some Title')
  })

  it('should find documents by title', async () => {
    const doc = await upsert(ctx, {
      path: `/title-search-doc-${testId}`,
      title: `UniqueSearchTitle${testId}`,
      content: 'Content here',
      published: true,
    })
    createdDocumentIds.push(doc.current!.id)

    const results = await search(ctx, {query: `UniqueSearchTitle${testId}`})

    assert.strictEqual(results.length, 1)
    assert.strictEqual(results[0].title, `UniqueSearchTitle${testId}`)
  })

  it('should perform case-insensitive search', async () => {
    const doc = await upsert(ctx, {
      path: `/case-insensitive-${testId}`,
      title: 'CamelCaseTitle',
      content: 'Content',
      published: true,
    })
    createdDocumentIds.push(doc.current!.id)

    const results = await search(ctx, {query: 'camelcasetitle'})

    assert.strictEqual(results.length, 1)
    assert.strictEqual(results[0].title, 'CamelCaseTitle')
  })

  it('should filter by published status', async () => {
    const publishedDoc = await upsert(ctx, {
      path: `/published-filter-pub-${testId}`,
      title: 'Published Doc',
      content: 'Content',
      published: true,
    })
    const unpublishedDoc = await upsert(ctx, {
      path: `/published-filter-unpub-${testId}`,
      title: 'Unpublished Doc',
      content: 'Content',
      published: false,
    })
    createdDocumentIds.push(publishedDoc.current!.id, unpublishedDoc.current!.id)

    // Search for published only
    const publishedResults = await search(ctx, {query: `published-filter-`, published: true})
    const publishedPaths = publishedResults.map(r => r.path)

    assert.ok(publishedPaths.includes(`/published-filter-pub-${testId}`))
    assert.ok(!publishedPaths.includes(`/published-filter-unpub-${testId}`))

    // Search for unpublished only
    const unpublishedResults = await search(ctx, {query: `published-filter-`, published: false})
    const unpublishedPaths = unpublishedResults.map(r => r.path)

    assert.ok(!unpublishedPaths.includes(`/published-filter-pub-${testId}`))
    assert.ok(unpublishedPaths.includes(`/published-filter-unpub-${testId}`))
  })

  it('should return both published and unpublished when filter not specified', async () => {
    const publishedDoc = await upsert(ctx, {
      path: `/both-filter-pub-${testId}`,
      title: 'Published',
      content: 'Content',
      published: true,
    })
    const unpublishedDoc = await upsert(ctx, {
      path: `/both-filter-unpub-${testId}`,
      title: 'Unpublished',
      content: 'Content',
      published: false,
    })
    createdDocumentIds.push(publishedDoc.current!.id, unpublishedDoc.current!.id)

    const results = await search(ctx, {query: `both-filter-`})
    const paths = results.map(r => r.path)

    assert.ok(paths.includes(`/both-filter-pub-${testId}`))
    assert.ok(paths.includes(`/both-filter-unpub-${testId}`))
  })

  it('should respect limit parameter', async () => {
    // Create multiple documents
    for (let i = 0; i < 5; i++) {
      const doc = await upsert(ctx, {
        path: `/limit-test-${testId}-${i}`,
        title: `Limit Test ${i}`,
        content: 'Content',
        published: true,
      })
      createdDocumentIds.push(doc.current!.id)
    }

    const results = await search(ctx, {query: `limit-test-${testId}`, limit: 3})

    assert.strictEqual(results.length, 3)
  })

  it('should return empty array for no matches', async () => {
    const results = await search(ctx, {query: `nonexistentquery${testId}xyz`})

    assert.strictEqual(results.length, 0)
  })

  it('should include correct fields in results', async () => {
    const doc = await upsert(ctx, {
      path: `/fields-test-${testId}`,
      title: 'Fields Test Document',
      content: 'Content here',
      published: true,
    })
    createdDocumentIds.push(doc.current!.id)

    const results = await search(ctx, {query: `fields-test-${testId}`})

    assert.strictEqual(results.length, 1)
    assert.ok('id' in results[0])
    assert.ok('path' in results[0])
    assert.ok('title' in results[0])
    assert.ok('published' in results[0])
    assert.strictEqual(results[0].redirect, false)
  })

  it('should order results by usage count then creation date', async () => {
    // Create a document that will be used as a template
    const templateDoc = await upsert(ctx, {
      path: `/template-${testId}`,
      title: 'Template Document',
      content: 'Template content',
      published: true,
    })
    createdDocumentIds.push(templateDoc.current!.id)

    // Create another document that won't be used as template
    const regularDoc = await upsert(ctx, {
      path: `/regular-${testId}`,
      title: 'Regular Document',
      content: 'Regular content',
      published: true,
    })
    createdDocumentIds.push(regularDoc.current!.id)

    // Create a document that uses the template
    const usingTemplate = await upsert(ctx, {
      path: `/using-template-${testId}`,
      title: 'Using Template',
      content: 'Content using template',
      template_id: templateDoc.current!.id,
      published: true,
    })
    createdDocumentIds.push(usingTemplate.current!.id)

    // Search for documents - template should be first due to usage
    const results = await search(ctx, {query: testId.toString()})

    // Template should appear before regular doc due to being used
    const templateIndex = results.findIndex(r => r.path === `/template-${testId}`)
    const regularIndex = results.findIndex(r => r.path === `/regular-${testId}`)

    if (templateIndex !== -1 && regularIndex !== -1) {
      assert.ok(templateIndex < regularIndex, 'Template should be ranked higher due to usage')
    }
  })

  it('should match partial path segments', async () => {
    const doc = await upsert(ctx, {
      path: `/docs/articles/partial-match-${testId}`,
      title: 'Nested Document',
      content: 'Content',
      published: true,
    })
    createdDocumentIds.push(doc.current!.id)

    const results = await search(ctx, {query: 'partial-match'})

    assert.ok(results.some(r => r.path === `/docs/articles/partial-match-${testId}`))
  })

  it('should use default limit of 10', async () => {
    // Create 15 documents
    for (let i = 0; i < 15; i++) {
      const doc = await upsert(ctx, {
        path: `/default-limit-${testId}-${i}`,
        title: `Default Limit ${i}`,
        content: 'Content',
        published: true,
      })
      createdDocumentIds.push(doc.current!.id)
    }

    const results = await search(ctx, {query: `default-limit-${testId}`})

    assert.strictEqual(results.length, 10)
  })
})
