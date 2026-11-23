// The studio: roster, live playable arena, fighter editor. One page; the arena is always running.
import { POSES, TEMPLATES, type FighterDef, type SpecialType } from './kit'
import { newWorld, step, cpu, L, R, U, D, LP, HP, LK, HK, BL, type World } from './sim'
import { draw, drawRig, newFx, fxTick, enableAudio, bakeSheet, type Fx } from './render'
import { newMatch, matchStep, matchBanner, FIRST_TO, type Match } from './match'
import { validate, at, type Script, type Demo } from './validate'
import { design } from './design'
import { loadFighters, sheetUrl } from './data'

const $ = <T extends HTMLElement = HTMLElement>(s: string) => document.querySelector<T>(s)!
const esc = (s: string) => s.replace(/[&<>"]/g, c => `&#${c.charCodeAt(0)};`)
const api = (path: string, method = 'GET', body?: BodyInit) => fetch('/api/' + path, { method, body }).then(r => { if (!r.ok) throw new Error(`${method} ${path}: ${r.status}`); return r.json() })

let roster: FighterDef[] = await loadFighters()
if (!roster.length) roster = [design('Rookie'), design('Sparring Partner')]
roster.sort((a, b) => a.name.localeCompare(b.name))
let cur = structuredClone(roster[0]), opp = roster[1] ?? roster[0]
let mode: 'train' | 'fight' = 'train', dirty = false
let w: World, match: Match | null = null, fx: Fx, demo: Script | null = null, demoFoe: Script | undefined, demoT = 0, calm = 0, overT = 0, demos: (Demo | undefined)[] = []
const sheets = new Map<string, HTMLImageElement>(), cards = new Map<string, HTMLButtonElement>()
const ctx = $<HTMLCanvasElement>('#arena').getContext('2d')!

function loadSheet(d: FighterDef, force = false) {
  if (!d.atlas || (sheets.has(d.id) && !force)) return
  const img = new Image(); img.onload = () => sheets.set(d.id, img); img.src = `${sheetUrl(d.id)}?${Date.now()}`
}
/** Fight mode plays a best-of-3 match; training (and demos, with `plain`) is one endless round. */
function restart(dist = 300, plain = false) {
  const seed = (Math.random() * 2 ** 31) | 0
  match = mode === 'fight' && !plain ? newMatch(cur, opp, seed) : null
  w = match?.w ?? newWorld(cur, opp, seed, dist); fx = newFx(w); demo = null; overT = 0
}

// ---- input ------------------------------------------------------------------
// Player 1 always has WASD + U I J K. The arrows are player 1's too, unless a second player is in.
const KEYS: Record<string, number> = { KeyA: L, KeyD: R, KeyW: U, KeyS: D, KeyU: LP, KeyI: HP, KeyJ: LK, KeyK: HK, Space: BL, KeyL: BL }
const ARROWS: Record<string, number> = { ArrowLeft: L, ArrowRight: R, ArrowUp: U, ArrowDown: D }
// Player 2: arrows + numpad 4 5 / 1 2 (0 blocks), or ; ' / . slash (right Shift blocks) on keyboards without a numpad
const KEYS2: Record<string, number> = { ...ARROWS, Numpad4: LP, Numpad5: HP, Numpad1: LK, Numpad2: HK, Numpad0: BL, Semicolon: LP, Quote: HP, Period: LK, Slash: HK, ShiftRight: BL }
const down = new Set<string>() // key codes held right now
const bits = (map: Record<string, number>) => { let b = 0; for (const k of down) b |= map[k] ?? 0; return b }
const twoP = () => mode === 'fight' && $<HTMLSelectElement>('#skill').value === '2p'
const p1Keys = () => twoP() ? KEYS : { ...KEYS, ...ARROWS }
const typing = (e: Event) => { const el = e.target as HTMLInputElement; return el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || (el.tagName === 'INPUT' && !['range', 'checkbox', 'color'].includes(el.type)) || !!document.querySelector('dialog[open]') }
addEventListener('keydown', e => {
  if (typing(e)) return
  enableAudio()
  if (e.code in p1Keys() || (twoP() && e.code in KEYS2)) { down.add(e.code); e.preventDefault() }
  else if (e.code === 'Enter') restart()
})
addEventListener('keyup', e => { down.delete(e.code) })
addEventListener('blur', () => { down.clear() })
const p1Input = () => bits(p1Keys()) | pad(0)
function pad(n = 0): number {
  const g = navigator.getGamepads?.()[n]
  if (!g) return 0
  const b = (i: number) => g.buttons[i]?.pressed, ax = g.axes
  return (b(14) || ax[0] < -0.5 ? L : 0) | (b(15) || ax[0] > 0.5 ? R : 0) | (b(12) || ax[1] < -0.5 ? U : 0) | (b(13) || ax[1] > 0.5 ? D : 0)
    | (b(2) ? LP : 0) | (b(3) ? HP : 0) | (b(0) ? LK : 0) | (b(1) ? HK : 0) | (b(5) || b(7) ? BL : 0)
}
function p2(): number {
  if (demo) return demoFoe ? at(demoFoe, w, demoT) : 0
  if (mode === 'fight') return twoP() ? bits(KEYS2) | pad(1) : cpu(w, 1, +$<HTMLSelectElement>('#skill').value)
  switch ($<HTMLSelectElement>('#dummy').value) {
    case 'crouch': return D
    case 'block': return BL
    case 'lowblock': return BL | D
    case 'jump': return w.tick % 70 < 2 ? U : 0
    case 'cpu': return cpu(w, 1, 0.6)
    default: return 0
  }
}

// ---- loop -------------------------------------------------------------------
function tick() {
  if (fx.slow > 0 && fx.slow-- % 2) return // KO slow motion
  if (match && !demo) {
    matchStep(match, p1Input(), p2())
    if (match.w !== w) { w = match.w; fx = newFx(w) } // next round
  } else step(w, demo ? at(demo, w, demoT++) : p1Input(), p2())
  fxTick(fx, w)
  if (demo && demoT > 230) restart()
  if (mode === 'train') {
    w.time = 99 * 60
    calm = w.f.some(f => f.combo || !['idle', 'walk', 'crouch', 'squat', 'block', 'air', 'atk', 'dash'].includes(f.st)) ? 0 : calm + 1
    if (calm > 50) for (const f of w.f) { f.hp = f.def.stats.hp; f.meter = 100 }
    if (w.over && ++overT > 150) restart()
  }
}
let acc = 0, last = performance.now()
function frame(now: number) {
  acc += Math.min(100, now - last); last = now
  for (; acc >= 1000 / 60; acc -= 1000 / 60) tick()
  draw(ctx, w, fx, {
    boxes: $<HTMLInputElement>('#boxes').checked, sheets,
    ...(match && !demo ? { ...matchBanner(match), rounds: { wins: match.wins, of: FIRST_TO } } : {}),
  })
  requestAnimationFrame(frame)
}

// ---- roster -----------------------------------------------------------------
function thumb(d: FighterDef) {
  let el = cards.get(d.id)
  if (!el) {
    el = document.createElement('button'); el.className = 'card'
    el.append(Object.assign(document.createElement('canvas'), { width: 60, height: 74 }), document.createElement('span'))
    el.onclick = () => select(d.id); cards.set(d.id, el)
  }
  const c = (el.firstChild as HTMLCanvasElement).getContext('2d')!
  c.clearRect(0, 0, 60, 74); c.save(); c.scale(0.34, 0.34); drawRig(c, POSES.idle0, d.look, 78, 210, 1); c.restore()
  el.lastChild!.textContent = d.name
  return el
}
function renderRoster() {
  const q = $<HTMLInputElement>('#search').value.toLowerCase()
  $('#grid').replaceChildren(...roster.filter(d => (d.name + ' ' + d.bio).toLowerCase().includes(q)).map(d => cards.get(d.id) ?? thumb(d)))
  for (const [id, el] of cards) el.classList.toggle('on', id === cur.id)
  $('#count').textContent = `${roster.length} fighters`
  const sel = $<HTMLSelectElement>('#opp')
  sel.replaceChildren(...roster.map(d => new Option(d.name, d.id, false, d.id === opp.id)))
}
function select(id: string) {
  if (dirty && !confirm(`Discard unsaved changes to ${cur.name}?`)) return
  if (dirty) thumb(roster.find(d => d.id === cur.id)!)
  cur = structuredClone(roster.find(d => d.id === id)!); dirty = false
  loadSheet(cur); buildPanel(); restart(); revalidate(); renderRoster()
}
const uniqueId = (base: string) => { let id = base, n = 2; while (roster.some(d => d.id === id)) id = `${base.slice(0, 36)}_${n++}`; return id }

// ---- editor -----------------------------------------------------------------
const get = (path: string) => path.split('.').reduce((o: any, k) => o[k], cur)
function set(path: string, v: unknown) { const ks = path.split('.'), last = ks.pop()!; ks.reduce((o: any, k) => o[k], cur)[last] = v }

function buildPanel() {
  const sl = (label: string, path: string, min: number, max: number, st: number) => `<label>${label}<input type="range" data-k="${path}" min="${min}" max="${max}" step="${st}" value="${get(path)}"><output>${get(path)}</output></label>`
  const pick = (label: string, path: string, opts: string[]) => `<label>${label}<select data-k="${path}">${opts.map(o => `<option${o === get(path) ? ' selected' : ''}>${o}</option>`).join('')}</select><span></span></label>`
  const col = (label: string, path: string) => `<label>${label}<input type="color" data-k="${path}" value="${get(path)}"></label>`
  $('#panel').innerHTML = `
    <div class="row"><input class="name" data-k="name" value="${esc(cur.name)}" aria-label="Name"><span id="badge"></span></div>
    <textarea data-k="bio" rows="2" aria-label="Description">${esc(cur.bio)}</textarea>
    <div class="row"><button id="save" class="primary">Save</button><button id="reroll" title="New look, combos and specials from the same description">Reroll</button><button id="dup">Duplicate</button><button id="del">Delete</button></div>
    <details open><summary>Look</summary>
      <div class="swatches">${col('Skin', 'look.skin')}${col('Body', 'look.main')}${col('Legs', 'look.alt')}${col('Trim', 'look.trim')}</div>
      ${sl('Height', 'look.height', 0.8, 1.2, 0.01)}${sl('Bulk', 'look.bulk', 0.7, 1.5, 0.01)}${sl('Arms', 'look.arms', 0.8, 1.25, 0.01)}${sl('Legs', 'look.legs', 0.85, 1.2, 0.01)}
      ${pick('Head', 'look.head', ['round', 'square', 'tall'])}${pick('Hair', 'look.hair', ['none', 'spikes', 'mohawk', 'long', 'bun'])}${pick('Headgear', 'look.hat', ['none', 'hood', 'horns', 'helmet', 'wizard', 'crown', 'mask', 'headband', 'lantern'])}
      <label class="free"><input type="checkbox" data-k="look.cape"${cur.look.cape ? ' checked' : ''}>&nbsp;Cape</label>
    </details>
    <details open><summary>Stats</summary>${sl('Health', 'stats.hp', 800, 1250, 10)}${sl('Speed', 'stats.speed', 0.75, 1.3, 0.01)}${sl('Power', 'stats.power', 0.8, 1.25, 0.01)}${sl('Jump', 'stats.jump', 0.85, 1.2, 0.01)}</details>
    <details open><summary>Dial combos</summary>
      <textarea id="strings" rows="4" spellcheck="false" aria-label="Dial combos">${cur.strings.map(s => s.join(' ')).join('\n')}</textarea>
      <small>One string per line from lp hp lk hk. Each is tested as a true combo below.</small>
    </details>
    <details open><summary>Moves <small>· specials, follow-ups, supers</small></summary>
      <div class="row"><select id="tpl" aria-label="Add a move from a template"><option value="">＋ Add from template…</option>${Object.keys(TEMPLATES).map(t => `<option>${t}</option>`).join('')}</select><span id="advErr" class="bad"></span></div>
      <textarea id="adv" rows="12" spellcheck="false" aria-label="Moves, poses and tweaks as JSON" style="font:11px ui-monospace,monospace;white-space:pre">${esc(advJson())}</textarea>
      <small>Everything this fighter owns beyond the universal kit: <code>moves</code>, custom <code>poses</code>, and <code>tweaks</code> to universal moves. See the Move type in kit.ts for every field.</small>
    </details>
    <details open><summary>Checks</summary><ul id="checks"></ul></details>
    <details open><summary>Move list <small>· click a move to watch it</small></summary><table id="moves"></table></details>
    <details><summary>Sprites</summary>
      <p>The rig is the placeholder art and the pose guide. Download the pose sheet, have any image model repaint each cell as this character (same poses, same layout, flat magenta background), then import the result.</p>
      <div class="row"><button id="guide">Download pose sheet</button><button id="sheet">Import painted sheet</button>${cur.atlas ? '<button id="nosheet">Back to rig</button>' : ''}</div>
      <input type="file" id="sheetFile" accept="image/png,image/webp,image/jpeg" hidden>
    </details>`
}

// compact JSON: one move per line so the list stays scannable
const advJson = () => `{\n  "moves": [\n${cur.moves.map(m => '    ' + JSON.stringify(m)).join(',\n')}\n  ],\n  "poses": {${Object.entries(cur.poses ?? {}).map(([k, v]) => `\n    ${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(',')}\n  },\n  "tweaks": ${JSON.stringify(cur.tweaks ?? {})}\n}`
let timer = 0
function changed() { dirty = true; thumb(cur); restart(); clearTimeout(timer); timer = window.setTimeout(revalidate, 150) }
function revalidate() {
  const r = validate(cur), bad = r.checks.filter(c => !c.ok).length
  $('#badge').innerHTML = bad ? `<span class="bad">✘ ${bad} failing</span>` : `<span class="ok">✔ ${r.checks.length} checks</span>`
  demos = [...r.checks.map(c => c.demo), ...r.rows.map(m => m.demo)]
  $('#checks').innerHTML = r.checks.map((c, i) => `<li${c.demo ? ` data-demo="${i}" title="Watch it"` : ''}><span class="${c.ok ? 'ok' : 'bad'}">${c.ok ? '✔' : '✘'}</span> ${esc(c.name)} <small>${esc(c.detail)}</small></li>`).join('')
  $('#moves').innerHTML = '<tr><th>Move</th><th>Input</th><th title="startup / active / recovery ticks">Frames</th><th>Dmg</th><th>Hits</th><th title="frame advantage on hit / on block">Adv</th></tr>'
    + r.rows.map((m, i) => `<tr${m.demo ? ` data-demo="${r.checks.length + i}"` : ''}><td>${esc(m.name)}</td><td>${esc(m.cmd)}</td><td>${m.su}/${m.ac || '–'}/${m.rc || '–'}</td><td>${m.dmg || ''}</td><td>${m.lvl === 'oh' ? 'overhead' : m.lvl}</td><td>${m.onHit}${m.onBlock ? ' / ' + m.onBlock : ''}</td></tr>`).join('')
}

function play(d: Demo) {
  restart(d.dist, true); w.f[0].meter = 100; demo = d.script; demoFoe = d.foe; demoT = 0
  if (d.powered) w.f[0].buff = { t: 9999, power: 1, speed: 1, defense: 1, color: '#ffffff' }
}

async function save() {
  await api('fighters/' + cur.id, 'PUT', JSON.stringify(cur))
  const i = roster.findIndex(d => d.id === cur.id), copy = structuredClone(cur)
  if (i < 0) roster.push(copy); else roster[i] = copy
  if (opp.id === cur.id) opp = copy
  dirty = false; thumb(cur); renderRoster()
}

$('#panel').addEventListener('input', e => {
  const el = e.target as HTMLInputElement
  if (el.dataset.k) {
    set(el.dataset.k, el.type === 'range' ? +el.value : el.type === 'checkbox' ? el.checked : el.value)
    if (el.type === 'range') el.nextElementSibling!.textContent = el.value
  } else if (el.id === 'strings') {
    cur.strings = el.value.toLowerCase().split('\n').map(l => l.split(/[\s,]+/).filter(Boolean)).filter(l => l.length > 1)
  } else if (el.id === 'adv') {
    try {
      const j = JSON.parse(el.value)
      if (!Array.isArray(j.moves)) throw new Error('"moves" must be a list')
      cur = { ...cur, moves: j.moves, poses: j.poses, tweaks: j.tweaks } // new object: drops cached sheet layout
      $('#advErr').textContent = ''
    } catch (err) { $('#advErr').textContent = String(err).slice(0, 60); return }
  } else return
  changed()
})
$('#panel').addEventListener('click', async e => {
  const el = e.target as HTMLElement, dm = el.closest<HTMLElement>('[data-demo]')
  if (dm && demos[+dm.dataset.demo!]) return play(demos[+dm.dataset.demo!]!)
  switch (el.id) {
    case 'save': return save()
    case 'reroll': cur = { ...design(cur.bio || cur.name, (Math.random() * 2 ** 31) | 0), id: cur.id, name: cur.name, bio: cur.bio, atlas: cur.atlas }; buildPanel(); return changed()
    case 'dup': { if (dirty) await save(); const d = { ...structuredClone(cur), id: uniqueId(cur.id), name: cur.name + ' II', atlas: false }; roster.push(d); cur = d; await save(); return select(d.id) }
    case 'del': {
      if (!confirm(`Delete ${cur.name}? This removes their file.`)) return
      await api('fighters/' + cur.id, 'DELETE'); cards.delete(cur.id); roster = roster.filter(d => d.id !== cur.id); dirty = false
      if (!roster.length) roster = [design('Rookie')]
      if (opp.id === cur.id) opp = roster[0]
      return select(roster[0].id)
    }
    case 'guide': return bakeSheet(cur, '#ff00ff').toBlob(b => { const a = document.createElement('a'); a.href = URL.createObjectURL(b!); a.download = `${cur.id}-poses.png`; a.click() })
    case 'sheet': return $<HTMLInputElement>('#sheetFile').click()
    case 'nosheet': cur.atlas = false; buildPanel(); return changed()
  }
})
$('#panel').addEventListener('change', async e => {
  const el = e.target as HTMLInputElement
  if (el.id === 'tpl' && el.value) {
    const m = TEMPLATES[el.value as SpecialType](el.value, cur.look.trim)
    let id = m.id, n = 2; while (cur.moves.some(x => x.id === id)) id = m.id + n++
    cur = { ...cur, moves: [...cur.moves, { ...m, id }] }; buildPanel(); return changed()
  }
  if (el.id !== 'sheetFile' || !el.files?.[0]) return
  // scale to the sheet layout, then key out the background colour sampled from the top-left corner
  const guide = bakeSheet(cur), c = guide.getContext('2d')!, bmp = await createImageBitmap(el.files[0])
  c.clearRect(0, 0, guide.width, guide.height); c.drawImage(bmp, 0, 0, guide.width, guide.height)
  const px = c.getImageData(0, 0, guide.width, guide.height), d = px.data, [r, g, b, a0] = d
  if (a0 > 200) for (let i = 0; i < d.length; i += 4) if (Math.abs(d[i] - r) + Math.abs(d[i + 1] - g) + Math.abs(d[i + 2] - b) < 90) d[i + 3] = 0
  c.putImageData(px, 0, 0)
  const blob = await new Promise<Blob>(res => guide.toBlob(x => res(x!), 'image/png'))
  await api('atlas/' + cur.id, 'PUT', blob)
  cur.atlas = true; loadSheet(cur, true); buildPanel(); revalidate(); await save()
})

// ---- header + new fighter ---------------------------------------------------
function setMode(m: 'train' | 'fight') {
  mode = m; $('#train').classList.toggle('on', m === 'train'); $('#fight').classList.toggle('on', m === 'fight')
  $('#dummyWrap').hidden = m === 'fight'; $('#skillWrap').hidden = m === 'train'; restart()
}
$('#train').onclick = () => setMode('train'); $('#fight').onclick = () => setMode('fight')
$('#skill').onchange = e => { down.clear(); restart(); (e.target as HTMLElement).blur() }
$('#opp').onchange = e => { opp = roster.find(d => d.id === (e.target as HTMLSelectElement).value)!; loadSheet(opp); restart(); (e.target as HTMLElement).blur() }
$('#dummy').onchange = $('#skill').onchange = e => (e.target as HTMLElement).blur()
$('#search').oninput = renderRoster
$('#arena').onclick = () => (document.activeElement as HTMLElement)?.blur()
$('#new').onclick = () => { const dlg = $<HTMLDialogElement>('#create'); dlg.returnValue = ''; dlg.showModal() }
$<HTMLDialogElement>('#create').onclose = async e => {
  const dlg = e.target as HTMLDialogElement, file = $<HTMLInputElement>('#img').files?.[0]
  if (dlg.returnValue !== 'ok') return
  if (dirty && !confirm(`Discard unsaved changes to ${cur.name}?`)) return
  const d = design($<HTMLTextAreaElement>('#desc').value.trim() || `Mystery Fighter ${roster.length + 1}`, (Math.random() * 2 ** 31) | 0)
  if (file) Object.assign(d.look, await palette(file))
  d.id = uniqueId(d.id); cur = d; dirty = false
  await save(); select(d.id)
  $<HTMLTextAreaElement>('#desc').value = ''; $<HTMLInputElement>('#img').value = ''
}

/** Dominant colours of an image -> body / legs / trim. Ignores the background (sampled from the corner). */
async function palette(file: File): Promise<Partial<FighterDef['look']>> {
  const bmp = await createImageBitmap(file), cv = Object.assign(document.createElement('canvas'), { width: 48, height: 48 }), c = cv.getContext('2d')!
  c.drawImage(bmp, 0, 0, 48, 48)
  const d = c.getImageData(0, 0, 48, 48).data, count = new Map<number, number>()
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 128 || Math.abs(d[i] - d[0]) + Math.abs(d[i + 1] - d[1]) + Math.abs(d[i + 2] - d[2]) < 60) continue
    const key = (d[i] >> 5 << 10) | (d[i + 1] >> 5 << 5) | (d[i + 2] >> 5); count.set(key, (count.get(key) ?? 0) + 1)
  }
  const cols = [...count].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k]) => [k >> 10, (k >> 5) & 7, k & 7].map(v => v * 32 + 16))
  if (cols.length < 2) return {}
  const hex = (v: number[]) => '#' + v.map(x => x.toString(16).padStart(2, '0')).join(''), sat = (v: number[]) => Math.max(...v) - Math.min(...v), far = (a: number[], b: number[]) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2])
  const main = cols.find(v => sat(v) > 60) ?? cols[0], rest = cols.filter(v => far(v, main) > 90)
  const alt = [...rest].sort((a, b) => a[0] + a[1] + a[2] - b[0] - b[1] - b[2])[0] ?? cols[1], trim = rest.find(v => v !== alt) ?? cols[cols.length - 1]
  return { main: hex(main), alt: hex(alt), trim: hex(trim) }
}

for (const d of roster) { thumb(d); loadSheet(d) }
loadSheet(opp); buildPanel(); restart(); revalidate(); renderRoster()
requestAnimationFrame(frame)
