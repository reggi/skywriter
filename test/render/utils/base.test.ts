import {test} from 'node:test'
import assert from 'node:assert'
import path from 'node:path'
import {baseRender, type VirtualDoc} from '../../../src/render/utils/base.ts'

// Helper functions to match the internal implementation in base.ts
function getStylePath(doc: VirtualDoc): string {
  return path.join(doc.path, 'style.css')
}

function getScriptPath(doc: VirtualDoc): string {
  return path.join(doc.path, 'script.js')
}

test('baseRender should render a simple VirtualDoc with markdown content', async () => {
  const doc: VirtualDoc = {
    title: 'Test Document',
    path: '/test',
    content: '# Hello World\n\nThis is a test.',
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-02'),
  }

  const result = await baseRender({
    doc,
  })

  // Check basic properties
  assert.strictEqual(result.title, 'Test Document')
  assert.strictEqual(result.path, '/test')
  assert.ok(result.html.includes('<h1 id="hello-world">Hello World</h1>'))
  assert.ok(result.html.includes('<p>This is a test.</p>'))

  // Check markdown is preserved
  assert.strictEqual(result.markdown, '# Hello World\n\nThis is a test.')

  // Check meta
  assert.ok(result.meta.createdAt instanceof Date)
  assert.ok(result.meta.updatedAt instanceof Date)

  // Check variable usage tracking
  assert.ok(result.variableUsage)
  assert.strictEqual(typeof result.variableUsage, 'object')
})

test('baseRender should render a VirtualDoc with a slot', async () => {
  // First create a slot document
  const slotDoc: VirtualDoc = {
    title: 'Slot Content',
    path: '/slot',
    content: '## Slot Heading\n\nThis is slot content.',
  }

  // Render the slot first
  const slotResult = await baseRender({
    doc: slotDoc,
    type: 'slot',
  })

  // Now create a parent document that uses the slot
  const parentDoc: VirtualDoc = {
    title: 'Parent Document',
    path: '/parent',
    content: '# Parent Title\n\n<%= slot.html %>\n\n## After Slot',
  }

  // Render parent with slot in context
  const result = await baseRender({
    doc: parentDoc,
    context: {
      slot: slotResult,
    },
  })

  // Check that slot content is included in parent
  assert.strictEqual(result.title, 'Parent Document')
  assert.strictEqual(result.path, '/parent')
  assert.ok(result.html.includes('<h1 id="parent-title">Parent Title</h1>'))
  assert.ok(result.html.includes('<h2 id="slot-heading">Slot Heading</h2>'))
  assert.ok(result.html.includes('This is slot content.'))
  assert.ok(result.html.includes('<h2 id="after-slot">After Slot</h2>'))

  // Verify the slot object is available in context
  assert.ok(result.slot)
  assert.strictEqual(result.slot?.title, 'Slot Content')

  // Check variable usage tracking
  assert.ok(result.variableUsage)
  assert.strictEqual(typeof result.variableUsage, 'object')
})

test('baseRender should track variable usage when properties are accessed', async () => {
  const doc: VirtualDoc = {
    title: 'Style Test',
    path: '/style-test',
    style: 'body { color: red; }',
    script: 'console.log("test");',
    content: '<%= style.inlineTag %>\n\n<%= script.tag %>\n\n<%= style.content %>',
  }

  const result = await baseRender({
    doc,
  })

  // Verify properties were accessed and tracked (now using nested objects)
  assert.ok(result.variableUsage.style, 'style object should exist in variableUsage')
  assert.ok(result.variableUsage.style.inlineTag, 'style.inlineTag should be tracked')
  assert.strictEqual(result.variableUsage.style.inlineTag, 1, 'style.inlineTag should be accessed once')

  assert.ok(result.variableUsage.script, 'script object should exist in variableUsage')
  assert.ok(result.variableUsage.script.tag, 'script.tag should be tracked')
  assert.strictEqual(result.variableUsage.script.tag, 1, 'script.tag should be accessed once')

  assert.ok(result.variableUsage.style.content, 'style.content should be tracked')
  assert.strictEqual(result.variableUsage.style.content, 1, 'style.content should be accessed once')

  // Verify unaccessed properties are not tracked
  assert.strictEqual(result.variableUsage.style.href, undefined, 'style.href should not be tracked')
  assert.strictEqual(result.variableUsage.script.href, undefined, 'script.href should not be tracked')
  assert.strictEqual(result.variableUsage.script.content, undefined, 'script.content should not be tracked')

  // Verify variableUsage is JSON stringifiable
  assert.doesNotThrow(() => JSON.stringify(result.variableUsage), 'variableUsage should be JSON stringifiable')
})

