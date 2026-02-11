import {readFileSync, readdirSync} from 'node:fs'
import {join, extname} from 'node:path'
import type {PoolClient} from 'pg'
import {upsert} from './upsert.ts'
import {findDocument} from './findDocument.ts'
import type {EditDocumentInput} from './types.ts'

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
  const has_eta = content ? /<%[\s\S]*?%>/.test(content) : false

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
 * Reads document files from the pages/skywriter/ directory bundled with the package.
 */
export async function seedIfEmpty(client: PoolClient): Promise<boolean> {
  const result = await client.query<{count: string}>('SELECT COUNT(*) as count FROM documents')
  const count = parseInt(result.rows[0].count, 10)
  if (count > 0) return false

  console.log('No documents found in database, seeding with instructions...')
  // Resolve pages directory relative to this file's location in the package
  const pagesDir = new URL('../../pages/skywriter', import.meta.url).pathname

  // Read template document first (other documents may reference it)
  const templateDir = join(pagesDir, 'template')
  const templateData = readDocumentDir(templateDir)

  // Extract and remove non-EditDocumentInput fields
  const templateSlotPath = templateData.slot_path
  delete templateData.template_path
  delete templateData.slot_path

  // Upsert template document
  const templateResult = await upsert(client, templateData)

  // Read homepage document
  const homepageData = readDocumentDir(pagesDir)
  homepageData.path = '/' // Ensure homepage is at root
  const homepageTemplatePath = homepageData.template_path
  delete homepageData.template_path
  delete homepageData.slot_path

  // Resolve template_path to template_id
  if (homepageTemplatePath) {
    const templateDoc = await findDocument(client, {path: homepageTemplatePath})
    if (templateDoc) {
      homepageData.template_id = templateDoc.id
    }
  }

  // Resolve slot_path for template (the template's slot is the homepage)
  // We need the homepage to exist first, then update the template's slot_id
  const homepageResult = await upsert(client, homepageData)

  // Now update the template's slot_id to point to the homepage
  if (templateSlotPath && homepageResult.current) {
    const homepageDoc = await findDocument(client, {path: templateSlotPath})
    if (homepageDoc) {
      await upsert(client, {id: templateResult.current!.id}, {slot_id: homepageDoc.id})
    }
  }

  return true
}
