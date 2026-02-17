import type {AppMiddlewareFactory} from '../utils/types.ts'

/**
 * CSRF protection middleware using Origin header validation.
 * Blocks cross-origin state-changing requests (POST, DELETE, PATCH, PUT)
 * that are authenticated via session cookies.
 * Skips validation for:
 * - Safe methods (GET, HEAD, OPTIONS)
 * - Requests using Basic Auth (CLI/API clients)
 * - Requests with no session cookie (unauthenticated)
 */
export const csrfProtection: AppMiddlewareFactory<[]> = () => {
  return async (c, next) => {
    const method = c.req.method.toUpperCase()

    // Safe methods don't need CSRF protection
    if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
      return next()
    }

    // Only protect cookie-based sessions; Basic Auth is not vulnerable to CSRF
    const authHeader = c.req.header('Authorization')
    if (authHeader?.startsWith('Basic ')) {
      return next()
    }

    // If there's no session cookie, no CSRF risk
    const hasCookie = c.req.header('cookie')?.includes('session_id=')
    if (!hasCookie) {
      return next()
    }

    // Validate that the request origin matches the host
    const origin = c.req.header('Origin')
    const referer = c.req.header('Referer')

    // When Origin or Referer is present we can positively verify same-origin.
    // When neither is present, SameSite=Lax on the session cookie is the
    // primary defense — allow the request through.
    const source = origin || referer
    if (source) {
      const requestHost = c.req.header('Host') || c.req.header('X-Forwarded-Host')
      if (requestHost) {
        try {
          const sourceUrl = new URL(source)
          if (sourceUrl.host !== requestHost) {
            return c.json({error: 'Forbidden: cross-origin request'}, 403)
          }
        } catch {
          return c.json({error: 'Forbidden: invalid Origin'}, 403)
        }
      }
    }

    return next()
  }
}
