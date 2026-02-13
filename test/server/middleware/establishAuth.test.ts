import {describe, it, before, after, afterEach} from 'node:test'
import assert from 'node:assert'
import {Hono} from 'hono'
import {establishAuth} from '../../../src/server/middleware/establishAuth.ts'
import {withDb} from '../../../src/server/middleware/withDb.ts'
import {signup} from '../../../src/operations/signup.ts'
import {createSession} from '../../../src/operations/createSession.ts'
import {createDatabaseContext, closeDatabaseContext, closePool} from '../../../src/db/index.ts'
import type {AppContext} from '../../../src/server/utils/types.ts'
import type {PoolClient} from 'pg'

describe('establishAuth', () => {
  let ctx: PoolClient
  const createdUserIds: number[] = []
  const createdSessionIds: string[] = []
  const testId = Date.now()

  before(async () => {
    ctx = await createDatabaseContext()
  })

  afterEach(async () => {
    // Clean up sessions
    for (const sessionId of createdSessionIds) {
      try {
        await ctx.query('DELETE FROM sessions WHERE session_id = $1', [sessionId])
      } catch {
        // Session may have been deleted by test
      }
    }
    createdSessionIds.length = 0

    // Clean up users
    for (const userId of createdUserIds) {
      try {
        await ctx.query('DELETE FROM sessions WHERE user_id = $1', [userId])
        await ctx.query('DELETE FROM users WHERE id = $1', [userId])
      } catch {
        // User may have been deleted by test
      }
    }
    createdUserIds.length = 0
  })

  after(async () => {
    await closeDatabaseContext(ctx)
    await closePool()
  })

  it('should authenticate with valid session cookie', async () => {
    const app = new Hono<AppContext>()
    
    // Create test user and session
    const user = await signup(ctx, {
      username: `session-user-${testId}`,
      password: 'password123',
    })
    createdUserIds.push(user.id)
    
    const session = await createSession(ctx, {user_id: user.id})
    createdSessionIds.push(session.session_id)

    app.use('/*', withDb(ctx))
    app.use('/*', establishAuth())
    app.get('/*', c => {
      return c.json({
        isAuthenticated: c.get('isAuthenticated'),
        userId: c.get('userId'),
        username: c.get('username'),
      })
    })

    const res = await app.request('/test', {
      headers: {
        Cookie: `session_id=${session.session_id}`,
      },
    })

    assert.strictEqual(res.status, 200)
    const body = await res.json()
    assert.strictEqual(body.isAuthenticated, true)
    assert.strictEqual(body.userId, user.id)
    assert.strictEqual(body.username, user.username)
  })

  it('should not authenticate with invalid session cookie', async () => {
    const app = new Hono<AppContext>()

    app.use('/*', withDb(ctx))
    app.use('/*', establishAuth())
    app.get('/*', c => {
      return c.json({
        isAuthenticated: c.get('isAuthenticated') || false,
      })
    })

    const res = await app.request('/test', {
      headers: {
        Cookie: 'session_id=invalid_session_id_12345',
      },
    })

    assert.strictEqual(res.status, 200)
    const body = await res.json()
    assert.strictEqual(body.isAuthenticated, false)
  })

  it('should authenticate with valid Basic Auth header', async () => {
    const app = new Hono<AppContext>()
    
    // Create test user
    const user = await signup(ctx, {
      username: `basicauth-user-${testId}`,
      password: 'password123',
    })
    createdUserIds.push(user.id)

    app.use('/*', withDb(ctx))
    app.use('/*', establishAuth())
    app.get('/*', c => {
      return c.json({
        isAuthenticated: c.get('isAuthenticated'),
        userId: c.get('userId'),
        username: c.get('username'),
      })
    })

    const credentials = Buffer.from(`basicauth-user-${testId}:password123`).toString('base64')
    const res = await app.request('/test', {
      headers: {
        Authorization: `Basic ${credentials}`,
      },
    })

    assert.strictEqual(res.status, 200)
    const body = await res.json()
    assert.strictEqual(body.isAuthenticated, true)
    assert.strictEqual(body.userId, user.id)
    assert.strictEqual(body.username, user.username)
  })

  it('should not authenticate with invalid Basic Auth credentials', async () => {
    const app = new Hono<AppContext>()

    app.use('/*', withDb(ctx))
    app.use('/*', establishAuth())
    app.get('/*', c => {
      return c.json({
        isAuthenticated: c.get('isAuthenticated') || false,
      })
    })

    const credentials = Buffer.from('nonexistent:wrongpassword').toString('base64')
    const res = await app.request('/test', {
      headers: {
        Authorization: `Basic ${credentials}`,
      },
    })

    assert.strictEqual(res.status, 200)
    const body = await res.json()
    assert.strictEqual(body.isAuthenticated, false)
  })

  it('should not authenticate without credentials', async () => {
    const app = new Hono<AppContext>()

    app.use('/*', withDb(ctx))
    app.use('/*', establishAuth())
    app.get('/*', c => {
      return c.json({
        isAuthenticated: c.get('isAuthenticated') || false,
      })
    })

    const res = await app.request('/test')

    assert.strictEqual(res.status, 200)
    const body = await res.json()
    assert.strictEqual(body.isAuthenticated, false)
  })

  it('should prefer session cookie over Basic Auth', async () => {
    const app = new Hono<AppContext>()
    
    // Create two test users
    const sessionUser = await signup(ctx, {
      username: `session-priority-user-${testId}`,
      password: 'sessionpass',
    })
    createdUserIds.push(sessionUser.id)
    
    const basicUser = await signup(ctx, {
      username: `basic-priority-user-${testId}`,
      password: 'basicpass',
    })
    createdUserIds.push(basicUser.id)
    
    const session = await createSession(ctx, {user_id: sessionUser.id})
    createdSessionIds.push(session.session_id)

    app.use('/*', withDb(ctx))
    app.use('/*', establishAuth())
    app.get('/*', c => {
      return c.json({
        isAuthenticated: c.get('isAuthenticated'),
        userId: c.get('userId'),
        username: c.get('username'),
      })
    })

    const credentials = Buffer.from(`basic-priority-user-${testId}:basicpass`).toString('base64')
    const res = await app.request('/test', {
      headers: {
        Cookie: `session_id=${session.session_id}`,
        Authorization: `Basic ${credentials}`,
      },
    })

    assert.strictEqual(res.status, 200)
    const body = await res.json()
    assert.strictEqual(body.isAuthenticated, true)
    // Should use session user, not basic auth user
    assert.strictEqual(body.userId, sessionUser.id)
    assert.strictEqual(body.username, sessionUser.username)
  })

  it('should handle malformed Basic Auth header gracefully', async () => {
    const app = new Hono<AppContext>()

    app.use('/*', withDb(ctx))
    app.use('/*', establishAuth())
    app.get('/*', c => {
      return c.json({
        isAuthenticated: c.get('isAuthenticated') || false,
      })
    })

    const res = await app.request('/test', {
      headers: {
        Authorization: 'Basic invalid_base64!!!',
      },
    })

    assert.strictEqual(res.status, 200)
    const body = await res.json()
    assert.strictEqual(body.isAuthenticated, false)
  })

  it('should handle expired session', async () => {
    const app = new Hono<AppContext>()
    
    // Create test user and session
    const user = await signup(ctx, {
      username: `expired-user-${testId}`,
      password: 'password123',
    })
    createdUserIds.push(user.id)
    
    const session = await createSession(ctx, {user_id: user.id})
    createdSessionIds.push(session.session_id)
    
    // Expire the session
    await ctx.query("UPDATE sessions SET expires_at = NOW() - INTERVAL '1 day' WHERE session_id = $1", [
      session.session_id,
    ])

    app.use('/*', withDb(ctx))
    app.use('/*', establishAuth())
    app.get('/*', c => {
      return c.json({
        isAuthenticated: c.get('isAuthenticated') || false,
      })
    })

    const res = await app.request('/test', {
      headers: {
        Cookie: `session_id=${session.session_id}`,
      },
    })

    assert.strictEqual(res.status, 200)
    const body = await res.json()
    assert.strictEqual(body.isAuthenticated, false)
  })

  it('should call next middleware after authentication', async () => {
    const app = new Hono<AppContext>()
    let nextCalled = false

    app.use('/*', withDb(ctx))
    app.use('/*', establishAuth())
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
