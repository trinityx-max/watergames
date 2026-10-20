// Runs the attract-mode bot over many waves and reports how rides end.
import { WaveField } from '../src/waves/WaveField.js'
import { Board, MODE } from '../src/physics/Board.js'
import { Bot } from '../src/game/Bot.js'
import { RideScore } from '../src/game/Scoring.js'

export function botRide(seed, side) {
  const field = new WaveField()
  field.spawn({ xPeak: 0, delay: 9 })
  field.update(0)
  const board = new Board(field)
  board.reset(side * (6 + (seed % 5)), 0, 0)
  const bot = new Bot()
  bot.reset(side)
  const ride = new RideScore(null, side)
  const dt = 1 / 60
  let riding = 0
  let end = 'timeout'
  let pass = 0
  for (let t = 0; t < 60; t += dt) {
    bot.drive(board, dt)
    field.update(dt)
    board.update(dt)
    ride.update(dt, board)
    for (const e of board.events) if (e.type === 'land') ride.onBoardEvent(e)
    board.events.length = 0
    if (board.mode === MODE.WIPEOUT) { end = 'wipeout: ' + board.wipe.reason; break }
    if (board.mode !== MODE.PRONE) {
      riding += dt
      if (board.sample.u < -6.5) pass += dt; else pass = 0
      if (pass > 0.8) { end = 'passed'; break }
      const w = field.getWave(board.rideWaveId)
      if (!w || w.amp < 0.5) { end = 'complete'; break }
    } else if (t > 20) { end = 'never caught'; break }
  }
  const r = ride.finish(end === 'complete')
  return { end, riding: +riding.toFixed(1), score: +r.score.toFixed(2), tricks: r.tricks.length, tube: +r.tube.toFixed(1) }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const tally = {}
  for (let i = 0; i < 12; i++) {
    const r = botRide(i, i % 2 ? 1 : -1)
    tally[r.end] = (tally[r.end] || 0) + 1
    console.log(JSON.stringify(r))
  }
  console.log(tally)
}
