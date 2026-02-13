import {readdir, stat} from 'node:fs/promises'
import {join} from 'node:path'
import type {
  DocumentQuery,
  RenderDocumentsManyQuery,
  Upload,
  UploadId,
  UploadsManyQuery,
  DocumentId,
} from '../operations/types.ts'
import type {DiscoveryResult} from '../cli/middleware/types.ts'
import type {FunctionContext} from './types.ts'
import type {RenderedDoc} from '../render/utils/base.ts'
import {assemble} from '../cli/utils/assemble.ts'
import {render} from '../render/index.ts'

/**
 * Resolve a DocumentQuery to a path string
 */
function resolveQueryPath(query: DocumentQuery): string | null {
  if (typeof query === 'string') return query
  if (typeof query === 'number') return null
  if ('path' in query && query.path) return query.path
  return null
}

/**
 * Create a resolveDocumentPath function from a DiscoveryResult
 */
function createResolver(discovery: DiscoveryResult) {
  return async (path: string): Promise<string | null> => {
    const doc = discovery.documents.get(path)
    return doc?.fsPath ?? null
  }
}

/**
 * Scan a local uploads/ directory and return Upload objects
 */
async function scanUploads(fsPath: string): Promise<Upload[]> {
  const uploadsDir = join(fsPath, 'uploads')
  try {
    const files = await readdir(uploadsDir)
    const uploads: Upload[] = []
    for (const filename of files) {
      if (filename.startsWith('.')) continue
      const fileStat = await stat(join(uploadsDir, filename)).catch(() => null)
      if (!fileStat || !fileStat.isFile()) continue
      uploads.push({
        id: 0 as UploadId,
        filename,
        document_id: 0 as DocumentId,
        created_at: fileStat.mtime,
        original_filename: filename,
        hidden: false,
        hash: '',
      })
    }
    return uploads
  } catch {
    return []
  }
}

/**
 * Filesystem-based function context that reads pages from local discovery.
 * Drop-in replacement for functionContextClient when serving locally.
 */
export const functionContextFs = (getDiscovery: () => DiscoveryResult): FunctionContext => {
  return {
    getPage: async (query: DocumentQuery) => {
      const path = resolveQueryPath(query)
      if (!path) return null
      const discovery = getDiscovery()
      const doc = discovery.documents.get(path)
      if (!doc) return null
      const resolveDocumentPath = createResolver(discovery)
      const document = await assemble(doc.fsPath, {resolveDocumentPath})
      return await render(document)
    },

    getPages: async (options?: RenderDocumentsManyQuery) => {
      const discovery = getDiscovery()
      let paths = discovery.sortedPaths

      // Filter by startsWithPath
      if (options?.startsWithPath) {
        paths = paths.filter(p => p.startsWith(options.startsWithPath!))
      }

      // Filter by excludePaths
      if (options?.excludePaths && options.excludePaths.length > 0) {
        const excluded = new Set(options.excludePaths)
        paths = paths.filter(p => !excluded.has(p))
      }

      const resolveDocumentPath = createResolver(discovery)

      // Assemble and render all matching documents
      const rendered = []
      for (const path of paths) {
        const info = discovery.documents.get(path)
        if (!info) continue
        try {
          const doc = await assemble(info.fsPath, {resolveDocumentPath})
          rendered.push(await render(doc))
        } catch {
          // Skip documents that fail to assemble
        }
      }

      // Sort
      if (options?.sortBy) {
        const order = options.sortOrder === 'desc' ? -1 : 1
        const getSortValue = (doc: RenderedDoc): string | Date | undefined => {
          switch (options.sortBy) {
            case 'created_at':
              return doc.meta.createdAt
            case 'updated_at':
              return doc.meta.updatedAt
            case 'title':
              return doc.title
            case 'path':
              return doc.path
            default:
              return undefined
          }
        }
        rendered.sort((a, b) => {
          const aVal = getSortValue(a)
          const bVal = getSortValue(b)
          if (aVal instanceof Date && bVal instanceof Date) {
            return (aVal.getTime() - bVal.getTime()) * order
          }
          if (typeof aVal === 'string' && typeof bVal === 'string') {
            return aVal.localeCompare(bVal) * order
          }
          return 0
        })
      }

      // Pagination
      const offset = options?.offset ?? 0
      const limit = options?.limit ?? rendered.length
      return rendered.slice(offset, offset + limit)
    },

    getUploads: async (options?: UploadsManyQuery & {path?: string}) => {
      const discovery = getDiscovery()
      let uploads: Upload[] = []

      if (options?.path) {
        const doc = discovery.documents.get(options.path)
        if (doc) {
          uploads = await scanUploads(doc.fsPath)
        }
      } else {
        // Scan all documents for uploads
        for (const [, doc] of discovery.documents) {
          const docUploads = await scanUploads(doc.fsPath)
          uploads.push(...docUploads)
        }
      }

      // Sort
      if (options?.sortBy) {
        const order = options.sortOrder === 'desc' ? -1 : 1
        uploads.sort((a, b) => {
          const aVal = a[options.sortBy!]
          const bVal = b[options.sortBy!]
          if (aVal instanceof Date && bVal instanceof Date) {
            return (aVal.getTime() - bVal.getTime()) * order
          }
          if (typeof aVal === 'string' && typeof bVal === 'string') {
            return aVal.localeCompare(bVal) * order
          }
          return 0
        })
      }

      // Pagination
      const offset = options?.offset ?? 0
      const limit = options?.limit ?? uploads.length
      return uploads.slice(offset, offset + limit)
    },
  }
}
