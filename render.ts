// Canvas rendering: the rig, painted sprite sheets, stage, HUD, effects, sound. Reads the sim, never writes it.
import { fk, POSES, compile, lerpPose, type FighterDef, type Look, type Pose, type Pt } from './kit'
import { spriteLook } from './sprite'
import { poseOf, hitbox, hurtbox, STAGE, type World, type Fighter, type Proj } from './sim'

export const FLOOR = 452
const INK = '#14121c'
const shade = (hex: string, k: number) => '#' + [1, 3, 5].map(i => Math.round(parseInt(hex.slice(i, i + 2), 16) * k).toString(16).padStart(2, '0')).join('')

/** Draw the skeleton in a pose. This is both the placeholder art and the pose guide a sprite model paints over. */
export function drawRig(c: CanvasRenderingContext2D, p: Pose, k: Look, x: number, gy: number, face: number, sway = 0) {
  const j = fk(p, k), s = k.height, b = k.bulk * s
  const X = (q: Pt) => x + face * q[0], Y = (q: Pt) => gy - q[1]
  c.lineCap = c.lineJoin = 'round'
  const seg = (a: Pt, q: Pt, w: number, col: string) => {
    c.beginPath(); c.moveTo(X(a), Y(a)); c.lineTo(X(q), Y(q))
    c.strokeStyle = INK; c.lineWidth = w + 5; c.stroke(); c.strokeStyle = col; c.lineWidth = w; c.stroke()
  }
  const blob = (pts: number[][], col: string) => {
    c.beginPath(); pts.forEach(([px, py], i) => i ? c.lineTo(px, py) : c.moveTo(px, py)); c.closePath()
    c.fillStyle = col; c.strokeStyle = INK; c.lineWidth = 2.5; c.fill(); c.stroke()
  }
  const dot = (cx: number, cy: number, r: number, col: string) => { c.beginPath(); c.arc(cx, cy, r, 0, 7); c.fillStyle = col; c.strokeStyle = INK; c.lineWidth = 2.5; c.fill(); c.stroke() }
  const arm = (el: Pt, fi: Pt, k2: number) => { seg(j.sh, el, 10 * b, shade(k.main, k2)); seg(el, fi, 9 * b, shade(k.skin, k2)); dot(X(fi), Y(fi), 6.5 * b, shade(k.trim, k2)) }
  const leg = (kn: Pt, ft: Pt, k2: number) => { seg(j.hip, kn, 13 * b, shade(k.alt, k2)); seg(kn, ft, 11 * b, shade(k.alt, k2)); seg(ft, [ft[0] + 9 * s, ft[1]], 8 * b, shade(k.trim, k2)) }

  if (k.cape) blob([[X(j.neck), Y(j.neck)], [X(j.neck) - face * 12, Y(j.neck) + 2], [X(j.hip) - face * (38 * s + sway), Y(j.hip) + 22 * s], [X(j.hip) - face * 6, Y(j.hip) + 4]], shade(k.trim, 0.7))
  arm(j.elB, j.fiB, 0.72); leg(j.knB, j.ftB, 0.72)
  seg(j.hip, j.sh, 24 * b, k.main)
  dot(X(j.hip), Y(j.hip), 8 * b, k.alt)
  leg(j.knF, j.ftF, 1)

  const hx = X(j.head), hy = Y(j.head), r = j.HR, f = face
  if (k.hair === 'long') blob([[hx - f * r * 0.2, hy - r * 1.1], [hx - f * r * 1.25, hy - r * 0.3], [hx - f * r * 1.1, hy + r * 1.7], [hx - f * r * 0.3, hy + r * 0.9]], shade(k.alt, 0.8))
  if (k.hair === 'bun') dot(hx - f * r * 0.8, hy - r * 0.9, r * 0.5, shade(k.alt, 0.8))
  c.beginPath()
  if (k.head === 'square') c.roundRect(hx - r, hy - r, r * 2, r * 2, r * 0.3)
  else c.ellipse(hx, hy, k.head === 'tall' ? r * 0.85 : r, k.head === 'tall' ? r * 1.2 : r, 0, 0, 7)
  c.fillStyle = k.hat === 'mask' ? k.trim : k.skin; c.strokeStyle = INK; c.lineWidth = 2.5; c.fill(); c.stroke()
  if (k.hair === 'spikes') blob([[hx - r, hy - r * 0.5], [hx - r * 0.7, hy - r * 1.6], [hx - r * 0.2, hy - r], [hx + r * 0.1, hy - r * 1.7], [hx + r * 0.5, hy - r], [hx + r, hy - r * 1.4], [hx + r, hy - r * 0.5]], shade(k.alt, 0.8))
  if (k.hair === 'mohawk') blob([[hx - f * r, hy - r * 0.6], [hx - f * r * 0.6, hy - r * 1.7], [hx + f * r * 0.7, hy - r * 1.6], [hx + f * r * 0.6, hy - r * 0.8]], k.trim)
  if (k.hat === 'hood') blob([[hx + f * r * 0.5, hy - r * 1.2], [hx - f * r * 0.9, hy - r * 1.15], [hx - f * r * 1.3, hy + r * 0.9], [hx - f * r * 0.5, hy + r * 1.1], [hx - f * r * 0.2, hy - r * 0.3], [hx + f * r * 0.9, hy - r * 0.45]], shade(k.main, 0.6))
  if (k.hat === 'horns') for (const d of [-1, 1]) blob([[hx + d * r * 0.4, hy - r * 0.8], [hx + d * r * 1.3, hy - r * 1.9], [hx + d * r * 0.95, hy - r * 0.5]], '#f1e6c8')
  if (k.hat === 'helmet') blob([[hx - r * 1.1, hy - r * 0.1], [hx - r * 0.9, hy - r * 1.15], [hx + r * 0.9, hy - r * 1.15], [hx + r * 1.1, hy - r * 0.1]], k.trim)
  if (k.hat === 'wizard') blob([[hx - r * 1.5, hy - r * 0.6], [hx - f * r * 0.4, hy - r * 2.9], [hx + r * 1.5, hy - r * 0.6]], shade(k.main, 0.7))
  if (k.hat === 'crown') blob([[hx - r, hy - r * 0.7], [hx - r, hy - r * 1.7], [hx - r * 0.5, hy - r * 1.2], [hx, hy - r * 1.8], [hx + r * 0.5, hy - r * 1.2], [hx + r, hy - r * 1.7], [hx + r, hy - r * 0.7]], '#f5c542')
  if (k.hat === 'headband') { seg([j.head[0] - r, j.head[1] + r * 0.35], [j.head[0] + r, j.head[1] + r * 0.35], 3, k.trim); seg([j.head[0] - r, j.head[1] + r * 0.35], [j.head[0] - r * 1.7 - sway * 0.3, j.head[1] - r * 0.2], 2, k.trim) }
  if (k.hat === 'lantern') { // the head IS a lamp: a caged light with a cap and a ring
    const g = c.createRadialGradient(hx, hy, 1, hx, hy, r * 1.05); g.addColorStop(0, '#fff'); g.addColorStop(0.5, k.trim); g.addColorStop(1, shade(k.trim, 0.55))
    c.beginPath(); c.roundRect(hx - r * 0.95, hy - r * 1.05, r * 1.9, r * 2.2, r * 0.35); c.fillStyle = g; c.strokeStyle = INK; c.lineWidth = 2.5; c.fill(); c.stroke()
    c.lineWidth = 2; for (const d of [-0.4, 0.4]) { c.beginPath(); c.moveTo(hx + d * r, hy - r * 1.05); c.lineTo(hx + d * r, hy + r * 1.15); c.stroke() }
    blob([[hx - r * 1.2, hy - r * 1.0], [hx - r * 0.5, hy - r * 1.7], [hx + r * 0.5, hy - r * 1.7], [hx + r * 1.2, hy - r * 1.0]], shade(k.alt, 1.5))
    c.beginPath(); c.arc(hx, hy - r * 2.0, r * 0.32, 0, 7); c.strokeStyle = INK; c.lineWidth = 3; c.stroke()
  } else {
    c.fillStyle = '#fff'; c.beginPath(); c.arc(hx + f * r * 0.45, hy - r * 0.05, r * 0.24, 0, 7); c.fill()
    c.fillStyle = INK; c.beginPath(); c.arc(hx + f * r * 0.55, hy - r * 0.05, r * 0.12, 0, 7); c.fill()
  }
  arm(j.elF, j.fiF, 1)
}

