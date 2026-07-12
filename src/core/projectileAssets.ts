import type { CharacterConfig } from '../schema/types';

/**
 * Texture keys the runtime must preload for a character's projectiles.
 *
 * convert inlines each projectile's config into its `spawn_projectile*` event
 * (there is no top-level `config.projectiles`), and `ProjectilePool` renders a
 * projectile with `scene.add.image(config.animation)` — falling back to a plain
 * rectangle when that texture key was never loaded. So the set of texture keys a
 * character needs is exactly the distinct `projectile.animation` values across
 * all its move spawn events. Generated fighters store the sprite at the
 * conventional path `/fighters/<id>/projectiles/<animation>.png` (written by the
 * exporter) and load it under the `animation` key.
 *
 * Returns a de-duplicated list, stable order (first-seen), empty when the
 * character has no projectiles.
 */
export function collectProjectileAnimations(config: CharacterConfig | undefined | null): string[] {
  const animations: string[] = [];
  const seen = new Set<string>();
  for (const move of config?.moves ?? []) {
    for (const phase of move.phases ?? []) {
      for (const entry of phase.events ?? []) {
        const event = entry?.event as { projectile?: { animation?: unknown } } | undefined;
        const animation = event?.projectile?.animation;
        if (typeof animation === 'string' && animation && !seen.has(animation)) {
          seen.add(animation);
          animations.push(animation);
        }
      }
    }
  }
  return animations;
}
