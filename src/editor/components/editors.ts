import {aceTheme} from '../utils/aceTheme.ts'
import {aceMarkdown} from '../utils/aceMarkdown.ts'
import {enableLinkOpener, enableIndentShortcuts, enableSaveShortcut} from '../utils/ace-shortcuts.ts'
import type {EditorPanels, EditorTextareas} from '../utils/dom.ts'
import type {AceEditor, EditorModule, Editors, StoreWithBinder} from '../utils/types.ts'
import type {Binder, HistoryStore} from '../utils/store.ts'

interface EditorBindConfig {
  /** The path in the store to bind to (e.g., 'content', 'data') */
  storePath: string
  /** The ACE editor instance */
  editor: AceEditor
  /** Optional textarea element to keep in sync */
  textarea?: HTMLTextAreaElement
  /** Optional function to detect/update mode dynamically (e.g., for data editor JSON/YAML) */
  detectMode?: (value: string) => string
  /** Optional callback when editor changes */
  onChange?: (value: string) => void
}

/**
 * Binds an ACE editor to a store path with proper cursor/scroll preservation
 * and optional textarea sync.
 *
 * @example
 * ```ts
 * const draft = createStoreWithBinder({ content: '', data: '{}' })
 * const contentEditor = await initAceEditor('content-editor', '', {...})
 *
 * bindEditor({
 *   storePath: 'content',
 *   editor: contentEditor,
 *   textarea: document.querySelector('#content-textarea'),
 *   binder: draft.binder,
 *   store: draft.store
 * })
 * ```
 */
function bindEditor(config: EditorBindConfig & {binder: Binder; store: HistoryStore}) {
  const {storePath, editor, textarea, detectMode, onChange, binder} = config

  // Bind the editor to the store with custom read/write
  // IMPORTANT: writeOnStoreChange is false to prevent store updates from disrupting typing
  // Editor updates only happen manually via binding.sync() (e.g., during reset/revert)
  const binding = binder.bind(storePath, editor, {
    read: el => (el as AceEditor).getValue(),
    writeOnStoreChange: false, // Disable automatic editor updates from store
    write: (el, value) => {
      const aceEl = el as AceEditor
      const normalizedValue = (value as string) || ''
      const currentValue = aceEl.getValue()

      // CRITICAL: Only update if value has actually changed to prevent infinite loop
      if (currentValue === normalizedValue) {
        return
      }

      // Preserve cursor position and scroll when updating from store
      const cursorPosition = aceEl.getCursorPosition()
      const scrollTop = aceEl.session.getScrollTop()
      aceEl.setValue(normalizedValue, -1)
      aceEl.moveCursorToPosition(cursorPosition)
      aceEl.session.setScrollTop(scrollTop)
      aceEl.clearSelection()

      // Force Ace to refresh/re-render (critical for hidden/inactive editors)
      if (aceEl.renderer) {
        aceEl.renderer.updateFull(true)
        aceEl.renderer.onResize(true)
      }
      aceEl.resize(true)

      // Sync textarea if provided
      if (textarea) {
        textarea.value = normalizedValue
      }
    },
    event: 'change',
    onChange: (value: string) => {
      // Sync textarea on change
      if (textarea) {
        textarea.value = value
      }

      // Update mode dynamically if detectMode is provided
      if (detectMode) {
        editor.session.setMode(detectMode(value))
      }

      // Call custom onChange if provided
      if (onChange) {
        onChange(value)
      }
    },
  })

  return binding
}

/**
 * Helper to detect data mode (JSON vs YAML)
 */
