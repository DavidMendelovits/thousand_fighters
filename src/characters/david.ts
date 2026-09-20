import type { CharacterConfig, Move, MoveEvent, InputToken, Hitbox, ProjectileConfig } from '../schema/types';
import { projectileImpact } from '../../shared/projectileImpact.js';

const hit = (patch: Partial<Hitbox> = {}): Hitbox => ({ x: 20, y: -94, width: 55, height: 32, damage: 32, hitstun: 22, blockstun: 9, knockback: { x: 1, y: 0 }, level: 'mid', ...patch });
function move(id: string, name: string, input: InputToken[], animation: string, timing: [number, number, number], events: MoveEvent[], description: string): Move {
  return { id, displayName: name, animation, description,
    trigger: { allowedStates: ['idle', 'walk_forward', 'walk_back', 'crouch', 'block', 'landing'], sequence: input, window: 7 },
    visualTimeline: timing.map((duration, frame) => ({ duration, frame })),
    phases: [
      { name: 'startup', frames: timing[0], events: [{ onFrame: 0, event: { type: 'set_velocity', vx: 0 } }] },
      { name: 'active', frames: timing[1], events: events.map(event => ({ onFrame: 0, event })) },
      { name: 'recovery', frames: timing[2], events: [{ onFrame: 0, event: { type: 'hitbox_end' } }, { onFrame: 0, event: { type: 'grab_end' } }] },
    ] };
}
function projectile(id: string, kind: NonNullable<ProjectileConfig['visual']>['kind'], color: number, patch: Partial<ProjectileConfig> = {}): ProjectileConfig {
  const p: ProjectileConfig = { id, animation: `david_${id}`, width: 24, height: 24, speed: 6, lifetime: 90,
    hitbox: hit({ x: -12, y: -12, width: 24, height: 24 }),
    visual: { kind, color, accent: 0xffde72 }, spawnPolicy: { maxActivePerOwner: 1, ifAlreadyActive: 'block_spawn' }, ...patch };
  p.impact = projectileImpact(p); return p;
}
const cast = (p: ProjectileConfig, y = -76): MoveEvent => ({ type: 'spawn_projectile', projectile: p, offsetX: 43, offsetY: y });

