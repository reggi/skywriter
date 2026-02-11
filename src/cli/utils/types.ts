/**
 * CLI context passed to all command handlers
 */
export interface CliContext {
  /** The CLI name (e.g., 'skywriter') */
  cliName: string
  /** The CLI ID suitable for file/directory names (sanitized) */
  cliId: string
  /** The current working directory */
  cwd: string
  /** Override credential storage to use file-based storage instead of system keychain */
  authType?: 'file'
  /** Suppress all proc-log output (--silent) */
  silent?: boolean
  /** Output as JSON (--json) */
  json?: boolean
  /** Prompt before exec operations (--prompt) */
  prompt?: boolean
}

/**
 * Type for CLI command functions
 * All commands receive CliContext as first argument and return Promise<void>
 */
export type CliCommand<Args extends unknown[] = []> = (ctx: CliContext, ...args: Args) => Promise<void>

/**
 * Server list management (stores metadata about servers, not credentials)
 */
export interface ServerInfo {
  serverUrl: string
  username: string
  active: boolean
}
