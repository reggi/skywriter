import type {AppMiddlewareFactory} from '../utils/types.ts'
import {validateSession} from '../../operations/validateSession.ts'
import {login} from '../../operations/login.ts'

export const establishAuth: AppMiddlewareFactory<[]> = () => {
  return async (c, next) => {
    const client = c.get('client')
    // Check for session cookie
    const sessionId = c.req.header('cookie')?.match(/session_id=([^;]+)/)?.[1]

    if (sessionId) {
      // Validate session against database
      const validation = await validateSession(client, sessionId)

      if (validation.valid) {
        // Set user info in context for all routes to use
        c.set('isAuthenticated', true)
        c.set('userId', validation.user_id!)
        c.set('username', validation.username!)
      }
    }

    // If no session cookie, check for Basic Auth header
    if (!c.get('isAuthenticated')) {
      const authHeader = c.req.header('Authorization')

      if (authHeader?.startsWith('Basic ')) {
        // Decode base64 credentials
        const base64Credentials = authHeader.substring(6)
        const credentials = Buffer.from(base64Credentials, 'base64').toString('utf-8')
        const [username, password] = credentials.split(':')

        if (username && password) {
          try {
            // Use login to authenticate
            const user = await login(client, {username, password})

            // Set user info in context
            c.set('userId', user.id)
            c.set('username', user.username)
            c.set('isAuthenticated', true)
          } catch {
            // Invalid credentials - but don't fail here, let route protection handle it
            // This allows Basic Auth to be optional
          }
        }
      }
    }

    await next()
  }
}
