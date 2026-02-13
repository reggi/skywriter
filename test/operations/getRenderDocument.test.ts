import {describe, it, before, after, afterEach} from 'node:test'
import assert from 'node:assert'
import {randomUUID} from 'node:crypto'
import {createTestContext} from '../helpers/db.ts'
import {upsert} from '../../src/operations/upsert.ts'
import {getRenderDocument} from '../../src/operations/getRenderDocument.ts'
import {addRedirect} from '../../src/operations/addRedirect.ts'
import {createTestUpload, cleanupTestUploads} from '../helpers/uploads.ts'
import type {PoolClient} from 'pg'

describe('getRenderDocument operation', () => {
  let ctx: PoolClient
  let cleanup: () => Promise<void>
  const createdDocumentIds: number[] = []

  const uniquePath = (base: string) => `${base}-${randomUUID()}`

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

  it('should return document with redirects and uploads by path', async () => {
    const docPath = uniquePath('/tiger')
    const redirectPath = uniquePath('/old-tiger-path')
    // Create a document
    const tiger = await upsert(ctx, {
      path: docPath,
      title: 'Tigers',
      content: 'Tigers are big cats...',
      draft: false,
      published: false,
    })

    createdDocumentIds.push(tiger.current!.id)

    // Add a redirect
    await addRedirect(ctx, tiger, {path: redirectPath})

    // Add an upload
    await createTestUpload(ctx, tiger, {filename: 'tiger.jpg'})

    const result = await getRenderDocument(ctx, {path: docPath})

    assert.ok(result, 'Should return a document')
    assert.strictEqual(result.path, docPath)
    assert.strictEqual(result.title, 'Tigers')
    assert.strictEqual(result.content, 'Tigers are big cats...')
    assert.strictEqual(result.published, false)

    // Check redirects
    assert.ok(Array.isArray(result.redirects), 'Should have redirects array')
    assert.strictEqual(result.redirects.length, 1)
    assert.strictEqual(result.redirects[0].path, redirectPath)

    // Check uploads
    assert.ok(Array.isArray(result.uploads), 'Should have uploads array')
    assert.strictEqual(result.uploads.length, 1)
    assert.ok(result.uploads[0].filename, 'Upload should have a filename')
  })

  it('should return document via redirect path', async () => {
    const docPath = uniquePath('/lion')
    const redirectPath = uniquePath('/big-cat')
    const lion = await upsert(ctx, {
      path: docPath,
      title: 'Lions',
      content: 'Lions are social cats',
      published: true,
    })

    createdDocumentIds.push(lion.current!.id)

    // Add a redirect
    await addRedirect(ctx, lion, {path: redirectPath})

    // Query via redirect path
    const result = await getRenderDocument(ctx, redirectPath)

    assert.ok(result, 'Should return a document')
    assert.strictEqual(result.id, lion.current!.id)
    assert.strictEqual(result.path, docPath, 'Should return canonical path')
    assert.strictEqual(result.title, 'Lions')
    assert.strictEqual(result.content, 'Lions are social cats')
  })

  it('should return document by string path', async () => {
    const docPath = uniquePath('/leopard')
    const leopard = await upsert(ctx, {
      path: docPath,
      title: 'Leopards',
      content: 'Leopards are spotted',
      published: true,
    })

    createdDocumentIds.push(leopard.current!.id)

    const result = await getRenderDocument(ctx, docPath)

    assert.ok(result, 'Should return a document')
    assert.strictEqual(result.path, docPath)
    assert.strictEqual(result.title, 'Leopards')
    assert.strictEqual(result.content, 'Leopards are spotted')
  })

  it('should return document with path object', async () => {
    const docPath = uniquePath('/cheetah')
    const cheetah = await upsert(ctx, {
      path: docPath,
      title: 'Cheetahs',
      content: 'Cheetahs are fast',
      published: true,
    })

    createdDocumentIds.push(cheetah.current!.id)

    const result = await getRenderDocument(ctx, {path: docPath})

    assert.ok(result, 'Should return a document')
    assert.strictEqual(result.id, cheetah.current!.id)
    assert.strictEqual(result.path, docPath)
    assert.strictEqual(result.title, 'Cheetahs')
  })

  it('should return document by id', async () => {
    const puma = await upsert(ctx, {
      path: '/puma',
      title: 'Pumas',
      content: 'Pumas are mountain lions',
      published: true,
    })

    createdDocumentIds.push(puma.current!.id)

    const result = await getRenderDocument(ctx, {id: puma.current!.id})

    assert.ok(result, 'Should return a document')
    assert.strictEqual(result.id, puma.current!.id)
    assert.strictEqual(result.path, '/puma')
    assert.strictEqual(result.title, 'Pumas')
    assert.strictEqual(result.content, 'Pumas are mountain lions')
  })

  it('should return document by numeric id', async () => {
    const lynx = await upsert(ctx, {
      path: '/lynx-id',
      title: 'Lynx',
      content: 'Lynx are tufted-ear cats',
      published: true,
    })

    createdDocumentIds.push(lynx.current!.id)

    const result = await getRenderDocument(ctx, lynx.current!.id)

    assert.ok(result, 'Should return a document')
    assert.strictEqual(result.id, lynx.current!.id)
    assert.strictEqual(result.title, 'Lynx')
  })

  it('should prioritize draft version over current version', async () => {
    // Create document with current version
    const jaguar = await upsert(ctx, {
      path: '/jaguar',
      title: 'Jaguars',
      content: 'Jaguars are powerful',
      draft: false,
      published: true,
    })

    createdDocumentIds.push(jaguar.current!.id)

    // Create draft version with different content
    await upsert(ctx, {
      path: '/jaguar',
      title: 'Jaguars (Draft)',
      content: 'Jaguars are powerful swimmers',
      draft: true,
    })

    const result = await getRenderDocument(ctx, '/jaguar', {draft: true})

    assert.ok(result, 'Should return a document')
    assert.strictEqual(result.title, 'Jaguars (Draft)', 'Should return draft title')
    assert.strictEqual(result.content, 'Jaguars are powerful swimmers', 'Should return draft content')
  })

  it('should return current version when no draft exists', async () => {
    const cougar = await upsert(ctx, {
      path: '/cougar',
      title: 'Cougars',
      content: 'Cougars are solitary',
      draft: false,
      published: true,
    })

    createdDocumentIds.push(cougar.current!.id)

    const result = await getRenderDocument(ctx, '/cougar')

    assert.ok(result, 'Should return a document')
    assert.strictEqual(result.title, 'Cougars')
    assert.strictEqual(result.content, 'Cougars are solitary')
  })

  it('should return null for non-existent path', async () => {
    const result = await getRenderDocument(ctx, '/does-not-exist')
    assert.strictEqual(result, null)
  })

  it('should return null for non-existent path with object syntax', async () => {
    const result = await getRenderDocument(ctx, {path: '/does-not-exist-object'})
    assert.strictEqual(result, null)
  })

  it('should return empty arrays for redirects and uploads when none exist', async () => {
    const lynx = await upsert(ctx, {
      path: '/lynx',
      title: 'Lynx',
      content: 'Lynx have tufted ears',
      published: true,
    })

    createdDocumentIds.push(lynx.current!.id)

    const result = await getRenderDocument(ctx, '/lynx')

    assert.ok(result, 'Should return a document')
    assert.ok(Array.isArray(result.redirects), 'Should have redirects array')
    assert.strictEqual(result.redirects.length, 0, 'Should have no redirects')
    assert.ok(Array.isArray(result.uploads), 'Should have uploads array')
    assert.strictEqual(result.uploads.length, 0, 'Should have no uploads')
  })

  it('should return multiple redirects when they exist', async () => {
    const panther = await upsert(ctx, {
      path: '/panther',
      title: 'Panthers',
      content: 'Panthers are melanistic big cats',
      published: true,
    })

    createdDocumentIds.push(panther.current!.id)

    // Add multiple redirects
    await addRedirect(ctx, panther, {path: '/black-panther'})
    await addRedirect(ctx, panther, {path: '/melanistic-leopard'})
    await addRedirect(ctx, panther, {path: '/black-jaguar'})

    const result = await getRenderDocument(ctx, '/panther')

    assert.ok(result, 'Should return a document')
    assert.ok(result.redirects, 'Should have redirects')
    assert.strictEqual(result.redirects.length, 3)
    const redirectPaths = result.redirects.map(r => r.path).sort()
    assert.deepStrictEqual(redirectPaths, ['/black-jaguar', '/black-panther', '/melanistic-leopard'])
  })

  it('should return multiple uploads when they exist', async () => {
    const bobcat = await upsert(ctx, {
      path: '/bobcat',
      title: 'Bobcats',
      content: 'Bobcats are North American wildcats',
      published: true,
    })

    createdDocumentIds.push(bobcat.current!.id)

    // Add multiple uploads
    await createTestUpload(ctx, bobcat, {filename: 'bob1.jpg'})
    await createTestUpload(ctx, bobcat, {filename: 'bob2.png'})
    await createTestUpload(ctx, bobcat, {filename: 'bob3.webp'})

    const result = await getRenderDocument(ctx, '/bobcat')

    assert.ok(result, 'Should return a document')
    assert.ok(result.uploads, 'Should have uploads')
    assert.strictEqual(result.uploads.length, 3)
    // Check that all uploads have filenames with expected extensions
    const uploadExtensions = result.uploads.map(u => u.original_filename.split('.').pop()).sort()
    assert.deepStrictEqual(uploadExtensions, ['jpg', 'png', 'webp'])
  })

  it('should include all document instance fields', async () => {
    const ocelot = await upsert(ctx, {
      path: '/ocelot',
      title: 'Ocelots',
      content: 'Ocelots are small wild cats',
      data: '{"region": "Americas"}',
      style: '.ocelot { color: spotted; }',
      script: 'console.log("ocelot")',
      server: 'export default {}',
      content_type: 'text/html',
      data_type: 'json',
      has_eta: true,
      mime_type: 'text/html',
      extension: 'html',
      published: true,
    })

    createdDocumentIds.push(ocelot.current!.id)

    const result = await getRenderDocument(ctx, '/ocelot')

    assert.ok(result, 'Should return a document')
    assert.strictEqual(result.id, ocelot.current!.id)
    assert.strictEqual(result.path, '/ocelot')
    assert.strictEqual(result.title, 'Ocelots')
    assert.strictEqual(result.content, 'Ocelots are small wild cats')
    assert.strictEqual(result.data, '{"region": "Americas"}')
    assert.strictEqual(result.style, '.ocelot { color: spotted; }')
    assert.strictEqual(result.script, 'console.log("ocelot")')
    assert.strictEqual(result.server, 'export default {}')
    assert.strictEqual(result.content_type, 'text/html')
    assert.strictEqual(result.data_type, 'json')
    assert.strictEqual(result.has_eta, true)
    assert.strictEqual(result.mime_type, 'text/html')
    assert.strictEqual(result.extension, 'html')
    assert.strictEqual(result.published, true)
    assert.ok(result.created_at instanceof Date)
    assert.ok(result.updated_at instanceof Date)
  })

  it('should work with unpublished documents', async () => {
    const caracal = await upsert(ctx, {
      path: '/caracal',
      title: 'Caracals',
      content: 'Caracals have distinctive ear tufts',
      published: false,
    })

    createdDocumentIds.push(caracal.current!.id)

    const result = await getRenderDocument(ctx, '/caracal')

    assert.ok(result, 'Should return a document')
    assert.strictEqual(result.published, false)
    assert.strictEqual(result.title, 'Caracals')
  })

  it('should access via redirect and get canonical document', async () => {
    const serval = await upsert(ctx, {
      path: '/serval',
      title: 'Servals',
      content: 'Servals are slender, medium-sized cats',
      published: true,
    })

    createdDocumentIds.push(serval.current!.id)

    // Add redirect and query via it
    await addRedirect(ctx, serval, {path: '/serval-cat'})
    const result = await getRenderDocument(ctx, '/serval-cat')

    assert.ok(result, 'Should return a document')
    assert.strictEqual(result.id, serval.id)
    assert.strictEqual(result.path, '/serval', 'Should return canonical path')
    assert.strictEqual(result.title, 'Servals')
  })

  it('should handle draft with all content fields', async () => {
    const margay = await upsert(ctx, {
      path: '/margay',
      title: 'Margays (Current)',
      content: 'Margays are tree-dwelling cats',
      published: true,
    })

    createdDocumentIds.push(margay.current!.id)

    // Create draft with different content (upsert with draft:true creates a draft version)
    await upsert(ctx, {
      path: '/margay',
      title: 'Margays (Draft Update)',
      content: 'Margays are excellent climbers',
      data: '{"habitat": "rainforest"}',
      style: '.margay { color: brown; }',
      draft: true,
    })

    const result = await getRenderDocument(ctx, '/margay', {draft: true})

    assert.ok(result, 'Should return a document')
    assert.strictEqual(result.title, 'Margays (Draft Update)', 'Should use draft title')
    assert.strictEqual(result.content, 'Margays are excellent climbers', 'Should use draft content')
    assert.deepStrictEqual(JSON.parse(result.data!), JSON.parse('{"habitat": "rainforest"}'), 'Should use draft data')
    assert.strictEqual(result.style, '.margay { color: brown; }', 'Should use draft style')
  })

  it('should not return unpublished document when published:true filter is used', async () => {
    // Create unpublished document (current version exists, but published: false)
    const kodkod = await upsert(ctx, {
      path: '/kodkod',
      title: 'Kodkods',
      content: 'Kodkods are the smallest cat in the Americas',
      published: false,
    })

    createdDocumentIds.push(kodkod.current!.id)

    assert.ok(kodkod.current, 'Document should have current version')
    assert.strictEqual(kodkod.current.published, false, 'Document should be unpublished')

    // Try to get it with published: true filter
    const result = await getRenderDocument(ctx, '/kodkod', {published: true})

    assert.strictEqual(result, null, 'Should not return unpublished document when published filter is true')
  })

  it('should not return draft-only document when published:true filter is used', async () => {
    // Create draft-only document (no current version, only draft with published: true)
    const oncilla = await upsert(ctx, {
      path: '/oncilla',
      title: 'Oncillas (Draft)',
      content: 'Oncillas are small spotted cats',
      draft: true,
      published: true,
    })

    createdDocumentIds.push(oncilla.draft!.id)

    assert.strictEqual(oncilla.current, undefined, 'Should have no current version')
    assert.ok(oncilla.draft, 'Should have draft version')
    assert.strictEqual(oncilla.draft.published, true, 'Draft should have published: true')

    // Try to get it with published: true filter
    const result = await getRenderDocument(ctx, '/oncilla', {published: true})

    assert.strictEqual(result, null, 'Should not return draft-only document when published filter is true')
  })

  it('should not return published document when published:false filter is used', async () => {
    // Create published document (current version with published: true)
    const rusty = await upsert(ctx, {
      path: '/rusty-spotted-cat',
      title: 'Rusty-spotted Cats',
      content: 'Rusty-spotted cats are one of the smallest wild cats',
      published: true,
    })

    createdDocumentIds.push(rusty.current!.id)

    assert.ok(rusty.current, 'Should have current version')
    assert.strictEqual(rusty.current.published, true, 'Document should be published')

    // Try to get it with published: false filter
    const result = await getRenderDocument(ctx, '/rusty-spotted-cat', {published: false})

    assert.strictEqual(result, null, 'Should not return published document when published filter is false')
  })

  it('should exclude redirects when includeRedirects is false', async () => {
    const serval = await upsert(ctx, {
      path: '/serval',
      title: 'Servals',
      content: 'Servals have long legs',
      published: true,
    })

    createdDocumentIds.push(serval.current!.id)

    // Add a redirect
    await addRedirect(ctx, serval, {path: '/old-serval'})

    const result = await getRenderDocument(ctx, '/serval', {includeRedirects: false})

    assert.ok(result, 'Should return a document')
    assert.strictEqual(result.redirects, undefined, 'Should not include redirects')
    assert.ok(Array.isArray(result.uploads), 'Should still include uploads array')
  })

  it('should exclude uploads when includeUploads is false', async () => {
    const caracal = await upsert(ctx, {
      path: '/caracal',
      title: 'Caracals',
      content: 'Caracals have distinctive ear tufts',
      published: true,
    })

    createdDocumentIds.push(caracal.current!.id)

    // Add an upload
    await createTestUpload(ctx, caracal, {filename: 'caracal.jpg'})

    const result = await getRenderDocument(ctx, '/caracal', {includeUploads: false})

    assert.ok(result, 'Should return a document')
    assert.strictEqual(result.uploads, undefined, 'Should not include uploads')
    assert.ok(Array.isArray(result.redirects), 'Should still include redirects array')
  })

  it('should exclude both redirects and uploads when both options are false', async () => {
    const ocelot = await upsert(ctx, {
      path: '/ocelot',
      title: 'Ocelots',
      content: 'Ocelots have beautiful spotted coats',
      published: true,
    })

    createdDocumentIds.push(ocelot.current!.id)

    // Add both redirect and upload
    await addRedirect(ctx, ocelot, {path: '/old-ocelot'})
    await createTestUpload(ctx, ocelot, {filename: 'ocelot.jpg'})

    const result = await getRenderDocument(ctx, '/ocelot', {
      includeRedirects: false,
      includeUploads: false,
    })

    assert.ok(result, 'Should return a document')
    assert.strictEqual(result.redirects, undefined, 'Should not include redirects')
    assert.strictEqual(result.uploads, undefined, 'Should not include uploads')
  })
})
