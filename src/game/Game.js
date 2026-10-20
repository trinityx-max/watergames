// Session flow: attract mode behind the menu, then heats (best two waves
// count, like a real contest) or free surf. Each wave goes lineup -> catch ->
// ride -> scorecard -> fade back out to the lineup for the next set.

import { HEAT_SECONDS, WORLD, WAVE } from '../config.js'
import { MODE } from '../physics/Board.js'
import { RideScore } from './Scoring.js'
import { Bot } from './Bot.js'

const R = Math.random

function loadBest() {
  try {
    return JSON.parse(localStorage.getItem('swell.best') || 'null')
  } catch {
    return null
  }
}
function saveBest(v) {
  try {
    localStorage.setItem('swell.best', JSON.stringify(v))
  } catch {
    /* storage unavailable: keep the best for this visit only */
  }
}

export class Game {
  constructor(ctx) {
    Object.assign(this, ctx)
    this.state = 'attract'
    this.sub = 'lineup'
    this.paused = false
    this.bot = new Bot()
    this.rides = []
    this.best = loadBest()
    this.heatTime = HEAT_SECONDS
    this.mode = 'heat'
    this.passTimer = 0
    this.overTimer = 0
    this.nextSetTimer = 0
    this.peak = 0
    this.side = 1
    this.lastHornDone = false
    this.message = null
  }

  // ---------- Setup ----------

  newLineup(first = false) {
    const f = this.field
    f.reset()
    this.peak = (R() - 0.5) * 24
    this.side = this.state === 'attract' ? (R() < 0.5 ? 1 : -1) : this.side
    const x = this.peak + this.side * (6 + R() * 4)
    this.board.reset(x, WORLD.lineupZ + (R() - 0.5) * 4, (R() - 0.5) * 0.3)
    f.spawnSet({ xPeak: this.peak, count: 3, spacing: 8.5, firstDelay: first ? 9 : 6.5 + R() * 2 })
    f.update(0)
    this.rig.cut()
    this.trail.clear()
    this.spray.clear()
    this.sub = 'lineup'
    this.ride = null
    this.passTimer = 0
    this.missedTimer = 0
    this.nextSetTimer = 0
    this.bot.reset(this.side)
    this.attractRide = 0
    this.hud.hideCard()
    if (this.state === 'attract') this.ride = new RideScore(null, this.side)
  }

  startAttract() {
    this.state = 'attract'
    this.paused = false
    this.rig.mode = 'cinematic'
    this.rig.shot = 0
    this.hud.show(false)
    this.newLineup(true)
    this.rig.cut()
  }

  startSession(mode) {
    this.state = 'play'
    this.mode = mode
    this.paused = false
    this.rides = []
    this.heatTime = HEAT_SECONDS
    this.lastHornDone = false
    this.finalWave = false
    this.side = R() < 0.5 ? 1 : -1
    this.rig.mode = 'chase'
    this.hud.show(true)
    this.hud.clearFeed()
    this.hud.setWaves(this.rides, mode === 'free')
    this.newLineup(true)
    this.audio.horn()
  }

  // Which way along the crest the rider is heading (+1 = +x).
  rideDir() {
    const w = this.field.getWave(this.board.rideWaveId)
    return Math.sign(this.board.pos.x - (w ? w.xPeak : this.peak)) || this.side
  }

  togglePause() {
    if (this.state !== 'play') return
    this.paused = !this.paused
    this.ui.pause.hidden = !this.paused
  }

  // ---------- Frame ----------

  update(dt, input) {
    if (this.paused) return
    const board = this.board
    if (this.state === 'attract' || this.autopilot) {
      if (this.autopilot && this.sub === 'ride' && !this._apDir) this.bot.dir = this.rideDir()
      this.bot.drive(board, dt)
    } else {
      board.input.steer = input.steer
      board.input.throttle = input.throttle
      board.input.brake = input.brake
      board.input.grab = input.grab
      if (input.took('Space')) board.queuePop()
      if (input.took('KeyC')) {
        this.rig.mode = this.rig.mode === 'chase' ? 'cinematic' : 'chase'
        this.rig.cut()
      }
    }

    this.field.update(dt)
    board.update(dt)
    this._handleEvents()
    if (this.ride && (this.sub === 'ride' || this.state === 'attract')) this.ride.update(dt, board)
    else board.inTube = false

    if (this.state === 'attract') this._attract(dt)
    else this._play(dt)
  }

