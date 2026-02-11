import type {Route, DocumentQuery, DocumentId} from '../types.ts'

/**
 * Helper: Normalize DocumentQuery to standard {id?: number, path?: string} format
 */
export function normalizeDocumentQuery(query: DocumentQuery | {id?: DocumentId; path?: string}): {
  id?: DocumentId
  path?: string
} {
  // string => path
  if (typeof query === 'string') return {path: query}

  // number => id
  if (typeof query === 'number') return {id: query}

  // object shapes
  if (query && typeof query === 'object') {
    // Route => use document_id (ignore route.id)
    if ('document_id' in query && typeof (query as Route).document_id === 'number') {
      return {id: (query as Route).document_id as DocumentId}
    }

    const queryWithId = query as {id?: DocumentId}
    const queryWithPath = query as {path?: string}
    const hasId = 'id' in query && typeof queryWithId.id === 'number'
    const hasPath = 'path' in query && typeof queryWithPath.path === 'string'

    // DualDocument (has both id and path) => prefer id
    if (hasId && hasPath) {
      return {id: queryWithId.id as DocumentId}
    }
    if (hasId) return {id: queryWithId.id as DocumentId}
    if (hasPath) return {path: queryWithPath.path as string}

    // Fallback: handle objects with non-standard types or empty objects
    const result: {id?: DocumentId; path?: string} = {}
    if ('id' in query && queryWithId.id !== undefined && queryWithId.id !== null) {
      result.id = queryWithId.id
    }
    if ('path' in query && queryWithPath.path !== undefined && queryWithPath.path !== null) {
      result.path = queryWithPath.path
    }

    // If both are present (e.g., OptimisticDocument), prefer id
    if (result.id !== undefined && result.path !== undefined) {
      return {id: result.id}
    }

    return result
  }

  throw new Error('Invalid DocumentQuery format')
}
