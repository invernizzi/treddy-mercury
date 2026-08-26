import { H3Event, getRequestURL, getCookie, setCookie, deleteCookie, createError } from 'h3'

export interface GoogleSession {
  access_token: string
  refresh_token?: string
  expires_at: number // unix timestamp ms
  scope?: string
}

export function getGoogleConfig(event: H3Event) {
  const config = useRuntimeConfig(event)
  const clientId = config.public.googleClientId || process.env.GOOGLE_CLIENT_ID
  const clientSecret = config.googleClientSecret || process.env.GOOGLE_CLIENT_SECRET
  
  const reqUrl = getRequestURL(event)
  const proto = reqUrl.host.includes('localhost') || reqUrl.host.includes('127.0.0.1')
    ? reqUrl.protocol
    : 'https:'
  const redirectUri = process.env.GOOGLE_REDIRECT_URI || `${proto}//${reqUrl.host}/api/auth/google/callback`

  return { clientId, clientSecret, redirectUri }
}

export function getSessionCookie(event: H3Event): GoogleSession | null {
  const raw = getCookie(event, 'google_health_session')
  if (!raw) return null
  try {
    const jsonStr = decodeURIComponent(escape(atob(raw)))
    return JSON.parse(jsonStr)
  } catch (e) {
    return null
  }
}

export function setSessionCookie(event: H3Event, session: GoogleSession) {
  const jsonStr = JSON.stringify(session)
  const serialized = btoa(unescape(encodeURIComponent(jsonStr)))
  setCookie(event, 'google_health_session', serialized, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 60, // 60 days
    path: '/'
  })
}

export function clearSessionCookie(event: H3Event) {
  deleteCookie(event, 'google_health_session', { path: '/' })
}

export async function getValidAccessToken(event: H3Event, session: GoogleSession): Promise<string> {
  // If token is valid for at least another 60 seconds, use it
  if (session.expires_at > Date.now() + 60000) {
    return session.access_token
  }

  if (!session.refresh_token) {
    throw createError({
      statusCode: 401,
      statusMessage: 'Google session expired and no refresh token available. Please reconnect.'
    })
  }

  const { clientId, clientSecret } = getGoogleConfig(event)
  if (!clientId || !clientSecret) {
    throw createError({
      statusCode: 500,
      statusMessage: 'Google OAuth Client ID/Secret not configured on server'
    })
  }

  const params = new URLSearchParams()
  params.append('client_id', clientId)
  params.append('client_secret', clientSecret)
  params.append('refresh_token', session.refresh_token)
  params.append('grant_type', 'refresh_token')

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params
  })

  if (!res.ok) {
    const errText = await res.text()
    clearSessionCookie(event)
    throw createError({
      statusCode: 401,
      statusMessage: `Failed to refresh Google token: ${errText}`
    })
  }

  const data = (await res.json()) as { access_token: string; expires_in: number; scope?: string }
  session.access_token = data.access_token
  session.expires_at = Date.now() + data.expires_in * 1000
  if (data.scope) session.scope = data.scope

  setSessionCookie(event, session)
  return session.access_token
}

export async function getOrCreateDataSource(
  token: string,
  dataTypeName: string,
  streamName: string
): Promise<string> {
  const dataSourceId = `raw:${dataTypeName}:net.lucainvernizzi.treddy:${streamName}`
  
  // Try getting existing data source
  const getRes = await fetch(
    `https://www.googleapis.com/fitness/v1/users/me/dataSources/${encodeURIComponent(dataSourceId)}`,
    {
      headers: { Authorization: `Bearer ${token}` }
    }
  )

  if (getRes.ok) {
    return dataSourceId
  }

  // Create data source
  const createPayload = {
    dataStreamName: streamName,
    type: 'raw',
    application: {
      name: 'Treddy Mercury',
      version: '1.0'
    },
    dataType: {
      name: dataTypeName
    }
  }

  const postRes = await fetch('https://www.googleapis.com/fitness/v1/users/me/dataSources', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(createPayload)
  })

  if (!postRes.ok) {
    // If creation failed or already existed, return the constructed ID
    console.warn('Could not create data source explicitly, using default stream ID', await postRes.text())
  }

  return dataSourceId
}
