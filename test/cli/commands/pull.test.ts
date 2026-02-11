import {describe, it, mock, beforeEach, afterEach} from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp, rm, mkdir} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

// Track which transport was called
let pullViaGitCalled = false
let pullViaTarCalled = false
let pullViaGitArgs: unknown[] = []
let pullViaTarArgs: unknown[] = []

// Control auto-detect mocks
let mockResolvedDest = '/tmp/fake-dest'
let mockHasRemoteResult = true

// Mock resolveTarget
mock.module('../../../src/cli/utils/resolveTarget.ts', {
  namedExports: {
    resolveTarget: async () => ({
      serverUrl: 'http://localhost:3000',
      documentPath: '/test',
      username: 'testuser',
      password: 'testpass',
      auth: 'auth',
      dest: mockResolvedDest,
    }),
  },
})

// Mock git module (for hasRemote used in auto-detect)
mock.module('../../../src/cli/utils/git.ts', {
  namedExports: {
    hasRemote: async () => mockHasRemoteResult,
    isGitInstalled: async () => true,
    isGitRepo: async () => false,
    isDirectoryEmpty: async () => true,
  },
})

// Mock pullViaGit
mock.module('../../../src/cli/utils/pullViaGit.ts', {
  namedExports: {
    pullViaGit: async (...args: unknown[]) => {
      pullViaGitCalled = true
      pullViaGitArgs = args
    },
  },
})

// Mock pullViaTar
mock.module('../../../src/cli/utils/pullViaTar.ts', {
  namedExports: {
    pullViaTar: async (...args: unknown[]) => {
      pullViaTarCalled = true
      pullViaTarArgs = args
    },
  },
})

const {pull} = await import('../../../src/cli/commands/pull.ts')
import {mockCliContext} from '../test-context.ts'

describe('pull command routing', () => {
  const createdDirs: string[] = []

  beforeEach(() => {
    pullViaGitCalled = false
    pullViaTarCalled = false
    pullViaGitArgs = []
    pullViaTarArgs = []
    mockHasRemoteResult = true
    mockResolvedDest = '/tmp/nonexistent-no-git'
  })

  afterEach(async () => {
    await Promise.all(createdDirs.splice(0).map(dir => rm(dir, {recursive: true, force: true})))
  })

  describe('--via option', () => {
    it('routes to pullViaGit when --via=git', async () => {
      await pull(mockCliContext, '/test', undefined, {via: 'git'})
      assert.equal(pullViaGitCalled, true)
      assert.equal(pullViaTarCalled, false)
    })

    it('routes to pullViaTar when --via=tar', async () => {
      await pull(mockCliContext, '/test', undefined, {via: 'tar'})
      assert.equal(pullViaTarCalled, true)
      assert.equal(pullViaGitCalled, false)
    })

    it('passes git option to pullViaTar when --via=tar --no-git', async () => {
      await pull(mockCliContext, '/test', undefined, {via: 'tar', git: false})
      assert.equal(pullViaTarCalled, true)
      assert.deepEqual(pullViaTarArgs[3], {git: false})
    })

    it('passes git default to pullViaTar when --via=tar', async () => {
      await pull(mockCliContext, '/test', undefined, {via: 'tar'})
      assert.equal(pullViaTarCalled, true)
      assert.deepEqual(pullViaTarArgs[3], {git: undefined})
    })

    it('throws on invalid --via value', async () => {
      await assert.rejects(
        async () => pull(mockCliContext, '/test', undefined, {via: 'invalid'}),
        /Invalid --via value/,
      )
    })
  })

  describe('auto-detect routing', () => {
    it('defaults to git when target has no .git dir', async () => {
      // mockResolvedDest points to nonexistent dir, so access(.git) fails → git
      await pull(mockCliContext, '/test')
      assert.equal(pullViaGitCalled, true)
      assert.equal(pullViaTarCalled, false)
    })

    it('uses tar when target is git dir without remote', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'pull-test-'))
      createdDirs.push(dir)
      await mkdir(join(dir, '.git'), {recursive: true})
      mockResolvedDest = dir
      mockHasRemoteResult = false

      await pull(mockCliContext, '/test')
      assert.equal(pullViaTarCalled, true)
      assert.equal(pullViaGitCalled, false)
    })

    it('uses git when target is git dir with remote', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'pull-test-'))
      createdDirs.push(dir)
      await mkdir(join(dir, '.git'), {recursive: true})
      mockResolvedDest = dir
      mockHasRemoteResult = true

      await pull(mockCliContext, '/test')
      assert.equal(pullViaGitCalled, true)
      assert.equal(pullViaTarCalled, false)
    })

    it('passes source and destination through to pullViaGit', async () => {
      await pull(mockCliContext, '/test', 'my-folder')
      assert.equal(pullViaGitCalled, true)
      assert.equal(pullViaGitArgs[1], '/test')
      assert.equal(pullViaGitArgs[2], 'my-folder')
    })

    it('works with no arguments (update mode)', async () => {
      await pull(mockCliContext)
      assert.equal(pullViaGitCalled, true)
      assert.equal(pullViaGitArgs[1], undefined)
    })

    it('passes git option through when auto-detecting tar', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'pull-test-'))
      createdDirs.push(dir)
      await mkdir(join(dir, '.git'), {recursive: true})
      mockResolvedDest = dir
      mockHasRemoteResult = false

      await pull(mockCliContext, '/test', undefined, {git: false})
      assert.equal(pullViaTarCalled, true)
      assert.deepEqual(pullViaTarArgs[3], {git: false})
    })
  })
})
