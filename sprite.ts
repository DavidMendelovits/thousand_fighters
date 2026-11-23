// How a painted sprite sheet animates. A sheet has one cell per key pose, so motion between poses is faked:
// cross-dissolves for slow changes (idle, walk, recovery), snaps plus a smear for strikes, and squash, shake and
// tilt for getting hit and flying. Pure (no DOM) so it can be previewed and tested outside the browser.
import { poseKeys, airborne, type Fighter } from './sim'

export type Layer = { key: string; alpha: number }
/** Cells to draw bottom to top, then a transform around the fighter's middle (radians, scale, pixel offsets). */
export type SpriteLook = { layers: Layer[]; rot: number; sx: number; sy: number; dx: number; dy: number }

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v))
/** Two cells as a dissolve: the outgoing one fades only after the incoming one is fully drawn, so the body never goes see-through. */
const dissolve = (a: string, b: string, u: number): Layer[] =>
  a === b || u <= 0.02 ? [{ key: a, alpha: 1 }] : u >= 0.98 ? [{ key: b, alpha: 1 }] : [{ key: a, alpha: u < 0.5 ? 1 : 2 * (1 - u) }, { key: b, alpha: u < 0.5 ? 2 * u : 1 }]

/** Ticks of the strike pose that get a smear of the windup behind them. */
export const SMEAR = 3

export function spriteLook(f: Fighter): SpriteLook {
  const [a, b, u] = poseKeys(f), look: SpriteLook = { layers: [], rot: 0, sx: 1, sy: 1, dx: 0, dy: 0 }
  const m = f.mv
  switch (f.st) {
    case 'atk': {
      const t = f.t, strike = t >= m!.su && t < m!.su + m!.ac
      if (t < m!.su || strike || airborne(f) || m!.grab) {
        // anticipation and impact stay snappy: nearest cell, never blended
        look.layers = [{ key: u > 0.5 ? b : a, alpha: 1 }]
        if (strike && t - m!.su < SMEAR) look.layers.unshift({ key: m!.pose + '.w', alpha: 0.35 * (1 - (t - m!.su) / SMEAR) })
        if (strike && t === m!.su) { look.sx = 1.05; look.sy = 0.97 } // one tick of stretch on the hit frame
      } else look.layers = dissolve(a, b, u) // recovery eases back to stance
      break
    }
    case 'hit': case 'pulled': case 'bstun': {
      look.layers = [{ key: a, alpha: 1 }]
      if (f.t < 6) { const k = 1 - f.t / 6; look.sx = 1 - 0.07 * k; look.sy = 1 + 0.04 * k; look.dx = (f.t % 2 ? 1 : -1) * 3 * k }
      break
    }
    case 'launch': case 'thrown':
      look.layers = [{ key: a, alpha: 1 }]
      look.rot = -0.45 * clamp(f.vy / 12, -1, 1) // leans back going up, pitches forward coming down
      break
    case 'air':
      look.layers = [{ key: a, alpha: 1 }]
      look.sy = 1 + clamp(Math.abs(f.vy) / 13, 0, 1) * 0.05; look.sx = 2 - look.sy // stretch at speed, round at the apex
      break
    case 'down': case 'ko':
      look.layers = [{ key: a, alpha: 1 }]
      if (f.t < 5) look.sy = 0.9 + f.t * 0.02 // thud
      break
    default: look.layers = dissolve(a, b, u) // idle, walk, crouch, block, dash, getup, win
  }
  for (const l of look.layers) l.alpha = clamp(l.alpha, 0, 1)
  return look
}
