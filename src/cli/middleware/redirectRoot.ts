import type {CliMiddlewareFactory, DiscoveryGetter} from './types.ts'
import {findDefaultRedirect} from '../utils/discover.ts'

/**
 * Middleware that redirects the root path (/) to the first available document
 * when no root document exists in the discovery result.
 *
 * The redirect preserves any query string from the original request.
 *
 * @param getDiscovery - Getter function for the current discovery result
 * @returns Middleware handler
 *
 * @example
 * ```ts
 * let discovery = await discoverDocuments()
 * app.get('/*', redirectRoot(() => discovery), ...)
 * ```
 */
export const redirectRoot: CliMiddlewareFactory<[getDiscovery: DiscoveryGetter]> = getDiscovery => {
  return async (c, next) => {
    const discovery = getDiscovery()
    const urlPath = c.req.path

    // Only handle root path
    if (urlPath !== '/') {
      return next()
    }

    // If root document exists, continue to next middleware
    if (discovery.documents.has('/')) {
      return next()
    }

    // Find a default redirect target
    const redirectTo = findDefaultRedirect(discovery.sortedPaths)
    if (!redirectTo) {
      return next()
    }

    // Preserve query string in redirect
    const url = new URL(c.req.url)
    const queryString = url.search
    const redirectPath = redirectTo + queryString

    return new Response(null, {
      status: 302,
      headers: {Location: redirectPath},
    })
  }
}
