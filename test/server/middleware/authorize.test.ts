import {describe, it} from 'node:test'
import assert from 'node:assert'
import {Hono} from 'hono'
import {authorize} from '../../../src/server/middleware/authorize.ts'
import type {AppContext} from '../../../src/server/utils/types.ts'

describe('authorize', () => {
  describe('when authenticated', () => {
    it('should call next() and allow request to continue', async () => {
      const app = new Hono<AppContext>()

      app.use('/*', (c, next) => {
        c.set('isAuthenticated', true)
        return next()
      })

      app.get('/*', authorize('Test Realm'), c => {
        return c.text('OK')
      })

      const res = await app.request('/test')
      assert.strictEqual(res.status, 200)
      assert.strictEqual(await res.text(), 'OK')
    })
  })

  describe('when not authenticated', () => {
    it('should return 401 with WWW-Authenticate header for GET requests', async () => {
      const app = new Hono<AppContext>()

      app.use('/*', (c, next) => {
        c.set('isAuthenticated', false)
        return next()
      })

      app.get('/*', authorize('Test Realm'), c => {
        return c.text('OK')
      })

      const res = await app.request('/test', {method: 'GET'})
      assert.strictEqual(res.status, 401)
      assert.strictEqual(res.headers.get('WWW-Authenticate'), 'Basic realm="Test Realm"')
      assert.strictEqual(await res.text(), '')
    })

    it('should return 401 JSON error for POST requests', async () => {
      const app = new Hono<AppContext>()

      app.use('/*', (c, next) => {
        c.set('isAuthenticated', false)
        return next()
      })

      app.post('/*', authorize('Secure Area'), c => {
        return c.text('OK')
      })

      const res = await app.request('/test', {method: 'POST'})
      assert.strictEqual(res.status, 401)
      assert.strictEqual(res.headers.get('WWW-Authenticate'), 'Basic realm="Secure Area"')
      const body = await res.json()
      assert.deepStrictEqual(body, {error: 'Authentication required'})
    })

    it('should return 401 JSON error for DELETE requests', async () => {
      const app = new Hono<AppContext>()

      app.use('/*', (c, next) => {
        c.set('isAuthenticated', false)
        return next()
      })

      app.delete('/*', authorize('Protected'), c => {
        return c.text('OK')
      })

      const res = await app.request('/test', {method: 'DELETE'})
      assert.strictEqual(res.status, 401)
      const body = await res.json()
      assert.deepStrictEqual(body, {error: 'Authentication required'})
    })
  })
})
