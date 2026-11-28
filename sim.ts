// Deterministic 60Hz fight simulation. No DOM, no rendering, no randomness outside w.seed.
// Runs identically in the browser (the game) and in Node (the validator).
import { compile, fk, lerpPose, isSpecial, jumpCancels, type FighterDef, type Move, type Pose, type Btn, type Level, type ProjSpec } from './kit'

export const L = 1, R = 2, U = 4, D = 8, LP = 16, HP = 32, LK = 64, HK = 128, BL = 256
export const BIT: Record<Btn, number> = { lp: LP, hp: HP, lk: LK, hk: HK }
export const STAGE = { w: 960, min: 40, max: 920 }
/** Hitstun shrinks with each hit in a combo, so links (jab, jab, jab...) run dry while cancels and strings still connect. */
export const HS_DECAY = 0.08
/** Ticks on the ground between pressing up and leaving it: up + button in this window is an up attack, not a jump. */
export const JSQ = 3
/** Up + throw: straight up, juggleable, for less damage. */
const UP_THROW: [number, number] = [0.3, 13]
const G = 0.62, BUF = 10, DASH = 16, DOWN = 28, GETUP = 18

export type St = 'idle' | 'walk' | 'crouch' | 'squat' | 'air' | 'dash' | 'atk' | 'block' | 'hit' | 'bstun' | 'launch' | 'down' | 'getup' | 'thrown' | 'pulled' | 'rec' | 'ko' | 'win'
export type Fighter = {
  def: FighterDef; moves: Record<string, Move>; order: Move[]; poses: Record<string, Pose>
  x: number; y: number; vx: number; vy: number; face: 1 | -1
  st: St; t: number; cr: boolean; dd: number
  mv: Move | null; hitDone: boolean; hitT: number; contact: boolean; ender: boolean; str: string[]; airAtk: boolean; airUsed: string[]; tdir: number; tup: boolean; charge: number; jumpIn: number; driving: boolean; armor: number
  hp: number; meter: number; stun: number; inv: number
  buff: null | { t: number; power: number; speed: number; defense: number; color: string }
  combo: number; comboDmg: number; juggle: number // hits / damage taken in the current combo
  pulled: boolean // already dragged once this combo: a second pull is just a hit, so tethers cannot loop
  hist: number[]; buf: number; bufAge: number
}
export type Proj = {
  id: string; s: ProjSpec; x: number; y: number; vx: number; vy: number; owner: number; t: number; hits: number; cool: number
  w: number; h: number // hit box half-size (grows when the spec says so)
  wait: number // warning ticks left: shown, not live
  ax: number; ay: number // anchored: offset from the thrower's feet, forward-positive
  gates: { x: number; y: number }[] // portal mouths it went through, drawn while it flies
}
export type Ev = { type: 'hit' | 'block' | 'swing' | 'land' | 'thud' | 'ko' | 'throw' | 'fire' | 'jump' | 'tele' | 'charged'; x: number; y: number; power: number; who: number }
export type World = { f: [Fighter, Fighter]; proj: Proj[]; tick: number; stop: number; time: number; over: null | { winner: number }; ev: Ev[]; seed: number; plan: [number[], number[]] }

const newFighter = (def: FighterDef, x: number, face: 1 | -1): Fighter => {
  const c = compile(def)
  return {
    def, moves: c.moves, order: c.order, poses: c.poses, x, y: 0, vx: 0, vy: 0, face, st: 'idle', t: 0, cr: false, dd: 1,
    mv: null, hitDone: false, hitT: 0, contact: false, ender: false, str: [], airAtk: false, airUsed: [], tdir: 1, tup: false, charge: 0, jumpIn: 0, driving: false, armor: 0,
    hp: def.stats.hp, meter: 0, stun: 0, inv: 0, buff: null, pulled: false, combo: 0, comboDmg: 0, juggle: 0, hist: new Array(40).fill(0), buf: 0, bufAge: 99,
  }
}
export const newWorld = (a: FighterDef, b: FighterDef, seed = 1, dist = 300): World => ({
  f: [newFighter(a, STAGE.w / 2 - dist / 2, 1), newFighter(b, STAGE.w / 2 + dist / 2, -1)],
  proj: [], tick: 0, stop: 0, time: 99 * 60, over: null, ev: [], seed, plan: [[], []],
})

export const rnd = (w: World) => { // mulberry32
  let t = (w.seed += 0x6d2b79f5)
  t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}
export const airborne = (f: Fighter) => f.y > 0 || f.vy > 0
const pushW = (f: Fighter) => 22 * f.def.look.height
const setSt = (f: Fighter, st: St) => { if (f.st !== st) { f.st = st; f.t = 0 } }
const toIdle = (f: Fighter) => { f.st = 'idle'; f.t = 0; f.mv = null; f.combo = f.comboDmg = f.juggle = 0; f.cr = false; f.str = []; f.driving = f.pulled = false; if (f.inv > 900) f.inv = 0 }
const gain = (f: Fighter, n: number) => { f.meter = Math.min(100, f.meter + n) }

