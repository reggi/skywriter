import type {EditorPanels} from '../utils/dom.ts'
import type {AceEditor, EditorModule, Editors} from '../utils/types.ts'
import {escapeHtml, getEditUrl} from '../utils/html-utils.ts'

interface UploadOptions {
  file: File
  documentPath: string
}

async function uploadImage(options: UploadOptions): Promise<string> {
  const {file, documentPath} = options

  const formData = new FormData()
  formData.append('file', file)

  const resp = await fetch(`${getEditUrl(documentPath)}?upload=true`, {
    method: 'POST',
    body: formData,
    credentials: 'include', // Include cookies for authentication
  })
  if (!resp.ok) {
    throw new Error('Upload failed: ' + (await resp.text()))
  }

  const data = await resp.json()
  return data.url
}

function isImageFile(file: File): boolean {
  return file.type.startsWith('image/')
}

async function uploadFiles(
  files: File[],
  documentPath: string,
  isHtml: () => boolean,
  editorType: 'content' | 'data' | 'style' | 'script',
): Promise<string> {
  if (files.length === 0) return ''

  let combined = ''
  for (const file of files) {
    try {
      const url = await uploadImage({file, documentPath})
      const isImage = isImageFile(file)
      combined += buildInsertText(url, file.name || 'file', editorType, isHtml, isImage)
    } catch (err) {
      console.error('Upload error:', err)
    }
  }
  return combined
}

function buildInsertText(
  url: string,
  fileName: string,
  editorType: string,
  isHtml: () => boolean,
  isImage: boolean,
): string {
  switch (editorType) {
    case 'content':
      if (isImage) {
        // Images: use <img> for HTML, markdown syntax for markdown
        if (isHtml()) {
          return `<img src="${url}" alt="${fileName}" />\n`
        }
        return `![${fileName}](${url})\n`
      } else {
        // Non-images: use <a> for HTML, markdown link for markdown
        if (isHtml()) {
          return `<a href="${url}">${fileName}</a>\n`
        }
        return `[${fileName}](${url})\n`
      }
    case 'data':
      // Insert raw URL (user can wrap/structure later)
      return `${url}\n`
    case 'style':
      // For images in CSS, use url(); for others just the URL
      if (isImage) {
        return `/* image */ url(${url});\n`
      }
      return `/* file */ '${url}';\n`
    case 'script':
      return `'${url}';\n`
    default:
      return `${url}\n`
  }
}

function setupImageDragAndDrop(
  panelEl: HTMLElement,
  editorInstance: AceEditor,
  editorType: 'content' | 'data' | 'style' | 'script',
  documentPath: string,
  isHtml: () => boolean,
  onUploadComplete?: () => void,
) {
  if (!panelEl || !editorInstance) return

  panelEl.addEventListener(
    'dragover',
    e => {
      e.preventDefault()
      panelEl.classList.add('drag-over')
    },
    {passive: false},
  )

  panelEl.addEventListener(
    'dragleave',
    e => {
      e.preventDefault()
      panelEl.classList.remove('drag-over')
    },
    {passive: false},
  )

  panelEl.addEventListener(
    'drop',
    async e => {
      e.preventDefault()
      panelEl.classList.remove('drag-over')
      const files = Array.from(e.dataTransfer?.files || [])
      const insertText = await uploadFiles(files, documentPath, isHtml, editorType)
      if (insertText) {
        editorInstance.insert(insertText)
        if (onUploadComplete) onUploadComplete()
      }
    },
    {passive: false},
  )

  panelEl.addEventListener(
    'paste',
    async e => {
      const items = Array.from(e.clipboardData?.items || [])
      const files = items.map(i => i.getAsFile()).filter(f => f !== null) as File[]
      if (!files.length) return
      e.preventDefault()
      const insertText = await uploadFiles(files, documentPath, isHtml, editorType)
      if (insertText) {
        editorInstance.insert(insertText)
        if (onUploadComplete) onUploadComplete()
      }
    },
    {passive: false},
  )
}

// Initialize all drag and drop handlers
function init(options: {
  panels: EditorPanels
  editors: Editors
  documentPath: string
  isHtml: () => boolean
  onUploadComplete: () => void
}) {
  const {panels, editors, documentPath, isHtml, onUploadComplete} = options

  // Setup image drag and drop for all editors
  setupImageDragAndDrop(panels.contentEditorPanel, editors.content, 'content', documentPath, isHtml, onUploadComplete)

  setupImageDragAndDrop(panels.dataEditorPanel, editors.data, 'data', documentPath, isHtml, onUploadComplete)

  setupImageDragAndDrop(panels.styleEditorPanel, editors.style, 'style', documentPath, isHtml, onUploadComplete)

  setupImageDragAndDrop(panels.scriptEditorPanel, editors.script, 'script', documentPath, isHtml, onUploadComplete)

  setupImageDragAndDrop(panels.serverEditorPanel, editors.server, 'script', documentPath, isHtml, onUploadComplete)

  // Setup drag and drop for settings panel (for uploads)
  const settingsPanel = document.querySelector('.settings-panel') as HTMLElement | null
  if (settingsPanel) {
    settingsPanel.addEventListener(
      'dragover',
      e => {
        e.preventDefault()
        settingsPanel.classList.add('drag-over')
      },
      {passive: false},
    )

    settingsPanel.addEventListener(
      'dragleave',
      e => {
        e.preventDefault()
        settingsPanel.classList.remove('drag-over')
      },
      {passive: false},
    )

    settingsPanel.addEventListener(
      'drop',
      async e => {
        e.preventDefault()
        settingsPanel.classList.remove('drag-over')

        const files = Array.from(e.dataTransfer?.files || [])
        if (files.length === 0) return

        const uploadsTable = document.querySelector('.uploads-table') as HTMLTableElement | null

        for (const file of files) {
          const formData = new FormData()
          formData.append('file', file)

          try {
            const response = await fetch(`${getEditUrl(documentPath)}?upload=true`, {
              method: 'POST',
              body: formData,
            })

            if (response.ok) {
              const data = await response.json()
              // Add new row to uploads table
              const tbody = uploadsTable?.querySelector('tbody')
              if (tbody) {
                // Remove "no uploads" message if it exists
                const noUploads = tbody.querySelector('.no-uploads')
                if (noUploads) {
                  noUploads.closest('tr')?.remove()
                }

                // Add new upload row
                const tr = document.createElement('tr')
                const now = new Date().toLocaleDateString()
                tr.innerHTML = `
                <td>
                  <span class="filename-display">${escapeHtml(data.original_filename)}</span>
                  <input 
                    type="text" 
                    class="filename-input" 
                    value="${escapeHtml(data.original_filename)}"
                    style="display: none;"
                  />
                </td>
                <td class="upload-date">${now}</td>
                <td class="upload-actions">
                  <a 
                    href="${escapeHtml(data.url)}"
                    target="_blank"
                    class="icon-btn view-upload-btn"
                    title="View upload"
                  >
                    👁️
                  </a>
                  <button 
                    type="button"
                    class="icon-btn delete-upload-btn"
                    data-filename="${escapeHtml(data.original_filename)}"
                    title="Delete upload"
                  >
                    🗑️
                  </button>
                </td>
              `
                tbody.appendChild(tr)
              }

              // Refresh document state to update uploads/redirects
              onUploadComplete()
            } else {
              const error = await response.text()
              alert(`Upload failed: ${error}`)
            }
          } catch (error) {
            console.error('Upload error:', error)
            alert(`Upload failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
          }
        }
      },
      {passive: false},
    )
  }
}

export const dragAndDrop = {
  init,
} satisfies EditorModule
