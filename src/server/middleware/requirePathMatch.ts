import type {Context, Next} from 'hono'
import type {AppMiddleware, AppMiddlewareFactory} from '../utils/types.ts'

export const requirePathMatch: AppMiddlewareFactory<[pattern: RegExp, ...handlers: AppMiddleware[]]> = (
  pattern,
  ...handlers
) => {
  return async (c, next) => {
    const match = c.req.path.match(pattern)
    if (!match) {
      return next()
    }

    c.set('pathMatch', match)

    let index = -1
    const dispatch = async (i: number): Promise<Response | void> => {
      if (i <= index) {
        throw new Error('next() called multiple times')
      }
      index = i

      const handler = handlers[i]
      if (!handler) {
        return next()
      }

      return handler(
        c as Context,
        (async () => {
          return dispatch(i + 1)
        }) as unknown as Next,
      )
    }

    return dispatch(0)
  }
}
