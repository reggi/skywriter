import type {DualDocument, DocumentManyQuery, DocumentId, DbOperation} from './types.ts'
import {getDocumentInstance} from './getDocumentInstance.ts'

/**
 * Gets multiple documents based on query options
 *
 * This function retrieves multiple documents with support for:
 * - Sorting by various fields (created_at, updated_at, title, path)
 * - Filtering by published status
 * - Filtering by path prefix
 * - Pagination (limit/offset)
 * - Optional draft version retrieval
 *
 * Query Options:
 * - sortBy: Field to sort by (default: 'created_at')
 * - sortOrder: Sort direction 'asc' or 'desc' (default: 'desc')
 * - published: Filter by published status (true/false/undefined for all)
 * - draft: Include draft versions (default: false)
 * - limit: Maximum number of results (default: undefined - no limit)
 * - offset: Number of results to skip (default: 0)
 * - startsWithPath: Filter documents whose path starts with this string (e.g., '/blog/')
 *
 * @param client Database client
 * @param options Query options for filtering, sorting, and pagination
 * @returns Array of DualDocument objects
 */
export const getDualDocuments: DbOperation<[DocumentManyQuery?], DualDocument[]> = async (client, options = {}) => {
  const {
    sortBy = 'created_at',
    sortOrder = 'desc',
    published,
    draft = false,
    limit,
    offset = 0,
    startsWithPath,
  } = options

  try {
    await client.query('BEGIN')

    // Build the WHERE clause for published filter
    const whereClauses: string[] = []
    const queryParams: unknown[] = []
    let paramIndex = 1

    if (published !== undefined) {
      whereClauses.push(`d.published = $${paramIndex}`)
      queryParams.push(published)
      paramIndex++
    }

    if (startsWithPath !== undefined) {
      whereClauses.push(`r.path LIKE $${paramIndex}`)
      queryParams.push(`${startsWithPath}%`)
      paramIndex++
    }

    const whereClause = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : ''

    // Determine the ORDER BY field
    let orderByField: string
    switch (sortBy) {
      case 'created_at':
        orderByField = 'd.created_at'
        break
      case 'updated_at':
        orderByField = 'd.updated_at'
        break
      case 'title':
        orderByField = 'dr.title'
        break
      case 'path':
        orderByField = 'r.path'
        break
      default:
        orderByField = 'd.created_at'
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

    // Query documents with their canonical routes and current record info for sorting
    const documentsQuery = `
      SELECT 
        d.id,
        d.path_id,
        d.current_record_id,
        d.draft_record_id,
        d.published,
        d.created_at,
        d.updated_at,
        r.path,
        dr.title
      FROM documents d
      JOIN routes r ON r.id = d.path_id
      LEFT JOIN document_records dr ON dr.id = d.current_record_id
      ${whereClause}
      ORDER BY ${orderByField} ${sortOrder.toUpperCase()}
      ${limitClause}
    `

    const documentsResult = await client.query<{
      id: number
      path_id: number
      current_record_id: number | null
      draft_record_id: number | null
      published: boolean
      created_at: Date
      updated_at: Date
      path: string
      title: string | null
    }>(documentsQuery, queryParams)

    // Build result array
    const results: DualDocument[] = []

    for (const document of documentsResult.rows) {
      const result: DualDocument = {
        id: document.id as DocumentId,
        path: document.path,
        redirect: false, // getMany only returns canonical documents
        published: document.published,
      }

      // Fetch current record if it exists
      if (document.current_record_id) {
        const currentInstance = await getDocumentInstance(client, document.id as DocumentId, 'current')
        if (currentInstance) {
          result.current = currentInstance
        }
      }

      // Fetch draft record if it exists and draft option is true
      if (document.draft_record_id && draft) {
        const draftInstance = await getDocumentInstance(client, document.id as DocumentId, 'draft')
        if (draftInstance) {
          result.draft = draftInstance
        }
      }

      // Only include documents that have at least one record
      if (result.current || result.draft) {
        results.push(result)
      }
    }

    await client.query('COMMIT')
    return results
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  }
}
