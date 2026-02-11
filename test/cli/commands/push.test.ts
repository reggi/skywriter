import {describe, it, mock, beforeEach} from 'node:test'
import assert from 'node:assert/strict'

// Track which transport was called
let pushViaGitCalled = false
let pushViaTarCalled = false
let _pushViaGitArgs: unknown[] = []
let pushViaTarArgs: unknown[] = []

// Control auto-detect behavior
let mockIsEmpty = false
let mockIsRepo = true
let mockHasRemoteResult = true

// Mock git module
mock.module('../../../src/cli/utils/git.ts', {
  namedExports: {
    isDirectoryEmpty: async () => mockIsEmpty,
    isGitRepo: async () => mockIsRepo,
    isGitInstalled: async () => true,
    hasRemote: async () => mockHasRemoteResult,
  },
})

// Mock pullViaGit
mock.module('../../../src/cli/utils/pullViaGit.ts', {
  namedExports: {
    pullViaGit: async () => {},
  },
})

// Mock pushViaGit
mock.module('../../../src/cli/utils/pushViaGit.ts', {
  namedExports: {
    pushViaGit: async (...args: unknown[]) => {
      pushViaGitCalled = true
      _pushViaGitArgs = args
    },
  },
})

// Mock pushViaTar
mock.module('../../../src/cli/utils/pushViaTar.ts', {
  namedExports: {
    pushViaTar: async (...args: unknown[]) => {
      pushViaTarCalled = true
      pushViaTarArgs = args
    },
  },
})

const {push} = await import('../../../src/cli/commands/push.ts')
import {mockCliContext} from '../test-context.ts'

describe('push command routing', () => {
  beforeEach(() => {
    pushViaGitCalled = false
    pushViaTarCalled = false
    _pushViaGitArgs = []
    pushViaTarArgs = []
    mockIsEmpty = false
    mockIsRepo = true
    mockHasRemoteResult = true
  })

  describe('--via option', () => {
    it('routes to pushViaGit when --via=git', async () => {
      await push(mockCliContext, undefined, {via: 'git'})
      assert.equal(pushViaGitCalled, true)
      assert.equal(pushViaTarCalled, false)
    })

    it('routes to pushViaTar when --via=tar', async () => {
      await push(mockCliContext, '/test', {via: 'tar'})
      assert.equal(pushViaTarCalled, true)
      assert.equal(pushViaGitCalled, false)
    })

    it('throws on invalid --via value', async () => {
      await assert.rejects(async () => push(mockCliContext, undefined, {via: 'invalid'}), /Invalid --via value/)
    })
  })

  describe('--no-git option', () => {
    it('routes to pushViaTar when --no-git is set', async () => {
      await push(mockCliContext, '/test', {git: false})
      assert.equal(pushViaTarCalled, true)
      assert.equal(pushViaGitCalled, false)
    })

    it('throws when --no-git and --via=git are both set', async () => {
      await assert.rejects(
        async () => push(mockCliContext, undefined, {via: 'git', git: false}),
        /Cannot use --no-git with --via=git/,
      )
    })

    it('passes ctx through to pushViaTar when --no-git', async () => {
      const customCtx = {...mockCliContext, prompt: true}
      await push(customCtx, '/test', {git: false})
      assert.equal(pushViaTarCalled, true)
      assert.equal(pushViaTarArgs[0], customCtx)
      assert.equal(pushViaTarArgs[1], '/test')
    })

    it('--no-git with --via=tar is fine (both imply tar)', async () => {
      await push(mockCliContext, '/test', {via: 'tar', git: false})
      assert.equal(pushViaTarCalled, true)
      assert.equal(pushViaGitCalled, false)
    })
  })

  describe('auto-detect', () => {
    it('defaults to git for empty directory', async () => {
      mockIsEmpty = true
      await push(mockCliContext)
      assert.equal(pushViaGitCalled, true)
    })

    it('uses git when directory has .git with remote', async () => {
      mockIsEmpty = false
      mockIsRepo = true
      mockHasRemoteResult = true
      await push(mockCliContext)
      assert.equal(pushViaGitCalled, true)
    })

    it('uses tar when directory has .git without remote', async () => {
      mockIsEmpty = false
      mockIsRepo = true
      mockHasRemoteResult = false
      await push(mockCliContext)
      assert.equal(pushViaTarCalled, true)
    })

    it('uses tar when directory has no .git', async () => {
      mockIsEmpty = false
      mockIsRepo = false
      await push(mockCliContext)
      assert.equal(pushViaTarCalled, true)
    })
  })
})
