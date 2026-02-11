import type {DualDocument, GetOptions, DocumentId, DocumentQuery, DbOperation} from './types.ts'
import {normalizeDocumentQuery} from './utils/common.ts'
import {getDocumentInstance} from './getDocumentInstance.ts'
import {findDocument} from './findDocument.ts'

/**
 * Gets a document by path or id
 *
 * This function retrieves a document through the routing system:
 * - Finds the document by path (follows redirects) or by id
 * - Determines if this is a direct access or redirect (for path queries)
 * - Returns the appropriate version (draft or current) based on options
 *
 * Redirect Detection:
 * - Direct access: route.id === document.path_id (accessing via canonical path)
 * - Redirect: route.id !== document.path_id (accessing via old/alternate path)
 * - ID access: always returns redirect: false
 *
 * Query Filtering:
 * - published: true - only return published documents
 * - published: false - only return unpublished documents
 * - published: undefined - return both published and unpublished documents (no filter)
 * - draft: true - include draft version in response (if exists)
 * - draft: false or undefined - exclude draft version from response
 *
 * @param client Database client
 * @param query Document query (supports path string, id number, DualDocument, Route, etc.)
 * @param options Get options (draft, published)
 * @returns DualDocument with current/draft versions and redirect flag, or null if not found
 */
export const getDualDocument: DbOperation<[DocumentQuery, GetOptions?], DualDocument | null> = async (
  client,
  query,
  options = {},
) => {
  const normalized = normalizeDocumentQuery(query)
  try {
    await client.query('BEGIN')

    // 1. Find the document (by path or id)
    const docWithRoute = await findDocument(client, normalized)

    if (!docWithRoute) {
      await client.query('COMMIT')
      return null
    }

    // 2. Filter by published status if specified
    if (options.published !== undefined) {
      if (docWithRoute.published !== options.published) {
        await client.query('COMMIT')
        return null
      }
    }

    // 3. Determine if this is a redirect (only for path queries)
    const isRedirect = normalized.path !== undefined ? docWithRoute.redirect : false

    // 4. Build the DualDocument result
    const result: DualDocument = {
      id: docWithRoute.id as DocumentId,
      path: docWithRoute.route.path,
      redirect: isRedirect,
      published: docWithRoute.published,
    }

    // 5. Fetch current (published) record if it exists
    if (docWithRoute.current_record_id) {
      const currentInstance = await getDocumentInstance(client, docWithRoute.id as DocumentId, 'current')
      if (currentInstance) {
        result.current = currentInstance
      }
    }

    // 6. Fetch draft record if it exists and draft option is true
    if (docWithRoute.draft_record_id && options.draft) {
      const draftInstance = await getDocumentInstance(client, docWithRoute.id as DocumentId, 'draft')
      if (draftInstance) {
        result.draft = draftInstance
      }
    }

    await client.query('COMMIT')

    // Return null if no records were found
    if (!result.current && !result.draft) {
      return null
    }

    return result
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  }
}
