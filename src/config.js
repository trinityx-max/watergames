// Shared tuning constants. Anything used by both the CPU wave model and the
// GLSL shaders lives in WAVE so the two can never drift apart.

export const WAVE = {
  speed: 8.0, // crest celerity (m/s), waves travel toward +z (the beach)
  peelSpeed: 6.2, // how fast the break point runs along the crest (m/s)
  height: 2.5, // base amplitude of a set wave (m)
  backLen: 14.0, // length scale of the gentle back of the wave (m)
  faceLenOpen: 6.0, // front-face length scale of an unbroken swell (m)
  faceLenPocket: 2.3, // front-face length scale in the steep pocket (m)
  faceLenBore: 2.0, // front-face length scale of the whitewater bore (m)
  pocketDecay: 28.0, // how quickly the face relaxes down the shoulder (m)
  brokenRamp: 14.0, // distance behind the break point to full whitewater (m)
  brokenAmp: 0.42, // whitewater height relative to the open face
  envSigma: 150.0, // width of the swell's peak along the crest (m)
  curvature: 0.0008, // crest refraction around the reef (m^-1)
  troughDepth: 0.2, // depth of the trough in front of the face (fraction)
  effDepth: 5.0, // effective depth for shallow-water particle velocity (m)
  // Lip (visual barrel) shape
  lipReach: 1.45, // forward throw of the lip, in units of amplitude
  lipDrop: 0.56, // vertical radius of the curl, in units of amplitude
}

export const WORLD = {
  spawnZ: -95,
  lineupZ: 0,
  breakZ: 3,
  endZ: 255, // crest z where the wave has spent itself
  shoreZ: 320, // still-water line on the beach
  gravity: 9.81,
}

// Five long, low swells that keep the whole sea moving. Each entry is
// [dirX, dirZ, wavelength(m), amplitude(m)]. Shared with GLSL.
export const CHOP = [
  [0.12, 1.0, 38.0, 0.16],
  [-0.45, 0.89, 21.0, 0.09],
  [0.62, 0.78, 13.5, 0.055],
  [-0.9, 0.42, 8.7, 0.035],
  [0.3, -0.95, 6.1, 0.02],
]

export const QUALITY = {
  low: { label: 'Low', oceanSegments: 200, maxPixelRatio: 1.0, bloom: false, particles: 1200, lipSegments: [40, 16] },
  medium: { label: 'Medium', oceanSegments: 300, maxPixelRatio: 1.25, bloom: true, particles: 2400, lipSegments: [64, 22] },
  high: { label: 'High', oceanSegments: 420, maxPixelRatio: 1.75, bloom: true, particles: 3600, lipSegments: [84, 28] },
  ultra: { label: 'Ultra', oceanSegments: 560, maxPixelRatio: 2.0, bloom: true, particles: 5000, lipSegments: [110, 34] },
}

// Times of day: sun elevation/azimuth in degrees, colours are linear RGB.
export const TIMES = {
  golden: {
    label: 'Golden Hour',
    sunElevation: 13,
    sunAzimuth: 200, // measured from +z toward +x; 180 = straight out to sea
    sunColor: [1.0, 0.72, 0.42],
    sunIntensity: 3.2,
    zenith: [0.07, 0.17, 0.42],
    horizon: [0.95, 0.56, 0.32],
    deep: [0.004, 0.035, 0.06],
    scatter: [0.02, 0.42, 0.38],
    ambient: [0.36, 0.42, 0.52],
    cloudColor: [1.0, 0.74, 0.55],
    exposure: 0.74,
  },
  midday: {
    label: 'Midday',
    sunElevation: 52,
    sunAzimuth: 215,
    sunColor: [1.0, 0.96, 0.9],
    sunIntensity: 3.6,
    zenith: [0.07, 0.25, 0.68],
    horizon: [0.62, 0.78, 0.94],
    deep: [0.003, 0.05, 0.09],
    scatter: [0.0, 0.5, 0.47],
    ambient: [0.5, 0.62, 0.78],
    cloudColor: [1.0, 1.0, 1.0],
    exposure: 0.8,
  },
  dusk: {
    label: 'Dusk',
    sunElevation: 3.5,
    sunAzimuth: 192,
    sunColor: [1.0, 0.42, 0.24],
    sunIntensity: 2.6,
    zenith: [0.07, 0.09, 0.25],
    horizon: [0.95, 0.44, 0.36],
    deep: [0.003, 0.02, 0.045],
    scatter: [0.03, 0.26, 0.3],
    ambient: [0.3, 0.27, 0.42],
    cloudColor: [0.98, 0.5, 0.45],
    exposure: 1.1,
  },
}

export const HEAT_SECONDS = 180

// Converts raw trick points into a 0-10 judges' score.
export function judgeScore(points) {
  return 10 * (1 - Math.exp(-points / 3800))
}
