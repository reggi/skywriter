import type {AppMiddlewareFactory} from '../utils/types.ts'

export const log: AppMiddlewareFactory<[]> = () => {
  return async (c, next) => {
    const response = await next()

    const method = c.req.method
    const path = c.req.path
    const isAuthenticated = c.get('isAuthenticated') || false
    const username = c.get('username') || 'anonymous'

    console.log(`${method} ${path} - ${isAuthenticated ? `✓ ${username}` : '✗ unauthenticated'}`)

    return response
  }
}
