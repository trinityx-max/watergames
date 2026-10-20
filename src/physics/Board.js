// Surfboard dynamics. The board is a point mass glued to the analytic water
// surface by a spring-damper acting along the surface normal (so pressure on a
// sloped face shoves you down it), with planing drag split into a low
// along-board component and a high cross-board "rail grip" component. Pitch
// and roll come from sampling the surface at the nose, tail and rails, which
// gives the lazy rocking of a board sitting in the swell.

import { Vector3 } from 'three'
import { WAVE, WORLD } from '../config.js'
import { smoothstep } from '../waves/WaveField.js'

const G = WORLD.gravity
export const STEP = 1 / 120

export const MODE = {
  PRONE: 'prone',
  POPUP: 'popup',
  RIDING: 'riding',
  AIR: 'air',
  WIPEOUT: 'wipeout',
}

const clamp = (x, a, b) => (x < a ? a : x > b ? b : x)
export const wrapAngle = (a) => {
  a = (a + Math.PI) % (Math.PI * 2)
  if (a < 0) a += Math.PI * 2
  return a - Math.PI
}
const ssign = (v, w = 0.35) => v / (Math.abs(v) + w)

const _n = new Vector3()
const _wv = new Vector3()
const _acc = new Vector3()
const _ff = new Vector3()
const _fw = new Vector3()
const _lat = new Vector3()
const _rel = new Vector3()
const _a = new Vector3()
const _b = new Vector3()
const _up = new Vector3()

export class Board {
  constructor(field) {
    this.field = field
    this.pos = new Vector3()
    this.vel = new Vector3()
    this.up = new Vector3(0, 1, 0)
    this.surfaceUp = new Vector3(0, 1, 0)
    this.input = { steer: 0, throttle: 0, brake: 0, grab: false }
    this.sample = {}
    this.events = []
    this._acc = 0
    this.reset(0, 0, 0)
  }

  reset(x, z, yaw) {
    const h = this.field.heightAt(x, z)
    this.pos.set(x, h - 0.06, z)
    this.vel.set(0, 0, 0)
    this.yaw = yaw
    this.yawRate = 0
    this.up.set(0, 1, 0)
    this.lean = 0
    this.mode = MODE.PRONE
    this.modeTime = 0
    this.stroke = 0
    this.strokeCount = 0
    this.canPop = false
    this.catchTime = 0
    this.popQueued = false
    this.rideWaveId = 0
    this.contact = true
    this.depth = 0
    this.speed = 0
    this.lateralG = 0
    this.air = { time: 0, spin: 0, height: 0, grab: 0, startY: 0 }
    this.wipe = null
    this.ollieCooldown = 0
    this.lipDanger = 0
    this.compress = 0
    this.events.length = 0
    this._acc = 0
    this.field.sample(x, z, this.sample)
  }

  queuePop() {
    this.popQueued = true
  }

  emit(type, data = {}) {
    this.events.push({ type, ...data })
  }

  update(dt) {
    this._acc += Math.min(dt, 0.1)
    while (this._acc >= STEP) {
      this._acc -= STEP
      this.step(STEP)
    }
  }

  wipeout(reason) {
    if (this.mode === MODE.WIPEOUT) return
    this.mode = MODE.WIPEOUT
    this.modeTime = 0
    this.wipe = {
      t: 0,
      reason,
      spinX: (Math.random() * 2 - 1) * 9,
      spinZ: (Math.random() * 2 - 1) * 7,
      rotX: 0,
      rotZ: 0,
      speed: this.speed,
    }
    this.emit('wipeout', { reason, speed: this.speed })
  }

