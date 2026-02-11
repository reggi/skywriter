import type {MiddlewareHandler} from 'hono'
import {spawn, execSync} from 'child_process'
import type {PoolClient} from 'pg'
import type {AppContext} from '../utils/types.ts'
import {createArchive} from '../../responder/index.ts'
import {join} from 'path'
import type {RenderDocument} from '../../operations/types.ts'
import {render} from '../../render/index.ts'
import {functionContext} from '../../utils/functionContext.ts'
import {getRenderDocument} from '../../operations/getRenderDocument.ts'
import {upsert} from '../../operations/upsert.ts'
import {promises as fs} from 'fs'

interface DocumentFiles {
  'settings.json': string
  [key: string]: string // content.*, data.*, server.js, style.css, script.js
}

/**
 * Execute a git command in a repository
 */
async function execGit(repoPath: string, args: string[]): Promise<{stdout: string; stderr: string}> {
  return new Promise((resolve, reject) => {
    const git = spawn('git', args, {
      cwd: repoPath,
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: 'Server',
        GIT_AUTHOR_EMAIL: 'server@local',
        GIT_COMMITTER_NAME: 'Server',
        GIT_COMMITTER_EMAIL: 'server@local',
      },
    })

    let stdout = ''
    let stderr = ''

    git.stdout.on('data', data => {
      stdout += data.toString()
    })

    git.stderr.on('data', data => {
      stderr += data.toString()
    })

    git.on('close', code => {
      if (code === 0) {
        resolve({stdout, stderr})
      } else {
        reject(new Error(`Git command failed: ${args.join(' ')}\n${stderr}`))
      }
    })

    git.on('error', err => {
      reject(err)
    })
  })
}

/**
 * Get the repository path for a document
 */
function getRepoPath(gitReposPath: string, documentId: number): string {
  // Use document ID as directory name for stability and simplicity
  return join(gitReposPath, documentId.toString())
}

/**
 * Ensure the working directory is clean by resetting any unstaged changes
 */
async function ensureCleanWorkingDirectory(gitReposPath: string, documentId: number): Promise<void> {
  const repoPath = getRepoPath(gitReposPath, documentId)

  if (!(await repoExists(gitReposPath, documentId))) {
    return
  }

  try {
    // Reset any unstaged changes
    await execGit(repoPath, ['reset', '--hard', 'HEAD'])
    // Clean untracked files
    await execGit(repoPath, ['clean', '-fd'])
  } catch (error) {
    // Ignore errors if there's nothing to clean
    console.warn('Failed to clean working directory:', error)
  }
}

/**
 * Check if a repository exists and is initialized
 */
async function repoExists(gitReposPath: string, documentId: number): Promise<boolean> {
  const repoPath = getRepoPath(gitReposPath, documentId)
  try {
    const gitDir = join(repoPath, '.git')
    const stat = await fs.stat(gitDir)
    return stat.isDirectory()
  } catch {
    return false
  }
}

/**
 * Check if a specific branch exists in the repository
 */
async function branchExists(gitReposPath: string, documentId: number, branch: string): Promise<boolean> {
  const repoPath = getRepoPath(gitReposPath, documentId)

  if (!(await repoExists(gitReposPath, documentId))) {
    return false
  }

  try {
    const {stdout} = await execGit(repoPath, ['branch', '--list', branch])
    return stdout.trim().length > 0
  } catch {
    return false
  }
}

/**
 * Get the current branch name
 */
async function getCurrentBranch(gitReposPath: string, documentId: number): Promise<string | null> {
  const repoPath = getRepoPath(gitReposPath, documentId)

  if (!(await repoExists(gitReposPath, documentId))) {
    return null
  }

  try {
    const {stdout} = await execGit(repoPath, ['branch', '--show-current'])
    return stdout.trim() || null
  } catch {
    return null
  }
}

/**
 * Check if there are uncommitted changes in the working directory
 */