test('baseRender should extract headings from markdown', async () => {
  const doc: VirtualDoc = {
    title: 'Markdown Headings',
    path: '/md-headings',
    content: `# Main Title

## Section 1

### Subsection 1.1

## Section 2`,
  }

  const result = await baseRender({
    doc,
  })

  // Verify headings are extracted from markdown
  assert.ok(result.meta.headings, 'meta.headings should exist')
  assert.strictEqual(result.meta.headings!.length, 4, 'should have 4 headings')

  assert.strictEqual(result.meta.headings![0].level, 1)
  assert.strictEqual(result.meta.headings![0].text, 'Main Title')
  assert.strictEqual(result.meta.headings![0].id, 'main-title')

  assert.strictEqual(result.meta.headings![1].level, 2)
  assert.strictEqual(result.meta.headings![1].text, 'Section 1')

  assert.strictEqual(result.meta.headings![2].level, 3)
  assert.strictEqual(result.meta.headings![2].text, 'Subsection 1.1')

  // Verify TOC structure
  assert.ok(result.meta.toc, 'meta.toc should exist')
  assert.strictEqual(result.meta.toc!.length, 1, 'should have 1 root item')
  assert.strictEqual(result.meta.toc![0].text, 'Main Title')
  assert.strictEqual(result.meta.toc![0].children.length, 2, 'should have 2 section children')
})

test('baseRender should extract headings from HTML', async () => {
  const doc: VirtualDoc = {
    title: 'HTML Headings',
    path: '/html-headings',
    content: `<h1 id="main">Main Title</h1>
<p>Introduction</p>
<h2 id="sec1">Section 1</h2>
<h3>Subsection 1.1</h3>
<h2>Section 2</h2>`,
  }

  const result = await baseRender({
    doc,
  })

  // Verify headings are extracted from HTML
  assert.ok(result.meta.headings, 'meta.headings should exist')
  assert.strictEqual(result.meta.headings!.length, 4, 'should have 4 headings')

  assert.strictEqual(result.meta.headings![0].level, 1)
  assert.strictEqual(result.meta.headings![0].text, 'Main Title')
  assert.strictEqual(result.meta.headings![0].id, 'main')

  assert.strictEqual(result.meta.headings![1].level, 2)
  assert.strictEqual(result.meta.headings![1].text, 'Section 1')
  assert.strictEqual(result.meta.headings![1].id, 'sec1')

  assert.strictEqual(result.meta.headings![2].level, 3)
  assert.strictEqual(result.meta.headings![2].text, 'Subsection 1.1')
})

test('baseRender should loop over array with Eta in HTML and generate headings', async () => {
  const doc: VirtualDoc = {
    title: 'Eta HTML Loop',
    path: '/eta-html',
    content: `<h1>Main Title</h1>

<% const items = ['meow', 'woof', 'chirp']; %>
<% items.forEach(item => { %>
<h2><%= item %></h2>
<% }) %>`,
  }

  const result = await baseRender({
    doc,
  })

  console.log('HTML output:', result.html)
  console.log('Headings:', result.meta.headings)

  // Verify Eta processed the loop and generated h2 headings
  assert.ok(result.html.includes('<h2 id="meow">meow</h2>'))
  assert.ok(result.html.includes('<h2 id="woof">woof</h2>'))
  assert.ok(result.html.includes('<h2 id="chirp">chirp</h2>'))

  // Verify headings were extracted
  assert.strictEqual(result.meta.headings!.length, 4) // 1 Main Title + 3 generated
  assert.strictEqual(result.meta.headings![1].text, 'meow')
  assert.strictEqual(result.meta.headings![2].text, 'woof')
  assert.strictEqual(result.meta.headings![3].text, 'chirp')
})

