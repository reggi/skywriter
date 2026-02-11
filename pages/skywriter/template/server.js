// Server-side JavaScript

function asciiBox(text, x, y) {
  const lines = String(text ?? '').split('\n')
  const maxLen = lines.reduce((m, l) => Math.max(m, l.length), 0)
  const top = '+' + '-'.repeat(maxLen + 2) + '+'
  const body = lines.map(l => '| ' + l.padEnd(maxLen, ' ') + ' |').join('\n')
  const box = top + '\n' + body + '\n' + top
  const hasPos = Number.isFinite(x) || Number.isFinite(y)
  const left = Number.isFinite(x) ? x : 0
  const topPx = Number.isFinite(y) ? y : 0
  const base = [
    `background:#000`,
    `color:#fff`,
    `margin:0`,
    `padding:6px`,
    `line-height:1.1`,
    `white-space:pre`,
    `font-family:ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`,
  ]
  if (hasPos) {
    base.unshift(`position:absolute`, `left:${left}px`, `top:${topPx}px`, `z-index:1000`)
  }
  return `<pre class="ascii-box-html" style="${base.join(';')}">${box}</pre>`
}

export default {asciiBox}
