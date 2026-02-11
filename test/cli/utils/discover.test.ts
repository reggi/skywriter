import {test, describe, beforeEach, afterEach} from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp, mkdir, writeFile, rm, symlink} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {discoverDocuments, findDefaultRedirect} from '../../../src/cli/utils/discover.ts'

describe('discoverDocuments', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'discover-test-'))
  })

  afterEach(async () => {
    await rm(tempDir, {recursive: true, force: true})
  })

  test('should return empty result for empty directory', async () => {
    const result = await discoverDocuments(tempDir)
    assert.strictEqual(result.documents.size, 0)
    assert.strictEqual(result.sortedPaths.length, 0)
    assert.strictEqual(result.errors.length, 0)
    assert.strictEqual(result.duplicates.size, 0)
  })

  test('should discover a single document with settings.json and content file', async () => {
    const docDir = join(tempDir, 'my-doc')
    await mkdir(docDir)
    await writeFile(join(docDir, 'settings.json'), JSON.stringify({path: '/my-doc'}))
    await writeFile(join(docDir, 'content.html'), '<h1>Hello</h1>')

    const result = await discoverDocuments(tempDir)
    assert.strictEqual(result.documents.size, 1)
    assert.ok(result.documents.has('/my-doc'))
    assert.strictEqual(result.sortedPaths[0], '/my-doc')

    const doc = result.documents.get('/my-doc')
    assert.strictEqual(doc?.path, '/my-doc')
    assert.strictEqual(doc?.fsPath, docDir)
    assert.strictEqual(doc?.hasTemplate, false)
    assert.strictEqual(doc?.hasSlot, false)
  })

  test('should discover document with content.md file', async () => {
    const docDir = join(tempDir, 'markdown-doc')
    await mkdir(docDir)
    await writeFile(join(docDir, 'settings.json'), JSON.stringify({path: '/markdown'}))
    await writeFile(join(docDir, 'content.md'), '# Markdown Content')

    const result = await discoverDocuments(tempDir)
    assert.strictEqual(result.documents.size, 1)
    assert.ok(result.documents.has('/markdown'))
  })

  test('should discover document with index.html file', async () => {
    const docDir = join(tempDir, 'index-doc')
    await mkdir(docDir)
    await writeFile(join(docDir, 'settings.json'), JSON.stringify({path: '/index'}))
    await writeFile(join(docDir, 'index.html'), '<html></html>')

    const result = await discoverDocuments(tempDir)
    assert.strictEqual(result.documents.size, 1)
    assert.ok(result.documents.has('/index'))
  })

  test('should detect template subdirectory', async () => {
    const docDir = join(tempDir, 'templated-doc')
    await mkdir(docDir)
    await mkdir(join(docDir, 'template'))
    await writeFile(join(docDir, 'settings.json'), JSON.stringify({path: '/templated'}))
    await writeFile(join(docDir, 'content.html'), 'content')

    const result = await discoverDocuments(tempDir)
    const doc = result.documents.get('/templated')
    assert.strictEqual(doc?.hasTemplate, true)
    assert.strictEqual(doc?.hasSlot, false)
  })

  test('should detect slot subdirectory', async () => {
    const docDir = join(tempDir, 'slotted-doc')
    await mkdir(docDir)
    await mkdir(join(docDir, 'slot'))
    await writeFile(join(docDir, 'settings.json'), JSON.stringify({path: '/slotted'}))
    await writeFile(join(docDir, 'content.html'), 'content')

    const result = await discoverDocuments(tempDir)
    const doc = result.documents.get('/slotted')
    assert.strictEqual(doc?.hasSlot, true)
    assert.strictEqual(doc?.hasTemplate, false)
  })

  test('should capture template_path and slot_path from settings', async () => {
    const docDir = join(tempDir, 'ref-doc')
    await mkdir(docDir)
    await writeFile(
      join(docDir, 'settings.json'),
      JSON.stringify({
        path: '/ref',
        template_path: '/shared/template',
        slot_path: '/shared/slot',
      }),
    )
    await writeFile(join(docDir, 'content.html'), 'content')

    const result = await discoverDocuments(tempDir)
    const doc = result.documents.get('/ref')
    assert.strictEqual(doc?.templatePath, '/shared/template')
    assert.strictEqual(doc?.slotPath, '/shared/slot')
  })

  test('should discover multiple documents and sort them alphabetically', async () => {
    // Create three documents
    for (const name of ['zebra', 'apple', 'mango']) {
      const docDir = join(tempDir, name)
      await mkdir(docDir)
      await writeFile(join(docDir, 'settings.json'), JSON.stringify({path: `/${name}`}))
      await writeFile(join(docDir, 'content.html'), 'content')
    }

    const result = await discoverDocuments(tempDir)
    assert.strictEqual(result.documents.size, 3)
    assert.deepStrictEqual(result.sortedPaths, ['/apple', '/mango', '/zebra'])
  })

  test('should skip node_modules directory', async () => {
    // Create a valid doc in root
    const rootDoc = join(tempDir, 'valid')
    await mkdir(rootDoc)
    await writeFile(join(rootDoc, 'settings.json'), JSON.stringify({path: '/valid'}))
    await writeFile(join(rootDoc, 'content.html'), 'content')

    // Create a doc in node_modules (should be skipped)
    const nodeModulesDoc = join(tempDir, 'node_modules', 'hidden')
    await mkdir(nodeModulesDoc, {recursive: true})
    await writeFile(join(nodeModulesDoc, 'settings.json'), JSON.stringify({path: '/hidden'}))
    await writeFile(join(nodeModulesDoc, 'content.html'), 'content')

    const result = await discoverDocuments(tempDir)
    assert.strictEqual(result.documents.size, 1)
    assert.ok(result.documents.has('/valid'))
    assert.ok(!result.documents.has('/hidden'))
  })

  test('should skip .git directory', async () => {
    const gitDoc = join(tempDir, '.git', 'hooks')
    await mkdir(gitDoc, {recursive: true})
    await writeFile(join(gitDoc, 'settings.json'), JSON.stringify({path: '/git-hidden'}))
    await writeFile(join(gitDoc, 'content.html'), 'content')

    const result = await discoverDocuments(tempDir)
    assert.strictEqual(result.documents.size, 0)
  })

  test('should skip hidden directories (starting with .)', async () => {
    const hiddenDoc = join(tempDir, '.hidden')
    await mkdir(hiddenDoc)
    await writeFile(join(hiddenDoc, 'settings.json'), JSON.stringify({path: '/hidden'}))
    await writeFile(join(hiddenDoc, 'content.html'), 'content')

    const result = await discoverDocuments(tempDir)
    assert.strictEqual(result.documents.size, 0)
  })

  test('should skip uploads directory', async () => {
    const uploadsDoc = join(tempDir, 'uploads', 'image')
    await mkdir(uploadsDoc, {recursive: true})
    await writeFile(join(uploadsDoc, 'settings.json'), JSON.stringify({path: '/upload-hidden'}))
    await writeFile(join(uploadsDoc, 'content.html'), 'content')

    const result = await discoverDocuments(tempDir)
    assert.strictEqual(result.documents.size, 0)
  })

  test('should skip directories without settings.json', async () => {
    const noSettingsDoc = join(tempDir, 'no-settings')
    await mkdir(noSettingsDoc)
    await writeFile(join(noSettingsDoc, 'content.html'), 'content')

    const result = await discoverDocuments(tempDir)
    assert.strictEqual(result.documents.size, 0)
  })

  test('should skip directories without content file', async () => {
    const noContentDoc = join(tempDir, 'no-content')
    await mkdir(noContentDoc)
    await writeFile(join(noContentDoc, 'settings.json'), JSON.stringify({path: '/no-content'}))

    const result = await discoverDocuments(tempDir)
    assert.strictEqual(result.documents.size, 0)
  })

  test('should skip settings.json without path property', async () => {
    const noPathDoc = join(tempDir, 'no-path')
    await mkdir(noPathDoc)
    await writeFile(join(noPathDoc, 'settings.json'), JSON.stringify({title: 'No Path'}))
    await writeFile(join(noPathDoc, 'content.html'), 'content')

    const result = await discoverDocuments(tempDir)
    assert.strictEqual(result.documents.size, 0)
  })

  test('should handle invalid JSON in settings.json gracefully', async () => {
    const badJsonDoc = join(tempDir, 'bad-json')
    await mkdir(badJsonDoc)
    await writeFile(join(badJsonDoc, 'settings.json'), 'not valid json {')
    await writeFile(join(badJsonDoc, 'content.html'), 'content')

    const result = await discoverDocuments(tempDir)
    assert.strictEqual(result.documents.size, 0)
    // Should not throw, just skip the invalid file
  })

  test('should detect duplicate paths and track them', async () => {
    // Create two documents with the same path
    const doc1 = join(tempDir, 'first')
    const doc2 = join(tempDir, 'second')
    await mkdir(doc1)
    await mkdir(doc2)
    await writeFile(join(doc1, 'settings.json'), JSON.stringify({path: '/duplicate'}))
    await writeFile(join(doc1, 'content.html'), 'first content')
    await writeFile(join(doc2, 'settings.json'), JSON.stringify({path: '/duplicate'}))
    await writeFile(join(doc2, 'content.html'), 'second content')

    const result = await discoverDocuments(tempDir)
    assert.strictEqual(result.documents.size, 1) // Only one is kept in the map
    assert.strictEqual(result.duplicates.size, 1)
    assert.ok(result.duplicates.has('/duplicate'))
    const dupPaths = result.duplicates.get('/duplicate')
    assert.strictEqual(dupPaths?.length, 2)
  })

  test('should recurse into nested directories', async () => {
    const nestedDoc = join(tempDir, 'a', 'b', 'c', 'deep-doc')
    await mkdir(nestedDoc, {recursive: true})
    await writeFile(join(nestedDoc, 'settings.json'), JSON.stringify({path: '/deep'}))
    await writeFile(join(nestedDoc, 'content.html'), 'content')

    const result = await discoverDocuments(tempDir)
    assert.strictEqual(result.documents.size, 1)
    assert.ok(result.documents.has('/deep'))
  })

  test('should handle symlink loops without infinite recursion', async () => {
    const docDir = join(tempDir, 'real-doc')
    await mkdir(docDir)
    await writeFile(join(docDir, 'settings.json'), JSON.stringify({path: '/real'}))
    await writeFile(join(docDir, 'content.html'), 'content')

    // Create a symlink that points to a parent directory (loop)
    try {
      await symlink(tempDir, join(docDir, 'loop-link'))
    } catch {
      // Skip if symlinks aren't supported
      return
    }

    const result = await discoverDocuments(tempDir)
    // Should complete without hanging, and find the real doc
    assert.strictEqual(result.documents.size, 1)
    assert.ok(result.documents.has('/real'))
  })

  test('should skip other ignored folders like dist and build', async () => {
    for (const folder of ['dist', 'build', 'coverage', '.next', '.nuxt', '.cache']) {
      const ignoredDoc = join(tempDir, folder, 'doc')
      await mkdir(ignoredDoc, {recursive: true})
      await writeFile(join(ignoredDoc, 'settings.json'), JSON.stringify({path: `/${folder}-hidden`}))
      await writeFile(join(ignoredDoc, 'content.html'), 'content')
    }

    const result = await discoverDocuments(tempDir)
    assert.strictEqual(result.documents.size, 0)
  })

  test('should use cwd when no root directory is provided', async () => {
    // This test is somewhat limited because we can't easily control cwd
    // Just verify the function doesn't crash without arguments
    const result = await discoverDocuments()
    assert.ok(result.documents instanceof Map)
    assert.ok(Array.isArray(result.sortedPaths))
    assert.ok(Array.isArray(result.errors))
    assert.ok(result.duplicates instanceof Map)
  })
})

