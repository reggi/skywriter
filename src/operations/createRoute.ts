import type {Route, DbOperation} from './types.ts'

/**
 * Helper: Create a new route
 */
export const createRoute: DbOperation<[string, number], Route> = async (client, path, documentId) => {
  const result = await client.query<Route>(
    `INSERT INTO routes (path, document_id)
     VALUES ($1, $2)
     RETURNING *`,
    [path, documentId],
  )
  return result.rows[0]
}
