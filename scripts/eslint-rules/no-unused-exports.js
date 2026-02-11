/**
 * Custom ESLint rule: no-unused-exports
 *
 * This rule detects exports that are not imported anywhere in the codebase.
 * Unlike import-x/no-unused-modules, this rule properly tracks:
 * - Re-exports via barrel files (export { X } from './file' or export * from './file')
 * - Dynamic imports
 * - Transitive imports from entry points
 *
 * Configuration:
 *   entryPoints: Array of glob patterns for entry point files (these are always considered "used")
 *   src: Glob pattern for source files to analyze
 */

import {readFileSync, existsSync} from 'node:fs'
import {dirname, join, resolve} from 'node:path'
import {globSync} from 'glob'
import ts from 'typescript'

/** @type {Map<string, Set<string>>} - Maps file path to set of exported names */
const fileExports = new Map()

/** @type {Map<string, Set<string>>} - Maps file path to set of imported names (with source file) */
const fileImports = new Map()

/** @type {Map<string, Array<{from: string, names: string[] | '*'}>>} - Re-exports tracking */
const fileReExports = new Map()

/** @type {Set<string>} - Entry point files (considered used) */
const entryPointFiles = new Set()

/** @type {Set<string>} - Files reachable from entry points (imports, transitive) */
const reachableFiles = new Set()

/** @type {boolean} - Whether the graph has been built */
let graphBuilt = false

/** @type {string | null} - Root directory for the project */
let projectRoot = null

/**
 * Resolve a module specifier to an absolute file path
 */
function resolveModulePath(specifier, fromFile) {
  const fromDir = dirname(fromFile)

  // Handle relative imports
  if (specifier.startsWith('.')) {
    let resolved = resolve(fromDir, specifier)

    // If specifier already has a recognized extension, use it directly
    if (
      specifier.endsWith('.ts') ||
      specifier.endsWith('.tsx') ||
      specifier.endsWith('.js') ||
      specifier.endsWith('.jsx')
    ) {
      if (existsSync(resolved)) {
        return resolved
      }
      // TypeScript projects often use .js extension in imports but have .ts source files
      // Try swapping .js -> .ts and .jsx -> .tsx
      if (specifier.endsWith('.js')) {
        const tsResolved = resolved.slice(0, -3) + '.ts'
        if (existsSync(tsResolved)) {
          return tsResolved
        }
      } else if (specifier.endsWith('.jsx')) {
        const tsxResolved = resolved.slice(0, -4) + '.tsx'
        if (existsSync(tsxResolved)) {
          return tsxResolved
        }
      }
      return null
    }

    // Try with common extensions
    const extensions = ['.ts', '.tsx', '.js', '.jsx', '']
    for (const ext of extensions) {
      const withExt = resolved + ext
      if (existsSync(withExt)) {
        return withExt
      }
      // Also try index files
      const indexPath = join(resolved, `index${ext}`)
      if (existsSync(indexPath)) {
        return indexPath
      }
    }
    return resolved
  }

  // Node modules or aliases - skip
  return null
}

/**
 * Parse a TypeScript/JavaScript file and extract exports/imports
 */
