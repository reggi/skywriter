/**
 * Simple ANSI color utilities for CLI output
 * No external dependencies - uses standard ANSI escape codes
 */

// Check if colors should be disabled (NO_COLOR env var or non-TTY)
const supportsColor = process.stdout.isTTY && !process.env.NO_COLOR

const code = (n: number) => (supportsColor ? `\x1b[${n}m` : '')

// Reset (internal use)
const reset = code(0)

// Styles
export const bold = (s: string) => `${code(1)}${s}${reset}`
export const dim = (s: string) => `${code(2)}${s}${reset}`

// Colors
export const red = (s: string) => `${code(31)}${s}${reset}`
export const green = (s: string) => `${code(32)}${s}${reset}`
export const yellow = (s: string) => `${code(33)}${s}${reset}`
export const blue = (s: string) => `${code(34)}${s}${reset}`
export const magenta = (s: string) => `${code(35)}${s}${reset}`
export const cyan = (s: string) => `${code(36)}${s}${reset}`
const _cyanBright = (s: string) => `${code(96)}${s}${reset}`
export const gray = (s: string) => `${code(90)}${s}${reset}`
