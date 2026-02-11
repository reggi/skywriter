import type {StatusElements} from '../utils/dom.ts'
import {EditorModule} from '../utils/types.ts'

let statusTimeout: ReturnType<typeof setTimeout> | null = null

function showStatus(options: {statusElements: StatusElements; message: string; duration?: number}) {
  const {statusElements, message, duration = 2000} = options

  // Clear any existing timeout
  if (statusTimeout) {
    clearTimeout(statusTimeout)
  }

  // Update message and show indicator
  statusElements.statusText.textContent = message
  statusElements.statusIndicator.classList.add('visible')

  // Auto-hide after duration
  statusTimeout = setTimeout(() => {
    statusElements.statusIndicator.classList.remove('visible')
    statusTimeout = null
  }, duration)
}

export const status = {
  update: showStatus,
} satisfies EditorModule
