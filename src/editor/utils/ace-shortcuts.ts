/**
 * Ace Editor Shortcuts
 * Adds keyboard shortcuts for indenting/outdenting, saving, and link opening
 */

import type {AceClickEvent, AceEditor} from './types.ts'

export function enableIndentShortcuts(editor: AceEditor) {
  // Add command for indent (Cmd+])
  editor.commands.addCommand({
    name: 'indentSelection',
    bindKey: {win: 'Ctrl-]', mac: 'Cmd-]'},
    exec: function (editor: AceEditor) {
      editor.blockIndent()
    },
    readOnly: false,
  })

  // Add command for outdent (Cmd+[)
  editor.commands.addCommand({
    name: 'outdentSelection',
    bindKey: {win: 'Ctrl-[', mac: 'Cmd-['},
    exec: function (editor: AceEditor) {
      editor.blockOutdent()
    },
    readOnly: false,
  })
}

/**
 * Ace Editor Save Shortcut
 * Adds Cmd+S/Ctrl+S shortcut to trigger save callback
 */
export function enableSaveShortcut(editor: AceEditor, onSave: () => void) {
  editor.commands.addCommand({
    name: 'saveDocument',
    bindKey: {win: 'Ctrl-S', mac: 'Cmd-S'},
    exec: function () {
      onSave()
    },
    readOnly: false,
  })
}

/**
 * Ace Editor Link Opener
 * Allows Cmd/Ctrl + Click on markdown links and images to open them in a new tab
 */
export function enableLinkOpener(editor: AceEditor) {
  editor.on('click', function (e: AceClickEvent) {
    // Check if Cmd (Mac) or Ctrl (Windows/Linux) is pressed
    if (!e.domEvent.metaKey && !e.domEvent.ctrlKey) {
      return
    }

    const position = e.getDocumentPosition()
    const session = editor.session
    const token = session.getTokenAt(position.row, position.column)

    if (!token) return

    // Get the full line to parse markdown links/images
    const line = session.getLine(position.row)

    // Try to find a link or image at the cursor position
    const url = extractUrlAtPosition(line, position.column)

    if (url) {
      e.stop()
      e.preventDefault()
      window.open(url, '_blank', 'noopener,noreferrer')
    }
  })

  // Add visual feedback by changing cursor on hover with modifier key
  editor.on('mousemove', function (e: AceClickEvent) {
    if (!editor.renderer) return
    if (!e.domEvent.metaKey && !e.domEvent.ctrlKey) {
      editor.renderer.container.style.cursor = ''
      return
    }

    const position = e.getDocumentPosition()
    const session = editor.session
    const line = session.getLine(position.row)
    const url = extractUrlAtPosition(line, position.column)

    if (url) {
      editor.renderer.container.style.cursor = 'pointer'
    } else {
      editor.renderer.container.style.cursor = ''
    }
  })

  // Reset cursor when modifier key is released
  editor.on('keyup', function () {
    if (editor.renderer) {
      editor.renderer.container.style.cursor = ''
    }
  })
}

function extractUrlAtPosition(line: string, column: number): string | null {
  // Regex patterns for markdown links and images
  // [text](url) or ![alt](url)
  const linkPattern = /!?\[([^\]]*)\]\(([^)]+)\)/g

  let match
  while ((match = linkPattern.exec(line)) !== null) {
    const isImage = match[0].startsWith('!')
    const linkText = match[1]
    const url = match[2]

    // Calculate the positions of the URL within the match
    // Format: [text](url) or ![alt](url)
    const matchStart = match.index
    const urlStart = matchStart + (isImage ? 1 : 0) + 1 + linkText.length + 2 // Account for [, ], (, !
    const urlEnd = urlStart + url.length

    // Check if cursor is within the URL portion
    if (column >= urlStart && column <= urlEnd) {
      return url.trim()
    }

    // Also allow clicking on the link text portion
    const textStart = matchStart + (isImage ? 2 : 1) // After [ or ![
    const textEnd = textStart + linkText.length
    if (column >= textStart && column <= textEnd) {
      return url.trim()
    }
  }

  // Also check for plain URLs
  const urlPattern = /(https?:\/\/[^\s<>"{}|\\^`\[\]]+)/g
  while ((match = urlPattern.exec(line)) !== null) {
    const urlStart = match.index
    const urlEnd = urlStart + match[0].length

    if (column >= urlStart && column <= urlEnd) {
      return match[0]
    }
  }

  return null
}
