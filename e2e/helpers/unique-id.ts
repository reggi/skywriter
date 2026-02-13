import {randomBytes} from 'node:crypto'

let counter = 0

/**
 * Generate a unique ID for test isolation.
 * Combines timestamp, process-level counter, and random bytes
 * to guarantee uniqueness even when tests run in parallel.
 */
export function uniqueId(): string {
  return `${Date.now()}-${counter++}-${randomBytes(4).toString('hex')}`
}
