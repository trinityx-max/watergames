import './style.css'
import {
  ACESFilmicToneMapping,
  Color,
  DirectionalLight,
  FogExp2,
  HemisphereLight,
  PerspectiveCamera,
  PMREMGenerator,
  Scene,
  SRGBColorSpace,
  WebGLRenderer,
} from 'three'
import { QUALITY, TIMES, WORLD } from './config.js'
import { WaveField } from './waves/WaveField.js'
import { Board, MODE } from './physics/Board.js'
import { createNoiseTexture } from './render/noise.js'
import { Environment } from './render/Environment.js'
import { createSky } from './render/Sky.js'
import { Ocean } from './render/Ocean.js'
import { createLand } from './render/Land.js'
import { SurferModel } from './render/Surfer.js'
import { Spray } from './render/Particles.js'
import { Trail } from './render/Trail.js'
import { Post } from './render/Post.js'
import { CameraRig } from './game/CameraRig.js'
import { Input } from './game/Input.js'
import { AudioEngine } from './game/Audio.js'
import { Effects } from './game/Effects.js'
import { Game } from './game/Game.js'
import { HUD } from './ui/HUD.js'

const $ = (id) => document.getElementById(id)
const store = {
  get(k, d) {
    try {
      const v = localStorage.getItem('swell.' + k)
      return v === null ? d : v
    } catch {
      return d
    }
  },
  set(k, v) {
    try {
      localStorage.setItem('swell.' + k, v)
    } catch {
      /* no storage: settings last for this visit */
    }
  },
}

const REPORTS = {
  golden: { swell: '5 ft @ 14 s', wind: 'Light offshore', tide: 'Mid, rising' },
  midday: { swell: '5 ft @ 13 s', wind: 'Glassy, 3 kn', tide: 'High, slack' },
  dusk: { swell: '6 ft @ 15 s', wind: 'Offshore, 6 kn', tide: 'Low, rising' },
}

function defaultQuality() {
  const coarse = matchMedia('(pointer: coarse)').matches
  if (coarse) return 'low'
  return (navigator.hardwareConcurrency || 4) >= 8 ? 'high' : 'medium'
}

