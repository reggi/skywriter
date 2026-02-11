import type {AppMiddlewareFactory} from '../utils/types.ts'

export const authorize: AppMiddlewareFactory<[basicRealm: string]> = basicRealm => {
  return async (c, next) => {
    if (c.get('isAuthenticated')) {
      return next()
    }

    const headers = {
      'WWW-Authenticate': `Basic realm="${basicRealm}"`,
    }

    if (c.req.method === 'GET') {
      return c.text('', 401, headers)
    }

    return c.json({error: 'Authentication required'}, 401, headers)
  }
}
