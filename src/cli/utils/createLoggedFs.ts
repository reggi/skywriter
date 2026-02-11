import type {PrefixLog} from './prefixLog.ts'
import {
  writeFile as nodeWriteFile,
  readFile as nodeReadFile,
  mkdir as nodeMkdir,
  readdir as nodeReaddir,
  access as nodeAccess,
  stat as nodeStat,
} from 'node:fs/promises'
import {relative, resolve} from 'node:path'
import {homedir} from 'node:os'

function formatPath(inputPath: string, cwd: string): string {
  const absPath = resolve(inputPath)
  const rel = relative(cwd, absPath)
  if (!rel.startsWith('..')) {
    return rel === '' ? '.' : './' + rel
  }
  const home = homedir()
  if (absPath === home || absPath.startsWith(home + '/')) {
    return '~' + absPath.slice(home.length)
  }
  return absPath
}

export function createLoggedFs(log: PrefixLog, cwd: string = process.cwd()) {
  return {
    async writeFile(path: string, content: string, encoding?: BufferEncoding) {
      await nodeWriteFile(path, content, encoding)
      log.fs(`writing ${formatPath(path, cwd)}`)
    },
    async readFile(path: string, encoding: BufferEncoding = 'utf-8'): Promise<string> {
      const content = await nodeReadFile(path, encoding)
      log.fs(`reading ${formatPath(path, cwd)}`)
      return content
    },
    async mkdir(path: string, options?: {recursive?: boolean}) {
      await nodeMkdir(path, options)
      log.fs(`creating directory ${formatPath(path, cwd)}/`)
    },
    async updateJsonProperty(path: string, keys: string[], value: unknown) {
      let data: Record<string, unknown> = {}
      try {
        const raw = await nodeReadFile(path, 'utf-8')
        data = JSON.parse(raw)
      } catch {
        // File doesn't exist yet, start with empty object
      }
      let obj: Record<string, unknown> = data
      for (let i = 0; i < keys.length - 1; i++) {
        if (!(keys[i] in obj) || typeof obj[keys[i]] !== 'object' || obj[keys[i]] === null) {
          obj[keys[i]] = {}
        }
        obj = obj[keys[i]] as Record<string, unknown>
      }
      obj[keys[keys.length - 1]] = value
      await nodeWriteFile(path, JSON.stringify(data, null, 2) + '\n', 'utf-8')
      const jsonPath = keys.join('.')
      const displayValue = typeof value === 'string' ? value : JSON.stringify(value)
      log.fs(`updating ${formatPath(path, cwd)}#${jsonPath} to ${displayValue}`)
    },
    async removeJsonProperty(path: string, keys: string[]) {
      const raw = await nodeReadFile(path, 'utf-8')
      const data = JSON.parse(raw)
      let obj: Record<string, unknown> = data
      for (let i = 0; i < keys.length - 1; i++) {
        if (!(keys[i] in obj)) return
        obj = obj[keys[i]] as Record<string, unknown>
      }
      delete obj[keys[keys.length - 1]]
      await nodeWriteFile(path, JSON.stringify(data, null, 2) + '\n', 'utf-8')
      const jsonPath = keys.join('.')
      log.fs(`removing ${formatPath(path, cwd)}#${jsonPath}`)
    },
    async updateSettingsFile(path: string, key: string, value: string) {
      const raw = await nodeReadFile(path, 'utf-8')
      const settings = JSON.parse(raw)
      settings[key] = value
      await nodeWriteFile(path, JSON.stringify(settings, null, 2) + '\n', 'utf-8')
      log.fs(`updating ${formatPath(path, cwd)}#${key} to ${value}`)
    },
    async readdir(path: string): Promise<string[]> {
      const entries = await nodeReaddir(path)
      log.fs(`reading directory ${formatPath(path, cwd)}/`)
      return entries
    },
    async isDirectoryEmpty(path: string): Promise<boolean> {
      const files = await nodeReaddir(path)
      log.fs(`reading directory ${formatPath(path, cwd)}/`)
      const filteredFiles = files.filter(f => f !== '.DS_Store')
      return filteredFiles.length === 0
    },
    async access(path: string): Promise<void> {
      await nodeAccess(path)
      log.fs(`accessing ${formatPath(path, cwd)}`)
    },
    async stat(path: string) {
      const stats = await nodeStat(path)
      log.fs(`stat ${formatPath(path, cwd)}`)
      return stats
    },
    async directoryExists(path: string): Promise<boolean> {
      try {
        const stats = await nodeStat(path)
        log.fs(`checking folder ${formatPath(path, cwd)}`)
        return stats.isDirectory()
      } catch {
        return false
      }
    },
  }
}
