import type {RenderDocumentsManyQuery, DbOperation} from './types.ts'
import type {functionContext} from '../fn/functionContext.ts'
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
  [RenderDocumentsManyQuery | undefined, Record<string, string> | undefined, typeof functionContext],
  Awaited<ReturnType<typeof render>>[]
> = async (client, options, requestQuery, fn) => {
  const renderDocuments = await getRenderDocuments(client, {
    includeRedirects: false,
    includeUploads: false,
    includeSlot: true,
    includeTemplate: true,
    draft: false,
    excludeTemplates: true,
    ...options,
  })

  const safeQuery = requestQuery || {}

  // Collect all paths being rendered plus any already-excluded paths
  // to prevent mutual recursion. When a document's server code calls
  // getPages(), these paths are excluded so documents don't re-render
  // each other in a loop.
  const renderingPaths = [...renderDocuments.map(doc => doc.path), ...(options?.excludePaths || [])]

  // Render all documents in parallel
  const rendered = await Promise.all(
    renderDocuments.map(doc =>
      render(doc, {
        fn: fn(client, doc, safeQuery, renderingPaths),
        query: safeQuery,
      }),
    ),
  )

  return rendered
}
