import {describe, it, mock, beforeEach, afterEach} from 'node:test'
import assert from 'node:assert/strict'
import {createMockCliContext} from '../test-context.ts'
import {stripAnsi} from '../../helpers/stripAnsi.ts'
import {readFile as originalReadFile} from 'node:fs/promises'

// Mock data
let mockValidateSettingsResult: Array<{message: string; fix?: string; apply?: () => Promise<void>}> = []
let mockSettingsJson: Record<string, unknown> | null = {path: '/test'}

// Mock validatePathSettings
mock.module('../../../src/cli/pathOperations/validatePathSettings.ts', {
  namedExports: {
    validatePathSettings: async () => mockValidateSettingsResult,
  },
})

// Mock node:fs/promises to intercept settings.json reads
mock.module('node:fs/promises', {
  namedExports: {
    readFile: async (path: string, encoding?: BufferEncoding) => {
      if (String(path).endsWith('settings.json') && mockSettingsJson) {
        return JSON.stringify(mockSettingsJson)
      }
      if (String(path).endsWith('settings.json') && !mockSettingsJson) {
        throw new Error('ENOENT')
      }
      return (originalReadFile as typeof originalReadFile)(path, encoding)
    },
    writeFile: async () => {},
    mkdir: async () => {},
    readdir: async () => [],
    access: async () => {},
    stat: async () => ({isDirectory: () => true, isFile: () => false}),
  },
})

// Import after mocking
const {settings} = await import('../../../src/cli/commands/settings.ts')

const mockCtx = createMockCliContext()

// Capture combined output (proc-log + stdout)
let output: string[] = []
const originalStdoutWrite = process.stdout.write
const logHandler = () => {}
const captureHandler = (...args: unknown[]) => {
  output.push(args.slice(1).map(String).join(' '))
}
process.on('log', logHandler)

describe('settings command', () => {
  beforeEach(() => {
    mockValidateSettingsResult = []
    mockSettingsJson = {path: '/test'}
    output = []
    process.stdout.write = (chunk: string | Uint8Array) => {
      const lines = String(chunk).split('\n')
      for (const line of lines) {
        if (line) output.push(line)
      }
      return true
    }
    process.removeListener('log', logHandler)
    process.on('log', captureHandler)
  })

  afterEach(() => {
    process.stdout.write = originalStdoutWrite
    process.exitCode = undefined as unknown as number
    process.removeListener('log', captureHandler)
    process.on('log', logHandler)
  })

  it('reports valid settings when no issues found', async t => {
    mockValidateSettingsResult = []

    await settings(mockCtx)
    // Should complete without error
    t.assert.snapshot(output.map(stripAnsi))
  })

  it('reports issues without fix when no --fix flag', async t => {
    mockValidateSettingsResult = [{message: 'settings.json is missing the "path" field'}]

    await settings(mockCtx)
    // Should complete without error, just logging the issue
    t.assert.snapshot(output.map(stripAnsi))
  })

  it('reports fixable and unfixable issues', async t => {
    mockValidateSettingsResult = [
      {
        message: 'Template directory exists but template_path is not set',
        fix: 'Set template_path to "/tmpl"',
        apply: async () => {},
      },
      {message: 'Unfixable issue'},
    ]

    await settings(mockCtx)
    t.assert.snapshot(output.map(stripAnsi))
  })

  it('does not apply fixes when --fix is not set', async t => {
    let fixApplied = false
    mockValidateSettingsResult = [
      {
        message: 'Fixable issue',
        fix: 'Apply fix',
        apply: async () => {
          fixApplied = true
        },
      },
    ]

    await settings(mockCtx)
    assert.equal(fixApplied, false)
    t.assert.snapshot(output.map(stripAnsi))
  })

  it('applies fixes when --fix is set', async t => {
    let fixApplied = false
    mockValidateSettingsResult = [
      {
        message: 'Fixable issue',
        fix: 'Apply fix',
        apply: async () => {
          fixApplied = true
        },
      },
    ]

    await settings(mockCtx, {fix: true})
    assert.equal(fixApplied, true)
    t.assert.snapshot(output.map(stripAnsi))
  })

  it('handles mix of fixable and unfixable with --fix', async t => {
    let fixApplied = false
    mockValidateSettingsResult = [
      {
        message: 'Fixable issue',
        fix: 'Apply fix',
        apply: async () => {
          fixApplied = true
        },
      },
      {message: 'Manual fix required'},
    ]

    await settings(mockCtx, {fix: true})
    assert.equal(fixApplied, true)
    assert.equal(process.exitCode, 1)
    t.assert.snapshot(output.map(stripAnsi))
  })

  it('does not set exitCode when all issues are fixed', async t => {
    mockValidateSettingsResult = [
      {
        message: 'Fixable issue',
        fix: 'Apply fix',
        apply: async () => {},
      },
    ]

    await settings(mockCtx, {fix: true})
    assert.notEqual(process.exitCode, 1)
    t.assert.snapshot(output.map(stripAnsi))
  })

  it('--fix --json outputs fixed count, valid, and violations when all fixed', async t => {
    mockValidateSettingsResult = [
      {
        message: 'Fixable issue',
        fix: 'Apply fix',
        apply: async () => {},
      },
    ]

    await settings(createMockCliContext({json: true}), {fix: true})
    assert.notEqual(process.exitCode, 1)
    t.assert.snapshot(output.map(stripAnsi))
  })

  it('--fix --json outputs fixed count, valid, and remaining violations', async t => {
    mockValidateSettingsResult = [
      {
        message: 'Fixable issue',
        fix: 'Apply fix',
        apply: async () => {},
      },
      {message: 'Manual fix required'},
    ]

    await settings(createMockCliContext({json: true}), {fix: true})
    assert.equal(process.exitCode, 1)
    t.assert.snapshot(output.map(stripAnsi))
  })
})
