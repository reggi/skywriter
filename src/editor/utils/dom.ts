// Specific element types for different use cases
export interface EditorPanels {
  contentEditorPanel: HTMLElement
  dataEditorPanel: HTMLElement
  styleEditorPanel: HTMLElement
  scriptEditorPanel: HTMLElement
  serverEditorPanel: HTMLElement
}

export interface EditorTextareas {
  contentTextarea: HTMLTextAreaElement
  dataTextarea: HTMLTextAreaElement
  styleTextarea: HTMLTextAreaElement
  scriptTextarea: HTMLTextAreaElement
  serverTextarea: HTMLTextAreaElement
}

export interface TemplateElements {
  templateSearch: HTMLInputElement
  templateDropdown: HTMLElement
}

export interface SlotElements {
  slotSearch: HTMLInputElement
  slotDropdown: HTMLElement
}

export interface StatusElements {
  statusIndicator: HTMLElement
  statusText: HTMLElement
}

// Helper functions to get specific element groups
export function getEditorPanels(): EditorPanels {
  return {
    contentEditorPanel: document.getElementById('content-editor-panel') as HTMLElement,
    dataEditorPanel: document.getElementById('data-editor-panel') as HTMLElement,
    styleEditorPanel: document.getElementById('style-editor-panel') as HTMLElement,
    scriptEditorPanel: document.getElementById('script-editor-panel') as HTMLElement,
    serverEditorPanel: document.getElementById('server-editor-panel') as HTMLElement,
  }
}

export function getEditorTextareas(): EditorTextareas {
  return {
    contentTextarea: document.getElementById('content') as HTMLTextAreaElement,
    dataTextarea: document.getElementById('data') as HTMLTextAreaElement,
    styleTextarea: document.getElementById('style') as HTMLTextAreaElement,
    scriptTextarea: document.getElementById('script') as HTMLTextAreaElement,
    serverTextarea: document.getElementById('server') as HTMLTextAreaElement,
  }
}

export function getTemplateElements(): TemplateElements {
  return {
    templateSearch: document.getElementById('template-search') as HTMLInputElement,
    templateDropdown: document.getElementById('template-dropdown') as HTMLElement,
  }
}

export function getSlotElements(): SlotElements {
  return {
    slotSearch: document.getElementById('slot-search') as HTMLInputElement,
    slotDropdown: document.getElementById('slot-dropdown') as HTMLElement,
  }
}

export function getStatusElements(): StatusElements {
  return {
    statusIndicator: document.getElementById('status-indicator') as HTMLElement,
    statusText: document.getElementById('status-text') as HTMLElement,
  }
}

export function getPreviewElement(): HTMLElement {
  return document.getElementById('preview') as HTMLElement
}