// ---- pose / boxes -----------------------------------------------------------
/** Which two key poses the fighter is between, and how far. Rig mode blends them; sprite mode shows the nearer. */
export function poseKeys(f: Fighter): [string, string, number] {
  const ease = (u: number) => u * u * (3 - 2 * u)
  switch (f.st) {
    case 'idle': return ['idle0', 'idle1', 0.5 - 0.5 * Math.cos(f.t / 25 * Math.PI)]
    case 'walk': { const ph = (f.dd > 0 ? f.t : 4000 - f.t) / 8, i = Math.floor(ph) % 4; return ['walk' + i, 'walk' + (i + 1) % 4, ph % 1] }
    case 'crouch': case 'rec': case 'squat': return ['crouch', 'crouch', 0]
    case 'block': case 'bstun': return f.cr ? ['cblock', 'cblock', 0] : ['block', 'block', 0]
    case 'air': return ['air', 'air', 0]
    case 'dash': return f.dd > 0 ? ['dashF', 'dashF', 0] : ['dashB', 'dashB', 0]
    case 'hit': case 'pulled': return ['hit', 'hit', 0]
    case 'launch': case 'thrown': return ['launch', 'launch', 0]
    case 'down': case 'ko': return ['down', 'down', 0]
    case 'getup': { const u = f.t / GETUP; return u < 0.5 ? ['down', 'crouch', u * 2] : ['crouch', 'idle0', u * 2 - 1] }
    case 'win': return ['idle0', 'win', Math.min(1, f.t / 12)]
    case 'atk': {
      const m = f.mv!, w = m.pose + '.w', s = m.pose + '.s', t = f.t
      if (t < m.su) { const u = t / m.su; return u < 0.5 ? [m.base, w, ease(u * 2)] : [w, s, (u * 2 - 1) ** 2] }
      if (m.grab) return t < m.su + m.ac ? [w, s, ease((t - m.su) / m.ac)] : [s, 'idle0', ease((t - m.su - m.ac) / m.rc)]
      if (t < m.su + m.ac || airborne(f)) return [s, s, 0]
      return [s, m.base === 'air' ? 'idle0' : m.base, ease(Math.min(1, (t - m.su - m.ac) / Math.max(1, m.rc)))]
    }
  }
}
export const poseOf = (f: Fighter): Pose => { const [a, b, u] = poseKeys(f); return u ? lerpPose(f.poses[a], f.poses[b], u) : f.poses[a] }

export type Box = { x0: number; x1: number; y0: number; y1: number }
const overlap = (a: Box, b: Box) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1
const world = (f: Fighter, xa: number, xb: number, y0: number, y1: number): Box =>
  ({ x0: f.x + Math.min(f.face * xa, f.face * xb), x1: f.x + Math.max(f.face * xa, f.face * xb), y0: f.y + y0, y1: f.y + y1 })

/** The attack box: the striking limb in the move's strike pose, padded. Null when not active. */
export function hitbox(f: Fighter): Box | null {
  const m = f.mv
  if (f.st !== 'atk' || !m?.limb || f.t < m.su || f.t >= m.su + m.ac) return null
  const j = fk(f.poses[m.pose + '.s'], f.def.look), r = m.r * f.def.look.height
  const [a, b] = m.limb === 'armF' ? [j.elF, j.fiF] : m.limb === 'armB' ? [j.elB, j.fiB] : m.limb === 'legF' ? [j.knF, j.ftF] : [j.knB, j.ftB]
  return world(f, Math.min(a[0], b[0]) - r, Math.max(a[0], b[0]) + r, Math.min(a[1], b[1]) - r, Math.max(a[1], b[1]) + r)
}
export function hurtbox(f: Fighter): Box {
  // ponytail: one body box from hip/neck/head; add limb boxes if kicks need to be counter-hittable at range
  const j = fk(poseOf(f), f.def.look), hw = 20 * f.def.look.height
  return world(f, Math.min(j.hip[0], j.neck[0], j.head[0]) - hw, Math.max(j.hip[0], j.neck[0], j.head[0]) + hw, 0, j.head[1] + j.HR)
}

