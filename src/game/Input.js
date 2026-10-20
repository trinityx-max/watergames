// Keyboard, gamepad and touch merged into one analog control state.

export class Input {
  constructor(target = window) {
    this.keys = new Set()
    this.pressed = new Set()
    this.steer = 0
    this.throttle = 0
    this.brake = 0
    this.grab = false
    this.touch = { steer: 0, throttle: 0, brake: 0, grab: false }
    this._padPrev = {}
    this.usingPad = false
    target.addEventListener('keydown', (e) => {
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault()
      if (!e.repeat) this.pressed.add(e.code)
      this.keys.add(e.code)
      this.usingPad = false
    })
    target.addEventListener('keyup', (e) => this.keys.delete(e.code))
    window.addEventListener('blur', () => this.keys.clear())
  }

  bindTouch(root) {
    const zones = root.querySelectorAll('[data-touch]')
    for (const z of zones) {
      const k = z.dataset.touch
      const on = (e) => {
        e.preventDefault()
        z.classList.add('on')
        if (k === 'left') this.touch.steer = -1
        if (k === 'right') this.touch.steer = 1
        if (k === 'pump') this.touch.throttle = 1
        if (k === 'brake') this.touch.brake = 1
        if (k === 'pop') this.pressed.add('Space')
        if (k === 'grab') this.touch.grab = true
      }
      const off = (e) => {
        e.preventDefault()
        z.classList.remove('on')
        if (k === 'left' || k === 'right') this.touch.steer = 0
        if (k === 'pump') this.touch.throttle = 0
        if (k === 'brake') this.touch.brake = 0
        if (k === 'grab') this.touch.grab = false
      }
      z.addEventListener('pointerdown', on)
      z.addEventListener('pointerup', off)
      z.addEventListener('pointercancel', off)
      z.addEventListener('pointerleave', off)
    }
  }

  down(...codes) {
    return codes.some((c) => this.keys.has(c))
  }

  // Edge-triggered actions since the last frame.
  took(...codes) {
    let hit = false
    for (const c of codes) if (this.pressed.has(c)) hit = true
    return hit
  }

  update(dt) {
    let steer = 0
    // Positive steer turns right on screen.
    if (this.down('KeyA', 'ArrowLeft')) steer -= 1
    if (this.down('KeyD', 'ArrowRight')) steer += 1
    let throttle = this.down('KeyW', 'ArrowUp') ? 1 : 0
    let brake = this.down('KeyS', 'ArrowDown') ? 1 : 0
    let grab = this.down('ShiftLeft', 'ShiftRight', 'KeyE')

    const pads = navigator.getGamepads ? navigator.getGamepads() : []
    for (const p of pads) {
      if (!p || !p.connected) continue
      const ax = p.axes[0] || 0
      const ay = p.axes[1] || 0
      const dz = (v) => (Math.abs(v) < 0.15 ? 0 : (v - Math.sign(v) * 0.15) / 0.85)
      if (Math.abs(ax) > 0.15 || p.buttons.some((b) => b.pressed)) this.usingPad = true
      steer += dz(ax)
      throttle = Math.max(throttle, Math.max(0, -dz(ay)), p.buttons[7]?.value || 0)
      brake = Math.max(brake, Math.max(0, dz(ay)), p.buttons[6]?.value || 0)
      grab = grab || !!p.buttons[2]?.pressed || !!p.buttons[5]?.pressed
      const edge = (i, code) => {
        const was = this._padPrev[i]
        const now = !!p.buttons[i]?.pressed
        if (now && !was) this.pressed.add(code)
        this._padPrev[i] = now
      }
      edge(0, 'Space')
      edge(9, 'Escape')
      edge(1, 'KeyB')
      edge(3, 'KeyC')
      break
    }
    steer += this.touch.steer
    throttle = Math.max(throttle, this.touch.throttle)
    brake = Math.max(brake, this.touch.brake)
    grab = grab || this.touch.grab

    steer = Math.max(-1, Math.min(1, steer))
    // Keyboard steering ramps in so carves feel progressive.
    const r = 1 - Math.exp(-(Math.abs(steer) > Math.abs(this.steer) ? 7 : 12) * dt)
    this.steer += (steer - this.steer) * r
    this.throttle = throttle
    this.brake = brake
    this.grab = grab
  }

  endFrame() {
    this.pressed.clear()
  }
}