  _handleEvents() {
    const board = this.board
    for (const e of board.events) {
      switch (e.type) {
        case 'stroke':
          this.effects.burst(board, 'stroke')
          if (this.state === 'play') this.audio.stroke()
          break
        case 'popup':
          this.effects.burst(board, 'popup')
          this.audio.splash(0.35)
          if (this.state === 'play') this._startRide()
          break
        case 'popfail':
          if (this.state === 'play') this.flash('Not yet — wait for the wave to lift you', 1.4)
          break
        case 'ollie':
          this.audio.splash(0.2)
          break
        case 'takeoff':
          break
        case 'land':
          this.effects.burst(board, 'land')
          this.audio.splash(0.6 + Math.min(1, -e.impact / 10))
          this.rig.addShake(0.35)
          this.ride?.onBoardEvent(e)
          break
        case 'wipeout':
          this.effects.burst(board, 'wipeout')
          this.audio.splash(1.6)
          this.rig.addShake(1.1)
          if (this.state === 'play' && this.ride) {
            const lost = this.ride.wipeout()
            this.hud.trick({ name: 'Wiped out', points: 0 }, true)
            if (lost > 0) this.hud.trick({ name: `Combo lost −${lost.toLocaleString('en-US')}`, points: 0 }, true)
          }
          break
      }
    }
    board.events.length = 0
  }

  flash(text, seconds = 1.5, sub = '') {
    this.message = { text, sub, t: seconds }
  }

  _startRide() {
    const board = this.board
    const w = this.field.getWave(board.rideWaveId)
    const dir = w ? Math.sign(board.pos.x - w.xPeak) || this.side : this.side
    this.sub = 'ride'
    this.ride = new RideScore((t) => this._onTrick(t), dir)
    this.passTimer = 0
  }

  _onTrick(t) {
    this.hud.trick(t)
    this.audio.chime(Math.min(9, t.combo - 1), t.big)
    if (/Snap|Re-entry|Cutback/.test(t.name)) {
      this.effects.burst(this.board, 'snap')
      this.rig.addShake(0.25)
    }
  }

  _rideOver(S, w, dt) {
    const board = this.board
    if (board.mode === MODE.WIPEOUT) return board.wipe.t > 2.3 ? { reason: board.wipe.reason, wiped: true } : null
    if (board.mode === MODE.AIR) return null
    if (S.u < -6.5) this.passTimer += dt
    else this.passTimer = 0
    if (this.passTimer > 0.8) return { reason: 'Pulled out the back', wiped: false }
    if (!w || w.amp < 0.5 || w.zc > WORLD.endZ - 15) return { reason: 'Rode it all the way in', wiped: false, completed: true }
    if (Math.abs(board.pos.x - w.xPeak) > 430) return { reason: 'Ran out of wave', wiped: false }
    if (this.ride && this.ride.time > 75) return { reason: 'Kicked out', wiped: false }
    return null
  }

  _endRide(info) {
    const result = this.ride.finish(!!info.completed)
    this.rides.push(result)
    this.hud.setWaves(this.rides, this.mode === 'free')
    this.hud.showCard(result, info.reason, info.wiped)
    this.audio.chime(result.score > 7 ? 7 : 3, true)
    this.sub = 'over'
    this.overTimer = 3.6
    this.ride = null
  }

  _nearestIncoming() {
    let best = null
    for (const w of this.field.waves) {
      const ahead = this.board.pos.z - w.zc
      if (ahead > -2 && (!best || ahead < best.ahead)) best = { w, ahead }
    }
    return best
  }

