// npx tsx posedata.ts fighters/faro.json > faro.poses.json
// Everything paint.py and qa.py need to know about each cell of a fighter's pose sheet, straight from the rig:
// exact joint positions in cell pixels, whether the pose is airborne, which moves use it, a plain-English
// description of the pose for the image prompt, and yes/no questions whose right answers the rig already knows.
import { readFileSync } from 'node:fs'
import { compile, fk, POSES, type FighterDef, type Pose, type Pt } from './kit'
import { CELL, COLS, AX, AY } from './render'

const d: FighterDef = JSON.parse(readFileSync(process.argv[2], 'utf8'))
const { moves, poses, sheetKeys } = compile(d)
const look = d.look, s = look.height
const T = 60 * s, A = 28 * s * look.arms, G = 39 * s * look.legs

type J = ReturnType<typeof fk>
const px = (q: Pt): [number, number] => [Math.round((AX + q[0]) * 10) / 10, Math.round((AY - q[1]) * 10) / 10]
const hands = (j: J) => [j.fiF, j.fiB], knees = (j: J) => [j.knF, j.knB], feet = (j: J) => [j.ftF, j.ftB]

// Mean distance of the extremities from the idle pose, in torso lengths: how far this pose is from a guard stance.
const idle = fk(POSES.idle0, look)
const fromIdle = (j: J) => {
  const pts = (q: J) => [q.fiF, q.fiB, q.ftF, q.ftB, q.knF, q.knB, q.head]
  const a = pts(j), b = pts(idle)
  return a.reduce((t, q, i) => t + Math.hypot(q[0] - b[i][0], q[1] - b[i][1]), 0) / a.length / T
}

function handWords(j: J, h: Pt, upper: number, fore: number) {
  const top = j.head[1] + j.HR, mid = (j.sh[1] + j.hip[1]) / 2
  const v = h[1] > top + 0.3 * j.HR ? 'raised above the head' : h[1] > j.head[1] - j.HR * 0.5 ? 'at head height'
    : h[1] > mid ? 'at chest height' : h[1] > j.hip[1] - 0.3 * A ? 'at waist height' : 'low, below the waist'
  const dx = h[0] - j.sh[0]
  const hz = dx > 0.6 * A ? 'reaching forward (to the right)' : dx < -0.6 * A ? 'swung back behind the body (to the left)' : 'close to the body'
  const bend = Math.abs(((fore - upper + 540) % 360) - 180)
  const arm = bend < 25 ? 'arm straight' : bend > 110 ? 'arm sharply bent at the elbow' : 'arm bent at the elbow'
  return `${arm}, hand ${v}, ${hz}`
}

function legWords(j: J, kn: Pt, ft: Pt, air: boolean) {
  const parts: string[] = []
  if (kn[1] > j.hip[1] - 0.3 * G) parts.push('knee lifted to hip height')
  else if (kn[1] > j.hip[1] - 0.7 * G) parts.push('knee bent and lifted')
  if (ft[1] > j.hip[1] - 0.35 * G && ft[0] - j.hip[0] > 0.8 * G) parts.push('foot kicked out forward at hip height')
  else if (ft[1] > j.hip[1] - 0.35 * G && ft[0] - j.hip[0] < -0.8 * G) parts.push('foot kicked out behind at hip height')
  else if (ft[1] > 0.25 * G) parts.push('foot off the ground')
  else if (air) parts.push('leg hanging lowest')
  else parts.push(ft[0] - j.hip[0] > 0.3 * G ? 'foot planted forward' : ft[0] - j.hip[0] < -0.3 * G ? 'foot planted behind' : 'foot planted under the hips')
  return parts.join(', ')
}

function sentence(p: Pose, j: J, air: boolean) {
  const lean = p[0] > 40 ? 'leaning far forward' : p[0] > 15 ? 'leaning forward' : p[0] < -40 ? 'leaning far back' : p[0] < -15 ? 'leaning back' : 'upright'
  const head = p[9] > 10 ? ', head tipped down' : p[9] < -10 ? ', head thrown back' : ''
  return [
    `${air ? 'In mid-air. ' : ''}Torso ${lean}${head}.`,
    `Left arm (nearer the viewer): ${handWords(j, j.fiF, p[1], p[2])}.`,
    `Right arm (farther): ${handWords(j, j.fiB, p[3], p[4])}.`,
    `Left leg (nearer): ${legWords(j, j.knF, j.ftF, air)}.`,
    `Right leg (farther): ${legWords(j, j.knB, j.ftB, air)}.`,
  ].join(' ')
}

