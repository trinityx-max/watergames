// HDR pipeline: scene -> bloom -> grade (vignette, flashes, underwater) -> ACES.

import { HalfFloatType, Vector2, WebGLRenderTarget } from 'three'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uVignette: { value: 0.32 },
    uFlash: { value: 0 },
    uUnder: { value: 0 },
    uTube: { value: 0 },
    uSat: { value: 1.08 },
    uTime: { value: 0 },
    uAspect: { value: 1 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uVignette, uFlash, uUnder, uTube, uSat, uTime, uAspect;
    varying vec2 vUv;
    void main() {
      vec2 uv = vUv;
      if (uUnder > 0.0) {
        uv += vec2(sin(uv.y * 22.0 + uTime * 3.0), cos(uv.x * 18.0 + uTime * 2.6)) * 0.004 * uUnder;
      }
      vec3 c = texture2D(tDiffuse, uv).rgb;
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c = mix(vec3(l), c, uSat + uTube * 0.15);
      vec2 q = (vUv - 0.5) * vec2(uAspect, 1.0);
      float vig = smoothstep(0.95, 0.2, length(q));
      c *= mix(1.0 - uVignette, 1.0, vig);
      c *= mix(1.0, 0.75 + 0.25 * vig, uTube);
      vec3 under = mix(vec3(0.0, 0.08, 0.1), vec3(0.05, 0.35, 0.38), smoothstep(0.0, 1.0, vUv.y));
      c = mix(c, under * (0.4 + l * 0.6) + c * 0.15, uUnder * 0.85);
      c += vec3(1.0, 0.98, 0.95) * uFlash;
      gl_FragColor = vec4(c, 1.0);
    }
  `,
}

export class Post {
  constructor(renderer, scene, camera, quality) {
    this.renderer = renderer
    const size = renderer.getDrawingBufferSize(new Vector2())
    const rt = new WebGLRenderTarget(size.x, size.y, { type: HalfFloatType, samples: quality.bloom ? 4 : 0 })
    this.composer = new EffectComposer(renderer, rt)
    this.renderPass = new RenderPass(scene, camera)
    this.composer.addPass(this.renderPass)
    this.bloom = new UnrealBloomPass(new Vector2(size.x / 2, size.y / 2), 0.22, 0.4, 1.6)
    this.bloom.enabled = quality.bloom
    this.composer.addPass(this.bloom)
    this.grade = new ShaderPass(GradeShader)
    this.composer.addPass(this.grade)
    this.composer.addPass(new OutputPass())
    this.uniforms = this.grade.uniforms
  }

  setQuality(quality) {
    this.bloom.enabled = quality.bloom
  }

  setSize(w, h, pixelRatio) {
    this.composer.setPixelRatio(pixelRatio)
    this.composer.setSize(w, h)
    this.uniforms.uAspect.value = w / h
  }

  render(dt) {
    this.uniforms.uTime.value += dt
    this.composer.render(dt)
  }
}