export function createDavid(): CharacterConfig {
  const balls = [0xf57562, 0x65d4d0, 0xf3cb62].map((color, i) => projectile(`cascade_${i}`, 'juggling-ball', color, {
    velocity: { x: 6.8, y: -1.5 - i * .55 }, gravity: .16,
    hitbox: hit({ x: -11, y: -11, width: 22, height: 22, damage: 17, hitstun: 17, knockback: { x: 1, y: -.5 } }),
  }));
  const cascade = move('cascade', 'Three-ball Cascade', ['hp'], 'juggle', [12, 17, 16], [cast(balls[0])], 'Three staggered, arcing balls. Hit-confirm into sound or ink; jumping changes which arcs connect.');
  cascade.phases[1].events.push({ onFrame: 7, event: cast(balls[1]) }, { onFrame: 14, event: cast(balls[2]) });
  const sound = move('sound_wave', 'Mic Projection', ['forward', 'hp'], 'sound', [9, 5, 26], [cast(projectile('sound_wave', 'wave', 0x69dedf, {
    width: 42, height: 60, speed: 8,
    hitbox: hit({ x: -21, y: -30, width: 42, height: 60, damage: 48, hitstun: 20, knockback: { x: 8, y: -2 }, launches: true }),
  }), -87)], 'A fast sound-wave ender with strong pushback. Block it, then close the gap during recovery.');
  const ink = move('ink_construct', 'Ink to Impact', ['down', 'hp'], 'ink', [9, 5, 29], [cast(projectile('ink_construct', 'ink-fist', 0x343153, {
    width: 40, height: 36, speed: 7,
    hitbox: hit({ x: -20, y: -18, width: 40, height: 36, damage: 58, hitstun: 24, knockback: { x: 5, y: -5 }, launches: true }),
  }))], 'A brush-flick sends ink outward; the droplet resolves into a solid fist after six ticks. It launches on impact.');
  const cable = move('mic_reel', 'Mic-cord Reel', ['back', 'hp'], 'cable', [13, 26, 32], [{ type: 'grab_check',
    grab: { hitbox: { x: 30, y: -98, width: 28, height: 36 }, damage: 55, holdOffsetX: 52, holdDuration: 22, pullFrames: 16, releaseKnockback: { x: 1, y: 0 }, releaseHitstun: 24, releaseLaunches: false, groundOnly: true },
    keyframes: [{ atFrame: 0, x: 30 }, { atFrame: 15, x: 250 }, { atFrame: 24, x: 30 }],
  }], 'The thrown mic travels out, its cable wraps the opponent, and reels them in. Jump to evade; punish the long whiff recovery.');
  cable.extension = { kind: 'mic-cable', color: 0x272b36, accent: 0x9ca9bc, thickness: 3 };
  const punch = move('punch', 'Mic Jab', ['lp'], 'punch', [5, 4, 11], [{ type: 'hitbox_active', hitbox: hit() }], 'Quick confirm into a kick or a juggling cascade.');
  const kick = move('kick', 'Stage Kick', ['lk'], 'kick', [8, 5, 16], [{ type: 'hitbox_active', hitbox: hit({ width: 74, damage: 42, hitstun: 30 }) }], 'Mid-height kick links into balls, ink or sound.');
  const clinch = move('clinch', 'Close Cable Throw', ['grab'], 'cable', [7, 5, 40], [{ type: 'grab_check', grab: { hitbox: { x: 18, y: -105, width: 48, height: 90 }, damage: 80, holdOffsetX: 44, holdDuration: 18, pullFrames: 4, releaseKnockback: { x: 7, y: -5 }, releaseHitstun: 20, releaseLaunches: true, groundOnly: true } }], 'Close grab, brief cable wrap, then a throw.');
  clinch.extension = cable.extension;
  const moves = [cable, ink, sound, cascade, clinch, punch, kick];
  const links: Record<string, string[]> = { punch: ['kick', 'cascade'], kick: ['cascade', 'ink_construct', 'sound_wave'], cascade: ['ink_construct', 'sound_wave'], mic_reel: ['punch', 'cascade'] };
  for (const m of moves) {
    m.inputLabel = ({ punch: 'F', kick: 'G', cascade: 'H', sound_wave: 'Toward + H', ink_construct: '↓ + H', mic_reel: 'Away + H', clinch: 'F + G' } as Record<string, string>)[m.id];
    if (links[m.id]) { m.cancelInto = links[m.id]; m.cancelOn = 'hit'; for (const phase of m.phases) if (phase.name !== 'startup') phase.cancellable = true; }
  }
  return { id: 'david', displayName: 'David', rosterGroup: 'oddities', selectable: true,
    concept: { role: 'Juggler / sound-and-ink mix-up artist', biography: 'A comedian, juggler and artist. Controls space with juggling arcs, projects sound through a wired mic, and turns drawings into physical attacks.', accent: '#65d4d0', tags: ['JUGGLING', 'INK CONSTRUCTS', 'MIC-CORD GRAB'], counterplay: 'Jump the grounded cable grab. Block sound and ink; punish cast recovery. Ball arcs leave space underneath at long range.', artStatus: 'BFL FLUX.2 Klein reference-based key poses. No video-derived animation yet: FAL credit is exhausted. Engine-driven projectiles and cable.' },
    walkForwardSpeed: 3.2, walkBackSpeed: 2.4, jumpVelocity: 12, jumpForwardVelocity: 4.2, jumpBackVelocity: 3.2, gravity: .55, maxFallSpeed: 13, maxHealth: 960, pivotOffsetY: 0, pushboxWidth: 42,
    hurtboxes: { idle: { x: -20, y: -116, width: 40, height: 116 }, crouch: { x: -22, y: -75, width: 44, height: 75 } },
    animations: { idle: 'base', attack: 'punch', hitstun: 'hurt', grabbed: 'hurt', stunned: 'hurt' },
    stats: { attack: .95, defense: .95, projectileAttack: 1.05, projectileDefense: 1, speed: 1, size: 1, weight: .95 }, moves,
    comboRoutes: [
      { name: 'Mic / kick / cascade', moves: ['punch', 'kick', 'cascade'], purpose: 'Close-range hit-confirm into three staggered balls.' },
      { name: 'Cascade / projection', moves: ['punch', 'cascade', 'sound_wave'], purpose: 'Cancel a confirmed juggling ball into the pushback ender.' },
      { name: 'Cascade / ink', moves: ['kick', 'cascade', 'ink_construct'], purpose: 'Trade fast pushback for an ink-fist launcher.' },
      { name: 'Reel / cascade', moves: ['mic_reel', 'cascade', 'sound_wave'], purpose: 'Reel in, then juggle and send away. Requires release timing.' },
    ],
  };
}
