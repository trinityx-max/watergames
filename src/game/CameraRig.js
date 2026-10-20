import { Vector3 } from 'three'
import { MODE, wrapAngle } from '../physics/Board.js'
import { WAVE } from '../config.js'

const smooth = (rate, dt) => 1 - Math.exp(-rate * dt)

export class CameraRig {
  constructor(camera, field) {
    this.camera = camera
    this.field = field
    this.pos = new Vector3(0, 4, -10)
    this.look = new Vector3()
    this.yaw = 0
    this.fov = 62
    this.roll = 0
    this.shake = 0
    this.mode = 'chase'
    this.shot = 0
    this.shotTime = 0
    this.lookBack = 1
    this.under = 0
    this._t = new Vector3()
    this._l = new Vector3()
    this.snap = true
  }

  addShake(a) {
    this.shake = Math.min(1.5, this.shake + a)
  }

  cut() {
    this.snap = true
  }

  update(dt, board, opts = {}) {
    const S = board.sample
    const field = this.field
    const t = this._t
    const l = this._l
    const speed = Math.hypot(board.vel.x, board.vel.z)
    // Follow motion relative to the moving wave, so the camera tracks down
    // the line instead of drifting over the back of the crest.
    const standing = board.mode !== MODE.PRONE && board.mode !== MODE.WIPEOUT
    const onWave = standing && S.amp > 0.5 ? 1 : 0
    const rx = board.vel.x
    const rz = board.vel.z - WAVE.speed * 0.92 * onWave
    const rel = Math.hypot(rx, rz)
    let travel
    if (standing) {
      const lineYaw = (opts.dir || 1) > 0 ? Math.PI / 2 : -Math.PI / 2
      travel = rel > 2.5 ? Math.atan2(rx, rz) : lineYaw
      travel += wrapAngle(board.yaw - travel) * 0.15
    } else travel = speed > 2.5 ? Math.atan2(board.vel.x, board.vel.z) : board.yaw
    this.yaw += wrapAngle(travel - this.yaw) * smooth(standing ? 2.6 : 1.2, dt)
    const fx = Math.sin(this.yaw)
    const fz = Math.cos(this.yaw)
    const P = board.pos
    let fov = 60 + Math.min(14, speed * 0.85)
    let posRate = 4.5
    let lookRate = 7

    if (this.mode === 'cinematic') {
      this.shotTime += dt
      if (this.shotTime > (opts.shotLength || 7)) {
        this.shotTime = 0
        this.shot = (this.shot + 1) % 4
        this.snap = true
      }
      const dir = Math.sign(board.vel.x) || 1
      if (this.shot === 0) {
        t.set(P.x + dir * 9, P.y + 0.9, P.z + 13)
        l.set(P.x - dir * 1.5, P.y + 0.6, P.z - 1)
        fov = 54
      } else if (this.shot === 1) {
        t.set(P.x - fx * 6.5, P.y + 2.2, P.z - fz * 6.5 - 1.5)
        l.set(P.x + fx * 6, P.y + 0.4, P.z + fz * 6)
      } else if (this.shot === 2) {
        t.set(P.x - dir * 5.5, P.y + 1.4, P.z - 0.8)
        l.set(P.x + dir * 4, P.y + 0.7, P.z + 0.6)
        fov = 70
      } else {
        const a = this.shotTime * 0.08
        t.set(P.x - dir * 14 + Math.sin(a) * 6, P.y + 18, P.z + 16)
        l.set(P.x + dir * 4, P.y, P.z)
        fov = 50
      }
      if (board.mode === MODE.PRONE) {
        t.set(P.x + 7, P.y + 2.5, P.z + 9)
        l.set(P.x - 2, P.y + 1, P.z - 14)
      }
      posRate = 2.2
      lookRate = 4
    } else {
      // Paddling: look back at the swell rising behind you; swing behind the
      // rider as the wave arrives.
      const prone = board.mode === MODE.PRONE
      const back = prone ? Math.min(1, Math.max(0, (S.u - 3) / 12)) : 0
      this.lookBack += (back - this.lookBack) * smooth(prone ? 1.6 : 3, dt)
      const lb = this.lookBack
      const tube = board.inTube ? 1 : 0
      const curlNow = Math.min(1, S.curl * 1.6)
      const dist = 6.4 + speed * 0.12 - tube * 1.6
      const height = 1.7 + speed * 0.05 - curlNow * 0.5 + (board.mode === MODE.AIR ? 0.8 : 0)
      // Behind the rider down the line, eased toward the beach so the face
      // and the lip stay in frame.
      // The hollower the wave at the rider, the further we stand off the face
      // so we look into the barrel instead of over the lip.
      const hollow = Math.min(1, S.curl * 1.6)
      const shore = onWave * (2.0 + 3.4 * hollow)
      // Place the camera in the wave's frame: back along the line, and a fixed
      // stand-off toward the beach regardless of how the rider angles.
      const chase = new Vector3(P.x - fx * dist, P.y + height, P.z - fz * dist * (1 - 0.7 * onWave) + shore)
      const chaseLook = new Vector3(P.x + fx * 4, P.y + 0.6, P.z + fz * 4 - shore * 0.15)
      const side = opts.side || 1
      const front = new Vector3(P.x + side * 4.5, P.y + 2.3, P.z + 7.5)
      const frontLook = new Vector3(P.x - side * 1, P.y + 1.2, P.z - 10)
      t.copy(chase).lerp(front, lb)
      l.copy(chaseLook).lerp(frontLook, lb)
      if (board.mode === MODE.WIPEOUT) {
        t.copy(this.pos)
        const w = board.wipe ? board.wipe.t : 0
        if (w > 0.3 && w < 1.4) t.y = Math.min(t.y, P.y - 0.4)
        l.copy(P)
        posRate = 1.5
      }
      fov += tube * 6
    }

    // Keep the camera out of the barrel unless the rider is in it: then tuck
    // under the lip for the view down the tube. Otherwise step out in front.
    const tuck = board.inTube && this.mode !== 'cinematic'
    for (let i = 0; i < 24; i++) {
      const c = field.lipCeiling(t.x, t.z)
      if (c === Infinity || t.y > field.lipTop) break
      if (tuck) {
        if (t.y < c - 0.6) break
        if (c - 0.6 > field.heightAt(t.x, t.z) + 0.6) {
          t.y = c - 0.6
          break
        }
      }
      t.z += 0.8
    }

    if (this.snap) {
      this.pos.copy(t)
      this.look.copy(l)
      this.snap = false
    } else {
      this.pos.lerp(t, smooth(posRate, dt))
      this.look.lerp(l, smooth(lookRate, dt))
    }
    const ceil = field.lipCeiling(this.pos.x, this.pos.z)
    if (ceil < Infinity && this.pos.y > ceil - 0.45 && this.pos.y < field.lipTop) {
      // Easing in toward the target crossed the lip sheet: clear it this frame.
      const floor = field.heightAt(this.pos.x, this.pos.z) + 0.5
      if (tuck && ceil - 0.45 > floor) this.pos.y = ceil - 0.45
      else this.pos.y = field.lipTop
    }
    const surf = field.heightAt(this.pos.x, this.pos.z)
    const allowUnder = board.mode === MODE.WIPEOUT && this.mode !== 'cinematic'
    if (!allowUnder && this.pos.y < surf + 0.7) this.pos.y = surf + 0.7
    this.under = this.pos.y < surf - 0.05 ? 1 : 0

    this.shake = Math.max(0, this.shake - dt * 1.6)
    const s = this.shake * this.shake * 0.15
    const time = performance.now() * 0.001
    this.camera.position.copy(this.pos)
    this.camera.position.x += Math.sin(time * 37) * s
    this.camera.position.y += Math.sin(time * 43 + 1) * s
    this.camera.lookAt(this.look)
    const rollTarget = this.mode === 'cinematic' ? 0 : -board.lean * 0.18
    this.roll += (rollTarget - this.roll) * smooth(3, dt)
    this.camera.rotateZ(this.roll)
    this.fov += (fov - this.fov) * smooth(2.5, dt)
    if (Math.abs(this.camera.fov - this.fov) > 0.01) {
      this.camera.fov = this.fov
      this.camera.updateProjectionMatrix()
    }
  }
}
