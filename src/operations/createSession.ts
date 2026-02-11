import type {DbOperation} from './types.ts'
import {randomBytes} from 'crypto'

interface CreateSessionParams {
  user_id: number
  expires_in_days?: number
}

interface Session {
  session_id: string
  user_id: number
  expires_at: Date
  created_at: Date
}

/**
 * Create a new session for a user
 * @param client Database client
 * @param params Session parameters
 * @returns The created session
 * @throws Error if user doesn't exist
 */
export const createSession: DbOperation<[CreateSessionParams], Session> = async (client, params) => {
  const {user_id, expires_in_days = 30} = params

  // Verify user exists
  const userCheck = await client.query('SELECT id FROM users WHERE id = $1', [user_id])

  if (userCheck.rows.length === 0) {
    throw new Error('User not found')
  }

  // Generate secure random session ID
  const session_id = randomBytes(32).toString('hex')

  // Calculate expiration date
  const expires_at = new Date()
  expires_at.setDate(expires_at.getDate() + expires_in_days)

  // Insert session
  const result = await client.query(
    `INSERT INTO sessions (session_id, user_id, expires_at) 
     VALUES ($1, $2, $3) 
     RETURNING session_id, user_id, expires_at, created_at`,
    [session_id, user_id, expires_at],
  )

  return result.rows[0]
}