async function hasChanges(gitReposPath: string, documentId: number): Promise<boolean> {
  const repoPath = getRepoPath(gitReposPath, documentId)

  if (!(await repoExists(gitReposPath, documentId))) {
    return false
  }

  try {
    const {stdout} = await execGit(repoPath, ['status', '--porcelain'])
    return stdout.trim().length > 0
  } catch {
    return false
  }
}

/**
 * Check if staged content matches the last commit with the same message type
 * Searches through history to find last commit with matching message, not just HEAD
 * @param documentId - The document ID
 * @param commitMessage - The commit message to check against
 * @returns true if last matching commit has same content, false otherwise
 */
async function matchesLastCommitOfType(
  gitReposPath: string,
  documentId: number,
  commitMessage: string,
): Promise<boolean> {
  const repoPath = getRepoPath(gitReposPath, documentId)

  if (!(await repoExists(gitReposPath, documentId))) {
    return false
  }

  try {
    // Get the tree hash of current working directory (staged files)
    const {stdout: currentTreeHash} = await execGit(repoPath, ['write-tree'])

    // Search for the last commit with matching message
    const {stdout: logOutput} = await execGit(repoPath, ['log', '--format=%H %s', '--all'])

    const commits = logOutput.trim().split('\n')
    for (const line of commits) {
      if (!line) continue
      const [hash, ...messageParts] = line.split(' ')
      const message = messageParts.join(' ')

      // Found the most recent commit with matching message
      if (message === commitMessage) {
        // Get the tree hash of this commit
        const {stdout: commitTreeHash} = await execGit(repoPath, ['rev-parse', `${hash}^{tree}`])

        // Compare tree hashes
        return commitTreeHash.trim() === currentTreeHash.trim()
      }
    }

    // No previous commit with matching message found
    return false
  } catch {
    return false
  }
}

// /**
//  * Sync current archive.tar.gz contents into the repository
//  * Replaces all files with archive contents and commits if there are changes
//  */
// export async function syncArchiveToRepo(documentId: number, archivePath: string): Promise<boolean> {
//   const repoPath = getRepoPath(documentId)

//   // Ensure repo exists
//   if (!(await repoExists(documentId))) {
//     await initRepo(documentId, archivePath)
//     return true
//   }

//   // Create temp directory for extraction
//   const tmpDir = join(tmpdir(), `git-sync-${randomBytes(8).toString('hex')}`)
//   await fs.mkdir(tmpDir, {recursive: true})

//   try {
//     // Extract archive to temp directory
//     await extract({
//       file: archivePath,
//       cwd: tmpDir,
//     })

//     // Remove all tracked files in repo (but keep .git)
//     const files = await fs.readdir(repoPath)
//     for (const file of files) {
//       if (file === '.git') continue
//       await fs.rm(join(repoPath, file), {recursive: true, force: true})
//     }

//     // Copy extracted files to repo
//     const extractedFiles = await fs.readdir(tmpDir)
//     for (const file of extractedFiles) {
//       const src = join(tmpDir, file)
//       const dest = join(repoPath, file)
//       const stat = await fs.stat(src)

//       if (stat.isDirectory()) {
//         await fs.cp(src, dest, {recursive: true})
//       } else {
//         await fs.copyFile(src, dest)
//       }
//     }

//     // Check if there are changes
//     if (!(await hasChanges(documentId))) {
//       return false
//     }

//     // Add all changes and commit
//     await execGit(repoPath, ['add', '.'])
//     await execGit(repoPath, ['commit', '-m', 'editor changes2'])
//     return true
//   } finally {
//     await fs.rm(tmpDir, {recursive: true, force: true})
//   }
// }

/**
 * Read files directly from a specific branch in the repository
 * Returns files in the same format as createArchive
 */
