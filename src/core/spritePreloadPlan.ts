import type { CharacterConfig, CharacterSpriteConfig } from '../schema/types';

export type SpritePreloadEntry = { sprite: CharacterSpriteConfig; keyPrefix: string };

/** A multi-actor fighter owns actor textures; its legacy top-level sprite is metadata/portrait only. */
export function spritePreloadPlan(character: CharacterConfig): SpritePreloadEntry[] {
  if (character.actors?.length) {
    return character.actors.flatMap(actor => actor.sprite
      ? [{ sprite: actor.sprite, keyPrefix: `${character.id}:${actor.id}` }]
      : []);
  }
  return character.sprite ? [{ sprite: character.sprite, keyPrefix: character.id }] : [];
}
