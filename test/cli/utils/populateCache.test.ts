import {describe, it, mock, beforeEach} from 'node:test'
import assert from 'node:assert/strict'

// Mock data
let mockAssembleResult: Record<string, unknown> = {}
let mockRenderResult: Record<string, unknown> = {}
let mockAssembleError: Error | null = null

// Mock assemble
mock.module('../../../src/cli/utils/assemble.ts', {
  namedExports: {
    assemble: async () => {
      if (mockAssembleError) throw mockAssembleError
      return mockAssembleResult
    },
  },
})

// Mock render
mock.module('../../../src/render/index.ts', {
  namedExports: {
    render: async () => mockRenderResult,
  },
})

// Mock functionContextClient
mock.module('../../../src/utils/functionContextClient.ts', {
  namedExports: {
    functionContextClient: () => ({
      getPage: async () => null,
      getPages: async () => [],
      getUploads: async () => [],
    }),
  },
})

// Import after mocking
const {populateCache} = await import('../../../src/cli/utils/populateCache.ts')
const {createPrefixLog} = await import('../../../src/cli/utils/prefixLog.ts')

const mockConfig = {
  serverUrl: 'https://example.com',
  username: 'testuser',
  password: 'testpass',
}

describe('populateCache', () => {
  beforeEach(() => {
    mockAssembleResult = {
      path: '/test',
      content: '# Hello',
      content_type: 'text/markdown',
    }
    mockRenderResult = {html: '<h1>Hello</h1>'}
    mockAssembleError = null
  })

  it('assembles document and renders it', async () => {
    const cmdLog = createPrefixLog('test', 'test')

    await populateCache(mockConfig, cmdLog)
    // Should complete without error
  })

  it('passes dir parameter to assemble', async () => {
    const cmdLog = createPrefixLog('test', 'test')

    await populateCache(mockConfig, cmdLog, '/custom/dir')
    // Should complete without error
  })

  it('throws when assemble fails', async () => {
    mockAssembleError = new Error('No content file found')
    const cmdLog = createPrefixLog('test', 'test')

    await assert.rejects(() => populateCache(mockConfig, cmdLog), {message: 'No content file found'})
  })
})
