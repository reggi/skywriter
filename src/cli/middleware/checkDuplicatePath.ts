import type {CliMiddlewareFactory, DiscoveryGetter} from './types.ts'

/**
 * Middleware that checks if a URL path has duplicates in the discovery result.
 * If the path is found in the duplicates map, returns a 500 error.
 *
 * This is important because documents with duplicate paths (e.g., templates/slots
 * reused across multiple documents) cannot be served as standalone pages.
 *
 * @param getDiscovery - Getter function for the current discovery result
 * @returns Middleware handler
 *
 * @example
 * ```ts
 * let discovery = await discoverDocuments()
 * app.get('/*', checkDuplicatePath(() => discovery), ...)
 * ```
 */
export const checkDuplicatePath: CliMiddlewareFactory<[getDiscovery: DiscoveryGetter]> = getDiscovery => {
  return async (c, next) => {
    const discovery = getDiscovery()
    const urlPath = c.req.path

    // Parse the document path from the URL (strip asset suffixes)
    const docPath = parseDocPath(urlPath)

    const duplicatePaths = discovery.duplicates.get(docPath)
    if (duplicatePaths) {
      const locations = duplicatePaths.join('\n  - ')
      const message =
        `Duplicate document path "${docPath}" found in multiple locations:\n  - ${locations}\n\n` +
        `Each document must have a unique path in settings.json. ` +
        `This path may be used as a template/slot in multiple places, but cannot be served as a standalone page.`

      return new Response(message, {
        status: 500,
        headers: {'Content-Type': 'text/plain'},
      })
    }

    return next()
  }
}

/**
 * Parse document path from URL, stripping any asset suffix like ?style or ?script
 */
function parseDocPath(urlPath: string): string {
  // The URL path is the document path - query strings are handled by Hono
  // We just need to handle the path normalization
  return urlPath === '' ? '/' : urlPath
}
