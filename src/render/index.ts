import {baseRender, type VirtualDoc, type RenderedDoc} from './utils/base.ts'
import type {RenderDocument} from '../operations/types.ts'

export type {RenderedDoc}

/**
 * Checks if HTML contains a link to a local stylesheet (./style.css or /style.css)
 */
function hasLocalStylesheet(html: string): boolean {
  return /<link\s+[^>]*rel=["']stylesheet["'][^>]*href=["']([.\/]*style\.css|\/style\.css)["'][^>]*>/i.test(html)
}

/**
 * Checks if HTML contains a local script tag (./script.js or /script.js)
 */
function hasLocalScript(html: string): boolean {
  return /<script\s+[^>]*src=["']([.\/]*script\.js|\/script\.js)["'][^>]*>/i.test(html)
}

/**
 * Injects styles and scripts from slot, content, and template into the final HTML
 * if they weren't already explicitly included by the author.
 */
function injectUnusedAssets(options: {
  template: RenderedDoc
  content: RenderedDoc
  slot?: RenderedDoc
  extension?: string
}): string {
  const {template, content, slot, extension = '.html'} = options

  // Only inject assets for HTML documents
  if (extension !== '.html') {
    return template.html
  }

  let html = template.html

  // Check if author explicitly included their own stylesheet or script
  const hasAuthorStylesheet = hasLocalStylesheet(html)
  const hasAuthorScript = hasLocalScript(html)

  // Collect all styles and scripts that need to be injected
  // Order: template → slot → content (so later styles can override earlier ones via CSS cascade)
  const stylesToInject: string[] = []
  const scriptsToInject: string[] = []

  // Check template assets (first, so they can be overridden)
  const templateStyleUsed = template.variableUsage?.style?.inlineTag || template.variableUsage?.style?.tag

  const templateScriptUsed = template.variableUsage?.script?.inlineTag || template.variableUsage?.script?.tag

  if (!templateStyleUsed && template.style.content && !hasAuthorStylesheet) {
    stylesToInject.push(template.style.inlineTag)
  }

  if (!templateScriptUsed && template.script.content && !hasAuthorScript) {
    scriptsToInject.push(template.script.inlineTag)
  }

  // Check slot assets (second, can override template)
  if (slot) {
    const slotStyleUsed =
      template.variableUsage?.slot?.style?.inlineTag ||
      template.variableUsage?.slot?.style?.tag ||
      content.variableUsage?.slot?.style?.inlineTag ||
      content.variableUsage?.slot?.style?.tag

    const slotScriptUsed =
      template.variableUsage?.slot?.script?.inlineTag ||
      template.variableUsage?.slot?.script?.tag ||
      content.variableUsage?.slot?.script?.inlineTag ||
      content.variableUsage?.slot?.script?.tag

    if (!slotStyleUsed && slot.style.content && !hasAuthorStylesheet) {
      stylesToInject.push(slot.style.inlineTag)
    }

    if (!slotScriptUsed && slot.script.content && !hasAuthorScript) {
      scriptsToInject.push(slot.script.inlineTag)
    }
  }

  // Check content assets (last, can override both template and slot)
  const contentStyleUsed =
    template.variableUsage?.slot?.style?.inlineTag ||
    template.variableUsage?.slot?.style?.tag ||
    content.variableUsage?.style?.inlineTag ||
    content.variableUsage?.style?.tag

  const contentScriptUsed =
    template.variableUsage?.slot?.script?.inlineTag ||
    template.variableUsage?.slot?.script?.tag ||
    content.variableUsage?.script?.inlineTag ||
    content.variableUsage?.script?.tag

  if (!contentStyleUsed && content.style.content && !hasAuthorStylesheet) {
    stylesToInject.push(content.style.inlineTag)
  }

  if (!contentScriptUsed && content.script.content && !hasAuthorScript) {
    scriptsToInject.push(content.script.inlineTag)
  }

  // Inject base tag and styles in <head> or create one
  const headItems: string[] = []

  // Add base tag if no base tag exists
  const hasBaseTag = /<base\s+[^>]*href=/i.test(html)
  if (!hasBaseTag) {
    const basePath = content.path === '/' ? '/' : `${content.path}/`
    headItems.push(`<base href="${basePath}">`)
  }

  // Add styles if needed
  if (stylesToInject.length > 0) {
    headItems.push(...stylesToInject)
  }

  if (headItems.length > 0) {
    const headBlock = headItems.join('\n')
    const headMatch = html.match(/<head[^>]*>/i)

    if (headMatch) {
      // Inject into existing head
      const headEndIndex = headMatch.index! + headMatch[0].length
      html = html.slice(0, headEndIndex) + '\n' + headBlock + '\n' + html.slice(headEndIndex)
    } else {
      // Check for body tag to insert head before it
      const bodyMatch = html.match(/<body[^>]*>/i)
      if (bodyMatch) {
        html = html.slice(0, bodyMatch.index!) + '<head>\n' + headBlock + '\n</head>\n' + html.slice(bodyMatch.index!)
      } else {
        // Check for html tag to insert head after it
        const htmlMatch = html.match(/<html[^>]*>/i)
        if (htmlMatch) {
          const htmlEndIndex = htmlMatch.index! + htmlMatch[0].length
          html = html.slice(0, htmlEndIndex) + '\n<head>\n' + headBlock + '\n</head>\n' + html.slice(htmlEndIndex)
        } else {
          // No structural tags, prepend head items
          html = headBlock + '\n' + html
        }
      }
    }
  }

  // Inject scripts before </body> or </html> or at the end
  if (scriptsToInject.length > 0) {
    const scriptBlock = scriptsToInject.join('\n')
    const bodyCloseMatch = html.match(/<\/body>/i)

    if (bodyCloseMatch) {
      // Inject before closing body tag
      html = html.slice(0, bodyCloseMatch.index!) + scriptBlock + '\n' + html.slice(bodyCloseMatch.index!)
    } else {
      // Check for closing html tag
      const htmlCloseMatch = html.match(/<\/html>/i)
      if (htmlCloseMatch) {
        html = html.slice(0, htmlCloseMatch.index!) + scriptBlock + '\n' + html.slice(htmlCloseMatch.index!)
      } else {
        // No structural tags, append scripts
        html = html + '\n' + scriptBlock
      }
    }
  }

  return html
}

/**
 * Injects styles and scripts from slot and content when there's no template.
 */
function injectUnusedAssetsInContent(options: {content: RenderedDoc; slot?: RenderedDoc; extension?: string}): string {
  const {content, slot, extension = '.html'} = options

  // Only inject assets for HTML documents
  if (extension !== '.html') {
    return content.html
  }

  let html = content.html

  // Check if author explicitly included their own stylesheet or script
  const hasAuthorStylesheet = hasLocalStylesheet(html)
  const hasAuthorScript = hasLocalScript(html)

  // Collect all styles and scripts that need to be injected
  const stylesToInject: string[] = []
  const scriptsToInject: string[] = []

  // Check slot assets
  if (slot) {
    const slotStyleUsed = content.variableUsage?.slot?.style?.inlineTag || content.variableUsage?.slot?.style?.tag

    const slotScriptUsed = content.variableUsage?.slot?.script?.inlineTag || content.variableUsage?.slot?.script?.tag

    if (!slotStyleUsed && slot.style.content && !hasAuthorStylesheet) {
      stylesToInject.push(slot.style.inlineTag)
    }

    if (!slotScriptUsed && slot.script.content && !hasAuthorScript) {
      scriptsToInject.push(slot.script.inlineTag)
    }
  }

  // Check content assets
  const contentStyleUsed = content.variableUsage?.style?.inlineTag || content.variableUsage?.style?.tag

  const contentScriptUsed = content.variableUsage?.script?.inlineTag || content.variableUsage?.script?.tag

  if (!contentStyleUsed && content.style.content && !hasAuthorStylesheet) {
    stylesToInject.push(content.style.inlineTag)
  }

  if (!contentScriptUsed && content.script.content && !hasAuthorScript) {
    scriptsToInject.push(content.script.inlineTag)
  }

  // Inject base tag and styles in <head> or create one
  const headItems: string[] = []

  // Add base tag if no base tag exists
  const hasBaseTag = /<base\s+[^>]*href=/i.test(html)
  if (!hasBaseTag) {
    const basePath = content.path === '/' ? '/' : `${content.path}/`
    headItems.push(`<base href="${basePath}">`)
  }

  // Add styles if needed
  if (stylesToInject.length > 0) {
    headItems.push(...stylesToInject)
  }

  if (headItems.length > 0) {
    const headBlock = headItems.join('\n')
    const headMatch = html.match(/<head[^>]*>/i)

    if (headMatch) {
      // Inject into existing head
      const headEndIndex = headMatch.index! + headMatch[0].length
      html = html.slice(0, headEndIndex) + '\n' + headBlock + '\n' + html.slice(headEndIndex)
    } else {
      // Check for body tag to insert head before it
      const bodyMatch = html.match(/<body[^>]*>/i)
      if (bodyMatch) {
        html = html.slice(0, bodyMatch.index!) + '<head>\n' + headBlock + '\n</head>\n' + html.slice(bodyMatch.index!)
      } else {
        // Check for html tag to insert head after it
        const htmlMatch = html.match(/<html[^>]*>/i)
        if (htmlMatch) {
          const htmlEndIndex = htmlMatch.index! + htmlMatch[0].length
          html = html.slice(0, htmlEndIndex) + '\n<head>\n' + headBlock + '\n</head>\n' + html.slice(htmlEndIndex)
        } else {
          // No structural tags, prepend head items
          html = headBlock + '\n' + html
        }
      }
    }
  }

  // Inject scripts before </body> or </html> or at the end
  if (scriptsToInject.length > 0) {
    const scriptBlock = scriptsToInject.join('\n')
    const bodyCloseMatch = html.match(/<\/body>/i)

    if (bodyCloseMatch) {
      html = html.slice(0, bodyCloseMatch.index!) + scriptBlock + '\n' + html.slice(bodyCloseMatch.index!)
    } else {
      const htmlCloseMatch = html.match(/<\/html>/i)
      if (htmlCloseMatch) {
        html = html.slice(0, htmlCloseMatch.index!) + scriptBlock + '\n' + html.slice(htmlCloseMatch.index!)
      } else {
        html = html + '\n' + scriptBlock
      }
    }
  }

  return html
}

/**
 * Unified render function that handles both inner rendering (content + slot)
 * and outer rendering (content + slot + template).
 *
 * When includeTemplate is false, renders content with optional slot (inner render).
 * When includeTemplate is true, renders content with optional slot and wraps in template (outer render).
 */
async function virtualRender(options: {
  content: VirtualDoc
  slot?: VirtualDoc
  template?: VirtualDoc
  includeTemplate?: boolean
  context?: Record<string, unknown>
}): Promise<RenderedDoc> {
  const {content: contentDocument, slot: slotDocument, template: templateDocument, includeTemplate, context} = options

  // Render slot if provided
  const slot = slotDocument
    ? await baseRender({
        doc: slotDocument,
        context,
        type: 'slot',
      })
    : undefined

  // Render content with slot in context
  const content = await baseRender({
    doc: contentDocument,
    context: {...context, slot},
    type: 'content',
  })

  // If not including template, inject assets into content and return
  if (!includeTemplate || !templateDocument) {
    const injectedHtml = injectUnusedAssetsInContent({
      content,
      slot,
      extension: contentDocument.extension,
    })
    return {
      ...content,
      html: injectedHtml,
    }
  }

  // Render template with content as slot
  const template = await baseRender({
    doc: templateDocument,
    context: {...context, slot: content},
    type: 'template',
  })

  // Inject styles and scripts that weren't explicitly used by the author
  const injectedHtml = injectUnusedAssets({
    template,
    content,
    slot,
    extension: contentDocument.extension,
  })

  return {
    ...template,
    markdown: content.markdown,
    html: injectedHtml,
  }
}

/**
 * Converts a RenderDocument to a VirtualDoc for rendering
 */
function toVirtualDoc(doc: RenderDocument): VirtualDoc {
  let data: Record<string, unknown> = {}

  try {
    data = doc.data ? (JSON.parse(doc.data) as Record<string, unknown>) : {}
  } catch {
    data = {}
  }

  return {
    title: doc.title,
    path: doc.path,
    createdAt: doc.created_at,
    updatedAt: doc.updated_at,
    content: doc.content,
    data,
    style: doc.style,
    script: doc.script,
    server: doc.server,
    extension: doc.extension,
  }
}

/**
 * Core render function that doesn't use the database.
 * Takes a document and optional slot/template documents.
 */
export async function render(document: RenderDocument, context?: Record<string, unknown>): Promise<RenderedDoc> {
  // Convert to VirtualDoc for rendering
  const content = toVirtualDoc(document)

  // Convert slot if provided
  const slot = document.slot ? toVirtualDoc(document.slot) : undefined

  // Convert template if provided
  const template = document.template ? toVirtualDoc(document.template) : undefined

  // Render the document
  return await virtualRender({
    content,
    slot,
    template,
    includeTemplate: true,
    context: context,
  })
}

// export function renderThunk (document: RenderDocument) {
//   let cachedResult: RenderedDoc | null = null

//   const getRendered = async () => {
//     if (!cachedResult) {
//       cachedResult = await render(document)
//     }
//     return cachedResult
//   }

//   return {
//     html: async () => {
//       const result = await getRendered()
//       return result.html
//     },
//     markdown: async () => {
//       const result = await getRendered()
//       return result.markdown
//     }
//   }
// }
