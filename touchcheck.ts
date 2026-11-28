// npx tsx touchcheck.ts   drive touch.ts with scripted fingers (several at once) in jsdom, feed poll() into the
// real sim each tick, and check that the moves a phone player means are the moves that come out.
// No browser needed, so it runs anywhere `npm run check` runs. It cannot see layout or real touch hardware.
import { JSDOM } from 'jsdom'
import { readFileSync } from 'node:fs'

const dom = new JSDOM('<!doctype html><body><div id="deck"></div></body>')
const win = dom.window as any
class PE extends win.MouseEvent { pointerId: number; constructor(t: string, o: any = {}) { super(t, o); this.pointerId = o.pointerId ?? 1 } }
win.PointerEvent = PE
win.Element.prototype.setPointerCapture = function () {}
for (const k of ['window', 'document', 'HTMLElement', 'HTMLButtonElement', 'PointerEvent']) (globalThis as any)[k] = k === 'window' ? win : win[k]
;(globalThis as any).matchMedia = () => ({ matches: true })
let clock = 0
Object.defineProperty(globalThis, 'performance', { value: { now: () => clock }, configurable: true })

const { touchPad } = await import('./touch')
const { newWorld, step } = await import('./sim')
const { REF } = await import('./validate')
const faro = JSON.parse(readFileSync(new URL('./fighters/faro.json', import.meta.url), 'utf8'))

const TICK = 1000 / 60
type Act = (t: number) => void
function run(name: string, script: Record<number, Act[]>, ticks: number, opts: { meter?: number; dist?: number; expect: (log: string[], w: any, trace: any) => string | null }) {
  document.body.innerHTML = '<div id="deck"></div>'
  const pad = touchPad(document.getElementById('deck')!)
  const stick = pad.el.querySelector('.tstick')!, punch = pad.el.querySelector('.tpunch')!, kick = pad.el.querySelector('.tkick')!, block = pad.el.querySelector('.tblock')!
  const els: any = { stick, punch, kick, block }
  ;(globalThis as any).__els = els
  const w = newWorld(faro, REF, 1, opts.dist ?? 260); w.f[0].meter = opts.meter ?? 100
  const log: string[] = [], trace = { x0: w.f[0].x, maxY: 0, states: new Set<string>(), bits: [] as number[] }
  let last: any = null, lastT = 0; (trace as any).foe = new Set<string>()
  clock = 0
  for (let t = 0; t < ticks; t++) {
    for (const a of script[t] ?? []) a(t)
    const b = pad.poll(); trace.bits.push(b)
    step(w, b, 0)
    const f = w.f[0]
    if (f.mv && f.st === 'atk' && (f.mv !== last || f.t < lastT)) log.push(f.mv.name)
    last = f.mv; lastT = f.t; (trace as any).foe.add(w.f[1].st)
    trace.maxY = Math.max(trace.maxY, f.y); trace.states.add(f.st)
    clock += TICK
  }
  const err = opts.expect(log, w, trace)
  console.log(`${err ? '✘' : '✔'} ${name}: ${err ?? 'ok'}  [moves: ${log.join(' › ') || 'none'}]`)
  pad.destroy()
  return !err
}
const ev = (el: string, type: string, x: number, y: number, id: number) => () => (globalThis as any).__els[el].dispatchEvent(new PE(type, { clientX: x, clientY: y, pointerId: id, bubbles: true, cancelable: true }))
const down = (el: string, x = 100, y = 100, id = 1) => ev(el, 'pointerdown', x, y, id)
const move = (el: string, x: number, y: number, id = 1) => ev(el, 'pointermove', x, y, id)
const up = (el: string, x = 100, y = 100, id = 1) => ev(el, 'pointerup', x, y, id)
// stick helpers: thumb at (100,100); R=(160,100) D=(100,160) DR=(142,142) L=(40,100) U=(100,40)
const P = { R: [160, 100], D: [100, 160], DR: [142, 142], L: [40, 100], U: [100, 40], DL: [58, 142] } as Record<string, number[]>
const stickTo = (d: string) => move('stick', P[d][0], P[d][1], 1)
const S: Record<number, Act[]> = {}
const at = (s: Record<number, Act[]>, t: number, ...a: Act[]) => { (s[t] ??= []).push(...a); return s }
const tap = (s: Record<number, Act[]>, t: number, btn: string, id = 2) => at(at(s, t, down(btn, 300, 300, id)), t + 1, up(btn, 300, 300, id))
const flick = (s: Record<number, Act[]>, t: number, btn: string, id = 2, hold = 1) => at(at(at(s, t, down(btn, 300, 300, id)), t + 1, move(btn, 300, 270, id)), t + 1 + hold, up(btn, 300, 270, id))
let pass = 0, total = 0
const T = (...a: Parameters<typeof run>) => { total++; if (run(...a)) pass++ }

