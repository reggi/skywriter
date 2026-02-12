import {describe, it, mock, beforeEach} from 'node:test'
import assert from 'node:assert/strict'
import type {DocumentId, RenderDocument, DualDocument} from '../../src/operations/types.ts'
import type {PoolClient} from 'pg'

// Mock state
let mockUpsertResult: unknown = null
let mockUpsertError: Error | null = null
let mockGetDualDocumentResult: unknown = null
let mockGetDualDocumentError: Error | null = null
let mockGetRenderDocumentResult: unknown = null
let mockGetRenderDocumentError: Error | null = null
let upsertCalls: Array<{query: unknown; input: unknown}> = []
let getDualDocumentCalls: Array<{query: unknown}> = []
let getRenderDocumentCalls: Array<{query: unknown}> = []

// Mock the db operations
mock.module('../../src/operations/upsert.ts', {
  namedExports: {
    upsert: async (_client: unknown, query: unknown, input: unknown) => {
      upsertCalls.push({query, input})
      if (mockUpsertError) throw mockUpsertError
      return mockUpsertResult
    },
  },
})

mock.module('../../src/operations/getDualDocument.ts', {
  namedExports: {
    getDualDocument: async (_client: unknown, query: unknown) => {
      getDualDocumentCalls.push({query})
      if (mockGetDualDocumentError) throw mockGetDualDocumentError
      return mockGetDualDocumentResult
    },
  },
})

mock.module('../../src/operations/getRenderDocument.ts', {
  namedExports: {
    getRenderDocument: async (_client: unknown, query: unknown) => {
      getRenderDocumentCalls.push({query})
      if (mockGetRenderDocumentError) throw mockGetRenderDocumentError
      return mockGetRenderDocumentResult
    },
  },
})

// Mock functionContext to avoid database calls
mock.module('../../src/fn/functionContext.ts', {
  namedExports: {
    functionContext: () => ({}),
  },
})

// Import after mocking
const {getDocumentClientState} = await import('../../src/operations/getDocumentClientState.ts')

function resetMocks() {
  mockUpsertResult = null
  mockUpsertError = null
  mockGetDualDocumentResult = null
  mockGetDualDocumentError = null
  mockGetRenderDocumentResult = null
  mockGetRenderDocumentError = null
  upsertCalls = []
  getDualDocumentCalls = []
  getRenderDocumentCalls = []
}

describe('validateDocumentBody (via getDocumentClientState)', () => {
  beforeEach(() => {
    resetMocks()
  })

  it('should throw when body is not an object', async () => {
    const mockDb = {} as PoolClient
    await assert.rejects(async () => getDocumentClientState(mockDb, {path: '/test'}, 'string'), {
      message: 'Document must be an object',
    })
  })

  it('should throw for unexpected fields', async () => {
    const mockDb = {} as PoolClient
    await assert.rejects(async () => getDocumentClientState(mockDb, {path: '/test'}, {unknownField: 'value'}), {
      message: 'Unexpected fields: unknownField',
    })
  })

  it('should throw when content is not a string', async () => {
    const mockDb = {} as PoolClient
    await assert.rejects(async () => getDocumentClientState(mockDb, {path: '/test'}, {content: 123}), {
      message: 'content must be a string',
    })
  })

  it('should throw when data is not a string', async () => {
    const mockDb = {} as PoolClient
    await assert.rejects(async () => getDocumentClientState(mockDb, {path: '/test'}, {data: 123}), {
      message: 'data must be a string',
    })
  })

  it('should throw when style is not a string', async () => {
    const mockDb = {} as PoolClient
    await assert.rejects(async () => getDocumentClientState(mockDb, {path: '/test'}, {style: []}), {
      message: 'style must be a string',
    })
  })

  it('should throw when script is not a string', async () => {
    const mockDb = {} as PoolClient
    await assert.rejects(async () => getDocumentClientState(mockDb, {path: '/test'}, {script: true}), {
      message: 'script must be a string',
    })
  })

  it('should throw when template_id is not a number or null', async () => {
    const mockDb = {} as PoolClient
    await assert.rejects(async () => getDocumentClientState(mockDb, {path: '/test'}, {template_id: 'abc'}), {
      message: 'template_id must be a number or null',
    })
  })

  it('should throw when slot_id is not a number or null', async () => {
    const mockDb = {} as PoolClient
    await assert.rejects(async () => getDocumentClientState(mockDb, {path: '/test'}, {slot_id: 'abc'}), {
      message: 'slot_id must be a number or null',
    })
  })

  it('should throw when mime_type is not a string', async () => {
    const mockDb = {} as PoolClient
    await assert.rejects(async () => getDocumentClientState(mockDb, {path: '/test'}, {mime_type: 123}), {
      message: 'mime_type must be a string',
    })
  })

  it('should throw when extension is not a string', async () => {
    const mockDb = {} as PoolClient
    await assert.rejects(async () => getDocumentClientState(mockDb, {path: '/test'}, {extension: 123}), {
      message: 'extension must be a string',
    })
  })

  it('should throw when extension does not start with a dot', async () => {
    const mockDb = {} as PoolClient
    await assert.rejects(async () => getDocumentClientState(mockDb, {path: '/test'}, {extension: 'md'}), {
      message: 'extension must start with a dot (.)',
    })
  })

  it('should throw when draft is not a boolean', async () => {
    const mockDb = {} as PoolClient
    await assert.rejects(async () => getDocumentClientState(mockDb, {path: '/test'}, {draft: 'true'}), {
      message: 'draft must be a boolean',
    })
  })
})

