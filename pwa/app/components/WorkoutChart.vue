<template>
  <div class="chart-card">
    <div class="chart-header">
      <span class="legend"><i class="swatch flat"></i> Flat</span>
      <span class="legend"><i class="swatch steep"></i> Incline</span>
    </div>
    <div class="chart-wrapper" ref="wrapperEl">
      <canvas ref="canvasEl"></canvas>
      <div v-if="history.length < 2" class="chart-empty">Waiting for data...</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import { useBleStore } from '~/stores/ble'

interface HistoryPoint {
  t: number
  speed: number
  incline: number
  distance: number
}

const props = defineProps<{
  history: HistoryPoint[]
}>()

const wrapperEl = ref<HTMLDivElement | null>(null)
const canvasEl = ref<HTMLCanvasElement | null>(null)
let resizeObserver: ResizeObserver | null = null
let rafId: number | null = null
const bleStore = useBleStore()

// State for Power-Ups
let lastConsumedPowerupId: number = -1
let boostEndTime: number = 0

// The workout is drawn as a fixed-length running track loop instead of a
// scrolling timeline, so it always fits regardless of how far the run goes -
// the runner just laps the circuit as distance accumulates.
const LAP_KM = 0.4
const NUM_BUCKETS = 48

// World-space (pre-projection) track dimensions and elevation scale.
const WORLD_R = 30
const WORLD_STRAIGHT = 70
const HALF_WIDTH_WORLD = 9
const MAX_INCLINE_FOR_SCALE = 20 // % incline that maxes out the reserved vertical space
const MAX_HEIGHT_WORLD = 22

// Static decorative props scattered across the infield, given fixed world positions
// so they stay put lap after lap instead of jittering every frame.
const FIELD_DECORATIONS: { x: number; z: number; type: 'palm' | 'rock' | 'ptero'; s: number }[] = [
  { x: 45, z: 20, type: 'palm', s: 1.1 },
  { x: 60, z: 45, type: 'rock', s: 0.9 },
  { x: 75, z: 15, type: 'palm', s: 0.9 },
  { x: 50, z: 40, type: 'rock', s: 1.2 },
  { x: 85, z: 42, type: 'palm', s: 1.0 },
  { x: 40, z: 46, type: 'rock', s: 0.7 },
  { x: 65, z: 25, type: 'palm', s: 1.3 },
  { x: 95, z: 30, type: 'rock', s: 1.0 },
  { x: 18, z: 30, type: 'rock', s: 0.8 },
  { x: 112, z: 30, type: 'palm', s: 1.1 },
  { x: 25, z: 22, type: 'ptero', s: 0.9 },
  { x: 82, z: 28, type: 'ptero', s: 0.85 }
]

const COS30 = Math.cos(Math.PI / 6)
const SIN30 = Math.sin(Math.PI / 6)

// Standard 2:1 isometric projection: ground plane (wx, wz) plus elevation (wy).
function iso(wx: number, wz: number, wy: number) {
  return { x: (wx - wz) * COS30, y: (wx + wz) * SIN30 - wy }
}

// Speed thresholds (km/h) that unlock each dino accessory / track detail tier.
const DINO_HAT_SPEED = 5
const DINO_SPIKES_SPEED = 6
const DINO_JETPACK_SPEED = 8
const DINO_SUNGLASSES_SPEED = 10

const TRACK_ROCKS_SPEED = 4
const TRACK_TRAIL_SPEED = 6
const TRACK_CACTUS_SPEED = 8

// Tiers are cumulative: each stage keeps the previous stage's accessories/detail and adds more.
function dinoTier(speed: number): number {
  if (speed >= DINO_SUNGLASSES_SPEED) return 4
  if (speed >= DINO_JETPACK_SPEED) return 3
  if (speed >= DINO_SPIKES_SPEED) return 2
  if (speed >= DINO_HAT_SPEED) return 1
  return 0
}

function trackTier(speed: number): number {
  if (speed >= TRACK_CACTUS_SPEED) return 3
  if (speed >= TRACK_TRAIL_SPEED) return 2
  if (speed >= TRACK_ROCKS_SPEED) return 1
  return 0
}

// Deterministic pseudo-random in [0, 1), seeded by an integer so the same bucket always
// picks the same decoration variant instead of reshuffling every animation frame.
function hashSeed(seed: number): number {
  const x = Math.sin(seed * 12.9898) * 43758.5453
  return x - Math.floor(x)
}

