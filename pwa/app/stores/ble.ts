import { defineStore } from 'pinia'
import { calculateCalories } from '~/utils/calories'

// UUIDs
const WRITE_UUID = "00001534-1412-efde-1523-785feabcd123"
const NOTIFY_UUID = "00001535-1412-efde-1523-785feabcd123"

const INITIALIZATION_SEQUENCE = [
  "fe022c04",
  "0012020402280428900701cec4b0aaa2a8949696",
  "0112aca8a2bad0dccefe14003a52786486a6fc18",
  "ff08324aa0880200004400000000000000000000",
]

const POLL_SEQUENCE = [
  "fe021403",
  "001202040210041002000a1b9430000040500080",
  "ff02182700000000000000000000000000000000",
]

function hexStringToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16)
  }
  return bytes
}

interface BleState {
  device: any | null
  server: any | null
  writeChar: any | null
  connected: boolean
  status: string
  
  // Metrics
  speedKph: number
  inclineDeg: number
  distanceKm: number
  calories: number
  timeStr: string
  
  // Internal tracking
  accumulatedCalories: number
  startTime: number
  lastMetricUpdateTime: number
  pollInterval: any
  demoInterval: any
}

export const useBleStore = defineStore('ble', {
  state: (): BleState => ({
    device: null,
    server: null,
    writeChar: null,
    connected: false,
    status: 'Disconnected',
    
    speedKph: 0.0,
    inclineDeg: 0.0,
    distanceKm: 0.0,
    calories: 0,
    timeStr: '00:00',
    
    accumulatedCalories: 0.0,
    startTime: 0,
    lastMetricUpdateTime: 0,
    pollInterval: null,
    demoInterval: null
  }),

  actions: {
    startDemo() {
        if (this.connected) return
        this.connected = true
        this.status = 'Demo Mode'
        this.startTime = Date.now()
        this.lastMetricUpdateTime = Date.now()
        
        let demoSpeed = 5.0
        let demoIncline = 0.0
        let demoDistance = 0.0
        
        this.demoInterval = setInterval(() => {
            // Simulate changing data
            demoSpeed = 8.0 + Math.sin(Date.now() / 5000) * 1.0
            demoIncline = 2.0 + Math.sin(Date.now() / 10000) * 1.0
            
            // Integrate distance
            const dt = 1.0 
            demoDistance += (demoSpeed / 3600.0) * dt
            
            this.speedKph = demoSpeed
            this.inclineDeg = demoIncline
            this.distanceKm = demoDistance
            
            this.updateRealtimeMetrics()
        }, 1000)
    },

    async connect() {
      if (!import.meta.client) return

      try {
        this.status = 'Requesting Device...'
        
        // @ts-ignore
        const device = await navigator.bluetooth.requestDevice({
          acceptAllDevices: true,
          optionalServices: [
             "00001533-1412-efde-1523-785feabcd123" 
          ]
        })

        this.device = device
        this.status = 'Connecting to Server...'
        
        device.addEventListener('gattserverdisconnected', this.onDisconnected)
        
        const server = await device.gatt?.connect()
        if (!server) throw new Error('Could not connect to GATT Server')
        this.server = server

        this.status = 'Getting Service...'
        const service = await server.getPrimaryService("00001533-1412-efde-1523-785feabcd123")
        
        this.status = 'Getting Characteristics...'
        const writeChar = await service.getCharacteristic(WRITE_UUID)
        const notifyChar = await service.getCharacteristic(NOTIFY_UUID)

        this.writeChar = writeChar
        
        await notifyChar.startNotifications()
        notifyChar.addEventListener('characteristicvaluechanged', (event: any) => {
          const value = event.target.value
          if (value) this.handleNotification(value)
        })

        this.connected = true
        this.status = 'Initializing...'
        
        for (const hex of INITIALIZATION_SEQUENCE) {
          await writeChar.writeValue(hexStringToBytes(hex))
          await new Promise(r => setTimeout(r, 100))
        }

        this.status = 'Running'
        this.startTime = Date.now()
        this.lastMetricUpdateTime = Date.now()

        this.pollInterval = setInterval(async () => {
           if (!this.connected || !this.writeChar) return
           try {
             for (const hex of POLL_SEQUENCE) {
               await this.writeChar.writeValue(hexStringToBytes(hex))
             }
             this.updateRealtimeMetrics()
           } catch (e) {
             console.error("Poll error", e)
           }
        }, 1000)

      } catch (e) {
        console.error(e)
        this.status = `Error: ${e}`
        this.connected = false
      }
    },

    disconnect() {
      if (this.device && this.device.gatt?.connected) {
        this.device.gatt.disconnect()
      }
      this.onDisconnected()
    },

    onDisconnected() {
      this.connected = false
      this.status = 'Disconnected'
      this.server = null
      this.writeChar = null
      if (this.pollInterval) clearInterval(this.pollInterval)
      if (this.demoInterval) clearInterval(this.demoInterval)
    },

    handleNotification(data: DataView) {
      if (data.byteLength < 12) return

      const firstByte = data.getUint8(0)
      
      if (firstByte === 0x00) {
        const speed = data.getUint16(10, true) / 100.0
        const incline = data.getUint16(12, true) / 100.0
        const distance = data.getUint16(16, true) / 1000.0
        
        this.speedKph = speed
        this.inclineDeg = incline
        this.distanceKm = distance
      }
    },

    updateRealtimeMetrics() {
        const now = Date.now()
        const dt = (now - this.lastMetricUpdateTime) / 1000
        this.lastMetricUpdateTime = now
        
        if (dt <= 0) return

        const userWeight = 86.0 

        if (this.speedKph > 0.1) {
            const cal = calculateCalories(userWeight, this.speedKph, this.inclineDeg, dt)
            this.accumulatedCalories += cal
            this.calories = Math.floor(this.accumulatedCalories)
        }
        
        const totalHelpers = Math.floor((now - this.startTime) / 1000)
        const m = Math.floor(totalHelpers / 60)
        const s = totalHelpers % 60
        const h = Math.floor(m / 60)
        
        if (h > 0) {
            this.timeStr = `${h}:${(m%60).toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
        } else {
            this.timeStr = `${m}:${s.toString().padStart(2, '0')}`
        }
    }
  }
})
