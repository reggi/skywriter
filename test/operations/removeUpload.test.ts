import {describe, it, before, after, afterEach} from 'node:test'
import assert from 'node:assert'
import {createTestContext} from '../helpers/db.ts'
import {upsert} from '../../src/operations/upsert.ts'
import {createTestUpload, cleanupTestUploads, getTestUploadsPath} from '../helpers/uploads.ts'
import {removeUpload} from '../../src/operations/removeUpload.ts'
import {getUploads} from '../../src/operations/getUploads.ts'
import type {PoolClient} from 'pg'
import {access} from 'node:fs/promises'
import {join} from 'node:path'

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

describe('removeUpload operation', () => {
  let ctx: PoolClient
  let cleanup: () => Promise<void>
  const createdDocumentIds: number[] = []
  const testId = Date.now()
  let uploadsPath: string

  before(async () => {
    const tc = await createTestContext()
    ctx = tc.client
    cleanup = tc.cleanup
    uploadsPath = await getTestUploadsPath()
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
    await cleanupTestUploads()
  })

  it('should remove an upload and delete file from disk', async () => {
    const doc = await upsert(ctx, {
      path: `/test-remove-upload-${testId}`,
      title: 'Test Document',
      content: 'Content',
      published: true,
    })
    createdDocumentIds.push(doc.current!.id)

    // Add an upload
    const upload = await createTestUpload(ctx, {id: doc.current!.id}, {filename: 'photo.jpg'})

    // Verify file exists on disk
    const filePath = join(uploadsPath, upload.filename)
    assert.ok(await pathExists(filePath), 'File should exist before removal')

    // Remove the upload
    const result = await removeUpload(ctx, {id: doc.current!.id}, uploadsPath, 'photo.jpg')

    assert.strictEqual(result.original_filename, 'photo.jpg')
    assert.strictEqual(result.filename, upload.filename)

    // Verify file was deleted from disk
    assert.strictEqual(await pathExists(filePath), false, 'File should be deleted after removal')

    // Verify it's gone from database
    const uploads = await getUploads(ctx, {id: doc.current!.id})
    assert.strictEqual(uploads.length, 0)
  })

  it('should throw error when upload does not exist', async () => {
    const doc = await upsert(ctx, {
      path: `/test-nonexistent-upload-${testId}`,
      title: 'Test Document',
      content: 'Content',
      published: true,
    })
    createdDocumentIds.push(doc.current!.id)

    await assert.rejects(async () => removeUpload(ctx, {id: doc.current!.id}, uploadsPath, 'nonexistent.jpg'), {
      message: 'Upload not found',
    })
  })

  it('should throw error for invalid filename', async () => {
    const doc = await upsert(ctx, {
      path: `/test-invalid-filename-${testId}`,
      title: 'Test Document',
      content: 'Content',
      published: true,
    })
    createdDocumentIds.push(doc.current!.id)

    await assert.rejects(async () => removeUpload(ctx, {id: doc.current!.id}, uploadsPath, ''), {
      message: 'Invalid filename',
    })
  })

  it('should remove one upload without affecting others', async () => {
    const doc = await upsert(ctx, {
      path: `/test-remove-one-${testId}`,
      title: 'Test Document',
      content: 'Content',
      published: true,
    })
    createdDocumentIds.push(doc.current!.id)

    // Add multiple uploads
    const _upload1 = await createTestUpload(ctx, {id: doc.current!.id}, {filename: 'photo1.jpg'})
    const _upload2 = await createTestUpload(ctx, {id: doc.current!.id}, {filename: 'photo2.png'})
    const _upload3 = await createTestUpload(ctx, {id: doc.current!.id}, {filename: 'photo3.gif'})

    // Remove the middle upload
    const result = await removeUpload(ctx, {id: doc.current!.id}, uploadsPath, 'photo2.png')

    assert.strictEqual(result.original_filename, 'photo2.png')

    // Verify only 2 uploads remain
    const uploads = await getUploads(ctx, {id: doc.current!.id})
    assert.strictEqual(uploads.length, 2)

    const uploadFilenames = uploads.map(u => u.original_filename)
    assert.ok(uploadFilenames.includes('photo1.jpg'))
    assert.ok(!uploadFilenames.includes('photo2.png'))
    assert.ok(uploadFilenames.includes('photo3.gif'))
  })

  it('should succeed when file does not exist on disk (ENOENT)', async () => {
    const doc = await upsert(ctx, {
      path: `/test-enoent-${testId}`,
      title: 'Test Document',
      content: 'Content',
      published: true,
    })
    createdDocumentIds.push(doc.current!.id)

    // Add an upload
    const upload = await createTestUpload(ctx, {id: doc.current!.id}, {filename: 'photo.jpg'})

    // Manually delete the file from disk to simulate ENOENT scenario
    const filePath = join(uploadsPath, upload.filename)
    const {unlink} = await import('node:fs/promises')
    await unlink(filePath)
    assert.strictEqual(await pathExists(filePath), false, 'File should not exist')

    // Remove should still succeed even if file is missing
    const result = await removeUpload(ctx, {id: doc.current!.id}, uploadsPath, 'photo.jpg')

    assert.strictEqual(result.original_filename, 'photo.jpg')

    // Verify it's gone from database
    const uploads = await getUploads(ctx, {id: doc.current!.id})
    assert.strictEqual(uploads.length, 0)
  })
})
