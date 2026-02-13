import {describe, it, before, after} from 'node:test'
import assert from 'node:assert'
import {createDatabaseContext, closeDatabaseContext, closePool} from '../../src/db/index.ts'
import {createApp} from '../../src/server/index.ts'
import {findDocument} from '../../src/operations/findDocument.ts'
import type {PoolClient} from 'pg'

describe('seedIfEmpty via createApp', () => {
  let client: PoolClient
  const createdDocumentIds: number[] = []

  before(async () => {
    client = await createDatabaseContext()
  })

  after(async () => {
    for (const docId of createdDocumentIds) {
      try {
        await client.query(`DELETE FROM documents WHERE id = $1`, [docId])
        await client.query(
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
    await closeDatabaseContext(client)
    await closePool()
  })

  it('should serve the seeded intro document at / on first server start', async () => {
    const countResult = await client.query<{count: string}>('SELECT COUNT(*) as count FROM documents')
    const countBefore = parseInt(countResult.rows[0].count, 10)

    if (countBefore > 0) {
      // DB already has documents — seedIfEmpty won't run, so just verify createApp works
      const app = await createApp(client, {seed: true})
      const res = await app.request('/')
      assert.strictEqual(res.status, 200)
      return
    }

    // Empty DB: createApp should trigger seedIfEmpty and seed the intro page
    const app = await createApp(client, {seed: true})

    // Verify the document was created in the database
    const doc = await findDocument(client, {path: '/'})
    assert.ok(doc, 'Seed document should exist at /')
    assert.strictEqual(doc.route.path, '/', 'Document path should be /')
    assert.strictEqual(doc.published, true, 'Document should be published')
    createdDocumentIds.push(doc.id)

    // Verify the seeded page is served over HTTP
    const res = await app.request('/')
    assert.strictEqual(res.status, 200, 'GET / should return 200')

    const html = await res.text()
    assert.ok(html.includes('Skywriter'), 'Response should contain Skywriter')
    assert.ok(html.includes('skyCanvas'), 'Response should contain the sky animation canvas')
  })

  it('should not seed when seed option is false', async () => {
    const countResult = await client.query<{count: string}>('SELECT COUNT(*) as count FROM documents')
    const countBefore = parseInt(countResult.rows[0].count, 10)

    // Create app with seed disabled
    const app = await createApp(client, {seed: false})
    assert.ok(app, 'App should be created')

    const countAfter = await client.query<{count: string}>('SELECT COUNT(*) as count FROM documents')
    assert.strictEqual(
      parseInt(countAfter.rows[0].count, 10),
      countBefore,
      'Document count should not change when seed is false',
    )
  })
})
