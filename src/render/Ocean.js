// The sea: a camera-following grid whose spacing grows exponentially with
// distance (dense at the surfer, kilometres wide at the horizon), plus thin
// "lip" sheets that curl out of the crest wherever a wave is pitching. Both
// share one water shader with analytic per-pixel normals, Fresnel sky
// reflection, sun glitter, subsurface glow through thin water, barrel
// shadowing, and advected whitewater.

import { BufferAttribute, BufferGeometry, DoubleSide, Mesh, ShaderMaterial, Group, Vector2, Vector4, Uniform } from 'three'
import { waveGLSL } from '../waves/waveGLSL.js'
import { skyGLSL } from './Environment.js'
import { WORLD } from '../config.js'
import { MAX_WAVES } from '../waves/WaveField.js'

function buildGridGeometry(segments, s0 = 0.17, radius = 5200) {
  const half = segments / 2
  let lo = 1e-5
  let hi = 1
  for (let i = 0; i < 80; i++) {
    const k = (lo + hi) / 2
    if ((s0 / k) * (Math.exp(k * half) - 1) > radius) hi = k
    else lo = k
  }
  const k = (lo + hi) / 2
  const coords = new Float32Array(segments + 1)
  for (let i = 0; i <= segments; i++) {
    const j = i - half
    coords[i] = Math.sign(j) * (s0 / k) * (Math.exp(k * Math.abs(j)) - 1)
  }
  const n = segments + 1
  const pos = new Float32Array(n * n * 3)
  for (let iz = 0; iz < n; iz++) {
    for (let ix = 0; ix < n; ix++) {
      const o = (iz * n + ix) * 3
      pos[o] = coords[ix]
      pos[o + 1] = 0
      pos[o + 2] = coords[iz]
    }
  }
  const idx = new Uint32Array(segments * segments * 6)
  let p = 0
  for (let iz = 0; iz < segments; iz++) {
    for (let ix = 0; ix < segments; ix++) {
      const a = iz * n + ix
      const b = a + 1
      const c = a + n
      const d = c + 1
      // Alternate the diagonal to avoid a directional sawtooth.
      if ((ix + iz) & 1) {
        idx[p++] = a; idx[p++] = c; idx[p++] = b
        idx[p++] = b; idx[p++] = c; idx[p++] = d
      } else {
        idx[p++] = a; idx[p++] = c; idx[p++] = d
        idx[p++] = a; idx[p++] = d; idx[p++] = b
      }
    }
  }
  const g = new BufferGeometry()
  g.setAttribute('position', new BufferAttribute(pos, 3))
  g.setIndex(new BufferAttribute(idx, 1))
  return g
}

function buildLipGeometry(na, nb) {
  const pos = new Float32Array((na + 1) * (nb + 1) * 3)
  const uv = new Float32Array((na + 1) * (nb + 1) * 2)
  for (let j = 0; j <= nb; j++) {
    for (let i = 0; i <= na; i++) {
      const o = j * (na + 1) + i
      uv[o * 2] = i / na
      // Bias toward the tip so the curl edge stays round.
      const b = j / nb
      uv[o * 2 + 1] = 1 - (1 - b) * (1 - b) * 0.35 - (1 - b) * 0.65
    }
  }
  const idx = []
  for (let j = 0; j < nb; j++) {
    for (let i = 0; i < na; i++) {
      const a = j * (na + 1) + i
      const b = a + 1
      const c = a + na + 1
      const d = c + 1
      idx.push(a, c, b, b, c, d)
    }
  }
  const g = new BufferGeometry()
  g.setAttribute('position', new BufferAttribute(pos, 3))
  g.setAttribute('lipUV', new BufferAttribute(uv, 2))
  g.setIndex(idx)
  return g
}