  _play(dt) {
    const board = this.board
    const S = board.sample
    const hud = this.hud
    const free = this.mode === 'free'
    if (!free) {
      const before = this.heatTime
      this.heatTime -= dt
      if (before > 0 && this.heatTime <= 0) {
        this.audio.horn()
        if (this.sub === 'lineup') {
          this._finishHeat()
          return
        }
        this.finalWave = true
        this.flash('Horn! Finish this wave', 2.5)
      }
    }
    hud.setClock(this.heatTime, free)

    if (this.message) {
      this.message.t -= dt
      if (this.message.t <= 0) this.message = null
    }

    if (this.sub === 'lineup') {
      const inc = this._nearestIncoming()
      if (!inc && board.mode === MODE.PRONE) {
        // The set went through without you: queue the next one.
        if (this.nextSetTimer <= 0) {
          this.nextSetTimer = 4
          if (S.u < 0 && S.u > -40) this.flash('Missed it', 1.5, 'Paddle earlier as the face lifts you')
        }
        this.nextSetTimer -= dt
        if (this.nextSetTimer <= 0.01) {
          this.peak += (R() - 0.5) * 10
          this.field.spawnSet({ xPeak: this.peak, count: 2 + Math.round(R()), spacing: 8.5, firstDelay: 6 + R() * 2 })
          this.nextSetTimer = 0
        }
      }
      if (board.mode === MODE.WIPEOUT) {
        if (board.wipe.t > 2.3) this._toLineup()
      } else if (this.message) {
        hud.setPrompt(this.message.text, this.message.sub)
      } else if (board.canPop) {
        hud.setPrompt('Pop up!', 'Press Space', true)
      } else if (inc) {
        const eta = inc.ahead / WAVE.speed
        if (eta > 3.2) hud.setPrompt(`Set wave · ${Math.ceil(eta)}s`, 'Line up near the peak, then paddle as it reaches you')
        else hud.setPrompt('Paddle!', 'Hold W to match the wave', true)
      } else if (this.nextSetTimer > 0) {
        hud.setPrompt('Next set', `about ${Math.ceil(this.nextSetTimer + 6)}s`)
      } else hud.setPrompt('')
      const dx = this.peak - board.pos.x
      hud.setPocket(Math.abs(dx) < 4 ? 'On the peak' : `Peak ${Math.round(Math.abs(dx))} m ${dx > 0 ? 'right' : 'left'}`)
      hud.setCombo(null)
    } else if (this.sub === 'ride') {
      const w = this.field.getWave(board.rideWaveId)
      const over = this._rideOver(S, w, dt)
      if (over) this._endRide(over)
      else {
        hud.setPrompt(this.message ? this.message.text : '', this.message ? this.message.sub : '')
        if (board.inTube) hud.setPocket('In the barrel', 'tube')
        else if (S.broken > 0.25 && S.u > -5) hud.setPocket('Whitewater!', 'warn')
        else if (S.curl > 0.3 && S.u < 1.2 && S.hn > 0.75) hud.setPocket('Too high, the lip!', 'warn')
        else if (S.s < 5 && S.curl > 0.2) hud.setPocket('In the pocket', 'tube')
        else if (S.s > 0) hud.setPocket(`Pocket ${Math.round(S.s)} m back`)
        else hud.setPocket('')
        hud.setCombo(this.ride)
      }
    } else if (this.sub === 'over') {
      hud.setPrompt('')
      hud.setCombo(null)
      this.overTimer -= dt
      if (board.mode === MODE.RIDING) {
        // Kick out and sit up while the card shows.
        board.input.steer = 0
        board.input.throttle = 0
        board.input.brake = 1
      }
      if (this.overTimer <= 0) {
        if (!free && (this.heatTime <= 0 || this.finalWave)) this._finishHeat()
        else this._toLineup()
      }
    }
    hud.setSpeed(Math.hypot(board.vel.x, board.vel.z))
  }

  _toLineup() {
    if (this._fading) return
    this._fading = true
    this.ui.fade.classList.add('on')
    setTimeout(() => {
      this.side = -this.side
      this.newLineup()
      this.ui.fade.classList.remove('on')
      this._fading = false
    }, 480)
  }

  _finishHeat() {
    const scores = this.rides.map((r) => r.score)
    const top = [...scores].sort((a, b) => b - a).slice(0, 2)
    const total = top.reduce((a, b) => a + b, 0)
    const prev = this.best
    const isBest = !prev || total > prev.total
    if (isBest && this.rides.length) {
      this.best = { total, date: Date.now() }
      saveBest(this.best)
    }
    this.hud.show(false)
    this.hud.hideCard()
    this.onHeatEnd?.({ rides: this.rides, total, top, isBest: isBest && this.rides.length > 0, prev })
    this.startAttract()
  }

  endSession() {
    if (this.mode === 'heat') this._finishHeat()
    else {
      this.hud.show(false)
      this.onHeatEnd?.({ rides: this.rides, total: Math.max(0, ...this.rides.map((r) => r.score)), top: [], free: true })
      this.startAttract()
    }
  }

  _attract(dt) {
    const board = this.board
    const S = board.sample
    const w = this.field.getWave(board.rideWaveId)
    let over = false
    if (board.mode === MODE.WIPEOUT) over = board.wipe.t > 2.5
    else if (board.mode !== MODE.PRONE) {
      this.attractRide += dt
      if (S.u < -6.5) this.passTimer += dt
      else this.passTimer = 0
      over = this.passTimer > 0.8 || !w || w.amp < 0.55 || this.attractRide > 32
    } else if (!this._nearestIncoming()) over = true
    if (over) {
      this.side = R() < 0.5 ? 1 : -1
      this.newLineup()
    }
  }
}
