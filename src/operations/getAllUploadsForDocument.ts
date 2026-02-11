import type {Upload, DbOperation, DocumentId} from './types.ts'

/**
 * Internal helper to get ALL uploads for a document by document ID (including hidden).
 * Used internally for collision checking when adding/updating uploads.
 *
 * @param client Database client
 * @param documentId The document ID
 * @returns Array of all Upload objects (including hidden), or empty array if none found
 */
export const getAllUploadsForDocument: DbOperation<[DocumentId], Upload[]> = async (client, documentId) => {
  const result = await client.query<Upload>(
    `SELECT id, filename, document_id, created_at, original_filename, hidden, hash
     FROM uploads
     WHERE document_id = $1`,
    [documentId],
  )
  return result.rows
}
