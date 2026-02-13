import {readFileSync} from 'node:fs'
import {fileURLToPath} from 'node:url'

export function getCliName(): string {
  const packageJsonUrl = new URL('../../../package.json', import.meta.url)
  const text = readFileSync(fileURLToPath(packageJsonUrl), 'utf8')
  const parsed = JSON.parse(text) as {bin?: Record<string, string>}

  const bin = parsed.bin
  const firstKey = bin ? Object.keys(bin)[0] : undefined
  if (!firstKey) {
    throw new Error('Unable to determine CLI name from package.json `bin` field')
  }

  return firstKey
}

export function getCliVersion(): string {
  const packageJsonUrl = new URL('../../../package.json', import.meta.url)
  const text = readFileSync(fileURLToPath(packageJsonUrl), 'utf8')
  const parsed = JSON.parse(text) as {version?: string}
  return parsed.version ?? '0.0.0'
}

export function getCliId(): string {
  return getCliName().replace(/[^a-zA-Z0-9._-]/g, '-')
}