// ---- sprite sheets ----------------------------------------------------------
// One cell per key pose, in POSE_KEYS order. A painted sheet with the same layout replaces the rig.
export const CELL = 256, COLS = 8, AX = 112, AY = 238
export function bakeSheet(d: FighterDef, bg?: string): HTMLCanvasElement {
  const { sheetKeys, poses } = compile(d), look = d.look
  const cv = document.createElement('canvas'); cv.width = COLS * CELL; cv.height = Math.ceil(sheetKeys.length / COLS) * CELL
  const c = cv.getContext('2d')!
  if (bg) { c.fillStyle = bg; c.fillRect(0, 0, cv.width, cv.height) }
  sheetKeys.forEach((key, i) => {
    const cx = (i % COLS) * CELL, cy = Math.floor(i / COLS) * CELL
    c.save(); c.beginPath(); c.rect(cx, cy, CELL, CELL); c.clip(); drawRig(c, poses[key], look, cx + AX, cy + AY, 1); c.restore()
  })
  return cv
}

// ---- effects ----------------------------------------------------------------
export type Fx = { shake: number; slow: number; parts: { x: number; y: number; vx: number; vy: number; life: number; col: string }[]; lag: number[]; shown: Pose[]; combo: { n: number; dmg: number; t: number }[] }
export const newFx = (w: World): Fx => ({ shake: 0, slow: 0, parts: [], lag: w.f.map(f => f.hp), shown: w.f.map(() => POSES.idle0), combo: [{ n: 0, dmg: 0, t: 0 }, { n: 0, dmg: 0, t: 0 }] })

