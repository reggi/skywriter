import {describe, it, mock, beforeEach} from 'node:test'
import assert from 'node:assert/strict'

// Mock data
let mockExecResult: {stdout: string; stderr: string} = {stdout: '', stderr: ''}
let mockExecError: Error | null = null
let mockConfirmResult = true

// Mock child_process
mock.module('node:child_process', {
  namedExports: {
    exec: (_cmd: string, ...args: unknown[]) => {
      const callback = args[args.length - 1] as (err: Error | null, result: {stdout: string; stderr: string}) => void
      if (mockExecError) {
        callback(mockExecError, {stdout: '', stderr: ''})
      } else {
        callback(null, mockExecResult)
      }
    },
    spawn: () => ({
      on: () => {},
      stdout: {on: () => {}},
      stderr: {on: () => {}},
    }),
    spawnSync: () => ({status: 0}),
  },
})

// Mock @inquirer/prompts
mock.module('@inquirer/prompts', {
  namedExports: {
    confirm: async () => mockConfirmResult,
  },
})

// Import after mocking
const {approveExec, loggedExec} = await import('../../../src/cli/utils/promptExec.ts')
const {createPrefixLog} = await import('../../../src/cli/utils/prefixLog.ts')

describe('approveExec', () => {
  beforeEach(() => {
    mockConfirmResult = true
    mockExecResult = {stdout: '', stderr: ''}
    mockExecError = null
  })

  it('returns immediately when autoApprove is true', async () => {
    await approveExec('echo hello', {autoApprove: true})
    // Should not throw
  })

  it('logs command when autoApprove with log', async () => {
    const log = createPrefixLog('test', 'test')
    await approveExec('echo hello', {autoApprove: true, log})
    // Should not throw
  })

  it('proceeds when user confirms', async () => {
    mockConfirmResult = true
    await approveExec('echo hello')
    // Should not throw
  })

  it('throws when user declines', async () => {
    mockConfirmResult = false
    await assert.rejects(() => approveExec('echo hello'), {message: 'Command cancelled by user'})
  })
})

describe('loggedExec', () => {
  beforeEach(() => {
    mockExecResult = {stdout: '', stderr: ''}
    mockExecError = null
  })

  it('executes a command and returns result', async () => {
    mockExecResult = {stdout: 'output\n', stderr: ''}

    const result = await loggedExec('echo hello')
    assert.equal(result.stdout, 'output\n')
  })

  it('logs stdout and stderr lines with PrefixLog', async () => {
    mockExecResult = {stdout: 'line1\nline2\n', stderr: 'warn1\n'}
    const log = createPrefixLog('test', 'test')

    const result = await loggedExec('echo hello', {log})
    assert.equal(result.stdout, 'line1\nline2\n')
    assert.equal(result.stderr, 'warn1\n')
  })

  it('handles empty output without log', async () => {
    mockExecResult = {stdout: '', stderr: ''}

    const result = await loggedExec('echo')
    assert.equal(result.stdout, '')
    assert.equal(result.stderr, '')
  })

  it('handles command with cwd option', async () => {
    mockExecResult = {stdout: 'ok\n', stderr: ''}

    const result = await loggedExec('pwd', {cwd: '/tmp'})
    assert.equal(result.stdout, 'ok\n')
  })

  it('throws when command fails', async () => {
    mockExecError = new Error('Command failed')

    await assert.rejects(() => loggedExec('bad-command'), {message: 'Command failed'})
  })
})
