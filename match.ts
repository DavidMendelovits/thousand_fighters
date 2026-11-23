// A match: best of three rounds (first to FIRST_TO), with an intro before each round and a pause after it.
// Pure (no DOM): the studio plays it, cli.ts plays CPU matches to prove every round resolves.
import { newWorld, step, type World } from './sim'
import type { FighterDef } from './kit'

export const FIRST_TO = 2, INTRO = 70, OUTRO = 150, MAX_ROUNDS = 5, START_DIST = 300
export type Phase = 'intro' | 'fight' | 'over' | 'done'
export type Match = { a: FighterDef; b: FighterDef; seed: number; w: World; wins: [number, number]; round: number; phase: Phase; t: number; last: number }

export const newMatch = (a: FighterDef, b: FighterDef, seed = 1): Match =>
  ({ a, b, seed, w: newWorld(a, b, seed, START_DIST), wins: [0, 0], round: 1, phase: 'intro', t: 0, last: -1 })

/** Winner of the match: 0 or 1, -1 for a draw, null while it's still going. */
export const matchWinner = (m: Match) => m.phase !== 'done' ? null : m.wins[0] === m.wins[1] ? -1 : m.wins[0] > m.wins[1] ? 0 : 1

/** One 60Hz tick. Inputs are ignored outside the fight phase. A new round swaps in a fresh World (compare m.w to reset effects). */
export function matchStep(m: Match, in0: number, in1: number) {
  m.t++
  const live = m.phase === 'fight'
  step(m.w, live ? in0 : 0, live ? in1 : 0)
  if (m.phase === 'intro') {
    m.w.time = 99 * 60 // the clock starts at FIGHT!
    if (m.t >= INTRO) { m.phase = 'fight'; m.t = 0 }
  } else if (m.phase === 'fight' && m.w.over) {
    const win = m.w.over.winner
    if (win < 0) { m.wins[0]++; m.wins[1]++ } else m.wins[win]++ // a draw counts for both
    m.last = win; m.phase = 'over'; m.t = 0
  } else if (m.phase === 'over' && m.t >= OUTRO) {
    if (Math.max(...m.wins) >= FIRST_TO || m.round >= MAX_ROUNDS) { m.phase = 'done'; m.t = 0; return }
    m.round++; m.w = newWorld(m.a, m.b, m.seed + m.round, START_DIST); m.phase = 'intro'; m.t = 0
  }
}

/** What the arena says over the fight. */
export function matchBanner(m: Match): { banner?: string; sub?: string } {
  const name = (i: number) => m.w.f[i].def.name.toUpperCase()
  if (m.phase === 'intro') return m.t < INTRO - 25 ? { banner: m.wins[0] === FIRST_TO - 1 && m.wins[1] === FIRST_TO - 1 ? 'FINAL ROUND' : `ROUND ${m.round}` } : { banner: 'FIGHT!' }
  if (m.phase === 'over') return { banner: m.last < 0 ? 'DRAW' : m.w.f[1 - m.last].hp <= 0 ? 'K.O.' : 'TIME', sub: m.last < 0 ? undefined : `${name(m.last)} takes the round` }
  if (m.phase === 'done') { const w = matchWinner(m)!; return { banner: w < 0 ? 'DRAW GAME' : `${name(w)} WINS`, sub: 'Enter for a rematch' } }
  return {}
}
