import {escapeHtml, getEditUrl, removeEmptyMessage} from '../utils/html-utils.ts'
import type {EditorModule, Upload} from '../utils/types.ts'

// Helper to create upload row HTML
function createUploadRow(upload: {
  id?: number
  original_filename: string
  url?: string
  created_at?: Date
  hidden?: boolean
}): string {
  const uploadDate = upload.created_at
    ? new Date(upload.created_at).toLocaleDateString()
    : new Date().toLocaleDateString()

  const isHidden = upload.hidden || false

  return `
    <td>
      <a 
        href="${escapeHtml(upload.url || '')}${isHidden ? '?reveal' : ''}"
        target="_blank"
        class="filename-link"
        title="View ${escapeHtml(upload.original_filename)}"
      >${escapeHtml(upload.original_filename)}</a>
      <input 
        type="text" 
        class="filename-input" 
        value="${escapeHtml(upload.original_filename)}"
        data-upload-id="${upload.id || ''}"
        style="display: none;"
      />
    </td>
    <td class="upload-date">${uploadDate}</td>
    <td class="upload-actions">
      <label class="hidden-toggle" title="${isHidden ? 'Hidden from public' : 'Visible to public'}">
        <input 
          type="checkbox" 
          class="hidden-checkbox"
          data-upload-id="${upload.id || ''}"
          aria-label="Toggle visibility for ${escapeHtml(upload.original_filename)}"
          ${isHidden ? 'checked' : ''}
        />

      </label>
      <button 
        type="button"
        class="icon-btn rename-upload-btn"
        data-upload-id="${upload.id || ''}"
        data-filename="${escapeHtml(upload.original_filename)}"
        title="Rename upload"
        aria-label="Rename ${escapeHtml(upload.original_filename)}"
      >
        ✏️
      </button>
      <button 
        type="button"
        class="icon-btn delete-upload-btn"
        data-filename="${escapeHtml(upload.original_filename)}"
        title="Delete upload"
        aria-label="Delete ${escapeHtml(upload.original_filename)}"
      >
        ✕
      </button>
    </td>
  `
}

