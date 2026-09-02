import { defineStore } from 'pinia'
import { calculateCalories } from '../utils/calories'

// Service & Characteristic UUIDs
const NUS_SERVICE_UUID = "6e400001-b5a3-f393-e0a9-e50e24dcca9e"
const NUS_TX_CHAR_UUID = "6e400002-b5a3-f393-e0a9-e50e24dcca9e" // Write
const NUS_RX_CHAR_UUID = "6e400003-b5a3-f393-e0a9-e50e24dcca9e" // Notify

const LEGACY_SERVICE_UUID = "00001533-1412-efde-1523-785feabcd123"
const LEGACY_WRITE_UUID = "00001534-1412-efde-1523-785feabcd123"
const LEGACY_NOTIFY_UUID = "00001535-1412-efde-1523-785feabcd123"

const OLD_LEGACY_SERVICE_UUID = "00001530-1212-efde-1523-785feabcd123"
const OLD_LEGACY_WRITE_UUID = "00001531-1212-efde-1523-785feabcd123"
const OLD_LEGACY_NOTIFY_UUID = "00001532-1212-efde-1523-785feabcd123"

const FTMS_SERVICE_UUID = "00001826-0000-1000-8000-00805f9b34fb"

const ALL_OPTIONAL_SERVICES = [
  NUS_SERVICE_UUID,
  LEGACY_SERVICE_UUID,
  OLD_LEGACY_SERVICE_UUID,
  FTMS_SERVICE_UUID
]

export function buildNusPacket(opcode: number, payload: number[] = []): Uint8Array {
  const totalLen = 4 + payload.length
  const frame = [0xA5, totalLen, opcode, ...payload]
  const checksum = frame.reduce((acc, b) => (acc + b) & 0xFF, 0)
  frame.push(checksum)
  return new Uint8Array(frame)
}

const FULL_INITIALIZATION_SEQUENCES: string[][] = [
  // 1. Initial 6 handshake packet pairs
  ["fe020802", "ff08020402040204818700000000000000000000"],
  ["fe020802", "ff08020402040404808800000000000000000000"],
  ["fe020802", "ff08020402040404889000000000000000000000"],
  ["fe020a02", "ff0a0204020602068200008a0000000000000000"],
  ["fe020a02", "ff0a0204020602068400008c0000000000000000"],
  ["fe020802", "ff08020402040204959b00000000000000000000"],

  // 2. Primary 4-packet initialization
  [
    "fe022c04",
    "0012020402280428900701cec4b0aaa2a8949696",
    "0112aca8a2bad0dccefe14003a52786486a6fc18",
    "ff08324aa0880200004400000000000000000000"
  ],

  // 3. Setup / parameter configuration sequences
  [
    "fe021903",
    "001202040215041502000f001000d81c480000e0",
    "ff070000001000086e0000000000000000000000"
  ],
  [
    "fe021903",
    "0012020402150415020e00000000000000000000",
    "ff070000001001003a0000000000000000000000"
  ],
  [
    "fe021703",
    "0012020402130413020c00000000000000000000",
    "ff0500800000a500000000000000000000000000"
  ],
  [
    "fe021703",
    "0012020402130413020c00000000000000000000",
    "ff0500800000a500000000000000000000000000"
  ],
  [
    "fe021703",
    "0012020402130413020c00000000000000000000",
    "ff0500800000a500000000000000000000000000"
  ],
  [
    "fe021703",
    "0012020402130413020c00000000000000000000",
    "ff0500800000a500000000000000000000000000"
  ],
  [
    "fe022c04",
    "0012020402280428900701cec4b0aaa2a8949696",
    "0112aca8a2bad0dccefe14003a52786486a6fc18",
    "ff08324aa0880200004400000000000000000000"
  ],
  [
    "fe022003",
    "00120204021c041c020900004002184000008030",
    "ff0e2a0000c720580200b400580200ee00000000"
  ],

  // 4. Remote Control Mode Enable / Start workout sequences (IF Mode)
  [
    "fe021102",
    "ff110204020d040d02020310a00000000a00d200"
  ],
  [
    "fe021102",
    "ff110204020d040d02020310a00000000200ca00"
  ]
]

const POLL_SEQUENCE = [
  "fe021403",
  "001202040210041002000a1b9430000040500080",
  "ff02182700000000000000000000000000000000",
]

export function hexStringToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16)
  }
  return bytes
}