async function readRepoFiles(
  gitReposPath: string,
  documentId: number,
  branch: 'main' | 'draft' = 'main',
): Promise<Record<string, string>> {
  const repoPath = getRepoPath(gitReposPath, documentId)

  if (!(await repoExists(gitReposPath, documentId))) {
    throw new Error('Repository does not exist')
  }

  // Check if branch exists
  if (!(await branchExists(gitReposPath, documentId, branch))) {
    throw new Error(`Branch ${branch} does not exist`)
  }

  // Save current branch
  const currentBranch = await getCurrentBranch(gitReposPath, documentId)

  // Switch to target branch if needed
  if (currentBranch !== branch) {
    await execGit(repoPath, ['checkout', branch])
  }

  try {
    // Get list of all files (excluding .git and .gitignore)
    const allFiles = await fs.readdir(repoPath)
    const files = allFiles.filter(f => f !== '.git' && f !== '.gitignore')

    console.log('readRepoFiles - allFiles:', allFiles)
    console.log('readRepoFiles - filtered files:', files)

    // Read all files into memory (skip directories)
    const result: Record<string, string> = {}
    for (const filename of files) {
      const filePath = join(repoPath, filename)
      const stat = await fs.stat(filePath)
      if (!stat.isFile()) continue
      const content = await fs.readFile(filePath, 'utf-8')
      console.log('readRepoFiles - adding file:', filename)
      result[filename] = content
    }

    console.log('readRepoFiles - result keys:', Object.keys(result))
    return result
  } finally {
    // Switch back to original branch
    if (currentBranch && currentBranch !== branch) {
      await execGit(repoPath, ['checkout', currentBranch])
    }
  }
}

/**
 * Sync document files directly to a specific branch in the repository
 * More efficient than creating archive first
 * Only updates the specified branch, leaving other branches untouched
 */
