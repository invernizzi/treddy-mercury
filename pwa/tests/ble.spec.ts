import { setActivePinia, createPinia } from 'pinia'
import { describe, it, expect, beforeEach } from 'vitest'
import { useBleStore, buildControlPackets, hexStringToBytes } from '../app/stores/ble'

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
    // time should be roughly 2 seconds
    expect(store.history[0].t).toBe(2)
    expect(Math.round(store.workoutSeconds)).toBe(2)
  })

  describe('IF BLE Protocol Commands', () => {
    it('generates exact speed command packets matching IF captures', () => {
      // 1.0 MPH = 1.60 KPH -> speedParam 160 (0x00a0)
      const p10 = buildControlPackets(0x01, 160)
      expect(p10.header).toBe('fe020d02')
      expect(p10.payload).toBe('ff0d020402090409020101a00000000000000000')

      // 1.1 MPH = 1.77 KPH -> speedParam 177 (0x00b1)
      const p11 = buildControlPackets(0x01, 177)
      expect(p11.payload).toBe('ff0d020402090409020101b10000000000000000')

      // 1.2 MPH = 1.93 KPH -> speedParam 193 (0x00c1)
      const p12 = buildControlPackets(0x01, 193)
      expect(p12.payload).toBe('ff0d020402090409020101c10000000000000000')

      // 1.3 MPH = 2.09 KPH -> speedParam 209 (0x00d1)
      const p13 = buildControlPackets(0x01, 209)
      expect(p13.payload).toBe('ff0d020402090409020101d10000000000000000')
    })

    it('generates exact incline command packets matching IF captures', () => {
      // Incline 0.5% -> 50 (0x0032)
      const inc05 = buildControlPackets(0x02, 50)
      expect(inc05.header).toBe('fe020d02')
      expect(inc05.payload).toBe('ff0d020402090409020102320000000000000000')

      // Incline 1.0% -> 100 (0x0064)
      const inc10 = buildControlPackets(0x02, 100)
      expect(inc10.payload).toBe('ff0d020402090409020102640000000000000000')

      // Incline 2.5% -> 250 (0x00fa)
      const inc25 = buildControlPackets(0x02, 250)
      expect(inc25.payload).toBe('ff0d020402090409020102fa0000000000000000')

      // Incline 3.0% -> 300 (0x012c)
      const inc30 = buildControlPackets(0x02, 300)
      expect(inc30.payload).toBe('ff0d0204020904090201022c0100000000000000')
    })

    it('hexStringToBytes converts hex strings to byte arrays correctly', () => {
      const bytes = hexStringToBytes('fe020d02')
      expect(Array.from(bytes)).toEqual([0xfe, 0x02, 0x0d, 0x02])
    })
  })

  describe('IF Guidance & Modal Controls', () => {
    it('opens and closes guide modal with requested step', () => {
      const store = useBleStore()
      expect(store.showGuideModal).toBe(false)

      store.openGuide(2)
      expect(store.showGuideModal).toBe(true)
      expect(store.guidanceStep).toBe(2)

      store.closeGuide()
      expect(store.showGuideModal).toBe(false)
    })

    it('opens and closes disconnect modal', () => {
      const store = useBleStore()
      expect(store.showDisconnectModal).toBe(false)

      store.openDisconnectModal()
      expect(store.showDisconnectModal).toBe(true)

      store.closeDisconnectModal()
      expect(store.showDisconnectModal).toBe(false)
    })
  })
})