const distanceKm = computed(() => props.history.length ? props.history[props.history.length - 1]!.distance : 0)

// Returns the ground-plane point, outward normal and tangent direction for a fraction (0..1) around the stadium track.
function trackPoint(fraction: number) {
  const r = WORLD_R
  const straightLen = WORLD_STRAIGHT
  const leftX = r
  const rightX = r + straightLen
  const topZ = 0
  const bottomZ = 2 * r
  const centerZ = r
  const perimeter = 2 * straightLen + 2 * Math.PI * r
  let s = (((fraction % 1) + 1) % 1) * perimeter

  if (s < straightLen) {
    const t = s / straightLen
    return { x: leftX + t * straightLen, z: topZ, nx: 0, nz: -1, tx: 1, tz: 0 }
  }
  s -= straightLen

  const halfCircle = Math.PI * r
  if (s < halfCircle) {
    const angle = -Math.PI / 2 + s / r
    return {
      x: rightX + r * Math.cos(angle), z: centerZ + r * Math.sin(angle),
      nx: Math.cos(angle), nz: Math.sin(angle),
      tx: -Math.sin(angle), tz: Math.cos(angle)
    }
  }
  s -= halfCircle

  if (s < straightLen) {
    const t = s / straightLen
    return { x: rightX - t * straightLen, z: bottomZ, nx: 0, nz: 1, tx: -1, tz: 0 }
  }
  s -= straightLen

  const angle = Math.PI / 2 + s / r
  return {
    x: leftX + r * Math.cos(angle), z: centerZ + r * Math.sin(angle),
    nx: Math.cos(angle), nz: Math.sin(angle),
    tx: -Math.sin(angle), tz: Math.cos(angle)
  }
}

