<template>
  <div class="dashboard-container">
    <header>
      <h1>Treddy Mercury</h1>
      <div class="status-indicator" :class="{ connected: bleStore.connected }">
        {{ bleStore.status }}
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

      <div class="card metric-card">
        <div class="label">CALORIES</div>
        <div class="value">{{ bleStore.calories }}</div>
        <div class="unit">kcal</div>
      </div>
    </div>

    <div class="controls">
      <button v-if="!bleStore.connected" @click="bleStore.connect()">
        Connect to Treadmill
      </button>
      <button v-if="!bleStore.connected" @click="bleStore.startDemo()" style="margin-left: 10px;">
        Start Demo
      </button>
      <button v-else @click="bleStore.disconnect()" class="danger">
        Disconnect
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useBleStore } from '~/stores/ble'

const bleStore = useBleStore()
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
  margin-bottom: 2rem;
}

.status-indicator {
  font-size: 0.8rem;
  color: #666;
  margin-top: 0.5rem;
}

.status-indicator.connected {
  color: var(--color-primary);
}

.main-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 20px;
  flex: 1;
}

/* Make Time span full width on the third row if we have 5 items? 
   Grid flow:
   1. Speed  2. Incline
   3. Dist   4. Time
   5. Cals   
   Let's make Time and Cals span better or just flow.
*/

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
  margin-top: 2rem;
  display: flex;
  justify-content: center;
  padding-bottom: 2rem;
}

button.danger {
  border-color: #ff4444;
  color: #ff4444;
}

button.danger:hover {
  background: #ff4444;
  color: white;
}
</style>
