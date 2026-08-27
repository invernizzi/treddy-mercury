import { H3Event, getRequestURL, getCookie, setCookie, deleteCookie, createError } from 'h3'

export interface GoogleSession {
  access_token: string
  refresh_token?: string
  expires_at: number // unix timestamp ms
  scope?: string
}

export const GOOGLE_HEALTH_SCOPE = 'https://www.googleapis.com/auth/googlehealth.activity_and_fitness.writeonly'

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

// Writes a granular active-energy-burned data point so calories also feed the daily
// aggregates/charts, in addition to the exercise summary. Best-effort: failures are non-fatal.
export async function writeActiveEnergyBurned(
  token: string,
  startTimeMillis: number,
  endTimeMillis: number,
  kcal: number
): Promise<void> {
  const payload = {
    dataSource: {
      recordingMethod: 'ACTIVELY_MEASURED'
    },
    activeEnergyBurned: {
      interval: {
        startTime: new Date(startTimeMillis).toISOString(),
        startUtcOffset: '0s',
        endTime: new Date(endTimeMillis).toISOString(),
        endUtcOffset: '0s'
      },
      kcal
    }
  }

  const res = await fetch('https://health.googleapis.com/v4/users/me/dataTypes/active-energy-burned/dataPoints', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json'
    },
    body: JSON.stringify(payload)
  })

  if (!res.ok) {
    console.warn('Could not write active-energy-burned data point:', await res.text())
  }
}
