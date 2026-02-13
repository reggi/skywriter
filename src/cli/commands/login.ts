import {input, password, confirm} from '@inquirer/prompts'
import {sanitizeServerUrl, readServerConfig} from '../utils/config.ts'
import type {CliCommand} from '../utils/types.ts'
import {createPrefixLog} from '../utils/prefixLog.ts'
import {createLoggedFetch} from '../utils/loggedFetch.ts'

interface LoginOptions {
  url?: string
  yes?: boolean
  useEnv?: boolean
  authStore?: 'file'
}

/**
 * Parse SKYWRITER_SECRET env var which can be:
 *   - A full URL with user and password: http://user:pass@host.com
 *   - A URL with user only: http://user@host.com
 *   - A URL without user: http://host.com
 *   - Just a password string
 */
function parseSecret(secret: string): {serverUrl?: string; username?: string; password?: string} {
  try {
    const parsed = new URL(secret)
    const result: {serverUrl?: string; username?: string; password?: string} = {
      serverUrl: parsed.origin,
    }
    if (parsed.username) result.username = decodeURIComponent(parsed.username)
    if (parsed.password) result.password = decodeURIComponent(parsed.password)
    return result
  } catch {
    return {password: secret}
  }
}

/**
 * Login command - prompts for credentials and saves to secure storage
 * Supports:
 *   - skywriter login                                    (fully interactive)
 *   - skywriter login http://host.com                    (prompts user + password)
 *   - skywriter login http://user@host.com               (prompts password only)
 *   - SKYWRITER_SECRET=pass skywriter login http://user@host.com  (non-interactive)
 *   - SKYWRITER_SECRET=http://user:pass@host skywriter login -y   (fully non-interactive)
 */
export const login: CliCommand<[LoginOptions?]> = async (ctx, options = {}) => {
  const {url: argUrl, yes, useEnv, authStore} = options
  const cmdLog = createPrefixLog(ctx.cliName, 'login')
  const envSecretVar = `${ctx.cliId.toUpperCase()}_SECRET`
  const envSecret = useEnv ? process.env[envSecretVar] : undefined

  if (useEnv && !envSecret) {
    throw new Error(`${envSecretVar} environment variable is not set`)
  }

  // Parse secret if present
  const secret = envSecret ? parseSecret(envSecret) : {}

  // Collision: both env var and CLI arg provide a server URL
  if (secret.serverUrl && argUrl) {
    throw new Error(`Cannot provide both ${envSecretVar} URL and a CLI url argument`)
  }

  const providedUrl = argUrl || (secret.serverUrl ? envSecret! : undefined)

  let serverUrl: string
  let username: string

  let urlPassword: string | undefined

  if (providedUrl) {
    const parsed = new URL(providedUrl)
    serverUrl = parsed.origin
    if (parsed.password) {
      urlPassword = decodeURIComponent(parsed.password)
      cmdLog.warn(`Password in URL is saved in shell history. Use ${envSecretVar} with --use-env instead.`)
    }
    if (secret.username || parsed.username) {
      username = secret.username || decodeURIComponent(parsed.username)
    } else {
      username = await input({
        message: 'Username:',
        validate: value => {
          if (!value || value.trim().length === 0) {
            return 'Username is required'
          }
          return true
        },
      })
    }
  } else {
    serverUrl = await input({
      message: 'Server URL:',
      validate: value => {
        try {
          sanitizeServerUrl(value)
          return true
        } catch {
          return 'Please enter a valid URL (e.g., https://example.com)'
        }
      },
    })

    username = await input({
      message: 'Username:',
      validate: value => {
        if (!value || value.trim().length === 0) {
          return 'Username is required'
        }
        return true
      },
    })
  }

  // Get password from secret, URL, or prompt
  let userPassword: string
  if (secret.password || urlPassword) {
    userPassword = (secret.password || urlPassword)!
  } else {
    userPassword = await password({
      message: 'Password:',
      mask: '*',
      validate: value => {
        if (!value || value.trim().length === 0) {
          return 'Password is required'
        }
        return true
      },
    })
  }

  // Verify credentials against the server's whoami endpoint
  const sanitizedUrl = sanitizeServerUrl(serverUrl)
  const whoamiUrl = `${sanitizedUrl}/edit?whoami`
  const loggedFetch = createLoggedFetch(cmdLog)

  let response: Response
  try {
    response = await loggedFetch(whoamiUrl, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${username}:${userPassword}`).toString('base64')}`,
      },
    })
  } catch {
    throw new Error('Failed to connect to server')
  }

  if (response.status === 401) {
    throw new Error('Invalid username or password')
  }

  if (!response.ok) {
    throw new Error(`Server returned status ${response.status} ${response.statusText}`)
  }

  // Check if there are existing servers and ask if this should be the default
  const serverConfig = await readServerConfig(ctx, cmdLog)
  const servers = serverConfig.listServers()
  let setAsDefault = true

  if (servers.length > 0 && !yes) {
    setAsDefault = await confirm({
      message: 'Set this server as the default?',
      default: false,
    })
  }

  // Save credentials
  await serverConfig.storeCredentials(sanitizedUrl, username, userPassword, {setAsDefault, authStore})
}