function createMockRenderDocument(overrides: Partial<RenderDocument> = {}): RenderDocument {
  return {
    id: 1 as DocumentId,
    path: '/test',
    published: false,
    title: 'Test Document',
    content: '# Hello',
    data: '{}',
    style: '',
    script: '',
    server: '',
    template_id: null,
    slot_id: null,
    content_type: 'markdown',
    data_type: 'json',
    has_eta: false,
    mime_type: 'text/html',
    extension: '.html',
    created_at: new Date(),
    updated_at: new Date(),
    draft: false,
    redirects: [],
    uploads: [],
    ...overrides,
  }
}

function createMockDualDocument(overrides: Partial<DualDocument> = {}): DualDocument {
  return {
    id: 1 as DocumentId,
    path: '/test',
    published: false,
    current: {
      id: 1 as DocumentId,
      path: '/test',
      title: 'Test Document',
      content: '# Hello',
      data: '{}',
      style: '',
      script: '',
      server: '',
      template_id: null,
      slot_id: null,
      content_type: 'markdown',
      data_type: 'json',
      has_eta: false,
      mime_type: 'text/html',
      extension: '.html',
      published: false,
      created_at: new Date(),
      updated_at: new Date(),
    },
    draft: undefined,
    ...overrides,
  }
}

describe('getDocumentClientState', () => {
  beforeEach(() => {
    resetMocks()
  })

  it('should return null when document does not exist and no body provided', async () => {
    mockGetDualDocumentResult = null
    const mockDb = {} as PoolClient

    const result = await getDocumentClientState(mockDb, {path: '/nonexistent'})
    assert.equal(result, null)
    assert.equal(getDualDocumentCalls.length, 1)
  })

  it('should return document state when document exists', async () => {
    const dualDocument = createMockDualDocument()
    const renderDocument = createMockRenderDocument()
    mockGetDualDocumentResult = dualDocument
    mockGetRenderDocumentResult = renderDocument

    const mockDb = {} as PoolClient

    const result = await getDocumentClientState(mockDb, {path: '/test'})

    assert.ok(result)
    assert.equal(result.document.path, '/test')
    assert.ok(result.render.html !== undefined)
    assert.ok(Array.isArray(result.api))
    assert.ok(result.tabs)
    assert.ok(result.tabFilenames)
    assert.equal(getDualDocumentCalls.length, 1)
    assert.equal(getRenderDocumentCalls.length, 1)
  })

  it('should call upsert when document body is provided', async () => {
    const dualDocument = createMockDualDocument()
    const renderDocument = createMockRenderDocument()
    mockUpsertResult = dualDocument
    mockGetRenderDocumentResult = renderDocument

    const mockDb = {} as PoolClient

    const result = await getDocumentClientState(mockDb, {path: '/test'}, {content: '# Updated'})

    assert.ok(result)
    assert.equal(upsertCalls.length, 1)
    assert.deepEqual(upsertCalls[0].input, {content: '# Updated'})
  })

  it('should return null when upsert returns null', async () => {
    mockUpsertResult = null
    const mockDb = {} as PoolClient

    const result = await getDocumentClientState(mockDb, {path: '/test'}, {content: '# New'})
    assert.equal(result, null)
  })

  it('should throw error when getRenderDocument returns null', async () => {
    const dualDocument = createMockDualDocument()
    mockGetDualDocumentResult = dualDocument
    mockGetRenderDocumentResult = null

    const mockDb = {} as PoolClient

    await assert.rejects(async () => getDocumentClientState(mockDb, {path: '/test'}), {
      message: 'RenderDocument not found for preview',
    })
  })

  it('should handle draft content differences in tabs', async () => {
    const dualDocument = createMockDualDocument({
      current: {
        id: 1 as DocumentId,
        path: '/test',
        title: 'Test Document',
        content: '# Original',
        data: '{}',
        style: 'body {}',
        script: 'console.log(1)',
        server: '',
        template_id: null,
        slot_id: null,
        content_type: 'markdown',
        data_type: 'json',
        has_eta: false,
        mime_type: 'text/html',
        extension: '.html',
        published: false,
        created_at: new Date(),
        updated_at: new Date(),
      },
      draft: {
        id: 1 as DocumentId,
        path: '/test',
        title: 'Test Document',
        content: '# Changed',
        data: '{"key": "value"}',
        style: 'body {}',
        script: 'console.log(2)',
        server: 'export default {}',
        template_id: null,
        slot_id: null,
        content_type: 'markdown',
        data_type: 'json',
        has_eta: false,
        mime_type: 'text/html',
        extension: '.html',
        published: false,
        created_at: new Date(),
        updated_at: new Date(),
      },
    })
    const renderDocument = createMockRenderDocument({
      content: '# Changed',
      data: '{"key": "value"}',
      script: 'console.log(2)',
      server: 'export default {}',
    })
    mockGetDualDocumentResult = dualDocument
    mockGetRenderDocumentResult = renderDocument

    const mockDb = {} as PoolClient

    const result = await getDocumentClientState(mockDb, {path: '/test'})

    assert.ok(result)
    assert.ok(result.tabs)
    assert.equal(result.tabs.content.hasDraft, true)
    assert.equal(result.tabs.data.hasDraft, true)
    assert.equal(result.tabs.style.hasDraft, false)
    assert.equal(result.tabs.script.hasDraft, true)
    assert.equal(result.tabs.server.hasDraft, true)
  })

  it('should correctly detect empty tabs', async () => {
    const dualDocument = createMockDualDocument()
    const renderDocument = createMockRenderDocument({
      content: '',
      data: '   ',
      style: '',
      script: '',
      server: '',
    })
    mockGetDualDocumentResult = dualDocument
    mockGetRenderDocumentResult = renderDocument

    const mockDb = {} as PoolClient

    const result = await getDocumentClientState(mockDb, {path: '/test'})

    assert.ok(result)
    assert.ok(result.tabs)
    assert.equal(result.tabs.content.isEmpty, true)
    assert.equal(result.tabs.data.isEmpty, true)
    assert.equal(result.tabs.style.isEmpty, true)
    assert.equal(result.tabs.script.isEmpty, true)
    assert.equal(result.tabs.server.isEmpty, true)
  })

  it('should pass requestQuery to render function', async () => {
    const dualDocument = createMockDualDocument()
    const renderDocument = createMockRenderDocument()
    mockGetDualDocumentResult = dualDocument
    mockGetRenderDocumentResult = renderDocument

    const mockDb = {} as PoolClient

    const result = await getDocumentClientState(mockDb, {path: '/test'}, undefined, {foo: 'bar'})

    assert.ok(result)
    // Query is passed to render - verify result is returned
    assert.ok(result.render.html !== undefined)
  })

  it('should transform data based on data_type', async () => {
    const dualDocument = createMockDualDocument()
    const renderDocument = createMockRenderDocument({
      data: '{"key":"value"}',
      data_type: 'json',
    })
    mockGetDualDocumentResult = dualDocument
    mockGetRenderDocumentResult = renderDocument

    const mockDb = {} as PoolClient

    const result = await getDocumentClientState(mockDb, {path: '/test'})

    assert.ok(result)
    // Data should be transformed (pretty printed for json)
    assert.ok(result.document.data.includes('key'))
  })
})