describe('findDefaultRedirect', () => {
  test('should return null for empty array', () => {
    const result = findDefaultRedirect([])
    assert.strictEqual(result, null)
  })

  test('should return first top-level path', () => {
    const paths = ['/about', '/blog', '/contact']
    const result = findDefaultRedirect(paths)
    assert.strictEqual(result, '/about')
  })

  test('should prefer top-level paths over nested paths', () => {
    const paths = ['/blog/post-1', '/about', '/blog/post-2']
    const result = findDefaultRedirect(paths)
    assert.strictEqual(result, '/about')
  })

  test('should skip root path when finding default', () => {
    const paths = ['/', '/about', '/contact']
    const result = findDefaultRedirect(paths)
    assert.strictEqual(result, '/about')
  })

  test('should return first non-root path if no top-level paths exist', () => {
    const paths = ['/', '/blog/post-1', '/blog/post-2']
    const result = findDefaultRedirect(paths)
    assert.strictEqual(result, '/blog/post-1')
  })

  test('should return null if only root exists', () => {
    const paths = ['/']
    const result = findDefaultRedirect(paths)
    assert.strictEqual(result, null)
  })

  test('should handle deeply nested paths', () => {
    const paths = ['/a/b/c/d', '/x/y/z']
    const result = findDefaultRedirect(paths)
    assert.strictEqual(result, '/a/b/c/d')
  })

  test('should handle mixed top-level and nested paths', () => {
    const paths = ['/a/b', '/c/d/e', '/foo', '/bar']
    const result = findDefaultRedirect(paths)
    // Should return first top-level in the sorted array (which is already sorted alphabetically)
    assert.strictEqual(result, '/foo')
  })
})
