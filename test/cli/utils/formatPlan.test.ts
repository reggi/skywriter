import {describe, it, beforeEach, afterEach} from 'node:test'
import assert from 'node:assert/strict'
import {formatDocumentPlan, printHeader} from '../../../src/cli/utils/formatPlan.ts'
import type {DocumentPlan} from '../../../src/cli/utils/formatPlan.ts'

// Suppress proc-log output during tests
const logHandler = () => {}

describe('formatPlan', () => {
  beforeEach(() => {
    process.on('log', logHandler)
  })

  afterEach(() => {
    process.removeListener('log', logHandler)
  })

  describe('formatDocumentPlan', () => {
    it('should include label and url in output', () => {
      const plan: DocumentPlan = {
        label: 'Update Main',
        url: 'http://localhost:3000/test-doc',
        files: [],
      }

      const result = formatDocumentPlan(plan)
      assert.ok(result.includes('Update Main'))
      assert.ok(result.includes('http://localhost:3000/test-doc'))
    })

    it('should include archive info when provided', () => {
      const plan: DocumentPlan = {
        label: 'Fetch Main',
        url: 'http://localhost:3000/test-doc',
        archiveInfo: '3.1 KB (a24147f1e6a5)',
        files: [],
      }

      const result = formatDocumentPlan(plan)
      assert.ok(result.includes('3.1 KB (a24147f1e6a5)'))
    })

    it('should show new files with (new) label in summary mode', () => {
      const plan: DocumentPlan = {
        label: 'Test',
        url: 'http://localhost',
        files: [{file: 'content.eta', status: 'new'}],
      }

      const result = formatDocumentPlan(plan)
      assert.ok(result.includes('content.eta'))
      assert.ok(result.includes('(new)'))
    })

    it('should show modified files with (modified) label in summary mode', () => {
      const plan: DocumentPlan = {
        label: 'Test',
        url: 'http://localhost',
        files: [{file: 'style.css', status: 'modified'}],
      }

      const result = formatDocumentPlan(plan)
      assert.ok(result.includes('style.css'))
      assert.ok(result.includes('(modified)'))
    })

    it('should show unchanged files as summary count in summary mode', () => {
      const plan: DocumentPlan = {
        label: 'Test',
        url: 'http://localhost',
        files: [
          {file: 'a.txt', status: 'unchanged'},
          {file: 'b.txt', status: 'unchanged'},
        ],
      }

      const result = formatDocumentPlan(plan)
      assert.ok(result.includes('2 file(s) up to date'))
    })

    it('should show unchanged as "unchanged" when changes exist', () => {
      const plan: DocumentPlan = {
        label: 'Test',
        url: 'http://localhost',
        files: [
          {file: 'new.txt', status: 'new'},
          {file: 'old.txt', status: 'unchanged'},
        ],
      }

      const result = formatDocumentPlan(plan)
      assert.ok(result.includes('1 file(s) unchanged'))
    })

    it('should show remove files with (remove) label', () => {
      const plan: DocumentPlan = {
        label: 'Test',
        url: 'http://localhost',
        files: [{file: 'uploads/old.png', status: 'remove'}],
      }

      const result = formatDocumentPlan(plan)
      assert.ok(result.includes('uploads/old.png'))
      assert.ok(result.includes('(remove)'))
    })

    it('should show ignored files with (ignored) label', () => {
      const plan: DocumentPlan = {
        label: 'Test',
        url: 'http://localhost',
        files: [{file: 'README.md', status: 'ignored'}],
      }

      const result = formatDocumentPlan(plan)
      assert.ok(result.includes('README.md'))
      assert.ok(result.includes('(ignored)'))
    })

    it('should show all files individually when showAllFiles is true', () => {
      const plan: DocumentPlan = {
        label: 'Test',
        url: 'http://localhost',
        files: [
          {file: 'content.eta', status: 'included'},
          {file: 'style.css', status: 'included'},
          {file: 'uploads/new.png', status: 'add'},
        ],
      }

      const result = formatDocumentPlan(plan, {showAllFiles: true})
      assert.ok(result.includes('content.eta'))
      assert.ok(result.includes('style.css'))
      assert.ok(result.includes('uploads/new.png'))
      assert.ok(result.includes('(new)')) // 'add' status shows as 'new' label
    })

    it('should filter out hidden files', () => {
      const plan: DocumentPlan = {
        label: 'Test',
        url: 'http://localhost',
        files: [
          {file: '.DS_Store', status: 'ignored'},
          {file: 'content.eta', status: 'new'},
        ],
      }

      const result = formatDocumentPlan(plan, {hiddenFiles: ['.DS_Store']})
      assert.ok(!result.includes('.DS_Store'))
      assert.ok(result.includes('content.eta'))
    })

    it('should show extra info lines', () => {
      const plan: DocumentPlan = {
        label: 'Test',
        url: 'http://localhost',
        files: [],
        extraInfo: ['add template_path as "/tpl" to settings.json'],
      }

      const result = formatDocumentPlan(plan)
      assert.ok(result.includes('add template_path as "/tpl" to settings.json'))
    })

    it('should handle synced status files', () => {
      const plan: DocumentPlan = {
        label: 'Test',
        url: 'http://localhost',
        files: [{file: 'uploads/photo.jpg', status: 'synced'}],
      }

      const resultSummary = formatDocumentPlan(plan)
      assert.ok(resultSummary.includes('1 file(s) up to date'))

      const resultAll = formatDocumentPlan(plan, {showAllFiles: true})
      assert.ok(resultAll.includes('uploads/photo.jpg'))
      assert.ok(resultAll.includes('(synced)'))
    })

    it('should handle included status without label in showAllFiles', () => {
      const plan: DocumentPlan = {
        label: 'Test',
        url: 'http://localhost',
        files: [{file: 'content.eta', status: 'included'}],
      }

      const result = formatDocumentPlan(plan, {showAllFiles: true})
      assert.ok(result.includes('content.eta'))
      // 'included' should have no label in parentheses
      assert.ok(!result.includes('(included)'))
    })

    it('should show modified status with label in showAllFiles', () => {
      const plan: DocumentPlan = {
        label: 'Test',
        url: 'http://localhost',
        files: [{file: 'style.css', status: 'modified'}],
      }

      const result = formatDocumentPlan(plan, {showAllFiles: true})
      assert.ok(result.includes('style.css'))
      assert.ok(result.includes('(modified)'))
    })

    it('should show remove status with label in showAllFiles', () => {
      const plan: DocumentPlan = {
        label: 'Test',
        url: 'http://localhost',
        files: [{file: 'old.png', status: 'remove'}],
      }

      const result = formatDocumentPlan(plan, {showAllFiles: true})
      assert.ok(result.includes('old.png'))
      assert.ok(result.includes('(remove)'))
    })

    it('should show ignored status with label in showAllFiles', () => {
      const plan: DocumentPlan = {
        label: 'Test',
        url: 'http://localhost',
        files: [{file: 'README.md', status: 'ignored'}],
      }

      const result = formatDocumentPlan(plan, {showAllFiles: true})
      assert.ok(result.includes('README.md'))
      assert.ok(result.includes('(ignored)'))
    })

    it('should show add status as (new) label in showAllFiles', () => {
      const plan: DocumentPlan = {
        label: 'Test',
        url: 'http://localhost',
        files: [{file: 'uploads/new.png', status: 'add'}],
      }

      const result = formatDocumentPlan(plan, {showAllFiles: true})
      assert.ok(result.includes('uploads/new.png'))
      assert.ok(result.includes('(new)'))
    })

    it('should show new status with label in showAllFiles', () => {
      const plan: DocumentPlan = {
        label: 'Test',
        url: 'http://localhost',
        files: [{file: 'content.eta', status: 'new'}],
      }

      const result = formatDocumentPlan(plan, {showAllFiles: true})
      assert.ok(result.includes('content.eta'))
      assert.ok(result.includes('(new)'))
    })

    it('should show unchanged status without label in showAllFiles', () => {
      const plan: DocumentPlan = {
        label: 'Test',
        url: 'http://localhost',
        files: [{file: 'content.eta', status: 'unchanged'}],
      }

      const result = formatDocumentPlan(plan, {showAllFiles: true})
      assert.ok(result.includes('content.eta'))
      assert.ok(!result.includes('(unchanged)'))
    })
  })

  describe('printHeader', () => {
    it('should emit log events with server and page info', () => {
      const capturedLogs: string[] = []
      const capture = (...args: unknown[]) => {
        capturedLogs.push(args.slice(1).join(' '))
      }
      process.removeListener('log', logHandler)
      process.on('log', capture)

      printHeader('https://my-server.com', '/my-page')

      process.removeListener('log', capture)
      process.on('log', logHandler)

      assert.ok(capturedLogs.some(l => l.includes('my-server.com')))
      assert.ok(capturedLogs.some(l => l.includes('/my-page')))
    })
  })
})
