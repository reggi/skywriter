import {readFileSync, statSync, watch} from 'fs'
import {join} from 'path'
import type {MiddlewareHandler} from 'hono'
import type {AppContext} from '../utils/types.ts'

const isDev = process.env.NODE_ENV === 'development'
const distDir = join(import.meta.dirname!, '../../../dist')
const htmlDir = join(import.meta.dirname!, '../utils')
const editorDir = join(import.meta.dirname!, '../../editor')

// Cache for production
const productionCache = new Map<string, {content: string; contentType: string; etag: string}>()

// Development: track file changes
let JS_CHANGED = true // Start true to build on first request
let CSS_CHANGED = false
let cachedJsBundle: string | null = null
let cachedJsEtag: string | null = null

// Watch for file changes in development
if (isDev) {
  // Watch editor directory for JS/TS changes
  watch(editorDir, {recursive: true}, (_, filename) => {
    if (filename && /\.(ts|js)$/.test(filename)) {
      JS_CHANGED = true
      console.log(`📝 Editor file changed: ${filename}`)
    }
  })

  // Watch CSS file
  watch(join(htmlDir, 'editor.css'), () => {
    CSS_CHANGED = true
    console.log(`🎨 CSS file changed`)
  })
}

function getAssetPath(filename: string): string {
  if (filename === 'editor.css') {
    return join(htmlDir, filename)
  }
  // Handle JS bundles
  if (filename === 'editor.js') {
    const bundleFilename = isDev ? 'editor.bundle.dev.js' : 'editor.bundle.prod.js'
    return join(distDir, bundleFilename)
  }
  if (filename === 'editor.js.map' && isDev) {
    return join(distDir, 'editor.bundle.dev.js.map')
  }
  return join(distDir, filename)
}

function getContentType(filename: string): string {
  if (filename.endsWith('.js')) return 'application/javascript; charset=utf-8'
  if (filename.endsWith('.css')) return 'text/css; charset=utf-8'
  if (filename.endsWith('.map')) return 'application/json; charset=utf-8'
  return 'application/octet-stream'
}

export const assets: MiddlewareHandler<AppContext> = async c => {
  const query = c.req.query()

  // Determine which asset to serve based on query parameter
  let filename: string
  if ('style' in query) {
    filename = 'editor.css'
  } else if ('script' in query) {
    filename = 'editor.js'
  } else {
    return c.notFound()
  }

  try {
    const contentType = getContentType(filename)

    // Development: build JS on-demand only if changed
    if (isDev && filename === 'editor.js') {
      if (JS_CHANGED || !cachedJsBundle) {
        try {
          const esbuild = await import('esbuild')
          console.log('🔨 Building editor bundle...')
          await esbuild.build({
            entryPoints: [join(editorDir, 'index.ts')],
            bundle: true,
            format: 'iife',
            platform: 'browser',
            target: 'es2020',
            minify: false,
            sourcemap: 'inline',
            write: true,
            outfile: join(distDir, 'editor.bundle.dev.js'),
          })

          // Also cache in memory for faster subsequent requests
          const assetPath = join(distDir, 'editor.bundle.dev.js')
          cachedJsBundle = readFileSync(assetPath, 'utf-8')
          cachedJsEtag = `"${Date.now()}"`
          JS_CHANGED = false
          console.log('✓ Editor bundle built and saved')
        } catch (error) {
          console.error('❌ Error building editor bundle:', error)
          return c.text('Error building bundle', 500)
        }
      }

      return new Response(cachedJsBundle, {
        status: 200,
        headers: {
          'Content-Type': contentType,
          ETag: cachedJsEtag!,
          'Cache-Control': 'no-cache',
        },
      })
    }

    // Development: serve CSS from disk, rebuild check
    if (isDev && filename === 'editor.css') {
      const assetPath = getAssetPath(filename)
      const content = readFileSync(assetPath, 'utf-8')
      const stats = statSync(assetPath)
      const etag = `"${stats.mtime.getTime()}-${stats.size}"`

      if (CSS_CHANGED) {
        console.log('✓ CSS reloaded')
        CSS_CHANGED = false
      }

      const ifNoneMatch = c.req.header('if-none-match')
      if (ifNoneMatch === etag) {
        return new Response(null, {
          status: 304,
          headers: {
            ETag: etag,
            'Cache-Control': 'no-cache',
          },
        })
      }

      return new Response(content, {
        status: 200,
        headers: {
          'Content-Type': contentType,
          ETag: etag,
          'Cache-Control': 'no-cache',
        },
      })
    }

    // Production: use aggressive caching
    const assetPath = getAssetPath(filename)
    if (!isDev) {
      const cached = productionCache.get(filename)
      if (cached) {
        // Check ETag
        const ifNoneMatch = c.req.header('if-none-match')
        if (ifNoneMatch === cached.etag) {
          return new Response(null, {
            status: 304,
            headers: {
              ETag: cached.etag,
              'Cache-Control': 'public, max-age=31536000, immutable',
            },
          })
        }
        return new Response(cached.content, {
          status: 200,
          headers: {
            'Content-Type': cached.contentType,
            ETag: cached.etag,
            'Cache-Control': 'public, max-age=31536000, immutable',
          },
        })
      }

      // Load and cache
      const content = readFileSync(assetPath, 'utf-8')
      const etag = `"${Buffer.from(content).toString('base64').slice(0, 27)}"`
      productionCache.set(filename, {content, contentType, etag})

      return new Response(content, {
        status: 200,
        headers: {
          'Content-Type': contentType,
          ETag: etag,
          'Cache-Control': 'public, max-age=31536000, immutable',
        },
      })
    }
  } catch (error) {
    console.error(`Error serving asset ${filename}:`, error)
    return c.notFound()
  }
}
