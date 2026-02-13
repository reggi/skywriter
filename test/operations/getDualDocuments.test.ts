import {describe, it, before, after, afterEach} from 'node:test'
import assert from 'node:assert'
import {createTestContext} from '../helpers/db.ts'
import {upsert} from '../../src/operations/upsert.ts'
import {getDualDocuments} from '../../src/operations/getDualDocuments.ts'
import type {PoolClient} from 'pg'

describe('getMany', () => {
  let ctx: PoolClient
  let cleanup: () => Promise<void>
  const createdDocumentIds: number[] = []

  before(async () => {
    const tc = await createTestContext()
    ctx = tc.client
    cleanup = tc.cleanup
  })

  afterEach(async () => {
    // Clean up all created documents
    for (const docId of createdDocumentIds) {
      try {
        await ctx.query(`DELETE FROM documents WHERE id = $1`, [docId])
        await ctx.query(
          `DELETE FROM document_records 
           WHERE id NOT IN (
             SELECT current_record_id FROM documents WHERE current_record_id IS NOT NULL
             UNION
             SELECT draft_record_id FROM documents WHERE draft_record_id IS NOT NULL
           )`,
        )
      } catch (error) {
        console.error(`Failed to clean up document ${docId}:`, error)
      }
    }
    createdDocumentIds.length = 0
  })

  after(async () => {
    await cleanup()
  })

  it('should return all documents', async () => {
    try {
      // Create test documents
      const doc1 = await upsert(ctx, {path: '/doc1', title: 'Document 1', content: 'Content 1'})
      createdDocumentIds.push(doc1.id)
      const doc2 = await upsert(ctx, {path: '/doc2', title: 'Document 2', content: 'Content 2'})
      createdDocumentIds.push(doc2.id)
      const doc3 = await upsert(ctx, {path: '/doc3', title: 'Document 3', content: 'Content 3'})
      createdDocumentIds.push(doc3.id)

      const allResults = await getDualDocuments(ctx, {})
      const results = allResults.filter(doc => [doc1.id, doc2.id, doc3.id].includes(doc.id))

      assert.strictEqual(results.length, 3)
      assert.ok(results.every(doc => doc.current !== undefined))
    } catch (error) {
      throw error
    }
  })

  it('should filter by published status', async () => {
    try {
      // Create published and unpublished documents
      const pub = await upsert(ctx, {path: '/published', title: 'Published', content: 'Content', published: true})
      createdDocumentIds.push(pub.id)
      const unpub = await upsert(ctx, {
        path: '/unpublished',
        title: 'Unpublished',
        content: 'Content',
        published: false,
      })
      createdDocumentIds.push(unpub.id)

      const publishedResults = await getDualDocuments(ctx, {published: true})
      const publishedFromTest = publishedResults.filter(doc => [pub.id, unpub.id].includes(doc.id))
      assert.strictEqual(publishedFromTest.length, 1)
      assert.strictEqual(publishedFromTest[0].path, '/published')

      const unpublishedResults = await getDualDocuments(ctx, {published: false})
      const unpublishedFromTest = unpublishedResults.filter(doc => [pub.id, unpub.id].includes(doc.id))
      assert.strictEqual(unpublishedFromTest.length, 1)
      assert.strictEqual(unpublishedFromTest[0].path, '/unpublished')

      const allResults = await getDualDocuments(ctx, {})
      const allFromTest = allResults.filter(doc => [pub.id, unpub.id].includes(doc.id))
      assert.strictEqual(allFromTest.length, 2)
    } catch (error) {
      throw error
    }
  })

  it('should sort by created_at descending by default', async () => {
    try {
      // Create documents with slight delay to ensure different timestamps
      const doc1 = await upsert(ctx, {path: '/first', title: 'First', content: 'Content'})
      createdDocumentIds.push(doc1.id)
      await new Promise(resolve => setTimeout(resolve, 10))
      const doc2 = await upsert(ctx, {path: '/second', title: 'Second', content: 'Content'})
      createdDocumentIds.push(doc2.id)
      await new Promise(resolve => setTimeout(resolve, 10))
      const doc3 = await upsert(ctx, {path: '/third', title: 'Third', content: 'Content'})
      createdDocumentIds.push(doc3.id)

      const allResults = await getDualDocuments(ctx, {})
      const results = allResults.filter(doc => [doc1.id, doc2.id, doc3.id].includes(doc.id))

      assert.strictEqual(results.length, 3)
      assert.strictEqual(results[0].path, '/third')
      assert.strictEqual(results[1].path, '/second')
      assert.strictEqual(results[2].path, '/first')
    } catch (error) {
      throw error
    }
  })

  it('should sort by created_at ascending', async () => {
    try {
      const doc1 = await upsert(ctx, {path: '/first', title: 'First', content: 'Content'})
      createdDocumentIds.push(doc1.id)
      await new Promise(resolve => setTimeout(resolve, 10))
      const doc2 = await upsert(ctx, {path: '/second', title: 'Second', content: 'Content'})
      createdDocumentIds.push(doc2.id)
      await new Promise(resolve => setTimeout(resolve, 10))
      const doc3 = await upsert(ctx, {path: '/third', title: 'Third', content: 'Content'})
      createdDocumentIds.push(doc3.id)

      const allResults = await getDualDocuments(ctx, {sortBy: 'created_at', sortOrder: 'asc'})
      const results = allResults.filter(doc => [doc1.id, doc2.id, doc3.id].includes(doc.id))

      assert.strictEqual(results.length, 3)
      assert.strictEqual(results[0].path, '/first')
      assert.strictEqual(results[1].path, '/second')
      assert.strictEqual(results[2].path, '/third')
    } catch (error) {
      throw error
    }
  })

  it('should sort by title', async () => {
    try {
      const doc1 = await upsert(ctx, {path: '/doc1', title: 'Zebra', content: 'Content'})
      createdDocumentIds.push(doc1.id)
      const doc2 = await upsert(ctx, {path: '/doc2', title: 'Apple', content: 'Content'})
      createdDocumentIds.push(doc2.id)
      const doc3 = await upsert(ctx, {path: '/doc3', title: 'Mango', content: 'Content'})
      createdDocumentIds.push(doc3.id)

      const allResults = await getDualDocuments(ctx, {sortBy: 'title', sortOrder: 'asc'})
      const results = allResults.filter(doc => [doc1.id, doc2.id, doc3.id].includes(doc.id))

      assert.strictEqual(results.length, 3)
      assert.strictEqual(results[0].current?.title, 'Apple')
      assert.strictEqual(results[1].current?.title, 'Mango')
      assert.strictEqual(results[2].current?.title, 'Zebra')
    } catch (error) {
      throw error
    }
  })

  it('should sort by path', async () => {
    try {
      const doc1 = await upsert(ctx, {path: '/zebra', title: 'Title', content: 'Content'})
      createdDocumentIds.push(doc1.id)
      const doc2 = await upsert(ctx, {path: '/apple', title: 'Title', content: 'Content'})
      createdDocumentIds.push(doc2.id)
      const doc3 = await upsert(ctx, {path: '/mango', title: 'Title', content: 'Content'})
      createdDocumentIds.push(doc3.id)

      const allResults = await getDualDocuments(ctx, {sortBy: 'path', sortOrder: 'asc'})
      const results = allResults.filter(doc => [doc1.id, doc2.id, doc3.id].includes(doc.id))

      assert.strictEqual(results.length, 3)
      assert.strictEqual(results[0].path, '/apple')
      assert.strictEqual(results[1].path, '/mango')
      assert.strictEqual(results[2].path, '/zebra')
    } catch (error) {
      throw error
    }
  })

  it('should apply limit', async () => {
    try {
      const doc1 = await upsert(ctx, {path: '/doc1', title: 'Doc 1', content: 'Content'})
      createdDocumentIds.push(doc1.id)
      const doc2 = await upsert(ctx, {path: '/doc2', title: 'Doc 2', content: 'Content'})
      createdDocumentIds.push(doc2.id)
      const doc3 = await upsert(ctx, {path: '/doc3', title: 'Doc 3', content: 'Content'})
      createdDocumentIds.push(doc3.id)
      const doc4 = await upsert(ctx, {path: '/doc4', title: 'Doc 4', content: 'Content'})
      createdDocumentIds.push(doc4.id)

      const results = await getDualDocuments(ctx, {limit: 2})

      assert.strictEqual(results.length, 2)
    } catch (error) {
      throw error
    }
  })

  it('should apply offset', async () => {
    try {
      // Create some test documents
      const doc1 = await upsert(ctx, {path: '/doc1', title: 'Doc 1', content: 'Content'})
      createdDocumentIds.push(doc1.id)
      const doc2 = await upsert(ctx, {path: '/doc2', title: 'Doc 2', content: 'Content'})
      createdDocumentIds.push(doc2.id)
      const doc3 = await upsert(ctx, {path: '/doc3', title: 'Doc 3', content: 'Content'})
      createdDocumentIds.push(doc3.id)

      // Get all docs as baseline
      const allDocs = await getDualDocuments(ctx, {})
      const totalCount = allDocs.length

      // Apply offset of 2 - should reduce result count
      const withOffset = await getDualDocuments(ctx, {offset: 2})

      // Verify offset reduced the results
      assert.ok(
        withOffset.length === totalCount - 2,
        `Offset should reduce results from ${totalCount} to ${totalCount - 2}, got ${withOffset.length}`,
      )

      // Verify the first doc in withOffset is not in the first 2 of allDocs
      assert.ok(withOffset[0].id !== allDocs[0].id)
      assert.ok(withOffset[0].id !== allDocs[1].id)
      // Verify it matches the 3rd doc from allDocs
      assert.strictEqual(withOffset[0].id, allDocs[2].id)
    } catch (error) {
      throw error
    }
  })

  it('should apply limit and offset together', async () => {
    try {
      // Create some test documents
      const doc1 = await upsert(ctx, {path: '/doc1', title: 'Doc 1', content: 'Content'})
      createdDocumentIds.push(doc1.id)
      const doc2 = await upsert(ctx, {path: '/doc2', title: 'Doc 2', content: 'Content'})
      createdDocumentIds.push(doc2.id)
      const doc3 = await upsert(ctx, {path: '/doc3', title: 'Doc 3', content: 'Content'})
      createdDocumentIds.push(doc3.id)
      const doc4 = await upsert(ctx, {path: '/doc4', title: 'Doc 4', content: 'Content'})
      createdDocumentIds.push(doc4.id)

      // Get all docs as baseline
      const allDocs = await getDualDocuments(ctx, {})

      // Apply offset of 2 and limit of 2
      const results = await getDualDocuments(ctx, {limit: 2, offset: 2})

      // Verify limit worked: should have exactly 2 results
      assert.strictEqual(results.length, 2)
      // Verify offset worked: results should match positions 2 and 3 from allDocs
      assert.strictEqual(results[0].id, allDocs[2].id)
      assert.strictEqual(results[1].id, allDocs[3].id)
    } catch (error) {
      throw error
    }
  })

  it('should include draft versions when draft option is true', async () => {
    try {
      // Create document with current version
      const doc = await upsert(ctx, {path: '/doc', title: 'Current', content: 'Current content'})
      createdDocumentIds.push(doc.id)

      // Create draft version
      await upsert(ctx, {id: doc.id, title: 'Draft', content: 'Draft content', draft: true})

      const allResultsWithoutDraft = await getDualDocuments(ctx, {})
      const resultsWithoutDraft = allResultsWithoutDraft.filter(d => d.id === doc.id)
      assert.strictEqual(resultsWithoutDraft.length, 1)
      assert.ok(resultsWithoutDraft[0].current !== undefined)
      assert.ok(resultsWithoutDraft[0].draft === undefined)

      const allResultsWithDraft = await getDualDocuments(ctx, {draft: true})
      const resultsWithDraft = allResultsWithDraft.filter(d => d.id === doc.id)
      assert.strictEqual(resultsWithDraft.length, 1)
      assert.ok(resultsWithDraft[0].current !== undefined)
      assert.ok(resultsWithDraft[0].draft !== undefined)
      assert.strictEqual(resultsWithDraft[0].draft?.title, 'Draft')
    } catch (error) {
      throw error
    }
  })

  it('should return empty array when no documents match', async () => {
    try {
      const doc = await upsert(ctx, {path: '/doc', title: 'Doc', content: 'Content', published: false})
      createdDocumentIds.push(doc.id)

      const allResults = await getDualDocuments(ctx, {published: true})
      const results = allResults.filter(d => d.id === doc.id)

      assert.strictEqual(results.length, 0)
    } catch (error) {
      throw error
    }
  })

  it('should not include redirect flag', async () => {
    try {
      const doc = await upsert(ctx, {path: '/doc', title: 'Doc', content: 'Content'})
      createdDocumentIds.push(doc.id)

      const allResults = await getDualDocuments(ctx, {})
      const results = allResults.filter(d => d.id === doc.id)

      assert.strictEqual(results.length, 1)
      assert.strictEqual(results[0].redirect, false)
    } catch (error) {
      throw error
    }
  })

  it('should sort by updated_at', async () => {
    try {
      const doc1 = await upsert(ctx, {path: '/update-test-1', title: 'First', content: 'Content'})
      createdDocumentIds.push(doc1.id)
      await new Promise(resolve => setTimeout(resolve, 10))

      const doc2 = await upsert(ctx, {path: '/update-test-2', title: 'Second', content: 'Content'})
      createdDocumentIds.push(doc2.id)
      await new Promise(resolve => setTimeout(resolve, 10))

      // Update doc1 to change its updated_at timestamp
      await upsert(ctx, {id: doc1.id, title: 'First Updated'})
      await new Promise(resolve => setTimeout(resolve, 10))

      const allResults = await getDualDocuments(ctx, {sortBy: 'updated_at', sortOrder: 'desc'})
      const results = allResults.filter(doc => [doc1.id, doc2.id].includes(doc.id))

      assert.strictEqual(results.length, 2)
      assert.strictEqual(results[0].id, doc1.id) // doc1 was updated last
      assert.strictEqual(results[1].id, doc2.id)
    } catch (error) {
      throw error
    }
  })

  it('should use default sortBy when invalid sortBy is provided', async () => {
    try {
      const doc1 = await upsert(ctx, {path: '/invalid-sort-1', title: 'First', content: 'Content'})
      createdDocumentIds.push(doc1.id)
      await new Promise(resolve => setTimeout(resolve, 10))

      const doc2 = await upsert(ctx, {path: '/invalid-sort-2', title: 'Second', content: 'Content'})
      createdDocumentIds.push(doc2.id)

      // Use an invalid sortBy value - TypeScript would prevent this, but we cast to test runtime behavior
      const allResults = await getDualDocuments(ctx, {
        sortBy: 'invalid_field' as 'created_at' | 'updated_at' | 'title' | 'path',
        sortOrder: 'desc',
      })
      const results = allResults.filter(doc => [doc1.id, doc2.id].includes(doc.id))

      // Should fall back to created_at descending
      assert.strictEqual(results.length, 2)
      assert.strictEqual(results[0].id, doc2.id) // Most recent
      assert.strictEqual(results[1].id, doc1.id)
    } catch (error) {
      throw error
    }
  })

  it('should handle database errors and rollback transaction', async () => {
    try {
      // Force an error by using an invalid query
      // We'll create a spy/mock scenario by calling getMany with a bad client
      const badClient = {
        ...ctx,
        query: async (query: string) => {
          if (query === 'BEGIN') {
            return {rows: [], rowCount: 0}
          }
          if (query === 'ROLLBACK') {
            return {rows: [], rowCount: 0}
          }
          throw new Error('Database error')
        },
      } as unknown as typeof ctx

      await assert.rejects(async () => {
        await getDualDocuments(badClient, {})
      }, /Database error/)
    } catch (error) {
      throw error
    }
  })

  it('should handle offset=0 (not add OFFSET clause)', async () => {
    try {
      const doc1 = await upsert(ctx, {path: '/offset-zero-1', title: 'First', content: 'Content'})
      createdDocumentIds.push(doc1.id)
      const doc2 = await upsert(ctx, {path: '/offset-zero-2', title: 'Second', content: 'Content'})
      createdDocumentIds.push(doc2.id)

      const allResults = await getDualDocuments(ctx, {offset: 0, limit: 2})
      const results = allResults.filter(doc => [doc1.id, doc2.id].includes(doc.id))

      assert.strictEqual(results.length, 2)
    } catch (error) {
      throw error
    }
  })

  it('should exclude documents where fetchDocumentInstance returns null', async () => {
    try {
      // Create a document with a draft only
      const doc = await upsert(ctx, {path: '/test-draft-only', title: 'Draft Only', content: 'Content', draft: true})
      createdDocumentIds.push(doc.id)

      // Get without draft option - should not return the document since it has no current record
      const allResults = await getDualDocuments(ctx, {})
      const results = allResults.filter(d => d.id === doc.id)

      // Should not include the document since it has no current record and we didn't request drafts
      assert.strictEqual(results.length, 0)
    } catch (error) {
      throw error
    }
  })

  describe('excludeTemplates filter', () => {
    it('should exclude documents used as a template by another document', async () => {
      try {
        // Create a template document
        const template = await upsert(ctx, {path: '/tpl-exclude-1', title: 'Template', content: 'Template content'})
        createdDocumentIds.push(template.id)

        // Create a document that uses the template
        const page = await upsert(ctx, {
          path: '/page-exclude-1',
          title: 'Page',
          content: 'Page content',
          template_id: template.id,
        })
        createdDocumentIds.push(page.id)

        const allResults = await getDualDocuments(ctx, {excludeTemplates: true})
        const results = allResults.filter(doc => [template.id, page.id].includes(doc.id))

        assert.strictEqual(results.length, 1)
        assert.strictEqual(results[0].path, '/page-exclude-1')
      } catch (error) {
        throw error
      }
    })

    it('should include template documents when excludeTemplates is false', async () => {
      try {
        const template = await upsert(ctx, {path: '/tpl-include-1', title: 'Template', content: 'Template content'})
        createdDocumentIds.push(template.id)

        const page = await upsert(ctx, {
          path: '/page-include-1',
          title: 'Page',
          content: 'Page content',
          template_id: template.id,
        })
        createdDocumentIds.push(page.id)

        const allResults = await getDualDocuments(ctx, {excludeTemplates: false})
        const results = allResults.filter(doc => [template.id, page.id].includes(doc.id))

        assert.strictEqual(results.length, 2)
      } catch (error) {
        throw error
      }
    })

    it('should not exclude documents that are not used as a template', async () => {
      try {
        const doc1 = await upsert(ctx, {path: '/no-tpl-1', title: 'Doc 1', content: 'Content'})
        createdDocumentIds.push(doc1.id)
        const doc2 = await upsert(ctx, {path: '/no-tpl-2', title: 'Doc 2', content: 'Content'})
        createdDocumentIds.push(doc2.id)

        const allResults = await getDualDocuments(ctx, {excludeTemplates: true})
        const results = allResults.filter(doc => [doc1.id, doc2.id].includes(doc.id))

        assert.strictEqual(results.length, 2)
      } catch (error) {
        throw error
      }
    })

    it('should combine excludeTemplates with startsWithPath filter', async () => {
      try {
        const template = await upsert(ctx, {
          path: '/blog/tpl-combo',
          title: 'Blog Template',
          content: 'Template',
        })
        createdDocumentIds.push(template.id)

        const page = await upsert(ctx, {
          path: '/blog/post-combo',
          title: 'Blog Post',
          content: 'Post',
          template_id: template.id,
        })
        createdDocumentIds.push(page.id)

        const otherPage = await upsert(ctx, {path: '/blog/other-combo', title: 'Other', content: 'Other'})
        createdDocumentIds.push(otherPage.id)

        const allResults = await getDualDocuments(ctx, {excludeTemplates: true, startsWithPath: '/blog/'})
        const results = allResults.filter(doc => [template.id, page.id, otherPage.id].includes(doc.id))

        assert.strictEqual(results.length, 2)
        assert.ok(results.every(doc => doc.path !== '/blog/tpl-combo'))
      } catch (error) {
        throw error
      }
    })
  })

  describe('startsWithPath filter', () => {
    it('should filter documents by path prefix', async () => {
      try {
        const doc1 = await upsert(ctx, {path: '/blog/post-1', title: 'Blog Post 1', content: 'Content'})
        createdDocumentIds.push(doc1.id)
        const doc2 = await upsert(ctx, {path: '/blog/post-2', title: 'Blog Post 2', content: 'Content'})
        createdDocumentIds.push(doc2.id)
        const doc3 = await upsert(ctx, {path: '/docs/guide', title: 'Guide', content: 'Content'})
        createdDocumentIds.push(doc3.id)

        const allResults = await getDualDocuments(ctx, {startsWithPath: '/blog/'})
        const results = allResults.filter(doc => [doc1.id, doc2.id, doc3.id].includes(doc.id))

        assert.strictEqual(results.length, 2)
        assert.ok(results.every(doc => doc.path.startsWith('/blog/')))
      } catch (error) {
        throw error
      }
    })

    it('should return empty array when no documents match path prefix', async () => {
      try {
        const doc1 = await upsert(ctx, {path: '/docs/intro', title: 'Intro', content: 'Content'})
        createdDocumentIds.push(doc1.id)

        const allResults = await getDualDocuments(ctx, {startsWithPath: '/nonexistent/'})
        const results = allResults.filter(doc => doc.id === doc1.id)

        assert.strictEqual(results.length, 0)
      } catch (error) {
        throw error
      }
    })

    it('should combine startsWithPath with published filter', async () => {
      try {
        const doc1 = await upsert(ctx, {
          path: '/blog/published',
          title: 'Published',
          content: 'Content',
          published: true,
        })
        createdDocumentIds.push(doc1.id)
        const doc2 = await upsert(ctx, {path: '/blog/draft', title: 'Draft', content: 'Content', published: false})
        createdDocumentIds.push(doc2.id)
        const doc3 = await upsert(ctx, {path: '/other/published', title: 'Other', content: 'Content', published: true})
        createdDocumentIds.push(doc3.id)

        const allResults = await getDualDocuments(ctx, {startsWithPath: '/blog/', published: true})
        const results = allResults.filter(doc => [doc1.id, doc2.id, doc3.id].includes(doc.id))

        assert.strictEqual(results.length, 1)
        assert.strictEqual(results[0].path, '/blog/published')
      } catch (error) {
        throw error
      }
    })
  })

  describe('excludePaths filter', () => {
    it('should exclude documents with specified paths', async () => {
      const doc1 = await upsert(ctx, {path: '/excl-a', title: 'A', content: 'Content'})
      createdDocumentIds.push(doc1.id)
      const doc2 = await upsert(ctx, {path: '/excl-b', title: 'B', content: 'Content'})
      createdDocumentIds.push(doc2.id)
      const doc3 = await upsert(ctx, {path: '/excl-c', title: 'C', content: 'Content'})
      createdDocumentIds.push(doc3.id)

      const allResults = await getDualDocuments(ctx, {excludePaths: ['/excl-b']})
      const results = allResults.filter(doc => [doc1.id, doc2.id, doc3.id].includes(doc.id))

      assert.strictEqual(results.length, 2)
      assert.ok(results.every(doc => doc.path !== '/excl-b'))
    })

    it('should exclude multiple paths at once', async () => {
      const doc1 = await upsert(ctx, {path: '/excl-m-a', title: 'A', content: 'Content'})
      createdDocumentIds.push(doc1.id)
      const doc2 = await upsert(ctx, {path: '/excl-m-b', title: 'B', content: 'Content'})
      createdDocumentIds.push(doc2.id)
      const doc3 = await upsert(ctx, {path: '/excl-m-c', title: 'C', content: 'Content'})
      createdDocumentIds.push(doc3.id)

      const allResults = await getDualDocuments(ctx, {excludePaths: ['/excl-m-a', '/excl-m-c']})
      const results = allResults.filter(doc => [doc1.id, doc2.id, doc3.id].includes(doc.id))

      assert.strictEqual(results.length, 1)
      assert.strictEqual(results[0].path, '/excl-m-b')
    })

    it('should return all documents when excludePaths is empty', async () => {
      const doc1 = await upsert(ctx, {path: '/excl-empty-a', title: 'A', content: 'Content'})
      createdDocumentIds.push(doc1.id)
      const doc2 = await upsert(ctx, {path: '/excl-empty-b', title: 'B', content: 'Content'})
      createdDocumentIds.push(doc2.id)

      const allResults = await getDualDocuments(ctx, {excludePaths: []})
      const results = allResults.filter(doc => [doc1.id, doc2.id].includes(doc.id))

      assert.strictEqual(results.length, 2)
    })

    it('should combine excludePaths with startsWithPath', async () => {
      const doc1 = await upsert(ctx, {path: '/ns/excl-a', title: 'A', content: 'Content'})
      createdDocumentIds.push(doc1.id)
      const doc2 = await upsert(ctx, {path: '/ns/excl-b', title: 'B', content: 'Content'})
      createdDocumentIds.push(doc2.id)
      const doc3 = await upsert(ctx, {path: '/other/excl-c', title: 'C', content: 'Content'})
      createdDocumentIds.push(doc3.id)

      const allResults = await getDualDocuments(ctx, {
        startsWithPath: '/ns/',
        excludePaths: ['/ns/excl-a'],
      })
      const results = allResults.filter(doc => [doc1.id, doc2.id, doc3.id].includes(doc.id))

      assert.strictEqual(results.length, 1)
      assert.strictEqual(results[0].path, '/ns/excl-b')
    })

    it('should handle non-existent paths in excludePaths gracefully', async () => {
      const doc1 = await upsert(ctx, {path: '/excl-ne-a', title: 'A', content: 'Content'})
      createdDocumentIds.push(doc1.id)

      const allResults = await getDualDocuments(ctx, {excludePaths: ['/non-existent-path']})
      const results = allResults.filter(doc => doc.id === doc1.id)

      assert.strictEqual(results.length, 1)
    })
  })
})