let audio: AudioContext | undefined
function sfx(type: string, power: number) {
  if (!audio) return
  const t = audio.currentTime, g = audio.createGain(); g.connect(audio.destination)
  const tone = (wave: OscillatorType, f0: number, f1: number, dur: number, vol: number) => {
    const o = audio!.createOscillator(); o.type = wave; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + dur)
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur); o.connect(g); o.start(t); o.stop(t + dur)
  }
  if (type === 'hit') tone('square', 90 + power * 14, 40, 0.09 + power * 0.012, 0.22)
  else if (type === 'block') tone('triangle', 520, 300, 0.05, 0.15)
  else if (type === 'thud') tone('sine', 110, 40, 0.18, 0.3)
  else if (type === 'ko') tone('sawtooth', 300, 50, 0.9, 0.25)
  else if (type === 'fire' || type === 'tele') tone('sawtooth', 700, 180, 0.16, 0.1)
  else if (type === 'throw') tone('triangle', 200, 420, 0.1, 0.15)
}
export const enableAudio = () => { audio ??= new AudioContext() }

/** Call once after every sim step: turns sim events into sparks, shake and sound. */
export function fxTick(fx: Fx, w: World) {
  for (const e of w.ev) {
    sfx(e.type, e.power)
    if (e.type === 'hit' || e.type === 'block') {
      fx.shake = Math.max(fx.shake, e.type === 'hit' ? e.power : 2)
      const n = e.type === 'hit' ? 6 + e.power : 4
      for (let i = 0; i < n; i++) { const a = Math.random() * 7, v = 2 + Math.random() * (e.type === 'hit' ? e.power : 3); fx.parts.push({ x: e.x, y: e.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v + 1, life: 14 + Math.random() * 10, col: e.type === 'hit' ? (i % 2 ? '#fff' : '#ffd23f') : '#8ecbff' }) }
    }
    if (e.type === 'ko') { fx.slow = 90; fx.shake = 14 }
    if (e.type === 'thud' || e.type === 'land') for (let i = 0; i < 5; i++) fx.parts.push({ x: e.x + (Math.random() - 0.5) * 40, y: 2, vx: (Math.random() - 0.5) * 3, vy: 1 + Math.random() * 2, life: 14, col: '#b9a98f' })
  }
  if (w.stop > 0) return // freeze particles with the hitstop: it sells the impact
  fx.shake *= 0.82
  for (const p of fx.parts) { p.x += p.vx; p.y += p.vy; p.vy -= 0.3; p.life-- }
  fx.parts = fx.parts.filter(p => p.life > 0)
  w.f.forEach((f, i) => {
    fx.lag[i] += (f.hp - fx.lag[i]) * (f.combo ? 0 : 0.08)
    const target = poseOf(f)
    fx.shown[i] = ['atk', 'hit', 'launch', 'thrown', 'bstun'].includes(f.st) ? target : lerpPose(fx.shown[i], target, 0.45)
    const cb = fx.combo[1 - i]; if (f.combo >= 2) { cb.n = f.combo; cb.dmg = f.comboDmg; cb.t = 70 } else if (cb.t > 0) cb.t--
  })
}

