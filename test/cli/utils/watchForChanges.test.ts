import {describe, it, beforeEach, mock} from 'node:test'
import assert from 'node:assert/strict'
import type {DiscoveryResult} from '../../../src/cli/middleware/types.ts'

// --- Mutable mock state ---

let mockEvents: Array<{eventType: string; filename: string | null}> = []
let mockWatchError: Error | null = null

let mockDiscoveryResult: DiscoveryResult = {
  documents: new Map(),
  sortedPaths: [],
  errors: [],
  duplicates: new Map(),
}
let mockDiscoverError: Error | null = null

let logInfoMessages: string[] = []
let logErrorMessages: Array<{msg: string; error?: unknown}> = []

// --- Mock modules before importing ---

mock.module('node:fs/promises', {
  namedExports: {
    watch: () => {
      if (mockWatchError) {
        return {
          [Symbol.asyncIterator]() {
            return {
              async next() {
                throw mockWatchError
              },
            }
          },
        }
      }
      return {
        [Symbol.asyncIterator]() {
          let index = 0
          return {
            async next() {
              if (index < mockEvents.length) {
                return {value: mockEvents[index++], done: false}
              }
              return {value: undefined, done: true}
            },
          }
        },
      }
    },
    readFile: async () => '{}',
    readdir: async () => [],
    stat: async () => ({isDirectory: () => true}),
    access: async () => {},
  },
})

mock.module('../../../src/cli/utils/discover.ts', {
  namedExports: {
    discoverDocuments: async () => {
      if (mockDiscoverError) throw mockDiscoverError
      return mockDiscoveryResult
    },
  },
})

mock.module('../../../src/cli/utils/log.ts', {
  defaultExport: {
    info: (...args: unknown[]) => {
      logInfoMessages.push(String(args[0]))
    },
    error: (msg: string, error?: unknown) => {
      logErrorMessages.push({msg, error})
    },
    warn: () => {},
  },
})

// Import after mocking
const {watchForChanges} = await import('../../../src/cli/utils/watchForChanges.ts')

const tick = (ms = 50) => new Promise(r => setTimeout(r, ms))

describe('watchForChanges', () => {
  beforeEach(() => {
    mockEvents = []
    mockWatchError = null
    mockDiscoveryResult = {
      documents: new Map(),
      sortedPaths: [],
      errors: [],
      duplicates: new Map(),
    }
    mockDiscoverError = null
    logInfoMessages = []
    logErrorMessages = []
  })

  it('filters out node_modules events', async () => {
    mockEvents = [{eventType: 'change', filename: 'node_modules/foo/bar.js'}]
    const callback = mock.fn()
    watchForChanges(callback)
    await tick()
    assert.equal(callback.mock.callCount(), 0)
    assert.equal(logInfoMessages.length, 0)
  })

  it('filters out .git events', async () => {
    mockEvents = [{eventType: 'change', filename: '.git/HEAD'}]
    const callback = mock.fn()
    watchForChanges(callback)
    await tick()
    assert.equal(callback.mock.callCount(), 0)
    assert.equal(logInfoMessages.length, 0)
  })

  it('filters out hidden files starting with .', async () => {
    mockEvents = [{eventType: 'change', filename: '.env'}]
    const callback = mock.fn()
    watchForChanges(callback)
    await tick()
    assert.equal(callback.mock.callCount(), 0)
    assert.equal(logInfoMessages.length, 0)
  })

  it('calls discoverDocuments and callback for settings.json changes', async () => {
    const docs = new Map([
      [
        'doc1',
        {path: 'doc1', fsPath: '/tmp/doc1', hasTemplate: false, hasSlot: false, templatePath: null, slotPath: null},
      ],
    ])
    mockDiscoveryResult = {
      documents: docs,
      sortedPaths: ['doc1'],
      errors: [],
      duplicates: new Map(),
    }
    mockEvents = [{eventType: 'change', filename: 'mydir/settings.json'}]
    const callback = mock.fn()
    watchForChanges(callback)
    await tick()
    assert.equal(callback.mock.callCount(), 1)
    assert.deepEqual(callback.mock.calls[0].arguments[0], mockDiscoveryResult)
    assert.ok(logInfoMessages.some(m => m.includes('Re-discovered 1 document(s)')))
  })

  it('logs file change for non-settings files', async () => {
    mockEvents = [{eventType: 'change', filename: 'src/index.ts'}]
    const callback = mock.fn()
    watchForChanges(callback)
    await tick()
    assert.equal(callback.mock.callCount(), 0)
    assert.ok(logInfoMessages.some(m => m.includes('File changed: src/index.ts')))
  })

  it('handles discoverDocuments errors gracefully', async () => {
    mockDiscoverError = new Error('discovery failed')
    mockEvents = [{eventType: 'change', filename: 'settings.json'}]
    const callback = mock.fn()
    watchForChanges(callback)
    await tick()
    assert.equal(callback.mock.callCount(), 0)
    assert.ok(logErrorMessages.some(e => e.msg.includes('Error re-discovering documents')))
  })

  it('ignores ERR_USE_AFTER_CLOSE errors', async () => {
    const err = new Error('watcher closed') as NodeJS.ErrnoException
    err.code = 'ERR_USE_AFTER_CLOSE'
    mockWatchError = err
    const callback = mock.fn()
    watchForChanges(callback)
    await tick()
    assert.equal(logErrorMessages.length, 0)
  })

  it('logs non-ERR_USE_AFTER_CLOSE watcher errors', async () => {
    const err = new Error('permission denied') as NodeJS.ErrnoException
    err.code = 'EACCES'
    mockWatchError = err
    const callback = mock.fn()
    watchForChanges(callback)
    await tick()
    assert.ok(logErrorMessages.some(e => e.msg.includes('Error watching files')))
  })
})