const waterFragment = (isLip) => /* glsl */ `
${waveGLSL}
${skyGLSL}
uniform vec3 uDeep;
uniform vec3 uScatter;
uniform vec3 uAmbient;
uniform float uShoreZ;
in vec3 vWorld;
${isLip ? 'in vec3 vNormal; in vec4 vLip;' : ''}

vec2 detailSlope(vec2 p, float dist) {
  float t = uTime;
  vec2 d = (texture(uNoise, p * 0.043 + vec2(0.011, 0.019) * t).rg - 0.5) * 1.0;
  d += (texture(uNoise, p * 0.107 + vec2(-0.023, 0.014) * t).rg - 0.5) * 0.75;
  float nearF = exp(-dist / 45.0);
  d += (texture(uNoise, p * 0.29 + vec2(0.037, -0.029) * t).rg - 0.5) * 0.5 * nearF;
  d += (texture(uNoise, p * 0.71 - vec2(0.05, 0.061) * t).rg - 0.5) * 0.35 * nearF;
  return d * mix(0.55, 0.06, clamp(dist / 900.0, 0.0, 1.0));
}

void main() {
  vec2 p = vWorld.xz;
  vec3 toCam = cameraPosition - vWorld;
  float dist = length(toCam);
  vec3 V = toCam / dist;

  float thin = 0.0;
  float foam = 0.0;
  float tube = 0.0;
  float uDom = 0.0;
  float domW = 0.0;
  vec3 N;

#ifdef IS_LIP
  N = normalize(vNormal);
  float lipB = vLip.x;
  float lipCurl = vLip.y;
  float lipS = vLip.z;
  thin = 0.75 + 0.25 * lipB;
  foam = smoothstep(0.62, 1.0, lipB) * lipCurl * 0.85;
  foam = max(foam, (1.0 - smoothstep(-11.0, -4.5, lipS)) * 0.95);
  foam = max(foam, smoothstep(0.0, 0.12, 0.12 - lipB) * 0.3 * lipCurl);
#else
  float e = clamp(dist * 0.0035, 0.05, 2.0);
  float h0 = oceanHeight(p);
  float hx = oceanHeight(p + vec2(e, 0.0));
  float hz = oceanHeight(p + vec2(0.0, e));
  N = normalize(vec3(h0 - hx, e, h0 - hz));
  for (int i = 0; i < NWAVES; i++) {
    WaveDetail d = waveShape(uWaveA[i], uWaveB[i], p);
    float aN = clamp(d.amp / 2.5, 0.0, 1.3);
    thin = max(thin, d.hn * d.hn * aN * mix(0.55, 1.0, smoothstep(-4.0, 1.0, d.u)));
    float bore = d.broken * (d.u > -2.5 ? 1.0 - smoothstep(1.2, 5.0, d.u) : exp((d.u + 2.5) / 26.0));
    float crash = d.bk * smoothstep(-17.0, -9.0, d.s) * (1.0 - smoothstep(-6.0, -1.5, d.s)) * exp(-pow((d.u - 3.3) / 2.4, 2.0));
    float feather = d.steep * smoothstep(0.86, 0.995, d.hn) * smoothstep(-3.0, -0.6, d.u) * (1.0 - smoothstep(0.2, 1.1, d.u));
    foam = max(foam, max(bore * 0.97, crash) + feather * 0.55);
    float w = d.broken * smoothstep(-34.0, 0.0, d.u);
    if (w > domW) { domW = w; uDom = d.u; }
    tube = max(tube, d.curl * smoothstep(-0.4, 0.5, d.u) * (1.0 - smoothstep(2.4, 4.6, d.u)));
  }
  float shore = smoothstep(uShoreZ - 20.0, uShoreZ - 2.0, p.y);
  float swash = shore * (0.55 + 0.45 * sin(p.y * 0.55 - uTime * 1.1 + texture(uNoise, p * 0.01).b * 6.0));
  foam = max(foam, swash);
#endif

  vec2 ds = detailSlope(p, dist) * (1.0 - foam * 0.6);
  N = normalize(N + vec3(ds.x, 0.0, ds.y));
  float inside = gl_FrontFacing ? 0.0 : 1.0;
  if (!gl_FrontFacing) N = -N;

  // Whitewater pattern, advected with the bore near the wave and left
  // behind in the world as it drifts away from it.
  vec2 fuv = vec2(p.x, mix(p.y, uDom, domW));
  float fcell = texture(uNoise, fuv * 0.083 + vec2(0.0, uTime * 0.035)).a;
  float fcell2 = texture(uNoise, fuv * 0.21 - vec2(uTime * 0.02, 0.0)).a;
  float fval = texture(uNoise, fuv * 0.029 + vec2(uTime * 0.008, 0.0)).b;
  float fpat = fcell * 0.45 + fcell2 * 0.25 + fval * 0.6;
  float foamMask = smoothstep(1.05 - foam, 1.3 - foam, fpat + foam * 0.32) * smoothstep(0.02, 0.2, foam);

  vec3 sun = uSunColor * uSunIntensity;
  float sunVis = smoothstep(-0.04, 0.06, uSunDir.y);
  float NdV = clamp(dot(N, V), 0.0, 1.0);
  float F = 0.02 + 0.98 * pow(1.0 - NdV, 5.0);
  F *= 1.0 - 0.65 * tube;
#ifdef IS_LIP
  // Under the lip you see light coming through it, not the sky.
  F *= 1.0 - 0.75 * inside;
  thin = mix(thin, 1.35, inside);
#endif

  vec3 R = reflect(-V, N);
  R.y = max(R.y, 0.015);
  R = normalize(R);
  vec3 refl = skyColor(R, uTime) * (1.0 - 0.55 * tube);

  float rough = clamp(dist / 650.0, 0.0, 1.0);
  float RdL = max(dot(R, uSunDir), 0.0);
  float spec = pow(RdL, mix(1600.0, 110.0, rough)) * mix(24.0, 2.5, rough) + pow(RdL, 40.0) * 0.12;

  float wrap = clamp(dot(N, uSunDir) * 0.55 + 0.45, 0.0, 1.0);
  vec3 body = uDeep * (uAmbient * 1.8 + sun * 0.12 * wrap);
  // Light through thin water: strongest when looking toward the sun.
  float back = pow(clamp(dot(-V, uSunDir), 0.0, 1.0), 3.0);
  float sideLit = pow(clamp(dot(-N, uSunDir) * 0.5 + 0.5, 0.0, 1.0), 2.0);
  float sss = thin * (0.32 + 2.4 * back + 0.6 * sideLit) + tube * 0.75;
  body += uScatter * (sun * sss * 0.42 + uAmbient * thin * 0.55);

#ifndef IS_LIP
  float shallow = smoothstep(uShoreZ - 150.0, uShoreZ - 4.0, p.y);
  vec3 sand = vec3(0.62, 0.5, 0.34);
  body = mix(body, mix(uScatter * 1.1, sand * 0.55, 0.45) * (uAmbient + sun * 0.28 * wrap), shallow * 0.75);
#endif

  vec3 col = mix(body, refl, F);
  col += min(sun * spec, vec3(14.0)) * sunVis * (1.0 - foamMask) * (1.0 - tube * 0.85);

  // Thin foam lets the water colour through; thick foam is bright and bumpy.
  float foamShade = 0.62 + 0.38 * smoothstep(0.25, 1.0, fpat + foam * 0.2);
  vec3 foamCol = vec3(0.9, 0.94, 0.97) * foamShade * (uAmbient * 0.95 + sun * 0.5 * clamp(dot(N, uSunDir) * 0.6 + 0.4, 0.0, 1.0));
  foamCol += uScatter * sun * 0.25 * thin;
  foamCol *= 1.0 - 0.45 * tube;
  foamCol = mix(foamCol, foamCol * vec3(0.78, 0.9, 0.95), (1.0 - foamShade) * 1.6);
  col = mix(col, foamCol, foamMask * (0.82 + 0.18 * smoothstep(0.4, 0.9, fcell)));

  vec3 fogDir = normalize(vec3(-V.x, 0.012, -V.z));
  float fog = 1.0 - exp(-dist * 0.00021);
  col = mix(col, skyBase(fogDir), fog * 0.96);
  gl_FragColor = vec4(col, 1.0);
}
`

