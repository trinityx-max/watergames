// Procedural surfer and board. The rider is a puppet of capsules placed
// between joint positions; feet and hands are solved with two-bone IK so the
// stance stays planted while the body compresses, leans and paddles.

import {
  CanvasTexture,
  CapsuleGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  Quaternion,
  Shape,
  ExtrudeGeometry,
  SphereGeometry,
  Vector3,
  Matrix4,
  BoxGeometry,
  SRGBColorSpace,
  ClampToEdgeWrapping,
} from 'three'
import { MODE } from '../physics/Board.js'

const Y = new Vector3(0, 1, 0)
const BOARD_LEN = 1.9
const DECK = 0.075

function boardTexture() {
  const c = document.createElement('canvas')
  c.width = 128
  c.height = 512
  const g = c.getContext('2d')
  const grad = g.createLinearGradient(0, 0, 0, 512)
  grad.addColorStop(0, '#f6efe2')
  grad.addColorStop(1, '#efe3cf')
  g.fillStyle = grad
  g.fillRect(0, 0, 128, 512)
  g.fillStyle = '#ff6b3d'
  g.fillRect(0, 300, 128, 26)
  g.fillStyle = '#16b3a6'
  g.fillRect(0, 334, 128, 10)
  g.fillStyle = '#ff6b3d'
  g.fillRect(0, 70, 128, 8)
  g.fillStyle = 'rgba(60,40,20,0.55)'
  g.fillRect(63, 0, 2, 512)
  // Traction pad near the tail.
  g.fillStyle = '#1b1d22'
  g.beginPath()
  g.roundRect(28, 440, 72, 58, 10)
  g.fill()
  const t = new CanvasTexture(c)
  t.colorSpace = SRGBColorSpace
  t.wrapS = t.wrapT = ClampToEdgeWrapping
  // Map shape coordinates (metres) into the canvas.
  t.repeat.set(1 / 0.56, 1 / BOARD_LEN)
  t.offset.set(0.5, 0.5)
  return t
}

function buildBoard() {
  const half = BOARD_LEN / 2
  const hw = (t) => 0.265 * Math.pow(Math.sin(Math.PI * (0.085 + 0.915 * t)), 0.62) * (1 - 0.12 * t)
  const shape = new Shape()
  const N = 40
  shape.moveTo(0, -half)
  for (let i = 0; i <= N; i++) {
    const t = i / N
    shape.lineTo(hw(t), -half + t * BOARD_LEN)
  }
  for (let i = N; i >= 0; i--) {
    const t = i / N
    shape.lineTo(-hw(t), -half + t * BOARD_LEN)
  }
  const geo = new ExtrudeGeometry(shape, { depth: 0.035, bevelEnabled: true, bevelThickness: 0.02, bevelSize: 0.02, bevelSegments: 3, curveSegments: 4 })
  geo.rotateX(Math.PI / 2)
  // After rotation the extrusion points down; flip it up, then add rocker.
  geo.rotateZ(Math.PI)
  const pos = geo.attributes.position
  let minY = Infinity
  for (let i = 0; i < pos.count; i++) minY = Math.min(minY, pos.getY(i))
  for (let i = 0; i < pos.count; i++) {
    const z = pos.getZ(i)
    const nz = z / half
    const rocker = 0.17 * Math.pow(Math.max(nz, 0), 2.3) + 0.05 * Math.pow(Math.max(-nz, 0), 2)
    pos.setY(i, pos.getY(i) - minY + rocker)
  }
  geo.computeVertexNormals()
  const mat = new MeshStandardMaterial({ map: boardTexture(), roughness: 0.32, metalness: 0.0 })
  const board = new Mesh(geo, mat)
  const finMat = new MeshStandardMaterial({ color: 0x1b1d22, roughness: 0.4 })
  const finShape = new Shape()
  finShape.moveTo(0, 0)
  finShape.lineTo(0.11, 0)
  finShape.quadraticCurveTo(0.02, -0.04, -0.03, -0.12)
  finShape.lineTo(0, 0)
  const finGeo = new ExtrudeGeometry(finShape, { depth: 0.008, bevelEnabled: false })
  finGeo.rotateY(Math.PI / 2)
  const fins = [
    [0, -0.82, 0],
    [0.15, -0.68, 0.12],
    [-0.15, -0.68, -0.12],
  ]
  for (const [x, z, tw] of fins) {
    const f = new Mesh(finGeo, finMat)
    f.position.set(x, 0.04, z)
    f.rotation.y = tw
    board.add(f)
  }
  return board
}