export function buildControlPackets(target: 0x01 | 0x02, valueParam: number): { header: string; payload: string } {
  // 16-bit signed/unsigned representation for little-endian
  const vUnsigned = (Math.round(valueParam) & 0xffff) >>> 0
  const vLow = vUnsigned & 0xff
  const vHigh = (vUnsigned >> 8) & 0xff
  const checksum = (0x10 + target + vLow + vHigh) & 0xff

  const targetHex = target.toString(16).padStart(2, '0')
  const vLowHex = vLow.toString(16).padStart(2, '0')
  const vHighHex = vHigh.toString(16).padStart(2, '0')
  const checksumHex = checksum.toString(16).padStart(2, '0')

  const header = "fe020d02"
  const payload = `ff0d0204020904090201${targetHex}${vLowHex}${vHighHex}00${checksumHex}0000000000`

  return { header, payload }
}

export interface BleLogEntry {
  id: number
  time: string
  text: string
  type: 'info' | 'tx' | 'rx' | 'error'
}

let writeQueuePromise: Promise<any> = Promise.resolve()

const LAST_DEVICE_ID_KEY = 'treddy_last_device_id'

export interface HandshakeProgress {
  current: number
  total: number
  label: string
  percent: number
}

interface BleState {
  device: any | null
  server: any | null
  writeChar: any | null
  notifyChar: any | null
  connected: boolean
  status: string
  logs: BleLogEntry[]
  
  protocolMode: 'nus' | 'legacy'

  // Guidance & Handshake Progress
  handshakePhase: 'idle' | 'connecting' | 'services' | 'handshake' | 'unlocked' | 'failed'
  handshakeProgress: HandshakeProgress
  showGuideModal: boolean
  guidanceStep: number
  showDisconnectModal: boolean
  disconnectReason: string | null
  isManualDisconnect: boolean

  // Metrics
  speedKph: number
  inclineDeg: number
  distanceKm: number
  calories: number
  timeStr: string
  
  // Internal tracking
  workoutSeconds: number
  hasSyncedInitialState: boolean
  accumulatedCalories: number
  startTime: number
  lastMetricUpdateTime: number
  pollInterval: any
  keepaliveInterval: any
  demoInterval: any

  // History of speed/incline/distance samples over the workout, used to plot the chart
  history: { t: number; speed: number; incline: number; distance: number }[]
}