// ---- input ------------------------------------------------------------------
function record(f: Fighter, inp: number) {
  const pressed = inp & ~f.hist[0] & (LP | HP | LK | HK)
  f.hist.unshift(inp); f.hist.length = 40
  if (pressed) { f.buf = f.bufAge <= 2 ? f.buf | pressed : pressed; f.bufAge = 0 } else f.bufAge++
}
const dtap = (h: number[], bit: number) => { // tap, release, tap
  if (!(h[0] & bit) || (h[1] & bit)) return false
  for (let k = 2; k <= 10; k++) { if (h[k] & (L | R | U | D) & ~bit) return false; if (h[k] & bit) return true }
  return false
}
const dirBit = (f: Fighter, d: string) => d === 'd' ? D : d === 'u' ? U : (d === 'f') === (f.face > 0) ? R : L
/** A motion's first direction, when it is forward or back, must be a tap: held longer than this, it was a walk. */
export const MOTION_TAP = 10
function motion(f: Fighter, dirs: string[]) { // each direction held in order, the last within 12 ticks of the button
  // skip: once a direction matches, the ticks still holding it belong to it. Without this one diagonal counts
  // twice, so ↓ ↘ → read as ↓ → ↓ → and a quarter circle with full meter came out as the super.
  let k = dirs.length - 1, limit = 12, skip = 0
  for (let t = 0; t < 40 && t <= limit; t++) {
    if (skip) { if (f.hist[t] & skip) continue; skip = 0 }
    if (!(f.hist[t] & dirBit(f, dirs[k]))) continue
    if (k === 0) { // walking back then pressing f+HP is a command normal, not a back-forward special
      if (dirs[0] === 'd') return true
      let held = 0; while (t + held < 40 && f.hist[t + held] & dirBit(f, dirs[0])) held++
      return held <= MOTION_TAP
    }
    skip = dirBit(f, dirs[k]); k--; limit = t + 10
  }
  return false
}
/** Is this move's full input (button, chord, direction, motion, meter) satisfied right now? */
function inputOk(w: World, i: number, m: Move): boolean {
  const f = w.f[i], b = f.buf
  if (!m.btn || !(b & BIT[m.btn] || (m.or && b & BIT[m.or]))) return false
  if (m.chord && !(b & BIT[m.chord])) return false
  if (!!m.air !== airborne(f)) return false
  if (m.dir && !(f.hist[0] & dirBit(f, m.dir))) return false
  if (m.motion && !motion(f, m.motion)) return false
  if ((m.cost ?? 0) > f.meter || (m.needs === 'buff' && !f.buff)) return false
  return !(m.proj && w.proj.some(p => p.owner === i && p.id === m.id)) // one of each projectile at a time
}
/** The exact inputs that perform a move from neutral, one entry per tick. Used by the CPU, the validator and demos. */
export function scriptFor(m: Move, right = true): number[] {
  const bit = (d: string) => d === 'd' ? D : d === 'u' ? U : (d === 'f') === right ? R : L
  const b = (m.btn ? BIT[m.btn] : 0) | (m.chord ? BIT[m.chord] : 0)
  if (m.motion) return [...m.motion.flatMap(d => [bit(d), bit(d)]), bit(m.motion[m.motion.length - 1]) | b]
  return [(m.dir ? bit(m.dir) : 0) | b]
}

function start(w: World, f: Fighter, m: Move) {
  f.st = 'atk'; f.t = 0; f.mv = m; f.hitDone = f.contact = f.ender = f.driving = false; f.hitT = 0; f.buf = 0; f.cr = !!m.crouch
  f.armor = m.armor ?? 0; f.meter -= m.cost ?? 0; f.charge = 0
  if (airborne(f)) { f.airAtk = true; f.airUsed.push(m.id) } else f.vx = 0
  f.str = [m.id]
  w.ev.push({ type: 'swing', x: f.x, y: f.y + 100, power: m.stop, who: w.f.indexOf(f) })
}
/** Leave the ground. `lift` > 1 is the higher jump that chases a launched opponent. */
function jump(w: World, i: number, inp: number, lift: number) {
  const f = w.f[i], fwd = f.face > 0 ? R : L, back = f.face > 0 ? L : R, sp = f.def.stats.speed * (f.buff?.speed ?? 1)
  f.st = 'air'; f.t = 0; f.mv = null; f.cr = false; f.str = []; f.driving = false; f.airAtk = false; f.airUsed = []; f.vy = 13.2 * f.def.stats.jump * lift
  f.vx = f.face * sp * (inp & fwd ? 4.2 : inp & back ? -3.6 : 0)
  w.ev.push({ type: 'jump', x: f.x, y: 0, power: 1, who: i })
}
function tryAttack(w: World, i: number): boolean {
  const f = w.f[i]
  if (!f.buf || f.bufAge > BUF) return false
  for (const m of f.order) if (!m.from && !m.stringOnly && inputOk(w, i, m)) { start(w, f, m); return true }
  return false
}
function stringNext(w: World, i: number): Move | null {
  const f = w.f[i], n = f.str.length
  let neutral: Move | null = null
  for (const s of f.def.strings) {
    if (s.length <= n || !f.str.every((x, k) => s[k] === x)) continue
    const m = f.moves[s[n]], btn = m?.btn ?? (s[n] as Btn)
    if (!m || !(f.buf & BIT[btn]) || (m.cost ?? 0) > f.meter || (m.needs === 'buff' && !f.buff)) continue
    if (!m.dir) neutral ??= m // a plain step accepts any held direction, but a matching directional step wins
    else if (f.hist[0] & dirBit(f, m.dir)) return m
  }
  return neutral
}

