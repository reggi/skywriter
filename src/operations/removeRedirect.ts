import type {RedirectQuery, DbOperation} from './types.ts'

/**
 * Removes a redirect path
 *
 * This function deletes a route (redirect) by its ID or path.
 * It prevents deletion of the canonical path (where route.id === document.path_id)
 * to ensure every document always has at least one accessible path.
 *
 * @param client Database client
 * @param query Redirect query (redirect id number, redirect path string, or objects with {id} or {path})
 * @returns True if redirect was deleted, false if not found or is canonical path
 * @throws Error if attempting to delete canonical path
 */
export const removeRedirect: DbOperation<[RedirectQuery], boolean> = async (client, query) => {
  // Validate redirect query
  if (query === null || query === undefined || query === '') {
    throw new Error('Invalid redirect path')
  }

  // Normalize query to get redirectId or redirectPath
  let redirectId: number | undefined
  let redirectPath: string | undefined

  if (typeof query === 'number') {
    redirectId = query
  } else if (typeof query === 'string') {
    redirectPath = query
  } else if ('id' in query && typeof query.id === 'number') {
    redirectId = query.id
  } else if ('path' in query && typeof query.path === 'string') {
    redirectPath = query.path
  } else {
    throw new Error('Invalid RedirectQuery format')
  }

  // First, find the route to check if it's canonical
  let routeQuery: string
  let routeParams: (number | string)[]

  if (redirectId !== undefined) {
    routeQuery = 'SELECT id, document_id FROM routes WHERE id = $1'
    routeParams = [redirectId]
  } else {
    // redirectPath is guaranteed to be defined here due to validation above
    routeQuery = 'SELECT id, document_id FROM routes WHERE path = $1'
    routeParams = [redirectPath!]
  }

  const routeResult = await client.query<{id: number; document_id: number}>(routeQuery, routeParams)

  if (routeResult.rows.length === 0) {
    return false
  }

  const route = routeResult.rows[0]
  const actualRedirectId = route.id
  const documentId = route.document_id

  // Get the document's canonical path_id to prevent deletion
  const docResult = await client.query<{path_id: number}>('SELECT path_id FROM documents WHERE id = $1', [documentId])

  /* node:coverage disable */
  if (docResult.rows.length === 0) {
    return false
  }
  /* node:coverage enable */

  const {path_id} = docResult.rows[0]

  // Prevent deletion of canonical path
  if (actualRedirectId === path_id) {
    throw new Error('Cannot delete canonical path. Use upsert to change the document path instead.')
  }

  // Delete the redirect
  const result = await client.query('DELETE FROM routes WHERE id = $1', [actualRedirectId])

  return result.rowCount !== null && result.rowCount > 0
}
