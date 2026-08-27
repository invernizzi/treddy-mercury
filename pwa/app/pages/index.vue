<template>
  <div class="dashboard-container">
    <header>
      <h1>Treddy Mercury</h1>
      <div class="status-indicator" :class="{ connected: bleStore.connected }">
        {{ bleStore.status }}
      </div>

      <!-- Google Health Connection Status -->
      <div class="auth-bar">
        <span v-if="googleConnected" class="badge-connected">
          ✓ Google Health Connected
          <button @click="logoutGoogle" class="link-btn">(Disconnect)</button>
        </span>
        <button v-else @click="loginGoogle" class="google-btn">
          <svg class="google-icon" viewBox="0 0 24 24" width="16" height="16">
            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
            <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"/>
            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"/>
          </svg>
          Connect Google Health
        </button>
      </div>

      <!-- Prominent "Workout Synced!" Success Card -->
      <transition name="fade">
        <div v-if="syncedWorkout" class="sync-success-card">
          <div class="sync-success-header">
            <span class="check-circle">✓</span>
            <div class="sync-title-group">
              <div class="sync-main-title">Workout Synced to Google Health!</div>
              <div class="sync-sub-details">
                <strong>{{ syncedWorkout.distanceKm.toFixed(2) }} km</strong> &middot;
                <strong>{{ syncedWorkout.calories }} kcal</strong> &middot;
                <span>{{ syncedWorkout.timeStr }}</span>
              </div>
            </div>
            <button @click="syncedWorkout = null" class="close-card-btn" title="Dismiss">&times;</button>
          </div>
        </div>
      </transition>

      <!-- Transient Error / Info Banner -->
      <div v-if="syncMessage" class="sync-banner" :class="{ error: syncError }">
        {{ syncMessage }}
      </div>
    </header>

    <div class="main-grid">
      <div class="card metric-card">
        <div class="label">SPEED</div>
        <div class="value accent">{{ bleStore.speedKph.toFixed(1) }}</div>
        <div class="unit">km/h</div>
      </div>

      <div class="card metric-card">
        <div class="label">INCLINE</div>
        <div class="value">{{ bleStore.inclineDeg.toFixed(1) }}</div>
        <div class="unit">%</div>
      </div>

      <div class="card metric-card">
        <div class="label">DISTANCE</div>
        <div class="value">{{ bleStore.distanceKm.toFixed(3) }}</div>
        <div class="unit">km</div>
      </div>

      <div class="card metric-card">
        <div class="label">TIME</div>
        <div class="value highlight">{{ bleStore.timeStr }}</div>
      </div>

      <div class="card metric-card full-width">
        <div class="label">CALORIES</div>
        <div class="value">{{ bleStore.calories }}</div>
        <div class="unit">kcal</div>
      </div>
    </div>

    <div class="controls">
      <template v-if="!bleStore.connected">
        <button @click="bleStore.connect()">
          Connect to Treadmill
        </button>
        <button @click="bleStore.startDemo()" class="secondary" style="margin-left: 10px;">
          Start Demo
        </button>
        <button 
          v-if="bleStore.distanceKm > 0 || bleStore.workoutSeconds > 0"
          @click="syncWorkout" 
          :disabled="isSyncing"
          class="sync-btn"
          style="margin-left: 10px;"
        >
          {{ isSyncing ? 'Syncing...' : 'Sync Previous Workout' }}
        </button>
      </template>
      <template v-else>
        <button 
          @click="endAndSync" 
          :disabled="isSyncing"
          class="sync-btn"
        >
          {{ isSyncing ? 'Syncing...' : 'End & Sync Workout' }}
        </button>
        <button @click="bleStore.disconnect()" class="danger" style="margin-left: 10px;">
          Disconnect
        </button>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useBleStore } from '~/stores/ble'

interface SyncedSummary {
  distanceKm: number
  calories: number
  timeStr: string
}

const bleStore = useBleStore()
const googleConnected = ref(false)
const isSyncing = ref(false)
const syncMessage = ref('')
const syncError = ref(false)
const syncedWorkout = ref<SyncedSummary | null>(null)

onMounted(async () => {
  // Check URL query parameters for OAuth callbacks
  const url = new URL(window.location.href)
  if (url.searchParams.get('auth_success') === 'google') {
    syncMessage.value = '✓ Successfully connected to Google Health!'
    syncError.value = false
    window.history.replaceState({}, document.title, window.location.pathname)
  } else if (url.searchParams.get('auth_error')) {
    syncMessage.value = `Auth Error: ${url.searchParams.get('auth_error')}`
    syncError.value = true
    window.history.replaceState({}, document.title, window.location.pathname)
  }

  await checkGoogleStatus()
  await bleStore.autoReconnect()
})

async function checkGoogleStatus() {
  try {
    const data = await $fetch<{ connected: boolean }>('/api/auth/google/status')
    googleConnected.value = data.connected
  } catch (e) {
    googleConnected.value = false
  }
}

function loginGoogle() {
  window.location.href = '/api/auth/google/login'
}

async function logoutGoogle() {
  try {
    await $fetch('/api/auth/google/logout', { method: 'POST' })
    googleConnected.value = false
    syncMessage.value = 'Disconnected from Google Health'
    syncError.value = false
    syncedWorkout.value = null
  } catch (e) {
    console.error('Logout error', e)
  }
}

