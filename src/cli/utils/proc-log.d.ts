declare module 'proc-log' {
  const procLog: {
    log: {
      info: (...args: unknown[]) => void
      warn: (...args: unknown[]) => void
      error: (...args: unknown[]) => void
      verbose: (...args: unknown[]) => void
      silly: (...args: unknown[]) => void
    }
  }
  export default procLog
}
