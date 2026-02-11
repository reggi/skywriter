import type {DbOperation} from './types.ts'
import bcrypt from 'bcrypt'

const SALT_ROUNDS = 10

interface SignupParams {
  username: string
  password: string
  password_confirm?: string
}

interface SignupResult {
  id: number
  username: string
  created_at: Date
}

/**
 * Create a new user account
 * @param client Database client
 * @param params Signup parameters
 * @returns The created user (without password hash)
 * @throws Error if username already exists or validation fails
 */
export const signup: DbOperation<[SignupParams], SignupResult> = async (client, params) => {
  const {username, password, password_confirm} = params

  // Validate password confirmation if provided
  if (password_confirm !== undefined && password !== password_confirm) {
    throw new Error('Passwords do not match')
  }

  // Validate input
  if (!username || username.trim().length === 0) {
    throw new Error('Username is required')
  }

  if (username.length < 3) {
    throw new Error('Username must be at least 3 characters long')
  }

  if (username.length > 255) {
    throw new Error('Username must not exceed 255 characters')
  }

  if (!password || password.length === 0) {
    throw new Error('Password is required')
  }

  if (password.length < 8) {
    throw new Error('Password must be at least 8 characters long')
  }

  // Check if username already exists
  const existingUser = await client.query('SELECT id FROM users WHERE username = $1', [username.trim()])

  if (existingUser.rows.length > 0) {
    throw new Error('Username already exists')
  }

  // Hash the password
  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS)

  // Insert the new user
  const result = await client.query(
    `INSERT INTO users (username, password_hash) 
     VALUES ($1, $2) 
     RETURNING id, username, created_at`,
    [username.trim(), passwordHash],
  )

  return result.rows[0]
}
