import {describe, it} from 'node:test'
import assert from 'node:assert'
import {Hono} from 'hono'
import {csrfProtection} from '../../../src/server/middleware/csrfProtection.ts'
import type {AppContext} from '../../../src/server/utils/types.ts'

describe('csrfProtection', () => {
  describe('safe methods', () => {
    it('should allow GET requests without any origin header', async () => {
      const app = new Hono<AppContext>()
      app.get('/*', csrfProtection(), c => c.text('OK'))

      const res = await app.request('/test', {
        method: 'GET',
        headers: {Cookie: 'session_id=abc123'},
      })
      assert.strictEqual(res.status, 200)
    })

    it('should allow HEAD requests without any origin header', async () => {
      const app = new Hono<AppContext>()
      app.get('/*', csrfProtection(), c => c.text('OK'))

      const res = await app.request('/test', {
        method: 'HEAD',
        headers: {Cookie: 'session_id=abc123'},
      })
      assert.strictEqual(res.status, 200)
    })
  })

  describe('Basic Auth bypass', () => {
    it('should allow POST with Basic Auth even without Origin', async () => {
      const app = new Hono<AppContext>()
      app.post('/*', csrfProtection(), c => c.text('OK'))

      const res = await app.request('/test', {
        method: 'POST',
        headers: {
          Authorization: 'Basic dXNlcjpwYXNz',
          Cookie: 'session_id=abc123',
        },
      })
      assert.strictEqual(res.status, 200)
    })
  })

  describe('no session cookie', () => {
    it('should allow POST without session cookie', async () => {
      const app = new Hono<AppContext>()
      app.post('/*', csrfProtection(), c => c.text('OK'))

      const res = await app.request('/test', {
        method: 'POST',
      })
      assert.strictEqual(res.status, 200)
    })
  })

  describe('same-origin requests', () => {
    it('should allow POST with matching Origin header', async () => {
      const app = new Hono<AppContext>()
      app.post('/*', csrfProtection(), c => c.text('OK'))

      const res = await app.request('http://localhost/test', {
        method: 'POST',
        headers: {
          Cookie: 'session_id=abc123',
          Origin: 'http://localhost',
          Host: 'localhost',
        },
      })
      assert.strictEqual(res.status, 200)
    })

    it('should allow DELETE with matching Origin header', async () => {
      const app = new Hono<AppContext>()
      app.delete('/*', csrfProtection(), c => c.text('OK'))

      const res = await app.request('http://localhost/test', {
        method: 'DELETE',
        headers: {
          Cookie: 'session_id=abc123',
          Origin: 'http://localhost',
          Host: 'localhost',
        },
      })
      assert.strictEqual(res.status, 200)
    })

    it('should allow PATCH with matching Origin header', async () => {
      const app = new Hono<AppContext>()
      app.patch('/*', csrfProtection(), c => c.text('OK'))

      const res = await app.request('http://localhost/test', {
        method: 'PATCH',
        headers: {
          Cookie: 'session_id=abc123',
          Origin: 'http://localhost',
          Host: 'localhost',
        },
      })
      assert.strictEqual(res.status, 200)
    })

    it('should allow POST with matching Referer header (no Origin)', async () => {
      const app = new Hono<AppContext>()
      app.post('/*', csrfProtection(), c => c.text('OK'))

      const res = await app.request('http://localhost/test', {
        method: 'POST',
        headers: {
          Cookie: 'session_id=abc123',
          Referer: 'http://localhost/edit',
          Host: 'localhost',
        },
      })
      assert.strictEqual(res.status, 200)
    })
  })

  describe('cross-origin requests', () => {
    it('should block POST with different Origin', async () => {
      const app = new Hono<AppContext>()
      app.post('/*', csrfProtection(), c => c.text('OK'))

      const res = await app.request('http://localhost/test', {
        method: 'POST',
        headers: {
          Cookie: 'session_id=abc123',
          Origin: 'http://evil.com',
          Host: 'localhost',
        },
      })
      assert.strictEqual(res.status, 403)
      const body = (await res.json()) as {error: string}
      assert.strictEqual(body.error, 'Forbidden: cross-origin request')
    })

    it('should block DELETE with different Origin', async () => {
      const app = new Hono<AppContext>()
      app.delete('/*', csrfProtection(), c => c.text('OK'))

      const res = await app.request('http://localhost/test', {
        method: 'DELETE',
        headers: {
          Cookie: 'session_id=abc123',
          Origin: 'http://evil.com',
          Host: 'localhost',
        },
      })
      assert.strictEqual(res.status, 403)
    })

    it('should block POST with cross-origin Referer', async () => {
      const app = new Hono<AppContext>()
      app.post('/*', csrfProtection(), c => c.text('OK'))

      const res = await app.request('http://localhost/test', {
        method: 'POST',
        headers: {
          Cookie: 'session_id=abc123',
          Referer: 'http://evil.com/page',
          Host: 'localhost',
        },
      })
      assert.strictEqual(res.status, 403)
      const body = (await res.json()) as {error: string}
      assert.strictEqual(body.error, 'Forbidden: cross-origin request')
    })
  })

  describe('missing origin on cookie-bearing POST', () => {
    it('should allow POST with session cookie but no Origin or Referer (SameSite=Lax is primary defense)', async () => {
      const app = new Hono<AppContext>()
      app.post('/*', csrfProtection(), c => c.text('OK'))

      const res = await app.request('/test', {
        method: 'POST',
        headers: {
          Cookie: 'session_id=abc123',
        },
      })
      assert.strictEqual(res.status, 200)
    })
  })

  describe('invalid origin', () => {
    it('should block POST with malformed Origin header', async () => {
      const app = new Hono<AppContext>()
      app.post('/*', csrfProtection(), c => c.text('OK'))

      const res = await app.request('http://localhost/test', {
        method: 'POST',
        headers: {
          Cookie: 'session_id=abc123',
          Origin: 'not-a-url',
          Host: 'localhost',
        },
      })
      assert.strictEqual(res.status, 403)
      const body = (await res.json()) as {error: string}
      assert.strictEqual(body.error, 'Forbidden: invalid Origin')
    })
  })

  describe('X-Forwarded-Host support', () => {
    it('should use X-Forwarded-Host when Host is absent', async () => {
      const app = new Hono<AppContext>()
      app.post('/*', csrfProtection(), c => c.text('OK'))

      const res = await app.request('http://localhost/test', {
        method: 'POST',
        headers: {
          Cookie: 'session_id=abc123',
          Origin: 'http://myapp.example.com',
          'X-Forwarded-Host': 'myapp.example.com',
        },
      })
      assert.strictEqual(res.status, 200)
    })
  })
})
