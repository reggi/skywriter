/**
 * Shared formatting utilities for CLI output
 * Used by fetch, pull, push, and update commands for consistent output
 */

import {bold, cyan, dim, green, red, yellow, gray} from './colors.ts'
import log from './log.ts'

export interface FileItem {
  file: string
  status: 'new' | 'modified' | 'unchanged' | 'synced' | 'add' | 'remove' | 'ignored' | 'included'
}

export interface DocumentPlan {
  label: string
  url: string
  archiveInfo?: string // e.g. "3.1 KB (a24147f1e6a5)"
  files: FileItem[]
  isCreate?: boolean
  extraInfo?: string[] // Additional info lines to display (e.g. settings changes)
}

/**
 * Format a success message with green checkmark
 */
export function formatSuccess(message: string): string {
  return `${green('✓')} ${message}`
}

/**
 * Format a warning message with yellow warning icon
 */
export function formatWarning(message: string): string {
  return `${yellow('⚠️')}  ${message}`
}

/**
 * Build document header lines (shared between printDocumentHeader and formatDocumentPlan)
 */
function buildDocumentHeaderLines(label: string, url: string, info?: string): string[] {
  const lines: string[] = []
  lines.push(bold(label))
  lines.push(dim(url))
  if (info) {
    lines.push(dim(info))
  }
  return lines
}

/**
 * Get colored symbol for file status
 */
function getStatusSymbol(status: FileItem['status']): string {
  switch (status) {
    case 'new':
      return green('+')
    case 'modified':
      return yellow('~')
    case 'unchanged':
    case 'synced':
    case 'included':
      return green('✓')
    case 'add':
      return cyan('↑')
    case 'remove':
      return red('↓')
    case 'ignored':
      return gray('✗')
    default:
      return ' '
  }
}

/**
 * Get label for file status (used in parentheses)
 */
function getStatusLabel(status: FileItem['status']): string | null {
  switch (status) {
    case 'new':
      return 'new'
    case 'modified':
      return 'modified'
    case 'synced':
      return 'synced'
    case 'add':
      return 'new'
    case 'remove':
      return 'remove'
    case 'ignored':
      return 'ignored'
    case 'included':
    case 'unchanged':
    default:
      return null
  }
}

interface FormatPlanOptions {
  /** Show individual files or just summaries */
  showAllFiles?: boolean
  /** Files to hide from display (e.g. .DS_Store, .git) */
  hiddenFiles?: string[]
}

/**
 * Format a single document plan for display
 */
export function formatDocumentPlan(plan: DocumentPlan, options: FormatPlanOptions = {}): string {
  const lines: string[] = []
  const {showAllFiles = false, hiddenFiles = []} = options

  // Header: Label and URL (using shared builder)
  const archiveInfo = plan.archiveInfo ? `Archive: ${plan.archiveInfo}` : undefined
  lines.push('')
  lines.push(...buildDocumentHeaderLines(plan.label, plan.url, archiveInfo))

  // Filter out hidden files
  const visibleFiles = plan.files.filter(f => !hiddenFiles.includes(f.file))

  // Group files by status
  const newFiles = visibleFiles.filter(f => f.status === 'new' || f.status === 'add')
  const modifiedFiles = visibleFiles.filter(f => f.status === 'modified')
  const unchangedFiles = visibleFiles.filter(
    f => f.status === 'unchanged' || f.status === 'synced' || f.status === 'included',
  )
  const removedFiles = visibleFiles.filter(f => f.status === 'remove')
  const ignoredFiles = visibleFiles.filter(f => f.status === 'ignored')

  if (showAllFiles) {
    // Show all files individually (update style)
    for (const file of visibleFiles) {
      const symbol = getStatusSymbol(file.status)
      const label = getStatusLabel(file.status)
      if (label) {
        lines.push(`${symbol} ${file.file} ${dim(`(${label})`)}`)
      } else {
        lines.push(`${symbol} ${file.file}`)
      }
    }
  } else {
    // Show changes with summaries (fetch style)
    for (const file of newFiles) {
      lines.push(`${green('+')} ${file.file} ${dim('(new)')}`)
    }
    for (const file of modifiedFiles) {
      lines.push(`${yellow('~')} ${file.file} ${dim('(modified)')}`)
    }
    for (const file of removedFiles) {
      lines.push(`${red('↓')} ${file.file} ${dim('(remove)')}`)
    }
    for (const file of ignoredFiles) {
      lines.push(`${gray('✗')} ${gray(file.file)} ${dim('(ignored)')}`)
    }

    // Summary for unchanged
    if (unchangedFiles.length > 0) {
      if (newFiles.length > 0 || modifiedFiles.length > 0 || removedFiles.length > 0) {
        lines.push(formatSuccess(`${unchangedFiles.length} file(s) unchanged`))
      } else {
        lines.push(formatSuccess(`${unchangedFiles.length} file(s) up to date`))
      }
    }
  }

  // Extra info (e.g. settings changes)
  if (plan.extraInfo && plan.extraInfo.length > 0) {
    for (const info of plan.extraInfo) {
      lines.push(`${gray('•')} ${info}`)
    }
  }

  return lines.join('\n')
}

/**
 * Print header with server and page info
 */
export function printHeader(serverUrl: string, pagePath: string): void {
  const serverDomain = new URL(serverUrl).host
  log.info(`${bold('Server:')} ${serverDomain}`)
  log.info(`${bold('Page:')} ${pagePath}`)
}
