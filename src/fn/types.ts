import type {DocumentQuery, RenderDocumentsManyQuery, Upload, UploadsManyQuery} from '../operations/types.ts'
import type {RenderedDoc} from '../render/utils/base.ts'

/**
 * Shared interface for all function context implementations.
 * Implemented by:
 * - functionContext.ts (DB-backed, server-side)
 * - functionContextClient.ts (API client, makes HTTP requests)
 * - functionContextFs.ts (filesystem-backed, reads local pages)
 */
export interface FunctionContext {
  getPage: (query: DocumentQuery) => Promise<RenderedDoc | null>
  getPages: (options?: RenderDocumentsManyQuery) => Promise<RenderedDoc[]>
  getUploads: (options?: UploadsManyQuery & {path?: string}) => Promise<Upload[]>
}
