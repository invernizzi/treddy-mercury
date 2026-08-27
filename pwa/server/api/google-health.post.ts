import { defineEventHandler, readBody, createError } from 'h3'
import {
  getSessionCookie,
  getValidAccessToken,
  writeActiveEnergyBurned
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
  const activeDurationSeconds = Math.max(1, Math.round((endTimeMillis - startTimeMillis) / 1000))

  const payload = {
    dataSource: {
      recordingMethod: 'ACTIVELY_MEASURED'
    },
    exercise: {
      interval: {
        startTime: new Date(startTimeMillis).toISOString(),
        startUtcOffset: '0s',
        endTime: new Date(endTimeMillis).toISOString(),
        endUtcOffset: '0s'
      },
      exerciseType: 'TREADMILL',
      displayName: 'Treadmill Run',
      activeDuration: `${activeDurationSeconds}s`,
      exerciseMetadata: {
        hasGps: false
      },
      metricsSummary: {
        caloriesKcal: calories,
        distanceMillimeters: distanceMeters * 1000,
        averageSpeedMillimetersPerSecond: (distanceMeters * 1000) / activeDurationSeconds
      }
    }
  }

  const res = await fetch('https://health.googleapis.com/v4/users/me/dataTypes/exercise/dataPoints', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json'
    },
    body: JSON.stringify(payload)
  })

  if (!res.ok) {
    const errText = await res.text()
    console.error('Google Health exercise write failed:', errText)
    throw createError({
      statusCode: 500,
      statusMessage: `Failed to write workout to Google Health: ${errText}`
    })
  }

  if (calories > 0) {
    try {
      await writeActiveEnergyBurned(token, startTimeMillis, endTimeMillis, calories)
    } catch (err) {
      console.warn('Could not write active-energy-burned data point:', err)
    }
  }

  return {
    success: true,
    startTimeMillis,
    endTimeMillis,
    distanceKm: distanceMeters / 1000,
    calories
  }
})
