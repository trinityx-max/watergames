import { Mesh, SphereGeometry, ShaderMaterial, BackSide } from 'three'
import { skyGLSL } from './Environment.js'

export function createSky(env) {
  const material = new ShaderMaterial({
    uniforms: env.uniforms,
    vertexShader: /* glsl */ `
      out vec3 vDir;
      void main() {
        vDir = normalize(position);
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = p.xyww;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      ${skyGLSL}
      in vec3 vDir;
      void main() {
        vec3 d = normalize(vDir);
        vec3 col = skyColor(d, uTime);
        float mu = dot(d, uSunDir);
        float disk = smoothstep(0.99955, 0.99985, mu);
        vec4 cl = cloudLayer(d, uTime);
        col += uSunColor * uSunIntensity * disk * 7.0 * (1.0 - cl.a * 0.9) * smoothstep(-0.02, 0.01, d.y);
        gl_FragColor = vec4(col, 1.0);
      }
    `,
    side: BackSide,
    depthWrite: false,
    depthTest: true,
  })
  const mesh = new Mesh(new SphereGeometry(5000, 48, 24), material)
  mesh.frustumCulled = false
  mesh.renderOrder = -10
  return mesh
}
