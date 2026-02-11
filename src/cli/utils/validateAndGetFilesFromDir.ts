import {readdir, stat} from 'node:fs/promises'
import {join} from 'node:path'

async function findFilesInDir(dir: string, pattern: RegExp): Promise<string[]> {
  try {
    const files = await readdir(dir)
    return files.filter(file => pattern.test(file))
  } catch {
    return []
  }
}

/**
 * Validate and get files to include from a directory.
 * Throws if required files are missing or duplicated.
 * Returns included files and excluded (unexpected) files.
 */
export async function validateAndGetFilesFromDir(dir: string): Promise<{files: string[]; excluded: string[]}> {
  const filesToInclude: string[] = []
  const excluded: string[] = []

  const contentFiles = await findFilesInDir(dir, /^(content\.|index\.html$)/)
  if (contentFiles.length === 0) {
    throw new Error(`No content file found in ${dir} (e.g., content.md or index.html)`)
  }
  if (contentFiles.length > 1) {
    throw new Error(`Multiple content files found in ${dir}: ${contentFiles.join(', ')}`)
  }
  filesToInclude.push(contentFiles[0])

  try {
    await stat(join(dir, 'settings.json'))
    filesToInclude.push('settings.json')
  } catch {
    throw new Error(`No settings.json file found in ${dir}`)
  }

  const dataFiles = await findFilesInDir(dir, /^data\./)
  if (dataFiles.length > 1) {
    throw new Error(`Multiple data files found in ${dir}: ${dataFiles.join(', ')}`)
  }
  if (dataFiles.length === 1) {
    filesToInclude.push(dataFiles[0])
  }

  const optionalFiles = ['style.css', 'server.js', 'script.js']
  for (const file of optionalFiles) {
    try {
      await stat(join(dir, file))
      filesToInclude.push(file)
    } catch {
      // File doesn't exist, skip
    }
  }

  const allFiles = await readdir(dir)
  const expectedPatterns = [
    /^content\./,
    /^index\.html$/,
    /^data\./,
    /^style\.css$/,
    /^server\.js$/,
    /^script\.js$/,
    /^settings\.json$/,
    /^\.git$/,
    /^template$/,
    /^slot$/,
    /^uploads$/,
  ]

  for (const file of allFiles) {
    const isExpected = expectedPatterns.some(pattern => pattern.test(file))
    if (!isExpected) {
      excluded.push(file)
    }
  }

  return {files: filesToInclude, excluded}
}
