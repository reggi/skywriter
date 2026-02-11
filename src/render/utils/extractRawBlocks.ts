/**
 * Extracts <%raw%>...<%endraw%> blocks from content, replacing them with
 * unique placeholders. Returns the modified content and a restore function
 * that swaps placeholders back with the original inner content.
 */
export function extractRawBlocks(content: string): {
  content: string
  restore: (rendered: string) => string
} {
  const placeholders = new Map<string, string>()
  let counter = 0

  const processed = content.replace(/<%raw%>([\s\S]*?)<%endraw%>/g, (_match, inner: string) => {
    const id = `\x00RAWBLOCK${counter++}\x00`
    placeholders.set(id, inner)
    return id
  })

  if (placeholders.size === 0) {
    return {content, restore: (r: string) => r}
  }

  return {
    content: processed,
    restore: (rendered: string) => {
      let result = rendered
      for (const [id, original] of placeholders) {
        result = result.split(id).join(original)
      }
      return result
    },
  }
}
