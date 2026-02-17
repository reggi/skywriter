import {addUpload} from '../../operations/addUpload.ts'
import {addRedirect} from '../../operations/addRedirect.ts'
import {removeUpload} from '../../operations/removeUpload.ts'
import {removeRedirect} from '../../operations/removeRedirect.ts'
import {updateUpload} from '../../operations/updateUpload.ts'
import {updateViaArchive} from '../../operations/updateViaArchive.ts'
import {getDocumentClientState} from '../../operations/getDocumentClientState.ts'
import {functionContext} from '../../fn/functionContext.ts'
import {htmlEditorPage} from '../utils/htmlEditorPage.ts'
import {htmlLoginPage} from '../utils/htmlLoginPage.ts'
import {signup} from '../../operations/signup.ts'
import {deleteSession} from '../../operations/deleteSession.ts'
import {login} from '../../operations/login.ts'
import {createSession} from '../../operations/createSession.ts'
import {getUsersCount} from '../../operations/getUsersCount.ts'
import {search} from '../../operations/search.ts'
import {removeDocument} from '../../operations/removeDocument.ts'
import type {DocumentQuery, RenderDocumentsManyQuery, UploadsManyQuery} from '../../operations/types.ts'
import type {MiddlewareHandler} from 'hono'
import type {AppContext} from '../utils/types.ts'
import {Readable} from 'stream'

// GET: /edit?whoami - validate auth and return OK
export const whoami: MiddlewareHandler<AppContext> = async (c, _next) => {
  return c.text('OK', 200)
}

// Middleware to check if path ends with /edit and extract docPath
export const editPage: MiddlewareHandler<AppContext> = async (c, next) => {
  const fullPath = c.req.path

  if (!fullPath.endsWith('/edit')) {
    return next()
  }

  const docPath = fullPath.slice(0, -5) || '/'
  c.set('docPath', docPath)
  await next()
}

// Middleware to return 404 for non-edit paths when document was not found
// This runs after documentHandler and editPage, so if we reach here without docPath,
// it means: 1) no document was found, 2) path doesn't end with /edit
// Exception: .git paths should be handled by gitHandler later
export const notFoundPage: MiddlewareHandler<AppContext> = async (c, next) => {
  const docPath = c.get('docPath')
  if (!docPath) {
    // No document found and not an edit page - return 404
    return c.html('<h1>404 - Not Found</h1>', 404)
  }
  return next()
}

// POST: Logout
export const logoutPost: MiddlewareHandler<AppContext> = async (c, next) => {
  const docPath = c.get('docPath')
  if (!docPath) {
    return next()
  }

  const sessionId = c.req.header('cookie')?.match(/session_id=([^;]+)/)?.[1]
  if (sessionId) {
    await deleteSession(c.get('client'), {session_id: sessionId})
  }

  c.header('Set-Cookie', 'session_id=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; SameSite=Lax')

  const redirectPath = docPath === '/' ? '/edit' : `${docPath}/edit`
  return c.redirect(redirectPath, 302)
}

// Middleware to compute and set signup state in context
export const signupStateMiddleware: MiddlewareHandler<AppContext> = async (c, next) => {
  const docPath = c.get('docPath')
  if (!docPath) {
    return next()
  }

  const allowSignupEnv = process.env.ALLOW_SIGNUP === 'true'
  const signupLimitEnv = process.env.SIGNUP_LIMIT
  const signupLimit = signupLimitEnv ? parseInt(signupLimitEnv, 10) : 1
  const validLimit = !isNaN(signupLimit) && signupLimit > 0 ? signupLimit : 1

  // Determine if signup is actually allowed
  let allowSignup = allowSignupEnv
  if (allowSignup) {
    const result = await getUsersCount(c.get('client'))
    allowSignup = result.count < validLimit
  }

  c.set('allowSignup', allowSignup)

  return next()
}

// GET: If unauthenticated, render login page with 401 (no redirect)
export const loginPage: MiddlewareHandler<AppContext> = async (c, next) => {
  const docPath = c.get('docPath')
  if (!docPath) {
    return next()
  }

  if (c.get('isAuthenticated')) {
    return next()
  }

  const allowSignup = c.get('allowSignup') ?? false
  return htmlLoginPage({allowSignup, status: 401})
}