function ik(root, target, l1, l2, pole, outMid) {
  const d = target.clone().sub(root)
  let len = d.length()
  const maxLen = l1 + l2 - 1e-3
  if (len > maxLen) {
    d.multiplyScalar(maxLen / len)
    len = maxLen
  }
  len = Math.max(len, 0.05)
  const dir = d.clone().normalize()
  const a = (l1 * l1 - l2 * l2 + len * len) / (2 * len)
  const h = Math.sqrt(Math.max(0, l1 * l1 - a * a))
  const p = pole.clone().addScaledVector(dir, -pole.dot(dir))
  if (p.lengthSq() < 1e-6) p.set(0, 0, 1)
  p.normalize()
  outMid.copy(root).addScaledVector(dir, a).addScaledVector(p, h)
  return root.clone().add(d)
}

const L = { thigh: 0.45, shin: 0.45, upper: 0.29, fore: 0.28, spine: 0.44 }

export class SurferModel {
  constructor() {
    this.group = new Group()
    this.boardPivot = new Group()
    this.group.add(this.boardPivot)
    this.board = buildBoard()
    this.boardPivot.add(this.board)
    this.rider = new Group()
    this.rider.rotation.y = -Math.PI / 2
    this.rider.position.y = DECK
    this.boardPivot.add(this.rider)
    this.riderPivot = new Group()
    this.rider.add(this.riderPivot)

    const suit = new MeshStandardMaterial({ color: 0x111419, roughness: 0.38, metalness: 0.05 })
    const accent = new MeshStandardMaterial({ color: 0x16b3a6, roughness: 0.4 })
    const skin = new MeshStandardMaterial({ color: 0xb87b55, roughness: 0.55 })
    const hair = new MeshStandardMaterial({ color: 0x241810, roughness: 0.7 })
    const cap = (r, len, mat) => {
      const m = new Mesh(new CapsuleGeometry(r, len, 4, 10), mat)
      m.castShadow = true
      this.riderPivot.add(m)
      return m
    }
    this.parts = {
      torso: cap(0.15, 0.32, suit),
      chest: cap(0.17, 0.12, accent),
      neck: cap(0.055, 0.08, skin),
      thighL: cap(0.085, L.thigh - 0.1, suit),
      thighR: cap(0.085, L.thigh - 0.1, suit),
      shinL: cap(0.065, L.shin - 0.08, skin),
      shinR: cap(0.065, L.shin - 0.08, skin),
      upperL: cap(0.058, L.upper - 0.07, suit),
      upperR: cap(0.058, L.upper - 0.07, suit),
      foreL: cap(0.046, L.fore - 0.06, skin),
      foreR: cap(0.046, L.fore - 0.06, skin),
    }
    const head = new Mesh(new SphereGeometry(0.115, 18, 14), skin)
    const hairCap = new Mesh(new SphereGeometry(0.122, 18, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), hair)
    hairCap.rotation.x = -0.35
    head.add(hairCap)
    head.scale.set(0.92, 1.05, 1)
    this.riderPivot.add(head)
    this.head = head
    const footGeo = new BoxGeometry(0.1, 0.06, 0.25)
    footGeo.translate(0, 0.03, 0.05)
    this.footL = new Mesh(footGeo, skin)
    this.footR = new Mesh(footGeo, skin)
    const handGeo = new SphereGeometry(0.05, 8, 6)
    this.handL = new Mesh(handGeo, skin)
    this.handR = new Mesh(handGeo, skin)
    for (const m of [this.footL, this.footR, this.handL, this.handR]) this.riderPivot.add(m)

    this.j = {}
    for (const k of ['pelvis', 'chest', 'neck', 'head', 'hipL', 'hipR', 'kneeL', 'kneeR', 'footL', 'footR', 'shL', 'shR', 'elL', 'elR', 'handL', 'handR'])
      this.j[k] = new Vector3()
    this.pose = { stand: 0, sit: 1, compress: 0, lean: 0, grab: 0, crouch: 0, flail: 0 }
    this.t = 0
    this.boardQuat = new Quaternion()
    this._m = new Matrix4()
    this.wipeOffset = new Vector3()
  }

