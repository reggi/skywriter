type State = Record<string, unknown>
type Watcher<T> = (next: T, prev: T, path?: string) => void

export interface HistoryStore {
  get(path: string): unknown
  getInitial(path: string): unknown
  set(path: string, value: unknown): void
  /** Set value without notifying watchers (useful when syncing from server) */
  setSilent(path: string, value: unknown): void
  watch<T>(path: string | undefined | string[], fn: Watcher<T>): () => void
  isDirty(path?: string): boolean
  commit(serverObj: State, options?: {replaceActive?: boolean}): void
  snapshotActive(): State
  snapshotInitial(): State
  debounce(
    options: {delay?: number; include?: string[]; exclude?: string[]} | undefined,
    fn: () => void | Promise<void>,
  ): () => void
}

// Simple path utilities
function getPath(obj: State, path: string): unknown {
  const parts = path.split('.')
  let cur: unknown = obj
  for (const p of parts) {
    if (cur == null || typeof cur !== 'object') return undefined
    cur = (cur as Record<string, unknown>)[p]
  }
  return cur
}

function setPath(obj: State, path: string, value: unknown): void {
  const parts = path.split('.')
  const last = parts.pop()
  if (!last) return
  let cur: Record<string, unknown> = obj
  for (const p of parts) {
    if (cur[p] == null || typeof cur[p] !== 'object') cur[p] = {}
    cur = cur[p] as Record<string, unknown>
  }
  cur[last] = value
}

function deepClone<T>(obj: T): T {
  return typeof structuredClone === 'function' ? structuredClone(obj) : JSON.parse(JSON.stringify(obj))
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (a == null || b == null) return a === b
  if (typeof a !== 'object' || typeof b !== 'object') return false

  // Handle arrays specially
  const aIsArray = Array.isArray(a)
  const bIsArray = Array.isArray(b)
  if (aIsArray !== bIsArray) return false

  if (aIsArray) {
    const aArr = a as unknown[]
    const bArr = b as unknown[]
    if (aArr.length !== bArr.length) return false
    for (let i = 0; i < aArr.length; i++) {
      if (!deepEqual(aArr[i], bArr[i])) return false
    }
    return true
  }

  // For objects, check keys
  const aObj = a as Record<string, unknown>
  const bObj = b as Record<string, unknown>
  const keys = new Set([...Object.keys(aObj), ...Object.keys(bObj)])
  if (keys.size !== Object.keys(aObj).length || keys.size !== Object.keys(bObj).length) return false
  for (const k of keys) {
    if (!deepEqual(aObj[k], bObj[k])) return false
  }
  return true
}

function getAllPaths(obj: unknown, prefix = '', out: string[] = []): string[] {
  if (obj == null || typeof obj !== 'object') {
    if (prefix) out.push(prefix)
    return out
  }
  // Include the path for the object/array itself
  if (prefix) out.push(prefix)
  const objRecord = obj as Record<string, unknown>
  for (const k of Object.keys(objRecord)) {
    const path = prefix ? `${prefix}.${k}` : k
    getAllPaths(objRecord[k], path, out)
  }
  return out
}

