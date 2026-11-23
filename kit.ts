// The universal kit: one skeleton, one move list, shared by every fighter.
// A fighter never authors animation or hitboxes. Hitboxes are derived from the
// striking limb of the move's strike pose, so art and collision cannot disagree.

export type Btn = 'lp' | 'hp' | 'lk' | 'hk'
export type SpecialType = 'projectile' | 'rush' | 'rising' | 'teleport' | 'slide'

export type Look = {
  skin: string; main: string; alt: string; trim: string
  height: number; bulk: number; arms: number; legs: number
  head: 'round' | 'square' | 'tall'
  hair: 'none' | 'spikes' | 'mohawk' | 'long' | 'bun'
  hat: 'none' | 'hood' | 'horns' | 'helmet' | 'wizard' | 'crown' | 'mask' | 'headband' | 'lantern'
  cape: boolean
}

export type FighterDef = {
  id: string; name: string; bio: string
  look: Look
  stats: { hp: number; speed: number; power: number; jump: number }
  /** Dial combos: sequences of move ids. lp/hp/lk/hk are the standing normals; any other id (kit or custom) works too,
   *  so a string can end in a move that exists nowhere else. Each step is dialled with that move's button. */
  strings: string[][]
  /** This fighter's own moves: specials, command normals, follow-ups, air moves, supers. Same shape as the kit's. */
  moves: Move[]
  /** Extra key poses for custom moves, as '<name>.w' (windup) and '<name>.s' (strike). Painted sheets get a cell for each. */
  poses?: Record<string, Pose>
  /** Per-fighter changes to universal moves, e.g. { hk: { dmg: 90, su: 12 } }. */
  tweaks?: Record<string, Partial<Move>>
  atlas?: boolean // true when fighters/<id>.png holds painted sprites for every key pose
}

// ---- skeleton ---------------------------------------------------------------
// Angles in degrees. Limbs: 0 = straight down, 90 = forward, 180 = up.
// [lean, armF upper, armF fore, armB upper, armB fore, legF thigh, legF shin, legB thigh, legB shin, head tilt, hip dx]
export type Pose = number[]
const P = (lean: number, aFu: number, aFl: number, aBu: number, aBl: number, lFu: number, lFl: number, lBu: number, lBl: number, head = 0, dx = 0): Pose =>
  [lean, aFu, aFl, aBu, aBl, lFu, lFl, lBu, lBl, head, dx]

