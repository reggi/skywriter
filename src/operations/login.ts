import type {DbOperation} from './types.ts'
import bcrypt from 'bcrypt'

interface LoginParams {
  username: string
  password: string
}

interface LoginResult {
  id: number
  username: string
  created_at: Date
}

/**
 * Authenticate a user with username and password
 * @param client Database client
 * @param params Login parameters
 * @returns The authenticated user info
 * @throws Error if credentials are invalid
 */
export const login: DbOperation<[LoginParams], LoginResult> = async (client, params) => {
  const {username, password} = params

  // Validate input
  if (!username || username.trim().length === 0) {
    throw new Error('Username is required')
  }

  if (!password || password.length === 0) {
    throw new Error('Password is required')
  }

  // Fetch user by username
  const result = await client.query(
    `SELECT id, username, password_hash, created_at
     FROM users 
     WHERE username = $1`,
    [username.trim()],
  )

  if (result.rows.length === 0) {
    throw new Error('Invalid username or password')
  }

  const user = result.rows[0]

  // Verify password
  const isValidPassword = await bcrypt.compare(password, user.password_hash)

  if (!isValidPassword) {
    throw new Error('Invalid username or password')
  }

  // Return user info without password hash
  return {
    id: user.id,
    username: user.username,
    created_at: user.created_at,
  }
}
