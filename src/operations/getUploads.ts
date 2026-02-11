import type {Upload, DocumentQuery, UploadsManyQuery, DbOperation} from './types.ts'
import {normalizeDocumentQuery} from './utils/common.ts'
import {findDocument} from './findDocument.ts'

/**
 * Extended query options for uploads including hidden filter
 */
interface UploadsQueryOptions extends UploadsManyQuery {
  /** Include hidden uploads in results (default: false) */
  includeHidden?: boolean
}

/**
 * Gets all uploads for a specific document
 *
 * This function retrieves uploads associated with a document with support for:
 * - Sorting by created_at, original_filename, or filename
 * - Pagination (limit/offset)
 * - Filtering by document path prefix
 * - Filtering hidden uploads (default: excludes hidden)
 *
 * @param client Database client
 * @param query Document query (supports path string, id number, DualDocument, Route, etc.)
 * @param options Query options for filtering, sorting, and pagination
 * @returns Array of Upload objects, or empty array if none found
 */
export const getUploads: DbOperation<[DocumentQuery, UploadsQueryOptions?], Upload[]> = async (
  client,
  query,
  options = {},
) => {
  const {sortBy = 'created_at', sortOrder = 'desc', limit, offset = 0, startsWithPath, includeHidden = false} = options
  const normalizedQuery = normalizeDocumentQuery(query)

  // Verify document exists
  const document = await findDocument(client, normalizedQuery)

  if (!document) {
    return []
  }

  const documentId = document.id

  // Build query with optional path filter
  const whereClauses = ['u.document_id = $1']
  const queryParams: unknown[] = [documentId]
  let paramIndex = 2

  // Filter out hidden uploads unless explicitly requested
  if (!includeHidden) {
    whereClauses.push('u.hidden = false')
  }

  // Add path filter if specified
  if (startsWithPath !== undefined) {
    whereClauses.push(`r.path LIKE $${paramIndex}`)
    queryParams.push(`${startsWithPath}%`)
    paramIndex++
  }

  const whereClause = whereClauses.join(' AND ')

  // Determine ORDER BY field
  let orderByField: string
  switch (sortBy) {
    case 'original_filename':
      orderByField = 'u.original_filename'
      break
    case 'filename':
      orderByField = 'u.filename'
      break
    case 'created_at':
    default:
      orderByField = 'u.created_at'
  }

  // Build LIMIT and OFFSET clauses
  let limitClause = ''
  if (limit !== undefined) {
    limitClause += ` LIMIT $${paramIndex}`
    queryParams.push(limit)
    paramIndex++
  }
  if (offset > 0) {
    limitClause += ` OFFSET $${paramIndex}`
    queryParams.push(offset)
    paramIndex++
  }

  // Get uploads with optional path filter
  const result = await client.query<Upload>(
    `SELECT u.id, u.filename, u.document_id, u.created_at, u.original_filename, u.hidden, u.hash
       FROM uploads u
       JOIN documents d ON d.id = u.document_id
       JOIN routes r ON r.id = d.path_id
       WHERE ${whereClause}
       ORDER BY ${orderByField} ${sortOrder.toUpperCase()}
       ${limitClause}`,
    queryParams,
  )

  return result.rows
}
