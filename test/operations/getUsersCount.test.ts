import {describe, it, before, after} from 'node:test'
import assert from 'node:assert'
import {createTestContext} from '../helpers/db.ts'
import {getUsersCount} from '../../src/operations/getUsersCount.ts'
import type {PoolClient} from 'pg'

describe('getUsersCount operation', () => {
  let ctx: PoolClient
  let cleanup: () => Promise<void>

  before(async () => {
    const tc = await createTestContext()
    ctx = tc.client
    cleanup = tc.cleanup
  })

  after(async () => {
    await cleanup()
  })

  it('should return the count of users', async () => {
    const result = await getUsersCount(ctx)

    assert.ok(typeof result.count === 'number', 'Count should be a number')
    assert.ok(result.count >= 0, 'Count should be non-negative')
  })

  it('should return count as a number, not a string', async () => {
    const result = await getUsersCount(ctx)

    assert.strictEqual(typeof result.count, 'number')
  })
})