test('baseRender should loop over array with Eta in markdown and generate headings', async () => {
  const doc: VirtualDoc = {
    title: 'Eta Markdown Loop',
    path: '/eta-md',
    content: `# Main Title

<% const items = ['meow', 'woof', 'chirp']; %>
<% items.forEach(item => { %>
## <%= item %>
<% }) %>`,
  }

  const result = await baseRender({
    doc,
  })

  // Verify Eta processed the loop and generated markdown headings
  assert.ok(result.html.includes('<h2 id="meow">meow</h2>'))
  assert.ok(result.html.includes('<h2 id="woof">woof</h2>'))
  assert.ok(result.html.includes('<h2 id="chirp">chirp</h2>'))

  // Verify headings were extracted
  assert.strictEqual(result.meta.headings!.length, 4) // 1 Main Title + 3 generated
  assert.strictEqual(result.meta.headings![1].text, 'meow')
  assert.strictEqual(result.meta.headings![2].text, 'woof')
  assert.strictEqual(result.meta.headings![3].text, 'chirp')
})

test('baseRender should execute server function with export default function', async () => {
  const doc: VirtualDoc = {
    title: 'Server Function',
    path: '/server-fn',
    server: `export default function(data) {
      return { message: 'Hello from server', count: 42 };
    }`,
    content: '<h1><%= server.message %></h1><p>Count: <%= server.count %></p>',
  }

  const result = await baseRender({
    doc,
  })

  // Verify server function executed and output is rendered
  assert.ok(result.html.includes('Hello from server'))
  assert.ok(result.html.includes('Count: 42'))
})

test('baseRender should execute server function with arrow function', async () => {
  const doc: VirtualDoc = {
    title: 'Server Arrow',
    path: '/server-arrow',
    server: `export default (data) => {
      return { greeting: 'Hi', value: 100 };
    }`,
    content: '<p><%= server.greeting %> - <%= server.value %></p>',
  }

  const result = await baseRender({
    doc,
  })

  // Verify server arrow function executed
  assert.ok(result.html.includes('Hi - 100'))
})

test('baseRender should execute server function with function body', async () => {
  const doc: VirtualDoc = {
    title: 'Server Body',
    path: '/server-body',
    server: `export default { status: 'ok' };`,
    content: '<p>Status: <%= server.status %></p>',
  }

  const result = await baseRender({
    doc,
  })

  // Verify server function body executed
  assert.ok(result.html.includes('Status: ok'))
})

test('baseRender should handle server function errors gracefully', async () => {
  const doc: VirtualDoc = {
    title: 'Server Error',
    path: '/server-error',
    server: `export default function(data) {
      throw new Error('Server error');
    }`,
    content: '<p><%= server ? server.value : "No server data" %></p>',
  }

  const result = await baseRender({
    doc,
  })

  // Should not throw, server should be null on error
  assert.ok(result.html.includes('No server data'))
})

test('baseRender should use context properties in templates', async () => {
  const doc: VirtualDoc = {
    title: 'Context Test',
    path: '/context',
    content: '<%= customData.user.name %>, <%= customData.user.email %>',
  }

  const result = await baseRender({
    doc,
    context: {
      customData: {
        user: {
          name: 'John Doe',
          email: 'john@example.com',
        },
      },
    },
  })

  // Verify the content was rendered with context values
  assert.ok(result.html.includes('John Doe'), 'Should render name from context')
  assert.ok(result.html.includes('john@example.com'), 'Should render email from context')
})

test('baseRender should return error HTML when Eta template has syntax error', async () => {
  const doc: VirtualDoc = {
    title: 'Template Error',
    path: '/template-error',
    content: '<%= unclosedTag',
  }

  const result = await baseRender({
    doc,
  })

  // Should return error HTML instead of throwing
  assert.ok(result.html.includes('content Error:'), 'Should contain error type')
  assert.ok(
    result.html.includes('color: #d32f2f') || result.html.includes('background: #ffebee'),
    'Should have error styling',
  )
  // The original content should be preserved in markdown
  assert.strictEqual(result.markdown, '<%= unclosedTag')
})

