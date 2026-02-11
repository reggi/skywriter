/**
 * Generate copilot-instructions.md content with dynamic CLI name
 */
export function copilotInstructions(cliName: string): string {
  return `\`\`\`\`instructions
## System Overview

This workspace uses a folder-based template structure for generating HTML documents.

## Key Rules

1. **ETA Templating**: All files use ETA syntax (e.g., \`<%= variable %>\`)
2. **Single Content File**: Only one \`content.*\` file per folder, any extension allowed
3. **Default Extensions**: \`.md\`, \`.html\`, \`.eta\` are treated as HTML for rendering
4. **Custom Extensions**: For non-HTML extensions (e.g., \`content.csv\`), update \`settings.json\` mime type. ETA templating will not work on non-HTML types.
5. **Auto-Injection**: \`style.css\` and \`script.js\` are automatically injected when not explicitly authored. Do not reference them in content files.

## Available ETA Variables

All variables accessible in templates via \`<%= variableName %>\`:

\`\`\`
html
markdown
meta.createdAt
meta.headings.[].id
meta.headings.[].level
meta.headings.[].text
meta.toc.[].children.[].id
meta.toc.[].children.[].level
meta.toc.[].children.[].text
meta.toc.[].id
meta.toc.[].level
meta.toc.[].text
meta.updatedAt
path
script.content
script.href
script.inlineTag
script.tag
slot.html
slot.markdown
slot.meta.createdAt
slot.meta.headings.[].id
slot.meta.headings.[].level
slot.meta.headings.[].text
slot.meta.toc.[].children.[].id
slot.meta.toc.[].children.[].level
slot.meta.toc.[].children.[].text
slot.meta.toc.[].id
slot.meta.toc.[].level
slot.meta.toc.[].text
slot.meta.updatedAt
slot.path
slot.script.content
slot.script.href
slot.script.inlineTag
slot.script.tag
slot.style.content
slot.style.href
slot.style.inlineTag
slot.style.tag
slot.title
style.content
style.href
style.inlineTag
style.tag
title
variableUsage.path
variableUsage.slot.html
\`\`\`

## Special Variables

### \`data\`

- Source: \`data.yaml\` or \`data.json\` file in document folder
- Type: Full JSON object representation
- Usage: \`<%= data.propertyName %>\`

### \`server\`

- Source: Exports from \`server.js\` (ES module)
- Type: Default export value, or return value if default export is a function
- When default export is a function (sync or async): Function is invoked with same variables as \`${cliName} render\` command, and \`server\` equals the resolved return value
- Usage: \`<%= server %>\` or \`<%= server.property %>\`

## Debugging Commands

\`\`\`bash
# View all variable values
${cliName} render

# Extract variable keys only
${cliName} render | jq -r '[paths(scalars)] | map([.[] | if type == "number" then "[]" else . end] | join(".") | gsub("\\\\.\\\\[\\\\]\\\\."; ".[].") | gsub("\\\\.\\\\[\\\\]$"; "[]")) | unique | .[]'
\`\`\`

\`\`\`\`
`
}
