import {describe, it} from 'node:test'
import assert from 'node:assert'
import {NotFoundError} from '../../../src/server/utils/NotFoundError.ts'

describe('NotFoundError', () => {
  it('should create 404 error with message', () => {
    const error = new NotFoundError('Resource not found')
    assert.strictEqual(error.message, 'Resource not found')
    assert.strictEqual(error.status, 404)
  })

  it('should create 404 error from another Error object', () => {
    const originalError = new Error('Not found')
    const error = new NotFoundError(originalError)
    assert.strictEqual(error.message, 'Not found')
    assert.strictEqual(error.status, 404)
  })

  it('should preserve stack trace from original error', () => {
    const originalError = new Error('Original error')
    const originalStack = originalError.stack
    const error = new NotFoundError(originalError)
    assert.strictEqual(error.stack, originalStack)
  })

  it('should be an instance of Error', () => {
    const error = new NotFoundError('Not found')
    assert.ok(error instanceof Error)
  })
})
