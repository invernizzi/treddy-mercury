<template>
  <div class="dashboard-container">
    <header>
      <h1>Dino Run</h1>
      <div class="status-indicator" :class="{ connected: bleStore.connected }">
        {{ bleStore.status }}
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

    <!-- Isometric track is the centerpiece; metrics flank it on both sides -->
    <div class="viz-row">
      <div class="side-column">
        <div class="card metric-card interactive-metric">
          <div class="label">SPEED</div>
          <div class="controls-row">
            <button @click="bleStore.setSpeed(Math.max(0, bleStore.speedKph - 0.5))" :disabled="!bleStore.connected" class="ctrl-btn">-</button>
            <div class="value accent">{{ bleStore.speedKph.toFixed(1) }}</div>
            <button @click="bleStore.setSpeed(bleStore.speedKph === 0 ? 1.0 : Math.min(22, bleStore.speedKph + 0.5))" :disabled="!bleStore.connected" class="ctrl-btn">+</button>
          </div>
          <div class="unit">km/h</div>
        </div>

        <div class="card metric-card interactive-metric">
          <div class="label">INCLINE</div>
          <div class="controls-row">
            <button @click="bleStore.setIncline(Math.max(0, bleStore.inclineDeg - 0.5))" :disabled="!bleStore.connected" class="ctrl-btn">-</button>
            <div class="value">{{ bleStore.inclineDeg.toFixed(1) }}</div>
            <button @click="bleStore.setIncline(Math.min(20, bleStore.inclineDeg + 0.5))" :disabled="!bleStore.connected" class="ctrl-btn">+</button>
          </div>
          <div class="unit">%</div>
        </div>

        <div class="card metric-card">
          <div class="label">CALORIES</div>
          <div class="value">{{ bleStore.calories }}</div>
          <div class="unit">kcal</div>
        </div>
      </div>

      <div class="track-container">
        <WorkoutChart v-if="bleStore.history.length > 0" :history="bleStore.history" />
        <div v-else class="track-placeholder">Track appears once your workout starts</div>
      </div>

      <div class="side-column">
        <div class="card metric-card">
          <div class="label">DISTANCE</div>
          <div class="value">{{ bleStore.distanceKm.toFixed(3) }}</div>
          <div class="unit">km</div>
        </div>

        <div class="card metric-card">
          <div class="label">TIME</div>
          <div class="value highlight">{{ bleStore.timeStr }}</div>
        </div>

        <div class="card google-card" :class="{ connected: googleConnected }">
          <div class="label">GOOGLE HEALTH</div>
          <span v-if="googleConnected" class="badge-connected">
            ✓ Connected
            <button @click="logoutGoogle" class="link-btn">(Disconnect)</button>
          </span>
          <button v-else @click="loginGoogle" class="google-btn">
            <svg class="google-icon" viewBox="0 0 24 24" width="16" height="16">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"/>
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"/>
            </svg>
            Connect
          </button>
        </div>
      </div>
    </div>

    <div class="controls">
      <!-- Treadmill NOT Connected -->
      <template v-if="!bleStore.connected">
        <button @click="bleStore.connect()" :disabled="googleConnected === null || bleStore.status !== 'Disconnected'" class="connect-btn">
          <span v-if="bleStore.status !== 'Disconnected'" class="spinner"></span>
          {{ bleStore.status === 'Disconnected' ? 'Connect Treadmill' : bleStore.status }}
        </button>
        <button @click="bleStore.startDemo()" class="secondary" >
          Start Demo
        </button>
        <button 
          v-if="bleStore.distanceKm > 0 || bleStore.workoutSeconds > 0"
          @click="syncWorkout" 
          :disabled="isSyncing"
          class="sync-btn"
          
        >
          {{ isSyncing ? 'Syncing...' : 'Sync Previous Workout' }}
        </button>
      </template>
      <template v-else>
        <button 
          @click="syncWorkout" 
          :disabled="isSyncing"
          class="sync-btn"
        >
          {{ isSyncing ? 'Syncing...' : 'Sync Workout (Live)' }}
        </button>
        <button @click="bleStore.disconnect()" class="danger" >
          Disconnect
        </button>
      </template>
    </div>

    <!-- BLE Debug Logs Drawer -->
    <div class="debug-drawer">
      <div class="debug-header" @click="showLogs = !showLogs">
        <span class="debug-title">
          <span class="debug-dot" :class="{ active: bleStore.connected }"></span>
          BLE Protocol Logs ({{ bleStore.logs.length }})
        </span>
        <div class="debug-header-right">
          <span class="debug-hint">{{ showLogs ? 'Click to minimize' : 'Click to inspect Bluetooth packets' }}</span>
          <button class="toggle-btn">{{ showLogs ? '▲ Hide' : '▼ Show Logs' }}</button>
        </div>
      </div>
      <div v-if="showLogs" class="debug-content">
        <div class="debug-toolbar">
          <button @click="copyLogs" class="debug-btn">
            {{ copySuccess ? '✓ Copied to Clipboard!' : '📋 Copy All Logs' }}
          </button>
          <button @click="bleStore.clearLogs()" class="debug-btn secondary">
            Clear Logs
          </button>
        </div>
        <div class="log-console">
          <div v-if="bleStore.logs.length === 0" class="log-empty">
            No Bluetooth logs captured yet. Click "Connect Treadmill" or adjust speed/incline to see packet exchanges.
          </div>
          <div 
            v-for="log in bleStore.logs" 
            :key="log.id" 
            class="log-row"
            :class="log.type"
          >
            <span class="log-time">{{ log.time }}</span>
            <span class="log-type-tag">[{{ log.type.toUpperCase() }}]</span>
            <span class="log-text">{{ log.text }}</span>
          </div>
        </div>
      </div>
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
const showLogs = ref(false)
const copySuccess = ref(false)

