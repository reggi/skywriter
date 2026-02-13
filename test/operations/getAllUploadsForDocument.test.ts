import {describe, it, before, after, afterEach} from 'node:test'
import assert from 'node:assert'
import {createTestContext} from '../helpers/db.ts'
import {upsert} from '../../src/operations/upsert.ts'
import {getAllUploadsForDocument} from '../../src/operations/getAllUploadsForDocument.ts'
import {createTestUpload, cleanupTestUploads} from '../helpers/uploads.ts'
import type {PoolClient} from 'pg'
import type {DocumentId} from '../../src/operations/types.ts'

describe('getAllUploadsForDocument operation', () => {
  let ctx: PoolClient
  let cleanup: () => Promise<void>
  const createdDocumentIds: number[] = []
  const testId = Date.now()

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
    await cleanupTestUploads()
  })

  it('should return empty array for document with no uploads', async () => {
    const doc = await upsert(ctx, {
      path: `/test-no-uploads-all-${testId}`,
      title: 'Test Document',
      content: 'Content',
      published: true,
    })
    createdDocumentIds.push(doc.current!.id)

    const uploads = await getAllUploadsForDocument(ctx, doc.current!.id as DocumentId)
    assert.strictEqual(uploads.length, 0)
  })

  it('should return all uploads for a document', async () => {
    const doc = await upsert(ctx, {
      path: `/test-all-uploads-${testId}`,
      title: 'Test Document',
      content: 'Content',
      published: true,
    })
    createdDocumentIds.push(doc.current!.id)

    await createTestUpload(ctx, {id: doc.current!.id}, {filename: 'photo1.jpg'})
    await createTestUpload(ctx, {id: doc.current!.id}, {filename: 'photo2.png'})

    const uploads = await getAllUploadsForDocument(ctx, doc.current!.id as DocumentId)
    assert.strictEqual(uploads.length, 2)
  })

  it('should include hidden uploads', async () => {
    const doc = await upsert(ctx, {
      path: `/test-hidden-all-${testId}`,
      title: 'Test Document',
      content: 'Content',
      published: true,
    })
    createdDocumentIds.push(doc.current!.id)

    // Add two uploads with same name - second displaces first (marks it hidden)
    await createTestUpload(ctx, {id: doc.current!.id}, {filename: 'photo.jpg'})
    await createTestUpload(ctx, {id: doc.current!.id}, {filename: 'photo.jpg'})

    const uploads = await getAllUploadsForDocument(ctx, doc.current!.id as DocumentId)
    // Should return both - the visible one and the hidden one
    assert.strictEqual(uploads.length, 2)
    assert.ok(
      uploads.some(u => u.hidden === true),
      'Should include a hidden upload',
    )
    assert.ok(
      uploads.some(u => u.hidden === false),
      'Should include a visible upload',
    )
  })

  it('should return uploads with hidden field', async () => {
    const doc = await upsert(ctx, {
      path: `/test-hidden-field-${testId}`,
      title: 'Test Document',
      content: 'Content',
      published: true,
    })
    createdDocumentIds.push(doc.current!.id)

    await createTestUpload(ctx, {id: doc.current!.id}, {filename: 'test.jpg'})

    const uploads = await getAllUploadsForDocument(ctx, doc.current!.id as DocumentId)
    assert.strictEqual(uploads.length, 1)
    assert.strictEqual(typeof uploads[0].hidden, 'boolean')
    assert.strictEqual(uploads[0].hidden, false)
  })
})
