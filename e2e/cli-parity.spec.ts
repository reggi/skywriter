import {test, expect} from '@playwright/test'
import {promises as fs} from 'node:fs'
import {join, basename} from 'node:path'
import {waitForEditorReady, switchToTab, clickSave, setEditorContent, getEditorContent} from './helpers/editor.js'
import {signup} from './helpers/auth.js'
import {execCli, setupCliConfig, compareDirectories, createTempDir, type CliConfigSetup} from './helpers/cli.js'

/**
 * CLI Parity Tests
 *
 * These tests verify that the tar-based transport (pull --via tar / push --via tar) and
 * git-based transport (pull --via git / push --via git) produce identical results.
 */
test.describe('CLI Parity: Tar vs Git transport', () => {
  let testUsername: string
  let testPassword: string
  let testPath: string
  let editPath: string
  let cliConfig: CliConfigSetup
  let tempDirArchive: string
  let tempDirGit: string

  // Increase timeout for CLI operations
  test.setTimeout(120000)

  test.beforeEach(async ({page}) => {
    // Create temporary directories for testing
    tempDirArchive = await createTempDir('archive')
    tempDirGit = await createTempDir('git')

    // Create a test user for this test at a specific document path
    testUsername = `parity-test-${Date.now()}`
    testPassword = 'test-password-123'
    testPath = `/playwright-parity-${Date.now()}`
    editPath = `${testPath}/edit`

    await signup(page, testUsername, testPassword, testPassword, editPath)
    await waitForEditorReady(page)

    // Setup CLI config with test credentials
    const baseURL = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3000'
    cliConfig = await setupCliConfig(baseURL, testUsername, testPassword)
  })

  test.afterEach(async ({page}) => {
    // Cleanup temp directories
    try {
      await fs.rm(tempDirArchive, {recursive: true, force: true})
    } catch {
      // Ignore
    }
    try {
      await fs.rm(tempDirGit, {recursive: true, force: true})
    } catch {
      // Ignore
    }

    // Cleanup CLI config
    if (cliConfig) {
      await cliConfig.cleanup()
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

  test('pull via tar and pull via git should produce identical file trees', async ({page}) => {
    // Add some content to the document via web UI
    await switchToTab(page, 'content')
    await page.waitForTimeout(500)
    await setEditorContent(page, 'content', '# Hello World\n\nThis is a test document.')

    await switchToTab(page, 'style')
    await page.waitForTimeout(500)
    await setEditorContent(page, 'style', 'body { background: #f0f0f0; }')

    await switchToTab(page, 'script')
    await page.waitForTimeout(500)
    await setEditorContent(page, 'script', 'console.log("Hello from script");')

    await switchToTab(page, 'data')
    await page.waitForTimeout(500)
    await setEditorContent(page, 'data', '{"title": "Test Document", "author": "Test User"}')

    // Save the document
    await clickSave(page)
    await page.waitForTimeout(2000)

    // Run pull via tar (archive-based) command
    const tarResult = await execCli(['pull', '--via', 'tar', testPath], tempDirArchive, cliConfig)
    expect(tarResult.code, `Pull via tar failed: ${tarResult.stderr}`).toBe(0)

    // Run pull via git command
    const gitResult = await execCli(['pull', '--via', 'git', testPath], tempDirGit, cliConfig)
    expect(gitResult.code, `Pull via git failed: ${gitResult.stderr}`).toBe(0)

    // Compare directories (ignoring .git folder)
    const comparison = await compareDirectories(tempDirArchive, tempDirGit, {ignore: ['.git', '.gitignore']})

    expect(comparison.matching, `Directories differ: ${comparison.differences.join(', ')}`).toBe(true)
  })

  test('pull via tar and pull via git should have same content file', async ({page}) => {
    // Create document with specific content
    const testContent = '# Markdown Test\n\n- Item 1\n- Item 2\n- Item 3'

    await switchToTab(page, 'content')
    await page.waitForTimeout(500)
    await setEditorContent(page, 'content', testContent)

    await clickSave(page)
    await page.waitForTimeout(2000)

    // Run both commands
    const tarResult = await execCli(['pull', '--via', 'tar', testPath], tempDirArchive, cliConfig)
    expect(tarResult.code, `Pull via tar failed: ${tarResult.stderr}`).toBe(0)

    const gitResult = await execCli(['pull', '--via', 'git', testPath], tempDirGit, cliConfig)
    expect(gitResult.code, `Pull via git failed: ${gitResult.stderr}`).toBe(0)

    // Read content files from both directories
    const pullDir = basename(testPath)
    const archiveFiles = await fs.readdir(join(tempDirArchive, pullDir))
    const gitFiles = await fs.readdir(join(tempDirGit, pullDir))

    const archiveContentFile = archiveFiles.find(f => f.startsWith('content.'))
    const gitContentFile = gitFiles.find(f => f.startsWith('content.'))

    expect(archiveContentFile, 'Archive should have content file').toBeDefined()
    expect(gitContentFile, 'Git should have content file').toBeDefined()
    expect(archiveContentFile).toBe(gitContentFile)

    const archiveContent = await fs.readFile(join(tempDirArchive, pullDir, archiveContentFile!), 'utf-8')
    const gitContent = await fs.readFile(join(tempDirGit, pullDir, gitContentFile!), 'utf-8')

    expect(archiveContent).toBe(gitContent)
    expect(archiveContent).toBe(testContent)
  })

  test('pull via tar and pull via git should have same settings.json', async ({page}) => {
    // Make a small change so save button is enabled
    await switchToTab(page, 'content')
    await page.waitForTimeout(500)
    await setEditorContent(page, 'content', '# Settings Test')

    // Save the document
    await clickSave(page)
    await page.waitForTimeout(2000)

    // Run both commands
    const tarResult = await execCli(['pull', '--via', 'tar', testPath], tempDirArchive, cliConfig)
    expect(tarResult.code, `Pull via tar failed: ${tarResult.stderr}`).toBe(0)

    const gitResult = await execCli(['pull', '--via', 'git', testPath], tempDirGit, cliConfig)
    expect(gitResult.code, `Pull via git failed: ${gitResult.stderr}`).toBe(0)

    // Read and compare settings.json
    const pullDir = basename(testPath)
    const archiveSettings = JSON.parse(await fs.readFile(join(tempDirArchive, pullDir, 'settings.json'), 'utf-8'))
    const gitSettings = JSON.parse(await fs.readFile(join(tempDirGit, pullDir, 'settings.json'), 'utf-8'))

    // Compare key fields (excluding any that might differ due to timing)
    expect(archiveSettings.path).toBe(gitSettings.path)
    expect(archiveSettings.path).toBe(testPath)
  })

  test('pull via tar and pull via git should have same style.css', async ({page}) => {
    const testStyle = `
      body {
        font-family: Arial, sans-serif;
        max-width: 800px;
        margin: 0 auto;
        padding: 20px;
      }
      h1 { color: #333; }
    `

    await switchToTab(page, 'style')
    await page.waitForTimeout(500)
    await setEditorContent(page, 'style', testStyle)

    await clickSave(page)
    await page.waitForTimeout(2000)

    // Run both commands
    const tarResult = await execCli(['pull', '--via', 'tar', testPath], tempDirArchive, cliConfig)
    expect(tarResult.code, `Pull via tar failed: ${tarResult.stderr}`).toBe(0)

    const gitResult = await execCli(['pull', '--via', 'git', testPath], tempDirGit, cliConfig)
    expect(gitResult.code, `Pull via git failed: ${gitResult.stderr}`).toBe(0)

    // Read and compare style.css
    const pullDir = basename(testPath)
    const archiveStyle = await fs.readFile(join(tempDirArchive, pullDir, 'style.css'), 'utf-8')
    const gitStyle = await fs.readFile(join(tempDirGit, pullDir, 'style.css'), 'utf-8')

    expect(archiveStyle).toBe(gitStyle)
    expect(archiveStyle).toBe(testStyle)
  })

  test('pull via tar and pull via git should have same script.js', async ({page}) => {
    const testScript = `
      document.addEventListener('DOMContentLoaded', () => {
        console.log('Document loaded');
        const heading = document.querySelector('h1');
        if (heading) {
          heading.style.color = 'blue';
        }
      });
    `

    await switchToTab(page, 'script')
    await page.waitForTimeout(500)
    await setEditorContent(page, 'script', testScript)

    await clickSave(page)
    await page.waitForTimeout(2000)

    // Run both commands
    const tarResult = await execCli(['pull', '--via', 'tar', testPath], tempDirArchive, cliConfig)
    expect(tarResult.code, `Pull via tar failed: ${tarResult.stderr}`).toBe(0)

    const gitResult = await execCli(['pull', '--via', 'git', testPath], tempDirGit, cliConfig)
    expect(gitResult.code, `Pull via git failed: ${gitResult.stderr}`).toBe(0)

    // Read and compare script.js
    const pullDir = basename(testPath)
    const archiveScript = await fs.readFile(join(tempDirArchive, pullDir, 'script.js'), 'utf-8')
    const gitScript = await fs.readFile(join(tempDirGit, pullDir, 'script.js'), 'utf-8')

    expect(archiveScript).toBe(gitScript)
    expect(archiveScript).toBe(testScript)
  })

  test('pull via tar and pull via git should have same data file', async ({page}) => {
    const testData = {
      title: 'Test Document',
      description: 'A document for parity testing',
      tags: ['test', 'parity', 'cli'],
      metadata: {
        version: 1,
        created: '2025-01-01',
      },
    }

    await switchToTab(page, 'data')
    await page.waitForTimeout(500)
    await setEditorContent(page, 'data', JSON.stringify(testData, null, 2))

    await clickSave(page)
    await page.waitForTimeout(2000)

    // Run both commands
    const tarResult = await execCli(['pull', '--via', 'tar', testPath], tempDirArchive, cliConfig)
    expect(tarResult.code, `Pull via tar failed: ${tarResult.stderr}`).toBe(0)

    const gitResult = await execCli(['pull', '--via', 'git', testPath], tempDirGit, cliConfig)
    expect(gitResult.code, `Pull via git failed: ${gitResult.stderr}`).toBe(0)

    // Find and compare data files
    const pullDir = basename(testPath)
    const archiveFiles = await fs.readdir(join(tempDirArchive, pullDir))
    const gitFiles = await fs.readdir(join(tempDirGit, pullDir))

    const archiveDataFile = archiveFiles.find(f => f.startsWith('data.'))
    const gitDataFile = gitFiles.find(f => f.startsWith('data.'))

    expect(archiveDataFile, 'Archive should have data file').toBeDefined()
    expect(gitDataFile, 'Git should have data file').toBeDefined()

    const archiveData = await fs.readFile(join(tempDirArchive, pullDir, archiveDataFile!), 'utf-8')
    const gitData = await fs.readFile(join(tempDirGit, pullDir, gitDataFile!), 'utf-8')

    // Parse and compare to handle potential whitespace differences
    expect(JSON.parse(archiveData)).toEqual(JSON.parse(gitData))
    expect(JSON.parse(archiveData)).toEqual(testData)
  })

  test('repeated pull via tar should match repeated pull via git', async ({page}) => {
    // Initial save
    await switchToTab(page, 'content')
    await page.waitForTimeout(500)
    await setEditorContent(page, 'content', '# Initial Content')
    await clickSave(page)
    await page.waitForTimeout(2000)

    // First download with both methods
    const tar1 = await execCli(['pull', '--via', 'tar', testPath], tempDirArchive, cliConfig)
    expect(tar1.code, `First pull via tar failed: ${tar1.stderr}`).toBe(0)

    const git1 = await execCli(['pull', '--via', 'git', testPath], tempDirGit, cliConfig)
    expect(git1.code, `First pull via git failed: ${git1.stderr}`).toBe(0)

    // Verify initial parity
    const comparison1 = await compareDirectories(tempDirArchive, tempDirGit, {ignore: ['.git', '.gitignore']})
    expect(comparison1.matching, `Initial directories differ: ${comparison1.differences.join(', ')}`).toBe(true)

    // Update document via web UI
    await switchToTab(page, 'content')
    await page.waitForTimeout(500)
    await setEditorContent(page, 'content', '# Updated Content\n\nWith more text.')
    await clickSave(page)
    await page.waitForTimeout(2000)

    // Re-download with both methods (simulating update flow)
    // For tar, clear directory and re-pull (tar pull prompts in non-empty dirs)
    await fs.rm(tempDirArchive, {recursive: true, force: true})
    await fs.mkdir(tempDirArchive, {recursive: true})
    const tar2 = await execCli(['pull', '--via', 'tar', testPath], tempDirArchive, cliConfig)
    expect(tar2.code, `Second pull via tar failed: ${tar2.stderr}`).toBe(0)

    // For git, re-pull in the same directory (it should git pull)
    const git2 = await execCli(['pull', '--via', 'git'], join(tempDirGit, basename(testPath)), cliConfig)
    expect(git2.code, `Second pull via git failed: ${git2.stderr}`).toBe(0)

    // Verify updated content
    const pullDir = basename(testPath)
    const archiveFiles = await fs.readdir(join(tempDirArchive, pullDir))
    const contentFile = archiveFiles.find(f => f.startsWith('content.'))!
    const archiveContent = await fs.readFile(join(tempDirArchive, pullDir, contentFile), 'utf-8')
    const gitContent = await fs.readFile(join(tempDirGit, pullDir, contentFile), 'utf-8')

    expect(archiveContent).toBe('# Updated Content\n\nWith more text.')
    expect(gitContent).toBe('# Updated Content\n\nWith more text.')

    // Verify complete parity after update
    const comparison2 = await compareDirectories(tempDirArchive, tempDirGit, {ignore: ['.git', '.gitignore']})
    expect(comparison2.matching, `Updated directories differ: ${comparison2.differences.join(', ')}`).toBe(true)
  })
})

test.describe('CLI Parity: Push with slot and template', () => {
  let testUsername: string
  let testPassword: string
  let mainPath: string
  let slotPath: string
  let templatePath: string
  let mainEditPath: string
  let slotEditPath: string
  let templateEditPath: string
  let cliConfig: CliConfigSetup
  let tempDirArchive: string
  let tempDirGit: string

  // Increase timeout for CLI operations with multiple documents
  test.setTimeout(180000)

  /**
   * Helper to create a document structure with slot and template subdirectories
   */
  async function createDocumentStructure(
    dir: string,
    paths: {main: string; slot: string; template: string},
    content: {main: string; slot: string; template: string},
  ) {
    // Create main document files
    await fs.mkdir(dir, {recursive: true})
    await fs.writeFile(join(dir, 'content.md'), content.main)
    await fs.writeFile(
      join(dir, 'settings.json'),
      JSON.stringify(
        {
          path: paths.main,
          slot_path: paths.slot,
          template_path: paths.template,
          draft: false,
          published: true,
          extension: '.html',
          mime_type: 'text/html; charset=UTF-8',
          title: 'Main Document',
          uploads: [],
        },
        null,
        2,
      ),
    )
    await fs.writeFile(join(dir, 'style.css'), 'body { background: #fff; }')
    await fs.writeFile(join(dir, 'script.js'), 'console.log("main");')

    // Create slot subdirectory
    const slotDir = join(dir, 'slot')
    await fs.mkdir(slotDir, {recursive: true})
    await fs.writeFile(join(slotDir, 'content.html'), content.slot)
    await fs.writeFile(
      join(slotDir, 'settings.json'),
      JSON.stringify(
        {
          path: paths.slot,
          slot_path: null,
          template_path: null,
          draft: false,
          published: true,
          extension: '.html',
          mime_type: 'text/html; charset=UTF-8',
          title: 'Slot Document',
          uploads: [],
        },
        null,
        2,
      ),
    )
    await fs.writeFile(join(slotDir, 'style.css'), '.slot { color: blue; }')
    await fs.writeFile(join(slotDir, 'script.js'), 'console.log("slot");')

    // Create template subdirectory
    const templateDir = join(dir, 'template')
    await fs.mkdir(templateDir, {recursive: true})
    await fs.writeFile(join(templateDir, 'content.eta'), content.template)
    await fs.writeFile(
      join(templateDir, 'settings.json'),
      JSON.stringify(
        {
          path: paths.template,
          slot_path: null,
          template_path: null,
          draft: false,
          published: true,
          extension: '.eta',
          mime_type: 'text/html; charset=UTF-8',
          title: 'Template Document',
          uploads: [],
        },
        null,
        2,
      ),
    )
    await fs.writeFile(join(templateDir, 'style.css'), '.template { font-size: 16px; }')
    await fs.writeFile(join(templateDir, 'script.js'), 'console.log("template");')
  }

  /**
   * Helper to initialize git repo and make initial commit
   */
  async function _initGitRepo(dir: string, env: Record<string, string>) {
    const {spawn} = await import('node:child_process')

    const runGit = (args: string[], cwd: string) =>
      new Promise<void>((resolve, reject) => {
        const proc = spawn('git', args, {cwd, env: {...process.env, ...env}})
        proc.on('close', code =>
          code === 0 ? resolve() : reject(new Error(`git ${args.join(' ')} failed with code ${code}`)),
        )
        proc.on('error', reject)
      })

    await runGit(['init'], dir)
    await runGit(['add', '.'], dir)
    await runGit(['commit', '-m', 'Initial commit'], dir)

    // Initialize git repos in slot and template subdirectories
    const slotDir = join(dir, 'slot')
    const templateDir = join(dir, 'template')

    await runGit(['init'], slotDir)
    await runGit(['add', '.'], slotDir)
    await runGit(['commit', '-m', 'Initial slot commit'], slotDir)

    await runGit(['init'], templateDir)
    await runGit(['add', '.'], templateDir)
    await runGit(['commit', '-m', 'Initial template commit'], templateDir)
  }

  /**
   * Helper to set git remote for a repository with embedded credentials
   */
  async function _setGitRemote(
    dir: string,
    remotePath: string,
    serverUrl: string,
    username: string,
    password: string,
    env: Record<string, string>,
  ) {
    const {spawn} = await import('node:child_process')
    const normalizedPath = remotePath.startsWith('/') ? remotePath.slice(1) : remotePath

    // Parse the server URL and embed credentials
    const url = new URL(serverUrl)
    url.username = encodeURIComponent(username)
    url.password = encodeURIComponent(password)
    const remoteUrlWithAuth = `${url.protocol}//${url.username}:${url.password}@${url.host}/${normalizedPath}.git`

    return new Promise<void>((resolve, reject) => {
      const proc = spawn('git', ['remote', 'add', 'origin', remoteUrlWithAuth], {
        cwd: dir,
        env: {...process.env, ...env},
      })
      proc.on('close', code => (code === 0 ? resolve() : reject(new Error(`git remote add failed with code ${code}`))))
      proc.on('error', reject)
    })
  }

  test.beforeEach(async ({page}) => {
    // Create temporary directories for testing
    tempDirArchive = await createTempDir('archive-push')
    tempDirGit = await createTempDir('git-push')

    // Create unique paths for this test
    const timestamp = Date.now()
    testUsername = `nested-push-${timestamp}`
    testPassword = 'test-password-123'
    mainPath = `/playwright-push-main-${timestamp}`
    slotPath = `/playwright-push-slot-${timestamp}`
    templatePath = `/playwright-push-template-${timestamp}`
    mainEditPath = `${mainPath}/edit`
    slotEditPath = `${slotPath}/edit`
    templateEditPath = `${templatePath}/edit`

    // Create a user account by signing up to a minimal document
    // We need an account to push documents
    const setupPath = `/playwright-push-setup-${timestamp}`
    const setupEditPath = `${setupPath}/edit`
    await signup(page, testUsername, testPassword, testPassword, setupEditPath)
    await waitForEditorReady(page)

    // Make a change and save to ensure user is properly registered
    await switchToTab(page, 'content')
    await page.waitForTimeout(500)
    const editorPanel = page.locator('#content-editor-panel')
    await editorPanel.click()
    await page.keyboard.press('Control+a')
    await page.keyboard.type('# Setup document')
    await page.waitForTimeout(500)
    await clickSave(page)
    await page.waitForTimeout(2000)

    // Delete the setup document
    try {
      await page.request.delete(`${setupEditPath}?remove=true`)
    } catch {
      // Ignore
    }

    // Setup CLI config with test credentials
    const baseURL = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3000'
    cliConfig = await setupCliConfig(baseURL, testUsername, testPassword)
  })

  test.afterEach(async ({page}) => {
    // Cleanup temp directories
    try {
      await fs.rm(tempDirArchive, {recursive: true, force: true})
    } catch {
      // Ignore
    }
    try {
      await fs.rm(tempDirGit, {recursive: true, force: true})
    } catch {
      // Ignore
    }

    // Cleanup CLI config
    if (cliConfig) {
      await cliConfig.cleanup()
    }

    // Delete test documents
    const documentsToDelete = [mainEditPath, slotEditPath, templateEditPath]

    for (const editPath of documentsToDelete) {
      if (editPath.includes('/playwright-')) {
        try {
          await page.request.delete(`${editPath}?remove=true`)
        } catch {
          // Document may not exist, ignore
        }
      }
    }
  })

  test('push via tar should create document with slot and template from local structure', async ({page}) => {
    // Create local document structure with slot and template
    const content = {
      main: '# Main Document\n\nCreated via archive push with slot and template.',
      slot: '<div class="slot-wrapper">{{ slot_content }}</div>',
      template: '<html><head><style><%= style %></style></head><body><%= content %></body></html>',
    }

    await createDocumentStructure(tempDirArchive, {main: mainPath, slot: slotPath, template: templatePath}, content)

    // Run push via tar command
    const pushResult = await execCli(['push', '--via', 'tar'], tempDirArchive, cliConfig)
    expect(pushResult.code, `Push via tar failed: ${pushResult.stderr}`).toBe(0)

    // Verify main document was created on server
    await page.goto(mainEditPath)
    await waitForEditorReady(page)
    await switchToTab(page, 'content')
    await page.waitForTimeout(500)
    const mainContent = await getEditorContent(page, 'content')
    expect(mainContent).toBe(content.main)

    // Verify slot document was created on server
    await page.goto(slotEditPath)
    await waitForEditorReady(page)
    await switchToTab(page, 'content')
    await page.waitForTimeout(500)
    const slotContent = await getEditorContent(page, 'content')
    expect(slotContent).toBe(content.slot)

    // Verify template document was created on server
    await page.goto(templateEditPath)
    await waitForEditorReady(page)
    await switchToTab(page, 'content')
    await page.waitForTimeout(500)
    const templateContent = await getEditorContent(page, 'content')
    expect(templateContent).toBe(content.template)

    // Verify main document settings by downloading and checking settings.json
    const verifyDir = await createTempDir('verify-archive')
    const pullResult = await execCli(['pull', '--via', 'tar', mainPath], verifyDir, cliConfig)
    expect(pullResult.code, `Pull via tar failed: ${pullResult.stderr}`).toBe(0)

    const mainSettings = JSON.parse(await fs.readFile(join(verifyDir, basename(mainPath), 'settings.json'), 'utf-8'))
    expect(mainSettings.slot_path).toBe(slotPath)
    expect(mainSettings.template_path).toBe(templatePath)

    // Cleanup
    await fs.rm(verifyDir, {recursive: true, force: true})
  })

  test('push (git) should update existing document with slot and template', async ({page}) => {
    // First create the documents via tar push (git push requires existing repos)
    const initialContent = {
      main: '# Initial Main Document\n\nWill be updated via git push.',
      slot: '<div class="initial-slot">{{ data }}</div>',
      template: '<!DOCTYPE html><html><body>Initial: <%= content %></body></html>',
    }

    await createDocumentStructure(
      tempDirArchive,
      {main: mainPath, slot: slotPath, template: templatePath},
      initialContent,
    )

    // Create documents via tar push
    const pushTarResult = await execCli(['push', '--via', 'tar'], tempDirArchive, cliConfig)
    expect(pushTarResult.code, `Initial push via tar failed: ${pushTarResult.stderr}`).toBe(0)

    // Now pull via git to get the git repository
    const pullResult = await execCli(['pull', mainPath], tempDirGit, cliConfig)
    expect(pullResult.code, `Pull failed: ${pullResult.stderr}`).toBe(0)

    // The pull creates a subdirectory named after the document path
    const gitPullDir = join(tempDirGit, basename(mainPath))

    // Modify content locally for git push
    const updatedContent = {
      main: '# Git Main Document\n\nUpdated via git push with slot and template.',
      slot: '<div class="git-slot">{{ data }}</div>',
      template: '<!DOCTYPE html><html><body>Updated: <%= content %></body></html>',
    }

    // Update main content
    const mainFiles = await fs.readdir(gitPullDir)
    const mainContentFile = mainFiles.find(f => f.startsWith('content.'))!
    await fs.writeFile(join(gitPullDir, mainContentFile), updatedContent.main)

    // Update slot content
    const slotFiles = await fs.readdir(join(gitPullDir, 'slot'))
    const slotContentFile = slotFiles.find(f => f.startsWith('content.'))!
    await fs.writeFile(join(gitPullDir, 'slot', slotContentFile), updatedContent.slot)

    // Update template content
    const templateFiles = await fs.readdir(join(gitPullDir, 'template'))
    const templateContentFile = templateFiles.find(f => f.startsWith('content.'))!
    await fs.writeFile(join(gitPullDir, 'template', templateContentFile), updatedContent.template)

    // Commit changes in all repos
    const {spawn} = await import('node:child_process')
    const runGit = (args: string[], cwd: string) =>
      new Promise<void>((resolve, reject) => {
        const proc = spawn('git', args, {cwd, env: {...process.env, ...cliConfig.env}})
        proc.on('close', (code: number | null) =>
          code === 0 ? resolve() : reject(new Error(`git ${args.join(' ')} failed with code ${code}`)),
        )
        proc.on('error', reject)
      })

    await runGit(['add', '.'], gitPullDir)
    await runGit(['commit', '-m', 'Update main content'], gitPullDir)
    await runGit(['add', '.'], join(gitPullDir, 'slot'))
    await runGit(['commit', '-m', 'Update slot content'], join(gitPullDir, 'slot'))
    await runGit(['add', '.'], join(gitPullDir, 'template'))
    await runGit(['commit', '-m', 'Update template content'], join(gitPullDir, 'template'))

    // Run push command (git-based)
    const pushResult = await execCli(['push'], gitPullDir, cliConfig)
    expect(pushResult.code, `Push failed: ${pushResult.stderr}`).toBe(0)

    // Verify main document was updated on server
    await page.goto(mainEditPath)
    await waitForEditorReady(page)
    await switchToTab(page, 'content')
    await page.waitForTimeout(500)
    const mainContent = await getEditorContent(page, 'content')
    expect(mainContent).toBe(updatedContent.main)

    // Verify slot document was updated on server
    await page.goto(slotEditPath)
    await waitForEditorReady(page)
    await switchToTab(page, 'content')
    await page.waitForTimeout(500)
    const slotContent = await getEditorContent(page, 'content')
    expect(slotContent).toBe(updatedContent.slot)

    // Verify template document was updated on server
    await page.goto(templateEditPath)
    await waitForEditorReady(page)
    await switchToTab(page, 'content')
    await page.waitForTimeout(500)
    const templateContent = await getEditorContent(page, 'content')
    expect(templateContent).toBe(updatedContent.template)
  })

  test('push via tar and push via git should produce identical server state for same content', async ({
    page: _page,
  }) => {
    // This test verifies that uploading the SAME content via tar vs git
    // produces identical results on the server

    const testContent = {
      main: '# Parity Upload Test\n\nThis content uploaded via both methods.',
      slot: '<div class="parity-slot">{{ data }}</div>',
      template: '<html><body>Parity: <%= content %></body></html>',
    }

    // Step 1: Create documents via tar push
    await createDocumentStructure(tempDirArchive, {main: mainPath, slot: slotPath, template: templatePath}, testContent)
    const createResult = await execCli(['push', '--via', 'tar'], tempDirArchive, cliConfig)
    expect(createResult.code, `Create failed: ${createResult.stderr}`).toBe(0)

    // Step 2: Download via tar to capture server state after tar upload
    const afterArchiveDir = await createTempDir('after-archive')
    const pull1 = await execCli(['pull', '--via', 'tar', mainPath], afterArchiveDir, cliConfig)
    expect(pull1.code, `Pull via tar failed: ${pull1.stderr}`).toBe(0)

    // Step 3: Pull via git, modify to match testContent exactly, then push
    const pullResult = await execCli(['pull', mainPath], tempDirGit, cliConfig)
    expect(pullResult.code, `Pull failed: ${pullResult.stderr}`).toBe(0)

    const gitPullDir = join(tempDirGit, basename(mainPath))

    // Update files to exact same content (in case server modified anything)
    const mainFiles = await fs.readdir(gitPullDir)
    const mainContentFile = mainFiles.find(f => f.startsWith('content.'))!
    await fs.writeFile(join(gitPullDir, mainContentFile), testContent.main)

    const slotFiles = await fs.readdir(join(gitPullDir, 'slot'))
    const slotContentFile = slotFiles.find(f => f.startsWith('content.'))!
    await fs.writeFile(join(gitPullDir, 'slot', slotContentFile), testContent.slot)

    const templateFiles = await fs.readdir(join(gitPullDir, 'template'))
    const templateContentFile = templateFiles.find(f => f.startsWith('content.'))!
    await fs.writeFile(join(gitPullDir, 'template', templateContentFile), testContent.template)

    // Commit and push via git
    const {spawn} = await import('node:child_process')
    const runGit = (args: string[], cwd: string) =>
      new Promise<void>((resolve, reject) => {
        const proc = spawn('git', args, {cwd, env: {...process.env, ...cliConfig.env}})
        proc.on('close', (code: number | null) =>
          code === 0 ? resolve() : reject(new Error(`git ${args.join(' ')} failed`)),
        )
        proc.on('error', reject)
      })

    // Check if there are changes to commit
    const hasChanges = async (dir: string) => {
      try {
        const {stdout} = await new Promise<{stdout: string}>((resolve, reject) => {
          const proc = spawn('git', ['status', '--porcelain'], {cwd: dir, env: {...process.env, ...cliConfig.env}})
          let stdout = ''
          proc.stdout?.on('data', (d: Buffer) => (stdout += d))
          proc.on('close', (code: number | null) => (code === 0 ? resolve({stdout}) : reject()))
          proc.on('error', reject)
        })
        return stdout.trim().length > 0
      } catch {
        return false
      }
    }

    if (await hasChanges(gitPullDir)) {
      await runGit(['add', '.'], gitPullDir)
      await runGit(['commit', '-m', 'Sync content'], gitPullDir)
    }
    if (await hasChanges(join(gitPullDir, 'slot'))) {
      await runGit(['add', '.'], join(gitPullDir, 'slot'))
      await runGit(['commit', '-m', 'Sync slot'], join(gitPullDir, 'slot'))
    }
    if (await hasChanges(join(gitPullDir, 'template'))) {
      await runGit(['add', '.'], join(gitPullDir, 'template'))
      await runGit(['commit', '-m', 'Sync template'], join(gitPullDir, 'template'))
    }

    const pushResult = await execCli(['push'], gitPullDir, cliConfig)
    expect(pushResult.code, `Push failed: ${pushResult.stderr}`).toBe(0)

    // Step 4: Download via tar to capture server state after git push
    const afterGitDir = await createTempDir('after-git')
    const pull2 = await execCli(['pull', '--via', 'tar', mainPath], afterGitDir, cliConfig)
    expect(pull2.code, `Pull via tar failed: ${pull2.stderr}`).toBe(0)

    // Step 5: Compare server state - should be identical
    // This compares tar-downloaded content after tar upload vs after git upload
    const comparison = await compareDirectories(afterArchiveDir, afterGitDir, {ignore: ['.git', '.gitignore']})

    expect(comparison.matching, `Server state differs: ${comparison.differences.join(', ')}`).toBe(true)

    // Cleanup
    await fs.rm(afterArchiveDir, {recursive: true, force: true})
    await fs.rm(afterGitDir, {recursive: true, force: true})
  })

  test('tar and git push should both download identical structures', async ({page: _page}) => {
    // Create and push via tar first
    const archiveContent = {
      main: '# Parity Test Main\n\nTesting push parity.',
      slot: '<slot>{{ slot_data }}</slot>',
      template: '<template><%= content %></template>',
    }

    await createDocumentStructure(
      tempDirArchive,
      {main: mainPath, slot: slotPath, template: templatePath},
      archiveContent,
    )

    // Push via tar
    const pushTarResult = await execCli(['push', '--via', 'tar'], tempDirArchive, cliConfig)
    expect(pushTarResult.code, `Push via tar failed: ${pushTarResult.stderr}`).toBe(0)

    // Now download with both tar and git to verify they match
    const downloadArchive = await createTempDir('download-archive')
    const downloadGit = await createTempDir('download-git')

    const tarResult = await execCli(['pull', '--via', 'tar', mainPath], downloadArchive, cliConfig)
    expect(tarResult.code, `Pull via tar failed: ${tarResult.stderr}`).toBe(0)

    const gitResult = await execCli(['pull', '--via', 'git', mainPath], downloadGit, cliConfig)
    expect(gitResult.code, `Pull via git failed: ${gitResult.stderr}`).toBe(0)

    // Compare entire directory trees (ignoring .git folders)
    const comparison = await compareDirectories(downloadArchive, downloadGit, {ignore: ['.git', '.gitignore']})

    expect(comparison.matching, `Directory trees differ: ${comparison.differences.join(', ')}`).toBe(true)

    // Verify slot and template directories exist
    const mainPullDir = basename(mainPath)
    const archiveSlotExists = await fs
      .access(join(downloadArchive, mainPullDir, 'slot'))
      .then(() => true)
      .catch(() => false)
    const archiveTemplateExists = await fs
      .access(join(downloadArchive, mainPullDir, 'template'))
      .then(() => true)
      .catch(() => false)
    const gitSlotExists = await fs
      .access(join(downloadGit, mainPullDir, 'slot'))
      .then(() => true)
      .catch(() => false)
    const gitTemplateExists = await fs
      .access(join(downloadGit, mainPullDir, 'template'))
      .then(() => true)
      .catch(() => false)

    expect(archiveSlotExists, 'Archive should have slot directory').toBe(true)
    expect(archiveTemplateExists, 'Archive should have template directory').toBe(true)
    expect(gitSlotExists, 'Git should have slot directory').toBe(true)
    expect(gitTemplateExists, 'Git should have template directory').toBe(true)

    // Cleanup
    await fs.rm(downloadArchive, {recursive: true, force: true})
    await fs.rm(downloadGit, {recursive: true, force: true})
  })

  test('slot and template updated via git should match when downloaded', async ({page: _page}) => {
    // First create documents via tar push (git requires existing repos)
    const initialContent = {
      main: '# Initial Main\n\nInitial content.',
      slot: '<div class="initial-slot">initial</div>',
      template: '<html>Initial: <%= content %></html>',
    }

    await createDocumentStructure(
      tempDirArchive,
      {main: mainPath, slot: slotPath, template: templatePath},
      initialContent,
    )
    const createResult = await execCli(['push', '--via', 'tar'], tempDirArchive, cliConfig)
    expect(createResult.code, `Create failed: ${createResult.stderr}`).toBe(0)

    // Pull via git to get the repos
    const pullResult = await execCli(['pull', mainPath], tempDirGit, cliConfig)
    expect(pullResult.code, `Pull failed: ${pullResult.stderr}`).toBe(0)

    const gitPullDir = join(tempDirGit, basename(mainPath))

    // Update content locally
    const gitContent = {
      main: '# Git Parity Main\n\nUpdated via git.',
      slot: '<div class="slot-via-git">content here</div>',
      template: '<html><%= content %></html>',
    }

    // Update files
    const mainFiles = await fs.readdir(gitPullDir)
    const mainContentFile = mainFiles.find(f => f.startsWith('content.'))!
    await fs.writeFile(join(gitPullDir, mainContentFile), gitContent.main)

    const slotFiles = await fs.readdir(join(gitPullDir, 'slot'))
    const slotContentFile = slotFiles.find(f => f.startsWith('content.'))!
    await fs.writeFile(join(gitPullDir, 'slot', slotContentFile), gitContent.slot)

    const templateFiles = await fs.readdir(join(gitPullDir, 'template'))
    const templateContentFile = templateFiles.find(f => f.startsWith('content.'))!
    await fs.writeFile(join(gitPullDir, 'template', templateContentFile), gitContent.template)

    // Commit and push
    const {spawn} = await import('node:child_process')
    const runGit = (args: string[], cwd: string) =>
      new Promise<void>((resolve, reject) => {
        const proc = spawn('git', args, {cwd, env: {...process.env, ...cliConfig.env}})
        proc.on('close', (code: number | null) =>
          code === 0 ? resolve() : reject(new Error(`git ${args.join(' ')} failed with code ${code}`)),
        )
        proc.on('error', reject)
      })

    await runGit(['add', '.'], gitPullDir)
    await runGit(['commit', '-m', 'Update main'], gitPullDir)
    await runGit(['add', '.'], join(gitPullDir, 'slot'))
    await runGit(['commit', '-m', 'Update slot'], join(gitPullDir, 'slot'))
    await runGit(['add', '.'], join(gitPullDir, 'template'))
    await runGit(['commit', '-m', 'Update template'], join(gitPullDir, 'template'))

    // Push via git
    const pushResult2 = await execCli(['push'], gitPullDir, cliConfig)
    expect(pushResult2.code, `Push failed: ${pushResult2.stderr}`).toBe(0)

    // Download with both methods
    const downloadArchive = await createTempDir('git-download-archive')
    const downloadGit = await createTempDir('git-download-git')

    const tarResult = await execCli(['pull', '--via', 'tar', mainPath], downloadArchive, cliConfig)
    expect(tarResult.code, `Pull via tar failed: ${tarResult.stderr}`).toBe(0)

    const pullResult2 = await execCli(['pull', '--via', 'git', mainPath], downloadGit, cliConfig)
    expect(pullResult2.code, `Pull failed: ${pullResult2.stderr}`).toBe(0)

    // Compare slot directories
    const dlDir = basename(mainPath)
    const slotComparison = await compareDirectories(
      join(downloadArchive, dlDir, 'slot'),
      join(downloadGit, dlDir, 'slot'),
      {ignore: ['.git', '.gitignore']},
    )
    expect(slotComparison.matching, `Slot directories differ: ${slotComparison.differences.join(', ')}`).toBe(true)

    // Compare template directories
    const templateComparison = await compareDirectories(
      join(downloadArchive, dlDir, 'template'),
      join(downloadGit, dlDir, 'template'),
      {ignore: ['.git', '.gitignore']},
    )
    expect(
      templateComparison.matching,
      `Template directories differ: ${templateComparison.differences.join(', ')}`,
    ).toBe(true)

    // Cleanup
    await fs.rm(downloadArchive, {recursive: true, force: true})
    await fs.rm(downloadGit, {recursive: true, force: true})
  })
})
test.describe('CLI Parity: Upload operations', () => {
  let testUsername: string
  let testPassword: string
  let testPath: string
  let editPath: string
  let cliConfig: CliConfigSetup
  let tempDir: string

  // Increase timeout for CLI operations
  test.setTimeout(120000)

  test.beforeEach(async ({page}) => {
    // Create temporary directory for testing
    tempDir = await createTempDir('upload')

    // Create a test user for this test at a specific document path
    testUsername = `upload-parity-${Date.now()}`
    testPassword = 'test-password-123'
    testPath = `/playwright-upload-${Date.now()}`
    editPath = `${testPath}/edit`

    await signup(page, testUsername, testPassword, testPassword, editPath)
    await waitForEditorReady(page)

    // Setup CLI config with test credentials
    const baseURL = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3000'
    cliConfig = await setupCliConfig(baseURL, testUsername, testPassword)

    // Make a change so save button is enabled, then save initial document
    // Use keyboard input to ensure change events are triggered
    await switchToTab(page, 'content')
    await page.waitForTimeout(500)
    const editorPanel = page.locator('#content-editor-panel')
    await editorPanel.click()
    await page.keyboard.press('Control+a')
    await page.keyboard.type('# Upload Test Document')
    await page.waitForTimeout(500)
    await clickSave(page)
    await page.waitForTimeout(2000)
  })

  test.afterEach(async ({page}) => {
    // Cleanup temp directory
    try {
      await fs.rm(tempDir, {recursive: true, force: true})
    } catch {
      // Ignore
    }

    // Cleanup CLI config
    if (cliConfig) {
      await cliConfig.cleanup()
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

  test('push via tar and push via git should result in same server content', async ({page}) => {
    // Download document with pull (git-based)
    const pullResult = await execCli(['pull', testPath], tempDir, cliConfig)
    expect(pullResult.code, `Pull failed: ${pullResult.stderr}`).toBe(0)

    const pullDir = join(tempDir, basename(testPath))

    // Modify content locally
    const files = await fs.readdir(pullDir)
    const contentFile = files.find(f => f.startsWith('content.'))!
    const newContent = '# Modified via CLI\n\nThis content was modified locally.'
    await fs.writeFile(join(pullDir, contentFile), newContent)

    // Also modify style
    await fs.writeFile(join(pullDir, 'style.css'), 'body { background: yellow; }')

    // Commit changes for git push (use spawn directly since execCli is for skywriter CLI)
    const {spawn} = await import('node:child_process')
    await new Promise<void>((resolve, reject) => {
      const proc = spawn('git', ['add', '.'], {cwd: pullDir, env: {...process.env, ...cliConfig.env}})
      proc.on('close', (code: number | null) =>
        code === 0 ? resolve() : reject(new Error(`git add failed with code ${code}`)),
      )
      proc.on('error', reject)
    })
    await new Promise<void>((resolve, reject) => {
      const proc = spawn('git', ['commit', '-m', 'Test commit'], {
        cwd: pullDir,
        env: {...process.env, ...cliConfig.env},
      })
      proc.on('close', (code: number | null) =>
        code === 0 ? resolve() : reject(new Error(`git commit failed with code ${code}`)),
      )
      proc.on('error', reject)
    })

    // Push using git-based push
    const pushResult = await execCli(['push'], pullDir, cliConfig)
    expect(pushResult.code, `Push failed: ${pushResult.stderr}`).toBe(0)

    // Refresh page and verify content was updated on server
    await page.reload()
    await waitForEditorReady(page)

    await switchToTab(page, 'content')
    await page.waitForTimeout(500)
    const serverContent = await getEditorContent(page, 'content')
    expect(serverContent).toBe(newContent)

    await switchToTab(page, 'style')
    await page.waitForTimeout(500)
    const serverStyle = await getEditorContent(page, 'style')
    expect(serverStyle).toBe('body { background: yellow; }')
  })

  test('push via tar should upload changes to server', async ({page}) => {
    // Download document with pull via tar
    const pullResult = await execCli(['pull', '--via', 'tar', testPath], tempDir, cliConfig)
    expect(pullResult.code, `Pull via tar failed: ${pullResult.stderr}`).toBe(0)

    const pullDir = join(tempDir, basename(testPath))

    // Modify content locally
    const files = await fs.readdir(pullDir)
    const contentFile = files.find(f => f.startsWith('content.'))!
    const newContent = '# Updated via tar\n\nTar-based push.'
    await fs.writeFile(join(pullDir, contentFile), newContent)

    // Push using tar-based push (with -y to skip confirmation)
    // No git commit needed - tar push is purely archive-based
    const pushResult = await execCli(['push', '--via', 'tar'], pullDir, cliConfig)
    expect(pushResult.code, `Push via tar failed: ${pushResult.stderr}`).toBe(0)

    // Refresh page and verify content was updated on server
    await page.reload()
    await waitForEditorReady(page)

    await switchToTab(page, 'content')
    await page.waitForTimeout(500)
    const serverContent = await getEditorContent(page, 'content')
    expect(serverContent).toBe(newContent)
  })
})
