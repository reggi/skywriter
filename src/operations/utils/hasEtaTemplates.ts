export function hasEtaTemplates(text: string): boolean {
  const s = text ?? ''

  // Strip <%raw%>...<%endraw%> blocks — these are escape directives,
  // not actual eta template usage.
  const stripped = s.replace(/<%\s*raw\s*%>[\s\S]*?<%\s*endraw\s*%>/g, '')

  const open = stripped.indexOf('<%')
  if (open === -1) return false

  // Ensure at least one closer exists after an opener.
  // (If someone has a literal "<%" with no "%>", this returns false.)
  return stripped.indexOf('%>', open + 2) !== -1
}
