import * as esbuild from 'esbuild'
import {writeFileSync} from 'fs'
import {join} from 'path'

const editorDir = join(import.meta.dirname!, '../src/editor')
const outDir = join(import.meta.dirname!, '../dist')

async function buildEditorBundle() {
  const isDev = process.env.NODE_ENV === 'development'
  const bundleFilename = isDev ? 'editor.bundle.dev.js' : 'editor.bundle.prod.js'

  console.log(`Building editor frontend bundle (${isDev ? 'development' : 'production'})...`)

  const result = await esbuild.build({
    entryPoints: [join(editorDir, 'index.ts')],
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: 'es2020',
    minify: !isDev,
    sourcemap: isDev,
    write: false,
  })

  const bundleCode = result.outputFiles[0].text
  const bundlePath = join(outDir, bundleFilename)

  writeFileSync(bundlePath, bundleCode, 'utf-8')

  console.log(`✓ Bundle written to ${bundlePath}`)
  console.log(`  Size: ${(bundleCode.length / 1024).toFixed(2)} KB`)

  return bundlePath
}

async function buildEditorBundleWatch() {
  console.log('Building editor frontend bundle in watch mode...')

  const ctx = await esbuild.context({
    entryPoints: [join(editorDir, 'index.ts')],
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: 'es2020',
    minify: false,
    sourcemap: true,
    outfile: join(outDir, 'editor.bundle.dev.js'),
  })

  await ctx.watch()
  console.log('✓ Watching for changes...')
}

// Run build when script is executed
const watchMode = process.argv.includes('--watch')

if (watchMode) {
  buildEditorBundleWatch().catch(err => {
    console.error('Build failed:', err)
    process.exit(1)
  })
} else {
  buildEditorBundle()
    .then(() => process.exit(0))
    .catch(err => {
      console.error('Build failed:', err)
      process.exit(1)
    })
}

export {buildEditorBundle}
