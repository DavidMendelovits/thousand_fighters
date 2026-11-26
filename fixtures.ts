// Test fighters that exist only to prove engine features. cli.ts validates them with the roster, so a feature
// that breaks fails `npm run check` even when no shipped fighter uses it yet.
import { design } from './design'
import type { FighterDef, Move } from './kit'

type Spec = Partial<Move> & Pick<Move, 'id' | 'name' | 'motion' | 'btn' | 'su' | 'ac' | 'rc'>
const shot = (m: Spec) => ({ pose: 'cast', ...m }) as Move

/** Projectile Lab: one special per kind of projectile. */
export const LAB: FighterDef = {
  ...design('Projectile Lab', 11), id: 'projectile_lab', name: 'Projectile Lab', bio: 'One special for every kind of projectile.', strings: [],
  moves: [
    shot({ id: 'straight', name: 'Straight Shot', motion: ['d', 'f'], btn: 'lp', su: 12, ac: 1, rc: 24, proj: [{ at: 12, vx: 8, dmg: 60, color: '#ffcf5a' }] }),
    shot({ id: 'drop', name: 'Sky Drop', motion: ['d', 'f'], btn: 'hp', su: 10, ac: 1, rc: 26, proj: [{ at: 10, from: 'above', warn: 18, vx: 0, vy: -14, dmg: 70, size: 18, color: '#ff6a3d', shape: 'bomb' }] }),
    shot({ id: 'back', name: 'Boomerang', motion: ['d', 'b'], btn: 'lp', su: 12, ac: 1, rc: 26, proj: [{ at: 12, from: 'behind', warn: 10, vx: 9, dmg: 55, color: '#7fe0d0', shape: 'blade' }] }),
    shot({ id: 'geyser', name: 'Geyser', motion: ['d', 'b'], btn: 'hp', su: 14, ac: 1, rc: 24, proj: [{ at: 14, from: 'below', warn: 12, vx: 0, vy: 10, life: 30, size: 22, dmg: 65, launch: [0, 10], color: '#7fe0d0', shape: 'wave' }] }),
    shot({ id: 'gate', name: 'Portal Shot', motion: ['b', 'f'], btn: 'lp', su: 12, ac: 1, rc: 28, proj: [{ at: 12, vx: 8, dmg: 60, portal: { at: 14, to: 'behind', speed: 9 }, color: '#c08bff' }] }),
    shot({ id: 'ray', name: 'Ray', motion: ['b', 'f'], btn: 'hp', su: 12, ac: 1, rc: 30, proj: [{ at: 12, x: 30, y: 110, vx: 0, w: 8, h: 12, grow: [22, 0], max: [230, 12], anchor: true, hits: 3, life: 30, dmg: 30, color: '#fff2b0', shape: 'beam' }] }),
    shot({ id: 'swell', name: 'Swell', motion: ['f', 'd'], btn: 'lp', su: 12, ac: 1, rc: 26, proj: [{ at: 12, vx: 4, size: 8, grow: [0.6, 0.6], max: [40, 40], dmg: 60, color: '#5aa9ff' }] }),
    shot({ id: 'hook', name: 'Hook Chain', motion: ['f', 'd'], btn: 'hp', su: 14, ac: 1, rc: 30, proj: [{ at: 14, vx: 13, life: 24, dmg: 30, pull: 38, size: 14, color: '#c9d6d8', shape: 'chain' }] }),
  ],
}
