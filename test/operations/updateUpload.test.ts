import {describe, it, before, after, afterEach} from 'node:test'
import assert from 'node:assert'
import {createTestContext} from '../helpers/db.ts'
import {upsert} from '../../src/operations/upsert.ts'
import {updateUpload} from '../../src/operations/updateUpload.ts'
import {getUploads} from '../../src/operations/getUploads.ts'
import {createTestUpload, cleanupTestUploads} from '../helpers/uploads.ts'
import type {PoolClient} from 'pg'
import type {DocumentId, UploadId} from '../../src/operations/types.ts'

describe('updateUpload operation', () => {
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

  it('should throw when upload does not exist', async () => {
    await assert.rejects(async () => updateUpload(ctx, 999999 as UploadId, {hidden: true}), {
      message: 'Upload does not exist',
    })
  })

  it('should return current upload when nothing to update', async () => {
    const doc = await upsert(ctx, {
      path: `/test-update-noop-${testId}`,
      title: 'Test Document',
      content: 'Content',
      published: true,
    })
    createdDocumentIds.push(doc.current!.id)

    const upload = await createTestUpload(ctx, {id: doc.current!.id}, {filename: 'photo.jpg'})

    const result = await updateUpload(ctx, upload.id as UploadId, {})
    assert.strictEqual(result.id, upload.id)
    assert.strictEqual(result.original_filename, 'photo.jpg')
    assert.strictEqual(result.hidden, false)
  })

  it('should update hidden status', async () => {
    const doc = await upsert(ctx, {
      path: `/test-update-hidden-${testId}`,
      title: 'Test Document',
      content: 'Content',
      published: true,
    })
    createdDocumentIds.push(doc.current!.id)

    const upload = await createTestUpload(ctx, {id: doc.current!.id}, {filename: 'photo.jpg'})

    const result = await updateUpload(ctx, upload.id as UploadId, {hidden: true})
    assert.strictEqual(result.hidden, true)
    assert.strictEqual(result.original_filename, 'photo.jpg')
  })

  it('should update original_filename', async () => {
    const doc = await upsert(ctx, {
      path: `/test-update-rename-${testId}`,
      title: 'Test Document',
      content: 'Content',
      published: true,
    })
    createdDocumentIds.push(doc.current!.id)

    const upload = await createTestUpload(ctx, {id: doc.current!.id}, {filename: 'old-name.jpg'})

    const result = await updateUpload(ctx, upload.id as UploadId, {original_filename: 'new-name.jpg'})
    assert.strictEqual(result.original_filename, 'new-name.jpg')
    assert.strictEqual(result.hidden, false)
  })

  it('should handle collision when renaming to existing visible filename', async () => {
    const doc = await upsert(ctx, {
      path: `/test-update-collision-${testId}`,
      title: 'Test Document',
      content: 'Content',
      published: true,
    })
    createdDocumentIds.push(doc.current!.id)

    // Create two uploads with different names
    const upload1 = await createTestUpload(ctx, {id: doc.current!.id}, {filename: 'target.jpg'})
    const upload2 = await createTestUpload(ctx, {id: doc.current!.id}, {filename: 'source.jpg'})

    // Rename upload2 to 'target.jpg' - should displace upload1
    const result = await updateUpload(ctx, upload2.id as UploadId, {original_filename: 'target.jpg'})
    assert.strictEqual(result.original_filename, 'target.jpg')
    assert.strictEqual(result.hidden, false)

    // upload1 should now be hidden and renamed
    const allUploads = await getUploads(ctx, {id: doc.current!.id as DocumentId}, {includeHidden: true})
    const displaced = allUploads.find(u => u.id === upload1.id)
    assert.ok(displaced)
    assert.strictEqual(displaced.hidden, true)
    assert.ok(displaced.original_filename !== 'target.jpg', 'Displaced upload should have a different name')
  })

  it('should handle collision when unhiding to existing visible filename', async () => {
    const doc = await upsert(ctx, {
      path: `/test-update-unhide-collision-${testId}`,
      title: 'Test Document',
      content: 'Content',
      published: true,
    })
    createdDocumentIds.push(doc.current!.id)

    // Create two uploads with same name - second displaces first
    await createTestUpload(ctx, {id: doc.current!.id}, {filename: 'photo.jpg'})
    const upload2 = await createTestUpload(ctx, {id: doc.current!.id}, {filename: 'photo.jpg'})

    // Get the hidden (displaced) upload
    const allUploads = await getUploads(ctx, {id: doc.current!.id as DocumentId}, {includeHidden: true})
    const hiddenUpload = allUploads.find(u => u.hidden === true)
    assert.ok(hiddenUpload, 'Should have a hidden upload from collision')

    // Unhide it with original name - should displace the currently visible one
    const result = await updateUpload(ctx, hiddenUpload.id as UploadId, {
      original_filename: 'photo.jpg',
      hidden: false,
    })
    assert.strictEqual(result.original_filename, 'photo.jpg')
    assert.strictEqual(result.hidden, false)

    // upload2 should now be hidden
    const updatedUploads = await getUploads(ctx, {id: doc.current!.id as DocumentId}, {includeHidden: true})
    const nowHidden = updatedUploads.find(u => u.id === upload2.id)
    assert.ok(nowHidden)
    assert.strictEqual(nowHidden.hidden, true)
  })

  it('should update both filename and hidden in one call', async () => {
    const doc = await upsert(ctx, {
      path: `/test-update-both-${testId}`,
      title: 'Test Document',
      content: 'Content',
      published: true,
    })
    createdDocumentIds.push(doc.current!.id)

    const upload = await createTestUpload(ctx, {id: doc.current!.id}, {filename: 'photo.jpg'})

    const result = await updateUpload(ctx, upload.id as UploadId, {
      original_filename: 'renamed.jpg',
      hidden: true,
    })
    assert.strictEqual(result.original_filename, 'renamed.jpg')
    assert.strictEqual(result.hidden, true)
  })

  it('should not cause collision when hiding an upload', async () => {
    const doc = await upsert(ctx, {
      path: `/test-update-hide-no-collision-${testId}`,
      title: 'Test Document',
      content: 'Content',
      published: true,
    })
    createdDocumentIds.push(doc.current!.id)

    const upload = await createTestUpload(ctx, {id: doc.current!.id}, {filename: 'photo.jpg'})

    // Hiding should work without collision check since target is hidden
    const result = await updateUpload(ctx, upload.id as UploadId, {hidden: true})
    assert.strictEqual(result.hidden, true)
    assert.strictEqual(result.original_filename, 'photo.jpg')
  })
})
