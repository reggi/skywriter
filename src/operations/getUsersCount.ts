import type {DbOperation} from './types.ts'

interface GetUsersCountResult {
  count: number
}

/**
 * Get the total count of users in the database
 * @param client Database client
 * @returns The count of users
 */
export const getUsersCount: DbOperation<[], GetUsersCountResult> = async client => {
  const result = await client.query('SELECT COUNT(*) as count FROM users')
  return {
    count: parseInt(result.rows[0].count, 10),
  }
}