const oceanVertex = /* glsl */ `
${waveGLSL}
uniform vec2 uCenter;
out vec3 vWorld;
void main() {
  vec2 p = position.xz + uCenter;
  vWorld = vec3(p.x, oceanHeight(p), p.y);
  gl_Position = projectionMatrix * viewMatrix * vec4(vWorld, 1.0);
}
`

const lipVertex = /* glsl */ `
${waveGLSL}
in vec2 lipUV;
uniform vec4 uLipA;
uniform vec4 uLipB;
uniform float uLipSide;
out vec3 vWorld;
out vec3 vNormal;
out vec4 vLip;

vec3 lipPos(vec2 ab, out vec4 info) {
  float xb = uLipSide > 0.0 ? uLipA.z : uLipA.w;
  float mid = 0.5 * (uLipA.z + uLipA.w);
  float x = xb + uLipSide * mix(-15.0, 10.0, ab.x);
  x = uLipSide > 0.0 ? max(x, mid) : min(x, mid);
  float dx = x - uLipB.x;
  float zc = uLipA.x - W_CURV * dx * dx;
  vec2 crest = vec2(x, zc);
  WaveDetail d = waveShape(uLipA, uLipB, crest);
  float crestH = oceanHeight(crest);
  float cs = d.curl;
  float phiMax = 3.14159 * mix(0.8, 0.38, smoothstep(-2.0, 9.0, d.s));
  float wob = 1.0 + 0.07 * sin(x * 0.8 + uTime * 1.7) + 0.05 * sin(x * 2.3 - uTime * 2.9);
  float phi = ab.y * phiMax;
  float Rz = cs * d.amp * W_LIP_REACH * wob;
  float Ry = cs * d.amp * W_LIP_DROP * (1.0 + 0.25 * (1.0 - smoothstep(-12.0, -5.0, d.s)));
  info = vec4(ab.y, cs, d.s, d.amp);
  return vec3(x, crestH - Ry * (1.0 - cos(phi)), zc + Rz * sin(phi));
}

void main() {
  vec4 info;
  vec4 tmp;
  vec3 p = lipPos(lipUV, info);
  vec3 pa = lipPos(lipUV + vec2(0.004, 0.0), tmp);
  vec3 pb = lipPos(lipUV + vec2(0.0, 0.01), tmp);
  vec3 n = cross(pb - p, pa - p) * uLipSide;
  vNormal = length(n) > 1e-7 ? normalize(n) : vec3(0.0, 1.0, 0.0);
  vWorld = p;
  vLip = info;
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}
`

