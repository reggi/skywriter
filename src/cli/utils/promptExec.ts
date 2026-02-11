import {exec} from 'node:child_process'
import {promisify} from 'node:util'
import {confirm} from '@inquirer/prompts'
import {gray, dim} from './colors.ts'
import type {PrefixLog} from './prefixLog.ts'

const execAsync = promisify(exec)

interface ExecOptions {
  cwd?: string
  /** PrefixLog to prefix output lines with */
  log?: PrefixLog
}

interface ApproveOptions {
  /** Skip prompt (--exec-yes or --yes) */
  autoApprove?: boolean
  /** PrefixLog to emit exec-level log when auto-approved */
  log?: PrefixLog
}

/**
 * Prompt the user to approve a command before running it.
 * When auto-approved, logs the command at exec level.
 * Throws if the user declines.
 */
export async function approveExec(displayCmd: string, options: ApproveOptions = {}): Promise<void> {
  if (options.autoApprove) {
    if (options.log) {
      options.log.exec(displayCmd)
    }
    return
  }

  console.log(`${dim('Require permission to execute:')}`)
  console.log(`${dim('>')} ${displayCmd}`)

  const proceed = await confirm({
    message: 'Proceed?',
    default: true,
    theme: {prefix: ''},
  })

  if (!proceed) {
    throw new Error('Command cancelled by user')
  }
}

/**
 * Execute a shell command and log stdout/stderr lines with PrefixLog in gray.
 */
export async function loggedExec(cmd: string, options: ExecOptions = {}): Promise<{stdout: string; stderr: string}> {
  const result = await execAsync(cmd, {cwd: options.cwd})

  if (options.log) {
    const lines = [
      ...(result.stdout ? result.stdout.trimEnd().split('\n') : []),
      ...(result.stderr ? result.stderr.trimEnd().split('\n') : []),
    ]
    for (const line of lines) {
      if (line.trim()) {
        options.log.verbose(gray(line))
      }
    }
  }

  return result
}