// ---- scene ------------------------------------------------------------------
let backdrop: HTMLCanvasElement | undefined
function stage(): HTMLCanvasElement {
  if (backdrop) return backdrop
  backdrop = document.createElement('canvas'); backdrop.width = STAGE.w; backdrop.height = 540
  const c = backdrop.getContext('2d')!, sky = c.createLinearGradient(0, 0, 0, FLOOR)
  sky.addColorStop(0, '#1b1035'); sky.addColorStop(0.6, '#5b2a5e'); sky.addColorStop(1, '#e0704a')
  c.fillStyle = sky; c.fillRect(0, 0, STAGE.w, 540)
  c.fillStyle = '#ffe2b0'; c.beginPath(); c.arc(700, 300, 70, 0, 7); c.fill()
  let seed = 9; const r = () => (seed = (seed * 16807) % 2147483647) / 2147483647
  for (const [col, base, h] of [['#3a1d4a', 330, 110], ['#24122f', 380, 80]] as const) { c.fillStyle = col; for (let x = -20; x < STAGE.w;) { const w2 = 40 + r() * 70, hh = 30 + r() * h; c.fillRect(x, base - hh, w2, 540); x += w2 + r() * 12 } }
  const floor = c.createLinearGradient(0, FLOOR - 20, 0, 540); floor.addColorStop(0, '#4a3550'); floor.addColorStop(1, '#17101f')
  c.fillStyle = floor; c.fillRect(0, FLOOR - 20, STAGE.w, 540)
  c.strokeStyle = 'rgba(255,255,255,.07)'; c.lineWidth = 1
  for (let i = -12; i <= 12; i++) { c.beginPath(); c.moveTo(480 + i * 46, FLOOR - 20); c.lineTo(480 + i * 120, 540); c.stroke() }
  return backdrop
}

const keyCache = new WeakMap<FighterDef, string[]>()
const compileKeys = (d: FighterDef) => keyCache.get(d) ?? (keyCache.set(d, compile(d).sheetKeys), keyCache.get(d)!)

function drawProj(c: CanvasRenderingContext2D, p: Proj, owner: Fighter) {
  const x = p.x, y = FLOOR - p.y, sz = p.s.size ?? 14, col = p.s.color, dir = Math.sign(p.vx) || 1
  if (p.s.shape === 'chain') { // tether from the thrower's hand to a hook
    const ox = owner.x + owner.face * 40, oy = FLOOR - owner.y - 105 * owner.def.look.height
    c.strokeStyle = INK; c.lineWidth = 7; c.setLineDash([]); c.beginPath(); c.moveTo(ox, oy); c.lineTo(x, y); c.stroke()
    c.strokeStyle = col; c.lineWidth = 3; c.setLineDash([7, 5]); c.stroke(); c.setLineDash([])
    c.fillStyle = col; c.strokeStyle = INK; c.lineWidth = 2.5; c.beginPath(); c.moveTo(x + dir * sz, y); c.lineTo(x - dir * sz * 0.4, y - sz * 0.8); c.lineTo(x, y); c.lineTo(x - dir * sz * 0.4, y + sz * 0.8); c.closePath(); c.fill(); c.stroke()
    return
  }
  c.save(); c.translate(x, y)
  if (p.s.shape === 'blade') { // spinning crescent
    c.rotate(p.t * 0.5 * dir); c.fillStyle = col; c.strokeStyle = '#fff'; c.lineWidth = 2
    c.beginPath(); c.arc(0, 0, sz, 0.3, Math.PI * 1.7); c.arc(sz * 0.35, 0, sz * 0.75, Math.PI * 1.6, 0.4, true); c.closePath(); c.fill(); c.stroke()
  } else if (p.s.shape === 'bomb') {
    c.fillStyle = '#14121c'; c.strokeStyle = col; c.lineWidth = 3; c.beginPath(); c.arc(0, 0, sz * 0.8, 0, 7); c.fill(); c.stroke()
    c.fillStyle = p.t % 6 < 3 ? '#fff' : col; c.beginPath(); c.arc(sz * 0.5, -sz * 0.8, 3.5, 0, 7); c.fill()
  } else if (p.s.shape === 'wave') {
    const g = c.createLinearGradient(0, -sz * 2.4, 0, sz); g.addColorStop(0, 'transparent'); g.addColorStop(0.5, col); g.addColorStop(1, '#fff')
    c.fillStyle = g; c.beginPath(); c.moveTo(-dir * sz, sz); c.quadraticCurveTo(-dir * sz * 0.2, -sz * 1.2, dir * sz * 1.1, -sz * 2.4 + Math.sin(p.t * 0.6) * 4); c.quadraticCurveTo(dir * sz * 0.6, -sz * 0.2, dir * sz, sz); c.closePath(); c.fill()
  } else {
    const g = c.createRadialGradient(0, 0, 2, 0, 0, sz * 1.7); g.addColorStop(0, '#fff'); g.addColorStop(0.35, col); g.addColorStop(1, 'transparent')
    c.fillStyle = g; c.beginPath(); c.ellipse(-dir * sz * 0.55, 0, sz * 2.1, sz * 1.15 + Math.sin(p.t) * 2, 0, 0, 7); c.fill()
  }
  c.restore()
}

