import {spawn} from 'node:child_process'
import {promises as fs} from 'node:fs'
import {join, dirname} from 'node:path'
import {tmpdir} from 'node:os'
import {randomBytes} from 'node:crypto'
import {fileURLToPath} from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))

/**
 * Result from executing a CLI command
 */
export interface CliResult {
  stdout: string
  stderr: string
  code: number
}

/**
 * CLI configuration setup result
 */
export interface CliConfigSetup {
  /** The temp directory acting as HOME for CLI config */
  homeDir: string
  /** Environment variables to pass to CLI commands */
  env: Record<string, string>
  /** Global args to prepend to all CLI commands (e.g., ['--auth-type=file']) */
  globalArgs: string[]
  /** Cleanup function to remove temp config */
  cleanup: () => Promise<void>
}

/**
 * Execute a CLI command
 * @param args CLI arguments (e.g., ['fetch', '/my-doc'])
 * @param cwd Working directory for the command
 * @param config CLI config setup (with env and globalArgs) or just env vars for backwards compatibility
 */
export async function execCli(
  args: string[],
  cwd: string,
  config: CliConfigSetup | Record<string, string> = {},
): Promise<CliResult> {
  // Support both CliConfigSetup and plain env object for backwards compatibility
  const isCliConfig = (c: CliConfigSetup | Record<string, string>): c is CliConfigSetup =>
    typeof c === 'object' && 'env' in c && 'globalArgs' in c

  const env: Record<string, string> = isCliConfig(config) ? config.env : config
  const globalArgs: string[] = isCliConfig(config) ? config.globalArgs : []

  return new Promise(resolve => {
    // Use Node.js with native TypeScript support
    const cliPath = join(__dirname, '../../src/cli/index.ts')
    const proc = spawn('node', ['--experimental-strip-types', cliPath, ...globalArgs, ...args], {
      cwd,
      env: {
        ...process.env,
        ...env,
      },
    })

    let stdout = ''
    let stderr = ''

    proc.stdout.on('data', data => {
      stdout += data.toString()
    })

    proc.stderr.on('data', data => {
      stderr += data.toString()
    })

    proc.on('close', code => {
      resolve({stdout, stderr, code: code ?? 1})
    })

    proc.on('error', err => {
      resolve({stdout, stderr: err.message, code: 1})
    })
  })
}

/**
 * Setup CLI config for a test user
 * Creates a temporary HOME directory with server list and credentials
 * The CLI reads config from ~/.skywriter.json and ~/.skywriter-cli-credentials.json
 * Returns env vars to pass to execCli and a cleanup function
 */
export async function setupCliConfig(serverUrl: string, username: string, password: string): Promise<CliConfigSetup> {
  // Create a fake HOME directory for the CLI
  const homeDir = join(tmpdir(), `cli-home-${randomBytes(8).toString('hex')}`)
  await fs.mkdir(homeDir, {recursive: true})

  // The CLI uses cliId 'skywriter' to construct file paths:
  // ~/.skywriter.json - server list with default
  // ~/.skywriter-cli-credentials.json - file-based credentials (fallback)

  // Create server list file (format: {active: "https://user@host", servers: {"https://user@host": {}}})
  const serverListPath = join(homeDir, '.skywriter.json')
  const urlObj = new URL(serverUrl)
  urlObj.username = username
  const serverKey = urlObj.href.replace(/\/$/, '')
  const serverConfig = {
    active: serverKey,
    servers: {
      [serverKey]: {},
    },
  }
  await fs.writeFile(serverListPath, JSON.stringify(serverConfig, null, 2))

  // Create credentials file (file-based credential storage format)
  // The key is `${serverUrl}:${username}`
  const credentialsPath = join(homeDir, '.skywriter-cli-credentials.json')
  const credentialsKey = `${serverUrl}:${username}`
  const credentials: Record<string, {serverUrl: string; username: string; password: string}> = {
    [credentialsKey]: {serverUrl, username, password},
  }
  await fs.writeFile(credentialsPath, JSON.stringify(credentials, null, 2))

  // Create .gitconfig to disable credential helpers (prevents macOS keychain prompts)
  const gitconfigPath = join(homeDir, '.gitconfig')
  const gitconfig = `[credential]
	helper = 
[user]
	email = test@example.com
	name = Test User
`
  await fs.writeFile(gitconfigPath, gitconfig)

  return {
    homeDir,
    env: {
      HOME: homeDir,
      // Disable git credential helpers
      GIT_TERMINAL_PROMPT: '0',
    },
    // Use file-based credential storage (skip keychain) and suppress proc-log output
    globalArgs: ['--auth-type=file', '--silent'],
    cleanup: async () => {
      await fs.rm(homeDir, {recursive: true, force: true})
    },
  }
}

