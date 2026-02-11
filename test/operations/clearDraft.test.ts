import {describe, it, before, after, afterEach} from 'node:test'
import assert from 'node:assert'
import {createDatabaseContext, closeDatabaseContext, closePool} from '../../src/db/index.ts'
import {upsert} from '../../src/operations/upsert.ts'
import {clearDraft} from '../../src/operations/clearDraft.ts'
import type {PoolClient} from 'pg'

describe('clearDraft', () => {
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

  it('should delete draft and revert to published version', async () => {
    // 1. Create a document with a current version
    const doc = await upsert(ctx, {
      path: '/test-clear-draft-1',
      title: 'Published Title',
      content: 'Published content',
      published: true,
    })

    createdDocumentIds.push(doc.current!.id)

    assert.ok(doc.current, 'Should have current version')
    assert.strictEqual(doc.current.title, 'Published Title')
    assert.strictEqual(doc.draft, undefined, 'Should not have draft initially')

    // 2. Create a draft with different content
    const docWithDraft = await upsert(
      ctx,
      {path: '/test-clear-draft-1'},
      {
        title: 'Draft Title',
        content: 'Draft content',
        draft: true,
      },
    )

    assert.ok(docWithDraft.draft, 'Should have draft')
    assert.strictEqual(docWithDraft.draft.title, 'Draft Title')
    assert.strictEqual(docWithDraft.current?.title, 'Published Title')

    // 3. Clear the draft
    const clearedDoc = await clearDraft(ctx, {path: '/test-clear-draft-1'})

    // 4. Verify draft was deleted and only current remains
    assert.ok(clearedDoc.current, 'Should still have current version')
    assert.strictEqual(clearedDoc.current.title, 'Published Title')
    assert.strictEqual(clearedDoc.current.content, 'Published content')
    assert.strictEqual(clearedDoc.draft, undefined, 'Draft should be cleared')
  })

  it('should return document unchanged if no draft exists', async () => {
    // 1. Create a document with only current version
    const doc = await upsert(ctx, {
      path: '/test-clear-draft-2',
      title: 'Only Current',
      content: 'Current content',
      published: true,
    })

    createdDocumentIds.push(doc.current!.id)

    assert.ok(doc.current, 'Should have current version')
    assert.strictEqual(doc.draft, undefined, 'Should not have draft')

    // 2. Try to clear draft (no-op)
    const result = await clearDraft(ctx, {path: '/test-clear-draft-2'})

    // 3. Verify nothing changed
    assert.ok(result.current, 'Should still have current version')
    assert.strictEqual(result.current.title, 'Only Current')
    assert.strictEqual(result.draft, undefined, 'Still should not have draft')
  })

  it('should throw error if document not found', async () => {
    await assert.rejects(async () => {
      await clearDraft(ctx, {path: '/nonexistent-path'})
    }, /Document not found/)
  })

  it('should delete draft record from database', async () => {
    // 1. Create document with draft
    const doc = await upsert(ctx, {
      path: '/test-clear-draft-3',
      title: 'Current',
      published: true,
    })

    createdDocumentIds.push(doc.current!.id)

    const docWithDraft = await upsert(
      ctx,
      {path: '/test-clear-draft-3'},
      {
        title: 'Draft',
        draft: true,
      },
    )

    // Get draft_record_id from the database
    const beforeClear = await ctx.query(`SELECT draft_record_id FROM documents WHERE id = $1`, [docWithDraft.id])
    const draftRecordId = beforeClear.rows[0].draft_record_id

    assert.ok(draftRecordId, 'Draft record ID should exist')

    // Verify draft record exists
    const recordCheck = await ctx.query(`SELECT * FROM document_records WHERE id = $1`, [draftRecordId])
    assert.strictEqual(recordCheck.rows.length, 1, 'Draft record should exist')

    // 2. Clear draft
    await clearDraft(ctx, {path: '/test-clear-draft-3'})

    // 3. Verify draft record was deleted from database
    const afterClear = await ctx.query(`SELECT * FROM document_records WHERE id = $1`, [draftRecordId])
    assert.strictEqual(afterClear.rows.length, 0, 'Draft record should be deleted')
  })

  it('should update document.draft_record_id to NULL', async () => {
    // 1. Create document with draft
    const doc = await upsert(ctx, {
      path: '/test-clear-draft-4',
      title: 'Current',
      published: true,
    })

    createdDocumentIds.push(doc.current!.id)

    const docWithDraft = await upsert(
      ctx,
      {path: '/test-clear-draft-4'},
      {
        title: 'Draft',
        draft: true,
      },
    )

    // Verify document has draft_record_id
    const beforeClear = await ctx.query(`SELECT draft_record_id FROM documents WHERE id = $1`, [docWithDraft.id])
    assert.ok(beforeClear.rows[0].draft_record_id, 'Document should have draft_record_id')

    // 2. Clear draft
    await clearDraft(ctx, {path: '/test-clear-draft-4'})

    // 3. Verify draft_record_id is NULL
    const afterClear = await ctx.query(`SELECT draft_record_id FROM documents WHERE id = $1`, [docWithDraft.id])
    assert.strictEqual(afterClear.rows[0].draft_record_id, null, 'draft_record_id should be NULL')
  })

  it('should work with document ID instead of path', async () => {
    // 1. Create document with draft
    const doc = await upsert(ctx, {
      path: '/test-clear-draft-5',
      title: 'Current',
      published: true,
    })

    createdDocumentIds.push(doc.current!.id)

    const docWithDraft = await upsert(
      ctx,
      {path: '/test-clear-draft-5'},
      {
        title: 'Draft',
        draft: true,
      },
    )

    assert.ok(docWithDraft.draft, 'Should have draft')

    // 2. Clear draft using document ID
    const clearedDoc = await clearDraft(ctx, {id: docWithDraft.id})

    // 3. Verify draft was cleared
    assert.strictEqual(clearedDoc.draft, undefined, 'Draft should be cleared')
    assert.ok(clearedDoc.current, 'Current should still exist')
  })
})