  _seg(mesh, a, b) {
    mesh.position.copy(a).add(b).multiplyScalar(0.5)
    const d = b.clone().sub(a)
    if (d.lengthSq() < 1e-8) return
    mesh.quaternion.setFromUnitVectors(Y, d.normalize())
  }

  update(dt, board) {
    this.t += dt
    const P = this.pose
    const k = 1 - Math.exp(-10 * dt)
    const mode = board.mode
    const standing = mode === MODE.RIDING || mode === MODE.AIR || mode === MODE.POPUP
    const idle = mode === MODE.PRONE && board.input.throttle < 0.05 && board.speed < 0.8 && board.modeTime > 0.3
    this._sitTimer = idle ? (this._sitTimer || 0) + dt : 0
    const sitting = mode === MODE.PRONE && this._sitTimer > 1.2
    const popK = mode === MODE.POPUP ? 1 - Math.exp(-18 * dt) : k
    P.stand += ((standing ? 1 : 0) - P.stand) * popK
    P.sit += ((sitting ? 1 : 0) - P.sit) * (1 - Math.exp(-3 * dt))
    P.compress += ((mode === MODE.AIR ? 0.65 : board.compress * 0.8 + Math.min(1, Math.abs(board.lean) * 0.6) * 0.3) - P.compress) * k
    P.lean += (Math.max(-1, Math.min(1, board.lean / 0.7)) - P.lean) * k
    P.grab += ((mode === MODE.AIR && board.input.grab ? 1 : 0) - P.grab) * k
    P.crouch += ((board.inTube ? 1 : 0) - P.crouch) * (1 - Math.exp(-5 * dt))
    P.flail += ((mode === MODE.WIPEOUT ? 1 : 0) - P.flail) * (1 - Math.exp(-6 * dt))

    this._solvePose(board)
    this._applyTransform(dt, board)
  }

