// Turns telemetry into tricks. Turns are classified by where on the face they
// happen; tricks chain into a combo that only banks when the chain ends, so a
// wipeout costs you whatever you hadn't banked yet.

import { MODE } from '../physics/Board.js'
import { judgeScore } from '../config.js'

const DEG = 180 / Math.PI

export class RideScore {
  constructor(onTrick, rideDir) {
    this.onTrick = onTrick
    this.rideDir = rideDir || 1
    this.banked = 0
    this.speedPoints = 0
    this.combo = { points: 0, count: 0, timer: 0 }
    this.tricks = []
    this.turn = null
    this.calm = 0
    this.tube = { time: 0, active: false, best: 0, cooldown: 0 }
    this.repeat = {}
    this.time = 0
    this.maxSpeed = 0
    this.topTrick = null
  }

  get multiplier() {
    return Math.min(5, 1 + 0.5 * Math.max(0, this.combo.count - 1))
  }

  get live() {
    return Math.round(this.banked + this.speedPoints + this.combo.points * this.multiplier)
  }

  add(name, points, big = false) {
    const n = (this.repeat[name] = (this.repeat[name] || 0) + 1)
    const pts = Math.round(points * Math.pow(0.78, n - 1))
    this.combo.points += pts
    this.combo.count++
    this.combo.timer = 2.8
    const t = { name, points: pts, mult: this.multiplier }
    this.tricks.push(t)
    if (!this.topTrick || pts > this.topTrick.points) this.topTrick = t
    this.onTrick?.({ name, points: pts, combo: this.combo.count, mult: this.multiplier, big })
  }

  bank() {
    if (this.combo.count === 0) return
    this.banked += this.combo.points * this.multiplier
    this.combo.points = 0
    this.combo.count = 0
    this.combo.timer = 0
  }

  update(dt, board) {
    const S = board.sample
    this.time += dt
    this.maxSpeed = Math.max(this.maxSpeed, board.speed)
    if (this.combo.count > 0) {
      this.combo.timer -= dt
      if (this.combo.timer <= 0) this.bank()
    }
    const riding = board.mode === MODE.RIDING
    if (riding && board.contact && board.speed > 9) this.speedPoints += (board.speed - 9) * 16 * dt

    // Barrel time.
    const inTube = riding && board.contact && S.curl > 0.5 && S.u > 0.2 && S.u < 3.4 && S.s < 2.5
    board.inTube = inTube
    if (inTube) {
      this.tube.active = true
      this.tube.time += dt
      this.tube.cooldown = 0.35
    } else if (this.tube.active) {
      this.tube.cooldown -= dt
      if (this.tube.cooldown <= 0 || board.mode === MODE.WIPEOUT) {
        if (board.mode !== MODE.WIPEOUT && this.tube.time > 0.45) {
          const t = this.tube.time
          this.add(t > 2.5 ? `Deep Barrel ${t.toFixed(1)}s` : `Barrel ${t.toFixed(1)}s`, 350 + 520 * t, true)
        }
        this.tube.best = Math.max(this.tube.best, this.tube.time)
        this.tube.active = false
        this.tube.time = 0
      }
    }

    // Turn detection on the face.
    if (riding && board.contact && board.speed > 4) {
      const r = board.yawRate
      if (Math.abs(r) > 0.85) {
        if (!this.turn || Math.sign(r) !== this.turn.sign) {
          this._finishTurn(board)
          this.turn = { sign: Math.sign(r), angle: 0, t: 0, hn: 0, speed: 0, startYaw: board.yaw, maxCurl: 0 }
        }
        const tr = this.turn
        tr.angle += Math.abs(r) * dt
        tr.t += dt
        tr.hn += S.hn * dt
        tr.speed += board.speed * dt
        tr.maxCurl = Math.max(tr.maxCurl, S.curl)
        this.calm = 0
      } else if (this.turn) {
        this.calm += dt
        if (this.calm > 0.14) this._finishTurn(board)
      }
    } else if (this.turn) this._finishTurn(board)
  }

  _finishTurn(board) {
    const tr = this.turn
    this.turn = null
    this.calm = 0
    if (!tr || tr.t <= 0) return
    const deg = tr.angle * DEG
    const hn = tr.hn / tr.t
    const speed = tr.speed / tr.t
    if (deg < 50 || speed < 5.5) return
    // Heading now back toward the breaking part of the wave?
    const fx = Math.sin(board.yaw)
    const towardPocket = -fx * this.rideDir > 0.35
    let name
    let base
    if (deg >= 150 && towardPocket) {
      name = deg >= 260 ? 'Roundhouse Cutback' : 'Cutback'
      base = deg >= 260 ? 640 : 400
    } else if (hn > 0.72) {
      if (tr.maxCurl > 0.4) {
        name = 'Re-entry'
        base = 440
      } else if (tr.t < 0.75) {
        name = 'Snap'
        base = 330
      } else {
        name = 'Top Turn'
        base = 210
      }
    } else if (hn < 0.4) {
      name = 'Bottom Turn'
      base = 95
    } else {
      name = 'Carve'
      base = 160
    }
    const pts = base * Math.pow(deg / 90, 1.1) * Math.min(1.8, Math.max(0.5, speed / 10))
    this.add(name, pts, base >= 400)
  }

  onBoardEvent(e) {
    if (e.type === 'land') {
      if (e.time < 0.28) return
      const deg = Math.abs(e.spin) * DEG
      const rot = Math.round(deg / 180) * 180
      let name = 'Air'
      if (rot >= 720) name = 'Air 720'
      else if (rot >= 540) name = 'Air 540'
      else if (rot >= 360) name = 'Air 360'
      else if (e.reverse || rot >= 180) name = 'Air Reverse'
      const grabbed = e.grab > 0.25
      if (grabbed) name = (rot >= 360 ? 'Grab ' : 'Indy ') + name
      const pts = (260 + 700 * e.time + 200 * e.height + rot * 2.2) * (grabbed ? 1.25 : 1)
      this.add(name, pts, true)
    }
  }

  wipeout() {
    this._finishTurn({ yaw: 0 })
    const lost = Math.round(this.combo.points * this.multiplier)
    for (let i = this.tricks.length - this.combo.count; i < this.tricks.length; i++) if (this.tricks[i]) this.tricks[i].lost = true
    this.combo.points = 0
    this.combo.count = 0
    return lost
  }

  finish(completed) {
    this._finishTurn({ yaw: 0 })
    if (this.tube.active && this.tube.time > 0.45) this.add(`Barrel ${this.tube.time.toFixed(1)}s`, 350 + 520 * this.tube.time, true)
    this.bank()
    if (completed) this.banked += 600
    const points = Math.round(this.banked + this.speedPoints)
    return {
      points,
      score: judgeScore(points),
      tricks: this.tricks.slice(),
      completed,
      maxSpeed: this.maxSpeed,
      tube: Math.max(this.tube.best, this.tube.time),
      time: this.time,
      top: this.topTrick,
    }
  }
}