// POST: Handle login/signup form submission on /edit (no /edit/login)
export const loginPost: MiddlewareHandler<AppContext> = async (c, next) => {
  const docPath = c.get('docPath')
  if (!docPath) {
    return next()
  }

  const contentType = c.req.header('content-type') || ''
  if (!contentType.includes('application/x-www-form-urlencoded')) {
    return next()
  }

  const allowSignup = c.get('allowSignup') ?? false

  try {
    const body = await c.req.parseBody()
    const action = body.action?.toString() // 'login' or 'signup'
    const username = body.username?.toString()
    const password = body.password?.toString()

    if (!username || !password) {
      return htmlLoginPage({error: 'Username and password are required', allowSignup, status: 401})
    }

    const user =
      action === 'signup'
        ? await (async () => {
            if (!allowSignup) {
              throw new Error('Signup is disabled')
            }
            const password_confirm = body.password_confirm?.toString()
            if (!password_confirm) {
              throw new Error('Password confirmation is required')
            }
            return signup(c.get('client'), {username, password, password_confirm})
          })()
        : await login(c.get('client'), {username, password})

    const session = await createSession(c.get('client'), {user_id: user.id})

    // Set the session cookie with SameSite=Lax for CSRF protection
    // Lax allows the cookie on top-level navigations (GET) but blocks cross-site POST
    c.header(
      'Set-Cookie',
      `session_id=${session.session_id}; HttpOnly; Path=/; Max-Age=${30 * 24 * 60 * 60}; SameSite=Lax`,
    )

    // Redirect to the editor page after successful login
    // This ensures the cookie is properly set and the URL is clean
    const redirectPath = docPath === '/' ? '/edit' : `${docPath}/edit`
    return c.redirect(redirectPath, 302)
  } catch (error) {
    return htmlLoginPage({
      error: error instanceof Error ? error.message : 'Authentication failed',
      allowSignup,
      status: 401,
    })
  }
}

// POST: Search documents (used by template/slot picker UI)
export const searchDocuments: MiddlewareHandler<AppContext> = async (c, next) => {
  const docPath = c.get('docPath')
  if (!docPath) {
    return next()
  }

  const query = c.req.query('query') || ''
  const limitStr = c.req.query('limit')

  // Parse limit (default to 10, max 100)
  let limit = 10
  if (limitStr) {
    const parsedLimit = parseInt(limitStr, 10)
    if (isNaN(parsedLimit) || parsedLimit < 1) {
      return c.json({error: 'Limit must be a positive integer'}, 400)
    }
    limit = Math.min(parsedLimit, 100)
  }

  try {
    const results = await search(c.get('client'), {
      query,
      limit,
    })
    return c.json(results)
  } catch (error) {
    console.error('Search error:', error)
    return c.json({error: error instanceof Error ? error.message : 'Search failed'}, 500)
  }
}

// GET: Render editor page
export const renderEditorPage: MiddlewareHandler<AppContext> = async (c, next) => {
  const docPath = c.get('docPath')
  if (!docPath) {
    return next()
  }

  const state = await getDocumentClientState(c.get('client'), {path: docPath}, undefined, c.req.query())

  // If document doesn't exist, still render editor for new document creation
  // The editor will create the document on first save

  // Check if document was accessed via redirect path - redirect to canonical edit path
  if (state?.document?.redirect) {
    const canonicalEditPath = state.document.path === '/' ? '/edit' : `${state.document.path}/edit`
    return new Response(null, {
      status: 302,
      headers: {Location: canonicalEditPath},
    })
  }

  return htmlEditorPage({state, fallbackPath: docPath})
}

// POST: Upload file
export const uploadFile: MiddlewareHandler<AppContext> = async (c, next) => {
  const docPath = c.get('docPath')
  if (!docPath) {
    return next()
  }

  const contentType = c.req.header('content-type')
  if (!contentType?.includes('multipart/form-data')) {
    return c.json({error: 'Upload requests must use multipart/form-data'}, 415)
  }

  try {
    const formData = await c.req.formData()
    const file = formData.get('file')

    if (!file || !(file instanceof File)) {
      return c.json({error: 'No file provided'}, 400)
    }

    const uploadsPath = c.get('uploadsPath')
    const result = await addUpload(c.get('client'), {path: docPath}, uploadsPath, file)

    return c.json({
      success: true,
      filename: result.filename,
      original_filename: result.original_filename,
      hidden: result.hidden,
      url: `./uploads/${encodeURIComponent(result.original_filename)}`,
    })
  } catch (error) {
    console.error('Upload error:', error)
    return c.json({error: error instanceof Error ? error.message : 'Upload failed'}, 500)
  }
}

