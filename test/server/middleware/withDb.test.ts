import {describe, it} from 'node:test'
import assert from 'node:assert'
import {Hono} from 'hono'
import {withDb} from '../../../src/server/middleware/withDb.ts'
import type {AppContext} from '../../../src/server/utils/types.ts'
import type {Pool, PoolClient} from 'pg'

function createMockPool(mockClient: PoolClient): Pool {
  return {
    connect: async () => mockClient,
  } as unknown as Pool
}

describe('withDb', () => {
  it('should set client in context', async () => {
    const app = new Hono<AppContext>()
    const mockClient = {test: 'mock-client', release: () => {}} as unknown as PoolClient
    const mockPool = createMockPool(mockClient)
    let contextClient: PoolClient | undefined

    app.use('/*', withDb(mockPool))
    app.get('/*', c => {
      contextClient = c.get('client')
      return c.text('OK')
    })

    const res = await app.request('/test')
    assert.strictEqual(res.status, 200)
    assert.strictEqual(contextClient, mockClient)
  })

  it('should call next middleware', async () => {
    const app = new Hono<AppContext>()
    const mockClient = {release: () => {}} as unknown as PoolClient
    const mockPool = createMockPool(mockClient)
    let nextCalled = false

    app.use('/*', withDb(mockPool))
    app.use('/*', async (c, next) => {
      nextCalled = true
      return next()
    })
    app.get('/*', c => {
      return c.text('OK')
    })

    await app.request('/test')
    assert.strictEqual(nextCalled, true)
  })

  it('should release client after request', async () => {
    const app = new Hono<AppContext>()
    let released = false
    const mockClient = {release: () => { released = true }} as unknown as PoolClient
    const mockPool = createMockPool(mockClient)

    app.use('/*', withDb(mockPool))
    app.get('/*', c => {
      return c.text('OK')
    })

    await app.request('/test')
    assert.strictEqual(released, true)
  })

  it('should release client even on error', async () => {
    const app = new Hono<AppContext>()
    let released = false
    const mockClient = {release: () => { released = true }} as unknown as PoolClient
    const mockPool = createMockPool(mockClient)

    app.use('/*', withDb(mockPool))
    app.get('/*', () => {
      throw new Error('test error')
    })

    app.onError((_err, c) => c.text('error', 500))
    await app.request('/test')
    assert.strictEqual(released, true)
  })
})