test('baseRender should handle HTML with headings that have no ID and preserve them', async () => {
  const doc: VirtualDoc = {
    title: 'HTML Heading Injection',
    path: '/html-inject',
    // HTML content without IDs that will be processed as HTML (not markdown)
    content: '<!DOCTYPE html><html><body><h1>First</h1><h2>Second</h2><h3>Third</h3></body></html>',
  }

  const result = await baseRender({
    doc,
  })

  // Verify IDs were injected for headings
  assert.ok(result.html.includes('<h1 id="first">First</h1>'), 'h1 should have ID injected')
  assert.ok(result.html.includes('<h2 id="second">Second</h2>'), 'h2 should have ID injected')
  assert.ok(result.html.includes('<h3 id="third">Third</h3>'), 'h3 should have ID injected')

  // Verify headings were extracted
  assert.strictEqual(result.meta.headings?.length, 3)
  assert.strictEqual(result.meta.headings?.[0].text, 'First')
  assert.strictEqual(result.meta.headings?.[1].text, 'Second')
  assert.strictEqual(result.meta.headings?.[2].text, 'Third')
})

test('baseRender should handle document with no content', async () => {
  const doc: VirtualDoc = {
    title: 'Empty Document',
    path: '/empty',
    // No content property
  }

  const result = await baseRender({
    doc,
  })

  // Should return with empty HTML and markdown
  assert.strictEqual(result.title, 'Empty Document')
  assert.strictEqual(result.path, '/empty')
  assert.strictEqual(result.html, '')
  assert.strictEqual(result.markdown, '')
})

test('baseRender should access style href and tag properties', async () => {
  const doc: VirtualDoc = {
    title: 'Style Properties',
    path: '/style-props',
    style: 'body { margin: 0; }',
    content: 'Link: <%= style.tag %>\nHref: <%= style.href %>',
  }

  const result = await baseRender({
    doc,
  })

  // Verify style.tag and style.href were accessed
  assert.ok(result.html.includes(`<link rel="stylesheet" href="${getStylePath(doc)}">`), 'Should include style tag')
  assert.ok(result.html.includes(getStylePath(doc)), 'Should include style href')

  // Verify tracking
  assert.ok(result.variableUsage.style!.tag, 'style.tag should be tracked')
  assert.ok(result.variableUsage.style!.href, 'style.href should be tracked')
})

test('baseRender should access script href and tag properties', async () => {
  const doc: VirtualDoc = {
    title: 'Script Properties',
    path: '/script-props',
    script: 'console.log("test");',
    content: 'Script: <%= script.tag %>\nHref: <%= script.href %>',
  }

  const result = await baseRender({
    doc,
  })

  // Verify script.tag and script.href were accessed
  assert.ok(result.html.includes(`<script src="${getScriptPath(doc)}"></script>`), 'Should include script tag')
  assert.ok(result.html.includes(getScriptPath(doc)), 'Should include script href')

  // Verify tracking
  assert.ok(result.variableUsage.script!.tag, 'script.tag should be tracked')
  assert.ok(result.variableUsage.script!.href, 'script.href should be tracked')
})

test('baseRender should handle second Eta pass error when using meta.toc', async () => {
  const doc: VirtualDoc = {
    title: 'Second Pass Error',
    path: '/second-error',
    // Output literal Eta code in first pass that will be executed in second pass
    // First pass: outputs "<%=" string which becomes template code for second pass
    // Second pass: tries to access invalid property
    content: `# Heading

Documentation about meta.toc navigation.

<%='<' + '%= meta.toc[999].invalid %' + '>'%>`,
  }

  const result = await baseRender({
    doc,
  })

  // Should return error HTML from second pass
  assert.ok(result.html.includes('content Error:'), 'Should contain error type')
  assert.ok(result.html.includes('color: #d32f2f'), 'Should have error styling')
})

test('baseRender should handle script with empty inlineTag when no script', async () => {
  const doc: VirtualDoc = {
    title: 'No Script',
    path: '/no-script',
    // No script property
    content: 'Tag: <%= script.inlineTag %>',
  }

  const result = await baseRender({
    doc,
  })

  // Should return empty string for inlineTag when no script
  assert.ok(result.html.includes('Tag: '), 'Should include empty tag')
  assert.ok(result.variableUsage.script!.inlineTag, 'script.inlineTag should be tracked')
})

