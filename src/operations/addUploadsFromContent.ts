import type {DocumentQuery, DbOperation} from './types.ts'
import type {SavedUpload} from '../operations/types.ts'
import {randomBytes} from 'crypto'
import {addUpload} from './addUpload.ts'
import mime from 'mime-types'

/**
 * Represents a foreign image found in content
 */
interface ForeignImage {
  /** The original URL of the image */
  url: string
  /** The full match string (for replacement) */
  match: string
  /** Type of match: 'html' for <img> tags, 'markdown' for ![alt](url) */
  type: 'html' | 'markdown'
  /** Alt text if available */
  alt?: string
}

/**
 * Check if a URL is a foreign (external) image URL
 * Returns false for:
 * - Relative URLs (./uploads/, uploads/, ../etc)
 * - Data URLs (data:image/...)
 * - Same-origin URLs (handled by checking protocol)
 */
function isForeignUrl(url: string): boolean {
  // Trim the URL
  const trimmed = url.trim()

  // Skip empty URLs
  if (!trimmed) return false

  // Skip data URLs
  if (trimmed.startsWith('data:')) return false

  // Skip relative URLs (uploads, ./, ../, etc)
  if (trimmed.startsWith('./') || trimmed.startsWith('../') || trimmed.startsWith('/')) return false
  if (trimmed.startsWith('uploads/')) return false

  // Check for absolute URLs with http/https protocol
  try {
    const parsed = new URL(trimmed)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    // Not a valid URL, likely relative
    return false
  }
}

/**
 * Extract the filename from a URL
 * Falls back to generating a random filename if extraction fails
 */
function extractFilenameFromUrl(url: string): string {
  try {
    const parsed = new URL(url)
    const pathname = parsed.pathname

    // Get the last segment of the path
    const segments = pathname.split('/').filter(Boolean)
    if (segments.length > 0) {
      const lastSegment = segments[segments.length - 1]
      // Decode URL-encoded characters
      const decoded = decodeURIComponent(lastSegment)
      // Remove query strings if present (shouldn't be, but just in case)
      const cleaned = decoded.split('?')[0]
      if (cleaned && cleaned.length > 0 && cleaned.length < 255) {
        // Ensure it has an extension, otherwise add .jpg as default
        if (!cleaned.includes('.')) {
          return `${cleaned}.jpg`
        }
        return cleaned
      }
    }
  } catch {
    // Fall through to random name
  }

  // Generate random filename with .jpg extension
  return `image-${randomBytes(4).toString('hex')}.jpg`
}

/**
 * Extract foreign images from HTML content
 * Matches <img src="..."> patterns
 */
function extractHtmlImages(content: string): ForeignImage[] {
  const images: ForeignImage[] = []

  // Match <img> tags with src attribute
  // Handles: src="url", src='url', src=url (unquoted)
  // Also captures alt attribute if present
  const imgRegex = /<img\s+[^>]*?src\s*=\s*(?:["']([^"']+)["']|([^\s>]+))[^>]*?>/gi

  let match
  while ((match = imgRegex.exec(content)) !== null) {
    const url = match[1] || match[2]
    if (url && isForeignUrl(url)) {
      // Try to extract alt text
      const altMatch = match[0].match(/alt\s*=\s*(?:["']([^"']*)["']|([^\s>]+))/i)
      const alt = altMatch ? altMatch[1] || altMatch[2] : undefined

      images.push({
        url,
        match: match[0],
        type: 'html',
        alt,
      })
    }
  }

  return images
}

/**
 * Extract foreign images from Markdown content
 * Matches ![alt](url) patterns
 */
function extractMarkdownImages(content: string): ForeignImage[] {
  const images: ForeignImage[] = []

  // Match markdown image syntax: ![alt](url) or ![alt](url "title")
  // Also handles empty alt: ![](url)
  const mdImageRegex = /!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g

  let match
  while ((match = mdImageRegex.exec(content)) !== null) {
    const alt = match[1]
    const url = match[2]
    if (url && isForeignUrl(url)) {
      images.push({
        url,
        match: match[0],
        type: 'markdown',
        alt: alt || undefined,
      })
    }
  }

  return images
}

/**
 * Extract all foreign images from content (both HTML and Markdown)
 */
function extractForeignImages(content: string): ForeignImage[] {
  const htmlImages = extractHtmlImages(content)
  const markdownImages = extractMarkdownImages(content)

  // Deduplicate by URL
  const seen = new Set<string>()
  const result: ForeignImage[] = []

  for (const img of [...htmlImages, ...markdownImages]) {
    if (!seen.has(img.url)) {
      seen.add(img.url)
      result.push(img)
    }
  }

  return result
}

/**
 * Result of downloading a foreign image
 */
interface DownloadedImage {
  /** The original foreign image info */
  original: ForeignImage
  /** The downloaded file data */
  data: Buffer
  /** The content type from the response */
  contentType: string | null
  /** Suggested filename based on URL and content type */
  filename: string
}

/**
 * Get file extension from content type using mime-types module
 */
function getExtensionFromContentType(contentType: string | null): string | null {
  if (!contentType) return null

  const type = contentType.split(';')[0].trim().toLowerCase()
  const ext = mime.extension(type)

  return ext ? `.${ext}` : null
}

/**
 * Download a single image from a URL
 */
