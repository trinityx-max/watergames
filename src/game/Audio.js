// Fully procedural sound: filtered noise beds for the ocean, the breaking
// curl, board hiss and wind; synthesized splashes; a soft chime for tricks.

export class AudioEngine {
  constructor() {
    this.ctx = null
    this.muted = false
    this.ready = false
  }

  start() {
    if (this.ready) {
      if (this.ctx.state === 'suspended') this.ctx.resume()
      return
    }
    const AC = window.AudioContext || window.webkitAudioContext
    if (!AC) return
    const ctx = new AC()
    this.ctx = ctx
    this.master = ctx.createGain()
    this.master.gain.value = this.muted ? 0 : 0.8
    this.under = ctx.createBiquadFilter()
    this.under.type = 'lowpass'
    this.under.frequency.value = 18000
    this.under.connect(this.master)
    const comp = ctx.createDynamicsCompressor()
    comp.threshold.value = -14
    comp.ratio.value = 3
    this.master.connect(comp)
    comp.connect(ctx.destination)

    const len = ctx.sampleRate * 3
    const white = ctx.createBuffer(1, len, ctx.sampleRate)
    const brown = ctx.createBuffer(1, len, ctx.sampleRate)
    const w = white.getChannelData(0)
    const b = brown.getChannelData(0)
    let last = 0
    for (let i = 0; i < len; i++) {
      const r = Math.random() * 2 - 1
      w[i] = r
      last = (last + 0.02 * r) / 1.02
      b[i] = last * 3.5
    }
    this.white = white
    this.brown = brown

    const bed = (buffer, type, freq, q, gain) => {
      const src = ctx.createBufferSource()
      src.buffer = buffer
      src.loop = true
      src.loopStart = Math.random()
      const f = ctx.createBiquadFilter()
      f.type = type
      f.frequency.value = freq
      f.Q.value = q
      const g = ctx.createGain()
      g.gain.value = gain
      src.connect(f)
      f.connect(g)
      g.connect(this.under)
      src.start(0, Math.random() * 2)
      return { src, f, g }
    }
    this.ocean = bed(brown, 'lowpass', 420, 0.4, 0.35)
    this.roar = bed(brown, 'bandpass', 520, 0.45, 0)
    this.crash = bed(white, 'lowpass', 1400, 0.3, 0)
    this.hiss = bed(white, 'bandpass', 2600, 0.9, 0)
    this.wind = bed(white, 'bandpass', 380, 0.6, 0.02)
    this.ready = true
  }

  setMuted(m) {
    this.muted = m
    if (this.master) this.master.gain.setTargetAtTime(m ? 0 : 0.8, this.ctx.currentTime, 0.05)
  }

  // Continuous mix driven by the game every frame.
  update({ breakProximity = 0, crashProximity = 0, boardSpeed = 0, riding = false, carve = 0, underwater = false, tube = 0 }) {
    if (!this.ready) return
    const t = this.ctx.currentTime
    const set = (param, v, tc = 0.12) => param.setTargetAtTime(v, t, tc)
    const swell = 0.28 + 0.08 * Math.sin(t * 0.37)
    set(this.ocean.g.gain, swell)
    set(this.roar.g.gain, 0.05 + breakProximity * 0.55 + tube * 0.25)
    set(this.roar.f.frequency, 380 + breakProximity * 380 + tube * 200)
    set(this.crash.g.gain, crashProximity * 0.32 + tube * 0.12)
    const hissAmt = riding ? Math.min(1, boardSpeed / 14) : Math.min(0.3, boardSpeed / 8)
    set(this.hiss.g.gain, hissAmt * (0.06 + carve * 0.16), 0.05)
    set(this.hiss.f.frequency, 1500 + boardSpeed * 120 + carve * 900, 0.05)
    set(this.wind.g.gain, 0.015 + Math.min(1, boardSpeed / 15) * 0.08)
    set(this.under.frequency, underwater ? 420 : 18000, 0.08)
  }

  splash(size = 1) {
    if (!this.ready) return
    const ctx = this.ctx
    const t = ctx.currentTime
    const src = ctx.createBufferSource()
    src.buffer = this.white
    const f = ctx.createBiquadFilter()
    f.type = 'lowpass'
    f.frequency.setValueAtTime(800 + size * 2400, t)
    f.frequency.exponentialRampToValueAtTime(260, t + 0.25 + size * 0.4)
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(0.25 + size * 0.45, t + 0.015)
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3 + size * 0.6)
    src.connect(f)
    f.connect(g)
    g.connect(this.under)
    src.start(t, Math.random() * 2, 1.2 + size)
  }

  stroke() {
    if (!this.ready) return
    const ctx = this.ctx
    const t = ctx.currentTime
    const src = ctx.createBufferSource()
    src.buffer = this.white
    const f = ctx.createBiquadFilter()
    f.type = 'bandpass'
    f.frequency.value = 900 + Math.random() * 400
    f.Q.value = 0.8
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(0.09, t + 0.05)
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35)
    src.connect(f)
    f.connect(g)
    g.connect(this.under)
    src.start(t, Math.random() * 2, 0.5)
  }

  chime(step = 0, big = false) {
    if (!this.ready) return
    const ctx = this.ctx
    const t = ctx.currentTime
    const scale = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21]
    const note = 69 + scale[Math.min(scale.length - 1, step)]
    const freq = 440 * Math.pow(2, (note - 69) / 12)
    for (const [mul, gain] of [
      [1, 0.09],
      [2, 0.03],
      [big ? 1.5 : 3, big ? 0.05 : 0.012],
    ]) {
      const o = ctx.createOscillator()
      o.type = 'sine'
      o.frequency.value = freq * mul
      const g = ctx.createGain()
      g.gain.setValueAtTime(0.0001, t)
      g.gain.exponentialRampToValueAtTime(gain, t + 0.01)
      g.gain.exponentialRampToValueAtTime(0.0001, t + (big ? 1.4 : 0.7))
      o.connect(g)
      g.connect(this.master)
      o.start(t)
      o.stop(t + 1.5)
    }
  }

  horn() {
    if (!this.ready) return
    const ctx = this.ctx
    const t = ctx.currentTime
    for (const f of [220, 277, 330]) {
      const o = ctx.createOscillator()
      o.type = 'sawtooth'
      o.frequency.value = f
      const lp = ctx.createBiquadFilter()
      lp.type = 'lowpass'
      lp.frequency.value = 900
      const g = ctx.createGain()
      g.gain.setValueAtTime(0.0001, t)
      g.gain.exponentialRampToValueAtTime(0.06, t + 0.08)
      g.gain.setValueAtTime(0.06, t + 1.1)
      g.gain.exponentialRampToValueAtTime(0.0001, t + 1.5)
      o.connect(lp)
      lp.connect(g)
      g.connect(this.master)
      o.start(t)
      o.stop(t + 1.6)
    }
  }
}