async function syncDocumentToRepo(
  gitReposPath: string,
  documentId: number,
  files: DocumentFiles,
  branch: 'main' | 'draft' = 'main',
  isDraft: boolean = false,
  hasDraft: boolean = false,
): Promise<boolean> {
  const repoPath = getRepoPath(gitReposPath, documentId)

  // Initialize repo if needed (only for main branch)
  if (!(await repoExists(gitReposPath, documentId))) {
    if (branch === 'draft') {
      throw new Error('Cannot sync to draft branch before repository is initialized')
    }

    await fs.mkdir(repoPath, {recursive: true})
    await execGit(repoPath, ['init', '--initial-branch=main'])

    // Configure repo to allow HTTP push (required for non-bare repos)
    await execGit(repoPath, ['config', 'http.receivepack', 'true'])
    await execGit(repoPath, ['config', 'receive.denyCurrentBranch', 'updateInstead'])

    // Create .gitignore file - ignore everything except main document files
    const gitignoreContent = '*\n!.gitignore\n!settings.json\n!content.*\n!data.*\n!server.js\n!style.css\n!script.js\n'
    await fs.writeFile(join(repoPath, '.gitignore'), gitignoreContent)

    // Write all files
    for (const [filename, content] of Object.entries(files)) {
      await fs.writeFile(join(repoPath, filename), content)
    }

    // Initial commit
    await execGit(repoPath, ['add', '.'])
    await execGit(repoPath, ['commit', '-m', 'init'])
    return true
  }

  // Save current branch
  const currentBranch = await getCurrentBranch(gitReposPath, documentId)

  // Check if target branch exists, create if needed (for draft branch)
  const targetBranchExists = await branchExists(gitReposPath, documentId, branch)

  if (!targetBranchExists) {
    if (branch === 'draft') {
      // Create draft branch from main
      await execGit(repoPath, ['checkout', '-b', 'draft', 'main'])
    } else {
      throw new Error(`Branch ${branch} does not exist`)
    }
  } else if (currentBranch !== branch) {
    // Switch to target branch
    await execGit(repoPath, ['checkout', branch])
  }

  // Remove all tracked files in repo (but keep .git and .gitignore)
  const existingFiles = await fs.readdir(repoPath)
  for (const file of existingFiles) {
    if (file === '.git' || file === '.gitignore') continue
    await fs.rm(join(repoPath, file), {recursive: true, force: true})
  }

  // Write new files
  for (const [filename, content] of Object.entries(files)) {
    await fs.writeFile(join(repoPath, filename), content)
  }

  // Check if there are changes
  if (!(await hasChanges(gitReposPath, documentId))) {
    // Switch back to original branch if no changes
    if (currentBranch && currentBranch !== branch) {
      await execGit(repoPath, ['checkout', currentBranch])
    }
    return false
  }

  // Stage the changes
  await execGit(repoPath, ['add', '.'])

  // Determine commit message
  const commitMessage = isDraft ? 'draft editor changes' : 'editor changes'

  // Check if we should skip committing
  // Special cases to maintain current/draft alternation:
  // 1. Syncing current with no draft: allow if HEAD is draft (restore current on top)
  // 2. Syncing draft when HEAD is current: always allow (maintain alternation)
  let shouldSkip = false

  try {
    const {stdout: headMessage} = await execGit(repoPath, ['log', '-1', '--format=%s'])
    const headIsDraft = headMessage.trim() === 'draft editor changes'

    if (!isDraft && !hasDraft) {
      // Syncing current with no draft - only skip if HEAD is also current AND content matches
      if (!headIsDraft) {
        shouldSkip = await matchesLastCommitOfType(gitReposPath, documentId, commitMessage)
      }
      // If HEAD is draft, always allow current commit (to restore current on top)
    } else if (isDraft && !headIsDraft) {
      // Syncing draft when HEAD is current - always allow to maintain alternation
      // Don't check if it matches previous draft
      shouldSkip = false
    } else {
      // Normal case: check if last commit of this type has same content
      shouldSkip = await matchesLastCommitOfType(gitReposPath, documentId, commitMessage)
    }
  } catch {
    shouldSkip = await matchesLastCommitOfType(gitReposPath, documentId, commitMessage)
  }

  if (shouldSkip) {
    // Reset staged changes - don't commit
    await execGit(repoPath, ['reset', 'HEAD'])

    // Switch back to original branch
    if (currentBranch && currentBranch !== branch) {
      await execGit(repoPath, ['checkout', currentBranch])
    }
    return false
  }

  // Commit changes
  await execGit(repoPath, ['commit', '-m', commitMessage])

  // Switch back to original branch
  if (currentBranch && currentBranch !== branch) {
    await execGit(repoPath, ['checkout', currentBranch])
  }

  return true
}

// Get git-http-backend path once at module load
const GIT_HTTP_BACKEND = (() => {
  try {
    const gitExecPath = execSync('git --exec-path', {encoding: 'utf-8'}).trim()
    return join(gitExecPath, 'git-http-backend')
  } catch {
    // Fallback to common paths
    return 'git-http-backend'
  }
})()

/**
 * Sync a document to the main git branch as a new commit
 * Only commits if there are actual changes
 * Returns true if a commit was created, false if no changes
 */
async function syncDocumentToBranch(
  gitReposPath: string,
  client: PoolClient,
  documentId: number,
  document: RenderDocument,
  isDraft: boolean = false,
  hasDraft: boolean = false,
  requestQuery?: Record<string, string>,
): Promise<boolean> {
  // Get archive files directly without creating tar.gz
  const archiveFiles = await createArchive(document, '/archive.tar.gz', doc => {
    return render(doc, {
      fn: functionContext(client, doc, requestQuery),
      query: requestQuery,
    })
  })
  const files: Record<string, string> = {}

  // Convert archive files to files object
  for (const {filename, content} of archiveFiles) {
    // Remove leading slash from filename
    const key = filename.startsWith('/') ? filename.slice(1) : filename

    // Ensure value is a string
    let value: string
    if (typeof content === 'string') {
      value = content
    } else if (Buffer.isBuffer(content)) {
      value = content.toString('utf-8')
    } else if (typeof content === 'object' && content !== null) {
      value = JSON.stringify(content, null, 2)
    } else {
      value = String(content)
    }

    files[key] = value
  }

  console.log('syncDocumentToBranch - files being synced:', Object.keys(files))
  console.log('syncDocumentToBranch - settings.json content length:', files['settings.json']?.length || 0)
  console.log('syncDocumentToBranch - settings.json content:', files['settings.json'])

  // Sync document directly to repository (always to main branch)
  // Returns false if no changes detected
  return await syncDocumentToRepo(gitReposPath, documentId, files as DocumentFiles, 'main', isDraft, hasDraft)
}