/**
 * Options for directory comparison
 */
export interface CompareOptions {
  /** Patterns to ignore (e.g., ['.git', 'node_modules']) */
  ignore?: string[]
}

/**
 * File entry for comparison
 */
interface FileEntry {
  path: string
  content: string
}

/**
 * Result of directory comparison
 */
export interface CompareResult {
  matching: boolean
  differences: string[]
}

/**
 * Recursively get all files in a directory
 */
async function getAllFiles(dir: string, basePath: string = '', ignore: string[] = []): Promise<FileEntry[]> {
  const entries = await fs.readdir(dir, {withFileTypes: true})
  const files: FileEntry[] = []

  for (const entry of entries) {
    const relativePath = basePath ? `${basePath}/${entry.name}` : entry.name

    // Check if this entry should be ignored
    if (ignore.some(pattern => entry.name === pattern || relativePath.startsWith(pattern + '/'))) {
      continue
    }

    const fullPath = join(dir, entry.name)

    if (entry.isDirectory()) {
      const subFiles = await getAllFiles(fullPath, relativePath, ignore)
      files.push(...subFiles)
    } else {
      const content = await fs.readFile(fullPath, 'utf-8')
      files.push({path: relativePath, content})
    }
  }

  return files.sort((a, b) => a.path.localeCompare(b.path))
}

/**
 * Compare two directories for identical content
 * @param dirA First directory path
 * @param dirB Second directory path
 * @param options Comparison options
 * @returns Comparison result with matching flag and list of differences
 */
export async function compareDirectories(
  dirA: string,
  dirB: string,
  options: CompareOptions = {},
): Promise<CompareResult> {
  const ignore = options.ignore || []
  const differences: string[] = []

  const filesA = await getAllFiles(dirA, '', ignore)
  const filesB = await getAllFiles(dirB, '', ignore)

  // Create maps for easier lookup
  const mapA = new Map(filesA.map(f => [f.path, f.content]))
  const mapB = new Map(filesB.map(f => [f.path, f.content]))

  // Check for files only in A
  for (const file of filesA) {
    if (!mapB.has(file.path)) {
      differences.push(`File only in first directory: ${file.path}`)
    }
  }

  // Check for files only in B
  for (const file of filesB) {
    if (!mapA.has(file.path)) {
      differences.push(`File only in second directory: ${file.path}`)
    }
  }

  // Check for content differences
  for (const file of filesA) {
    const contentB = mapB.get(file.path)
    if (contentB !== undefined && file.content !== contentB) {
      differences.push(`Content differs: ${file.path}`)
    }
  }

  return {
    matching: differences.length === 0,
    differences,
  }
}

/**
 * Create a temporary directory for testing
 * @param prefix Prefix for the directory name
 * @returns Path to the created directory
 */
export async function createTempDir(prefix: string = 'cli-test'): Promise<string> {
  const dir = join(tmpdir(), `${prefix}-${randomBytes(8).toString('hex')}`)
  await fs.mkdir(dir, {recursive: true})
  return dir
}

/**
 * List all files in a directory (for debugging)
 */
export async function listFiles(dir: string, ignore: string[] = []): Promise<string[]> {
  const files = await getAllFiles(dir, '', ignore)
  return files.map(f => f.path)
}
