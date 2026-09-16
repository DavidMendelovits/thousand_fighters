import type { CharacterConfig, FighterState, GrabSpec, Hitbox, InputToken, Move, MoveEvent, ProjectileConfig } from '../schema/types';

// Original authored roster. Art is exported separately; combat is deterministic data.
const states: FighterState[] = ['idle', 'walk_forward', 'walk_back', 'crouch', 'block', 'landing'];
const hit = (patch: Partial<Hitbox> = {}): Hitbox => ({ x: 24, y: -90, width: 52, height: 32, damage: 40, hitstun: 16, blockstun: 10, knockback: { x: 3, y: 0 }, level: 'mid', ...patch });
const grip = (patch: Partial<GrabSpec> = {}): GrabSpec => ({ hitbox: { x: 20, y: -104, width: 50, height: 88 }, damage: 85, holdOffsetX: 44, holdDuration: 26, pullFrames: 12, releaseKnockback: { x: 6, y: -5 }, releaseHitstun: 24, releaseLaunches: true, groundOnly: true, ...patch });
function move(id: string, name: string, sequence: InputToken[], animation: string, startup: number, active: number, recovery: number, events: MoveEvent[], end: MoveEvent[] = [], description = ''): Move {
  return { id, displayName: name, description, animation, trigger: { allowedStates: states, sequence, window: 7 },
    visualTimeline: [{ frame: 0, duration: startup }, { frame: 1, duration: active }, { frame: 2, duration: recovery }],
    phases: [
      { name: 'startup', frames: startup, events: [{ onFrame: 0, event: { type: 'set_velocity', vx: 0 } }] },
      { name: 'active', frames: active, events: events.map(event => ({ onFrame: 0, event })) },
      { name: 'recovery', frames: recovery, events: end.map(event => ({ onFrame: 0, event })) },
    ] };
}
function normal(id: string, name: string, button: InputToken, animation: string, damage: number, range: number, low = false): Move {
  return { ...move(id, name, [button], animation, low ? 8 : 5, 5, low ? 15 : 10,
    [{ type: 'hitbox_active', hitbox: hit({ width: range, damage, y: low ? -40 : -90, level: low ? 'low' : 'mid' }) }], [{ type: 'hitbox_end' }]), inputLabel: button === 'lp' ? 'F · Punch' : 'G · Kick' };
}
function extension(id: string, name: string, sequence: InputToken[], reach: number, grab: boolean, kind: NonNullable<Move['extension']>['kind'], color: number, accent: number): Move {
  const keyframes = [{ atFrame: 0, x: 30 }, { atFrame: 14, x: reach }, { atFrame: 22, x: 30 }];
  const event: MoveEvent = grab
    ? { type: 'grab_check', grab: grip({ hitbox: { x: 30, y: -96, width: 28, height: 40 }, holdDuration: 28, damage: 90, pullFrames: 16 }), keyframes }
    : { type: 'hitbox_active', hitbox: hit({ x: 30, width: 28, damage: 68, knockback: { x: 7, y: 0 } }), keyframes };
  return { ...move(id, name, sequence, grab ? 'grab' : 'punch', 12, 24, 36, [event], [{ type: 'hitbox_end' }, { type: 'grab_end' }], grab ? 'Extend, catch, reel in, then launch. Jump the grab or punish its recovery.' : 'The limb tip travels outward and retracts; reach is not an instant full-screen hitbox.'),
    extension: { kind, color, accent, thickness: kind === 'elastic' ? 12 : 9 }, inputLabel: sequence.length > 1 ? '↓ + H' : 'H' };
}
function projectile(id: string, kind: NonNullable<ProjectileConfig['visual']>['kind'], color: number, patch: Partial<ProjectileConfig> = {}): ProjectileConfig {
  return { id, animation: `odd_${id}`, width: 42, height: 32, speed: 5, lifetime: 100,
    hitbox: hit({ x: -20, y: -16, width: 40, height: 32, damage: 55, hitstun: 22, knockback: { x: 5, y: 0 } }),
    spawnPolicy: { maxActivePerOwner: 1, ifAlreadyActive: 'block_spawn' }, visual: { kind, color, accent: 0xfff0bc }, ...patch };
}
function cast(id: string, name: string, sequence: InputToken[], event: MoveEvent, description: string): Move {
  return { ...move(id, name, sequence, 'special_1', 16, 6, 26, [event], [], description), inputLabel: sequence.includes('down') ? '↓ + H' : sequence.includes('back') ? '← away + H' : sequence.includes('up') ? '↑ + H' : 'H' };
}
const forward = (p: ProjectileConfig): MoveEvent => ({ type: 'spawn_projectile', projectile: p, offsetX: 46, offsetY: -72 });
const ground = (p: ProjectileConfig): MoveEvent => ({ type: 'spawn_projectile_at_target', projectile: p, offsetX: 0, offsetY: -10 });

