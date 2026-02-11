import type {DocumentQuery, DbOperation} from './types.ts'
import {normalizeDocumentQuery} from './utils/common.ts'
import {findDocument} from './findDocument.ts'

/**
 * Removes a document and all associated data
 *
 * This function permanently deletes:
 * - The document itself
 * - All routes pointing to the document (CASCADE via document_id FK)
 * - All uploads associated with the document (CASCADE via document_id FK)
 * - All document records (current and draft versions) via manual cleanup
 *
 * The operation is performed in a transaction to ensure consistency.
 * If any part fails, all changes are rolled back.
 *
 * @param client Database client
 * @param query Document identifier (path, id, or object)
 * @returns true if document was removed, false if not found
 */
export const removeDocument: DbOperation<[DocumentQuery], boolean> = async (client, query) => {
  const normalizedQuery = normalizeDocumentQuery(query)

  try {
    await client.query('BEGIN')

    // Find the document
    const document = await findDocument(client, normalizedQuery)

    if (!document) {
      await client.query('COMMIT')
      return false
    }

    const documentId = document.id

    // Get document to find associated records for cleanup
    const docResult = await client.query(`SELECT current_record_id, draft_record_id FROM documents WHERE id = $1`, [
      documentId,
    ])

    const {current_record_id, draft_record_id} = docResult.rows[0]

    // Delete the document itself
    // This will CASCADE delete uploads and routes via their document_id FK
    await client.query(`DELETE FROM documents WHERE id = $1`, [documentId])

    // Clean up orphaned document records
    // These are no longer referenced by any document after the delete above
    const recordIds = [current_record_id, draft_record_id].filter(id => id !== null)
    if (recordIds.length > 0) {
      await client.query(`DELETE FROM document_records WHERE id = ANY($1::int[])`, [recordIds])
    }

    await client.query('COMMIT')
    return true
    /* node:coverage disable */
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  }
  /* node:coverage enable */
}
