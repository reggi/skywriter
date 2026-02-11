/**
 * Shared type for document client state.
 * This is the shape returned by the server from getDocumentClientState
 * and received by the client (parsed from data-state attribute).
 */
export interface DocumentClientState {
  document: {
    id: number
    path: string
    published: boolean
    redirect?: boolean
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
    draft: boolean
    redirects?: Array<{id: number; path: string; document_id?: number | null; created_at?: Date}>
    uploads?: Array<{
      id: number
      filename: string
      original_filename: string
      document_id?: number | null
      created_at?: Date
    }>
    template?: DocumentClientState['document']
    slot?: DocumentClientState['document']
  }
  render: {
    html: string
  }
  api: string[]
  tabs?: {
    content: {hasDraft: boolean; isEmpty: boolean}
    data: {hasDraft: boolean; isEmpty: boolean}
    style: {hasDraft: boolean; isEmpty: boolean}
    script: {hasDraft: boolean; isEmpty: boolean}
    server: {hasDraft: boolean; isEmpty: boolean}
  }
  tabFilenames?: {
    content: string
    data: string
    style: string
    script: string
    server: string
    settings: string
  }
  /** True when content was modified by the server (e.g., foreign images were downloaded) */
  contentModifiedByServer?: boolean
}
