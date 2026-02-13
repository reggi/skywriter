import {describe, it, before, after, afterEach} from 'node:test'
import assert from 'node:assert'
import {createTestContext} from '../helpers/db.ts'
import {upsert} from '../../src/operations/upsert.ts'
import {getDualDocument} from '../../src/operations/getDualDocument.ts'
import {getRedirects} from '../../src/operations/getRedirects.ts'
import type {PoolClient} from 'pg'

describe('getDualDocument operation', () => {
  let ctx: PoolClient
  let cleanup: () => Promise<void>
  const createdDocumentIds: number[] = []

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

  it('should get a document by direct path', async () => {
    // Create a document
    const created = await upsert(ctx, {
      path: '/test-get-direct',
      title: 'Test Document',
      content: 'Hello World',
      published: true,
    })

    createdDocumentIds.push(created.current!.id)

    // Get the document by its direct path
    const result = await getDualDocument(ctx, '/test-get-direct')

    assert.ok(result, 'Document should be found')
    assert.strictEqual(result.path, '/test-get-direct', 'Should have canonical path')
    assert.strictEqual(result.redirect, false, 'Should not be a redirect (direct path)')
    assert.ok(result.current, 'Should have current version')
    assert.strictEqual(result.current!.path, '/test-get-direct')
    assert.strictEqual(result.current!.title, 'Test Document')
    assert.strictEqual(result.current!.content, 'Hello World')
    assert.strictEqual(result.draft, undefined)
  })

  it('should return null for non-existent path', async () => {
    const result = await getDualDocument(ctx, '/does-not-exist')
    assert.strictEqual(result, null)
  })

  it('should get document with redirect flag when accessed via old route', async () => {
    // Create a document
    const created = await upsert(ctx, {
      path: '/original-path',
      title: 'Test Document',
      content: 'Content',
      published: true,
    })

    createdDocumentIds.push(created.current!.id)

    // Create a redirect route manually (simulating an old path)
    await ctx.query(`INSERT INTO routes (path, document_id) VALUES ($1, $2)`, ['/old-path', created.current!.id])

    // Get via old path should show redirect
    const viaOldPath = await getDualDocument(ctx, '/old-path')
    assert.ok(viaOldPath, 'Document should be found via old path')
    assert.strictEqual(viaOldPath.path, '/original-path', 'Should show canonical path on result')
    assert.strictEqual(viaOldPath.redirect, true, 'Should be a redirect')
    assert.strictEqual(viaOldPath.current!.path, '/original-path', 'Should show canonical path')
    assert.strictEqual(viaOldPath.current!.title, 'Test Document')

    // Get via canonical path should not show redirect
    const viaDirect = await getDualDocument(ctx, '/original-path')
    assert.ok(viaDirect, 'Document should be found via direct path')
    assert.strictEqual(viaDirect.path, '/original-path', 'Should show canonical path on result')
    assert.strictEqual(viaDirect.redirect, false, 'Should not be a redirect')
    assert.strictEqual(viaDirect.current!.path, '/original-path')
  })

  it('should return draft when draft option is true', async () => {
    // Create published document
    const published = await upsert(ctx, {
      path: '/test-get-draft',
      title: 'Published Title',
      content: 'Published content',
      published: true,
    })

    createdDocumentIds.push(published.current!.id)

    // Create draft
    await upsert(
      ctx,
      {path: '/test-get-draft'},
      {
        title: 'Draft Title',
        content: 'Draft content',
        draft: true,
      },
    )

    // Get without draft option - should only return current
    const withoutDraft = await getDualDocument(ctx, '/test-get-draft')
    assert.ok(withoutDraft, 'Document should be found')
    assert.strictEqual(withoutDraft.path, '/test-get-draft', 'Should have canonical path')
    assert.ok(withoutDraft.current, 'Should have current version')
    assert.strictEqual(withoutDraft.current!.title, 'Published Title')
    assert.strictEqual(withoutDraft.draft, undefined, 'Should not have draft')

    // Get with draft option - should return both
    const withDraft = await getDualDocument(ctx, '/test-get-draft', {draft: true})
    assert.ok(withDraft, 'Document should be found')
    assert.ok(withDraft.current, 'Should have current version')
    assert.strictEqual(withDraft.current!.title, 'Published Title')
    assert.ok(withDraft.draft, 'Should have draft version')
    assert.strictEqual(withDraft.draft!.title, 'Draft Title')
    assert.strictEqual(withDraft.draft!.content, 'Draft content')
  })

  it('should not return unpublished document by default', async () => {
    // Create unpublished document (draft only)
    const draft = await upsert(ctx, {
      path: '/test-get-unpublished',
      title: 'Unpublished Document',
      content: 'Draft only',
      draft: true,
    })

    createdDocumentIds.push(draft.draft!.id)

    // Get without unpublished option - should return null
    const withoutUnpublished = await getDualDocument(ctx, '/test-get-unpublished')
    assert.strictEqual(withoutUnpublished, null, 'Should not return unpublished document')

    // Get with unpublished option - should return draft
    const withUnpublished = await getDualDocument(ctx, '/test-get-unpublished')
    assert.strictEqual(withUnpublished, null, 'Should still return null (no draft option)')

    // Get with both unpublished and draft options - should return draft
    const withBoth = await getDualDocument(ctx, '/test-get-unpublished', {draft: true})
    assert.ok(withBoth, 'Should return document with both options')
    assert.strictEqual(withBoth.path, '/test-get-unpublished', 'Should have canonical path')
    assert.strictEqual(withBoth.current, undefined, 'Should not have current version')
    assert.ok(withBoth.draft, 'Should have draft version')
    assert.strictEqual(withBoth.draft!.title, 'Unpublished Document')
  })

  it('should handle redirect flag correctly after multiple route changes', async () => {
    // Create document at path1
    const created = await upsert(ctx, {
      path: '/path1',
      title: 'Document',
      content: 'Content',
      published: true,
    })

    createdDocumentIds.push(created.current!.id)

    // Create additional redirect routes manually
    await ctx.query(`INSERT INTO routes (path, document_id) VALUES ($1, $2), ($3, $4)`, [
      '/path2',
      created.current!.id,
      '/path3',
      created.current!.id,
    ])

    // All old paths should show redirect
    const via1 = await getDualDocument(ctx, '/path1')
    assert.strictEqual(via1!.path, '/path1', 'Should have canonical path')
    assert.strictEqual(via1!.redirect, false, '/path1 is direct (canonical)')

    const via2 = await getDualDocument(ctx, '/path2')
    assert.strictEqual(via2!.path, '/path1', 'Should have canonical path')
    assert.strictEqual(via2!.redirect, true, '/path2 is redirect')
    assert.strictEqual(via2!.current!.path, '/path1', 'Should show canonical path')

    const via3 = await getDualDocument(ctx, '/path3')
    assert.strictEqual(via3!.path, '/path1', 'Should have canonical path')
    assert.strictEqual(via3!.redirect, true, '/path3 is redirect')
    assert.strictEqual(via3!.current!.path, '/path1', 'Should show canonical path')
  })

  it('should return all document fields correctly', async () => {
    // Create document with various fields
    const created = await upsert(ctx, {
      path: '/test-get-fields',
      title: 'Full Document',
      content: 'Main content',
      data: '{"key": "value"}',
      style: 'body { color: red; }',
      script: 'console.log("hello");',
      server: 'export default () => {};',
      mime_type: 'text/html',
      extension: '.html',
      content_type: 'md',
      data_type: 'json',
      has_eta: true,
      published: true,
    })

    createdDocumentIds.push(created.current!.id)

    const result = await getDualDocument(ctx, '/test-get-fields')

    assert.ok(result, 'Document should be found')
    assert.strictEqual(result.path, '/test-get-fields', 'Should have canonical path')
    assert.ok(result.current, 'Should have current version')
    assert.strictEqual(result.current!.title, 'Full Document')
    assert.strictEqual(result.current!.content, 'Main content')
    assert.strictEqual(result.current!.data, '{"key": "value"}')
    assert.strictEqual(result.current!.style, 'body { color: red; }')
    assert.strictEqual(result.current!.script, 'console.log("hello");')
    assert.strictEqual(result.current!.server, 'export default () => {};')
    assert.strictEqual(result.current!.mime_type, 'text/html')
    assert.strictEqual(result.current!.extension, '.html')
    assert.strictEqual(result.current!.content_type, 'md')
    assert.strictEqual(result.current!.data_type, 'json')
    assert.strictEqual(result.current!.has_eta, true)
    assert.strictEqual(result.current!.published, true)
    assert.ok(result.current!.created_at instanceof Date)
    assert.ok(result.current!.updated_at instanceof Date)
  })

  it('should handle null content fields', async () => {
    const created = await upsert(ctx, {
      path: '/test-get-nulls',
      title: 'Minimal Document',
      content: null,
      data: null,
      style: null,
      script: null,
      server: null,
      published: true,
    })

    createdDocumentIds.push(created.current!.id)

    const result = await getDualDocument(ctx, '/test-get-nulls')

    assert.ok(result, 'Document should be found')
    assert.ok(result.current, 'Should have current version')
    assert.strictEqual(result.current!.content, '')
    assert.strictEqual(result.current!.data, '')
    assert.strictEqual(result.current!.style, '')
    assert.strictEqual(result.current!.script, '')
    assert.strictEqual(result.current!.server, '')
  })

  it('should handle redirect correctly when path is changed via upsert', async () => {
    // 1. Create a document at original path
    const created = await upsert(ctx, {
      path: '/original-doc-path',
      title: 'Test Document',
      content: 'Content',
      published: true,
    })

    createdDocumentIds.push(created.current!.id)

    // 2. Fetch by original path - should not be redirect
    const viaOriginalPath = await getDualDocument(ctx, '/original-doc-path')
    assert.ok(viaOriginalPath, 'Document should be found at original path')
    assert.strictEqual(viaOriginalPath.path, '/original-doc-path', 'Should have original canonical path')
    assert.strictEqual(viaOriginalPath.redirect, false, 'Should not be redirect when accessed via canonical path')

    // 3. Change the path using upsert
    await upsert(
      ctx,
      {path: '/original-doc-path'},
      {
        path: '/new-doc-path',
      },
    )

    // 4. Fetch by new path - should not be redirect
    const viaNewPath = await getDualDocument(ctx, '/new-doc-path')
    assert.ok(viaNewPath, 'Document should be found at new path')
    assert.strictEqual(viaNewPath.path, '/new-doc-path', 'Should have new canonical path')
    assert.strictEqual(viaNewPath.redirect, false, 'Should not be redirect when accessed via new canonical path')

    // 5. Fetch by old path - should be redirect
    const viaOldPath = await getDualDocument(ctx, '/original-doc-path')
    assert.ok(viaOldPath, 'Document should still be accessible via old path')
    assert.strictEqual(viaOldPath.path, '/new-doc-path', 'Should return new canonical path')
    assert.strictEqual(viaOldPath.redirect, true, 'Should be redirect when accessed via old path')
    assert.strictEqual(viaOldPath.current!.path, '/new-doc-path', 'Current version should show new path')

    // Confirm both paths point to the same document record
    assert.strictEqual(
      viaNewPath.current!.id,
      viaOldPath.current!.id,
      'Both paths should return the same document record id',
    )
  })

  it('should update existing document when creating with same path', async () => {
    // Create first document at /a
    const first = await upsert(ctx, {
      path: '/a',
      title: 'First Document',
      content: 'First content',
      published: true,
    })

    createdDocumentIds.push(first.current!.id)

    // Try to create another document at /a - should update the existing one
    const second = await upsert(ctx, {
      path: '/a',
      title: 'Second Document',
      content: 'Second content',
      published: true,
    })

    // Should be the same document ID
    assert.strictEqual(first.current!.id, second.current!.id, 'Should update the same document')

    // Verify the content was updated
    const result = await getDualDocument(ctx, '/a')
    assert.ok(result, 'Document should exist')
    assert.strictEqual(result.current!.title, 'Second Document', 'Title should be updated')
    assert.strictEqual(result.current!.content, 'Second content', 'Content should be updated')
  })

  it('should update original document through redirect when upserting via old path', async () => {
    // 1. Create a document at /original
    const created = await upsert(ctx, {
      path: '/original',
      title: 'Original Title',
      content: 'Original content',
      published: true,
    })

    createdDocumentIds.push(created.current!.id)
    const originalId = created.current!.id

    // 2. Rename the path to /renamed
    await upsert(
      ctx,
      {path: '/original'},
      {
        path: '/renamed',
      },
    )

    // 3. Try to upsert using the old path /original
    const updated = await upsert(
      ctx,
      {path: '/original'},
      {
        title: 'Updated Title',
        content: 'Updated content',
        published: true,
      },
    )

    // Should update the same document (not create a new one)
    assert.strictEqual(updated.current!.id, originalId, 'Should update the same document through redirect')

    // 4. Verify via the new path that it was updated
    const viaNewPath = await getDualDocument(ctx, '/renamed')
    assert.ok(viaNewPath, 'Document should be accessible via new path')
    assert.strictEqual(viaNewPath.current!.id, originalId, 'Should be the same document')
    assert.strictEqual(viaNewPath.current!.title, 'Updated Title', 'Title should be updated')
    assert.strictEqual(viaNewPath.current!.content, 'Updated content', 'Content should be updated')

    // 5. Verify via the old path (redirect) that it was updated
    const viaOldPath = await getDualDocument(ctx, '/original')
    assert.ok(viaOldPath, 'Document should be accessible via old path')
    assert.strictEqual(viaOldPath.redirect, true, 'Should be a redirect')
    assert.strictEqual(viaOldPath.current!.id, originalId, 'Should be the same document')
    assert.strictEqual(viaOldPath.current!.title, 'Updated Title', 'Title should be updated via redirect')
  })

  it('should filter by published=true option', async () => {
    // Create a published document
    const published = await upsert(ctx, {
      path: '/test-published-filter',
      title: 'Published',
      published: true,
    })

    createdDocumentIds.push(published.current!.id)

    // Get with published=true should return it
    const result = await getDualDocument(ctx, '/test-published-filter', {published: true})
    assert.ok(result, 'Should return published document')
    assert.strictEqual(result.current!.title, 'Published')
  })

  it('should filter by published=false option', async () => {
    // Create an unpublished document (draft only)
    const unpublished = await upsert(ctx, {
      path: '/test-unpublished-filter',
      title: 'Unpublished',
      draft: true,
    })

    createdDocumentIds.push(unpublished.draft!.id)

    // Get with published=false and draft=true should return it
    const result = await getDualDocument(ctx, '/test-unpublished-filter', {published: false, draft: true})
    assert.ok(result, 'Should return unpublished document')
    assert.strictEqual(result.draft!.title, 'Unpublished')
    assert.strictEqual(result.current, undefined)
  })

  it('should return null when published filter does not match', async () => {
    // Create a published document
    const published = await upsert(ctx, {
      path: '/test-published-mismatch',
      title: 'Published',
      published: true,
    })

    createdDocumentIds.push(published.current!.id)

    // Try to get with published=false - should return null
    const result = await getDualDocument(ctx, '/test-published-mismatch', {published: false})
    assert.strictEqual(result, null, 'Should return null when published filter does not match')
  })

  it('should return null when published document has no current record', async () => {
    // Create a published document first
    const created = await upsert(ctx, {
      path: '/test-no-current',
      title: 'Published',
      content: 'Content',
      published: true,
    })

    createdDocumentIds.push(created.current!.id)

    // Get without draft option - should return current
    const withCurrent = await getDualDocument(ctx, '/test-no-current')
    assert.ok(withCurrent, 'Should find document')
    assert.ok(withCurrent.current, 'Should have current')

    // Now manually clear the current_record_id but keep a draft
    // First create a draft
    await upsert(
      ctx,
      {path: '/test-no-current'},
      {
        title: 'Draft',
        draft: true,
      },
    )

    // Then clear the current record ID
    await ctx.query(`UPDATE documents SET current_record_id = NULL WHERE id = $1`, [created.current!.id])

    // Get without draft option should return null (no current, and no draft requested)
    const withoutDraft = await getDualDocument(ctx, '/test-no-current')
    assert.strictEqual(withoutDraft, null, 'Should return null when no current and draft not requested')

    // Get with draft option should return draft only
    const withDraft = await getDualDocument(ctx, '/test-no-current', {draft: true})
    assert.ok(withDraft, 'Should find document with draft')
    assert.strictEqual(withDraft.current, undefined, 'Should not have current')
    assert.ok(withDraft.draft, 'Should have draft')
  })

  it('should return null when published document is queried with published=false', async () => {
    // Create a published document
    const created = await upsert(ctx, {
      path: '/test-published-false',
      title: 'Published Doc',
      content: 'Content',
      published: true,
    })

    createdDocumentIds.push(created.current!.id)

    // Try to get with published=false - should return null because document.published=true
    const result = await getDualDocument(ctx, '/test-published-false', {published: false})
    assert.strictEqual(result, null, 'Should return null when document.published does not match filter')
  })

  it('should return null when unpublished document is queried with published=true', async () => {
    // Create an unpublished document (draft only)
    const created = await upsert(ctx, {
      path: '/test-unpublished-true',
      title: 'Unpublished Doc',
      content: 'Content',
      draft: true,
    })

    createdDocumentIds.push(created.draft!.id)

    // Try to get with published=true - should return null because document.published=false
    const result = await getDualDocument(ctx, '/test-unpublished-true', {published: true})
    assert.strictEqual(result, null, 'Should return null when unpublished document queried with published=true')
  })

  it('should handle draft-only document with no current', async () => {
    // Create a draft-only unpublished document
    const created = await upsert(ctx, {
      path: '/test-draft-only',
      title: 'Draft Only',
      content: 'Draft content',
      draft: true,
    })

    createdDocumentIds.push(created.draft!.id)

    // Get without draft option - should return null (no current version)
    const withoutDraft = await getDualDocument(ctx, '/test-draft-only', {published: false})
    assert.strictEqual(withoutDraft, null, 'Should return null when draft not requested and no current exists')

    // Get with draft option - should return draft
    const withDraft = await getDualDocument(ctx, '/test-draft-only', {published: false, draft: true})
    assert.ok(withDraft, 'Should return document when draft requested')
    assert.strictEqual(withDraft.current, undefined, 'Should not have current')
    assert.ok(withDraft.draft, 'Should have draft')
    assert.strictEqual(withDraft.draft!.title, 'Draft Only')
  })

  it('should handle database errors and rollback transaction', async () => {
    // Create a document first
    const created = await upsert(ctx, {
      path: '/test-error-handling',
      title: 'Test',
      content: 'Content',
      published: true,
    })

    createdDocumentIds.push(created.current!.id)

    // Force an error by closing the connection and trying to query
    const originalQuery = ctx.query.bind(ctx)
    let callCount = 0
    ctx.query = async function (
      sql: string,
      values?: unknown[],
    ): Promise<{rows: unknown[]; rowCount: number | null; command: string; oid: number; fields: unknown[]}> {
      callCount++
      // Let BEGIN through, then fail on the second query
      if (callCount === 2) {
        throw new Error('Simulated database error')
      }
      return originalQuery(sql, values)
    } as typeof ctx.query

    try {
      await getDualDocument(ctx, '/test-error-handling')
      assert.fail('Should have thrown an error')
    } catch (error) {
      assert.strictEqual((error as Error).message, 'Simulated database error', 'Should throw the simulated error')
    } finally {
      // Restore the original query function
      ctx.query = originalQuery as typeof ctx.query
    }
  })

  it('should work when querying with a Route object (uses document_id, not route.id)', async () => {
    // Create a document
    const doc = await upsert(ctx, {
      path: '/test-route-query',
      title: 'Original Title',
      content: 'Original Content',
      published: true,
    })
    createdDocumentIds.push(doc.id)

    // Rename the document
    await upsert(ctx, {id: doc.id}, {path: '/test-route-renamed'})

    // Get the old redirect route
    const redirects = await getRedirects(ctx, {id: doc.id})
    assert.strictEqual(redirects.length, 1)
    const redirectRoute = redirects[0]

    // Verify route.id !== route.document_id (they're different values)
    assert.notStrictEqual(redirectRoute.id, redirectRoute.document_id)
    assert.strictEqual(redirectRoute.document_id, doc.id)

    // Pass the Route object to get - should use document_id, not route.id
    const result = await getDualDocument(ctx, redirectRoute)

    // Should return the document, not null (proving it used document_id)
    assert.ok(result)
    assert.strictEqual(result.id, doc.id)
    assert.strictEqual(result.id, redirectRoute.document_id)
    assert.strictEqual(result.path, '/test-route-renamed')
    assert.strictEqual(result.current!.title, 'Original Title')
  })

  it('should create document with both current and draft versions', async () => {
    // Create published document
    const jaguar = await upsert(ctx, {
      path: '/jaguar',
      title: 'Jaguars',
      content: 'Jaguars are powerful',
      draft: false,
      published: true,
    })

    createdDocumentIds.push(jaguar.current!.id)

    assert.ok(jaguar.current, 'Should have current version')
    assert.strictEqual(jaguar.current.title, 'Jaguars')
    assert.strictEqual(jaguar.current.content, 'Jaguars are powerful')
    assert.strictEqual(jaguar.draft, undefined, 'Should not have draft initially')

    // Create draft version with different content
    const withDraft = await upsert(ctx, {
      path: '/jaguar',
      title: 'Jaguars (Draft)',
      content: 'Jaguars are powerful swimmers',
      draft: true,
    })

    assert.strictEqual(withDraft.current!.id, jaguar.current!.id, 'Should be the same document')
    assert.ok(withDraft.current, 'Should have current version')
    assert.ok(withDraft.draft, 'Should have draft version')
    assert.strictEqual(withDraft.current.title, 'Jaguars', 'Current title unchanged')
    assert.strictEqual(withDraft.current.content, 'Jaguars are powerful', 'Current content unchanged')
    assert.strictEqual(withDraft.draft.title, 'Jaguars (Draft)', 'Draft has new title')
    assert.strictEqual(withDraft.draft.content, 'Jaguars are powerful swimmers', 'Draft has new content')

    // Verify get() returns the same document (with draft option)
    const retrieved = await getDualDocument(ctx, '/jaguar', {draft: true})

    assert.strictEqual(retrieved!.id, withDraft.current!.id, 'get() should return same document')
    assert.ok(retrieved!.current, 'Retrieved document should have current version')
    assert.ok(retrieved!.draft, 'Retrieved document should have draft version')
    assert.strictEqual(retrieved!.current.title, withDraft.current.title, 'Current title should match')
    assert.strictEqual(retrieved!.current.content, withDraft.current.content, 'Current content should match')
    assert.strictEqual(retrieved!.draft!.title, withDraft.draft.title, 'Draft title should match')
    assert.strictEqual(retrieved!.draft!.content, withDraft.draft.content, 'Draft content should match')
  })
})
