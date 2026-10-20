// Headless surf bot used by the tests: paddles into a wave, pops up and trims
// down the line toward the open shoulder.
import { WaveField } from '../src/waves/WaveField.js'
import { Board, MODE, wrapAngle } from '../src/physics/Board.js'
import { WAVE } from '../src/config.js'

export function simulateRide({ seconds = 40, offset = 10, log = false, aim = 2.4, startZ = 0 } = {}) {
  const field = new WaveField()
  const wave = field.spawn({ xPeak: 0, delay: 9 })
  field.update(0)
  const board = new Board(field)
  board.reset(offset, startZ, 0)
  const dir = Math.sign(offset) || 1
  const dt = 1 / 60
  const stats = { caught: false, popTime: -1, rideTime: 0, end: 'timeout', maxSpeed: 0, speedSum: 0, airs: 0, samples: [] }
  for (let t = 0; t < seconds; t += dt) {
    const S = board.sample
    const inp = board.input
    inp.steer = 0; inp.throttle = 0; inp.brake = 0
    if (board.mode === MODE.PRONE) {
      if (S.u < 14 && S.u > -6) inp.throttle = 1
      if (board.canPop) board.queuePop()
      if (S.u < -12 && t > 12) { stats.end = 'missed'; break }
    } else if (board.mode === MODE.RIDING || board.mode === MODE.POPUP) {
      if (!stats.caught) { stats.caught = true; stats.popTime = t }
      stats.rideTime += dt
      const sp = Math.max(board.speed, 4)
      const theta = Math.asin(Math.min(1, WAVE.speed / sp)) * 0.85 + 0.3 * (aim - S.u)
      const th = Math.max(-0.6, Math.min(1.3, theta))
      const yawDes = Math.atan2(dir * Math.cos(th), Math.sin(th))
      inp.steer = Math.max(-1, Math.min(1, -wrapAngle(yawDes - board.yaw) * 2.5))
      if (S.s < 6) inp.throttle = 1
      stats.maxSpeed = Math.max(stats.maxSpeed, board.speed)
      stats.speedSum += board.speed * dt
      if (S.u < -8) { stats.end = 'wave passed'; break }
    } else if (board.mode === MODE.WIPEOUT) {
      stats.end = 'wipeout: ' + board.wipe.reason; break
    }
    for (const e of board.events) if (e.type === 'land') stats.airs++
    board.events.length = 0
    field.update(dt)
    board.update(dt)
    if (!Number.isFinite(board.pos.x + board.pos.y + board.pos.z)) { stats.end = 'NaN'; break }
    if (log && Math.round(t * 60) % 30 === 0) stats.samples.push(`${t.toFixed(1)}s ${board.mode} u=${S.u.toFixed(1)} s=${S.s.toFixed(1)} spd=${board.speed.toFixed(1)} vz=${board.vel.z.toFixed(1)} y=${board.pos.y.toFixed(2)} h=${S.h.toFixed(2)} hn=${S.hn.toFixed(2)} yaw=${board.yaw.toFixed(2)} amp=${S.amp.toFixed(2)}`)
  }
  stats.avgSpeed = stats.rideTime > 0 ? stats.speedSum / stats.rideTime : 0
  return stats
}
