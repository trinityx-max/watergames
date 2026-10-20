// Decides where the sea throws water: rail spray off a carving board, mist
// blown back off the pitching lip, the explosion where the lip lands, chunks
// tumbling in the whitewater, and one-shot bursts for game events.

import { WAVE } from '../config.js'
import { waveShape } from '../waves/WaveField.js'
import { MODE } from '../physics/Board.js'

const R = Math.random

export class Effects {
  constructor(spray, field, budget = 1) {
    this.spray = spray
    this.field = field
    this.budget = budget
    this._d = {}
    this._acc = { rail: 0, lip: 0, crash: 0, bore: 0 }
  }

  lipPoint(w, x, b) {
    const L = this.field.lipAt(w, x, this._lip || (this._lip = {}))
    const phi = b * L.phiMax
    return [x, L.crestH - L.Ry * (1 - Math.cos(phi)), L.zc + L.Rz * Math.sin(phi), L.zc, L.crestH]
  }

  update(dt, board, camera) {
    const sp = this.spray
    const f = this.field
    const k = this.budget
    const cx = camera.position.x
    const cz = camera.position.z

    // Rail spray from the board.
    if ((board.mode === MODE.RIDING || board.mode === MODE.POPUP) && board.contact) {
      const carve = Math.min(1, Math.abs(board.lateralG) * 0.6 + Math.abs(board.yawRate) * 0.25)
      const rate = (board.speed > 5 ? board.speed * 4 : 0) + carve * board.speed * 14
      this._acc.rail += rate * dt * k
      const fx = Math.sin(board.yaw)
      const fz = Math.cos(board.yaw)
      const lx = fz
      const lz = -fx
      const side = -Math.sign(board.yawRate || 1)
      while (this._acc.rail > 1) {
        this._acc.rail -= 1
        const out = (1.5 + R() * 3.5) * (0.4 + carve)
        const up = 1.2 + R() * 3.2 * (0.4 + carve)
        const back = -0.3 - R() * 0.6
        sp.emit(
          board.pos.x + fx * back + lx * side * 0.28,
          board.pos.y + 0.05,
          board.pos.z + fz * back + lz * side * 0.28,
          lx * side * out + board.vel.x * 0.35 - fx * R(),
          up,
          lz * side * out + board.vel.z * 0.35 - fz * R(),
          0.05 + R() * 0.09 * (0.5 + carve),
          0.5 + R() * 0.6,
          R() < 0.25 ? 1 : 0,
          0.9,
          1,
        )
      }
    }

    // The breaking parts of every wave.
    const d = this._d
    for (const w of f.waves) {
      if (w.bk < 0.05 || w.amp < 0.4) continue
      for (const side of [1, -1]) {
        const xb = side > 0 ? w.xbR : w.xbL
        const dist = Math.hypot(xb - cx, w.zc - cz)
        if (dist > 220) continue
        const near = Math.max(0.15, 1 - dist / 220) * k
        // Mist peeled off the top of the lip by the offshore wind.
        this._acc.lip += dt * 70 * near * w.bk
        while (this._acc.lip > 1) {
          this._acc.lip -= 1
          const x = xb + side * (-10 + R() * 16)
          const dx = x - w.xPeak
          const zc = w.zc - WAVE.curvature * dx * dx
          waveShape(w, x, zc, d)
          if (d.curl < 0.2 && d.steep < 0.3) continue
          const h = f.heightAt(x, zc)
          sp.emit(x, h + 0.1, zc - 0.2, (R() - 0.5) * 1.5, 1.6 + R() * 2.4, -2.5 - R() * 4, 0.35 + R() * 0.5, 1.0 + R() * 1.2, 1, 0.8, 0.12)
        }
        // Droplets falling from the lip edge.
        this._acc.crash += dt * 90 * near * w.bk
        while (this._acc.crash > 1) {
          this._acc.crash -= 1
          const s = -13 + R() * 14
          const x = xb + side * s
          const dx = x - w.xPeak
          waveShape(w, x, w.zc - WAVE.curvature * dx * dx, d)
          if (d.curl < 0.25) continue
          if (s < -5) {
            // Where the lip lands: an explosion of white.
            const [, , , zc] = this.lipPoint(w, x, 1)
            const h = f.heightAt(x, zc + 3.2)
            sp.emit(x + (R() - 0.5), h + 0.2, zc + 3.2 + (R() - 0.5) * 1.5, (R() - 0.5) * 2.5, 2.5 + R() * 5, WAVE.speed * 0.6 + R() * 3, 0.35 + R() * 0.6, 0.8 + R() * 0.8, R() < 0.4 ? 1 : 0, 0.7, 0.9)
          } else {
            const p = this.lipPoint(w, x, 0.85 + R() * 0.15)
            sp.emit(p[0], p[1], p[2], (R() - 0.5) * 0.8, -0.5 - R(), WAVE.speed * 0.8, 0.05 + R() * 0.07, 0.5 + R() * 0.4, 0, 0.3, 1)
          }
        }
      }
      // Whitewater chunks along the bore between the two break points.
      if (w.xbR - w.xbL > 6) {
        this._acc.bore += dt * 60 * k
        while (this._acc.bore > 1) {
          this._acc.bore -= 1
          const x = cx + (R() - 0.5) * 140
          if (x < w.xbL + 8 || x > w.xbR - 8) continue
          const dx = x - w.xPeak
          const zc = w.zc - WAVE.curvature * dx * dx
          if (Math.abs(zc - cz) > 160) continue
          const z = zc + 0.5 + R() * 3
          const h = f.heightAt(x, z)
          sp.emit(x, h + 0.1, z, (R() - 0.5) * 1.5, 1 + R() * 2.5, WAVE.speed * 0.7 + R() * 1.5, 0.35 + R() * 0.5, 0.6 + R() * 0.6, R() < 0.5 ? 1 : 0, 0.8, 0.8)
        }
      }
    }
  }

