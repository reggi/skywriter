import type {Binder, HistoryStore} from './store.ts'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyFunction = (...args: any[]) => any

export interface EditorModule {
  init?: AnyFunction
  update?: AnyFunction
}

export interface Upload {
  id: number
  filename: string
  original_filename: string
  document_id: number | null
  created_at: Date
  hidden: boolean
}

export type StoreWithBinder = {
  store: HistoryStore
  binder: Binder
}

export interface AceClickEvent {
  domEvent: MouseEvent
  getDocumentPosition(): {row: number; column: number}
  stop(): void
  preventDefault(): void
}

export interface AceEditor {
  getValue(): string
  setValue(value: string, cursorPos?: number): void
  getCursorPosition(): {row: number; column: number}
  moveCursorToPosition(pos: {row: number; column: number}): void
  insert(text: string): void
  blockIndent(): void
  blockOutdent(): void
  setTheme(theme: string): void
  setOptions(options: Record<string, unknown>): void
  session: {
    getScrollTop(): number
    setScrollTop(top: number): void
    setMode(mode: string): void
    setOption(name: string, value: unknown): void
    getUseWrapMode(): boolean
    getLine(row: number): string
    getTokenAt(row: number, column: number): {type: string; value: string} | null
  }
  renderer?: {
    updateFull(force?: boolean): void
    onResize(force?: boolean): void
    container: HTMLElement
  }
  resize(force?: boolean): void
  clearSelection(): void
  on(event: 'click' | 'mousemove', callback: (e: AceClickEvent) => void): void
  on(event: string, callback: (e?: unknown) => void): void
  off(event: string, callback: (e?: unknown) => void): void
  commands: {
    addCommand(command: {
      name: string
      bindKey: {win: string; mac: string}
      exec: (editor: AceEditor) => void
      readOnly?: boolean
    }): void
  }
}

export type Editors = {
  content: AceEditor
  data: AceEditor
  style: AceEditor
  script: AceEditor
  server: AceEditor
}

// Re-export shared types for convenience
export type {DocumentClientState} from '../../utils/types.ts'