async function copyLogs() {
  const text = bleStore.logs
    .map(l => `[${l.time}] [${l.type.toUpperCase()}] ${l.text}`)
    .join('\n')
  try {
    await navigator.clipboard.writeText(text)
    copySuccess.value = true
    setTimeout(() => { copySuccess.value = false }, 2500)
  } catch (e) {
    console.error('Failed to copy logs', e)
  }
}

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
  if (bleStore.status === 'Demo Mode' || bleStore.demoInterval) {
    syncMessage.value = 'Demo data cannot be synced to Google Health'
    syncError.value = true
    return
  }

  if (!googleConnected.value) {
    syncMessage.value = 'Please connect Google Health first'
    syncError.value = true
    return
  }

  isSyncing.value = true
  syncMessage.value = 'Syncing workout to Google Health...'
  syncError.value = false

  try {
    const startTimeMillis = bleStore.startTime > 0 ? bleStore.startTime : (Date.now() - Math.max(1000, bleStore.workoutSeconds * 1000))
    const endTimeMillis = Date.now()
    const durationMillis = endTimeMillis - startTimeMillis
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
          calories: bleStore.calories,
          history: bleStore.history
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
</script>

<style scoped>
.dashboard-container {
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  min-height: 100vh;
  padding: 20px;
  max-width: 1400px;
  margin: 0 auto;
  width: 100%;
}

.dashboard-container * {
  box-sizing: border-box;
}

header {
  text-align: center;
  margin-bottom: 0.75rem;
}

.status-indicator {
  font-size: 0.8rem;
  color: #666;
  margin-top: 0.25rem;
}

.status-indicator.connected {
  color: var(--color-primary);
}

.badge-connected {
  font-size: 0.8rem;
  color: #34A853;
  background: rgba(52, 168, 83, 0.1);
  padding: 6px 10px;
  border-radius: 10px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  text-align: center;
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
  background: transparent;
  color: var(--color-primary);
  border: 1px solid var(--color-primary);
  padding: 8px 16px;
  font-size: 0.85rem;
  font-family: inherit;
  text-transform: uppercase;
  border-radius: 0;
  cursor: pointer;
  transition: all 0.2s;
}

.google-btn:hover {
  background: var(--color-primary);
  color: var(--color-bg);
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

.viz-row {
  display: flex;
  align-items: stretch;
  gap: 20px;
  flex: 1;
  min-height: 0;
}

.side-column {
  display: flex;
  flex-direction: column;
  gap: 14px;
  width: 180px;
  flex-shrink: 0;
}

.track-container {
  flex: 1;
  min-width: 0;
  display: flex;
}

.track-container :deep(.chart-card) {
  flex: 1;
  margin-top: 0;
  display: flex;
  flex-direction: column;
}

.track-container :deep(.chart-wrapper) {
  flex: 1;
  height: auto;
  min-height: 260px;
}

.track-placeholder {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px dashed var(--color-secondary);
  border-radius: 8px;
  color: #666;
  font-size: 0.9rem;
  text-align: center;
  padding: 20px;
}

.metric-card {
  border: 1px solid var(--color-secondary);
  background: rgba(255, 255, 255, 0.05);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 14px 10px;
  border-radius: 8px;
  flex: 1;
}

.google-card {
  border: 1px solid var(--color-secondary);
  background: rgba(255, 255, 255, 0.05);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 14px 10px;
  border-radius: 8px;
  flex: 1;
}

.google-card.connected {
  border-color: #34A853;
}

@media (max-width: 900px) {
  .viz-row {
    flex-direction: column;
    min-height: auto;
  }

  .side-column {
    width: 100%;
    flex-direction: row;
    flex-wrap: wrap;
  }

  .metric-card, .google-card {
    flex: 1 1 45%;
    min-width: 120px;
  }

  .track-container {
    order: -1;
  }
}

.controls-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  gap: 8px;
}

.ctrl-btn {
  background: rgba(255, 255, 255, 0.1);
  border: 1px solid rgba(255, 255, 255, 0.2);
  color: #fff;
  border-radius: 4px;
  width: 32px;
  height: 32px;
  font-size: 1.2rem;
  font-weight: bold;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.2s;
  padding: 0;
}

.ctrl-btn:hover:not(:disabled) {
  background: var(--color-primary);
  border-color: var(--color-primary);
}

.ctrl-btn:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}

