import type {DocumentClientState} from './types.ts'

// Parse and initialize state from DOM
export function parseStateFromDOM(): DocumentClientState {
  const stateData = document.body.getAttribute('data-state')
  if (!stateData) {
    throw new Error('No state data found on body element')
  }
  const state = JSON.parse(stateData) as DocumentClientState
  return state
}

// Normalize state from document and render data
export function normalizeState(data: DocumentClientState) {
  const {document, render, tabs, api, tabFilenames, contentModifiedByServer} = data
  const hasDraft = (document.draft as boolean) ?? false
  const state = {
    draft: {
      title: (document.title as string) || '',
      mime_type: (document.mime_type as string) || 'text/html; charset=UTF-8',
      extension: (document.extension as string) || '.html',
      template_id: (document.template_id as number | null) || null,
      slot_id: (document.slot_id as number | null) || null,
      content: (document.content as string) || '',
      data: (document.data as string) || '{}',
      style: (document.style as string) || '',
      script: (document.script as string) || '',
      server: (document.server as string) || '',
    },
    save: {
      path: (document.path as string) || '',
      published: (document.published as boolean) || false,
    },
    meta: {
      api: api || [],
      currentPath: (document.path as string) || '',
      hasDraft,
      saveDisabled: !hasDraft,
      revertDisabled: !hasDraft,
      documentId: (document.id as number) || 0,
      disableIfDocumentDoesNotExist: !document.id,
      redirects: (document.redirects as unknown[]) || [],
      uploads: (document.uploads as unknown[]) || [],
      html: (render.html as string) || '',
      template: (document.template as {id: number; title: string | null; path: string} | null) || null,
      slot: (document.slot as {id: number; title: string | null; path: string} | null) || null,
      tabs,
      // Tab filenames from server (computed based on content_type, data_type, has_eta)
      tabFilenames: tabFilenames || {
        content: 'content.md',
        data: 'data.json',
        style: 'style.css',
        script: 'script.js',
        server: 'server.js',
        settings: 'settings',
      },
      // Flag indicating content was modified by server (e.g., foreign images downloaded)
      contentModifiedByServer: contentModifiedByServer || false,
    },
  }
  return state
}