async function downloadImage(image: ForeignImage, options: {timeout?: number} = {}): Promise<DownloadedImage | null> {
  const {timeout = 10000} = options

  try {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), timeout)

    const response = await fetch(image.url, {
      signal: controller.signal,
      headers: {
        // Some servers require a user agent
        'User-Agent': 'Mozilla/5.0 (compatible; Skywriter/1.0; +https://github.com/reggi/skywriter) Image Downloader',
      },
    })

    clearTimeout(timeoutId)

    if (!response.ok) {
      console.warn(`Failed to download image ${image.url}: HTTP ${response.status}`)
      return null
    }

    const contentType = response.headers.get('content-type')

    // Verify it's an image
    if (contentType && !contentType.startsWith('image/')) {
      console.warn(`URL ${image.url} did not return an image: ${contentType}`)
      return null
    }

    const arrayBuffer = await response.arrayBuffer()
    const data = Buffer.from(arrayBuffer)

    // Determine filename
    let filename = extractFilenameFromUrl(image.url)

    // If the filename doesn't have a proper extension, try to get one from content type
    const hasValidExtension = /\.(jpe?g|png|gif|webp|svg|bmp|tiff?|ico|avif|heic|heif)$/i.test(filename)
    if (!hasValidExtension) {
      const ext = getExtensionFromContentType(contentType)
      if (ext) {
        // Replace or add extension
        const base = filename.replace(/\.[^.]+$/, '')
        filename = base + ext
      }
    }

    return {
      original: image,
      data,
      contentType,
      filename,
    }
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      console.warn(`Timeout downloading image ${image.url}`)
    } else {
      console.warn(`Error downloading image ${image.url}:`, error)
    }
    return null
  }
}

/**
 * Download multiple images in parallel with concurrency limit
 */
async function downloadImages(
  images: ForeignImage[],
  options: {timeout?: number; concurrency?: number} = {},
): Promise<DownloadedImage[]> {
  const {concurrency = 5} = options

  const results: DownloadedImage[] = []
  const queue = [...images]

  async function worker() {
    while (queue.length > 0) {
      const image = queue.shift()
      if (image) {
        const result = await downloadImage(image, options)
        if (result) {
          results.push(result)
        }
      }
    }
  }

  // Start concurrent workers
  const workers = Array.from({length: Math.min(concurrency, images.length)}, () => worker())
  await Promise.all(workers)

  return results
}

/**
 * Replace foreign image URLs in content with local upload URLs
 */
function replaceForeignUrls(content: string, savedUploads: SavedUpload[]): string {
  let result = content

  for (const saved of savedUploads) {
    const {original, localUrl} = saved

    if (original.type === 'html') {
      // Replace the src attribute value in the img tag
      // We need to carefully replace just the URL, not the entire tag
      // Replace the URL within the matched img tag
      const newTag = original.match.replace(original.url, localUrl)
      result = result.replace(original.match, newTag)
    } else {
      // Markdown: replace the full ![alt](url) with ![alt](localUrl)
      const alt = original.alt || ''
      const newMarkdown = `![${alt}](${localUrl})`
      result = result.replace(original.match, newMarkdown)
    }
  }

  return result
}

/**
 * Process content to download foreign images and replace URLs
 * Returns the modified content with foreign images replaced by local uploads
 *
 * This function:
 * 1. Extracts foreign image URLs from HTML and Markdown content
 * 2. Downloads the images in parallel with concurrency limit
 * 3. Saves them as uploads using addUpload
 * 4. Replaces the original URLs with local upload URLs
 *
 * @param client Database client
 * @param query Document query (supports path string, id number, OptimisticDocument, Route, etc.)
 * @param uploadsPath Path to the uploads directory
 * @param content The content to process for foreign images
 * @returns Object with modified content and list of saved uploads
 */
export const addUploadsFromContent: DbOperation<
  [DocumentQuery, string, string],
  {content: string; uploads: SavedUpload[]}
> = async (client, query, uploadsPath, content) => {
  // Extract foreign images from content
  const foreignImages = extractForeignImages(content)

  if (foreignImages.length === 0) {
    return {content, uploads: []}
  }

  console.log(`Found ${foreignImages.length} foreign image(s) to process`)

  // Download images
  const downloadedImages = await downloadImages(foreignImages)

  if (downloadedImages.length === 0) {
    console.log('No images were successfully downloaded')
    return {content, uploads: []}
  }

  console.log(`Downloaded ${downloadedImages.length} image(s)`)

  // Save as uploads
  const savedUploads: SavedUpload[] = []

  for (const downloaded of downloadedImages) {
    try {
      // Use consolidated addUpload which handles:
      // - Unique storage filename generation
      // - Unique original_filename generation
      // - Database record creation
      // - File writing to disk
      const upload = await addUpload(client, query, uploadsPath, {
        data: downloaded.data,
        filename: downloaded.filename,
      })

      // Create local URL (relative)
      const localUrl = `./uploads/${encodeURIComponent(upload.original_filename)}`

      savedUploads.push({
        original: downloaded.original,
        localUrl,
        originalFilename: upload.original_filename,
      })
    } catch (error) {
      console.error(`Failed to save upload for ${downloaded.original.url}:`, error)
    }
  }

  if (savedUploads.length === 0) {
    console.log('No images were saved as uploads')
    return {content, uploads: []}
  }

  console.log(`Saved ${savedUploads.length} image(s) as uploads`)

  // Replace URLs in content
  const modifiedContent = replaceForeignUrls(content, savedUploads)

  return {content: modifiedContent, uploads: savedUploads}
}
