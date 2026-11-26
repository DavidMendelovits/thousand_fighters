// Touch controls for phones: one thumb steers, the other attacks, with as few buttons as fit a fighting game.
// Left half: a floating stick. Put a thumb down anywhere and drag; the stick follows the thumb so a reversal
// is one short slide. Up jumps, down crouches, two quick taps a direction dash, and rolling the thumb through
// ↓ ↘ → reads as a motion like any stick would.
// Right half: Punch and Kick. A tap is light; a flick off the button is heavy, and holding after the flick
// charges it. Punch and Kick together is a grab. A small Block button is held to block.
// poll() is called once per sim tick and returns the input bits, like a keyboard or a gamepad.
import { L, R, U, D, LP, HP, LK, HK, BL } from './sim'

const DEAD = 16 // px from the stick's centre before a direction counts
const REACH = 56 // px the stick can travel before its centre is dragged along behind the thumb
const FLICK = 20 // px a finger moves on a button to make it heavy
const DECIDE = 70 // ms a still finger waits before it counts as light

type Press = { light: number; heavy: number; x: number; y: number; t0: number; bits: number; pulse: number }

export interface TouchPad { el: HTMLElement; poll(): number; destroy(): void }

export function touchPad(host: HTMLElement): TouchPad {
  const el = document.createElement('div'); el.className = 'tpad'
  el.innerHTML = `<div class="tstick"><span class="tring" hidden><span class="tnub"></span></span><span class="thint">Drag to move</span></div>`
    + `<div class="tbtns"><button class="tb tpunch" data-l="${LP}" data-h="${HP}">Punch</button><button class="tb tkick" data-l="${LK}" data-h="${HK}">Kick</button><button class="tb tblock" data-b="${BL}">Block</button></div>`
  host.append(el)
  const stick = el.querySelector<HTMLElement>('.tstick')!, ring = el.querySelector<HTMLElement>('.tring')!, nub = el.querySelector<HTMLElement>('.tnub')!

  let stickId = -1, cx = 0, cy = 0, dir = 0
  const presses = new Map<number, Press>() // by pointer id
  const blocks = new Set<number>()

  const showRing = () => { ring.style.left = cx + 'px'; ring.style.top = cy + 'px' }
  stick.addEventListener('pointerdown', e => {
    if (stickId >= 0) return
    e.preventDefault(); stick.setPointerCapture(e.pointerId); stickId = e.pointerId
    const r = stick.getBoundingClientRect(); cx = e.clientX - r.left; cy = e.clientY - r.top; dir = 0
    ring.hidden = false; nub.style.transform = ''; showRing(); el.classList.add('used')
  })
  stick.addEventListener('pointermove', e => {
    if (e.pointerId !== stickId) return
    const r = stick.getBoundingClientRect(), px = e.clientX - r.left, py = e.clientY - r.top
    let dx = px - cx, dy = py - cy, len = Math.hypot(dx, dy)
    if (len > REACH) { cx = px - dx / len * REACH; cy = py - dy / len * REACH; dx = px - cx; dy = py - cy; len = REACH; showRing() }
    nub.style.transform = `translate(${dx}px, ${dy}px)`
    dir = 0
    if (len > DEAD) { // 8 ways; diagonals get a 45° wedge each so ↘ is easy to hit on the way through a motion
      const a = Math.atan2(dy, dx), s = Math.round(a / (Math.PI / 4)) & 7
      dir = [R, R | D, D, D | L, L, L | U, U, U | R][s]
    }
  })
  const endStick = (e: PointerEvent) => { if (e.pointerId !== stickId) return; stickId = -1; dir = 0; ring.hidden = true }
  stick.addEventListener('pointerup', endStick); stick.addEventListener('pointercancel', endStick)

  for (const b of el.querySelectorAll<HTMLButtonElement>('.tb')) {
    b.addEventListener('contextmenu', e => e.preventDefault())
    b.addEventListener('pointerdown', e => {
      e.preventDefault(); b.setPointerCapture(e.pointerId); b.classList.add('down')
      if (b.dataset.b) { blocks.add(e.pointerId); return }
      presses.set(e.pointerId, { light: +b.dataset.l!, heavy: +b.dataset.h!, x: e.clientX, y: e.clientY, t0: performance.now(), bits: 0, pulse: 0 })
    })
    b.addEventListener('pointermove', e => {
      const p = presses.get(e.pointerId)
      if (p && !p.bits && Math.hypot(e.clientX - p.x, e.clientY - p.y) > FLICK) { p.bits = p.heavy; p.pulse = 3; b.classList.add('heavy') }
    })
    const up = (e: PointerEvent) => {
      b.classList.remove('down', 'heavy'); blocks.delete(e.pointerId)
      const p = presses.get(e.pointerId)
      if (!p) return
      presses.delete(e.pointerId)
      if (!p.bits) released.push({ ...p, bits: p.light, pulse: 3 }) // a quick tap: light, held long enough for the sim to see it
      else if (p.pulse > 0) released.push(p) // a flick let go at once still lands
    }
    b.addEventListener('pointerup', up); b.addEventListener('pointercancel', up); b.addEventListener('lostpointercapture', up)
  }
  let released: Press[] = []

  function poll(): number {
    let bits = dir
    if (blocks.size) bits |= BL
    const now = performance.now()
    for (const p of presses.values()) {
      if (!p.bits && now - p.t0 > DECIDE) { p.bits = p.light; p.pulse = 3 }
      if (p.bits) { bits |= p.bits; p.pulse-- }
    }
    for (const p of released) { bits |= p.bits; p.pulse-- }
    released = released.filter(p => p.pulse > 0)
    return bits
  }
  return { el, poll, destroy: () => el.remove() }
}

/** True on phones and tablets: the page should offer touch controls. */
export const touchFirst = () => matchMedia('(pointer: coarse)').matches

export const TOUCH_CSS = `
.tpad { display: flex; gap: 10px; height: 100%; min-height: 180px; touch-action: none; user-select: none; -webkit-user-select: none; -webkit-touch-callout: none; }
.tstick { position: relative; flex: 1.2; border: 1px dashed var(--line, #332e47); border-radius: 14px; overflow: hidden; display: grid; place-items: center; }
.thint { color: var(--dim, #9a93b3); font-size: 13px; pointer-events: none; }
.tpad.used .thint { display: none; }
.tring { position: absolute; width: 112px; height: 112px; margin: -56px 0 0 -56px; border-radius: 50%; border: 2px solid rgba(255,210,63,.45); background: rgba(255,210,63,.06); pointer-events: none; }
.tnub { position: absolute; left: 50%; top: 50%; width: 46px; height: 46px; margin: -23px 0 0 -23px; border-radius: 50%; background: rgba(255,210,63,.7); }
.tbtns { flex: 1; display: grid; grid-template-columns: 1fr 1fr; grid-template-rows: 1fr 1fr 44px; gap: 10px; }
.tb { border-radius: 50%; border: 2px solid var(--line, #332e47); background: var(--panel, #1e1b2b); font-weight: 800; font-size: 14px; display: grid; place-items: center; text-align: center; touch-action: none; }
.tpunch { grid-column: 1; grid-row: 2; } .tkick { grid-column: 2; grid-row: 1; }
.tblock { grid-column: 1 / 3; grid-row: 3; border-radius: 10px; font-size: 13px; }
.tb.down { border-color: var(--gold, #ffd23f); background: #2c2540; }
.tb.heavy { background: var(--gold, #ffd23f); color: #14121c; }
`
