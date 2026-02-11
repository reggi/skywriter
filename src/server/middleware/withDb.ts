import type {PoolClient} from 'pg'
import type {AppMiddlewareFactory} from '../utils/types.ts'

export const withDb: AppMiddlewareFactory<[client: PoolClient]> = client => {
  return async (c, next) => {
    c.set('client', client)
    return next()
  }
}
