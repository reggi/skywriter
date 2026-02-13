import type {PoolClient} from 'pg'
import {
  type RenderDocument,
  type DocumentQuery,
  type RenderDocumentsManyQuery,
  type UploadsManyQuery,
} from '../operations/types.ts'
import type {FunctionContext} from './types.ts'
import {getPage} from '../operations/getPage.ts'
import {getPages} from '../operations/getPages.ts'
import {getUploads} from '../operations/getUploads.ts'

export const functionContext = (
  client: PoolClient,
  doc: RenderDocument | {path: string},
  requestQuery?: Record<string, string>,
  renderingPaths?: string[],
): FunctionContext => {
  const safeQuery = requestQuery || {}

  return {
    getPage: async (query: DocumentQuery) => {
      return await getPage(client, query, safeQuery, functionContext)
    },
    getPages: async (options?: RenderDocumentsManyQuery) => {
      const excludePaths = [doc.path, ...(renderingPaths || []), ...(options?.excludePaths || [])]
      return await getPages(client, {...options, excludePaths}, safeQuery, functionContext)
    },
    getUploads: async (options?: UploadsManyQuery & {path?: string}) => {
      const docQuery = options?.path ? {path: options.path} : doc
      return await getUploads(client, docQuery, options)
    },
  }
}
