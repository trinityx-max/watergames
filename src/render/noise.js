// Procedural, tileable noise baked once at startup into an RGBA texture:
//   R,G  slope of a fractal height field (detail normals for ripples)
//   B    fractal value noise (clouds, foam breakup)
//   A    cellular F2-F1 (foam bubble networks)

import { DataTexture, RGBAFormat, RepeatWrapping, LinearMipmapLinearFilter, LinearFilter, UnsignedByteType } from 'three'

function rng(seed) {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function periodicGradientNoise(size, period, rand) {
  const gx = new Float32Array(period * period)
  const gy = new Float32Array(period * period)
  for (let i = 0; i < period * period; i++) {
    const a = rand() * Math.PI * 2
    gx[i] = Math.cos(a)
    gy[i] = Math.sin(a)
  }
  const out = new Float32Array(size * size)
  const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10)
  for (let y = 0; y < size; y++) {
    const fy = (y / size) * period
    const y0 = Math.floor(fy)
    const ty = fy - y0
    const y1 = (y0 + 1) % period
    for (let x = 0; x < size; x++) {
      const fx = (x / size) * period
      const x0 = Math.floor(fx)
      const tx = fx - x0
      const x1 = (x0 + 1) % period
      const dot = (ix, iy, dx, dy) => gx[iy * period + ix] * dx + gy[iy * period + ix] * dy
      const n00 = dot(x0, y0, tx, ty)
      const n10 = dot(x1, y0, tx - 1, ty)
      const n01 = dot(x0, y1, tx, ty - 1)
      const n11 = dot(x1, y1, tx - 1, ty - 1)
      const u = fade(tx)
      const v = fade(ty)
      out[y * size + x] = (n00 * (1 - u) + n10 * u) * (1 - v) + (n01 * (1 - u) + n11 * u) * v
    }
  }
  return out
}

function fbm(size, basePeriod, octaves, seed) {
  const rand = rng(seed)
  const out = new Float32Array(size * size)
  let amp = 1
  let period = basePeriod
  let norm = 0
  for (let o = 0; o < octaves; o++) {
    const n = periodicGradientNoise(size, period, rand)
    for (let i = 0; i < out.length; i++) out[i] += n[i] * amp
    norm += amp
    amp *= 0.5
    period *= 2
  }
  for (let i = 0; i < out.length; i++) out[i] /= norm
  return out
}

function cellular(size, cells, seed) {
  const rand = rng(seed)
  const px = new Float32Array(cells * cells)
  const py = new Float32Array(cells * cells)
  for (let i = 0; i < cells * cells; i++) {
    px[i] = rand()
    py[i] = rand()
  }
  const out = new Float32Array(size * size)
  for (let y = 0; y < size; y++) {
    const fy = (y / size) * cells
    const cy = Math.floor(fy)
    for (let x = 0; x < size; x++) {
      const fx = (x / size) * cells
      const cx = Math.floor(fx)
      let f1 = 9
      let f2 = 9
      for (let j = -1; j <= 1; j++) {
        for (let i = -1; i <= 1; i++) {
          const ix = (cx + i + cells) % cells
          const iy = (cy + j + cells) % cells
          const dx = cx + i + px[iy * cells + ix] - fx
          const dy = cy + j + py[iy * cells + ix] - fy
          const d = Math.sqrt(dx * dx + dy * dy)
          if (d < f1) {
            f2 = f1
            f1 = d
          } else if (d < f2) f2 = d
        }
      }
      out[y * size + x] = f2 - f1
    }
  }
  return out
}

export function createNoiseTexture(size = 256) {
  const height = fbm(size, 4, 5, 11)
  const value = fbm(size, 4, 5, 77)
  const cells = cellular(size, 12, 5)
  const fine = cellular(size, 29, 9)
  const data = new Uint8Array(size * size * 4)
  const at = (x, y) => height[((y + size) % size) * size + ((x + size) % size)]
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x
      const dx = (at(x + 1, y) - at(x - 1, y)) * 0.5 * size * 0.1
      const dy = (at(x, y + 1) - at(x, y - 1)) * 0.5 * size * 0.1
      const c = Math.min(1, cells[i] * 2.2) * 0.6 + Math.min(1, fine[i] * 2.4) * 0.4
      data[i * 4] = Math.max(0, Math.min(255, 128 + dx * 127))
      data[i * 4 + 1] = Math.max(0, Math.min(255, 128 + dy * 127))
      data[i * 4 + 2] = Math.max(0, Math.min(255, (value[i] * 0.8 + 0.5) * 255))
      data[i * 4 + 3] = Math.max(0, Math.min(255, c * 255))
    }
  }
  const tex = new DataTexture(data, size, size, RGBAFormat, UnsignedByteType)
  tex.wrapS = tex.wrapT = RepeatWrapping
  tex.minFilter = LinearMipmapLinearFilter
  tex.magFilter = LinearFilter
  tex.generateMipmaps = true
  tex.anisotropy = 8
  tex.needsUpdate = true
  return tex
}
