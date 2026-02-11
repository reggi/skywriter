import type {SearchOptions, SearchResult, DocumentId, DbOperation} from './types.ts'

/**
 * Search documents by path and title with template/slot usage ranking
 *
 * This function searches documents based on:
 * - Case-insensitive LIKE pattern matching on path and title
 * - Orders results by template/slot usage frequency (most used first)
 * - Falls back to creation date for documents not used as templates/slots
 * - Searches only current records (not drafts)
 *
 * The search prioritizes documents that are frequently used as templates or slots
 * in the system, making it easier to discover commonly reused components.
 *
 * @param client Database client
 * @param options Search options (query, limit, published)
 * @returns Array of SearchResult objects (DocumentCore + title) matching the search query
 */
export const search: DbOperation<[SearchOptions], SearchResult[]> = async (client, options) => {
  const {query, limit = 10, published} = options

  try {
    await client.query('BEGIN')

    // Build parameterized query
    const queryParams: unknown[] = []
    let paramIndex = 1

    // Add search pattern (convert to LIKE pattern with wildcards)
    const searchPattern = `%${query}%`
    queryParams.push(searchPattern) // $1
    const searchPatternParam = `$${paramIndex++}`

    // Add published filter parameter if specified
    const whereClauses: string[] = []
    if (published !== undefined) {
      whereClauses.push(`d.published = $${paramIndex}`)
      queryParams.push(published)
      paramIndex++
    }

    const whereClause = whereClauses.length > 0 ? `AND ${whereClauses.join(' AND ')}` : ''

    // Add limit parameter
    queryParams.push(limit) // Last parameter
    const limitParam = `$${paramIndex}`

    // Query with CTE to count template/slot usage
    // Orders by usage count (DESC, nulls last) then by created_at (DESC)
    // Note: template_id and slot_id now reference documents.id (not document_records.id)
    const searchQuery = `
      WITH usage_counts AS (
        SELECT 
          template_id as document_id,
          COUNT(*) as usage_count
        FROM document_records
        WHERE template_id IS NOT NULL
        GROUP BY template_id
        
        UNION ALL
        
        SELECT 
          slot_id as document_id,
          COUNT(*) as usage_count
        FROM document_records
        WHERE slot_id IS NOT NULL
        GROUP BY slot_id
      ),
      aggregated_usage AS (
        SELECT 
          document_id,
          SUM(usage_count) as total_usage
        FROM usage_counts
        GROUP BY document_id
      )
      SELECT 
        d.id,
        d.path_id,
        d.current_record_id,
        d.draft_record_id,
        d.published,
        d.created_at,
        d.updated_at,
        r.path,
        dr.title,
        COALESCE(au.total_usage, 0) as usage_count
      FROM documents d
      JOIN routes r ON r.id = d.path_id
      LEFT JOIN document_records dr ON dr.id = d.current_record_id
      LEFT JOIN aggregated_usage au ON au.document_id = d.id
      WHERE (
        r.path ILIKE ${searchPatternParam}
        OR dr.title ILIKE ${searchPatternParam}
      )
      ${whereClause}
      ORDER BY au.total_usage DESC NULLS LAST, d.created_at DESC
      LIMIT ${limitParam}
    `

    const searchResult = await client.query<{
      id: number
      path_id: number
      current_record_id: number | null
      draft_record_id: number | null
      published: boolean
      created_at: Date
      updated_at: Date
      path: string
      title: string | null
      usage_count: string
    }>(searchQuery, queryParams)

    // Map results directly from query (title is already in the result)
    const results: SearchResult[] = searchResult.rows
      .filter(row => row.current_record_id !== null && row.title !== null) // Only include docs with current record and title
      .map(row => ({
        id: row.id as DocumentId,
        path: row.path,
        redirect: false,
        published: row.published,
        title: row.title as string,
      }))

    await client.query('COMMIT')
    return results
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  }
}
