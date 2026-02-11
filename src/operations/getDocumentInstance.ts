import type {DocumentId, DocumentInstance, DbOperation} from './types.ts'

/**
 * Helper: Get a DocumentInstance (current or draft) by document ID
 * This query joins documents, routes, and document_records to build the complete instance
 */
export const getDocumentInstance: DbOperation<[DocumentId, 'current' | 'draft'], DocumentInstance | null> = async (
  client,
  documentId,
  recordType,
) => {
  const recordColumn = recordType === 'current' ? 'current_record_id' : 'draft_record_id'

  const result = await client.query<{
    id: number
    path: string
    title: string
    content: string
    data: string
    style: string
    script: string
    server: string
    template_id: number | null
    slot_id: number | null
    content_type: string
    data_type: string | null
    has_eta: boolean
    mime_type: string
    extension: string
    published: boolean
    created_at: Date
    updated_at: Date
  }>(
    `SELECT 
      d.id,
      r.path,
      dr.title,
      dr.content,
      dr.data,
      dr.style,
      dr.script,
      dr.server,
      dr.template_id,
      dr.slot_id,
      dr.content_type,
      dr.data_type,
      dr.has_eta,
      dr.mime_type,
      dr.extension,
      d.published,
      d.created_at,
      d.updated_at
    FROM documents d
    JOIN routes r ON d.path_id = r.id
    JOIN document_records dr ON d.${recordColumn} = dr.id
    WHERE d.id = $1`,
    [documentId],
  )

  return result.rows.length > 0 ? (result.rows[0] as DocumentInstance) : null
}