test('baseRender should drop function values from context in templates', async () => {
  const doc: VirtualDoc = {
    title: 'Function Tracking',
    path: '/function',
    content: '<%= typeof helpers.format %>',
  }

  const result = await baseRender({
    doc,
    context: {
      helpers: {
        format: (str: string) => str.toUpperCase(),
      },
    },
  })

  // Functions are serialized as marker objects across the sandbox boundary
  // to prevent host-realm prototype chain leakage — they are not callable
  assert.ok(result.html.includes('object'), 'Functions should be serialized as objects, not callable')
})

test('baseRender should track array values in context', async () => {
  const doc: VirtualDoc = {
    title: 'Array Tracking',
    path: '/array',
    content: '<%= items.length %> items: <%= items[0] %>',
  }

  const result = await baseRender({
    doc,
    context: {
      items: ['apple', 'banana', 'cherry'],
    },
  })

  // Arrays should be accessible but not wrapped in proxy
  assert.ok(result.html.includes('3 items'), 'Should access array length')
  assert.ok(result.html.includes('apple'), 'Should access array element')
})

test('baseRender should handle style content property', async () => {
  const doc: VirtualDoc = {
    title: 'Style Content',
    path: '/style-content',
    style: 'h1 { color: red; }',
    content: 'CSS: <%= style.content %>',
  }

  const result = await baseRender({
    doc,
  })

  // Verify style.content was accessed
  assert.ok(result.html.includes('CSS: h1 { color: red; }'), 'Should include style content')
  assert.ok(result.variableUsage.style!.content, 'style.content should be tracked')
})

test('baseRender should handle script content property', async () => {
  const doc: VirtualDoc = {
    title: 'Script Content',
    path: '/script-content',
    script: 'alert("hi");',
    content: 'JS: <%= script.content %>',
  }

  const result = await baseRender({
    doc,
  })

  // Verify script.content was accessed
  assert.ok(result.html.includes('JS: alert("hi");'), 'Should include script content')
  assert.ok(result.variableUsage.script!.content, 'script.content should be tracked')
})

test('baseRender should handle HTML content without headings (no ID injection needed)', async () => {
  const doc: VirtualDoc = {
    title: 'No Headings',
    path: '/no-headings',
    content: '<p>Just a paragraph with no headings.</p>',
  }

  const result = await baseRender({
    doc,
  })

  // Verify content is preserved without modification
  assert.ok(result.html.includes('<p>Just a paragraph with no headings.</p>'), 'Should preserve HTML content')
  assert.strictEqual(result.meta.headings?.length ?? 0, 0, 'Should have no headings')
})

test('baseRender should handle primitive values in context', async () => {
  const doc: VirtualDoc = {
    title: 'Context Primitives',
    path: '/context-primitives',
    content: 'Age: <%= myData.user.age %>, Active: <%= myData.user.active %>',
  }

  const result = await baseRender({
    doc,
    context: {
      myData: {
        user: {
          age: 25,
          active: true,
        },
      },
    },
  })

  // Verify primitive values are rendered correctly
  assert.ok(result.html.includes('Age: 25'), 'Should include age')
  assert.ok(result.html.includes('Active: true'), 'Should include active status')
})

test('baseRender should handle second pass with meta.toc', async () => {
  const doc: VirtualDoc = {
    title: 'TOC Test',
    path: '/toc-test',
    content: `# First Heading

Content here.

## Second Heading

More content.

Documentation: The meta.toc property contains the table of contents.

<% if (meta.toc && meta.toc.length) { %>
TOC has <%= meta.toc.length %> top-level items.
<% } %>`,
  }

  const result = await baseRender({
    doc,
  })

  // Verify second pass happened (literal "meta.toc" text triggers it, and content was processed again)
  assert.ok(result.html.includes('meta.toc property'), 'Should have meta.toc text that triggers second pass')
  assert.ok(result.meta.toc && result.meta.toc.length > 0, 'Should have TOC entries after second pass')
})

