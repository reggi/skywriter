import {describe, it, before, after, afterEach} from 'node:test'
import assert from 'node:assert'
import {createTestContext} from '../helpers/db.ts'
import {upsert} from '../../src/operations/upsert.ts'
import {getDualDocument} from '../../src/operations/getDualDocument.ts'
import type {PoolClient} from 'pg'

describe('upsert operation', () => {
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
        // Delete the document (this will cascade to routes via ON DELETE CASCADE)
        await ctx.query(`DELETE FROM documents WHERE id = $1`, [docId])
      } catch (error) {
        console.error(`Failed to delete document ${docId}:`, error)
      }
    }

    // Clean up orphaned document records (may have template_id dependencies)
    try {
      // Set template_id to null for all orphaned records first to avoid FK constraint issues
      await ctx.query(
        `UPDATE document_records 
         SET template_id = NULL
         WHERE id NOT IN (
           SELECT current_record_id FROM documents WHERE current_record_id IS NOT NULL
           UNION
           SELECT draft_record_id FROM documents WHERE draft_record_id IS NOT NULL
         )`,
      )

      // Now delete the orphaned records
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
    await cleanup()
  })

  it('should create a new document', async () => {
    const result = await upsert(ctx, {
      path: '/test-create',
      title: 'Test Document',
      content: 'Hello World',
      data: '{"key": "value"}',
      published: true,
    })

    createdDocumentIds.push(result.current!.id)

    assert.ok(result.current, 'Document should have current version')
    assert.strictEqual(result.path, '/test-create', 'Should have canonical path')
    assert.ok(result.current.id > 0, 'Document should have an ID')
    assert.strictEqual(result.current.path, '/test-create')
    assert.strictEqual(result.current.title, 'Test Document')
    assert.strictEqual(result.current.content, 'Hello World')
    assert.deepStrictEqual(JSON.parse(result.current.data!), JSON.parse('{"key": "value"}'))
    assert.strictEqual(result.current.published, true)
    assert.strictEqual(result.draft, undefined)
  })

  it('should update an existing document', async () => {
    // Create initial document
    const created = await upsert(ctx, {
      path: '/test-update',
      title: 'Initial Title',
      content: 'Initial content',
      published: true,
    })

    createdDocumentIds.push(created.current!.id)

    // Update the document
    const updated = await upsert(
      ctx,
      {path: '/test-update'},
      {
        title: 'Updated Title',
        content: 'Updated content',
        published: true,
      },
    )

    assert.strictEqual(updated.current!.id, created.current!.id, 'Should be the same document')
    assert.strictEqual(updated.current!.title, 'Updated Title')
    assert.strictEqual(updated.current!.content, 'Updated content')
  })

  it('should create a draft version', async () => {
    // Create published document
    const published = await upsert(ctx, {
      path: '/test-draft',
      title: 'Published Title',
      content: 'Published content',
      published: true,
    })

    createdDocumentIds.push(published.current!.id)

    // Create draft
    const withDraft = await upsert(
      ctx,
      {path: '/test-draft'},
      {
        title: 'Draft Title',
        content: 'Draft content',
        draft: true,
      },
    )

    assert.strictEqual(withDraft.current!.id, published.current!.id, 'Should be the same document')
    assert.strictEqual(withDraft.path, '/test-draft', 'Should have canonical path')
    assert.strictEqual(withDraft.current!.title, 'Published Title', 'Current version unchanged')
    assert.strictEqual(withDraft.current!.content, 'Published content', 'Current content unchanged')
    assert.ok(withDraft.draft, 'Should have draft version')
    assert.strictEqual(withDraft.draft.title, 'Draft Title')
    assert.strictEqual(withDraft.draft.content, 'Draft content')
  })

  it('should publish a draft', async () => {
    // Create published document
    const published = await upsert(ctx, {
      path: '/test-publish-draft',
      title: 'Published Title',
      content: 'Published content',
      published: true,
    })

    createdDocumentIds.push(published.current!.id)

    // Create draft
    await upsert(
      ctx,
      {path: '/test-publish-draft'},
      {
        title: 'Draft Title',
        content: 'Draft content',
        draft: true,
      },
    )

    // Publish the draft
    const publishedDraft = await upsert(
      ctx,
      {path: '/test-publish-draft'},
      {
        title: 'Final Title',
        published: true,
      },
    )

    assert.strictEqual(publishedDraft.current!.id, published.current!.id)
    assert.strictEqual(publishedDraft.current!.title, 'Final Title')
    assert.strictEqual(publishedDraft.current!.content, 'Draft content', 'Content from draft')
    assert.strictEqual(publishedDraft.draft, undefined, 'Draft should be cleared')
  })

  it('should update path and create new route', async () => {
    // Create document
    const created = await upsert(ctx, {
      path: '/test-path-original',
      title: 'Test Document',
      content: 'Content',
      published: true,
    })

    createdDocumentIds.push(created.current!.id)

    // Update via the original path to change the path
    // Note: To update the path, we need to provide a mechanism to do so.
    // Since upsert uses path as the identifier, we'll update the document at the original path
    // and check that we can later access it at the same path
    const updated = await upsert(
      ctx,
      {path: '/test-path-original'},
      {
        title: 'Updated Test Document',
        content: 'Updated Content',
        published: true,
      },
    )

    assert.strictEqual(updated.current!.id, created.current!.id, 'Same document')
    assert.strictEqual(updated.current!.path, '/test-path-original', 'Path unchanged')
    assert.strictEqual(updated.current!.title, 'Updated Test Document', 'Title updated')
    assert.strictEqual(updated.current!.content, 'Updated Content', 'Content updated')
  })

  it('should copy fields from published to draft when creating draft', async () => {
    // Create published document with multiple fields
    const published = await upsert(ctx, {
      path: '/test-draft-copy',
      title: 'Published Title',
      content: 'Published content',
      style: 'body { color: red; }',
      script: 'console.log("published");',
      data: '{"published": true}',
      published: true,
    })

    createdDocumentIds.push(published.current!.id)

    // Create draft with only some fields
    const withDraft = await upsert(
      ctx,
      {path: '/test-draft-copy'},
      {
        title: 'Draft Title',
        draft: true,
      },
    )

    assert.ok(withDraft.draft, 'Should have draft')
    assert.strictEqual(withDraft.draft.title, 'Draft Title', 'Draft title set')
    assert.strictEqual(withDraft.draft.content, 'Published content', 'Content copied from current')
    assert.strictEqual(withDraft.draft.style, 'body { color: red; }', 'Style copied from current')
    assert.strictEqual(withDraft.draft.script, 'console.log("published");', 'Script copied from current')
    assert.deepStrictEqual(
      JSON.parse(withDraft.draft.data!),
      JSON.parse('{"published": true}'),
      'Data copied from current',
    )
  })

  it('should update existing draft', async () => {
    // Create published document
    const published = await upsert(ctx, {
      path: '/test-draft-update',
      title: 'Published Title',
      content: 'Published content',
      published: true,
    })

    createdDocumentIds.push(published.current!.id)

    // Create draft
    await upsert(
      ctx,
      {path: '/test-draft-update'},
      {
        title: 'Draft V1',
        content: 'Draft content V1',
        draft: true,
      },
    )

    // Update draft
    const updated = await upsert(
      ctx,
      {path: '/test-draft-update'},
      {
        title: 'Draft V2',
        content: 'Draft content V2',
        draft: true,
      },
    )

    assert.strictEqual(updated.draft!.title, 'Draft V2')
    assert.strictEqual(updated.draft!.content, 'Draft content V2')
  })

  it('should create unpublished document', async () => {
    const result = await upsert(ctx, {
      path: '/test-unpublished-draft-only',
      title: 'Unpublished Document',
      content: 'Draft only',
      draft: true,
    })

    createdDocumentIds.push(result.draft!.id)

    assert.strictEqual(result.current, undefined, 'No current version')
    assert.strictEqual(result.path, '/test-unpublished-draft-only', 'Should have canonical path')
    assert.ok(result.draft, 'Should have draft')
    assert.strictEqual(result.draft.title, 'Unpublished Document', 'Should show draft')
    assert.strictEqual(result.draft.published, false)
  })

  it('should respect published:false when creating new document with current version', async () => {
    // This test would have failed before the fix where published parameter was ignored
    // when creating new documents (it was hardcoded to !isDraft)
    const result = await upsert(ctx, {
      path: '/test-unpublished-current',
      title: 'Unpublished with Current',
      content: 'This has a current version but is unpublished',
      published: false,
    })

    createdDocumentIds.push(result.current!.id)

    assert.ok(result.current, 'Should have current version')
    assert.strictEqual(result.draft, undefined, 'Should not have draft version')
    assert.strictEqual(result.current.published, false, 'Document should be unpublished')

    // Verify the document is actually unpublished in the database
    const dbCheck = await ctx.query('SELECT published FROM documents WHERE id = $1', [result.id])
    assert.strictEqual(dbCheck.rows[0].published, false, 'Database should show document as unpublished')
  })

  it('should handle mime_type and extension', async () => {
    const result = await upsert(ctx, {
      path: '/test-mime',
      title: 'JSON Document',
      content: '{"data": true}',
      mime_type: 'application/json',
      extension: '.json',
      published: true,
    })

    createdDocumentIds.push(result.current!.id)

    assert.strictEqual(result.current!.mime_type, 'application/json')
    assert.strictEqual(result.current!.extension, '.json')
  })

  it('should handle null content fields', async () => {
    const result = await upsert(ctx, {
      path: '/test-nulls',
      title: 'Minimal Document',
      content: null,
      data: null,
      style: null,
      script: null,
      server: null,
      published: true,
    })

    createdDocumentIds.push(result.current!.id)

    assert.strictEqual(result.current!.content, '')
    assert.strictEqual(result.current!.data, '')
    assert.strictEqual(result.current!.style, '')
    assert.strictEqual(result.current!.script, '')
    assert.strictEqual(result.current!.server, '')
  })

  it('should follow redirects when upserting by old path', async () => {
    // 1. Create a document at /a
    const doc = await upsert(ctx, {
      path: '/test-redirect-a',
      title: 'Original at A',
      published: true,
    })

    createdDocumentIds.push(doc.current!.id)
    assert.strictEqual(doc.redirect, false, 'Should not be redirect initially')

    // 2. Rename the document to /b (creates redirect from /a to /b)
    const renamed = await upsert(
      ctx,
      {path: '/test-redirect-a'},
      {
        path: '/test-redirect-b',
        title: 'Renamed to B',
      },
    )

    assert.strictEqual(renamed.path, '/test-redirect-b', 'Path should be B')
    assert.strictEqual(renamed.current!.title, 'Renamed to B')

    // 3. Try to upsert using the old path /a
    // This should follow the redirect and update the same document at /b
    const viaRedirect = await upsert(
      ctx,
      {path: '/test-redirect-a'},
      {
        title: 'Updated via A (redirect)',
      },
    )

    assert.strictEqual(viaRedirect.redirect, true, 'Should indicate redirect')
    assert.strictEqual(viaRedirect.path, '/test-redirect-b', 'Canonical path should be B')
    assert.strictEqual(viaRedirect.current!.title, 'Updated via A (redirect)')

    // 4. Verify there's only one document, not two
    const checkDocs = await ctx.query(
      `SELECT COUNT(*) as count FROM documents WHERE id IN (
        SELECT document_id FROM routes WHERE path IN ($1, $2)
      )`,
      ['/test-redirect-a', '/test-redirect-b'],
    )
    assert.strictEqual(parseInt(checkDocs.rows[0].count), 1, 'Should only have one document')
  })

  it('should throw error when creating new document without path', async () => {
    await assert.rejects(
      async () => {
        await upsert(ctx, {
          title: 'No Path Document',
          published: true,
        })
      },
      {
        message: 'path is required when creating a new document',
      },
    )
  })

  it('should create document with no title field (using database default)', async () => {
    const result = await upsert(ctx, {
      path: '/test-no-title',
      content: 'Content without title',
      published: true,
    })

    createdDocumentIds.push(result.current!.id)

    assert.ok(result.current, 'Document should have current version')
    assert.strictEqual(result.current.title, '', 'Title should default to empty string')
    assert.strictEqual(result.current.content, 'Content without title')
  })

  it('should use null defaults for template_id and slot_id when not in baseRecord', async () => {
    // Create template and slot documents first
    const template = await upsert(ctx, {
      path: '/test-template-doc',
      title: 'Template Document',
      content: 'Template content',
      published: true,
    })
    createdDocumentIds.push(template.current!.id)

    const slot = await upsert(ctx, {
      path: '/test-slot-doc',
      title: 'Slot Document',
      content: 'Slot content',
      published: true,
    })
    createdDocumentIds.push(slot.current!.id)

    // Use document IDs directly (not document_record IDs)
    const templateDocId = template.current!.id
    const slotDocId = slot.current!.id

    // Create a document with template_id and slot_id
    const initial = await upsert(ctx, {
      path: '/test-template-slot-defaults',
      title: 'Test Document',
      content: 'Initial content',
      template_id: templateDocId,
      slot_id: slotDocId,
      published: true,
    })

    createdDocumentIds.push(initial.current!.id)
    assert.strictEqual(initial.current!.template_id, templateDocId)
    assert.strictEqual(initial.current!.slot_id, slotDocId)

    // Create a draft without specifying template_id or slot_id
    // This should copy them from baseRecord, triggering the fallback
    const withDraft = await upsert(
      ctx,
      {path: '/test-template-slot-defaults'},
      {
        title: 'Draft Title',
        draft: true,
      },
    )

    assert.ok(withDraft.draft)
    assert.strictEqual(withDraft.draft.template_id, templateDocId, 'template_id should be copied from baseRecord')
    assert.strictEqual(withDraft.draft.slot_id, slotDocId, 'slot_id should be copied from baseRecord')
  })

  it('should change published status without changing path', async () => {
    // Create a published document
    const published = await upsert(ctx, {
      path: '/test-publish-status',
      title: 'Published Document',
      content: 'Published content',
      published: true,
    })

    createdDocumentIds.push(published.current!.id)
    assert.strictEqual(published.current!.published, true, 'Should be published')

    // Verify the document is marked as published in the database
    const checkPublished = await ctx.query('SELECT published FROM documents WHERE id = $1', [published.current!.id])
    assert.strictEqual(checkPublished.rows[0].published, true, 'DB should show published=true')

    // Change to unpublished without changing the path
    const unpublished = await upsert(
      ctx,
      {path: '/test-publish-status'},
      {
        title: 'Now Unpublished',
        published: false,
      },
    )

    assert.strictEqual(unpublished.current!.id, published.current!.id, 'Same document')
    assert.strictEqual(unpublished.current!.published, false, 'Should be unpublished')
    assert.strictEqual(unpublished.current!.title, 'Now Unpublished', 'Title should be updated')

    // Verify the document is marked as unpublished in the database
    const checkUnpublished = await ctx.query('SELECT published FROM documents WHERE id = $1', [unpublished.current!.id])
    assert.strictEqual(checkUnpublished.rows[0].published, false, 'DB should show published=false')
  })

  it('should preserve draft when toggling published status without content changes', async () => {
    // Create a published document
    const published = await upsert(ctx, {
      path: '/test-publish-preserve-draft',
      title: 'Published Document',
      content: 'Published content',
      published: true,
    })

    createdDocumentIds.push(published.current!.id)

    // Create a draft with different content
    const withDraft = await upsert(
      ctx,
      {path: '/test-publish-preserve-draft'},
      {
        title: 'Draft Title',
        content: 'Draft content is different',
        draft: true,
      },
    )

    assert.ok(withDraft.draft, 'Should have draft')
    assert.strictEqual(withDraft.draft.title, 'Draft Title')
    assert.strictEqual(withDraft.draft.content, 'Draft content is different')

    // Toggle published status to false - draft should be preserved
    const unpublished = await upsert(
      ctx,
      {path: '/test-publish-preserve-draft'},
      {
        published: false,
      },
    )

    assert.strictEqual(unpublished.published, false, 'Should be unpublished')
    assert.ok(unpublished.draft, 'Draft should be preserved after toggling published status')
    assert.strictEqual(unpublished.draft.title, 'Draft Title', 'Draft title should be preserved')
    assert.strictEqual(unpublished.draft.content, 'Draft content is different', 'Draft content should be preserved')

    // Toggle published status back to true - draft should still be preserved
    const republished = await upsert(
      ctx,
      {path: '/test-publish-preserve-draft'},
      {
        published: true,
      },
    )

    assert.strictEqual(republished.published, true, 'Should be published again')
    assert.ok(republished.draft, 'Draft should still be preserved after toggling published status back')
    assert.strictEqual(republished.draft.title, 'Draft Title', 'Draft title should still be preserved')
    assert.strictEqual(
      republished.draft.content,
      'Draft content is different',
      'Draft content should still be preserved',
    )
  })

  it('should update draft when document has no current record', async () => {
    // Create a draft-only document (no current/published version)
    const draftOnly = await upsert(ctx, {
      path: '/test-draft-only-update',
      title: 'Draft Only',
      content: 'Initial draft content',
      draft: true,
    })

    createdDocumentIds.push(draftOnly.draft!.id)
    assert.strictEqual(draftOnly.current, undefined, 'Should have no current version')
    assert.ok(draftOnly.draft, 'Should have draft')
    assert.strictEqual(draftOnly.draft.title, 'Draft Only')

    // Update the draft - this triggers the publishedRecord = null branch
    const updated = await upsert(
      ctx,
      {path: '/test-draft-only-update'},
      {
        title: 'Updated Draft',
        content: 'Updated draft content',
        draft: true,
      },
    )

    assert.strictEqual(updated.current, undefined, 'Still no current version')
    assert.ok(updated.draft, 'Should have draft')
    assert.strictEqual(updated.draft.title, 'Updated Draft')
    assert.strictEqual(updated.draft.content, 'Updated draft content')
    assert.strictEqual(updated.draft.id, draftOnly.draft.id, 'Same document')
  })

  it('should delete draft when upserting with draft: false', async () => {
    // Create a document with a draft
    const withDraft = await upsert(ctx, {
      path: '/test-delete-draft',
      title: 'Published Version',
      content: 'Published content',
      published: true,
    })

    createdDocumentIds.push(withDraft.current!.id)

    // Add a draft
    await upsert(
      ctx,
      {path: '/test-delete-draft'},
      {
        title: 'Draft Version',
        content: 'Draft content',
        draft: true,
      },
    )

    // Verify draft exists
    const beforeUpdate = await getDualDocument(ctx, '/test-delete-draft', {draft: true})
    assert.ok(beforeUpdate?.draft, 'Draft should exist')
    assert.strictEqual(beforeUpdate.draft.title, 'Draft Version')

    // Update with draft: false - should delete the draft
    const updated = await upsert(
      ctx,
      {path: '/test-delete-draft'},
      {
        title: 'New Published Version',
        content: 'New published content',
        draft: false,
      },
    )

    assert.ok(updated.current, 'Should have current version')
    assert.strictEqual(updated.current.title, 'New Published Version')
    assert.strictEqual(updated.current.content, 'New published content')
    assert.strictEqual(updated.draft, undefined, 'Draft should be deleted')

    // Verify draft is deleted in database
    const afterUpdate = await getDualDocument(ctx, '/test-delete-draft', {draft: true})
    assert.strictEqual(afterUpdate?.draft, undefined, 'Draft should not exist in DB')
  })

  it('should delete draft when upserting with draft: false on draft-only document', async () => {
    // Create a draft-only document (no current version)
    const draftOnly = await upsert(ctx, {
      path: '/test-delete-draft-only',
      title: 'Draft Only',
      content: 'Draft content',
      draft: true,
    })

    createdDocumentIds.push(draftOnly.draft!.id)
    assert.strictEqual(draftOnly.current, undefined, 'Should have no current version')
    assert.ok(draftOnly.draft, 'Should have draft')

    // Update with draft: false - should create current and delete draft
    const updated = await upsert(
      ctx,
      {path: '/test-delete-draft-only'},
      {
        title: 'Now Published',
        content: 'Published content',
        draft: false,
      },
    )

    assert.ok(updated.current, 'Should now have current version')
    assert.strictEqual(updated.current.title, 'Now Published')
    assert.strictEqual(updated.current.content, 'Published content')
    assert.strictEqual(updated.draft, undefined, 'Draft should be deleted')

    // Verify in database
    const afterUpdate = await getDualDocument(ctx, '/test-delete-draft-only', {draft: true})
    assert.ok(afterUpdate?.current, 'Should have current in DB')
    assert.strictEqual(afterUpdate.draft, undefined, 'Draft should not exist in DB')
  })

  it('should drop draft when it becomes identical to current document', async () => {
    // Create a document with current version
    const doc = await upsert(ctx, {
      path: '/test-identical-draft',
      title: 'Original Title',
      content: 'Original content',
      data: 'test data',
      draft: false,
    })

    createdDocumentIds.push(doc.current!.id)
    assert.ok(doc.current, 'Should have current version')
    assert.strictEqual(doc.draft, undefined, 'Should have no draft')

    // Create a draft with different content
    const withDraft = await upsert(
      ctx,
      {path: '/test-identical-draft'},
      {
        title: 'Draft Title',
        content: 'Draft content',
        draft: true,
      },
    )

    assert.ok(withDraft.current, 'Should still have current version')
    assert.ok(withDraft.draft, 'Should have draft')
    assert.strictEqual(withDraft.draft.title, 'Draft Title')
    assert.strictEqual(withDraft.draft.content, 'Draft content')

    // Now update draft to match current exactly
    const identical = await upsert(
      ctx,
      {path: '/test-identical-draft'},
      {
        title: 'Original Title',
        content: 'Original content',
        draft: true,
      },
    )

    // Draft should be automatically dropped because it's identical to current
    assert.ok(identical.current, 'Should still have current version')
    assert.strictEqual(identical.draft, undefined, 'Draft should be dropped because it matches current')
    assert.strictEqual(identical.current.title, 'Original Title')
    assert.strictEqual(identical.current.content, 'Original content')

    // Verify in database
    const afterUpdate = await getDualDocument(ctx, '/test-identical-draft', {draft: true})
    assert.ok(afterUpdate?.current, 'Should have current in DB')
    assert.strictEqual(afterUpdate.draft, undefined, 'Draft should not exist in DB')
  })

  it('should drop draft when updating only some fields makes it identical', async () => {
    // Create a document
    const doc = await upsert(ctx, {
      path: '/test-partial-identical',
      title: 'Title',
      content: 'Content',
      data: 'Data',
      style: 'Style',
      draft: false,
    })

    createdDocumentIds.push(doc.current!.id)

    // Create a draft with some different fields
    const withDraft = await upsert(
      ctx,
      {path: '/test-partial-identical'},
      {
        content: 'Different Content',
        draft: true,
      },
    )

    assert.ok(withDraft.draft, 'Should have draft')
    assert.strictEqual(withDraft.draft.content, 'Different Content')

    // Update only the content field back to match current
    const updated = await upsert(
      ctx,
      {path: '/test-partial-identical'},
      {
        content: 'Content', // Back to original
        draft: true,
      },
    )

    // Since all fields now match, draft should be dropped
    assert.ok(updated.current, 'Should have current version')
    assert.strictEqual(updated.draft, undefined, 'Draft should be dropped because all fields match')

    // Verify in database
    const afterUpdate = await getDualDocument(ctx, '/test-partial-identical', {draft: true})
    assert.strictEqual(afterUpdate?.draft, undefined, 'Draft should not exist in DB')
  })
})