  burst(board, kind) {
    const p = board.pos
    const sp = this.spray
    const k = this.budget
    if (kind === 'popup') sp.burst(p.x, p.y + 0.1, p.z, 24 * k, 2.5, 2.5, 0.2, 0.8)
    else if (kind === 'land') sp.burst(p.x, p.y + 0.1, p.z, 60 * k, 4, 4, 0.28, 1.2)
    else if (kind === 'wipeout') {
      sp.burst(p.x, p.y + 0.2, p.z, 140 * k, 5, 6, 0.35, 1.6)
      for (let i = 0; i < 26 * k; i++) sp.emit(p.x + (R() - 0.5) * 2, p.y + 0.5, p.z + (R() - 0.5) * 2, (R() - 0.5) * 2, 1 + R() * 2, (R() - 0.5) * 2, 0.5 + R() * 0.6, 1.4 + R(), 1, 0.9, 0.08)
    } else if (kind === 'stroke') {
      const fx = Math.sin(board.yaw)
      const fz = Math.cos(board.yaw)
      const side = board.strokeCount % 2 ? 1 : -1
      const x = p.x + fz * side * 0.42 + fx * 0.2
      const z = p.z - fx * side * 0.42 + fz * 0.2
      for (let i = 0; i < 10 * k; i++) sp.emit(x, p.y + 0.05, z, fz * side * R() - fx * R() * 1.5, 0.6 + R() * 1.4, -fx * side * R() - fz * R() * 1.5, 0.08 + R() * 0.08, 0.5 + R() * 0.3, 0, 1, 1)
    } else if (kind === 'snap') {
      const fx = Math.sin(board.yaw)
      const fz = Math.cos(board.yaw)
      for (let i = 0; i < 70 * k; i++) {
        const a = (R() - 0.5) * 1.6
        const dirx = fz * Math.cos(a) - fx * Math.sin(a)
        const dirz = -fx * Math.cos(a) - fz * Math.sin(a)
        const side = -Math.sign(board.yawRate || 1)
        const s = 3 + R() * 5
        sp.emit(p.x, p.y + 0.1, p.z, dirx * side * s, 2.5 + R() * 4.5, dirz * side * s, 0.06 + R() * 0.14, 0.7 + R() * 0.6, R() < 0.3 ? 1 : 0, 0.8, 1)
      }
    }
  }
}
