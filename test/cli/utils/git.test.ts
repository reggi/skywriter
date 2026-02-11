import {describe, it, beforeEach, afterEach} from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp, rm, writeFile, mkdir} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {isGitInstalled, isGitRepo, isDirectoryEmpty, hasRemote} from '../../../src/cli/utils/git.ts'
import {execSync} from 'node:child_process'

describe('git utilities', () => {
  let originalCwd: string
  const createdDirs: string[] = []

  beforeEach(() => {
    originalCwd = process.cwd()
  })

  afterEach(async () => {
    process.chdir(originalCwd)
    await Promise.all(
      createdDirs.splice(0).map(async dir => {
        await rm(dir, {recursive: true, force: true})
      }),
    )
  })

  describe('isGitInstalled', () => {
    it('returns true when git is available', async () => {
      const result = await isGitInstalled()
      assert.strictEqual(result, true)
    })
  })

  describe('isGitRepo', () => {
    it('returns true when .git directory exists', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'git-test-'))
      createdDirs.push(dir)
      process.chdir(dir)

      await mkdir(join(dir, '.git'))

      const result = await isGitRepo()
      assert.strictEqual(result, true)
    })

    it('returns false when .git directory does not exist', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'git-test-'))
      createdDirs.push(dir)
      process.chdir(dir)

      const result = await isGitRepo()
      assert.strictEqual(result, false)
    })
  })

  describe('isDirectoryEmpty', () => {
    it('returns true for empty directory', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'git-test-'))
      createdDirs.push(dir)
      process.chdir(dir)

      const result = await isDirectoryEmpty()
      assert.strictEqual(result, true)
    })

    it('returns false when directory has files', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'git-test-'))
      createdDirs.push(dir)
      process.chdir(dir)

      await writeFile(join(dir, 'file.txt'), 'content')

      const result = await isDirectoryEmpty()
      assert.strictEqual(result, false)
    })

    it('ignores .git and .DS_Store', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'git-test-'))
      createdDirs.push(dir)
      process.chdir(dir)

      await mkdir(join(dir, '.git'))
      await writeFile(join(dir, '.DS_Store'), '')

      const result = await isDirectoryEmpty()
      assert.strictEqual(result, true)
    })
  })

  describe('hasRemote', () => {
    it('returns true when git repo has a remote', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'git-test-'))
      createdDirs.push(dir)

      execSync('git init', {cwd: dir, stdio: 'ignore'})
      execSync('git remote add origin https://example.com/repo.git', {cwd: dir, stdio: 'ignore'})

      const result = await hasRemote(dir)
      assert.strictEqual(result, true)
    })

    it('returns false when git repo has no remote', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'git-test-'))
      createdDirs.push(dir)

      execSync('git init', {cwd: dir, stdio: 'ignore'})

      const result = await hasRemote(dir)
      assert.strictEqual(result, false)
    })

    it('returns false when directory is not a git repo', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'git-test-'))
      createdDirs.push(dir)

      const result = await hasRemote(dir)
      assert.strictEqual(result, false)
    })

    it('returns false for non-existent directory', async () => {
      const result = await hasRemote('/non-existent-path-12345')
      assert.strictEqual(result, false)
    })
  })
})