test('baseRender should inject heading IDs in non-markdown HTML content', async () => {
  const doc: VirtualDoc = {
    title: 'HTML Headings',
    path: '/html-headings',
    content: `<div>
<h1>Main Title</h1>
<p>Some content</p>
<h2>Subtitle</h2>
</div>`,
  }

  const result = await baseRender({
    doc,
  })

  // Verify heading IDs are injected
  assert.ok(result.html.includes('id="main-title"'), 'Should inject ID for h1')
  assert.ok(result.html.includes('id="subtitle"'), 'Should inject ID for h2')
  assert.ok(result.meta.headings, 'Should have headings')
  assert.strictEqual(result.meta.headings!.length, 2, 'Should have 2 headings')
  assert.strictEqual(result.meta.headings![0].id, 'main-title', 'First heading should have correct ID')
  assert.strictEqual(result.meta.headings![1].id, 'subtitle', 'Second heading should have correct ID')
})

test('baseRender should track nested object access via context', async () => {
  const doc: VirtualDoc = {
    title: 'Nested Object Access',
    path: '/nested-object',
    content: '<%= nested.level1.level2.value %>',
  }

  const result = await baseRender({
    doc,
    context: {
      nested: {
        level1: {
          level2: {
            value: 'Deep Value',
          },
        },
      },
    },
  })

  // Verify nested object property was accessed and rendered
  assert.ok(result.html.includes('Deep Value'), 'Should render deeply nested property')
})

test('baseRender should detect markdown blockquotes with text content', async () => {
  const doc: VirtualDoc = {
    title: 'Blockquote Test',
    path: '/blockquote',
    content: '> This is a blockquote\n> with multiple lines',
  }

  const result = await baseRender({
    doc,
  })

  // Should be treated as markdown and render as blockquote
  assert.ok(result.html.includes('<blockquote>'))
  assert.ok(result.html.includes('This is a blockquote'))
})

test('baseRender should use default empty string for style properties when style is undefined', async () => {
  const doc: VirtualDoc = {
    title: 'No Style',
    path: '/no-style',
    // No style property - testing all OR clause defaults
    content: `
Content: <%= style.content %>
InlineTag: <%= style.inlineTag %>
Tag: <%= style.tag %>
`,
  }

  const result = await baseRender({
    doc,
  })

  // Verify all default values are used
  assert.ok(result.html.includes('Content: '), 'content should default to empty string')
  assert.ok(result.html.includes('InlineTag: '), 'inlineTag should default to empty string')
  assert.ok(result.html.includes('Tag: '), 'tag should default to empty string')

  // Verify tracking
  assert.ok(result.variableUsage.style!.content, 'style.content should be tracked')
  assert.ok(result.variableUsage.style!.inlineTag, 'style.inlineTag should be tracked')
  assert.ok(result.variableUsage.style!.tag, 'style.tag should be tracked')
})

test('baseRender should use default empty string for script properties when script is undefined', async () => {
  const doc: VirtualDoc = {
    title: 'No Script',
    path: '/no-script',
    // No script property - testing all OR clause defaults
    content: `
Content: <%= script.content %>
InlineTag: <%= script.inlineTag %>
Tag: <%= script.tag %>
`,
  }

  const result = await baseRender({
    doc,
  })

  // Verify all default values are used
  assert.ok(result.html.includes('Content: '), 'content should default to empty string')
  assert.ok(result.html.includes('InlineTag: '), 'inlineTag should default to empty string')
  assert.ok(result.html.includes('Tag: '), 'tag should default to empty string')

  // Verify tracking
  assert.ok(result.variableUsage.script!.content, 'script.content should be tracked')
  assert.ok(result.variableUsage.script!.inlineTag, 'script.inlineTag should be tracked')
  assert.ok(result.variableUsage.script!.tag, 'script.tag should be tracked')
})

test('baseRender should render script inlineTag when script is provided', async () => {
  const doc: VirtualDoc = {
    title: 'With Script InlineTag',
    path: '/with-script-inline',
    script: 'console.log("hello");',
    content: 'Script tag: <%= script.inlineTag %>',
  }

  const result = await baseRender({
    doc,
  })

  // Verify inlineTag includes the script wrapped in <script> tags
  assert.ok(
    result.html.includes('Script tag: <script>console.log("hello");</script>'),
    'Should include inline script tag',
  )
  assert.ok(result.variableUsage.script!.inlineTag, 'script.inlineTag should be tracked')
})