// ---- per-fighter state machine ----------------------------------------------
function think(w: World, i: number, inp: number) {
  const f = w.f[i], o = w.f[1 - i]
  f.t++
  if (f.inv > 0 && f.inv < 900) f.inv--
  if (f.buff && --f.buff.t <= 0) f.buff = null
  switch (f.st) {
    case 'idle': case 'walk': case 'crouch': case 'block': {
      f.face = o.x >= f.x ? 1 : -1
      const fwd = f.face > 0 ? R : L, back = f.face > 0 ? L : R, sp = f.def.stats.speed * (f.buff?.speed ?? 1)
      if (tryAttack(w, i)) return
      f.vx = 0; f.cr = false
      if (inp & BL) { setSt(f, 'block'); f.cr = !!(inp & D) }
      else if (inp & D) { setSt(f, 'crouch'); f.cr = true }
      else if (inp & U) { f.st = 'squat'; f.t = 0; f.vx = 0; f.jumpIn = inp } // jump squat: the arc is chosen on this tick
      else if (dtap(f.hist, fwd)) { f.st = 'dash'; f.t = 0; f.dd = 1 }
      else if (dtap(f.hist, back)) { f.st = 'dash'; f.t = 0; f.dd = -1 }
      else if (inp & fwd && !(inp & back)) { setSt(f, 'walk'); f.dd = 1; f.vx = f.face * 3.2 * sp }
      else if (inp & back && !(inp & fwd)) { setSt(f, 'walk'); f.dd = -1; f.vx = -f.face * 2.6 * sp }
      else setSt(f, 'idle')
      return
    }
    case 'squat': {
      if (tryAttack(w, i)) return // up + button during the squat is an up attack
      if (f.t < JSQ) return
      jump(w, i, f.jumpIn | inp, 1)
      return
    }
    case 'dash':
      if (f.dd > 0 && tryAttack(w, i)) return
      f.vx = f.face * f.dd * f.def.stats.speed * (f.buff?.speed ?? 1) * (f.dd > 0 ? 9 * (1 - f.t / DASH) + 2 : 8 * (1 - f.t / DASH) + 1.5)
      if (f.t >= DASH) toIdle(f)
      return
    case 'air': if (!f.airAtk) tryAttack(w, i); return
    case 'atk': return attackTick(w, i, inp)
    case 'hit': case 'bstun': case 'rec': if (--f.stun <= 0) toIdle(f); return
    case 'down': if (f.hp <= 0) { f.st = 'ko'; w.ev.push({ type: 'ko', x: f.x, y: 0, power: 1, who: i }) } else if (f.t >= DOWN) setSt(f, 'getup'); return
    case 'getup': if (f.t >= GETUP) toIdle(f); return
    case 'thrown': if (o.st !== 'atk' || !o.mv?.grab) { f.st = 'launch'; f.vy = 4 } return
    case 'pulled': { // dragged to point-blank, then left stunned
      const tx = o.x + o.face * (pushW(f) + pushW(o) + 10), dx = tx - f.x
      if (Math.abs(dx) <= 18) { f.x = tx; f.st = 'hit'; f.t = 0 } else f.x += Math.sign(dx) * 18
      return
    }
  }
}

