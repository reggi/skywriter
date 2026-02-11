import {describe, it} from 'node:test'
import assert from 'node:assert'
import {Hono} from 'hono'
import {withDb} from '../../../src/server/middleware/withDb.ts'
import type {AppContext} from '../../../src/server/utils/types.ts'
import type {PoolClient} from 'pg'

describe('withDb', () => {
  it('should set client in context', async () => {
    const app = new Hono<AppContext>()
    const mockClient = {test: 'mock-client'} as unknown as PoolClient
    let contextClient: PoolClient | undefined

    app.use('/*', withDb(mockClient))
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
    const mockClient = {} as PoolClient
    let nextCalled = false

    app.use('/*', withDb(mockClient))
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
})