  _solvePose(board) {
    const P = this.pose
    const j = this.j
    const v = (x, y, z) => new Vector3(x, y, z)
    const mixV = (a, b, t) => a.clone().lerp(b, t)

    // ---- Standing stance (rider space: chest faces +z, nose is +x) ----
    const c = Math.min(1, P.compress + P.crouch * 0.6)
    const lean = P.lean
    const sPel = v(0.03 + lean * 0.02, 0.8 - 0.26 * c - 0.12 * P.crouch, 0.06 + 0.1 * lean)
    const bend = 0.42 + 0.4 * c + 0.2 * lean + 0.25 * P.crouch
    const sChest = sPel.clone().add(v(0.07 + 0.04 * c, L.spine * Math.cos(bend), L.spine * Math.sin(bend)))
    const sFootL = v(0.37, 0, 0.02)
    const sFootR = v(-0.42, 0, -0.03)
    const sway = Math.sin(this.t * 1.7) * 0.03
    const sHandL = v(0.72, 1.0 - 0.32 * c + sway + lean * 0.12, 0.28 + 0.2 * lean)
    const sHandR = v(-0.55, 0.8 - 0.3 * c - sway - lean * 0.1, 0.16 - 0.25 * lean)
    if (P.grab > 0.01) {
      sHandR.lerp(v(0.05, 0.08, 0.3), P.grab)
      sHandL.lerp(v(0.6, 1.25, 0.1), P.grab)
    }
    if (P.crouch > 0.01) sHandL.lerp(v(0.65, 0.65, 0.45), P.crouch)

    // ---- Prone paddling (head toward the nose) ----
    const ph = board.stroke * Math.PI * 2
    const paddling = board.input.throttle > 0.05 ? 1 : 0
    this._paddle = (this._paddle || 0) + (paddling - (this._paddle || 0)) * 0.08
    const pd = this._paddle
    const pPel = v(-0.32, 0.12, 0)
    const pChest = v(0.12, 0.25 + 0.03 * Math.sin(ph * 2) * pd, 0)
    const kick = Math.sin(this.t * 6) * 0.05 * pd
    const pFootL = v(-1.12, 0.18 + kick, 0.13)
    const pFootR = v(-1.12, 0.18 - kick, -0.13)
    const stroke = (phase, side) => {
      const reach = v(0.62 * Math.cos(phase) + 0.15, -0.12 - 0.36 * Math.max(0, Math.sin(phase)) + 0.1 * Math.min(0, Math.sin(phase)), side * (0.32 + 0.06 * Math.cos(phase)))
      const rest = v(0.25, 0.0, side * 0.24)
      return rest.lerp(reach, pd)
    }
    const pHandL = stroke(ph, 1)
    const pHandR = stroke(ph + Math.PI, -1)

    // ---- Sitting on the board waiting for a set ----
    const st = this.t
    const sitPel = v(-0.15, 0.1, 0)
    const sitChest = v(-0.1, 0.56, 0.02)
    const sitFootL = v(0.12 + Math.sin(st * 1.3) * 0.08, -0.55, 0.22)
    const sitFootR = v(0.12 - Math.sin(st * 1.3) * 0.08, -0.55, -0.22)
    const sitHandL = v(0.28, 0.02, 0.24)
    const sitHandR = v(0.28, 0.02, -0.24)

    const lying = 1 - P.stand
    const sit = P.sit * lying
    const prone = lying - sit
    const blend3 = (a, b, s) => a.clone().multiplyScalar(P.stand).addScaledVector(b, prone).addScaledVector(s, sit)

    j.pelvis.copy(blend3(sPel, pPel, sitPel))
    j.chest.copy(blend3(sChest, pChest, sitChest))
    const upDir = j.chest.clone().sub(j.pelvis).normalize()
    const proneHead = v(0.47, 0.42, 0)
    const sHead = j.chest.clone().add(upDir.clone().multiplyScalar(0.27)).add(v(0.06, 0, 0.02))
    const sitHead = sitChest.clone().add(v(-0.02, 0.27, 0.03))
    j.head.copy(blend3(sHead, proneHead, sitHead))
    j.neck.copy(j.chest).lerp(j.head, 0.45)

    const fwd = v(0, 0, 1)
    const across = v(1, 0, 0)
    const hipOff = mixV(across, v(0, 0, 1), lying).multiplyScalar(0.1)
    j.hipL.copy(j.pelvis).add(hipOff)
    j.hipR.copy(j.pelvis).sub(hipOff)
    const shOff = mixV(across, v(0, 0, 1), lying).multiplyScalar(0.19)
    j.shL.copy(j.chest).add(shOff).add(v(0, -0.02, 0))
    j.shR.copy(j.chest).sub(shOff).add(v(0, -0.02, 0))

    let footL = blend3(sFootL, pFootL, sitFootL)
    let footR = blend3(sFootR, pFootR, sitFootR)
    let handL = blend3(sHandL, pHandL, sitHandL)
    let handR = blend3(sHandR, pHandR, sitHandR)

    if (P.flail > 0.01) {
      const t = this.t * 7
      footL.lerp(v(0.5 + Math.sin(t) * 0.3, -0.4, 0.4), P.flail)
      footR.lerp(v(-0.5, -0.5 + Math.cos(t * 1.3) * 0.3, -0.3), P.flail)
      handL.lerp(v(0.4, 1.3 + Math.sin(t * 1.7) * 0.2, 0.3), P.flail)
      handR.lerp(v(-0.4, 1.2 + Math.cos(t * 1.1) * 0.2, 0.4), P.flail)
    }

    const kneePoleL = mixV(v(0.35, 0, 1), v(0, -1, 0), lying).add(v(0, 0, sit))
    const kneePoleR = mixV(v(0.6, 0, 1), v(0, -1, 0), lying).add(v(0, 0, sit))
    j.footL.copy(ik(j.hipL, footL, L.thigh, L.shin, kneePoleL, j.kneeL))
    j.footR.copy(ik(j.hipR, footR, L.thigh, L.shin, kneePoleR, j.kneeR))
    const elbowPole = mixV(v(0, -0.6, -1), v(-0.5, 1, 0), prone)
    j.handL.copy(ik(j.shL, handL, L.upper, L.fore, elbowPole.clone().add(v(0, 0, 0.3)), j.elL))
    j.handR.copy(ik(j.shR, handR, L.upper, L.fore, elbowPole, j.elR))
    this._fwd = fwd
  }

