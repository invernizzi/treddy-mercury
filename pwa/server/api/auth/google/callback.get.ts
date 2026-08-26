import { defineEventHandler, getQuery, sendRedirect, createError, setCookie } from 'h3'
import { getGoogleConfig, setSessionCookie, GoogleSession } from '../../../utils/google'

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const code = query.code as string | undefined
  const error = query.error as string | undefined

  if (error) {
    return sendRedirect(event, `/?auth_error=${encodeURIComponent(error)}`, 302)
  }

  if (!code) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Authorization code missing from Google callback'
    })
  }

  const { clientId, clientSecret, redirectUri } = getGoogleConfig(event)
  if (!clientId || !clientSecret) {
    throw createError({
      statusCode: 500,
      statusMessage: 'Google OAuth Client ID/Secret not configured on server'
    })
  }

  const tokenParams = new URLSearchParams()
  tokenParams.append('code', code)
  tokenParams.append('client_id', clientId)
  tokenParams.append('client_secret', clientSecret)
  tokenParams.append('redirect_uri', redirectUri)
  tokenParams.append('grant_type', 'authorization_code')

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: tokenParams
  })

  if (!res.ok) {
    const errText = await res.text()
    return sendRedirect(event, `/?auth_error=${encodeURIComponent('Token exchange failed: ' + errText)}`, 302)
  }

  const tokens = (await res.json()) as {
    access_token: string
    refresh_token?: string
    expires_in: number
    scope?: string
  }

  const session: GoogleSession = {
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    expires_at: Date.now() + tokens.expires_in * 1000,
    scope: tokens.scope
  }

  setSessionCookie(event, session)

  // Set a non-httpOnly flag so client UI knows it's connected
  setCookie(event, 'google_health_connected', 'true', {
    maxAge: 60 * 60 * 24 * 60,
    path: '/'
  })

  return sendRedirect(event, '/?auth_success=google', 302)
})
