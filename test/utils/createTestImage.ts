/**
 * Utility to create test image fixtures with EXIF/metadata data
 * These are real images generated with ImageMagick and exiftool containing actual EXIF data
 */

/**
 * Creates a JPEG with real GPS EXIF data
 * Generated with: convert (ImageMagick) and exiftool
 * Image: 100x100 black square
 * GPS EXIF: 40.7128° N, 74.0060° W (New York City)
 * Metadata: User comment with GPS coordinates
 */
export function createJpegWithGpsExif(): Buffer {
  // Real JPEG with GPS EXIF data - will show in Mac Preview and image viewers
  const base64 = `
    /9j/4AAQSkZJRgABAQAAAQABAAD/4QFqRXhpZgAATU0AKgAAAAgABgEaAAUAAAABAAAAVgEbAAUA
    AAABAAAAXgEoAAMAAAABAAEAAAITAAMAAAABAAEAAIdpAAQAAAABAAAAZoglAAQAAAABAAAA0AAA
    AAAAAAABAAAAAQAAAAEAAAABAAWQAAAHAAAABDAyMzKRAQAHAAAABAECAwCShgAHAAAAJwAAAKig
    AAAHAAAABDAxMDCgAQADAAAAAf//AAAAAAAAQVNDSUkAAABUZXN0IGltYWdlIHdpdGggR1BTIGNv
    b3JkaW5hdGVzAAAHAAAAAQAAAAQCAwAAAAEAAgAAAAJOAAAAAAIABQAAAAMAAAEqAAMAAgAAAAJX
    AAAAAAQABQAAAAMAAAFCAAUAAQAAAAEAAAAAAAYABQAAAAEAAAFaAAAAAAAAACgAAAABAAAAKgAA
    AAEAAASAAAAAGQAAAEoAAAABAAAAAAAAAAEAAABsAAAABQAAAAAAAAAB/9sAQwADAgICAgIDAgIC
    AwMDAwQGBAQEBAQIBgYFBgkICgoJCAkJCgwPDAoLDgsJCQ0RDQ4PEBAREAoMEhMSEBMPEBAQ/8AA
    CwgAZABkAQERAP/EABUAAQEAAAAAAAAAAAAAAAAAAAAJ/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/a
    AAgBAQAAPwCVQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD//Z
  `.replace(/\s/g, '')

  return Buffer.from(base64, 'base64')
}

/**
 * Creates a PNG with real metadata chunks containing GPS and other PII
 * Generated with: convert (ImageMagick) and exiftool
 * Image: 100x100 black square
 * Metadata: Comment with GPS location, Artist, Copyright info
 */
export function createPngWithMetadata(): Buffer {
  // Real PNG with text metadata chunks - will show in Mac Preview and image viewers
  const base64 = `
    iVBORw0KGgoAAAANSUhEUgAAAGQAAABkAQAAAABYmaj5AAAAIGNIUk0AAHomAACAhAAA+gAAAIDo
    AAB1MAAA6mAAADqYAAAXcJy6UTwAAAACYktHRAAB3YoTpAAAAAd0SU1FB+oCBQUNLcCv0cUAAAAl
    dEVYdGRhdGU6Y3JlYXRlADIwMjYtMDItMDVUMDU6MTM6NDUrMDA6MDCRZBEYAAAAJXRFWHRkYXRl
    Om1vZGlmeQAyMDI2LTAyLTA1VDA1OjEzOjQ1KzAwOjAw4DmppAAAACh0RVh0ZGF0ZTp0aW1lc3Rh
    bXAAMjAyNi0wMi0wNVQwNToxMzo0NSswMDowMLcsiHsAAAARdEVYdEFydGlzdABUZXN0IFN1aXRl
    dRamJAAAACd0RVh0Q29tbWVudABHUFMgTG9jYXRpb246IDQwLjcxMjhOIDc0LjAwNjBXiYq4+AAA
    ABR0RVh0Q29weXJpZ2h0AFRlc3QgSW1hZ2XCAniPAAAAFElEQVQ4y2NgGAWjYBSMglFATwAABXgA
    ASlxufwAAAAASUVORK5CYII=
  `.replace(/\s/g, '')

  return Buffer.from(base64, 'base64')
}