// POST: Add redirect
export const addRedirectHandler: MiddlewareHandler<AppContext> = async (c, next) => {
  const docPath = c.get('docPath')
  if (!docPath) {
    return next()
  }

  const contentType = c.req.header('content-type') || ''
  if (!contentType.includes('application/json')) {
    return c.json({error: 'Redirect requests must use application/json'}, 415)
  }

  try {
    const body = await c.req.json()

    const {redirect} = (body || {}) as {redirect?: unknown}

    if (!redirect || typeof redirect !== 'string') {
      return c.json({error: 'Invalid redirect path'}, 400)
    }

    const route = await addRedirect(c.get('client'), {path: docPath}, {path: redirect})

    return c.json({
      success: true,
      redirect: {
        id: route.id,
        path: route.path,
        document_id: route.document_id,
        created_at: route.created_at,
      },
    })
  } catch (error) {
    if (error instanceof SyntaxError) {
      return c.json({error: 'Invalid JSON body'}, 400)
    }
    console.error('Redirect error:', error)
    return c.json({error: error instanceof Error ? error.message : 'Redirect creation failed'}, 500)
  }
}

// POST: Preview render
export const previewRender: MiddlewareHandler<AppContext> = async (c, next) => {
  const docPath = c.get('docPath')
  if (!docPath) {
    return next()
  }

  try {
    const body = await c.req.json().catch(() => ({}))
    const uploadsPath = c.get('uploadsPath')
    const result = await getDocumentClientState(c.get('client'), {path: docPath}, body, c.req.query(), {
      uploadsPath,
    })
    return c.json(result)
  } catch (error) {
    console.error('Document client state error:', error)
    return c.json(
      {
        error: 'Failed to process request',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      500,
    )
  }
}

// DELETE: Delete upload
export const deleteUpload: MiddlewareHandler<AppContext> = async (c, next) => {
  const docPath = c.get('docPath')
  if (!docPath) {
    return next()
  }

  const url = new URL(c.req.url)
  const uploadFilename = url.searchParams.get('upload')

  if (!uploadFilename) {
    return next()
  }

  try {
    const uploadsPath = c.get('uploadsPath')
    const result = await removeUpload(c.get('client'), {path: docPath}, uploadsPath, uploadFilename)

    return c.json({
      success: true,
      filename: result.filename,
      original_filename: result.original_filename,
    })
  } catch (error) {
    console.error('Upload deletion error:', error)
    return c.json({error: error instanceof Error ? error.message : 'Upload deletion failed'}, 500)
  }
}

// PATCH: Update upload (rename or toggle hidden status)
export const updateUploadHandler: MiddlewareHandler<AppContext> = async (c, next) => {
  const docPath = c.get('docPath')
  if (!docPath) {
    return next()
  }

  const url = new URL(c.req.url)
  const uploadId = url.searchParams.get('uploadId')

  if (!uploadId) {
    return next()
  }

  const contentType = c.req.header('content-type') || ''
  if (!contentType.includes('application/json')) {
    return c.json({error: 'Update upload requests must use application/json'}, 415)
  }

  try {
    const body = await c.req.json()
    const {original_filename, hidden} = body as {original_filename?: string; hidden?: boolean}

    const result = await updateUpload(
      c.get('client'),
      parseInt(uploadId, 10) as import('../../operations/types.ts').UploadId,
      {
        original_filename,
        hidden,
      },
    )

    return c.json({
      success: true,
      id: result.id,
      filename: result.filename,
      original_filename: result.original_filename,
      hidden: result.hidden,
      url: `./uploads/${encodeURIComponent(result.original_filename)}`,
    })
  } catch (error) {
    console.error('Upload update error:', error)
    return c.json({error: error instanceof Error ? error.message : 'Upload update failed'}, 500)
  }
}

// DELETE: Delete redirect
export const deleteRedirect: MiddlewareHandler<AppContext> = async (c, next) => {
  const docPath = c.get('docPath')
  if (!docPath) {
    return next()
  }

  const url = new URL(c.req.url)
  const redirectPath = url.searchParams.get('redirect')

  if (!redirectPath) {
    return next()
  }

  try {
    const deleted = await removeRedirect(c.get('client'), redirectPath)

    if (!deleted) {
      return c.json({error: 'Redirect not found or could not be deleted'}, 404)
    }

    return c.json({
      success: true,
      path: redirectPath,
    })
  } catch (error) {
    console.error('Redirect deletion error:', error)
    return c.json({error: error instanceof Error ? error.message : 'Redirect deletion failed'}, 500)
  }
}

// DELETE: Delete document
export const deleteDocument: MiddlewareHandler<AppContext> = async (c, next) => {
  const docPath = c.get('docPath')
  if (!docPath) {
    return next()
  }

  const url = new URL(c.req.url)
  const shouldDeleteDocument = url.searchParams.get('remove')

  if (!shouldDeleteDocument) {
    return next()
  }

  try {
    await removeDocument(c.get('client'), {path: docPath})

    // Redirect to the document's edit page (will show empty editor since document is deleted)
    const redirectPath = docPath === '/' ? '/edit' : `${docPath}/edit`
    return c.redirect(redirectPath, 302)
  } catch (error) {
    console.error('Document deletion error:', error)
    // Redirect to the document's edit page even on error
    const redirectPath = docPath === '/' ? '/edit' : `${docPath}/edit`
    return c.redirect(redirectPath, 302)
  }
}

// POST: Delete document (for form submissions)
export const deleteDocumentPost: MiddlewareHandler<AppContext> = async (c, next) => {
  const docPath = c.get('docPath')
  if (!docPath) {
    return next()
  }

  try {
    await removeDocument(c.get('client'), {path: docPath})

    // Redirect to the document's edit page (will show empty editor since document is deleted)
    const redirectPath = docPath === '/' ? '/edit' : `${docPath}/edit`
    return c.redirect(redirectPath, 302)
  } catch (error) {
    console.error('Document deletion error:', error)
    // Redirect to the document's edit page even on error
    const redirectPath = docPath === '/' ? '/edit' : `${docPath}/edit`
    return c.redirect(redirectPath, 302)
  }
}

// POST: Update document from archive (Content-Type: application/gzip)
// This replaces the previous /edit/update endpoint; requests should POST to /edit.
export const updateFromArchive: MiddlewareHandler<AppContext> = async (c, next) => {
  const docPath = c.get('docPath')
  if (!docPath) {
    return next()
  }

  const contentType = c.req.header('content-type')
  const isGzip = Boolean(contentType?.includes('application/gzip') || contentType?.includes('application/x-gzip'))
  if (!isGzip) {
    return c.json({error: 'Update requests must use application/gzip'}, 415)
  }

  const contentDisposition = c.req.header('content-disposition')
  if (contentDisposition) {
    const filenameMatch = contentDisposition.match(/filename="?([^"]+)"?/)
    if (filenameMatch) {
      const filename = filenameMatch[1]
      if (!filename.endsWith('.tar.gz') && !filename.endsWith('.tgz')) {
        return c.json({error: 'Archive must be a .tar.gz or .tgz file'}, 400)
      }
    }
  }

  try {
    const webStream = c.req.raw.body
    if (!webStream) {
      return c.json({error: 'No archive data provided'}, 400)
    }

    const nodeStream = Readable.fromWeb(webStream as ReadableStream)
    await updateViaArchive(c.get('client'), {path: docPath}, nodeStream)

    return c.json({
      success: true,
      message: 'Document updated successfully',
      path: docPath,
    })
  } catch (error) {
    console.error('Update error:', error)
    return c.json({error: error instanceof Error ? error.message : 'Update failed'}, 400)
  }
}

