import type {DbOperation} from './types.ts'

interface ValidateSessionResult {
  valid: boolean
  user_id?: number
  username?: string
  session_id?: string
  expires_at?: Date
}

/**
 * Validate a session ID and return user info if valid
 * @param client Database client
 * @param session_id Session ID to validate
 * @returns Validation result with user info if valid
 */
export const validateSession: DbOperation<[string], ValidateSessionResult> = async (client, session_id) => {
  if (!session_id || session_id.trim().length === 0) {
    return {valid: false}
  }

  const result = await client.query(
    `SELECT s.session_id, s.user_id, s.expires_at, u.username
     FROM sessions s
     JOIN users u ON s.user_id = u.id
     WHERE s.session_id = $1 AND s.expires_at > NOW()`,
    [session_id],
  )

  if (result.rows.length === 0) {
    return {valid: false}
  }

  const session = result.rows[0]

  return {
    valid: true,
    user_id: session.user_id,
    username: session.username,
    session_id: session.session_id,
    expires_at: session.expires_at,
  }
}
