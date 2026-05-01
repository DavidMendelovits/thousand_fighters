import type { Hitbox, Hurtbox } from '../schema/types';

export type AABB = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type FacingBox = Hitbox | Hurtbox;

export function boxesOverlap(a: AABB, b: AABB): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

export function boxToWorld(box: FacingBox, ownerX: number, ownerY: number, facing: 1 | -1): AABB {
  const worldX = facing === 1 ? ownerX + box.x : ownerX - box.x - box.width;
  return {
    x: worldX,
    y: ownerY + box.y,
    width: box.width,
    height: box.height,
  };
}