export default function createHistoryStore(seed: State = {}): HistoryStore {
  let initial = deepClone(seed)
  let active = deepClone(seed)
  const watchers = new Map<string, Set<Watcher<unknown>>>()

  function notify(path: string, next: unknown, prev: unknown) {
    // Notify specific path watchers
    watchers.get(path)?.forEach(fn => fn(next, prev, path))
    // Notify wildcard watchers
    watchers.get('*')?.forEach(fn => fn(next, prev, path))
  }

  return {
    get(path) {
      return getPath(active, path)
    },
    getInitial(path) {
      return getPath(initial, path)
    },

    set(path, value) {
      const prev = getPath(active, path)
      // Use deep equality for arrays and objects, Object.is for primitives
      const prevIsArray = Array.isArray(prev)
      const valueIsArray = Array.isArray(value)
      if (prevIsArray && valueIsArray) {
        // Both are arrays - use deep equality
        if (deepEqual(prev, value)) return
      } else if (prevIsArray || valueIsArray) {
        // One is array, one is not - they're different
        // Continue to set
      } else if (prev != null && typeof prev === 'object' && value != null && typeof value === 'object') {
        // Both are objects (but not arrays) - use deep equality
        if (deepEqual(prev, value)) return
      } else {
        // Primitives - use Object.is
        if (Object.is(prev, value)) return
      }
      setPath(active, path, value)
      notify(path, value, prev)
    },

    setSilent(path, value) {
      // Set value without notifying watchers
      // Used when syncing content from server to avoid triggering debounce
      setPath(active, path, value)
    },

    watch<T>(pathOrPaths: string | undefined | string[], fn: Watcher<T>) {
      const paths = Array.isArray(pathOrPaths) ? pathOrPaths : [pathOrPaths ?? '*']
      const unsubs: Array<() => void> = []

      for (const path of paths) {
        const watchPath = path ?? '*'
        const set = watchers.get(watchPath) ?? new Set()
        set.add(fn as Watcher<unknown>)
        watchers.set(watchPath, set)
        unsubs.push(() => set.delete(fn as Watcher<unknown>))
      }

      return () => unsubs.forEach(unsub => unsub())
    },

    isDirty(path?) {
      if (path) {
        return !deepEqual(getPath(initial, path), getPath(active, path))
      }
      return !deepEqual(initial, active)
    },

    commit(serverObj, {replaceActive = true} = {}) {
      const prevActive = deepClone(active)
      initial = deepClone(serverObj)
      if (replaceActive) {
        active = deepClone(serverObj)
        // Notify all changed paths
        const allPaths = new Set([...getAllPaths(prevActive), ...getAllPaths(active)])
        for (const path of allPaths) {
          const next = getPath(active, path)
          const prev = getPath(prevActive, path)
          if (!deepEqual(next, prev)) {
            notify(path, next, prev)
          }
        }
      }
    },

    snapshotActive() {
      return deepClone(active)
    },
    snapshotInitial() {
      return deepClone(initial)
    },

    debounce(options, fn) {
      const {delay = 400, include, exclude} = options ?? {}
      let timer: ReturnType<typeof setTimeout> | null = null

      const debouncedFn = (next: unknown, prev: unknown, changedPath?: string) => {
        if (exclude && changedPath && exclude.includes(changedPath)) return
        if (include && changedPath && !include.includes(changedPath)) return

        if (timer) clearTimeout(timer)
        timer = setTimeout(() => {
          fn()
          timer = null
        }, delay)
      }

      return this.watch(include ?? undefined, debouncedFn)
    },
  }
}

type InputElement = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement

interface AceEditorLike {
  getValue(): string
  setValue(value: string, cursorPos?: number): void
  on(event: string, callback: (e?: unknown) => void): void
  off(event: string, callback: (e?: unknown) => void): void
}

interface OnChangeContext {
  path: string
  el: InputElement | AceEditorLike
}

interface BindConfig<T = unknown> {
  read?: (el: InputElement | AceEditorLike) => unknown
  write?: (el: InputElement | AceEditorLike, value: unknown) => void
  event?: string
  onChange?: (value: T, context: OnChangeContext) => void
  onClick?: (e: Event | undefined, value: T) => void
  onBlur?: (value: T, context: OnChangeContext) => void
  writeOnStoreChange?: boolean // If false, store changes won't update element (one-way binding: element -> store)
}

interface Binding {
  path: string
  el: InputElement | AceEditorLike
  sync(): void
  destroy(): void
}

interface BinderOptions {
  root?: Document | HTMLElement
  throwOnMissing?: boolean
}

export interface Binder {
  bind<T = unknown>(
    path: string,
    elOrSelector: string | InputElement | AceEditorLike,
    cfg?: BindConfig<T>,
  ): Binding | null
  syncAll(): void
}