  _applyTransform(dt, board) {
    const j = this.j
    const p = this.parts
    this._seg(p.torso, j.pelvis, j.chest.clone().lerp(j.pelvis, 0.15))
    this._seg(p.chest, j.chest.clone().lerp(j.pelvis, 0.3), j.chest)
    this._seg(p.neck, j.chest, j.head)
    this.head.position.copy(j.head)
    this._seg(p.thighL, j.hipL, j.kneeL)
    this._seg(p.thighR, j.hipR, j.kneeR)
    this._seg(p.shinL, j.kneeL, j.footL)
    this._seg(p.shinR, j.kneeR, j.footR)
    this._seg(p.upperL, j.shL, j.elL)
    this._seg(p.upperR, j.shR, j.elR)
    this._seg(p.foreL, j.elL, j.handL)
    this._seg(p.foreR, j.elR, j.handR)
    this.handL.position.copy(j.handL)
    this.handR.position.copy(j.handR)
    this.footL.position.copy(j.footL)
    this.footR.position.copy(j.footR)
    const lying = 1 - this.pose.stand
    this.footL.rotation.set(0, lying * Math.PI * 0.5 + 0.2, 0)
    this.footR.rotation.set(0, lying * Math.PI * 0.5 + 0.35, 0)
    // Head looks toward the nose when standing.
    this.head.rotation.set(0, Math.PI / 2 * this.pose.stand * 0.85, 0)

    // Board orientation: up from the smoothed surface normal, nose along yaw,
    // then roll onto the rail.
    const up = board.up
    const f = new Vector3(Math.sin(board.yaw), 0, Math.cos(board.yaw))
    f.addScaledVector(up, -f.dot(up)).normalize()
    const right = new Vector3().crossVectors(f, up).normalize()
    const m = this._m.makeBasis(right.clone().negate(), up, f)
    this.boardQuat.setFromRotationMatrix(m)
    const roll = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), board.lean)
    const sitPitch = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -0.16 * this.pose.sit * (1 - this.pose.stand))
    this.group.position.copy(board.pos)
    this.group.quaternion.copy(this.boardQuat)
    this.boardPivot.quaternion.copy(roll).multiply(sitPitch)
    this.boardPivot.position.set(0, -0.02 * this.pose.sit, 0)

    // Wipeout: the board cartwheels away while the rider tumbles.
    if (board.mode === MODE.WIPEOUT && board.wipe) {
      const w = board.wipe
      this.board.rotation.set(w.rotX, 0, w.rotZ)
      this.board.position.set(Math.sin(w.t * 2) * 0.6, 0.3 * Math.exp(-w.t), -1.2 * (1 - Math.exp(-w.t * 2)))
      this.rider.rotation.set(-w.rotX * 0.6, -Math.PI / 2, w.rotZ * 0.5)
      this.rider.position.set(0, DECK - 0.4 * (1 - Math.exp(-w.t * 3)), 0)
    } else {
      this.board.rotation.set(0, 0, 0)
      this.board.position.set(0, 0, 0)
      this.rider.rotation.set(0, -Math.PI / 2, 0)
      this.rider.position.set(0, DECK, 0)
    }
  }
}
