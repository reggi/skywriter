import type {DocumentRecord, DbOperation} from './types.ts'
import {contentType, hasEtaTemplates, dataType} from './utils/utils.ts'

/**
 * Helper: Create a new document record
 */
export const createDocumentRecord: DbOperation<
  [Partial<{[K in keyof DocumentRecord]: DocumentRecord[K] | null}>, (DocumentRecord | null)?],
  DocumentRecord
> = async (client, input, baseRecord) => {
  // Merge input with base record (if provided), preferring input values
  const content = input.content !== undefined ? (input.content ?? '') : (baseRecord?.content ?? '')

  // Auto-detect content_type if not provided
  let finalContentType: string
  if (input.content_type !== undefined && input.content_type !== null) {
    finalContentType = input.content_type
  } else if (baseRecord?.content_type) {
    finalContentType = baseRecord.content_type
  } else {
    // Use utility function to detect content type
    finalContentType = contentType(content)
  }

  // Auto-detect has_eta if not provided
  // Always auto-detect from content unless explicitly provided in input
  // This ensures has_eta stays in sync with content changes
  let finalHasEta: boolean
  if (input.has_eta !== undefined && input.has_eta !== null) {
    finalHasEta = input.has_eta
  } else {
    // Always auto-detect from content (don't inherit from baseRecord)
    finalHasEta = hasEtaTemplates(content)
  }

  // Merge data field
  const dataContent = input.data !== undefined ? (input.data ?? '') : (baseRecord?.data ?? '')

  // Auto-detect data_type and normalize data to JSON
  // Always auto-detect from data unless explicitly provided in input
  // This ensures data_type stays in sync with data changes
  let finalDataType: string | null
  let finalData: string

  if (input.data_type !== undefined) {
    // Explicit data_type provided - use data as-is
    finalDataType = input.data_type
    finalData = dataContent
  } else {
    // Auto-detect and normalize to JSON
    if (dataContent) {
      try {
        const parsed = dataType(dataContent)
        finalDataType = parsed.type
        // Always store as JSON
        finalData = JSON.stringify(parsed.value)
      } catch {
        // If parsing fails, store as-is with null type
        finalDataType = null
        finalData = dataContent
      }
    } else {
      finalDataType = null
      finalData = dataContent
    }
  }

  const data = {
    title: input.title ?? baseRecord?.title ?? '',
    content: content,
    data: finalData,
    style: input.style !== undefined ? (input.style ?? '') : (baseRecord?.style ?? ''),
    script: input.script !== undefined ? (input.script ?? '') : (baseRecord?.script ?? ''),
    server: input.server !== undefined ? (input.server ?? '') : (baseRecord?.server ?? ''),
    template_id: input.template_id !== undefined ? input.template_id : (baseRecord?.template_id ?? null),
    slot_id: input.slot_id !== undefined ? input.slot_id : (baseRecord?.slot_id ?? null),
    content_type: finalContentType,
    data_type: finalDataType,
    has_eta: finalHasEta,
    mime_type: input.mime_type ?? baseRecord?.mime_type ?? 'text/html; charset=UTF-8',
    extension: input.extension ?? baseRecord?.extension ?? '.html',
  }

  const result = await client.query<DocumentRecord>(
    `INSERT INTO document_records (
      title, content, data, style, script, server,
      template_id, slot_id, content_type, data_type, has_eta,
      mime_type, extension
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
    RETURNING *`,
    [
      data.title,
      data.content,
      data.data,
      data.style,
      data.script,
      data.server,
      data.template_id,
      data.slot_id,
      data.content_type,
      data.data_type,
      data.has_eta,
      data.mime_type,
      data.extension,
    ],
  )
  return result.rows[0]
}
