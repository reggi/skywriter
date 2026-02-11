import {cleanupTestUsers, closePool} from './helpers/db.js'

/**
 * Global setup for e2e tests
 * Runs once before all tests to clean up any leftover test users
 */
async function globalSetup() {
  console.log('🧹 Cleaning up test users from previous runs...')

  try {
    const deletedCount = await cleanupTestUsers()
    console.log(`✅ Cleaned up ${deletedCount} test user(s)`)
  } catch (error) {
    console.warn('⚠️ Could not clean up test users:', error)
    // Don't fail the setup - tests might still work
  } finally {
    await closePool()
  }
}

export default globalSetup