async function syncWorkout() {
  if (!googleConnected.value) {
    syncMessage.value = 'Please connect Google Health first'
    syncError.value = true
    return
  }

  isSyncing.value = true
  syncMessage.value = 'Syncing workout to Google Health...'
  syncError.value = false

  try {
    const durationMillis = Math.max(1000, bleStore.workoutSeconds * 1000)
    const endTimeMillis = Date.now()
    const startTimeMillis = endTimeMillis - durationMillis
    const currentTimeStr = bleStore.timeStr

    const res = await $fetch<{ success: boolean; distanceKm: number; calories: number }>(
      '/api/google-health',
      {
        method: 'POST',
        body: {
          durationMillis,
          startTimeMillis,
          endTimeMillis,
          distanceKm: bleStore.distanceKm,
          calories: bleStore.calories
        }
      }
    )

    // Set prominent synced workout card
    syncedWorkout.value = {
      distanceKm: res.distanceKm,
      calories: res.calories,
      timeStr: currentTimeStr || `${Math.floor(bleStore.workoutSeconds / 60)}m ${Math.floor(bleStore.workoutSeconds % 60)}s`
    }

    syncMessage.value = ''
    syncError.value = false
  } catch (err: any) {
    syncError.value = true
    syncMessage.value = `Sync failed: ${err.data?.statusMessage || err.message || 'Unknown error'}`
  } finally {
    isSyncing.value = false
  }
}

async function endAndSync() {
  await syncWorkout()
  bleStore.disconnect()
}
</script>

<style scoped>
.dashboard-container {
  display: flex;
  flex-direction: column;
  height: 100vh;
  padding: 20px;
  max-width: 800px;
  margin: 0 auto;
}

header {
  text-align: center;
  margin-bottom: 1.5rem;
}

.status-indicator {
  font-size: 0.8rem;
  color: #666;
  margin-top: 0.25rem;
}

.status-indicator.connected {
  color: var(--color-primary);
}

.auth-bar {
  margin-top: 0.75rem;
  display: flex;
  justify-content: center;
  align-items: center;
}

.badge-connected {
  font-size: 0.85rem;
  color: #34A853;
  background: rgba(52, 168, 83, 0.1);
  padding: 4px 12px;
  border-radius: 16px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.link-btn {
  background: none;
  border: none;
  color: #888;
  padding: 0;
  font-size: 0.75rem;
  cursor: pointer;
  text-decoration: underline;
}

.google-btn {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  background: #ffffff;
  color: #3c4043;
  border: 1px solid #dadce0;
  padding: 6px 14px;
  font-size: 0.85rem;
  border-radius: 4px;
  font-weight: 500;
  cursor: pointer;
  transition: background-color 0.2s;
}

.google-btn:hover {
  background: #f8f9fa;
}

/* Prominent "Workout Synced!" Card */
.sync-success-card {
  margin-top: 1rem;
  background: linear-gradient(135deg, rgba(52, 168, 83, 0.2), rgba(66, 133, 244, 0.15));
  border: 2px solid #34A853;
  border-radius: 10px;
  padding: 12px 16px;
  box-shadow: 0 4px 12px rgba(52, 168, 83, 0.2);
}

.sync-success-header {
  display: flex;
  align-items: center;
  gap: 12px;
  text-align: left;
}

.check-circle {
  background: #34A853;
  color: #ffffff;
  font-size: 1.2rem;
  font-weight: bold;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.sync-title-group {
  flex: 1;
}

.sync-main-title {
  font-size: 1.1rem;
  font-weight: bold;
  color: #ffffff;
}

.sync-sub-details {
  font-size: 0.9rem;
  color: #c8e6c9;
  margin-top: 2px;
}

.close-card-btn {
  background: none;
  border: none;
  color: #aaa;
  font-size: 1.5rem;
  cursor: pointer;
  padding: 0 6px;
  line-height: 1;
}

.close-card-btn:hover {
  color: #fff;
}

.sync-banner {
  margin-top: 0.75rem;
  padding: 8px 12px;
  background: rgba(52, 168, 83, 0.15);
  color: #34A853;
  border-radius: 6px;
  font-size: 0.85rem;
}

.sync-banner.error {
  background: rgba(234, 67, 53, 0.15);
  color: #EA4335;
}

.main-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 20px;
  flex: 1;
}

.metric-card {
  border: 1px solid var(--color-secondary);
  background: rgba(255, 255, 255, 0.05);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 20px;
  border-radius: 8px;
}

.metric-card.full-width {
  grid-column: span 2;
}

.label {
  font-size: 0.9rem;
  color: #888;
  margin-bottom: 0.5rem;
}

.value {
  font-size: 3rem;
  font-weight: bold;
}

.unit {
  font-size: 1rem;
  color: #666;
}

.accent {
  color: var(--color-primary);
}

.highlight {
  color: #fff;
}

.controls {
  margin-top: 1.5rem;
  display: flex;
  justify-content: center;
  padding-bottom: 1.5rem;
}

button.secondary {
  background: transparent;
  border: 1px solid #666;
  color: #ccc;
}

button.sync-btn {
  background: #4285F4;
  color: white;
  border: none;
  font-weight: bold;
}

button.sync-btn:hover {
  background: #3367D6;
}

button.danger {
  border-color: #ff4444;
  color: #ff4444;
}

button.danger:hover {
  background: #ff4444;
  color: white;
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.3s ease, transform 0.3s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
  transform: translateY(-8px);
}
</style>
