import type {MiddlewareHandler} from 'hono'
import {responder} from '../../responder/index.ts'
import type {AppContext} from '../utils/types.ts'
import {NotFoundError} from '../utils/NotFoundError.ts'
import {render} from '../../render/index.ts'
import {functionContext} from '../../fn/functionContext.ts'
import {getRenderDocument} from '../../operations/getRenderDocument.ts'

export const documents: MiddlewareHandler<AppContext> = async (c, next) => {
  const client = c.get('client')
  const path = c.req.path
  const isAuthenticated = c.get('isAuthenticated') || false

  try {
    return await responder({
      path,
      getRender: doc => {
        return render(doc, {
          fn: functionContext(client, doc, c.req.query()),
          query: c.req.query(),
        })
      },
      getDocument: async ({path}) => {
        const doc = await getRenderDocument(
          client,
          {path},
          {
            ...(isAuthenticated ? {draft: true} : {published: true}),
            includeSlot: true,
            includeTemplate: true,
          },
        )
        if (doc) return doc
        throw new NotFoundError('Document not found')
      },
    })
  } catch (error) {
    if (error instanceof NotFoundError) {
      return next()
    } else {
      throw error
    }
  }
}
