/**
 * Parse a user-provided value into a canonical document path.
 *
 * Accepts:
 *   https://omega.com/something     → /something
 *   https://omega.com/something.git → /something
 *   omega.com/something             → /something
 *   omega.co.uk/cookie              → /cookie
 *   /something                      → /something
 *   something                       → /something
 */
export function parseDocumentPath(input: string): string {
  if (input.startsWith('http://') || input.startsWith('https://')) {
    const parsed = new URL(input)
    let path = parsed.pathname
    if (path.endsWith('.git')) {
      path = path.slice(0, -4)
    }
    return path || '/'
  }
  // Schemeless URL: contains a dot before the first slash (e.g. omega.com/meow)
  const slashIndex = input.indexOf('/')
  if (slashIndex > 0 && input.slice(0, slashIndex).includes('.')) {
    let path = input.slice(slashIndex)
    if (path.endsWith('.git')) {
      path = path.slice(0, -4)
    }
    return path || '/'
  }
  if (input.startsWith('/')) {
    return input
  }
  return `/${input}`
}
