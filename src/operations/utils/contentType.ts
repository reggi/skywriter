export function contentType(text: string): 'markdown' | 'html' {
  const s = (text ?? '').trim()
  if (!s) return 'markdown'

  // If it looks like a full HTML document, call it immediately.
  if (/^\s*<!doctype\s+html\b/i.test(s)) return 'html'
  if (/<html\b[\s>]/i.test(s) && /<\/html>/i.test(s)) return 'html'
  if (/<body\b[\s>]/i.test(s) && /<\/body>/i.test(s)) return 'html'

  // Strip fenced code blocks + inline code so HTML-looking code doesn't mislead.
  const withoutFences = s.replace(/```[\s\S]*?```/g, '')
  const withoutInlineCode = withoutFences.replace(/`[^`]*`/g, '')

  // --- Markdown signals ---
  let mdScore = 0
  if (/(^|\n)#{1,6}\s+\S/.test(withoutInlineCode)) mdScore += 3 // headings
  if (/(^|\n)>\s+\S/.test(withoutInlineCode)) mdScore += 2 // blockquote
  if (/(^|\n)(-|\*|\+)\s+\S/.test(withoutInlineCode)) mdScore += 2 // ul
  if (/(^|\n)\d+\.\s+\S/.test(withoutInlineCode)) mdScore += 2 // ol
  if (/(^|\n)(\*\*|__)\S/.test(withoutInlineCode)) mdScore += 1 // bold-ish
  if (/(^|\n)(\*|_)\S/.test(withoutInlineCode)) mdScore += 1 // italic-ish
  if (/\[[^\]]+\]\([^)]+\)/.test(withoutInlineCode)) mdScore += 2 // md link
  if (/!\[[^\]]*\]\([^)]+\)/.test(withoutInlineCode)) mdScore += 2 // md image
  if (/(\n|^)\|.+\|\s*(\n|$)/.test(withoutInlineCode)) mdScore += 1 // tables-ish
  if (/(\n|^)(-{3,}|\*{3,}|_{3,})(\n|$)/.test(withoutInlineCode)) mdScore += 1 // hr

  // --- HTML signals ---
  let htmlScore = 0

  // Count tags that look real (paired or self-closing), and specifically block tags.
  const tagMatches = withoutInlineCode.match(/<\/?[a-z][a-z0-9:-]*\b[^>]*>/gi) ?? []
  const tagCount = tagMatches.length
  const blockTagRe =
    /<\/?(div|p|h[1-6]|ul|ol|li|table|thead|tbody|tr|td|th|section|article|header|footer|nav|main|aside|blockquote|pre|code)\b/i

  const blockTagCount = tagMatches.filter(t => blockTagRe.test(t)).length
  if (tagCount >= 6) htmlScore += 2
  if (blockTagCount >= 2) htmlScore += 3
  if (/<\/[a-z][a-z0-9:-]*\s*>/i.test(withoutInlineCode)) htmlScore += 2 // has closing tags
  if (/style\s*=|class\s*=|id\s*=|data-/.test(withoutInlineCode)) htmlScore += 1 // html-y attrs

  // If HTML tags are only "inline-ish allowlist", treat as still Markdown.
  const inlineAllow = new Set(['a', 'img', 'br', 'span', 'strong', 'em', 'code', 'kbd', 'sup', 'sub'])

  const tagNames = tagMatches
    .map(t => (t.match(/^<\/?\s*([a-z][a-z0-9:-]*)/i)?.[1] ?? '').toLowerCase())
    .filter(Boolean)

  const hasDisallowedTag = tagNames.some(name => !inlineAllow.has(name))
  const hasAnyTag = tagNames.length > 0

  // Decision:
  // - If there are tags beyond the inline allowlist and HTML score wins -> HTML
  // - Otherwise default to Markdown (Markdown-with-some-HTML is allowed)
  if (hasAnyTag && hasDisallowedTag && htmlScore > mdScore) return 'html'
  return 'markdown'
}
