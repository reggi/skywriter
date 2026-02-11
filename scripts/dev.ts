import {spawn} from 'child_process'
import {join} from 'path'

// Start the server
console.log('Starting server...')
const serverProcess = spawn(
  'node',
  [
    '--experimental-strip-types',
    '--watch',
    '--watch-path=src/server',
    '--watch-path=src/db',
    '--watch-path=src/operations',
    '--watch-path=src/render',
    'src/server-bin/index.ts',
  ],
  {
    cwd: join(import.meta.dirname!, '..'),
    stdio: 'inherit',
  },
)

// Handle cleanup
process.on('SIGINT', () => {
  console.log('\nShutting down...')
  serverProcess.kill()
  process.exit(0)
})

process.on('SIGTERM', () => {
  serverProcess.kill()
  process.exit(0)
})
