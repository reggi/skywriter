import type {MiddlewareHandler} from 'hono'
import type {PoolClient} from 'pg'

export type AppMiddleware = MiddlewareHandler<AppContext>

export type AppMiddlewareFactory<T extends unknown[]> = (...args: T) => AppMiddleware

export type AppContext = {
  Variables: {
    client: PoolClient
    isAuthenticated: boolean
    userId: number
    username: string
    docPath?: string
    pathMatch?: RegExpMatchArray
    allowSignup?: boolean
    uploadsPath: string
    gitReposPath: string
  }
}
