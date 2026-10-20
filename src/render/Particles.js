// Spray, mist and whitewater chunks. A fixed pool simulated on the CPU and
// drawn as soft, sun-lit point sprites with premultiplied alpha.

import { BufferAttribute, BufferGeometry, CustomBlending, OneFactor, OneMinusSrcAlphaFactor, Points, ShaderMaterial, AddEquation } from 'three'

export class Spray {
  constructor(max, env) {
    this.max = max
    this.count = 0
    this.pos = new Float32Array(max * 3)
    this.vel = new Float32Array(max * 3)
    this.data = new Float32Array(max * 3) // size, alpha, mist
    this.life = new Float32Array(max)
    this.maxLife = new Float32Array(max)
    this.size0 = new Float32Array(max)
    this.drag = new Float32Array(max)
    this.grav = new Float32Array(max)
    const g = new BufferGeometry()
    this.posAttr = new BufferAttribute(this.pos, 3)
    this.dataAttr = new BufferAttribute(this.data, 3)
    this.posAttr.setUsage(35048)
    this.dataAttr.setUsage(35048)
    g.setAttribute('position', this.posAttr)
    g.setAttribute('aData', this.dataAttr)
    g.setDrawRange(0, 0)
    this.geometry = g
    this.material = new ShaderMaterial({
      uniforms: {
        uSunColor: env.uniforms.uSunColor,
        uSunIntensity: env.uniforms.uSunIntensity,
        uAmbient: env.uniforms.uAmbient,
        uScatter: env.uniforms.uScatter,
        uSunDir: env.uniforms.uSunDir,
        uScale: { value: 600 },
      },
      vertexShader: /* glsl */ `
        in vec3 aData;
        uniform float uScale;
        out float vAlpha;
        out float vMist;
        out vec3 vView;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = clamp(aData.x * uScale / -mv.z, 1.0, 180.0);
          vAlpha = aData.y;
          vMist = aData.z;
          vView = normalize(position - cameraPosition);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uSunColor;
        uniform float uSunIntensity;
        uniform vec3 uAmbient;
        uniform vec3 uScatter;
        uniform vec3 uSunDir;
        in float vAlpha;
        in float vMist;
        in vec3 vView;
        void main() {
          vec2 c = gl_PointCoord * 2.0 - 1.0;
          float r = dot(c, c);
          if (r > 1.0) discard;
          float soft = mix(pow(1.0 - r, 1.5), pow(1.0 - r, 2.5), vMist);
          float a = soft * vAlpha;
          float forward = pow(max(dot(vView, uSunDir), 0.0), 6.0);
          vec3 sun = uSunColor * uSunIntensity;
          vec3 col = vec3(0.92, 0.95, 0.98) * (uAmbient * 0.95 + sun * 0.42) + uScatter * sun * 0.25 * (1.0 - r);
          col += sun * forward * 0.45 * vMist;
          gl_FragColor = vec4(col * a, a);
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: CustomBlending,
      blendEquation: AddEquation,
      blendSrc: OneFactor,
      blendDst: OneMinusSrcAlphaFactor,
    })
    this.points = new Points(g, this.material)
    this.points.frustumCulled = false
    this.points.renderOrder = 5
  }

  emit(x, y, z, vx, vy, vz, size = 0.3, life = 1.2, mist = 0, drag = 0.6, grav = 1) {
    if (this.count >= this.max) return
    const i = this.count++
    this.pos[i * 3] = x
    this.pos[i * 3 + 1] = y
    this.pos[i * 3 + 2] = z
    this.vel[i * 3] = vx
    this.vel[i * 3 + 1] = vy
    this.vel[i * 3 + 2] = vz
    this.life[i] = life
    this.maxLife[i] = life
    this.size0[i] = size
    this.drag[i] = drag
    this.grav[i] = grav
    this.data[i * 3 + 2] = mist
  }

  burst(x, y, z, n, speed, up, size = 0.3, spread = 1) {
    for (let k = 0; k < n; k++) {
      const a = Math.random() * Math.PI * 2
      const s = speed * (0.3 + Math.random() * 0.7)
      this.emit(
        x + (Math.random() - 0.5) * spread,
        y,
        z + (Math.random() - 0.5) * spread,
        Math.cos(a) * s,
        up * (0.5 + Math.random() * 0.8),
        Math.sin(a) * s,
        size * (0.5 + Math.random()),
        0.7 + Math.random() * 0.9,
        Math.random() < 0.3 ? 1 : 0,
      )
    }
  }

  update(dt, field) {
    let i = 0
    while (i < this.count) {
      this.life[i] -= dt
      const o = i * 3
      if (this.life[i] <= 0) {
        this._kill(i)
        continue
      }
      const d = Math.exp(-this.drag[i] * dt)
      this.vel[o] *= d
      this.vel[o + 1] = this.vel[o + 1] * d - 9.81 * this.grav[i] * dt
      this.vel[o + 2] *= d
      this.pos[o] += this.vel[o] * dt
      this.pos[o + 1] += this.vel[o + 1] * dt
      this.pos[o + 2] += this.vel[o + 2] * dt
      const t = this.life[i] / this.maxLife[i]
      const mist = this.data[o + 2]
      this.data[o] = this.size0[i] * (1 + (1 - t) * (mist > 0.5 ? 1.6 : 1.2))
      this.data[o + 1] = Math.min(1, t * 2.5) * (mist > 0.5 ? 0.13 : 0.7)
      // Droplets that fall back into the sea are gone.
      if (this.vel[o + 1] < 0 && (i & 3) === 0 && field && this.pos[o + 1] < field.heightAt(this.pos[o], this.pos[o + 2]) - 0.1) {
        this._kill(i)
        continue
      }
      i++
    }
    this.posAttr.needsUpdate = true
    this.dataAttr.needsUpdate = true
    this.posAttr.clearUpdateRanges()
    this.dataAttr.clearUpdateRanges()
    this.posAttr.addUpdateRange(0, this.count * 3)
    this.dataAttr.addUpdateRange(0, this.count * 3)
    this.geometry.setDrawRange(0, this.count)
  }

  _kill(i) {
    const last = --this.count
    if (i === last) return
    const a = i * 3
    const b = last * 3
    for (let k = 0; k < 3; k++) {
      this.pos[a + k] = this.pos[b + k]
      this.vel[a + k] = this.vel[b + k]
      this.data[a + k] = this.data[b + k]
    }
    this.life[i] = this.life[last]
    this.maxLife[i] = this.maxLife[last]
    this.size0[i] = this.size0[last]
    this.drag[i] = this.drag[last]
    this.grav[i] = this.grav[last]
  }

  clear() {
    this.count = 0
  }
}