function attackTick(w: World, i: number, inp: number) {
  const f = w.f[i], o = w.f[1 - i], m = f.mv!, t = f.t, back = f.face > 0 ? L : R, air = airborne(f)
  // charging: holding the button at the end of the windup freezes it there, up to charge.max ticks
  if (m.charge && m.btn && t === m.su - 1 && f.charge < m.charge.max && f.hist[0] & BIT[m.btn]) { f.charge++; f.t--; if (f.charge === m.charge.max) w.ev.push({ type: 'charged', x: f.x, y: f.y + 100, power: 2, who: i }); return }
  // LP and LK rarely land on the same tick: a fresh jab/kick becomes a throw if the other button follows
  if (t <= 2 && (m.id === 'lp' || m.id === 'lk') && inp & LP && inp & LK) return start(w, f, f.moves.throw)
  if (m.grab) {
    const reach = Math.abs(o.x - f.x) <= pushW(f) + pushW(o) + m.grab.range && o.inv <= 0
    const prey = m.grab.air ? airborne(o) && o.y < 170 && ['air', 'atk', 'launch'].includes(o.st) : !airborne(o) && ['idle', 'walk', 'crouch', 'squat', 'block', 'dash'].includes(o.st)
    if (t === m.su && reach && prey) {
      o.st = 'thrown'; o.t = 0; o.mv = null; f.contact = true; f.tdir = inp & back ? -1 : 1; f.tup = !m.grab.air && !!(f.hist.slice(0, m.su + 1).some(h => h & U))
      w.ev.push({ type: 'throw', x: o.x, y: 100, power: 4, who: i })
    }
    if (f.contact && t < m.su + m.ac) { o.x = f.x + f.face * 38; o.y = 30; o.vx = o.vy = 0 }
    if (f.contact && t === m.su + m.ac) {
      const l = f.tup ? UP_THROW : m.launch ?? [6.5, 8]
      o.x = f.x + f.face * f.tdir * 38; o.st = 'launch'; o.vx = f.face * f.tdir * l[0]; o.vy = l[1]
      if (m.grab.juggle || f.tup) o.juggle = Math.max(o.juggle, 1); else { o.juggle = 9; o.inv = 999 } // up throw: tossed straight up, free to juggle
      const dmg = Math.round(m.dmg * (f.tup ? 0.6 : 1) * f.def.stats.power * (f.buff?.power ?? 1)); o.hp = Math.max(0, o.hp - dmg); o.combo++; o.comboDmg += dmg; gain(f, 12)
      w.stop = m.stop; w.ev.push({ type: 'hit', x: o.x, y: 60, power: m.stop, who: i })
    }
  }
  if (m.inv && t === m.inv[0]) f.inv = m.inv[1] - m.inv[0]
  if (t === m.su) {
    if (m.buff) f.buff = { power: 1, speed: 1, defense: 1, color: '#ffffff', ...m.buff, t: m.buff.ticks }
    if (m.meter) gain(f, m.meter)
  }
  f.driving = false
  for (const d of m.drive ?? []) {
    if (t === d.from && d.vy !== undefined) { f.vy = d.vy; if (d.vy > 0) f.y = Math.max(f.y, 0.01) }
    if (t >= d.from && t < d.to && d.vx !== undefined && !(f.contact && !air)) { f.vx = f.face * d.vx; f.driving = true }
  }
  if (m.drive && !f.driving && !air) f.vx = 0
  for (const p of m.proj ?? []) if (t === p.at) {
    const at = place(f, o, p), sz = p.size ?? 14
    w.proj.push({ id: m.id, s: p, ...at, owner: i, t: 0, hits: p.hits ?? 1, cool: 0, w: p.w ?? sz, h: p.h ?? sz * 0.85, wait: p.warn ?? 0,
      ax: (at.x - f.x) * f.face, ay: at.y - f.y, gates: [] })
    w.ev.push({ type: 'fire', x: f.x + f.face * 50, y: f.y + 105, power: 3, who: i })
  }
  if (m.teleport && t === m.teleport.at) {
    const tp = m.teleport, x = tp.to === 'self' ? f.x + f.face * tp.dx : o.x + (tp.to === 'behind' ? -o.face : o.face) * tp.dx
    f.x = Math.max(STAGE.min, Math.min(STAGE.max, x))
    w.ev.push({ type: 'tele', x: f.x, y: 80, power: 2, who: i })
  }
  // cancels on contact: follow-ups first, then specials and the next string step
  // launchers: hold up on contact to jump after the opponent
  if (f.contact && !air && jumpCancels(m) && f.hist.slice(0, BUF).some(h => h & U)) return jump(w, i, inp | U, 1.15)
  if (f.contact && f.buf && f.bufAge <= BUF) {
    for (const n of f.order) if (n.from?.includes(m.id) && inputOk(w, i, n)) return start(w, f, n)
    // air chains: on contact, any air move not used yet this jump (jump punch › jump kick › air special or air grab)
    if (air) for (const n of f.order) if (n.air && !n.from && !n.stringOnly && !f.airUsed.includes(n.id) && inputOk(w, i, n)) return start(w, f, n)
    if (!air && (m.cancel ?? (!isSpecial(m) && !m.launch && !m.grab && !m.from))) {
      for (const n of f.order) if (isSpecial(n) && !n.air && !n.from && !n.stringOnly && inputOk(w, i, n)) return start(w, f, n)
      const next = f.str[f.str.length - 1] === m.id ? stringNext(w, i) : null
      if (next) {
        const str = [...f.str, next.id]
        start(w, f, next); f.str = str; f.vx = f.face * 3
        f.ender = !f.def.strings.some(s => s.length > str.length && str.every((x, k) => s[k] === x))
        return
      }
    }
  }
  if (t >= m.su + m.ac + m.rc && !air) toIdle(f)
}

