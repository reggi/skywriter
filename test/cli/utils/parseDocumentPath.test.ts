import {describe, it} from 'node:test'
import assert from 'node:assert/strict'
import {parseDocumentPath} from '../../../src/cli/utils/parseDocumentPath.ts'

describe('parseDocumentPath', () => {
  it('handles absolute path', () => {
    assert.equal(parseDocumentPath('/something'), '/something')
  })

  it('handles bare name', () => {
    assert.equal(parseDocumentPath('something'), '/something')
  })

  it('handles https URL', () => {
    assert.equal(parseDocumentPath('https://omega.com/something'), '/something')
  })

  it('handles https URL with .git suffix', () => {
    assert.equal(parseDocumentPath('https://omega.com/something.git'), '/something')
  })

  it('handles http URL', () => {
    assert.equal(parseDocumentPath('http://localhost:3000/meow'), '/meow')
  })

  it('handles URL with no pathname', () => {
    assert.equal(parseDocumentPath('https://omega.com'), '/')
  })

  it('handles schemeless URL with .com', () => {
    assert.equal(parseDocumentPath('omega.com/meow'), '/meow')
  })

  it('handles schemeless URL with .co.uk', () => {
    assert.equal(parseDocumentPath('omega.co.uk/cookie'), '/cookie')
  })

  it('handles schemeless URL with .git suffix', () => {
    assert.equal(parseDocumentPath('omega.com/something.git'), '/something')
  })

  it('handles schemeless URL with nested path', () => {
    assert.equal(parseDocumentPath('example.io/a/b/c'), '/a/b/c')
  })
})
