import { setActivePinia, createPinia } from 'pinia'
import { describe, it, expect, beforeEach } from 'vitest'
import { useBleStore, buildControlPackets, buildNusPacket, hexStringToBytes } from '../app/stores/ble'

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

  describe('NUS Protocol Packets', () => {
    it('generates valid NUS handshake and control packets with correct checksum', () => {
      // Handshake 0x10 -> [0xA5, 0x04, 0x10, 0xB9]
      const hs = buildNusPacket(0x10)
      expect(Array.from(hs)).toEqual([0xA5, 0x04, 0x10, 0xB9])

      // Request Control 0x15 -> [0xA5, 0x04, 0x15, 0xBE]
      const reqCtrl = buildNusPacket(0x15)
      expect(Array.from(reqCtrl)).toEqual([0xA5, 0x04, 0x15, 0xBE])

      // Start Belt 0x11 with payload [0x01] -> [0xA5, 0x05, 0x11, 0x01, 0xBC]
      const startBelt = buildNusPacket(0x11, [0x01])
      expect(Array.from(startBelt)).toEqual([0xA5, 0x05, 0x11, 0x01, 0xBC])

      // Keepalive Watchdog Ping 0x30 with payload [0x00] -> [0xA5, 0x05, 0x30, 0x00, 0xDA]
      const keepalive = buildNusPacket(0x30, [0x00])
      expect(Array.from(keepalive)).toEqual([0xA5, 0x05, 0x30, 0x00, 0xDA])

      // Speed 0x20 with 1.00 mph (100 = 0x0064) -> [0xA5, 0x06, 0x20, 0x64, 0x00, 0x2F]
      const speedPkt = buildNusPacket(0x20, [0x64, 0x00])
      expect(Array.from(speedPkt)).toEqual([0xA5, 0x06, 0x20, 0x64, 0x00, 0x2F])

      // Incline 0x21 with 2.0% (20 = 0x0014) -> [0xA5, 0x06, 0x21, 0x14, 0x00, 0xE0]
      const incPkt = buildNusPacket(0x21, [0x14, 0x00])
      expect(Array.from(incPkt)).toEqual([0xA5, 0x06, 0x21, 0x14, 0x00, 0xE0])
    })

    it('parses NUS telemetry notification correctly in metric mode', () => {
      const store = useBleStore()
      const buffer = new ArrayBuffer(16)
      const view = new DataView(buffer)

      view.setUint8(0, 0x02) // NUS notification header
      view.setUint8(1, 0x10) // length 16
      view.setUint8(2, 0x80) // telemetry opcode
      view.setUint16(3, 300, true) // speed = 3.00 km/h (raw 300)
      view.setInt16(5, 45, true) // incline = 4.5% (raw 45)
      // distance = 250 meters
      view.setUint8(7, 250 & 0xFF)
      view.setUint8(8, 0)
      view.setUint8(9, 0)
      view.setUint8(13, 0x20) // metric flag enabled

      store.handleNotification(view)

      expect(store.speedKph).toBeCloseTo(3.00, 2)
      expect(store.inclineDeg).toBeCloseTo(4.5, 1)
      expect(store.distanceKm).toBeCloseTo(0.25, 3)
    })

    it('parses NUS telemetry notification correctly in imperial mode', () => {
      const store = useBleStore()
      const buffer = new ArrayBuffer(16)
      const view = new DataView(buffer)

      view.setUint8(0, 0x02)
      view.setUint8(1, 0x10)
      view.setUint8(2, 0x80)
      view.setUint16(3, 200, true) // 2.00 mph = 3.218688 km/h
      view.setInt16(5, 15, true) // 1.5%
      // distance = 1000 meters
      view.setUint8(7, 0xE8)
      view.setUint8(8, 0x03)
      view.setUint8(9, 0x00)
      view.setUint8(13, 0x00) // imperial flag

      store.handleNotification(view)

      expect(store.speedKph).toBeCloseTo(3.218688, 2)
      expect(store.inclineDeg).toBeCloseTo(1.5, 1)
      expect(store.distanceKm).toBeCloseTo(1.0, 3)
    })
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
