// Strip ANSI escape codes from a string for consistent snapshot testing
const ANSI_REGEX = /\x1b\[[0-9;]*m/g

export function stripAnsi(str: string): string {
  return str.replace(ANSI_REGEX, '')
}
