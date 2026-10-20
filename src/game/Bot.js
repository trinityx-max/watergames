// A surfer that drives the board through the same inputs a player uses.
// Used for the attract mode behind the menu.

import { MODE, wrapAngle } from '../physics/Board.js'
import { WAVE } from '../config.js'

export class Bot {
  constructor() {
    this.t = 0
    this.dir = 1
  }

  reset(dir) {
    this.dir = dir
    this.t = 0
    this.phase = undefined
  }

  drive(board, dt) {
    this.t += dt
    const S = board.sample
    const inp = board.input
    inp.steer = 0
    inp.throttle = 0
    inp.brake = 0
    inp.grab = false
    if (board.mode === MODE.PRONE) {
      if (S.u < 14 && S.u > -6) inp.throttle = 1
      if (board.canPop) board.queuePop()
      return
    }
    if (board.mode === MODE.AIR) {
      inp.grab = true
      return
    }
    if (board.mode !== MODE.RIDING && board.mode !== MODE.POPUP) return
    // Surf in arcs: drop to the bottom, bottom turn back up the face, hit
    // the top, and come back down. Each phase holds a target line angle
    // (positive = down the face).
    const sp = Math.max(board.speed, 4)
    const trim = Math.asin(Math.min(1, WAVE.speed / sp)) * 0.85
    if (board.mode === MODE.POPUP || this.phase === undefined) {
      this.phase = 'trim'
      this.rideT = 0
    }
    this.rideT += dt
    // Build speed down the line before the first turn.
    if (this.phase === 'trim' && board.speed > 9.5 && this.rideT > 1.5) this.phase = 'drop'
    // Current line angle below the crest line (positive = heading down).
    const thNow = Math.atan2(Math.cos(board.yaw), this.dir * Math.sin(board.yaw))
    if (this.phase === 'drop' && board.speed > 8 && S.curl < 0.25 && (S.hn < 0.38 || S.u > 4.6)) this.phase = 'up'
    else if (this.phase === 'up' && (S.hn > 0.68 || S.u < (S.curl > 0.2 ? 3.4 : 2.2))) this.phase = 'down'
    else if (this.phase === 'down' && thNow > trim) this.phase = 'drop'
    // Near the curl keep it safer: no climbing into the lip.
    if (S.curl > 0.3 && S.u < 1.8 && this.phase !== 'trim') this.phase = 'drop'
    let th
    if (this.phase === 'trim') th = trim + 0.2 * (2.8 - S.u)
    else if (this.phase === 'drop') th = trim + 0.2
    else if (this.phase === 'up') th = -0.15
    else th = trim + 0.55
    th = Math.max(-0.75, Math.min(1.4, th))
    const yawDes = Math.atan2(this.dir * Math.cos(th), Math.sin(th))
    inp.steer = Math.max(-1, Math.min(1, -wrapAngle(yawDes - board.yaw) * 3))
    if (S.s < 8 || board.speed < 9) inp.throttle = 1
    // Falling behind the pocket: flatten the line to make ground.
    if (S.s < 3 && this.phase !== 'up') inp.steer = Math.max(-1, Math.min(1, -wrapAngle(Math.atan2(this.dir * Math.cos(trim * 0.7), Math.sin(trim * 0.7)) - board.yaw) * 3))
    if (S.s > 45) inp.brake = 0.5
  }
}
