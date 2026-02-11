export function sanitizeUrl(url: string): string {
  try {
    const urlObj = new URL(url)
    urlObj.username = ''
    urlObj.password = ''
    return urlObj.toString()
  } catch {
    return url
  }
}

export function sanitizeError(error: unknown, authUrl: string, cleanUrl: string): Error {
  const message = (error as Error).message || String(error)
  return new Error(message.replaceAll(authUrl, cleanUrl))
}

export function buildAuthUrl(url: string, auth: string): {authUrl: string; cleanUrl: string} {
  const urlObj = new URL(url)
  const [username, password] = Buffer.from(auth, 'base64').toString('utf-8').split(':')
  urlObj.username = encodeURIComponent(username)
  urlObj.password = encodeURIComponent(password)
  return {authUrl: urlObj.toString(), cleanUrl: sanitizeUrl(urlObj.toString())}
}
