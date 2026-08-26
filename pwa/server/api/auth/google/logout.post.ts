import { defineEventHandler, deleteCookie } from 'h3'
import { clearSessionCookie } from '../../../utils/google'

export default defineEventHandler((event) => {
  clearSessionCookie(event)
  deleteCookie(event, 'google_health_connected', { path: '/' })
  return { success: true }
})