// Delete an upload
async function deleteUpload(documentSlug: string, filename: string): Promise<void> {
  const editUrl = getEditUrl(documentSlug)
  const response = await fetch(`${editUrl}?upload=${encodeURIComponent(filename)}`, {
    method: 'DELETE',
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Error deleting file: ${error}`)
  }
}

// Update an upload (rename or toggle hidden)
async function updateUploadApi(
  documentSlug: string,
  uploadId: number,
  updates: {original_filename?: string; hidden?: boolean},
): Promise<{
  id: number
  filename: string
  original_filename: string
  hidden: boolean
  url: string
}> {
  const editUrl = getEditUrl(documentSlug)
  const response = await fetch(`${editUrl}?uploadId=${uploadId}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(updates),
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Error updating file: ${error}`)
  }

  return response.json()
}

// Initialize uploads table with delete handlers and file upload
function init(options: {documentPath: string}) {
  const {documentPath} = options
  const uploadsTable = document.querySelector('.uploads-table') as HTMLTableElement | null
  if (!uploadsTable) return

  // Setup file upload button
  const uploadFileBtn = document.getElementById('upload-file-btn')
  const fileUploadInput = document.getElementById('file-upload-input') as HTMLInputElement | null
  if (uploadFileBtn && fileUploadInput) {
    uploadFileBtn.addEventListener('click', () => {
      fileUploadInput.click()
    })

    fileUploadInput.addEventListener('change', async e => {
      const files = (e.target as HTMLInputElement).files
      if (!files || files.length === 0) return

      const editUrl = getEditUrl(documentPath)
      const uploadUrl = `${editUrl}?upload=true`

      for (const file of Array.from(files)) {
        const formData = new FormData()
        formData.append('file', file)

        try {
          const response = await fetch(uploadUrl, {
            method: 'POST',
            body: formData,
          })

          if (response.ok) {
            const data = await response.json()
            // Add new row to uploads table
            const tbody = uploadsTable?.querySelector('tbody')
            if (tbody) {
              removeEmptyMessage(tbody, '.no-uploads')

              // Add new upload row
              const tr = document.createElement('tr')
              tr.innerHTML = createUploadRow(data)
              tbody.appendChild(tr)
            }
          } else {
            const error = await response.text()
            alert(`Upload failed: ${error}`)
          }
        } catch (error) {
          console.error('Upload error:', error)
          alert(`Upload failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
        }
      }

      // Clear the file input
      fileUploadInput.value = ''
    })
  }

  // Handle various button/checkbox clicks using event delegation
  uploadsTable.addEventListener('click', async e => {
    const target = e.target as HTMLElement

    // Handle delete button
    if (target.classList.contains('delete-upload-btn')) {
      const filename = target.dataset.filename
      if (!filename) return

      if (!confirm(`Are you sure you want to delete "${filename}"? This action cannot be undone.`)) {
        return
      }

      try {
        await deleteUpload(documentPath, filename)

        // Remove the row from the table
        const tr = target.closest('tr')
        if (tr) {
          tr.remove()
        }

        // Check if table is now empty
        const tbody = uploadsTable.querySelector('tbody')
        if (tbody && tbody.children.length === 0) {
          // Reload to show "No uploads" message
          window.location.reload()
        }
      } catch (error) {
        alert((error as Error).message)
        console.error(error)
      }
    }

    // Handle rename button - toggle inline editing
    if (target.classList.contains('rename-upload-btn')) {
      const tr = target.closest('tr')
      if (!tr) return

      const filenameLink = tr.querySelector('.filename-link') as HTMLAnchorElement | null
      const filenameInput = tr.querySelector('.filename-input') as HTMLInputElement | null

      if (filenameLink && filenameInput) {
        // Toggle visibility
        filenameLink.style.display = 'none'
        filenameInput.style.display = 'inline-block'
        filenameInput.focus()
        filenameInput.select()
      }
    }
  })

  // Handle hidden checkbox changes
  uploadsTable.addEventListener('change', async e => {
    const target = e.target as HTMLElement

    if (target.classList.contains('hidden-checkbox')) {
      const checkbox = target as HTMLInputElement
      const uploadId = checkbox.dataset.uploadId
      if (!uploadId) return

      const tr = checkbox.closest('tr')

      try {
        const result = await updateUploadApi(documentPath, parseInt(uploadId, 10), {
          hidden: checkbox.checked,
        })

        // Update the UI to reflect the new state
        if (tr) {
          if (result.hidden) {
            tr.classList.add('upload-hidden')
          } else {
            tr.classList.remove('upload-hidden')
          }
        }

        // Update the filename link and data if it was changed (due to collision)
        const filenameLink = tr?.querySelector('.filename-link') as HTMLAnchorElement | null
        const filenameInput = tr?.querySelector('.filename-input') as HTMLInputElement | null
        const deleteBtn = tr?.querySelector('.delete-upload-btn') as HTMLElement | null

        if (filenameLink && result.original_filename) {
          filenameLink.textContent = result.original_filename
          filenameLink.href = result.url + (result.hidden ? '?reveal' : '')
        }
        if (filenameInput && result.original_filename) {
          filenameInput.value = result.original_filename
        }
        if (deleteBtn && result.original_filename) {
          deleteBtn.dataset.filename = result.original_filename
        }
      } catch (error) {
        // Revert checkbox state on error
        checkbox.checked = !checkbox.checked
        alert((error as Error).message)
        console.error(error)
      }
    }
  })

  // Handle filename input blur (save rename) and keydown (Enter to save, Escape to cancel)
  uploadsTable.addEventListener(
    'blur',
    async e => {
      const target = e.target as HTMLElement
      if (!target.classList.contains('filename-input')) return

      const input = target as HTMLInputElement
      const tr = input.closest('tr')
      const filenameLink = tr?.querySelector('.filename-link') as HTMLAnchorElement | null
      const uploadId = input.dataset.uploadId

      if (!filenameLink || !uploadId) {
        // Just hide input and show link
        input.style.display = 'none'
        if (filenameLink) filenameLink.style.display = 'inline'
        return
      }

      const originalFilename = filenameLink.textContent || ''
      const newFilename = input.value.trim()

      // If filename hasn't changed, just toggle back
      if (newFilename === originalFilename || !newFilename) {
        input.style.display = 'none'
        filenameLink.style.display = 'inline'
        input.value = originalFilename // Reset input value
        return
      }

      try {
        const result = await updateUploadApi(documentPath, parseInt(uploadId, 10), {
          original_filename: newFilename,
        })

        // Update all UI elements with the new filename
        filenameLink.textContent = result.original_filename
        filenameLink.href = result.url + (result.hidden ? '?reveal' : '')
        input.value = result.original_filename

        const deleteBtn = tr?.querySelector('.delete-upload-btn') as HTMLElement | null
        const renameBtn = tr?.querySelector('.rename-upload-btn') as HTMLElement | null
        const hiddenCheckbox = tr?.querySelector('.hidden-checkbox') as HTMLInputElement | null

        if (deleteBtn) deleteBtn.dataset.filename = result.original_filename
        if (renameBtn) renameBtn.dataset.filename = result.original_filename
        if (hiddenCheckbox) {
          hiddenCheckbox.checked = result.hidden
        }

        // Update hidden state
        if (result.hidden) {
          tr?.classList.add('upload-hidden')
        } else {
          tr?.classList.remove('upload-hidden')
        }
      } catch (error) {
        alert((error as Error).message)
        console.error(error)
        input.value = originalFilename // Reset on error
      }

      // Toggle back to link mode
      input.style.display = 'none'
      filenameLink.style.display = 'inline'
    },
    true,
  ) // Use capture to handle blur before it bubbles

  uploadsTable.addEventListener('keydown', e => {
    const target = e.target as HTMLElement
    if (!target.classList.contains('filename-input')) return

    const input = target as HTMLInputElement

    if (e.key === 'Enter') {
      e.preventDefault()
      input.blur() // Trigger blur handler to save
    } else if (e.key === 'Escape') {
      e.preventDefault()
      // Reset and hide without saving
      const tr = input.closest('tr')
      const filenameLink = tr?.querySelector('.filename-link') as HTMLAnchorElement | null
      if (filenameLink) {
        input.value = filenameLink.textContent || ''
        input.style.display = 'none'
        filenameLink.style.display = 'inline'
      }
    }
  })
}

// Update uploads table with fresh data
function update(options: {uploads: Upload[]; documentPath: string}) {
  const {uploads, documentPath} = options
  const uploadsTable = document.querySelector('.uploads-table') as HTMLTableElement | null
  if (!uploadsTable) return

  const tbody = uploadsTable.querySelector('tbody')
  if (!tbody) return

  // Clear existing rows
  tbody.innerHTML = ''

  if (uploads.length === 0) {
    tbody.innerHTML = '<tr><td colspan="3" class="no-uploads">No uploads yet</td></tr>'
    return
  }

  // Add rows for all uploads (no separate hidden section)
  uploads.forEach(upload => {
    const tr = document.createElement('tr')
    if (upload.hidden) {
      tr.classList.add('upload-hidden')
    }
    const uploadUrl =
      documentPath === '/'
        ? `/uploads/${encodeURIComponent(upload.original_filename)}`
        : `${documentPath}/uploads/${encodeURIComponent(upload.original_filename)}`

    tr.innerHTML = createUploadRow({...upload, url: uploadUrl})
    tbody.appendChild(tr)
  })
}

export const uploads = {
  init,
  update,
} satisfies EditorModule