function detectDataMode(content: string): string {
  const trimmed = content.trim()
  if (!trimmed) return 'ace/mode/json'
  if (/^[^{["'\n]*:\s*[^"'\n]/m.test(trimmed) && !trimmed.startsWith('{') && !trimmed.startsWith('[')) {
    return 'ace/mode/yaml'
  }
  return 'ace/mode/json'
}

interface AceGlobal {
  edit(elementId: string | HTMLElement): AceEditor
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  define(name: string, deps: string[], factory: (...args: any[]) => void): void
}

declare global {
  interface Window {
    ace: AceGlobal
  }
}

interface AceEditorOptions {
  basePath?: string
  theme?: string
  mode?: string
  wrap?: boolean
  fontSize?: number
  showPrintMargin?: boolean
  editorOptions?: Record<string, unknown>
}

async function initAceEditor(elementId: string, content: string, options: AceEditorOptions = {}): Promise<AceEditor> {
  const ace = await new Promise<AceGlobal>(resolve => {
    if (typeof window.ace !== 'undefined') {
      resolve(window.ace)
    } else {
      const check = setInterval(() => {
        if (typeof window.ace !== 'undefined') {
          clearInterval(check)
          resolve(window.ace)
        }
      }, 100)
    }
  })

  // Ace modes are bundled via npm, no need to configure basePath or preload

  aceTheme(ace)
  aceMarkdown(ace)

  const editor = ace.edit(elementId)

  // Set default mode to markdown_simple if not provided
  const theme = options.theme || 'ace/theme/monokai_custom'
  const mode = options.mode || 'ace/mode/markdown_simple'

  editor.setTheme(theme)
  editor.session.setMode(mode)

  // Always set content, even if empty, to override textarea whitespace
  editor.setValue(content || '', -1)

  editor.setOptions({
    wrap: options.wrap !== undefined ? options.wrap : true,
    fontSize: options.fontSize || 14,
    showPrintMargin: options.showPrintMargin !== undefined ? options.showPrintMargin : false,
    tabSize: 2,
    useSoftTabs: true,
  })

  // Enable plugins
  enableLinkOpener(editor)
  enableIndentShortcuts(editor)

  return editor
}

/**
 * Initialize a standard Ace editor with common settings
 */
function initStandardAceEditor(panelElement: HTMLElement, initialValue: string, mode: string): AceEditor {
  // Define custom theme if not already defined
  aceTheme(window.ace)

  const editor = window.ace.edit(panelElement)
  editor.setTheme('ace/theme/monokai_custom')
  editor.session.setMode(mode)
  editor.setValue(initialValue, -1)
  editor.setOptions({
    wrap: true,
    fontSize: 14,
  })
  enableIndentShortcuts(editor)
  return editor
}

/**
 * Initialize all editors (content, data, style, script, server)
 */
async function initEditors(options: {
  panels: EditorPanels
  textareas: EditorTextareas
  draft: StoreWithBinder
  onSave: () => void
}): Promise<Editors> {
  const {panels, textareas, draft, onSave} = options
  // Initialize Content Ace Editor
  const contentEditor = await initAceEditor(
    panels.contentEditorPanel.id || 'content-editor-panel',
    (draft.store.get('content') as string) || '',
    {
      theme: 'ace/theme/monokai_custom',
      mode: 'ace/mode/markdown_simple',
      wrap: true,
      fontSize: 14,
      showPrintMargin: false,
    },
  )

  // Initialize Data Ace Editor (auto-detect JSON/YAML)
  const dataEditor = initStandardAceEditor(
    panels.dataEditorPanel,
    (draft.store.get('data') as string) || '{}',
    detectDataMode((draft.store.get('data') as string) || '{}'),
  )

  // Initialize Style Ace Editor (CSS)
  const styleEditor = initStandardAceEditor(
    panels.styleEditorPanel,
    (draft.store.get('style') as string) || '',
    'ace/mode/css',
  )

  // Initialize Script Ace Editor (JavaScript)
  const scriptEditor = initStandardAceEditor(
    panels.scriptEditorPanel,
    (draft.store.get('script') as string) || '',
    'ace/mode/javascript',
  )

  // Initialize Server Ace Editor (JavaScript)
  const serverEditor = initStandardAceEditor(
    panels.serverEditorPanel,
    (draft.store.get('server') as string) || '',
    'ace/mode/javascript',
  )

  // Enable Cmd+S save shortcut for all editors
  ;[contentEditor, dataEditor, styleEditor, scriptEditor, serverEditor].forEach(editor => {
    enableSaveShortcut(editor, onSave)
  })

  // Bind all editors to the draft store
  const editorConfigs = [
    {storePath: 'content', editor: contentEditor, textarea: textareas.contentTextarea},
    {storePath: 'data', editor: dataEditor, textarea: textareas.dataTextarea, detectMode: detectDataMode},
    {storePath: 'style', editor: styleEditor, textarea: textareas.styleTextarea},
    {storePath: 'script', editor: scriptEditor, textarea: textareas.scriptTextarea},
    {storePath: 'server', editor: serverEditor, textarea: textareas.serverTextarea},
  ]

  editorConfigs.forEach(config => {
    bindEditor({
      ...config,
      binder: draft.binder,
      store: draft.store,
    })
  })

  return {
    content: contentEditor,
    data: dataEditor,
    style: styleEditor,
    script: scriptEditor,
    server: serverEditor,
  }
}

export const editors = {
  init: initEditors,
} satisfies EditorModule
