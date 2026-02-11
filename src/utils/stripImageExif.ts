/**
 * Strip EXIF and other metadata from images without external dependencies
 * Handles JPEG and PNG formats
 */

/**
 * Remove EXIF data from JPEG images
 * Finds the EXIF marker (0xFFE1) and removes everything up to the actual image data
 */
function stripJpegExif(buffer: Buffer): Buffer {
  // JPEG starts with FFD8
  if (buffer[0] !== 0xff || buffer[1] !== 0xd8) {
    return buffer
  }

  let pos = 2

  while (pos < buffer.length) {
    // Find marker (0xFF)
    if (buffer[pos] !== 0xff) {
      pos++
      continue
    }

    const marker = buffer[pos + 1]
    pos += 2

    // If we hit image data (0xDA = SOS - Start of Scan), keep everything from here
    if (marker === 0xda) {
      return Buffer.concat([Buffer.from([0xff, 0xd8]), buffer.slice(pos - 2)])
    }

    // EXIF marker is 0xE1 (APP1)
    if (marker === 0xe1) {
      // Read length of this segment (big-endian)
      const length = buffer.readUInt16BE(pos)
      // Skip this segment entirely
      pos += length
    } else if (
      // Skip other markers but keep them
      marker === 0xd0 ||
      marker === 0xd1 ||
      marker === 0xd2 ||
      marker === 0xd3 ||
      marker === 0xd4 ||
      marker === 0xd5 ||
      marker === 0xd6 ||
      marker === 0xd7 ||
      marker === 0xd8 ||
      marker === 0xd9 ||
      marker === 0x00 ||
      marker === 0x01
    ) {
      // RSTm and padding, no length to skip
    } else if (marker !== 0xff) {
      // Other markers have length fields
      const length = buffer.readUInt16BE(pos)
      pos += length
    }
  }

  return buffer
}

/**
 * Remove metadata chunks from PNG images
 * PNG format stores metadata in various chunks - we keep only essential ones
 */
function stripPngExif(buffer: Buffer): Buffer {
  // PNG signature
  const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

  // Check if it's a valid PNG
  if (!buffer.slice(0, 8).equals(pngSignature)) {
    return buffer
  }

  const chunks: Buffer[] = [pngSignature]
  let pos = 8

  // Chunks we want to keep (critical for image rendering)
  const keepChunks = new Set(['IHDR', 'PLTE', 'IDAT', 'IEND', 'gAMA', 'cHRM'])

  while (pos < buffer.length) {
    if (pos + 8 > buffer.length) break

    // Read chunk length (4 bytes, big-endian)
    const length = buffer.readUInt32BE(pos)

    // Read chunk type (4 bytes)
    const chunkType = buffer.slice(pos + 4, pos + 8).toString('ascii')

    // Calculate total chunk size (length + type + CRC)
    const totalChunkSize = 4 + 4 + length + 4

    if (pos + totalChunkSize > buffer.length) break

    // Keep critical chunks and discard metadata
    if (keepChunks.has(chunkType)) {
      chunks.push(buffer.slice(pos, pos + totalChunkSize))
    }

    pos += totalChunkSize
  }

  return Buffer.concat(chunks)
}

/**
 * Remove EXIF and metadata from image buffer based on file extension
 * Supports: JPEG, JPG, PNG
 *
 * @param buffer Image file buffer
 * @param filename Original filename (used to determine format)
 * @returns Buffer with EXIF/metadata stripped
 */
export function stripImageExif(buffer: Buffer, filename: string): Buffer {
  const ext = filename.toLowerCase().split('.').pop() || ''

  if (ext === 'jpg' || ext === 'jpeg') {
    return stripJpegExif(buffer)
  }

  if (ext === 'png') {
    return stripPngExif(buffer)
  }

  // For other formats, return as-is
  // (WebP, GIF, etc. would require more complex handling)
  return buffer
}
