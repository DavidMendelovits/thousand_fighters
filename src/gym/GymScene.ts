import Phaser from 'phaser';
import type { SpriteSheetId } from '../schema/types';
import type { Box, FrameData, GymFrame } from './loadGymData';

/**
 * Character Gym canvas.
 *
 * Renders one sprite frame planted on the floor line at game scale, so foot
 * drift across an animation is visible, and lets you drag the feet anchor to
 * fix it. Collision overlays (hurtbox/hitbox) are READ-ONLY in Phase 1
 * (docs/CHARACTER_GYM_DESIGN.md D3).
 *
 * Coordinate adapter (C1): frameData stores per-frame `anchor` in frame pixels
 * (top-left origin) and `hurtbox`/`attackBox` as anchor-relative frame pixels.
 * The anchor maps to the fixed floor pivot (PIVOT_X, FLOOR_Y); every box is
 *   screen.x = PIVOT_X + box.x * scale
 *   screen.y = FLOOR_Y  + box.y * scale   (box.y is negative = above the floor)
 *   screen.w = box.width  * scale
 *   screen.h = box.height * scale
 * The sprite uses origin = anchor / frameDims so the same anchor pixel sits on
 * the pivot regardless of frame size.
 *
 * Textures are keyed by the frame's `file`, not its index, so reorder (T7) can
 * permute the data arrays in place without invalidating any texture.
 */

const CANVAS_W = 800;
const CANVAS_H = 450;
const FLOOR_Y = 360;
const PIVOT_X = 400;

export type BoundsMode = 'visual' | 'anchor' | 'hurtbox' | 'hitbox';

export type GymSnapshot = {
  ready: boolean;
  sheet: SpriteSheetId;
  frame: number;
  frameCount: number;
  playing: boolean;
  anchor: { x: number; y: number } | null;
  frameDims: { width: number; height: number } | null;
};

type Payload = {
  characterId: string;
  scale: number;
  /** Frame image URLs by sheet (kept in lockstep with frameData order). */
  frameUrls: Partial<Record<SpriteSheetId, string[]>>;
  /** Live, editable frame metadata (mutated in place as the user edits). */
  frameData: FrameData | null;
};

export class GymScene extends Phaser.Scene {
  private readonly payload: Payload;

  private sheet: SpriteSheetId = 'base';
  private frame = 0;
  private mode: BoundsMode = 'anchor';
  private playing = false;
  private onion = false;
  private fps = 12;
  private speed = 1;
  private accumulatorMs = 0;

  private sprite!: Phaser.GameObjects.Image;
  private onionSprites: Phaser.GameObjects.Image[] = [];
  private overlay!: Phaser.GameObjects.Graphics;
  private ready = false;
  /** Active anchor-drag gesture (scene-space pointer + anchor at gesture start). */
  private drag: { px: number; py: number; ax: number; ay: number } | null = null;

  /** Fired whenever the active frame's anchor changes (drag or programmatic). */
  onAnchorChange?: (sheet: SpriteSheetId, frame: number, anchor: { x: number; y: number }) => void;
  /** Fired once at the END of a drag gesture that changed the anchor — one undo step. */
  onAnchorCommit?: (sheet: SpriteSheetId, frame: number, before: { x: number; y: number }, after: { x: number; y: number }) => void;
  /** Fired when the active frame index changes (scrub/play/reorder). */
  onFrameChange?: (sheet: SpriteSheetId, frame: number) => void;

  constructor(payload: Payload) {
    super('Gym');
    this.payload = payload;
  }

  preload(): void {
    for (const sheet of Object.keys(this.payload.frameUrls) as SpriteSheetId[]) {
      (this.payload.frameUrls[sheet] ?? []).forEach((url, index) => {
        if (url) this.load.image(this.keyFor(sheet, index), url);
      });
    }
  }

