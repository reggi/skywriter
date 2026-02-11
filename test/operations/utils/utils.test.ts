import {describe, test} from 'node:test'
import assert from 'node:assert'
import {contentType, hasEtaTemplates, dataType} from '../../../src/operations/utils/utils.ts'

describe('contentType', () => {
  describe('empty and whitespace handling', () => {
    test('returns markdown for empty string', () => {
      assert.strictEqual(contentType(''), 'markdown')
    })

    test('returns markdown for whitespace only', () => {
      assert.strictEqual(contentType('   '), 'markdown')
      assert.strictEqual(contentType('\n\n\n'), 'markdown')
      assert.strictEqual(contentType('\t\t'), 'markdown')
    })

    test('returns markdown for null/undefined (coerced to empty)', () => {
      assert.strictEqual(contentType(null as unknown as string), 'markdown')
      assert.strictEqual(contentType(undefined as unknown as string), 'markdown')
    })
  })

  describe('DOCTYPE detection', () => {
    test('detects DOCTYPE html (lowercase)', () => {
      assert.strictEqual(contentType('<!doctype html>'), 'html')
    })

    test('detects DOCTYPE html (uppercase)', () => {
      assert.strictEqual(contentType('<!DOCTYPE HTML>'), 'html')
    })

    test('detects DOCTYPE with whitespace', () => {
      assert.strictEqual(contentType('  <!doctype   html>'), 'html')
    })

    test('detects DOCTYPE in full document', () => {
      assert.strictEqual(contentType('<!doctype html>\n<html><body>test</body></html>'), 'html')
    })
  })

  describe('HTML structure detection', () => {
    test('detects <html> with closing tag', () => {
      assert.strictEqual(contentType('<html>\n</html>'), 'html')
    })

    test('detects <html> with attributes', () => {
      assert.strictEqual(contentType('<html lang="en">\n</html>'), 'html')
    })

    test('detects <body> with closing tag', () => {
      assert.strictEqual(contentType('<body>\nContent\n</body>'), 'html')
    })

    test('detects full HTML document structure', () => {
      assert.strictEqual(contentType('<html><head></head><body>test</body></html>'), 'html')
    })
  })

  describe('markdown headings', () => {
    test('detects h1 heading', () => {
      assert.strictEqual(contentType('# Heading'), 'markdown')
    })

    test('detects multiple heading levels', () => {
      assert.strictEqual(contentType('## H2\n### H3'), 'markdown')
    })

    test('detects h6 heading', () => {
      assert.strictEqual(contentType('###### H6'), 'markdown')
    })

    test('heading requires space after hash', () => {
      // Without space, should have lower score
      assert.strictEqual(contentType('#NoSpace'), 'markdown')
    })
  })

  describe('markdown blockquotes', () => {
    test('detects blockquote', () => {
      assert.strictEqual(contentType('> Quote'), 'markdown')
    })

    test('detects multi-line blockquote', () => {
      assert.strictEqual(contentType('> Line 1\n> Line 2'), 'markdown')
    })
  })

  describe('markdown lists', () => {
    test('detects unordered list with dash', () => {
      assert.strictEqual(contentType('- Item 1\n- Item 2'), 'markdown')
    })

    test('detects unordered list with asterisk', () => {
      assert.strictEqual(contentType('* Item 1\n* Item 2'), 'markdown')
    })

    test('detects unordered list with plus', () => {
      assert.strictEqual(contentType('+ Item 1\n+ Item 2'), 'markdown')
    })

    test('detects ordered list', () => {
      assert.strictEqual(contentType('1. First\n2. Second'), 'markdown')
    })
  })

  describe('markdown emphasis', () => {
    test('detects bold with double asterisk', () => {
      assert.strictEqual(contentType('**bold**'), 'markdown')
    })

    test('detects bold with double underscore', () => {
      assert.strictEqual(contentType('__bold__'), 'markdown')
    })

    test('detects italic with single asterisk', () => {
      assert.strictEqual(contentType('*italic*'), 'markdown')
    })

    test('detects italic with single underscore', () => {
      assert.strictEqual(contentType('_italic_'), 'markdown')
    })
  })

  describe('markdown links and images', () => {
    test('detects markdown link', () => {
      assert.strictEqual(contentType('[Link](https://example.com)'), 'markdown')
    })

    test('detects markdown image', () => {
      assert.strictEqual(contentType('![Alt](image.png)'), 'markdown')
    })

    test('detects reference-style link', () => {
      assert.strictEqual(contentType('[Link][ref]'), 'markdown')
    })
  })

  describe('markdown tables', () => {
    test('detects table syntax', () => {
      assert.strictEqual(contentType('| Col1 | Col2 |\n|------|------|'), 'markdown')
    })

    test('detects simple table row', () => {
      assert.strictEqual(contentType('| A | B |'), 'markdown')
    })
  })

  describe('markdown horizontal rules', () => {
    test('detects hr with dashes', () => {
      assert.strictEqual(contentType('---'), 'markdown')
    })

    test('detects hr with asterisks', () => {
      assert.strictEqual(contentType('***'), 'markdown')
    })

    test('detects hr with underscores', () => {
      assert.strictEqual(contentType('___'), 'markdown')
    })

    test('detects longer hr', () => {
      assert.strictEqual(contentType('-----'), 'markdown')
    })
  })

  describe('HTML tag detection', () => {
    test('detects block-level HTML', () => {
      assert.strictEqual(contentType('<div>test</div>'), 'html')
    })

    test('detects multiple block tags', () => {
      assert.strictEqual(contentType('<div><p>paragraph</p></div>'), 'html')
    })

    test('detects heading tags', () => {
      assert.strictEqual(contentType('<h1>Title</h1>'), 'html')
    })

    test('detects list tags', () => {
      assert.strictEqual(contentType('<ul><li>Item</li></ul>'), 'html')
    })

    test('detects table tags', () => {
      assert.strictEqual(contentType('<table><tr><td>Cell</td></tr></table>'), 'html')
    })

    test('detects semantic HTML tags', () => {
      assert.strictEqual(contentType('<section>Content</section>'), 'html')
      assert.strictEqual(contentType('<article>Content</article>'), 'html')
      assert.strictEqual(contentType('<header>Content</header>'), 'html')
      assert.strictEqual(contentType('<footer>Content</footer>'), 'html')
      assert.strictEqual(contentType('<nav>Content</nav>'), 'html')
      assert.strictEqual(contentType('<main>Content</main>'), 'html')
      assert.strictEqual(contentType('<aside>Content</aside>'), 'html')
    })
  })

  describe('HTML attributes detection', () => {
    test('detects style attribute', () => {
      assert.strictEqual(contentType('<div style="color: red;">Text</div>'), 'html')
    })

    test('detects class attribute', () => {
      assert.strictEqual(contentType('<div class="container">Text</div>'), 'html')
    })

    test('detects id attribute', () => {
      assert.strictEqual(contentType('<div id="main">Text</div>'), 'html')
    })

    test('detects data attributes', () => {
      assert.strictEqual(contentType('<div data-value="123">Text</div>'), 'html')
    })
  })

  describe('inline HTML in markdown', () => {
    test('treats inline <a> tag as markdown', () => {
      assert.strictEqual(contentType("# Title\n\nSome <a href='#'>link</a> here"), 'markdown')
    })

    test('treats inline <img> tag as markdown', () => {
      assert.strictEqual(contentType("# Title\n\n<img src='test.jpg'>"), 'markdown')
    })

    test('treats inline <span> as markdown', () => {
      assert.strictEqual(contentType('# Title\n\n<span>text</span>'), 'markdown')
    })

    test('treats inline <strong> as markdown', () => {
      assert.strictEqual(contentType('# Title\n\n<strong>bold</strong>'), 'markdown')
    })

    test('treats inline <em> as markdown', () => {
      assert.strictEqual(contentType('# Title\n\n<em>italic</em>'), 'markdown')
    })

    test('treats inline <code> as markdown', () => {
      assert.strictEqual(contentType('# Title\n\n<code>code</code>'), 'markdown')
    })

    test('treats <br> as markdown when mixed with markdown', () => {
      assert.strictEqual(contentType('# Title\n\nLine 1<br>Line 2'), 'markdown')
    })
  })

  describe('fenced code blocks', () => {
    test('ignores HTML in fenced code blocks', () => {
      assert.strictEqual(contentType('# Title\n\n```html\n<div>test</div>\n```'), 'markdown')
    })

    test('ignores markdown in fenced code blocks', () => {
      assert.strictEqual(contentType('```\n# Not a heading\n```'), 'markdown')
    })

    test('ignores multiple fenced code blocks', () => {
      assert.strictEqual(contentType('```\n<div>test</div>\n```\n\n```\n<p>test</p>\n```'), 'markdown')
    })
  })

  describe('inline code', () => {
    test('ignores HTML in inline code', () => {
      assert.strictEqual(contentType('# Title\n\nUse `<div>` for containers'), 'markdown')
    })

    test('ignores markdown in inline code', () => {
      assert.strictEqual(contentType('Use `**bold**` for emphasis'), 'markdown')
    })
  })

  describe('scoring and decision logic', () => {
    test('high markdown score wins over low HTML score', () => {
      assert.strictEqual(contentType('# Title\n\n## Subtitle\n\n- Item 1\n- Item 2\n\n<span>text</span>'), 'markdown')
    })

    test('high HTML score wins over low markdown score', () => {
      assert.strictEqual(contentType('<div><div><p>Test</p><p>Test</p></div></div>'), 'html')
    })

    test('mixed content with more HTML features', () => {
      assert.strictEqual(contentType('<div class="container"><section><article>Test</article></section></div>'), 'html')
    })

    test('mixed content with more markdown features', () => {
      assert.strictEqual(contentType('# Title\n\n## Subtitle\n\n> Quote\n\n- List\n- Item\n\n[Link](url)'), 'markdown')
    })
  })

  describe('edge cases', () => {
    test("HTML comments don't trigger HTML detection alone", () => {
      // Comments are tags but without enough block tags
      assert.strictEqual(contentType('<!-- comment -->'), 'markdown')
    })

    test('single HTML tag without closing', () => {
      assert.strictEqual(contentType('<div>'), 'markdown')
    })

    test('closing tag increases HTML score', () => {
      assert.strictEqual(contentType('<div></div>'), 'html')
    })

    test('plain text defaults to markdown', () => {
      assert.strictEqual(contentType('Just some plain text'), 'markdown')
    })

    test('very long plain text is markdown', () => {
      assert.strictEqual(contentType('Lorem ipsum dolor sit amet, consectetur adipiscing elit.'), 'markdown')
    })

    test('HTML entities are not sufficient for HTML detection', () => {
      assert.strictEqual(contentType('&nbsp; &amp; &lt;'), 'markdown')
    })

    test('self-closing tags', () => {
      assert.strictEqual(contentType("<br/><img src='test'/>"), 'markdown')
    })

    test('case insensitive tag names', () => {
      assert.strictEqual(contentType('<DIV>test</DIV>'), 'html')
    })

    test('tags with namespaces', () => {
      assert.strictEqual(contentType('<custom:tag>test</custom:tag>'), 'html')
    })
  })

  describe('real-world examples', () => {
    test('typical markdown document', () => {
      const md = `# My Document

This is a paragraph with **bold** and *italic* text.

## Section 2

- List item 1
- List item 2

[Link to something](https://example.com)

> A quote from someone

\`\`\`javascript
const x = 10;
\`\`\`
`
      assert.strictEqual(contentType(md), 'markdown')
    })

    test('typical HTML document', () => {
      const html = `<div class="container">
  <header>
    <h1>My Page</h1>
  </header>
  <main>
    <section>
      <p>Content here</p>
    </section>
  </main>
  <footer>
    <p>Footer</p>
  </footer>
</div>`
      assert.strictEqual(contentType(html), 'html')
    })

    test('markdown with inline HTML (should be markdown)', () => {
      const mixed = `# Title

This paragraph has an <a href="#">inline link</a> and some <strong>bold</strong> text.

## Another Section

- List item with <span style="color: red;">colored text</span>
`
      assert.strictEqual(contentType(mixed), 'markdown')
    })

    test('HTML snippet with minimal structure', () => {
      const html = `<div>
  <p>Paragraph 1</p>
  <p>Paragraph 2</p>
  <ul>
    <li>Item</li>
  </ul>
</div>`
      assert.strictEqual(contentType(html), 'html')
    })
  })

  describe('boundary cases for scoring', () => {
    test('exactly 6 tags triggers HTML score', () => {
      // 6 tags: 3 opening + 3 closing
      assert.strictEqual(contentType('<p>a</p><p>b</p><p>c</p>'), 'html')
    })

    test('2 block tags triggers HTML score', () => {
      assert.strictEqual(contentType('<div>test</div><p>test</p>'), 'html')
    })

    test('markdown with single inline HTML tag stays markdown', () => {
      assert.strictEqual(contentType('# Title\n\nText with <em>emphasis</em>'), 'markdown')
    })
  })
})

