import { judgeScore } from '../config.js'

const $ = (id) => document.getElementById(id)
const fmt = (n) => Math.round(n).toLocaleString('en-US')
const clock = (s) => {
  s = Math.max(0, Math.ceil(s))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

export class HUD {
  constructor() {
    this.el = {
      hud: $('hud'),
      clock: $('hudClock'),
      waves: $('hudWaves'),
      total: $('hudTotal'),
      prompt: $('hudPrompt'),
      feed: $('hudFeed'),
      combo: $('hudCombo'),
      comboPts: $('comboPts'),
      comboMult: $('comboMult'),
      comboBar: $('comboBar'),
      ride: $('hudRide'),
      rideScore: $('rideScore'),
      speed: $('hudSpeed'),
      pocket: $('hudPocket'),
      card: $('card'),
    }
    this._prompt = ''
    this._cache = {}
  }

  show(v) {
    this.el.hud.hidden = !v
  }

  _set(key, el, text) {
    if (this._cache[key] === text) return
    this._cache[key] = text
    el.textContent = text
  }

  setClock(seconds, free) {
    this._set('clock', this.el.clock, free ? '∞' : clock(seconds))
    this.el.clock.style.color = !free && seconds < 30 ? 'var(--coral)' : ''
  }

  setWaves(rides, free) {
    const scores = rides.map((r) => r.score)
    const top2 = [...scores].sort((a, b) => b - a).slice(0, 2)
    const key = scores.join(',') + free
    if (this._cache.waves !== key) {
      this._cache.waves = key
      const chips = []
      const used = []
      const recent = rides.slice(-4)
      const offset = rides.length - recent.length
      recent.forEach((r, i) => {
        const idx = offset + i
        let counts = false
        if (!free) {
          const pos = top2.indexOf(r.score)
          if (pos >= 0 && !used.includes(pos)) {
            used.push(pos)
            counts = true
          }
        }
        chips.push(`<div class="wave-chip${counts ? ' counting' : ''}"><b>${r.score.toFixed(2)}</b><small>W${idx + 1}</small></div>`)
      })
      if (!rides.length) chips.push('<div class="wave-chip empty"><b>—</b><small>Waves</small></div>')
      this.el.waves.innerHTML = chips.join('')
    }
    const total = free ? scores.reduce((a, b) => Math.max(a, b), 0) : top2.reduce((a, b) => a + b, 0)
    this._set('total', this.el.total, total.toFixed(2))
  }

  setPrompt(text, sub = '', hot = false) {
    const key = text + '|' + sub + hot
    if (this._prompt === key) return
    this._prompt = key
    this.el.prompt.innerHTML = text ? `${text}${sub ? `<small>${sub}</small>` : ''}` : ''
    this.el.prompt.classList.toggle('hot', hot)
  }

  trick({ name, points, big }, bad = false) {
    const d = document.createElement('div')
    d.className = 'trick' + (big ? ' big' : '') + (bad ? ' bad' : '')
    d.innerHTML = `<span class="t-name"></span>${points ? `<span class="t-pts">+${fmt(points)}</span>` : ''}`
    d.firstChild.textContent = name
    this.el.feed.prepend(d)
    while (this.el.feed.children.length > 5) this.el.feed.lastChild.remove()
    setTimeout(() => d.classList.add('out'), 2200)
    setTimeout(() => d.remove(), 2750)
  }

  setCombo(ride) {
    if (!ride || ride.combo.count === 0) {
      this.el.combo.hidden = true
    } else {
      this.el.combo.hidden = false
      this._set('cp', this.el.comboPts, fmt(ride.combo.points))
      this._set('cm', this.el.comboMult, '×' + ride.multiplier.toFixed(1).replace('.0', ''))
      this.el.comboBar.style.transform = `scaleX(${Math.max(0, ride.combo.timer / 2.8).toFixed(3)})`
    }
    this.el.ride.hidden = !ride
    if (ride) this._set('rs', this.el.rideScore, judgeScore(ride.live).toFixed(2))
  }

  setSpeed(ms) {
    this._set('speed', this.el.speed, String(Math.round(ms * 3.6)))
  }

  setPocket(text, cls = '') {
    this._set('pocket', this.el.pocket, text)
    if (this._cache.pocketCls !== cls) {
      this._cache.pocketCls = cls
      this.el.pocket.className = 'pocket ' + cls
    }
  }

  showCard(result, reason, wiped) {
    const c = this.el.card
    c.hidden = false
    c.classList.toggle('wiped', wiped)
    c.style.animation = 'none'
    void c.offsetWidth
    c.style.animation = ''
    $('cardReason').textContent = reason
    $('cardScore').textContent = result.score.toFixed(2)
    const parts = [`${fmt(result.points)} pts`, `top speed ${Math.round(result.maxSpeed * 3.6)} km/h`]
    if (result.tube > 0.4) parts.push(`${result.tube.toFixed(1)} s in the barrel`)
    $('cardPoints').textContent = parts.join(' · ')
    const list = $('cardTricks')
    list.innerHTML = ''
    const best = [...result.tricks].sort((a, b) => (a.lost ? 1 : 0) - (b.lost ? 1 : 0) || b.points - a.points).slice(0, 4)
    for (const t of best) {
      const li = document.createElement('li')
      if (t.lost) li.className = 'lost'
      li.innerHTML = '<span></span><span></span>'
      li.firstChild.textContent = t.name
      li.lastChild.textContent = '+' + fmt(t.points)
      list.appendChild(li)
    }
  }

  hideCard() {
    this.el.card.hidden = true
  }

  clearFeed() {
    this.el.feed.innerHTML = ''
  }
}
