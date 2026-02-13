import type {Pool, PoolClient} from 'pg'
import type {AppMiddlewareFactory} from '../utils/types.ts'

export const withDb: AppMiddlewareFactory<[pool: Pool]> = pool => {
  return async (c, next) => {
    const client = await pool.connect()
    c.set('client', client)
    try {
      await next()
    } finally {
      client.release()
    }
  }
}
