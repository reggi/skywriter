import {readdirSync, statSync} from 'fs'
import {join, relative, basename} from 'path'

const srcDir = join(import.meta.dirname!, '../src')
const testDir = join(import.meta.dirname!, '../test')

// Directories to exclude from test file requirements
const EXCLUDED_DIRS = new Set(['editor', 'db'])

// Basenames to exclude from test file requirements
const EXCLUDED_FILES = new Set(['types.ts'])

interface ComparisonResult {
  srcFiles: string[]
  testFiles: string[]
  missingTests: string[]
  extraTests: string[]
}

function getAllTsFiles(dir: string, basePath: string = ''): string[] {
  const files: string[] = []

  try {
    const entries = readdirSync(dir)

    for (const entry of entries) {
      const fullPath = join(dir, entry)
      const relativePath = basePath ? join(basePath, entry) : entry

      if (statSync(fullPath).isDirectory()) {
        files.push(...getAllTsFiles(fullPath, relativePath))
      } else if (entry.endsWith('.ts') && !entry.endsWith('.test.ts')) {
        files.push(relativePath)
      }
    }
  } catch {
    // Directory doesn't exist
  }

  return files
}

function getAllTestFiles(dir: string, basePath: string = ''): string[] {
  const files: string[] = []

  try {
    const entries = readdirSync(dir)

    for (const entry of entries) {
      const fullPath = join(dir, entry)
      const relativePath = basePath ? join(basePath, entry) : entry

      if (statSync(fullPath).isDirectory()) {
        files.push(...getAllTestFiles(fullPath, relativePath))
      } else if (entry.endsWith('.test.ts')) {
        files.push(relativePath)
      }
    }
  } catch {
    // Directory doesn't exist
  }

  return files
}

function srcToTestPath(srcFile: string): string {
  // src/utils/foo.ts -> utils/foo.test.ts
  return srcFile.replace(/\.ts$/, '.test.ts')
}

function testToSrcPath(testFile: string): string {
  // utils/foo.test.ts -> utils/foo.ts
  return testFile.replace(/\.test\.ts$/, '.ts')
}

// Platform suffixes that are allowed for platform-specific test files
// e.g., credentials.linux.test.ts -> credentials.ts
const PLATFORM_SUFFIXES = ['.linux', '.macos', '.windows']

function testToSrcPathWithPlatform(testFile: string): string | null {
  // Check if test file has a platform suffix
  // e.g., credentials.linux.test.ts -> credentials.ts
  for (const suffix of PLATFORM_SUFFIXES) {
    const pattern = `${suffix}.test.ts`
    if (testFile.endsWith(pattern)) {
      return testFile.replace(pattern, '.ts')
    }
  }
  return null
}

function isExcluded(filePath: string): boolean {
  // Check if file is in an excluded directory
  const topLevelDir = filePath.split('/')[0]
  if (EXCLUDED_DIRS.has(topLevelDir)) {
    return true
  }

  // Check if file basename is excluded
  if (EXCLUDED_FILES.has(basename(filePath))) {
    return true
  }

  return false
}

function compareDirectories(): ComparisonResult {
  const srcFiles = getAllTsFiles(srcDir)
  const testFiles = getAllTestFiles(testDir)

  // Create sets for efficient lookup
  const expectedTestFiles = new Set(srcFiles.filter(f => !isExcluded(f)).map(srcToTestPath))
  const actualTestFiles = new Set(testFiles)

  // Find missing tests (src files without corresponding test files)
  const missingTests: string[] = []
  for (const expected of expectedTestFiles) {
    if (!actualTestFiles.has(expected)) {
      missingTests.push(expected)
    }
  }

  // Find extra tests (test files without corresponding src files)
  const extraTests: string[] = []
  for (const actual of actualTestFiles) {
    const correspondingSrc = testToSrcPath(actual)
    const platformSrc = testToSrcPathWithPlatform(actual)

    // Check if there's a direct match or a platform-specific match
    const hasDirectMatch = srcFiles.includes(correspondingSrc)
    const hasPlatformMatch = platformSrc && srcFiles.includes(platformSrc)

    if (!hasDirectMatch && !hasPlatformMatch && !isExcluded(correspondingSrc)) {
      extraTests.push(actual)
    }
  }

  return {
    srcFiles,
    testFiles,
    missingTests: missingTests.sort(),
    extraTests: extraTests.sort(),
  }
}

function main() {
  console.log('🔍 Comparing src/ and test/ directory structures...\n')

  const result = compareDirectories()

  console.log(`📁 Source files (excluding editor/, db/): ${result.srcFiles.filter(f => !isExcluded(f)).length}`)
  console.log(`🧪 Test files: ${result.testFiles.length}\n`)

  let hasErrors = false

  // Filter extra tests to only .test.ts files (other files are utilities/helpers allowed anywhere)
  const extraTestFiles = result.extraTests.filter(f => f.endsWith('.test.ts'))

  if (extraTestFiles.length > 0) {
    console.log('❌ Extra test files without corresponding src files:')
    for (const file of extraTestFiles) {
      console.log(`   test/${file}`)
    }
    console.log()
    hasErrors = true
  }

  if (!hasErrors) {
    console.log('✅ Test directory structure is valid!')
  }

  // Exit with error code if there are errors
  if (hasErrors) {
    process.exit(1)
  }
}

main()
