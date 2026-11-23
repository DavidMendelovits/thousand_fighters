// The roster page: every fighter at a glance, phone first. Tap one for its stats, moves and combos,
// each playable in a small arena against the validator's sparring dummy, or with no one to hit. Read-only.
import { POSES, compile, fk, type FighterDef } from './kit'
import { newWorld, step, STAGE, type World } from './sim'
import { draw, drawRig, newFx, fxTick, CELL, AX, AY, type Fx } from './render'
import { validate, at, REF, type Demo } from './validate'
import { loadFighters, sheetUrl } from './data'

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

// Solo: no opponent. The dummy is moved to the far edge, made untouchable and not drawn, so a move plays out
// in full: a projectile flies its whole path, a lunge or grab whiffs instead of stopping on contact.
const SOLO_KEY = 'roster.solo', NOBODY: FighterDef = { ...REF, name: '' }
let solo = false
try { solo = localStorage.getItem(SOLO_KEY) === '1' } catch {}
function setSolo(on: boolean) {
  solo = on
  try { localStorage.setItem(SOLO_KEY, on ? '1' : '0') } catch {}
  $('#solo').setAttribute('aria-pressed', String(on)); $('#solo').textContent = on ? 'Show opponent' : 'Hide opponent'
}
setSolo(solo)
$('#solo').onclick = () => { setSolo(!solo); if (cur) playClip(clip) }

function playClip(i: number, user = false) {
  if (!cur) return
  if (user) auto = false
  clip = i; demoT = 0
  const c = clips[i]
  w = solo ? newWorld(cur, NOBODY, 1, STAGE.max - STAGE.min - 120) : newWorld(cur, REF, 1, c ? c.demo.dist : 260); fx = newFx(w)
  if (c) { w.f[0].meter = 100; if (c.demo.powered) w.f[0].buff = { t: 9999, power: 1, speed: 1, defense: 1, color: '#ffffff' } }
  $('#now').innerHTML = c ? `<b>${esc(c.label)}</b> <span class="dim">${esc(c.cmd)}</span>` : (clips.length ? 'Tap a move to watch it' : '')
  for (const el of document.querySelectorAll('.mv')) el.classList.toggle('on', +(el as HTMLElement).dataset.clip! === i)
}

function tick() {
  if (fx.slow > 0 && fx.slow-- % 2) return
  const c = clips[clip]
  if (solo) w.f[1].inv = 999 // nothing can hit or grab it; refreshed because returning to idle clears it
  step(w, c ? at(c.demo.script, w, demoT) : 0, c?.demo.foe && !solo ? at(c.demo.foe, w, demoT) : 0); fxTick(fx, w)
  w.time = 99 * 60; demoT++
  // a clip runs about 4s, then the next one starts (or the same one again once the viewer picked it)
  if (demoT > 230) playClip(auto && clips.length ? (clip + 1) % clips.length : clip)
}
let acc = 0, last = 0
function frame(now: number) {
  acc += Math.min(100, now - (last || now)); last = now
  for (; acc >= 1000 / 60; acc -= 1000 / 60) tick()
  const x = w.f[1].x
  if (solo) w.f[1].x = 1e4 // off canvas for this draw only
  draw(ctx, w, fx, { boxes: false, sheets })
  w.f[1].x = x
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
  const bad = r.checks.filter(c => !c.ok)
  $('#dbadge').innerHTML = bad.length ? `<span class="bad">✘ ${bad.length} failing</span>` : `<span class="ok">✔ ${r.checks.length} checks</span>`

  const rowsHtml = (rows: typeof r.rows) => rows.map(m => {
    const i = m.demo ? clips.push({ label: m.name, cmd: m.cmd, demo: m.demo }) - 1 : -1
    const bits = [`${m.su}f startup`, m.dmg ? `${m.dmg} dmg` : '', m.lvl === 'oh' ? 'overhead' : m.lvl, m.onHit && m.onHit !== '—' ? `${m.onHit} on hit` : '', m.onBlock ? `${m.onBlock} on block` : ''].filter(Boolean)
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