  _surfaceFrame(S) {
    // Board-sized footprint: heights at nose, tail and both rails.
    const f = this.field
    const fx = Math.sin(this.yaw)
    const fz = Math.cos(this.yaw)
    const L = 0.95
    const W = 0.3
    const x = this.pos.x
    const z = this.pos.z
    const hN = f.heightAt(x + fx * L, z + fz * L)
    const hT = f.heightAt(x - fx * L, z - fz * L)
    const hL = f.heightAt(x + fz * W, z - fx * W)
    const hR = f.heightAt(x - fz * W, z + fx * W)
    _a.set(fx * 2 * L, hN - hT, fz * 2 * L)
    _b.set(fz * 2 * W, hL - hR, -fx * 2 * W)
    this.surfaceUp.crossVectors(_a, _b).normalize()
    if (this.surfaceUp.y < 0) this.surfaceUp.negate()
    // Blend in the fine normal so steep faces read correctly.
    this.surfaceUp.lerp(_n.set(S.nx, S.ny, S.nz), 0.35).normalize()
  }

  step(dt) {
    const S = this.field.sample(this.pos.x, this.pos.z, this.sample, this.rideWaveId)
    this.modeTime += dt
    this.ollieCooldown = Math.max(0, this.ollieCooldown - dt)
    const inp = this.input
    const n = _n.set(S.nx, S.ny, S.nz)
    const wv = _wv.set(S.vx, S.vy, S.vz)
    const depth = S.h - this.pos.y
    this.depth = depth
    const acc = _acc.set(0, -G, 0)
    const ff = _ff.set(Math.sin(this.yaw), 0, Math.cos(this.yaw))

    if (this.mode === MODE.WIPEOUT) {
      this._stepWipe(dt, S, depth, wv)
      return
    }

    if (this.mode === MODE.AIR) {
      this._stepAir(dt, S, depth, acc)
      return
    }

    // ----- In the water: prone, popping up or riding -----
    const riding = this.mode !== MODE.PRONE
    const fw = _fw.copy(ff).addScaledVector(n, -ff.dot(n)).normalize()
    const lat = _lat.crossVectors(n, fw)
    const rel = _rel.copy(this.vel).sub(wv)
    const vF = rel.dot(fw)
    const vL = rel.dot(lat)
    const vN = rel.dot(n)
    const contact = depth > -0.03
    this.contact = contact
    // Positive when the board's nose points downhill.
    const downSlope = -(S.slopeX * ff.x + S.slopeZ * ff.z)

    if (contact) {
      const k = riding ? 320 : 150
      const c = 2 * (riding ? 0.72 : 0.3) * Math.sqrt(k)
      const fb = Math.max(0, k * Math.max(depth, 0) - c * vN)
      acc.addScaledVector(n, Math.min(fb, 90))
      let dF
      let grip
      if (riding) {
        dF = 0.0125 * vF * Math.abs(vF) + 0.22 * ssign(vF) + inp.brake * (0.045 * vF * Math.abs(vF) + 0.9 * ssign(vF))
        grip = 7.0 + 3.0 * Math.abs(inp.steer)
      } else {
        dF = 0.2 * vF * Math.abs(vF) + 0.55 * vF
        grip = 2.4
      }
      acc.addScaledVector(fw, -dF).addScaledVector(lat, -grip * vL)
      this.lateralG = (grip * vL) / G
    }

    let targetYawRate = 0
    if (this.mode === MODE.PRONE) {
      targetYawRate = -inp.steer * 1.25
      if (inp.throttle > 0.05) {
        const prev = Math.floor(this.stroke)
        this.stroke += dt * 1.65
        if (Math.floor(this.stroke) !== prev) {
          this.strokeCount++
          this.emit('stroke', { side: this.strokeCount % 2 })
        }
        const ph = Math.sin(Math.PI * (this.stroke % 1))
        if (contact) acc.addScaledVector(fw, inp.throttle * 3.4 * (0.3 + 0.7 * ph * ph))
        // Paddling into a moving face: the wave helps once you match it.
        const onFaceZone = S.u > -1.5 && S.u < S.lf * 2.6 && S.amp > 0.7
        if (contact && onFaceZone && downSlope > 0.04) {
          acc.addScaledVector(fw, inp.throttle * 5.0 * clamp(downSlope * 2.8, 0, 1))
        }
      } else {
        this.stroke = Math.floor(this.stroke) + Math.max(0, (this.stroke % 1) - dt * 2)
      }
      const onFace = S.u > -1.0 && S.u < S.lf * 2.4 && downSlope > 0.08 && S.amp > 0.7
      this.canPop = onFace && this.vel.z > WAVE.speed * 0.6 && Math.hypot(this.vel.x, this.vel.z) > 4.2
      if (onFace && this.vel.z > WAVE.speed * 0.5) this.catchTime += dt
      else this.catchTime = Math.max(0, this.catchTime - dt * 2)
      if (this.popQueued) {
        this.popQueued = false
        if (this.canPop) {
          this.mode = MODE.POPUP
          this.modeTime = 0
          this.rideWaveId = S.waveId
          this.emit('popup')
        } else {
          this.emit('popfail')
        }
      } else if (this.catchTime > 2.8) {
        this.wipeout('Pearled — pop up sooner!')
        return
      }
    } else {
      // Popping up and riding.
      const speedF = Math.abs(vF)
      const auth = smoothstep(1.0, 5.5, speedF) * (1 + 0.6 * inp.brake) * (1 - 0.2 * inp.throttle)
      const popupScale = this.mode === MODE.POPUP ? 0.3 : 1
      targetYawRate = -inp.steer * 2.9 * auth * popupScale
      if (this.mode === MODE.POPUP && this.modeTime > 0.32) {
        this.mode = MODE.RIDING
        this.modeTime = 0
      }
      // Pumping: weight the front foot to draw speed out of the face.
      if (contact && inp.throttle > 0.05) {
        const onWave = smoothstep(0.08, 0.3, S.hn) * smoothstep(0.4, 1.0, S.amp)
        acc.addScaledVector(fw, inp.throttle * 2.6 * clamp(1 - this.speed / 16.5, 0, 1) * onWave)
      }
      // Face hold: near the crest the wave shoves you back down the face, so
      // a late top turn isn't an instant loss. Lingering still takes you over.
      if (contact && this.mode === MODE.RIDING && S.amp > 0.6 && S.u < 1.4 && S.u > -3) {
        const hold = Math.min(10, (1.4 - S.u) * 9) * smoothstep(0.3, 0.6, S.hn) * (1 - Math.min(1, this.lipDanger * 2.5))
        acc.z += hold
      }
      this.compress += ((inp.brake > 0.1 ? 1 : 0) + Math.abs(inp.steer) * 0.4 - this.compress) * (1 - Math.exp(-8 * dt))
      if (this.popQueued) {
        this.popQueued = false
        if (contact && this.ollieCooldown <= 0 && this.mode === MODE.RIDING) {
          this.vel.addScaledVector(n, 3.6)
          this.ollieCooldown = 0.6
          this.emit('ollie')
        }
      }
      if (contact) {
        if (S.broken > 0.55 && S.u > -5 && S.u < 5) {
          this.wipeout('Caught inside by the whitewater')
          return
        }
        // Lingering at the top as the lip pitches drags you over with it;
        // a quick snap off the lip is fine.
        if (S.curl > 0.45 && S.u > -2.2 && S.u < 0.35 && S.hn > 0.86) this.lipDanger += dt
        else this.lipDanger = Math.max(0, this.lipDanger - dt * 2)
        if (this.lipDanger > 0.35) {
          this.wipeout('Sucked over the falls')
          return
        }
      }
      // Leaving the water off the lip, or off a pop.
      if (this.mode === MODE.RIDING && ((depth < -0.14 && vN > 0.4) || depth < -0.32)) {
        this.mode = MODE.AIR
        this.modeTime = 0
        this.air = { time: 0, spin: 0, height: 0, grab: 0, startY: this.pos.y }
        this.emit('takeoff', { speed: this.speed })
        return
      }
    }

    this.yawRate += (targetYawRate - this.yawRate) * (1 - Math.exp(-10 * dt))
    this.yaw += this.yawRate * dt
    this.vel.addScaledVector(acc, dt)
    this.pos.addScaledVector(this.vel, dt)
    this.speed = this.vel.length()

    this._surfaceFrame(S)
    const rate = riding ? 14 : 5.5
    this.up.lerp(this.surfaceUp, 1 - Math.exp(-rate * dt)).normalize()
    const bank = riding ? clamp(Math.atan((this.speed * this.yawRate) / G) * 1.1, -0.95, 0.95) : inp.steer * 0.12
    this.lean += (-bank - this.lean) * (1 - Math.exp(-9 * dt))
  }

