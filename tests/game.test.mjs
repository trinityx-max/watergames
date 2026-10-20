import { test } from 'node:test'
import assert from 'node:assert/strict'
import { WaveField, CHOP_TABLE } from '../src/waves/WaveField.js'
import { waveGLSL } from '../src/waves/waveGLSL.js'
import { Board, MODE } from '../src/physics/Board.js'
import { RideScore } from '../src/game/Scoring.js'
import { judgeScore, WAVE } from '../src/config.js'
import { simulateRide } from './simlib.mjs'
import { botRide } from './botstats.mjs'

test('wave field is finite and shaped like a wave', () => {
  const f = new WaveField()
  const w = f.spawn({ xPeak: 0, delay: 1 })
  f.update(2)
  let maxH = -Infinity
  for (let z = w.zc - 30; z < w.zc + 30; z += 0.25) {
    const h = f.heightAt(0, z)
    assert.ok(Number.isFinite(h))
    maxH = Math.max(maxH, h)
  }
  assert.ok(maxH > WAVE.height * 0.6, `crest too low: ${maxH}`)
  // The front face is steeper than the back.
  const front = f.heightAt(0, w.zc + 2) - f.heightAt(0, w.zc + 4)
  const back = f.heightAt(0, w.zc - 2) - f.heightAt(0, w.zc - 4)
  assert.ok(front > back)
})

test('waves break from the peak and peel both ways', () => {
  const f = new WaveField()
  const w = f.spawn({ xPeak: 10, delay: 2 })
  for (let i = 0; i < 300; i++) f.update(1 / 60)
  assert.ok(w.bk > 0.9, 'wave should be breaking')
  assert.ok(w.xbR > 10 && w.xbL < 10)
  const S = f.sample(10, w.zc + 1, {})
  assert.ok(S.broken > 0.3, 'between the break points is whitewater')
  const T = f.sample(w.xbR + 30, w.zc + 1, {})
  assert.equal(T.broken, 0)
})

test('GLSL mirror carries the same constants as the CPU model', () => {
  for (const c of CHOP_TABLE) assert.ok(waveGLSL.includes(c[2].toPrecision(8)))
  assert.ok(waveGLSL.includes(`W_FACE_POCKET = ${WAVE.faceLenPocket}`))
  assert.ok(waveGLSL.includes('float oceanHeight(vec2 p)'))
})

test('a board left alone floats and bobs without drifting off', () => {
  const f = new WaveField()
  const b = new Board(f)
  b.reset(0, 0, 0)
  for (let i = 0; i < 600; i++) {
    f.update(1 / 60)
    b.update(1 / 60)
  }
  assert.equal(b.mode, MODE.PRONE)
  assert.ok(Math.abs(b.pos.y - f.heightAt(b.pos.x, b.pos.z)) < 0.3)
  assert.ok(Math.hypot(b.pos.x, b.pos.z) < 3)
})

test('paddling into a wave catches it and the ride lasts', () => {
  const r = simulateRide({ seconds: 40 })
  assert.ok(r.caught, 'should catch the wave')
  assert.ok(r.rideTime > 20, `ride too short: ${r.rideTime}`)
  assert.ok(r.maxSpeed > 9 && r.maxSpeed < 22, `speed out of range: ${r.maxSpeed}`)
})

test('the attract bot rides most waves to the end', () => {
  let complete = 0
  for (let i = 0; i < 8; i++) if (botRide(i, i % 2 ? 1 : -1).end === 'complete') complete++
  assert.ok(complete >= 5, `only ${complete}/8 rides completed`)
})

test('combo banks on expiry and is lost on a wipeout', () => {
  const tricks = []
  const r = new RideScore((t) => tricks.push(t), 1)
  r.add('Snap', 300)
  r.add('Carve', 200)
  assert.equal(r.multiplier, 1.5)
  const lost = r.wipeout()
  assert.equal(lost, 750)
  assert.ok(r.tricks.every((t) => t.lost))
  r.add('Bottom Turn', 100)
  const res = r.finish(true)
  assert.equal(res.points, 100 + 600)
  assert.equal(tricks.length, 3)
})

test('repeating a trick pays less each time', () => {
  const r = new RideScore(null, 1)
  r.add('Snap', 300)
  r.add('Snap', 300)
  assert.ok(r.tricks[1].points < r.tricks[0].points)
})

test('judge score is a monotonic 0-10 scale', () => {
  assert.equal(judgeScore(0), 0)
  let prev = 0
  for (const p of [500, 2000, 5000, 12000, 50000]) {
    const s = judgeScore(p)
    assert.ok(s > prev && s < 10)
    prev = s
  }
})