const seamGround = projectile('seam_ground', 'cage', 0x66d8c7, { speed: 0, delayFrames: 24, lifetime: 24, width: 52, height: 100,
  velocity: { x: 0, y: -2 }, hitbox: hit({ x: -24, y: -50, width: 48, height: 100, damage: 12 }),
  grab: grip({ anchor: 'contact', holdDuration: 40, damage: 65, releaseKnockback: { x: 3, y: 0 }, releaseLaunches: false }) });
const seamSky = projectile('seam_sky', 'needle', 0xf5d881, { speed: 0, delayFrames: 22, width: 24, height: 78, velocity: { x: 0, y: 8 }, lifetime: 45,
  hitbox: hit({ x: -12, y: -36, width: 24, height: 72, damage: 80, knockback: { x: 3, y: 0 }, knockdown: true }) });
const seamBehind = projectile('seam_behind', 'needle', 0x66d8c7, { delayFrames: 24, speed: 5, hitbox: hit({ x: -22, y: -14, width: 44, height: 28, damage: 40, stun: 42, knockback: { x: 0, y: 0 } }) });

type Brief = { id: string; name: string; role: string; biography: string; accent: string; tags: string[]; counterplay: string; speed: number; health: number; moves: Move[] };
const briefs: Brief[] = [
  { id: 'meridian', name: 'Madame Meridian', role: 'Spatial trap architect', accent: '#66d8c7', speed: 2.5, health: 920,
    biography: 'A retired seamstress who discovered the world has a lining. She unpicks reality and stitches enemies into the wrong place.', tags: ['GROUND / SKY / REAR', 'BIND', 'STUN'], counterplay: 'Portals snapshot your position. Leave the marked spot; guard rear needles from their incoming side.',
    moves: [cast('ground_stitch', 'Hem the Earth', ['down', 'hp'], ground(seamGround), 'A telegraphed floor seam rises and binds the target in place; jump or block it.'),
      cast('sky_needle', 'Pin from Heaven', ['up', 'hp'], { type: 'spawn_projectile_from_sky', projectile: seamSky, targetOffsetX: 0, spawnOffsetY: -260 }, 'A delayed needle descends at the position marked on cast.'),
      cast('backstitch', 'Backstitch', ['back', 'hp'], { type: 'spawn_projectile_behind_target', projectile: seamBehind, distance: 100, offsetY: -72 }, 'A rear portal fires toward the opponent and stuns on an unblocked hit.'),
      cast('thread_needle', 'Running Stitch', ['hp'], forward(projectile('seam_front', 'needle', 0x66d8c7)), 'A straight thread needle controls midrange.')] },
  { id: 'brine', name: 'Brine', role: 'Cephalopod reel-in grappler', accent: '#f5825b', speed: 2.8, health: 1080,
    biography: 'A dockside prizefighter with too many arms and a strict no-hooks policy. The policy refers only to fishing equipment.', tags: ['TENTACLE GRAB', 'REEL-IN', 'INK STUN'], counterplay: 'Jump the low tentacle capture. Block ink, then punish the long reel-in whiff.',
    moves: [extension('tidal_reach', 'Longshore Hook', ['hp'], 240, true, 'tentacle', 0xe95c3e, 0xffd58c),
      cast('ink_bell', 'Blackwater Bell', ['down', 'hp'], forward(projectile('ink_bell', 'orb', 0x809dff, { speed: 4, hitbox: hit({ x: -20, y: -16, width: 40, height: 32, damage: 32, stun: 48, knockback: { x: 0, y: 0 } }) })), 'A slow ink globe stuns on hit, opening a reel-in opportunity.')] },
  { id: 'taffy', name: 'Taffy Riot', role: 'Elastic whiff-punisher', accent: '#ffd55e', speed: 3.7, health: 900,
    biography: 'A pulled-sugar boxer who escaped the confectionery by stretching through its keyhole. Every missed punch comes back eventually.', tags: ['STRETCH STRIKE', 'ELASTIC GRAB', 'LONG RECOVERY'], counterplay: 'Block the long fist; jump the wrap. Both have exposed recovery.',
    moves: [extension('sugar_straight', 'Quarter-mile Upper', ['hp'], 280, false, 'elastic', 0xe9b835, 0xffeaa2),
      extension('candy_wrap', 'Saltwater Tangle', ['down', 'hp'], 210, true, 'elastic', 0xe9b835, 0xffeaa2)] },
  { id: 'vesper', name: 'Sister Static', role: 'Bioluminescent stun zoner', accent: '#8cdcf4', speed: 2.9, health: 880,
    biography: 'A jellyfish oracle whose prayers arrive as electrical impulses. The abyss answers, usually at an inconvenient voltage.', tags: ['STUN ORB', 'FLOATING CAGE', 'FRAGILE'], counterplay: 'Slow projectiles permit jumps. Block the orb rather than trading with its stun.',
    moves: [cast('vesper_sting', 'Silent Benediction', ['hp'], forward(projectile('vesper_sting', 'orb', 0x81dafa, { speed: 3.6, hitbox: hit({ x: -20, y: -16, width: 40, height: 32, damage: 28, stun: 54, knockback: { x: 0, y: 0 } }) })), 'An electrical globe briefly locks movement and attacks.'),
      cast('vesper_cage', 'Choir of Medusae', ['down', 'hp'], forward(projectile('vesper_cage', 'cage', 0x93bfff, { speed: 2.8, width: 58, height: 60, grab: grip({ anchor: 'contact', holdDuration: 42, damage: 60, groundOnly: false, releaseLaunches: false }) })), 'A drifting jellyfish cage captures at contact, including airborne targets.')] },
  { id: 'vellum', name: 'Vellum', role: 'Paper-binding trapper', accent: '#e1c08e', speed: 3.3, health: 930,
    biography: 'A moth archivist who has eaten every forbidden book and remembers the dangerous parts. Late returns become binding contracts.', tags: ['PROJECTILE GRAB', 'PAPER CUT', 'AIR CATCH'], counterplay: 'Binding pages move slowly and disappear after one catch; interrupt the archivist to break the bind.',
    moves: [cast('binding_clause', 'Binding Clause', ['hp'], forward(projectile('binding_clause', 'cage', 0xe1c08e, { speed: 3.8, grab: grip({ anchor: 'contact', damage: 65, holdDuration: 36, groundOnly: false, releaseLaunches: false }) })), 'Flying pages fold into a binding cage around the victim.'),
      cast('errata', 'Violent Revision', ['down', 'hp'], forward(projectile('errata', 'needle', 0xe4a569, { speed: 8, hitbox: hit({ x: -20, y: -14, width: 40, height: 28, damage: 75, knockback: { x: 9, y: -4 }, launches: true }) })), 'A razor page launches the opponent away.')] },
  { id: 'kiln', name: 'Kilnheart', role: 'Armored ceramic heavyweight', accent: '#ffad65', speed: 2.1, health: 1220,
    biography: 'A village kiln assembled itself from the pots nobody wanted. It fights with the accumulated heat of several centuries of rejection.', tags: ['ARMORED STRIKE', 'HEAVY KNOCKBACK', 'SLOW'], counterplay: 'Jump the furnace shot. Throws ignore armor, and the heavy strike is very punishable on whiff.',
    moves: [{ ...move('kiln_slam', 'Bisque Breaker', ['hp'], 'punch', 18, 8, 26, [{ type: 'hitbox_active', hitbox: hit({ width: 85, damage: 115, knockback: { x: 11, y: -6 }, launches: true }) }], [{ type: 'hitbox_end' }]), inputLabel: 'H',
      phases: [{ name: 'startup', frames: 18, events: [{ onFrame: 0, event: { type: 'armor', hits: 1, duration: 25 } }, { onFrame: 0, event: { type: 'set_velocity', vx: 0 } }] }, { name: 'active', frames: 8, events: [{ onFrame: 0, event: { type: 'hitbox_active', hitbox: hit({ width: 85, damage: 115, knockback: { x: 11, y: -6 }, launches: true }) } }] }, { name: 'recovery', frames: 26, events: [{ onFrame: 0, event: { type: 'hitbox_end' } }] }] },
      cast('furnace_spit', 'Fired Twice', ['down', 'hp'], forward(projectile('furnace_spit', 'orb', 0xff8c3f, { speed: 4, width: 54, height: 48, hitbox: hit({ x: -25, y: -22, width: 50, height: 44, damage: 90, knockback: { x: 10, y: 0 }, knockdown: true }) })), 'A heavy furnace clinker knocks the opponent down.')] },
  { id: 'mycel', name: 'Maestro Mycel', role: 'Root-network conductor', accent: '#b9cc68', speed: 2.7, health: 980,
    biography: 'A fungal conductor conducting an orchestra that lives under the floor. Nobody applauds until the roots let go.', tags: ['GROUND BIND', 'ROOT EXTENSION', 'SETPLAY'], counterplay: 'Move off the root marker before it blooms. Jump the extended root hand.',
    moves: [cast('root_ovation', 'Standing Ovation', ['hp'], ground(projectile('root_ovation', 'spore', 0xb9cc68, { speed: 0, delayFrames: 28, width: 56, height: 90, lifetime: 28, hitbox: hit({ x: -26, y: -70, width: 52, height: 80, damage: 12 }), grab: grip({ anchor: 'contact', holdDuration: 40, damage: 68, releaseLaunches: false }) })), 'Roots emerge under the marked target and hold them in place.'),
      extension('root_baton', 'Root Note', ['down', 'hp'], 230, false, 'root', 0x77963c, 0xdde2a0)] },
  { id: 'rook', name: 'Rivet Rook', role: 'Magnetic salvage brawler', accent: '#e3a966', speed: 3.1, health: 1020,
    biography: 'A crow who repaired its own wings with scrap magnets and decided flight was overrated. Everything shiny is ammunition.', tags: ['MAGNETIC CAPTURE', 'SCRAP LAUNCH', 'MIDRANGE'], counterplay: 'Block the magnet to avoid being dragged into close range. Scrap shots can be jumped.',
    moves: [cast('magnet_mouth', 'Finders Keepers', ['hp'], forward(projectile('magnet_mouth', 'cage', 0xe3a966, { speed: 4.5, grab: grip({ damage: 70, holdDuration: 36, pullFrames: 24 }) })), 'A flying magnetic clamp catches and drags the victim toward Rook.'),
      cast('scrap_fan', 'Junk Dividend', ['down', 'hp'], forward(projectile('scrap_fan', 'scrap', 0xd78753, { speed: 7, hitbox: hit({ x: -20, y: -18, width: 40, height: 36, damage: 65, knockback: { x: 8, y: -5 }, launches: true }) })), 'A tumbling engine part launches on contact.')] },
  { id: 'veil', name: 'Widow Veil', role: 'Ribbon-limbed phantom', accent: '#b1c8e9', speed: 3.5, health: 900,
    biography: 'An abandoned wedding dress that has outlived its wearer and developed opinions. Its sleeves reach further than its patience.', tags: ['RIBBON GRAB', 'FAR STRIKE', 'MOBILE'], counterplay: 'Jump the sleeve snare; guard the ribbon slash and close distance during its retraction.',
    moves: [extension('sleeve_snare', 'Till Death', ['hp'], 255, true, 'ribbon', 0x789ac6, 0xe1e9ff),
      extension('hem_slash', 'Unfinished Business', ['down', 'hp'], 290, false, 'ribbon', 0x789ac6, 0xe1e9ff)] },
  { id: 'bellwether', name: 'Bellwether', role: 'Pressure-wave bruiser', accent: '#d7ba76', speed: 2.3, health: 1180,
    biography: 'A salvage diver who surfaced with a church bell for a head. It rings for ships that have not sunk yet.', tags: ['PRESSURE KNOCKBACK', 'SONIC STUN', 'HEAVY'], counterplay: 'The wide pressure wave is slow. Guard the toll, then use mobility to avoid the grab.',
    moves: [cast('pressure_front', 'Depth Charge', ['hp'], forward(projectile('pressure_front', 'wave', 0x8bd5d4, { speed: 3.8, width: 58, height: 80, hitbox: hit({ x: -28, y: -38, width: 56, height: 76, damage: 80, knockback: { x: 12, y: -3 }, launches: true }) })), 'A compressed water front launches and pushes the opponent far away.'),
      cast('dead_toll', 'Dead Toll', ['down', 'hp'], forward(projectile('dead_toll', 'wave', 0xe3cc83, { speed: 6, width: 50, height: 60, hitbox: hit({ x: -24, y: -28, width: 48, height: 56, damage: 32, stun: 46, knockback: { x: 0, y: 0 } }) })), 'A ringing shockwave stuns without pushing, inviting a close grab.')] },
];

