import {EditorModule} from '../utils/types.ts'

type ToastType = 'error' | 'success' | 'info'

interface ToastOptions {
  type?: ToastType
  duration?: number
}

let toastContainer: HTMLDivElement | null = null

function getToastContainer(): HTMLDivElement {
  if (!toastContainer) {
    toastContainer = document.createElement('div')
    toastContainer.className = 'toast-container'
    document.body.appendChild(toastContainer)
  }
  return toastContainer
}

function showToast(message: string, options: ToastOptions = {}) {
  const {type = 'info', duration = 5000} = options

  const container = getToastContainer()

  const toast = document.createElement('div')
  toast.className = `toast toast-${type}`
  toast.textContent = message

  container.appendChild(toast)

  // Trigger animation
  setTimeout(() => toast.classList.add('show'), 10)

  // Auto-remove after duration
  setTimeout(() => {
    toast.classList.remove('show')
    setTimeout(() => {
      container.removeChild(toast)
    }, 300) // Wait for fade out animation
  }, duration)
}

function showErrorToast(options: {message: string; details?: string}) {
  const {message, details} = options
  const fullMessage = details ? `${message}: ${details}` : message
  showToast(fullMessage, {type: 'error', duration: 6000})
}

export const toast = {
  update: showErrorToast,
} satisfies EditorModule
