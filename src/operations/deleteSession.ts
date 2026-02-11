import type {DbOperation} from './types.ts'

interface DeleteSessionParams {
  session_id: string
}

/**
 * Delete a session (logout)
 * @param client Database client
 * @param params Parameters containing session_id
 * @returns True if session was deleted
 */
export const deleteSession: DbOperation<[DeleteSessionParams], boolean> = async (client, params) => {
  const {session_id} = params

  if (!session_id || session_id.trim().length === 0) {
    return false
  }

  const result = await client.query('DELETE FROM sessions WHERE session_id = $1', [session_id])

  return result.rowCount !== null && result.rowCount > 0
}