// ---- projectiles ---------------------------------------------------------------
const toward = (f: Fighter, o: Fighter) => (Math.sign(o.x - f.x) || f.face) as 1 | -1
const onStage = (x: number) => Math.max(10, Math.min(STAGE.w - 10, x))
/** Where a projectile spawns and how it starts moving, from its spec's `from`. */
function place(f: Fighter, o: Fighter, p: ProjSpec): { x: number; y: number; vx: number; vy: number } {
  const h = f.def.look.height, s = toward(f, o)
  switch (p.from ?? (p.aim ? 'target' : 'hand')) {
    case 'hand': return { x: f.x + f.face * (p.x ?? 50) * h, y: f.y + (p.y ?? 105) * h, vx: f.face * p.vx, vy: p.vy ?? 0 }
    case 'target': return { x: o.x + f.face * (p.x ?? 0) * h, y: f.y + (p.y ?? 105) * h, vx: f.face * p.vx, vy: p.vy ?? 0 }
    case 'above': return { x: onStage(o.x + s * (p.x ?? 0)), y: o.y + (p.y ?? 380), vx: s * p.vx, vy: p.vy ?? -12 }
    case 'behind': return { x: onStage(o.x + s * (p.x ?? 150)), y: o.y + (p.y ?? 100), vx: -s * p.vx, vy: p.vy ?? 0 }
    case 'below': return { x: onStage(o.x + s * (p.x ?? 0)), y: p.y ?? 0, vx: s * p.vx, vy: p.vy ?? 9 }
  }
}
/** The projectile's hit box: centred on it, or reaching forward from the thrower when anchored. */
export function projBox(p: Proj, owner: Fighter): Box {
  if (!p.s.anchor) return { x0: p.x - p.w, x1: p.x + p.w, y0: p.y - p.h, y1: p.y + p.h }
  const x2 = p.x + owner.face * 2 * p.w
  return { x0: Math.min(p.x, x2), x1: Math.max(p.x, x2), y0: p.y - p.h, y1: p.y + p.h }
}
/** Through the portal: vanish here, come out beside the opponent, and fly straight at them. */
function portal(w: World, p: Proj) {
  const f = w.f[p.owner], o = w.f[1 - p.owner], g = p.s.portal!, s = toward(f, o)
  p.gates.push({ x: p.x, y: p.y })
  const [x, y] = g.to === 'above' ? [o.x, o.y + 330] : g.to === 'behind' ? [o.x + s * 150, o.y + 100] : [o.x - s * 150, o.y + 100]
  p.x = onStage(x); p.y = y
  const tx = o.x - p.x, ty = o.y + 100 - p.y, d = Math.hypot(tx, ty) || 1, v = g.speed ?? (Math.hypot(p.vx, p.vy) || 8)
  p.vx = tx / d * v; p.vy = ty / d * v
  p.gates.push({ x: p.x, y: p.y })
  w.ev.push({ type: 'tele', x: p.x, y: p.y, power: 2, who: p.owner })
}

// ---- hits -------------------------------------------------------------------
type Hit = { dmg: number; hs: number; bs: number; lvl: Level; kb: number; stop: number; launch?: [number, number]; unblockable?: boolean; pull?: number; heal?: number }
const hittable = (d: Fighter) => d.inv <= 0 && !['down', 'getup', 'thrown', 'pulled', 'ko', 'win'].includes(d.st)

function applyHit(w: World, ai: number, h: Hit, fromX: number, x: number, y: number, melee: boolean) {
  const a = w.f[ai], d = w.f[1 - ai], dir = d.x >= fromX ? 1 : -1
  const c = d.st === 'atk' ? d.mv!.counter : undefined
  if (melee && c && d.t >= c.from && d.t < c.to && d.moves[c.then]) { // countered: the defender takes nothing and answers
    d.face = -dir as 1 | -1; start(w, d, d.moves[c.then]); d.inv = 8
    w.stop = 12; w.ev.push({ type: 'block', x, y, power: 6, who: 1 - ai }); return
  }
  const blocked = !h.unblockable && (d.st === 'block' || d.st === 'bstun') && d.face === -dir && (h.lvl === 'mid' || (h.lvl === 'low' ? d.cr : !d.cr))
  if (blocked) {
    d.st = 'bstun'; d.t = 0; d.stun = h.bs; d.vx = dir * 4; gain(a, 3)
    w.stop = Math.min(h.stop, 4); w.ev.push({ type: 'block', x, y, power: 3, who: ai })
  } else {
    const armored = d.st === 'atk' && d.armor > 0
    const dmg = Math.round(h.dmg * a.def.stats.power * (a.buff?.power ?? 1) / (d.buff?.defense ?? 1) * Math.max(0.4, 1 - 0.12 * d.combo) * (armored ? 0.5 : 1))
    if (h.heal) a.hp = Math.min(a.def.stats.hp, a.hp + Math.round(dmg * h.heal))
    d.hp = Math.max(0, d.hp - dmg); gain(a, dmg * 0.12); gain(d, dmg * 0.06)
    const ko = d.hp <= 0
    if (armored && !ko) d.armor--
    else {
      d.combo++; d.comboDmg += dmg; d.mv = null; d.driving = false
      if (h.pull && !ko && !d.pulled) { d.pulled = true; d.st = 'pulled'; d.t = 0; d.stun = h.pull; d.vx = d.vy = 0; d.y = 0; d.cr = false }
      else if (ko || airborne(d) || d.st === 'launch' || (h.launch && h.launch[1] > 0)) { // a downward launch (spike) only slams airborne targets
        const l = ko ? [6, 9] : h.launch ?? [3, 6.5]
        d.juggle++; d.st = 'launch'; d.t = 0; d.vx = dir * l[0]; d.vy = l[1] * 0.88 ** (d.juggle - 1); d.y = Math.max(d.y, 0.01)
        if (d.juggle >= 5) d.inv = 999 // juggle cap: no infinites
      } else { d.st = 'hit'; d.t = 0; d.stun = Math.max(6, Math.round(h.hs * Math.min(1, Math.max(0.5, 1 - HS_DECAY * (d.combo - 3))))); d.vx = dir * h.kb; d.cr = false }
    }
    w.stop = ko ? 16 : h.stop; w.ev.push({ type: 'hit', x, y, power: h.stop, who: ai })
  }
  // cornered defenders push the attacker back instead
  if (melee && !airborne(a) && (dir > 0 ? d.x >= STAGE.max - 1 : d.x <= STAGE.min + 1)) a.vx = -dir * h.kb
}
function strike(w: World, i: number): (() => void) | null {
  const f = w.f[i], o = w.f[1 - i], m = f.mv
  const hb = !f.hitDone || (m?.rehit && f.t - f.hitT >= m.rehit) ? hitbox(f) : null
  if (!hb || !m || !hittable(o)) return null
  const ob = hurtbox(o)
  if (!overlap(hb, ob)) return null
  const ender = f.ender
  return () => {
    f.hitDone = f.contact = true; f.hitT = f.t
    const c = m.charge ? f.charge / m.charge.max : 0, full = c >= 1 && m.charge?.launch
    const launch = full ? m.charge!.launch : m.launch ?? (ender ? (m.id === 'hp' ? [1, 12] : [7, 6.5]) as [number, number] : undefined)
    const dmg = m.charge ? Math.round(m.dmg * (1 + (m.charge.dmg - 1) * c)) : m.dmg
    applyHit(w, i, { ...m, dmg, launch, stop: m.stop + Math.round(6 * c) }, f.x, (Math.max(hb.x0, ob.x0) + Math.min(hb.x1, ob.x1)) / 2, (Math.max(hb.y0, ob.y0) + Math.min(hb.y1, ob.y1)) / 2, true)
  }
}