// 1 walk forward: hold stick right 40 ticks
{ const s: any = {}; at(s, 0, down('stick')); at(s, 1, stickTo('R')); at(s, 41, up('stick'))
  T('stick right walks forward', s, 50, { expect: (l, w, tr) => w.f[0].x > tr.x0 + 20 ? null : `moved ${(w.f[0].x - tr.x0).toFixed(0)}px` }) }
// 2 walk back
{ const s: any = {}; at(s, 0, down('stick')); at(s, 1, stickTo('L')); at(s, 41, up('stick'))
  T('stick left walks back', s, 50, { expect: (l, w, tr) => w.f[0].x < tr.x0 - 20 ? null : `moved ${(w.f[0].x - tr.x0).toFixed(0)}px` }) }
// 3 jump
{ const s: any = {}; at(s, 0, down('stick')); at(s, 1, stickTo('U')); at(s, 4, up('stick'))
  T('stick up jumps', s, 40, { expect: (l, w, tr) => tr.maxY > 30 ? null : `max height ${tr.maxY.toFixed(0)}` }) }
// 4 crouch
{ const s: any = {}; at(s, 0, down('stick')); at(s, 1, stickTo('D'))
  T('stick down crouches', s, 10, { expect: (l, w) => w.f[0].st === 'crouch' || w.f[0].cr ? null : `state ${w.f[0].st}` }) }
// 5 tap punch -> light punch
{ const s: any = {}; tap(s, 2, 'punch')
  T('tap Punch = light punch', s, 30, { expect: l => l.length === 1 ? null : 'expected one move' }) }
// 6 flick punch -> heavy punch (different move than light)
let lightName = '', heavyName = ''
{ const s: any = {}; tap(s, 2, 'punch'); run('(record light)', s, 30, { expect: l => { lightName = l[0]; return null } }) }
{ const s: any = {}; flick(s, 2, 'punch'); T('flick Punch = heavy punch', s, 40, { expect: l => { heavyName = l[0]; return l.length && l[0] !== lightName ? null : `got ${l[0]}, light is ${lightName}` } }) }
// 7 hold punch still past DECIDE -> light (not nothing)
{ const s: any = {}; at(s, 2, down('punch', 300, 300, 2)); at(s, 20, up('punch', 300, 300, 2))
  T('press and hold Punch still = light', s, 40, { expect: l => l[0] === lightName ? null : `got ${l[0]}` }) }
// 8 Punch + Kick together = grab (two fingers)
{ const s: any = {}; at(s, 2, down('punch', 300, 300, 2), down('kick', 360, 260, 3)); at(s, 4, up('punch', 300, 300, 2), up('kick', 360, 260, 3))
  T('Punch + Kick together = grab', s, 60, { dist: 0, expect: (l, w, tr) => tr.foe.has('thrown') ? null : `got ${l.join(',') || 'nothing'}, foe states ${[...tr.foe].join(',')}` }) }
// 9 stick held forward + tap Kick = Shove Off (→ + LK), two fingers at once
{ const s: any = {}; at(s, 0, down('stick')); at(s, 1, stickTo('R')); tap(s, 14, 'kick')
  T('hold → + tap Kick = Shove Off', s, 40, { expect: l => l.includes('Shove Off') ? null : `got ${l.join(',')}` }) }
// 10 stick back + tap Punch = Tend the Flame
{ const s: any = {}; at(s, 0, down('stick')); at(s, 1, stickTo('L')); tap(s, 6, 'punch')
  T('hold ← + tap Punch = Tend the Flame', s, 40, { expect: l => l.includes('Tend the Flame') ? null : `got ${l.join(',')}` }) }
// 11 quarter circle ↓ ↘ → + tap Punch = Beacon (thumb rolls, then second finger taps)
{ const s: any = {}; at(s, 0, down('stick')); at(s, 1, stickTo('D')); at(s, 4, stickTo('DR')); at(s, 7, stickTo('R')); tap(s, 9, 'punch'); at(s, 12, up('stick'))
  T('↓ ↘ → + tap Punch = Beacon', s, 50, { expect: l => l[0] === 'Beacon' ? null : `got ${l.join(',')}` }) }
// 12 quarter circle + flick Punch = Signal Flare
{ const s: any = {}; at(s, 0, down('stick')); at(s, 1, stickTo('D')); at(s, 4, stickTo('DR')); at(s, 7, stickTo('R')); flick(s, 8, 'punch'); at(s, 12, up('stick'))
  T('↓ ↘ → + flick Punch = Signal Flare', s, 50, { expect: l => l[0] === 'Signal Flare' ? null : `got ${l.join(',')}` }) }