function drawFighter(c: CanvasRenderingContext2D, f: Fighter, shown: Pose, sheet: HTMLImageElement | undefined, tick: number) {
  const m = f.mv, gy = FLOOR - f.y
  c.fillStyle = 'rgba(0,0,0,.35)'; c.beginPath(); c.ellipse(f.x, FLOOR + 2, 34 * f.def.look.height * (1 - Math.min(0.5, f.y / 300)), 6, 0, 0, 7); c.fill()
  c.save()
  if (f.st === 'atk' && m?.teleport) c.globalAlpha = f.t < m.teleport.at ? 1 - f.t / m.teleport.at : Math.min(1, (f.t - m.teleport.at) / 6)
  if (f.buff) { c.shadowColor = f.buff.color; c.shadowBlur = 14 + Math.sin(tick / 4) * 6 }
  if (f.st === 'atk' && f.charge && m?.charge) { const k = f.charge / m.charge.max; c.shadowColor = k >= 1 ? '#ffffff' : '#ffd23f'; c.shadowBlur = 6 + 26 * k + (k >= 1 ? Math.sin(tick) * 6 : 0) } // charging glows, full charge flickers
  if (sheet) {
    const lk = spriteLook(f), keys = compileKeys(f.def), mid = 100 * f.def.look.height, a0 = c.globalAlpha
    c.translate(f.x + lk.dx, gy + lk.dy); c.scale(f.face, 1)
    c.translate(0, -mid); c.rotate(lk.rot); c.translate(0, mid); c.scale(lk.sx, lk.sy) // tilt around the middle, squash from the feet
    for (const l of lk.layers) {
      let i = keys.indexOf(l.key); if (l.alpha <= 0 || (i < 0 && lk.layers.length > 1)) continue; i = Math.max(0, i)
      c.globalAlpha = a0 * l.alpha; c.drawImage(sheet, (i % COLS) * CELL, Math.floor(i / COLS) * CELL, CELL, CELL, -AX, -AY, CELL, CELL)
    }
    c.globalAlpha = a0
  } else drawRig(c, shown, f.def.look, f.x, gy, f.face, Math.sin(tick / 9) * 4 + Math.abs(f.vx) * 2)
  c.restore()
}