// A small T-Rex runner silhouette (chrome-dino inspired). Drawn upright like a billboarded
// isometric sprite (never rotated flat with the ground), mirrored by travel direction.
// Accessories stack up with speed: tier 1 adds a hat, tier 2 adds back spikes, tier 3 adds a jetpack.
function drawDino(ctx: CanvasRenderingContext2D, x: number, y: number, facingRight: boolean, scale: number, runFrame: number, tier: number) {
  ctx.save()

  // Soft contact shadow sits right at the anchor (ground contact) point.
  ctx.fillStyle = 'rgba(0, 0, 0, 0.4)'
  ctx.beginPath()
  ctx.ellipse(x, y + 0.5 * scale, 7.5 * scale, 2.3 * scale, 0, 0, Math.PI * 2)
  ctx.fill()

  ctx.translate(x, y)
  ctx.scale(scale * (facingRight ? 1 : -1), scale)
  // Shift the whole sprite up so its feet (drawn around local y=9) rest on the anchor,
  // instead of the body sinking below the track surface.
  ctx.translate(0, -9)

  ctx.fillStyle = '#2f8f46'
  // Tail
  ctx.beginPath()
  ctx.moveTo(-11, 3)
  ctx.quadraticCurveTo(-13, 0, -14, -3)
  ctx.quadraticCurveTo(-10, -1, -7, 0)
  ctx.closePath()
  ctx.fill()

  // Body + neck + head, legs excluded from this path.
  ctx.beginPath()
  ctx.moveTo(-8, 2)
  ctx.quadraticCurveTo(-8, -6, -1, -8)
  ctx.quadraticCurveTo(3, -9, 5, -12)
  ctx.lineTo(9, -12)
  ctx.lineTo(9, -8)
  ctx.lineTo(7, -8)
  ctx.lineTo(7, -5)
  ctx.quadraticCurveTo(6, -3, 4, -2)
  ctx.lineTo(4, 3)
  ctx.lineTo(-2, 3)
  ctx.closePath()
  ctx.fill()

  // Lighter belly patch for a bit of shading.
  ctx.fillStyle = '#8fd39a'
  ctx.beginPath()
  ctx.moveTo(-6, 2)
  ctx.quadraticCurveTo(-6, -2, -3, -3)
  ctx.quadraticCurveTo(0, -2, 1, 2)
  ctx.lineTo(-2, 3)
  ctx.lineTo(-6, 2)
  ctx.closePath()
  ctx.fill()

  // Back spikes (tier 2+)
  if (tier >= 2) {
    ctx.fillStyle = '#1f5c2c'
    const spikes: [number, number][] = [[-6, -6], [-4, -7], [-2, -8], [0, -8.5], [2, -9]]
    for (const [sx, sy] of spikes) {
      ctx.beginPath()
      ctx.moveTo(sx - 1, sy + 1)
      ctx.lineTo(sx, sy - 2.5)
      ctx.lineTo(sx + 1, sy + 1)
      ctx.closePath()
      ctx.fill()
    }
  }

  // Small arm
  ctx.fillStyle = '#256b37'
  ctx.fillRect(3, -4, 3, 1.6)

  // Eye
  ctx.fillStyle = '#111'
  ctx.beginPath()
  ctx.arc(7.5, -10, 0.9, 0, Math.PI * 2)
  ctx.fill()

  // Fun hat (tier 1+)
  if (tier >= 1) {
    ctx.fillStyle = '#ff5252'
    ctx.beginPath()
    ctx.moveTo(6.5, -12)
    ctx.lineTo(9.5, -12)
    ctx.lineTo(8, -18)
    ctx.closePath()
    ctx.fill()
    ctx.fillStyle = '#ffd54f'
    ctx.beginPath()
    ctx.arc(8, -18, 1, 0, Math.PI * 2)
    ctx.fill()
  }

  // Jetpack with dual nozzles and flickering flame (tier 3)
  if (tier >= 3) {
    ctx.fillStyle = '#555'
    ctx.fillRect(-9, -9, 4, 8)
    ctx.fillStyle = '#777'
    ctx.fillRect(-9, -9, 4, 2)
    // Nozzles
    ctx.fillStyle = '#444'
    ctx.fillRect(-8.5, -1, 1.2, 1.5)
    ctx.fillRect(-6.7, -1, 1.2, 1.5)
    // Flames
    ctx.fillStyle = '#ff9800'
    const flicker = Math.sin(Date.now() / 80) * 1.5
    ctx.beginPath()
    ctx.moveTo(-8.5, 0.5)
    ctx.lineTo(-7.3, 0.5)
    ctx.lineTo(-7.9, 3 + flicker)
    ctx.closePath()
    ctx.fill()
    ctx.beginPath()
    ctx.moveTo(-6.7, 0.5)
    ctx.lineTo(-5.5, 0.5)
    ctx.lineTo(-6.1, 3 + flicker)
    ctx.closePath()
    ctx.fill()
  }

  // Sunglasses (tier 4)
  if (tier >= 4) {
    ctx.fillStyle = '#111'
    ctx.fillRect(5, -11, 4, 2.5) // front lens
    ctx.fillRect(4, -10.5, 1, 1.5) // connector
    ctx.fillRect(1, -11, 3, 2.5) // side lens
    ctx.fillRect(-1, -10.5, 2, 0.8) // side arm
  }

  // Legs (alternate stride)
  ctx.fillStyle = '#256b37'
  if (runFrame === 0) {
    ctx.fillRect(2, 3, 2.4, 6)
    ctx.fillRect(-3, 3, 2.4, 4)
  } else {
    ctx.fillRect(-1, 3, 2.4, 4)
    ctx.fillRect(-4, 3, 2.4, 6)
  }

  ctx.restore()
}

// A simple isometric palm tree: trunk + a fan of fronds, billboarded like the dino.
function drawPalm(ctx: CanvasRenderingContext2D, x: number, y: number, scale: number) {
  ctx.save()
  ctx.fillStyle = 'rgba(0, 0, 0, 0.35)'
  ctx.beginPath()
  ctx.ellipse(x, y + 1 * scale, 6 * scale, 2 * scale, 0, 0, Math.PI * 2)
  ctx.fill()

  ctx.translate(x, y)
  ctx.scale(scale, scale)

  ctx.fillStyle = '#8a6437'
  ctx.beginPath()
  ctx.moveTo(-1.6, 1)
  ctx.quadraticCurveTo(-3, -7, -1, -15)
  ctx.lineTo(1, -15)
  ctx.quadraticCurveTo(3, -7, 1.6, 1)
  ctx.closePath()
  ctx.fill()

  ctx.fillStyle = '#2f8f46'
  const frondAngles = [-150, -110, -80, -50, -10]
  for (const deg of frondAngles) {
    ctx.save()
    ctx.translate(0, -15)
    ctx.rotate((deg * Math.PI) / 180)
    ctx.beginPath()
    ctx.moveTo(0, 0)
    ctx.quadraticCurveTo(6, -2.5, 12, -1)
    ctx.quadraticCurveTo(6, 1.5, 0, 1)
    ctx.closePath()
    ctx.fill()
    ctx.restore()
  }

  ctx.restore()
}

