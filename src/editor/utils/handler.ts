import type {StoreWithBinder, DocumentClientState} from './types.ts'
import {normalizeState} from './state.ts'
import {getEditUrlWithHostQuery} from './html-utils.ts'

export class Handler {
  opts: {
    meta: StoreWithBinder
    draft: StoreWithBinder
    save: StoreWithBinder
  }

  constructor(opts: {meta: StoreWithBinder; draft: StoreWithBinder; save: StoreWithBinder}) {
    this.opts = opts
  }

  get editUrl() {
    const path = this.opts.save.store.getInitial('path') as string
    return getEditUrlWithHostQuery(path)
  }

  async handleResponse(
    response: Response,
    options: {updateDraft?: boolean; updateSave?: boolean; replaceActiveDraft?: boolean},
  ) {
    const {updateDraft, updateSave, replaceActiveDraft = true} = options
    if (!response.ok) {
      throw new Error(`Request failed: ${response.status} ${response.statusText}`)
    }

    const responseData = (await response.json()) as DocumentClientState
    const normalized = normalizeState(responseData)

    // Check if content was modified by server (e.g., foreign images were downloaded)
    const contentModifiedByServer = normalized.meta.contentModifiedByServer

    if (updateDraft) {
      if (contentModifiedByServer && !replaceActiveDraft) {
        // Server modified content (foreign images processed) - we need to update the content
        // field specifically, even when replaceActiveDraft is false
        // First commit without replacing active (updates initial state)
        this.opts.draft.store.commit(normalized.draft, {replaceActive: false})
        // Then silently update the content field to match server (no watchers triggered)
        // This prevents the debounce from scheduling another draft save
        this.opts.draft.store.setSilent('content', normalized.draft.content)
        // Sync the editors to reflect the new content
        this.opts.draft.binder.syncAll()
      } else {
        this.opts.draft.store.commit(normalized.draft, {replaceActive: replaceActiveDraft})
      }
    }

    if (updateSave) {
      this.opts.save.store.commit(normalized.save)
    }

    this.opts.meta.store.commit(normalized.meta)
  }

  async fetch(opts: {
    payload: Record<string, unknown>
    startMessage: string
    endMessage: string
    updateDraft?: true
    updateSave?: true
    replaceActiveDraft?: boolean
  }) {
    try {
      this.opts.meta.store.set('status', {message: opts.startMessage})
      const response = await fetch(this.editUrl, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(opts.payload),
      })
      await this.handleResponse(response, {
        updateDraft: opts.updateDraft,
        updateSave: opts.updateSave,
        replaceActiveDraft: opts.replaceActiveDraft,
      })
      this.opts.meta.store.set('status', {message: opts.endMessage})
    } catch (error) {
      this.opts.meta.store.set('toast', {message: 'Error', details: (error as Error).message})
    }
  }

  async revert() {
    return this.fetch({
      payload: {draft: false},
      startMessage: 'Reverting...',
      endMessage: 'Reverted',
      updateDraft: true,
      updateSave: true,
    })
  }

  async publish() {
    return this.fetch({
      payload: {published: !this.opts.save.store.get('published')},
      startMessage: this.opts.save.store.get('published') ? 'Unpublishing...' : 'Publishing...',
      endMessage: 'Done!',
      updateDraft: true,
      updateSave: true,
    })
  }

  async save() {
    return await this.fetch({
      payload: {
        ...this.opts.draft.store.snapshotActive(),
        ...this.opts.save.store.snapshotActive(),
        draft: false,
      },
      startMessage: 'Saving...',
      endMessage: 'Saved!',
      updateDraft: true,
      updateSave: true,
    })
  }

  async draft() {
    const draftIsDirty = this.opts.draft.store.isDirty()
    if (!draftIsDirty) return

    return this.fetch({
      payload: {
        path: this.opts.save.store.get('path'),
        ...this.opts.draft.store.snapshotActive(),
        draft: true,
      },
      startMessage: 'Saving Draft...',
      endMessage: 'Draft Saved!',
      updateDraft: true,
      replaceActiveDraft: false,
    })
  }
}
