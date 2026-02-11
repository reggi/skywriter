import type {DocumentQuery, DualDocument, RenderDocument, RenderDocumentGetOptions, DbOperation} from './types.ts'
import {getDualDocument} from './getDualDocument.ts'
import {getRenderDocumentWithAssociations} from './getRenderDocumentWithAssociations.ts'

/**
 * Single Doc, unlike `getDualDocument`, always returns ONE document with its associated redirects and uploads.
 * Returns the document, its redirects, and uploads.
 * Prioritizes draft version if available, otherwise returns current version.
 *
 * @param client Database client
 * @param query Query to find the document (by id or path)
 * @param options Options including includeSlot and includeTemplate to populate slot/template documents
 * @returns RenderDocument with merged content, redirects, and uploads
 */
export const getRenderDocument: DbOperation<
  [DocumentQuery & {dualDocument?: DualDocument}, RenderDocumentGetOptions?],
  RenderDocument | null
> = async (client, query, options) => {
  let document: DualDocument | null
  if (query.dualDocument) {
    document = query.dualDocument
  } else {
    document = await getDualDocument(client, query, options)
  }
  if (!document) {
    return null
  }

  // Use shared utility to build the full RenderDocument with all associations
  return await getRenderDocumentWithAssociations(client, document, options)
}