// A small isometric boulder made of two flat-shaded facets.
function drawRock(ctx: CanvasRenderingContext2D, x: number, y: number, scale: number) {
  ctx.save()
  ctx.fillStyle = 'rgba(0, 0, 0, 0.35)'
  ctx.beginPath()
  ctx.ellipse(x, y + 0.8 * scale, 5.5 * scale, 1.8 * scale, 0, 0, Math.PI * 2)
  ctx.fill()

  ctx.translate(x, y)
  ctx.scale(scale, scale)

  ctx.fillStyle = '#6e6a63'
  ctx.beginPath()
  ctx.moveTo(-6, 1)
  ctx.lineTo(-5, -4)
  ctx.lineTo(-1, -7)
  ctx.lineTo(4, -6)
  ctx.lineTo(6, -1)
  ctx.lineTo(3, 2)
  ctx.lineTo(-3, 2)
  ctx.closePath()
  ctx.fill()

  ctx.fillStyle = '#87837b'
  ctx.beginPath()
  ctx.moveTo(-1, -7)
  ctx.lineTo(4, -6)
  ctx.lineTo(2, -3)
  ctx.lineTo(-2, -3)
  ctx.closePath()
  ctx.fill()

  ctx.restore()
}

// A small blocky cactus for the highest track-detail tier. "twin" draws two slimmer arms-free
// stalks instead of one two-armed cactus, for visual variety along the track.
function drawCactus(ctx: CanvasRenderingContext2D, x: number, y: number, scale: number, twin: boolean, seed: number) {
  ctx.save()
  ctx.fillStyle = 'rgba(0, 0, 0, 0.35)'
  ctx.beginPath()
  ctx.ellipse(x, y + 1 * scale, 4 * scale, 1.5 * scale, 0, 0, Math.PI * 2)
  ctx.fill()

  ctx.translate(x, y)
  ctx.scale(scale, scale)
  ctx.fillStyle = '#2f8f46'

  if (twin) {
    ctx.fillRect(-4, -11, 2.6, 13)
    ctx.fillRect(0.5, -15, 2.6, 17)
  } else {
    ctx.fillRect(-1.5, -14, 3, 16)
    ctx.fillRect(-4.5, -8, 3, 6)
    ctx.fillRect(-4.5, -9, 4.5, 3)
    ctx.fillRect(1.5, -11, 3, 6)
    ctx.fillRect(0, -12, 4.5, 3)
  }

  // Draw colorful cactus flowers randomly
  if (seed > 0.5) {
    ctx.fillStyle = seed > 0.75 ? '#e91e63' : '#ffeb3b' // Pink or yellow flower
    if (twin) {
      ctx.fillRect(-4, -12.5, 2.6, 1.5)
      ctx.fillRect(0.5, -16.5, 2.6, 1.5)
    } else {
      ctx.fillRect(-4.5, -9.5, 1.5, 1.5)
      ctx.fillRect(3.0, -12.5, 1.5, 1.5)
    }
  }

  ctx.restore()
}