export class Ocean {
  constructor(env, quality) {
    this.env = env
    this.group = new Group()
    this.center = new Vector2()
    const common = { ...env.uniforms, uShoreZ: { value: WORLD.shoreZ } }

    this.material = new ShaderMaterial({
      uniforms: { ...common, uCenter: { value: this.center } },
      vertexShader: oceanVertex,
      fragmentShader: waterFragment(false),
      side: DoubleSide,
    })
    this.mesh = new Mesh(buildGridGeometry(quality.oceanSegments), this.material)
    this.mesh.frustumCulled = false
    this.group.add(this.mesh)

    this.lipGeometry = buildLipGeometry(quality.lipSegments[0], quality.lipSegments[1])
    this.lips = []
    for (let i = 0; i < MAX_WAVES; i++) {
      for (const side of [1, -1]) {
        const mat = new ShaderMaterial({
          uniforms: {
            ...common,
            uLipA: new Uniform(new Vector4()),
            uLipB: new Uniform(new Vector4()),
            uLipSide: { value: side },
          },
          vertexShader: lipVertex,
          fragmentShader: waterFragment(true),
          defines: { IS_LIP: 1 },
          side: DoubleSide,
        })
        const m = new Mesh(this.lipGeometry, mat)
        m.frustumCulled = false
        m.visible = false
        m.userData.wave = i
        this.lips.push(m)
        this.group.add(m)
      }
    }
  }

  setQuality(quality) {
    this.mesh.geometry.dispose()
    this.mesh.geometry = buildGridGeometry(quality.oceanSegments)
    const g = buildLipGeometry(quality.lipSegments[0], quality.lipSegments[1])
    for (const l of this.lips) l.geometry = g
    this.lipGeometry.dispose()
    this.lipGeometry = g
  }

  update(focusX, focusZ) {
    this.center.set(focusX, focusZ)
    const A = this.env.field.uniformA
    const B = this.env.field.uniformB
    for (const l of this.lips) {
      const i = l.userData.wave
      const bk = B[i * 4 + 1]
      l.visible = bk > 0.02 && A[i * 4 + 1] > 0.3
      if (l.visible) {
        l.material.uniforms.uLipA.value.fromArray(A, i * 4)
        l.material.uniforms.uLipB.value.fromArray(B, i * 4)
      }
    }
  }
}
