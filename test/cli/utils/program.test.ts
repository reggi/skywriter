import {describe, it} from 'node:test'
import assert from 'node:assert/strict'
import {Writable} from 'node:stream'
import {program} from '../../../src/cli/utils/program.ts'

function createCaptureStream() {
  const chunks: string[] = []
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk))
      callback()
    },
  })

  return {
    stream,
    getText: () => chunks.join(''),
  }
}

describe('cli runCli', () => {
  it('prints help and exits 0', async () => {
    const out = createCaptureStream()
    const err = createCaptureStream()

    const exitCode = await program(['--help'], {stdout: out.stream, stderr: err.stream})

    assert.equal(exitCode, 0)
    assert.match(out.getText(), /usage:/i)
    assert.equal(err.getText(), '')
  })

  it('unknown command exits non-zero', async () => {
    const out = createCaptureStream()
    const err = createCaptureStream()

    const exitCode = await program(['definitely-not-a-command'], {
      stdout: out.stream,
      stderr: err.stream,
    })

    assert.notEqual(exitCode, 0)
    assert.ok(err.getText().length > 0)
  })
})
