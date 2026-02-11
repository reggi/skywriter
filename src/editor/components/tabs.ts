import type {EditorModule, Editors} from '../utils/types.ts'

interface TabFilenames {
  content: string
  data: string
  style: string
  script: string
  server: string
  settings: string
}

/**
 * Update tab button text with filenames
 */
function updateTabFilenames(filenames: TabFilenames) {
  const tabMapping: Record<keyof TabFilenames, string> = {
    content: 'content',
    data: 'data',
    style: 'style',
    script: 'script',
    server: 'server',
    settings: 'settings',
  }

  for (const [key, filename] of Object.entries(filenames) as [keyof TabFilenames, string][]) {
    const button = document.querySelector(`[data-tab="${tabMapping[key]}"]`)
    if (button) {
      button.textContent = filename
    }
  }
}

// Apply state classes for a single tab button
function applyTabState(tabName: string, tabState: {hasDraft: boolean; isEmpty: boolean}) {
  const button = document.querySelector(`[data-tab="${tabName}"]`)
  if (!button) return

  button.classList.remove('has-draft', 'is-empty', 'has-content')

  if (tabState.hasDraft) button.classList.add('has-draft')
  if (tabState.isEmpty) {
    button.classList.add('is-empty')
  } else {
    button.classList.add('has-content')
  }
}

function initTabSwitching(tabButtons: NodeListOf<Element>, tabContents: NodeListOf<Element>, editors?: Editors) {
  const tabList = tabButtons[0]?.parentElement

  function activateTab(button: Element) {
    const tabName = button.getAttribute('data-tab')

    // Update active states
    tabButtons.forEach(btn => {
      btn.classList.remove('active')
      btn.setAttribute('aria-selected', 'false')
      ;(btn as HTMLElement).tabIndex = -1
    })
    tabContents.forEach(content => content.classList.remove('active'))

    button.classList.add('active')
    button.setAttribute('aria-selected', 'true')
    ;(button as HTMLElement).tabIndex = 0
    const activeContent = document.querySelector(`[data-tab-content="${tabName}"]`)
    activeContent?.classList.add('active')

    // Force refresh of the newly visible editor
    if (editors && tabName && tabName in editors) {
      const editor = editors[tabName as keyof Editors]
      if (editor.renderer) {
        editor.renderer.updateFull(true)
        editor.renderer.onResize(true)
      }
      editor.resize(true)
    }

    // Update URL hash
    window.location.hash = tabName || ''
  }

  tabButtons.forEach(button => {
    button.addEventListener('click', () => activateTab(button))
  })

  // Arrow key navigation per WAI-ARIA tabs pattern
  if (tabList) {
    tabList.addEventListener('keydown', (e: Event) => {
      const event = e as KeyboardEvent
      const tabs = Array.from(tabButtons) as HTMLElement[]
      const currentIndex = tabs.indexOf(document.activeElement as HTMLElement)
      if (currentIndex === -1) return

      let newIndex: number | null = null
      if (event.key === 'ArrowRight') {
        newIndex = (currentIndex + 1) % tabs.length
      } else if (event.key === 'ArrowLeft') {
        newIndex = (currentIndex - 1 + tabs.length) % tabs.length
      } else if (event.key === 'Home') {
        newIndex = 0
      } else if (event.key === 'End') {
        newIndex = tabs.length - 1
      }

      if (newIndex !== null) {
        event.preventDefault()
        tabs[newIndex].focus()
        activateTab(tabs[newIndex])
      }
    })
  }

  // Restore active tab from URL hash on load
  const initialHash = window.location.hash.slice(1)
  if (initialHash && ['content', 'data', 'style', 'script', 'server', 'settings'].includes(initialHash)) {
    tabButtons.forEach(btn => {
      btn.classList.remove('active')
      btn.setAttribute('aria-selected', 'false')
      ;(btn as HTMLElement).tabIndex = -1
    })
    tabContents.forEach(content => content.classList.remove('active'))

    const targetButton = document.querySelector(`[data-tab="${initialHash}"]`)
    const targetContent = document.querySelector(`[data-tab-content="${initialHash}"]`)

    if (targetButton && targetContent) {
      targetButton.classList.add('active')
      targetButton.setAttribute('aria-selected', 'true')
      ;(targetButton as HTMLElement).tabIndex = 0
      targetContent.classList.add('active')
    }
  }
}

type TabsState = {
  [key: string]: {hasDraft: boolean; isEmpty: boolean}
}

// Initialize tab state management
function initTabs(options: {initialTabs: TabsState; editors?: Editors; filenames?: TabFilenames}) {
  const {initialTabs, editors, filenames} = options
  const tabNames: Array<'content' | 'data' | 'style' | 'script' | 'server'> = [
    'content',
    'data',
    'style',
    'script',
    'server',
  ]

  function applyTabsState(tabsState: TabsState) {
    tabNames.forEach(name => {
      const state = tabsState[name] || {hasDraft: false, isEmpty: true}
      applyTabState(name, state)
    })
  }

  // Initial render from server state
  applyTabsState(initialTabs)

  // Apply tab filenames if provided
  if (filenames) {
    updateTabFilenames(filenames)
  }

  // Initialize tab switching
  const tabButtons = document.querySelectorAll('.tab-button')
  const tabContents = document.querySelectorAll('.tab-content')
  initTabSwitching(tabButtons, tabContents, editors)

  // Return update functions
  return {
    updateState: (tabsState: TabsState) => {
      applyTabsState(tabsState)
    },
    updateFilenames: (filenames: TabFilenames) => {
      updateTabFilenames(filenames)
    },
  }
}

export const tabs = {
  init: initTabs,
} satisfies EditorModule