test('baseRender should render style inlineTag when style is provided', async () => {
  const doc: VirtualDoc = {
    title: 'With Style InlineTag',
    path: '/with-style-inline',
    style: 'body { margin: 0; }',
    content: 'Style tag: <%= style.inlineTag %>',
  }

  const result = await baseRender({
    doc,
  })

  // Verify inlineTag includes the style wrapped in <style> tags
  assert.ok(result.html.includes('Style tag: <style>body { margin: 0; }</style>'), 'Should include inline style tag')
  assert.ok(result.variableUsage.style!.inlineTag, 'style.inlineTag should be tracked')
})

test('server function should receive processed title in context', async () => {
  const doc: VirtualDoc = {
    title: 'Server Example <%= data.love %>',
    path: '/example',
    data: {love: '💖'},
    content: 'Message: <%= server.message %>',
    server: `export default ({ title }) => {
      return { message: 'Hello World ' + title }
    }`,
  }

  const result = await baseRender({
    doc,
  })

  // The server function should receive the processed title (with <%= data.love %> rendered)
  assert.strictEqual((result.server as Record<string, unknown>).message, 'Hello World Server Example 💖')
  assert.ok(result.html.includes('Message: Hello World Server Example 💖'))
})

test('baseRender should handle non-Error exceptions in first Eta pass', async () => {
  const doc: VirtualDoc = {
    title: 'Non-Error Exception',
    path: '/non-error',
    content: '<%= (() => { throw "string error"; })() %>',
  }

  const result = await baseRender({
    doc,
  })

  // Should return error HTML with Unknown error message since it's not an Error instance
  assert.ok(result.html.includes('content Error:'), 'Should contain error type')
  assert.ok(result.html.includes('Unknown content error'), 'Should show Unknown error message for non-Error exceptions')
})

test('baseRender should handle non-Error exceptions in second Eta pass', async () => {
  const doc: VirtualDoc = {
    title: 'Non-Error Exception Second Pass',
    path: '/non-error-second',
    // Output Eta code in first pass that throws non-Error in second pass
    // First pass: outputs Eta template code as string
    // Second pass: executes the template which throws a string
    content: `# Heading

meta.toc reference

<%='<' + '% throw "string error"; %' + '>'%>`,
  }

  const result = await baseRender({
    doc,
  })

  // Should return error HTML with Unknown error message from second pass
  assert.ok(result.html.includes('content Error:'), 'Should contain error type')
  assert.ok(
    result.html.includes('Unknown content error'),
    'Should show Unknown error message for non-Error exceptions in second pass',
  )
})

test('baseRender should handle server module with named exports (no default export)', async () => {
  const doc: VirtualDoc = {
    title: 'Named Exports',
    path: '/named-exports',
    server: `export const value = 42;
export const name = 'test';`,
    content: '<p>Value: <%= server.value %>, Name: <%= server.name %></p>',
  }

  const result = await baseRender({
    doc,
  })

  // When there's no default export, all exports should be available
  assert.ok(result.html.includes('Value: 42'), 'Should access named export value')
  assert.ok(result.html.includes('Name: test'), 'Should access named export name')
})

test('baseRender should preserve raw blocks as literal Eta syntax', async () => {
  const doc: VirtualDoc = {
    title: 'Raw Block Test',
    path: '/raw-test',
    content: `# Documentation

Real title: <%= title %>

Example: <%raw%><%= slot.html %><%endraw%>`,
  }

  const result = await baseRender({doc})

  // Real Eta tag should be evaluated
  assert.ok(result.html.includes('Real title: Raw Block Test'), 'Real Eta tag should evaluate')
  // Raw block content should appear literally (HTML-escaped by markdown)
  assert.ok(result.html.includes('&lt;%= slot.html %&gt;'), 'Raw block should output literal Eta syntax')
})

test('baseRender should handle raw blocks in code fences', async () => {
  const doc: VirtualDoc = {
    title: 'Code Example',
    path: '/code-example',
    content: `# Code

<%raw%>
\`\`\`html
<h1><%= title %></h1>
<%= server.greeting %>
\`\`\`
<%endraw%>`,
  }

  const result = await baseRender({doc})

  // Code block should contain literal Eta syntax, HTML-escaped inside <code>
  assert.ok(result.html.includes('&lt;%= title %&gt;'), 'Should show literal Eta in code block')
  assert.ok(result.html.includes('&lt;%= server.greeting %&gt;'), 'Should show literal server reference')
})
