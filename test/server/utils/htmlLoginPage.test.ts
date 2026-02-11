import assert from 'node:assert/strict'
import {describe, it} from 'node:test'
import {htmlLoginPage} from '../../../src/server/utils/htmlLoginPage.ts'

describe('renderLogin', () => {
  it('should return a Response with status 200 by default', async () => {
    const response = htmlLoginPage()
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('Content-Type'), 'text/html; charset=utf-8')
  })

  it('should include both login and signup forms by default', async () => {
    const response = htmlLoginPage()
    const html = await response.text()
    assert.ok(html.includes('<title>Login / Sign Up</title>'))
    assert.ok(html.includes('<h2>Login</h2>'))
    assert.ok(html.includes('<h2>Sign Up</h2>'))
    assert.ok(html.includes('name="action" value="login"'))
    assert.ok(html.includes('name="action" value="signup"'))
  })

  it('should include signup form fields when allowSignup is true', async () => {
    const response = htmlLoginPage({allowSignup: true})
    const html = await response.text()
    assert.ok(html.includes('id="signup-username"'))
    assert.ok(html.includes('id="signup-password"'))
    assert.ok(html.includes('id="signup-password-confirm"'))
    assert.ok(html.includes('name="password_confirm"'))
  })

  it('should hide signup form when allowSignup is false', async () => {
    const response = htmlLoginPage({allowSignup: false})
    const html = await response.text()
    assert.ok(html.includes('<title>Login</title>'))
    assert.ok(html.includes('<h2>Login</h2>'))
    assert.ok(!html.includes('<h2>Sign Up</h2>'))
    assert.ok(!html.includes('id="signup-username"'))
    assert.ok(!html.includes('id="signup-password"'))
    // Should still have login form
    assert.ok(html.includes('id="login-username"'))
    assert.ok(html.includes('id="login-password"'))
  })

  it('should apply single-column styling when allowSignup is false', async () => {
    const response = htmlLoginPage({allowSignup: false})
    const html = await response.text()
    assert.ok(html.includes('grid-template-columns: 1fr'))
    assert.ok(html.includes('max-width: 450px'))
  })

  it('should display error message when provided', async () => {
    const response = htmlLoginPage({error: 'Invalid credentials'})
    const html = await response.text()
    assert.ok(html.includes('class="error-message"'))
    assert.ok(html.includes('Invalid credentials'))
  })

  it('should escape HTML in error messages', async () => {
    const response = htmlLoginPage({error: '<script>alert("xss")</script>'})
    const html = await response.text()
    assert.ok(html.includes('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;'))
    assert.ok(!html.includes('<script>alert("xss")</script>'))
  })

  it('should use custom status code when provided', async () => {
    const response = htmlLoginPage({status: 401})
    assert.equal(response.status, 401)
  })

  it('should use status 400 for error cases', async () => {
    const response = htmlLoginPage({error: 'Bad request', status: 400})
    assert.equal(response.status, 400)
    const html = await response.text()
    assert.ok(html.includes('Bad request'))
  })

  it('should include proper form attributes for login form', async () => {
    const response = htmlLoginPage()
    const html = await response.text()
    assert.ok(html.includes('method="POST"'))
    assert.ok(html.includes('action="?login"'))
    assert.ok(html.includes('autocomplete="username"'))
    assert.ok(html.includes('autocomplete="current-password"'))
  })

  it('should include proper form attributes for signup form', async () => {
    const response = htmlLoginPage({allowSignup: true})
    const html = await response.text()
    assert.ok(html.includes('autocomplete="new-password"'))
    assert.ok(html.includes('pattern="[a-zA-Z0-9_-]+"'))
    assert.ok(html.includes('minlength="8"'))
    assert.ok(html.includes('maxlength="128"'))
  })

  it('should render without error when no options provided', async () => {
    const response = htmlLoginPage()
    const html = await response.text()
    assert.ok(!html.includes('class="error-message"'))
  })

  it('should escape special characters in error messages', async () => {
    const response = htmlLoginPage({error: 'Test & \'quotes\' & "double"'})
    const html = await response.text()
    assert.ok(html.includes('Test &amp; &#39;quotes&#39; &amp; &quot;double&quot;'))
  })
})
