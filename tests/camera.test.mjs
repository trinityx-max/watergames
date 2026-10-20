import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PerspectiveCamera } from 'three'
import { WaveField } from '../src/waves/WaveField.js'
import { Board, MODE } from '../src/physics/Board.js'
import { Bot } from '../src/game/Bot.js'
import { RideScore } from '../src/game/Scoring.js'
import { CameraRig } from '../src/game/CameraRig.js'

// Rides the bot with the real chase camera and counts frames where the
// camera is buried in water, inside the lip sheet, or inside a barrel the
// rider isn't in.
function cameraRun(offset) {
  const field = new WaveField()
  field.spawn({ xPeak: 0, delay: 9 })
  field.update(0)
  const board = new Board(field)
  board.reset(offset, 0, 0)
  const dir = Math.sign(offset)
  const bot = new Bot()
  bot.reset(dir)
  const ride = new RideScore(null, dir)
  const rig = new CameraRig(new PerspectiveCamera(62, 16 / 9, 0.1, 9000), field)
  const stats = { frames: 0, buried: 0, inLip: 0, inTube: 0 }
  const dt = 1 / 60
  for (let t = 0; t < 30; t += dt) {
    bot.drive(board, dt)
    field.update(dt)
    board.update(dt)
    board.events.length = 0
    ride.update(dt, board)
    rig.update(dt, board, { side: dir, dir })
    if (board.mode === MODE.WIPEOUT) break
    if (board.mode === MODE.PRONE) continue
    const p = rig.camera.position
    stats.frames++
    if (p.y < field.heightAt(p.x, p.z) + 0.3) stats.buried++
    const c = field.lipCeiling(p.x, p.z)
    if (c < Infinity && p.y < field.lipTop) {
      if (p.y > c - 0.2) stats.inLip++
      else if (!board.inTube) stats.inTube++
    }
  }
  return stats
}

test('the chase camera stays clear of the water and the lip', () => {
  const total = { frames: 0, buried: 0, inLip: 0, inTube: 0 }
  for (const off of [-6, -8, -10, 7, 9, 11]) {
    const s = cameraRun(off)
    for (const k in total) total[k] += s[k]
  }
  assert.ok(total.frames > 3000, `too few riding frames: ${total.frames}`)
  assert.equal(total.buried, 0)
  assert.ok(total.inLip / total.frames < 0.01, `camera inside the lip ${total.inLip}/${total.frames}`)
  assert.ok(total.inTube / total.frames < 0.02, `camera in a barrel without the rider ${total.inTube}/${total.frames}`)
})
