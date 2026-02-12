import type {RenderDocument} from '../operations/types.ts'
import {stringifyData} from '../utils/stringifyData.ts'
import type {RenderedDoc} from '../render/index.ts'
import {pack} from 'tar-stream'
import {createGzip} from 'zlib'
import {Readable} from 'stream'
import yaml from 'yaml'

type ArchiveFile = {filename: string; content: string | Buffer}

class Archive {
  files: ArchiveFile[]
  constructor(files: ArchiveFile[]) {
    this.files = files
  }
}

type Content = string | Buffer | Archive | Record<string, unknown> | unknown[]

type Asset =
  | {
      redirect: string
    }
  | {
      content: (
        doc: RenderDocument,
        assets: Record<string, Asset>,
        getRender?: (doc: RenderDocument) => Promise<RenderedDoc>,
      ) => Promise<Content> | Content
      contentType: string
    }

/**
 * Create a Response from an Asset
 */
async function assetResponse(
  document: RenderDocument,
  asset: Asset,
  assets: Record<string, Asset>,
  filename: string,
  getRender?: (doc: RenderDocument) => Promise<RenderedDoc>,
): Promise<Response> {
  const path = document.path

  // Handle redirects
  if ('redirect' in asset) {
    const redirectKey = asset.redirect
    const redirectPath = path === '/' ? redirectKey : `${path}${redirectKey}`
    return new Response(null, {
      status: 302,
      headers: {Location: redirectPath},
    })
  }

  // Get content
  let content = await asset.content(document, assets, getRender)

  // Handle Archive type (for archive.tar.gz)
  if (content instanceof Archive) {
    const tarStream = pack()
    const gzip = createGzip()
    const output = tarStream.pipe(gzip)

    // Add entries to tar stream
    for (const file of content.files) {
      const fileContent = typeof file.content === 'string' ? Buffer.from(file.content, 'utf-8') : file.content
      tarStream.entry({name: file.filename}, fileContent)
    }

    // Finalize the tar stream
    tarStream.finalize()

    return new Response(Readable.toWeb(output) as ReadableStream, {
      status: 200,
      headers: {
        'Content-Type': asset.contentType,
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    })
  }

  // Handle arrays (for JSON arrays)
  if (Array.isArray(content)) {
    if (asset.contentType.includes('json')) {
      content = JSON.stringify(content, null, 2)
    } else {
      throw new Error('Array content is only supported for JSON content types')
    }
  }

  // Handle object content for JSON responses
  if (typeof content === 'object' && content !== null && !Buffer.isBuffer(content)) {
    if (asset.contentType.includes('json')) {
      content = JSON.stringify(content, null, 2)
    } else {
      throw new Error('Object content is only supported for JSON content types')
    }
  }

  // Handle regular content (string or Buffer)
  // For Buffer, convert to ReadableStream to avoid getReader() errors
  const body: string | ReadableStream = Buffer.isBuffer(content)
    ? (Readable.toWeb(Readable.from(content)) as ReadableStream)
    : content

  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': asset.contentType,
      'Content-Disposition': `inline`,
    },
  })
}

function resolve<T extends Record<string, Asset>>(assets: T, key: string): [string, Asset] {
  const asset = assets[key]
  if (!asset) {
    throw new Error(`Asset not found: ${key}`)
  }
  if ('redirect' in asset) {
    return resolve(assets, asset.redirect)
  }
  return [key, asset]
}

