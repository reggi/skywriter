import {escapeHtml, getEditUrl, removeEmptyMessage} from '../utils/html-utils.ts'
import {EditorModule} from '../utils/types.ts'

interface Route {
  id: number
  path: string
  document_id: number
  created_at: Date
}

// Helper to create redirect row HTML
function createRedirectRow(redirect: {id?: number; path: string; created_at?: Date}): string {
  const redirectDate = redirect.created_at
    ? new Date(redirect.created_at).toLocaleDateString()
    : new Date().toLocaleDateString()

  return `
    <td class="redirect-path">${escapeHtml(redirect.path)}</td>
    <td class="redirect-date">${redirectDate}</td>
    <td class="redirect-actions">
      <button 
        type="button"
        class="icon-btn delete-redirect-btn"
        data-path="${escapeHtml(redirect.path)}"
        title="Delete redirect"
        aria-label="Delete redirect ${escapeHtml(redirect.path)}"
      >
        🗑️
      </button>
    </td>
  `
}

// Delete a redirect
async function deleteRedirect(documentSlug: string, redirectPath: string): Promise<void> {
  const editUrl = getEditUrl(documentSlug)
  const response = await fetch(`${editUrl}?redirect=${encodeURIComponent(redirectPath)}`, {
    method: 'DELETE',
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Error deleting redirect: ${error}`)
  }
}

// Add a redirect
async function addRedirect(
  documentSlug: string,
  redirectPath: string,
): Promise<{redirect: {id: number; path: string}}> {
  const editUrl = getEditUrl(documentSlug)
  const response = await fetch(`${editUrl}?redirect=true`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({redirect: redirectPath}),
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Error adding redirect: ${error}`)
  }

  return response.json()
}

// Initialize redirects table with add/delete handlers
function init(options: {documentPath: string}) {
  const {documentPath} = options
  const redirectsTable = document.querySelector('.redirects-table') as HTMLTableElement | null
  if (!redirectsTable) return

  // Setup add redirect button
  const addRedirectBtn = document.getElementById('add-redirect-btn')
  const redirectPathInput = document.getElementById('redirect-path-input') as HTMLInputElement | null
  if (addRedirectBtn && redirectPathInput) {
    addRedirectBtn.addEventListener('click', async () => {
      const redirectPath = redirectPathInput.value.trim()
      if (!redirectPath) {
        alert('Please enter a path to redirect from')
        return
      }

      if (!redirectPath.startsWith('/')) {
        alert('Redirect path must start with /')
        return
      }

      try {
        const data = await addRedirect(documentPath, redirectPath)

        // Add new row to redirects table
        const tbody = redirectsTable?.querySelector('tbody')
        if (tbody) {
          removeEmptyMessage(tbody, '.no-redirects')

          // Add new redirect row
          const tr = document.createElement('tr')
          tr.innerHTML = createRedirectRow({path: redirectPath, id: data.redirect?.id})
          tbody.appendChild(tr)
        }

        // Clear the input field
        redirectPathInput.value = ''
      } catch (error) {
        console.error('Add redirect error:', error)
        alert(`Failed to add redirect: ${error instanceof Error ? error.message : 'Unknown error'}`)
      }
    })

    // Allow Enter key to submit
    redirectPathInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        e.preventDefault()
        addRedirectBtn.click()
      }
    })
  }

  // Handle delete button clicks
  redirectsTable.addEventListener('click', async e => {
    const target = e.target as HTMLElement

    if (target.classList.contains('delete-redirect-btn')) {
      // Get the redirect path from the table row
      const tr = target.closest('tr')
      if (!tr) return

      const pathCell = tr.querySelector('.redirect-path')
      if (!pathCell) return

      const redirectPath = pathCell.textContent?.trim()
      if (!redirectPath) return

      if (
        !confirm(`Are you sure you want to delete the redirect from "${redirectPath}"? This action cannot be undone.`)
      ) {
        return
      }

      try {
        await deleteRedirect(documentPath, redirectPath)

        // Remove the row from the table
        tr.remove()

        // Check if table is now empty
        const tbody = redirectsTable.querySelector('tbody')
        if (tbody && tbody.children.length === 0) {
          // Reload to show "No redirects" message
          window.location.reload()
        }
      } catch (error) {
        alert((error as Error).message)
        console.error(error)
      }
    }
  })
}

// Update redirects table with fresh data
function update(options: {redirects: Route[]}) {
  const {redirects} = options
  const redirectsTable = document.querySelector('.redirects-table') as HTMLTableElement | null
  if (!redirectsTable) return

  const tbody = redirectsTable.querySelector('tbody')
  if (!tbody) return

  // Clear existing rows
  tbody.innerHTML = ''

  if (redirects.length === 0) {
    tbody.innerHTML = '<tr><td colspan="3" class="no-redirects">No redirects yet</td></tr>'
    return
  }

  // Add rows for each redirect
  redirects.forEach(redirect => {
    const tr = document.createElement('tr')
    tr.innerHTML = createRedirectRow(redirect)
    tbody.appendChild(tr)
  })
}

export const redirects = {
  init,
  update,
} satisfies EditorModule
