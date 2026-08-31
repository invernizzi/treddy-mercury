import { defineEventHandler, readBody, createError } from 'h3'
import {
  getSessionCookie,
  getValidAccessToken,
  writeActiveEnergyBurned,
  clearSessionCookie,
  GOOGLE_HEALTH_SCOPE
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

  // Sessions granted before the switch to the Google Health API lack this scope and will
  // always be rejected with DISALLOWED_OAUTH_SCOPES - force a fresh consent instead.
  if (!session.scope?.includes(GOOGLE_HEALTH_SCOPE)) {
    clearSessionCookie(event)
    throw createError({
      statusCode: 401,
      statusMessage: 'Google session is missing the required Health scope. Please reconnect your Google account.'
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

  // 4. Write Speed dataset (Average speed)
  const durationSeconds = (endTimeMillis - startTimeMillis) / 1000
  if (distanceMeters > 0 && durationSeconds > 0) {
    try {
      const speedStreamId = await getOrCreateDataSource(
        token,
        'com.google.speed',
        'treadmill_speed'
      )

      let speedPoints = []
      const speedHistory = body.history || []
      
      if (speedHistory.length > 0) {
        let lastTimeMs = startTimeMillis
        for (const record of speedHistory) {
          const pointStartNanos = BigInt(lastTimeMs) * BigInt(1000000)
          const pointEndMs = startTimeMillis + record.t * 1000
          const pointEndNanos = BigInt(pointEndMs) * BigInt(1000000)
          
          if (pointEndNanos > pointStartNanos) {
            speedPoints.push({
              dataTypeName: 'com.google.speed',
              startTimeNanos: pointStartNanos.toString(),
              endTimeNanos: pointEndNanos.toString(),
              value: [{ fpVal: record.speed / 3.6 }] // kph to m/s
            })
          }
          lastTimeMs = pointEndMs
        }
      } else {
        // Fallback to average speed
        const avgSpeedMs = distanceMeters / durationSeconds
        speedPoints.push({
          dataTypeName: 'com.google.speed',
          startTimeNanos: startTimeNanos.toString(),
          endTimeNanos: endTimeNanos.toString(),
          value: [{ fpVal: avgSpeedMs }]
        })
      }

      const speedDataset = {
        dataSourceId: speedStreamId,
        minStartTimeNs: startTimeNanos.toString(),
        maxEndTimeNs: endTimeNanos.toString(),
        point: speedPoints
      }

      const patchUrl = `https://www.googleapis.com/fitness/v1/users/me/dataSources/${encodeURIComponent(
        speedStreamId
      )}/datasets/${startTimeNanos}-${endTimeNanos}`

      await fetch(patchUrl, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(speedDataset)
      })
    } catch (err) {
      console.warn('Could not insert speed dataset:', err)
    }

    // 5. Write Steps dataset
    try {
      const stepsStreamId = await getOrCreateDataSource(
        token,
        'com.google.step_count.delta',
        'treadmill_steps'
      )

      // Estimate steps based on distance (approx 0.78m per step)
      const estimatedSteps = Math.floor(distanceMeters / 0.78)
      const stepsDataset = {
        dataSourceId: stepsStreamId,
        minStartTimeNs: startTimeNanos.toString(),
        maxEndTimeNs: endTimeNanos.toString(),
        point: [
          {
            dataTypeName: 'com.google.step_count.delta',
            startTimeNanos: startTimeNanos.toString(),
            endTimeNanos: endTimeNanos.toString(),
            value: [{ intVal: estimatedSteps }]
          }
        ]
      }

      const patchUrl = `https://www.googleapis.com/fitness/v1/users/me/dataSources/${encodeURIComponent(
        stepsStreamId
      )}/datasets/${startTimeNanos}-${endTimeNanos}`

      await fetch(patchUrl, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(stepsDataset)
      })
    } catch (err) {
      console.warn('Could not insert steps dataset:', err)
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
