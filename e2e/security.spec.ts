import {test, expect} from '@playwright/test'

test.describe('Security - Unauthorized Access', () => {
  test('should prevent reading protected /db resource', async ({request}) => {
    const response = await request.get('/db')
    expect([401, 404]).toContain(response.status())
  })

  test('should prevent writing to /db', async ({request}) => {
    const response = await request.post('/db', {
      data: {data: 'test'},
    })
    expect([401, 404]).toContain(response.status())
  })

  test('should prevent deleting from /db', async ({request}) => {
    const response = await request.delete('/db/some-id')
    expect([401, 404]).toContain(response.status())
  })

  test('should prevent listing users', async ({request}) => {
    const response = await request.get('/users')
    expect([401, 404]).toContain(response.status())
  })

  test('should prevent creating users', async ({request}) => {
    const response = await request.post('/users', {
      data: {username: 'attacker', password: 'pw'},
    })
    expect([401, 404]).toContain(response.status())
  })

  test('should prevent accessing admin endpoints', async ({request}) => {
    const response = await request.get('/admin')
    expect([401, 404]).toContain(response.status())
  })

  test('should prevent updating documents', async ({request}) => {
    const response = await request.patch('/db/some-id', {
      data: {data: 'malicious'},
    })
    expect([401, 404]).toContain(response.status())
  })

  test('should return 401 login HTML for GET /edit', async ({page}) => {
    const response = await page.goto('/edit')
    expect(response?.status()).toBe(401)
    await expect(page).toHaveURL(/\/edit(?:\?.*)?$/)
  })

  test('should return 401 for POST /edit', async ({request}) => {
    const response = await request.post('/edit', {
      data: {data: 'test'},
    })
    expect(response.status()).toBe(401)
  })
})