// Only questions the rig answers with a clear margin; borderline ones are left out rather than guessed.
function checks(key: string, p: Pose, j: J, dist: number) {
  const out: { id: string; q: string; expect: boolean }[] = []
  const lying = Math.abs(p[0]) > 60
  const topHand = Math.max(...hands(j).map(h => h[1])), top = j.head[1] + j.HR
  if (!lying && topHand > top + 0.3 * j.HR) out.push({ id: 'hand_up', q: 'Is at least one of the character\'s hands raised higher than the top of their head?', expect: true })
  else if (!lying && topHand < j.head[1] - j.HR) out.push({ id: 'hand_up', q: 'Is at least one of the character\'s hands raised higher than the top of their head?', expect: false })
  if (!lying && topHand > j.head[1] - 0.15 * j.HR) out.push({ id: 'hand_face', q: 'Is at least one hand held up at face height or higher?', expect: true })
  else if (!lying && topHand < (j.head[1] + j.sh[1]) / 2) out.push({ id: 'hand_face', q: 'Is at least one hand held up at face height or higher?', expect: false })
  const hiKnee = Math.max(...knees(j).map(k => k[1]))
  if (!lying && hiKnee > j.hip[1] - 0.3 * G) out.push({ id: 'knee_up', q: 'Is at least one knee lifted to roughly hip height or higher?', expect: true })
  else if (!lying && hiKnee < j.hip[1] - 0.8 * G) out.push({ id: 'knee_up', q: 'Is at least one knee lifted to roughly hip height or higher?', expect: false })
  if (!lying && p[0] < -15) out.push({ id: 'lean_back', q: 'Is the torso clearly leaning backward, away from the right side of the image?', expect: true })
  else if (!lying && p[0] > 10) out.push({ id: 'lean_back', q: 'Is the torso clearly leaning backward, away from the right side of the image?', expect: false })
  const backHand = Math.min(...hands(j).map(h => h[0] - j.sh[0]))
  if (!lying && backHand < -0.7 * A) out.push({ id: 'hand_back', q: 'Is one arm swung back so the hand is well behind the body, toward the left side of the image?', expect: true })
  if (!lying && Math.min(...feet(j).map(f => f[1])) > 0.2 * G) out.push({ id: 'both_feet_up', q: 'Are both feet clearly off the ground, as in a jump?', expect: true })
  // the failure the first repaint showed: a hard pose painted as the plain guard stance
  if (key !== 'idle0' && key !== 'idle1' && dist > 0.75) out.push({ id: 'not_stance', q: 'Is the character just standing in an ordinary fighting guard stance (upright, both feet planted, fists up near the chest or face)?', expect: false })
  return out
}

const air = (key: string) => {
  if (key === 'air' || key === 'launch') return true
  const pose = key.replace(/\.[ws]$/, ''), users = Object.values(moves).filter(m => m.pose === pose && /\.[ws]$/.test(key))
  return users.length > 0 && users.every(m => m.air)
}

const cells = sheetKeys.map((key, index) => {
  const p = poses[key], j = fk(p, look), dist = fromIdle(j), a = air(key)
  const pose = key.replace(/\.[ws]$/, ''), phase = key.endsWith('.w') ? 'windup' : key.endsWith('.s') ? 'strike' : null
  const used = phase ? Object.values(moves).filter(m => m.pose === pose).map(m => `${phase} of ${m.name}`) : []
  return {
    index, key, pose: p, air: a, fromIdle: Math.round(dist * 100) / 100,
    joints: Object.fromEntries(Object.entries(j).filter(([k]) => k !== 'HR').map(([k, q]) => [k, px(q as Pt)])),
    headR: Math.round(j.HR * 10) / 10,
    usedBy: used, sentence: sentence(p, j, a), checks: checks(key, p, j, dist),
  }
})

console.log(JSON.stringify({ fighter: d.id, name: d.name, cell: CELL, cols: COLS, anchor: [AX, AY], cells }, null, 1))
