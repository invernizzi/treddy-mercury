import { setActivePinia, createPinia } from 'pinia'
import { describe, it, expect, beforeEach } from 'vitest'
import { useBleStore } from '../app/stores/ble'

describe('BleStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('initializes with empty history', () => {
    const store = useBleStore()
    expect(store.history).toEqual([])
  })

  it('adds an entry to history when speed is > 0.1 during updateRealtimeMetrics', () => {
    const store = useBleStore()
    
    store.speedKph = 5.0
    store.inclineDeg = 0.0
    store.lastMetricUpdateTime = Date.now() - 2000 // 2 seconds ago
    
    store.updateRealtimeMetrics()
    store.addHistoryPoint()
    
    expect(store.history.length).toBe(1)
    expect(store.history[0].speed).toBe(5.0)
    // timeMs should be roughly 2000 ms
    expect(store.history[0].t).toBe(2)
    expect(store.workoutSeconds).toBe(2)
  })
})
