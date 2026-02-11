import {cleanupTestUsers, closePool} from './helpers/db.js'

/**
 * Global teardown for e2e tests
 * Runs once after all tests to clean up test users
 */
async function globalTeardown() {
  console.log('🧹 Cleaning up test users after tests...')

  try {
    const deletedCount = await cleanupTestUsers()
    console.log(`✅ Cleaned up ${deletedCount} test user(s)`)
  } catch (error) {
    console.warn('⚠️ Could not clean up test users:', error)
  } finally {
    await closePool()
  }
}

export default globalTeardown
