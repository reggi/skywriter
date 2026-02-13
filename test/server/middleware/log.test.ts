import {describe, it, mock} from 'node:test'
import assert from 'node:assert'
import {Hono} from 'hono'
import {log} from '../../../src/server/middleware/log.ts'
import type {AppContext} from '../../../src/server/utils/types.ts'

describe('log middleware', () => {
  it('should log authenticated request', async () => {
    const app = new Hono<AppContext>()
    const logs: string[] = []
    
    // Mock console.log
    const originalLog = console.log
    console.log = mock.fn((...args: unknown[]) => {
      logs.push(args.join(' '))
    })

    app.use('/*', (c, next) => {
      c.set('isAuthenticated', true)
      c.set('username', 'testuser')
      return next()
    })

    app.use('/*', log())
    app.get('/*', c => {
      return c.text('OK')
    })

    const res = await app.request('/test-path', {method: 'GET'})
    assert.strictEqual(res.status, 200)

    // Verify log output
    assert.strictEqual(logs.length, 1)
    assert.ok(logs[0].includes('GET /test-path'))
    assert.ok(logs[0].includes('✓ testuser'))

    // Restore console.log
    console.log = originalLog
  })

  it('should log unauthenticated request', async () => {
    const app = new Hono<AppContext>()
    const logs: string[] = []
    
    // Mock console.log
    const originalLog = console.log
    console.log = mock.fn((...args: unknown[]) => {
      logs.push(args.join(' '))
    })

    app.use('/*', (c, next) => {
      c.set('isAuthenticated', false)
      return next()
    })

    app.use('/*', log())
    app.post('/*', c => {
      return c.text('OK')
    })

    const res = await app.request('/api/endpoint', {method: 'POST'})
    assert.strictEqual(res.status, 200)

    // Verify log output
    assert.strictEqual(logs.length, 1)
    assert.ok(logs[0].includes('POST /api/endpoint'))
    assert.ok(logs[0].includes('✗ unauthenticated'))

    // Restore console.log
    console.log = originalLog
  })

  it('should log request without authentication context as unauthenticated', async () => {
    const app = new Hono<AppContext>()
    const logs: string[] = []
    
    // Mock console.log
    const originalLog = console.log
    console.log = mock.fn((...args: unknown[]) => {
      logs.push(args.join(' '))
    })

    app.use('/*', log())
    app.delete('/*', c => {
      return c.text('OK')
    })

    const res = await app.request('/another-path', {method: 'DELETE'})
    assert.strictEqual(res.status, 200)

    // Verify log output
    assert.strictEqual(logs.length, 1)
    assert.ok(logs[0].includes('DELETE /another-path'))
    assert.ok(logs[0].includes('✗ unauthenticated'))

    // Restore console.log
    console.log = originalLog
  })

  it('should return response after logging', async () => {
    const app = new Hono<AppContext>()
    
    // Mock console.log to suppress output
    const originalLog = console.log
    console.log = mock.fn()

    app.use('/*', log())
    app.get('/*', c => {
      return c.text('Test Response')
    })

    const res = await app.request('/test')
    assert.strictEqual(res.status, 200)
    assert.strictEqual(await res.text(), 'Test Response')

    // Restore console.log
    console.log = originalLog
  })

  it('should log different HTTP methods correctly', async () => {
    const app = new Hono<AppContext>()
    const logs: string[] = []
    
    // Mock console.log
    const originalLog = console.log
    console.log = mock.fn((...args: unknown[]) => {
      logs.push(args.join(' '))
    })

    app.use('/*', log())
    app.get('/*', c => c.text('OK'))
    app.post('/*', c => c.text('OK'))
    app.put('/*', c => c.text('OK'))
    app.patch('/*', c => c.text('OK'))
    app.delete('/*', c => c.text('OK'))

    await app.request('/test', {method: 'GET'})
    await app.request('/test', {method: 'POST'})
    await app.request('/test', {method: 'PUT'})
    await app.request('/test', {method: 'PATCH'})
    await app.request('/test', {method: 'DELETE'})

    assert.strictEqual(logs.length, 5)
    assert.ok(logs[0].includes('GET /test'))
    assert.ok(logs[1].includes('POST /test'))
    assert.ok(logs[2].includes('PUT /test'))
    assert.ok(logs[3].includes('PATCH /test'))
    assert.ok(logs[4].includes('DELETE /test'))

    // Restore console.log
    console.log = originalLog
  })
})