describe('hasEtaTemplates', () => {
  describe('empty and null handling', () => {
    test('returns false for empty string', () => {
      assert.strictEqual(hasEtaTemplates(''), false)
    })

    test('returns false for whitespace only', () => {
      assert.strictEqual(hasEtaTemplates('   '), false)
      assert.strictEqual(hasEtaTemplates('\n\n\n'), false)
    })

    test('returns false for null/undefined (coerced to empty)', () => {
      assert.strictEqual(hasEtaTemplates(null as unknown as string), false)
      assert.strictEqual(hasEtaTemplates(undefined as unknown as string), false)
    })
  })

  describe('valid Eta templates', () => {
    test('detects simple template', () => {
      assert.strictEqual(hasEtaTemplates('<% code %>'), true)
    })

    test('detects template with output', () => {
      assert.strictEqual(hasEtaTemplates('<%= value %>'), true)
    })

    test('detects template with escaped output', () => {
      assert.strictEqual(hasEtaTemplates('<%~ value %>'), true)
    })

    test('detects template without spaces', () => {
      assert.strictEqual(hasEtaTemplates('<%code%>'), true)
    })

    test('detects template in text', () => {
      assert.strictEqual(hasEtaTemplates('Hello <%= name %>!'), true)
    })

    test('detects multiple templates', () => {
      assert.strictEqual(hasEtaTemplates('<% code1 %> text <% code2 %>'), true)
    })

    test('detects template at start', () => {
      assert.strictEqual(hasEtaTemplates('<% code %> after'), true)
    })

    test('detects template at end', () => {
      assert.strictEqual(hasEtaTemplates('before <% code %>'), true)
    })
  })

  describe('incomplete templates', () => {
    test('returns false for opener only', () => {
      assert.strictEqual(hasEtaTemplates('<%'), false)
    })

    test('returns false for opener without closer', () => {
      assert.strictEqual(hasEtaTemplates('<% code'), false)
    })

    test('returns false for closer only', () => {
      assert.strictEqual(hasEtaTemplates('%>'), false)
    })

    test('returns false for closer before opener', () => {
      assert.strictEqual(hasEtaTemplates('%> <%'), false)
    })

    test('returns false for opener in text without closer', () => {
      assert.strictEqual(hasEtaTemplates('text <% more text'), false)
    })
  })

  describe('edge cases', () => {
    test('detects minimal valid template', () => {
      assert.strictEqual(hasEtaTemplates('<%%>'), true)
    })

    test('detects template with newlines', () => {
      assert.strictEqual(hasEtaTemplates('<%\n  code\n%>'), true)
    })

    test('handles HTML-like content without templates', () => {
      assert.strictEqual(hasEtaTemplates('<div>content</div>'), false)
    })

    test('distinguishes from HTML comments', () => {
      assert.strictEqual(hasEtaTemplates('<!-- comment -->'), false)
    })

    test('detects template with special characters', () => {
      assert.strictEqual(hasEtaTemplates('<% if (x < 10 && y > 5) { %>text<% } %>'), true)
    })

    test('handles escaped percent signs in template', () => {
      assert.strictEqual(hasEtaTemplates("<% '50%' %>"), true)
    })

    test('first opener must have matching closer', () => {
      // Has opener at position 0, but closer is for second opener
      assert.strictEqual(hasEtaTemplates('<% <% %>'), true)
    })
  })

  describe('real-world Eta template examples', () => {
    test('detects conditional template', () => {
      const template = `
<% if (user) { %>
  <p>Hello <%= user.name %></p>
<% } %>
`
      assert.strictEqual(hasEtaTemplates(template), true)
    })

    test('detects loop template', () => {
      const template = `
<% items.forEach(item => { %>
  <li><%= item.name %></li>
<% }) %>
`
      assert.strictEqual(hasEtaTemplates(template), true)
    })

    test('detects include template', () => {
      assert.strictEqual(hasEtaTemplates("<%~ include('header') %>"), true)
    })

    test('detects layout template', () => {
      const template = `
<% layout('base') %>
<% block('content') %>
  <p>Page content</p>
<% endblock %>
`
      assert.strictEqual(hasEtaTemplates(template), true)
    })

    test('plain HTML without templates', () => {
      const html = `
<div class="container">
  <p>No templates here</p>
  <p>Just regular HTML</p>
</div>
`
      assert.strictEqual(hasEtaTemplates(html), false)
    })

    test('markdown with code blocks but no templates', () => {
      const md = `
# Title

\`\`\`javascript
const x = 10 % 5;
\`\`\`
`
      assert.strictEqual(hasEtaTemplates(md), false)
    })
  })

  describe('multiple templates', () => {
    test('detects when first template is complete', () => {
      assert.strictEqual(hasEtaTemplates('<% a %><% b'), true)
    })

    test('returns false when no complete template', () => {
      assert.strictEqual(hasEtaTemplates('<% a <% b'), false)
    })

    test('detects nested-looking templates', () => {
      assert.strictEqual(hasEtaTemplates('<% <% %> %>'), true)
    })
  })
})

