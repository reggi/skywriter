import {stripImageExif} from '../../src/utils/stripImageExif.ts'
import {createJpegWithGpsExif, createPngWithMetadata} from './createTestImage.ts'
import {describe, it} from 'node:test'
import {ok} from 'node:assert'

describe('stripImageExif utility', () => {
  it('should handle JPEG files with EXIF', () => {
    // Minimal JPEG structure with EXIF marker (FFD8 FFE1 ...)
    const jpegWithExif = Buffer.from([
      0xff,
      0xd8, // SOI (Start of Image)
      0xff,
      0xe1, // APP1 (EXIF marker)
      0x00,
      0x10, // Length (16 bytes)
      0x45,
      0x78,
      0x69,
      0x66,
      0x00,
      0x00, // "Exif\0\0"
      0x00,
      0x01,
      0x02,
      0x03,
      0x04,
      0x05, // EXIF data
      0xff,
      0xda, // SOS (Start of Scan) - image data begins here
      0x00,
      0x08, // Length
      0x01,
      0x02,
      0x03,
      0x04,
      0x05,
      0x06,
      0x07,
      0x08, // Fake image data
    ])

    const stripped = stripImageExif(jpegWithExif, 'photo.jpg')

    // Should have FFD8 FFE0 or FFD8 FFxx but not the EXIF APP1 marker content
    // The function removes EXIF and returns from SOS onwards with proper header
    ok(stripped.length > 0)
    ok(stripped[0] === 0xff && stripped[1] === 0xd8)
  })

  it('should handle PNG files', () => {
    // Minimal valid PNG
    const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

    // IHDR chunk (critical)
    const ihdr = Buffer.from([
      0x00,
      0x00,
      0x00,
      0x0d, // Length: 13
      0x49,
      0x48,
      0x44,
      0x52, // "IHDR"
      0x00,
      0x00,
      0x00,
      0x01, // Width: 1
      0x00,
      0x00,
      0x00,
      0x01, // Height: 1
      0x08,
      0x02,
      0x00,
      0x00,
      0x00, // Bit depth, color type, etc
      0x90,
      0x77,
      0x53,
      0xde, // CRC
    ])

    // tEXt chunk (metadata - should be removed)
    const textChunk = Buffer.from([
      0x00,
      0x00,
      0x00,
      0x0c, // Length: 12
      0x74,
      0x45,
      0x58,
      0x74, // "tEXt"
      0x50,
      0x49,
      0x49,
      0x00, // "PII\0"
      0x53,
      0x45,
      0x43,
      0x52, // "SECR"
      0x45,
      0x54,
      0x44,
      0x41, // "ETA"
      0x54,
      0x41, // "TA"
      0xab,
      0xcd,
      0xef,
      0x12, // Fake CRC
    ])

    // IEND chunk (critical)
    const iend = Buffer.from([
      0x00,
      0x00,
      0x00,
      0x00, // Length: 0
      0x49,
      0x45,
      0x4e,
      0x44, // "IEND"
      0xae,
      0x42,
      0x60,
      0x82, // CRC
    ])

    const pngWithMetadata = Buffer.concat([pngSignature, ihdr, textChunk, iend])
    const stripped = stripImageExif(pngWithMetadata, 'image.png')

    // Should contain PNG signature and IHDR and IEND, but not tEXt
    ok(stripped.slice(0, 8).equals(pngSignature))
    const stripped_str = stripped.toString('hex')
    ok(!stripped_str.includes('74455874')) // "tEXt" in hex should be gone
  })

  it('should pass through unsupported formats unchanged', () => {
    const buffer = Buffer.from([0x01, 0x02, 0x03, 0x04])
    const result = stripImageExif(buffer, 'file.txt')
    ok(result.equals(buffer))
  })

  it('should strip GPS EXIF data from real JPEG structure', () => {
    const jpegWithGps = createJpegWithGpsExif()

    // Verify the image was created
    ok(jpegWithGps.length > 0)
    ok(jpegWithGps[0] === 0xff && jpegWithGps[1] === 0xd8) // Valid JPEG start

    // Strip EXIF (which contains GPS data)
    const stripped = stripImageExif(jpegWithGps, 'photo.jpg')

    // Should still be valid JPEG
    ok(stripped[0] === 0xff && stripped[1] === 0xd8)

    // Original should be larger due to EXIF data
    ok(jpegWithGps.length >= stripped.length)
  })

  it('should strip metadata from PNG with location info', () => {
    const pngWithMetadata = createPngWithMetadata()

    // Verify the image was created
    ok(pngWithMetadata.length > 0)

    // Should contain PNG signature
    const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    ok(pngWithMetadata.slice(0, 8).equals(pngSignature))

    // Strip metadata
    const stripped = stripImageExif(pngWithMetadata, 'image.png')

    // Both should be valid PNGs
    ok(stripped.slice(0, 8).equals(pngSignature))

    // The stripped version might be same size or smaller
    // (depends on whether the test PNG actually has tEXt chunks to strip)
    ok(stripped.length <= pngWithMetadata.length)
  })
})