export const POSES: Record<string, Pose> = {
  idle0: P(10, 50, 140, 20, 130, 25, -10, -25, -20),
  idle1: P(13, 54, 144, 24, 134, 30, -14, -28, -24),
  walk0: P(10, 50, 140, 20, 130, 35, 10, -30, -35),
  walk1: P(10, 52, 142, 22, 132, 10, -5, -5, -40),
  walk2: P(10, 50, 140, 20, 130, -20, -30, 30, 10),
  walk3: P(10, 52, 142, 22, 132, -5, -40, 10, -5),
  crouch: P(25, 55, 140, 30, 130, 95, -25, 60, -75),
  air: P(10, 60, 150, -20, 60, 70, -30, 30, -60),
  dashF: P(30, 50, 140, 20, 130, 50, 0, -45, -70),
  dashB: P(-15, 50, 140, 20, 130, 20, 20, -40, -20),
  block: P(-5, 70, 175, 55, 170, 25, -10, -25, -20),
  cblock: P(15, 70, 175, 55, 170, 95, -25, 60, -75),
  hit: P(-22, -10, 40, -40, 10, 15, -15, -30, -10, -15),
  launch: P(-70, 120, 150, -100, -120, 60, 30, 40, 0, -10),
  down: P(-88, -100, -90, -95, -90, 88, 85, 80, 60),
  win: P(0, 160, 175, 10, 60, 12, -5, -12, -8),
  // attack pose pairs: .w = windup, .s = strike (held through the active frames)
  'lp.w': P(8, 30, 150, 20, 130, 25, -10, -25, -20),
  'lp.s': P(14, 88, 90, 15, 125, 28, -8, -28, -22, 0, 4),
  'hp.w': P(0, 45, 140, -30, 100, 20, -10, -25, -20),
  'hp.s': P(25, 20, 120, 92, 90, 35, 0, -35, -30, 0, 8),
  'lk.w': P(-5, 50, 140, 20, 130, 80, -20, -5, -5),
  'lk.s': P(-15, 40, 130, -10, 100, 85, 85, -5, -5, 0, 4),
  'hk.w': P(-10, 50, 140, 20, 130, 100, 0, -5, -5),
  'hk.s': P(-30, 30, 120, -30, 80, 130, 128, -5, -5, 0, 6),
  'clp.w': P(25, 30, 150, 30, 130, 95, -25, 60, -75),
  'clp.s': P(28, 88, 90, 30, 130, 95, -25, 60, -75, 0, 4),
  'clk.w': P(15, 55, 140, 30, 130, 100, 20, 70, -70),
  'clk.s': P(10, 40, 130, -20, 60, 95, 100, 70, -70),
  'upper.w': P(30, 10, 60, 30, 130, 95, -25, 60, -75),
  'upper.s': P(-8, 130, 165, -20, 60, 15, -5, -20, -15, -10, 20),
  'sweep.w': P(10, 55, 140, 30, 130, 100, 10, 70, -70),
  'sweep.s': P(-30, 20, 100, -60, -20, 92, 92, 70, -70, 0, 6),
  'round.w': P(-5, 60, 150, 10, 110, 70, -40, -5, -5),
  'round.s': P(-35, 20, 110, -50, 20, 110, 105, -5, -5, 0, 10),
  'over.w': P(-5, 40, 130, 170, 185, 20, -10, -25, -20),
  'over.s': P(30, 20, 110, 80, 70, 35, 0, -35, -30, 0, 8),
  'jp.w': P(10, 30, 150, -20, 60, 70, -30, 30, -60),
  'jp.s': P(25, 70, 60, -40, 40, 70, -30, 30, -60),
  'jk.w': P(0, 60, 150, -20, 60, 90, -20, 60, -50),
  'jk.s': P(-15, 40, 130, -40, 40, 60, 55, 80, -40),
  'throw.w': P(15, 80, 85, 75, 80, 30, -5, -30, -25, 0, 6),
  'throw.s': P(-20, 150, 160, 145, 155, 20, -10, -25, -20),
  'cast.w': P(0, -20, 60, -30, 50, 30, -10, -35, -25),
  'cast.s': P(20, 88, 90, 85, 88, 40, 0, -40, -30, 0, 6),
  'rush.w': P(30, 30, 150, 20, 130, 60, -20, -20, -50),
  'rush.s': P(45, 85, 85, -30, 30, 50, 10, -50, -60, 0, 10),
}
export const POSE_KEYS = Object.keys(POSES)

export const lerpPose = (a: Pose, b: Pose, u: number): Pose => a.map((v, i) => v + (b[i] - v) * u)

export type Pt = [number, number]
const RAD = Math.PI / 180
/** Joint positions relative to the feet anchor. x = forward, y = up. Lowest joint sits on y=0. */
export function fk(p: Pose, k: Look) {
  const s = k.height, T = 60 * s, A = 28 * s * k.arms, G = 39 * s * k.legs, HR = 15 * s
  const at = (o: Pt, a: number, len: number): Pt => [o[0] + Math.sin(a * RAD) * len, o[1] - Math.cos(a * RAD) * len]
  const hip: Pt = [p[10] * s, 0]
  const neck = at(hip, 180 - p[0], T), sh = at(hip, 180 - p[0], T - 6 * s)
  const head = at(neck, 180 - p[0] - p[9], HR + 3 * s)
  const elF = at(sh, p[1], A), fiF = at(elF, p[2], A), elB = at(sh, p[3], A), fiB = at(elB, p[4], A)
  const knF = at(hip, p[5], G), ftF = at(knF, p[6], G), knB = at(hip, p[7], G), ftB = at(knB, p[8], G)
  const j = { hip, neck, sh, head, elF, fiF, elB, fiB, knF, ftF, knB, ftB }
  let low = head[1] - HR
  for (const q of Object.values(j)) low = Math.min(low, q[1])
  for (const q of Object.values(j)) q[1] -= low
  return { ...j, HR }
}

