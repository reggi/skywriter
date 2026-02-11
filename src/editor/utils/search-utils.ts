import {escapeHtml} from './html-utils.ts'

export interface SearchResult {
  id: number
  title: string
  path: string
  record_id: number
}

// Debounce helper function
function debounce<T extends (...args: string[]) => void>(func: T, wait: number): (...args: Parameters<T>) => void {
  let timeout: ReturnType<typeof setTimeout> | null = null
  return (...args: Parameters<T>) => {
    if (timeout) clearTimeout(timeout)
    timeout = setTimeout(() => func(...args), wait)
  }
}

// Perform search query via POST /edit?query=...
async function performSearch(query: string): Promise<SearchResult[]> {
  try {
    const encodedQuery = query.trim() ? encodeURIComponent(query) : ''
    const response = await fetch(`/edit?query=${encodedQuery}`, {
      method: 'POST',
    })

    if (!response.ok) {
      console.error('Search failed:', response.statusText)
      return []
    }

    const results = await response.json()
    return results
  } catch (error) {
    console.error('Search error:', error)
    return []
  }
}

// Show dropdown with search results
function showDropdown(dropdown: HTMLElement, results: SearchResult[], onSelect: (result: SearchResult) => void) {
  // Clear existing content
  dropdown.innerHTML = ''

  if (results.length === 0) {
    dropdown.innerHTML = '<div class="dropdown-item no-results">No results found</div>'
    dropdown.style.display = 'block'
    return
  }

  // Add result items
  results.forEach(result => {
    const item = document.createElement('div')
    item.className = 'dropdown-item'
    item.innerHTML = `
      <div class="dropdown-title">${escapeHtml(result.title)}</div>
      <div class="dropdown-path">${escapeHtml(result.path)}</div>
    `
    item.addEventListener('click', () => {
      onSelect(result)
      dropdown.style.display = 'none'
    })
    dropdown.appendChild(item)
  })

  dropdown.style.display = 'block'
}

// Hide dropdown
function hideDropdown(dropdown: HTMLElement) {
  dropdown.style.display = 'none'
}

// Shared search initialization helper
export function initSearch(
  searchInput: HTMLInputElement,
  dropdown: HTMLElement,
  onSelect: (result: SearchResult) => void,
  onClear: () => void,
  targetName: string,
) {
  // Debounced search function (50ms)
  const debouncedSearch = debounce(async (query: string) => {
    const results = await performSearch(query)
    showDropdown(dropdown, results, onSelect)
  }, 50)

  // Listen to input events
  searchInput.addEventListener('input', () => {
    const query = searchInput.value
    debouncedSearch(query)
  })

  // Handle focus - show dropdown if there are results
  searchInput.addEventListener('focus', async () => {
    if (dropdown.children.length > 0) {
      dropdown.style.display = 'block'
    } else if (!searchInput.value.trim()) {
      // If no value, fetch all results
      const results = await performSearch('')
      showDropdown(dropdown, results, onSelect)
    }
  })

  // Handle clicks (outside dropdown and clear buttons)
  document.addEventListener('click', e => {
    const target = e.target as HTMLElement

    // Hide dropdown when clicking outside
    if (!searchInput.contains(target) && !dropdown.contains(target)) {
      hideDropdown(dropdown)
    }

    // Handle clear button clicks
    if (target.matches(`.clear-selection[data-target="${targetName}"]`)) {
      onClear()
    }
  })
}

// Template/slot management functions
export type TemplateSlotInfo = {
  id: number
  title: string | null
  path: string
} | null

// Shared helper for updating template/slot DOM
export function updateSelectionDisplay(info: TemplateSlotInfo, searchInputId: string, targetName: string) {
  const searchInput = document.getElementById(searchInputId) as HTMLInputElement
  const formGroup = searchInput?.closest('.form-group')

  if (!formGroup || !searchInput) return

  // Remove existing selected item if any
  const existingSelected = formGroup.querySelector('.selected-item')
  if (existingSelected) {
    existingSelected.remove()
  }

  if (info) {
    // Create new selected item
    const selectedDiv = document.createElement('div')
    selectedDiv.className = 'selected-item'
    const editUrl = `${info.path}/edit`
    selectedDiv.innerHTML = `
      <a href="${escapeHtml(editUrl)}" class="selected-link" target="_blank" title="Edit ${escapeHtml(info.path)}">
        <strong>${escapeHtml(info.title || info.path)}</strong>
        <span class="selected-path">${escapeHtml(info.path)}</span>
      </a>
      <button type="button" class="clear-selection" data-target="${targetName}">✕</button>
    `

    // Insert before search input
    formGroup.insertBefore(selectedDiv, searchInput)
    searchInput.style.display = 'none'
    searchInput.value = ''
  } else {
    // Clear selection
    searchInput.style.display = ''
    searchInput.value = ''
  }
}
