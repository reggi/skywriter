import {cyan, magenta, dim, green, yellow, red, blue, gray} from './colors.ts'
import log from './log.ts'

/**
 * Structured prefix logger (npm-style).
 * Builds up context segments that prefix every log line.
 *
 * Usage:
 *   const l = createPrefixLog('skywriter', 'pull')
 *   l.info('Server: localhost')          // skywriter info pull Server: localhost
 *   l.prefix('/doc').info('Cloning...')  // skywriter info pull /doc Cloning...
 */
export interface PrefixLog {
  info(message: string): void
  warn(message: string): void
  error(message: string): void
  verbose(message: string): void
  exec(message: string): void
  http(message: string): void
  fs(message: string): void
  prefix(segment: string): PrefixLog
}

function formatSegments(segments: string[]): string {
  if (segments.length === 0) return ''
  // First segment (cliName) → cyan
  // Second segment (command) → bold
  // Remaining segments → normal for paths, dim for short fn-like segments
  const parts: string[] = []
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]
    if (i === 0) {
      parts.push(cyan(seg))
    } else if (i === 1) {
      parts.push(magenta(seg))
    } else if (seg.startsWith('/')) {
      // Path segment — normal (stands out)
      parts.push(seg)
    } else {
      // Function/phase segment — dim
      parts.push(dim(seg))
    }
  }
  return parts.join(' ')
}

function levelColor(level: string): string {
  switch (level) {
    case 'info':
      return green(level)
    case 'warn':
      return yellow(level)
    case 'error':
      return red(level)
    case 'verbose':
      return dim(level)
    case 'exec':
      return blue(level)
    case 'http':
      return gray(level)
    case 'fs':
      return yellow(level)
    default:
      return level
  }
}

function createLogger(segments: string[]): PrefixLog {
  function emit(level: 'info' | 'warn' | 'error' | 'verbose' | 'exec' | 'http' | 'fs', message: string): void {
    // Insert colored level after cliName
    const prefix = segments.length > 0 ? `${formatSegments([segments[0]])} ${levelColor(level)}` : levelColor(level)
    const rest = segments.length > 1 ? ` ${formatSegments(segments.slice(1))}` : ''
    const line = `${prefix}${rest} ${message}`
    // exec, http, and fs use info transport; verbose uses verbose transport
    const transport = level === 'exec' || level === 'http' || level === 'fs' ? 'info' : level
    log[transport](line)
  }

  return {
    info: (message: string) => emit('info', message),
    warn: (message: string) => emit('warn', message),
    error: (message: string) => emit('error', message),
    verbose: (message: string) => emit('verbose', message),
    exec: (message: string) => emit('exec', message),
    http: (message: string) => emit('http', message),
    fs: (message: string) => emit('fs', message),
    prefix: (segment: string) => createLogger([...segments, segment]),
  }
}

export function createPrefixLog(...segments: string[]): PrefixLog {
  return createLogger(segments)
}
