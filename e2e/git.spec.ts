import {test, expect} from '@playwright/test'
import {spawn} from 'node:child_process'
import {promises as fs} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {randomBytes} from 'node:crypto'
import {waitForEditorReady, switchToTab, clickSave, setEditorContent} from './helpers/editor.js'
import {signup} from './helpers/auth.js'

/**
 * Execute a git command in a directory
 */
async function execGit(cwd: string, args: string[]): Promise<{stdout: string; stderr: string; code: number}> {
  return new Promise(resolve => {
    const git = spawn('git', args, {cwd})
    let stdout = ''
    let stderr = ''

    git.stdout.on('data', data => {
      stdout += data.toString()
    })

    git.stderr.on('data', data => {
      stderr += data.toString()
    })

    git.on('close', code => {
      resolve({stdout, stderr, code: code ?? 1})
    })

    git.on('error', err => {
      resolve({stdout, stderr: err.message, code: 1})
    })
  })
}

test.describe('Git Integration', () => {
  let testDir: string
  let testUsername: string
  let testPassword: string
  let testPath: string
  let editPath: string

  // Increase timeout for git operations
  test.setTimeout(60000)

  test.beforeEach(async ({page}) => {
    // Create temporary directory for git operations
    testDir = join(tmpdir(), `git-test-${randomBytes(8).toString('hex')}`)
    await fs.mkdir(testDir, {recursive: true})

    // Create a test user for this test at a specific document path
    testUsername = `git-test-${Date.now()}`
    testPassword = 'test-password-123'
    testPath = `/playwright-git-test-${Date.now()}`
    editPath = `${testPath}/edit`

    await signup(page, testUsername, testPassword, testPassword, editPath)
    await waitForEditorReady(page)
  })

  test.afterEach(async ({page}) => {
    // Cleanup test directory
    try {
      await fs.rm(testDir, {recursive: true, force: true})
    } catch (error) {
      console.error('Failed to cleanup test directory:', error)
    }

    // Delete the test document
    if (testPath.startsWith('/playwright-') && testPath !== '/') {
      try {
        await page.request.delete(`${editPath}?remove=true`)
      } catch (error) {
        console.error('Failed to delete test document:', error)
      }
    }
  })

  test('should clone a document as a git repository', async ({page}) => {
    // We're already on /edit after login from beforeEach
    // Switch to content tab and add content
    await switchToTab(page, 'content')
    await page.waitForTimeout(1000)

    const editorPanel = page.locator('#content-editor-panel')
    await editorPanel.click()
    await page.keyboard.type('# Hello World')

    // Switch to settings and set title
    await switchToTab(page, 'settings')
    await page.locator('#title-input').fill('Git Clone Test')

    // Save the document
    await clickSave(page)
    await page.waitForTimeout(2000)

    // Clone the repository
    const cloneDir = join(testDir, 'clone1')
    const result = await execGit(testDir, [
      'clone',
      `http://${testUsername}:${testPassword}@localhost:3000${testPath}.git`,
      cloneDir,
    ])

    expect(result.code, `Git clone failed: ${result.stderr}`).toBe(0)

    // Verify files were cloned
    const files = await fs.readdir(cloneDir)
    expect(files).toContain('settings.json')
    // Content file extension depends on content_type setting - check for content.eta or content.md
    const contentFile = files.find(f => f.startsWith('content.'))
    expect(contentFile).toBeDefined()

    // Verify content
    const content = await fs.readFile(join(cloneDir, contentFile!), 'utf-8')
    expect(content).toBe('# Hello World')

    const settings = JSON.parse(await fs.readFile(join(cloneDir, 'settings.json'), 'utf-8'))
    expect(settings.title).toBe('Git Clone Test')
    expect(settings.path).toBe(testPath)
  })

  test('should update document when changes are pushed', async ({page}) => {
    // Already on editor from beforeEach
    // Switch to content tab and add initial content
    await switchToTab(page, 'content')
    await page.waitForTimeout(1000)

    await setEditorContent(page, 'content', '# Original Content')

    // Switch to settings and set title
    await switchToTab(page, 'settings')
    await page.locator('#title-input').fill('Git Push Test')

    // Save the document
    await clickSave(page)
    await page.waitForTimeout(1000)

    // Clone the repository
    const cloneDir = join(testDir, 'clone-push')
    await execGit(testDir, ['clone', `http://${testUsername}:${testPassword}@localhost:3000${testPath}.git`, cloneDir])

    // Find the content file (could be content.eta, content.md, etc.)
    const files = await fs.readdir(cloneDir)
    const contentFile = files.find(f => f.startsWith('content.'))
    expect(contentFile).toBeDefined()

    // Make changes to content
    await fs.writeFile(join(cloneDir, contentFile!), '# Updated Content')

    // Configure git user
    await execGit(cloneDir, ['config', 'user.email', 'test@example.com'])
    await execGit(cloneDir, ['config', 'user.name', 'Test User'])

    // Commit and push changes
    await execGit(cloneDir, ['add', contentFile!])
    await execGit(cloneDir, ['commit', '-m', 'Update content'])
    const pushResult = await execGit(cloneDir, ['push', 'origin', 'main'])

    expect(pushResult.code).toBe(0)

    // Verify changes appear in the UI
    await page.goto(editPath)
    await waitForEditorReady(page)
    await switchToTab(page, 'content')
    await page.waitForTimeout(1000)
    const editorContent = await page.evaluate(() => {
      const ace = (window as {ace?: unknown}).ace
      const panel = document.querySelector('#content-editor-panel')
      if (ace && panel) {
        const editor = (ace as unknown as {edit: (el: Element) => {getValue: () => string}}).edit(panel)
        return editor.getValue()
      }
      return ''
    })
    expect(editorContent).toBe('# Updated Content')
  })

  test('should update settings when settings.json is pushed', async ({page}) => {
    // Already on editor from beforeEach
    // Add initial content
    await switchToTab(page, 'content')
    await page.waitForTimeout(1000)
    await setEditorContent(page, 'content', '# Content')

    // Set title
    await switchToTab(page, 'settings')
    await page.locator('#title-input').fill('Settings Test')

    // Save
    await clickSave(page)
    await page.waitForTimeout(1000)

    // Clone the repository
    const cloneDir = join(testDir, 'clone-settings')
    await execGit(testDir, ['clone', `http://${testUsername}:${testPassword}@localhost:3000${testPath}.git`, cloneDir])

    // Update settings.json
    const settings = JSON.parse(await fs.readFile(join(cloneDir, 'settings.json'), 'utf-8'))
    settings.title = 'Updated Title'
    settings.published = true
    await fs.writeFile(join(cloneDir, 'settings.json'), JSON.stringify(settings, null, 2))

    // Configure git user
    await execGit(cloneDir, ['config', 'user.email', 'test@example.com'])
    await execGit(cloneDir, ['config', 'user.name', 'Test User'])

    // Commit and push changes
    await execGit(cloneDir, ['add', 'settings.json'])
    await execGit(cloneDir, ['commit', '-m', 'Update settings'])
    const pushResult = await execGit(cloneDir, ['push', 'origin', 'main'])

    expect(pushResult.code).toBe(0)

    // Verify changes appear in the UI
    await page.goto(editPath)
    await waitForEditorReady(page)
    await switchToTab(page, 'settings')
    await page.waitForTimeout(1000)
    const titleValue = await page.locator('#title-input').inputValue()
    expect(titleValue).toBe('Updated Title')
  })

  test('should handle multiple file changes in one push', async ({page}) => {
    // Already on editor from beforeEach
    // Add content
    await switchToTab(page, 'content')
    await page.waitForTimeout(1000)
    await setEditorContent(page, 'content', '# Content')

    // Set title
    await switchToTab(page, 'settings')
    await page.locator('#title-input').fill('Multi File Test')

    // Set data
    await switchToTab(page, 'data')
    await page.waitForTimeout(500)
    await setEditorContent(page, 'data', JSON.stringify({foo: 'bar'}))

    // Set style
    await switchToTab(page, 'style')
    await page.waitForTimeout(500)
    await setEditorContent(page, 'style', 'body {}')

    // Save
    await clickSave(page)
    await page.waitForTimeout(1000)

    // Clone the repository
    const cloneDir = join(testDir, 'clone-multi')
    await execGit(testDir, ['clone', `http://${testUsername}:${testPassword}@localhost:3000${testPath}.git`, cloneDir])

    // Find the content file
    const files = await fs.readdir(cloneDir)
    const contentFile = files.find(f => f.startsWith('content.'))
    expect(contentFile).toBeDefined()

    // Make changes to multiple files
    await fs.writeFile(join(cloneDir, contentFile!), '# New Content')
    await fs.writeFile(join(cloneDir, 'data.json'), JSON.stringify({foo: 'baz', new: 'field'}, null, 2))
    await fs.writeFile(join(cloneDir, 'style.css'), 'body { background: blue; }')

    // Configure git user
    await execGit(cloneDir, ['config', 'user.email', 'test@example.com'])
    await execGit(cloneDir, ['config', 'user.name', 'Test User'])

    // Commit and push all changes
    await execGit(cloneDir, ['add', '.'])
    await execGit(cloneDir, ['commit', '-m', 'Update multiple files'])
    const pushResult = await execGit(cloneDir, ['push', 'origin', 'main'])

    expect(pushResult.code).toBe(0)

    // Verify all changes appear in the UI
    await page.goto(editPath)
    await waitForEditorReady(page)

    // Check content
    await switchToTab(page, 'content')
    await page.waitForTimeout(1000)
    const content = await page.evaluate(() => {
      const ace = (window as {ace?: unknown}).ace
      const panel = document.querySelector('#content-editor-panel')
      if (ace && panel) {
        const editor = (ace as unknown as {edit: (el: Element) => {getValue: () => string}}).edit(panel)
        return editor.getValue()
      }
      return ''
    })
    expect(content).toBe('# New Content')

    // Check data
    await switchToTab(page, 'data')
    await page.waitForTimeout(1000)
    const data = await page.evaluate(() => {
      const ace = (window as {ace?: unknown}).ace
      const panel = document.querySelector('#data-editor-panel')
      if (ace && panel) {
        const editor = (ace as unknown as {edit: (el: Element) => {getValue: () => string}}).edit(panel)
        return editor.getValue()
      }
      return ''
    })
    expect(data).toBe(JSON.stringify({foo: 'baz', new: 'field'}, null, 2))

    // Check style
    await switchToTab(page, 'style')
    await page.waitForTimeout(1000)
    const style = await page.evaluate(() => {
      const ace = (window as {ace?: unknown}).ace
      const panel = document.querySelector('#style-editor-panel')
      if (ace && panel) {
        const editor = (ace as unknown as {edit: (el: Element) => {getValue: () => string}}).edit(panel)
        return editor.getValue()
      }
      return ''
    })
    expect(style).toBe('body { background: blue; }')
  })
})