function createBinder(store: HistoryStore, {root = document, throwOnMissing = true}: BinderOptions = {}): Binder {
  const bindings = new Map<string, Binding>()

  function getBindingKey(path: string, el: InputElement | AceEditorLike): string {
    if (isAceEditor(el)) {
      const aceEl = el as AceEditorLike & {id?: string}
      return `${path}::ace::${aceEl.id || Math.random()}`
    }
    const htmlEl = el as HTMLElement
    if (htmlEl.id) return `${path}::${htmlEl.id}`
    const tag = htmlEl.tagName.toLowerCase()
    const parent = htmlEl.parentElement
    if (parent) {
      const siblings = Array.from(parent.children).filter(c => c.tagName === htmlEl.tagName)
      const index = siblings.indexOf(htmlEl)
      return `${path}::${tag}::${index}`
    }
    return `${path}::${Math.random()}`
  }

  function resolveEl(elOrSelector: string | InputElement | AceEditorLike): InputElement | AceEditorLike | null {
    if (typeof elOrSelector === 'string') return root.querySelector(elOrSelector) as InputElement | null
    return elOrSelector
  }

  function isAceEditor(el: unknown): el is AceEditorLike {
    return (
      el !== null &&
      typeof el === 'object' &&
      'getValue' in el &&
      typeof el.getValue === 'function' &&
      'setValue' in el &&
      typeof el.setValue === 'function'
    )
  }

  function defaultRead(el: InputElement | AceEditorLike): string | boolean {
    if (isAceEditor(el)) return el.getValue()
    if ((el as HTMLInputElement).type === 'checkbox') return !!(el as HTMLInputElement).checked
    return (el as InputElement).value
  }

  function defaultWrite(el: InputElement | AceEditorLike, value: unknown): void {
    if (isAceEditor(el)) {
      el.setValue((value as string) ?? '', -1)
      return
    }
    if ((el as HTMLInputElement).type === 'checkbox') {
      ;(el as HTMLInputElement).checked = !!value
    } else {
      ;(el as InputElement).value = (value as string) ?? ''
    }
  }

  function defaultEvent(el: InputElement | AceEditorLike): string {
    if (isAceEditor(el)) return 'change'
    if ((el as HTMLInputElement).type === 'checkbox') return 'change'
    return 'input'
  }

  function bind<T = unknown>(
    path: string,
    elOrSelector: string | InputElement | AceEditorLike,
    cfg: BindConfig<T> = {},
  ): Binding | null {
    const el = resolveEl(elOrSelector)
    if (!el) {
      if (throwOnMissing) throw new Error(`bind(): element not found for ${elOrSelector}`)
      return null
    }

    const {read = defaultRead, write = defaultWrite, event = defaultEvent(el), onChange} = cfg

    write(el, store.get(path))

    const handler = () => {
      const next = read(el)
      store.set(path, next)
      if (typeof onChange === 'function') onChange(next as T, {path, el})
    }

    if (event) {
      if (isAceEditor(el)) {
        el.on(event, handler)
      } else {
        ;(el as InputElement).addEventListener(event, handler)
      }
    }

    let clickCleanup: (() => void) | null = null
    if (cfg?.onClick) {
      const clickHandler = (e?: unknown) => {
        const currentValue = store.get(path)
        cfg.onClick!(e as Event | undefined, currentValue as T)
      }
      if (isAceEditor(el)) {
        el.on('click', clickHandler)
        clickCleanup = () => el.off('click', clickHandler)
      } else {
        ;(el as InputElement).addEventListener('click', (e: Event) => clickHandler(e))
        clickCleanup = () => (el as InputElement).removeEventListener('click', clickHandler as EventListener)
      }
    }

    let blurCleanup: (() => void) | null = null
    if (cfg?.onBlur) {
      const blurHandler = () => {
        const currentValue = store.get(path)
        cfg.onBlur!(currentValue as T, {path, el})
      }
      if (isAceEditor(el)) {
        el.on('blur', blurHandler)
        blurCleanup = () => el.off('blur', blurHandler)
      } else {
        ;(el as InputElement).addEventListener('blur', blurHandler)
        blurCleanup = () => (el as InputElement).removeEventListener('blur', blurHandler)
      }
    }

    const unwatchStore =
      cfg.writeOnStoreChange !== false
        ? store.watch(path, (nextValue: unknown) => {
            write(el, nextValue)
          })
        : () => {} // No-op cleanup if not watching

    const binding: Binding = {
      path,
      el,
      sync() {
        write(el, store.get(path))
      },
      destroy() {
        if (event) {
          if (isAceEditor(el)) {
            el.off(event, handler)
          } else {
            ;(el as InputElement).removeEventListener(event, handler)
          }
        }
        if (clickCleanup) clickCleanup()
        if (blurCleanup) blurCleanup()
        unwatchStore()
      },
    }

    const bindingKey = getBindingKey(path, el)
    if (bindings.has(bindingKey)) {
      bindings.get(bindingKey)?.destroy()
    }
    bindings.set(bindingKey, binding)

    return binding
  }

  function syncAll(): void {
    for (const b of bindings.values()) b.sync()
  }

  return {bind, syncAll}
}

export function createStoreWithBinder(seed: State = {}) {
  const store = createHistoryStore(seed)
  const binder = createBinder(store)

  const originalCommit = store.commit.bind(store)
  store.commit = (serverObj: State, options?: {replaceActive?: boolean}) => {
    originalCommit(serverObj, options)
    binder.syncAll()
  }

  return {store, binder}
}
