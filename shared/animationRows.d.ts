// Type sidecar for animationRows.js so the TS engine (`src/`) gets full types
// when importing the shared registry. Keep in sync with animationRows.js.

export type AnimationRowRole = 'base' | 'normal' | 'special' | 'movement' | 'defense' | 'grab';

export interface AnimationRow {
  /** Sprite-sheet / row id (the sheet key). */
  id: string;
  /** Display name (gym navigator, admin tabs). */
  label: string;
  /** Navigator group label. */
  group: string;
  /** Default frame count for newly generated rows. */
  frameCount: number;
  role: AnimationRowRole;
  /** True when the row plays as a move-triggered animation (MOVE_SHEETS). */
  moveAnimation: boolean;
}

export const ANIMATION_ROWS: AnimationRow[];
export const SHEET_IDS: string[];
export const MOVE_SHEET_IDS: string[];
export const SHEET_LABELS: Record<string, string>;

export function getRow(id: string): AnimationRow | undefined;
export function sheetGroups(): { label: string; sheets: string[] }[];
