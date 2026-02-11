import {describe, it, before, after, afterEach} from 'node:test'
import assert from 'node:assert'
import {createDatabaseContext, closeDatabaseContext, closePool} from '../../src/db/index.ts'
import {signup} from '../../src/operations/signup.ts'
import {createSession} from '../../src/operations/createSession.ts'
import {deleteSession} from '../../src/operations/deleteSession.ts'
import type {PoolClient} from 'pg'

describe('deleteSession operation', () => {
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

  it('should delete an existing session', async () => {
    const user = await signup(ctx, {
      username: `deletable-${testId}`,
      password: 'securepassword123',
    })
    createdUserIds.push(user.id)

    const session = await createSession(ctx, {user_id: user.id})
    // Don't add to createdSessionIds since we're deleting it

    const result = await deleteSession(ctx, {session_id: session.session_id})

    assert.strictEqual(result, true)

    // Verify session is deleted from database
    const dbResult = await ctx.query('SELECT * FROM sessions WHERE session_id = $1', [session.session_id])
    assert.strictEqual(dbResult.rows.length, 0)
  })

  it('should return false for non-existent session', async () => {
    const result = await deleteSession(ctx, {
      session_id: 'nonexistentsessionid12345678901234567890123456789012',
    })

    assert.strictEqual(result, false)
  })

  it('should return false for empty session ID', async () => {
    const result = await deleteSession(ctx, {session_id: ''})

    assert.strictEqual(result, false)
  })

  it('should return false for whitespace-only session ID', async () => {
    const result = await deleteSession(ctx, {session_id: '   '})

    assert.strictEqual(result, false)
  })

  it('should only delete the specified session', async () => {
    const user = await signup(ctx, {
      username: `multidelete-${testId}`,
      password: 'securepassword123',
    })
    createdUserIds.push(user.id)

    const session1 = await createSession(ctx, {user_id: user.id})
    const session2 = await createSession(ctx, {user_id: user.id})
    const session3 = await createSession(ctx, {user_id: user.id})
    createdSessionIds.push(session1.session_id, session3.session_id) // session2 will be deleted

    const result = await deleteSession(ctx, {session_id: session2.session_id})

    assert.strictEqual(result, true)

    // Verify only session2 was deleted
    const remaining = await ctx.query('SELECT session_id FROM sessions WHERE user_id = $1', [user.id])
    const remainingIds = remaining.rows.map(r => r.session_id)

    assert.ok(remainingIds.includes(session1.session_id))
    assert.ok(!remainingIds.includes(session2.session_id))
    assert.ok(remainingIds.includes(session3.session_id))
  })

  it('should delete already expired session', async () => {
    const user = await signup(ctx, {
      username: `expireddelete-${testId}`,
      password: 'securepassword123',
    })
    createdUserIds.push(user.id)

    const session = await createSession(ctx, {user_id: user.id})

    // Make session expired
    await ctx.query("UPDATE sessions SET expires_at = NOW() - INTERVAL '1 day' WHERE session_id = $1", [
      session.session_id,
    ])

    const result = await deleteSession(ctx, {session_id: session.session_id})

    assert.strictEqual(result, true)

    // Verify session is deleted
    const dbResult = await ctx.query('SELECT * FROM sessions WHERE session_id = $1', [session.session_id])
    assert.strictEqual(dbResult.rows.length, 0)
  })
})
