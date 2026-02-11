export function hasEtaTemplates(text: string): boolean {
  const s = text ?? ''
  const open = s.indexOf('<%')
  if (open === -1) return false

  // Ensure at least one closer exists after an opener.
  // (If someone has a literal "<%" with no "%>", this returns false.)
  return s.indexOf('%>', open + 2) !== -1
}
