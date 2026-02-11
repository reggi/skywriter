import {test} from 'node:test'
import assert from 'node:assert'
import {extractRawBlocks} from '../../../src/render/utils/extractRawBlocks.ts'

test('extractRawBlocks returns content unchanged when no raw blocks exist', () => {
  const content = 'Hello <%= title %> world'
  const result = extractRawBlocks(content)
  assert.strictEqual(result.content, content)
  assert.strictEqual(result.restore('rendered'), 'rendered')
})

test('extractRawBlocks replaces a single raw block with a placeholder', () => {
  const content = 'before <%raw%><%= slot.html %><%endraw%> after'
  const result = extractRawBlocks(content)

  // Placeholder should not contain Eta tags
  assert.ok(!result.content.includes('<%='))
  assert.ok(!result.content.includes('slot.html'))
  assert.ok(result.content.startsWith('before '))
  assert.ok(result.content.endsWith(' after'))

  // Restore should bring back the original inner content
  const restored = result.restore(result.content)
  assert.strictEqual(restored, 'before <%= slot.html %> after')
})

test('extractRawBlocks handles multiple raw blocks', () => {
  const content = '<%raw%><%= a %><%endraw%> middle <%raw%><%= b %><%endraw%>'
  const result = extractRawBlocks(content)

  assert.ok(!result.content.includes('<%='))
  const restored = result.restore(result.content)
  assert.strictEqual(restored, '<%= a %> middle <%= b %>')
})

test('extractRawBlocks handles multiline raw blocks', () => {
  const content = `<%raw%>
<%= slot.html %>
<%= slot.title %>
<%endraw%>`
  const result = extractRawBlocks(content)

  assert.ok(!result.content.includes('<%='))
  const restored = result.restore(result.content)
  assert.strictEqual(
    restored,
    `
<%= slot.html %>
<%= slot.title %>
`,
  )
})

test('extractRawBlocks restore works after content transformation', () => {
  const content = 'prefix <%raw%><%= literal %><%endraw%> suffix'
  const result = extractRawBlocks(content)

  // Simulate Eta processing (prefix/suffix unchanged, placeholder passes through)
  const transformed = result.content.replace('prefix', 'PROCESSED')
  const restored = result.restore(transformed)
  assert.strictEqual(restored, 'PROCESSED <%= literal %> suffix')
})

test('extractRawBlocks preserves Eta tags outside raw blocks', () => {
  const content = '<%= title %> <%raw%><%= slot.html %><%endraw%> <%= path %>'
  const result = extractRawBlocks(content)

  // Eta tags outside raw blocks should remain
  assert.ok(result.content.includes('<%= title %>'))
  assert.ok(result.content.includes('<%= path %>'))
  // Eta tag inside raw block should be replaced
  assert.ok(!result.content.includes('slot.html'))
})
