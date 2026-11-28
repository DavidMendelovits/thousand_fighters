// Movement validation: play every move, string and special in the real sim and assert what happened.
// Pure (no DOM, no fs) so the studio runs it live on every edit and cli.ts runs it over the whole roster.
import { MOVES, compile, cmdOf, isSpecial, type FighterDef, type Move } from './kit'
import { newWorld, step, cpu, scriptFor, BIT, L, R, U, D, LP, LK, HK, HP, BL, type World } from './sim'
import { design } from './design'

export type Script = number[] | ((w: World, t: number) => number)
export type Demo = { script: Script; dist: number; foe?: Script; powered?: boolean }
export type Check = { name: string; ok: boolean; detail: string; demo?: Demo }
export type Row = { id: string; name: string; cmd: string; su: number; ac: number; rc: number; dmg: number; lvl: string; onHit: string; onBlock: string; demo?: Demo }

// ponytail: one average-size reference opponent; add small/large references if size matchups start dropping combos
export const REF: FighterDef = { ...design('Sparring Dummy', 7), look: { ...design('Sparring Dummy', 7).look, height: 1, bulk: 1, arms: 1, legs: 1, hat: 'none', cape: false }, stats: { hp: 1000, speed: 1, power: 1, jump: 1 }, strings: [], moves: [] }

export const at = (s: Script, w: World, t: number) => typeof s === 'function' ? s(w, t) : s[t] ?? 0
const FREE = ['idle', 'walk', 'crouch', 'block']
type Shot = { t: number; id: string; x: number; y: number; vy: number; w: number; h: number; wait: number; gates: number; off: number }

function run(a: FighterDef, b: FighterDef, dist: number, p1: Script, p2: Script, ticks: number, powered = false) {
  const w = newWorld(a, b, 1, dist), o = { w, maxCombo: 0, comboDmg: 0, firstHit: -1, blocks: 0, wasDown: false, freeA: -1, freeD: -1, seen: new Set<string>(), moved: 0, buffed: false,
    shots: [] as Shot[], pulledGap: -1 }
  w.f[0].meter = 100
  if (powered) w.f[0].buff = { t: 9999, power: 1, speed: 1, defense: 1, color: '#fff' }
  for (let t = 0; t < ticks; t++) {
    const x0 = w.f[0].x
    step(w, at(p1, w, t), at(p2, w, t))
    for (const e of w.ev) if (e.who === 0) { if (e.type === 'hit' && o.firstHit < 0) o.firstHit = t; if (e.type === 'block') { o.blocks++; if (o.firstHit < 0) o.firstHit = t } }
    o.maxCombo = Math.max(o.maxCombo, w.f[1].combo); o.comboDmg = Math.max(o.comboDmg, w.f[1].comboDmg); o.moved = Math.max(o.moved, Math.abs(w.f[0].x - x0))
    if (w.f[0].mv) o.seen.add(w.f[0].mv.id)
    if (w.f[0].buff && !powered) o.buffed = true
    if (w.f[1].st === 'down') o.wasDown = true
    for (const p of w.proj) if (p.owner === 0) o.shots.push({ t, id: p.id, x: p.x, y: p.y, vy: p.vy, w: p.w, h: p.h, wait: p.wait, gates: p.gates.length, off: (p.x - w.f[0].x) * w.f[0].face })
    if (o.pulledGap < 0 && w.f[1].st === 'hit' && w.f[1].pulled) o.pulledGap = Math.abs(w.f[1].x - w.f[0].x)
    if (o.firstHit >= 0 && t > o.firstHit) { if (o.freeA < 0 && FREE.includes(w.f[0].st)) o.freeA = t; if (o.freeD < 0 && FREE.includes(w.f[1].st)) o.freeD = t }
  }
  return o
}