function boot() {
  const canvas = $('scene')
  let renderer
  try {
    renderer = new WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false })
  } catch (e) {
    $('loadingText').textContent = 'This game needs WebGL 2. Try a recent Chrome, Edge, Firefox or Safari.'
    return
  }
  renderer.outputColorSpace = SRGBColorSpace
  renderer.toneMapping = ACESFilmicToneMapping

  let qualityKey = store.get('quality', defaultQuality())
  if (!QUALITY[qualityKey]) qualityKey = 'medium'
  let timeKey = store.get('time', 'golden')
  if (!TIMES[timeKey]) timeKey = 'golden'
  let quality = QUALITY[qualityKey]

  const scene = new Scene()
  const camera = new PerspectiveCamera(62, innerWidth / innerHeight, 0.1, 9000)
  const field = new WaveField()
  const env = new Environment(createNoiseTexture(256), field)
  env.setTime(timeKey)

  const sky = createSky(env)
  scene.add(sky)
  const ocean = new Ocean(env, quality)
  scene.add(ocean.group)
  scene.add(createLand())
  const sun = new DirectionalLight(0xffffff, 3)
  scene.add(sun)
  scene.add(sun.target)
  const hemi = new HemisphereLight(0xffffff, 0x0a3340, 1)
  scene.add(hemi)
  scene.fog = new FogExp2(new Color(), 0.00021)

  const board = new Board(field)
  const surfer = new SurferModel()
  scene.add(surfer.group)
  let spray = new Spray(quality.particles, env)
  scene.add(spray.points)
  const trail = new Trail(env)
  scene.add(trail.mesh)
  const post = new Post(renderer, scene, camera, quality)
  const rig = new CameraRig(camera, field)
  const input = new Input()
  input.bindTouch($('touch'))
  const audio = new AudioEngine()
  const hud = new HUD()
  const effects = new Effects(spray, field, quality.particles / 3600)

  // Reflections on the board and wetsuit come from the live sky.
  const pmrem = new PMREMGenerator(renderer)
  let envMap = null
  function applyTime(key) {
    timeKey = key
    env.setTime(key)
    const p = TIMES[key]
    const u = env.uniforms
    sun.color.copy(u.uSunColor.value)
    sun.intensity = p.sunIntensity * 0.95
    hemi.color.copy(u.uZenith.value).lerp(new Color(1, 1, 1), 0.3)
    hemi.groundColor.copy(u.uScatter.value).multiplyScalar(0.5)
    hemi.intensity = 1.1
    scene.fog.color.copy(u.uHorizon.value)
    renderer.toneMappingExposure = p.exposure
    const skyScene = new Scene()
    skyScene.add(createSky(env))
    env.uniforms.uTime.value = 0
    if (envMap) envMap.dispose()
    envMap = pmrem.fromScene(skyScene, 0.02, 0.1, 100).texture
    scene.environment = envMap
    scene.environmentIntensity = 0.6
    const r = REPORTS[key]
    $('repSwell').textContent = r.swell
    $('repWind').textContent = r.wind
    $('repTide').textContent = r.tide
    store.set('time', key)
  }
  applyTime(timeKey)

  // ---- Resolution management ----
  let pixelScale = Math.min(devicePixelRatio, quality.maxPixelRatio)
  function resize() {
    const w = innerWidth
    const h = innerHeight
    renderer.setPixelRatio(pixelScale)
    renderer.setSize(w, h, false)
    post.setSize(w, h, pixelScale)
    camera.aspect = w / h
    camera.updateProjectionMatrix()
    spray.material.uniforms.uScale.value = (h * pixelScale) / (2 * Math.tan((camera.fov * Math.PI) / 360))
  }
  addEventListener('resize', resize)
  resize()

  function applyQuality(key) {
    qualityKey = key
    quality = QUALITY[key]
    ocean.setQuality(quality)
    post.setQuality(quality)
    scene.remove(spray.points)
    spray.geometry.dispose()
    spray = new Spray(quality.particles, env)
    scene.add(spray.points)
    effects.spray = spray
    effects.budget = quality.particles / 3600
    game.spray = spray
    pixelScale = Math.min(devicePixelRatio, quality.maxPixelRatio)
    resize()
    store.set('quality', key)
  }

  const ui = { pause: $('pause'), fade: $('fade') }
  const game = new Game({ field, board, hud, audio, effects, rig, surfer, trail, spray, ui })

  // ---- Menu wiring ----
  const menu = $('menu')
  const results = $('results')
  const seg = (id, value, onPick) => {
    const root = $(id)
    const buttons = [...root.querySelectorAll('button')]
    const mark = (v) => buttons.forEach((b) => b.setAttribute('aria-checked', String(b.dataset.v === v)))
    mark(value)
    buttons.forEach((b) =>
      b.addEventListener('click', () => {
        mark(b.dataset.v)
        onPick(b.dataset.v)
      }),
    )
  }
  seg('optTime', timeKey, applyTime)
  seg('optQuality', qualityKey, applyQuality)
  let muted = store.get('muted', '0') === '1'
  audio.setMuted(muted)
  seg('optSound', muted ? 'off' : 'on', (v) => {
    muted = v === 'off'
    audio.setMuted(muted)
    store.set('muted', muted ? '1' : '0')
  })
  const showBest = () => {
    $('bestLine').innerHTML = game.best ? `Best heat <b>${game.best.total.toFixed(2)}</b> of 20` : 'No heats surfed yet'
  }
  showBest()
  const touch = matchMedia('(pointer: coarse)').matches
  const begin = (mode) => {
    audio.start()
    audio.setMuted(muted)
    menu.hidden = true
    results.hidden = true
    $('touch').hidden = !touch
    game.startSession(mode)
  }
  $('btnHeat').addEventListener('click', () => begin('heat'))
  $('btnFree').addEventListener('click', () => begin('free'))
  $('btnResume').addEventListener('click', () => game.togglePause())
  $('btnQuit').addEventListener('click', () => {
    game.togglePause()
    game.endSession()
  })
  $('btnAgain').addEventListener('click', () => begin('heat'))
  $('btnMenu').addEventListener('click', () => {
    results.hidden = true
    menu.hidden = false
  })

  game.onHeatEnd = ({ rides, total, top, isBest, prev, free }) => {
    $('touch').hidden = true
    showBest()
    $('resEyebrow').textContent = free ? 'Session over' : 'Heat complete'
    $('resTotal').textContent = total.toFixed(2)
    $('resSub').textContent = free
      ? `Best wave of ${rides.length}`
      : rides.length
        ? `Best two of ${rides.length} wave${rides.length === 1 ? '' : 's'}, out of 20`
        : 'No waves ridden. Paddle harder as the face lifts you.'
    const list = $('resWaves')
    list.innerHTML = ''
    const used = []
    rides.forEach((r, i) => {
      const li = document.createElement('li')
      const pos = top.indexOf(r.score)
      if (!free && pos >= 0 && !used.includes(pos)) {
        used.push(pos)
        li.className = 'counts'
      }
      const desc = r.top ? r.top.name : r.completed ? 'Rode it in' : 'Cruised'
      li.innerHTML = `<span class="w-n">W${i + 1}</span><span class="w-d"></span><span class="w-s">${r.score.toFixed(2)}</span>`
      li.querySelector('.w-d').textContent = desc + (r.tube > 0.4 ? ` · ${r.tube.toFixed(1)} s barrel` : '')
      list.appendChild(li)
    })
    $('resBest').textContent = isBest ? (prev ? `New personal best, up from ${prev.total.toFixed(2)}` : 'First heat on the board') : ''
    results.hidden = false
  }

  addEventListener('keydown', (e) => {
    if ((e.code === 'Escape' || e.code === 'KeyP') && game.state === 'play') game.togglePause()
    if (e.code === 'KeyM') {
      muted = !muted
      audio.setMuted(muted)
    }
  })
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && game.state === 'play' && !game.paused) game.togglePause()
  })

  // ---- Main loop ----
  let last = performance.now()
  let frameAvg = 16
  let adaptTimer = 0
  let slowFrames = 0
  game.startAttract()

  function frame(now) {
    requestAnimationFrame(frame)
    let dt = Math.min(0.05, (now - last) / 1000)
    last = now
    input.update(dt)
    if (input.took('Escape', 'KeyB') && game.state === 'play' && game.paused) game.togglePause()
    const simDt = game.paused ? 0 : dt
    game.update(simDt, input)
    input.endFrame()

    surfer.update(simDt, board)
    if (!game.paused) {
      effects.update(simDt, board, camera)
      spray.update(simDt, field)
      const riding = board.mode === MODE.RIDING || board.mode === MODE.POPUP
      trail.update(field.time, board, field, board.contact && (riding || (board.mode === MODE.PRONE && board.speed > 1.2)), riding ? Math.min(1, board.speed / 8) : 0.4)
    }
    rig.update(dt, board, { side: Math.sign(board.pos.x - game.peak) || 1, dir: game.rideDir() })

    // Grid follows a point ahead of the camera where detail matters most.
    const fx = rig.look.x - camera.position.x
    const fz = rig.look.z - camera.position.z
    const fl = Math.hypot(fx, fz) || 1
    ocean.update(camera.position.x + (fx / fl) * 10, camera.position.z + (fz / fl) * 10)
    env.sync(field.time)
    sky.position.copy(camera.position)
    const sd = env.uniforms.uSunDir.value
    sun.position.set(board.pos.x + sd.x * 100, board.pos.y + sd.y * 100, board.pos.z + sd.z * 100)
    sun.target.position.copy(board.pos)

    // Audio mix from the nearest breaking curl.
    let breakProx = 0
    let crashProx = 0
    for (const w of field.waves) {
      if (w.bk < 0.05) continue
      for (const xb of [w.xbR, w.xbL]) {
        const d = Math.hypot(xb - camera.position.x, w.zc - camera.position.z)
        breakProx = Math.max(breakProx, Math.exp(-d / 45) * w.bk * Math.min(1, w.amp / 2.5))
      }
      if (w.xbR - w.xbL > 8 && camera.position.x > w.xbL && camera.position.x < w.xbR)
        crashProx = Math.max(crashProx, Math.exp(-Math.abs(w.zc - camera.position.z) / 30) * w.bk)
    }
    audio.update({
      breakProximity: breakProx,
      crashProximity: crashProx,
      boardSpeed: board.speed,
      riding: board.mode === MODE.RIDING,
      carve: Math.min(1, Math.abs(board.lateralG) * 0.6),
      underwater: rig.under > 0,
      tube: board.inTube ? 1 : 0,
    })

    const g = post.uniforms
    g.uUnder.value += ((rig.under ? 1 : 0) - g.uUnder.value) * Math.min(1, dt * 8)
    g.uTube.value += ((board.inTube ? 1 : 0) - g.uTube.value) * Math.min(1, dt * 4)
    g.uFlash.value *= Math.exp(-dt * 6)
    post.render(dt)

    // Dynamic resolution: hold frame rate by trading pixels.
    frameAvg += (dt * 1000 - frameAvg) * 0.05
    adaptTimer += dt
    if (adaptTimer > 1.5) {
      adaptTimer = 0
      const cap = Math.min(devicePixelRatio, quality.maxPixelRatio)
      if (frameAvg > 21 && pixelScale > 0.6) {
        slowFrames++
        if (slowFrames >= 2) {
          pixelScale = Math.max(0.6, pixelScale - 0.15)
          resize()
          slowFrames = 0
        }
      } else if (frameAvg < 14 && pixelScale < cap) {
        pixelScale = Math.min(cap, pixelScale + 0.1)
        resize()
        slowFrames = 0
      } else slowFrames = 0
    }
  }

  // Let the first frame compile shaders behind the loading screen.
  requestAnimationFrame((t) => {
    last = t
    frame(t)
    setTimeout(() => {
      $('loading').classList.add('done')
      menu.hidden = false
    }, 250)
  })

  // Debug/test handle: advance the simulation without rendering.
  const advance = (seconds, step = 1 / 60) => {
    for (let t = 0; t < seconds; t += step) {
      game.update(step, input)
      surfer.update(step, board)
      effects.update(step, board, camera)
      spray.update(step, field)
      rig.update(step, board, { side: Math.sign(board.pos.x - game.peak) || 1, dir: game.rideDir() })
    }
  }
  window.__swell = { game, board, field, rig, renderer, camera, post, input, advance, applyQuality, applyTime }
}

boot()
