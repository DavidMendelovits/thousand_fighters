// Description -> fighter. Deterministic and instant: same text + seed = same fighter.
// This is the seam for a text model: anything that returns a FighterDef can replace design().
import { TEMPLATES, type Btn, type FighterDef, type Look, type SpecialType } from './kit'

const hash = (s: string) => { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0 }
const rng = (seed: number) => () => { let t = (seed += 0x6d2b79f5); t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
const hsl = (h: number, s: number, l: number) => { // -> #rrggbb
  const a = s * Math.min(l, 1 - l), f = (n: number) => { const k = (n + h / 30) % 12; return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)))).toString(16).padStart(2, '0') }
  return `#${f(0)}${f(8)}${f(4)}`
}

const SKINS = ['#f2c9a0', '#e0a878', '#c68642', '#8d5524', '#5c3a1e', '#f7dfc8']
export const STRING_POOL: Btn[][] = [
  ['lp', 'lp', 'hp'], ['lp', 'lk', 'hk'], ['lp', 'hp', 'hk'], ['hp', 'hp', 'lk'], ['lk', 'lk', 'hk'], ['hp', 'lk', 'hk'],
  ['lk', 'hp'], ['hk', 'hk'], ['lp', 'lp', 'lk', 'hp'], ['hp', 'hk'], ['lk', 'hk', 'hp'], ['lp', 'hp', 'lp', 'hk'], ['hk', 'lp', 'hp'],
]
const SPECIAL_NAMES: Record<SpecialType, string[]> = {
  projectile: ['Bolt', 'Orb', 'Wave', 'Spark', 'Shot'], rush: ['Charge', 'Ram', 'Drive', 'Crash'], rising: ['Riser', 'Skybreaker', 'Ascent'],
  teleport: ['Blink', 'Vanish', 'Step'], slide: ['Slide', 'Skid', 'Undercut'],
}
// keyword -> tweaks. First match per row wins; rows stack.
const WORDS: [RegExp, Partial<Look> & { sp?: SpecialType; hue?: number }][] = [
  [/ninja|assassin|shadow|thief/, { hat: 'hood', sp: 'teleport' }],
  [/robot|mech|cyborg|android|machine/, { head: 'square', hat: 'helmet', skin: '#9aa3ad', hair: 'none' }],
  [/wizard|mage|witch|sorcer|warlock/, { hat: 'wizard', cape: true, sp: 'projectile' }],
  [/knight|paladin|armor|gladiator|soldier/, { hat: 'helmet', bulk: 1.2 }],
  [/demon|devil|oni|imp|dragon/, { hat: 'horns', skin: '#c0392b' }],
  [/king|queen|royal|prince|emperor/, { hat: 'crown', cape: true }],
  [/luchador|wrestler|masked|bandit/, { hat: 'mask', sp: 'rush' }],
  [/monk|karate|kung|martial|samurai|boxer/, { hat: 'headband', sp: 'rising' }],
  [/vampire|hero|caped|super|pirate/, { cape: true }],
  [/giant|huge|big|heavy|tank|ogre|sumo|stocky|hulking|bear/, { bulk: 1.35, height: 1.1 }],
  [/small|tiny|kid|quick|fast|nimble|agile|slim|thin/, { bulk: 0.8, height: 0.92 }],
  [/tall|lanky|long/, { height: 1.15, arms: 1.15, legs: 1.1 }],
  [/bald/, { hair: 'none' }], [/punk/, { hair: 'mohawk' }],
  [/bolt|hurl|shoot|blast|fireball|gun|archer|cannon|spit/, { sp: 'projectile' }],
  [/skater|slide|slippery|penguin|janitor|mop/, { sp: 'slide' }],
  [/fire|flame|lava|sun|ember/, { hue: 20 }], [/ice|frost|snow|water|ocean/, { hue: 195 }],
  [/electric|lightning|thunder|storm/, { hue: 55 }], [/poison|toxic|slime|acid|forest|plant/, { hue: 110 }],
  [/ghost|spirit|void|cosmic|psychic/, { hue: 275 }], [/blood|crimson|rage/, { hue: 0 }],
]

