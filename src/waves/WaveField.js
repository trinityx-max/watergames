// CPU-side ocean model. The height function here is mirrored line-for-line by
// the GLSL in waveGLSL.js, so the board floats on exactly the surface that is
// rendered. Waves are analytic: a set wave is an asymmetric solitary hump
// travelling toward the beach (+z) that breaks from a peak and peels outward
// in both directions (an A-frame), leaving whitewater between the two break
// points.

import { WAVE, WORLD, CHOP } from '../config.js'

export const MAX_WAVES = 3

const INV_ENV = 1 / (2 * WAVE.envSigma * WAVE.envSigma)
const G = WORLD.gravity

const clamp = (x, a, b) => (x < a ? a : x > b ? b : x)
const mix = (a, b, t) => a + (b - a) * t
export const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1)
  return t * t * (3 - 2 * t)
}

// Normalised chop table: dirX, dirZ, k, amplitude, omega, phase
export const CHOP_TABLE = CHOP.map(([dx, dz, wl, a], i) => {
  const len = Math.hypot(dx, dz)
  const k = (Math.PI * 2) / wl
  return [dx / len, dz / len, k, a, Math.sqrt(G * k), i * 1.7]
})

export function curlAmount(s, bk) {
  return bk * smoothstep(-13, -6, s) * (1 - smoothstep(0, 9, s))
}

// Shape of a single wave. Writes detail into `o` when given.
export function waveShape(w, x, z, o) {
  const dx = x - w.xPeak
  const zc = w.zc - WAVE.curvature * dx * dx
  const u = z - zc
  const s = Math.max(x - w.xbR, w.xbL - x)
  const env = 0.55 + 0.45 * Math.exp(-dx * dx * INV_ENV)
  const pocket = Math.exp(-Math.max(s, 0) / WAVE.pocketDecay)
  const broken = w.bk * smoothstep(0, WAVE.brokenRamp, -s)
  const steep = w.bk * pocket * (1 - broken)
  const shoulder = 1 - 0.25 * w.bk * smoothstep(15, 130, s)
  const amp = w.amp * env * (1 + 0.22 * steep) * (1 + (WAVE.brokenAmp - 1) * broken) * shoulder
  const lf = mix(mix(WAVE.faceLenOpen, WAVE.faceLenPocket, steep), WAVE.faceLenBore, broken)
  const L = u < 0 ? WAVE.backLen : lf
  const q = u / L
  const main = amp * Math.exp(-q * q)
  const tq = (u - 1.7 * lf) / (1.4 * lf)
  const h = main - amp * WAVE.troughDepth * Math.exp(-tq * tq)
  if (o) {
    o.u = u
    o.s = s
    o.amp = amp
    o.broken = broken
    o.steep = steep
    o.lf = lf
    o.hn = amp > 1e-4 ? main / amp : 0
    o.main = main
    o.curl = curlAmount(s, w.bk)
    o.bk = w.bk
  }
  return h
}

export class WaveField {
  constructor() {
    this.time = 0
    this.waves = []
    this.nextId = 1
    this.uniformA = new Float32Array(MAX_WAVES * 4)
    this.uniformB = new Float32Array(MAX_WAVES * 4)
    this._tmp = {}
  }

  reset() {
    this.waves.length = 0
  }

  // Queue a wave whose crest will reach `arriveZ` after `delay` seconds.
  spawn({ xPeak = 0, height = WAVE.height, delay = 8, arriveZ = WORLD.lineupZ, peel = WAVE.peelSpeed } = {}) {
    if (this.waves.length >= MAX_WAVES) return null
    const w = {
      id: this.nextId++,
      zc: arriveZ - WAVE.speed * delay,
      amp: 0,
      height,
      peel,
      xPeak,
      xbR: xPeak,
      xbL: xPeak,
      bk: 0,
      breakTime: -1,
      age: 0,
    }
    this.waves.push(w)
    this._updateWave(w, 0)
    return w
  }

  spawnSet({ xPeak = 0, count = 3, spacing = 7.5, firstDelay = 8, height = WAVE.height } = {}) {
    const out = []
    for (let i = 0; i < count; i++) {
      const jitter = (Math.random() - 0.5) * 18
      const h = height * (0.85 + Math.random() * 0.3) * (i === 0 ? 1 : 0.95)
      const w = this.spawn({ xPeak: xPeak + jitter * (i > 0 ? 1 : 0), height: h, delay: firstDelay + i * spacing })
      if (w) out.push(w)
    }
    return out
  }

  getWave(id) {
    for (const w of this.waves) if (w.id === id) return w
    return null
  }

  _updateWave(w, dt) {
    w.age += dt
    w.zc += WAVE.speed * dt
    // Shoaling: grow as the wave feels the reef, then spend itself near the beach.
    const grow = 0.5 + 0.5 * smoothstep(WORLD.spawnZ - 40, WORLD.breakZ, w.zc)
    const die = 1 - 0.88 * smoothstep(WORLD.endZ - 110, WORLD.endZ, w.zc)
    const spawnFade = smoothstep(0, 3, w.age)
    w.amp = w.height * grow * die * spawnFade
    if (w.breakTime < 0 && w.zc >= WORLD.breakZ) w.breakTime = this.time
    if (w.breakTime >= 0) {
      const t = this.time - w.breakTime
      w.bk = smoothstep(0, 1.4, t) * (1 - 0.7 * smoothstep(WORLD.endZ - 60, WORLD.endZ + 20, w.zc))
      const run = w.peel * t
      w.xbR = w.xPeak + run
      w.xbL = w.xPeak - run
    }
  }