// A low desert bush - an alternative to a rock so speed-tier decoration isn't just boulders.
function drawBush(ctx: CanvasRenderingContext2D, x: number, y: number, scale: number) {
  ctx.save()
  ctx.fillStyle = 'rgba(0, 0, 0, 0.3)'
  ctx.beginPath()
  ctx.ellipse(x, y + 0.6 * scale, 4.5 * scale, 1.5 * scale, 0, 0, Math.PI * 2)
  ctx.fill()

  ctx.translate(x, y)
  ctx.scale(scale, scale)
  ctx.fillStyle = '#3d6b2f'
  ctx.beginPath()
  ctx.ellipse(-2, -1, 3, 2.2, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.beginPath()
  ctx.ellipse(2, -1.5, 3.2, 2.4, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = '#4d8038'
  ctx.beginPath()
  ctx.ellipse(0, -3, 3, 2, 0, 0, Math.PI * 2)
  ctx.fill()

  ctx.restore()
}

// A simple flying Pterodactyl that casts a shadow below it
function drawPtero(ctx: CanvasRenderingContext2D, x: number, y: number, scale: number) {
  ctx.save()
  
  // Shadow on ground
  ctx.fillStyle = 'rgba(0, 0, 0, 0.25)'
  ctx.beginPath()
  ctx.ellipse(x, y + 15 * scale, 5 * scale, 2 * scale, 0, 0, Math.PI * 2)
  ctx.fill()

  ctx.translate(x, y)
  // Animate flying up and down slightly
  const floatOffs = Math.sin(Date.now() / 300) * 2 * scale
  ctx.translate(0, floatOffs)

  ctx.scale(scale, scale)
  ctx.fillStyle = '#6d8e8b' // Cool grey/green ptero color

  // Body
  ctx.beginPath()
  ctx.moveTo(2, -4)
  ctx.lineTo(6, -2)
  ctx.lineTo(2, 0)
  ctx.lineTo(-4, -1)
  ctx.lineTo(-8, -3) // head
  ctx.lineTo(-4, -4)
  ctx.closePath()
  ctx.fill()

  // Beak
  ctx.fillStyle = '#ffb300'
  ctx.beginPath()
  ctx.moveTo(-7, -2.5)
  ctx.lineTo(-12, -2.5)
  ctx.lineTo(-7, -1.5)
  ctx.closePath()
  ctx.fill()

  // Wings (flap animation)
  const flap = Math.sin(Date.now() / 150)
  ctx.fillStyle = '#567572'
  ctx.beginPath()
  ctx.moveTo(-1, -3)
  ctx.lineTo(2, -15 * flap - 5)
  ctx.lineTo(6, -2)
  ctx.closePath()
  ctx.fill()

  ctx.restore()
}

// A dashed dirt-trail streak drawn along a track segment's centerline.
function drawTrail(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number) {
  ctx.save()
  ctx.strokeStyle = 'rgba(210, 190, 150, 0.6)'
  ctx.lineWidth = 1.6
  ctx.setLineDash([3, 3])
  ctx.beginPath()
  ctx.moveTo(x0, y0)
  ctx.lineTo(x1, y1)
  ctx.stroke()
  ctx.restore()
}

// A glowing boost pad on the track floor
function drawPowerup(ctx: CanvasRenderingContext2D, p0: {x: number, y: number}, p1: {x: number, y: number}, scale: number) {
  ctx.save()
  
  const pulse = (Math.sin(Date.now() / 150) + 1) / 2 // 0 to 1
  
  ctx.strokeStyle = `rgba(0, 255, 255, ${0.4 + pulse * 0.6})`
  ctx.lineWidth = 3 * scale
  
  // Draw chevron pointing in track direction
  const dx = p1.x - p0.x
  const dy = p1.y - p0.y
  const cx = p0.x + dx * 0.5
  const cy = p0.y + dy * 0.5
  const len = Math.sqrt(dx*dx + dy*dy)
  
  if (len > 0) {
    const nx = dx / len
    const ny = dy / len
    const perpX = -ny
    const perpY = nx
    
    const size = 3 * scale
    
    ctx.beginPath()
    ctx.moveTo(cx - nx * size + perpX * size, cy - ny * size + perpY * size)
    ctx.lineTo(cx + nx * size, cy + ny * size)
    ctx.lineTo(cx - nx * size - perpX * size, cy - ny * size - perpY * size)
    ctx.stroke()

    ctx.beginPath()
    ctx.moveTo(cx - nx * size * 2 + perpX * size, cy - ny * size * 2 + perpY * size)
    ctx.lineTo(cx, cy)
    ctx.lineTo(cx - nx * size * 2 - perpX * size, cy - ny * size * 2 - perpY * size)
    ctx.stroke()
  }
  
  ctx.restore()
}

function draw() {
  const canvas = canvasEl.value
  const wrapper = wrapperEl.value
  if (!canvas || !wrapper) return

  const dpr = window.devicePixelRatio || 1
  const width = wrapper.clientWidth
  const height = wrapper.clientHeight
  if (width <= 0 || height <= 0) return

  canvas.width = width * dpr
  canvas.height = height * dpr
  canvas.style.width = `${width}px`
  canvas.style.height = `${height}px`

  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, width, height)

  const points = props.history
  if (points.length < 2) return

  // Bucket the whole run by position around the lap so each stretch of track
  // remembers the incline ("altitude") and speed that were recorded there, across laps.
  const bucketIncline = new Array(NUM_BUCKETS).fill(0)
  const bucketSpeed = new Array(NUM_BUCKETS).fill(0)
  const bucketVisited = new Array(NUM_BUCKETS).fill(false)
  for (const p of points) {
    const posKm = ((p.distance % LAP_KM) + LAP_KM) % LAP_KM
    const idx = Math.min(NUM_BUCKETS - 1, Math.floor((posKm / LAP_KM) * NUM_BUCKETS))
    bucketIncline[idx] = p.incline
    bucketSpeed[idx] = p.speed
    bucketVisited[idx] = true
  }

  function heightFor(incline: number) {
    return Math.min(1, Math.max(0, incline) / MAX_INCLINE_FOR_SCALE) * MAX_HEIGHT_WORLD
  }

  function inclineColor(incline: number, shade: number): string {
    const t = Math.min(1, Math.max(0, incline) / MAX_INCLINE_FOR_SCALE)
    const r0 = 0x3a, g0 = 0x3a, b0 = 0x3a
    const r1 = 0xff, g1 = 0x98, b1 = 0x00
    const cr = Math.round((r0 + (r1 - r0) * t) * shade)
    const cg = Math.round((g0 + (g1 - g0) * t) * shade)
    const cb = Math.round((b0 + (b1 - b0) * t) * shade)
    return `rgb(${cr}, ${cg}, ${cb})`
  }

  // Compute a stable projection scale that reserves room for the tallest possible hill,
  // so the isometric loop always fits regardless of current incline.
  const samplePoints: { x: number; y: number }[] = []
  const sampleCount = 64
  for (let i = 0; i <= sampleCount; i++) {
    const f = i / sampleCount
    const p = trackPoint(f)
    const ix = p.x - p.nx * HALF_WIDTH_WORLD
    const iz = p.z - p.nz * HALF_WIDTH_WORLD
    const ox = p.x + p.nx * HALF_WIDTH_WORLD
    const oz = p.z + p.nz * HALF_WIDTH_WORLD
    samplePoints.push(iso(ix, iz, 0))
    samplePoints.push(iso(ox, oz, MAX_HEIGHT_WORLD))
  }
  const minX = Math.min(...samplePoints.map(p => p.x))
  const maxX = Math.max(...samplePoints.map(p => p.x))
  const minY = Math.min(...samplePoints.map(p => p.y))
  const maxY = Math.max(...samplePoints.map(p => p.y))

  const padding = 10
  const availW = width - padding * 2
  const availH = height - padding * 2
  const scale = Math.min(availW / Math.max(1, maxX - minX), availH / Math.max(1, maxY - minY))
  const isoCenterX = (minX + maxX) / 2
  const isoCenterY = (minY + maxY) / 2
  const screenCenterX = width / 2
  const screenCenterY = height / 2

  function project(wx: number, wz: number, wy: number) {
    const p = iso(wx, wz, wy)
    return {
      x: screenCenterX + (p.x - isoCenterX) * scale,
      y: screenCenterY + (p.y - isoCenterY) * scale
    }
  }

  // Every drawable (track buckets, field props, the runner) gets a depth key so the
  // whole scene is painter's-algorithm sorted together, instead of per-category - which is
  // what let props and the dino clip through the terrain before.
  type Task = { depth: number; draw: () => void }
  const tasks: Task[] = []

  for (let i = 0; i < NUM_BUCKETS; i++) {
    const f0 = i / NUM_BUCKETS
    const f1 = (i + 1) / NUM_BUCKETS
    const p0 = trackPoint(f0)
    const p1 = trackPoint(f1)
    const mid = trackPoint((i + 0.5) / NUM_BUCKETS)
    const inner0 = { x: p0.x - p0.nx * HALF_WIDTH_WORLD, z: p0.z - p0.nz * HALF_WIDTH_WORLD }
    const outer0 = { x: p0.x + p0.nx * HALF_WIDTH_WORLD, z: p0.z + p0.nz * HALF_WIDTH_WORLD }
    const inner1 = { x: p1.x - p1.nx * HALF_WIDTH_WORLD, z: p1.z - p1.nz * HALF_WIDTH_WORLD }
    const outer1 = { x: p1.x + p1.nx * HALF_WIDTH_WORLD, z: p1.z + p1.nz * HALF_WIDTH_WORLD }

    const visited = bucketVisited[i]
    const h = visited ? heightFor(bucketIncline[i]) : 0

    tasks.push({
      depth: mid.x + mid.z,
      draw: () => {
        // Flat track surface (ground).
        const gi0 = project(inner0.x, inner0.z, 0)
        const gi1 = project(inner1.x, inner1.z, 0)
        const go1 = project(outer1.x, outer1.z, 0)
        const go0 = project(outer0.x, outer0.z, 0)
        ctx.beginPath()
        ctx.moveTo(gi0.x, gi0.y)
        ctx.lineTo(gi1.x, gi1.y)
        ctx.lineTo(go1.x, go1.y)
        ctx.lineTo(go0.x, go0.y)
        ctx.closePath()
        ctx.fillStyle = i % 2 === 0 ? '#2b2b2b' : '#272727'
        ctx.fill()

        if (h > 0.5) {
          const wallTop0 = project(outer0.x, outer0.z, h)
          const wallTop1 = project(outer1.x, outer1.z, h)
          const topInner0 = project(inner0.x, inner0.z, h)
          const topInner1 = project(inner1.x, inner1.z, h)

          // Outer wall (away from the infield).
          const wall0 = project(outer0.x, outer0.z, 0)
          const wall1 = project(outer1.x, outer1.z, 0)
          ctx.beginPath()
          ctx.moveTo(wall0.x, wall0.y)
          ctx.lineTo(wall1.x, wall1.y)
          ctx.lineTo(wallTop1.x, wallTop1.y)
          ctx.lineTo(wallTop0.x, wallTop0.y)
          ctx.closePath()
          ctx.fillStyle = inclineColor(bucketIncline[i], 0.65)
          ctx.fill()

          // Inner wall (toward the infield) - this face was previously missing.
          const innerWall0 = project(inner0.x, inner0.z, 0)
          const innerWall1 = project(inner1.x, inner1.z, 0)
          ctx.beginPath()
          ctx.moveTo(innerWall0.x, innerWall0.y)
          ctx.lineTo(innerWall1.x, innerWall1.y)
          ctx.lineTo(topInner1.x, topInner1.y)
          ctx.lineTo(topInner0.x, topInner0.y)
          ctx.closePath()
          ctx.fillStyle = inclineColor(bucketIncline[i], 0.5)
          ctx.fill()

          // Hill top surface.
          ctx.beginPath()
          ctx.moveTo(topInner0.x, topInner0.y)
          ctx.lineTo(topInner1.x, topInner1.y)
          ctx.lineTo(wallTop1.x, wallTop1.y)
          ctx.lineTo(wallTop0.x, wallTop0.y)
          ctx.closePath()
          ctx.fillStyle = inclineColor(bucketIncline[i], 1)
          ctx.fill()
        }

        // Track detail grows denser with the speed recorded at this stretch: rocks/bushes, then a
        // dust trail, then cacti - each tier keeps the previous tier's detail. Every choice below
        // is seeded off the bucket index so neighboring buckets don't all render the same prop.
        const tier = trackTier(visited ? bucketSpeed[i] : 0)
        if (tier >= 1) {
          const countRoll = hashSeed(i * 3 + 1)
          const propCount = countRoll < 0.15 ? 0 : countRoll < 0.65 ? 1 : 2
          for (let k = 0; k < propCount; k++) {
            const sideRoll = hashSeed(i * 7 + k * 2) * 2 - 1 // -1..1
            const sizeRoll = 0.16 + hashSeed(i * 13 + k * 5) * 0.14
            const alongRoll = 0.3 + hashSeed(i * 17 + k * 3) * 0.4
            const propX = p0.x + (p1.x - p0.x) * alongRoll + mid.nx * HALF_WIDTH_WORLD * sideRoll * 0.7
            const propZ = p0.z + (p1.z - p0.z) * alongRoll + mid.nz * HALF_WIDTH_WORLD * sideRoll * 0.7
            const propPos = project(propX, propZ, h)
            if (hashSeed(i * 23 + k * 7) < 0.5) drawRock(ctx, propPos.x, propPos.y, scale * sizeRoll)
            else drawBush(ctx, propPos.x, propPos.y, scale * sizeRoll)
          }
        }
        if (tier >= 2) {
          const trailA = project(p0.x, p0.z, h)
          const trailB = project(p1.x, p1.z, h)
          drawTrail(ctx, trailA.x, trailA.y, trailB.x, trailB.y)
        }
        if (tier >= 3) {
          const cactusPos = project(mid.x - mid.nx * HALF_WIDTH_WORLD * 0.4, mid.z - mid.nz * HALF_WIDTH_WORLD * 0.4, h)
          const isTwin = hashSeed(i * 31) > 0.5
          drawCactus(ctx, cactusPos.x, cactusPos.y, scale * 0.3, isTwin, hashSeed(i * 47))
        }
        if (i === 12 || i === 36) {
          const lap = Math.floor(distanceKm.value / LAP_KM)
          const pId = lap * NUM_BUCKETS + i
          if (pId > lastConsumedPowerupId) {
            const padA = project(p0.x, p0.z, h)
            const padB = project(p1.x, p1.z, h)
            drawPowerup(ctx, padA, padB, scale * 0.8)
          }
        }
      }
    })
  }

  for (const deco of FIELD_DECORATIONS) {
    const p = project(deco.x, deco.z, 0)
    tasks.push({
      depth: deco.x + deco.z,
      draw: () => {
        if (deco.type === 'palm') drawPalm(ctx, p.x, p.y, deco.s * scale * 0.4)
        else if (deco.type === 'rock') drawRock(ctx, p.x, p.y, deco.s * scale * 0.4)
        else if (deco.type === 'ptero') drawPtero(ctx, p.x, p.y - 15 * scale, deco.s * scale * 0.4)
      }
    })
  }

  const posKm = ((distanceKm.value % LAP_KM) + LAP_KM) % LAP_KM
  const runnerFraction = posKm / LAP_KM
  const runnerBucket = Math.min(NUM_BUCKETS - 1, Math.floor(runnerFraction * NUM_BUCKETS))
  const rp = trackPoint(runnerFraction)
  const runnerVisited = bucketVisited[runnerBucket]
  const runnerHeight = runnerVisited ? heightFor(bucketIncline[runnerBucket]) : 0
  const base = project(rp.x, rp.z, runnerHeight)
  const ahead = project(rp.x + rp.tx * 4, rp.z + rp.tz * 4, runnerHeight)
  const facingRight = ahead.x >= base.x
  const currentSpeed = points[points.length - 1]!.speed
  const lap = Math.floor(distanceKm.value / LAP_KM)
  if (runnerBucket === 12 || runnerBucket === 36) {
    const pId = lap * NUM_BUCKETS + runnerBucket
    if (pId > lastConsumedPowerupId) {
      lastConsumedPowerupId = pId
      boostEndTime = Date.now() + 2000
      bleStore.setSpeed(currentSpeed + 1.0)
    }
  }

  const isBoosting = Date.now() < boostEndTime
  const runFrame = Math.floor(Date.now() / (isBoosting ? 100 : 200)) % 2

  // The runner's single depth key ties with (or loses to) the wide terrain quad it stands
  // on, so it would occasionally sort behind the very hill it's running on. Draw it last,
  // on top of the whole scene, so it never disappears behind the track.
  tasks.sort((a, b) => a.depth - b.depth)
  for (const task of tasks) task.draw()
  
  if (isBoosting) {
    // Sprint effect trails
    ctx.save()
    ctx.translate(base.x, base.y)
    ctx.scale(Math.max(1.1, scale * 0.65), Math.max(1.1, scale * 0.65))
    ctx.fillStyle = 'rgba(0, 255, 255, 0.5)'
    ctx.beginPath()
    ctx.ellipse(facingRight ? -8 : 8, -5, 4, 1.5, 0, 0, Math.PI * 2)
    ctx.ellipse(facingRight ? -12 : 12, -3, 2, 1, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
  }

  drawDino(ctx, base.x, base.y, facingRight, Math.max(1.1, scale * 0.65), runFrame, dinoTier(currentSpeed))
}

function loop() {
  draw()
  rafId = requestAnimationFrame(loop)
}

watch(() => props.history.length, draw)

onMounted(() => {
  if (wrapperEl.value) {
    resizeObserver = new ResizeObserver(() => draw())
    resizeObserver.observe(wrapperEl.value)
  }
  rafId = requestAnimationFrame(loop)
})

onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  if (rafId !== null) cancelAnimationFrame(rafId)
})
</script>

<style scoped>
.chart-card {
  margin-top: 1.5rem;
  border: 1px solid var(--color-secondary);
  background: #0a0a0a;
  border-radius: 8px;
  padding: 12px 16px;
}

.chart-header {
  display: flex;
  gap: 16px;
  align-items: center;
  justify-content: center;
  font-size: 0.8rem;
  color: #ccc;
  margin-bottom: 8px;
}

.legend {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.swatch {
  width: 14px;
  height: 8px;
  border-radius: 3px;
  display: inline-block;
}

.swatch.flat {
  background: #3a3a3a;
}

.swatch.steep {
  background: #FF9800;
}

.chart-wrapper {
  position: relative;
  width: 100%;
  height: 280px;
  flex: 1;
  min-height: 200px;
}

.chart-wrapper canvas {
  position: absolute;
  top: 0;
  left: 0;
}

.chart-empty {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #666;
  font-size: 0.85rem;
}
</style>
