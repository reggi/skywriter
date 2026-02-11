import ace from 'ace-builds'
import 'ace-builds/src-noconflict/mode-javascript'
import 'ace-builds/src-noconflict/mode-html'
import 'ace-builds/src-noconflict/mode-css'
import 'ace-builds/src-noconflict/mode-yaml'
import 'ace-builds/src-noconflict/mode-json'
import 'ace-builds/src-noconflict/theme-monokai'

import {
  getEditorPanels,
  getEditorTextareas,
  getTemplateElements,
  getSlotElements,
  getStatusElements,
  getPreviewElement,
} from './utils/dom.ts'
import {createStoreWithBinder} from './utils/store.ts'
import {parseStateFromDOM, normalizeState} from './utils/state.ts'
import {Handler} from './utils/handler.ts'
import type {Upload} from './utils/types.ts'

import {getEditUrlWithHostQuery, escapeHtml, truncateMiddle} from './utils/html-utils.ts'

import {editors} from './components/editors.ts'
import {tabs} from './components/tabs.ts'
import {status} from './components/status.ts'
import {toast} from './components/toast.ts'
import {slot} from './components/slot.ts'
import {template} from './components/template.ts'
import {redirects} from './components/redirects.ts'
import {uploads} from './components/uploads.ts'
import {dragAndDrop} from './components/dragAndDrop.ts'
import {resizableSplit} from './components/resizableSplit.ts'