describe('getDocumentClientState additional tests', () => {
  beforeEach(() => {
    resetMocks()
  })

  it('should return document state with all expected fields', async () => {
    const dualDocument = createMockDualDocument()
    const renderDocument = createMockRenderDocument()
    mockGetDualDocumentResult = dualDocument
    mockGetRenderDocumentResult = renderDocument

    const mockDb = {} as PoolClient

    const result = await getDocumentClientState(mockDb, {path: '/test'})

    assert.ok(result)
    assert.ok(result.document)
    assert.ok(result.render)
    assert.ok(result.tabs)
  })

  it('should return null for non-existent document', async () => {
    mockGetDualDocumentResult = null
    const mockDb = {} as PoolClient

    const result = await getDocumentClientState(mockDb, {path: '/nonexistent'})

    assert.equal(result, null)
  })

  it('should throw on database error', async () => {
    mockGetDualDocumentError = new Error('Database connection failed')
    const mockDb = {} as PoolClient

    await assert.rejects(async () => getDocumentClientState(mockDb, {path: '/test'}), {
      message: 'Database connection failed',
    })
  })

  it('should pass requestQuery to render function', async () => {
    const dualDocument = createMockDualDocument()
    const renderDocument = createMockRenderDocument()
    mockGetDualDocumentResult = dualDocument
    mockGetRenderDocumentResult = renderDocument

    const mockDb = {} as PoolClient

    const result = await getDocumentClientState(mockDb, {path: '/test'}, undefined, {page: '1'})

    assert.ok(result)
    assert.ok(result.document)
  })

  it('should handle upsert with document input', async () => {
    const dualDocument = createMockDualDocument()
    const renderDocument = createMockRenderDocument()
    mockUpsertResult = dualDocument
    mockGetRenderDocumentResult = renderDocument

    const mockDb = {} as PoolClient

    const result = await getDocumentClientState(mockDb, {path: '/test'}, {content: '# New content'})

    assert.ok(result)
    assert.equal(upsertCalls.length, 1)
  })
})
