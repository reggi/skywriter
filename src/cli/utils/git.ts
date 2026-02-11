import {exec} from 'node:child_process'
import {promisify} from 'node:util'
import {stat, readdir, access} from 'node:fs/promises'
import {join} from 'node:path'

const execAsync = promisify(exec)

/**
 * Check if git is installed
 */
export async function isGitInstalled(): Promise<boolean> {
  try {
    await execAsync('git --version')
    return true
  } catch {
    return false
  }
}

/**
 * Check if current directory is a git repository (has .git in CWD, not parent)
 */
export async function isGitRepo(): Promise<boolean> {
  try {
    const gitPath = join(process.cwd(), '.git')
    const stats = await stat(gitPath)
    return stats.isDirectory()
  } catch {
    return false
  }
}

/**
 * Check if directory is empty (excluding .git and .DS_Store)
 */
export async function isDirectoryEmpty(): Promise<boolean> {
  try {
    const files = await readdir(process.cwd())
    const filteredFiles = files.filter(file => file !== '.git' && file !== '.DS_Store')
    return filteredFiles.length === 0
  } catch {
    return false
  }
}

/**
 * Check if a git repo has a remote configured
 */
export async function hasRemote(dir: string): Promise<boolean> {
  try {
    await access(`${dir}/.git`)
    const {stdout} = await execAsync('git remote', {cwd: dir})
    return stdout.trim().length > 0
  } catch {
    return false
  }
}
