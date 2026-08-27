import { defineEventHandler, readBody, createError } from 'h3'
import {
  getSessionCookie,
  getValidAccessToken,
  getOrCreateDataSource
} from '../utils/google'

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const session = getSessionCookie(event)

  if (!session) {
    throw createError({
      statusCode: 401,
      statusMessage: 'Not authenticated with Google. Please connect your Google account.'
    })
  }

  const token = await getValidAccessToken(event, session)

  const startTimeMillis = Number(body.startTimeMillis) || Date.now() - (Number(body.durationMillis) || 0)
  const endTimeMillis = Number(body.endTimeMillis) || (startTimeMillis + (Number(body.durationMillis) || 0))
  const distanceMeters = Math.max(0, (Number(body.distanceKm) || 0) * 1000)
  const calories = Math.max(0, Number(body.calories) || 0)

  const startTimeNanos = BigInt(startTimeMillis) * BigInt(1000000)
  const endTimeNanos = BigInt(endTimeMillis) * BigInt(1000000)
  const sessionId = `treddy_${startTimeMillis}`

  // 1. Create or Update Google Fitness Session (Activity Type 58 = Running treadmill)
  const sessionPayload = {
    id: sessionId,
    name: 'Treadmill Run',
    description: 'Tracked with Treddy Mercury',
    startTimeMillis: startTimeMillis.toString(),
    endTimeMillis: endTimeMillis.toString(),
    activityType: 57, // 57 = Running (treadmill)
    application: {
      name: 'Treddy Mercury',
      version: '1.0'
    }
  }

  const sessionRes = await fetch(
    `https://www.googleapis.com/fitness/v1/users/me/sessions/${encodeURIComponent(sessionId)}`,
    {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(sessionPayload)
    }
  )

  if (!sessionRes.ok) {
    const errText = await sessionRes.text()
    console.error('Session create failed:', errText)
    throw createError({
      statusCode: 500,
      statusMessage: `Failed to create workout session: ${errText}`
    })
  }

  // 2. Write Distance dataset
  if (distanceMeters > 0) {
    try {
      const distanceStreamId = await getOrCreateDataSource(
        token,
        'com.google.distance.delta',
        'treadmill_distance'
      )

      const distanceDataset = {
        dataSourceId: distanceStreamId,
        minStartTimeNs: startTimeNanos.toString(),
        maxEndTimeNs: endTimeNanos.toString(),
        point: [
          {
            dataTypeName: 'com.google.distance.delta',
            startTimeNanos: startTimeNanos.toString(),
            endTimeNanos: endTimeNanos.toString(),
            value: [{ fpVal: distanceMeters }]
          }
        ]
      }

      const patchUrl = `https://www.googleapis.com/fitness/v1/users/me/dataSources/${encodeURIComponent(
        distanceStreamId
      )}/datasets/${startTimeNanos}-${endTimeNanos}`

      await fetch(patchUrl, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(distanceDataset)
      })
    } catch (err) {
      console.warn('Could not insert distance dataset:', err)
    }
  }

  // 3. Write Calories dataset
  if (calories > 0) {
    try {
      const caloriesStreamId = await getOrCreateDataSource(
        token,
        'com.google.calories.expended',
        'treadmill_calories'
      )

      const caloriesDataset = {
        dataSourceId: caloriesStreamId,
        minStartTimeNs: startTimeNanos.toString(),
        maxEndTimeNs: endTimeNanos.toString(),
        point: [
          {
            dataTypeName: 'com.google.calories.expended',
            startTimeNanos: startTimeNanos.toString(),
            endTimeNanos: endTimeNanos.toString(),
            value: [{ fpVal: calories }]
          }
        ]
      }

      const patchUrl = `https://www.googleapis.com/fitness/v1/users/me/dataSources/${encodeURIComponent(
        caloriesStreamId
      )}/datasets/${startTimeNanos}-${endTimeNanos}`

      await fetch(patchUrl, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(caloriesDataset)
      })
    } catch (err) {
      console.warn('Could not insert calories dataset:', err)
    }
  }

  return {
    success: true,
    sessionId,
    startTimeMillis,
    endTimeMillis,
    distanceKm: distanceMeters / 1000,
    calories
  }
})
