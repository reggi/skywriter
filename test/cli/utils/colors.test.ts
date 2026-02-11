import {describe, it} from 'node:test'
import assert from 'node:assert/strict'
import {bold, dim, red, green, yellow, cyan, gray} from '../../../src/cli/utils/colors.ts'

describe('colors', () => {
  // In test runner (non-TTY), colors are disabled, so functions return plain strings
  it('bold returns the input string', () => {
    assert.ok(bold('hello').includes('hello'))
  })

  it('dim returns the input string', () => {
    assert.ok(dim('hello').includes('hello'))
  })

  it('red returns the input string', () => {
    assert.ok(red('error').includes('error'))
  })

  it('green returns the input string', () => {
    assert.ok(green('success').includes('success'))
  })

  it('yellow returns the input string', () => {
    assert.ok(yellow('warning').includes('warning'))
  })

  it('cyan returns the input string', () => {
    assert.ok(cyan('info').includes('info'))
  })

  it('gray returns the input string', () => {
    assert.ok(gray('muted').includes('muted'))
  })

  it('handles empty strings', () => {
    assert.ok(typeof bold('') === 'string')
    assert.ok(typeof red('') === 'string')
  })

  it('handles strings with special characters', () => {
    const result = green('✓ success!')
    assert.ok(result.includes('✓ success!'))
  })
})
