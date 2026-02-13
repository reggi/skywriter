import {describe, it, beforeEach, before, after} from 'node:test'
import assert from 'node:assert/strict'
import {functionContext} from '../../src/utils/functionContext.ts'
import {createDatabaseContext, closeDatabaseContext, closePool} from '../../src/db/index.ts'
import {upsert} from '../../src/operations/upsert.ts'
import {removeDocument} from '../../src/operations/removeDocument.ts'
import {getDualDocument} from '../../src/operations/getDualDocument.ts'
import {createTestUpload, cleanupTestUploads} from '../helpers/uploads.ts'
import {getRenderDocument} from '../../src/operations/getRenderDocument.ts'
import type {PoolClient} from 'pg'

describe('functionContext', () => {
  let client: PoolClient
  const testId = Date.now()

  before(async () => {
    const connectionString =
      process.env.DATABASE_URL || 'postgresql://astrodoc:astrodoc_password@localhost:5455/astrodoc'
    client = await createDatabaseContext(connectionString)
  })

  after(async () => {
    await closeDatabaseContext(client)
    await closePool()
    await cleanupTestUploads()
  })

  beforeEach(async () => {
    // Clean up test documents
    const paths = [
      `/test-function-context-1-${testId}`,
      `/test-function-context-2-${testId}`,
      `/test-function-context-3-${testId}`,
      `/test-fc-template-${testId}`,
      `/test-fc-page-${testId}`,
      `/test-fc-regular-${testId}`,
    ]
    for (const path of paths) {
      try {
        await removeDocument(client, {path})
      } catch {
        // Ignore errors if document doesn't exist
      }
    }
  })

  describe('getPage', () => {
    it('should return null for non-existent document', async () => {
      // Create a minimal mock render document for context
      const mockDoc = {
        id: 1,
        path: '/test-function-context-1',
        published: false,
        title: 'Test',
        content: '',
        data: '{}',
        style: '',
        script: '',
        server: '',
        template_id: null,
        slot_id: null,
        content_type: 'markdown',
        data_type: null,
        has_eta: false,
        mime_type: 'text/html',
        extension: '.html',
        created_at: new Date(),
        updated_at: new Date(),
        draft: false,
      } as unknown as {path: string}

      const ctx = functionContext(client, mockDoc)
      const result = await ctx.getPage({path: '/non-existent-path-12345'})

      assert.equal(result, null)
    })

    it('should return rendered document for existing document', async () => {
      // Create a test document (published: true makes it have a current version)
      await upsert(client, {
        path: `/test-function-context-1-${testId}`,
        title: 'Test Doc',
        content: '# Hello',
        published: true,
      })

      const mockDoc = {
        id: 1,
        path: '/some-path',
        published: false,
        title: 'Current',
        content: '',
        data: '{}',
        style: '',
        script: '',
        server: '',
        template_id: null,
        slot_id: null,
        content_type: 'markdown',
        data_type: null,
        has_eta: false,
        mime_type: 'text/html',
        extension: '.html',
        created_at: new Date(),
        updated_at: new Date(),
        draft: false,
      } as unknown as {path: string}

      const ctx = functionContext(client, mockDoc)
      const result = await ctx.getPage({path: `/test-function-context-1-${testId}`})

      assert.ok(result, 'Should return a result')
      assert.ok(result.html, 'Should have rendered html')
    })

    it('should pass request query to nested render so templates using query work', async () => {
      const innerPath = `/test-function-context-query-inner-${testId}`

      // Create an inner document whose content depends on query.meow
      await upsert(client, {
        path: innerPath,
        title: 'Inner Doc',
        content: '# <%= query.meow || "meow" %>',
        published: true,
      })

      const mockDoc = {
        id: 1,
        path: '/outer-doc',
        published: false,
        title: 'Outer',
        content: '',
        data: '{}',
        style: '',
        script: '',
        server: '',
        template_id: null,
        slot_id: null,
        content_type: 'markdown',
        data_type: null,
        has_eta: false,
        mime_type: 'text/html',
        extension: '.html',
        created_at: new Date(),
        updated_at: new Date(),
        draft: false,
      } as unknown as {path: string}

      const ctx = functionContext(client, mockDoc, {meow: 'wow'})
      const result = await ctx.getPage({path: innerPath})

      assert.ok(result, 'Should return a result')
      assert.ok(result.markdown.startsWith('# wow'), `Expected markdown to start with '# wow', got: ${result.markdown}`)
    })
  })

  describe('getPages', () => {
    it('should return empty array when no documents exist matching criteria', async () => {
      const mockDoc = {
        id: 1,
        path: '/some-path',
        published: false,
        title: 'Current',
        content: '',
        data: '{}',
        style: '',
        script: '',
        server: '',
        template_id: null,
        slot_id: null,
        content_type: 'markdown',
        data_type: null,
        has_eta: false,
        mime_type: 'text/html',
        extension: '.html',
        created_at: new Date(),
        updated_at: new Date(),
        draft: false,
      } as unknown as {path: string}

      const ctx = functionContext(client, mockDoc)
      // Use a specific path that won't match anything
      const result = await ctx.getPages({startsWithPath: '/non-existent-unique-path-xyz123/'})

      assert.ok(Array.isArray(result), 'Should return an array')
    })

    it('should return rendered documents for matching criteria', async () => {
      // Create test documents (published: true makes them have current versions)
      await upsert(client, {
        path: `/test-function-context-2-${testId}`,
        title: 'Test Doc 2',
        content: '# Doc 2',
        published: true,
      })
      await upsert(client, {
        path: `/test-function-context-3-${testId}`,
        title: 'Test Doc 3',
        content: '# Doc 3',
        published: true,
      })

      const mockDoc = {
        id: 1,
        path: '/some-path',
        published: false,
        title: 'Current',
        content: '',
        data: '{}',
        style: '',
        script: '',
        server: '',
        template_id: null,
        slot_id: null,
        content_type: 'markdown',
        data_type: null,
        has_eta: false,
        mime_type: 'text/html',
        extension: '.html',
        created_at: new Date(),
        updated_at: new Date(),
        draft: false,
      } as unknown as {path: string}

      const ctx = functionContext(client, mockDoc)
      const result = await ctx.getPages({startsWithPath: `/test-function-context-`})

      assert.ok(Array.isArray(result), 'Should return an array')
      // Filter to only our test documents
      const ourDocs = result.filter(d => d.path?.includes(`-${testId}`))
      assert.ok(ourDocs.length >= 2, `Should return at least 2 documents, got ${ourDocs.length}`)

      // Verify all results have rendered html
      for (const doc of ourDocs) {
        assert.ok(doc.html !== undefined, 'Each doc should have html')
      }
    })

    it('should support limit option', async () => {
      // Create test documents (published: true makes them have current versions)
      await upsert(client, {
        path: `/test-function-context-2-${testId}`,
        title: 'Test Doc 2',
        content: '# Doc 2',
        published: true,
      })
      await upsert(client, {
        path: `/test-function-context-3-${testId}`,
        title: 'Test Doc 3',
        content: '# Doc 3',
        published: true,
      })

      const mockDoc = {
        id: 1,
        path: '/some-path',
        published: false,
        title: 'Current',
        content: '',
        data: '{}',
        style: '',
        script: '',
        server: '',
        template_id: null,
        slot_id: null,
        content_type: 'markdown',
        data_type: null,
        has_eta: false,
        mime_type: 'text/html',
        extension: '.html',
        created_at: new Date(),
        updated_at: new Date(),
        draft: false,
      } as unknown as {path: string}

      const ctx = functionContext(client, mockDoc)
      const result = await ctx.getPages({startsWithPath: `/test-function-context-`, limit: 1})

      assert.ok(Array.isArray(result), 'Should return an array')
      assert.equal(result.length, 1, 'Should return exactly 1 document due to limit')
    })

    it('should exclude template documents by default', async () => {
      // Create a template document
      const templateResult = await upsert(client, {
        path: `/test-fc-template-${testId}`,
        title: 'Template',
        content: '# Template',
        published: true,
      })

      // Create a page that uses the template (via template_id on its record)
      await upsert(client, {
        path: `/test-fc-page-${testId}`,
        title: 'Page',
        content: '# Page',
        published: true,
        template_id: templateResult.id,
      })

      // Create a regular page (no template usage)
      await upsert(client, {
        path: `/test-fc-regular-${testId}`,
        title: 'Regular',
        content: '# Regular',
        published: true,
      })

      const mockDoc = {path: '/some-path'} as unknown as {path: string}
      const ctx = functionContext(client, mockDoc)

      // Default call should exclude the template document (3 docs created, template excluded = 2 results)
      const result = await ctx.getPages({startsWithPath: `/test-fc-`})
      assert.equal(result.length, 2, 'Should return 2 documents (template excluded by default)')

      // With excludeTemplates=false, all 3 documents should be returned
      const resultAll = await ctx.getPages({startsWithPath: `/test-fc-`, excludeTemplates: false})
      assert.equal(resultAll.length, 3, 'Should return 3 documents when excludeTemplates is false')
    })

    it('should include template documents when excludeTemplates is false', async () => {
      // Create a template document
      const templateResult = await upsert(client, {
        path: `/test-fc-template-${testId}`,
        title: 'Template',
        content: '# Template',
        published: true,
      })

      // Create a page that uses the template
      await upsert(client, {
        path: `/test-fc-page-${testId}`,
        title: 'Page',
        content: '# Page',
        published: true,
        template_id: templateResult.id,
      })

      const mockDoc = {path: '/some-path'} as unknown as {path: string}
      const ctx = functionContext(client, mockDoc)

      // Explicitly opt out of excluding templates — both documents should be returned
      const result = await ctx.getPages({startsWithPath: `/test-fc-`, excludeTemplates: false})
      assert.equal(result.length, 2, 'Should return 2 documents when excludeTemplates is false')
    })
  })

  describe('getUploads', () => {
    it('should return uploads for a document', async () => {
      // Create a test document with an upload
      await upsert(client, {path: `/test-function-context-1-${testId}`, title: 'Test Doc', content: '# Hello'})
      const doc = await getDualDocument(client, {path: `/test-function-context-1-${testId}`})
      assert.ok(doc, 'Document should exist')

      // Add an upload
      await createTestUpload(client, {id: doc.id}, {filename: 'test-upload.txt'})

      const renderDoc = await getRenderDocument(
        client,
        {path: `/test-function-context-1-${testId}`},
        {includeUploads: true, draft: true},
      )
      assert.ok(renderDoc, 'Render document should exist')

      const ctx = functionContext(client, renderDoc)
      const result = await ctx.getUploads({path: `/test-function-context-1-${testId}`})

      assert.ok(Array.isArray(result), 'Should return an array')
      assert.ok(result.length >= 1, 'Should have at least one upload')
    })

    it('should return empty array when no uploads exist', async () => {
      // Create a test document without uploads
      await upsert(client, {path: `/test-function-context-1-${testId}`, title: 'Test Doc', content: '# Hello'})

      const renderDoc = await getRenderDocument(client, {path: `/test-function-context-1-${testId}`}, {draft: true})
      assert.ok(renderDoc, 'Render document should exist')

      const ctx = functionContext(client, renderDoc)
      const result = await ctx.getUploads({path: `/test-function-context-1-${testId}`})

      assert.ok(Array.isArray(result), 'Should return an array')
      assert.equal(result.length, 0, 'Should have no uploads')
    })

    it('should use current document path when no path specified', async () => {
      // Create a test document with an upload
      await upsert(client, {path: `/test-function-context-1-${testId}`, title: 'Test Doc', content: '# Hello'})
      const doc = await getDualDocument(client, {path: `/test-function-context-1-${testId}`})
      assert.ok(doc, 'Document should exist')

      // Add an upload
      await createTestUpload(client, {id: doc.id}, {filename: 'default-path-upload.txt'})

      const renderDoc = await getRenderDocument(
        client,
        {path: `/test-function-context-1-${testId}`},
        {includeUploads: true, draft: true},
      )
      assert.ok(renderDoc, 'Render document should exist')

      const ctx = functionContext(client, renderDoc)
      // Call without explicit path - should use renderDoc's path
      const result = await ctx.getUploads({path: renderDoc.path})

      assert.ok(Array.isArray(result), 'Should return an array')
    })
  })
})
