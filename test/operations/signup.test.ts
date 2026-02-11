import {describe, it, before, after, afterEach} from 'node:test'
import assert from 'node:assert'
import {createDatabaseContext, closeDatabaseContext, closePool} from '../../src/db/index.ts'
import {signup} from '../../src/operations/signup.ts'
import type {PoolClient} from 'pg'

describe('signup operation', () => {
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

  it('should create a new user successfully', async () => {
    const result = await signup(ctx, {
      username: `testuser-${testId}`,
      password: 'securepassword123',
    })

    createdUserIds.push(result.id)

    assert.ok(result.id > 0, 'User should have an ID')
    assert.strictEqual(result.username, `testuser-${testId}`)
    assert.ok(result.created_at instanceof Date, 'Should have created_at timestamp')
  })

  it('should trim whitespace from username', async () => {
    const result = await signup(ctx, {
      username: `  trimtest-${testId}  `,
      password: 'securepassword123',
    })

    createdUserIds.push(result.id)

    assert.strictEqual(result.username, `trimtest-${testId}`)
  })

  it('should throw error when username is empty', async () => {
    await assert.rejects(
      async () => {
        await signup(ctx, {
          username: '',
          password: 'securepassword123',
        })
      },
      {
        message: 'Username is required',
      },
    )
  })

  it('should throw error when username is only whitespace', async () => {
    await assert.rejects(
      async () => {
        await signup(ctx, {
          username: '   ',
          password: 'securepassword123',
        })
      },
      {
        message: 'Username is required',
      },
    )
  })

  it('should throw error when username is too short', async () => {
    await assert.rejects(
      async () => {
        await signup(ctx, {
          username: 'ab',
          password: 'securepassword123',
        })
      },
      {
        message: 'Username must be at least 3 characters long',
      },
    )
  })

  it('should throw error when username exceeds 255 characters', async () => {
    const longUsername = 'a'.repeat(256)
    await assert.rejects(
      async () => {
        await signup(ctx, {
          username: longUsername,
          password: 'securepassword123',
        })
      },
      {
        message: 'Username must not exceed 255 characters',
      },
    )
  })

  it('should throw error when password is empty', async () => {
    await assert.rejects(
      async () => {
        await signup(ctx, {
          username: `nopassword-${testId}`,
          password: '',
        })
      },
      {
        message: 'Password is required',
      },
    )
  })

  it('should throw error when password is too short', async () => {
    await assert.rejects(
      async () => {
        await signup(ctx, {
          username: `shortpass-${testId}`,
          password: '1234567',
        })
      },
      {
        message: 'Password must be at least 8 characters long',
      },
    )
  })

  it('should throw error when username already exists', async () => {
    const username = `duplicate-${testId}`

    // Create first user
    const first = await signup(ctx, {
      username,
      password: 'securepassword123',
    })
    createdUserIds.push(first.id)

    // Try to create second user with same username
    await assert.rejects(
      async () => {
        await signup(ctx, {
          username,
          password: 'differentpassword123',
        })
      },
      {
        message: 'Username already exists',
      },
    )
  })

  it('should not return password hash in result', async () => {
    const result = await signup(ctx, {
      username: `nohash-${testId}`,
      password: 'securepassword123',
    })

    createdUserIds.push(result.id)

    assert.strictEqual(
      (result as unknown as Record<string, unknown>).password_hash,
      undefined,
      'Password hash should not be returned',
    )
    assert.strictEqual(
      (result as unknown as Record<string, unknown>).password,
      undefined,
      'Password should not be returned',
    )
  })

  it('should hash the password in database', async () => {
    const result = await signup(ctx, {
      username: `hashcheck-${testId}`,
      password: 'securepassword123',
    })

    createdUserIds.push(result.id)

    // Verify password is hashed in database
    const dbResult = await ctx.query('SELECT password_hash FROM users WHERE id = $1', [result.id])
    const storedHash = dbResult.rows[0].password_hash

    assert.ok(storedHash.startsWith('$2'), 'Password should be bcrypt hashed')
    assert.notStrictEqual(storedHash, 'securepassword123', 'Password should not be stored in plaintext')
  })

  it('should throw error when passwords do not match', async () => {
    await assert.rejects(
      async () => {
        await signup(ctx, {
          username: `mismatch-${testId}`,
          password: 'password123',
          password_confirm: 'differentpassword',
        })
      },
      {
        message: 'Passwords do not match',
      },
    )
  })

  it('should succeed when password_confirm matches password', async () => {
    const result = await signup(ctx, {
      username: `confirmed-${testId}`,
      password: 'securepassword123',
      password_confirm: 'securepassword123',
    })

    createdUserIds.push(result.id)

    assert.ok(result.id > 0, 'User should have an ID')
    assert.strictEqual(result.username, `confirmed-${testId}`)
  })

  it('should succeed when password_confirm is not provided', async () => {
    const result = await signup(ctx, {
      username: `noconfirm-${testId}`,
      password: 'securepassword123',
    })

    createdUserIds.push(result.id)

    assert.ok(result.id > 0, 'User should have an ID')
  })
})
