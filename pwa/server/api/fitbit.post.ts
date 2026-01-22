import { defineEventHandler, readBody } from 'h3'

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const config = useRuntimeConfig()
  
  // We need these from process.env or runtimeConfig. 
  // In Nuxt, process.env is available in server routes, 
  // but better to use config if mapped.
  // We didn't map them all in nuxt.config.ts, so let's check process.env as fallback.
  
  const clientId = config.public.fitbitClientId || process.env.FITBIT_CLIENT_ID
  const clientSecret = config.fitbitClientSecret || process.env.FITBIT_CLIENT_SECRET
  let accessToken = process.env.FITBIT_ACCESS_TOKEN
  let refreshToken = process.env.FITBIT_REFRESH_TOKEN

  if (!clientId || !clientSecret || !accessToken) {
    throw createError({
      statusCode: 500,
      statusMessage: 'Fitbit credentials missing on server'
    })
  }

  // Helper to log activity
  async function logActivity(token: string) {
    // Fitbit API: Log Activity
    // POST https://api.fitbit.com/1/user/-/activities.json
    const params = new URLSearchParams()
    params.append('activityId', '90013') // Treadmill
    params.append('manualCalories', Math.floor(body.calories).toString())
    params.append('startTime', body.startTime) // HH:mm
    params.append('durationMillis', body.durationMillis.toString())
    params.append('date', body.date) // YYYY-MM-DD
    params.append('distance', body.distance.toString())
    params.append('distanceUnit', 'Kilometer')

    const response = await fetch('https://api.fitbit.com/1/user/-/activities.json', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: params
    })

    if (!response.ok) {
        throw { response }
    }
    
    return await response.json()
  }

  try {
    return await logActivity(accessToken)
  } catch (err: any) {
    // Check if 401 Unauthorized -> Refresh Token
    if (err.response && err.response.status === 401 && refreshToken) {
        console.log('Fitbit token expired, refreshing...')
        
        const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64')
        const refreshParams = new URLSearchParams()
        refreshParams.append('grant_type', 'refresh_token')
        refreshParams.append('refresh_token', refreshToken)

        const refreshRes = await fetch('https://api.fitbit.com/oauth2/token', {
            method: 'POST',
            headers: {
                'Authorization': `Basic ${basicAuth}`,
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: refreshParams
        })

        if (!refreshRes.ok) {
             throw createError({
                statusCode: 500,
                statusMessage: 'Failed to refresh Fitbit token'
             })
        }

        const tokens = await refreshRes.json()
        const newAccessToken = tokens.access_token
        // Ideally we save the new refresh token somewhere, but for now we just use the access token
        // In a real app, we'd update the DB or file.
        // updateEnvFile(tokens.refresh_token) // Implementing this is complex safely.

        console.log('Token refreshed, retrying upload...')
        return await logActivity(newAccessToken)
    }
    
    throw createError({
        statusCode: 500,
        statusMessage: `Fitbit Upload Failed: ${err.message || 'Unknown error'}`
    })
  }
})
