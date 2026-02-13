import {describe, it, before, after, afterEach} from 'node:test'
import assert from 'node:assert'
import {createTestContext} from '../helpers/db.ts'
import {signup} from '../../src/operations/signup.ts'
import {createSession} from '../../src/operations/createSession.ts'
import {validateSession} from '../../src/operations/validateSession.ts'
import type {PoolClient} from 'pg'

describe('validateSession operation', () => {
  let ctx: PoolClient
  let cleanup: () => Promise<void>
  const createdUserIds: number[] = []
  const createdSessionIds: string[] = []
  const testId = Date.now()

  before(async () => {
    const tc = await createTestContext()
    ctx = tc.client
    cleanup = tc.cleanup
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
    await cleanup()
  })

  it('should return valid result for active session', async () => {
    const user = await signup(ctx, {
      username: `validsession-${testId}`,
      password: 'securepassword123',
    })
    createdUserIds.push(user.id)

    const session = await createSession(ctx, {user_id: user.id})
    createdSessionIds.push(session.session_id)

    const result = await validateSession(ctx, session.session_id)

    assert.strictEqual(result.valid, true)
    assert.strictEqual(result.user_id, user.id)
    assert.strictEqual(result.username, `validsession-${testId}`)
    assert.strictEqual(result.session_id, session.session_id)
    assert.ok(result.expires_at instanceof Date)
  })

  it('should return invalid for non-existent session', async () => {
    const result = await validateSession(ctx, 'nonexistentsessionid12345678901234567890123456789012')

    assert.strictEqual(result.valid, false)
    assert.strictEqual(result.user_id, undefined)
    assert.strictEqual(result.username, undefined)
    assert.strictEqual(result.session_id, undefined)
  })

  it('should return invalid for empty session ID', async () => {
    const result = await validateSession(ctx, '')

    assert.strictEqual(result.valid, false)
  })

  it('should return invalid for whitespace-only session ID', async () => {
    const result = await validateSession(ctx, '   ')

    assert.strictEqual(result.valid, false)
  })

  it('should return invalid for expired session', async () => {
    const user = await signup(ctx, {
      username: `expiredsession-${testId}`,
      password: 'securepassword123',
    })
    createdUserIds.push(user.id)

    // Create a session with 1 day expiry
    const session = await createSession(ctx, {user_id: user.id, expires_in_days: 1})
    createdSessionIds.push(session.session_id)

    // Manually update the session to be expired
    await ctx.query("UPDATE sessions SET expires_at = NOW() - INTERVAL '1 hour' WHERE session_id = $1", [
      session.session_id,
    ])

    const result = await validateSession(ctx, session.session_id)

    assert.strictEqual(result.valid, false)
  })

  it('should return invalid when user is deleted', async () => {
    const user = await signup(ctx, {
      username: `deleteduser-${testId}`,
      password: 'securepassword123',
    })

    const session = await createSession(ctx, {user_id: user.id})
    createdSessionIds.push(session.session_id)

    // Delete the user (this will cascade delete sessions due to FK)
    await ctx.query('DELETE FROM sessions WHERE user_id = $1', [user.id])
    await ctx.query('DELETE FROM users WHERE id = $1', [user.id])

    const result = await validateSession(ctx, session.session_id)

    assert.strictEqual(result.valid, false)
  })

  it('should validate session that expires exactly now as invalid', async () => {
    const user = await signup(ctx, {
      username: `exactexpiry-${testId}`,
      password: 'securepassword123',
    })
    createdUserIds.push(user.id)

    const session = await createSession(ctx, {user_id: user.id})
    createdSessionIds.push(session.session_id)

    // Set expires_at to exactly now
    await ctx.query('UPDATE sessions SET expires_at = NOW() WHERE session_id = $1', [session.session_id])

    const result = await validateSession(ctx, session.session_id)

    // Session expires_at <= NOW() should be invalid
    assert.strictEqual(result.valid, false)
  })
})