  _stepAir(dt, S, depth, acc) {
    const inp = this.input
    const v = this.vel.length()
    acc.addScaledVector(this.vel, -0.0025 * v)
    this.yawRate += (-inp.steer * 6.5 - this.yawRate) * (1 - Math.exp(-7 * dt))
    this.yaw += this.yawRate * dt
    this.air.time += dt
    this.air.spin += this.yawRate * dt
    this.air.height = Math.max(this.air.height, -depth)
    if (inp.grab) this.air.grab += dt
    this.vel.addScaledVector(acc, dt)
    this.pos.addScaledVector(this.vel, dt)
    this.speed = this.vel.length()
    this.contact = false
    // Keep the board roughly where it left the face, easing toward level.
    _up.set(0, 1, 0)
    this.up.lerp(_up, 1 - Math.exp(-1.5 * dt)).normalize()
    this.lean += (0 - this.lean) * (1 - Math.exp(-4 * dt))
    if (depth > 0) this._land(S)
  }

  _land(S) {
    const velYaw = Math.atan2(this.vel.x, this.vel.z)
    const diff = wrapAngle(this.yaw - velYaw)
    const n = _n.set(S.nx, S.ny, S.nz)
    const impact = _rel.copy(this.vel).sub(_wv.set(S.vx, S.vy, S.vz)).dot(n)
    const air = { ...this.air }
    let reverse = false
    if (Math.abs(diff) > 2.25) {
      reverse = true
      this.yaw = velYaw + wrapAngle(this.yaw + Math.PI - velYaw) * 0.3
    } else if (Math.abs(diff) > 1.0) {
      this.wipeout('Landed sideways')
      return
    }
    if (impact < -12.5) {
      this.wipeout('Flat landing')
      return
    }
    // Absorb the landing through the legs.
    this.vel.addScaledVector(n, -impact * 0.7)
    this.mode = MODE.RIDING
    this.modeTime = 0
    this.yawRate *= 0.2
    this.compress = 1
    this.emit('land', { ...air, reverse, impact })
  }

  _stepWipe(dt, S, depth, wv) {
    const w = this.wipe
    w.t += dt
    // A tumbling body: weakly buoyant, dragged along by the moving water.
    const k = 26
    const c = 7
    const target = 0.45 * Math.exp(-w.t * 0.5)
    const fb = k * (depth - target) - c * (this.vel.y - wv.y)
    this.vel.y += (fb - G * 0.15) * dt
    const drag = 1 - Math.exp(-2.2 * dt)
    this.vel.x += (wv.x - this.vel.x) * drag
    this.vel.z += (wv.z * 0.8 - this.vel.z) * drag
    this.pos.addScaledVector(this.vel, dt)
    const decay = Math.exp(-1.2 * dt)
    w.spinX *= decay
    w.spinZ *= decay
    w.rotX += w.spinX * dt
    w.rotZ += w.spinZ * dt
    this.speed = this.vel.length()
    this.contact = true
    this.depth = depth
    this.lean *= decay
  }
}
