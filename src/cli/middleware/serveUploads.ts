import type {CliMiddlewareFactory, DiscoveryGetter} from './types.ts'
import {createReadStream} from 'node:fs'
import {access} from 'node:fs/promises'
import {join} from 'node:path'
import {lookup} from 'mime-types'

/**
 * Middleware that serves files from document upload directories.
 *
 * Handles uploads from:
 * - Document uploads: /doc-path/uploads/filename
 * - Template uploads: /template-path/uploads/filename
 * - Slot uploads: /slot-path/uploads/filename
 *
 * @param getDiscovery - Getter function for the current discovery result
 * @returns Middleware handler
 *
 * @example
 * ```ts
 * let discovery = await discoverDocuments()
 * app.get('/*', serveUploads(() => discovery), ...)
 * ```
 */
export const serveUploads: CliMiddlewareFactory<[getDiscovery: DiscoveryGetter]> = getDiscovery => {
  return async (c, next) => {
    const discovery = getDiscovery()
    const requestPath = c.req.path

    // Check if this looks like an uploads request
    if (!requestPath.includes('/uploads/')) {
      return next()
    }

    // Try to match against all known documents
    for (const [path, info] of discovery.documents) {
      // Check document uploads
      const uploadsPrefix = `${path === '/' ? '' : path}/uploads/`
      if (requestPath.startsWith(uploadsPrefix)) {
        const filename = requestPath.slice(uploadsPrefix.length)
        const uploadsDir = join(info.fsPath, 'uploads')
        const response = await serveFile(uploadsDir, filename)
        if (response) return response
      }

      // Check template uploads
      if (info.hasTemplate && info.templatePath) {
        const templateUploadsPrefix = `${info.templatePath === '/' ? '' : info.templatePath}/uploads/`
        if (requestPath.startsWith(templateUploadsPrefix)) {
          const filename = requestPath.slice(templateUploadsPrefix.length)
          const uploadsDir = join(info.fsPath, 'template', 'uploads')
          const response = await serveFile(uploadsDir, filename)
          if (response) return response
        }
      }

      // Check slot uploads
      if (info.hasSlot && info.slotPath) {
        const slotUploadsPrefix = `${info.slotPath === '/' ? '' : info.slotPath}/uploads/`
        if (requestPath.startsWith(slotUploadsPrefix)) {
          const filename = requestPath.slice(slotUploadsPrefix.length)
          const uploadsDir = join(info.fsPath, 'slot', 'uploads')
          const response = await serveFile(uploadsDir, filename)
          if (response) return response
        }
      }
    }

    return next()
  }
}

/**
 * Serve a file from the specified directory
 * @returns Response if file exists, null otherwise
 */
async function serveFile(uploadsDir: string, filename: string): Promise<Response | null> {
  if (!filename) {
    return null
  }

  const filePath = join(uploadsDir, filename)

  try {
    // Check if file exists and is accessible
    await access(filePath)

    // Stream file
    const fileStream = createReadStream(filePath)

    // Determine content type
    const mimeType = lookup(filename) || 'application/octet-stream'

    return new Response(fileStream as unknown as ReadableStream, {
      headers: {
        'Content-Type': mimeType,
      },
    })
  } catch {
    return null
  }
}
