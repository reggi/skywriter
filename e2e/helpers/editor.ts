import {Page, Locator} from '@playwright/test'

/**
 * Helper function to wait for editor to be fully initialized
 * @param page Playwright page instance
 */
export async function waitForEditorReady(page: Page): Promise<void> {
  // Wait for key editor elements to be present and visible
  // Check for #slug first (it's in the header and always visible)
  await page.waitForSelector('#slug', {state: 'visible'})
  await page.waitForSelector('#save-btn', {state: 'visible'})
  await page.waitForSelector('#publish-btn', {state: 'visible'})

  // Wait for editor panels to be present
  await page.waitForSelector('#content-editor-panel', {state: 'attached', timeout: 10000})

  // Give editors time to initialize
  await page.waitForTimeout(1500)
}

/**
 * Helper function to get editor tab button
 * @param page Playwright page instance
 * @param tabName Name of the tab (content, data, style, script, server, settings)
 */
export function getTabButton(page: Page, tabName: string): Locator {
  return page.locator(`.tab-button[data-tab="${tabName}"]`)
}

/**
 * Helper function to switch to a specific editor tab
 * @param page Playwright page instance
 * @param tabName Name of the tab to switch to
 */
export async function switchToTab(page: Page, tabName: string): Promise<void> {
  const tabButton = getTabButton(page, tabName)
  await tabButton.click()

  // Wait for tab content to be visible
  await page.waitForSelector(`.tab-content[data-tab-content="${tabName}"].active`, {
    state: 'visible',
  })
}

/**
 * Helper function to get the ACE editor content
 * @param page Playwright page instance
 * @param editorId ID of the editor (content, data, style, script, server)
 */
export async function getEditorContent(page: Page, editorId: string): Promise<string> {
  // Since editors object isn't exposed to window, use ACE directly
  // to get the editor from the panel element
  return await page.evaluate(id => {
    const ace = (window as Window & {ace?: {edit: (el: Element) => {getValue: () => string}}}).ace
    if (!ace) {
      console.log('ACE not available')
      return ''
    }

    // Get the editor panel element
    const panelId = `${id}-editor-panel`
    const panel = document.querySelector(`#${panelId}`)

    if (!panel) {
      console.log(`Panel not found: #${panelId}`)
      return ''
    }

    // Use ACE's edit method to get the editor instance for this element
    try {
      const editor = ace.edit(panel)
      if (editor && typeof editor.getValue === 'function') {
        return editor.getValue()
      }
      console.log(`Editor for ${id} doesn't have getValue method`)
      return ''
    } catch (e) {
      console.log(`Error getting editor for ${id}:`, e)
      return ''
    }
  }, editorId)
}

/**
 * Helper function to set the ACE editor content
 * @param page Playwright page instance
 * @param editorId ID of the editor
 * @param content Content to set
 */
export async function setEditorContent(page: Page, editorId: string, content: string): Promise<void> {
  // Use ACE's setValue API directly for reliable content replacement
  await page.evaluate(
    ({id, newContent}) => {
      const ace = (window as Window & {ace?: {edit: (el: Element) => {setValue: (v: string, pos: number) => void}}}).ace
      if (!ace) {
        throw new Error('ACE not available')
      }

      const panelId = `${id}-editor-panel`
      const panel = document.querySelector(`#${panelId}`)

      if (!panel) {
        throw new Error(`Panel not found: #${panelId}`)
      }

      const editor = ace.edit(panel)
      if (editor && typeof editor.setValue === 'function') {
        editor.setValue(newContent, 1) // 1 moves cursor to end
      } else {
        throw new Error(`Editor for ${id} doesn't have setValue method`)
      }
    },
    {id: editorId, newContent: content},
  )
}

/**
 * Helper function to wait for save button to be enabled/disabled
 * @param page Playwright page instance
 * @param enabled Whether the button should be enabled
 */
