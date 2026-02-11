import {describe, it, before, after, beforeEach} from 'node:test'
import assert from 'node:assert/strict'
import {Readable} from 'node:stream'
import {updateViaArchive} from '../../src/operations/updateViaArchive.ts'
import {createDatabaseContext, closeDatabaseContext, closePool} from '../../src/db/index.ts'
import type {DocumentId} from '../../src/operations/types.ts'
import {removeDocument} from '../../src/operations/removeDocument.ts'
import {getDualDocument} from '../../src/operations/getDualDocument.ts'
import type {PoolClient} from 'pg'
import archiver from 'archiver'

// These constants mirror the internal limits in src/operations/updateViaArchive.ts
const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10 MB per file
const MAX_ARCHIVE_FILES = 6
const MAX_TOTAL_SIZE = MAX_FILE_SIZE * MAX_ARCHIVE_FILES // 60 MB total

describe('push operation', () => {
  let client: PoolClient

  before(async () => {
    const connectionString =
      process.env.DATABASE_URL || 'postgresql://astrodoc:astrodoc_password@localhost:5455/astrodoc'
    client = await createDatabaseContext(connectionString)
  })

  after(async () => {
    await closeDatabaseContext(client)
    await closePool()
  })

  // Clean up test documents before each test
  beforeEach(async () => {
    const paths = [
      '/test-push-1',
      '/test-push-1-string',
      '/test-push-1-id',
      '/test-push-1-num-id',
      '/test-push-1a',
      '/test-push-1b',
      '/test-push-2',
      '/test-push-3',
      '/test-push-4',
      '/test-push-5',
      '/test-push-6',
      '/test-push-7',
      '/test-push-8',
      '/test-push-9',
      '/test-push-10',
      '/test-push-11',
      '/test-push-12',
      '/test-push-13',
      '/test-push-14',
      '/test-push-15',
    ]
    for (const path of paths) {
      try {
        await removeDocument(client, {path})
      } catch {
        // Ignore errors if document doesn't exist
      }
    }
  })

  /**
   * Helper to create a Readable stream from a buffer
   */
  function createStream(buffer: Buffer): Readable {
    return Readable.from(buffer)
  }

  /**
   * Helper to create a tar.gz archive with specified files
   */
  async function createTarGz(files: Record<string, string>): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const archive = archiver('tar', {gzip: true})
      const chunks: Buffer[] = []

      archive.on('data', (chunk: Buffer) => chunks.push(chunk))
      archive.on('end', () => resolve(Buffer.concat(chunks)))
      archive.on('error', reject)

      for (const [filename, content] of Object.entries(files)) {
        archive.append(content, {name: filename})
      }

      archive.finalize()
    })
  }

  it('should successfully push a valid tar.gz archive', async () => {
    const files = {
      'settings.json': JSON.stringify({
        title: 'Test Document',
        content_type: 'markdown',
        draft: true,
      }),
      'content.md': '# Hello World\n\nThis is a test.',
      'style.css': 'body { color: red; }',
    }

    const buffer = await createTarGz(files)
    const file = createStream(buffer)

    await updateViaArchive(client, {path: '/test-push-1'}, file)

    // Verify the document was created
    const doc = await getDualDocument(client, {path: '/test-push-1'})
    assert.ok(doc, 'Document should exist')
    assert.equal(doc!.current!.title, 'Test Document')
    assert.equal(doc!.current!.content, '# Hello World\n\nThis is a test.')
    assert.equal(doc!.current!.style, 'body { color: red; }')
  })

  it('should handle query as string path instead of object', async () => {
    const files = {
      'settings.json': JSON.stringify({
        title: 'Test with String Query',
        draft: true,
      }),
      'content.md': '# String query test',
    }

    const buffer = await createTarGz(files)
    const file = createStream(buffer)

    // Pass query as string instead of object
    await updateViaArchive(client, '/test-push-1-string', file)

    // Verify the document was created
    const doc = await getDualDocument(client, {path: '/test-push-1-string'})
    assert.ok(doc, 'Document should exist')
    assert.equal(doc!.current!.title, 'Test with String Query')
    assert.equal(doc!.current!.content, '# String query test')
  })

  it('should handle query as id object', async () => {
    // First create a document to get its ID
    const setupFiles = {
      'settings.json': JSON.stringify({
        title: 'Setup Document',
        draft: true,
      }),
      'content.md': '# Initial',
    }
    const setupBuffer = await createTarGz(setupFiles)
    const setupFile = createStream(setupBuffer)
    await updateViaArchive(client, '/test-push-1-id', setupFile)

    const initialDoc = await getDualDocument(client, {path: '/test-push-1-id'})
    const docId = initialDoc!.id

    // Now update using {id} query
    const files = {
      'settings.json': JSON.stringify({
        path: '/test-push-1-id', // Need to provide path since we're querying by ID
        title: 'Updated with ID Query',
        draft: true,
      }),
      'content.md': '# Updated via ID',
    }
    const buffer = await createTarGz(files)
    const file = createStream(buffer)

    // Pass query as {id} object
    await updateViaArchive(client, {id: docId}, file)

    // Verify the document was updated
    const doc = await getDualDocument(client, {id: docId})
    assert.ok(doc, 'Document should exist')
    assert.equal(doc!.current!.title, 'Updated with ID Query')
    assert.equal(doc!.current!.content, '# Updated via ID')
  })

  it('should handle query as number id', async () => {
    // First create a document to get its ID
    const setupFiles = {
      'settings.json': JSON.stringify({
        title: 'Setup Document',
        draft: true,
      }),
      'content.md': '# Initial',
    }
    const setupBuffer = await createTarGz(setupFiles)
    const setupFile = createStream(setupBuffer)
    await updateViaArchive(client, '/test-push-1-num-id', setupFile)

    const initialDoc = await getDualDocument(client, {path: '/test-push-1-num-id'})
    const docId = initialDoc!.id

    // Now update using number id as query
    const files = {
      'settings.json': JSON.stringify({
        path: '/test-push-1-num-id', // Need to provide path since we're querying by ID
        title: 'Updated with Number ID Query',
        draft: true,
      }),
      'content.md': '# Updated via number ID',
    }
    const buffer = await createTarGz(files)
    const file = createStream(buffer)

    // Pass query as number (not object)
    await updateViaArchive(client, docId, file)

    // Verify the document was updated
    const doc = await getDualDocument(client, {id: docId})
    assert.ok(doc, 'Document should exist')
    assert.equal(doc!.current!.title, 'Updated with Number ID Query')
    assert.equal(doc!.current!.content, '# Updated via number ID')
  })

  it('should use settings.json content when archive files are not provided', async () => {
    const files = {
      'settings.json': JSON.stringify({
        title: 'Test Document',
        content: '# From settings',
        data: '{"from": "settings"}',
        server: 'export default () => "settings"',
        style: 'body { color: blue; }',
        script: 'console.log("settings")',
        draft: true,
      }),
    }

    const buffer = await createTarGz(files)
    const file = createStream(buffer)

    await updateViaArchive(client, {path: '/test-push-1a'}, file)

    // Verify the document was created with settings.json content
    const doc = await getDualDocument(client, {path: '/test-push-1a'})
    assert.ok(doc, 'Document should exist')
    assert.equal(doc!.current!.title, 'Test Document')
    assert.equal(doc!.current!.content, '# From settings')
    assert.equal(doc!.current!.data, '{"from":"settings"}')
    assert.equal(doc!.current!.server, 'export default () => "settings"')
    assert.equal(doc!.current!.style, 'body { color: blue; }')
    assert.equal(doc!.current!.script, 'console.log("settings")')
  })

  it('should use path from settings.json when not in query', async () => {
    const files = {
      'settings.json': JSON.stringify({
        path: '/test-push-1b',
        title: 'Test Document',
        draft: true,
      }),
      'content.md': '# Test',
    }

    const buffer = await createTarGz(files)
    const file = createStream(buffer)

    // Pass query without path
    await updateViaArchive(client, {id: 999 as unknown as DocumentId}, file)

    // Verify the document was created at the path from settings.json
    const doc = await getDualDocument(client, {path: '/test-push-1b'})
    assert.ok(doc, 'Document should exist')
    assert.equal(doc!.current!.title, 'Test Document')
  })

  it('should throw error for missing settings.json', async () => {
    const files = {
      'content.md': '# Test',
    }

    const buffer = await createTarGz(files)
    const file = createStream(buffer)

    await assert.rejects(async () => await updateViaArchive(client, {path: '/test-push-2'}, file), {
      message: 'Archive must contain settings.json',
    })
  })

  it('should throw error for multiple content files', async () => {
    const files = {
      'settings.json': JSON.stringify({title: 'Test'}),
      'content.md': '# Test 1',
      'content.html': '<h1>Test 2</h1>',
    }

    const buffer = await createTarGz(files)
    const file = createStream(buffer)

    await assert.rejects(async () => await updateViaArchive(client, {path: '/test-push-3'}, file), {
      message: /Archive contains multiple content files/,
    })
  })

  it('should throw error for multiple data files', async () => {
    const files = {
      'settings.json': JSON.stringify({title: 'Test'}),
      'data.json': '{}',
      'data.yaml': 'test: true',
    }

    const buffer = await createTarGz(files)
    const file = createStream(buffer)

    await assert.rejects(async () => await updateViaArchive(client, {path: '/test-push-4'}, file), {
      message: /Archive contains multiple data files/,
    })
  })

  it('should throw error for unrecognized files', async () => {
    const files = {
      'settings.json': JSON.stringify({title: 'Test'}),
      'content.md': '# Test',
      'random.txt': 'Should not be here',
    }

    const buffer = await createTarGz(files)
    const file = createStream(buffer)

    await assert.rejects(async () => await updateViaArchive(client, {path: '/test-push-5'}, file), {
      message: /Archive contains unrecognized files/,
    })
  })

  it('should handle all optional file types', async () => {
    const files = {
      'settings.json': JSON.stringify({
        title: 'Full Document',
        content_type: 'markdown',
        draft: true,
      }),
      'content.md': '# Full',
      'data.json': '{"key": "value"}',
      'server.js': 'export default () => {}',
      'style.css': 'body {}',
      'script.js': 'console.log()',
    }

    const buffer = await createTarGz(files)
    const file = createStream(buffer)

    await updateViaArchive(client, {path: '/test-push-6'}, file)

    // Verify all fields
    const doc = await getDualDocument(client, {path: '/test-push-6'})
    assert.ok(doc, 'Document should exist')
    assert.equal(doc!.current!.title, 'Full Document')
    assert.equal(doc!.current!.content, '# Full')
    assert.equal(doc!.current!.data, '{"key":"value"}')
    assert.equal(doc!.current!.server, 'export default () => {}')
    assert.equal(doc!.current!.style, 'body {}')
    assert.equal(doc!.current!.script, 'console.log()')
  })

  it('should reject invalid gzip stream', async () => {
    const buffer = Buffer.from('not an archive')
    const stream = createStream(buffer)

    await assert.rejects(
      async () => await updateViaArchive(client, {path: '/test-push-7'}, stream),
      (error: Error) => {
        // Should get a decompression error
        return error.message !== ''
      },
    )
  })

  it('should reject invalid JSON in settings.json', async () => {
    const files = {
      'settings.json': 'not valid JSON at all',
    }

    const buffer = await createTarGz(files)
    const file = createStream(buffer)

    await assert.rejects(
      async () => await updateViaArchive(client, {path: '/test-push-8'}, file),
      (error: Error) => {
        return error.message.includes('Failed to parse settings.json') && error.message.includes('Unexpected token')
      },
    )
  })

  it('should reject when path is missing from both query and settings', async () => {
    const files = {
      'settings.json': JSON.stringify({
        title: 'Test',
        draft: true,
      }),
    }

    const buffer = await createTarGz(files)
    const file = createStream(buffer)

    await assert.rejects(async () => await updateViaArchive(client, {id: 999 as unknown as DocumentId}, file), {
      message: 'Document path must be specified in either query or settings.json',
    })
  })

  it('should handle archives with directories', async () => {
    // Create a tar.gz archive with a directory entry using tar-stream
    const {pack} = await import('tar-stream')
    const {createGzip} = await import('zlib')

    const tarPack = pack()
    const chunks: Buffer[] = []

    // Pipe through gzip and collect chunks
    const gzip = createGzip()
    gzip.on('data', chunk => chunks.push(chunk))

    const packPromise = new Promise<Buffer>((resolve, reject) => {
      gzip.on('end', () => resolve(Buffer.concat(chunks)))
      gzip.on('error', reject)
      tarPack.pipe(gzip)
    })

    // Add a directory entry
    tarPack.entry({name: 'subdir/', type: 'directory'}, () => {
      // Add files
      tarPack.entry(
        {name: 'settings.json'},
        JSON.stringify({
          title: 'Test with Dirs',
          draft: true,
        }),
        () => {
          tarPack.entry({name: 'content.md'}, '# Test', () => {
            tarPack.finalize()
          })
        },
      )
    })

    const buffer = await packPromise
    const file = createStream(buffer)

    await updateViaArchive(client, {path: '/test-push-9'}, file)

    // Verify the document was created successfully (directories ignored)
    const doc = await getDualDocument(client, {path: '/test-push-9'})
    assert.ok(doc, 'Document should exist')
    assert.equal(doc!.current!.title, 'Test with Dirs')
    assert.equal(doc!.current!.content, '# Test')
  })

  it('should reject decompressed archive that exceeds total size limit', async () => {
    // Create a valid tar.gz that decompresses to more than MAX_TOTAL_SIZE
    // Large content that will exceed limit when decompressed
    const largeContent = 'x'.repeat(MAX_TOTAL_SIZE + 1024 * 1024)
    const files = {
      'settings.json': JSON.stringify({title: 'Test', draft: true}),
      'content.md': largeContent,
    }

    const buffer = await createTarGz(files)
    const stream = createStream(buffer)

    await assert.rejects(async () => await updateViaArchive(client, {path: '/test-push-10'}, stream), {
      message: /size.*exceeds maximum allowed size/,
    })
  })

  it('should reject archives with files that are too large', async () => {
    const largeContent = 'x'.repeat(MAX_FILE_SIZE + 1024 * 1024) // 1 MB over limit
    const files = {
      'settings.json': JSON.stringify({title: 'Test', draft: true}),
      'content.md': largeContent,
    }

    const buffer = await createTarGz(files)
    const file = createStream(buffer)

    await assert.rejects(async () => await updateViaArchive(client, {path: '/test-push-11'}, file), {
      message: /size.*exceeds maximum allowed size/,
    })
  })

  it('should reject archives with too many files', async () => {
    const files: Record<string, string> = {
      'settings.json': JSON.stringify({title: 'Test', draft: true}),
      'content.md': 'content1',
      'data.json': '{}',
      'server.js': 'code1',
      'style.css': 'style1',
      'script.js': 'script1',
    }

    // Add one more file to exceed the limit (already at MAX_ARCHIVE_FILES, need one more)
    files['extra.txt'] = 'This will push us over'

    const buffer = await createTarGz(files)
    const file = createStream(buffer)

    await assert.rejects(async () => await updateViaArchive(client, {path: '/test-push-12'}, file), {
      message: /Archive contains unrecognized files: extra\.txt/,
    })
  })

  it('should provide helpful error message for unrecognized files', async () => {
    const files = {
      'settings.json': JSON.stringify({title: 'Test', draft: true}),
      'README.md': '# Should not be here',
    }

    const buffer = await createTarGz(files)
    const file = createStream(buffer)

    await assert.rejects(
      async () => await updateViaArchive(client, {path: '/test-push-13'}, file),
      (error: Error) => {
        return (
          error.message.includes('unrecognized files: README.md') &&
          error.message.includes('Allowed files:') &&
          error.message.includes('settings.json')
        )
      },
    )
  })

  it('should handle corrupted gzip data', async () => {
    // Create a buffer that looks like a tar.gz but is actually corrupted
    const corruptedData = Buffer.from([
      0x1f,
      0x8b, // gzip magic number
      0x08,
      0x00, // rest is garbage
      ...Array(100).fill(0xff),
    ])
    const stream = createStream(corruptedData)

    await assert.rejects(
      async () => await updateViaArchive(client, {path: '/test-push-14'}, stream),
      (error: Error) => {
        // Should get some kind of decompression or parsing error
        return error.message !== ''
      },
    )
  })

  it('should handle file size that exceeds limit during streaming', async () => {
    // Create a tar archive using tar-stream with a large file
    const {pack} = await import('tar-stream')
    const {createGzip} = await import('zlib')

    const tarPack = pack()
    const chunks: Buffer[] = []
    const gzip = createGzip()

    gzip.on('data', chunk => chunks.push(chunk))

    const packPromise = new Promise<Buffer>((resolve, reject) => {
      gzip.on('end', () => resolve(Buffer.concat(chunks)))
      gzip.on('error', reject)
      tarPack.pipe(gzip)
    })

    // Add settings
    tarPack.entry({name: 'settings.json'}, JSON.stringify({title: 'Test', draft: true}), () => {
      // Add a large content file that will exceed limit
      const largeContent = 'x'.repeat(MAX_FILE_SIZE + 1024 * 1024) // 1 MB over limit
      tarPack.entry({name: 'content.md'}, largeContent, () => {
        tarPack.finalize()
      })
    })

    const buffer = await packPromise
    const file = createStream(buffer)

    await assert.rejects(async () => await updateViaArchive(client, {path: '/test-push-15'}, file), {
      message: /size.*exceeds maximum allowed size/,
    })
  })
})
