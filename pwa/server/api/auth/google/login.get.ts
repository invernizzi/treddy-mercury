import { defineEventHandler, sendRedirect, createError } from 'h3'
import { getGoogleConfig } from '../../../utils/google'

export default defineEventHandler((event) => {
  const { clientId, redirectUri } = getGoogleConfig(event)

  if (!clientId) {
    throw createError({
      statusCode: 500,
      statusMessage: 'GOOGLE_CLIENT_ID is not configured on the server'
    })
  }

  const scopes = [
    'openid',
    'email',
    'profile',
    'https://www.googleapis.com/auth/fitness.activity.write',
    'https://www.googleapis.com/auth/fitness.location.write',
    'https://www.googleapis.com/auth/fitness.body.write',
    'https://www.googleapis.com/auth/health.workout',
  ]

  const params = new URLSearchParams()
  params.append('client_id', clientId)
  params.append('redirect_uri', redirectUri)
  params.append('response_type', 'code')
  params.append('scope', scopes.join(' '))
  params.append('access_type', 'offline')
  params.append('prompt', 'consent')
  params.append('include_granted_scopes', 'true')

  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`
  return sendRedirect(event, authUrl, 302)
})
