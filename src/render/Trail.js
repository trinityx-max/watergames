// Foam wake left by the board: a ribbon draped on the live water surface that
// widens and breaks up as it ages.

import { BufferAttribute, BufferGeometry, Mesh, ShaderMaterial } from 'three'

export class Trail {
  constructor(env, maxPoints = 180) {
    this.max = maxPoints
    this.points = []
    this.pos = new Float32Array(maxPoints * 2 * 3)
    this.attr = new Float32Array(maxPoints * 2 * 3) // age01, side, strength
    const idx = []
    for (let i = 0; i < maxPoints - 1; i++) {
      const a = i * 2
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2)
    }
    const g = new BufferGeometry()
    this.posAttr = new BufferAttribute(this.pos, 3)
    this.dataAttr = new BufferAttribute(this.attr, 3)
    g.setAttribute('position', this.posAttr)
    g.setAttribute('aTrail', this.dataAttr)
    g.setIndex(idx)
    g.setDrawRange(0, 0)
    this.geometry = g
    this.material = new ShaderMaterial({
      uniforms: {
        uNoise: env.uniforms.uNoise,
        uSunColor: env.uniforms.uSunColor,
        uSunIntensity: env.uniforms.uSunIntensity,
        uAmbient: env.uniforms.uAmbient,
        uTime: env.uniforms.uTime,
      },
      vertexShader: /* glsl */ `
        in vec3 aTrail;
        out vec3 vT;
        out vec2 vXZ;
        void main() {
          vT = aTrail;
          vXZ = position.xz;
          gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D uNoise;
        uniform vec3 uSunColor;
        uniform float uSunIntensity;
        uniform vec3 uAmbient;
        uniform float uTime;
        in vec3 vT;
        in vec2 vXZ;
        void main() {
          float age = vT.x;
          float edge = 1.0 - abs(vT.y);
          float n = texture(uNoise, vXZ * 0.35).a * 0.6 + texture(uNoise, vXZ * 0.09 + uTime * 0.01).b * 0.6;
          float core = smoothstep(0.0, 0.5, edge) * (1.0 - age);
          float m = smoothstep(0.75 - core, 1.0 - core * 0.6, n + core * 0.5) * vT.z * (1.0 - age);
          vec3 col = vec3(0.92, 0.95, 0.97) * (uAmbient * 0.95 + uSunColor * uSunIntensity * 0.45);
          gl_FragColor = vec4(col * m * 0.9, m * 0.9);
        }
      `,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
      premultipliedAlpha: true,
    })
    this.mesh = new Mesh(g, this.material)
    this.mesh.frustumCulled = false
    this.mesh.renderOrder = 3
    this.lastEmit = 0
    this.life = 3.2
  }

  clear() {
    this.points.length = 0
    this.geometry.setDrawRange(0, 0)
  }

  update(time, board, field, active, strength) {
    const p = this.points
    if (active && time - this.lastEmit > 0.045) {
      this.lastEmit = time
      // Start a fresh ribbon after a gap: a zero-strength joint hides the bridge.
      if (!this.wasActive && p.length) {
        const q = p[p.length - 1]
        p.push({ ...q, s: 0 })
        p.push({ ...q, x: board.pos.x, z: board.pos.z, t: time, s: 0 })
      }
      // Lateral direction from heading.
      const lx = Math.cos(board.yaw)
      const lz = -Math.sin(board.yaw)
      const back = 0.75
      p.push({
        x: board.pos.x - Math.sin(board.yaw) * back,
        z: board.pos.z - Math.cos(board.yaw) * back,
        lx,
        lz,
        t: time,
        s: strength,
      })
      if (p.length > this.max) p.shift()
    }
    this.wasActive = active
    while (p.length && time - p[0].t > this.life) p.shift()
    const n = p.length
    for (let i = 0; i < n; i++) {
      const q = p[i]
      const age = (time - q.t) / this.life
      const w = 0.28 + age * 1.6
      const h = field.heightAt(q.x, q.z) + 0.03
      const o = i * 6
      this.pos[o] = q.x + q.lx * w
      this.pos[o + 1] = h
      this.pos[o + 2] = q.z + q.lz * w
      this.pos[o + 3] = q.x - q.lx * w
      this.pos[o + 4] = h
      this.pos[o + 5] = q.z - q.lz * w
      const s = q.s * Math.min(1, (n - 1 - i) / 3 + 0.2) * (i > 0 && p[i - 1].s === 0 ? 0 : 1)
      this.attr[o] = age
      this.attr[o + 1] = 1
      this.attr[o + 2] = s
      this.attr[o + 3] = age
      this.attr[o + 4] = -1
      this.attr[o + 5] = s
    }
    this.posAttr.needsUpdate = true
    this.dataAttr.needsUpdate = true
    this.geometry.setDrawRange(0, Math.max(0, (n - 1) * 6))
  }
}
