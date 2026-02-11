import {describe, it, before, after, afterEach} from 'node:test'
import assert from 'node:assert'
import {randomUUID} from 'node:crypto'
import {createDatabaseContext, closeDatabaseContext, closePool} from '../../src/db/index.ts'
import {upsert} from '../../src/operations/upsert.ts'
import {findDocument} from '../../src/operations/findDocument.ts'
import type {PoolClient} from 'pg'
import type {DocumentId} from '../../src/operations/types.ts'

describe('findDocument operation', () => {
  let ctx: PoolClient
  const createdDocumentIds: number[] = []

  const uniquePath = (base: string) => `${base}-${randomUUID()}`

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

  describe('find by id', () => {
    it('should find a document by id', async () => {
      const docPath = uniquePath('/find-by-id')
      const doc = await upsert(ctx, {
        path: docPath,
        title: 'Find By ID Test',
        content: 'Content for ID lookup',
        published: true,
      })

      createdDocumentIds.push(doc.current!.id)

      const result = await findDocument(ctx, {id: doc.current!.id})

      assert.ok(result, 'Document should be found')
      assert.strictEqual(result.id, doc.current!.id)
      assert.strictEqual(result.redirect, false, 'Finding by ID should not set redirect flag')
      assert.ok(result.route, 'Should include route information')
      assert.strictEqual(result.route.path, docPath)
    })

    it('should return null for non-existent id', async () => {
      const result = await findDocument(ctx, {id: 999999 as DocumentId})
      assert.strictEqual(result, null)
    })

    it('should filter by published status when finding by id', async () => {
      const docPath = uniquePath('/find-by-id-published')
      const doc = await upsert(ctx, {
        path: docPath,
        title: 'Published Filter Test',
        content: 'Content',
        published: true,
      })

      createdDocumentIds.push(doc.current!.id)

      // Should find when published filter matches
      const foundPublished = await findDocument(ctx, {id: doc.current!.id}, {published: true})
      assert.ok(foundPublished, 'Should find published document with published: true filter')

      // Should not find when published filter does not match
      const notFoundUnpublished = await findDocument(ctx, {id: doc.current!.id}, {published: false})
      assert.strictEqual(notFoundUnpublished, null, 'Should not find published document with published: false filter')
    })

    it('should find unpublished document by id when published is false', async () => {
      const docPath = uniquePath('/find-by-id-unpublished')
      const doc = await upsert(ctx, {
        path: docPath,
        title: 'Unpublished Test',
        content: 'Unpublished content',
        published: false,
        draft: true,
      })

      createdDocumentIds.push(doc.draft!.id)

      // Should find when published filter matches
      const foundUnpublished = await findDocument(ctx, {id: doc.draft!.id}, {published: false})
      assert.ok(foundUnpublished, 'Should find unpublished document with published: false filter')

      // Should not find when published filter does not match
      const notFoundPublished = await findDocument(ctx, {id: doc.draft!.id}, {published: true})
      assert.strictEqual(notFoundPublished, null, 'Should not find unpublished document with published: true filter')
    })

    it('should find document by id without published filter', async () => {
      const docPath = uniquePath('/find-by-id-no-filter')
      const doc = await upsert(ctx, {
        path: docPath,
        title: 'No Filter Test',
        content: 'Content',
        published: false,
        draft: true,
      })

      createdDocumentIds.push(doc.draft!.id)

      // Should find without any filter
      const result = await findDocument(ctx, {id: doc.draft!.id})
      assert.ok(result, 'Should find document without published filter')
      assert.strictEqual(result.id, doc.draft!.id)
    })
  })

  describe('find by path', () => {
    it('should find a document by path', async () => {
      const docPath = uniquePath('/find-by-path')
      const doc = await upsert(ctx, {
        path: docPath,
        title: 'Find By Path Test',
        content: 'Content for path lookup',
        published: true,
      })

      createdDocumentIds.push(doc.current!.id)

      const result = await findDocument(ctx, {path: docPath})

      assert.ok(result, 'Document should be found')
      assert.strictEqual(result.id, doc.current!.id)
      assert.strictEqual(result.redirect, false, 'Finding by canonical path should not set redirect flag')
      assert.ok(result.route, 'Should include route information')
      assert.strictEqual(result.route.path, docPath)
    })

    it('should return null for non-existent path', async () => {
      const result = await findDocument(ctx, {path: '/does-not-exist-' + randomUUID()})
      assert.strictEqual(result, null)
    })

    it('should set redirect flag when accessed via old path', async () => {
      const canonicalPath = uniquePath('/canonical-path')
      const doc = await upsert(ctx, {
        path: canonicalPath,
        title: 'Redirect Test',
        content: 'Content',
        published: true,
      })

      createdDocumentIds.push(doc.current!.id)

      // Create a redirect route (simulating old path)
      const oldPath = uniquePath('/old-path')
      await ctx.query(`INSERT INTO routes (path, document_id) VALUES ($1, $2)`, [oldPath, doc.current!.id])

      // Find via old path should have redirect flag set to true
      const viaOldPath = await findDocument(ctx, {path: oldPath})
      assert.ok(viaOldPath, 'Document should be found via old path')
      assert.strictEqual(viaOldPath.redirect, true, 'Should have redirect flag set')
      assert.strictEqual(viaOldPath.route.path, canonicalPath, 'Route should be the canonical path')
      assert.strictEqual(viaOldPath.id, doc.current!.id)

      // Find via canonical path should not have redirect flag
      const viaCanonical = await findDocument(ctx, {path: canonicalPath})
      assert.ok(viaCanonical, 'Document should be found via canonical path')
      assert.strictEqual(viaCanonical.redirect, false, 'Should not have redirect flag')
    })

    it('should filter by published status when finding by path', async () => {
      const docPath = uniquePath('/find-by-path-published')
      const doc = await upsert(ctx, {
        path: docPath,
        title: 'Published Path Filter Test',
        content: 'Content',
        published: true,
      })

      createdDocumentIds.push(doc.current!.id)

      // Should find when published filter matches
      const foundPublished = await findDocument(ctx, {path: docPath}, {published: true})
      assert.ok(foundPublished, 'Should find published document with published: true filter')

      // Should not find when published filter does not match
      const notFoundUnpublished = await findDocument(ctx, {path: docPath}, {published: false})
      assert.strictEqual(notFoundUnpublished, null, 'Should not find published document with published: false filter')
    })

    it('should find unpublished document by path when published is false', async () => {
      const docPath = uniquePath('/find-by-path-unpublished')
      const doc = await upsert(ctx, {
        path: docPath,
        title: 'Unpublished Path Test',
        content: 'Unpublished content',
        published: false,
        draft: true,
      })

      createdDocumentIds.push(doc.draft!.id)

      // Should find when published filter matches
      const foundUnpublished = await findDocument(ctx, {path: docPath}, {published: false})
      assert.ok(foundUnpublished, 'Should find unpublished document with published: false filter')

      // Should not find when published filter does not match
      const notFoundPublished = await findDocument(ctx, {path: docPath}, {published: true})
      assert.strictEqual(notFoundPublished, null, 'Should not find unpublished document with published: true filter')
    })

    it('should return null when path exists but published filter does not match', async () => {
      const docPath = uniquePath('/path-filter-mismatch')
      const doc = await upsert(ctx, {
        path: docPath,
        title: 'Filter Mismatch Test',
        content: 'Content',
        published: true,
      })

      createdDocumentIds.push(doc.current!.id)

      const result = await findDocument(ctx, {path: docPath}, {published: false})
      assert.strictEqual(result, null, 'Should return null when published filter does not match')
    })
  })

  describe('edge cases', () => {
    it('should return null when neither id nor path is provided', async () => {
      const result = await findDocument(ctx, {})
      assert.strictEqual(result, null)
    })

    it('should prioritize id over path when both are provided', async () => {
      const docPath1 = uniquePath('/doc-with-id')
      const docPath2 = uniquePath('/doc-with-path')

      const doc1 = await upsert(ctx, {
        path: docPath1,
        title: 'Document 1',
        content: 'Content 1',
        published: true,
      })

      const doc2 = await upsert(ctx, {
        path: docPath2,
        title: 'Document 2',
        content: 'Content 2',
        published: true,
      })

      createdDocumentIds.push(doc1.current!.id, doc2.current!.id)

      // When both id and path are provided, id should take precedence
      const result = await findDocument(ctx, {id: doc1.current!.id, path: docPath2})
      assert.ok(result, 'Document should be found')
      assert.strictEqual(result.id, doc1.current!.id, 'Should find document by id, not path')
      assert.strictEqual(result.route.path, docPath1)
    })

    it('should include correct route information in response', async () => {
      const docPath = uniquePath('/route-info-test')
      const doc = await upsert(ctx, {
        path: docPath,
        title: 'Route Info Test',
        content: 'Content',
        published: true,
      })

      createdDocumentIds.push(doc.current!.id)

      const result = await findDocument(ctx, {id: doc.current!.id})

      assert.ok(result, 'Document should be found')
      assert.ok(result.route, 'Should have route object')
      assert.ok(result.route.id, 'Route should have id')
      assert.strictEqual(result.route.path, docPath, 'Route should have correct path')
      assert.strictEqual(result.route.document_id, doc.current!.id, 'Route should reference document')
      // Note: route.created_at is a string from row_to_json, not a Date object
      assert.ok(result.route.created_at, 'Route should have created_at')
    })

    it('should return document with all expected properties', async () => {
      const docPath = uniquePath('/full-props-test')
      const doc = await upsert(ctx, {
        path: docPath,
        title: 'Full Props Test',
        content: 'Content',
        published: true,
      })

      createdDocumentIds.push(doc.current!.id)

      const result = await findDocument(ctx, {id: doc.current!.id})

      assert.ok(result, 'Document should be found')
      // Check document properties
      assert.ok(result.id, 'Should have id')
      assert.ok(result.path_id, 'Should have path_id')
      assert.ok(typeof result.published === 'boolean', 'Should have published boolean')
      assert.ok(result.created_at instanceof Date, 'Should have created_at date')
      assert.ok(result.updated_at instanceof Date, 'Should have updated_at date')
      // Check route and redirect
      assert.ok(result.route, 'Should have route')
      assert.strictEqual(typeof result.redirect, 'boolean', 'Should have redirect boolean')
    })
  })
})
