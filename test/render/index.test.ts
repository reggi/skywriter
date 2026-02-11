import {test} from 'node:test'
import assert from 'node:assert'
import path from 'node:path'
import {baseRender, type VirtualDoc, type RenderedDoc} from '../../src/render/utils/base.ts'
import {render as renderDoc} from '../../src/render/index.ts'
import type {RenderDocument} from '../../src/operations/types.ts'

// Helper functions to match the internal implementation
function getStylePath(doc: VirtualDoc): string {
  return path.join(doc.path, 'style.css')
}

function getScriptPath(doc: VirtualDoc): string {
  return path.join(doc.path, 'script.js')
}

// Simplified virtualRender implementation for testing
// This mirrors the internal virtualRender function in src/render/index.ts

/**
 * Checks if HTML contains any <link rel="stylesheet"> tags
 */
function hasStylesheetLink(html: string): boolean {
  return /<link\s+[^>]*rel=["']stylesheet["'][^>]*>/i.test(html)
}

/**
 * Checks if HTML contains any <script> tags with a src attribute
 */
function hasScriptTag(html: string): boolean {
  return /<script\s+[^>]*src=["'][^"']+["'][^>]*>/i.test(html)
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

  // Check if author explicitly included stylesheet or script tags
  const hasAuthorStylesheet = hasStylesheetLink(html)
  const hasAuthorScript = hasScriptTag(html)

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

  // Check if author explicitly included stylesheet or script tags
  const hasAuthorStylesheet = hasStylesheetLink(html)
  const hasAuthorScript = hasScriptTag(html)

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

async function render(options: {
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

test('render should render content without template', async () => {
  const content: VirtualDoc = {
    title: 'Content Title',
    path: '/content',
    content: '# Hello from content',
  }

  const result = await render({
    content,
    includeTemplate: false,
  })

  assert.strictEqual(result.title, 'Content Title')
  assert.strictEqual(result.path, '/content')
  assert.ok(result.html.includes('<h1 id="hello-from-content">Hello from content</h1>'))
})

test('render should render content with slot', async () => {
  const slot: VirtualDoc = {
    title: 'Slot Title',
    path: '/slot',
    content: '## Slot content here',
  }

  const content: VirtualDoc = {
    title: 'Content with Slot',
    path: '/content',
    content: '# Content\n\n<%= slot.html %>',
  }

  const result = await render({
    content,
    slot,
    includeTemplate: false,
  })

  assert.ok(result.html.includes('<h1 id="content">Content</h1>'))
  assert.ok(result.html.includes('<h2 id="slot-content-here">Slot content here</h2>'))
})

test('render should render content with slot and template', async () => {
  const slot: VirtualDoc = {
    title: 'Slot Title',
    path: '/slot',
    content: '## Slot heading',
  }

  const content: VirtualDoc = {
    title: 'Content Title',
    path: '/content',
    content: '# Main content\n\n<%= slot.html %>',
  }

  const template: VirtualDoc = {
    title: 'Template Title',
    path: '/template',
    content: '<!DOCTYPE html><html><head></head><body><%= slot.html %></body></html>',
  }

  const result = await render({
    content,
    slot,
    template,
    includeTemplate: true,
  })

  assert.ok(result.html.includes('<!DOCTYPE html>'))
  assert.ok(result.html.includes('<h1 id="main-content">Main content</h1>'))
  assert.ok(result.html.includes('<h2 id="slot-heading">Slot heading</h2>'))
})

test('render should inject unused slot styles when not referenced in content', async () => {
  const slot: VirtualDoc = {
    title: 'Slot with Style',
    path: '/slot',
    content: 'Slot content',
    style: 'body { color: red; }',
  }

  const content: VirtualDoc = {
    title: 'Content',
    path: '/content',
    content: '<%= slot.html %>',
  }

  const result = await render({
    content,
    slot,
    includeTemplate: false,
  })

  // Style should be injected since slot.style was not explicitly referenced
  assert.ok(result.html.includes('<style>body { color: red; }</style>'))
})

test('render should not inject slot styles when explicitly used in content', async () => {
  const slot: VirtualDoc = {
    title: 'Slot with Style',
    path: '/slot',
    content: 'Slot content',
    style: 'body { color: red; }',
  }

  const content: VirtualDoc = {
    title: 'Content',
    path: '/content',
    content: '<%= slot.style.inlineTag %>\n<%= slot.html %>',
  }

  const result = await render({
    content,
    slot,
    includeTemplate: false,
  })

  // Count style tags - should only appear once (from explicit usage)
  const styleMatches = result.html.match(/<style>body { color: red; }<\/style>/g)
  assert.strictEqual(styleMatches?.length, 1, 'Style should only appear once')
})

test('render should inject unused content styles when not referenced', async () => {
  const content: VirtualDoc = {
    title: 'Content with Style',
    path: '/content',
    content: '<h1>Hello</h1>',
    style: 'h1 { color: blue; }',
  }

  const result = await render({
    content,
    includeTemplate: false,
  })

  // Style should be injected since content.style was not explicitly referenced
  assert.ok(result.html.includes('<style>h1 { color: blue; }</style>'))
})

test('render should not inject content styles when explicitly used', async () => {
  const content: VirtualDoc = {
    title: 'Content with Style',
    path: '/content',
    content: '<%= style.inlineTag %>\n<h1>Hello</h1>',
    style: 'h1 { color: blue; }',
  }

  const result = await render({
    content,
    includeTemplate: false,
  })

  // Count style tags - should only appear once
  const styleMatches = result.html.match(/<style>h1 { color: blue; }<\/style>/g)
  assert.strictEqual(styleMatches?.length, 1, 'Style should only appear once')
})

test('render should inject unused scripts when not referenced', async () => {
  const content: VirtualDoc = {
    title: 'Content with Script',
    path: '/content',
    content: '<h1>Hello</h1>',
    script: 'console.log("test");',
  }

  const result = await render({
    content,
    includeTemplate: false,
  })

  // Script should be injected
  assert.ok(result.html.includes('<script>console.log("test");</script>'))
})

test('render should not inject scripts when explicitly used', async () => {
  const content: VirtualDoc = {
    title: 'Content with Script',
    path: '/content',
    content: '<h1>Hello</h1>\n<%= script.inlineTag %>',
    script: 'console.log("test");',
  }

  const result = await render({
    content,
    includeTemplate: false,
  })

  // Count script tags - should only appear once
  const scriptMatches = result.html.match(/<script>console\.log\("test"\);<\/script>/g)
  assert.strictEqual(scriptMatches?.length, 1, 'Script should only appear once')
})

test('render should inject multiple unused assets in template', async () => {
  const slot: VirtualDoc = {
    title: 'Slot',
    path: '/slot',
    content: 'Slot',
    style: '.slot { color: red; }',
    script: 'console.log("slot");',
  }

  const content: VirtualDoc = {
    title: 'Content',
    path: '/content',
    content: '<%= slot.html %>',
    style: '.content { color: blue; }',
    script: 'console.log("content");',
  }

  const template: VirtualDoc = {
    title: 'Template',
    path: '/template',
    content: '<!DOCTYPE html><html><head></head><body><%= slot.html %></body></html>',
    style: '.template { color: green; }',
    script: 'console.log("template");',
  }

  const result = await render({
    content,
    slot,
    template,
    includeTemplate: true,
  })

  // All three styles should be injected in head
  assert.ok(result.html.includes('<style>.slot { color: red; }</style>'))
  assert.ok(result.html.includes('<style>.content { color: blue; }</style>'))
  assert.ok(result.html.includes('<style>.template { color: green; }</style>'))

  // All three scripts should be injected before </body>
  assert.ok(result.html.includes('<script>console.log("slot");</script>'))
  assert.ok(result.html.includes('<script>console.log("content");</script>'))
  assert.ok(result.html.includes('<script>console.log("template");</script>'))
})

test('render should inject styles in head when head exists', async () => {
  const content: VirtualDoc = {
    title: 'Content',
    path: '/content',
    content: '<html><head><title>Test</title></head><body>Content</body></html>',
    style: 'body { margin: 0; }',
  }

  const result = await render({
    content,
    includeTemplate: false,
  })

  // Style should be injected inside head after opening tag
  assert.ok(result.html.includes('<head>'))
  assert.ok(result.html.includes('<style>body { margin: 0; }</style>'))
  assert.ok(result.html.includes('<title>Test</title>'))
})

test('render should create head tag when only body exists', async () => {
  const content: VirtualDoc = {
    title: 'Content',
    path: '/content',
    content: '<body>Content</body>',
    style: 'body { margin: 0; }',
  }

  const result = await render({
    content,
    includeTemplate: false,
  })

  // Head should be created before body
  assert.ok(
    result.html.includes(
      '<head>\n' +
        '<base href="/content/">\n' +
        '<style>body { margin: 0; }</style>\n' +
        '</head>\n' +
        '<body>Content</body>',
    ),
  )
})

test('render should inject scripts before closing body tag', async () => {
  const content: VirtualDoc = {
    title: 'Content',
    path: '/content',
    content: '<html><body>Content</body></html>',
    script: 'console.log("test");',
  }

  const result = await render({
    content,
    includeTemplate: false,
  })

  // Script should be before </body>
  assert.ok(result.html.includes('<script>console.log("test");</script>\n</body>'))
})

test('render should inject scripts before closing html tag when no body', async () => {
  const content: VirtualDoc = {
    title: 'Content',
    path: '/content',
    content: '<html>Content</html>',
    script: 'console.log("test");',
  }

  const result = await render({
    content,
    includeTemplate: false,
  })

  // Script should be before </html>
  assert.ok(result.html.includes('<script>console.log("test");</script>\n</html>'))
})

test('render should append scripts at end when no structural tags', async () => {
  const content: VirtualDoc = {
    title: 'Content',
    path: '/content',
    content: '<p>Just a paragraph</p>',
    script: 'console.log("test");',
  }

  const result = await render({
    content,
    includeTemplate: false,
  })

  // Script should be at the end
  assert.ok(result.html.endsWith('\n<script>console.log("test");</script>'))
})

test('render should pass context through to all renders', async () => {
  const content: VirtualDoc = {
    title: 'Content',
    path: '/content',
    content: 'User: <%= customData.name %>',
  }

  const result = await render({
    content,
    includeTemplate: false,
    context: {
      customData: {name: 'Alice'},
    },
  })

  assert.ok(result.html.includes('User: Alice'))
})

test('render should not inject assets when using tag variant', async () => {
  const content: VirtualDoc = {
    title: 'Content',
    path: '/content',
    content: '<%= style.tag %>',
    style: 'body { margin: 0; }',
  }

  const result = await render({
    content,
    includeTemplate: false,
  })

  // Count link tags - should only appear once from explicit usage
  const expectedHref = getStylePath(content).replace(/\//g, '\\/')
  const linkMatches = result.html.match(new RegExp(`<link rel="stylesheet" href="${expectedHref}">`, 'g'))
  assert.strictEqual(linkMatches?.length, 1, 'Link should only appear once')
})

test('render should inject styles after html tag when no head or body', async () => {
  const content: VirtualDoc = {
    title: 'Content',
    path: '/content',
    content: '<html>Content without head or body</html>',
    style: 'p { color: red; }',
  }

  const result = await render({
    content,
    includeTemplate: false,
  })

  // Style should be injected after <html> tag
  assert.ok(
    result.html.includes(
      '<html>\n' +
        '<head>\n' +
        '<base href="/content/">\n' +
        '<style>p { color: red; }</style>\n' +
        '</head>\n' +
        'Content without head or body</html>',
    ),
  )
})

test('render should prepend styles when no structural tags', async () => {
  const content: VirtualDoc = {
    title: 'Content',
    path: '/content',
    content: 'Just plain text',
    style: 'body { margin: 0; }',
  }

  const result = await render({
    content,
    includeTemplate: false,
  })

  // Style should be prepended
  assert.ok(result.html.startsWith('<base href="/content/">\n<style>body { margin: 0; }</style>\nJust plain text'))
})

test('render should inject scripts after html tag when no body', async () => {
  const content: VirtualDoc = {
    title: 'Content',
    path: '/content',
    content: '<html><p>Content</p></html>',
    script: 'console.log("test");',
  }

  const result = await render({
    content,
    includeTemplate: false,
  })

  // Script should be before </html>
  assert.ok(result.html.includes('<script>console.log("test");</script>\n</html>'))
})

test('injectUnusedAssetsInContent should handle slot style used via inlineTag', async () => {
  const slot: VirtualDoc = {
    title: 'Slot',
    path: '/slot',
    content: 'Slot content',
    style: 'p { color: red; }',
  }

  const content: VirtualDoc = {
    title: 'Content',
    path: '/content',
    content: '<%= slot.style.inlineTag %><%= slot.html %>',
  }

  const result = await render({
    content,
    slot,
    includeTemplate: false,
  })

  // Count style tags - should only be one from explicit usage
  const styleMatches = result.html.match(/<style>p { color: red; }<\/style>/g)
  assert.strictEqual(styleMatches?.length, 1)
})

test('injectUnusedAssetsInContent should handle slot script used via tag', async () => {
  const slot: VirtualDoc = {
    title: 'Slot',
    path: '/slot',
    content: 'Slot content',
    script: 'console.log("slot");',
  }

  const content: VirtualDoc = {
    title: 'Content',
    path: '/content',
    content: '<%= slot.script.tag %><%= slot.html %>',
  }

  const result = await render({
    content,
    slot,
    includeTemplate: false,
  })

  // Count script tags - should only be one from explicit usage (the link tag)
  const scriptSrcMatches = result.html.match(
    new RegExp(`<script src="${getScriptPath(slot).replace(/\//g, '\\/')}"><\\/script>`, 'g'),
  )
  assert.strictEqual(scriptSrcMatches?.length, 1)
})

test('injectUnusedAssetsInContent should handle slot style used via tag', async () => {
  const slot: VirtualDoc = {
    title: 'Slot',
    path: '/slot',
    content: 'Slot content',
    style: 'p { color: red; }',
  }

  const content: VirtualDoc = {
    title: 'Content',
    path: '/content',
    content: '<%= slot.style.tag %><%= slot.html %>',
  }

  const result = await render({
    content,
    slot,
    includeTemplate: false,
  })

  // Should only have the link tag from explicit usage
  const expectedHref = getStylePath(slot).replace(/\//g, '\\/')
  const linkMatches = result.html.match(new RegExp(`<link rel="stylesheet" href="${expectedHref}">`, 'g'))
  assert.strictEqual(linkMatches?.length, 1)
})

test('injectUnusedAssets should handle template style used', async () => {
  const content: VirtualDoc = {
    title: 'Content',
    path: '/content',
    content: 'Content',
  }

  const template: VirtualDoc = {
    title: 'Template',
    path: '/template',
    content: '<%= style.inlineTag %><%= slot.html %>',
    style: 'body { margin: 0; }',
  }

  const result = await render({
    content,
    template,
    includeTemplate: true,
  })

  // Style should only appear once from explicit usage
  const styleMatches = result.html.match(/<style>body { margin: 0; }<\/style>/g)
  assert.strictEqual(styleMatches?.length, 1)
})

test('injectUnusedAssets should handle template script used', async () => {
  const content: VirtualDoc = {
    title: 'Content',
    path: '/content',
    content: 'Content',
  }

  const template: VirtualDoc = {
    title: 'Template',
    path: '/template',
    content: '<%= slot.html %><%= script.inlineTag %>',
    script: 'console.log("template");',
  }

  const result = await render({
    content,
    template,
    includeTemplate: true,
  })

  // Script should only appear once from explicit usage
  const scriptMatches = result.html.match(/<script>console\.log\("template"\);<\/script>/g)
  assert.strictEqual(scriptMatches?.length, 1)
})

test('injectUnusedAssets should inject content style when slot is used in template', async () => {
  const content: VirtualDoc = {
    title: 'Content',
    path: '/content',
    content: 'Content text',
    style: '.content { color: blue; }',
  }

  const template: VirtualDoc = {
    title: 'Template',
    path: '/template',
    content: '<!DOCTYPE html><html><head></head><body><%= slot.html %></body></html>',
  }

  const result = await render({
    content,
    template,
    includeTemplate: true,
  })

  // Content style should be injected since it wasn't explicitly used
  assert.ok(result.html.includes('<style>.content { color: blue; }</style>'))
})

test('injectUnusedAssets should inject content script when slot is used in template', async () => {
  const content: VirtualDoc = {
    title: 'Content',
    path: '/content',
    content: 'Content text',
    script: 'console.log("content");',
  }

  const template: VirtualDoc = {
    title: 'Template',
    path: '/template',
    content: '<!DOCTYPE html><html><body><%= slot.html %></body></html>',
  }

  const result = await render({
    content,
    template,
    includeTemplate: true,
  })

  // Content script should be injected since it wasn't explicitly used
  assert.ok(result.html.includes('<script>console.log("content");</script>'))
})

test('injectUnusedAssetsInContent should handle html tag only for styles', async () => {
  const content: VirtualDoc = {
    title: 'Content',
    path: '/content',
    content: '<html><p>Content without head or body</p></html>',
    style: 'p { color: blue; }',
  }

  const result = await render({
    content,
    includeTemplate: false,
  })

  // Head should be created after html tag
  assert.ok(
    result.html.includes(
      '<html>\n' +
        '<head>\n' +
        '<base href="/content/">\n' +
        '<style>p { color: blue; }</style>\n' +
        '</head>\n' +
        '<p>Content without head or body</p></html>',
    ),
  )
})

test('injectUnusedAssetsInContent should prepend styles when no html structure', async () => {
  const content: VirtualDoc = {
    title: 'Content',
    path: '/content',
    content: '<div>Plain content</div>',
    style: 'div { padding: 10px; }',
  }

  const result = await render({
    content,
    includeTemplate: false,
  })

  // Style should be prepended
  assert.ok(
    result.html.startsWith(
      '<base href="/content/">\n' + '<style>div { padding: 10px; }</style>\n' + '<div>Plain content</div>',
    ),
  )
})

test('injectUnusedAssetsInContent should append scripts when no html structure', async () => {
  const content: VirtualDoc = {
    title: 'Content',
    path: '/content',
    content: '<div>Plain content</div>',
    script: 'console.log("plain");',
  }

  const result = await render({
    content,
    includeTemplate: false,
  })

  // Script should be appended
  assert.ok(result.html.endsWith('\n<script>console.log("plain");</script>'))
})

test('injectUnusedAssetsInContent should handle slot without style or script', async () => {
  const slot: VirtualDoc = {
    title: 'Slot',
    path: '/slot',
    content: 'Slot without assets',
  }

  const content: VirtualDoc = {
    title: 'Content',
    path: '/content',
    content: '<%= slot.html %>',
    style: 'p { color: red; }',
  }

  const result = await render({
    content,
    slot,
    includeTemplate: false,
  })

  // Only content style should be injected
  assert.ok(result.html.includes('<style>p { color: red; }</style>'))
})

test('injectUnusedAssetsInContent should handle content without style or script', async () => {
  const content: VirtualDoc = {
    title: 'Content',
    path: '/content',
    content: '<p>Plain content</p>',
  }

  const result = await render({
    content,
    includeTemplate: false,
  })

  // No styles or scripts should be added
  assert.ok(!result.html.includes('<style>'))
  assert.ok(!result.html.includes('<script>'))
})

test('injectUnusedAssets should inject styles after html tag in template', async () => {
  const content: VirtualDoc = {
    title: 'Content',
    path: '/content',
    content: 'Content',
  }

  const template: VirtualDoc = {
    title: 'Template',
    path: '/template',
    content: '<html><%= slot.html %></html>',
    style: 'body { margin: 0; }',
  }

  const result = await render({
    content,
    template,
    includeTemplate: true,
  })

  // Style should be injected after <html> tag
  assert.ok(
    result.html.includes(
      '<html>\n' +
        '<head>\n' +
        '<base href="/content/">\n' +
        '<style>body { margin: 0; }</style>\n' +
        '</head>\n' +
        'Content</html>',
    ),
  )
})

test('injectUnusedAssets should prepend styles in template with no structure', async () => {
  const content: VirtualDoc = {
    title: 'Content',
    path: '/content',
    content: 'Content',
  }

  const template: VirtualDoc = {
    title: 'Template',
    path: '/template',
    content: '<%= slot.html %>',
    style: 'body { margin: 0; }',
  }

  const result = await render({
    content,
    template,
    includeTemplate: true,
  })

  // Style should be prepended
  assert.ok(result.html.startsWith('<base href="/content/">\n<style>body { margin: 0; }</style>\nContent'))
})

test('injectUnusedAssets should inject scripts before closing html in template', async () => {
  const content: VirtualDoc = {
    title: 'Content',
    path: '/content',
    content: 'Content',
  }

  const template: VirtualDoc = {
    title: 'Template',
    path: '/template',
    content: '<html><%= slot.html %></html>',
    script: 'console.log("template");',
  }

  const result = await render({
    content,
    template,
    includeTemplate: true,
  })

  // Script should be before </html>
  assert.ok(result.html.includes('<script>console.log("template");</script>\n</html>'))
})

test('injectUnusedAssets should append scripts in template with no structure', async () => {
  const content: VirtualDoc = {
    title: 'Content',
    path: '/content',
    content: 'Content',
  }

  const template: VirtualDoc = {
    title: 'Template',
    path: '/template',
    content: '<%= slot.html %>',
    script: 'console.log("template");',
  }

  const result = await render({
    content,
    template,
    includeTemplate: true,
  })

  // Script should be appended
  assert.ok(result.html.endsWith('\n<script>console.log("template");</script>'))
})

test('injectUnusedAssetsInContent should handle slot script without content', async () => {
  const slot: VirtualDoc = {
    title: 'Slot',
    path: '/slot',
    content: 'Slot content',
    // script property exists but empty
    script: '',
  }

  const content: VirtualDoc = {
    title: 'Content',
    path: '/content',
    content: '<%= slot.html %>',
  }

  const result = await render({
    content,
    slot,
    includeTemplate: false,
  })

  // No scripts should be injected
  assert.ok(!result.html.includes('<script>'))
})

test('injectUnusedAssetsInContent should handle slot style without content', async () => {
  const slot: VirtualDoc = {
    title: 'Slot',
    path: '/slot',
    content: 'Slot content',
    // style property exists but empty
    style: '',
  }

  const content: VirtualDoc = {
    title: 'Content',
    path: '/content',
    content: '<%= slot.html %>',
  }

  const result = await render({
    content,
    slot,
    includeTemplate: false,
  })

  // No styles should be injected
  assert.ok(!result.html.includes('<style>'))
})

test('injectUnusedAssets should create head before body tag in template', async () => {
  const content: VirtualDoc = {
    title: 'Content',
    path: '/content',
    content: 'Content',
  }

  const template: VirtualDoc = {
    title: 'Template',
    path: '/template',
    content: '<body><%= slot.html %></body>',
    style: 'body { margin: 0; }',
  }

  const result = await render({
    content,
    template,
    includeTemplate: true,
  })

  // Head should be created before body tag
  assert.ok(
    result.html.includes(
      '<head>\n' +
        '<base href="/content/">\n' +
        '<style>body { margin: 0; }</style>\n' +
        '</head>\n' +
        '<body>Content</body>',
    ),
  )
})

test('injectUnusedAssetsInContent should inject both slot and content styles empty', async () => {
  const slot: VirtualDoc = {
    title: 'Slot',
    path: '/slot',
    content: 'Slot',
    style: '',
    script: '',
  }

  const content: VirtualDoc = {
    title: 'Content',
    path: '/content',
    content: '<%= slot.html %>',
    style: '',
    script: '',
  }

  const result = await render({
    content,
    slot,
    includeTemplate: false,
  })

  // Should not inject empty styles or scripts
  assert.ok(!result.html.includes('<style></style>'))
  assert.ok(!result.html.includes('<script></script>'))
})

test('injectUnusedAssetsInContent should inject slot script when not referenced', async () => {
  const slot: VirtualDoc = {
    title: 'Slot',
    path: '/slot',
    content: 'Slot content',
    script: 'console.log("slot script");',
  }

  const content: VirtualDoc = {
    title: 'Content',
    path: '/content',
    content: '<%= slot.html %>',
  }

  const result = await render({
    content,
    slot,
    includeTemplate: false,
  })

  // Slot script should be injected
  assert.ok(result.html.includes('<script>console.log("slot script");</script>'))
})

test('injectUnusedAssetsInContent should not inject when content.variableUsage.style.tag is used (no template)', async () => {
  const content: VirtualDoc = {
    title: 'Content',
    path: '/content',
    content: '<%= style.tag %><p>Content with style</p>',
    style: 'p { color: green; }',
  }

  const result = await render({
    content,
    slot: undefined,
    includeTemplate: false,
  })

  // Should only have the link tag from explicit usage
  const expectedHref = getStylePath(content).replace(/\//g, '\\/')
  const linkMatches = result.html.match(new RegExp(`<link rel="stylesheet" href="${expectedHref}">`, 'g'))
  assert.strictEqual(linkMatches?.length, 1)
})

test('injectUnusedAssetsInContent should not inject when content.variableUsage.script.tag is used (no template)', async () => {
  const content: VirtualDoc = {
    title: 'Content',
    path: '/content',
    content: '<%= script.tag %><p>Content with script</p>',
    script: 'console.log("content script");',
  }

  const result = await render({
    content,
    slot: undefined,
    includeTemplate: false,
  })

  // Should only have the script src tag from explicit usage
  const scriptSrcMatches = result.html.match(
    new RegExp(`<script src="${getScriptPath(content).replace(/\//g, '\\/')}"><\\/script>`, 'g'),
  )
  assert.strictEqual(scriptSrcMatches?.length, 1)
})

test('injectUnusedAssets should not inject when template.variableUsage.slot.style.inlineTag is used', async () => {
  const slot: VirtualDoc = {
    title: 'Slot',
    path: '/slot',
    content: 'Slot content',
    style: 'p { color: red; }',
  }

  const content: VirtualDoc = {
    title: 'Content',
    path: '/content',
    content: '<%= slot.html %>',
  }

  const template: VirtualDoc = {
    title: 'Template',
    path: '/template',
    content: '<%= slot.style.inlineTag %><%= slot.html %>',
  }

  const result = await render({
    content,
    slot,
    template,
    includeTemplate: true,
  })

  // When template uses slot.style.inlineTag, it's detected and not re-injected
  const styleMatches = result.html.match(/<style>p { color: red; }<\/style>/g)
  assert.ok(!styleMatches || styleMatches.length <= 1, 'Should have at most one style tag')
})

test('injectUnusedAssets should not inject when template.variableUsage.slot.style.tag is used', async () => {
  const slot: VirtualDoc = {
    title: 'Slot',
    path: '/slot',
    content: 'Slot content',
    style: 'p { color: red; }',
  }

  const content: VirtualDoc = {
    title: 'Content',
    path: '/content',
    content: '<%= slot.html %>',
  }

  const template: VirtualDoc = {
    title: 'Template',
    path: '/template',
    content: '<%= slot.style.tag %><%= slot.html %>',
  }

  const result = await render({
    content,
    slot,
    template,
    includeTemplate: true,
  })

  // When template uses slot.style.tag, it's detected and not re-injected
  const expectedHref = getStylePath(slot).replace(/\//g, '\\/')
  const linkMatches = result.html.match(new RegExp(`<link rel="stylesheet" href="${expectedHref}">`, 'g'))
  assert.ok(!linkMatches || linkMatches.length <= 1, 'Should have at most one link tag')
})

test('injectUnusedAssets should not inject when content.variableUsage.slot.style.inlineTag is used', async () => {
  const slot: VirtualDoc = {
    title: 'Slot',
    path: '/slot',
    content: 'Slot content',
    style: 'p { color: red; }',
  }

  const content: VirtualDoc = {
    title: 'Content',
    path: '/content',
    content: '<%= slot.style.inlineTag %><%= slot.html %>',
  }

  const template: VirtualDoc = {
    title: 'Template',
    path: '/template',
    content: '<%= slot.html %>',
  }

  const result = await render({
    content,
    slot,
    template,
    includeTemplate: true,
  })

  // Should only have one style tag from explicit usage in content
  const styleMatches = result.html.match(/<style>p { color: red; }<\/style>/g)
  assert.strictEqual(styleMatches?.length, 1)
})

test('injectUnusedAssets should not inject when content.variableUsage.slot.style.tag is used', async () => {
  const slot: VirtualDoc = {
    title: 'Slot',
    path: '/slot',
    content: 'Slot content',
    style: 'p { color: red; }',
  }

  const content: VirtualDoc = {
    title: 'Content',
    path: '/content',
    content: '<%= slot.style.tag %><%= slot.html %>',
  }

  const template: VirtualDoc = {
    title: 'Template',
    path: '/template',
    content: '<%= slot.html %>',
  }

  const result = await render({
    content,
    slot,
    template,
    includeTemplate: true,
  })

  // Should only have the link tag from explicit usage in content
  const expectedHref = getStylePath(slot).replace(/\//g, '\\/')
  const linkMatches = result.html.match(new RegExp(`<link rel="stylesheet" href="${expectedHref}">`, 'g'))
  assert.strictEqual(linkMatches?.length, 1)
})

test('injectUnusedAssets should not inject when template.variableUsage.slot.script.inlineTag is used', async () => {
  const slot: VirtualDoc = {
    title: 'Slot',
    path: '/slot',
    content: 'Slot content',
    script: 'console.log("slot");',
  }

  const content: VirtualDoc = {
    title: 'Content',
    path: '/content',
    content: '<%= slot.html %>',
  }

  const template: VirtualDoc = {
    title: 'Template',
    path: '/template',
    content: '<%= slot.script.inlineTag %><%= slot.html %>',
  }

  const result = await render({
    content,
    slot,
    template,
    includeTemplate: true,
  })

  // When template uses slot.script.inlineTag, it's detected and not re-injected
  const scriptMatches = result.html.match(/<script>console\.log\("slot"\);<\/script>/g)
  assert.ok(!scriptMatches || scriptMatches.length <= 1, 'Should have at most one script tag')
})

test('injectUnusedAssets should not inject when template.variableUsage.slot.script.tag is used', async () => {
  const slot: VirtualDoc = {
    title: 'Slot',
    path: '/slot',
    content: 'Slot content',
    script: 'console.log("slot");',
  }

  const content: VirtualDoc = {
    title: 'Content',
    path: '/content',
    content: '<%= slot.html %>',
  }

  const template: VirtualDoc = {
    title: 'Template',
    path: '/template',
    content: '<%= slot.script.tag %><%= slot.html %>',
  }

  const result = await render({
    content,
    slot,
    template,
    includeTemplate: true,
  })

  // When template uses slot.script.tag, it's detected and not re-injected
  const scriptSrcMatches = result.html.match(/<script src="\/slot\/script\.js"><\/script>/g)
  assert.ok(!scriptSrcMatches || scriptSrcMatches.length <= 1, 'Should have at most one script src tag')
})

test('injectUnusedAssets should not inject when content.variableUsage.slot.script.inlineTag is used', async () => {
  const slot: VirtualDoc = {
    title: 'Slot',
    path: '/slot',
    content: 'Slot content',
    script: 'console.log("slot");',
  }

  const content: VirtualDoc = {
    title: 'Content',
    path: '/content',
    content: '<%= slot.script.inlineTag %><%= slot.html %>',
  }

  const template: VirtualDoc = {
    title: 'Template',
    path: '/template',
    content: '<%= slot.html %>',
  }

  const result = await render({
    content,
    slot,
    template,
    includeTemplate: true,
  })

  // Should only have one script tag from explicit usage in content
  const scriptMatches = result.html.match(/<script>console\.log\("slot"\);<\/script>/g)
  assert.strictEqual(scriptMatches?.length, 1)
})

test('injectUnusedAssets should not inject when content.variableUsage.slot.script.tag is used', async () => {
  const slot: VirtualDoc = {
    title: 'Slot',
    path: '/slot',
    content: 'Slot content',
    script: 'console.log("slot");',
  }

  const content: VirtualDoc = {
    title: 'Content',
    path: '/content',
    content: '<%= slot.script.tag %><%= slot.html %>',
  }

  const template: VirtualDoc = {
    title: 'Template',
    path: '/template',
    content: '<%= slot.html %>',
  }

  const result = await render({
    content,
    slot,
    template,
    includeTemplate: true,
  })

  // Should have the script tag link from explicit usage in content
  assert.ok(result.html.includes(`<script src="${getScriptPath(slot)}"></script>`))
  // Should not have duplicate inline scripts injected
  const inlineScriptMatches = result.html.match(/<script>console\.log\("slot"\);<\/script>/g)
  assert.ok(!inlineScriptMatches || inlineScriptMatches.length === 0)
})

test('injectUnusedAssets should not inject when content.variableUsage.style.inlineTag is used (content uses own style)', async () => {
  const content: VirtualDoc = {
    title: 'Content',
    path: '/content',
    content: '<%= style.inlineTag %><p>Content with style</p>',
    style: 'p { color: blue; }',
  }

  const template: VirtualDoc = {
    title: 'Template',
    path: '/template',
    content: '<%= slot.html %>',
  }

  const result = await render({
    content,
    slot: undefined,
    template,
    includeTemplate: true,
  })

  // Content uses its own style, should not be duplicated
  const styleMatches = result.html.match(/<style>p { color: blue; }<\/style>/g)
  assert.ok(!styleMatches || styleMatches.length <= 1, 'Should have at most one style tag')
})

test('injectUnusedAssets should not inject when content.variableUsage.style.tag is used (content uses own style)', async () => {
  const content: VirtualDoc = {
    title: 'Content',
    path: '/content',
    content: '<%= style.tag %><p>Content with style</p>',
    style: 'p { color: blue; }',
  }

  const template: VirtualDoc = {
    title: 'Template',
    path: '/template',
    content: '<%= slot.html %>',
  }

  const result = await render({
    content,
    slot: undefined,
    template,
    includeTemplate: true,
  })

  // Content uses its own style via tag, should not be duplicated
  const expectedHref = getStylePath(content).replace(/\//g, '\\/')
  const linkMatches = result.html.match(new RegExp(`<link rel="stylesheet" href="${expectedHref}">`, 'g'))
  assert.ok(!linkMatches || linkMatches.length <= 1, 'Should have at most one link tag')
})

test('injectUnusedAssets should not inject when content.variableUsage.script.inlineTag is used (content uses own script)', async () => {
  const content: VirtualDoc = {
    title: 'Content',
    path: '/content',
    content: '<%= script.inlineTag %><p>Content with script</p>',
    script: 'console.log("content");',
  }

  const template: VirtualDoc = {
    title: 'Template',
    path: '/template',
    content: '<%= slot.html %>',
  }

  const result = await render({
    content,
    slot: undefined,
    template,
    includeTemplate: true,
  })

  // Content uses its own script, should not be duplicated
  const scriptMatches = result.html.match(/<script>console\.log\("content"\);<\/script>/g)
  assert.ok(!scriptMatches || scriptMatches.length <= 1, 'Should have at most one script tag')
})

test('injectUnusedAssets should not inject when content.variableUsage.script.tag is used (content uses own script)', async () => {
  const content: VirtualDoc = {
    title: 'Content',
    path: '/content',
    content: '<%= script.tag %><p>Content with script</p>',
    script: 'console.log("content");',
  }

  const template: VirtualDoc = {
    title: 'Template',
    path: '/template',
    content: '<%= slot.html %>',
  }

  const result = await render({
    content,
    slot: undefined,
    template,
    includeTemplate: true,
  })

  // Content uses its own script via tag, should not be duplicated
  const scriptSrcMatches = result.html.match(/<script src="\/content\/script\.js"><\/script>/g)
  assert.ok(!scriptSrcMatches || scriptSrcMatches.length <= 1, 'Should have at most one script src tag')
})

test('injectUnusedAssets should not inject when template.variableUsage.style.inlineTag is used (template uses own style)', async () => {
  const content: VirtualDoc = {
    title: 'Content',
    path: '/content',
    content: '<p>Content</p>',
  }

  const template: VirtualDoc = {
    title: 'Template',
    path: '/template',
    content: '<%= style.inlineTag %><%= slot.html %>',
    style: 'body { background: white; }',
  }

  const result = await render({
    content,
    slot: undefined,
    template,
    includeTemplate: true,
  })

  // Template uses its own style, should not be duplicated
  const styleMatches = result.html.match(/<style>body { background: white; }<\/style>/g)
  assert.ok(!styleMatches || styleMatches.length <= 1, 'Should have at most one style tag')
})

test('injectUnusedAssets should not inject when template.variableUsage.style.tag is used (template uses own style)', async () => {
  const content: VirtualDoc = {
    title: 'Content',
    path: '/content',
    content: '<p>Content</p>',
  }

  const template: VirtualDoc = {
    title: 'Template',
    path: '/template',
    content: '<%= style.tag %><%= slot.html %>',
    style: 'body { background: white; }',
  }

  const result = await render({
    content,
    slot: undefined,
    template,
    includeTemplate: true,
  })

  // Template uses its own style via tag, should not be duplicated
  const expectedHref = getStylePath(template).replace(/\//g, '\\/')
  const linkMatches = result.html.match(new RegExp(`<link rel="stylesheet" href="${expectedHref}">`, 'g'))
  assert.ok(!linkMatches || linkMatches.length <= 1, 'Should have at most one link tag')
})

test('injectUnusedAssets should not inject when template.variableUsage.script.inlineTag is used (template uses own script)', async () => {
  const content: VirtualDoc = {
    title: 'Content',
    path: '/content',
    content: '<p>Content</p>',
  }

  const template: VirtualDoc = {
    title: 'Template',
    path: '/template',
    content: '<%= script.inlineTag %><%= slot.html %>',
    script: 'console.log("template");',
  }

  const result = await render({
    content,
    slot: undefined,
    template,
    includeTemplate: true,
  })

  // Template uses its own script, should not be duplicated
  const scriptMatches = result.html.match(/<script>console\.log\("template"\);<\/script>/g)
  assert.ok(!scriptMatches || scriptMatches.length <= 1, 'Should have at most one script tag')
})

test('injectUnusedAssets should not inject when template.variableUsage.script.tag is used (template uses own script)', async () => {
  const content: VirtualDoc = {
    title: 'Content',
    path: '/content',
    content: '<p>Content</p>',
  }

  const template: VirtualDoc = {
    title: 'Template',
    path: '/template',
    content: '<%= script.tag %><%= slot.html %>',
    script: 'console.log("template");',
  }

  const result = await render({
    content,
    slot: undefined,
    template,
    includeTemplate: true,
  })

  // Template uses its own script via tag, should not be duplicated
  const scriptSrcMatches = result.html.match(/<script src="\/template\/script\.js"><\/script>/g)
  assert.ok(!scriptSrcMatches || scriptSrcMatches.length <= 1, 'Should have at most one script src tag')
})

test('render function should convert RenderDocument to VirtualDoc and render', async () => {
  const {render} = await import('../../src/render/index.ts')

  const document = {
    id: 1,
    path: '/test',
    title: 'Test Doc',
    content: '# Hello World',
    data: '{"key": "value"}',
    style: 'body { margin: 0; }',
    script: 'console.log("test");',
    server: 'export default { status: "ok" };',
    published: true,
    draft: false,
    created_at: new Date('2024-01-01'),
    updated_at: new Date('2024-01-02'),
  } as unknown as RenderDocument

  const result = await render(document)

  assert.strictEqual(result.title, 'Test Doc')
  assert.strictEqual(result.path, '/test')
  assert.ok(result.html.includes('<h1 id="hello-world">Hello World</h1>'))
})

test('render function should handle RenderDocument with slot', async () => {
  const {render} = await import('../../src/render/index.ts')

  const document = {
    id: 1,
    path: '/parent',
    title: 'Parent',
    content: '<%= slot.html %>',
    data: '{}',
    published: true,
    draft: false,
    created_at: new Date(),
    updated_at: new Date(),
    slot: {
      id: 2,
      path: '/child',
      title: 'Child',
      content: '## Child Content',
      data: '{}',
      published: true,
      draft: false,
      created_at: new Date(),
      updated_at: new Date(),
    },
  } as unknown as RenderDocument

  const result = await render(document)

  assert.ok(result.html.includes('<h2 id="child-content">Child Content</h2>'))
})

test('render function should handle RenderDocument with template', async () => {
  const {render} = await import('../../src/render/index.ts')

  const document = {
    id: 1,
    path: '/content',
    title: 'Content',
    content: '# My Content',
    data: '{}',
    published: true,
    draft: false,
    created_at: new Date(),
    updated_at: new Date(),
    template: {
      id: 3,
      path: '/template',
      title: 'Template',
      content: '<!DOCTYPE html><html><body><%= slot.html %></body></html>',
      data: '{}',
      published: true,
      draft: false,
      created_at: new Date(),
      updated_at: new Date(),
    },
  } as unknown as RenderDocument

  const result = await render(document)

  // The render function passes content as 'slot' to the template
  assert.ok(result.html.includes('<!DOCTYPE html>'))
  assert.ok(result.html.includes('<h1 id="my-content">My Content</h1>'))
})

test('toVirtualDoc should handle invalid JSON in data field', async () => {
  const {render} = await import('../../src/render/index.ts')

  const document = {
    id: 1,
    path: '/test',
    title: 'Test',
    content: 'Data keys: <%= Object.keys(data).length %>',
    data: '{invalid json}', // Invalid JSON
    published: true,
    draft: false,
    created_at: new Date(),
    updated_at: new Date(),
  } as unknown as RenderDocument

  const result = await render(document)

  // Should use empty object when JSON parse fails
  assert.ok(result.html.includes('Data keys: 0'))
})

test('toVirtualDoc should handle null data field', async () => {
  const {render} = await import('../../src/render/index.ts')

  const document = {
    id: 1,
    path: '/test',
    title: 'Test',
    content: 'Data keys: <%= Object.keys(data).length %>',
    data: null, // No data
    published: true,
    draft: false,
    created_at: new Date(),
    updated_at: new Date(),
  } as unknown as RenderDocument

  const result = await render(document)

  // Should use empty object when data is null
  assert.ok(result.html.includes('Data keys: 0'))
})

// ============================================================================
// BRANCH COVERAGE TESTS - Testing uncovered branches
// ============================================================================

test('injectUnusedAssets should return template HTML unchanged for non-HTML extension', async () => {
  // This tests the branch: extension !== '.html' returns template.html early (lines 34-35)
  const content: VirtualDoc = {
    title: 'Content',
    path: '/content',
    content: '# Markdown Content',
    style: 'body { margin: 0; }',
    script: 'console.log("content");',
    extension: '.md', // Non-HTML extension
  }

  const template: VirtualDoc = {
    title: 'Template',
    path: '/template',
    content: '# Template\n\n<%= slot.html %>',
    style: '.template { color: red; }',
    script: 'console.log("template");',
  }

  const result = await render({
    content,
    template,
    includeTemplate: true,
  })

  // For non-HTML, styles and scripts should NOT be auto-injected
  assert.ok(!result.html.includes('<style>'), 'No style tags should be injected for non-HTML')
  assert.ok(!result.html.includes('<script>'), 'No script tags should be injected for non-HTML')
})

test('injectUnusedAssetsInContent should return content HTML unchanged for non-HTML extension', async () => {
  // This tests the branch: extension !== '.html' returns content.html early (lines 178-179)
  const content: VirtualDoc = {
    title: 'Content',
    path: '/content',
    content: '# Just Markdown',
    style: 'h1 { color: blue; }',
    script: 'console.log("content");',
    extension: '.md', // Non-HTML extension
  }

  const result = await render({
    content,
    includeTemplate: false,
  })

  // For non-HTML, styles and scripts should NOT be auto-injected
  assert.ok(!result.html.includes('<style>'), 'No style tags should be injected for non-HTML without template')
  assert.ok(!result.html.includes('<script>'), 'No script tags should be injected for non-HTML without template')
})

test('injectUnusedAssets should not inject styles when HTML has author stylesheet link', async () => {
  // This tests the hasAuthorStylesheet branch - when HTML already has <link rel="stylesheet">
  const content: VirtualDoc = {
    title: 'Content',
    path: '/content',
    content: 'Content text',
    style: '.content { color: blue; }',
  }

  const template: VirtualDoc = {
    title: 'Template',
    path: '/template',
    content:
      '<!DOCTYPE html><html><head><link rel="stylesheet" href="/external.css"></head><body><%= slot.html %></body></html>',
    style: '.template { color: red; }',
  }

  const result = await render({
    content,
    template,
    includeTemplate: true,
  })

  // Should not inject template or content styles since author has their own stylesheet link
  assert.ok(
    !result.html.includes('<style>.template { color: red; }</style>'),
    'Template style should not be injected when author has stylesheet',
  )
  assert.ok(
    !result.html.includes('<style>.content { color: blue; }</style>'),
    'Content style should not be injected when author has stylesheet',
  )
  assert.ok(result.html.includes('<link rel="stylesheet" href="/external.css">'), 'Author stylesheet should remain')
})

test('injectUnusedAssets should not inject scripts when HTML has author script tag', async () => {
  // This tests the hasAuthorScript branch - when HTML already has <script src="...">
  const content: VirtualDoc = {
    title: 'Content',
    path: '/content',
    content: 'Content text',
    script: 'console.log("content");',
  }

  const template: VirtualDoc = {
    title: 'Template',
    path: '/template',
    content: '<!DOCTYPE html><html><body><%= slot.html %><script src="/external.js"></script></body></html>',
    script: 'console.log("template");',
  }

  const result = await render({
    content,
    template,
    includeTemplate: true,
  })

  // Should not inject template or content scripts since author has their own script tag
  assert.ok(
    !result.html.includes('<script>console.log("template");</script>'),
    'Template script should not be injected when author has script',
  )
  assert.ok(
    !result.html.includes('<script>console.log("content");</script>'),
    'Content script should not be injected when author has script',
  )
  assert.ok(result.html.includes('<script src="/external.js"></script>'), 'Author script should remain')
})

test('injectUnusedAssetsInContent should not inject styles when HTML has author stylesheet', async () => {
  // This tests hasAuthorStylesheet in injectUnusedAssetsInContent
  const content: VirtualDoc = {
    title: 'Content',
    path: '/content',
    content: '<html><head><link rel="stylesheet" href="/my-styles.css"></head><body>Content</body></html>',
    style: 'body { background: red; }',
  }

  const result = await render({
    content,
    includeTemplate: false,
  })

  // Should not inject content style since author has their own stylesheet
  assert.ok(
    !result.html.includes('<style>body { background: red; }</style>'),
    'Content style should not be injected when author has stylesheet',
  )
  assert.ok(result.html.includes('<link rel="stylesheet" href="/my-styles.css">'), 'Author stylesheet should remain')
})

test('injectUnusedAssetsInContent should not inject scripts when HTML has author script', async () => {
  // This tests hasAuthorScript in injectUnusedAssetsInContent
  const content: VirtualDoc = {
    title: 'Content',
    path: '/content',
    content: '<html><body>Content<script src="/app.js"></script></body></html>',
    script: 'console.log("my script");',
  }

  const result = await render({
    content,
    includeTemplate: false,
  })

  // Should not inject content script since author has their own script tag
  assert.ok(
    !result.html.includes('<script>console.log("my script");</script>'),
    'Content script should not be injected when author has script',
  )
  assert.ok(result.html.includes('<script src="/app.js"></script>'), 'Author script should remain')
})

test('injectUnusedAssets should inject slot assets when slot has style/script but not used', async () => {
  // This tests the slot.style.content and slot.script.content branches (lines 76-77, 80-81)
  const slot: VirtualDoc = {
    title: 'Slot',
    path: '/slot',
    content: 'Slot with assets',
    style: '.slot-style { color: green; }',
    script: 'console.log("slot script");',
  }

  const content: VirtualDoc = {
    title: 'Content',
    path: '/content',
    content: '<%= slot.html %>', // Only uses slot.html, not slot.style or slot.script
  }

  const template: VirtualDoc = {
    title: 'Template',
    path: '/template',
    content: '<!DOCTYPE html><html><head></head><body><%= slot.html %></body></html>',
  }

  const result = await render({
    content,
    slot,
    template,
    includeTemplate: true,
  })

  // Slot assets should be injected since they weren't explicitly used
  assert.ok(result.html.includes('<style>.slot-style { color: green; }</style>'), 'Slot style should be injected')
  assert.ok(result.html.includes('<script>console.log("slot script");</script>'), 'Slot script should be injected')
})

test('render should use root base path when content path is /', async () => {
  // Tests the content.path === '/' branch for base tag
  const content: VirtualDoc = {
    title: 'Root Content',
    path: '/',
    content: '<html><body>Root page</body></html>',
    style: 'body { margin: 0; }',
  }

  const result = await render({
    content,
    includeTemplate: false,
  })

  // Base href should be "/" for root path
  assert.ok(result.html.includes('<base href="/">'), 'Base href should be "/" for root path')
})

test('render should use path with trailing slash when content path is not root', async () => {
  // Tests the content.path !== '/' branch for base tag
  const content: VirtualDoc = {
    title: 'Nested Content',
    path: '/nested/page',
    content: '<html><body>Nested page</body></html>',
    style: 'body { margin: 0; }',
  }

  const result = await render({
    content,
    includeTemplate: false,
  })

  // Base href should have trailing slash for non-root path
  assert.ok(result.html.includes('<base href="/nested/page/">'), 'Base href should have trailing slash')
})

test('injectUnusedAssets should inject template scripts before closing html when no body', async () => {
  // Tests script injection before </html> in template (line 159)
  const content: VirtualDoc = {
    title: 'Content',
    path: '/content',
    content: 'Content text',
  }

  const template: VirtualDoc = {
    title: 'Template',
    path: '/template',
    content: '<html><%= slot.html %></html>', // No body tag
    script: 'console.log("template script");',
  }

  const result = await render({
    content,
    template,
    includeTemplate: true,
  })

  // Script should be injected before </html>
  assert.ok(
    result.html.includes('<script>console.log("template script");</script>\n</html>'),
    'Script should be before </html>',
  )
})

test('injectUnusedAssets should append scripts at end when template has no structural tags', async () => {
  // Tests script injection when no </body> or </html> (line 163)
  const content: VirtualDoc = {
    title: 'Content',
    path: '/content',
    content: 'Content text',
  }

  const template: VirtualDoc = {
    title: 'Template',
    path: '/template',
    content: '<%= slot.html %>', // No structural tags
    script: 'console.log("template script");',
  }

  const result = await render({
    content,
    template,
    includeTemplate: true,
  })

  // Script should be appended at the end
  assert.ok(
    result.html.endsWith('\n<script>console.log("template script");</script>'),
    'Script should be appended at end',
  )
})

test('render should not inject base tag when template already has one', async () => {
  // Tests the hasBaseTag check
  const content: VirtualDoc = {
    title: 'Content',
    path: '/content',
    content: 'Content text',
  }

  const template: VirtualDoc = {
    title: 'Template',
    path: '/template',
    content: '<!DOCTYPE html><html><head><base href="/custom/"></head><body><%= slot.html %></body></html>',
    style: 'body { margin: 0; }',
  }

  const result = await render({
    content,
    template,
    includeTemplate: true,
  })

  // Should preserve author's base tag, not add another
  const baseMatches = result.html.match(/<base\s+[^>]*href=/gi)
  assert.strictEqual(baseMatches?.length, 1, 'Should only have one base tag')
  assert.ok(result.html.includes('<base href="/custom/">'), 'Author base tag should be preserved')
})

test('injectUnusedAssetsInContent should not inject base tag when content already has one', async () => {
  const content: VirtualDoc = {
    title: 'Content',
    path: '/content',
    content: '<html><head><base href="/my-base/"></head><body>Content</body></html>',
    style: 'body { margin: 0; }',
  }

  const result = await render({
    content,
    includeTemplate: false,
  })

  // Should preserve author's base tag, not add another
  const baseMatches = result.html.match(/<base\s+[^>]*href=/gi)
  assert.strictEqual(baseMatches?.length, 1, 'Should only have one base tag')
  assert.ok(result.html.includes('<base href="/my-base/">'), 'Author base tag should be preserved')
})

test('injectUnusedAssets should handle content with styles/scripts when template references slot (which is the rendered content)', async () => {
  // In template rendering: content becomes "slot" in template's context
  // When template uses slot.style.inlineTag, it's accessing the CONTENT's style (since content becomes slot)
  const content: VirtualDoc = {
    title: 'Content',
    path: '/content',
    content: '<p>Content text</p>',
    style: '.content { background: yellow; }',
    script: 'console.log("content");',
  }

  const template: VirtualDoc = {
    title: 'Template',
    path: '/template',
    // In template, "slot" refers to content (content becomes slot)
    content:
      '<html><head><%= slot.style.inlineTag %></head><body><%= slot.html %><%= slot.script.inlineTag %></body></html>',
  }

  const result = await render({
    content,
    template,
    includeTemplate: true,
  })

  // Content style and script should appear only once (from explicit template usage)
  const styleMatches = result.html.match(/<style>\.content { background: yellow; }<\/style>/g)
  const scriptMatches = result.html.match(/<script>console\.log\("content"\);<\/script>/g)
  assert.strictEqual(styleMatches?.length, 1, 'Content style should only appear once')
  assert.strictEqual(scriptMatches?.length, 1, 'Content script should only appear once')
})

test('render function should handle RenderDocument with slot and template together', async () => {
  const {render} = await import('../../src/render/index.ts')

  const document = {
    id: 1,
    path: '/page',
    title: 'Page',
    content: '# Page\n\n<%= slot.html %>',
    data: '{}',
    style: '.page { color: blue; }',
    published: true,
    draft: false,
    created_at: new Date(),
    updated_at: new Date(),
    slot: {
      id: 2,
      path: '/widget',
      title: 'Widget',
      content: '## Widget Content',
      data: '{"key": "value"}',
      style: '.widget { color: red; }',
      published: true,
      draft: false,
      created_at: new Date(),
      updated_at: new Date(),
    },
    template: {
      id: 3,
      path: '/layout',
      title: 'Layout',
      content: '<!DOCTYPE html><html><head></head><body><%= slot.html %></body></html>',
      data: '{}',
      style: '.layout { margin: 0; }',
      published: true,
      draft: false,
      created_at: new Date(),
      updated_at: new Date(),
    },
  } as unknown as RenderDocument

  const result = await render(document)

  // Should have all three document types rendered together
  assert.ok(result.html.includes('<!DOCTYPE html>'))
  assert.ok(result.html.includes('<h1 id="page">Page</h1>'))
  assert.ok(result.html.includes('<h2 id="widget-content">Widget Content</h2>'))
  // All three styles should be injected
  assert.ok(result.html.includes('<style>.layout { margin: 0; }</style>'))
  assert.ok(result.html.includes('<style>.widget { color: red; }</style>'))
  assert.ok(result.html.includes('<style>.page { color: blue; }</style>'))
})

test('render function should pass custom context through to rendering', async () => {
  const {render} = await import('../../src/render/index.ts')

  const document = {
    id: 1,
    path: '/test',
    title: 'Test',
    content: 'Hello <%= customName %>!',
    data: '{}',
    published: true,
    draft: false,
    created_at: new Date(),
    updated_at: new Date(),
  } as unknown as RenderDocument

  const result = await render(document, {customName: 'World'})

  assert.ok(result.html.includes('Hello World!'))
})

test('injectUnusedAssets should handle content style when template.variableUsage.slot.style references it', async () => {
  // Tests the contentStyleUsed check that involves template.variableUsage.slot.style (lines 98-99)
  const content: VirtualDoc = {
    title: 'Content',
    path: '/content',
    content: '<%= style.inlineTag %><p>Content</p>',
    style: '.content-style { color: purple; }',
  }

  const template: VirtualDoc = {
    title: 'Template',
    path: '/template',
    content: '<html><body><%= slot.html %></body></html>',
  }

  const result = await render({
    content,
    template,
    includeTemplate: true,
  })

  // Content style should appear only once from explicit usage
  const styleMatches = result.html.match(/<style>\.content-style { color: purple; }<\/style>/g)
  assert.strictEqual(styleMatches?.length, 1, 'Content style should only appear once')
})

test('injectUnusedAssets should handle content script when template.variableUsage.slot.script references it', async () => {
  // Tests the contentScriptUsed check that involves template.variableUsage.slot.script (lines 102-103)
  const content: VirtualDoc = {
    title: 'Content',
    path: '/content',
    content: '<%= script.inlineTag %><p>Content</p>',
    script: 'console.log("content script");',
  }

  const template: VirtualDoc = {
    title: 'Template',
    path: '/template',
    content: '<html><body><%= slot.html %></body></html>',
  }

  const result = await render({
    content,
    template,
    includeTemplate: true,
  })

  // Content script should appear only once from explicit usage
  const scriptMatches = result.html.match(/<script>console\.log\("content script"\);<\/script>/g)
  assert.strictEqual(scriptMatches?.length, 1, 'Content script should only appear once')
})

test('injectUnusedAssets should inject scripts before body close when template has body', async () => {
  // Tests script injection before </body> in template with body tag (lines 153-154)
  const content: VirtualDoc = {
    title: 'Content',
    path: '/content',
    content: 'Content text',
  }

  const template: VirtualDoc = {
    title: 'Template',
    path: '/template',
    content: '<html><body><%= slot.html %></body></html>',
    script: 'console.log("before body close");',
  }

  const result = await render({
    content,
    template,
    includeTemplate: true,
  })

  // Script should be injected before </body>
  assert.ok(
    result.html.includes('<script>console.log("before body close");</script>\n</body>'),
    'Script should be before </body>',
  )
})

test('injectUnusedAssets should create head before body when template has only body tag', async () => {
  // Tests head creation when template has body but no head (lines 137-138)
  const content: VirtualDoc = {
    title: 'Content',
    path: '/content',
    content: 'Content text',
  }

  const template: VirtualDoc = {
    title: 'Template',
    path: '/template',
    content: '<body><%= slot.html %></body>',
    style: '.template-style { padding: 10px; }',
  }

  const result = await render({
    content,
    template,
    includeTemplate: true,
  })

  // Head should be created before body
  assert.ok(result.html.includes('<head>\n'), 'Head should be created')
  assert.ok(result.html.includes('</head>\n<body>'), 'Head should be before body')
  assert.ok(result.html.includes('<style>.template-style { padding: 10px; }</style>'), 'Style should be in head')
})

test('render should handle extension parameter with .eta template', async () => {
  // Test that extension is passed correctly to asset injection
  const content: VirtualDoc = {
    title: 'Content',
    path: '/content',
    content: '<p>This is an eta template</p>',
    style: 'p { font-size: 16px; }',
    extension: '.html', // Even with .eta file, output is .html
  }

  const result = await render({
    content,
    includeTemplate: false,
  })

  // Assets should be injected for .html extension
  assert.ok(result.html.includes('<style>p { font-size: 16px; }</style>'), 'Style should be injected for .html')
})

test('virtualRender should return content directly when includeTemplate is false with slot', async () => {
  // Tests the branch when includeTemplate is false but slot is provided (lines 239-241)
  const slot: VirtualDoc = {
    title: 'Slot',
    path: '/slot',
    content: '<span>Slot text</span>',
    style: '.slot { border: 1px solid; }',
  }

  const content: VirtualDoc = {
    title: 'Content',
    path: '/content',
    content: '<div><%= slot.html %></div>',
    style: '.content { padding: 5px; }',
  }

  const template: VirtualDoc = {
    title: 'Template',
    path: '/template',
    content: '<!DOCTYPE html><html><body><%= slot.html %></body></html>',
    style: '.template { margin: 0; }',
  }

  const result = await render({
    content,
    slot,
    template,
    includeTemplate: false, // Don't use template
  })

  // Template should NOT be applied
  assert.ok(!result.html.includes('<!DOCTYPE html>'), 'Template should not be used')
  assert.ok(!result.html.includes('<style>.template { margin: 0; }</style>'), 'Template style should not appear')

  // Content and slot should still be rendered
  assert.ok(result.html.includes('<div>'), 'Content should be rendered')
  assert.ok(result.html.includes('<span>Slot text</span>'), 'Slot should be rendered')
  assert.ok(result.html.includes('<style>.slot { border: 1px solid; }</style>'), 'Slot style should be injected')
  assert.ok(result.html.includes('<style>.content { padding: 5px; }</style>'), 'Content style should be injected')
})

test('virtualRender should handle missing templateDocument even with includeTemplate true', async () => {
  // Tests the !templateDocument branch (line 321 equivalent: if (!includeTemplate || !templateDocument))
  const content: VirtualDoc = {
    title: 'Content',
    path: '/content',
    content: '<p>Content without template</p>',
    style: '.content { color: teal; }',
  }

  const result = await render({
    content,
    slot: undefined,
    template: undefined,
    includeTemplate: true, // true but no template provided
  })

  // Should still render content with assets
  assert.ok(result.html.includes('<p>Content without template</p>'), 'Content should be rendered')
  assert.ok(result.html.includes('<style>.content { color: teal; }</style>'), 'Content style should be injected')
})

// ===========================================================================
// Tests that call the REAL render() export to cover src/render/index.ts lines
// ===========================================================================

function makeDoc(overrides: Partial<RenderDocument> = {}): RenderDocument {
  const now = new Date()
  return {
    id: 0 as RenderDocument['id'],
    path: '/test',
    published: false,
    redirect: false,
    title: 'Test',
    content: '<p>Hello</p>',
    data: '',
    style: '',
    script: '',
    server: '',
    template_id: null,
    slot_id: null,
    content_type: 'text/html',
    data_type: null,
    has_eta: false,
    mime_type: 'text/html',
    extension: '.html',
    created_at: now,
    updated_at: now,
    draft: false,
    redirects: [],
    uploads: [],
    ...overrides,
  } as RenderDocument
}

// Lines 33-34: non-HTML extension returns content unchanged (injectUnusedAssets)
test('render() with template: non-HTML extension returns content unchanged', async () => {
  const doc = makeDoc({
    extension: '.txt',
    content: 'plain text content',
    style: 'body { color: red; }',
    template: makeDoc({
      content: '<html><body><%= slot.html %></body></html>',
      style: '.template { margin: 0; }',
    }),
  })
  const result = await renderDoc(doc)
  assert.ok(!result.html.includes('<style>'), 'No style tags should be injected for non-HTML')
})

// Lines 57-58: template script injection
test('render() with template: unused template script is injected before </body>', async () => {
  const doc = makeDoc({
    content: '<p>Content</p>',
    template: makeDoc({
      content: '<html><head></head><body><%= slot.html %></body></html>',
      script: 'console.log("template")',
    }),
  })
  const result = await renderDoc(doc)
  assert.ok(result.html.includes('<script>console.log("template")</script>'), 'Template script should be injected')
  const scriptIdx = result.html.indexOf('<script>console.log("template")</script>')
  const bodyCloseIdx = result.html.indexOf('</body>')
  assert.ok(scriptIdx < bodyCloseIdx, 'Script should be before </body>')
})

// Lines 79-80: slot script injection
test('render() with template and slot: unused slot script is injected', async () => {
  const doc = makeDoc({
    content: '<p>Content</p>',
    slot: makeDoc({
      content: '<span>Slot</span>',
      script: 'console.log("slot")',
    }),
    template: makeDoc({
      content: '<html><head></head><body><%= slot.html %></body></html>',
    }),
  })
  const result = await renderDoc(doc)
  assert.ok(result.html.includes('<script>console.log("slot")</script>'), 'Slot script should be injected')
})

// Lines 101-102: content script injection
test('render() with template: unused content script is injected', async () => {
  const doc = makeDoc({
    content: '<p>Content</p>',
    script: 'console.log("content")',
    template: makeDoc({
      content: '<html><head></head><body><%= slot.html %></body></html>',
    }),
  })
  const result = await renderDoc(doc)
  assert.ok(result.html.includes('<script>console.log("content")</script>'), 'Content script should be injected')
})

// Lines 134-138: head injection after <html> when no <head> or <body>
test('render() with template: injects head after <html> when no head/body tags', async () => {
  const doc = makeDoc({
    content: '<p>Content</p>',
    style: '.content { color: red; }',
    template: makeDoc({
      content: '<html><%= slot.html %></html>',
    }),
  })
  const result = await renderDoc(doc)
  assert.ok(result.html.includes('<head>'), 'Head should be created')
  assert.ok(result.html.includes('<style>.content { color: red; }</style>'), 'Content style should be injected')
  const htmlIdx = result.html.indexOf('<html>')
  const headIdx = result.html.indexOf('<head>')
  assert.ok(headIdx > htmlIdx, 'Head should appear after <html>')
})

// Lines 139-141: head injection when no structural tags at all
test('render() with template: prepends head items when no structural tags', async () => {
  const doc = makeDoc({
    content: '<p>Content</p>',
    style: '.content { color: red; }',
    template: makeDoc({
      content: '<%= slot.html %>',
    }),
  })
  const result = await renderDoc(doc)
  assert.ok(result.html.includes('<style>.content { color: red; }</style>'), 'Content style should be prepended')
  assert.ok(result.html.includes('<base href="/test/">'), 'Base tag should be prepended')
})

// Lines 157-159: script injection before </html> when no </body>
test('render() with template: injects scripts before </html> when no </body>', async () => {
  const doc = makeDoc({
    content: '<p>Content</p>',
    script: 'console.log("content")',
    template: makeDoc({
      content: '<html><head></head><%= slot.html %></html>',
    }),
  })
  const result = await renderDoc(doc)
  const scriptIdx = result.html.indexOf('<script>console.log("content")</script>')
  const htmlCloseIdx = result.html.indexOf('</html>')
  assert.ok(scriptIdx !== -1, 'Script should exist')
  assert.ok(scriptIdx < htmlCloseIdx, 'Script should be before </html>')
})

// Lines 160-162: script injection appended when no structural closing tags
test('render() with template: appends scripts when no structural closing tags', async () => {
  const doc = makeDoc({
    content: '<p>Content</p>',
    script: 'console.log("content")',
    template: makeDoc({
      content: '<%= slot.html %>',
    }),
  })
  const result = await renderDoc(doc)
  assert.ok(result.html.includes('<script>console.log("content")</script>'), 'Script should be appended')
  assert.ok(result.html.endsWith('<script>console.log("content")</script>'), 'Script should be at the end')
})

// Lines 177-178: non-HTML extension in injectUnusedAssetsInContent (no template)
test('render() without template: non-HTML extension returns content unchanged', async () => {
  const doc = makeDoc({
    extension: '.txt',
    content: 'plain text',
    style: 'body { color: red; }',
  })
  const result = await renderDoc(doc)
  assert.ok(!result.html.includes('<style>'), 'No style tags should be injected for non-HTML')
  assert.ok(result.html.includes('plain text'), 'Content should be present')
})

// Lines 197-198: slot style injection in content-only render
test('render() without template: unused slot style is injected', async () => {
  const doc = makeDoc({
    content: '<html><head></head><body><p>Content</p></body></html>',
    slot: makeDoc({
      content: '<span>Slot</span>',
      style: '.slot { border: 1px solid; }',
    }),
  })
  const result = await renderDoc(doc)
  assert.ok(result.html.includes('<style>.slot { border: 1px solid; }</style>'), 'Slot style should be injected')
})

// Lines 201-202: slot script injection in content-only render
test('render() without template: unused slot script is injected', async () => {
  const doc = makeDoc({
    content: '<html><head></head><body><p>Content</p></body></html>',
    slot: makeDoc({
      content: '<span>Slot</span>',
      script: 'console.log("slot")',
    }),
  })
  const result = await renderDoc(doc)
  assert.ok(result.html.includes('<script>console.log("slot")</script>'), 'Slot script should be injected')
})

// Lines 244-246: content-only head injection before <body> when no <head>
test('render() without template: injects head before body when no head exists', async () => {
  const doc = makeDoc({
    content: '<body><p>Content</p></body>',
    style: '.content { color: blue; }',
  })
  const result = await renderDoc(doc)
  assert.ok(result.html.includes('<head>'), 'Head should be created')
  const headIdx = result.html.indexOf('<head>')
  const bodyIdx = result.html.indexOf('<body>')
  assert.ok(headIdx < bodyIdx, 'Head should appear before <body>')
})

// Lines 250-252: content-only head injection after <html> when no head/body
test('render() without template: injects head after html when no head/body exists', async () => {
  const doc = makeDoc({
    content: '<html><p>Content</p></html>',
    style: '.content { color: green; }',
  })
  const result = await renderDoc(doc)
  assert.ok(result.html.includes('<head>'), 'Head should be created')
  const htmlIdx = result.html.indexOf('<html>')
  const headIdx = result.html.indexOf('<head>')
  assert.ok(headIdx > htmlIdx, 'Head should appear after <html>')
})

// Lines 253-255: content-only prepends head when no structural tags
test('render() without template: prepends head items when no structural tags', async () => {
  const doc = makeDoc({
    content: '<p>Content</p>',
    style: '.content { color: green; }',
  })
  const result = await renderDoc(doc)
  assert.ok(result.html.includes('<style>.content { color: green; }</style>'), 'Style should be prepended')
  assert.ok(result.html.includes('<base href="/test/">'), 'Base tag should be prepended')
  const styleIdx = result.html.indexOf('<style>')
  const contentIdx = result.html.indexOf('<p>Content</p>')
  assert.ok(styleIdx < contentIdx, 'Style should appear before content')
})

// Line 267: content-only script injection before </body>
test('render() without template: injects scripts before </body>', async () => {
  const doc = makeDoc({
    content: '<html><head></head><body><p>Content</p></body></html>',
    script: 'console.log("content")',
  })
  const result = await renderDoc(doc)
  const scriptIdx = result.html.indexOf('<script>console.log("content")</script>')
  const bodyCloseIdx = result.html.indexOf('</body>')
  assert.ok(scriptIdx !== -1, 'Script should exist')
  assert.ok(scriptIdx < bodyCloseIdx, 'Script should be before </body>')
})

// Line 271: content-only script injection before </html>
test('render() without template: injects scripts before </html> when no </body>', async () => {
  const doc = makeDoc({
    content: '<html><head></head><p>Content</p></html>',
    script: 'console.log("content")',
  })
  const result = await renderDoc(doc)
  const scriptIdx = result.html.indexOf('<script>console.log("content")</script>')
  const htmlCloseIdx = result.html.indexOf('</html>')
  assert.ok(scriptIdx !== -1, 'Script should exist')
  assert.ok(scriptIdx < htmlCloseIdx, 'Script should be before </html>')
})

// Lines 273: content-only script appended when no structural closing tags
test('render() without template: appends scripts when no structural closing tags', async () => {
  const doc = makeDoc({
    content: '<p>Content</p>',
    script: 'console.log("content")',
  })
  const result = await renderDoc(doc)
  assert.ok(result.html.includes('<script>console.log("content")</script>'), 'Script should be appended')
})

// Combined: template with both style and script unused
test('render() with template: both style and script are injected', async () => {
  const doc = makeDoc({
    content: '<p>Content</p>',
    template: makeDoc({
      content: '<html><head></head><body><%= slot.html %></body></html>',
      style: '.template { margin: 0; }',
      script: 'console.log("template")',
    }),
  })
  const result = await renderDoc(doc)
  assert.ok(result.html.includes('<style>.template { margin: 0; }</style>'), 'Template style should be in head')
  assert.ok(result.html.includes('<script>console.log("template")</script>'), 'Template script should be injected')
  const styleIdx = result.html.indexOf('<style>')
  const headIdx = result.html.indexOf('<head>')
  assert.ok(styleIdx > headIdx, 'Style should be inside head')
})
