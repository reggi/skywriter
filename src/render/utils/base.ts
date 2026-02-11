import {marked, type Token} from 'marked'
import {Eta} from 'eta'
import {usageTracker} from './usageTracker.ts'
import {extractRawBlocks} from './extractRawBlocks.ts'
import path from 'path'

// Configure marked to preserve HTML in code blocks
marked.setOptions({
  breaks: false,
  gfm: true,
})

// Configure marked renderer for consistent heading IDs
const renderer = new marked.Renderer()
renderer.heading = function (args: {text: string; depth: number; tokens?: Token[]}) {
  const text = args.text
  const level = args.depth
  /* node:coverage disable */
  const tokens = args.tokens || []
  /* node:coverage enable */
  const id = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')

  const innerHTML = this.parser.parseInline(tokens)

  return `<h${level} id="${id}">${innerHTML}</h${level}>\n`
}

marked.use({renderer})

interface TocItem {
  level: number
  text: string
  id: string
  children: TocItem[]
}

interface Heading {
  level: number
  text: string
  id: string
}

interface Meta {
  createdAt: Date
  updatedAt: Date
  toc?: TocItem[]
  headings?: Heading[]
}

type Asset = {
  content: string
  inlineTag: string
  href: string
  tag: string
}

type DocAssets = {
  style: Asset
  script: Asset
}

// Type for tracking variable usage - nested structure for asset usage
interface VariableUsage {
  style?: {
    content?: number
    inlineTag?: number
    tag?: number
    href?: number
  }
  script?: {
    content?: number
    inlineTag?: number
    tag?: number
    href?: number
  }
  slot?: VariableUsage
  [key: string]: unknown
}

export interface RenderedDoc extends DocAssets {
  html: string
  markdown: string
  slot?: RenderedDoc
  template?: RenderedDoc
  title: string
  path: string
  data: Record<string, unknown>
  server: unknown
  meta: Meta
  variableUsage: VariableUsage
}

export interface VirtualDoc {
  title: string
  path: string
  createdAt?: Date
  updatedAt?: Date
  content?: string
  data?: Record<string, unknown>
  style?: string
  script?: string
  server?: string
  extension?: string
}

// Helper functions to generate asset paths
function getStylePath(doc: VirtualDoc): string {
  return path.join(doc.path, 'style.css')
}

function getScriptPath(doc: VirtualDoc): string {
  return path.join(doc.path, 'script.js')
}

// Helper to extract headings from HTML content
function extractHeadingsFromHtml(html: string): Array<{level: number; text: string; id: string}> {
  const headings: Array<{level: number; text: string; id: string}> = []
  const headingRegex = /<h([1-6])(?:\s+id=["']([^"']+)["'])?[^>]*>(.*?)<\/h\1>/gi

  let match
  while ((match = headingRegex.exec(html)) !== null) {
    const level = parseInt(match[1])
    const existingId = match[2]
    const htmlContent = match[3]

    // Strip HTML tags to get plain text
    const text = htmlContent.replace(/<[^>]+>/g, '').trim()

    // Use existing id or generate one
    const id =
      existingId ||
      text
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')

    headings.push({level, text, id})
  }

  return headings
}

// Helper to inject IDs into heading tags that don't have them
function injectHeadingIds(html: string, headings: Array<{level: number; text: string; id: string}>): string {
  let result = html
  let headingIndex = 0

  result = result.replace(
    /<h([1-6])(?:\s+id=["']([^"']+)["'])?([^>]*)>(.*?)<\/h\1>/gi,
    (match, level, existingId, attrs, content) => {
      if (existingId) {
        // Already has an ID, keep it as is
        headingIndex++
        return match
      }

      // Get the corresponding heading from our extracted list
      const heading = headings[headingIndex]
      headingIndex++

      /* node:coverage disable */
      if (heading) {
        // Inject the ID
        return `<h${level} id="${heading.id}"${attrs}>${content}</h${level}>`
      }

      return match
      /* node:coverage enable */
    },
  )

  return result
}

