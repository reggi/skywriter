import {describe, it, afterEach} from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp, rm, writeFile, mkdir} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {assemble} from '../../../src/cli/utils/assemble.ts'

describe('assemble', () => {
  const createdDirs: string[] = []

  afterEach(async () => {
    await Promise.all(
      createdDirs.splice(0).map(async dir => {
        await rm(dir, {recursive: true, force: true})
      }),
    )
  })

  async function makeTmpDir(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'assemble-test-'))
    createdDirs.push(dir)
    return dir
  }

  describe('basic document assembly', () => {
    it('assembles a minimal markdown document', async () => {
      const dir = await makeTmpDir()
      await writeFile(join(dir, 'content.md'), '# Hello')
      await writeFile(join(dir, 'settings.json'), JSON.stringify({path: '/test'}))

      const doc = await assemble(dir)

      assert.equal(doc.path, '/test')
      assert.equal(doc.content, '# Hello')
      assert.equal(doc.content_type, 'text/markdown')
      assert.equal(doc.extension, '.html')
      assert.equal(doc.title, 'Untitled')
      assert.equal(doc.draft, true)
    })

    it('assembles an HTML document from index.html', async () => {
      const dir = await makeTmpDir()
      await writeFile(join(dir, 'index.html'), '<h1>Hello</h1>')
      await writeFile(join(dir, 'settings.json'), JSON.stringify({path: '/page'}))

      const doc = await assemble(dir)

      assert.equal(doc.content, '<h1>Hello</h1>')
      assert.equal(doc.content_type, 'text/html')
      assert.equal(doc.extension, '.html')
    })

    it('assembles a document with all optional files', async () => {
      const dir = await makeTmpDir()
      await writeFile(join(dir, 'content.md'), '# Hello')
      await writeFile(join(dir, 'data.yaml'), 'key: value')
      await writeFile(join(dir, 'style.css'), 'body { color: red; }')
      await writeFile(join(dir, 'script.js'), 'console.log("hi")')
      await writeFile(join(dir, 'server.js'), 'module.exports = {}')
      await writeFile(join(dir, 'settings.json'), JSON.stringify({path: '/full', title: 'Full Doc'}))

      const doc = await assemble(dir)

      assert.equal(doc.data, 'key: value')
      assert.equal(doc.data_type, 'yaml')
      assert.equal(doc.style, 'body { color: red; }')
      assert.equal(doc.script, 'console.log("hi")')
      assert.equal(doc.server, 'module.exports = {}')
      assert.equal(doc.title, 'Full Doc')
    })

    it('uses root path when settings.json has no path', async () => {
      const dir = await makeTmpDir()
      await writeFile(join(dir, 'content.md'), '# Hello')
      await writeFile(join(dir, 'settings.json'), JSON.stringify({}))

      const doc = await assemble(dir)

      assert.equal(doc.path, '/')
    })

    it('defaults to / when no settings.json exists', async () => {
      const dir = await makeTmpDir()
      await writeFile(join(dir, 'content.md'), '# Hello')

      const doc = await assemble(dir)

      assert.equal(doc.path, '/')
    })
  })

  describe('content type detection', () => {
    it('detects text/markdown for .md files', async () => {
      const dir = await makeTmpDir()
      await writeFile(join(dir, 'content.md'), '# Markdown')
      await writeFile(join(dir, 'settings.json'), JSON.stringify({path: '/md'}))

      const doc = await assemble(dir)
      assert.equal(doc.content_type, 'text/markdown')
    })

    it('detects text/html for .html content files', async () => {
      const dir = await makeTmpDir()
      await writeFile(join(dir, 'content.html'), '<p>HTML</p>')
      await writeFile(join(dir, 'settings.json'), JSON.stringify({path: '/html'}))

      const doc = await assemble(dir)
      assert.equal(doc.content_type, 'text/html')
    })

    it('detects text/html for .eta files', async () => {
      const dir = await makeTmpDir()
      await writeFile(join(dir, 'content.eta'), '<%= it.name %>')
      await writeFile(join(dir, 'settings.json'), JSON.stringify({path: '/eta'}))

      const doc = await assemble(dir)
      assert.equal(doc.content_type, 'text/html')
    })

    it('defaults to text/plain for unknown extensions', async () => {
      const dir = await makeTmpDir()
      await writeFile(join(dir, 'content.txt'), 'Plain text')
      await writeFile(join(dir, 'settings.json'), JSON.stringify({path: '/txt'}))

      const doc = await assemble(dir)
      assert.equal(doc.content_type, 'text/plain')
    })
  })

  describe('data type detection', () => {
    it('detects yaml for .yaml files', async () => {
      const dir = await makeTmpDir()
      await writeFile(join(dir, 'content.md'), '# Doc')
      await writeFile(join(dir, 'data.yaml'), 'key: value')

      const doc = await assemble(dir)
      assert.equal(doc.data_type, 'yaml')
    })

    it('detects yaml for .yml files', async () => {
      const dir = await makeTmpDir()
      await writeFile(join(dir, 'content.md'), '# Doc')
      await writeFile(join(dir, 'data.yml'), 'key: value')

      const doc = await assemble(dir)
      assert.equal(doc.data_type, 'yaml')
    })

    it('detects json for .json files', async () => {
      const dir = await makeTmpDir()
      await writeFile(join(dir, 'content.md'), '# Doc')
      await writeFile(join(dir, 'data.json'), '{"key": "value"}')

      const doc = await assemble(dir)
      assert.equal(doc.data_type, 'json')
    })

    it('returns null data_type when no data file exists', async () => {
      const dir = await makeTmpDir()
      await writeFile(join(dir, 'content.md'), '# Doc')

      const doc = await assemble(dir)
      assert.equal(doc.data_type, null)
    })
  })

  describe('ETA template detection', () => {
    it('detects ETA templates in content', async () => {
      const dir = await makeTmpDir()
      await writeFile(join(dir, 'content.eta'), '<%= it.name %>')
      await writeFile(join(dir, 'settings.json'), JSON.stringify({path: '/eta'}))

      const doc = await assemble(dir)
      assert.equal(doc.has_eta, true)
    })

    it('returns false when content has no ETA templates', async () => {
      const dir = await makeTmpDir()
      await writeFile(join(dir, 'content.md'), '# No ETA here')

      const doc = await assemble(dir)
      assert.equal(doc.has_eta, false)
    })
  })

  describe('error handling', () => {
    it('throws when no content file found', async () => {
      const dir = await makeTmpDir()
      await writeFile(join(dir, 'settings.json'), JSON.stringify({path: '/empty'}))

      await assert.rejects(() => assemble(dir), /No content file found/)
    })

    it('throws when multiple content files exist', async () => {
      const dir = await makeTmpDir()
      await writeFile(join(dir, 'content.md'), '# Markdown')
      await writeFile(join(dir, 'index.html'), '<p>HTML</p>')

      await assert.rejects(() => assemble(dir), /Multiple content files found/)
    })
  })

  describe('template and slot resolution', () => {
    it('assembles document with template from local directory', async () => {
      const dir = await makeTmpDir()
      await writeFile(join(dir, 'content.md'), '# Main')
      await writeFile(join(dir, 'settings.json'), JSON.stringify({path: '/main', template_path: '/tmpl'}))

      await mkdir(join(dir, 'template'))
      await writeFile(join(dir, 'template', 'content.md'), '# Template')
      await writeFile(join(dir, 'template', 'settings.json'), JSON.stringify({path: '/tmpl'}))

      const doc = await assemble(dir)

      assert.ok(doc.template)
      assert.equal(doc.template!.content, '# Template')
      assert.equal(doc.template!.path, '/tmpl')
    })

    it('assembles document with slot from local directory', async () => {
      const dir = await makeTmpDir()
      await writeFile(join(dir, 'content.md'), '# Main')
      await writeFile(join(dir, 'settings.json'), JSON.stringify({path: '/main', slot_path: '/myslot'}))

      await mkdir(join(dir, 'slot'))
      await writeFile(join(dir, 'slot', 'content.md'), '# Slot Content')
      await writeFile(join(dir, 'slot', 'settings.json'), JSON.stringify({path: '/myslot'}))

      const doc = await assemble(dir)

      assert.ok(doc.slot)
      assert.equal(doc.slot!.content, '# Slot Content')
      assert.equal(doc.slot!.path, '/myslot')
    })

    it('does not load template/slot when isNested is true', async () => {
      const dir = await makeTmpDir()
      await writeFile(join(dir, 'content.md'), '# Nested')
      await writeFile(join(dir, 'settings.json'), JSON.stringify({path: '/nested', template_path: '/tmpl'}))

      await mkdir(join(dir, 'template'))
      await writeFile(join(dir, 'template', 'content.md'), '# Template')
      await writeFile(join(dir, 'template', 'settings.json'), JSON.stringify({path: '/tmpl'}))

      const doc = await assemble(dir, true)

      assert.equal(doc.template, undefined)
    })

    it('throws when template path mismatches settings', async () => {
      const dir = await makeTmpDir()
      await writeFile(join(dir, 'content.md'), '# Main')
      await writeFile(join(dir, 'settings.json'), JSON.stringify({path: '/main', template_path: '/expected'}))

      await mkdir(join(dir, 'template'))
      await writeFile(join(dir, 'template', 'content.md'), '# Template')
      await writeFile(join(dir, 'template', 'settings.json'), JSON.stringify({path: '/actual'}))

      await assert.rejects(() => assemble(dir), /Template path mismatch/)
    })

    it('throws when slot path mismatches settings', async () => {
      const dir = await makeTmpDir()
      await writeFile(join(dir, 'content.md'), '# Main')
      await writeFile(join(dir, 'settings.json'), JSON.stringify({path: '/main', slot_path: '/expected'}))

      await mkdir(join(dir, 'slot'))
      await writeFile(join(dir, 'slot', 'content.md'), '# Slot')
      await writeFile(join(dir, 'slot', 'settings.json'), JSON.stringify({path: '/actual'}))

      await assert.rejects(() => assemble(dir), /Slot path mismatch/)
    })

    it('throws when template dir not found and no resolver', async () => {
      const dir = await makeTmpDir()
      await writeFile(join(dir, 'content.md'), '# Main')
      await writeFile(join(dir, 'settings.json'), JSON.stringify({path: '/main', template_path: '/tmpl'}))

      await assert.rejects(() => assemble(dir), /Template directory not found/)
    })

    it('throws when slot dir not found and no resolver', async () => {
      const dir = await makeTmpDir()
      await writeFile(join(dir, 'content.md'), '# Main')
      await writeFile(join(dir, 'settings.json'), JSON.stringify({path: '/main', slot_path: '/myslot'}))

      await assert.rejects(() => assemble(dir), /Slot directory not found/)
    })

    it('uses resolveDocumentPath for template when local dir not found', async () => {
      const dir = await makeTmpDir()
      await writeFile(join(dir, 'content.md'), '# Main')
      await writeFile(join(dir, 'settings.json'), JSON.stringify({path: '/main', template_path: '/tmpl'}))

      // Create template in a separate directory (not under dir/template)
      const templateDir = await makeTmpDir()
      await writeFile(join(templateDir, 'content.md'), '# Resolved Template')
      await writeFile(join(templateDir, 'settings.json'), JSON.stringify({path: '/tmpl'}))

      const doc = await assemble(dir, {
        resolveDocumentPath: async (path: string) => {
          if (path === '/tmpl') return templateDir
          return null
        },
      })

      assert.ok(doc.template)
      assert.equal(doc.template!.content, '# Resolved Template')
    })

    it('uses resolveDocumentPath for slot when local dir not found', async () => {
      const dir = await makeTmpDir()
      await writeFile(join(dir, 'content.md'), '# Main')
      await writeFile(join(dir, 'settings.json'), JSON.stringify({path: '/main', slot_path: '/myslot'}))

      const slotDir = await makeTmpDir()
      await writeFile(join(slotDir, 'content.md'), '# Resolved Slot')
      await writeFile(join(slotDir, 'settings.json'), JSON.stringify({path: '/myslot'}))

      const doc = await assemble(dir, {
        resolveDocumentPath: async (path: string) => {
          if (path === '/myslot') return slotDir
          return null
        },
      })

      assert.ok(doc.slot)
      assert.equal(doc.slot!.content, '# Resolved Slot')
    })

    it('does not throw when resolver returns null for template', async () => {
      const dir = await makeTmpDir()
      await writeFile(join(dir, 'content.md'), '# Main')
      await writeFile(join(dir, 'settings.json'), JSON.stringify({path: '/main', template_path: '/tmpl'}))

      const doc = await assemble(dir, {
        resolveDocumentPath: async () => null,
      })

      assert.equal(doc.template, undefined)
    })

    it('does not throw when resolver returns null for slot', async () => {
      const dir = await makeTmpDir()
      await writeFile(join(dir, 'content.md'), '# Main')
      await writeFile(join(dir, 'settings.json'), JSON.stringify({path: '/main', slot_path: '/myslot'}))

      const doc = await assemble(dir, {
        resolveDocumentPath: async () => null,
      })

      assert.equal(doc.slot, undefined)
    })
  })

  describe('mime_type from settings', () => {
    it('uses mime_type from settings.json if provided', async () => {
      const dir = await makeTmpDir()
      await writeFile(join(dir, 'content.md'), '# Doc')
      await writeFile(join(dir, 'settings.json'), JSON.stringify({path: '/custom', mime_type: 'application/json'}))

      const doc = await assemble(dir)
      assert.equal(doc.mime_type, 'application/json')
    })

    it('defaults to text/html; charset=UTF-8 when no mime_type in settings', async () => {
      const dir = await makeTmpDir()
      await writeFile(join(dir, 'content.md'), '# Doc')

      const doc = await assemble(dir)
      assert.equal(doc.mime_type, 'text/html; charset=UTF-8')
    })
  })
})
