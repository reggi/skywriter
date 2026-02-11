import type {Route, DocumentQuery, DbOperation} from './types.ts'
import {normalizeDocumentQuery} from './utils/common.ts'
import {findDocument} from './findDocument.ts'

/**
 * Adds a redirect path to a document
 *
 * This function creates a new route that points to an existing document,
 * creating a redirect from the specified path to the document's canonical path.
 *
 * The path must not already exist in the routes table (enforced by unique constraint).
 * The path must follow routing rules (no leading/trailing underscores, etc.)
 *
 * @param client Database client
 * @param query Document query (supports path string, id number, OptimisticDocument, Route, etc.)
 * @param input Object containing the redirect path
 * @returns The newly created Route object
 * @throws Error if document doesn't exist or path already exists
 */
export const addRedirect: DbOperation<[DocumentQuery, {path: string}], Route> = async (client, query, input) => {
  const normalizedQuery = normalizeDocumentQuery(query)
  const {path} = input

  try {
    await client.query('BEGIN')

    // Verify document exists
    const document = await findDocument(client, normalizedQuery)

    if (!document) {
      throw new Error('Document does not exist')
    }

    const documentId = document.id

    // Insert new route (will trigger path validation and uniqueness check)
    const result = await client.query<Route>(
      `WITH inserted AS (
         INSERT INTO routes (path, document_id)
         VALUES ($1, $2)
         RETURNING id, path, document_id, created_at
       )
       SELECT i.id, i.path, i.document_id, i.created_at
       FROM inserted i
       JOIN documents d ON i.document_id = d.id`,
      [path, documentId],
    )

    await client.query('COMMIT')
    return result.rows[0]
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  }
}
