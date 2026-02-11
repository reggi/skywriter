import type {Document, DualDocument, DbOperation} from './types.ts'
import {getDocumentInstance} from './getDocumentInstance.ts'

/**
 * Helper: Get the complete DualDocument with current and draft records
 */
export const getOptimisticDocument: DbOperation<[Document], DualDocument> = async (client, document) => {
  // Fetch the canonical path
  const pathResult = await client.query<{path: string}>(`SELECT path FROM routes WHERE id = $1`, [document.path_id])
  const canonicalPath = pathResult.rows[0].path

  const result: DualDocument = {
    id: document.id,
    path: canonicalPath,
    published: document.published,
  }

  // Fetch current record if it exists
  if (document.current_record_id) {
    const currentInstance = await getDocumentInstance(client, document.id, 'current')
    if (currentInstance) {
      result.current = currentInstance
    }
  }

  // Fetch draft record if it exists
  if (document.draft_record_id) {
    const draftInstance = await getDocumentInstance(client, document.id, 'draft')
    if (draftInstance) {
      result.draft = draftInstance
    }
  }

  return result
}
