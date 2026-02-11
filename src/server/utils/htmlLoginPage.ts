import {readFileSync} from 'fs'
import {join} from 'path'

// Read CSS once at module load
const layoutCSS = readFileSync(join(import.meta.dirname!, 'layout.css'), 'utf-8')

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export function htmlLoginPage(options?: {error?: string; allowSignup?: boolean; status?: number}): Response {
  const {error, allowSignup = true, status = 200} = options || {}
  const title = allowSignup ? 'Login / Sign Up' : 'Login'
  const html = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${title}</title>
    <style>${layoutCSS}</style>
  </head>
  <body>
    <div class="auth-container">
      <div class="auth-header">
        <h1>Welcome</h1>
        <p>Login to your account or create a new one</p>
      </div>
      
      ${error ? `<div class="error-message">${escapeHtml(error)}</div>` : ''}
      
      <div class="forms-container" style="${!allowSignup ? 'grid-template-columns: 1fr; max-width: 450px; margin: 0 auto;' : ''}">
        <div class="form-panel">
          <h2>Login</h2>
          <form method="POST" action="?login">
            <input type="hidden" name="action" value="login" />
            <div class="form-group">
              <label for="login-username">Username</label>
              <input
                type="text"
                id="login-username"
                name="username"
                required
                minlength="3"
                maxlength="50"
                placeholder="Enter your username"
                autocomplete="username"
              />
            </div>
            
            <div class="form-group">
              <label for="login-password">Password</label>
              <input
                type="password"
                id="login-password"
                name="password"
                required
                minlength="8"
                placeholder="Enter your password"
                autocomplete="current-password"
              />
            </div>
            
            <button type="submit" class="btn-submit">Login</button>
          </form>
        </div>
        ${
          allowSignup
            ? `
        <div class="form-panel">
          <h2>Sign Up</h2>
          <form method="POST" action="?login">
            <input type="hidden" name="action" value="signup" />
            <div class="form-group">
              <label for="signup-username">Username</label>
              <input
                type="text"
                id="signup-username"
                name="username"
                required
                minlength="3"
                maxlength="50"
                pattern="[a-zA-Z0-9_-]+"
                placeholder="Choose a username"
                autocomplete="username"
                title="Username can only contain letters, numbers, underscores, and hyphens"
              />
            </div>
            
            <div class="form-group">
              <label for="signup-password">Password</label>
              <input
                type="password"
                id="signup-password"
                name="password"
                required
                minlength="8"
                maxlength="128"
                placeholder="Choose a password"
                autocomplete="new-password"
              />
            </div>
            
            <div class="form-group">
              <label for="signup-password-confirm">Confirm Password</label>
              <input
                type="password"
                id="signup-password-confirm"
                name="password_confirm"
                required
                minlength="8"
                maxlength="128"
                placeholder="Confirm your password"
                autocomplete="new-password"
              />
            </div>
            
            <button type="submit" class="btn-submit">Sign Up</button>
          </form>
        </div>
        `
            : ''
        }
      </div>
    </div>
  </body>
</html>`

  return new Response(html, {
    status,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
    },
  })
}