// ---- step -------------------------------------------------------------------
export function step(w: World, in0: number, in1: number) {
  w.ev = []
  if (w.over) in0 = in1 = 0
  record(w.f[0], in0); record(w.f[1], in1)
  if (w.stop > 0) { w.stop--; return }
  think(w, 0, in0); think(w, 1, in1)

  for (const f of w.f) {
    if (f.st === 'thrown' || f.st === 'pulled') continue
    if (airborne(f)) {
      f.vy -= G * (f.st === 'launch' ? 1 + 0.12 * f.juggle : 1); f.y += f.vy; f.x += f.vx
      if (f.y <= 0) {
        f.y = 0; f.vy = 0
        if (f.st === 'launch') { f.st = 'down'; f.t = 0; f.vx *= 0.4; w.ev.push({ type: 'thud', x: f.x, y: 0, power: 5, who: w.f.indexOf(f) }) }
        else if (f.st === 'atk' && f.mv!.land) { f.st = 'rec'; f.t = 0; f.stun = f.mv!.land!; f.mv = null; f.vx = 0; f.driving = false }
        else { toIdle(f); f.vx = 0; w.ev.push({ type: 'land', x: f.x, y: 0, power: 1, who: w.f.indexOf(f) }) }
      }
    } else {
      f.x += f.vx
      if (f.st !== 'walk' && f.st !== 'dash' && !f.driving) f.vx *= 0.8
    }
  }
  const [a, b] = w.f, pd = pushW(a) + pushW(b), dx = b.x - a.x
  const solid = (f: Fighter) => !['down', 'ko', 'thrown', 'pulled', 'launch'].includes(f.st)
  if (Math.abs(dx) < pd && Math.abs(a.y - b.y) < 80 && solid(a) && solid(b)) {
    const push = Math.min(6, (pd - Math.abs(dx)) / 2) * (dx > 0 || (dx === 0 && a.face > 0) ? 1 : -1)
    a.x -= push; b.x += push
  }
  for (const f of w.f) f.x = Math.max(STAGE.min, Math.min(STAGE.max, f.x))

  const hits = [strike(w, 0), strike(w, 1)] // resolve both before applying so trades are fair
  for (const h of hits) h?.()

  for (const p of w.proj) {
    if (p.t < 0) continue
    const f = w.f[p.owner], d = w.f[1 - p.owner]
    if (p.s.anchor) { // rides on the thrower; a hit on them (or the move ending) puts it out
      if (f.st !== 'atk' || f.mv?.id !== p.id) { p.t = -1; continue }
      p.x = f.x + f.face * p.ax; p.y = f.y + p.ay
    }
    if (p.wait > 0) { p.wait--; continue } // still a warning: not moving, not live
    if (!p.s.anchor) { p.vy -= p.s.g ?? 0; p.x += p.vx; p.y += p.vy }
    p.t++; p.cool--
    if (p.s.grow) { p.w = Math.min(p.s.max?.[0] ?? 999, p.w + p.s.grow[0]); p.h = Math.min(p.s.max?.[1] ?? 999, p.h + p.s.grow[1]) }
    if (p.s.portal && p.t === p.s.portal.at) portal(w, p)
    const pb = projBox(p, f)
    const clash = w.proj.find(q => q.owner !== p.owner && q.t >= 0 && q.wait <= 0 && ((Math.abs(q.x - p.x) < 24 && Math.abs(q.y - p.y) < 40) || overlap(pb, projBox(q, w.f[q.owner]))))
    if (clash) { clash.t = p.t = -1; w.ev.push({ type: 'block', x: p.x, y: p.y, power: 3, who: p.owner }) }
    else if (p.cool <= 0 && hittable(d) && overlap(pb, hurtbox(d))) {
      applyHit(w, p.owner, { hs: 18, bs: 12, lvl: 'mid', kb: 5, stop: 6, ...p.s }, p.s.anchor ? f.x : p.x - p.vx, p.s.anchor ? d.x : p.x, p.y, false)
      p.cool = 8; if (--p.hits <= 0) p.t = -1
    }
    else if (!p.s.anchor && (p.x < -40 || p.x > STAGE.w + 40 || p.y > 900)) p.t = -1
    else if (p.t > (p.s.life ?? 600)) p.t = -1
    else if (!p.s.anchor && p.y <= 0 && (p.s.g || p.vy < 0)) { p.t = -1; w.ev.push({ type: 'block', x: p.x, y: 4, power: 2, who: p.owner }) }
  }
  w.proj = w.proj.filter(p => p.t >= 0)

  if (!w.over) {
    const dead = w.f.map(f => f.st === 'ko')
    if (dead[0] || dead[1]) w.over = { winner: dead[0] && dead[1] ? -1 : dead[0] ? 1 : 0 }
    else if (--w.time <= 0) w.over = { winner: a.hp === b.hp ? -1 : a.hp > b.hp ? 0 : 1 }
  } else {
    const v = w.f[w.over.winner]
    if (v && ['idle', 'walk', 'crouch', 'block'].includes(v.st)) { v.st = 'win'; v.t = 0; v.vx = 0 }
  }
  w.tick++
}

