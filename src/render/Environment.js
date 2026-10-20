// Shared lighting state and sky GLSL. All custom materials reference the same
// uniform objects, so switching time of day is a handful of assignments.

import { Color, Vector3, Vector4 } from 'three'
import { TIMES } from '../config.js'
import { MAX_WAVES } from '../waves/WaveField.js'

export const skyGLSL = /* glsl */ `
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform float uSunIntensity;
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uCloudColor;
uniform sampler2D uNoise;

vec3 skyBase(vec3 d) {
  float h = clamp(d.y, 0.0, 1.0);
  float mu = max(dot(d, uSunDir), 0.0);
  vec3 col = mix(uHorizon, uZenith, pow(h, 0.42));
  col = mix(col, uHorizon * 1.04, exp(-h * 16.0) * 0.55);
  float glow = pow(mu, 5.0) * 0.32 + pow(mu, 42.0) * 0.9;
  col += uSunColor * glow * (0.45 + 0.55 * exp(-h * 3.5));
  if (d.y < 0.0) col = mix(uHorizon * 0.9, uHorizon * 0.35 + uZenith * 0.15, clamp(-d.y * 5.0, 0.0, 1.0));
  return col;
}

vec4 cloudLayer(vec3 d, float t) {
  if (d.y <= 0.004) return vec4(0.0);
  vec2 uv = d.xz / (d.y + 0.06) * 0.075 + vec2(0.0018, 0.0006) * t;
  float n = texture(uNoise, uv).b * 0.62 + texture(uNoise, uv * 2.9 + 0.37).b * 0.28 + texture(uNoise, uv * 7.3 + 0.71).b * 0.1;
  float cov = smoothstep(0.5, 0.74, n) * smoothstep(0.004, 0.14, d.y);
  float mu = max(dot(d, uSunDir), 0.0);
  float edge = 1.0 - smoothstep(0.5, 0.7, n);
  vec3 lit = uCloudColor * uSunIntensity * (0.16 + 0.55 * pow(mu, 6.0) * (0.4 + edge)) + uZenith * 0.55;
  vec3 shade = mix(uHorizon, uZenith, 0.6) * 0.62;
  return vec4(mix(shade, lit, 0.35 + 0.65 * edge), cov * 0.9);
}

vec3 skyColor(vec3 d, float t) {
  vec3 c = skyBase(d);
  vec4 cl = cloudLayer(d, t);
  return mix(c, cl.rgb, cl.a);
}
`

const toColor = (a) => new Color(a[0], a[1], a[2])

export class Environment {
  constructor(noiseTexture, waveField) {
    this.uniforms = {
      uSunDir: { value: new Vector3(0, 0.3, -1).normalize() },
      uSunColor: { value: new Color(1, 1, 1) },
      uSunIntensity: { value: 3 },
      uZenith: { value: new Color() },
      uHorizon: { value: new Color() },
      uCloudColor: { value: new Color() },
      uDeep: { value: new Color() },
      uScatter: { value: new Color() },
      uAmbient: { value: new Color() },
      uNoise: { value: noiseTexture },
      uTime: { value: 0 },
      uWaveA: { value: Array.from({ length: MAX_WAVES }, () => new Vector4()) },
      uWaveB: { value: Array.from({ length: MAX_WAVES }, () => new Vector4()) },
    }
    this.field = waveField
    this.preset = null
  }

  setTime(key) {
    const p = TIMES[key] || TIMES.golden
    this.preset = p
    this.key = key
    const el = (p.sunElevation * Math.PI) / 180
    const az = (p.sunAzimuth * Math.PI) / 180
    this.uniforms.uSunDir.value.set(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)).normalize()
    this.uniforms.uSunColor.value.copy(toColor(p.sunColor))
    this.uniforms.uSunIntensity.value = p.sunIntensity
    this.uniforms.uZenith.value.copy(toColor(p.zenith))
    this.uniforms.uHorizon.value.copy(toColor(p.horizon))
    this.uniforms.uCloudColor.value.copy(toColor(p.cloudColor))
    this.uniforms.uDeep.value.copy(toColor(p.deep))
    this.uniforms.uScatter.value.copy(toColor(p.scatter))
    this.uniforms.uAmbient.value.copy(toColor(p.ambient))
  }

  sync(time) {
    this.uniforms.uTime.value = time
    const A = this.field.uniformA
    const B = this.field.uniformB
    for (let i = 0; i < MAX_WAVES; i++) {
      this.uniforms.uWaveA.value[i].fromArray(A, i * 4)
      this.uniforms.uWaveB.value[i].fromArray(B, i * 4)
    }
  }
}
