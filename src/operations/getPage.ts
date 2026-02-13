import type {DocumentQuery, DbOperation} from './types.ts'
import type {functionContext} from '../fn/functionContext.ts'
import {getRenderDocument} from './getRenderDocument.ts'
import {render} from '../render/index.ts'

/**
 * Get a single page with rendering
 * Fetches a document and renders it with the provided function context
 *
 * @param client Database client
 * @param query Query to find the document (by id or path)
 * @param requestQuery Optional request query parameters
 * @param fn Function context factory for nested rendering
 * @returns Rendered document or null if not found
 */
export const getPage: DbOperation<
  [DocumentQuery, Record<string, string> | undefined, typeof functionContext],
  Awaited<ReturnType<typeof render>> | null
> = async (client, query, requestQuery, fn) => {
  const renderDocument = await getRenderDocument(client, query, {
    includeRedirects: false,
    includeUploads: false,
    includeSlot: true,
    includeTemplate: true,
    draft: false,
  })

  if (!renderDocument) {
    return null
  }

  const safeQuery = requestQuery || {}

  const _render = await render(renderDocument, {
    fn: fn(client, renderDocument, safeQuery),
    query: safeQuery,
  })
  return _render
}
