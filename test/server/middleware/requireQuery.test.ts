import {describe, it} from 'node:test'
import assert from 'node:assert'
import {Hono} from 'hono'
import {requireQuery} from '../../../src/server/middleware/requireQuery.ts'

describe('requireQuery', () => {
  describe('when query parameter is not present', () => {
    it('should call next() and skip handlers', async () => {
      const app = new Hono()
      let handlerCalled = false

      app.get(
        '/*',
        requireQuery('action', async c => {
          handlerCalled = true
          return c.text('Handler called')
        }),
        c => {
          return c.text('Default response')
        },
      )

      const res = await app.request('/test')
      assert.strictEqual(res.status, 200)
      assert.strictEqual(await res.text(), 'Default response')
      assert.strictEqual(handlerCalled, false)
    })
  })

  describe('when query parameter is present', () => {
    it('should execute the handler', async () => {
      const app = new Hono()

      app.get(
        '/*',
        requireQuery('action', async c => {
          return c.text('Handler executed')
        }),
        c => {
          return c.text('Default response')
        },
      )

      const res = await app.request('/test?action')
      assert.strictEqual(res.status, 200)
      assert.strictEqual(await res.text(), 'Handler executed')
    })

    it('should execute the handler when query has a value', async () => {
      const app = new Hono()

      app.get(
        '/*',
        requireQuery('mode', async c => {
          return c.text(`Mode: ${c.req.query('mode')}`)
        }),
        c => {
          return c.text('Default')
        },
      )

      const res = await app.request('/test?mode=edit')
      assert.strictEqual(res.status, 200)
      assert.strictEqual(await res.text(), 'Mode: edit')
    })
  })

  describe('with multiple handlers', () => {
    it('should execute first handler that returns a response', async () => {
      const app = new Hono()
      const calls: string[] = []

      app.get(
        '/*',
        requireQuery('process', async c => {
          calls.push('handler')
          return c.text('Done')
        }),
        c => {
          return c.text('Default')
        },
      )

      const res = await app.request('/test?process')
      assert.strictEqual(res.status, 200)
      assert.strictEqual(await res.text(), 'Done')
      assert.deepStrictEqual(calls, ['handler'])
    })

    it('should call next route handler if handler calls next without returning', async () => {
      const app = new Hono()

      app.get(
        '/*',
        requireQuery('check', async (c, next) => {
          // Call next without returning a response
          await next()
        }),
        c => {
          return c.text('Fallback reached')
        },
      )

      const res = await app.request('/test?check')
      assert.strictEqual(res.status, 200)
      assert.strictEqual(await res.text(), 'Fallback reached')
    })

    it('should chain multiple handlers when second handler returns response', async () => {
      const app = new Hono()
      const calls: string[] = []

      app.get(
        '/*',
        requireQuery(
          'process',
          async (c, next) => {
            calls.push('handler1')
            return next()
          },
          async c => {
            calls.push('handler2')
            return c.text('Chained result')
          },
        ),
        c => {
          return c.text('Default')
        },
      )

      const res = await app.request('/test?process=true')
      assert.strictEqual(res.status, 200)
      assert.strictEqual(await res.text(), 'Chained result')
      assert.deepStrictEqual(calls, ['handler1', 'handler2'])
    })

    it('should pass through to default when handler calls next', async () => {
      const app = new Hono()
      const calls: string[] = []

      app.get(
        '/*',
        requireQuery('flow', async (c, next) => {
          calls.push('first')
          return next()
        }),
        c => {
          calls.push('default')
          return c.text('Default handler')
        },
      )

      const res = await app.request('/test?flow')
      assert.strictEqual(res.status, 200)
      assert.strictEqual(await res.text(), 'Default handler')
      assert.deepStrictEqual(calls, ['first', 'default'])
    })
  })
})