export const git: MiddlewareHandler<AppContext> = async c => {
  const client = c.get('client')
  const gitReposPath = c.get('gitReposPath')

  const gitMatch = c.get('pathMatch')

  if (!gitMatch) {
    throw new Error('gitHandler requires pathMatch to be set')
  }

  const documentPath = gitMatch[1] || '/'
  const gitPath = gitMatch[2] || '/'

  // Determine the git service from the request
  const service = c.req.query('service') || ''
  const isReceivePack = service === 'git-receive-pack' || gitPath.includes('/git-receive-pack')
  const isUploadPack = service === 'git-upload-pack' || gitPath.includes('/git-upload-pack')

  try {
    // Get the current document (main branch)
    const document = await getRenderDocument(client, {path: documentPath}, {includeSlot: true, includeTemplate: true})

    if (!document) {
      return c.json({error: 'Document not found'}, 404)
    }

    // Sync documents to repo before upload-pack (fetch/pull) operations
    // This ensures clients get the latest database content
    // Skip sync on receive-pack (push) since we're receiving changes
    if (isUploadPack || !(await repoExists(gitReposPath, document.id))) {
      // Check if draft exists
      const draftDocument = await getRenderDocument(
        client,
        {path: documentPath},
        {draft: true, includeSlot: true, includeTemplate: true},
      )
      const hasDraft = !!(draftDocument && draftDocument.draft === true)

      const requestQuery = c.req.query()

      // Sync current content to main branch
      await syncDocumentToBranch(gitReposPath, client, document.id, document, false, hasDraft, requestQuery)

      // If draft exists, sync draft content as second commit on main
      if (hasDraft) {
        await syncDocumentToBranch(gitReposPath, client, document.id, draftDocument, true, true, requestQuery)
      }
    }

    // Before receive-pack (push), ensure working directory is clean
    // This is required for receive.denyCurrentBranch = updateInstead to work
    if (isReceivePack) {
      console.log('Cleaning working directory before push...')
      await ensureCleanWorkingDirectory(gitReposPath, document.id)
      console.log('Working directory cleaned')
    }

    const repoPath = getRepoPath(gitReposPath, document.id)

    // Set up CGI environment for git-http-backend
    // GIT_PROJECT_ROOT should be the parent directory containing repos
    // PATH_INFO should be /{repo-name}{git-path}
    const env = {
      ...process.env,
      GIT_PROJECT_ROOT: gitReposPath,
      GIT_HTTP_EXPORT_ALL: '1',
      PATH_INFO: `/${document.id}${gitPath}`,
      REQUEST_METHOD: c.req.method,
      QUERY_STRING: new URL(c.req.url).search.substring(1),
      CONTENT_TYPE: c.req.header('content-type') || '',
    }

    // Spawn git-http-backend (cwd set to repo for safety)
    const backend = spawn(GIT_HTTP_BACKEND, [], {
      env,
      cwd: repoPath,
    })

    // Collect response data
    let statusCode = 200
    const headers: Record<string, string> = {}
    let body = Buffer.alloc(0)
    let headersParsed = false
    let stderrOutput = ''

    backend.stderr.on('data', (data: Buffer) => {
      stderrOutput += data.toString()
    })

    backend.stdout.on('data', (data: Buffer) => {
      if (!headersParsed) {
        // Parse CGI headers
        const dataStr = data.toString()
        const headerEndIndex = dataStr.indexOf('\r\n\r\n')

        if (headerEndIndex !== -1) {
          const headerSection = dataStr.substring(0, headerEndIndex)
          const bodySection = dataStr.substring(headerEndIndex + 4)

          // Parse headers
          const headerLines = headerSection.split('\r\n')
          for (const line of headerLines) {
            const colonIndex = line.indexOf(':')
            if (colonIndex !== -1) {
              const key = line.substring(0, colonIndex).trim()
              const value = line.substring(colonIndex + 1).trim()

              if (key.toLowerCase() === 'status') {
                const statusMatch = value.match(/^(\d+)/)
                if (statusMatch) {
                  statusCode = parseInt(statusMatch[1], 10)
                }
              } else {
                headers[key] = value
              }
            }
          }

          headersParsed = true
          if (bodySection) {
            body = Buffer.concat([body, Buffer.from(bodySection)])
          }
        } else {
          body = Buffer.concat([body, data])
        }
      } else {
        body = Buffer.concat([body, data])
      }
    })

    // Pipe request body to git-http-backend
    if (c.req.method === 'POST') {
      const requestBody = await c.req.arrayBuffer()
      backend.stdin.write(Buffer.from(requestBody))
    }
    backend.stdin.end()

    // Wait for git-http-backend to complete
    await new Promise<void>((resolve, reject) => {
      backend.on('close', code => {
        if (code === 0) {
          resolve()
        } else {
          console.error('git-http-backend stderr:', stderrOutput)
          reject(new Error(`git-http-backend exited with code ${code}: ${stderrOutput}`))
        }
      })
      backend.on('error', err => {
        console.error('git-http-backend spawn error:', err)
        reject(err)
      })
    })

    // After receive-pack (push), sync repo back to database
    if (isReceivePack) {
      try {
        console.log('Starting sync from repo to database...')

        // Read files directly from repo (always from main branch)
        const files = await readRepoFiles(gitReposPath, document.id, 'main')

        // Debug: log available files
        console.log('Files in repo after push:', Object.keys(files))
        console.log('settings.json exists?', 'settings.json' in files)
        console.log('settings.json value:', files['settings.json'])
        console.log('settings.json type:', typeof files['settings.json'])

        // Validate settings.json exists (but allow empty string)
        if (files['settings.json'] === undefined) {
          console.error('Full files object:', JSON.stringify(files, null, 2))
          throw new Error('settings.json not found in repository')
        }

        // Parse settings.json to get document metadata (treat empty as {})
        const settingsContent = files['settings.json'].trim()
        const settings = settingsContent ? JSON.parse(settingsContent) : {}

        console.log('Parsed settings:', settings)

        // Find optional content files
        const contentFile = Object.keys(files).find(f => f.startsWith('content.'))
        const dataFile = Object.keys(files).find(f => f.startsWith('data.'))

        console.log('Content file:', contentFile, 'Data file:', dataFile)

        // Upsert document with data from repo files
        console.log('Upserting to path:', documentPath)
        await upsert(
          client,
          {path: documentPath},
          {
            ...settings,
            content: contentFile ? files[contentFile] : settings.content,
            data: dataFile ? files[dataFile] : settings.data,
            server: files['server.js'] ?? settings.server,
            style: files['style.css'] ?? settings.style,
            script: files['script.js'] ?? settings.script,
          },
        )

        console.log('Upsert completed successfully')
      } catch (syncError) {
        console.error('Failed to sync repo to database:', syncError)
        // Don't fail the git push if database sync fails
        // The push succeeded, we just couldn't update the database
      }
    }

    // Return the response from git-http-backend
    return new Response(new Uint8Array(body), {status: statusCode, headers})
  } catch (error) {
    console.error('git operation error:', error)
    return c.json({error: error instanceof Error ? error.message : 'Git operation failed'}, 500)
  }
}
