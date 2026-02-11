import type {DocumentRecord, DbOperation} from './types.ts'

/**
 * Helper: Get a document record by ID
 */
export const getDocumentRecord: DbOperation<[number], DocumentRecord | null> = async (client, recordId) => {
  const result = await client.query<DocumentRecord>(`SELECT * FROM document_records WHERE id = $1`, [recordId])
  return result.rows[0] || null
}