function parseFile(filePath) {
  if (fileExports.has(filePath)) return

  const exports = new Set()
  const imports = new Set()
  const reExports = []

  try {
    const content = readFileSync(filePath, 'utf-8')
    const sourceFile = ts.createSourceFile(filePath, content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)

    function visit(node) {
      // Track exports
      if (ts.isExportDeclaration(node)) {
        if (node.moduleSpecifier) {
          // Re-export: export { X } from './file' or export * from './file'
          const from = node.moduleSpecifier.text
          const resolvedFrom = resolveModulePath(from, filePath)

          if (node.exportClause && ts.isNamedExports(node.exportClause)) {
            const names = node.exportClause.elements.map(e => (e.propertyName || e.name).text)
            if (resolvedFrom) {
              reExports.push({from: resolvedFrom, names})
            }
            // Also track as exports from this file
            node.exportClause.elements.forEach(e => exports.add(e.name.text))
          } else {
            // export * from './file'
            if (resolvedFrom) {
              reExports.push({from: resolvedFrom, names: '*'})
            }
          }
        } else if (node.exportClause && ts.isNamedExports(node.exportClause)) {
          // export { X, Y }
          node.exportClause.elements.forEach(e => exports.add(e.name.text))
        }
      }

      // export default
      if (node.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword)) {
        if (ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) {
          if (node.name) {
            exports.add(node.name.text)
          }
          if (node.modifiers?.some(m => m.kind === ts.SyntaxKind.DefaultKeyword)) {
            exports.add('default')
          }
        } else if (ts.isVariableStatement(node)) {
          node.declarationList.declarations.forEach(decl => {
            if (ts.isIdentifier(decl.name)) {
              exports.add(decl.name.text)
            }
          })
        } else if (ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node) || ts.isEnumDeclaration(node)) {
          if (node.name) {
            exports.add(node.name.text)
          }
        }
      }

      // Track imports
      if (ts.isImportDeclaration(node) && node.moduleSpecifier) {
        const from = node.moduleSpecifier.text
        const resolvedFrom = resolveModulePath(from, filePath)

        if (resolvedFrom && node.importClause) {
          if (node.importClause.name) {
            // import X from './file'
            imports.add(`${resolvedFrom}:default`)
          }
          if (node.importClause.namedBindings) {
            if (ts.isNamedImports(node.importClause.namedBindings)) {
              // import { X, Y } from './file'
              node.importClause.namedBindings.elements.forEach(e => {
                const importedName = (e.propertyName || e.name).text
                imports.add(`${resolvedFrom}:${importedName}`)
              })
            } else if (ts.isNamespaceImport(node.importClause.namedBindings)) {
              // import * as X from './file'
              imports.add(`${resolvedFrom}:*`)
            }
          }
        }
      }

      // Dynamic imports: import('./file')
      if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        if (node.arguments.length > 0 && ts.isStringLiteral(node.arguments[0])) {
          const from = node.arguments[0].text
          const resolvedFrom = resolveModulePath(from, filePath)
          if (resolvedFrom) {
            imports.add(`${resolvedFrom}:*`)
          }
        }
      }

      ts.forEachChild(node, visit)
    }

    ts.forEachChild(sourceFile, visit)
  } catch {
    // Ignore parse errors
  }

  fileExports.set(filePath, exports)
  fileImports.set(filePath, imports)
  fileReExports.set(filePath, reExports)
}

/**
 * Build the complete dependency graph
 */
function buildGraph(options, cwd) {
  if (graphBuilt) return

  projectRoot = cwd
  const srcPatterns = options.src || ['src/**/*.ts']
  const entryPatterns = options.entryPoints || [
    'src/cli/index.ts',
    'src/cli/commands/*.ts',
    'src/cli/program.ts',
    'src/server/index.ts',
    'src/editor/*.ts',
    'src/html/*.ts',
  ]

  // Find all source files
  const allFiles = new Set()
  for (const pattern of srcPatterns) {
    const files = globSync(pattern, {cwd, absolute: true})
    files.forEach(f => allFiles.add(f))
  }

  // Find entry points
  for (const pattern of entryPatterns) {
    const files = globSync(pattern, {cwd, absolute: true})
    files.forEach(f => entryPointFiles.add(f))
  }

  // Parse all files
  for (const file of allFiles) {
    parseFile(file)
  }

  // Build reachable files set (files transitively imported from entry points)
  const visited = new Set()
  function markReachable(file) {
    if (visited.has(file)) return
    visited.add(file)
    reachableFiles.add(file)

    // Follow imports from this file
    const imports = fileImports.get(file) || new Set()
    for (const importKey of imports) {
      const importedFile = importKey.split(':')[0]
      markReachable(importedFile)
    }

    // Follow re-exports from this file
    const reExports = fileReExports.get(file) || []
    for (const reExport of reExports) {
      markReachable(reExport.from)
    }
  }

  // Start from entry points
  for (const entryPoint of entryPointFiles) {
    markReachable(entryPoint)
  }

  graphBuilt = true
}