  update(dt) {
    this.time += dt
    for (const w of this.waves) this._updateWave(w, dt)
    for (let i = this.waves.length - 1; i >= 0; i--) {
      if (this.waves[i].zc > WORLD.endZ + 40) this.waves.splice(i, 1)
    }
    this._packUniforms()
  }

  _packUniforms() {
    const A = this.uniformA
    const B = this.uniformB
    A.fill(0)
    B.fill(0)
    for (let i = 0; i < MAX_WAVES; i++) {
      const w = this.waves[i]
      if (!w) {
        A[i * 4] = -1e4
        continue
      }
      A[i * 4] = w.zc
      A[i * 4 + 1] = w.amp
      A[i * 4 + 2] = w.xbR
      A[i * 4 + 3] = w.xbL
      B[i * 4] = w.xPeak
      B[i * 4 + 1] = w.bk
    }
  }

  // Geometry of the curling lip above crest point x (mirrors the lip shader).
  lipAt(w, x, out = {}) {
    const dx = x - w.xPeak
    const zc = w.zc - WAVE.curvature * dx * dx
    const d = this._tmp
    waveShape(w, x, zc, d)
    out.zc = zc
    out.crestH = this.heightAt(x, zc)
    out.curl = d.curl
    out.s = d.s
    out.amp = d.amp
    out.phiMax = Math.PI * (0.8 + (0.38 - 0.8) * smoothstep(-2, 9, d.s))
    out.Rz = d.curl * d.amp * WAVE.lipReach
    out.Ry = d.curl * d.amp * WAVE.lipDrop * (1 + 0.25 * (1 - smoothstep(-12, -5, d.s)))
    return out
  }

  // Height of the underside of the lip at z, or Infinity when no lip is overhead.
  lipCeiling(x, z) {
    let ceil = Infinity
    const L = this._lip || (this._lip = {})
    for (const w of this.waves) {
      if (w.bk < 0.05) continue
      this.lipAt(w, x, L)
      if (L.curl < 0.08 || L.Rz < 0.3) continue
      const q = (z - L.zc) / L.Rz
      if (q < -0.3 || q > 1) continue
      const phi = Math.asin(Math.min(1, Math.max(0, q)))
      ceil = Math.min(ceil, L.crestH - L.Ry * (1 - Math.cos(phi)))
    }
    return ceil
  }

  chopHeight(x, z, t = this.time) {
    let h = 0
    for (const c of CHOP_TABLE) h += c[3] * Math.sin(c[2] * (c[0] * x + c[1] * z) - c[4] * t + c[5])
    return h
  }

  chopRate(x, z, t = this.time) {
    let v = 0
    for (const c of CHOP_TABLE) v -= c[3] * c[4] * Math.cos(c[2] * (c[0] * x + c[1] * z) - c[4] * t + c[5])
    return v
  }

  wavesHeight(x, z) {
    let h = 0
    for (const w of this.waves) h += waveShape(w, x, z, null)
    return h
  }

  heightAt(x, z) {
    return this.wavesHeight(x, z) + this.chopHeight(x, z)
  }

  // Full sample used by physics and gameplay. `preferId` selects which wave
  // the detail fields (u, s, curl...) describe; otherwise the dominant one.
  sample(x, z, out = {}, preferId = 0) {
    const e = 0.18
    const h = this.heightAt(x, z)
    const hx = (this.heightAt(x + e, z) - this.heightAt(x - e, z)) / (2 * e)
    const hz = (this.heightAt(x, z + e) - this.heightAt(x, z - e)) / (2 * e)
    const inv = 1 / Math.sqrt(hx * hx + 1 + hz * hz)
    out.h = h
    out.nx = -hx * inv
    out.ny = inv
    out.nz = -hz * inv
    out.slopeX = hx
    out.slopeZ = hz

    // Water particle velocity: shallow-water drift under each hump, plus the
    // shove of the whitewater bore. Vertical velocity is the surface rate.
    let vz = 0
    let best = null
    let bestScore = -1
    const d = this._tmp
    for (const w of this.waves) {
      waveShape(w, x, z, d)
      vz += (WAVE.speed * d.main) / WAVE.effDepth
      vz += WAVE.speed * 0.55 * d.broken * Math.exp(-(d.u / 5) * (d.u / 5))
      const score = w.id === preferId ? 1e9 : d.main
      if (score > bestScore) {
        bestScore = score
        best = w
        out.u = d.u
        out.s = d.s
        out.amp = d.amp
        out.broken = d.broken
        out.steep = d.steep
        out.hn = d.hn
        out.curl = d.curl
        out.bk = d.bk
        out.lf = d.lf
      }
    }
    const wz = (this.wavesHeight(x, z + e) - this.wavesHeight(x, z - e)) / (2 * e)
    out.vx = 0
    out.vz = vz
    out.vy = -WAVE.speed * wz + this.chopRate(x, z)
    out.waveId = best ? best.id : 0
    if (!best) {
      out.u = -1e3
      out.s = 1e3
      out.amp = 0
      out.broken = 0
      out.steep = 0
      out.hn = 0
      out.curl = 0
      out.bk = 0
      out.lf = WAVE.faceLenOpen
    }
    return out
  }
}