// ---- moves ------------------------------------------------------------------
// One shape for every move in the game: universal normals, specials, follow-ups, supers.
// Everything past the frame data is optional and composable.
export type Level = 'mid' | 'low' | 'oh' // low must be crouch-blocked, oh (overhead) must be stand-blocked
export type Dir = 'd' | 'f' | 'b'
export type Limb = 'armF' | 'armB' | 'legF' | 'legB'
export type ProjSpec = {
  at: number // tick it spawns on
  x?: number; y?: number // spawn offset from the feet (default 50 forward, 105 up)
  vx: number; vy?: number; g?: number // g > 0 makes it arc and die on the floor
  dmg: number; hs?: number; bs?: number; lvl?: Level; launch?: [number, number]; kb?: number; stop?: number
  size?: number; hits?: number; life?: number
  aim?: 'target' // spawn at the opponent's position instead of in front of the attacker (geysers, strikes from above)
  unblockable?: boolean; pull?: number; heal?: number // same meaning as on Move
  color: string; shape?: 'orb' | 'blade' | 'bomb' | 'wave' | 'chain' // chain draws a tether back to the thrower
}
export type Move = {
  id: string; name: string
  // --- how it is performed
  btn?: Btn; or?: Btn; chord?: Btn // or = alternate button, chord = second button pressed together
  dir?: Dir // direction held with the button (command normal)
  motion?: Dir[] // directions entered in order before the button (special)
  air?: boolean // performed while airborne
  from?: string[] // follow-up: only available by cancelling one of these moves on contact
  stringOnly?: boolean // only available as a step in a dial string (dialled with btn)
  cost?: number // super meter spent (0-100)
  needs?: 'buff' // only while a power-up is active
  // --- frame data, in 60Hz ticks
  su: number; ac: number; rc: number
  land?: number // landing recovery when the move ends in the air
  // --- the melee hit. The hitbox is the striking limb in the strike pose; no limb = no melee hit.
  dmg: number; hs: number; bs: number; lvl: Level
  limb?: Limb; r: number; kb: number; stop: number
  launch?: [number, number]
  rehit?: number // multi-hit: the hitbox re-arms every n ticks while active
  unblockable?: boolean
  pull?: number // on hit, drag the opponent to point-blank and leave them stunned this many ticks (works at any range)
  heal?: number // fraction of damage dealt returned as health
  // --- grab: at the end of startup, seize an opponent within range; hold for `ac` ticks, then release with dmg + launch.
  // Beats blocking. air = catches airborne opponents instead of grounded ones. juggle = the release can be comboed.
  grab?: { range: number; air?: boolean; juggle?: boolean }
  // --- extras
  drive?: { from: number; to: number; vx?: number; vy?: number }[] // self movement: vx held over the span, vy applied once
  proj?: ProjSpec[]
  teleport?: { at: number; to: 'behind' | 'front' | 'self'; dx: number }
  inv?: [number, number] // invulnerable from tick..to tick
  armor?: number // hits absorbed without flinching
  counter?: { from: number; to: number; then: string } // struck in this window: take nothing and answer with move `then`
  buff?: { ticks: number; power?: number; speed?: number; defense?: number; color?: string } // power-up applied at end of startup
  meter?: number // super meter gained at end of startup
  cancel?: boolean // may cancel into specials/strings on contact (default: plain grounded normals only)
  // --- presentation
  pose: string; base: string; crouch?: boolean
}
export const MOVE_DEFAULTS = { hs: 18, bs: 11, lvl: 'mid' as Level, r: 11, kb: 5, stop: 6, base: 'idle0', ac: 3, rc: 12, dmg: 0 }
const M = (m: Partial<Move> & Pick<Move, 'id' | 'name' | 'su'>): Move => ({ ...MOVE_DEFAULTS, pose: m.id, ...m })

