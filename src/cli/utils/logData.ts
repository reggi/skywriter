import {green, red} from './colors.ts'

function formatValue(value: unknown): string {
  if (value === true) return green(String(value))
  if (value === false) return red(String(value))
  return String(value)
}

function logValue(key: string, value: unknown): void {
  if (typeof value === 'function') return
  if (Array.isArray(value)) {
    if (value.length === 0) return
    process.stdout.write(`\n${green(key)}:\n`)
    for (let i = 0; i < value.length; i++) {
      const item = value[i]
      if (typeof item === 'object' && item !== null) {
        for (const [k, v] of Object.entries(item)) {
          logValue(k, v)
        }
        if (i < value.length - 1) process.stdout.write('\n')
      } else {
        process.stdout.write(`${formatValue(item)}\n`)
      }
    }
  } else {
    process.stdout.write(`${green(key)}: ${formatValue(value)}\n`)
  }
}

/**
 * Log structured data as either JSON (--json) or CLI-friendly colored key-value pairs.
 */
export function logData(data: Record<string, unknown> | unknown[], json?: boolean): void {
  if (json) {
    process.stdout.write(JSON.stringify(data, null, 2) + '\n')
  } else if (Array.isArray(data)) {
    for (let i = 0; i < data.length; i++) {
      const item = data[i]
      if (typeof item === 'object' && item !== null) {
        for (const [key, value] of Object.entries(item)) {
          logValue(key, value)
        }
      } else {
        process.stdout.write(`${item}\n`)
      }
      if (i < data.length - 1) process.stdout.write('\n')
    }
  } else {
    const entries = Object.entries(data)
    const simple = entries.filter(([, v]) => !Array.isArray(v) && (typeof v !== 'object' || v === null))
    const complex = entries.filter(([, v]) => Array.isArray(v) || (typeof v === 'object' && v !== null))
    for (const [key, value] of [...simple, ...complex]) {
      logValue(key, value)
    }
  }
}
