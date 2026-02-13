import type {EditorModule, AceEditor, Editors} from '../utils/types.ts'

interface Shortcut {
  keys: string
  description: string
}

const isMac = typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.platform)
const mod = isMac ? '⌘' : 'Ctrl'
const WRAP_STORAGE_KEY = 'skywriter:wordWrap'

const shortcuts: Shortcut[] = [
  {keys: `${mod} + S`, description: 'Save draft'},
  {keys: `${mod} + \\`, description: 'Toggle word wrap'},
  {keys: `${mod} + ]`, description: 'Indent selection'},
  {keys: `${mod} + [`, description: 'Outdent selection'},
  {keys: `${mod} + Click`, description: 'Open link in new tab'},
  {keys: '?', description: 'Show keyboard shortcuts'},
]

let overlayEl: HTMLDivElement | null = null
let isVisible = false

function getStoredWrap(): boolean {
  try {
    const stored = localStorage.getItem(WRAP_STORAGE_KEY)
    return stored === null ? true : stored === 'true'
  } catch {
    return true
  }
}

function setStoredWrap(value: boolean) {
  try {
    localStorage.setItem(WRAP_STORAGE_KEY, String(value))
  } catch {
    // ignore storage errors
  }
}

function createOverlay(): HTMLDivElement {
  const overlay = document.createElement('div')
  overlay.className = 'shortcuts-overlay'
  overlay.setAttribute('role', 'dialog')
  overlay.setAttribute('aria-label', 'Keyboard shortcuts')

  const panel = document.createElement('div')
  panel.className = 'shortcuts-panel'

  const header = document.createElement('div')
  header.className = 'shortcuts-header'
  header.innerHTML = `<h2>Keyboard shortcuts</h2><button class="shortcuts-close" aria-label="Close">&times;</button>`

  const list = document.createElement('div')
  list.className = 'shortcuts-list'

  for (const shortcut of shortcuts) {
    const row = document.createElement('div')
    row.className = 'shortcuts-row'

    const desc = document.createElement('span')
    desc.className = 'shortcuts-desc'
    desc.textContent = shortcut.description

    const keys = document.createElement('span')
    keys.className = 'shortcuts-keys'

    const parts = shortcut.keys.split(' + ')
    keys.innerHTML = parts.map(p => `<kbd>${p}</kbd>`).join(' + ')

    row.appendChild(desc)
    row.appendChild(keys)
    list.appendChild(row)
  }

  panel.appendChild(header)
  panel.appendChild(list)
  overlay.appendChild(panel)

  // Close on backdrop click
  overlay.addEventListener('click', e => {
    if (e.target === overlay) hide()
  })

  // Close button
  header.querySelector('.shortcuts-close')?.addEventListener('click', () => hide())

  document.body.appendChild(overlay)
  return overlay
}

function show() {
  if (!overlayEl) overlayEl = createOverlay()
  overlayEl.classList.add('visible')
  isVisible = true
}

function hide() {
  if (overlayEl) overlayEl.classList.remove('visible')
  isVisible = false
}

function toggle() {
  if (isVisible) {
    hide()
  } else {
    show()
  }
}

function setWrapAll(editorList: AceEditor[], wrap: boolean) {
  for (const editor of editorList) {
    editor.session.setOption('wrap', wrap)
  }
  setStoredWrap(wrap)

  // Sync the settings checkbox
  const checkbox = document.getElementById('word-wrap-toggle') as HTMLInputElement | null
  if (checkbox) checkbox.checked = wrap
}

function init(options: {editors: Editors}) {
  const editorList = Object.values(options.editors)

  // Apply stored wrap preference on init
  const initialWrap = getStoredWrap()
  for (const editor of editorList) {
    editor.session.setOption('wrap', initialWrap)
  }

  // Update the modifier key text in server-rendered HTML
  document.querySelectorAll('.shortcut-mod').forEach(el => {
    el.textContent = mod
  })

  // Sync the settings checkbox with stored state
  const checkbox = document.getElementById('word-wrap-toggle') as HTMLInputElement | null
  if (checkbox) {
    checkbox.checked = initialWrap
    checkbox.addEventListener('change', () => {
      setWrapAll(editorList, checkbox.checked)
    })
  }

  // Global ? key listener (only when not typing in an input/editor)
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && isVisible) {
      hide()
      return
    }

    // Only trigger on ? when not focused in an input, textarea, or ace editor
    if (e.key === '?') {
      const active = document.activeElement
      const tag = active?.tagName?.toLowerCase()
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return
      if (active?.closest?.('.ace_editor')) return
      toggle()
    }
  })

  // Add toggle word wrap shortcut to all editors
  for (const editor of editorList) {
    editor.commands.addCommand({
      name: 'toggleWordWrap',
      bindKey: {win: 'Ctrl-\\', mac: 'Cmd-\\'},
      exec: function (ed) {
        const current = ed.session.getUseWrapMode()
        setWrapAll(editorList, !current)
      },
      readOnly: true,
    })
  }
}

export const keyboardShortcuts = {
  init,
} satisfies EditorModule