async function getFiles<T extends Record<string, Asset>>(
  doc: RenderDocument,
  assets: T,
  keys: string[],
  getRender?: (doc: RenderDocument) => Promise<RenderedDoc>,
): Promise<Archive> {
  const files = await Promise.all(
    keys.map(async key => {
      const [resolvedKey, resolvedAsset] = await resolve(assets, key)
      if (!('content' in resolvedAsset)) {
        throw new Error(`Cannot include redirect asset in archive: ${resolvedKey}`)
      }
      const content = await resolvedAsset.content(doc, assets, getRender)
      const filename = resolvedKey.startsWith('/') ? resolvedKey.slice(1) : resolvedKey

      // Convert content to string or Buffer
      let fileContent: string | Buffer
      if (typeof content === 'string') {
        fileContent = content
      } else if (Buffer.isBuffer(content)) {
        fileContent = content
      } else {
        // For any other type (objects, arrays, etc.), convert to empty Buffer
        fileContent = JSON.stringify(content, null, 2)
      }

      return {
        filename,
        content: fileContent,
      }
    }),
  )

  return new Archive(files)
}

/**
 * Get archive content for the /archive.tar.gz asset
 * This function connects getFiles to the ASSETS definition
 */
function getArchiveContent(
  doc: RenderDocument,
  assets: Record<string, Asset>,
  getRender?: (doc: RenderDocument) => Promise<RenderedDoc>,
): Promise<Archive> {
  const keys = ['/content', '/data', '/style.css', '/script.js', '/server.js', '/settings.json']
  return getFiles(doc, assets, keys, getRender)
}

export async function createArchive(
  doc: RenderDocument,
  key: string = '/archive.tar.gz',
  getRender?: (doc: RenderDocument) => Promise<RenderedDoc>,
): Promise<ArchiveFile[]> {
  const assets = getAssets(doc)
  const resolved = resolveAsset(doc, assets, key)
  const content = await resolved.content?.(doc, getRender)
  if (!(content instanceof Archive)) {
    throw new Error('Archive content must be an Archive instance')
  }
  return content.files
}

type ResolvedAsset = {
  content?: (doc: RenderDocument, getRender?: (doc: RenderDocument) => Promise<RenderedDoc>) => Promise<Content>
  asset: Asset
  key: string
  filename: string
}

/**
 * Resolve an asset key to its final asset (without following redirects)
 * This is the middle function that handles asset lookup
 */
function resolveAsset(doc: RenderDocument, assets: Record<string, Asset>, assetKey?: string): ResolvedAsset {
  // Default to root asset if no key specified
  const key = assetKey || ''

  // Find the asset
  const asset = assets[key]
  if (!asset) {
    throw new Error(`Asset not found: ${key}`)
  }

  // Get filename for the asset
  const filename = key.startsWith('/') ? key.slice(1) : key || 'index.html'

  // If it's a redirect, don't follow it - assetResponse will handle that
  if ('redirect' in asset) {
    return {
      content: undefined,
      asset,
      key,
      filename,
    }
  }

  // If it's content, return a function to get it
  return {
    content: async (doc: RenderDocument, getRender?: (doc: RenderDocument) => Promise<RenderedDoc>) =>
      await asset.content(doc, assets, getRender),
    asset,
    key,
    filename,
  }
}

/**
 * Get the content filename based on document state
 * Shared logic used by getContentPage and getTabFilenames
 */
function getContentFilename(doc: RenderDocument): string {
  if (doc.extension !== '.html' && !doc.has_eta) {
    return `content${doc.extension}`
  } else if (doc.has_eta) {
    return 'content.eta'
  } else if (doc.content_type === 'markdown') {
    return 'content.md'
  } else {
    return 'content.html'
  }
}

/**
 * Get the data filename based on document data_type
 */
function getDataFilename(doc: RenderDocument): string {
  return doc.data_type === 'yaml' ? 'data.yaml' : 'data.json'
}