export const MOVES: Record<string, Move> = Object.fromEntries([
  M({ id: 'lp', name: 'Jab', btn: 'lp', su: 4, ac: 3, rc: 7, dmg: 30, hs: 16, bs: 10, limb: 'armF', r: 10, kb: 4, stop: 5 }),
  M({ id: 'hp', name: 'Cross', btn: 'hp', su: 8, ac: 3, rc: 14, dmg: 60, hs: 20, bs: 13, limb: 'armB', r: 12, kb: 6, stop: 7 }),
  M({ id: 'lk', name: 'Front Kick', btn: 'lk', su: 6, ac: 3, rc: 11, dmg: 45, hs: 18, bs: 11, limb: 'legF', kb: 5 }),
  M({ id: 'hk', name: 'High Kick', btn: 'hk', su: 10, ac: 4, rc: 17, dmg: 75, hs: 22, bs: 14, limb: 'legF', r: 13, kb: 7, stop: 8 }),
  M({ id: 'clp', name: 'Low Jab', btn: 'lp', dir: 'd', su: 5, ac: 3, rc: 8, dmg: 25, hs: 15, bs: 9, limb: 'armF', r: 10, kb: 4, stop: 5, base: 'crouch', crouch: true }),
  M({ id: 'clk', name: 'Shin Kick', btn: 'lk', dir: 'd', su: 6, ac: 3, rc: 10, dmg: 35, hs: 15, bs: 9, lvl: 'low', limb: 'legF', kb: 4, stop: 5, base: 'crouch', crouch: true }),
  M({ id: 'upper', name: 'Uppercut', btn: 'hp', dir: 'd', su: 7, ac: 5, rc: 20, dmg: 110, bs: 14, limb: 'armF', r: 26, stop: 11, launch: [0.6, 14], base: 'crouch' }),
  M({ id: 'sweep', name: 'Sweep', btn: 'hk', dir: 'd', su: 10, ac: 4, rc: 22, dmg: 60, bs: 12, lvl: 'low', limb: 'legF', r: 13, stop: 8, launch: [2.5, 5.5], base: 'crouch', crouch: true }),
  M({ id: 'round', name: 'Roundhouse', btn: 'hk', dir: 'b', su: 12, ac: 4, rc: 20, dmg: 100, bs: 15, limb: 'legF', r: 14, stop: 10, launch: [8, 7] }),
  M({ id: 'over', name: 'Hammer', btn: 'hp', dir: 'f', su: 20, ac: 3, rc: 16, dmg: 70, hs: 22, bs: 12, lvl: 'oh', limb: 'armB', r: 14, stop: 8 }),
  M({ id: 'jp', name: 'Jump Punch', btn: 'lp', or: 'hp', air: true, su: 5, ac: 99, rc: 0, dmg: 50, hs: 18, bs: 12, lvl: 'oh', limb: 'armF', r: 14, base: 'air' }),
  M({ id: 'jk', name: 'Jump Kick', btn: 'lk', or: 'hk', air: true, su: 6, ac: 99, rc: 0, dmg: 60, hs: 20, bs: 13, lvl: 'oh', limb: 'legF', r: 14, stop: 7, base: 'air' }),
  M({ id: 'throw', name: 'Throw', btn: 'lp', chord: 'lk', su: 3, ac: 14, rc: 16, dmg: 120, grab: { range: 16 }, stop: 9 }),
].map(m => [m.id, m]))

