/**
 * CLI logging utility using proc-log
 *
 * This module wraps proc-log to provide consistent logging across the CLI.
 * proc-log emits events on process, allowing tests to silence output by not
 * listening to the 'log' event, while the CLI can attach a listener to display output.
 *
 * Usage:
 *   import log from './log.ts'
 *   log.info('Hello world')      // standard output
 *   log.error('Error message')   // error output
 *   log.warn('Warning message')  // warning output
 */

// proc-log v6 exports { log, output, time, input, META } on default export
// The @types/proc-log package is outdated (v3), so we use type assertion
import procLogModule from 'proc-log'

interface ProcLogV6 {
  log: {
    info: (...args: unknown[]) => void
    warn: (...args: unknown[]) => void
    error: (...args: unknown[]) => void
    verbose: (...args: unknown[]) => void
    silly: (...args: unknown[]) => void
  }
}

const procLog = procLogModule as unknown as ProcLogV6

// Re-export proc-log's log function with our commonly used levels
export default {
  // Standard output (info level goes to stdout)
  info: (...args: unknown[]) => procLog.log.info(...args),
  // Warning output
  warn: (...args: unknown[]) => procLog.log.warn(...args),
  // Error output (error level goes to stderr)
  error: (...args: unknown[]) => procLog.log.error(...args),
  // Verbose/debug output (only shown with verbose flag)
  verbose: (...args: unknown[]) => procLog.log.verbose(...args),
  // Silly/trace output (only shown with very verbose flag)
  silly: (...args: unknown[]) => procLog.log.silly(...args),
}