export const useBleStore = defineStore('ble', {
  state: (): BleState => ({
    device: null,
    server: null,
    writeChar: null,
    notifyChar: null,
    connected: false,
    status: 'Disconnected',
    logs: [],

    protocolMode: 'legacy',
    
    handshakePhase: 'idle',
    handshakeProgress: { current: 0, total: 20, label: 'Ready to connect', percent: 0 },
    showGuideModal: false,
    guidanceStep: 1,
    showDisconnectModal: false,
    disconnectReason: null,
    isManualDisconnect: false,

    speedKph: 0.0,
    inclineDeg: 0.0,
    distanceKm: 0.0,
    calories: 0,
    timeStr: '0:00',
    
    workoutSeconds: 0,
    hasSyncedInitialState: false,
    accumulatedCalories: 0.0,
    startTime: 0,
    lastMetricUpdateTime: 0,
    pollInterval: null,
    keepaliveInterval: null,
    demoInterval: null,

    history: []
  }),

  actions: {
    addLog(text: string, type: 'info' | 'tx' | 'rx' | 'error' = 'info') {
      const d = new Date()
      const time = `${d.toTimeString().split(' ')[0]}.${d.getMilliseconds().toString().padStart(3, '0')}`
      const entry: BleLogEntry = {
        id: Date.now() + Math.random(),
        time,
        text,
        type
      }
      this.logs.push(entry)
      if (this.logs.length > 200) {
        this.logs.shift()
      }
      const prefix = `[BLE ${type.toUpperCase()}]`
      if (type === 'error') {
        console.error(prefix, text)
      } else if (type === 'tx') {
        console.log(`%c${prefix} ${text}`, 'color: #4CAF50; font-weight: bold')
      } else if (type === 'rx') {
        console.log(`%c${prefix} ${text}`, 'color: #2196F3; font-weight: bold')
      } else {
        console.log(prefix, text)
      }
    },

    clearLogs() {
      this.logs = []
    },

    formatTime(totalSeconds: number): string {
      const total = Math.floor(Math.max(0, totalSeconds))
      const m = Math.floor(total / 60)
      const s = total % 60
      const h = Math.floor(m / 60)
      
      if (h > 0) {
        return `${h}:${(m % 60).toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
      } else {
        return `${m}:${s.toString().padStart(2, '0')}`
      }
    },

    updateTimeStr(totalSeconds: number) {
      this.timeStr = this.formatTime(totalSeconds)
    },

    syncInitialWorkoutState(distanceKm: number, speedKph: number, inclineDeg: number) {
      const userWeight = 86.0
      let initialSeconds = this.workoutSeconds
      if (initialSeconds <= 0 && speedKph > 0) {
        initialSeconds = (distanceKm / speedKph) * 3600
      }
      if (initialSeconds > 0) {
        const initialCalories = calculateCalories(userWeight, speedKph, inclineDeg, initialSeconds)
        this.accumulatedCalories = initialCalories
        this.calories = Math.floor(this.accumulatedCalories)
        if (this.workoutSeconds <= 0) {
          this.workoutSeconds = Math.floor(initialSeconds)
          this.updateTimeStr(this.workoutSeconds)
        }
        // We joined mid-workout: backfill the chart assuming flat 0 incline and
        // the average speed (distance/time) for the untracked period, then let
        // it pick up with the real reading from now on.
        const avgSpeed = distanceKm > 0 ? (distanceKm / initialSeconds) * 3600 : speedKph
        this.history = [
          { t: 0, speed: avgSpeed, incline: 0, distance: 0 },
          { t: Math.floor(initialSeconds), speed: speedKph, incline: inclineDeg, distance: distanceKm }
        ]
      }
    },

    addHistoryPoint() {
      this.history.push({
        t: Math.round(this.workoutSeconds),
        speed: this.speedKph,
        incline: this.inclineDeg,
        distance: this.distanceKm
      })
      // Keep the stored history bounded by periodically discarding every other
      // sample once it grows very large; the chart still spans the full duration.
      if (this.history.length > 3600) {
        this.history = this.history.filter((_, i) => i % 2 === 0)
      }
    },

    startDemo() {
        if (this.connected) return
        this.connected = true
        this.status = 'Demo Mode'
        this.startTime = Date.now()
        this.lastMetricUpdateTime = Date.now()
        this.workoutSeconds = 0
        this.hasSyncedInitialState = true
        this.accumulatedCalories = 0.0
        this.calories = 0
        this.updateTimeStr(0)
        this.history = []
        
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
            this.addHistoryPoint()
        }, 1000)
    },

    openGuide(step: number = 1) {
      this.guidanceStep = step
      this.showGuideModal = true
    },

    closeGuide() {
      this.showGuideModal = false
    },

    openDisconnectModal() {
      this.showDisconnectModal = true
    },

    closeDisconnectModal() {
      this.showDisconnectModal = false
    },

    async startWarmup(targetKph: number = 1.6) {
      await this.setSpeed(targetKph)
      this.showGuideModal = false
    },

    async connect() {
      if (!import.meta.client) return

      try {
        this.status = 'Requesting Device...'
        this.handshakePhase = 'connecting'
        this.guidanceStep = 3
        this.handshakeProgress = {
          current: 1,
          total: FULL_INITIALIZATION_SEQUENCES.length + 3,
          label: 'Requesting Bluetooth device pairing...',
          percent: 5
        }
        this.addLog('Requesting Bluetooth device (filters: acceptAllDevices, optionalServices: ALL_OPTIONAL_SERVICES)...', 'info')
        
        // @ts-ignore
        const device = await navigator.bluetooth.requestDevice({
          acceptAllDevices: true,
          optionalServices: ALL_OPTIONAL_SERVICES
        })

        this.addLog(`User selected device: "${device.name || 'Unnamed'}" (${device.id})`, 'info')
        await this.setupDevice(device)
      } catch (e: any) {
        console.error(e)
        this.status = `Error: ${e}`
        this.handshakePhase = 'failed'
        this.handshakeProgress = {
          current: 0,
          total: FULL_INITIALIZATION_SEQUENCES.length + 3,
          label: `Connection failed: ${e?.message || e}. Ensure safety key is attached and press Bluetooth Sync button.`,
          percent: 0
        }
        this.addLog(`Connect error: ${e?.message || e}`, 'error')
        this.connected = false
      }
    },

    // Attempts to reconnect to the last used treadmill without prompting the device chooser.
    // Requires the experimental navigator.bluetooth.getDevices() API and a live user gesture
    // for the actual GATT connection in most browsers, so this may silently fail.
    async autoReconnect() {
      if (!import.meta.client || this.connected) return

      // @ts-ignore
      if (!navigator.bluetooth?.getDevices) return

      const lastDeviceId = localStorage.getItem(LAST_DEVICE_ID_KEY)
      if (!lastDeviceId) return

      try {
        // @ts-ignore
        const devices = await navigator.bluetooth.getDevices()
        const device = devices.find((d: any) => d.id === lastDeviceId)
        if (!device) return

        this.status = 'Looking for Treadmill...'
        this.addLog(`Auto-reconnect: found remembered device "${device.name || 'Unnamed'}" (${device.id})`, 'info')
        
        if (device.watchAdvertisements) {
          const abortController = new AbortController()
          device.addEventListener('advertisementreceived', async () => {
            abortController.abort()
            this.status = 'Reconnecting GATT...'
            this.addLog('Advertisement received, reconnecting GATT...', 'info')
            try {
              await this.setupDevice(device)
            } catch (e: any) {
              this.status = 'Disconnected'
              this.addLog(`Auto-reconnect GATT error: ${e?.message || e}`, 'error')
            }
          }, { once: true })
          
          await device.watchAdvertisements({ signal: abortController.signal })
          setTimeout(() => {
             abortController.abort()
             if (!this.connected) this.status = 'Disconnected'
          }, 10000) // 10 second search
        } else {
          await this.setupDevice(device)
        }
      } catch (e: any) {
        console.warn('Auto-reconnect failed, manual connect required', e)
        this.addLog(`Auto-reconnect warning: ${e?.message || e}`, 'info')
        this.status = 'Disconnected'
      }
    },

    async setupDevice(device: any) {
      this.device = device
      this.status = 'Connecting to Server...'
      this.handshakePhase = 'connecting'
      this.guidanceStep = 4
      const totalSteps = FULL_INITIALIZATION_SEQUENCES.length + 3
      this.handshakeProgress = {
        current: 1,
        total: totalSteps,
        label: `Connecting to GATT server on "${device.name || 'Unnamed'}"...`,
        percent: 10
      }
      this.addLog(`Connecting to GATT server on "${device.name || 'Unnamed'}" (${device.id})...`, 'info')

      device.addEventListener('gattserverdisconnected', this.onDisconnected)

      const server = await device.gatt?.connect()
      if (!server) throw new Error('Could not connect to GATT Server')
      this.server = server
      this.addLog('Connected to GATT server successfully.', 'info')

      this.status = 'Getting Service...'
      this.handshakePhase = 'services'
      this.handshakeProgress = {
        current: 2,
        total: totalSteps,
        label: 'Discovering Primary GATT Service & Characteristics...',
        percent: 18
      }

      let writeChar: any = null
      let notifyChar: any = null
      let mode: 'nus' | 'legacy' = 'legacy'

      // Try discovering NUS (UART Service) first
      try {
        this.addLog(`Checking for NUS UART Service (${NUS_SERVICE_UUID})...`, 'info')
        const service = await server.getPrimaryService(NUS_SERVICE_UUID)
        writeChar = await service.getCharacteristic(NUS_TX_CHAR_UUID)
        notifyChar = await service.getCharacteristic(NUS_RX_CHAR_UUID)
        mode = 'nus'
        this.addLog('Found NUS UART Service (6E400001)!', 'info')
      } catch {
        // Fall back to 1533 legacy service
        try {
          this.addLog(`Checking for Primary IF Service (${LEGACY_SERVICE_UUID})...`, 'info')
          const service = await server.getPrimaryService(LEGACY_SERVICE_UUID)
          writeChar = await service.getCharacteristic(LEGACY_WRITE_UUID)
          notifyChar = await service.getCharacteristic(LEGACY_NOTIFY_UUID)
          mode = 'legacy'
          this.addLog('Found Primary IF Service (1533)!', 'info')
        } catch {
          // Fall back to 1530 older service
          this.addLog(`Checking for Primary Legacy Service (${OLD_LEGACY_SERVICE_UUID})...`, 'info')
          const service = await server.getPrimaryService(OLD_LEGACY_SERVICE_UUID)
          writeChar = await service.getCharacteristic(OLD_LEGACY_WRITE_UUID)
          notifyChar = await service.getCharacteristic(OLD_LEGACY_NOTIFY_UUID)
          mode = 'legacy'
          this.addLog('Found Primary Legacy Service (1530)!', 'info')
        }
      }

      this.protocolMode = mode
      this.writeChar = writeChar
      this.notifyChar = notifyChar

      const writeProps = writeChar.properties || {}
      this.addLog(`Characteristics bound: WriteChar=${writeChar.uuid} (write=${writeProps.write}, writeWithoutResponse=${writeProps.writeWithoutResponse}), NotifyChar=${notifyChar.uuid} (notify=${notifyChar.properties?.notify}) [Mode=${mode.toUpperCase()}]`, 'info')

      this.addLog(`Subscribing to notifications on NotifyChar (${notifyChar.uuid})...`, 'info')
      await notifyChar.startNotifications()
      notifyChar.addEventListener('characteristicvaluechanged', (event: any) => {
        const value = event.target.value
        if (value) this.handleNotification(value)
      })
      this.addLog('Notification subscription active.', 'info')

      this.connected = true
      this.status = 'Initializing...'
      this.handshakePhase = 'handshake'
      this.hasSyncedInitialState = false
      this.history = []

      localStorage.setItem(LAST_DEVICE_ID_KEY, device.id)

      if (mode === 'nus') {
        this.addLog('Executing NUS handshake, requesting remote control, and starting keepalive watchdog...', 'info')

        // 1. Handshake (0x10)
        await this.writeRaw(buildNusPacket(0x10), 'NUS_CMD_HANDSHAKE')
        await new Promise(r => setTimeout(r, 60))

        // 2. Request Exclusive Control (0x15)
        await this.writeRaw(buildNusPacket(0x15), 'NUS_CMD_REQUEST_CONTROL')
        await new Promise(r => setTimeout(r, 60))

        // 3. Start Belt Motor in manual mode (0x11)
        await this.writeRaw(buildNusPacket(0x11, [0x01]), 'NUS_CMD_START_BELT')
        await new Promise(r => setTimeout(r, 60))

        // Start 250ms Keepalive Watchdog Loop to satisfy the 500ms safety timer
        this.keepaliveInterval = setInterval(async () => {
          if (!this.connected || !this.writeChar) return
          try {
            const pingPacket = buildNusPacket(0x30, [0x00]) // [0xA5, 0x05, 0x30, 0x00, 0xDA]
            await this.enqueueWrite(async () => {
              if (this.writeChar.writeValueWithoutResponse) {
                await this.writeChar.writeValueWithoutResponse(pingPacket)
              } else if (this.writeChar.writeValue) {
                await this.writeChar.writeValue(pingPacket)
              }
            })
          } catch (e: any) {
            // Background watchdog ping
          }
        }, 250)
      } else {
        this.addLog(`Sending full IF treadmill handshake & unlock sequence (${FULL_INITIALIZATION_SEQUENCES.length} sequences)...`, 'info')
        for (let s = 0; s < FULL_INITIALIZATION_SEQUENCES.length; s++) {
          const seq = FULL_INITIALIZATION_SEQUENCES[s]!
          const pct = Math.round(20 + ((s + 1) / FULL_INITIALIZATION_SEQUENCES.length) * 78)
          this.handshakeProgress = {
            current: s + 3,
            total: totalSteps,
            label: `Unlocking Remote Control Mode [Sequence ${s + 1}/${FULL_INITIALIZATION_SEQUENCES.length}]...`,
            percent: pct
          }
          await this.enqueueWrite(async () => {
            for (let i = 0; i < seq.length; i++) {
              const hex = seq[i]!
              await this.writeRaw(hexStringToBytes(hex), `Init[${s + 1}/${FULL_INITIALIZATION_SEQUENCES.length}][${i + 1}/${seq.length}]`)
              if (i < seq.length - 1) {
                await new Promise(r => setTimeout(r, 20))
              }
            }
          })
          await new Promise(r => setTimeout(r, 40))
        }

        this.pollInterval = setInterval(async () => {
           if (!this.connected || !this.writeChar) return
           try {
             await this.enqueueWrite(async () => {
               for (let i = 0; i < POLL_SEQUENCE.length; i++) {
                 const hex = POLL_SEQUENCE[i]
                 await this.writeRaw(hexStringToBytes(hex), `Poll[${i + 1}/${POLL_SEQUENCE.length}]`)
                 await new Promise(r => setTimeout(r, 20))
               }
             })
             this.updateRealtimeMetrics()
             this.addHistoryPoint()
           } catch (e: any) {
             this.addLog(`Poll error: ${e?.message || e}`, 'error')
             console.error("Poll error", e)
           }
        }, 1000)
      }

      this.handshakePhase = 'unlocked'
      this.guidanceStep = 5
      this.handshakeProgress = {
        current: totalSteps,
        total: totalSteps,
        label: 'Treadmill Ready & Remote Control Unlocked!',
        percent: 100
      }

      this.status = 'Running'
      this.startTime = Date.now()
      this.lastMetricUpdateTime = Date.now()
    },

    async enqueueWrite<T>(op: () => Promise<T>): Promise<T> {
      const prev = writeQueuePromise || Promise.resolve()
      let resolveOp!: (val: T) => void
      let rejectOp!: (err: any) => void
      const opPromise = new Promise<T>((res, rej) => {
        resolveOp = res
        rejectOp = rej
      })

      writeQueuePromise = prev
        .catch(() => {})
        .then(async () => {
          try {
            const res = await op()
            resolveOp(res)
          } catch (err) {
            rejectOp(err)
          }
        })

      return opPromise
    },

    async writeRaw(bytes: Uint8Array, label: string = '') {
      if (!this.writeChar) {
        this.addLog(`Cannot write (${label}): writeChar is null`, 'error')
        return
      }
      const hex = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')
      const t0 = performance.now()
      try {
        if (this.writeChar.writeValueWithResponse) {
          await this.writeChar.writeValueWithResponse(bytes)
        } else {
          await this.writeChar.writeValue(bytes)
        }
        const elapsed = (performance.now() - t0).toFixed(1)
        this.addLog(`TX ${label ? `(${label}) ` : ''}[${bytes.length}B]: ${hex} (${elapsed}ms)`, 'tx')
      } catch (err: any) {
        this.addLog(`TX ERROR ${label ? `(${label}) ` : ''}[${bytes.length}B ${hex}]: ${err?.message || err}`, 'error')
        throw err
      }
    },

    disconnect() {
      this.addLog('Manual disconnect requested.', 'info')
      this.isManualDisconnect = true
      if (this.device && this.device.gatt?.connected) {
        this.device.gatt.disconnect()
      }
      this.onDisconnected()
    },

    onDisconnected() {
      this.addLog('GATT server disconnected.', 'info')
      const wasConnected = this.connected
      this.connected = false
      this.status = 'Disconnected'
      this.server = null
      this.writeChar = null
      this.notifyChar = null
      this.handshakePhase = 'idle'
      if (this.pollInterval) clearInterval(this.pollInterval)
      if (this.keepaliveInterval) clearInterval(this.keepaliveInterval)
      if (this.demoInterval) clearInterval(this.demoInterval)

      if (wasConnected && !this.isManualDisconnect) {
        this.showDisconnectModal = true
        this.disconnectReason = 'Treadmill disconnected unexpectedly. Ensure the safety key is attached and press the Bluetooth Sync button on your console to reconnect.'
      }
      this.isManualDisconnect = false
    },

    handleNotification(data: DataView) {
      const bytes: string[] = []
      for (let i = 0; i < data.byteLength; i++) {
        bytes.push(data.getUint8(i).toString(16).padStart(2, '0'))
      }
      const hexStr = bytes.join('')
      const firstByte = data.getUint8(0)

      // NUS Telemetry Notification: firstByte 0x02, length >= 16, opcode (byte 2) == 0x80
      if (firstByte === 0x02 && data.byteLength >= 16 && data.getUint8(2) === 0x80) {
        const speedRaw = data.getUint16(3, true)
        const inclineRaw = data.getInt16(5, true)
        const d0 = data.getUint8(7)
        const d1 = data.getUint8(8)
        const d2 = data.getUint8(9)
        const distanceMeters = d0 | (d1 << 8) | (d2 << 16)
        const statusFlags = data.getUint8(13)
        const isMetric = !!(statusFlags & 0x20)

        // Speed: if imperial, speedRaw is mph * 100 -> convert to kph
        const speed = isMetric ? (speedRaw / 100.0) : (speedRaw / 100.0) * 1.609344
        const incline = inclineRaw / 10.0
        const distance = distanceMeters / 1000.0

        this.addLog(`RX NUS Telemetry: Speed=${speed.toFixed(2)}km/h, Inc=${incline.toFixed(1)}%, Dist=${distance.toFixed(3)}km [${hexStr}]`, 'rx')

        if (!this.hasSyncedInitialState && distance > 0) {
          this.syncInitialWorkoutState(distance, speed, incline)
          this.hasSyncedInitialState = true
        }

        this.speedKph = speed
        this.inclineDeg = incline
        this.distanceKm = distance
      } else if (firstByte === 0x00 && data.byteLength >= 18 && data.getUint8(8) === 0x02 && data.getUint8(9) === 0x02) {
        // Real legacy metrics notification: firstByte 0x00, length >= 18, and operation bytes 8-9 == 0x02, 0x02
        const speed = data.getUint16(10, true) / 100.0
        const incline = data.getUint16(12, true) / 100.0
        const distance = data.getUint16(16, true) / 1000.0

        this.addLog(`RX Legacy Metrics: Speed=${speed.toFixed(2)}km/h, Inc=${incline.toFixed(1)}%, Dist=${distance.toFixed(3)}km [${hexStr}]`, 'rx')
        
        if (!this.hasSyncedInitialState && distance > 0) {
          this.syncInitialWorkoutState(distance, speed, incline)
          this.hasSyncedInitialState = true
        }

        this.speedKph = speed
        this.inclineDeg = incline
        this.distanceKm = distance
      } else if (firstByte === 0x01 && data.byteLength >= 11 && data.getUint32(2, true) === 0 && data.getUint8(6) === 0x02) {
        const treadmillSeconds = data.getUint16(9, true)
        this.addLog(`RX Time: ${treadmillSeconds}s [${hexStr}]`, 'rx')
        if (treadmillSeconds > 0) {
          if (!this.hasSyncedInitialState && this.distanceKm > 0 && this.accumulatedCalories === 0) {
            const avgSpeed = this.speedKph > 0 ? this.speedKph : (this.distanceKm / treadmillSeconds) * 3600
            const userWeight = 86.0
            this.accumulatedCalories = calculateCalories(userWeight, avgSpeed, this.inclineDeg, treadmillSeconds)
            this.calories = Math.floor(this.accumulatedCalories)
            this.workoutSeconds = treadmillSeconds
            this.updateTimeStr(this.workoutSeconds)
            this.hasSyncedInitialState = true
            this.history = [
              { t: 0, speed: avgSpeed, incline: 0, distance: 0 },
              { t: treadmillSeconds, speed: this.speedKph, incline: this.inclineDeg, distance: this.distanceKm }
            ]
          } else if (this.workoutSeconds === 0) {
            this.workoutSeconds = treadmillSeconds
            this.updateTimeStr(this.workoutSeconds)
          }
        }
      } else {
        this.addLog(`RX Other/Ack [${data.byteLength}B, 0x${firstByte.toString(16).padStart(2, '0')}]: ${hexStr}`, 'rx')
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
            this.workoutSeconds += dt
            this.updateTimeStr(Math.floor(this.workoutSeconds))
        }
    },

    async setSpeed(kph: number) {
        if (!this.connected) {
          this.addLog(`setSpeed(${kph}) ignored: treadmill not connected`, 'info')
          return
        }
        
        // Strict safety limits: max 10.0 km/h
        if (kph > 10.0) {
            kph = 10.0
        }
        // Hardware minimum speed on treadmill is 1.0 mph (1.60 km/h)
        if (kph > 0 && kph < 1.6) {
            kph = 1.6
        }
        if (kph > this.speedKph + 2.0 && this.speedKph > 0) {
            kph = this.speedKph + 2.0
        }
        if (kph < 0) kph = 0

        this.addLog(`setSpeed called: target=${kph.toFixed(2)} km/h [Mode=${this.protocolMode.toUpperCase()}]`, 'info')

        if (this.writeChar) {
          try {
            if (this.protocolMode === 'nus') {
              const speedMph = kph / 1.609344
              const rawVal = Math.round(speedMph * 100.0)
              const payload = [rawVal & 0xFF, (rawVal >> 8) & 0xFF]
              const packet = buildNusPacket(0x20, payload)

              if (kph > 0 && this.speedKph === 0) {
                await this.enqueueWrite(async () => {
                  await this.writeRaw(buildNusPacket(0x11, [0x01]), 'NUS_START_BELT')
                  await new Promise(r => setTimeout(r, 40))
                  await this.writeRaw(packet, `NUS_SET_SPEED(${speedMph.toFixed(2)}mph)`)
                })
              } else if (kph === 0) {
                await this.enqueueWrite(async () => {
                  await this.writeRaw(buildNusPacket(0x12, [0x00]), 'NUS_STOP_BELT')
                })
              } else {
                await this.enqueueWrite(async () => {
                  await this.writeRaw(packet, `NUS_SET_SPEED(${speedMph.toFixed(2)}mph)`)
                })
              }
            } else {
              const speedParam = Math.round(kph * 100)
              const { header, payload } = buildControlPackets(0x01, speedParam)

              if (kph > 0 && this.speedKph === 0) {
                // Belt is stopped: send Start Workout / Spin Belt sequence to engage motor relay
                await this.enqueueWrite(async () => {
                  await this.writeRaw(hexStringToBytes("fe021102"), 'StartHeader1')
                  await new Promise(r => setTimeout(r, 40))
                  await this.writeRaw(hexStringToBytes("ff110204020d040d02020310a00000000a00d200"), 'StartInit')
                  await new Promise(r => setTimeout(r, 50))
                  await this.writeRaw(hexStringToBytes("fe021102"), 'StartHeader2')
                  await new Promise(r => setTimeout(r, 40))
                  await this.writeRaw(hexStringToBytes("ff110204020d040d02020310a00000000200ca00"), 'StartBelt')
                  await new Promise(r => setTimeout(r, 60))
                  if (kph > 1.6) {
                    await this.writeRaw(hexStringToBytes(header), 'SpeedHeader')
                    await new Promise(r => setTimeout(r, 50))
                    await this.writeRaw(hexStringToBytes(payload), 'SpeedPayload')
                  }
                })
              } else if (kph === 0) {
                await this.enqueueWrite(async () => {
                  const stopPackets = buildControlPackets(0x01, 0)
                  await this.writeRaw(hexStringToBytes(stopPackets.header), 'SpeedStopHeader')
                  await new Promise(r => setTimeout(r, 50))
                  await this.writeRaw(hexStringToBytes(stopPackets.payload), 'SpeedStopPayload')
                })
              } else {
                await this.enqueueWrite(async () => {
                  await this.writeRaw(hexStringToBytes(header), 'SpeedHeader')
                  await new Promise(r => setTimeout(r, 50))
                  await this.writeRaw(hexStringToBytes(payload), 'SpeedPayload')
                })
              }
            }
            this.addLog(`Speed command (${kph.toFixed(2)} km/h) sent successfully to treadmill write queue`, 'info')
          } catch (e: any) {
            this.addLog(`setSpeed write failed: ${e?.message || e}`, 'error')
            console.error("setSpeed error", e)
          }
        } else {
          this.addLog('setSpeed cannot write: writeChar is null', 'error')
        }
        this.speedKph = kph
    },

    async setIncline(deg: number) {
        if (!this.connected) {
          this.addLog(`setIncline(${deg}) ignored: treadmill not connected`, 'info')
          return
        }
        
        // Logical bounds for treadmill inclines (-3.0% to 20.0%)
        if (deg > 20.0) deg = 20.0
        if (deg < -3.0) deg = -3.0

        this.addLog(`setIncline called: target=${deg.toFixed(1)}% [Mode=${this.protocolMode.toUpperCase()}]`, 'info')

        if (this.writeChar) {
          try {
            if (this.protocolMode === 'nus') {
              const rawVal = Math.round(deg * 10.0)
              const rawUnsigned = (rawVal & 0xFFFF) >>> 0
              const payload = [rawUnsigned & 0xFF, (rawUnsigned >> 8) & 0xFF]
              const packet = buildNusPacket(0x21, payload)
              await this.enqueueWrite(async () => {
                await this.writeRaw(packet, `NUS_SET_INCLINE(${deg.toFixed(1)}%)`)
              })
            } else {
              const inclineParam = Math.round(deg * 100)
              const { header, payload } = buildControlPackets(0x02, inclineParam)
              await this.enqueueWrite(async () => {
                await this.writeRaw(hexStringToBytes(header), 'InclineHeader')
                await new Promise(r => setTimeout(r, 50))
                await this.writeRaw(hexStringToBytes(payload), 'InclinePayload')
              })
            }
            this.addLog(`Incline command (${deg.toFixed(1)}%) sent successfully to treadmill write queue`, 'info')
          } catch (e: any) {
            this.addLog(`setIncline write failed: ${e?.message || e}`, 'error')
            console.error("setIncline error", e)
          }
        } else {
          this.addLog('setIncline cannot write: writeChar is null', 'error')
        }
        this.inclineDeg = deg
    },

  }
})
