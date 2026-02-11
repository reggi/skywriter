import type {Route, DocumentQuery, DbOperation} from './types.ts'
import {normalizeDocumentQuery} from './utils/common.ts'
import {findDocument} from './findDocument.ts'

/**
 * Gets all redirect paths for a specific document
 *
 * This function retrieves all non-canonical paths (redirects) that point to a document.
 * It excludes the canonical path (where route.id === document.path_id).
 *
 * @param client Database client
 * @param query Document query (supports path string, id number, OptimisticDocument, Route, etc.)
 * @returns Array of Route objects representing redirects, or empty array if none found
 */
export const getRedirects: DbOperation<[DocumentQuery], Route[]> = async (client, query) => {
  const normalizedQuery = normalizeDocumentQuery(query)

  // Find the document and its canonical path_id
  const document = await findDocument(client, normalizedQuery)

  if (!document) {
    return []
  }

  const documentId = document.id
  const {path_id} = document

  // Get all routes for this document except the canonical one
  const result = await client.query<Route>(
    `SELECT r.id, r.path, r.document_id, r.created_at
       FROM routes r
       JOIN documents d ON r.document_id = d.id
       WHERE r.document_id = $1 AND r.id != $2
       ORDER BY r.created_at DESC`,
    [documentId, path_id],
  )

  return result.rows
}
