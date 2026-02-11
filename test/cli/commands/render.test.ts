import {describe, it, afterEach, beforeEach, mock} from 'node:test'
import assert from 'node:assert/strict'
import {stripAnsi} from '../../helpers/stripAnsi.ts'

// Mock data
let mockDocument = {}
let mockRendered = {}

// Mock assemble module
mock.module('../../../src/cli/utils/assemble.ts', {
  namedExports: {
    assemble: async () => mockDocument,
  },
})

// Mock render module
mock.module('../../../src/render/index.ts', {
  namedExports: {
    render: async () => mockRendered,
  },
})

// Import after mocking
const {render: renderCommand} = await import('../../../src/cli/commands/render.ts')
import {mockCliContext} from '../test-context.ts'

// Capture stdout output
let stdoutOutput: string[] = []
const originalStdoutWrite = process.stdout.write

describe('renderCommand', () => {
  beforeEach(() => {
    stdoutOutput = []
    mockDocument = {}
    mockRendered = {}
    process.stdout.write = (chunk: string | Uint8Array) => {
      stdoutOutput.push(String(chunk))
      return true
    }
  })

  afterEach(() => {
    process.stdout.write = originalStdoutWrite
  })

  describe('output format', () => {
    it('outputs rendered document as JSON', async t => {
      mockDocument = {path: '/test', content: 'hello'}
      mockRendered = {html: '<p>hello</p>', path: '/test'}

      await renderCommand(mockCliContext)

      assert.equal(stdoutOutput.length, 1)
      const output = JSON.parse(stdoutOutput[0])
      assert.equal(output.html, '<p>hello</p>')
      assert.equal(output.path, '/test')
      t.assert.snapshot(stripAnsi(stdoutOutput.join('')))
    })

    it('outputs empty object when rendered result is empty', async t => {
      mockDocument = {}
      mockRendered = {}

      await renderCommand(mockCliContext)

      assert.equal(stdoutOutput.length, 1)
      const output = JSON.parse(stdoutOutput[0])
      assert.deepEqual(output, {})
      t.assert.snapshot(stripAnsi(stdoutOutput.join('')))
    })

    it('preserves all rendered properties in output', async t => {
      mockDocument = {path: '/docs', content: '# Title'}
      mockRendered = {
        html: '<h1>Title</h1>',
        path: '/docs',
        title: 'Title',
        style: 'body { color: red; }',
        script: 'console.log("hello")',
      }

      await renderCommand(mockCliContext)

      const output = JSON.parse(stdoutOutput[0])
      assert.equal(output.html, '<h1>Title</h1>')
      assert.equal(output.path, '/docs')
      assert.equal(output.title, 'Title')
      assert.equal(output.style, 'body { color: red; }')
      assert.equal(output.script, 'console.log("hello")')
      t.assert.snapshot(stripAnsi(stdoutOutput.join('')))
    })

    it('handles complex nested data in rendered output', async t => {
      mockDocument = {path: '/test'}
      mockRendered = {
        html: '<div>test</div>',
        metadata: {
          author: 'Test Author',
          tags: ['tag1', 'tag2'],
        },
      }

      await renderCommand(mockCliContext)

      const output = JSON.parse(stdoutOutput[0])
      assert.deepEqual(output.metadata, {
        author: 'Test Author',
        tags: ['tag1', 'tag2'],
      })
      t.assert.snapshot(stripAnsi(stdoutOutput.join('')))
    })
  })
})
