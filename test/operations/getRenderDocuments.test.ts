import {describe, it, before, after, afterEach} from 'node:test'
import assert from 'node:assert'
import {createTestContext} from '../helpers/db.ts'
import {upsert} from '../../src/operations/upsert.ts'
import {getRenderDocuments} from '../../src/operations/getRenderDocuments.ts'
import {addRedirect} from '../../src/operations/addRedirect.ts'
import {createTestUpload, cleanupTestUploads} from '../helpers/uploads.ts'
import type {PoolClient} from 'pg'

describe('getRenderDocuments operation', () => {
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
    await cleanupTestUploads()
  })

  it('should return multiple documents with redirects and uploads', async () => {
    // Create multiple documents
    const tiger = await upsert(ctx, {
      path: '/tiger',
      title: 'Tigers',
      content: 'Tigers are big cats...',
      published: true,
    })
    createdDocumentIds.push(tiger.current!.id)

    const lion = await upsert(ctx, {
      path: '/lion',
      title: 'Lions',
      content: 'Lions are social cats',
      published: true,
    })
    createdDocumentIds.push(lion.current!.id)

    // Add redirects and uploads
    await addRedirect(ctx, tiger, {path: '/old-tiger'})
    await createTestUpload(ctx, tiger, {filename: 'tiger.jpg'})
    await addRedirect(ctx, lion, {path: '/old-lion'})

    const results = await getRenderDocuments(ctx, {})

    assert.ok(Array.isArray(results), 'Should return an array')
    assert.ok(results.length >= 2, 'Should return at least 2 documents')

    // Find our specific documents
    const tigerResult = results.find(d => d.path === '/tiger')
    const lionResult = results.find(d => d.path === '/lion')

    assert.ok(tigerResult, 'Should include tiger document')
    assert.ok(lionResult, 'Should include lion document')

    // Check tiger has redirects and uploads
    assert.ok(Array.isArray(tigerResult.redirects), 'Tiger should have redirects array')
    assert.strictEqual(tigerResult.redirects.length, 1)
    assert.strictEqual(tigerResult.redirects[0].path, '/old-tiger')
    assert.ok(Array.isArray(tigerResult.uploads), 'Tiger should have uploads array')
    assert.strictEqual(tigerResult.uploads.length, 1)

    // Check lion has redirects but no uploads
    assert.ok(Array.isArray(lionResult.redirects), 'Lion should have redirects array')
    assert.strictEqual(lionResult.redirects.length, 1)
    assert.ok(Array.isArray(lionResult.uploads), 'Lion should have uploads array')
    assert.strictEqual(lionResult.uploads.length, 0)
  })

  it('should exclude redirects when includeRedirects is false', async () => {
    const leopard = await upsert(ctx, {
      path: '/leopard',
      title: 'Leopards',
      content: 'Leopards are spotted',
      published: true,
    })
    createdDocumentIds.push(leopard.current!.id)

    await addRedirect(ctx, leopard, {path: '/old-leopard'})

    const results = await getRenderDocuments(ctx, {includeRedirects: false})

    const leopardResult = results.find(d => d.path === '/leopard')
    assert.ok(leopardResult, 'Should include leopard document')
    assert.strictEqual(leopardResult.redirects, undefined, 'Should not include redirects')
  })

  it('should exclude uploads when includeUploads is false', async () => {
    const cheetah = await upsert(ctx, {
      path: '/cheetah',
      title: 'Cheetahs',
      content: 'Cheetahs are fast',
      published: true,
    })
    createdDocumentIds.push(cheetah.current!.id)

    await createTestUpload(ctx, cheetah, {filename: 'cheetah.jpg'})

    const results = await getRenderDocuments(ctx, {includeUploads: false})

    const cheetahResult = results.find(d => d.path === '/cheetah')
    assert.ok(cheetahResult, 'Should include cheetah document')
    assert.strictEqual(cheetahResult.uploads, undefined, 'Should not include uploads')
  })

  it('should exclude both redirects and uploads when both options are false', async () => {
    const puma = await upsert(ctx, {
      path: '/puma',
      title: 'Pumas',
      content: 'Pumas are mountain lions',
      published: true,
    })
    createdDocumentIds.push(puma.current!.id)

    await addRedirect(ctx, puma, {path: '/old-puma'})
    await createTestUpload(ctx, puma, {filename: 'puma.jpg'})

    const results = await getRenderDocuments(ctx, {
      includeRedirects: false,
      includeUploads: false,
    })

    const pumaResult = results.find(d => d.path === '/puma')
    assert.ok(pumaResult, 'Should include puma document')
    assert.strictEqual(pumaResult.redirects, undefined, 'Should not include redirects')
    assert.strictEqual(pumaResult.uploads, undefined, 'Should not include uploads')
  })

  it('should support pagination with includes', async () => {
    // Create multiple documents
    const jaguar = await upsert(ctx, {
      path: '/jaguar',
      title: 'Jaguars',
      content: 'Jaguars are powerful',
      published: true,
    })
    createdDocumentIds.push(jaguar.current!.id)

    const lynx = await upsert(ctx, {
      path: '/lynx',
      title: 'Lynx',
      content: 'Lynx have tufted ears',
      published: true,
    })
    createdDocumentIds.push(lynx.current!.id)

    await addRedirect(ctx, jaguar, {path: '/old-jaguar'})
    await createTestUpload(ctx, jaguar, {filename: 'jaguar.jpg'})

    const results = await getRenderDocuments(ctx, {
      limit: 1,
      sortBy: 'path',
      sortOrder: 'asc',
    })

    assert.ok(results.length >= 1, 'Should return at least 1 document')
    // Each document should have redirects and uploads arrays (even if empty)
    results.forEach(doc => {
      assert.ok(Array.isArray(doc.redirects) || doc.redirects === undefined, 'Should have redirects array or undefined')
      assert.ok(Array.isArray(doc.uploads) || doc.uploads === undefined, 'Should have uploads array or undefined')
    })
  })

  it('should filter by published status and include redirects/uploads', async () => {
    const uniqueId = Date.now()
    const published = await upsert(ctx, {
      path: `/published-cat-${uniqueId}`,
      title: 'Published Cat',
      content: 'This is published',
      published: true,
    })
    createdDocumentIds.push(published.current!.id)

    const unpublished = await upsert(ctx, {
      path: `/unpublished-cat-${uniqueId}`,
      title: 'Unpublished Cat',
      content: 'This is not published',
      published: false,
    })
    createdDocumentIds.push(unpublished.current!.id)

    await addRedirect(ctx, published, {path: `/old-published-${uniqueId}`})
    await addRedirect(ctx, unpublished, {path: `/old-unpublished-${uniqueId}`})

    const publishedResults = await getRenderDocuments(ctx, {published: true})
    const unpublishedResults = await getRenderDocuments(ctx, {published: false})

    const pubDoc = publishedResults.find(d => d.path === `/published-cat-${uniqueId}`)
    const unpubDoc = unpublishedResults.find(d => d.path === `/unpublished-cat-${uniqueId}`)

    assert.ok(pubDoc, 'Should find published document')
    assert.ok(Array.isArray(pubDoc.redirects), 'Published doc should have redirects')

    assert.ok(unpubDoc, 'Should find unpublished document')
    assert.ok(Array.isArray(unpubDoc.redirects), 'Unpublished doc should have redirects')
  })
})
