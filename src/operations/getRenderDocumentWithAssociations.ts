import type {DualDocument, RenderDocument, RenderDocumentGetOptions, RenderDocumentParts, DbOperation} from './types.ts'
import {getRedirects} from './getRedirects.ts'
import {getUploads} from './getUploads.ts'
import {getRenderDocument} from './getRenderDocument.ts'

function normalizeRenderDocument(options: RenderDocumentParts): RenderDocument {
  const {current, draft, ...core} = options.document

  /* node:coverage disable */
  if (!draft && !current) {
    throw new Error('Document has neither current nor draft version')
  }
  /* node:coverage enable */

  const result: RenderDocument = {
    ...core,
    ...(draft || current!),
    draft: Boolean(draft),
  }

  // Only include redirects/uploads if they were provided (not undefined)
  if (options.redirects !== undefined) {
    result.redirects = options.redirects
  }
  if (options.uploads !== undefined) {
    result.uploads = options.uploads
  }

  return result
}

/**
 * Build a RenderDocument with all requested associations (redirects, uploads, slot, template)
 * This is shared logic used by both getRenderDocument and getRenderDocuments
 *
 * @param client Database client
 * @param document DualDocument to build from
 * @param options Options specifying what to include
 * @returns Promise<RenderDocument> with all requested associations
 */
export const getRenderDocumentWithAssociations: DbOperation<
  [DualDocument, RenderDocumentGetOptions?],
  RenderDocument
> = async (client, document, options) => {
  // Determine what to include
  const includeRedirects = options?.includeRedirects !== false
  const includeUploads = options?.includeUploads !== false
  const includeHiddenUploads = options?.includeHiddenUploads === true
  const includeSlot = options?.includeSlot === true
  const includeTemplate = options?.includeTemplate === true

  // Determine which record to use for template/slot based on options.draft
  // Fall back to current if draft is requested but doesn't exist
  const useRecord = (options?.draft ? document.draft : document.current) || document.current

  // Fetch all requested associations in parallel
  const [redirects, uploads, slotDocument, templateDocument] = await Promise.all([
    includeRedirects ? getRedirects(client, document) : Promise.resolve(undefined),
    includeUploads ? getUploads(client, document, {includeHidden: includeHiddenUploads}) : Promise.resolve(undefined),
    includeSlot && useRecord?.slot_id
      ? getRenderDocument(client, {id: useRecord.slot_id}, {draft: false, includeSlot: false, includeTemplate: false})
      : Promise.resolve(undefined),
    includeTemplate && useRecord?.template_id
      ? getRenderDocument(
          client,
          {id: useRecord.template_id},
          {draft: false, includeSlot: false, includeTemplate: false},
        )
      : Promise.resolve(undefined),
  ])

  // Build the base render document
  const renderDoc = normalizeRenderDocument({document, redirects, uploads})

  // Add slot and template if they were fetched
  return {
    ...renderDoc,
    slot: slotDocument ?? undefined,
    template: templateDocument ?? undefined,
  }
}
