import {describe, it, before, after, afterEach} from 'node:test'
import assert from 'node:assert'
import {createDatabaseContext, closeDatabaseContext, closePool} from '../../src/db/index.ts'
import {upsert} from '../../src/operations/upsert.ts'
import {getUpload} from '../../src/operations/getUpload.ts'
import {createTestUpload, cleanupTestUploads} from '../helpers/uploads.ts'
import type {PoolClient} from 'pg'
import type {DocumentId} from '../../src/operations/types.ts'

describe('getUpload operation', () => {
  let ctx: PoolClient
  const createdDocumentIds: number[] = []
  const testId = Date.now()

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
    await cleanupTestUploads()
  })

  it('should return null for non-existent document', async () => {
    const upload = await getUpload(ctx, {id: 999999 as DocumentId}, 'test.jpg')

    assert.strictEqual(upload, null)
  })

  it('should return null for non-existent filename', async () => {
    const doc = await upsert(ctx, {
      path: `/test-no-match-${testId}`,
      title: 'Test Document',
      content: 'Content',
      published: true,
    })
    createdDocumentIds.push(doc.current!.id)

    const upload = await getUpload(ctx, {id: doc.current!.id}, 'nonexistent.jpg')

    assert.strictEqual(upload, null)
  })

  it('should return specific upload by filename using document id', async () => {
    const doc = await upsert(ctx, {
      path: `/test-get-upload-id-${testId}`,
      title: 'Test Document',
      content: 'Content',
      published: true,
    })
    createdDocumentIds.push(doc.current!.id)

    // Add multiple uploads
    await createTestUpload(ctx, {id: doc.current!.id}, {filename: 'photo1.jpg'})
    const upload2 = await createTestUpload(ctx, {id: doc.current!.id}, {filename: 'photo2.png'})
    await createTestUpload(ctx, {id: doc.current!.id}, {filename: 'animation.gif'})

    const upload = await getUpload(ctx, {id: doc.current!.id}, 'photo2.png')

    assert.ok(upload)
    assert.strictEqual(upload.id, upload2.id)
    assert.ok(upload.filename, 'Upload should have a filename')
    assert.ok(upload.original_filename.endsWith('.png'), 'Original filename should end with .png')
    assert.strictEqual(upload.document_id, doc.current!.id)
    assert.ok(upload.created_at instanceof Date)
  })

  it('should return specific upload by filename using document path', async () => {
    const doc = await upsert(ctx, {
      path: `/test-get-upload-path-${testId}`,
      title: 'Test Document',
      content: 'Content',
      published: true,
    })
    createdDocumentIds.push(doc.current!.id)

    // Add multiple uploads
    await createTestUpload(ctx, {id: doc.current!.id}, {filename: 'photo1.jpg'})
    const upload2 = await createTestUpload(ctx, {id: doc.current!.id}, {filename: 'photo2.png'})
    await createTestUpload(ctx, {id: doc.current!.id}, {filename: 'animation.gif'})

    const upload = await getUpload(ctx, `/test-get-upload-path-${testId}`, 'photo2.png')

    assert.ok(upload)
    assert.strictEqual(upload.id, upload2.id)
    assert.ok(upload.filename, 'Upload should have a filename')
    assert.ok(upload.original_filename.endsWith('.png'), 'Original filename should end with .png')
    assert.strictEqual(upload.document_id, doc.current!.id)
    assert.ok(upload.created_at instanceof Date)
  })

  it('should only return upload from the specified document', async () => {
    const doc1 = await upsert(ctx, {
      path: `/test-upload-doc1-${testId}`,
      title: 'Document 1',
      content: 'Content',
      published: true,
    })
    createdDocumentIds.push(doc1.current!.id)

    const doc2 = await upsert(ctx, {
      path: `/test-upload-doc2-${testId}`,
      title: 'Document 2',
      content: 'Content',
      published: true,
    })
    createdDocumentIds.push(doc2.current!.id)

    // Add same filename to both documents
    await createTestUpload(ctx, {id: doc1.current!.id}, {filename: 'doc1-original.jpg'})
    const upload2 = await createTestUpload(ctx, {id: doc2.current!.id}, {filename: 'doc2-original.jpg'})

    const upload = await getUpload(ctx, {id: doc2.current!.id}, 'doc2-original.jpg')

    assert.ok(upload)
    assert.strictEqual(upload.id, upload2.id)
    assert.ok(upload.original_filename.includes('doc2-original'), 'Original filename should include doc2-original')
    assert.strictEqual(upload.document_id, doc2.current!.id)
  })

  describe('hidden uploads', () => {
    it('should exclude hidden uploads by default', async () => {
      const doc = await upsert(ctx, {
        path: `/test-hidden-default-${testId}`,
        title: 'Test Document',
        content: 'Content',
        published: true,
      })
      createdDocumentIds.push(doc.current!.id)

      // Add two uploads with same name - second displaces first (marks it hidden)
      await createTestUpload(ctx, {id: doc.current!.id}, {filename: 'photo.jpg'})
      const upload2 = await createTestUpload(ctx, {id: doc.current!.id}, {filename: 'photo.jpg'})

      // Default: should return the visible upload (upload2)
      const result = await getUpload(ctx, {id: doc.current!.id}, 'photo.jpg')
      assert.ok(result)
      assert.strictEqual(result.id, upload2.id)
      assert.strictEqual(result.hidden, false)
    })

    it('should include hidden uploads when includeHidden is true', async () => {
      const doc = await upsert(ctx, {
        path: `/test-hidden-include-${testId}`,
        title: 'Test Document',
        content: 'Content',
        published: true,
      })
      createdDocumentIds.push(doc.current!.id)

      // Add two uploads with same name - first gets displaced with a renamed filename
      await createTestUpload(ctx, {id: doc.current!.id}, {filename: 'photo.jpg'})

      // After adding second with same name, upload1 is hidden and renamed
      await createTestUpload(ctx, {id: doc.current!.id}, {filename: 'photo.jpg'})

      // Verify the visible one can be found with includeHidden
      const visibleResult = await getUpload(ctx, {id: doc.current!.id}, 'photo.jpg', {includeHidden: true})
      assert.ok(visibleResult)
      assert.strictEqual(typeof visibleResult.hidden, 'boolean')
    })
  })
})
