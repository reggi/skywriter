import {join} from 'node:path'
import {exec} from 'node:child_process'
import {promisify} from 'node:util'
import type {CliContext, CliCommand} from '../utils/types.ts'
import {copilotInstructions} from '../utils/copilotInstructions.ts'
import {codeWorkspace, type Workspace} from '../utils/codeWorkspace.ts'
import {createPrefixLog} from '../utils/prefixLog.ts'
import {createLoggedFs} from '../utils/createLoggedFs.ts'

const execAsync = promisify(exec)

interface Settings {
  path?: string
  slot_path?: string | null
  template_path?: string | null
  [key: string]: string | null | undefined
}

/**
 * Read and parse settings.json
 */
async function readSettings(dir: string, ctx: CliContext, fs: ReturnType<typeof createLoggedFs>): Promise<Settings> {
  const settingsPath = join(dir, 'settings.json')
  try {
    const content = await fs.readFile(settingsPath)
    return JSON.parse(content)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(
        `Not a valid project: settings.json not found.\nInitialize a project with: ${ctx.cliName} init --path /your/path`,
      )
    }
    throw new Error(`Failed to read settings.json: ${(error as Error).message}`)
  }
}

/**
 * Validate project structure
 */
async function validateProject(
  dir: string,
  settings: Settings,
  ctx: CliContext,
  fs: ReturnType<typeof createLoggedFs>,
): Promise<void> {
  if (!settings.path) {
    throw new Error(
      'Invalid project: settings.json must have a "path" property.\n' +
        `Update settings.json or reinitialize with: ${ctx.cliName} init --path /your/path`,
    )
  }

  // Validate slot directory if slot_path is set
  if (settings.slot_path) {
    const slotDir = join(dir, 'slot')
    if (!(await fs.directoryExists(slotDir))) {
      throw new Error(
        `Slot directory not found: settings.json references slot_path "${settings.slot_path}" but no slot/ directory exists`,
      )
    }
  }

  // Validate template directory if template_path is set
  if (settings.template_path) {
    const templateDir = join(dir, 'template')
    if (!(await fs.directoryExists(templateDir))) {
      throw new Error(
        `Template directory not found: settings.json references template_path "${settings.template_path}" but no template/ directory exists`,
      )
    }
  }
}

/**
 * Write copilot-instructions.md to .github folder
 */
async function setupGithubFolder(
  targetDir: string,
  ctx: CliContext,
  fs: ReturnType<typeof createLoggedFs>,
  cmdLog: ReturnType<typeof createPrefixLog>,
): Promise<void> {
  const githubDir = join(targetDir, '.github')
  const targetFile = join(githubDir, 'copilot-instructions.md')

  // Create .github directory if it doesn't exist
  await fs.mkdir(githubDir, {recursive: true})

  // Generate copilot-instructions content with dynamic CLI name
  const content = copilotInstructions(ctx.cliName)

  try {
    await fs.writeFile(targetFile, content)
  } catch (error) {
    cmdLog.warn(`Could not create copilot-instructions.md: ${(error as Error).message}`)
  }
}

/**
 * Generate workspace configuration based on settings
 * Filters codeWorkspace folders based on which paths are configured
 */
function generateWorkspace(settings: Settings): Workspace {
  const folders = codeWorkspace.folders.filter(folder => {
    if (folder.name === 'root') return true
    if (folder.name === 'template') return !!settings.template_path
    if (folder.name === 'slot') return !!settings.slot_path
    return false
  })

  return {
    ...codeWorkspace,
    folders,
  }
}

/**
 * Check if VS Code CLI is available
 */
async function isVscodeAvailable(): Promise<boolean> {
  try {
    await execAsync('which code')
    return true
  } catch {
    return false
  }
}

/**
 * Open workspace in VS Code
 */
async function openWorkspace(workspacePath: string, cmdLog: ReturnType<typeof createPrefixLog>): Promise<void> {
  const cmd = `code "${workspacePath}"`
  try {
    await execAsync(cmd)
    cmdLog.exec(cmd)
  } catch (error) {
    cmdLog.error(`Failed to open VS Code: ${(error as Error).message}`)
    cmdLog.info(`Open manually: ${workspacePath}`)
  }
}

interface VscodeOptions {
  init?: boolean
  open?: boolean
}

/**
 * VS Code workspace management
 *   --init: Initialize workspace files (copilot instructions, .code-workspace)
 *   --open: Open workspace in VS Code
 */
export const vscodeInit: CliCommand<[VscodeOptions?]> = async (ctx, options = {}) => {
  const {init, open} = options
  const cwd = ctx.cwd
  const cmdLog = createPrefixLog(ctx.cliName, 'vscode')
  const fs = createLoggedFs(cmdLog, cwd)

  // Read and validate settings
  const settings = await readSettings(cwd, ctx, fs)
  await validateProject(cwd, settings, ctx, fs)

  if (!init && !open) {
    throw new Error('Provide --init, --open, or both.')
  }

  if (open) {
    const hasVscode = await isVscodeAvailable()
    if (!hasVscode) {
      throw new Error(
        'VS Code CLI (code) is not available. Install it from VS Code: Cmd+Shift+P → "Shell Command: Install \'code\' command in PATH"',
      )
    }
  }

  if (init) {
    cmdLog.info(`Project path: ${settings.path}`)
    if (settings.slot_path) {
      cmdLog.info(`Slot: ${settings.slot_path}`)
    }
    if (settings.template_path) {
      cmdLog.info(`Template: ${settings.template_path}`)
    }

    // Setup .github folder with copilot instructions
    await setupGithubFolder(cwd, ctx, fs, cmdLog)

    // Generate workspace configuration
    const workspace = generateWorkspace(settings)
    const workspacePath = join(cwd, 'doc.code-workspace')

    await fs.writeFile(workspacePath, JSON.stringify(workspace, null, 2) + '\n')
  }

  if (open) {
    const workspacePath = join(cwd, 'doc.code-workspace')
    await openWorkspace(workspacePath, cmdLog)
  }
}
