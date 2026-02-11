import {describe, it, beforeEach, afterEach} from 'node:test'
import assert from 'node:assert/strict'
import log from '../../../src/cli/utils/log.ts'

describe('log', () => {
  let capturedLogs: Array<{level: string; args: unknown[]}>
  const logHandler = (level: string, ...args: unknown[]) => {
    capturedLogs.push({level, args})
  }

  beforeEach(() => {
    capturedLogs = []
    process.on('log', logHandler)
  })

  afterEach(() => {
    process.removeListener('log', logHandler)
  })

  it('info emits log event with info level', () => {
    log.info('hello world')
    assert.equal(capturedLogs.length, 1)
    assert.equal(capturedLogs[0].level, 'info')
    assert.deepEqual(capturedLogs[0].args, ['hello world'])
  })

  it('warn emits log event with warn level', () => {
    log.warn('be careful')
    assert.equal(capturedLogs.length, 1)
    assert.equal(capturedLogs[0].level, 'warn')
    assert.deepEqual(capturedLogs[0].args, ['be careful'])
  })

  it('error emits log event with error level', () => {
    log.error('something broke')
    assert.equal(capturedLogs.length, 1)
    assert.equal(capturedLogs[0].level, 'error')
    assert.deepEqual(capturedLogs[0].args, ['something broke'])
  })

  it('verbose emits log event with verbose level', () => {
    log.verbose('debug detail')
    assert.equal(capturedLogs.length, 1)
    assert.equal(capturedLogs[0].level, 'verbose')
    assert.deepEqual(capturedLogs[0].args, ['debug detail'])
  })

  it('silly emits log event with silly level', () => {
    log.silly('trace info')
    assert.equal(capturedLogs.length, 1)
    assert.equal(capturedLogs[0].level, 'silly')
    assert.deepEqual(capturedLogs[0].args, ['trace info'])
  })

  it('supports multiple arguments', () => {
    log.info('count:', 42, 'done')
    assert.equal(capturedLogs.length, 1)
    assert.deepEqual(capturedLogs[0].args, ['count:', 42, 'done'])
  })

  it('multiple calls emit multiple events', () => {
    log.info('first')
    log.warn('second')
    log.error('third')
    assert.equal(capturedLogs.length, 3)
    assert.equal(capturedLogs[0].level, 'info')
    assert.equal(capturedLogs[1].level, 'warn')
    assert.equal(capturedLogs[2].level, 'error')
  })
})
