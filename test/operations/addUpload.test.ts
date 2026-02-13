import {describe, it, before, after, afterEach} from 'node:test'
import assert from 'node:assert'
import {mkdtemp, rm, readFile, readdir} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createTestContext} from '../helpers/db.ts'
import {upsert} from '../../src/operations/upsert.ts'
import {addUpload} from '../../src/operations/addUpload.ts'
import {getUploads} from '../../src/operations/getUploads.ts'
import type {PoolClient} from 'pg'
import type {DocumentId} from '../../src/operations/types.ts'

describe('addUpload operation', () => {
  let ctx: PoolClient
  let cleanup: () => Promise<void>
  let uploadsPath: string
  const createdDocumentIds: number[] = []
  const testId = Date.now()

  before(async () => {
    const tc = await createTestContext()
    ctx = tc.client
    cleanup = tc.cleanup
    uploadsPath = await mkdtemp(join(tmpdir(), 'skywriter-test-uploads-'))
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
    // Clean up temp directory
    await rm(uploadsPath, {recursive: true, force: true})
  })

  it('should add an upload with File input', async () => {
    const doc = await upsert(ctx, {
      path: `/test-add-upload-file-${testId}`,
      title: 'Test Document',
      content: 'Content',
      published: true,
    })
    createdDocumentIds.push(doc.current!.id)

    const fileContent = Buffer.from('test file content')
    const file = new File([fileContent], 'photo.jpg', {type: 'image/jpeg'})

    const upload = await addUpload(ctx, {id: doc.current!.id}, uploadsPath, file)

    assert.ok(upload.id > 0)
    assert.ok(upload.filename.endsWith('.jpg'))
    assert.ok(upload.filename.includes('-')) // Has timestamp-random pattern
    assert.strictEqual(upload.original_filename, 'photo.jpg')
    assert.strictEqual(upload.document_id, doc.current!.id)
    assert.ok(upload.created_at instanceof Date)
    assert.ok(upload.filePath.startsWith(uploadsPath))

    // Verify file was written
    const writtenContent = await readFile(upload.filePath)
    assert.deepStrictEqual(writtenContent, fileContent)
  })

  it('should add an upload with Buffer input', async () => {
    const doc = await upsert(ctx, {
      path: `/test-add-upload-buffer-${testId}`,
      title: 'Test Document',
      content: 'Content',
      published: true,
    })
    createdDocumentIds.push(doc.current!.id)

    const bufferContent = Buffer.from('buffer content here')

    const upload = await addUpload(ctx, {id: doc.current!.id}, uploadsPath, {
      data: bufferContent,
      filename: 'document.pdf',
    })

    assert.ok(upload.id > 0)
    assert.ok(upload.filename.endsWith('.pdf'))
    assert.strictEqual(upload.original_filename, 'document.pdf')
    assert.strictEqual(upload.document_id, doc.current!.id)

    // Verify file was written
    const writtenContent = await readFile(upload.filePath)
    assert.deepStrictEqual(writtenContent, bufferContent)
  })

  it('should throw error when document does not exist', async () => {
    const file = new File([Buffer.from('test')], 'test.jpg')

    await assert.rejects(
      async () => {
        await addUpload(ctx, {id: 999999 as DocumentId}, uploadsPath, file)
      },
      {
        message: 'Document does not exist',
      },
    )
  })

  it('should generate unique original_filename when collision exists', async () => {
    const doc = await upsert(ctx, {
      path: `/test-unique-filename-${testId}`,
      title: 'Test Document',
      content: 'Content',
      published: true,
    })
    createdDocumentIds.push(doc.current!.id)

    const file1 = new File([Buffer.from('content1')], 'photo.jpg')
    const file2 = new File([Buffer.from('content2')], 'photo.jpg')
    const file3 = new File([Buffer.from('content3')], 'photo.jpg')

    const upload1 = await addUpload(ctx, {id: doc.current!.id}, uploadsPath, file1)
    const upload2 = await addUpload(ctx, {id: doc.current!.id}, uploadsPath, file2)
    const upload3 = await addUpload(ctx, {id: doc.current!.id}, uploadsPath, file3)

    // New uploads always get the original filename; the previous visible upload is displaced and renamed
    assert.strictEqual(upload1.original_filename, 'photo.jpg')
    assert.strictEqual(upload2.original_filename, 'photo.jpg')
    assert.strictEqual(upload3.original_filename, 'photo.jpg')

    // Verify all files exist
    const files = await readdir(uploadsPath)
    assert.ok(files.length >= 3)
  })

  it('should mark displaced uploads as hidden when collision occurs', async () => {
    const doc = await upsert(ctx, {
      path: `/test-hidden-displacement-${testId}`,
      title: 'Test Document',
      content: 'Content',
      published: true,
    })
    createdDocumentIds.push(doc.current!.id)

    const file1 = new File([Buffer.from('content1')], 'photo.jpg')
    const file2 = new File([Buffer.from('content2')], 'photo.jpg')

    await addUpload(ctx, {id: doc.current!.id}, uploadsPath, file1)
    const upload2 = await addUpload(ctx, {id: doc.current!.id}, uploadsPath, file2)

    // The latest upload should be visible
    assert.strictEqual(upload2.hidden, false)
    assert.strictEqual(upload2.original_filename, 'photo.jpg')

    // Check all uploads including hidden
    const allUploads = await getUploads(ctx, {id: doc.current!.id as DocumentId}, {includeHidden: true})
    assert.strictEqual(allUploads.length, 2)
    assert.ok(
      allUploads.some(u => u.hidden === true),
      'Displaced upload should be hidden',
    )
    assert.ok(
      allUploads.some(u => u.hidden === false),
      'New upload should be visible',
    )

    // Only one visible upload by default
    const visibleUploads = await getUploads(ctx, {id: doc.current!.id as DocumentId})
    assert.strictEqual(visibleUploads.length, 1)
    assert.strictEqual(visibleUploads[0].original_filename, 'photo.jpg')
  })

  it('should add multiple uploads to the same document', async () => {
    const doc = await upsert(ctx, {
      path: `/test-multiple-uploads-${testId}`,
      title: 'Test Document',
      content: 'Content',
      published: true,
    })
    createdDocumentIds.push(doc.current!.id)

    const file1 = new File([Buffer.from('content1')], 'photo1.jpg')
    const file2 = new File([Buffer.from('content2')], 'photo2.png')

    const upload1 = await addUpload(ctx, {id: doc.current!.id}, uploadsPath, file1)
    const upload2 = await addUpload(ctx, {id: doc.current!.id}, uploadsPath, file2)

    assert.ok(upload1.id !== upload2.id)
    assert.strictEqual(upload1.document_id, doc.current!.id)
    assert.strictEqual(upload2.document_id, doc.current!.id)
    assert.strictEqual(upload1.original_filename, 'photo1.jpg')
    assert.strictEqual(upload2.original_filename, 'photo2.png')
  })

  it('should handle uploads with special characters in filenames', async () => {
    const doc = await upsert(ctx, {
      path: `/test-special-chars-${testId}`,
      title: 'Test Document',
      content: 'Content',
      published: true,
    })
    createdDocumentIds.push(doc.current!.id)

    const file = new File([Buffer.from('content')], 'My Photo (2023).jpg')

    const upload = await addUpload(ctx, {id: doc.current!.id}, uploadsPath, file)

    assert.strictEqual(upload.original_filename, 'My Photo (2023).jpg')
  })

  it('should create uploads directory if it does not exist', async () => {
    const doc = await upsert(ctx, {
      path: `/test-create-dir-${testId}`,
      title: 'Test Document',
      content: 'Content',
      published: true,
    })
    createdDocumentIds.push(doc.current!.id)

    const nestedPath = join(uploadsPath, 'nested', 'dir', 'uploads')
    const file = new File([Buffer.from('content')], 'test.jpg')

    const upload = await addUpload(ctx, {id: doc.current!.id}, nestedPath, file)

    assert.ok(upload.filePath.startsWith(nestedPath))
    const writtenContent = await readFile(upload.filePath)
    assert.deepStrictEqual(writtenContent, Buffer.from('content'))
  })
})