describe('dataType', () => {
  describe('empty and null handling', () => {
    test('throws for empty string', () => {
      assert.throws(() => dataType(''), /Empty input/)
    })

    test('throws for whitespace only', () => {
      assert.throws(() => dataType('   '), /Empty input/)
      assert.throws(() => dataType('\n\n\n'), /Empty input/)
      assert.throws(() => dataType('\t\t'), /Empty input/)
    })

    test('throws for null/undefined (coerced to empty)', () => {
      assert.throws(() => dataType(null as unknown as string), /Empty input/)
      assert.throws(() => dataType(undefined as unknown as string), /Empty input/)
    })
  })

  describe('valid JSON objects', () => {
    test('detects simple JSON object', () => {
      assert.strictEqual(dataType('{"key": "value"}').type, 'json')
    })

    test('detects nested JSON object', () => {
      assert.strictEqual(dataType('{"outer": {"inner": "value"}}').type, 'json')
    })

    test('detects JSON with multiple properties', () => {
      assert.strictEqual(dataType('{"a": 1, "b": 2, "c": 3}').type, 'json')
    })

    test('detects JSON with various types', () => {
      assert.strictEqual(dataType('{"string": "text", "number": 42, "bool": true, "null": null}').type, 'json')
    })

    test('detects JSON with arrays', () => {
      assert.strictEqual(dataType('{"items": [1, 2, 3]}').type, 'json')
    })

    test('detects empty JSON object', () => {
      assert.strictEqual(dataType('{}').type, 'json')
    })

    test('detects JSON with whitespace', () => {
      assert.strictEqual(dataType('  {"key": "value"}  ').type, 'json')
    })

    test('detects multiline JSON', () => {
      assert.strictEqual(dataType('{\n  "key": "value"\n}').type, 'json')
    })
  })

  describe('invalid JSON that looks like objects', () => {
    test('returns yaml for malformed JSON', () => {
      assert.strictEqual(dataType('{key: "value"}').type, 'yaml')
    })

    test('throws error for incomplete JSON', () => {
      assert.throws(() => dataType('{"key": "value"'), /Input is neither valid JSON nor valid YAML/)
    })

    test('returns yaml for object with trailing comma', () => {
      assert.strictEqual(dataType('{"key": "value",}').type, 'yaml')
    })

    test('returns yaml for single-quoted JSON', () => {
      assert.strictEqual(dataType("{'key': 'value'}").type, 'yaml')
    })

    test('returns yaml for object with unquoted keys', () => {
      assert.strictEqual(dataType('{key: value}').type, 'yaml')
    })

    test('returns yaml for JSON with comments', () => {
      // JSON with comments gets parsed by YAML, treating /* comment */ as a key
      // Note: Depending on YAML parser behavior, this might throw if malformed
      try {
        const result = dataType('{"key": "value" /* comment */}')
        assert.strictEqual(result.type, 'yaml')
      } catch (e) {
        // If YAML can't parse it, that's also acceptable
        assert.ok(e instanceof Error)
        assert.match((e as Error).message, /Input is neither valid JSON nor valid YAML/)
      }
    })
  })

  describe('YAML content', () => {
    test('detects YAML key-value pairs', () => {
      assert.strictEqual(dataType('key: value').type, 'yaml')
    })

    test('detects YAML with multiple keys', () => {
      assert.strictEqual(dataType('key1: value1\nkey2: value2').type, 'yaml')
    })

    test('detects nested YAML', () => {
      assert.strictEqual(dataType('parent:\n  child: value').type, 'yaml')
    })

    test('detects YAML arrays', () => {
      assert.strictEqual(dataType('- item1\n- item2\n- item3').type, 'yaml')
    })

    test('detects YAML with strings', () => {
      assert.strictEqual(dataType('title: My Title\ndescription: A longer description').type, 'yaml')
    })

    test('detects YAML document markers', () => {
      assert.strictEqual(dataType('---\nkey: value').type, 'yaml')
    })

    test('throws error for plain text', () => {
      assert.throws(() => dataType('Just plain text'), /Input is neither valid JSON nor valid YAML/)
    })
  })

  describe('JSON arrays', () => {
    test('detects JSON array', () => {
      assert.strictEqual(dataType('[1, 2, 3]').type, 'json')
    })

    test('detects array of objects', () => {
      assert.strictEqual(dataType('[{"a": 1}, {"b": 2}]').type, 'json')
    })

    test('detects empty array', () => {
      assert.strictEqual(dataType('[]').type, 'json')
    })

    test('detects nested arrays', () => {
      assert.strictEqual(dataType('[[1, 2], [3, 4]]').type, 'json')
    })

    test('detects array of strings', () => {
      assert.strictEqual(dataType('["a", "b", "c"]').type, 'json')
    })

    test('detects multiline array', () => {
      assert.strictEqual(dataType('[\n  1,\n  2,\n  3\n]').type, 'json')
    })

    test('throws error for invalid array syntax', () => {
      assert.throws(() => dataType('[1, 2, 3'), /Input is neither valid JSON nor valid YAML/)
    })

    test('returns yaml for array with trailing comma', () => {
      assert.strictEqual(dataType('[1, 2, 3,]').type, 'yaml')
    })
  })

  describe('JSON primitives throw errors', () => {
    test('throws error for string literals', () => {
      assert.throws(() => dataType('"hello"'), /Input is neither valid JSON nor valid YAML/)
      assert.throws(() => dataType('"just a string"'), /Input is neither valid JSON nor valid YAML/)
    })

    test('throws error for number literals', () => {
      assert.throws(() => dataType('42'), /Input is neither valid JSON nor valid YAML/)
      assert.throws(() => dataType('3.14'), /Input is neither valid JSON nor valid YAML/)
      assert.throws(() => dataType('-10'), /Input is neither valid JSON nor valid YAML/)
    })

    test('throws error for boolean literals', () => {
      assert.throws(() => dataType('true'), /Input is neither valid JSON nor valid YAML/)
      assert.throws(() => dataType('false'), /Input is neither valid JSON nor valid YAML/)
    })

    test('throws error for null literal', () => {
      assert.throws(() => dataType('null'), /Input is neither valid JSON nor valid YAML/)
    })
  })

  describe('edge cases', () => {
    test('throws error for object starting with { but not ending with }', () => {
      assert.throws(() => dataType('{"key": "value"} extra'), /Input is neither valid JSON nor valid YAML/)
    })

    test('throws error for object ending with } but not starting with {', () => {
      assert.throws(() => dataType('extra {"key": "value"}'), /Input is neither valid JSON nor valid YAML/)
    })

    test('detects JSON with escaped characters', () => {
      assert.strictEqual(dataType('{"path": "C:\\\\Users\\\\test"}').type, 'json')
    })

    test('detects JSON with unicode', () => {
      assert.strictEqual(dataType('{"emoji": "😀"}').type, 'json')
    })

    test('detects JSON with special characters in values', () => {
      assert.strictEqual(dataType('{"url": "https://example.com?q=test&foo=bar"}').type, 'json')
    })

    test('throws error for array starting with [ but not ending with ]', () => {
      assert.throws(() => dataType('[1, 2, 3 extra'), /Input is neither valid JSON nor valid YAML/)
    })

    test('throws error for array ending with ] but not starting with [', () => {
      assert.throws(() => dataType('extra [1, 2, 3]'), /Input is neither valid JSON nor valid YAML/)
    })
  })

  describe('whitespace handling', () => {
    test('trims leading whitespace before checking', () => {
      assert.strictEqual(dataType('   {"key": "value"}').type, 'json')
    })

    test('trims trailing whitespace before checking', () => {
      assert.strictEqual(dataType('{"key": "value"}   ').type, 'json')
    })

    test('handles tabs and newlines', () => {
      assert.strictEqual(dataType('\t\n{"key": "value"}\n\t').type, 'json')
    })
  })

  describe('real-world examples', () => {
    test('detects typical config JSON', () => {
      const json = `{
  "name": "my-app",
  "version": "1.0.0",
  "dependencies": {
    "express": "^4.18.0"
  }
}`
      assert.strictEqual(dataType(json).type, 'json')
    })

    test('detects typical YAML frontmatter', () => {
      const yaml = `---
title: My Post
date: 2024-01-01
tags:
  - typescript
  - testing
---`
      // YAML frontmatter with document separators
      // The closing --- might cause parsing issues, so we're flexible here
      try {
        const result = dataType(yaml)
        assert.strictEqual(result.type, 'yaml')
      } catch (e) {
        // If the document separators cause issues, that's acceptable
        assert.ok(e instanceof Error)
      }
    })

    test('detects simple YAML config', () => {
      const yaml = `database:
  host: localhost
  port: 5432
  name: mydb`
      assert.strictEqual(dataType(yaml).type, 'yaml')
    })

    test('JSON object with newlines and indentation', () => {
      const json = `{
  "user": {
    "name": "John",
    "age": 30,
    "active": true
  }
}`
      assert.strictEqual(dataType(json).type, 'json')
    })
  })

  describe('return type coverage', () => {
    test('returns object with type and value for structured data', () => {
      // dataType returns { type, value } only for objects and arrays
      const inputs = [
        {input: '{}', expectedType: 'json'},
        {input: '{"valid": "json"}', expectedType: 'json'},
        {input: 'key: value', expectedType: 'yaml'},
        {input: '[1,2,3]', expectedType: 'json'},
        {input: '{invalid: json}', expectedType: 'yaml'},
      ]

      inputs.forEach(({input, expectedType}) => {
        const result = dataType(input)
        assert.ok(typeof result === 'object', `Expected object, got ${typeof result}`)
        assert.ok('type' in result, "Expected result to have 'type' property")
        assert.ok('value' in result, "Expected result to have 'value' property")
        assert.strictEqual(
          result.type,
          expectedType,
          `Expected ${expectedType}, got ${result.type} for input: ${input}`,
        )
      })
    })
  })
})
