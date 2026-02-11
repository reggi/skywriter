import {Hono} from 'hono'
import type {PoolClient} from 'pg'
import {isAbsolute, resolve} from 'node:path'
import {mkdirSync} from 'node:fs'
import {
  addRedirectHandler,
  deleteDocument,
  deleteDocumentPost,
  deleteRedirect,
  deleteUpload,
  editPage,
  functionContextHandler,
  loginPage,
  loginPost,
  logoutPost,
  notFoundPage,
  previewRender,
  renderEditorPage,
  searchDocuments,
  signupStateMiddleware,
  updateFromArchive,
  updateUploadHandler,
  uploadFile,
  whoami,
} from './routes/edit.ts'
import {documents} from './routes/documents.ts'
import {readUpload} from './routes/readUpload.ts'
import {git} from './routes/git.ts'
import {assets} from './routes/assets.ts'
import type {AppContext} from './utils/types.ts'
import {authorize} from './middleware/authorize.ts'
import {requireQuery} from './middleware/requireQuery.ts'
import {withDb} from './middleware/withDb.ts'
import {establishAuth} from './middleware/establishAuth.ts'
import {log} from './middleware/log.ts'
import {requirePathMatch} from './middleware/requirePathMatch.ts'
import {seedIfEmpty} from '../operations/seedIfEmpty.ts'

export async function createApp(client: PoolClient, options?: {seed?: boolean}) {
  if (options?.seed !== false) await seedIfEmpty(client)

  const uploadsRaw = process.env.UPLOADS_PATH || 'uploads'
  const uploadsPath = isAbsolute(uploadsRaw) ? uploadsRaw : resolve(process.cwd(), uploadsRaw)
  mkdirSync(uploadsPath, {recursive: true})

  const gitReposRaw = process.env.GIT_REPOS_PATH || '.git-repos'
  const gitReposPath = isAbsolute(gitReposRaw) ? gitReposRaw : resolve(process.cwd(), gitReposRaw)
  mkdirSync(gitReposPath, {recursive: true})

  const app = new Hono<AppContext>()

  app.use('/*', async (c, next) => {
    c.set('uploadsPath', uploadsPath)
    c.set('gitReposPath', gitReposPath)
    await next()
  })

  app.use('/*', withDb(client), establishAuth(), log())

  app.all('/*', requirePathMatch(/^(.*)\.git(\/.*)?$/, authorize('Git Access'), git))

  // GET: Document / Render editor page
  app.get(
    '/*',
    documents,
    requirePathMatch(/^(.*)\/uploads\/([^/]+)$/, readUpload),
    editPage,
    requireQuery('style', assets),
    requireQuery('script', assets),
    notFoundPage,
    signupStateMiddleware,
    loginPage,
    authorize('Secure Area'),
    renderEditorPage,
  )

  // POST: Handle file upload, redirect addition, document deletion, or preview rendering
  app.post(
    '/*',
    editPage,
    signupStateMiddleware,
    requireQuery('login', loginPost),
    authorize('Secure Area'),
    requireQuery('logout', logoutPost),
    requireQuery('query', searchDocuments),
    requireQuery('update', updateFromArchive),
    requireQuery('fn', functionContextHandler),
    requireQuery('upload', uploadFile),
    requireQuery('redirect', addRedirectHandler),
    requireQuery('remove', deleteDocumentPost),
    requireQuery('whoami', whoami),
    previewRender,
  )

  // DELETE: Handle upload, redirect, or document deletion
  app.delete('/*', editPage, authorize('Secure Area'), deleteUpload, deleteRedirect, deleteDocument)

  // PATCH: Handle upload updates (rename, toggle hidden)
  app.patch('/*', editPage, authorize('Secure Area'), requireQuery('uploadId', updateUploadHandler))

  // 404 handler
  app.notFound(c => {
    return c.html('<h1>404 - Not Found</h1>', 404)
  })

  // Error handler
  app.onError((err, c) => {
    if ('status' in err && err.status === 404) {
      return c.text('Not Found', 404)
    }
    return c.text('Server Error', 500)
  })

  return app
}