export async function waitForSaveButtonState(page: Page, enabled: boolean): Promise<void> {
  const saveButton = page.locator('#save-btn')
  if (enabled) {
    await saveButton.waitFor({state: 'visible'})
    // Wait for button to not be disabled
    await page.waitForFunction(selector => {
      const btn = document.querySelector(selector) as HTMLButtonElement
      return btn && !btn.disabled
    }, '#save-btn')
  } else {
    await saveButton.waitFor({state: 'visible'})
    // Wait for button to be disabled
    await page.waitForFunction(selector => {
      const btn = document.querySelector(selector) as HTMLButtonElement
      return btn && btn.disabled
    }, '#save-btn')
  }
}

/**
 * Helper function to click the save button
 * @param page Playwright page instance
 */
export async function clickSave(page: Page): Promise<void> {
  const saveButton = page.locator('#save-btn')
  await saveButton.click()

  // Wait for save to complete (button should become disabled briefly, then re-enabled if there are more changes)
  await page.waitForTimeout(500)
}

/**
 * Helper function to click the publish button
 * @param page Playwright page instance
 */
export async function clickPublish(page: Page): Promise<void> {
  const publishButton = page.locator('#publish-btn')
  await publishButton.click()

  // Wait for publish to complete
  await page.waitForTimeout(500)
}

/**
 * Helper function to click the revert button
 * @param page Playwright page instance
 */
export async function clickRevert(page: Page): Promise<void> {
  const revertButton = page.locator('#revert-btn')
  await revertButton.click()

  // Wait for revert to complete
  await page.waitForTimeout(500)
}

/**
 * Helper function to wait for revert button to be enabled/disabled
 * @param page Playwright page instance
 * @param enabled Whether the button should be enabled
 */
export async function waitForRevertButtonState(page: Page, enabled: boolean): Promise<void> {
  const revertButton = page.locator('#revert-btn')
  if (enabled) {
    await revertButton.waitFor({state: 'visible'})
    await page.waitForFunction(selector => {
      const btn = document.querySelector(selector) as HTMLButtonElement
      return btn && !btn.disabled
    }, '#revert-btn')
  } else {
    await revertButton.waitFor({state: 'visible'})
    await page.waitForFunction(selector => {
      const btn = document.querySelector(selector) as HTMLButtonElement
      return btn && btn.disabled
    }, '#revert-btn')
  }
}

/**
 * Helper function to get the preview iframe content
 * @param page Playwright page instance
 */
export async function getPreviewContent(page: Page): Promise<string> {
  const previewFrame = page.frameLocator('#preview')
  return await previewFrame.locator('body').innerHTML()
}

/**
 * Helper function to wait for auto-save (draft) to complete
 * @param page Playwright page instance
 * @param timeout Maximum time to wait in milliseconds
 */
export async function waitForAutoSave(page: Page, timeout: number = 10000): Promise<void> {
  // Wait for network request to complete by intercepting the draft save request
  const responsePromise = page
    .waitForResponse(
      response => {
        const url = response.url()
        const method = response.request().method()
        // Check if this is a POST request to the edit endpoint with draft: true
        return method === 'POST' && (url.includes('/edit') || url.endsWith('/edit')) && response.status() === 200
      },
      {timeout},
    )
    .catch(() => {
      // If we can't intercept the request, just wait for the debounce + network time
      // The debounce is 400ms, so wait at least 2 seconds to be safe
    })

  // Also wait for the "Draft Saved!" status message if it appears
  const statusPromise = page
    .waitForFunction(
      () => {
        // Check if status element contains "Draft Saved!" or if the save operation completed
        const statusEl =
          document.querySelector('[data-status]') ||
          document.querySelector('.status') ||
          document.querySelector('#status')
        if (statusEl) {
          const text = statusEl.textContent || ''
          return text.includes('Draft Saved!') || text.includes('Saved')
        }
        return false
      },
      {timeout: 3000},
    )
    .catch(() => {
      // Status message might not appear, that's okay
    })

  // Wait for either the network response or status message
  await Promise.race([responsePromise, statusPromise])

  // Additional wait to ensure the save request has fully completed
  await page.waitForTimeout(1000)
}

