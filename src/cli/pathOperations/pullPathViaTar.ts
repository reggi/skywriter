import {readFile, rm, mkdir, stat, copyFile, access, readdir} from 'node:fs/promises'
import {join} from 'node:path'
import {exec} from 'node:child_process'
import {promisify} from 'node:util'
import {createReadStream, createWriteStream} from 'node:fs'
import {pipeline} from 'node:stream/promises'
import {createHash} from 'node:crypto'
import {tmpdir} from 'node:os'
import {extract as tarExtract} from 'tar-stream'
import {createGunzip} from 'node:zlib'
import {formatSuccess} from '../utils/formatPlan.ts'
import {approveExec, loggedExec} from '../utils/promptExec.ts'
import {green, yellow, dim} from '../utils/colors.ts'
import type {PathContext, PathOperation, Settings} from '../utils/pageContext.ts'
import {createLoggedFetch} from '../utils/loggedFetch.ts'
import {createLoggedFs} from '../utils/createLoggedFs.ts'
import type {FetchFn} from '../utils/loggedFetch.ts'

const execAsync = promisify(exec)

async function hasUncommittedChanges(dir: string): Promise<boolean> {
  try {
    const {stdout} = await execAsync('git status --porcelain', {cwd: dir})
    return stdout.trim().length > 0
  } catch {
    return false
  }
}

interface FileChange {
  file: string
  status: 'new' | 'modified' | 'unchanged'
}

async function getFileHash(filePath: string): Promise<string> {
  try {
    const content = await readFile(filePath)
    return createHash('sha256').update(content).digest('hex')
  } catch {
    return ''
  }
}