// ---- CPU opponent -----------------------------------------------------------
/** Returns this tick's input for fighter i. skill 0..1 scales blocking, anti-airs and aggression. */
export function cpu(w: World, i: number, skill = 0.6): number {
  const plan = w.plan[i]
  if (plan.length) return plan.shift()!
  const f = w.f[i], o = w.f[1 - i], right = o.x >= f.x, fwd = right ? R : L, back = right ? L : R, dist = Math.abs(o.x - f.x)
  const r = () => rnd(w), go = (...p: number[]) => { plan.push(...p.slice(1)); return p[0] }
  const usable = (test: (m: Move) => unknown) => f.order.filter(m => isSpecial(m) && !m.from && !m.stringOnly && !m.air && (m.cost ?? 0) <= f.meter && test(m))
  const use = (ms: Move[]) => go(...scriptFor(ms[Math.floor(r() * ms.length)], right))
  if (f.st === 'atk' && f.contact && r() < skill) { // press a follow-up when one exists
    const fu = f.order.filter(m => m.from?.includes(f.mv!.id) && m.btn)
    if (fu.length) return go(...scriptFor(fu[Math.floor(r() * fu.length)], right), 0)
    if (jumpCancels(f.mv!) && o.st === 'launch') return go(U | fwd, U | fwd, U | fwd, 0, 0, 0, LP) // chase the launch
  }
  if (f.st === 'atk' && airborne(f) && f.contact && f.mv!.id === 'jp' && r() < skill) return LK // air chain
  if (f.st === 'air') return dist < 130 && f.vy < 0 && r() < 0.3 ? HK : 0
  if (!['idle', 'walk', 'crouch', 'block'].includes(f.st)) return 0
  const threat = (o.st === 'atk' && dist < 170) || w.proj.some(p => p.owner !== i && Math.abs(p.x - f.x) < 150)
  if (threat && r() < skill) { const g = BL | (o.mv?.lvl === 'low' ? D : 0); return go(...new Array(8).fill(g)) }
  if (airborne(o) && dist < 130 && o.vy < 0 && r() < skill) return r() < 0.3 ? U | LP : D | HP
  if (dist > 280) {
    const c = r(), zone = usable(m => m.proj)
    if (zone.length && c < 0.04) return use(zone)
    if (c < 0.06) return go(fwd, 0, fwd)
    return c < 0.08 ? U | fwd : fwd
  }
  if (dist > 100) {
    const c = r(), close = usable(m => m.drive || m.teleport)
    if (c < 0.02) return go(U | fwd, ...new Array(20).fill(0), HK)
    if (close.length && c < 0.04) return use(close)
    return c < 0.1 ? 0 : fwd
  }
  if (r() > 0.1 + 0.15 * skill) return 0
  const c = r()
  if (c < 0.4 && f.def.strings.length) {
    const s = f.def.strings[Math.floor(r() * f.def.strings.length)]
    return go(...s.flatMap(id => [f.moves[id] ? scriptFor(f.moves[id], right).at(-1)! : LP, 0, 0, 0, 0, 0]))
  }
  const near = usable(m => (m.limb || m.grab || m.buff) && !m.drive)
  if (near.length && c < 0.5) return use(near)
  if (c < 0.54) return go(...new Array(10 + Math.floor(r() * 40)).fill(r() < 0.5 ? HK : U | HK)) // a charged smash
  if (c < 0.57) return go(U | LP | LK, U, U, U) // up throw
  return c < 0.6 ? LP | LK : c < 0.7 ? D | HK : c < 0.77 ? fwd | HP : c < 0.84 ? D | HP : c < 0.92 ? D | LK : go(back, back, back, back)
}
