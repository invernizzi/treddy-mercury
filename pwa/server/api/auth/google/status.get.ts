import { defineEventHandler, deleteCookie } from 'h3'
import { getSessionCookie, clearSessionCookie } from '../../../utils/google'

export default defineEventHandler((event) => {
  const session = getSessionCookie(event)
  const isConnected = !!(session && (session.access_token || session.refresh_token))

  if (!isConnected) {
    deleteCookie(event, 'google_health_connected', { path: '/' })
  }

  return {
    connected: isConnected
  }
})
