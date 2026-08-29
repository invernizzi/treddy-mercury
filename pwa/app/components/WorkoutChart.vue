<template>
  <div class="chart-card">
    <div class="chart-header">
      <span class="legend"><i class="swatch flat"></i> Flat</span>
      <span class="legend"><i class="swatch steep"></i> Incline</span>
      <span class="lap-info">Lap {{ lapNumber }} &middot; {{ distanceKm.toFixed(2) }} km</span>
    </div>
    <div class="chart-wrapper" ref="wrapperEl">
      <canvas ref="canvasEl"></canvas>
      <div v-if="history.length < 2" class="chart-empty">Waiting for data...</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'

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

const COS30 = Math.cos(Math.PI / 6)
const SIN30 = Math.sin(Math.PI / 6)

// Standard 2:1 isometric projection: ground plane (wx, wz) plus elevation (wy).
function iso(wx: number, wz: number, wy: number) {
  return { x: (wx - wz) * COS30, y: (wx + wz) * SIN30 - wy }
}

const distanceKm = computed(() => props.history.length ? props.history[props.history.length - 1]!.distance : 0)
const lapNumber = computed(() => Math.floor(distanceKm.value / LAP_KM) + 1)

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

// A small T-Rex runner silhouette (chrome-dino inspired), drawn facing +x with alternating legs.
function drawDino(ctx: CanvasRenderingContext2D, x: number, y: number, angle: number, scale: number, runFrame: number) {
  ctx.save()
  ctx.translate(x, y)
  ctx.rotate(angle)
  ctx.scale(scale, scale)

  ctx.fillStyle = '#6b6b6b'
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

  // Small arm
  ctx.fillStyle = '#5a5a5a'
  ctx.fillRect(3, -4, 3, 1.6)

  // Eye
  ctx.fillStyle = '#111'
  ctx.beginPath()
  ctx.arc(7.5, -10, 0.9, 0, Math.PI * 2)
  ctx.fill()

  // Legs (alternate stride)
  ctx.fillStyle = '#6b6b6b'
  if (runFrame === 0) {
    ctx.fillRect(2, 3, 2.4, 6)
    ctx.fillRect(-3, 3, 2.4, 4)
  } else {
    ctx.fillRect(-1, 3, 2.4, 4)
    ctx.fillRect(-4, 3, 2.4, 6)
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
  // remembers the incline ("altitude") that was recorded there, across laps.
  const bucketIncline = new Array(NUM_BUCKETS).fill(0)
  const bucketVisited = new Array(NUM_BUCKETS).fill(false)
  for (const p of points) {
    const posKm = ((p.distance % LAP_KM) + LAP_KM) % LAP_KM
    const idx = Math.min(NUM_BUCKETS - 1, Math.floor((posKm / LAP_KM) * NUM_BUCKETS))
    bucketIncline[idx] = p.incline
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

  // Depth-sort buckets so farther segments of the loop are painted first.
  const order = Array.from({ length: NUM_BUCKETS }, (_, i) => i)
    .sort((a, b) => {
      const pa = trackPoint((a + 0.5) / NUM_BUCKETS)
      const pb = trackPoint((b + 0.5) / NUM_BUCKETS)
      return (pa.x + pa.z) - (pb.x + pb.z)
    })

  for (const i of order) {
    const f0 = i / NUM_BUCKETS
    const f1 = (i + 1) / NUM_BUCKETS
    const p0 = trackPoint(f0)
    const p1 = trackPoint(f1)
    const inner0 = { x: p0.x - p0.nx * HALF_WIDTH_WORLD, z: p0.z - p0.nz * HALF_WIDTH_WORLD }
    const outer0 = { x: p0.x + p0.nx * HALF_WIDTH_WORLD, z: p0.z + p0.nz * HALF_WIDTH_WORLD }
    const inner1 = { x: p1.x - p1.nx * HALF_WIDTH_WORLD, z: p1.z - p1.nz * HALF_WIDTH_WORLD }
    const outer1 = { x: p1.x + p1.nx * HALF_WIDTH_WORLD, z: p1.z + p1.nz * HALF_WIDTH_WORLD }

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

    const visited = bucketVisited[i]
    const h = visited ? heightFor(bucketIncline[i]) : 0
    if (h > 0.5) {
      // Elevation "hill" sitting on the outer edge of the track for this stretch.
      const wall0 = project(outer0.x, outer0.z, 0)
      const wall1 = project(outer1.x, outer1.z, 0)
      const wallTop0 = project(outer0.x, outer0.z, h)
      const wallTop1 = project(outer1.x, outer1.z, h)
      ctx.beginPath()
      ctx.moveTo(wall0.x, wall0.y)
      ctx.lineTo(wall1.x, wall1.y)
      ctx.lineTo(wallTop1.x, wallTop1.y)
      ctx.lineTo(wallTop0.x, wallTop0.y)
      ctx.closePath()
      ctx.fillStyle = inclineColor(bucketIncline[i], 0.65)
      ctx.fill()

      const topInner0 = project(inner0.x, inner0.z, h)
      const topInner1 = project(inner1.x, inner1.z, h)
      ctx.beginPath()
      ctx.moveTo(topInner0.x, topInner0.y)
      ctx.lineTo(topInner1.x, topInner1.y)
      ctx.lineTo(wallTop1.x, wallTop1.y)
      ctx.lineTo(wallTop0.x, wallTop0.y)
      ctx.closePath()
      ctx.fillStyle = inclineColor(bucketIncline[i], 1)
      ctx.fill()
    }

    // Draw the runner right after its own bucket so it layers correctly with the terrain.
    const posKm = ((distanceKm.value % LAP_KM) + LAP_KM) % LAP_KM
    const runnerFraction = posKm / LAP_KM
    if (runnerFraction >= f0 && runnerFraction < f1) {
      const rp = trackPoint(runnerFraction)
      const runnerHeight = visited ? heightFor(bucketIncline[i]) : 0
      const base = project(rp.x, rp.z, runnerHeight)
      const ahead = project(rp.x + rp.tx * 4, rp.z + rp.tz * 4, runnerHeight)
      const angle = Math.atan2(ahead.y - base.y, ahead.x - base.x)
      const runFrame = Math.floor(Date.now() / 200) % 2
      drawDino(ctx, base.x, base.y, angle, Math.max(0.8, scale * 0.45), runFrame)
    }
  }
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

.lap-info {
  margin-left: auto;
  color: #999;
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
