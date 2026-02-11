import type {RenderDocumentsManyQuery, DbOperation, FunctionContext} from './types.ts'
import {getRenderDocuments} from './getRenderDocuments.ts'
import {render} from '../render/index.ts'

/**
 * Get multiple pages with rendering
 * Fetches documents and renders them all with the provided function context
 *
 * @param client Database client
 * @param options Query options for filtering, sorting, and pagination
 * @param requestQuery Optional request query parameters
 * @param fn Function context factory for nested rendering
 * @returns Array of rendered documents
 */
export const getPages: DbOperation<
  [RenderDocumentsManyQuery | undefined, Record<string, string> | undefined, FunctionContext],
  Awaited<ReturnType<typeof render>>[]
> = async (client, options, requestQuery, fn) => {
  const renderDocuments = await getRenderDocuments(client, {
    includeRedirects: false,
    includeUploads: false,
    includeSlot: true,
    includeTemplate: true,
    draft: false,
    ...options,
  })

  const safeQuery = requestQuery || {}

  // Render all documents in parallel
  const rendered = await Promise.all(
    renderDocuments.map(doc =>
      render(doc, {
        fn: fn(client, doc, safeQuery),
        query: safeQuery,
      }),
    ),
  )

  return rendered
}