function generateTotalMd(doc: RenderDocument): string {
  const lines: string[] = ['---']

  // Add title
  if (doc.title) {
    lines.push(`title: "${doc.title.replace(/"/g, '\\"')}"`)
  }

  // convert settings(doc) to YAML frontmatter
  const settingsYaml = yaml.stringify(settings(doc))
  lines.push(settingsYaml.trim())

  // Add data as YAML
  if (doc.data && doc.data.trim()) {
    const dataYaml = stringifyData(doc.data, 'yaml').trim()
    lines.push('data:')
    dataYaml.split('\n').forEach((line: string) => {
      lines.push(`  ${line}`)
    })
  }

  // Add style
  if (doc.style && doc.style.trim()) {
    lines.push('style: |')
    doc.style.split('\n').forEach(line => {
      lines.push(`  ${line}`)
    })
  }

  // Add script
  if (doc.script && doc.script.trim()) {
    lines.push('script: |')
    doc.script.split('\n').forEach(line => {
      lines.push(`  ${line}`)
    })
  }

  // Add server
  if (doc.server && doc.server.trim()) {
    lines.push('server: |')
    doc.server.split('\n').forEach(line => {
      lines.push(`  ${line}`)
    })
  }

  lines.push('---')
  lines.push('')

  lines.push(doc.content)

  return lines.join('\n')
}

function getContentPage(doc: RenderDocument): Record<string, Asset> {
  const contentFilename = getContentFilename(doc)
  const contentPath = `/${contentFilename}`

  // Non-HTML, non-eta content (e.g., .txt, .xml)
  if (doc.extension !== '.html' && !doc.has_eta) {
    return {
      [contentPath]: {
        content: doc => doc.content,
        contentType: doc.mime_type || 'text/plain; charset=utf-8',
      },
      '/content': {
        redirect: contentPath,
      },
    }
  }

  const assets: Record<string, Asset> = {}

  // Rendered markdown — available for markdown content or eta documents
  if (doc.content_type === 'markdown' || doc.has_eta) {
    assets['/content.md'] = {
      content: async (doc, _assets, getRender) => {
        if (!getRender) throw new Error('getRender is required for markdown content')
        return (await getRender(doc)).markdown
      },
      contentType: 'text/plain; charset=utf-8',
    }
    assets['.md'] = {redirect: '/content.md'}
  }

  // Rendered HTML — available for non-markdown content
  if (doc.content_type !== 'markdown') {
    assets['/content.html'] = {
      content: async (doc, _assets, getRender) => {
        if (!getRender) throw new Error('getRender is required for html content')
        return (await getRender(doc)).html
      },
      contentType: 'text/plain; charset=utf-8',
    }
  }

  // Raw eta source — available when document uses eta templates
  if (doc.has_eta) {
    assets['/content.eta'] = {
      content: (doc: RenderDocument) => doc.content,
      contentType: 'text/plain; charset=utf-8',
    }
    assets['.eta'] = {redirect: '/content.eta'}
  }

  // /content redirects to the primary content file
  if (doc.has_eta) {
    assets['/content'] = {redirect: '/content.eta'}
  } else if (doc.content_type === 'markdown') {
    assets['/content'] = {redirect: '/content.md'}
  } else {
    assets['/content'] = {redirect: '/content.html'}
  }

  return assets
}

/**
 * Get tab filenames based on document state
 * Used by editor to display appropriate filenames for each tab
 */
export function getTabFilenames(doc: RenderDocument): {
  content: string
  data: string
  style: string
  script: string
  server: string
  settings: string
} {
  return {
    content: getContentFilename(doc),
    data: getDataFilename(doc),
    style: 'style.css',
    script: 'script.js',
    server: 'server.js',
    settings: 'settings',
  }
}

function settings(doc: RenderDocument) {
  return {
    draft: doc.draft,
    extension: doc.extension,
    mime_type: doc.mime_type,
    path: doc.path,
    published: doc.published,
    slot_path: doc.slot?.path ?? null,
    template_path: doc.template?.path ?? null,
    title: doc.title,
    uploads: doc.uploads?.map(u => u.original_filename) || [],
  }
}

type AssetDefinition =
  | {redirect: string | ((doc: RenderDocument) => string)}
  | {
      content: (
        doc: RenderDocument,
        assets: Record<string, Asset>,
        getRender?: (doc: RenderDocument) => Promise<RenderedDoc>,
      ) => Promise<Content> | Content
      contentType: string | ((doc: RenderDocument) => string)
    }

