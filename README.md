# SWELL

A real-time surfing game in the browser. Paddle into a set at Lantern Point, a
reef A-frame that peels both ways. Pop up, race the curl, and get scored like a
real contest: your two best waves count toward a heat score out of 20.

Everything is procedural: the waves, sky, island silhouettes, the surfer and
the sound. There are no image, model or audio assets.

## Play

```bash
npm install
npm run dev        # http://localhost:5173
```

```bash
npm run build          # static site in dist/
npm run build:single   # one self-contained HTML file in dist-single/
npm test               # physics, wave and scoring tests (Node 20+)
```

### Controls

| Key | In the lineup | On the wave | In the air |
| --- | --- | --- | --- |
| `W` / `↑` | Paddle | Pump for speed | |
| `S` / `↓` | | Stall, tighter turns, wait for the barrel | |
| `A` `D` / `←` `→` | Turn | Carve | Spin |
| `Space` | Pop up (when prompted) | Ollie off the lip | |
| `Shift` | | | Grab the rail |
| `C` | Toggle chase / cinematic camera | | |
| `Esc` | Pause | | |

Gamepads work too: left stick to steer, A to pop up, right trigger to
paddle or pump, left trigger to stall, X or RB to grab. On touch screens,
on-screen buttons appear.

### How a wave goes

1. **Wait.** A new set arrives within a few seconds. The HUD counts down to the wave
   and points you toward the peak.
2. **Paddle** when it says *Paddle!* The face lifts you, and the wave pushes you
   once you're moving with it.
3. **Pop up** on *Pop up!* If you wait too long you pearl, and the nose buries.
4. **Ride the face** down the line, ahead of the whitewater. If you sit high in
   the pocket while the lip pitches, you get sucked over the falls. If you fall
   behind the break point, the whitewater gets you.

### Scoring

Turns are classified by where on the face they happen: bottom turns, carves,
top turns, snaps and re-entries in the lip, and cutbacks back toward the pocket.
Barrel time, airs (with 360/540/720 spins and grabs) and raw speed also score.
Tricks chain into a combo multiplier (up to ×5) that only banks when the chain
ends, so a wipeout costs whatever you hadn't banked. Repeating the same trick
pays less each time. Each wave's points turn into a judges' score from 0 to 10.
A heat lasts three minutes, and a wave started before the horn still counts.

## How it works

**One wave function, two implementations.** The sea surface is analytic:
asymmetric solitary humps travel toward the beach over five long swells. Each
set wave breaks from a peak, and two break points peel away along the crest at
6.2 m/s. Ahead of them the face steepens into the pocket. Behind them the wave
collapses into a whitewater bore. `src/waves/WaveField.js` evaluates this on
the CPU for physics. `src/waves/waveGLSL.js` generates the identical GLSL,
with the same constants injected, so the board floats on exactly the surface
you see. A test checks that the shared constants match.

**The barrel.** A heightfield can't overhang, so the curling lip is a separate
sheet of geometry. It grows out of the crest wherever the wave is pitching, and
its throw and plunge follow the distance from the break point. It shares the
water shader, and its underside glows with light coming through it.

**Water shading** (`src/render/Ocean.js`) uses:

- per-pixel analytic normals plus three scrolling octaves of detail
- Fresnel reflection of the procedural sky and clouds
- sun glitter that widens with distance
- subsurface scattering through thin crests (the turquoise glow)
- darkening and inner glow inside the barrel
- shoaling colour near the beach
- whitewater that travels with the bore and stays behind in the world as it
  leaves

The ocean grid gets coarser with distance. It's dense around the surfer and
kilometres wide at the horizon, and it follows the camera.

**Board physics** (`src/physics/Board.js`) runs at a fixed 120 Hz:

- A spring-damper presses the board out of the water along the surface
  normal. On a sloped face that pressure pushes you down the face, which is
  where a surfer's speed comes from.
- Water drag splits into a low along-board component and a high cross-board
  component (rail grip). That split is what lets you carve.
- Pitch and roll come from sampling the surface under the nose, tail and
  rails, which gives the lazy rocking while you sit in the lineup.
- Airs launch naturally off the lip or from an ollie. Landings are judged on
  board angle and impact.

**The surfer** is a puppet of capsules with two-bone IK for arms and legs. Its
poses blend between sitting, paddling, pop-up, compressing into turns, the tube
crouch, grabs and wipeout flailing.

**Rendering pipeline:** HDR → bloom → grade (vignette, underwater, barrel) →
ACES. Resolution adapts automatically to hold the frame rate. The quality
presets change ocean density, MSAA, bloom and particle budget.

## Layout

```
src/
  config.js          tuning: wave shape, times of day, quality presets
  waves/             CPU wave model + generated GLSL mirror
  physics/Board.js   board dynamics, airs, wipeouts
  render/            ocean + lip, sky, land, surfer, spray, wake, post
  game/              session flow, scoring, camera, input, audio, effects, bot
  ui/HUD.js          heat bar, trick feed, combo, ride cards
tests/               node:test suites + headless surf bot
```
