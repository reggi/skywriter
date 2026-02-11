import {describe, it, before, after, afterEach} from 'node:test'
import assert from 'node:assert'
import {createDatabaseContext, closeDatabaseContext, closePool} from '../../src/db/index.ts'
import {signup} from '../../src/operations/signup.ts'
import {login} from '../../src/operations/login.ts'
import type {PoolClient} from 'pg'

describe('login operation', () => {
  let ctx: PoolClient
  const createdUserIds: number[] = []
  const testId = Date.now()

  before(async () => {
    ctx = await createDatabaseContext()
  })

  afterEach(async () => {
    // Clean up created users
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

  it('should login successfully with valid credentials', async () => {
    const username = `loginuser-${testId}`
    const password = 'securepassword123'

    // Create user first
    const user = await signup(ctx, {username, password})
    createdUserIds.push(user.id)

    // Login
    const result = await login(ctx, {username, password})

    assert.strictEqual(result.id, user.id)
    assert.strictEqual(result.username, username)
    assert.ok(result.created_at instanceof Date)
  })

  it('should login with trimmed username', async () => {
    const username = `trimlogin-${testId}`
    const password = 'securepassword123'

    const user = await signup(ctx, {username, password})
    createdUserIds.push(user.id)

    // Login with whitespace around username
    const result = await login(ctx, {username: `  ${username}  `, password})

    assert.strictEqual(result.id, user.id)
  })

  it('should throw error when username is empty', async () => {
    await assert.rejects(
      async () => {
        await login(ctx, {username: '', password: 'anypassword'})
      },
      {
        message: 'Username is required',
      },
    )
  })

  it('should throw error when username is only whitespace', async () => {
    await assert.rejects(
      async () => {
        await login(ctx, {username: '   ', password: 'anypassword'})
      },
      {
        message: 'Username is required',
      },
    )
  })

  it('should throw error when password is empty', async () => {
    await assert.rejects(
      async () => {
        await login(ctx, {username: 'someuser', password: ''})
      },
      {
        message: 'Password is required',
      },
    )
  })

  it('should throw error when user does not exist', async () => {
    await assert.rejects(
      async () => {
        await login(ctx, {username: `nonexistent-${testId}`, password: 'anypassword'})
      },
      {
        message: 'Invalid username or password',
      },
    )
  })

  it('should throw error when password is incorrect', async () => {
    const username = `wrongpass-${testId}`
    const password = 'correctpassword123'

    const user = await signup(ctx, {username, password})
    createdUserIds.push(user.id)

    await assert.rejects(
      async () => {
        await login(ctx, {username, password: 'wrongpassword123'})
      },
      {
        message: 'Invalid username or password',
      },
    )
  })

  it('should not return password hash in result', async () => {
    const username = `nohashlogin-${testId}`
    const password = 'securepassword123'

    const user = await signup(ctx, {username, password})
    createdUserIds.push(user.id)

    const result = await login(ctx, {username, password})

    assert.strictEqual((result as unknown as Record<string, unknown>).password_hash, undefined)
    assert.strictEqual((result as unknown as Record<string, unknown>).password, undefined)
  })

  it('should handle case-sensitive username matching', async () => {
    const username = `CaseSensitive-${testId}`
    const password = 'securepassword123'

    const user = await signup(ctx, {username, password})
    createdUserIds.push(user.id)

    // Try to login with different case - should fail
    await assert.rejects(
      async () => {
        await login(ctx, {username: username.toLowerCase(), password})
      },
      {
        message: 'Invalid username or password',
      },
    )
  })
})