// POST: Function context API (POST /edit?fn=<functionName>)
// Moved here so /edit is a single consolidated endpoint.
export const functionContextHandler: MiddlewareHandler<AppContext> = async (c, next) => {
  const docPath = c.get('docPath')
  if (!docPath) {
    return next()
  }

  const fnName = c.req.query('fn')
  if (!fnName) {
    return c.json({error: 'fn query parameter required'}, 400)
  }

  try {
    const body = await c.req.json()

    // This context is only used as a fallback; getUploads requires an explicit path.
    const minimalDoc = {path: docPath}
    const fn = functionContext(c.get('client'), minimalDoc, c.req.query())

    switch (fnName) {
      case 'getPage': {
        const {query} = body as {query: DocumentQuery}
        if (!query) {
          return c.json({error: 'query parameter required'}, 400)
        }
        const result = await fn.getPage(query)
        return c.json(result)
      }

      case 'getPages': {
        const {options} = body as {options?: RenderDocumentsManyQuery}
        const result = await fn.getPages(options)
        return c.json(result)
      }

      case 'getUploads': {
        const {options} = body as {options?: UploadsManyQuery & {path?: string}}
        if (!options?.path) {
          return c.json({error: 'path required in options'}, 400)
        }
        const result = await fn.getUploads(options)
        return c.json(result)
      }

      default:
        return c.json({error: `Unknown function: ${fnName}`}, 400)
    }
  } catch (error) {
    console.error('Function context error:', error)
    return c.json(
      {
        error: 'Function execution failed',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      500,
    )
  }
}