/** Ready-made specials. design() uses these; hand-authored fighters can start from one and change anything. */
export const TEMPLATES: Record<SpecialType, (name: string, color: string) => Move> = {
  projectile: (name, color) => M({ id: 'projectile', name, motion: ['d', 'f'], btn: 'lp', su: 13, ac: 1, rc: 28, pose: 'cast', proj: [{ at: 13, vx: 7, dmg: 70, hs: 20, bs: 14, kb: 6, color }] }),
  rush: name => M({ id: 'rush', name, motion: ['b', 'f'], btn: 'hk', su: 9, ac: 14, rc: 20, dmg: 90, bs: 16, limb: 'armF', r: 16, stop: 10, launch: [7, 7], pose: 'rush', drive: [{ from: 9, to: 23, vx: 10 }] }),
  rising: name => M({ id: 'rising', name, motion: ['f', 'd'], btn: 'hp', su: 5, ac: 99, rc: 0, land: 18, dmg: 100, bs: 16, limb: 'armF', r: 26, stop: 11, launch: [2, 12.5], pose: 'upper', base: 'crouch', inv: [0, 8], drive: [{ from: 5, to: 6, vx: 2, vy: 12 }] }),
  teleport: name => M({ id: 'teleport', name, motion: ['d', 'b'], btn: 'lk', su: 10, ac: 1, rc: 14, pose: 'clp', base: 'crouch', inv: [4, 15], teleport: { at: 10, to: 'behind', dx: 80 } }),
  slide: name => M({ id: 'slide', name, motion: ['b', 'f'], btn: 'lk', su: 8, ac: 14, rc: 18, dmg: 70, bs: 14, lvl: 'low', limb: 'legF', r: 13, stop: 8, launch: [2.5, 5.5], pose: 'sweep', base: 'crouch', crouch: true, drive: [{ from: 8, to: 22, vx: 9 }] }),
}

const ARROW: Record<string, string> = { d: '↓', f: '→', b: '←' }
/** Human-readable input, e.g. "↓ → LP", "air LK", "after Jab: HP". */
export function cmdOf(m: Move, all: Record<string, Move>): string {
  if (!m.btn) return '—'
  const b = m.btn.toUpperCase() + (m.or ? '/' + m.or.toUpperCase() : '') + (m.chord ? ' + ' + m.chord.toUpperCase() : '')
  const core = m.motion ? m.motion.map(d => ARROW[d]).join(' ') + ' ' + b : m.dir ? `${ARROW[m.dir]} + ${b}` : b
  return (m.stringOnly ? 'in string: ' : '') + (m.from ? `after ${m.from.map(id => all[id]?.name ?? id).join('/')}: ` : '') + (m.air ? 'air ' : '') + core
}

/** Merge the kit, the fighter's tweaks and its own moves into what the sim actually runs. */
export function compile(d: FighterDef) {
  const moves: Record<string, Move> = {}, problems: string[] = [], poses = { ...POSES, ...d.poses }
  for (const id in MOVES) moves[id] = { ...MOVES[id], ...d.tweaks?.[id] }
  for (const m of d.moves ?? []) {
    if (moves[m.id]) problems.push(`move id "${m.id}" is used twice`)
    moves[m.id] = { ...MOVE_DEFAULTS, ...m, pose: m.pose ?? m.id }
  }
  for (const m of Object.values(moves)) {
    for (const k of [m.pose + '.w', m.pose + '.s', m.base]) if (!poses[k] || poses[k].length !== 11) { problems.push(`${m.name}: pose "${k}" is missing or malformed`); m.pose = 'lp'; m.base = 'idle0' }
    for (const p of m.from ?? []) if (!moves[p]) problems.push(`${m.name}: follows unknown move "${p}"`)
    if (!m.btn && !Object.values(moves).some(x => x.counter?.then === m.id)) problems.push(`${m.name}: has no button and nothing triggers it`)
    if (m.counter && !moves[m.counter.then]) problems.push(`${m.name}: counters into unknown move "${m.counter.then}"`)
    if (m.stringOnly && !d.strings.some(s => s.includes(m.id))) problems.push(`${m.name}: is string-only but appears in no string`)
  }
  for (const s of d.strings) for (const id of s) if (!moves[id]) problems.push(`string "${s.join(' ')}" uses unknown move "${id}"`)
  // most specific input wins: motions, then chords, then direction+button, then a bare button
  const prio = (m: Move) => (m.motion?.length ?? 0) * 10 + (m.chord ? 5 : 0) + (m.dir ? 2 : 0)
  return { moves, poses, problems, order: Object.values(moves).sort((a, b) => prio(b) - prio(a)), sheetKeys: [...POSE_KEYS, ...Object.keys(d.poses ?? {})] }
}