const ASSETS = {
  '': {
    content: async (
      doc: RenderDocument,
      _assets: Record<string, Asset>,
      getRender?: (doc: RenderDocument) => Promise<RenderedDoc>,
    ) => {
      if (!getRender) throw new Error('getRender is required for root content')
      return (await getRender(doc)).html
    },
    contentType: (doc: RenderDocument) => doc.mime_type || 'text/html; charset=utf-8',
  },
  '/index.html': {
    redirect: '',
  },
  '.html': {
    redirect: '',
  },
  '.md': {
    redirect: '/content.md',
  },
  '.eta': {
    redirect: '/content.eta',
  },
  '/style.css': {
    content: (doc: RenderDocument) => doc.style || '',
    contentType: 'text/css',
  },
  '/style': {
    redirect: '/style.css',
  },
  '.css': {
    redirect: '/style.css',
  },
  '/script.js': {
    content: (doc: RenderDocument) => doc.script || '',
    contentType: 'application/javascript',
  },
  '/script': {
    redirect: '/script.js',
  },
  '.js': {
    redirect: '/script.js',
  },
  '/server.js': {
    content: (doc: RenderDocument) => doc.server || '',
    contentType: 'application/javascript',
  },
  '/server': {
    redirect: '/server.js',
  },
  '/data': {
    redirect: (doc: RenderDocument) => (doc.data_type === 'yaml' ? '/data.yaml' : '/data.json'),
  },
  '/data.json': {
    content: (doc: RenderDocument) => stringifyData(doc.data, 'json', true),
    contentType: 'application/json',
  },
  '/data.yaml': {
    content: (doc: RenderDocument) => stringifyData(doc.data, 'yaml'),
    contentType: 'text/yaml',
  },
  '/data.yml': {
    redirect: '/data.yaml',
  },
  '.yml': {
    redirect: '/data.yaml',
  },
  '.yaml': {
    redirect: '/data.yaml',
  },
  '/api.json': {
    contentType: 'application/json',
    content: (doc: RenderDocument, assets: Record<string, Asset>) => {
      const git = doc.path === '/' ? '/.git' : `${doc.path}.git`
      const files = Object.entries(assets)
        .filter(([, asset]) => !('redirect' in asset))
        .filter(([key]) => key !== '')
        .map(([key]) => (doc.path === '/' ? key : `${doc.path}${key}`))
      return [...files, git]
    },
  },
  '/api': {
    redirect: '/api.json',
  },
  '.json': {
    redirect: '/api.json',
  },
  '/settings.json': {
    content: (doc: RenderDocument) => settings(doc),
    contentType: 'application/json',
  },
  '/settings': {
    redirect: '/settings.json',
  },
  '/uploads.json': {
    content: (doc: RenderDocument) =>
      (doc.uploads || [])
        .filter(u => !u.hidden)
        .map(u => ({
          name: u.original_filename,
          hash: u.hash,
        })),
    contentType: 'application/json',
  },
  '/uploads': {
    redirect: '/uploads.json',
  },
  '/archive.tar.gz': {
    content: getArchiveContent,
    contentType: 'application/gzip',
  },
  '/archive': {
    redirect: '/archive.tar.gz',
  },
  '/edit.json': {
    contentType: 'application/json',
    content: async (
      doc: RenderDocument,
      _assets: Record<string, Asset>,
      getRender?: (doc: RenderDocument) => Promise<RenderedDoc>,
    ) => {
      if (!getRender) throw new Error('getRender is required for edit.json')
      return {
        document: doc,
        render: await getRender(doc),
      }
    },
  },
  '/total.md': {
    content: doc => generateTotalMd(doc),
    contentType: 'text/plain; charset=utf-8',
  },
} satisfies Record<string, AssetDefinition>

const ALL_ASSETS = [/\/content(\..+)?$/, ...Object.keys(ASSETS).sort((a, b) => b.length - a.length)]

