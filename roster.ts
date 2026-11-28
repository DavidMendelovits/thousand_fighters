// The roster page: every fighter at a glance, phone first. Tap one for its stats, moves and combos,
// each playable in a small arena against the validator's sparring dummy, or with no one to hit. Read-only.
// "Try it" hands the fighter to you: touch controls on a phone, WASD + U I J K (Space blocks) on a keyboard.
import { POSES, compile, fk, type FighterDef } from './kit'
import { newWorld, step, STAGE, L, R, U, D, LP, HP, LK, HK, BL, type World } from './sim'
import { draw, drawRig, newFx, fxTick, CELL, COLS, AX, AY, type Fx } from './render'
import { spriteLook } from './sprite'
import { validate, at, REF, type Demo } from './validate'
import { loadFighters, sheetUrl } from './data'
import { touchPad, TOUCH_CSS, type TouchPad } from './touch'

const $ = <T extends HTMLElement = HTMLElement>(s: string) => document.querySelector<T>(s)!
const esc = (s: string) => s.replace(/[&<>"]/g, c => `&#${c.charCodeAt(0)};`)

let roster: FighterDef[] = []
const sheets = new Map<string, HTMLImageElement>(), loading = new Map<string, Promise<HTMLImageElement | undefined>>()
const cards = new Map<string, HTMLButtonElement>()

function sheet(d: FighterDef): Promise<HTMLImageElement | undefined> {
  if (!d.atlas) return Promise.resolve(undefined)
  if (!loading.has(d.id)) loading.set(d.id, new Promise(res => {
    const img = new Image(); img.decoding = 'async'
    img.onload = () => { sheets.set(d.id, img); res(img) }; img.onerror = () => res(undefined)
    img.src = sheetUrl(d.id)
  }))
  return loading.get(d.id)!
}

// ---- roster grid ------------------------------------------------------------
const ownMoves = (d: FighterDef) => (d.moves ?? []).filter(m => m.btn && !m.stringOnly).length

/** Idle pose filling a 5:6 canvas, painted sprite when there is one. Sized to the canvas's real pixels. */
function paintThumb(cv: HTMLCanvasElement, d: FighterDef, img?: HTMLImageElement) {
  const w = Math.round(cv.clientWidth * devicePixelRatio) || 200, h = Math.round(w * 1.2)
  cv.width = w; cv.height = h
  const c = cv.getContext('2d')!, j = fk(POSES.idle0, d.look)
  const top = j.head[1] + j.HR * (d.look.hat === 'wizard' ? 3 : 2) // rig units above the floor
  const s = Math.min(w * 0.0046, (h * 0.86) / top), gy = h * 0.93
  c.clearRect(0, 0, w, h)
  if (img) c.drawImage(img, 0, 0, CELL, CELL, w * 0.46 - AX * s, gy - AY * s, CELL * s, CELL * s) // idle0 is cell 0
  else { c.save(); c.translate(w * 0.46, gy); c.scale(s, s); drawRig(c, POSES.idle0, d.look, 0, 0, 1); c.restore() }
}

const seen = new IntersectionObserver(entries => {
  for (const e of entries) {
    if (!e.isIntersecting) continue
    seen.unobserve(e.target)
    const card = e.target as HTMLButtonElement, d = roster.find(x => x.id === card.dataset.id)!, cv = card.querySelector('canvas')!
    paintThumb(cv, d)
    if (d.atlas) sheet(d).then(img => img && paintThumb(cv, d, img))
  }
}, { rootMargin: '200px' })

function card(d: FighterDef) {
  let el = cards.get(d.id)
  if (el) return el
  el = document.createElement('button'); el.className = 'card'; el.dataset.id = d.id
  const n = ownMoves(d), s = d.strings.length
  el.innerHTML = `<canvas aria-hidden="true"></canvas><span class="nm">${esc(d.name)}</span>`
    + `<span class="meta">${d.atlas ? '<span class="tag">Painted</span> ' : ''}${n} move${n === 1 ? '' : 's'} · ${s} combo${s === 1 ? '' : 's'}</span>`
  el.setAttribute('aria-label', `${d.name}: ${n} moves, ${s} combos`)
  el.onclick = () => { location.hash = '#/' + d.id }
  cards.set(d.id, el); seen.observe(el)
  return el
}

function renderGrid() {
  const q = $<HTMLInputElement>('#search').value.trim().toLowerCase()
  const shown = roster.filter(d => !q || (d.name + ' ' + d.bio).toLowerCase().includes(q))
  $('#grid').replaceChildren(...shown.map(card))
  const n = `${roster.length} fighter${roster.length === 1 ? '' : 's'}`
  $('#count').textContent = q ? `${shown.length} of ${n}` : n
  $('#empty').hidden = shown.length > 0
  $('#empty').textContent = `No fighter matches “${q}”.`
}

// ---- detail -----------------------------------------------------------------
type Clip = { label: string; cmd: string; demo: Demo }
let cur: FighterDef | null = null, w: World, fx: Fx, clips: Clip[] = [], clip = -1, demoT = 0, raf = 0, auto = true
const ctx = $<HTMLCanvasElement>('#arena').getContext('2d')!

// Three ways to watch a move. Dummy: performed on the training dummy, the validator's reference opponent dressed as
// a dummy (same size and stats, so it plays exactly as the checks do). Alone: no opponent; the dummy is moved to the
// far edge, made untouchable and not drawn, so a move plays out in full: a projectile flies its whole path, a lunge or
// grab whiffs instead of stopping on contact. Both: the two side by side, the same inputs on the same tick.
type View = 'dummy' | 'alone' | 'both'
const VIEW_KEY = 'roster.view', NOBODY: FighterDef = { ...REF, name: '' }
const DUMMY: FighterDef = { ...REF, id: 'training_dummy', name: 'Training Dummy', look: { ...REF.look, skin: '#d9b77e', main: '#b08a55', alt: '#6e5434', trim: '#d8453a', head: 'round', hair: 'none' } }
const ctx2 = $<HTMLCanvasElement>('#arena2').getContext('2d')!
let view: View = 'both', solo = false, w2: World | null = null, fx2: Fx | null = null
try { const v = localStorage.getItem(VIEW_KEY); if (v === 'dummy' || v === 'alone' || v === 'both') view = v; else if (localStorage.getItem('roster.solo') === '1') view = 'alone' } catch {}
const soloWorld = () => newWorld(cur!, NOBODY, 1, STAGE.max - STAGE.min - 120)
function setView(v: View) {
  view = v; solo = v === 'alone'
  try { localStorage.setItem(VIEW_KEY, v) } catch {}
  for (const b of document.querySelectorAll<HTMLElement>('#views button')) b.setAttribute('aria-pressed', String(b.dataset.view === v))
  document.body.classList.toggle('both', v === 'both' && !trying)
}
for (const b of document.querySelectorAll<HTMLElement>('#views button')) b.onclick = () => { setView(b.dataset.view as View); if (cur) trying ? fresh() : playClip(clip) }

// Try it: the move list gives way to touch controls and the fighter is yours. The dummy stands still.
document.head.append(Object.assign(document.createElement('style'), { textContent: TOUCH_CSS }))
let trying = false, pad: TouchPad | null = null, calm = 0
setView(view)
const KEYS: Record<string, number> = { KeyA: L, KeyD: R, KeyW: U, KeyS: D, ArrowLeft: L, ArrowRight: R, ArrowUp: U, ArrowDown: D, KeyU: LP, KeyI: HP, KeyJ: LK, KeyK: HK, Space: BL, KeyL: BL }
const held = new Set<string>()
addEventListener('keydown', e => { if (trying && e.code in KEYS) { held.add(e.code); e.preventDefault() } })
addEventListener('keyup', e => { held.delete(e.code) })
addEventListener('blur', () => held.clear())
const keyBits = () => { let b = 0; for (const k of held) b |= KEYS[k] ?? 0; return b }
function fresh() {
  if (!cur) return
  w = solo ? soloWorld() : newWorld(cur, DUMMY, 1, 260); fx = newFx(w); w2 = fx2 = null
  w.f[0].meter = 100; calm = 0
}
function setTrying(on: boolean) {
  trying = on; setView(view)
  $('#try').setAttribute('aria-pressed', String(on)); $('#try').textContent = on ? 'Move list' : 'Try it'
  $('#scroll').hidden = on; $('#deck').hidden = !on
  if (on) {
    pad ??= touchPad($('#deck'))
    fresh(); $('#frames').hidden = true
    $('#now').innerHTML = '<b>You have control</b> <span class="dim">tap light, flick heavy</span>'
    for (const el of document.querySelectorAll('.mv')) el.classList.remove('on')
  } else if (cur) playClip(clip)
}
$('#try').onclick = () => setTrying(!trying)

/** The clip's world from tick 0. Deterministic, so replaying it lands on the same frame every time. */
function reset(c?: Clip) {
  w = solo ? soloWorld() : newWorld(cur!, DUMMY, 1, c ? c.demo.dist : 260); fx = newFx(w); demoT = 0
  w2 = view === 'both' ? soloWorld() : null; fx2 = w2 && newFx(w2)
  for (const x of w2 ? [w, w2] : [w]) if (c) { x.f[0].meter = 100; if (c.demo.powered) x.f[0].buff = { t: 9999, power: 1, speed: 1, defense: 1, color: '#ffffff' } }
}
function advance(quiet = false) { // quiet: replaying to build the strip or to land on a frame, no sound or sparks
  const c = clips[clip]
  if (solo) w.f[1].inv = 999 // nothing can hit or grab it; refreshed because returning to idle clears it
  step(w, c ? at(c.demo.script, w, demoT) : 0, c?.demo.foe && !solo ? at(c.demo.foe, w, demoT) : 0); if (!quiet) fxTick(fx, w)
  if (w2 && fx2) { // the alone copy: same script, nobody to hit
    w2.f[1].inv = 999
    step(w2, c ? at(c.demo.script, w2, demoT) : 0, 0); if (!quiet) fxTick(fx2, w2)
    w2.time = 99 * 60
  }
  w.time = 99 * 60; demoT++
}

// ---- frames: the move as its sprite cells -------------------------------------
// Under the arena, a strip of the cells the move shows, in order, each with the frames it is on screen and how
// many moves share that cell. It lights up as the clip plays; tap a cell, or step, to hold any single frame.
type Seg = { key: string; phase: string; move: string; t0: number; t1: number; a: number; b: number }
const CLIP_LEN = 230, PHASE: Record<string, string> = { startup: 'windup', active: 'hit', recovery: 'recover' }
let segs: Seg[] = [], paused = false, lit = -1, shared = new Map<string, string[]>()

function timeline(c: Clip): Seg[] {
  reset(c)
  const out: Seg[] = []
  for (let k = 0; k < CLIP_LEN; k++) {
    advance(true)
    const f = w.f[0], m = f.mv
    if (f.st !== 'atk' || !m) continue
    const phase = f.t < m.su ? 'startup' : f.t < m.su + m.ac ? 'active' : 'recovery'
    const key = spriteLook(f).layers.reduce((x, l) => (l.alpha >= x.alpha ? l : x), { key: '', alpha: -1 }).key
    const last = out[out.length - 1]
    if (last && last.key === key && last.phase === phase && last.move === m.name && last.b === demoT - 1) { last.b = demoT; last.t1 = f.t }
    else out.push({ key, phase, move: m.name, t0: f.t, t1: f.t, a: demoT, b: demoT })
  }
  return out
}

function cellCanvas(key: string): HTMLCanvasElement {
  const cv = document.createElement('canvas'), px = Math.round(64 * devicePixelRatio)
  cv.width = cv.height = px
  const c = cv.getContext('2d')!, d = cur!, C = compile(d), img = sheets.get(d.id), i = C.sheetKeys.indexOf(key)
  if (img && i >= 0) c.drawImage(img, (i % COLS) * CELL, Math.floor(i / COLS) * CELL, CELL, CELL, 0, 0, px, px)
  else if (C.poses[key]) { c.save(); c.scale(px / CELL, px / CELL); drawRig(c, C.poses[key], d.look, AX, AY, 1); c.restore() }
  return cv
}

function buildStrip(c?: Clip) {
  segs = c ? timeline(c) : []
  const strip = $('#strip'); strip.replaceChildren()
  $('#frames').hidden = !segs.length || trying
  let move = ''
  segs.forEach((g, n) => {
    const el = document.createElement('button'); el.className = 'seg ' + g.phase; el.dataset.seg = String(n)
    const pose = g.key.replace(/\.[ws]$/, ''), users = shared.get(pose) ?? []
    const head = g.move !== move ? `<span class="sm">${esc(g.move)}</span>` : '<span class="sm">&nbsp;</span>'
    move = g.move
    el.innerHTML = `${head}<span class="sp">${PHASE[g.phase]} ${g.t0 + 1}${g.t1 > g.t0 ? '–' + (g.t1 + 1) : ''}</span><span class="sk">${esc(g.key)}${users.length > 1 ? ` <b title="${esc(users.join(', '))}">×${users.length}</b>` : ''}</span>`
    el.prepend(cellCanvas(g.key))
    el.setAttribute('aria-label', `${g.move}, ${PHASE[g.phase]} frames ${g.t0 + 1} to ${g.t1 + 1}, cell ${g.key}${users.length > 1 ? `, shared by ${users.join(', ')}` : ''}`)
    strip.append(el)
  })
  reset(c)
  const d = cur!
  if (d.atlas && !sheets.has(d.id)) sheet(d).then(() => { // painted cells replace the rig once the sheet is in
    if (cur !== d) return
    for (const el of strip.querySelectorAll<HTMLElement>('.seg')) el.querySelector('canvas')!.replaceWith(cellCanvas(segs[+el.dataset.seg!].key))
  })
}

/** Hold the clip on one frame: replay it from the start up to tick n. */
function seek(n: number) {
  const c = clips[clip]
  if (!c) return
  paused = true; reset(c)
  n = Math.max(0, Math.min(CLIP_LEN, n))
  while (demoT < n) advance(true)
  showFrame()
}
function showFrame() {
  const f = w.f[0], m = f.mv, live = segs.findIndex(g => demoT >= g.a && demoT <= g.b)
  for (const el of document.querySelectorAll<HTMLElement>('.seg')) el.classList.toggle('on', +el.dataset.seg! === live)
  if (live >= 0 && live !== lit) { const el = document.querySelector<HTMLElement>(`.seg[data-seg="${live}"]`), st = $('#strip'); if (el) st.scrollLeft = Math.max(0, el.offsetLeft - st.offsetLeft - 40) }
  lit = live
  $('#fplay').textContent = paused ? '▶' : '❚❚'; $('#fplay').setAttribute('aria-label', paused ? 'Play' : 'Pause')
  $('#fnow').textContent = paused ? (f.st === 'atk' && m ? `${m.name} frame ${f.t + 1}` : `tick ${demoT}`) : ''
}
$('#strip').addEventListener('click', e => {
  const b = (e.target as HTMLElement).closest<HTMLElement>('.seg')
  if (b) seek(segs[+b.dataset.seg!].a)
})
$('#fback').onclick = () => seek(paused ? demoT - 1 : demoT)
$('#fnext').onclick = () => seek(paused ? demoT + 1 : demoT)
$('#fplay').onclick = () => { if (paused && demoT >= CLIP_LEN) reset(clips[clip]); paused = !paused; showFrame() }

function playClip(i: number, user = false) {
  if (!cur) return
  if (trying) { clip = i; fresh(); return }
  if (user) auto = false
  clip = i; paused = false
  const c = clips[i]
  buildStrip(c)
  showFrame()
  $('#now').innerHTML = c ? `<b>${esc(c.label)}</b> <span class="dim">${esc(c.cmd)}</span>` : (clips.length ? 'Tap a move to watch it' : '')
  for (const el of document.querySelectorAll('.mv')) el.classList.toggle('on', +(el as HTMLElement).dataset.clip! === i)
}

function tick() {
  if (fx.slow > 0 && fx.slow-- % 2) return
  if (trying) {
    if (solo) w.f[1].inv = 999
    step(w, pad!.poll() | keyBits(), 0); fxTick(fx, w); w.time = 99 * 60
    // like training in the studio: once things settle, health and meter fill back up
    calm = w.f.some(f => f.combo || !['idle', 'walk', 'crouch', 'squat', 'block', 'air', 'atk', 'dash'].includes(f.st)) ? 0 : calm + 1
    if (calm > 50) for (const f of w.f) { f.hp = f.def.stats.hp; f.meter = 100 }
    if (w.over) fresh()
    return
  }
  if (paused) return
  advance()
  // a clip runs about 4s, then the next one starts (or the same one again once the viewer picked it)
  if (demoT > CLIP_LEN) playClip(auto && clips.length ? (clip + 1) % clips.length : clip)
  else if (segs.length) showFrame()
}
let acc = 0, last = 0
function frame(now: number) {
  acc += Math.min(100, now - (last || now)); last = now
  for (; acc >= 1000 / 60; acc -= 1000 / 60) tick()
  const x = w.f[1].x
  if (solo) w.f[1].x = 1e4 // off canvas for this draw only
  draw(ctx, w, fx, { boxes: false, sheets })
  w.f[1].x = x
  if (w2 && fx2 && !trying) { const x2 = w2.f[1].x; w2.f[1].x = 1e4; draw(ctx2, w2, fx2, { boxes: false, sheets }); w2.f[1].x = x2 }
  raf = requestAnimationFrame(frame)
}

function moveRow(i: number, name: string, cmd: string, sub: string) {
  return `<button class="mv" data-clip="${i}"${i < 0 ? ' disabled' : ''}><span class="top"><b>${esc(name)}</b><span class="cmd">${esc(cmd)}</span></span><span class="sub">${sub}</span></button>`
}

function open(d: FighterDef) {
  cur = d; auto = true; clips = []
  document.body.classList.add('lock'); $('#detail').hidden = false; $('#scroll').scrollTop = 0
  $('#dname').textContent = d.name; $('#dbadge').innerHTML = '<span class="dim">checking…</span>'; document.title = `${d.name} · Thousand Fighters`
  const st = d.stats
  $('#stats').innerHTML = [['Health', st.hp], ['Speed', st.speed], ['Power', st.power], ['Jump', st.jump]]
    .map(([k, v]) => `<div class="stat"><b>${v}</b><span>${k}</span></div>`).join('')
  $('#body').innerHTML = `<h2>Moves</h2><p class="dim">Working out frame data…</p>${d.bio ? `<h2>About</h2><p class="bio">${esc(d.bio)}</p>` : ''}`
  sheet(d); playClip(-1)
  cancelAnimationFrame(raf); last = 0; acc = 0; raf = requestAnimationFrame(frame)
  // validation plays every move in the sim (~100-200ms): let the page paint first
  setTimeout(() => { if (cur === d) fill(d) }, 30)
}

function fill(d: FighterDef) {
  const r = validate(d), own = new Set((d.moves ?? []).map(m => m.id)), C = compile(d)
  shared = new Map()
  for (const m of Object.values(C.moves)) shared.set(m.pose, [...(shared.get(m.pose) ?? []), m.name])
  const bad = r.checks.filter(c => !c.ok)
  $('#dbadge').innerHTML = bad.length ? `<span class="bad">✘ ${bad.length} failing</span>` : `<span class="ok">✔ ${r.checks.length} checks</span>`

  const rowsHtml = (rows: typeof r.rows) => rows.map(m => {
    const i = m.demo ? clips.push({ label: m.name, cmd: m.cmd, demo: m.demo }) - 1 : -1
    const mv = C.moves[m.id], buffer = Object.values(C.moves).find(x => x.buff)
    const need = [mv?.cost ? (mv.cost >= 100 ? 'full meter' : mv.cost >= 50 ? 'half meter' : `${mv.cost}% meter`) : '', mv?.needs === 'buff' ? `only during ${buffer ? esc(buffer.name) : 'a power-up'}` : '']
      .filter(Boolean).map(t => `<span class="need">${t}</span>`)
    const bits = [...need, `${m.su}f startup`, m.dmg ? `${m.dmg} dmg` : '', m.lvl === 'oh' ? 'overhead' : m.lvl, m.onHit && m.onHit !== '—' ? `${m.onHit} on hit` : '', m.onBlock ? `${m.onBlock} on block` : ''].filter(Boolean)
    return moveRow(i, m.name, m.cmd, bits.join(' · '))
  }).join('')
  const sig = rowsHtml(r.rows.filter(m => own.has(m.id) && C.moves[m.id]?.btn))
  const combos = r.checks.filter(c => c.name.startsWith('String ')).map(c => {
    const i = c.demo ? clips.push({ label: 'Combo', cmd: c.name.slice(7), demo: c.demo }) - 1 : -1
    return moveRow(i, c.name.slice(7), '', `<span class="${c.ok ? 'ok' : 'bad'}">${c.ok ? '✔' : '✘'}</span> ${esc(c.detail)}`)
  }).join('')
  const kit = rowsHtml(r.rows.filter(m => !own.has(m.id)))

  $('#body').innerHTML = (sig ? `<h2>Signature moves</h2><div class="list">${sig}</div>` : '')
    + (combos ? `<h2>Combos</h2><div class="list">${combos}</div>` : '')
    + `<details><summary><h2>Universal kit</h2></summary><div class="list">${kit}</div></details>`
    + (bad.length ? `<h2>Failing checks</h2><ul class="checks">${bad.map(c => `<li><span class="bad">✘</span> ${esc(c.name)} <small>${esc(c.detail)}</small></li>`).join('')}</ul>` : '')
    + (d.bio ? `<h2>About</h2><p class="bio">${esc(d.bio)}</p>` : '')
  playClip(clips.length ? 0 : -1)
}

function close() {
  if (trying) setTrying(false)
  cur = null; cancelAnimationFrame(raf)
  $('#detail').hidden = true; document.body.classList.remove('lock'); document.title = 'Roster · Thousand Fighters'
}

$('#body').addEventListener('click', e => {
  const b = (e.target as HTMLElement).closest<HTMLElement>('.mv')
  if (b && +b.dataset.clip! >= 0) playClip(+b.dataset.clip!, true)
})
$('#back').onclick = () => { if (history.state?.fromGrid) history.back(); else location.hash = '' }
addEventListener('keydown', e => { if (e.key === 'Escape' && cur) $('#back').click() })

// ---- routing: #/<id> opens a fighter ------------------------------------------
function route() {
  const id = decodeURIComponent(location.hash.replace(/^#\/?/, ''))
  const d = id && roster.find(x => x.id === id)
  if (d) { if (cur?.id !== d.id) open(d) } else if (cur) close()
}
addEventListener('hashchange', () => { if (location.hash.length > 2 && !history.state) history.replaceState({ fromGrid: true }, ''); route() })

$('#search').addEventListener('input', renderGrid)
try {
  roster = (await loadFighters()).sort((a, b) => a.name.localeCompare(b.name))
  renderGrid(); route()
} catch (err) {
  $('#count').textContent = 'Could not load the roster.'
  console.error(err)
}
