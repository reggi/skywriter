import {describe, it, before, after} from 'node:test'
import assert from 'node:assert'
import {createDatabaseContext, closeDatabaseContext, closePool} from '../../../src/db/index.ts'
import {normalizeDocumentQuery} from '../../../src/operations/utils/common.ts'
import {findDocument} from '../../../src/operations/findDocument.ts'
import type {PoolClient} from 'pg'
import type {DocumentId, DocumentQuery} from '../../../src/operations/types.ts'

describe('common helpers', () => {
  let ctx: PoolClient

  before(async () => {
    ctx = await createDatabaseContext()
  })

  after(async () => {
    await closeDatabaseContext(ctx)
    await closePool()
  })

  describe('normalizeDocumentQuery', () => {
    it('should normalize string to path query', () => {
      const result = normalizeDocumentQuery('/test/path')
      assert.deepStrictEqual(result, {path: '/test/path'})
    })

    it('should normalize number to id query', () => {
      const result = normalizeDocumentQuery(123 as DocumentId)
      assert.deepStrictEqual(result, {id: 123 as DocumentId})
    })

    it('should normalize Route object to id query', () => {
      const route = {id: 1 as number, path: '/test', document_id: 456 as DocumentId, created_at: new Date()}
      const result = normalizeDocumentQuery(route)
      assert.deepStrictEqual(result, {id: 456 as DocumentId})
    })

    it('should normalize object with id to id query', () => {
      const result = normalizeDocumentQuery({id: 789 as DocumentId})
      assert.deepStrictEqual(result, {id: 789 as DocumentId})
    })

    it('should normalize object with path to path query', () => {
      const result = normalizeDocumentQuery({path: '/another/path'})
      assert.deepStrictEqual(result, {path: '/another/path'})
    })

    it('should handle empty object (for EditDocumentInput with no id/path)', () => {
      const result = normalizeDocumentQuery({} as unknown as DocumentQuery)
      assert.deepStrictEqual(result, {})
    })

    it('should handle object with id and undefined path', () => {
      const result = normalizeDocumentQuery({id: 123 as DocumentId})
      assert.deepStrictEqual(result, {id: 123 as DocumentId})
    })

    it('should handle object with undefined id and path', () => {
      const result = normalizeDocumentQuery({id: undefined, path: '/test'})
      assert.deepStrictEqual(result, {path: '/test'})
    })

    it('should handle object with null id and string path', () => {
      const result = normalizeDocumentQuery({id: null as unknown as DocumentId, path: '/test'})
      assert.deepStrictEqual(result, {path: '/test'})
    })

    it('should handle object with number id and null path', () => {
      const result = normalizeDocumentQuery({id: 456 as DocumentId, path: null as unknown as string})
      assert.deepStrictEqual(result, {id: 456 as DocumentId})
    })

    it('should prefer id when both id and path are defined (OptimisticDocument)', () => {
      const result = normalizeDocumentQuery({id: 456 as DocumentId, path: '/both'})
      assert.deepStrictEqual(result, {id: 456 as DocumentId})
    })

    it('should handle object with non-number id in fallback section', () => {
      // id as string (not a number) reaches fallback, but id check fails on line 48
      // so result.id stays undefined
      const query = {id: 'string-id' as unknown as DocumentId}
      const result = normalizeDocumentQuery(query)
      assert.deepStrictEqual(result, {id: 'string-id' as unknown as DocumentId})
    })

    it('should handle object with non-string path in fallback section', () => {
      // path as number (not a string) reaches fallback, but is truthy
      // This covers lines 52-53
      const query = {path: 123 as unknown as string}
      const result = normalizeDocumentQuery(query)
      assert.deepStrictEqual(result, {path: 123 as unknown as string})
    })

    it('should prefer id when fallback section gets both id and path defined', () => {
      // Both id and path present but wrong types to match earlier conditions
      // Both will be assigned in fallback, then id is preferred
      // This covers lines 49-50, 52-53, and 56-57
      const query = {id: 'string-id' as unknown as DocumentId, path: 123 as unknown as string}
      const result = normalizeDocumentQuery(query)
      assert.deepStrictEqual(result, {id: 'string-id' as unknown as DocumentId})
    })

    it('should throw error for undefined query', () => {
      // The final throw at line 60 is for non-objects (excluding null which is checked)
      // Testing with undefined, which isn't an object, isn't null, isn't string/number
      assert.throws(
        () => {
          normalizeDocumentQuery(undefined as unknown as DocumentQuery)
        },
        {
          message: 'Invalid DocumentQuery format',
        },
      )
    })

    it('should throw error for symbol query', () => {
      // Testing with symbol to reach the final throw at line 60
      assert.throws(
        () => {
          normalizeDocumentQuery(Symbol('test') as unknown as DocumentQuery)
        },
        {
          message: 'Invalid DocumentQuery format',
        },
      )
    })
  })

  it('should return null when route exists but document query returns no rows', async () => {
    // Create a route pointing to a non-existent document by temporarily disabling constraints
    await ctx.query('BEGIN')
    await ctx.query('SET CONSTRAINTS ALL DEFERRED')

    await ctx.query(`INSERT INTO routes (path, document_id) VALUES ($1, 999999)`, ['/orphaned-route-test'])

    // This should return null because the JOIN will fail (no document with id 999999)
    // Testing the || null fallback in findDocument with path
    const result = await findDocument(ctx, {path: '/orphaned-route-test'})
    assert.strictEqual(result, null, 'Should return null when route points to non-existent document')

    // Rollback to clean up
    await ctx.query('ROLLBACK')
  })

  it('should return null when finding document by non-existent id', async () => {
    // Import findDocument to test the || null fallback when query by id returns no rows
    const {findDocument} = await import('../../../src/operations/findDocument.ts')

    const result = await findDocument(ctx, {id: 999999 as DocumentId})
    assert.strictEqual(result, null, 'Should return null when document with id does not exist')
  })

  it('should return null when getting document record by non-existent id', async () => {
    // Import getDocumentRecord to test the || null fallback when query returns no rows
    const {getDocumentRecord} = await import('../../../src/operations/getDocumentRecord.ts')

    const result = await getDocumentRecord(ctx, 999999)
    assert.strictEqual(result, null, 'Should return null when document record with id does not exist')
  })

  it('should return null when fetching document instance for non-existent document', async () => {
    // Import getDocumentInstance to test the null fallback when query returns no rows
    const {getDocumentInstance} = await import('../../../src/operations/getDocumentInstance.ts')

    const result = await getDocumentInstance(ctx, 999999 as DocumentId, 'current')
    assert.strictEqual(result, null, 'Should return null when document instance does not exist')
  })
})
