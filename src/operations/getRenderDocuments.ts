import type {RenderDocument, RenderDocumentsManyQuery, DbOperation} from './types.ts'
import {getDualDocuments} from './getDualDocuments.ts'
import {getRenderDocumentWithAssociations} from './getRenderDocumentWithAssociations.ts'

/**
 * Gets multiple documents with their associated redirects and uploads
 *
 * This function retrieves multiple documents with support for:
 * - All features from getDualDocuments (sorting, filtering, pagination)
 * - Includes redirects and uploads for each document
 * - Optionally includes slot and template documents
 * - Returns merged content (prioritizes draft over current)
 *
 * @param client Database client
 * @param options Query options for filtering, sorting, and pagination
 * @returns Array of RenderDocument objects with redirects and uploads
 */
export const getRenderDocuments: DbOperation<[RenderDocumentsManyQuery?], RenderDocument[]> = async (
  client,
  options = {},
) => {
  // Get all documents
  const documents = await getDualDocuments(client, options)

  // For each document, use the shared utility to build the full RenderDocument
  const results = await Promise.all(
    documents.map(async document => {
      return await getRenderDocumentWithAssociations(client, document, options)
    }),
  )
  return results
}
