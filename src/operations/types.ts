import type {PoolClient} from 'pg'

/**
 * Generic type for database operations
 * All database operations follow this pattern: (client: PoolClient, ...args) => Promise<Result>
 */
export type DbOperation<Args extends unknown[] = [], Result = unknown> = (
  client: PoolClient,
  ...args: Args
) => Promise<Result>

export interface Document {
  id: DocumentId
  path_id: RouteId
  current_record_id: number | null
  draft_record_id: number | null
  published: boolean
  created_at: Date
  updated_at: Date
}

export interface DocumentRecord {
  id: number
  title: string
  content: string
  data: string
  style: string
  script: string
  server: string
  template_id: number | null
  slot_id: number | null
  content_type: string
  data_type: string | null
  has_eta: boolean
  mime_type: string
  extension: string
  created_at: Date
  updated_at: Date
}

export interface Route {
  id: RouteId
  path: string
  document_id: DocumentId
  created_at: Date
}

export interface Upload {
  id: UploadId
  filename: string
  document_id: DocumentId | null
  created_at: Date
  original_filename: string
  hidden: boolean
  hash: string
}

export interface UploadsManyQuery {
  sortBy?: 'created_at' | 'original_filename' | 'filename'
  sortOrder?: 'asc' | 'desc'
  limit?: number
  offset?: number
  startsWithPath?: string
}

export interface GetOptions {
  /** Include draft version in response (if exists) */
  draft?: boolean
  /** Filter by published status: true = published only, false = unpublished only, undefined = both (no filter) */
  published?: boolean
}

/**
 * Comprehensive document query type
 * Accepts multiple input formats:
 * - string (path)
 * - {path: string} (path object)
 * - {path?: string} (optional path object, for combined with EditDocumentInput)
 * - number (document id)
 * - {id: number} (id object)
 * - {id?: number} (optional id object, for combined with EditDocumentInput)
 * - DualDocument (extracts id)
 * - Route (extracts document_id)
 *
 * The {id?: DocumentId, path?: string} object form is used for upsert operations
 * when combined with EditDocumentInput.
 */
export type DocumentQuery = string | {path?: string} | DocumentId | {id?: DocumentId} | DualDocument | Route

/**
 * Redirect query type for identifying a redirect route
 * Accepts:
 * - number (redirect/route id)
 * - string (redirect path)
 * - {id: number} (redirect/route id object)
 * - {path: string} (redirect path object)
 */
export type RedirectQuery = RouteId | string | {id: RouteId} | {path: string}

export interface EditDocumentInput {
  path?: string
  title?: string
  content?: string | null
  data?: string | null
  style?: string | null
  script?: string | null
  server?: string | null
  template_id?: DocumentId | null
  slot_id?: DocumentId | null
  content_type?: string | null
  data_type?: string | null
  has_eta?: boolean
  mime_type?: string
  extension?: string
  published?: boolean
  draft?: boolean
}

export interface DocumentInstance {
  id: DocumentId
  path: string
  title: string
  content: string
  data: string
  style: string
  script: string
  server: string
  template_id: DocumentId | null
  slot_id: DocumentId | null
  content_type: string
  data_type: string | null
  has_eta: boolean
  mime_type: string
  extension: string
  published: boolean
  created_at: Date
  updated_at: Date
}

interface DocumentCore {
  id: DocumentId
  path: string
  redirect?: boolean
  published: boolean
}

export interface DualDocument extends DocumentCore {
  current?: DocumentInstance
  draft?: DocumentInstance
}

export type RenderDocumentParts = {
  document: DualDocument
  redirects?: Route[]
  uploads?: Upload[]
}

export type RenderDocument = DocumentCore &
  DocumentInstance & {
    redirects?: Route[]
    uploads?: Upload[]
    draft: boolean
    slot?: RenderDocument
    template?: RenderDocument
  }

declare const __brand: unique symbol

type Branded<T, B> = T & {[__brand]: B}

export type DocumentId = Branded<number, 'DocumentId'>
type RouteId = Branded<number, 'RouteId'>
export type UploadId = Branded<number, 'UploadId'>

export interface DocumentManyQuery {
  sortBy?: 'created_at' | 'updated_at' | 'title' | 'path'
  sortOrder?: 'asc' | 'desc'
  published?: boolean
  draft?: boolean
  limit?: number
  offset?: number
  startsWithPath?: string
}

export interface SearchOptions {
  /** Search query string (case-insensitive LIKE pattern match on path and title) */
  query: string
  /** Maximum number of results (default: 10) */
  limit?: number
  /** Filter by published status: true = only published, false = only unpublished, undefined = both */
  published?: boolean
}

export interface SearchResult extends DocumentCore {
  /** Current document title */
  title: string
}

/**
 * Result of saving a downloaded image as an upload
 */
export interface SavedUpload {
  /** The original foreign image info */
  original: {
    url: string
    match: string
    type: 'html' | 'markdown'
    alt?: string
  }
  /** The new local URL to use */
  localUrl: string
  /** The upload's original_filename */
  originalFilename: string
}

interface RenderDocumentOptions {
  /** Include redirects in response (default: true) */
  includeRedirects?: boolean
  /** Include uploads in response (default: true) */
  includeUploads?: boolean
  /** Include hidden uploads in response (default: false) */
  includeHiddenUploads?: boolean
  /** Include slot document (default: false) */
  includeSlot?: boolean
  /** Include template document (default: false) */
  includeTemplate?: boolean
}

export interface RenderDocumentGetOptions extends GetOptions, RenderDocumentOptions {}

export interface RenderDocumentsManyQuery extends DocumentManyQuery, RenderDocumentOptions {}
