import {describe, test} from 'node:test'
import assert from 'node:assert'
import {hasEtaTemplates} from '../../../src/operations/utils/utils.ts'

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

  describe('raw blocks', () => {
    test('returns false when only raw/endraw blocks exist', () => {
      assert.strictEqual(hasEtaTemplates('<%raw%>some content<%endraw%>'), false)
    })

    test('returns false for raw blocks with spaces', () => {
      assert.strictEqual(hasEtaTemplates('<% raw %>some content<% endraw %>'), false)
    })

    test('returns false for multiple raw blocks only', () => {
      assert.strictEqual(hasEtaTemplates('text <%raw%>block1<%endraw%> middle <%raw%>block2<%endraw%> end'), false)
    })

    test('returns true when eta templates exist outside raw blocks', () => {
      assert.strictEqual(hasEtaTemplates('<%raw%>protected<%endraw%> <%= value %>'), true)
    })

    test('returns true when eta templates exist before raw blocks', () => {
      assert.strictEqual(hasEtaTemplates('<%= value %> <%raw%>protected<%endraw%>'), true)
    })

    test('ignores eta-like content inside raw blocks', () => {
      assert.strictEqual(hasEtaTemplates('<%raw%><%= should.be.ignored %><%endraw%>'), false)
    })
  })
})