// Helper to generate error HTML
function createErrorHtml(type: string, errorMessage: string): string {
  return `<div style="color: #d32f2f; background: #ffebee; padding: 1rem; border-left: 4px solid #d32f2f; margin: 1rem 0;">
    <strong>${type} Error:</strong> ${errorMessage}
  </div>`
}

// Build nested TOC structure
function buildNestedToc(headings: Array<{level: number; text: string; id: string}>): TocItem[] {
  const root: TocItem[] = []
  const stack: TocItem[] = []

  for (const heading of headings) {
    const item: TocItem = {...heading, children: []}

    while (stack.length > 0 && stack[stack.length - 1].level >= heading.level) {
      stack.pop()
    }

    if (stack.length === 0) {
      root.push(item)
    } else {
      stack[stack.length - 1].children.push(item)
    }

    stack.push(item)
  }

  return root
}

function hasMarkdown(content: string): boolean {
  const trimmedContent = content.trim()

  // Check if any line starts with common markdown syntax
  const lines = content.split('\n')
  const hasMarkdownLine = lines.some(line => {
    const trimmed = line.trim()
    return (
      /^#{1,6}\s/.test(trimmed) || // Headers
      /^\s*[-*+]\s/.test(line) || // Unordered lists
      /^\s*\d+\.\s/.test(line) || // Ordered lists
      /^```/.test(trimmed) || // Code blocks
      (/^\s*>/.test(line) && /\S/.test(line.replace(/^\s*>/, '')) && !/^\s*>\s*<.*/.test(line)) // Blockquotes with text, not starting with '<'
    )
  })

  // If we find markdown syntax, it's markdown (even if it has some HTML)
  if (hasMarkdownLine) {
    return true
  }

  // Only treat as HTML (not markdown) if it looks like a complete HTML document
  // with structural tags like DOCTYPE, <html>, <head>, or <body>
  const htmlDocPattern = /<(!DOCTYPE html|html|head|body)[>\s]/i
  if (htmlDocPattern.test(trimmedContent)) {
    return false
  }

  // Default to not markdown if no clear indicators
  return false
}

// Helper to evaluate a module string and extract exports
async function evaluateModule(code: string): Promise<Record<string, unknown>> {
  const url = `data:text/javascript;charset=utf-8,${encodeURIComponent(code)}`
  return import(url) as Promise<Record<string, unknown>>
}

export async function baseRender(options: {
  doc: VirtualDoc
  context?: Record<string, unknown>
  type?: 'content' | 'slot' | 'template'
}): Promise<RenderedDoc> {
  const {doc, context = {}, type = 'content'} = options

  const data = doc.data || {}
  const createdAt = doc.createdAt || new Date()
  const updatedAt = doc.updatedAt || new Date()
  const title = doc.title
  const path = doc.path

  const meta: Meta = {
    createdAt: new Date(createdAt),
    updatedAt: new Date(updatedAt),
  }

  const _etaVariables = {
    title,
    path,
    meta,
    data,
    server: null as unknown,
    ...context,
    html: '',
    markdown: '',
    style: {
      content: doc.style || '',
      inlineTag: doc.style ? `<style>${doc.style}</style>` : '',
      href: getStylePath(doc),
      tag: doc.style ? `<link rel="stylesheet" href="${getStylePath(doc)}">` : '',
    },
    script: {
      content: doc.script || '',
      inlineTag: doc.script ? `<script>${doc.script}</script>` : '',
      href: getScriptPath(doc),
      tag: doc.script ? `<script src="${getScriptPath(doc)}"></script>` : '',
    },
  }

  // Create tracked variables first so we can track all template variable access
  const [etaVariables, getUsageSnapshot] = usageTracker(_etaVariables)

  // Process title first so server function can access rendered title
  const eta = new Eta({
    autoEscape: false,
    autoTrim: false,
    useWith: true,
  })
  _etaVariables.title = await eta.renderStringAsync(_etaVariables.title, etaVariables)

  // Evaluate server-side JavaScript if present
  if (doc.server) {
    try {
      const moduleExports = await evaluateModule(doc.server.trim())

      if (moduleExports.default) {
        // Call the default export if it's a function
        if (typeof moduleExports.default === 'function') {
          const result = await moduleExports.default(etaVariables)
          _etaVariables.server = result
        } else {
          _etaVariables.server = moduleExports.default
        }
      } else {
        // No default export, use all exports
        _etaVariables.server = moduleExports
      }
    } catch (error) {
      console.error('Server function evaluation error:', error)
      // Fail gracefully: keep server as null and continue rendering content.
      // This allows templates like `<%= server ? ... : "No server data" %>`.
      _etaVariables.server = null
    }
  }

  if (!doc.content) {
    const capturedUsage = getUsageSnapshot().usage
    return {..._etaVariables, variableUsage: capturedUsage} as RenderedDoc
  }

  // Check if content is markdown
  const isMd = hasMarkdown(doc.content)

  // First Eta pass - process everything except meta.toc and meta.headings
  let processedContent = doc.content
  let templateError = ''

  // Extract <%raw%>...<%endraw%> blocks before Eta processing
  const firstRaw = extractRawBlocks(processedContent)

  try {
    processedContent = firstRaw.restore(await eta.renderStringAsync(firstRaw.content, etaVariables))
  } catch (error) {
    templateError = error instanceof Error ? error.message : `Unknown ${type} error`
    // Capture usage before spreading to avoid tracking the spread itself
    const capturedUsage = getUsageSnapshot().usage
    // Return error HTML instead of broken content
    const renderdDoc: RenderedDoc = {
      ..._etaVariables,
      markdown: doc.content,
      html: createErrorHtml(type, templateError),
      variableUsage: capturedUsage,
    }
    return renderdDoc
  }

  // Parse markdown/HTML to extract headings after first Eta pass
  const intermediateHtml = isMd ? await marked(processedContent) : processedContent
  const processedHeadings = extractHeadingsFromHtml(intermediateHtml)
  const nestedToc = buildNestedToc(processedHeadings)

  // Create enhanced meta with TOC and headings
  const enhancedMeta = {
    ...meta,
    toc: nestedToc,
    headings: processedHeadings,
  }

  // Check if content references meta.toc or meta.headings - only do second pass if needed
  const needsSecondPass = /meta\.(toc|headings)/.test(processedContent)

  if (needsSecondPass) {
    // Second Eta pass - now with complete meta (toc and headings available)
    const secondRaw = extractRawBlocks(processedContent)
    try {
      processedContent = secondRaw.restore(
        await eta.renderStringAsync(secondRaw.content, {
          ...etaVariables,
          meta: enhancedMeta,
        }),
      )
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : `Unknown ${type} error`
      // Capture usage before spreading to avoid tracking the spread itself
      const capturedUsage = getUsageSnapshot().usage
      // Return error HTML instead of broken content
      const renderdDoc: RenderedDoc = {
        ..._etaVariables,
        meta: enhancedMeta,
        markdown: processedContent,
        html: createErrorHtml(type, errorMsg),
        variableUsage: capturedUsage,
      }
      return renderdDoc
    }
  }

  // Render final HTML (markdown if needed)
  let html = !isMd ? processedContent : `<article>${await marked(processedContent)}</article>`

  // For non-markdown content, inject heading IDs
  if (!isMd) {
    html = injectHeadingIds(html, processedHeadings)
  }

  // Capture usage before spreading to avoid tracking the spread itself
  const capturedUsage = getUsageSnapshot().usage

  const renderDoc: RenderedDoc = {
    ..._etaVariables,
    meta: enhancedMeta,
    markdown: processedContent,
    html,
    variableUsage: capturedUsage,
  }

  return renderDoc
}
