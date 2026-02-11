import type {EditorModule} from '../utils/types.ts'

const STORAGE_KEY = 'editor-split-position'
const DEFAULT_SPLIT = 50 // 50%
const MIN_SIZE = 10 // 10%

function applySplit(contentPanel: HTMLElement, percentage: number) {
  contentPanel.style.width = `${percentage}%`
}

function savePosition(percentage: number) {
  try {
    localStorage.setItem(STORAGE_KEY, percentage.toString())
  } catch (e) {
    console.warn('Failed to save split position to localStorage:', e)
  }
}

function loadPosition(): number {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved) {
      const value = parseFloat(saved)
      if (!isNaN(value) && value >= MIN_SIZE && value <= 100 - MIN_SIZE) {
        return value
      }
    }
  } catch (e) {
    console.warn('Failed to load split position from localStorage:', e)
  }
  return DEFAULT_SPLIT
}

function init() {
  const resizer = document.getElementById('resizer') as HTMLElement
  const contentPanel = document.getElementById('content-editor-panel') as HTMLElement
  const previewPanel = document.querySelector('.preview-panel') as HTMLElement

  if (!resizer || !contentPanel || !previewPanel) {
    return
  }

  // Load saved position from localStorage
  const savedPosition = loadPosition()
  applySplit(contentPanel, savedPosition)

  let isResizing = false
  let startX = 0
  let startWidth = 0
  let overlay: HTMLDivElement | null = null

  // Create overlay to capture all mouse events during resize
  const createOverlay = () => {
    overlay = document.createElement('div')
    overlay.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      z-index: 99999;
      cursor: col-resize;
    `
    document.body.appendChild(overlay)
  }

  const removeOverlay = () => {
    if (overlay && overlay.parentNode) {
      overlay.parentNode.removeChild(overlay)
      overlay = null
    }
  }

  const onMouseDown = (e: MouseEvent) => {
    isResizing = true
    startX = e.clientX
    startWidth = contentPanel.offsetWidth

    // Create overlay to capture all mouse events
    createOverlay()

    // Add visual feedback
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    resizer.style.background = '#4caf50'

    // Prevent text selection during resize
    e.preventDefault()
    e.stopPropagation()
  }

  const onMouseMove = (e: MouseEvent) => {
    if (!isResizing) return

    const container = contentPanel.parentElement
    if (!container) return

    const containerWidth = container.offsetWidth
    const delta = e.clientX - startX
    const newWidth = startWidth + delta
    const percentage = (newWidth / containerWidth) * 100

    // Clamp between MIN_SIZE and (100 - MIN_SIZE)
    const clampedPercentage = Math.max(MIN_SIZE, Math.min(100 - MIN_SIZE, percentage))

    applySplit(contentPanel, clampedPercentage)

    // Prevent default to avoid any browser interference
    e.preventDefault()
  }

  const onMouseUp = (e: MouseEvent) => {
    if (!isResizing) return

    isResizing = false

    // Remove overlay
    removeOverlay()

    document.body.style.cursor = ''
    document.body.style.userSelect = ''
    resizer.style.background = ''

    // Save position to localStorage
    const container = contentPanel.parentElement
    if (container) {
      const percentage = (contentPanel.offsetWidth / container.offsetWidth) * 100
      savePosition(percentage)
    }

    e.preventDefault()
  }

  // Touch event handlers for mobile
  const onTouchStart = (e: TouchEvent) => {
    if (e.touches.length !== 1) return
    isResizing = true
    startX = e.touches[0].clientX
    startWidth = contentPanel.offsetWidth

    document.body.style.userSelect = 'none'
    resizer.style.background = '#4caf50'

    e.preventDefault()
  }

  const onTouchMove = (e: TouchEvent) => {
    if (!isResizing || e.touches.length !== 1) return

    const container = contentPanel.parentElement
    if (!container) return

    const containerWidth = container.offsetWidth
    const delta = e.touches[0].clientX - startX
    const newWidth = startWidth + delta
    const percentage = (newWidth / containerWidth) * 100
    const clampedPercentage = Math.max(MIN_SIZE, Math.min(100 - MIN_SIZE, percentage))

    applySplit(contentPanel, clampedPercentage)
    e.preventDefault()
  }

  const onTouchEnd = () => {
    if (!isResizing) return
    isResizing = false

    document.body.style.userSelect = ''
    resizer.style.background = ''

    const container = contentPanel.parentElement
    if (container) {
      const percentage = (contentPanel.offsetWidth / container.offsetWidth) * 100
      savePosition(percentage)
    }
  }

  // Use capture phase for mousedown to ensure we get it first
  resizer.addEventListener('mousedown', onMouseDown, true)
  document.addEventListener('mousemove', onMouseMove, true)
  document.addEventListener('mouseup', onMouseUp, true)

  // Touch event listeners for mobile
  resizer.addEventListener('touchstart', onTouchStart, {passive: false})
  document.addEventListener('touchmove', onTouchMove, {passive: false})
  document.addEventListener('touchend', onTouchEnd)

  // Cleanup function (can be called if needed)
  return () => {
    resizer.removeEventListener('mousedown', onMouseDown, true)
    document.removeEventListener('mousemove', onMouseMove, true)
    document.removeEventListener('mouseup', onMouseUp, true)
    resizer.removeEventListener('touchstart', onTouchStart)
    document.removeEventListener('touchmove', onTouchMove)
    document.removeEventListener('touchend', onTouchEnd)
    removeOverlay()
  }
}

export const resizableSplit = {init} satisfies EditorModule