// Initialize editors
async function initialize() {
  // Parse state from DOM
  const state = parseStateFromDOM()

  // Get DOM element groups
  const panels = getEditorPanels()
  const textareas = getEditorTextareas()
  const templateElements = getTemplateElements()
  const slotElements = getSlotElements()
  const statusElements = getStatusElements()
  const preview = getPreviewElement()

  const normalized = normalizeState(state)

  const draft = createStoreWithBinder(normalized.draft)
  const save = createStoreWithBinder(normalized.save)
  const meta = createStoreWithBinder({
    ...normalized.meta,
    status: null as {message: string; duration?: number} | null,
    toast: null as {message: string; details?: string} | null,
  })

  // Watch for status messages
  meta.store.watch('status', (value: unknown) => {
    const statusValue = value as {message: string; duration?: number} | null
    if (statusValue) {
      status.update({statusElements, message: statusValue.message, duration: statusValue.duration})
      // Reset after showing
      setTimeout(() => meta.store.set('status', null), 0)
    }
  })

  // Watch for toast messages
  meta.store.watch('toast', (value: unknown) => {
    const toastValue = value as {message: string; details?: string} | null
    if (toastValue) {
      toast.update({message: toastValue.message, details: toastValue.details})
      // Reset after showing
      setTimeout(() => meta.store.set('toast', null), 0)
    }
  })

  const handler = new Handler({meta, draft, save})

  // Bind form inputs
  save.binder.bind('path', '#slug')
  draft.binder.bind('title', '#title-input')
  draft.binder.bind('mime_type', '#mime-type-input', {
    onBlur: async () => {
      // Trigger draft save when focus out, capturing the final value
      await handler.draft()
    },
  })

  draft.binder.bind('extension', '#extension-input', {
    onBlur: async () => {
      // Trigger draft save when focus out, capturing the final value
      await handler.draft()
    },
  })
  draft.binder.bind('template_id', '#template-id')
  draft.binder.bind('slot_id', '#slot-id')

  save.binder.bind('published', '#publish-btn', {
    read: el => (el as HTMLButtonElement).getAttribute('data-published') === 'true',
    write: (el, value) => {
      const btn = el as HTMLButtonElement
      btn.textContent = value ? 'Unpublish' : 'Publish'
      btn.setAttribute('data-published', String(value))
      btn.setAttribute(
        'aria-label',
        value ? 'Document is public. Click to unpublish' : 'Document is hidden. Click to publish',
      )
      // Preserve disabled state based on document ID (don't override it here)
      // The disabled state is managed by the documentId watcher
    },
    event: 'click',
    onClick: async e => {
      e?.preventDefault()
      await handler.publish()
    },
  })

  meta.binder.bind('saveDisabled', '#save-btn', {
    read: el => (el as HTMLButtonElement).disabled,
    write: (el, value) => {
      ;(el as HTMLButtonElement).disabled = value as boolean
    },
    onClick: async (e, disabled) => {
      if (disabled) return
      await handler.save()
    },
  })

  meta.binder.bind('revertDisabled', '#revert-btn', {
    read: el => (el as HTMLButtonElement).disabled,
    write: (el, value) => {
      ;(el as HTMLButtonElement).disabled = value as boolean
    },
    onClick: async (e, disabled) => {
      if (disabled) return
      await handler.revert()
    },
  })

  meta.binder.bind('disableIfDocumentDoesNotExist', '#publish-btn', {
    read: el => (el as HTMLButtonElement).disabled,
    write: (el, value) => {
      ;(el as HTMLButtonElement).disabled = value as boolean
    },
  })

  meta.binder.bind('disableIfDocumentDoesNotExist', '.btn-delete', {
    read: el => (el as HTMLButtonElement).disabled,
    write: (el, value) => {
      ;(el as HTMLButtonElement).disabled = value as boolean
    },
  })

  // Watch published state and update view button (one-way binding)
  save.store.watch('published', (published: boolean) => {
    const viewBtn = document.getElementById('view-btn') as HTMLButtonElement
    if (viewBtn) {
      viewBtn.disabled = !published
    }
  })

  meta.store.watch('currentPath', (path: string) => {
    // set the url to the new path if it changes
    // with the fragment
    const fragment = window.location.hash
    window.history.pushState(null, '', getEditUrlWithHostQuery(path) + fragment)
  })

  // Add click handler for view button
  const viewBtn = document.getElementById('view-btn') as HTMLButtonElement
  if (viewBtn) {
    viewBtn.addEventListener('click', () => {
      const published = save.store.get('published')
      if (!published) return
      const path = save.store.get('path') as string | undefined
      window.open(path, '_blank')
    })
  }

  function updateButtonStates() {
    const draftIsDirty = draft.store.isDirty()
    const saveIsDirty = save.store.isDirty()
    const hasDraft = meta.store.get('hasDraft') ?? false

    meta.store.set('revertDisabled', !(draftIsDirty || hasDraft))
    meta.store.set('saveDisabled', !(saveIsDirty || draftIsDirty || hasDraft))
  }

  // Exclude mime_type and extension from debounced autosave (will save on blur instead)
  draft.store.debounce({exclude: ['mime_type', 'extension']}, async () => {
    await handler.draft()
    updateButtonStates()
  })

  draft.store.watch(undefined, updateButtonStates)
  save.store.watch(undefined, updateButtonStates)

  // Initialize all editors and bind them to the draft store
  const editorInstances = await editors.init({
    panels,
    textareas,
    draft,
    onSave: () => handler.draft(),
  })

  // Initialize tab state management with server-provided filenames
  const tabUpdaters = tabs.init({
    initialTabs: normalized.meta.tabs || {},
    editors: editorInstances,
    filenames: normalized.meta.tabFilenames,
  })

  // Watch for template changes and update UI
  meta.store.watch('template', (value: unknown) => {
    const templateValue = value as {id: number; title: string | null; path: string} | null
    template.update({template: templateValue})
    if (templateValue) {
      draft.store.set('template_id', templateValue.id)
    } else {
      draft.store.set('template_id', null)
    }
  })

  // Watch for slot changes and update UI
  meta.store.watch('slot', (value: unknown) => {
    const slotValue = value as {id: number; title: string | null; path: string} | null
    slot.update({slot: slotValue})
    if (slotValue) {
      draft.store.set('slot_id', slotValue.id)
    } else {
      draft.store.set('slot_id', null)
    }
  })

  meta.store.watch('uploads', () => {
    const value = (meta.store.get('uploads') as Upload[]) || []
    const path = (save.store.get('path') as string) || ''
    uploads.update({uploads: value, documentPath: path})
  })

  meta.store.watch('redirects', () => {
    const value =
      (meta.store.get('redirects') as {id: number; path: string; document_id: number; created_at: Date}[]) || []
    redirects.update({redirects: value})
  })

  meta.store.watch('api', () => {
    const api = (meta.store.get('api') as string[]) || []
    const apiLinksContainer = document.querySelector('.api-links-list')
    if (apiLinksContainer) {
      apiLinksContainer.innerHTML = api.length
        ? api
            .map(
              (url: string) => `
            <div class="api-link-item">
              <a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" title="${escapeHtml(url)}" style="display:block;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(truncateMiddle(url, 60))}</a>
            </div>
          `,
            )
            .join('')
        : '<div class="help-text">No API links until doc exists</div>'
    }
  })

  meta.store.watch('tabs', (value: unknown) => {
    const tabsState = value as {[key: string]: {hasDraft: boolean; isEmpty: boolean}} | null
    if (tabsState) tabUpdaters.updateState(tabsState)
  })

  // Watch for tab filename changes (e.g., when extension changes)
  meta.store.watch('tabFilenames', (value: unknown) => {
    const filenames = value as {
      content: string
      data: string
      style: string
      script: string
      server: string
      settings: string
    } | null
    if (filenames) tabUpdaters.updateFilenames(filenames)
  })

  // Helper to update preview with proper text/plain handling
  const updatePreview = () => {
    const html = meta.store.get('html') as string | undefined
    if (preview && html) {
      const mimeType = (draft.store.get('mime_type') as string) || ''
      if (mimeType.startsWith('text/plain')) {
        // Wrap plain text in pre tag with browser-like styling
        const escaped = html.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        ;(preview as HTMLIFrameElement).srcdoc = `<!DOCTYPE html>
<html>
<head>
<style>
body {
  margin: 8px;
  white-space: pre-wrap;
  word-wrap: break-word;
  font-family: monospace;
  font-size: 13px;
  line-height: 1.4;
}
</style>
</head>
<body>${escaped}</body>
</html>`
      } else {
        ;(preview as HTMLIFrameElement).srcdoc = html
      }
    }
  }

  // Watch for html changes and update preview
  meta.store.watch('html', updatePreview)

  // Also watch for mime_type changes to re-render preview appropriately
  draft.store.watch('mime_type', updatePreview)

  // Initialize template and slot search
  template.init({
    templateElements,
    onSelect: result => {
      meta.store.set('template', {
        id: result.id,
        title: result.title,
        path: result.path,
      })
    },
    onClear: () => {
      meta.store.set('template', null)
    },
  })

  slot.init({
    slotElements,
    onSelect: result => {
      meta.store.set('slot', {
        id: result.id,
        title: result.title,
        path: result.path,
      })
    },
    onClear: () => {
      meta.store.set('slot', null)
    },
  })

  // Initialize UI with current values since watchers don't fire on initial values
  template.update({template: meta.store.get('template') as {id: number; title: string | null; path: string} | null})
  slot.update({slot: meta.store.get('slot') as {id: number; title: string | null; path: string} | null})

  // Initialize uploads and redirects features
  const documentPath = (state.document.path as string) || '/'

  uploads.init({documentPath})
  redirects.init({documentPath})

  // Setup drag and drop for all editors
  dragAndDrop.init({
    panels,
    editors: editorInstances,
    documentPath,
    isHtml: () => meta.store.get('content_type') === 'html',
    onUploadComplete: () => {}, // onUploadComplete callback
  })

  // Initialize resizable split
  resizableSplit.init()
}

// Configure ACE to use bundled modules only (no dynamic loading)
// Disable workers to prevent external script loading
// @ts-expect-error ace.config.set is not typed
ace.config.set('useWorker', false)
ace.config.set('loadWorkerFromBlob', false)

// Make ace globally available for the editor code
;(window as {ace?: unknown}).ace = ace

// Auto-initialize editors when module is imported
// Wait for DOM to be ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    initialize()
  })
} else {
  initialize()
}