  create(): void {
    this.cameras.main.setBackgroundColor('#141820');
    this.drawStage();
    this.onionSprites = [];
    this.sprite = this.add.image(PIVOT_X, FLOOR_Y, '__MISSING').setDepth(10);
    this.overlay = this.add.graphics().setDepth(60);

    // Scene-level pointer dragging. Pointer coords are already in game space
    // (the FIT scale manager maps canvas → game for us), so this works
    // regardless of how the canvas is letterboxed.
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => this.beginDrag(p));
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => this.moveDrag(p));
    this.input.on('pointerup', () => this.endDrag());
    this.input.on('pointerupoutside', () => this.endDrag());

    this.ready = true;
    this.refresh();
  }

  update(_time: number, deltaMs: number): void {
    if (!this.ready || !this.playing) return;
    this.accumulatorMs += deltaMs * this.speed;
    const frameMs = 1000 / this.fps;
    while (this.accumulatorMs >= frameMs) {
      this.accumulatorMs -= frameMs;
      this.step(1);
    }
  }

  // ---- public API (driven by the page UI) ----

  setSheet(sheet: SpriteSheetId): void {
    this.sheet = sheet;
    this.frame = 0;
    this.accumulatorMs = 0;
    this.refresh();
    this.onFrameChange?.(this.sheet, this.frame);
  }

  setFrame(index: number): void {
    const count = this.frameCount();
    if (count === 0) return;
    this.frame = ((index % count) + count) % count;
    this.refresh();
    this.onFrameChange?.(this.sheet, this.frame);
  }

  step(delta: number): void {
    this.setFrame(this.frame + delta);
  }

  /**
   * Re-render after the owner mutated the data arrays (reorder). The data is the
   * single source of truth; this just repoints the active frame and redraws.
   */
  rerenderAt(frame: number): void {
    const count = this.frameCount();
    this.frame = count === 0 ? 0 : Phaser.Math.Clamp(frame, 0, count - 1);
    this.refresh();
    this.onFrameChange?.(this.sheet, this.frame);
  }

  setMode(mode: BoundsMode): void {
    this.mode = mode;
    if (mode !== 'anchor') this.drag = null;
    this.drawOverlay();
  }

  setPlaying(playing: boolean): void {
    this.playing = playing;
    this.accumulatorMs = 0;
  }

  togglePlay(): void {
    this.setPlaying(!this.playing);
  }

  setSpeed(speed: number): void {
    this.speed = speed;
  }

  setOnion(onion: boolean): void {
    this.onion = onion;
    this.refresh();
  }

  /** Set the active frame's anchor in frame pixels (clamped to frame bounds). */
  setAnchor(x: number, y: number): void {
    const meta = this.activeFrameMeta();
    if (!meta) return;
    meta.anchor = {
      x: Phaser.Math.Clamp(Math.round(x), 0, meta.width),
      y: Phaser.Math.Clamp(Math.round(y), 0, meta.height),
    };
    this.refresh();
    this.onAnchorChange?.(this.sheet, this.frame, meta.anchor);
  }

  getSnapshot(): GymSnapshot {
    const meta = this.activeFrameMeta();
    return {
      ready: this.ready,
      sheet: this.sheet,
      frame: this.frame,
      frameCount: this.frameCount(),
      playing: this.playing,
      anchor: meta ? { ...meta.anchor } : null,
      frameDims: meta ? { width: meta.width, height: meta.height } : null,
    };
  }

  // ---- internals ----

  /** Stable texture key for a frame: keyed by `file` so reorder is index-safe. */
  private keyFor(sheet: SpriteSheetId, index: number): string {
    const file = this.payload.frameData?.frames?.[sheet]?.[index]?.file;
    return `${this.payload.characterId}:${sheet}:${file ?? `#${index}`}`;
  }

  private frameCount(): number {
    return this.payload.frameData?.frames?.[this.sheet]?.length
      ?? this.payload.frameUrls[this.sheet]?.length
      ?? 0;
  }

  private activeFrameMeta(): GymFrame | undefined {
    return this.payload.frameData?.frames?.[this.sheet]?.[this.frame];
  }

  private hasTexture(sheet: SpriteSheetId, index: number): boolean {
    return this.textures.exists(this.keyFor(sheet, index));
  }

  private refresh(): void {
    if (!this.ready) return;
    this.placeSprite(this.sprite, this.sheet, this.frame, 1);

    // Onion-skin: ±2 neighbour frames, faded, planted at the same pivot.
    this.onionSprites.forEach((s) => s.destroy());
    this.onionSprites = [];
    if (this.onion) {
      for (const offset of [-2, -1, 1, 2]) {
        const idx = this.frame + offset;
        if (idx < 0 || idx >= this.frameCount() || !this.hasTexture(this.sheet, idx)) continue;
        const ghost = this.add.image(PIVOT_X, FLOOR_Y, this.keyFor(this.sheet, idx)).setDepth(5);
        this.placeSprite(ghost, this.sheet, idx, 0.22 - Math.abs(offset) * 0.05);
        ghost.setTint(0x6fb3ff);
        this.onionSprites.push(ghost);
      }
    }
    this.drawOverlay();
  }

  private placeSprite(img: Phaser.GameObjects.Image, sheet: SpriteSheetId, index: number, alpha: number): void {
    if (!this.hasTexture(sheet, index)) {
      img.setVisible(false);
      return;
    }
    img.setVisible(true);
    img.setTexture(this.keyFor(sheet, index));
    const meta = this.payload.frameData?.frames?.[sheet]?.[index];
    const w = img.width;
    const h = img.height;
    if (meta && w > 0 && h > 0) {
      img.setOrigin(meta.anchor.x / meta.width, meta.anchor.y / meta.height);
    } else {
      img.setOrigin(0.5, 1);
    }
    img.setScale(this.payload.scale);
    img.setPosition(PIVOT_X, FLOOR_Y);
    img.setAlpha(alpha);
  }

  private beginDrag(p: Phaser.Input.Pointer): void {
    if (this.mode !== 'anchor') return;
    const meta = this.activeFrameMeta();
    if (!meta) return;
    this.drag = { px: p.x, py: p.y, ax: meta.anchor.x, ay: meta.anchor.y };
  }

  private moveDrag(p: Phaser.Input.Pointer): void {
    if (!this.drag) return;
    // Drag the sprite so its feet land on the fixed floor crosshair. Moving the
    // sprite right (dx>0) means a frame pixel further left now sits on the pivot,
    // so the anchor decreases by the drag distance (converted to frame px).
    const dx = (p.x - this.drag.px) / this.payload.scale;
    const dy = (p.y - this.drag.py) / this.payload.scale;
    this.setAnchor(this.drag.ax - dx, this.drag.ay - dy);
  }

  private endDrag(): void {
    if (!this.drag) return;
    const meta = this.activeFrameMeta();
    const before = { x: this.drag.ax, y: this.drag.ay };
    this.drag = null;
    if (meta && (meta.anchor.x !== before.x || meta.anchor.y !== before.y)) {
      this.onAnchorCommit?.(this.sheet, this.frame, before, { ...meta.anchor });
    }
  }

  private drawStage(): void {
    const g = this.add.graphics().setDepth(-5);
    g.fillStyle(0x20262f, 1).fillRect(0, FLOOR_Y, CANVAS_W, CANVAS_H - FLOOR_Y);
    g.lineStyle(2, 0x9aa8bb, 1).lineBetween(0, FLOOR_Y, CANVAS_W, FLOOR_Y);
    g.lineStyle(1, 0x3a4452, 1);
    for (let x = 0; x <= CANVAS_W; x += 50) {
      const tall = x % 100 === 0;
      g.lineBetween(x, FLOOR_Y, x, FLOOR_Y + (tall ? 14 : 7));
    }
    // Vertical pivot guide.
    g.lineStyle(1, 0x2d3746, 1).lineBetween(PIVOT_X, 0, PIVOT_X, FLOOR_Y);
  }

  private drawOverlay(): void {
    const g = this.overlay;
    g.clear();
    const meta = this.activeFrameMeta();
    const scale = this.payload.scale;

    // Read-only collision overlays (Phase 1).
    if (meta?.hurtbox && (this.mode === 'hurtbox' || this.mode === 'anchor')) {
      this.drawBox(g, meta.hurtbox, scale, 0x79a8ff, 0.16);
    }
    if (meta?.attackBox && (this.mode === 'hitbox' || this.mode === 'anchor')) {
      this.drawBox(g, meta.attackBox, scale, 0xff6b6b, 0.18);
    }
    if (meta && this.mode === 'visual') {
      // Visual bounds = the full frame rectangle around the anchor.
      const vb: Box = { x: -meta.anchor.x, y: -meta.anchor.y, width: meta.width, height: meta.height };
      this.drawBox(g, vb, scale, 0x5bd6e6, 0.0);
    }

    // Anchor crosshair (always) at the fixed floor pivot.
    g.lineStyle(1.5, 0xf0b35b, 0.95);
    g.lineBetween(PIVOT_X - 10, FLOOR_Y, PIVOT_X + 10, FLOOR_Y);
    g.lineBetween(PIVOT_X, FLOOR_Y - 10, PIVOT_X, FLOOR_Y + 10);
  }

  private drawBox(g: Phaser.GameObjects.Graphics, box: Box, scale: number, color: number, fillAlpha: number): void {
    const x = PIVOT_X + box.x * scale;
    const y = FLOOR_Y + box.y * scale;
    const w = box.width * scale;
    const h = box.height * scale;
    if (fillAlpha > 0) g.fillStyle(color, fillAlpha).fillRect(x, y, w, h);
    g.lineStyle(1.5, color, 0.9).strokeRect(x, y, w, h);
  }
}

export const GYM_CANVAS = { width: CANVAS_W, height: CANVAS_H, floorY: FLOOR_Y, pivotX: PIVOT_X };