export function draw(c: CanvasRenderingContext2D, w: World, fx: Fx, o: { boxes: boolean; sheets: Map<string, HTMLImageElement>; banner?: string; sub?: string; rounds?: { wins: number[]; of: number } }) {
  c.save()
  c.translate((Math.random() - 0.5) * fx.shake * 1.6, (Math.random() - 0.5) * fx.shake * 1.6)
  c.drawImage(stage(), 0, 0)
  // draw the attacker on top
  for (const i of w.f[0].st === 'atk' ? [1, 0] : [0, 1]) drawFighter(c, w.f[i], fx.shown[i], w.f[i].def.atlas ? o.sheets.get(w.f[i].def.id) : undefined, w.tick)
  for (const p of w.proj) drawProj(c, p, w.f[p.owner])
  for (const p of fx.parts) { c.globalAlpha = Math.min(1, p.life / 8); c.fillStyle = p.col; c.fillRect(p.x - 2, FLOOR - p.y - 2, 4, 4) }
  c.globalAlpha = 1
  if (o.boxes) for (const f of w.f) {
    const box = (b: { x0: number; x1: number; y0: number; y1: number }, col: string) => { c.fillStyle = col + '44'; c.strokeStyle = col; c.lineWidth = 1.5; c.fillRect(b.x0, FLOOR - b.y1, b.x1 - b.x0, b.y1 - b.y0); c.strokeRect(b.x0, FLOOR - b.y1, b.x1 - b.x0, b.y1 - b.y0) }
    box(hurtbox(f), f.inv > 0 ? '#888888' : '#3ddc84'); const h = hitbox(f); if (h) box(h, '#ff3b3b')
  }
  c.restore()

  // HUD
  c.font = '700 15px system-ui'; c.textBaseline = 'middle'
  w.f.forEach((f, i) => {
    const x = i ? 520 : 40, wd = 400, max = f.def.stats.hp, sgn = i ? 1 : -1, edge = i ? x : x + wd
    c.fillStyle = INK; c.fillRect(x - 3, 25, wd + 6, 26)
    c.fillStyle = '#5a1620'; c.fillRect(x, 28, wd, 20)
    c.fillStyle = '#fff'; c.fillRect(edge, 28, sgn * wd * Math.max(0, fx.lag[i]) / max, 20)
    c.fillStyle = f.hp / max > 0.3 ? '#ffd23f' : '#ff5a3c'; c.fillRect(edge, 28, sgn * wd * f.hp / max, 20)
    c.fillStyle = INK; c.fillRect(i ? x + wd - 163 : x - 3, 498, 166, 14); c.fillStyle = f.meter >= 100 ? '#7df9ff' : '#3aa0ff'; c.fillRect(i ? x + wd : x, 501, (i ? -1 : 1) * 160 * f.meter / 100, 8)
    if (f.buff) { c.fillStyle = f.buff.color; c.fillRect(i ? x + wd : x, 516, (i ? -1 : 1) * 160 * Math.min(1, f.buff.t / 600), 4) }
    c.fillStyle = '#fff'; c.textAlign = i ? 'right' : 'left'; c.fillText(f.def.name.toUpperCase(), i ? x + wd : x, 64)
    if (o.rounds) for (let k = 0; k < o.rounds.of; k++) { // round wins, next to the clock
      const cx = i ? x + 14 + k * 20 : x + wd - 14 - k * 20
      c.beginPath(); c.arc(cx, 64, 6, 0, 7); c.fillStyle = o.rounds.wins[i] > k ? '#ffd23f' : INK; c.fill(); c.strokeStyle = '#ffd23f'; c.lineWidth = 2; c.stroke()
    }
    const cb = fx.combo[i]
    if (cb.t > 0) { c.globalAlpha = Math.min(1, cb.t / 15); c.font = '900 30px system-ui'; c.fillStyle = '#ffd23f'; c.strokeStyle = INK; c.lineWidth = 5; c.strokeText(`${cb.n} HITS`, i ? x + wd : x, 110); c.fillText(`${cb.n} HITS`, i ? x + wd : x, 110); c.font = '700 14px system-ui'; c.fillStyle = '#fff'; c.fillText(`${cb.dmg} damage`, i ? x + wd : x, 136); c.globalAlpha = 1; c.font = '700 15px system-ui' }
  })
  c.textAlign = 'center'; c.font = '900 30px system-ui'; c.fillStyle = '#fff'; c.fillText(String(Math.ceil(w.time / 60)), 480, 40)
  if (o.banner) {
    c.font = '900 64px system-ui'; c.lineWidth = 8; c.strokeStyle = INK; c.strokeText(o.banner, 480, 220); c.fillStyle = '#ffd23f'; c.fillText(o.banner, 480, 220)
    if (o.sub) { c.font = '700 18px system-ui'; c.fillStyle = '#fff'; c.fillText(o.sub, 480, 270) }
  }
}
