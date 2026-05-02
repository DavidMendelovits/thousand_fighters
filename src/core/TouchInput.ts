export type TouchAttackButton = 'lp' | 'mp' | 'hp' | 'lk' | 'mk' | 'hk';

type DirectionFlags = {
  left: boolean;
  right: boolean;
  up: boolean;
  down: boolean;
};

type ButtonFlags = Record<TouchAttackButton, boolean>;

const NEUTRAL_DIRECTION: DirectionFlags = { left: false, right: false, up: false, down: false };

export type TouchSnapshot = DirectionFlags & ButtonFlags;

const TWO_PI = Math.PI * 2;
const DEG = Math.PI / 180;

type Sector = { center: number; halfWidth: number; flags: DirectionFlags };

// 8-zone radial mapping. Cardinal sectors are wider (~60°) than diagonals (~30°)
// so 'down' and 'forward' are forgiving while QCF rolls (S → SE → E) still register.
// Angles use atan2 convention: 0 = east, +PI/2 = south (DOM y grows downward).
const SECTORS: Sector[] = [
  { center: 0,        halfWidth: 30 * DEG, flags: { left: false, right: true,  up: false, down: false } }, // E
  { center: 45 * DEG, halfWidth: 15 * DEG, flags: { left: false, right: true,  up: false, down: true  } }, // SE
  { center: 90 * DEG, halfWidth: 30 * DEG, flags: { left: false, right: false, up: false, down: true  } }, // S
  { center: 135 * DEG,halfWidth: 15 * DEG, flags: { left: true,  right: false, up: false, down: true  } }, // SW
  { center: 180 * DEG,halfWidth: 30 * DEG, flags: { left: true,  right: false, up: false, down: false } }, // W
  { center: -135 * DEG, halfWidth: 15 * DEG, flags: { left: true,  right: false, up: true,  down: false } }, // NW
  { center: -90 * DEG,  halfWidth: 30 * DEG, flags: { left: false, right: false, up: true,  down: false } }, // N
  { center: -45 * DEG,  halfWidth: 15 * DEG, flags: { left: false, right: true,  up: true,  down: false } }, // NE
];

function angleDistance(a: number, b: number): number {
  let d = Math.abs(a - b) % TWO_PI;
  if (d > Math.PI) d = TWO_PI - d;
  return d;
}

function sectorFor(angle: number): DirectionFlags {
  for (const sector of SECTORS) {
    if (angleDistance(angle, sector.center) <= sector.halfWidth) return sector.flags;
  }
  // Boundary fallback: pick the nearest sector center.
  let best = SECTORS[0];
  let bestDist = angleDistance(angle, best.center);
  for (const sector of SECTORS) {
    const d = angleDistance(angle, sector.center);
    if (d < bestDist) {
      best = sector;
      bestDist = d;
    }
  }
  return best.flags;
}

class TouchInputState {
  private direction: DirectionFlags = { ...NEUTRAL_DIRECTION };
  private buttons: ButtonFlags = { lp: false, mp: false, hp: false, lk: false, mk: false, hk: false };

  setDirection(angle: number | null): void {
    if (angle === null) {
      this.direction = { ...NEUTRAL_DIRECTION };
      return;
    }
    this.direction = { ...sectorFor(angle) };
  }

  setButton(name: TouchAttackButton, pressed: boolean): void {
    this.buttons[name] = pressed;
  }

  clearAll(): void {
    this.direction = { ...NEUTRAL_DIRECTION };
    this.buttons = { lp: false, mp: false, hp: false, lk: false, mk: false, hk: false };
  }

  snapshot(): TouchSnapshot {
    return { ...this.direction, ...this.buttons };
  }
}

export const TouchInput = new TouchInputState();
