import type {PoolClient} from 'pg'
import type {Document, Route, DocumentId, DbOperation} from './types.ts'

/**
 * Helper: Find document by path (including unpublished), following redirects
 * Returns the document along with whether the access was via redirect
 */
async function findDocumentByPath(client: PoolClient, path: string, options?: {published?: boolean}) {
  // First find the route
  const routeResult = await client.query<{
    id: number
    path: string
    document_id: number
  }>(`SELECT id, path, document_id FROM routes WHERE path = $1`, [path])

  if (routeResult.rows.length === 0) {
    return null
  }

  const route = routeResult.rows[0]

  // Build WHERE clause with optional published filter
  const whereConditions = ['d.id = r1.document_id']
  if (options?.published !== undefined) {
    whereConditions.push(`d.published = ${options.published}`)
  }

  // Then find the document via the route's document_id
  const result = await client.query<Document & {route: Route; redirect: boolean}>(
    `SELECT d.*, 
            row_to_json(r2.*) as route,
            (r1.id != d.path_id) as redirect
     FROM documents d
     JOIN routes r1 ON r1.id = $1
     JOIN routes r2 ON d.path_id = r2.id
     WHERE ${whereConditions.join(' AND ')}`,
    [route.id],
  )

  return result.rows[0] || null
}

/**
 * Helper: Find document by id or path, following redirects
 * Returns document with redirect flag when accessed via non-canonical path
 */
export const findDocument: DbOperation<
  [{id?: DocumentId; path?: string}, {published?: boolean}?],
  (Document & {route: Route; redirect: boolean}) | null
> = async (client, query, options) => {
  if (query.id !== undefined) {
    // Build WHERE clause with optional published filter
    const whereConditions = ['d.id = $1']
    if (options?.published !== undefined) {
      whereConditions.push(`d.published = ${options.published}`)
    }

    // Find by ID
    const result = await client.query<Document & {route: Route; redirect: boolean}>(
      `SELECT d.*, 
              row_to_json(r.*) as route,
              false as redirect
       FROM documents d
       JOIN routes r ON d.path_id = r.id
       WHERE ${whereConditions.join(' AND ')}`,
      [query.id],
    )
    return result.rows[0] || null
  } else if (query.path !== undefined) {
    // Find by path (follows redirects)
    return await findDocumentByPath(client, query.path, options)
  }
  return null
}
