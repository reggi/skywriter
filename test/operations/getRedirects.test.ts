import {describe, it, before, after, afterEach} from 'node:test'
import assert from 'node:assert'
import {createDatabaseContext, closeDatabaseContext, closePool} from '../../src/db/index.ts'
import {upsert} from '../../src/operations/upsert.ts'
import {getRedirects} from '../../src/operations/getRedirects.ts'
import {addRedirect} from '../../src/operations/addRedirect.ts'
import type {DocumentId} from '../../src/operations/types.ts'
import type {PoolClient} from 'pg'

describe('getRedirects operation', () => {
  let ctx: PoolClient
  const createdDocumentIds: number[] = []

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

  it('should return empty array for document with no redirects', async () => {
    const doc = await upsert(ctx, {
      path: '/test-no-redirects',
      title: 'Test Document',
      content: 'Content',
      published: true,
    })
    createdDocumentIds.push(doc.current!.id)

    const redirects = await getRedirects(ctx, {id: doc.current!.id})

    assert.strictEqual(redirects.length, 0)
  })

  it('should return empty array for non-existent document', async () => {
    const redirects = await getRedirects(ctx, {id: 999999 as DocumentId})

    assert.strictEqual(redirects.length, 0)
  })

  it('should return all redirect routes for a document', async () => {
    const doc = await upsert(ctx, {
      path: '/test-with-redirects',
      title: 'Test Document',
      content: 'Content',
      published: true,
    })
    createdDocumentIds.push(doc.current!.id)

    // Add some redirects
    const redirect1 = await addRedirect(ctx, {id: doc.current!.id}, {path: '/old-path-1'})
    const redirect2 = await addRedirect(ctx, {id: doc.current!.id}, {path: '/old-path-2'})
    const redirect3 = await addRedirect(ctx, {id: doc.current!.id}, {path: '/old-path-3'})

    const redirects = await getRedirects(ctx, {id: doc.current!.id})

    assert.strictEqual(redirects.length, 3)

    // Should be ordered by created_at DESC (newest first)
    assert.strictEqual(redirects[0].id, redirect3.id)
    assert.strictEqual(redirects[0].path, '/old-path-3')
    assert.strictEqual(redirects[1].id, redirect2.id)
    assert.strictEqual(redirects[1].path, '/old-path-2')
    assert.strictEqual(redirects[2].id, redirect1.id)
    assert.strictEqual(redirects[2].path, '/old-path-1')

    // All redirects should have the correct document_id
    for (const redirect of redirects) {
      assert.strictEqual(redirect.document_id, doc.current!.id)
      assert.ok(redirect.created_at instanceof Date)
    }
  })

  it('should not include canonical path in redirects', async () => {
    const doc = await upsert(ctx, {
      path: '/canonical-path',
      title: 'Test Document',
      content: 'Content',
      published: true,
    })
    createdDocumentIds.push(doc.current!.id)

    // Add redirects
    await addRedirect(ctx, {id: doc.current!.id}, {path: '/redirect-1'})
    await addRedirect(ctx, {id: doc.current!.id}, {path: '/redirect-2'})

    const redirects = await getRedirects(ctx, {id: doc.current!.id})

    // Should only return the 2 redirects, not the canonical path
    assert.strictEqual(redirects.length, 2)

    // Verify canonical path is not in the results
    const paths = redirects.map((r: {path: string}) => r.path)
    assert.ok(!paths.includes('/canonical-path'))
    assert.ok(paths.includes('/redirect-1'))
    assert.ok(paths.includes('/redirect-2'))
  })

  it('should handle document with many redirects', async () => {
    const doc = await upsert(ctx, {
      path: '/many-redirects',
      title: 'Test Document',
      content: 'Content',
      published: true,
    })
    createdDocumentIds.push(doc.current!.id)

    // Add 10 redirects
    const redirectIds: number[] = []
    for (let i = 1; i <= 10; i++) {
      const redirect = await addRedirect(ctx, {id: doc.current!.id}, {path: `/redirect-${i}`})
      redirectIds.push(redirect.id)
    }

    const redirects = await getRedirects(ctx, {id: doc.current!.id})

    assert.strictEqual(redirects.length, 10)

    // Verify all redirect IDs are present
    const returnedIds = redirects.map((r: {id: number}) => r.id)
    for (const id of redirectIds) {
      assert.ok(returnedIds.includes(id))
    }
  })

  it('should return redirects with correct structure', async () => {
    const doc = await upsert(ctx, {
      path: '/test-structure',
      title: 'Test Document',
      content: 'Content',
      published: true,
    })
    createdDocumentIds.push(doc.current!.id)

    const redirect = await addRedirect(ctx, {id: doc.current!.id}, {path: '/old-structure'})

    const redirects = await getRedirects(ctx, {id: doc.current!.id})

    assert.strictEqual(redirects.length, 1)

    const r = redirects[0]
    assert.strictEqual(typeof r.id, 'number')
    assert.strictEqual(typeof r.path, 'string')
    assert.strictEqual(typeof r.document_id, 'number')
    assert.ok(r.created_at instanceof Date)

    assert.strictEqual(r.id, redirect.id)
    assert.strictEqual(r.path, redirect.path)
    assert.strictEqual(r.document_id, doc.current!.id)
  })
})