// 13 ↓ ↙ ← + tap Punch = Sea Mine
{ const s: any = {}; at(s, 0, down('stick')); at(s, 1, stickTo('D')); at(s, 4, stickTo('DL')); at(s, 7, stickTo('L')); tap(s, 9, 'punch'); at(s, 12, up('stick'))
  T('↓ ↙ ← + tap Punch = Sea Mine', s, 50, { expect: l => l[0] === 'Sea Mine' ? null : `got ${l.join(',')}` }) }
// 14 ← → + tap Kick = Lamp Swing, then Kick = Backswing, flick Kick = Last Bell
{ const s: any = {}; at(s, 0, down('stick')); at(s, 1, stickTo('L')); at(s, 5, stickTo('R')); tap(s, 8, 'kick'); at(s, 10, up('stick')); tap(s, 24, 'kick'); flick(s, 40, 'kick')
  T('← → Kick, Kick, flick Kick = Lamp Swing string', s, 90, { dist: 120, expect: l => l.join('>') === 'Lamp Swing>Backswing>Last Bell' ? null : `got ${l.join(' > ')}` }) }
// 15 combo LP > LP > HP by taps
{ const s: any = {}; tap(s, 2, 'punch'); tap(s, 12, 'punch'); flick(s, 22, 'punch')
  T('tap, tap, flick Punch = LP › LP › HP string', s, 70, { dist: 100, expect: (l, w) => l.length >= 3 && w.f[1].combo >= 3 ? null : `got ${l.join(' > ')}, foe hits ${w.f[1].combo}` }) }
// 16 super ↓ → ↓ → + flick Punch = Wreckers' Light (full meter)
{ const s: any = {}; at(s, 0, down('stick')); at(s, 1, stickTo('D')); at(s, 4, stickTo('R')); at(s, 7, stickTo('D')); at(s, 10, stickTo('R')); flick(s, 12, 'punch'); at(s, 16, up('stick'))
  T("↓ → ↓ → + flick Punch = Wreckers' Light", s, 60, { expect: l => l[0] === "Wreckers' Light" ? null : `got ${l.join(',')}` }) }
// 17 block held -> BL bit reaches the sim
{ const s: any = {}; at(s, 2, down('block', 300, 400, 4)); at(s, 20, up('block', 300, 400, 4))
  T('hold Block sends block', s, 25, { expect: (l, w, tr) => tr.bits.slice(3, 19).every((b: number) => b & 256) && !(tr.bits[22] & 256) ? null : 'block bit wrong' }) }
// 18 stick reversal: slide from right to left without lifting
{ const s: any = {}; at(s, 0, down('stick')); at(s, 1, stickTo('R')); at(s, 20, move('stick', 0, 100)); at(s, 21, move('stick', -40, 100))
  T('slide right then left reverses', s, 45, { expect: (l, w, tr) => (tr.bits[30] & 1) && !(tr.bits[30] & 2) ? null : `bits at 30: ${tr.bits[30]}` }) }
// 19 dash: two quick flicks right
{ const s: any = {}; at(s, 0, down('stick')); at(s, 1, stickTo('R')); at(s, 3, up('stick', 160, 100)); at(s, 5, down('stick')); at(s, 6, stickTo('R')); at(s, 9, up('stick', 160, 100))
  T('two quick flicks right = dash', s, 30, { expect: (l, w, tr) => tr.states.has('dash') ? null : `states ${[...tr.states].join(',')}` }) }
// 20 a second finger on the stick area while the stick is held does not hijack it
{ const s: any = {}; at(s, 0, down('stick')); at(s, 1, stickTo('R')); at(s, 5, ev('stick', 'pointerdown', 50, 50, 9)); at(s, 6, ev('stick', 'pointermove', 0, 50, 9))
  T('second finger on stick is ignored', s, 15, { expect: (l, w, tr) => tr.bits[10] & 2 ? null : `bits ${tr.bits[10]}` }) }
// 21 releasing the stick while Punch is held does not drop the punch
{ const s: any = {}; at(s, 0, down('stick')); at(s, 1, stickTo('R')); at(s, 5, down('punch', 300, 300, 2)); at(s, 6, up('stick', 160, 100)); at(s, 7, move('punch', 300, 270, 2)); at(s, 9, up('punch', 300, 270, 2))
  T('flick Punch while letting go of stick', s, 30, { expect: l => l.length ? null : 'no move' }) }
// 22 charged heavy: flick and hold Kick
{ const s: any = {}; flick(s, 2, 'kick', 2, 50)
  T('flick and hold Kick charges', s, 90, { expect: (l, w, tr) => l.length ? null : 'no move' }) }

console.log(`\n${pass}/${total} touch scenarios pass`)
process.exit(pass === total ? 0 : 1)
