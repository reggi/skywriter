import {describe, it, before, after, afterEach} from 'node:test'
import assert from 'node:assert'
import {createDatabaseContext, closeDatabaseContext, closePool} from '../../src/db/index.ts'
import {upsert} from '../../src/operations/upsert.ts'
import {addRedirect} from '../../src/operations/addRedirect.ts'
import {removeRedirect} from '../../src/operations/removeRedirect.ts'
import {getRedirects} from '../../src/operations/getRedirects.ts'
import type {PoolClient} from 'pg'
import type {RedirectQuery} from '../../src/operations/types.ts'

describe('removeRedirect operation', () => {
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

  it('should remove a redirect', async () => {
    const doc = await upsert(ctx, {
      path: '/test-remove',
      title: 'Test Document',
      content: 'Content',
      published: true,
    })
    createdDocumentIds.push(doc.id)

    // Add a redirect
    const redirect = await addRedirect(ctx, {id: doc.current!.id}, {path: '/old-redirect'})

    // Remove the redirect
    const result = await removeRedirect(ctx, redirect.id)

    assert.strictEqual(result, true)

    // Verify it's gone
    const redirects = await getRedirects(ctx, {id: doc.current!.id})
    assert.strictEqual(redirects.length, 0)
  })

  it('should return false when redirect does not exist', async () => {
    const doc = await upsert(ctx, {
      path: '/test-nonexistent-redirect',
      title: 'Test Document',
      content: 'Content',
      published: true,
    })
    createdDocumentIds.push(doc.id)

    const result = await removeRedirect(ctx, {id: 999999} as RedirectQuery)

    assert.strictEqual(result, false)
  })

  it('should throw error when attempting to remove canonical path', async () => {
    const doc = await upsert(ctx, {
      path: '/test-canonical',
      title: 'Test Document',
      content: 'Content',
      published: true,
    })
    createdDocumentIds.push(doc.id)

    // Get the canonical path_id from the document
    const pathResult = await ctx.query<{path_id: number}>('SELECT path_id FROM documents WHERE id = $1', [
      doc.current!.id,
    ])
    const canonicalPathId = pathResult.rows[0].path_id

    // Try to remove the canonical path
    await assert.rejects(
      async () => {
        await removeRedirect(ctx, {id: canonicalPathId} as RedirectQuery)
      },
      {
        message: 'Cannot delete canonical path. Use upsert to change the document path instead.',
      },
    )
  })

  it('should remove redirect by id regardless of which document it belongs to', async () => {
    const doc1 = await upsert(ctx, {
      path: '/doc1',
      title: 'Document 1',
      content: 'Content',
      published: true,
    })
    createdDocumentIds.push(doc1.id)

    const doc2 = await upsert(ctx, {
      path: '/doc2',
      title: 'Document 2',
      content: 'Content',
      published: true,
    })
    createdDocumentIds.push(doc2.id)

    // Add redirect to doc1
    const redirect1 = await addRedirect(ctx, {id: doc1.current!.id}, {path: '/doc1-redirect'})

    // Remove doc1's redirect by id (should succeed)
    const result = await removeRedirect(ctx, redirect1.id)

    assert.strictEqual(result, true)

    // Verify redirect was removed
    const redirects = await getRedirects(ctx, {id: doc1.current!.id})
    assert.strictEqual(redirects.length, 0)
  })

  it('should remove one redirect while keeping others', async () => {
    const doc = await upsert(ctx, {
      path: '/test-selective-remove',
      title: 'Test Document',
      content: 'Content',
      published: true,
    })
    createdDocumentIds.push(doc.id)

    // Add multiple redirects
    const redirect1 = await addRedirect(ctx, {id: doc.current!.id}, {path: '/redirect-1'})
    const redirect2 = await addRedirect(ctx, {id: doc.current!.id}, {path: '/redirect-2'})
    const redirect3 = await addRedirect(ctx, {id: doc.current!.id}, {path: '/redirect-3'})

    // Remove the middle one
    const result = await removeRedirect(ctx, redirect2.id)

    assert.strictEqual(result, true)

    // Verify only 2 redirects remain
    const redirects = await getRedirects(ctx, {id: doc.current!.id})
    assert.strictEqual(redirects.length, 2)

    const remainingIds = redirects.map((r: {id: number}) => r.id)
    assert.ok(remainingIds.includes(redirect1.id))
    assert.ok(!remainingIds.includes(redirect2.id))
    assert.ok(remainingIds.includes(redirect3.id))
  })

  it('should handle removing all redirects sequentially', async () => {
    const doc = await upsert(ctx, {
      path: '/test-remove-all',
      title: 'Test Document',
      content: 'Content',
      published: true,
    })
    createdDocumentIds.push(doc.id)

    // Add redirects
    const redirect1 = await addRedirect(ctx, {id: doc.current!.id}, {path: '/r1'})
    const redirect2 = await addRedirect(ctx, {id: doc.current!.id}, {path: '/r2'})
    const redirect3 = await addRedirect(ctx, {id: doc.current!.id}, {path: '/r3'})

    // Remove all redirects
    const result1 = await removeRedirect(ctx, redirect1.id)
    const result2 = await removeRedirect(ctx, redirect2.id)
    const result3 = await removeRedirect(ctx, redirect3.id)

    assert.strictEqual(result1, true)
    assert.strictEqual(result2, true)
    assert.strictEqual(result3, true)

    // Verify all are gone
    const redirects = await getRedirects(ctx, {id: doc.current!.id})
    assert.strictEqual(redirects.length, 0)
  })

  it('should return false when trying to remove same redirect twice', async () => {
    const doc = await upsert(ctx, {
      path: '/test-double-remove',
      title: 'Test Document',
      content: 'Content',
      published: true,
    })
    createdDocumentIds.push(doc.id)

    // Add a redirect
    const redirect = await addRedirect(ctx, {id: doc.current!.id}, {path: '/double'})

    // Remove it once
    const result1 = await removeRedirect(ctx, redirect.id)
    assert.strictEqual(result1, true)

    // Try to remove it again
    const result2 = await removeRedirect(ctx, redirect.id)
    assert.strictEqual(result2, false)
  })

  it('should remove redirect by path string', async () => {
    const doc = await upsert(ctx, {
      path: '/test-remove-by-path',
      title: 'Test Document',
      content: 'Content',
      published: true,
    })
    createdDocumentIds.push(doc.id)

    // Add a redirect
    await addRedirect(ctx, {id: doc.current!.id}, {path: '/path-to-remove'})

    // Remove the redirect by path
    const result = await removeRedirect(ctx, '/path-to-remove')

    assert.strictEqual(result, true)

    // Verify it's gone
    const redirects = await getRedirects(ctx, {id: doc.current!.id})
    assert.strictEqual(redirects.length, 0)
  })

  it('should remove redirect by path object', async () => {
    const doc = await upsert(ctx, {
      path: '/test-remove-by-path-obj',
      title: 'Test Document',
      content: 'Content',
      published: true,
    })
    createdDocumentIds.push(doc.id)

    // Add a redirect
    await addRedirect(ctx, {id: doc.current!.id}, {path: '/path-obj-to-remove'})

    // Remove the redirect by path object
    const result = await removeRedirect(ctx, {path: '/path-obj-to-remove'})

    assert.strictEqual(result, true)

    // Verify it's gone
    const redirects = await getRedirects(ctx, {id: doc.current!.id})
    assert.strictEqual(redirects.length, 0)
  })

  it('should remove redirect by id object', async () => {
    const doc = await upsert(ctx, {
      path: '/test-remove-by-id-obj',
      title: 'Test Document',
      content: 'Content',
      published: true,
    })
    createdDocumentIds.push(doc.id)

    // Add a redirect
    const redirect = await addRedirect(ctx, {id: doc.current!.id}, {path: '/id-obj-to-remove'})

    // Remove the redirect by id object
    const result = await removeRedirect(ctx, {id: redirect.id})

    assert.strictEqual(result, true)

    // Verify it's gone
    const redirects = await getRedirects(ctx, {id: doc.current!.id})
    assert.strictEqual(redirects.length, 0)
  })

  it('should return false when removing non-existent path', async () => {
    const result = await removeRedirect(ctx, '/does-not-exist')

    assert.strictEqual(result, false)
  })

  it('should throw error when attempting to remove canonical path by path string', async () => {
    const doc = await upsert(ctx, {
      path: '/canonical-path-test',
      title: 'Test Document',
      content: 'Content',
      published: true,
    })
    createdDocumentIds.push(doc.id)

    // Try to remove the canonical path by path string
    await assert.rejects(
      async () => {
        await removeRedirect(ctx, '/canonical-path-test')
      },
      {
        message: 'Cannot delete canonical path. Use upsert to change the document path instead.',
      },
    )
  })

  it('should throw error for invalid RedirectQuery format', async () => {
    // Test with an invalid object that has neither id nor path
    await assert.rejects(
      async () => {
        await removeRedirect(ctx, {} as unknown as RedirectQuery)
      },
      {
        message: 'Invalid RedirectQuery format',
      },
    )

    // Test with an object with wrong property types
    await assert.rejects(
      async () => {
        await removeRedirect(ctx, {id: 'not-a-number'} as unknown as RedirectQuery)
      },
      {
        message: 'Invalid RedirectQuery format',
      },
    )

    await assert.rejects(
      async () => {
        await removeRedirect(ctx, {path: 123} as unknown as RedirectQuery)
      },
      {
        message: 'Invalid RedirectQuery format',
      },
    )
  })
})