function getAssets(doc: RenderDocument): Record<string, Asset> {
  // Normalize ASSETS to Asset type
  const normalizedAssets: Record<string, Asset> = {}
  for (const [key, value] of Object.entries(ASSETS)) {
    if ('redirect' in value) {
      normalizedAssets[key] = {
        redirect: typeof value.redirect === 'function' ? value.redirect(doc) : value.redirect,
      }
    } else {
      normalizedAssets[key] = {
        content: value.content as (
          doc: RenderDocument,
          assets: Record<string, Asset>,
          getRender?: (doc: RenderDocument) => Promise<RenderedDoc>,
        ) => Promise<Content> | Content,
        contentType: typeof value.contentType === 'function' ? value.contentType(doc) : value.contentType,
      }
    }
  }

  return {
    ...normalizedAssets,
    ...getContentPage(doc),
  }
}

/**
 * Get response for a document asset
 */
async function getResponse(
  doc: RenderDocument,
  assetKey: string | undefined,
  getRender?: (doc: RenderDocument) => Promise<RenderedDoc>,
): Promise<Response> {
  // Check if the request path is a redirect (not the canonical path)
  // If so, redirect to the canonical path with the asset key
  if (doc.redirect) {
    let redirectPath = assetKey ? `${doc.path}${assetKey}` : doc.path
    if (assetKey && doc.path === '/') {
      if (assetKey.startsWith('/')) {
        redirectPath = assetKey
      } else {
        redirectPath = `/${assetKey}`
      }
    }
    return new Response(null, {
      status: 302,
      headers: {Location: redirectPath},
    })
  }
  const assets = getAssets(doc) as Record<string, Asset>
  const key = assetKey || ''
  if (!assets[key]) {
    return new Response('Not Found', {status: 404})
  }
  const resolved = resolveAsset(doc, assets, assetKey)
  return assetResponse(doc, resolved.asset, assets, resolved.filename, getRender)
}

// Helper to parse path and extract asset name from URLs like /path/to/doc/asset.ext
function parsePathAndAsset(fullPath: string): {path: string; asset?: string} {
  // Check if path ends with any known asset
  for (const asset of ALL_ASSETS) {
    // Handle regex patterns
    if (asset instanceof RegExp) {
      const match = fullPath.match(asset)
      if (match) {
        const assetStr = match[0]
        const path = fullPath.slice(0, -assetStr.length) || '/'
        return {path, asset: assetStr}
      }
      continue
    }

    // Handle string patterns
    if (asset.startsWith('/')) {
      // Asset already has leading slash (e.g., /data.json)
      if (fullPath.endsWith(asset)) {
        const path = fullPath.slice(0, -asset.length) || '/'
        return {path, asset}
      }
    } else if (asset.startsWith('.')) {
      // Extension-style asset (e.g., .json)
      if (fullPath.endsWith(asset)) {
        const path = fullPath.slice(0, -asset.length) || '/'
        return {path, asset}
      }
    } else {
      // Asset needs a leading slash (shouldn't happen with current ASSETS)
      if (fullPath.endsWith(`/${asset}`) || fullPath === `/${asset}`) {
        const path = fullPath.slice(0, -(asset.length + 1)) || '/'
        return {path, asset}
      }
    }
  }

  return {path: fullPath}
}

export async function responder(options: {
  getDocument: ({path}: {path: string}) => Promise<RenderDocument>
  getRender?: (doc: RenderDocument) => Promise<RenderedDoc>
  path: string
}) {
  const {path, getDocument, getRender} = options
  const {path: docPath, asset} = parsePathAndAsset(path)
  const document = await getDocument({path: docPath})
  const result = await getResponse(document, asset, getRender)
  return result
}

export async function getContent(
  doc: RenderDocument,
  assetKey: string,
  getRender?: (doc: RenderDocument) => Promise<RenderedDoc>,
) {
  const assets = getAssets(doc)
  const resolved = resolveAsset(doc, assets, assetKey)
  return await resolved.content?.(doc, getRender)
}
