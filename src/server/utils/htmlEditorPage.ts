import {statSync} from 'fs'
import {join} from 'path'
import type {Upload, Route, DocumentId} from '../../operations/types.ts'
import type {DocumentClientState} from '../../utils/types.ts'

// Get cache-busting query parameter
function getCacheBuster(): string {
  const isDev = process.env.NODE_ENV === 'development'
  const distDir = join(import.meta.dirname!, '../dist')
  const bundleFilename = isDev ? 'editor.bundle.dev.js' : 'editor.bundle.prod.js'

  // Use file modification time for cache busting
  // This provides a stable value that only changes when the bundle is rebuilt
  try {
    const stats = statSync(join(distDir, bundleFilename))
    return `v=${stats.mtime.getTime()}`
  } catch {
    // Fallback if bundle file doesn't exist yet
    return `v=${Date.now()}`
  }
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function truncateMiddle(str: string, maxLength = 90): string {
  if (str.length <= maxLength) return str
  if (maxLength <= 1) return '…'

  const remaining = maxLength - 1
  const head = Math.ceil(remaining / 2)
  const tail = Math.floor(remaining / 2)
  return `${str.slice(0, head)}…${str.slice(-tail)}`
}

function renderUploadsTable(uploads: Upload[], documentPath: string): string {
  const renderUploadRow = (upload: Upload): string => {
    const isHidden = upload.hidden
    const uploadUrl =
      documentPath === '/'
        ? `/uploads/${encodeURIComponent(upload.original_filename)}`
        : `${documentPath}/uploads/${encodeURIComponent(upload.original_filename)}`
    return `
      <tr data-upload-id="${upload.id}"${isHidden ? ' class="upload-hidden"' : ''}>
        <td>
          <a 
            href="${escapeHtml(uploadUrl)}${isHidden ? '?reveal' : ''}"
            target="_blank"
            class="filename-link"
            title="View ${escapeHtml(upload.original_filename)}"
          >${escapeHtml(upload.original_filename)}</a>
          <input 
            type="text" 
            class="filename-input" 
            value="${escapeHtml(upload.original_filename)}"
            data-upload-id="${upload.id}"
            style="display: none;"
          />
        </td>
        <td class="upload-date">
          ${new Date(upload.created_at).toLocaleDateString()}
        </td>
        <td class="upload-actions">
          <label class="hidden-toggle" title="${isHidden ? 'Hidden from public' : 'Visible to public'}">
            <input
              type="checkbox"
              class="hidden-checkbox"
              data-upload-id="${upload.id}"
              aria-label="Toggle visibility for ${escapeHtml(upload.original_filename)}"
              ${isHidden ? 'checked' : ''}
            />
          </label>
          <button 
            type="button"
            class="icon-btn rename-upload-btn"
            data-upload-id="${upload.id}"
            data-filename="${escapeHtml(upload.original_filename)}"
            title="Rename upload"
            aria-label="Rename ${escapeHtml(upload.original_filename)}"
          >✏️</button>
          <button 
            type="button"
            class="icon-btn delete-upload-btn"
            data-filename="${escapeHtml(upload.original_filename)}"
            title="Delete upload"
            aria-label="Delete ${escapeHtml(upload.original_filename)}"
          >✕</button>
        </td>
      </tr>
    `
  }

  const rows = uploads.map(upload => renderUploadRow(upload)).join('')

  const emptyState =
    uploads.length === 0
      ? '<tr><td colspan="3" class="no-uploads">No uploads yet. Drag and drop files or use the upload button below.</td></tr>'
      : ''

  return `
    <div class="uploads-section">
      <table class="uploads-table">
        <thead>
          <tr>
            <th>Filename</th>
            <th class="date-header">Date</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${rows}${emptyState}
        </tbody>
      </table>
      <div class="upload-controls">
        <input 
          type="file" 
          id="file-upload-input" 
          multiple 
          aria-label="Choose files to upload"
          style="display: none;"
        />
        <button 
          type="button" 
          id="upload-file-btn" 
          class="btn-secondary"
        >
          📎 Upload File
        </button>
        <p class="help-text">You can also drag and drop files onto any editor panel</p>
      </div>
    </div>
  `
}

function renderRedirectsTable(redirects: Route[]): string {
  const rows = redirects
    .map(
      redirect => `
        <tr data-redirect-id="${redirect.id}">
          <td class="redirect-path"><a href="${escapeHtml(redirect.path)}" target="_blank" class="redirect-link">${escapeHtml(redirect.path)}</a></td>
          <td class="redirect-date">
            ${new Date(redirect.created_at).toLocaleDateString()}
          </td>
          <td class="redirect-actions">
            <button 
              type="button"
              class="delete-redirect-btn"
              data-redirect-id="${redirect.id}"
              title="Delete redirect"
              aria-label="Delete redirect ${escapeHtml(redirect.path)}"
            >✕</button>
          </td>
        </tr>
      `,
    )
    .join('')

  const emptyState =
    redirects.length === 0
      ? '<tr><td colspan="3" class="no-redirects">No redirects yet. Add old paths below that should redirect to this document.</td></tr>'
      : ''

  return `
    <div class="redirects-section">
      <table class="redirects-table">
        <thead>
          <tr>
            <th>Old Path</th>
            <th class="date-header">Date</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${rows}${emptyState}
        </tbody>
      </table>
      <div class="redirect-controls">
        <label for="redirect-path-input" class="sr-only">Redirect path</label>
        <input 
          type="text" 
          id="redirect-path-input" 
          placeholder="/old-path-to-redirect"
        />
        <button 
          type="button" 
          id="add-redirect-btn" 
          class="btn-secondary"
        >
          ➕ Add Redirect
        </button>
      </div>
    </div>
  `
}

export function htmlEditorPage(options: {state: DocumentClientState | null; fallbackPath?: string}): Response {
  const {state, fallbackPath} = options

  // Handle non-existent documents - create default state
  const clientState: DocumentClientState = state || {
    document: {
      id: 0 as DocumentId, // New document without ID yet
      path: fallbackPath || '/',
      published: false,
      title: '',
      content: '',
      data: '{}',
      style: '',
      script: '',
      server: '',
      template_id: null,
      slot_id: null,
      mime_type: 'text/html; charset=UTF-8',
      extension: '.html',
      content_type: 'markdown',
      data_type: null,
      has_eta: false,
      created_at: new Date(),
      updated_at: new Date(),
      uploads: [],
      redirects: [],
      draft: false,
      template: undefined,
      slot: undefined,
    },
    render: {html: ''},
    api: [],
  }

  const api = clientState.api
  const document = clientState.document
  const cacheBuster = getCacheBuster()

  // For text/plain documents, wrap content in proper HTML for preview
  let renderHtml = clientState.render.html
  if (document.mime_type?.startsWith('text/plain')) {
    const escaped = renderHtml.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    renderHtml = `<!DOCTYPE html>
<html>
<head>
<style>
body {
  margin: 8px;
  white-space: pre-wrap;
  word-wrap: break-word;
  font-family: monospace;
  font-size: 13px;
  line-height: 1.4;
}
</style>
</head>
<body>${escaped}</body>
</html>`
  }

  const html = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(document.path)}</title>
    <link rel="stylesheet" href="${escapeHtml(document.path === '/' ? '/edit?style' : `${document.path}/edit?style`)}&cb=${cacheBuster}">
  </head>
  <body
    data-state="${escapeHtml(JSON.stringify(clientState))}"
  >
    <a href="#content-editor-panel" class="sr-only skip-link">Skip to editor</a>
    <header>
      <div class="header-content" style="display: flex; justify-content: space-between; align-items: center;">
        <div class="header-slug">
          <label for="slug" class="sr-only">Document path</label>
          <input
            type="text"
            id="slug"
            name="slug"
            value="${escapeHtml(document.path)}"
            placeholder="/auto-generated-from-title"
          />
        </div>
        <div class="status-indicator" id="status-indicator" role="status" aria-live="polite">
          <span class="status-text" id="status-text"></span>
        </div>
        <div class="header-actions" style="display: flex; gap: 12px; align-items: center; margin-left: auto;">
          <button type="button" class="btn-publish" id="publish-btn" data-published="${document.published ? 'true' : 'false'}" aria-label="${document.published ? 'Document is public. Click to unpublish' : 'Document is hidden. Click to publish'}" ${!document.id || document.id === 0 || document.id === null || document.id === undefined ? 'disabled' : ''}>${document.published ? 'Unpublish' : 'Publish'}</button>
          <button type="button" class="btn-save" id="save-btn" disabled>Save</button>
          <button type="button" id="revert-btn" class="btn-revert" disabled>Revert Changes</button>
          <button type="button" id="view-btn" class="btn-view" ${!document.published ? 'disabled' : ''}>View</button>
        </div>
      </div>
    </header>
    
    <main class="editor-container-wrapper" style="display: flex; flex: 1; overflow: hidden;">
      <div class="editor-container">
        <div class="editor-tabs" role="tablist" aria-label="Editor tabs">
          <button type="button" class="tab-button active" data-tab="content" role="tab" aria-selected="true" aria-controls="tabpanel-content" id="tab-content" tabindex="0">Content</button>
          <button type="button" class="tab-button" data-tab="data" role="tab" aria-selected="false" aria-controls="tabpanel-data" id="tab-data" tabindex="-1">Data (JSON/YAML)</button>
          <button type="button" class="tab-button" data-tab="style" role="tab" aria-selected="false" aria-controls="tabpanel-style" id="tab-style" tabindex="-1">Style (CSS)</button>
          <button type="button" class="tab-button" data-tab="script" role="tab" aria-selected="false" aria-controls="tabpanel-script" id="tab-script" tabindex="-1">Script (JS)</button>
          <button type="button" class="tab-button" data-tab="server" role="tab" aria-selected="false" aria-controls="tabpanel-server" id="tab-server" tabindex="-1">Server (JS)</button>
          <button type="button" class="tab-button" data-tab="settings" role="tab" aria-selected="false" aria-controls="tabpanel-settings" id="tab-settings" tabindex="-1">Settings</button>
        </div>
        
        <div class="tab-content active" data-tab-content="content" role="tabpanel" id="tabpanel-content" aria-labelledby="tab-content" tabindex="0">
          <div id="content-editor-panel">
            <textarea id="content" name="content" aria-label="Content editor" style="display:none;">${escapeHtml(document.content)}</textarea>
          </div>

          <div class="resizer" id="resizer" role="separator" aria-label="Resize editor and preview panels" tabindex="0"></div>

          <div class="preview-panel">
            <iframe id="preview" class="preview-iframe" title="Document preview" srcdoc="${escapeHtml(renderHtml)}"></iframe>
          </div>
        </div>
        
        <div class="tab-content" data-tab-content="data" role="tabpanel" id="tabpanel-data" aria-labelledby="tab-data" tabindex="0">
          <div id="data-editor-panel">
            <textarea id="data" name="data" aria-label="Data editor" style="display:none;">${escapeHtml(document.data)}</textarea>
          </div>
        </div>
        
        <div class="tab-content" data-tab-content="style" role="tabpanel" id="tabpanel-style" aria-labelledby="tab-style" tabindex="0">
          <div id="style-editor-panel">
            <textarea id="style" name="style" aria-label="Style editor" style="display:none;">${escapeHtml(document.style)}</textarea>
          </div>
        </div>
        
        <div class="tab-content" data-tab-content="script" role="tabpanel" id="tabpanel-script" aria-labelledby="tab-script" tabindex="0">
          <div id="script-editor-panel">
            <textarea id="script" name="script" aria-label="Script editor" style="display:none;">${escapeHtml(document.script)}</textarea>
          </div>
        </div>
        
        <div class="tab-content" data-tab-content="server" role="tabpanel" id="tabpanel-server" aria-labelledby="tab-server" tabindex="0">
          <div id="server-editor-panel">
            <textarea id="server" name="server" aria-label="Server script editor" style="display:none;">${escapeHtml(document.server)}</textarea>
          </div>
        </div>
        
        <div class="tab-content" data-tab-content="settings" role="tabpanel" id="tabpanel-settings" aria-labelledby="tab-settings" tabindex="0">
          <div class="settings-panel">
            <div class="settings-inner">
              <nav class="settings-sidebar">
                <ul class="settings-nav">
                  <li><a href="#general" class="settings-nav-link">General</a></li>
                  <li><a href="#uploads" class="settings-nav-link">Uploads</a></li>
                  <li><a href="#redirects" class="settings-nav-link">Redirects</a></li>
                  <li><a href="#api-links" class="settings-nav-link">API Links</a></li>
                  <li><a href="#danger-zone" class="settings-nav-link">Danger Zone</a></li>
                </ul>
              </nav>
              <div class="settings-content">
              <section class="settings-section" id="general">
                <h2 class="settings-section-title">General</h2>
                <div class="settings-section-body">
                  <div class="form-group">
                    <label for="title-input">Title</label>
                    <input type="text" id="title-input" name="title" placeholder="Document title" value="${escapeHtml(document.title)}" />
                  </div>
                  
                  <div class="form-group">
                    <label for="template-search">Template</label>
                    ${
                      document.template?.title && document.template?.path
                        ? `
                    <div class="selected-item">
                      <a href="${escapeHtml(document.template.path)}/edit" class="selected-link" target="_blank" title="Edit ${escapeHtml(document.template.path)}">
                        <strong>${escapeHtml(document.template.title)}</strong>
                        <span class="selected-path">${escapeHtml(document.template.path)}</span>
                      </a>
                      <button type="button" class="clear-selection" data-target="template">✕</button>
                    </div>
                    `
                        : ''
                    }
                    <input 
                      type="text" 
                      id="template-search"
                      placeholder="Search templates..."
                      autocomplete="off"
                      ${document.template?.title ? 'style="display:none;"' : ''}
                    />
                    <input type="hidden" id="template-id" name="template_id" value="${document.template_id || ''}" />
                    <div id="template-dropdown" class="autocomplete-dropdown"></div>
                  </div>
                  
                  <div class="form-group">
                    <label for="slot-search">Slot</label>
                    ${
                      document.slot?.title && document.slot?.path
                        ? `
                    <div class="selected-item">
                      <a href="${escapeHtml(document.slot.path)}/edit" class="selected-link" target="_blank" title="Edit ${escapeHtml(document.slot.path)}">
                        <strong>${escapeHtml(document.slot.title)}</strong>
                        <span class="selected-path">${escapeHtml(document.slot.path)}</span>
                      </a>
                      <button type="button" class="clear-selection" data-target="slot">✕</button>
                    </div>
                    `
                        : ''
                    }
                    <input 
                      type="text" 
                      id="slot-search"
                      placeholder="Search slots..."
                      autocomplete="off"
                      ${document.slot?.title ? 'style="display:none;"' : ''}
                    />
                    <input type="hidden" id="slot-id" name="slot_id" value="${document.slot_id || ''}" />
                    <div id="slot-dropdown" class="autocomplete-dropdown"></div>
                  </div>

                  <div class="form-group">
                    <label for="mime-type-input">MIME Type</label>
                    <input 
                      type="text" 
                      id="mime-type-input" 
                      name="mime_type" 
                      placeholder="text/html; charset=UTF-8"
                      value="${escapeHtml(document.mime_type)}"
                      aria-describedby="mime-type-help"
                    />
                    <p class="help-text" id="mime-type-help">Content type for the document (e.g., application/xml)</p>
                  </div>

                  <div class="form-group">
                    <label for="extension-input">File Extension</label>
                    <input 
                      type="text" 
                      id="extension-input" 
                      name="extension" 
                      placeholder=".html"
                      value="${escapeHtml(document.extension)}"
                      aria-describedby="extension-help"
                    />
                    <p class="help-text" id="extension-help">File extension for content (e.g., .xml, .svg, .csv, .vcard)</p>
                  </div>
                </div>
              </section>

              <section class="settings-section" id="uploads">
                <h2 class="settings-section-title">Uploads</h2>
                <div class="settings-section-body">
                  ${renderUploadsTable((document.uploads || []) as Upload[], document.path)}
                </div>
              </section>

              <section class="settings-section" id="redirects">
                <h2 class="settings-section-title">Redirects</h2>
                <div class="settings-section-body">
                  ${renderRedirectsTable((document.redirects || []) as Route[])}
                  <p class="help-text">Old paths that redirect (301) to this document's current path</p>
                </div>
              </section>

              <section class="settings-section" id="api-links">
                <h2 class="settings-section-title">API Links</h2>
                <div class="settings-section-body">
                  <div class="api-links-list">
                    ${
                      api.length
                        ? api
                            .map(
                              url => `
                      <div class="api-link-item">
                        <a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" title="${escapeHtml(url)}" style="display:block;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(truncateMiddle(url, 60))}</a>
                      </div>
                    `,
                            )
                            .join('')
                        : '<div class="help-text">No API links until doc exists</div>'
                    }
                  </div>
                </div>
              </section>

              <section class="settings-section" id="danger-zone">
                <h2 class="settings-section-title">Danger Zone</h2>
                <div class="settings-section-body">
                  <div class="danger-zone-panel">
                    <div class="danger-zone-row">
                      <div class="danger-zone-row-text">
                        <div class="danger-zone-row-title">Delete this document</div>
                        <div class="danger-zone-row-description">
                          Once you delete a document, there is no going back. Please be certain.
                        </div>
                      </div>
                      <div class="danger-zone-row-action">
                        <form 
                          method="post" 
                          action="${escapeHtml(document.path === '/' ? '/edit?remove=true' : `${document.path}/edit?remove=true`)}"
                          onsubmit="return confirm('Are you sure you want to delete this document? This action cannot be undone.')"
                        >
                          <button 
                            type="submit" 
                            class="btn-delete"
                          >
                            Delete this document
                          </button>
                        </form>
                      </div>
                    </div>

                    <div class="danger-zone-row">
                      <div class="danger-zone-row-text">
                        <div class="danger-zone-row-title">Sign out</div>
                        <div class="danger-zone-row-description">Sign out of your current session.</div>
                      </div>
                      <div class="danger-zone-row-action">
                        <form 
                          method="post" 
                          action="${escapeHtml(document.path === '/' ? '/edit?logout' : `${document.path}/edit?logout`)}"
                        >
                          <button 
                            type="submit" 
                            class="btn-logout"
                          >
                            Logout
                          </button>
                        </form>
                      </div>
                    </div>
                  </div>
                </div>
              </section>
              </div>
            </div>
          </div>
        </div>
      </div>
    </main>
    <script src="${escapeHtml(document.path === '/' ? '/edit?script' : `${document.path}/edit?script`)}&cb=${cacheBuster}"></script>
  </body>
</html>`

  return new Response(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
    },
  })
}
