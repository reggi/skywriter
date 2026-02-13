import {describe, it, before, after, afterEach} from 'node:test'
import assert from 'node:assert'
import {createTestContext} from '../helpers/db.ts'
import {upsert} from '../../src/operations/upsert.ts'
import {getUploads} from '../../src/operations/getUploads.ts'
import {createTestUpload, cleanupTestUploads} from '../helpers/uploads.ts'
import type {PoolClient} from 'pg'
import type {DocumentId} from '../../src/operations/types.ts'

describe('getUploads operation', () => {
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

  it('should return empty array for document with no uploads', async () => {
    const doc = await upsert(ctx, {
      path: `/test-no-uploads-${testId}`,
      title: 'Test Document',
      content: 'Content',
      published: true,
    })
    createdDocumentIds.push(doc.current!.id)

    const uploads = await getUploads(ctx, {id: doc.current!.id})

    assert.strictEqual(uploads.length, 0)
  })

  it('should return empty array for non-existent document', async () => {
    const uploads = await getUploads(ctx, {id: 999999 as DocumentId})

    assert.strictEqual(uploads.length, 0)
  })

  it('should return all uploads for a document', async () => {
    const doc = await upsert(ctx, {
      path: `/test-with-uploads-${testId}`,
      title: 'Test Document',
      content: 'Content',
      published: true,
    })
    createdDocumentIds.push(doc.current!.id)

    // Add some uploads
    const upload1 = await createTestUpload(ctx, {id: doc.current!.id}, {filename: 'photo1.jpg'})
    const upload2 = await createTestUpload(ctx, {id: doc.current!.id}, {filename: 'photo2.png'})
    const upload3 = await createTestUpload(ctx, {id: doc.current!.id}, {filename: 'animation.gif'})

    const uploads = await getUploads(ctx, {id: doc.current!.id})

    assert.strictEqual(uploads.length, 3)

    // Should be ordered by created_at DESC (newest first)
    assert.strictEqual(uploads[0].id, upload3.id)
    assert.ok(uploads[0].filename, 'Upload should have a filename')
    assert.ok(uploads[0].original_filename.endsWith('.gif'), 'Original filename should end with .gif')
    assert.strictEqual(uploads[1].id, upload2.id)
    assert.ok(uploads[1].filename, 'Upload should have a filename')
    assert.ok(uploads[1].original_filename.endsWith('.png'), 'Original filename should end with .png')
    assert.strictEqual(uploads[2].id, upload1.id)
    assert.ok(uploads[2].filename, 'Upload should have a filename')
    assert.ok(uploads[2].original_filename.endsWith('.jpg'), 'Original filename should end with .jpg')

    // All uploads should have the correct document_id
    for (const upload of uploads) {
      assert.strictEqual(upload.document_id, doc.current!.id)
      assert.ok(upload.created_at instanceof Date)
    }
  })

  it('should only return uploads for the specified document', async () => {
    const doc1 = await upsert(ctx, {
      path: `/test-doc1-${testId}`,
      title: 'Document 1',
      content: 'Content',
      published: true,
    })
    createdDocumentIds.push(doc1.current!.id)

    const doc2 = await upsert(ctx, {
      path: `/test-doc2-${testId}`,
      title: 'Document 2',
      content: 'Content',
      published: true,
    })
    createdDocumentIds.push(doc2.current!.id)

    // Add uploads to doc1
    await createTestUpload(ctx, {id: doc1.current!.id}, {filename: 'doc1.jpg'})

    // Add uploads to doc2
    await createTestUpload(
      ctx,
      {id: doc2.current!.id},
      {
        filename: `doc2-file-${testId}.png`,
        original_filename: 'doc2.png',
      },
    )

    const uploads1 = await getUploads(ctx, {id: doc1.current!.id})
    const uploads2 = await getUploads(ctx, {id: doc2.current!.id})

    assert.strictEqual(uploads1.length, 1)
    assert.ok(uploads1[0].filename, 'Upload should have a filename')
    assert.strictEqual(uploads1[0].document_id, doc1.current!.id)

    assert.strictEqual(uploads2.length, 1)
    assert.ok(uploads2[0].filename, 'Upload should have a filename')
    assert.strictEqual(uploads2[0].document_id, doc2.current!.id)
  })

  describe('sorting options', () => {
    it('should sort by original_filename ascending', async () => {
      const doc = await upsert(ctx, {
        path: `/test-sort-original-${testId}`,
        title: 'Test Document',
        content: 'Content',
        published: true,
      })
      createdDocumentIds.push(doc.current!.id)

      await createTestUpload(ctx, {id: doc.current!.id}, {filename: 'zebra.jpg'})
      await createTestUpload(ctx, {id: doc.current!.id}, {filename: 'alpha.png'})
      await createTestUpload(ctx, {id: doc.current!.id}, {filename: 'middle.gif'})

      const uploads = await getUploads(ctx, {id: doc.current!.id}, {sortBy: 'original_filename', sortOrder: 'asc'})

      assert.strictEqual(uploads.length, 3)
      // Verify sorting is alphabetical by original_filename
      assert.ok(uploads[0].original_filename <= uploads[1].original_filename, 'Should be sorted ascending')
      assert.ok(uploads[1].original_filename <= uploads[2].original_filename, 'Should be sorted ascending')
    })

    it('should sort by filename descending', async () => {
      const doc = await upsert(ctx, {
        path: `/test-sort-filename-${testId}`,
        title: 'Test Document',
        content: 'Content',
        published: true,
      })
      createdDocumentIds.push(doc.current!.id)

      await createTestUpload(ctx, {id: doc.current!.id}, {filename: 'a.jpg'})
      await createTestUpload(ctx, {id: doc.current!.id}, {filename: 'm.png'})
      await createTestUpload(ctx, {id: doc.current!.id}, {filename: 'z.gif'})

      const uploads = await getUploads(ctx, {id: doc.current!.id}, {sortBy: 'filename', sortOrder: 'desc'})

      assert.strictEqual(uploads.length, 3)
      // Verify sorting is descending by filename
      assert.ok(uploads[0].filename >= uploads[1].filename, 'Should be sorted descending')
      assert.ok(uploads[1].filename >= uploads[2].filename, 'Should be sorted descending')
    })

    it('should sort by created_at ascending', async () => {
      const doc = await upsert(ctx, {
        path: `/test-sort-created-asc-${testId}`,
        title: 'Test Document',
        content: 'Content',
        published: true,
      })
      createdDocumentIds.push(doc.current!.id)

      const upload1 = await createTestUpload(ctx, {id: doc.current!.id}, {filename: 'first.jpg'})
      const upload2 = await createTestUpload(ctx, {id: doc.current!.id}, {filename: 'second.png'})
      const upload3 = await createTestUpload(ctx, {id: doc.current!.id}, {filename: 'third.gif'})

      const uploads = await getUploads(ctx, {id: doc.current!.id}, {sortBy: 'created_at', sortOrder: 'asc'})

      assert.strictEqual(uploads.length, 3)
      assert.strictEqual(uploads[0].id, upload1.id)
      assert.strictEqual(uploads[1].id, upload2.id)
      assert.strictEqual(uploads[2].id, upload3.id)
    })
  })

  describe('pagination options', () => {
    it('should limit results', async () => {
      const doc = await upsert(ctx, {
        path: `/test-limit-${testId}`,
        title: 'Test Document',
        content: 'Content',
        published: true,
      })
      createdDocumentIds.push(doc.current!.id)

      await createTestUpload(ctx, {id: doc.current!.id}, {filename: 'file1.jpg'})
      await createTestUpload(ctx, {id: doc.current!.id}, {filename: 'file2.png'})
      await createTestUpload(ctx, {id: doc.current!.id}, {filename: 'file3.gif'})

      const uploads = await getUploads(ctx, {id: doc.current!.id}, {limit: 2})

      assert.strictEqual(uploads.length, 2)
    })

    it('should apply offset', async () => {
      const doc = await upsert(ctx, {
        path: `/test-offset-${testId}`,
        title: 'Test Document',
        content: 'Content',
        published: true,
      })
      createdDocumentIds.push(doc.current!.id)

      const upload1 = await createTestUpload(ctx, {id: doc.current!.id}, {filename: 'file1.jpg'})
      const upload2 = await createTestUpload(ctx, {id: doc.current!.id}, {filename: 'file2.png'})
      await createTestUpload(ctx, {id: doc.current!.id}, {filename: 'file3.gif'})

      // Default sort is created_at DESC, so newest first
      const uploads = await getUploads(ctx, {id: doc.current!.id}, {offset: 1})

      assert.strictEqual(uploads.length, 2)
      // Should skip the newest (upload3) and return upload2, upload1
      assert.strictEqual(uploads[0].id, upload2.id)
      assert.strictEqual(uploads[1].id, upload1.id)
    })

    it('should apply limit and offset together', async () => {
      const doc = await upsert(ctx, {
        path: `/test-limit-offset-${testId}`,
        title: 'Test Document',
        content: 'Content',
        published: true,
      })
      createdDocumentIds.push(doc.current!.id)

      await createTestUpload(ctx, {id: doc.current!.id}, {filename: 'file1.jpg'})
      const upload2 = await createTestUpload(ctx, {id: doc.current!.id}, {filename: 'file2.png'})
      const upload3 = await createTestUpload(ctx, {id: doc.current!.id}, {filename: 'file3.gif'})
      await createTestUpload(ctx, {id: doc.current!.id}, {filename: 'file4.webp'})

      // Default sort is created_at DESC: upload4, upload3, upload2, upload1
      // With offset 1 and limit 2: upload3, upload2
      const uploads = await getUploads(ctx, {id: doc.current!.id}, {limit: 2, offset: 1})

      assert.strictEqual(uploads.length, 2)
      assert.strictEqual(uploads[0].id, upload3.id)
      assert.strictEqual(uploads[1].id, upload2.id)
    })
  })

  describe('hidden uploads', () => {
    it('should exclude hidden uploads by default', async () => {
      const doc = await upsert(ctx, {
        path: `/test-hidden-exclude-${testId}`,
        title: 'Test Document',
        content: 'Content',
        published: true,
      })
      createdDocumentIds.push(doc.current!.id)

      // Add two uploads with same name - second displaces first (marks it hidden)
      await createTestUpload(ctx, {id: doc.current!.id}, {filename: 'photo.jpg'})
      await createTestUpload(ctx, {id: doc.current!.id}, {filename: 'photo.jpg'})

      // Default: should only return visible uploads
      const uploads = await getUploads(ctx, {id: doc.current!.id})
      assert.strictEqual(uploads.length, 1)
      assert.strictEqual(uploads[0].hidden, false)
    })

    it('should include hidden uploads when includeHidden is true', async () => {
      const doc = await upsert(ctx, {
        path: `/test-hidden-include-${testId}`,
        title: 'Test Document',
        content: 'Content',
        published: true,
      })
      createdDocumentIds.push(doc.current!.id)

      // Add two uploads with same name - second displaces first
      await createTestUpload(ctx, {id: doc.current!.id}, {filename: 'photo.jpg'})
      await createTestUpload(ctx, {id: doc.current!.id}, {filename: 'photo.jpg'})

      // Include hidden: should return both
      const uploads = await getUploads(ctx, {id: doc.current!.id}, {includeHidden: true})
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

    it('should return hidden field on upload objects', async () => {
      const doc = await upsert(ctx, {
        path: `/test-hidden-field-${testId}`,
        title: 'Test Document',
        content: 'Content',
        published: true,
      })
      createdDocumentIds.push(doc.current!.id)

      await createTestUpload(ctx, {id: doc.current!.id}, {filename: 'test.jpg'})

      const uploads = await getUploads(ctx, {id: doc.current!.id})
      assert.strictEqual(uploads.length, 1)
      assert.strictEqual(typeof uploads[0].hidden, 'boolean')
      assert.strictEqual(uploads[0].hidden, false)
    })
  })
})
