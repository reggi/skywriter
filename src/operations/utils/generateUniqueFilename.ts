/**
 * Escape special regex characters in a string
 */
function escapeRegExp(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Generate a unique filename by inserting a number before the extension
 * Pattern: file.png -> file-1.png -> file-2.png
 * This is used to rename displaced (hidden) uploads to avoid filename collisions.
 */
export function generateUniqueFilename(originalFilename: string, existingFilenames: string[]): string {
  // If the filename doesn't exist, use it as-is
  if (!existingFilenames.includes(originalFilename)) {
    return originalFilename
  }

  // Split filename into base and extension
  const lastDotIndex = originalFilename.lastIndexOf('.')
  const hasExtension = lastDotIndex > 0 // Must be after first char
  const baseName = hasExtension ? originalFilename.slice(0, lastDotIndex) : originalFilename
  const extension = hasExtension ? originalFilename.slice(lastDotIndex) : ''

  // Find existing numeric suffixes for this filename pattern
  // Pattern: basename-N.ext
  const regex = new RegExp(`^${escapeRegExp(baseName)}-(\\d+)${escapeRegExp(extension)}$`)

  let maxSuffix = 0
  for (const existing of existingFilenames) {
    const match = existing.match(regex)
    if (match) {
      const num = parseInt(match[1], 10)
      if (num > maxSuffix) {
        maxSuffix = num
      }
    }
  }

  // Return the next available suffix
  return `${baseName}-${maxSuffix + 1}${extension}`
}