/** Dial a string: first move on tick 0, each next button as soon as the previous one connects. */
export const stringScript = (s: string[]): Script => (w, tk) => {
  const f = w.f[0], btn = (id: string) => f.moves[id] ? scriptFor(f.moves[id]).at(-1)! : LP // each step with its held direction
  if (tk === 0) return f.moves[s[0]] ? scriptFor(f.moves[s[0]])[0] : 0
  return f.st === 'atk' && f.contact && f.str.length < s.length && tk % 2 ? btn(s[f.str.length]) : 0
}
/** Perform a chain of moves: the first from neutral (or from a jump when it is an air move), each next one on contact. */
function chainScript(path: Move[], jumpTick: number): Script {
  const first = path[0].air ? [U | R, ...new Array(jumpTick).fill(0), ...scriptFor(path[0])] : scriptFor(path[0])
  let cur = -1, pos = 0
  return (w, tk) => {
    if (tk === 0) cur = -1
    if (tk < first.length) return first[tk]
    const f = w.f[0], k = path.findIndex(m => m.id === f.mv?.id)
    if (f.st !== 'atk' || k < 0 || k === path.length - 1 || !f.contact) return 0
    if (cur !== k) { cur = k; pos = 0 }
    const seq = [...scriptFor(path[k + 1]), 0]; return seq[pos++ % seq.length]
  }
}
/** [first, 0 × (k-1), then] — hold `first` for one tick, wait, then press `then` on tick k. */
function t(k: number, first: number, then: number): number[] { const s = new Array(k + 1).fill(0); s[0] = first; s[k] = then; return s }

