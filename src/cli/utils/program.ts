import {Command, CommanderError} from 'commander'
import {getCliName, getCliId} from './cliName.ts'
import type {CliContext} from './types.ts'
import {red, cyan} from './colors.ts'
import {login} from '../commands/login.ts'
import {pull} from '../commands/pull.ts'
import {push} from '../commands/push.ts'
import {serve} from '../commands/serve.ts'
import {host} from '../commands/host.ts'
import {render} from '../commands/render.ts'
import {init} from '../commands/init.ts'
import {sessions} from '../commands/sessions.ts'
import {switchServer} from '../commands/switchServer.ts'
import {removeServer} from '../commands/removeServer.ts'
import {logout} from '../commands/logout.ts'
import {whoami} from '../commands/whoami.ts'
import {vscodeInit} from '../commands/vscodeInit.ts'
import {settings} from '../commands/settings.ts'

type RunCliOptions = {
  stdout?: NodeJS.WritableStream
  stderr?: NodeJS.WritableStream
}

function createProgram(): Command {
  const program = new Command()

  program
    .name(getCliName())
    .description('Open source html host and tool for syncing webpages to that host.')
    .version('1.0.0')
    .option('--auth-type <type>', 'Override credential storage to use file-based storage (only "file" is allowed)')
    .option('-s, --silent', 'Suppress all output')
    .option('--json', 'Output as JSON (for commands that support it)')
    .option('--log-level <level>', 'Set log level (error, warn, notice, http, info, verbose, silly)', 'info')

  const LEVEL_OPTIONS = {
    silent: {index: 0},
    error: {index: 1},
    warn: {index: 2},
    notice: {index: 3},
    http: {index: 4},
    info: {index: 5},
    verbose: {index: 6},
    silly: {index: 7},
  }

  // Set up proc-log listener before any command runs, using Commander-parsed options
  program.hook('preAction', () => {
    const opts = program.opts<{silent?: boolean; logLevel?: string}>()
    const logLevel = opts.silent ? 'silent' : (opts.logLevel ?? 'info')
    const maxLevel = LEVEL_OPTIONS[logLevel as keyof typeof LEVEL_OPTIONS]
    if (!maxLevel || maxLevel.index <= 0) return

    const cliName = getCliName()
    process.on('log', (level: string, ...args: unknown[]) => {
      const levelOption = LEVEL_OPTIONS[level as keyof typeof LEVEL_OPTIONS]
      if (!levelOption || levelOption.index > maxLevel.index) return

      const message = args.map(arg => (typeof arg === 'string' ? arg : JSON.stringify(arg))).join(' ')
      if (level === 'error') {
        for (const line of message.split('\n')) {
          process.stderr.write(`${cyan(cliName)} ${red('error')} ${line}\n`)
        }
      } else if (level === 'warn') {
        process.stderr.write(message + '\n')
      } else {
        process.stdout.write(message + '\n')
      }
    })
  })

  // Create context getter that includes parsed global options
  const getCtx = (): CliContext => {
    const opts = program.opts<{authType?: string; silent?: boolean; json?: boolean}>()
    const authType = opts.authType === 'file' ? 'file' : undefined
    if (opts.authType && opts.authType !== 'file') {
      throw new Error(`Invalid --auth-type value: "${opts.authType}". Only "file" is allowed.`)
    }
    return {
      cliName: getCliName(),
      cliId: getCliId(),
      cwd: process.cwd(),
      authType,
      silent: opts.silent,
      json: opts.json,
    }
  }

  program
    .command('whoami')
    .description('Show current logged-in server and user')
    .action(async () => {
      await whoami(getCtx())
    })

  program
    .command('init')
    .description('Initialize a new document with default files')
    .argument('[path]', 'Document path (optional)')
    .option('-e, --extension <ext>', 'Content file extension', '.eta')
    .option('-d, --draft', 'Mark as draft', false)
    .option('-p, --published', 'Mark as published', true)
    .option('--template [name]', 'Initialize template/ in the current directory')
    .option('--slot [name]', 'Initialize slot/ in the current directory')
    .action(
      async (
        path?: string,
        options?: {
          extension?: string
          draft?: boolean
          published?: boolean
          template?: boolean | string
          slot?: boolean | string
        },
      ) => {
        await init(getCtx(), {path, ...options})
      },
    )

  program
    .command('vscode')
    .description('VS Code workspace management')
    .argument('[directory]', 'Project directory (defaults to current directory)')
    .option('--init', 'Initialize VS Code workspace with copilot instructions')
    .option('--open', 'Open workspace in VS Code')
    .action(async (directory?: string, opts?: {init?: boolean; open?: boolean}) => {
      const ctx = getCtx()
      await vscodeInit(directory ? {...ctx, cwd: directory} : ctx, {init: opts?.init, open: opts?.open})
    })

  // --- shared command builders ---
  const addLogin = (parent: Command) =>
    parent
      .command('login')
      .description('Login to server and save credentials securely')
      .argument('[url]', 'Server URL with username (e.g. http://user@host.com)')
      .option('-y, --yes', 'Set as default server without prompting')
      .option('--use-env', 'Read credentials from SKYWRITER_SECRET env var')
      .action(async (url?: string, opts?: {yes?: boolean; useEnv?: boolean}) => {
        await login(getCtx(), {url, yes: opts?.yes, useEnv: opts?.useEnv})
      })

  const addLogout = (parent: Command) =>
    parent
      .command('logout')
      .description('Remove credentials for a server')
      .argument('[url]', 'Server URL with username (e.g. http://user@host.com)')
      .option('-y, --yes', 'Skip confirmation prompt')
      .action(async (url?: string, opts?: {yes?: boolean}) => {
        await logout(getCtx(), {url, yes: opts?.yes})
      })

  // --- remote subcommand group ---
  const remote = program.command('remote').description('Manage remote server connections')

  remote
    .command('list')
    .description('List all configured remotes')
    .action(async () => {
      await sessions(getCtx())
    })

  addLogin(remote)
  addLogout(remote)

  remote
    .command('switch')
    .description('Switch the default server')
    .argument('[url]', 'Server URL with username (e.g. http://user@host.com)')
    .action(async (url?: string) => {
      await switchServer(getCtx(), url)
    })

  remote
    .command('remove')
    .description('Remove a remote server connection')
    .argument('[url]', 'Server URL with username (e.g. http://user@host.com)')
    .action(async (url?: string) => {
      await removeServer(getCtx(), url)
    })

  // --- top-level aliases ---
  addLogin(program)
  addLogout(program)

  program
    .command('pull')
    .description('Update document from server')
    .argument('[source]', 'Document path (/meow) or full URL (http://host/meow)')
    .argument('[destination]', 'Target directory (defaults to basename of path)')
    .option('--via <transport>', 'Transport method: "git" or "tar"')
    .option('--no-git', 'Skip git init when using tar transport')
    .option('--prompt', 'Prompt before exec operations')
    .action(
      async (source?: string, destination?: string, options?: {via?: string; git?: boolean; prompt?: boolean}) => {
        const ctx = getCtx()
        const prompt = options?.prompt
        await pull({...ctx, prompt}, source, destination, options)
      },
    )

  program
    .command('clone')
    .description('Clone document from server')
    .argument('<source>', 'Document path (/meow) or full URL (http://host/meow)')
    .argument('[destination]', 'Target directory (defaults to basename of path)')
    .option('--via <transport>', 'Transport method: "git" or "tar"')
    .option('--prompt', 'Prompt before exec operations')
    .action(async (source: string, destination?: string, options?: {via?: string; prompt?: boolean}) => {
      const ctx = getCtx()
      const prompt = options?.prompt
      await pull({...ctx, prompt}, source, destination, options)
    })

  program
    .command('push')
    .description('Push document to server (auto-detects git or tar transport)')
    .argument('[path]', 'Document path to push (optional, reads from settings.json if not provided)')
    .option('--via <transport>', 'Transport method: "git" or "tar"')
    .option('--no-git', 'Use tar transport')
    .option('--prompt', 'Prompt before exec operations')
    .action(async (path?: string, options?: {via?: string; git?: boolean; prompt?: boolean}) => {
      const ctx = getCtx()
      const prompt = options?.prompt
      await push({...ctx, prompt}, path, options)
    })

  program
    .command('serve')
    .description('Serve local document from current directory')
    .option('-p, --port <port>', 'Port to serve on', '3001')
    .option('-w, --watch <watch>', 'Watch for file changes', 'true')
    .option('--clear-cache', 'Clear the cache before serving')
    .action(async (options: {port: string; watch: string; clearCache?: boolean}) => {
      const port = parseInt(options.port, 10)
      const watch = options.watch !== 'false'
      const clearCache = options.clearCache || false
      await serve(getCtx(), port, watch, clearCache)
    })

  program
    .command('host')
    .description('Start the production server')
    .option('-p, --port <port>', 'Port to serve on', '3000')
    .option('--migrate', 'Run pending database migrations before starting')
    .option('--no-seed', 'Skip seeding demo content on empty database')
    .action(async (options: {port: string; migrate?: boolean; seed?: boolean}) => {
      const port = parseInt(options.port, 10)
      const migrate = options.migrate || false
      const seed = options.seed !== false
      await host(getCtx(), port, migrate, seed)
    })

  program
    .command('settings')
    .description('Display local settings.json')
    .option('--fix', 'Auto-fix issues')
    .action(async (options?: {fix?: boolean}) => {
      await settings(getCtx(), {fix: options?.fix})
    })

  program
    .command('render')
    .description('Render local document and output as JSON')
    .action(async () => {
      await render(getCtx())
    })

  return program
}

export async function program(args: string[], options: RunCliOptions = {}): Promise<number> {
  const stdout = options.stdout ?? process.stdout
  const stderr = options.stderr ?? process.stderr

  const program = createProgram()

  program.configureOutput({
    writeOut: str => {
      stdout.write(str)
    },
    writeErr: str => {
      stderr.write(str)
    },
  })

  program.exitOverride()

  try {
    await program.parseAsync(args, {from: 'user'})
    return 0
  } catch (error) {
    if (error instanceof CommanderError) {
      return error.exitCode
    }

    const err = error as Error
    const opts = program.opts<{json?: boolean; logLevel?: string}>()

    if (opts.json) {
      stdout.write(JSON.stringify({error: err.message}) + '\n')
    } else {
      const isVerbose = opts.logLevel === 'verbose' || opts.logLevel === 'silly'
      const text = isVerbose && err.stack ? err.stack : err.message
      const cliName = getCliName()
      for (const line of text.split('\n')) {
        stderr.write(`${cyan(cliName)} ${red('error')} ${line}\n`)
      }
    }

    return 1
  }
}
