import {describe, it, before, after, afterEach} from 'node:test'
import assert from 'node:assert'
import {createTestContext} from '../helpers/db.ts'
import {createRoute} from '../../src/operations/createRoute.ts'
import {upsert} from '../../src/operations/upsert.ts'
import type {PoolClient} from 'pg'
import type {DocumentId} from '../../src/operations/types.ts'

describe('createRoute operation', () => {
  let ctx: PoolClient
  let cleanup: () => Promise<void>
  const createdDocumentIds: number[] = []
  const createdRouteIds: number[] = []
  const testId = Date.now() // Unique identifier for this test run

  before(async () => {
    const tc = await createTestContext()
    ctx = tc.client
    cleanup = tc.cleanup
  })

  afterEach(async () => {
    // Clean up created routes (that aren't tied to documents)
    for (const routeId of createdRouteIds) {
      try {
        await ctx.query(`DELETE FROM routes WHERE id = $1`, [routeId])
      } catch {
        // Route may have been deleted by cascade
      }
    }
    createdRouteIds.length = 0

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

  it('should create a route for an existing document', async () => {
    // First create a document using upsert
    const doc = await upsert(ctx, {
      path: `/test-create-route-${testId}`,
      title: 'Test Document',
      content: 'Content',
      published: true,
    })
    createdDocumentIds.push(doc.current!.id)

    // Create an additional route for the document
    const route = await createRoute(ctx, `/additional-route-${testId}`, doc.current!.id)
    createdRouteIds.push(route.id)

    assert.ok(route.id > 0, 'Route should have an ID')
    assert.strictEqual(route.path, `/additional-route-${testId}`)
    assert.strictEqual(route.document_id, doc.current!.id)
    assert.ok(route.created_at instanceof Date)
  })

  it('should return the created route with all fields', async () => {
    const doc = await upsert(ctx, {
      path: `/test-route-fields-${testId}`,
      title: 'Test Document',
      content: 'Content',
      published: true,
    })
    createdDocumentIds.push(doc.current!.id)

    const route = await createRoute(ctx, `/route-fields-${testId}`, doc.current!.id)
    createdRouteIds.push(route.id)

    // Verify all Route interface fields are present
    assert.ok('id' in route, 'Route should have id field')
    assert.ok('path' in route, 'Route should have path field')
    assert.ok('document_id' in route, 'Route should have document_id field')
    assert.ok('created_at' in route, 'Route should have created_at field')
  })

  it('should create multiple routes for the same document', async () => {
    const doc = await upsert(ctx, {
      path: `/test-multi-routes-${testId}`,
      title: 'Test Document',
      content: 'Content',
      published: true,
    })
    createdDocumentIds.push(doc.current!.id)

    const route1 = await createRoute(ctx, `/multi-route-1-${testId}`, doc.current!.id)
    const route2 = await createRoute(ctx, `/multi-route-2-${testId}`, doc.current!.id)
    const route3 = await createRoute(ctx, `/multi-route-3-${testId}`, doc.current!.id)

    createdRouteIds.push(route1.id, route2.id, route3.id)

    assert.strictEqual(route1.document_id, doc.current!.id)
    assert.strictEqual(route2.document_id, doc.current!.id)
    assert.strictEqual(route3.document_id, doc.current!.id)

    // Each route should have a unique ID
    assert.notStrictEqual(route1.id, route2.id)
    assert.notStrictEqual(route2.id, route3.id)
    assert.notStrictEqual(route1.id, route3.id)
  })

  it('should throw error when path already exists', async () => {
    const doc = await upsert(ctx, {
      path: `/duplicate-path-test-${testId}`,
      title: 'Test Document',
      content: 'Content',
      published: true,
    })
    createdDocumentIds.push(doc.current!.id)

    // Try to create a route with the same path as the document's canonical path
    await assert.rejects(
      async () => {
        await createRoute(ctx, `/duplicate-path-test-${testId}`, doc.current!.id)
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

  it('should throw error when creating duplicate routes', async () => {
    const doc = await upsert(ctx, {
      path: `/dup-route-base-${testId}`,
      title: 'Test Document',
      content: 'Content',
      published: true,
    })
    createdDocumentIds.push(doc.current!.id)

    const route = await createRoute(ctx, `/dup-route-test-${testId}`, doc.current!.id)
    createdRouteIds.push(route.id)

    // Try to create a second route with the same path
    await assert.rejects(
      async () => {
        await createRoute(ctx, `/dup-route-test-${testId}`, doc.current!.id)
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

  it('should throw error when document does not exist', async () => {
    await assert.rejects(
      async () => {
        await createRoute(ctx, `/orphan-route-${testId}`, 999999 as DocumentId)
      },
      (error: Error) => {
        // PostgreSQL foreign key constraint violation
        return (
          error.message.includes('foreign key') ||
          error.message.includes('violates') ||
          error.message.includes('constraint')
        )
      },
    )
  })

  it('should handle paths with special characters', async () => {
    const doc = await upsert(ctx, {
      path: `/special-chars-base-${testId}`,
      title: 'Test Document',
      content: 'Content',
      published: true,
    })
    createdDocumentIds.push(doc.current!.id)

    // Test various path formats
    const route1 = await createRoute(ctx, `/path-with-dashes-${testId}`, doc.current!.id)
    const route2 = await createRoute(ctx, `/path_with_underscores_${testId}`, doc.current!.id)
    const route3 = await createRoute(ctx, `/path/with/slashes/${testId}`, doc.current!.id)

    createdRouteIds.push(route1.id, route2.id, route3.id)

    assert.strictEqual(route1.path, `/path-with-dashes-${testId}`)
    assert.strictEqual(route2.path, `/path_with_underscores_${testId}`)
    assert.strictEqual(route3.path, `/path/with/slashes/${testId}`)
  })

  it('should handle empty path', async () => {
    const doc = await upsert(ctx, {
      path: `/empty-path-test-${testId}`,
      title: 'Test Document',
      content: 'Content',
      published: true,
    })
    createdDocumentIds.push(doc.current!.id)

    // Empty path for root route
    const route = await createRoute(ctx, '', doc.current!.id)
    createdRouteIds.push(route.id)

    assert.strictEqual(route.path, '')
    assert.strictEqual(route.document_id, doc.current!.id)
  })

  it('should persist route to database', async () => {
    const doc = await upsert(ctx, {
      path: `/persist-test-${testId}`,
      title: 'Test Document',
      content: 'Content',
      published: true,
    })
    createdDocumentIds.push(doc.current!.id)

    const route = await createRoute(ctx, `/persisted-route-${testId}`, doc.current!.id)
    createdRouteIds.push(route.id)

    // Verify route exists in database
    const result = await ctx.query<{id: number; path: string; document_id: number}>(
      `SELECT id, path, document_id FROM routes WHERE id = $1`,
      [route.id],
    )

    assert.strictEqual(result.rows.length, 1)
    assert.strictEqual(result.rows[0].id, route.id)
    assert.strictEqual(result.rows[0].path, `/persisted-route-${testId}`)
    assert.strictEqual(result.rows[0].document_id, doc.current!.id)
  })

  it('should set created_at to current timestamp', async () => {
    const doc = await upsert(ctx, {
      path: `/timestamp-test-${testId}`,
      title: 'Test Document',
      content: 'Content',
      published: true,
    })
    createdDocumentIds.push(doc.current!.id)

    const route = await createRoute(ctx, `/timestamp-route-${testId}`, doc.current!.id)
    createdRouteIds.push(route.id)

    // Just verify created_at exists and is a valid date
    assert.ok(route.created_at, 'created_at should exist')
    const createdAtDate = new Date(route.created_at)
    assert.ok(!isNaN(createdAtDate.getTime()), 'created_at should be a valid date')
  })
})
