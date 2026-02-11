// HTML escape utility function
export function escapeHtml(str: string | null | undefined): string {
  if (str == null) return ''
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export function truncateMiddle(str: string | null | undefined, maxLength = 90): string {
  if (str == null) return ''
  if (str.length <= maxLength) return str
  if (maxLength <= 1) return '…'

  const remaining = maxLength - 1
  const head = Math.ceil(remaining / 2)
  const tail = Math.floor(remaining / 2)
  return `${str.slice(0, head)}…${str.slice(-tail)}`
}

export function getEditUrl(documentPath: string): string {
  return documentPath === '/' ? '/edit' : `${documentPath}/edit`
}

/**
 * Appends the host page's query params (window.location.search) to the given URL.
 *
 * If the URL already has a given key, it is left untouched.
 * Returns a path-relative URL (pathname + search).
 */
function withHostQueryParams(url: string): string {
  if (typeof window === 'undefined') return url

  const host = new URL(window.location.href)
  if (!host.search) return url

  const target = new URL(url, host.origin)

  for (const [key, value] of host.searchParams.entries()) {
    if (!target.searchParams.has(key)) {
      target.searchParams.append(key, value)
    }
  }

  return `${target.pathname}${target.search}`
}

export function getEditUrlWithHostQuery(documentPath: string): string {
  return withHostQueryParams(getEditUrl(documentPath))
}

export function removeEmptyMessage(tbody: HTMLElement, selector: string): void {
  const emptyMessage = tbody.querySelector(selector)
  if (emptyMessage) {
    emptyMessage.closest('tr')?.remove()
  }
}
