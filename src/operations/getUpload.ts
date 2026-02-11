import type {Upload, DocumentQuery, DbOperation} from './types.ts'
import {normalizeDocumentQuery} from './utils/common.ts'
import {findDocument} from './findDocument.ts'

/**
 * Options for getUpload
 */
interface GetUploadOptions {
  /** Filter by published status of the document */
  published?: boolean
  /** Include hidden uploads (default: false) */
  includeHidden?: boolean
}

/**
 * Gets a single upload by document and original filename
 *
 * This function retrieves a specific upload by identifying the document and matching the original filename.
 * By default, hidden uploads are excluded unless includeHidden is true.
 *
 * @param client Database client
 * @param query Document query (supports path string, id number, OptimisticDocument, Route, etc.)
 * @param original_filename The original filename to search for (matches against the `original_filename` column)
 * @param options Options for filtering by published status and hidden visibility
 * @returns Upload object if found, null if not found or document doesn't exist
 */
export const getUpload: DbOperation<[DocumentQuery, string, GetUploadOptions?], Upload | null> = async (
  client,
  query,
  original_filename,
  options,
) => {
  const normalizedQuery = normalizeDocumentQuery(query)
  const {includeHidden = false, published} = options || {}

  // Verify document exists
  const document = await findDocument(client, normalizedQuery, {published})

  if (!document) {
    return null
  }

  const documentId = document.id

  // Build WHERE clause
  const whereClauses = ['document_id = $1', 'original_filename = $2']
  const params: unknown[] = [documentId, original_filename]

  if (!includeHidden) {
    whereClauses.push('hidden = false')
  }

  // Get the specific upload for this document with the given filename
  const result = await client.query<Upload>(
    `SELECT id, filename, document_id, created_at, original_filename, hidden, hash
       FROM uploads
       WHERE ${whereClauses.join(' AND ')}
       LIMIT 1`,
    params,
  )

  return result.rows[0] || null
}
