import {Pool} from 'pg'

let pool: Pool | null = null

/**
 * Get a database connection pool for e2e tests
 */
function getPool(): Pool {
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL || 'postgresql://astrodoc:astrodoc_password@localhost:5455/astrodoc',
    })
  }
  return pool
}

/**
 * Close the database connection pool
 */
export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end()
    pool = null
  }
}

/**
 * Delete a user by username (for test cleanup)
 * This will cascade delete all related data (sessions, documents, etc.)
 */
export async function deleteUserByUsername(username: string): Promise<void> {
  const client = await getPool().connect()
  try {
    // Delete user - foreign key constraints should cascade
    await client.query('DELETE FROM users WHERE username = $1', [username])
  } finally {
    client.release()
  }
}

/**
 * Delete multiple users by username pattern (for batch cleanup)
 * @param pattern SQL LIKE pattern, e.g., 'api-html-%' or 'test-%'
 */
export async function deleteUsersByPattern(pattern: string): Promise<number> {
  const client = await getPool().connect()
  try {
    const result = await client.query('DELETE FROM users WHERE username LIKE $1', [pattern])
    return result.rowCount ?? 0
  } finally {
    client.release()
  }
}

/**
 * Get count of users matching a pattern
 */
export async function getUserCountByPattern(pattern: string): Promise<number> {
  const client = await getPool().connect()
  try {
    const result = await client.query('SELECT COUNT(*) as count FROM users WHERE username LIKE $1', [pattern])
    return parseInt(result.rows[0].count, 10)
  } finally {
    client.release()
  }
}

/**
 * Clean up all e2e test users (those matching common test patterns)
 */
export async function cleanupTestUsers(): Promise<number> {
  const client = await getPool().connect()
  try {
    // Delete users matching common e2e test patterns
    const result = await client.query(`
      DELETE FROM users 
      WHERE username LIKE 'api-%'
         OR username LIKE 'auth-%'
         OR username LIKE 'editor-%'
         OR username LIKE 'doc-%'
         OR username LIKE 'nav-%'
         OR username LIKE 'security-%'
         OR username LIKE 'test-%'
         OR username LIKE 'e2e-%'
         OR username LIKE 'git-%'
    `)
    return result.rowCount ?? 0
  } finally {
    client.release()
  }
}
