// Beach, dunes, a rocky headland framing the bay, palms, and hazy islands on
// the horizon. Standard lit materials with exponential fog matched to the sky.

import {
  BufferAttribute,
  Color,
  CylinderGeometry,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  SphereGeometry,
  CatmullRomCurve3,
  TubeGeometry,
  Vector3,
  ConeGeometry,
} from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { WORLD } from '../config.js'

function hash(x, y) {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453
  return s - Math.floor(s)
}
function vnoise(x, y) {
  const ix = Math.floor(x)
  const iy = Math.floor(y)
  const fx = x - ix
  const fy = y - iy
  const u = fx * fx * (3 - 2 * fx)
  const v = fy * fy * (3 - 2 * fy)
  const a = hash(ix, iy)
  const b = hash(ix + 1, iy)
  const c = hash(ix, iy + 1)
  const d = hash(ix + 1, iy + 1)
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v
}
function fbm(x, y, o = 4) {
  let s = 0
  let a = 0.5
  for (let i = 0; i < o; i++) {
    s += vnoise(x, y) * a
    x *= 2.03
    y *= 2.03
    a *= 0.5
  }
  return s
}
const sstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

export function terrainHeight(x, z) {
  const d = z - WORLD.shoreZ
  let y = d * 0.042
  y += sstep(50, 190, d) * (5 + 6 * fbm(x * 0.012, z * 0.012))
  y += sstep(220, 700, d) * (30 + 70 * fbm(x * 0.004 + 3, z * 0.004))
  // Rocky headland on the left side of the bay, running out to sea.
  const head = sstep(-470, -700, x) * sstep(WORLD.shoreZ - 430, WORLD.shoreZ - 150, z)
  y = Math.max(y, head * (26 + 55 * fbm(x * 0.008, z * 0.008, 5)) - (1 - head) * 30)
  return y
}

function buildTerrain() {
  const geo = new PlaneGeometry(5200, 1900, 360, 170)
  geo.rotateX(-Math.PI / 2)
  geo.translate(0, 0, WORLD.shoreZ + 620)
  const pos = geo.attributes.position
  const colors = new Float32Array(pos.count * 3)
  const wet = new Color(0.32, 0.26, 0.19)
  const sand = new Color(0.8, 0.68, 0.5)
  const grass = new Color(0.27, 0.33, 0.14)
  const forest = new Color(0.13, 0.2, 0.09)
  const rock = new Color(0.33, 0.29, 0.26)
  const c = new Color()
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i)
    const z = pos.getZ(i)
    const y = terrainHeight(x, z)
    pos.setY(i, y)
    const slope = Math.hypot(terrainHeight(x + 2, z) - y, terrainHeight(x, z + 2) - y) / 2
    const d = z - WORLD.shoreZ
    c.copy(wet).lerp(sand, sstep(2, 14, d))
    c.lerp(grass, sstep(60, 150, d) * sstep(4, 10, y))
    c.lerp(forest, sstep(200, 500, d) * 0.8)
    c.lerp(rock, sstep(0.45, 0.9, slope))
    const n = 0.85 + 0.3 * fbm(x * 0.05, z * 0.05, 3)
    colors[i * 3] = c.r * n
    colors[i * 3 + 1] = c.g * n
    colors[i * 3 + 2] = c.b * n
  }
  geo.setAttribute('color', new BufferAttribute(colors, 3))
  geo.computeVertexNormals()
  const mesh = new Mesh(geo, new MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 }))
  mesh.receiveShadow = false
  return mesh
}