.interactive-metric .value {
  font-size: 1.8rem; /* slightly smaller to fit buttons */
}

.label {
  font-size: 0.75rem;
  color: #888;
  margin-bottom: 0.4rem;
  letter-spacing: 0.05em;
}

.value {
  font-size: 2.2rem;
  font-weight: bold;
}

.unit {
  font-size: 0.85rem;
  color: #666;
}

.accent {
  color: var(--color-primary);
}

.highlight {
  color: #fff;
}

.controls {
  margin-top: 0.75rem;
  display: flex;
  justify-content: center;
  gap: 12px;
  flex-wrap: wrap;
  padding-bottom: 0.5rem;
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

.connect-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.spinner {
  display: inline-block;
  width: 14px;
  height: 14px;
  border: 2px solid rgba(255, 255, 255, 0.3);
  border-radius: 50%;
  border-top-color: white;
  animation: spin 1s linear infinite;
  margin-right: 8px;
}

@media (max-width: 600px) {
  .dashboard-container {
    padding: 10px;
  }

  .value {
    font-size: 1.6rem !important;
  }

  .controls button {
    flex: 1 1 100%;
    padding: 12px 14px;
  }

  .controls {
    flex-direction: column;
    gap: 8px;
    width: 100%;
  }
}

@keyframes spin {
  to { transform: rotate(360deg); }
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

/* Debug Drawer */
.debug-drawer {
  margin-top: 1.5rem;
  background: rgba(15, 23, 42, 0.7);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 8px;
  overflow: hidden;
}

.debug-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 14px;
  background: rgba(255, 255, 255, 0.04);
  cursor: pointer;
  user-select: none;
}

.debug-header:hover {
  background: rgba(255, 255, 255, 0.08);
}

.debug-title {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 0.85rem;
  font-weight: 600;
  color: #ccc;
}

.debug-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #666;
}

.debug-dot.active {
  background: #34A853;
  box-shadow: 0 0 6px #34A853;
}

.debug-header-right {
  display: flex;
  align-items: center;
  gap: 10px;
}

.debug-hint {
  font-size: 0.75rem;
  color: #888;
}

.toggle-btn {
  background: transparent;
  border: 1px solid rgba(255, 255, 255, 0.2);
  color: #aaa;
  font-size: 0.75rem;
  padding: 4px 8px;
  border-radius: 4px;
  cursor: pointer;
}

.debug-content {
  padding: 10px 14px 14px;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
}

.debug-toolbar {
  display: flex;
  gap: 8px;
  margin-bottom: 8px;
}

.debug-btn {
  background: rgba(66, 133, 244, 0.2);
  border: 1px solid #4285F4;
  color: #8ab4f8;
  padding: 4px 10px;
  font-size: 0.75rem;
  border-radius: 4px;
  cursor: pointer;
}

.debug-btn:hover {
  background: rgba(66, 133, 244, 0.4);
}

.debug-btn.secondary {
  background: transparent;
  border-color: #666;
  color: #aaa;
}

.debug-btn.secondary:hover {
  background: rgba(255, 255, 255, 0.1);
  color: #fff;
}

.log-console {
  background: #090d16;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 6px;
  max-height: 260px;
  overflow-y: auto;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 0.75rem;
  padding: 8px 10px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.log-empty {
  color: #666;
  font-style: italic;
  padding: 8px;
  text-align: center;
}

.log-row {
  display: flex;
  gap: 8px;
  line-height: 1.4;
  word-break: break-all;
}

.log-row.tx {
  color: #69db7c;
}

.log-row.rx {
  color: #74c0fc;
}

.log-row.error {
  color: #ff8787;
  font-weight: bold;
}

.log-row.info {
  color: #ced4da;
}

.log-time {
  color: #868e96;
  flex-shrink: 0;
}

.log-type-tag {
  flex-shrink: 0;
  font-weight: 600;
}

.log-text {
  flex: 1;
}
</style>
