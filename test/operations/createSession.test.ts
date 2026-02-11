import {describe, it, before, after, afterEach} from 'node:test'
import assert from 'node:assert'
import {createDatabaseContext, closeDatabaseContext, closePool} from '../../src/db/index.ts'
import {signup} from '../../src/operations/signup.ts'
import {createSession} from '../../src/operations/createSession.ts'
import type {PoolClient} from 'pg'

describe('createSession operation', () => {
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

  it('should create a session for a valid user', async () => {
    const user = await signup(ctx, {
      username: `sessionuser-${testId}`,
      password: 'securepassword123',
    })
    createdUserIds.push(user.id)

    const session = await createSession(ctx, {user_id: user.id})
    createdSessionIds.push(session.session_id)

    assert.ok(session.session_id, 'Session should have an ID')
    assert.strictEqual(session.session_id.length, 64, 'Session ID should be 64 characters (32 bytes hex)')
    assert.strictEqual(session.user_id, user.id)
    assert.ok(session.expires_at instanceof Date)
    assert.ok(session.created_at instanceof Date)
  })

  it('should create session with default 30 day expiration', async () => {
    const user = await signup(ctx, {
      username: `defaultexpiry-${testId}`,
      password: 'securepassword123',
    })
    createdUserIds.push(user.id)

    const session = await createSession(ctx, {user_id: user.id})
    createdSessionIds.push(session.session_id)

    const now = new Date()
    const expectedExpiry = new Date(now)
    expectedExpiry.setDate(expectedExpiry.getDate() + 30)

    // Allow 1 minute tolerance
    const diffMs = Math.abs(session.expires_at.getTime() - expectedExpiry.getTime())
    assert.ok(diffMs < 60000, 'Expiry should be approximately 30 days from now')
  })

  it('should create session with custom expiration days', async () => {
    const user = await signup(ctx, {
      username: `customexpiry-${testId}`,
      password: 'securepassword123',
    })
    createdUserIds.push(user.id)

    const session = await createSession(ctx, {user_id: user.id, expires_in_days: 7})
    createdSessionIds.push(session.session_id)

    const now = new Date()
    const expectedExpiry = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)

    // Allow 1 minute tolerance
    const diffMs = Math.abs(session.expires_at.getTime() - expectedExpiry.getTime())
    assert.ok(diffMs < 60000, 'Expiry should be approximately 7 days from now')
  })

  it('should throw error when user does not exist', async () => {
    await assert.rejects(
      async () => {
        await createSession(ctx, {user_id: 999999})
      },
      {
        message: 'User not found',
      },
    )
  })

  it('should generate unique session IDs', async () => {
    const user = await signup(ctx, {
      username: `uniquesession-${testId}`,
      password: 'securepassword123',
    })
    createdUserIds.push(user.id)

    const session1 = await createSession(ctx, {user_id: user.id})
    const session2 = await createSession(ctx, {user_id: user.id})
    createdSessionIds.push(session1.session_id, session2.session_id)

    assert.notStrictEqual(session1.session_id, session2.session_id, 'Session IDs should be unique')
  })

  it('should allow multiple sessions for the same user', async () => {
    const user = await signup(ctx, {
      username: `multisession-${testId}`,
      password: 'securepassword123',
    })
    createdUserIds.push(user.id)

    const session1 = await createSession(ctx, {user_id: user.id})
    const session2 = await createSession(ctx, {user_id: user.id})
    const session3 = await createSession(ctx, {user_id: user.id})
    createdSessionIds.push(session1.session_id, session2.session_id, session3.session_id)

    // Verify all sessions exist
    const result = await ctx.query('SELECT COUNT(*) as count FROM sessions WHERE user_id = $1', [user.id])
    assert.strictEqual(parseInt(result.rows[0].count), 3)
  })

  it('should store session in database', async () => {
    const user = await signup(ctx, {
      username: `dbsession-${testId}`,
      password: 'securepassword123',
    })
    createdUserIds.push(user.id)

    const session = await createSession(ctx, {user_id: user.id})
    createdSessionIds.push(session.session_id)

    // Verify session is in database
    const result = await ctx.query('SELECT * FROM sessions WHERE session_id = $1', [session.session_id])
    assert.strictEqual(result.rows.length, 1)
    assert.strictEqual(result.rows[0].user_id, user.id)
  })
})