export function validate(def: FighterDef, ref: FighterDef = REF): { ok: boolean; checks: Check[]; rows: Row[] } {
  const checks: Check[] = [], rows: Row[] = [], C = compile(def)
  const add = (name: string, bad: string[], good = 'ok', demo?: Demo) => checks.push({ name, ok: !bad.length, detail: bad.length ? bad.join('; ') : good, demo })
  const touch = 22 * (def.look.height + ref.look.height) + 2, full = ref.stats.hp
  const adv = (r: ReturnType<typeof run>) => r.firstHit < 0 ? '—' : r.wasDown ? 'KD' : (r.freeD - r.freeA >= 0 ? '+' : '') + (r.freeD - r.freeA)
  const row = (m: Move, onHit: string, onBlock: string, demo?: Demo) => rows.push({ id: m.id, name: m.name, cmd: cmdOf(m, C.moves), su: m.su, ac: m.ac > 90 ? 0 : m.ac, rc: m.rc, dmg: Math.round((m.dmg || Math.max(0, ...(m.proj ?? []).map(p => p.dmg))) * def.stats.power), lvl: m.grab ? 'grab' : m.lvl, onHit, onBlock, demo })

  if (C.problems.length) add('Definition is well-formed', C.problems)

  // 1+2. every universal ground normal connects point-blank, on the tick its frame data says, and guard rules hold
  const reach: string[] = [], guard: string[] = []
  const normals = Object.keys(MOVES).map(id => C.moves[id]).filter(m => !m.air && !m.grab)
  for (const m of normals) {
    const inp = scriptFor(m), hit = run(def, ref, touch, inp, [], 140)
    if (hit.w.f[1].hp >= full) reach.push(`${m.name} whiffs at close range`)
    else if (hit.firstHit !== m.su) reach.push(`${m.name} hit on tick ${hit.firstHit}, frame data says ${m.su}`)
    const stand = run(def, ref, touch, inp, () => BL, 140), duck = run(def, ref, touch, inp, () => BL | D, 140)
    if ((stand.w.f[1].hp < full) !== (m.lvl === 'low')) guard.push(`${m.name} vs standing block`)
    if ((duck.w.f[1].hp < full) !== (m.lvl === 'oh')) guard.push(`${m.name} vs crouching block`)
    row(m, adv(hit), adv(m.lvl === 'low' ? duck : stand), { script: inp, dist: touch })
  }
  add('Ground normals connect on their startup frame', reach, `${normals.length} moves`)
  add('Lows, overheads and mids respect blocking', guard)

  // 3. jump attacks: some jump-in timing must land
  const air: string[] = []
  for (const id of ['jp', 'jk']) {
    const m = C.moves[id]; let demo: Demo | undefined
    for (const dist of [120, 160, 200]) for (let k = 12; k <= 32 && !demo; k += 2) { const s = t(k, U | R, BIT[m.btn!]); if (run(def, ref, dist, s, [], 70).w.f[1].hp < full) demo = { script: s, dist } }
    if (!demo) air.push(`${m.name} never lands from a forward jump`)
    row(m, '', '', demo)
  }
  add('Jump attacks land', air)
  row(C.moves.throw, 'KD', '', { script: [LP | LK], dist: touch })

  // 4. every dial string is a true combo: the defender never recovers between hits
  for (const s of def.strings) {
    if (s.some(id => !C.moves[id])) continue
    const demo = { script: stringScript(s), dist: touch }, r = run(def, ref, touch, demo.script, [], 260)
    const label = s.map(id => id in BIT ? id.toUpperCase() : C.moves[id].name).join(' › ')
    const bad = r.maxCombo < s.length ? [`drops after hit ${r.maxCombo} of ${s.length}`] : r.comboDmg > 450 ? [`${r.comboDmg} damage is over the 450 cap`] : []
    add(`String ${label}`, bad, `${r.maxCombo} hits, ${r.comboDmg} dmg`, demo)
  }

  // 4b. a directional string step needs its direction: L > b+L > H must not dial as L > L > H
  for (const s of def.strings) {
    const dirStep = s.map(id => C.moves[id]).find(m => m?.dir)
    if (!dirStep || s.some(id => !C.moves[id])) continue
    const plain: Script = (w, tk) => { const f = w.f[0]; if (tk === 0) return BIT[C.moves[s[0]].btn ?? 'lp']; return f.st === 'atk' && f.contact && f.str.length < s.length && tk % 2 ? BIT[C.moves[s[f.str.length]].btn ?? 'lp'] : 0 }
    const r = run(def, ref, touch, plain, [], 260)
    add(`String ${s.join(' ')} needs its direction`, r.seen.has(dirStep.id) ? [`${dirStep.name} came out without holding ${dirStep.dir}`] : [])
  }

  // 4c. walking is not a motion: after a long walk, a command normal comes out as itself, not as a special
  const walked: string[] = []
  for (const m of Object.values(C.moves)) {
    if (!m.dir || !m.btn || m.motion || m.air || m.from || m.stringOnly || m.cost || m.needs || m.chord) continue
    for (const [walk, label] of [[R, 'forward'], [L, 'back']] as const) for (const gap of [0, 3]) {
      const script = [...new Array(20).fill(walk), ...new Array(gap).fill(0), scriptFor(m)[0]], r = run(def, ref, 300, script, [], 20 + gap + 6)
      const first = [...r.seen][0]
      if (first !== m.id) { walked.push(`walking ${label} then ${cmdOf(m, C.moves)} gave ${first ? C.moves[first].name : 'nothing'}, not ${m.name}`); break }
    }
  }
  add('Command normals come out after walking', [...new Set(walked)])

  // 4e. a motion rolled through its diagonals (↓ ↘ →, as a stick or thumb does) comes out as itself, even with full
  // meter: a diagonal must not count twice and turn a quarter circle into a double quarter circle super
  const rolled: string[] = []
  for (const m of Object.values(C.moves)) {
    if (!m.motion || !m.btn || m.air || m.from || m.stringOnly || m.needs) continue
    const bit = (d: string) => d === 'd' ? D : d === 'u' ? U : d === 'f' ? R : L
    const dirs = m.motion.map(bit), script: number[] = []
    dirs.forEach((b, i) => { script.push(b, b); const nx = dirs[i + 1]; if (nx && (b | nx) !== (L | R) && (b | nx) !== (U | D)) script.push(b | nx, b | nx) })
    script.push(dirs[dirs.length - 1] | BIT[m.btn] | (m.chord ? BIT[m.chord] : 0))
    const first = [...run(def, ref, 300, script, [], script.length + 6).seen][0]
    if (first !== m.id) rolled.push(`${cmdOf(m, C.moves)} rolled through diagonals gave ${first ? C.moves[first].name : 'nothing'}, not ${m.name}`)
  }
  add('Motions rolled through diagonals come out as themselves', rolled)

  // 4d. a grounded normal cancels into a special on contact
  const specials = Object.values(C.moves).filter(m => isSpecial(m) && m.btn && !m.air && !m.from && !m.stringOnly && !m.cost && !m.needs)
  if (specials.length) {
    const ok = specials.some(sp => run(def, ref, touch, chainScript([C.moves.lp, sp], 0), [], 160).seen.has(sp.id))
    add('Jab cancels into a special on contact', ok ? [] : ['no special comes out of a connecting jab'])
  }

  // 5. uppercut launches and can be juggled
  const jug = run(def, ref, touch, (w, tk) => {
    const f = w.f[0], o = w.f[1]
    if (tk === 0) return D | HP
    if (o.st !== 'launch' || !FREE.includes(f.st)) return 0
    return Math.abs(o.x - f.x) > 70 * def.look.height ? R : tk % 2 ? LP : 0
  }, [], 160)
  add('Uppercut launches into a juggle', jug.maxCombo >= 2 ? [] : ['no follow-up connects after the launch'], `${jug.maxCombo} hits, ${jug.comboDmg} dmg`)

  // 5b. uppercut jump-cancels into an air combo: hold up on contact, then jump punch › jump kick
  let air3: ReturnType<typeof run> | undefined, airDemo: Demo | undefined
  for (const delay of [0, 2, 4, 6, 8, 10, 12]) {
    let fired = -1
    const script: Script = (w, tk) => {
      const f = w.f[0]
      if (tk === 0) { fired = -1; return D | HP }
      if (f.st === 'atk' && f.mv?.id === 'upper') return f.contact ? U | R : D
      if (f.st === 'air' && fired < 0) fired = tk + delay
      if (f.st === 'air' && tk === fired) return LP
      return f.st === 'atk' && f.mv?.id === 'jp' && f.contact && tk % 2 ? LK : 0
    }
    const r = run(def, ref, touch, script, [], 220)
    if (!air3 || r.maxCombo > air3.maxCombo) { air3 = r; airDemo = { script, dist: touch } }
    if (r.maxCombo >= 3) break
  }
  add('Uppercut jump-cancels into an air combo', air3!.maxCombo >= 3 ? [] : [`air combo stops at ${air3!.maxCombo} hits`], `${air3!.maxCombo} hits, ${air3!.comboDmg} dmg`, airDemo)

  // 5c. links run dry: mashing jab point-blank can't loop forever (hitstun shrinks as the combo grows)
  const mash = run(def, ref, touch, (_w, tk) => tk % 2 ? LP : 0, [], 240)
  add('Jab mash runs dry', mash.maxCombo <= 6 ? [] : [`${mash.maxCombo} jabs in a row`], `${mash.maxCombo} hits`)

  // 5b. the up direction: up + button from the ground is an up attack (pressed together or during the jump squat), up alone jumps
  const upBad: string[] = []
  for (const m of Object.values(C.moves).filter(m => m.dir === 'u' && !m.air && m.btn && !m.from && !m.stringOnly)) {
    const b = BIT[m.btn!]
    for (const [label, script] of [['together', [U | b, U, U]], ['during the squat', [U, U | b, U]]] as const) {
      const r = run(def, ref, touch, [...script], [], 120)
      if (!r.seen.has(m.id)) upBad.push(`${m.name} doesn't come out (${label})`)
      else if (r.w.f[1].hp >= full) upBad.push(`${m.name} whiffs point-blank (${label})`)
    }
  }
  const hop = run(def, ref, touch, [U], [], 40)
  if (!hop.w.f[0].y && hop.w.f[0].st !== 'air') upBad.push('tapping up does not jump')
  add('Up attacks come out of the jump squat', upBad)

  // 5c. charged heavies: holding the button through the windup hits harder than a tap
  const chg: string[] = []
  for (const m of Object.values(C.moves).filter(m => m.charge && m.btn && !m.air && !m.from && !m.stringOnly)) {
    const tap = scriptFor(m), held = [...tap, ...new Array(m.su + m.charge!.max).fill(tap.at(-1)!)]
    const a = run(def, ref, touch, tap, [], 200), z = run(def, ref, touch, held, [], 260)
    const dA = full - a.w.f[1].hp, dZ = full - z.w.f[1].hp
    if (!dA || !dZ) chg.push(`${m.name} whiffs ${dA ? 'charged' : 'tapped'}`)
    else if (dZ < dA * 1.3) chg.push(`${m.name} charged does ${dZ}, tapped ${dA}`)
  }
  add('Charged heavies hit harder', chg)

  // 5d. up throw tosses straight up into a free juggle hit
  const toss = run(def, ref, touch, (w, tk) => {
    const f = w.f[0], o = w.f[1]
    if (tk < 4) return U | (tk === 0 ? LP | LK : 0)
    return o.st === 'launch' && FREE.includes(f.st) && o.y < 130 && tk % 2 ? LP : 0
  }, () => BL, 200)
  add('Up throw leads to a juggle', toss.maxCombo >= 2 ? [] : [`${toss.maxCombo} hit after the up throw`], `${toss.maxCombo} hits, ${toss.comboDmg} dmg`)

  // 5e. air directions: the spike lands on a jump-in, the air launcher catches a jumping opponent
  const airDir: string[] = []
  for (const id of ['jdp', 'jup']) {
    const m = C.moves[id]; if (!m) continue
    const foe: Script = id === 'jup' ? (_w, tk) => tk === 10 ? U : 0 : []
    let demo: Demo | undefined
    for (const dist of [120, 160, 200]) for (let k = 4; k <= 34 && !demo; k += 2) {
      const s = t(k, U | R, scriptFor(m)[0]); s.push(...new Array(6).fill(scriptFor(m)[0] & (U | D)))
      const r = run(def, ref, dist, s, foe, 90)
      if (r.seen.has(m.id) && r.w.f[1].hp < full) demo = { script: s, dist, foe }
    }
    if (!demo) airDir.push(`${m.name} never lands`)
    row(m, '', '', demo)
  }
  add('Air directional attacks land', airDir)

  // 6. knockdowns and throws resolve: nobody is left stuck
  const flow: string[] = []
  const sweep = run(def, ref, touch, [D | HK], [], 220)
  if (!sweep.wasDown) flow.push('sweep does not knock down')
  if (!FREE.includes(sweep.w.f[1].st) || !FREE.includes(sweep.w.f[0].st)) flow.push('fighters stuck after a knockdown')
  for (const [label, script] of [['throw', [LP | LK]], ['throw (LP then LK)', [LP, LP | LK]]] as const) {
    const th = run(def, ref, touch, [...script], () => BL, 220)
    if (th.w.f[1].hp >= full) flow.push(`${label} fails on a blocking opponent`)
    if (!FREE.includes(th.w.f[1].st) || !FREE.includes(th.w.f[0].st)) flow.push(`fighters stuck after ${label}`)
  }
  if (run(def, ref, touch, t(8, 0, LP | LK), [U], 120).w.f[1].hp < full) flow.push('throw grabs an airborne opponent')
  add('Knockdown, getup and throw resolve', flow)

  // 7. every move the fighter owns can be performed, does what its data says, and ends
  const found = new Map<string, { r: ReturnType<typeof run>; demo: Demo; path: Move[] }>()
  for (const m of def.moves) {
    const cm = C.moves[m.id]
    if (!cm.btn || cm.stringOnly) { row(cm, '', ''); continue } // string-only: covered by its string's check
    const path = [cm]
    while (path[0].from?.length && C.moves[path[0].from[0]] && path.length < 8) path.unshift(C.moves[path[0].from[0]])
    if (!path[0].btn) { add(`Move: ${cm.name}`, ['its chain starts from a move with no input']); continue }
    const hurts = !!cm.limb || !!cm.grab || !!cm.counter || !!cm.proj?.some(p => p.dmg > 0), bad = new Set<string>(), powered = path.some(p => p.needs === 'buff')
    // grabs must beat a block; air grabs need a jumping target; everything else is tried on a standing one
    const foe: Script = cm.counter ? (_w, tk) => tk % 14 === 3 ? LP : 0 : cm.grab?.air ? (_w, tk) => tk < 2 ? U : 0 : cm.grab || cm.unblockable || cm.proj?.some(p => p.unblockable) ? () => BL : []
    let best: ReturnType<typeof run> | undefined, demo: Demo | undefined
    search: for (const dist of [touch, 90, 130, 180, 240, 320, 420]) for (const jt of path[0].air ? [8, 12, 16, 20, 24, 28] : [0]) {
      const script = chainScript(path, jt), r = run(def, ref, dist, script, foe, 300, powered)
      const did = r.seen.has(cm.id), landed = r.w.f[1].hp < full, ends = FREE.includes(r.w.f[0].st), works = (!hurts || landed) && (!cm.buff || r.buffed)
      if (did && ends && works) { best = r; demo = { script, dist, foe, powered }; break search }
      if (!did) bad.add('could not be performed'); else if (!ends) bad.add('attacker never recovers'); else bad.add(cm.buff && !r.buffed ? 'power-up never activates' : 'never connects at any range')
    }
    add(`Move: ${cm.name} (${cmdOf(cm, C.moves)})`, best ? [] : [[...bad].pop()!], best && hurts ? `${best.comboDmg} dmg` : 'ok', demo)
    if (best && demo) found.set(cm.id, { r: best, demo, path })
    row(cm, best && hurts ? adv(best) : '', '', demo)
  }

  // 7b. projectiles do what their spec says: from above falls, from behind beats a block, a portal moves it, a pull drags
  for (const m of def.moves) {
    const cm = C.moves[m.id], got = found.get(m.id)
    for (const p of cm.proj ?? []) {
      const from = p.from ?? (p.aim ? 'target' : 'hand'), kinds = [from !== 'hand' && from !== 'target' && from, p.warn && 'warning', p.portal && 'portal', p.grow && 'growth', p.anchor && 'beam', p.pull && 'pull'].filter(Boolean)
      if (!kinds.length || !got || !p.dmg) continue
      // judged at the range the move check found and further out: point-blank, a shot can hit the tick it appears
      const label = `Projectile: ${cm.name} (${kinds.join(', ')})`
      let verdict: string[] | undefined, shown: Demo | undefined
      for (const dist of [got.demo.dist, 180, 260, 340, 420]) {
        const demo = { ...got.demo, dist }, r = run(def, ref, dist, demo.script, demo.foe ?? [], 300, demo.powered)
        const mine = r.shots.filter(q => q.id === cm.id), live = mine.filter(q => q.wait <= 0), first = live[0], bad: string[] = []
        if (!first) continue
        if (r.w.f[1].hp >= full) bad.push('never connects')
        if (from === 'above' && !(first.y > 200 && first.vy < 0)) bad.push(`starts at height ${Math.round(first.y)}, not falling from above`)
        if (from === 'below' && !(first.y < 40 && first.vy > 0)) bad.push(`starts at height ${Math.round(first.y)}, not rising from the floor`)
        if (from === 'behind' && !p.unblockable && run(def, ref, dist, demo.script, () => BL, 300, demo.powered).w.f[1].hp >= full) bad.push('a blocking opponent stops it, so it is not coming from behind')
        if (p.warn && (mine.filter(q => q.wait > 0).length < p.warn - 1 || (r.firstHit >= 0 && r.firstHit < mine[0].t + p.warn))) bad.push(`hits before its ${p.warn}-tick warning ends`)
        const through = mine.find(q => q.gates >= 2)
        if (p.portal && !through) bad.push('never goes through its portal')
        if (p.portal && through && r.firstHit >= 0 && r.firstHit < through.t) bad.push('hits before it reaches the portal')
        if (p.grow && !live.some(q => q.w > first.w + 1 || q.h > first.h + 1)) bad.push('never grows')
        if (p.anchor && live.some(q => Math.abs(q.off - first.off) > 1)) bad.push('drifts away from the thrower')
        if (p.pull && !(r.pulledGap >= 0 && r.pulledGap < 140 * def.look.height)) bad.push(r.pulledGap < 0 ? 'never drags the opponent in' : `leaves them ${Math.round(r.pulledGap)}px away`)
        verdict ??= bad; shown ??= demo
        if (!bad.length) { verdict = bad; shown = demo; break }
      }
      add(label, verdict ?? ['never appeared'], 'does what it says', shown)
    }
  }

  // 8. a full CPU match ends, stays finite, and replays identically
  const match = (seed: number) => {
    const w = newWorld(def, { ...ref, moves: def.moves, poses: def.poses, strings: def.strings }, seed)
    for (let i = 0; i < 6600 && !(w.over && w.f.every(f => ['idle', 'win', 'ko', 'crouch', 'walk', 'block'].includes(f.st))); i++) step(w, cpu(w, 0), cpu(w, 1))
    return w
  }
  const m1 = match(3), m2 = match(3), sig = (w: World) => `${w.tick}:${w.f.map(f => `${f.hp},${f.x.toFixed(3)}`)}`
  const bad8: string[] = []
  if (!m1.over) bad8.push('match never ended')
  if (m1.f.some(f => !Number.isFinite(f.x + f.y + f.hp))) bad8.push('non-finite state')
  if (sig(m1) !== sig(m2)) bad8.push('same seed produced a different match')
  add('CPU match ends and replays deterministically', bad8, m1.over ? `${(m1.tick / 60).toFixed(0)}s` : '')

  return { ok: checks.every(c => c.ok), checks, rows }
}