async function compareFiles(tempDir: string, targetDir: string, files: string[]): Promise<FileChange[]> {
  const changes: FileChange[] = []
  for (const file of files) {
    const tempHash = await getFileHash(join(tempDir, file))
    const targetHash = await getFileHash(join(targetDir, file))
    if (!targetHash) {
      changes.push({file, status: 'new'})
    } else if (tempHash !== targetHash) {
      changes.push({file, status: 'modified'})
    } else {
      changes.push({file, status: 'unchanged'})
    }
  }
  return changes
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`
}

async function downloadFile(fetch: FetchFn, url: string, auth: string, targetPath: string): Promise<void> {
  const response = await fetch(url, {
    headers: {Authorization: `Basic ${auth}`},
  })
  if (!response.ok) {
    if (response.status === 404) throw new Error('File not found')
    throw new Error(`${response.status} ${response.statusText}`)
  }
  if (!response.body) throw new Error('No response body from server')
  const targetDirPath = join(targetPath, '..')
  await mkdir(targetDirPath, {recursive: true})
  const fileStream = createWriteStream(targetPath)
  await pipeline(response.body, fileStream)
}

async function downloadUploadsToTemp(fetch: FetchFn, ctx: PathContext, uploadsDir: string): Promise<string[]> {
  const settings = ctx.settings
  if (!settings.uploads || settings.uploads.length === 0) return []
  await mkdir(uploadsDir, {recursive: true})
  const downloaded: string[] = []
  for (const filename of settings.uploads) {
    const uploadUrl = `${ctx.serverUrl}/${ctx.normalizedPath}/uploads/${filename}`
    const targetPath = join(uploadsDir, filename)
    try {
      await downloadFile(fetch, uploadUrl, ctx.auth, targetPath)
      downloaded.push(`uploads/${filename}`)
    } catch {
      // Silently skip failed downloads during preview
    }
  }
  return downloaded
}

function statusSymbol(status: string): string {
  switch (status) {
    case 'new':
      return green('+')
    case 'modified':
      return yellow('~')
    default:
      return green('✓')
  }
}

async function applyChanges(
  tempDir: string,
  targetDir: string,
  files: FileChange[],
  uploads: FileChange[],
): Promise<void> {
  const allFiles = [...files, ...uploads]
  for (const change of allFiles) {
    if (change.status !== 'unchanged') {
      const srcPath = join(tempDir, change.file)
      const destPath = join(targetDir, change.file)
      await mkdir(join(destPath, '..'), {recursive: true})
      await copyFile(srcPath, destPath)
    }
  }
}

interface PullPathViaTarOptions {
  /** Whether to git init + commit after applying changes (default: true) */
  git?: boolean
}

/**
 * Pull a single path via tar archive.
 *
 * Downloads the archive for a single path, compares with target,
 * displays changes, applies them, and optionally git init + commits.
 */
export const pullPathViaTar = (async (ctx: PathContext, options: PullPathViaTarOptions = {}): Promise<void> => {
  const useGit = options.git !== false
  const archiveUrl = `${ctx.serverUrl}/${ctx.normalizedPath}/archive.tar.gz`
  const targetDir = ctx.absoluteDir

  // Check target dir state (only if it has meaningful content)
  const hasContent = await readdir(targetDir).then(
    entries => entries.some(e => e !== '.DS_Store'),
    () => false,
  )
  const hasGit =
    hasContent &&
    (await access(join(targetDir, '.git')).then(
      () => true,
      () => false,
    ))

  // Fast fail if target dir has a git remote (was pulled via git, not tar)
  if (useGit && hasGit) {
    const remoteUrl = await execAsync('git remote get-url origin', {cwd: targetDir}).then(
      r => r.stdout.trim(),
      () => null,
    )
    if (remoteUrl) {
      throw new Error(`"${ctx.dir}" has a git remote origin — use "pull --via git" to update it`)
    }
  }

  const tempBaseDir = join(tmpdir(), `.skywriter-tar-${ctx.reference}-${Date.now()}`)
  await mkdir(tempBaseDir, {recursive: true})

  try {
    const docTempDir = join(tempBaseDir, ctx.reference)
    await mkdir(docTempDir, {recursive: true})

    // Download archive
    const fetch = createLoggedFetch(ctx.log)
    const response = await fetch(archiveUrl, {
      headers: {Authorization: `Basic ${ctx.auth}`},
    })

    if (!response.ok) {
      if (response.status === 404) {
        ctx.log.warn(`Archive not found for ${ctx.path}, skipping`)
        return
      }
      throw new Error(`Failed to download: ${response.status} ${response.statusText}`)
    }

    if (!response.body) throw new Error('No response body from server')

    // Save archive to temp file
    const archivePath = join(tempBaseDir, `${ctx.reference}-archive.tar.gz`)
    const fileStream = createWriteStream(archivePath)
    await pipeline(response.body, fileStream)

    const archiveStat = await stat(archivePath)
    const archiveSize = formatBytes(archiveStat.size)

    const fileBuffer = await readFile(archivePath)
    const hash = createHash('sha256').update(fileBuffer).digest('hex').substring(0, 12)

    // Extract archive

    const gunzip = createGunzip()
    const extract = tarExtract()
    const extractedFiles: string[] = []

    await new Promise<void>((resolve, reject) => {
      extract.on('entry', async (header, stream, next) => {
        const filePath = join(docTempDir, header.name)
        if (header.type === 'directory') {
          await mkdir(filePath, {recursive: true})
          stream.resume()
          next()
        } else {
          extractedFiles.push(header.name)
          await mkdir(join(filePath, '..'), {recursive: true})
          const writeStreamFile = createWriteStream(filePath)
          stream.pipe(writeStreamFile)
          writeStreamFile.on('finish', next)
          writeStreamFile.on('error', reject)
          stream.on('error', reject)
        }
      })
      extract.on('finish', resolve)
      extract.on('error', reject)
      createReadStream(archivePath).pipe(gunzip).pipe(extract)
    })

    await rm(archivePath, {force: true})

    // Read settings from extracted files
    let settings: Settings | undefined
    try {
      const settingsContent = await readFile(join(docTempDir, 'settings.json'), 'utf-8')
      settings = JSON.parse(settingsContent)
    } catch {
      // No settings.json
    }

    // Download uploads to temp
    let uploadFiles: string[] = []
    if (settings?.uploads && settings.uploads.length > 0) {
      const uploadsDir = join(docTempDir, 'uploads')
      const ctxWithSettings = {...ctx, settings: {...ctx.settings, uploads: settings.uploads}}
      uploadFiles = await downloadUploadsToTemp(fetch, ctxWithSettings, uploadsDir)
    }

    // Compare
    const fileChanges = await compareFiles(docTempDir, targetDir, extractedFiles)
    const uploadChanges = await compareFiles(docTempDir, targetDir, uploadFiles)
    const allChanges = [...fileChanges, ...uploadChanges]
    const changed = allChanges.filter(f => f.status !== 'unchanged')

    if (changed.length === 0) {
      ctx.log.info(formatSuccess('Already up to date'))
      return
    }

    // Display changes
    ctx.log.info(`Archive: ${archiveSize} (${hash})`)
    for (const f of changed) {
      ctx.log.info(`${statusSymbol(f.status)} ${f.file} ${dim(`(${f.status})`)}`)
    }

    // Skip if git repo has uncommitted changes
    if (useGit && hasGit && (await hasUncommittedChanges(targetDir))) {
      throw new Error(`"${ctx.dir}" has uncommitted changes — commit or stash before pulling`)
    }

    // Apply changes
    await approveExec(`Apply ${changed.length} file(s) to ${ctx.dir}`, {autoApprove: !ctx.prompt, log: ctx.log})
    await applyChanges(docTempDir, targetDir, fileChanges, uploadChanges)

    // Git init + commit if requested
    if (useGit) {
      const gitC = ctx.dir === '.' ? 'git' : `git -C ${ctx.dir}`
      if (!hasGit) {
        await approveExec(`${gitC} init && ${gitC} add -A && ${gitC} commit -m "pull"`, {
          autoApprove: !ctx.prompt,
          log: ctx.log,
        })
        await loggedExec('git init', {cwd: targetDir, log: ctx.log})
        const loggedFs = createLoggedFs(ctx.log, targetDir)
        const gitignoreContent =
          '*\n!.gitignore\n!settings.json\n!content.*\n!data.*\n!server.js\n!style.css\n!script.js\n'
        await loggedFs.writeFile(join(targetDir, '.gitignore'), gitignoreContent)
        await loggedExec('git add -A && git commit -m "pull"', {cwd: targetDir, log: ctx.log})
      } else {
        await approveExec(`${gitC} add -A && ${gitC} commit -m "pull"`, {autoApprove: !ctx.prompt, log: ctx.log})
        await loggedExec('git add -A && git commit -m "pull"', {cwd: targetDir, log: ctx.log})
      }
    }
  } finally {
    await rm(tempBaseDir, {recursive: true, force: true})
  }
}) satisfies PathOperation