function buildPalm() {
  const curve = new CatmullRomCurve3([
    new Vector3(0, 0, 0),
    new Vector3(0.4, 3, 0),
    new Vector3(1.4, 6, 0),
    new Vector3(2.6, 8.6, 0),
  ])
  const trunk = new TubeGeometry(curve, 10, 0.22, 6, false)
  const trunkColor = new Color(0.33, 0.25, 0.17)
  const parts = [trunk]
  const colorFor = [trunkColor]
  const top = curve.getPoint(1)
  for (let i = 0; i < 9; i++) {
    const frond = new SphereGeometry(1, 8, 4)
    frond.scale(2.6, 0.06, 0.45)
    frond.translate(2.3, 0, 0)
    const m = new Matrix4()
    const droop = -0.35 - Math.random() * 0.3
    m.makeRotationZ(droop)
    frond.applyMatrix4(m)
    m.makeRotationY((i / 9) * Math.PI * 2 + Math.random() * 0.3)
    frond.applyMatrix4(m)
    frond.translate(top.x, top.y, top.z)
    parts.push(frond)
    colorFor.push(new Color(0.12 + Math.random() * 0.05, 0.26 + Math.random() * 0.08, 0.08))
  }
  parts.forEach((g, i) => {
    const n = g.attributes.position.count
    const col = new Float32Array(n * 3)
    for (let j = 0; j < n; j++) colorFor[i].toArray(col, j * 3)
    g.setAttribute('color', new BufferAttribute(col, 3))
    if (g.index === null) return
  })
  return mergeGeometries(parts.map((g) => (g.index ? g.toNonIndexed() : g)))
}

function buildIsland(scale, seed) {
  const g = new ConeGeometry(1, 1, 40, 8, true)
  const pos = g.attributes.position
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i)
    const y = pos.getY(i)
    const z = pos.getZ(i)
    const a = Math.atan2(z, x)
    const r = 1 + 0.25 * (fbm(Math.cos(a) * 2 + seed, Math.sin(a) * 2 + seed, 4) - 0.5) * 2
    const h = y + 0.5
    pos.setXYZ(i, x * r, Math.pow(h, 1.6) * (0.8 + 0.4 * fbm(a * 3 + seed, h * 3, 3)) - 0.02, z * r)
  }
  g.scale(scale, scale * 0.28, scale * 0.6)
  g.computeVertexNormals()
  return g
}

export function createLand() {
  const group = new Group()
  group.add(buildTerrain())

  const palmGeo = buildPalm()
  const palms = new InstancedMesh(palmGeo, new MeshStandardMaterial({ vertexColors: true, roughness: 0.85 }), 70)
  const o = new Object3D()
  let n = 0
  for (let i = 0; i < 400 && n < 70; i++) {
    const x = -250 + Math.random() * 1400
    const z = WORLD.shoreZ + 30 + Math.random() * 110
    const y = terrainHeight(x, z)
    if (y < 1.5) continue
    o.position.set(x, y - 0.2, z)
    o.rotation.set(0, Math.random() * Math.PI * 2, (Math.random() - 0.5) * 0.15)
    o.scale.setScalar(0.8 + Math.random() * 0.6)
    o.updateMatrix()
    palms.setMatrixAt(n++, o.matrix)
  }
  palms.count = n
  group.add(palms)

  const islandMat = new MeshStandardMaterial({ color: new Color(0.16, 0.2, 0.17), roughness: 1, flatShading: false })
  const islands = [
    [-1300, -2600, 520, 1],
    [900, -3300, 700, 5],
    [2600, -2400, 380, 9],
  ]
  for (const [x, z, s, seed] of islands) {
    const m = new Mesh(buildIsland(s, seed), islandMat)
    m.position.set(x, -2, z)
    group.add(m)
  }
  // A few sea stacks off the headland catch the light.
  const stackMat = new MeshStandardMaterial({ color: new Color(0.3, 0.27, 0.25), roughness: 0.95 })
  for (let i = 0; i < 5; i++) {
    const g = new CylinderGeometry(3 + Math.random() * 4, 6 + Math.random() * 5, 14 + Math.random() * 18, 7, 3)
    const p = g.attributes.position
    for (let j = 0; j < p.count; j++) p.setX(j, p.getX(j) * (0.85 + Math.random() * 0.3))
    g.computeVertexNormals()
    const m = new Mesh(g, stackMat)
    m.position.set(-520 - i * 45 - Math.random() * 30, 2, WORLD.shoreZ - 190 - i * 35)
    group.add(m)
  }
  return group
}