export function design(text: string, seed = hash(text)): FighterDef {
  const r = rng(seed), pick = <T>(a: readonly T[]) => a[Math.floor(r() * a.length)], range = (a: number, b: number) => +(a + r() * (b - a)).toFixed(2)
  const lower = text.toLowerCase(), first = text.trim().split(/[\n.:—]| is | - /)[0].replace(/^the /i, '').trim()
  const name = (first.split(/\s+/).length <= 4 ? first : first.split(/\s+/).slice(0, 2).join(' ')) || 'Fighter'
  let hue = Math.floor(r() * 360)
  const look: Look = {
    skin: pick(SKINS), main: '', alt: '', trim: '', height: range(0.9, 1.12), bulk: range(0.8, 1.3), arms: range(0.92, 1.1), legs: range(0.94, 1.08),
    head: pick(['round', 'round', 'square', 'tall'] as const), hair: pick(['none', 'spikes', 'mohawk', 'long', 'bun'] as const),
    hat: pick(['none', 'none', 'none', 'hood', 'horns', 'helmet', 'wizard', 'crown', 'mask', 'headband'] as const), cape: r() < 0.2,
  }
  const sp = new Set<SpecialType>()
  for (const [re, { sp: s, hue: h, ...tweak }] of WORDS) if (re.test(lower)) { Object.assign(look, tweak); if (s) sp.add(s); if (h !== undefined) hue = h }
  look.main = hsl(hue, range(0.5, 0.85), range(0.3, 0.5))
  look.alt = hsl((hue + pick([0, 30, 180, 210])) % 360, range(0.2, 0.6), range(0.18, 0.35))
  look.trim = hsl((hue + pick([40, 150, 180])) % 360, range(0.6, 0.9), range(0.5, 0.65))

  const all: SpecialType[] = ['projectile', 'rush', 'rising', 'teleport', 'slide']
  const want = 2 + (r() < 0.4 ? 1 : 0)
  while (sp.size < want) sp.add(pick(all))
  const strings: Btn[][] = [], count = 3 + Math.floor(r() * 2)
  while (strings.length < count) { const s = pick(STRING_POOL); if (!strings.includes(s)) strings.push(s) }
  // size is the stat budget: bigger = tougher and harder-hitting, slower and lower-jumping
  const b = look.bulk - 1, h = look.height - 1
  return {
    id: name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40) || 'fighter', name, bio: text.trim(), look,
    stats: { hp: Math.round(1000 + b * 350 + h * 300), speed: +(1 - b * 0.45 - h * 0.3).toFixed(2), power: +(1 + b * 0.3).toFixed(2), jump: +(1 - b * 0.15).toFixed(2) },
    strings,
    moves: [...sp].slice(0, 3).map(type => TEMPLATES[type](pick(SPECIAL_NAMES[type]), hsl((hue + 180) % 360, 0.9, 0.6))),
  }
}

const ADJ = 'Iron,Neon,Rusty,Velvet,Atomic,Feral,Cosmic,Gilded,Hollow,Molten,Frost,Thunder,Toxic,Shadow,Crimson,Lucky,Savage,Silent,Electric,Ancient,Plastic,Haunted,Royal,Tiny,Giant,Lanky,Quick,Heavy,Burning,Frozen,Ghost,Storm,Slime,Blood,Void,Sun,Ocean,Forest,Bald,Punk'.split(',')
const NOUN = 'Ninja,Robot,Wizard,Knight,Demon,King,Luchador,Monk,Vampire,Ogre,Boxer,Pirate,Samurai,Witch,Cyborg,Bandit,Gladiator,Dragon,Janitor,Skater,Assassin,Paladin,Sumo,Imp,Queen,Mage,Soldier,Thief,Wrestler,Android,Penguin,Bear,Hero,Warlock,Emperor,Machine,Prince,Oni,Spirit,Kid'.split(',')
/** The n-th roster fighter: 1600 unique adjective+noun concepts before names repeat. */
export const rosterFighter = (n: number): FighterDef => {
  const a = ADJ[(n * 7) % ADJ.length], b = NOUN[(n + Math.floor(n / NOUN.length) * 3) % NOUN.length]
  return design(`${a} ${b}`, hash(`${a} ${b}`) + Math.floor(n / 1600))
}