/**
 * Helper function to set content in a specific editor tab
 * @param page Playwright page instance
 * @param tabName Name of the tab (content, data, style, script, server)
 * @param content Content to set
 */
export async function setEditorContentInTab(page: Page, tabName: string, content: string): Promise<void> {
  // Switch to the tab
  await switchToTab(page, tabName)

  // Wait for editor to be ready
  await page.waitForTimeout(500)

  // Set content directly using ACE API instead of keyboard simulation
  // This is more reliable than keyboard events
  await page.evaluate(
    ({editorId, newContent}) => {
      const ace = (window as Window & {ace?: {edit: (el: Element) => {setValue: (v: string, pos: number) => void}}}).ace
      if (!ace) {
        throw new Error('ACE not available')
      }

      const panelId = `${editorId}-editor-panel`
      const panel = document.querySelector(`#${panelId}`)

      if (!panel) {
        throw new Error(`Panel not found: #${panelId}`)
      }

      const editor = ace.edit(panel)
      if (editor && typeof editor.setValue === 'function') {
        editor.setValue(newContent, -1) // -1 moves cursor to start
      } else {
        throw new Error(`Editor for ${editorId} not found or invalid`)
      }
    },
    {editorId: tabName, newContent: content},
  )

  // Wait a bit for the change to register
  await page.waitForTimeout(300)
}

/**
 * Template values for generating editor content
 */
export interface EditorTemplateValues {
  content?: string | number
  data?: string | number
  style?: string | number
  script?: string | number
  server?: string | number
}

/**
 * Generated editor content from template values
 */
export interface EditorContent {
  content: string
  data: string
  style: string
  script: string
  server: string
}

/**
 * Generate editor content from template values
 * @param values Simple values to insert into templates
 * @returns Full content for each editor
 */
export function generateEditorContent(values: EditorTemplateValues): EditorContent {
  const contentValue = values.content ?? 'default'
  const dataValue = values.data ?? 42
  const styleValue = values.style ?? 800
  const scriptValue = values.script ?? 'hello'
  const serverValue = values.server ?? '"test"'

  return {
    content: `# Hello World\n\nMy name is ${contentValue}`,
    data: `{\n  "key": "value",\n  "number": ${dataValue}\n}`,
    style: `body {\n  font-family: system-ui, -apple-system, sans-serif;\n  max-width: ${styleValue}px;\n  margin: 0 auto;\n  padding: 2rem;\n  line-height: 1.6;\n}`,
    script: `console.log("test ${scriptValue}");`,
    server: `export default function handler(req) {\n  return { body: ${serverValue} };\n}`,
  }
}

/**
 * Set all editor content using template values
 * @param page Playwright page instance
 * @param values Simple values to insert into templates
 * @returns The generated content that was set
 */
export async function setAllEditors(page: Page, values: EditorTemplateValues): Promise<EditorContent> {
  const content = generateEditorContent(values)

  // Set content in each editor
  await setEditorContentInTab(page, 'content', content.content)
  await setEditorContentInTab(page, 'data', content.data)
  await setEditorContentInTab(page, 'style', content.style)
  await setEditorContentInTab(page, 'script', content.script)
  await setEditorContentInTab(page, 'server', content.server)

  return content
}

/**
 * Get all editor content
 * @param page Playwright page instance
 * @returns Content from all editors
 */
export async function getAllEditorContent(page: Page): Promise<EditorContent> {
  // Switch to each tab and get content
  await switchToTab(page, 'content')
  await page.waitForTimeout(500)
  const content = await getEditorContent(page, 'content')

  await switchToTab(page, 'data')
  await page.waitForTimeout(500)
  const data = await getEditorContent(page, 'data')

  await switchToTab(page, 'style')
  await page.waitForTimeout(500)
  const style = await getEditorContent(page, 'style')

  await switchToTab(page, 'script')
  await page.waitForTimeout(500)
  const script = await getEditorContent(page, 'script')

  await switchToTab(page, 'server')
  await page.waitForTimeout(500)
  const server = await getEditorContent(page, 'server')

  return {content, data, style, script, server}
}
