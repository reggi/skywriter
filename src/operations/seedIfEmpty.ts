import {readFileSync, readdirSync} from 'node:fs'
import {join, extname} from 'node:path'
import {upsert} from './upsert.ts'
import type {EditDocumentInput, DbOperation} from './types.ts'
import {hasEtaTemplates} from './utils/utils.ts'

/**
 * Reads document files from a directory and returns an EditDocumentInput.
 * Mirrors the logic in src/cli/utils/assemble.ts but synchronous and minimal.
 */
function readDocumentDir(dir: string): EditDocumentInput & {template_path?: string | null; slot_path?: string | null} {
  const files = readdirSync(dir)

  // Read settings.json
  const settingsRaw = readFileSync(join(dir, 'settings.json'), 'utf-8')
  const settings = JSON.parse(settingsRaw)

  // Find content file (content.* or index.html)
  const contentFile =
    files.find(f => f.startsWith('content.')) || (files.includes('index.html') ? 'index.html' : undefined)
  const content = contentFile ? readFileSync(join(dir, contentFile), 'utf-8') : undefined

  // Find data file (data.*)
  const dataFile = files.find(f => f.startsWith('data.'))
  const data = dataFile ? readFileSync(join(dir, dataFile), 'utf-8') : undefined

  // Read optional files
  const style = files.includes('style.css') ? readFileSync(join(dir, 'style.css'), 'utf-8') : undefined
  const script = files.includes('script.js') ? readFileSync(join(dir, 'script.js'), 'utf-8') : undefined
  const server = files.includes('server.js') ? readFileSync(join(dir, 'server.js'), 'utf-8') : undefined

  // Determine content_type from extension
  const ext = contentFile ? extname(contentFile).toLowerCase() : '.md'
  const contentTypeMap: Record<string, string> = {
    '.md': 'text/markdown',
    '.html': 'text/html',
    '.eta': 'text/html',
    '.txt': 'text/plain',
  }
  const content_type = contentTypeMap[ext] || 'text/plain'

  // Determine data_type from extension
  const dataExt = dataFile ? extname(dataFile).toLowerCase() : null
  const dataTypeMap: Record<string, string> = {'.json': 'json', '.yaml': 'yaml', '.yml': 'yaml', '.toml': 'toml'}
  const data_type = dataExt ? dataTypeMap[dataExt] || null : null

  // Check for eta templates
  const has_eta = content ? hasEtaTemplates(content) : false

  // Normalize extension: .md, .html, .eta all become .html
  const extension = ['.md', '.html', '.eta'].includes(ext) ? '.html' : ext

  return {
    path: settings.path,
    title: settings.title || '',
    content,
    data,
    style,
    script,
    server,
    content_type,
    data_type,
    has_eta,
    mime_type: settings.mime_type || 'text/html; charset=UTF-8',
    extension,
    published: settings.published ?? true,
    template_path: settings.template_path ?? null,
    slot_path: settings.slot_path ?? null,
  }
}

/**
 * Seeds the database with demo content if no documents exist.
 * Reads document files from the pages/intro/ directory bundled with the package.
 */
export const seedIfEmpty: DbOperation<[], boolean> = async client => {
  const result = await client.query<{count: string}>('SELECT COUNT(*) as count FROM documents')
  const count = parseInt(result.rows[0].count, 10)
  if (count > 0) return false

  console.log('No documents found in database, seeding with instructions...')
  // Resolve pages directory relative to this file's location in the package
  const pagesDir = new URL('../../pages/intro', import.meta.url).pathname

  // Read homepage document (standalone, no template)
  const homepageData = readDocumentDir(pagesDir)
  homepageData.path = '/' // Ensure homepage is at root
  delete homepageData.template_path
  delete homepageData.slot_path

  await upsert(client, homepageData)

  return true
}