/**
 * Check if a file is reachable from entry points
 */
function isFileReachable(filePath) {
  return reachableFiles.has(filePath) || entryPointFiles.has(filePath)
}

/**
 * Determine if an export from a file is used anywhere by a reachable file
 */
function isExportUsed(filePath, exportName, visited = new Set()) {
  // Prevent infinite recursion
  const key = `${filePath}:${exportName}`
  if (visited.has(key)) return false
  visited.add(key)

  // Entry points are always considered used
  if (entryPointFiles.has(filePath)) {
    return true
  }

  // Check if any reachable file imports this export directly
  for (const [importerPath, imports] of fileImports) {
    if (!isFileReachable(importerPath)) continue
    if (imports.has(`${filePath}:${exportName}`) || imports.has(`${filePath}:*`)) {
      return true
    }
  }

  // Check if this is a re-export and the original export is used
  const reExports = fileReExports.get(filePath) || []
  for (const reExport of reExports) {
    if (reExport.names === '*' || reExport.names.includes(exportName)) {
      // This file re-exports from another file - check if that original export is used
      if (isExportUsed(reExport.from, exportName, visited)) {
        return true
      }
    }
  }

  // Check if any reachable file re-exports this (and the re-export is used)
  for (const [reExporterPath, reExports] of fileReExports) {
    if (!isFileReachable(reExporterPath)) continue
    for (const reExport of reExports) {
      if (reExport.from === filePath) {
        if (reExport.names === '*' || reExport.names.includes(exportName)) {
          // This file re-exports our export - check if the re-export is used
          if (isExportUsed(reExporterPath, exportName, visited)) {
            return true
          }
        }
      }
    }
  }

  return false
}

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: 'suggestion',
    docs: {
      description: 'Disallow unused exports',
      recommended: false,
    },
    schema: [
      {
        type: 'object',
        properties: {
          src: {
            type: 'array',
            items: {type: 'string'},
          },
          entryPoints: {
            type: 'array',
            items: {type: 'string'},
          },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      unusedExport: "Exported '{{name}}' is not used in any other module",
    },
  },

  create(context) {
    const options = context.options[0] || {}
    const filename = context.filename || context.getFilename()
    const cwd = context.cwd || context.getCwd?.() || process.cwd()

    // Build the graph on first invocation
    buildGraph(options, cwd)

    // Skip entry points
    if (entryPointFiles.has(filename)) {
      return {}
    }

    const exports = fileExports.get(filename) || new Set()

    return {
      'Program:exit'(node) {
        for (const exportName of exports) {
          if (!isExportUsed(filename, exportName)) {
            // Find the export declaration to report on
            const sourceCode = context.sourceCode || context.getSourceCode()
            for (const statement of node.body) {
              let name = null

              if (statement.type === 'ExportNamedDeclaration') {
                if (statement.declaration) {
                  if (statement.declaration.id) {
                    name = statement.declaration.id.name
                  } else if (statement.declaration.declarations) {
                    for (const decl of statement.declaration.declarations) {
                      if (decl.id.name === exportName) {
                        name = exportName
                        break
                      }
                    }
                  }
                } else if (statement.specifiers) {
                  for (const spec of statement.specifiers) {
                    if (spec.exported.name === exportName) {
                      name = exportName
                      break
                    }
                  }
                }
              }

              if (name === exportName) {
                context.report({
                  node: statement,
                  messageId: 'unusedExport',
                  data: {name: exportName},
                })
                break
              }
            }
          }
        }
      },
    }
  },
}

// Reset function for testing
export function resetGraph() {
  fileExports.clear()
  fileImports.clear()
  fileReExports.clear()
  entryPointFiles.clear()
  reachableFiles.clear()
  graphBuilt = false
  projectRoot = null
}
