import type {DualDocument, DocumentQuery, DbOperation} from './types.ts'
import {normalizeDocumentQuery} from './utils/common.ts'
import {findDocument} from './findDocument.ts'
import {getOptimisticDocument} from './getOptimisticDocument.ts'

/**
 * Clears the draft version of a document, reverting to the published version
 *
 * This function:
 * - Finds the document by id or path
 * - Deletes the draft record if it exists
 * - Sets draft_record_id to NULL
 * - Returns the document with only the current version
 *
 * @param client Database client
 * @param query Query to find the document (by id or path)
 * @returns DualDocument with only the current version
 * @throws Error if document not found
 */
export const clearDraft: DbOperation<[DocumentQuery], DualDocument> = async (client, query) => {
  try {
    await client.query('BEGIN')

    // 1. Find the document
    const normalizedQuery = normalizeDocumentQuery(query)
    const existingDoc = await findDocument(client, normalizedQuery)

    if (!existingDoc) {
      throw new Error('Document not found')
    }

    const document = existingDoc

    // 2. If there's no draft, just return the document as-is
    if (!document.draft_record_id) {
      await client.query('COMMIT')
      return await getOptimisticDocument(client, document)
    }

    // 3. If there's no current version, we can't clear the draft (would leave document empty)
    if (!document.current_record_id) {
      await client.query('COMMIT')
      // Return the document as-is - can't revert to nothing
      return await getOptimisticDocument(client, document)
    }

    const draftRecordId = document.draft_record_id

    // 4. Clear the draft reference in the document
    await client.query(`UPDATE documents SET draft_record_id = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = $1`, [
      document.id,
    ])

    // 5. Delete the draft record
    await client.query(`DELETE FROM document_records WHERE id = $1`, [draftRecordId])

    document.draft_record_id = null

    await client.query('COMMIT')

    // 6. Fetch and return the complete document (now without draft)
    return await getOptimisticDocument(client, document)
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  }
}