export const ODDITIES_IDS = briefs.map(b => b.id);
export function createOdditiesRoster(): CharacterConfig[] {
  return briefs.map(b => {
    const closeGrab = { ...move('clinch', 'Catch & Cast', ['grab'], 'throw', 7, 5, 44,
      [{ type: 'grab_check', grab: grip({ damage: b.health > 1100 ? 120 : 95, pullFrames: 5, holdDuration: 22 }) }], [{ type: 'grab_end' }], 'Close-range unblockable grab. The victim is held, then thrown; jump to evade.'), inputLabel: 'F + G · Grab' };
    return { id: b.id, displayName: b.name, rosterGroup: 'oddities', concept: { role: b.role, biography: b.biography, accent: b.accent, tags: b.tags, counterplay: b.counterplay, artStatus: 'Generated key-pose prototype; authored timing and procedural attached effects.' },
      walkForwardSpeed: b.speed, walkBackSpeed: b.speed * .7, jumpVelocity: b.health > 1100 ? 10 : 12, jumpForwardVelocity: b.speed * 1.4, jumpBackVelocity: b.speed,
      gravity: .55, maxFallSpeed: 13, maxHealth: b.health, pivotOffsetY: 0, pushboxWidth: 52,
      hurtboxes: { idle: { x: -22, y: -116, width: 44, height: 116 }, crouch: { x: -24, y: -72, width: 48, height: 72 } },
      animations: { idle: 'base', attack: 'punch', grabbed: 'hurt', stunned: 'hurt', hitstun: 'hurt' },
      moves: [...b.moves, closeGrab, normal('punch', 'Quick Check', 'lp', 'punch', 36, 46), normal('kick', 'Low Sweep', 'lk', 'kick', 48, 65, true)] };
  });
}
