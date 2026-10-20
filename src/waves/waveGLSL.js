// GLSL mirror of WaveField.js. Constants are injected from config so the CPU
// physics and the GPU surface are always the same function.

import { WAVE } from '../config.js'
import { CHOP_TABLE, MAX_WAVES } from './WaveField.js'

const f = (v) => {
  const s = Number(v).toPrecision(8)
  return s.includes('.') || s.includes('e') ? s : s + '.0'
}

const chopConsts = CHOP_TABLE.map(
  (c, i) => `const vec4 CHOP${i} = vec4(${f(c[0])}, ${f(c[1])}, ${f(c[2])}, ${f(c[3])});
const vec2 CHOPW${i} = vec2(${f(c[4])}, ${f(c[5])});`,
).join('\n')

const chopSum = CHOP_TABLE.map((_, i) => `  h += CHOP${i}.w * sin(CHOP${i}.z * dot(CHOP${i}.xy, p) - CHOPW${i}.x * t + CHOPW${i}.y);`).join('\n')

export const waveGLSL = /* glsl */ `
#define NWAVES ${MAX_WAVES}
uniform vec4 uWaveA[NWAVES]; // crestZ, amplitude, rightBreakX, leftBreakX
uniform vec4 uWaveB[NWAVES]; // peakX, breakProgress, -, -
uniform float uTime;

const float W_BACKLEN = ${f(WAVE.backLen)};
const float W_FACE_OPEN = ${f(WAVE.faceLenOpen)};
const float W_FACE_POCKET = ${f(WAVE.faceLenPocket)};
const float W_FACE_BORE = ${f(WAVE.faceLenBore)};
const float W_POCKET_DECAY = ${f(WAVE.pocketDecay)};
const float W_BROKEN_RAMP = ${f(WAVE.brokenRamp)};
const float W_BROKEN_AMP = ${f(WAVE.brokenAmp)};
const float W_INV_ENV = ${f(1 / (2 * WAVE.envSigma * WAVE.envSigma))};
const float W_CURV = ${f(WAVE.curvature)};
const float W_TROUGH = ${f(WAVE.troughDepth)};
const float W_LIP_REACH = ${f(WAVE.lipReach)};
const float W_LIP_DROP = ${f(WAVE.lipDrop)};
const float W_SPEED = ${f(WAVE.speed)};
${chopConsts}

struct WaveDetail {
  float h; float main; float hn; float u; float s;
  float amp; float broken; float steep; float curl; float lf; float bk;
};

WaveDetail waveShape(vec4 A, vec4 B, vec2 p) {
  WaveDetail d;
  float dx = p.x - B.x;
  float zc = A.x - W_CURV * dx * dx;
  d.u = p.y - zc;
  d.s = max(p.x - A.z, A.w - p.x);
  d.bk = B.y;
  float env = 0.55 + 0.45 * exp(-dx * dx * W_INV_ENV);
  float pocket = exp(-max(d.s, 0.0) / W_POCKET_DECAY);
  d.broken = d.bk * smoothstep(0.0, W_BROKEN_RAMP, -d.s);
  d.steep = d.bk * pocket * (1.0 - d.broken);
  float shoulder = 1.0 - 0.25 * d.bk * smoothstep(15.0, 130.0, d.s);
  d.amp = A.y * env * (1.0 + 0.22 * d.steep) * (1.0 + (W_BROKEN_AMP - 1.0) * d.broken) * shoulder;
  d.lf = mix(mix(W_FACE_OPEN, W_FACE_POCKET, d.steep), W_FACE_BORE, d.broken);
  float L = d.u < 0.0 ? W_BACKLEN : d.lf;
  float q = d.u / L;
  d.main = d.amp * exp(-q * q);
  float tq = (d.u - 1.7 * d.lf) / (1.4 * d.lf);
  d.h = d.main - d.amp * W_TROUGH * exp(-tq * tq);
  d.hn = d.amp > 1e-4 ? d.main / d.amp : 0.0;
  d.curl = d.bk * smoothstep(-13.0, -6.0, d.s) * (1.0 - smoothstep(0.0, 9.0, d.s));
  return d;
}

float waveH(vec4 A, vec4 B, vec2 p) {
  float dx = p.x - B.x;
  float u = p.y - (A.x - W_CURV * dx * dx);
  float s = max(p.x - A.z, A.w - p.x);
  float bk = B.y;
  float env = 0.55 + 0.45 * exp(-dx * dx * W_INV_ENV);
  float pocket = exp(-max(s, 0.0) / W_POCKET_DECAY);
  float broken = bk * smoothstep(0.0, W_BROKEN_RAMP, -s);
  float steep = bk * pocket * (1.0 - broken);
  float shoulder = 1.0 - 0.25 * bk * smoothstep(15.0, 130.0, s);
  float amp = A.y * env * (1.0 + 0.22 * steep) * (1.0 + (W_BROKEN_AMP - 1.0) * broken) * shoulder;
  float lf = mix(mix(W_FACE_OPEN, W_FACE_POCKET, steep), W_FACE_BORE, broken);
  float L = u < 0.0 ? W_BACKLEN : lf;
  float q = u / L;
  float tq = (u - 1.7 * lf) / (1.4 * lf);
  return amp * (exp(-q * q) - W_TROUGH * exp(-tq * tq));
}

float chopH(vec2 p, float t) {
  float h = 0.0;
${chopSum}
  return h;
}

float oceanHeight(vec2 p) {
  float h = chopH(p, uTime);
  for (int i = 0; i < NWAVES; i++) h += waveH(uWaveA[i], uWaveB[i], p);
  return h;
}
`
