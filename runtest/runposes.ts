// bun runtest/runposes.ts fighters/faro.json > runtest/faro.run.json   (npx tsx works too)
// An 8-frame run cycle on the universal rig, in the same shape posedata.ts gives paint.py, so paint.py's
// guide_image() can draw each frame's colour-coded stick figure. These poses are standalone on purpose:
// adding them to POSES would shift every fighter's atlas. Frames 4-7 are frames 0-3 with the legs and arms swapped.
import { readFileSync } from 'node:fs'
import { compile, fk, type FighterDef, type Pose, type Pt } from '../kit'

const CELL = 256, AX = 112, AY = 238 // same as render.ts (not imported: render.ts pulls in the browser)
// [lean, armF up, armF fore, armB up, armB fore, legF thigh, legF shin, legB thigh, legB shin, head, hip dx]
// angles are absolute: 0 = straight down, 90 = forward (right), 180 = up, negative = back
const HALF: [string, Pose][] = [
  ['contact: front foot strikes the ground ahead, back leg just pushed off', [16, -45, 25, 50, 140, 30, 10, -35, -80, 0, 0]],
  ['down: weight lands on the front foot, knee bent, back heel kicks up', [18, -30, 45, 30, 120, 10, -15, -15, -100, 0, 0]],
  ['passing: standing leg straight under the hips, back leg swings through bent', [16, 10, 100, 0, 90, -10, -25, 35, -70, 0, 0]],
  ['up: standing leg pushes off behind, swinging knee drives up high, both feet nearly off the ground', [14, 40, 130, -45, 25, -30, -35, 70, -40, 0, 0]],
]
const swap = (p: Pose): Pose => [p[0], p[3], p[4], p[1], p[2], p[7], p[8], p[5], p[6], p[9], p[10]]
const FRAMES: [string, Pose][] = [...HALF, ...HALF.map(([s, p]) => [s.replace(/front|back/g, w => w === 'front' ? 'back' : 'front'), swap(p)] as [string, Pose])]

const d: FighterDef = JSON.parse(readFileSync(process.argv[2], 'utf8'))
const px = (q: Pt): [number, number] => [Math.round((AX + q[0]) * 10) / 10, Math.round((AY - q[1]) * 10) / 10]
const lead = (p: Pose) => (p[5] > p[7] ? 'left (nearer)' : 'right (farther)')

const cells = FRAMES.map(([stage, p], i) => {
  const j = fk(p, d.look)
  return {
    index: i, key: `run${i}`, pose: p, air: i % 4 === 3,
    joints: Object.fromEntries(Object.entries(j).filter(([k]) => k !== 'HR').map(([k, q]) => [k, px(q as Pt)])),
    headR: Math.round(j.HR * 10) / 10,
    usedBy: [`frame ${i + 1} of 8 of a running loop`],
    sentence: `Running, torso leaning forward. Stage: ${stage}. The front leg here is the ${lead(p)} one; ` +
      `each arm swings opposite its leg, elbows bent about 90 degrees.`,
    checks: [],
  }
})

const idle = compile(d).sheetKeys.indexOf('idle0')
console.log(JSON.stringify({ fighter: d.id, name: d.name, bio: d.bio, cell: CELL, anchor: [AX, AY], idleIndex: idle, cells }, null, 1))
