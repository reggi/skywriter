import {describe, it, before, after, afterEach} from 'node:test'
import assert from 'node:assert'
import {createTestContext} from '../helpers/db.ts'
import {upsert} from '../../src/operations/upsert.ts'
import {addRedirect} from '../../src/operations/addRedirect.ts'
import type {PoolClient} from 'pg'
import type {DocumentId} from '../../src/operations/types.ts'

describe('addRedirect operation', () => {
  let ctx: PoolClient
  let cleanup: () => Promise<void>
  const createdDocumentIds: number[] = []
  const testId = Date.now() // Unique identifier for this test run

  before(async () => {
    const tc = await createTestContext()
    ctx = tc.client
    cleanup = tc.cleanup
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
    await cleanup()
  })

  it('should add a redirect to an existing document', async () => {
    const doc = await upsert(ctx, {
      path: `/test-add-redirect-${testId}`,
      title: 'Test Document',
      content: 'Content',
      published: true,
    })
    createdDocumentIds.push(doc.current!.id)

    const redirect = await addRedirect(ctx, {id: doc.current!.id}, {path: `/old-path-${testId}`})

    assert.ok(redirect.id > 0)
    assert.strictEqual(redirect.path, `/old-path-${testId}`)
    assert.strictEqual(redirect.document_id, doc.current!.id)
    assert.ok(redirect.created_at instanceof Date)
  })

  it('should throw error when document does not exist', async () => {
    await assert.rejects(
      async () => {
        await addRedirect(ctx, {id: 999999 as DocumentId}, {path: `/nonexistent-${testId}`})
      },
      {
        message: 'Document does not exist',
      },
    )
  })

  it('should throw error when path already exists', async () => {
    const doc1 = await upsert(ctx, {
      path: `/existing-path-${testId}`,
      title: 'Document 1',
      content: 'Content',
      published: true,
    })
    createdDocumentIds.push(doc1.current!.id)

    const doc2 = await upsert(ctx, {
      path: `/another-path-${testId}`,
      title: 'Document 2',
      content: 'Content',
      published: true,
    })
    createdDocumentIds.push(doc2.current!.id)

    // Try to add a redirect to doc2 using doc1's path
    await assert.rejects(
      async () => {
        await addRedirect(ctx, {id: doc2.current!.id}, {path: `/existing-path-${testId}`})
      },
      (error: Error) => {
        // PostgreSQL unique constraint violation
        return (
          error.message.includes('duplicate') ||
          error.message.includes('unique') ||
          error.message.includes('already exists')
        )
      },
    )
  })

  it('should throw error for paths starting with "/_"', async () => {
    const doc = await upsert(ctx, {
      path: `/test-invalid-start-${testId}`,
      title: 'Test Document',
      content: 'Content',
      published: true,
    })
    createdDocumentIds.push(doc.current!.id)

    await assert.rejects(
      async () => {
        await addRedirect(ctx, {id: doc.current!.id}, {path: `/_invalid-${testId}`})
      },
      (error: Error) => {
        return error.message.includes('cannot start with "/_"')
      },
    )
  })

  it('should throw error for paths ending with "_"', async () => {
    const doc = await upsert(ctx, {
      path: `/test-invalid-end-${testId}`,
      title: 'Test Document',
      content: 'Content',
      published: true,
    })
    createdDocumentIds.push(doc.current!.id)

    await assert.rejects(
      async () => {
        await addRedirect(ctx, {id: doc.current!.id}, {path: `/invalid${testId}_`})
      },
      (error: Error) => {
        return error.message.includes('cannot end with "_"')
      },
    )
  })

  it('should throw error for paths ending with "/" (except root)', async () => {
    const doc = await upsert(ctx, {
      path: `/test-trailing-slash-${testId}`,
      title: 'Test Document',
      content: 'Content',
      published: true,
    })
    createdDocumentIds.push(doc.current!.id)

    await assert.rejects(
      async () => {
        await addRedirect(ctx, {id: doc.current!.id}, {path: `/invalid-${testId}/`})
      },
      (error: Error) => {
        return error.message.includes('cannot end with "/"')
      },
    )
  })

  it('should allow multiple redirects for the same document', async () => {
    const doc = await upsert(ctx, {
      path: `/test-multiple-${testId}`,
      title: 'Test Document',
      content: 'Content',
      published: true,
    })
    createdDocumentIds.push(doc.current!.id)

    const redirect1 = await addRedirect(ctx, {id: doc.current!.id}, {path: `/multiple-redirect-1-${testId}`})
    const redirect2 = await addRedirect(ctx, {id: doc.current!.id}, {path: `/multiple-redirect-2-${testId}`})
    const redirect3 = await addRedirect(ctx, {id: doc.current!.id}, {path: `/multiple-redirect-3-${testId}`})

    assert.strictEqual(redirect1.document_id, doc.current!.id)
    assert.strictEqual(redirect2.document_id, doc.current!.id)
    assert.strictEqual(redirect3.document_id, doc.current!.id)

    assert.strictEqual(redirect1.path, `/multiple-redirect-1-${testId}`)
    assert.strictEqual(redirect2.path, `/multiple-redirect-2-${testId}`)
    assert.strictEqual(redirect3.path, `/multiple-redirect-3-${testId}`)

    // Each should have a unique ID
    assert.notStrictEqual(redirect1.id, redirect2.id)
    assert.notStrictEqual(redirect2.id, redirect3.id)
    assert.notStrictEqual(redirect1.id, redirect3.id)
  })

  it('should handle special characters in path', async () => {
    const doc = await upsert(ctx, {
      path: `/test-special-chars-${testId}`,
      title: 'Test Document',
      content: 'Content',
      published: true,
    })
    createdDocumentIds.push(doc.current!.id)

    const redirect = await addRedirect(ctx, {id: doc.current!.id}, {path: `/old-path-with-dashes-123-${testId}`})

    assert.strictEqual(redirect.path, `/old-path-with-dashes-123-${testId}`)
    assert.strictEqual(redirect.document_id, doc.current!.id)
  })

  it('should create redirect with current timestamp', async () => {
    const doc = await upsert(ctx, {
      path: `/test-timestamp-${testId}`,
      title: 'Test Document',
      content: 'Content',
      published: true,
    })
    createdDocumentIds.push(doc.current!.id)

    const redirect = await addRedirect(ctx, {id: doc.current!.id}, {path: `/timestamp-test-${testId}`})

    // Verify it's a valid Date object
    assert.ok(redirect.created_at instanceof Date)
    assert.ok(!isNaN(redirect.created_at.getTime()))

    // Verify it's reasonably recent (within last 5 minutes - very generous to avoid flakiness)
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000)
    assert.ok(redirect.created_at >= fiveMinutesAgo, 'Timestamp should be recent')
  })
})
